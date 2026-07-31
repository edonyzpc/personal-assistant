import { createCoreToolCapabilities } from "../../ai-services/capability-adapter";
import { CapabilityRegistry } from "../../ai-services/capability-registry";
import type { AgentCapability } from "../../ai-services/capability-types";
import {
    createListRecentNotesTool,
    createReadNoteOutlineTool,
    createSearchMemoryTool,
    createSearchVaultMetadataTool,
    createSearchVaultSnippetsTool,
} from "../../ai-services/chat-tools";
import { BUILTIN_WEB_SEARCH_TOOL_NAME } from "../../ai-services/builtin-web-search-provider";
import {
    createPaAgentCapabilityToolExecutor,
} from "../../ai-services/pa-agent-host-tools";
import {
    PaAgentLoop,
    type PaAgentToolExecutor,
} from "../../ai-services/pa-agent-loop";
import { createAgentControlSnapshot } from "../../ai-services/pa-agent-control-policy";
import { PolicyEngine } from "../../ai-services/policy-engine";
import type { SourceRecord } from "../../ai-services/chat-types";
import {
    capturePageletSourceSnapshot,
    hashPageletContent,
    sameSourceSnapshot,
    sourceSnapshotIdentity,
} from "./anchor-snapshot";
import {
    createAnchorBoundCurrentNoteTool,
    createAnchorBoundInspectNoteTool,
} from "./anchor-note-tool";
import { PageletLeadDrivenPolicy } from "./lead-driven-policy";
import {
    PAGELET_DEEP_DISCOVER_MAX_OBSERVATION_CHARS,
    PAGELET_DEEP_DISCOVER_MAX_TOOL_CALLS,
    PAGELET_DEEP_DISCOVER_MAX_TURNS,
    PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS,
    type PageletAgentRunMetrics,
    type PageletAgentRunResult,
    type PageletAgentRuntime,
    type PageletAgentRuntimeDependencies,
    type PageletAgentRuntimeRunRequest,
    type PageletAgentSourceSnapshot,
    type PageletAgentToolProvenance,
    type PageletAgentWebObservation,
} from "./types";

export const PAGELET_AGENT_READ_ONLY_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
    "search_memory",
    "get_current_note_context",
    "search_vault_snippets",
    "inspect_obsidian_note",
    "search_vault_metadata",
    "list_recent_notes",
    "read_note_outline",
    BUILTIN_WEB_SEARCH_TOOL_NAME,
]);

const PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS = 30_000;

const PAGELET_VAULT_EVIDENCE_TOOL_NAMES = new Set([
    "search_memory",
    "get_current_note_context",
    "search_vault_snippets",
    "inspect_obsidian_note",
    "read_note_outline",
    "search_vault_metadata",
    "list_recent_notes",
]);

export function createPageletAgentRuntime(
    dependencies: PageletAgentRuntimeDependencies,
): PageletAgentRuntime {
    return {
        run: (request) => runPageletAgent(dependencies, request),
    };
}

async function runPageletAgent(
    dependencies: PageletAgentRuntimeDependencies,
    request: PageletAgentRuntimeRunRequest,
): Promise<PageletAgentRunResult> {
    const now = dependencies.now ?? Date.now;
    const startedAt = now();
    const runId = request.runId ?? dependencies.createRunId?.() ?? createRunId();
    const registry = createPageletRegistry(dependencies, request);
    const allowedToolNames = availableAllowedToolNames(registry);
    const schemaResult = registry.exportProviderSchemasSafe({ allowedToolNames });
    if (!schemaResult.ok) {
        throw new Error("Pagelet read-only tool schema export failed.");
    }
    const model = dependencies.createModel({
        registry,
        allowedToolNames,
        schemas: schemaResult.schemas,
        toolDefinitions: registry.listDefinitions({ allowedToolNames }),
        anchor: request.anchor,
        triggerReason: request.triggerReason,
        signal: request.signal,
    });

    const sourceSnapshots = new Map<string, PageletAgentSourceSnapshot>();
    const sourceTools = new Map<string, Set<string>>();
    const toolProvenance: PageletAgentToolProvenance[] = [];
    const webObservations: PageletAgentWebObservation[] = [];
    const baseExecutor = createPaAgentCapabilityToolExecutor({
        registry,
        host: dependencies.host,
        allowedToolNames,
    });
    const toolExecutor = createProvenanceCapturingExecutor({
        baseExecutor,
        dependencies,
        request,
        sourceSnapshots,
        sourceTools,
        toolProvenance,
        webObservations,
    });
    const loop = new PaAgentLoop({
        runId,
        userInput: buildPageletUserInput(request),
        model,
        toolExecutor,
        hostPolicy: new PageletLeadDrivenPolicy({
            anchorPath: request.anchor.path,
            maxTurns: PAGELET_DEEP_DISCOVER_MAX_TURNS,
            maxToolCalls: PAGELET_DEEP_DISCOVER_MAX_TOOL_CALLS,
            maxWallClockMs: PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS,
            now,
            startedAt,
            finalizationReserveMs: PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS,
        }),
        signal: request.signal,
        maxTurns: PAGELET_DEEP_DISCOVER_MAX_TURNS,
        maxToolCalls: PAGELET_DEEP_DISCOVER_MAX_TOOL_CALLS,
        maxWallClockMs: PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS,
        finalizationReserveMs: PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS,
        maxObservationChars: PAGELET_DEEP_DISCOVER_MAX_OBSERVATION_CHARS,
        toolExecutionMode: "hybrid",
        initialRuntimeInstruction: buildInitialRuntimeInstruction(request),
        initialControlSnapshot: createAgentControlSnapshot({
            exposureMode: "source-scoped",
            sourceScope: "notes",
            allowedToolNames,
            ...(allowedToolNames.has(BUILTIN_WEB_SEARCH_TOOL_NAME)
                ? {
                    blockedToolNames: new Set([BUILTIN_WEB_SEARCH_TOOL_NAME]),
                    blockedReasons: {
                        [BUILTIN_WEB_SEARCH_TOOL_NAME]:
                            "WebSearch unlocks only after a vault observation reaches the model.",
                    },
                }
                : {}),
            diagnostics: [{
                type: "pagelet_verification_only_web",
                message: "Deep Discover begins with WebSearch blocked until vault evidence is available.",
            }],
        }),
        ...(dependencies.turnLeaseProvider
            ? { turnLeaseProvider: dependencies.turnLeaseProvider }
            : {}),
    });
    const loopResult = await loop.run();
    const metrics = summarizeMetrics(loopResult, Math.max(0, now() - startedAt));

    return {
        loopResult,
        finalText: loopResult.committedFinalText.trim(),
        anchor: request.anchor,
        sourceSnapshots: [...sourceSnapshots.values()].sort(compareSources),
        sourceTools: new Map([...sourceTools.entries()].map(([path, tools]) => [
            path,
            new Set(tools) as ReadonlySet<string>,
        ])),
        toolProvenance,
        webObservations: dedupeWebObservations(webObservations),
        metrics,
    };
}

function createPageletRegistry(
    dependencies: PageletAgentRuntimeDependencies,
    request: PageletAgentRuntimeRunRequest,
): CapabilityRegistry {
    const registry = new CapabilityRegistry({
        policyEngine: new PolicyEngine({
            platform: dependencies.runtimePlatform ?? "desktop",
            runKind: "review",
            allowWrite: false,
        }),
        telemetryEnabled: false,
    });
    const pathFilter = { isPathAllowed: dependencies.isPathAllowed };
    registry.registerMany(createCoreToolCapabilities([
        createSearchMemoryTool(dependencies.executeMemorySearch),
        createAnchorBoundCurrentNoteTool(request.anchor),
        createSearchVaultMetadataTool(pathFilter),
        createListRecentNotesTool(pathFilter),
        createReadNoteOutlineTool(pathFilter),
        createAnchorBoundInspectNoteTool(request.anchor, dependencies.isPathAllowed),
        createSearchVaultSnippetsTool(pathFilter),
    ], { providerId: "pagelet-deep-discover-core" }));

    for (const capability of dependencies.webCapabilities ?? []) {
        if (isAllowedWebCapability(capability)) {
            registry.register(capability);
        }
    }
    return registry;
}

function createProvenanceCapturingExecutor(options: {
    baseExecutor: PaAgentToolExecutor;
    dependencies: PageletAgentRuntimeDependencies;
    request: PageletAgentRuntimeRunRequest;
    sourceSnapshots: Map<string, PageletAgentSourceSnapshot>;
    sourceTools: Map<string, Set<string>>;
    toolProvenance: PageletAgentToolProvenance[];
    webObservations: PageletAgentWebObservation[];
}): PaAgentToolExecutor {
    return {
        getExecutionMode: (toolName) => options.baseExecutor.getExecutionMode?.(toolName),
        execute: async (input) => {
            const result = await options.baseExecutor.execute(input);
            const sourceRecords = cloneSourceRecords(result.sourceRecords ?? []);
            if (result.outcome !== "success") {
                options.toolProvenance.push({
                    toolName: input.toolCall.name,
                    sourceRecords,
                    isError: true,
                    promptText: result.promptText,
                });
                return result;
            }

            if (input.toolCall.name === BUILTIN_WEB_SEARCH_TOOL_NAME) {
                const observationHash = await hashPageletContent(result.promptText);
                for (const record of sourceRecords) {
                    if (record.url) {
                        options.webObservations.push({ url: record.url, observationHash });
                    }
                }
            }

            if (PAGELET_VAULT_EVIDENCE_TOOL_NAMES.has(input.toolCall.name)) {
                const capturedSources = await Promise.all(sourceRecords.map(async (record) => {
                    const path = record.path;
                    if (!path) return { ok: true as const };
                    if (!isAllowed(options.dependencies.isPathAllowed, path)) {
                        return { ok: false as const };
                    }
                    if (
                        (
                            input.toolCall.name === "get_current_note_context"
                            || input.toolCall.name === "inspect_obsidian_note"
                        )
                        && path === options.request.anchor.path
                    ) {
                        return {
                            ok: true as const,
                            path,
                            snapshot: sourceSnapshotIdentity(options.request.anchor),
                        };
                    }
                    if (path !== options.request.anchor.path) {
                        let material;
                        try {
                            material = await options.dependencies.captureSourceMaterial(
                                path,
                                input.signal,
                            );
                        } catch (error) {
                            if (input.signal.aborted) throw error;
                            return { ok: false as const };
                        }
                        if (
                            !material
                            || material.path !== path
                            || !isAllowed(options.dependencies.isPathAllowed, material.path)
                        ) {
                            return { ok: false as const };
                        }
                        return {
                            ok: true as const,
                            path: material.path,
                            snapshot: sourceSnapshotIdentity(material),
                        };
                    }
                    const snapshot = await capturePageletSourceSnapshot({
                        host: options.dependencies.host,
                        path,
                        isPathAllowed: options.dependencies.isPathAllowed,
                        signal: input.signal,
                    });
                    if (
                        snapshot
                        && path === options.request.anchor.path
                        && !sameSourceSnapshot(snapshot, sourceSnapshotIdentity(options.request.anchor))
                    ) {
                        return { ok: false as const };
                    }
                    return snapshot
                        ? {
                            ok: true as const,
                            path: snapshot.path,
                            snapshot: path === options.request.anchor.path
                                ? sourceSnapshotIdentity(options.request.anchor)
                                : snapshot,
                        }
                        : { ok: false as const };
                }));
                if (capturedSources.some((captured) => !captured.ok)) {
                    const discardedResult = {
                        outcome: "recoverable_error" as const,
                        promptText: "Tool observation was discarded because a vault source changed or left the permitted scope.",
                        previewText: "Discarded a stale read-only observation.",
                        sourceRecords: [],
                        contextUsed: [],
                        metadata: {
                            outcome: "recoverable_error",
                            reason: "source_snapshot_unavailable",
                            tool: input.toolCall.name,
                        },
                    };
                    options.toolProvenance.push({
                        toolName: input.toolCall.name,
                        sourceRecords: [],
                        isError: true,
                        promptText: discardedResult.promptText,
                    });
                    return discardedResult;
                }
                for (const captured of capturedSources) {
                    if (!captured.snapshot || !captured.path) continue;
                    const existing = options.sourceSnapshots.get(captured.path);
                    if (existing && !sameSourceSnapshot(existing, captured.snapshot)) {
                        const discardedResult = {
                            outcome: "recoverable_error" as const,
                            promptText: "Tool observation was discarded because a vault source changed during the run.",
                            previewText: "Discarded a stale read-only observation.",
                            sourceRecords: [],
                            contextUsed: [],
                            metadata: {
                                outcome: "recoverable_error",
                                reason: "source_snapshot_changed",
                                tool: input.toolCall.name,
                            },
                        };
                        options.toolProvenance.push({
                            toolName: input.toolCall.name,
                            sourceRecords: [],
                            isError: true,
                            promptText: discardedResult.promptText,
                        });
                        return discardedResult;
                    }
                    options.sourceSnapshots.set(captured.path, captured.snapshot);
                    addSourceTool(options.sourceTools, captured.path, input.toolCall.name);
                }
            }
            options.toolProvenance.push({
                toolName: input.toolCall.name,
                sourceRecords,
                isError: false,
                promptText: result.promptText,
            });
            return result;
        },
    };
}

function availableAllowedToolNames(registry: CapabilityRegistry): ReadonlySet<string> {
    return new Set(
        [...PAGELET_AGENT_READ_ONLY_TOOL_ALLOWLIST]
            .filter((toolName) => registry.has(toolName)),
    );
}

function isAllowedWebCapability(capability: AgentCapability): boolean {
    return capability.name === BUILTIN_WEB_SEARCH_TOOL_NAME
        && capability.kind === "tool"
        && (capability.permission === "network-read" || capability.permission === "read-only")
        && capability.requiresConfirmation === false
        && capability.failureBehavior === "recoverable";
}

function buildPageletUserInput(request: PageletAgentRuntimeRunRequest): string {
    return [
        `Deep Discover the frozen vault anchor "${request.anchor.path}".`,
        `Trigger: ${request.triggerReason}.`,
        "Find at most one source-backed insight that is not obvious from existing links.",
        "Return natural Markdown with every cited exact vault path formatted as inline code and short evidence, or exactly NO_INSIGHT.",
    ].join("\n");
}

function buildInitialRuntimeInstruction(request: PageletAgentRuntimeRunRequest): string {
    return [
        `The immutable anchor is ${request.anchor.path}.`,
        "Call get_current_note_context before drawing any conclusion.",
        "Use only the bound read-only allowlisted tools.",
        "At least one non-anchor vault source must materially support the final finding.",
        "Treat search_memory only as a lead; verify non-anchor content with inspect_obsidian_note, search_vault_snippets, or read_note_outline before concluding.",
        "WebSearch may verify a vault-derived external fact but must not become the discovery source.",
        "The normal target is 3–5 model turns and 8–12 real tool calls; the 30-call and 180-second limits are emergency fuses, not targets.",
        "Once the anchor and one verified non-anchor source support a worthwhile finding, finalize instead of broadening the search.",
        "Cite only exact paths returned by successful content-reading tools, format each cited path as inline code, and never mention an unverified .md path.",
    ].join(" ");
}

function summarizeMetrics(
    loopResult: PageletAgentRunResult["loopResult"],
    wallTimeMs: number,
): PageletAgentRunMetrics {
    const tokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };
    let sawUsage = false;
    for (const turn of loopResult.turns) {
        for (const metric of turn.metrics) {
            const usage = asRecord(metric.usage);
            if (metric.type !== "provider_usage" || !usage) continue;
            const input = firstFinite(usage, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
            const output = firstFinite(usage, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
            const total = firstFinite(usage, ["totalTokens", "total_tokens"]);
            if (input !== undefined) tokenUsage.inputTokens += input;
            if (output !== undefined) tokenUsage.outputTokens += output;
            if (total !== undefined) tokenUsage.totalTokens += total;
            sawUsage = sawUsage || input !== undefined || output !== undefined || total !== undefined;
        }
    }
    return {
        modelTurns: loopResult.turns.length,
        toolCalls: loopResult.turns.reduce((sum, turn) => sum + turn.timing.toolCallCount, 0),
        wallTimeMs,
        ...(sawUsage ? { tokenUsage } : {}),
    };
}

function addSourceTool(map: Map<string, Set<string>>, path: string, toolName: string): void {
    const tools = map.get(path) ?? new Set<string>();
    tools.add(toolName);
    map.set(path, tools);
}

function cloneSourceRecords(records: readonly SourceRecord[]): SourceRecord[] {
    return records.map((record) => ({
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
    }));
}

function dedupeWebObservations(
    observations: readonly PageletAgentWebObservation[],
): PageletAgentWebObservation[] {
    const seen = new Set<string>();
    return observations.filter((observation) => {
        const key = `${observation.url}\u0000${observation.observationHash}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isAllowed(predicate: (path: string) => boolean, path: string): boolean {
    try {
        return predicate(path) === true;
    } catch {
        return false;
    }
}

function compareSources(left: PageletAgentSourceSnapshot, right: PageletAgentSourceSnapshot): number {
    return left.path.localeCompare(right.path);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function firstFinite(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    }
    return undefined;
}

function createRunId(): string {
    return `pagelet_deep_discover_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

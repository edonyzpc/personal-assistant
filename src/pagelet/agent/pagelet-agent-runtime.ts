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
    MemoryEvidenceRegistry,
} from "../../ai-services/pa-agent-host-tools";
import {
    PaAgentLoop,
    type PaAgentToolExecutor,
} from "../../ai-services/pa-agent-loop";
import { createAgentControlSnapshot } from "../../ai-services/pa-agent-control-policy";
import { PolicyEngine } from "../../ai-services/policy-engine";
import type { RetrievalDiagnosticEventInput } from "../../ai-services/retrieval-diagnostics";
import type { PaAgentMessage, SourceRecord } from "../../ai-services/chat-types";
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
    evaluatePageletAgentQuality,
    hasPageletContentEvidenceTool,
    resolvePageletInsightSourcePaths,
} from "./pagelet-agent-quality-gate";
import {
    PAGELET_STAGE_INSIGHT_TOOL_NAME,
    PageletRecoveryCoordinator,
} from "./pagelet-recovery-coordinator";
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
    type PageletAgentSourceMaterial,
    type PageletAgentSourceSnapshot,
    type PageletAgentToolProvenance,
    type PageletAgentWebObservation,
    type StagePageletInsightInput,
} from "./types";

export const PAGELET_AGENT_READ_ONLY_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
    "search_memory",
    "get_current_note_context",
    "search_vault_snippets",
    "inspect_obsidian_note",
    "search_vault_metadata",
    "list_recent_notes",
    "read_note_outline",
    PAGELET_STAGE_INSIGHT_TOOL_NAME,
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
    const recoveryEnabled = isPageletRetrievalFlagEnabled(dependencies, "relaxedRecovery");
    const unboundRetrievalRecorder = dependencies.host.createRetrievalDiagnosticRecorder
        ? dependencies.host.createRetrievalDiagnosticRecorder("pagelet")
        : dependencies.host.recordRetrievalDiagnostic
            ? (event: RetrievalDiagnosticEventInput) => (
                dependencies.host.recordRetrievalDiagnostic!("pagelet", event)
            )
            : undefined;
    const retrievalRecorder = unboundRetrievalRecorder
        ? (event: RetrievalDiagnosticEventInput) => unboundRetrievalRecorder({ ...event, runId })
        : undefined;
    let finalizationOutcome: "completed" | "aborted" | "deadline" | "failed" = "failed";
    let finalizationBoundaryEntered = false;
    let finalizationBoundaryTerminal = false;
    const retrievalPolicyEpoch = getPageletRetrievalPolicyEpoch(dependencies);
    const sourceSnapshots = new Map<string, PageletAgentSourceSnapshot>();
    const sourceTools = new Map<string, Set<string>>();
    const toolProvenance: PageletAgentToolProvenance[] = [];
    const webObservations: PageletAgentWebObservation[] = [];
    const recovery = new PageletRecoveryCoordinator({
        enabled: recoveryEnabled,
        anchorPath: request.anchor.path,
        policyEpoch: retrievalPolicyEpoch,
        isEnabled: () => isPageletRetrievalFlagEnabled(dependencies, "relaxedRecovery"),
        getPolicyEpoch: () => getPageletRetrievalPolicyEpoch(dependencies),
        ...(dependencies.host.onSettingsChanged
            ? {
                onPolicyChanged: (listener: () => void | Promise<void>) => (
                    dependencies.host.onSettingsChanged!(listener)
                ),
            }
            : {}),
        startedAt,
        runEpoch: runId,
        maxWallClockMs: PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS,
        finalizationReserveMs: PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS,
        recordDiagnostic: retrievalRecorder,
        now,
        executeStandard: (query, context, control) => dependencies.executeMemorySearch(
            { query },
            context,
            control,
        ),
        executeRelaxed: dependencies.executeRelaxedMemorySearch
            ? (seed, context, goal, control) => dependencies.executeRelaxedMemorySearch!(
                seed,
                context,
                goal,
                control,
            )
            : undefined,
        revalidate: dependencies.revalidateMemorySearch,
        prevalidateStaged: (input) => prevalidateStagedPageletInsightBinding({
            dependencies,
            request,
            input,
            sourceSnapshots,
            sourceTools,
        }),
        validateStaged: (input, signal, _control) => validateStagedPageletInsight({
            dependencies,
            request,
            input,
            sourceSnapshots,
            sourceTools,
            toolProvenance,
            signal,
        }),
    });
    const registry = createPageletRegistry(dependencies, request, recovery, recoveryEnabled);
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

    const memoryEvidenceRegistry = new MemoryEvidenceRegistry(async (result, signal) => {
        if (!dependencies.revalidateMemorySearch) {
            throw new Error("Pagelet Memory evidence revalidation is unavailable.");
        }
        return dependencies.revalidateMemorySearch(result, signal);
    });
    const baseExecutor = createPaAgentCapabilityToolExecutor({
        registry,
        host: dependencies.host,
        allowedToolNames,
        memoryEvidenceRegistry,
    });
    const toolExecutor = createProvenanceCapturingExecutor({
        baseExecutor,
        recovery,
        bindMemoryEpisodes: recoveryEnabled,
        dependencies,
        request,
        sourceSnapshots,
        sourceTools,
        toolProvenance,
        webObservations,
    });
    const leadDrivenPolicy = new PageletLeadDrivenPolicy({
        anchorPath: request.anchor.path,
        anchorContent: request.anchor.content,
        maxTurns: PAGELET_DEEP_DISCOVER_MAX_TURNS,
        maxToolCalls: PAGELET_DEEP_DISCOVER_MAX_TOOL_CALLS,
        maxWallClockMs: PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS,
        now,
        startedAt,
        finalizationReserveMs: PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS,
        hasStagedInsight: () => recovery.hasStagedInsight(),
        canStageInsight: recoveryEnabled,
    });
    const loop = new PaAgentLoop({
        runId,
        userInput: buildPageletUserInput(request, recoveryEnabled),
        model,
        prepareModelInput: async (input) => {
            const failClosedOnAbort = () => memoryEvidenceRegistry.failClosed();
            input.signal?.addEventListener("abort", failClosedOnAbort, { once: true });
            if (input.signal?.aborted) failClosedOnAbort();
            try {
                const memoryCurrent = await memoryEvidenceRegistry.prepareTranscript(
                    input.transcript,
                    input.signal,
                );
                leadDrivenPolicy.reconcileMemoryCurrentness(memoryCurrent);
                return {
                    ...input,
                    transcript: await recovery.prepareTranscript(memoryCurrent, input.signal),
                };
            } finally {
                input.signal?.removeEventListener("abort", failClosedOnAbort);
            }
        },
        toolExecutor,
        hostPolicy: leadDrivenPolicy,
        signal: request.signal,
        now,
        maxTurns: PAGELET_DEEP_DISCOVER_MAX_TURNS,
        maxToolCalls: PAGELET_DEEP_DISCOVER_MAX_TOOL_CALLS,
        maxWallClockMs: PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS,
        finalizationReserveMs: PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS,
        ...(retrievalRecorder
            ? {
                onFinalizationReserve: (event: {
                    stage: "entered" | "completed" | "aborted" | "failed" | "exhausted";
                    remainingMs: number;
                }) => {
                    if (event.stage === "entered") finalizationBoundaryEntered = true;
                    else finalizationBoundaryTerminal = true;
                    retrievalRecorder({
                        phase: "finalization_reserve",
                        outcome: event.stage === "entered"
                            ? "started"
                            : event.stage === "exhausted" ? "deadline" : event.stage,
                        reason: event.stage === "exhausted"
                            ? "reserve_exhausted"
                            : event.stage === "aborted"
                                ? "reserve_aborted"
                                : event.stage === "failed" ? "reserve_failed" : undefined,
                        metrics: { remainingMs: event.remainingMs },
                    });
                },
            }
            : {}),
        maxObservationChars: PAGELET_DEEP_DISCOVER_MAX_OBSERVATION_CHARS,
        toolExecutionMode: "hybrid",
        initialRuntimeInstruction: buildInitialRuntimeInstruction(request, recoveryEnabled),
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
    try {
        const loopResult = await loop.run();
        let memoryDeliveryGated = false;
        if (!request.signal?.aborted) {
            const memoryCurrent = await memoryEvidenceRegistry.prepareTranscript(
                loopResult.transcript,
                request.signal,
            );
            leadDrivenPolicy.reconcileMemoryCurrentness(memoryCurrent);
            loopResult.transcript = await recovery.prepareTranscript(
                memoryCurrent,
                request.signal,
            );
            memoryDeliveryGated = true;
        }
        reconcilePageletMemoryEvidence(
            loopResult.transcript,
            toolProvenance,
            sourceSnapshots,
            sourceTools,
            memoryDeliveryGated,
        );
        const lastTurn = loopResult.turns.length > 0
            ? loopResult.turns[loopResult.turns.length - 1]
            : undefined;
        const terminalResolution = leadDrivenPolicy.resolveRunTerminal(lastTurn);
        loopResult.committedFinalText = terminalResolution.finalText;
        if (terminalResolution.protocolFailure) {
            loopResult.status = loopResult.status === "aborted" || loopResult.status === "error"
                ? loopResult.status
                : "incomplete";
            loopResult.endPayload = createExactLeadProtocolEndPayload(loopResult.endPayload);
        }
        const finalText = terminalResolution.finalText;
        finalizationOutcome = terminalResolution.protocolFailure
            ? "failed"
            : loopResult.status === "aborted"
            ? "aborted"
            : now() >= startedAt + PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS
                ? "deadline"
                : loopResult.status === "error" ? "failed" : "completed";
        const recoverySnapshot = recovery.snapshot(finalText);
        const metrics = summarizeMetrics(loopResult, Math.max(0, now() - startedAt));

        return {
            loopResult,
            finalText,
            anchor: request.anchor,
            sourceSnapshots: [...sourceSnapshots.values()].sort(compareSources),
            sourceTools: new Map([...sourceTools.entries()].map(([path, tools]) => [
                path,
                new Set(tools) as ReadonlySet<string>,
            ])),
            toolProvenance,
            webObservations: dedupeWebObservations(webObservations),
            metrics,
            insightDrafts: terminalResolution.protocolFailure
                ? recoverySnapshot.drafts.filter((draft) => draft.origin === "staged")
                : recoveryEnabled
                ? recoverySnapshot.drafts
                : finalText && finalText !== "NO_INSIGHT"
                    ? [{ body: finalText, origin: "terminal", declaredSourceIds: [] }]
                    : [],
            recovery: recoverySnapshot.diagnostics,
        };
    } finally {
        try {
            const hardAt = startedAt + PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS;
            const observedFinalizationOutcome = request.signal?.aborted
                ? "aborted"
                : now() >= hardAt ? "deadline" : finalizationOutcome;
            if (!finalizationBoundaryTerminal) {
                retrievalRecorder?.({
                    phase: "finalization_reserve",
                    outcome: finalizationBoundaryEntered ? observedFinalizationOutcome : "skipped",
                    reason: !finalizationBoundaryEntered
                        ? "reserve_not_entered"
                        : observedFinalizationOutcome === "deadline"
                            ? "hard_deadline"
                            : observedFinalizationOutcome === "aborted"
                                ? "reserve_aborted"
                                : observedFinalizationOutcome === "failed" ? "reserve_failed" : undefined,
                    metrics: { remainingMs: Math.max(0, hardAt - now()) },
                });
            }
        } catch {
            // Diagnostics are observational only.
        }
        memoryEvidenceRegistry.clear();
        recovery.clear();
    }
}

function prevalidateStagedPageletInsightBinding(options: {
    dependencies: PageletAgentRuntimeDependencies;
    request: PageletAgentRuntimeRunRequest;
    input: StagePageletInsightInput;
    sourceSnapshots: ReadonlyMap<string, PageletAgentSourceSnapshot>;
    sourceTools: ReadonlyMap<string, ReadonlySet<string>>;
}): void {
    const resolved = resolvePageletInsightSourcePaths(
        options.input.insightMarkdown,
        [...options.sourceSnapshots.keys()],
    );
    const declared = new Set(options.input.sourceIds);
    if (
        resolved.hasUngroundedPath
        || !declared.has(options.request.anchor.path)
        || resolved.paths.length !== declared.size
        || resolved.paths.some((path) => !declared.has(path))
        || [...declared].some((path) => !isAllowed(options.dependencies.isPathAllowed, path))
    ) {
        throw new Error(
            "sourceIds must exactly equal the allowed successful paths cited by insightMarkdown, including the frozen anchor.",
        );
    }
    for (const path of options.input.unresolvedLead.supportingSourceIds) {
        if (
            path === options.request.anchor.path
            || !isAllowed(options.dependencies.isPathAllowed, path)
            || !options.sourceSnapshots.has(path)
            || !hasPageletContentEvidenceTool(options.sourceTools, path)
        ) {
            throw new Error(
                "unresolvedLead.supportingSourceIds must contain only allowed successful non-anchor content-read paths.",
            );
        }
    }
}

async function validateStagedPageletInsight(options: {
    dependencies: PageletAgentRuntimeDependencies;
    request: PageletAgentRuntimeRunRequest;
    input: StagePageletInsightInput;
    sourceSnapshots: Map<string, PageletAgentSourceSnapshot>;
    sourceTools: Map<string, Set<string>>;
    toolProvenance: PageletAgentToolProvenance[];
    signal?: AbortSignal;
}): Promise<{
    accepted: boolean;
    rejection?: "first" | "lead";
    verifiedSourceIds?: readonly string[];
    verifiedLeadSourceIds?: readonly string[];
}> {
    if (options.signal?.aborted) return { accepted: false, rejection: "first" };
    const declared = new Set(options.input.sourceIds);
    if (
        !declared.has(options.request.anchor.path)
        || [...declared].some((path) => !isAllowed(options.dependencies.isPathAllowed, path))
    ) return { accepted: false, rejection: "first" };

    const resolved = resolvePageletInsightSourcePaths(
        options.input.insightMarkdown,
        [...options.sourceSnapshots.keys()],
    );
    if (resolved.hasUngroundedPath) return { accepted: false, rejection: "first" };
    const stagedSourceSnapshots: PageletAgentSourceSnapshot[] = [];
    const sourceMaterials = new Map<string, PageletAgentSourceMaterial>();
    for (const path of resolved.paths) {
        const snapshot = options.sourceSnapshots.get(path);
        if (!snapshot) return { accepted: false, rejection: "first" };
        stagedSourceSnapshots.push(snapshot);
        if (options.signal?.aborted) return { accepted: false, rejection: "first" };
        if (snapshot.path === options.request.anchor.path) {
            sourceMaterials.set(snapshot.path, { ...options.request.anchor });
            continue;
        }
        const material = await options.dependencies.captureSourceMaterial(
            snapshot.path,
            options.signal,
        );
        if (!material || !sameSourceSnapshot(snapshot, material)) {
            return { accepted: false, rejection: "first" };
        }
        sourceMaterials.set(snapshot.path, material);
    }

    const quality = await evaluatePageletAgentQuality({
        run: {
            finalText: options.input.insightMarkdown,
            anchor: options.request.anchor,
            sourceSnapshots: stagedSourceSnapshots,
            sourceTools: options.sourceTools,
            toolProvenance: options.toolProvenance,
        },
        body: options.input.insightMarkdown,
        sourceMaterials,
        readCurrentSourceSnapshot: async (path, signal) => {
            if (path === options.request.anchor.path) {
                const material = await options.dependencies.captureSourceMaterial(path, signal);
                return material ? sourceSnapshotIdentity(material) : null;
            }
            const material = await options.dependencies.captureSourceMaterial(path, signal);
            return material ? sourceSnapshotIdentity(material) : null;
        },
        isPathAllowed: options.dependencies.isPathAllowed,
        signal: options.signal,
    });
    if (!quality.accepted) return { accepted: false, rejection: "first" };
    const verified = quality.sources.map((source) => source.path);
    if (
        verified.length !== declared.size
        || verified.some((path) => !declared.has(path))
    ) return { accepted: false, rejection: "first" };
    const verifiedLeadSourceIds: string[] = [];
    for (const path of options.input.unresolvedLead.supportingSourceIds) {
        if (
            path === options.request.anchor.path
            || !isAllowed(options.dependencies.isPathAllowed, path)
            || !hasPageletContentEvidenceTool(options.sourceTools, path)
        ) return {
            accepted: false,
            rejection: "lead",
            verifiedSourceIds: verified,
        };
        const snapshot = options.sourceSnapshots.get(path);
        if (!snapshot || options.signal?.aborted) return {
            accepted: false,
            rejection: "lead",
            verifiedSourceIds: verified,
        };
        const material = await options.dependencies.captureSourceMaterial(
            path,
            options.signal,
        );
        if (
            !material
            || material.path !== path
            || !isAllowed(options.dependencies.isPathAllowed, material.path)
            || !sameSourceSnapshot(snapshot, material)
        ) return {
            accepted: false,
            rejection: "lead",
            verifiedSourceIds: verified,
        };
        verifiedLeadSourceIds.push(path);
    }
    return {
        accepted: true,
        verifiedSourceIds: verified,
        verifiedLeadSourceIds,
    };
}

function reconcilePageletMemoryEvidence(
    transcript: readonly PaAgentMessage[],
    toolProvenance: PageletAgentToolProvenance[],
    sourceSnapshots: Map<string, PageletAgentSourceSnapshot>,
    sourceTools: Map<string, Set<string>>,
    deliveryGated: boolean,
): void {
    const memoryMessages = deliveryGated
        ? transcript.filter((message): message is Extract<PaAgentMessage, { role: "toolResult" }> => (
            message.role === "toolResult" && message.toolName === "search_memory"
        ))
        : [];
    const finalMemoryPaths = new Set(memoryMessages.flatMap((message) => (
        message.content.sourceRecords ?? []
    ).flatMap((record) => record.path ? [record.path] : [])));
    let memoryIndex = 0;
    for (const provenance of toolProvenance) {
        if (provenance.toolName !== "search_memory") continue;
        const message = memoryMessages[memoryIndex++];
        if (!message) {
            provenance.sourceRecords = [];
            provenance.promptText = "Memory evidence is currently unavailable.";
            provenance.isError = true;
            continue;
        }
        provenance.sourceRecords = cloneSourceRecords(message.content.sourceRecords ?? []);
        provenance.promptText = message.content.promptText;
        provenance.isError = message.isError;
    }
    for (const [path, tools] of sourceTools) {
        if (tools.has("search_memory") && !finalMemoryPaths.has(path)) {
            tools.delete("search_memory");
        }
        if (tools.size === 0) {
            sourceTools.delete(path);
            sourceSnapshots.delete(path);
        }
    }
}

function createPageletRegistry(
    dependencies: PageletAgentRuntimeDependencies,
    request: PageletAgentRuntimeRunRequest,
    recovery: PageletRecoveryCoordinator,
    recoveryEnabled: boolean,
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
        createSearchMemoryTool((input, context) => recovery.executeMemorySearch(
            input.query,
            context,
        )),
        createAnchorBoundCurrentNoteTool(request.anchor),
        createSearchVaultMetadataTool(pathFilter),
        createListRecentNotesTool(pathFilter),
        createReadNoteOutlineTool(pathFilter),
        createAnchorBoundInspectNoteTool(request.anchor, dependencies.isPathAllowed),
        createSearchVaultSnippetsTool(pathFilter),
    ], { providerId: "pagelet-deep-discover-core" }));
    if (recoveryEnabled) registry.register(recovery.getStageCapability());

    for (const capability of dependencies.webCapabilities ?? []) {
        if (isAllowedWebCapability(capability)) {
            registry.register(capability);
        }
    }
    return registry;
}

function createProvenanceCapturingExecutor(options: {
    baseExecutor: PaAgentToolExecutor;
    recovery: PageletRecoveryCoordinator;
    bindMemoryEpisodes: boolean;
    dependencies: PageletAgentRuntimeDependencies;
    request: PageletAgentRuntimeRunRequest;
    sourceSnapshots: Map<string, PageletAgentSourceSnapshot>;
    sourceTools: Map<string, Set<string>>;
    toolProvenance: PageletAgentToolProvenance[];
    webObservations: PageletAgentWebObservation[];
}): PaAgentToolExecutor {
    return {
        getCanonicalToolCallKey: (toolCall, context) => (
            options.baseExecutor.getCanonicalToolCallKey?.(toolCall, context)
        ),
        getExecutionMode: (toolName) => options.bindMemoryEpisodes && toolName === "search_memory"
            ? "sequential"
            : options.baseExecutor.getExecutionMode?.(toolName),
        execute: async (input) => {
            const executeBase = () => options.baseExecutor.execute(input);
            const result = options.bindMemoryEpisodes && input.toolCall.name === "search_memory"
                ? await options.recovery.withMemorySearchToolCall(input.toolCall.id, executeBase)
                : await executeBase();
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

function buildPageletUserInput(
    request: PageletAgentRuntimeRunRequest,
    recoveryEnabled: boolean,
): string {
    return [
        `Deep Discover the frozen vault anchor "${request.anchor.path}".`,
        `Trigger: ${request.triggerReason}.`,
        recoveryEnabled
            ? "Find zero, one, or at most two independently source-backed insights that are not obvious from existing links; two is never a quota. A terminal response may contain at most one insight: to produce two, stage the complete first insight and return only the distinct second insight as terminal Markdown."
            : "Find at most one source-backed insight that is not obvious from existing links.",
        "Return natural Markdown with every cited exact vault path formatted as inline code and short evidence, or exactly NO_INSIGHT.",
    ].join("\n");
}

function buildInitialRuntimeInstruction(
    request: PageletAgentRuntimeRunRequest,
    recoveryEnabled: boolean,
): string {
    return [
        `The immutable anchor is ${request.anchor.path}.`,
        "Call get_current_note_context before drawing any conclusion.",
        "Use only the bound read-only allowlisted tools.",
        "At least one non-anchor vault source must materially support the final finding.",
        "Treat search_memory only as a lead; verify non-anchor content with inspect_obsidian_note, search_vault_snippets, or read_note_outline before concluding.",
        "WebSearch may verify a vault-derived external fact but must not become the discovery source.",
        "The normal target is 3–5 model turns and 8–12 real tool calls; the 30-call and 180-second limits are emergency fuses, not targets.",
        "Once the anchor and one verified non-anchor source support a worthwhile finding, normally finalize instead of broadening the search.",
        ...(recoveryEnabled ? [
            "Normally return one strongest natural-Markdown insight or exactly NO_INSIGHT.",
            "Exception: when the frozen anchor already names a concrete independent second lead and the smallest current non-anchor source set for that lead has already been content-read, evaluate that already-read lead before finalizing; do not open another search branch.",
            "If both already-read findings independently clear the grounding, currentness, distinctness, novelty, and value gates, stage the complete first and return only the distinct second as terminal Markdown. If the second is unsupported, unread, a rewrite, or adds no value, keep only the first or reject the unsupported candidate.",
            "Every terminal response may contain at most one insight; never bundle two findings into one Markdown response.",
            "Only when one first insight is already complete and one concrete distinct second finding or lead exists, call stage_pagelet_insight once with sourceIds for the first insight only; the lead's supportingSourceIds may be separate current content-read evidence.",
            "If that distinct second insight is already fully supported, set requestRelaxedRecovery=false, stage the first, and return only the second as terminal Markdown; otherwise the Host owns any eligible recovery query and the next evidence-complete turn must return only the distinct second insight or exactly NO_INSIGHT.",
            "Never combine, restate, summarize, or paraphrase the pinned first insight in insightMarkdown or the terminal answer, and never search merely to fill a second slot.",
        ] : []),
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

function createExactLeadProtocolEndPayload(
    current: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (current?.reason === "pagelet_stage_shape_protocol_incomplete") {
        return current;
    }
    const diagnostics = Array.isArray(current?.diagnostics)
        ? [...current.diagnostics]
        : [];
    if (!diagnostics.some((diagnostic) => (
        diagnostic
        && typeof diagnostic === "object"
        && (diagnostic as Record<string, unknown>).type
            === "pagelet_exact_lead_protocol_incomplete"
    ))) {
        diagnostics.push({
            type: "pagelet_exact_lead_protocol_incomplete",
            message: "NO_INSIGHT was rejected because the exact-lead verification protocol remained incomplete.",
        });
    }
    return {
        ...current,
        reason: "pagelet_exact_lead_protocol_incomplete",
        diagnostics,
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
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function isPageletRetrievalFlagEnabled(
    dependencies: PageletAgentRuntimeDependencies,
    flag: "strictReranker" | "graphPpr" | "relaxedRecovery",
): boolean {
    const flags = dependencies.host.getRetrievalOptimizationFlags?.()
        ?? dependencies.host.settings.retrievalOptimizationFlags;
    return flags?.[flag] === true;
}

function getPageletRetrievalPolicyEpoch(
    dependencies: PageletAgentRuntimeDependencies,
): string {
    const liveEpoch = dependencies.host.getRetrievalOptimizationEpoch?.();
    if (liveEpoch) return liveEpoch;
    const flags = dependencies.host.getRetrievalOptimizationFlags?.()
        ?? dependencies.host.settings.retrievalOptimizationFlags;
    return [
        "legacy-retrieval-flags",
        flags?.lexicalProfile === true ? "1" : "0",
        flags?.strictReranker === true ? "1" : "0",
        flags?.graphPpr === true ? "1" : "0",
        flags?.relaxedRecovery === true ? "1" : "0",
    ].join(":");
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

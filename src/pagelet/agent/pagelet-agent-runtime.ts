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
import { createProviderRequestScope } from "../../ai-services/obsidian-fetch";
import { resolveB125RetrievalOptimizationFlags } from "../../retrieval-optimization-platform-policy";
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
    classifyPageletInsightSourceSupport,
    evaluatePageletAgentQuality,
    hasPageletContentEvidenceTool,
    resolvePageletInsightSourcePaths,
    type PageletInsightSourceSupportFailure,
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
    isPageletNoInsightTerminal,
    type PageletAgentRunMetrics,
    type PageletAgentQualityRejectReason,
    type PageletAgentRecoveryDiagnostics,
    type PageletAgentRunResult,
    type PageletAgentRuntimeCompletion,
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
    const providerRequestScope = createProviderRequestScope();
    const memoryPreparationOwnerSignal = request.signal;
    const recoveryEnabled = isPageletRetrievalFlagEnabled(dependencies, "relaxedRecovery");
    const unboundRetrievalRecorder = dependencies.host.createRetrievalDiagnosticRecorder
        ? dependencies.host.createRetrievalDiagnosticRecorder("pagelet")
        : dependencies.host.recordRetrievalDiagnostic
            ? (event: RetrievalDiagnosticEventInput) => (
                dependencies.host.recordRetrievalDiagnostic!("pagelet", event)
            )
            : undefined;
    const retrievalRecorder = unboundRetrievalRecorder
        ? (event: RetrievalDiagnosticEventInput) => unboundRetrievalRecorder({
            ...event,
            runId,
            ...(event.phase === "finalization_reserve"
                ? {
                    metrics: {
                        ...event.metrics,
                        configuredReserveMs: PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS,
                    },
                }
                : {}),
        })
        : undefined;
    let finalizationOutcome: "completed" | "aborted" | "deadline" | "failed" = "failed";
    let finalizationBoundaryEntered = false;
    let finalizationBoundaryTerminal = false;
    const retrievalPolicyEpoch = getPageletRetrievalPolicyEpoch(dependencies);
    const sourceSnapshots = new Map<string, PageletAgentSourceSnapshot>();
    const sourceMaterials = new Map<string, PageletAgentSourceMaterial>();
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
            { ...control, providerRequestScope, memoryPreparationOwnerSignal },
        ),
        executeRelaxed: dependencies.executeRelaxedMemorySearch
            ? (seed, context, goal, control) => dependencies.executeRelaxedMemorySearch!(
                seed,
                context,
                goal,
                { ...control, providerRequestScope, memoryPreparationOwnerSignal },
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
        providerRequestScope,
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
        providerRequestScope,
    });
    const toolExecutor = createProvenanceCapturingExecutor({
        baseExecutor,
        recovery,
        bindMemoryEpisodes: recoveryEnabled,
        dependencies,
        request,
        sourceSnapshots,
        sourceMaterials,
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
        hasPendingFirstInsight: () => recovery.hasPendingFirstInsight(),
        bindPendingFirstInsight: (candidate) => recovery.bindPendingFirstInsight(candidate),
        clearPendingFirstInsight: () => recovery.clearPendingFirstInsight(),
        canStageInsight: recoveryEnabled,
        validateTerminalSourceSupport: (body) => validateTerminalSourceSupport({
            body,
            request,
            sourceSnapshots,
            sourceMaterials,
            sourceTools,
        }),
    });
    const initialBlockedToolNames = new Set<string>();
    const initialBlockedReasons: Record<string, string> = {};
    if (allowedToolNames.has(BUILTIN_WEB_SEARCH_TOOL_NAME)) {
        initialBlockedToolNames.add(BUILTIN_WEB_SEARCH_TOOL_NAME);
        initialBlockedReasons[BUILTIN_WEB_SEARCH_TOOL_NAME] =
            "WebSearch unlocks only after a vault observation reaches the model.";
    }
    if (recoveryEnabled && allowedToolNames.has(PAGELET_STAGE_INSIGHT_TOOL_NAME)) {
        initialBlockedToolNames.add(PAGELET_STAGE_INSIGHT_TOOL_NAME);
        initialBlockedReasons[PAGELET_STAGE_INSIGHT_TOOL_NAME] =
            "Pagelet staging unlocks only after the Host accepts and pins a first insight.";
    }
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
        providerResponseDelivery: dependencies.providerResponseDelivery,
        ...(retrievalRecorder
            ? {
                onFinalizationReserve: (event: {
                    stage: "entered" | "completed" | "aborted" | "failed" | "exhausted" | "overrun";
                    remainingMs: number;
                }) => {
                    if (event.stage === "entered") finalizationBoundaryEntered = true;
                    else finalizationBoundaryTerminal = true;
                    retrievalRecorder({
                        phase: "finalization_reserve",
                        outcome: event.stage === "entered"
                            ? "started"
                            : event.stage === "exhausted" || event.stage === "overrun" ? "deadline" : event.stage,
                        reason: event.stage === "overrun"
                            ? "reserve_overrun"
                            : event.stage === "exhausted"
                                ? "reserve_exhausted"
                            : event.stage === "aborted"
                                ? "reserve_aborted"
                                : event.stage === "failed" ? "reserve_failed" : undefined,
                        metrics: {
                            remainingMs: event.remainingMs,
                            configuredReserveMs: PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS,
                        },
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
            ...(initialBlockedToolNames.size > 0
                ? { blockedToolNames: initialBlockedToolNames }
                : {}),
            blockedReasons: initialBlockedReasons,
            diagnostics: [
                ...(allowedToolNames.has(BUILTIN_WEB_SEARCH_TOOL_NAME)
                    ? [{
                        type: "pagelet_verification_only_web",
                        message: "Deep Discover begins with WebSearch blocked until vault evidence is available.",
                    }]
                    : []),
                ...(recoveryEnabled && allowedToolNames.has(PAGELET_STAGE_INSIGHT_TOOL_NAME)
                    ? [{
                        type: "pagelet_stage_locked_until_pending_first",
                        message: "Pagelet staging is hidden until the Host accepts a first insight.",
                    }]
                    : []),
            ],
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
        const aborted = loopResult.status === "aborted" || request.signal?.aborted === true;
        if (aborted) {
            leadDrivenPolicy.discardPendingOutput();
            recovery.discardOutput();
        }
        const lastTurn = loopResult.turns.length > 0
            ? loopResult.turns[loopResult.turns.length - 1]
            : undefined;
        const terminalResolution = aborted
            ? { finalText: "", protocolFailure: null }
            : leadDrivenPolicy.resolveRunTerminal(lastTurn);
        loopResult.committedFinalText = terminalResolution.finalText;
        if (terminalResolution.protocolFailure) {
            loopResult.status = loopResult.status === "aborted" || loopResult.status === "error"
                ? loopResult.status
                : "incomplete";
            loopResult.endPayload = createPageletProtocolFailureEndPayload(
                loopResult.endPayload,
                terminalResolution.protocolFailure,
            );
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
        const insightDrafts = terminalResolution.protocolFailure
            ? recoverySnapshot.drafts.filter((draft) => draft.origin === "staged")
            : recoveryEnabled
            ? recoverySnapshot.drafts
            : finalText && finalText !== "NO_INSIGHT"
                ? [{ body: finalText, origin: "terminal" as const, declaredSourceIds: [] }]
                : [];
        const runtimeCompletion = summarizeRuntimeCompletion({
            loopResult,
            finalText,
            insightDraftCount: insightDrafts.length,
            sourcePaths: [...sourceSnapshots.keys()],
            anchorPath: request.anchor.path,
            emptyFinalAnswerRetryCount: leadDrivenPolicy.getEmptyFinalAnswerRetryCount(),
            recoveryDiagnostics: recoverySnapshot.diagnostics,
        });

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
            runtimeCompletion,
            insightDrafts,
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
                    metrics: {
                        remainingMs: Math.max(0, hardAt - now()),
                        configuredReserveMs: PAGELET_DEEP_DISCOVER_FINALIZATION_RESERVE_MS,
                    },
                });
            }
        } catch {
            // Diagnostics are observational only.
        }
        memoryEvidenceRegistry.clear();
        recovery.clear();
    }
}

function validateTerminalSourceSupport(options: {
    body: string;
    request: PageletAgentRuntimeRunRequest;
    sourceSnapshots: ReadonlyMap<string, PageletAgentSourceSnapshot>;
    sourceMaterials: ReadonlyMap<string, PageletAgentSourceMaterial>;
    sourceTools: ReadonlyMap<string, ReadonlySet<string>>;
}): PageletInsightSourceSupportFailure | null {
    const resolved = resolvePageletInsightSourcePaths(
        options.body,
        [...options.sourceSnapshots.keys()],
    );
    if (resolved.hasUngroundedPath) return "stale-source";
    const citedPaths = new Set(resolved.paths);
    if (
        !citedPaths.has(options.request.anchor.path)
        || ![...citedPaths].some((path) => path !== options.request.anchor.path)
    ) return "missing-content-tool";
    return classifyPageletInsightSourceSupport({
        body: options.body,
        anchorPath: options.request.anchor.path,
        citedPaths,
        successfulSources: options.sourceSnapshots,
        sourceMaterials: options.sourceMaterials,
        sourceTools: options.sourceTools,
    });
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
    subreason?: PageletAgentQualityRejectReason | "lead" | "aborted";
    verifiedSourceIds?: readonly string[];
    verifiedLeadSourceIds?: readonly string[];
}> {
    if (options.signal?.aborted) {
        return { accepted: false, rejection: "first", subreason: "aborted" };
    }
    const declared = new Set(options.input.sourceIds);
    if (
        !declared.has(options.request.anchor.path)
        || [...declared].some((path) => !isAllowed(options.dependencies.isPathAllowed, path))
    ) return {
        accepted: false,
        rejection: "first",
        subreason: "insufficient-vault-sources",
    };

    const resolved = resolvePageletInsightSourcePaths(
        options.input.insightMarkdown,
        [...options.sourceSnapshots.keys()],
    );
    if (resolved.hasUngroundedPath) {
        return { accepted: false, rejection: "first", subreason: "ungrounded-path" };
    }
    const stagedSourceSnapshots: PageletAgentSourceSnapshot[] = [];
    const sourceMaterials = new Map<string, PageletAgentSourceMaterial>();
    for (const path of resolved.paths) {
        const snapshot = options.sourceSnapshots.get(path);
        if (!snapshot) {
            return { accepted: false, rejection: "first", subreason: "stale-source" };
        }
        stagedSourceSnapshots.push(snapshot);
        if (options.signal?.aborted) {
            return { accepted: false, rejection: "first", subreason: "aborted" };
        }
        if (snapshot.path === options.request.anchor.path) {
            sourceMaterials.set(snapshot.path, { ...options.request.anchor });
            continue;
        }
        const material = await options.dependencies.captureSourceMaterial(
            snapshot.path,
            options.signal,
        );
        if (!material || !sameSourceSnapshot(snapshot, material)) {
            return { accepted: false, rejection: "first", subreason: "stale-source" };
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
    if (!quality.accepted) {
        return {
            accepted: false,
            rejection: "first",
            subreason: quality.reason,
        };
    }
    const verified = quality.sources.map((source) => source.path);
    if (
        verified.length !== declared.size
        || verified.some((path) => !declared.has(path))
    ) return {
        accepted: false,
        rejection: "first",
        subreason: "insufficient-vault-sources",
    };
    const verifiedLeadSourceIds: string[] = [];
    for (const path of options.input.unresolvedLead.supportingSourceIds) {
        if (
            path === options.request.anchor.path
            || !isAllowed(options.dependencies.isPathAllowed, path)
            || !hasPageletContentEvidenceTool(options.sourceTools, path)
        ) return {
            accepted: false,
            rejection: "lead",
            subreason: "lead",
            verifiedSourceIds: verified,
        };
        const snapshot = options.sourceSnapshots.get(path);
        if (!snapshot || options.signal?.aborted) return {
            accepted: false,
            rejection: "lead",
            subreason: options.signal?.aborted ? "aborted" : "lead",
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
            subreason: "lead",
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
    sourceMaterials: Map<string, PageletAgentSourceMaterial>;
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
                            material: { ...options.request.anchor },
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
                            material,
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
                            material: path === options.request.anchor.path
                                ? { ...options.request.anchor }
                                : undefined,
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
                    if (captured.material) {
                        options.sourceMaterials.set(captured.path, captured.material);
                    }
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
            ? "Find zero, one, or at most two independently source-backed insights that are not obvious from existing links; two is never a quota. First return the strongest complete candidate as one natural-Markdown terminal. Only if the Host validates and pins it will a later stage-only invitation appear; then submit unresolvedLead only and return only the distinct second insight as terminal Markdown."
            : "Find at most one source-backed insight that is not obvious from existing links.",
        `Return natural Markdown that cites both the frozen anchor ${JSON.stringify(request.anchor.path)} and at least one successful non-anchor content-reading path, with every cited exact vault path formatted as inline code and immediately followed on the same line by one short source-specific fact or phrase using wording present in that source, or return exactly NO_INSIGHT.`,
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
            "First return the strongest complete candidate as natural Markdown so the Host can apply evidence, citation, per-source support, quality, and currentness gates. Do not call stage_pagelet_insight during ordinary discovery or tool turns.",
            "Only after the Host explicitly continues with a stage-only invitation may you call stage_pagelet_insight once, with unresolvedLead only; the Host already owns the first body and source IDs. Never submit or rewrite the first insight in that call.",
            "After that invitation, return only the distinct second as terminal Markdown. If the second is unsupported, unread, a rewrite, or adds no value, keep only the first or reject the unsupported candidate.",
            "Every terminal response may contain at most one insight; never bundle two findings into one Markdown response.",
            "If that distinct second insight is already fully supported after the Host invitation, set requestRelaxedRecovery=false, submit unresolvedLead, and return only the second as terminal Markdown; otherwise the Host owns any eligible recovery query and the next evidence-complete turn must return only the distinct second insight or exactly NO_INSIGHT.",
            "Never combine, restate, summarize, or paraphrase the pinned first insight in the stage call or terminal answer, and never search merely to fill a second slot.",
        ] : []),
        `Every non-NO_INSIGHT finding must cite both the frozen anchor ${JSON.stringify(request.anchor.path)} and at least one successful non-anchor content-reading path.`,
        "Cite only exact paths returned by successful content-reading tools, format each cited path as inline code, and never mention an unverified .md path.",
        "On the same line, immediately after every cited path, include one short source-specific fact or phrase using wording present in that source; a path-only citation is not evidence.",
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

function summarizeRuntimeCompletion(options: {
    loopResult: PageletAgentRunResult["loopResult"];
    finalText: string;
    insightDraftCount: number;
    sourcePaths: readonly string[];
    anchorPath: string;
    emptyFinalAnswerRetryCount: 0 | 1;
    recoveryDiagnostics: PageletAgentRecoveryDiagnostics;
}): PageletAgentRuntimeCompletion {
    const lastTurn = options.loopResult.turns.at(-1);
    const diagnosticTypes = new Set<string>();
    for (const turn of options.loopResult.turns) {
        for (const diagnostic of turn.diagnostics) {
            const type = safeRuntimeCode(diagnostic.type);
            if (type) diagnosticTypes.add(type);
        }
    }
    const endDiagnostics = options.loopResult.endPayload?.diagnostics;
    if (Array.isArray(endDiagnostics)) {
        for (const diagnostic of endDiagnostics) {
            if (!diagnostic || typeof diagnostic !== "object") continue;
            const type = safeRuntimeCode((diagnostic as Record<string, unknown>).type);
            if (type) diagnosticTypes.add(type);
        }
    }
    if (options.recoveryDiagnostics.stageValidationSubreason) {
        diagnosticTypes.add(
            `pagelet_stage_validation_${options.recoveryDiagnostics.stageValidationSubreason.replace(/-/gu, "_")}`,
        );
    }
    const finalText = options.finalText.trim();
    const finalTextState = finalText.length === 0
        ? "empty" as const
        : isPageletNoInsightTerminal(finalText)
        ? "no-insight" as const
        : "candidate" as const;
    const citationCoverage = summarizeTerminalCitationCoverage(
        finalText,
        options.sourcePaths,
        options.anchorPath,
    );
    return Object.freeze({
        loopStatus: options.loopResult.status,
        endReason: safeRuntimeCode(options.loopResult.endPayload?.reason),
        diagnosticTypes: Object.freeze([...diagnosticTypes].sort(compareCodePoint)),
        lastTurnStatus: lastTurn?.status ?? null,
        providerStopReason: safeRuntimeCode(
            lastTurn?.assistantMessage.role === "assistant"
                ? lastTurn.assistantMessage.stopReason
                : undefined,
        ),
        finalTextState,
        citationCoverage,
        turnCount: options.loopResult.turns.length,
        toolCallCount: options.loopResult.turns.reduce(
            (sum, turn) => sum + turn.timing.toolCallCount,
            0,
        ),
        insightDraftCount: options.insightDraftCount,
        emptyFinalAnswerRetryCount: options.emptyFinalAnswerRetryCount,
    });
}

function summarizeTerminalCitationCoverage(
    finalText: string,
    sourcePaths: readonly string[],
    anchorPath: string,
): PageletAgentRuntimeCompletion["citationCoverage"] {
    if (!finalText || isPageletNoInsightTerminal(finalText)) return "not-applicable";
    const resolved = resolvePageletInsightSourcePaths(finalText, sourcePaths);
    if (resolved.hasUngroundedPath) return "ungrounded";
    if (!resolved.paths.includes(anchorPath)) return "missing-anchor";
    if (!resolved.paths.some((path) => path !== anchorPath)) return "missing-non-anchor";
    return "complete";
}

function safeRuntimeCode(value: unknown): string | null {
    return typeof value === "string" && /^[a-z0-9_-]{1,96}$/u.test(value)
        ? value
        : null;
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function createPageletProtocolFailureEndPayload(
    current: Record<string, unknown> | undefined,
    failure:
        | "stage-shape"
        | "exact-lead"
        | "terminal-evidence"
        | "terminal-source-support"
        | "citation",
): Record<string, unknown> {
    const definitions = {
        "stage-shape": {
            reason: "pagelet_stage_shape_protocol_incomplete",
            diagnosticType: "pagelet_stage_shape_protocol_incomplete",
            message: "The one corrected Pagelet staging attempt did not produce a verified staged insight.",
        },
        "exact-lead": {
            reason: "pagelet_exact_lead_protocol_incomplete",
            diagnosticType: "pagelet_exact_lead_protocol_incomplete",
            message: "NO_INSIGHT was rejected because the exact-lead verification protocol remained incomplete.",
        },
        "terminal-evidence": {
            reason: "pagelet_terminal_evidence_protocol_exhausted",
            diagnosticType: "pagelet_terminal_evidence_protocol_incomplete",
            message: "The terminal finding did not establish the required anchor and non-anchor content reads.",
        },
        "terminal-source-support": {
            reason: "pagelet_terminal_source_support_exhausted",
            diagnosticType: "pagelet_terminal_source_support_incomplete",
            message: "The terminal finding did not bind every cited source to concrete source text.",
        },
        citation: {
            reason: "pagelet_citation_protocol_exhausted",
            diagnosticType: "pagelet_citation_protocol_incomplete",
            message: "The terminal finding did not cite the complete grounded source set.",
        },
    } as const;
    const definition = definitions[failure];
    const existingTypedFailureReasons = new Set<string>([
        "pagelet_stage_shape_protocol_incomplete",
        "pagelet_exact_lead_protocol_incomplete",
        "pagelet_terminal_evidence_protocol_exhausted",
        "pagelet_terminal_source_support_exhausted",
        "pagelet_citation_protocol_exhausted",
        "pagelet_empty_finalization_exhausted",
    ]);
    if (
        typeof current?.reason === "string"
        && existingTypedFailureReasons.has(current.reason)
    ) {
        return current;
    }
    const diagnostics = Array.isArray(current?.diagnostics)
        ? [...current.diagnostics]
        : [];
    if (!diagnostics.some((diagnostic) => (
        diagnostic
        && typeof diagnostic === "object"
        && (diagnostic as Record<string, unknown>).type
            === definition.diagnosticType
    ))) {
        diagnostics.push({
            type: definition.diagnosticType,
            message: definition.message,
        });
    }
    return {
        ...current,
        reason: definition.reason,
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
    return resolveB125RetrievalOptimizationFlags(
        dependencies.host.getRetrievalOptimizationFlags?.()
        ?? dependencies.host.settings.retrievalOptimizationFlags,
    )[flag];
}

function getPageletRetrievalPolicyEpoch(
    dependencies: PageletAgentRuntimeDependencies,
): string {
    const liveEpoch = dependencies.host.getRetrievalOptimizationEpoch?.();
    if (liveEpoch) return liveEpoch;
    const flags = resolveB125RetrievalOptimizationFlags(
        dependencies.host.getRetrievalOptimizationFlags?.()
        ?? dependencies.host.settings.retrievalOptimizationFlags,
    );
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

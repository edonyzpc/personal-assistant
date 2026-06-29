import {
    toPersistedContextTrace,
    type ContextDropReason,
    type ContextTrace,
    type PersistedContextTrace,
    type PersistedSourceRef,
    type RetrievalOutcome,
    type SkippedSourceRef,
    type UISourceRef,
} from "./contracts";

export interface ContextPagerSourceItem {
    path: string;
    label?: string;
    reason?: ContextDropReason;
}

export interface ContextPagerMemoryItem {
    id: string;
    label?: string;
    reason?: ContextDropReason;
}

export interface ContextPagerState {
    runId: string;
    summary: {
        usedSourceCount: number;
        skippedSourceCount: number;
        usedMemoryCount: number;
        droppedMemoryCount: number;
        skippedScopeCount: number;
    };
    usedSources: ContextPagerSourceItem[];
    skippedSources: ContextPagerSourceItem[];
    usedMemories: ContextPagerMemoryItem[];
    droppedMemories: ContextPagerMemoryItem[];
    persistedTrace: PersistedContextTrace;
}

export interface ChatContextLikeItem {
    category: string;
    label: string;
    detail?: string;
    sources?: Array<{ path?: string; chunkIndex?: number }>;
    statusOnly?: boolean;
}

export function createContextTraceFromRetrievalOutcome(
    outcome: RetrievalOutcome,
    options: { runId: string; skippedScopes?: readonly string[] } = { runId: outcome.id },
): ContextTrace {
    return {
        runId: options.runId,
        retrievalOutcomeId: outcome.id,
        usedSources: outcome.sources.map(sourceRefToUiSourceRef),
        skippedSources: outcome.skippedSources.map(skippedSourceRefToUiSourceRef),
        usedMemories: [],
        droppedMemories: [],
        skippedScopes: [...(options.skippedScopes ?? outcome.missingScopeHints ?? [])],
        retrievalOutcome: outcome,
    };
}

export function createContextPagerStateFromRetrievalOutcome(
    outcome: RetrievalOutcome,
    options: { runId: string; skippedScopes?: readonly string[] } = { runId: outcome.id },
): ContextPagerState {
    return createContextPagerState(createContextTraceFromRetrievalOutcome(outcome, options));
}

export function createContextTraceFromChatContextUsed(
    runId: string,
    items: readonly ChatContextLikeItem[],
): ContextTrace {
    const usedSources = new Map<string, UISourceRef>();
    const usedMemories = new Map<string, { id: string; label?: string; contentHash?: string }>();
    const skippedScopes: string[] = [];

    for (const item of items) {
        const sourcePaths = uniqueSourcePaths(item.sources ?? []);
        if (item.category === "memory") {
            for (const path of sourcePaths) {
                usedMemories.set(path, { id: path, label: item.label });
            }
            if (sourcePaths.length === 0 && item.statusOnly) {
                skippedScopes.push(item.detail ?? item.label);
            }
            continue;
        }
        for (const path of sourcePaths) {
            usedSources.set(path, {
                path,
                whyShown: [item.label],
            });
        }
        if (sourcePaths.length === 0 && item.statusOnly) {
            skippedScopes.push(item.detail ?? item.label);
        }
    }

    return {
        runId,
        usedSources: [...usedSources.values()],
        skippedSources: [],
        usedMemories: [...usedMemories.values()],
        droppedMemories: [],
        skippedScopes,
    };
}

export function createContextPagerStateFromChatContextUsed(
    runId: string,
    items: readonly ChatContextLikeItem[],
): ContextPagerState {
    return createContextPagerState(createContextTraceFromChatContextUsed(runId, items));
}

export function createContextPagerState(trace: ContextTrace): ContextPagerState {
    const persistedTrace = preserveRetrievalOutcomeHashes(
        toPersistedContextTrace(trace),
        trace.retrievalOutcome,
    );
    return {
        runId: trace.runId,
        summary: {
            usedSourceCount: persistedTrace.usedSourceCount,
            skippedSourceCount: persistedTrace.skippedSourceCount,
            usedMemoryCount: persistedTrace.usedMemoryCount,
            droppedMemoryCount: persistedTrace.droppedMemoryCount,
            skippedScopeCount: persistedTrace.skippedScopeCount,
        },
        usedSources: trace.usedSources.map((source) => ({
            path: source.path,
            label: source.heading ?? source.path,
        })),
        skippedSources: trace.skippedSources.map((source) => ({
            path: source.path,
            label: source.privateTitle ?? source.heading ?? source.path,
            reason: productContextDropReason(source.reason),
        })),
        usedMemories: trace.usedMemories.map((memory) => ({
            id: memory.id,
            label: memory.label ?? memory.type ?? memory.id,
        })),
        droppedMemories: trace.droppedMemories.map((memory) => ({
            id: memory.id,
            label: memory.id,
            reason: productContextDropReason(memory.reason),
        })),
        persistedTrace,
    };
}

export function contextPagerSummaryText(summary: ContextPagerState["summary"]): string {
    const skipped = summary.skippedSourceCount + summary.droppedMemoryCount + summary.skippedScopeCount;
    return `Used ${summary.usedSourceCount} sources, ${summary.usedMemoryCount} memories. ${skipped} skipped.`;
}

function preserveRetrievalOutcomeHashes(
    trace: PersistedContextTrace,
    outcome: RetrievalOutcome | undefined,
): PersistedContextTrace {
    if (!outcome) return trace;
    const sourceByPath = new Map(outcome.sources.map((source) => [source.path, source]));
    const skippedByPath = new Map(outcome.skippedSources.map((source) => [source.path, source]));
    return {
        ...trace,
        usedSourceRefs: trace.usedSourceRefs.map((source) => ({
            ...source,
            excerptHash: source.excerptHash ?? sourceByPath.get(source.path)?.excerptHash,
        })),
        skippedSourceRefs: trace.skippedSourceRefs.map((source) => ({
            ...source,
            excerptHash: source.excerptHash ?? skippedByPath.get(source.path)?.excerptHash,
        })),
    };
}

function sourceRefToUiSourceRef(ref: PersistedSourceRef): UISourceRef {
    const source: UISourceRef = {
        path: ref.path,
    };
    if (ref.heading) source.heading = ref.heading;
    if (ref.blockId) source.blockId = ref.blockId;
    if (ref.contentHash) source.contentHash = ref.contentHash;
    if (ref.whyShown) source.whyShown = [...ref.whyShown];
    if (ref.evidenceStrength) source.evidenceStrength = ref.evidenceStrength;
    return source;
}

function skippedSourceRefToUiSourceRef(ref: SkippedSourceRef): ContextTrace["skippedSources"][number] {
    return {
        ...sourceRefToUiSourceRef(ref),
        reason: productContextDropReason(ref.boundaryReason ? "privacy excluded" : ref.skippedReason),
        privateTitle: ref.privateTitle,
    };
}

function productContextDropReason(reason: string): ContextDropReason {
    if (reason === "data_boundary" || reason === "denied_by_data_boundary") return "privacy excluded";
    if (reason === "unsupported scope") return "scope mismatch";
    if (reason === "duplicate") return "not relevant";
    if (reason === "conflict") return "conflict";
    if (reason === "compressed") return "compressed";
    if (reason === "user excluded") return "user excluded";
    if (reason === "sensitive") return "sensitive";
    if (reason === "stale") return "stale";
    if (reason === "budget limit") return "budget limit";
    if (reason === "low evidence") return "low evidence";
    if (reason === "privacy excluded") return "privacy excluded";
    return "not relevant";
}

function uniqueSourcePaths(sources: readonly { path?: string }[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const source of sources) {
        const path = typeof source.path === "string" ? source.path.trim() : "";
        if (!path || seen.has(path)) continue;
        seen.add(path);
        result.push(path);
    }
    return result;
}

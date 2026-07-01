import type { RetrievalOutcome } from "./retrieval-outcome";
import type { PersistedSourceRef, UISourceRef } from "./source-ref";
import { hasForbiddenPersistedTextFields, toReplaySourceRef } from "./source-ref";
import { stableHash } from "../helpers";

export const CONTEXT_DROP_REASONS = [
    "privacy excluded",
    "low evidence",
    "stale",
    "scope mismatch",
    "compressed",
    "budget limit",
    "conflict",
    "user excluded",
    "sensitive",
    "duplicate",
    "unsupported scope",
    "not relevant",
    "provider cancelled",
] as const;

export type ContextDropReason = typeof CONTEXT_DROP_REASONS[number];

export interface ContextMemoryRef {
    id: string;
    type?: string;
    label?: string;
    text?: string;
    contentHash?: string;
}

export interface DroppedMemoryRef {
    id: string;
    reason: ContextDropReason;
    text?: string;
    contentHash?: string;
}

export interface SkippedContextSourceRef extends UISourceRef {
    reason: ContextDropReason;
    privateTitle?: string;
}

export interface ContextTrace {
    runId: string;
    retrievalOutcomeId?: string;
    usedSources: UISourceRef[];
    skippedSources: SkippedContextSourceRef[];
    usedMemories: ContextMemoryRef[];
    droppedMemories: DroppedMemoryRef[];
    skippedScopes: string[];
    compressionSummary?: string;
    retrievalOutcome?: RetrievalOutcome;
}

export interface PersistedContextTrace {
    runId: string;
    retrievalOutcomeId?: string;
    usedSourceRefs: PersistedSourceRef[];
    skippedSourceRefs: Array<PersistedSourceRef & { reason: ContextDropReason }>;
    usedMemoryRefs: Array<{ id: string; type?: string; contentHash?: string }>;
    droppedMemoryRefs: Array<{ id: string; reason: ContextDropReason; contentHash?: string }>;
    skippedScopeCount: number;
    usedSourceCount: number;
    skippedSourceCount: number;
    usedMemoryCount: number;
    droppedMemoryCount: number;
    compressionSummaryHash?: string;
}

export function isContextDropReason(value: unknown): value is ContextDropReason {
    return typeof value === "string" && (CONTEXT_DROP_REASONS as readonly string[]).includes(value);
}

export function formatContextTraceSummary(trace: ContextTrace): string {
    return [
        `Sources used: ${trace.usedSources.length}`,
        `sources skipped: ${trace.skippedSources.length}`,
        `memories used: ${trace.usedMemories.length}`,
        `memories dropped: ${trace.droppedMemories.length}`,
        `scopes skipped: ${trace.skippedScopes.length}`,
    ].join("; ");
}

export function toPersistedContextTrace(trace: ContextTrace): PersistedContextTrace {
    return {
        runId: trace.runId,
        retrievalOutcomeId: trace.retrievalOutcomeId,
        usedSourceRefs: trace.usedSources.map((source) => toReplaySourceRef(source)),
        skippedSourceRefs: trace.skippedSources.map((source) => ({
            ...toReplaySourceRef(source),
            reason: source.reason,
        })),
        usedMemoryRefs: trace.usedMemories.map((memory) => ({
            id: memory.id,
            type: memory.type,
            contentHash: memory.contentHash ?? (memory.text ? stableHash(memory.text) : undefined),
        })),
        droppedMemoryRefs: trace.droppedMemories.map((memory) => ({
            id: memory.id,
            reason: memory.reason,
            contentHash: memory.contentHash ?? (memory.text ? stableHash(memory.text) : undefined),
        })),
        skippedScopeCount: trace.skippedScopes.length,
        usedSourceCount: trace.usedSources.length,
        skippedSourceCount: trace.skippedSources.length,
        usedMemoryCount: trace.usedMemories.length,
        droppedMemoryCount: trace.droppedMemories.length,
        compressionSummaryHash: trace.compressionSummary ? stableHash(trace.compressionSummary) : undefined,
    };
}

export function persistedContextTraceHasPrivateText(trace: PersistedContextTrace): boolean {
    return hasForbiddenPersistedTextFields(trace);
}

import type { GenerationInputBackgroundSources, GenerationInputSnapshot } from "./generation-input-snapshot";

export type MemoryManagementOperation = "status" | "query" | "usage" | "action" | "vault_insights" | "saved_insights";

export type MemoryManagementUnavailableReason =
    | "port_missing"
    | "not_ready"
    | "cache_refresh_pending"
    | "memory_disabled"
    | "history_unavailable"
    | "conversation_not_found"
    | "turn_not_found"
    | "source_changed"
    | "cursor_expired";

export interface MemoryManagementObservation {
    purpose: "memory_management";
    ready: boolean;
    reason?: MemoryManagementUnavailableReason;
    memoryEnabled: boolean;
    stateFingerprint?: string;
    commitSequence?: number;
    deviceMemoryCacheRefreshTargetSequence?: number;
    partition?: string;
    dataBoundary?: string;
    /** Item-level revalidation for collections; absent means atomic evidence. */
    validItemIndexes?: number[];
    /** Whether exact counts/cursors/coverage promises are still current. */
    aggregateCurrent?: boolean;
    /** Host-only synchronous admission guard; never persisted or serialized. */
    guard?: MemoryManagementCurrentnessGuard;
    /** Host-only current projection for field-level disclosure redaction. */
    projectedContent?: unknown;
}

export interface MemoryManagementCurrentnessGuard {
    assertCurrent(): void;
}

export interface MemoryManagementSettings {
    memoryEnabled: boolean;
    learningEnabled?: boolean;
    learningStatus?: "enabled" | "paused" | "disabled";
    existingUnderstandingAvailable?: boolean;
}

export interface MemoryManagementStatusOutput {
    kind: "memory-status";
    available: true;
    memoryEnabled: boolean;
    contentAvailable: boolean;
    noteMemory: {
        status: "disabled" | "unknown" | "unprepared" | "preparing" | "ready" | "stale" | "error";
        indexedDocumentCount?: number;
    };
    learning: {
        enabled: boolean;
        status: "enabled" | "paused" | "disabled";
        governance: "ready" | "unavailable";
        profile: "disabled" | "loading" | "unknown" | "blocked" | "unavailable" | "empty" | "ready" | "error";
        vaultInsights: "disabled" | "not_loaded" | "ready" | "stale_boundary" | "error";
    };
    /** Count over the provider/Data-Boundary-permitted management projection. */
    recordCount: number;
    recordCountKind: "exact" | "partial";
    coverage: "complete" | "partial" | "unknown";
    managementTargetId: "memory-personalization";
    existingUnderstanding: {
        available: boolean;
        status: "active" | "paused" | "unknown";
    };
}

export type MemoryManagementEntityType =
    | "governed_claim"
    | "legacy_user_profile"
    | "legacy_confirmed_memory"
    | "vault_insight"
    | "pending_forget";

export type MemoryManagementLifecycle =
    | "derived"
    | "active"
    | "archived"
    | "paused"
    | "forget_pending"
    | "stale"
    | "exported"
    | "forgotten_marker";

export interface MemoryManagementQueryInput {
    text?: string;
    itemId?: string;
    lifecycle?: MemoryManagementLifecycle[];
    limit?: number;
    cursor?: string;
}

export interface MemoryManagementQueryItem {
    id: string;
    entityType: MemoryManagementEntityType;
    claimId?: string;
    revisionId?: string;
    legacyFingerprint?: string;
    text?: string;
    authority: "source_observation" | "pa_inference" | "explicit_user" | "user_correction";
    scope?: string;
    effect: "none" | "stored_not_in_use" | "retrieval_only" | "future_answers" | "collaboration_default";
    lifecycle: MemoryManagementLifecycle;
    effectiveUse: "active" | "paused" | "stored_not_in_use";
    observedAt?: string;
    updatedAt?: string;
    sources: Array<{
        kind: "note" | "conversation" | "setting" | "vault_aggregate";
        path?: string;
        conversationId?: string;
        settingKey?: string;
        generatedAt?: string;
    }>;
    supportedActions: string[];
    detailTarget: { kind: "memory-settings"; targetId: string };
}

export interface MemoryManagementQueryOutput {
    kind: "memory-query";
    available: true;
    reason?: never;
    memoryEnabled: boolean;
    contentAvailable: boolean;
    query: Omit<MemoryManagementQueryInput, "cursor" | "limit">;
    items: MemoryManagementQueryItem[];
    /** Present only while the exact aggregate promise remains disclosure-safe. */
    matchCount?: number;
    matchCountKind?: "exact" | "partial";
    coverage: { state: "complete" | "partial" | "unknown"; explanation?: string };
    nextCursor?: string;
}

export type MemoryManagementUnavailableOutput<Target extends string> = {
    kind: "memory-query" | "memory-usage";
    available: false;
    reason: MemoryManagementUnavailableReason;
    target: Target;
    memoryEnabled: boolean;
    contentAvailable: false;
    items?: [];
    records?: [];
    matchCount?: 0;
    evidenceLevel?: "unknown";
};

export interface MemoryManagementCurrentUsageInput {
    governedMemoryTrace?: Array<{
        claimId: string;
        effect: "future_answers" | "collaboration_default";
        source?: "notes" | "interactions" | "settings" | "mixed";
        scope?: "current_vault" | "same_device";
    }>;
    generationInputSources?: GenerationInputBackgroundSources;
    writingGenerationInput?: GenerationInputSnapshot;
}

export interface MemoryManagementUsageRecord {
    conversationId?: string;
    turnId?: string;
    turnIndex?: number;
    evidenceLevel: "writing_generation_snapshot" | "context_record";
    disclosure: "dispatch_snapshot" | "selection_record";
    claims: Array<{ claimId: string; revisionId: string }>;
    contextClaims?: Array<{ claimId: string; revisionId?: string }>;
    writingVersionId?: string;
}

export interface MemoryManagementUsageOutput {
    kind: "memory-usage";
    available: true;
    target: "current_run" | "history";
    memoryEnabled: boolean;
    evidenceLevel: "writing_generation_snapshot" | "context_record" | "unknown";
    records: MemoryManagementUsageRecord[];
}

export interface MemoryManagementReadPort {
    prepareObservation(expected?: {
        operation?: MemoryManagementOperation;
        stateFingerprint?: string;
        contentFingerprint?: string;
        aggregateFingerprint?: string;
        request?: Record<string, string>;
        items?: import("./memory-management-evidence").MemoryManagementEvidenceItem[];
    }, currentUsage?: () => MemoryManagementCurrentUsageInput | undefined): Promise<MemoryManagementObservation>;
    getStatus(): Promise<MemoryManagementStatusOutput>;
    queryMemories(input: MemoryManagementQueryInput): Promise<MemoryManagementQueryOutput | MemoryManagementUnavailableOutput<"query">>;
    getUsage(
        input: { conversationId?: string; turnId?: string },
        currentUsage?: () => MemoryManagementCurrentUsageInput | undefined,
    ): Promise<MemoryManagementUsageOutput | MemoryManagementUnavailableOutput<"current_run" | "history">>;
}

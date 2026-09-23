export type DebugDomain = 'vault_notes' | 'personal_memory' | 'insights' | 'legacy_memory' | 'chat_history';
export const DEBUG_DOMAINS: readonly DebugDomain[] = ['vault_notes', 'personal_memory', 'insights', 'legacy_memory', 'chat_history'];

export interface DebugLineage {
    sourceRefs: string[];
    claimIds: string[];
    legacyRecordIds: string[];
    conversationIds: string[];
    possibleDomains: DebugDomain[];
    completeness: 'known' | 'unknown';
}

export interface DebugUsage {
    input?: number;
    output?: number;
    total?: number;
    cachedInput?: number;
    reasoning?: number;
    complete: boolean;
}

export type DebugRunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
export type DebugAvailability = 'recorded' | 'not_provided' | 'filtered' | 'capacity' | 'cleared' | 'session_only' | 'unavailable' | 'recovery_unverified';

export interface DebugRun {
    vaultKey: string;
    captureId: string;
    ownerSessionId?: string;
    runtimeRunId?: string;
    conversationId?: string;
    messageId?: string;
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    expiresAt: number;
    status: DebugRunStatus;
    collection: 'recording' | 'complete' | 'partial' | 'stopped' | 'unavailable';
    provider?: string;
    model?: string;
    usage?: DebugUsage;
    eventCount: number;
    accountedBytes: number;
    lastCommittedSeq: number;
    hasGap: boolean;
}

export interface DebugEvent {
    vaultKey: string;
    captureId: string;
    seq: number;
    segment: number;
    nodeId: string;
    parentId?: string;
    turnId?: string;
    callId?: string;
    attemptId?: string;
    toolCallId?: string;
    timestamp: number;
    kind: string;
    status?: string;
    label?: string;
    durationMs?: number;
    usage?: DebugUsage;
    details?: Record<string, string | number | boolean>;
    contentIds: string[];
    availability?: DebugAvailability;
}

/** Only already-projected text enters the persistence boundary. */
export interface DebugContent {
    vaultKey: string;
    captureId: string;
    contentId: string;
    kind: 'prompt' | 'input' | 'output' | 'context' | 'error' | 'attachment';
    text: string;
    redactions: string[];
    lineage: DebugLineage;
    generation: number;
    domainGenerations: Partial<Record<DebugDomain, number>>;
    accountedBytes: number;
}

export interface DebugSessionDetail {
    captureId: string;
    nodeId: string;
    kind: 'reasoning' | 'tool_input' | 'tool_output' | 'response';
    text: string;
    timestamp: number;
}

export interface DebugGeneration {
    generation: number;
    /** Content-free notification revision; unlike generation this does not erase unrelated history. */
    revision?: number;
    domains: Partial<Record<DebugDomain, number>>;
    sourceToken?: string;
    quarantined: boolean;
}

export interface DebugBatch {
    run: DebugRun;
    events: DebugEvent[];
    contents: DebugContent[];
    generation: DebugGeneration;
}

export interface DebugBudgets {
    persistentBytes: number;
    runBytes: number;
    runEvents: number;
    requestBytes: number;
    contentBytes: number;
    queueBytes: number;
    queueEvents: number;
    sessionBytes: number;
    sessionRunBytes: number;
    retentionMs: number;
    flushMs: number;
}

export const DEFAULT_DEBUG_BUDGETS: Readonly<DebugBudgets> = {
    persistentBytes: 256 * 1024 * 1024,
    runBytes: 32 * 1024 * 1024,
    runEvents: 20_000,
    requestBytes: 2 * 1024 * 1024,
    contentBytes: 1024 * 1024,
    queueBytes: 2 * 1024 * 1024,
    queueEvents: 2048,
    sessionBytes: 16 * 1024 * 1024,
    sessionRunBytes: 4 * 1024 * 1024,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    flushMs: 250,
};

export interface DebugRunQuery {
    limit?: number;
    before?: number;
    conversationId?: string;
    status?: DebugRunStatus;
}

export interface DebugEventQuery { limit?: number; after?: number; }

export interface DebugStoreStatus {
    available: boolean;
    recoveryReady: boolean;
    bytes: number;
    limit: number;
    reason?: string;
}

export function emptyDebugLineage(): DebugLineage {
    return { sourceRefs: [], claimIds: [], legacyRecordIds: [], conversationIds: [],
        possibleDomains: [...DEBUG_DOMAINS], completeness: 'unknown' };
}

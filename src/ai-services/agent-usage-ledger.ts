import type { AgentDebugUsage } from './agent-debug-port';

export type AgentUsagePurpose = 'answer' | 'context_summary' | 'query_rewrite' | 'rerank';

interface UsageEntry {
    callId: string;
    purpose: AgentUsagePurpose;
    usage: AgentDebugUsage;
}

interface Attempt {
    callId: string;
    purpose: AgentUsagePurpose;
    status: 'dispatched' | 'response' | 'completed' | 'partial' | 'failed' | 'cancelled';
    httpStatus?: number;
    promptEstimate?: { tokens: number; method: string };
    updates: Map<string, UsageEntry>;
}

interface Call {
    purpose: AgentUsagePurpose;
    successfulInPhase: Set<string>;
    logicalUpdates: Map<string, UsageEntry>;
    ambiguousUsage: boolean;
}

export interface PaAgentUsageLedgerSnapshot {
    attempts: Array<{ callId: string; attemptId: string; purpose: AgentUsagePurpose;
        status: Attempt['status']; httpStatus?: number; totalTokens?: number;
        measuredPromptTokens?: number; estimatedPromptTokens?: number; estimateMethod?: string;
        complete: boolean }>;
    logicalCalls: Array<{ callId: string; purpose: AgentUsagePurpose; totalTokens?: number; complete: boolean;
        basis: 'physical_derived' | 'logical_unassigned' | 'no_dispatch' | 'unknown' }>;
    knownPhysicalTokens: number;
    physicalTotalTokens: number | null;
    /** Only complete logical usage lacking a provable physical request; never add to physicalTotalTokens as a run total. */
    knownUnassignedLogicalTokens: number | null;
    /** Full run total only when every observed call is logical-only and complete. */
    logicalTotalTokens: number | null;
    physicalAttribution: 'complete' | 'incomplete' | 'unknown';
}

/** Run-local token accounting. The parser is shared with Debug; this only owns identities. */
export class PaAgentRunUsageLedger {
    private readonly calls = new Map<string, Call>();
    private readonly attempts = new Map<string, Attempt>();

    private call(callId: string, purpose: AgentUsagePurpose): Call {
        let call = this.calls.get(callId);
        if (!call) {
            call = { purpose, successfulInPhase: new Set(), logicalUpdates: new Map(), ambiguousUsage: false };
            this.calls.set(callId, call);
        }
        return call;
    }

    beginResponsePhase(callId: string, purpose: AgentUsagePurpose): void {
        this.call(callId, purpose).successfulInPhase.clear();
    }

    dispatch(callId: string, purpose: AgentUsagePurpose, attemptId: string,
        promptEstimate?: { tokens: number; method: string }): void {
        this.call(callId, purpose);
        this.attempts.set(attemptId, { callId, purpose, status: 'dispatched', updates: new Map(),
            ...(promptEstimate ? { promptEstimate: { ...promptEstimate } } : {}) });
    }

    response(callId: string, purpose: AgentUsagePurpose, attemptId: string, status?: number): void {
        const attempt = this.attempts.get(attemptId);
        if (!attempt || attempt.callId !== callId) return;
        attempt.httpStatus = status;
        attempt.status = status !== undefined && status >= 400 ? 'failed' : 'response';
        if (attempt.status === 'response') this.call(callId, purpose).successfulInPhase.add(attemptId);
    }

    fail(attemptId: string, cancelled = false): void {
        const attempt = this.attempts.get(attemptId);
        if (attempt) attempt.status = cancelled ? 'cancelled' : 'failed';
    }

    responseAttempt(callId: string): string | undefined {
        const successful = this.calls.get(callId)?.successfulInPhase;
        return successful?.size === 1 ? [...successful][0] : undefined;
    }

    hasAmbiguousResponsePhase(callId: string): boolean {
        return (this.calls.get(callId)?.successfulInPhase.size ?? 0) > 1;
    }

    finishResponsePhase(callId: string, outcome: 'completed' | 'partial' | 'failed' | 'cancelled'): string | undefined {
        const attemptId = this.responseAttempt(callId);
        const attempt = attemptId ? this.attempts.get(attemptId) : undefined;
        if (attempt && (attempt.status === 'response' || attempt.status === 'completed')) attempt.status = outcome;
        return attemptId;
    }

    record(callId: string, purpose: AgentUsagePurpose, usage: AgentDebugUsage, updateKey: string): string | undefined {
        const call = this.call(callId, purpose);
        const attemptId = this.responseAttempt(callId);
        const attempt = attemptId ? this.attempts.get(attemptId) : undefined;
        // A unique successful HTTP response remains the source of later usage even
        // when cancellation or consumer failure has already made its total incomplete.
        const eligibleAttempt = attempt;
        if (!eligibleAttempt && call.successfulInPhase.size > 1) call.ambiguousUsage = true;
        const updates = eligibleAttempt?.updates ?? call.logicalUpdates;
        const key = `${purpose}:${updateKey}`;
        const previous = updates.get(key)?.usage;
        const next = usage.aggregation === 'delta' && previous ? sumUsage(previous, usage) : { ...usage };
        updates.set(key, { callId, purpose, usage: next });
        return eligibleAttempt ? attemptId : undefined;
    }

    snapshot(): PaAgentUsageLedgerSnapshot {
        const attempts = [...this.attempts].map(([attemptId, attempt]) => {
            const usage = sumEntries(attempt.updates);
            return { callId: attempt.callId, attemptId, purpose: attempt.purpose,
                status: attempt.status, ...(attempt.httpStatus !== undefined ? { httpStatus: attempt.httpStatus } : {}),
                ...(attempt.promptEstimate ? { estimatedPromptTokens: attempt.promptEstimate.tokens,
                    estimateMethod: attempt.promptEstimate.method } : {}),
                ...(usage.inputTokens !== undefined ? { measuredPromptTokens: usage.inputTokens } : {}),
                ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
                complete: attempt.status === 'completed' && usage.complete === true
                    && usage.totalTokens !== undefined };
        });
        const logicalCalls = [...this.calls].map(([callId, call]) => {
            const usage = sumEntries(call.logicalUpdates);
            const physical = attempts.filter(attempt => attempt.callId === callId);
            const physicallyDerived = !call.ambiguousUsage && call.logicalUpdates.size === 0
                && physical.length > 0 && physical.every(attempt => attempt.complete);
            const noDispatch = physical.length === 0 && call.logicalUpdates.size === 0;
            const logicalOnly = !call.ambiguousUsage && physical.length === 0
                && usage.complete === true && usage.totalTokens !== undefined;
            return { callId, purpose: call.purpose,
                ...(physicallyDerived ? { totalTokens: physical.reduce((sum, attempt) => sum + attempt.totalTokens!, 0) }
                    : logicalOnly ? { totalTokens: usage.totalTokens }
                        : noDispatch ? { totalTokens: 0 } : {}),
                complete: physicallyDerived || logicalOnly || noDispatch,
                basis: physicallyDerived ? 'physical_derived' as const
                    : logicalOnly ? 'logical_unassigned' as const
                        : noDispatch ? 'no_dispatch' as const : 'unknown' as const };
        });
        const knownPhysicalTokens = attempts.reduce((total, attempt) => total + (attempt.totalTokens ?? 0), 0);
        const physicalComplete = attempts.length > 0 && attempts.every(attempt => attempt.complete)
            && logicalCalls.every(call => call.basis === 'physical_derived' || call.basis === 'no_dispatch');
        const unassignedLogicalCalls = logicalCalls.filter(call => call.basis === 'logical_unassigned');
        const logicalComplete = logicalCalls.length > 0
            && logicalCalls.every(call => call.basis === 'logical_unassigned' || call.basis === 'no_dispatch');
        return { attempts, logicalCalls, knownPhysicalTokens,
            physicalTotalTokens: physicalComplete ? knownPhysicalTokens : null,
            knownUnassignedLogicalTokens: unassignedLogicalCalls.length
                ? unassignedLogicalCalls.reduce((total, call) => total + call.totalTokens!, 0) : null,
            logicalTotalTokens: logicalComplete
                ? unassignedLogicalCalls.reduce((total, call) => total + (call.totalTokens ?? 0), 0) : null,
            physicalAttribution: physicalComplete ? 'complete' : attempts.length ? 'incomplete' : 'unknown' };
    }
}

function sumUsage(first: AgentDebugUsage, next: AgentDebugUsage): AgentDebugUsage {
    const add = (a?: number, b?: number) => a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
    return { ...next, inputTokens: add(first.inputTokens, next.inputTokens),
        outputTokens: add(first.outputTokens, next.outputTokens), totalTokens: add(first.totalTokens, next.totalTokens),
        cacheReadTokens: add(first.cacheReadTokens, next.cacheReadTokens),
        reasoningTokens: add(first.reasoningTokens, next.reasoningTokens),
        complete: first.complete === true && next.complete === true };
}

function sumEntries(updates: Map<string, UsageEntry>): AgentDebugUsage {
    let total: AgentDebugUsage = { complete: updates.size > 0 };
    for (const entry of updates.values()) total = sumUsage(total, entry.usage);
    return total;
}

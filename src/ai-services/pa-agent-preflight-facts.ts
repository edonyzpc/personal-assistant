import type { PaAgentMessage } from './chat-types';

type ToolResult = Extract<PaAgentMessage, { role: 'toolResult' }>;
const REASONS = [
    'source_run_changed', 'invalid_source_batch', 'source_control_unavailable',
    'source_excluded', 'source_read_plan_unavailable', 'source_read_outside_scope',
    'conflicting_source_admission', 'batch_preflight_rejected', 'batch_preflight_failed',
] as const;
type PreflightReason = typeof REASONS[number];

interface HostBatchPreflightReceipt {
    kind: 'batch_preflight_rejection';
    callId: string;
    toolName: string;
    reason: PreflightReason;
}

const liveReceipts = new WeakSet<object>();

/** Only the dispatcher's rejected-batch branch mints this zero-execution proof. */
export function createHostBatchPreflightRejection(callId: string, toolName: string,
    reason: unknown): HostBatchPreflightReceipt {
    const receipt: HostBatchPreflightReceipt = Object.freeze({ kind: 'batch_preflight_rejection', callId, toolName,
        reason: REASONS.includes(reason as PreflightReason) ? reason as PreflightReason : 'batch_preflight_rejected' });
    liveReceipts.add(receipt);
    return receipt;
}

/** A persisted closed fact may be displayed, but it cannot grant live source admission. */
export function projectHostBatchPreflightRejection(message: ToolResult): { scope: 'batch'; reason: PreflightReason } | undefined {
    const metadata = message.content.metadata;
    const receipt = metadata?.hostBatchPreflightRejection;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || Object.keys(receipt).sort().join(',') !== 'callId,kind,reason,toolName'
        || !message.isError || metadata?.outcome !== 'policy_rejected'
        || metadata.executionState !== 'not_started' || metadata.preflightOnly !== true
        || metadata.batchPreflightRejected !== true || message.content.sourceRecords?.length
        || message.content.contextUsed?.length || message.content.resultFact) return undefined;
    const value = receipt as HostBatchPreflightReceipt;
    if (value.kind !== 'batch_preflight_rejection' || value.callId !== message.toolCallId
        || value.toolName !== message.toolName || !REASONS.includes(value.reason)) return undefined;
    return { scope: 'batch', reason: value.reason };
}

/** Runtime must not infer this authority from tool names, copied metadata, or model text. */
export function isLiveHostBatchPreflightRejection(message: ToolResult): boolean {
    const receipt = message.content.metadata?.hostBatchPreflightRejection;
    return !!receipt && typeof receipt === 'object' && liveReceipts.has(receipt)
        && projectHostBatchPreflightRejection(message) !== undefined;
}

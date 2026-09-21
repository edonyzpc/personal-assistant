import type { AgentEvent } from './chat-types';

export type AgentDebugFields = Record<string, unknown>;
export type AgentDebugLog = (phase: string, fields?: AgentDebugFields) => void;

// Metadata is extensible. Only these host codes are safe to copy into traces.
const debugCodes = new Set([
    'success', 'recoverable_error', 'schema_invalid', 'policy_rejected', 'budget_exceeded',
    'duplicate_skipped', 'control_applied', 'aborted', 'abort_timeout', 'source_unavailable',
    'invalid_declaration', 'invalid_instruction_quote', 'scope_widening', 'unknown_note_handle',
    'new_tool_evidence', 'tool_chain_allowed', 'tool_failure', 'required_tool_failed',
    'empty_after_observation', 'empty_after_finalization', 'duplicate_tool_call_without_answer',
    'assistant_empty_response', 'assistant_idle_timeout', 'assistant_source_changed', 'context_local_overflow',
    'final_answer_only_violation', 'finalization_policy_preparation_error',
    'finalization_policy_requested_continuation', 'finalization_reserve_exhausted',
    'finalization_reserve_exhausted_by_buffered_provider', 'finalization_reserve_overrun',
    'finalization_reserve_reached', 'finalization_reserve_used_by_text', 'host_policy_error',
    'late_tool_after_text', 'model_input_preparation_error', 'native_writing_identity_or_batch_invalid',
    'native_writing_invalid', 'native_writing_policy_requested_continuation', 'max_turns_exceeded',
    'provider_completion_conflict', 'provider_content_after_completion', 'provider_error',
    'provider_admission_rejected', 'provider_tool_calls_missing',
    'provider_transport_end', 'turn_lease_error', 'user_abort', 'wall_clock_exceeded',
    'done', 'idle', 'error', 'completed', 'completed_with_warning', 'incomplete',
    'needs_follow_up', 'tool_results_ready', 'terminal_idempotent', 'corrective_turn',
    'tool_batch_preflight_rejected', 'batch_preflight_rejected', 'batch_preflight_failed',
    'placeholder_tool_call', 'invalid_tool_input', 'duplicate_tool_call', 'missing_tool_executor',
    'tool_timeout', 'unknown_tool_runtime_state', 'tool_exception', 'task_source_scope_expired',
]);
const safeCode = (value: unknown): string | undefined => value === undefined ? undefined
    : typeof value === 'string' && debugCodes.has(value) ? value : 'unknown';

export function agentDebugErrorType(error: unknown): string {
    const name = error instanceof Error ? error.name : undefined;
    return name && ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError',
        'APIError', 'APIConnectionError', 'APIConnectionTimeoutError', 'RateLimitError',
        'ProviderAdmissionError'].includes(name) ? name : 'unknown';
}

/** Only known host errors become reason codes; arbitrary provider messages may contain data. */
export function describeAgentError(error: unknown): AgentDebugFields {
    const reasons: Record<string, string> = {
        'Personal context changed before provider dispatch': 'personal_context_changed',
        'Vault observation projection changed before provider dispatch': 'vault_projection_changed',
        'Vault observation evidence changed before dispatch.': 'vault_evidence_changed',
        'Memory management projection changed before dispatch.': 'memory_management_changed',
        'Writing generation sources changed before provider dispatch': 'writing_source_changed',
    };
    return { errorType: agentDebugErrorType(error),
        ...(error instanceof Error && reasons[error.message] ? { localReason: reasons[error.message] } : {}) };
}

/** A content-free, best-effort observer. Never pass prompts, arguments or headers here. */
export function createAgentDebugLog(
    enabled: () => boolean,
    log: (message: string, fields: AgentDebugFields) => void,
    identity: AgentDebugFields,
): AgentDebugLog {
    const startedAt = Date.now();
    return (phase, fields = {}) => {
        try {
            if (!enabled()) return;
            const now = Date.now();
            log('PA Agent trace', { ...identity, timestamp: now, ...fields, phase,
                ...('reason' in fields ? { reason: safeCode(fields.reason) } : {}),
                ...('outcome' in fields ? { outcome: safeCode(fields.outcome) } : {}),
                loggedAt: now, runElapsedMs: now - startedAt });
        } catch { /* Observability must not affect execution. */ }
    };
}

export function describeAgentText(text: string): AgentDebugFields {
    return {
        chars: text.length,
        visibleChars: text.trim().length,
        containsToolCallMarkup: /<\/?tool_calls?\b/i.test(text),
    };
}

export async function traceAgentPhase<T>(
    log: AgentDebugLog, phase: string, task: () => T | PromiseLike<T>, fields: AgentDebugFields = {},
): Promise<T> {
    const startedAt = Date.now();
    log(`${phase}:start`, fields);
    try {
        const result = await task();
        log(`${phase}:end`, { ...fields, durationMs: Date.now() - startedAt });
        return result;
    } catch (error) {
        log(`${phase}:error`, { ...fields, durationMs: Date.now() - startedAt,
            ...describeAgentError(error) });
        throw error;
    }
}

/** Log boundaries and first delta of each kind, not every token or user content. */
export function createAgentEventDebugObserver(log: AgentDebugLog): (event: AgentEvent) => void {
    const observedDeltas = new Set<string>();
    return event => {
        const fields: AgentDebugFields = { turnId: event.turnId, eventSeq: event.seq, eventTimestamp: event.timestamp };
        if (event.type === 'message_update') {
            const key = `${event.messageId}:${event.update.kind}`;
            if (observedDeltas.has(key)) return;
            observedDeltas.add(key);
            log('first_message_update', { ...fields, messageId: event.messageId, kind: event.update.kind });
            return;
        }
        if (event.type === 'message_start' || event.type === 'message_end') {
            const message = event.message;
            Object.assign(fields, { messageId: message.id, role: message.role });
            if (message.role === 'assistant') {
                const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('');
                Object.assign(fields, describeAgentText(text), {
                    thinkingChars: message.content.reduce((sum, part) => sum + (part.type === 'thinking' ? part.text.length : 0), 0),
                    toolCalls: message.content.filter(part => part.type === 'toolCall').map(part => ({
                        id: part.id, name: part.name,
                        argumentChars: typeof part.input === 'string' ? part.input.length : undefined,
                    })),
                    providerCompletion: message.providerCompletion, stopReason: message.stopReason,
                });
            } else if (message.role === 'toolResult') {
                Object.assign(fields, { toolCallId: message.toolCallId, toolName: message.toolName,
                    isError: message.isError, observationChars: message.content.promptText.length,
                    includeInNextPrompt: message.content.includeInNextPrompt,
                    outcome: safeCode(message.content.metadata?.outcome), reason: safeCode(message.content.metadata?.reason),
                    preflightOnly: message.content.metadata?.preflightOnly === true,
                    batchPreflightRejected: message.content.metadata?.batchPreflightRejected === true });
            }
        }
        if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end' || event.type === 'tool_execution_update') {
            Object.assign(fields, { toolCallId: event.toolCallId, toolName: event.toolName });
            if (event.type === 'tool_execution_end') fields.outcome = event.outcome;
        }
        if (event.type === 'turn_start') fields.toolMode = event.metadata?.toolMode ?? 'normal';
        if (event.type === 'turn_end' || event.type === 'agent_end') {
            fields.status = event.status;
            fields.reason = safeCode(event.metadata?.reason);
            const diagnostics = event.metadata?.diagnostics;
            if (Array.isArray(diagnostics)) fields.diagnostics = diagnostics.map(item => safeCode(item?.type));
        }
        log(event.type, fields);
    };
}

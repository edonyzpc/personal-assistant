import type { PaAgentHostPolicy, PaAgentTerminalDecision } from './pa-agent-loop';

/** Task sufficiency belongs to the Agent; this policy handles only protocol stalls. */
export function createPaAgentHostPolicy(): PaAgentHostPolicy {
    let replayBatch: string | undefined;
    let repeatedBatches = 0;
    let emptyResponses = 0;
    let terminal: PaAgentTerminalDecision | undefined;
    return {
        afterTurn(summary) {
            if (terminal) return terminal;
            if (summary.status === 'tool_results_ready') {
                emptyResponses = 0;
                const key = summary.replayOnlyBatchKey;
                repeatedBatches = key && key === replayBatch ? repeatedBatches + 1 : key ? 1 : 0;
                replayBatch = key;
                if (repeatedBatches >= 2) {
                    terminal = { action: 'stop', status: 'incomplete', reason: 'identical_batch_replayed' };
                    return terminal;
                }
                return { action: 'continue', reason: 'tool_results_ready', ...(key ? {
                    runtimeInstruction: 'Every call in this batch reused an existing result or was blocked from replay. Use those observations to answer, or choose a different necessary call. Repeating the same batch will not execute it again.',
                } : {}) };
            }
            if (summary.status === 'incomplete' && summary.diagnostics.some(item => item.type === 'assistant_empty_response')
                && emptyResponses++ === 0) {
                return { action: 'continue', reason: 'corrective_turn',
                    runtimeInstruction: 'The response contained no answer or tool call. Return an answer to the current request, or call an available tool if needed.' };
            }
            terminal = { action: 'stop', reason: summary.status,
                status: summary.status === 'completed_with_warning' ? 'completed_with_warning'
                    : summary.status === 'aborted' ? 'aborted' : summary.status === 'error' ? 'error'
                        : summary.status === 'incomplete' ? 'incomplete' : 'completed' };
            return terminal;
        },
        finalizeAfterTurn(_summary, context) {
            return terminal ??= { action: 'stop', status: context.defaultStatus, reason: context.reason };
        },
    };
}

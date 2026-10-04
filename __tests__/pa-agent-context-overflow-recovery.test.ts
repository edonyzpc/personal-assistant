import { describe, expect, it, jest } from '@jest/globals';
import { PaAgentLoop, type PaAgentTurnSummary } from '../src/ai-services/pa-agent-loop';
import { createPaAgentHostPolicy } from '../src/ai-services/pa-agent-host-policy';
import { ProviderAdmissionError } from '../src/ai-services/provider-admission-error';
import { PaAgentContextOverflowError } from '../src/ai-services/context/PaAgentContextOverflowError';

const providerOverflow = () => Object.assign(new Error('Request too large'), {
    status: 400, code: 'context_length_exceeded',
});

describe('PA Agent provider context recovery', () => {
    it.each([
        ['provider code', providerOverflow],
        ['provider template', () => Object.assign(new Error(
            "This model's maximum context length is 128000 tokens. However, you requested 130000 tokens."), { status: 400 })],
        ['prompt template', () => Object.assign(new Error('prompt is too long: 210000 tokens > 200000 maximum'), { status: 400 })],
    ] as const)('reprojects once for %s without replaying effects or failed buffered calls', async (_label, error) => {
        let requests = 0;
        let projectionRevision = 0;
        let failedAssistantId: string | undefined;
        const executed: string[] = [];
        const recover = jest.fn<(summary: PaAgentTurnSummary) => boolean>(summary => {
            failedAssistantId = summary.assistantMessage.id;
            expect(summary.diagnostics).toContainEqual({ type: 'provider_context_overflow' });
            projectionRevision += 1;
            return true;
        });
        const result = await new PaAgentLoop({ runId: 'context-recovery', userInput: 'Complete the task',
            hostPolicy: createPaAgentHostPolicy(), recoverContextOverflow: recover,
            prepareModelInput: input => ({ ...input, hostContext: { projectionRevision } }),
            toolExecutor: { execute: async call => {
                executed.push(call.toolCall.name);
                return { outcome: 'success', promptText: 'Original effect completed.', executionState: 'succeeded' };
            } },
            model: { stream: async function* (input) {
                requests += 1;
                if (requests === 1) {
                    yield { type: 'toolcall_delta', id: 'original-effect', name: 'write_once', input: {}, index: 0 } as const;
                    yield { type: 'provider_completion', completion: 'tool_calls' } as const;
                } else if (requests === 2) {
                    yield { type: 'toolcall_delta', id: 'failed-buffer', name: 'must_not_execute', input: {}, index: 0 } as const;
                    throw error();
                } else {
                    expect(input.hostContext).toEqual({ projectionRevision: 1 });
                    expect(input.transcript.some(message => message.id === failedAssistantId)).toBe(false);
                    expect(input.transcript.some(message => message.role === 'toolResult'
                        && message.toolCallId === 'original-effect')).toBe(true);
                    yield { type: 'text_delta', text: 'Completed from the preserved result.' } as const;
                    yield { type: 'provider_completion', completion: 'stop' } as const;
                }
            } },
        }).run();
        expect(result.status).toBe('completed');
        expect(requests).toBe(3);
        expect(recover).toHaveBeenCalledTimes(1);
        expect(executed).toEqual(['write_once']);
        expect(result.transcript.find(message => message.id === failedAssistantId)).toMatchObject({
            role: 'assistant', stopReason: 'error',
            content: [expect.objectContaining({ type: 'toolCall', name: 'must_not_execute' })],
        });
    });

    it('recovers a later overflow after a successful tool turn without restoring failed calls or replaying effects', async () => {
        let requests = 0;
        const failedAssistantIds: string[] = [];
        const executed: string[] = [];
        const recover = jest.fn<(summary: PaAgentTurnSummary) => boolean>(summary => {
            failedAssistantIds.push(summary.assistantMessage.id);
            return true;
        });
        const result = await new PaAgentLoop({ runId: 'separate-overflows', userInput: 'Complete the task',
            hostPolicy: createPaAgentHostPolicy(), recoverContextOverflow: recover,
            toolExecutor: { execute: async call => {
                executed.push(call.toolCall.name);
                return { outcome: 'success', promptText: 'Effect completed.', executionState: 'succeeded' };
            } },
            model: { stream: async function* (input) {
                requests += 1;
                for (const id of failedAssistantIds) {
                    expect(input.transcript.some(message => message.id === id)).toBe(false);
                }
                if (requests === 1 || requests === 3) {
                    yield { type: 'toolcall_delta', id: `failed-buffer-${requests}`,
                        name: 'must_not_execute', input: {}, index: 0 } as const;
                    throw providerOverflow();
                }
                if (requests === 2) {
                    yield { type: 'toolcall_delta', id: 'completed-effect', name: 'write_once', input: {}, index: 0 } as const;
                    yield { type: 'provider_completion', completion: 'tool_calls' } as const;
                    return;
                }
                expect(failedAssistantIds).toHaveLength(2);
                expect(input.transcript.some(message => message.role === 'toolResult'
                    && message.toolCallId === 'completed-effect')).toBe(true);
                yield { type: 'text_delta', text: 'Completed from the preserved result.' } as const;
                yield { type: 'provider_completion', completion: 'stop' } as const;
            } },
        }).run();
        expect(result.status).toBe('completed');
        expect(requests).toBe(4);
        expect(recover).toHaveBeenCalledTimes(2);
        expect(executed).toEqual(['write_once']);
        for (const id of failedAssistantIds) {
            expect(result.transcript.find(message => message.id === id)).toMatchObject({
                role: 'assistant', stopReason: 'error',
                content: [expect.objectContaining({ type: 'toolCall', name: 'must_not_execute' })],
            });
        }
    });

    it('stops after the second consecutive overflow even when the recovery hook would accept again', async () => {
        const recover = jest.fn<() => boolean>(() => true);
        let requests = 0;
        const result = await new PaAgentLoop({ runId: 'overflow-twice', userInput: 'Answer',
            recoverContextOverflow: recover,
            model: { stream: async function* () { requests += 1; throw providerOverflow(); } },
        }).run();
        expect(result.status).toBe('incomplete');
        expect(result.endPayload?.reason).toBe('provider_context_overflow');
        expect(requests).toBe(2);
        expect(recover).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['ordinary 400', () => Object.assign(new Error('Invalid request: unsupported parameter'), { status: 400 })],
        ['source admission', () => new ProviderAdmissionError(providerOverflow())],
        ['local estimate', () => new PaAgentContextOverflowError(1200, 1000)],
    ] as const)('does not recover %s as a provider context rejection', async (_label, error) => {
        const recover = jest.fn<() => boolean>(() => true);
        const result = await new PaAgentLoop({ runId: 'not-provider-overflow', userInput: 'Answer',
            recoverContextOverflow: recover,
            model: { stream: async function* () { throw error(); } },
        }).run();
        expect(result.status).toBe('error');
        expect(result.turns).toHaveLength(1);
        expect(recover).not.toHaveBeenCalled();
        expect(result.turns[0].diagnostics.some(item => item.type === 'provider_context_overflow')).toBe(false);
    });

    it('does not recover after cancellation during a failed provider attempt', async () => {
        const abort = new AbortController();
        const recover = jest.fn<() => boolean>(() => true);
        const result = await new PaAgentLoop({ runId: 'cancel-before-recovery', userInput: 'Answer',
            signal: abort.signal, recoverContextOverflow: recover,
            model: { stream: async function* () { abort.abort(); throw providerOverflow(); } },
        }).run();
        expect(result.status).toBe('aborted');
        expect(recover).not.toHaveBeenCalled();
    });

    it('cancels a pending recovery without dispatching another request', async () => {
        const abort = new AbortController();
        let started!: () => void;
        const recoveryStarted = new Promise<void>(resolve => { started = resolve; });
        let requests = 0;
        const run = new PaAgentLoop({ runId: 'cancel-recovery', userInput: 'Answer', signal: abort.signal,
            recoverContextOverflow: () => { started(); return new Promise<boolean>(() => undefined); },
            model: { stream: async function* () { requests += 1; throw providerOverflow(); } },
        }).run();
        await recoveryStarted;
        abort.abort();
        expect((await run).status).toBe('aborted');
        expect(requests).toBe(1);
    });

    it('does not retry an overflow after committing partial answer text', async () => {
        const recover = jest.fn<() => boolean>(() => true);
        const result = await new PaAgentLoop({ runId: 'overflow-after-text', userInput: 'Answer',
            recoverContextOverflow: recover,
            model: { stream: async function* () {
                yield { type: 'text_delta', text: 'Partial answer.' } as const;
                throw providerOverflow();
            } },
        }).run();
        expect(result.status).toBe('incomplete');
        expect(result.committedFinalText).toBe('Partial answer.');
        expect(recover).not.toHaveBeenCalled();
    });
});

describe('PA Agent explicitly configured run capacity', () => {
    it('passes both former default limits during a normal run', async () => {
        let requests = 0;
        let executions = 0;
        const result = await new PaAgentLoop({ runId: 'uncapped-default', userInput: 'Read the necessary entries',
            hostPolicy: createPaAgentHostPolicy(),
            toolExecutor: { execute: async () => { executions += 1; return { outcome: 'success', promptText: 'read' }; } },
            model: { stream: async function* () {
                requests += 1;
                if (requests <= 257) {
                    for (let index = 0; index < 4; index++) yield { type: 'toolcall_delta',
                        id: `read-${requests}-${index}`, name: 'read_entry', input: { entry: requests * 4 + index }, index } as const;
                    yield { type: 'provider_completion', completion: 'tool_calls' } as const;
                } else {
                    yield { type: 'text_delta', text: 'All entries read.' } as const;
                    yield { type: 'provider_completion', completion: 'stop' } as const;
                }
            } },
        }).run();
        expect(result.status).toBe('completed');
        expect(requests).toBe(258);
        expect(executions).toBe(1028);
    });

    it('preserves explicit turn and tool limits', async () => {
        let executions = 0;
        const result = await new PaAgentLoop({ runId: 'explicit-capacity', userInput: 'Read entries',
            maxTurns: 2, maxToolCalls: 1, hostPolicy: createPaAgentHostPolicy(),
            toolExecutor: { execute: async () => { executions += 1; return { outcome: 'success', promptText: 'read' }; } },
            model: { stream: async function* (input) {
                yield { type: 'toolcall_delta', id: `read-${input.turnIndex}`, name: 'read_entry',
                    input: { entry: input.turnIndex }, index: 0 } as const;
                yield { type: 'provider_completion', completion: 'tool_calls' } as const;
            } },
        }).run();
        expect(result.status).toBe('incomplete');
        expect(result.turns).toHaveLength(2);
        expect(result.endPayload?.reason).toBe('max_turns_exceeded');
        expect(executions).toBe(1);
        expect(result.turns[1].toolResults[0].content.metadata?.outcome).toBe('budget_exceeded');
    });
});

import { describe, expect, it } from '@jest/globals';
import { PaAgentLoop, type PaAgentToolExecutor } from '../src/ai-services/pa-agent-loop';
import { createPaAgentHostPolicy } from '../src/ai-services/pa-agent-host-policy';

describe('minimal Host mechanical recovery', () => {
    it.each([false, true])('continues different searches; stops a replay-only loop (repeat=%s)', async repeat => {
        let turns = 0, executions = 0;
        const result = await new PaAgentLoop({
            runId: 'minimal', userInput: 'Investigate three sources', maxTurns: 8,
            hostPolicy: createPaAgentHostPolicy(),
            model: { stream: async function* () {
                const index = ++turns;
                if (repeat || index <= 3) {
                    yield { type: 'toolcall_delta', id: `call-${index}`, name: 'webSearch',
                        input: { query: repeat ? 'same' : `source-${index}` }, index: 0 } as const;
                    yield { type: 'provider_completion', completion: 'tool_calls' } as const;
                } else {
                    yield { type: 'text_delta', text: 'Three sources compared.' } as const;
                    yield { type: 'provider_completion', completion: 'stop' } as const;
                }
            } },
            toolExecutor: { execute: async () => { executions++;
                return { outcome: 'success', promptText: 'Source facts', executionState: 'succeeded' }; } },
        }).run();
        expect(executions).toBe(repeat ? 1 : 3);
        expect(result.status).toBe(repeat ? 'incomplete' : 'completed');
        expect(turns).toBe(repeat ? 3 : 4);
        if (repeat) expect(result.endPayload).toMatchObject({ reason: 'identical_batch_replayed' });
    });

    it('uses actual canonical call identity and blocks unknown side-effect replay', async () => {
        let calls = 0, turns = 0;
        const toolExecutor: PaAgentToolExecutor = {
            getCanonicalToolCallKey: () => 'bound-operation-1',
            execute: async () => { calls++; return { outcome: 'recoverable_error',
                promptText: 'Acceptance unknown', executionState: 'acceptance_unknown' }; },
        };
        const result = await new PaAgentLoop({ runId: 'unknown', userInput: 'Check existing operation', maxTurns: 8,
            hostPolicy: createPaAgentHostPolicy(), toolExecutor,
            model: { stream: async function* () {
                yield { type: 'toolcall_delta', id: `call-${++turns}`, name: 'create_image',
                    input: { wording: turns }, index: 0 } as const;
                yield { type: 'provider_completion', completion: 'tool_calls' } as const;
            } },
        }).run();
        expect(calls).toBe(1);
        expect(turns).toBe(3);
        expect(result.status).toBe('incomplete');
        expect(result.turns[2].toolResults[0].content.metadata).toMatchObject({ replayBlocked: true });
    });

    it('recognizes equivalent JSON argument text as the same replay batch', async () => {
        let turns = 0, calls = 0;
        const result = await new PaAgentLoop({ runId: 'json-replay', userInput: 'Read one note', maxTurns: 8,
            hostPolicy: createPaAgentHostPolicy(),
            model: { stream: async function* () {
                const turn = ++turns;
                yield { type: 'toolcall_delta', id: `call-${turn}`, name: 'read_note', index: 0,
                    argsText: turn % 2 ? '{"path":"A.md","startLine":1}' : '{ "startLine":1, "path":"A.md" }' } as const;
                yield { type: 'provider_completion', completion: 'tool_calls' } as const;
            } },
            toolExecutor: { execute: async () => { calls++;
                return { outcome: 'success', promptText: 'Note text', executionState: 'succeeded' }; } },
        }).run();
        expect(calls).toBe(1);
        expect(turns).toBe(3);
        expect(result.status).toBe('incomplete');
    });
});

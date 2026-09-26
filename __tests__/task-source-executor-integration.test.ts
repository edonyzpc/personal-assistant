import { PaAgentLoop } from '../src/ai-services/pa-agent-loop';
import { createWriteActionAwareToolExecutor } from '../src/ai-services/pa-agent-runtime';
import { createOperationsStagingToolExecutor } from '../src/ai-services/operations/operations-tool-executor';
import type { PaAgentToolExecutor } from '../src/ai-services/pa-agent-types';

jest.mock('obsidian');

describe('action wrapper batch preflight forwarding', () => {
    it.each(['operations', 'write-action'] as const)('%s forwards a batch rejection before preparing any action', async wrapper => {
        const execute = jest.fn(async () => ({ outcome: 'success' as const, promptText: 'must not read' }));
        const prepareBatch = jest.fn(async () => undefined);
        const canonical = jest.fn(() => 'must-not-prepare');
        const mode = jest.fn(() => 'sequential' as const);
        // Stub the Host decision to isolate wrapper forwarding. Real source
        // admission is covered by the read-plan and constrained-executor suites.
        const rejection = {
            outcome: 'policy_rejected' as const,
            promptText: 'The Host rejected the complete source batch.',
            metadata: { reason: 'source_read_outside_scope' },
        };
        const preflightBatch = jest.fn(() => rejection);
        const base: PaAgentToolExecutor = { execute, prepareBatch, getCanonicalToolCallKey: canonical,
            getExecutionMode: mode, preflightBatch };
        const lookup = jest.fn(() => { throw new Error('registry preparation must not run'); });
        const registry = { get: lookup, prepareAndValidate: lookup } as never;
        const stageIntent = jest.fn();
        const executeAction = jest.fn();
        const executor = wrapper === 'operations'
            ? createOperationsStagingToolExecutor({ baseExecutor: base, registry, controller: { stageIntent } })
            : createWriteActionAwareToolExecutor({ baseExecutor: base, registry, host: {} as never,
                actionExecutor: { execute: executeAction } as never });
        const loop = new PaAgentLoop({ runId: 'run', userInput: '只用当前笔记', maxTurns: 1,
            toolExecutionMode: 'hybrid', toolExecutor: executor,
            model: { stream: async function* () {
                yield { type: 'toolcall_delta', id: 'read-a', name: 'get_current_note_context', input: {}, index: 0 } as const;
                yield { type: 'toolcall_delta', id: 'write-b', name: 'frontmatter_update', input: { path: 'b.md', set: { state: 'done' } }, index: 1 } as const;
            } } });
        const result = await loop.run();
        expect(preflightBatch).toHaveBeenCalledTimes(1);
        expect(preflightBatch).toHaveBeenCalledWith(expect.objectContaining({
            runId: 'run', userInput: '只用当前笔记',
            toolCalls: [
                expect.objectContaining({ id: 'read-a', name: 'get_current_note_context', input: {}, index: 0 }),
                expect.objectContaining({ id: 'write-b', name: 'frontmatter_update',
                    input: { path: 'b.md', set: { state: 'done' } }, index: 1 }),
            ],
        }));
        expect(result.turns[0].toolResults).toHaveLength(2);
        for (const toolResult of result.turns[0].toolResults) {
            expect(toolResult.content).toMatchObject({
                promptText: rejection.promptText,
                metadata: { outcome: 'policy_rejected', reason: 'source_read_outside_scope',
                    preflightOnly: true, batchPreflightRejected: true },
            });
        }
        for (const operation of [execute, prepareBatch, canonical, mode, lookup, stageIntent, executeAction]) {
            expect(operation).not.toHaveBeenCalled();
        }
    });
});

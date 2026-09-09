import { PaAgentLoop } from '../src/ai-services/pa-agent-loop';
import { createWriteActionAwareToolExecutor } from '../src/ai-services/pa-agent-runtime';
import { createOperationsStagingToolExecutor } from '../src/ai-services/operations/operations-tool-executor';
import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';
import type { PaAgentToolExecutor } from '../src/ai-services/pa-agent-types';

jest.mock('obsidian');

describe('B-135 source preflight through action wrappers', () => {
    it.each(['operations', 'write-action'] as const)('%s cannot prepare part of a rejected material batch', async wrapper => {
        const scope = new TaskSourceConstraintState({ runId: 'run', userMessageId: 'u',
            userText: '只用当前笔记', currentNoteHandle: 'active', noteHandles: new Map([['active', 'a']]) });
        const execute = jest.fn(async () => ({ outcome: 'success' as const, promptText: 'must not read' }));
        const prepareBatch = jest.fn(async () => undefined);
        const canonical = jest.fn(() => 'must-not-prepare');
        const mode = jest.fn(() => 'sequential' as const);
        const preflightBatch: NonNullable<PaAgentToolExecutor['preflightBatch']> = input => {
            const candidate = scope.prepareDeclaration({ notes: 'current_note', webAllowed: false,
                instructionQuote: '只用当前笔记' });
            if (!candidate.ok) throw new Error(candidate.reason);
            // These are host-held read plans, not source identities supplied by model args.
            const reads = new Map([['get_current_note_context', 'a'], ['frontmatter_update', 'b']]);
            const allowed = input.toolCalls.every(call => scope.allows({ kind: 'note', noteId: reads.get(call.name)! }, candidate.constraint));
            if (!allowed) return { outcome: 'policy_rejected', promptText: 'The complete batch must stay within the current note.' };
            if (!scope.commit(candidate.constraint)) throw new Error('stale batch');
            return undefined;
        };
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
        expect(result.turns[0].toolResults).toHaveLength(2);
        expect(scope.snapshot()).toBeUndefined();
        for (const operation of [execute, prepareBatch, canonical, mode, lookup, stageIntent, executeAction]) {
            expect(operation).not.toHaveBeenCalled();
        }
    });
});

import { WritingContextRun, type WritingContextRunHost } from '../src/ai-services/writing-context-run';
import { createWritingContextTool, createWritingContextCapability, GET_WRITING_CONTEXT } from '../src/ai-services/writing-context-tool';
import type { AgentCapabilityContext } from '../src/ai-services/capability-types';

const input = { parentHandle: null, scene: null, currentInstructionConflicts: false, imageRefs: [] };
function setup(outputBudgetChars = 1000) {
    const prepare = jest.fn(async () => ({ context: 'Approved style', revisionIds: ['style1'], isCurrent: () => true }));
    const host: WritingContextRunHost = {
        runId: 'run', conversationId: 'chat', candidates: [], isCurrent: () => true,
        isParentCurrent: () => false,
        versions: { get: jest.fn(async () => null) }, styles: { prepare },
        verifyImages: jest.fn(async () => ({ images: [], isCurrent: () => true })),
    };
    const run = new WritingContextRun(host);
    const toolHost = { outputBudgetChars, getBudget: () => ({ remainingTextChars: 800, remainingMemoryChars: 600 }) };
    const definition = createWritingContextTool(run, toolHost);
    const capability = createWritingContextCapability(run, toolHost);
    return { run, definition, capability, host, prepare };
}
const context = { host: { log: jest.fn() } } as unknown as AgentCapabilityContext;

describe('get_writing_context tool boundary', () => {
    it('exports a closed schema and prepares through the real capability adapter', async () => {
        const f = setup();
        expect(f.capability.executionMode).toBe('sequential');
        expect(f.capability.toProviderSchema()).toMatchObject({ function: { name: GET_WRITING_CONTEXT,
            parameters: { additionalProperties: false, required: ['parentHandle', 'currentInstructionConflicts', 'imageRefs'],
                properties: { scene: { type: 'object' } } } } });
        expect(f.capability.prepareAndValidate?.(input, { userInput: 'write something' }).ok).toBe(true);
        const result = await f.capability.execute(input, context);
        expect(result.status).toBe('ok');
        expect(result.sourceRecords).toEqual([]);
        expect(result.observation).toEqual({ contextHandle: 'run:writing:1', parent: null, scene: null, images: [],
            style: { context: 'Approved style', revisionIds: ['style1'] } });
        const budget = (f.prepare.mock.calls as unknown[][])[0][1] as { remainingTextChars: number; remainingMemoryChars: number };
        expect(budget.remainingTextChars).toBeGreaterThan(0);
        expect(budget.remainingTextChars).toBeLessThan(800);
        expect(budget.remainingMemoryChars).toBe(600);
        expect((await f.run.validate('run:writing:1')).styleRevisionIds).toEqual(['style1']);
    });

    it('keeps omitted and legacy null scenes equivalent without accepting encoded objects', async () => {
        const f = setup();
        const { scene: _scene, ...omitted } = input;
        const absent = f.capability.prepareAndValidate!(omitted, { userInput: '' });
        const legacy = f.capability.prepareAndValidate!(input, { userInput: '' });
        expect(absent).toMatchObject({ ok: true, input });
        expect(legacy).toMatchObject({ ok: true, input });
        expect((await f.capability.execute(omitted, context)).status).toBe('ok');
        expect(f.run.current()?.scene).toBeUndefined();
        for (const scene of ['null', '{}', { purpose: 'only one field' }]) {
            expect(f.capability.prepareAndValidate!({ ...input, scene }, { userInput: '' }).ok).toBe(false);
        }
    });

    it.each(['parentVersionId', 'path', 'styleRevisionIds', 'remainingTextChars', 'permission'])('rejects model-supplied %s before any preparation', async key => {
        const f = setup();
        const raw = { ...input, [key]: 'invented' };
        expect(f.capability.prepareAndValidate?.(raw, { userInput: '' }).ok).toBe(false);
        expect((await f.capability.execute(raw, context)).status).not.toBe('ok');
        expect(f.host.verifyImages).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
    });

    it('rejects a context that does not fit without publishing or truncating it', async () => {
        const f = setup(40);
        const result = await f.capability.execute(input, context);
        expect(result.status).not.toBe('ok');
        expect(f.prepare).not.toHaveBeenCalled();
        await expect(f.run.validate('run:writing:1')).rejects.toThrow('Unknown writing context');
    });

    it('omits optional escaped style and its revisions before publishing a bounded context', async () => {
        const f = setup();
        const prior = await f.capability.execute(input, context);
        expect(prior.status).toBe('ok');
        f.prepare.mockImplementation(async () => ({ context: '\\'.repeat(700), revisionIds: ['oversized-style'], isCurrent: () => true }));
        const next = await f.capability.execute(input, context);
        expect(next.status).toBe('ok');
        expect(next.observation).toMatchObject({ contextHandle: 'run:writing:2',
            style: { context: '', revisionIds: [] } });
        expect(JSON.stringify(next.observation).length).toBeLessThanOrEqual(800);
        const prepared = await f.run.validate('run:writing:2');
        expect(prepared.styleContext).toBe('');
        expect(prepared.styleRevisionIds).toEqual([]);
        await expect(f.run.validate('run:writing:1')).rejects.toThrow();
    });

    it('keeps the prior receipt when fitting raw style exceeds the serialized budget after escaping', async () => {
        const f = setup();
        expect((await f.capability.execute(input, context)).status).toBe('ok');
        // Raw style fits the 600-character Memory allowance, while its JSON
        // escaping plus the required context envelope exceeds the text budget.
        f.prepare.mockImplementation(async () => ({ context: '\\'.repeat(400), revisionIds: ['escaped-style'], isCurrent: () => true }));
        expect((await f.capability.execute(input, context)).status).not.toBe('ok');
        const prior = await f.run.validate('run:writing:1');
        expect(prior.styleContext).toBe('Approved style');
        expect(prior.styleRevisionIds).toEqual(['style1']);
        await expect(f.run.validate('run:writing:2')).rejects.toThrow();
    });
});

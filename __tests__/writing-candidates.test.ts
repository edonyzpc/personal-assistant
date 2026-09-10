import { ConversationPersistence } from '../src/chat/ConversationPersistence';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { WritingVersionService } from '../src/chat/writing-versions';
import { WritingContextRun } from '../src/ai-services/writing-context-run';

async function setup() {
    const store = new MemoryChatHistoryStore();
    const manager = new ChatHistoryManager({ store, generateId: () => 'chat' });
    await manager.initialize();
    const conversation = await manager.startConversation('Writing');
    const persistence = new ConversationPersistence({ getManager: () => manager, log: jest.fn() });
    persistence.hydrateConversation(conversation, []);
    const versions = new WritingVersionService(store);
    const parent = await versions.create({ requestId: 'request', messageId: 'message', conversationId: conversation.id,
        turnIndex: 0, text: 'An approved parent', images: [] });
    const state = { current: true, ids: [parent.id] };
    const input = { isCurrent: () => state.current, getAllowedVersionIds: () => state.ids };
    return { store, manager, persistence, versions, parent, state, input };
}

describe('Chat writing candidate source lifetime', () => {
    it('captures only allowed versions and supplies a live parent guard to the writing context run', async () => {
        const f = await setup();
        await f.versions.create({ requestId: 'hidden', messageId: 'hidden', conversationId: 'chat', turnIndex: 1, text: 'Not offered', images: [] });
        const snapshot = await f.persistence.prepareWritingCandidates(f.versions, f.input);
        expect(snapshot.candidates).toEqual([f.parent]);
        const run = new WritingContextRun({ runId: 'run', conversationId: 'chat', candidates: snapshot.candidates,
            versions: f.versions, isCurrent: f.input.isCurrent, isParentCurrent: snapshot.isParentCurrent,
            styles: { prepare: async () => ({ context: '', revisionIds: [], isCurrent: () => true }) },
            verifyImages: async () => ({ images: [], isCurrent: () => true }),
        });
        const prepared = await run.prepare({ parentHandle: run.candidateDirectory()[0].handle,
            currentInstructionConflicts: false, imageRefs: [] }, { remainingTextChars: 1000, remainingMemoryChars: 1000 });
        expect((await run.validate(prepared.handle)).parent?.text).toBe(f.parent.text);
        await f.manager.deleteConversation('chat');
        expect(snapshot.isParentCurrent(f.parent)).toBe(false);
        await expect(run.validate(prepared.handle)).rejects.toThrow('parent changed');
    });

    it.each(['session', 'selection', 'reset'] as const)('invalidates a captured parent after %s changes', async kind => {
        const f = await setup();
        const snapshot = await f.persistence.prepareWritingCandidates(f.versions, f.input);
        if (kind === 'session') f.state.current = false;
        else if (kind === 'selection') f.state.ids = [];
        else f.persistence.resetActiveConversationState();
        expect(snapshot.isParentCurrent(f.parent)).toBe(false);
    });

    it('invalidates before asynchronous deletion finishes', async () => {
        const f = await setup();
        const snapshot = await f.persistence.prepareWritingCandidates(f.versions, f.input);
        let began!: () => void, release!: () => void;
        const started = new Promise<void>(resolve => { began = resolve; });
        const waiting = new Promise<void>(resolve => { release = resolve; });
        jest.spyOn(f.store, 'deleteTurnsForConversation').mockImplementation(async () => { began(); await waiting; });
        const deletion = f.manager.deleteConversation('chat');
        await started;
        expect(snapshot.isParentCurrent(f.parent)).toBe(false);
        release(); await deletion;
    });

    it('rejects source mutation during a candidate read', async () => {
        const f = await setup();
        const get = f.versions.get.bind(f.versions);
        jest.spyOn(f.versions, 'get').mockImplementationOnce(async id => {
            const value = await get(id);
            await f.manager.deleteConversation('chat');
            return value;
        });
        await expect(f.persistence.prepareWritingCandidates(f.versions, f.input)).rejects.toThrow('scope changed');
    });

    it('does not offer another conversation or a missing version even if the UI candidate list is stale', async () => {
        const f = await setup();
        const foreign = await f.versions.create({ requestId: 'foreign', messageId: 'foreign', conversationId: 'other',
            turnIndex: 0, text: 'Foreign body', images: [] });
        f.state.ids = [foreign.id, 'missing', f.parent.id, f.parent.id];
        const snapshot = await f.persistence.prepareWritingCandidates(f.versions, f.input);
        expect(snapshot.candidates).toEqual([f.parent]);
        expect(snapshot.isParentCurrent(foreign)).toBe(false);
        snapshot.candidates[0].text = 'changed outside';
        expect(snapshot.isParentCurrent(snapshot.candidates[0])).toBe(false);
        expect(snapshot.isParentCurrent(f.parent)).toBe(true);
    });

    it('propagates cancellation after a version lookup', async () => {
        const f = await setup();
        const controller = new AbortController();
        jest.spyOn(f.versions, 'get').mockImplementationOnce(async () => { controller.abort(); return f.parent; });
        await expect(f.persistence.prepareWritingCandidates(f.versions, { ...f.input, signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });
});

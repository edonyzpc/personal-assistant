import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { ConversationPersistence } from '../src/chat/ConversationPersistence';
import type { TimelineEntry } from '../src/chat/types';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}
const entry = (text = 'first'): TimelineEntry => ({ kind: 'history', user: { role: 'user', content: text },
    assistant: { role: 'assistant', content: `Answer ${text}` } });
async function setup() {
    const store = new MemoryChatHistoryStore();
    let id = 0;
    const manager = new ChatHistoryManager({ store, generateId: () => `conversation-${++id}` });
    await manager.initialize();
    const first = await manager.startConversation('First');
    const other = await manager.startConversation('Other');
    const persistence = new ConversationPersistence({ getManager: () => manager, log: jest.fn() });
    persistence.hydrateConversation(first, []);
    return { store, manager, persistence, first, other };
}

describe('writing conversation commit admission', () => {
    it.each(['reset', 'same-id-reopen', 'other-conversation'] as const)('does not prepare or write after %s while obtaining the manager', async mode => {
        const f = await setup();
        const started = deferred(), release = deferred();
        jest.spyOn(f.manager, 'initialize').mockImplementationOnce(async () => { started.resolve(); await release.promise; });
        const prepare = jest.fn(async () => {});
        const pending = f.persistence.persistFinalizedTurn('first', entry(), prepare);
        await started.promise;
        if (mode === 'reset') f.persistence.resetActiveConversationState();
        else f.persistence.hydrateConversation(mode === 'same-id-reopen' ? f.first : f.other, []);
        release.resolve();
        expect(await pending).toBe(false);
        expect(prepare).not.toHaveBeenCalled();
        expect(await f.store.getTurns(f.first.id)).toEqual([]);
        expect(await f.store.getTurns(f.other.id)).toEqual([]);
    });

    it('does not attach a recovered version after the same conversation is rehydrated during preparation', async () => {
        const f = await setup();
        const original = entry();
        await f.persistence.persistFinalizedTurn('first', original);
        const started = deferred(), release = deferred();
        const record = jest.spyOn(f.manager, 'recordTurn');
        const pending = f.persistence.reviseFinalizedTurn(original, async () => {
            started.resolve(); await release.promise;
            if (original.kind === 'history') original.assistant.content = 'Obsolete recovery';
        });
        await started.promise;
        f.persistence.hydrateConversation(f.first, await f.store.getTurns(f.first.id));
        release.resolve();
        expect(await pending).toBe(false);
        expect(record).not.toHaveBeenCalled();
        expect((await f.store.getTurns(f.first.id))[0].assistant.content).toBe('Answer first');
    });

    it('retains an admitted old write without moving the new conversation cursor', async () => {
        const f = await setup();
        const started = deferred(), release = deferred();
        const write = f.store.appendTurnAndUpdateConversation.bind(f.store);
        jest.spyOn(f.store, 'appendTurnAndUpdateConversation').mockImplementationOnce(async (...args) => {
            started.resolve(); await release.promise; return write(...args);
        });
        const pending = f.persistence.persistFinalizedTurn('first', entry());
        await started.promise;
        f.persistence.hydrateConversation(f.other, []);
        release.resolve();
        expect(await pending).toBe(true);
        expect(f.persistence.activeConversationId).toBe(f.other.id);
        expect(f.persistence.activeConversationTurnCount).toBe(0);
        await f.persistence.persistFinalizedTurn('next', entry('next'));
        expect((await f.store.getTurns(f.first.id)).map(turn => turn.turnIndex)).toEqual([0]);
        expect((await f.store.getTurns(f.other.id)).map(turn => turn.turnIndex)).toEqual([0]);
    });

    it('keeps two queued turns in the same newly created conversation', async () => {
        const f = await setup();
        f.persistence.resetActiveConversationState();
        const first = f.persistence.persistFinalizedTurn('one', entry('one'));
        const second = f.persistence.persistFinalizedTurn('two', entry('two'));
        expect(await Promise.all([first, second])).toEqual([true, true]);
        expect((await f.store.getTurns(f.persistence.activeConversationId!)).map(turn => turn.turnIndex)).toEqual([0, 1]);
    });

    it('does not overwrite an admitted write when the same conversation reopens before it completes', async () => {
        const f = await setup();
        const started = deferred(), release = deferred();
        const write = f.store.appendTurnAndUpdateConversation.bind(f.store);
        jest.spyOn(f.store, 'appendTurnAndUpdateConversation').mockImplementationOnce(async (...args) => {
            started.resolve(); await release.promise; return write(...args);
        });
        const pending = f.persistence.persistFinalizedTurn('first', entry());
        await started.promise;
        f.persistence.hydrateConversation(f.first, []);
        release.resolve();
        expect(await pending).toBe(true);
        await f.persistence.persistFinalizedTurn('next', entry('next'));
        expect((await f.store.getTurns(f.first.id)).map(turn => [turn.turnIndex, turn.user.content]))
            .toEqual([[0, 'first'], [1, 'next']]);
    });
});

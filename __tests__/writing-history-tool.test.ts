import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { WritingVersionService } from '../src/chat/writing-versions';
import { completeInputLineage } from '../src/ai-services/input-lineage';
import type { AgentCapabilityContext } from '../src/ai-services/capability-types';
import { createWritingHistoryCapability, createWritingHistoryTool, WRITING_HISTORY_OUTPUT_BUDGET_CHARS,
    type WritingHistoryHost, type WritingHistoryObservation } from '../src/ai-services/writing-history-tool';

const context = { host: { log: jest.fn() } } as unknown as AgentCapabilityContext;
async function setup(text = 'A saved work') {
    const store = new MemoryChatHistoryStore();
    const versions = new WritingVersionService(store);
    const parent = await versions.create({ requestId: 'request', messageId: 'message', conversationId: 'chat',
        turnIndex: 0, text, images: [] });
    const state = { current: true, sourceCurrent: true, denied: new Set<string>() };
    const onObservation = jest.fn();
    const host: WritingHistoryHost = { conversationId: 'chat', versions, isCurrent: () => state.current,
        admitVersion: jest.fn(async version => state.denied.has(version.id) ? undefined : {
            lineage: completeInputLineage([{ kind: 'writing-version', versionId: version.id, textHash: version.textHash }]),
            isCurrent: () => state.current, isSourceCurrent: () => state.sourceCurrent,
            parentHandle: `run:parent:${version.id}`,
        }), onObservation };
    return { store, versions, parent, state, host, onObservation, capability: createWritingHistoryCapability(host) };
}

describe('read_writing_history', () => {
    it('uses a closed read-only boundary and paginates only admitted metadata without writes', async () => {
        const f = await setup();
        for (let i = 1; i <= 11; i++) await f.versions.create({ requestId: `r${i}`, messageId: `m${i}`,
            conversationId: 'chat', turnIndex: i, text: `Saved work ${i}`, images: [] });
        f.state.denied.add(f.parent.id);
        const put = jest.spyOn(f.store, 'putWritingVersion');
        expect(createWritingHistoryTool(f.host)).toMatchObject({ permission: 'read-only', cost: 'free', requiresConfirmation: false });
        const first = await f.capability.execute({ action: 'list' }, context);
        expect(first.status).toBe('ok');
        const page = first.observation as Extract<WritingHistoryObservation, { action: 'list' }>;
        expect(page.versions).toHaveLength(10);
        expect(JSON.stringify(page)).not.toContain(f.parent.id);
        expect(JSON.stringify(page)).not.toContain('Saved work');
        expect(page.nextCursor).toBe(page.versions[9].versionId);
        const next = await f.capability.execute({ action: 'list', cursor: page.nextCursor }, context);
        expect(next.observation).toMatchObject({ action: 'list', versions: [expect.any(Object)], nextCursor: null });
        expect(f.onObservation.mock.calls[0][1]).toHaveLength(10);
        expect(put).not.toHaveBeenCalled();
        expect(f.capability.prepareAndValidate!({ action: 'read', versionId: f.parent.id, conversationId: 'other' }, { userInput: '' }).ok).toBe(false);
        expect(f.capability.prepareAndValidate!({ action: 'list', versionId: f.parent.id }, { userInput: '' }).ok).toBe(false);
    });

    it('returns exact bounded chunks and real continuation offsets without splitting Unicode', async () => {
        const f = await setup('A😀B' + '\u0001'.repeat(4000));
        const first = await f.capability.execute({ action: 'read', versionId: f.parent.id, limit: 2 }, context);
        expect(first.observation).toMatchObject({ text: 'A', offset: 0, endOffset: 1, nextOffset: 1, complete: false });
        let offset = 0;
        let joined = '';
        while (true) {
            const result = await f.capability.execute({ action: 'read', versionId: f.parent.id, offset }, context);
            expect(result.status).toBe('ok');
            const chunk = result.observation as Extract<WritingHistoryObservation, { action: 'read' }>;
            expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(WRITING_HISTORY_OUTPUT_BUDGET_CHARS);
            expect(chunk.text).toBe(f.parent.text.slice(chunk.offset, chunk.endOffset));
            expect(chunk).toMatchObject({ versionId: f.parent.id, textHash: f.parent.textHash,
                totalLength: f.parent.text.length, parentHandle: `run:parent:${f.parent.id}` });
            joined += chunk.text;
            if (chunk.complete) { expect(chunk.nextOffset).toBeNull(); break; }
            offset = chunk.nextOffset!;
        }
        expect(joined).toBe(f.parent.text);
        expect((await f.capability.execute({ action: 'read', versionId: f.parent.id, offset: 2 }, context)).status).not.toBe('ok');
    });

    it('does not reveal foreign or denied versions and rechecks earlier page admissions before publication', async () => {
        const f = await setup();
        const foreign = await f.versions.create({ requestId: 'foreign', messageId: 'foreign', conversationId: 'other',
            turnIndex: 0, text: 'Foreign text', images: [] });
        expect((await f.capability.execute({ action: 'read', versionId: foreign.id }, context)).observation).toBeNull();
        f.state.denied.add(f.parent.id);
        expect((await f.capability.execute({ action: 'read', versionId: f.parent.id }, context)).observation).toBeNull();
        expect(f.onObservation).not.toHaveBeenCalled();
        f.state.denied.clear();
        await f.versions.create({ requestId: 'second', messageId: 'second', conversationId: 'chat',
            turnIndex: 1, text: 'Second text', images: [] });
        let calls = 0;
        f.host.admitVersion = async version => {
            if (++calls === 2) f.state.sourceCurrent = false;
            return { lineage: completeInputLineage(), isCurrent: () => true,
                isSourceCurrent: () => version.id !== f.parent.id || f.state.sourceCurrent };
        };
        const result = await f.capability.execute({ action: 'list' }, context);
        expect(result.status).not.toBe('ok');
        expect(result.observation).toBeNull();
        expect(f.onObservation).not.toHaveBeenCalled();
    });

    it('rejects a conversation change during storage access and cancellation before admission', async () => {
        const f = await setup();
        const get = f.versions.get.bind(f.versions);
        jest.spyOn(f.versions, 'get').mockImplementationOnce(async id => {
            const version = await get(id); f.state.current = false; return version;
        });
        expect((await f.capability.execute({ action: 'read', versionId: f.parent.id }, context)).observation).toBeNull();
        expect(f.host.admitVersion).not.toHaveBeenCalled();
        f.state.current = true;
        const controller = new AbortController();
        controller.abort();
        await expect(f.capability.execute({ action: 'list' }, { ...context, signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(f.onObservation).not.toHaveBeenCalled();
    });
});

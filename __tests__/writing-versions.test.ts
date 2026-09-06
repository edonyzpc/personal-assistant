import { WritingVersionService, type WritingVersionStore } from '../src/chat/writing-versions';
import { cloneWritingVersion, hashWritingText, type WritingVersion } from '../src/chat/writing-types';
import { hasWritingNoteProvenance } from '../src/chat/writing-note-provenance';
import type { MessageImage } from '../src/chat/image-types';

const photo = (id: string): MessageImage => ({ ref: { assetId: id, contentHash: 'a'.repeat(64) }, ordinal: 1, label: `${id}.jpg` });
function setup() {
    const records = new Map<string, WritingVersion>();
    const store: WritingVersionStore = {
        getWritingVersion: async (id) => records.has(id) ? cloneWritingVersion(records.get(id)) : null,
        listWritingVersions: async (conversationId) => [...records.values()].filter((v) => v.conversationId === conversationId).map(cloneWritingVersion),
        putWritingVersion: jest.fn(async (version) => { records.set(version.id, cloneWritingVersion(version)); }),
    };
    return { service: new WritingVersionService(store, () => 100), store, records };
}
const input = () => ({ requestId: 'request1', messageId: 'message1', conversationId: 'chat1', turnIndex: 0,
    text: '  海边的风\n保留换行。🙂  ', explanation: '正文以外的说明', images: [photo('one')] });

describe('immutable writing versions', () => {
    test('records current request references without claiming parent samples were sent again', async () => {
        const { service, records } = setup();
        const first = await service.create({ ...input(), backgroundSourceRefs: [{ path: 'before.md' }], styleRevisionIds: ['old-style'] });
        const next = await service.create({ ...input(), requestId: 'next', messageId: 'next', parentVersionId: first.id,
            backgroundSourceRefs: [{ path: 'current.md' }], styleRevisionIds: [] });
        expect(next.backgroundSourceRefs).toEqual([{ path: 'current.md' }]);
        expect(next.styleRevisionIds).toEqual([]); expect(next.referenceScope).toBe('request');
        const edit = await service.edit(first.id, 'Local edit', 'edit');
        expect(edit.styleRevisionIds).toEqual(['old-style']); expect(edit.referenceScope).toBe('request');
        delete records.get(first.id)!.referenceScope;
        const legacyEdit = await service.edit(first.id, 'Legacy edit', 'legacy-edit');
        expect(legacyEdit.referenceScope).toBeUndefined();
    });
    test('keeps exact chosen text, separate explanation and full version material', async () => {
        const { service } = setup();
        const original = input();
        const first = await service.create(original);
        expect(first.text).toBe(original.text);
        expect(first.textHash).toBe(await hashWritingText(original.text));
        expect(first.origin).toBe('ai_generated');
        const next = await service.create({ ...input(), requestId: 'request2', messageId: 'message2',
            parentVersionId: first.id, images: [photo('one'), ...Array.from({ length: 8 }, (_, n) => photo(`other${n}`))] });
        expect(next.associatedImages).toHaveLength(9);
        expect(next.associatedImages.map((entry) => entry.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect((await service.get(first.id))?.associatedImages).toHaveLength(1);
        next.associatedImages[0].label = 'mutated';
        expect((await service.get(next.id))?.associatedImages[0].label).toBe('one.jpg');
    });

    test('snapshots inputs before async persistence and accepts duplicate delivery only for identical material', async () => {
        const { service, store } = setup();
        const supplied = input();
        const pending = service.create(supplied);
        supplied.images[0].ref.assetId = 'replacement';
        supplied.text = 'changed outside';
        const version = await pending;
        expect(version.text).toBe(input().text);
        expect(version.associatedImages[0].ref.assetId).toBe('one');
        expect(await service.create(input())).toEqual(version);
        expect(store.putWritingVersion).toHaveBeenCalledTimes(1);
        await expect(service.create({ ...input(), images: [photo('different')] })).rejects.toThrow('identity conflict');
        await expect(service.create({ ...input(), origin: 'user_edited' })).rejects.toThrow('identity conflict');
        await expect(service.create({ ...input(), text: 'different' })).rejects.toThrow('identity conflict');
    });

    test('edits create children, retain sources and distinguish selection from actual rewriting', async () => {
        const { service, store } = setup();
        const scene = { writingTask: 'caption', purpose: 'share', audience: 'friends', domain: 'travel' };
        const first = await service.create({ ...input(), scene, styleRevisionIds: ['style1'],
            backgroundSourceRefs: [{ path: 'trip.md', contentHash: 'b'.repeat(64) }] });
        expect(await service.edit(first.id, first.text, 'selection1')).toEqual(first);
        expect(store.putWritingVersion).toHaveBeenCalledTimes(1);
        const edited = await service.edit(first.id, '我修改后的正文', 'edit1');
        expect(edited.origin).toBe('user_edited');
        expect(edited.parentVersionId).toBe(first.id);
        expect(edited.associatedImages).toEqual(first.associatedImages);
        expect(edited.backgroundSourceRefs).toEqual(first.backgroundSourceRefs);
        expect(edited.scene).toEqual(scene);
        expect(edited.styleRevisionIds).toEqual(['style1']);
        expect((await service.get(first.id))?.text).toBe(input().text);
    });

    test('does not revive a parent scene when a generated revision has no matching scene', async () => {
        const { service } = setup();
        const parent = await service.create({ ...input(), scene: { writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel' } });
        const changed = await service.create({ ...input(), requestId: 'changed-scene', parentVersionId: parent.id, scene: undefined });
        expect(changed.scene).toBeUndefined();
        expect((await service.edit(parent.id, 'local edit', 'local-action')).scene).toEqual(parent.scene);
    });

    test('rejects cross-conversation parents and corrupt stored text in both detail and list paths', async () => {
        const { service, records } = setup();
        const first = await service.create(input());
        await expect(service.create({ ...input(), requestId: 'request2', conversationId: 'another', parentVersionId: first.id }))
            .rejects.toThrow('parent unavailable');
        records.get(first.id)!.text = 'tampered';
        await expect(service.get(first.id)).rejects.toThrow('changed');
        await expect(service.list('chat1')).rejects.toThrow('changed');
    });
});

describe('generated note qualification', () => {
    test('retains generated identity across user edits and damaged details without classifying ordinary notes', () => {
        expect(hasWritingNoteProvenance({ title: 'My own note' })).toBe(false);
        for (const detail of [{ version: 1, origin: 'ai_generated' }, { version: 1, origin: 'user_edited' }, null, false, 'partial']) {
            expect(hasWritingNoteProvenance({ pa_writing: detail })).toBe(true);
        }
        expect(hasWritingNoteProvenance(undefined)).toBe(false);
    });
});

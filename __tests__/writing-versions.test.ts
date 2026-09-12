import { WritingVersionService, type WritingVersionStore } from '../src/chat/writing-versions';
import { cloneWritingVersion, hashWritingText, type WritingVersion } from '../src/chat/writing-types';
import { hasWritingNoteProvenance } from '../src/chat/writing-note-provenance';
import type { MessageImage } from '../src/chat/image-types';
import type { GenerationInputSnapshot } from '../src/ai-services/generation-input-snapshot';

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
const generationInput = (): GenerationInputSnapshot => ({
    schemaVersion: 1, inputPurpose: 'writing', task: { state: 'none', sources: [] },
    personal: { state: 'none' }, insights: { state: 'none' }, style: { state: 'none' }, images: [],
    parent: { state: 'none' }, pagelet: { state: 'none' },
});

describe('immutable writing versions', () => {
    test('rejects revoked host admission after the final lookup without writing', async () => {
        const { service, store } = setup();
        let current = true;
        jest.spyOn(store, 'getWritingVersion').mockImplementation(async () => {
            current = false;
            return null;
        });
        await expect(service.create(input(), () => current)).rejects.toThrow('Writing conversation changed');
        expect(store.putWritingVersion).not.toHaveBeenCalled();
    });
    test('checks queued host admission but preserves an already admitted write', async () => {
        const { service, store, records } = setup();
        let started!: () => void, release!: () => void;
        const writing = new Promise<void>(resolve => { started = resolve; });
        const held = new Promise<void>(resolve => { release = resolve; });
        jest.spyOn(store, 'putWritingVersion').mockImplementation(async version => {
            started(); await held; records.set(version.id, cloneWritingVersion(version));
        });
        let current = true;
        const admitted = service.create(input(), () => current);
        await writing;
        const read = jest.spyOn(store, 'getWritingVersion');
        const queued = service.create({ ...input(), requestId: 'queued' }, () => current);
        const rejected = expect(queued).rejects.toThrow('Writing conversation changed');
        current = false;
        release();
        expect((await admitted).text).toBe(input().text);
        await rejected;
        expect(read).not.toHaveBeenCalled();
        expect(store.putWritingVersion).toHaveBeenCalledTimes(1);
    });
    test('lets an admitted write finish while rejecting queued work after disposal', async () => {
        const { service, store, records } = setup();
        let writeStarted!: () => void;
        let releaseWrite!: () => void;
        const started = new Promise<void>((resolve) => { writeStarted = resolve; });
        const release = new Promise<void>((resolve) => { releaseWrite = resolve; });
        jest.spyOn(store, 'putWritingVersion').mockImplementation(async (version) => {
            writeStarted();
            await release;
            records.set(version.id, cloneWritingVersion(version));
        });
        const read = jest.spyOn(store, 'getWritingVersion');
        const admitted = service.create(input());
        await started;
        const readsBeforeClose = read.mock.calls.length;
        const queued = service.create({ ...input(), requestId: 'queued' });
        const rejected = expect(queued).rejects.toThrow('Writing versions closed');
        const closing = service.dispose();
        releaseWrite();
        expect((await admitted).text).toBe(input().text);
        await rejected;
        await closing;
        expect(read).toHaveBeenCalledTimes(readsBeforeClose);
        expect(store.putWritingVersion).toHaveBeenCalledTimes(1);
    });
    test('does not start persistence after disposal during the final existing-version lookup', async () => {
        const { service, store } = setup();
        let lookupStarted!: () => void;
        let releaseLookup!: () => void;
        const started = new Promise<void>((resolve) => { lookupStarted = resolve; });
        const release = new Promise<void>((resolve) => { releaseLookup = resolve; });
        jest.spyOn(store, 'getWritingVersion').mockImplementation(async () => {
            lookupStarted();
            await release;
            return null;
        });
        const pending = service.create(input());
        const rejected = expect(pending).rejects.toThrow('Writing versions closed');
        await started;
        const closing = service.dispose();
        releaseLookup();
        await rejected;
        await closing;
        expect(store.putWritingVersion).not.toHaveBeenCalled();
    });
    test.each([{ images: [] }, { images: [photo('two')] }])('does not restore parent material omitted from the current snapshot: %j', async ({ images }) => {
        const { service } = setup();
        const parent = await service.create({ ...input(), images: [photo('one'), photo('two')] });
        const next = await service.create({ ...input(), requestId: 'subset', parentVersionId: parent.id, images });
        expect(next.associatedImages.map((image) => image.ref)).toEqual(images.map((image) => image.ref));
        expect((await service.get(parent.id))?.associatedImages).toHaveLength(2);
        expect((await service.edit(next.id, 'Edited subset', 'edit-subset')).associatedImages).toEqual(next.associatedImages);
    });
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
    test('persists an optional physical-input receipt and keeps legacy versions readable', async () => {
        const { service, records } = setup();
        const legacy = await service.create(input());
        expect(legacy.generationInput).toBeUndefined();
        const receipt = generationInput();
        const generated = await service.create({ ...input(), requestId: 'with-receipt', messageId: 'with-receipt',
            generationInput: receipt });
        expect(generated.generationInput).toEqual(receipt);
        receipt.task.state = 'unknown';
        expect((await service.get(generated.id))?.generationInput).toEqual(generationInput());
        const edited = await service.edit(generated.id, 'Local edit with receipt', 'receipt-edit');
        expect(edited.generationInput).toEqual(generationInput());
        (records.get(generated.id) as unknown as { generationInput: unknown }).generationInput = {
            ...generationInput(), rawText: 'forbidden body',
        };
        await expect(service.get(generated.id)).rejects.toThrow();
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

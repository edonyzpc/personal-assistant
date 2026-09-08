import { webcrypto } from 'node:crypto';
import { TFile, TFolder, type App } from 'obsidian';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { WritingSaveAction } from '../src/chat/writing-save-action';
import { hashWritingText, type WritingVersion } from '../src/chat/writing-types';
import { imageSourceHash } from '../src/chat/image-policy';
import type { ImageAssetService } from '../src/chat/image-assets';
import type { ImageRef } from '../src/chat/image-types';
import { cloneSaveReceipt, assertSaveReceiptUpdate, type SaveReceipt } from '../src/chat/save-receipt-types';
jest.mock('../src/platform-dom', () => ({ ...jest.requireActual('../src/platform-dom'), getPlatformCrypto: () => jest.requireActual('node:crypto').webcrypto }));

const bytes = (value: Uint8Array | number[]): ArrayBuffer => Uint8Array.from(value).buffer;
const jpeg = (width = 4): ArrayBuffer => bytes([255, 216, 255, 192, 0, 8, 8, 0, 3, 0, width, 1, 255, 217]);
const word = (n: number): Buffer => { const value = Buffer.alloc(4); value.writeUInt32BE(n); return value; };
const box = (name: string, body: Uint8Array): Buffer => Buffer.concat([word(body.length + 8), Buffer.from(name), body]);
const heic = (): ArrayBuffer => bytes(Buffer.concat([
    box('ftyp', Buffer.concat([Buffer.from('heic'), word(0), Buffer.from('mif1heic')])),
    box('meta', Buffer.concat([word(0), box('pitm', Buffer.from([0, 0, 0, 0, 0, 1])),
        box('iinf', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1]), box('infe', Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 1, 0, 0]), Buffer.from('hvc1\0')]))])),
        box('iprp', Buffer.concat([box('ipco', box('ispe', Buffer.concat([word(0), word(4), word(3)]))),
            box('ipma', Buffer.concat([word(0), word(1), Buffer.from([0, 1, 1, 1])]))]))]))]));
const originalCrypto = globalThis.crypto;
beforeAll(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }));
afterAll(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }));
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
};

async function setup(heicSource = false) {
    const store = new MemoryChatHistoryStore();
    const files = new Map<string, TFile | TFolder>(), text = new Map<string, string>(), binary = new Map<string, ArrayBuffer>();
    const source = heicSource ? heic() : jpeg(), sourcePath = 'attachments/pa-images/original.' + (heicSource ? 'heic' : 'jpg');
    const ref: ImageRef = { assetId: 'asset_1', contentHash: await imageSourceHash(source) };
    const asset = { id: ref.assetId, originalHash: ref.contentHash, source: 'imported' as const, originalPath: sourcePath,
        byteLength: source.byteLength, detectedMime: heicSource ? 'image/heic' : 'image/jpeg', acquisition: 'original_file' as const,
        state: 'available' as const, anchorPath: 'PA Chat.md', anchorKind: 'logical_root' as const, createdAt: 1, owners: [], importDirectory: 'attachments/pa-images' };
    await store.putImageAsset(asset);
    const version: WritingVersion = { id: 'writing_1', requestId: 'request_1', messageId: 'message_1', text: '正文\n  空格保持。',
        textHash: await hashWritingText('正文\n  空格保持。'), explanation: '说明不能混入正文', origin: 'ai_generated',
        conversationId: 'conv_1', turnIndex: 0, createdAt: 1, associatedImages: [{ ref, ordinal: 1, label: '用户照片' }],
        backgroundSourceRefs: [], styleRevisionIds: [] };
    await store.putWritingVersion(version);
    const file = (path: string, size: number) => Object.assign(new TFile(), { path, stat: { size, mtime: 0, ctime: 0 } });
    files.set(sourcePath, file(sourcePath, source.byteLength)); binary.set(sourcePath, source);
    const listeners = new Map<object, { kind: string; callback: (file: TFile, oldPath?: string) => void }>();
    const excludedPaths = new Set<string>();
    const vault = {
        on: jest.fn((kind: string, callback: (file: TFile, oldPath?: string) => void) => {
            const ref = {}; listeners.set(ref, { kind, callback }); return ref;
        }),
        offref: jest.fn((ref: object) => { listeners.delete(ref); }),
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        createFolder: jest.fn(async (path: string) => { files.set(path, Object.assign(new TFolder(), { path })); }),
        create: jest.fn(async (path: string, body: string) => {
            if (files.has(path)) throw new Error('exists');
            const entry = file(path, body.length); files.set(path, entry); text.set(path, body); return entry;
        }),
        createBinary: jest.fn(async (path: string, data: ArrayBuffer) => {
            if (files.has(path)) throw new Error('exists');
            const entry = file(path, data.byteLength); files.set(path, entry); binary.set(path, data.slice(0)); return entry;
        }),
        rename: jest.fn(async (entry: TFile, path: string) => {
            if (files.has(path)) throw new Error('exists');
            const previous = entry.path, data = binary.get(previous)!;
            files.delete(previous); binary.delete(previous);
            entry.path = path; files.set(path, entry); binary.set(path, data);
        }),
        readBinary: jest.fn(async (entry: TFile) => binary.get(entry.path)!.slice(0)),
        read: jest.fn(async (entry: TFile) => text.get(entry.path)!),
        process: jest.fn(async (entry: TFile, change: (current: string) => string) => {
            const updated = change(text.get(entry.path)!); text.set(entry.path, updated); return updated;
        }),
    };
    const release = jest.fn();
    let sourceAvailable = true;
    const readOriginal = jest.fn(async (input = ref) => {
        if (!sourceAvailable) throw new Error('original unavailable');
        const current = (await store.getImageAsset(input.assetId))!;
        const data = binary.get(current.originalPath);
        if (!data || !files.has(current.originalPath)) throw new Error('original unavailable');
        return { asset: current, bytes: data.slice(0) };
    });
    const promotions = new Map<string, string>();
    const images = {
        readOriginal,
        verify: jest.fn(async (input = ref) => { const current = await readOriginal(input); return { asset: current.asset, isCurrent: () => sourceAvailable }; }),
        resolveVariant: jest.fn(),
        promoteToNote: jest.fn(async (input: ImageRef, options: { sourcePath: string; targetPath: string | (() => Promise<string>); operationId: string; signal?: AbortSignal }) => {
            const current = await readOriginal(input);
            if (options.signal?.aborted) throw new Error('cancelled');
            const existing = promotions.get(options.operationId);
            if (existing) return { path: existing };
            if (current.asset.originalPath !== options.sourcePath) return { path: current.asset.originalPath };
            const targetPath = typeof options.targetPath === 'function' ? await options.targetPath() : options.targetPath;
            await vault.rename(files.get(options.sourcePath) as TFile, targetPath);
            for (const shared of await store.listImageAssets()) {
                if (shared.originalPath === options.sourcePath) await store.putImageAsset({ ...shared, source: 'vault_reference', originalPath: targetPath });
            }
            promotions.set(options.operationId, targetPath);
            return { path: targetPath };
        }),
    };
    const getAvailablePathForAttachment = jest.fn(async (name: string, path: string) => {
        expect(files.get(path)).toBeInstanceOf(TFile);
        return `${path.slice(0, path.lastIndexOf('/'))}/assets/${name}`;
    });
    const app = { vault, fileManager: { getAvailablePathForAttachment, generateMarkdownLink: (entry: TFile) => `[[${entry.path}]]` } } as unknown as App;
    const action = new WritingSaveAction(app, store, images as unknown as ImageAssetService,
        { isPathAllowed: (path) => !excludedPaths.has(path) });
    return { action, store, version, ref, source, sourcePath, text, files, binary, vault, app, images, release, getAvailablePathForAttachment,
        listeners, excludedPaths, emit: (kind: string, entry: TFile, oldPath?: string) => {
            for (const listener of listeners.values()) if (listener.kind === kind) listener.callback(entry, oldPath);
        },
        loseSource: () => { sourceAvailable = false; } };
}

/** An old serialized plan: no transfer discriminator and unchanged provenance. */
async function legacyReceipt(h: Awaited<ReturnType<typeof setup>>, written = false): Promise<SaveReceipt> {
    const isHeic = h.sourcePath.endsWith('.heic'), output = isHeic ? jpeg() : h.source;
    const receipt: SaveReceipt = { id: 'legacy_save', operationId: 'legacy_save', writingVersionId: h.version.id,
        textHash: h.version.textHash, targetNotePath: 'notes/saved.md', origin: h.version.origin, createdAt: 1,
        attachments: [{ ref: h.ref, sourcePath: h.sourcePath, sourceName: '用户照片', attachmentKind: isHeic ? 'heic_jpeg' : 'original',
            mime: 'image/jpeg', filename: 'old-export.jpg', outputHash: await imageSourceHash(output),
            byteLength: output.byteLength, exportPolicy: isHeic ? 'legacy-heic-policy' : 'original:v1', state: 'planned',
            plannedPath: 'notes/assets/old-export.jpg' }], initialNoteHash: '', noteContentHash: '', noteState: 'created', state: 'partial' };
    const attachment = receipt.attachments[0];
    const provenance = { version: 1, operationId: receipt.id, writingVersionId: h.version.id,
        origin: h.version.origin, adoption: 'ai_adopted', textHash: h.version.textHash, state: 'incomplete',
        sources: [{ assetId: h.ref.assetId, originalPath: h.sourcePath, sourceName: attachment.sourceName,
            plannedFilename: attachment.filename, originalHash: h.ref.contentHash, attachmentKind: attachment.attachmentKind,
            exportPolicy: attachment.exportPolicy, outputHash: attachment.outputHash }], backgroundSourceRefs: [] };
    const text = `---\npa_writing: ${JSON.stringify(provenance)}\n---\n\n${h.version.text}`;
    receipt.initialNoteHash = receipt.noteContentHash = await hashWritingText(text);
    await h.store.putSaveReceipt(receipt);
    await h.vault.create(receipt.targetNotePath, text);
    if (written) await h.vault.createBinary(attachment.plannedPath!, output);
    return receipt;
}

describe('frozen writing save and crash recovery', () => {
    it('prepares without writes, then creates generated-marked exact text before resolving relative attachments', async () => {
        const h = await setup();
        const prepared = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        expect(prepared.previewMarkdown).toContain(h.version.text);
        expect(prepared.previewMarkdown).toContain('pa_writing:');
        expect(prepared.receipt.attachments[0]).toMatchObject({ sourceName: '用户照片', attachmentKind: 'original', transfer: 'move' });
        expect(prepared.receipt.attachments[0].plannedPath).toBeUndefined();
        expect(h.vault.create).not.toHaveBeenCalled();
        expect(h.getAvailablePathForAttachment).not.toHaveBeenCalled();
        const create = h.vault.create.getMockImplementation()!;
        h.vault.create.mockImplementation(async (path, body) => {
            expect(await h.store.getSaveReceipt(prepared.operationId)).not.toBeNull();
            expect(body).toContain('pa_writing:'); expect(body.endsWith(h.version.text)).toBe(true);
            return create(path, body);
        });
        const receipt = await h.action.execute(prepared.operationId);
        expect(receipt.state).toBe('completed');
        expect(receipt.attachments[0].plannedPath).toMatch(/^notes\/assets\/.*\.jpg$/);
        expect(h.binary.has(h.sourcePath)).toBe(false);
        expect(h.binary.get(receipt.attachments[0].plannedPath!)).toEqual(h.source);
        expect(h.text.get('notes/saved.md')).toContain(`\n\n${h.version.text}\n\n![[notes/assets/`);
        expect(h.text.get('notes/saved.md')).not.toContain(h.version.explanation);
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(h.images.resolveVariant).not.toHaveBeenCalled();
    });

    it('rejects HEIC before writing a receipt or note and never invokes a converter', async () => {
        const h = await setup(true);
        await expect(h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' })).rejects.toThrow('heic_unsupported');
        expect(h.vault.create).not.toHaveBeenCalled();
        expect(h.images.resolveVariant).not.toHaveBeenCalled();
        expect(await h.store.listSaveReceipts()).toEqual([]);
    });

    it('does not move a file or write a note if the first receipt cannot be persisted', async () => {
        const h = await setup();
        const prepared = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        jest.spyOn(h.store, 'putSaveReceipt').mockRejectedValue(new Error('IDB full'));
        await expect(h.action.execute(prepared.operationId)).rejects.toThrow('IDB full');
        expect(h.vault.create).not.toHaveBeenCalled();
        expect(h.images.promoteToNote).not.toHaveBeenCalled();
        prepared.release();
    });

    it('recovers an attachment written before a durable checkpoint using the same planned path and hash', async () => {
        const h = await setup(), prepared = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        const put = h.store.putSaveReceipt.bind(h.store);
        const spy = jest.spyOn(h.store, 'putSaveReceipt').mockImplementation(async (receipt) => {
            if (receipt.attachments.some((a) => a.state === 'written')) throw new Error('storage interrupted');
            await put(receipt);
        });
        expect((await h.action.execute(prepared.operationId)).state).toBe('partial');
        expect((await h.store.getSaveReceipt(prepared.operationId))?.attachments[0]).toMatchObject({ state: 'planned' });
        expect(h.vault.rename).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        expect((await h.action.retry(prepared.operationId)).state).toBe('completed');
        expect(h.vault.rename).toHaveBeenCalledTimes(1);
        expect(h.images.promoteToNote.mock.calls.map((call) => call[1].operationId)).toEqual([`${prepared.operationId}_0`, `${prepared.operationId}_0`]);
    });

    it('never overwrites an edited partial note, and repeated execute does not duplicate a completed save', async () => {
        const h = await setup(), prepared = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        h.vault.process.mockImplementationOnce(async (file, transform) => { h.text.set(file.path, 'user edit'); return transform('user edit'); });
        const partial = await h.action.execute(prepared.operationId);
        expect(partial).toMatchObject({ state: 'partial', failureReason: 'note_changed' });
        expect(h.text.get('notes/saved.md')).toBe('user edit');
        expect((await h.action.retry(prepared.operationId)).failureReason).toBe('note_changed');
        const other = await setup(), preview = await other.action.prepare({ writingVersionId: other.version.id, targetNotePath: 'notes/saved.md' });
        const results = await Promise.all([other.action.execute(preview.operationId), other.action.execute(preview.operationId)]);
        expect(results.map((r) => r.state)).toEqual(['completed', 'completed']);
        expect(other.vault.create).toHaveBeenCalledTimes(1); expect(other.vault.rename).toHaveBeenCalledTimes(1);
    });

    it('retries from an already written JPEG even when the excluded HEIC source is missing', async () => {
        const h = await setup(true), receipt = await legacyReceipt(h, true);
        h.loseSource();
        expect((await h.action.retry(receipt.operationId)).state).toBe('completed');
        expect(h.images.resolveVariant).not.toHaveBeenCalled();
        expect(h.images.promoteToNote).not.toHaveBeenCalled();
    });

    it('refuses to regenerate a missing legacy HEIC export and preserves its frozen plan', async () => {
        const h = await setup(true), receipt = await legacyReceipt(h);
        const retried = await h.action.retry(receipt.operationId);
        expect(retried.failureReason).toBe('heic_unsupported');
        expect(retried.attachments).toEqual(receipt.attachments);
        expect(h.images.resolveVariant).not.toHaveBeenCalled();
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(h.binary.get(h.sourcePath)).toEqual(h.source);
        expect(h.text.get('notes/saved.md')).toContain(h.version.text);
    });

    it('retains a cancelled partial note and resumes the same operation without writing another note', async () => {
        const h = await setup(), controller = new AbortController();
        const create = h.vault.create.getMockImplementation()!;
        h.vault.create.mockImplementation(async (path, body) => { const file = await create(path, body); controller.abort(); return file; });
        const preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        expect(await h.action.execute(preview.operationId, { signal: controller.signal })).toMatchObject({ state: 'partial', failureReason: 'cancelled' });
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect((await h.action.retry(preview.operationId)).state).toBe('completed');
        expect(h.vault.create).toHaveBeenCalledTimes(1);
    });

    it('reuses the promoted attachment when two previews were prepared before either save', async () => {
        const h = await setup();
        const first = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/first.md' });
        const second = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'elsewhere/second.md' });
        const [saved, reused] = await Promise.all([h.action.execute(first.operationId), h.action.execute(second.operationId)]);
        expect(saved.state).toBe('completed'); expect(reused.state).toBe('completed');
        expect(reused.attachments[0].plannedPath).toBe(saved.attachments[0].plannedPath);
        expect(h.vault.rename).toHaveBeenCalledTimes(1);
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(h.text.get('elsewhere/second.md')).toContain(`![[${saved.attachments[0].plannedPath}]]`);
    });

    it.each(['unavailable', 'excluded'] as const)('reuses an earlier promotion when new attachment settings become %s', async (change) => {
        const h = await setup();
        const first = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/first.md' });
        const second = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'elsewhere/second.md' });
        const saved = await h.action.execute(first.operationId);
        expect(saved.state).toBe('completed');
        expect(h.getAvailablePathForAttachment).toHaveBeenCalledTimes(1);
        if (change === 'unavailable') h.getAvailablePathForAttachment.mockRejectedValue(new Error('attachment settings unavailable'));
        else {
            h.excludedPaths.add('private/new-attachment.jpg');
            h.getAvailablePathForAttachment.mockResolvedValue('private/new-attachment.jpg');
        }
        const reused = await h.action.execute(second.operationId);
        expect(reused.state).toBe('completed');
        expect(reused.attachments[0].plannedPath).toBe(saved.attachments[0].plannedPath);
        expect(h.getAvailablePathForAttachment).toHaveBeenCalledTimes(1);
        expect(h.vault.rename).toHaveBeenCalledTimes(1);
        expect(h.vault.createBinary).not.toHaveBeenCalled();
    });

    it('references an ordinary vault image without resolving an attachment path or moving it', async () => {
        const h = await setup();
        const asset = (await h.store.getImageAsset(h.ref.assetId))!;
        const ordinary = 'attachments/shared.jpg';
        await h.vault.rename(h.files.get(h.sourcePath) as TFile, ordinary);
        await h.store.putImageAsset({ ...asset, source: 'vault_reference', originalPath: ordinary });
        h.vault.rename.mockClear();
        const preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        expect(preview.receipt.attachments[0].transfer).toBe('reference');
        expect(await h.action.execute(preview.operationId)).toMatchObject({ state: 'completed', attachments: [{ plannedPath: ordinary }] });
        expect(h.getAvailablePathForAttachment).not.toHaveBeenCalled();
        expect(h.images.promoteToNote).not.toHaveBeenCalled();
        expect(h.vault.rename).not.toHaveBeenCalled();
        expect(h.vault.createBinary).not.toHaveBeenCalled();
    });

    it('rejects a changed reference location between preview and execution', async () => {
        const h = await setup(), asset = (await h.store.getImageAsset(h.ref.assetId))!;
        const ordinary = 'attachments/shared.jpg';
        await h.vault.rename(h.files.get(h.sourcePath) as TFile, ordinary);
        await h.store.putImageAsset({ ...asset, source: 'vault_reference', originalPath: ordinary });
        const preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        await h.vault.rename(h.files.get(ordinary) as TFile, 'attachments/renamed.jpg');
        await h.store.putImageAsset({ ...asset, source: 'vault_reference', originalPath: 'attachments/renamed.jpg' });
        await expect(h.action.execute(preview.operationId)).rejects.toThrow('source_changed');
        expect(h.vault.create).not.toHaveBeenCalled();
    });

    it('deduplicates two asset identities referring to the same physical file', async () => {
        const h = await setup(), asset = (await h.store.getImageAsset(h.ref.assetId))!;
        const secondRef = { assetId: 'asset_2', contentHash: h.ref.contentHash };
        await h.store.putImageAsset({ ...asset, id: secondRef.assetId });
        const version = { ...h.version, id: 'writing_shared', associatedImages: [...h.version.associatedImages,
            { ref: secondRef, ordinal: 2, label: '同一文件' }] };
        await h.store.putWritingVersion(version);
        const preview = await h.action.prepare({ writingVersionId: version.id, targetNotePath: 'notes/saved.md' });
        expect(preview.receipt.attachments).toHaveLength(1);
        expect((await h.action.execute(preview.operationId)).state).toBe('completed');
        expect(h.vault.rename).toHaveBeenCalledTimes(1);
    });

    it('keeps legacy original copy recovery separate from new transfer plans', async () => {
        const h = await setup(), receipt = await legacyReceipt(h);
        const result = await h.action.retry(receipt.operationId);
        expect(result.state).toBe('completed');
        expect(result.attachments[0].transfer).toBeUndefined();
        expect(h.binary.get(h.sourcePath)).toEqual(h.source);
        expect(h.vault.createBinary).toHaveBeenCalledTimes(1);
        expect(h.images.promoteToNote).not.toHaveBeenCalled();
        expect(() => assertSaveReceiptUpdate(receipt, { ...receipt, attachments: [{ ...receipt.attachments[0], transfer: 'move' }] })).toThrow('Frozen save plan');
        expect(() => cloneSaveReceipt({ ...receipt, attachments: [{ ...receipt.attachments[0], transfer: 'move', attachmentKind: 'heic_jpeg' }] })).toThrow('Invalid original transfer plan');
    });

    it('releasing an unused preview does not move or copy its selected images', async () => {
        const h = await setup();
        const preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        preview.release();
        await expect(h.action.execute(preview.operationId)).rejects.toThrow('preview_released');
        expect(h.vault.create).not.toHaveBeenCalled();
        expect(h.vault.rename).not.toHaveBeenCalled();
        expect(h.vault.createBinary).not.toHaveBeenCalled();
    });

    it('keeps immutable writing and unfinished save pins after deleting a conversation, then prunes completed local records', async () => {
        const h = await setup(), preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        h.vault.rename.mockRejectedValueOnce(new Error('interrupted'));
        await h.action.execute(preview.operationId);
        await h.store.deleteConversation(h.version.conversationId);
        expect(await h.store.getWritingVersion(h.version.id)).not.toBeNull();
        expect((await h.store.getImageAsset(h.ref.assetId))?.owners.map((o) => o.kind)).toEqual(['writing', 'save']);
        expect((await h.action.retry(preview.operationId)).state).toBe('completed');
        await h.store.deleteTurnsForConversation(h.version.conversationId);
        expect(await h.store.getWritingVersion(h.version.id)).toBeNull();
        expect(await h.store.getSaveReceipt(preview.operationId)).toBeNull();
        expect((await h.store.getImageAsset(h.ref.assetId))?.owners).toEqual([]);
        expect(h.text.get('notes/saved.md')).toContain('pa_writing:');
    });

    it('preserves a partial note when the source becomes unavailable before promotion', async () => {
        const h = await setup(), entered = deferred(), resume = deferred();
        const promote = h.images.promoteToNote.getMockImplementation()!;
        h.images.promoteToNote.mockImplementationOnce(async (...args) => {
            entered.resolve(); await resume.promise; return promote(...args);
        });
        const preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        const saving = h.action.execute(preview.operationId);
        await entered.promise; h.loseSource(); resume.resolve();
        expect((await saving).state).toBe('partial');
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(h.vault.rename).not.toHaveBeenCalled();
        expect(h.text.get('notes/saved.md')).toContain('"state":"incomplete"');
        expect(h.listeners.size).toBe(0);
    });

    it.each(['delete', 'rename', 'modify', 'exclude'] as const)('does not complete when an attachment %s occurs during the final receipt checkpoint', async (change) => {
        const h = await setup(), entered = deferred(), resume = deferred();
        const preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        const put = h.store.putSaveReceipt.bind(h.store);
        let attachmentPath = '';
        jest.spyOn(h.store, 'putSaveReceipt').mockImplementation(async (receipt) => {
            await put(receipt);
            if (receipt.finalNoteHash && receipt.state === 'partial' && !attachmentPath) {
                attachmentPath = receipt.attachments[0].plannedPath!;
                entered.resolve(); await resume.promise;
            }
        });
        const saving = h.action.execute(preview.operationId);
        await entered.promise;
        const entry = h.files.get(attachmentPath) as TFile;
        if (change === 'delete') h.files.delete(attachmentPath);
        if (change === 'rename') { h.files.delete(attachmentPath); entry.path += '.renamed'; h.files.set(entry.path, entry); }
        // Even unchanged size/mtime does not hide an observed modify event.
        if (change === 'modify') h.emit('modify', entry);
        if (change === 'exclude') h.excludedPaths.add(attachmentPath);
        resume.resolve();
        expect(await saving).toMatchObject({ state: 'partial', failureReason: change === 'exclude' ? 'path_not_allowed' : 'attachment_changed' });
        expect(h.text.get('notes/saved.md')).toContain('"state":"incomplete"');
        expect(h.listeners.size).toBe(0);
    });

    it('verifies attachments again after the note write, and preserves a recoverable partial result on change', async () => {
        const h = await setup(), preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        const process = h.vault.process.getMockImplementation()!;
        h.vault.process.mockImplementation(async (entry, transform) => {
            const result = await process(entry, transform);
            const receipt = (await h.store.getSaveReceipt(preview.operationId))!;
            h.files.delete(receipt.attachments[0].plannedPath!);
            return result;
        });
        expect(await h.action.execute(preview.operationId)).toMatchObject({ state: 'partial', failureReason: 'attachment_changed' });
        expect((await h.store.getSaveReceipt(preview.operationId))?.state).toBe('partial');
        expect(h.listeners.size).toBe(0);
    });

    it('does not report success when a source file changes while the final IDB checkpoint commits', async () => {
        const h = await setup(), entered = deferred(), resume = deferred();
        const preview = await h.action.prepare({ writingVersionId: h.version.id, targetNotePath: 'notes/saved.md' });
        const put = h.store.putSaveReceipt.bind(h.store);
        jest.spyOn(h.store, 'putSaveReceipt').mockImplementation(async (receipt) => {
            await put(receipt);
            if (receipt.state === 'completed') { entered.resolve(); await resume.promise; }
        });
        const saving = h.action.execute(preview.operationId);
        await entered.promise;
        const entry = h.files.get('notes/saved.md') as TFile;
        h.text.set(entry.path, 'user changed the saved note'); h.emit('modify', entry);
        resume.resolve();
        expect(await saving).toMatchObject({ state: 'partial', failureReason: 'note_changed' });
        expect(await h.action.retry(preview.operationId)).toMatchObject({ state: 'partial', failureReason: 'note_changed' });
        expect(h.text.get(entry.path)).toBe('user changed the saved note');
        expect(h.listeners.size).toBe(0);
    });
});

import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { TFile, TFolder, type App } from 'obsidian';
import { ImageAssetService } from '../src/chat/image-assets';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { IMAGE_POLICY, imagePolicyFingerprint, imageSourceHash, PROCESSOR_VERSION } from '../src/chat/image-policy';
import type { ProcessImageOptions } from '../src/chat/image-processor';
import type { ImageAsset, ImageVariantRecord } from '../src/chat/image-types';
import { WritingSaveAction } from '../src/chat/writing-save-action';
import { hashWritingText, type WritingVersion } from '../src/chat/writing-types';
jest.mock('../src/platform-dom', () => ({ ...jest.requireActual('../src/platform-dom'), getPlatformCrypto: () => jest.requireActual('node:crypto').webcrypto }));

const bytes = (...values: number[]): ArrayBuffer => Uint8Array.from(values).buffer;
const fileInput = (data = bytes(1, 2, 3)) => ({ name: 'photo.heic', size: data.byteLength, arrayBuffer: async () => data.slice(0) });
const originalCrypto = globalThis.crypto, originalBlob = globalThis.Blob;
beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    Object.defineProperty(globalThis, 'Blob', { configurable: true, value: NodeBlob });
});
afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    Object.defineProperty(globalThis, 'Blob', { configurable: true, value: originalBlob });
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
function setup(store = new MemoryChatHistoryStore()) {
    const data = new Map<string, ArrayBuffer>();
    const texts = new Map<string, string>();
    const entries = new Map<string, TFile | TFolder>();
    const listeners = new Map<string, (file: TFile | TFolder, oldPath?: string) => void>();
    const vault = {
        getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
        createFolder: jest.fn(async (path: string) => { entries.set(path, Object.assign(new TFolder(), { path })); }),
        createBinary: jest.fn(async (path: string, value: ArrayBuffer) => {
            if (entries.has(path)) throw new Error('exists');
            const file = Object.assign(new TFile(), { path, stat: { size: value.byteLength, mtime: 0, ctime: 0 } }); entries.set(path, file); data.set(path, value.slice(0)); return file;
        }),
        readBinary: jest.fn(async (file: TFile) => { const value = data.get(file.path); if (!value) throw new Error('missing'); return value.slice(0); }),
        create: jest.fn(async (path: string, text: string) => {
            if (entries.has(path)) throw new Error('exists');
            const file = Object.assign(new TFile(), { path, stat: { size: text.length, mtime: 0, ctime: 0 } });
            entries.set(path, file); texts.set(path, text); return file;
        }),
        read: jest.fn(async (file: TFile) => texts.get(file.path)!),
        process: jest.fn(async (file: TFile, change: (text: string) => string) => {
            const updated = change(texts.get(file.path)!); texts.set(file.path, updated); return updated;
        }),
        trash: jest.fn(async (file: TFile) => { entries.delete(file.path); data.delete(file.path); }),
        on: jest.fn((kind: string, fn: (file: TFile | TFolder, oldPath?: string) => void) => { listeners.set(kind, fn); return { kind }; }),
        offref: jest.fn(),
    };
    const processor = {
        process: jest.fn(async (input: ArrayBuffer, options: ProcessImageOptions) => ({ blob: new Blob([bytes(9, 8)], { type: 'image/jpeg' }),
            mime: 'image/jpeg' as const, width: 2, height: 1, byteLength: 2, sourceMime: 'image/heic' as const,
            sourceHash: await imageSourceHash(input), processorVersion: PROCESSOR_VERSION, policyFingerprint: imagePolicyFingerprint(options.purpose) })),
        dispose: jest.fn(async () => undefined),
    };
    const app = { vault, fileManager: {
        getAvailablePathForAttachment: jest.fn(async (name: string, _anchor: string) => `attachments/${name}`),
        generateMarkdownLink: (file: TFile) => `[[${file.path}]]`,
        renameFile: jest.fn(async (file: TFile, path: string) => {
            if (entries.has(path)) throw new Error('exists');
            const oldPath = file.path, value = data.get(oldPath)!;
            entries.delete(oldPath); data.delete(oldPath); file.path = path;
            entries.set(path, file); data.set(path, value);
            listeners.get('rename')?.(file, oldPath);
        }),
    } } as unknown as App;
    const service = new ImageAssetService(app, store, { processor });
    return { service, store, data, entries, listeners, vault, processor, app };
}

describe('chat-only images become shared note attachments', () => {
    const jpeg = () => bytes(255, 216, 255, 192, 0, 8, 8, 0, 3, 0, 4, 1, 255, 217);
    const importJpeg = (h: ReturnType<typeof setup>) => h.service.importFile(fileInput(jpeg()), { acquisition: 'unverified_import' });

    it('rejects actual HEIC before registration or writes regardless of filename, including vault references', async () => {
        const h = setup();
        const heic = bytes(0, 0, 0, 20, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0, 109, 105, 102, 49);
        await expect(h.service.importFile({ ...fileInput(heic), name: 'photo.jpg' }, { acquisition: 'original_file' }))
            .rejects.toMatchObject({ code: 'heic-unsupported' });
        expect(await h.store.listImageAssets()).toEqual([]);
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        await h.vault.createBinary('pretend.png', heic);
        await expect(h.service.addVaultReference('pretend.png')).rejects.toMatchObject({ code: 'heic-unsupported' });
        expect(await h.store.listImageAssets()).toEqual([]);
        expect(h.processor.process).not.toHaveBeenCalled();
    });

    it('preserves actual JPEG delivery bytes even with an HEIC name and removes acquisition warnings', async () => {
        const h = setup(), imported = await importJpeg(h);
        expect(imported.asset.acquisition).toBe('original_file');
        expect(h.data.get(imported.asset.originalPath)).toEqual(jpeg());
    });

    it.each(['saved.jpg', 'attachments/saved.jpg', 'notes/saved.jpg', 'notes/assets/saved.jpg'])(
        'moves bytes once to %s, repairs every alias and removes cleanup authority', async (targetPath) => {
            const h = setup(), imported = await importJpeg(h);
            await h.vault.createBinary('Another.md', bytes());
            const alias = await h.service.addVaultReference(imported.asset.originalPath, { anchorPath: 'Another.md', anchorKind: 'existing_note' });
            const result = await h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath, operationId: 'save_one' });
            expect(result.path).toBe(targetPath);
            expect(h.data.has(imported.asset.originalPath)).toBe(false);
            expect(h.data.get(targetPath)).toEqual(jpeg());
            for (const ref of [imported.ref, alias.ref]) {
                expect((await h.service.readOriginal(ref)).asset).toMatchObject({ originalPath: targetPath, source: 'vault_reference' });
            }
            await h.service.clearCache();
            expect((await h.service.readOriginal(alias.ref)).bytes).toEqual(jpeg());
            await expect(h.service.cleanupSelected([{ ref: imported.ref, path: targetPath }]))
                .rejects.toMatchObject({ code: 'cleanup_selection_changed' });
            const second = await h.service.promoteToNote(alias.ref, { sourcePath: imported.asset.originalPath, targetPath: 'elsewhere.jpg', operationId: 'save_two' });
            expect(second.path).toBe(targetPath);
            expect(h.app.fileManager.renameFile).toHaveBeenCalledTimes(1);
        });

    it('does not overwrite or adopt an occupied same-content target before moving', async () => {
        const h = setup(), imported = await importJpeg(h);
        await h.vault.createBinary('existing.jpg', jpeg());
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'existing.jpg', operationId: 'save_one' }))
            .rejects.toMatchObject({ code: 'path_conflict' });
        expect(h.data.get(imported.asset.originalPath)).toEqual(jpeg());
        expect(h.app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('fails before rename when the intent cannot persist', async () => {
        const h = setup(), imported = await importJpeg(h);
        jest.spyOn(h.store, 'setImageSetting').mockRejectedValueOnce(new Error('quota'));
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'saved.jpg', operationId: 'save_one' }))
            .rejects.toThrow('quota');
        expect(h.data.has(imported.asset.originalPath)).toBe(true);
        expect(h.app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('recovers a move after registry failure using durable intent, without copying or moving twice', async () => {
        const h = setup(), imported = await importJpeg(h);
        const put = jest.spyOn(h.store, 'putImageAsset');
        put.mockRejectedValueOnce(new Error('registry unavailable'));
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'saved.jpg', operationId: 'save_one' }))
            .rejects.toThrow('registry unavailable');
        expect(h.data.has(imported.asset.originalPath)).toBe(false);
        expect(h.data.get('saved.jpg')).toEqual(jpeg());
        expect((await h.service.readOriginal(imported.ref)).asset.originalPath).toBe('saved.jpg');
        const result = await h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'other.jpg', operationId: 'save_one' });
        expect(result.path).toBe('saved.jpg');
        expect(h.app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    });

    it('keeps the source readable after an interrupted rename but forbids a competing save from taking its pending intent', async () => {
        const h = setup(), imported = await importJpeg(h);
        (h.app.fileManager.renameFile as jest.Mock).mockRejectedValueOnce(new Error('interrupted'));
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'saved.jpg', operationId: 'save_one' })).rejects.toThrow('interrupted');
        expect((await h.service.readOriginal(imported.ref)).bytes).toEqual(jpeg());
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'another.jpg', operationId: 'save_two' }))
            .rejects.toMatchObject({ code: 'promotion_incomplete' });
        await h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'another.jpg', operationId: 'save_one' });
        expect(h.data.get('saved.jpg')).toEqual(jpeg());
        expect(h.data.has('another.jpg')).toBe(false);
    });

it('isolates unavailable pending moves in the management list and allows explicit relocation to recover', async () => {
        const h = setup(), imported = await importJpeg(h);
        (h.app.fileManager.renameFile as jest.Mock).mockRejectedValueOnce(new Error('interrupted'));
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'saved.jpg', operationId: 'save_one' })).rejects.toThrow();
        h.entries.delete(imported.asset.originalPath); h.data.delete(imported.asset.originalPath);
        const other = await h.service.importFile(fileInput(bytes(4, 5, 6)), { acquisition: 'original_file' });
        expect((await h.service.listAssets()).map((a) => a.id)).toEqual(expect.arrayContaining([imported.ref.assetId, other.ref.assetId]));
        await h.vault.createBinary('recovered.jpg', jpeg());
        await h.service.relocate(imported.ref, 'recovered.jpg');
        expect((await h.service.readOriginal(imported.ref)).asset.originalPath).toBe('recovered.jpg');
        expect(await h.store.getImageSetting(`promotion-history:${imported.ref.assetId}:save_one`)).toMatchObject({ state: 'started' });
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'another.jpg', operationId: 'save_one' }))
            .rejects.toMatchObject({ code: 'source_changed' });
    });

    it('repairs cancellation during rename before returning to the next read', async () => {
        const h = setup(), imported = await importJpeg(h), controller = new AbortController();
        const rename = (h.app.fileManager.renameFile as jest.Mock).getMockImplementation()!;
        (h.app.fileManager.renameFile as jest.Mock).mockImplementationOnce(async (...args: unknown[]) => {
            await rename(...args); controller.abort();
        });
        await h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'saved.jpg', operationId: 'save_one', signal: controller.signal });
        expect((await h.service.readOriginal(imported.ref)).asset).toMatchObject({ originalPath: 'saved.jpg', source: 'vault_reference' });
    });

    it('rejects a source changed during final verification before the rename', async () => {
        const h = setup(), imported = await importJpeg(h);
        const read = h.vault.readBinary.getMockImplementation()!;
        let reads = 0;
        h.vault.readBinary.mockImplementation(async (file) => {
            const value = await read(file);
            if (file.path === imported.asset.originalPath && ++reads === 2) {
                h.data.set(file.path, bytes(6, 6, 6)); file.stat.mtime++;
                h.listeners.get('modify')?.(file);
            }
            return value;
        });
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'saved.jpg', operationId: 'save_one' })).rejects.toThrow();
        expect(h.app.fileManager.renameFile).not.toHaveBeenCalled();
        expect(h.data.has('saved.jpg')).toBe(false);
    });

    it('integrates real save and image services across shared previews, interrupted receipt commits and changed attachment settings', async () => {
        const h = setup(), imported = await importJpeg(h);
        const version: WritingVersion = { id: 'writing_integration', requestId: 'request_integration', messageId: 'message_integration',
            text: 'Keep this exact text.', textHash: await hashWritingText('Keep this exact text.'), explanation: '', origin: 'ai_generated',
            conversationId: 'conv_integration', turnIndex: 0, createdAt: 1, associatedImages: [{ ref: imported.ref, ordinal: 1, label: 'Photo' }],
            backgroundSourceRefs: [], styleRevisionIds: [] };
        await h.store.putWritingVersion(version);
        const save = new WritingSaveAction(h.app, h.store, h.service);
        const first = await save.prepare({ writingVersionId: version.id, targetNotePath: 'one.md' });
        const second = await save.prepare({ writingVersionId: version.id, targetNotePath: 'two.md' });
        const put = h.store.putSaveReceipt.bind(h.store);
        let rejectCheckpoint = true;
        jest.spyOn(h.store, 'putSaveReceipt').mockImplementation(async (receipt) => {
            if (rejectCheckpoint && receipt.attachments.some((a) => a.state === 'written')) throw new Error('checkpoint unavailable');
            return put(receipt);
        });
        expect((await save.execute(first.operationId)).state).toBe('partial');
        expect(h.data.has(imported.asset.originalPath)).toBe(false);
        rejectCheckpoint = false;
        (h.app.fileManager.getAvailablePathForAttachment as jest.Mock).mockRejectedValue(new Error('attachment settings changed'));
        expect((await save.retry(first.operationId)).state).toBe('completed');
        const result = await save.execute(second.operationId);
        expect(result.state).toBe('completed');
        expect(h.app.fileManager.renameFile).toHaveBeenCalledTimes(1);
        expect(h.vault.createBinary).toHaveBeenCalledTimes(1);
        expect((await h.service.readOriginal(imported.ref)).asset.originalPath).toBe(result.attachments[0].plannedPath);
        await save.dispose(); await h.service.dispose();
    });

    it('does not adopt same bytes if both source and target exist after a pending intent', async () => {
        const h = setup(), imported = await importJpeg(h);
        (h.app.fileManager.renameFile as jest.Mock).mockRejectedValueOnce(new Error('interrupted'));
        await expect(h.service.promoteToNote(imported.ref, { sourcePath: imported.asset.originalPath, targetPath: 'saved.jpg', operationId: 'save_one' })).rejects.toThrow();
        await h.vault.createBinary('saved.jpg', jpeg());
        await expect(h.service.readOriginal(imported.ref)).rejects.toMatchObject({ code: 'path_conflict' });
        expect(h.data.has(imported.asset.originalPath)).toBe(true);
        expect(h.vault.trash).not.toHaveBeenCalled();
    });
});

describe('image original ownership and recovery', () => {
    it('records provider disclosure once per device store across concurrent views and service reopens, independently of sync', async () => {
        const h = setup(), shown = jest.fn(async () => true);
        await Promise.all([h.service.showProviderNoticeIfNeeded(shown), h.service.showProviderNoticeIfNeeded(shown)]);
        expect(shown).toHaveBeenCalledTimes(1);
        expect(await h.store.getImageSetting('provider-notice:v1')).toBe(true);
        expect(await h.store.getImageSetting('sync-notice:attachments/pa-images')).toBeNull();
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(h.processor.process).not.toHaveBeenCalled();
        await h.service.dispose();
        const reopened = setup(h.store);
        await reopened.service.showProviderNoticeIfNeeded(shown);
        expect(shown).toHaveBeenCalledTimes(1);
        const anotherDevice = setup();
        await anotherDevice.service.showProviderNoticeIfNeeded(shown);
        expect(shown).toHaveBeenCalledTimes(2);
    });

    it('does not acknowledge a disclosure whose view became stale before it could display', async () => {
        const h = setup();
        await h.service.showProviderNoticeIfNeeded(() => false);
        expect(await h.store.getImageSetting('provider-notice:v1')).toBeNull();
        const shown = jest.fn(() => true);
        await h.service.showProviderNoticeIfNeeded(shown);
        expect(shown).toHaveBeenCalledTimes(1);
    });

    it('does not show a late disclosure after the service was disposed during its metadata read', async () => {
        const h = setup(), held = deferred<null>();
        jest.spyOn(h.store, 'getImageSetting').mockImplementationOnce(() => held.promise);
        const shown = jest.fn(() => true);
        const pending = h.service.showProviderNoticeIfNeeded(shown);
        await new Promise((resolve) => setImmediate(resolve));
        const disposing = h.service.dispose();
        held.resolve(null);
        await Promise.all([pending, disposing]);
        expect(shown).not.toHaveBeenCalled();
        expect(await h.store.getImageSetting('provider-notice:v1')).toBeNull();
    });

    it('keeps disclosure nonblocking when the receipt cannot persist without claiming it survives restart', async () => {
        const h = setup();
        jest.spyOn(h.store, 'setImageSetting').mockRejectedValue(new Error('quota'));
        const shown = jest.fn(() => true);
        await h.service.showProviderNoticeIfNeeded(shown);
        await h.service.showProviderNoticeIfNeeded(shown);
        expect(shown).toHaveBeenCalledTimes(1);
        expect(await h.store.getImageSetting('provider-notice:v1')).toBeNull();
        const reopened = setup(h.store);
        await reopened.service.showProviderNoticeIfNeeded(shown);
        expect(shown).toHaveBeenCalledTimes(2);
    });

    it('discloses when storage initialization fails, while ordinary asset work remains blocked until recovery', async () => {
        const h = setup(), shown = jest.fn(() => true);
        const initialize = jest.spyOn(h.store, 'initialize').mockRejectedValue(new Error('storage unavailable'));
        const persist = jest.spyOn(h.store, 'setImageSetting');
        await expect(h.service.showProviderNoticeIfNeeded(shown)).resolves.toBeUndefined();
        expect(shown).toHaveBeenCalledTimes(1);
        expect(persist).not.toHaveBeenCalled();
        await expect(h.service.importFile(fileInput(), { acquisition: 'original_file' })).rejects.toThrow('storage unavailable');
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        initialize.mockRestore();
        await expect(h.service.showProviderNoticeIfNeeded(shown)).resolves.toBeUndefined();
        expect(shown).toHaveBeenCalledTimes(1);
        expect(await h.store.getImageSetting('provider-notice:v1')).toBeNull();
        const reopened = setup(h.store);
        await reopened.service.showProviderNoticeIfNeeded(shown);
        expect(shown).toHaveBeenCalledTimes(2);
        expect(await h.store.getImageSetting('provider-notice:v1')).toBe(true);
    });

    it('never falls back to a logical anchor when the explicitly associated note is missing or changes during attachment resolution', async () => {
        const h = setup(), options = { acquisition: 'original_file' as const, anchorKind: 'existing_note' as const, anchorPath: 'notes/chat.md' };
        await expect(h.service.importFile(fileInput(), options)).rejects.toMatchObject({ code: 'anchor_unavailable' });
        expect(h.app.fileManager.getAvailablePathForAttachment).not.toHaveBeenCalled();
        h.entries.set('notes/chat.md', Object.assign(new TFile(), { path: 'notes/chat.md' }));
        const available = h.app.fileManager.getAvailablePathForAttachment as jest.Mock;
        available.mockImplementationOnce(async (name: string) => {
            h.entries.delete('notes/chat.md'); return `attachments/${name}`;
        });
        await expect(h.service.importFile(fileInput(), options)).rejects.toMatchObject({ code: 'anchor_unavailable' });
        expect(h.vault.createBinary).not.toHaveBeenCalled();
    });
    it('rejects oversized acquisition or replacement before allocating its bytes', async () => {
        const h = setup();
        const input = { ...fileInput(), size: IMAGE_POLICY.maxOriginalBytes + 1, arrayBuffer: jest.fn() };
        await expect(h.service.importFile(input, { acquisition: 'original_file' })).rejects.toMatchObject({ code: 'original_byte_limit' });
        expect(input.arrayBuffer).not.toHaveBeenCalled();
        const imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        const file = h.entries.get(imported.asset.originalPath) as TFile;
        file.stat.size = IMAGE_POLICY.maxOriginalBytes + 1;
        h.vault.readBinary.mockClear();
        await expect(h.service.resolveVariant(imported.ref, 'provider')).rejects.toMatchObject({ code: 'original_byte_limit' });
        expect(h.vault.readBinary).not.toHaveBeenCalled();
    });
    it('shows the sync notice before original bytes are written and retains a pending import if notice delivery cancels', async () => {
        const h = setup(), controller = new AbortController();
        await expect(h.service.importFile(fileInput(), { acquisition: 'original_file', signal: controller.signal,
            onSyncNotice: async (receipt) => {
                expect(receipt.directory).toBe('attachments/pa-images');
                expect(h.data.size).toBe(0);
                expect((await h.store.listImageAssets())[0].state).toBe('preserving');
                controller.abort();
            } })).rejects.toMatchObject({ code: 'cancelled' });
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(await h.service.recoverPending()).toEqual([expect.objectContaining({ recoveryReason: 'input_required' })]);
    });

    it.each([false, true])('checks the final Git directory rule, including a concurrent later override: %s', async (overridden) => {
        const h = setup();
        const ignore = Object.assign(new TFile(), { path: '.gitignore' });
        h.entries.set(ignore.path, ignore);
        const rule = '/attachments/pa-images/';
        let contents = `${rule}\n!/attachments/pa-images/\n`;
        Object.assign(h.vault, {
            process: async (_file: TFile, update: (text: string) => string) => { contents = update(contents); return contents; },
            read: async () => overridden ? `${contents}!/attachments/pa-images/\n` : contents,
        });
        const imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        expect(contents).toBe(`${rule}\n!/attachments/pa-images/\n${rule}\n`);
        expect(imported.sync.git).toBe(overridden ? 'unknown' : 'configured');
        expect(imported.sync.gitTracked).toBe('unknown');
        expect(imported.sync.previouslyUploaded).toBe('unknown');
    });

    it('does not exclude a new shared parent after the user moves an original out of its import folder', async () => {
        const h = setup();
        const imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        const file = h.entries.get(imported.asset.originalPath) as TFile;
        const oldPath = file.path;
        h.entries.delete(oldPath); h.data.delete(oldPath);
        file.path = 'notes/moved-original.heic';
        h.entries.set(file.path, file); h.data.set(file.path, bytes(1, 2, 3));
        h.listeners.get('rename')!(file, oldPath);
        await h.service.listAssets();
        h.entries.set('.gitignore', Object.assign(new TFile(), { path: '.gitignore' }));
        const process = jest.fn();
        Object.assign(h.vault, { process, read: async () => '/attachments/pa-images/\n' });
        const repeated = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        expect(repeated.asset.id).toBe(imported.asset.id);
        expect(repeated.sync).toMatchObject({ directory: 'notes', git: 'unknown', gitignoreRule: '', noticeRequired: true });
        expect(process).not.toHaveBeenCalled();
    });
    it('registers preserving before bytes; duplicate content reuses the checked original, and acknowledgement is directory scoped', async () => {
        const h = setup();
        const write = h.vault.createBinary.getMockImplementation()!;
        h.vault.createBinary.mockImplementation(async (path, value) => {
            expect(await h.store.listImageAssets()).toEqual([expect.objectContaining({ state: 'preserving', originalPath: path })]);
            return write(path, value);
        });
        const a = await h.service.importFile(fileInput(), { acquisition: 'unverified_import', anchorPath: 'PA Chat.md' });
        expect(a.asset.acquisition).toBe('original_file');
        expect(a.sync.noticeRequired).toBe(true);
        expect(a.sync.gitTracked).toBe('unknown');
        expect(h.app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(expect.any(String), 'PA Chat.md');
        await h.service.acknowledgeSyncNotice(a.sync.directory);
        const b = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        expect(b.ref).toEqual(a.ref);
        expect(b.sync.noticeRequired).toBe(false);
        expect(b.sync.obsidianSync).toBe('needs_user_setup');
        expect(h.vault.createBinary).toHaveBeenCalledTimes(1);
        expect([...new Uint8Array(h.data.get(a.asset.originalPath)!)]).toEqual([1, 2, 3]);
    });

    it('does not write an unregistered original when metadata fails', async () => {
        const h = setup(); jest.spyOn(h.store, 'putImageAsset').mockRejectedValue(new Error('IDB unavailable'));
        await expect(h.service.importFile(fileInput(), { acquisition: 'original_file' })).rejects.toThrow('IDB unavailable');
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(h.data.size).toBe(0);
    });

    it('recovers a completed raw write after final metadata failure without a second file', async () => {
        const h = setup(), put = h.store.putImageAsset.bind(h.store);
        jest.spyOn(h.store, 'putImageAsset').mockImplementation(async (asset) => {
            if (asset.state === 'available') throw new Error('quota'); await put(asset);
        });
        await expect(h.service.importFile(fileInput(), { acquisition: 'original_file' })).rejects.toMatchObject({ code: 'preservation_incomplete' });
        expect((await h.store.listImageAssets())[0].state).toBe('preserving');
        expect(h.data.size).toBe(1);
        jest.restoreAllMocks();
        expect(await h.service.recoverPending()).toEqual([expect.objectContaining({ state: 'available' })]);
        await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        expect(h.data.size).toBe(1);
    });

    it('waits an in-flight original write on cancel/unload and still finalizes the registry', async () => {
        const h = setup(), started = deferred<void>(), finish = deferred<void>(), controller = new AbortController();
        const write = h.vault.createBinary.getMockImplementation()!;
        h.vault.createBinary.mockImplementation(async (path, value) => { started.resolve(); await finish.promise; return write(path, value); });
        const importing = h.service.importFile(fileInput(), { acquisition: 'original_file', signal: controller.signal });
        const result = importing.catch((error: unknown) => error);
        await started.promise; controller.abort();
        let disposed = false; const closing = h.service.dispose().then(() => { disposed = true; });
        await Promise.resolve(); expect(disposed).toBe(false);
        finish.resolve(); await closing;
        expect(await result).toMatchObject({ code: 'cancelled' });
        expect((await h.store.listImageAssets())[0].state).toBe('available');
        expect(h.data.size).toBe(1);
        expect(h.processor.dispose).toHaveBeenCalledTimes(1);
        expect(h.vault.offref).toHaveBeenCalledTimes(3);
    });

    it('registers an existing vault reference without copying; rename is tracked and replacement blocks a cached derivative', async () => {
        const h = setup(); await h.vault.createBinary('notes/original.heic', bytes(1, 2, 3));
        const imported = await h.service.addVaultReference('notes/original.heic');
        const lease = await h.service.resolveVariant(imported.ref, 'provider'); lease.release();
        const file = h.entries.get('notes/original.heic')!;
        h.entries.delete(file.path); h.data.delete(file.path); file.path = 'renamed.heic';
        h.entries.set(file.path, file); h.data.set(file.path, bytes(1, 2, 3));
        h.listeners.get('rename')!(file, 'notes/original.heic');
        expect((await h.service.listAssets())[0].originalPath).toBe('renamed.heic');
        h.data.set(file.path, bytes(7, 2, 3));
        await expect(h.service.resolveVariant(imported.ref, 'provider')).rejects.toMatchObject({ code: 'source_changed' });
        expect(h.processor.process).toHaveBeenCalledTimes(1);
        expect(h.vault.createBinary).toHaveBeenCalledTimes(1);
        await expect(h.service.cleanupSelected([{ ref: imported.ref, path: file.path }])).rejects.toThrow();
        expect(h.vault.trash).not.toHaveBeenCalled();
    });

    it('relocates only matching bytes and removes PA-owned cleanup authority without modifying either file', async () => {
        const h = setup(), imported = await h.service.importFile(fileInput(), { acquisition: 'unverified_import' });
        await h.vault.createBinary('user-copy.heic', bytes(1, 2, 3));
        await h.vault.createBinary('wrong.heic', bytes(3, 2, 1));
        const held = await h.service.resolveVariant(imported.ref, 'preview'); held.release();
        await expect(h.service.relocate(imported.ref, 'wrong.heic')).rejects.toMatchObject({ code: 'source_changed' });
        const relocated = await h.service.relocate(imported.ref, 'user-copy.heic');
        expect(relocated.asset).toMatchObject({ source: 'vault_reference', originalPath: 'user-copy.heic', acquisition: 'original_file' });
        expect(relocated.ref).toEqual(imported.ref);
        expect(await h.store.listImageVariants()).toEqual([]);
        await expect(h.service.cleanupSelected([{ ref: imported.ref, path: 'user-copy.heic' }])).rejects.toMatchObject({ code: 'cleanup_selection_changed' });
        expect(h.vault.trash).not.toHaveBeenCalled(); expect(h.data.size).toBe(3);
    });
});

describe('image derivative leases', () => {
    it('rebuilds an unreadable cached Blob after a service reopen without changing the original', async () => {
        const h = setup(), imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        const first = await h.service.resolveVariant(imported.ref, 'preview'); first.release();
        const cached = (await h.store.listImageVariants())[0];
        jest.spyOn(cached.blob, 'arrayBuffer').mockRejectedValue(new DOMException('The object can not be found here.', 'NotFoundError'));
        await h.service.dispose();
        const reopened = new ImageAssetService(h.app, h.store, { processor: h.processor });
        const rebuilt = await reopened.resolveVariant(imported.ref, 'preview');
        expect(h.processor.process).toHaveBeenCalledTimes(2);
        expect([...new Uint8Array(await rebuilt.blob.arrayBuffer())]).toEqual([9, 8]);
        const reused = await reopened.resolveVariant(imported.ref, 'preview');
        expect(h.processor.process).toHaveBeenCalledTimes(2);
        expect(reused.blob).not.toBe(rebuilt.blob);
        expect([...new Uint8Array(await reused.blob.arrayBuffer())]).toEqual([9, 8]);
        expect(h.vault.createBinary).toHaveBeenCalledTimes(1);
        expect([...new Uint8Array(h.data.get(imported.asset.originalPath)!)]).toEqual([1, 2, 3]);
        rebuilt.release(); reused.release(); await reopened.dispose();
    });
    it('does not rebuild or rewrite a cache when cancellation arrives during its failed Blob read', async () => {
        const h = setup(), imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        const first = await h.service.resolveVariant(imported.ref, 'preview'); first.release();
        const cached = (await h.store.listImageVariants())[0];
        const started = deferred<void>(), late = deferred<void>(), controller = new AbortController();
        jest.spyOn(cached.blob, 'arrayBuffer').mockImplementation(async () => {
            started.resolve(); await late.promise;
            throw new DOMException('The object can not be found here.', 'NotFoundError');
        });
        const put = jest.spyOn(h.store, 'putImageVariant');
        const result = h.service.resolveVariant(imported.ref, 'preview', { signal: controller.signal }).catch((error: unknown) => error);
        await started.promise; controller.abort(); late.resolve();
        expect(await result).toMatchObject({ code: 'cancelled' });
        expect(h.processor.process).toHaveBeenCalledTimes(1); expect(put).not.toHaveBeenCalled();
        expect((await h.store.listImageVariants())[0].blob).toBe(cached.blob);
        await h.service.dispose();
    });
    it('does not disguise invalid derivative metadata as a cache quota fallback', async () => {
        const h = setup(), imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        const process = h.processor.process.getMockImplementation()!;
        h.processor.process.mockImplementation(async (input, options) => ({ ...await process(input, options), blob: new Blob([bytes(9, 8)], { type: 'image/png' }) }));
        await expect(h.service.resolveVariant(imported.ref, 'provider')).rejects.toThrow('MIME');
        expect(await h.store.listImageVariants()).toEqual([]);
        expect(h.data.size).toBe(1);
    });
    it('invalidates a final synchronous dispatch guard immediately on vault events or a changed Data Boundary', async () => {
        const h = setup(), imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        const verified = await h.service.verify(imported.ref);
        expect(verified.isCurrent()).toBe(true);
        h.listeners.get('modify')!(h.entries.get(imported.asset.originalPath)!);
        expect(verified.isCurrent()).toBe(false);
        const next = await h.service.verify(imported.ref);
        expect(next.isCurrent()).toBe(true);
        await h.service.dispose(); expect(next.isCurrent()).toBe(false);
    });
    it('clearing cache leaves a held immutable Blob valid; regeneration rechecks original', async () => {
        const h = setup(), imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        const lease = await h.service.resolveVariant(imported.ref, 'preview');
        await h.service.clearCache();
        expect(await h.store.listImageVariants()).toEqual([]);
        expect([...new Uint8Array(await lease.blob.arrayBuffer())]).toEqual([9, 8]);
        const next = await h.service.resolveVariant(imported.ref, 'preview');
        expect(h.processor.process).toHaveBeenCalledTimes(2);
        lease.release(); lease.release(); next.release();
    });

    it('quota failure returns an explicitly nonpersistent bounded lease and preserves the raw file', async () => {
        const h = setup(), imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        jest.spyOn(h.store, 'putImageVariant').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
        const lease = await h.service.resolveVariant(imported.ref, 'provider');
        expect(lease).toMatchObject({ persistent: false, warning: 'cache_not_retained' });
        expect(await h.store.listImageVariants()).toEqual([]);
        expect(h.data.size).toBe(1); lease.release();
    });

    it('ignores a late processor result after cancellation without caching it', async () => {
        const h = setup(), imported = await h.service.importFile(fileInput(), { acquisition: 'original_file' });
        const started = deferred<void>(), late = deferred<void>(), controller = new AbortController();
        const process = h.processor.process.getMockImplementation()!;
        h.processor.process.mockImplementation(async (input, opts) => { started.resolve(); await late.promise; return process(input, opts); });
        const task = h.service.resolveVariant(imported.ref, 'provider', { signal: controller.signal });
        const result = task.catch((error: unknown) => error);
        await started.promise; controller.abort(); late.resolve();
        expect(await result).toMatchObject({ code: 'cancelled' });
        expect(await h.store.listImageVariants()).toEqual([]);
    });

    it('LRU eviction skips leased keys and aborts a write that cannot fit, without partially evicting', async () => {
        const store = new MemoryChatHistoryStore(), hash = 'a'.repeat(64);
        const asset: ImageAsset = { id: 'asset', source: 'vault_reference', originalPath: 'a.jpg', originalHash: hash,
            byteLength: 1, detectedMime: 'image/jpeg', acquisition: 'original_file', state: 'available', anchorPath: 'PA Chat.md', anchorKind: 'logical_root', createdAt: 1, owners: [] };
        await store.putImageAsset(asset);
        const variant = (id: string, lastUsedAt: number): ImageVariantRecord => ({ id, assetId: 'asset', contentHash: hash,
            processorVersion: 1, purpose: 'preview', policyFingerprint: 'policy', blob: new Blob([bytes(1, 2)], { type: 'image/jpeg' }),
            mime: 'image/jpeg', byteLength: 2, width: 1, height: 1, lastUsedAt });
        await store.putImageVariant(variant('one', 1), 4, []);
        await store.putImageVariant(variant('two', 2), 4, []);
        await store.putImageVariant(variant('three', 3), 4, ['one']);
        expect((await store.listImageVariants()).map((v) => v.id)).toEqual(['one', 'three']);
        await expect(store.putImageVariant(variant('four', 4), 4, ['one', 'three'])).rejects.toThrow();
        expect((await store.listImageVariants()).map((v) => v.id)).toEqual(['one', 'three']);
        expect(IMAGE_POLICY.cacheMaxBytes).toBe(64 * 1024 * 1024);
    });
});

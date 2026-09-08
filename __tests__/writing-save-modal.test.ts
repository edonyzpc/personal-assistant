import { Notice, TFile, TFolder, type App } from 'obsidian';
import { DomStubNode, findAllByClass, findAllByTag } from './helpers/dom-stub';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { WritingSaveModal, WritingSaveRecoveryListModal, WritingVersionModal } from '../src/chat/writing-modal';
import type { WritingVersionService } from '../src/chat/writing-versions';
import { WritingSaveAction, type PreparedWritingSave } from '../src/chat/writing-save-action';
import { hashWritingText, type WritingVersion } from '../src/chat/writing-types';
import { imageSourceHash } from '../src/chat/image-policy';
import type { ImageAssetService } from '../src/chat/image-assets';
import type { ImageAsset, ImageRef } from '../src/chat/image-types';
import { pluginT } from '../src/locales/plugin';

jest.mock('../src/platform-dom', () => ({
    ...jest.requireActual('../src/platform-dom'),
    getPlatformCrypto: () => jest.requireActual('node:crypto').webcrypto,
}));

/** Obsidian's element helpers and DOM event properties on the existing shared tree. */
class ModalElement extends DomStubNode {
    onclick?: () => void | Promise<void>;
    onchange?: () => void;
    oninput?: () => void;
    open = false;
    focus = jest.fn();
    addClass(value: string): void { this.classList.add(value); }
    empty(): void { this.textContent = ''; }
    createEl(tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): ModalElement {
        const element = this.appendChild(new ModalElement(tag));
        if (options.cls) element.addClass(options.cls);
        if (options.text) element.setText(options.text);
        for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
        return element;
    }
    createDiv(options?: Parameters<ModalElement['createEl']>[1]): ModalElement { return this.createEl('div', options); }
    createSpan(options?: Parameters<ModalElement['createEl']>[1]): ModalElement { return this.createEl('span', options); }
    click(): void | Promise<void> {
        for (let node: DomStubNode | null = this; node; node = node.parentElement) {
            if (node.disabled || node.hidden) return;
        }
        return this.onclick?.();
    }
}

const nodes = (root: DomStubNode, tag: string) => findAllByTag(root, tag) as ModalElement[];
const byClass = (root: DomStubNode, cls: string) => findAllByClass(root, cls)[0] as ModalElement;
const button = (root: DomStubNode, label: string) => {
    const result = nodes(root, 'button').find((element) => element.textContent === pluginT(`plugin.chat.writing.${label}`));
    if (!result) throw new Error(`Missing button: ${label}`);
    return result;
};
const text = (root: DomStubNode): string => [root.textContent, ...root.children.map(text)].join('\n');

async function setup(chatOnly = false) {
    const store = new MemoryChatHistoryStore();
    const files = new Map<string, TFile | TFolder>();
    const notes = new Map<string, string>();
    const binary = new Map<string, ArrayBuffer>();
    const assets = new Map<string, ImageAsset>();
    const file = (path: string, size: number) => Object.assign(new TFile(), { path, stat: { size, mtime: 0, ctime: 0 } });
    const source = Uint8Array.from([255, 216, 255, 192, 0, 8, 8, 0, 3, 0, 4, 1, 255, 217]).buffer;
    const hash = await imageSourceHash(source);
    const associatedImages = [1, 2, 3].map((ordinal) => ({
        ordinal, label: `Photo ${ordinal}`, ref: { assetId: `asset_${ordinal}`, contentHash: hash },
    }));
    for (const image of associatedImages) {
        const asset: ImageAsset = { id: image.ref.assetId, originalHash: hash, source: chatOnly ? 'imported' : 'vault_reference',
            originalPath: chatOnly ? `assets/pa-images/${image.ordinal}.jpg` : `photos/${image.ordinal}.jpg`,
            importDirectory: chatOnly ? 'assets/pa-images' : undefined, detectedMime: 'image/jpeg', byteLength: source.byteLength,
            acquisition: 'original_file', anchorPath: 'PA Chat.md', anchorKind: 'logical_root',
            state: 'available', createdAt: 1, owners: [] };
        assets.set(asset.id, asset);
        files.set(asset.originalPath, file(asset.originalPath, source.byteLength));
        binary.set(asset.originalPath, source);
        await store.putImageAsset(asset);
    }
    const version: WritingVersion = { id: 'writing_modal_1', requestId: 'request_1', messageId: 'message_1',
        text: 'Exact body\n  Keep this spacing.', textHash: await hashWritingText('Exact body\n  Keep this spacing.'),
        explanation: 'Do not save this explanation.', origin: 'ai_generated', conversationId: 'conversation_1',
        turnIndex: 0, createdAt: 1, associatedImages, backgroundSourceRefs: [], styleRevisionIds: [] };
    await store.putWritingVersion(version);
    const vault = {
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        createFolder: jest.fn(async (path: string) => { files.set(path, Object.assign(new TFolder(), { path })); }),
        create: jest.fn(async (path: string, body: string) => {
            if (files.has(path)) throw new Error('exists');
            const created = file(path, body.length); files.set(path, created); notes.set(path, body); return created;
        }),
        createBinary: jest.fn(async (path: string, data: ArrayBuffer) => {
            if (files.has(path)) throw new Error('exists');
            const created = file(path, data.byteLength); files.set(path, created); binary.set(path, data); return created;
        }),
        read: jest.fn(async (file: TFile) => notes.get(file.path)!),
        readBinary: jest.fn(async (file: TFile) => binary.get(file.path)!),
        process: jest.fn(async (file: TFile, change: (body: string) => string) => {
            const updated = change(notes.get(file.path)!); notes.set(file.path, updated); return updated;
        }),
        on: jest.fn(() => ({})), offref: jest.fn(),
    };
    const images = {
        readOriginal: jest.fn(async (ref: ImageRef) => ({ asset: assets.get(ref.assetId)!, bytes: source })),
        verify: jest.fn(async (ref: ImageRef) => ({ asset: assets.get(ref.assetId)!, isCurrent: () => true })),
        promoteToNote: jest.fn(async (ref: ImageRef, options: Parameters<ImageAssetService['promoteToNote']>[1]) => {
            const targetPath = typeof options.targetPath === 'function' ? await options.targetPath() : options.targetPath;
            const asset = assets.get(ref.assetId)!;
            const original = files.get(asset.originalPath)!;
            binary.delete(asset.originalPath); files.delete(asset.originalPath);
            asset.originalPath = targetPath; asset.source = 'vault_reference';
            original.path = targetPath;
            files.set(targetPath, original); binary.set(targetPath, source);
            return { path: targetPath };
        }),
    };
    const openLinkText = jest.fn(async (): Promise<void> => undefined);
    const app = { vault, workspace: { openLinkText }, fileManager: {
        getAvailablePathForAttachment: jest.fn(async (name: string) => `assets/${name}`),
        generateMarkdownLink: (file: TFile) => `[[${file.path}]]`,
    } } as unknown as App;
    const save = new WritingSaveAction(app, store, images as unknown as ImageAssetService);
    const prepare = jest.spyOn(save, 'prepare');
    const execute = jest.spyOn(save, 'execute');
    const retry = jest.spyOn(save, 'retry');
    const root = new ModalElement('div');
    const modal = new WritingSaveModal(app, save, version);
    modal.contentEl = root as unknown as HTMLElement;
    modal.onOpen();
    const fields = nodes(root, 'input').filter((input) => input.getAttribute('type') === 'text');
    return { store, save, prepare, execute, retry, root, modal, title: fields[0], folder: fields[1], version,
        vault, images, notes, openLinkText };
}

/** Receipts are serialized behind an active save; draining reads waits for the real action. */
async function settleSave(h: Awaited<ReturnType<typeof setup>>): Promise<void> {
    await h.save.listReceipts(h.version.id);
    await Promise.resolve();
}

async function openSaveFromVersion(h: Awaited<ReturnType<typeof setup>>) {
    h.modal.onClose();
    const parent = new WritingVersionModal(h.modal.app, {
        save: h.save,
        versions: { get: async () => h.version, list: async () => [h.version], edit: async () => h.version } as unknown as WritingVersionService,
    }, h.version.id);
    const parentRoot = new ModalElement('div');
    parent.contentEl = parentRoot as unknown as HTMLElement;
    const closeParent = jest.spyOn(parent, 'close').mockImplementation(() => parent.onClose());
    parent.onOpen();
    await Promise.resolve(); await Promise.resolve();
    let child!: WritingSaveModal;
    const childRoot = new ModalElement('div');
    const open = jest.spyOn(WritingSaveModal.prototype, 'open').mockImplementation(function (this: WritingSaveModal) {
        child = this; this.contentEl = childRoot as unknown as HTMLElement; this.onOpen();
    });
    try { await button(parentRoot, 'save').click(); }
    finally { open.mockRestore(); }
    const closeChild = jest.spyOn(child, 'close').mockImplementation(() => child.onClose());
    return { parentRoot, childRoot, closeParent, closeChild, parent, child };
}

describe('writing save modal title, location and explicit confirmation', () => {
    it('previews all images at the vault root without writing, then executes the fixed plan once', async () => {
        const h = await setup();
        expect(h.title.value).not.toMatch(/\.md$/);
        expect(h.folder.value).toBe('');
        expect(byClass(h.root, 'pa-writing-save__location').open).toBe(false);
        h.title.value = 'A quiet day';
        await button(h.root, 'preview').click();
        expect(h.prepare.mock.calls[0][0]).toMatchObject({ targetNotePath: 'A quiet day.md', images: h.version.associatedImages });
        expect(h.vault.create).not.toHaveBeenCalled();
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(await h.store.listSaveReceipts()).toEqual([]);
        expect(h.execute).not.toHaveBeenCalled();
        const result = byClass(h.root, 'pa-writing-save__result');
        expect(text(byClass(result, 'pa-writing-save__destination'))).toContain('Vault root');
        expect(text(byClass(result, 'pa-writing-save__destination'))).toContain('A quiet day');
        const details = byClass(result, 'pa-writing-save__details');
        expect(details.open).toBe(false);
        expect(text(details)).toContain('pa_writing:');
        expect(text(details)).toContain('Photo 1 → photos/1.jpg');
        expect(nodes(result, 'pre')[0].textContent).toBe(h.version.text);
        h.title.value = 'Changed after preview';
        h.folder.value = 'Different';
        const confirm = button(h.root, 'confirmSave');
        confirm.click(); confirm.click();
        await settleSave(h);
        expect(h.execute).toHaveBeenCalledTimes(1);
        expect(h.vault.create).toHaveBeenCalledTimes(1);
        expect(h.vault.createBinary).not.toHaveBeenCalled();
        expect(h.notes.get('A quiet day.md')).toContain(h.version.text);
        expect(h.notes.has('Different/Changed after preview.md')).toBe(false);
        button(h.root, 'openNote').click();
        expect(h.openLinkText).toHaveBeenCalledWith('A quiet day.md', '', true);
        h.modal.onClose(); await h.save.dispose();
    });

    it('explains HEIC rejection without creating a note or discarding the form', async () => {
        const h = await setup();
        h.title.value = 'Keep this title';
        h.prepare.mockRejectedValueOnce(new Error('writing_save:heic_unsupported'));
        await button(h.root, 'preview').click();
        expect(text(byClass(h.root, 'pa-writing-save__result'))).toContain('Convert the image to JPEG');
        expect(h.title.value).toBe('Keep this title');
        expect(byClass(h.root, 'pa-writing-save__form').hidden).toBe(false);
        expect(byClass(h.root, 'pa-writing-save__form').disabled).toBe(false);
        expect(h.vault.create).not.toHaveBeenCalled();
        expect(h.images.promoteToNote).not.toHaveBeenCalled();
        h.modal.onClose(); await h.save.dispose();
    });

    it('explains HEIC failure returned in a durable receipt while keeping recovery available', async () => {
        const h = await setup();
        await button(h.root, 'preview').click();
        const prepared = await h.prepare.mock.results[0].value;
        h.execute.mockResolvedValueOnce({ ...prepared.receipt, state: 'partial', failureReason: 'heic_unsupported' });
        button(h.root, 'confirmSave').click();
        await settleSave(h);
        expect(text(byClass(h.root, 'pa-writing-save__result'))).toContain('Convert the image to JPEG');
        expect(button(h.root, 'retrySave').disabled).toBe(false);
        h.modal.onClose(); await h.save.dispose();
    });

    it('keeps title and folder separate and retains image selection and ordering behind details', async () => {
        const h = await setup();
        h.title.value = 'Trip.md'; h.folder.value = 'Journal/Trips'; h.folder.oninput?.();
        expect(text(byClass(h.root, 'pa-writing-save__location-summary'))).toContain('Journal/Trips');
        const rows = findAllByClass(h.root, 'pa-writing-modal__image');
        const second = nodes(rows[1], 'input')[0]; second.checked = false; second.onchange?.();
        nodes(rows[2], 'button')[0].click();
        nodes(findAllByClass(h.root, 'pa-writing-modal__image')[1], 'button')[0].click();
        await button(h.root, 'preview').click();
        expect(h.prepare.mock.calls[0][0]).toMatchObject({ targetNotePath: 'Journal/Trips/Trip.md',
            images: [h.version.associatedImages[2], h.version.associatedImages[0]] });
        const prepared = await h.prepare.mock.results[0].value;
        const release = jest.spyOn(prepared, 'release');
        button(h.root, 'editSave').click();
        expect(release).toHaveBeenCalledTimes(1);
        expect(h.title.value).toBe('Trip.md'); expect(h.folder.value).toBe('Journal/Trips');
        expect(byClass(h.root, 'pa-writing-save__form').hidden).toBe(false);
        h.modal.onClose(); await h.save.dispose();
    });

    it.each(['../outside', 'Journal/../../outside', '/outside'])('passes unsafe folder %s unchanged to the existing rejecting validator', async (folder) => {
        const h = await setup();
        h.title.value = 'Trip'; h.folder.value = folder;
        await button(h.root, 'preview').click();
        expect(h.prepare.mock.calls[0][0].targetNotePath).toBe(`${folder}/Trip.md`);
        expect(h.vault.create).not.toHaveBeenCalled();
        expect(h.vault.createFolder).not.toHaveBeenCalled();
        expect(h.execute).not.toHaveBeenCalled();
        expect(byClass(h.root, 'pa-writing-save__form').disabled).toBe(false);
        expect(byClass(h.root, 'pa-writing-save__form').hidden).toBe(false);
        h.folder.value = 'Journal';
        await button(h.root, 'preview').click();
        expect(h.prepare.mock.calls[1][0].targetNotePath).toBe('Journal/Trip.md');
        expect(button(h.root, 'confirmSave')).toBeDefined();
        h.modal.onClose(); await h.save.dispose();
    });

    it('rejects path separators in titles before preparing and releases an unconfirmed preview on close', async () => {
        const h = await setup();
        h.title.value = '../Trip';
        await button(h.root, 'preview').click();
        expect(h.prepare).not.toHaveBeenCalled();
        h.title.value = 'Trip';
        await button(h.root, 'preview').click();
        const prepared = await h.prepare.mock.results[0].value;
        const release = jest.spyOn(prepared, 'release');
        h.modal.onClose(); h.modal.onClose();
        expect(release).toHaveBeenCalledTimes(1);
        expect(h.root.children).toHaveLength(0);
        await expect(h.save.execute(prepared.operationId)).rejects.toThrow('preview_released');
        expect(h.vault.create).not.toHaveBeenCalled();
        await h.save.dispose();
    });

    it('aborts pending preparation and releases its late result without restoring the closed form', async () => {
        const h = await setup();
        let finish!: (value: PreparedWritingSave) => void;
        h.prepare.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const opening = button(h.root, 'preview').click();
        h.modal.onClose();
        expect(h.prepare.mock.calls[0][0].signal?.aborted).toBe(true);
        const release = jest.fn();
        finish({ release } as unknown as PreparedWritingSave);
        await opening;
        expect(release).toHaveBeenCalledTimes(1);
        expect(h.root.children).toHaveLength(0);
        expect(h.execute).not.toHaveBeenCalled();
        await h.save.dispose();
    });

    it('keeps the actual partial destination and retries the durable receipt without another note creation', async () => {
        const h = await setup(true);
        h.title.value = 'Trip'; h.folder.value = 'Journal';
        h.images.promoteToNote.mockRejectedValueOnce(new Error('temporary move failure'));
        await button(h.root, 'preview').click();
        button(h.root, 'confirmSave').click();
        await settleSave(h);
        const partial = (await h.store.listSaveReceipts())[0];
        expect(partial.state).toBe('partial');
        const result = byClass(h.root, 'pa-writing-save__result');
        expect(text(byClass(result, 'pa-writing-save__destination'))).toContain('Journal');
        expect(text(byClass(result, 'pa-writing-save__details'))).toContain('Journal/Trip.md');
        expect(nodes(result, 'pre')[0].textContent).toBe(h.version.text);
        h.modal.onClose();
        const reopened = new WritingSaveModal(h.modal.app, h.save, h.version);
        const recoveryRoot = new ModalElement('div');
        reopened.contentEl = recoveryRoot as unknown as HTMLElement;
        reopened.onOpen(); await settleSave(h);
        nodes(recoveryRoot, 'button').find((entry) => entry.textContent.endsWith(' · Journal/Trip.md'))!.click();
        const recovered = byClass(recoveryRoot, 'pa-writing-save__result');
        expect(nodes(recovered, 'pre')[0].textContent).toBe(h.version.text);
        expect(text(byClass(recovered, 'pa-writing-save__destination'))).toContain('Journal');
        button(recovered, 'retrySave').click();
        await settleSave(h);
        expect(h.retry).toHaveBeenCalledWith(partial.operationId, expect.any(Object));
        expect((await h.store.listSaveReceipts())[0].state).toBe('completed');
        expect(h.vault.create).toHaveBeenCalledTimes(1);
        expect(button(recovered, 'openNote')).toBeDefined();
        reopened.onClose(); await h.save.dispose();
    });

    it('closes both save and version modals only after the completed note opens successfully', async () => {
        const h = await setup();
        const stacked = await openSaveFromVersion(h);
        await button(stacked.childRoot, 'preview').click();
        button(stacked.childRoot, 'confirmSave').click();
        await settleSave(h);
        expect(stacked.closeParent).not.toHaveBeenCalled();
        expect(stacked.closeChild).not.toHaveBeenCalled();
        let finish!: () => void;
        h.openLinkText.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
        const opening = button(stacked.childRoot, 'openNote').click();
        expect(stacked.closeParent).not.toHaveBeenCalled();
        expect(stacked.closeChild).not.toHaveBeenCalled();
        finish(); await opening;
        expect(stacked.closeChild).toHaveBeenCalledTimes(1);
        expect(stacked.closeParent).toHaveBeenCalledTimes(1);
        expect(stacked.childRoot.children).toHaveLength(0);
        expect(stacked.parentRoot.children).toHaveLength(0);
        await h.save.dispose();
    });

    it('retains both modals and partial recovery when opening fails, and allows opening again', async () => {
        const h = await setup(true);
        const stacked = await openSaveFromVersion(h);
        h.images.promoteToNote.mockRejectedValueOnce(new Error('temporary move failure'));
        await button(stacked.childRoot, 'preview').click();
        button(stacked.childRoot, 'confirmSave').click();
        await settleSave(h);
        const partial = (await h.store.listSaveReceipts())[0];
        expect(partial.state).toBe('partial');
        h.openLinkText.mockRejectedValueOnce(new Error('navigation unavailable'));
        const open = button(stacked.childRoot, 'openNote');
        await open.click();
        expect(stacked.closeParent).not.toHaveBeenCalled();
        expect(stacked.closeChild).not.toHaveBeenCalled();
        expect(open.disabled).toBe(false);
        expect(nodes(stacked.childRoot, 'pre')[0].textContent).toBe(h.version.text);
        expect(button(stacked.childRoot, 'retrySave').disabled).toBe(false);
        const notices = (Notice as typeof Notice & { messages: Array<{ message?: unknown }> }).messages;
        expect(notices[notices.length - 1].message).toBe(pluginT('plugin.chat.notice.openNoteFailed', 'en', { note: partial.targetNotePath }));
        await open.click();
        expect(stacked.closeChild).toHaveBeenCalledTimes(1);
        expect(stacked.closeParent).toHaveBeenCalledTimes(1);
        expect((await h.store.listSaveReceipts())[0].state).toBe('partial');
        expect(h.retry).not.toHaveBeenCalled();
        await h.save.dispose();
    });

    it('also dismisses the recovery-list parent after opening an existing partial note', async () => {
        const h = await setup(true);
        h.title.value = 'Recover this note';
        h.images.promoteToNote.mockRejectedValueOnce(new Error('temporary move failure'));
        await button(h.root, 'preview').click();
        button(h.root, 'confirmSave').click();
        await settleSave(h); h.modal.onClose();
        const parent = new WritingSaveRecoveryListModal(h.modal.app, h.save,
            { get: async () => h.version } as unknown as WritingVersionService);
        const parentRoot = new ModalElement('div');
        parent.contentEl = parentRoot as unknown as HTMLElement;
        const closeParent = jest.spyOn(parent, 'close').mockImplementation(() => parent.onClose());
        parent.onOpen(); await settleSave(h);
        let child!: WritingSaveModal;
        const childRoot = new ModalElement('div');
        const openChild = jest.spyOn(WritingSaveModal.prototype, 'open').mockImplementation(function (this: WritingSaveModal) {
            child = this; this.contentEl = childRoot as unknown as HTMLElement; this.onOpen();
        });
        try { await nodes(parentRoot, 'button').find((entry) => entry.textContent === 'Recover this note.md')!.click(); }
        finally { openChild.mockRestore(); }
        const closeChild = jest.spyOn(child, 'close').mockImplementation(() => child.onClose());
        await settleSave(h);
        nodes(childRoot, 'button').find((entry) => entry.textContent.endsWith(' · Recover this note.md'))!.click();
        expect(closeParent).not.toHaveBeenCalled();
        await button(childRoot, 'openNote').click();
        expect(closeChild).toHaveBeenCalledTimes(1);
        expect(closeParent).toHaveBeenCalledTimes(1);
        expect(parentRoot.children).toHaveLength(0);
        expect(childRoot.children).toHaveLength(0);
        expect((await h.store.listSaveReceipts())[0].state).toBe('partial');
        expect(h.retry).not.toHaveBeenCalled();
        await h.save.dispose();
    });
});

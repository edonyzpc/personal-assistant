import { Modal, TFile, type App } from 'obsidian';
import { getPluginUiLanguage, makePluginTranslator } from '../locales/plugin';
import type { ImageAssetService } from './image-assets';
import type { ImageRef } from './image-types';

/** The destination is an explicit choice for every save, including repeat saves. */
export class GeneratedImageNotePickerModal extends Modal {
    constructor(app: App, private readonly onChoose: (note: TFile) => void) { super(app); }

    onOpen(): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        this.contentEl.addClass('pa-chat-image-picker');
        this.contentEl.createEl('h2', { text: t('plugin.chat.createImage.chooseNote') });
        const query = this.contentEl.createEl('input', { attr: { type: 'search',
            placeholder: t('plugin.chat.images.search'), 'aria-label': t('plugin.chat.createImage.chooseNote') } });
        const list = this.contentEl.createDiv({ cls: 'pa-chat-image-picker__list' });
        const render = () => {
            list.empty();
            const matches = this.app.vault.getMarkdownFiles().filter(note =>
                note.path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()));
            for (const note of matches.slice(0, 100)) {
                const button = list.createEl('button', { text: note.path, attr: { type: 'button' } });
                button.onclick = () => { this.close(); this.onChoose(note); };
            }
            if (!matches.length) list.createEl('p', { text: t('plugin.chat.createImage.noNotes') });
        };
        query.oninput = render;
        render();
        query.focus();
    }

    onClose(): void { this.contentEl.empty(); }
}

/** Promote a generated original once, then append a Markdown embed to the chosen note. */
export async function saveGeneratedImageToNote(app: App, images: ImageAssetService,
    ref: ImageRef, note: TFile, operationId: string, assertSourceCurrent?: () => void): Promise<void> {
    const requireNote = () => {
        assertSourceCurrent?.();
        if (note.extension !== 'md' || app.vault.getAbstractFileByPath(note.path) !== note) {
            throw new Error('Selected note is no longer available.');
        }
    };
    requireNote();
    const { asset } = await images.readOriginal(ref, 'note');
    requireNote();
    let imagePath = asset.originalPath;
    if (asset.source === 'imported') {
        const filename = imagePath.split('/').pop();
        if (!filename) throw new Error('Generated image has no filename.');
        const result = await images.promoteToNote(ref, { sourcePath: imagePath, operationId,
            ...(assertSourceCurrent ? { isCurrent: () => { assertSourceCurrent(); return true; } } : {}),
            targetPath: async () => {
                requireNote();
                const path = await app.fileManager.getAvailablePathForAttachment(filename, note.path);
                requireNote();
                return path;
            } });
        imagePath = result.path;
    }
    requireNote();
    const imageFile = app.vault.getAbstractFileByPath(imagePath);
    if (!(imageFile instanceof TFile)) throw new Error('Generated image is no longer available.');
    const link = app.fileManager.generateMarkdownLink(imageFile, note.path);
    const embed = link.startsWith('!') ? link : `!${link}`;
    await app.vault.process(note, (content) => {
        requireNote();
        if (content.split(/\r?\n/).some(line => line.trim() === embed)) return content;
        return `${content}${content && !content.endsWith('\n') ? '\n' : ''}${content ? '\n' : ''}${embed}\n`;
    });
}

import { Modal, TFile, Platform, type App } from 'obsidian';
import { imageDirectoryIgnoreRule, type ImageAssetService } from './image-assets';
import { confirmChatAction } from './modals';
import { getPluginUiLanguage, makePluginTranslator } from '../locales/plugin';
import { isChatImageAsset, type ImageAsset } from './image-types';

const imageExtension = /\.(?:jpe?g|png|webp|gif|apng|heic|heif|svg|avif|bmp|tiff?)$/i;

export type ImageSourceChoice = 'photos' | 'files' | 'vault';

/** One image entry point with device-appropriate sources. */
export class ImageSourcePickerModal extends Modal {
    private closed = false;
    constructor(app: App, private readonly onChoose: (source: ImageSourceChoice) => void) { super(app); }
    onOpen(): void {
        this.closed = false;
        const t = makePluginTranslator(getPluginUiLanguage());
        this.contentEl.addClass('pa-chat-image-picker');
        this.contentEl.createEl('h2', { text: t('plugin.chat.images.add') });
        const list = this.contentEl.createDiv({ cls: 'pa-chat-image-picker__list' });
        const sources: ImageSourceChoice[] = Platform.isMobileApp ? ['photos', 'files', 'vault'] : ['files', 'vault'];
        for (const source of sources) {
            const button = list.createEl('button', {
                text: t(`plugin.chat.images.source.${source}`), attr: { type: 'button' },
            });
            button.onclick = () => {
                if (this.closed) return;
                this.close();
                this.onChoose(source);
            };
        }
    }
    onClose(): void { this.closed = true; this.contentEl.empty(); }
}

/** Adds existing vault originals without making another source copy. */
export class VaultImagePickerModal extends Modal {
    constructor(app: App, private readonly onChoose: (file: TFile) => void) { super(app); }
    onOpen(): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        this.contentEl.addClass('pa-chat-image-picker');
        this.contentEl.createEl('h2', { text: t('plugin.chat.images.fromVault') });
        const query = this.contentEl.createEl('input', { attr: { type: 'search', placeholder: t('plugin.chat.images.search'), 'aria-label': t('plugin.chat.images.search') } });
        const list = this.contentEl.createDiv({ cls: 'pa-chat-image-picker__list' });
        const render = () => {
            list.empty();
            const matches = this.app.vault.getFiles().filter((file) => imageExtension.test(file.path)
                && file.path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()));
            for (const file of matches.slice(0, 100)) {
                const button = list.createEl('button', { text: file.path, attr: { type: 'button' } });
                button.onclick = () => { this.onChoose(file); this.close(); };
            }
            if (!matches.length) list.createEl('p', { text: t('plugin.chat.images.none') });
        };
        query.oninput = render;
        render();
        query.focus();
    }
    onClose(): void { this.contentEl.empty(); }
}

export class ImageManagementModal extends Modal {
    private closed = false;
    private busy = false;
    constructor(app: App, private readonly images: ImageAssetService) { super(app); }
    onOpen(): void { this.closed = false; void this.render(); }
    onClose(): void { this.closed = true; this.contentEl.empty(); }

    private async render(): Promise<void> {
        const t = makePluginTranslator(getPluginUiLanguage());
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pa-chat-image-management');
        contentEl.createEl('h2', { text: t('plugin.chat.images.manage') });
        contentEl.createEl('p', { text: t('plugin.chat.images.cleanupScope') });
        // Keep the disclosure available even if local asset storage cannot open.
        const providerHelp = contentEl.createEl('details');
        providerHelp.createEl('summary', { text: t('plugin.chat.images.providerHelp') });
        providerHelp.createEl('p', { text: t('plugin.chat.images.providerNotice') });
        providerHelp.createEl('p', { text: t('plugin.chat.images.metadataNotice') });
        const status = contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
        try {
            const assets = (await this.images.listAssets()).filter((asset) => asset.source === 'imported' && isChatImageAsset(asset));
            if (this.closed) return;
            const help = contentEl.createEl('details');
            help.createEl('summary', { text: t('plugin.chat.images.syncHelp') });
            help.createEl('p', { text: t('plugin.chat.images.syncHelpIntro') });
            for (const directory of new Set(assets.filter((asset) => asset.originalPath.startsWith(`${asset.importDirectory}/`))
                .map((asset) => asset.importDirectory).filter((path): path is string => !!path))) {
                help.createEl('p', { text: directory });
                help.createEl('pre', { text: imageDirectoryIgnoreRule(directory) });
            }
            help.createEl('p', { text: t('plugin.chat.images.syncObsidianHelp') });
            help.createEl('p', { text: t('plugin.chat.images.syncGitHelp') });
            help.createEl('p', { text: t('plugin.chat.images.syncICloudHelp') });
            const selections = new Map<string, ImageAsset>();
            const list = contentEl.createDiv({ cls: 'pa-chat-image-management__list' });
            for (const asset of assets) {
                const row = list.createDiv({ cls: 'pa-chat-image-management__item' });
                const label = row.createEl('label');
                if (Platform.isDesktopApp) {
                    const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
                    checkbox.disabled = this.busy || asset.state !== 'available';
                    checkbox.onchange = () => { if (checkbox.checked) selections.set(asset.id, asset); else selections.delete(asset.id); };
                }
                label.createSpan({ text: `${asset.originalPath} · ${(asset.byteLength / (1024 * 1024)).toFixed(2)} MB` });
                row.createEl('small', { text: t('plugin.chat.images.knownRefs', { count: asset.owners.length }) });
                const open = row.createEl('button', { text: t('plugin.chat.images.openOriginal', { name: asset.originalPath }), attr: { type: 'button' } });
                open.onclick = () => {
                    const file = this.app.vault.getAbstractFileByPath(asset.originalPath);
                    if (file instanceof TFile) void this.app.workspace.openLinkText(file.path, asset.anchorPath, true);
                    else status.setText(t('plugin.chat.images.originalMissing'));
                };
            }
            if (!assets.length) list.createEl('p', { text: t('plugin.chat.images.none') });
            const clear = contentEl.createEl('button', { text: t('plugin.chat.images.clearCache'), attr: { type: 'button' } });
            clear.disabled = this.busy;
            clear.onclick = () => { void this.images.clearCache().then(() => {
                if (!this.closed) status.setText(t('plugin.chat.images.cacheCleared'));
            }).catch(() => { if (!this.closed) status.setText(t('plugin.chat.images.operationFailed')); }); };
            if (!Platform.isDesktopApp) {
                contentEl.createEl('p', { text: t('plugin.chat.images.cleanupMobile') });
                return;
            }
            const remove = contentEl.createEl('button', { text: t('plugin.chat.images.deleteSelected'), cls: 'mod-warning', attr: { type: 'button' } });
            remove.disabled = this.busy;
            remove.onclick = async () => {
                if (this.busy || !selections.size) return;
                const chosen = [...selections.values()].map((asset) => ({ ref: { assetId: asset.id, contentHash: asset.originalHash }, path: asset.originalPath }));
                if (!await confirmChatAction({ app: this.app }, {
                    title: t('plugin.chat.images.deleteSelected'), message: `${t('plugin.chat.images.deleteConfirm')}\n${chosen.map((entry) => entry.path).join('\n')}`,
                    confirmText: t('plugin.chat.images.deleteSelected'), danger: true,
                }) || this.closed) return;
                this.busy = true; remove.disabled = true; clear.disabled = true;
                try {
                    await this.images.cleanupSelected(chosen);
                    this.busy = false;
                    if (!this.closed) await this.render();
                } catch (error) {
                    this.busy = false; remove.disabled = false; clear.disabled = false;
                    if (!this.closed) status.setText(String(error).includes('cleanup_path_unverifiable')
                        ? t('plugin.chat.images.cleanupUnavailable') : t('plugin.chat.images.cleanupChanged'));
                }
            };
        } catch { if (!this.closed) status.setText(t('plugin.chat.images.operationFailed')); }
    }
}

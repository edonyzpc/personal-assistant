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

/** Mount the concrete image management content used by Chat and Settings. */
export function mountImageManagementContent(
    container: HTMLElement,
    app: App,
    images: ImageAssetService,
): () => void {
    let closed = false;
    let busy = false;

    const render = async (): Promise<void> => {
        const t = makePluginTranslator(getPluginUiLanguage());
        container.empty();
        container.addClass('pa-chat-image-management');
        container.createEl('p', { text: t('plugin.chat.images.cleanupScope') });
        // Keep the disclosure available even if local asset storage cannot open.
        const providerHelp = container.createEl('details');
        providerHelp.createEl('summary', { text: t('plugin.chat.images.providerHelp') });
        providerHelp.createEl('p', { text: t('plugin.chat.images.providerNotice') });
        providerHelp.createEl('p', { text: t('plugin.chat.images.metadataNotice') });
        const status = container.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
        try {
            const assets = (await images.listAssets()).filter((asset) => asset.source === 'imported' && isChatImageAsset(asset));
            if (closed) return;
            const help = container.createEl('details');
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
            const list = container.createDiv({ cls: 'pa-chat-image-management__list' });
            for (const asset of assets) {
                const row = list.createDiv({ cls: 'pa-chat-image-management__item' });
                const label = row.createEl('label');
                if (Platform.isDesktopApp) {
                    const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
                    checkbox.disabled = busy || asset.state !== 'available';
                    checkbox.onchange = () => { if (checkbox.checked) selections.set(asset.id, asset); else selections.delete(asset.id); };
                }
                label.createSpan({ text: `${asset.originalPath} · ${(asset.byteLength / (1024 * 1024)).toFixed(2)} MB` });
                row.createEl('small', { text: t('plugin.chat.images.knownRefs', { count: asset.owners.length }) });
                const open = row.createEl('button', { text: t('plugin.chat.images.openOriginal', { name: asset.originalPath }), attr: { type: 'button' } });
                open.onclick = () => {
                const file = app.vault.getAbstractFileByPath(asset.originalPath);
                if (file instanceof TFile) void app.workspace.openLinkText(file.path, asset.anchorPath, true);
                    else status.setText(t('plugin.chat.images.originalMissing'));
                };
            }
            if (!assets.length) list.createEl('p', { text: t('plugin.chat.images.none') });
            const clear = container.createEl('button', { text: t('plugin.chat.images.clearCache'), attr: { type: 'button' } });
            clear.disabled = busy;
            clear.onclick = () => { void images.clearCache().then(() => {
                if (!closed) status.setText(t('plugin.chat.images.cacheCleared'));
            }).catch(() => { if (!closed) status.setText(t('plugin.chat.images.operationFailed')); }); };
            if (!Platform.isDesktopApp) {
                container.createEl('p', { text: t('plugin.chat.images.cleanupMobile') });
                return;
            }
            const remove = container.createEl('button', { text: t('plugin.chat.images.deleteSelected'), cls: 'mod-warning', attr: { type: 'button' } });
            remove.disabled = busy;
            remove.onclick = async () => {
                if (busy || !selections.size) return;
                const chosen = [...selections.values()].map((asset) => ({ ref: { assetId: asset.id, contentHash: asset.originalHash }, path: asset.originalPath }));
                if (!await confirmChatAction({ app }, {
                    title: t('plugin.chat.images.deleteSelected'), message: `${t('plugin.chat.images.deleteConfirm')}\n${chosen.map((entry) => entry.path).join('\n')}`,
                    confirmText: t('plugin.chat.images.deleteSelected'), danger: true,
                }) || closed) return;
                busy = true; remove.disabled = true; clear.disabled = true;
                try {
                    await images.cleanupSelected(chosen);
                    busy = false;
                    if (!closed) await render();
                } catch (error) {
                    busy = false; remove.disabled = false; clear.disabled = false;
                    if (!closed) status.setText(String(error).includes('cleanup_path_unverifiable')
                        ? t('plugin.chat.images.cleanupUnavailable') : t('plugin.chat.images.cleanupChanged'));
                }
            };
        } catch {
            if (closed) return;
            status.setText(t('plugin.chat.images.operationFailed'));
            const retry = container.createEl('button', {
                text: t('plugin.chat.images.retry'),
                attr: { type: 'button' },
            });
            retry.onclick = () => {
                if (!closed) void render();
            };
        }
    };

    void render();
    return () => {
        closed = true;
        container.empty();
    };
}

export class ImageManagementModal extends Modal {
    private disposeContent: (() => void) | null = null;
    constructor(app: App, private readonly images: ImageAssetService) { super(app); }
    onOpen(): void {
        (this.titleEl as HTMLElement | undefined)?.setText(makePluginTranslator(getPluginUiLanguage())('plugin.chat.images.manage'));
        this.disposeContent = mountImageManagementContent(this.contentEl, this.app, this.images);
    }
    onClose(): void {
        this.disposeContent?.();
        this.disposeContent = null;
        this.contentEl.empty();
    }
}

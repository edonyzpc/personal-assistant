import { Modal, setIcon, type App } from "obsidian";
import type { ComposerImageEntry } from "./composer-draft";
import type { MessageImage } from "./image-types";
import type { ImageAssetService } from "./image-assets";
import { getPluginUiLanguage, makePluginTranslator } from "../locales/plugin";
import { VaultImagePickerModal } from './image-management-modal';

/** Composer entries stay separate from the larger, source-oriented history view. */
export function renderComposerImageAttachments(
    parent: HTMLElement,
    entries: readonly ComposerImageEntry<MessageImage>[],
    service: ImageAssetService | undefined,
    actions: { onPreview: (entry: ComposerImageEntry<MessageImage>) => void; onRemove: (id: number) => void },
): () => void {
    const t = makePluginTranslator(getPluginUiLanguage());
    const controller = new AbortController();
    const releases: Array<() => void> = [];
    const urlApi = parent.ownerDocument?.defaultView?.URL ?? URL;
    for (const entry of entries) {
        const item = parent.createDiv({ cls: 'pa-chat-image-draft__item', attr: { 'data-status': entry.status } });
        const previewButton = item.createEl('button', {
            cls: 'pa-chat-image-draft__preview',
            attr: { type: 'button', title: entry.label, 'aria-label': t('plugin.chat.images.preview', { name: entry.label }) },
        });
        const placeholder = previewButton.createSpan({ cls: 'pa-chat-image-draft__placeholder' });
        setIcon(placeholder, entry.status === 'error' ? 'image-off' : 'image');
        const preview = previewButton.createEl('img', { attr: { alt: entry.label } });
        preview.hidden = true;
        previewButton.disabled = !entry.value || !service;
        previewButton.onclick = () => { if (!controller.signal.aborted) actions.onPreview(entry); };
        const remove = item.createEl('button', {
            cls: 'pa-chat-image-draft__remove',
            attr: { type: 'button', 'aria-label': `${t('plugin.chat.images.remove')}: ${entry.label}` },
        });
        setIcon(remove, 'x');
        remove.onclick = () => { if (!controller.signal.aborted) actions.onRemove(entry.id); };
        const status = item.createDiv({
            cls: 'pa-chat-image-draft__status',
            attr: { role: 'status', 'aria-live': 'polite' },
        });
        if (entry.status === 'processing') status.textContent = t('plugin.chat.images.loading');
        if (entry.status === 'error') {
            status.textContent = `${entry.error ?? t('plugin.chat.images.failed')} ${t('plugin.chat.images.retryHint')}`;
        }
        if (!entry.value || !service) continue;
        // Each render owns only its preview. A removed entry cannot acquire a late lease.
        let releasePreview: (() => void) | undefined;
        releases.push(() => {
            releasePreview?.();
            releasePreview = undefined;
            preview.removeAttribute('src');
            preview.hidden = true;
        });
        void service.resolveVariant(entry.value.ref, 'preview', { signal: controller.signal }).then((lease) => {
            if (controller.signal.aborted) { lease.release(); return; }
            let url: string;
            try { url = urlApi.createObjectURL(lease.blob); }
            catch (error) { lease.release(); throw error; }
            releasePreview = () => { urlApi.revokeObjectURL(url); lease.release(); };
            preview.src = url;
            preview.hidden = false;
            placeholder.hidden = true;
        }).catch(() => {
            if (!controller.signal.aborted && entry.status === 'ready') {
                status.textContent = t('plugin.chat.images.previewUnavailable');
                item.setAttribute('data-preview-unavailable', 'true');
            }
        });
    }
    return () => {
        controller.abort();
        for (const release of releases) release();
    };
}

/** A view-local detail surface reuses existing original access and relocation. */
export class ImageAttachmentDetailModal extends Modal {
    private cleanup?: () => void;

    constructor(app: App, private readonly image: MessageImage, private readonly service: ImageAssetService,
        private readonly unverified: boolean) { super(app); }

    onOpen(): void {
        const t = makePluginTranslator(getPluginUiLanguage());
        this.contentEl.addClass('pa-chat-image-detail');
        this.contentEl.createEl('h2', { text: t('plugin.chat.images.details') });
        this.cleanup = renderImageAttachments(this.contentEl, [this.image], this.service, this.app, {
            onOriginalOpened: () => this.close(),
        });
        if (this.unverified) this.contentEl.createEl('p', { text: t('plugin.chat.images.unverified') });
        this.contentEl.createEl('p', { text: t('plugin.chat.images.openOriginal', { name: this.image.label }) });
    }

    onClose(): void {
        this.cleanup?.();
        this.cleanup = undefined;
        this.contentEl.empty();
    }
}

/** Each rendered row owns its own immutable preview leases and object URLs. */
export function renderImageAttachments(
    parent: HTMLElement,
    images: readonly MessageImage[],
    service: ImageAssetService,
    app: App,
    options?: { onOriginalOpened?: () => void },
): () => void {
    const t = makePluginTranslator(getPluginUiLanguage());
    const controller = new AbortController();
    const releases: Array<() => void> = [];
    const urlApi = parent.ownerDocument?.defaultView?.URL ?? URL;
    const group = parent.createDiv({ cls: "pa-chat-images" });
    for (const image of images) {
        const figure = group.createEl("figure", { cls: "pa-chat-image" });
        const button = figure.createEl("button", {
            cls: "pa-chat-image__preview",
            attr: { type: "button", "aria-label": t("plugin.chat.images.openOriginal", { name: image.label }) },
        });
        const preview = button.createEl("img", { attr: { alt: image.label } });
        preview.hidden = true;
        const label = figure.createEl("figcaption", { text: `${image.ordinal}. ${image.label}` });
        const status = figure.createDiv({ cls: "pa-chat-image__status", text: t("plugin.chat.images.loading") });
        const relocate = figure.createEl('button', { text: t('plugin.chat.images.relocate'), attr: { type: 'button' } });
        relocate.hidden = true;
        let attempt = 0;
        let releasePreview: (() => void) | undefined;
        const clearPreview = () => { releasePreview?.(); releasePreview = undefined; preview.removeAttribute('src'); preview.hidden = true; };
        releases.push(clearPreview);
        button.onclick = () => {
            void service.readOriginal(image.ref, 'preview').then(async ({ asset }) => {
                if (controller.signal.aborted) return;
                await app.workspace.openLinkText(asset.originalPath, "", false);
                if (!controller.signal.aborted) options?.onOriginalOpened?.();
            }).catch(() => { if (!controller.signal.aborted) { status.textContent = t("plugin.chat.images.originalMissing"); relocate.hidden = false; } });
        };
        const loadPreview = () => {
            const currentAttempt = ++attempt;
            clearPreview();
            void service.resolveVariant(image.ref, "preview", { signal: controller.signal }).then((lease) => {
                if (controller.signal.aborted || currentAttempt !== attempt) { lease.release(); return; }
                let url: string;
                try { url = urlApi.createObjectURL(lease.blob); }
                catch (error) { lease.release(); throw error; }
                releasePreview = () => { urlApi.revokeObjectURL(url); lease.release(); };
                preview.src = url;
                preview.hidden = false;
                status.textContent = ""; relocate.hidden = true;
                label.title = `${lease.width} × ${lease.height}`;
            }).catch((error) => {
                if (!controller.signal.aborted && currentAttempt === attempt) {
                    status.textContent = t("plugin.chat.images.previewUnavailable");
                    relocate.hidden = !/source_missing|source_changed|asset_missing/.test(String(error));
                }
            });
        };
        relocate.onclick = () => {
            new VaultImagePickerModal(app, (file) => {
                if (controller.signal.aborted) return;
                relocate.disabled = true;
                void service.relocate(image.ref, file.path).then(() => { if (!controller.signal.aborted) loadPreview(); })
                    .catch(() => { if (!controller.signal.aborted) status.textContent = t('plugin.chat.images.relocateMismatch'); })
                    .finally(() => { relocate.disabled = false; });
            }).open();
        };
        loadPreview();
    }
    return () => {
        controller.abort();
        for (const release of releases) release();
        group.remove();
    };
}

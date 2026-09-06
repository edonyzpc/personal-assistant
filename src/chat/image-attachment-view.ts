import type { App } from "obsidian";
import type { MessageImage } from "./image-types";
import type { ImageAssetService } from "./image-assets";
import { getPluginUiLanguage, makePluginTranslator } from "../locales/plugin";
import { VaultImagePickerModal } from './image-management-modal';

/** Each rendered row owns its own immutable preview leases and object URLs. */
export function renderImageAttachments(
    parent: HTMLElement,
    images: readonly MessageImage[],
    service: ImageAssetService,
    app: App,
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
            void service.readOriginal(image.ref, 'preview').then(({ asset }) => {
                if (controller.signal.aborted) return;
                return app.workspace.openLinkText(asset.originalPath, "", false);
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

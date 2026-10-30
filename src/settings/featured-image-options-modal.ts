import { Modal, type App } from 'obsidian';
import { getPluginUiLanguage, makePluginTranslator } from '../locales/plugin';
import { imageCountLimit, imageModelChoices, isImageModelSupported,
    type FeaturedImageDefaults } from '../ai-services/featured-image-options';
import type { ImageGenerationConnection } from '../ai-services/image-generation-connection';

type WritableFeaturedImageDefaults = {
    -readonly [K in keyof FeaturedImageDefaults]: FeaturedImageDefaults[K];
};
export type FeaturedImageDefaultsPatch = Partial<WritableFeaturedImageDefaults>;
export type FeaturedImageDefaultsField = keyof FeaturedImageDefaults;

export interface FeaturedImageOptionsModalHost {
    readonly mode: 'edit';
    readonly defaults: FeaturedImageDefaults;
    readonly connection?: Readonly<ImageGenerationConnection> | null;
    saveSourceImageModel?(model: string): Promise<void>;
    saveDefaults(defaults: FeaturedImageDefaultsPatch): Promise<void>;
}

export interface FeaturedImageOptionsEditorCallbacks {
    close(): void;
    cancel?(): void;
}

/** Mount the concrete default-options editor shared by Settings and the feature entry. */
export function mountFeaturedImageOptionsEditor(
    container: HTMLElement,
    host: FeaturedImageOptionsModalHost,
    callbacks: FeaturedImageOptionsEditorCallbacks,
    fields: readonly FeaturedImageDefaultsField[] = ['featuredImageModel', 'numFeaturedImages', 'featuredImagePath'],
): () => void {
    const t = makePluginTranslator(getPluginUiLanguage());
    let closed = false;
    let busy = false;
    const baseline: WritableFeaturedImageDefaults = { ...host.defaults };
    const show = (field: FeaturedImageDefaultsField) => fields.includes(field);
    const isOpen = () => !closed && container.isConnected !== false;
    const canEdit = () => isOpen() && !busy;

    container.empty();
    container.addClass('pa-featured-image-options');
    container.setAttribute('aria-busy', 'false');
    const fieldset = container.createEl('fieldset', { cls: 'pa-featured-image-options__fields' });
    fieldset.createEl('legend', { cls: 'pa-sr-only', text: t('plugin.settings.featuredImage.options.title') });

    let model: HTMLSelectElement | null = null;
    let count: HTMLSelectElement | null = null;
    let path: HTMLInputElement | null = null;
    if (show('featuredImageModel')) {
        const modelLabel = fieldset.createEl('label', { cls: 'pa-featured-image-options__field' });
        modelLabel.createSpan({ text: t('plugin.settings.featuredImage.model.name') });
        model = modelLabel.createEl('select', {
            attr: { 'aria-label': t('plugin.settings.featuredImage.model.name') },
        });
        const choices = [...new Set([...imageModelChoices(host.connection), host.defaults.featuredImageModel])];
        for (const value of choices) {
            const text = value === 'wan2.7-image' ? t('plugin.settings.featuredImage.model.balanced')
                : value === 'wan2.7-image-pro' ? t('plugin.settings.featuredImage.model.quality') : value;
            model.createEl('option', { text, attr: { value } });
        }
        model.value = host.defaults.featuredImageModel;
        fieldset.createEl('p', {
            cls: 'pa-featured-image-options__hint',
            text: t(host.connection?.adapter === 'openai-image'
                ? 'plugin.settings.featuredImage.model.connectionDesc' : 'plugin.settings.featuredImage.model.desc'),
        });
    }
    if (show('numFeaturedImages')) {
        const countLabel = fieldset.createEl('label', { cls: 'pa-featured-image-options__field' });
        countLabel.createSpan({ text: t('plugin.settings.featuredImage.count.name') });
        count = countLabel.createEl('select', {
            attr: { 'aria-label': t('plugin.settings.featuredImage.count.name') },
        });
        const counts = [...new Set([...Array.from({ length: imageCountLimit(host.connection) }, (_, index) => index + 1),
            host.defaults.numFeaturedImages])];
        for (const value of counts) {
            count.createEl('option', { text: String(value), attr: { value: String(value) } });
        }
        count.value = String(host.defaults.numFeaturedImages);
        fieldset.createEl('p', {
            cls: 'pa-featured-image-options__hint',
            text: t('plugin.settings.featuredImage.count.desc'),
        });
    }
    if (show('featuredImagePath')) {
        const details = fieldset.createEl('details', { cls: 'pa-featured-image-options__details' });
        details.createEl('summary', { text: t('plugin.settings.featuredImage.path.name') });
        const pathLabel = details.createEl('label', { cls: 'pa-featured-image-options__field' });
        pathLabel.createSpan({ text: t('plugin.settings.featuredImage.path.name') });
        path = pathLabel.createEl('input', {
            attr: { type: 'text', 'aria-label': t('plugin.settings.featuredImage.path.name') },
        });
        path.value = host.defaults.featuredImagePath;
        details.createEl('p', {
            cls: 'pa-featured-image-options__hint',
            text: t('plugin.settings.featuredImage.path.desc'),
        });
    }

    const status = container.createEl('p', {
        cls: 'pa-featured-image-options__status',
        attr: { role: 'status', 'aria-live': 'polite' },
    });
    const actions = container.createDiv({ cls: 'pa-featured-image-options__actions' });
    const cancel = actions.createEl('button', {
        text: t('plugin.settings.featuredImage.options.cancel'),
        attr: { type: 'button' },
    });
    cancel.onclick = () => {
        if (isOpen()) callbacks.cancel?.();
    };
    const save = actions.createEl('button', {
        cls: 'mod-cta',
        attr: { type: 'button' },
        text: t('plugin.settings.featuredImage.options.save'),
    });
    save.onclick = async () => {
        if (!canEdit()) return;
        const patch: FeaturedImageDefaultsPatch = {};
        if (model && model.value !== baseline.featuredImageModel) {
            if (!isImageModelSupported(model.value, host.connection)) {
                status.setText(t('plugin.chat.createImage.invalidModel'));
                model.focus();
                return;
            }
            patch.featuredImageModel = model.value;
        }
        if (count && Number(count.value) !== baseline.numFeaturedImages) {
            const value = Number(count.value);
            if (!Number.isSafeInteger(value) || value < 1 || value > imageCountLimit(host.connection)) {
                status.setText(t('plugin.chat.createImage.invalidCount', { maximum: imageCountLimit(host.connection) }));
                count.focus();
                return;
            }
            patch.numFeaturedImages = value;
        }
        if (path && path.value !== baseline.featuredImagePath) {
            patch.featuredImagePath = path.value;
        }
        if (Object.keys(patch).length === 0) {
            callbacks.close();
            return;
        }
        busy = true;
        fieldset.disabled = true;
        save.disabled = true;
        container.setAttribute('aria-busy', 'true');
        status.setText(t('plugin.settings.featuredImage.options.saving'));
        let partialSuccess = false;
        try {
            if (patch.featuredImageModel !== undefined && host.connection?.connectionId) {
                if (!host.saveSourceImageModel) throw new Error('Image connection model editing is unavailable.');
                await host.saveSourceImageModel(patch.featuredImageModel);
                baseline.featuredImageModel = patch.featuredImageModel;
                partialSuccess = true;
                delete patch.featuredImageModel;
            }
            if (Object.keys(patch).length) {
                await host.saveDefaults(patch);
                Object.assign(baseline, patch);
            }
            if (isOpen()) callbacks.close();
        } catch {
            if (isOpen()) status.setText(t(partialSuccess
                ? 'plugin.settings.featuredImage.options.partiallySaved' : 'plugin.settings.featuredImage.options.saveFailed'));
        } finally {
            if (isOpen()) {
                busy = false;
                fieldset.disabled = false;
                save.disabled = false;
                container.setAttribute('aria-busy', 'false');
            }
        }
    };

    return () => {
        closed = true;
        container.empty();
    };
}

/** Edit stored defaults; request-specific choices now belong to the Chat draft. */
export class FeaturedImageOptionsModal extends Modal {
    private disposeEditor: (() => void) | null = null;

    constructor(app: App, private readonly host: FeaturedImageOptionsModalHost) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.addClass('pa-featured-image-options');
        this.titleEl.setText(makePluginTranslator(getPluginUiLanguage())('plugin.settings.featuredImage.options.title'));
        this.disposeEditor = mountFeaturedImageOptionsEditor(this.contentEl, this.host, {
            close: () => this.close(),
            cancel: () => this.close(),
        });
    }

    onClose(): void {
        this.disposeEditor?.();
        this.disposeEditor = null;
        this.contentEl.empty();
    }
}

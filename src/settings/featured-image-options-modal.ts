import { Modal, type App } from 'obsidian';
import { normalizeFeaturedImageCount, normalizeFeaturedImageModel } from '../settings';
import { getPluginUiLanguage, makePluginTranslator } from '../locales/plugin';
import type { FeaturedImageDefaults } from '../ai-services/featured-image-options';

type WritableFeaturedImageDefaults = {
    -readonly [K in keyof FeaturedImageDefaults]: FeaturedImageDefaults[K];
};
export type FeaturedImageDefaultsPatch = Partial<WritableFeaturedImageDefaults>;
export type FeaturedImageDefaultsField = keyof FeaturedImageDefaults;

export interface FeaturedImageOptionsModalHost {
    readonly mode: 'edit';
    readonly defaults: FeaturedImageDefaults;
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
        for (const [value, key] of [
            ['wan2.7-image', 'plugin.settings.featuredImage.model.balanced'],
            ['wan2.7-image-pro', 'plugin.settings.featuredImage.model.quality'],
        ] as const) model.createEl('option', { text: t(key), attr: { value } });
        model.value = normalizeFeaturedImageModel(host.defaults.featuredImageModel);
        fieldset.createEl('p', {
            cls: 'pa-featured-image-options__hint',
            text: t('plugin.settings.featuredImage.model.desc'),
        });
    }
    if (show('numFeaturedImages')) {
        const countLabel = fieldset.createEl('label', { cls: 'pa-featured-image-options__field' });
        countLabel.createSpan({ text: t('plugin.settings.featuredImage.count.name') });
        count = countLabel.createEl('select', {
            attr: { 'aria-label': t('plugin.settings.featuredImage.count.name') },
        });
        for (const value of [1, 2, 3, 4]) {
            count.createEl('option', { text: String(value), attr: { value: String(value) } });
        }
        count.value = String(normalizeFeaturedImageCount(host.defaults.numFeaturedImages));
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
        if (model && normalizeFeaturedImageModel(model.value) !== baseline.featuredImageModel) {
            patch.featuredImageModel = normalizeFeaturedImageModel(model.value);
        }
        if (count && normalizeFeaturedImageCount(count.value) !== baseline.numFeaturedImages) {
            patch.numFeaturedImages = normalizeFeaturedImageCount(count.value);
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
        try {
            await host.saveDefaults(patch);
            Object.assign(baseline, patch);
            if (isOpen()) callbacks.close();
        } catch {
            if (isOpen()) status.setText(t('plugin.settings.featuredImage.options.saveFailed'));
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

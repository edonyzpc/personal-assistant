import { Modal, Notice, type App } from 'obsidian';
import { normalizeFeaturedImageCount, normalizeFeaturedImageModel } from '../settings';
import { getPluginUiLanguage, makePluginTranslator } from '../locales/plugin';
import {
    freezeFeaturedImageRunOptions,
    type FeaturedImageDefaults,
    type FeaturedImageRunAdmission,
    type FeaturedImageRunOptions,
} from '../ai-services/featured-image-options';

export type FeaturedImageOptionsModalHost = {
    readonly defaults: FeaturedImageDefaults;
    saveDefaults(defaults: FeaturedImageDefaults): Promise<void>;
} & ({
    readonly mode: 'edit';
} | {
    readonly mode: 'generate';
    readonly sourceName: string;
    prepareRun(): FeaturedImageRunAdmission | null;
    generate(options: FeaturedImageRunOptions): Promise<void>;
});

/** One local draft surface shared by Settings and the existing image command. */
export class FeaturedImageOptionsModal extends Modal {
    private closed = true;
    private busy = false;
    private renderEpoch = 0;

    constructor(app: App, private readonly host: FeaturedImageOptionsModalHost) {
        super(app);
    }

    onOpen(): void {
        this.closed = false;
        const epoch = ++this.renderEpoch;
        const t = makePluginTranslator(getPluginUiLanguage());
        const host = this.host;
        this.contentEl.empty();
        this.contentEl.addClass('pa-featured-image-options');
        this.titleEl.setText(t('plugin.settings.featuredImage.options.title'));
        if (host.mode === 'generate') {
            this.contentEl.createEl('p', { cls: 'pa-featured-image-options__source',
                text: t('plugin.settings.featuredImage.options.source', { name: host.sourceName }) });
        }

        const fields = this.contentEl.createEl('fieldset', { cls: 'pa-featured-image-options__fields' });
        fields.createEl('legend', { cls: 'pa-sr-only', text: t('plugin.settings.featuredImage.options.title') });
        const modelLabel = fields.createEl('label', { cls: 'pa-featured-image-options__field' });
        modelLabel.createSpan({ text: t('plugin.settings.featuredImage.model.name') });
        const model = modelLabel.createEl('select', { attr: { 'aria-label': t('plugin.settings.featuredImage.model.name') } });
        for (const [value, key] of [
            ['wan2.7-image', 'plugin.settings.featuredImage.model.balanced'],
            ['wan2.7-image-pro', 'plugin.settings.featuredImage.model.quality'],
        ] as const) {
            model.createEl('option', { text: t(key), attr: { value } });
        }
        model.value = normalizeFeaturedImageModel(host.defaults.featuredImageModel);
        fields.createEl('p', { cls: 'pa-featured-image-options__hint', text: t('plugin.settings.featuredImage.model.desc') });

        const countLabel = fields.createEl('label', { cls: 'pa-featured-image-options__field' });
        countLabel.createSpan({ text: t('plugin.settings.featuredImage.count.name') });
        const count = countLabel.createEl('select', { attr: { 'aria-label': t('plugin.settings.featuredImage.count.name') } });
        for (const value of [1, 2, 3, 4]) count.createEl('option', { text: String(value), attr: { value: String(value) } });
        count.value = String(normalizeFeaturedImageCount(host.defaults.numFeaturedImages));
        fields.createEl('p', { cls: 'pa-featured-image-options__hint', text: t('plugin.settings.featuredImage.count.desc') });

        const details = fields.createEl('details', { cls: 'pa-featured-image-options__details' });
        details.createEl('summary', { text: t('plugin.settings.featuredImage.path.name') });
        const pathLabel = details.createEl('label', { cls: 'pa-featured-image-options__field' });
        pathLabel.createSpan({ text: t('plugin.settings.featuredImage.path.name') });
        const path = pathLabel.createEl('input', { attr: { type: 'text', 'aria-label': t('plugin.settings.featuredImage.path.name') } });
        path.value = host.defaults.featuredImagePath;
        details.createEl('p', { cls: 'pa-featured-image-options__hint', text: t('plugin.settings.featuredImage.path.desc') });

        const status = this.contentEl.createEl('p', { cls: 'pa-featured-image-options__status', attr: { role: 'status', 'aria-live': 'polite' } });
        const actions = this.contentEl.createDiv({ cls: 'pa-featured-image-options__actions' });
        const cancel = actions.createEl('button', { text: t('plugin.settings.featuredImage.options.cancel'), attr: { type: 'button' } });
        cancel.onclick = () => this.close();
        const submit = actions.createEl('button', { cls: 'mod-cta', attr: { type: 'button' },
            text: t(host.mode === 'generate' ? 'plugin.settings.featuredImage.options.generate' : 'plugin.settings.featuredImage.options.save') });
        submit.onclick = async () => {
            if (this.closed || this.busy || epoch !== this.renderEpoch) return;
            const defaults: FeaturedImageDefaults = Object.freeze({
                featuredImageModel: normalizeFeaturedImageModel(model.value),
                numFeaturedImages: normalizeFeaturedImageCount(count.value),
                featuredImagePath: path.value,
            });
            const admission = host.mode === 'generate' ? host.prepareRun() : null;
            if (host.mode === 'generate' && (!admission || !admission.isCurrent())) {
                status.setText(t('plugin.settings.featuredImage.options.changed'));
                return;
            }
            this.busy = true;
            fields.disabled = true;
            submit.disabled = true;
            this.contentEl.setAttribute('aria-busy', 'true');
            status.setText(t('plugin.settings.featuredImage.options.saving'));
            try {
                await host.saveDefaults(defaults);
            } catch {
                if (!this.closed && epoch === this.renderEpoch) {
                    status.setText(t('plugin.settings.featuredImage.options.saveFailed'));
                }
                return;
            } finally {
                this.busy = false;
                if (!this.closed && epoch === this.renderEpoch) {
                    fields.disabled = false;
                    submit.disabled = false;
                    this.contentEl.setAttribute('aria-busy', 'false');
                }
            }
            if (this.closed || epoch !== this.renderEpoch) return;
            if (host.mode === 'generate' && admission) {
                if (!admission.isCurrent()) {
                    status.setText(t('plugin.settings.featuredImage.options.savedChanged'));
                    return;
                }
                const options = freezeFeaturedImageRunOptions({ ...defaults, ...admission });
                this.close();
                try { await host.generate(options); }
                catch { new Notice(t('plugin.ai.notice.featuredFailed'), 5000); }
            } else {
                this.close();
            }
        };
        model.focus();
    }

    onClose(): void {
        this.closed = true;
        this.renderEpoch++;
        this.contentEl.empty();
    }
}

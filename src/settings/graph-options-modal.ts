import { Modal, Notice, type App } from 'obsidian';
import type { PluginManagerSettings } from '../settings';
import { getPluginUiLanguage, makePluginTranslator } from '../locales/plugin';

export type GraphOptions = Pick<PluginManagerSettings, 'localGraph' | 'enableGraphColors' | 'colorGroups'>;

export interface GraphOptionsHost {
    readOptions(): GraphOptions;
    saveOptions(options: GraphOptions): Promise<void>;
    applyOptions(): Promise<void>;
}

const DEFAULT_COLOR_GROUP: GraphOptions['colorGroups'][number] = {
    query: 'path:/',
    color: { a: 1, rgb: 6617700 },
};

function copyOptions(options: GraphOptions): GraphOptions {
    return JSON.parse(JSON.stringify(options)) as GraphOptions;
}

function editedInteger(value: string, fallback: number, max: number): number {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

function colorHex(rgb: number): string {
    return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** A local draft shared by the graph command and Settings. */
export class GraphOptionsModal extends Modal {
    private closed = true;
    private busy = false;
    private renderEpoch = 0;

    constructor(app: App, private readonly host: GraphOptionsHost) {
        super(app);
    }

    onOpen(): void {
        this.closed = false;
        this.busy = false;
        const epoch = ++this.renderEpoch;
        const t = makePluginTranslator(getPluginUiLanguage());
        const draft = copyOptions(this.host.readOptions());
        const isOpen = () => !this.closed && epoch === this.renderEpoch;
        const canEdit = () => isOpen() && !this.busy;
        this.contentEl.empty();
        this.contentEl.addClass('pa-graph-options');
        this.contentEl.setAttribute('aria-busy', 'false');
        this.titleEl.setText(t('plugin.settings.graph.options.title'));
        const fields = this.contentEl.createEl('fieldset', { cls: 'pa-graph-options__fields' });
        fields.createEl('legend', { cls: 'pa-sr-only', text: t('plugin.settings.graph.options.title') });

        const input = (parent: HTMLElement, name: string, type: string, value: string) => {
            const label = parent.createEl('label', { cls: 'pa-graph-options__field' });
            label.createSpan({ text: name });
            const control = label.createEl('input', { attr: { type, 'aria-label': name } });
            control.value = value;
            return control;
        };
        const toggle = (parent: HTMLElement, name: string, value: boolean, change: (value: boolean) => void) => {
            const label = parent.createEl('label', { cls: 'pa-graph-options__toggle' });
            const control = label.createEl('input', { attr: { type: 'checkbox', 'aria-label': name } });
            control.checked = value;
            label.createSpan({ text: name });
            control.onchange = () => { if (canEdit()) change(control.checked); };
        };
        const depth = input(fields, t('plugin.settings.graph.depth.name'), 'text', String(draft.localGraph.depth));
        depth.setAttribute('inputmode', 'numeric');
        depth.oninput = () => {
            if (canEdit()) draft.localGraph.depth = editedInteger(depth.value, draft.localGraph.depth, 6);
        };
        for (const [key, name] of [
            ['showTags', 'plugin.settings.graph.showTags.name'],
            ['showAttach', 'plugin.settings.graph.showAttachment.name'],
            ['showNeighbor', 'plugin.settings.graph.showNeighbor.name'],
            ['collapse', 'plugin.settings.graph.collapse.name'],
        ] as const) {
            toggle(fields, t(name), draft.localGraph[key], (value) => { draft.localGraph[key] = value; });
        }

        const colors = fields.createEl('details', { cls: 'pa-graph-options__details' });
        colors.createEl('summary', { text: t('plugin.settings.graphColors.title') });
        const enabled = colors.createDiv();
        const rules = colors.createDiv({ cls: 'pa-graph-options__colors' });
        const renderRules = () => {
            rules.empty();
            rules.hidden = !draft.enableGraphColors;
            draft.colorGroups.forEach((group, index) => {
                const row = rules.createDiv({ cls: 'pa-graph-options__rule' });
                const query = input(row, t('plugin.settings.graph.options.query', { number: index + 1 }), 'text', group.query);
                query.oninput = () => {
                    if (canEdit() && draft.colorGroups[index] === group) group.query = query.value;
                };
                const color = input(row, t('plugin.settings.graph.options.color', { number: index + 1 }), 'color', colorHex(group.color.rgb));
                color.oninput = () => {
                    const hex = color.value.match(/^#([0-9a-fA-F]{6})$/)?.[1];
                    if (canEdit() && draft.colorGroups[index] === group && hex) {
                        group.color.rgb = parseInt(hex, 16);
                    }
                };
                const remove = row.createEl('button', { text: t('plugin.settings.graphColors.remove'),
                    attr: { type: 'button', 'aria-label': t('plugin.settings.graph.options.removeRule', { number: index + 1 }) } });
                remove.onclick = () => {
                    if (!canEdit() || draft.colorGroups[index] !== group) return;
                    draft.colorGroups.splice(index, 1);
                    renderRules();
                };
                const reset = row.createEl('button', { text: t('plugin.settings.graphColors.reset'),
                    attr: { type: 'button', 'aria-label': t('plugin.settings.graph.options.resetRule', { number: index + 1 }) } });
                reset.onclick = () => {
                    if (!canEdit() || draft.colorGroups[index] !== group) return;
                    draft.colorGroups[index] = { ...DEFAULT_COLOR_GROUP, color: { ...DEFAULT_COLOR_GROUP.color } };
                    renderRules();
                };
            });
            const add = rules.createEl('button', { text: t('plugin.settings.graphColors.add'), attr: { type: 'button' } });
            add.onclick = () => {
                if (!canEdit()) return;
                draft.colorGroups.push({ ...DEFAULT_COLOR_GROUP, color: { ...DEFAULT_COLOR_GROUP.color } });
                renderRules();
            };
        };
        toggle(enabled, t('plugin.settings.graphColors.enabled.name'), draft.enableGraphColors, (value) => {
            draft.enableGraphColors = value;
            rules.hidden = !value;
        });
        renderRules();

        const opening = fields.createEl('details', { cls: 'pa-graph-options__details' });
        opening.createEl('summary', { text: t('plugin.settings.graph.options.nextOpen') });
        opening.createEl('p', { text: t('plugin.settings.graph.options.nextOpenDesc'), cls: 'pa-graph-options__hint' });
        const typeLabel = opening.createEl('label', { cls: 'pa-graph-options__field' });
        typeLabel.createSpan({ text: t('plugin.settings.graph.options.openAs') });
        const type = typeLabel.createEl('select', { attr: { 'aria-label': t('plugin.settings.graph.options.openAs') } });
        type.createEl('option', { text: t('plugin.settings.graph.options.popover'), attr: { value: 'popover' } });
        // Existing non-popover values all use a normal tab; preserve their saved spelling.
        const tabValue = draft.localGraph.type === 'popover' ? 'tab' : draft.localGraph.type;
        type.createEl('option', { text: t('plugin.settings.graph.options.tab'), attr: { value: tabValue } });
        type.value = draft.localGraph.type;
        type.onchange = () => { if (canEdit()) draft.localGraph.type = type.value; };
        for (const dimension of ['width', 'height'] as const) {
            const control = input(opening, t(`plugin.settings.graph.${dimension}`), 'text', String(draft.localGraph.resizeStyle[dimension]));
            control.setAttribute('inputmode', 'numeric');
            control.oninput = () => {
                if (canEdit()) {
                    draft.localGraph.resizeStyle[dimension] = editedInteger(control.value, draft.localGraph.resizeStyle[dimension], 2000);
                }
            };
        }
        toggle(opening, t('plugin.settings.graph.autoColors.name'), draft.localGraph.autoColors,
            (value) => { draft.localGraph.autoColors = value; });

        const status = this.contentEl.createEl('p', { cls: 'pa-graph-options__status', attr: { role: 'status', 'aria-live': 'polite' } });
        const actions = this.contentEl.createDiv({ cls: 'pa-graph-options__actions' });
        const cancel = actions.createEl('button', { text: t('plugin.settings.graph.options.cancel'), attr: { type: 'button' } });
        cancel.onclick = () => this.close();
        const save = actions.createEl('button', { text: t('plugin.settings.graph.options.save'), cls: 'mod-cta', attr: { type: 'button' } });
        save.onclick = async () => {
            if (!canEdit()) return;
            this.busy = true;
            fields.disabled = true;
            save.disabled = true;
            this.contentEl.setAttribute('aria-busy', 'true');
            status.setText(t('plugin.settings.graph.options.saving'));
            try {
                try {
                    await this.host.saveOptions(copyOptions(draft));
                } catch {
                    if (isOpen()) status.setText(t('plugin.settings.graph.options.saveFailed'));
                    return;
                }
                try {
                    await this.host.applyOptions();
                } catch {
                    const message = t('plugin.settings.graph.options.applyFailed');
                    if (isOpen()) status.setText(message);
                    else new Notice(message, 5000);
                    return;
                }
                if (isOpen()) this.close();
            } finally {
                if (isOpen()) {
                    this.busy = false;
                    fields.disabled = false;
                    save.disabled = false;
                    this.contentEl.setAttribute('aria-busy', 'false');
                }
            }
        };
        depth.focus();
    }

    onClose(): void {
        this.closed = true;
        this.renderEpoch++;
        this.contentEl.empty();
    }
}

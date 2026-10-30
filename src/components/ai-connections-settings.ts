import { Setting, type App } from 'obsidian';
import type { PluginAIConfiguration, AIConnectionInput, AIConnectionDeletion, AIConnectionPatch } from '../ai-services/plugin-configuration';
import type { AIConnection, AIPurpose, ResolvedAIConnection } from '../ai-services/ai-connection-types';
import { createConnectionDefaults, getProviderDefinition, getProviderDefinitions } from '../ai-services/provider-definitions';
import { isHttpEndpoint, resolveAIConnection } from '../ai-services/ai-connection-resolver';
import { confirmUserAction } from '../confirm';
import type { PluginTranslator } from '../locales/plugin';
import type { MemoryMaintenancePlan } from '../memory-manager';

const PURPOSES: AIPurpose[] = ['chat', 'embedding', 'image'];

interface ConnectionEditorDraft {
    draft: AIConnectionInput;
    baseline?: AIConnection;
    creation?: Promise<AIConnection>;
    created?: AIConnection;
}

export interface AIConnectionsSettingsOptions {
    app: App;
    configuration: PluginAIConfiguration;
    translate: PluginTranslator;
    isInitialSetup: boolean;
    legacyCredentials(): Array<{ id: string; label: string }>;
    getMemoryPlan?(): Promise<MemoryMaintenancePlan>;
    previewMemory?(connection: ResolvedAIConnection): Promise<'existing' | 'unprepared' | 'unknown'>;
    getConnectionTaskCount?(connectionId: string): Promise<number | undefined>;
    isMemoryEnabled?(): boolean;
    isMemoryActive?(): boolean;
    memoryAction?(action: 'prepare' | 'update' | 'details'): Promise<void> | void;
    onCommitted?(): void;
}

/** A native Settings detail, sharing the configuration owner with inline Chat setup. */
export class AIConnectionsSettingsView {
    private version = 0;
    private adjusting = false;
    private clearSecretDraft: (() => void) | undefined;
    private busyVersion: number | undefined;
    private refreshOverviewMemory: (() => void) | undefined;
    private readonly editorDrafts = new Map<string, ConnectionEditorDraft>();

    constructor(private readonly root: HTMLElement, private readonly options: AIConnectionsSettingsOptions) {}

    private text(key: string, params?: Record<string, string | number>): string {
        return this.options.translate(`plugin.settings.connections.${key}`, params);
    }

    private page(title: string, back?: () => void): number {
        const hadFocus = this.root.contains(this.root.ownerDocument.activeElement);
        this.clearSecretDraft?.();
        this.clearSecretDraft = undefined;
        this.refreshOverviewMemory = undefined;
        this.root.empty();
        const version = ++this.version;
        if (back) this.button(this.text('back'), back);
        const heading = this.root.createEl('h3', { text: title, attr: { tabindex: '-1' } });
        if (hadFocus) {
            heading.focus({ preventScroll: true });
            this.root.scrollIntoView?.({ behavior: 'auto', block: 'start' });
        }
        return version;
    }

    /** Refresh only the overview's Memory region; detail drafts and focus stay untouched. */
    refreshOverview(): void {
        if (this.root.isConnected) this.refreshOverviewMemory?.();
    }

    private button(label: string, action: () => void | Promise<void>, primary = false): void {
        const row = new Setting(this.root);
        row.settingEl.addClass('pa-ai-connections-action');
        row.addButton(button => {
            button.setButtonText(label);
            if (primary) button.setCta();
            button.onClick(action);
        });
    }

    private focusPurpose(purpose: AIPurpose | 'default', action = 'change'): void {
        const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('button'));
        const target = buttons.find(button => button.dataset.paPurpose === purpose && button.dataset.paAction === action)
            ?? buttons.find(button => button.dataset.paPurpose === purpose)
            ?? buttons.find(button => button.textContent === this.text('adjust'));
        target?.focus();
    }

    private commit(label: string, operation: () => Promise<unknown>, after = () => this.render(), validate?: () => boolean): void {
        const version = this.version;
        const status = this.root.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
        new Setting(this.root).addButton(button => button.setButtonText(label).setCta().onClick(async () => {
            if (this.busyVersion === version) return;
            if (validate && !validate()) return;
            this.busyVersion = version;
            const controls = Array.from(this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'));
            const disabled = controls.map(control => control.disabled);
            controls.forEach(control => { control.disabled = true; });
            button.setDisabled(true);
            status.setText(this.text('saving'));
            try {
                await operation();
                if (this.root.isConnected) this.options.onCommitted?.();
                if (version === this.version && this.root.isConnected) after();
            } catch {
                if (version !== this.version || !this.root.isConnected) return;
                status.setAttribute('role', 'alert');
                status.setText(this.text('saveFailed'));
                controls.forEach((control, index) => { control.disabled = disabled[index]; });
                button.setDisabled(false);
                status.tabIndex = -1;
                status.focus();
            } finally {
                if (this.busyVersion === version) this.busyVersion = undefined;
            }
        }));
    }

    render(): void {
        const config = this.options.configuration;
        const settings = config.getAIConnections();
        const version = this.page(this.text('title'));
        if (settings === undefined) {
            this.root.createEl('p', { text: this.text('intro') });
            if (this.options.isInitialSetup) this.button(this.text('addDefault'), () => this.editor(undefined, 'default'), true);
            else this.button(this.text('migrate'), () => this.migration(), true);
            return;
        }
        if (!settings || settings.schemaVersion !== 1 || !Array.isArray(settings.connections) || !settings.bindings) {
            this.root.createEl('p', { text: this.text('invalid'), attr: { role: 'alert' } });
            return;
        }
        const defaultConnection = settings.connections.find(item => item.id === settings.defaultConnectionId);
        new Setting(this.root).setName(this.text('default')).setDesc(defaultConnection?.name ?? this.text('unconfigured'))
            .addButton(button => {
                button.buttonEl.dataset.paPurpose = 'default';
                button.buttonEl.dataset.paAction = 'change';
                button.buttonEl.setAttribute('aria-label', this.text('changePurpose', { purpose: this.text('default') }));
                button.setButtonText(this.text('change')).onClick(() => this.selection('default'));
            });
        for (const purpose of PURPOSES) {
            const resolution = config.resolveAIConnection(purpose);
            const binding = settings.bindings[purpose];
            const summary = resolution.ok ? `${resolution.connection.name} · ${resolution.connection.model}`
                : this.text(`issue.${resolution.issue}`);
            const row = new Setting(this.root).setName(this.text(purpose))
                .setDesc(`${summary} · ${this.text(binding.mode === 'inherit' ? 'inherit'
                    : binding.mode === 'unconfigured' ? 'unconfigured' : 'separate')}`);
            if (this.adjusting) row.addButton(button => {
                button.buttonEl.dataset.paPurpose = purpose;
                button.buttonEl.dataset.paAction = 'change';
                button.buttonEl.setAttribute('aria-label', this.text('changePurpose', { purpose: this.text(purpose) }));
                button.setButtonText(this.text('change')).onClick(() => this.selection(purpose));
            });
            if (binding.mode !== 'inherit') row.addButton(button => {
                button.buttonEl.dataset.paPurpose = purpose;
                button.buttonEl.dataset.paAction = 'restore';
                button.buttonEl.setAttribute('aria-label', this.text('restorePurpose', { purpose: this.text(purpose) }));
                button.setButtonText(this.text('restore'))
                    .setTooltip(this.text('restorePurpose', { purpose: this.text(purpose) }))
                    .onClick(() => this.selection(purpose, 'inherit', 'restore'));
            });
            if (purpose === 'embedding' && resolution.ok && this.options.getMemoryPlan) {
                const memory = this.root.createDiv();
                let refresh = 0;
                this.refreshOverviewMemory = () => {
                    const currentRefresh = ++refresh;
                    memory.empty();
                    if (this.options.isMemoryEnabled?.() === false) return;
                    const status = memory.createEl('p', { text: this.text('checking'), cls: 'pa-settings-section-desc' });
                    void this.options.getMemoryPlan!().then(plan => {
                        if (version !== this.version || currentRefresh !== refresh || !this.root.isConnected) return;
                        status.setText(this.text(this.options.isMemoryActive?.() ? 'memoryActive'
                            : plan.reason === 'unavailable' ? 'memoryRecovery'
                                : plan.reason === 'ready' ? 'memoryReady'
                                    : plan.action === 'refresh' || plan.action === 'rebuild-lexical' ? 'memoryPending' : 'memoryNeedsPrepare'));
                        this.renderMemoryAction(plan, status);
                    }).catch(() => {
                        if (version === this.version && currentRefresh === refresh && this.root.isConnected) status.setText(this.text('memoryRecovery'));
                    });
                };
                this.refreshOverviewMemory();
            }
        }
        this.button(this.text('adjust'), () => { this.adjusting = !this.adjusting; this.render(); });
        this.button(this.text('manage'), () => this.manage());
    }

    private renderMemoryAction(plan: MemoryMaintenancePlan, after: HTMLElement): void {
        if (!this.options.memoryAction || (plan.reason === 'ready' && !this.options.isMemoryActive?.())) return;
        const action = this.options.isMemoryActive?.() ? 'details'
            : plan.action === 'refresh' ? 'update' : plan.action === 'rebuild' ? 'prepare' : 'details';
        const version = this.version;
        const button = after.createEl('button', { text: this.text(`memory.${action}`), attr: { type: 'button' } });
        button.addEventListener('click', () => {
            button.disabled = true;
            void Promise.resolve(this.options.memoryAction?.(action)).then(() => {
                if (version === this.version && this.root.isConnected) this.render();
            }).catch(() => {
                if (version === this.version && this.root.isConnected) {
                    after.setText(this.text('memoryRecovery'));
                    button.disabled = false;
                }
            });
        });
    }

    private selection(purpose: AIPurpose | 'default', initial?: string, returnAction = 'change'): void {
        const config = this.options.configuration;
        const settings = config.getAIConnections();
        if (!settings) return this.render();
        const binding = purpose === 'default' ? undefined : settings.bindings[purpose];
        let selected = initial ?? (purpose === 'default' ? settings.defaultConnectionId ?? ''
            : binding?.mode === 'connection' ? binding.connectionId : binding?.mode === 'inherit' ? 'inherit' : '');
        const returnToOverview = () => { this.render(); this.focusPurpose(purpose, returnAction); };
        this.page(this.text(purpose === 'default' ? 'changeDefault' : purpose), returnToOverview);
        const preview = this.root.createDiv({ cls: 'pa-settings-connection-preview', attr: { 'aria-live': 'polite' } });
        const version = this.version;
        let previewVersion = 0;
        const updatePreview = () => {
            const currentPreview = ++previewVersion;
            preview.empty();
            const draft = JSON.parse(JSON.stringify(settings)) as typeof settings;
            if (purpose === 'default') draft.defaultConnectionId = selected || null;
            else draft.bindings[purpose] = selected === 'inherit' ? { mode: 'inherit' }
                : selected ? { mode: 'connection', connectionId: selected } : { mode: 'unconfigured' };
            for (const item of PURPOSES) {
                const target = resolveAIConnection(draft, item);
                const previous = resolveAIConnection(settings, item);
                const value = target.ok ? `${target.connection.name} · ${target.connection.model}`
                    : this.text(`issue.${target.issue}`);
                const unchanged = previous.ok && target.ok && previous.connection.connectionId === target.connection.connectionId
                    && previous.connection.model === target.connection.model;
                preview.createEl('p', { text: `${this.text(item)}: ${value}${unchanged ? ` · ${this.text('unchanged')}` : ''}` });
            }
            const memory = preview.createEl('p', { text: this.text('switchMemory') });
            const nextMemory = resolveAIConnection(draft, 'embedding');
            const currentMemory = resolveAIConnection(settings, 'embedding');
            if (nextMemory.ok && (!currentMemory.ok
                || currentMemory.connection.connectionId !== nextMemory.connection.connectionId
                || currentMemory.connection.model !== nextMemory.connection.model) && this.options.previewMemory) {
                void this.options.previewMemory(nextMemory.connection).then(state => {
                    if (version !== this.version || currentPreview !== previewVersion || !this.root.isConnected) return;
                    memory.setText(this.text(`preview.${state}`));
                }).catch(() => { /* Existing neutral preview accurately leaves recovery to activation. */ });
            }
        };
        new Setting(this.root).setName(this.text('use')).addDropdown(dropdown => {
            if (purpose !== 'default') dropdown.addOption('inherit', this.text('inherit'));
            if (!selected) dropdown.addOption('', this.text('unconfigured'));
            for (const connection of settings.connections) dropdown.addOption(connection.id, connection.name);
            dropdown.setValue(selected).onChange(value => { selected = value; updatePreview(); });
        });
        updatePreview();
        this.commit(this.text('apply'), () => purpose === 'default' ? config.setDefaultAIConnection(selected || null)
                : config.setAIPurposeBinding(purpose, selected === 'inherit' ? { mode: 'inherit' }
                : selected ? { mode: 'connection', connectionId: selected } : { mode: 'unconfigured' }), returnToOverview);
        this.button(this.text('add'), () => this.editor(undefined, purpose, () => this.selection(purpose, selected, returnAction)));
        this.button(this.text('cancel'), returnToOverview);
    }

    private manage(focusId?: string | null): void {
        const settings = this.options.configuration.getAIConnections();
        this.page(this.text('manage'), () => {
            this.render();
            Array.from(this.root.querySelectorAll<HTMLButtonElement>('button'))
                .find(button => button.textContent === this.text('manage'))?.focus();
        });
        for (const connection of settings?.connections ?? []) {
            const state = this.options.configuration.getAIConnectionTokenState(connection.id);
            new Setting(this.root).setName(connection.name).setDesc(`${getProviderDefinition(connection.providerId)?.name ?? connection.providerId} · ${this.text(`key.${state}`)}`)
                .addButton(button => {
                    button.buttonEl.dataset.paConnection = connection.id;
                    button.setButtonText(this.text('edit')).onClick(() => this.editor(connection));
                })
                .addButton(button => button.setButtonText(this.text('delete')).onClick(() => this.deletion(connection)));
        }
        this.button(this.text('add'), () => this.editor());
        if (focusId !== undefined) {
            const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('button'));
            const add = buttons.find(button => button.textContent === this.text('add'));
            (focusId === null ? add : buttons.find(button => button.dataset.paConnection === focusId)
                ?? buttons.find(button => button.dataset.paConnection) ?? add)?.focus();
        }
    }

    private editor(connection?: AIConnection, usage?: AIPurpose | 'default', returnTo?: () => void): void {
        const draftId = connection?.id ?? `new:${usage ?? 'manage'}`;
        const retained = this.editorDrafts.get(draftId);
        const baseline = retained?.baseline ?? connection;
        let draft: AIConnectionInput = retained?.draft ?? (connection ? JSON.parse(JSON.stringify(connection)) as AIConnectionInput
            : createConnectionDefaults('openai'));
        const draftState: ConnectionEditorDraft = retained ?? { draft, baseline };
        let key = '';
        const returnToParent = returnTo ?? (() => usage ? this.render() : this.manage(connection?.id ?? null));
        if (!connection && draftState.creation) {
            const creation = draftState.creation;
            const version = this.page(this.text('add'), returnToParent);
            const status = this.root.createEl('p', { text: this.text('saving'), attr: { role: 'status', 'aria-live': 'polite' } });
            new Setting(this.root).addButton(button => {
                button.setButtonText(this.text('edit')).setDisabled(true).onClick(() => {
                    if (draftState.created) this.editor(draftState.created, usage, returnToParent);
                    else this.editor(undefined, usage, returnTo);
                });
                void creation.then(saved => {
                    if (version !== this.version || !this.root.isConnected) return;
                    status.setText(saved.name);
                    button.setDisabled(false);
                }).catch(() => {
                    if (version !== this.version || !this.root.isConnected) return;
                    status.setText(this.text('saveFailed'));
                    button.setButtonText(this.text('retry')).setDisabled(false);
                });
            });
            return;
        }
        const back = () => {
            draftState.draft = JSON.parse(JSON.stringify(draft)) as AIConnectionInput;
            this.editorDrafts.set(draftId, draftState);
            returnToParent();
        };
        const draw = () => {
            this.page(this.text(connection ? 'edit' : 'add'), back);
            this.clearSecretDraft = () => { key = ''; };
            if (!connection) new Setting(this.root).setName(this.text('provider')).addDropdown(dropdown => {
                for (const definition of getProviderDefinitions()) dropdown.addOption(definition.id, definition.name);
                dropdown.setValue(draft.providerId).onChange(value => {
                    key = '';
                    draft = { ...createConnectionDefaults(value), name: draft.name };
                    draw();
                });
            });
            if (connection) new Setting(this.root).setName(this.text('provider'))
                .setDesc(getProviderDefinition(connection.providerId)?.name ?? connection.providerId);
            const details = this.root.createEl('details', { cls: 'pa-settings-detail' });
            details.createEl('summary', { text: this.text('advanced') });
            const endpointFields: Array<{ input: HTMLInputElement; error: HTMLElement }> = [];
            const validateEndpoints = () => {
                let firstInvalid: HTMLInputElement | undefined;
                for (const { input, error } of endpointFields) {
                    const value = input.value.trim();
                    const invalid = Boolean(value && !isHttpEndpoint(value));
                    error.hidden = !invalid;
                    if (invalid) {
                        input.setAttribute('aria-invalid', 'true');
                        input.setAttribute('aria-describedby', error.id);
                        firstInvalid ??= input;
                    } else {
                        input.removeAttribute('aria-invalid');
                        input.removeAttribute('aria-describedby');
                    }
                }
                if (firstInvalid) {
                    details.open = true;
                    firstInvalid.focus();
                }
                return !firstInvalid;
            };
            const nameRow = new Setting(connection ? this.root : details).setName(this.text('name'));
            const previewName = () => nameRow.setDesc(this.text('namePreview', {
                name: this.options.configuration.previewAIConnectionName(draft.name?.trim()
                    || getProviderDefinition(draft.providerId)?.name || draft.providerId, connection?.id),
            }));
            nameRow.addText(input => input.setValue(draft.name ?? '')
                .setPlaceholder(this.text('automaticName')).onChange(value => { draft.name = value; previewName(); }));
            previewName();
            new Setting(this.root).setName(this.text(connection ? 'newKey' : 'key')).setDesc(this.text('keyHelp'))
                .addText(input => {
                    input.inputEl.type = 'password';
                    input.inputEl.autocomplete = 'off';
                    input.inputEl.spellcheck = false;
                    input.onChange(value => { key = value; });
                });
            this.root.appendChild(details);
            const memoryPreview = this.root.createEl('p', { cls: 'pa-settings-section-desc', attr: { 'aria-live': 'polite' } });
            memoryPreview.hidden = true;
            let modelPreviewVersion = 0;
            const updateMemoryPreview = () => {
                const currentPreview = ++modelPreviewVersion;
                if (!connection || !this.options.previewMemory) return;
                const saved = this.options.configuration.getAIConnections();
                if (!saved) return;
                const active = resolveAIConnection(saved, 'embedding');
                const changed = draft.models?.embedding !== connection.models.embedding;
                memoryPreview.hidden = !changed || !active.ok || active.connection.connectionId !== connection.id;
                if (memoryPreview.hidden) return;
                const version = this.version;
                const projected = { ...saved, connections: saved.connections.map(item => item.id === connection.id
                    ? { ...item, models: { ...item.models, ...draft.models } } : item) };
                const target = resolveAIConnection(projected, 'embedding');
                memoryPreview.setText(this.text('preview.unknown'));
                if (target.ok) void this.options.previewMemory(target.connection).then(state => {
                    if (version === this.version && modelPreviewVersion === currentPreview && this.root.isConnected) {
                        memoryPreview.setText(this.text(`preview.${state}`));
                    }
                }).catch(() => { /* Failed local preview keeps the explicit unknown state. */ });
            };
            for (const purpose of PURPOSES) {
                if (draft.models?.[purpose] === undefined && draft.providerId !== 'custom') continue;
                new Setting(details).setName(this.text(`${purpose}Model`)).addText(input => input
                    .setValue(draft.models?.[purpose] ?? '').onChange(value => {
                        draft.models = { ...draft.models, [purpose]: value };
                        if (purpose === 'embedding') updateMemoryPreview();
                    }));
                if (!connection) {
                    const row = new Setting(details).setName(this.text('endpoint', { purpose: this.text(purpose) }));
                    const error = row.settingEl.createEl('p', { text: this.text('endpointInvalid'),
                        attr: { id: `pa-ai-endpoint-error-${this.version}-${purpose}` } });
                    error.hidden = true;
                    row.addText(input => {
                        endpointFields.push({ input: input.inputEl, error });
                        input.setValue(draft.endpoints?.[purpose] ?? '').onChange(value => {
                            draft.endpoints = { ...draft.endpoints, [purpose]: value };
                            input.inputEl.removeAttribute('aria-invalid');
                            input.inputEl.removeAttribute('aria-describedby');
                            error.hidden = true;
                        });
                    });
                } else new Setting(details).setName(this.text('endpoint', { purpose: this.text(purpose) }))
                    .setDesc(draft.endpoints?.[purpose] ?? this.text('unconfigured'));
            }
            if (draft.models?.chat !== undefined || draft.providerId === 'custom') new Setting(details).setName(this.text('policyModel')).addText(input => input
                .setValue(draft.models?.policy ?? '').onChange(value => { draft.models = { ...draft.models, policy: value }; }));
            if (draft.models?.image !== undefined) new Setting(details).setName(this.text('sourceImageModel')).addText(input => input
                .setValue(draft.models?.sourceImage ?? '').onChange(value => { draft.models = { ...draft.models, sourceImage: value }; }));
            if (draft.providerId.startsWith('dashscope-')) {
                for (const key of ['enableThinking', 'webSearchEnabled']) {
                    new Setting(details).setName(this.text(key)).addToggle(toggle => toggle
                        .setValue(draft.options?.chat?.[key] === true).onChange(value => {
                            draft.options = { ...draft.options, chat: { ...draft.options?.chat, [key]: value } };
                        }));
                }
            }
            if (connection) this.root.createEl('p', { text: this.text('sharedModels'), cls: 'pa-settings-section-desc' });
            const label = connection ? 'save' : usage === 'default' ? 'saveDefault' : usage ? 'savePurpose' : 'save';
            const changedFields = (): AIConnectionPatch => {
                if (!baseline) return draft;
                const models = Object.fromEntries(Object.entries(draft.models ?? {})
                    .filter(([key, value]) => baseline.models[key as keyof AIConnection['models']] !== value));
                const chat = Object.fromEntries(Object.entries(draft.options?.chat ?? {})
                    .filter(([key, value]) => baseline.options.chat?.[key] !== value));
                return {
                    ...(draft.name !== baseline.name ? { name: draft.name } : {}),
                    ...(Object.keys(models).length ? { models } : {}),
                    ...(Object.keys(chat).length ? { options: { chat } } : {}),
                };
            };
            const afterSave = () => {
                this.editorDrafts.delete(draftId);
                if (usage) this.render();
                else this.manage(connection?.id ?? null);
            };
            this.commit(this.text(label, usage ? { purpose: this.text(usage) } : undefined), async () => {
                const submittedDraft = JSON.stringify(draft);
                const patch = changedFields();
                let saved: AIConnection;
                if (connection) saved = await this.options.configuration.updateAIConnection(connection.id, patch, key || undefined);
                else {
                    draftState.creation = this.options.configuration.createAIConnection(draft, key || undefined, usage,
                        { initialSetup: this.options.isInitialSetup });
                    this.editorDrafts.set(draftId, draftState);
                    try {
                        saved = await draftState.creation;
                        draftState.created = saved;
                    } finally {
                        draftState.creation = undefined;
                    }
                }
                const retained = this.editorDrafts.get(draftId);
                const unchangedDraft = retained?.baseline === baseline && JSON.stringify(retained?.draft) === submittedDraft;
                // Returning while a save runs retains this baseline for the next editor.
                // Commit only the submitted fields; later edits must remain dirty.
                if (baseline) {
                    if (patch.name !== undefined) {
                        if (retained?.baseline === baseline && retained.draft.name === patch.name) retained.draft.name = saved.name;
                        baseline.name = saved.name;
                    }
                    if (patch.models) baseline.models = { ...baseline.models, ...patch.models };
                    if (patch.options?.chat) baseline.options.chat = { ...baseline.options.chat, ...patch.options.chat };
                }
                if (unchangedDraft) this.editorDrafts.delete(draftId);
            }, afterSave, validateEndpoints);
            if (connection) {
                const version = this.version;
                const status = this.root.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
                this.button(this.text('removeKey'), async () => {
                    if (this.busyVersion === version) return;
                    this.busyVersion = version;
                    try {
                        if (!await confirmUserAction(this.options.app, { title: this.text('removeKey'),
                            message: this.text('removeKeyHelp'), confirmText: this.text('removeKey') })) return;
                        if (version !== this.version || !this.root.isConnected) return;
                        status.setText(this.text('saving'));
                        await this.options.configuration.removeAIConnectionKey(connection.id);
                        if (this.root.isConnected) this.options.onCommitted?.();
                        if (version === this.version && this.root.isConnected) this.manage(connection.id);
                    } catch {
                        if (version === this.version && this.root.isConnected) status.setText(this.text('saveFailed'));
                    } finally {
                        if (this.busyVersion === version) this.busyVersion = undefined;
                    }
                });
            }
            this.button(this.text('cancel'), () => { this.editorDrafts.delete(draftId); returnToParent(); });
        };
        draw();
    }

    private deletion(connection: AIConnection): void {
        const settings = this.options.configuration.getAIConnections();
        if (!settings) return;
        this.page(this.text('delete'), () => this.manage(connection.id));
        this.root.createEl('p', { text: this.text('deleteHelp', { name: connection.name }) });
        const affectedPurposes = PURPOSES.filter(purpose => {
            const effective = resolveAIConnection(settings, purpose);
            return effective.ok && effective.connection.connectionId === connection.id;
        });
        this.root.createEl('p', { text: this.text('affected', {
            purposes: affectedPurposes.map(purpose => this.text(purpose)).join(', ') || this.text('unused'),
        }) });
        if (this.options.getConnectionTaskCount) {
            const version = this.version;
            const tasks = this.root.createEl('p', { text: this.text('tasksChecking') });
            void this.options.getConnectionTaskCount(connection.id).then(count => {
                if (version !== this.version || !this.root.isConnected) return;
                tasks.setText(count === undefined ? this.text('tasksUnknown') : this.text('tasksAffected', { count }));
            }).catch(() => {
                if (version === this.version && this.root.isConnected) tasks.setText(this.text('tasksUnknown'));
            });
        }
        const replacement: AIConnectionDeletion = { bindings: {} };
        const affected = PURPOSES.filter(purpose => {
            const binding = settings.bindings[purpose];
            return binding.mode === 'connection' && binding.connectionId === connection.id;
        });
        const replaceRow = (name: string, onChange: (value: string) => void) => {
            new Setting(this.root).setName(name).addDropdown(dropdown => {
                dropdown.addOption('', this.text('unconfigured'));
                for (const other of settings.connections) if (other.id !== connection.id) dropdown.addOption(other.id, other.name);
                dropdown.onChange(onChange);
            });
        };
        if (settings.defaultConnectionId === connection.id) {
            replacement.defaultConnectionId = null;
            replaceRow(this.text('default'), value => { replacement.defaultConnectionId = value || null; });
        }
        for (const purpose of affected) {
            replacement.bindings![purpose] = { mode: 'unconfigured' };
            replaceRow(this.text(purpose), value => {
                replacement.bindings![purpose] = value ? { mode: 'connection', connectionId: value } : { mode: 'unconfigured' };
            });
        }
        this.commit(this.text('delete'), () => this.options.configuration.deleteAIConnection(connection.id, replacement), () => this.manage(null));
        this.button(this.text('cancel'), () => this.manage(connection.id));
    }

    private migration(): void {
        this.page(this.text('migrate'), () => this.render());
        this.root.createEl('p', { text: this.text('migrationHelp') });
        let providerId = 'openai';
        let secretRef: string | undefined;
        new Setting(this.root).setName(this.text('provider')).addDropdown(dropdown => {
            for (const definition of getProviderDefinitions()) dropdown.addOption(definition.id, definition.name);
            dropdown.setValue(providerId).onChange(value => { providerId = value; });
        });
        let choices: Array<{ id: string; label: string }>;
        try { choices = this.options.legacyCredentials(); }
        catch {
            this.root.createEl('p', { text: this.text('legacyListFailed'), attr: { role: 'alert' } });
            this.button(this.text('retry'), () => this.migration());
            return;
        }
        if (choices.length) {
            secretRef = choices[0].id;
            new Setting(this.root).setName(this.text('savedKey')).addDropdown(dropdown => {
                for (const choice of choices) dropdown.addOption(choice.id, choice.label);
                dropdown.setValue(secretRef!).onChange(value => { secretRef = value; });
            });
        }
        this.commit(this.text('migrate'), () => this.options.configuration.migrateLegacyAIConnections({ providerId, secretRef }));
        this.button(this.text('cancel'), () => this.render());
    }
}

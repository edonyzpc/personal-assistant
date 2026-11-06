import { setIcon, Setting, type App } from 'obsidian';
import type {
    AIConnectionCreationPreview,
    AIConnectionPatch,
    AIConnectionSelectionEffective,
    AIConnectionSelectionPreview,
    PluginAIConfiguration,
} from '../ai-services/plugin-configuration';
import type {
    AIConnection,
    AIConnectionsSettings,
    AIPurpose,
    PurposeBinding,
    ResolvedAIConnection,
} from '../ai-services/ai-connection-types';
import { createConnectionDefaults, getProviderDefinition, getProviderDefinitions } from '../ai-services/provider-definitions';
import { isHttpEndpoint, resolveAIConnection } from '../ai-services/ai-connection-resolver';
import { confirmUserAction } from '../confirm';
import type { PluginTranslator } from '../locales/plugin';
import type { MemoryMaintenancePlan } from '../memory-manager';

const PURPOSES: AIPurpose[] = ['chat', 'embedding', 'image'];

interface ConnectionEditorDraft {
    draft: Partial<AIConnection>;
    baseline?: AIConnection;
    creation?: Promise<AIConnection>;
    created?: AIConnection;
}

interface SelectionDraft {
    defaultId: string;
    values: Record<AIPurpose, string>;
    defaultTouched: boolean;
    purposeTouched: Record<AIPurpose, boolean>;
}

export type PendingAISelectionStatus = 'saving' | 'applied' | 'preview-changed' | 'failed';

export interface PendingAIAssetCreationPreview {
    input: AIConnectionCreationPreview['input'];
    usage: 'asset';
}

export type PendingAIPreview =
    | AIConnectionSelectionPreview
    | AIConnectionCreationPreview
    | PendingAIAssetCreationPreview;

export interface PendingAISelection {
    kind: 'selection' | 'creation';
    preview: PendingAIPreview;
    status: PendingAISelectionStatus;
    promise: Promise<unknown>;
    markResultRead(): void;
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
    openMemoryDetails?(): void;
    onCommitted?(): void;
    onSubpageChange?(open: boolean, title?: string): void;
    getScrollRoot?(): HTMLElement | null;
    getPendingAISelection?(): PendingAISelection | null;
    beginAISelection?(options: {
        kind: 'selection' | 'creation';
        preview: PendingAIPreview;
        operation: () => Promise<unknown>;
    }): PendingAISelection;
    getAIAssetCreation?(key: string): PendingAISelection | null;
    beginAIAssetCreation?(options: {
        key: string;
        input: AIConnectionCreationPreview['input'];
        operation: () => Promise<AIConnection>;
    }): PendingAISelection;
}

/** The AI detail keeps selection and connection editing in one owner-backed page. */
export class AIConnectionsSettingsView {
    private mode: 'overview' | 'editor' | 'deletion' | 'migration' = 'overview';
    private clearSecretDraft: (() => void) | undefined;
    private refreshOverviewMemory: (() => void) | undefined;
    private readonly editorDrafts = new Map<string, ConnectionEditorDraft>();
    private selectionDraft: SelectionDraft | null = null;
    private purposesOpen = false;
    private returnFocusTarget: string | null = null;
    private returnScrollTop = 0;
    private captureEditorDraft: (() => void) | null = null;

    constructor(private readonly root: HTMLElement, private readonly options: AIConnectionsSettingsOptions) {}

    private text(key: string, params?: Record<string, string | number>): string {
        return this.options.translate(`plugin.settings.connections.${key}`, params);
    }

    private get configuration(): PluginAIConfiguration {
        return this.options.configuration;
    }

    private button(
        label: string,
        action: () => void | Promise<void>,
        options: { primary?: boolean; purpose?: AIPurpose | 'default'; action?: string; disabled?: boolean } = {},
    ): HTMLButtonElement {
        const row = new Setting(this.root);
        row.settingEl.addClass?.('pa-ai-connections-action');
        let element: HTMLButtonElement | undefined;
        row.addButton(button => {
            element = button.buttonEl;
            button.setButtonText(label);
            if (options.primary) button.setCta();
            if (options.disabled) button.setDisabled(true);
            if (options.purpose) button.buttonEl.dataset.paPurpose = options.purpose;
            if (options.action) button.buttonEl.dataset.paAction = options.action;
            button.onClick(action);
        });
        return element!;
    }

    private clearRoot(): void {
        this.clearSecretDraft?.();
        this.clearSecretDraft = undefined;
        this.refreshOverviewMemory = undefined;
        this.root.empty();
    }

    private openSubpage(mode: typeof this.mode, title: string, render: () => void): void {
        const active = this.root.ownerDocument?.activeElement ?? null;
        const HTMLElementClass = this.root.ownerDocument?.defaultView?.HTMLElement;
        const activeElement = HTMLElementClass && active instanceof HTMLElementClass
            ? active as HTMLElement
            : null;
        if (activeElement && this.root.contains(activeElement)) {
            this.returnFocusTarget = null;
            if (activeElement.dataset.paConnection) {
                this.returnFocusTarget = `[data-pa-connection="${activeElement.dataset.paConnection}"]`;
            } else if (activeElement.dataset.paPurpose) {
                this.returnFocusTarget = activeElement.dataset.paSelectionAction
                    ? `[data-pa-purpose="${activeElement.dataset.paPurpose}"][data-pa-selection-action="${activeElement.dataset.paSelectionAction}"]`
                    : `[data-pa-purpose="${activeElement.dataset.paPurpose}"][data-pa-action="edit"]`;
            } else if (activeElement.dataset.paAction) {
                this.returnFocusTarget = `[data-pa-action="${activeElement.dataset.paAction}"]`;
            }
        } else {
            this.returnFocusTarget = null;
        }
        this.returnScrollTop = this.options.getScrollRoot?.()?.scrollTop ?? this.returnScrollTop;
        this.clearRoot();
        this.mode = mode;
        if (this.options.onSubpageChange === undefined) this.root.createEl('h3', { text: title });
        render();
        this.options.onSubpageChange?.(true, title);
    }

    back(): boolean {
        if (this.mode === 'overview') return false;
        if (this.mode === 'editor') this.captureEditorDraft?.();
        this.restoreSubpage();
        return true;
    }

    private restoreSubpage(): void {
        const scrollTop = this.returnScrollTop;
        this.renderOverview();
        this.options.getScrollRoot?.()?.scrollTo?.({ top: scrollTop, behavior: 'auto' });
        const focus = this.returnFocusTarget
            ? this.root.querySelector<HTMLElement>(this.returnFocusTarget)
            : null;
        focus?.focus({ preventScroll: true });
    }

    hasSubpage(): boolean {
        return this.mode !== 'overview';
    }

    deactivate(): void {
        if (this.mode === 'editor') this.captureEditorDraft?.();
        this.clearSecretDraft?.();
        this.root.dataset.paVersion = String(this.versionToken() + 1);
    }

    focusSelectionTarget(target: AIPurpose | 'default'): void {
        if (this.mode !== 'overview') this.deactivate();
        this.renderOverview();
        if (target !== 'default') {
            this.root.querySelectorAll('details.pa-ai-connections-purposes')
                .forEach(details => { (details as HTMLDetailsElement).open = true; });
        }
        const selector = target === 'default'
            ? '[data-pa-selection-target="default"]'
            : `[data-pa-selection-target="${target}"]`;
        (this.root.querySelector(selector) as HTMLElement | null)?.focus({ preventScroll: true });
    }

    refreshOverview(): void {
        if (this.mode === 'overview' && this.root.isConnected) this.renderOverview();
    }

    activate(): void {
        this.renderOverview();
    }

    syncPendingSelection(): void {
        if (this.mode === 'overview' && this.root.isConnected) this.renderOverview();
    }

    private pendingSelection(): PendingAISelection | null {
        return this.options.getPendingAISelection?.() ?? null;
    }

    private beginPending(
        kind: 'selection' | 'creation',
        preview: PendingAIPreview,
        operation: () => Promise<unknown>,
    ): Promise<unknown> {
        const started = this.options.beginAISelection?.({ kind, preview, operation });
        if (started) return started.promise;
        return operation();
    }

    private beginAssetCreation(
        key: string,
        input: AIConnectionCreationPreview['input'],
        operation: () => Promise<AIConnection>,
    ): Promise<AIConnection> {
        const started = this.options.beginAIAssetCreation?.({ key, input, operation });
        return started ? started.promise as Promise<AIConnection> : operation();
    }

    private bindingValue(binding: PurposeBinding): string {
        if (binding.mode === 'inherit') return 'inherit';
        return binding.mode === 'connection' ? binding.connectionId : '';
    }

    private bindingFromValue(value: string): PurposeBinding {
        if (value === 'inherit') return { mode: 'inherit' };
        return value ? { mode: 'connection', connectionId: value } : { mode: 'unconfigured' };
    }

    private ensureSelectionDraft(): SelectionDraft {
        const saved = this.configuration.getAIConnections();
        if (!saved) {
            this.selectionDraft = {
                defaultId: '',
                values: { chat: 'inherit', embedding: 'inherit', image: 'inherit' },
                defaultTouched: false,
                purposeTouched: { chat: false, embedding: false, image: false },
            };
            return this.selectionDraft;
        }
        if (!this.selectionDraft) {
            const pending = this.pendingSelection();
            if (pending?.kind === 'selection' && pending.status === 'saving') {
                const patch = (pending.preview as AIConnectionSelectionPreview).patch;
                this.selectionDraft = {
                    defaultId: patch.defaultConnectionId !== undefined
                        ? patch.defaultConnectionId ?? ''
                        : saved.defaultConnectionId ?? '',
                    values: {
                        chat: patch.bindings?.chat !== undefined
                            ? this.bindingValue(patch.bindings.chat)
                            : this.bindingValue(saved.bindings.chat),
                        embedding: patch.bindings?.embedding !== undefined
                            ? this.bindingValue(patch.bindings.embedding)
                            : this.bindingValue(saved.bindings.embedding),
                        image: patch.bindings?.image !== undefined
                            ? this.bindingValue(patch.bindings.image)
                            : this.bindingValue(saved.bindings.image),
                    },
                    defaultTouched: patch.defaultConnectionId !== undefined,
                    purposeTouched: {
                        chat: patch.bindings?.chat !== undefined,
                        embedding: patch.bindings?.embedding !== undefined,
                        image: patch.bindings?.image !== undefined,
                    },
                };
                return this.selectionDraft;
            }
            this.selectionDraft = {
                defaultId: saved.defaultConnectionId ?? '',
                values: {
                    chat: this.bindingValue(saved.bindings.chat),
                    embedding: this.bindingValue(saved.bindings.embedding),
                    image: this.bindingValue(saved.bindings.image),
                },
                defaultTouched: false,
                purposeTouched: { chat: false, embedding: false, image: false },
            };
        } else {
            if (this.selectionDraft.defaultTouched
                && this.selectionDraft.defaultId === (saved.defaultConnectionId ?? '')) {
                this.selectionDraft.defaultTouched = false;
            }
            if (!this.selectionDraft.defaultTouched) {
                this.selectionDraft.defaultId = saved.defaultConnectionId ?? '';
            }
            for (const purpose of PURPOSES) {
                const savedValue = this.bindingValue(saved.bindings[purpose]);
                if (this.selectionDraft.purposeTouched[purpose]
                    && this.selectionDraft.values[purpose] === savedValue) {
                    this.selectionDraft.purposeTouched[purpose] = false;
                }
                if (!this.selectionDraft.purposeTouched[purpose]) {
                    this.selectionDraft.values[purpose] = savedValue;
                }
            }
        }
        return this.selectionDraft;
    }

    private selectionPatch() {
        const saved = this.configuration.getAIConnections();
        const draft = this.ensureSelectionDraft();
        if (!saved) return { patch: undefined, preview: undefined, error: undefined };
        const invalidTarget = (draft.defaultTouched && draft.defaultId !== ''
            && !saved.connections.some(connection => connection.id === draft.defaultId))
            || PURPOSES.some(purpose => draft.purposeTouched[purpose]
                && draft.values[purpose] !== 'inherit'
                && draft.values[purpose] !== ''
                && !saved.connections.some(connection => connection.id === draft.values[purpose]));
        if (invalidTarget) return { patch: undefined, preview: undefined, error: new Error('ai_connection:connection_missing') };
        const patch: NonNullable<ReturnType<PluginAIConfiguration['previewAIConnectionSelection']>['patch']> = {};
        const savedDefault = saved.defaultConnectionId ?? '';
        if (draft.defaultId !== savedDefault) patch.defaultConnectionId = draft.defaultId || null;
        const bindings: Partial<Record<AIPurpose, PurposeBinding>> = {};
        for (const purpose of PURPOSES) {
            const savedValue = this.bindingValue(saved.bindings[purpose]);
            if (draft.values[purpose] !== savedValue) bindings[purpose] = this.bindingFromValue(draft.values[purpose]);
        }
        if (Object.keys(bindings).length) patch.bindings = bindings;
        if (!('defaultConnectionId' in patch) && !patch.bindings) return { patch: undefined, preview: undefined, error: undefined };
        try {
            return { patch, preview: this.configuration.previewAIConnectionSelection(patch), error: undefined };
        } catch (error) {
            return { patch, preview: undefined, error };
        }
    }

    private setSelectionLocked(locked: boolean): void {
        this.root.querySelectorAll<HTMLSelectElement>('[data-pa-selection-target]')
            .forEach(select => { select.disabled = locked; });
        this.root.querySelectorAll<HTMLButtonElement>(
            '[data-pa-selection-action], [data-pa-action="apply"], [data-pa-action="cancel"]',
        )
            .forEach(button => { button.disabled = locked; });
    }

    private effectiveDescription(effective: AIConnectionSelectionEffective): string {
        return effective.ok
            ? `${this.connectionDisplayName(effective)} · ${effective.providerId} · ${effective.model}`
            : this.text(`issue.${effective.issue}`);
    }

    private connectionDisplayName(effective: Extract<AIConnectionSelectionEffective, { ok: true }>): string {
        return this.configuration.getAIConnections()?.connections
            .find(connection => connection.id === effective.connectionId)?.name
            ?? getProviderDefinition(effective.providerId)?.name
            ?? effective.providerId;
    }

    private memoryPreviewConnection(effective: Extract<AIConnectionSelectionEffective, { ok: true }>): ResolvedAIConnection | null {
        const saved = this.configuration.getAIConnections();
        const connection = saved?.connections.find(item => item.id === effective.connectionId);
        if (!connection) return null;
        return {
            purpose: 'embedding',
            connectionId: connection.id,
            name: connection.name,
            providerId: effective.providerId,
            endpoint: effective.endpoint,
            model: effective.model,
            secretRef: connection.secretRef,
            revision: connection.revision,
            adapter: effective.adapter,
            options: JSON.parse(JSON.stringify(connection.options)) as ResolvedAIConnection['options'],
        };
    }

    private describeCreationPreview(
        preview: AIConnectionCreationPreview,
        pendingConnectionName: string,
    ): string {
        return preview.impact.purposes.map(item => `${this.text(item.purpose)}: ${
            this.effectiveDescription(item.before)
        } → ${item.after.ok
            ? `${pendingConnectionName} · ${item.after.providerId} · ${item.after.model}`
            : this.effectiveDescription(item.after)}`).join('\n');
    }

    private renderImpact(preview: AIConnectionSelectionPreview, version: number): void {
        const container = this.root.createDiv({
            cls: 'pa-settings-connection-preview',
            attr: { role: 'status', 'aria-live': 'polite' },
        });
        let previewVersion = 0;
        const draw = (current: AIConnectionSelectionPreview) => {
            const requestId = ++previewVersion;
            container.empty();
            if (current.impact.defaultConnection && current.impact.purposes.length === 0) {
                container.createEl('p', { text: this.text('onlyDefaultChanges') });
            }
            for (const item of current.impact.purposes) {
                const semantic = item.semanticChanged && !item.effectiveChanged
                    ? this.text(item.beforeBinding.mode === 'connection' ? 'semanticInherit' : 'semanticSeparate')
                    : '';
                container.createEl('p', {
                    text: `${this.text(item.purpose)}: ${this.effectiveDescription(item.before)} → ${
                        this.effectiveDescription(item.after)
                    }${semantic ? ` · ${semantic}` : ''}`,
                });
            }
            const memory = current.impact.purposes.find(item => item.purpose === 'embedding' && item.effectiveChanged);
            if (!memory || !memory.after.ok || !this.options.previewMemory) return;
            const memoryConnection = this.memoryPreviewConnection(memory.after);
            if (!memoryConnection) return;
            const state = container.createEl('p', { text: this.text('switchMemory') });
            void this.options.previewMemory(memoryConnection).then(value => {
                if (version !== this.versionToken() || requestId !== previewVersion || !this.root.isConnected) return;
                state.setText(this.text(`preview.${value}`));
            }).catch(() => {
                if (version === this.versionToken() && requestId === previewVersion && this.root.isConnected) {
                    state.setText(this.text('preview.unknown'));
                }
            });
        };
        draw(preview);
        container.dataset.paImpactVersion = String(version);
    }

    private versionToken(): number {
        return Number(this.root.dataset.paVersion ?? 0);
    }

    private renderPendingStatus(): void {
        const pending = this.pendingSelection();
        if (!pending) return;
        if (pending.kind === 'selection' && pending.status === 'applied' && this.selectionDraft !== null) {
            const patch = (pending.preview as AIConnectionSelectionPreview).patch;
            if (patch.defaultConnectionId !== undefined) this.selectionDraft.defaultTouched = false;
            for (const purpose of PURPOSES) {
                if (patch.bindings?.[purpose] !== undefined) {
                    this.selectionDraft.purposeTouched[purpose] = false;
                }
            }
        }
        const status = this.root.createEl('p', {
            cls: 'pa-ai-connections-result',
            attr: { role: 'status', 'aria-live': 'polite' },
        });
        status.textContent = pending.status === 'saving' ? this.text('saving') : this.text(pending.status === 'applied'
            ? pending.kind === 'creation' ? 'creationApplied' : 'applied'
            : pending.status === 'preview-changed' ? 'previewChanged' : 'saveFailed');
        if (pending.status !== 'saving') pending.markResultRead();
    }

    render(): void {
        this.renderOverview();
    }

    private renderOverview(): void {
        this.captureEditorDraft = null;
        const version = Number(this.root.dataset.paVersion ?? 0) + 1;
        const activeElement = this.root.ownerDocument?.activeElement ?? null;
        const hadFocus = activeElement !== null && this.root.contains(activeElement);
        const selectionFocusTarget = (activeElement as { dataset?: DOMStringMap } | null)
            ?.dataset?.paSelectionTarget ?? null;
        this.clearRoot();
        this.root.dataset.paVersion = String(version);
        this.mode = 'overview';
        this.options.onSubpageChange?.(false);
        const settings = this.configuration.getAIConnections();
        if (settings === undefined) {
            this.root.createEl('p', { text: this.text('intro') });
            if (this.options.isInitialSetup) this.button(this.text('addDefault'), () => this.editor(undefined, 'default'), { primary: true });
            else this.button(this.text('migrate'), () => this.migration(), { primary: true });
            this.renderPendingStatus();
            return;
        }
        if (!settings || settings.schemaVersion !== 1 || !Array.isArray(settings.connections) || !settings.bindings) {
            this.root.createEl('p', { text: this.text('invalid'), attr: { role: 'alert' } });
            return;
        }

        const pending = this.pendingSelection();
        const locked = pending?.status === 'saving';
        const draft = this.ensureSelectionDraft();
        const { preview, error } = this.selectionPatch();
        const defaultConnection = settings.connections.find(item => item.id === draft.defaultId);
        const defaultRow = new Setting(this.root)
            .setName(this.text('default'))
            .setDesc(defaultConnection
                ? `${defaultConnection.name} · ${defaultConnection.models.chat ?? ''}`
                : this.text('unconfigured'));
        defaultRow.addDropdown(dropdown => {
            dropdown.addOption('', this.text('unconfigured'));
            for (const connection of settings.connections) dropdown.addOption(connection.id, connection.name);
            dropdown.setValue(draft.defaultId).onChange(value => {
                draft.defaultId = value;
                draft.defaultTouched = true;
                this.renderOverview();
            });
            dropdown.selectEl.dataset.paSelectionTarget = 'default';
            dropdown.selectEl.disabled = locked;
        });
        defaultRow.addButton(button => {
            button.buttonEl.dataset.paPurpose = 'default';
            button.buttonEl.dataset.paAction = 'edit';
            button.setButtonText(this.text('edit'))
                .setDisabled(locked || !defaultConnection)
                .onClick(() => defaultConnection && this.editor(defaultConnection));
        });
            defaultRow.addButton(button => {
                button.setButtonText(this.text('add'))
                    .setDisabled(locked)
                    .onClick(() => this.editor(undefined, 'default'));
                button.buttonEl.dataset.paPurpose = 'default';
                button.buttonEl.dataset.paSelectionAction = 'add';
                button.buttonEl.setAttribute('aria-label', this.text('addDefault'));
            });

        const purposes = this.root.createEl('details', { cls: 'pa-settings-detail pa-ai-connections-purposes' });
        purposes.open = this.purposesOpen;
        const summary = purposes.createEl('summary');
        this.decorateSummary(summary, this.text('purposes'), this.purposeDisclosureSummary(settings));
        purposes.addEventListener('toggle', () => { this.purposesOpen = purposes.open; });
        const purposeBody = purposes.createDiv({ cls: 'pa-settings-detail__body' });
        for (const purpose of PURPOSES) {
            const binding = settings.bindings[purpose];
            const selectedConnection = settings.connections.find(item => item.id === draft.values[purpose]);
            const row = new Setting(purposeBody)
                .setName(this.text(purpose))
                .setDesc(`${this.describePurpose(setting => resolveAIConnection(setting, purpose))} · ${
                    this.text(binding.mode === 'inherit' ? 'inherit' : binding.mode === 'unconfigured' ? 'unconfigured' : 'separate')
                }${selectedConnection ? ` · ${selectedConnection.name}` : ''}`);
            row.addDropdown(dropdown => {
                dropdown.addOption('inherit', this.text('inherit'));
                dropdown.addOption('', this.text('unconfigured'));
                for (const connection of settings.connections) dropdown.addOption(connection.id, connection.name);
                dropdown.setValue(draft.values[purpose]).onChange(value => {
                    draft.values[purpose] = value;
                    draft.purposeTouched[purpose] = true;
                    this.renderOverview();
                });
                dropdown.selectEl.dataset.paSelectionTarget = purpose;
                dropdown.selectEl.disabled = locked;
            });
            row.addButton(button => {
                button.buttonEl.dataset.paPurpose = purpose;
                button.buttonEl.dataset.paAction = 'edit';
                button.setButtonText(this.text('edit'))
                    .setDisabled(locked || !selectedConnection)
                    .onClick(() => selectedConnection && this.editor(selectedConnection));
            });
            row.addButton(button => {
                button.setButtonText(this.text('add'))
                    .setDisabled(locked)
                    .onClick(() => this.editor(undefined, purpose));
                button.buttonEl.dataset.paPurpose = purpose;
                button.buttonEl.dataset.paSelectionAction = 'add';
                button.buttonEl.setAttribute(
                    'aria-label',
                    this.text('addForPurpose', { purpose: this.text(purpose) }),
                );
            });
        }
        this.renderMemoryStatus(version);

        if (error) {
            this.root.createEl('p', { text: this.text('invalid'), attr: { role: 'alert' } });
        } else if (preview) {
            this.renderImpact(preview, version);
            this.button(this.text('applySelection'), async () => {
                if (locked || !preview) return;
                this.setSelectionLocked(true);
                const savingStatus = this.root.createEl('p', {
                    cls: 'pa-ai-connections-result',
                    attr: { role: 'status', 'aria-live': 'polite' },
                });
                savingStatus.textContent = this.text('saving');
                try {
                    const result = await this.beginPending(
                        'selection',
                        preview,
                        () => this.configuration.setAIConnectionSelection(preview),
                    ) as { status?: string; preview?: AIConnectionSelectionPreview } | undefined;
                    if (result?.status === 'preview-changed') {
                        const patch = result.preview?.patch;
                        if (patch?.defaultConnectionId !== undefined) {
                            draft.defaultId = patch.defaultConnectionId ?? '';
                        }
                        for (const purpose of PURPOSES) {
                            const binding = patch?.bindings?.[purpose];
                            if (binding !== undefined) {
                                draft.values[purpose] = this.bindingValue(binding);
                            }
                        }
                    }
                    if (this.root.isConnected && this.mode === 'overview'
                        && (!result || result.status === 'applied')) {
                        this.selectionDraft = null;
                        this.options.onCommitted?.();
                    }
                    if (this.root.isConnected && this.mode === 'overview') this.renderOverview();
                } catch {
                    if (this.root.isConnected && this.mode === 'overview') this.renderOverview();
                    if (this.root.isConnected && this.mode === 'overview') {
                        const failure = this.root.createEl('p', {
                            cls: 'pa-ai-connections-result',
                            attr: { role: 'alert' },
                        });
                        failure.textContent = this.text('saveFailed');
                    }
                }
            }, { primary: true, action: 'apply' });
            this.button(this.text('cancelSelection'), () => {
                this.selectionDraft = null;
                this.renderOverview();
            }, { action: 'cancel' });
        }
        this.renderPendingStatus();
        this.renderConnections(settings.connections);
        if (hadFocus) {
            const active = selectionFocusTarget !== null
                ? this.root.querySelector<HTMLElement>(`[data-pa-selection-target="${selectionFocusTarget}"]`)
                : this.root.querySelector<HTMLElement>('[aria-live="polite"], select, button');
            active?.focus({ preventScroll: true });
        }
    }

    private describePurpose(resolve: (settings: ReturnType<PluginAIConfiguration['getAIConnections']>) => ReturnType<typeof resolveAIConnection>): string {
        const resolution = resolve(this.configuration.getAIConnections());
        return resolution.ok ? `${resolution.connection.name} · ${resolution.connection.model}` : this.text(`issue.${resolution.issue}`);
    }

    private purposeDisclosureSummary(settings: AIConnectionsSettings): string {
        const exceptions = PURPOSES
            .filter(purpose => settings.bindings[purpose].mode !== 'inherit')
            .map(purpose => {
                const binding = settings.bindings[purpose];
                if (binding.mode === 'unconfigured') {
                    return `${this.text(purpose)} · ${this.text('unconfigured')}`;
                }
                if (binding.mode !== 'connection') return '';
                const connection = settings.connections.find(item => item.id === binding.connectionId);
                return `${this.text(purpose)} · ${
                    connection?.name ?? this.text('issue.connection_missing')
                } · ${this.text('separate')}`;
            });
        if (exceptions.length > 0) return exceptions.join(' · ');
        const defaultConnection = settings.connections
            .find(connection => connection.id === settings.defaultConnectionId);
        return defaultConnection
            ? this.text('summary.allInherit', { name: defaultConnection.name })
            : this.text('summary.noDefault');
    }

    private decorateSummary(summary: HTMLElement, label: string, detail?: string): void {
        const document = summary.ownerDocument ?? this.root.ownerDocument ?? globalThis.document;
        const icon = document.win.createSpan();
        icon.className = 'pa-settings-disclosure-icon';
        icon.setAttribute('aria-hidden', 'true');
        summary.appendChild(icon);
        setIcon(icon, 'chevron-right');
        const text = document.win.createSpan();
        text.className = 'pa-settings-disclosure-label';
        text.textContent = label;
        summary.appendChild(text);
        if (detail === undefined) return;
        const detailElement = document.win.createSpan();
        detailElement.className = 'pa-settings-disclosure-label';
        detailElement.textContent = detail;
        summary.appendChild(detailElement);
    }

    private renderMemoryStatus(version: number): void {
        if (!this.options.getMemoryPlan) return;
        const container = this.root.createDiv({ cls: 'pa-ai-connections-memory' });
        let refresh = 0;
        this.refreshOverviewMemory = () => {
            const currentRefresh = ++refresh;
            container.empty();
            const memoryEnabled = this.options.isMemoryEnabled?.() !== false;
            const status = container.createEl('p', {
                text: memoryEnabled ? this.text('checking') : this.text('memoryOff'),
                cls: 'pa-settings-section-desc',
            });
            const details = container.createEl('button', { text: this.text('memory.details'), attr: { type: 'button' } });
            details.addEventListener('click', () => this.options.openMemoryDetails?.());
            if (!memoryEnabled) return;
            void this.options.getMemoryPlan!().then(plan => {
                if (version !== this.versionToken() || currentRefresh !== refresh || !this.root.isConnected) return;
                status.setText(this.text(this.options.isMemoryActive?.() ? 'memoryActive'
                    : plan.reason === 'unavailable' ? 'memoryRecovery'
                        : plan.reason === 'ready' ? 'memoryReady'
                            : plan.action === 'refresh' || plan.action === 'rebuild-lexical' ? 'memoryPending' : 'memoryNeedsPrepare'));
                this.renderMemoryAction(plan, status);
            }).catch(() => {
                if (version === this.versionToken() && currentRefresh === refresh && this.root.isConnected) {
                    status.setText(this.text('memoryRecovery'));
                }
            });
        };
        this.refreshOverviewMemory();
    }

    private renderMemoryAction(plan: MemoryMaintenancePlan, after: HTMLElement): void {
        if (!this.options.memoryAction || (plan.reason === 'ready' && !this.options.isMemoryActive?.())) return;
        const action = this.options.isMemoryActive?.() ? 'details'
            : plan.action === 'refresh' ? 'update' : plan.action === 'rebuild' ? 'prepare' : 'details';
        const version = this.versionToken();
        const button = after.createEl('button', { text: this.text(`memory.${action}`), attr: { type: 'button' } });
        button.addEventListener('click', () => {
            button.disabled = true;
            void Promise.resolve(this.options.memoryAction?.(action)).then(() => {
                if (version === this.versionToken() && this.root.isConnected) this.renderOverview();
            }).catch(() => {
                if (version === this.versionToken() && this.root.isConnected) {
                    after.setText(this.text('memoryRecovery'));
                    button.disabled = false;
                }
            });
        });
    }

    private draftChanged(draftState: ConnectionEditorDraft): boolean {
        if (draftState.baseline) {
            const draft = draftState.draft;
            const baseline = draftState.baseline;
            return JSON.stringify(draft) !== JSON.stringify(baseline);
        }
        const defaults = createConnectionDefaults(draftState.draft.providerId ?? 'openai');
        return JSON.stringify(draftState.draft) !== JSON.stringify(defaults);
    }

    private renderConnections(connections: AIConnection[]): void {
        const heading = this.root.createEl('h3', { text: this.text('savedConnections') });
        heading.setAttribute('aria-label', this.text('savedConnections'));
        for (const connection of connections) {
            const state = this.configuration.getAIConnectionTokenState(connection.id);
            const draftState = this.editorDrafts.get(connection.id);
            const dirty = draftState !== undefined && this.draftChanged(draftState);
            const usages = this.connectionUsages(connection);
            const incompleteIssues = this.customConnectionIssues(connection);
            const row = new Setting(this.root)
                .setName(connection.name)
                .setDesc(`${getProviderDefinition(connection.providerId)?.name ?? connection.providerId} · ${
                    this.text(`key.${state}`)
                } · ${usages}${incompleteIssues.length > 0 ? ` · ${this.text('customIncompleteSummary', {
                    issues: incompleteIssues.join(', '),
                })}` : ''}${dirty ? ` · ${this.text('unsavedChanges')}` : ''}`);
            row.addButton(button => {
                button.buttonEl.dataset.paConnection = connection.id;
                button.setButtonText(dirty ? this.text('continueEditing') : this.text('edit'))
                    .onClick(() => this.editor(connection));
            });
            row.addButton(button => button.setButtonText(this.text('delete'))
                .onClick(() => this.deletion(connection)));
        }
        const addAsset = this.button(this.text('add'), () => this.editor(undefined));
        addAsset.dataset.paAction = 'asset-add';
    }

    private connectionUsages(connection: AIConnection): string {
        const settings = this.configuration.getAIConnections();
        const values: string[] = [];
        if (settings?.defaultConnectionId === connection.id) values.push(this.text('default'));
        for (const purpose of PURPOSES) {
            const binding = settings?.bindings[purpose];
            if (binding?.mode === 'connection' && binding.connectionId === connection.id) {
                values.push(`${this.text(purpose)} · ${this.text('separate')}`);
            }
            else if (binding?.mode === 'inherit' && settings?.defaultConnectionId === connection.id) values.push(this.text(purpose));
        }
        return [...new Set(values)].join(', ') || this.text('unused');
    }

    private customConnectionIssues(connection: Partial<AIConnection>): string[] {
        if (connection.providerId !== 'custom') return [];
        const definition = getProviderDefinition('custom');
        const saved = this.configuration.getAIConnections();
        if (!saved) return [];
        const candidate: AIConnection = {
            ...createConnectionDefaults('custom'),
            ...connection,
            id: connection.id ?? '__pa-custom-preview__',
            name: connection.name?.trim() || 'Custom',
            endpoints: { ...(connection.endpoints ?? {}) },
            models: { ...(connection.models ?? {}) },
            options: { ...(connection.options ?? {}) },
            secretRef: connection.secretRef ?? '__pa-non-secret-preview__',
            secretOwned: connection.secretOwned ?? false,
            revision: connection.revision ?? 0,
        };
        const projectedConnections = [
            ...saved.connections.filter(item => item.id !== candidate.id),
            candidate,
        ];
        const issues: string[] = [];
        for (const purpose of PURPOSES) {
            if (definition?.adapters[purpose] === undefined) continue;
            const resolution = resolveAIConnection({
                ...saved,
                defaultConnectionId: candidate.id,
                connections: projectedConnections,
                bindings: {
                    ...saved.bindings,
                    [purpose]: { mode: 'connection', connectionId: candidate.id },
                },
            }, purpose);
            if (!resolution.ok) issues.push(`${this.text(purpose)}: ${this.text(`issue.${resolution.issue}`)}`);
        }
        return issues;
    }

    private async saveEditor(
        draftId: string,
        draftState: ConnectionEditorDraft,
        draft: AIConnection,
        baseline: AIConnection | undefined,
        key: string | undefined,
        usage: AIPurpose | 'default' | undefined,
        displayedPreview: AIConnectionCreationPreview | undefined,
        afterSave: (saved: AIConnection) => void,
    ): Promise<void> {
        const patch: AIConnectionPatch = baseline
            ? this.changedFields(draft, baseline)
            : draft;
        if (baseline) {
            const saved = await this.configuration.updateAIConnection(baseline.id, patch, key);
            afterSave(saved);
            return;
        }
        const input = draft as Parameters<PluginAIConfiguration['createAIConnection']>[0];
        let preview: PendingAIPreview;
        if (usage === undefined) {
            preview = {
                input: JSON.parse(JSON.stringify(input)) as AIConnectionCreationPreview['input'],
                usage: 'asset',
            };
        } else {
            if (displayedPreview === undefined) throw new Error('ai_connection:preview_missing');
            preview = displayedPreview;
        }
        const create = () => this.configuration.createAIConnection(input, key, usage, {
            initialSetup: this.options.isInitialSetup,
            ...(usage === undefined ? {} : { creationPreview: preview as AIConnectionCreationPreview }),
        });
        const saving = usage === undefined
            ? this.beginAssetCreation(
                draftId,
                JSON.parse(JSON.stringify(input)) as AIConnectionCreationPreview['input'],
                create,
            )
            : this.beginPending('creation', preview, create) as Promise<AIConnection>;
        draftState.creation = saving;
        try {
            const saved = await saving;
            draftState.created = saved;
            afterSave(saved);
        } finally {
            draftState.creation = undefined;
        }
    }

    private changedFields(draft: AIConnection, baseline: AIConnection): AIConnectionPatch {
        const models = Object.fromEntries(Object.entries(draft.models)
            .filter(([key, value]) => baseline.models[key as keyof AIConnection['models']] !== value));
        const chat = Object.fromEntries(Object.entries(draft.options.chat ?? {})
            .filter(([key, value]) => baseline.options.chat?.[key as keyof NonNullable<AIConnection['options']['chat']>] !== value));
        return {
            ...(draft.name !== baseline.name ? { name: draft.name } : {}),
            ...(Object.keys(models).length ? { models } : {}),
            ...(Object.keys(chat).length ? { options: { chat } } : {}),
        };
    }

    private editor(
        connection?: AIConnection,
        usage?: AIPurpose | 'default',
        returnTo?: () => void,
        repairProvider?: string,
    ): void {
        const draftId = connection?.id ?? `new:${repairProvider ?? usage ?? 'asset'}`;
        const retained = this.editorDrafts.get(draftId);
        const baseline = retained?.baseline ?? connection;
        let draft: Partial<AIConnection> = retained?.draft ?? (connection
            ? JSON.parse(JSON.stringify(connection)) as AIConnection
            : createConnectionDefaults(repairProvider ?? 'openai'));
        const draftState: ConnectionEditorDraft = retained ?? { draft, baseline };
        if (!connection && retained?.created && !retained.creation) {
            this.editorDrafts.delete(draftId);
            this.options.getAIAssetCreation?.(draftId)?.markResultRead();
            this.editor(retained.created, usage, returnTo);
            return;
        }
        if (!connection && !retained) {
            if (usage !== undefined) {
                const pending = this.pendingSelection();
                if (pending?.kind === 'creation' && pending.status === 'saving') {
                    const creationPreview = pending.preview as AIConnectionCreationPreview;
                    if (creationPreview.usage === usage) {
                    draft = JSON.parse(JSON.stringify(creationPreview.input)) as Partial<AIConnection>;
                    draftState.draft = draft;
                    draftState.creation = pending.promise as Promise<AIConnection>;
                    this.editorDrafts.set(draftId, draftState);
                    }
                }
            } else if (!repairProvider) {
                const asset = this.options.getAIAssetCreation?.(draftId) ?? null;
                if (asset?.status === 'saving') {
                    const assetPreview = asset.preview as PendingAIAssetCreationPreview;
                    draft = JSON.parse(JSON.stringify(assetPreview.input)) as Partial<AIConnection>;
                    draftState.draft = draft;
                    draftState.creation = asset.promise as Promise<AIConnection>;
                    this.editorDrafts.set(draftId, draftState);
                } else {
                    asset?.markResultRead();
                }
            }
        }
        let key = '';
        const returnToParent = returnTo ?? (() => this.restoreSubpage());

        if (!connection && draftState.creation) {
            this.openSubpage('editor', this.text('add'), () => {
                const pendingVersion = this.versionToken();
                const status = this.root.createEl('p', { text: this.text('saving'), attr: { role: 'status', 'aria-live': 'polite' } });
                const consumeAssetResult = () => {
                    this.options.getAIAssetCreation?.(draftId)?.markResultRead();
                };
                const actionRow = new Setting(this.root);
                actionRow.settingEl.addClass?.('pa-ai-connections-action');
                let actionControl: {
                    setButtonText(value: string): unknown;
                    setDisabled(value: boolean): unknown;
                } | undefined;
                actionRow.addButton(button => {
                    actionControl = button;
                    button.setButtonText(this.text('edit'));
                    button.setDisabled(true);
                    button.onClick(() => {
                        consumeAssetResult();
                        if (draftState.created) {
                            this.editorDrafts.delete(draftId);
                            this.editor(draftState.created, usage, returnToParent);
                        } else {
                            this.editor(undefined, usage, returnTo);
                        }
                    });
                });
                void draftState.creation!.then(saved => {
                    if (!this.root.isConnected || this.mode !== 'editor' || this.versionToken() !== pendingVersion) return;
                    draftState.created = saved;
                    draftState.creation = undefined;
                    status.textContent = saved.name;
                    actionControl?.setDisabled(false);
                }).catch(() => {
                    if (!this.root.isConnected || this.mode !== 'editor' || this.versionToken() !== pendingVersion) return;
                    draftState.creation = undefined;
                    status.textContent = this.text('saveFailed');
                    actionControl?.setButtonText(this.text('retry'));
                    actionControl?.setDisabled(false);
                });
            });
            return;
        }

        const retainDraft = () => {
            draftState.draft = JSON.parse(JSON.stringify(draft)) as AIConnection;
            this.editorDrafts.set(draftId, draftState);
        };
        const draw = () => {
            const activeElement = this.root.ownerDocument?.activeElement ?? null;
            const hadFocus = activeElement !== null && this.root.contains(activeElement);
            const activeId = this.root.ownerDocument?.activeElement?.id;
            this.clearRoot();
            this.mode = 'editor';
            this.root.dataset.paVersion = String(this.versionToken() + 1);
            if (this.options.onSubpageChange === undefined) {
                this.root.createEl('h3', {
                    text: connection
                        ? this.text('editTitle', { name: connection.name })
                        : this.text('add'),
                });
            }
            let secretInput: HTMLInputElement | null = null;
            this.clearSecretDraft = () => {
                key = '';
                if (secretInput) secretInput.value = '';
            };
            this.captureEditorDraft = retainDraft;

            const advanced = this.root.createEl('details', { cls: 'pa-settings-detail' });
            advanced.open = false;
            const advancedSummary = advanced.createEl('summary');
            this.decorateSummary(advancedSummary, this.text('advanced'));
            const advancedBody = advanced.createDiv({ cls: 'pa-settings-detail__body' });
            const endpointFields: Array<{ input: HTMLInputElement; error: HTMLElement }> = [];
            const validateEndpoints = () => {
                let firstInvalid: HTMLInputElement | undefined;
                for (const { input, error } of endpointFields) {
                    const invalid = Boolean(input.value.trim() && !isHttpEndpoint(input.value.trim()));
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
                    advanced.open = true;
                    firstInvalid.focus();
                }
                return !firstInvalid;
            };

            if (!connection) {
                new Setting(this.root).setName(this.text('provider')).addDropdown(dropdown => {
                    for (const definition of getProviderDefinitions()) dropdown.addOption(definition.id, definition.name);
                    dropdown.setValue(draft.providerId ?? 'openai').onChange(value => {
                        key = '';
                        draft = createConnectionDefaults(value);
                        draw();
                    });
                });
            } else {
                new Setting(this.root).setName(this.text('provider'))
                    .setDesc(getProviderDefinition(connection.providerId)?.name ?? connection.providerId);
            }

            new Setting(this.root).setName(this.text(connection ? 'newKey' : 'key')).setDesc(this.text('keyHelp'))
                .addText(input => {
                    input.inputEl.type = 'password';
                    input.inputEl.autocomplete = 'off';
                    input.inputEl.spellcheck = false;
                    input.inputEl.id = `pa-ai-key-${this.versionToken()}`;
                    secretInput = input.inputEl;
                    input.setValue('').onChange(value => { key = value; });
                });

            const definition = getProviderDefinition(draft.providerId ?? '');
            const commonBody = draft.providerId === 'custom' ? this.root : advancedBody;
            const models = draft.models ?? {};
            const endpoints = draft.endpoints ?? {};
            for (const purpose of PURPOSES) {
                const supported = definition?.adapters[purpose] !== undefined || models[purpose] !== undefined;
                if (!supported) {
                    if (purpose === 'image' && draft.providerId === 'custom') {
                        new Setting(commonBody).setName(this.text(`${purpose}Unavailable`))
                            .setDesc(this.text('customImageUnavailable'));
                    }
                    continue;
                }
                const modelParent = connection || draft.providerId === 'custom' ? this.root : advancedBody;
                new Setting(modelParent).setName(this.text(`${purpose}Model`)).addText(input => {
                    input.setValue(models[purpose] ?? '').onChange(value => {
                        draft.models = { ...draft.models, [purpose]: value };
                        updateImpact();
                    });
                });
                if (!connection) {
                    const endpointParent = draft.providerId === 'custom' ? this.root : advancedBody;
                    const row = new Setting(endpointParent)
                        .setName(this.text('endpoint', { purpose: this.text(purpose) }));
                    const error = row.settingEl.createEl('p', {
                        text: this.text('endpointInvalid'),
                        attr: { id: `pa-ai-endpoint-error-${this.versionToken()}-${purpose}` },
                    });
                    error.hidden = true;
                    row.addText(input => {
                        endpointFields.push({ input: input.inputEl, error });
                        input.setValue(endpoints[purpose] ?? '').onChange(value => {
                            draft.endpoints = { ...draft.endpoints, [purpose]: value };
                            input.inputEl.removeAttribute('aria-invalid');
                            input.inputEl.removeAttribute('aria-describedby');
                            error.hidden = true;
                            updateImpact();
                        });
                    });
                }
            }

            if (models.chat !== undefined || draft.providerId === 'custom') {
                new Setting(advancedBody).setName(this.text('policyModel')).addText(input => {
                    input.setValue(models.policy ?? '').onChange(value => {
                        draft.models = { ...draft.models, policy: value };
                        updateImpact();
                    });
                });
            }
            if (models.image !== undefined) {
                new Setting(advancedBody).setName(this.text('sourceImageModel')).addText(input => {
                    input.setValue(models.sourceImage ?? '').onChange(value => {
                        draft.models = { ...draft.models, sourceImage: value };
                        updateImpact();
                    });
                });
            }
            if (draft.providerId?.startsWith('dashscope-')) {
                for (const optionKey of ['enableThinking', 'webSearchEnabled']) {
                    new Setting(advancedBody).setName(this.text(optionKey)).addToggle(toggle => {
                        toggle.setValue(draft.options?.chat?.[optionKey] === true).onChange(value => {
                            draft.options = {
                                ...draft.options,
                                chat: { ...draft.options?.chat, [optionKey]: value },
                            };
                            updateImpact();
                        });
                    });
                }
            }

            new Setting(advancedBody).setName(this.text('name')).addText(input => {
                input.setValue(draft.name ?? '').setPlaceholder(this.text('automaticName'))
                    .onChange(value => {
                        draft.name = value;
                        refreshImpactDisplay();
                    });
            });

            if (connection) {
                for (const purpose of PURPOSES) {
                    if (definition?.adapters[purpose] === undefined && connection.models[purpose] === undefined) continue;
                    const row = new Setting(advancedBody).setName(this.text('endpoint', { purpose: this.text(purpose) }))
                        .setDesc(connection.endpoints[purpose]?.trim()
                            ? connection.endpoints[purpose]!
                            : this.text('unconfigured'));
                    if (!connection.endpoints[purpose] || !isHttpEndpoint(connection.endpoints[purpose]!)) {
                        row.addButton(button => button.setButtonText(this.text('addConnectionToChangeAddress'))
                            .onClick(() => {
                                retainDraft();
                                this.editor(undefined, undefined, () => this.renderOverview(), connection.providerId);
                            }));
                    }
                }
                this.root.createEl('p', { text: this.text('sharedModels'), cls: 'pa-settings-section-desc' });
            }

            this.root.appendChild(advanced);
            let previewState: AIConnectionCreationPreview | undefined;
            const impact = this.root.createEl('p', {
                cls: 'pa-settings-section-desc',
                attr: { 'aria-live': 'polite' },
            });
            const pendingConnectionName = () => draft.name?.trim()
                || getProviderDefinition(draft.providerId ?? '')?.name
                || draft.providerId
                || '';
            const refreshImpactDisplay = () => {
                if (previewState === undefined) return;
                impact.hidden = false;
                impact.textContent = this.describeCreationPreview(previewState, pendingConnectionName());
            };
            const updateImpact = () => {
                if (!usage) {
                    const incompleteIssues = this.customConnectionIssues(draft);
                    impact.hidden = incompleteIssues.length === 0;
                    impact.textContent = incompleteIssues.length === 0
                        ? ''
                        : this.text('customIncompleteSummary', { issues: incompleteIssues.join(', ') });
                    return;
                }
                if (connection) {
                    impact.hidden = true;
                    return;
                }
                try {
                    previewState = this.configuration.previewAIConnectionCreation(draft as AIConnection, usage);
                    refreshImpactDisplay();
                } catch {
                    previewState = undefined;
                    impact.hidden = false;
                    impact.textContent = this.text('invalid');
                }
            };
            updateImpact();

            const label = connection ? 'save' : usage === 'default' ? 'saveDefault' : usage ? 'savePurpose' : 'save';
            let saveInFlight = false;
            this.button(this.text(label, usage ? { purpose: this.text(usage) } : undefined), async () => {
                if (saveInFlight || !validateEndpoints()) return;
                const pageVersion = this.versionToken();
                saveInFlight = true;
                const controls = Array.from(this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'));
                controls.forEach(control => { control.disabled = true; });
                const status = this.root.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
                status.textContent = this.text('saving');
                const submittedDraft = JSON.stringify(draft);
                const patch: AIConnectionPatch = baseline
                    ? this.changedFields(draft as AIConnection, baseline)
                    : draft as AIConnectionPatch;
                try {
                    await this.saveEditor(
                        draftId,
                        draftState,
                        draft as AIConnection,
                        baseline,
                        key || undefined,
                        usage,
                        previewState,
                        saved => {
                        if (usage === 'default') this.ensureSelectionDraft().defaultId = saved.id;
                        else if (usage) this.ensureSelectionDraft().values[usage] = saved.id;
                        },
                    );
                    if (this.root.isConnected) this.options.onCommitted?.();
                    if (!this.editorDrafts.has(draftId)) retainDraft();
                    const retainedNow = this.editorDrafts.get(draftId);
                    const retainedByThisEditor = retainedNow !== undefined && retainedNow.baseline === baseline;
                    const unchangedRetainedDraft = retainedByThisEditor
                        && JSON.stringify(retainedNow.draft) === submittedDraft;
                    if (baseline) {
                        const savedConnection = this.configuration.getAIConnections()?.connections
                            .find(item => item.id === baseline.id);
                        const savedCurrent = savedConnection ?? baseline;
                        if (patch.name !== undefined) {
                            if (retainedByThisEditor && retainedNow.draft.name === patch.name) {
                                retainedNow.draft.name = savedCurrent.name;
                            }
                            baseline.name = savedCurrent.name;
                        }
                        if (patch.models) {
                            if (retainedByThisEditor) {
                                for (const [modelKey, submittedValue] of Object.entries(patch.models)) {
                                    if (retainedNow.draft.models?.[modelKey as keyof AIConnection['models']]
                                        === submittedValue) {
                                        retainedNow.draft.models[modelKey as keyof AIConnection['models']] =
                                            savedCurrent.models[modelKey as keyof AIConnection['models']];
                                    }
                                }
                            }
                            baseline.models = { ...savedCurrent.models };
                        }
                        if (patch.options?.chat) {
                            if (retainedByThisEditor) {
                                for (const [optionKey, submittedValue] of Object.entries(patch.options.chat)) {
                                    if (retainedNow.draft.options?.chat?.[optionKey as keyof NonNullable<
                                        AIConnection['options']['chat']>] === submittedValue) {
                                        const currentOptions = retainedNow.draft.options ?? {};
                                        currentOptions.chat = {
                                            ...currentOptions.chat,
                                            [optionKey]: savedCurrent.options.chat?.[optionKey as keyof NonNullable<
                                                AIConnection['options']['chat']>],
                                        };
                                        retainedNow.draft.options = currentOptions;
                                    }
                                }
                            }
                            baseline.options.chat = { ...savedCurrent.options.chat };
                        }
                    }
                    if (unchangedRetainedDraft) {
                        this.editorDrafts.delete(draftId);
                    }
                    if (this.root.isConnected && this.mode === 'editor' && this.versionToken() === pageVersion) {
                        returnToParent();
                    }
                } catch (error) {
                    const code = (error as { code?: string }).code;
                    if (code === 'ai_connection:preview_changed') {
                        const refreshedPreview = (error as { preview?: AIConnectionCreationPreview }).preview;
                        if (refreshedPreview) {
                            previewState = refreshedPreview;
                            refreshImpactDisplay();
                        }
                        status.textContent = this.text('previewChanged');
                    } else {
                        status.setAttribute('role', 'alert');
                        status.textContent = this.text('saveFailed');
                    }
                    if (this.root.isConnected && this.mode === 'editor' && this.versionToken() === pageVersion) {
                        controls.forEach(control => { control.disabled = false; });
                    }
                } finally {
                    saveInFlight = false;
                }
            }, { primary: true });

            if (connection) {
                let removeKeyInFlight = false;
                this.button(this.text('removeKey'), async () => {
                    if (removeKeyInFlight) return;
                    const pageVersion = this.versionToken();
                    removeKeyInFlight = true;
                    try {
                        if (!await confirmUserAction(this.options.app, {
                            title: this.text('removeKey'),
                            message: this.text('removeKeyHelp'),
                            confirmText: this.text('removeKey'),
                        })) return;
                        await this.configuration.removeAIConnectionKey(connection.id);
                        if (this.root.isConnected) this.options.onCommitted?.();
                        if (this.root.isConnected && this.mode === 'editor' && this.versionToken() === pageVersion) {
                            this.editorDrafts.delete(draftId);
                            this.renderOverview();
                        }
                    } catch {
                        this.root.createEl('p', { text: this.text('saveFailed'), attr: { role: 'alert' } });
                    } finally {
                        removeKeyInFlight = false;
                    }
                });
            }
            this.button(this.text('cancel'), () => {
                this.editorDrafts.delete(draftId);
                returnToParent();
            });
            if (hadFocus) {
                const target = activeId ? this.root.querySelector<HTMLElement>(`#${activeId}`) : null;
                target?.focus({ preventScroll: true });
            }
        };
        this.openSubpage('editor', connection ? this.text('editTitle', { name: connection.name }) : this.text('add'), draw);
    }

    private deletion(connection: AIConnection): void {
        const settings = this.configuration.getAIConnections();
        if (!settings) return;
        this.openSubpage('deletion', this.text('delete'), () => {
            this.root.createEl('p', { text: this.text('deleteHelp', { name: connection.name }) });
            const effectivePurposes = PURPOSES.filter(purpose => {
                const effective = resolveAIConnection(settings, purpose);
                return effective.ok && effective.connection.connectionId === connection.id;
            });
            this.root.createEl('p', { text: this.text('affected', {
                purposes: effectivePurposes.map(purpose => this.text(purpose)).join(', ') || this.text('unused'),
            }) });
            if (this.options.getConnectionTaskCount) {
                const version = this.versionToken();
                const tasks = this.root.createEl('p', { text: this.text('tasksChecking') });
                void this.options.getConnectionTaskCount(connection.id).then(count => {
                    if (version !== this.versionToken() || !this.root.isConnected) return;
                    tasks.textContent = count === undefined ? this.text('tasksUnknown') : this.text('tasksAffected', { count });
                }).catch(() => {
                    if (version === this.versionToken() && this.root.isConnected) tasks.textContent = this.text('tasksUnknown');
                });
            }
            const replacement: Parameters<PluginAIConfiguration['deleteAIConnection']>[1] = { bindings: {} };
            const affected = PURPOSES.filter(purpose => settings.bindings[purpose].mode === 'connection'
                && settings.bindings[purpose].connectionId === connection.id);
            const replaceRow = (name: string, onChange: (value: string) => void) => {
                new Setting(this.root).setName(name).addDropdown(dropdown => {
                    dropdown.addOption('', this.text('unconfigured'));
                    for (const other of settings.connections) {
                        if (other.id !== connection.id) dropdown.addOption(other.id, other.name);
                    }
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
            this.button(this.text('delete'), async () => {
                const pageVersion = this.versionToken();
                await this.configuration.deleteAIConnection(connection.id, replacement);
                if (this.root.isConnected) this.options.onCommitted?.();
                if (this.root.isConnected && this.mode === 'deletion' && this.versionToken() === pageVersion) {
                    this.renderOverview();
                }
            }, { primary: true });
            this.button(this.text('cancel'), () => this.renderOverview());
        });
    }

    private migration(): void {
        this.openSubpage('migration', this.text('migrate'), () => {
            this.root.createEl('p', { text: this.text('migrationHelp') });
            let providerId = 'openai';
            let secretRef: string | undefined;
            new Setting(this.root).setName(this.text('provider')).addDropdown(dropdown => {
                for (const definition of getProviderDefinitions()) dropdown.addOption(definition.id, definition.name);
                dropdown.setValue(providerId).onChange(value => { providerId = value; });
            });
            let choices: Array<{ id: string; label: string }>;
            try {
                choices = this.options.legacyCredentials();
            } catch {
                this.root.createEl('p', { text: this.text('legacyListFailed'), attr: { role: 'alert' } });
                this.button(this.text('retry'), () => this.migration(), { primary: true });
                return;
            }
            if (choices.length) {
                secretRef = choices[0].id;
                new Setting(this.root).setName(this.text('savedKey')).addDropdown(dropdown => {
                    for (const choice of choices) dropdown.addOption(choice.id, choice.label);
                    dropdown.setValue(secretRef!).onChange(value => { secretRef = value; });
                });
            }
            this.button(this.text('migrate'), async () => {
                const pageVersion = this.versionToken();
                await this.configuration.migrateLegacyAIConnections({ providerId, secretRef });
                if (this.root.isConnected) this.options.onCommitted?.();
                if (this.root.isConnected && this.mode === 'migration' && this.versionToken() === pageVersion) {
                    this.renderOverview();
                }
            }, { primary: true });
            this.button(this.text('cancel'), () => this.renderOverview());
        });
    }
}

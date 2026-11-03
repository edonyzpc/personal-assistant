import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { App } from 'obsidian';
import { installObsidianDocumentHelpers } from './helpers/obsidian-dom';
import {
    AIConnectionsSettingsView,
    type AIConnectionsSettingsOptions,
    type PendingAISelection,
} from '../src/components/ai-connections-settings';
import type { PluginAIConfiguration } from '../src/ai-services/plugin-configuration';
import type {
    AIConnectionCreationPreview,
    AIConnectionSelectionPreview,
    AIConnectionSelectionResult,
} from '../src/ai-services/plugin-configuration';
import type { AIConnection, AIConnectionsSettings, AIPurpose, PurposeBinding } from '../src/ai-services/ai-connection-types';
import { createConnectionDefaults } from '../src/ai-services/provider-definitions';
import { resolveAIConnection } from '../src/ai-services/ai-connection-resolver';
import {
    applyNormalizedSelectionPatch,
    createCreationPreview,
    createSelectionPreview,
} from '../src/ai-services/ai-connection-selection';
import { pluginT, type PluginTranslator } from '../src/locales/plugin';
import type { MemoryMaintenancePlan } from '../src/memory-manager';

type NativeTestWindow = Window & { HTMLElement: typeof HTMLElement; Event: typeof Event; close(): void };
type NativeTestDOM = { window: NativeTestWindow };
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => NativeTestDOM };

const mockButtonActions = new WeakMap<HTMLButtonElement, Promise<unknown>>();

// Native DOM provides connection/focus/control lifetime semantics. This small
// bridge supplies only Obsidian Setting's fluent controls, as in settings.test.
jest.mock('obsidian', () => ({
    setIcon: jest.fn(),
    Setting: class {
        readonly settingEl: HTMLElement;
        constructor(container: HTMLElement) {
            this.settingEl = container.ownerDocument.createElement('div');
            container.appendChild(this.settingEl);
        }
        setName(name: string) { this.settingEl.dataset.name = name; return this; }
        setDesc(description: string) { this.settingEl.dataset.description = description; return this; }
        addButton(callback: (control: unknown) => void) {
            const el = this.settingEl.ownerDocument.createElement('button');
            this.settingEl.appendChild(el);
            let disabled = false;
            const control = {
                buttonEl: el,
                setButtonText: (value: string) => { el.textContent = value; return control; },
                setTooltip: (value: string) => { el.setAttribute('aria-label', value); return control; },
                setCta: () => control,
                setDisabled: (value: boolean) => { disabled = value; el.disabled = value; return control; },
                onClick: (action: () => unknown) => {
                    el.addEventListener('click', () => {
                        if (disabled) return;
                        mockButtonActions.set(el, Promise.resolve(action()));
                    });
                    return control;
                },
            };
            callback(control);
            return this;
        }
        addDropdown(callback: (control: unknown) => void) {
            const el = this.settingEl.ownerDocument.createElement('select');
            this.settingEl.appendChild(el);
            const control = {
                selectEl: el,
                addOption: (value: string, text: string) => {
                    const option = el.ownerDocument.createElement('option');
                    option.value = value; option.textContent = text; el.appendChild(option); return control;
                },
                setValue: (value: string) => { el.value = value; return control; },
                onChange: (action: (value: string) => unknown) => {
                    el.addEventListener('change', () => { void action(el.value); }); return control;
                },
            };
            callback(control);
            return this;
        }
        addText(callback: (control: unknown) => void) {
            const inputEl = this.settingEl.ownerDocument.createElement('input');
            this.settingEl.appendChild(inputEl);
            const control = {
                inputEl,
                setValue: (value: string) => { inputEl.value = value; return control; },
                setPlaceholder: (value: string) => { inputEl.placeholder = value; return control; },
                onChange: (action: (value: string) => unknown) => {
                    inputEl.addEventListener('input', () => { void action(inputEl.value); }); return control;
                },
            };
            callback(control);
            return this;
        }
    },
}));

jest.mock('../src/confirm', () => ({ confirmUserAction: jest.fn(async () => true) }));

const translate: PluginTranslator = (key, params, fallback) => pluginT(key, 'en', params, fallback);
const label = (key: string) => translate(`plugin.settings.connections.${key}`);

type NativeCreationOptions = { text?: string; cls?: string; attr?: Record<string, string> };

function installNativeHelpers(window: NativeTestWindow): void {
    const prototype = window.HTMLElement.prototype;
    Object.assign(prototype, {
        empty(this: HTMLElement) { this.replaceChildren(); },
        setText(this: HTMLElement, value: string) { this.textContent = value; },
        addClass(this: HTMLElement, value: string) { this.classList.add(value); return this; },
        createEl(this: HTMLElement, tag: string, options: NativeCreationOptions = {}) {
            const el = this.ownerDocument.createElement(tag);
            if (options.text) el.textContent = options.text;
            if (options.cls) el.className = options.cls;
            for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
            this.appendChild(el);
            return el;
        },
        createDiv(this: HTMLElement, options: NativeCreationOptions) { return this.createEl('div', options); },
    });
    installObsidianDocumentHelpers(window.document);
}

function field<T extends HTMLInputElement | HTMLSelectElement>(root: HTMLElement, name: string, tag: 'input' | 'select'): T {
    const row = Array.from(root.querySelectorAll<HTMLElement>('[data-name]')).find(element => element.dataset.name === name);
    const control = row?.querySelector<T>(tag);
    if (!control) throw new Error(`Missing field: ${name}`);
    return control;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
    const match = Array.from(root.querySelectorAll('button')).find(element => element.textContent === text);
    if (!match) throw new Error(`Missing button: ${text}`);
    return match;
}

async function press(root: HTMLElement, text: string): Promise<void> {
    const target = button(root, text);
    target.focus();
    target.click();
    await mockButtonActions.get(target);
}

describe('AI connections Settings interactions', () => {
    let dom: NativeTestDOM;
    let root: HTMLElement;
    const originalFetch = globalThis.fetch;
    const request = jest.fn(async () => { throw new Error('This UI must not send provider requests.'); });

    beforeEach(() => {
        dom = new JSDOM('<!doctype html><body></body>');
        installNativeHelpers(dom.window);
        root = dom.window.document.createElement('div');
        dom.window.document.body.appendChild(root);
        globalThis.fetch = request as typeof fetch;
    });

    afterEach(() => {
        root.remove();
        dom.window.close();
        globalThis.fetch = originalFetch;
    });

    const setup = (memoryPlan: MemoryMaintenancePlan = {
        reason: 'ready', action: 'none', notesToCheck: 1, requiresApproval: false, canAnswerNow: true,
    }, memoryOptions: Pick<AIConnectionsSettingsOptions, 'isMemoryEnabled' | 'memoryAction'> = {}) => {
        const settings: AIConnectionsSettings = {
            schemaVersion: 1,
            connections: [
                { ...createConnectionDefaults('openai'), id: 'work', name: 'Work', providerId: 'openai', secretRef: 'work-key', revision: 0 },
                { ...createConnectionDefaults('openai'), id: 'personal', name: 'Personal', providerId: 'openai', secretRef: 'personal-key', revision: 0 },
            ],
            defaultConnectionId: 'work',
            bindings: { chat: { mode: 'connection', connectionId: 'personal' }, embedding: { mode: 'inherit' }, image: { mode: 'inherit' } },
            memorySelection: { revision: 'saved', cause: 'configuration-change' }, migrationVersion: 1,
        };
        const secretStorage = { getSecret: jest.fn(), setSecret: jest.fn(), listSecrets: jest.fn(() => []) };
        let pending: PendingAISelection | null = null;
        const assetCreations = new Map<string, PendingAISelection>();
        const configuration = {
            getAIConnections: jest.fn(() => JSON.parse(JSON.stringify(settings)) as AIConnectionsSettings),
            previewAIConnectionName: jest.fn((name: string) => name),
            resolveAIConnection: jest.fn((purpose: AIPurpose) => resolveAIConnection(settings, purpose)),
            previewAIConnectionSelection: jest.fn((patch: Parameters<typeof createSelectionPreview>[1]) =>
                createSelectionPreview(settings, patch)),
            setAIConnectionSelection: jest.fn<PluginAIConfiguration['setAIConnectionSelection']>(
                async preview => {
                const normalized = applyNormalizedSelectionPatch(settings, preview.patch);
                settings.defaultConnectionId = normalized.defaultConnectionId;
                settings.bindings = normalized.bindings;
                return { status: 'applied' as const };
                },
            ),
            previewAIConnectionCreation: jest.fn((input: Parameters<PluginAIConfiguration['createAIConnection']>[0],
                usage: 'default' | AIPurpose) => {
                return createCreationPreview(settings, input, usage);
            }),
            getAIConnectionTokenState: jest.fn(() => 'unknown'),
            getAIConnectionToken: jest.fn(async () => { secretStorage.getSecret(); return ''; }),
            setAIPurposeBinding: jest.fn(async (purpose: AIPurpose, binding: PurposeBinding) => { settings.bindings[purpose] = binding; }),
            setDefaultAIConnection: jest.fn(async (id: string | null) => { settings.defaultConnectionId = id; }),
            createAIConnection: jest.fn<PluginAIConfiguration['createAIConnection']>(async (input, _key, usage) => {
                const created = { ...createConnectionDefaults(input.providerId), ...input,
                    id: `created-${settings.connections.length}`, name: input.name ?? 'Created',
                    secretRef: `created-${settings.connections.length}`, revision: 0 } as AIConnection;
                settings.connections.push(created);
                if (usage === 'default') settings.defaultConnectionId = created.id;
                else if (usage) settings.bindings[usage] = { mode: 'connection', connectionId: created.id };
                return JSON.parse(JSON.stringify(created)) as AIConnection;
            }),
            updateAIConnection: jest.fn<PluginAIConfiguration['updateAIConnection']>(async id =>
                JSON.parse(JSON.stringify(settings.connections.find(connection => connection.id === id))) as AIConnection),
            removeAIConnectionKey: jest.fn(async () => undefined),
            deleteAIConnection: jest.fn(async () => undefined),
            migrateLegacyAIConnections: jest.fn(async () => JSON.parse(JSON.stringify(settings)) as AIConnectionsSettings),
        };
        const legacyCredentials = jest.fn(() => []);
        const onCommitted = jest.fn();
        const options: AIConnectionsSettingsOptions = {
            app: { secretStorage } as unknown as App,
            configuration: configuration as unknown as PluginAIConfiguration,
            translate, isInitialSetup: false, legacyCredentials, onCommitted,
            getMemoryPlan: async () => memoryPlan,
            getPendingAISelection: () => pending,
            getAIAssetCreation: key => assetCreations.get(key) ?? null,
            beginAIAssetCreation: ({ key, input, operation }) => {
                const existing = assetCreations.get(key);
                if (existing?.status === 'saving') return existing;
                const state: PendingAISelection = {
                    kind: 'creation',
                    preview: { input: JSON.parse(JSON.stringify(input)), usage: 'asset' },
                    status: 'saving',
                    promise: Promise.resolve(),
                    markResultRead: () => {
                        if (assetCreations.get(key) === state && state.status !== 'saving') {
                            assetCreations.delete(key);
                        }
                    },
                };
                state.promise = operation().then(result => {
                    if (assetCreations.get(key) === state) state.status = 'applied';
                    return result;
                }).catch(error => {
                    if (assetCreations.get(key) === state) state.status = 'failed';
                    throw error;
                });
                assetCreations.set(key, state);
                return state;
            },
            beginAISelection: ({ kind, preview, operation }) => {
                const state: PendingAISelection = {
                    kind,
                    preview,
                    status: 'saving',
                    promise: Promise.resolve(),
                    markResultRead: () => {
                        if (pending === state && state.status !== 'saving') pending = null;
                    },
                };
                state.promise = operation().then(result => {
                    if (pending === state) {
                        state.status = (result as { status?: string } | null | undefined)?.status === 'preview-changed'
                            ? 'preview-changed' : 'applied';
                    }
                    return result;
                }).catch(error => {
                    if (pending === state) state.status = 'failed';
                    throw error;
                });
                pending = state;
                return state;
            },
            ...memoryOptions,
        };
        const view = new AIConnectionsSettingsView(root, options);
        return { view, settings, configuration, secretStorage, legacyCredentials, onCommitted,
            getPending: () => pending, options };
    };

    it('renders saved selections and connections without reading secrets or making requests', async () => {
        const { view, configuration, secretStorage, legacyCredentials } = setup();
        view.render();
        await Promise.resolve();
        expect(field<HTMLSelectElement>(root, label('default'), 'select').value).toBe('work');
        expect(root.textContent).toContain('Work');
        expect(root.textContent).toContain(label('savedConnections'));
        expect(configuration.getAIConnectionTokenState).toHaveBeenCalled();
        expect(configuration.getAIConnectionToken).not.toHaveBeenCalled();
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(legacyCredentials).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it('syncs untouched selections after an external default replacement', async () => {
        const { view, settings } = setup();
        settings.connections.push({ ...createConnectionDefaults('openai'), id: 'team',
            name: 'Team', providerId: 'openai', secretRef: 'team-key', revision: 0 });
        view.render();
        const defaultSelection = field<HTMLSelectElement>(root, label('default'), 'select');
        expect(defaultSelection.value).toBe('work');
        defaultSelection.value = 'personal';
        defaultSelection.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        defaultSelection.value = 'work';
        defaultSelection.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        expect(Array.from(root.querySelectorAll('button'))
            .some(item => item.textContent === label('applySelection'))).toBe(false);

        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'work';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        chat.value = 'personal';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        expect(Array.from(root.querySelectorAll('button'))
            .some(item => item.textContent === label('applySelection'))).toBe(false);

        settings.connections = settings.connections.filter(connection => connection.id !== 'work');
        settings.defaultConnectionId = 'team';
        view.render();

        expect(field<HTMLSelectElement>(root, label('default'), 'select').value).toBe('team');
        expect(field<HTMLSelectElement>(root, label('chat'), 'select').value).toBe('personal');
        expect(root.querySelector('[role="alert"]')).toBeNull();
        expect(Array.from(root.querySelectorAll('button'))
            .some(item => item.textContent === label('applySelection'))).toBe(false);
    });

    it('summarizes explicit independent and unconfigured purposes while collapsed', () => {
        const { view, settings } = setup();
        settings.bindings.chat = { mode: 'connection', connectionId: 'work' };
        settings.bindings.image = { mode: 'unconfigured' };
        view.render();

        const summary = root.querySelector('details.pa-ai-connections-purposes summary');
        expect(summary?.textContent).toContain(`Chat · Work · ${label('separate')}`);
        expect(summary?.textContent).toContain(`Images · ${label('unconfigured')}`);
        expect(summary?.textContent).not.toContain('Note retrieval');

        settings.bindings = {
            chat: { mode: 'inherit' },
            embedding: { mode: 'inherit' },
            image: { mode: 'inherit' },
        };
        view.render();
        const inheritedSummary = root.querySelector('details.pa-ai-connections-purposes summary');
        expect(inheritedSummary?.textContent).toContain(
            pluginT('plugin.settings.connections.summary.allInherit', 'en', { name: 'Work' }),
        );
        expect(inheritedSummary?.textContent).not.toContain(label('separate'));
    });

    it('keeps remaining selection intents when a touched target disappears', () => {
        const { view, settings } = setup();
        view.render();
        const defaultSelection = field<HTMLSelectElement>(root, label('default'), 'select');
        defaultSelection.value = 'personal';
        defaultSelection.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'work';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        settings.connections = settings.connections.filter(connection => connection.id !== 'personal');
        settings.defaultConnectionId = 'work';
        view.render();

        expect(root.querySelector('[role="alert"]')?.textContent).toBe(label('invalid'));
        expect(field<HTMLSelectElement>(root, label('chat'), 'select').value).toBe('work');
        expect(field<HTMLSelectElement>(root, label('embedding'), 'select').value).toBe('inherit');
    });

    it('shows a new Memory configuration as needing preparation even when Chat can answer immediately', async () => {
        const { view } = setup({ reason: 'settings-changed', action: 'rebuild', notesToCheck: 1,
            requiresApproval: true, canAnswerNow: true });
        view.render();
        await Promise.resolve();
        expect(root.textContent).toContain(label('memoryNeedsPrepare'));
        expect(root.textContent).not.toContain(label('memoryPending'));
    });

    it('refreshes Memory without replacing an open connection draft or moving focus', async () => {
        let enabled = false;
        const { view } = setup({ reason: 'settings-changed', action: 'rebuild', notesToCheck: 1,
            requiresApproval: true, canAnswerNow: true }, { isMemoryEnabled: () => enabled,
            memoryAction: jest.fn<NonNullable<AIConnectionsSettingsOptions['memoryAction']>>(async () => undefined) });
        view.render();
        await Promise.resolve();
        expect(root.textContent).not.toContain(label('memoryNeedsPrepare'));
        const edit = button(root, label('edit'));
        edit.focus();
        await press(root, label('edit'));
        const key = field<HTMLInputElement>(root, label('newKey'), 'input');
        key.value = 'unsaved-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        key.focus();
        enabled = true;
        view.refreshOverview();
        expect(field<HTMLInputElement>(root, label('newKey'), 'input')).toBe(key);
        expect(key.value).toBe('unsaved-key');
        expect(dom.window.document.activeElement).toBe(key);
        view.back();
        enabled = false;
        view.refreshOverview();
        await Promise.resolve();
        expect(root.textContent).not.toContain(label('memoryNeedsPrepare'));
    });

    it('previews and applies a semantic purpose change without invoking legacy setters', async () => {
        const { view, configuration, settings, onCommitted } = setup();
        settings.defaultConnectionId = 'personal';
        view.render();
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'inherit';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const impactPreview = root.querySelector<HTMLElement>('.pa-settings-connection-preview');
        expect(impactPreview?.textContent).toContain('Personal · openai');
        expect(configuration.setAIPurposeBinding).not.toHaveBeenCalled();
        expect(configuration.setDefaultAIConnection).not.toHaveBeenCalled();
        expect(root.textContent).toContain(label('semanticInherit'));
        const image = field<HTMLSelectElement>(root, label('image'), 'select');
        image.value = 'work';
        image.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const updatedPreview = root.querySelector<HTMLElement>('.pa-settings-connection-preview');
        expect(updatedPreview?.textContent).toContain('Personal · openai');
        expect(updatedPreview?.textContent).toContain('Work · openai');
        await press(root, label('applySelection'));
        expect(configuration.setAIConnectionSelection).toHaveBeenCalledTimes(1);
        expect(settings.bindings.chat).toEqual({ mode: 'inherit' });
        expect(onCommitted).toHaveBeenCalledTimes(1);
    });

    it('keeps a purpose-scoped addition separate and cancels without saving its Key', async () => {
        const { view, configuration, secretStorage, settings } = setup();
        view.render();
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'work';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const chatAdd = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
            .find(item => item.dataset.paPurpose === 'chat' && item.dataset.paSelectionAction === 'add')!;
        chatAdd.focus();
        chatAdd.click();
        await mockButtonActions.get(chatAdd);
        const key = field<HTMLInputElement>(root, label('key'), 'input');
        key.value = 'unsaved-test-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        await press(root, label('cancel'));
        const restoredChatAdd = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
            .find(item => item.dataset.paPurpose === 'chat' && item.dataset.paSelectionAction === 'add')!;
        expect(dom.window.document.activeElement).toBe(restoredChatAdd);
        expect(field<HTMLSelectElement>(root, label('chat'), 'select').value).toBe('work');
        expect(configuration.createAIConnection).not.toHaveBeenCalled();
        expect(configuration.setAIConnectionSelection).not.toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(settings.bindings.chat).toEqual({ mode: 'connection', connectionId: 'personal' });
    });

    it('retains a failed connection draft and clears the Key DOM when returning', async () => {
        const { view, configuration } = setup();
        view.render();
        await press(root, label('edit'));
        const name = field<HTMLInputElement>(root, label('name'), 'input');
        name.value = 'Edited work';
        name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const key = field<HTMLInputElement>(root, label('newKey'), 'input');
        key.value = 'replacement-test-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        configuration.updateAIConnection.mockRejectedValueOnce(new Error('storage unavailable'));
        await press(root, label('save'));
        expect(field<HTMLInputElement>(root, label('name'), 'input').value).toBe('Edited work');
        expect(root.querySelector('[role="alert"]')?.textContent).toBe(label('saveFailed'));
        view.back();
        expect(root.querySelector('input[type="password"]')).toBeNull();
        await press(root, label('continueEditing'));
        expect(field<HTMLInputElement>(root, label('name'), 'input').value).toBe('Edited work');
        expect(field<HTMLInputElement>(root, label('newKey'), 'input').value).toBe('');
    });

    it('keeps common model fields directly editable and does not submit them with a selection', async () => {
        const { view, configuration } = setup();
        view.render();
        await press(root, label('edit'));
        const model = field<HTMLInputElement>(root, label('chatModel'), 'input');
        model.value = 'draft-model';
        model.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        view.back();
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'inherit';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        await press(root, label('applySelection'));
        expect(configuration.setAIConnectionSelection).toHaveBeenCalledTimes(1);
        expect(configuration.updateAIConnection).not.toHaveBeenCalled();
        const workRow = Array.from(root.querySelectorAll<HTMLElement>('[data-name="Work"]'))[0];
        expect(workRow.dataset.description).toContain(label('unsavedChanges'));
        expect(button(root, label('continueEditing'))).toBeDefined();
    });

    it('rebases a late model save without resending it with a newer name draft', async () => {
        const { view, configuration, settings } = setup();
        view.render();
        const editWork = async () => press(root, label('edit'));
        await editWork();
        const model = field<HTMLInputElement>(root, label('chatModel'), 'input');
        model.value = 'first-saved-model';
        model.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        let finish!: () => void;
        configuration.updateAIConnection.mockImplementationOnce(() => new Promise<AIConnection>(resolve => {
            finish = () => resolve(JSON.parse(JSON.stringify({
                ...settings.connections[0], models: { ...settings.connections[0].models, chat: 'first-saved-model' },
            })) as AIConnection);
        }));
        const saving = press(root, label('save'));
        view.back();
        await editWork();
        const name = field<HTMLInputElement>(root, label('name'), 'input');
        name.value = 'Newer name draft';
        name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        view.back();
        settings.connections[0].models.chat = 'first-saved-model';
        finish();
        await saving;
        await press(root, label('continueEditing'));
        const key = field<HTMLInputElement>(root, label('newKey'), 'input');
        key.value = 'replacement-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        await press(root, label('save'));
        expect(configuration.updateAIConnection).toHaveBeenLastCalledWith('work', { name: 'Newer name draft' }, 'replacement-key');
    });

    it('submits the creation preview actually displayed instead of a fresh baseline', async () => {
        const { view, configuration } = setup();
        view.render();
        const imageAdd = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
            .find(item => item.dataset.paPurpose === 'image' && item.dataset.paSelectionAction === 'add')!;
        imageAdd.click();
        await mockButtonActions.get(imageAdd);
        const displayedPreview = (
            configuration.previewAIConnectionCreation.mock.results.at(-1)?.value
        ) as AIConnectionCreationPreview | undefined;
        if (!displayedPreview) throw new Error('Missing displayed creation preview');
        expect(displayedPreview).toBeDefined();
        expect(root.textContent).toContain('gpt-image-2.5-flare');
        const name = field<HTMLInputElement>(root, label('name'), 'input');
        name.value = 'Draft image connection';
        name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const displayedImpact = root.querySelector<HTMLElement>('p.pa-settings-section-desc[aria-live="polite"]');
        expect(displayedImpact?.textContent).toContain('Draft image connection');
        configuration.previewAIConnectionCreation.mockImplementationOnce(() => ({
            ...displayedPreview,
            impact: { purposes: [] },
        }));
        configuration.createAIConnection.mockResolvedValueOnce({ ...createConnectionDefaults('openai'),
            id: 'created', name: 'Created', secretRef: 'created-key', revision: 0 });

        await press(root, translate('plugin.settings.connections.savePurpose', { purpose: label('image') }));

        expect(configuration.createAIConnection).toHaveBeenCalledWith(
            expect.anything(),
            undefined,
            'image',
            expect.objectContaining({ creationPreview: displayedPreview }),
        );
    });

    it('captures a non-secret draft on deactivation and clears the password DOM', async () => {
        const { view } = setup();
        view.render();
        await press(root, label('edit'));
        const name = field<HTMLInputElement>(root, label('name'), 'input');
        name.value = 'External jump draft';
        name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const key = field<HTMLInputElement>(root, label('newKey'), 'input');
        key.value = 'private-draft';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

        view.deactivate();
        view.render();
        await press(root, label('continueEditing'));

        expect(field<HTMLInputElement>(root, label('name'), 'input').value).toBe('External jump draft');
        expect(field<HTMLInputElement>(root, label('newKey'), 'input').value).toBe('');
    });

    it('does not replace a newer connection editor when an older save completes late', async () => {
        const { view, configuration, settings } = setup();
        view.render();
        await press(root, label('edit'));
        let finishA!: () => void;
        configuration.updateAIConnection.mockImplementationOnce(() => new Promise<AIConnection>(resolve => {
            finishA = () => resolve(JSON.parse(JSON.stringify(settings.connections[0])) as AIConnection);
        }));
        const savingA = press(root, label('save'));
        view.back();
        const personal = Array.from(root.querySelectorAll<HTMLElement>('[data-name="Personal"]'))[0];
        const editPersonal = Array.from(personal.querySelectorAll('button'))
            .find(item => item.textContent === label('edit'))!;
        editPersonal.click();
        await mockButtonActions.get(editPersonal);
        const newerName = field<HTMLInputElement>(root, label('name'), 'input');
        newerName.value = 'Newer editor';
        newerName.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

        finishA();
        await savingA;

        expect(root.querySelector('h3')?.textContent)
            .toBe(translate('plugin.settings.connections.editTitle', { name: 'Personal' }));
        expect(field<HTMLInputElement>(root, label('name'), 'input').value).toBe('Newer editor');
    });

    it('keeps a newer model draft when an older model save finishes late', async () => {
        const { view, configuration, settings } = setup();
        view.render();
        await press(root, label('edit'));
        const model = field<HTMLInputElement>(root, label('chatModel'), 'input');
        model.value = 'first-model';
        model.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        let finish!: () => void;
        configuration.updateAIConnection.mockImplementationOnce(() => new Promise<AIConnection>(resolve => {
            finish = () => resolve(JSON.parse(JSON.stringify({
                ...settings.connections[0], models: { ...settings.connections[0].models, chat: 'first-model' },
            })) as AIConnection);
        }));
        const saving = press(root, label('save'));
        view.back();
        await press(root, label('continueEditing'));
        const newerModel = field<HTMLInputElement>(root, label('chatModel'), 'input');
        newerModel.value = 'newer-model';
        newerModel.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        view.back();
        settings.connections[0].models.chat = 'first-model';
        finish();
        await saving;
        await press(root, label('continueEditing'));
        const key = field<HTMLInputElement>(root, label('newKey'), 'input');
        key.value = 'replacement-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        await press(root, label('save'));
        expect(configuration.updateAIConnection).toHaveBeenLastCalledWith(
            'work',
            { models: { chat: 'newer-model' } },
            'replacement-key',
        );
    });

    it('locks and retains one pending selection across return and re-entry', async () => {
        const { view, configuration, getPending } = setup();
        view.render();
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'inherit';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        let finish!: () => void;
        configuration.setAIConnectionSelection.mockImplementationOnce(() => new Promise(resolve => {
            finish = () => resolve({ status: 'applied' as const });
        }));
        const applying = press(root, label('applySelection'));
        expect(root.textContent).toContain(label('saving'));
        expect(button(root, label('applySelection')).disabled).toBe(true);
        expect(button(root, label('cancelSelection')).disabled).toBe(true);
        view.back();
        expect(root.textContent).toContain(label('savedConnections'));
        view.focusSelectionTarget('chat');
        expect(root.textContent).toContain(label('saving'));
        finish();
        await applying;
        await Promise.resolve();
        expect(root.textContent).toContain(label('applied'));
        expect(getPending()).toBeNull();
    });

    it('lets another connection save queue while a selection apply is pending', async () => {
        const { view, configuration } = setup();
        view.render();
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'inherit';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        let finishSelection!: () => void;
        configuration.setAIConnectionSelection.mockImplementationOnce(() => new Promise(resolve => {
            finishSelection = () => resolve({ status: 'applied' as const });
        }));
        const apply = button(root, label('applySelection'));
        apply.click();
        const applying = mockButtonActions.get(apply);

        const personal = Array.from(root.querySelectorAll<HTMLElement>('[data-name="Personal"]'))[0];
        const editPersonal = Array.from(personal.querySelectorAll('button'))
            .find(item => item.textContent === label('edit'))!;
        editPersonal.click();
        await mockButtonActions.get(editPersonal);
        const name = field<HTMLInputElement>(root, label('name'), 'input');
        name.value = 'Queued during selection';
        name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

        await press(root, label('save'));
        expect(configuration.updateAIConnection).toHaveBeenCalledWith(
            'personal',
            { name: 'Queued during selection' },
            undefined,
        );
        finishSelection();
        await applying;
    });

    it('starts a plain asset creation instead of reusing a pending selection promise', async () => {
        const { view, configuration } = setup();
        view.render();
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'inherit';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        configuration.setAIConnectionSelection.mockImplementationOnce(() => new Promise(() => undefined));
        const apply = button(root, label('applySelection'));
        apply.click();
        void mockButtonActions.get(apply);

        const plainAdd = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
            .filter(item => item.textContent === label('add')).at(-1)!;
        plainAdd.click();
        await mockButtonActions.get(plainAdd);
        const key = field<HTMLInputElement>(root, label('key'), 'input');
        key.value = 'asset-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        let finishAsset!: () => void;
        configuration.createAIConnection.mockImplementationOnce(() => new Promise(resolve => {
            finishAsset = () => resolve({ ...createConnectionDefaults('openai'), id: 'asset',
                name: 'Asset', secretRef: 'asset-key', revision: 0 });
        }));

        const save = button(root, label('save'));
        save.click();
        const savingAsset = mockButtonActions.get(save);
        expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
        finishAsset();
        await savingAsset;
    });

    it('reuses a completed default creation after returning to its pending draft', async () => {
        const { view, configuration, settings } = setup();
        view.render();
        await press(root, label('add'));
        const key = field<HTMLInputElement>(root, label('key'), 'input');
        key.value = 'new-test-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        let finish!: () => void;
        const created: AIConnection = { ...createConnectionDefaults('openai'), id: 'created', name: 'OpenAI',
            secretRef: 'created-key', revision: 0 };
        configuration.createAIConnection.mockImplementationOnce(() => new Promise(resolve => {
            finish = () => { settings.connections.push(created); settings.defaultConnectionId = created.id; resolve(created); };
        }));
        const saving = press(root, label('saveDefault'));
        view.back();
        await press(root, label('add'));
        expect(root.textContent).toContain(label('saving'));
        finish();
        await saving;
        expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
        expect(settings.connections).toHaveLength(3);
    });

    it('resumes an in-flight usage creation in a replacement view without resubmitting', async () => {
        const { options, configuration } = setup();
        const firstRoot = dom.window.document.createElement('div');
        dom.window.document.body.appendChild(firstRoot);
        const first = new AIConnectionsSettingsView(firstRoot, options);
        first.render();
        await press(firstRoot, label('add'));
        let finish!: () => void;
        configuration.createAIConnection.mockImplementationOnce(() => new Promise(resolve => {
            finish = () => resolve({ ...createConnectionDefaults('openai'), id: 'created',
                name: 'Created', secretRef: 'created-key', revision: 0 });
        }));
        const saving = press(firstRoot, label('saveDefault'));
        const secondRoot = dom.window.document.createElement('div');
        dom.window.document.body.appendChild(secondRoot);
        const second = new AIConnectionsSettingsView(secondRoot, options);
        second.render();
        await press(secondRoot, label('add'));
        expect(secondRoot.textContent).toContain(label('saving'));
        finish();
        await saving;
        expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
    });

    it.each(['direct-edit', 'back-add'] as const)(
        'resumes an in-flight plain asset creation through %s without resubmitting',
        async branch => {
            const { options, configuration, settings } = setup();
            const firstRoot = dom.window.document.createElement('div');
            dom.window.document.body.appendChild(firstRoot);
            const first = new AIConnectionsSettingsView(firstRoot, options);
            first.render();
            let finish!: () => void;
            configuration.createAIConnection.mockImplementationOnce(() => new Promise(resolve => {
                finish = () => {
                    const created = { ...createConnectionDefaults('openai'), id: 'asset-created',
                        name: 'Asset', secretRef: 'asset-key', revision: 0 } as AIConnection;
                    settings.connections.push(created);
                    resolve(created);
                };
            }));
            const firstAdd = Array.from(firstRoot.querySelectorAll<HTMLButtonElement>('button'))
                .filter(item => item.textContent === label('add')).at(-1)!;
            firstAdd.click();
            await mockButtonActions.get(firstAdd);
            const firstSave = button(firstRoot, label('save'));
            firstSave.click();
            const firstAction = mockButtonActions.get(firstSave);
            first.back();
            const secondRoot = dom.window.document.createElement('div');
            dom.window.document.body.appendChild(secondRoot);
            const second = new AIConnectionsSettingsView(secondRoot, options);
            second.render();

            const secondAdd = Array.from(secondRoot.querySelectorAll<HTMLButtonElement>('button'))
                .filter(item => item.textContent === label('add')).at(-1)!;
            secondAdd.click();
            const secondAction = mockButtonActions.get(secondAdd);
            expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
            expect(secondRoot.textContent).toContain(label('saving'));
            finish();
            await secondAction;
            await firstAction;
            await Promise.resolve();

            if (branch === 'direct-edit') {
                await press(secondRoot, label('edit'));
                expect(secondRoot.querySelector('h3')?.textContent)
                    .toBe(translate('plugin.settings.connections.editTitle', { name: 'Asset' }));
                expect(field<HTMLInputElement>(secondRoot, label('name'), 'input').value).toBe('Asset');
                await press(secondRoot, label('save'));
                expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
                second.back();
                const newAdd = Array.from(secondRoot.querySelectorAll<HTMLButtonElement>('button'))
                    .filter(item => item.textContent === label('add')).at(-1)!;
                newAdd.click();
                await mockButtonActions.get(newAdd);
                expect(secondRoot.querySelector('h3')?.textContent).toBe(label('add'));
                expect(field<HTMLInputElement>(secondRoot, label('name'), 'input').value).toBe('');
                expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
                return;
            }

            second.back();
            const recoveredAdd = Array.from(secondRoot.querySelectorAll<HTMLButtonElement>('button'))
                .filter(item => item.textContent === label('add')).at(-1)!;
            recoveredAdd.click();
            await mockButtonActions.get(recoveredAdd);
            expect(secondRoot.querySelector('h3')?.textContent)
                .toBe(translate('plugin.settings.connections.editTitle', { name: 'Asset' }));
            expect(field<HTMLInputElement>(secondRoot, label('name'), 'input').value).toBe('Asset');
            await press(secondRoot, label('save'));
            expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
        },
    );

    it('recovers a failed plain asset creation in a replacement retry form', async () => {
        const { options, configuration } = setup();
        const firstRoot = dom.window.document.createElement('div');
        dom.window.document.body.appendChild(firstRoot);
        const first = new AIConnectionsSettingsView(firstRoot, options);
        first.render();
        let failAsset!: (error: Error) => void;
        configuration.createAIConnection.mockImplementationOnce(() => new Promise((_resolve, reject) => {
            failAsset = reject;
        }));
        const firstAdd = Array.from(firstRoot.querySelectorAll<HTMLButtonElement>('button'))
            .filter(item => item.textContent === label('add')).at(-1)!;
        firstAdd.click();
        await mockButtonActions.get(firstAdd);
        const firstName = field<HTMLInputElement>(firstRoot, label('name'), 'input');
        firstName.value = 'Retry asset';
        firstName.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const firstSave = button(firstRoot, label('save'));
        firstSave.click();
        const firstAction = mockButtonActions.get(firstSave);

        const secondRoot = dom.window.document.createElement('div');
        dom.window.document.body.appendChild(secondRoot);
        const second = new AIConnectionsSettingsView(secondRoot, options);
        second.render();
        const secondAdd = Array.from(secondRoot.querySelectorAll<HTMLButtonElement>('button'))
            .filter(item => item.textContent === label('add')).at(-1)!;
        secondAdd.click();
        const secondAction = mockButtonActions.get(secondAdd);
        expect(secondRoot.textContent).toContain(label('saving'));

        failAsset(new Error('asset storage unavailable'));
        await firstAction;
        await secondAction;
        await press(secondRoot, label('retry'));

        expect(field<HTMLSelectElement>(secondRoot, label('provider'), 'select').value).toBe('openai');
        expect(field<HTMLInputElement>(secondRoot, label('name'), 'input').value).toBe('Retry asset');
        expect(field<HTMLInputElement>(secondRoot, label('key'), 'input').value).toBe('');
        expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
    });

    it('keeps the selection intention when the committed preview changes', async () => {
        const { view, configuration } = setup();
        view.render();
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'inherit';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const changedPreview = (
            configuration.previewAIConnectionSelection.mock.results.at(-1)?.value
        ) as AIConnectionSelectionPreview | undefined;
        configuration.setAIConnectionSelection.mockImplementationOnce(async () => ({
            status: 'preview-changed',
            preview: changedPreview!,
        }) as AIConnectionSelectionResult);

        await press(root, label('applySelection'));

        expect(field<HTMLSelectElement>(root, label('chat'), 'select').value).toBe('inherit');
        expect(button(root, label('applySelection')).disabled).toBe(false);
        expect(root.textContent).toContain(label('previewChanged'));
    });

    it('unlocks and retains the selection draft after a failed apply', async () => {
        const { view, configuration } = setup();
        view.render();
        const chat = field<HTMLSelectElement>(root, label('chat'), 'select');
        chat.value = 'inherit';
        chat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        configuration.setAIConnectionSelection.mockRejectedValueOnce(new Error('save unavailable'));

        await expect(press(root, label('applySelection'))).resolves.toBeUndefined();

        expect(field<HTMLSelectElement>(root, label('chat'), 'select').value).toBe('inherit');
        expect(button(root, label('applySelection')).disabled).toBe(false);
        expect(root.querySelector('[role="alert"]')?.textContent).toBe(label('saveFailed'));
    });

    it('keeps Custom address and model fields visible and validates before creation', async () => {
        const { view, configuration, settings } = setup();
        settings.bindings.chat = { mode: 'unconfigured' };
        view.render();
        const plainAdd = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
            .filter(item => item.textContent === label('add')).at(-1)!;
        plainAdd.click();
        await mockButtonActions.get(plainAdd);
        const provider = field<HTMLSelectElement>(root, label('provider'), 'select');
        provider.value = 'custom';
        provider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const address = field<HTMLInputElement>(root, translate('plugin.settings.connections.endpoint', { purpose: label('chat') }), 'input');
        expect(address).toBeDefined();
        const chatModel = field<HTMLInputElement>(root, label('chatModel'), 'input');
        expect(chatModel).toBeDefined();
        const incompleteStatus = root.querySelector<HTMLElement>('p.pa-settings-section-desc[aria-live="polite"]');
        expect(incompleteStatus?.textContent).toContain(label('issue.endpoint_missing'));
        address.value = 'htps://host/v1';
        address.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        expect(incompleteStatus?.textContent).toContain(label('issue.configuration_invalid'));
        const key = field<HTMLInputElement>(root, label('key'), 'input');
        key.value = 'retained-test-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        await press(root, label('save'));
        expect(configuration.createAIConnection).not.toHaveBeenCalled();
        expect(address.getAttribute('aria-invalid')).toBe('true');
        expect(key.value).toBe('retained-test-key');
        address.value = 'https://custom.example/v1';
        address.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        expect(incompleteStatus?.textContent).toContain(label('issue.model_missing'));
        chatModel.value = 'custom-chat-model';
        chatModel.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const embeddingAddress = field<HTMLInputElement>(root, translate(
            'plugin.settings.connections.endpoint',
            { purpose: label('embedding') },
        ), 'input');
        embeddingAddress.value = 'https://custom.example/embedding';
        embeddingAddress.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const embeddingModel = field<HTMLInputElement>(root, label('embeddingModel'), 'input');
        embeddingModel.value = 'custom-embedding-model';
        embeddingModel.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        expect(incompleteStatus?.hidden).toBe(true);
        expect(incompleteStatus?.textContent).not.toContain(label('issue.connection_unconfigured'));
        expect(settings.bindings.chat).toEqual({ mode: 'unconfigured' });

        const name = field<HTMLInputElement>(root, label('name'), 'input');
        name.value = 'Saved Custom';
        name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        address.value = '';
        address.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        await press(root, label('save'));
        const savedRow = Array.from(root.querySelectorAll<HTMLElement>('[data-name="Saved Custom"]'))[0];
        expect(savedRow.dataset.description).toContain(label('issue.endpoint_missing'));
        const editSaved = Array.from(savedRow.querySelectorAll('button'))
            .find(item => item.textContent === label('edit'))!;
        editSaved.click();
        await mockButtonActions.get(editSaved);
        const chatEndpointRow = Array.from(root.querySelectorAll<HTMLElement>('[data-name]'))
            .find(item => item.dataset.name === translate('plugin.settings.connections.endpoint', {
                purpose: label('chat'),
            }))!;
        expect(chatEndpointRow.dataset.description).toBe(label('unconfigured'));
    });

    it('offers first setup, no-default repair, and legacy migration from distinct saved facts', () => {
        const base = setup();
        const renderStandalone = (
            configuration: unknown,
            isInitialSetup: boolean,
        ): HTMLElement => {
            const standaloneRoot = dom.window.document.createElement('div');
            dom.window.document.body.appendChild(standaloneRoot);
            new AIConnectionsSettingsView(standaloneRoot, {
                ...base.options,
                configuration: configuration as PluginAIConfiguration,
                isInitialSetup,
            }).render();
            return standaloneRoot;
        };

        const undefinedConfiguration = { ...base.configuration, getAIConnections: jest.fn(() => undefined) };
        const firstSetup = renderStandalone(undefinedConfiguration, true);
        expect(firstSetup.textContent).toContain(label('addDefault'));
        expect(firstSetup.textContent).not.toContain(label('migrate'));

        const noDefaultSettings = JSON.parse(JSON.stringify(base.settings)) as AIConnectionsSettings;
        noDefaultSettings.defaultConnectionId = null;
        const noDefaultConfiguration = { ...base.configuration,
            getAIConnections: jest.fn(() => noDefaultSettings) };
        const noDefault = renderStandalone(noDefaultConfiguration, false);
        expect(noDefault.textContent).toContain(label('unconfigured'));
        expect(noDefault.textContent).toContain('Work');
        expect(noDefault.textContent).not.toContain(label('addDefault'));

        const legacy = renderStandalone(undefinedConfiguration, false);
        expect(legacy.textContent).toContain(label('migrate'));
        expect(legacy.textContent).not.toContain(label('addDefault'));
    });

    it('passes first-setup admission when creating the initial default connection', async () => {
        const base = setup();
        const undefinedConfiguration = {
            ...base.configuration,
            getAIConnections: jest.fn(() => undefined),
            createAIConnection: jest.fn<PluginAIConfiguration['createAIConnection']>(
                async (input, _key, _usage, _options) => ({ ...createConnectionDefaults(input.providerId),
                    id: 'initial', name: 'Initial', secretRef: 'initial-key', revision: 0 }),
            ),
        };
        const firstSetupRoot = dom.window.document.createElement('div');
        dom.window.document.body.appendChild(firstSetupRoot);
        const firstSetup = new AIConnectionsSettingsView(firstSetupRoot, {
            ...base.options,
            configuration: undefinedConfiguration as unknown as PluginAIConfiguration,
            isInitialSetup: true,
        });
        firstSetup.render();
        await press(firstSetupRoot, label('addDefault'));
        await press(firstSetupRoot, label('saveDefault'));

        expect(undefinedConfiguration.createAIConnection).toHaveBeenCalledWith(
            expect.anything(),
            undefined,
            'default',
            expect.objectContaining({ initialSetup: true }),
        );
    });

    it('keeps focus on the purpose selector after its value changes', async () => {
        const { view } = setup();
        view.render();
        const image = field<HTMLSelectElement>(root, label('image'), 'select');
        image.focus();
        image.value = 'personal';
        image.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        expect(root.ownerDocument.activeElement).toBe(
            field<HTMLSelectElement>(root, label('image'), 'select'),
        );
        expect((root.ownerDocument.activeElement as HTMLElement).dataset.paSelectionTarget).toBe('image');
    });

    it('restores the replaced overview trigger after returning from an editor', async () => {
        const { view } = setup();
        view.render();
        const edit = button(root, label('edit'));
        edit.focus();
        await press(root, label('edit'));
        view.back();

        expect(root.ownerDocument.activeElement).toBe(button(root, label('edit')));
    });

    it('captures the open editor draft before directed purpose re-entry', async () => {
        const { view } = setup();
        view.render();
        await press(root, label('edit'));
        const model = field<HTMLInputElement>(root, label('chatModel'), 'input');
        model.value = 'directed-reentry-model';
        model.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const key = field<HTMLInputElement>(root, label('newKey'), 'input');
        key.value = 'private-reentry-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

        view.focusSelectionTarget('image');
        await press(root, label('continueEditing'));

        expect(field<HTMLInputElement>(root, label('chatModel'), 'input').value)
            .toBe('directed-reentry-model');
        expect(field<HTMLInputElement>(root, label('newKey'), 'input').value).toBe('');
    });
});

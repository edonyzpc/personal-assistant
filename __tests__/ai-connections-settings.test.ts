import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { App } from 'obsidian';
import { installObsidianDocumentHelpers } from './helpers/obsidian-dom';
import { AIConnectionsSettingsView, type AIConnectionsSettingsOptions } from '../src/components/ai-connections-settings';
import type { PluginAIConfiguration } from '../src/ai-services/plugin-configuration';
import type { AIConnection, AIConnectionsSettings, AIPurpose, PurposeBinding } from '../src/ai-services/ai-connection-types';
import { createConnectionDefaults } from '../src/ai-services/provider-definitions';
import { resolveAIConnection } from '../src/ai-services/ai-connection-resolver';
import { pluginT, type PluginTranslator } from '../src/locales/plugin';
import type { MemoryMaintenancePlan } from '../src/memory-manager';

type NativeTestWindow = Window & { HTMLElement: typeof HTMLElement; Event: typeof Event; close(): void };
type NativeTestDOM = { window: NativeTestWindow };
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => NativeTestDOM };

const mockButtonActions = new WeakMap<HTMLButtonElement, Promise<unknown>>();

// Native DOM provides connection/focus/control lifetime semantics. This small
// bridge supplies only Obsidian Setting's fluent controls, as in settings.test.
jest.mock('obsidian', () => ({
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
            const control = {
                buttonEl: el,
                setButtonText: (value: string) => { el.textContent = value; return control; },
                setTooltip: (value: string) => { el.setAttribute('aria-label', value); return control; },
                setCta: () => control,
                setDisabled: (value: boolean) => { el.disabled = value; return control; },
                onClick: (action: () => unknown) => {
                    el.addEventListener('click', () => { mockButtonActions.set(el, Promise.resolve(action())); });
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
        const configuration = {
            getAIConnections: jest.fn(() => JSON.parse(JSON.stringify(settings)) as AIConnectionsSettings),
            previewAIConnectionName: jest.fn((name: string) => name),
            resolveAIConnection: jest.fn((purpose: AIPurpose) => resolveAIConnection(settings, purpose)),
            getAIConnectionTokenState: jest.fn(() => 'unknown'),
            getAIConnectionToken: jest.fn(async () => { secretStorage.getSecret(); return ''; }),
            setAIPurposeBinding: jest.fn(async (purpose: AIPurpose, binding: PurposeBinding) => { settings.bindings[purpose] = binding; }),
            setDefaultAIConnection: jest.fn(async (id: string | null) => { settings.defaultConnectionId = id; }),
            createAIConnection: jest.fn<PluginAIConfiguration['createAIConnection']>(),
            updateAIConnection: jest.fn<PluginAIConfiguration['updateAIConnection']>(async id =>
                JSON.parse(JSON.stringify(settings.connections.find(connection => connection.id === id))) as AIConnection),
            removeAIConnectionKey: jest.fn(async () => undefined),
            deleteAIConnection: jest.fn(async () => undefined),
        };
        const legacyCredentials = jest.fn(() => []);
        const onCommitted = jest.fn();
        const view = new AIConnectionsSettingsView(root, {
            app: { secretStorage } as unknown as App,
            configuration: configuration as unknown as PluginAIConfiguration,
            translate, isInitialSetup: false, legacyCredentials, onCommitted,
            getMemoryPlan: async () => memoryPlan,
            ...memoryOptions,
        });
        return { view, settings, configuration, secretStorage, legacyCredentials, onCommitted };
    };

    it('renders cached configuration and management without reading secrets or making requests', async () => {
        const { view, configuration, secretStorage, legacyCredentials } = setup();
        view.render();
        await press(root, label('manage'));
        expect(configuration.getAIConnectionTokenState).toHaveBeenCalled();
        expect(configuration.getAIConnectionToken).not.toHaveBeenCalled();
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(legacyCredentials).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it('shows a new Memory configuration as needing preparation even when Chat can answer immediately', async () => {
        const { view } = setup({ reason: 'settings-changed', action: 'rebuild', notesToCheck: 1,
            requiresApproval: true, canAnswerNow: true });
        view.render();
        await Promise.resolve();
        expect(root.textContent).toContain(label('memoryNeedsPrepare'));
        expect(root.textContent).not.toContain(label('memoryPending'));
    });

    it('refreshes Memory after its switch changes without replacing an open connection draft or moving focus', async () => {
        let enabled = false;
        const { view } = setup({ reason: 'settings-changed', action: 'rebuild', notesToCheck: 1,
            requiresApproval: true, canAnswerNow: true }, { isMemoryEnabled: () => enabled,
            memoryAction: jest.fn<NonNullable<AIConnectionsSettingsOptions['memoryAction']>>(async () => undefined) });
        view.render();
        await Promise.resolve();
        expect(root.textContent).not.toContain(label('memoryNeedsPrepare'));
        const manage = button(root, label('manage'));
        manage.focus();
        enabled = true;
        view.refreshOverview();
        await Promise.resolve();
        expect(root.textContent).toContain(label('memoryNeedsPrepare'));
        expect(button(root, label('memory.prepare'))).toBeDefined();
        expect(dom.window.document.activeElement).toBe(manage);
        await press(root, label('manage'));
        const work = Array.from(root.querySelectorAll<HTMLElement>('[data-name]')).find(row => row.dataset.name === 'Work')!;
        await press(work, label('edit'));
        const key = field<HTMLInputElement>(root, label('newKey'), 'input');
        key.value = 'unsaved-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        key.focus();
        enabled = false;
        view.refreshOverview();
        expect(field<HTMLInputElement>(root, label('newKey'), 'input')).toBe(key);
        expect(key.value).toBe('unsaved-key');
        expect(dom.window.document.activeElement).toBe(key);
        await press(root, label('back'));
        await press(root, label('back'));
        enabled = true;
        view.refreshOverview();
        enabled = false;
        view.refreshOverview();
        await Promise.resolve();
        expect(root.textContent).not.toContain(label('memoryNeedsPrepare'));
        expect(Array.from(root.querySelectorAll('button')).some(item => item.textContent === label('memory.prepare'))).toBe(false);
    });

    it('previews restoring inheritance without writes and applies only the selected purpose', async () => {
        const { view, configuration, settings, onCommitted } = setup();
        const scrollIntoView = jest.fn();
        root.scrollIntoView = scrollIntoView;
        const focus = jest.spyOn(dom.window.HTMLElement.prototype, 'focus');
        view.render();
        expect(button(root, label('restore')).getAttribute('aria-label')).toContain(label('chat'));
        await press(root, label('restore'));
        expect(dom.window.document.activeElement).toBe(root.querySelector('h3'));
        expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
        expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' });
        expect(field<HTMLSelectElement>(root, label('use'), 'select').value).toBe('inherit');
        expect(root.textContent).toContain('Work');
        expect(settings.bindings.chat).toEqual({ mode: 'connection', connectionId: 'personal' });
        expect(configuration.setAIPurposeBinding).not.toHaveBeenCalled();
        expect(configuration.setDefaultAIConnection).not.toHaveBeenCalled();
        await press(root, label('cancel'));
        expect(dom.window.document.activeElement).toBe(button(root, label('restore')));
        await press(root, label('restore'));
        await press(root, label('apply'));
        expect(configuration.setAIPurposeBinding).toHaveBeenCalledWith('chat', { mode: 'inherit' });
        expect(settings.bindings.embedding).toEqual({ mode: 'inherit' });
        expect(settings.defaultConnectionId).toBe('work');
        expect(configuration.setDefaultAIConnection).not.toHaveBeenCalled();
        expect(dom.window.document.activeElement).toBe(button(root, label('adjust')));
        expect(onCommitted).toHaveBeenCalledTimes(1);
    });

    it('cancels a purpose-scoped addition without saving its Key or losing the source selection', async () => {
        const { view, configuration, secretStorage, settings } = setup();
        view.render();
        await press(root, label('adjust'));
        const chat = Array.from(root.querySelectorAll<HTMLElement>('[data-name]')).find(row => row.dataset.name === label('chat'))!;
        await press(chat, label('change'));
        const source = field<HTMLSelectElement>(root, label('use'), 'select');
        source.value = 'work';
        source.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        await press(root, label('add'));
        const key = field<HTMLInputElement>(root, label('key'), 'input');
        key.value = 'unsaved-test-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        await press(root, label('cancel'));
        expect(field<HTMLSelectElement>(root, label('use'), 'select').value).toBe('work');
        expect(configuration.createAIConnection).not.toHaveBeenCalled();
        expect(configuration.setAIPurposeBinding).not.toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(settings.bindings.chat).toEqual({ mode: 'connection', connectionId: 'personal' });
    });

    it('retains the current draft on failure and does not reopen a departed page after late success', async () => {
        const { view, configuration, settings } = setup();
        view.render();
        await press(root, label('manage'));
        const work = Array.from(root.querySelectorAll<HTMLElement>('[data-name]')).find(row => row.dataset.name === 'Work')!;
        await press(work, label('edit'));
        const name = field<HTMLInputElement>(root, label('name'), 'input');
        name.value = 'Edited work';
        name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const key = field<HTMLInputElement>(root, label('newKey'), 'input');
        key.value = 'replacement-test-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        configuration.updateAIConnection.mockRejectedValueOnce(new Error('storage unavailable'));
        await press(root, label('save'));
        expect(field<HTMLInputElement>(root, label('name'), 'input').value).toBe('Edited work');
        expect(field<HTMLInputElement>(root, label('newKey'), 'input').value).toBe('replacement-test-key');
        expect(root.querySelector('[role="alert"]')?.textContent).toBe(label('saveFailed'));
        expect(button(root, label('save')).disabled).toBe(false);
        let finish!: () => void;
        configuration.updateAIConnection.mockImplementationOnce(() => new Promise<AIConnection>(resolve => {
            finish = () => resolve(JSON.parse(JSON.stringify(settings.connections[0])) as AIConnection);
        }));
        const saving = press(root, label('save'));
        await press(root, label('back'));
        await press(root, label('back'));
        expect(root.querySelector('h3')?.textContent).toBe(label('title'));
        finish();
        await saving;
        expect(root.querySelector('h3')?.textContent).toBe(label('title'));
        expect(root.querySelector('[role="alert"]')).toBeNull();
    });

    it('rebases a late successful save without losing newer drafts or resending an already saved model', async () => {
        const { view, configuration, settings } = setup();
        view.render();
        await press(root, label('manage'));
        const editWork = async () => {
            const row = Array.from(root.querySelectorAll<HTMLElement>('[data-name]')).find(item => item.dataset.name === 'Work')!;
            await press(row, label('edit'));
        };
        const enter = (name: string, value: string) => {
            const input = field<HTMLInputElement>(root, label(name), 'input');
            input.value = value;
            input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        };
        await editWork();
        enter('chatModel', 'first-saved-model');
        let finish!: () => void;
        configuration.updateAIConnection.mockImplementationOnce(() => new Promise<AIConnection>(resolve => {
            finish = () => resolve(JSON.parse(JSON.stringify(settings.connections[0])) as AIConnection);
        }));
        const saving = press(root, label('save'));
        await press(root, label('back'));
        await editWork();
        enter('name', 'Newer name draft');
        await press(root, label('back'));
        settings.connections[0].models.chat = 'first-saved-model';
        finish();
        await saving;
        expect(root.querySelector('h3')?.textContent).toBe(label('manage'));
        settings.connections[0].models.chat = 'changed-in-another-window';
        await editWork();
        expect(field<HTMLInputElement>(root, label('name'), 'input').value).toBe('Newer name draft');
        enter('newKey', 'replacement-key');
        await press(root, label('save'));
        expect(configuration.updateAIConnection).toHaveBeenLastCalledWith('work', { name: 'Newer name draft' }, 'replacement-key');
        expect(settings.connections[0].models.chat).toBe('changed-in-another-window');
    });

    it('reuses a completed creation after returning to its pending draft instead of replacing it with a keyless duplicate', async () => {
        const { view, configuration, settings } = setup();
        view.render();
        await press(root, label('change'));
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
        await press(root, label('back'));
        await press(root, label('add'));
        expect(Array.from(root.querySelectorAll('button')).some(item => item.textContent === label('saveDefault') && !item.disabled)).toBe(false);
        expect(root.textContent).toContain(label('saving'));
        const back = button(root, label('back'));
        back.focus();
        finish();
        await saving;
        expect(dom.window.document.activeElement).toBe(back);
        await press(root, label('edit'));
        expect(field<HTMLInputElement>(root, label('newKey'), 'input').value).toBe('');
        await press(root, label('save'));
        expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
        expect(configuration.updateAIConnection).toHaveBeenCalledWith('created', {}, undefined);
        expect(settings.defaultConnectionId).toBe(created.id);
        expect(settings.connections).toHaveLength(3);
    });

    it('keeps an invalid API address in the form with a field error and allows correcting it without losing the Key', async () => {
        const { view, configuration } = setup();
        view.render();
        await press(root, label('manage'));
        await press(root, label('add'));
        const provider = field<HTMLSelectElement>(root, label('provider'), 'select');
        provider.value = 'custom';
        provider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const address = field<HTMLInputElement>(root, translate('plugin.settings.connections.endpoint', { purpose: label('chat') }), 'input');
        address.value = 'htps://host/v1';
        address.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const key = field<HTMLInputElement>(root, label('key'), 'input');
        key.value = 'retained-test-key';
        key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        await press(root, label('save'));
        expect(configuration.createAIConnection).not.toHaveBeenCalled();
        expect(address.getAttribute('aria-invalid')).toBe('true');
        expect(root.ownerDocument.getElementById(address.getAttribute('aria-describedby')!)?.textContent).toBe(label('endpointInvalid'));
        expect(dom.window.document.activeElement).toBe(address);
        expect(address.closest('details')?.open).toBe(true);
        expect(key.value).toBe('retained-test-key');
        address.value = 'http://localhost:1234/v1';
        address.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        configuration.createAIConnection.mockResolvedValueOnce({ ...createConnectionDefaults('custom'), id: 'custom', name: 'Custom', secretRef: 'custom-key', revision: 0 });
        await press(root, label('save'));
        expect(configuration.createAIConnection).toHaveBeenCalledTimes(1);
        expect(configuration.createAIConnection).toHaveBeenCalledWith(expect.objectContaining({ endpoints: expect.objectContaining({ chat: address.value }) }), 'retained-test-key', undefined, expect.anything());
    });
});

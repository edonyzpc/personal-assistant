import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';

jest.mock('obsidian', () => ({
    App: class { },
    Notice: class { },
    Platform: { isDesktop: true, isMobile: false },
    // Tests record every debounce wrapper that is created so they can assert
    // *which* callback was deferred (vs. fired synchronously). The wrapper
    // exposes `pending`/`runs` so `hide()`'s flush path can also be verified.
    debounce: <T extends unknown[], V>(cb: (...args: T) => V, _timeout: number, _resetTimer = true) => {
        const record: { calls: T[]; cancelled: number; runs: number; pending: boolean; lastArgs?: T } = {
            calls: [],
            cancelled: 0,
            runs: 0,
            pending: false,
        };
        const debounced = ((...args: T) => {
            record.calls.push(args);
            record.lastArgs = args;
            record.pending = true;
            return debounced;
        }) as ((...args: T) => unknown) & {
            cancel: () => unknown;
            run: () => unknown;
            __record: typeof record;
            __cb: (...args: T) => V;
        };
        debounced.cancel = () => {
            record.cancelled += 1;
            record.pending = false;
            return debounced;
        };
        debounced.run = () => {
            record.runs += 1;
            const args = record.lastArgs ?? ([] as unknown as T);
            record.pending = false;
            return cb(...args);
        };
        debounced.__record = record;
        debounced.__cb = cb;
        const globalObj = globalThis as typeof globalThis & {
            __paDebounceRecords?: Array<typeof record>;
        };
        globalObj.__paDebounceRecords = globalObj.__paDebounceRecords ?? [];
        globalObj.__paDebounceRecords.push(record);
        return debounced;
    },
    PluginSettingTab: class {
        app: unknown;
        containerEl = { empty: jest.fn() };
        constructor(app: unknown, _plugin: unknown) { this.app = app; }
    },
    Modal: class {
        app: unknown;
        contentEl: HTMLElement;
        constructor(app: unknown) {
            this.app = app;
            this.contentEl = document.createElement('div');
        }
        open() {
            const globalObj = globalThis as typeof globalThis & { __paModalInstances?: unknown[] };
            globalObj.__paModalInstances = globalObj.__paModalInstances ?? [];
            globalObj.__paModalInstances.push(this);
            (this as unknown as { onOpen?: () => void }).onOpen?.();
            return this;
        }
        close() {
            (this as unknown as { onClose?: () => void }).onClose?.();
        }
    },
    Setting: class {
        record: {
            name?: string;
            desc?: string;
            toggles: Array<{ value?: boolean; disabled?: boolean; onChange?: (value: boolean) => unknown }>;
            dropdowns: Array<{
                value?: string;
                options: Array<{ value: string; text: string }>;
                onChange?: (value: string) => unknown;
            }>;
            buttons: Array<{ text?: string; disabled?: boolean; onClick?: () => unknown | Promise<unknown> }>;
            texts: Array<{ value?: unknown; placeholder?: string; onChange?: (value: string) => unknown; setValueCalls: unknown[] }>;
            colorPickers: Array<{ value?: string; onChange?: (value: string) => unknown; setValueCalls: unknown[] }>;
        };

        constructor(_containerEl: unknown) {
            this.record = { toggles: [], dropdowns: [], buttons: [], texts: [], colorPickers: [] };
            const globalObj = globalThis as typeof globalThis & {
                __paSettingRecords?: Array<{
                    name?: string;
                    desc?: string;
                    toggles: Array<{ value?: boolean; disabled?: boolean; onChange?: (value: boolean) => unknown }>;
                    dropdowns: Array<{
                        value?: string;
                        options: Array<{ value: string; text: string }>;
                        onChange?: (value: string) => unknown;
                    }>;
                    buttons: Array<{ text?: string; disabled?: boolean; onClick?: () => unknown | Promise<unknown> }>;
                    texts: Array<{ value?: unknown; placeholder?: string; onChange?: (value: string) => unknown; setValueCalls: unknown[] }>;
                    colorPickers: Array<{ value?: string; onChange?: (value: string) => unknown; setValueCalls: unknown[] }>;
                }>;
            };
            globalObj.__paSettingRecords = globalObj.__paSettingRecords ?? [];
            globalObj.__paSettingRecords.push(this.record);
        }

        setName(name: unknown) {
            this.record.name = mockStringifyText(name);
            return this;
        }

        setDesc(desc: unknown) {
            this.record.desc = mockStringifyText(desc);
            return this;
        }

        setHeading() {
            return this;
        }

        addToggle(callback: (toggle: {
            setValue: (value: boolean) => unknown;
            setDisabled: (disabled: boolean) => unknown;
            onChange: (onChange: (value: boolean) => unknown) => unknown;
        }) => void) {
            const toggle: { value?: boolean; disabled: boolean; onChange?: (value: boolean) => unknown } = {
                value: undefined,
                disabled: false,
                onChange: undefined,
            };
            this.record.toggles.push(toggle);
            const toggleComponent = {
                setValue: (value: boolean) => {
                    toggle.value = value;
                    return toggleComponent;
                },
                setDisabled: (disabled: boolean) => {
                    toggle.disabled = disabled;
                    return toggleComponent;
                },
                onChange: (onChange: (value: boolean) => unknown) => {
                    toggle.onChange = onChange;
                    return toggleComponent;
                },
            };
            callback(toggleComponent);
            return this;
        }

        addText(callback: (text: {
            inputEl: HTMLInputElement & { addClass: (cls: string) => unknown };
            setPlaceholder: (value: string) => unknown;
            setValue: (value: unknown) => unknown;
            onChange: (onChange: (value: string) => unknown) => unknown;
        }) => void) {
            const text: {
                value?: unknown;
                placeholder?: string;
                onChange?: (value: string) => unknown;
                setValueCalls: unknown[];
            } = { setValueCalls: [] };
            this.record.texts.push(text);
            const inputEl = {
                readOnly: false,
                type: 'text',
                value: '',
                addClass: jest.fn(),
                dispatchEvent: jest.fn(),
                focus: jest.fn(),
                select: jest.fn(),
            } as unknown as HTMLInputElement & { addClass: (cls: string) => unknown };
            const textComponent = {
                inputEl,
                setPlaceholder: (value: string) => {
                    text.placeholder = value;
                    return textComponent;
                },
                setValue: (value: unknown) => {
                    text.value = value;
                    inputEl.value = String(value ?? '');
                    text.setValueCalls.push(value);
                    return textComponent;
                },
                onChange: (onChange: (value: string) => unknown) => {
                    text.onChange = onChange;
                    return textComponent;
                },
            };
            callback(textComponent);
            return this;
        }

        addDropdown(callback: (dropdown: {
            addOption: (value: string, text: string) => unknown;
            setValue: (value: string) => unknown;
            onChange: (onChange: (value: string) => unknown) => unknown;
            selectEl: { querySelector: (selector: string) => { setAttribute: (name: string, value: string) => void } | null };
        }) => void) {
            const dropdown: {
                value?: string;
                options: Array<{ value: string; text: string }>;
                onChange?: (value: string) => unknown;
            } = {
                value: undefined,
                options: [],
                onChange: undefined,
            };
            this.record.dropdowns.push(dropdown);
            const dropdownComponent = {
                addOption: (value: string, text: string) => {
                    dropdown.options.push({ value, text });
                    return dropdownComponent;
                },
                setValue: (value: string) => {
                    dropdown.value = value;
                    return dropdownComponent;
                },
                onChange: (onChange: (value: string) => unknown) => {
                    dropdown.onChange = onChange;
                    return dropdownComponent;
                },
                selectEl: { querySelector: (_selector: string) => ({ setAttribute: jest.fn() }) },
            };
            callback(dropdownComponent);
            return this;
        }

        addButton(callback: (button: {
            buttonEl: unknown;
            setCta: () => unknown;
            setButtonText: (text: string) => unknown;
            setDisabled: (disabled: boolean) => unknown;
            onClick: (callback: () => void) => unknown;
        }) => void) {
            const button: { text?: string; disabled?: boolean; onClick?: () => unknown | Promise<unknown> } = {};
            this.record.buttons.push(button);
            const buttonComponent = {
                buttonEl: {},
                setCta: () => buttonComponent,
                setButtonText: (text: string) => {
                    button.text = text;
                    return buttonComponent;
                },
                setDisabled: (disabled: boolean) => {
                    button.disabled = disabled;
                    return buttonComponent;
                },
                onClick: (cb: () => void) => {
                    button.onClick = cb;
                    return buttonComponent;
                },
            };
            callback(buttonComponent);
            return this;
        }

        addColorPicker(callback: (picker: {
            setValue: (value: string) => unknown;
            onChange: (callback: (value: string) => unknown) => unknown;
        }) => void) {
            const colorPicker: { value?: string; onChange?: (value: string) => unknown; setValueCalls: unknown[] } = {
                setValueCalls: [],
            };
            this.record.colorPickers.push(colorPicker);
            const pickerComponent = {
                setValue: (value: string) => {
                    colorPicker.value = value;
                    colorPicker.setValueCalls.push(value);
                    return pickerComponent;
                },
                onChange: (cb: (value: string) => unknown) => {
                    colorPicker.onChange = cb;
                    return pickerComponent;
                },
            };
            callback(pickerComponent);
            return this;
        }

        addExtraButton(callback: (button: {
            setIcon: (icon: string) => unknown;
            setTooltip: (tooltip: string) => unknown;
            onClick: (callback: () => void) => unknown;
        }) => void) {
            const buttonComponent = {
                setIcon: (_icon: string) => buttonComponent,
                setTooltip: (_tooltip: string) => buttonComponent,
                onClick: (_callback: () => void) => buttonComponent,
            };
            callback(buttonComponent);
            return this;
        }

        addComponent(callback: (el: HTMLElement) => unknown) {
            callback(document.createElement('div'));
            return this;
        }
    },
    SecretComponent: class {
        constructor(_app: unknown, _el: unknown) {
            const globalObj = globalThis as typeof globalThis & {
                __paSecretRecords?: Array<{ value?: string; onChange?: (value: string) => unknown }>;
            };
            globalObj.__paSecretRecords = globalObj.__paSecretRecords ?? [];
            const record: { value?: string; onChange?: (value: string) => unknown } = {};
            globalObj.__paSecretRecords.push(record);
            (this as unknown as { __record: typeof record }).__record = record;
        }
        setValue(value: string) {
            (this as unknown as { __record: { value?: string } }).__record.value = value;
            return this;
        }
        onChange(cb: (value: string) => unknown) {
            (this as unknown as { __record: { onChange?: (value: string) => unknown } }).__record.onChange = cb;
            return this;
        }
    },
}));

jest.mock('../src/confirm', () => {
    const globalObj = globalThis as typeof globalThis & { __paConfirmDecision?: boolean };
    return {
        confirmUserAction: jest.fn(async () => globalObj.__paConfirmDecision ?? false),
    };
});

jest.mock('../src/stats-view', () => ({ STAT_PREVIEW_TYPE: 'stat-preview' }));
jest.mock('../src/stats/stats-store', () => ({ normalizeStatisticsView: (view: string) => view }));
jest.mock('../src/utils', () => ({
    KEYCHAIN_API_TOKEN_ID: 'pa-api-token',
    getVaultScopedSecret: (
        secretStorage: { getSecret: (id: string) => string | null },
        scopedId: string,
    ) => {
        return secretStorage.getSecret(scopedId);
    },
    hasSecretValue: (secret: string | null) => secret !== null && secret !== '',
}));

import {
    DEFAULT_SETTINGS,
    PROVIDER_PRESETS,
    STATISTICS_SYNC_SETTING_DESC,
    SettingTab,
    buildPaLegalLinks,
    deriveDisplayPreset,
    isFreshInstall,
    isLegacyV1Install,
    mergeLoadedSettings,
    normalizeEnabledSkillIds,
    safeParseInt,
    updateQwenResponseOptionAvailability,
} from '../src/settings';
import { OPERATIONS_AGENT_RUNTIME_ENABLED } from '../src/operations-agent-flags';
import { confirmUserAction } from '../src/confirm';
import { MOCK_LICENSE_TIER } from '../src/ai-services/capability-types';
import { BUNDLED_SKILL_CATALOG } from '../src/ai-services/bundled-skill-catalog';

function mockStringifyText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
        const maybeText = value as { textContent?: unknown; innerText?: unknown };
        if (typeof maybeText.textContent === 'string') return maybeText.textContent;
        if (typeof maybeText.innerText === 'string') return maybeText.innerText;
    }
    return '';
}

type MockElOptions = {
    text?: string;
    cls?: string | string[];
    attr?: Record<string, string>;
};

class MockDomNode {
    children: MockDomNode[] = [];
    href = '';
    innerText = '';
    textContent = '';
    classes: string[] = [];
    attrs: Record<string, string> = {};

    constructor(readonly tagName: string) { }

    setText(text: string) {
        this.innerText = text;
        this.textContent = text;
        return this;
    }

    setAttr(name: string, value: string) {
        this.attrs[name] = value;
        return this;
    }

    addClass(cls: string) {
        this.classes.push(cls);
        return this;
    }

    setCssStyles(styles: Record<string, string>) {
        for (const [name, value] of Object.entries(styles)) {
            this.attrs[`style:${name}`] = value;
        }
        return this;
    }

    setCssProps(props: Record<string, string>) {
        for (const [name, value] of Object.entries(props)) {
            this.attrs[`css:${name}`] = value;
        }
        return this;
    }

    appendChild(child: MockDomNode) {
        this.children.push(child);
        return child;
    }

    appendText(text: string) {
        this.innerText += text;
        this.textContent += text;
    }

    createEl(tagName: string, options?: MockElOptions | undefined, callback?: (element: MockDomNode) => void) {
        const child = new MockDomNode(tagName);
        if (options?.text) child.setText(options.text);
        if (options?.cls) {
            child.classes = Array.isArray(options.cls) ? [...options.cls] : [options.cls];
        }
        if (options?.attr) {
            for (const [name, value] of Object.entries(options.attr)) {
                child.setAttr(name, value);
            }
        }
        this.children.push(child);
        callback?.(child);
        return child;
    }

    createDiv(options?: MockElOptions | undefined, callback?: (element: MockDomNode) => void) {
        return this.createEl('div', options, callback);
    }

    empty() {
        this.children = [];
    }

    createSpan(options?: MockElOptions) {
        return this.createEl('span', options);
    }

    findAll(selector: string): MockDomNode[] {
        const selectorGroups = selector.split(',').map((part) => part.trim()).filter(Boolean);
        const matches = (node: MockDomNode, part: string): boolean => {
            if (part.includes(' ')) {
                return matches(node, part.split(/\s+/).pop() ?? part);
            }
            if (part.startsWith('.')) {
                return node.classes.includes(part.slice(1));
            }
            return node.tagName.toLowerCase() === part.toLowerCase();
        };
        const results: MockDomNode[] = [];
        const walk = (node: MockDomNode): void => {
            for (const child of node.children) {
                if (selectorGroups.some((part) => matches(child, part))) {
                    results.push(child);
                }
                walk(child);
            }
        };
        walk(this);
        return results;
    }
}

class MockContainerEl extends MockDomNode {
    empty = jest.fn(() => {
        this.children = [];
    });
}

type MockToggleRecord = { value?: boolean; disabled?: boolean; onChange?: (value: boolean) => unknown };
type MockDropdownRecord = {
    value?: string;
    options: Array<{ value: string; text: string }>;
    onChange?: (value: string) => unknown;
};
type MockButtonRecord = { text?: string; disabled?: boolean; onClick?: () => unknown | Promise<unknown> };
type MockTextRecord = {
    value?: unknown;
    placeholder?: string;
    onChange?: (value: string) => unknown;
    setValueCalls: unknown[];
};
type MockColorPickerRecord = {
    value?: string;
    onChange?: (value: string) => unknown;
    setValueCalls: unknown[];
};
type MockSettingRecord = {
    name?: string;
    desc?: string;
    toggles: Array<MockToggleRecord>;
    dropdowns: Array<MockDropdownRecord>;
    buttons: Array<MockButtonRecord>;
    texts: Array<MockTextRecord>;
    colorPickers: Array<MockColorPickerRecord>;
};
type MockDebounceRecord = { calls: unknown[][]; cancelled: number; runs: number; pending: boolean; lastArgs?: unknown[] };
function getMockDebounceRecords(): MockDebounceRecord[] {
    const globalObj = globalThis as typeof globalThis & { __paDebounceRecords?: MockDebounceRecord[] };
    globalObj.__paDebounceRecords = globalObj.__paDebounceRecords ?? [];
    return globalObj.__paDebounceRecords;
}

function getMockSettingRecords(): MockSettingRecord[] {
    const globalObj = globalThis as typeof globalThis & { __paSettingRecords?: MockSettingRecord[] };
    globalObj.__paSettingRecords = globalObj.__paSettingRecords ?? [];
    return globalObj.__paSettingRecords;
}

function installMockDocument() {
    const documentMock = {
        createElement: (tagName: string) => new MockDomNode(tagName),
        createDocumentFragment: () => new MockDomNode('fragment'),
    };
    (globalThis as unknown as { document: unknown }).document = documentMock;
}

function makeMockApp() {
    return {
        secretStorage: {
            setSecret: jest.fn(),
            getSecret: jest.fn((_id: string): string | null => null),
            listSecrets: jest.fn(() => []),
        },
    };
}

function makePlugin(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
    return {
        manifest: {
            version: '2.8.0',
        },
        settings: {
            ...DEFAULT_SETTINGS,
            localGraph: {
                ...DEFAULT_SETTINGS.localGraph,
                resizeStyle: { ...DEFAULT_SETTINGS.localGraph.resizeStyle },
            },
            colorGroups: DEFAULT_SETTINGS.colorGroups.map((group) => ({
                ...group,
                color: { ...group.color },
            })),
            metadatas: DEFAULT_SETTINGS.metadatas.map((metadata) => ({ ...metadata })),
            ...overrides,
        },
        saveSettings: jest.fn(async () => undefined),
        clearTokenCache: jest.fn(),
        log: jest.fn(),
        memoryManager: {
            updateFromCommand: jest.fn(async () => undefined),
            prepareFromCommand: jest.fn(async () => undefined),
            scheduleReconcile: jest.fn(),
            scheduleAutoFlush: jest.fn(),
        },
        updateMemoryStatusBar: jest.fn(async () => undefined),
        runManualMemoryAction: jest.fn(async (action: () => Promise<void>) => { await action(); }),
        vss: {
            resetLocalIndex: jest.fn(async () => undefined),
            cleanLegacyJsonCache: jest.fn(async () => undefined),
        },
        showTechnicalMemoryStatus: jest.fn(async () => undefined),
        canShowAiInsights: jest.fn(() => true),
        showAiInsights: jest.fn(),
        getAPITokenSecretId: jest.fn(() => 'pa-api-token-vault-test'),
        getConfiguredAPITokenSecret: jest.fn<() => string | null>(() => null),
        setAPITokenSecret: jest.fn(),
        statsManager: {
            setStatisticsSyncEnabled: jest.fn(async () => undefined),
        },
    };
}

beforeEach(() => {
    getMockSettingRecords().length = 0;
    getMockDebounceRecords().length = 0;
    installMockDocument();
});

class MockDescription {
    text = '';

    setText(text: string) {
        this.text = text;
        return this;
    }
}

class MockToggle {
    disabled = false;

    setDisabled(disabled: boolean) {
        this.disabled = disabled;
        return this;
    }
}

describe('Qwen response option settings', () => {
    it('refreshes DashScope-only option availability when the base URL changes', () => {
        const description = new MockDescription();
        const toggles = [new MockToggle(), new MockToggle()];

        expect(updateQwenResponseOptionAvailability(
            'https://dashscope.aliyuncs.com/compatible-mode/v1',
            description,
            toggles,
        )).toBe(true);
        expect(description.text).toContain('Qwen thinking and builtin WebSearch require Alibaba Cloud DashScope');
        expect(toggles.map((toggle) => toggle.disabled)).toEqual([false, false]);

        expect(updateQwenResponseOptionAvailability(
            'https://example.invalid/compatible-mode/v1',
            description,
            toggles,
        )).toBe(false);
        expect(description.text).toContain('available only with the DashScope OpenAI-compatible base URL');
        expect(toggles.map((toggle) => toggle.disabled)).toEqual([true, true]);

        expect(updateQwenResponseOptionAvailability(
            'https://dashscope.aliyuncs.com/compatible-mode/v1/',
            description,
            toggles,
        )).toBe(true);
        expect(toggles.map((toggle) => toggle.disabled)).toEqual([false, false]);
    });
});

describe('Statistics settings copy', () => {
    it('explains sync without exposing storage internals', () => {
        expect(STATISTICS_SYNC_SETTING_DESC).toContain('writing history can sync across devices');
        expect(STATISTICS_SYNC_SETTING_DESC).toContain('ongoing Git changes from synced history');
        expect(STATISTICS_SYNC_SETTING_DESC).not.toMatch(/jsonl|v2|shard|indexeddb|deviceid/i);
    });
});

describe('PA Agent telemetry settings', () => {
    it('keeps anonymous capability usage sharing disabled by default', () => {
        expect(DEFAULT_SETTINGS.shareAnonymousCapabilityUsage).toBe(false);
    });

    it('keeps the optional policy model unset by default', () => {
        expect(DEFAULT_SETTINGS.policyModelName).toBe('');
    });

    it('renders policy model privacy copy in settings', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const policyModel = getMockSettingRecords()
            .find((record) => record.name === 'Policy model name');
        expect(policyModel?.desc).toContain('Sends your request and explicit context to your AI provider');
        expect(policyModel?.desc).toContain('hidden vault content is not sent');
        expect(policyModel?.desc).toContain('Blank uses local fallback rules');
    });

    it('keeps settings text inputs right-aligned with consistent width', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');

        expect(css).not.toContain(':has(');
        expect(css).toContain('.pa-settings-tab .setting-item.pa-setting-has-form-control');
        expect(css).toMatch(/\.pa-settings-tab\s+\.setting-item\.pa-setting-has-form-control\s*{[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*clamp\(20px,\s*4vw,\s*64px\);/);
        expect(css).toMatch(/\.pa-settings-tab\s+\.setting-item\.pa-setting-has-form-control\s+\.setting-item-control\s*{[\s\S]*?flex:\s*0 0 clamp\(280px,\s*44%,\s*560px\);[\s\S]*?justify-content:\s*flex-end;[\s\S]*?min-width:\s*240px;/);
        expect(css).toMatch(/\.pa-settings-tab\s+\.setting-item\.pa-setting-has-form-control\s+\.setting-item-control\s+input,[\s\S]*?\.pa-settings-tab\s+\.setting-item\.pa-setting-has-form-control\s+\.setting-item-control\s+select\s*{[\s\S]*?width:\s*100%;/);
        expect(css).toMatch(/@media\s+\(max-width:\s*700px\)\s*{[\s\S]*?\.pa-settings-tab\s+\.setting-item\.pa-setting-has-form-control[\s\S]*?flex-direction:\s*column;[\s\S]*?\.setting-item-control[\s\S]*?width:\s*100%;/);
    });
});

describe('Operations Agent disabled rollout', () => {
    it('keeps Operations Agent unavailable even if legacy data had it enabled', () => {
        expect(OPERATIONS_AGENT_RUNTIME_ENABLED).toBe(false);
        expect(DEFAULT_SETTINGS.operationsAgentEnabled).toBe(false);
        expect(mergeLoadedSettings({ operationsAgentEnabled: true }).operationsAgentEnabled).toBe(false);
    });

    it('does not render the Operations Agent settings entry', () => {
        const plugin = makePlugin({ operationsAgentEnabled: true });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const names = getMockSettingRecords().map((record) => record.name);
        expect(names).not.toContain('Operations Agent Mode (Beta)');
    });
});

describe('settings form-control styling hooks', () => {
    it('reapplies form-control classes after dynamic settings rebuilds', () => {
        const source = readFileSync('src/settings.ts', 'utf8');
        const methodBody = (name: string) => {
            const start = source.indexOf(`    private ${name}(`);
            expect(start).toBeGreaterThanOrEqual(0);
            const next = source.indexOf('\n    private ', start + 1);
            return source.slice(start, next === -1 ? undefined : next);
        };

        for (const name of [
            'rebuildProviderConfig',
            'rebuildGraphColors',
            'rebuildMetadataList',
            'rebuildMemoryAdvanced',
            'rebuildFeaturedImage',
        ]) {
            expect(methodBody(name)).toContain('this.markFormControlSettings(container);');
        }
    });
});

describe('PA Agent builtin WebSearch settings', () => {
    it('uses the builtin WebSearch setting and does not expose the legacy provider web setting', () => {
        expect(DEFAULT_SETTINGS.webSearchEnabled).toBe(false);
        expect(DEFAULT_SETTINGS).not.toHaveProperty('qwenWebSearchEnabled');
    });

    it('renders builtin WebSearch as a DashScope-only Qwen option', () => {
        const plugin = makePlugin({
            aiProvider: 'qwen',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            webSearchEnabled: true,
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const webSearchToggle = getMockSettingRecords()
            .find((record) => record.name === 'Enable builtin WebSearch tool')?.toggles[0];
        expect(webSearchToggle).toMatchObject({ value: true, disabled: false });
    });

    it('disables builtin WebSearch when Qwen is not using DashScope', () => {
        const plugin = makePlugin({
            aiProvider: 'qwen',
            baseURL: 'https://example.com/compatible-mode/v1',
            webSearchEnabled: true,
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const webSearchToggle = getMockSettingRecords()
            .find((record) => record.name === 'Enable builtin WebSearch tool')?.toggles[0];
        expect(webSearchToggle).toMatchObject({ value: true, disabled: true });
    });
});

describe('PA Agent skill settings', () => {
    it('enables bundled skill guides by default', () => {
        expect(DEFAULT_SETTINGS.skillContextEnabled).toBe(true);
        expect(DEFAULT_SETTINGS.enabledSkillIds).toEqual([
            'obsidian-markdown',
            'obsidian-bases',
            'json-canvas',
            'pa-frontmatter-audit',
            'pa-callout-cleanup',
            'pa-vault-link-health',
            'pa-plugin-config-review',
            'obsidian-dataview',
            'obsidian-templater',
        ]);
    });

    it('normalizes enabled skill ids to known bundled skills', () => {
        expect(normalizeEnabledSkillIds(['obsidian-markdown', 'unknown', 'obsidian-markdown'])).toEqual([
            'obsidian-markdown',
        ]);
        expect(normalizeEnabledSkillIds(undefined)).toEqual(DEFAULT_SETTINGS.enabledSkillIds);
    });

    it('renders global and bundled skill guide toggles in settings', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const records = getMockSettingRecords();
        const globalToggle = records.find((record) => record.name === 'Use skill guides')?.toggles[0];
        expect(globalToggle).toMatchObject({ value: true, disabled: false });

        const skillToggleStates = BUNDLED_SKILL_CATALOG.map((skill) => {
            const record = records.find((entry) => entry.name === skill.label);
            return record?.toggles[0];
        });
        expect(skillToggleStates).toHaveLength(BUNDLED_SKILL_CATALOG.length);
        expect(skillToggleStates).toEqual(
            BUNDLED_SKILL_CATALOG.map(() => expect.objectContaining({ value: true, disabled: false })),
        );
        expect(skillToggleStates.every(Boolean)).toBe(true);
    });

    it('disables bundled skill guide toggles when the global switch is off', () => {
        const plugin = makePlugin({ skillContextEnabled: false });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const records = getMockSettingRecords();
        for (const skill of BUNDLED_SKILL_CATALOG) {
            expect(records.find((entry) => entry.name === skill.label)?.toggles[0]).toMatchObject({
                value: false,
                disabled: true,
            });
        }
    });
});

describe('Phase 1 refactor invariants', () => {
    type SettingTabInternals = {
        rebuildGraphColors: () => void;
        rebuildProviderConfig: () => void;
        graphColorsContainer: unknown;
        metadataContainer: unknown;
        providerConfigContainer: unknown;
        skillTogglesContainer: unknown;
        featuredImageContainer: unknown;
        memoryAdvancedContainer: unknown;
    };

    it('renders graph colors with the native color picker component', () => {
        const plugin = makePlugin({ enableGraphColors: true });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const record = getMockSettingRecords()
            .find((entry) => entry.desc === 'This will be the Color used in the graph view.');
        expect(record?.colorPickers[0]).toMatchObject({
            value: '#64fa64',
        });
    });

    it('graph color picker saves the normalized color and rebuilds the graph color section', async () => {
        const plugin = makePlugin({ enableGraphColors: true });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const initialRecordCount = getMockSettingRecords().length;
        const record = getMockSettingRecords()
            .find((entry) => entry.desc === 'This will be the Color used in the graph view.');
        const colorPicker = record?.colorPickers[0];

        await Promise.resolve(colorPicker?.onChange?.('#123456'));

        expect(plugin.settings.colorGroups[0].color.rgb).toBe(0x123456);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(getMockSettingRecords().length).toBeGreaterThan(initialRecordCount);
        const latestGraphColorRecord = [...getMockSettingRecords()]
            .reverse()
            .find((entry) => entry.desc === 'This will be the Color used in the graph view.');
        expect(latestGraphColorRecord?.colorPickers[0]?.value).toBe('#123456');
    });

    it('switching AI provider runs rebuildProviderConfig — not full display()', async () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const records = getMockSettingRecords();
        const providerDropdown = records.find((record) => record.name === 'AI Provider')?.dropdowns[0];
        expect(providerDropdown?.onChange).toBeDefined();

        const internals = tab as unknown as SettingTabInternals;
        const displaySpy = jest.spyOn(tab, 'display');
        const rebuildSpy = jest.spyOn(internals, 'rebuildProviderConfig');

        setMockConfirmDecision(true);
        await providerDropdown!.onChange!('openai');

        expect(rebuildSpy).toHaveBeenCalledTimes(1);
        expect(displaySpy).not.toHaveBeenCalled();
    });

    it('toggling Advanced memory controls leaves sibling sub-container refs intact', async () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const internals = tab as unknown as SettingTabInternals;
        const before = {
            graph: internals.graphColorsContainer,
            metadata: internals.metadataContainer,
            provider: internals.providerConfigContainer,
            skills: internals.skillTogglesContainer,
            featured: internals.featuredImageContainer,
        };

        const records = getMockSettingRecords();
        const advancedToggle = records.find((record) => record.name === 'Advanced memory controls')?.toggles[0];
        expect(advancedToggle?.onChange).toBeDefined();

        const displaySpy = jest.spyOn(tab, 'display');

        await advancedToggle!.onChange!(true);

        expect(displaySpy).not.toHaveBeenCalled();
        // Sibling sub-container refs preserved across the rebuild.
        expect(internals.graphColorsContainer).toBe(before.graph);
        expect(internals.metadataContainer).toBe(before.metadata);
        expect(internals.providerConfigContainer).toBe(before.provider);
        expect(internals.skillTogglesContainer).toBe(before.skills);
        expect(internals.featuredImageContainer).toBe(before.featured);
    });
});

describe('safeParseInt', () => {
    it('returns the parsed value when valid and at or above min', () => {
        expect(safeParseInt('5', 99, 1)).toBe(5);
        expect(safeParseInt('1', 99, 1)).toBe(1);
        expect(safeParseInt('500', 100, 1)).toBe(500);
    });

    it('falls back when input is empty or non-numeric', () => {
        expect(safeParseInt('', 7, 1)).toBe(7);
        expect(safeParseInt('abc', 7, 1)).toBe(7);
        expect(safeParseInt('  ', 7, 1)).toBe(7);
    });

    it('falls back when parseInt would yield NaN', () => {
        expect(safeParseInt(undefined as unknown as string, 3, 1)).toBe(3);
        expect(safeParseInt(null as unknown as string, 3, 1)).toBe(3);
    });

    it('falls back when value is below min', () => {
        expect(safeParseInt('0', 5, 1)).toBe(5);
        expect(safeParseInt('-1', 5, 1)).toBe(5);
        expect(safeParseInt('-100', 5, 1)).toBe(5);
    });

    it('accepts zero when min allows it', () => {
        expect(safeParseInt('0', 5, 0)).toBe(0);
    });

    it('parses with radix 10 — leading-zero strings are decimal, not octal', () => {
        // Pre-ES5 parseInt would have read "010" as octal 8. parseInt(value, 10)
        // makes the radix explicit; this test pins that contract so a future
        // refactor cannot silently revert to radix-inference.
        expect(safeParseInt('010', 99, 0)).toBe(10);
        expect(safeParseInt('0100', 99, 0)).toBe(100);
    });

    it('does not interpret 0x prefix as hexadecimal', () => {
        // Without an explicit radix, parseInt('0x10') would return 16. With
        // radix 10, parseInt stops at the "x" and yields 0 (leading "0"). The
        // important contract is that 0x10 is *never* read as 16. With min=1
        // the 0 is below min and the fallback wins; with min=0 it returns 0.
        expect(safeParseInt('0x10', 7, 1)).toBe(7);
        expect(safeParseInt('0x10', 7, 0)).toBe(0);
    });

    it('clamps values to max when provided', () => {
        expect(safeParseInt('500', 7, 1, 100)).toBe(100);
        expect(safeParseInt('42', 7, 1, 100)).toBe(42);
    });
});

describe('mergeLoadedSettings (Phase 2 deep merge)', () => {
    it('returns DEFAULT_SETTINGS when data.json is empty or missing', () => {
        expect(mergeLoadedSettings(undefined).localGraph).toEqual(DEFAULT_SETTINGS.localGraph);
        expect(mergeLoadedSettings(null).localGraph).toEqual(DEFAULT_SETTINGS.localGraph);
        expect(mergeLoadedSettings({}).localGraph).toEqual(DEFAULT_SETTINGS.localGraph);
    });

    it('preserves localGraph defaults when only one nested field is set', () => {
        const merged = mergeLoadedSettings({ localGraph: { depth: 9 } });
        expect(merged.localGraph.depth).toBe(9);
        expect(merged.localGraph.showTags).toBe(DEFAULT_SETTINGS.localGraph.showTags);
        expect(merged.localGraph.showAttach).toBe(DEFAULT_SETTINGS.localGraph.showAttach);
        expect(merged.localGraph.showNeighbor).toBe(DEFAULT_SETTINGS.localGraph.showNeighbor);
        expect(merged.localGraph.collapse).toBe(DEFAULT_SETTINGS.localGraph.collapse);
        expect(merged.localGraph.autoColors).toBe(DEFAULT_SETTINGS.localGraph.autoColors);
        expect(merged.localGraph.resizeStyle).toEqual(DEFAULT_SETTINGS.localGraph.resizeStyle);
    });

    it('preserves resizeStyle defaults when only one dimension is set', () => {
        const merged = mergeLoadedSettings({
            localGraph: { resizeStyle: { width: 800 } },
        });
        expect(merged.localGraph.resizeStyle.width).toBe(800);
        expect(merged.localGraph.resizeStyle.height).toBe(DEFAULT_SETTINGS.localGraph.resizeStyle.height);
    });

    it('keeps top-level overrides (debug, etc.)', () => {
        const merged = mergeLoadedSettings({ debug: true });
        expect(merged.debug).toBe(true);
    });

    it('treats arrays as opaque user values (no element-level merge)', () => {
        const merged = mergeLoadedSettings({ colorGroups: [] });
        expect(merged.colorGroups).toEqual([]);
    });

    it('falls back to defaults when array-backed settings are malformed', () => {
        const merged = mergeLoadedSettings({ colorGroups: 'corrupted' as unknown });
        expect(merged.colorGroups).toEqual(DEFAULT_SETTINGS.colorGroups);
    });

    it('uses the mock license tier regardless of persisted licenseTier data', () => {
        expect(DEFAULT_SETTINGS.licenseTier).toBe(MOCK_LICENSE_TIER);
        expect(mergeLoadedSettings({}).licenseTier).toBe(MOCK_LICENSE_TIER);
        expect(mergeLoadedSettings({ licenseTier: 'free' }).licenseTier).toBe(MOCK_LICENSE_TIER);
        expect(mergeLoadedSettings({ licenseTier: 'trial' }).licenseTier).toBe(MOCK_LICENSE_TIER);
    });
});

describe('Phase 2 P0 data integrity', () => {
    it('isEnabledMetadataUpdating is no longer a persisted setting', () => {
        expect(DEFAULT_SETTINGS).not.toHaveProperty('isEnabledMetadataUpdating');
        // The user-facing toggle is unchanged.
        expect(DEFAULT_SETTINGS).toHaveProperty('enableMetadataUpdating');
    });

    it('rejects empty metadata key on Add and does not mutate settings', async () => {
        const plugin = makePlugin({ enableMetadataUpdating: true });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const addRecord = records.find((record) => record.name === 'Add Key:Value in frontmatter');
        expect(addRecord).toBeDefined();
        const addButton = addRecord!.buttons.find((button) => button.text === 'Add');
        expect(addButton?.onClick).toBeDefined();

        const beforeLength = plugin.settings.metadatas.length;
        const beforeSaveCount = plugin.saveSettings.mock.calls.length;

        await addButton!.onClick!();

        expect(plugin.settings.metadatas).toHaveLength(beforeLength);
        expect(plugin.saveSettings.mock.calls.length).toBe(beforeSaveCount);
    });

    it('initializes the metadata Add dropdown with the "string" type', () => {
        const plugin = makePlugin({ enableMetadataUpdating: true });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const addRecord = records.find((record) => record.name === 'Add Key:Value in frontmatter');
        expect(addRecord?.dropdowns[0]?.value).toBe('string');
    });
});

type SecretRecord = { value?: string; onChange?: (value: string) => unknown };
function getMockSecretRecords(): SecretRecord[] {
    const globalObj = globalThis as typeof globalThis & { __paSecretRecords?: SecretRecord[] };
    globalObj.__paSecretRecords = globalObj.__paSecretRecords ?? [];
    return globalObj.__paSecretRecords;
}

function setMockConfirmDecision(decision: boolean | undefined) {
    const globalObj = globalThis as typeof globalThis & { __paConfirmDecision?: boolean };
    if (decision === undefined) {
        delete globalObj.__paConfirmDecision;
    } else {
        globalObj.__paConfirmDecision = decision;
    }
}

describe('isFreshInstall', () => {
    it('treats null and undefined as fresh installs', () => {
        expect(isFreshInstall(null)).toBe(true);
        expect(isFreshInstall(undefined)).toBe(true);
    });

    it('treats an empty object as a fresh install', () => {
        expect(isFreshInstall({})).toBe(true);
    });

    it('treats any persisted field as not a fresh install', () => {
        expect(isFreshInstall({ aiProvider: 'qwen' })).toBe(false);
        expect(isFreshInstall({ debug: false })).toBe(false);
    });

    it('treats non-object input as not fresh', () => {
        // Defensive: a corrupted data.json that returns a primitive should not
        // silently nuke the user's config by being labelled "fresh".
        expect(isFreshInstall('garbage')).toBe(false);
        expect(isFreshInstall(42)).toBe(false);
    });

    it('rejects arrays even when empty', () => {
        // A persisted [] is malformed, not absent — treating it as fresh
        // would let the loader run with no migration signal at all.
        expect(isFreshInstall([])).toBe(false);
        expect(isFreshInstall([{ aiProvider: 'qwen' }])).toBe(false);
    });
});

describe('isLegacyV1Install', () => {
    it('returns true only for non-empty objects missing aiProvider', () => {
        // Legacy v1.x persisted data without an aiProvider field.
        expect(isLegacyV1Install({ debug: false, modelName: 'qwen-plus' })).toBe(true);
    });

    it('returns false for fresh installs (null, undefined, empty object)', () => {
        expect(isLegacyV1Install(null)).toBe(false);
        expect(isLegacyV1Install(undefined)).toBe(false);
        expect(isLegacyV1Install({})).toBe(false);
    });

    it('returns false when aiProvider is set (any value, including empty string)', () => {
        // Empty string means "user cleared their provider via the new chooser",
        // not "legacy install" — must not re-trigger the qwen migration.
        expect(isLegacyV1Install({ aiProvider: '' })).toBe(false);
        expect(isLegacyV1Install({ aiProvider: 'qwen' })).toBe(false);
        expect(isLegacyV1Install({ aiProvider: 'openai' })).toBe(false);
    });

    it('returns false for arrays and primitives', () => {
        expect(isLegacyV1Install([])).toBe(false);
        expect(isLegacyV1Install([{ debug: false }])).toBe(false);
        expect(isLegacyV1Install('garbage')).toBe(false);
        expect(isLegacyV1Install(42)).toBe(false);
    });
});

describe('PROVIDER_PRESETS catalog', () => {
    it('exposes qwen, qwen-intl, openai, and custom entries', () => {
        expect(Object.keys(PROVIDER_PRESETS).sort()).toEqual(
            ['custom', 'openai', 'qwen', 'qwen-intl'].sort(),
        );
    });

    it('uses gpt-4o-mini as the OpenAI default chat model', () => {
        expect(PROVIDER_PRESETS.openai.chatModelName).toBe('gpt-4o-mini');
        expect(PROVIDER_PRESETS.openai.embeddingModelName).toBe('text-embedding-3-small');
    });

    it('uses qwen3.6-plus as the Qwen default chat model', () => {
        expect(DEFAULT_SETTINGS.chatModelName).toBe('qwen3.6-plus');
        expect(PROVIDER_PRESETS.qwen.chatModelName).toBe('qwen3.6-plus');
        expect(PROVIDER_PRESETS['qwen-intl'].chatModelName).toBe('qwen3.6-plus');
    });

    it('maps qwen-intl to a different baseURL but same runtime provider', () => {
        expect(PROVIDER_PRESETS['qwen-intl'].runtimeProvider).toBe('qwen');
        expect(PROVIDER_PRESETS['qwen-intl'].baseURL).not.toBe(PROVIDER_PRESETS.qwen.baseURL);
    });

    it('keeps the custom preset blank so it does not overwrite user values', () => {
        expect(PROVIDER_PRESETS.custom.baseURL).toBe('');
        expect(PROVIDER_PRESETS.custom.chatModelName).toBe('');
        expect(PROVIDER_PRESETS.custom.embeddingModelName).toBe('');
    });
});

describe('deriveDisplayPreset', () => {
    it('returns "qwen" for the China DashScope baseURL with qwen runtime', () => {
        expect(deriveDisplayPreset({
            aiProvider: 'qwen',
            baseURL: PROVIDER_PRESETS.qwen.baseURL,
        })).toBe('qwen');
    });

    it('returns "qwen-intl" for the international DashScope baseURL with qwen runtime', () => {
        expect(deriveDisplayPreset({
            aiProvider: 'qwen',
            baseURL: PROVIDER_PRESETS['qwen-intl'].baseURL,
        })).toBe('qwen-intl');
    });

    it('returns "openai" for openai runtime + openai baseURL', () => {
        expect(deriveDisplayPreset({
            aiProvider: 'openai',
            baseURL: PROVIDER_PRESETS.openai.baseURL,
        })).toBe('openai');
    });

    it('returns "custom" for openai runtime + non-openai baseURL', () => {
        expect(deriveDisplayPreset({
            aiProvider: 'openai',
            baseURL: 'https://my-proxy.example.com/v1',
        })).toBe('custom');
    });

    it('returns "custom" for qwen runtime + non-DashScope baseURL', () => {
        expect(deriveDisplayPreset({
            aiProvider: 'qwen',
            baseURL: 'https://my-proxy.example.com/v1',
        })).toBe('custom');
    });
});

describe('Phase 3 IA reorder + provider UX', () => {
    type PhaseThreeInternals = {
        providerConfigContainer: { children: { tagName: string; classes?: string[]; textContent?: string }[] } | null;
    };

    beforeEach(() => {
        setMockConfirmDecision(undefined);
        const records = getMockSecretRecords();
        records.length = 0;
        (confirmUserAction as jest.Mock).mockClear();
    });

    it('display() renders sections in the new IA order (h1/h2/h3 + featured image)', () => {
        // Use qwen so the otherwise-empty Featured Image section actually emits
        // a Setting we can locate in the order check.
        const plugin = makePlugin({ aiProvider: 'qwen' });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        // Walk every top-level child of containerEl in render order. Heading
        // tags (h1/h2/h3) are kept by their textContent; the Featured Image
        // section emits its content under a div sub-container with no heading,
        // so we mark it via the "AI Featured Image Path" Setting record's
        // index in the Setting render queue and reconstruct ordering by
        // scanning for the matching div.
        const children = (tab.containerEl as unknown as { children: { tagName: string; textContent?: string; children?: unknown[] }[] }).children;
        const headingTags = new Set(['h1', 'h2', 'h3']);
        const sectionLabels: string[] = [];
        for (const child of children) {
            if (headingTags.has(child.tagName)) {
                sectionLabels.push(`${child.tagName}:${child.textContent ?? ''}`);
            }
        }

        // Skills uses h3, all others h2; the only un-titled section is
        // Featured Image, which we verify separately below.
        expect(sectionLabels).toEqual([
            'h1:Settings for Obsidian Assistant',
            'h2:AI Assistant',
            // Qwen response options is an h3 nested under the AI section's
            // qwenOptionsContainer (not a top-level child), so it is absent here.
            'h3:Skill guides',
            'h2:Memory',
            // Pagelet section ships between Memory and Statistics (B3). Its
            // three sub-headings (General/Model/Limits) are also top-level
            // children of containerEl because `renderPageletSection` writes
            // them onto the same parent as the h2.
            'h2:Pagelet',
            'h3:General',
            'h3:Model',
            'h3:Limits',
            'h3:Pet',
            'h3:Background Review Preparation',
            'h3:Reviews',
            'h3:Quiet Hours',
            'h3:Foreground Cost',
            'h2:Vault Statistics',
            'h2:Settings for Record',
            'h2:Settings for Hover Local Graph',
            'h2:Graph Colors',
            'h2:Metadata Management',
            // No heading between Metadata and Advanced — that gap is the
            // Featured Image section, asserted via Setting records below.
            'h2:Advanced',
            'h2:Legal / About',
        ]);

        // Featured Image lives between Metadata Management and Advanced. With
        // aiProvider='qwen' it renders a single "AI Featured Image Path" Setting.
        // Use the Setting record list to confirm it falls in that gap, between
        // the metadata section's only default-rendered Setting ("Enable
        // Updating Metadata") and Advanced's Debug toggle.
        const settingNames = getMockSettingRecords().map((r) => r.name);
        const featuredIdx = settingNames.indexOf('AI Featured Image Path');
        const metadataIdx = settingNames.indexOf('Enable Updating Metadata');
        const debugIdx = settingNames.indexOf('Debug');
        expect(featuredIdx).toBeGreaterThan(-1);
        expect(metadataIdx).toBeGreaterThan(-1);
        expect(debugIdx).toBeGreaterThan(-1);
        expect(featuredIdx).toBeGreaterThan(metadataIdx);
        expect(featuredIdx).toBeLessThan(debugIdx);

        const featuredSetting = getMockSettingRecords()[featuredIdx];
        expect(featuredSetting.desc).toContain('AI featured image helper');
        expect(featuredSetting.texts[0].placeholder).toBe('attachments/ai-images');
    });

    it('renders Legal links from the plugin version without terms placeholders', () => {
        const globalWithWindow = globalThis as unknown as {
            window?: Pick<Window, 'open'>;
        };
        const originalWindow = globalWithWindow.window;
        const openMock = jest.fn((
            _url?: string | URL,
            _target?: string,
            _features?: string,
        ): Window | null => null);
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            writable: true,
            value: { open: openMock },
        });
        const plugin = makePlugin();
        plugin.manifest.version = '9.9.9-test.1';
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        try {
            tab.display();

            const legalLinks = buildPaLegalLinks(plugin.manifest.version);
            for (const url of Object.values(legalLinks)) {
                expect(url).toContain('9.9.9-test.1');
                expect(url).not.toContain('2.8.0');
            }

            const records = getMockSettingRecords();
            const names = records.map((record) => record.name);
            expect(names).toEqual(expect.arrayContaining([
                'Source code',
                'Source archive',
                'License',
                'Notices',
                'Third-party notices',
                'Network and privacy disclosure',
            ]));
            expect(names).not.toContain('Terms');
            expect(names).not.toContain('Privacy Policy');

            const expectedLinks = new Map([
                ['Source code', legalLinks.source],
                ['Source archive', legalLinks.sourceArchive],
                ['License', legalLinks.license],
                ['Notices', legalLinks.notice],
                ['Third-party notices', legalLinks.thirdPartyNotices],
                ['Network and privacy disclosure', legalLinks.networkPrivacyEn],
            ]);

            for (const [name, expectedUrl] of expectedLinks) {
                const button = records.find((record) => record.name === name)?.buttons[0];
                expect(button?.text).toBe('Open');
                button?.onClick?.();
                expect(openMock).toHaveBeenLastCalledWith(expectedUrl, '_blank', 'noopener,noreferrer');
            }
            expect(openMock).toHaveBeenCalledTimes(expectedLinks.size);
        } finally {
            if (originalWindow) {
                Object.defineProperty(globalThis, 'window', {
                    configurable: true,
                    writable: true,
                    value: originalWindow,
                });
            } else {
                Reflect.deleteProperty(globalWithWindow, 'window');
            }
        }
    });

    it('hides Featured Image settings when Qwen uses a non-DashScope custom endpoint', () => {
        const plugin = makePlugin({
            aiProvider: 'qwen',
            baseURL: 'https://my-proxy.example.com/v1',
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const settingNames = getMockSettingRecords().map((r) => r.name);
        expect(settingNames).not.toContain('AI Featured Image Path');
        expect(settingNames).not.toContain('AI Featured Images Generating Number');
    });

    it('Debug toggle moves out of the header into the Advanced section', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const debugRecord = records.find((record) => record.name === 'Debug');
        expect(debugRecord).toBeDefined();
        // Find Advanced section heading; Debug should be a sibling of (i.e.,
        // after) the Advanced h2, not at the top.
        const headings = records.map((record) => record.name);
        const debugIdx = headings.indexOf('Debug');
        const telemetryIdx = headings.indexOf('Share anonymous capability usage');
        expect(debugIdx).toBeGreaterThan(0);
        expect(telemetryIdx).toBeGreaterThan(debugIdx);
    });

    it('fresh install shows the placeholder option and hides the provider config', () => {
        const plugin = makePlugin({ aiProvider: '' });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const providerRecord = records.find((record) => record.name === 'AI Provider');
        const dropdown = providerRecord?.dropdowns[0];
        expect(dropdown).toBeDefined();
        expect(dropdown!.value).toBe('');
        // Placeholder option present and listed first.
        expect(dropdown!.options[0]).toMatchObject({ value: '', text: '-- Choose your AI provider --' });
        // Token, Base URL, Chat Model rows are absent until a provider is picked.
        expect(records.find((record) => record.name === 'API Token')).toBeUndefined();
        expect(records.find((record) => record.name === 'Base URL')).toBeUndefined();
        expect(records.find((record) => record.name === 'Chat Model Name')).toBeUndefined();

        // Provider config container shows the guidance prompt instead.
        const internals = tab as unknown as PhaseThreeInternals;
        const promptChild = internals.providerConfigContainer?.children.find(
            (child) => child.classes?.includes('pa-settings-provider-prompt'),
        );
        expect(promptChild).toBeDefined();
    });

    it('selecting a preset on fresh install applies preset baseURL and model', async () => {
        const plugin = makePlugin({ aiProvider: '' });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const dropdown = records.find((record) => record.name === 'AI Provider')?.dropdowns[0];
        expect(dropdown?.onChange).toBeDefined();

        await dropdown!.onChange!('qwen-intl');

        expect(plugin.settings.aiProvider).toBe('qwen');
        expect(plugin.settings.baseURL).toBe(PROVIDER_PRESETS['qwen-intl'].baseURL);
        expect(plugin.settings.chatModelName).toBe(PROVIDER_PRESETS['qwen-intl'].chatModelName);
        expect(plugin.settings.embeddingModelName).toBe(PROVIDER_PRESETS['qwen-intl'].embeddingModelName);
        // No confirmation needed when there is no prior preset to compare against.
        expect((confirmUserAction as jest.Mock)).not.toHaveBeenCalled();
    });

    it('switching to a new preset asks for confirmation when baseURL was customized', async () => {
        const plugin = makePlugin({
            aiProvider: 'qwen',
            baseURL: 'https://my-proxy.example.com/v1',
            chatModelName: 'qwen-plus',
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const dropdown = records.find((record) => record.name === 'AI Provider')?.dropdowns[0];
        expect(dropdown?.onChange).toBeDefined();
        // deriveDisplayPreset puts a custom-URL qwen install in the "custom" preset,
        // and switching from custom to anything is allowed without confirm — so
        // for this test we explicitly switch FROM the qwen preset (matching
        // baseURL) but with a custom chatModelName to trigger the prompt.
        plugin.settings.baseURL = PROVIDER_PRESETS.qwen.baseURL;
        plugin.settings.chatModelName = 'my-fine-tuned-qwen';

        setMockConfirmDecision(false);
        await dropdown!.onChange!('openai');

        expect(confirmUserAction).toHaveBeenCalledTimes(1);
        // Settings unchanged because user canceled.
        expect(plugin.settings.aiProvider).toBe('qwen');
        expect(plugin.settings.chatModelName).toBe('my-fine-tuned-qwen');
        // Dropdown reverted to derived preset.
        expect(dropdown!.value).toBe('qwen');
    });

    it('confirming the switch applies preset values', async () => {
        const plugin = makePlugin({
            aiProvider: 'qwen',
            baseURL: PROVIDER_PRESETS.qwen.baseURL,
            chatModelName: 'my-fine-tuned-qwen',
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const dropdown = records.find((record) => record.name === 'AI Provider')?.dropdowns[0];

        setMockConfirmDecision(true);
        await dropdown!.onChange!('openai');

        expect(plugin.settings.aiProvider).toBe('openai');
        expect(plugin.settings.baseURL).toBe(PROVIDER_PRESETS.openai.baseURL);
        expect(plugin.settings.chatModelName).toBe(PROVIDER_PRESETS.openai.chatModelName);
    });

    it('switching to "custom" confirms and preserves URL/model fields', async () => {
        const plugin = makePlugin({
            aiProvider: 'qwen',
            baseURL: PROVIDER_PRESETS.qwen.baseURL,
            chatModelName: 'qwen-plus',
            embeddingModelName: PROVIDER_PRESETS.qwen.embeddingModelName,
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const dropdown = records.find((record) => record.name === 'AI Provider')?.dropdowns[0];

        setMockConfirmDecision(true);
        await dropdown!.onChange!('custom');

        expect(confirmUserAction).toHaveBeenCalledTimes(1);
        // runtimeProvider for "custom" is "qwen"; URL/model fields are preserved.
        expect(plugin.settings.aiProvider).toBe('qwen');
        expect(plugin.settings.baseURL).toBe(PROVIDER_PRESETS.qwen.baseURL);
        expect(plugin.settings.chatModelName).toBe('qwen-plus');
        expect(plugin.settings.embeddingModelName).toBe(PROVIDER_PRESETS.qwen.embeddingModelName);
        expect(plugin.settings.aiProviderPreset).toBe('custom');
        // After re-render, dropdown should display "custom".
        expect(deriveDisplayPreset(plugin.settings)).toBe('custom');
    });

    it('leaving the custom preset prompts confirmation when user has values', async () => {
        // L1 review fix: previously the `prev.baseURL !== ""` guard short-
        // circuited the customization check whenever prevKey === "custom"
        // (since the custom preset's baseURL is ""), letting any switch
        // away from custom silently overwrite the user's values. Treat any
        // non-empty user value on the custom preset as customization.
        const plugin = makePlugin({
            aiProvider: 'qwen',
            // Both blank baseURL/chatModelName would put us on "custom" — but
            // here the user has typed in a private endpoint and a fine-tuned
            // model, which deriveDisplayPreset still classifies as custom
            // (URL doesn't match qwen/qwen-intl/openai presets).
            baseURL: 'https://my-vpc.example.com/v1',
            chatModelName: 'fine-tuned-llama',
        });
        // Sanity: prevKey resolves to "custom"
        expect(deriveDisplayPreset(plugin.settings)).toBe('custom');

        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const dropdown = records.find((record) => record.name === 'AI Provider')?.dropdowns[0];

        setMockConfirmDecision(false);
        await dropdown!.onChange!('openai');

        expect(confirmUserAction).toHaveBeenCalledTimes(1);
        // User canceled — settings unchanged.
        expect(plugin.settings.aiProvider).toBe('qwen');
        expect(plugin.settings.baseURL).toBe('https://my-vpc.example.com/v1');
        expect(plugin.settings.chatModelName).toBe('fine-tuned-llama');
    });

    it('switch confirmation copy mentions the Memory model and that the API token is kept', async () => {
        const plugin = makePlugin({
            aiProvider: 'qwen',
            baseURL: PROVIDER_PRESETS.qwen.baseURL,
            chatModelName: 'my-fine-tuned-qwen',
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const records = getMockSettingRecords();
        const dropdown = records.find((record) => record.name === 'AI Provider')?.dropdowns[0];

        setMockConfirmDecision(true);
        await dropdown!.onChange!('openai');

        const call = (confirmUserAction as jest.Mock).mock.calls[0];
        const options = call?.[1] as { title?: string; message?: string };
        expect(options?.message).toContain('Memory model');
        expect(options?.message).toContain('API token is kept');
    });

    it('ignores an empty API token change when no token is stored', async () => {
        const plugin = makePlugin({ aiProvider: 'qwen' });
        const app = makeMockApp();
        const tab = new SettingTab(app as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const secretRecords = getMockSecretRecords();
        expect(secretRecords).toHaveLength(1);
        const secret = secretRecords[0];
        expect(secret.onChange).toBeDefined();

        await secret.onChange!('');

        expect(confirmUserAction).not.toHaveBeenCalled();
        expect(app.secretStorage.setSecret).not.toHaveBeenCalled();
        expect(plugin.setAPITokenSecret).not.toHaveBeenCalled();
        expect(plugin.clearTokenCache).not.toHaveBeenCalled();
    });

    it('requires confirmation before clearing an existing API token', async () => {
        setMockConfirmDecision(false);
        const plugin = makePlugin({ aiProvider: 'qwen' });
        const app = makeMockApp();
        plugin.getConfiguredAPITokenSecret.mockReturnValue('sk-existing-token');
        const tab = new SettingTab(app as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const secret = getMockSecretRecords()[0];
        expect(secret.value).toBe('sk-existing-token');

        await secret.onChange!('');

        expect(confirmUserAction).toHaveBeenCalledTimes(1);
        expect(app.secretStorage.setSecret).not.toHaveBeenCalled();
        expect(plugin.setAPITokenSecret).not.toHaveBeenCalled();
        expect(secret.value).toBe('sk-existing-token');
        expect(plugin.clearTokenCache).not.toHaveBeenCalled();
    });

    it('clears API token through the plugin secret helper after confirmation', async () => {
        setMockConfirmDecision(true);
        const plugin = makePlugin({ aiProvider: 'qwen' });
        const app = makeMockApp();
        plugin.getConfiguredAPITokenSecret.mockReturnValue('sk-existing-token');
        const tab = new SettingTab(app as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        const secret = getMockSecretRecords()[0];

        await secret.onChange!('');

        expect(plugin.setAPITokenSecret).toHaveBeenCalledWith('');
    });

    it('refreshes the visible token row after saving through the custom API token modal', async () => {
        let storedToken: string | null = null;
        const plugin = makePlugin({ aiProvider: 'qwen' });
        const app = makeMockApp();
        plugin.getConfiguredAPITokenSecret.mockImplementation(() => storedToken);
        plugin.setAPITokenSecret.mockImplementation((value: unknown) => {
            const token = String(value);
            storedToken = token === '' ? null : token;
        });
        const tab = new SettingTab(app as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        expect(getMockSecretRecords()).toHaveLength(1);
        expect(getMockSecretRecords()[0].value).toBeUndefined();

        (tab as unknown as { openApiTokenSecretEditor(): void }).openApiTokenSecretEditor();
        const modalSecretInput = getMockSettingRecords()
            .flatMap((record) => record.texts)
            .find((text) => text.placeholder === 'sk-...');
        expect(modalSecretInput?.onChange).toBeDefined();
        modalSecretInput!.onChange!('sk-modal-token');

        const saveButton = [...getMockSettingRecords()]
            .reverse()
            .flatMap((record) => record.buttons)
            .find((button) => button.text === 'Save');
        expect(saveButton?.onClick).toBeDefined();
        await saveButton!.onClick!();

        expect(plugin.setAPITokenSecret).toHaveBeenCalledWith('sk-modal-token');
        const secretRecords = getMockSecretRecords();
        expect(secretRecords).toHaveLength(2);
        expect(secretRecords[1].value).toBe('sk-modal-token');
    });
});

describe('loadSettings + migrateSettings end-to-end (fresh / legacy / second-launch)', () => {
    // We don't instantiate the full PluginManager (huge mock surface). Instead
    // we replay the exact loadSettings → migrateSettings logic from src/plugin.ts
    // using the real helpers, so this guards against regressions in either
    // the helpers or the call-site wiring.
    function simulate(loaded: unknown): {
        settings: ReturnType<typeof mergeLoadedSettings>;
        migrationApplied: boolean;
    } {
        const fresh = isFreshInstall(loaded);
        const needsLegacyMigration = isLegacyV1Install(loaded);
        const settings = mergeLoadedSettings(loaded);
        const loadedObject = loaded && typeof loaded === 'object' && !Array.isArray(loaded)
            ? loaded as { modelName?: unknown }
            : {};
        const settingsWithLegacyModel = settings as typeof settings & { modelName?: unknown };
        const legacyModelName = typeof loadedObject.modelName === 'string'
            ? loadedObject.modelName.trim()
            : '';
        if (fresh) {
            settings.aiProvider = '';
        }

        let migrationApplied = false;
        if (needsLegacyMigration) {
            settings.aiProvider = 'qwen';
            settings.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
            settings.chatModelName = legacyModelName || DEFAULT_SETTINGS.chatModelName;
            settings.embeddingModelName = 'text-embedding-v3';
            migrationApplied = true;
        }
        if (
            legacyModelName
            && legacyModelName !== 'qwen-plus'
            && settings.chatModelName === DEFAULT_SETTINGS.chatModelName
        ) {
            settings.chatModelName = legacyModelName;
            migrationApplied = true;
        }
        if ('modelName' in settingsWithLegacyModel) {
            delete settingsWithLegacyModel.modelName;
            migrationApplied = true;
        }
        return { settings, migrationApplied };
    }

    it('fresh install (null data) → aiProvider stays empty, no migration', () => {
        const { settings, migrationApplied } = simulate(null);
        expect(migrationApplied).toBe(false);
        expect(settings.aiProvider).toBe('');
    });

    it('fresh install ({}) → aiProvider stays empty, no migration', () => {
        const { settings, migrationApplied } = simulate({});
        expect(migrationApplied).toBe(false);
        expect(settings.aiProvider).toBe('');
    });

    it('legacy v1.x install (no aiProvider field) migrates to qwen with proper defaults', () => {
        const legacyBlob = {
            // v1.x stored chat model in `modelName`, no `aiProvider` field.
            modelName: 'qwen-turbo',
            debug: false,
        };
        const { settings, migrationApplied } = simulate(legacyBlob);
        expect(migrationApplied).toBe(true);
        expect(settings.aiProvider).toBe('qwen');
        expect(settings.baseURL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
        // The legacy modelName field is preferred over the current default fallback.
        expect(settings.chatModelName).toBe('qwen-turbo');
        expect(settings.embeddingModelName).toBe('text-embedding-v3');
        expect(settings).not.toHaveProperty('modelName');
    });

    it('legacy v1.x install with no modelName falls back to the current Qwen default', () => {
        const { settings, migrationApplied } = simulate({ debug: false });
        expect(migrationApplied).toBe(true);
        expect(settings.chatModelName).toBe('qwen3.6-plus');
        expect(settings).not.toHaveProperty('modelName');
    });

    it('post-fresh second launch: persisted aiProvider:"" must NOT re-trigger migration', () => {
        // After a fresh install, the user opens settings and the plugin saves
        // the merged blob to disk. That blob now has an explicit `aiProvider`
        // field (empty string, because the user has not picked a provider yet).
        // The next load must keep aiProvider blank instead of silently
        // overwriting it with the legacy "qwen" default.
        const persistedAfterFreshSave = {
            aiProvider: '',
            debug: false,
            // Other defaults baked in by mergeLoadedSettings on first save.
            statisticsType: 'word',
        };
        const { settings, migrationApplied } = simulate(persistedAfterFreshSave);
        expect(migrationApplied).toBe(false);
        expect(settings.aiProvider).toBe('');
    });

    it('post-migration second launch: aiProvider:"qwen" stays put, no re-migration', () => {
        const persistedAfterMigration = {
            aiProvider: 'qwen',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            chatModelName: 'qwen3.6-plus',
            embeddingModelName: 'text-embedding-v3',
        };
        const { settings, migrationApplied } = simulate(persistedAfterMigration);
        expect(migrationApplied).toBe(false);
        expect(settings.aiProvider).toBe('qwen');
        expect(settings.chatModelName).toBe('qwen3.6-plus');
    });

    it('user picks openai then re-launches: aiProvider stays "openai", no migration', () => {
        const persisted = {
            aiProvider: 'openai',
            baseURL: 'https://api.openai.com/v1',
            chatModelName: 'gpt-4o-mini',
            embeddingModelName: 'text-embedding-3-small',
        };
        const { settings, migrationApplied } = simulate(persisted);
        expect(migrationApplied).toBe(false);
        expect(settings.aiProvider).toBe('openai');
    });
});

describe('Phase 4 P1 UX', () => {
    type Phase4Internals = {
        debouncedSave: { __record: MockDebounceRecord };
        rebuildMemorySubSettings: () => void;
        memorySubContainer: { children: unknown[] } | null;
    };

    describe('4a: text input debounce', () => {
        it('text onChange routes through debouncedSave instead of saveSettings', async () => {
            const plugin = makePlugin({ enableMetadataUpdating: true });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const records = getMockSettingRecords();
            // "Meta Updating Exclude Path" has a single addText whose onChange
            // mutates plugin.settings.metadataExcludePath then calls debouncedSave.
            const excludeRecord = records.find((r) => r.name === 'Meta Updating Exclude Path');
            expect(excludeRecord?.texts[0]?.onChange).toBeDefined();

            const beforeSaves = plugin.saveSettings.mock.calls.length;
            const debounceRecord = (tab as unknown as Phase4Internals).debouncedSave.__record;
            const beforeDebounceCalls = debounceRecord.calls.length;

            await excludeRecord!.texts[0].onChange!('tmp/,drafts/');

            // Mutation lands synchronously…
            expect(plugin.settings.metadataExcludePath).toEqual(['tmp/', 'drafts/']);
            // …debounced save is queued, not called…
            expect(debounceRecord.calls.length).toBe(beforeDebounceCalls + 1);
            // …and saveSettings has not run yet.
            expect(plugin.saveSettings.mock.calls.length).toBe(beforeSaves);
        });

        it('hide() cancels pending debounce and forces one final saveSettings()', () => {
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const debounceRecord = (tab as unknown as Phase4Internals).debouncedSave.__record;
            const beforeCancels = debounceRecord.cancelled;
            const beforeSaves = plugin.saveSettings.mock.calls.length;

            tab.hide();

            expect(debounceRecord.cancelled).toBe(beforeCancels + 1);
            expect(plugin.saveSettings.mock.calls.length).toBe(beforeSaves + 1);
        });
    });

    describe('4b: Memory sub-settings hide when memory is off', () => {
        it('hides Ask-before-AI-credits + Advanced memory controls when memoryEnabled=false', () => {
            const plugin = makePlugin({ memoryEnabled: false });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const names = getMockSettingRecords().map((r) => r.name);
            // Master toggle still rendered.
            expect(names).toContain('Use memory from my notes');
            // Sub-settings hidden.
            expect(names).not.toContain('Ask before using AI credits');
            expect(names).not.toContain('Advanced memory controls');
        });

        it('shows the sub-settings when memoryEnabled=true (default)', () => {
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const names = getMockSettingRecords().map((r) => r.name);
            expect(names).toContain('Use memory from my notes');
            expect(names).toContain('Ask before using AI credits');
            expect(names).toContain('Advanced memory controls');
        });

        it('keeps AI Memory Extraction and Vault Insights context on by default', () => {
            expect(DEFAULT_SETTINGS.memoryExtractionEnabled).toBe(true);
            expect(DEFAULT_SETTINGS.memoryExtractionIncludeVaultInsights).toBe(true);
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const records = getMockSettingRecords();
            expect(records.find((r) => r.name === 'AI Memory Extraction')?.toggles[0])
                .toMatchObject({ value: true });
            expect(records.find((r) => r.name === 'Include Vault Insights in AI Context')?.toggles[0])
                .toMatchObject({ value: true });
        });

        it('shows AI Insights entry point without enabling Advanced memory controls', () => {
            const plugin = makePlugin({ showAdvancedMemoryControls: false });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const record = getMockSettingRecords().find((r) => r.name === 'AI Insights');
            expect(record?.buttons[0]).toMatchObject({
                text: 'View AI Insights',
                disabled: false,
            });

            record?.buttons[0]?.onClick?.();
            expect(plugin.showAiInsights).toHaveBeenCalledTimes(1);
        });

        it('re-checks the AI Insights gate before opening from Settings', () => {
            const plugin = makePlugin({ showAdvancedMemoryControls: false });
            (plugin.canShowAiInsights as jest.Mock)
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(false);
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const record = getMockSettingRecords().find((r) => r.name === 'AI Insights');
            expect(record?.buttons[0]).toMatchObject({
                text: 'View AI Insights',
                disabled: false,
            });

            record?.buttons[0]?.onClick?.();
            expect(plugin.showAiInsights).not.toHaveBeenCalled();
        });

        it('requires explicit confirmation before enabling AI Memory Extraction', async () => {
            (confirmUserAction as jest.Mock).mockClear();
            const plugin = makePlugin({ memoryExtractionEnabled: false });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const toggle = getMockSettingRecords()
                .find((r) => r.name === 'AI Memory Extraction')?.toggles[0];
            expect(toggle?.onChange).toBeDefined();

            setMockConfirmDecision(false);
            await toggle!.onChange!(true);
            expect(confirmUserAction).toHaveBeenCalledTimes(1);
            expect(plugin.settings.memoryExtractionEnabled).toBe(false);
            expect(toggle!.value).toBe(false);
            expect(plugin.saveSettings).not.toHaveBeenCalled();

            (confirmUserAction as jest.Mock).mockClear();
            setMockConfirmDecision(true);
            await toggle!.onChange!(true);

            expect(plugin.settings.memoryExtractionEnabled).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
            const options = (confirmUserAction as jest.Mock).mock.calls[0]?.[1] as { message?: string };
            expect(options?.message).toContain('Conversation content');
            expect(options?.message).toContain('configured AI provider');
            expect(options?.message).toContain('AI credits or API calls');
            expect(options?.message).toContain('stored locally');
            expect(options?.message).toContain('future AI context');
            expect(getMockSettingRecords().map((r) => r.name)).toContain('Include Vault Insights in AI Context');
        });

        it('does not ask for confirmation when disabling AI Memory Extraction', async () => {
            (confirmUserAction as jest.Mock).mockClear();
            const plugin = makePlugin({ memoryExtractionEnabled: true });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const toggle = getMockSettingRecords()
                .find((r) => r.name === 'AI Memory Extraction')?.toggles[0];
            await toggle!.onChange!(false);

            expect(confirmUserAction).not.toHaveBeenCalled();
            expect(plugin.settings.memoryExtractionEnabled).toBe(false);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('toggling memoryEnabled rebuilds sub-settings without calling display()', async () => {
            const plugin = makePlugin({ memoryEnabled: false });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const masterToggle = getMockSettingRecords()
                .find((r) => r.name === 'Use memory from my notes')?.toggles[0];
            expect(masterToggle?.onChange).toBeDefined();

            const displaySpy = jest.spyOn(tab, 'display');
            const internals = tab as unknown as Phase4Internals;
            const rebuildSpy = jest.spyOn(internals, 'rebuildMemorySubSettings');

            await masterToggle!.onChange!(true);

            expect(displaySpy).not.toHaveBeenCalled();
            expect(rebuildSpy).toHaveBeenCalledTimes(1);
            // Sub-settings now appear in the records.
            const namesAfter = getMockSettingRecords().map((r) => r.name);
            expect(namesAfter).toContain('Ask before using AI credits');
            expect(namesAfter).toContain('Advanced memory controls');
        });

        it('asks for confirmation before enabling background memory updates', async () => {
            (confirmUserAction as jest.Mock).mockClear();
            const plugin = makePlugin({ showAdvancedMemoryControls: true });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const toggle = getMockSettingRecords()
                .find((r) => r.name === 'Keep memory updated in background')?.toggles[0];
            expect(toggle?.onChange).toBeDefined();

            setMockConfirmDecision(false);
            await toggle!.onChange!(true);
            expect(plugin.settings.memoryApprovalPolicy).toBe('always');
            expect(toggle!.value).toBe(false);

            setMockConfirmDecision(true);
            await toggle!.onChange!(true);
            expect(confirmUserAction).toHaveBeenCalledTimes(2);
            const options = (confirmUserAction as jest.Mock).mock.calls[1]?.[1] as { message?: string };
            expect(options?.message).toContain('Your notes will not be changed or deleted');
            expect(options?.message).toContain('configured AI provider');
            expect(options?.message).toContain('AI credits or API calls');
            expect(plugin.settings.memoryApprovalPolicy).toBe('auto-refresh-after-prepare');
            expect(plugin.memoryManager.scheduleReconcile).toHaveBeenCalledWith('settings');
            expect(plugin.memoryManager.scheduleAutoFlush).toHaveBeenCalledWith('settings');
        });

        it('does not ask for confirmation when disabling background memory updates', async () => {
            (confirmUserAction as jest.Mock).mockClear();
            const plugin = makePlugin({
                showAdvancedMemoryControls: true,
                memoryApprovalPolicy: 'auto-refresh-after-prepare',
            });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const toggle = getMockSettingRecords()
                .find((r) => r.name === 'Keep memory updated in background')?.toggles[0];
            await toggle!.onChange!(false);

            expect(confirmUserAction).not.toHaveBeenCalled();
            expect(plugin.settings.memoryApprovalPolicy).toBe('always');
        });

        it('routes manual advanced Memory buttons through the shared action guard', async () => {
            (confirmUserAction as jest.Mock).mockClear();
            setMockConfirmDecision(true);
            const plugin = makePlugin({ showAdvancedMemoryControls: true });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const clickMemoryButton = async (name: string) => {
                const button = getMockSettingRecords()
                    .find((r) => r.name === name)?.buttons[0];
                expect(button?.onClick).toBeDefined();
                await button!.onClick!();
            };

            await clickMemoryButton('Update memory now');
            await clickMemoryButton('Rebuild memory on this device');
            await clickMemoryButton('Reset local memory copy');
            await clickMemoryButton('Delete old Memory cache files');
            await clickMemoryButton('Show technical memory status');

            expect(plugin.runManualMemoryAction).toHaveBeenCalledTimes(5);
            expect(plugin.memoryManager.updateFromCommand).toHaveBeenCalledTimes(1);
            expect(plugin.memoryManager.prepareFromCommand).toHaveBeenCalledTimes(1);
            expect(plugin.vss.resetLocalIndex).toHaveBeenCalledTimes(1);
            expect(plugin.vss.cleanLegacyJsonCache).toHaveBeenCalledTimes(1);
            expect(plugin.showTechnicalMemoryStatus).toHaveBeenCalledTimes(1);
            expect(confirmUserAction).toHaveBeenCalledTimes(1);
        });
    });

    describe('4c: pre-chat copy', () => {
        it('renames the pre-chat toggle to "Ask before using AI credits" with cost-framed desc', () => {
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const record = getMockSettingRecords()
                .find((r) => r.name === 'Ask before using AI credits');
            expect(record).toBeDefined();
            expect(record?.desc).toContain('approval');
            expect(record?.desc).toContain('API calls');
            // Avoid leaking VSS / RAG / embedding internals into normal copy.
            expect(record?.desc).not.toMatch(/vss|rag|embedding|vector|chunk/i);
        });
    });

    describe('4d: new Statistics toggles', () => {
        it('defaults displaySectionCounts and countComments to false', () => {
            expect(DEFAULT_SETTINGS.displaySectionCounts).toBe(false);
            expect(DEFAULT_SETTINGS.countComments).toBe(false);
        });

        it('renders both new toggles in Vault Statistics with onChange handlers', () => {
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const records = getMockSettingRecords();
            const sectionCounts = records.find((r) => r.name === 'Show section word counts');
            const commentsCount = records.find((r) => r.name === 'Count comments in statistics');
            expect(sectionCounts?.toggles[0]).toMatchObject({ value: false });
            expect(commentsCount?.toggles[0]).toMatchObject({ value: false });
            expect(sectionCounts?.toggles[0]?.onChange).toBeDefined();
            expect(commentsCount?.toggles[0]?.onChange).toBeDefined();
        });

        it('toggling each new control mutates the matching setting and saves', async () => {
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const records = getMockSettingRecords();
            const sectionCounts = records.find((r) => r.name === 'Show section word counts')!.toggles[0];
            const commentsCount = records.find((r) => r.name === 'Count comments in statistics')!.toggles[0];

            const beforeSaves = plugin.saveSettings.mock.calls.length;
            await sectionCounts.onChange!(true);
            await commentsCount.onChange!(true);

            expect(plugin.settings.displaySectionCounts).toBe(true);
            expect(plugin.settings.countComments).toBe(true);
            expect(plugin.saveSettings.mock.calls.length).toBe(beforeSaves + 2);
        });
    });

    describe('4e: metadata form polish', () => {
        it('uses a corrected desc string ("Value only supports …")', () => {
            const plugin = makePlugin({ enableMetadataUpdating: true });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const record = getMockSettingRecords()
                .find((r) => r.name === 'Add Key:Value in frontmatter');
            expect(record?.desc).toBe('Value only supports formatted timestamp and regular string.');
        });

        it('renames metadata type dropdown labels to plain English', () => {
            const plugin = makePlugin({ enableMetadataUpdating: true });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const record = getMockSettingRecords()
                .find((r) => r.name === 'Add Key:Value in frontmatter');
            const options = record?.dropdowns[0]?.options;
            expect(options).toEqual([
                { value: 'string', text: 'Regular string' },
                { value: 'moment', text: 'Formatted timestamp' },
            ]);
        });

        it('clears the visible key/value inputs after a successful Add', async () => {
            const plugin = makePlugin({ enableMetadataUpdating: true });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const records = getMockSettingRecords();
            const addRecord = records.find((r) => r.name === 'Add Key:Value in frontmatter')!;
            // Drive the form through its onChange handlers (mirrors a real user typing).
            await addRecord.texts[0].onChange!('newKey');
            await addRecord.texts[1].onChange!('newValue');
            const beforeKeyResetCalls = addRecord.texts[0].setValueCalls.length;
            const beforeValueResetCalls = addRecord.texts[1].setValueCalls.length;

            const addButton = addRecord.buttons.find((b) => b.text === 'Add')!;
            await addButton.onClick!();

            expect(plugin.settings.metadatas[plugin.settings.metadatas.length - 1])
                .toMatchObject({ key: 'newKey', value: 'newValue', t: 'string' });
            // Add handler invoked setValue("") on both inputs after save.
            expect(addRecord.texts[0].setValueCalls.length).toBe(beforeKeyResetCalls + 1);
            expect(addRecord.texts[0].setValueCalls[addRecord.texts[0].setValueCalls.length - 1]).toBe('');
            expect(addRecord.texts[1].setValueCalls.length).toBe(beforeValueResetCalls + 1);
            expect(addRecord.texts[1].setValueCalls[addRecord.texts[1].setValueCalls.length - 1]).toBe('');
        });
    });

    describe('4f: default-path cleanup', () => {
        it('uses generic defaults that do not leak the original developer\'s vault layout', () => {
            // Prior defaults baked in personal folder names ("9.src", "8.template",
            // "a.subjects", "b.notion") that made no sense as fresh-install seeds.
            expect(DEFAULT_SETTINGS.featuredImagePath).toBe('');
            expect(DEFAULT_SETTINGS.vssCacheExcludePath).toEqual(['.obsidian']);
            expect(DEFAULT_SETTINGS).not.toHaveProperty('modelName');
            expect(DEFAULT_SETTINGS.localGraph.notice).toBe('Opened local graph for current note.');
        });

        it('mergeLoadedSettings preserves a user\'s configured exclusions', () => {
            const merged = mergeLoadedSettings({
                vssCacheExcludePath: ['my/private', 'tmp/'],
                featuredImagePath: 'attachments/ai',
            });
            expect(merged.vssCacheExcludePath).toEqual(['my/private', 'tmp/']);
            expect(merged.featuredImagePath).toBe('attachments/ai');
        });
    });
});

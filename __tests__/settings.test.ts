import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('obsidian', () => ({
    App: class { },
    Notice: class { },
    Platform: { isDesktop: true, isMobile: false },
    PluginSettingTab: class {
        app: unknown;
        containerEl = { empty: jest.fn() };
        constructor(app: unknown, _plugin: unknown) { this.app = app; }
    },
    Setting: class {
        record: {
            name?: string;
            desc?: string;
            toggles: Array<{ value?: boolean; disabled?: boolean }>;
        };

        constructor(_containerEl: unknown) {
            this.record = { toggles: [] };
            const globalObj = globalThis as typeof globalThis & {
                __paSettingRecords?: Array<{
                    name?: string;
                    desc?: string;
                    toggles: Array<{ value?: boolean; disabled?: boolean }>;
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

        addToggle(callback: (toggle: {
            setValue: (value: boolean) => unknown;
            setDisabled: (disabled: boolean) => unknown;
            onChange: (onChange: (value: boolean) => unknown) => unknown;
        }) => void) {
            const toggle = { value: undefined as boolean | undefined, disabled: false };
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
                onChange: (_onChange: (value: boolean) => unknown) => toggleComponent,
            };
            callback(toggleComponent);
            return this;
        }

        addText(callback: (text: {
            setPlaceholder: (value: string) => unknown;
            setValue: (value: unknown) => unknown;
            onChange: (onChange: (value: string) => unknown) => unknown;
        }) => void) {
            const textComponent = {
                setPlaceholder: (_value: string) => textComponent,
                setValue: (_value: unknown) => textComponent,
                onChange: (_onChange: (value: string) => unknown) => textComponent,
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
            const dropdownComponent = {
                addOption: (_value: string, _text: string) => dropdownComponent,
                setValue: (_value: string) => dropdownComponent,
                onChange: (_onChange: (value: string) => unknown) => dropdownComponent,
                selectEl: { querySelector: (_selector: string) => ({ setAttribute: jest.fn() }) },
            };
            callback(dropdownComponent);
            return this;
        }

        addButton(callback: (button: {
            buttonEl: unknown;
            setCta: () => unknown;
            setButtonText: (text: string) => unknown;
            onClick: (callback: () => void) => unknown;
        }) => void) {
            const buttonComponent = {
                buttonEl: {},
                setCta: () => buttonComponent,
                setButtonText: (_text: string) => buttonComponent,
                onClick: (_callback: () => void) => buttonComponent,
            };
            callback(buttonComponent);
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
        constructor(_app: unknown, _el: unknown) { }
        setValue(_value: string) { return this; }
        onChange(_cb: (value: string) => unknown) { return this; }
    },
}));

jest.mock('vanilla-picker', () => ({
    __esModule: true,
    default: class { },
}));

jest.mock('../src/stats-view', () => ({ STAT_PREVIEW_TYPE: 'stat-preview' }));
jest.mock('../src/stats/stats-store', () => ({ normalizeStatisticsView: (view: string) => view }));
jest.mock('../src/utils', () => ({
    KEYCHAIN_API_TOKEN_ID: 'pa-api-token',
}));

import {
    DEFAULT_SETTINGS,
    STATISTICS_SYNC_SETTING_DESC,
    SettingTab,
    normalizeEnabledSkillIds,
    updateQwenResponseOptionAvailability,
} from '../src/settings';
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

class MockDomNode {
    children: MockDomNode[] = [];
    href = '';
    innerText = '';
    textContent = '';

    constructor(readonly tagName: string) { }

    setText(text: string) {
        this.innerText = text;
        this.textContent = text;
        return this;
    }

    setAttr(_name: string, _value: string) {
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

    createEl(tagName: string, options?: { text?: string } | undefined, callback?: (element: MockDomNode) => void) {
        const child = new MockDomNode(tagName);
        if (options?.text) child.setText(options.text);
        this.children.push(child);
        callback?.(child);
        return child;
    }

    createSpan(options?: { text?: string; attr?: { style?: string } }) {
        return this.createEl('span', { text: options?.text });
    }
}

class MockContainerEl extends MockDomNode {
    empty = jest.fn(() => {
        this.children = [];
    });
}

type MockSettingRecord = {
    name?: string;
    desc?: string;
    toggles: Array<{ value?: boolean; disabled?: boolean }>;
};

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
            getSecret: jest.fn(() => null),
            listSecrets: jest.fn(() => []),
        },
    };
}

function makePlugin(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
    return {
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
        },
        updateMemoryStatusBar: jest.fn(async () => undefined),
        vss: {
            resetLocalIndex: jest.fn(async () => undefined),
            cleanLegacyJsonCache: jest.fn(async () => undefined),
        },
        showTechnicalMemoryStatus: jest.fn(async () => undefined),
        statsManager: {
            setStatisticsSyncEnabled: jest.fn(async () => undefined),
        },
    };
}

beforeEach(() => {
    getMockSettingRecords().length = 0;
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
        expect(policyModel?.desc).toContain('Your chat request and explicitly sent context may be sent to your configured AI provider');
        expect(policyModel?.desc).toContain('hidden vault content is not sent');
        expect(policyModel?.desc).toContain('Leave blank to use local fallback rules');
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
        expect(skillToggleStates).toHaveLength(7);
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

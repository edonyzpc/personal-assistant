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
            toggles: Array<{ value?: boolean; disabled?: boolean; onChange?: (value: boolean) => unknown }>;
            dropdowns: Array<{
                value?: string;
                options: Array<{ value: string; text: string }>;
                onChange?: (value: string) => unknown;
            }>;
        };

        constructor(_containerEl: unknown) {
            this.record = { toggles: [], dropdowns: [] };
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
    // Each Picker instance gets its own destroy spy so tests can assert
    // teardown without sharing call counts across instances.
    default: class {
        destroy = jest.fn();
        constructor(_options: unknown) { /* options ignored in tests */ }
    },
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
type MockSettingRecord = {
    name?: string;
    desc?: string;
    toggles: Array<MockToggleRecord>;
    dropdowns: Array<MockDropdownRecord>;
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

describe('Phase 1 refactor invariants', () => {
    type PickerProbe = { destroy: jest.Mock };
    type SettingTabInternals = {
        activePickers: PickerProbe[];
        rebuildGraphColors: () => void;
        rebuildProviderConfig: () => void;
        graphColorsContainer: unknown;
        metadataContainer: unknown;
        providerConfigContainer: unknown;
        skillTogglesContainer: unknown;
        featuredImageContainer: unknown;
        memoryAdvancedContainer: unknown;
    };

    it('hide() destroys all active Pickers and resets the registry', () => {
        const plugin = makePlugin({ enableGraphColors: true });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const internals = tab as unknown as SettingTabInternals;
        const captured = [...internals.activePickers];
        expect(captured.length).toBeGreaterThan(0);

        tab.hide();

        for (const picker of captured) {
            expect(picker.destroy).toHaveBeenCalledTimes(1);
        }
        expect(internals.activePickers).toHaveLength(0);
    });

    it('rebuildGraphColors destroys prior Pickers before creating new ones', () => {
        const plugin = makePlugin({ enableGraphColors: true });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const internals = tab as unknown as SettingTabInternals;
        const oldPickers = [...internals.activePickers];
        expect(oldPickers).toHaveLength(1); // DEFAULT_SETTINGS.colorGroups has one entry

        internals.rebuildGraphColors();

        for (const picker of oldPickers) {
            expect(picker.destroy).toHaveBeenCalledTimes(1);
        }
        expect(internals.activePickers).toHaveLength(1);
        expect(internals.activePickers[0]).not.toBe(oldPickers[0]);
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

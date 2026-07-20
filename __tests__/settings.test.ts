import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';

jest.mock('obsidian', () => ({
    App: class { },
    Notice: jest.fn(),
    TFile: class {
        path: string;
        constructor(path: string) { this.path = path; }
    },
    normalizePath: (path: string) => {
        const normalized = path
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/\/$/g, '');
        return normalized === '' ? '.' : normalized;
    },
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
	        containerEl: unknown;
	        controlEl: HTMLElement;
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

	        constructor(containerEl: unknown) {
	            this.containerEl = containerEl;
	            this.controlEl = document.createElement('div');
	            (containerEl as { appendChild?: (child: unknown) => unknown })?.appendChild?.(this.controlEl);
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
            setWarning: () => unknown;
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
                setWarning: () => buttonComponent,
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
	            const el = document.createElement('div');
	            callback(el);
	            (this.controlEl as { appendChild?: (child: unknown) => unknown })?.appendChild?.(el);
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
    hasSecretValue: (secret: string | null) => secret !== null && secret !== '',
}));

import {
    CONTEXT_PAGER_DEFAULTS,
    DATA_BOUNDARY_DEFAULTS,
    DEFAULT_SETTINGS,
    PROVIDER_PRESETS,
    STATISTICS_SYNC_SETTING_DESC,
    SettingTab,
    buildPaLegalLinks,
    deriveDisplayPreset,
    isFreshInstall,
    isLegacyV1Install,
    mergeContextPagerSettings,
    mergeDataBoundarySettings,
    mergeLoadedSettings,
    mergeMaintenanceReviewSettings,
    mergeMemoryGovernanceSettings,
    normalizeEnabledSkillIds,
    normalizeFeaturedImageCount,
    normalizeFeaturedImageModel,
    mergeSavedInsightSettings,
    safeParseInt,
    updateQwenResponseOptionAvailability,
} from '../src/settings';
import { OPERATIONS_AGENT_RUNTIME_ENABLED } from '../src/operations-agent-flags';
import { confirmUserAction } from '../src/confirm';
import { MOCK_LICENSE_TIER } from '../src/ai-services/capability-types';
import { BUNDLED_SKILL_CATALOG } from '../src/ai-services/bundled-skill-catalog';
import { buildMemoryControlCenterSnapshot } from '../src/pa/memory-control-center';

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
    checked = false;
    disabled = false;
    open = false;
    href = '';
    innerText = '';
    textContent = '';
    type = '';
    value = '';
    dataset: Record<string, string> = {};
    classes: string[] = [];
    attrs: Record<string, string> = {};
    focus = jest.fn();
    scrollIntoView = jest.fn();
    private eventListeners: Record<string, Array<(event: unknown) => unknown>> = {};

    constructor(readonly tagName: string) { }

    setText(text: string) {
        this.innerText = text;
        this.textContent = text;
        return this;
    }

    setAttr(name: string, value: string) {
        this.attrs[name] = value;
        if (name === 'type') this.type = value;
        if (name === 'value') this.value = value;
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

    remove() {
        // The bounded Settings DOM mock does not keep parent pointers. Tests
        // only need removal to be safe when cancelling an inline editor.
        this.children = [];
    }

    appendText(text: string) {
        this.innerText += text;
        this.textContent += text;
    }

    addEventListener(type: string, callback: (event: unknown) => unknown) {
        this.eventListeners[type] = this.eventListeners[type] ?? [];
        this.eventListeners[type].push(callback);
    }

    dispatchEvent(event: { type: string } | string) {
        const eventObject = typeof event === 'string' ? { type: event } : event;
        for (const callback of this.eventListeners[eventObject.type] ?? []) {
            callback(eventObject);
        }
        return true;
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
            if (part.startsWith('#')) {
                return node.attrs.id === part.slice(1);
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

    querySelector(selector: string): MockDomNode | null {
        return this.findAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): MockDomNode[] {
        return this.findAll(selector);
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
            quickCapture: { ...DEFAULT_SETTINGS.quickCapture },
            dataBoundary: {
                excludedFolders: [...DEFAULT_SETTINGS.dataBoundary.excludedFolders],
                excludedTags: [...DEFAULT_SETTINGS.dataBoundary.excludedTags],
                generatedNotePolicy: DEFAULT_SETTINGS.dataBoundary.generatedNotePolicy,
                providerDisclosureReasons: [...DEFAULT_SETTINGS.dataBoundary.providerDisclosureReasons],
                cleanupGroups: [...DEFAULT_SETTINGS.dataBoundary.cleanupGroups],
            },
            reviewQueue: {
                enabled: DEFAULT_SETTINGS.reviewQueue.enabled,
                items: DEFAULT_SETTINGS.reviewQueue.items.map((item) => ({ ...item })),
            },
            contextPager: { ...DEFAULT_SETTINGS.contextPager },
            savedInsights: {
                items: DEFAULT_SETTINGS.savedInsights.items.map((item) => ({
                    ...item,
                    sourceRefs: item.sourceRefs.map((ref) => ({ ...ref })),
                    whyShown: [...item.whyShown],
                    scope: {
                        ...item.scope,
                        paths: item.scope.paths ? [...item.scope.paths] : undefined,
                        tags: item.scope.tags ? [...item.scope.tags] : undefined,
                    },
                })),
            },
            memoryGovernance: {
                records: DEFAULT_SETTINGS.memoryGovernance.records.map((record) => ({
                    ...record,
                    scope: {
                        ...record.scope,
                        paths: record.scope.paths ? [...record.scope.paths] : undefined,
                        tags: record.scope.tags ? [...record.scope.tags] : undefined,
                    },
                    sourceRefs: record.sourceRefs.map((ref) => ({ ...ref })),
                })),
            },
            maintenanceReview: {
                ...DEFAULT_SETTINGS.maintenanceReview,
                actionLog: DEFAULT_SETTINGS.maintenanceReview.actionLog.map((entry) => ({
                    ...entry,
                    sourceRefs: entry.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                })),
            },
            weeklyReview: { ...DEFAULT_SETTINGS.weeklyReview },
            quietRecall: { ...DEFAULT_SETTINGS.quietRecall },
            memoryExtractionConsent: { ...DEFAULT_SETTINGS.memoryExtractionConsent },
            retrievalHabitProfile: {
                enabled: DEFAULT_SETTINGS.retrievalHabitProfile.enabled,
                state: {
                    aggregates: DEFAULT_SETTINGS.retrievalHabitProfile.state.aggregates.map((aggregate) => ({
                        ...aggregate,
                        counts: { ...aggregate.counts },
                    })),
                    ...(DEFAULT_SETTINGS.retrievalHabitProfile.state.clearedAt
                        ? { clearedAt: DEFAULT_SETTINGS.retrievalHabitProfile.state.clearedAt }
                        : {}),
                },
            },
            ...overrides,
        },
        saveSettings: jest.fn(async () => undefined),
        setMemoryAutoAcceptPaused: jest.fn(async (_paused: boolean) => undefined),
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
        getMemoryControlCenterSnapshot: jest.fn(async () => ({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            items: [],
            degradedSources: [],
        })),
        getMemoryGovernanceUiMode: jest.fn<() => 'effect_based' | 'legacy_threshold' | 'unavailable'>(
            () => 'effect_based',
        ),
        getMemorySuppressionMarkerCount: jest.fn(() => 0),
        clearMemorySuppressionMarkers: jest.fn(async () => ({
            ok: true,
            message: 'Cleared 0 prevention markers for this vault.',
            clearedCount: 0,
        })),
        rollbackMemoryGovernance: jest.fn(async () => ({
            ok: true,
            message: 'Compatible Memory was restored for this vault.',
        })),
        getMemoryRollbackStatusMessage: jest.fn((reason?: string) => (
            reason === 'rollback_pending_operations'
                ? 'PA is still finishing another Memory change.'
                : 'A verified compatibility restore is not available now.'
        )),
        runMemoryControlCenterAction: jest.fn<(
            action: 'correct' | 'pause_use' | 'resume_use' | 'apply_device_wide'
                | 'limit_to_current_vault' | 'forget' | 'retry_forget' | 'undo_recent_change',
            targetId: string,
            summary?: string,
        ) => Promise<{ ok: boolean; message: string }>>(async () => ({
            ok: true,
            message: 'Memory updated.',
        })),
        finalizeMemoryGovernance: jest.fn(async (_confirmationToken: string) => ({
            ok: true,
            message: 'Device-only Memory setup is complete.',
        })),
        getMemoryFinalizationStatusMessage: jest.fn((reason?: string) => (
            reason === 'finalization_pending_operations'
                ? 'PA is still finishing another Memory change.'
                : 'Device-only setup is not ready yet.'
        )),
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
    delete (globalThis as typeof globalThis & { __paModalInstances?: unknown[] }).__paModalInstances;
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

describe('PA settings refresh', () => {
    it('tracks Settings visibility on the container owner document', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const ownerClassList = {
            add: jest.fn(),
            remove: jest.fn(),
            contains: jest.fn(() => false),
        };
        const globalClassList = {
            add: jest.fn(),
            remove: jest.fn(),
        };
        const containerEl = new MockContainerEl('div');
        Object.assign(containerEl, {
            ownerDocument: { body: { classList: ownerClassList } },
        });
        Object.assign(document, { body: { classList: globalClassList } });
        tab.containerEl = containerEl as never;

        tab.display();
        tab.hide();

        expect(ownerClassList.add).toHaveBeenCalledWith('pa-settings-tab-open');
        expect(ownerClassList.remove).toHaveBeenCalledWith('pa-settings-tab-open');
        expect(globalClassList.add).not.toHaveBeenCalled();
        expect(globalClassList.remove).not.toHaveBeenCalled();
    });

    it('re-renders the Pagelet group only in the Settings window that owns the visible tab', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const visibleClasses = new Set<string>();
        const containerEl = new MockContainerEl('div');
        Object.assign(containerEl, {
            ownerDocument: {
                body: {
                    classList: {
                        contains: (className: string) => visibleClasses.has(className),
                    },
                },
            },
        });
        tab.containerEl = containerEl as never;
        const display = jest.spyOn(tab, 'display').mockImplementation(() => undefined);
        const openGroup = jest.spyOn(tab, 'openGroup').mockImplementation(() => undefined);

        expect(tab.refreshPageletSettingsIfVisible()).toBe(false);
        expect(display).not.toHaveBeenCalled();

        visibleClasses.add('pa-settings-tab-open');
        expect(tab.refreshPageletSettingsIfVisible()).toBe(true);
        expect(display).toHaveBeenCalledTimes(1);
        expect(openGroup).toHaveBeenCalledWith('features');
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

    it('uses container-aware navigation and top-aligned setting rows', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');

        expect(css).not.toContain(':has(');
        expect(css).toContain('container-name: pa-settings-tab');
        expect(css).toContain('container-type: inline-size');
        expect(css).toMatch(/\.modal\.mod-settings\s+\.vertical-tab-content\.pa-settings-tab\s*{[\s\S]*?padding-inline:\s*clamp\(16px,\s*2vw,\s*24px\);/);
        expect(css).toMatch(/\.pa-settings-shell\s*{[\s\S]*?margin-inline:\s*auto;[\s\S]*?max-width:\s*1180px;[\s\S]*?width:\s*100%;/);
        expect(css).toMatch(/body\.is-mobile\s+\.modal\.mod-settings\s+\.vertical-tab-content\.pa-settings-tab\s*{[\s\S]*?safe-area-inset-left[\s\S]*?safe-area-inset-right/);
        expect(css).toContain('.pa-settings-layout');
        expect(css).toContain('.pa-settings-toc');
        expect(css).toContain('.pa-settings-toc-item__tick');
        expect(css).toContain('.pa-settings-toc-item__label');
        expect(css).toMatch(/\.pa-settings-toc-item\s*{[\s\S]*?justify-content:\s*start;[\s\S]*?justify-items:\s*start;/);
        expect(css).toContain('.pa-settings-jump');
        expect(css).toContain('.pa-settings-jump-count');
        expect(css).toContain('.pa-settings-jump-progress__segment');
        expect(css).toMatch(/\.pa-settings-jump-select\s*{[\s\S]*?max-width:\s*360px;[\s\S]*?width:\s*100%;/);
        expect(css).toContain('.pa-settings-group__body');
        expect(css).toMatch(/\.pa-settings-group-summary\s*{[\s\S]*?scroll-margin-block-start:\s*12px;/);
        expect(css).toContain('@container pa-settings-tab (min-width: 1040px)');
        expect(css).toContain('@container pa-settings-tab (max-width: 720px)');
        expect(css).toMatch(/@container pa-settings-tab \(min-width: 1040px\)\s*{[\s\S]*?grid-template-areas:\s*"toc content";[\s\S]*?grid-template-columns:\s*184px minmax\(0, 1fr\);/);
        expect(css).toContain('@media (hover: hover) and (pointer: fine)');
        expect(css).toMatch(/\.pa-settings-toc\s*{[\s\S]*?inline-size:\s*40px;/);
        expect(css).toMatch(/\.pa-settings-toc:hover,[\s\S]*?\.pa-settings-toc:focus-within\s*{[\s\S]*?inline-size:\s*100%;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-settings-jump\s*{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*8px;/);
        expect(css).toContain('--pa-settings-mobile-nav-offset: 72px');
        expect(css).toMatch(/body\.is-mobile\s+\.pa-settings-group-summary\s*{[\s\S]*?scroll-margin-block-start:\s*var\(--pa-settings-mobile-nav-offset,\s*72px\);/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-settings-jump-select\s*{[\s\S]*?grid-column:\s*1 \/ -1;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-settings-jump-count\s*{[\s\S]*?pointer-events:\s*none;[\s\S]*?position:\s*absolute;/);
        expect(css).toMatch(/\.pa-settings-tab\s+\.setting-item\.pa-setting-layout\s*{[\s\S]*?align-items:\s*start;[\s\S]*?display:\s*grid;/);
        expect(css).toContain('.pa-setting-layout--field');
        expect(css).toContain('.pa-setting-layout--compact');
        expect(css).toContain('.pa-setting-layout--cluster');
        expect(css).toContain('.pa-setting-layout--stacked');
        expect(css).toMatch(/body\.is-mobile\s+\.pa-settings-tab\s+\.setting-item\.pa-setting-layout\s+\.setting-item-control\s+button,[\s\S]*?min-height:\s*44px;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-settings-tab\s+\.setting-item\.pa-setting-layout--compact\s+\.setting-item-control\s*{[^}]*min-height:\s*44px;/);
        expect(css).not.toMatch(/\.setting-item-control\s+\.checkbox-container\s*{[^}]*min-(?:height|width):\s*44px;/);
        expect(css).not.toContain('.pa-settings-group > :not(summary)');
        expect(css).not.toContain('.pa-settings-nav');
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

describe('settings row-layout styling hooks', () => {
    it('classifies every interactive row and reapplies layout classes after dynamic rebuilds', () => {
        const source = readFileSync('src/settings.ts', 'utf8');
        const methodBody = (name: string) => {
            const start = source.indexOf(`    private ${name}(`);
            expect(start).toBeGreaterThanOrEqual(0);
            const next = source.indexOf('\n    private ', start + 1);
            return source.slice(start, next === -1 ? undefined : next);
        };

        for (const name of [
            'rebuildProviderConfig',
            'rebuildQwenOptions',
            'rebuildSkillToggles',
            'rebuildGraphColors',
            'rebuildMetadataList',
            'rebuildMemorySubSettings',
            'rebuildMemoryAdvanced',
            'rebuildFeaturedImage',
        ]) {
            expect(methodBody(name)).toContain('this.markFormControlSettings(container);');
        }
        expect(methodBody('renderMemoryControlCenterOverview')).toContain('this.markFormControlSettings(body);');
        const classifier = methodBody('markFormControlSettings');
        expect(classifier).toContain('input, select, textarea, button');
        expect(classifier).toContain('!control.classList.contains("is-measuring")');
        expect(classifier).toContain('.clickable-icon, .checkbox-container, .pa-settings-skill-picker');
        expect(classifier).toContain('primaryFields.forEach((control) => control.classList.add("pa-setting-form-input"));');
        expect(classifier).not.toContain('input[type=\'color\']');
        expect(classifier).toContain('pa-setting-layout--field');
        expect(classifier).toContain('pa-setting-layout--compact');
        expect(classifier).toContain('pa-setting-layout--cluster');
        expect(classifier).toContain('pa-setting-layout--stacked');
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
        expect(normalizeEnabledSkillIds(['json-canvas', 'obsidian-markdown', 'json-canvas'])).toEqual([
            'obsidian-markdown',
            'json-canvas',
        ]);
        expect(normalizeEnabledSkillIds(undefined)).toEqual(DEFAULT_SETTINGS.enabledSkillIds);
    });

    it('renders bundled skill guides as a compact checkbox picker in settings', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();

        const records = getMockSettingRecords();
        const pickerRecord = records.find((record) => record.name === 'Enabled skill guides');
        expect(pickerRecord?.desc).toBe('Choose which guides the assistant may use. Current: All guides enabled.');
        expect(records.some((record) => BUNDLED_SKILL_CATALOG.some((skill) => skill.label === record.name))).toBe(false);

        const summary = containerEl.findAll('.pa-settings-skill-picker__summary-text')[0];
        expect(summary?.textContent).toBe('All guides enabled');

        const checkboxes = containerEl.findAll('input');
        expect(checkboxes).toHaveLength(BUNDLED_SKILL_CATALOG.length + 1);
        expect(checkboxes[0]).toMatchObject({ type: 'checkbox', checked: true, disabled: false });
        expect(checkboxes.slice(1)).toEqual(
            BUNDLED_SKILL_CATALOG.map(() => expect.objectContaining({ checked: true, disabled: false })),
        );
    });

    it('updates skill guide settings from the checkbox picker', async () => {
        const firstSkill = BUNDLED_SKILL_CATALOG[0];
        const plugin = makePlugin({ skillContextEnabled: false });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();

        let checkboxes = containerEl.findAll('input');
        let details = containerEl.findAll('details')[0];
        expect(containerEl.findAll('.pa-settings-skill-picker__summary-text')[0]?.textContent).toBe('Off');
        expect(checkboxes[0]).toMatchObject({ checked: false, disabled: false });
        expect(checkboxes.slice(1)).toEqual(
            BUNDLED_SKILL_CATALOG.map(() => expect.objectContaining({ checked: true, disabled: true })),
        );

        details.open = true;
        checkboxes[0].checked = true;
        checkboxes[0].dispatchEvent({ type: 'change' });
        await Promise.resolve();

        expect(plugin.settings.skillContextEnabled).toBe(true);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(containerEl.findAll('.pa-settings-skill-picker__summary-text')[0]?.textContent).toBe('All guides enabled');
        expect(containerEl.findAll('details')[0]?.open).toBe(true);
        expect(containerEl.findAll('input')[0]?.focus).toHaveBeenCalled();

        checkboxes = containerEl.findAll('input');
        details = containerEl.findAll('details')[0];
        details.open = true;
        checkboxes[1].checked = false;
        checkboxes[1].dispatchEvent({ type: 'change' });
        await Promise.resolve();

        expect(plugin.settings.enabledSkillIds).not.toContain(firstSkill.id);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
        expect(containerEl.findAll('.pa-settings-skill-picker__summary-text')[0]?.textContent).toBe(
            `${BUNDLED_SKILL_CATALOG.length - 1} of ${BUNDLED_SKILL_CATALOG.length} enabled`,
        );
        expect(containerEl.findAll('details')[0]?.open).toBe(true);
        expect(containerEl.findAll('input')[1]?.focus).toHaveBeenCalled();
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
    it('defaults automatic Memory to active and normalizes the pause control', () => {
        expect((DEFAULT_SETTINGS as unknown as Record<string, unknown>).memoryAutoAcceptPaused).toBe(false);
        expect((mergeLoadedSettings({ memoryAutoAcceptPaused: true }) as unknown as Record<string, unknown>)
            .memoryAutoAcceptPaused).toBe(true);
        expect((mergeLoadedSettings({ memoryAutoAcceptPaused: 'corrupted' }) as unknown as Record<string, unknown>)
            .memoryAutoAcceptPaused).toBe(false);
    });

    it('accepts only non-negative safe integer Memory confirmation counts', () => {
        expect(mergeLoadedSettings({ confirmedMemoryCount: 30 }).confirmedMemoryCount).toBe(30);
        for (const value of ['30', -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
            expect(mergeLoadedSettings({ confirmedMemoryCount: value }).confirmedMemoryCount).toBe(0);
        }
    });

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

    it('routes persisted Pagelet diagnostics through the content-free normalizer', () => {
        const merged = mergeLoadedSettings({
            pagelet: {
                scopeRecapLastAttempt: {
                    attemptedAt: '2026-07-18T08:30:00.000Z',
                    outcome: 'success',
                    scope: { kind: 'folder', label: 'Private project' },
                    sourceSnapshotId: 'scope-snapshot',
                    dataBoundarySnapshotId: 'boundary-snapshot',
                    providerCallMade: true,
                    includedSourceCount: 2,
                    summary: 'private generated summary',
                },
                quietRecallLastDiagnostics: { roundId: 'incomplete' },
                quietRecallLastAcceptedCount: '2',
            },
        });

        expect(merged.pagelet.scopeRecapLastAttempt).toEqual({
            attemptedAt: '2026-07-18T08:30:00.000Z',
            outcome: 'success',
            scope: { kind: 'folder' },
            sourceSnapshotId: 'scope-snapshot',
            dataBoundarySnapshotId: 'boundary-snapshot',
            providerCallMade: true,
            includedSourceCount: 2,
        });
        expect(merged.pagelet.quietRecallLastDiagnostics).toBeNull();
        expect(merged.pagelet.quietRecallLastAcceptedCount).toBe(0);
        expect(JSON.stringify(merged.pagelet.scopeRecapLastAttempt)).not.toContain('private');
    });

    it('treats arrays as opaque user values (no element-level merge)', () => {
        const merged = mergeLoadedSettings({ colorGroups: [] });
        expect(merged.colorGroups).toEqual([]);
    });

    it('falls back to defaults when array-backed settings are malformed', () => {
        const merged = mergeLoadedSettings({ colorGroups: 'corrupted' as unknown });
        expect(merged.colorGroups).toEqual(DEFAULT_SETTINGS.colorGroups);
    });

    it('force-disables memoryExtractionEnabled when consent is unconfirmed', () => {
        const merged = mergeLoadedSettings({
            memoryExtractionEnabled: true,
        });
        expect(merged.memoryExtractionEnabled).toBe(false);
        expect(merged.memoryExtractionConsent.state).toBe("unconfirmed");
    });

    it('preserves memoryExtractionEnabled when consent is confirmed', () => {
        const merged = mergeLoadedSettings({
            memoryExtractionEnabled: true,
            memoryExtractionConsent: {
                state: "confirmed",
                version: 1,
                confirmedAt: "2026-07-01T00:00:00.000Z",
            },
        });
        expect(merged.memoryExtractionEnabled).toBe(true);
        expect(merged.memoryExtractionConsent.state).toBe("confirmed");
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

    it('adds a stable Memory & Personalization group and moves Memory into it', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();

        const groupIds = containerEl.findAll('.pa-settings-group').map((node) => node.attrs.id);
        expect(groupIds).toEqual([
            'pa-settings-group-ai-provider',
            'pa-settings-group-memory-personalization',
            'pa-settings-group-data-privacy',
            'pa-settings-group-features',
            'pa-settings-group-appearance',
            'pa-settings-group-system',
        ]);
        const tocItems = containerEl.findAll('.pa-settings-toc-item');
        const groupLabels = [
            'AI & Provider',
            'Memory & Personalization',
            'Data & Privacy',
            'Features',
            'Appearance',
            'System',
        ];
        expect(tocItems.map((node) => node.attrs['aria-label'])).toEqual(groupLabels);
        expect(containerEl.findAll('.pa-settings-toc-item__label').map((node) => node.textContent))
            .toEqual(groupLabels);
        expect(containerEl.findAll('.pa-settings-toc-item__tick')).toHaveLength(6);
        expect(containerEl.findAll('.pa-settings-toc-item__tick')
            .every((node) => node.attrs['aria-hidden'] === 'true')).toBe(true);
        expect(containerEl.findAll('.pa-settings-group').every((group) => (
            group.children[0]?.tagName === 'summary'
            && group.children[1]?.classes.includes('pa-settings-group__body')
        ))).toBe(true);
        const layout = containerEl.findAll('.pa-settings-layout')[0];
        expect(containerEl.findAll('.pa-settings-shell')).toHaveLength(1);
        expect(containerEl.findAll('.pa-settings-shell')[0]?.findAll('.pa-settings-layout')).toHaveLength(1);
        expect(layout.children[0]?.classes).toContain('pa-settings-toc');
        expect(layout.children[1]?.classes).toContain('pa-settings-content');
        const jump = containerEl.findAll('.pa-settings-jump-select')[0];
        expect(jump.classes).toEqual(expect.arrayContaining(['pa-settings-jump-select', 'dropdown']));
        expect(jump.attrs['aria-label']).toBeUndefined();
        expect(jump.findAll('option').map((option) => option.textContent)).toEqual(groupLabels);
        expect(containerEl.findAll('.pa-settings-jump-count')[0]?.textContent).toBe('1/6');
        expect(containerEl.findAll('.pa-settings-jump-progress__segment')).toHaveLength(6);
        expect(containerEl.findAll('.pa-memory-control-center')).toHaveLength(1);
        expect(plugin.getMemoryControlCenterSnapshot).toHaveBeenCalledTimes(1);
    });

    it('keeps desktop TOC and compact jump navigation in sync', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();

        const groups = containerEl.findAll('.pa-settings-group');
        const summaries = containerEl.findAll('.pa-settings-group-summary');
        const tocItems = containerEl.findAll('.pa-settings-toc-item');
        const jump = containerEl.findAll('.pa-settings-jump-select')[0];
        expect(tocItems.map((item) => item.attrs['aria-controls'])).toEqual(
            groups.map((group) => group.attrs.id),
        );
        expect(tocItems[0]?.attrs['aria-current']).toBe('location');
        expect(tocItems.slice(1).every((item) => item.attrs['aria-current'] === 'false')).toBe(true);
        expect(jump.value).toBe('ai-provider');
        expect(containerEl.findAll('.pa-settings-jump-count')[0]?.textContent).toBe('1/6');
        expect(containerEl.findAll('.pa-settings-jump-progress__segment')[0]?.attrs['data-current'])
            .toBe('true');

        groups[1].open = true;
        groups[1].dispatchEvent('toggle');
        expect(tocItems[0]?.attrs['aria-current']).toBe('location');
        expect(jump.value).toBe('ai-provider');

        groups[3].open = false;
        groups[3].dispatchEvent('toggle');
        expect(tocItems[3]?.attrs['aria-expanded']).toBe('false');
        tocItems[3].dispatchEvent('click');

        expect(groups[3].open).toBe(true);
        expect(tocItems[3]?.attrs).toMatchObject({
            'aria-current': 'location',
            'aria-expanded': 'true',
        });
        expect(jump.value).toBe('features');
        expect(containerEl.findAll('.pa-settings-jump-count')[0]?.textContent).toBe('4/6');
        expect(containerEl.findAll('.pa-settings-jump-progress__segment')[3]?.attrs['data-current'])
            .toBe('true');
        expect(summaries[3]?.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(summaries[3]?.focus).toHaveBeenCalledWith({ preventScroll: true });

        jump.value = 'appearance';
        jump.dispatchEvent('change');
        expect(groups[4].open).toBe(true);
        expect(tocItems[4]?.attrs['aria-current']).toBe('location');
        expect(containerEl.findAll('.pa-settings-jump-count')[0]?.textContent).toBe('5/6');
        expect(summaries[4]?.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(summaries[4]?.focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('positions a mobile target below the measured sticky selector', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        const scrollTo = jest.fn();
        const scrollRoot = {
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            getBoundingClientRect: jest.fn(() => ({ top: 10 } as DOMRect)),
            scrollTo,
            scrollTop: 100,
            clientHeight: 400,
            scrollHeight: 1000,
            ownerDocument: {
                body: {
                    classList: { contains: (className: string) => className === 'is-mobile' },
                },
                defaultView: {
                    getComputedStyle: (element: unknown) => (
                        element === scrollRoot
                            ? { paddingBlockStart: '48px', paddingTop: '48px' }
                            : { top: '8px' }
                    ),
                },
            },
        };
        Object.assign(containerEl, { closest: () => scrollRoot });
        tab.containerEl = containerEl as never;

        tab.display();

        const jump = containerEl.findAll('.pa-settings-jump')[0];
        Object.assign(jump, { getBoundingClientRect: () => ({ height: 66 } as DOMRect) });
        const summaries = containerEl.findAll('.pa-settings-group-summary');
        Object.assign(summaries[3], {
            getBoundingClientRect: () => ({ top: 510 } as DOMRect),
        });
        const select = containerEl.findAll('.pa-settings-jump-select')[0];
        select.value = 'features';
        select.dispatchEvent('change');

        expect(scrollTo).toHaveBeenCalledWith({ top: 466, behavior: 'smooth' });
        expect(summaries[3]?.scrollIntoView).not.toHaveBeenCalled();
        expect(summaries[3]?.focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('respects reduced motion and keeps navigation usable when matchMedia throws', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const scrollBehavior = () => (
            tab as unknown as { settingsScrollBehavior: () => ScrollBehavior }
        ).settingsScrollBehavior();
        const documentMock = globalThis.document as unknown as {
            defaultView?: { matchMedia: (query: string) => { matches: boolean } };
        };

        documentMock.defaultView = {
            matchMedia: jest.fn(() => ({ matches: true })),
        };
        expect(scrollBehavior()).toBe('auto');

        documentMock.defaultView = {
            matchMedia: jest.fn(() => { throw new Error('unsupported'); }),
        };
        expect(scrollBehavior()).toBe('smooth');
    });

    it('updates the active group while scrolling and selects System at the bottom', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        const scrollRoot = {
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            getBoundingClientRect: jest.fn(() => ({ top: 0 } as DOMRect)),
            scrollTop: 0,
            clientHeight: 400,
            scrollHeight: 1000,
        };
        Object.assign(containerEl, { closest: () => scrollRoot });
        tab.containerEl = containerEl as never;

        tab.display();

        const summaries = containerEl.findAll('.pa-settings-group-summary');
        [-120, -20, 180, 400, 620, 800].forEach((top, index) => {
            Object.assign(summaries[index], {
                getBoundingClientRect: () => ({ top } as DOMRect),
            });
        });
        const sync = () => (
            tab as unknown as { syncActiveSettingsGroupFromScroll: (ids: string[]) => void }
        ).syncActiveSettingsGroupFromScroll([
            'ai-provider',
            'memory-personalization',
            'data-privacy',
            'features',
            'appearance',
            'system',
        ]);

        sync();
        let tocItems = containerEl.findAll('.pa-settings-toc-item');
        expect(tocItems[1]?.attrs['aria-current']).toBe('location');
        expect(containerEl.findAll('.pa-settings-jump-select')[0]?.value).toBe('memory-personalization');
        expect(containerEl.findAll('.pa-settings-jump-count')[0]?.textContent).toBe('2/6');

        scrollRoot.scrollTop = 600;
        sync();
        tocItems = containerEl.findAll('.pa-settings-toc-item');
        expect(tocItems[5]?.attrs['aria-current']).toBe('location');
        expect(containerEl.findAll('.pa-settings-jump-select')[0]?.value).toBe('system');
        expect(containerEl.findAll('.pa-settings-jump-count')[0]?.textContent).toBe('6/6');
    });

    it('accounts for the sticky selector height when tracking the active mobile group', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        const scrollRoot = {
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            getBoundingClientRect: jest.fn(() => ({ top: 0 } as DOMRect)),
            scrollTop: 0,
            clientHeight: 400,
            scrollHeight: 1000,
            ownerDocument: {
                body: {
                    classList: { contains: (className: string) => className === 'is-mobile' },
                },
            },
        };
        Object.assign(containerEl, { closest: () => scrollRoot });
        tab.containerEl = containerEl as never;

        tab.display();

        const jump = containerEl.findAll('.pa-settings-jump')[0];
        Object.assign(jump, { getBoundingClientRect: () => ({ height: 80 } as DOMRect) });
        (
            tab as unknown as { refreshSettingsNavigationMobileOffset: (root: HTMLElement) => number }
        ).refreshSettingsNavigationMobileOffset(scrollRoot as unknown as HTMLElement);
        const summaries = containerEl.findAll('.pa-settings-group-summary');
        [-120, 93, 180, 400, 620, 800].forEach((top, index) => {
            Object.assign(summaries[index], {
                getBoundingClientRect: () => ({ top } as DOMRect),
            });
        });

        (
            tab as unknown as { syncActiveSettingsGroupFromScroll: (ids: string[]) => void }
        ).syncActiveSettingsGroupFromScroll([
            'ai-provider',
            'memory-personalization',
            'data-privacy',
            'features',
            'appearance',
            'system',
        ]);

        expect(containerEl.findAll('.pa-settings-toc-item')[1]?.attrs['aria-current'])
            .toBe('location');
        expect(containerEl.findAll('.pa-settings-jump-count')[0]?.textContent).toBe('2/6');
    });

    it('shares the measured mobile selector offset with CSS and cleans up its observer', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        const setProperty = jest.fn();
        const removeProperty = jest.fn();
        const mobileOwnerDocument = {
            body: {
                classList: { contains: (className: string) => className === 'is-mobile' },
            },
        };
        Object.assign(containerEl, {
            ownerDocument: mobileOwnerDocument,
            style: { setProperty, removeProperty },
        });
        tab.containerEl = containerEl as never;

        const observe = jest.fn();
        const disconnect = jest.fn();
        class ResizeObserverMock {
            constructor(_callback: ResizeObserverCallback) { }
            observe = observe;
            unobserve = jest.fn();
            disconnect = disconnect;
        }
        const getBoundingClientRect = jest.fn(() => ({ height: 84 } as DOMRect));
        const jump = {
            ownerDocument: {
                defaultView: { ResizeObserver: ResizeObserverMock },
            },
            getBoundingClientRect,
        } as unknown as HTMLElement;

        (
            tab as unknown as { startSettingsNavigationOffsetTracking: (el: HTMLElement) => void }
        ).startSettingsNavigationOffsetTracking(jump);

        expect(observe).toHaveBeenCalledWith(jump);
        expect(setProperty).toHaveBeenCalledWith('--pa-settings-mobile-nav-offset', '96px');

        const activationOffset = (
            tab as unknown as { settingsNavigationActivationOffset: (root: HTMLElement) => number }
        ).settingsNavigationActivationOffset({
            ownerDocument: mobileOwnerDocument,
        } as unknown as HTMLElement);
        expect(activationOffset).toBe(96);
        expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
        expect(setProperty).toHaveBeenCalledTimes(1);

        (
            tab as unknown as { stopSettingsNavigation: () => void }
        ).stopSettingsNavigation();
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(removeProperty).toHaveBeenCalledWith('--pa-settings-mobile-nav-offset');
    });

    it('resyncs the active mobile group when the sticky selector height changes', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        const setProperty = jest.fn();
        let jumpHeight = 84;
        let resizeCallback: ResizeObserverCallback = jest.fn();
        const mobileOwnerDocument = {
            body: {
                classList: { contains: (className: string) => className === 'is-mobile' },
            },
            defaultView: {
                getComputedStyle: (element: unknown) => (
                    element === scrollRoot
                        ? { paddingBlockStart: '48px', paddingTop: '48px' }
                        : { top: '8px' }
                ),
            },
        };
        const scrollRoot = {
            ownerDocument: mobileOwnerDocument,
        };
        Object.assign(containerEl, {
            ownerDocument: mobileOwnerDocument,
            style: { setProperty, removeProperty: jest.fn() },
        });
        tab.containerEl = containerEl as never;

        class ResizeObserverMock {
            constructor(callback: ResizeObserverCallback) {
                resizeCallback = callback;
            }
            observe = jest.fn();
            unobserve = jest.fn();
            disconnect = jest.fn();
        }
        const jump = {
            ownerDocument: {
                ...mobileOwnerDocument,
                defaultView: {
                    ...mobileOwnerDocument.defaultView,
                    ResizeObserver: ResizeObserverMock,
                },
            },
            getBoundingClientRect: () => ({ height: jumpHeight } as DOMRect),
        } as unknown as HTMLElement;
        const sync = jest.fn();
        const privateTab = tab as unknown as {
            settingsScrollRoot: HTMLElement;
            settingsScrollHandler: () => void;
            startSettingsNavigationOffsetTracking: (el: HTMLElement) => void;
        };
        privateTab.settingsScrollRoot = scrollRoot as unknown as HTMLElement;
        privateTab.settingsScrollHandler = sync;

        privateTab.startSettingsNavigationOffsetTracking(jump);
        expect(sync).toHaveBeenCalledTimes(1);
        expect(setProperty).toHaveBeenLastCalledWith(
            '--pa-settings-mobile-nav-offset',
            '152px',
        );

        jumpHeight = 104;
        resizeCallback([] as ResizeObserverEntry[], {} as ResizeObserver);
        expect(sync).toHaveBeenCalledTimes(2);
        expect(setProperty).toHaveBeenLastCalledWith(
            '--pa-settings-mobile-nav-offset',
            '172px',
        );

        resizeCallback([] as ResizeObserverEntry[], {} as ResizeObserver);
        expect(sync).toHaveBeenCalledTimes(2);
    });

    it('removes the scroll listener before redisplay and on hide', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        const scrollRoot = {
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            getBoundingClientRect: jest.fn(() => ({ top: 0 } as DOMRect)),
            scrollTop: 0,
            clientHeight: 400,
            scrollHeight: 1000,
        };
        const hiddenOuter = {
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            getBoundingClientRect: jest.fn(() => ({ top: 0 } as DOMRect)),
            scrollTop: 0,
            clientHeight: 400,
            scrollHeight: 400,
            ownerDocument: {
                defaultView: {
                    getComputedStyle: () => ({ overflowY: 'hidden' }),
                },
            },
        };
        Object.assign(containerEl, {
            closest: (selector: string) => (
                selector === '.vertical-tab-content' ? scrollRoot : hiddenOuter
            ),
        });
        tab.containerEl = containerEl as never;

        tab.display();
        expect(scrollRoot.addEventListener).toHaveBeenCalledTimes(1);
        expect(hiddenOuter.addEventListener).not.toHaveBeenCalled();
        tab.display();
        expect(scrollRoot.removeEventListener).toHaveBeenCalledTimes(1);
        expect(scrollRoot.addEventListener).toHaveBeenCalledTimes(2);
        tab.hide();
        expect(scrollRoot.removeEventListener).toHaveBeenCalledTimes(2);
    });

    it('renders the canonical overview by default without Debug or preview-only copy', async () => {
        const plugin = makePlugin({ debug: false });
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: true, status: 'ready', indexedDocumentCount: 2 },
            vaultInsights: {
                enabled: true,
                status: 'ready',
                generatedAt: '2026-07-10T08:00:00.000Z',
                fileCount: 2,
            },
            profile: {
                enabled: true,
                status: 'ready',
                updatedAt: '2026-07-10T08:00:00.000Z',
                itemCount: 1,
            },
            durable: { activeCount: 2, pausedCount: 1, staleCount: 1 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'effect_based',
            items: [
                {
                    id: 'vault-insights',
                    label: 'Internal aggregate label',
                    origin: 'vault_insights',
                    authority: 'pa_inference',
                    scopeLabel: 'Test vault',
                    effect: 'future_answers',
                    lifecycle: 'derived',
                    provenance: [{
                        kind: 'vault_aggregate',
                        generatedAt: '2026-07-10T08:00:00.000Z',
                        dataBoundaryFingerprint: 'boundary:test',
                        includedFileCount: 2,
                        coverage: 'representative',
                        representativeSourceRefs: [{ path: 'notes/example.md' }],
                    }],
                    observedAt: '2026-07-10T08:00:00.000Z',
                    supportedActions: [],
                },
                {
                    id: 'profile:one',
                    label: 'Prefer concise Chinese replies.',
                    origin: 'user_profile',
                    authority: 'explicit_user',
                    scopeLabel: 'Test vault',
                    effect: 'future_answers',
                    lifecycle: 'derived',
                    provenance: [{
                        kind: 'conversation',
                        conversationId: 'conversation-private-id',
                        observedAt: '2026-07-10T08:00:00.000Z',
                    }],
                    observedAt: '2026-07-10T08:00:00.000Z',
                    supportedActions: [],
                },
                {
                    id: 'saved:auto',
                    claimId: 'saved:auto',
                    label: 'PA inferred a concise planning preference.',
                    origin: 'confirmed_memory',
                    authority: 'pa_inference',
                    scopeLabel: 'Test vault',
                    effect: 'future_answers',
                    lifecycle: 'active',
                    provenance: [{ kind: 'note', sourceRef: { path: 'notes/auto.md' } }],
                    updatedAt: '2026-07-10T08:00:00.000Z',
                    supportedActions: [],
                },
                {
                    id: 'confirmed:forgotten',
                    label: 'secret forgotten content',
                    origin: 'confirmed_memory',
                    authority: 'explicit_user',
                    scopeLabel: 'private/secret.md',
                    effect: 'none',
                    lifecycle: 'forgotten_marker',
                    provenance: [{ kind: 'note', sourceRef: { path: 'private/secret.md' } }],
                    updatedAt: '2026-07-10T08:00:00.000Z',
                    supportedActions: [],
                },
            ],
            degradedSources: [{ source: 'confirmed_memory', code: 'malformed_confirmed_record' }],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const overview = containerEl.findAll('.pa-memory-control-center')[0];
        const collectText = (node: MockDomNode): string => [
            node.textContent,
            ...node.children.map(collectText),
        ].join(' ');
        const renderedText = collectText(overview);
        expect(renderedText).toContain('Prefer concise Chinese replies.');
        expect(renderedText).toContain('Learned from your interactions');
        expect(renderedText).toContain('Explicitly stated by you');
        expect(renderedText).toContain('Test vault');
        expect(renderedText).toContain('May shape future answers');
        expect(renderedText).toContain('Representative examples, not a complete source list');
        expect(renderedText).toContain('Representative note: notes/example.md');
        expect(renderedText).toContain('2 notes within the allowed boundary');
        expect(renderedText).toContain('Some saved understanding could not be read');
        expect(renderedText).toContain('2 in use');
        expect(renderedText).toContain('Paused: 1 · Needs refresh: 1');
        expect(renderedText).toContain('Forgotten marker');
        expect(renderedText).toContain('does not yet claim that every item is device-only');
        expect(renderedText).not.toContain('Development preview');
        expect(overview.findAll('.pa-memory-control-center__preview')).toHaveLength(0);
        expect(renderedText).not.toContain('conversation-private-id');
        expect(renderedText).not.toContain('secret forgotten content');
        const autoSavedItem = overview.findAll('.pa-memory-control-center__item')
            .find((item) => item.dataset.paMemoryTargetId === 'saved:auto');
        const autoSavedText = autoSavedItem ? collectText(autoSavedItem) : '';
        expect(autoSavedText).toContain('Saved understanding');
        expect(autoSavedText).not.toContain('Saved after confirmation');
        expect(renderedText).not.toContain('private/secret.md');
        expect(renderedText).not.toMatch(/\b(VSS|RAG|OPFS|SQLite|Type A|Type C|embedding|vector)\b/i);
        expect(overview.findAll('button')).toHaveLength(0);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('keeps snapshot load failures contained and offers an accessible retry', async () => {
        const plugin = makePlugin({ debug: false });
        plugin.getMemoryControlCenterSnapshot.mockRejectedValueOnce(new Error('snapshot unavailable'));
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const body = containerEl.findAll('.pa-memory-control-center__body')[0];
        const liveStatus = containerEl.findAll('.pa-memory-control-center__live-status')[0];
        expect(body.attrs['aria-busy']).toBe('false');
        expect(body.attrs['aria-live']).toBeUndefined();
        expect(liveStatus.classes).toContain('pa-sr-only');
        expect(liveStatus.attrs).toMatchObject({
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true',
            tabindex: '-1',
        });
        expect(body.findAll('.pa-memory-control-center__error')[0]?.textContent)
            .toContain('Memory and personalization could not be loaded');

        const retry = body.findAll('button').find((button) => button.textContent === 'Retry');
        expect(retry).toBeDefined();
        expect(liveStatus.focus).not.toHaveBeenCalled();
        retry?.dispatchEvent('click');
        expect(liveStatus.focus).toHaveBeenCalledWith({ preventScroll: true });
        for (let index = 0; index < 4; index += 1) await Promise.resolve();

        expect(plugin.getMemoryControlCenterSnapshot).toHaveBeenCalledTimes(2);
        expect(body.attrs['aria-busy']).toBe('false');
        expect(body.findAll('.pa-memory-control-center__card')).toHaveLength(4);
        expect(liveStatus.textContent).toContain('Memory and personalization loaded');
    });

    it('keeps a failed correction editable and validates Save as the user types', async () => {
        const plugin = makePlugin({ debug: false });
        plugin.runMemoryControlCenterAction.mockResolvedValue({
            ok: false,
            message: 'Correction was not saved.',
        });
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: true, status: 'ready', itemCount: 1 },
            durable: { activeCount: 1, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: true,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.deviceLocal',
            },
            governanceMode: 'effect_based',
            items: [{
                id: 'claim-correction',
                claimId: 'claim-correction',
                label: 'Keep answers concise.',
                origin: 'user_profile',
                authority: 'explicit_user',
                scopeLabel: 'Test vault',
                effect: 'future_answers',
                lifecycle: 'active',
                provenance: [{ kind: 'conversation', conversationId: 'conversation-correction' }],
                supportedActions: ['correct'],
            }],
            recentChanges: [],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();
        const displaySpy = jest.spyOn(tab, 'display');
        displaySpy.mockClear();

        containerEl.findAll('button')
            .find((button) => button.textContent === 'Correct')
            ?.dispatchEvent('click');
        const editor = containerEl.findAll('.pa-memory-control-center__correction')[0];
        const input = editor.findAll('textarea')[0];
        const save = editor.findAll('button')
            .find((button) => button.textContent === 'Save correction');
        expect(save?.disabled).toBe(true);

        input.value = 'Keep answers concise.';
        input.dispatchEvent('input');
        expect(save?.disabled).toBe(true);
        input.value = '   ';
        input.dispatchEvent('input');
        expect(save?.disabled).toBe(true);
        input.value = 'Keep answers concise and source-backed.';
        input.dispatchEvent('input');
        expect(save?.disabled).toBe(false);

        save?.dispatchEvent('click');
        for (let index = 0; index < 4; index += 1) await Promise.resolve();

        expect(plugin.runMemoryControlCenterAction).toHaveBeenCalledWith(
            'correct',
            'claim-correction',
            'Keep answers concise and source-backed.',
        );
        expect(displaySpy).not.toHaveBeenCalled();
        expect(containerEl.findAll('.pa-memory-control-center__correction')).toContain(editor);
        expect(input.value).toBe('Keep answers concise and source-backed.');
        expect(save?.disabled).toBe(false);
        expect(input.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    });

    it('round-trips a legacy Pagelet record ID to the exact Settings item', async () => {
        const legacyRecordId = 'legacy-record-exact';
        const snapshot = buildMemoryControlCenterSnapshot({
            now: new Date('2026-07-10T08:00:00.000Z'),
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: {
                enabled: false,
                storageState: 'not_loaded',
                currentDataBoundaryFingerprint: 'boundary:test',
                snapshot: null,
            },
            profile: { featureEnabled: false, storageState: 'empty', snapshot: null },
            confirmedRecords: [{
                id: legacyRecordId,
                type: 'preference',
                lifecycle: 'active',
                sensitivity: 'low',
                sourceRefs: [{ path: 'notes/preference.md', evidenceStrength: 'strong' }],
                summary: 'Prefer concise replies.',
                scope: { kind: 'current_note', paths: ['notes/preference.md'] },
                createdAt: '2026-07-01T08:00:00.000Z',
                updatedAt: '2026-07-09T08:00:00.000Z',
                confirmationStrength: 'explicit',
            }],
            boundary: {
                vaultScopeLabel: 'Test vault',
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            capabilities: {
                correct: false,
                undoRecentChange: false,
                pauseUse: false,
                resumeUse: false,
                forget: false,
            },
        });
        const plugin = makePlugin({ debug: false });
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            ...snapshot,
            governanceMode: 'legacy_threshold',
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.openGroup('memory-personalization', legacyRecordId);
        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const target = containerEl.findAll('.pa-memory-control-center__item')
            .find((item) => item.dataset.paMemoryTargetId === legacyRecordId);
        expect(target).toBeDefined();
        expect(target?.focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(target?.classes).toContain('pa-memory-control-center__item--targeted');
    });

    it('uses outcome language when saved understanding is unavailable', async () => {
        const plugin = makePlugin({ debug: false });
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'unavailable',
            items: [],
            recentChanges: [],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const warning = containerEl.findAll('.pa-memory-control-center__warning')
            .find((item) => item.textContent.includes('Saved understanding is temporarily unavailable'));
        expect(warning?.textContent).toContain('will not apply new changes');
        expect(warning?.textContent).not.toMatch(/governance|automatic-accept/i);
    });

    it('routes governed item and Recent changes actions with their exact claim and event IDs', async () => {
        const plugin = makePlugin({ debug: false });
        plugin.runMemoryControlCenterAction.mockResolvedValue({ ok: true, message: 'Memory updated.' });
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: true, status: 'ready', indexedDocumentCount: 1 },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: true, status: 'ready', itemCount: 1 },
            durable: { activeCount: 1, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: true,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.deviceLocal',
            },
            governanceMode: 'effect_based',
            items: [{
                id: 'item-display-id',
                claimId: 'claim-exact-123',
                label: 'Use concise source-backed answers.',
                origin: 'user_profile',
                authority: 'user_correction',
                scopeLabel: 'Test vault',
                effect: 'future_answers',
                lifecycle: 'active',
                provenance: [{
                    kind: 'conversation',
                    conversationId: 'conversation-private-id',
                    observedAt: '2026-07-10T07:00:00.000Z',
                }],
                updatedAt: '2026-07-10T08:00:00.000Z',
                supportedActions: ['pause_use', 'apply_device_wide'],
            }, {
                id: 'claim-forget-pending',
                claimId: 'claim-forget-pending',
                label: '',
                origin: 'confirmed_memory',
                authority: 'source_observation',
                scopeLabel: '',
                effect: 'none',
                lifecycle: 'forget_pending',
                provenance: [],
                updatedAt: '2026-07-10T08:05:00.000Z',
                supportedActions: ['retry_forget'],
            }],
            recentChanges: [{
                id: 'event-exact-456',
                claimId: 'claim-exact-123',
                kind: 'correct',
                occurredAt: '2026-07-10T08:00:00.000Z',
                label: 'Use concise source-backed answers.',
                sourcePath: 'notes/preference.md',
                scopeLabel: 'Test vault',
                effect: 'future_answers',
                status: 'active',
                redacted: false,
                supportedActions: ['undo_recent_change'],
            }],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.openGroup('memory-personalization', 'claim-exact-123');
        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const exactTarget = containerEl.findAll('.pa-memory-control-center__item')
            .find((item) => item.dataset.paMemoryTargetId === 'claim-exact-123');
        expect(exactTarget).toBeDefined();
        expect(exactTarget?.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        expect(exactTarget?.focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(exactTarget?.classes).toContain('pa-memory-control-center__item--targeted');

        const pause = containerEl.findAll('button')
            .find((button) => button.textContent === 'Pause use');
        const applyDeviceWide = containerEl.findAll('button')
            .find((button) => button.textContent === 'Use across vaults on this device');
        const undo = containerEl.findAll('button')
            .find((button) => button.textContent === 'Undo this change');
        const retryForget = containerEl.findAll('button')
            .find((button) => button.textContent === 'Retry cleanup');
        expect(pause).toBeDefined();
        expect(applyDeviceWide).toBeDefined();
        expect(undo).toBeDefined();
        expect(retryForget).toBeDefined();
        const collectTargetText = (node: MockDomNode): string => [
            node.textContent,
            ...node.children.map(collectTargetText),
        ].join(' ');
        const recentChange = containerEl.findAll('.pa-memory-control-center__item')
            .find((item) => item.dataset.paMemoryTargetId === 'event-exact-456');
        expect(recentChange).toBeDefined();
        expect(collectTargetText(recentChange!)).toContain('Understanding corrected');
        expect(collectTargetText(recentChange!)).toContain('Use concise source-backed answers.');
        expect(collectTargetText(containerEl)).toContain('Source note: notes/preference.md');
        expect(collectTargetText(containerEl)).toContain('The saved content and source details are already unavailable');
        pause?.dispatchEvent('click');
        for (let index = 0; index < 6; index += 1) await Promise.resolve();

        expect(plugin.runMemoryControlCenterAction).toHaveBeenCalledWith(
            'pause_use',
            'claim-exact-123',
            undefined,
        );

        applyDeviceWide?.dispatchEvent('click');
        for (let index = 0; index < 6; index += 1) await Promise.resolve();

        expect(plugin.runMemoryControlCenterAction).toHaveBeenCalledWith(
            'apply_device_wide',
            'claim-exact-123',
            undefined,
        );

        undo?.dispatchEvent('click');
        for (let index = 0; index < 6; index += 1) await Promise.resolve();

        expect(plugin.runMemoryControlCenterAction).toHaveBeenCalledWith(
            'undo_recent_change',
            'event-exact-456',
            undefined,
        );
        retryForget?.dispatchEvent('click');
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
        expect(plugin.runMemoryControlCenterAction).toHaveBeenCalledWith(
            'retry_forget',
            'claim-forget-pending',
            undefined,
        );
        expect(plugin.runMemoryControlCenterAction).not.toHaveBeenCalledWith(
            expect.anything(),
            'item-display-id',
            expect.anything(),
        );
    });

    it('shows fresh recovery proof and a safe reason when finalization is blocked', async () => {
        const baseSnapshot = {
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'effect_based',
            items: [],
            recentChanges: [],
            degradedSources: [],
        } as const;
        const collectText = (node: MockDomNode): string => [
            node.textContent,
            ...node.children.map(collectText),
        ].join(' ');

        const freshPlugin = makePlugin({ debug: false });
        freshPlugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            ...baseSnapshot,
            compatibilityFinalization: {
                phase: 'compatibility',
                eligible: true,
                confirmationToken: 'fresh-token',
                legacyRecordCount: 1,
                legacyMemoryQueueCount: 0,
                warningCode: 'other_devices_may_still_depend_on_legacy_data',
                requiresFreshRestoreProof: true,
            },
        } as never);
        const freshTab = new SettingTab(makeMockApp() as never, freshPlugin as never);
        const freshContainer = new MockContainerEl('div');
        freshTab.containerEl = freshContainer as never;
        freshTab.display();
        await Promise.resolve();
        await Promise.resolve();

        expect(collectText(freshContainer)).toContain(
            'The previous recovery window ended. Before cleanup, PA will create a temporary local recovery copy',
        );

        const blockedPlugin = makePlugin({ debug: false });
        blockedPlugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            ...baseSnapshot,
            compatibilityFinalization: {
                phase: 'compatibility',
                eligible: false,
                legacyRecordCount: 0,
                legacyMemoryQueueCount: 0,
                warningCode: 'other_devices_may_still_depend_on_legacy_data',
                blockedReason: 'finalization_pending_operations',
            },
        } as never);
        const blockedTab = new SettingTab(makeMockApp() as never, blockedPlugin as never);
        const blockedContainer = new MockContainerEl('div');
        blockedTab.containerEl = blockedContainer as never;
        blockedTab.display();
        await Promise.resolve();
        await Promise.resolve();

        const blockedText = collectText(blockedContainer);
        expect(blockedText).toContain('PA is still finishing another Memory change.');
        expect(blockedText).not.toContain('finalization_pending_operations');
        expect(blockedContainer.findAll('.pa-memory-control-center__finalization')[0]?.open).toBe(true);
        expect(blockedContainer.findAll('p').some((node) => node.attrs.role === 'status')).toBe(true);
    });

    it.each([
        'governed_cutover_incomplete',
        'finalization_not_available',
        'finalization_confirmation_stale',
        'finalization_state_changed',
    ])('keeps an inactive empty finalization collapsed for %s', async (blockedReason) => {
        const plugin = makePlugin({ debug: false });
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'effect_based',
            compatibilityFinalization: {
                phase: 'compatibility',
                eligible: false,
                legacyRecordCount: 0,
                legacyMemoryQueueCount: 0,
                warningCode: 'other_devices_may_still_depend_on_legacy_data',
                blockedReason,
            },
            items: [],
            recentChanges: [],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const finalization = containerEl.findAll('.pa-memory-control-center__finalization')[0];
        expect(finalization.open).toBe(false);
        expect(finalization.findAll('.pa-memory-control-center__warning')).toHaveLength(0);
        expect(plugin.getMemoryFinalizationStatusMessage).not.toHaveBeenCalled();
    });

    it.each([
        'legacy_source_reconciliation_required',
        'legacy_source_verification_failed',
    ])('expands an empty finalization when %s requires attention', async (blockedReason) => {
        const plugin = makePlugin({ debug: false });
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'effect_based',
            compatibilityFinalization: {
                phase: 'compatibility',
                eligible: false,
                legacyRecordCount: 0,
                legacyMemoryQueueCount: 0,
                warningCode: 'other_devices_may_still_depend_on_legacy_data',
                blockedReason,
            },
            items: [],
            recentChanges: [],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const finalization = containerEl.findAll('.pa-memory-control-center__finalization')[0];
        expect(finalization.open).toBe(true);
        expect(finalization.findAll('.pa-memory-control-center__warning')).toHaveLength(1);
        expect(plugin.getMemoryFinalizationStatusMessage).toHaveBeenCalledWith(blockedReason);
    });

    it('places Data and recovery after Recent changes and expands only active recovery work', async () => {
        const plugin = makePlugin({ debug: false });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const body = containerEl.findAll('.pa-memory-control-center__body')[0];
        const recent = body.findAll('.pa-memory-control-center__recent')[0];
        const recovery = body.findAll('.pa-memory-control-center__recovery')[0];
        expect(recovery.tagName).toBe('details');
        expect(recovery.open).toBe(false);
        expect(body.children.indexOf(recent)).toBeLessThan(body.children.indexOf(recovery));

        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'effect_based',
            compatibilityRollback: {
                phase: 'rolling_back',
                eligible: true,
                legacyRecordCount: 1,
                legacyMemoryQueueCount: 0,
            },
            items: [],
            recentChanges: [],
            degradedSources: [],
        } as never);
        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        expect(containerEl.findAll('.pa-memory-control-center__recovery')[0]?.open).toBe(true);
    });

    it('keeps the Data and recovery summary at a 44px touch target on mobile and narrow layouts', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');

        expect(css).toMatch(/body\.is-mobile \.pa-memory-control-center__recovery > summary\s*{[^}]*min-height:\s*44px;/);
        expect(css).toMatch(/@container\s+pa-settings-tab\s+\(max-width:\s*720px\)\s*{[\s\S]*?\.pa-memory-control-center__recovery > summary\s*{[^}]*min-height:\s*44px;/);
    });

    it('does not rerender Settings when a Memory action finishes after close', async () => {
        let resolveAction!: (value: { ok: boolean; message: string }) => void;
        const actionPending = new Promise<{ ok: boolean; message: string }>((resolve) => {
            resolveAction = resolve;
        });
        const plugin = makePlugin({ debug: false });
        plugin.runMemoryControlCenterAction.mockReturnValue(actionPending);
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 1, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: true,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.deviceLocal',
            },
            governanceMode: 'effect_based',
            items: [{
                id: 'claim-close-race',
                claimId: 'claim-close-race',
                label: 'Keep answers concise.',
                origin: 'user_profile',
                authority: 'explicit_user',
                scopeLabel: 'Test vault',
                effect: 'future_answers',
                lifecycle: 'active',
                provenance: [{ kind: 'conversation', conversationId: 'conversation-close-race' }],
                supportedActions: ['pause_use'],
            }],
            recentChanges: [],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();
        const displaySpy = jest.spyOn(tab, 'display');
        displaySpy.mockClear();

        containerEl.findAll('button')
            .find((button) => button.textContent === 'Pause use')
            ?.dispatchEvent('click');
        await Promise.resolve();
        tab.hide();
        resolveAction({ ok: true, message: 'Paused' });
        for (let index = 0; index < 6; index += 1) await Promise.resolve();

        expect(displaySpy).not.toHaveBeenCalled();
    });

    it('does not rerender Settings when finalization finishes after close', async () => {
        const globalObj = globalThis as typeof globalThis & { __paConfirmDecision?: boolean };
        globalObj.__paConfirmDecision = true;
        let resolveFinalization!: (value: { ok: boolean; message: string }) => void;
        const finalizationPending = new Promise<{ ok: boolean; message: string }>((resolve) => {
            resolveFinalization = resolve;
        });
        try {
            const plugin = makePlugin({ debug: false });
            plugin.finalizeMemoryGovernance.mockReturnValue(finalizationPending);
            plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
                generatedAt: '2026-07-10T08:00:00.000Z',
                noteMemory: { enabled: false, status: 'disabled' },
                vaultInsights: { enabled: false, status: 'disabled' },
                profile: { enabled: false, status: 'disabled', itemCount: 0 },
                durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
                boundary: {
                    vaultScoped: true,
                    deviceLocalProven: false,
                    explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
                },
                governanceMode: 'effect_based',
                compatibilityFinalization: {
                    phase: 'compatibility',
                    eligible: true,
                    confirmationToken: 'confirmation-token',
                    legacyRecordCount: 1,
                    legacyMemoryQueueCount: 0,
                    warningCode: 'other_devices_may_still_depend_on_legacy_data',
                    requiresFreshRestoreProof: true,
                },
                items: [],
                recentChanges: [],
                degradedSources: [],
            } as never);
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            const containerEl = new MockContainerEl('div');
            tab.containerEl = containerEl as never;
            tab.display();
            await Promise.resolve();
            await Promise.resolve();
            const displaySpy = jest.spyOn(tab, 'display');
            displaySpy.mockClear();
            expect(containerEl.findAll('p').some((element) => (
                element.textContent.includes('The previous recovery window ended')
            ))).toBe(true);

            containerEl.findAll('button')
                .find((button) => button.textContent === 'Finish setup on this device')
                ?.dispatchEvent('click');
            for (let index = 0; index < 4; index += 1) await Promise.resolve();
            expect(plugin.finalizeMemoryGovernance).toHaveBeenCalledWith('confirmation-token');
            tab.hide();
            resolveFinalization({ ok: true, message: 'Complete' });
            for (let index = 0; index < 6; index += 1) await Promise.resolve();

            expect(displaySpy).not.toHaveBeenCalled();
        } finally {
            delete globalObj.__paConfirmDecision;
        }
    });

    it('does not start finalization when Settings closes while confirmation is pending', async () => {
        let resolveConfirmation!: (value: boolean) => void;
        const confirmationPending = new Promise<boolean>((resolve) => {
            resolveConfirmation = resolve;
        });
        (confirmUserAction as jest.Mock).mockImplementationOnce(() => confirmationPending);
        const plugin = makePlugin({ debug: false });
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'effect_based',
            compatibilityFinalization: {
                phase: 'compatibility',
                eligible: true,
                confirmationToken: 'stale-confirmation-token',
                legacyRecordCount: 1,
                legacyMemoryQueueCount: 0,
                warningCode: 'other_devices_may_still_depend_on_legacy_data',
            },
            items: [],
            recentChanges: [],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        containerEl.findAll('button')
            .find((button) => button.textContent === 'Finish setup on this device')
            ?.dispatchEvent('click');
        await Promise.resolve();
        expect(confirmUserAction).toHaveBeenCalledTimes(1);

        tab.hide();
        resolveConfirmation(true);
        for (let index = 0; index < 4; index += 1) await Promise.resolve();

        expect(plugin.finalizeMemoryGovernance).not.toHaveBeenCalled();
    });

    it('ignores a stale async overview result after Settings closes', async () => {
        let resolveSnapshot: ((value: unknown) => void) | undefined;
        const pending = new Promise((resolve) => { resolveSnapshot = resolve; });
        const plugin = makePlugin({ debug: true });
        plugin.getMemoryControlCenterSnapshot.mockReturnValue(pending as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;

        tab.display();
        tab.hide();
        resolveSnapshot?.({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 0, pausedCount: 0, staleCount: 0 },
            boundary: { vaultScoped: true, deviceLocalProven: false, explanationKey: 'compatibility' },
            items: [],
            degradedSources: [],
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(containerEl.findAll('.pa-memory-control-center__cards')).toHaveLength(0);
        expect(containerEl.findAll('.pa-memory-control-center__loading')).toHaveLength(1);
    });

    it('display() renders sections in the new IA order (h1/h2/h3 + featured image)', () => {
        // Use qwen so the otherwise-empty Featured Image section actually emits
        // a Setting we can locate in the order check.
        const plugin = makePlugin({ aiProvider: 'qwen' });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();

        // Walk all nodes recursively in render order. Heading tags
        // (h1/h2/h3) are collected by textContent. With grouped settings
        // (<details> wrappers), headings are nested inside groups, not
        // top-level children.
        type MockNode = { tagName: string; textContent?: string; children?: MockNode[] };
        const headingTags = new Set(['h1', 'h2', 'h3']);
        const sectionLabels: string[] = [];
        const walkNodes = (nodes: MockNode[]) => {
            for (const node of nodes) {
                if (headingTags.has(node.tagName)) {
                    sectionLabels.push(`${node.tagName}:${node.textContent ?? ''}`);
                }
                if (node.children) walkNodes(node.children);
            }
        };
        const children = (tab.containerEl as unknown as { children: MockNode[] }).children;
        walkNodes(children);

        // Skills uses h3, all others h2; the only un-titled section is
        // Featured Image, which we verify separately below.
        expect(sectionLabels).toEqual([
            'h1:Settings for Obsidian Assistant',
            'h2:AI Assistant',
            'h3:Qwen response options',
            'h3:Skill guides',
            'h2:Memory and personalization',
            'h2:Memory',
            'h2:Data & Privacy Boundaries',
            'h3:Local recall preferences',
            'h3:Local data cleanup',
            // Pagelet section ships between Memory and Statistics (B3). Its
            // sub-headings are also top-level
            // children of containerEl because `renderPageletSection` writes
            // them onto the same parent as the h2.
            'h2:Pagelet',
            'h3:General',
            'h3:Model',
            'h3:Limits',
            'h3:Pet',
            'h3:Background Review Preparation',
            'h3:Scope Recap',
            'h3:Reviews',
            'h3:Quiet Recall',
            'h3:Quiet Hours',
            'h3:Foreground Cost',
            'h2:Quick Capture',
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
        // aiProvider='qwen' it renders a single "Featured image folder" Setting.
        // Use the Setting record list to confirm it falls in that gap, between
        // the metadata section's only default-rendered Setting ("Enable
        // Updating Metadata") and Advanced's Debug toggle.
        const settingNames = getMockSettingRecords().map((r) => r.name);
        const featuredIdx = settingNames.indexOf('Featured image folder');
        const metadataIdx = settingNames.indexOf('Enable Updating Metadata');
        const debugIdx = settingNames.indexOf('Debug');
        expect(featuredIdx).toBeGreaterThan(-1);
        expect(metadataIdx).toBeGreaterThan(-1);
        expect(debugIdx).toBeGreaterThan(-1);
        expect(featuredIdx).toBeGreaterThan(metadataIdx);
        expect(featuredIdx).toBeLessThan(debugIdx);

        const featuredSetting = getMockSettingRecords()[featuredIdx];
        expect(featuredSetting.desc).toContain('saved in your vault');
        expect(featuredSetting.texts[0].placeholder).toBe('attachments/ai-images');
    });

    it('renders Quick Capture destination settings with safe defaults', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const records = getMockSettingRecords();
        const quickCaptureToggle = records.find((record) => record.name === 'Quick Capture')?.toggles[0];
        const destination = records.find((record) => record.name === 'Save captures to')?.dropdowns[0];
        const inboxPath = records.find((record) => record.name === 'Inbox note path')?.texts[0];
        const postProcessingToggle = records.find((record) => record.name === 'Prepare suggestions after saving')?.toggles[0];

        expect(quickCaptureToggle?.value).toBe(true);
        expect(destination?.value).toBe('daily');
        expect(destination?.options).toEqual([
            { value: 'daily', text: 'Daily Note' },
            { value: 'inbox', text: 'Inbox note' },
            { value: 'current-file', text: 'Current file' },
        ]);
        expect(inboxPath?.value).toBe('Inbox/Quick Capture.md');
        expect(postProcessingToggle?.value).toBe(false);

        destination?.onChange?.('current-file');
        inboxPath?.onChange?.('Captures/Inbox');
        postProcessingToggle?.onChange?.(true);

        expect(plugin.settings.quickCapture.destination).toBe('current-file');
        expect(plugin.settings.quickCapture.inboxPath).toBe('Captures/Inbox.md');
        expect(plugin.settings.quickCapture.postProcessingEnabled).toBe(true);
    });

    it('normalizes Data Boundary settings with safe defaults', () => {
        expect(DATA_BOUNDARY_DEFAULTS.generatedNotePolicy).toBe('exclude-generated');
        expect(DATA_BOUNDARY_DEFAULTS.providerDisclosureReasons).toContain('broad_scope');
        expect(DATA_BOUNDARY_DEFAULTS.cleanupGroups).toEqual([
            'cache',
            'queue',
            'replay',
            'candidates',
            'confirmed_memory',
            'tombstones',
        ]);

        expect(mergeDataBoundarySettings({
            excludedFolders: [' private ', '', 'private', 'archive/sensitive'],
            excludedTags: [' sensitive ', 'sensitive', ''],
            generatedNotePolicy: 'bad-policy',
            providerDisclosureReasons: ['broad_scope', 'not-real'],
            cleanupGroups: ['cache', 'bad-group'],
        })).toEqual({
            excludedFolders: ['private', 'archive/sensitive'],
            excludedTags: ['sensitive'],
            generatedNotePolicy: 'exclude-generated',
            providerDisclosureReasons: ['broad_scope'],
            cleanupGroups: ['cache'],
        });
        expect(mergeDataBoundarySettings({
            generatedNotePolicy: 'ask',
        }).generatedNotePolicy).toBe('exclude-generated');
        expect(mergeDataBoundarySettings({
            generatedNotePolicy: 'include-generated',
        }).generatedNotePolicy).toBe('include-generated');
    });

    it('normalizes Context Pager settings with the M6-visible default enabled', () => {
        expect(CONTEXT_PAGER_DEFAULTS.enabled).toBe(true);
        expect(DEFAULT_SETTINGS.contextPager.enabled).toBe(true);
        expect(mergeContextPagerSettings(undefined).enabled).toBe(true);
        expect(mergeLoadedSettings({ contextPager: { enabled: false } }).contextPager.enabled).toBe(false);
    });

    it('keeps Maintenance Review weekly scans disabled by default', () => {
        expect(DEFAULT_SETTINGS.maintenanceReview.weeklyScanEnabled).toBe(false);
        expect(DEFAULT_SETTINGS.maintenanceReview.actionLog).toEqual([]);
        expect(mergeMaintenanceReviewSettings(undefined).weeklyScanEnabled).toBe(false);
        expect(mergeMaintenanceReviewSettings({ weeklyScanEnabled: 'yes' }).weeklyScanEnabled).toBe(false);
        expect(mergeLoadedSettings({ maintenanceReview: { weeklyScanEnabled: true } }).maintenanceReview).toMatchObject({
            weeklyScanEnabled: true,
            actionLog: [],
        });
        const merged = mergeMaintenanceReviewSettings({
            actionLog: [
                {
                    id: 'act-1',
                    proposalId: 'maint-1',
                    reviewQueueItemId: 'rq-1',
                    actionType: 'move',
                    status: 'applied',
                    oldPath: 'Inbox/Quick Capture.md',
                    newPath: 'Notes/Quick Capture.md',
                    appliedAt: '2026-06-28T12:00:00.000Z',
                    sourceRefs: [{
                        path: 'Inbox/Quick Capture.md',
                        excerptHash: 'abc123',
                        whyShown: ['Inbox note'],
                        evidenceStrength: 'medium',
                    }],
                    dataBoundarySnapshotId: 'boundary',
                    undoStrategy: 'move_back',
                },
                {
                    id: 'raw-1',
                    proposalId: 'maint-raw',
                    actionType: 'move',
                    status: 'applied',
                    oldPath: 'Inbox/raw.md',
                    newPath: 'Notes/raw.md',
                    appliedAt: '2026-06-28T12:00:00.000Z',
                    sourceRefs: [{ path: 'Inbox/raw.md', excerpt: 'raw note text' }],
                    dataBoundarySnapshotId: 'boundary',
                    undoStrategy: 'move_back',
                },
            ],
        });
        expect(merged.actionLog).toHaveLength(1);
        expect(merged.actionLog[0]).toMatchObject({
            id: 'act-1',
            oldPath: 'Inbox/Quick Capture.md',
            newPath: 'Notes/Quick Capture.md',
        });
    });

    it('keeps Weekly Review manual-first and Quiet Recall bubble-off by default', () => {
        expect(DEFAULT_SETTINGS.weeklyReview).toEqual({
            enabled: true,
            preparedReviewEnabled: false,
        });
        expect(DEFAULT_SETTINGS.quietRecall).toEqual({
            enabled: true,
            bubbleNudgesEnabled: false,
            quietRecallMode: "off",
        });
        expect(DEFAULT_SETTINGS.retrievalHabitProfile).toEqual({
            enabled: false,
            state: { aggregates: [] },
        });
        expect(mergeLoadedSettings({
            weeklyReview: { enabled: false, preparedReviewEnabled: true },
            quietRecall: { enabled: false, bubbleNudgesEnabled: true },
            retrievalHabitProfile: {
                enabled: true,
                state: {
                    aggregates: [{
                        key: "relation:current",
                        signal: "quiet_recall_relation",
                        counts: { view: 1 },
                        updatedAt: "2026-06-29T12:00:00.000Z",
                    }],
                },
            },
        })).toMatchObject({
            weeklyReview: {
                enabled: false,
                preparedReviewEnabled: true,
            },
            quietRecall: {
                enabled: false,
                bubbleNudgesEnabled: true,
            },
            retrievalHabitProfile: {
                enabled: true,
                state: {
                    aggregates: [{
                        key: "relation:current",
                        signal: "quiet_recall_relation",
                        counts: { view: 1 },
                        updatedAt: "2026-06-29T12:00:00.000Z",
                    }],
                },
            },
        });
        expect(mergeLoadedSettings({
            weeklyReview: { enabled: "yes", preparedReviewEnabled: "yes" },
            quietRecall: { enabled: "yes", bubbleNudgesEnabled: "yes" },
            retrievalHabitProfile: {
                enabled: "yes",
                state: {
                    aggregates: [{
                        key: "raw:path.md",
                        signal: "quiet_recall_relation",
                        counts: { view: "often" },
                        updatedAt: "2026-06-29T12:00:00.000Z",
                    }],
                },
            },
        })).toMatchObject({
            weeklyReview: {
                enabled: true,
                preparedReviewEnabled: false,
            },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: false,
            },
            retrievalHabitProfile: {
                enabled: false,
                state: { aggregates: [] },
            },
        });
    });

    it('normalizes Saved Insight and Memory governance settings through local contracts', () => {
        const saved = mergeSavedInsightSettings({
            items: [{
                id: 'ins-1',
                type: 'theme',
                text: 'Pricing notes keep coming back.',
                origin: 'pa-generated',
                sourceRefs: [{ path: 'notes/current.md', excerptHash: 'abc123' }],
                whyShown: ['Recurring theme'],
                scope: { kind: 'current_note', paths: ['notes/current.md'] },
                status: 'active',
                influencePolicy: 'weak-only',
                createdAt: '2026-06-28T01:00:00.000Z',
                updatedAt: '2026-06-28T01:00:00.000Z',
            }, {
                id: 'ins-bad',
                type: 'theme',
                text: 'Missing source',
                origin: 'pa-generated',
                sourceRefs: [],
                whyShown: [],
                scope: { kind: 'custom' },
                status: 'active',
                influencePolicy: 'weak-only',
                createdAt: '2026-06-28T01:00:00.000Z',
                updatedAt: '2026-06-28T01:00:00.000Z',
            }],
        });
        const memory = mergeMemoryGovernanceSettings({
            records: [{
                id: 'mem-1',
                type: 'preference',
                lifecycle: 'active',
                sensitivity: 'low',
                summary: 'Prefers concise weekly planning.',
                sourceRefs: [{ path: 'notes/current.md', excerptHash: 'def456' }],
                scope: { kind: 'current_note', paths: ['notes/current.md'] },
                createdAt: '2026-06-28T01:00:00.000Z',
                updatedAt: '2026-06-28T01:00:00.000Z',
            }, {
                id: 'mem-bad',
                type: 'decision',
                lifecycle: 'active',
                sensitivity: 'low',
                summary: 'A decision without source should not load.',
                sourceRefs: [],
                scope: { kind: 'custom' },
                createdAt: '2026-06-28T01:00:00.000Z',
                updatedAt: '2026-06-28T01:00:00.000Z',
            }],
        });

        expect(saved.items).toHaveLength(1);
        expect(saved.items[0].id).toBe('ins-1');
        expect(memory.records).toHaveLength(1);
        expect(memory.records[0].id).toBe('mem-1');
    });

    it('renders Data Boundary settings and only enables explicit forgetting-prevention cleanup', () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const records = getMockSettingRecords();
        const excludedFolders = records.find((record) => record.name === 'Excluded folders')?.texts[0];
        const excludedTags = records.find((record) => record.name === 'Excluded tags')?.texts[0];
        const generatedNotes = records.find((record) => record.name === 'Generated notes')?.dropdowns[0];
        const providerDisclosure = records.find((record) => record.name === 'Provider disclosure');
        expect(excludedFolders?.value).toBe('.obsidian');
        expect(excludedTags?.value).toBe('');
        expect(generatedNotes?.value).toBe('exclude-generated');
        expect(generatedNotes?.options).toEqual([
            { value: 'exclude-generated', text: 'Skip generated notes' },
            { value: 'include-generated', text: 'Allow generated notes' },
        ]);
        expect(providerDisclosure?.desc).toContain('PA asks before broad');
        const unavailableCleanupRecords = [
            'Local cache', 'Review queue', 'Replay metadata',
            'Candidates', 'Confirmed Memory', 'Tombstones',
        ].map((name) => records.find((record) => record.name === name));
        expect(unavailableCleanupRecords.every((r) => r === undefined)).toBe(true);
        expect(records.find((record) => record.name === 'Memory cleanup and recovery')
            ?.buttons[0]).toMatchObject({
            text: 'Open Memory controls',
        });

        excludedFolders?.onChange?.('private, archive/sensitive, private');
        excludedTags?.onChange?.('#sensitive, private');
        generatedNotes?.onChange?.('include-generated');

        expect(plugin.settings.dataBoundary.excludedFolders).toEqual(['private', 'archive/sensitive']);
        expect(plugin.settings.dataBoundary.excludedTags).toEqual(['sensitive', 'private']);
        expect(plugin.settings.dataBoundary.generatedNotePolicy).toBe('include-generated');
    });

    it('routes Data cleanup to the exact canonical Memory data-and-recovery control', async () => {
        const plugin = makePlugin();
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        const containerEl = new MockContainerEl('div');
        tab.containerEl = containerEl as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();

        const route = getMockSettingRecords()
            .find((record) => record.name === 'Memory cleanup and recovery')?.buttons[0];
        await route?.onClick?.();

        const target = containerEl.findAll('.pa-memory-control-center__item')
            .find((item) => item.dataset.paMemoryTargetId === 'memory-data-recovery');
        expect(target).toBeDefined();
        expect(target?.open).toBe(true);
        expect(target?.focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(target?.classes).toContain('pa-memory-control-center__item--targeted');
    });

    it('requires explicit confirmation before clearing local prevention markers', async () => {
        const plugin = makePlugin();
        plugin.getMemorySuppressionMarkerCount.mockReturnValue(2);
        plugin.clearMemorySuppressionMarkers.mockResolvedValue({
            ok: true,
            message: 'Cleared 2 prevention markers for this vault.',
            clearedCount: 2,
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();
        const action = getMockSettingRecords()
            .find((record) => record.name === 'Forgetting prevention for this vault')?.buttons[0];
        expect(action).toMatchObject({ disabled: false });

        setMockConfirmDecision(false);
        await action?.onClick?.();
        expect(plugin.clearMemorySuppressionMarkers).not.toHaveBeenCalled();

        setMockConfirmDecision(true);
        await action?.onClick?.();
        expect(plugin.clearMemorySuppressionMarkers).toHaveBeenCalledTimes(1);
    });

    it('offers verified compatibility rollback only after explicit confirmation', async () => {
        const plugin = makePlugin();
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 1, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'effect_based',
            compatibilityRollback: {
                phase: 'compatibility',
                eligible: true,
                legacyRecordCount: 1,
                legacyMemoryQueueCount: 1,
                rollbackExpiresAt: '2026-07-17T08:00:00.000Z',
            },
            items: [],
            recentChanges: [],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();
        const action = getMockSettingRecords()
            .find((record) => record.name === 'Restore the previous compatible Memory')?.buttons[0];
        expect(action).toMatchObject({ disabled: false, text: 'Restore compatible Memory' });

        setMockConfirmDecision(false);
        await action?.onClick?.();
        expect(plugin.rollbackMemoryGovernance).not.toHaveBeenCalled();

        setMockConfirmDecision(true);
        await action?.onClick?.();
        expect(plugin.rollbackMemoryGovernance).toHaveBeenCalledTimes(1);
    });

    it('keeps prevention-marker cleanup failure contained in the canonical Settings control', async () => {
        const { Notice } = jest.requireMock('obsidian') as { Notice: jest.Mock };
        Notice.mockClear();
        const plugin = makePlugin();
        plugin.getMemorySuppressionMarkerCount.mockReturnValue(1);
        plugin.clearMemorySuppressionMarkers.mockRejectedValue(new Error('repository unavailable'));
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();
        const action = getMockSettingRecords()
            .find((record) => record.name === 'Forgetting prevention for this vault')?.buttons[0];

        setMockConfirmDecision(true);
        await action?.onClick?.();

        expect(plugin.log).toHaveBeenCalledWith(
            'Memory prevention-marker cleanup failed',
            expect.any(Error),
        );
        expect(Notice).toHaveBeenCalledWith(
            'Forgetting prevention markers are not available right now.',
            6000,
        );
    });

    it('does not rerender Settings when prevention-marker cleanup finishes after close', async () => {
        let resolveCleanup!: (value: { ok: boolean; message: string; clearedCount: number }) => void;
        const cleanupPending = new Promise<{ ok: boolean; message: string; clearedCount: number }>((resolve) => {
            resolveCleanup = resolve;
        });
        const plugin = makePlugin();
        plugin.getMemorySuppressionMarkerCount.mockReturnValue(1);
        plugin.clearMemorySuppressionMarkers.mockReturnValue(cleanupPending);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();
        const displaySpy = jest.spyOn(tab, 'display');
        displaySpy.mockClear();
        const action = getMockSettingRecords()
            .find((record) => record.name === 'Forgetting prevention for this vault')?.buttons[0];

        setMockConfirmDecision(true);
        const run = action?.onClick?.();
        for (let index = 0; index < 3; index += 1) await Promise.resolve();
        expect(plugin.clearMemorySuppressionMarkers).toHaveBeenCalledTimes(1);
        tab.hide();
        resolveCleanup({ ok: true, message: 'Cleared.', clearedCount: 1 });
        await run;

        expect(displaySpy).not.toHaveBeenCalled();
    });

    it('does not rerender Settings when compatibility rollback finishes after close', async () => {
        let resolveRollback!: (value: { ok: boolean; message: string }) => void;
        const rollbackPending = new Promise<{ ok: boolean; message: string }>((resolve) => {
            resolveRollback = resolve;
        });
        const plugin = makePlugin();
        plugin.rollbackMemoryGovernance.mockReturnValue(rollbackPending);
        plugin.getMemoryControlCenterSnapshot.mockResolvedValue({
            generatedAt: '2026-07-10T08:00:00.000Z',
            noteMemory: { enabled: false, status: 'disabled' },
            vaultInsights: { enabled: false, status: 'disabled' },
            profile: { enabled: false, status: 'disabled', itemCount: 0 },
            durable: { activeCount: 1, pausedCount: 0, staleCount: 0 },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.compatibility',
            },
            governanceMode: 'effect_based',
            compatibilityRollback: {
                phase: 'compatibility',
                eligible: true,
                legacyRecordCount: 1,
                legacyMemoryQueueCount: 1,
            },
            items: [],
            recentChanges: [],
            degradedSources: [],
        } as never);
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;
        tab.display();
        await Promise.resolve();
        await Promise.resolve();
        const displaySpy = jest.spyOn(tab, 'display');
        displaySpy.mockClear();
        const action = getMockSettingRecords()
            .find((record) => record.name === 'Restore the previous compatible Memory')?.buttons[0];

        setMockConfirmDecision(true);
        const run = action?.onClick?.();
        for (let index = 0; index < 3; index += 1) await Promise.resolve();
        expect(plugin.rollbackMemoryGovernance).toHaveBeenCalledTimes(1);
        tab.hide();
        resolveRollback({ ok: true, message: 'Restored.' });
        await run;

        expect(displaySpy).not.toHaveBeenCalled();
    });

    it('requires explicit opt-in and supports clearing local recall preferences', async () => {
        const plugin = makePlugin({
            retrievalHabitProfile: {
                enabled: false,
                state: {
                    aggregates: [{
                        key: 'relation:related',
                        signal: 'quiet_recall_relation',
                        counts: { accept: 1 },
                        updatedAt: '2026-06-29T12:00:00.000Z',
                        windowStart: '2026-06-29',
                        windowDays: 1,
                    }],
                },
            },
        });
        const tab = new SettingTab(makeMockApp() as never, plugin as never);
        tab.containerEl = new MockContainerEl('div') as never;

        tab.display();

        const records = getMockSettingRecords();
        const improveRecall = records.find((record) => record.name === 'Improve recall locally')?.toggles[0];
        const clearProfile = records.find((record) => record.name === 'Clear local recall preferences')?.buttons[0];
        expect(improveRecall?.value).toBe(false);
        expect(clearProfile?.text).toBe('Clear');
        expect(clearProfile?.disabled).toBe(false);

        (globalThis as typeof globalThis & { __paConfirmDecision?: boolean }).__paConfirmDecision = false;
        await improveRecall?.onChange?.(true);
        expect(plugin.settings.retrievalHabitProfile.enabled).toBe(false);

        (globalThis as typeof globalThis & { __paConfirmDecision?: boolean }).__paConfirmDecision = true;
        await improveRecall?.onChange?.(true);
        expect(plugin.settings.retrievalHabitProfile.enabled).toBe(true);

        await clearProfile?.onClick?.();
        expect(plugin.settings.retrievalHabitProfile.state.aggregates).toEqual([]);
        expect(plugin.settings.retrievalHabitProfile.state.clearedAt).toEqual(expect.any(String));
        expect(plugin.saveSettings).toHaveBeenCalled();
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
        expect(settingNames).not.toContain('Featured image folder');
        expect(settingNames).not.toContain('Images per run');
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
        debouncedSaveRunner: { __record: MockDebounceRecord };
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
            const debounceRecord = (tab as unknown as Phase4Internals).debouncedSaveRunner.__record;
            const beforeDebounceCalls = debounceRecord.calls.length;

            await excludeRecord!.texts[0].onChange!('tmp/,drafts/');

            // Mutation lands synchronously…
            expect(plugin.settings.metadataExcludePath).toEqual(['tmp/', 'drafts/']);
            // …debounced save is queued, not called…
            expect(debounceRecord.calls.length).toBe(beforeDebounceCalls + 1);
            // …and saveSettings has not run yet.
            expect(plugin.saveSettings.mock.calls.length).toBe(beforeSaves);
        });

        it('hide() cancels a pending debounce and flushes the changed setting once', async () => {
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const targetPath = getMockSettingRecords().find((record) => record.name === 'Target Path')?.texts[0];
            await targetPath?.onChange?.('notes');
            const debounceRecord = (tab as unknown as Phase4Internals).debouncedSaveRunner.__record;
            const beforeCancels = debounceRecord.cancelled;
            const beforeSaves = plugin.saveSettings.mock.calls.length;

            tab.hide();

            expect(debounceRecord.cancelled).toBe(beforeCancels + 1);
            expect(plugin.saveSettings.mock.calls.length).toBe(beforeSaves + 1);
        });

        it('opening and closing Settings without an edit performs no persistent save', () => {
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            tab.hide();

            expect(plugin.saveSettings).not.toHaveBeenCalled();
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

        it('does not expose the legacy automatic-Memory toggle in effect-based mode', () => {
            const plugin = makePlugin({ confirmedMemoryCount: 30, memoryAutoAcceptPaused: false });
            plugin.getMemoryGovernanceUiMode.mockReturnValue('effect_based');
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;

            tab.display();

            expect(getMockSettingRecords().map((record) => record.name))
                .not.toContain('Remember trusted suggestions automatically');
        });

        it('rolls back the Level 2 automatic Memory toggle when persistence fails, then persists a retry', async () => {
            const plugin = makePlugin({ confirmedMemoryCount: 30, memoryAutoAcceptPaused: false });
            plugin.getMemoryGovernanceUiMode.mockReturnValue('legacy_threshold');
            plugin.setMemoryAutoAcceptPaused.mockRejectedValueOnce(new Error('disk unavailable'));
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const record = getMockSettingRecords()
                .find((candidate) => candidate.name === 'Remember trusted suggestions automatically');
            const toggle = record?.toggles[0];
            expect(toggle).toMatchObject({ value: true });

            await toggle?.onChange?.(false);

            expect(plugin.settings.memoryAutoAcceptPaused).toBe(false);
            expect(toggle?.value).toBe(true);
            expect(plugin.log).toHaveBeenCalledWith(
                'Failed to persist automatic Memory setting',
                expect.any(Error),
            );
            const { Notice } = jest.requireMock('obsidian') as { Notice: jest.Mock };
            expect(Notice).toHaveBeenCalledWith(
                'Could not change automatic Memory. The previous setting is still active.',
                5000,
            );

            let persistedPaused = false;
            plugin.setMemoryAutoAcceptPaused.mockImplementation(async (paused: boolean) => {
                plugin.settings.memoryAutoAcceptPaused = paused;
                persistedPaused = paused;
            });
            await toggle?.onChange?.(false);

            expect(plugin.settings.memoryAutoAcceptPaused).toBe(true);
            expect(persistedPaused).toBe(true);
            expect(mergeLoadedSettings({ memoryAutoAcceptPaused: persistedPaused }).memoryAutoAcceptPaused).toBe(true);
        });

        it('keeps AI Memory Extraction and Vault Insights context off until first-use confirmation', () => {
            expect(DEFAULT_SETTINGS.memoryExtractionEnabled).toBe(false);
            expect(DEFAULT_SETTINGS.memoryExtractionIncludeVaultInsights).toBe(false);
            expect(DEFAULT_SETTINGS.memoryExtractionConsent.state).toBe("unconfirmed");
            const plugin = makePlugin();
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const records = getMockSettingRecords();
            expect(records.find((r) => r.name === 'AI Memory Extraction')?.toggles[0])
                .toMatchObject({ value: false });
            expect(records.find((r) => r.name === 'Include Vault Insights in AI Context')).toBeUndefined();
        });

        it('shows AI Insights entry point without enabling Advanced memory controls', () => {
            const plugin = makePlugin({
                showAdvancedMemoryControls: false,
                memoryExtractionEnabled: true,
                memoryExtractionConsent: {
                    state: "confirmed",
                    version: 1,
                    confirmedAt: "2026-06-29T12:00:00.000Z",
                },
            });
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
            const plugin = makePlugin({
                showAdvancedMemoryControls: false,
                memoryExtractionEnabled: true,
                memoryExtractionConsent: {
                    state: "confirmed",
                    version: 1,
                    confirmedAt: "2026-06-29T12:00:00.000Z",
                },
            });
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
            expect(plugin.settings.memoryExtractionConsent).toMatchObject({
                state: "confirmed",
                version: 1,
                confirmedAt: expect.any(String),
            });
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
            const plugin = makePlugin({
                memoryExtractionEnabled: true,
                memoryExtractionIncludeVaultInsights: true,
                memoryExtractionConsent: {
                    state: "confirmed",
                    version: 1,
                    confirmedAt: "2026-06-29T12:00:00.000Z",
                },
            });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;
            tab.display();

            const toggle = getMockSettingRecords()
                .find((r) => r.name === 'AI Memory Extraction')?.toggles[0];
            await toggle!.onChange!(false);

            expect(confirmUserAction).not.toHaveBeenCalled();
            expect(plugin.settings.memoryExtractionEnabled).toBe(false);
            expect(plugin.settings.memoryExtractionIncludeVaultInsights).toBe(false);
            expect(plugin.settings.memoryExtractionConsent).toMatchObject({
                state: "paused",
                version: 1,
                confirmedAt: "2026-06-29T12:00:00.000Z",
            });
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

            expect(plugin.runManualMemoryAction).toHaveBeenCalledTimes(4);
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

    describe('4g: featured image settings', () => {
        it('uses Wan 2.7 Image and one image as new defaults', () => {
            expect(DEFAULT_SETTINGS.featuredImageModel).toBe('wan2.7-image');
            expect(DEFAULT_SETTINGS.numFeaturedImages).toBe(1);
        });

        it('normalizes featured image model settings', () => {
            expect(normalizeFeaturedImageModel(undefined)).toBe('wan2.7-image');
            expect(normalizeFeaturedImageModel('wan2.7-image')).toBe('wan2.7-image');
            expect(normalizeFeaturedImageModel('wan2.7-image-pro')).toBe('wan2.7-image-pro');
            expect(normalizeFeaturedImageModel('wanx2.1-t2i-plus')).toBe('wan2.7-image');
        });

        it.each([
            [undefined, 1],
            ['', 1],
            ['2', 2],
            ['4.9', 4],
            ['0', 1],
            ['99', 4],
            [-2, 1],
        ])('normalizes featured image count %p to %p', (input, expected) => {
            expect(normalizeFeaturedImageCount(input)).toBe(expected);
        });

        it('preserves saved image count while old data is merged with defaults', () => {
            const settings = mergeLoadedSettings({ numFeaturedImages: 3 });
            expect(settings.numFeaturedImages).toBe(3);
        });

        it.each([
            [undefined, 1],
            [0, 1],
            ['99', 4],
            ['2.8', 2],
            ['not-a-number', 1],
        ])('normalizes loaded featured image count %p to %p', (input, expected) => {
            const settings = mergeLoadedSettings({ numFeaturedImages: input });
            expect(settings.numFeaturedImages).toBe(expected);
        });

        it('fills missing featured image model when old data is merged with defaults', () => {
            const settings = mergeLoadedSettings({});
            expect(settings.featuredImageModel).toBe('wan2.7-image');
        });

        it('wires the featured image model dropdown and image count save clamp', async () => {
            const plugin = makePlugin({
                aiProvider: 'qwen',
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                featuredImageModel: 'wan2.7-image-pro',
                numFeaturedImages: 9,
            });
            const tab = new SettingTab(makeMockApp() as never, plugin as never);
            tab.containerEl = new MockContainerEl('div') as never;

            tab.display();

            const records = getMockSettingRecords();
            const modelRow = records.find((row) => row.name === 'Featured image model');
            expect(modelRow?.dropdowns[0].options).toEqual([
                { value: 'wan2.7-image', text: 'Balanced - Wan 2.7 Image' },
                { value: 'wan2.7-image-pro', text: 'Quality - Wan 2.7 Image Pro' },
            ]);
            expect(modelRow?.dropdowns[0].value).toBe('wan2.7-image-pro');

            await modelRow?.dropdowns[0].onChange?.('wanx2.1-t2i-plus');
            expect(plugin.settings.featuredImageModel).toBe('wan2.7-image');

            const countRow = records.find((row) => row.name === 'Images per run');
            expect(countRow?.texts[0].placeholder).toBe('1');
            expect(countRow?.texts[0].value).toBe('4');

            await countRow?.texts[0].onChange?.('99');
            expect(plugin.settings.numFeaturedImages).toBe(4);
        });
    });
});

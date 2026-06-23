import { describe, expect, it, jest } from '@jest/globals';
import { MarkdownRenderer, TFile } from 'obsidian';
import type { App } from 'obsidian';

const mockNoticeMessages: string[] = [];
const mockOpenedModals: Array<{ contentEl: MockModalContentRecord; onOpen?: () => void; onClose?: () => void }> = [];
const mockBundledSkillIds = [
    'obsidian-markdown',
    'obsidian-bases',
    'json-canvas',
    'pa-frontmatter-audit',
    'pa-callout-cleanup',
    'pa-vault-link-health',
    'pa-plugin-config-review',
];

type MockModalContentRecord = {
    tagName: string;
    textContent: string;
    classes: string[];
    children: MockModalContentRecord[];
};
type RegisteredPluginCommand = {
    id: string;
    checkCallback: (checking: boolean) => boolean;
};
const mockStatsManagerConstructor = jest.fn();

jest.mock('obsidian', () => {
    class MockPlugin { }
    class MockModalContentEl {
        tagName: string;
        textContent = '';
        classes: string[] = [];
        children: MockModalContentEl[] = [];

        constructor(tagName = 'div') {
            this.tagName = tagName;
        }

        empty() {
            this.children = [];
            this.textContent = '';
        }

        addClass(cls: string) {
            this.classes.push(cls);
        }

        createEl(tagName: string, options?: { text?: string; cls?: string }) {
            const child = new MockModalContentEl(tagName);
            if (options?.text) child.textContent = options.text;
            if (options?.cls) child.classes.push(options.cls);
            this.children.push(child);
            return child;
        }

        createDiv(options?: { text?: string; cls?: string }) {
            return this.createEl('div', options);
        }
    }
    class MockTFile {
        path: string;
        extension: string;
        name: string;

        constructor(path: string) {
            this.path = path;
            this.extension = 'md';
            this.name = path.split('/').pop() ?? path;
        }
    }

    return {
        Plugin: MockPlugin,
        TFile: MockTFile,
        Notice: class {
            constructor(message?: unknown) {
                mockNoticeMessages.push(String(message));
            }
        },
        Platform: { isDesktop: false, isMobile: false },
        normalizePath: (path: string) => {
            const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/g, '');
            return normalized === '' && path === '/' ? '/' : normalized;
        },
        addIcon: jest.fn(),
        setIcon: jest.fn(),
        debounce: <T extends unknown[], V>(callback: (...args: T) => V) => callback,
        Editor: class { },
        MarkdownView: class { },
        ItemView: class { },
        // Write Action Framework preview modal (imported transitively via
        // src/plugin.ts → src/pagelet → pa-review-runtime) extends these
        // Obsidian primitives at module-load time; without stubs the class
        // declaration throws "Class extends value undefined".
        Modal: class {
            contentEl = new MockModalContentEl();
            constructor(_app?: unknown) { }
            open() {
                mockOpenedModals.push(this as {
                    contentEl: MockModalContentEl;
                    onOpen?: () => void;
                    onClose?: () => void;
                });
                (this as { onOpen?: () => void }).onOpen?.();
            }
        },
        Component: class {
            load() { }
            unload() { }
        },
        Setting: class { },
        MarkdownRenderer: { render: jest.fn(), renderMarkdown: jest.fn() },
    };
});

jest.mock('obsidian-callout-manager', () => ({ getApi: jest.fn() }));
jest.mock('../src/chat/chat-view', () => ({ VIEW_TYPE_LLM: 'llm-view', LLMView: class { } }));
jest.mock('../src/ai', () => ({ AssistantFeaturedImageHelper: class { }, AssistantHelper: class { } }));
jest.mock('../src/vss', () => ({ VSS: class { } }));
jest.mock('../src/memory-manager', () => ({
    MemoryManager: class {
        startAutoMaintenance() { }
        scheduleAutoFlush() { }
        prepareFromCommand() { }
    },
}));
jest.mock('../src/modal', () => ({ PluginControlModal: class { } }));
jest.mock('../src/batch-modal', () => ({ BatchPluginControlModal: class { } }));
jest.mock('../src/settings', () => ({
    SettingTab: class { },
    DEFAULT_SETTINGS: {
        chatModelName: 'qwen3.6-plus',
        enabledSkillIds: mockBundledSkillIds,
    },
    normalizeEnabledSkillIds: (value: unknown) => {
        if (!Array.isArray(value)) return [...mockBundledSkillIds];
        return [...new Set(value.filter((entry): entry is string => (
            typeof entry === 'string' && mockBundledSkillIds.includes(entry)
        )))];
    },
}));
jest.mock('../src/local-graph', () => ({ LocalGraph: class { } }));
jest.mock('../src/utils', () => ({
    KEYCHAIN_API_TOKEN_ID: 'pa-api-token',
    getVaultApiTokenId: (vaultId?: string) => vaultId ? `pa-api-token-${vaultId}` : 'pa-api-token',
    hasSecretValue: (value: string | null) => value !== null && value !== '',
    icons: {},
}));
jest.mock('../src/plugin-manifest', () => ({ PluginsUpdater: class { } }));
jest.mock('../src/theme-manifest', () => ({ ThemeUpdater: class { } }));
jest.mock('../src/obsidian-hack/obsidian-mobile-debug', () => ({ monkeyPatchConsole: jest.fn() }));
jest.mock('../src/callout', () => ({ CalloutModal: class { } }));
jest.mock('../src/preview', () => ({ RECORD_PREVIEW_TYPE: 'record-preview', RecordPreview: class { } }));
jest.mock('../src/stats-view', () => ({ STAT_PREVIEW_TYPE: 'stat-preview', Stat: class { } }));
jest.mock('../src/stats/stats-manager', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation((...args: unknown[]) => {
        mockStatsManagerConstructor(...args);
        return {};
    }),
}));
jest.mock('../src/stats/editor-plugin', () => ({
    pluginField: { init: jest.fn(() => ({})) },
    statusBarEditorPlugin: {},
    sectionWordCountEditorPlugin: {},
}));
jest.mock('../src/stats/stats-store', () => ({ normalizeStatisticsView: (view: string) => view }));

import { PluginManager } from '../src/plugin';
import { PageletDetailView } from '../src/pagelet/tab';

const createTFile = (path: string): TFile => {
    const FileCtor = TFile as unknown as { new(path: string): TFile };
    return new FileCtor(path);
};

const collectModalTexts = (node: MockModalContentRecord): string[] => [
    node.textContent,
    ...node.children.flatMap(collectModalTexts),
].filter(Boolean);

const VAULT_INSIGHTS_NOTICE_KEY = 'pa-vault-insights-injection-notice';

function installMockWindowLocalStorage(initial: Record<string, string> = {}) {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousActiveWindow = Object.getOwnPropertyDescriptor(globalThis, 'activeWindow');
    const store = new Map(Object.entries(initial));
    const storage = {
        getItem: jest.fn((key: string) => store.get(key) ?? null),
        setItem: jest.fn((key: string, value: string) => {
            store.set(key, String(value));
        }),
        removeItem: jest.fn((key: string) => {
            store.delete(key);
        }),
        clear: jest.fn(() => {
            store.clear();
        }),
        key: jest.fn((index: number) => [...store.keys()][index] ?? null),
        get length() {
            return store.size;
        },
    };
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage: storage },
    });
    Object.defineProperty(globalThis, 'activeWindow', {
        configurable: true,
        value: { localStorage: storage },
    });
    return {
        storage,
        restore: () => {
            if (previousWindow) {
                Object.defineProperty(globalThis, 'window', previousWindow);
            } else {
                delete (globalThis as { window?: Window }).window;
            }
            if (previousActiveWindow) {
                Object.defineProperty(globalThis, 'activeWindow', previousActiveWindow);
            } else {
                delete (globalThis as { activeWindow?: Window }).activeWindow;
            }
        },
    };
}

function getRegisteredCommand(
    plugin: { addCommand: jest.Mock },
    id: string,
): RegisteredPluginCommand | undefined {
    const calls = plugin.addCommand.mock.calls as Array<[RegisteredPluginCommand]>;
    return calls.map(([command]) => command)
        .find((entry: RegisteredPluginCommand) => entry.id === id);
}

const createMigrationApp = (configDir?: string) => ({
    ...(configDir ? { vault: { configDir } } : {}),
    secretStorage: {
        getSecret: jest.fn(() => null),
        setSecret: jest.fn(),
    },
});

const memorySettings = {
    memoryEnabled: true,
    memoryAutoCheckBeforeChat: true,
    memoryApprovalPolicy: 'always',
    showAdvancedMemoryControls: false,
    qwenThinkingEnabled: false,
    webSearchEnabled: false,
    policyModelName: '',
    shareAnonymousCapabilityUsage: false,
    skillContextEnabled: true,
    enabledSkillIds: mockBundledSkillIds,
    statisticsVaultId: 'vault-id',
};

const createPluginHarness = ({
    existingFile,
    existingFolders = new Set<string>(),
}: {
    existingFile?: TFile;
    existingFolders?: Set<string>;
} = {}) => {
    const openFile = jest.fn<(file: TFile) => Promise<void>>(async () => undefined);
    const createdFiles: TFile[] = [];
    const vault = {
        adapter: {
            exists: jest.fn<(path: string) => Promise<boolean>>(async (path) => existingFolders.has(path)),
        },
        getRoot: jest.fn(() => ({ path: '/' })),
        getAbstractFileByPath: jest.fn((path: string) => existingFile?.path === path ? existingFile : null),
        getMarkdownFiles: jest.fn(() => existingFile ? [existingFile] : []),
        createFolder: jest.fn<(path: string) => Promise<void>>(async () => undefined),
        create: jest.fn<(path: string, data: string) => Promise<TFile>>(async (path) => {
            const file = createTFile(path);
            createdFiles.push(file);
            return file;
        }),
    };
    const workspace = {
        getLeaf: jest.fn(() => ({ openFile })),
    };
    const secretStorage = {
        getSecret: jest.fn(() => null),
        setSecret: jest.fn(),
    };
    const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    plugin.app = { vault, workspace, secretStorage };
    plugin.log = jest.fn();

    return { plugin, vault, openFile, createdFiles, secretStorage };
};

describe('record note creation', () => {
    it('creates root-level record notes without trying to create the vault root folder', async () => {
        const { plugin, vault, openFile, createdFiles } = createPluginHarness();

        await plugin.createNewNote('.', '2026-05-01');

        expect(vault.createFolder).not.toHaveBeenCalled();
        expect(vault.create).toHaveBeenCalledWith('2026-05-01.md', '');
        expect(openFile).toHaveBeenCalledWith(createdFiles[0]);
    });

    it('does not recreate an existing target folder when metadata lookup misses it', async () => {
        const { plugin, vault } = createPluginHarness({
            existingFolders: new Set(['9.src']),
        });

        await plugin.createNewNote('9.src', '2026-05-01');

        expect(vault.adapter.exists).toHaveBeenCalledWith('9.src');
        expect(vault.createFolder).not.toHaveBeenCalled();
        expect(vault.create).toHaveBeenCalledWith('9.src/2026-05-01.md', '');
    });

    it('opens an existing record note instead of creating it again', async () => {
        const existingFile = createTFile('2026-05-01.md');
        const { plugin, vault, openFile } = createPluginHarness({ existingFile });

        await plugin.createNewNote('.', '2026-05-01');

        expect(vault.create).not.toHaveBeenCalled();
        expect(openFile).toHaveBeenCalledWith(existingFile);
    });
});

describe('plugin startup view registration', () => {
    it('registers custom views during onload before layout-ready work runs', async () => {
        const originalDocument = globalThis.document;
        const originalMutationObserver = globalThis.MutationObserver;
        const startupOrder: string[] = [];
        const layoutCallbacks: Array<() => void> = [];
        const registerView = jest.fn();
        const onLayoutReady = jest.fn((callback: () => void) => {
            layoutCallbacks.push(callback);
        });
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        globalThis.document = {
            body: {},
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn(() => null),
        } as unknown as Document;
        globalThis.MutationObserver = class {
            observe() { }
            disconnect() { }
        } as unknown as typeof MutationObserver;

        plugin.app = {
            vault: {
                configDir: '.obsidian',
                on: jest.fn(() => ({})),
            },
            workspace: {
                on: jest.fn(() => ({})),
                onLayoutReady,
            },
        };
        plugin.settings = { debug: false, showAdvancedMemoryControls: false };
        plugin.loadSettings = jest.fn(async () => undefined);
        plugin.migrateSettings = jest.fn(async () => {
            startupOrder.push('migrate-start');
            await Promise.resolve();
            startupOrder.push('migrate-saved');
        });
        plugin.initVss = jest.fn(() => {
            startupOrder.push('init-vss');
            return {};
        });
        plugin.registerView = registerView;
        plugin.updateMemoryStatusBar = jest.fn(async () => undefined);
        plugin.initializeCalloutManager = jest.fn(async () => undefined);
        plugin.addRibbonIcon = jest.fn(() => ({ addClass: jest.fn(), addEventListener: jest.fn() }));
        plugin.addCommand = jest.fn();
        plugin.registerEvent = jest.fn();
        plugin.registerEditorExtension = jest.fn();
        plugin.addSettingTab = jest.fn();
        plugin.log = jest.fn();
        mockStatsManagerConstructor.mockClear();

        try {
            await plugin.onload();

            expect(startupOrder).toEqual(['migrate-start', 'migrate-saved', 'init-vss']);
            expect(plugin.vss).toBeDefined();
            expect(plugin.memoryManager).toBeDefined();
            expect(plugin.statsManager).toBeDefined();
            expect(plugin.initVss.mock.invocationCallOrder[0]).toBeLessThan(
                registerView.mock.invocationCallOrder[0],
            );
            expect(plugin.initVss.mock.invocationCallOrder[0]).toBeLessThan(
                plugin.registerEvent.mock.invocationCallOrder[0],
            );
            expect(mockStatsManagerConstructor.mock.invocationCallOrder[0]).toBeLessThan(
                plugin.registerEditorExtension.mock.invocationCallOrder[0],
            );
            expect(registerView).toHaveBeenCalledWith('record-preview', expect.any(Function));
            expect(registerView).toHaveBeenCalledWith('stat-preview', expect.any(Function));
            expect(registerView).toHaveBeenCalledWith('llm-view', expect.any(Function));
            expect(registerView).toHaveBeenCalledWith('pa-pagelet-detail-view', expect.any(Function));
            expect(registerView).toHaveBeenCalledTimes(4);
            expect(registerView.mock.invocationCallOrder[0]).toBeLessThan(
                onLayoutReady.mock.invocationCallOrder[0],
            );

            layoutCallbacks.forEach((callback) => callback());
            await Promise.resolve();
            await Promise.resolve();

            expect(startupOrder).toEqual(['migrate-start', 'migrate-saved', 'init-vss']);
            expect(plugin.initializeCalloutManager).toHaveBeenCalledTimes(1);
            expect(registerView).toHaveBeenCalledTimes(4);
        } finally {
            globalThis.document = originalDocument;
            globalThis.MutationObserver = originalMutationObserver;
        }
    });
});

describe('AI Insights command and viewer', () => {
    it('registers show-ai-insights without requiring Advanced memory controls', () => {
        mockOpenedModals.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {};
        plugin.settings = {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            showAdvancedMemoryControls: false,
        };
        plugin.getAISetupIssue = jest.fn(() => null);
        plugin.addCommand = jest.fn();
        plugin.log = jest.fn();

        plugin.registerAdvancedMemoryCommands();
        const command = getRegisteredCommand(plugin, 'show-ai-insights');

        expect(command?.checkCallback(true)).toBe(true);
        expect(command?.checkCallback(false)).toBe(true);
        expect(mockOpenedModals).toHaveLength(1);
    });

    it('hides show-ai-insights when AI setup is incomplete', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            showAdvancedMemoryControls: false,
        };
        plugin.getAISetupIssue = jest.fn(() => 'Choose your AI provider');
        plugin.addCommand = jest.fn();

        plugin.registerAdvancedMemoryCommands();
        const command = getRegisteredCommand(plugin, 'show-ai-insights');

        expect(command?.checkCallback(true)).toBe(false);
    });

    it.each([
        { memoryEnabled: false, memoryExtractionEnabled: true },
        { memoryEnabled: true, memoryExtractionEnabled: false },
    ])('hides show-ai-insights when memory gates are disabled: %j', (settings) => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            ...settings,
            showAdvancedMemoryControls: false,
        };
        plugin.getAISetupIssue = jest.fn(() => null);
        plugin.addCommand = jest.fn();

        plugin.registerAdvancedMemoryCommands();
        const command = getRegisteredCommand(plugin, 'show-ai-insights');

        expect(command?.checkCallback(true)).toBe(false);
    });

    it('renders an empty state when AI insights have not been generated', () => {
        mockOpenedModals.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {};
        plugin.memoryExtractionScheduler = null;

        plugin.showAiInsights();

        const texts = collectModalTexts(mockOpenedModals[0].contentEl);
        expect(texts).toContain('AI Insights');
        expect(texts).toEqual(expect.arrayContaining([
            expect.stringContaining('No insights available yet'),
        ]));
    });

    it('renders user profile and vault insights markdown when present', () => {
        mockOpenedModals.length = 0;
        const renderMock = MarkdownRenderer.render as unknown as jest.Mock;
        renderMock.mockClear();
        const app = {} as App;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = app;
        plugin.getMemoryExtractionPromptContext = jest.fn(() => ({
            userProfile: '# Prompt Profile',
            vaultInsights: '# Prompt Summary',
        }));
        plugin.memoryExtractionScheduler = {
            getInsightsViewerContext: jest.fn(() => ({
                userProfile: '# User Profile\n- Prefers concise plans',
                vaultInsights: '# Vault Insights\n- Release docs are active',
            })),
        };

        plugin.showAiInsights();

        expect(renderMock).toHaveBeenCalledWith(
            app,
            '# User Profile\n- Prefers concise plans',
            expect.anything(),
            '',
            expect.anything(),
        );
        expect(renderMock).toHaveBeenCalledWith(
            app,
            '# Vault Insights\n- Release docs are active',
            expect.anything(),
            '',
            expect.anything(),
        );
        expect(renderMock).not.toHaveBeenCalledWith(
            app,
            '# Prompt Summary',
            expect.anything(),
            '',
            expect.anything(),
        );
    });
});

describe('Vault Insights onboarding notice', () => {
    it('fires once on first trigger and stores the localStorage flag', () => {
        mockNoticeMessages.length = 0;
        const { storage, restore } = installMockWindowLocalStorage();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { memoryExtractionIncludeVaultInsights: true };
        plugin.log = jest.fn();

        try {
            plugin.surfaceVaultInsightsInjectionNotice();

            expect(mockNoticeMessages).toHaveLength(1);
            expect(mockNoticeMessages[0]).toContain('vault structure overview');
            expect(storage.setItem).toHaveBeenCalledWith(VAULT_INSIGHTS_NOTICE_KEY, '1');
        } finally {
            restore();
        }
    });

    it('does not repeat the onboarding notice during the same boot', () => {
        mockNoticeMessages.length = 0;
        const { storage, restore } = installMockWindowLocalStorage();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { memoryExtractionIncludeVaultInsights: true };
        plugin.log = jest.fn();

        try {
            plugin.surfaceVaultInsightsInjectionNotice();
            plugin.surfaceVaultInsightsInjectionNotice();

            expect(mockNoticeMessages).toHaveLength(1);
            expect(storage.setItem).toHaveBeenCalledTimes(1);
        } finally {
            restore();
        }
    });

    it('does not fire when the localStorage flag already exists', () => {
        mockNoticeMessages.length = 0;
        const { storage, restore } = installMockWindowLocalStorage({
            [VAULT_INSIGHTS_NOTICE_KEY]: '1',
        });
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { memoryExtractionIncludeVaultInsights: true };
        plugin.log = jest.fn();

        try {
            plugin.surfaceVaultInsightsInjectionNotice();

            expect(mockNoticeMessages).toEqual([]);
            expect(storage.setItem).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    it('fires through memory extraction runtime startup when Vault Insights context is enabled', () => {
        mockNoticeMessages.length = 0;
        const { storage, restore } = installMockWindowLocalStorage();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            vault: {
                getMarkdownFiles: jest.fn(() => []),
            },
            metadataCache: {
                getFileCache: jest.fn(),
                resolvedLinks: {},
                unresolvedLinks: {},
            },
        };
        plugin.settings = {
            memoryExtractionEnabled: true,
            memoryExtractionIncludeVaultInsights: true,
            memoryExtractionNoticeDismissed: true,
        };
        plugin.chatHistoryManager = {
            findConversation: jest.fn(),
            getTurns: jest.fn(),
        };
        plugin.createUserProfileStore = jest.fn(() => ({
            initialize: jest.fn(async () => undefined),
            getProfile: jest.fn(async () => null),
            setProfile: jest.fn(async () => undefined),
            dispose: jest.fn(async () => undefined),
        }));
        plugin.log = jest.fn();

        try {
            plugin.syncMemoryExtractionRuntime();

            expect(mockNoticeMessages).toHaveLength(1);
            expect(mockNoticeMessages[0]).toContain('vault structure overview');
            expect(storage.setItem).toHaveBeenCalledWith(VAULT_INSIGHTS_NOTICE_KEY, '1');
        } finally {
            plugin.memoryExtractionScheduler?.dispose();
            restore();
        }
    });
});

describe('Pagelet detail workspace leaf', () => {
    it('loads a deferred detail leaf before sending the payload', async () => {
        const detailView = Object.create(PageletDetailView.prototype) as PageletDetailView;
        detailView.setPayload = jest.fn();
        const loadIfDeferred = jest.fn(async () => undefined);
        const setViewState = jest.fn<(_state: unknown) => Promise<void>>(async () => undefined);
        const revealLeaf = jest.fn<(_leaf: unknown) => Promise<void>>(async () => undefined);
        const leaf = {
            view: detailView,
            loadIfDeferred,
            setViewState,
        };
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            workspace: {
                getLeavesOfType: jest.fn(() => [leaf]),
                getLeaf: jest.fn(),
                revealLeaf,
            },
        };

        const payload = {
            title: 'Pagelet — Detail View',
            content: [],
            locale: 'en' as const,
        };
        await plugin.openPageletDetailView(payload);

        expect(loadIfDeferred).toHaveBeenCalledTimes(1);
        expect(setViewState).not.toHaveBeenCalled();
        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(detailView.setPayload).toHaveBeenCalledWith(payload);
    });

    it('rejects instead of silently showing an empty detail leaf when the view cannot initialize', async () => {
        const leaf = {
            view: {},
            loadIfDeferred: jest.fn(async () => undefined),
            setViewState: jest.fn<(_state: unknown) => Promise<void>>(async () => undefined),
        };
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            workspace: {
                getLeavesOfType: jest.fn(() => [leaf]),
                getLeaf: jest.fn(),
                revealLeaf: jest.fn(async () => undefined),
            },
        };

        await expect(plugin.openPageletDetailView({
            title: 'Pagelet — Detail View',
            content: [],
            locale: 'en',
        })).rejects.toThrow('Failed to initialize Pagelet detail view');

        expect(leaf.setViewState).toHaveBeenCalledWith({
            type: 'pa-pagelet-detail-view',
            active: true,
        });
    });
});

describe('manual Memory action guard', () => {
    it('prevents a second manual Memory action while the first one is still running', async () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.t = jest.fn((key: string) => (
            key === 'plugin.memory.notice.actionAlreadyRunning'
                ? 'A Memory action is already running.'
                : key
        ));

        let releaseFirstAction!: () => void;
        const firstActionDone = new Promise<void>((resolve) => {
            releaseFirstAction = resolve;
        });
        const firstAction = jest.fn(async () => {
            await firstActionDone;
        });
        const secondAction = jest.fn(async () => undefined);

        const firstRun = plugin.runManualMemoryAction(firstAction);
        expect(firstAction).toHaveBeenCalledTimes(1);

        await plugin.runManualMemoryAction(secondAction);

        expect(secondAction).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual(['A Memory action is already running.']);

        releaseFirstAction();
        await firstRun;
        await plugin.runManualMemoryAction(secondAction);

        expect(secondAction).toHaveBeenCalledTimes(1);
    });

    it('releases the guard when the action rejects', async () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.t = jest.fn((key: string) => (
            key === 'plugin.memory.notice.actionAlreadyRunning'
                ? 'A Memory action is already running.'
                : key
        ));

        const failingAction = jest.fn(async () => {
            throw new Error('boom');
        });
        await expect(plugin.runManualMemoryAction(failingAction)).rejects.toThrow('boom');

        const followUp = jest.fn(async () => undefined);
        await plugin.runManualMemoryAction(followUp);

        expect(followUp).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages).toEqual([]);
    });

    it('shares the manual Memory guard with Chat memory actions', async () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {};
        plugin.settings = {};
        plugin.chatHistoryManager = {};
        plugin.log = jest.fn();
        plugin.t = jest.fn((key: string) => (
            key === 'plugin.memory.notice.actionAlreadyRunning'
                ? 'A Memory action is already running.'
                : key
        ));
        plugin.getAISetupIssue = jest.fn(() => null);
        plugin.showTechnicalMemoryStatus = jest.fn(async () => undefined);
        plugin.onMemoryStatusChanged = jest.fn(() => jest.fn());
        plugin.onSettingsChanged = jest.fn(() => jest.fn());
        plugin.scheduleMemoryExtractionAfterChatTurn = jest.fn();
        plugin.createAiServiceHost = jest.fn(() => ({}));

        let releaseChatAction!: () => void;
        const chatActionDone = new Promise<void>((resolve) => {
            releaseChatAction = resolve;
        });
        plugin.memoryManager = {
            getMaintenancePlan: jest.fn(async () => ({
                reason: 'ready',
                action: 'none',
                notesToCheck: 0,
                requiresApproval: false,
                canAnswerNow: true,
            })),
            updateFromCommand: jest.fn(async () => {
                await chatActionDone;
            }),
            prepareFromCommand: jest.fn(async () => undefined),
        };

        const host = plugin.createChatHost();
        const chatRun = host.memoryStatus.updateFromCommand();
        expect(plugin.memoryManager.updateFromCommand).toHaveBeenCalledTimes(1);

        const settingsAction = jest.fn(async () => undefined);
        await plugin.runManualMemoryAction(settingsAction);

        expect(settingsAction).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual(['A Memory action is already running.']);

        releaseChatAction();
        await chatRun;
    });
});

describe('API token secret compatibility', () => {
    it('reads a legacy keychain token without mutating secret storage', () => {
        const secrets = new Map<string, string>([
            ['pa-api-token', 'sk-legacy-token'],
        ]);
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { statisticsVaultId: 'vault-id' };
        plugin.app = {
            secretStorage: {
                getSecret: jest.fn((id: string) => secrets.get(id) ?? null),
                setSecret: jest.fn((id: string, value: string) => {
                    secrets.set(id, value);
                }),
            },
        };
        plugin.log = jest.fn();

        expect(plugin.getConfiguredAPITokenSecret()).toBe('sk-legacy-token');

        expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
        expect(secrets.has('pa-api-token-vault-id')).toBe(false);
        expect(plugin.log).not.toHaveBeenCalled();
    });

    it('falls back to the default-vault scoped token when the current scoped id is empty', () => {
        const secrets = new Map<string, string>([
            ['pa-api-token-default-vault', 'sk-default-vault-token'],
        ]);
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { statisticsVaultId: 'vault-id' };
        plugin.app = {
            secretStorage: {
                getSecret: jest.fn((id: string) => secrets.get(id) ?? null),
                setSecret: jest.fn(),
            },
        };
        plugin.log = jest.fn();

        expect(plugin.getConfiguredAPITokenSecret()).toBe('sk-default-vault-token');

        expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
    });

    it('returns null when all candidate secret ids are empty', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { statisticsVaultId: 'vault-id' };
        plugin.app = {
            secretStorage: {
                getSecret: jest.fn(() => null),
                setSecret: jest.fn(),
            },
        };
        plugin.log = jest.fn();

        expect(plugin.getConfiguredAPITokenSecret()).toBeNull();
        expect(plugin.app.secretStorage.setSecret).not.toHaveBeenCalled();
    });

    it('writes only the current scoped id when setting a non-empty token', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { statisticsVaultId: 'vault-id' };
        plugin.token = 'cached';
        plugin.app = {
            secretStorage: {
                getSecret: jest.fn(() => null),
                setSecret: jest.fn(),
            },
        };

        plugin.setAPITokenSecret('sk-new-token');

        expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledTimes(1);
        expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledWith('pa-api-token-vault-id', 'sk-new-token');
        expect(plugin.token).toBe('');
    });

    it('clears current and legacy API token secret ids together', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { statisticsVaultId: 'vault-id' };
        plugin.app = {
            secretStorage: {
                getSecret: jest.fn(() => null),
                setSecret: jest.fn(),
            },
        };

        plugin.setAPITokenSecret('');

        expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledWith('pa-api-token-vault-id', '');
        expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledWith('pa-api-token-default-vault', '');
        expect(plugin.app.secretStorage.setSecret).toHaveBeenCalledWith('pa-api-token', '');
    });
});

describe('settings migration', () => {
    it('preserves the old default Qwen v3 embedding model and only shows a migration notice', async () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp();
        plugin.settings = {
            aiProvider: 'qwen',
            embeddingModelName: 'text-embedding-v3',
            embeddingV4MigrationNoticeDismissed: false,
            statisticsType: 'overview',
            ...memorySettings,
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.embeddingModelName).toBe('text-embedding-v3');
        expect(plugin.settings.embeddingV4MigrationNoticeDismissed).toBe(true);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages).toEqual([
            expect.stringContaining('newer memory model is recommended'),
        ]);
        expect(plugin.vss).toBeUndefined();
    });

    it('does not bother custom embedding models during migration', async () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp();
        plugin.settings = {
            aiProvider: 'qwen',
            embeddingModelName: 'custom-embedding-model',
            embeddingV4MigrationNoticeDismissed: false,
            statisticsType: 'overview',
            ...memorySettings,
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.embeddingModelName).toBe('custom-embedding-model');
        expect(plugin.settings.embeddingV4MigrationNoticeDismissed).toBe(false);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
    });

    it('enables memory defaults for older settings without changing AI model settings', async () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp();
        plugin.settings = {
            aiProvider: 'openai',
            embeddingModelName: 'custom-embedding-model',
            embeddingV4MigrationNoticeDismissed: true,
            statisticsType: 'overview',
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.memoryEnabled).toBe(true);
        expect(plugin.settings.memoryAutoCheckBeforeChat).toBe(true);
        expect(plugin.settings.memoryApprovalPolicy).toBe('always');
        expect(plugin.settings.showAdvancedMemoryControls).toBe(false);
        expect(plugin.settings.qwenThinkingEnabled).toBe(false);
        expect(plugin.settings.webSearchEnabled).toBe(false);
        expect(plugin.settings.policyModelName).toBe('');
        expect(plugin.settings.shareAnonymousCapabilityUsage).toBe(false);
        expect(plugin.settings.skillContextEnabled).toBe(true);
        expect(plugin.settings.enabledSkillIds).toEqual(mockBundledSkillIds);
        expect(plugin.settings.statisticsVaultId).toEqual(expect.any(String));
        expect(plugin.settings.statisticsVaultId.length).toBeGreaterThan(0);
        expect(plugin.settings.embeddingModelName).toBe('custom-embedding-model');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages).toEqual([]);
    });

    it('deletes the legacy provider web search setting without enabling builtin WebSearch', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp();
        plugin.settings = {
            aiProvider: 'qwen',
            embeddingModelName: 'custom-embedding-model',
            embeddingV4MigrationNoticeDismissed: true,
            statisticsType: 'overview',
            qwenWebSearchEnabled: true,
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.webSearchEnabled).toBe(false);
        expect(plugin.settings).not.toHaveProperty('qwenWebSearchEnabled');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('migrates removed ollama provider to qwen default on v2.0.0 upgrade', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp();
        plugin.settings = {
            aiProvider: 'ollama',
            baseURL: 'http://localhost:11434',
            chatModelName: 'llama3.1',
            embeddingModelName: 'mxbai-embed-large',
            embeddingV4MigrationNoticeDismissed: true,
            statisticsType: 'overview',
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.aiProvider).toBe('qwen');
        expect(plugin.settings.baseURL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
        expect(plugin.settings.chatModelName).toBe('qwen3.6-plus');
        expect(plugin.settings.embeddingModelName).toBe('text-embedding-v4');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('migrates legacy modelName into chatModelName and removes the stale field', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp();
        plugin.settings = {
            aiProvider: 'qwen',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            chatModelName: 'qwen3.6-plus',
            modelName: 'qwen-turbo',
            embeddingModelName: 'text-embedding-v4',
            embeddingV4MigrationNoticeDismissed: true,
            statisticsType: 'overview',
            statsPath: '.obsidian/stats.json',
            memoryEnabled: true,
            memoryAutoCheckBeforeChat: true,
            memoryApprovalPolicy: 'always',
            showAdvancedMemoryControls: false,
            qwenThinkingEnabled: false,
            webSearchEnabled: false,
            policyModelName: '',
            shareAnonymousCapabilityUsage: false,
            skillContextEnabled: true,
            enabledSkillIds: mockBundledSkillIds,
            statisticsVaultId: 'vault-id',
            vssCacheExcludePath: [],
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.chatModelName).toBe('qwen-turbo');
        expect(plugin.settings).not.toHaveProperty('modelName');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('preserves the background memory approval policy during migration', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp();
        plugin.settings = {
            aiProvider: 'openai',
            embeddingModelName: 'custom-embedding-model',
            embeddingV4MigrationNoticeDismissed: true,
            statisticsType: 'overview',
            memoryEnabled: true,
            memoryAutoCheckBeforeChat: true,
            memoryApprovalPolicy: 'auto-refresh-after-prepare',
            showAdvancedMemoryControls: false,
            qwenThinkingEnabled: false,
            webSearchEnabled: false,
            policyModelName: '',
            shareAnonymousCapabilityUsage: false,
            skillContextEnabled: true,
            enabledSkillIds: mockBundledSkillIds,
            statisticsVaultId: 'vault-id',
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.memoryApprovalPolicy).toBe('auto-refresh-after-prepare');
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('preserves an intentionally empty memory exclude path during migration', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp('.vault-config');
        plugin.settings = {
            aiProvider: 'openai',
            embeddingModelName: 'custom-embedding-model',
            embeddingV4MigrationNoticeDismissed: true,
            statisticsType: 'overview',
            memoryEnabled: true,
            memoryAutoCheckBeforeChat: true,
            memoryApprovalPolicy: 'always',
            showAdvancedMemoryControls: false,
            qwenThinkingEnabled: false,
            webSearchEnabled: false,
            policyModelName: '',
            shareAnonymousCapabilityUsage: false,
            skillContextEnabled: true,
            enabledSkillIds: mockBundledSkillIds,
            statisticsVaultId: 'vault-id',
            statsPath: '.vault-config/stats.json',
            vssCacheExcludePath: [],
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.vssCacheExcludePath).toEqual([]);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });
});

describe('VSS status performance notices', () => {
    it('warns at the exact-search thresholds without enabling another backend automatically', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        expect(plugin.getVssPerformanceNotice(50_000)).toBe('');
        expect(plugin.getVssPerformanceNotice(50_001)).toContain('above 50k chunks');
        expect(plugin.getVssPerformanceNotice(100_001)).toContain('not enabled automatically');
    });

    it('formats technical memory status as structured diagnostic details', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const model = plugin.buildTechnicalMemoryStatusModel({
            status: 'ready',
            backend: 'sqlite-wasm-opfs-sahpool',
            chunkCount: 6,
            fileCount: 5,
            storagePersisted: true,
            fallbackMode: false,
        }, {
            dirtyCount: 0,
            verificationPending: 0,
        });

        expect(model).toEqual({
            title: 'Memory diagnostics',
            summary: 'Ready',
            summaryTone: undefined,
            details: [
                { label: 'Indexed', value: '6 chunks across 5 files' },
                { label: 'Backend', value: 'sqlite-wasm-opfs-sahpool' },
                { label: 'Storage', value: 'Persistent storage', tone: undefined },
                { label: 'Maintenance', value: 'Up to date', tone: undefined },
            ],
            notes: [],
        });
    });

    it('keeps pending maintenance and performance notes readable', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const model = plugin.buildTechnicalMemoryStatusModel({
            status: 'stale',
            backend: 'sqlite-wasm-opfs-sahpool',
            chunkCount: 50_001,
            fileCount: 500,
            storagePersisted: false,
            fallbackMode: false,
            lastErrorCode: 'opfs-sahpool-locked',
            opfsDirectory: '/personal-assistant-vss-v2/test-e50kp6',
            opfsVfsName: 'opfs-sahpool-test-e50kp6',
        }, {
            dirtyCount: 2,
            verificationPending: 1,
        });

        expect(model.summary).toBe('Index stale');
        expect(model.summaryTone).toBe('warning');
        expect(model.details).toEqual(expect.arrayContaining([
            { label: 'Storage', value: 'Best-effort storage', tone: 'warning' },
            { label: 'Maintenance', value: '2 dirty, 1 verification pending', tone: 'warning' },
            { label: 'Last error', value: 'opfs-sahpool-locked', tone: 'danger' },
            { label: 'OPFS scope', value: '/personal-assistant-vss-v2/test-e50kp6', tone: 'warning' },
            { label: 'OPFS VFS', value: 'opfs-sahpool-test-e50kp6', tone: 'warning' },
        ]));
        expect(model.notes).toHaveLength(1);
        expect(model.notes[0]).toContain('above 50k chunks');
    });
});

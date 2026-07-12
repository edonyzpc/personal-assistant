import { afterEach, describe, expect, it, jest } from '@jest/globals';
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
    dispatchEvent?: (type: string) => void;
};
type RegisteredPluginCommand = {
    id: string;
    checkCallback: (checking: boolean) => boolean;
};
const mockStatsManagerConstructor = jest.fn();
const mockStatsRecalcTotals = jest.fn(async () => undefined);

jest.mock('obsidian', () => {
    class MockPlugin { }
    class MockModalContentEl {
        tagName: string;
        textContent = '';
        classes: string[] = [];
        children: MockModalContentEl[] = [];
        private listeners = new Map<string, Array<() => void>>();

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

        addEventListener(type: string, listener: () => void) {
            const listeners = this.listeners.get(type) ?? [];
            listeners.push(listener);
            this.listeners.set(type, listeners);
        }

        dispatchEvent(type: string) {
            for (const listener of this.listeners.get(type) ?? []) listener();
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
            close() {
                (this as { onClose?: () => void }).onClose?.();
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
jest.mock('../src/confirm', () => ({
    confirmUserAction: jest.fn(async () => (
        (globalThis as typeof globalThis & { __paConfirmDecision?: boolean })
            .__paConfirmDecision ?? false
    )),
}));
jest.mock('../src/chat/chat-view', () => ({ VIEW_TYPE_LLM: 'llm-view', LLMView: class { } }));
jest.mock('../src/ai', () => ({ AssistantFeaturedImageHelper: class { }, AssistantHelper: class { } }));
jest.mock('../src/vss', () => ({ VSS: class { } }));
jest.mock('../src/memory-manager', () => ({
    MemoryManager: class {
        startAutoMaintenance() { }
        scheduleAutoFlush() { }
        scheduleVerify() { }
        prepareFromCommand() { }
    },
}));
jest.mock('../src/modal', () => ({ PluginControlModal: class { } }));
jest.mock('../src/batch-modal', () => ({ BatchPluginControlModal: class { } }));
jest.mock('../src/settings', () => ({
    SettingTab: class { },
    DEFAULT_SETTINGS: {
        chatModelName: 'qwen3.6-plus',
        featuredImageModel: 'wan2.7-image',
        enabledSkillIds: mockBundledSkillIds,
    },
    normalizeEnabledSkillIds: (value: unknown) => {
        if (!Array.isArray(value)) return [...mockBundledSkillIds];
        return [...new Set(value.filter((entry): entry is string => (
            typeof entry === 'string' && mockBundledSkillIds.includes(entry)
        )))];
    },
    normalizeFeaturedImageModel: (value: unknown) => (
        value === 'wan2.7-image' || value === 'wan2.7-image-pro' ? value : 'wan2.7-image'
    ),
    normalizeFeaturedImageCount: (value: unknown) => {
        const numericValue = typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
                ? Number(value)
                : Number.NaN;
        if (!Number.isFinite(numericValue)) return 1;
        return Math.min(Math.max(Math.floor(numericValue), 1), 4);
    },
    normalizeConfirmedMemoryCount: (value: unknown) => (
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
    ),
    mergeLoadedSettings: (value: unknown) => JSON.parse(JSON.stringify(value ?? {})),
    isFreshInstall: (value: unknown) => value === undefined || value === null,
    isLegacyV1Install: () => false,
    MEMORY_EXTRACTION_CONSENT_VERSION: 1,
    isMemoryExtractionConsentConfirmed: (consent: unknown) => (
        typeof consent === 'object'
        && consent !== null
        && (consent as { state?: unknown }).state === 'confirmed'
        && (consent as { version?: unknown }).version === 1
    ),
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
jest.mock('../src/callout', () => ({ CalloutModal: class { } }));
jest.mock('../src/preview', () => ({ RECORD_PREVIEW_TYPE: 'record-preview', RecordPreview: class { } }));
jest.mock('../src/stats-view', () => ({ STAT_PREVIEW_TYPE: 'stat-preview', Stat: class { } }));
jest.mock('../src/stats/stats-manager', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation((...args: unknown[]) => {
        mockStatsManagerConstructor(...args);
        return { recalcTotals: mockStatsRecalcTotals };
    }),
}));
jest.mock('../src/stats/editor-plugin', () => ({
    pluginField: { init: jest.fn(() => ({})) },
    statusBarEditorPlugin: {},
    sectionWordCountEditorPlugin: {},
}));
jest.mock('../src/stats/stats-store', () => ({ normalizeStatisticsView: (view: string) => view }));

import {
    PluginManager,
    buildMemoryDataBoundaryFingerprint,
    createMemoryGovernanceOpaqueVaultKey,
} from '../src/plugin';
import { confirmUserAction } from '../src/confirm';
import { PageletDetailView } from '../src/pagelet/tab';
import type {
    ConfirmedMemoryRecord,
    QuietRecallCandidate,
    ReviewQueueCreateInput,
    ReviewQueueItem,
} from '../src/pa';
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    type DeviceMemoryGovernanceStateV1,
    type MemoryGovernanceTransaction,
} from '../src/pa/memory-governance-persistence';
import { LegacyMemoryCompatibilityBarrier } from '../src/pa/memory-governance-compatibility';
import {
    MemoryGovernanceCoordinator,
    type ExactMemoryProjectionCleanupPort,
} from '../src/pa/memory-governance-coordinator';
import {
    captureLegacyMemoryPayload,
    hashLegacyMemoryPayload,
} from '../src/pa/memory-governance-migration';
import { previewMemoryGovernanceFinalization } from '../src/pa/memory-governance-finalization';
import { buildLegacyMemoryRollbackProjection } from '../src/pa/memory-governance-rollback';
import { MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS } from '../src/pa/memory-external-operation-timeout';
import type { UserProfileSnapshot } from '../src/ai-services/memory-extraction';

const createTFile = (path: string): TFile => {
    const FileCtor = TFile as unknown as { new(path: string): TFile };
    return new FileCtor(path);
};

const createTFileWithStat = (path: string, stat: { mtime: number; size: number; ctime?: number }): TFile => {
    const file = createTFile(path) as TFile & { stat: { mtime: number; size: number; ctime: number } };
    file.stat = {
        ctime: stat.mtime,
        ...stat,
    };
    return file;
};

const createVaultEventDispatchHarness = () => {
    const vaultHandlers = new Map<string, (...args: unknown[]) => Promise<void>>();
    const workspaceHandlers = new Map<string, (...args: unknown[]) => Promise<void>>();
    const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    plugin.registerEvent = jest.fn();
    plugin.app = {
        vault: {
            on: jest.fn((name: string, callback: (...args: unknown[]) => Promise<void>) => {
                vaultHandlers.set(name, callback);
                return { name, callback };
            }),
        },
        workspace: {
            on: jest.fn((name: string, callback: (...args: unknown[]) => Promise<void>) => {
                workspaceHandlers.set(name, callback);
                return { name, callback };
            }),
        },
    };
    plugin.pageletRuntime = null;
    plugin.memoryExtractionScheduler = { handleVaultEvent: jest.fn() };
    plugin.vss = {
        observeChangedFile: jest.fn(async () => ({ kind: 'ignored' })),
        handleRename: jest.fn(async () => true),
        handleDelete: jest.fn(async () => undefined),
        handleActiveLeafChange: jest.fn(async () => undefined),
        handleFileOpen: jest.fn(async () => false),
        getMaintenanceState: jest.fn(() => ({ dirtyCount: 0, verificationPending: 0 })),
    };
    plugin.memoryManager = {
        scheduleAutoFlush: jest.fn(),
        scheduleVerify: jest.fn(),
    };
    plugin.debouncedStatusBarUpdate = jest.fn();
    plugin.memoryEventGateStartedAt = 1_000_000;
    (plugin as { registerVaultEventDispatch: () => void }).registerVaultEventDispatch();
    return { plugin, vaultHandlers, workspaceHandlers };
};

const collectModalTexts = (node: MockModalContentRecord): string[] => [
    node.textContent,
    ...node.children.flatMap(collectModalTexts),
].filter(Boolean);

const findModalNodeByText = (
    node: MockModalContentRecord,
    text: string,
): MockModalContentRecord | undefined => {
    if (node.textContent === text) return node;
    for (const child of node.children) {
        const found = findModalNodeByText(child, text);
        if (found) return found;
    }
    return undefined;
};

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
    featuredImageModel: 'wan2.7-image',
    numFeaturedImages: 1,
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

describe('Memory vault event dispatch', () => {
    it('observes startup replay modify bursts without scheduling metadata-match maintenance', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_010_000);
        try {
            const { plugin, vaultHandlers } = createVaultEventDispatchHarness();
            const modify = vaultHandlers.get('modify');
            expect(modify).toBeDefined();

            for (let index = 0; index < 1000; index++) {
                const file = createTFileWithStat(`old-${index}.md`, { mtime: 900_000, size: index + 1 });
                await modify?.(file);
            }

            expect(plugin.memoryExtractionScheduler.handleVaultEvent).toHaveBeenCalledTimes(1000);
            expect(plugin.vss.observeChangedFile).toHaveBeenCalledTimes(1000);
            expect(plugin.vss.observeChangedFile).toHaveBeenLastCalledWith(expect.any(TFile), 'vault-modify', 'metadata-drift', {
                verifyMatchingMetadata: false,
            });
            expect(plugin.memoryManager.scheduleAutoFlush).not.toHaveBeenCalled();
            expect(plugin.memoryManager.scheduleVerify).not.toHaveBeenCalled();
            expect(plugin.debouncedStatusBarUpdate).not.toHaveBeenCalled();
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('observes fresh startup-window edits and schedules verification candidates', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_010_000);
        try {
            const { plugin, vaultHandlers } = createVaultEventDispatchHarness();
            plugin.vss.observeChangedFile.mockResolvedValueOnce({
                kind: 'verify-candidate',
                path: 'fresh.md',
                reason: 'vault-modify',
            });
            const file = createTFileWithStat('fresh.md', { mtime: 1_010_000, size: 42 });

            await vaultHandlers.get('modify')?.(file);

            expect(plugin.vss.observeChangedFile).toHaveBeenCalledWith(file, 'vault-modify', 'metadata-drift', {
                verifyMatchingMetadata: true,
            });
            expect(plugin.memoryManager.scheduleVerify).toHaveBeenCalledWith('vault-modify');
            expect(plugin.memoryManager.scheduleAutoFlush).not.toHaveBeenCalled();
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('schedules auto flush only for confirmed dirty observations', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_010_000);
        try {
            const { plugin, vaultHandlers } = createVaultEventDispatchHarness();
            plugin.vss.observeChangedFile.mockResolvedValueOnce({
                kind: 'confirmed-dirty',
                path: 'created.md',
                reason: 'missing-index-record',
            });
            const file = createTFileWithStat('created.md', { mtime: 1_010_000, size: 42 });

            await vaultHandlers.get('create')?.(file);

            expect(plugin.vss.observeChangedFile).toHaveBeenCalledWith(file, 'vault-create', 'metadata-drift', {
                verifyMatchingMetadata: false,
            });
            expect(plugin.memoryManager.scheduleAutoFlush).toHaveBeenCalledWith('vault-create');
            expect(plugin.debouncedStatusBarUpdate).toHaveBeenCalled();
            expect(plugin.memoryManager.scheduleVerify).not.toHaveBeenCalled();
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('keeps rename and delete handling outside the startup replay gate', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_010_000);
        try {
            const { plugin, vaultHandlers } = createVaultEventDispatchHarness();
            const file = createTFileWithStat('renamed.md', { mtime: 900_000, size: 42 });

            await vaultHandlers.get('rename')?.(file, 'old.md');
            await vaultHandlers.get('delete')?.(file);

            expect(plugin.vss.handleRename).toHaveBeenCalledWith(file, 'old.md');
            expect(plugin.memoryManager.scheduleAutoFlush).toHaveBeenCalledWith('vault-rename');
            expect(plugin.vss.handleDelete).toHaveBeenCalledWith(file);
            expect(plugin.debouncedStatusBarUpdate).toHaveBeenCalledTimes(2);
        } finally {
            nowSpy.mockRestore();
        }
    });
});

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
        const vaultDeleteHandlers: Array<(file: unknown) => unknown> = [];
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
                on: jest.fn((event: string, callback: (file: unknown) => unknown) => {
                    if (event === 'delete') vaultDeleteHandlers.push(callback);
                    return {};
                }),
            },
            workspace: {
                on: jest.fn(() => ({})),
                onLayoutReady,
            },
        };
        plugin.settings = { debug: false, showAdvancedMemoryControls: false };
        plugin.loadSettings = jest.fn(async () => undefined);
        plugin.cleanupLegacyMobileDebugLog = jest.fn(() => new Promise<void>(() => undefined));
        plugin.migrateSettings = jest.fn(async () => {
            startupOrder.push('migrate-start');
            await Promise.resolve();
            startupOrder.push('migrate-saved');
        });
        plugin.initializeMemoryGovernanceBootstrap = jest.fn(async () => {
            startupOrder.push('memory-bootstrap');
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
        mockStatsRecalcTotals.mockClear();

        try {
            await plugin.onload();

            expect(plugin.cleanupLegacyMobileDebugLog).toHaveBeenCalledTimes(1);
            expect(startupOrder).toEqual([
                'migrate-start',
                'migrate-saved',
                'memory-bootstrap',
                'init-vss',
            ]);
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
            const detailViewFactory = registerView.mock.calls.find(
                ([viewType]) => viewType === 'pa-pagelet-detail-view',
            )?.[1] as ((leaf: unknown) => PageletDetailView) | undefined;
            const detailView = detailViewFactory?.({});
            const memoryCallbacks = (detailView as unknown as {
                memoryCallbacks?: Record<string, unknown>;
            } | undefined)?.memoryCallbacks;
            expect(memoryCallbacks?.resolveContextualMemory).toEqual(expect.any(Function));
            expect(memoryCallbacks?.onCorrect).toEqual(expect.any(Function));
            expect(registerView.mock.invocationCallOrder[0]).toBeLessThan(
                onLayoutReady.mock.invocationCallOrder[0],
            );

            for (const handler of vaultDeleteHandlers) {
                await handler({ path: 'attachments/image.png', extension: 'png' });
            }
            expect(mockStatsRecalcTotals).not.toHaveBeenCalled();

            layoutCallbacks.forEach((callback) => callback());
            await Promise.resolve();
            await Promise.resolve();

            expect(startupOrder).toEqual([
                'migrate-start',
                'migrate-saved',
                'memory-bootstrap',
                'init-vss',
            ]);
            expect(plugin.initializeCalloutManager).toHaveBeenCalledTimes(1);
            expect(registerView).toHaveBeenCalledTimes(4);
        } finally {
            globalThis.document = originalDocument;
            globalThis.MutationObserver = originalMutationObserver;
        }
    });

    it('keeps Debug logging scoped and redacts secret-shaped values', () => {
        const plugin = Object.create(PluginManager.prototype) as PluginManager;
        plugin.settings = { debug: true } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            plugin.log({ apiKey: 'plain-secret', safe: 'visible' }, 'sk-12345678');

            expect(logSpy).toHaveBeenCalledWith(
                { apiKey: '[redacted]', safe: 'visible' },
                'sk-[redacted]',
            );
        } finally {
            logSpy.mockRestore();
        }
    });

    it('deletes only the exact obsolete mobile Debug log without reading it', async () => {
        const adapter = {
            exists: jest.fn(async (_path: string) => true),
            remove: jest.fn(async (_path: string) => undefined),
            read: jest.fn(),
            write: jest.fn(),
            list: jest.fn(),
        };
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.manifest = { dir: '.obsidian/plugins/personal-assistant' };
        plugin.app = { vault: { adapter } };
        plugin.log = jest.fn();

        await plugin.cleanupLegacyMobileDebugLog();

        expect(adapter.exists).toHaveBeenCalledWith('.obsidian/plugins/personal-assistant/logs.txt');
        expect(adapter.remove).toHaveBeenCalledWith('.obsidian/plugins/personal-assistant/logs.txt');
        expect(adapter.read).not.toHaveBeenCalled();
        expect(adapter.write).not.toHaveBeenCalled();
        expect(adapter.list).not.toHaveBeenCalled();
    });

    it('does not guess a fallback path when the plugin directory is unavailable', async () => {
        const adapter = {
            exists: jest.fn(),
            remove: jest.fn(),
        };
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.manifest = {};
        plugin.app = { vault: { configDir: '.obsidian', adapter } };
        plugin.log = jest.fn();

        await plugin.cleanupLegacyMobileDebugLog();

        expect(adapter.exists).not.toHaveBeenCalled();
        expect(adapter.remove).not.toHaveBeenCalled();
    });

    it.each(['exists', 'remove'] as const)(
        'keeps legacy log %s failures non-blocking and diagnostics content-free',
        async (stage) => {
            const sensitiveError = new Error('sk-secret /Users/private-note.md');
            const adapter = {
                exists: jest.fn(async () => {
                    if (stage === 'exists') throw sensitiveError;
                    return true;
                }),
                remove: jest.fn(async () => {
                    if (stage === 'remove') throw sensitiveError;
                }),
            };
            const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            plugin.manifest = { dir: '.obsidian/plugins/personal-assistant' };
            plugin.app = { vault: { adapter } };
            plugin.log = jest.fn();

            await expect(plugin.cleanupLegacyMobileDebugLog()).resolves.toBeUndefined();

            expect(plugin.log).toHaveBeenCalledWith(
                'Legacy mobile Debug log cleanup failed',
                { stage },
            );
            expect(JSON.stringify(plugin.log.mock.calls)).not.toContain('sk-secret');
            expect(JSON.stringify(plugin.log.mock.calls)).not.toContain('/Users/private-note.md');
        },
    );
});

describe('Memory governance plugin bootstrap', () => {
    const createdAt = '2026-07-10T08:00:00.000Z';
    const bootstrapPlugins = new Set<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any

    afterEach(async () => {
        const plugins = [...bootstrapPlugins];
        bootstrapPlugins.clear();
        for (const plugin of plugins) {
            await plugin.unloadAsync();
        }
    });

    function confirmedRecord(): ConfirmedMemoryRecord {
        return {
            id: 'legacy-memory',
            type: 'preference',
            lifecycle: 'active',
            sensitivity: 'low',
            scope: { kind: 'current_note', paths: ['notes/source.md'] },
            sourceRefs: [{ path: 'notes/source.md' }],
            summary: 'Prefers concise planning notes.',
            createdAt,
            updatedAt: createdAt,
            confirmedAt: createdAt,
            confirmationSource: 'pagelet',
            confirmationStrength: 'explicit',
            originReviewQueueItemId: 'legacy-memory-queue',
        };
    }

    function legacyMemoryQueueItem(): ReviewQueueItem {
        return {
            id: 'legacy-memory-queue',
            type: 'memory_candidate',
            title: 'Remember preference',
            claim: 'Prefers concise planning notes.',
            scope: { kind: 'current_note', paths: ['notes/source.md'] },
            sourceRefs: [{ path: 'notes/source.md' }],
            originSurface: 'pagelet',
            priority: 'normal',
            status: 'applied',
            createdAt,
            updatedAt: createdAt,
            whyShown: ['Confirmed by user'],
            dataBoundarySnapshotId: 'boundary-a',
            admissionReason: 'memory_confirmation_required',
        };
    }

    it('routes Pagelet Forget through the current governance mode and rejects stale records', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const legacy = confirmedRecord();
        const governed = {
            ...legacy,
            effect: 'future_answers',
            useStatus: 'active',
            durableUseStatus: 'active',
            actionPolicy: {
                correct: true,
                pause: true,
                resume: false,
                forget: true,
            },
        };
        let mode: 'effect_based' | 'legacy_threshold' | 'unavailable' = 'legacy_threshold';
        plugin.log = jest.fn();
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.getMemoryGovernanceUiMode = jest.fn(() => mode);
        plugin.getMemoryGovernancePanelState = jest.fn(() => ({
            governanceMode: mode,
            records: mode === 'effect_based' ? [governed] : [legacy],
            totalCount: 1,
        }));
        plugin.forgetConfirmedMemory = jest.fn(async () => ({
            ok: true,
            message: 'Legacy forgotten',
        }));
        plugin.forgetGovernedMemory = jest.fn(async () => ({
            ok: true,
            message: 'Governed forgotten',
        }));

        await expect(plugin.forgetMemoryFromPagelet(governed)).resolves.toMatchObject({ ok: false });
        expect(plugin.forgetConfirmedMemory).not.toHaveBeenCalled();
        await expect(plugin.forgetMemoryFromPagelet(legacy)).resolves.toMatchObject({
            ok: true,
            message: 'Legacy forgotten',
        });
        expect(plugin.forgetConfirmedMemory).toHaveBeenCalledWith(legacy);

        mode = 'effect_based';
        await expect(plugin.forgetMemoryFromPagelet(legacy)).resolves.toMatchObject({
            ok: true,
            message: 'Governed forgotten',
        });
        expect(plugin.forgetGovernedMemory).toHaveBeenCalledWith(governed);
    });

    function nonMemoryQueueInput(): ReviewQueueCreateInput {
        return {
            type: 'evidence_insight',
            title: 'Review note evidence',
            claim: 'The source note has a durable planning pattern.',
            scope: { kind: 'current_note', paths: ['notes/other.md'] },
            sourceRefs: [{ path: 'notes/other.md' }],
            originSurface: 'pagelet',
            admissionReason: 'user_kept_for_later',
            dataBoundarySnapshotId: 'boundary-b',
        };
    }

    function rawSettings() {
        return {
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
            featuredImageModel: 'wan2.7-image',
            numFeaturedImages: 1,
            shareAnonymousCapabilityUsage: false,
            skillContextEnabled: true,
            enabledSkillIds: mockBundledSkillIds,
            statisticsVaultId: 'statistics-vault-secret',
            reviewQueue: { enabled: true, items: [legacyMemoryQueueItem()] },
            dataBoundary: {
                excludedFolders: ['.obsidian'],
                excludedTags: [],
                generatedNotePolicy: 'exclude-generated',
                providerDisclosureReasons: [],
                cleanupGroups: [],
            },
            memoryGovernance: { records: [confirmedRecord()] },
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: false,
            savedInsights: { items: [] },
            focusMode: false,
        };
    }

    function createBootstrapHarness(
        backend = new InMemoryMemoryGovernanceBackend(),
        persistedSettings = rawSettings(),
        vaultBasePath: string | null = '/device/test-vault',
    ) {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const settings = persistedSettings;
        let persistedData = JSON.parse(JSON.stringify(settings));
        let beforeProcess: (() => void) | null = null;
        let processError: Error | null = null;
        const barrier = new LegacyMemoryCompatibilityBarrier(settings);
        const repository = new InMemoryMemoryGovernanceRepository(backend);
        const dataAdapter = {
            ...(vaultBasePath === null ? {} : { getBasePath: () => vaultBasePath }),
            read: jest.fn(async () => JSON.stringify(await plugin.loadData(), null, 2)),
            process: jest.fn(async (_path: string, mutate: (data: string) => string) => {
                beforeProcess?.();
                beforeProcess = null;
                if (processError) throw processError;
                const current = await plugin.loadData();
                const written = mutate(JSON.stringify(current, null, 2));
                await plugin.saveData(JSON.parse(written));
                return written;
            }),
        };
        plugin.settings = JSON.parse(JSON.stringify(settings));
        plugin.app = {
            vault: {
                configDir: '.obsidian',
                getName: () => 'test-vault',
                adapter: dataAdapter,
            },
        };
        plugin.legacyMemoryCompatibilityBarrier = barrier;
        plugin.legacyMemoryPayload = barrier.snapshot();
        plugin.memoryGovernanceBootstrapState = 'not_started';
        plugin.memoryGovernanceBootstrapErrorCode = null;
        plugin.memoryGovernanceOpaqueVaultKey = null;
        plugin.memoryGovernanceSourceHash = null;
        plugin.deviceMemoryGovernanceRepository = null;
        plugin.deviceMemoryRecordRepository = null;
        plugin.deviceMemoryReviewQueueRepository = null;
        plugin.memoryGovernanceRecordRepository = null;
        plugin.reviewQueueRepository = null;
        plugin.settingsReviewQueueRepository = null;
        plugin.memoryGovernanceRepositoryUnsubscribe = null;
        plugin.deviceMemoryCacheRefreshPromise = null;
        plugin.deviceMemoryCacheRefreshTargetSequence = 0;
        plugin.memoryForgetRetryTimer = null;
        plugin.memoryForgetRetryDelayMs = 1_000;
        plugin.memoryProfileProjectionRetryTimer = null;
        plugin.memoryProfileProjectionRetryDelayMs = 1_000;
        plugin.phase3Handle = null;
        plugin.debouncedStatusBarUpdate = { cancel: jest.fn() };
        plugin.resizeDebounceTimer = null;
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.currentLocalConfirmedMemoryCount = null;
        plugin.currentLocalMemoryAutoAcceptPaused = null;
        plugin.reviewQueueStore = null;
        plugin.memoryGovernanceStore = null;
        plugin.settingsSaveTail = null;
        plugin.settingsChangeListeners = new Set();
        plugin.unloading = false;
        plugin.manifest = { id: 'personal-assistant' };
        plugin.log = jest.fn();
        plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(persistedData)));
        plugin.saveData = jest.fn(async (next: unknown) => {
            persistedData = JSON.parse(JSON.stringify(next));
        });
        plugin.createExistingUserProfileReader = jest.fn(() => ({
            read: jest.fn(async () => ({ state: 'not_present' })),
        }));
        plugin.createUserProfileStore = jest.fn(() => {
            throw new Error('must not create a missing Profile database');
        });
        plugin.createMemoryGovernanceDeviceRepository = jest.fn(() => repository);
        bootstrapPlugins.add(plugin);
        return {
            plugin,
            repository,
            backend,
            raw: settings,
            readPersisted: () => JSON.parse(JSON.stringify(persistedData)),
            writePersisted: (next: unknown) => {
                persistedData = JSON.parse(JSON.stringify(next));
            },
            beforeNextProcess: (callback: () => void) => { beforeProcess = callback; },
            setProcessError: (error: Error | null) => { processError = error; },
        };
    }

    async function createGovernedUseGateHarness() {
        const persisted = rawSettings();
        Object.assign(persisted, {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionIncludeVaultInsights: false,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        });
        const harness = createBootstrapHarness(undefined, persisted);
        const { plugin } = harness;
        const isPathAllowed = jest.fn(() => true);
        plugin.isDataBoundaryAllowedPath = isPathAllowed;
        plugin.getPageletLocale = jest.fn(() => 'en');
        await plugin.initializeMemoryGovernanceBootstrap();

        const created = await plugin.createReviewQueueItem({
            type: 'memory_candidate',
            title: 'Remember response preference',
            claim: 'Use concise evidence-backed answers.',
            scope: { kind: 'current_note', paths: ['notes/use-gate.md'] },
            sourceRefs: [{ path: 'notes/use-gate.md', sourceId: 'source-use-gate' }],
            originSurface: 'quick_capture',
            dataBoundarySnapshotId: plugin.getMemoryDataBoundaryFingerprint(),
            admissionReason: 'memory_confirmation_required',
            metadata: { memoryType: 'preference', sensitivity: 'low' },
        });
        expect(created).toMatchObject({ ok: true, value: { status: 'applied' } });
        const record = plugin.getMemoryGovernancePanelState().records.find(
            (candidate: ConfirmedMemoryRecord) => (
                candidate.summary === 'Use concise evidence-backed answers.'
            ),
        );
        expect(record).toBeDefined();
        return {
            ...harness,
            isPathAllowed,
            record: record as ConfirmedMemoryRecord,
        };
    }

    it('derives a stable opaque vault key without retaining the statistics id', () => {
        const first = createMemoryGovernanceOpaqueVaultKey(
            'statistics-vault-secret',
            '/device/test-vault',
        );
        expect(first).toBe(createMemoryGovernanceOpaqueVaultKey(
            'statistics-vault-secret',
            '/device/test-vault',
        ));
        expect(first).toMatch(/^vault-[a-f0-9]{32}$/);
        expect(first).not.toContain('statistics-vault-secret');
        expect(() => createMemoryGovernanceOpaqueVaultKey('statistics-vault-secret', ''))
            .toThrow('device-local vault scope');
    });

    it('fails closed when the adapter cannot prove a unique device-local vault identity', async () => {
        const { plugin } = createBootstrapHarness(undefined, rawSettings(), null);

        await plugin.initializeMemoryGovernanceBootstrap();

        expect(plugin.memoryGovernanceBootstrapState).toBe('failed');
        expect(plugin.memoryGovernanceBootstrapErrorCode).toBe('vault_identity_unavailable');
        expect(plugin.createMemoryGovernanceDeviceRepository).not.toHaveBeenCalled();
        expect(plugin.getMemoryGovernanceStore().list()).toEqual([
            expect.objectContaining({ id: 'legacy-memory' }),
        ]);
        await expect(plugin.getMemoryGovernanceStore().archive('legacy-memory'))
            .rejects.toMatchObject({ code: 'memory_mutation_blocked' });
    });

    it('accepts a unique mobile-style full path when getBasePath is unavailable', async () => {
        const { plugin } = createBootstrapHarness(undefined, rawSettings(), null);
        plugin.app.vault.adapter = { getFullPath: () => '/mobile/device/test-vault' };

        await plugin.initializeMemoryGovernanceBootstrap();

        expect(plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect(plugin.memoryGovernanceOpaqueVaultKey).toBe(createMemoryGovernanceOpaqueVaultKey(
            'statistics-vault-secret',
            '/mobile/device/test-vault',
        ));
    });

    it('isolates copied vaults that retain the same syncable statistics id', async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const first = createBootstrapHarness(backend, rawSettings(), '/device/vault-a');
        const secondSettings = rawSettings();
        secondSettings.memoryGovernance.records[0] = {
            ...secondSettings.memoryGovernance.records[0],
            id: 'legacy-memory-b',
            summary: 'Vault B understanding',
        };
        const second = createBootstrapHarness(backend, secondSettings, '/device/vault-b');

        await first.plugin.initializeMemoryGovernanceBootstrap();
        await second.plugin.initializeMemoryGovernanceBootstrap();

        expect(first.plugin.memoryGovernanceOpaqueVaultKey)
            .not.toBe(second.plugin.memoryGovernanceOpaqueVaultKey);
        const state = await second.repository.initialize();
        expect(state.claims.filter((claim) => (
            claim.partition.kind === 'vault'
            && claim.partition.key === first.plugin.memoryGovernanceOpaqueVaultKey
        ))).toHaveLength(1);
        expect(state.claims.filter((claim) => (
            claim.partition.kind === 'vault'
            && claim.partition.key === second.plugin.memoryGovernanceOpaqueVaultKey
        ))).toHaveLength(1);
        expect(second.plugin.getMemoryGovernanceStore().list()).toEqual([
            expect.objectContaining({ summary: 'Vault B understanding' }),
        ]);
    });

    it('captures raw slices before merge and keeps migrateSettings saves on the raw payload', async () => {
        const raw = rawSettings();
        raw.statisticsVaultId = '';
        let persisted = JSON.parse(JSON.stringify(raw));
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            ...createMigrationApp('.obsidian'),
            vault: {
                configDir: '.obsidian',
                adapter: {
                    read: jest.fn(async () => JSON.stringify(persisted)),
                    process: jest.fn(async (_path: string, mutate: (data: string) => string) => {
                        const written = mutate(JSON.stringify(persisted));
                        persisted = JSON.parse(written);
                        return written;
                    }),
                },
            },
        };
        plugin.manifest = { id: 'personal-assistant' };
        plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(persisted)));
        plugin.saveData = jest.fn(async (next: unknown) => { persisted = JSON.parse(JSON.stringify(next)); });
        plugin.log = jest.fn();
        plugin.settingsSaveTail = null;
        plugin.settingsChangeListeners = new Set();
        plugin.unloading = false;

        await plugin.loadSettings();
        expect(plugin.legacyMemoryPayload).toMatchObject({
            memoryGovernance: raw.memoryGovernance,
            reviewQueue: raw.reviewQueue,
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: false,
        });
        await plugin.migrateSettings();

        expect(plugin.settings.statisticsVaultId).not.toBe('');
        expect(persisted).toMatchObject({
            memoryGovernance: raw.memoryGovernance,
            reviewQueue: raw.reviewQueue,
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: false,
        });
    });

    it('installs local adapters, preserves raw saves, and resumes local state after restart', async () => {
        const first = createBootstrapHarness();
        await first.plugin.initializeMemoryGovernanceBootstrap();

        expect(first.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect(first.plugin.createUserProfileStore).not.toHaveBeenCalled();
        expect(first.plugin.settings).toMatchObject({
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: false,
        });
        await expect(first.plugin.getMemoryGovernanceStore().archive('legacy-memory'))
            .resolves.toMatchObject({ ok: true });
        if (first.plugin.deviceMemoryCacheRefreshPromise) {
            await first.plugin.deviceMemoryCacheRefreshPromise;
        }
        expect(first.plugin.settings.memoryGovernance.records[0].lifecycle).toBe('active');

        await expect(first.plugin.getReviewQueueStore().create(nonMemoryQueueInput()))
            .resolves.toMatchObject({ ok: true });
        expect(first.plugin.getReviewQueueStore().list()).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'memory_candidate' }),
            expect.objectContaining({ type: 'evidence_insight' }),
        ]));
        expect(first.plugin.reviewQueueRepository.read().items).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'memory_candidate' }),
            expect.objectContaining({ type: 'evidence_insight' }),
        ]));
        expect(first.plugin.settings.reviewQueue.items).toEqual([
            expect.objectContaining({ type: 'evidence_insight' }),
        ]);
        expect(first.plugin.settingsReviewQueueRepository.read().items).toEqual([
            expect.objectContaining({ type: 'evidence_insight' }),
        ]);
        await first.plugin.setMemoryAutoAcceptPaused(true);
        await first.plugin.updateCurrentLocalMemoryPolicy({ confirmedMemoryCount: 30 });
        first.plugin.settings.focusMode = true;
        await first.plugin.saveSettings();

        const persisted = first.readPersisted();
        expect(persisted.memoryGovernance.records[0].lifecycle).toBe('active');
        expect(persisted.reviewQueue.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'legacy-memory-queue', type: 'memory_candidate' }),
            expect.objectContaining({ type: 'evidence_insight' }),
        ]));
        expect(persisted).toMatchObject({
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: false,
            focusMode: true,
        });
        const firstState = await first.repository.initialize();
        const key = first.plugin.memoryGovernanceOpaqueVaultKey;
        expect(firstState.policyStates[key].legacyBaseline).toMatchObject({
            confirmedCount: 30,
            autoAcceptPaused: true,
        });

        const restarted = createBootstrapHarness(
            first.backend,
            JSON.parse(JSON.stringify(persisted)),
        );
        await restarted.plugin.initializeMemoryGovernanceBootstrap();
        expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect(restarted.plugin.settings).toMatchObject({
            confirmedMemoryCount: 30,
            memoryAutoAcceptPaused: true,
        });
        expect(restarted.plugin.getMemoryGovernanceStore().list()).toEqual([
            expect.objectContaining({ id: 'legacy-memory', lifecycle: 'archived' }),
        ]);
    });

    it('finalizes legacy compatibility explicitly and keeps later saves and restart device-local', async () => {
        const initial = rawSettings();
        const first = createBootstrapHarness(undefined, initial);
        first.plugin.t = jest.fn((key: string) => key);
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        const preview = previewMemoryGovernanceFinalization(
            await first.repository.initialize(),
            vaultKey,
        );
        expect(preview).toMatchObject({ eligible: true });

        await expect(first.plugin.finalizeMemoryGovernance(preview.confirmationToken))
            .resolves.toMatchObject({ ok: true });

        expect((await first.repository.initialize()).migrationStates[vaultKey].phase)
            .toBe('finalized');
        expect(first.readPersisted()).toMatchObject({
            memoryGovernance: { records: [] },
            confirmedMemoryCount: 0,
            memoryAutoAcceptPaused: false,
        });
        expect(first.readPersisted().reviewQueue.items).toEqual([]);

        first.plugin.settings.focusMode = true;
        await first.plugin.saveSettings();
        const persisted = first.readPersisted();
        expect(persisted.memoryGovernance.records).toEqual([]);
        expect(persisted.reviewQueue.items).toEqual([]);
        expect(persisted).toMatchObject({
            confirmedMemoryCount: 0,
            memoryAutoAcceptPaused: false,
            focusMode: true,
        });

        const restarted = createBootstrapHarness(first.backend, persisted);
        restarted.plugin.canRunMemoryExtractionRuntime = jest.fn(() => false);
        restarted.plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        await restarted.plugin.initializeMemoryGovernanceBootstrap();
        const snapshot = await restarted.plugin.getMemoryControlCenterSnapshot();

        expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect(snapshot.boundary.deviceLocalProven).toBe(true);
        expect(snapshot.boundary.explanationKey)
            .toBe('plugin.settings.memoryControlCenter.boundary.deviceLocal');
        expect(snapshot.compatibilityFinalization).toBeUndefined();
        restarted.plugin.isDeviceCollaborationScopeAvailable = jest.fn(() => true);
        await expect(restarted.plugin.getMemoryControlCenterSnapshot()).resolves.toMatchObject({
            boundary: {
                deviceLocalProven: true,
                explanationKey: 'plugin.settings.memoryControlCenter.boundary.deviceLocal',
            },
        });
        expect(restarted.plugin.createUserProfileStore).not.toHaveBeenCalled();
    });

    it('exposes and completes the protected compatibility rollback from Settings runtime', async () => {
        const harness = createBootstrapHarness();
        const { plugin, repository } = harness;
        plugin.t = jest.fn((key: string) => key);
        await plugin.initializeMemoryGovernanceBootstrap();
        await expect(plugin.getMemoryGovernanceStore().archive('legacy-memory'))
            .resolves.toMatchObject({ ok: true });
        if (plugin.deviceMemoryCacheRefreshPromise) await plugin.deviceMemoryCacheRefreshPromise;

        const before = await plugin.getMemoryControlCenterSnapshot();
        expect(before.compatibilityRollback).toMatchObject({
            phase: 'compatibility',
            eligible: true,
            legacyRecordCount: 1,
            legacyMemoryQueueCount: 1,
        });

        await expect(plugin.rollbackMemoryGovernance()).resolves.toEqual({
            ok: true,
            message: 'plugin.settings.memoryControlCenter.dataRecovery.rollback.complete',
        });

        const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
        expect((await repository.initialize()).migrationStates[vaultKey].phase).toBe('rolled_back');
        expect(plugin.memoryGovernanceCoordinator).toBeNull();
        expect(plugin.getMemoryGovernanceStore().list()).toEqual([
            expect.objectContaining({ id: 'legacy-memory', lifecycle: 'archived' }),
        ]);
        expect(harness.readPersisted().memoryGovernance.records).toEqual([
            expect.objectContaining({ id: 'legacy-memory', lifecycle: 'archived' }),
        ]);
        expect(harness.readPersisted().reviewQueue.items).toEqual([
            expect.objectContaining({ id: 'legacy-memory-queue' }),
        ]);
    });

    it('keeps the compatibility barrier active until the rollback terminal commit succeeds', async () => {
        const harness = createBootstrapHarness();
        const { plugin, repository } = harness;
        plugin.t = jest.fn((key: string) => key);
        await plugin.initializeMemoryGovernanceBootstrap();
        await expect(plugin.getMemoryGovernanceStore().archive('legacy-memory'))
            .resolves.toMatchObject({ ok: true });
        if (plugin.deviceMemoryCacheRefreshPromise) await plugin.deviceMemoryCacheRefreshPromise;

        let transactionCount = 0;
        let failed = false;
        const retryableRepository = {
            initialize: () => repository.initialize(),
            transact: <T>(operation: MemoryGovernanceTransaction<T>): Promise<T> => {
                transactionCount += 1;
                if (!failed && transactionCount === 2) {
                    failed = true;
                    return Promise.reject(new Error('device store temporarily unavailable'));
                }
                return repository.transact(operation);
            },
            subscribe: (listener: (commitSequence: number) => void) => repository.subscribe(listener),
            dispose: () => repository.dispose(),
        };
        plugin.deviceMemoryGovernanceRepository = retryableRepository;

        await expect(plugin.rollbackMemoryGovernance()).resolves.toEqual({
            ok: false,
            message: 'plugin.settings.memoryControlCenter.dataRecovery.rollback.failed',
        });
        const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
        expect((await repository.initialize()).migrationStates[vaultKey]).toMatchObject({
            phase: 'rolling_back',
            lastErrorCode: 'rollback_commit_failed',
        });
        expect(plugin.legacyMemoryCompatibilityBarrier.isActive()).toBe(true);
        expect(harness.readPersisted().memoryGovernance.records).toEqual([
            expect.objectContaining({ id: 'legacy-memory', lifecycle: 'archived' }),
        ]);

        plugin.settings.focusMode = true;
        await plugin.saveSettings();
        expect(harness.readPersisted()).toMatchObject({
            focusMode: true,
            memoryGovernance: {
                records: [expect.objectContaining({ id: 'legacy-memory', lifecycle: 'archived' })],
            },
        });

        await expect(plugin.rollbackMemoryGovernance()).resolves.toEqual({
            ok: true,
            message: 'plugin.settings.memoryControlCenter.dataRecovery.rollback.complete',
        });
        expect(plugin.legacyMemoryCompatibilityBarrier.isActive()).toBe(false);
        expect((await repository.initialize()).migrationStates[vaultKey].phase).toBe('rolled_back');
    });

    it('returns a rollback source race to compatibility and retries after the trusted source returns', async () => {
        const initial = rawSettings();
        const harness = createBootstrapHarness(undefined, initial);
        const { plugin, repository } = harness;
        plugin.t = jest.fn((key: string) => key);
        await plugin.initializeMemoryGovernanceBootstrap();
        await expect(plugin.getMemoryGovernanceStore().archive('legacy-memory'))
            .resolves.toMatchObject({ ok: true });
        if (plugin.deviceMemoryCacheRefreshPromise) await plugin.deviceMemoryCacheRefreshPromise;

        const changed = harness.readPersisted();
        changed.memoryGovernance.records[0].summary = 'Changed on another device during rollback.';
        harness.beforeNextProcess(() => harness.writePersisted(changed));

        await expect(plugin.rollbackMemoryGovernance()).resolves.toEqual({
            ok: false,
            message: 'plugin.settings.memoryControlCenter.dataRecovery.rollback.failed',
        });
        const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
        expect((await repository.initialize()).migrationStates[vaultKey]).toMatchObject({
            phase: 'compatibility',
            pendingLegacySourceHash: hashLegacyMemoryPayload(captureLegacyMemoryPayload(changed)),
        });
        expect(plugin.legacyMemoryCompatibilityBarrier.isActive()).toBe(true);
        expect(plugin.memoryGovernanceCoordinator).not.toBeNull();
        expect(harness.readPersisted().memoryGovernance.records[0].summary)
            .toBe('Changed on another device during rollback.');

        harness.writePersisted(initial);
        await expect(plugin.rollbackMemoryGovernance()).resolves.toEqual({
            ok: true,
            message: 'plugin.settings.memoryControlCenter.dataRecovery.rollback.complete',
        });
        const rolledBackMigration = (await repository.initialize()).migrationStates[vaultKey];
        expect(rolledBackMigration.phase).toBe('rolled_back');
        expect(rolledBackMigration.pendingLegacySourceHash).toBeUndefined();
        expect(harness.readPersisted().memoryGovernance.records).toEqual([
            expect.objectContaining({ id: 'legacy-memory', lifecycle: 'archived' }),
        ]);
    });

    it('idempotently installs legacy runtime after a post-commit rollback read failure', async () => {
        const harness = createBootstrapHarness();
        const { plugin, repository } = harness;
        plugin.t = jest.fn((key: string) => key);
        await plugin.initializeMemoryGovernanceBootstrap();
        await expect(plugin.getMemoryGovernanceStore().archive('legacy-memory'))
            .resolves.toMatchObject({ ok: true });
        if (plugin.deviceMemoryCacheRefreshPromise) await plugin.deviceMemoryCacheRefreshPromise;
        plugin.memoryGovernanceRepositoryUnsubscribe?.();
        plugin.memoryGovernanceRepositoryUnsubscribe = null;

        let failed = false;
        plugin.deviceMemoryGovernanceRepository = {
            initialize: async () => {
                const state = await repository.initialize();
                if (!failed && Object.values(state.migrationStates).some(
                    (migration) => migration.phase === 'rolled_back',
                )) {
                    failed = true;
                    throw new Error('post-commit device read failed');
                }
                return state;
            },
            transact: <T>(operation: MemoryGovernanceTransaction<T>): Promise<T> => (
                repository.transact(operation)
            ),
            subscribe: (listener: (commitSequence: number) => void) => repository.subscribe(listener),
            dispose: () => repository.dispose(),
        };

        await expect(plugin.rollbackMemoryGovernance())
            .rejects.toThrow('post-commit device read failed');
        const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
        expect((await repository.initialize()).migrationStates[vaultKey].phase).toBe('rolled_back');
        expect(plugin.legacyMemoryCompatibilityBarrier.isActive()).toBe(true);
        expect(plugin.memoryGovernanceCoordinator).not.toBeNull();

        await expect(plugin.rollbackMemoryGovernance()).resolves.toEqual({
            ok: true,
            message: 'plugin.settings.memoryControlCenter.dataRecovery.rollback.complete',
        });
        expect(plugin.legacyMemoryCompatibilityBarrier.isActive()).toBe(false);
        expect(plugin.memoryGovernanceCoordinator).toBeNull();
    });

    it('maps finalization blocker codes to safe localized feedback', () => {
        const { plugin } = createBootstrapHarness();

        const pending = plugin.getMemoryFinalizationStatusMessage('finalization_pending_operations');
        const reconciliation = plugin.getMemoryFinalizationStatusMessage('legacy_source_reconciliation_required');
        const recovery = plugin.getMemoryFinalizationStatusMessage('fresh_restore_readback_mismatch');
        const unknown = plugin.getMemoryFinalizationStatusMessage('private_internal_reason');

        expect(pending).toContain('still finishing another Memory change');
        expect(reconciliation).toContain('Older compatibility data changed');
        expect(recovery).toContain('could not verify a safe recovery path');
        expect(unknown).toContain('Compatibility cleanup is not complete');
        expect([pending, reconciliation, recovery, unknown].join(' ')).not.toMatch(
            /finalization_pending_operations|legacy_source_reconciliation_required|fresh_restore_readback_mismatch|private_internal_reason/,
        );
    });

    it('restarts governed Memory after the compatibility restore proof was garbage-collected', async () => {
        const initial = rawSettings();
        const first = createBootstrapHarness(undefined, initial);
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        await first.repository.transact((draft) => {
            const migration = draft.migrationStates[vaultKey];
            const runId = migration.migrationRunId;
            delete migration.rollbackExpiresAt;
            delete migration.lastAppliedDeltaSequence;
            draft.rollbackPayloadEntries = draft.rollbackPayloadEntries
                .filter((entry) => entry.migrationRunId !== runId);
            draft.migrationDeltas = draft.migrationDeltas
                .filter((delta) => delta.migrationRunId !== runId);
        });
        let persisted = JSON.parse(JSON.stringify(initial));
        const restarted = createBootstrapHarness(first.backend, persisted);
        restarted.plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(persisted)));
        restarted.plugin.saveData = jest.fn(async (payload: unknown) => {
            persisted = JSON.parse(JSON.stringify(payload));
        });

        await restarted.plugin.initializeMemoryGovernanceBootstrap();
        const snapshot = await restarted.plugin.getMemoryControlCenterSnapshot();

        expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect((await restarted.repository.initialize()).migrationStates[vaultKey]).toMatchObject({
            phase: 'compatibility',
        });
        expect(snapshot.governanceMode).toBe('effect_based');
        expect(snapshot.compatibilityFinalization).toMatchObject({
            phase: 'compatibility',
            eligible: true,
            requiresFreshRestoreProof: true,
            confirmationToken: expect.stringMatching(/^finalize-fresh-/),
        });
    });

    it('does not clear a legacy source that changes at the guarded settings write boundary', async () => {
        const initial = rawSettings();
        const harness = createBootstrapHarness(undefined, initial);
        const { plugin, repository } = harness;
        await plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
        const preview = previewMemoryGovernanceFinalization(await repository.initialize(), vaultKey);
        const changed = JSON.parse(JSON.stringify(initial));
        changed.memoryGovernance.records[0].summary = 'Changed on another device.';
        harness.beforeNextProcess(() => harness.writePersisted(changed));
        plugin.t = jest.fn((key: string) => key);

        await expect(plugin.finalizeMemoryGovernance(preview.confirmationToken!))
            .resolves.toMatchObject({ ok: false });

        expect((await repository.initialize()).migrationStates[vaultKey]).toMatchObject({
            phase: 'compatibility',
            pendingLegacySourceHash: expect.stringMatching(/^legacy-v1:/),
        });
        expect(harness.readPersisted().memoryGovernance.records[0].summary)
            .toBe('Changed on another device.');
    });

    it('blocks ordinary saves after failed finalization and preserves a newly changed legacy source', async () => {
        const initial = rawSettings();
        const harness = createBootstrapHarness(undefined, initial);
        const { plugin, repository } = harness;
        let failSave = false;
        plugin.saveData = jest.fn(async (payload: unknown) => {
            if (failSave) throw new Error('storage temporarily unavailable');
            harness.writePersisted(payload);
        });
        plugin.t = jest.fn((key: string) => key);
        await plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
        const preview = previewMemoryGovernanceFinalization(
            await repository.initialize(),
            vaultKey,
        );

        failSave = true;
        await expect(plugin.finalizeMemoryGovernance(preview.confirmationToken!))
            .resolves.toMatchObject({ ok: false });
        expect((await repository.initialize()).migrationStates[vaultKey].phase).toBe('finalizing');

        const changed = harness.readPersisted();
        changed.memoryGovernance.records[0].summary = 'Changed on another device after failure.';
        harness.writePersisted(changed);
        failSave = false;
        plugin.settings.focusMode = true;
        await expect(plugin.saveSettings()).rejects.toMatchObject({ code: 'legacy_save_collision' });
        expect(harness.readPersisted().memoryGovernance.records[0].summary)
            .toBe('Changed on another device after failure.');

        await expect(plugin.finalizeMemoryGovernance(preview.confirmationToken!))
            .resolves.toMatchObject({ ok: false });
        expect((await repository.initialize()).migrationStates[vaultKey]).toMatchObject({
            phase: 'compatibility',
            pendingLegacySourceHash: expect.stringMatching(/^legacy-v1:/),
        });

        await expect(plugin.saveSettings()).resolves.toBeUndefined();
        const persisted = harness.readPersisted();
        expect(persisted.memoryGovernance.records[0].summary)
            .toBe('Changed on another device after failure.');
        expect(persisted.focusMode).toBe(true);
    });

    it('offers device scope only for explicit low-risk interaction preferences after device-only setup', async () => {
        let persisted = JSON.parse(JSON.stringify(rawSettings()));
        const { plugin, repository } = createBootstrapHarness(undefined, persisted);
        plugin.isDeviceCollaborationScopeAvailable = jest.fn(() => true);
        plugin.t = jest.fn((key: string) => key === 'plugin.settings.memoryControlCenter.deviceVaults'
            ? 'All vaults on this device'
            : key);
        plugin.saveData = jest.fn(async (payload: unknown) => {
            persisted = JSON.parse(JSON.stringify(payload));
        });
        plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(persisted)));
        await plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
        const preview = previewMemoryGovernanceFinalization(await repository.initialize(), vaultKey);
        await plugin.finalizeMemoryGovernance(preview.confirmationToken!);

        const createdAt = '2026-07-10T09:00:00.000Z';
        await repository.transact((draft) => {
            draft.claims.push(
                {
                    id: 'conversation-preference',
                    partition: { kind: 'vault', key: vaultKey },
                    memoryType: 'preference',
                    sensitivity: 'low',
                    applicability: { kind: 'whole_vault' },
                    activeRevisionId: 'revision-conversation-preference',
                    effect: 'future_answers',
                    lifecycle: 'active',
                    createdAt,
                    updatedAt: createdAt,
                },
                {
                    id: 'note-preference',
                    partition: { kind: 'vault', key: vaultKey },
                    memoryType: 'preference',
                    sensitivity: 'low',
                    applicability: { kind: 'whole_vault' },
                    activeRevisionId: 'revision-note-preference',
                    effect: 'future_answers',
                    lifecycle: 'active',
                    createdAt,
                    updatedAt: createdAt,
                },
                {
                    id: 'device-preference',
                    partition: { kind: 'device_collaboration', key: 'device' },
                    memoryType: 'preference',
                    sensitivity: 'low',
                    applicability: { kind: 'whole_vault' },
                    activeRevisionId: 'revision-device-preference',
                    effect: 'collaboration_default',
                    lifecycle: 'active',
                    createdAt,
                    updatedAt: createdAt,
                },
            );
            draft.revisions.push(
                {
                    id: 'revision-conversation-preference',
                    claimId: 'conversation-preference',
                    summary: 'Use concise answers.',
                    provenance: [{
                        kind: 'conversation',
                        conversationIds: ['conversation-1'],
                        observedAt: createdAt,
                    }],
                    authority: 'explicit_user',
                    createdAt,
                },
                {
                    id: 'revision-note-preference',
                    claimId: 'note-preference',
                    summary: 'Use a note-derived style.',
                    provenance: [{
                        kind: 'note',
                        sourceRef: { path: 'notes/style.md', sourceId: 'style-source' },
                    }],
                    authority: 'explicit_user',
                    createdAt,
                },
                {
                    id: 'revision-device-preference',
                    claimId: 'device-preference',
                    summary: 'Use concise answers everywhere.',
                    provenance: [{
                        kind: 'conversation',
                        conversationIds: ['conversation-2'],
                        observedAt: createdAt,
                    }],
                    authority: 'user_correction',
                    createdAt,
                },
            );
        });
        await plugin.refreshDeviceMemoryCaches();

        const items = plugin.getGovernedMemoryViewSnapshot().records.map(
            (entry: unknown) => plugin.toMemoryControlCenterItem(entry, {
                runtimeUseEnabled: true,
                sourceEligible: true,
            }),
        );
        expect(items.find((item: { id: string }) => item.id === 'conversation-preference')
            ?.supportedActions).toContain('apply_device_wide');
        expect(items.find((item: { id: string }) => item.id === 'note-preference')
            ?.supportedActions).not.toContain('apply_device_wide');
        expect(items.find((item: { id: string }) => item.id === 'device-preference')).toMatchObject({
            scopeLabel: 'All vaults on this device',
            supportedActions: expect.arrayContaining(['limit_to_current_vault']),
        });

        plugin.isDeviceCollaborationScopeAvailable.mockReturnValue(false);
        const capabilityBlockedEntry = plugin.getGovernedMemoryViewSnapshot().records.find(
            (entry: { claimId: string }) => entry.claimId === 'conversation-preference',
        );
        expect(plugin.toMemoryControlCenterItem(capabilityBlockedEntry, {
            runtimeUseEnabled: true,
            sourceEligible: true,
        }).supportedActions)
            .not.toContain('apply_device_wide');
        plugin.isDeviceCollaborationScopeAvailable.mockReturnValue(true);

        plugin.currentDeviceMemoryGovernanceState.migrationStates[vaultKey].phase = 'compatibility';
        const conversationEntry = plugin.getGovernedMemoryViewSnapshot().records.find(
            (entry: { claimId: string }) => entry.claimId === 'conversation-preference',
        );
        expect(plugin.toMemoryControlCenterItem(conversationEntry, {
            runtimeUseEnabled: true,
            sourceEligible: true,
        }).supportedActions)
            .not.toContain('apply_device_wide');
    });

    it('removes the owner-vault Profile copy before completing device-wide scope', async () => {
        const globalObj = globalThis as typeof globalThis & { __paConfirmDecision?: boolean };
        globalObj.__paConfirmDecision = true;
        try {
            let persisted = JSON.parse(JSON.stringify(rawSettings()));
            const { plugin, repository } = createBootstrapHarness(undefined, persisted);
            plugin.isDeviceCollaborationScopeAvailable = jest.fn(() => true);
            plugin.t = jest.fn((key: string) => key);
            plugin.saveData = jest.fn(async (payload: unknown) => {
                persisted = JSON.parse(JSON.stringify(payload));
            });
            plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(persisted)));
            await plugin.initializeMemoryGovernanceBootstrap();
            const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
            const preview = previewMemoryGovernanceFinalization(await repository.initialize(), vaultKey);
            await plugin.finalizeMemoryGovernance(preview.confirmationToken!);

            let profileSnapshot: UserProfileSnapshot = {
                updatedAt: '2026-07-10T09:00:00.000Z',
                records: [{
                    profileRecordId: 'profile-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    key: 'concise',
                    text: 'Use concise answers.',
                    kind: 'user_explicit',
                    confidence: 'high',
                    conversationId: 'conversation-device-scope',
                    observedAt: '2026-07-10T09:00:00.000Z',
                    occurrences: 1,
                    conversationIds: ['conversation-device-scope'],
                    confirmed: true,
                }],
                markdown: '# User profile',
            };
            const profileStore = {
                initialize: jest.fn(async () => undefined),
                getProfile: jest.fn(async () => JSON.parse(JSON.stringify(profileSnapshot))),
                setProfile: jest.fn(async (next: UserProfileSnapshot) => {
                    profileSnapshot = JSON.parse(JSON.stringify(next));
                }),
                dispose: jest.fn(async () => undefined),
            };
            plugin.createUserProfileStore = jest.fn(() => profileStore);
            const createdAt = '2026-07-10T09:00:00.000Z';
            await repository.transact((draft) => {
                draft.claims.push({
                    id: 'claim-device-scope-cleanup',
                    partition: { kind: 'vault', key: vaultKey },
                    memoryType: 'preference',
                    sensitivity: 'low',
                    applicability: { kind: 'whole_vault' },
                    activeRevisionId: 'revision-device-scope-cleanup',
                    effect: 'future_answers',
                    lifecycle: 'active',
                    createdAt,
                    updatedAt: createdAt,
                });
                draft.revisions.push({
                    id: 'revision-device-scope-cleanup',
                    claimId: 'claim-device-scope-cleanup',
                    summary: 'Use concise answers.',
                    provenance: [{
                        kind: 'conversation',
                        conversationIds: ['conversation-device-scope'],
                        observedAt: createdAt,
                    }],
                    authority: 'explicit_user',
                    createdAt,
                });
                draft.projectionLinks.push({
                    id: 'profile-link-device-scope',
                    claimId: 'claim-device-scope-cleanup',
                    target: {
                        kind: 'type_a_profile',
                        profileRecordId: 'profile-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    },
                    relation: 'origin',
                    state: 'active',
                    sourceFingerprintId: 'source-device-scope',
                    ruleFingerprint: 'type-a-v1',
                    createdAt,
                }, {
                    id: 'prompt-link-device-scope',
                    claimId: 'claim-device-scope-cleanup',
                    target: { kind: 'prompt_projection', projectionId: 'prompt-device-scope' },
                    relation: 'derived_copy',
                    state: 'active',
                    sourceFingerprintId: 'source-device-scope',
                    ruleFingerprint: 'type-a-v1',
                    createdAt,
                });
            });
            await plugin.refreshDeviceMemoryCaches();
            plugin.isGovernedMemoryRevisionAllowed = jest.fn(() => true);

            await expect(plugin.runMemoryControlCenterAction(
                'apply_device_wide',
                'claim-device-scope-cleanup',
            )).resolves.toMatchObject({ ok: true });

            expect(profileSnapshot.records).toEqual([]);
            const state = await repository.initialize();
            expect(state.claims.find((claim) => claim.id === 'claim-device-scope-cleanup'))
                .toMatchObject({
                    partition: { kind: 'device_collaboration', key: 'device' },
                    effect: 'collaboration_default',
                });
            expect(state.projectionLinks.find((link) => link.id === 'profile-link-device-scope')?.state)
                .toBe('redacted');
            expect(state.pendingOperations).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    action: 'remove',
                    ownerVaultKey: vaultKey,
                    state: 'applied',
                }),
            ]));
        } finally {
            delete globalObj.__paConfirmDecision;
        }
    });

    it('keeps legacy data available to a fresh second device until explicit finalization', async () => {
        const initial = rawSettings();
        let syncedSettings = JSON.parse(JSON.stringify(initial));
        const deviceA = createBootstrapHarness(
            new InMemoryMemoryGovernanceBackend(),
            initial,
            '/device-a/test-vault',
        );
        deviceA.plugin.t = jest.fn((key: string) => key);
        deviceA.plugin.saveData = jest.fn(async (payload: unknown) => {
            syncedSettings = JSON.parse(JSON.stringify(payload));
        });
        deviceA.plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(syncedSettings)));
        await deviceA.plugin.initializeMemoryGovernanceBootstrap();
        await expect(deviceA.plugin.getMemoryGovernanceStore().archive('legacy-memory'))
            .resolves.toMatchObject({ ok: true });
        if (deviceA.plugin.deviceMemoryCacheRefreshPromise) {
            await deviceA.plugin.deviceMemoryCacheRefreshPromise;
        }
        deviceA.plugin.settings.focusMode = true;
        await deviceA.plugin.saveSettings();

        expect(syncedSettings.memoryGovernance.records).toEqual([
            expect.objectContaining({ id: 'legacy-memory', lifecycle: 'active' }),
        ]);
        const deviceB = createBootstrapHarness(
            new InMemoryMemoryGovernanceBackend(),
            syncedSettings,
            '/device-b/test-vault',
        );
        await deviceB.plugin.initializeMemoryGovernanceBootstrap();
        expect(deviceB.plugin.getMemoryGovernanceStore().list()).toEqual([
            expect.objectContaining({ id: 'legacy-memory', lifecycle: 'active' }),
        ]);
        expect(deviceA.plugin.getMemoryGovernanceStore().list()).toEqual([
            expect.objectContaining({ id: 'legacy-memory', lifecycle: 'archived' }),
        ]);

        const deviceAKey = deviceA.plugin.memoryGovernanceOpaqueVaultKey as string;
        const preview = previewMemoryGovernanceFinalization(
            await deviceA.repository.initialize(),
            deviceAKey,
        );
        await expect(deviceA.plugin.finalizeMemoryGovernance(preview.confirmationToken!))
            .resolves.toMatchObject({ ok: true });
        expect(syncedSettings.memoryGovernance.records).toEqual([]);
        expect(syncedSettings.reviewQueue.items).toEqual([]);

        const deviceCAfterFinalization = createBootstrapHarness(
            new InMemoryMemoryGovernanceBackend(),
            syncedSettings,
            '/device-c/test-vault',
        );
        await deviceCAfterFinalization.plugin.initializeMemoryGovernanceBootstrap();
        expect(deviceCAfterFinalization.plugin.getMemoryGovernanceStore().list()).toEqual([]);
    });

    it.each([
        ['before legacy clear', false],
        ['after legacy clear', true],
    ])('resumes finalizing after restart %s', async (_label, legacyAlreadyCleared) => {
        const initial = rawSettings();
        const first = createBootstrapHarness(undefined, initial);
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        await first.repository.transact((draft) => {
            draft.migrationStates[vaultKey].phase = 'finalizing';
        });
        let persisted = JSON.parse(JSON.stringify(initial));
        if (legacyAlreadyCleared) {
            persisted.memoryGovernance.records = [];
            persisted.reviewQueue.items = [];
            persisted.confirmedMemoryCount = 0;
            persisted.memoryAutoAcceptPaused = false;
        }
        const restarted = createBootstrapHarness(first.backend, persisted);
        restarted.plugin.saveData = jest.fn(async (payload: unknown) => {
            persisted = JSON.parse(JSON.stringify(payload));
        });
        restarted.plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(persisted)));

        await restarted.plugin.initializeMemoryGovernanceBootstrap();

        expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect((await restarted.repository.initialize()).migrationStates[vaultKey].phase)
            .toBe('finalized');
        expect(persisted.memoryGovernance.records).toEqual([]);
        expect(persisted.reviewQueue.items).toEqual([]);
    });

    it('keeps finalization retryable when restart cleanup remains temporarily unavailable', async () => {
        const initial = rawSettings();
        const first = createBootstrapHarness(undefined, initial);
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        await first.repository.transact((draft) => {
            draft.migrationStates[vaultKey].phase = 'finalizing';
        });
        let persisted = JSON.parse(JSON.stringify(initial));
        let failSave = true;
        const restarted = createBootstrapHarness(first.backend, persisted);
        restarted.plugin.t = jest.fn((key: string) => key);
        restarted.plugin.canRunMemoryExtractionRuntime = jest.fn(() => false);
        restarted.plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        restarted.plugin.saveData = jest.fn(async (payload: unknown) => {
            if (failSave) throw new Error('storage temporarily unavailable');
            persisted = JSON.parse(JSON.stringify(payload));
        });
        restarted.plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(persisted)));

        await restarted.plugin.initializeMemoryGovernanceBootstrap();
        const pendingSnapshot = await restarted.plugin.getMemoryControlCenterSnapshot();

        expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect((await restarted.repository.initialize()).migrationStates[vaultKey]).toMatchObject({
            phase: 'finalizing',
            lastErrorCode: 'finalization_cleanup_failed',
        });
        expect(pendingSnapshot.compatibilityFinalization).toMatchObject({
            phase: 'finalizing',
            eligible: true,
            confirmationToken: expect.any(String),
        });

        failSave = false;
        await expect(restarted.plugin.finalizeMemoryGovernance(
            pendingSnapshot.compatibilityFinalization.confirmationToken,
        )).resolves.toMatchObject({ ok: true });
        expect((await restarted.repository.initialize()).migrationStates[vaultKey].phase)
            .toBe('finalized');
    });

    it('resumes rolling_back before and after the legacy projection write', async () => {
        const initial = rawSettings();
        const first = createBootstrapHarness(undefined, initial);
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        await first.repository.transact((draft) => {
            draft.migrationStates[vaultKey].phase = 'rolling_back';
        });
        let persisted = JSON.parse(JSON.stringify(initial));

        const resume = async () => {
            const restarted = createBootstrapHarness(first.backend, persisted);
            restarted.plugin.saveData = jest.fn(async (payload: unknown) => {
                persisted = JSON.parse(JSON.stringify(payload));
            });
            restarted.plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(persisted)));
            await restarted.plugin.initializeMemoryGovernanceBootstrap();
            expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
            expect((await restarted.repository.initialize()).migrationStates[vaultKey].phase)
                .toBe('rolled_back');
            expect(persisted.memoryGovernance.records).toEqual([
                expect.objectContaining({ id: 'legacy-memory' }),
            ]);
            expect(persisted.reviewQueue.items).toEqual([
                expect.objectContaining({ id: 'legacy-memory-queue' }),
            ]);
        };

        await resume();
        await first.repository.transact((draft) => {
            draft.migrationStates[vaultKey].phase = 'rolling_back';
        });
        await resume();
    });

    it('sanitizes an existing Profile, persists immutable IDs, and adopts only classified rows', async () => {
        const { plugin, repository } = createBootstrapHarness();
        let storedProfile: Record<string, unknown> | null = null;
        plugin.createExistingUserProfileReader = jest.fn(() => ({
            read: jest.fn(async () => ({
                state: 'ready',
                snapshot: {
                    updatedAt: createdAt,
                    markdown: '# Legacy profile',
                    records: [{
                        key: 'answer-structure',
                        text: 'Please always answer with bullet points.',
                        kind: 'user_explicit',
                        confidence: 'high',
                        conversationId: 'conversation-a',
                        observedAt: createdAt,
                        occurrences: 1,
                        conversationIds: ['conversation-a'],
                        confirmed: true,
                    }],
                },
            })),
        }));
        plugin.createUserProfileStore = jest.fn(() => ({
            initialize: jest.fn(async () => undefined),
            setProfile: jest.fn(async (snapshot: Record<string, unknown>) => {
                storedProfile = JSON.parse(JSON.stringify(snapshot));
            }),
            getProfile: jest.fn(async () => JSON.parse(JSON.stringify(storedProfile))),
            dispose: jest.fn(async () => undefined),
        }));

        await plugin.initializeMemoryGovernanceBootstrap();

        expect(plugin.memoryGovernanceBootstrapState).toBe('ready');
        const persistedProfile = storedProfile as unknown as {
            records: Array<{ profileRecordId: string }>;
        };
        expect(persistedProfile.records[0].profileRecordId)
            .toMatch(/^profile-[a-f0-9]{32}$/);
        const state = await repository.initialize();
        const profileLink = state.projectionLinks.find((link) => link.target.kind === 'type_a_profile');
        expect(profileLink).toMatchObject({
            relation: 'origin',
            target: {
                kind: 'type_a_profile',
                profileRecordId: persistedProfile.records[0].profileRecordId,
            },
        });
        expect(state.pendingOperations).toContainEqual(expect.objectContaining({
            kind: 'profile_projection',
            state: 'applied',
        }));
    });

    it('preserves Type-A and enabled Type-C prompt effects across legacy-to-governed cutover', async () => {
        const { plugin } = createBootstrapHarness();
        const profileSnapshot: UserProfileSnapshot = {
            updatedAt: createdAt,
            markdown: '# User Profile\n- Always answer with bullet points.',
            records: [{
                key: 'answer-structure',
                text: 'Always answer with bullet points.',
                kind: 'user_explicit',
                confidence: 'high',
                conversationId: 'conversation-equivalence',
                observedAt: createdAt,
                occurrences: 1,
                conversationIds: ['conversation-equivalence'],
                confirmed: true,
            }],
        };
        const vaultSnapshot = {
            generatedAt: createdAt,
            fileCount: 1,
            folderThemes: [],
            tagTaxonomy: [],
            linkTopology: { hubNotes: [], unresolvedLinks: [] },
            writingHabits: { busiestWeekdays: [], averageWords: 0, recentlyActive: [] },
            topicClusters: [],
            knowledgeGaps: [],
            trends: [],
        };
        plugin.settings.memoryExtractionIncludeVaultInsights = true;
        plugin.canRunMemoryExtractionRuntime = jest.fn(() => true);
        plugin.hasConfirmedMemoryExtractionConsent = jest.fn(() => true);
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.getGovernedMemoryCurrentScope = jest.fn(() => ({ tags: [] }));
        plugin.memoryExtractionScheduler = {
            dispose: jest.fn(),
            getPromptContext: jest.fn(() => ({
                userProfile: profileSnapshot.markdown,
                vaultInsights: '# Vault Insights\n- fileCount=1',
            })),
            getVaultInsightsSnapshot: jest.fn(() => ({
                dataBoundaryFingerprint: 'boundary-current',
                representativePaths: ['notes/source.md'],
                snapshot: vaultSnapshot,
            })),
        };
        plugin.createExistingUserProfileReader = jest.fn(() => ({
            read: jest.fn(async () => ({ state: 'ready', snapshot: profileSnapshot })),
        }));
        let storedProfile: UserProfileSnapshot | null = null;
        plugin.createUserProfileStore = jest.fn(() => ({
            initialize: jest.fn(async () => undefined),
            setProfile: jest.fn(async (snapshot: UserProfileSnapshot) => {
                storedProfile = JSON.parse(JSON.stringify(snapshot));
            }),
            getProfile: jest.fn(async () => {
                const snapshot = JSON.parse(JSON.stringify(storedProfile)) as UserProfileSnapshot | null;
                if (!snapshot) return null;
                // Real IndexedDB structured-clone readback can reorder object
                // keys without changing the stored JSON value.
                return {
                    records: snapshot.records.map((record) => Object.fromEntries(
                        Object.entries(record).reverse(),
                    )) as unknown as UserProfileSnapshot["records"],
                    markdown: snapshot.markdown,
                    updatedAt: snapshot.updatedAt,
                };
            }),
            dispose: jest.fn(async () => undefined),
        }));

        const legacy = plugin.getMemoryExtractionPromptContext();
        await plugin.initializeMemoryGovernanceBootstrap();
        const governed = plugin.getMemoryExtractionPromptContext();

        expect(legacy).toMatchObject({
            memoryContextMode: 'legacy',
            userProfile: expect.stringContaining('Always answer with bullet points.'),
            vaultInsights: expect.stringContaining('fileCount=1'),
        });
        expect(governed).toMatchObject({ memoryContextMode: 'governed' });
        expect(governed.governedMemoryContext).toContain('Always answer with bullet points.');
        expect(governed.governedMemoryContext).toContain('"kind":"vault_insights"');
        expect(governed.governedMemoryContext).toContain('"fileCount":1');
        expect(governed.governedMemoryContext).not.toContain('Prefers concise planning notes.');
        expect(governed.governedMemoryTrace).toEqual([expect.objectContaining({
            source: 'interactions',
            scope: 'current_vault',
            sourcePaths: [],
        })]);
    });

    it('keeps legacy reads and non-Memory saves available while Memory writes fail closed', async () => {
        const { plugin, raw } = createBootstrapHarness();
        const dispose = jest.fn(async () => undefined);
        plugin.createMemoryGovernanceDeviceRepository = jest.fn(() => ({
            initialize: jest.fn(async () => { throw new Error('device storage unavailable'); }),
            transact: jest.fn(async () => { throw new Error('device storage unavailable'); }),
            subscribe: jest.fn(() => () => undefined),
            dispose,
        }));

        await plugin.initializeMemoryGovernanceBootstrap();

        expect(plugin.memoryGovernanceBootstrapState).toBe('failed');
        expect(plugin.getMemoryGovernanceStore().list()).toEqual([
            expect.objectContaining({ id: 'legacy-memory' }),
        ]);
        await expect(plugin.getMemoryGovernanceStore().archive('legacy-memory'))
            .rejects.toMatchObject({ code: 'memory_mutation_blocked' });
        await expect(plugin.getReviewQueueStore().create(nonMemoryQueueInput()))
            .resolves.toMatchObject({ ok: true });
        await expect(plugin.getReviewQueueStore().create({
            ...nonMemoryQueueInput(),
            type: 'memory_candidate',
            admissionReason: 'memory_confirmation_required',
        })).rejects.toMatchObject({ code: 'memory_mutation_blocked' });
        plugin.settings.focusMode = true;
        await plugin.saveSettings();

        const persisted = plugin.saveData.mock.calls.at(-1)?.[0];
        expect(persisted.memoryGovernance).toEqual(raw.memoryGovernance);
        expect(persisted.reviewQueue.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'legacy-memory-queue' }),
            expect.objectContaining({ type: 'evidence_insight' }),
        ]));
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('fails a save before raw Memory and live non-Memory IDs can collide', async () => {
        const { plugin } = createBootstrapHarness();
        plugin.settings.reviewQueue.items = [{
            ...legacyMemoryQueueItem(),
            type: 'evidence_insight',
            admissionReason: 'user_kept_for_later',
        }];

        await expect(plugin.saveSettings()).rejects.toMatchObject({ code: 'legacy_save_collision' });

        expect(plugin.saveData).not.toHaveBeenCalled();
        expect(plugin.memoryGovernanceBootstrapErrorCode).toBe('review_queue_id_collision');
    });

    it('refreshes device caches asynchronously without extending repository commit latency', async () => {
        const { plugin, repository } = createBootstrapHarness();
        await plugin.initializeMemoryGovernanceBootstrap();
        let releaseRefresh!: () => void;
        const refreshBlocked = new Promise<void>((resolve) => { releaseRefresh = resolve; });
        plugin.refreshDeviceMemoryCaches = jest.fn(async () => {
            await refreshBlocked;
            plugin.currentDeviceMemoryGovernanceState = await repository.initialize();
        });

        await expect(repository.transact(() => undefined)).resolves.toBeUndefined();
        await Promise.resolve();
        expect(plugin.refreshDeviceMemoryCaches).toHaveBeenCalledTimes(1);

        releaseRefresh();
        await plugin.deviceMemoryCacheRefreshPromise;
    });

    it('refreshes again when a newer commit lands after an in-flight cache read', async () => {
        const { plugin, repository } = createBootstrapHarness();
        await plugin.initializeMemoryGovernanceBootstrap();
        let releaseFirstRefresh!: () => void;
        let notifyFirstRead!: () => void;
        const firstRefreshBlocked = new Promise<void>((resolve) => { releaseFirstRefresh = resolve; });
        const firstRead = new Promise<void>((resolve) => { notifyFirstRead = resolve; });
        let refreshCount = 0;
        plugin.refreshDeviceMemoryCaches = jest.fn(async () => {
            refreshCount += 1;
            const snapshot = await repository.initialize();
            if (refreshCount === 1) {
                notifyFirstRead();
                await firstRefreshBlocked;
            }
            plugin.currentDeviceMemoryGovernanceState = snapshot;
        });

        await repository.transact(() => undefined);
        await firstRead;
        await repository.transact((draft) => {
            const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
            const policy = draft.policyStates[vaultKey];
            if (!policy?.legacyBaseline) throw new Error('policy baseline missing');
            policy.legacyBaseline.autoAcceptPaused = true;
        });
        const newest = await repository.initialize();

        releaseFirstRefresh();
        await plugin.deviceMemoryCacheRefreshPromise;

        expect(plugin.refreshDeviceMemoryCaches).toHaveBeenCalledTimes(2);
        expect(plugin.currentDeviceMemoryGovernanceState.commitSequence).toBe(newest.commitSequence);
        expect(plugin.currentDeviceMemoryGovernanceState.policyStates[
            plugin.memoryGovernanceOpaqueVaultKey
        ].legacyBaseline.autoAcceptPaused).toBe(true);
    });

    it.each([
        ['other-first', ['vault-other', 'current']],
        ['current-first', ['current', 'vault-other']],
    ])('captures Type-A baselines only from the current vault when Profile IDs collide (%s)', async (
        _label,
        insertionOrder,
    ) => {
        const { plugin, repository } = createBootstrapHarness();
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        await plugin.initializeMemoryGovernanceBootstrap();
        const currentVault = plugin.memoryGovernanceOpaqueVaultKey as string;
        await repository.transact((draft) => {
            for (const key of insertionOrder) {
                const vaultKey = key === 'current' ? currentVault : key;
                const suffix = key === 'current' ? 'current' : 'other';
                draft.claims.push({
                    id: `claim-${suffix}`,
                    partition: { kind: 'vault', key: vaultKey },
                    memoryType: 'preference',
                    sensitivity: 'low',
                    applicability: { kind: 'whole_vault' },
                    activeRevisionId: `revision-${suffix}`,
                    effect: 'future_answers',
                    lifecycle: 'active',
                    createdAt,
                    updatedAt: createdAt,
                });
                draft.revisions.push({
                    id: `revision-${suffix}`,
                    claimId: `claim-${suffix}`,
                    summary: `${suffix} vault preference`,
                    provenance: [{
                        kind: 'conversation',
                        conversationIds: [`conversation-${suffix}`],
                        observedAt: createdAt,
                    }],
                    authority: 'explicit_user',
                    createdAt,
                });
                draft.projectionLinks.push({
                    id: `profile-link-${suffix}`,
                    claimId: `claim-${suffix}`,
                    target: { kind: 'type_a_profile', profileRecordId: 'profile-shared' },
                    relation: 'derived_copy',
                    state: 'active',
                    sourceFingerprintId: `source-${suffix}`,
                    ruleFingerprint: 'type-a-admission-v1',
                    createdAt,
                });
            }
        });

        await expect(plugin.captureGovernedTypeAAdmissionBaseline()).resolves.toMatchObject({
            targets: {
                'profile-shared': {
                    state: 'present',
                    claimId: 'claim-current',
                    activeRevisionId: 'revision-current',
                },
            },
        });
    });

    it('routes governed Memory Candidate creation through effect admission instead of the legacy count', async () => {
        const { plugin, repository } = createBootstrapHarness();
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.getPageletLocale = jest.fn(() => 'en');
        await plugin.initializeMemoryGovernanceBootstrap();
        plugin.autoConfirmMemoryCandidateFromQueueItem = jest.fn(() => {
            throw new Error('legacy auto-confirm must not run');
        });

        const result = await plugin.createReviewQueueItem({
            type: 'memory_candidate',
            title: 'Remember preference',
            claim: 'Prefers concise planning notes with evidence.',
            scope: { kind: 'current_note', paths: ['notes/new.md'] },
            sourceRefs: [{ path: 'notes/new.md', sourceId: 'source-new', excerptHash: 'hash-new' }],
            originSurface: 'quick_capture',
            dataBoundarySnapshotId: 'boundary-current',
            admissionReason: 'memory_confirmation_required',
            metadata: { memoryType: 'preference', sensitivity: 'low' },
        });

        expect(result).toMatchObject({
            ok: true,
            value: { status: 'applied' },
        });
        expect(plugin.autoConfirmMemoryCandidateFromQueueItem).not.toHaveBeenCalled();
        const state = await repository.initialize();
        expect(state.policyStates[plugin.memoryGovernanceOpaqueVaultKey].mode).toBe('effect_based');
        expect(state.claims).toEqual(expect.arrayContaining([
            expect.objectContaining({ effect: 'future_answers', lifecycle: 'active' }),
        ]));
        expect(state.changeEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'add' }),
        ]));
        expect(plugin.settings.confirmedMemoryCount).toBe(29);
    });

    it('keeps governed Memory Candidates manual while the Memory master setting is off', async () => {
        const persisted = rawSettings();
        persisted.memoryEnabled = false;
        const { plugin, repository } = createBootstrapHarness(undefined, persisted);
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.getPageletLocale = jest.fn(() => 'en');
        await plugin.initializeMemoryGovernanceBootstrap();
        const before = await repository.initialize();

        const result = await plugin.createReviewQueueItem({
            type: 'memory_candidate',
            title: 'Remember preference',
            claim: 'Prefer a compact release checklist.',
            scope: { kind: 'current_note', paths: ['notes/release.md'] },
            sourceRefs: [{ path: 'notes/release.md', sourceId: 'source-release' }],
            originSurface: 'quick_capture',
            dataBoundarySnapshotId: 'boundary-current',
            admissionReason: 'memory_confirmation_required',
            metadata: { memoryType: 'preference', sensitivity: 'low' },
        });

        expect(result).toMatchObject({
            ok: true,
            value: {
                status: 'suggested',
                metadata: {
                    memorySource: 'notes',
                    memoryScope: 'current_vault',
                    memoryEffect: 'future_answers',
                },
            },
        });
        const after = await repository.initialize();
        expect(after.claims).toEqual(before.claims);
        expect(after.changeEvents).toEqual(before.changeEvents);
    });

    it('invalidates source-bound suppression on note edit or rename and fails closed after deletion', () => {
        const { plugin } = createBootstrapHarness();
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        const input: ReviewQueueCreateInput = {
            type: 'memory_candidate',
            title: 'Remember preference',
            claim: 'Prefer concise release notes.',
            scope: { kind: 'current_note', paths: ['notes/original.md'] },
            sourceRefs: [{
                path: 'notes/original.md',
                sourceId: 'source-stable',
                excerptHash: 'excerpt-v1',
            }],
            originSurface: 'quick_capture',
            dataBoundarySnapshotId: 'boundary-current',
            admissionReason: 'memory_confirmation_required',
            metadata: { memoryType: 'preference', sensitivity: 'low' },
        };
        const original = plugin.buildGovernedMemoryQueueAdmission(input);
        const edited = plugin.buildGovernedMemoryQueueAdmission({
            ...input,
            sourceRefs: [{ ...input.sourceRefs[0], excerptHash: 'excerpt-v2' }],
        });
        const renamed = plugin.buildGovernedMemoryQueueAdmission({
            ...input,
            scope: { kind: 'current_note', paths: ['notes/renamed.md'] },
            sourceRefs: [{ ...input.sourceRefs[0], path: 'notes/renamed.md' }],
        });
        const deleted = plugin.buildGovernedMemoryQueueAdmission({
            ...input,
            sourceRefs: [],
        });
        if (!original.ok || !edited.ok || !renamed.ok || !deleted.ok) {
            throw new Error('governed admission fixture is invalid');
        }

        expect(edited.value.sourceFingerprintId).not.toBe(original.value.sourceFingerprintId);
        expect(renamed.value.sourceFingerprintId).not.toBe(original.value.sourceFingerprintId);
        expect(deleted.value.policy).toMatchObject({
            provenanceValidity: 'invalid',
            sourceBacking: 'unbacked',
            dataBoundary: 'denied',
        });
    });

    it('atomically turns a governed prior-review candidate into an active claim on confirmation', async () => {
        const { plugin, repository } = createBootstrapHarness();
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.getPageletLocale = jest.fn(() => 'en');
        await plugin.initializeMemoryGovernanceBootstrap();

        const created = await plugin.createReviewQueueItem({
            type: 'memory_candidate',
            title: 'Review task constraint',
            claim: 'Keep this release task constraint visible.',
            scope: { kind: 'current_note', paths: ['notes/task.md'] },
            sourceRefs: [{ path: 'notes/task.md', sourceId: 'task-source' }],
            originSurface: 'quick_capture',
            dataBoundarySnapshotId: 'boundary-current',
            admissionReason: 'memory_confirmation_required',
            metadata: { memoryType: 'task_constraint', sensitivity: 'low' },
        });
        expect(created).toMatchObject({ ok: true, value: { status: 'suggested' } });
        if (!created.ok) return;

        await expect(plugin.confirmMemoryCandidateFromQueueItem(created.value)).resolves.toMatchObject({
            ok: true,
        });
        const state = await repository.initialize();
        expect(state.memoryQueueItems.find((item) => item.id === created.value.id)?.status).toBe('applied');
        const link = state.projectionLinks.find((candidate) => (
            candidate.target.kind === 'review_queue' && candidate.target.itemId === created.value.id
        ));
        expect(link).toBeDefined();
        expect(state.claims.find((claim) => claim.id === link?.claimId)).toMatchObject({
            effect: 'stored_not_in_use',
        });
    });

    it('routes control-center lifecycle actions by exact claim IDs and Undo by exact event IDs', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const first = confirmedRecord();
        const target = {
            ...confirmedRecord(),
            id: 'claim-exact-target',
            summary: 'Target summary',
        };
        const deviceTarget = {
            ...confirmedRecord(),
            id: 'claim-device-target',
            summary: 'Device target summary',
        };
        const olderEvent = {
            id: 'event-older',
            claimId: first.id,
            kind: 'correct' as const,
            occurredAt: '2026-07-09T08:00:00.000Z',
            undoAvailable: false,
        };
        const targetEvent = {
            id: 'event-exact-target',
            claimId: target.id,
            kind: 'pause' as const,
            occurredAt: '2026-07-10T08:00:00.000Z',
            undoAvailable: true,
        };
        plugin.getMemoryGovernancePanelState = jest.fn(() => ({
            governanceMode: 'effect_based',
            records: [first, target, deviceTarget],
            recentChanges: [olderEvent, targetEvent],
            totalCount: 2,
        }));
        plugin.pauseGovernedMemory = jest.fn(async () => ({ ok: true, message: 'Paused' }));
        plugin.applyGovernedMemoryDeviceWide = jest.fn(async () => ({ ok: true, message: 'Device scope' }));
        plugin.limitGovernedMemoryToCurrentVault = jest.fn(async () => ({ ok: true, message: 'Vault scope' }));
        plugin.undoGovernedMemoryChange = jest.fn(async () => ({ ok: true, message: 'Undone' }));

        await expect(plugin.runMemoryControlCenterAction(
            'pause_use',
            'claim-exact-target',
        )).resolves.toMatchObject({ ok: true });
        await expect(plugin.runMemoryControlCenterAction(
            'undo_recent_change',
            'event-exact-target',
        )).resolves.toMatchObject({ ok: true });
        await expect(plugin.runMemoryControlCenterAction(
            'apply_device_wide',
            'claim-exact-target',
        )).resolves.toMatchObject({ ok: true });
        await expect(plugin.runMemoryControlCenterAction(
            'limit_to_current_vault',
            'claim-device-target',
        )).resolves.toMatchObject({ ok: true });

        expect(plugin.pauseGovernedMemory).toHaveBeenCalledTimes(1);
        expect(plugin.pauseGovernedMemory).toHaveBeenCalledWith(target);
        expect(plugin.pauseGovernedMemory).not.toHaveBeenCalledWith(first);
        expect(plugin.undoGovernedMemoryChange).toHaveBeenCalledTimes(1);
        expect(plugin.undoGovernedMemoryChange).toHaveBeenCalledWith(targetEvent);
        expect(plugin.undoGovernedMemoryChange).not.toHaveBeenCalledWith(olderEvent);
        expect(plugin.applyGovernedMemoryDeviceWide).toHaveBeenCalledWith(target);
        expect(plugin.limitGovernedMemoryToCurrentVault).toHaveBeenCalledWith(deviceTarget);
    });

    it('requires explicit confirmation and sends an explicit device-wide scope transition', async () => {
        const globalObj = globalThis as typeof globalThis & { __paConfirmDecision?: boolean };
        globalObj.__paConfirmDecision = true;
        try {
            const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            const record = confirmedRecord();
            const changeScope = jest.fn(async (_input: unknown) => ({
                ok: true,
                value: { eventId: 'scope-event' },
            }));
            plugin.app = {};
            plugin.t = jest.fn((key: string) => key);
            plugin.getGovernedMemoryScopeAction = jest.fn(() => 'apply_device_wide');
            plugin.runGovernedMemoryLifecycleAction = jest.fn(async (
                _claimId: string,
                _action: string,
                operation: (coordinator: { changeScope: typeof changeScope }, allowed: boolean) => Promise<unknown>,
            ) => {
                await operation({ changeScope }, true);
                return { ok: true, message: 'Changed' };
            });

            await expect(plugin.applyGovernedMemoryDeviceWide(record)).resolves.toMatchObject({ ok: true });

            expect(plugin.runGovernedMemoryLifecycleAction).toHaveBeenCalledWith(
                record.id,
                'apply_device_wide',
                expect.any(Function),
            );
            expect(changeScope).toHaveBeenCalledWith({
                claimId: record.id,
                applicability: { kind: 'whole_vault' },
                partition: { kind: 'device_collaboration', key: 'device' },
                explicitDeviceScope: true,
                scopeAllowed: true,
                dataBoundaryAllowed: true,
            });
        } finally {
            delete globalObj.__paConfirmDecision;
        }
    });

    it('surfaces Add Undo cleanup as pending, retries in-session, and resumes the durable remove after restart', async () => {
        jest.useFakeTimers();
        try {
            const first = createBootstrapHarness();
            const { plugin, repository } = first;
            plugin.memoryLifecycleMutationTail = Promise.resolve();
            plugin.getPageletLocale = jest.fn(() => 'en');
            plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
            plugin.isGovernedMemoryRevisionAllowed = jest.fn(() => true);
            await plugin.initializeMemoryGovernanceBootstrap();

            const admitted = await plugin.memoryAdmissionCoordinator.admit({
                policy: {
                    origin: 'type_a',
                    memoryType: 'preference',
                    authority: 'explicit_user',
                    persistenceIntent: 'durable',
                    effect: 'future_answers',
                    provenanceValidity: 'valid',
                    sourceBacking: 'source_backed',
                    sensitivity: 'low',
                    scope: 'current_vault',
                    conflict: 'absent',
                    durableTaskConstraint: 'absent',
                    dataBoundary: 'allowed',
                    writeAuthority: 'none',
                    networkAuthority: 'none',
                    externalActionAuthority: 'none',
                    policyCompliance: 'allowed',
                    ephemeralContextEligibility: 'eligible',
                },
                summary: 'Keep replies concise.',
                memoryType: 'preference',
                sensitivity: 'low',
                authority: 'explicit_user',
                effect: 'future_answers',
                applicability: { kind: 'whole_vault' },
                provenance: [{
                    kind: 'conversation',
                    conversationIds: ['conversation-cleanup'],
                    observedAt: new Date().toISOString(),
                }],
                sourceFingerprintId: 'source-cleanup',
                ruleFingerprint: 'type-a-admission-v1',
                admissionKey: 'type-a-profile-cleanup',
                profileRecordId: 'profile-cleanup',
                expectedTargetState: { state: 'absent', profileRecordId: 'profile-cleanup' },
                queueInput: {
                    type: 'memory_candidate',
                    title: 'Review learned preference',
                    claim: 'Keep replies concise.',
                    scope: { kind: 'whole_vault' },
                    sourceRefs: [],
                    originSurface: 'memory',
                    admissionReason: 'memory_confirmation_required',
                    dataBoundarySnapshotId: 'boundary-current',
                },
            });
            expect(admitted).toMatchObject({ ok: true, value: { claimId: expect.any(String) } });
            if (!admitted.ok || !admitted.value.claimId) throw new Error('admission failed');
            await repository.transact((draft) => {
                for (const operation of draft.pendingOperations) {
                    if (operation.kind === 'profile_projection') operation.state = 'applied';
                }
            });

            let removeAttempts = 0;
            plugin.mutateExactProfileRecord = jest.fn(async () => {
                removeAttempts += 1;
                if (removeAttempts === 1) throw new Error('profile unavailable');
            });
            const addEvent = (await repository.initialize()).changeEvents.find((event) => (
                event.claimId === admitted.value.claimId && event.kind === 'add'
            ));
            expect(addEvent).toBeDefined();

            await expect(plugin.undoGovernedMemoryChange({
                id: addEvent!.id,
                claimId: admitted.value.claimId,
                kind: 'add',
                occurredAt: addEvent!.occurredAt,
                undoAvailable: true,
            })).resolves.toEqual({
                ok: false,
                message: 'The change is undone, but cleanup of a linked profile copy is still pending. PA will retry in the background.',
            });
            expect(plugin.memoryProfileProjectionRetryTimer).not.toBeNull();
            expect((await repository.initialize()).pendingOperations).toContainEqual(expect.objectContaining({
                kind: 'profile_projection',
                action: 'remove',
                state: 'pending',
            }));

            await jest.advanceTimersByTimeAsync(1_000);
            await plugin.memoryLifecycleMutationTail;
            expect(removeAttempts).toBe(2);
            expect(plugin.memoryProfileProjectionRetryTimer).toBeNull();
            expect((await repository.initialize()).pendingOperations).toContainEqual(expect.objectContaining({
                kind: 'profile_projection',
                action: 'remove',
                state: 'applied',
            }));

            // Crash-window replay: the external delete may have succeeded before
            // the durable outbox acknowledgement. Restart must safely repeat it.
            await repository.transact((draft) => {
                const removal = draft.pendingOperations.find((operation) => (
                    operation.kind === 'profile_projection' && operation.action === 'remove'
                ));
                if (removal) removal.state = 'pending';
            });
            const restarted = createBootstrapHarness(first.backend);
            restarted.plugin.mutateExactProfileRecord = jest.fn(async () => undefined);
            await restarted.plugin.initializeMemoryGovernanceBootstrap();
            expect(restarted.plugin.mutateExactProfileRecord).toHaveBeenCalledTimes(1);
            expect((await restarted.repository.initialize()).pendingOperations).toContainEqual(expect.objectContaining({
                kind: 'profile_projection',
                action: 'remove',
                state: 'applied',
            }));
        } finally {
            jest.useRealTimers();
        }
    });

    it('retries pending Forget work in-session with one redacted exponential-backoff timer', async () => {
        jest.useFakeTimers();
        const sensitiveError = new Error('private note content /Users/private.md');
        const resumePendingForgets = jest.fn<() => Promise<{
            ok: true;
            value: { completed: string[]; pending: string[] };
        }>>()
            .mockRejectedValueOnce(sensitiveError)
            .mockResolvedValueOnce({
                ok: true,
                value: { completed: [], pending: ['private-claim-id'] },
            })
            .mockResolvedValueOnce({
                ok: true,
                value: { completed: ['private-claim-id'], pending: [] },
            });
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.unloading = false;
        plugin.memoryGovernanceBootstrapState = 'ready';
        plugin.memoryGovernanceCoordinator = { resumePendingForgets };
        plugin.memoryForgetRetryTimer = null;
        plugin.memoryForgetRetryDelayMs = 1_000;
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.readGovernedMemoryActionBoundary = jest.fn(async () => true);
        plugin.governedMemoryActionFailure = jest.fn(() => ({ ok: false, message: 'pending' }));
        plugin.refreshGovernedMemoryActionState = jest.fn(async () => undefined);
        plugin.notifySettingsChanged = jest.fn(async () => undefined);
        plugin.log = jest.fn();

        try {
            await expect(plugin.runGovernedMemoryLifecycleAction(
                'claim-pending',
                'forget',
                async () => ({
                    ok: false,
                    reason: 'projection_cleanup_failed',
                    pending: true,
                }),
            )).resolves.toEqual({ ok: false, message: 'pending' });
            const firstTimer = plugin.memoryForgetRetryTimer;
            expect(firstTimer).not.toBeNull();
            plugin.scheduleMemoryForgetRetry();
            expect(plugin.memoryForgetRetryTimer).toBe(firstTimer);
            expect(jest.getTimerCount()).toBe(1);

            await jest.advanceTimersByTimeAsync(1_000);
            await plugin.memoryLifecycleMutationTail;
            await Promise.resolve();
            expect(resumePendingForgets).toHaveBeenCalledTimes(1);
            expect(plugin.memoryForgetRetryDelayMs).toBe(2_000);
            expect(plugin.memoryForgetRetryTimer).not.toBeNull();
            expect(JSON.stringify(plugin.log.mock.calls)).not.toContain('private note content');
            expect(JSON.stringify(plugin.log.mock.calls)).not.toContain('/Users/private.md');

            await jest.advanceTimersByTimeAsync(2_000);
            await plugin.memoryLifecycleMutationTail;
            expect(resumePendingForgets).toHaveBeenCalledTimes(2);
            expect(plugin.memoryForgetRetryDelayMs).toBe(4_000);
            expect(plugin.memoryForgetRetryTimer).not.toBeNull();
            expect(JSON.stringify(plugin.log.mock.calls)).not.toContain('private-claim-id');

            await jest.advanceTimersByTimeAsync(4_000);
            await plugin.memoryLifecycleMutationTail;
            expect(resumePendingForgets).toHaveBeenCalledTimes(3);
            expect(plugin.memoryForgetRetryTimer).toBeNull();
            expect(plugin.memoryForgetRetryDelayMs).toBe(1_000);
        } finally {
            plugin.cancelMemoryForgetRetry();
            jest.useRealTimers();
        }
    });

    it('schedules a single redacted Forget retry when bootstrap recovery remains pending', async () => {
        jest.useFakeTimers();
        const resumePendingForgets = jest.spyOn(
            MemoryGovernanceCoordinator.prototype,
            'resumePendingForgets',
        ).mockResolvedValue({
            ok: true,
            value: { completed: [], pending: ['private-bootstrap-claim'] },
        });
        let plugin: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
            ({ plugin } = createBootstrapHarness());
            await plugin.initializeMemoryGovernanceBootstrap();

            const firstTimer = plugin.memoryForgetRetryTimer;
            expect(firstTimer).not.toBeNull();
            plugin.scheduleMemoryForgetRetry();
            expect(plugin.memoryForgetRetryTimer).toBe(firstTimer);
            expect(plugin.log).toHaveBeenCalledWith(
                'Memory Forget recovery remains pending',
                { ok: true, pendingCount: 1 },
            );
            expect(JSON.stringify(plugin.log.mock.calls)).not.toContain('private-bootstrap-claim');
        } finally {
            plugin?.cancelMemoryForgetRetry();
            plugin?.cancelMemoryProfileProjectionRetry();
            plugin?.cancelMemoryGovernanceGarbageCollection();
            resumePendingForgets.mockRestore();
            jest.useRealTimers();
        }
    });

    it('resumes pending Forget during bootstrap and keeps failed cleanup retryable without recoverable content', async () => {
        const first = createBootstrapHarness();
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        const initial = await first.repository.initialize();
        const claim = initial.claims.find((candidate) => (
            candidate.partition.kind === 'vault'
            && candidate.partition.key === vaultKey
            && candidate.effect === 'stored_not_in_use'
        ));
        expect(claim).toBeDefined();
        if (!claim?.activeRevisionId) throw new Error('migrated claim is missing its revision');
        const revision = initial.revisions.find((candidate) => candidate.id === claim.activeRevisionId);
        expect(revision).toBeDefined();
        if (!revision) throw new Error('migrated revision is missing');
        const forgottenSummary = revision.summary;
        const forgottenPath = revision.provenance.find((entry) => entry.kind === 'note')?.sourceRef.path;
        const profileRecordId = 'profile-forget-bootstrap';

        await first.repository.transact((draft) => {
            draft.projectionLinks.push({
                id: 'link-profile-forget-bootstrap',
                claimId: claim.id,
                target: { kind: 'type_a_profile', profileRecordId },
                relation: 'derived_copy',
                state: 'active',
                sourceFingerprintId: 'source-forget-bootstrap',
                ruleFingerprint: 'forget-bootstrap-v1',
                createdAt,
            });
        });
        first.plugin.mutateExactProfileRecord = jest.fn(async () => {
            throw new Error('profile cleanup unavailable');
        });

        await expect(first.plugin.memoryGovernanceCoordinator.forget({ claimId: claim.id }))
            .resolves.toEqual({
                ok: false,
                reason: 'projection_cleanup_failed',
                pending: true,
            });
        let state = await first.repository.initialize();
        const interruptedClaim = state.claims.find((candidate) => candidate.id === claim.id);
        expect(interruptedClaim).toMatchObject({ lifecycle: 'forget_pending' });
        expect(interruptedClaim?.activeRevisionId).toBeUndefined();
        expect(state.revisions.some((candidate) => candidate.claimId === claim.id)).toBe(false);
        expect(state.pendingOperations).toContainEqual(expect.objectContaining({
            kind: 'forget',
            claimId: claim.id,
            phase: 'claim_redacted',
            lastErrorCode: 'projection_cleanup_failed',
        }));

        const failedRestart = createBootstrapHarness(first.backend);
        failedRestart.plugin.mutateExactProfileRecord = jest.fn(async () => {
            throw new Error('profile cleanup still unavailable');
        });
        await failedRestart.plugin.initializeMemoryGovernanceBootstrap();

        expect(failedRestart.plugin.memoryGovernanceBootstrapState).toBe('ready');
        state = await failedRestart.repository.initialize();
        const retryable = state.pendingOperations.find((operation) => (
            operation.kind === 'forget' && operation.claimId === claim.id
        ));
        expect(retryable).toMatchObject({
            phase: 'claim_redacted',
            lastErrorCode: 'projection_cleanup_failed',
        });
        expect(retryable?.attemptCount).toBeGreaterThan(0);
        expect(state.claims.find((candidate) => candidate.id === claim.id)?.lifecycle)
            .toBe('forget_pending');
        expect(failedRestart.plugin.log).toHaveBeenCalledWith(
            'Memory Forget recovery remains pending',
            { ok: true, pendingCount: 1 },
        );
        expect(failedRestart.plugin.memoryForgetRetryTimer).not.toBeNull();
        const controlCenter = await failedRestart.plugin.getMemoryControlCenterSnapshot();
        const pendingItem = controlCenter.items.find((item: { claimId?: string }) => item.claimId === claim.id);
        expect(pendingItem).toMatchObject({
            label: '',
            scopeLabel: '',
            effect: 'none',
            lifecycle: 'forget_pending',
            provenance: [],
            supportedActions: ['retry_forget'],
        });
        expect(JSON.stringify(pendingItem)).not.toContain(forgottenSummary);
        if (forgottenPath) expect(JSON.stringify(pendingItem)).not.toContain(forgottenPath);
        failedRestart.plugin.cancelMemoryForgetRetry();

        const successfulRestart = createBootstrapHarness(first.backend);
        successfulRestart.plugin.mutateExactProfileRecord = jest.fn(async () => undefined);
        await successfulRestart.plugin.initializeMemoryGovernanceBootstrap();

        expect(successfulRestart.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect(successfulRestart.plugin.mutateExactProfileRecord).toHaveBeenCalledWith(
            profileRecordId,
            expect.any(Function),
            true,
        );
        const final = await successfulRestart.repository.initialize();
        expect(final.pendingOperations.some((operation) => (
            operation.kind === 'forget' && operation.claimId === claim.id
        ))).toBe(false);
        const forgottenClaim = final.claims.find((candidate) => candidate.id === claim.id);
        expect(forgottenClaim).toMatchObject({
            lifecycle: 'forgotten_tombstone',
            effect: 'stored_not_in_use',
        });
        expect(forgottenClaim?.activeRevisionId).toBeUndefined();
        expect(forgottenClaim?.legacyCompatibility).toBeUndefined();
        expect(final.revisions.some((candidate) => candidate.claimId === claim.id)).toBe(false);
        expect(final.projectionLinks.filter((link) => link.claimId === claim.id))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ state: 'redacted' }),
            ]));
        expect(final.changeEvents).toContainEqual(expect.objectContaining({
            claimId: claim.id,
            kind: 'forget',
        }));
        const persistedAfterForget = successfulRestart.readPersisted();
        expect(persistedAfterForget.memoryGovernance.records).toEqual([]);
        expect(persistedAfterForget.reviewQueue.items).toEqual([]);
        expect(final.migrationStates[vaultKey].sourceHash).toMatch(/^legacy-v1:/);
        expect(final.migrationStates[vaultKey].legacySourceStateHash)
            .toBe(hashLegacyMemoryPayload(captureLegacyMemoryPayload(persistedAfterForget)));
        expect(final.migrationStates[vaultKey].legacySourceStateHash)
            .not.toBe(final.migrationStates[vaultKey].sourceHash);

        const rollback = buildLegacyMemoryRollbackProjection(final, vaultKey);
        expect(rollback).toMatchObject({
            ok: true,
            projection: {
                records: [],
                memoryQueueItems: [],
            },
        });
        const serialized = JSON.stringify({ final, rollback });
        expect(serialized).not.toContain(forgottenSummary);
        if (forgottenPath) expect(serialized).not.toContain(forgottenPath);
    });

    it('bounds a stalled legacy Forget write and finishes bootstrap with retryable pending state', async () => {
        jest.useFakeTimers();
        try {
            const first = createBootstrapHarness();
            await first.plugin.initializeMemoryGovernanceBootstrap();
            const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
            const before = await first.repository.initialize();
            const claim = before.claims.find((candidate) => (
                candidate.partition.kind === 'vault'
                && candidate.partition.key === vaultKey
                && candidate.legacyCompatibility?.recordIdFingerprints.length
            ));
            if (!claim) throw new Error('legacy claim missing');
            const workingProcess = first.plugin.app.vault.adapter.process;
            first.plugin.app.vault.adapter.process = jest.fn((
                path: string,
                mutate: (data: string) => string,
            ) => {
                if (first.plugin.app.vault.adapter.process.mock.calls.length === 1) {
                    return new Promise<string>(() => undefined);
                }
                return workingProcess(path, mutate);
            });

            const forget = first.plugin.memoryGovernanceCoordinator.forget({ claimId: claim.id });
            await jest.advanceTimersByTimeAsync(MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS);
            await expect(forget).resolves.toEqual({
                ok: false,
                reason: 'legacy_compatibility_cleanup_failed',
                pending: true,
            });
            let state = await first.repository.initialize();
            const interruptedClaim = state.claims.find((candidate) => candidate.id === claim.id);
            expect(interruptedClaim).toMatchObject({ lifecycle: 'forget_pending' });
            expect(interruptedClaim?.activeRevisionId).toBeUndefined();
            expect(state.pendingOperations).toContainEqual(expect.objectContaining({
                kind: 'forget',
                claimId: claim.id,
                phase: 'linked_copies_redacted',
                lastErrorCode: 'legacy_compatibility_cleanup_failed',
                legacyCompatibility: expect.objectContaining({ state: 'prepared' }),
            }));
            expect(first.readPersisted().memoryGovernance.records).toHaveLength(1);

            first.plugin.settings.focusMode = true;
            await expect(first.plugin.saveSettings()).resolves.toBeUndefined();
            expect(first.readPersisted().focusMode).toBe(true);

            const restarted = createBootstrapHarness(first.backend, first.readPersisted());
            const restartedWorkingProcess = restarted.plugin.app.vault.adapter.process;
            restarted.plugin.app.vault.adapter.process = jest.fn(
                () => new Promise<string>(() => undefined),
            );
            const bootstrap = restarted.plugin.initializeMemoryGovernanceBootstrap();
            await jest.advanceTimersByTimeAsync(MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS);
            await expect(bootstrap).resolves.toBeUndefined();

            expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
            state = await restarted.repository.initialize();
            expect(state.pendingOperations).toContainEqual(expect.objectContaining({
                kind: 'forget',
                claimId: claim.id,
                lastErrorCode: 'legacy_compatibility_cleanup_failed',
            }));
            expect(restarted.plugin.memoryForgetRetryTimer).not.toBeNull();
            restarted.plugin.cancelMemoryForgetRetry();
            restarted.plugin.app.vault.adapter.process = restartedWorkingProcess;
            await expect(restarted.plugin.memoryGovernanceCoordinator.resumePendingForgets())
                .resolves.toEqual({
                    ok: true,
                    value: { completed: [claim.id], pending: [] },
                });
            expect((await restarted.repository.initialize()).pendingOperations).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    it('fails Forget closed when an exact legacy origin points to a malformed raw Memory queue item', async () => {
        const persisted = rawSettings();
        const privateRawQueueContent = 'Private malformed legacy queue content.';
        (persisted.reviewQueue as { enabled: boolean; items: unknown[] }).items = [{
            id: 'legacy-memory-queue',
            type: 'memory_candidate',
            claim: privateRawQueueContent,
        }];
        const harness = createBootstrapHarness(undefined, persisted);
        await harness.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = harness.plugin.memoryGovernanceOpaqueVaultKey as string;
        const before = await harness.repository.initialize();
        const claim = before.claims.find((candidate) => (
            candidate.partition.kind === 'vault'
            && candidate.partition.key === vaultKey
            && candidate.legacyCompatibility?.recordIdFingerprints.length
        ));
        if (!claim) throw new Error('legacy claim missing');
        expect(claim.legacyCompatibility?.memoryQueueItemIdFingerprints).toHaveLength(1);

        await expect(harness.plugin.memoryGovernanceCoordinator.forget({ claimId: claim.id }))
            .resolves.toEqual({
                ok: false,
                reason: 'legacy_compatibility_prepare_failed',
                pending: true,
            });

        const interrupted = await harness.repository.initialize();
        expect(interrupted.claims.find((candidate) => candidate.id === claim.id))
            .toMatchObject({ lifecycle: 'forget_pending' });
        expect(interrupted.pendingOperations).toContainEqual(expect.objectContaining({
            kind: 'forget',
            claimId: claim.id,
            phase: 'linked_copies_redacted',
            legacyCompatibility: expect.objectContaining({ state: 'pending' }),
            lastErrorCode: 'legacy_compatibility_prepare_failed',
        }));
        expect(harness.readPersisted().memoryGovernance.records)
            .toEqual([expect.objectContaining({ id: 'legacy-memory' })]);
        expect(harness.readPersisted().reviewQueue.items)
            .toEqual([expect.objectContaining({
                id: 'legacy-memory-queue',
                claim: privateRawQueueContent,
            })]);
    });

    it('recovers a prepared Forget after raw cleanup succeeds before the IDB acknowledgement', async () => {
        const first = createBootstrapHarness();
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        const initial = await first.repository.initialize();
        const claim = initial.claims.find((candidate) => (
            candidate.partition.kind === 'vault'
            && candidate.partition.key === vaultKey
            && candidate.legacyCompatibility?.recordIdFingerprints.length
        ));
        expect(claim).toBeDefined();
        if (!claim) throw new Error('legacy claim missing');

        const originalTransact = first.repository.transact.bind(first.repository);
        let failAcknowledgement = true;
        first.repository.transact = (async <T>(
            mutate: (draft: DeviceMemoryGovernanceStateV1) => T | Promise<T>,
        ) => originalTransact(async (draft) => {
            const preparedBefore = draft.pendingOperations.some((operation) => (
                operation.kind === 'forget'
                && operation.claimId === claim.id
                && operation.legacyCompatibility?.state === 'prepared'
            ));
            const result = await mutate(draft);
            const doneAfter = draft.pendingOperations.some((operation) => (
                operation.kind === 'forget'
                && operation.claimId === claim.id
                && operation.legacyCompatibility?.state === 'done'
            ));
            if (failAcknowledgement && preparedBefore && doneAfter) {
                failAcknowledgement = false;
                throw new Error('simulated crash after data.json process');
            }
            return result;
        })) as typeof first.repository.transact;

        await expect(first.plugin.memoryGovernanceCoordinator.forget({ claimId: claim.id }))
            .rejects.toThrow('simulated crash after data.json process');
        const interrupted = await originalTransact((draft) => {
            const operation = draft.pendingOperations.find((candidate) => (
                candidate.kind === 'forget' && candidate.claimId === claim.id
            ));
            return operation ? JSON.parse(JSON.stringify(operation)) : null;
        });
        expect(interrupted).toMatchObject({
            phase: 'linked_copies_redacted',
            legacyCompatibility: {
                state: 'prepared',
                expectedSourceHash: expect.stringMatching(/^legacy-v1:/),
                resultingSourceHash: expect.stringMatching(/^legacy-v1:/),
            },
        });
        expect(first.readPersisted().memoryGovernance.records).toEqual([]);

        const restarted = createBootstrapHarness(first.backend, first.readPersisted());
        await restarted.plugin.initializeMemoryGovernanceBootstrap();
        const recovered = await restarted.repository.initialize();
        expect(recovered.pendingOperations.some((operation) => (
            operation.kind === 'forget' && operation.claimId === claim.id
        ))).toBe(false);
        const recoveredClaim = recovered.claims.find((candidate) => candidate.id === claim.id);
        expect(recoveredClaim).toMatchObject({ lifecycle: 'forgotten_tombstone' });
        expect(recoveredClaim?.legacyCompatibility).toBeUndefined();
        expect(restarted.readPersisted().memoryGovernance.records).toEqual([]);
        expect(recovered.migrationStates[vaultKey].legacySourceStateHash)
            .toBe(hashLegacyMemoryPayload(captureLegacyMemoryPayload(restarted.readPersisted())));
    });

    it('prevents a stale compatibility barrier in another window from restoring forgotten raw data', async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const initial = rawSettings();
        let shared = JSON.parse(JSON.stringify(initial));
        let processTail = Promise.resolve();
        const first = createBootstrapHarness(backend, initial);
        const second = createBootstrapHarness(backend, initial);
        const wireSharedData = (harness: ReturnType<typeof createBootstrapHarness>) => {
            harness.plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(shared)));
            harness.plugin.saveData = jest.fn(async (next: unknown) => {
                shared = JSON.parse(JSON.stringify(next));
            });
            const adapter = harness.plugin.app.vault.adapter;
            adapter.read = jest.fn(async () => JSON.stringify(shared));
            adapter.process = jest.fn(async (_path: string, mutate: (data: string) => string) => {
                let written = '';
                const run = processTail.then(() => {
                    written = mutate(JSON.stringify(shared));
                    shared = JSON.parse(written);
                });
                processTail = run.then(() => undefined, () => undefined);
                await run;
                return written;
            });
        };
        wireSharedData(first);
        wireSharedData(second);
        await first.plugin.initializeMemoryGovernanceBootstrap();
        await second.plugin.initializeMemoryGovernanceBootstrap();
        await expect(second.plugin.getReviewQueueStore().create(nonMemoryQueueInput()))
            .resolves.toMatchObject({ ok: true });
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        const claim = (await first.repository.initialize()).claims.find((candidate) => (
            candidate.partition.kind === 'vault'
            && candidate.partition.key === vaultKey
            && candidate.legacyCompatibility?.recordIdFingerprints.length
        ));
        if (!claim) throw new Error('legacy claim missing');

        await expect(first.plugin.memoryGovernanceCoordinator.forget({ claimId: claim.id }))
            .resolves.toMatchObject({ ok: true });
        expect(shared.memoryGovernance.records).toEqual([]);

        first.plugin.settings.focusMode = true;
        await first.plugin.saveSettings();
        expect(shared.memoryGovernance.records).toEqual([]);
        expect(shared.reviewQueue.items).toEqual([
            expect.objectContaining({ type: 'evidence_insight' }),
        ]);
        expect(shared.focusMode).toBe(true);
    });

    it('forgets an exact legacy entity on a pending external source without deleting unrelated data', async () => {
        const first = createBootstrapHarness();
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        const importedSourceHash = (await first.repository.initialize())
            .migrationStates[vaultKey].sourceHash;
        const changed = first.readPersisted();
        const externalRecord = {
            ...confirmedRecord(),
            id: 'external-device-memory',
            summary: 'Keep this unrelated external Memory.',
        };
        delete externalRecord.originReviewQueueItemId;
        changed.memoryGovernance.records.push(externalRecord);

        const restarted = createBootstrapHarness(first.backend, changed);
        await restarted.plugin.initializeMemoryGovernanceBootstrap();
        const before = await restarted.repository.initialize();
        expect(before.migrationStates[vaultKey]).toMatchObject({
            sourceHash: importedSourceHash,
            legacySourceStateHash: importedSourceHash,
            pendingLegacySourceHash: expect.stringMatching(/^legacy-v1:/),
        });
        const claim = before.claims.find((candidate) => (
            candidate.partition.kind === 'vault'
            && candidate.partition.key === vaultKey
            && candidate.legacyCompatibility?.recordIdFingerprints.length
        ));
        if (!claim) throw new Error('legacy claim missing');

        await expect(restarted.plugin.memoryGovernanceCoordinator.forget({ claimId: claim.id }))
            .resolves.toMatchObject({ ok: true });

        const persisted = restarted.readPersisted();
        expect(persisted.memoryGovernance.records).toEqual([
            expect.objectContaining({ id: 'external-device-memory' }),
        ]);
        expect(persisted.reviewQueue.items).toEqual([]);
        const after = await restarted.repository.initialize();
        expect(after.migrationStates[vaultKey].sourceHash).toBe(importedSourceHash);
        expect(after.migrationStates[vaultKey].legacySourceStateHash).toBe(importedSourceHash);
        expect(after.migrationStates[vaultKey].pendingLegacySourceHash)
            .toBe(hashLegacyMemoryPayload(captureLegacyMemoryPayload(persisted)));
    });

    it('replans when legacy source changes at commit and again before pending refresh', async () => {
        const harness = createBootstrapHarness();
        await harness.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = harness.plugin.memoryGovernanceOpaqueVaultKey as string;
        const before = await harness.repository.initialize();
        const importedSourceHash = before.migrationStates[vaultKey].sourceHash;
        const claim = before.claims.find((candidate) => (
            candidate.partition.kind === 'vault'
            && candidate.partition.key === vaultKey
            && candidate.legacyCompatibility?.recordIdFingerprints.length
        ));
        if (!claim) throw new Error('legacy claim missing');
        const externalRecord = {
            ...confirmedRecord(),
            id: 'external-between-prepare-and-commit',
            summary: 'Keep this concurrently synced Memory.',
        };
        delete externalRecord.originReviewQueueItemId;
        const secondExternalRecord = {
            ...confirmedRecord(),
            id: 'external-after-commit-readback',
            summary: 'Keep this later concurrently synced Memory.',
        };
        delete secondExternalRecord.originReviewQueueItemId;
        const processMock = harness.plugin.app.vault.adapter.process as jest.Mock;
        const processCountBeforeForget = processMock.mock.calls.length;
        harness.beforeNextProcess(() => {
            const changed = harness.readPersisted();
            changed.memoryGovernance.records.push(externalRecord);
            harness.writePersisted(changed);
        });
        type LegacyCommit = NonNullable<
            ExactMemoryProjectionCleanupPort['commitLegacyCompatibilityForget']
        >;
        const originalCommit = harness.plugin.commitLegacyCompatibilityForget.bind(
            harness.plugin,
        ) as LegacyCommit;
        let changedAfterCommitReadback = false;
        harness.plugin.commitLegacyCompatibilityForget = jest.fn(async (
            input: Parameters<LegacyCommit>[0],
        ) => {
            const result = await originalCommit(input);
            if (!changedAfterCommitReadback && !result.ok) {
                changedAfterCommitReadback = true;
                const changed = harness.readPersisted();
                changed.memoryGovernance.records.push(secondExternalRecord);
                harness.writePersisted(changed);
            }
            return result;
        });

        await expect(harness.plugin.memoryGovernanceCoordinator.forget({ claimId: claim.id }))
            .resolves.toMatchObject({ ok: true, value: { claimId: claim.id } });

        expect(changedAfterCommitReadback).toBe(true);
        const persisted = harness.readPersisted();
        expect(persisted.memoryGovernance.records).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: externalRecord.id }),
            expect.objectContaining({ id: secondExternalRecord.id }),
        ]));
        expect(persisted.memoryGovernance.records).toHaveLength(2);
        expect(persisted.reviewQueue.items).toEqual([]);
        expect(processMock).toHaveBeenCalledTimes(processCountBeforeForget + 2);
        const after = await harness.repository.initialize();
        expect(after.pendingOperations.filter((operation) => operation.kind === 'forget'))
            .toEqual([]);
        expect(after.claims.find((candidate) => candidate.id === claim.id))
            .toMatchObject({ lifecycle: 'forgotten_tombstone' });
        expect(after.migrationStates[vaultKey].sourceHash).toBe(importedSourceHash);
        expect(after.migrationStates[vaultKey].legacySourceStateHash).toBe(importedSourceHash);
        expect(after.migrationStates[vaultKey].pendingLegacySourceHash)
            .toBe(hashLegacyMemoryPayload(captureLegacyMemoryPayload(persisted)));
    });

    it('serializes concurrent exact Forget writes from two windows without losing either deletion', async () => {
        const initial = rawSettings();
        const secondQueue = {
            ...legacyMemoryQueueItem(),
            id: 'legacy-memory-queue-2',
            title: 'Remember second preference',
            claim: 'Prefer evidence tables.',
        };
        const secondRecord = {
            ...confirmedRecord(),
            id: 'legacy-memory-2',
            summary: 'Prefers evidence tables.',
            originReviewQueueItemId: secondQueue.id,
        };
        initial.reviewQueue.items.push(secondQueue);
        initial.memoryGovernance.records.push(secondRecord);
        const backend = new InMemoryMemoryGovernanceBackend();
        let shared = JSON.parse(JSON.stringify(initial));
        let processTail = Promise.resolve();
        const first = createBootstrapHarness(backend, initial);
        const second = createBootstrapHarness(backend, initial);
        const wireSharedData = (harness: ReturnType<typeof createBootstrapHarness>) => {
            harness.plugin.loadData = jest.fn(async () => JSON.parse(JSON.stringify(shared)));
            harness.plugin.saveData = jest.fn(async (next: unknown) => {
                shared = JSON.parse(JSON.stringify(next));
            });
            const adapter = harness.plugin.app.vault.adapter;
            adapter.read = jest.fn(async () => JSON.stringify(shared));
            adapter.process = jest.fn(async (_path: string, mutate: (data: string) => string) => {
                let written = '';
                const run = processTail.then(() => {
                    written = mutate(JSON.stringify(shared));
                    shared = JSON.parse(written);
                });
                processTail = run.then(() => undefined, () => undefined);
                await run;
                return written;
            });
        };
        wireSharedData(first);
        wireSharedData(second);
        await first.plugin.initializeMemoryGovernanceBootstrap();
        await second.plugin.initializeMemoryGovernanceBootstrap();
        const state = await first.repository.initialize();
        const claimIdForSummary = (summary: string) => state.claims.find((claim) => (
            state.revisions.some((revision) => (
                revision.id === claim.activeRevisionId && revision.summary === summary
            ))
        ))?.id;
        const firstClaimId = claimIdForSummary('Prefers concise planning notes.');
        const secondClaimId = claimIdForSummary('Prefers evidence tables.');
        if (!firstClaimId || !secondClaimId) throw new Error('legacy claims missing');

        await Promise.allSettled([
            first.plugin.memoryGovernanceCoordinator.forget({ claimId: firstClaimId }),
            second.plugin.memoryGovernanceCoordinator.forget({ claimId: secondClaimId }),
        ]);
        await first.plugin.memoryGovernanceCoordinator.resumePendingForgets();
        await second.plugin.memoryGovernanceCoordinator.resumePendingForgets();

        const final = await first.repository.initialize();
        expect(final.pendingOperations.filter((operation) => operation.kind === 'forget')).toEqual([]);
        expect(final.claims.filter((claim) => (
            claim.id === firstClaimId || claim.id === secondClaimId
        )).map((claim) => claim.lifecycle)).toEqual([
            'forgotten_tombstone',
            'forgotten_tombstone',
        ]);
        expect(shared.memoryGovernance.records).toEqual([]);
        expect(shared.reviewQueue.items).toEqual([]);
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        expect(final.migrationStates[vaultKey].legacySourceStateHash)
            .toBe(hashLegacyMemoryPayload(captureLegacyMemoryPayload(shared)));
    });

    it('retries an exact pending Forget from the canonical control-center action', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.memoryGovernanceOpaqueVaultKey = 'vault-current';
        plugin.deviceMemoryGovernanceRepository = {
            initialize: jest.fn(async () => ({
                pendingOperations: [{
                    kind: 'forget',
                    claimId: 'claim-pending',
                    partition: { kind: 'vault', key: 'vault-current' },
                }],
            })),
        };
        plugin.memoryGovernanceCoordinator = {
            resumePendingForgets: jest.fn(async () => ({
                ok: true,
                value: { completed: ['claim-pending'], pending: [] },
            })),
        };
        plugin.refreshGovernedMemoryActionState = jest.fn(async () => undefined);
        plugin.notifySettingsChanged = jest.fn(async () => undefined);
        plugin.t = jest.fn((key: string) => key);

        await expect(plugin.runMemoryControlCenterAction(
            'retry_forget',
            'claim-pending',
        )).resolves.toEqual({
            ok: true,
            message: 'plugin.settings.memoryControlCenter.pendingForget.retryComplete',
        });
        expect(plugin.memoryGovernanceCoordinator.resumePendingForgets).toHaveBeenCalledTimes(1);
        expect(plugin.refreshGovernedMemoryActionState).toHaveBeenCalledTimes(1);
    });

    it('keeps a manual Forget retry scheduled when exact cleanup is still pending', async () => {
        jest.useFakeTimers();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.unloading = false;
        plugin.memoryGovernanceBootstrapState = 'ready';
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.memoryGovernanceOpaqueVaultKey = 'vault-current';
        plugin.memoryForgetRetryTimer = null;
        plugin.memoryForgetRetryDelayMs = 1_000;
        plugin.deviceMemoryGovernanceRepository = {
            initialize: jest.fn(async () => ({
                pendingOperations: [{
                    kind: 'forget',
                    claimId: 'claim-pending',
                    partition: { kind: 'vault', key: 'vault-current' },
                }],
            })),
        };
        plugin.memoryGovernanceCoordinator = {
            resumePendingForgets: jest.fn(async () => ({
                ok: true,
                value: { completed: [], pending: ['claim-pending'] },
            })),
        };
        plugin.refreshGovernedMemoryActionState = jest.fn(async () => undefined);
        plugin.notifySettingsChanged = jest.fn(async () => undefined);
        plugin.t = jest.fn((key: string) => key);
        plugin.log = jest.fn();

        try {
            await expect(plugin.runMemoryControlCenterAction(
                'retry_forget',
                'claim-pending',
            )).resolves.toEqual({
                ok: false,
                message: 'plugin.settings.memoryControlCenter.pendingForget.retryPending',
            });
            expect(plugin.memoryForgetRetryTimer).not.toBeNull();
            expect(jest.getTimerCount()).toBe(1);
        } finally {
            plugin.cancelMemoryForgetRetry();
            jest.useRealTimers();
        }
    });

    it('clears only current-vault prevention markers and leaves other partitions intact', async () => {
        const { plugin, repository } = createBootstrapHarness();
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.t = jest.fn((key: string, params?: { count?: number }) => (
            params?.count === undefined ? key : `${key}:${params.count}`
        ));
        await plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
        await repository.transact((draft) => {
            draft.suppressionMarkers.push({
                id: 'marker-current',
                partition: { kind: 'vault', key: vaultKey },
                sourceFingerprintId: 'source-current',
                ruleFingerprint: 'rule-current',
                reason: 'forgotten',
                createdAt,
                updatedAt: createdAt,
            }, {
                id: 'marker-other',
                partition: { kind: 'vault', key: 'vault-other' },
                sourceFingerprintId: 'source-other',
                ruleFingerprint: 'rule-other',
                reason: 'rejected',
                createdAt,
                updatedAt: createdAt,
            }, {
                id: 'marker-device',
                partition: { kind: 'device_collaboration', key: 'device' },
                sourceFingerprintId: 'source-device',
                ruleFingerprint: 'rule-device',
                reason: 'corrected',
                createdAt,
                updatedAt: createdAt,
            });
        });
        await plugin.refreshDeviceMemoryCaches();
        expect(plugin.getMemorySuppressionMarkerCount()).toBe(1);

        await expect(plugin.clearMemorySuppressionMarkers()).resolves.toEqual({
            ok: true,
            message: 'plugin.settings.memoryControlCenter.dataRecovery.prevention.done:1',
            clearedCount: 1,
        });
        expect((await repository.initialize()).suppressionMarkers.map((marker) => marker.id))
            .toEqual(['marker-other', 'marker-device']);
    });

    it('keeps prevention markers referenced by a pending Forget operation', async () => {
        const state = {
            suppressionMarkers: [{
                id: 'marker-clearable',
                partition: { kind: 'vault', key: 'vault-current' },
            }, {
                id: 'marker-protected',
                partition: { kind: 'vault', key: 'vault-current' },
            }],
            pendingOperations: [{
                kind: 'forget',
                suppressionMarkerIds: ['marker-protected'],
            }],
        };
        const repository = {
            transact: jest.fn(async (mutate: (draft: typeof state) => void) => {
                mutate(state);
                return undefined;
            }),
        };
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.memoryGovernanceOpaqueVaultKey = 'vault-current';
        plugin.deviceMemoryGovernanceRepository = repository;
        plugin.getGovernedMemoryProjectionSnapshot = jest.fn(() => ({
            state,
            vaultScopeKey: 'vault-current',
        }));
        plugin.refreshGovernedMemoryActionState = jest.fn(async () => undefined);
        plugin.notifySettingsChanged = jest.fn(async () => undefined);
        plugin.t = jest.fn((key: string, params?: { count?: number }) => (
            params?.count === undefined ? key : `${key}:${params.count}`
        ));

        expect(plugin.getMemorySuppressionMarkerCount()).toBe(1);
        await expect(plugin.clearMemorySuppressionMarkers()).resolves.toMatchObject({
            ok: true,
            clearedCount: 1,
        });
        expect(state.suppressionMarkers).toEqual([
            expect.objectContaining({ id: 'marker-protected' }),
        ]);
    });

    it('injects only eligible governed context and removes it immediately after Pause use', async () => {
        const { plugin } = createBootstrapHarness();
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.settings.memoryExtractionEnabled = true;
        plugin.settings.memoryExtractionConsent = { state: 'confirmed', version: 1 };
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.isGovernedMemoryRevisionAllowed = jest.fn(() => true);
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        plugin.getGovernedMemoryCurrentScope = jest.fn(() => ({
            notePath: 'notes/new.md',
            folderPath: 'notes',
            tags: [],
        }));
        plugin.getPageletLocale = jest.fn(() => 'en');
        await plugin.initializeMemoryGovernanceBootstrap();
        plugin.memoryExtractionScheduler = {
            dispose: jest.fn(),
            getPromptContext: jest.fn(() => ({ userProfile: 'LEGACY PROFILE MUST NOT RETURN' })),
        };

        const created = await plugin.createReviewQueueItem({
            type: 'memory_candidate',
            title: 'Remember preference',
            claim: 'Use concise evidence lists for this note.',
            scope: { kind: 'current_note', paths: ['notes/new.md'] },
            sourceRefs: [{ path: 'notes/new.md', sourceId: 'source-prompt' }],
            originSurface: 'quick_capture',
            dataBoundarySnapshotId: 'boundary-current',
            admissionReason: 'memory_confirmation_required',
            metadata: { memoryType: 'preference', sensitivity: 'low' },
        });
        expect(created).toMatchObject({ ok: true, value: { status: 'applied' } });

        const beforePause = plugin.getMemoryExtractionPromptContext();
        expect(beforePause).toMatchObject({ memoryContextMode: 'governed' });
        expect(beforePause.governedMemoryContext).toContain('Use concise evidence lists for this note.');
        expect(beforePause.governedMemoryTrace).toEqual([expect.objectContaining({
            effect: 'future_answers',
            source: 'notes',
            scope: 'current_vault',
            sourcePaths: ['notes/new.md'],
        })]);
        expect(JSON.stringify(beforePause)).not.toContain('LEGACY PROFILE MUST NOT RETURN');
        expect(JSON.stringify(beforePause)).not.toContain('Prefers concise planning notes.');

        for (const disabled of [
            { memoryEnabled: false, memoryExtractionEnabled: true, memoryExtractionConsent: { state: 'confirmed', version: 1 } },
            { memoryEnabled: true, memoryExtractionEnabled: false, memoryExtractionConsent: { state: 'confirmed', version: 1 } },
            { memoryEnabled: true, memoryExtractionEnabled: true, memoryExtractionConsent: { state: 'unconfirmed', version: 1 } },
        ]) {
            Object.assign(plugin.settings, disabled);
            expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
        }
        Object.assign(plugin.settings, {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        });

        const record = plugin.getMemoryGovernancePanelState().records.find(
            (candidate: ConfirmedMemoryRecord) => candidate.summary === 'Use concise evidence lists for this note.',
        );
        expect(record).toBeDefined();
        await expect(plugin.pauseGovernedMemory(record)).resolves.toMatchObject({ ok: true });
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
    });

    it.each([
        ['Memory master switch', { memoryEnabled: false }],
        ['Memory extraction switch', { memoryExtractionEnabled: false }],
        ['Memory consent', { memoryExtractionConsent: { state: 'paused', version: 1 } }],
    ])('shows governed Memory as saved but unused when the %s gate is off', async (_label, disabled) => {
        const { plugin, record } = await createGovernedUseGateHarness();
        Object.assign(plugin.settings, disabled);

        const snapshot = await plugin.getMemoryControlCenterSnapshot();
        const item = snapshot.items.find((candidate: { claimId?: string }) => (
            candidate.claimId === record.id
        ));

        expect(item).toMatchObject({
            effect: 'stored_not_in_use',
            lifecycle: 'active',
            supportedActions: ['correct', 'pause_use', 'forget'],
        });
        const pageletRecord = plugin.getMemoryGovernancePanelState().records.find(
            (candidate: { id: string }) => candidate.id === record.id,
        );
        expect(pageletRecord).toMatchObject({
            effect: 'stored_not_in_use',
            useStatus: 'stored_not_in_use',
            durableUseStatus: 'active',
            actionPolicy: {
                correct: true,
                pause: true,
                resume: false,
                forget: true,
            },
        });
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
        await expect(plugin.pauseGovernedMemory(record)).resolves.toMatchObject({
            ok: true,
            record: {
                lifecycle: 'archived',
                effect: 'stored_not_in_use',
                useStatus: 'paused',
                durableUseStatus: 'paused',
                actionPolicy: {
                    correct: true,
                    pause: true,
                    resume: false,
                    forget: true,
                },
            },
        });
    });

    it('does not offer Resume use while a global governed-use gate is off', async () => {
        const { plugin, record } = await createGovernedUseGateHarness();
        await expect(plugin.pauseGovernedMemory(record)).resolves.toMatchObject({ ok: true });
        plugin.settings.memoryEnabled = false;

        const snapshot = await plugin.getMemoryControlCenterSnapshot();
        const item = snapshot.items.find((candidate: { claimId?: string }) => (
            candidate.claimId === record.id
        ));

        expect(item).toMatchObject({
            effect: 'stored_not_in_use',
            lifecycle: 'paused',
            supportedActions: ['correct', 'forget'],
        });
        expect(plugin.getMemoryGovernancePanelState().records.find(
            (candidate: { id: string }) => candidate.id === record.id,
        )).toMatchObject({
            effect: 'stored_not_in_use',
            useStatus: 'paused',
            durableUseStatus: 'paused',
            actionPolicy: expect.objectContaining({ resume: false }),
        });
    });

    it('fails the control-center use projection closed when a source leaves Data Boundary', async () => {
        const { plugin, record, isPathAllowed } = await createGovernedUseGateHarness();
        isPathAllowed.mockReturnValue(false);

        const snapshot = await plugin.getMemoryControlCenterSnapshot();
        const item = snapshot.items.find((candidate: { claimId?: string }) => (
            candidate.claimId === record.id
        ));

        expect(item).toMatchObject({
            effect: 'stored_not_in_use',
            lifecycle: 'active',
            supportedActions: ['pause_use', 'forget'],
        });
        expect(plugin.getMemoryGovernancePanelState().records.find(
            (candidate: { id: string }) => candidate.id === record.id,
        )).toMatchObject({
            effect: 'stored_not_in_use',
            useStatus: 'stored_not_in_use',
            durableUseStatus: 'active',
            actionPolicy: {
                correct: false,
                pause: true,
                resume: false,
                forget: true,
            },
        });
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
    });

    it('projects a pending Profile operation as unused in Settings, Pagelet, and prompt context', async () => {
        const { plugin, repository, record } = await createGovernedUseGateHarness();
        const state = await repository.initialize();
        const claim = state.claims.find((candidate) => candidate.id === record.id);
        if (!claim?.activeRevisionId) throw new Error('governed claim revision missing');
        await repository.transact((draft) => {
            draft.pendingOperations.push({
                id: 'profile-projection-pending-use-gate',
                kind: 'profile_projection',
                action: 'upsert',
                claimId: claim.id,
                profileRecordId: 'profile-pending-use-gate',
                targetRevisionId: claim.activeRevisionId!,
                state: 'pending',
                attemptCount: 1,
                createdAt,
                updatedAt: createdAt,
            });
        });
        await plugin.refreshDeviceMemoryCaches();

        const snapshot = await plugin.getMemoryControlCenterSnapshot();
        expect(snapshot.items.find((candidate: { claimId?: string }) => (
            candidate.claimId === record.id
        ))).toMatchObject({
            effect: 'stored_not_in_use',
            lifecycle: 'active',
            supportedActions: [],
        });
        expect(plugin.getMemoryGovernancePanelState().records.find(
            (candidate: { id: string }) => candidate.id === record.id,
        )).toMatchObject({
            effect: 'stored_not_in_use',
            useStatus: 'stored_not_in_use',
            durableUseStatus: 'active',
            actionPolicy: {
                correct: false,
                pause: false,
                resume: false,
                forget: false,
            },
        });
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
    });

    it('retries a pending Type-A claim operation without advancing the durable cursor', async () => {
        const { plugin, repository } = createBootstrapHarness();
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        await plugin.initializeMemoryGovernanceBootstrap();
        const baseline = await plugin.captureGovernedTypeAAdmissionBaseline();
        plugin.memoryAdmissionCoordinator = {
            admit: jest.fn(async () => ({ ok: false, reason: 'claim_operation_pending' })),
        };
        const proposed: UserProfileSnapshot = {
            updatedAt: createdAt,
            records: [{
                profileRecordId: 'profile-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                key: 'review-style',
                text: 'Please review changes with evidence first.',
                kind: 'user_explicit',
                confidence: 'high',
                conversationId: 'conversation-pending',
                observedAt: createdAt,
                occurrences: 1,
                conversationIds: ['conversation-pending'],
                confirmed: true,
            }],
            markdown: '# User Profile',
        };

        await expect(plugin.admitGovernedTypeABatch({
            current: null,
            proposed,
            baseline,
            evidence: { conversationId: 'conversation-pending', throughTurnIndex: 4 },
            candidates: [{
                key: 'review-style',
                text: 'Please review changes with evidence first.',
                kind: 'user_explicit',
                confidence: 'high',
                conversationId: 'conversation-pending',
                observedAt: createdAt,
            }],
        })).resolves.toEqual({ status: 'retry' });

        const state = await repository.initialize();
        expect(state.policyStates[plugin.memoryGovernanceOpaqueVaultKey].typeAProcessedTurns)
            .toBeUndefined();
    });

    it('recreates a missing Profile row from durable conversation evidence during bootstrap recovery', async () => {
        const first = createBootstrapHarness();
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const vaultKey = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        await first.repository.transact((draft) => {
            draft.policyStates[vaultKey].contextProjectionMode = 'governed';
            draft.claims.push({
                id: 'claim-profile-recovery',
                partition: { kind: 'vault', key: vaultKey },
                memoryType: 'preference',
                sensitivity: 'low',
                applicability: { kind: 'whole_vault' },
                activeRevisionId: 'revision-profile-recovery',
                effect: 'future_answers',
                lifecycle: 'active',
                createdAt,
                updatedAt: createdAt,
            });
            draft.revisions.push({
                id: 'revision-profile-recovery',
                claimId: 'claim-profile-recovery',
                summary: 'Use evidence-first reviews.',
                provenance: [{
                    kind: 'conversation',
                    conversationIds: ['conversation-recovery'],
                    observedAt: createdAt,
                }],
                authority: 'explicit_user',
                createdAt,
            });
            draft.projectionLinks.push({
                id: 'link-profile-recovery',
                claimId: 'claim-profile-recovery',
                target: {
                    kind: 'type_a_profile',
                    profileRecordId: 'profile-cccccccccccccccccccccccccccccccc',
                },
                relation: 'origin',
                state: 'active',
                sourceFingerprintId: 'source-profile-recovery',
                ruleFingerprint: 'type-a-v1',
                createdAt,
            });
            draft.pendingOperations.push({
                id: 'operation-profile-recovery',
                kind: 'profile_projection',
                claimId: 'claim-profile-recovery',
                profileRecordId: 'profile-cccccccccccccccccccccccccccccccc',
                targetRevisionId: 'revision-profile-recovery',
                state: 'pending',
                attemptCount: 0,
                createdAt,
                updatedAt: createdAt,
            });
        });

        const restarted = createBootstrapHarness(first.backend);
        let profile: UserProfileSnapshot | null = null;
        restarted.plugin.memoryExtractionScheduler = {
            dispose: jest.fn(),
            mutateUserProfile: jest.fn(async (
                operation: (current: UserProfileSnapshot | null) => UserProfileSnapshot,
            ) => {
                profile = operation(profile);
                return JSON.parse(JSON.stringify(profile));
            }),
        };

        await restarted.plugin.initializeMemoryGovernanceBootstrap();

        expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect((profile as UserProfileSnapshot | null)?.records).toEqual([
            expect.objectContaining({
                profileRecordId: 'profile-cccccccccccccccccccccccccccccccc',
                text: 'Use evidence-first reviews.',
                conversationIds: ['conversation-recovery'],
                confirmed: true,
            }),
        ]);
        expect((await restarted.repository.initialize()).pendingOperations).toContainEqual(
            expect.objectContaining({
                id: 'operation-profile-recovery',
                state: 'applied',
            }),
        );
    });

    it('upserts a new governed Type-A Profile projection from authoritative conversation evidence', async () => {
        const { plugin, repository } = createBootstrapHarness();
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        await plugin.initializeMemoryGovernanceBootstrap();
        let profile: UserProfileSnapshot | null = null;
        plugin.memoryExtractionScheduler = {
            dispose: jest.fn(),
            mutateUserProfile: jest.fn(async (operation: (current: UserProfileSnapshot | null) => UserProfileSnapshot) => {
                profile = await operation(profile);
                return JSON.parse(JSON.stringify(profile));
            }),
            getUserProfileSnapshot: jest.fn(() => profile ? JSON.parse(JSON.stringify(profile)) : null),
        };
        const record = {
            profileRecordId: 'profile-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            key: 'answer-structure',
            text: 'Please always answer with bullet points.',
            kind: 'user_explicit' as const,
            confidence: 'high' as const,
            conversationId: 'conversation-new',
            observedAt: createdAt,
            occurrences: 1,
            conversationIds: ['conversation-new'],
            confirmed: true,
        };
        const proposed: UserProfileSnapshot = {
            updatedAt: createdAt,
            records: [record],
            markdown: '# User Profile',
        };
        const baseline = await plugin.captureGovernedTypeAAdmissionBaseline();

        await expect(plugin.admitGovernedTypeABatch({
            current: null,
            proposed,
            baseline,
            evidence: { conversationId: 'conversation-new', throughTurnIndex: 1 },
            candidates: [{
                key: record.key,
                text: record.text,
                kind: record.kind,
                confidence: record.confidence,
                conversationId: record.conversationId,
                observedAt: record.observedAt,
            }],
        })).resolves.toEqual({ status: 'processed' });
        expect((profile as UserProfileSnapshot | null)?.records).toEqual([
            expect.objectContaining({
                profileRecordId: record.profileRecordId,
                conversationIds: ['conversation-new'],
                confirmed: true,
            }),
        ]);
        const state = await repository.initialize();
        expect(state.pendingOperations).toContainEqual(expect.objectContaining({
            kind: 'profile_projection',
            profileRecordId: record.profileRecordId,
            state: 'applied',
        }));
        expect(Object.values(state.policyStates[plugin.memoryGovernanceOpaqueVaultKey].typeAProcessedTurns ?? {}))
            .toEqual([1]);

        const staleBaseline = await plugin.captureGovernedTypeAAdmissionBaseline();
        const staleCurrent = JSON.parse(JSON.stringify(profile)) as UserProfileSnapshot;
        const governedRecord = plugin.getMemoryGovernancePanelState().records[0];
        await expect(plugin.correctGovernedMemory(
            governedRecord,
            'Always answer with a short conclusion first.',
        )).resolves.toMatchObject({ ok: true });
        const staleProposed: UserProfileSnapshot = {
            ...staleCurrent,
            records: [{
                ...staleCurrent.records[0],
                text: 'Old in-flight extraction must not win.',
            }],
        };
        await expect(plugin.admitGovernedTypeABatch({
            current: staleCurrent,
            proposed: staleProposed,
            baseline: staleBaseline,
            evidence: { conversationId: 'conversation-new', throughTurnIndex: 2 },
            candidates: [{
                key: record.key,
                text: 'Old in-flight extraction must not win.',
                kind: record.kind,
                confidence: record.confidence,
                conversationId: record.conversationId,
                observedAt: record.observedAt,
            }],
        })).resolves.toEqual({ status: 'processed' });
        const afterStale = await repository.initialize();
        const governedClaimId = afterStale.projectionLinks.find((link) => (
            link.target.kind === 'type_a_profile'
            && link.target.profileRecordId === record.profileRecordId
            && link.state === 'active'
        ))?.claimId;
        const governedClaim = afterStale.claims.find((claim) => claim.id === governedClaimId);
        const activeRevision = afterStale.revisions.find(
            (revision) => revision.id === governedClaim?.activeRevisionId,
        );
        expect(activeRevision?.summary).toBe('Always answer with a short conclusion first.');
        expect(JSON.stringify(afterStale.revisions)).not.toContain('Old in-flight extraction must not win.');
        expect((profile as UserProfileSnapshot | null)?.records[0].text)
            .toBe('Always answer with a short conclusion first.');
    });

    it('garbage-collects seven-day undo and rollback recovery data without a restart', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const { plugin, repository } = createBootstrapHarness();
        try {
            await plugin.initializeMemoryGovernanceBootstrap();
            const created = await plugin.createReviewQueueItem({
                type: 'memory_candidate',
                title: 'Remember preference',
                claim: 'Use concise evidence lists for this note.',
                scope: { kind: 'current_note', paths: ['notes/new.md'] },
                sourceRefs: [{ path: 'notes/new.md', sourceId: 'source-gc' }],
                originSurface: 'quick_capture',
                dataBoundarySnapshotId: plugin.getMemoryDataBoundaryFingerprint(),
                admissionReason: 'memory_confirmation_required',
                metadata: { memoryType: 'preference', sensitivity: 'low' },
            });
            expect(created).toMatchObject({ ok: true, value: { status: 'applied' } });
            const record = plugin.getMemoryGovernancePanelState().records.find(
                (candidate: ConfirmedMemoryRecord) => (
                    candidate.summary === 'Use concise evidence lists for this note.'
                ),
            );
            expect(record).toBeDefined();
            await expect(plugin.pauseGovernedMemory(record)).resolves.toMatchObject({ ok: true });

            const before = await repository.initialize();
            const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
            expect(before.undoSnapshots).toHaveLength(1);
            expect(before.rollbackPayloadEntries.length).toBeGreaterThan(0);
            expect(before.migrationStates[vaultKey].rollbackExpiresAt)
                .toBe('2026-01-08T00:00:00.000Z');
            expect(plugin.memoryGovernanceGarbageCollectionTimer).not.toBeNull();

            await jest.advanceTimersByTimeAsync(7 * 24 * 60 * 60_000 + 2);
            await plugin.memoryLifecycleMutationTail;

            const after = await repository.initialize();
            expect(after.undoSnapshots).toEqual([]);
            expect(after.changeEvents).toEqual([]);
            expect(after.rollbackPayloadEntries).toEqual([]);
            expect(after.migrationDeltas).toEqual([]);
            expect(after.migrationStates[vaultKey].rollbackExpiresAt).toBeUndefined();
            expect(plugin.memoryGovernanceGarbageCollectionTimer).toBeNull();
        } finally {
            plugin.cancelMemoryGovernanceGarbageCollection();
            jest.useRealTimers();
        }
    });

    it('garbage-collects completed history on schedule without any undo or rollback deadline', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const { plugin, repository } = createBootstrapHarness();
        try {
            await plugin.initializeMemoryGovernanceBootstrap();
            const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
            await repository.transact((draft) => {
                const migration = draft.migrationStates[vaultKey];
                const runId = migration.migrationRunId;
                migration.phase = 'finalized';
                delete migration.rollbackExpiresAt;
                delete migration.lastAppliedDeltaSequence;
                delete migration.lastErrorCode;
                delete migration.legacySourceStateHash;
                delete migration.pendingLegacySourceHash;
                draft.rollbackPayloadEntries = draft.rollbackPayloadEntries
                    .filter((entry) => entry.migrationRunId !== runId);
                draft.migrationDeltas = draft.migrationDeltas
                    .filter((delta) => delta.migrationRunId !== runId);
                for (const claim of draft.claims) delete claim.legacyCompatibility;
                const claim = draft.claims[0];
                draft.changeEvents.push({
                    id: 'completed-history-event',
                    claimId: claim.id,
                    kind: 'pause',
                    scopeKey: vaultKey,
                    effect: 'future_answers',
                    occurredAt: '2026-01-01T00:00:00.000Z',
                });
                draft.pendingOperations.push({
                    id: 'completed-profile-outbox',
                    kind: 'profile_projection',
                    action: 'upsert',
                    claimId: claim.id,
                    profileRecordId: 'profile-completed-history',
                    targetRevisionId: claim.activeRevisionId!,
                    state: 'applied',
                    attemptCount: 1,
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                });
            });
            await plugin.refreshDeviceMemoryCaches();

            expect(plugin.memoryGovernanceGarbageCollectionTimer).not.toBeNull();
            await jest.advanceTimersByTimeAsync(7 * 24 * 60 * 60_000 + 2);
            await plugin.memoryLifecycleMutationTail;

            const after = await repository.initialize();
            expect(after.changeEvents.some((event) => event.id === 'completed-history-event'))
                .toBe(false);
            expect(after.pendingOperations.some((operation) => (
                operation.kind === 'profile_projection'
                && operation.id === 'completed-profile-outbox'
            ))).toBe(false);
            expect(plugin.memoryGovernanceGarbageCollectionTimer).toBeNull();
        } finally {
            plugin.cancelMemoryGovernanceGarbageCollection();
            jest.useRealTimers();
        }
    });

    it('schedules retained Undo ancestry at the descendant deadline without a one-minute GC loop', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-10T00:00:00.000Z'));
        const { plugin, repository } = createBootstrapHarness();
        try {
            await plugin.initializeMemoryGovernanceBootstrap();
            const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
            await repository.transact((draft) => {
                const migration = draft.migrationStates[vaultKey];
                const runId = migration.migrationRunId;
                migration.phase = 'finalized';
                delete migration.rollbackExpiresAt;
                delete migration.lastAppliedDeltaSequence;
                delete migration.lastErrorCode;
                delete migration.legacySourceStateHash;
                delete migration.pendingLegacySourceHash;
                draft.rollbackPayloadEntries = draft.rollbackPayloadEntries
                    .filter((entry) => entry.migrationRunId !== runId);
                draft.migrationDeltas = draft.migrationDeltas
                    .filter((delta) => delta.migrationRunId !== runId);
                for (const claim of draft.claims) delete claim.legacyCompatibility;
                const claim = draft.claims[0];
                draft.changeEvents.push({
                    id: 'old-original-event',
                    claimId: claim.id,
                    kind: 'pause',
                    scopeKey: vaultKey,
                    effect: 'future_answers',
                    occurredAt: '2026-01-01T00:00:00.000Z',
                }, {
                    id: 'recent-undo-event',
                    claimId: claim.id,
                    kind: 'undo',
                    scopeKey: vaultKey,
                    effect: 'future_answers',
                    occurredAt: '2026-01-09T00:00:00.000Z',
                    undoesEventId: 'old-original-event',
                });
            });
            if (plugin.deviceMemoryCacheRefreshPromise) await plugin.deviceMemoryCacheRefreshPromise;
            await plugin.refreshDeviceMemoryCaches();

            expect(plugin.memoryGovernanceGarbageCollectionDueAt)
                .toBe(Date.parse('2026-01-16T00:00:00.000Z') + 1);
            const beforeSequence = (await repository.initialize()).commitSequence;
            await jest.advanceTimersByTimeAsync(60_001);
            expect((await repository.initialize()).commitSequence).toBe(beforeSequence);

            await jest.advanceTimersByTimeAsync(6 * 24 * 60 * 60_000 - 60_000 + 2);
            await plugin.memoryLifecycleMutationTail;
            const after = await repository.initialize();
            expect(after.changeEvents.some((event) => (
                event.id === 'old-original-event' || event.id === 'recent-undo-event'
            ))).toBe(false);
            expect(plugin.memoryGovernanceGarbageCollectionTimer).toBeNull();
        } finally {
            plugin.cancelMemoryGovernanceGarbageCollection();
            jest.useRealTimers();
        }
    });

    it('disposes adapters, subscriptions, and the device repository on unload', async () => {
        jest.useFakeTimers();
        const { plugin, repository } = createBootstrapHarness();
        try {
            await plugin.initializeMemoryGovernanceBootstrap();
            const disposeRepository = jest.spyOn(repository, 'dispose');
            const disposeAdapter = jest.spyOn(plugin.deviceMemoryRecordRepository, 'dispose');
            const unsubscribe = jest.fn();
            plugin.memoryGovernanceRepositoryUnsubscribe?.();
            plugin.memoryGovernanceRepositoryUnsubscribe = unsubscribe;
            plugin.phase3Handle = null;
            plugin.debouncedStatusBarUpdate = { cancel: jest.fn() };
            plugin.resizeDebounceTimer = null;
            plugin.hoverPopoverObserver = null;
            plugin.memoryManager = null;
            plugin.vss = null;
            plugin.statsManager = undefined;
            plugin.chatHistoryStore = undefined;
            plugin.memoryExtractionScheduler = null;
            plugin.pageletSettingsUnsubscribe = null;
            plugin.pageletOrchestrator = null;
            plugin.pageletRuntime = null;
            plugin.scheduleMemoryForgetRetry();
            plugin.memoryForgetRetryDelayMs = 4_000;

            expect(plugin.memoryForgetRetryTimer).not.toBeNull();
            expect(plugin.memoryGovernanceGarbageCollectionTimer).not.toBeNull();

            await plugin.unloadAsync();

            expect(unsubscribe).toHaveBeenCalledTimes(1);
            expect(disposeAdapter).toHaveBeenCalledTimes(1);
            expect(disposeRepository).toHaveBeenCalledTimes(1);
            expect(plugin.memoryForgetRetryTimer).toBeNull();
            expect(plugin.memoryForgetRetryDelayMs).toBe(1_000);
            expect(plugin.memoryGovernanceGarbageCollectionTimer).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('Quiet Recall user-safe feedback', () => {
    const candidate: QuietRecallCandidate = {
        id: 'quiet-recall-safe-feedback',
        title: 'Related note',
        summary: 'A related note may matter now.',
        sourceRefs: [{ path: 'notes/related.md', evidenceStrength: 'medium' }],
        whyNow: ['Related to the current note.'],
        nextAction: 'Compare the notes.',
        relation: 'related',
        score: 80,
        generatedAt: '2026-07-10T08:00:00.000Z',
    };

    it('does not expose internal link failure codes', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            vault: { getAbstractFileByPath: jest.fn(() => null) },
        };
        plugin.getPageletLocale = jest.fn(() => 'en');

        const result = await plugin.linkRecallCandidate('notes/current.md', 'notes/related.md');

        expect(result).toEqual({
            ok: false,
            message: 'One of these notes is no longer available. Open the notes and try again.',
        });
        expect(result.message).not.toContain('file-not-found');
    });

    it('previews both note paths and writes nothing when linking is cancelled', async () => {
        const MockTFile = TFile as unknown as new (path: string) => TFile;
        const currentFile = new MockTFile('notes/current.md');
        const relatedFile = new MockTFile('notes/related.md');
        const processFrontMatter = jest.fn();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            vault: {
                getAbstractFileByPath: jest.fn((path: string) => (
                    path === currentFile.path ? currentFile : path === relatedFile.path ? relatedFile : null
                )),
            },
            fileManager: { processFrontMatter },
        };
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        jest.mocked(confirmUserAction).mockClear();

        const result = await plugin.linkRecallCandidate(currentFile.path, relatedFile.path);

        expect(result).toEqual({ ok: false, message: 'No links were added.' });
        expect(processFrontMatter).not.toHaveBeenCalled();
        expect(confirmUserAction).toHaveBeenCalledWith(plugin.app, expect.objectContaining({
            title: 'Link these two notes?',
            confirmText: 'Link notes',
            message: expect.stringMatching(/notes\/current\.md[\s\S]*notes\/related\.md[\s\S]*Properties[\s\S]*bodies will stay unchanged/),
        }));
    });

    it('rejects a normalized self-link before confirmation or frontmatter writes', async () => {
        const getAbstractFileByPath = jest.fn();
        const processFrontMatter = jest.fn();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            vault: { getAbstractFileByPath },
            fileManager: { processFrontMatter },
        };
        plugin.getPageletLocale = jest.fn(() => 'zh');
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        jest.mocked(confirmUserAction).mockClear();

        const result = await plugin.linkRecallCandidate('notes/current.md', './notes/current.md');

        expect(result).toEqual({
            ok: false,
            message: '这条回忆暂时没有另一篇可关联的笔记。',
        });
        expect(getAbstractFileByPath).not.toHaveBeenCalled();
        expect(confirmUserAction).not.toHaveBeenCalled();
        expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it('uses calm Chinese property copy while keeping the exact pa-related key', async () => {
        const MockTFile = TFile as unknown as new (path: string) => TFile;
        const currentFile = new MockTFile('notes/current.md');
        const relatedFile = new MockTFile('notes/related.md');
        const processFrontMatter = jest.fn();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            vault: {
                getAbstractFileByPath: jest.fn((path: string) => (
                    path === currentFile.path ? currentFile : path === relatedFile.path ? relatedFile : null
                )),
            },
            fileManager: { processFrontMatter },
        };
        plugin.getPageletLocale = jest.fn(() => 'zh');
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        jest.mocked(confirmUserAction).mockClear();

        await plugin.linkRecallCandidate(currentFile.path, relatedFile.path);

        const options = jest.mocked(confirmUserAction).mock.calls[0]?.[1];
        expect(options?.message).toContain('两篇笔记的属性');
        expect(options?.message).toContain('pa-related');
        expect(options?.message).not.toContain('Properties');
        expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it('adds bidirectional Properties only after link confirmation', async () => {
        const globalObj = globalThis as typeof globalThis & { __paConfirmDecision?: boolean };
        globalObj.__paConfirmDecision = true;
        try {
            const MockTFile = TFile as unknown as new (path: string) => TFile;
            const currentFile = new MockTFile('notes/current.md');
            const relatedFile = new MockTFile('notes/related.md');
            const frontmatters = new Map<string, Record<string, unknown>>();
            const processFrontMatter = jest.fn(async (
                file: TFile,
                update: (frontmatter: Record<string, unknown>) => void,
            ) => {
                const frontmatter = frontmatters.get(file.path) ?? {};
                update(frontmatter);
                frontmatters.set(file.path, frontmatter);
            });
            const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            plugin.app = {
                vault: {
                    getAbstractFileByPath: jest.fn((path: string) => (
                        path === currentFile.path ? currentFile : path === relatedFile.path ? relatedFile : null
                    )),
                },
                fileManager: { processFrontMatter },
            };
            plugin.getPageletLocale = jest.fn(() => 'en');
            plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
            plugin.recordQuietRecallFeedback = jest.fn(async () => undefined);

            const result = await plugin.linkRecallCandidate(currentFile.path, relatedFile.path);

            expect(result).toEqual({ ok: true, message: 'Linked' });
            expect(processFrontMatter).toHaveBeenCalledTimes(2);
            expect(frontmatters.get(currentFile.path)).toEqual({
                'pa-related': ['[[notes/related.md]]'],
            });
            expect(frontmatters.get(relatedFile.path)).toEqual({
                'pa-related': ['[[notes/current.md]]'],
            });
        } finally {
            delete globalObj.__paConfirmDecision;
        }
    });

    it('does not expose Saved Insight persistence reasons', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { quietRecall: { enabled: true } };
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.getSavedInsightStore = jest.fn(() => ({
            create: jest.fn(async () => ({ ok: false, reason: 'private_internal_store_reason' })),
        }));

        const result = await plugin.saveQuietRecallAsInsight(candidate);

        expect(result).toMatchObject({
            ok: false,
            reason: 'private_internal_store_reason',
            message: 'Could not save this recall as an insight. Try again.',
        });
        expect(result.message).not.toContain('private_internal_store_reason');
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
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
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
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
            showAdvancedMemoryControls: false,
        };
        plugin.getAISetupIssue = jest.fn(() => 'Choose your AI provider');
        plugin.addCommand = jest.fn();

        plugin.registerAdvancedMemoryCommands();
        const command = getRegisteredCommand(plugin, 'show-ai-insights');

        expect(command?.checkCallback(true)).toBe(false);
    });

    it.each([
        { memoryEnabled: false, memoryExtractionEnabled: true, memoryExtractionConsent: { state: 'confirmed', version: 1 } },
        { memoryEnabled: true, memoryExtractionEnabled: false, memoryExtractionConsent: { state: 'confirmed', version: 1 } },
        { memoryEnabled: true, memoryExtractionEnabled: true, memoryExtractionConsent: { state: 'unconfirmed', version: 1 } },
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
        plugin.settings = {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        };
        plugin.getAISetupIssue = jest.fn(() => null);
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
        plugin.settings = {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        };
        plugin.getAISetupIssue = jest.fn(() => null);
        plugin.getMemoryGovernanceUiMode = jest.fn(() => 'legacy_threshold');
        plugin.getMemoryExtractionPromptContext = jest.fn(() => ({
            userProfile: '# Prompt Profile',
            vaultInsights: '# Prompt Summary',
        }));
        plugin.openMemorySettings = jest.fn();
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
        findModalNodeByText(
            mockOpenedModals.at(-1)!.contentEl,
            'Open Memory and personalization',
        )?.dispatchEvent?.('click');
        expect(plugin.openMemorySettings).toHaveBeenCalledWith(undefined);
    });

    it('routes an AI Insights understanding trace to the exact Settings claim after reopen', () => {
        mockOpenedModals.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {};
        plugin.settings = {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        };
        plugin.getAISetupIssue = jest.fn(() => null);
        plugin.log = jest.fn();
        plugin.getMemoryGovernanceUiMode = jest.fn(() => 'effect_based');
        plugin.memoryExtractionScheduler = {
            getInsightsViewerContext: jest.fn(() => ({
                userProfile: '# User Profile\n- Prefers concise plans',
            })),
        };
        plugin.getAiInsightsMemoryTargets = jest.fn(() => [{
            claimId: 'claim-insights-exact',
            summary: 'Prefers concise plans',
            effect: 'future_answers',
        }]);
        plugin.openMemorySettings = jest.fn();

        plugin.showAiInsights();
        let modal = mockOpenedModals.at(-1)!;
        let texts = collectModalTexts(modal.contentEl);
        expect(texts).toEqual(expect.arrayContaining([
            'Understanding used by PA',
            'Prefers concise plans',
            expect.stringContaining('From your interactions'),
        ]));
        findModalNodeByText(
            modal.contentEl,
            'Review in Memory and personalization',
        )?.dispatchEvent?.('click');
        expect(plugin.openMemorySettings).toHaveBeenLastCalledWith('claim-insights-exact');
        expect(modal.contentEl.children).toEqual([]);

        plugin.showAiInsights();
        modal = mockOpenedModals.at(-1)!;
        texts = collectModalTexts(modal.contentEl);
        expect(texts).toContain('Understanding used by PA');
        findModalNodeByText(
            modal.contentEl,
            'Review in Memory and personalization',
        )?.dispatchEvent?.('click');
        expect(plugin.openMemorySettings).toHaveBeenCalledTimes(2);
        expect(plugin.openMemorySettings).toHaveBeenLastCalledWith('claim-insights-exact');
    });

    it('hides stale raw Profile markdown while effect-based Forget is pending', () => {
        mockOpenedModals.length = 0;
        const renderMock = MarkdownRenderer.render as unknown as jest.Mock;
        renderMock.mockClear();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {};
        plugin.settings = {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        };
        plugin.getAISetupIssue = jest.fn(() => null);
        plugin.getMemoryGovernanceUiMode = jest.fn(() => 'effect_based');
        plugin.getAiInsightsMemoryTargets = jest.fn(() => []);
        plugin.memoryExtractionScheduler = {
            getInsightsViewerContext: jest.fn(() => ({
                userProfile: '# PRIVATE STALE PROFILE\n- forgotten preference',
            })),
        };

        plugin.showAiInsights();

        expect(renderMock).not.toHaveBeenCalledWith(
            plugin.app,
            expect.stringContaining('PRIVATE STALE PROFILE'),
            expect.anything(),
            '',
            expect.anything(),
        );
        expect(JSON.stringify(collectModalTexts(mockOpenedModals.at(-1)!.contentEl)))
            .not.toContain('PRIVATE STALE PROFILE');
        expect(collectModalTexts(mockOpenedModals.at(-1)!.contentEl)).toEqual(
            expect.arrayContaining([expect.stringContaining('No insights available yet')]),
        );
    });

    it('derives AI Insights targets only from active governed Profile links', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.getGovernedMemoryViewSnapshot = jest.fn(() => ({
            records: [
                {
                    claimId: 'profile-claim',
                    record: { lifecycle: 'active', summary: 'Profile understanding' },
                    effect: 'future_answers',
                    useStatus: 'active',
                    projectionLinks: [{
                        state: 'active',
                        target: { kind: 'type_a_profile', profileRecordId: 'profile-record' },
                    }],
                },
                {
                    claimId: 'confirmed-only',
                    record: { lifecycle: 'active', summary: 'Confirmed only' },
                    effect: 'future_answers',
                    useStatus: 'active',
                    projectionLinks: [],
                },
                {
                    claimId: 'forgotten-profile',
                    record: { lifecycle: 'forgotten_tombstone', summary: '' },
                    effect: 'none',
                    useStatus: 'stored_not_in_use',
                    projectionLinks: [{
                        state: 'redacted',
                        target: { kind: 'type_a_profile', profileRecordId: 'forgotten-record' },
                    }],
                },
                {
                    claimId: 'paused-profile',
                    record: { lifecycle: 'archived', summary: 'Paused understanding' },
                    effect: 'future_answers',
                    useStatus: 'paused',
                    projectionLinks: [{
                        state: 'active',
                        target: { kind: 'type_a_profile', profileRecordId: 'paused-record' },
                    }],
                },
            ],
        }));

        expect(plugin.getAiInsightsMemoryTargets()).toEqual([{
            claimId: 'profile-claim',
            summary: 'Profile understanding',
            effect: 'future_answers',
        }]);
    });
});

describe('Vault Insights onboarding notice', () => {
    it('fires once on first trigger and stores the localStorage flag', () => {
        mockNoticeMessages.length = 0;
        const { storage, restore } = installMockWindowLocalStorage();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            memoryExtractionIncludeVaultInsights: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        };
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
        plugin.settings = {
            memoryExtractionIncludeVaultInsights: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        };
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
        plugin.settings = {
            memoryExtractionIncludeVaultInsights: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        };
        plugin.log = jest.fn();

        try {
            plugin.surfaceVaultInsightsInjectionNotice();

            expect(mockNoticeMessages).toEqual([]);
            expect(storage.setItem).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    it('does not fire before Memory Extraction first-use confirmation', () => {
        mockNoticeMessages.length = 0;
        const { storage, restore } = installMockWindowLocalStorage();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            memoryExtractionIncludeVaultInsights: true,
            memoryExtractionConsent: { state: 'unconfirmed', version: 1 },
        };
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
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionIncludeVaultInsights: true,
            memoryExtractionNoticeDismissed: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
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

    it('does not start Type-A extraction while the Memory master setting is off', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            memoryEnabled: false,
            memoryExtractionEnabled: true,
            memoryExtractionIncludeVaultInsights: true,
            memoryExtractionNoticeDismissed: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        };
        plugin.chatHistoryManager = {
            findConversation: jest.fn(),
            getTurns: jest.fn(),
        };
        plugin.memoryExtractionScheduler = null;

        plugin.syncMemoryExtractionRuntime();

        expect(plugin.memoryExtractionScheduler).toBeNull();
    });

    it('rejects an in-flight Type-A batch after the Memory master setting turns off', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { memoryEnabled: false };
        plugin.memoryAdmissionCoordinator = { admit: jest.fn() };

        await expect(plugin.admitGovernedTypeABatch({})).resolves.toEqual({ status: 'retry' });
        expect(plugin.memoryAdmissionCoordinator.admit).not.toHaveBeenCalled();
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

describe('Quick Capture service lifecycle', () => {
    function createQuickCapturePlugin() {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {};
        plugin.settings = {
            targetPath: 'Daily',
            fileFormat: 'YYYY-MM-DD',
            quickCapture: {
                enabled: true,
                destination: 'inbox',
                inboxPath: 'Inbox/Quick Capture.md',
                postProcessingEnabled: false,
                postProcessingDisclosureAccepted: false,
            },
        };
        plugin.quickCaptureDraft = '';
        plugin.log = jest.fn();
        return plugin;
    }

    it('reuses one service so separate modals share the same append queue', () => {
        const plugin = createQuickCapturePlugin();

        const first = plugin.createQuickCaptureService();
        const second = plugin.createQuickCaptureService();

        expect(second).toBe(first);
    });

    it('keeps the shared service when Pagelet runtime is torn down', () => {
        const plugin = createQuickCapturePlugin();
        const first = plugin.createQuickCaptureService();

        plugin.destroyPageletRuntime();

        expect(plugin.createQuickCaptureService()).toBe(first);
    });
});

describe('Pagelet Memory auto-confirm pipeline', () => {
    function createMemoryQueueInput(memoryType = 'preference', sensitivity = 'low'): ReviewQueueCreateInput {
        return {
            type: 'memory_candidate',
            title: 'Remember preference',
            claim: 'Prefers concise planning notes.',
            scope: { kind: 'current_note', paths: ['notes/current.md'], label: 'Current note' },
            sourceRefs: [{
                path: 'notes/current.md',
                excerptHash: 'abc123',
                whyShown: ['Quick Capture suggested it'],
                evidenceStrength: 'strong',
            }],
            originSurface: 'quick_capture',
            dataBoundarySnapshotId: 'boundary-test',
            admissionReason: 'memory_confirmation_required',
            whyShown: ['May help later'],
            metadata: {
                memoryType,
                sensitivity,
            },
        };
    }

    function createMemoryPlugin(confirmedMemoryCount: number) {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            reviewQueue: {
                enabled: true,
                items: [],
            },
            memoryGovernance: {
                records: [],
            },
            memoryEnabled: true,
            confirmedMemoryCount,
            memoryAutoAcceptPaused: false,
        };
        plugin.reviewQueueStore = null;
        plugin.memoryGovernanceStore = null;
        plugin.savedInsightStore = null;
        plugin.settingsSaveTail = null;
        plugin.saveData = jest.fn(async () => undefined);
        plugin.saveSettings = jest.fn(async () => undefined);
        plugin.log = jest.fn();
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.getMemoryGovernanceUiMode = jest.fn(() => 'legacy_threshold');
        return plugin;
    }

    it('auto-confirms eligible Memory candidates at Level 2 when they are created', async () => {
        const plugin = createMemoryPlugin(30);

        const result = await plugin.createReviewQueueItem(createMemoryQueueInput());

        expect(result).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'applied' }),
        });
        expect(plugin.settings.memoryGovernance.records).toEqual([
            expect.objectContaining({
                summary: 'Prefers concise planning notes.',
                confirmationStrength: 'auto',
                confirmationSource: 'pagelet',
                originReviewQueueItemId: expect.any(String),
            }),
        ]);
        expect(plugin.settings.confirmedMemoryCount).toBe(31);
        expect(plugin.settings.reviewQueue.items[0]).toMatchObject({
            type: 'memory_candidate',
            status: 'applied',
        });
        expect(plugin.settings.memoryGovernance.records[0].originReviewQueueItemId)
            .toBe(plugin.settings.reviewQueue.items[0].id);
    });

    it('keeps new Level 2 candidates manual while automatic Memory is paused', async () => {
        const plugin = createMemoryPlugin(30);
        plugin.settings.memoryAutoAcceptPaused = true;

        const result = await plugin.createReviewQueueItem(createMemoryQueueInput());

        expect(result).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'suggested' }),
        });
        expect(plugin.settings.memoryGovernance.records).toEqual([]);
        expect(plugin.settings.confirmedMemoryCount).toBe(30);
    });

    it('keeps new Level 2 candidates manual while the Memory master setting is off', async () => {
        const plugin = createMemoryPlugin(30);
        plugin.settings.memoryEnabled = false;

        const result = await plugin.createReviewQueueItem(createMemoryQueueInput());

        expect(result).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'suggested' }),
        });
        expect(plugin.settings.memoryGovernance.records).toEqual([]);
        expect(plugin.settings.confirmedMemoryCount).toBe(30);
    });

    it('fails closed on a malformed persisted confirmation count and restarts manual counting at one', async () => {
        const plugin = createMemoryPlugin(0);
        plugin.settings.confirmedMemoryCount = '30';

        const created = await plugin.createReviewQueueItem(createMemoryQueueInput());

        expect(created).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'suggested' }),
        });
        expect(plugin.settings.memoryGovernance.records).toEqual([]);
        if (!created.ok) return;

        await plugin.confirmMemoryCandidateFromQueueItem(created.value);

        expect(plugin.settings.confirmedMemoryCount).toBe(1);
        expect(plugin.settings.reviewQueue.items[0]).toMatchObject({ status: 'applied' });
    });

    it('keeps medium-sensitivity candidates manual at Level 2', async () => {
        const plugin = createMemoryPlugin(30);

        const result = await plugin.createReviewQueueItem(createMemoryQueueInput('preference', 'medium'));

        expect(result).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'suggested' }),
        });
        expect(plugin.settings.memoryGovernance.records).toEqual([]);
        expect(plugin.settings.confirmedMemoryCount).toBe(30);
    });

    it('forgets the canonical Memory record and marks linked queue history undone', async () => {
        const plugin = createMemoryPlugin(30);
        await plugin.createReviewQueueItem(createMemoryQueueInput());
        const record = plugin.settings.memoryGovernance.records[0];

        const result = await plugin.forgetConfirmedMemory(record);

        expect(result).toMatchObject({
            ok: true,
            message: 'Forgotten',
            record: expect.objectContaining({ lifecycle: 'forgotten_tombstone' }),
        });
        expect(plugin.settings.memoryGovernance.records).toEqual([
            expect.objectContaining({
                id: record.id,
                lifecycle: 'forgotten_tombstone',
                summary: '',
                sourceRefs: [],
                originReviewQueueItemId: plugin.settings.reviewQueue.items[0].id,
            }),
        ]);
        expect(plugin.settings.reviewQueue.items[0]).toMatchObject({ status: 'undone' });
    });

    it('forgets an unlinked legacy Memory without guessing a queue item', async () => {
        const plugin = createMemoryPlugin(0);
        plugin.settings.memoryGovernance.records = [{
            id: 'mem-legacy',
            type: 'preference',
            lifecycle: 'active',
            sensitivity: 'low',
            summary: 'Legacy memory.',
            sourceRefs: [{ path: 'notes/legacy.md', evidenceStrength: 'strong' }],
            scope: { kind: 'current_note', paths: ['notes/legacy.md'] },
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
        }];
        plugin.memoryGovernanceStore = null;

        const result = await plugin.forgetConfirmedMemory(plugin.settings.memoryGovernance.records[0]);

        expect(result).toMatchObject({
            ok: true,
            message: 'Forgotten',
            record: expect.objectContaining({ lifecycle: 'forgotten_tombstone' }),
        });
        expect(plugin.settings.memoryGovernance.records[0]).toMatchObject({
            lifecycle: 'forgotten_tombstone',
            summary: '',
            sourceRefs: [],
        });
        expect(plugin.settings.reviewQueue.items).toEqual([]);
    });

    it('retries a linked tombstone audit after the queue write fails, even when Review Queue is disabled', async () => {
        const plugin = createMemoryPlugin(30);
        await plugin.createReviewQueueItem(createMemoryQueueInput());
        const record = plugin.settings.memoryGovernance.records[0];
        let removalWrites = 0;
        plugin.saveData = jest.fn(async () => {
            removalWrites += 1;
            if (removalWrites === 2) throw new Error('queue disk unavailable');
        });

        await expect(plugin.forgetConfirmedMemory(record)).resolves.toMatchObject({ ok: true });
        expect(plugin.settings.memoryGovernance.records[0]).toMatchObject({
            lifecycle: 'forgotten_tombstone',
            originReviewQueueItemId: plugin.settings.reviewQueue.items[0].id,
        });
        expect(plugin.settings.reviewQueue.items[0]).toMatchObject({ status: 'applied' });

        const reloaded = createMemoryPlugin(30);
        reloaded.settings.reviewQueue = {
            enabled: false,
            items: plugin.settings.reviewQueue.items.map((item: ReviewQueueItem) => ({ ...item })),
        };
        reloaded.settings.memoryGovernance = {
            records: plugin.settings.memoryGovernance.records.map((item: ConfirmedMemoryRecord) => ({
                ...item,
                scope: { ...item.scope },
                sourceRefs: item.sourceRefs.map((ref) => ({ ...ref })),
            })),
        };

        await reloaded.reconcileMemoryQueueAudit();

        expect(reloaded.settings.reviewQueue.items[0]).toMatchObject({ status: 'undone' });
        await expect(reloaded.reconcileMemoryQueueAudit()).resolves.toBeUndefined();
        expect(reloaded.settings.reviewQueue.items[0]).toMatchObject({ status: 'undone' });
    });

    it('reconciles accepted audit state after confirmation and removal writes fail independently', async () => {
        const plugin = createMemoryPlugin(30);
        let writes = 0;
        plugin.saveData = jest.fn(async () => {
            writes += 1;
            if (writes === 4 || writes === 5 || writes === 7) throw new Error('queue disk unavailable');
        });

        const created = await plugin.createReviewQueueItem(createMemoryQueueInput());

        expect(created).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'accepted' }),
        });
        expect(plugin.settings.memoryGovernance.records[0]).toMatchObject({
            lifecycle: 'active',
            originReviewQueueItemId: plugin.settings.reviewQueue.items[0].id,
        });
        expect(plugin.settings.reviewQueue.items[0]).toMatchObject({ status: 'accepted' });

        const activeReload = createMemoryPlugin(31);
        activeReload.settings.reviewQueue = {
            enabled: false,
            items: plugin.settings.reviewQueue.items.map((item: ReviewQueueItem) => ({ ...item })),
        };
        activeReload.settings.memoryGovernance = {
            records: plugin.settings.memoryGovernance.records.map((item: ConfirmedMemoryRecord) => ({
                ...item,
                scope: { ...item.scope },
                sourceRefs: item.sourceRefs.map((ref) => ({ ...ref })),
            })),
        };

        await activeReload.reconcileMemoryQueueAudit();

        expect(activeReload.settings.reviewQueue.items[0]).toMatchObject({ status: 'applied' });

        await expect(plugin.forgetConfirmedMemory(plugin.settings.memoryGovernance.records[0]))
            .resolves.toMatchObject({ ok: true });
        expect(plugin.settings.memoryGovernance.records[0]).toMatchObject({
            lifecycle: 'forgotten_tombstone',
        });
        expect(plugin.settings.reviewQueue.items[0]).toMatchObject({ status: 'accepted' });

        const reloaded = createMemoryPlugin(31);
        reloaded.settings.reviewQueue = {
            enabled: false,
            items: plugin.settings.reviewQueue.items.map((item: ReviewQueueItem) => ({ ...item })),
        };
        reloaded.settings.memoryGovernance = {
            records: plugin.settings.memoryGovernance.records.map((item: ConfirmedMemoryRecord) => ({
                ...item,
                scope: { ...item.scope },
                sourceRefs: item.sourceRefs.map((ref) => ({ ...ref })),
            })),
        };

        await reloaded.reconcileMemoryQueueAudit();

        expect(reloaded.settings.reviewQueue.items[0]).toMatchObject({ status: 'undone' });
        await expect(reloaded.reconcileMemoryQueueAudit()).resolves.toBeUndefined();
        expect(reloaded.settings.reviewQueue.items[0]).toMatchObject({ status: 'undone' });
    });

    it('treats a concurrent accepted-to-applied audit update as idempotent', async () => {
        const seed = createMemoryPlugin(30);
        await seed.createReviewQueueItem(createMemoryQueueInput());

        const plugin = createMemoryPlugin(31);
        plugin.settings.reviewQueue = {
            enabled: false,
            items: [{ ...seed.settings.reviewQueue.items[0], status: 'accepted' }],
        };
        plugin.settings.memoryGovernance = {
            records: seed.settings.memoryGovernance.records.map((item: ConfirmedMemoryRecord) => ({
                ...item,
                scope: { ...item.scope },
                sourceRefs: item.sourceRefs.map((ref) => ({ ...ref })),
            })),
        };

        let releaseFirstWrite!: () => void;
        let markFirstWriteStarted!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => {
            markFirstWriteStarted = resolve;
        });
        const firstWriteBlocked = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        let writes = 0;
        plugin.saveData = jest.fn(async () => {
            writes += 1;
            if (writes === 1) {
                markFirstWriteStarted();
                await firstWriteBlocked;
            }
        });

        const queueStore = plugin.getReviewQueueStore();
        const directApply = queueStore.updateStatus(plugin.settings.reviewQueue.items[0].id, 'applied');
        await firstWriteStarted;
        const reconciliation = plugin.reconcileMemoryQueueAudit();

        releaseFirstWrite();
        await expect(directApply).resolves.toMatchObject({ ok: true });
        await expect(reconciliation).resolves.toBeUndefined();

        expect(queueStore.list()[0]).toMatchObject({ status: 'applied' });
        expect(plugin.log).not.toHaveBeenCalledWith(
            'Memory queue audit apply reconciliation failed',
            expect.anything(),
        );
    });

    it('does not sweep historical suggested candidates when a Level 2 plugin becomes idle', async () => {
        const plugin = createMemoryPlugin(30);
        const pending = await plugin.getReviewQueueStore().create(createMemoryQueueInput());
        expect(pending).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'suggested' }),
        });

        plugin.unloading = false;
        plugin.syncPageletRuntime = jest.fn();
        plugin.maybeShowNextOnboardingNudge = jest.fn(async () => undefined);
        plugin.maybeRunPatternDetectionNudge = jest.fn(async () => undefined);
        plugin.syncMemoryExtractionRuntime = jest.fn();

        plugin.onIdle();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(plugin.settings.reviewQueue.items).toEqual([
            expect.objectContaining({ status: 'suggested' }),
        ]);
        expect(plugin.settings.memoryGovernance.records).toEqual([]);
        expect(plugin.settings.confirmedMemoryCount).toBe(30);
    });

    it('does not sweep another historical candidate when manual confirmation reaches Level 2', async () => {
        const plugin = createMemoryPlugin(29);
        const historical = await plugin.getReviewQueueStore().create(createMemoryQueueInput());
        const manualInput = {
            ...createMemoryQueueInput(),
            title: 'Remember another preference',
            claim: 'Prefers weekly planning on Fridays.',
        };
        const manual = await plugin.getReviewQueueStore().create(manualInput);
        expect(historical.ok).toBe(true);
        expect(manual.ok).toBe(true);
        if (!historical.ok || !manual.ok) return;

        await plugin.confirmMemoryCandidateFromQueueItem(manual.value);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(plugin.settings.reviewQueue.items.find((item: ReviewQueueItem) => item.id === historical.value.id))
            .toMatchObject({ status: 'suggested' });
        expect(plugin.settings.reviewQueue.items.find((item: ReviewQueueItem) => item.id === manual.value.id))
            .toMatchObject({ status: 'applied' });
        expect(plugin.settings.memoryGovernance.records).toHaveLength(1);
        expect(plugin.settings.confirmedMemoryCount).toBe(30);
    });

    it('keeps task constraints pending even at Level 2', async () => {
        const plugin = createMemoryPlugin(30);

        const result = await plugin.createReviewQueueItem(createMemoryQueueInput('task_constraint'));

        expect(result).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'suggested' }),
        });
        expect(plugin.settings.memoryGovernance.records).toEqual([]);
        expect(plugin.settings.confirmedMemoryCount).toBe(30);
    });

    it('restores auto-confirm failures to suggested without broadening the queue state machine', async () => {
        const plugin = createMemoryPlugin(30);
        plugin.getMemoryGovernanceStore = jest.fn(() => ({
            confirmCandidate: jest.fn(async () => ({ ok: false, reason: 'store_failed' })),
        }));

        const result = await plugin.createReviewQueueItem(createMemoryQueueInput());

        expect(result).toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: 'suggested' }),
        });
        expect(plugin.settings.reviewQueue.items[0]).toMatchObject({
            type: 'memory_candidate',
            status: 'suggested',
        });
        expect(plugin.settings.confirmedMemoryCount).toBe(30);
        expect(plugin.log).toHaveBeenCalledWith(
            'Memory candidate auto-confirm failed',
            expect.objectContaining({ message: expect.stringContaining('store_failed') }),
        );
    });

    it('restores PA settings ledgers when persistence rejects', async () => {
        const plugin = createMemoryPlugin(0);
        plugin.settings.savedInsights = { items: [] };
        plugin.saveData = jest.fn(async () => {
            throw new Error('disk unavailable');
        });

        await expect(plugin.getReviewQueueStore().create(createMemoryQueueInput()))
            .rejects.toThrow('disk unavailable');
        expect(plugin.settings.reviewQueue.items).toEqual([]);

        await expect(plugin.getMemoryGovernanceStore().confirmCandidate({
            id: 'candidate-1',
            type: 'preference',
            lifecycle: 'candidate',
            sensitivity: 'low',
            scope: 'Current note',
            sourceRefs: [{ path: 'notes/current.md' }],
            createdAt: '2026-07-10T00:00:00.000Z',
            summary: 'Prefers concise planning notes.',
        }, {
            scope: { kind: 'current_note', paths: ['notes/current.md'] },
        })).rejects.toThrow('disk unavailable');
        expect(plugin.settings.memoryGovernance.records).toEqual([]);

        await expect(plugin.getSavedInsightStore().create({
            type: 'question',
            text: 'Why does planning keep slipping?',
            origin: 'user-authored',
        })).rejects.toThrow('disk unavailable');
        expect(plugin.settings.savedInsights.items).toEqual([]);
    });

    it('serializes PA ledger adapters so a successful save cannot carry a failed sibling ledger', async () => {
        const plugin = createMemoryPlugin(0);
        plugin.settings.savedInsights = { items: [] };
        const persistedSnapshots: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
        let rejectFirst!: (error: Error) => void;
        let markFirstStarted!: () => void;
        const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
        const blockedSave = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
        let saveCalls = 0;
        plugin.saveData = jest.fn(async (settings: Record<string, unknown>) => {
            saveCalls += 1;
            persistedSnapshots.push(JSON.parse(JSON.stringify(settings)) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (saveCalls === 1) {
                markFirstStarted();
                await blockedSave;
            }
        });

        const failedReviewSave = plugin.getReviewQueueStore().create(createMemoryQueueInput());
        await firstStarted;
        const successfulInsightSave = plugin.getSavedInsightStore().create({
            type: 'question',
            text: 'What should happen next?',
            origin: 'user-authored',
        });
        await Promise.resolve();
        expect(plugin.saveData).toHaveBeenCalledTimes(1);

        rejectFirst(new Error('disk unavailable'));
        await expect(failedReviewSave).rejects.toThrow('disk unavailable');
        await expect(successfulInsightSave).resolves.toMatchObject({ ok: true });

        expect(persistedSnapshots).toHaveLength(2);
        expect(persistedSnapshots[1].reviewQueue.items).toEqual([]);
        expect(persistedSnapshots[1].savedInsights.items).toHaveLength(1);
        expect(plugin.settings.reviewQueue.items).toEqual([]);
        expect(plugin.settings.savedInsights.items).toHaveLength(1);
    });

    it('keeps the automatic Memory pause mutation inside the shared settings transaction', async () => {
        const plugin = createMemoryPlugin(0);
        plugin.settings.savedInsights = { items: [] };
        const persistedSnapshots: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
        let rejectFirst!: (error: Error) => void;
        let markFirstStarted!: () => void;
        const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
        const blockedSave = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
        let saveCalls = 0;
        plugin.saveData = jest.fn(async (settings: Record<string, unknown>) => {
            saveCalls += 1;
            persistedSnapshots.push(JSON.parse(JSON.stringify(settings)) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (saveCalls === 1) {
                markFirstStarted();
                await blockedSave;
            }
            if (saveCalls === 2) throw new Error('pause disk unavailable');
        });

        const failedReviewSave = plugin.getReviewQueueStore().create(createMemoryQueueInput());
        await firstStarted;
        const failedPauseSave = plugin.setMemoryAutoAcceptPaused(true);
        const successfulInsightSave = plugin.getSavedInsightStore().create({
            type: 'question',
            text: 'What should happen next?',
            origin: 'user-authored',
        });

        expect(plugin.settings.memoryAutoAcceptPaused).toBe(false);
        expect(plugin.saveData).toHaveBeenCalledTimes(1);

        rejectFirst(new Error('ledger disk unavailable'));
        await expect(failedReviewSave).rejects.toThrow('ledger disk unavailable');
        await expect(failedPauseSave).rejects.toThrow('pause disk unavailable');
        await expect(successfulInsightSave).resolves.toMatchObject({ ok: true });

        expect(persistedSnapshots).toHaveLength(3);
        expect(persistedSnapshots.map((snapshot) => snapshot.memoryAutoAcceptPaused))
            .toEqual([false, true, false]);
        expect(plugin.settings.memoryAutoAcceptPaused).toBe(false);
        expect(plugin.settings.reviewQueue.items).toEqual([]);
        expect(plugin.settings.savedInsights.items).toHaveLength(1);
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
            featuredImageModel: 'wan2.7-image',
            numFeaturedImages: 1,
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
            featuredImageModel: 'wan2.7-image',
            numFeaturedImages: 1,
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
            featuredImageModel: 'wan2.7-image',
            numFeaturedImages: 1,
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

    it('normalizes invalid featured image count during migration', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = createMigrationApp();
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
            featuredImageModel: 'wan2.7-image',
            numFeaturedImages: 99,
            shareAnonymousCapabilityUsage: false,
            skillContextEnabled: true,
            enabledSkillIds: mockBundledSkillIds,
            statisticsVaultId: 'vault-id',
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        await plugin.migrateSettings();

        expect(plugin.settings.numFeaturedImages).toBe(4);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });
});

describe('Memory control-center read-only aggregation', () => {
    const dataBoundary = {
        excludedFolders: ['private', '.pagelet'],
        excludedTags: ['secret', 'health'],
        generatedNotePolicy: 'exclude-generated' as const,
        providerDisclosureReasons: ['memory_preparation', 'memory_search'] as const,
        cleanupGroups: ['cache', 'queue'] as const,
    };

    it('builds a canonical Data Boundary fingerprint independent of array order', () => {
        const reordered = {
            ...dataBoundary,
            excludedFolders: [...dataBoundary.excludedFolders].reverse(),
            excludedTags: [...dataBoundary.excludedTags].reverse(),
            providerDisclosureReasons: [...dataBoundary.providerDisclosureReasons].reverse(),
            cleanupGroups: [...dataBoundary.cleanupGroups].reverse(),
        };

        expect(buildMemoryDataBoundaryFingerprint(dataBoundary as any)).toBe( // eslint-disable-line @typescript-eslint/no-explicit-any
            buildMemoryDataBoundaryFingerprint(reordered as any), // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        expect(buildMemoryDataBoundaryFingerprint(dataBoundary as any)).toMatch(/^data_boundary:[a-f0-9]{8}$/); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('aggregates only cached sources without constructing governance services or mutating settings', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionIncludeVaultInsights: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
            statisticsVaultId: 'vault-id',
            dataBoundary,
            memoryGovernance: { records: [] },
        };
        plugin.app = { vault: { getName: jest.fn(() => 'Test vault') } };
        plugin.memoryManager = {
            getStatusSnapshot: jest.fn(() => ({
                enabled: true,
                status: 'ready',
                indexedDocumentCount: 12,
                dirtyCount: 0,
                verificationPending: 0,
            })),
        };
        const profileSnapshot = {
            updatedAt: '2026-07-10T08:00:00.000Z',
            markdown: '# User Profile',
            records: [{
                key: 'pref',
                text: 'Prefer concise Chinese replies.',
                kind: 'user_explicit',
                confidence: 'high',
                conversationId: 'conversation-1',
                observedAt: '2026-07-10T08:00:00.000Z',
                occurrences: 1,
                conversationIds: ['conversation-1'],
                confirmed: true,
            }],
        };
        const fingerprint = buildMemoryDataBoundaryFingerprint(dataBoundary as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.memoryExtractionScheduler = {
            getUserProfileSnapshot: jest.fn(() => profileSnapshot),
            getVaultInsightsStatus: jest.fn(() => 'ready'),
            getVaultInsightsSnapshot: jest.fn(() => ({
                dataBoundaryFingerprint: fingerprint,
                representativePaths: ['notes/source.md'],
                snapshot: {
                    generatedAt: '2026-07-10T08:00:00.000Z',
                    fileCount: 1,
                    folderThemes: [],
                    tagTaxonomy: [],
                    linkTopology: { hubNotes: [], unresolvedLinks: [] },
                    writingHabits: { busiestWeekdays: [], averageWords: 0, recentlyActive: [] },
                    topicClusters: [],
                    knowledgeGaps: [],
                    trends: [],
                },
            })),
        };
        plugin.createExistingUserProfileReader = jest.fn(() => ({ read: jest.fn() }));
        plugin.getMemoryGovernanceStore = jest.fn(() => {
            throw new Error('must not construct a governance store');
        });
        const before = JSON.stringify(plugin.settings);

        const snapshot = await plugin.getMemoryControlCenterSnapshot();

        expect(snapshot.noteMemory).toMatchObject({ status: 'ready', indexedDocumentCount: 12 });
        expect(snapshot.profile.status).toBe('ready');
        expect(snapshot.vaultInsights.status).toBe('ready');
        expect(snapshot.items.map((item: { origin: string }) => item.origin)).toEqual([
            'vault_insights',
            'user_profile',
        ]);
        expect(snapshot.items.every((item: { supportedActions: unknown[] }) => item.supportedActions.length === 0)).toBe(true);
        expect(snapshot.boundary).toMatchObject({ vaultScoped: true, deviceLocalProven: false });
        expect(plugin.createExistingUserProfileReader).not.toHaveBeenCalled();
        expect(plugin.getMemoryGovernanceStore).not.toHaveBeenCalled();
        expect(JSON.stringify(plugin.settings)).toBe(before);
    });

    it('discloses retained Profile storage through the non-creating reader when the scheduler is absent', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            memoryEnabled: false,
            memoryExtractionEnabled: false,
            memoryExtractionIncludeVaultInsights: false,
            memoryExtractionConsent: { state: 'paused', version: 1 },
            statisticsVaultId: 'vault-id',
            dataBoundary,
            memoryGovernance: { records: [] },
        };
        plugin.app = { vault: { getName: jest.fn(() => 'Test vault') } };
        plugin.memoryManager = null;
        plugin.memoryExtractionScheduler = null;
        plugin.createExistingUserProfileReader = jest.fn(() => ({
            read: jest.fn(async () => ({
                state: 'ready',
                snapshot: {
                    updatedAt: '2026-07-10T08:00:00.000Z',
                    markdown: '# User Profile',
                    records: [{
                        key: 'pref',
                        text: 'Prefer concise Chinese replies.',
                        kind: 'user_explicit',
                        confidence: 'high',
                        conversationId: 'conversation-1',
                        observedAt: '2026-07-10T08:00:00.000Z',
                        occurrences: 1,
                        conversationIds: ['conversation-1'],
                        confirmed: true,
                    }],
                },
            })),
        }));

        const snapshot = await plugin.getMemoryControlCenterSnapshot();

        expect(snapshot.profile).toMatchObject({ enabled: false, status: 'disabled', itemCount: 1 });
        expect(snapshot.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ origin: 'user_profile', effect: 'stored_not_in_use' }),
        ]));
        expect(plugin.createExistingUserProfileReader).toHaveBeenCalledTimes(1);
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

    it('formats in-progress Memory diagnostics without SQLite stats', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const model = plugin.buildTechnicalMemoryInProgressModel({
            action: 'rebuild',
            message: 'Saving memory 25/1846',
            phase: 'writing',
            filesDone: 25,
            filesTotal: 1846,
            startedAt: 123,
        }, {
            dirtyCount: 2,
            verificationPending: 1,
        });

        expect(model).toEqual({
            title: 'Memory diagnostics',
            summary: 'Memory action in progress',
            summaryTone: 'warning',
            details: [
                { label: 'Active operation', value: 'Prepare memory', tone: 'warning' },
                { label: 'Progress', value: 'Saving memory 25/1846', tone: 'warning' },
                { label: 'Maintenance', value: '2 dirty, 1 verification pending', tone: 'warning' },
            ],
            notes: ['Full diagnostics will be available when the current Memory action finishes.'],
        });
    });

    it('shows active Memory preparation status immediately', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.memoryManager = {
            getActivePreparationStatus: jest.fn(() => ({
                action: 'rebuild',
                message: 'Saving memory 25/1846',
                phase: 'writing',
                filesDone: 25,
                filesTotal: 1846,
                startedAt: 123,
            })),
        };
        plugin.vss = {
            getStats: jest.fn(async () => {
                throw new Error('stats should not be read while Memory is preparing');
            }),
            getMaintenanceState: jest.fn(() => ({
                dirtyCount: 0,
                verificationPending: 0,
            })),
        };
        plugin.showTechnicalMemoryNotice = jest.fn();

        await plugin.showTechnicalMemoryStatus();

        expect(plugin.vss.getStats).not.toHaveBeenCalled();
        expect(plugin.showTechnicalMemoryNotice).toHaveBeenCalledWith(expect.objectContaining({
            summary: 'Memory action in progress',
            details: expect.arrayContaining([
                { label: 'Progress', value: 'Saving memory 25/1846', tone: 'warning' },
            ]),
        }), 5000);
    });
});

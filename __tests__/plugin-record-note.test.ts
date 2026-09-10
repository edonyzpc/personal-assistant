import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MarkdownRenderer, Platform, TFile } from 'obsidian';
import type { App, MarkdownFileInfo } from 'obsidian';
import { createChatMemorySemanticReceipt, chatMemorySemanticSourceFingerprint } from '../src/pa/chat-memory-semantic-receipt';
import { stableHash as semanticSourceHash } from '../src/pa/helpers';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { MemoryUserProfileStore } from '../src/ai-services/memory-extraction/profile-store';
import { MemoryExtractionScheduler } from '../src/ai-services/memory-extraction/extraction-scheduler';
import { deriveSemanticProfileKey } from '../src/ai-services/memory-extraction/type-a-extractor';

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
    editorCheckCallback?: (
        checking: boolean,
        editor: { getSelection(): string },
        view?: MarkdownFileInfo,
    ) => boolean;
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
        PluginSettingTab: class { },
        TFile: MockTFile,
        Notice: class {
            constructor(message?: unknown) {
                mockNoticeMessages.push(String(message));
            }
        },
        Platform: {
            isDesktop: false,
            isMobile: false,
            isWin: false,
            isAndroidApp: false,
            isMacOS: true,
            isLinux: false,
            isIosApp: false,
        },
        normalizePath: (path: string) => {
            const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/g, '');
            return normalized === '' && path === '/' ? '/' : normalized;
        },
        getFrontMatterInfo: (markdown: string) => {
            const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
            if (!match) return { exists: false, contentStart: 0, frontmatter: '', from: 0, to: 0 };
            return {
                exists: true,
                contentStart: match[0].length,
                frontmatter: match[1] ?? '',
                from: 4,
                to: 4 + (match[1]?.length ?? 0),
            };
        },
        parseYaml: (yaml: string) => Object.fromEntries(yaml
            .split(/\r?\n/)
            .flatMap((line): Array<[string, unknown]> => {
                const match = /^\s*([^:#]+):\s*(.*?)\s*$/.exec(line);
                if (!match) return [];
                const key = match[1]!.trim();
                const raw = match[2]!.trim();
                if (raw === 'true') return [[key, true]];
                if (raw === 'false') return [[key, false]];
                if (raw.startsWith('[') && raw.endsWith(']')) {
                    return [[key, raw.slice(1, -1).split(',').map((part) => (
                        part.trim().replace(/^['"]|['"]$/g, '')
                    ))]];
                }
                return [[key, raw.replace(/^['"]|['"]$/g, '')]];
            })),
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
jest.mock('../src/share-card/share-card-modal', () => {
    const mockOpen = jest.fn();
    const mockCloseAllShareCardModals = jest.fn();
    return {
        ShareCardModal: jest.fn((_app: unknown, _data: unknown) => ({ open: mockOpen })),
        mockOpen,
        closeAllShareCardModals: mockCloseAllShareCardModals,
        mockCloseAllShareCardModals,
    };
});
const shareCardModalMock = jest.requireMock('../src/share-card/share-card-modal') as {
    ShareCardModal: jest.Mock;
    mockOpen: jest.Mock;
    mockCloseAllShareCardModals: jest.Mock;
};
const mockShareCardModalConstructor = shareCardModalMock.ShareCardModal;
const mockShareCardModalOpen = shareCardModalMock.mockOpen;
const mockCloseAllShareCardModals = shareCardModalMock.mockCloseAllShareCardModals;
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
jest.mock('../src/settings', () => {
    const actual = jest.requireActual<typeof import('../src/settings')>('../src/settings');
    return {
        // Use the real pure projection so save/barrier tests exercise the current
        // retired-field contract without substituting a no-op persistence path.
        hasDeprecatedSimpleSettingsFields: actual.hasDeprecatedSimpleSettingsFields,
        omitDeprecatedSimpleSettingsFields: actual.omitDeprecatedSimpleSettingsFields,
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
    };
});
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
import {
    AttentionAwareDeliveryStore,
    DELIVERY_FINGERPRINT_VERSION,
    type AttentionDeliveryDiagnostic,
    type DeliveryReceipt,
} from '../src/pagelet/attention';
import { PageletDetailView } from '../src/pagelet/tab';
import { createProviderRequestScope } from '../src/ai-services/obsidian-fetch';
import type {
    ConfirmedMemoryRecord,
    QuietRecallCandidate,
    ReviewQueueCreateInput,
    ReviewQueueItem,
} from '../src/pa';
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    IndexedDbMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    getMemoryGovernanceDeviceDbName,
    type DeviceMemoryGovernanceStateV1,
    type MemoryGovernanceTransaction,
    type MemoryGovernanceCommitGuard,
} from '../src/pa/memory-governance-persistence';
import { FakeGovernanceIndexedDbFactory, seedLegacyFactory, cloneStores } from './helpers/fake-governance-indexeddb';
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
import { collectChatMemorySources, createChatMemoryCandidateEvidence } from '../src/pa/chat-memory-admission';
import { hashWritingStyleText } from '../src/pa/writing-style';
import type { WritingStyleService } from '../src/chat/writing-style-service';
import { hashWritingText, type WritingVersion } from '../src/chat/writing-types';

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
        metadataCache: {
            on: jest.fn(() => ({})),
        },
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

function installUnavailablePlatformLocalStorage() {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousActiveWindow = Object.getOwnPropertyDescriptor(globalThis, 'activeWindow');
    const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {},
    });
    Object.defineProperty(globalThis, 'activeWindow', {
        configurable: true,
        value: {},
    });
    Object.defineProperty(globalThis, 'self', {
        configurable: true,
        value: {},
    });
    return {
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
            if (previousSelf) {
                Object.defineProperty(globalThis, 'self', previousSelf);
            } else {
                delete (globalThis as { self?: unknown }).self;
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
    plugin.settings = { author: "", noteTemplate: "" };
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
        expect(vault.create).toHaveBeenCalledWith('2026-05-01.md', expect.stringContaining('title: "2026-05-01"'));
        expect(openFile).toHaveBeenCalledWith(createdFiles[0]);
    });

    it('does not recreate an existing target folder when metadata lookup misses it', async () => {
        const { plugin, vault } = createPluginHarness({
            existingFolders: new Set(['9.src']),
        });

        await plugin.createNewNote('9.src', '2026-05-01');

        expect(vault.adapter.exists).toHaveBeenCalledWith('9.src');
        expect(vault.createFolder).not.toHaveBeenCalled();
        expect(vault.create).toHaveBeenCalledWith('9.src/2026-05-01.md', expect.stringContaining('title: "2026-05-01"'));
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
            metadataCache: {
                on: jest.fn(() => ({})),
            },
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
        mockShareCardModalConstructor.mockClear();
        mockShareCardModalOpen.mockClear();

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
            const shareSelectionCommand = getRegisteredCommand(plugin, 'share-selection-as-card');
            const editor = { getSelection: jest.fn(() => '   \n') };
            expect(shareSelectionCommand?.editorCheckCallback?.(true, editor)).toBe(false);
            expect(mockShareCardModalConstructor).not.toHaveBeenCalled();

            editor.getSelection.mockReturnValue('  # Keep spacing\n\n- item  ');
            expect(shareSelectionCommand?.editorCheckCallback?.(true, editor)).toBe(true);
            expect(mockShareCardModalConstructor).not.toHaveBeenCalled();
            expect(shareSelectionCommand?.editorCheckCallback?.(
                false,
                editor,
                { file: { path: 'Notes/Source.md' } } as unknown as MarkdownFileInfo,
            )).toBe(true);
            expect(mockShareCardModalConstructor).toHaveBeenCalledWith(plugin.app, {
                content: '  # Keep spacing\n\n- item  ',
                source: 'selection',
                resourceContext: { basePath: 'Notes/Source.md' },
            });
            expect(mockShareCardModalOpen).toHaveBeenCalledTimes(1);
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
    const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const bootstrapPlugins = new Set<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any

    function ordinaryTypeAEvidence(text: string, conversationId: string, throughTurnIndex: number) {
        const sources = collectChatMemorySources(conversationId, [{ conversationId, turnIndex: throughTurnIndex,
            user: { role: 'user', content: text, hostProvenance: { version: 1,
                messageId: `host-${conversationId}-${throughTurnIndex}`, kind: 'ordinary_user_statement' } },
            assistant: { role: 'assistant', content: 'Understood.' } }]);
        return { chatEvidence: createChatMemoryCandidateEvidence(text, sources),
            evidence: { conversationId, throughTurnIndex,
                chatMessages: sources.map(({ text: _text, ...source }) => ({ ...source })) } };
    }

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

    it('uses the explicit upgrade entry for an existing empty Profile without source writes, and refreshes the governed reader', async () => {
        const h = createBootstrapHarness(); const { plugin, repository } = h;
        await plugin.initializeMemoryGovernanceBootstrap();
        const key = plugin.memoryGovernanceOpaqueVaultKey as string;
        await repository.transact((draft) => {
            draft.policyStates[key].mode = 'legacy_threshold'; draft.policyStates[key].contextProjectionMode = 'legacy';
        });
        plugin.getMemoryGraphTopologyEpoch = jest.fn(() => 'same-boundary');
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.getMemoryUpgradeStatusMessage = (reason: string) => reason;
        const release = jest.fn();
        plugin.createExistingUserProfileReader = jest.fn(() => ({
            read: async () => ({ state: 'ready', snapshot: null }),
            acquireReadLease: async () => ({ result: { state: 'ready', snapshot: null }, isCurrent: () => true, release }),
        }));
        const original = h.readPersisted(); const writes = plugin.saveData.mock.calls.length;
        const before = await repository.initialize();
        const upgraded = await plugin.checkAndUpgradeMemoryGovernance();
        if (!upgraded.ok) throw new Error(upgraded.message);
        expect(upgraded.ok).toBe(true);
        expect(plugin.getMemoryGovernanceUiMode()).toBe('effect_based');
        expect((await repository.initialize()).migrationStates).toEqual(before.migrationStates);
        expect(h.readPersisted()).toEqual(original); expect(plugin.saveData.mock.calls).toHaveLength(writes);
        expect(plugin.createUserProfileStore).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(1);
    });

    it('resumes governed learning with preserved legacy copies without reimporting changed old data', async () => {
        const first = createBootstrapHarness();
        await first.plugin.initializeMemoryGovernanceBootstrap();
        const key = first.plugin.memoryGovernanceOpaqueVaultKey as string;
        await first.repository.transact((draft) => {
            draft.migrationStates[key].phase = 'governed_preserving_legacy';
            draft.policyStates[key].mode = 'effect_based';
            draft.policyStates[key].contextProjectionMode = 'governed';
        });
        await first.plugin.refreshDeviceMemoryCaches();
        expect(first.plugin.getMemoryGovernanceUiMode()).toBe('effect_based');
        expect(first.plugin.deviceMemoryRecordRepository).toBeNull();
        const before = await first.repository.initialize();
        const legacy = first.readPersisted();
        legacy.memoryGovernance.records[0].summary = 'Edited by an old client after upgrade';
        const restarted = createBootstrapHarness(first.backend, legacy);
        const finalize = jest.spyOn(restarted.plugin.legacyMemoryCompatibilityBarrier, 'finalize');
        await restarted.plugin.initializeMemoryGovernanceBootstrap();
        expect(restarted.plugin.memoryGovernanceBootstrapState).toBe('ready');
        expect(restarted.plugin.getMemoryGovernanceUiMode()).toBe('effect_based');
        expect(restarted.plugin.createExistingUserProfileReader).not.toHaveBeenCalled();
        expect(restarted.plugin.createUserProfileStore).not.toHaveBeenCalled();
        const resumed = await restarted.repository.initialize();
        expect(resumed.migrationStates[key]).toMatchObject({ phase: 'governed_preserving_legacy',
            sourceHash: before.migrationStates[key].sourceHash,
            pendingLegacySourceHash: expect.any(String) });
        expect(resumed.migrationStates[key].lastErrorCode).toBeUndefined();
        expect(resumed.revisions).toEqual(before.revisions);
        expect(resumed.rollbackPayloadEntries).toEqual(before.rollbackPayloadEntries);
        await expect(restarted.plugin.getReviewQueueStore().create(nonMemoryQueueInput())).resolves.toMatchObject({ ok: true });
        restarted.plugin.settings.focusMode = true;
        await restarted.plugin.saveSettings();
        expect(restarted.readPersisted().focusMode).toBe(true);
        expect(restarted.readPersisted().memoryGovernance).toEqual(legacy.memoryGovernance);
        expect(finalize).not.toHaveBeenCalled();
        expect((await restarted.repository.initialize()).revisions).toEqual(before.revisions);
    });

    it('keeps an unreadable Profile and a legacy source changed by another writer untouched during explicit upgrade', async () => {
        const h = createBootstrapHarness(); const { plugin, repository } = h;
        await plugin.initializeMemoryGovernanceBootstrap(); const key = plugin.memoryGovernanceOpaqueVaultKey as string;
        await repository.transact((draft) => {
            draft.policyStates[key].mode = 'legacy_threshold'; draft.policyStates[key].contextProjectionMode = 'legacy';
        });
        plugin.getMemoryGraphTopologyEpoch = jest.fn(() => 'same-boundary');
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.createExistingUserProfileReader = jest.fn(() => ({ read: async () => ({ state: 'unknown' }) }));
        const before = await repository.initialize(); const original = h.readPersisted();
        expect(await plugin.checkAndUpgradeMemoryGovernance()).toMatchObject({ ok: false });
        expect(await repository.initialize()).toEqual(before); expect(h.readPersisted()).toEqual(original);
        const changed = structuredClone(original); changed.memoryGovernance.records[0].summary = 'Newer source from another writer';
        const release = jest.fn();
        plugin.createExistingUserProfileReader = jest.fn(() => ({
            read: async () => ({ state: 'ready', snapshot: null }),
            acquireReadLease: async () => {
                h.writePersisted(changed);
                return { result: { state: 'ready', snapshot: null }, isCurrent: () => true, release };
            },
        }));
        expect(await plugin.checkAndUpgradeMemoryGovernance()).toMatchObject({ ok: false });
        expect(await repository.initialize()).toEqual(before); expect(h.readPersisted()).toEqual(changed);
        expect(plugin.createUserProfileStore).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(1);
    });

    function createPluginDataJsonHarness(initial: Record<string, unknown> | null) {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        let persistedText = initial === null ? null : JSON.stringify(initial);
        const temporaryFiles = new Map<string, string>();
        let beforeCopy: (() => void) | null = null;
        let beforeProcess: (() => void) | null = null;
        let beforeRead: (() => void) | null = null;
        const missingFileError = () => Object.assign(new Error('data.json is missing'), { code: 'ENOENT' });
        const existingFileError = () => Object.assign(new Error('data.json already exists'), { code: 'EEXIST' });
        const adapter = {
            read: jest.fn(async () => {
                const callback = beforeRead;
                beforeRead = null;
                callback?.();
                if (persistedText === null) throw missingFileError();
                return persistedText;
            }),
            write: jest.fn(async (path: string, data: string) => {
                temporaryFiles.set(path, data);
            }),
            copy: jest.fn(async (sourcePath: string, _destinationPath: string) => {
                beforeCopy?.();
                beforeCopy = null;
                if (persistedText !== null) throw existingFileError();
                const source = temporaryFiles.get(sourcePath);
                if (source === undefined) throw missingFileError();
                persistedText = source;
            }),
            remove: jest.fn(async (path: string) => {
                temporaryFiles.delete(path);
            }),
            process: jest.fn(async (_path: string, mutate: (data: string) => string) => {
                const callback = beforeProcess;
                beforeProcess = null;
                callback?.();
                if (persistedText === null) throw missingFileError();
                persistedText = mutate(persistedText);
                return persistedText;
            }),
        };
        plugin.app = {
            ...createMigrationApp(),
            vault: {
                configDir: '.obsidian',
                adapter,
            },
        };
        plugin.manifest = {
            id: 'personal-assistant',
            dir: '.obsidian/plugins/personal-assistant',
        };
        plugin.loadData = jest.fn(async () => (
            persistedText === null ? null : JSON.parse(persistedText)
        ));
        plugin.saveData = jest.fn(async (next: unknown) => {
            persistedText = JSON.stringify(next);
        });
        plugin.log = jest.fn();
        plugin.settingsSaveTail = null;
        plugin.settingsChangeListeners = new Set();
        plugin.unloading = false;
        return {
            plugin,
            adapter,
            readPersisted: () => persistedText === null ? null : JSON.parse(persistedText),
            writePersisted: (next: Record<string, unknown>) => {
                persistedText = JSON.stringify(next);
            },
            beforeNextCopy: (callback: () => void) => { beforeCopy = callback; },
            beforeNextProcess: (callback: () => void) => { beforeProcess = callback; },
            beforeNextRead: (callback: () => void) => { beforeRead = callback; },
        };
    }

    function freshMigrationSettings() {
        return {
            ...rawSettings(),
            aiProvider: '',
            statisticsVaultId: '',
            reviewQueue: { enabled: true, items: [] },
            memoryGovernance: { records: [] },
            confirmedMemoryCount: 0,
            memoryAutoAcceptPaused: false,
        };
    }

    it('creates missing plugin data before the fresh-install migration transaction', async () => {
        const { plugin, adapter, readPersisted } = createPluginDataJsonHarness(null);

        await plugin.loadSettings();
        plugin.settings = freshMigrationSettings();
        await plugin.migrateSettings();

        expect(plugin.saveData).not.toHaveBeenCalled();
        expect(adapter.write).toHaveBeenCalledTimes(1);
        const temporaryPath = adapter.write.mock.calls[0][0];
        expect(temporaryPath).toMatch(
            /^\.obsidian\/plugins\/personal-assistant\/data\.json\.init-.+\.tmp$/,
        );
        expect(adapter.write).toHaveBeenCalledWith(temporaryPath, '{}');
        expect(adapter.copy).toHaveBeenCalledWith(
            temporaryPath,
            '.obsidian/plugins/personal-assistant/data.json',
        );
        expect(adapter.remove).toHaveBeenCalledWith(temporaryPath);
        expect(adapter.process).toHaveBeenCalledTimes(1);
        expect(adapter.process).toHaveBeenCalledWith(
            '.obsidian/plugins/personal-assistant/data.json',
            expect.any(Function),
        );
        expect(readPersisted()).toMatchObject({
            aiProvider: '',
            statisticsVaultId: expect.any(String),
        });
        expect(plugin.settings.statisticsVaultId).not.toBe('');
        expect(plugin.legacyMemoryCompatibilityBarrier.isActive()).toBe(true);
    });

    it('keeps an existing empty data file on the atomic migration path', async () => {
        const { plugin, adapter } = createPluginDataJsonHarness({});

        await plugin.loadSettings();
        plugin.settings = freshMigrationSettings();
        await plugin.migrateSettings();

        expect(plugin.saveData).not.toHaveBeenCalled();
        expect(adapter.write).not.toHaveBeenCalled();
        expect(adapter.copy).not.toHaveBeenCalled();
        expect(adapter.process).toHaveBeenCalledTimes(1);
    });

    it('preserves plugin data that appears during fresh initialization', async () => {
        const {
            plugin,
            adapter,
            readPersisted,
            writePersisted,
            beforeNextCopy,
        } = createPluginDataJsonHarness(null);
        const concurrent = {
            ...rawSettings(),
            statisticsVaultId: '',
        };
        beforeNextCopy(() => writePersisted(concurrent));

        await plugin.loadSettings();
        await plugin.migrateSettings();

        expect(adapter.copy).toHaveBeenCalledTimes(1);
        expect(plugin.saveData).not.toHaveBeenCalled();
        expect(adapter.process).toHaveBeenCalledTimes(1);
        expect(readPersisted()).toMatchObject({
            aiProvider: 'openai',
            statisticsVaultId: expect.any(String),
            memoryGovernance: concurrent.memoryGovernance,
            reviewQueue: concurrent.reviewQueue,
            confirmedMemoryCount: concurrent.confirmedMemoryCount,
            memoryAutoAcceptPaused: concurrent.memoryAutoAcceptPaused,
        });
    });

    it('reloads plugin data that changes after fresh initialization but before migration', async () => {
        const {
            plugin,
            adapter,
            readPersisted,
            writePersisted,
            beforeNextProcess,
        } = createPluginDataJsonHarness(null);
        const concurrent = {
            ...rawSettings(),
            statisticsVaultId: '',
        };

        await plugin.loadSettings();
        plugin.settings = freshMigrationSettings();
        beforeNextProcess(() => writePersisted(concurrent));
        await plugin.migrateSettings();

        expect(adapter.process).toHaveBeenCalledTimes(2);
        expect(plugin.saveData).not.toHaveBeenCalled();
        expect(readPersisted()).toMatchObject({
            aiProvider: 'openai',
            statisticsVaultId: expect.any(String),
            memoryGovernance: concurrent.memoryGovernance,
            reviewQueue: concurrent.reviewQueue,
            confirmedMemoryCount: concurrent.confirmedMemoryCount,
            memoryAutoAcceptPaused: concurrent.memoryAutoAcceptPaused,
        });
    });

    it('fails closed when plugin data keeps changing during startup migration', async () => {
        const {
            plugin,
            adapter,
            readPersisted,
            writePersisted,
            beforeNextProcess,
        } = createPluginDataJsonHarness(null);
        let revision = 0;
        const replaceBeforeProcess = () => {
            writePersisted({
                ...rawSettings(),
                statisticsVaultId: '',
                author: `remote-${revision}`,
            });
            revision += 1;
            beforeNextProcess(replaceBeforeProcess);
        };

        await plugin.loadSettings();
        plugin.settings = freshMigrationSettings();
        beforeNextProcess(replaceBeforeProcess);

        await expect(plugin.migrateSettings()).rejects.toThrow(
            'Plugin settings changed while startup migration was running.',
        );

        expect(adapter.process).toHaveBeenCalledTimes(3);
        expect(plugin.saveData).not.toHaveBeenCalled();
        expect(readPersisted()).toMatchObject({
            author: 'remote-2',
            statisticsVaultId: '',
            memoryGovernance: rawSettings().memoryGovernance,
        });
    });

    it('reloads when plugin data changes between migration write and readback', async () => {
        const {
            plugin,
            adapter,
            readPersisted,
            writePersisted,
            beforeNextRead,
        } = createPluginDataJsonHarness({
            ...rawSettings(),
            statisticsVaultId: '',
        });

        await plugin.loadSettings();
        beforeNextRead(() => writePersisted({
            ...rawSettings(),
            statisticsVaultId: '',
            author: 'remote-after-write',
        }));
        await plugin.migrateSettings();

        expect(adapter.process).toHaveBeenCalledTimes(2);
        expect(readPersisted()).toMatchObject({
            author: 'remote-after-write',
            statisticsVaultId: expect.any(String),
            memoryGovernance: rawSettings().memoryGovernance,
        });
    });

    it('does not overwrite plugin data when the initial read is indeterminate', async () => {
        const { plugin } = createPluginDataJsonHarness({ existing: true });
        plugin.loadData = jest.fn(async () => undefined);

        await plugin.loadSettings();

        expect(plugin.saveData).not.toHaveBeenCalled();
        expect(plugin.app.vault.adapter.write).not.toHaveBeenCalled();
    });

    it('fails startup when missing plugin data cannot be copied into place', async () => {
        const { plugin, adapter } = createPluginDataJsonHarness(null);
        const error = Object.assign(new Error('data.json is not writable'), { code: 'EACCES' });
        adapter.copy.mockRejectedValueOnce(error);

        await expect(plugin.loadSettings()).rejects.toBe(error);

        expect(plugin.saveData).not.toHaveBeenCalled();
        expect(adapter.remove).toHaveBeenCalledTimes(1);
        expect(adapter.process).not.toHaveBeenCalled();
    });

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

    it.each(['stale boundary', 'malformed'])('does not bind omitted %s Insights to a valid Personal source receipt', async (reason) => {
        const { plugin } = await createGovernedUseGateHarness();
        plugin.settings.memoryExtractionIncludeVaultInsights = true;
        plugin.getGovernedMemoryCurrentScope = () => ({ notePath: 'notes/use-gate.md', folderPath: 'notes', tags: [] });
        plugin.isGovernedMemoryRevisionAllowed = () => true;
        plugin.memoryExtractionScheduler = {
            dispose: jest.fn(),
            getVaultInsightsSnapshot: () => ({
                snapshot: { generatedAt: '2026-09-10T00:00:00Z', fileCount: 1 },
                dataBoundaryFingerprint: reason === 'stale boundary' ? 'old-boundary' : plugin.getMemoryDataBoundaryFingerprint(),
                representativePaths: [],
            }),
        };
        const context = plugin.getMemoryExtractionPromptContext();
        expect(context.governedMemoryContext).toContain('Use concise evidence-backed answers.');
        expect(context.governedMemoryContext).not.toContain('"kind":"vault_insights"');
        expect(context.isSourceCurrent()).toBe(true);
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
        const initialSettings = rawSettings();
        const pendingCandidate = initialSettings.reviewQueue.items.find((item) => item.id === 'legacy-memory-queue')!;
        pendingCandidate.status = 'suggested';
        pendingCandidate.metadata = { memoryType: 'preference', sensitivity: 'low' };
        const { plugin, raw } = createBootstrapHarness(undefined, initialSettings);
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
        const candidate = plugin.getReviewQueueItemById('legacy-memory-queue');
        expect(candidate.status).toBe('suggested');
        await expect(plugin.confirmMemoryCandidateFromQueueItem(candidate)).resolves.toMatchObject({
            ok: false,
            message: expect.stringContaining('queue_reserve_failed'),
        });
        expect(plugin.getReviewQueueItemById(candidate.id)).toEqual(candidate);
        expect(plugin.deviceMemoryGovernanceRepository).toBeNull();
        expect(plugin.memoryAdmissionCoordinator).toBeNull();
        expect(plugin.memoryProfileProjectionWorker).toBeNull();
        plugin.scheduleMemoryForgetRetry();
        plugin.scheduleMemoryProfileProjectionRetry();
        expect(plugin.memoryForgetRetryTimer).toBeNull();
        expect(plugin.memoryProfileProjectionRetryTimer).toBeNull();
        expect(plugin.createExistingUserProfileReader).not.toHaveBeenCalled();
        expect(plugin.createUserProfileStore).not.toHaveBeenCalled();
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

    it.each(['logical-schema', 'database-version'] as const)('preserves a future %s database through real reader rejection and plugin fallback actions', async (boundary) => {
        const factory = new FakeGovernanceIndexedDbFactory();
        seedLegacyFactory(factory, createEmptyDeviceMemoryGovernanceStateV1());
        factory.backend.version = boundary === 'database-version' ? 4 : 3;
        factory.backend.getStore('meta').set('device-state-v1', { schemaVersion: 4, commitSequence: 17 });
        // Opaque future records in every logical store must survive unchanged.
        for (const [name, store] of factory.backend.stores) {
            if (name !== 'meta') store.set('future-record', { futureKind: name, receipt: { version: 3, text: 'Synthetic future evidence' } });
        }
        const before = cloneStores(factory.backend.stores);
        const initialSettings = rawSettings();
        const pending = initialSettings.reviewQueue.items.find((item) => item.id === 'legacy-memory-queue')!;
        pending.status = 'suggested';
        pending.metadata = { memoryType: 'preference', sensitivity: 'low' };
        const { plugin, raw } = createBootstrapHarness(undefined, initialSettings);
        const repository = new IndexedDbMemoryGovernanceRepository(
            getMemoryGovernanceDeviceDbName('personal-assistant'), factory as unknown as IDBFactory,
            { broadcastChannelFactory: null },
        );
        const initialize = jest.spyOn(repository, 'initialize');
        const dispose = jest.spyOn(repository, 'dispose');
        plugin.createMemoryGovernanceDeviceRepository = jest.fn(() => repository);
        await plugin.initializeMemoryGovernanceBootstrap();
        await expect(initialize.mock.results[0].value).rejects.toMatchObject({
            code: boundary === 'database-version' ? 'database_open_failed' : 'invalid_state',
        });
        expect(plugin.memoryGovernanceBootstrapState).toBe('failed');
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(plugin.deviceMemoryGovernanceRepository).toBeNull();
        expect(plugin.currentDeviceMemoryGovernanceState).toBeNull();
        expect(plugin.memoryAdmissionCoordinator).toBeNull();
        expect(plugin.memoryProfileProjectionWorker).toBeNull();

        await expect(plugin.getReviewQueueStore().create(nonMemoryQueueInput())).resolves.toMatchObject({ ok: true });
        plugin.settings.focusMode = true;
        await plugin.saveSettings();
        const candidate = plugin.getReviewQueueItemById(pending.id);
        expect(candidate.status).toBe('suggested');
        await expect(plugin.confirmMemoryCandidateFromQueueItem(candidate)).resolves.toMatchObject({
            ok: false, message: expect.stringContaining('queue_reserve_failed'),
        });
        expect(plugin.getReviewQueueItemById(candidate.id)).toEqual(candidate);
        plugin.scheduleMemoryForgetRetry();
        plugin.scheduleMemoryProfileProjectionRetry();
        plugin.scheduleMemoryGovernanceGarbageCollection();
        expect(plugin.memoryForgetRetryTimer).toBeNull();
        expect(plugin.memoryProfileProjectionRetryTimer).toBeNull();
        expect(plugin.memoryGovernanceGarbageCollectionTimer == null).toBe(true);
        expect(plugin.createExistingUserProfileReader).not.toHaveBeenCalled();
        expect(plugin.createUserProfileStore).not.toHaveBeenCalled();
        const persisted = plugin.saveData.mock.calls.at(-1)?.[0];
        expect(persisted.focusMode).toBe(true);
        expect(persisted.memoryGovernance).toEqual(raw.memoryGovernance);
        expect(persisted.reviewQueue.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: pending.id, status: 'suggested' }),
            expect.objectContaining({ type: 'evidence_insight' }),
        ]));
        expect(factory.backend.stores).toEqual(before);
        expect(factory.backend.version).toBe(boundary === 'database-version' ? 4 : 3);
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

    describe('explicit writing style plugin gates', () => {
        const scene = { writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel' };
        const budget = { remainingTextChars: 10_000, remainingMemoryChars: 6_000 };
        async function setup() {
            const harness = createBootstrapHarness();
            const { plugin } = harness;
            plugin.settings.memoryExtractionEnabled = false;
            plugin.settings.memoryExtractionConsent = { state: 'unconfirmed', version: 1 };
            plugin.createChatModel = jest.fn();
            await plugin.initializeMemoryGovernanceBootstrap();
            const text = '海风替我保存了这段旅行。';
            const version: WritingVersion = { id: 'style-version', requestId: 'writing-request', messageId: 'writing-message',
                text, textHash: hashWritingStyleText(text), explanation: '', origin: 'ai_generated', conversationId: 'style-conversation',
                turnIndex: 0, createdAt: Date.now(), associatedImages: [], backgroundSourceRefs: [], styleRevisionIds: [], scene };
            plugin.writingVersions = { get: jest.fn(async () => version), dispose: jest.fn(async () => undefined) };
            const service = plugin.getWritingStyleService() as WritingStyleService;
            return { ...harness, service, version };
        }

        async function setupNoteBackedStyle() {
            const harness = await setup();
            const { plugin, service, version } = harness;
            const path = 'notes/travel-style.md';
            const markdown = '# Travel style\n海风替我保存了这段旅行。';
            const file = createTFileWithStat(path, { mtime: 100, size: markdown.length });
            const boundary = { allowed: true };
            plugin.app.vault.getAbstractFileByPath = jest.fn((candidatePath: string) => candidatePath === path ? file : null);
            plugin.getMemoryGraphTopologyEpoch = jest.fn(() => 'note-style-source-epoch');
            plugin.isMemoryProviderPathAllowed = jest.fn((candidatePath: string) => boundary.allowed && candidatePath === path);
            plugin.captureLatestMemorySource = jest.fn(async (
                candidatePath: string,
                isAllowed: (sourcePath: string) => boolean,
                _surface: string,
                _signal?: AbortSignal,
            ) => isAllowed(candidatePath) ? { path, markdown, mtime: 100, size: markdown.length } : null);
            const receipt = await service.remember(version.id, scene, 'explicit-note-backed-style', {
                path, contentHash: await hashWritingText(markdown),
            });
            await plugin.refreshDeviceMemoryCaches();
            return { ...harness, path, file, boundary, receipt };
        }

        it('keeps a prepared note-backed style source valid after its model turn is cancelled', async () => {
            const { plugin, service, version, path, receipt } = await setupNoteBackedStyle();
            const controller = new AbortController();

            const selected = await service.prepare(scene, { ...budget, signal: controller.signal });

            expect(selected.context).toContain(version.text);
            expect(selected.revisionIds).toEqual([receipt.revisionId]);
            expect(plugin.captureLatestMemorySource).toHaveBeenLastCalledWith(path, expect.any(Function), 'chat', controller.signal);
            expect(selected.isCurrent()).toBe(true);
            expect(selected.isSourceCurrent?.()).toBe(true);
            controller.abort();
            expect(selected.isCurrent()).toBe(false);
            expect(selected.isSourceCurrent?.()).toBe(true);
            expect(plugin.createChatModel).not.toHaveBeenCalled();
        });

        it.each(['note edit', 'path exclusion', 'Forget'] as const)(
            'still revokes a cancelled note-backed style receipt after %s',
            async (revocation) => {
                const { plugin, service, file, boundary, receipt } = await setupNoteBackedStyle();
                const controller = new AbortController();
                const selected = await service.prepare(scene, { ...budget, signal: controller.signal });
                controller.abort();
                expect(selected.isSourceCurrent?.()).toBe(true);

                if (revocation === 'note edit') file.stat.mtime += 1;
                else if (revocation === 'path exclusion') boundary.allowed = false;
                else {
                    await expect(plugin.memoryGovernanceCoordinator.forget({ claimId: receipt.claimId }))
                        .resolves.toMatchObject({ ok: true });
                    await plugin.refreshDeviceMemoryCaches();
                }

                expect(selected.isSourceCurrent?.()).toBe(false);
                expect(selected.isCurrent()).toBe(false);
                expect(plugin.createChatModel).not.toHaveBeenCalled();
            },
        );

        it('uses only explicitly saved matching samples with extraction disabled and leaves automatic consent unchanged', async () => {
            const { plugin, repository, service, version } = await setup();
            expect(plugin.getMemoryGovernanceUiMode()).toBe('effect_based');
            const before = await repository.initialize();
            expect((await plugin.prepareWritingStyle('帮我写一段旅行朋友圈文案', undefined, budget)).context).toBe('');
            expect((await repository.initialize()).revisions).toEqual(before.revisions);
            const receipt = await service.remember(version.id, scene, 'explicit-style-action');
            await plugin.refreshDeviceMemoryCaches();
            const selected = await plugin.prepareWritingStyle('帮我写一段旅行朋友圈文案', undefined, budget);
            expect(selected.revisionIds).toEqual([receipt.revisionId]); expect(selected.context).toContain(version.text);
            expect((await plugin.prepareWritingStyle('帮我写工作邮件给同事', undefined, budget)).context).toBe('');
            const state = await repository.initialize();
            expect(state.revisions.filter((revision) => revision.writingStyle)).toHaveLength(1);
            const entry = plugin.getGovernedMemoryViewSnapshot().records.find((item: { claimId: string }) => item.claimId === receipt.claimId);
            expect(plugin.projectGovernedMemoryUiEntry(entry, state)).toMatchObject({ useStatus: 'active', actionPolicy: { pause: true, forget: true } });
            // A writing style alone does not manufacture ordinary Personal context.
            expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
            expect(plugin.settings.memoryExtractionEnabled).toBe(false);
            expect(plugin.settings.memoryExtractionConsent).toEqual({ state: 'unconfirmed', version: 1 });
            expect(plugin.createChatModel).not.toHaveBeenCalled(); expect(plugin.createUserProfileStore).not.toHaveBeenCalled();
            expect(plugin.memoryExtractionScheduler).toBeUndefined();
        });

        it('prepares the model supplied writing scene through ChatHost while preserving conflicts and governance', async () => {
            const { plugin, service, version } = await setup();
            const receipt = await service.remember(version.id, scene, 'semantic-style-action');
            await plugin.refreshDeviceMemoryCaches();
            const host = plugin.createChatHost();
            const selected = await host.prepareWritingStyleForScene(scene, budget);
            expect(selected.revisionIds).toEqual([receipt.revisionId]);
            expect(selected.context).toContain(version.text);
            expect((await host.prepareWritingStyleForScene(undefined, budget)).context).toBe('');
            expect((await host.prepareWritingStyleForScene(scene, { ...budget, currentInstructionConflicts: true })).context).toBe('');
            expect((await host.prepareWritingStyleForScene(scene, { ...budget, remainingTextChars: 0 })).context).toBe('');
            await plugin.memoryGovernanceCoordinator.forget({ claimId: receipt.claimId });
            await plugin.refreshDeviceMemoryCaches();
            expect(selected.isSourceCurrent()).toBe(false);
            expect((await host.prepareWritingStyleForScene(scene, budget)).context).toBe('');
            expect(plugin.createChatModel).not.toHaveBeenCalled();
        });

        it('stops style use at the master switch, Pause and Forget while preserving static management', async () => {
            const { plugin, repository, service, version } = await setup();
            const receipt = await service.remember(version.id, scene, 'explicit-style-lifecycle');
            await plugin.refreshDeviceMemoryCaches();
            const selected = await service.prepare(scene, budget);
            plugin.settings.memoryEnabled = false;
            expect(selected.isCurrent()).toBe(false); expect((await service.prepare(scene, budget)).context).toBe('');
            const entry = plugin.getGovernedMemoryViewSnapshot().records.find((item: { claimId: string }) => item.claimId === receipt.claimId);
            expect(plugin.projectGovernedMemoryUiEntry(entry, await repository.initialize())).toMatchObject({ useStatus: 'stored_not_in_use', actionPolicy: { pause: true, forget: true } });
            await expect(plugin.memoryGovernanceCoordinator.pauseUse({ claimId: receipt.claimId })).resolves.toMatchObject({ ok: true });
            await plugin.refreshDeviceMemoryCaches();
            plugin.settings.memoryEnabled = true;
            expect((await service.prepare(scene, budget)).context).toBe('');
            await expect(plugin.memoryGovernanceCoordinator.resumeUse({ claimId: receipt.claimId, scopeAllowed: true, dataBoundaryAllowed: true })).resolves.toMatchObject({ ok: true });
            await plugin.refreshDeviceMemoryCaches();
            const resumed = await service.prepare(scene, budget); expect(resumed.revisionIds).toEqual([receipt.revisionId]);
            await expect(plugin.memoryGovernanceCoordinator.forget({ claimId: receipt.claimId })).resolves.toMatchObject({ ok: true });
            await plugin.refreshDeviceMemoryCaches();
            expect(resumed.isCurrent()).toBe(false); expect((await service.prepare(scene, budget)).context).toBe('');
            expect(JSON.stringify(await repository.initialize())).not.toContain(version.text);
            expect(plugin.settings.memoryExtractionEnabled).toBe(false); expect(plugin.createChatModel).not.toHaveBeenCalled();
        });

        it('reports legacy compatibility explicitly without changing its policy or writing a style', async () => {
            const { plugin, repository, version } = await setup();
            const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
            await repository.transact((draft) => {
                draft.policyStates[vaultKey].mode = 'legacy_threshold';
                draft.policyStates[vaultKey].contextProjectionMode = 'legacy';
            });
            await plugin.refreshDeviceMemoryCaches();
            const before = await repository.initialize();
            await expect(plugin.rememberWritingStyle(version.id, scene)).rejects.toMatchObject({
                name: 'WritingStyleUnavailableError', code: 'legacy_memory',
            });
            expect((await plugin.prepareWritingStyle('帮我写一段旅行朋友圈文案', undefined, budget)).context).toBe('');
            expect(await repository.initialize()).toEqual(before);
        });
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
        expect(beforePause.isSourceCurrent?.()).toBe(true);
        expect(Object.keys(beforePause)).not.toContain('isSourceCurrent');
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

        plugin.settings.memoryEnabled = false;
        expect(beforePause.isSourceCurrent?.()).toBe(false);
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
        for (const disabled of [
            { memoryEnabled: true, memoryExtractionEnabled: false, memoryExtractionConsent: { state: 'confirmed', version: 1 } },
            { memoryEnabled: true, memoryExtractionEnabled: true, memoryExtractionConsent: { state: 'unconfirmed', version: 1 } },
            { memoryEnabled: true, memoryExtractionEnabled: false, memoryExtractionConsent: { state: 'paused', version: 1 } },
        ]) {
            Object.assign(plugin.settings, disabled);
            expect(plugin.getMemoryExtractionPromptContext()).toEqual(beforePause);
            expect(beforePause.isSourceCurrent?.()).toBe(true);
            expect(plugin.canRunMemoryExtractionRuntime()).toBe(false);
        }
        Object.assign(plugin.settings, {
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 },
        });

        const sequenceBeforeUnrelatedLearning = plugin.getGovernedMemoryProjectionSnapshot().state.commitSequence;
        await expect(plugin.createReviewQueueItem({
            type: 'memory_candidate',
            title: 'Another preference',
            claim: 'Use diagrams for architecture discussions.',
            scope: { kind: 'current_note', paths: ['notes/other.md'] },
            sourceRefs: [{ path: 'notes/other.md', sourceId: 'source-unrelated' }],
            originSurface: 'quick_capture',
            dataBoundarySnapshotId: 'boundary-current',
            admissionReason: 'memory_confirmation_required',
            metadata: { memoryType: 'preference', sensitivity: 'low' },
        })).resolves.toMatchObject({ ok: true, value: { status: 'applied' } });
        expect(plugin.getGovernedMemoryProjectionSnapshot().state.commitSequence).toBeGreaterThan(sequenceBeforeUnrelatedLearning);
        expect(beforePause.isSourceCurrent?.()).toBe(true);
        const beforeSelectedPause = plugin.getMemoryExtractionPromptContext();

        const record = plugin.getMemoryGovernancePanelState().records.find(
            (candidate: ConfirmedMemoryRecord) => candidate.summary === 'Use concise evidence lists for this note.',
        );
        expect(record).toBeDefined();
        await expect(plugin.pauseGovernedMemory(record)).resolves.toMatchObject({ ok: true });
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
        expect(beforePause.isSourceCurrent?.()).toBe(false);
        await expect(plugin.resumeGovernedMemory(record)).resolves.toMatchObject({ ok: true });
        const resumed = plugin.getMemoryExtractionPromptContext();
        expect(resumed.governedMemoryContext).toBe(beforeSelectedPause.governedMemoryContext);
        expect(resumed.isSourceCurrent?.()).toBe(true);
        expect(beforePause.isSourceCurrent?.()).toBe(false);
    });

    it.each([
        ['Memory master switch', { memoryEnabled: false }],
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

    it.each([
        { memoryExtractionEnabled: false, memoryExtractionConsent: { state: 'confirmed', version: 1 } },
        { memoryExtractionEnabled: true, memoryExtractionConsent: { state: 'unconfirmed', version: 1 } },
        { memoryExtractionEnabled: false, memoryExtractionConsent: { state: 'paused', version: 1 } },
    ])('keeps governed Personal in use without enabling new extraction: %j', async (settings) => {
        const { plugin, record, isPathAllowed } = await createGovernedUseGateHarness();
        plugin.getGovernedMemoryCurrentScope = jest.fn(() => ({
            notePath: 'notes/use-gate.md', folderPath: 'notes', tags: [],
        }));
        const before = plugin.getMemoryExtractionPromptContext();
        expect(before.governedMemoryContext).toContain('Use concise evidence-backed answers.');
        Object.assign(plugin.settings, settings);
        expect(plugin.canRunMemoryExtractionRuntime()).toBe(false);
        const context = plugin.getMemoryExtractionPromptContext();
        expect(context).toEqual(before);
        const snapshot = await plugin.getMemoryControlCenterSnapshot();
        expect(snapshot.items.find((item: { claimId?: string }) => item.claimId === record.id))
            .toMatchObject({ lifecycle: 'active' });
        expect(plugin.getMemoryGovernancePanelState().records.find((item: { id: string }) => item.id === record.id))
            .toMatchObject({ useStatus: 'active', durableUseStatus: 'active' });
        isPathAllowed.mockReturnValue(false);
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'governed' });
        expect(plugin.canRunMemoryExtractionRuntime()).toBe(false);
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

    it('rejects expired Type-A cursor updates at the final commit boundary', async () => {
        const { plugin, repository } = createBootstrapHarness();
        await plugin.initializeMemoryGovernanceBootstrap();
        const before = await repository.initialize();
        let release!: () => void;
        let reached!: () => void;
        const waiting = new Promise<void>((resolve) => { release = resolve; });
        const entered = new Promise<void>((resolve) => { reached = resolve; });
        const original = repository.transact.bind(repository);
        repository.transact = async function<T>(operation: MemoryGovernanceTransaction<T>, guard?: MemoryGovernanceCommitGuard): Promise<T> {
            return original(async (draft) => {
                const result = await operation(draft);
                reached();
                await waiting;
                return result;
            }, guard);
        };
        let current = true;
        const evidence = ordinaryTypeAEvidence('I prefer concise answers.', 'late-cursor', 1).evidence;
        const pending = plugin.persistGovernedTypeAProcessedTurn(plugin.memoryGovernanceOpaqueVaultKey,
            evidence, { isCurrent: () => current });
        const rejected = expect(pending).rejects.toThrow('Type-A producer is no longer current');
        await entered;
        current = false;
        release();
        await rejected;
        expect(await repository.initialize()).toEqual(before);
    });

    it('rejects an expired Type-A batch after the lifecycle queue even if learning has restarted', async () => {
        const { plugin, repository } = createBootstrapHarness();
        Object.assign(plugin.settings, { memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 } });
        await plugin.initializeMemoryGovernanceBootstrap();
        const baseline = await plugin.captureGovernedTypeAAdmissionBaseline();
        const before = await repository.initialize();
        const admit = jest.spyOn(plugin.memoryAdmissionCoordinator, 'admit');
        let release!: () => void;
        plugin.memoryLifecycleMutationTail = new Promise<void>((resolve) => { release = resolve; });
        let oldBatchCurrent = true;
        const host = ordinaryTypeAEvidence('I prefer concise answers.', 'old-batch', 1);
        const pending = plugin.admitGovernedTypeABatch({ current: null,
            proposed: { updatedAt: createdAt, records: [], markdown: '# User Profile' },
            candidates: [], baseline, evidence: host.evidence, isCurrent: () => oldBatchCurrent });
        oldBatchCurrent = false;
        plugin.settings.memoryExtractionEnabled = false;
        plugin.settings.memoryExtractionEnabled = true;
        release();
        await expect(pending).resolves.toEqual({ status: 'retry' });
        expect(admit).not.toHaveBeenCalled();
        expect(await repository.initialize()).toEqual(before);
    });

    it('preserves a committed Type-A record and schedules projection recovery when its batch expires', async () => {
        const { plugin, repository, backend } = createBootstrapHarness();
        Object.assign(plugin.settings, { memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 } });
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        await plugin.initializeMemoryGovernanceBootstrap();
        const baseline = await plugin.captureGovernedTypeAAdmissionBaseline();
        const before = await repository.initialize();
        const conversationId = 'partial-type-a-batch';
        const firstText = 'Please always answer with bullet points.';
        const secondText = 'I prefer concise answers.';
        const firstHost = ordinaryTypeAEvidence(firstText, conversationId, 1);
        const secondHost = ordinaryTypeAEvidence(secondText, conversationId, 2);
        const records: UserProfileSnapshot['records'] = [
            { profileRecordId: 'profile-dddddddddddddddddddddddddddddddd', key: 'answer-structure',
                text: firstText, chatEvidence: firstHost.chatEvidence },
            { profileRecordId: 'profile-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', key: 'answer-length',
                text: secondText, chatEvidence: secondHost.chatEvidence },
        ].map((record) => ({ ...record, kind: 'user_explicit', confidence: 'high', conversationId,
            observedAt: createdAt, occurrences: 1, conversationIds: [conversationId], confirmed: true }));
        const controller = new AbortController();
        let current = true;
        let committed: DeviceMemoryGovernanceStateV1 | null = null;
        const unsubscribe = repository.subscribe(() => {
            const state = backend.read();
            if (committed || !state.pendingOperations.some((operation) => (
                operation.kind === 'profile_projection' && operation.profileRecordId === records[0].profileRecordId
            ))) return;
            // Invalidate only after the real backend publishes the first commit.
            committed = state;
            current = false;
            controller.abort();
            plugin.settings.memoryExtractionEnabled = false;
        });
        const admit = jest.spyOn(plugin.memoryAdmissionCoordinator, 'admit');
        const scheduleRecovery = jest.spyOn(plugin, 'scheduleMemoryProfileProjectionRetry');
        const resumeProjection = jest.spyOn(plugin.memoryProfileProjectionWorker, 'resumePending');
        try {
            await expect(plugin.admitGovernedTypeABatch({
                current: null,
                proposed: { updatedAt: createdAt, records, markdown: '# User Profile' },
                candidates: records.map((record) => ({ ...record })),
                baseline,
                evidence: { conversationId, throughTurnIndex: 2,
                    chatMessages: [...firstHost.evidence.chatMessages, ...secondHost.evidence.chatMessages] },
                isCurrent: () => current,
                signal: controller.signal,
            })).resolves.toEqual({ status: 'retry' });
            expect(committed).not.toBeNull();
            expect(admit).toHaveBeenCalledTimes(1);
            const after = await repository.initialize();
            expect(after).toEqual(committed);
            expect(after.claims).toHaveLength(before.claims.length + 1);
            expect(after.pendingOperations).toContainEqual(expect.objectContaining({
                kind: 'profile_projection', profileRecordId: records[0].profileRecordId, state: 'pending',
            }));
            expect(after.pendingOperations).not.toContainEqual(expect.objectContaining({
                kind: 'profile_projection', profileRecordId: records[1].profileRecordId,
            }));
            const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
            expect(after.policyStates[vaultKey].typeAProcessedTurns)
                .toEqual(before.policyStates[vaultKey].typeAProcessedTurns);
            expect(scheduleRecovery).toHaveBeenCalledTimes(1);
            expect(plugin.memoryProfileProjectionRetryTimer).not.toBeNull();
            expect(resumeProjection).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
            plugin.cancelMemoryProfileProjectionRetry();
        }
    });

    it('retries a pending Type-A claim operation without advancing the durable cursor', async () => {
        const { plugin, repository } = createBootstrapHarness();
        Object.assign(plugin.settings, { memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 } });
        plugin.memoryLifecycleMutationTail = Promise.resolve();
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        await plugin.initializeMemoryGovernanceBootstrap();
        const baseline = await plugin.captureGovernedTypeAAdmissionBaseline();
        plugin.memoryAdmissionCoordinator = {
            admit: jest.fn(async () => ({ ok: false, reason: 'claim_operation_pending' })),
        };
        const host = ordinaryTypeAEvidence('Please review changes with evidence first.', 'conversation-pending', 4);
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
                chatEvidence: host.chatEvidence,
            }],
            markdown: '# User Profile',
        };

        await expect(plugin.admitGovernedTypeABatch({
            current: null,
            proposed,
            baseline,
            evidence: host.evidence,
            candidates: [{
                key: 'review-style',
                text: 'Please review changes with evidence first.',
                kind: 'user_explicit',
                confidence: 'high',
                conversationId: 'conversation-pending',
                observedAt: createdAt,
                chatEvidence: host.chatEvidence,
            }],
        })).resolves.toEqual({ status: 'retry' });
        expect(plugin.memoryAdmissionCoordinator.admit).toHaveBeenCalledTimes(1);

        const state = await repository.initialize();
        expect(state.policyStates[plugin.memoryGovernanceOpaqueVaultKey].typeAProcessedTurns)
            .toBeUndefined();
    });

    it.each(['missing_receipt', 'missing_host', 'ai_draft', 'user_local_edit', 'writing_request'] as const)(
        'does not admit a model-labelled explicit preference without eligible host evidence: %s', async (source) => {
            const { plugin, repository } = createBootstrapHarness();
            Object.assign(plugin.settings, { memoryExtractionEnabled: true,
                memoryExtractionConsent: { state: 'confirmed', version: 1 } });
            plugin.memoryLifecycleMutationTail = Promise.resolve();
            plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
            await plugin.initializeMemoryGovernanceBootstrap();
            const baseline = await plugin.captureGovernedTypeAAdmissionBaseline();
            const host = ordinaryTypeAEvidence('Please always answer with bullet points.', 'conversation-blocked', 1);
            const priorClaims = (await repository.initialize()).claims;
            const admit = jest.spyOn(plugin.memoryAdmissionCoordinator, 'admit');
            const record = { profileRecordId: 'profile-dddddddddddddddddddddddddddddddd', key: 'answer-structure',
                text: 'Please always answer with bullet points.', kind: 'user_explicit' as const, confidence: 'high' as const,
                conversationId: 'conversation-blocked', observedAt: createdAt, occurrences: 1,
                conversationIds: ['conversation-blocked'], confirmed: true,
                ...(source === 'missing_receipt' ? {} : { chatEvidence: host.chatEvidence }) };
            const chatMessages = source === 'missing_host' ? undefined : host.evidence.chatMessages.map((message) => ({
                ...message, kind: source === 'missing_receipt' ? message.kind : source,
            }));
            await expect(plugin.admitGovernedTypeABatch({ current: null,
                proposed: { updatedAt: createdAt, records: [record], markdown: '# User Profile' }, baseline,
                evidence: { ...host.evidence, chatMessages }, candidates: [record],
            })).resolves.toEqual({ status: 'processed' });
            expect(admit).not.toHaveBeenCalled();
            expect((await repository.initialize()).claims).toEqual(priorClaims);
        },
    );

    it.each(['valid', 'changed_text', 'missing_projection', 'missing_lifetime'] as const)(
        'routes semantic Type-A evidence through the plugin without legacy fallback: %s', async (mode) => {
            const { plugin, repository } = createBootstrapHarness();
            Object.assign(plugin.settings, { memoryExtractionEnabled: true,
                memoryExtractionConsent: { state: 'confirmed', version: 1 } });
            plugin.getPageletLocale = jest.fn(() => 'en');
            plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
            await plugin.initializeMemoryGovernanceBootstrap();
            const baseline = await plugin.captureGovernedTypeAAdmissionBaseline();
            const text = 'I prefer concise answers.';
            const sourceText = `${text} Rewrite this draft formally just this time.`;
            const projections = [{ source: { conversationId: 'semantic-conv', messageId: 'mixed-message',
                hostKind: 'writing_request' as const, text: sourceText, contentHash: semanticSourceHash(sourceText) },
                presentedText: sourceText }];
            const candidate = { text, meaning: 'independent_personal_statement' as const,
                kind: 'inferred_behavior' as const, confidence: 'medium' as const,
                quotes: [{ messageId: 'mixed-message', quote: text }] };
            const receipt = createChatMemorySemanticReceipt(candidate, 'semantic-conv', projections)!;
            expect(receipt).toBeDefined();
            const record = { ...candidate, text: mode === 'changed_text' ? 'Invented personal fact.' : text,
                profileRecordId: 'profile-dddddddddddddddddddddddddddddddd', key: deriveSemanticProfileKey(text),
                conversationId: 'semantic-conv', conversationIds: ['unproven-old-conv', 'semantic-conv'],
                observedAt: createdAt, occurrences: 1, confirmed: false, chatSemanticReceipt: receipt };
            const admit = jest.spyOn(plugin.memoryAdmissionCoordinator, 'admit');
            // Keep this test at the plugin/coordinator seam, without a Profile write.
            admit.mockResolvedValue({ ok: true, value: { decision: 'reject' } });
            const before = await repository.initialize();
            const result = await plugin.admitGovernedTypeABatch({ current: null,
                proposed: { updatedAt: createdAt, records: [record], markdown: '# User Profile' },
                candidates: [record], baseline, evidence: { conversationId: 'semantic-conv', throughTurnIndex: 1 },
                ...(mode === 'missing_projection' ? {} : { semanticProjections: projections }),
                ...(mode === 'missing_lifetime' ? {} : { isCurrent: () => true }),
            });
            if (mode === 'valid') {
                expect(result).toEqual({ status: 'processed' });
                expect(admit).toHaveBeenCalledWith(expect.objectContaining({
                    chatSemanticReceipt: receipt, ruleFingerprint: receipt.rule,
                    sourceFingerprintId: chatMemorySemanticSourceFingerprint(receipt), authority: 'pa_inference',
                    provenance: [{ kind: 'conversation', conversationIds: ['semantic-conv'], observedAt: createdAt }],
                    chatSemanticEvidence: { conversationId: 'semantic-conv', projections,
                        candidate: { text, meaning: candidate.meaning, kind: candidate.kind, confidence: candidate.confidence } },
                }), expect.objectContaining({ isCurrent: expect.any(Function) }));
            } else {
                expect(result).toEqual({ status: 'retry' });
                expect(admit).not.toHaveBeenCalled();
                expect(await repository.initialize()).toEqual(before);
            }
        },
    );

    it.each(['valid', 'deleted', 'deleted_during_projection', 'restart_missing_cache', 'restart_missing_source',
        'restart_wrong_key', 'restart_wrong_id', 'restart_late_history', 'restart_legacy_outbox',
        'restart_wrong_id_write_failure', 'restart_owned_conflict', 'forget_two_copies', 'forget_second_copy_failure'] as const)(
        'revalidates semantic Queue confirmation and Profile recovery from real history: %s', async (mode) => {
            const { plugin, repository, backend, readPersisted } = createBootstrapHarness();
            await plugin.initializeMemoryGovernanceBootstrap();
            plugin.getPageletLocale = jest.fn(() => 'en');
            plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
            const history = new ChatHistoryManager({ store: new MemoryChatHistoryStore(), generateId: () => 'semantic-live' });
            await history.initialize();
            const conversation = await history.startConversation('A mixed request');
            // Explicit but outside the low-risk allowlist: real policy requires review.
            const text = 'I prefer morning meetings.';
            const sourceText = `${text} Rewrite this draft formally just this time.`;
            await history.recordTurn({ conversation, conversationId: conversation.id, turnIndex: 0, userPrompt: sourceText,
                entry: { kind: 'history', user: { role: 'user', content: sourceText,
                    hostProvenance: { version: 1, kind: 'writing_request', messageId: 'semantic-live-source' } },
                    assistant: { role: 'assistant', content: 'Draft.' } } });
            plugin.chatHistoryManager = history;
            const profile = new MemoryUserProfileStore();
            plugin.createGovernedUserProfileStore = jest.fn(() => profile);
            const candidate = { text, meaning: 'independent_personal_statement' as const,
                kind: 'user_explicit' as const, confidence: 'medium' as const,
                quotes: [{ messageId: 'semantic-live-source', quote: text }] };
            const projections = [{ source: { conversationId: conversation.id, messageId: 'semantic-live-source',
                hostKind: 'writing_request' as const, text: sourceText, contentHash: semanticSourceHash(sourceText) },
                presentedText: sourceText }];
            const receipt = createChatMemorySemanticReceipt(candidate, conversation.id, projections)!;
            const record = { ...candidate, chatSemanticReceipt: receipt,
                profileRecordId: 'profile-dddddddddddddddddddddddddddddddd', key: deriveSemanticProfileKey(text),
                conversationId: conversation.id, conversationIds: [conversation.id], observedAt: createdAt,
                occurrences: 1, confirmed: false };
            const input = plugin.buildGovernedTypeAAdmission(plugin.memoryGovernanceOpaqueVaultKey, record,
                await plugin.captureGovernedTypeAAdmissionBaseline(),
                { conversationId: conversation.id, throughTurnIndex: 0 }, projections);
            expect(input).not.toBeNull();
            const admitted = await plugin.memoryAdmissionCoordinator.admit(input,
                { isCurrent: history.captureSourceLifetime(conversation.id) });
            expect(admitted).toMatchObject({ ok: true, value: { decision: 'require_prior_review' } });
            const queued = (await repository.initialize()).memoryQueueItems.find(
                (item) => item.governanceAdmission?.chatSemanticReceipt?.rule === receipt.rule,
            )!;
            expect(queued).toBeDefined();
            if (mode === 'deleted') await history.deleteConversation(conversation.id);
            if (mode === 'deleted_during_projection') {
                const getProfile = profile.getProfile.bind(profile);
                jest.spyOn(profile, 'getProfile').mockImplementationOnce(async () => {
                    await history.deleteConversation(conversation.id);
                    return getProfile();
                });
            }
            const confirmed = await plugin.confirmGovernedMemoryQueueItem(queued);
            const final = await repository.initialize();
            expect(confirmed.ok).toBe(mode !== 'deleted');
            if (mode === 'valid' || mode.startsWith('restart_') || mode.startsWith('forget_')) {
                expect((await profile.getProfile())?.records[0]).toMatchObject({ text,
                    kind: 'user_explicit', confidence: 'medium', confirmed: false });
                expect(final.pendingOperations.filter((operation) => operation.kind === 'profile_projection'))
                    .toEqual([expect.objectContaining({ state: 'applied' })]);
            } else {
                expect(await profile.getProfile()).toBeNull();
                if (mode === 'deleted') expect(final.memoryQueueItems.find((item) => item.id === queued.id)?.status).toBe('suggested');
                else expect(final.pendingOperations.some((operation) => operation.kind === 'profile_projection'
                    && operation.state === 'pending')).toBe(true);
            }
            expect((history as unknown as { sourceObservers: Map<string, unknown> }).sourceObservers.size).toBe(0);
            expect(plugin.createUserProfileStore).not.toHaveBeenCalled();
            if (mode.startsWith('forget_')) {
                const legacyProfile = new MemoryUserProfileStore();
                const current = (await profile.getProfile())!;
                const unrelated = { ...current.records[0], key: 'unrelated-old-row',
                    profileRecordId: 'profile-ffffffffffffffffffffffffffffffff', text: 'Keep this legacy note preference.' };
                await legacyProfile.setProfile({ ...current, records: [{ ...current.records[0], text: 'Old source wording.' }, unrelated] });
                plugin.createUserProfileStore = jest.fn(() => legacyProfile);
                const claimId = final.projectionLinks.find((link) => link.target.kind === 'type_a_profile'
                    && link.target.store === 'governed' && link.target.profileRecordId === record.profileRecordId)!.claimId;
                await repository.transact((draft) => {
                    draft.projectionLinks.push({ id: 'zz-legacy-profile-copy', claimId,
                        target: { kind: 'type_a_profile', profileRecordId: record.profileRecordId },
                        sourceFingerprintId: 'legacy-profile-original-source', ruleFingerprint: 'legacy-profile-v1',
                        relation: 'derived_copy', state: 'active', createdAt });
                });
                if (mode === 'forget_second_copy_failure') {
                    jest.spyOn(legacyProfile, 'setProfile').mockRejectedValueOnce(new Error('Legacy copy deletion failed'));
                }
                const forgotten = await plugin.memoryGovernanceCoordinator.forget({ claimId });
                if (mode === 'forget_second_copy_failure') {
                    expect(forgotten).toEqual({ ok: false, reason: 'projection_cleanup_failed', pending: true });
                    expect((await profile.getProfile())?.records).toEqual([]);
                    expect((await legacyProfile.getProfile())?.records.some((row) => row.profileRecordId === record.profileRecordId)).toBe(true);
                    await expect(plugin.memoryGovernanceCoordinator.resumePendingForgets()).resolves.toMatchObject({ ok: true });
                } else expect(forgotten.ok).toBe(true);
                expect((await profile.getProfile())?.records).toEqual([]);
                expect((await legacyProfile.getProfile())?.records.map((row) => JSON.stringify(row))).toEqual([JSON.stringify(unrelated)]);
                expect((await repository.initialize()).claims.find((claim) => claim.id === claimId)?.lifecycle).toBe('forgotten_tombstone');
            }
            if (mode.startsWith('restart_')) {
                if (mode === 'restart_missing_source') await history.deleteConversation(conversation.id);
                if (mode === 'restart_legacy_outbox') {
                    await repository.transact((draft) => {
                        const operation = draft.pendingOperations.find((entry) => entry.kind === 'profile_projection');
                        if (operation?.kind !== 'profile_projection') throw new Error('Profile outbox missing');
                        operation.state = 'pending';
                        delete operation.profileStore;
                        delete operation.profileKey;
                    });
                }
                const restarted = createBootstrapHarness(backend, readPersisted());
                const restoredProfile = new MemoryUserProfileStore();
                if (mode !== 'restart_late_history') restarted.plugin.chatHistoryManager = history;
                if (mode === 'restart_wrong_key' || mode === 'restart_wrong_id'
                    || mode === 'restart_wrong_id_write_failure' || mode === 'restart_owned_conflict') {
                    const existing = (await profile.getProfile())!;
                    await restoredProfile.setProfile({ ...existing, records: existing.records.map((row) => ({ ...row,
                        ...(mode === 'restart_wrong_key' ? { key: 'corrupt-cache-key' }
                            : { profileRecordId: 'profile-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }),
                    })) });
                }
                restarted.plugin.createGovernedUserProfileStore = jest.fn(() => restoredProfile);
                restarted.plugin.createExistingGovernedUserProfileReader = jest.fn(() => ({
                    read: async () => ({ state: 'ready', snapshot: await restoredProfile.getProfile() }),
                }));
                if (mode === 'restart_owned_conflict') {
                    const canonical = await repository.initialize();
                    const semanticClaimId = canonical.projectionLinks.find((link) => link.target.kind === 'review_queue'
                        && link.target.itemId === queued.id)?.claimId;
                    const otherClaim = canonical.claims.find((claim) => claim.id !== semanticClaimId
                        && claim.partition.kind === 'vault');
                    if (!otherClaim) throw new Error('Other canonical claim missing');
                    canonical.projectionLinks.push({ id: 'other-owned-profile', claimId: otherClaim.id,
                        target: { kind: 'type_a_profile', store: 'governed',
                            profileRecordId: 'profile-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                            profileKey: deriveSemanticProfileKey('A different canonical statement') },
                        relation: 'derived_copy', state: 'active', createdAt });
                    restarted.plugin.memoryGovernanceOpaqueVaultKey = plugin.memoryGovernanceOpaqueVaultKey;
                    const beforeRepair = await restoredProfile.getProfile();
                    await expect(restarted.plugin.repairGovernedProfileIdentity(record.profileRecordId,
                        record.key, canonical)).rejects.toThrow('another canonical target');
                    expect(await restoredProfile.getProfile()).toEqual(beforeRepair);
                    expect(restarted.plugin.createUserProfileStore).not.toHaveBeenCalled();
                    return;
                }
                if (mode === 'restart_wrong_id_write_failure') {
                    const write = restoredProfile.setProfile.bind(restoredProfile);
                    let fail = true;
                    jest.spyOn(restoredProfile, 'setProfile').mockImplementation(async (next, guard) => {
                        if (fail && next.records.some((row) => row.profileRecordId === record.profileRecordId)) {
                            fail = false;
                            throw new Error('Derived cache write temporarily failed');
                        }
                        return write(next, guard);
                    });
                }
                await restarted.plugin.initializeMemoryGovernanceBootstrap();
                if (mode === 'restart_wrong_id_write_failure') {
                    expect((await restoredProfile.getProfile())?.records).toEqual([]);
                    expect((await restarted.repository.initialize()).pendingOperations.some(
                        (operation) => operation.kind === 'profile_projection' && operation.state === 'pending',
                    )).toBe(true);
                    await restarted.plugin.memoryProfileProjectionWorker.resumePending();
                }
                if (mode === 'restart_late_history') {
                    expect(await restoredProfile.getProfile()).toBeNull();
                    const worker = restarted.plugin.memoryProfileProjectionWorker;
                    const resume = worker.resumePending.bind(worker);
                    const recovered = new Promise<void>((resolve, reject) => {
                        jest.spyOn(worker, 'resumePending').mockImplementationOnce(async () => {
                            try { const result = await resume(); resolve(); return result; }
                            catch (error) { reject(error); throw error; }
                        });
                    });
                    restarted.plugin.chatHistoryManager = history;
                    await recovered;
                    await restarted.plugin.memoryLifecycleMutationTail;
                }
                const baseline = await restarted.plugin.captureGovernedTypeAAdmissionBaseline();
                expect(baseline.profileRecordIdsByKey[record.key]).toBe(record.profileRecordId);
                const restored = await restoredProfile.getProfile();
                const restoredState = await restarted.repository.initialize();
                if (mode !== 'restart_missing_source') {
                    expect(restored?.records[0]).toMatchObject({ profileRecordId: record.profileRecordId,
                        key: record.key, text });
                    expect(restoredState.pendingOperations.filter((operation) => operation.kind === 'profile_projection'))
                        .toEqual([expect.objectContaining({ state: 'applied', profileStore: 'governed', profileKey: record.key })]);
                } else {
                    expect(restored).toBeNull();
                    expect(restoredState.pendingOperations.some((operation) => operation.kind === 'profile_projection'
                        && operation.state === 'pending')).toBe(true);
                }
                expect(restarted.plugin.createUserProfileStore).not.toHaveBeenCalled();
                expect((history as unknown as { sourceObservers: Map<string, unknown> }).sourceObservers.size).toBe(0);
            }
        },
    );

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

    it.each(['missing', 'existing'] as const)(
        'keeps a superseded exact Profile projection pending without changing a %s row', async (rowState) => {
            const { plugin, repository } = createBootstrapHarness();
            await plugin.initializeMemoryGovernanceBootstrap();
            const vaultKey = plugin.memoryGovernanceOpaqueVaultKey as string;
            const profileRecordId = 'profile-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
            const claimId = 'claim-exact-profile-race';
            const targetRevisionId = 'revision-exact-profile-original';
            const nextRevisionId = 'revision-exact-profile-corrected';
            const operationId = 'operation-exact-profile-original';
            const correctedSummary = 'Use the current evidence-first preference.';
            await repository.transact((draft) => {
                draft.claims.push({
                    id: claimId, partition: { kind: 'vault', key: vaultKey },
                    memoryType: 'preference', sensitivity: 'low', applicability: { kind: 'whole_vault' },
                    activeRevisionId: targetRevisionId, effect: 'future_answers', lifecycle: 'active',
                    createdAt, updatedAt: createdAt,
                });
                draft.revisions.push({
                    id: targetRevisionId, claimId, summary: 'The old preference must not be projected.',
                    provenance: [{ kind: 'conversation', conversationIds: ['conversation-original'], observedAt: createdAt }],
                    authority: 'explicit_user', createdAt,
                });
                draft.projectionLinks.push({
                    id: 'link-exact-profile-race', claimId,
                    target: { kind: 'type_a_profile', profileRecordId }, relation: 'origin', state: 'active',
                    sourceFingerprintId: 'source-exact-profile-race', ruleFingerprint: 'type-a-v1', createdAt,
                });
                draft.pendingOperations.push({
                    id: operationId, kind: 'profile_projection', claimId, profileRecordId, targetRevisionId,
                    state: 'pending', attemptCount: 0, createdAt, updatedAt: createdAt,
                });
            });
            let profile: UserProfileSnapshot | null = rowState === 'missing' ? null : {
                updatedAt: createdAt, markdown: '# User Profile', records: [{
                    profileRecordId, key: 'existing-preference', text: 'Keep the existing Profile row unchanged.',
                    kind: 'user_correction', confidence: 'high', conversationId: 'conversation-existing',
                    observedAt: createdAt, occurrences: 1, conversationIds: ['conversation-existing'], confirmed: true,
                }],
            };
            const originalProfile = JSON.parse(JSON.stringify(profile)) as UserProfileSnapshot | null;
            const mutateUserProfile = jest.fn(async (
                operation: (current: UserProfileSnapshot | null) => UserProfileSnapshot,
            ) => {
                profile = operation(profile);
                return JSON.parse(JSON.stringify(profile));
            });
            plugin.memoryExtractionScheduler = { dispose: jest.fn(), mutateUserProfile };
            const applyProjection = plugin.applyExactProfileProjection.bind(plugin) as (...args: unknown[]) => Promise<void>;
            const apply = jest.spyOn(plugin, 'applyExactProfileProjection').mockImplementationOnce(async (...args: unknown[]) => {
                // The real worker has selected the original outbox revision;
                // a correction wins before the plugin reads projection evidence.
                await repository.transact((draft) => {
                    const claim = draft.claims.find((candidate) => candidate.id === claimId)!;
                    draft.revisions.push({
                        id: nextRevisionId, claimId, summary: correctedSummary,
                        provenance: [{ kind: 'conversation', conversationIds: ['conversation-corrected'], observedAt: createdAt }],
                        authority: 'user_correction', supersedesRevisionId: targetRevisionId, createdAt,
                    });
                    claim.activeRevisionId = nextRevisionId;
                });
                return applyProjection(...args);
            });

            await expect(plugin.memoryProfileProjectionWorker.resumePending()).resolves.toEqual({
                completed: [], pending: [claimId],
            });
            expect(mutateUserProfile).not.toHaveBeenCalled();
            expect(profile).toEqual(originalProfile);
            expect((await repository.initialize()).pendingOperations).toContainEqual(expect.objectContaining({
                id: operationId, targetRevisionId, state: 'pending', attemptCount: 1,
                lastErrorCode: 'profile_projection_apply_failed',
            }));

            await repository.transact((draft) => {
                draft.pendingOperations.push({
                    id: 'operation-exact-profile-corrected', kind: 'profile_projection', claimId, profileRecordId,
                    targetRevisionId: nextRevisionId, state: 'pending', attemptCount: 0, createdAt, updatedAt: createdAt,
                });
            });
            await plugin.memoryProfileProjectionWorker.resumePending();

            expect(apply).toHaveBeenCalledTimes(2);
            expect(mutateUserProfile).toHaveBeenCalledTimes(1);
            expect((profile as UserProfileSnapshot | null)?.records).toEqual([
                expect.objectContaining({ profileRecordId, text: correctedSummary }),
            ]);
            if (rowState === 'missing') {
                expect((profile as UserProfileSnapshot | null)?.records[0].conversationIds)
                    .toEqual(['conversation-corrected']);
            }
            expect((await repository.initialize()).pendingOperations).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: operationId, targetRevisionId, state: 'pending', attemptCount: 2,
                    lastErrorCode: 'profile_projection_state_changed',
                }),
                expect.objectContaining({
                    id: 'operation-exact-profile-corrected', targetRevisionId: nextRevisionId, state: 'applied',
                }),
            ]));
        },
    );

    it('upserts a new governed Type-A Profile projection from authoritative conversation evidence', async () => {
        const { plugin, repository } = createBootstrapHarness();
        Object.assign(plugin.settings, { memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 } });
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
        const host = ordinaryTypeAEvidence('Please always answer with bullet points.', 'conversation-new', 1);
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
            chatEvidence: host.chatEvidence,
        };
        const proposed: UserProfileSnapshot = {
            updatedAt: createdAt,
            records: [record],
            markdown: '# User Profile',
        };
        const baseline = await plugin.captureGovernedTypeAAdmissionBaseline();
        const admit = jest.spyOn(plugin.memoryAdmissionCoordinator, 'admit');

        await expect(plugin.admitGovernedTypeABatch({
            current: null,
            proposed,
            baseline,
            evidence: host.evidence,
            candidates: [{
                key: record.key,
                text: record.text,
                kind: record.kind,
                confidence: record.confidence,
                conversationId: record.conversationId,
                observedAt: record.observedAt,
                chatEvidence: host.chatEvidence,
            }],
        })).resolves.toEqual({ status: 'processed' });
        expect(admit).toHaveBeenCalledTimes(1);
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
        const staleHost = ordinaryTypeAEvidence('Old in-flight extraction must not win.', 'conversation-new', 2);
        const staleProposed: UserProfileSnapshot = {
            ...staleCurrent,
            records: [{
                ...staleCurrent.records[0],
                text: 'Old in-flight extraction must not win.',
                chatEvidence: staleHost.chatEvidence,
            }],
        };
        await expect(plugin.admitGovernedTypeABatch({
            current: staleCurrent,
            proposed: staleProposed,
            baseline: staleBaseline,
            evidence: staleHost.evidence,
            candidates: [{
                key: record.key,
                text: 'Old in-flight extraction must not win.',
                kind: record.kind,
                confidence: record.confidence,
                conversationId: record.conversationId,
                observedAt: record.observedAt,
                chatEvidence: staleHost.chatEvidence,
            }],
        })).resolves.toEqual({ status: 'processed' });
        // The stale batch reaches governance with valid host evidence. It must
        // lose to the user's correction, rather than pass via a missing receipt.
        expect(admit).toHaveBeenCalledTimes(2);
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
            mockCloseAllShareCardModals.mockClear();
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
            const disposeOperationsService = jest.fn();
            plugin.operationsService = { dispose: disposeOperationsService };
            plugin.pageletOperationsSession = {};
            plugin.pageletOperationsSelfWrites = new Map([[
                'notes/pending-self-write.md',
                { count: 1, expiresAt: Date.now() + 10_000 },
            ]]);
            plugin.scheduleMemoryForgetRetry();
            plugin.memoryForgetRetryDelayMs = 4_000;

            expect(plugin.memoryForgetRetryTimer).not.toBeNull();
            expect(plugin.memoryGovernanceGarbageCollectionTimer).not.toBeNull();

            await plugin.unloadAsync();

            expect(mockCloseAllShareCardModals).toHaveBeenCalledTimes(1);
            expect(unsubscribe).toHaveBeenCalledTimes(1);
            expect(disposeAdapter).toHaveBeenCalledTimes(1);
            expect(disposeRepository).toHaveBeenCalledTimes(1);
            expect(plugin.memoryForgetRetryTimer).toBeNull();
            expect(plugin.memoryForgetRetryDelayMs).toBe(1_000);
            expect(plugin.memoryGovernanceGarbageCollectionTimer).toBeNull();
            expect(disposeOperationsService).toHaveBeenCalledTimes(1);
            expect(plugin.operationsService).toBeNull();
            expect(plugin.pageletOperationsSession).toBeNull();
            expect(plugin.pageletOperationsSelfWrites.size).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('Scope Recap production adapter data boundary', () => {
    function createScopeRecapGuardHarness() {
        let alphaContent = 'Alpha commits to shipping the feature.';
        const notes = () => [{
            path: 'Projects/PA/Alpha.md',
            title: 'Alpha',
            content: alphaContent,
        }, {
            path: 'Projects/PA/Beta.md',
            title: 'Beta',
            content: 'Beta records a pause decision for the same feature.',
        }];
        const invoke = jest.fn(async (_prompt: string): Promise<unknown> => JSON.stringify([{
            title: 'The plan and pause decision now conflict',
            summary: 'Alpha commits to ship while Beta records a pause for the same feature.',
            whyItMatters: 'The owner should resolve the conflict before the next release step.',
            sourceNoteTitles: ['Alpha', 'Beta'],
            section: 'tension',
        }]));
        let reserveImpl: () => Promise<
            { ok: true } | { ok: false; reason: 'hr-cap' }
        > = async () => ({ ok: true as const });
        const reserve = jest.fn(() => reserveImpl());
        const reserveIf = jest.fn(async (canCommit: () => boolean | PromiseLike<boolean>) => {
            const decision = await reserve();
            if (!decision.ok) return decision;
            return await canCommit()
                ? decision
                : { ok: false as const, reason: 'condition' as const };
        });
        const leaseCommit = jest.fn();
        const leaseRollback = jest.fn(async () => undefined);
        const reserveLeaseIf = jest.fn(async (
            canCommit: () => boolean | PromiseLike<boolean>,
        ) => {
            const decision = await reserve();
            if (!decision.ok) return decision;
            if (!await canCommit()) {
                return { ok: false as const, reason: 'condition' as const };
            }
            return {
                ok: true as const,
                reservation: { commit: leaseCommit, rollback: leaseRollback },
            };
        });
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.unloading = false;
        plugin.settings = {
            aiProvider: 'openai',
            chatModelName: 'gpt-4o-mini',
            baseURL: 'https://api.openai.com/v1',
            pagelet: {
                enabled: true,
                temperature: 0.2,
                maxOutputTokens: 2_000,
                scopeRecapBackgroundAuthorization: 'pending',
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: null,
                pageletProviderFirstUseNotified: false,
            },
        };
        plugin.saveSettings = jest.fn(async () => undefined);
        plugin.collectScopeRecapSourceNotes = jest.fn(async () => notes());
        plugin.scopeRecapBuildOptions = jest.fn((currentNotes: Array<{ path: string }>) => ({
            now: new Date('2026-07-18T12:00:00.000Z'),
            scope: {
                kind: 'folder',
                label: 'Projects/PA',
                paths: currentNotes.map((note: { path: string }) => note.path),
            },
            isPathAllowed: jest.fn(() => true),
            dataBoundarySnapshotId: 'data_boundary:test',
        }));
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'data_boundary:test');
        plugin.getScopeRecapAuthorizationContextId = jest.fn(() => 'scope-recap-auth:test');
        plugin.createChatModel = jest.fn(async () => ({ invoke }));
        plugin.getScopeRecapRateLimiter = jest.fn(() => ({
            reserve,
            reserveIf,
            reserveLeaseIf,
        }));
        plugin.pageletCostTracker = {
            record: jest.fn(() => ({
                inputTokens: 100,
                outputTokens: 20,
                estimatedCost: 0.001,
                currency: 'USD',
                pricingKnown: true,
            })),
        };
        plugin.log = jest.fn();
        return {
            plugin,
            invoke,
            reserve,
            reserveLeaseIf,
            leaseCommit,
            leaseRollback,
            setAlphaContent(value: string) { alphaContent = value; },
            setReserve(fn: () => Promise<{ ok: true } | { ok: false; reason: 'hr-cap' }>) {
                reserveImpl = fn;
            },
        };
    }

    it('shows the shared notice only at the first actual Recap invocation and keeps the run non-blocking', async () => {
        mockNoticeMessages.length = 0;
        const harness = createScopeRecapGuardHarness();

        const first = await harness.plugin.runScopeRecap({ mode: 'background' });
        const second = await harness.plugin.runScopeRecap({ mode: 'background' });

        expect(first.status).toBe('ready');
        expect(second.status).toBe('ready');
        expect(harness.invoke).toHaveBeenCalledTimes(2);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
        expect(harness.plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('does not show or persist the shared notice when Recap is blocked before invocation', async () => {
        mockNoticeMessages.length = 0;
        const harness = createScopeRecapGuardHarness();
        harness.setReserve(async () => ({ ok: false, reason: 'hr-cap' }));

        const result = await harness.plugin.runScopeRecap({ mode: 'background' });

        expect(result.status).toBe('no_reliable_insight');
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(harness.plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('shares one first-use notice from Recap into the Quiet Recall invocation seam', async () => {
        mockNoticeMessages.length = 0;
        const harness = createScopeRecapGuardHarness();
        const recallInvoke = jest.fn(async () => JSON.stringify({
            isConvincing: false,
            whyNow: '',
        }));

        await harness.plugin.runScopeRecap({ mode: 'background' });
        await harness.plugin.evaluateQuietRecallProviderAttempt(
            { invoke: recallInvoke },
            'Evaluate this local candidate.',
            'Current note body.',
            'initial',
            { provider: 'openai', model: 'gpt-4o-mini' },
            () => true,
        );

        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(recallInvoke).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('shares one first-use notice from Quiet Recall into the later Recap seam', async () => {
        mockNoticeMessages.length = 0;
        const harness = createScopeRecapGuardHarness();
        const recallInvoke = jest.fn(async () => JSON.stringify({
            isConvincing: false,
            whyNow: '',
        }));

        await harness.plugin.evaluateQuietRecallProviderAttempt(
            { invoke: recallInvoke },
            'Evaluate this local candidate.',
            'Current note body.',
            'initial',
            { provider: 'openai', model: 'gpt-4o-mini' },
            () => true,
        );
        await harness.plugin.runScopeRecap({ mode: 'background' });

        expect(recallInvoke).toHaveBeenCalledTimes(1);
        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('does not read or send Pagelet- or Data Boundary-excluded sources', async () => {
        const createScopeFile = (path: string, mtime: number) => {
            const file = createTFileWithStat(path, { mtime, size: 100 }) as TFile & { basename: string };
            file.basename = file.name.replace(/\.md$/i, '');
            return file;
        };
        const activeFile = createScopeFile('Projects/PA/Current.md', 4_000);
        const allowedFile = createScopeFile('Projects/PA/Allowed.md', 3_000);
        const pageletExcludedFile = createScopeFile('Projects/PA/pagelet-secret.md', 2_000);
        const boundaryExcludedFile = createScopeFile('Projects/PA/boundary-secret.md', 1_000);
        const files = [activeFile, allowedFile, pageletExcludedFile, boundaryExcludedFile];
        const contents = new Map<string, string>([
            [activeFile.path, '# Current\n\nShould we keep Redis for the next release?'],
            [allowedFile.path, '# Allowed\n\nALLOWED-DECISION-EVIDENCE supports keeping Redis.'],
            [pageletExcludedFile.path, '# Pagelet secret\n\nPAGELET-SECRET-PAYLOAD'],
            [boundaryExcludedFile.path, '# Boundary secret\n\nBOUNDARY-SECRET-PAYLOAD'],
        ]);
        const cachedRead = jest.fn(async (file: TFile) => contents.get(file.path) ?? '');
        const invoke = jest.fn(async (_prompt: string) => JSON.stringify([{
            title: 'Redis release decision needs confirmation',
            summary: 'Current asks whether to keep Redis while Allowed records supporting release evidence.',
            whyItMatters: 'The release owner should confirm that the older benchmark still applies before shipping.',
            sourceNoteTitles: ['Current', 'Allowed'],
            section: 'open_question',
        }]));
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            aiProvider: 'openai',
            chatModelName: 'gpt-4o-mini',
            pagelet: {
                enabled: true,
                temperature: 0.2,
                maxOutputTokens: 2_000,
                reviewsFolder: '.pagelet',
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: ['pagelet-secret'],
                scopeRecapBackgroundAuthorization: 'authorized-v1',
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: 'scope-recap-auth:test',
            },
            dataBoundary: {
                excludedFolders: [],
                excludedTags: ['boundary-private'],
                generatedNotePolicy: 'include-generated',
                providerDisclosureReasons: [],
                cleanupGroups: [],
            },
        };
        plugin.app = {
            workspace: { getActiveFile: jest.fn(() => activeFile) },
            vault: {
                configDir: '.obsidian',
                getMarkdownFiles: jest.fn(() => files),
                getAbstractFileByPath: jest.fn((path: string) => files.find((file) => file.path === path) ?? null),
                cachedRead,
            },
            metadataCache: {
                getFileCache: jest.fn((file: TFile) => (
                    file.path === boundaryExcludedFile.path
                        ? { tags: [{ tag: '#boundary-private' }] }
                        : null
                )),
            },
        };
        plugin.createChatModel = jest.fn(async () => ({ invoke }));
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'data_boundary:test');
        plugin.getScopeRecapAuthorizationContextId = jest.fn(() => 'scope-recap-auth:test');
        plugin.getScopeRecapRateLimiter = jest.fn(() => ({
            reserve: jest.fn(async () => ({ ok: true as const })),
            reserveLeaseIf: jest.fn(async (canCommit: () => boolean | PromiseLike<boolean>) => (
                await canCommit()
                    ? {
                        ok: true as const,
                        reservation: {
                            commit: jest.fn(),
                            rollback: jest.fn(async () => undefined),
                        },
                    }
                    : { ok: false as const, reason: 'condition' as const }
            )),
        }));
        plugin.pageletCostTracker = {
            record: jest.fn(() => ({
                inputTokens: 100,
                outputTokens: 20,
                estimatedCost: 0.001,
                currency: 'USD',
            })),
        };
        plugin.log = jest.fn();

        const result = await plugin.runScopeRecap({ mode: 'background' });
        const prompt = invoke.mock.calls[0]?.[0] as string;

        expect(result.status).toBe('ready');
        expect(cachedRead.mock.calls.map(([file]) => file.path)).toEqual([
            activeFile.path,
            allowedFile.path,
            activeFile.path,
            allowedFile.path,
            activeFile.path,
            allowedFile.path,
            activeFile.path,
            allowedFile.path,
        ]);
        expect(prompt).toContain('ALLOWED-DECISION-EVIDENCE');
        expect(prompt).not.toContain('PAGELET-SECRET-PAYLOAD');
        expect(prompt).not.toContain('BOUNDARY-SECRET-PAYLOAD');
        expect(prompt).not.toContain('pagelet-secret');
        expect(prompt).not.toContain('boundary-secret');
    });

    it('counts the full folder and applies the 12-source provider cap after Data Boundary filtering', async () => {
        const now = Date.now();
        const makeFile = (path: string, mtime: number) => {
            const file = createTFileWithStat(path, { mtime, size: 100 }) as TFile & { basename: string };
            file.basename = file.name.replace(/\.md$/i, '');
            return file;
        };
        const activeFile = makeFile('Projects/PA/Current.md', now);
        const allowedFiles = Array.from({ length: 13 }, (_, index) => makeFile(
            `Projects/PA/Allowed-${String(index + 1).padStart(2, '0')}.md`,
            now - (index + 1) * 1_000,
        ));
        const excludedFiles = [
            makeFile('Projects/PA/Private-01.md', now + 2_000),
            makeFile('Projects/PA/Private-02.md', now + 1_000),
        ];
        const files = [activeFile, ...allowedFiles, ...excludedFiles];
        const contents = new Map(files.map((file) => [
            file.path,
            `${file.basename.toUpperCase()}-EVIDENCE`,
        ]));
        const cachedRead = jest.fn(async (file: TFile) => contents.get(file.path) ?? '');
        const invoke = jest.fn(async (_prompt: string) => JSON.stringify([{
            title: 'Current and Allowed 01 identify a release tension',
            summary: 'The current note and Allowed 01 record conflicting release direction.',
            whyItMatters: 'The owner should resolve this before the release advances.',
            sourceNoteTitles: ['Current', 'Allowed-01'],
            section: 'tension',
        }]));
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.unloading = false;
        plugin.settings = {
            aiProvider: 'openai',
            chatModelName: 'gpt-4o-mini',
            pagelet: {
                enabled: true,
                temperature: 0.2,
                maxOutputTokens: 2_000,
                reviewsFolder: '.pagelet',
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                scopeRecapBackgroundAuthorization: 'authorized-v1',
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: 'scope-recap-auth:test',
            },
            dataBoundary: {
                excludedFolders: [],
                excludedTags: ['boundary-private'],
                generatedNotePolicy: 'include-generated',
                providerDisclosureReasons: [],
                cleanupGroups: [],
            },
        };
        plugin.app = {
            workspace: { getActiveFile: jest.fn(() => activeFile) },
            vault: {
                configDir: '.obsidian',
                getMarkdownFiles: jest.fn(() => files),
                getAbstractFileByPath: jest.fn((path: string) => files.find((file) => file.path === path) ?? null),
                cachedRead,
            },
            metadataCache: {
                getFileCache: jest.fn((file: TFile) => (
                    excludedFiles.includes(file as typeof excludedFiles[number])
                        ? { tags: [{ tag: '#boundary-private' }] }
                        : null
                )),
            },
        };
        plugin.createChatModel = jest.fn(async () => ({ invoke }));
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'data_boundary:test');
        plugin.getScopeRecapAuthorizationContextId = jest.fn(() => 'scope-recap-auth:test');
        plugin.getScopeRecapRateLimiter = jest.fn(() => ({
            reserve: jest.fn(async () => ({ ok: true as const })),
            reserveLeaseIf: jest.fn(async (canCommit: () => boolean | PromiseLike<boolean>) => (
                await canCommit()
                    ? {
                        ok: true as const,
                        reservation: {
                            commit: jest.fn(),
                            rollback: jest.fn(async () => undefined),
                        },
                    }
                    : { ok: false as const, reason: 'condition' as const }
            )),
        }));
        plugin.pageletCostTracker = {
            record: jest.fn(() => ({
                inputTokens: 100,
                outputTokens: 20,
                estimatedCost: 0.001,
                currency: 'USD',
                pricingKnown: true,
            })),
        };
        plugin.log = jest.fn();

        const result = await plugin.runScopeRecap({ mode: 'background' });
        const prompt = invoke.mock.calls[0]?.[0] as string;

        expect(result.status).toBe('ready');
        expect(result.localOverview.sourceCoverage).toEqual({
            totalSourceCount: 16,
            includedSourceCount: 12,
            skippedSourceCount: 4,
            coverageRatio: 0.75,
        });
        expect(result.localOverview.skippedSources).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'data_boundary', count: 2 }),
            expect.objectContaining({ reason: 'out_of_scope', count: 2 }),
        ]));
        if (result.status === 'ready') {
            expect(result.artifact.sourceRefs).toHaveLength(12);
        }
        expect(cachedRead).toHaveBeenCalledTimes(48);
        const readPaths = new Set(cachedRead.mock.calls.map(([file]) => file.path));
        expect(readPaths).toEqual(new Set([
            activeFile.path,
            ...allowedFiles.slice(0, 11).map((file) => file.path),
        ]));
        expect(prompt).toContain('ALLOWED-11-EVIDENCE');
        expect(prompt).not.toContain('ALLOWED-12-EVIDENCE');
        expect(prompt).not.toContain('ALLOWED-13-EVIDENCE');
        expect(prompt).not.toContain('PRIVATE-01-EVIDENCE');
        expect(prompt).not.toContain('PRIVATE-02-EVIDENCE');
    });

    it.each([
        'expectedSourceSnapshotId',
        'expectedDataBoundarySnapshotId',
        'expectedAuthorizationContextId',
    ] as const)('does not initialize a model or invoke the provider when %s drifts', async (driftField) => {
        const notes = [{
            path: 'Projects/PA/Alpha.md',
            title: 'Alpha',
            content: 'Alpha commits to shipping the feature.',
        }, {
            path: 'Projects/PA/Beta.md',
            title: 'Beta',
            content: 'Beta records a pause decision for the same feature.',
        }];
        const invoke = jest.fn(async () => '[]');
        const createChatModel = jest.fn(async () => ({ invoke }));
        const reserve = jest.fn(async () => ({ ok: true as const }));
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            aiProvider: 'openai',
            chatModelName: 'gpt-4o-mini',
            pagelet: {
                enabled: true,
                temperature: 0.2,
                maxOutputTokens: 2_000,
                scopeRecapBackgroundAuthorization: 'authorized-v1',
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: 'scope-recap-auth:current',
            },
        };
        plugin.collectScopeRecapSourceNotes = jest.fn(async () => notes);
        plugin.scopeRecapBuildOptions = jest.fn(() => ({
            now: new Date('2026-07-18T12:00:00.000Z'),
            scope: {
                kind: 'folder',
                label: 'Projects/PA',
                paths: notes.map((note) => note.path),
            },
            isPathAllowed: jest.fn(() => true),
            dataBoundarySnapshotId: 'data_boundary:current',
        }));
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'data_boundary:current');
        plugin.getScopeRecapAuthorizationContextId = jest.fn(() => 'scope-recap-auth:current');
        plugin.createChatModel = createChatModel;
        plugin.getScopeRecapRateLimiter = jest.fn(() => ({
            reserve,
            reserveLeaseIf: jest.fn(async (canCommit: () => boolean | PromiseLike<boolean>) => {
                if (!await canCommit()) {
                    return { ok: false as const, reason: 'condition' as const };
                }
                const decision = await reserve();
                return decision.ok
                    ? {
                        ok: true as const,
                        reservation: {
                            commit: jest.fn(),
                            rollback: jest.fn(async () => undefined),
                        },
                    }
                    : decision;
            }),
        }));
        plugin.pageletCostTracker = { record: jest.fn() };
        plugin.log = jest.fn();

        const overview = await plugin.buildScopeRecapLocalOverview();
        const expected = {
            expectedSourceSnapshotId: overview.sourceSnapshotId,
            expectedDataBoundarySnapshotId: 'data_boundary:current',
            expectedAuthorizationContextId: 'scope-recap-auth:current',
        };
        expected[driftField] = `${expected[driftField]}:stale`;

        const result = await plugin.runScopeRecap({ mode: 'background', ...expected });

        expect(result.status).toBe('no_reliable_insight');
        expect(result.attempt.providerCallMade).toBe(false);
        expect(createChatModel).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
        expect(plugin.pageletCostTracker.record).not.toHaveBeenCalled();
    });

    it.each([
        ['background preparation disabled', (plugin: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            plugin.settings.pagelet.scopeRecapPreparationEnabled = false;
        }],
        ['plugin unload started', (plugin: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            plugin.unloading = true;
        }],
    ] as const)('rechecks %s after limiter wait and makes no provider call', async (_label, mutate) => {
        const harness = createScopeRecapGuardHarness();
        let markReserveEntered = (): void => undefined;
        const reserveEntered = new Promise<void>((resolve) => { markReserveEntered = resolve; });
        let releaseReserve = (): void => undefined;
        const reserveGate = new Promise<void>((resolve) => { releaseReserve = resolve; });
        harness.setReserve(async () => {
            markReserveEntered();
            await reserveGate;
            return { ok: true as const };
        });

        const running = harness.plugin.runScopeRecap({ mode: 'background' });
        await reserveEntered;
        mutate(harness.plugin);
        releaseReserve();
        const result = await running;

        expect(result.status).toBe('no_reliable_insight');
        expect(result.attempt.providerCallMade).toBe(false);
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(harness.plugin.pageletCostTracker.record).not.toHaveBeenCalled();
    });

    it('rechecks the complete source snapshot after limiter wait and makes no provider call when content changed', async () => {
        const harness = createScopeRecapGuardHarness();
        let markReserveEntered = (): void => undefined;
        const reserveEntered = new Promise<void>((resolve) => { markReserveEntered = resolve; });
        let releaseReserve = (): void => undefined;
        const reserveGate = new Promise<void>((resolve) => { releaseReserve = resolve; });
        harness.setReserve(async () => {
            markReserveEntered();
            await reserveGate;
            return { ok: true as const };
        });

        const running = harness.plugin.runScopeRecap({ mode: 'background' });
        await reserveEntered;
        harness.setAlphaContent('Alpha now cancels the release instead.');
        releaseReserve();
        const result = await running;

        expect(result.status).toBe('no_reliable_insight');
        expect(result.attempt.providerCallMade).toBe(false);
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(harness.plugin.collectScopeRecapSourceNotes).toHaveBeenCalledTimes(3);
    });

    it('rolls back a provisional Recap slot when the source drifts after reservation', async () => {
        mockNoticeMessages.length = 0;
        const harness = createScopeRecapGuardHarness();
        harness.reserveLeaseIf.mockImplementationOnce(async (canCommit) => {
            expect(await canCommit()).toBe(true);
            harness.setAlphaContent('Alpha changes after the provisional slot is persisted.');
            return {
                ok: true as const,
                reservation: {
                    commit: harness.leaseCommit,
                    rollback: harness.leaseRollback,
                },
            };
        });

        const result = await harness.plugin.runScopeRecap({ mode: 'background' });

        expect(result.status).toBe('no_reliable_insight');
        expect(result.attempt.providerCallMade).toBe(false);
        expect(harness.leaseRollback).toHaveBeenCalledTimes(1);
        expect(harness.leaseCommit).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('attributes Recap cost to the provider/model snapshot captured at call start', async () => {
        const harness = createScopeRecapGuardHarness();
        harness.invoke.mockImplementationOnce(async () => {
            harness.plugin.settings.aiProvider = 'qwen';
            harness.plugin.settings.chatModelName = 'later-model';
            return JSON.stringify([{
                title: 'The plan and pause decision now conflict',
                summary: 'Alpha commits to ship while Beta records a pause for the same feature.',
                whyItMatters: 'The owner should resolve the conflict before the next release step.',
                sourceNoteTitles: ['Alpha', 'Beta'],
                section: 'tension',
            }]);
        });

        const result = await harness.plugin.runScopeRecap({ mode: 'background' });

        expect(result.status).toBe('ready');
        expect(harness.plugin.pageletCostTracker.record).toHaveBeenCalledWith(expect.objectContaining({
            feature: 'scope-recap',
            provider: 'openai',
            model: 'gpt-4o-mini',
        }));
    });

    it('disables DashScope thinking for the bounded Recap JSON request', async () => {
        const harness = createScopeRecapGuardHarness();
        harness.plugin.settings.aiProvider = 'qwen';
        harness.plugin.settings.chatModelName = 'deepseek-v4-flash';
        harness.plugin.settings.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

        const result = await harness.plugin.runScopeRecap({ mode: 'background' });

        expect(result.status).toBe('ready');
        expect(harness.plugin.createChatModel).toHaveBeenCalledWith(0.2, {
            maxTokens: 1_000,
            qwenRequestOptions: { enableThinking: false },
        });
    });

    it('classifies an empty final answer as empty without retrying reasoning content', async () => {
        const harness = createScopeRecapGuardHarness();
        harness.invoke.mockResolvedValueOnce({
            content: '',
            additional_kwargs: { reasoning_content: 'Provider reasoning is not the final answer.' },
        });

        const result = await harness.plugin.runScopeRecap({ mode: 'background' });

        expect(result).toEqual(expect.objectContaining({
            status: 'no_reliable_insight',
            artifact: null,
            attempt: expect.objectContaining({
                outcome: 'empty',
                providerCallMade: true,
            }),
        }));
        expect(harness.reserve).toHaveBeenCalledTimes(1);
        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(harness.plugin.pageletCostTracker.record).toHaveBeenCalledWith(expect.objectContaining({
            feature: 'scope-recap',
            outcome: 'empty',
            outputTokens: 0,
        }));
    });

    it('keeps non-empty invalid JSON classified as malformed', async () => {
        const harness = createScopeRecapGuardHarness();
        harness.invoke.mockResolvedValueOnce({ content: 'not json' });

        const result = await harness.plugin.runScopeRecap({ mode: 'background' });

        expect(result).toEqual(expect.objectContaining({
            status: 'no_reliable_insight',
            artifact: null,
            attempt: expect.objectContaining({
                outcome: 'malformed',
                providerCallMade: true,
            }),
        }));
        expect(harness.reserve).toHaveBeenCalledTimes(1);
        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(harness.plugin.pageletCostTracker.record).toHaveBeenCalledWith(expect.objectContaining({
            feature: 'scope-recap',
            outcome: 'malformed',
        }));
    });

    it.each([
        ['endpoint', (settings: Record<string, unknown>) => {
            settings.baseURL = 'https://gateway.example.test/v2';
        }],
        ['provider preset', (settings: Record<string, unknown>) => {
            settings.aiProviderPreset = 'custom';
        }],
        ['embedding model', (settings: Record<string, unknown>) => {
            settings.embeddingModelName = 'text-embedding-4-large';
        }],
    ] as const)('changes the Recap authorization context when the %s changes', (_label, mutate) => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            aiProvider: 'openai',
            aiProviderPreset: 'openai',
            chatModelName: 'gpt-4o-mini',
            embeddingModelName: 'text-embedding-3-small',
            baseURL: 'https://api.openai.com/v1/',
        };
        plugin.getPageletSettingsWithDataBoundary = jest.fn(() => ({
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: [],
            reviewsFolder: '.pagelet',
        }));
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'data_boundary:current');
        const initial = plugin.getScopeRecapAuthorizationContextId();

        mutate(plugin.settings);

        expect(plugin.getScopeRecapAuthorizationContextId()).not.toBe(initial);
    });
});

describe('Pagelet onboarding nudge production', () => {
    const createOnboardingHarness = (noteCount = 0) => {
        const setOnboardingNudge = jest.fn();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.unloading = false;
        plugin.settings = {
            focusMode: false,
            pagelet: {
                enabled: true,
                proactiveHints: true,
                maintenanceScanSuggested: false,
                quickCaptureExplained: false,
            },
        };
        plugin.app = {
            vault: {
                getMarkdownFiles: jest.fn(() => Array.from({ length: noteCount }, (_, index) => ({
                    path: `notes/${index}.md`,
                }))),
            },
        };
        plugin.pageletOrchestrator = { setOnboardingNudge };
        plugin.syncPageletRuntime = jest.fn();
        plugin.saveSettings = jest.fn(async () => undefined);
        return { plugin, setOnboardingNudge };
    };

    it('does not commit maintenance onboarding state when only signaling the orchestrator', async () => {
        const { plugin, setOnboardingNudge } = createOnboardingHarness(51);

        await plugin.maybeShowMaintenanceScanOnboardingNudge();

        expect(setOnboardingNudge).toHaveBeenCalledWith('maintenance_scan');
        expect(plugin.settings.pagelet.maintenanceScanSuggested).toBe(false);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('does not commit quick-capture onboarding state when only signaling the orchestrator', async () => {
        const { plugin, setOnboardingNudge } = createOnboardingHarness();

        await plugin.maybeShowQuickCaptureOnboardingNudge();

        expect(plugin.syncPageletRuntime).toHaveBeenCalledTimes(1);
        expect(setOnboardingNudge).toHaveBeenCalledWith('quick_capture');
        expect(plugin.settings.pagelet.quickCaptureExplained).toBe(false);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });
});

describe('Pagelet Discover provider first-use admission', () => {
    it('keeps the production Pagelet host wired to provider-admitted Discover retrieval', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            pagelet: {},
            contextPager: {},
            quietRecall: {},
            focusMode: false,
            confirmedMemoryCount: 0,
        };
        plugin.findPageletRelatedNotes = jest.fn(async () => []);

        const host = plugin.createPageletHost();
        await host.findRelatedNotes(
            'notes/current.md',
            [{ path: 'notes/current.md', content: 'Current note.' }],
            ['notes/current.md'],
        );

        expect(plugin.findPageletRelatedNotes).toHaveBeenCalledWith(
            'notes/current.md',
            [{ path: 'notes/current.md', content: 'Current note.' }],
            ['notes/current.md'],
            { limit: 6 },
        );
    });

    function createDiscoveryHarness(options: { allowed?: boolean; notified?: boolean } = {}) {
        const currentFile = createTFileWithStat('notes/current.md', { mtime: 1_000, size: 100 });
        const relatedFile = createTFileWithStat('notes/related.md', { mtime: 900, size: 90 });
        let relatedAvailable = true;
        let currentContent = 'SAFE CURRENT NOTE';
        let relatedContent = 'SAFE LIVE RELATED NOTE';
        let providerPolicyIdentity = 'provider-policy:test';
        const invoke = jest.fn(async (_prompt: string) => JSON.stringify({
            findings: [{
                text: 'These notes share a release constraint.',
                sourceFile: relatedFile.path,
                sourceTitle: 'related',
                category: 'connection',
            }],
        }));
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.unloading = false;
        plugin.settings = {
            aiProvider: 'openai',
            chatModelName: 'gpt-4o-mini',
            baseURL: 'https://api.openai.com/v1',
            pagelet: {
                enabled: true,
                maxInputTokens: 8_000,
                maxOutputTokens: 2_000,
                pageletProviderFirstUseNotified: options.notified ?? false,
                reviewsFolder: '.pagelet',
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
            },
            dataBoundary: {
                excludedFolders: [],
                excludedTags: [],
                generatedNotePolicy: 'exclude-generated',
            },
        };
        plugin.app = {
            workspace: { getActiveFile: jest.fn(() => currentFile) },
            vault: {
                getAbstractFileByPath: jest.fn((path: string) => {
                    if (path === currentFile.path) return currentFile;
                    if (path === relatedFile.path && relatedAvailable) return relatedFile;
                    return null;
                }),
                cachedRead: jest.fn(async (file: TFile) => (
                    file.path === currentFile.path ? currentContent : relatedContent
                )),
            },
            metadataCache: { getFileCache: jest.fn(() => null) },
        };
        plugin.isDataBoundaryAllowedPath = jest.fn(() => options.allowed ?? true);
        plugin.isDataBoundaryAllowedFile = jest.fn(() => options.allowed ?? true);
        plugin.createChatModel = jest.fn(async () => ({ invoke }));
        plugin.pageletCostTracker = { record: jest.fn() };
        plugin.getScopeRecapAuthorizationContextId = jest.fn(() => providerPolicyIdentity);
        plugin.reservePageletRateLimitSlot = jest.fn(async () => ({
            commit: jest.fn(),
            rollback: jest.fn(async () => undefined),
        }));
        plugin.saveSettings = jest.fn(async () => undefined);
        plugin.log = jest.fn();
        return {
            plugin,
            invoke,
            currentFile,
            relatedFile,
            setRelatedAvailable(value: boolean) { relatedAvailable = value; },
            setCurrentContent(value: string) { currentContent = value; },
            setRelatedContent(value: string) { relatedContent = value; },
            setProviderPolicyIdentity(value: string) { providerPolicyIdentity = value; },
        };
    }

    it('notifies once at the first actual Discover generation call and stays silent later', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        const currentNote = { path: harness.currentFile.path, content: 'Current note body.' };
        const relatedNotes = [{ path: harness.relatedFile.path, content: 'Related note body.' }];

        await harness.plugin.runDiscoveryAnalysis(currentNote, relatedNotes);
        await harness.plugin.runDiscoveryAnalysis(currentNote, relatedNotes);

        expect(harness.invoke).toHaveBeenCalledTimes(2);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
        expect(harness.plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('shares one first-use notice from Discover into the later Quiet Recall seam', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        const recallInvoke = jest.fn(async () => JSON.stringify({
            isConvincing: false,
            whyNow: '',
        }));

        await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'Current note body.' },
            [{ path: harness.relatedFile.path, content: 'Related note body.' }],
        );
        await harness.plugin.evaluateQuietRecallProviderAttempt(
            { invoke: recallInvoke },
            'Evaluate this local candidate.',
            'Current note body.',
            'initial',
            { provider: 'openai', model: 'gpt-4o-mini' },
            () => true,
        );

        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(recallInvoke).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('keeps a Data Boundary-denied Discover run at zero call and zero notice', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness({ allowed: false });

        const result = await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'PRIVATE CURRENT' },
            [{ path: harness.relatedFile.path, content: 'PRIVATE RELATED' }],
        );

        expect(result).toBeNull();
        expect(harness.plugin.createChatModel).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(harness.plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('keeps a deleted related source at zero generation call and zero first-use mutation', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.setRelatedAvailable(false);

        const result = await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'STALE CURRENT' },
            [{ path: harness.relatedFile.path, content: 'STALE RELATED' }],
        );

        expect(result).toBeNull();
        expect(harness.plugin.createChatModel).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(harness.plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('fails closed instead of treating an out-of-envelope Discover input as standard', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        const relatedNotes = Array.from({ length: 7 }, (_, index) => ({
            path: `notes/related-${index}.md`,
            content: `Related ${index}`,
        }));

        const result = await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'Current note.' },
            relatedNotes,
        );

        expect(result).toBeNull();
        expect(harness.plugin.createChatModel).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(harness.plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('keeps a Discover budget rejection before generation notice and invocation', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.plugin.reservePageletRateLimitSlot.mockRejectedValue(new Error('budget exhausted'));

        const result = await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'Current note.' },
            [{ path: harness.relatedFile.path, content: 'Related note.' }],
        );

        expect(result).toBeNull();
        expect(harness.plugin.reservePageletRateLimitSlot).toHaveBeenCalledTimes(1);
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(harness.plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('fails closed when the provider policy changes while Discover creates its model', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.plugin.createChatModel.mockImplementation(async () => {
            harness.setProviderPolicyIdentity('provider-policy:changed');
            return { invoke: harness.invoke };
        });

        const result = await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'Current note.' },
            [{ path: harness.relatedFile.path, content: 'Related note.' }],
        );

        expect(result).toBeNull();
        expect(harness.plugin.reservePageletRateLimitSlot).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('drops a Discover result that becomes stale during invocation and attributes cost to the admitted provider', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.invoke.mockImplementation(async () => {
            harness.plugin.settings.aiProvider = 'custom';
            harness.plugin.settings.chatModelName = 'replacement-model';
            harness.setProviderPolicyIdentity('provider-policy:changed');
            return JSON.stringify({ findings: [{
                text: 'Stale finding.',
                sourceFile: harness.relatedFile.path,
                sourceTitle: 'related',
                category: 'connection',
            }] });
        });

        const result = await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'Current note.' },
            [{ path: harness.relatedFile.path, content: 'Related note.' }],
        );

        expect(result).toBeNull();
        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(harness.plugin.pageletCostTracker.record).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'openai',
            model: 'gpt-4o-mini',
        }));
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
    });

    it('drops a Discover result when a live source disappears during invocation', async () => {
        const harness = createDiscoveryHarness({ notified: true });
        harness.invoke.mockImplementation(async () => {
            harness.setRelatedAvailable(false);
            return JSON.stringify({ findings: [{
                text: 'Stale finding.',
                sourceFile: harness.relatedFile.path,
                sourceTitle: 'related',
                category: 'connection',
            }] });
        });

        const result = await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'Current note.' },
            [{ path: harness.relatedFile.path, content: 'Related note.' }],
        );

        expect(result).toBeNull();
        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(harness.plugin.pageletCostTracker.record).toHaveBeenCalledTimes(1);
    });

    it('fails closed before Discover embedding when the provider policy changes', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.plugin.settings.retrievalHabitProfile = { enabled: false, state: { aggregates: [] } };
        harness.plugin.isPageletMemorySearchReady = jest.fn(async () => true);
        const embedInvoke = jest.fn(async () => [0.1, 0.2]);
        harness.plugin.vss = {
            searchHybrid: jest.fn(async (
                _query: string,
                options?: {
                    executeEmbeddingInvoke?: (invoke: () => Promise<number[]>) => Promise<number[]>;
                },
            ) => {
                harness.setProviderPolicyIdentity('provider-policy:changed');
                await options?.executeEmbeddingInvoke?.(embedInvoke);
                return [];
            }),
        };

        const result = await harness.plugin.findPageletRelatedNotes(
            harness.currentFile.path,
            [{ path: harness.currentFile.path, content: 'Current note.' }],
            [harness.currentFile.path],
            { limit: 6 },
        );

        expect(result).toEqual([]);
        expect(harness.plugin.reservePageletRateLimitSlot).not.toHaveBeenCalled();
        expect(embedInvoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it.each([
        ['#no-ai', '# Current\n\nLATEST-PRIVATE-CURRENT #no-ai', null],
        ['#no-review', '# Current\n\nLATEST-PRIVATE-CURRENT #no-review', { tags: [] }],
        ['configured exclusion tag', '# Current\n\nLATEST-PRIVATE-CURRENT #private', { tags: [] }],
        ['pagelet-generated frontmatter', '---\npagelet: true\n---\nLATEST-PRIVATE-CURRENT', null],
        ['malformed leading frontmatter', '---\ntags: [safe\nLATEST-PRIVATE-CURRENT', { frontmatter: {} }],
    ])('blocks cold Discover embedding from stale/null metadata when the latest body has %s', async (
        _label,
        latestBody,
        staleMetadata,
    ) => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.plugin.settings.pagelet.excludedTags = ['private'];
        harness.plugin.settings.retrievalHabitProfile = { enabled: false, state: { aggregates: [] } };
        harness.plugin.isPageletMemorySearchReady = jest.fn(async () => true);
        harness.plugin.app.metadataCache.getFileCache = jest.fn(() => staleMetadata);
        harness.setCurrentContent(latestBody);
        const embedInvoke = jest.fn(async () => [0.1, 0.2]);
        const searchHybrid = jest.fn(async (
            _query: string,
            options?: {
                executeEmbeddingInvoke?: (invoke: () => Promise<number[]>) => Promise<number[]>;
            },
        ) => {
            await options?.executeEmbeddingInvoke?.(embedInvoke);
            return [];
        });
        harness.plugin.vss = { searchHybrid };

        const result = await harness.plugin.findPageletRelatedNotes(
            harness.currentFile.path,
            [{ path: harness.currentFile.path, content: 'STALE SAFE CURRENT BODY' }],
            [harness.currentFile.path],
            { limit: 6 },
        );

        expect(result).toEqual([]);
        expect(embedInvoke).not.toHaveBeenCalled();
        expect(harness.plugin.reservePageletRateLimitSlot).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it.each([
        ['Data Boundary folder', 'private/current.md', ['private'], []],
        ['Pagelet path pattern', 'notes/secret-current.md', [], ['secret-']],
        ['Pagelet output folder', '.pagelet/current.md', [], []],
    ])('applies the unified path rule before the Discover provider seam for %s', async (
        _label,
        path,
        excludedFolders,
        excludedPatterns,
    ) => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.currentFile.path = path;
        harness.plugin.settings.dataBoundary.excludedFolders = excludedFolders;
        harness.plugin.settings.pagelet.excludedPatterns = excludedPatterns;
        harness.plugin.settings.retrievalHabitProfile = { enabled: false, state: { aggregates: [] } };
        harness.plugin.isPageletMemorySearchReady = jest.fn(async () => true);
        const searchHybrid = jest.fn();
        harness.plugin.vss = { searchHybrid };

        const result = await harness.plugin.findPageletRelatedNotes(
            path,
            [{ path, content: 'PRIVATE-PATH-SENTINEL' }],
            [path],
            { limit: 6 },
        );

        expect(result).toEqual([]);
        expect(searchHybrid).not.toHaveBeenCalled();
        expect(harness.plugin.reservePageletRateLimitSlot).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('fails closed when Discover retrieval times out while its provider budget is pending', async () => {
        jest.useFakeTimers();
        try {
            mockNoticeMessages.length = 0;
            const harness = createDiscoveryHarness();
            harness.plugin.settings.retrievalHabitProfile = { enabled: false, state: { aggregates: [] } };
            harness.plugin.isPageletMemorySearchReady = jest.fn(async () => true);
            const embedInvoke = jest.fn(async () => [0.1, 0.2]);
            let releaseBudget!: () => void;
            harness.plugin.reservePageletRateLimitSlot.mockImplementation(() => (
                new Promise<void>((resolve) => { releaseBudget = resolve; })
            ));
            harness.plugin.vss = {
                searchHybrid: jest.fn(async (
                    _query: string,
                    options?: {
                        executeEmbeddingInvoke?: (invoke: () => Promise<number[]>) => Promise<number[]>;
                    },
                ) => {
                    await options?.executeEmbeddingInvoke?.(embedInvoke);
                    return [];
                }),
            };

            const resultPromise = harness.plugin.findPageletRelatedNotes(
                harness.currentFile.path,
                [{ path: harness.currentFile.path, content: 'Current note.' }],
                [harness.currentFile.path],
                { limit: 6 },
            );
            await jest.advanceTimersByTimeAsync(0);
            expect(harness.plugin.reservePageletRateLimitSlot).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(8_000);
            releaseBudget();

            await expect(resultPromise).resolves.toEqual([]);
            expect(embedInvoke).not.toHaveBeenCalled();
            expect(mockNoticeMessages).toEqual([]);
            expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    it('shares the first-use admission from Discover query embedding into generation', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.plugin.settings.retrievalHabitProfile = { enabled: false, state: { aggregates: [] } };
        harness.plugin.isPageletMemorySearchReady = jest.fn(async () => true);
        const searchHybrid = jest.fn(async (
            _query: string,
            options?: {
                executeEmbeddingInvoke?: (invoke: () => Promise<number[]>) => Promise<number[]>;
            },
        ) => {
            await options?.executeEmbeddingInvoke?.(async () => [0.1, 0.2]);
            return [{
                score: 0.92,
                doc: {
                    pageContent: 'STALE VSS PRIVATE CONTENT',
                    metadata: { path: harness.relatedFile.path },
                },
            }];
        });
        harness.plugin.vss = { searchHybrid };

        const relatedNotes = await harness.plugin.findPageletRelatedNotes(
            harness.currentFile.path,
            [{ path: harness.currentFile.path, content: 'Current note body.' }],
            [harness.currentFile.path],
            { limit: 6 },
        );
        await harness.plugin.runDiscoveryAnalysis(
            { path: harness.currentFile.path, content: 'Current note body.' },
            relatedNotes,
        );

        expect(searchHybrid).toHaveBeenCalledTimes(1);
        expect(relatedNotes).toEqual([
            expect.objectContaining({
                path: harness.relatedFile.path,
                content: 'SAFE LIVE RELATED NOTE',
            }),
        ]);
        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(harness.plugin.reservePageletRateLimitSlot).toHaveBeenCalledTimes(2);
        const prompt = harness.invoke.mock.calls[0]?.[0] as string;
        expect(prompt).toContain('SAFE CURRENT NOTE');
        expect(prompt).toContain('SAFE LIVE RELATED NOTE');
        expect(prompt).not.toContain('STALE VSS PRIVATE CONTENT');
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
        expect(harness.plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('drops a cached semantic-search result when the primary source changes during local search', async () => {
        mockNoticeMessages.length = 0;
        const harness = createDiscoveryHarness();
        harness.plugin.settings.retrievalHabitProfile = { enabled: false, state: { aggregates: [] } };
        harness.plugin.isPageletMemorySearchReady = jest.fn(async () => true);
        harness.plugin.vss = {
            searchHybrid: jest.fn(async () => {
                harness.currentFile.stat.mtime += 1;
                return [{
                    score: 0.92,
                    doc: {
                        pageContent: 'cached index result',
                        metadata: { path: harness.relatedFile.path },
                    },
                }];
            }),
        };

        const relatedNotes = await harness.plugin.findPageletRelatedNotes(
            harness.currentFile.path,
            [{ path: harness.currentFile.path, content: 'Current note body.' }],
            [harness.currentFile.path],
            { limit: 6 },
        );

        expect(relatedNotes).toEqual([]);
        expect(harness.plugin.reservePageletRateLimitSlot).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });
});

describe('Pagelet Review first-use and retired preload admission', () => {
    function createAnalyzeHarness() {
        const currentFile = createTFileWithStat('notes/current.md', { mtime: Date.now(), size: 100 }) as TFile & {
            basename: string;
        };
        currentFile.basename = 'current';
        let currentAvailable = true;
        let currentContent = 'Current Pagelet review note.';
        const extraFiles = new Map<string, TFile & { basename: string }>();
        const extraContents = new Map<string, string>();
        let providerPolicyIdentity = 'pagelet-provider-policy:test';
        const structuredInvoke = jest.fn(async () => ({
            schema_version: 1,
            detected_language: 'en',
            suggestions: [],
        }));
        const invoke = jest.fn(async () => ({ content: JSON.stringify({ findings: [] }) }));
        const findPageletRelatedNotes = jest.fn(async (
            _primarySourcePath: string,
            _noteContents: Array<{ path: string; content: string }>,
            _sourcePaths: readonly string[],
            _options?: {
                limit?: number;
                executeProviderCall?: <TResult>(
                    invoke: () => Promise<TResult>,
                    options: { signal: AbortSignal },
                ) => Promise<TResult>;
            },
        ): Promise<Array<{
            path: string;
            content: string;
            mtime: number;
            size: number;
        }>> => []);
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.unloading = false;
        plugin.settings = {
            aiProvider: 'openai',
            aiProviderPreset: 'openai',
            chatModelName: 'gpt-4o-mini',
            embeddingModelName: 'text-embedding-3-small',
            baseURL: 'https://api.openai.com/v1',
            contextPager: { enabled: false },
            quietRecall: { enabled: false },
            focusMode: false,
            confirmedMemoryCount: 0,
            pagelet: {
                enabled: true,
                backgroundDiscoveryEnabled: true,
                // A retained legacy key cannot revive the retired pipeline.
                preloadEnabled: true,
                preloadPerHourCap: 2,
                preloadPerDayCap: 20,
                preloadTokenBudget: { input: 4_000, output: 1_000 },
                temperature: 0.2,
                maxInputTokens: 8_000,
                maxOutputTokens: 2_000,
                outputLanguage: 'auto',
                foregroundPerHourCap: 10,
                foregroundPerDayCap: 100,
                pageletProviderFirstUseNotified: false,
            },
        };
        plugin.app = {
            workspace: { getActiveFile: jest.fn(() => currentAvailable ? currentFile : null) },
            vault: {
                getAbstractFileByPath: jest.fn((path: string) => (
                    currentAvailable && path === currentFile.path
                        ? currentFile
                        : extraFiles.get(path) ?? null
                )),
                cachedRead: jest.fn(async (file: TFile) => (
                    file.path === currentFile.path
                        ? currentContent
                        : extraContents.get(file.path) ?? ''
                )),
            },
        };
        plugin.getPageletSettingsWithDataBoundary = jest.fn(() => ({
            ...plugin.settings.pagelet,
            reviewsFolder: '.pagelet',
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: [],
        }));
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.isDataBoundaryAllowedFile = jest.fn(() => true);
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.getScopeRecapAuthorizationContextId = jest.fn(() => providerPolicyIdentity);
        plugin.getScopeRecapProviderInfo = jest.fn(() => ({
            provider: 'openai',
            model: 'gpt-4o-mini',
            endpoint: 'https://api.openai.com/v1',
        }));
        plugin.findPageletRelatedNotes = findPageletRelatedNotes;
        plugin.createChatModel = jest.fn(async () => ({
            invoke,
            withStructuredOutput: () => ({ invoke: structuredInvoke }),
        }));
        const reserve = jest.fn(async () => ({ ok: true }));
        const rateLimiter = {
            peek: jest.fn(async () => ({ ok: true })),
            reserve,
            reserveIf: jest.fn(async (predicate: () => boolean | PromiseLike<boolean>) => (
                await predicate() ? reserve() : { ok: false as const, reason: 'condition' as const }
            )),
            reserveLeaseIf: jest.fn(async (predicate: () => boolean | PromiseLike<boolean>) => {
                if (!await predicate()) return { ok: false as const, reason: 'condition' as const };
                const decision = await reserve();
                if (!decision.ok) return decision;
                let committed = false;
                return {
                    ok: true as const,
                    reservation: {
                        commit: () => { committed = true; },
                        rollback: jest.fn(async () => { if (!committed) committed = true; }),
                    },
                };
            }),
        };
        plugin.getPageletRateLimiter = jest.fn(() => rateLimiter);
        plugin.pageletCostTracker = {
            record: jest.fn((entry: Record<string, unknown>) => ({
                ...entry,
                estimatedCost: 0.001,
                currency: 'USD',
                pricingKnown: true,
            })),
        };
        plugin.saveSettings = jest.fn(async () => undefined);
        plugin.log = jest.fn();
        return {
            plugin,
            currentFile,
            structuredInvoke,
            invoke,
            findPageletRelatedNotes,
            rateLimiter,
            setCurrentAvailable(value: boolean) { currentAvailable = value; },
            setCurrentContent(value: string) { currentContent = value; },
            setProviderPolicyIdentity(value: string) { providerPolicyIdentity = value; },
            addSourceFile(path: string, content: string) {
                const file = createTFileWithStat(path, { mtime: Date.now(), size: content.length }) as TFile & {
                    basename: string;
                };
                file.basename = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
                extraFiles.set(path, file);
                extraContents.set(path, content);
                return file;
            },
        };
    }

    const config = {
        enabled: true,
        intervalMinutes: 30,
        perHourCap: 2,
        perDayCap: 20,
        tokenBudget: { input: 8_000, output: 2_000 },
        range: 'current' as const,
    };
    const preloadConfig = {
        enabled: true,
        intervalMinutes: 30,
        perHourCap: 2,
        perDayCap: 20,
        tokenBudget: { input: 4_000, output: 1_000 },
        range: 'last7' as const,
    };
    const backgroundEnvelope = {
        kind: 'generic-changed-only' as const,
        rangeDays: 7 as const,
        allowWrite: false as const,
        wholeVault: false as const,
        excludedScopeOverride: false as const,
    };

    it('wires foreground Review generation through the shared first-use seam', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        const host = harness.plugin.createPageletHost();

        await host.createForegroundAnalyzeCallback()([harness.currentFile], config);

        expect(harness.findPageletRelatedNotes).toHaveBeenCalledWith(
            harness.currentFile.path,
            [expect.objectContaining({ path: harness.currentFile.path, content: 'Current Pagelet review note.' })],
            [harness.currentFile.path],
            expect.objectContaining({
                limit: 6,
                additionalCurrentCheck: expect.any(Function),
                executeProviderCall: expect.any(Function),
            }),
        );
        expect(harness.structuredInvoke).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
    });

    it('keeps a foreground Review rate rejection at zero notice and zero provider call', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        harness.plugin.getPageletRateLimiter = jest.fn(() => ({
            peek: jest.fn(async () => ({ ok: true })),
            reserve: jest.fn(async () => ({
                ok: false,
                reason: 'hr-cap',
                resumeAt: Date.now() + 60_000,
            })),
            reserveIf: jest.fn(async () => ({
                ok: false,
                reason: 'hr-cap',
                resumeAt: Date.now() + 60_000,
            })),
            reserveLeaseIf: jest.fn(async () => ({
                ok: false,
                reason: 'hr-cap',
                resumeAt: Date.now() + 60_000,
            })),
        }));
        const host = harness.plugin.createPageletHost();

        await expect(host.createForegroundAnalyzeCallback()([harness.currentFile], config))
            .rejects.toThrow();

        expect(harness.structuredInvoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('drops a foreground Review result when its source changes during invocation', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        harness.structuredInvoke.mockImplementation(async () => {
            harness.currentFile.stat.mtime += 1;
            return { schema_version: 1, detected_language: 'en', suggestions: [] };
        });
        const host = harness.plugin.createPageletHost();

        await expect(host.createForegroundAnalyzeCallback()([harness.currentFile], config))
            .rejects.toThrow('became stale');

        expect(harness.structuredInvoke).toHaveBeenCalledTimes(1);
        expect(harness.plugin.pageletCostTracker.record).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
    });

    it('confirms a multi-note Review before reservation and skips scope-expanding enrichment', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        const secondFile = harness.addSourceFile('notes/second.md', 'Second Pagelet review note.');
        const order: string[] = [];
        harness.plugin.requestForegroundReviewHighRiskDecision = jest.fn(async () => {
            order.push('decision:run');
            return 'run';
        });
        harness.rateLimiter.reserve.mockImplementation(async () => {
            order.push('reserve');
            return { ok: true };
        });
        harness.structuredInvoke.mockImplementation(async () => {
            order.push('generation');
            return { schema_version: 1, detected_language: 'en', suggestions: [] };
        });
        const host = harness.plugin.createPageletHost();

        await host.createForegroundAnalyzeCallback()(
            [harness.currentFile, secondFile],
            { ...config, range: 'last7' },
        );

        expect(order).toEqual([
            'decision:run',
            'reserve',
            'generation',
        ]);
        expect(harness.findPageletRelatedNotes).not.toHaveBeenCalled();
        expect(harness.plugin.requestForegroundReviewHighRiskDecision).toHaveBeenCalledTimes(1);
        expect(harness.rateLimiter.reserve).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(0);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
    });

    it.each(['cancel', 'adjust'] as const)(
        'keeps a multi-note Review %s at zero reservation and zero provider call',
        async (choice) => {
            mockNoticeMessages.length = 0;
            const harness = createAnalyzeHarness();
            const secondFile = harness.addSourceFile('notes/second.md', 'Second Pagelet review note.');
            harness.plugin.requestForegroundReviewHighRiskDecision = jest.fn(async () => choice);
            const retrievalInvoke = jest.fn(async () => [0.1, 0.2]);
            harness.findPageletRelatedNotes.mockImplementation(async (...args: unknown[]) => {
                const options = args[3] as {
                    executeProviderCall?: <TResult>(
                        invoke: () => Promise<TResult>,
                        callOptions: { signal: AbortSignal },
                    ) => Promise<TResult>;
                };
                await options.executeProviderCall?.(
                    retrievalInvoke,
                    { signal: new AbortController().signal },
                );
                return [];
            });
            const host = harness.plugin.createPageletHost();

            const result = await host.createForegroundAnalyzeCallback()(
                [harness.currentFile, secondFile],
                { ...config, range: 'last7' },
            );

            expect(result.findings).toEqual([]);
            expect(harness.rateLimiter.reserve).not.toHaveBeenCalled();
            expect(retrievalInvoke).not.toHaveBeenCalled();
            expect(harness.structuredInvoke).not.toHaveBeenCalled();
            expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
            if (choice === 'adjust') {
                expect(mockNoticeMessages).toContain(
                    'Review stopped safely. Adjust the selected notes in the Review panel, then run it again.',
                );
            }
        },
    );

    it('classifies by bundle sources when multi-file input fits only one actual source', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        const secondFile = harness.addSourceFile('notes/second.md', 'Second Pagelet review note.');
        harness.plugin.getPageletSettingsWithDataBoundary = jest.fn(() => ({
            ...harness.plugin.settings.pagelet,
            maxInputTokens: 10,
            reviewsFolder: '.pagelet',
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: [],
        }));
        harness.plugin.requestForegroundReviewHighRiskDecision = jest.fn(async () => 'run');
        const host = harness.plugin.createPageletHost();

        await host.createForegroundAnalyzeCallback()(
            [harness.currentFile, secondFile],
            { ...config, range: 'last7' },
        );

        expect(harness.plugin.requestForegroundReviewHighRiskDecision).not.toHaveBeenCalled();
        expect(harness.findPageletRelatedNotes).toHaveBeenCalledWith(
            harness.currentFile.path,
            [expect.objectContaining({ path: harness.currentFile.path })],
            [harness.currentFile.path],
            expect.objectContaining({ executeProviderCall: expect.any(Function) }),
        );
        expect(harness.rateLimiter.reserve).toHaveBeenCalledTimes(1);
        expect(harness.structuredInvoke).toHaveBeenCalledTimes(1);
    });

    it('reconfirms the exact expanded source set before generation after one-note retrieval', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        const relatedFile = harness.addSourceFile('notes/related.md', 'Live related note.');
        const order: string[] = [];
        harness.rateLimiter.reserve.mockImplementation(async () => {
            order.push('reserve');
            return { ok: true };
        });
        harness.findPageletRelatedNotes.mockImplementation(async (...args: unknown[]) => {
            const options = args[3] as {
                executeProviderCall?: <TResult>(
                    invoke: () => Promise<TResult>,
                    callOptions: { signal: AbortSignal },
                ) => Promise<TResult>;
                onProviderInvoke?: () => void;
            };
            await options.executeProviderCall?.(async () => {
                options.onProviderInvoke?.();
                order.push('retrieval');
                return [0.1, 0.2];
            }, { signal: new AbortController().signal });
            return [{
                path: relatedFile.path,
                content: 'Live related note.',
                mtime: relatedFile.stat.mtime,
                size: relatedFile.stat.size,
            }];
        });
        harness.plugin.requestForegroundReviewHighRiskDecision = jest.fn(async (summary: { includedSourceCount: number }) => {
            order.push(`decision:${summary.includedSourceCount}`);
            return 'run';
        });
        harness.structuredInvoke.mockImplementation(async () => {
            order.push('generation');
            return { schema_version: 1, detected_language: 'en', suggestions: [] };
        });
        const host = harness.plugin.createPageletHost();

        await host.createForegroundAnalyzeCallback()([harness.currentFile], config);

        expect(order).toEqual([
            'reserve',
            'retrieval',
            'decision:2',
            'reserve',
            'generation',
        ]);
        expect(harness.plugin.requestForegroundReviewHighRiskDecision).toHaveBeenCalledTimes(1);
        expect(harness.rateLimiter.reserve).toHaveBeenCalledTimes(2);
        expect(harness.plugin.pageletCostTracker.record).toHaveBeenCalledWith(expect.objectContaining({
            feature: 'foreground-review',
            attemptKind: 'semantic-retrieval',
            model: 'text-embedding-3-small',
        }));
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
    });

    it('fails closed without committing or invoking when sources drift inside conditional reservation', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        const secondFile = harness.addSourceFile('notes/second.md', 'Second Pagelet review note.');
        harness.plugin.requestForegroundReviewHighRiskDecision = jest.fn(async () => 'run');
        harness.rateLimiter.reserveLeaseIf.mockImplementation(async () => {
            harness.currentFile.stat.mtime += 1;
            return { ok: false, reason: 'condition' };
        });
        const host = harness.plugin.createPageletHost();

        await expect(host.createForegroundAnalyzeCallback()(
            [harness.currentFile, secondFile],
            { ...config, range: 'last7' },
        )).rejects.toThrow('became stale');

        expect(harness.rateLimiter.reserve).not.toHaveBeenCalled();
        expect(harness.structuredInvoke).not.toHaveBeenCalled();
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(mockNoticeMessages).toEqual([]);
    });

    it('reserves exactly one slot per high-risk structured retry without repeating confirmation', async () => {
        const harness = createAnalyzeHarness();
        const secondFile = harness.addSourceFile('notes/second.md', 'Second Pagelet review note.');
        harness.plugin.requestForegroundReviewHighRiskDecision = jest.fn(async () => 'run');
        harness.structuredInvoke
            .mockRejectedValueOnce(new Error('schema mismatch'))
            .mockResolvedValueOnce({ schema_version: 1, detected_language: 'en', suggestions: [] });
        const host = harness.plugin.createPageletHost();

        await host.createForegroundAnalyzeCallback()(
            [harness.currentFile, secondFile],
            { ...config, range: 'last7' },
        );

        expect(harness.structuredInvoke).toHaveBeenCalledTimes(2);
        expect(harness.rateLimiter.reserve).toHaveBeenCalledTimes(2);
        expect(harness.plugin.requestForegroundReviewHighRiskDecision).toHaveBeenCalledTimes(1);
    });

    it('reserves exactly one slot per high-risk JSON-mode attempt', async () => {
        const harness = createAnalyzeHarness();
        const secondFile = harness.addSourceFile('notes/second.md', 'Second Pagelet review note.');
        harness.plugin.requestForegroundReviewHighRiskDecision = jest.fn(async () => 'run');
        harness.invoke
            .mockResolvedValueOnce({ content: 'not json' })
            .mockResolvedValueOnce({ content: JSON.stringify({
                schema_version: 1,
                detected_language: 'en',
                suggestions: [],
            }) });
        harness.plugin.createChatModel = jest.fn(async () => ({ invoke: harness.invoke }));
        const host = harness.plugin.createPageletHost();

        await host.createForegroundAnalyzeCallback()(
            [harness.currentFile, secondFile],
            { ...config, range: 'last7' },
        );

        expect(harness.invoke).toHaveBeenCalledTimes(2);
        expect(harness.rateLimiter.reserve).toHaveBeenCalledTimes(2);
        expect(harness.plugin.requestForegroundReviewHighRiskDecision).toHaveBeenCalledTimes(1);
    });

    it('keeps requested last7 standard when only one allowed note is actually included', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        harness.plugin.requestForegroundReviewHighRiskDecision = jest.fn(async () => 'run');
        const host = harness.plugin.createPageletHost();

        await host.createForegroundAnalyzeCallback()(
            [harness.currentFile],
            { ...config, range: 'last7' },
        );

        expect(harness.plugin.requestForegroundReviewHighRiskDecision).not.toHaveBeenCalled();
        expect(harness.rateLimiter.reserve).toHaveBeenCalledTimes(1);
        expect(harness.structuredInvoke).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
    });

    it.each([true, false])('keeps retired preload at zero calls when background discovery is %s', async (enabled) => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        harness.plugin.settings.pagelet.backgroundDiscoveryEnabled = enabled;
        const reserveProviderCall = jest.fn(() => true);
        const host = harness.plugin.createPageletHost();

        await host.createPreloadAnalyzeCallback()([harness.currentFile], preloadConfig, {
            reserveProviderCall,
            remainingProviderCalls: () => ({ hourly: 1, daily: 1 }),
            backgroundEnvelope,
        });

        expect(harness.findPageletRelatedNotes).not.toHaveBeenCalled();
        expect(reserveProviderCall).not.toHaveBeenCalled();
        expect(harness.plugin.createChatModel).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
    });

    it.each([
        ['hard no-ai tag', '# Current\n\n#no-ai\nNew private detail.', []],
        ['configured excluded tag', '# Current\n\n#private\nNew private detail.', ['private']],
    ])('fails closed on a latest-body %s while MetadataCache still allows it', async (
        _label,
        content,
        excludedTags,
    ) => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        harness.setCurrentContent(content);
        harness.plugin.settings.dataBoundary = {
            excludedFolders: [],
            excludedTags,
            generatedNotePolicy: 'exclude-generated',
        };
        const reserveProviderCall = jest.fn(() => true);
        const host = harness.plugin.createPageletHost();

        const result = await host.createPreloadAnalyzeCallback()(
            [harness.currentFile],
            preloadConfig,
            {
                reserveProviderCall,
                remainingProviderCalls: () => ({ hourly: 2, daily: 20 }),
                backgroundEnvelope,
            },
        );

        expect(result).toMatchObject({ findings: [], analyzedFiles: [] });
        expect(reserveProviderCall).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('rejects retired preload before quota reservation or source revalidation can begin', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        let usedSlots = 0;
        const commit = jest.fn();
        const rollback = jest.fn(async () => { usedSlots -= 1; });
        const reserveProviderCall = jest.fn(() => {
            usedSlots += 1;
            harness.currentFile.stat.mtime += 1;
            return { commit, rollback };
        });
        const host = harness.plugin.createPageletHost();

        await expect(host.createPreloadAnalyzeCallback()([harness.currentFile], preloadConfig, {
            reserveProviderCall,
            remainingProviderCalls: () => ({ hourly: 2 - usedSlots, daily: 20 - usedSlots }),
            backgroundEnvelope,
        })).resolves.toMatchObject({ analyzedFiles: [], findings: [] });

        expect(usedSlots).toBe(0);
        expect(reserveProviderCall).not.toHaveBeenCalled();
        expect(rollback).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('does not add a recent but unchanged related note to generic preload', async () => {
        const harness = createAnalyzeHarness();
        const unchanged = harness.addSourceFile('notes/unchanged-related.md', 'UNCHANGED_SENTINEL');
        harness.findPageletRelatedNotes.mockResolvedValue([{
            path: unchanged.path,
            content: 'UNCHANGED_SENTINEL',
            mtime: unchanged.stat.mtime,
            size: unchanged.stat.size,
        }]);
        const host = harness.plugin.createPageletHost();

        await host.createPreloadAnalyzeCallback()([harness.currentFile], preloadConfig, {
            reserveProviderCall: () => true,
            remainingProviderCalls: () => ({ hourly: 2, daily: 20 }),
            backgroundEnvelope,
        });

        expect(harness.findPageletRelatedNotes).not.toHaveBeenCalled();
        const invokedPrompt = (harness.invoke.mock.calls as unknown as unknown[][])[0]?.[0];
        expect(String(invokedPrompt)).not.toContain('UNCHANGED_SENTINEL');
        expect(harness.plugin.pageletCostTracker.record).not.toHaveBeenCalledWith(
            expect.objectContaining({ attemptKind: 'semantic-retrieval' }),
        );
    });

    it('publishes no retired preload findings, including provider output with excluded sources', async () => {
        const harness = createAnalyzeHarness();
        harness.invoke.mockResolvedValueOnce({
            content: JSON.stringify({
                findings: [{
                    text: 'Supported by the current note.',
                    sourceFile: harness.currentFile.path,
                    sourceTitle: 'Current',
                }, {
                    text: 'Hallucinated private source.',
                    sourceFile: 'private/excluded.md',
                    sourceTitle: 'Excluded',
                }],
            }),
        });
        const host = harness.plugin.createPageletHost();

        const result = await host.createPreloadAnalyzeCallback()(
            [harness.currentFile],
            preloadConfig,
            {
                reserveProviderCall: () => true,
                remainingProviderCalls: () => ({ hourly: 2, daily: 20 }),
                backgroundEnvelope,
            },
        );

        expect(result).toMatchObject({ findings: [], analyzedFiles: [] });
        expect(harness.plugin.createChatModel).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
    });

    it('keeps preload capability-off during setup at zero notice and zero provider call', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        harness.plugin.createChatModel.mockImplementation(async () => {
            harness.plugin.settings.pagelet.preloadEnabled = false;
            return {
                invoke: harness.invoke,
                withStructuredOutput: () => ({ invoke: harness.structuredInvoke }),
            };
        });
        const reserveProviderCall = jest.fn(() => true);
        const host = harness.plugin.createPageletHost();

        await expect(host.createPreloadAnalyzeCallback()([harness.currentFile], preloadConfig, {
            reserveProviderCall,
            remainingProviderCalls: () => ({ hourly: 1, daily: 1 }),
            backgroundEnvelope,
        })).resolves.toMatchObject({ analyzedFiles: [], findings: [] });

        expect(reserveProviderCall).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it.each([
        ['missing engine proof', undefined],
        ['whole-vault override', { ...backgroundEnvelope, wholeVault: true as const }],
    ])('fails closed for preload %s before budget reservation', async (_label, envelope) => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        const reserveProviderCall = jest.fn(() => true);
        const host = harness.plugin.createPageletHost();

        await expect(host.createPreloadAnalyzeCallback()([harness.currentFile], preloadConfig, {
            reserveProviderCall,
            remainingProviderCalls: () => ({ hourly: 2, daily: 20 }),
            ...(envelope ? { backgroundEnvelope: envelope } : {}),
        })).resolves.toMatchObject({ analyzedFiles: [], findings: [] });

        expect(reserveProviderCall).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
    });

    it('fails closed when persisted preload caps exceed the 2/hour standard envelope', async () => {
        const harness = createAnalyzeHarness();
        harness.plugin.settings.pagelet.preloadPerHourCap = 3;
        const reserveProviderCall = jest.fn(() => true);
        const host = harness.plugin.createPageletHost();

        await expect(host.createPreloadAnalyzeCallback()([harness.currentFile], preloadConfig, {
            reserveProviderCall,
            remainingProviderCalls: () => ({ hourly: 2, daily: 20 }),
            backgroundEnvelope,
        })).resolves.toMatchObject({ analyzedFiles: [], findings: [] });

        expect(reserveProviderCall).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
    });

    it('retains the foreground first-use notice while a later retired preload attempt does nothing', async () => {
        mockNoticeMessages.length = 0;
        const harness = createAnalyzeHarness();
        const host = harness.plugin.createPageletHost();

        await host.createForegroundAnalyzeCallback()([harness.currentFile], config);
        await host.createPreloadAnalyzeCallback()([harness.currentFile], preloadConfig, {
            reserveProviderCall: () => true,
            remainingProviderCalls: () => ({ hourly: 1, daily: 1 }),
            backgroundEnvelope,
        });

        expect(harness.structuredInvoke).toHaveBeenCalledTimes(1);
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.saveSettings).toHaveBeenCalledTimes(1);
    });
});

describe('Retrieval optimization policy snapshot lifecycle', () => {
    const runtimePlatform = Platform as typeof Platform & {
        isWin: boolean;
        isAndroidApp: boolean;
        isMacOS: boolean;
        isLinux: boolean;
        isIosApp: boolean;
    };

    afterEach(() => {
        runtimePlatform.isWin = false;
        runtimePlatform.isAndroidApp = false;
        runtimePlatform.isMacOS = true;
        runtimePlatform.isLinux = false;
        runtimePlatform.isIosApp = false;
    });

    function createPolicyHarness() {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {};
        plugin.retrievalOptimizationEpoch = 0;
        plugin.retrievalOptimizationSignature = '';
        return plugin;
    }

    it('exposes a content-free build-default snapshot without persisting raw overrides', () => {
        const plugin = createPolicyHarness();
        plugin.settings.retrievalOptimizationFlags = {
            lexicalProfile: false,
            privateMarker: 'must-not-leak',
        };

        const snapshot = (plugin as PluginManager).getRetrievalOptimizationPolicySnapshot();

        expect(snapshot).toMatchObject({
            rolloutId: 'b125-retrieval-optimization-rollout',
            rolloutVersion: 1,
            authority: {
                featureId: 'B-125',
                sourceDecisionId: 'DEC-027',
                decisionId: 'DEC-031',
                ownerApprovalDate: '2026-09-04',
            },
            platformSupported: true,
            platformMask: 'none',
            effectiveFlags: {
                lexicalProfile: false,
                strictReranker: true,
                graphPpr: true,
                relaxedRecovery: true,
            },
        });
        expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');
        expect(plugin.settings.retrievalOptimizationFlags).toEqual({
            lexicalProfile: false,
            privateMarker: 'must-not-leak',
        });
    });

    it('does not materialize implicit build defaults during an unrelated settings save', async () => {
        const plugin = createPolicyHarness();
        plugin.settings.focusMode = true;
        plugin.unloading = false;
        plugin.settingsSaveTail = null;
        plugin.legacyMemoryCompatibilityBarrier = null;
        let persisted: Record<string, unknown> | undefined;
        plugin.saveData = jest.fn(async (payload: Record<string, unknown>) => {
            persisted = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
        });
        plugin.notifySettingsChanged = jest.fn(async () => undefined);

        await plugin.saveSettings();

        expect(persisted).toBeDefined();
        expect(persisted).not.toHaveProperty('retrievalOptimizationFlags');
        expect(plugin.settings).not.toHaveProperty('retrievalOptimizationFlags');
    });

    it('keeps the epoch stable for one snapshot and invalidates for effective flags', () => {
        const plugin = createPolicyHarness();

        const defaultEpoch = plugin.getRetrievalOptimizationEpoch();
        expect(plugin.getRetrievalOptimizationEpoch()).toBe(defaultEpoch);

        plugin.settings.retrievalOptimizationFlags = { graphPpr: false };
        const overriddenEpoch = plugin.getRetrievalOptimizationEpoch();
        expect(overriddenEpoch).not.toBe(defaultEpoch);
        expect(plugin.getRetrievalOptimizationEpoch()).toBe(overriddenEpoch);
    });

    it('binds platform support and the exact platform mask even when flags stay disabled', () => {
        const plugin = createPolicyHarness();

        runtimePlatform.isWin = true;
        const windowsSnapshot = plugin.getRetrievalOptimizationPolicySnapshot();
        const windowsEpoch = plugin.getRetrievalOptimizationEpoch();
        expect(windowsSnapshot).toMatchObject({
            platformSupported: false,
            platformMask: 'windows',
            effectiveFlags: {
                lexicalProfile: false,
                strictReranker: false,
                graphPpr: false,
                relaxedRecovery: false,
            },
        });

        runtimePlatform.isWin = false;
        runtimePlatform.isAndroidApp = true;
        const androidSnapshot = plugin.getRetrievalOptimizationPolicySnapshot();
        const androidEpoch = plugin.getRetrievalOptimizationEpoch();
        expect(androidSnapshot).toMatchObject({
            platformSupported: false,
            platformMask: 'android',
            effectiveFlags: windowsSnapshot.effectiveFlags,
        });
        expect(androidEpoch).not.toBe(windowsEpoch);
    });

    it('binds rollout and authority identity even when effective behavior is unchanged', () => {
        const plugin = createPolicyHarness();
        const snapshot = plugin.getRetrievalOptimizationPolicySnapshot();
        const initialEpoch = plugin.getRetrievalOptimizationEpoch();

        plugin.getRetrievalOptimizationPolicySnapshot = () => ({
            ...snapshot,
            rolloutVersion: 2,
        });
        const rolloutEpoch = plugin.getRetrievalOptimizationEpoch();
        expect(rolloutEpoch).not.toBe(initialEpoch);

        plugin.getRetrievalOptimizationPolicySnapshot = () => ({
            ...snapshot,
            rolloutVersion: 2,
            authority: {
                ...snapshot.authority,
                decisionId: 'DEC-999',
            },
        });
        expect(plugin.getRetrievalOptimizationEpoch()).not.toBe(rolloutEpoch);
    });
});

describe('Pagelet Deep Discover scheduler identity lifecycle', () => {
    it('forwards the Pagelet run scope and physical-dispatch hook to the native chat model', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const createChatModel = jest.fn(async (_temperature: number, _options: unknown) => ({
            model: 'pagelet-native',
        }));
        const providerRequestScope = createProviderRequestScope();
        const onProviderRequestStart = jest.fn();

        await plugin.createPageletDeepDiscoverChatModel(
            { createChatModel },
            { chatModelName: 'configured-pagelet-model' },
            { enableThinking: true },
            0.4,
            {
                modelName: 'ignored-runtime-model',
                transport: 'obsidian',
                qwenRequestOptions: { enableThinking: false },
                maxTokens: 321,
                providerRequestScope,
                onProviderRequestStart,
            },
        );

        expect(createChatModel).toHaveBeenCalledWith(0.4, {
            modelName: 'configured-pagelet-model',
            transport: 'native',
            qwenRequestOptions: { enableThinking: true },
            maxTokens: 321,
            providerRequestScope,
            onProviderRequestStart,
        });
    });

    it('invalidates smoke evidence only for a forced explicit host attempt', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const clear = jest.fn();
        const controller = new AbortController();
        controller.abort();
        plugin.deepDiscoverSmokeEvidence = { clear };

        await plugin.runPageletDeepDiscover({
            path: 'notes/background.md',
            triggerReason: 'leave-note',
            signal: controller.signal,
        });
        expect(clear).not.toHaveBeenCalled();

        await plugin.runPageletDeepDiscover({
            path: 'notes/foreground.md',
            triggerReason: 'explicit',
            force: true,
            signal: controller.signal,
        });
        expect(clear).toHaveBeenCalledTimes(1);
    });

    it('clears the latest production smoke evidence when the controller resets', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const clear = jest.fn();
        plugin.deepDiscoverControllerEpoch = 4;
        plugin.deepDiscoverScheduler = null;
        plugin.deepDiscoverSmokeEvidence = {
            clear,
            snapshot: jest.fn(async () => ({ runId: 'stale-run' })),
        };

        plugin.resetDeepDiscoverController();

        expect(clear).toHaveBeenCalledTimes(1);
        expect(plugin.deepDiscoverControllerEpoch).toBe(5);
    });

    it('keeps explicit-on equivalent to the build default and rebuilds across off-to-default', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            pagelet: {
                enabled: true,
                backgroundDiscoveryEnabled: true,
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                reviewsFolder: 'Pagelet Reviews',
            },
            dataBoundary: {
                excludedFolders: [],
                excludedTags: [],
                generatedNotePolicy: 'exclude-generated',
            },
            aiProvider: 'openai',
            aiProviderPreset: 'openai',
            baseURL: 'https://api.openai.com/v1',
            webSearchEnabled: false,
            licenseTier: 'free',
            chatModelName: 'gpt-4o-mini',
            policyModelName: '',
            embeddingModelName: 'text-embedding-3-small',
            qwenThinkingEnabled: false,
        };
        plugin.getPageletSettingsWithDataBoundary = () => plugin.settings.pagelet;
        plugin.getMemoryDataBoundaryFingerprint = () => 'boundary:test';
        plugin.getPageletLocale = () => 'en';
        plugin.deepDiscoverControllerEpoch = 10;
        plugin.deepDiscoverControllerInitialization = null;
        plugin.deepDiscoverControllerInitializationIdentity = null;

        const defaultIdentity = plugin.pageletDeepDiscoverPolicyIdentityKey();
        const disposeDefault = jest.fn();
        const defaultScheduler = { dispose: disposeDefault, setAutomaticEnabled: jest.fn() };
        plugin.deepDiscoverScheduler = defaultScheduler;
        plugin.deepDiscoverControllerPolicyIdentitySnapshot = defaultIdentity;

        plugin.settings.retrievalOptimizationFlags = {
            lexicalProfile: true,
            strictReranker: true,
            graphPpr: true,
            relaxedRecovery: true,
        };
        const enabledIdentity = plugin.pageletDeepDiscoverPolicyIdentityKey();
        plugin.syncPageletDeepDiscoverControllerIdentity();
        expect(enabledIdentity).toBe(defaultIdentity);
        expect(disposeDefault).not.toHaveBeenCalled();
        expect(defaultScheduler.setAutomaticEnabled).toHaveBeenCalledWith(true);
        expect(plugin.deepDiscoverScheduler).toBe(defaultScheduler);
        expect(plugin.deepDiscoverControllerEpoch).toBe(10);

        plugin.settings.retrievalOptimizationFlags = {
            lexicalProfile: false,
            strictReranker: false,
            graphPpr: false,
            relaxedRecovery: false,
        };
        const disabledIdentity = plugin.pageletDeepDiscoverPolicyIdentityKey();
        plugin.syncPageletDeepDiscoverControllerIdentity();
        expect(disabledIdentity).not.toBe(defaultIdentity);
        expect(disposeDefault).toHaveBeenCalledTimes(1);
        expect(plugin.deepDiscoverScheduler).toBeNull();
        expect(plugin.deepDiscoverControllerEpoch).toBe(11);

        const disposeDisabled = jest.fn();
        plugin.deepDiscoverScheduler = { dispose: disposeDisabled };
        plugin.deepDiscoverControllerPolicyIdentitySnapshot = disabledIdentity;
        delete plugin.settings.retrievalOptimizationFlags;
        const restoredDefaultIdentity = plugin.pageletDeepDiscoverPolicyIdentityKey();
        plugin.syncPageletDeepDiscoverControllerIdentity();
        expect(restoredDefaultIdentity).toBe(defaultIdentity);
        expect(disposeDisabled).toHaveBeenCalledTimes(1);
        expect(plugin.deepDiscoverScheduler).toBeNull();
        expect(plugin.deepDiscoverControllerEpoch).toBe(12);
    });
});

describe('Pagelet production rate-limit storage', () => {
    const buckets = ['scope-recap', 'quiet-recall'] as const;
    const featureCaps = [
        { bucket: 'scope-recap' as const, hourly: 2, daily: 10 },
        { bucket: 'quiet-recall' as const, hourly: 10, daily: 50 },
    ];

    function createRateLimitHarness() {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            vault: {
                configDir: '.obsidian-test',
                getName: jest.fn(() => 'adapter-test-vault'),
                adapter: {
                    getBasePath: jest.fn(() => '/vaults/adapter-test-vault'),
                },
            },
        };
        plugin.scopeRecapRateLimiterInstance = null;
        plugin.quietRecallRateLimiterInstance = null;
        plugin.deepDiscoverRateLimiterInstance = null;
        return plugin;
    }

    it('keeps forced Deep Discover runs behind quota before provider admission', async () => {
        const plugin = createRateLimitHarness();
        const commit = jest.fn();
        const rollback = jest.fn(async () => undefined);
        const reserveLeaseIf = jest.fn(async (condition: () => boolean) => {
            expect(condition()).toBe(true);
            return {
                ok: true as const,
                reservation: { commit, rollback },
            };
        });
        const admitStandardCall = jest.fn(async () => undefined);
        plugin.getDeepDiscoverRateLimiter = jest.fn(() => ({ reserveLeaseIf }));
        plugin.getPageletProviderCallAdmission = jest.fn(() => ({ admitStandardCall }));
        plugin.pageletDeepDiscoverAdmissionIsCurrent = jest.fn(() => true);

        await expect(plugin.admitPageletDeepDiscoverRun('policy:v1', {
            path: 'notes/forced.md',
            triggerReason: 'explicit',
            force: true,
        })).resolves.toEqual({ ok: true });

        expect(reserveLeaseIf).toHaveBeenCalledTimes(1);
        expect(admitStandardCall).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(rollback).not.toHaveBeenCalled();
    });

    it('blocks forced Deep Discover before provider admission when quota is exhausted', async () => {
        const plugin = createRateLimitHarness();
        const reserveLeaseIf = jest.fn(async () => ({
            ok: false as const,
            reason: 'hr-cap' as const,
        }));
        const admitStandardCall = jest.fn(async () => undefined);
        plugin.getDeepDiscoverRateLimiter = jest.fn(() => ({ reserveLeaseIf }));
        plugin.getPageletProviderCallAdmission = jest.fn(() => ({ admitStandardCall }));
        plugin.pageletDeepDiscoverAdmissionIsCurrent = jest.fn(() => true);

        await expect(plugin.admitPageletDeepDiscoverRun('policy:v1', {
            path: 'notes/forced.md',
            triggerReason: 'explicit',
            force: true,
        })).resolves.toEqual({ ok: false, reason: 'limit' });

        expect(reserveLeaseIf).toHaveBeenCalledTimes(1);
        expect(admitStandardCall).not.toHaveBeenCalled();
    });

    it('isolates persisted quotas and watermarks for different same-name vaults', () => {
        const first = createRateLimitHarness();
        const second = createRateLimitHarness();
        first.app.vault.adapter.getBasePath.mockReturnValue('/vaults/one/shared-name');
        second.app.vault.adapter.getBasePath.mockReturnValue('/vaults/two/shared-name');
        first.app.vault.getName.mockReturnValue('shared-name');
        second.app.vault.getName.mockReturnValue('shared-name');

        expect(first.pageletRateLimitStorageKey('scope-recap'))
            .not.toBe(second.pageletRateLimitStorageKey('scope-recap'));
        expect(first.pageletRateLimitStorageKey('background-review'))
            .not.toBe(second.pageletRateLimitStorageKey('background-review'));
        expect(first.pageletChangeWatermarkStorageKey())
            .not.toBe(second.pageletChangeWatermarkStorageKey());
    });

    describe('attention host storage integration', () => {
        const testReceipt: DeliveryReceipt = {
            version: DELIVERY_FINGERPRINT_VERSION,
            kind: 'recall',
            fingerprint: 'v1:recall:0000000000000001',
        };

        it('isolates device-local attention state for same-name vaults at different local paths', () => {
            const localStorage = installMockWindowLocalStorage();
            try {
                const first = createRateLimitHarness();
                const second = createRateLimitHarness();
                first.app.vault.adapter.getBasePath.mockReturnValue('/vaults/one/shared-name');
                second.app.vault.adapter.getBasePath.mockReturnValue('/vaults/two/shared-name');
                first.app.vault.getName.mockReturnValue('shared-name');
                second.app.vault.getName.mockReturnValue('shared-name');

                const firstStorage = first.createPageletHost().createPageletAttentionStorage?.();
                const secondStorage = second.createPageletHost().createPageletAttentionStorage?.();
                if (!firstStorage || !secondStorage) {
                    throw new Error('expected production Pagelet attention storage');
                }

                firstStorage.save('first-vault-state');
                secondStorage.save('second-vault-state');

                const [firstKey] = localStorage.storage.setItem.mock.calls[0]!;
                const [secondKey] = localStorage.storage.setItem.mock.calls[1]!;
                expect(firstKey).toMatch(/^pa-pagelet-attention:v1:/);
                expect(secondKey).toMatch(/^pa-pagelet-attention:v1:/);
                expect(firstKey).not.toBe(secondKey);
                expect(firstStorage.load()).toBe('first-vault-state');
                expect(secondStorage.load()).toBe('second-vault-state');
            } finally {
                localStorage.restore();
            }
        });

        it('returns no host storage without stable vault identity and keeps the store session-only', () => {
            const localStorage = installMockWindowLocalStorage();
            try {
                const plugin = createRateLimitHarness();
                delete plugin.app.vault.adapter.getBasePath;
                const diagnostics: AttentionDeliveryDiagnostic[] = [];

                const storage = plugin.createPageletHost().createPageletAttentionStorage?.();
                const store = new AttentionAwareDeliveryStore({
                    storage,
                    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
                });

                expect(storage).toBeUndefined();
                expect(store.mode()).toBe('session-only');
                expect(diagnostics).toEqual([{
                    mode: 'session-only',
                    reason: 'storage-unavailable',
                }]);
                expect(localStorage.storage.getItem).not.toHaveBeenCalled();
                expect(localStorage.storage.setItem).not.toHaveBeenCalled();
            } finally {
                localStorage.restore();
            }
        });

        it('propagates localStorage read failures so the store falls back to session-only', () => {
            const localStorage = installMockWindowLocalStorage();
            try {
                const plugin = createRateLimitHarness();
                const diagnostics: AttentionDeliveryDiagnostic[] = [];
                localStorage.storage.getItem.mockImplementation(() => {
                    throw new Error('localStorage read denied');
                });
                const storage = plugin.createPageletHost().createPageletAttentionStorage?.();
                if (!storage) throw new Error('expected production Pagelet attention storage');

                const store = new AttentionAwareDeliveryStore({
                    storage,
                    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
                });

                expect(store.mode()).toBe('session-only');
                expect(diagnostics).toEqual([{
                    mode: 'session-only',
                    reason: 'storage-read-failed',
                }]);
                expect(localStorage.storage.getItem).toHaveBeenCalledTimes(1);
                expect(localStorage.storage.setItem).not.toHaveBeenCalled();
            } finally {
                localStorage.restore();
            }
        });

        it('propagates localStorage write failures while preserving current-session seen state', () => {
            const localStorage = installMockWindowLocalStorage();
            try {
                const plugin = createRateLimitHarness();
                const diagnostics: AttentionDeliveryDiagnostic[] = [];
                localStorage.storage.setItem.mockImplementation(() => {
                    throw new Error('localStorage quota denied');
                });
                const storage = plugin.createPageletHost().createPageletAttentionStorage?.();
                if (!storage) throw new Error('expected production Pagelet attention storage');
                const store = new AttentionAwareDeliveryStore({
                    storage,
                    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
                });

                store.markSeen(testReceipt, 'bubble');

                expect(store.mode()).toBe('session-only');
                expect(store.isSeen(testReceipt)).toBe(true);
                expect(diagnostics).toEqual([{
                    mode: 'session-only',
                    reason: 'storage-write-failed',
                }]);
                expect(localStorage.storage.setItem).toHaveBeenCalledTimes(1);
            } finally {
                localStorage.restore();
            }
        });

        it('serializes attention state only to localStorage, never Vault notes or settings', () => {
            const localStorage = installMockWindowLocalStorage();
            try {
                const plugin = createRateLimitHarness();
                plugin.settings = { sentinel: 'must-not-be-written' };
                plugin.saveSettings = jest.fn();
                plugin.app.vault.create = jest.fn();
                plugin.app.vault.modify = jest.fn();
                plugin.app.vault.process = jest.fn();
                plugin.app.vault.adapter.write = jest.fn();
                const storage = plugin.createPageletHost().createPageletAttentionStorage?.();
                if (!storage) throw new Error('expected production Pagelet attention storage');
                const store = new AttentionAwareDeliveryStore({
                    storage,
                    now: () => 123,
                });

                store.markSeen(testReceipt, 'detail');

                expect(localStorage.storage.setItem).toHaveBeenCalledTimes(1);
                const [key, serialized] = localStorage.storage.setItem.mock.calls[0]!;
                expect(key).toMatch(/^pa-pagelet-attention:v1:/);
                expect(JSON.parse(serialized)).toEqual({
                    schemaVersion: 1,
                    fingerprintVersion: DELIVERY_FINGERPRINT_VERSION,
                    seen: [{
                        kind: 'recall',
                        fingerprint: testReceipt.fingerprint,
                        seenAt: 123,
                        surface: 'detail',
                    }],
                    acknowledgements: [],
                });
                expect(plugin.app.vault.create).not.toHaveBeenCalled();
                expect(plugin.app.vault.modify).not.toHaveBeenCalled();
                expect(plugin.app.vault.process).not.toHaveBeenCalled();
                expect(plugin.app.vault.adapter.write).not.toHaveBeenCalled();
                expect(plugin.saveSettings).not.toHaveBeenCalled();
            } finally {
                localStorage.restore();
            }
        });
    });

    it.each(buckets)('fails %s closed when stable vault identity is unavailable', async (bucket) => {
        const localStorage = installMockWindowLocalStorage();
        try {
            const plugin = createRateLimitHarness();
            delete plugin.app.vault.adapter.getBasePath;

            await expect(getLimiter(plugin, bucket).reserve()).rejects.toThrow(
                `${bucket} rate-limit vault identity unavailable`,
            );
            expect(localStorage.storage.getItem).not.toHaveBeenCalled();
            expect(localStorage.storage.setItem).not.toHaveBeenCalled();
        } finally {
            localStorage.restore();
        }
    });

    it('keeps foreground Review quota session-local when stable vault identity is unavailable', async () => {
        const unavailableKey = 'pa-pagelet-rate-limit:foreground-review:unavailable';
        const localStorage = installMockWindowLocalStorage({
            [unavailableKey]: JSON.stringify({
                hourlyTimestamps: [Date.now()],
                dailyCount: 1,
                dailyResetAt: Date.now() + 86_400_000,
            }),
        });
        try {
            const createForegroundHarness = () => {
                const plugin = createRateLimitHarness();
                delete plugin.app.vault.adapter.getBasePath;
                plugin.settings = {
                    pagelet: {
                        foregroundPerHourCap: 1,
                        foregroundPerDayCap: 1,
                    },
                };
                plugin.pageletRateLimiterInstance = null;
                return plugin;
            };
            const firstVault = createForegroundHarness();
            const secondVault = createForegroundHarness();

            await expect(firstVault.getPageletRateLimiter().reserve()).resolves.toEqual({ ok: true });
            await expect(firstVault.getPageletRateLimiter().reserve()).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'hr-cap',
            }));
            await expect(secondVault.getPageletRateLimiter().reserve()).resolves.toEqual({ ok: true });

            expect(localStorage.storage.getItem).not.toHaveBeenCalled();
            expect(localStorage.storage.setItem).not.toHaveBeenCalled();
        } finally {
            localStorage.restore();
        }
    });

    function getLimiter(
        plugin: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        bucket: typeof buckets[number],
    ) {
        return bucket === 'scope-recap'
            ? plugin.getScopeRecapRateLimiter()
            : plugin.getQuietRecallRateLimiter();
    }

    it.each(featureCaps)(
        'enforces the production $bucket $hourly-call hourly boundary exactly',
        async ({ bucket, hourly }) => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date(2026, 6, 18, 8, 0, 0));
            const localStorage = installMockWindowLocalStorage();
            try {
                const limiter = getLimiter(createRateLimitHarness(), bucket);
                for (let call = 0; call < hourly; call += 1) {
                    await expect(limiter.reserve()).resolves.toEqual({ ok: true });
                }

                const blocked = await limiter.reserve();

                expect(blocked).toEqual(expect.objectContaining({
                    ok: false,
                    reason: 'hr-cap',
                }));
                const state = await limiter.getStateSnapshot();
                expect(state.dailyCount).toBe(hourly);
                expect(state.hourlyTimestamps).toHaveLength(hourly);
            } finally {
                localStorage.restore();
                jest.useRealTimers();
            }
        },
    );

    it.each(featureCaps)(
        'enforces the production $bucket $daily-call local-day boundary exactly',
        async ({ bucket, hourly, daily }) => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date(2026, 6, 18, 8, 0, 0));
            const localStorage = installMockWindowLocalStorage();
            try {
                const limiter = getLimiter(createRateLimitHarness(), bucket);
                const batches = daily / hourly;
                for (let batch = 0; batch < batches; batch += 1) {
                    for (let call = 0; call < hourly; call += 1) {
                        await expect(limiter.reserve()).resolves.toEqual({ ok: true });
                    }
                    jest.advanceTimersByTime(60 * 60 * 1000 + 1);
                }

                const blocked = await limiter.reserve();

                expect(blocked).toEqual(expect.objectContaining({
                    ok: false,
                    reason: 'day-cap',
                }));
                await expect(limiter.getStateSnapshot()).resolves.toEqual(expect.objectContaining({
                    dailyCount: daily,
                }));
            } finally {
                localStorage.restore();
                jest.useRealTimers();
            }
        },
    );

    it.each(buckets)('fails closed when %s localStorage is unavailable', async (bucket) => {
        const unavailable = installUnavailablePlatformLocalStorage();
        try {
            const plugin = createRateLimitHarness();
            await expect(getLimiter(plugin, bucket).reserve()).rejects.toThrow(
                `${bucket} rate-limit storage unavailable`,
            );
        } finally {
            unavailable.restore();
        }
    });

    it.each(buckets)('fails closed when %s localStorage contains bad JSON', async (bucket) => {
        const localStorage = installMockWindowLocalStorage();
        try {
            const plugin = createRateLimitHarness();
            const key = plugin.pageletRateLimitStorageKey(bucket);
            localStorage.storage.setItem(key, '{not-json');

            await expect(getLimiter(plugin, bucket).reserve()).rejects.toBeInstanceOf(SyntaxError);
        } finally {
            localStorage.restore();
        }
    });

    it.each(buckets)('fails closed when %s localStorage contains a bad state shape', async (bucket) => {
        const localStorage = installMockWindowLocalStorage();
        try {
            const plugin = createRateLimitHarness();
            const key = plugin.pageletRateLimitStorageKey(bucket);
            localStorage.storage.setItem(key, JSON.stringify({
                hourlyTimestamps: 'not-an-array',
                dailyCount: 0,
                dailyResetAt: Date.now() + 86_400_000,
            }));

            await expect(getLimiter(plugin, bucket).reserve()).rejects.toThrow(
                `${bucket} rate-limit state is malformed`,
            );
        } finally {
            localStorage.restore();
        }
    });

    it.each(buckets)('fails closed when %s localStorage persistence fails', async (bucket) => {
        const localStorage = installMockWindowLocalStorage();
        try {
            const plugin = createRateLimitHarness();
            localStorage.storage.setItem.mockImplementation(() => {
                throw new Error('storage quota denied');
            });

            await expect(getLimiter(plugin, bucket).reserve()).rejects.toThrow('storage quota denied');
        } finally {
            localStorage.restore();
        }
    });

    it('does not invoke the Scope Recap provider when its persisted limiter cannot load', async () => {
        const unavailable = installUnavailablePlatformLocalStorage();
        try {
            const invoke = jest.fn(async () => '[]');
            const plugin = createRateLimitHarness();
            plugin.settings = {
                aiProvider: 'openai',
                chatModelName: 'gpt-4o-mini',
                pagelet: {
                    enabled: true,
                    temperature: 0.2,
                    maxOutputTokens: 2_000,
                    scopeRecapBackgroundAuthorization: 'authorized-v1',
                    scopeRecapPreparationEnabled: true,
                    scopeRecapAuthorizationContextId: 'scope-recap-auth:test',
                },
            };
            plugin.collectScopeRecapSourceNotes = jest.fn(async () => [
                {
                    path: 'Projects/PA/Alpha.md',
                    title: 'Alpha',
                    content: 'Alpha commits to shipping the feature.',
                },
                {
                    path: 'Projects/PA/Beta.md',
                    title: 'Beta',
                    content: 'Beta records a pause decision for the same feature.',
                },
            ]);
            plugin.scopeRecapBuildOptions = jest.fn(() => ({
                now: new Date('2026-07-18T12:00:00.000Z'),
                scope: {
                    kind: 'folder',
                    label: 'Projects/PA',
                    paths: ['Projects/PA/Alpha.md', 'Projects/PA/Beta.md'],
                },
                isPathAllowed: jest.fn(() => true),
                dataBoundarySnapshotId: 'data_boundary:test',
            }));
            plugin.createChatModel = jest.fn(async () => ({ invoke }));
            plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'data_boundary:test');
            plugin.getScopeRecapAuthorizationContextId = jest.fn(() => 'scope-recap-auth:test');
            plugin.pageletCostTracker = { record: jest.fn() };
            plugin.log = jest.fn();

            const result = await plugin.runScopeRecap({ mode: 'background' });

            expect(result.status).toBe('no_reliable_insight');
            expect(result.attempt).toEqual(expect.objectContaining({
                outcome: 'budget_blocked',
                providerCallMade: false,
            }));
            expect(invoke).not.toHaveBeenCalled();
            expect(plugin.pageletCostTracker.record).not.toHaveBeenCalled();
        } finally {
            unavailable.restore();
        }
    });
});

describe('Quiet Recall DEC-020 production adapter', () => {
    function createRuntimeHarness(options: {
        currentContent?: string;
        candidateContent?: string;
        setupIssue?: string | null;
        includeCandidate?: boolean;
        savedInsights?: Array<Record<string, unknown>>;
        reserve?: () => Promise<{ ok: true } | { ok: false; reason: 'hr-cap' }>;
        invoke?: (prompt: string) => Promise<unknown>;
    } = {}) {
        const activeFile = createTFileWithStat('notes/current.md', { mtime: 1_000, size: 100 });
        const candidateFile = createTFileWithStat('notes/redis.md', { mtime: 900, size: 120 });
        let candidateAvailable = true;
        let currentContent = options.currentContent ?? '# Current\n\nShould we keep the Redis cache?';
        let candidateContent = options.candidateContent
            ?? '# Redis decision\n\n## Benchmarks\n\nThe previous benchmark supports keeping Redis.';
        const invoke = jest.fn(options.invoke ?? (async () => JSON.stringify({
            isConvincing: true,
            whyNow: 'Your current cache question is answered by the older Redis benchmark.',
        })));
        const reserve = jest.fn(options.reserve ?? (async () => ({ ok: true as const })));
        const reserveIf = jest.fn(async (canCommit: () => boolean | PromiseLike<boolean>) => (
            await canCommit()
                ? reserve()
                : { ok: false as const, reason: 'condition' as const }
        ));
        const reserveLeaseIf = jest.fn(async (canCommit: () => boolean | PromiseLike<boolean>) => {
            if (!await canCommit()) return { ok: false as const, reason: 'condition' as const };
            const decision = await reserve();
            if (!decision.ok) return decision;
            let committed = false;
            return {
                ok: true as const,
                reservation: {
                    commit: () => { committed = true; },
                    rollback: jest.fn(async () => { if (!committed) committed = true; }),
                },
            };
        });
        const recordCost = jest.fn();
        const createChatModel = jest.fn(async () => ({ invoke }));
        const getAISetupIssue = jest.fn(() => options.setupIssue ?? null);
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.unloading = false;
        plugin.settings = {
            quietRecall: { enabled: true },
            pagelet: {
                enabled: true,
                temperature: 0.2,
                pageletProviderFirstUseNotified: false,
                reviewsFolder: '.pagelet',
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
            },
            retrievalHabitProfile: { enabled: false, state: { aggregates: [] } },
            savedInsights: { items: options.savedInsights ?? [] },
            aiProvider: 'openai',
            aiProviderPreset: 'openai',
            baseURL: 'https://api.openai.com/v1',
            chatModelName: 'gpt-4o-mini',
            dataBoundary: {
                excludedFolders: [],
                excludedTags: [],
                generatedNotePolicy: 'exclude-generated',
            },
        };
        plugin.app = {
            workspace: { getActiveFile: jest.fn(() => activeFile) },
            vault: {
                cachedRead: jest.fn(async () => currentContent),
                read: jest.fn(async (file: TFile) => (
                    file.path === activeFile.path ? currentContent : candidateContent
                )),
                getAbstractFileByPath: jest.fn((path: string) => {
                    if (path === activeFile.path) return activeFile;
                    if (path === candidateFile.path && candidateAvailable) return candidateFile;
                    return null;
                }),
            },
            metadataCache: { getFileCache: jest.fn(() => null) },
        };
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.isDataBoundaryAllowedFile = jest.fn(() => true);
        plugin.isDataBoundaryAllowedPath = jest.fn(() => true);
        plugin.collectQuietRecallVaultNotes = jest.fn(async () => (
            options.includeCandidate === false
                ? { relatedNotes: [], vaultNotes: [] }
                : {
                    relatedNotes: [{ path: 'notes/redis.md', score: 0.95 }],
                    vaultNotes: [{
                        path: 'notes/redis.md',
                        title: 'Redis decision',
                        content: candidateContent,
                        modifiedAt: '2026-07-01T00:00:00.000Z',
                    }],
                    sourceSnapshots: [{
                        path: candidateFile.path,
                        mtime: candidateFile.stat.mtime,
                        size: candidateFile.stat.size,
                    }],
                    retrievalMode: 'semantic',
                }
        ));
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'data_boundary:test');
        plugin.getAISetupIssue = getAISetupIssue;
        plugin.createChatModel = createChatModel;
        plugin.getQuietRecallRateLimiter = jest.fn(() => ({
            reserve,
            reserveIf,
            reserveLeaseIf,
        }));
        plugin.pageletCostTracker = { record: recordCost };
        plugin.saveSettings = jest.fn(async () => undefined);
        plugin.log = jest.fn();
        plugin._lastRecallLlmEvalAt = 0;
        plugin.quietRecallRoundAdmissionTail = Promise.resolve();
        plugin.quietRecallEvaluationCoordinatorInstance = null;
        return {
            plugin,
            activeFile,
            candidateFile,
            invoke,
            reserve,
            reserveIf,
            reserveLeaseIf,
            recordCost,
            createChatModel,
            getAISetupIssue,
            setCurrentContent: (value: string) => { currentContent = value; },
            setCandidateContent: (value: string) => { candidateContent = value; },
            setCandidateAvailable: (value: boolean) => { candidateAvailable = value; },
            getCurrentContent: () => currentContent,
            getCandidateContent: () => candidateContent,
        };
    }

    function enableSemanticCollector(
        harness: ReturnType<typeof createRuntimeHarness>,
        options: { includeEvidence?: boolean } = {},
    ) {
        delete harness.plugin.collectQuietRecallVaultNotes;
        harness.plugin.app.vault.cachedRead = jest.fn(async (file: TFile) => (
            file.path === harness.activeFile.path
                ? harness.getCurrentContent()
                : harness.getCandidateContent()
        ));
        harness.plugin.app.vault.getMarkdownFiles = jest.fn(() => [
            harness.activeFile,
            harness.candidateFile,
        ]);
        harness.plugin.app.metadataCache = { resolvedLinks: {} };
        harness.plugin.isPageletMemorySearchReady = jest.fn(async () => true);
        harness.plugin.getScopeRecapAuthorizationContextId = jest.fn(() => 'provider-policy:test');
        harness.plugin.getDataBoundaryTags = jest.fn(() => []);
        harness.plugin.getGraphDiscoveryLinks = jest.fn(() => []);
        harness.plugin.getResolvedOutgoingLinks = jest.fn(() => []);
        harness.plugin.buildGraphDiscoveryBacklinkMap = jest.fn(() => new Map());
        const embedInvoke = jest.fn(async () => [0.1, 0.2]);
        const searchHybrid = jest.fn(async (
            _query: string,
            searchOptions?: {
                executeEmbeddingInvoke?: (invoke: () => Promise<number[]>) => Promise<number[]>;
            },
        ) => {
            await searchOptions?.executeEmbeddingInvoke?.(embedInvoke);
            return options.includeEvidence === false
                ? []
                : [{
                    score: 0.95,
                    doc: {
                        pageContent: 'STALE INDEX BODY MUST NOT REACH THE EVALUATOR',
                        metadata: { path: harness.candidateFile.path },
                    },
                }];
        });
        harness.plugin.vss = { searchHybrid };
        return { embedInvoke, searchHybrid };
    }

    afterEach(() => {
        jest.useRealTimers();
    });

    it('uses semantic retrieval when the local index is ready', async () => {
        const activeFile = createTFileWithStat('notes/current.md', { mtime: 1_000, size: 100 });
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const semanticCollection = {
            relatedNotes: [{ path: 'notes/related.md', score: 0.8 }],
            vaultNotes: [{ path: 'notes/related.md', content: 'Local related note.' }],
            sourceSnapshots: [{ path: 'notes/related.md', mtime: 900, size: 80 }],
            retrievalMode: 'semantic',
        };
        const relatedNotes = [{
            path: 'notes/related.md',
            content: 'Local related note.',
            score: 0.8,
            mtime: 900,
            size: 80,
        }];
        plugin.isPageletMemorySearchReady = jest.fn(async () => true);
        plugin.findPageletRelatedNotes = jest.fn(async (
            _path: string,
            _contents: Array<{ path: string; content: string }>,
            _excluded: string[],
            options: { onSearchOutcome?: (outcome: 'completed' | 'failed') => void },
        ) => {
            options.onSearchOutcome?.('completed');
            return relatedNotes;
        });
        plugin.collectQuietRecallVaultNotesFromRelatedNotes = jest.fn(async () => semanticCollection);
        plugin.collectQuietRecallVaultNotesFromMetadata = jest.fn();
        const reserveProviderCall = jest.fn(async () => undefined);
        const additionalCurrentCheck = jest.fn(() => true);

        await expect(plugin.collectQuietRecallVaultNotes(
            activeFile,
            'Current semantic topic.',
            { reserveProviderCall, additionalCurrentCheck },
        )).resolves.toBe(semanticCollection);

        expect(plugin.findPageletRelatedNotes).toHaveBeenCalledWith(
            activeFile.path,
            [{ path: activeFile.path, content: 'Current semantic topic.' }],
            [activeFile.path],
            expect.objectContaining({
                limit: 40,
                requireActivePrimary: true,
                reserveProviderCall,
                additionalCurrentCheck,
            }),
        );
        expect(plugin.collectQuietRecallVaultNotesFromRelatedNotes).toHaveBeenCalledWith(relatedNotes);
        expect(plugin.collectQuietRecallVaultNotesFromMetadata).not.toHaveBeenCalled();
    });

    it('keeps metadata candidates as a local fallback when the index is unavailable', async () => {
        const activeFile = createTFileWithStat('notes/current.md', { mtime: 1_000, size: 100 });
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const localCollection = {
            relatedNotes: [{ path: 'notes/related.md', score: 0.8 }],
            vaultNotes: [{ path: 'notes/related.md', content: 'Local related note.' }],
            sourceSnapshots: [{ path: 'notes/related.md', mtime: 900, size: 80 }],
            retrievalMode: 'metadata',
        };
        plugin.isPageletMemorySearchReady = jest.fn(async () => false);
        plugin.findPageletRelatedNotes = jest.fn();
        plugin.collectQuietRecallVaultNotesFromMetadata = jest.fn(async () => localCollection);

        await expect(plugin.collectQuietRecallVaultNotes(
            activeFile,
            'Current semantic topic.',
            {
                reserveProviderCall: jest.fn(async () => undefined),
                additionalCurrentCheck: jest.fn(() => true),
            },
        )).resolves.toBe(localCollection);

        expect(plugin.findPageletRelatedNotes).not.toHaveBeenCalled();
        expect(plugin.collectQuietRecallVaultNotesFromMetadata).toHaveBeenCalledWith(activeFile);
    });

    it('discovers a pure-semantic candidate through the budgeted shared provider seam', async () => {
        mockNoticeMessages.length = 0;
        const events: string[] = [];
        const harness = createRuntimeHarness({
            reserve: async () => {
                events.push('reserve');
                return { ok: true };
            },
            invoke: async () => {
                events.push('evaluate');
                return JSON.stringify({
                    isConvincing: true,
                    whyNow: 'The older benchmark directly informs the current cache decision.',
                });
            },
        });
        const semantic = enableSemanticCollector(harness);
        semantic.embedInvoke.mockImplementation(async () => {
            events.push('embed');
            return [0.1, 0.2];
        });

        const result = await harness.plugin.runQuietRecall();

        expect(events).toEqual(['reserve', 'embed', 'reserve', 'evaluate']);
        expect(semantic.embedInvoke).toHaveBeenCalledTimes(1);
        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(harness.invoke.mock.calls[0]?.[0]).toContain(
            'The previous benchmark supports keeping Redis.',
        );
        expect(harness.invoke.mock.calls[0]?.[0]).not.toContain('STALE INDEX BODY');
        expect(result.candidates).toHaveLength(1);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: 1,
            semanticRetrievalCalls: 1,
            totalProviderCalls: 2,
            initialCalls: 1,
        }));
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
    });

    it('spends one disclosed retrieval call and zero evaluator calls when cold semantic search is empty', async () => {
        mockNoticeMessages.length = 0;
        const harness = createRuntimeHarness();
        const semantic = enableSemanticCollector(harness, { includeEvidence: false });

        const result = await harness.plugin.runQuietRecall();

        expect(semantic.embedInvoke).toHaveBeenCalledTimes(1);
        expect(harness.reserve).toHaveBeenCalledTimes(1);
        expect(harness.createChatModel).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(result.candidates).toEqual([]);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: 0,
            semanticRetrievalCalls: 1,
            totalProviderCalls: 1,
            evaluatedCandidateCount: 0,
        }));
        expect(harness.recordCost).toHaveBeenCalledWith(expect.objectContaining({
            feature: 'quiet-recall',
            attemptKind: 'semantic-retrieval',
            outputTokens: 0,
        }));
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
    });

    it('retains the real retrieval diagnostic when the active source drifts after embedding', async () => {
        const harness = createRuntimeHarness();
        const semantic = enableSemanticCollector(harness);
        semantic.embedInvoke.mockImplementation(async () => {
            harness.activeFile.stat.mtime += 1;
            return [0.1, 0.2];
        });

        const result = await harness.plugin.runQuietRecall();

        expect(semantic.embedInvoke).toHaveBeenCalledTimes(1);
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(result.candidates).toEqual([]);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: 0,
            semanticRetrievalCalls: 1,
            totalProviderCalls: 1,
            blockedReason: 'invalid_context',
        }));
    });

    it.each([
        ['provider unavailable', (harness: ReturnType<typeof createRuntimeHarness>) => {
            harness.getAISetupIssue.mockReturnValue('provider missing');
        }],
        ['cooldown active', (harness: ReturnType<typeof createRuntimeHarness>) => {
            harness.plugin._lastRecallLlmEvalAt = Date.now();
        }],
    ])('keeps cold semantic retrieval at zero provider calls when %s', async (_label, arrange) => {
        mockNoticeMessages.length = 0;
        const harness = createRuntimeHarness();
        const semantic = enableSemanticCollector(harness);
        arrange(harness);

        const result = await harness.plugin.runQuietRecall();

        expect(semantic.embedInvoke).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(result.candidates).toEqual([]);
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('keeps a cold semantic budget rejection before embedding and first-use disclosure', async () => {
        mockNoticeMessages.length = 0;
        const harness = createRuntimeHarness({
            reserve: async () => ({ ok: false, reason: 'hr-cap' }),
        });
        const semantic = enableSemanticCollector(harness);

        const result = await harness.plugin.runQuietRecall();

        expect(harness.reserve).toHaveBeenCalledTimes(1);
        expect(semantic.embedInvoke).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(result.candidates).toEqual([]);
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('does not commit a Quiet Recall slot when the source changes while reservation is queued', async () => {
        mockNoticeMessages.length = 0;
        const harness = createRuntimeHarness();
        const semantic = enableSemanticCollector(harness);
        harness.reserveLeaseIf.mockImplementationOnce(async (canCommit) => {
            harness.activeFile.stat.mtime += 1;
            await canCommit();
            return { ok: false as const, reason: 'condition' as const };
        });

        const result = await harness.plugin.runQuietRecall();

        expect(result.candidates).toEqual([]);
        expect(harness.reserveLeaseIf).toHaveBeenCalledTimes(1);
        expect(harness.reserve).not.toHaveBeenCalled();
        expect(semantic.embedInvoke).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('reserves every actual call, retries a wrong-language result once, and reuses the exact cache during cooldown', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
        mockNoticeMessages.length = 0;
        const events: string[] = [];
        const harness = createRuntimeHarness({
            reserve: async () => {
                events.push('reserve');
                return { ok: true };
            },
            invoke: async (prompt) => {
                events.push('invoke');
                return prompt.includes('IMPORTANT:')
                    ? JSON.stringify({
                        isConvincing: true,
                        whyNow: 'The older Redis benchmark answers the cache question in the current note.',
                    })
                    : JSON.stringify({
                        isConvincing: true,
                        whyNow: '旧的 Redis 基准测试回答了当前笔记中的缓存问题。',
                    });
            },
        });

        const first = await harness.plugin.runQuietRecall();
        const cached = await harness.plugin.runQuietRecall();

        expect(events).toEqual(['reserve', 'invoke', 'reserve', 'invoke']);
        expect(first.candidates).toEqual([
            expect.objectContaining({
                evaluationProvenance: 'ai',
                evaluationFingerprint: expect.any(String),
                whyNow: ['The older Redis benchmark answers the cache question in the current note.'],
            }),
        ]);
        expect(first.discoverCandidates).toEqual([
            expect.objectContaining({ evaluationProvenance: 'local' }),
        ]);
        expect(first.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: 2,
            languageRetryCalls: 1,
        }));
        expect(cached.candidates).toHaveLength(1);
        expect(cached.evaluationDiagnostics).toEqual(expect.objectContaining({
            cacheHits: 1,
            providerCalls: 0,
        }));
        expect(harness.createChatModel).toHaveBeenCalledTimes(1);
        expect(harness.reserve).toHaveBeenCalledTimes(2);
        expect(harness.invoke).toHaveBeenCalledTimes(2);
        expect(harness.recordCost).toHaveBeenCalledTimes(2);
        expect(harness.recordCost.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            feature: 'quiet-recall',
        }));
        expect(mockNoticeMessages.filter((message) => message.includes('allowed note excerpts'))).toHaveLength(1);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(true);
        expect(harness.plugin.saveSettings).toHaveBeenCalledTimes(1);
        const initialCost = harness.recordCost.mock.calls[0]?.[0] as { inputTokens: number };
        const retryCost = harness.recordCost.mock.calls[1]?.[0] as { inputTokens: number };
        expect(retryCost.inputTokens).toBeGreaterThan(initialCost.inputTokens);
    });

    it('keeps no-candidate Quiet Recall provider-free without mutating first-use state', async () => {
        mockNoticeMessages.length = 0;
        const harness = createRuntimeHarness({ includeCandidate: false });

        const result = await harness.plugin.runQuietRecall();

        expect(result.candidates).toEqual([]);
        expect(harness.reserve).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(harness.plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('fails closed before evaluation when a candidate has no captured live source snapshot', async () => {
        mockNoticeMessages.length = 0;
        const harness = createRuntimeHarness();
        harness.plugin.collectQuietRecallVaultNotes.mockResolvedValue({
            relatedNotes: [{ path: harness.candidateFile.path, score: 0.95 }],
            vaultNotes: [{
                path: harness.candidateFile.path,
                title: 'Redis decision',
                content: harness.getCandidateContent(),
                modifiedAt: '2026-07-01T00:00:00.000Z',
            }],
            sourceSnapshots: [],
            retrievalMode: 'semantic',
        });

        const result = await harness.plugin.runQuietRecall();

        expect(result.candidates).toEqual([]);
        expect(result.discoverCandidates).toEqual([]);
        expect(harness.createChatModel).not.toHaveBeenCalled();
        expect(harness.reserve).not.toHaveBeenCalled();
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
    });

    it('invalidates cache reuse when the actual candidate digest changes and lets cooldown block the miss', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
        const harness = createRuntimeHarness();

        const first = await harness.plugin.runQuietRecall();
        harness.setCandidateContent('# Redis decision\n\n## Reversal\n\nThe benchmark now recommends removing Redis.');
        const blockedMiss = await harness.plugin.runQuietRecall();

        expect(first.candidates).toHaveLength(1);
        expect(blockedMiss.candidates).toHaveLength(0);
        expect(blockedMiss.discoverCandidates).toHaveLength(1);
        expect(blockedMiss.evaluationDiagnostics?.blockedReason).toBe('cooldown');
        expect(harness.invoke).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(60_001);
        const reevaluated = await harness.plugin.runQuietRecall();
        expect(reevaluated.candidates).toHaveLength(1);
        expect(harness.invoke).toHaveBeenCalledTimes(2);
    });

    it('invalidates cache reuse when only the end of the current note body changes', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
        const currentPrefix = '# Current\n\nShould we keep the Redis cache?\n\n## Working notes\n\n';
        const harness = createRuntimeHarness({
            currentContent: `${currentPrefix}Original end-of-body detail.`,
        });

        const first = await harness.plugin.runQuietRecall();
        harness.setCurrentContent(`${currentPrefix}Changed end-of-body detail only.`);
        const blockedMiss = await harness.plugin.runQuietRecall();

        expect(first.candidates).toHaveLength(1);
        expect(blockedMiss.candidates).toHaveLength(0);
        expect(blockedMiss.discoverCandidates).toHaveLength(1);
        expect(blockedMiss.evaluationDiagnostics?.blockedReason).toBe('cooldown');
        expect(harness.invoke).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(60_001);
        const reevaluated = await harness.plugin.runQuietRecall();
        expect(reevaluated.candidates).toHaveLength(1);
        expect(harness.invoke).toHaveBeenCalledTimes(2);
    });

    it('evaluates the actual Saved Insight text and invalidates delivery after the insight changes', async () => {
        const savedInsight = {
            id: 'ins-redis-decision',
            type: 'decision',
            text: 'SAVED-INSIGHT-DECISION-TEXT: keep Redis until the benchmark is rerun.',
            origin: 'pa-generated',
            sourceRefs: [{ path: 'notes/current.md', evidenceStrength: 'strong' }],
            whyShown: [],
            scope: { kind: 'current_note', paths: ['notes/current.md'] },
            status: 'active',
            influencePolicy: 'weak-only',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const harness = createRuntimeHarness({
            includeCandidate: false,
            savedInsights: [savedInsight],
        });

        const result = await harness.plugin.runQuietRecall();

        expect(harness.invoke).toHaveBeenCalledTimes(1);
        expect(harness.invoke.mock.calls[0]?.[0]).toContain('SAVED-INSIGHT-DECISION-TEXT');
        expect(result.candidates).toHaveLength(1);
        expect(harness.plugin.isQuietRecallRunCurrent(result)).toBe(true);

        savedInsight.status = 'archived';
        savedInsight.updatedAt = new Date(Date.now() + 1_000).toISOString();
        expect(harness.plugin.isQuietRecallRunCurrent(result)).toBe(false);
    });

    it('live-reads every Saved Insight source and excludes the whole insight when any ref is denied or unreadable', async () => {
        const now = new Date().toISOString();
        const deniedInsight = {
            id: 'ins-denied-multi-ref',
            type: 'decision',
            text: 'DENIED-SAVED-INSIGHT-SENTINEL',
            origin: 'pa-generated',
            sourceRefs: [
                { path: 'notes/current.md', evidenceStrength: 'strong' },
                { path: 'notes/denied.md', evidenceStrength: 'strong' },
                { path: 'notes/denied-companion.md', evidenceStrength: 'medium' },
            ],
            whyShown: [],
            scope: { kind: 'current_note', paths: ['notes/current.md'] },
            status: 'active',
            influencePolicy: 'weak-only',
            createdAt: now,
            updatedAt: now,
        };
        const unreadableInsight = {
            ...deniedInsight,
            id: 'ins-unreadable-multi-ref',
            text: 'UNREADABLE-SAVED-INSIGHT-SENTINEL',
            sourceRefs: [
                { path: 'notes/current.md', evidenceStrength: 'strong' },
                { path: 'notes/read-fails.md', evidenceStrength: 'strong' },
                { path: 'notes/read-fails-companion.md', evidenceStrength: 'medium' },
            ],
        };
        const safeInsight = {
            ...deniedInsight,
            id: 'ins-safe-multi-ref',
            text: 'SAFE-SAVED-INSIGHT-SENTINEL',
            sourceRefs: [
                { path: 'notes/current.md', evidenceStrength: 'strong' },
                { path: 'notes/safe-a.md', evidenceStrength: 'strong' },
                { path: 'notes/safe-b.md', evidenceStrength: 'medium' },
            ],
        };
        const harness = createRuntimeHarness({
            includeCandidate: false,
            savedInsights: [deniedInsight, unreadableInsight, safeInsight],
        });
        const extraFiles = [
            'notes/denied.md',
            'notes/denied-companion.md',
            'notes/read-fails.md',
            'notes/read-fails-companion.md',
            'notes/safe-a.md',
            'notes/safe-b.md',
        ].map((path, index) => createTFileWithStat(path, {
            mtime: 800 - index,
            size: 80 + index,
        }));
        const filesByPath = new Map<string, TFile>([
            [harness.activeFile.path, harness.activeFile],
            ...extraFiles.map((file) => [file.path, file] as const),
        ]);
        const contentByPath = new Map<string, string>([
            [harness.activeFile.path, harness.getCurrentContent()],
            ['notes/denied.md', '# Denied\n\nPRIVATE-SOURCE #no-ai'],
            ['notes/denied-companion.md', '# Companion\n\nMUST-STILL-BE-LIVE-READ'],
            ['notes/read-fails-companion.md', '# Companion\n\nMUST-ALSO-BE-LIVE-READ'],
            ['notes/safe-a.md', '# Safe A\n\nSAFE-SOURCE-A'],
            ['notes/safe-b.md', '# Safe B\n\nSAFE-SOURCE-B'],
        ]);
        harness.plugin.app.vault.getAbstractFileByPath = jest.fn((path: string) => (
            filesByPath.get(path) ?? null
        ));
        const liveRead = jest.fn(async (file: TFile) => {
            if (file.path === 'notes/read-fails.md') throw new Error('read denied');
            return contentByPath.get(file.path) ?? '';
        });
        harness.plugin.app.vault.read = liveRead;

        const result = await harness.plugin.runQuietRecall();

        const prompt = harness.invoke.mock.calls[0]?.[0] as string;
        expect(prompt).toContain('SAFE-SAVED-INSIGHT-SENTINEL');
        expect(prompt).not.toContain('DENIED-SAVED-INSIGHT-SENTINEL');
        expect(prompt).not.toContain('UNREADABLE-SAVED-INSIGHT-SENTINEL');
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            sourceInsightId: 'ins-safe-multi-ref',
        }));
        const readPaths = new Set(liveRead.mock.calls.map(([file]) => file.path));
        expect(readPaths).toEqual(new Set([
            harness.activeFile.path,
            ...extraFiles.map((file) => file.path),
        ]));
    });

    it('attributes a completed provider call to the provider and model captured at call start', async () => {
        let resolveInvoke!: (value: unknown) => void;
        let markInvokeStarted!: () => void;
        const invokeGate = new Promise<unknown>((resolve) => { resolveInvoke = resolve; });
        const invokeStarted = new Promise<void>((resolve) => { markInvokeStarted = resolve; });
        const harness = createRuntimeHarness({
            invoke: async () => {
                markInvokeStarted();
                return invokeGate;
            },
        });

        const pending = harness.plugin.runQuietRecall();
        await invokeStarted;
        expect(harness.invoke).toHaveBeenCalledTimes(1);

        harness.plugin.settings.aiProvider = 'anthropic';
        harness.plugin.settings.chatModelName = 'claude-new';
        resolveInvoke(JSON.stringify({
            isConvincing: true,
            whyNow: 'The older Redis benchmark answers the cache question in the current note.',
        }));
        await pending;

        expect(harness.recordCost).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'openai',
            model: 'gpt-4o-mini',
            feature: 'quiet-recall',
        }));
    });

    it.each([
        ['Pagelet disabled', (harness: ReturnType<typeof createRuntimeHarness>) => {
            harness.plugin.settings.pagelet.enabled = false;
        }],
        ['Quiet Recall disabled', (harness: ReturnType<typeof createRuntimeHarness>) => {
            harness.plugin.settings.quietRecall.enabled = false;
        }],
        ['plugin unload started', (harness: ReturnType<typeof createRuntimeHarness>) => {
            harness.plugin.unloading = true;
        }],
        ['source deleted', (harness: ReturnType<typeof createRuntimeHarness>) => {
            harness.setCandidateAvailable(false);
        }],
        ['active note switched', (harness: ReturnType<typeof createRuntimeHarness>) => {
            harness.plugin.app.workspace.getActiveFile.mockReturnValue(harness.candidateFile);
        }],
    ])('does not invoke Quiet Recall after limiter wait when %s', async (_label, mutate) => {
        let markReserveEntered = (): void => undefined;
        const reserveEntered = new Promise<void>((resolve) => { markReserveEntered = resolve; });
        let releaseReserve = (): void => undefined;
        const reserveGate = new Promise<void>((resolve) => { releaseReserve = resolve; });
        const harness = createRuntimeHarness({
            reserve: async () => {
                markReserveEntered();
                await reserveGate;
                return { ok: true };
            },
        });

        const pending = harness.plugin.runQuietRecall();
        await reserveEntered;
        mutate(harness);
        releaseReserve();
        const result = await pending;

        expect(harness.reserve).toHaveBeenCalledTimes(1);
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(harness.recordCost).not.toHaveBeenCalled();
        expect(result.candidates).toHaveLength(0);
        expect(result.discoverCandidates).toHaveLength(1);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            blockedReason: 'invalid_context',
            providerCalls: 0,
        }));
    });

    it('re-reads locally ranked notes from the live vault and rejects a note changed during the read', async () => {
        const candidateFile = createTFileWithStat('notes/redis.md', { mtime: 900, size: 120 }) as TFile & {
            basename: string;
        };
        candidateFile.basename = 'redis';
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const read = jest.fn<(_file: TFile) => Promise<string>>(async () => 'LIVE-VAULT-CONTENT');
        const cachedRead = jest.fn<(_file: TFile) => Promise<string>>(
            async () => 'CACHED-CONTENT-SHOULD-NOT-BE-USED',
        );
        plugin.app = {
            vault: {
                read,
                cachedRead,
                getAbstractFileByPath: jest.fn(() => candidateFile),
            },
        };
        plugin.buildGraphDiscoveryBacklinkMap = jest.fn(() => new Map());
        plugin.isDataBoundaryAllowedFile = jest.fn(() => true);
        plugin.isPageletProviderSourceAllowedFile = jest.fn(() => true);
        plugin.getDataBoundaryTags = jest.fn(() => []);
        plugin.getGraphDiscoveryLinks = jest.fn(() => []);
        plugin.log = jest.fn();

        const live = await plugin.readQuietRecallVaultNote(candidateFile, new Map());

        expect(live).toEqual({
            note: expect.objectContaining({ content: 'LIVE-VAULT-CONTENT' }),
            snapshot: {
                path: candidateFile.path,
                mtime: 900,
                size: 120,
            },
        });
        expect(read).toHaveBeenCalledWith(candidateFile);
        expect(cachedRead).not.toHaveBeenCalled();

        read.mockImplementationOnce(async () => {
            candidateFile.stat.mtime += 1;
            return 'CHANGED-DURING-READ';
        });
        const changed = await plugin.readQuietRecallVaultNote(candidateFile, new Map());
        expect(changed).toBeNull();
    });

    it('rejects the whole semantic collection when an earlier source changes during a later read', async () => {
        const firstFile = createTFileWithStat('notes/first.md', { mtime: 900, size: 120 }) as TFile & {
            basename: string;
        };
        const secondFile = createTFileWithStat('notes/second.md', { mtime: 800, size: 110 }) as TFile & {
            basename: string;
        };
        firstFile.basename = 'first';
        secondFile.basename = 'second';
        const files = new Map([
            [firstFile.path, firstFile],
            [secondFile.path, secondFile],
        ]);
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            vault: {
                read: jest.fn(async (file: TFile) => {
                    if (file.path === secondFile.path) firstFile.stat.mtime += 1;
                    return `LIVE ${file.path}`;
                }),
                getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
            },
        };
        plugin.buildGraphDiscoveryBacklinkMap = jest.fn(() => new Map());
        plugin.isDataBoundaryAllowedFile = jest.fn(() => true);
        plugin.isPageletProviderSourceAllowedFile = jest.fn(() => true);
        plugin.getDataBoundaryTags = jest.fn(() => []);
        plugin.getGraphDiscoveryLinks = jest.fn(() => []);
        plugin.log = jest.fn();

        const result = await plugin.collectQuietRecallVaultNotesFromRelatedNotes([
            { path: firstFile.path, content: 'index first', score: 0.95 },
            { path: secondFile.path, content: 'index second', score: 0.9 },
        ]);

        expect(result).toEqual({
            vaultNotes: [],
            relatedNotes: [],
            sourceSnapshots: [],
            retrievalMode: 'semantic',
        });
    });

    it('rejects a completed run after a source is deleted or its evaluation policy changes', async () => {
        const harness = createRuntimeHarness();
        const result = await harness.plugin.runQuietRecall();

        expect(harness.plugin.isQuietRecallRunCurrent(result)).toBe(true);

        harness.setCandidateAvailable(false);
        expect(harness.plugin.isQuietRecallRunCurrent(result)).toBe(false);

        harness.setCandidateAvailable(true);
        harness.plugin.settings.aiProviderPreset = 'custom';
        expect(harness.plugin.isQuietRecallRunCurrent(result)).toBe(false);
    });

    it('revalidates every captured source even when one did not become a displayed candidate', async () => {
        const harness = createRuntimeHarness();
        const result = await harness.plugin.runQuietRecall();
        const unusedFile = createTFileWithStat('notes/unused.md', { mtime: 700, size: 60 });
        const originalLookup = harness.plugin.app.vault.getAbstractFileByPath;
        harness.plugin.app.vault.getAbstractFileByPath = jest.fn((path: string) => (
            path === unusedFile.path ? unusedFile : originalLookup(path)
        ));
        const sourcePaths = [...(result.sourcePaths ?? []), unusedFile.path];
        const sourceSnapshotId = harness.plugin.buildQuietRecallRunSourceSnapshotId(
            result.currentPath,
            result.discoverCandidates ?? result.candidates,
            sourcePaths,
        );
        const expandedResult = { ...result, sourcePaths, sourceSnapshotId };

        expect(harness.plugin.isQuietRecallRunCurrent(expandedResult)).toBe(true);

        unusedFile.stat.mtime += 1;
        expect(harness.plugin.isQuietRecallRunCurrent(expandedResult)).toBe(false);
    });

    it('clears the evaluation coordinator across policy A-to-B-to-A transitions', () => {
        let dataBoundarySnapshotId = 'data_boundary:A';
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const coordinatorA = { clear: jest.fn() };
        const coordinatorB = { clear: jest.fn() };
        plugin.settings = {
            aiProvider: 'openai',
            aiProviderPreset: 'openai',
            chatModelName: 'gpt-4o-mini',
            baseURL: 'https://api.openai.com/v1',
            quietRecall: { enabled: true, bubbleNudgesEnabled: true },
            retrievalHabitProfile: { enabled: false, state: { aggregates: [] } },
            pagelet: {
                enabled: true,
                temperature: 0.2,
                maxOutputTokens: 2_000,
            },
        };
        plugin.getPageletLocale = jest.fn(() => 'en');
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => dataBoundarySnapshotId);
        plugin.registerPageletCommandsOnce = jest.fn();
        plugin.registerPageletFocusCommandOnce = jest.fn();
        plugin.pageletOrchestrator = { syncSettings: jest.fn() };
        plugin.quietRecallEvaluationCoordinatorInstance = coordinatorA;
        plugin.quietRecallEvaluationPolicyIdentitySnapshot = null;

        plugin.syncPageletRuntime();
        expect(coordinatorA.clear).not.toHaveBeenCalled();

        dataBoundarySnapshotId = 'data_boundary:B';
        plugin.syncPageletRuntime();
        expect(coordinatorA.clear).toHaveBeenCalledTimes(1);
        expect(plugin.quietRecallEvaluationCoordinatorInstance).toBeNull();

        plugin.quietRecallEvaluationCoordinatorInstance = coordinatorB;
        dataBoundarySnapshotId = 'data_boundary:A';
        plugin.syncPageletRuntime();
        expect(coordinatorB.clear).toHaveBeenCalledTimes(1);
        expect(plugin.quietRecallEvaluationCoordinatorInstance).toBeNull();
    });

    it('admits only one concurrent Quiet Recall round into the session cooldown', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
        const { plugin } = createRuntimeHarness();

        const admissions = await Promise.all([
            plugin.acquireQuietRecallRoundAdmission(),
            plugin.acquireQuietRecallRoundAdmission(),
        ]);

        expect(admissions.filter(Boolean)).toHaveLength(1);
        expect(admissions.filter((admitted: boolean) => !admitted)).toHaveLength(1);
        expect(plugin._lastRecallLlmEvalAt).toBe(Date.now());

        jest.advanceTimersByTime(60_001);
        await expect(plugin.acquireQuietRecallRoundAdmission()).resolves.toBe(true);
    });

    it('holds a concurrent first-round claim until commit, then applies cooldown', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
        const harness = createRuntimeHarness();
        const first = await harness.plugin.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        });
        expect(first.ok).toBe(true);
        let secondSettled = false;
        const secondPending = harness.plugin.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        }).then((decision: unknown) => {
            secondSettled = true;
            return decision;
        });

        await Promise.resolve();
        expect(secondSettled).toBe(false);
        if (first.ok) first.reservation.commit();
        await expect(secondPending).resolves.toEqual({ ok: false, reason: 'cooldown' });
        expect(harness.plugin._lastRecallLlmEvalAt).toBe(Date.now());
        expect(harness.reserve).toHaveBeenCalledTimes(1);
    });

    it('releases a concurrent first-round claim on rollback and lets the waiter recheck', async () => {
        const harness = createRuntimeHarness();
        const first = await harness.plugin.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        });
        expect(first.ok).toBe(true);
        const secondPending = harness.plugin.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        });

        if (first.ok) await first.reservation.rollback();
        const second = await secondPending;

        expect(second.ok).toBe(true);
        expect(harness.plugin._lastRecallLlmEvalAt).toBe(0);
        expect(harness.reserve).toHaveBeenCalledTimes(2);
        if (second.ok) await second.reservation.rollback();
    });

    it('does not start model or limiter work without a configured provider or eligible candidate', async () => {
        mockNoticeMessages.length = 0;
        const missingProvider = createRuntimeHarness({ setupIssue: 'provider missing' });
        const missingProviderResult = await missingProvider.plugin.runQuietRecall();

        expect(missingProviderResult.candidates).toHaveLength(0);
        expect(missingProviderResult.discoverCandidates).toHaveLength(1);
        expect(missingProvider.createChatModel).not.toHaveBeenCalled();
        expect(missingProvider.reserve).not.toHaveBeenCalled();
        expect(missingProvider.invoke).not.toHaveBeenCalled();
        expect(missingProvider.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(missingProvider.plugin.saveSettings).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);

        const empty = createRuntimeHarness({ includeCandidate: false });
        const emptyResult = await empty.plugin.runQuietRecall();
        expect(emptyResult.candidates).toHaveLength(0);
        expect(empty.getAISetupIssue).not.toHaveBeenCalled();
        expect(empty.createChatModel).not.toHaveBeenCalled();
        expect(empty.reserve).not.toHaveBeenCalled();
        expect(empty.invoke).not.toHaveBeenCalled();
        expect(empty.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(empty.plugin.saveSettings).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
    });

    it('blocks provider invocation when the persisted Quiet Recall bucket is exhausted', async () => {
        mockNoticeMessages.length = 0;
        const harness = createRuntimeHarness({
            reserve: async () => ({ ok: false, reason: 'hr-cap' }),
        });

        const result = await harness.plugin.runQuietRecall();

        expect(result.candidates).toHaveLength(0);
        expect(result.discoverCandidates).toHaveLength(1);
        expect(result.evaluationDiagnostics?.blockedReason).toBe('budget');
        expect(harness.reserve).toHaveBeenCalledTimes(1);
        expect(harness.invoke).not.toHaveBeenCalled();
        expect(harness.recordCost).not.toHaveBeenCalled();
        expect(harness.plugin.settings.pagelet.pageletProviderFirstUseNotified).toBe(false);
        expect(harness.plugin.saveSettings).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
    });

    it('times out a reserved provider call at twenty seconds and records its feature cost', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
        const harness = createRuntimeHarness({
            invoke: async () => new Promise<never>(() => undefined),
        });

        const pending = harness.plugin.runQuietRecall();
        await jest.advanceTimersByTimeAsync(20_000);
        const result = await pending;

        expect(result.candidates).toHaveLength(0);
        expect(result.evaluationDiagnostics?.attempts[0]).toEqual(expect.objectContaining({
            outcome: 'rejected',
            reason: 'timeout',
        }));
        expect(harness.reserve).toHaveBeenCalledTimes(1);
        expect(harness.recordCost).toHaveBeenCalledWith(expect.objectContaining({
            feature: 'quiet-recall',
            outputTokens: 0,
        }));
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

describe('B-135 legacy Personal without extraction', () => {
    it('revokes existing Insights after extraction stops when folder rename introduces new eligible notes', async () => {
        const { plugin } = createReaderHarness();
        Object.assign(plugin.settings, { memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 }, memoryExtractionIncludeVaultInsights: true });
        const files: TFile[] = [];
        const listeners = new Map<string, (file: { path: string }, oldPath: string) => Promise<void>>();
        plugin.app.vault.getMarkdownFiles = () => [...files];
        plugin.app.vault.getAbstractFileByPath = (path: string) => files.find(file => file.path === path);
        plugin.app.vault.on = (name: string, listener: (file: { path: string }, oldPath: string) => Promise<void>) => listeners.set(name, listener);
        plugin.app.metadataCache = { on: jest.fn(), getFileCache: () => ({}), resolvedLinks: {}, unresolvedLinks: {} };
        plugin.app.workspace = { on: jest.fn() };
        plugin.registerEvent = jest.fn();
        plugin.invalidateMemoryGraphTopology = jest.fn();
        plugin.isDataBoundaryAllowedFile = () => true;
        const scheduler = new MemoryExtractionScheduler({
            app: plugin.app, chatHistoryManager: {} as any, userProfileStore: new MemoryUserProfileStore(),
            includeVaultInsightsInPrompt: true,
            onVaultInsightsSourceChanged: plugin.createVaultInsightsSourceListener(),
        });
        plugin.memoryExtractionScheduler = scheduler;
        plugin.registerVaultEventDispatch();
        await scheduler.runTypeCRefresh('test');
        const receipt = plugin.getMemoryExtractionPromptContext();
        expect(receipt.isSourceCurrent()).toBe(true);
        plugin.settings.memoryExtractionEnabled = false;
        plugin.syncMemoryExtractionRuntime();
        expect(plugin.memoryExtractionScheduler).toBeNull();
        expect(receipt.isSourceCurrent()).toBe(true);
        await listeners.get('rename')!({ path: 'empty' }, 'old-empty');
        expect(receipt.isSourceCurrent()).toBe(true);
        files.push(Object.assign(createTFile('notes/imported.md'), {
            basename: 'imported', stat: { mtime: 1, ctime: 1, size: 10 },
        }));
        await listeners.get('rename')!({ path: 'notes' }, 'previously-excluded');
        expect(receipt.isSourceCurrent()).toBe(false);
        expect(plugin.memoryExtractionScheduler).toBeNull();
    });

    it.each(['create', 'modify'])('invalidates pending Insights for a Pagelet self-write %s without scheduling refresh', async (event) => {
        const { plugin } = createReaderHarness();
        const files = [Object.assign(createTFile('notes/source.md'), {
            basename: 'source', stat: { mtime: 1, ctime: 1, size: 10 },
        })];
        const listeners = new Map<string, (file: TFile) => Promise<void>>();
        plugin.app.vault.getMarkdownFiles = () => [...files];
        plugin.app.vault.getAbstractFileByPath = (path: string) => files.find(file => file.path === path);
        plugin.app.vault.on = (name: string, listener: (file: TFile) => Promise<void>) => listeners.set(name, listener);
        plugin.app.metadataCache = { on: jest.fn(), getFileCache: () => ({}), resolvedLinks: {}, unresolvedLinks: {} };
        plugin.app.workspace = { on: jest.fn() };
        plugin.registerEvent = jest.fn();
        plugin.invalidateMemoryGraphTopology = jest.fn();
        plugin.pageletRuntime = { isRecentSelfWrite: jest.fn(() => true) };
        plugin.isDataBoundaryAllowedFile = () => true;
        const scheduler = new MemoryExtractionScheduler({
            app: plugin.app, chatHistoryManager: {} as any, userProfileStore: new MemoryUserProfileStore(),
            includeVaultInsightsInPrompt: true,
            onVaultInsightsSourceChanged: plugin.createVaultInsightsSourceListener(),
        });
        plugin.memoryExtractionScheduler = scheduler;
        plugin.registerVaultEventDispatch();
        let entered!: () => void;
        let release!: () => void;
        const waiting = new Promise<void>(resolve => { entered = resolve; });
        const resume = new Promise<void>(resolve => { release = resolve; });
        scheduler.setSemanticClusterProvider(async () => { entered(); await resume; return []; });
        const refresh = jest.spyOn(scheduler, 'scheduleTypeCRefresh');
        const pending = scheduler.runTypeCRefresh('test');
        await waiting;
        const changed = event === 'create' ? Object.assign(createTFile('notes/new.md'), {
            basename: 'new', stat: { mtime: 1, ctime: 1, size: 10 },
        }) : files[0];
        if (event === 'create') files.push(changed);
        // Keep stat equal for modify: the event itself revokes metadata evidence.
        await listeners.get(event)!(changed);
        expect(plugin.pageletRuntime.isRecentSelfWrite).toHaveBeenCalledWith(changed.path);
        expect(refresh).not.toHaveBeenCalled();
        release();
        await expect(pending).resolves.toBeNull();
        expect(scheduler.getVaultInsightsSnapshot()).toBeNull();
        expect(plugin.vaultInsightsSource).toBeUndefined();
        scheduler.dispose();
    });

    it.each(['legacy', 'governed'])('keeps an existing %s Insights receipt after extraction stops, but revokes it on source or owner publication changes', async (mode) => {
        const { plugin } = createReaderHarness();
        if (mode === 'governed') {
            plugin.getGovernedMemoryProjectionSnapshot = () => ({
                state: createEmptyDeviceMemoryGovernanceStateV1(), vaultScopeKey: 'vault-insights-test',
            });
            plugin.getGovernedMemoryCurrentScope = () => ({ tags: [] });
        }
        Object.assign(plugin.settings, { memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 }, memoryExtractionIncludeVaultInsights: true });
        const FileCtor = TFile as unknown as { new(path: string): TFile };
        const file = Object.assign(new FileCtor('notes/source.md'), { path: 'notes/source.md', extension: 'md',
            basename: 'source', stat: { mtime: 1, ctime: 1, size: 10 } });
        plugin.app.vault.getMarkdownFiles = () => [file];
        plugin.app.vault.getAbstractFileByPath = () => file;
        plugin.app.metadataCache = { getFileCache: () => ({}), resolvedLinks: {}, unresolvedLinks: {} };
        plugin.isDataBoundaryAllowedFile = () => true;
        const createScheduler = () => new MemoryExtractionScheduler({
            app: plugin.app, chatHistoryManager: {} as any, userProfileStore: new MemoryUserProfileStore(),
            includeVaultInsightsInPrompt: true, getDataBoundaryFingerprint: () => plugin.getMemoryDataBoundaryFingerprint(),
            onVaultInsightsSourceChanged: plugin.createVaultInsightsSourceListener(),
        });
        const scheduler = createScheduler();
        plugin.memoryExtractionScheduler = scheduler;
        await scheduler.runTypeCRefresh('test');
        const receipt = plugin.getMemoryExtractionPromptContext();
        expect(receipt.vaultInsights ?? receipt.governedMemoryContext).toBeDefined();
        expect(receipt.isSourceCurrent()).toBe(true);
        plugin.settings.memoryExtractionEnabled = false;
        plugin.syncMemoryExtractionRuntime();
        expect(plugin.memoryExtractionScheduler).toBeNull();
        expect(receipt.isSourceCurrent()).toBe(true);
        expect(plugin.getMemoryExtractionPromptContext().vaultInsights).toBeUndefined();
        const nextScheduler = createScheduler();
        expect(receipt.isSourceCurrent()).toBe(true);
        await nextScheduler.runTypeCRefresh('replacement');
        expect(receipt.isSourceCurrent()).toBe(false);
        plugin.memoryExtractionScheduler = nextScheduler;
        plugin.settings.memoryExtractionEnabled = true;
        const replacement = plugin.getMemoryExtractionPromptContext();
        expect(replacement.isSourceCurrent()).toBe(true);
        nextScheduler.dispose();
        plugin.memoryExtractionScheduler = null;
        plugin.invalidateVaultInsightsSourceForFile(file);
        expect(replacement.isSourceCurrent()).toBe(false);
    });

    it('clears an Insights receipt on explicit disable and ignores a previous scheduler owner', async () => {
        const { plugin } = createReaderHarness();
        Object.assign(plugin.settings, { memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: 'confirmed', version: 1 }, memoryExtractionIncludeVaultInsights: true });
        plugin.app.vault.getMarkdownFiles = () => [];
        plugin.app.metadataCache = { getFileCache: () => ({}), resolvedLinks: {}, unresolvedLinks: {} };
        const makeScheduler = () => new MemoryExtractionScheduler({
            app: plugin.app, chatHistoryManager: {} as any, userProfileStore: new MemoryUserProfileStore(),
            includeVaultInsightsInPrompt: true, onVaultInsightsSourceChanged: plugin.createVaultInsightsSourceListener(),
        });
        const oldScheduler = makeScheduler();
        await oldScheduler.runTypeCRefresh('first');
        const scheduler = makeScheduler();
        await scheduler.runTypeCRefresh('new-owner');
        plugin.memoryExtractionScheduler = scheduler;
        const receipt = plugin.getMemoryExtractionPromptContext();
        expect(receipt.isSourceCurrent()).toBe(true);
        await oldScheduler.runTypeCRefresh('late-old-owner');
        expect(receipt.isSourceCurrent()).toBe(true);
        scheduler.setIncludeVaultInsightsInPrompt(false);
        expect(receipt.isSourceCurrent()).toBe(false);
        scheduler.setIncludeVaultInsightsInPrompt(true);
        await scheduler.runTypeCRefresh('reenable');
        expect(receipt.isSourceCurrent()).toBe(false);
        const next = plugin.getMemoryExtractionPromptContext();
        expect(next.isSourceCurrent()).toBe(true);
        plugin.settings.memoryEnabled = false;
        plugin.syncMemoryExtractionRuntime();
        plugin.settings.memoryEnabled = true;
        expect(next.isSourceCurrent()).toBe(false);
        oldScheduler.dispose();
        scheduler.dispose();
    });

    function createReaderHarness() {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { memoryEnabled: true, memoryExtractionEnabled: false,
            memoryExtractionConsent: { state: 'paused', version: 1 }, statisticsVaultId: 'legacy-vault' };
        plugin.app = { vault: { configDir: '.obsidian', adapter: {} } };
        plugin.getGovernedMemoryProjectionSnapshot = jest.fn(() => null);
        plugin.getMemoryGovernanceUiMode = jest.fn(() => plugin.getGovernedMemoryProjectionSnapshot()
            ? 'effect_based' : 'legacy_threshold');
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-current');
        const snapshot = { updatedAt: '2026-07-10T08:00:00.000Z', markdown: 'UNTRUSTED STORED MARKDOWN', records: [{
            profileRecordId: 'profile-existing', key: 'pref', text: 'Prefer concise Chinese replies.', kind: 'user_explicit' as const,
            confidence: 'high' as const, conversationId: 'conversation-1', observedAt: '2026-07-10T08:00:00.000Z',
            occurrences: 1, conversationIds: ['conversation-1'], confirmed: true,
        }] };
        const read = jest.fn<() => Promise<{ state: 'ready'; snapshot: typeof snapshot | null } | { state: 'unknown' | 'not_present' }>>()
            .mockResolvedValue({ state: 'ready', snapshot });
        plugin.createExistingUserProfileReader = jest.fn(() => ({ read }));
        plugin.createUserProfileStore = jest.fn();
        plugin.createChatModel = jest.fn();
        return { plugin, read, snapshot };
    }

    it.each(['unconfirmed', 'paused'])('reads existing Personal with %s extraction and no writable store or model', async (state) => {
        const { plugin, read } = createReaderHarness();
        plugin.settings.memoryExtractionConsent.state = state;
        await plugin.refreshLegacyProfileContext();
        expect(read).toHaveBeenCalledTimes(1);
        expect(plugin.getMemoryExtractionPromptContext()).toMatchObject({ memoryContextMode: 'legacy',
            userProfile: expect.stringContaining('Prefer concise Chinese replies.') });
        expect(JSON.stringify(plugin.getMemoryExtractionPromptContext())).not.toContain('UNTRUSTED STORED MARKDOWN');
        expect(plugin.canRunMemoryExtractionRuntime()).toBe(false);
        expect(plugin.memoryExtractionScheduler).toBeUndefined();
        expect(plugin.createUserProfileStore).not.toHaveBeenCalled();
        expect(plugin.createChatModel).not.toHaveBeenCalled();
    });

    it('keeps a source receipt through ordinary refresh and learning shutdown but rejects replaced records and boundaries', async () => {
        const { plugin, read, snapshot } = createReaderHarness();
        plugin.getMemoryDataBoundaryFingerprint = jest.fn(() => 'boundary-one');
        await plugin.refreshLegacyProfileContext();
        const schedulerSnapshot = plugin.legacyProfileContext.snapshot;
        plugin.memoryExtractionScheduler = { getPromptContext: () => ({ userProfile: schedulerSnapshot.markdown }),
            getUserProfileSnapshot: () => schedulerSnapshot };
        const context = plugin.getMemoryExtractionPromptContext();
        expect(context.isSourceCurrent()).toBe(true);
        expect(Object.keys(context)).not.toContain('isSourceCurrent');
        plugin.settings.memoryExtractionEnabled = false;
        plugin.settings.memoryExtractionConsent = { state: 'paused', version: 1 };
        plugin.settings.retrievalHabitLearningEnabled = false;
        plugin.memoryExtractionScheduler = null;
        let finish!: (value: { state: 'ready'; snapshot: typeof snapshot }) => void;
        read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const refresh = plugin.refreshLegacyProfileContext();
        expect(context.isSourceCurrent()).toBe(true);
        finish({ state: 'ready', snapshot });
        await refresh;
        expect(context.isSourceCurrent()).toBe(true);
        plugin.getMemoryDataBoundaryFingerprint.mockReturnValue('boundary-two');
        expect(context.isSourceCurrent()).toBe(false);
        plugin.getMemoryDataBoundaryFingerprint.mockReturnValue('boundary-one');
        read.mockResolvedValue({ state: 'ready', snapshot: { ...snapshot, records: snapshot.records.map(row => ({ ...row, profileRecordId: `profile-${'a'.repeat(32)}` })) } });
        await plugin.refreshLegacyProfileContext();
        expect(context.isSourceCurrent()).toBe(false);
        expect(plugin.getMemoryExtractionPromptContext().isSourceCurrent()).toBe(true);
    });

    it('invalidates a legacy receipt when a real profile mutation restores the same text and identity', async () => {
        const { plugin, snapshot } = createReaderHarness();
        snapshot.records[0].profileRecordId = `profile-${'b'.repeat(32)}`;
        let stored = snapshot;
        plugin.createExistingUserProfileReader.mockReturnValue({ read: async () => ({ state: 'ready', snapshot: stored }) });
        plugin.createUserProfileStore.mockReturnValue({ initialize: async () => undefined,
            getProfile: async () => stored, setProfile: async (value: typeof snapshot) => { stored = value; },
            dispose: async () => undefined });
        await plugin.refreshLegacyProfileContext();
        const context = plugin.getMemoryExtractionPromptContext();
        expect(context.isSourceCurrent()).toBe(true);
        await plugin.mutateExactProfileRecord(plugin.legacyProfileContext.snapshot.records[0].profileRecordId, () => null, false);
        stored = snapshot;
        await plugin.refreshLegacyProfileContext();
        expect(plugin.getMemoryExtractionPromptContext().userProfile).toBe(context.userProfile);
        expect(plugin.getMemoryExtractionPromptContext().isSourceCurrent()).toBe(true);
        expect(context.isSourceCurrent()).toBe(false);
        expect(plugin.createChatModel).not.toHaveBeenCalled();
    });

    it('loads retained Personal during cold onload before later startup work', async () => {
        const { plugin, read } = createReaderHarness();
        const order: string[] = [];
        const startupReached = new Error('stop after profile initialization');
        plugin.ensureLoadedPluginBuildIdentity = jest.fn(async () => undefined);
        plugin.loadSettings = jest.fn(async () => { order.push('settings'); });
        plugin.cleanupLegacyMobileDebugLog = jest.fn();
        plugin.migrateSettings = jest.fn(async () => { order.push('migration'); });
        plugin.initializeMemoryGovernanceBootstrap = jest.fn(async () => { order.push('governance'); });
        plugin.surfacePendingPageletReviewsFolderMigration = jest.fn(() => {
            expect(plugin.getMemoryExtractionPromptContext().userProfile).toContain('Prefer concise Chinese replies.');
            order.push('subsequent-startup');
            throw startupReached;
        });
        await expect(plugin.onload()).rejects.toBe(startupReached);
        expect(order).toEqual(['settings', 'migration', 'governance', 'subsequent-startup']);
        expect(read).toHaveBeenCalledTimes(1);
        expect(plugin.memoryExtractionScheduler).toBeUndefined();
        expect(plugin.createUserProfileStore).not.toHaveBeenCalled();
        expect(plugin.createChatModel).not.toHaveBeenCalled();
    });

    it.each(['unknown', 'not_present', 'empty', 'throw'] as const)('clears previous cached Personal when the next read is %s', async (state) => {
        const { plugin, read } = createReaderHarness();
        await plugin.refreshLegacyProfileContext();
        if (state === 'throw') read.mockRejectedValueOnce(new Error('fixture storage failure'));
        else if (state === 'empty') read.mockResolvedValueOnce({ state: 'ready', snapshot: null });
        else read.mockResolvedValueOnce({ state });
        await plugin.refreshLegacyProfileContext();
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'legacy' });
        expect(plugin.createUserProfileStore).not.toHaveBeenCalled();
    });

    it.each(['master-off', 'scope-change', 'unload', 'mutation'])('rejects a late legacy read after %s', async (change) => {
        const { plugin, read, snapshot } = createReaderHarness();
        let finish!: (value: { state: 'ready'; snapshot: typeof snapshot }) => void;
        read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const pending = plugin.refreshLegacyProfileContext();
        if (change === 'master-off') plugin.settings.memoryEnabled = false;
        if (change === 'scope-change') plugin.settings.statisticsVaultId = 'another-vault';
        if (change === 'unload') plugin.unloading = true;
        if (change === 'mutation') {
            plugin.legacyProfileMutationCount = 1;
            plugin.invalidateLegacyProfileContext();
        }
        finish({ state: 'ready', snapshot });
        await pending;
        plugin.legacyProfileMutationCount = 0;
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'legacy' });
    });

    it('awaits read-only loading after a settings change and clears it when Memory closes', async () => {
        const { plugin, read } = createReaderHarness();
        let changed!: () => Promise<void>;
        plugin.onSettingsChanged = jest.fn((listener: () => Promise<void>) => { changed = listener; return jest.fn(); });
        plugin.syncPageletRuntime = jest.fn();
        plugin.syncMemoryExtractionRuntime = jest.fn();
        plugin.reconcileMemoryQueueAudit = jest.fn();
        plugin.setupSettingsWatcher();
        await changed();
        expect(plugin.getMemoryExtractionPromptContext().userProfile).toContain('Prefer concise Chinese replies.');
        plugin.settings.memoryEnabled = false;
        await changed();
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'legacy' });
        expect(read).toHaveBeenCalledTimes(1);
        plugin.settings.memoryEnabled = true;
        await changed();
        expect(read).toHaveBeenCalledTimes(2);
        expect(plugin.getMemoryExtractionPromptContext().userProfile).toContain('Prefer concise Chinese replies.');
    });

    it('does not revive a forgotten legacy record when a pre-mutation read finishes late', async () => {
        const { plugin, read, snapshot } = createReaderHarness();
        let stored = snapshot;
        read.mockImplementation(async () => ({ state: 'ready', snapshot: stored }));
        await plugin.refreshLegacyProfileContext();
        const profileRecordId = plugin.legacyProfileContext.snapshot.records[0].profileRecordId;
        let finishOldRead!: (value: { state: 'ready'; snapshot: typeof snapshot }) => void;
        read.mockImplementationOnce(() => new Promise((resolve) => { finishOldRead = resolve; }));
        const oldRead = plugin.refreshLegacyProfileContext();
        const store = {
            initialize: jest.fn(async () => undefined),
            getProfile: jest.fn(async () => stored),
            setProfile: jest.fn(async (value: typeof snapshot) => { stored = value; }),
            dispose: jest.fn(async () => undefined),
        };
        plugin.createUserProfileStore.mockReturnValue(store);
        const mutation = plugin.mutateExactProfileRecord(profileRecordId, () => null, false);
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'legacy' });
        finishOldRead({ state: 'ready', snapshot });
        await oldRead;
        await mutation;
        expect(stored.records).toEqual([]);
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'legacy' });
        expect(store.dispose).toHaveBeenCalledTimes(1);
        expect(plugin.createChatModel).not.toHaveBeenCalled();
    });

    it('shares an in-flight read without accepting its result after governed cutover', async () => {
        const { plugin, read, snapshot } = createReaderHarness();
        let finish!: (value: { state: 'ready'; snapshot: typeof snapshot }) => void;
        read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const first = plugin.refreshLegacyProfileContext();
        const second = plugin.refreshLegacyProfileContext();
        expect(read).toHaveBeenCalledTimes(1);
        plugin.getGovernedMemoryProjectionSnapshot.mockReturnValue({ state: {}, vaultScopeKey: 'vault' });
        finish({ state: 'ready', snapshot });
        await Promise.all([first, second]);
        expect(plugin.legacyProfileContext).toBeNull();
    });

    it.each([false, true])('does not read cached legacy Personal when governance becomes unavailable (extraction=%s)', async (enabled) => {
        const { plugin, read } = createReaderHarness();
        await plugin.refreshLegacyProfileContext();
        plugin.settings.memoryExtractionEnabled = enabled;
        plugin.settings.memoryExtractionConsent = { state: 'confirmed', version: 1 };
        plugin.getMemoryGovernanceUiMode.mockReturnValue('unavailable');
        expect(plugin.getMemoryExtractionPromptContext()).toEqual({ memoryContextMode: 'legacy' });
        await plugin.refreshLegacyProfileContext();
        expect(read).toHaveBeenCalledTimes(1);
        expect(plugin.legacyProfileContext).toBeNull();
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

    it('replaces a detachable hot-reload detail leaf before sending the payload', async () => {
        const events: string[] = [];
        const detailView = Object.create(PageletDetailView.prototype) as PageletDetailView;
        detailView.setPayload = jest.fn(() => {
            events.push('set-payload');
        });
        const oldLeaf = {
            view: {},
            loadIfDeferred: jest.fn(async () => {
                events.push('old-load');
            }),
            setViewState: jest.fn<(_state: unknown) => Promise<void>>(async () => undefined),
            detach: jest.fn(() => {
                events.push('old-detach');
            }),
        };
        const newLeaf = {
            view: detailView,
            setViewState: jest.fn<(_state: unknown) => Promise<void>>(async () => {
                events.push('new-set-view-state');
            }),
            loadIfDeferred: jest.fn(async () => {
                events.push('new-load');
            }),
        };
        const revealLeaf = jest.fn<(_leaf: unknown) => Promise<void>>(async () => {
            events.push('reveal-new');
        });
        const getLeaf = jest.fn<(_kind: string) => typeof newLeaf>(() => {
            events.push('get-new-leaf');
            return newLeaf;
        });
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.app = {
            workspace: {
                getLeavesOfType: jest.fn(() => [oldLeaf]),
                getLeaf,
                revealLeaf,
            },
        };
        const payload = {
            title: 'Pagelet — Detail View',
            content: [],
            locale: 'en' as const,
        };

        await plugin.openPageletDetailView(payload);

        expect(oldLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
        expect(oldLeaf.detach).toHaveBeenCalledTimes(1);
        expect(oldLeaf.setViewState).not.toHaveBeenCalled();
        expect(getLeaf).toHaveBeenCalledWith('tab');
        expect(newLeaf.setViewState).toHaveBeenCalledWith({
            type: 'pa-pagelet-detail-view',
            active: true,
        });
        expect(newLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
        expect(revealLeaf).toHaveBeenCalledWith(newLeaf);
        expect(detailView.setPayload).toHaveBeenCalledWith(payload);
        expect(events).toEqual([
            'old-load',
            'old-detach',
            'get-new-leaf',
            'new-set-view-state',
            'new-load',
            'reveal-new',
            'set-payload',
        ]);
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

describe('Pagelet Operations direct action adapter', () => {
    function createHarness(initialBodies: string[]) {
        const TestTFile = TFile as unknown as new (path: string) => TFile;
        const anchorFile = new TestTFile('Notes/Anchor.md');
        const sourceFile = new TestTFile('Notes/Source.md');
        const bodies = [...initialBodies];
        let latestBody = bodies[0] ?? '';
        const read = jest.fn(async () => {
            latestBody = bodies.shift() ?? latestBody;
            return latestBody;
        });
        const stageIntent = jest.fn(async (input: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
            id: `intent-${stageIntent.mock.calls.length}`,
            runId: input.runId,
            turnId: input.turnId,
            createdAt: 1,
            expiresAt: 2,
            state: 'pending',
            operations: [{
                id: `operation-${stageIntent.mock.calls.length}`,
                ...input.operations[0],
                path: 'Notes/Anchor.md',
                expectedBefore: latestBody,
                expectedAfter: latestBody,
            }],
        }));
        const cancel = jest.fn();
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = { operationsAgentEnabled: true };
        plugin.app = {
            vault: {
                getAbstractFileByPath: jest.fn((path: string) => {
                    if (path === anchorFile.path) return anchorFile;
                    if (path === sourceFile.path) return sourceFile;
                    return null;
                }),
                read,
            },
        };
        plugin.isPageletProviderPathAllowed = jest.fn(() => true);
        plugin.pageletOperationsSession = { stageIntent, cancel };
        plugin.pageletOperationsInFlight = new Map();
        plugin.retiringPageletOperationsSessions = new Set();
        plugin.pageletOperationsSelfWrites = new Map();
        return { plugin, read, stageIntent, cancel };
    }

    it.each([
        {
            label: 'scalar',
            body: '---\npa-related: "[[Notes/Existing.md]]"\n---\nBody',
            expected: ['[[Notes/Existing.md]]', '[[Notes/Source.md]]'],
        },
        {
            label: 'array with duplicates',
            body: '---\npa-related: ["[[Notes/Existing.md]]", "[[Notes/Existing.md]]", "[[Notes/Other.md]]"]\n---\nBody',
            expected: ['[[Notes/Existing.md]]', '[[Notes/Other.md]]', '[[Notes/Source.md]]'],
        },
        {
            label: 'semantic wikilink variants',
            body: '---\npa-related: ["[[Notes/Existing]]", "[[Notes/Existing.md|Existing alias]]", "[[Notes/Existing#First]]", "[[Notes/Existing.md#First|First alias]]", "[[Notes/Existing.md#Second|Second alias]]"]\n---\nBody',
            expected: [
                '[[Notes/Existing]]',
                '[[Notes/Existing#First]]',
                '[[Notes/Existing.md#Second|Second alias]]',
                '[[Notes/Source.md]]',
            ],
        },
    ])('merges and deduplicates a $label pa-related value', async ({ body, expected }) => {
        const { plugin, stageIntent } = createHarness([body]);

        await plugin.stagePageletInsightLink({
            candidateId: 'candidate-1',
            anchorPath: 'Notes/Anchor.md',
            sourcePath: 'Notes/Source.md',
        });

        expect(stageIntent).toHaveBeenCalledTimes(1);
        expect(stageIntent.mock.calls[0]?.[0].operations).toEqual([expect.objectContaining({
            name: 'frontmatter_update',
            input: {
                path: 'Notes/Anchor.md',
                set: { 'pa-related': expected },
            },
        })]);
    });

    it.each([
        {
            label: 'already-linked notes',
            body: '---\npa-related: "[[Notes/Source.md]]"\n---\nBody',
            message: 'already linked',
        },
        {
            label: 'extensionless already-linked notes',
            body: '---\npa-related: "[[Notes/Source]]"\n---\nBody',
            message: 'already linked',
        },
        {
            label: 'aliased already-linked notes',
            body: '---\npa-related: "[[Notes/Source.md|Readable source]]"\n---\nBody',
            message: 'already linked',
        },
        {
            label: 'malformed frontmatter',
            body: '---\npa-related: "[[Notes/Existing.md]]"\nBody',
            message: 'invalid Properties',
        },
        {
            label: 'unsupported pa-related shape',
            body: '---\npa-related: true\n---\nBody',
            message: 'needs review in Chat',
        },
    ])('fails closed for $label', async ({ body, message }) => {
        const { plugin, stageIntent } = createHarness([body]);

        await expect(plugin.stagePageletInsightLink({
            candidateId: 'candidate-1',
            anchorPath: 'Notes/Anchor.md',
            sourcePath: 'Notes/Source.md',
        })).rejects.toThrow(message);

        expect(stageIntent).not.toHaveBeenCalled();
    });

    it('preserves a heading-specific relation when adding the whole-note link', async () => {
        const body = '---\npa-related: ["[[Notes/Source#Decision|Decision excerpt]]"]\n---\nBody';
        const { plugin, stageIntent } = createHarness([body]);

        await plugin.stagePageletInsightLink({
            candidateId: 'candidate-1',
            anchorPath: 'Notes/Anchor.md',
            sourcePath: 'Notes/Source.md',
        });

        expect(stageIntent.mock.calls[0]?.[0].operations[0].input.set['pa-related']).toEqual([
            '[[Notes/Source#Decision|Decision excerpt]]',
            '[[Notes/Source.md]]',
        ]);
    });

    it('cancels a drifted preview and retries once from the fresh body', async () => {
        const first = '---\npa-related: "[[Notes/Old.md]]"\n---\nFirst';
        const second = '---\npa-related: "[[Notes/Fresh.md]]"\n---\nSecond';
        const { plugin, read, stageIntent, cancel } = createHarness([first, second]);
        stageIntent
            .mockImplementationOnce(async (input: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
                id: 'intent-stale',
                runId: input.runId,
                turnId: input.turnId,
                createdAt: 1,
                expiresAt: 2,
                state: 'pending',
                operations: [{
                    id: 'operation-stale',
                    ...input.operations[0],
                    path: 'Notes/Anchor.md',
                    expectedBefore: 'different-body',
                    expectedAfter: 'different-body',
                }],
            }))
            .mockImplementationOnce(async (input: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
                id: 'intent-fresh',
                runId: input.runId,
                turnId: input.turnId,
                createdAt: 1,
                expiresAt: 2,
                state: 'pending',
                operations: [{
                    id: 'operation-fresh',
                    ...input.operations[0],
                    path: 'Notes/Anchor.md',
                    expectedBefore: second,
                    expectedAfter: second,
                }],
            }));

        const intent = await plugin.stagePageletInsightLink({
            candidateId: 'candidate-1',
            anchorPath: 'Notes/Anchor.md',
            sourcePath: 'Notes/Source.md',
        });

        expect(read).toHaveBeenCalledTimes(2);
        expect(stageIntent).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledWith('intent-stale');
        expect(intent.id).toBe('intent-fresh');
        expect(stageIntent.mock.calls[1]?.[0].operations[0].input.set['pa-related']).toEqual([
            '[[Notes/Fresh.md]]',
            '[[Notes/Source.md]]',
        ]);
    });

    it('removes only failed confirm and Undo self-write marks', async () => {
        const { plugin } = createHarness(['Body']);
        plugin.markPageletOperationsSelfWrite('Notes/Anchor.md');
        plugin.pageletOperationsSession = {
            confirm: jest.fn(async () => {
                plugin.markPageletOperationsSelfWrite('Notes/Anchor.md');
                return {
                    intentId: 'intent-1',
                    state: 'failed',
                    operations: [{
                        operationId: 'operation-1',
                        toolCallId: 'tool-1',
                        name: 'frontmatter_update',
                        path: 'Notes/Anchor.md',
                        status: 'stale',
                    }],
                };
            }),
            undoMany: jest.fn(async () => {
                plugin.markPageletOperationsSelfWrite('Notes/Undo.md');
                return [{
                    receiptId: 'receipt-1',
                    operationId: 'operation-1',
                    path: 'Notes/Undo.md',
                    status: 'stale',
                }];
            }),
        };

        await plugin.confirmPageletOperationsIntent('intent-1');
        expect(plugin.consumePageletOperationsSelfWrite('Notes/Anchor.md')).toBe(true);
        expect(plugin.consumePageletOperationsSelfWrite('Notes/Anchor.md')).toBe(false);

        await plugin.undoPageletOperationsReceipts(['receipt-1']);
        expect(plugin.consumePageletOperationsSelfWrite('Notes/Undo.md')).toBe(false);
    });

    it('retires a disabled Pagelet session only after an in-flight confirm returns its receipt', async () => {
        const { plugin } = createHarness(['Body']);
        let resolveConfirm!: (result: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
        const confirmResult = {
            intentId: 'intent-1',
            state: 'completed',
            operations: [{
                operationId: 'operation-1',
                toolCallId: 'tool-1',
                name: 'frontmatter_update',
                path: 'Notes/Anchor.md',
                status: 'succeeded',
                receiptId: 'receipt-1',
            }],
        };
        const session = {
            confirm: jest.fn(() => new Promise((resolve) => {
                resolveConfirm = resolve;
            })),
            dispose: jest.fn(),
        };
        plugin.pageletOperationsSession = session;
        plugin.resetDeepDiscoverController = jest.fn();
        plugin.log = jest.fn();

        const confirmation = plugin.confirmPageletOperationsIntent('intent-1');
        await Promise.resolve();
        plugin.destroyPageletRuntime();

        expect(session.dispose).not.toHaveBeenCalled();
        expect(plugin.pageletOperationsSession).toBeNull();

        resolveConfirm(confirmResult);
        await expect(confirmation).resolves.toMatchObject({
            operations: [expect.objectContaining({ receiptId: 'receipt-1' })],
        });
        expect(session.dispose).toHaveBeenCalledTimes(1);
    });

    it('retires a disabled Pagelet session only after an in-flight Undo settles', async () => {
        const { plugin } = createHarness(['Body']);
        let resolveUndo!: (result: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
        const session = {
            undoMany: jest.fn(() => new Promise((resolve) => {
                resolveUndo = resolve;
            })),
            dispose: jest.fn(),
        };
        plugin.pageletOperationsSession = session;
        plugin.resetDeepDiscoverController = jest.fn();
        plugin.log = jest.fn();

        const undo = plugin.undoPageletOperationsReceipts(['receipt-1']);
        await Promise.resolve();
        plugin.destroyPageletRuntime();

        expect(session.dispose).not.toHaveBeenCalled();
        resolveUndo([{
            receiptId: 'receipt-1',
            operationId: 'operation-1',
            path: 'Notes/Anchor.md',
            status: 'undone',
        }]);
        await expect(undo).resolves.toEqual([
            expect.objectContaining({ receiptId: 'receipt-1', status: 'undone' }),
        ]);
        expect(session.dispose).toHaveBeenCalledTimes(1);
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
        const pageletOperationsSession = { dispose: jest.fn() };
        const operationsService = { dispose: jest.fn() };
        plugin.pageletOperationsSession = pageletOperationsSession;
        plugin.operationsService = operationsService;
        plugin.pageletOperationsInFlight = new Map();
        plugin.retiringPageletOperationsSessions = new Set();
        plugin.pageletOperationsSelfWrites = new Map();

        plugin.destroyPageletRuntime();

        expect(plugin.createQuickCaptureService()).toBe(first);
        expect(pageletOperationsSession.dispose).toHaveBeenCalledTimes(1);
        expect(plugin.pageletOperationsSession).toBeNull();
        expect(operationsService.dispose).not.toHaveBeenCalled();
        expect(plugin.operationsService).toBe(operationsService);
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
        plugin.getAIReadiness = jest.fn(() => ({ ready: true }));
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
        expect(plugin.settings).not.toHaveProperty('memoryAutoCheckBeforeChat');
        expect(plugin.settings.memoryApprovalPolicy).toBe('always');
        expect(plugin.settings.showAdvancedMemoryControls).toBe(false);
        expect(plugin.settings.qwenThinkingEnabled).toBe(false);
        expect(plugin.settings.webSearchEnabled).toBe(false);
        expect(plugin.settings.policyModelName).toBe('');
        expect(plugin.settings.shareAnonymousCapabilityUsage).toBe(false);
        expect(plugin.settings).not.toHaveProperty('skillContextEnabled');
        expect(plugin.settings).not.toHaveProperty('enabledSkillIds');
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

    it('requires provider selection after migrating the removed Ollama provider', async () => {
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

        expect(plugin.settings.aiProvider).toBe('');
        expect(plugin.settings.baseURL).toBe('http://localhost:11434');
        expect(plugin.settings.chatModelName).toBe('llama3.1');
        expect(plugin.settings.embeddingModelName).toBe('mxbai-embed-large');
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

    it.each([
        { state: 'awaiting_confirmation', reason: 'profile_missing', tone: 'warning' },
        { state: 'stale', reason: 'scope_changed', tone: 'warning' },
        { state: 'failed', reason: 'rebuild_failed', tone: 'danger' },
        { state: 'rebuilding', reason: undefined, tone: 'warning' },
        { state: 'ready', reason: undefined, tone: undefined },
        { state: 'unavailable', reason: 'feature_disabled', tone: undefined },
    ])('distinguishes keyword index $state from ready vector Memory', ({ state, reason, tone }) => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const model = plugin.buildTechnicalMemoryStatusModel({
            status: 'ready',
            backend: 'sqlite-wasm-opfs-sahpool',
            chunkCount: 13920,
            fileCount: 1852,
            storagePersisted: true,
            fallbackMode: false,
            lexicalProfileState: state,
            lexicalFallbackReason: reason,
        }, { dirtyCount: 0, verificationPending: 0 });

        expect(model.summary).toBe('Ready');
        expect(model.details).toEqual(expect.arrayContaining([
            { label: 'Maintenance', value: 'Up to date', tone: undefined },
            { label: 'Keyword index', value: state, tone },
        ]));
        expect(model.details.filter((detail: { label: string }) => detail.label === 'Keyword index detail'))
            .toEqual(reason ? [{ label: 'Keyword index detail', value: reason }] : []);
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

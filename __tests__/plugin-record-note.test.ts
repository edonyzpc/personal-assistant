import { describe, expect, it, jest } from '@jest/globals';
import { TFile } from 'obsidian';

const mockNoticeMessages: string[] = [];
const mockBundledSkillIds = [
    'obsidian-markdown',
    'obsidian-bases',
    'json-canvas',
    'pa-frontmatter-audit',
    'pa-callout-cleanup',
    'pa-vault-link-health',
    'pa-plugin-config-review',
];

jest.mock('obsidian', () => {
    class MockPlugin { }
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
    };
});

jest.mock('obsidian-callout-manager', () => ({ getApi: jest.fn() }));
jest.mock('../src/chat-view', () => ({ VIEW_TYPE_LLM: 'llm-view', LLMView: class { } }));
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
    DEFAULT_SETTINGS: { enabledSkillIds: mockBundledSkillIds },
    normalizeEnabledSkillIds: (value: unknown) => {
        if (!Array.isArray(value)) return [...mockBundledSkillIds];
        return [...new Set(value.filter((entry): entry is string => (
            typeof entry === 'string' && mockBundledSkillIds.includes(entry)
        )))];
    },
}));
jest.mock('../src/local-graph', () => ({ LocalGraph: class { } }));
jest.mock('../src/utils', () => ({ CryptoHelper: class { }, icons: {}, personalAssitant: '' }));
jest.mock('../src/plugin-manifest', () => ({ PluginsUpdater: class { } }));
jest.mock('../src/theme-manifest', () => ({ ThemeUpdater: class { } }));
jest.mock('../src/obsidian-hack/obsidian-mobile-debug', () => ({ monkeyPatchConsole: jest.fn() }));
jest.mock('../src/callout', () => ({ CalloutModal: class { } }));
jest.mock('../src/preview', () => ({ RECORD_PREVIEW_TYPE: 'record-preview', RecordPreview: class { } }));
jest.mock('../src/stats-view', () => ({ STAT_PREVIEW_TYPE: 'stat-preview', Stat: class { } }));
jest.mock('../src/stats/stats-manager', () => ({ __esModule: true, default: class { } }));
jest.mock('../src/stats/editor-plugin', () => ({
    pluginField: { init: jest.fn(() => ({})) },
    statusBarEditorPlugin: {},
    sectionWordCountEditorPlugin: {},
}));
jest.mock('../src/stats/stats-store', () => ({ normalizeStatisticsView: (view: string) => view }));

import { PluginManager } from '../src/plugin';

const createTFile = (path: string): TFile => {
    const FileCtor = TFile as unknown as { new(path: string): TFile };
    return new FileCtor(path);
};

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
    const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    plugin.app = { vault, workspace };
    plugin.log = jest.fn();

    return { plugin, vault, openFile, createdFiles };
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
        plugin.addRibbonIcon = jest.fn(() => ({ addClass: jest.fn() }));
        plugin.addCommand = jest.fn();
        plugin.registerEvent = jest.fn();
        plugin.registerEditorExtension = jest.fn();
        plugin.addSettingTab = jest.fn();
        plugin.log = jest.fn();

        try {
            await plugin.onload();

            expect(startupOrder).toEqual(['migrate-start', 'migrate-saved', 'init-vss']);
            expect(registerView).toHaveBeenCalledWith('record-preview', expect.any(Function));
            expect(registerView).toHaveBeenCalledWith('stat-preview', expect.any(Function));
            expect(registerView).toHaveBeenCalledWith('llm-view', expect.any(Function));
            expect(registerView).toHaveBeenCalledTimes(3);
            expect(registerView.mock.invocationCallOrder[0]).toBeLessThan(
                onLayoutReady.mock.invocationCallOrder[0],
            );

            layoutCallbacks.forEach((callback) => callback());

            expect(plugin.initializeCalloutManager).toHaveBeenCalledTimes(1);
            expect(registerView).toHaveBeenCalledTimes(3);
        } finally {
            globalThis.document = originalDocument;
            globalThis.MutationObserver = originalMutationObserver;
        }
    });
});

describe('settings migration', () => {
    it('preserves the old default Qwen v3 embedding model and only shows a migration notice', async () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
        expect(plugin.settings.chatModelName).toBe('qwen-plus');
        expect(plugin.settings.embeddingModelName).toBe('text-embedding-v4');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('preserves the background memory approval policy during migration', async () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
        plugin.app = {
            vault: {
                configDir: '.vault-config',
            },
        };
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
        ]));
        expect(model.notes).toHaveLength(1);
        expect(model.notes[0]).toContain('above 50k chunks');
    });
});

import { describe, expect, it, jest } from '@jest/globals';
import { TFile } from 'obsidian';

const mockNoticeMessages: string[] = [];

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
jest.mock('../src/modal', () => ({ PluginControlModal: class { } }));
jest.mock('../src/batch-modal', () => ({ BatchPluginControlModal: class { } }));
jest.mock('../src/settings', () => ({ SettingTab: class { }, DEFAULT_SETTINGS: {} }));
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
    pluginField: {},
    statusBarEditorPlugin: {},
    sectionWordCountEditorPlugin: {},
}));
jest.mock('../src/stats/stats-store', () => ({ normalizeStatisticsView: (view: string) => view }));

import { PluginManager } from '../src/plugin';

const createTFile = (path: string): TFile => {
    const FileCtor = TFile as unknown as { new(path: string): TFile };
    return new FileCtor(path);
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

describe('settings migration', () => {
    it('preserves the old default Qwen v3 embedding model and only shows a migration notice', () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            aiProvider: 'qwen',
            embeddingModelName: 'text-embedding-v3',
            embeddingV4MigrationNoticeDismissed: false,
            statisticsType: 'overview',
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        plugin.migrateSettings();

        expect(plugin.settings.embeddingModelName).toBe('text-embedding-v3');
        expect(plugin.settings.embeddingV4MigrationNoticeDismissed).toBe(true);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages).toEqual([
            expect.stringContaining('text-embedding-v4 is recommended'),
        ]);
        expect(plugin.vss).toBeUndefined();
    });

    it('does not bother custom embedding models during migration', () => {
        mockNoticeMessages.length = 0;
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.settings = {
            aiProvider: 'qwen',
            embeddingModelName: 'custom-embedding-model',
            embeddingV4MigrationNoticeDismissed: false,
            statisticsType: 'overview',
        };
        plugin.saveSettings = jest.fn();
        plugin.log = jest.fn();

        plugin.migrateSettings();

        expect(plugin.settings.embeddingModelName).toBe('custom-embedding-model');
        expect(plugin.settings.embeddingV4MigrationNoticeDismissed).toBe(false);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([]);
    });
});

describe('VSS status performance notices', () => {
    it('warns at the exact-search thresholds without enabling another backend automatically', () => {
        const plugin = Object.create(PluginManager.prototype) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        expect(plugin.getVssPerformanceNotice(50_000)).toBe('');
        expect(plugin.getVssPerformanceNotice(50_001)).toContain('above 50k chunks');
        expect(plugin.getVssPerformanceNotice(100_001)).toContain('not enabled automatically');
    });
});

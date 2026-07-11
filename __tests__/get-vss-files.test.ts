import { describe, expect, it, jest } from '@jest/globals';
import { TFile } from 'obsidian';

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
        constructor(path: string) {
            this.path = path;
        }
    }
    return {
        Plugin: MockPlugin,
        TFile: MockTFile,
        Notice: class { },
        Platform: { isDesktop: false, isMobile: false },
        normalizePath: (path: string) => path,
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
        Modal: class { },
        Component: class { },
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
    DEFAULT_SETTINGS: { chatModelName: 'qwen3.6-plus', enabledSkillIds: mockBundledSkillIds },
    normalizeEnabledSkillIds: (value: unknown) => (Array.isArray(value) ? value : [...mockBundledSkillIds]),
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
}));
jest.mock('../src/local-graph', () => ({ LocalGraph: class { } }));
jest.mock('../src/utils', () => ({
    KEYCHAIN_API_TOKEN_ID: 'pa-api-token',
    getVaultApiTokenId: () => 'pa-api-token',
    hasSecretValue: () => false,
    icons: {},
}));
jest.mock('../src/plugin-manifest', () => ({ PluginsUpdater: class { } }));
jest.mock('../src/theme-manifest', () => ({ ThemeUpdater: class { } }));
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

interface FakeFile { path: string }

const DATA_BOUNDARY_DEFAULTS = {
    excludedFolders: [] as string[],
    excludedTags: [] as string[],
    generatedNotePolicy: "exclude-generated" as const,
};

const buildHarness = (
    files: FakeFile[],
    excludePaths: string[] | undefined,
    options: {
        dataBoundary?: Partial<typeof DATA_BOUNDARY_DEFAULTS>;
        metadataByPath?: Record<string, unknown>;
    } = {},
) => {
    const plugin = Object.create(PluginManager.prototype) as unknown as {
        app: {
            vault: {
                getMarkdownFiles: () => FakeFile[];
                getAbstractFileByPath: (path: string) => FakeFile | null;
            };
            metadataCache: { getFileCache: (file: FakeFile) => unknown };
        };
        settings: {
            vssCacheExcludePath: string[] | undefined;
            dataBoundary: typeof DATA_BOUNDARY_DEFAULTS;
        };
        getVSSFiles: () => FakeFile[];
        isDataBoundaryAllowedPath: (path: string) => boolean;
    };
    plugin.app = {
        vault: {
            getMarkdownFiles: () => files,
            getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
        },
        metadataCache: {
            getFileCache: (file: FakeFile) => options.metadataByPath?.[file.path],
        },
    };
    plugin.settings = {
        vssCacheExcludePath: excludePaths,
        dataBoundary: {
            ...DATA_BOUNDARY_DEFAULTS,
            ...options.dataBoundary,
        },
    };
    return plugin;
};

describe('PluginManager.getVSSFiles', () => {
    it('returns an empty array when the vault has no markdown files', () => {
        const plugin = buildHarness([], ['.obsidian']);
        expect(plugin.getVSSFiles()).toEqual([]);
    });

    it('returns all files when no excludePaths are configured', () => {
        const files = [{ path: 'a.md' }, { path: 'b/c.md' }];
        const plugin = buildHarness(files, []);
        expect(plugin.getVSSFiles()).toEqual(files);
    });

    it('returns all files when excludePaths is undefined', () => {
        const files = [{ path: 'a.md' }, { path: 'b/c.md' }];
        const plugin = buildHarness(files, undefined);
        expect(plugin.getVSSFiles()).toEqual(files);
    });

    it('excludes files that match a single prefix', () => {
        const keep = { path: 'notes/keep.md' };
        const drop = { path: 'private/secret.md' };
        const plugin = buildHarness([keep, drop], ['private']);
        expect(plugin.getVSSFiles()).toEqual([keep]);
    });

    it('takes the union of multiple prefix matches', () => {
        const keep = { path: 'notes/keep.md' };
        const dropA = { path: 'private/a.md' };
        const dropB = { path: 'archive/b.md' };
        const plugin = buildHarness([keep, dropA, dropB], ['private', 'archive']);
        expect(plugin.getVSSFiles()).toEqual([keep]);
    });

    it('ignores blank or empty prefix entries', () => {
        const a = { path: 'a.md' };
        const b = { path: 'b.md' };
        const plugin = buildHarness([a, b], ['', '   ']);
        expect(plugin.getVSSFiles()).toEqual([a, b]);
    });

    it('respects startsWith semantics for prefixes with and without trailing slash', () => {
        const inFolder = { path: 'docs/index.md' };
        const looksLike = { path: 'docs-archive/old.md' };
        const withSlash = buildHarness([inFolder, looksLike], ['docs/']);
        expect(withSlash.getVSSFiles()).toEqual([looksLike]);

        const withoutSlash = buildHarness([inFolder, looksLike], ['docs']);
        expect(withoutSlash.getVSSFiles()).toEqual([]);
    });

    it('applies Data Boundary folder, tag, and generated-note exclusions', () => {
        const keep = { path: 'notes/keep.md' };
        const folderDrop = { path: 'private/secret.md' };
        const tagDrop = { path: 'notes/tagged.md' };
        const generatedDrop = { path: '.pagelet/generated.md' };
        const plugin = buildHarness(
            [keep, folderDrop, tagDrop, generatedDrop],
            [],
            {
                dataBoundary: {
                    excludedFolders: ['private'],
                    excludedTags: ['sensitive'],
                },
                metadataByPath: {
                    'notes/tagged.md': { tags: [{ tag: '#Sensitive' }] },
                    '.pagelet/generated.md': { frontmatter: { pagelet: true } },
                },
            },
        );

        expect(plugin.getVSSFiles()).toEqual([keep]);
    });

    it('keeps legacy VSS excludes and Data Boundary excludes as a union', () => {
        const keep = { path: 'notes/keep.md' };
        const legacyDrop = { path: '.obsidian/plugin.md' };
        const boundaryDrop = { path: 'private/plan.md' };
        const plugin = buildHarness(
            [keep, legacyDrop, boundaryDrop],
            ['.obsidian'],
            { dataBoundary: { excludedFolders: ['private'] } },
        );

        expect(plugin.getVSSFiles()).toEqual([keep]);
    });

    it('uses existing file metadata for path-level Data Boundary checks', () => {
        const FileCtor = TFile as unknown as { new(path: string): FakeFile };
        const tagged = new FileCtor('notes/tagged.md');
        const generated = new FileCtor('Reviews/generated.md');
        const plugin = buildHarness(
            [tagged, generated],
            [],
            {
                dataBoundary: {
                    excludedTags: ['sensitive'],
                    generatedNotePolicy: 'exclude-generated',
                },
                metadataByPath: {
                    'notes/tagged.md': { tags: [{ tag: '#sensitive' }] },
                    'Reviews/generated.md': { frontmatter: { pagelet: true } },
                },
            },
        );

        expect(plugin.isDataBoundaryAllowedPath('notes/tagged.md')).toBe(false);
        expect(plugin.isDataBoundaryAllowedPath('Reviews/generated.md')).toBe(false);
        expect(plugin.isDataBoundaryAllowedPath('notes/missing.md')).toBe(true);
    });
});

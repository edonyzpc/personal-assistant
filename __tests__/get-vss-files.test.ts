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
        extension = "md";
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
            .map((line): [string, unknown] => {
                const match = /^\s*([^:#]+):\s*(.*?)\s*$/.exec(line);
                if (!match) throw new Error('malformed yaml');
                const key = match[1]!.trim();
                const raw = match[2]!.trim();
                if (raw === 'true') return [key, true];
                if (raw === 'false') return [key, false];
                if (raw.startsWith('[') && raw.endsWith(']')) {
                    return [key, raw.slice(1, -1).split(',').map((part) => part.trim())];
                }
                if (raw.startsWith('[') || raw.endsWith(']')) throw new Error('malformed yaml');
                return [key, raw];
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

interface FakeFile { path: string; extension?: string }

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
    // Vault#getMarkdownFiles always returns Markdown TFiles. Keep the harness
    // faithful to that contract while preserving each fixture's identity.
    files.forEach((file) => { file.extension ??= "md"; });
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
        isVSSFileEligible: (file: FakeFile, markdown?: string) => boolean;
        isDataBoundaryAllowedPath: (path: string) => boolean;
        log: jest.Mock;
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
    plugin.log = jest.fn();
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

    it('rejects a non-Markdown entry if a caller supplies one defensively', () => {
        const markdown = { path: 'notes/keep.md', extension: 'md' };
        const nonMarkdown = { path: 'assets/skip.pdf', extension: 'pdf' };
        const plugin = buildHarness([markdown, nonMarkdown], []);
        expect(plugin.getVSSFiles()).toEqual([markdown]);
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

    it('rechecks exact Markdown when stale MetadataCache would allow provider input', () => {
        const FileCtor = TFile as unknown as { new(path: string): FakeFile };
        const tagged = new FileCtor('notes/tagged.md');
        const generated = new FileCtor('notes/generated.md');
        const plugin = buildHarness(
            [tagged, generated],
            [],
            {
                dataBoundary: {
                    excludedTags: ['sensitive'],
                    generatedNotePolicy: 'exclude-generated',
                },
                metadataByPath: {
                    'notes/tagged.md': { tags: [] },
                    'notes/generated.md': { frontmatter: {} },
                },
            },
        );

        expect(plugin.getVSSFiles()).toEqual([tagged, generated]);
        expect(plugin.isVSSFileEligible(tagged, '# Note\n\nprivate #sensitive')).toBe(false);
        expect(plugin.isVSSFileEligible(
            tagged,
            '---\ntags: [sensitive]\n---\nprivate body',
        )).toBe(false);
        expect(plugin.isVSSFileEligible(
            generated,
            '---\npagelet: true\n---\ngenerated body',
        )).toBe(false);
    });

    it('fails exact Markdown eligibility closed for malformed leading frontmatter', () => {
        const FileCtor = TFile as unknown as { new(path: string): FakeFile };
        const file = new FileCtor('notes/malformed.md');
        const plugin = buildHarness([file], [], {
            dataBoundary: { excludedTags: ['sensitive'] },
            metadataByPath: { 'notes/malformed.md': { frontmatter: {} } },
        });

        expect(plugin.getVSSFiles()).toEqual([file]);
        expect(plugin.isVSSFileEligible(file, '---\ntags: [sensitive\nprivate body')).toBe(false);
        expect(plugin.isVSSFileEligible(file, '---\ntags: [sensitive\n---\nprivate body')).toBe(false);
    });

    it('does not treat ordinary Markdown or fenced-code tags as boundary frontmatter', () => {
        const FileCtor = TFile as unknown as { new(path: string): FakeFile };
        const file = new FileCtor('notes/ordinary.md');
        const plugin = buildHarness([file], [], {
            dataBoundary: { excludedTags: ['sensitive'] },
        });

        expect(plugin.isVSSFileEligible(
            file,
            '# Heading\n\n---\n\n```md\n#sensitive\n```\n\nordinary text',
        )).toBe(true);
    });
});

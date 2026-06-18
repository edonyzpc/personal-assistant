import { describe, expect, it, jest } from '@jest/globals';

import { createChatToolCapability } from '../src/ai-services/capability-adapter';
import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import {
    OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
    OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES,
    createInspectObsidianNoteTool,
    createListVaultTagsTool,
    createReadCanvasSummaryTool,
    createSearchVaultSnippetsTool,
    type InspectObsidianNoteOutput,
    type ReadCanvasSummaryOutput,
    type VaultSnippetSearchOutput,
    type VaultTagsOutput,
} from '../src/ai-services/chat-tools';

jest.mock('obsidian');

type VaultFile = {
    path: string;
    basename?: string;
    name?: string;
    extension?: string;
    stat?: { mtime?: number; ctime?: number; size?: number };
};

type FileCache = {
    tags?: Array<{ tag?: string }>;
    frontmatter?: Record<string, unknown>;
    headings?: Array<{ heading?: string; level?: number }>;
    links?: Array<{ link?: string; original?: string; displayText?: string }>;
    embeds?: Array<{ link?: string; original?: string; displayText?: string }>;
};

function createPlugin(overrides: {
    markdownFiles?: VaultFile[];
    abstractFiles?: VaultFile[];
    fileContents?: Record<string, string>;
    metadataByPath?: Record<string, FileCache>;
    resolvedLinks?: Record<string, Record<string, number>>;
    unresolvedLinks?: Record<string, Record<string, number>>;
    metadataCacheUnavailable?: boolean;
    vaultReadUnavailable?: boolean;
} = {}) {
    const markdownFiles = overrides.markdownFiles ?? [];
    const abstractFiles = [...markdownFiles, ...(overrides.abstractFiles ?? [])];
    const vault: {
        getMarkdownFiles: jest.Mock<() => VaultFile[]>;
        getAbstractFileByPath: jest.Mock<(path: string) => VaultFile | null>;
        cachedRead?: jest.Mock<(file: VaultFile) => Promise<string>>;
    } = {
        getMarkdownFiles: jest.fn(() => markdownFiles),
        getAbstractFileByPath: jest.fn((path: string) => (
            abstractFiles.find((file) => file.path === path) ?? null
        )),
    };
    if (!overrides.vaultReadUnavailable) {
        vault.cachedRead = jest.fn(async (file: VaultFile) => overrides.fileContents?.[file.path] ?? '');
    }
    const app: {
        workspace: {
            getActiveViewOfType: jest.Mock<() => null>;
            getMostRecentLeaf: jest.Mock<() => null>;
            getLeavesOfType: jest.Mock<() => []>;
        };
        vault: typeof vault;
        metadataCache?: {
            getFileCache: jest.Mock<(file: VaultFile) => FileCache | null>;
            resolvedLinks?: Record<string, Record<string, number>>;
            unresolvedLinks?: Record<string, Record<string, number>>;
        };
    } = {
        workspace: {
            getActiveViewOfType: jest.fn(() => null),
            getMostRecentLeaf: jest.fn(() => null),
            getLeavesOfType: jest.fn(() => []),
        },
        vault,
    };
    if (!overrides.metadataCacheUnavailable) {
        app.metadataCache = {
            getFileCache: jest.fn((file: VaultFile) => overrides.metadataByPath?.[file.path] ?? null),
            resolvedLinks: overrides.resolvedLinks,
            unresolvedLinks: overrides.unresolvedLinks,
        };
    }
    return {
        app,
        log: jest.fn(),
    };
}

function createRegistry(): CapabilityRegistry {
    const registry = new CapabilityRegistry();
    registry.register(createChatToolCapability(createInspectObsidianNoteTool(), { providerId: 'test-v1a' }));
    registry.register(createChatToolCapability(createReadCanvasSummaryTool(), { providerId: 'test-v1a' }));
    registry.register(createChatToolCapability(createSearchVaultSnippetsTool(), { providerId: 'test-v1a' }));
    registry.register(createChatToolCapability(createListVaultTagsTool(), { providerId: 'test-v1a' }));
    return registry;
}

describe('Obsidian Operations v1A App API read tools', () => {
    it('registers v1A read tools with strict read-only metadata', () => {
        const registry = createRegistry();

        expect(registry.exportProviderSchemas().map((schema) => schema.function.name)).toEqual(
            OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES,
        );
        for (const name of OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES) {
            expect(registry.getDefinition(name)).toMatchObject({
                name,
                permission: 'read-only',
                cost: 'free',
                requiresConfirmation: false,
                failureBehavior: 'recoverable',
                sourceBoundary: 'read-only-tool',
            });
            expect(registry.getDefinition(name)?.outputBudgetChars).toBeGreaterThan(0);
            expect(registry.getDefinition(name)?.outputBudgetChars).toBeLessThanOrEqual(
                OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
            );
        }
    });

    it('inspects bounded Markdown structure, links, backlinks, and unresolved links', async () => {
        const plugin = createPlugin({
            markdownFiles: [{ path: 'notes/project.md', basename: 'project' }],
            fileContents: {
                'notes/project.md': [
                    '# Overview',
                    '- [ ] Draft migration plan',
                    '- [/] Continue migration plan',
                    '- [?] Clarify blocker',
                    '> [!todo] Review later',
                    'See [[notes/related.md#Follow up|related follow-up]] and ![[assets/diagram.png#frame]]. #project',
                    'Full body detail that should not be copied as a standalone field.',
                ].join('\n'),
            },
            metadataByPath: {
                'notes/project.md': {
                    tags: [{ tag: '#project' }],
                    frontmatter: { owner: 'Eddie', detail: 'x'.repeat(200) },
                    headings: [{ heading: 'Overview', level: 1 }],
                    links: [{ link: 'notes/related.md#Follow up', original: '[[notes/related.md#Follow up|related follow-up]]' }],
                    embeds: [{ link: 'assets/diagram.png#frame', original: '![[assets/diagram.png#frame]]' }],
                },
            },
            resolvedLinks: {
                'notes/project.md': { 'notes/related.md': 1 },
                'notes/backlink.md': { 'notes/project.md': 1 },
            },
            unresolvedLinks: {
                'notes/project.md': { 'missing-note.md': 1 },
            },
        });
        const result = await createRegistry().execute('inspect_obsidian_note', { path: 'notes/project.md' }, {
            host: plugin as never,
        });

        expect(result.ok).toBe(true);
        const content = result.content as InspectObsidianNoteOutput;
        expect(content).toMatchObject({
            kind: 'note-structure',
            path: 'notes/project.md',
            title: 'project',
            properties: { owner: 'Eddie' },
        });
        expect(content.headings).toEqual([{ level: 1, text: 'Overview' }]);
        expect(content.tasks).toEqual([
            expect.objectContaining({ text: 'Draft migration plan', status: ' ', checked: false }),
            expect.objectContaining({ text: 'Continue migration plan', status: '/', checked: false }),
            expect.objectContaining({ text: 'Clarify blocker', status: '?', checked: false }),
        ]);
        expect(content.callouts).toEqual([expect.objectContaining({ type: 'todo', title: 'Review later' })]);
        expect(content.wikilinks).toContain('notes/related.md');
        expect(content.embeds).toContain('assets/diagram.png');
        expect(content.wikilinkTargets).toEqual([
            expect.objectContaining({
                raw: 'notes/related.md#Follow up|related follow-up',
                path: 'notes/related.md',
                subpath: '#Follow up',
                alias: 'related follow-up',
            }),
        ]);
        expect(content.embedTargets).toEqual([
            expect.objectContaining({
                raw: 'assets/diagram.png#frame',
                path: 'assets/diagram.png',
                subpath: '#frame',
                embedded: true,
            }),
        ]);
        expect(content.outgoingLinks).toContain('notes/related.md');
        expect(content.backlinks).toEqual(['notes/backlink.md']);
        expect(content.unresolvedLinks).toEqual(['missing-note.md']);
        expect(JSON.stringify(content)).not.toContain('Full body detail');
    });

    it('rejects malformed note inspection input instead of falling back to the active note', async () => {
        const plugin = createPlugin({
            markdownFiles: [{ path: 'notes/current.md', basename: 'current' }],
            fileContents: {
                'notes/current.md': '# Current note should not be read',
            },
        });

        const result = await createRegistry().execute('inspect_obsidian_note', '../outside.md', {
            host: plugin as never,
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('note structure input must be an object.');
        expect(result.error).not.toContain('inspect_obsidian_note');
        expect(plugin.app.vault.cachedRead).not.toHaveBeenCalled();
    });

    it('ignores Markdown structure examples inside fenced code blocks', async () => {
        const plugin = createPlugin({
            markdownFiles: [{ path: 'notes/fenced.md', basename: 'fenced' }],
            fileContents: {
                'notes/fenced.md': [
                    '# Real heading',
                    '```markdown',
                    '- [ ] Fake task',
                    '> [!warning] Fake callout',
                    '[[fake-link.md]] #fake-tag',
                    '```',
                    '- [x] Real task',
                    '> [!note] Real callout',
                    '[[real-link.md]] #real-tag',
                ].join('\n'),
            },
        });

        const result = await createRegistry().execute('inspect_obsidian_note', { path: 'notes/fenced.md' }, {
            host: plugin as never,
        });

        expect(result.ok).toBe(true);
        const content = result.content as InspectObsidianNoteOutput;
        expect(content.tasks).toEqual([expect.objectContaining({ text: 'Real task' })]);
        expect(content.callouts).toEqual([expect.objectContaining({ type: 'note', title: 'Real callout' })]);
        expect(content.wikilinks).toEqual(['real-link.md']);
        expect(content.tags).toEqual(['real-tag']);
    });

    it('summarizes Canvas structure without returning full node text', async () => {
        const longText = `Alpha ${'x'.repeat(400)}`;
        const plugin = createPlugin({
            abstractFiles: [{ path: 'maps/project.canvas', basename: 'project' }],
            fileContents: {
                'maps/project.canvas': JSON.stringify({
                    nodes: [
                        { id: 'a', type: 'text', text: longText },
                        { id: 'b', type: 'group', label: 'Group B', color: '2' },
                        { id: 'a', type: 'text', text: 'duplicate id' },
                        { id: 'c', type: 'file', file: 'notes/project.md' },
                    ],
                    edges: [
                        { id: 'e1', fromNode: 'a', toNode: 'b' },
                        { id: 'e2', fromNode: 'b', toNode: 'missing' },
                    ],
                }),
            },
        });
        const result = await createRegistry().execute('read_canvas_summary', { path: 'maps/project.canvas' }, {
            host: plugin as never,
        });

        expect(result.ok).toBe(true);
        const content = result.content as ReadCanvasSummaryOutput;
        expect(content.nodeCount).toBe(4);
        expect(content.edgeCount).toBe(2);
        expect(content.duplicateIds).toEqual(['a']);
        expect(content.danglingEdges).toEqual([expect.objectContaining({ id: 'e2', toNode: 'missing' })]);
        expect(content.isolatedNodes).toContain('c');
        expect(content.groups).toEqual([expect.objectContaining({ id: 'b', label: 'Group B' })]);
        expect(content.snippets?.[0].text.length).toBeLessThanOrEqual(183);
        expect(JSON.stringify(content)).not.toContain('x'.repeat(200));
    });

    it('searches bounded Markdown snippets with dotted folder scope and no full-body output', async () => {
        const plugin = createPlugin({
            markdownFiles: [
                { path: 'notes/2026.05/a.md', basename: 'a' },
                { path: 'archive/b.md', basename: 'b' },
            ],
            fileContents: {
                'notes/2026.05/a.md': `before ${'a'.repeat(300)} pa-positive-snippet-token-1701 after ${'b'.repeat(300)}`,
                'archive/b.md': 'pa-positive-snippet-token-1701 outside scope',
            },
        });
        const result = await createRegistry().execute('search_vault_snippets', {
            query: 'pa-positive-snippet-token-1701',
            scope: 'notes/2026.05',
            limit: 5,
        }, {
            host: plugin as never,
        });

        expect(result.ok).toBe(true);
        const content = result.content as VaultSnippetSearchOutput;
        expect(content.matches).toHaveLength(1);
        expect(content.matches[0]).toMatchObject({ path: 'notes/2026.05/a.md', line: 1 });
        expect(content.matches[0].snippet).toContain('pa-positive-snippet-token-1701');
        expect(content.matches[0].snippet.length).toBeLessThanOrEqual(263);
        expect(content.matches[0].snippet).not.toContain('a'.repeat(200));
    });

    it('reports missing snippet scopes separately from no-match results', async () => {
        const plugin = createPlugin({
            markdownFiles: [{ path: 'notes/a.md', basename: 'a' }],
            fileContents: {
                'notes/a.md': 'pa-positive-snippet-token-1701',
            },
        });

        const missingFile = await createRegistry().execute('search_vault_snippets', {
            query: 'pa-positive-snippet-token-1701',
            scope: 'notes/missing.md',
        }, {
            host: plugin as never,
        });
        const missingFolder = await createRegistry().execute('search_vault_snippets', {
            query: 'pa-positive-snippet-token-1701',
            scope: 'notes/2027.01',
        }, {
            host: plugin as never,
        });

        for (const result of [missingFile, missingFolder]) {
            expect(result.ok).toBe(true);
            expect(result.content as VaultSnippetSearchOutput).toMatchObject({
                matches: [],
                scannedFiles: 0,
                consideredFiles: 0,
                missingScope: true,
                unavailableSources: ['snippet scope not found'],
            });
        }
    });

    it('reports existing non-Markdown snippet scopes as unsupported rather than missing', async () => {
        const plugin = createPlugin({
            markdownFiles: [{ path: 'notes/a.md', basename: 'a' }],
            abstractFiles: [{ path: 'notes/source.txt', basename: 'source', extension: 'txt' }],
            fileContents: {
                'notes/a.md': 'pa-positive-snippet-token-1701',
                'notes/source.txt': 'pa-positive-snippet-token-1701 unsupported',
            },
        });

        const result = await createRegistry().execute('search_vault_snippets', {
            query: 'pa-positive-snippet-token-1701',
            scope: 'notes/source.txt',
        }, {
            host: plugin as never,
        });

        expect(result.ok).toBe(true);
        expect(result.content as VaultSnippetSearchOutput).toMatchObject({
            matches: [],
            scannedFiles: 0,
            consideredFiles: 0,
            unsupportedScope: true,
            unavailableSources: ['unsupported snippet scope'],
        });
        expect((result.content as VaultSnippetSearchOutput).missingScope).toBeUndefined();
        expect(plugin.app.vault.cachedRead).not.toHaveBeenCalled();
    });

    it('lists tag counts and representative paths from metadata cache', async () => {
        const plugin = createPlugin({
            markdownFiles: [
                { path: 'notes/a.md', basename: 'a' },
                { path: 'notes/b.md', basename: 'b' },
                { path: 'notes/c.md', basename: 'c' },
            ],
            metadataByPath: {
                'notes/a.md': { tags: [{ tag: '#project' }, { tag: '#inbox' }] },
                'notes/b.md': { tags: [{ tag: '#project' }] },
                'notes/c.md': { tags: [{ tag: '#archive' }] },
            },
        });
        const result = await createRegistry().execute('list_vault_tags', { limit: 2 }, {
            host: plugin as never,
        });

        expect(result.ok).toBe(true);
        const content = result.content as VaultTagsOutput;
        expect(content.tags).toEqual([
            { tag: '#project', count: 2, representativePaths: ['notes/a.md', 'notes/b.md'] },
            { tag: '#archive', count: 1, representativePaths: ['notes/c.md'] },
        ]);
        expect(content.truncated).toBe(true);
        expect(content.omittedCount).toBe(1);
    });

    it('includes frontmatter tags and does not silently cap per-file tag counts', async () => {
        const frontmatterTags = Array.from({ length: 25 }, (_, index) => `frontmatter-${index}`);
        const plugin = createPlugin({
            markdownFiles: [
                { path: 'notes/frontmatter.md', basename: 'frontmatter' },
                { path: 'notes/inline.md', basename: 'inline' },
            ],
            fileContents: {
                'notes/frontmatter.md': '# Frontmatter tags only',
                'notes/inline.md': '# Inline tags',
            },
            metadataByPath: {
                'notes/frontmatter.md': {
                    frontmatter: { tags: ['project', '#inbox', ...frontmatterTags] },
                },
                'notes/inline.md': {
                    tags: [{ tag: '#project' }],
                    frontmatter: { tag: 'single-tag' },
                },
            },
        });

        const inspect = await createRegistry().execute('inspect_obsidian_note', {
            path: 'notes/frontmatter.md',
        }, {
            host: plugin as never,
        });
        const tags = (inspect.content as InspectObsidianNoteOutput).tags ?? [];
        expect(tags).toEqual(expect.arrayContaining(['project', 'inbox', 'frontmatter-24']));

        const tagResult = await createRegistry().execute('list_vault_tags', { limit: 80 }, {
            host: plugin as never,
        });
        const tagContent = tagResult.content as VaultTagsOutput;
        const countedTags = tagContent.tags.map((entry) => entry.tag);
        expect(countedTags).toEqual(expect.arrayContaining([
            '#project',
            '#inbox',
            '#frontmatter-24',
            '#single-tag',
        ]));
        expect(tagContent.tags.find((entry) => entry.tag === '#project')?.count).toBe(2);
        expect(tagContent.truncated).toBeUndefined();
    });

    it('rejects unsafe targets before vault reads', async () => {
        const unsafeCases: Array<{ tool: string; input: Record<string, unknown> }> = [
            { tool: 'inspect_obsidian_note', input: { path: '/tmp/outside.md' } },
            { tool: 'inspect_obsidian_note', input: { path: '../outside.md' } },
            { tool: 'inspect_obsidian_note', input: { path: '~/outside.md' } },
            { tool: 'inspect_obsidian_note', input: { path: '$HOME/outside.md' } },
            { tool: 'inspect_obsidian_note', input: { path: 'notes/unsupported.txt' } },
            { tool: 'read_canvas_summary', input: { path: '../outside.canvas' } },
            { tool: 'search_vault_snippets', input: { query: 'token', scope: '../outside-folder' } },
        ];

        for (const unsafeCase of unsafeCases) {
            const plugin = createPlugin();
            const result = await createRegistry().execute(unsafeCase.tool, unsafeCase.input, {
                host: plugin as never,
            });

            expect(result.ok).toBe(false);
            expect(result.inputSummary).not.toBe('invalid input');
            expect(result.error).toMatch(/vault-relative path|path traversal|unsupported file type/);
            expect(plugin.app.vault.cachedRead).toBeDefined();
            expect(plugin.app.vault.cachedRead).not.toHaveBeenCalled();
        }
    });

    it('reports unavailable metadata or vault-read sources while returning bounded available context', async () => {
        const registry = createRegistry();
        const metadataUnavailablePlugin = createPlugin({
            metadataCacheUnavailable: true,
            markdownFiles: [{ path: 'notes/degraded.md', basename: 'degraded' }],
            fileContents: {
                'notes/degraded.md': [
                    '# Degraded Mode',
                    '- [ ] Keep parsed task available',
                    'See [[notes/linked.md]] and #degraded',
                ].join('\n'),
            },
        });
        const metadataUnavailableNote = await registry.execute('inspect_obsidian_note', {
            path: 'notes/degraded.md',
        }, {
            host: metadataUnavailablePlugin as never,
        });
        const metadataUnavailableTags = await registry.execute('list_vault_tags', { limit: 10 }, {
            host: metadataUnavailablePlugin as never,
        });

        expect(metadataUnavailableNote.ok).toBe(true);
        expect(metadataUnavailableNote.content as InspectObsidianNoteOutput).toMatchObject({
            headings: [{ level: 1, text: 'Degraded Mode' }],
            tasks: [expect.objectContaining({ text: 'Keep parsed task available' })],
            tags: ['degraded'],
            wikilinks: ['notes/linked.md'],
            unavailableSources: ['metadata cache'],
        });
        expect(metadataUnavailableTags.ok).toBe(true);
        expect(metadataUnavailableTags.content as VaultTagsOutput).toMatchObject({
            tags: [],
            unavailableSources: ['metadata cache'],
        });

        const vaultReadUnavailablePlugin = createPlugin({
            vaultReadUnavailable: true,
            markdownFiles: [{ path: 'notes/metadata-only.md', basename: 'metadata-only' }],
            metadataByPath: {
                'notes/metadata-only.md': {
                    tags: [{ tag: '#metadata' }],
                    frontmatter: { owner: 'Ops' },
                    headings: [{ heading: 'From cache', level: 2 }],
                    links: [{ link: 'notes/linked.md' }],
                },
            },
            resolvedLinks: {
                'notes/metadata-only.md': { 'notes/linked.md': 1 },
            },
        });
        const vaultReadUnavailableNote = await registry.execute('inspect_obsidian_note', {
            path: 'notes/metadata-only.md',
        }, {
            host: vaultReadUnavailablePlugin as never,
        });
        const vaultReadUnavailableSnippets = await registry.execute('search_vault_snippets', {
            query: 'anything',
        }, {
            host: vaultReadUnavailablePlugin as never,
        });

        expect(vaultReadUnavailableNote.ok).toBe(true);
        expect(vaultReadUnavailableNote.content as InspectObsidianNoteOutput).toMatchObject({
            properties: { owner: 'Ops' },
            tags: ['metadata'],
            headings: [{ level: 2, text: 'From cache' }],
            outgoingLinks: ['notes/linked.md'],
            unavailableSources: ['vault file read'],
        });
        expect(vaultReadUnavailableSnippets.ok).toBe(true);
        expect(vaultReadUnavailableSnippets.content as VaultSnippetSearchOutput).toMatchObject({
            matches: [],
            scannedFiles: 0,
            scannedBytes: 0,
            unavailableSources: ['vault file read'],
        });
    });

    it('uses mobile-safe read budgets before loading oversized files', async () => {
        const registry = createRegistry();
        const oversizedNote = { path: 'notes/huge.md', basename: 'huge', stat: { size: 300_001 } };
        const notePlugin = createPlugin({
            markdownFiles: [oversizedNote],
            fileContents: {
                'notes/huge.md': '# Should not be read\n- [ ] Should not be parsed',
            },
            metadataByPath: {
                'notes/huge.md': {
                    tags: [{ tag: '#huge' }],
                    headings: [{ heading: 'Cached heading', level: 1 }],
                    links: [{ link: 'notes/linked.md' }],
                },
            },
        });

        const noteResult = await registry.execute('inspect_obsidian_note', { path: 'notes/huge.md' }, {
            host: notePlugin as never,
        });

        expect(notePlugin.app.vault.cachedRead).not.toHaveBeenCalled();
        expect(noteResult.ok).toBe(true);
        expect(noteResult.content as InspectObsidianNoteOutput).toMatchObject({
            headings: [{ level: 1, text: 'Cached heading' }],
            tags: ['huge'],
            wikilinks: ['notes/linked.md'],
            tasks: [],
            truncated: true,
            skippedSources: ['vault file read skipped for size'],
        });

        const oversizedCanvas = { path: 'maps/huge.canvas', basename: 'huge', stat: { size: 300_001 } };
        const canvasPlugin = createPlugin({
            abstractFiles: [oversizedCanvas],
            fileContents: {
                'maps/huge.canvas': JSON.stringify({ nodes: [{ id: 'a', text: 'Should not be parsed' }], edges: [] }),
            },
        });

        const canvasResult = await registry.execute('read_canvas_summary', { path: 'maps/huge.canvas' }, {
            host: canvasPlugin as never,
        });

        expect(canvasPlugin.app.vault.cachedRead).not.toHaveBeenCalled();
        expect(canvasResult.ok).toBe(true);
        expect(canvasResult.content as ReadCanvasSummaryOutput).toMatchObject({
            nodeCount: 0,
            edgeCount: 0,
            truncated: true,
            skippedSources: ['vault file read skipped for size'],
        });

        const oversizedSnippet = { path: 'notes/too-large.md', basename: 'too-large', stat: { size: 100_001 } };
        const smallSnippet = { path: 'notes/small.md', basename: 'small', stat: { size: 80 } };
        const snippetPlugin = createPlugin({
            markdownFiles: [oversizedSnippet, smallSnippet],
            fileContents: {
                'notes/too-large.md': 'pa-positive-snippet-token-1701 should not be read',
                'notes/small.md': 'pa-positive-snippet-token-1701 should be found',
            },
        });

        const snippetResult = await registry.execute('search_vault_snippets', {
            query: 'pa-positive-snippet-token-1701',
            scope: 'notes',
        }, {
            host: snippetPlugin as never,
        });

        expect(snippetPlugin.app.vault.cachedRead).toHaveBeenCalledTimes(1);
        expect(snippetPlugin.app.vault.cachedRead).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/small.md' }));
        expect(snippetResult.content as VaultSnippetSearchOutput).toMatchObject({
            matches: [expect.objectContaining({ path: 'notes/small.md' })],
            scannedFiles: 1,
            skippedFiles: 1,
            truncated: true,
            skippedSources: ['vault file read skipped for size'],
        });
    });

    it('enforces v1A outputBudgetChars on direct tool results', async () => {
        const registry = createRegistry();
        const longHeading = 'Heading '.repeat(1200);
        const plugin = createPlugin({
            markdownFiles: [{ path: 'notes/long.md', basename: 'long' }],
            fileContents: {
                'notes/long.md': '# Short fallback',
            },
            metadataByPath: {
                'notes/long.md': {
                    headings: [{ heading: longHeading, level: 1 }],
                    tags: Array.from({ length: 80 }, (_, index) => ({ tag: `#tag-${index}-${'x'.repeat(80)}` })),
                    links: Array.from({ length: 80 }, (_, index) => ({ link: `notes/${'long-path-'.repeat(20)}${index}.md` })),
                },
            },
        });

        const result = await registry.execute('inspect_obsidian_note', { path: 'notes/long.md' }, {
            host: plugin as never,
        });
        const budget = registry.getDefinition('inspect_obsidian_note')?.outputBudgetChars ?? 0;

        expect(result.ok).toBe(true);
        expect(JSON.stringify(result.content).length).toBeLessThanOrEqual(budget);
        expect(result.content as InspectObsidianNoteOutput).toMatchObject({
            kind: 'note-structure',
            path: 'notes/long.md',
            truncated: true,
        });
    });

    it('enforces UTF-8 byte read budgets when file size is unavailable', async () => {
        const registry = createRegistry();
        const plugin = createPlugin({
            markdownFiles: [{ path: 'notes/multibyte.md', basename: 'multibyte' }],
            fileContents: {
                'notes/multibyte.md': `${'汉'.repeat(40_000)} pa-positive-snippet-token-1701`,
            },
        });

        const result = await registry.execute('search_vault_snippets', {
            query: 'pa-positive-snippet-token-1701',
            scope: 'notes/multibyte.md',
        }, {
            host: plugin as never,
        });

        expect(result.ok).toBe(true);
        expect(result.content as VaultSnippetSearchOutput).toMatchObject({
            matches: [],
            scannedFiles: 1,
            truncated: true,
        });
        expect((result.content as VaultSnippetSearchOutput).scannedBytes).toBeLessThanOrEqual(100_000);
    });

    it('caps tag metadata scans for large vaults', async () => {
        const manyFiles = Array.from({ length: 3005 }, (_, index) => ({
            path: `notes/tag-${index}.md`,
            basename: `tag-${index}`,
        }));
        const metadataByPath = Object.fromEntries(manyFiles.map((file, index) => [
            file.path,
            { tags: [{ tag: index % 2 === 0 ? '#even' : '#odd' }] },
        ]));
        const plugin = createPlugin({
            markdownFiles: manyFiles,
            metadataByPath,
        });

        const result = await createRegistry().execute('list_vault_tags', { limit: 5 }, {
            host: plugin as never,
        });

        expect(result.ok).toBe(true);
        expect(result.content as VaultTagsOutput).toMatchObject({
            scannedFiles: 3000,
            skippedFiles: 5,
            truncated: true,
        });
        expect((result.content as VaultTagsOutput).tags.map((entry) => entry.tag)).toEqual(['#even', '#odd']);
    });

    it('handles missing, no-match, and oversized outputs as bounded recoverable results', async () => {
        const manyHeadingLines = Array.from({ length: 70 }, (_, index) => `# Heading ${index}`).join('\n');
        const manyTasks = Array.from({ length: 50 }, (_, index) => `- [ ] Task ${index}`).join('\n');
        const manyCanvasNodes = Array.from({ length: 80 }, (_, index) => ({
            id: `node-${index}`,
            type: index % 2 === 0 ? 'group' : 'text',
            label: `Group ${index}`,
            text: `Node text ${index}`,
        }));
        const plugin = createPlugin({
            markdownFiles: [{ path: 'notes/large.md', basename: 'large' }],
            abstractFiles: [{ path: 'maps/large.canvas', basename: 'large' }],
            fileContents: {
                'notes/large.md': `${manyHeadingLines}\n${manyTasks}`,
                'maps/large.canvas': JSON.stringify({ nodes: manyCanvasNodes, edges: [] }),
            },
        });
        const registry = createRegistry();

        const missing = await registry.execute('inspect_obsidian_note', { path: 'missing.md' }, {
            host: plugin as never,
        });
        const noMatch = await registry.execute('search_vault_snippets', { query: 'pa-no-match-token-0000' }, {
            host: plugin as never,
        });
        const largeNote = await registry.execute('inspect_obsidian_note', { path: 'notes/large.md' }, {
            host: plugin as never,
        });
        const largeCanvas = await registry.execute('read_canvas_summary', { path: 'maps/large.canvas' }, {
            host: plugin as never,
        });

        expect(missing.ok).toBe(false);
        expect((noMatch.content as VaultSnippetSearchOutput).matches).toEqual([]);
        expect((largeNote.content as InspectObsidianNoteOutput).truncated).toBe(true);
        expect((largeNote.content as InspectObsidianNoteOutput).headings?.length).toBeLessThanOrEqual(50);
        expect((largeCanvas.content as ReadCanvasSummaryOutput).truncated).toBe(true);
        expect((largeCanvas.content as ReadCanvasSummaryOutput).snippets?.length).toBeLessThanOrEqual(24);
    });
});

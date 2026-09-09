import { describe, expect, it, jest } from '@jest/globals';
import {
    createCurrentNoteContextTool, createInspectObsidianNoteTool, createListRecentNotesTool,
    createListVaultTagsTool, createReadCanvasSummaryTool, createReadNoteOutlineTool,
    createSearchVaultMetadataTool, createSearchVaultSnippetsTool,
} from '../src/ai-services/chat-tool-factories';
import type { ChatToolContext, ChatToolResult } from '../src/ai-services/chat-tool-types';

jest.mock('obsidian');

function setup() {
    let current = true;
    const allowed = new Set(['allowed.md', 'allowed.canvas']);
    const files = ['allowed.md', 'denied.md', 'allowed.canvas', 'denied.canvas'].map((path) => ({
        path, name: path, basename: path.split('.')[0], extension: path.split('.')[1], stat: { mtime: 1, ctime: 1, size: 100 },
    }));
    const read = jest.fn(async (file: { path: string }) => file.path.endsWith('.canvas')
        ? JSON.stringify({ nodes: [{ id: 'n', type: 'text', text: 'Canvas secret' }], edges: [] })
        : '# Shared heading\nneedle personal text');
    const cache = jest.fn((_file: { path: string }) => ({ tags: [{ tag: '#needle' }], headings: [{ heading: 'Shared heading', level: 1 }] }));
    const editor = { getValue: jest.fn(() => '# Editor secret'), getSelection: jest.fn(() => 'Selection secret'),
        lineCount: jest.fn(() => 1), getLine: jest.fn(() => '# Editor secret'), getCursor: jest.fn(() => ({ line: 0, ch: 0 })) };
    const view = { file: files[0], editor };
    const lookup = jest.fn((path: string) => files.find((file) => file.path === path) ?? null);
    const metadata = { getFileCache: cache, resolvedLinks: {} as Record<string, Record<string, number>>,
        unresolvedLinks: {} as Record<string, Record<string, number>> };
    const host = { app: { vault: { getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
        getAbstractFileByPath: lookup, cachedRead: read }, metadataCache: metadata,
        workspace: { getActiveViewOfType: () => view } }, settings: {} } as unknown as ChatToolContext['host'];
    const context: ChatToolContext = { host, taskSourceReadGuard: { isCurrent: () => current,
        isPathAllowed: (path) => allowed.has(path) } };
    return { context, read, cache, editor, lookup, view, files, metadata, allowed, revoke: () => { current = false; } };
}

const tools: Array<{ name: string; invoke: (context: ChatToolContext, path: string) => Promise<ChatToolResult<unknown>> }> = [
    { name: 'current', invoke: (context) => createCurrentNoteContextTool().execute({ mode: 'full' }, context) },
    { name: 'recent', invoke: (context) => createListRecentNotesTool().execute({ order: 'modified', limit: 10 }, context) },
    { name: 'metadata', invoke: (context) => createSearchVaultMetadataTool().execute({ query: 'needle', limit: 10 }, context) },
    { name: 'outline', invoke: (context, path) => createReadNoteOutlineTool().execute({ path, maxHeadings: 10 }, context) },
    { name: 'inspect', invoke: (context, path) => createInspectObsidianNoteTool().execute({ path }, context) },
    { name: 'canvas', invoke: (context, path) => createReadCanvasSummaryTool().execute({ path: path.replace('.md', '.canvas') }, context) },
    { name: 'snippets', invoke: (context) => createSearchVaultSnippetsTool().execute({ query: 'needle', limit: 5 }, context) },
    { name: 'tags', invoke: (context) => createListVaultTagsTool().execute({ limit: 10 }, context) },
];

describe('Vault tool task-source read boundaries', () => {
    it.each(tools)('$name performs zero reads when the per-call lifetime is already revoked', async ({ invoke }) => {
        const f = setup();
        f.revoke();
        await expect(invoke(f.context, 'allowed.md')).rejects.toThrow('no longer current');
        for (const spy of [f.read, f.cache, f.lookup, ...Object.values(f.editor)]) expect(spy).not.toHaveBeenCalled();
    });

    it.each(tools)('$name excludes denied files before reading body, metadata or editor facts', async ({ name, invoke }) => {
        const f = setup();
        f.view.file = f.files[1];
        const result = await invoke(f.context, 'denied.md');
        expect(f.read.mock.calls.every(([file]) => f.allowed.has(file.path))).toBe(true);
        expect(f.cache.mock.calls.every(([file]) => f.allowed.has(file.path))).toBe(true);
        expect(f.lookup).not.toHaveBeenCalledWith('denied.md');
        expect(f.lookup).not.toHaveBeenCalledWith('denied.canvas');
        for (const spy of Object.values(f.editor)) expect(spy).not.toHaveBeenCalled();
        if (['current', 'outline', 'inspect', 'canvas'].includes(name)) {
            expect(result.ok).toBe(false);
            expect(f.read).not.toHaveBeenCalled();
            expect(f.cache).not.toHaveBeenCalled();
        } else {
            expect(result.ok).toBe(true);
            expect(JSON.stringify(result)).not.toContain('denied.md');
        }
    });

    it.each(['outline', 'inspect', 'canvas', 'snippets'])('%s discards an in-flight read after source revocation', async (name) => {
        const f = setup();
        f.cache.mockReturnValue({ tags: [], headings: undefined } as unknown as ReturnType<typeof f.cache>);
        let release!: (content: string) => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => { entered = resolve; });
        f.read.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; entered(); }));
        const reading = tools.find((entry) => entry.name === name)!.invoke(f.context, 'allowed.md');
        await started;
        f.revoke();
        release('# secret before revocation');
        await expect(reading).rejects.toThrow('no longer current');
        expect(f.read).toHaveBeenCalledTimes(1);
    });

    it('intersects the old path predicate with the per-call guard', async () => {
        const f = setup();
        const result = await createSearchVaultMetadataTool({ isPathAllowed: (path) => path === 'denied.md' })
            .execute({ query: 'needle', limit: 5 }, f.context);
        expect(result.content?.matches).toEqual([]);
        expect(f.cache).not.toHaveBeenCalled();
    });

    it.each(['recent', 'metadata'])('%s enumerates excluded paths without inspecting their title or statistics', async (name) => {
        const f = setup();
        const deniedStat = jest.fn(() => { throw new Error('Excluded statistics read'); });
        const deniedTitle = jest.fn(() => { throw new Error('Excluded title read'); });
        Object.defineProperty(f.files[1], 'stat', { get: deniedStat });
        Object.defineProperty(f.files[1], 'basename', { get: deniedTitle });
        const result = await tools.find((entry) => entry.name === name)!.invoke(f.context, 'allowed.md');
        expect(result.ok).toBe(true);
        expect(deniedStat).not.toHaveBeenCalled();
        expect(deniedTitle).not.toHaveBeenCalled();
    });

    it('reads only allowed-source backlink facts, without touching excluded graph values', async () => {
        const f = setup();
        const deniedLinks = jest.fn(() => ({ 'allowed.md': 1 }));
        Object.defineProperty(f.metadata.resolvedLinks, 'denied.md', { enumerable: true, get: deniedLinks });
        f.metadata.resolvedLinks['allowed.md'] = {};
        f.allowed.add('reference.md');
        f.metadata.resolvedLinks['reference.md'] = { 'allowed.md': 1 };
        const result = await createInspectObsidianNoteTool().execute({ path: 'allowed.md' }, f.context);
        expect(result.ok).toBe(true);
        expect(deniedLinks).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain('denied.md');
        expect(JSON.stringify(result)).toContain('reference.md');
    });

    it('rejects the actual active note after a switch, before reading its editor', async () => {
        const f = setup();
        expect(f.context.taskSourceReadGuard!.isPathAllowed(f.view.file.path)).toBe(true);
        f.view.file = f.files[1];
        const result = await createCurrentNoteContextTool().execute({ mode: 'selection-or-nearby' }, f.context);
        expect(result.ok).toBe(false);
        for (const spy of Object.values(f.editor)) expect(spy).not.toHaveBeenCalled();
    });

    it('does not read the next metadata entry after synchronous revocation inside the first read', async () => {
        const f = setup();
        f.allowed.add('denied.md');
        f.cache.mockImplementationOnce(() => { f.revoke(); return { tags: [], headings: [] }; });
        await expect(createListVaultTagsTool().execute({ limit: 10 }, f.context)).rejects.toThrow('no longer current');
        expect(f.cache).toHaveBeenCalledTimes(1);
    });

    it('stops further editor reads if the source is revoked by the first editor read', async () => {
        const f = setup();
        f.editor.getValue.mockImplementationOnce(() => { f.revoke(); return 'Old editor body'; });
        await expect(createCurrentNoteContextTool().execute({ mode: 'full' }, f.context)).rejects.toThrow('no longer current');
        expect(f.editor.getValue).toHaveBeenCalledTimes(1);
        expect(f.editor.getLine).not.toHaveBeenCalled();
        expect(f.editor.lineCount).not.toHaveBeenCalled();
    });

    it('keeps the legacy unguarded reader behavior', async () => {
        const f = setup();
        const { taskSourceReadGuard: _guard, ...context } = f.context;
        const result = await createSearchVaultMetadataTool().execute({ query: 'needle', limit: 10 }, context);
        expect(result.content?.matches.map((entry) => entry.path)).toEqual(['allowed.md', 'denied.md']);
        expect(f.cache).toHaveBeenCalledTimes(2);
    });
});

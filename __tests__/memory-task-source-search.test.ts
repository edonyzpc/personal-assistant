import { RunnableLambda } from '@langchain/core/runnables';
import { MemorySearchTool } from '../src/ai-services/memory-search-tool';
import { MemoryEvidenceRegistry } from '../src/ai-services/pa-agent-host-tools';
import { createHeadingAwareMarkdownChunks } from '../src/vss/markdown-chunker';
import type { TaskSourceReadGuard } from '../src/ai-services/task-source-read-guard';
import type { MemorySearchResult } from '../src/ai-services/chat-types';

jest.mock('obsidian');

function setup() {
    let current = true;
    const path = 'a.md';
    const markdown = '# Plan\n\nLaunch on Monday.';
    const hash = `hash:${markdown}`;
    const chunks = createHeadingAwareMarkdownChunks({ path, markdown, contentHash: hash, created: 10, lastModified: 10 });
    const raw = chunks.map(chunk => ({ score: 0.9, doc: { pageContent: chunk.content,
        metadata: { ...chunk.metadata, path, chunkIndex: chunk.chunkIndex, contentHash: hash, indexVersion: 'heading-aware-v2' } } }));
    const guard: TaskSourceReadGuard = { isCurrent: () => current, isPathAllowed: candidate => candidate === path,
        getNoteSearchScope: () => ({ allowedPaths: [path], excludedPaths: [] }) };
    const readLatest = jest.fn(async (requested: string) => ({ path: requested, markdown, mtime: 10, size: markdown.length }));
    const searchHybrid = jest.fn(async (_query: string, _options?: unknown) => raw);
    const ensureReady = jest.fn(async () => ({ decision: 'use-memory' as const }));
    const generations = jest.fn(async (paths: string[]) => ({ sourceEpoch: 'source-1', paths: paths.map(p => ({
        path: p, current: true, reason: 'current', generation: `generation:${p}`,
    })) }));
    const host = { settings: { policyModelName: '', chatModelName: 'test', retrievalOptimizationFlags: { strictReranker: true } },
        memorySearch: { searchHybrid, ensureReadyForChat: ensureReady, getPathEvidenceGenerations: generations,
            getChunksByPath: jest.fn(async () => []), rankGraphCandidates: jest.fn(async () => []), cancelGraphCandidateRank: jest.fn() },
        readLatestMemorySource: readLatest, getMemoryEvidenceEpoch: () => 'boundary-1', isDataBoundaryAllowedPath: () => true };
    const invoke = jest.fn(async () => ({ content: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}' }));
    const createChatModel = jest.fn(async (_temperature: number, _options?: unknown) => RunnableLambda.from(invoke));
    const tool = new MemorySearchTool(host as never, { createChatModel,
        cleanMarkdownContent: (text: string) => text, hashContent: async (text: string) => `hash:${text}` } as never);
    return { tool, guard, invoke, createChatModel, readLatest, searchHybrid, ensureReady, generations, revoke: () => { current = false; } };
}

describe('B-135 scoped Memory search and later projection', () => {
    it('passes the host scope into hybrid retrieval and returns only current scoped evidence', async () => {
        const h = setup();
        const result = await h.tool.search('launch', undefined, undefined, h.guard);
        expect(h.searchHybrid).toHaveBeenCalledWith('launch', expect.objectContaining({ noteScope: { allowedPaths: ['a.md'], excludedPaths: [] } }));
        expect(h.ensureReady).toHaveBeenCalledWith('launch', undefined, undefined, { existingOnly: true });
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].content).toContain('Launch on Monday');
        expect(h.invoke).toHaveBeenCalledTimes(1);
        expect(h.readLatest.mock.calls.every(([path]) => path === 'a.md')).toBe(true);
        const projected = await h.tool.revalidateForProvider(result, undefined, null, undefined, h.guard);
        expect(projected.documents).toHaveLength(1);
        expect(JSON.stringify(projected)).not.toContain('getNoteSearchScope');
    });

    it('rejects a guard without a query scope before readiness, retrieval or provider work', async () => {
        const h = setup();
        const guard = { isCurrent: h.guard.isCurrent, isPathAllowed: h.guard.isPathAllowed };
        await expect(h.tool.search('launch', undefined, undefined, guard)).rejects.toThrow('search scope is unavailable');
        for (const spy of [h.ensureReady, h.searchHybrid, h.readLatest, h.createChatModel]) expect(spy).not.toHaveBeenCalled();
    });

    it('does not dispatch reranking after a model-construction await revokes the scope', async () => {
        const h = setup();
        h.createChatModel.mockImplementationOnce(async () => { h.revoke(); return RunnableLambda.from(h.invoke); });
        await expect(h.tool.search('launch', undefined, undefined, h.guard)).rejects.toThrow('no longer current');
        expect(h.createChatModel).toHaveBeenCalledTimes(1);
        expect(h.invoke).not.toHaveBeenCalled();
    });

    it('disposes in-flight scoped searches with their parent and refuses later scoped work', async () => {
        const h = setup();
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        h.createChatModel.mockImplementationOnce(async () => {
            entered();
            await new Promise<void>(resolve => { release = resolve; });
            return RunnableLambda.from(h.invoke);
        });
        const pending = h.tool.search('launch', undefined, undefined, h.guard);
        await started;
        h.tool.dispose();
        release();
        await expect(pending).rejects.toThrow('no longer current');
        expect(h.invoke).not.toHaveBeenCalled();
        await expect(h.tool.search('later', undefined, undefined, h.guard)).rejects.toThrow('disposed');
        expect(h.searchHybrid).toHaveBeenCalledTimes(1);
    });

    it('rechecks at the physical provider callback and before later source projection', async () => {
        const h = setup();
        const result = await h.tool.search('launch', undefined, undefined, h.guard);
        const options = h.createChatModel.mock.calls[0][1] as { onProviderRequestStart: () => void };
        h.revoke();
        expect(() => options.onProviderRequestStart()).toThrow('no longer current');
        h.readLatest.mockClear(); h.generations.mockClear();
        await expect(h.tool.revalidateForProvider(result, undefined, null, undefined, h.guard)).rejects.toThrow('no longer current');
        expect(h.readLatest).not.toHaveBeenCalled();
        expect(h.generations).not.toHaveBeenCalled();
    });

    it('retains each capture guard outside transcripts and rejects expired evidence before revalidation', async () => {
        const h = setup();
        const result = await h.tool.search('launch', undefined, undefined, h.guard);
        const revalidate = jest.fn(async (memory: MemorySearchResult, _signal?: AbortSignal, _temporal?: unknown, guard?: TaskSourceReadGuard) => {
            expect(guard).toBe(h.guard);
            return memory;
        });
        const registry = new MemoryEvidenceRegistry(revalidate);
        registry.capture({ type: 'toolCall', id: 'search', index: 0, name: 'search_memory', input: { query: 'launch' } },
            { ok: true, tool: 'search_memory', inputSummary: 'launch', content: result, sources: result.sources }, 'turn', null, h.guard);
        const message = { role: 'toolResult' as const, id: 'result', toolCallId: 'search', toolName: 'search_memory',
            content: { promptText: 'evidence', includeInNextPrompt: true }, isError: false, timestamp: 1 };
        await registry.prepareTranscript([message]);
        expect(revalidate).toHaveBeenCalledTimes(1);
        h.revoke();
        const transcript = await registry.prepareTranscript([message]);
        expect(revalidate).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(transcript)).not.toContain('Launch on Monday');
        expect(JSON.stringify(transcript)).not.toContain('getNoteSearchScope');
    });
});

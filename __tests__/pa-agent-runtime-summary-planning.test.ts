import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { AIMessageChunk } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import { PaAgentRuntime } from '../src/ai-services/pa-agent-runtime';
import { SkillContextProvider } from '../src/ai-services/skill-context-provider';
import type { PaAgentContextSummarizer } from '../src/ai-services/context/PaAgentContextSummarizer';
import type { PaAgentToolSummarySource } from '../src/ai-services/context/PaAgentContextSummaryTypes';

jest.mock('obsidian');
afterEach(() => { jest.restoreAllMocks(); });

async function runSummaryPlanning(mode: 'history' | 'tool' | 'after-recovery' | 'no-benefit' | 'failed') {
    let executed = 0;
    let modelTurns = 0;
    let requestRecovery = true;
    const attempted: string[] = [];
    const results: PaAgentToolSummarySource[] = [];
    const providerInputs: string[] = [];
    const toolCount = mode === 'after-recovery' ? 6 : 5;
    const sustainedPressure = mode === 'no-benefit' || mode === 'failed';
    const prepareHistory = jest.fn<PaAgentContextSummarizer['prepareHistory']>(async input =>
        mode === 'history' && executed >= 5
            ? { sourceMessages: input.history.slice(0, 2), text: 'Earlier request: retain the public evidence.' }
            : undefined);
    const prepareTool = jest.fn<PaAgentContextSummarizer['prepareTool']>(async input => {
        attempted.push(input.source.id);
        if (mode === 'failed') throw new Error('Optional summary failed');
        return mode === 'tool' || mode === 'after-recovery'
            ? { source: input.source, text: 'Public observation retained.' } : undefined;
    });
    const skills = new SkillContextProvider(Array.from({ length: toolCount }, (_, index) => ({
        path: `public-${index}/SKILL.md`,
        content: `---\nname: public-${index}\ndescription: Use when reviewing public synthetic method ${index}.\n---\n`
            + Array.from({ length: mode !== 'history' && (index === 0 || index === 5) ? 800 : 12 },
                (_, item) => `Public method ${index}, instruction ${item}.`).join('\n'),
    })));
    const bound = RunnableLambda.from(async function* (input: unknown) {
        providerInputs.push(String(input));
        // Three observations are already old enough to summarize. The tool-only
        // fixture's large first observation can satisfy the 70% target alone.
        if (!sustainedPressure && modelTurns === 5 && requestRecovery) {
            requestRecovery = false;
            throw Object.assign(new Error('context length exceeded'), { code: 'context_length_exceeded' });
        }
        const index = modelTurns++;
        if (index < toolCount) {
            yield new AIMessageChunk({ content: '', tool_call_chunks: [{ id: `public-call-${index}`,
                index: 0, name: 'load_skill', args: JSON.stringify({ name: `public-${index}` }) }] });
        } else {
            yield new AIMessageChunk({ content: 'The public evidence has been reviewed.' });
        }
        yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: index < toolCount ? 'tool_calls' : 'stop' } });
    });
    const host = {
        settings: { aiProvider: 'openai', baseURL: 'https://summary-planning.invalid/v1',
            chatModelName: 'summary-planning-fixture', policyModelName: '', embeddingModelName: 'fixture',
            webSearchEnabled: false, memoryEnabled: false, skillContextEnabled: false, enabledSkillIds: [],
            licenseTier: 'paid', statisticsVaultId: 'public-fixture', retrievalOptimizationFlags: {} },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
            metadataCache: { getFileCache: () => null } },
        memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }), searchHybrid: async () => [] },
        getAPIToken: async () => 'synthetic-token', log: () => undefined,
        isOperationsAgentEnabled: false, getMemoryExtractionPromptContext: () => undefined,
    } as unknown as AiServiceHost;
    const runtime = new PaAgentRuntime(host, { createChatModel: async () => ({ bindTools: () => bound }) } as never, {
        skillContextProvider: skills, maxModelTurns: 8,
        contextSummarizer: { prepareHistory, prepareTool } as unknown as PaAgentContextSummarizer,
    });
    try {
        await runtime.streamTurn({ prompt: sustainedPressure
            ? `Review the public observations.\n${'Current public input. '.repeat(6000)}`
            : 'Review the public observations.', memoryMode: 'skip-memory',
            onLifecycleEvent: event => {
                if (event.type === 'message_end' && event.message.role === 'toolResult') {
                    results.push(event.message);
                    if (!event.message.isError) executed++;
                }
            },
            ...(mode === 'history' ? { chatHistory: [
                { role: 'user' as const, content: Array.from({ length: 150 }, (_, index) => `Earlier public request ${index}.`).join('\n') },
                { role: 'assistant' as const, content: Array.from({ length: 1500 }, (_, index) => `Earlier public observation ${index}.`).join('\n') },
                { role: 'user' as const, content: 'Latest correction remains exact.' },
                { role: 'assistant' as const, content: 'Acknowledged.' },
            ] } : {}),
        });
    } finally { runtime.dispose(); }
    expect(results.filter(result => result.isError).map(result => result.content.promptText)).toEqual([]);
    return { executed, modelTurns, attempted, prepareHistory, prepareTool, providerInputs };
}

describe('runtime optional summary planning', () => {
    it('remeasures after history summary and skips otherwise eligible tool observations when pressure is resolved', async () => {
        const result = await runSummaryPlanning('history');
        expect(result.executed).toBe(5);
        expect(result.prepareHistory).toHaveBeenCalledTimes(1);
        expect(result.prepareTool).not.toHaveBeenCalled();
        expect(await result.prepareHistory.mock.results.at(-1)!.value).toBeDefined();
    });

    it('stops after the first successful tool summary resolves pressure', async () => {
        const result = await runSummaryPlanning('tool');
        expect(result.executed).toBe(5);
        expect(result.prepareTool).toHaveBeenCalledTimes(1);
        const source = result.prepareTool.mock.calls[0][0].source as PaAgentToolSummarySource;
        expect(source.content.metadata?.retrySafety).toBe('read_only');
    });

    it('clears the recovery target after a successful tool response instead of applying it to later ordinary turns', async () => {
        const result = await runSummaryPlanning('after-recovery');
        expect(result.executed).toBe(6);
        expect(result.prepareTool).toHaveBeenCalledTimes(1);
        expect(result.providerInputs.at(-1)).toContain('Public method 5, instruction 799.');
        expect(result.providerInputs.at(-1)!.length).toBeGreaterThan(result.providerInputs[5].length * 0.7);
    });

    it.each(['no-benefit', 'failed'] as const)('does not repeat an unchanged %s source on later pressured turns', async mode => {
        const result = await runSummaryPlanning(mode);
        expect(result.executed).toBe(5);
        expect(result.attempted).toHaveLength(3);
        expect(new Set(result.attempted).size).toBe(3);
    });
});

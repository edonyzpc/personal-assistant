import { AIMessageChunk } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIUtils } from '../src/ai-services/ai-utils';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import type { LegacyAgentEvent } from '../src/ai-services/chat-types';
import { PaAgentRuntime } from '../src/ai-services/pa-agent-runtime';
import { WritingVersionService } from '../src/chat/writing-versions';
import { cloneWritingVersion, type WritingVersion } from '../src/chat/writing-types';

jest.mock('obsidian');
afterEach(() => jest.restoreAllMocks());

async function runWithBudget(observationBudget: number, reduceAfterPreparation = false) {
    const versionsById = new Map<string, WritingVersion>();
    const versions = new WritingVersionService({
        getWritingVersion: async id => versionsById.get(id) ?? null,
        putWritingVersion: async version => { versionsById.set(version.id, cloneWritingVersion(version)); },
        listWritingVersions: async () => [...versionsById.values()],
    });
    const parentText = `PARENT_START ${'complete parent material '.repeat(160)} PARENT_END`;
    const parent = await versions.create({ requestId: 'parent-request', conversationId: 'conversation',
        messageId: 'parent-message', turnIndex: 1, text: parentText, images: [] });
    const host = {
        settings: { debug: false, aiProvider: 'openai', baseURL: 'https://writing.invalid/v1', chatModelName: 'fixture',
            policyModelName: '', skillContextEnabled: false, enabledSkillIds: [], webSearchEnabled: false,
            memoryEnabled: false, licenseTier: 'free', statisticsVaultId: 'fixture',
            retrievalOptimizationFlags: { lexicalProfile: false, strictReranker: false, graphPpr: false, relaxedRecovery: false } },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null, cachedRead: async () => '' },
            metadataCache: { getFileCache: () => null } },
        memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }), searchHybrid: async () => [], getChunksByPath: async () => [] },
        getAPIToken: async () => 'fixture', log: jest.fn(), isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: () => undefined,
    } as unknown as AiServiceHost;
    const ai = new AIUtils(host);
    const events: LegacyAgentEvent[] = [];
    const physicalAnswerInputs: string[] = [];
    jest.spyOn(ai, 'createChatModel').mockImplementation(async (temperature, options) => {
        const model = RunnableLambda.from(async function* (input: unknown) {
            options?.onProviderRequestStart?.();
            if (temperature === 0) {
                yield new AIMessageChunk({ content: 'A shorter summary of the parent.' });
                return;
            }
            const text = String(input);
            physicalAnswerInputs.push(text);
            if (physicalAnswerInputs.length === 1) {
                const parentHandle = text.match(/"handle":"([^"]+:parent:1)"/)?.[1];
                yield new AIMessageChunk({ content: '', tool_call_chunks: [{ id: 'prepare', index: 0,
                    name: 'get_writing_context', args: JSON.stringify({ parentHandle, scene: null,
                        currentInstructionConflicts: false, imageRefs: [] }) }] });
            } else {
                const handle = text.match(/"contextHandle":\s*"([^"]+:writing:\d+)"/)?.[1] ?? 'invented';
                yield new AIMessageChunk({ content: '', tool_call_chunks: [{ id: 'output', index: 0,
                    name: 'present_writing', args: JSON.stringify({ contextHandle: handle, body: 'Finished version', explanation: '' }) }] });
            }
            yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'tool_calls' } });
        });
        Object.assign(model, { bindTools: () => model });
        return model as unknown as Awaited<ReturnType<AIUtils['createChatModel']>>;
    });
    const runtimeOptions = { skillContextProvider: null, answerStreamMaxObservationChars: observationBudget };
    const runtime = new PaAgentRuntime(host, ai, runtimeOptions);
    let error: unknown;
    try {
        await runtime.streamTurn({ prompt: 'Revise the offered parent.', memoryMode: 'auto',
            writingRequest: { requestId: 'budget-request' }, writingOutputProtocol: 'native',
            writingContextHost: { conversationId: 'conversation', candidates: [parent], versions,
                styles: { prepare: async () => {
                    if (reduceAfterPreparation) runtimeOptions.answerStreamMaxObservationChars = 600;
                    return { context: '', revisionIds: [], isCurrent: () => true };
                } },
                isCurrent: () => true, isParentCurrent: version => JSON.stringify(versionsById.get(version.id)) === JSON.stringify(version) },
            onEvent: event => events.push(event) });
    } catch (caught) { error = caught; }
    finally { runtime.dispose(); versions.dispose(); }
    return { events, physicalAnswerInputs, error, parentText };
}

describe('writing context physical input budget', () => {
    it('never dispatches an answer with a partial parent context or creates a version from it', async () => {
        const result = await runWithBudget(600);
        expect(result.physicalAnswerInputs.slice(1).some(input => input.includes('PARENT_START'))).toBe(false);
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
    });

    it('delivers a complete admitted context and preserves request identity and metadata', async () => {
        const result = await runWithBudget(16_000);
        expect(result.error).toBeUndefined();
        expect(result.physicalAnswerInputs).toHaveLength(2);
        expect(result.physicalAnswerInputs[1]).toContain(result.parentText);
        expect(result.events.filter(event => event.kind === 'writing-artifact')).toEqual([
            expect.objectContaining({ requestId: 'budget-request', body: 'Finished version',
                associatedImages: [], styleRevisionIds: [] }),
        ]);
    });

    it('rejects a previously admitted context if final projection shortens it before dispatch', async () => {
        const result = await runWithBudget(16_000, true);
        expect(result.physicalAnswerInputs).toHaveLength(1);
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
        expect(String(result.error)).toContain('Complete writing context does not fit');
    });
});

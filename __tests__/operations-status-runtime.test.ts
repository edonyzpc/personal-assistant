import { AIMessageChunk } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIUtils } from '../src/ai-services/ai-utils';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import type { AgentEvent } from '../src/ai-services/chat-types';
import { PaAgentRuntime } from '../src/ai-services/pa-agent-runtime';
import type {
    OperationsStatusHost,
    OperationsStatusObservation,
} from '../src/ai-services/operations-status-tool';
import { isOperationsStatusObservation } from '../src/ai-services/operations-status-tool';

jest.mock('obsidian');
afterEach(() => jest.restoreAllMocks());

it('admits the finite blocked observation without leaking conflict paths or Undo ability', () => {
    const observation = { intentId: 'blocked-intent', available: true, state: 'blocked',
        blockedReason: 'shared_reference', undoAvailable: false };
    expect(isOperationsStatusObservation(observation)).toBe(true);
    expect(isOperationsStatusObservation({ ...observation, undoAvailable: true })).toBe(false);
    expect(isOperationsStatusObservation({ ...observation, state: 'completed' })).toBe(false);
    expect(isOperationsStatusObservation({ ...observation, blockedReason: undefined })).toBe(false);
    expect(isOperationsStatusObservation({ ...observation, effects: [{ key: 'note', status: 'applied' }] })).toBe(false);
    expect(isOperationsStatusObservation({ ...observation, conflicts: [{ sourcePath: 'private.md' }] })).toBe(false);
});

it('registers and freshly reads a finite Operations status observation across requests', async () => {
    const host = {
        settings: { debug: false, aiProvider: 'openai', baseURL: 'https://operations-status.invalid/v1',
            chatModelName: 'fixture', policyModelName: '', skillContextEnabled: false, enabledSkillIds: [],
            webSearchEnabled: false, memoryEnabled: false, licenseTier: 'free', statisticsVaultId: 'fixture',
            retrievalOptimizationFlags: { lexicalProfile: false, strictReranker: false,
                graphPpr: false, relaxedRecovery: false } },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null, cachedRead: async () => '' },
            metadataCache: { getFileCache: () => null } },
        memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }),
            searchHybrid: async () => [], getChunksByPath: async () => [] },
        getAPIToken: async () => 'fixture', log: jest.fn(), isOperationsAgentEnabled: false,
        isDataBoundaryAllowedPath: () => true,
        getMemoryExtractionPromptContext: () => undefined,
    } as unknown as AiServiceHost;
    const observations: OperationsStatusObservation[] = [
        { intentId: 'intent_previous', available: true, state: 'partial',
            effects: [{ key: 'note', status: 'applied' }, { key: 'attachment', status: 'unknown' }],
            undoAvailable: true },
        { intentId: 'intent_previous', available: true, state: 'partial',
            effects: [{ key: 'note', status: 'applied' }, { key: 'attachment', status: 'restored' }],
            undoAvailable: true },
    ];
    let readCount = 0;
    const readMock = jest.fn<ReturnType<OperationsStatusHost['read']>, Parameters<OperationsStatusHost['read']>>(async () => {
        const observation = observations[Math.min(readCount, observations.length - 1)];
        readCount += 1;
        return observation;
    });
    const read: OperationsStatusHost['read'] = readMock;
    const ai = new AIUtils(host);
    const inputs: Array<Array<{ role: string; content: string }>> = [];
    const schemas: Array<Array<{ function: { name: string } }>> = [];
    const lifecycle: AgentEvent[] = [];
    jest.spyOn(ai, 'createChatModel').mockImplementation((_temperature, options) => {
        const model = RunnableLambda.from(async function* (input: unknown) {
            options?.onProviderRequestStart?.();
            inputs.push((input as { toChatMessages(): Array<{ getType(): string; content: unknown }> })
                .toChatMessages().map(message => ({ role: message.getType(), content: String(message.content) })));
            if (inputs.length % 2 === 1) {
                yield new AIMessageChunk({ content: '', tool_call_chunks: [{ id: 'status-query', index: 0,
                    name: 'get_operations_status', args: JSON.stringify({ intentId: 'intent_previous' }) }] });
                yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'tool_calls' } });
            } else {
                yield new AIMessageChunk({ content: 'The note changed and the image recovery checkpoint remains.' });
                yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'stop' } });
            }
        });
        Object.assign(model, { bindTools: (bound: typeof schemas[number]) => { schemas.push(bound); return model; } });
        return Promise.resolve(model as unknown as Awaited<ReturnType<AIUtils['createChatModel']>>);
    });
    const runtime = new PaAgentRuntime(host, ai, { skillContextProvider: null, maxModelTurns: 3 });
    const options = {
        conversationId: 'conversation',
        memoryMode: 'auto' as const,
        isCurrent: () => true,
        operationsStatus: { conversationId: 'conversation', read },
        runSourceSelection: { schemaVersion: 1 as const, scope: 'notes' as const,
            selectionId: 'status-selection', userMessageId: 'current-status-user' },
        onEvent: () => {},
        onLifecycleEvent: (event: AgentEvent) => lifecycle.push(event),
    };
    try {
        await runtime.streamTurn({ ...options, prompt: 'Check the prior operation.' });
        await runtime.streamTurn({ ...options, prompt: 'Check it again now.' });
    } finally {
        runtime.dispose();
    }
    expect(schemas[0].some(schema => schema.function.name === 'get_operations_status')).toBe(true);
    expect(readMock).toHaveBeenCalledTimes(2);
    expect(readMock.mock.calls[0]?.[0]).toEqual({ intentId: 'intent_previous' });
    expect(readMock.mock.calls.at(-1)?.[0]).toEqual({ intentId: 'intent_previous' });
    const modelResult = inputs.find(message => message.some(item => item.content.includes('intent_previous')));
    expect(modelResult?.some(item => item.content.includes('restored')))
        .toBe(true);
    const resultEvent = lifecycle.find(event => event.type === 'message_end'
        && event.message.role === 'toolResult' && event.message.toolName === 'get_operations_status');
    expect(resultEvent?.type === 'message_end' ? resultEvent.message.inputLineage : undefined).toEqual({
        schemaVersion: 1,
        completeness: 'complete',
        dependencies: [{ kind: 'user-text', messageId: 'current-status-user' }],
    });
});

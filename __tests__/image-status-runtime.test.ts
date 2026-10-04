import { AIMessageChunk } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIUtils } from '../src/ai-services/ai-utils';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import type { AgentEvent } from '../src/ai-services/chat-types';
import { PaAgentRuntime } from '../src/ai-services/pa-agent-runtime';
import type { ImageStatusHost, ImageStatusObservation } from '../src/ai-services/image-status-tool';

jest.mock('obsidian');
afterEach(() => jest.restoreAllMocks());

it('delivers a finite image status observation to ordinary Chat without a create-image binding', async () => {
    const host = {
        settings: { debug: false, aiProvider: 'openai', baseURL: 'https://image-status.invalid/v1',
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
    const observation: ImageStatusObservation = { status: 'available', taskId: 'task_previous',
        operationId: 'operation_previous', localState: 'submission_unknown', revision: 7,
        updatedAt: '2026-10-04T00:00:00.000Z', basis: 'local_snapshot', remoteQueryAvailable: false,
        remoteQueryReason: 'no_provider_task', nextAction: 'needs_user' };
    const read = jest.fn<ReturnType<ImageStatusHost['read']>, Parameters<ImageStatusHost['read']>>(async () => observation);
    const ai = new AIUtils(host);
    const inputs: Array<Array<{ role: string; content: string }>> = [];
    const schemas: Array<Array<{ function: { name: string } }>> = [];
    const lifecycle: AgentEvent[] = [];
    jest.spyOn(ai, 'createChatModel').mockImplementation(async (_temperature, options) => {
        const model = RunnableLambda.from(async function* (input: unknown) {
            options?.onProviderRequestStart?.();
            inputs.push((input as { toChatMessages(): Array<{ getType(): string; content: unknown }> })
                .toChatMessages().map(message => ({ role: message.getType(), content: String(message.content) })));
            if (inputs.length === 1) {
                yield new AIMessageChunk({ content: '', tool_call_chunks: [{ id: 'status-query', index: 0,
                    name: 'get_image_status', args: JSON.stringify({ operationId: 'operation_previous' }) }] });
                yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'tool_calls' } });
            } else {
                yield new AIMessageChunk({ content: 'The existing task is still unknown and has no remote task identity to check.' });
                yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'stop' } });
            }
        });
        Object.assign(model, { bindTools: (bound: typeof schemas[number]) => { schemas.push(bound); return model; } });
        return model as unknown as Awaited<ReturnType<AIUtils['createChatModel']>>;
    });
    const runtime = new PaAgentRuntime(host, ai, { skillContextProvider: null, maxModelTurns: 3 });
    try {
        await runtime.streamTurn({ prompt: 'Check the existing image operation_previous.', conversationId: 'conversation',
            memoryMode: 'auto', isCurrent: () => true,
            imageStatus: { conversationId: 'conversation', read },
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'status-selection',
                userMessageId: 'current-status-user' },
            onEvent: () => {}, onLifecycleEvent: event => lifecycle.push(event) });
    } finally { runtime.dispose(); }
    expect(schemas[0].some(schema => schema.function.name === 'get_image_status')).toBe(true);
    expect(schemas[0].some(schema => schema.function.name === 'create_image')).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toEqual({ operationId: 'operation_previous' });
    expect(inputs).toHaveLength(2);
    // The fixture uses the compatibility transport, which wraps tool data in
    // an untrusted action-history envelope instead of a native ToolMessage.
    const modelResult = inputs[1].find(message => message.content.includes('source="tool:get_image_status"'));
    const serializedObservation = modelResult?.content.match(/<untrusted source="tool:get_image_status">\n([\s\S]*?)\n<\/untrusted>/)?.[1];
    expect(JSON.parse(serializedObservation ?? '{}').observation).toEqual(observation);
    const resultEvent = lifecycle.find(event => event.type === 'message_end'
        && event.message.role === 'toolResult' && event.message.toolName === 'get_image_status');
    expect(resultEvent?.type === 'message_end' ? resultEvent.message.inputLineage : undefined).toEqual({
        schemaVersion: 1, completeness: 'complete', dependencies: [{ kind: 'user-text', messageId: 'current-status-user' }],
    });
    expect(lifecycle.some(event => event.type === 'agent_end' && event.status === 'completed')).toBe(true);
});

import { AIUtils } from '../src/ai-services/ai-utils';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import type { AgentEvent } from '../src/ai-services/chat-types';
import { paAgentCreateImageCommandDefinition } from '../src/ai-services/pa-agent-command';
import { PaAgentRuntime } from '../src/ai-services/pa-agent-runtime';
import type { ImageAssetService } from '../src/chat/image-assets';
import type { MessageImage } from '../src/chat/image-types';

jest.mock('obsidian');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; jest.restoreAllMocks(); });

type RequestBody = { stream?: boolean; messages: Array<{ role: string; content: unknown }> };
type Reply = 'overflow' | 'create_image' | 'answer';
const endpoint = 'https://runtime-overflow.invalid/v1';
const image: MessageImage = { ref: { assetId: 'public-fixture-image', contentHash: '1'.repeat(64) },
    ordinal: 1, label: 'Public fixture image' };

async function runFixture(replies: Reply[], withImage = false, createImage = false) {
    const requests: RequestBody[] = [];
    const lifecycle: AgentEvent[] = [];
    const phases: string[] = [];
    const submit = jest.fn(async () => ({ taskId: 'accepted-before-overflow' }));
    const host = {
        settings: { debug: true, aiProvider: 'openai', baseURL: endpoint, chatModelName: 'fixture-model',
            policyModelName: '', skillContextEnabled: false, enabledSkillIds: [], webSearchEnabled: false,
            memoryEnabled: false, licenseTier: 'paid', statisticsVaultId: 'overflow-fixture',
            retrievalOptimizationFlags: {} },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null, cachedRead: async () => '' },
            metadataCache: { getFileCache: () => null } },
        memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }),
            searchHybrid: async () => [], getChunksByPath: async () => [] },
        getAPIToken: async () => 'synthetic-fixture-token', isOperationsAgentEnabled: false,
        log: (_message: string, fields?: Record<string, unknown>) => {
            if (typeof fields?.phase === 'string') phases.push(fields.phase);
        },
        isDataBoundaryAllowedPath: () => true, getMemoryExtractionPromptContext: () => undefined,
    } as unknown as AiServiceHost;
    globalThis.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url) !== `${endpoint}/chat/completions`) throw new Error('Unexpected offline fixture URL');
        const body = JSON.parse(String(init?.body)) as RequestBody;
        const reply = replies[requests.length];
        requests.push(body);
        if (!reply) throw new Error('Unexpected extra provider request');
        if (reply === 'overflow') return new Response(JSON.stringify({ error: {
            code: 'context_length_exceeded', message: 'Request rejected; echoed data:image/jpeg;base64,PRIVATE_ECHO',
        } }), { status: 400, headers: { 'content-type': 'application/json' } });
        const tool = reply === 'create_image';
        const delta = tool ? { role: 'assistant', content: '', tool_calls: [{ index: 0, id: 'create-once',
            type: 'function', function: { name: 'create_image', arguments: JSON.stringify({ prompt: 'A red crane',
                operation: 'generate', count: 1, totalCount: 1, referenceImageRefs: [] }) } }] }
            : { role: 'assistant', content: 'The task is complete.' };
        const frame = (value: unknown, finishReason: string | null = null) => `data: ${JSON.stringify({
            id: 'overflow-fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture-model',
            choices: [{ index: 0, delta: value, finish_reason: finishReason }],
        })}\n\n`;
        // A non-stream request is still answered so an accidental invoke fallback
        // fails an assertion promptly instead of depending on an SDK parser error.
        if (!body.stream) return new Response(JSON.stringify({ id: 'overflow-fixture', object: 'chat.completion',
            created: 0, model: 'fixture-model', choices: [{ index: 0, message: delta,
                finish_reason: tool ? 'tool_calls' : 'stop' }] }), { headers: { 'content-type': 'application/json' } });
        return new Response(frame(delta) + frame({}, tool ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const imageAssetService = {
        resolveVariant: jest.fn(async () => ({ blob: new Blob([new Uint8Array([255, 216, 255])]),
            mime: 'image/jpeg', width: 1, height: 1, persistent: true, release: jest.fn() })),
        verify: jest.fn(async () => ({ asset: {}, isCurrent: () => true })),
    } as unknown as ImageAssetService;
    const runtime = new PaAgentRuntime(host, new AIUtils(host), { skillContextProvider: null, maxModelTurns: 5 });
    try {
        await runtime.streamTurn({ prompt: createImage ? '@CreateImage Create one image.' : 'Describe the provided material.',
            memoryMode: 'skip-memory', conversationId: 'overflow-conversation', isCurrent: () => true,
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'overflow-selection',
                userMessageId: 'overflow-user' },
            ...(withImage ? { images: [image], imageAssetService } : {}),
            ...(createImage ? {
                commandInvocation: { definition: paAgentCreateImageCommandDefinition,
                    conversationId: 'overflow-conversation', stableMessageId: 'overflow-user',
                    activation: { kind: 'typed-token' as const, token: '@CreateImage' } },
                createImage: { conversationId: 'overflow-conversation', stableMessageId: 'overflow-user',
                    operationId: 'overflow-operation', submit },
            } : {}),
            onEvent: () => {}, onLifecycleEvent: event => lifecycle.push(event),
        });
    } finally { runtime.dispose(); }
    return { requests, lifecycle, phases, submit };
}

it('passes a real provider overflow to one Runtime recovery without invoking the unchanged input', async () => {
    const result = await runFixture(['overflow', 'answer']);
    expect(result.requests).toHaveLength(2);
    expect(result.requests.every(request => request.stream === true)).toBe(true);
    expect(result.phases.filter(phase => phase === 'context_overflow_recovery')).toHaveLength(1);
    expect(result.phases).not.toContain('llm_invoke_fallback');
    expect(result.lifecycle.at(-1)).toMatchObject({ type: 'agent_end', status: 'completed' });
});

it('recovers an image request without resubmitting a previously accepted effect', async () => {
    const result = await runFixture(['create_image', 'overflow', 'answer'], true, true);
    expect(result.requests).toHaveLength(3);
    expect(result.requests.every(request => request.stream === true)).toBe(true);
    expect(result.requests.every(request => JSON.stringify(request.messages).includes('image_url'))).toBe(true);
    expect(result.phases.filter(phase => phase === 'context_overflow_recovery')).toHaveLength(1);
    expect(result.phases).not.toContain('llm_invoke_fallback');
    expect(result.submit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.requests[2].messages)).toContain('accepted-before-overflow');
    const results = result.lifecycle.filter(event => event.type === 'message_end'
        && event.message.role === 'toolResult' && event.message.toolName === 'create_image');
    expect(results).toHaveLength(1);
    expect(result.lifecycle.at(-1)).toMatchObject({ type: 'agent_end', status: 'completed' });
    expect(JSON.stringify(result.lifecycle)).not.toContain('PRIVATE_ECHO');
});

it('ends an image request as incomplete after a second real overflow without exposing the SDK body', async () => {
    const result = await runFixture(['overflow', 'overflow'], true);
    expect(result.requests).toHaveLength(2);
    expect(result.requests.every(request => request.stream === true)).toBe(true);
    expect(result.phases.filter(phase => phase === 'context_overflow_recovery')).toHaveLength(1);
    expect(result.phases).not.toContain('llm_invoke_fallback');
    const turns = result.lifecycle.filter(event => event.type === 'turn_end');
    expect(turns).toHaveLength(2);
    for (const turn of turns) expect(turn.metadata?.diagnostics).toEqual([{ type: 'provider_context_overflow' }]);
    expect(result.lifecycle.at(-1)).toMatchObject({ type: 'agent_end', status: 'incomplete' });
    expect(JSON.stringify(result.lifecycle)).not.toContain('PRIVATE_ECHO');
});

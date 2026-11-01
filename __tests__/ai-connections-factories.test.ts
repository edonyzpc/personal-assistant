import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { requestUrl } from 'obsidian';
import { AIUtils } from '../src/ai-services/ai-utils';
import { createConnectionDefaults } from '../src/ai-services/provider-definitions';
import type { AIConnection, AIConnectionsSettings } from '../src/ai-services/ai-connection-types';

jest.mock('obsidian');

const originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
});

function fixture() {
    const openai: AIConnection = { ...createConnectionDefaults('openai'),
        id: 'openai', name: 'OpenAI', secretRef: 'pa-openai-offline', revision: 1 };
    const dashscope: AIConnection = { ...createConnectionDefaults('dashscope-cn'),
        id: 'dashscope', name: 'DashScope', secretRef: 'pa-dashscope-offline', revision: 1 };
    const configuration: AIConnectionsSettings = {
        schemaVersion: 1, migrationVersion: 1, connections: [openai, dashscope],
        defaultConnectionId: openai.id,
        bindings: { chat: { mode: 'inherit' }, embedding: { mode: 'connection', connectionId: dashscope.id },
            image: { mode: 'inherit' } },
        memorySelection: { revision: 'selection', cause: 'configuration-change' },
    };
    const revisions = new Map<string, number>();
    const host = {
        settings: { aiProvider: 'qwen', baseURL: 'https://legacy.invalid/v1',
            chatModelName: 'legacy-model', embeddingModelName: 'legacy-embedding', aiConnections: configuration },
        getAPIToken: jest.fn(async () => 'legacy-must-not-be-used'),
        getAIConnectionToken: jest.fn(async (id: string) => `${id}-offline-token`),
        getAIConnectionCredentialRevision: (id: string) => revisions.get(id) ?? 0,
        log: jest.fn(),
    };
    return { host, configuration, openai, dashscope, revisions, ai: new AIUtils(host) };
}

function mockChatFetch() {
    const fetcher = jest.fn<typeof fetch>(async (_url, _init) => new Response(JSON.stringify({ id: 'offline',
        object: 'response', created_at: 0, status: 'completed', model: 'gpt-6.1-terra',
        error: null, incomplete_details: null,
        output: [{ id: 'msg_offline', type: 'message', status: 'completed', role: 'assistant',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        output_text: 'ok',
    }), { headers: { 'content-type': 'application/json' } }));
    globalThis.fetch = fetcher as typeof fetch;
    return fetcher;
}

function mockProtocolFetch() {
    return jest.fn<typeof fetch>(async (url, _init) => {
        const endpoint = String(url);
        if (endpoint.endsWith('/responses')) {
            return new Response(JSON.stringify({ id: 'offline', object: 'response', created_at: 0,
                status: 'completed', model: 'offline', error: null, incomplete_details: null,
                output: [{ id: 'msg', type: 'message', status: 'completed', role: 'assistant',
                    content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, output_text: 'ok' }),
                { headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: 'offline', object: 'chat.completion', created: 0,
            model: 'offline', choices: [{ index: 0, finish_reason: 'stop',
                message: { role: 'assistant', content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
            { headers: { 'content-type': 'application/json' } });
    });
}

describe('B-192 connection-bound model factories', () => {
    it('sends chat and independent retrieval to their own endpoint, model and Key', async () => {
        const { ai, host } = fixture();
        const chatFetch = mockChatFetch();
        const embeddingRequest = jest.mocked(requestUrl);
        embeddingRequest.mockResolvedValue({ status: 200, headers: { 'content-type': 'application/json' },
            text: JSON.stringify({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
                model: 'text-embedding-v4', usage: { prompt_tokens: 1, total_tokens: 1 } }) } as never);
        await (await ai.createChatModel(0, { transport: 'native' })).invoke('offline chat');
        await (await ai.createEmbeddings()).embedQuery('offline query');
        expect(String(chatFetch.mock.calls[0][0])).toBe('https://api.openai.com/v1/responses');
        const init = chatFetch.mock.calls[0][1] as RequestInit;
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer openai-offline-token');
        expect(JSON.parse(String(init.body)).model).toBe('gpt-6.1-terra');
        const request = embeddingRequest.mock.calls[0][0];
        if (typeof request === 'string') throw new Error('Expected a provider request object');
        expect(request.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
        expect(request.headers?.Authorization ?? request.headers?.authorization).toBe('Bearer dashscope-offline-token');
        expect(JSON.parse(String(request.body))).toMatchObject({ model: 'text-embedding-v4', dimensions: 1024 });
        expect(host.getAPIToken).not.toHaveBeenCalled();
    });

    it('sends the OpenAI default large embedding and keeps an explicitly saved small model', async () => {
        const { ai, configuration, openai } = fixture();
        configuration.bindings.embedding = { mode: 'connection', connectionId: openai.id };
        const embeddingRequest = jest.mocked(requestUrl);
        embeddingRequest.mockResolvedValue({ status: 200, headers: { 'content-type': 'application/json' },
            text: JSON.stringify({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
                model: 'text-embedding-3-large', usage: { prompt_tokens: 1, total_tokens: 1 } }) } as never);
        await (await ai.createEmbeddings()).embedQuery('default query');
        openai.models.embedding = 'text-embedding-3-small';
        await (await ai.createEmbeddings()).embedQuery('saved query');
        const requests = embeddingRequest.mock.calls.map(([request]) => {
            if (typeof request === 'string') throw new Error('Expected a provider request object');
            return request;
        });
        expect(requests.map(request => request.url))
            .toEqual(['https://api.openai.com/v1/embeddings', 'https://api.openai.com/v1/embeddings']);
        expect(requests.map(request => JSON.parse(String(request.body)))).toEqual([
            { input: 'default query', model: 'text-embedding-3-large', dimensions: 1024,
                encoding_format: 'base64' },
            { input: 'saved query', model: 'text-embedding-3-small', dimensions: 1024,
                encoding_format: 'base64' },
        ]);
    });

    it('uses Responses for every OpenAI chat and policy model', async () => {
        const { ai, configuration, openai } = fixture();
        configuration.bindings.chat = { mode: 'connection', connectionId: openai.id };
        openai.models.chat = 'gpt-6.1-sol';
        const fetcher = mockProtocolFetch();
        globalThis.fetch = fetcher as typeof fetch;
        await (await ai.createChatModel(0.7, { transport: 'native' })).invoke('main');
        await (await ai.createChatModel(0, {
            transport: 'native', modelName: 'gpt-6-astra',
        })).invoke('policy');
        await (await ai.createChatModel(0.2, {
            transport: 'native', modelName: 'gpt-6.1-terra',
        })).invoke('default reasoning');

        expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
            'https://api.openai.com/v1/responses',
            'https://api.openai.com/v1/responses',
            'https://api.openai.com/v1/responses',
        ]);
        const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
        expect(bodies.map(body => body.model)).toEqual([
            'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra',
        ]);
        for (const body of bodies) {
            expect(body.store).toBe(false);
            expect(body).not.toHaveProperty('previous_response_id');
            expect(body).not.toHaveProperty('temperature');
            expect(body).not.toHaveProperty('top_p');
        }
        expect(bodies[2]).toMatchObject({ reasoning: { effort: 'high' } });
    });

    it('derives legacy protocol ownership from the endpoint, not the display provider', async () => {
        const { ai, host } = fixture();
        delete (host.settings as { aiConnections?: AIConnectionsSettings }).aiConnections;
        const fetcher = mockProtocolFetch();
        globalThis.fetch = fetcher as typeof fetch;

        host.settings.aiProvider = 'qwen';
        host.settings.baseURL = 'https://api.openai.com/v1';
        await (await ai.createChatModel(0, { transport: 'native' })).invoke('official endpoint');

        host.settings.aiProvider = 'openai';
        host.settings.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        host.settings.chatModelName = 'qwen3.6-plus';
        await (await ai.createChatModel(0, {
            transport: 'native', qwenRequestOptions: { enableThinking: true },
        })).invoke('DashScope endpoint');

        expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
            'https://api.openai.com/v1/responses',
            'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        ]);
        const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
        expect(bodies[0]).toMatchObject({ model: 'legacy-model', store: false });
        expect(bodies[0]).not.toHaveProperty('enable_thinking');
        expect(bodies[1]).toMatchObject({ model: 'qwen3.6-plus', enable_thinking: true });
    });

    it('keeps Custom on Chat Completions after config and tool derivation', async () => {
        const { ai, configuration } = fixture();
        const custom: AIConnection = { ...createConnectionDefaults('custom'),
            id: 'custom', name: 'Custom', secretRef: 'pa-custom-offline', revision: 1,
            endpoints: { chat: 'https://api.openai.com/v1' }, models: { chat: 'gpt-6.1-terra' } };
        configuration.connections.push(custom);
        configuration.bindings.chat = { mode: 'connection', connectionId: custom.id };
        const fetcher = mockProtocolFetch();
        globalThis.fetch = fetcher as typeof fetch;
        const base = await ai.createChatModel(0.6, { transport: 'native', maxTokens: 45 });
        const derived = base.bindTools([{
            type: 'function',
            function: {
                name: 'read_note',
                parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
        }]).withConfig({ stop: ['\n'] });
        await derived.invoke('custom model that would prefer Responses');

        expect(String(fetcher.mock.calls[0][0])).toBe('https://api.openai.com/v1/chat/completions');
        const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ model: 'gpt-6.1-terra', temperature: 0.6, max_completion_tokens: 45 });
        expect(body).not.toHaveProperty('store');
        expect(body).not.toHaveProperty('enable_thinking');
    });

    it('keeps DashScope SDK Chat Completions and its valid thinking parameter', async () => {
        const { ai, configuration, dashscope } = fixture();
        configuration.bindings.chat = { mode: 'connection', connectionId: dashscope.id };
        dashscope.models.chat = 'qwen3.6-plus';
        const fetcher = mockProtocolFetch();
        globalThis.fetch = fetcher as typeof fetch;
        await (await ai.createChatModel(0.4, {
            transport: 'native', qwenRequestOptions: { enableThinking: true },
        })).invoke('dashscope');

        expect(String(fetcher.mock.calls[0][0])).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
        expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
            model: 'qwen3.6-plus', temperature: 0.4, enable_thinking: true,
        });
    });

    it('keeps a pinned chat live across default changes and rename, but blocks an old Key before dispatch', async () => {
        const { ai, configuration, openai, revisions } = fixture();
        configuration.bindings.chat = { mode: 'connection', connectionId: openai.id };
        const fetcher = mockChatFetch();
        const model = await ai.createChatModel(0, { transport: 'native' });
        configuration.defaultConnectionId = 'dashscope';
        openai.name = 'Personal';
        openai.models.image = 'another-image-model';
        openai.options.embeddingDimensions = 768;
        openai.revision += 1;
        await model.invoke('still pinned');
        expect(fetcher).toHaveBeenCalledTimes(1);
        revisions.set(openai.id, 1);
        await expect(model.invoke('old credential')).rejects.toThrow('AI connection changed');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('blocks an inherited old model when its effective connection changes', async () => {
        const { ai, configuration } = fixture();
        const fetcher = mockChatFetch();
        const model = await ai.createChatModel(0, { transport: 'native' });
        configuration.defaultConnectionId = 'dashscope';
        await expect(model.invoke('stale default')).rejects.toThrow('AI connection changed');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('does not fall back to a legacy credential when a purpose is explicitly unconfigured', async () => {
        const { ai, host, configuration } = fixture();
        configuration.bindings.embedding = { mode: 'unconfigured' };
        await expect(ai.createEmbeddings()).rejects.toThrow();
        expect(host.getAIConnectionToken).not.toHaveBeenCalled();
        expect(host.getAPIToken).not.toHaveBeenCalled();
    });

    it('declares only the known OpenAI tool protocol on its exact endpoint', () => {
        const { ai, openai } = fixture();
        openai.models.chat = 'gpt-6.1-terra';
        expect(ai.getNativeToolCallingCapability({ internalGate: true }).supported).toBe(true);
        openai.endpoints.chat = 'https://unverified.invalid/v1';
        expect(ai.getNativeToolCallingCapability({ internalGate: true }).supported).toBe(false);
    });

    it('rejects corrupt persisted connection data instead of reviving the legacy provider', async () => {
        const { ai, host } = fixture();
        host.settings.aiConnections = null as unknown as AIConnectionsSettings;
        await expect(ai.createChatModel()).rejects.toThrow();
        expect(host.getAPIToken).not.toHaveBeenCalled();
        expect(host.getAIConnectionToken).not.toHaveBeenCalled();
    });

    it('blocks a model prepared in legacy mode once a saved connection replaces it', async () => {
        const { ai, host, configuration } = fixture();
        delete (host.settings as { aiConnections?: AIConnectionsSettings }).aiConnections;
        const fetcher = mockChatFetch();
        const legacyModel = await ai.createChatModel(0, { transport: 'native' });
        host.settings.aiConnections = configuration;
        await expect(legacyModel.invoke('old prepared model')).rejects.toThrow('AI connection changed');
        expect(fetcher).not.toHaveBeenCalled();
    });
});

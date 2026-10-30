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
        object: 'chat.completion', created: 0, model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { headers: { 'content-type': 'application/json' } }));
    globalThis.fetch = fetcher as typeof fetch;
    return fetcher;
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
        expect(String(chatFetch.mock.calls[0][0])).toBe('https://api.openai.com/v1/chat/completions');
        const init = chatFetch.mock.calls[0][1] as RequestInit;
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer openai-offline-token');
        expect(JSON.parse(String(init.body)).model).toBe('gpt-4o-mini');
        const request = embeddingRequest.mock.calls[0][0];
        if (typeof request === 'string') throw new Error('Expected a provider request object');
        expect(request.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
        expect(request.headers?.Authorization ?? request.headers?.authorization).toBe('Bearer dashscope-offline-token');
        expect(JSON.parse(String(request.body))).toMatchObject({ model: 'text-embedding-v4', dimensions: 1024 });
        expect(host.getAPIToken).not.toHaveBeenCalled();
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

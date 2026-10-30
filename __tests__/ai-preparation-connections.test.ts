import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { requestUrl, type RequestUrlResponse } from 'obsidian';
import type { AIConnection, AIConnectionsSettings } from '../src/ai-services/ai-connection-types';
import { createConnectionDefaults } from '../src/ai-services/provider-definitions';
import { prepareFeaturedImagePrompt } from '../src/ai-services/prepare-featured-image-prompt';
import { prepareGhostMetadata } from '../src/ai-services/ghost-metadata';

jest.mock('obsidian');

afterEach(() => { jest.resetAllMocks(); });

function fixture() {
    const openai: AIConnection = { ...createConnectionDefaults('openai'),
        id: 'chat-openai', name: 'Chat', secretRef: 'offline-openai', revision: 0 };
    const dashscope: AIConnection = { ...createConnectionDefaults('dashscope-cn'),
        id: 'default-dashscope', name: 'Default', secretRef: 'offline-dashscope', revision: 0 };
    const configuration: AIConnectionsSettings = {
        schemaVersion: 1, migrationVersion: 1, connections: [openai, dashscope],
        defaultConnectionId: dashscope.id,
        bindings: { chat: { mode: 'connection', connectionId: openai.id },
            embedding: { mode: 'inherit' }, image: { mode: 'inherit' } },
        memorySelection: { revision: 'original', cause: 'configuration-change' },
    };
    const revisions = new Map<string, number>();
    const host = {
        settings: { aiProvider: 'qwen', baseURL: 'https://legacy.invalid/v1',
            chatModelName: 'legacy-model', embeddingModelName: 'legacy-embedding', aiConnections: configuration },
        getSettings() { return this.settings; },
        getAPIToken: jest.fn(async () => 'legacy-must-not-be-used'),
        getAIConnectionToken: jest.fn(async (id: string) => `${id}-offline-token`),
        getAIConnectionCredentialRevision: (id: string) => revisions.get(id) ?? 0,
        log: jest.fn(),
    };
    return { host, openai, dashscope, revisions };
}

type Consumer = 'image' | 'ghost';

function invoke(consumer: Consumer, host: ReturnType<typeof fixture>['host']) {
    const guard = { signal: new AbortController().signal, isSourceCurrent: () => true };
    return consumer === 'image'
        ? prepareFeaturedImagePrompt(host, { ...guard, sourceText: 'Synthetic selected note', userRequest: 'Draw a blue circle' })
        : prepareGhostMetadata(host, { ...guard, title: 'Synthetic title', articleText: 'Synthetic article',
            needed: { customExcerpt: true, metaDescription: false, slug: false } });
}

function response(consumer: Consumer): RequestUrlResponse {
    const json = { id: 'offline', object: 'chat.completion', created: 0, model: 'gpt-4o-mini',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: consumer === 'image'
            ? 'Prepared blue circle' : JSON.stringify({ customExcerpt: 'Prepared excerpt' }) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return { status: 200, headers: { 'content-type': 'application/json' },
        text: JSON.stringify(json), json, arrayBuffer: new ArrayBuffer(0) };
}

describe.each<Consumer>(['image', 'ghost'])('%s preparation uses the actual connection factory', consumer => {
    it('sends the resolved Chat model and Key while retrieval/images inherit another service', async () => {
        const { host } = fixture();
        const transport = jest.mocked(requestUrl).mockResolvedValue(response(consumer));
        await expect(invoke(consumer, host)).resolves.toEqual(consumer === 'image'
            ? 'Prepared blue circle' : { customExcerpt: 'Prepared excerpt' });
        expect(transport).toHaveBeenCalledTimes(1);
        const request = transport.mock.calls[0][0];
        if (typeof request === 'string') throw new Error('Expected structured provider request');
        expect(request.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(request.headers?.Authorization ?? request.headers?.authorization).toBe('Bearer chat-openai-offline-token');
        expect(JSON.parse(String(request.body)).model).toBe('gpt-4o-mini');
        expect(host.getAPIToken).not.toHaveBeenCalled();
    });

    it('rejects a replaced Chat binding during credential acquisition before any HTTP request', async () => {
        const { host, dashscope } = fixture();
        const transport = jest.mocked(requestUrl).mockResolvedValue(response(consumer));
        host.getAIConnectionToken.mockImplementation(async id => {
            host.settings = { ...host.settings, aiConnections: { ...host.settings.aiConnections,
                bindings: { ...host.settings.aiConnections.bindings,
                    chat: { mode: 'connection', connectionId: dashscope.id } } } };
            return `${id}-offline-token`;
        });
        await expect(invoke(consumer, host)).rejects.toMatchObject({ code: 'connection_changed' });
        expect(transport).not.toHaveBeenCalled();
    });

    it('discards a late response after the selected connection Key changes', async () => {
        const { host, openai, revisions } = fixture();
        const transport = jest.mocked(requestUrl).mockImplementation(() => {
            revisions.set(openai.id, 1);
            const result = response(consumer);
            return Object.assign(Promise.resolve(result), {
                arrayBuffer: Promise.resolve(result.arrayBuffer),
                json: Promise.resolve(result.json),
                text: Promise.resolve(result.text),
            });
        });
        await expect(invoke(consumer, host)).rejects.toMatchObject({ code: 'connection_changed' });
        expect(transport).toHaveBeenCalledTimes(1);
    });
});

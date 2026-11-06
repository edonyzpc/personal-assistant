/** @jest-environment node */
import { requestUrl } from 'obsidian';
import { AIUtils, type ChatTransport } from '../src/ai-services/ai-utils';
import { createProviderRequestScope } from '../src/ai-services/obsidian-fetch';
import { ProviderAdmissionError, ProviderInputReprepareRequiredError } from '../src/ai-services/provider-admission-error';

jest.mock('obsidian');

const successBody = JSON.stringify({
    id: 'fixture', object: 'chat.completion', created: 0, model: 'fixture',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Answer' } }],
});

describe('physical provider admission with the installed SDK', () => {
    const originalFetch = globalThis.fetch;
    const network = jest.fn();
    const obsidianNetwork = jest.mocked(requestUrl);
    const utils = new AIUtils({
        settings: { aiProvider: 'openai', chatModelName: 'fixture', embeddingModelName: 'fixture', baseURL: 'https://fixture.invalid/v1' },
        getAPIToken: async () => 'fixture', log: jest.fn(),
    });

    beforeEach(() => {
        jest.useFakeTimers();
        network.mockReset();
        obsidianNetwork.mockReset();
        globalThis.fetch = network;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.useRealTimers();
    });

    it.each([
        ['native', 'invoke'], ['obsidian', 'invoke'], ['native', 'stream'], ['obsidian', 'stream'],
    ] as const)('%s %s rejects local admission once, with zero HTTP dispatches after model binding', async (transport, mode) => {
        const admission = jest.fn(() => { throw new Error('sources changed before dispatch'); });
        const model = await utils.createChatModel(0, {
            transport, providerRequestScope: createProviderRequestScope(), onProviderRequestStart: admission,
        });
        // The real runtime binds schemas/configuration, which can create SDK model copies.
        const bound = model.bindTools([{ type: 'function', function: { name: 'fixture', parameters: { type: 'object', properties: {} } } }]);
        const result = (async () => {
            if (mode === 'invoke') return await bound.invoke('fixture');
            for await (const chunk of await bound.stream('fixture')) void chunk;
        })().catch(error => error);
        await jest.runAllTimersAsync();
        expect(await result).toBeInstanceOf(ProviderAdmissionError);
        expect(admission).toHaveBeenCalledTimes(1);
        expect(network).not.toHaveBeenCalled();
        expect(obsidianNetwork).not.toHaveBeenCalled();
    });

    it.each(['native', 'obsidian'] as ChatTransport[])('%s does not retry asynchronous preparation rejection', async transport => {
        const prepare = jest.fn(async () => { throw new Error('prepared evidence revoked'); });
        const admission = jest.fn();
        const model = await utils.createChatModel(0, {
            transport, providerRequestScope: createProviderRequestScope(), prepareProviderRequest: prepare, onProviderRequestStart: admission,
        });
        const result = model.invoke('fixture').catch(error => error);
        await jest.runAllTimersAsync();
        expect(await result).toBeInstanceOf(ProviderAdmissionError);
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(admission).not.toHaveBeenCalled();
        expect(network).not.toHaveBeenCalled();
        expect(obsidianNetwork).not.toHaveBeenCalled();
    });

    it('lets an explicit null override a Request signal before native preparation and admission', async () => {
        const controller = new AbortController();
        controller.abort();
        const request = new Request('https://fixture.invalid/v1/chat/completions', { signal: controller.signal });
        const prepare = jest.fn(async () => undefined);
        const admission = jest.fn();
        const model = await utils.createChatModel(0, {
            transport: 'native', prepareProviderRequest: prepare, onProviderRequestStart: admission,
        });
        network.mockResolvedValueOnce(new Response(successBody));
        const configuredFetch = model.clientConfig.fetch!;

        await expect(configuredFetch(request, { signal: null })).resolves.toBeInstanceOf(Response);
        expect(prepare).toHaveBeenCalledWith(null);
        expect(admission).toHaveBeenCalledTimes(1);
        expect(network).toHaveBeenCalledWith(request, { signal: null });
    });

    it.each([429, 500])('retains HTTP %s retries and rechecks admission for each dispatch', async status => {
        const retryHeaders: Record<string, string> = status === 429
            ? { 'content-type': 'application/json', 'retry-after': '0' }
            : { 'content-type': 'application/json' };
        network.mockResolvedValueOnce(new Response('{"error":{"message":"retry"}}', { status, headers: retryHeaders }))
            .mockResolvedValueOnce(new Response(successBody, { status: 200, headers: { 'content-type': 'application/json' } }));
        const admission = jest.fn();
        const prepare = jest.fn(async () => undefined);
        const model = await utils.createChatModel(0, { transport: 'native', prepareProviderRequest: prepare, onProviderRequestStart: admission });
        const result = model.invoke('fixture').catch(error => error);
        await jest.runAllTimersAsync();
        expect((await result).content).toBe('Answer');
        expect(network).toHaveBeenCalledTimes(2);
        expect(admission).toHaveBeenCalledTimes(2);
        expect(prepare).toHaveBeenCalledTimes(2);
    });

    it('retries a headerless SDK 429 after real non-zero backoff and re-admits the retry', async () => {
        network.mockResolvedValueOnce(new Response('{"error":{"message":"rate limited without a hint"}}', {
            status: 429, headers: { 'content-type': 'application/json' },
        })).mockResolvedValueOnce(new Response(successBody, { status: 200, headers: { 'content-type': 'application/json' } }));
        const admission = jest.fn();
        const prepare = jest.fn(async () => undefined);
        const model = await utils.createChatModel(0, { transport: 'native', prepareProviderRequest: prepare, onProviderRequestStart: admission });
        const result = model.invoke('fixture');
        await jest.advanceTimersByTimeAsync(0);
        expect(network).toHaveBeenCalledTimes(1);
        expect(admission).toHaveBeenCalledTimes(1);
        expect(prepare).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(network).toHaveBeenCalledTimes(1);
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({ content: 'Answer' });
        expect(network).toHaveBeenCalledTimes(2);
        expect(admission).toHaveBeenCalledTimes(2);
        expect(prepare).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['quota', { code: 'insufficient_quota', retryAfter: undefined }],
        ['long Retry-After', { code: 'rate_limit_exceeded', retryAfter: '61' }],
    ] as const)('does not give a %s 429 to the SDK physical retry loop', async (name, failure) => {
        void name;
        network.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: failure.code, message: failure.code } }), {
            status: 429,
            headers: { 'content-type': 'application/json', ...(failure.retryAfter ? { 'retry-after': failure.retryAfter } : {}) },
        }));
        const model = await utils.createChatModel(0, { transport: 'native', onProviderRequestStart: jest.fn() });
        const result = model.invoke('fixture').catch(error => error);
        await jest.runAllTimersAsync();
        await expect(await result).toMatchObject({ status: 429 });
        expect(network).toHaveBeenCalledTimes(1);
    });

    it('stops a network retry if admission is revoked before its dispatch', async () => {
        network.mockResolvedValueOnce(new Response('{"error":{"message":"retry"}}', { status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0' } }));
        const admission = jest.fn().mockImplementationOnce(() => undefined).mockImplementation(() => { throw new Error('sources revoked'); });
        const model = await utils.createChatModel(0, { transport: 'native', onProviderRequestStart: admission });
        const result = model.invoke('fixture').catch(error => error);
        await jest.runAllTimersAsync();
        expect(await result).toBeInstanceOf(ProviderAdmissionError);
        expect(network).toHaveBeenCalledTimes(1);
        expect(admission).toHaveBeenCalledTimes(2);
    });

    it('retains the SDK nonretryable authentication classification', async () => {
        network.mockResolvedValueOnce(new Response('{"error":{"message":"unauthorized"}}', { status: 401, headers: { 'content-type': 'application/json' } }));
        const model = await utils.createChatModel(0, { transport: 'native', onProviderRequestStart: jest.fn() });
        const result = model.invoke('fixture').catch(error => error);
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({ status: 401 });
        expect(network).toHaveBeenCalledTimes(1);
    });

    it('also stops rejected embedding admission before the shared Obsidian transport', async () => {
        const admission = jest.fn(() => { throw new Error('embedding sources changed'); });
        const model = await utils.createEmbeddings(undefined, { onProviderRequestStart: admission });
        const result = model.embedQuery('fixture').catch(error => error);
        await jest.runAllTimersAsync();
        expect(await result).toBeInstanceOf(ProviderAdmissionError);
        expect(admission).toHaveBeenCalledTimes(1);
        expect(obsidianNetwork).not.toHaveBeenCalled();
    });

    it('never lets the SDK retry stale serialized evidence even when fresh host projection is recoverable', async () => {
        const admission = jest.fn(() => { throw new ProviderInputReprepareRequiredError(new Error('history changed')); });
        const model = await utils.createChatModel(0, { transport: 'native', onProviderRequestStart: admission });
        const result = model.invoke('fixture').catch(error => error);
        await jest.runAllTimersAsync();
        expect(await result).toBeInstanceOf(ProviderInputReprepareRequiredError);
        expect(admission).toHaveBeenCalledTimes(1);
        expect(network).not.toHaveBeenCalled();
    });
});

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

    it.each([429, 500])('retains HTTP %s retries and rechecks admission for each dispatch', async status => {
        network.mockResolvedValueOnce(new Response('{"error":{"message":"retry"}}', { status, headers: { 'content-type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(successBody, { status: 200, headers: { 'content-type': 'application/json' } }));
        const admission = jest.fn();
        const prepare = jest.fn(async () => undefined);
        const model = await utils.createChatModel(0, { transport: 'native', prepareProviderRequest: prepare, onProviderRequestStart: admission });
        const result = model.invoke('fixture');
        await jest.runAllTimersAsync();
        expect((await result).content).toBe('Answer');
        expect(network).toHaveBeenCalledTimes(2);
        expect(admission).toHaveBeenCalledTimes(2);
        expect(prepare).toHaveBeenCalledTimes(2);
    });

    it('stops a network retry if admission is revoked before its dispatch', async () => {
        network.mockResolvedValueOnce(new Response('{"error":{"message":"retry"}}', { status: 429, headers: { 'content-type': 'application/json' } }));
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

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { requestUrl } from 'obsidian';
import {
    createProviderRequestScope,
    createScopedObsidianFetch,
    obsidianFetch,
} from '../src/ai-services/obsidian-fetch';

jest.mock('obsidian');

const mockedRequestUrl = requestUrl as unknown as jest.MockedFunction<(request: unknown) => Promise<unknown>>;
const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const successfulResponse = () => ({
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    text: '',
    json: null,
});

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe('obsidianFetch', () => {
    beforeEach(() => {
        mockedRequestUrl.mockReset();
    });

    it('posts JSON through requestUrl and returns a JSON response', async () => {
        const json = JSON.stringify({ ok: true });
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'application/json' },
            arrayBuffer: encode(json),
            text: json,
            json: { ok: true },
        });

        const response = await obsidianFetch('https://example.test/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' },
            body: JSON.stringify({ prompt: 'hello' }),
        });

        expect(mockedRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://example.test/chat',
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify({ prompt: 'hello' }),
            throw: false,
        }));
        expect(response.ok).toBe(true);
        await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it('preserves non-2xx status without throwing', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 429,
            headers: { 'content-type': 'text/plain' },
            arrayBuffer: encode('rate limited'),
            text: 'rate limited',
            json: null,
        });

        const response = await obsidianFetch('https://example.test/limited');

        expect(response.ok).toBe(false);
        expect(response.status).toBe(429);
        await expect(response.text()).resolves.toBe('rate limited');
    });

    it('merges Request and init headers', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            headers: {},
            arrayBuffer: new ArrayBuffer(0),
            text: '',
            json: null,
        });

        const request = new Request('https://example.test/headers', {
            headers: { 'X-Request': 'request' },
        });
        await obsidianFetch(request, {
            headers: { 'X-Init': 'init' },
        });

        expect(mockedRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
            headers: expect.objectContaining({
                'x-request': 'request',
                'x-init': 'init',
            }),
        }));
    });

    it('returns binary response data', async () => {
        const bytes = new Uint8Array([1, 2, 3]).buffer;
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
            arrayBuffer: bytes,
            text: '',
            json: null,
        });

        const response = await obsidianFetch('https://example.test/file');
        const result = new Uint8Array(await response.arrayBuffer());

        expect(Array.from(result)).toEqual([1, 2, 3]);
    });

    it('maps invalid status values to a non-success status', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 0,
            headers: {},
            arrayBuffer: encode('proxy failure'),
            text: 'proxy failure',
            json: null,
        });

        const response = await obsidianFetch('https://example.test/failed');

        expect(response.status).toBe(500);
        expect(response.ok).toBe(false);
    });

    it('rejects before requestUrl when already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(obsidianFetch('https://example.test/abort', {
            signal: controller.signal,
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockedRequestUrl).not.toHaveBeenCalled();
    });

    it('does not dispatch a same-scope request until a locally-aborted request physically settles', async () => {
        const firstRaw = deferred<unknown>();
        mockedRequestUrl
            .mockImplementationOnce(() => firstRaw.promise)
            .mockResolvedValueOnce(successfulResponse());
        const scope = createProviderRequestScope();
        const fetch = createScopedObsidianFetch({ providerRequestScope: scope });
        const firstController = new AbortController();

        const first = fetch('https://example.test/first', { signal: firstController.signal });
        await flushMicrotasks();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
        firstController.abort();
        await expect(first).rejects.toMatchObject({ name: 'AbortError' });

        const second = fetch('https://example.test/second');
        await flushMicrotasks();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

        firstRaw.resolve(successfulResponse());
        await flushMicrotasks();
        await expect(second).resolves.toBeInstanceOf(Response);
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
    });

    it('never dispatches a waiting same-scope request when its signal aborts', async () => {
        const firstRaw = deferred<unknown>();
        mockedRequestUrl.mockImplementationOnce(() => firstRaw.promise);
        const scope = createProviderRequestScope();
        const fetch = createScopedObsidianFetch({ providerRequestScope: scope });
        const firstController = new AbortController();

        const first = fetch('https://example.test/first', { signal: firstController.signal });
        await flushMicrotasks();
        firstController.abort();
        await expect(first).rejects.toMatchObject({ name: 'AbortError' });

        const waitingController = new AbortController();
        const waiting = fetch('https://example.test/waiting', { signal: waitingController.signal });
        await flushMicrotasks();
        waitingController.abort();
        await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });

        firstRaw.resolve(successfulResponse());
        await flushMicrotasks();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('preserves ordinary same-scope request concurrency before either caller detaches', async () => {
        const firstRaw = deferred<unknown>();
        const secondRaw = deferred<unknown>();
        mockedRequestUrl
            .mockImplementationOnce(() => firstRaw.promise)
            .mockImplementationOnce(() => secondRaw.promise);
        const fetch = createScopedObsidianFetch({
            providerRequestScope: createProviderRequestScope(),
        });

        const first = fetch('https://example.test/first');
        const second = fetch('https://example.test/second');
        await flushMicrotasks();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);

        firstRaw.resolve(successfulResponse());
        secondRaw.resolve(successfulResponse());
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    });

    it('does not let a detached request block a different run scope', async () => {
        const firstRaw = deferred<unknown>();
        mockedRequestUrl
            .mockImplementationOnce(() => firstRaw.promise)
            .mockResolvedValueOnce(successfulResponse());
        const firstFetch = createScopedObsidianFetch({
            providerRequestScope: createProviderRequestScope(),
        });
        const secondFetch = createScopedObsidianFetch({
            providerRequestScope: createProviderRequestScope(),
        });
        const firstController = new AbortController();

        const first = firstFetch('https://example.test/first', { signal: firstController.signal });
        await flushMicrotasks();
        firstController.abort();
        await expect(first).rejects.toMatchObject({ name: 'AbortError' });

        await expect(secondFetch('https://example.test/second')).resolves.toBeInstanceOf(Response);
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
        firstRaw.resolve(successfulResponse());
    });

    it('runs dispatch admission after drain and can reject before requestUrl', async () => {
        const firstRaw = deferred<unknown>();
        mockedRequestUrl.mockImplementationOnce(() => firstRaw.promise);
        const scope = createProviderRequestScope();
        const firstController = new AbortController();
        const firstFetch = createScopedObsidianFetch({ providerRequestScope: scope });
        const first = firstFetch('https://example.test/first', { signal: firstController.signal });
        await flushMicrotasks();
        firstController.abort();
        await expect(first).rejects.toMatchObject({ name: 'AbortError' });

        const onProviderRequestStart = jest.fn(() => {
            throw new Error('soft deadline reached');
        });
        const second = createScopedObsidianFetch({
            providerRequestScope: scope,
            onProviderRequestStart,
        })('https://example.test/second');
        await flushMicrotasks();
        expect(onProviderRequestStart).not.toHaveBeenCalled();

        firstRaw.resolve(successfulResponse());
        await expect(second).rejects.toThrow('soft deadline reached');
        expect(onProviderRequestStart).toHaveBeenCalledTimes(1);
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('rechecks the barrier when another active request detaches as a prior barrier settles', async () => {
        const activeRaw = deferred<unknown>();
        const firstBarrierRaw = deferred<unknown>();
        mockedRequestUrl
            .mockImplementationOnce(() => activeRaw.promise)
            .mockImplementationOnce(() => firstBarrierRaw.promise)
            .mockResolvedValueOnce(successfulResponse());
        const fetch = createScopedObsidianFetch({
            providerRequestScope: createProviderRequestScope(),
        });
        const activeController = new AbortController();
        const firstBarrierController = new AbortController();

        const active = fetch('https://example.test/active', { signal: activeController.signal });
        const firstBarrier = fetch('https://example.test/first-barrier', {
            signal: firstBarrierController.signal,
        });
        await flushMicrotasks();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
        firstBarrierController.abort();
        await expect(firstBarrier).rejects.toMatchObject({ name: 'AbortError' });

        const waiting = fetch('https://example.test/waiting');
        await flushMicrotasks();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);

        // Both changes happen before the waiting continuation runs: the first
        // barrier drains while the previously ordinary active request detaches.
        firstBarrierRaw.resolve(successfulResponse());
        activeController.abort();
        await expect(active).rejects.toMatchObject({ name: 'AbortError' });
        await flushMicrotasks();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);

        activeRaw.resolve(successfulResponse());
        await expect(waiting).resolves.toBeInstanceOf(Response);
        expect(mockedRequestUrl).toHaveBeenCalledTimes(3);
    });
});

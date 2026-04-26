import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { requestUrl } from 'obsidian';
import { obsidianFetch } from '../src/ai-services/obsidian-fetch';

jest.mock('obsidian');

const mockedRequestUrl = requestUrl as unknown as jest.MockedFunction<(request: unknown) => Promise<unknown>>;
const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

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

    it('rejects before requestUrl when already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(obsidianFetch('https://example.test/abort', {
            signal: controller.signal,
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockedRequestUrl).not.toHaveBeenCalled();
    });
});

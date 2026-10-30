import { describe, expect, it, jest } from '@jest/globals';
import { OpenAIImageProvider } from '../src/ai-services/openai-image-provider';

const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Dq0AAAAASUVORK5CYII=';
const base = { baseURL: 'https://api.openai.com/v1', apiKey: 'synthetic-secret' };
const input = { model: 'gpt-image-2.5-flare', prompt: 'A red bird', count: 1 };

function result() {
    return new Response(JSON.stringify({ data: [{ b64_json: image }] }), {
        status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
    });
}

describe('OpenAI image protocol', () => {
    it.each([false, true])('sends one authorized JSON image request (references: %s) and returns temporary bytes', async references => {
        const request = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => result());
        const provider = new OpenAIImageProvider({ ...base, request });
        const response = await provider.submit({ ...input, ...(references ? { referenceImages: [`data:image/png;base64,${image}`] } : {}) });
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][0]).toBe(`${base.baseURL}/images/${references ? 'edits' : 'generations'}`);
        const init = request.mock.calls[0][1]!;
        expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' });
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ model: input.model, prompt: input.prompt, n: 1, output_format: 'png' });
        expect(body.images).toEqual(references ? [{ image_url: `data:image/png;base64,${image}` }] : undefined);
        expect(response).toMatchObject({ kind: 'completed', requestId: 'req_test' });
        expect(new Uint8Array(response.outputs[0])).toEqual(Uint8Array.from(Buffer.from(image, 'base64')));
        expect(response).not.toHaveProperty('taskId');
    });

    it('keeps uncertain submission distinct from a definite rejection and never retries a POST', async () => {
        for (const status of [401, 500]) {
            const request = jest.fn(async () => new Response('{}', { status }));
            await expect(new OpenAIImageProvider({ ...base, request }).submit(input))
                .rejects.toMatchObject({ kind: status === 401 ? 'rejected' : 'submission_unknown' });
            expect(request).toHaveBeenCalledTimes(1);
        }
        const request = jest.fn(async () => { throw new Error('network lost'); });
        await expect(new OpenAIImageProvider({ ...base, request }).submit(input)).rejects.toMatchObject({ kind: 'submission_unknown' });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not treat malformed successful responses as permission to resubmit', async () => {
        const request = jest.fn(async () => new Response(JSON.stringify({ data: [{ url: 'https://untrusted.invalid/image' }] }), { status: 200 }));
        await expect(new OpenAIImageProvider({ ...base, request }).submit(input)).rejects.toMatchObject({ kind: 'submission_unknown' });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('rejects unsupported input counts, Wan models and external reference URLs before dispatch', async () => {
        const request = jest.fn(async () => result());
        const provider = new OpenAIImageProvider({ ...base, request });
        await expect(provider.submit({ ...input, count: 11 })).rejects.toMatchObject({ kind: 'invalid_input' });
        await expect(provider.submit({ ...input, model: 'wan2.7-image' })).rejects.toMatchObject({ kind: 'invalid_input' });
        await expect(provider.submit({ ...input, referenceImages: ['https://external.invalid/private.png'] }))
            .rejects.toMatchObject({ kind: 'invalid_input' });
        expect(request).not.toHaveBeenCalled();
        expect(() => new OpenAIImageProvider({ ...base, baseURL: 'https://elsewhere.invalid/v1', request })).toThrow('unsupported_endpoint');
    });
});

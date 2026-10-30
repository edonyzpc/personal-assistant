import { inspectImage } from '../chat/image-format';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface OpenAIImageSubmitInput {
    model: string;
    prompt: string;
    count: number;
    referenceImages?: string[];
}

export interface CompletedImageSubmission {
    kind: 'completed';
    /** Request-local bytes only. The image service imports these into its existing asset store. */
    outputs: ArrayBuffer[];
    requestId?: string;
}

export class OpenAIImageProviderError extends Error {
    constructor(readonly kind: 'invalid_input' | 'unsupported_endpoint' | 'rejected' | 'submission_unknown',
        readonly httpStatus?: number) {
        super(kind);
        this.name = 'OpenAIImageProviderError';
    }
}

export function resolveOpenAIImageBaseURL(baseURL: string): string {
    const normalized = baseURL.trim().replace(/\/+$/, '');
    if (normalized !== 'https://api.openai.com/v1') throw new OpenAIImageProviderError('unsupported_endpoint');
    return normalized;
}

/** One paid POST. No SDK retries, remote task emulation, uploads, or provider fallback. */
export class OpenAIImageProvider {
    private readonly baseURL: string;
    private readonly apiKey: string;
    private readonly request: typeof fetch;

    constructor(input: { baseURL: string; apiKey: string; request?: typeof fetch }) {
        this.baseURL = resolveOpenAIImageBaseURL(input.baseURL);
        this.apiKey = input.apiKey.trim();
        if (!this.apiKey) throw new OpenAIImageProviderError('invalid_input');
        this.request = input.request ?? globalThis.fetch.bind(globalThis);
    }

    async submit(input: OpenAIImageSubmitInput): Promise<CompletedImageSubmission> {
        const images = input.referenceImages ?? [];
        if (!input.model.startsWith('gpt-image-') || input.model.length > 128
            || !input.prompt.trim() || input.prompt.length > 12000
            || !Number.isSafeInteger(input.count) || input.count < 1 || input.count > 10
            || images.length > 8 || images.some(image => !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) {
            throw new OpenAIImageProviderError('invalid_input');
        }
        const body = { model: input.model, prompt: input.prompt, n: input.count, output_format: 'png',
            ...(images.length ? { images: images.map(image_url => ({ image_url })) } : {}) };
        let response: Response;
        try {
            response = await this.request(`${this.baseURL}/images/${images.length ? 'edits' : 'generations'}`, {
                method: 'POST', redirect: 'error', credentials: 'omit',
                headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch {
            throw new OpenAIImageProviderError('submission_unknown');
        }
        if (response.status >= 400 && response.status < 500) throw new OpenAIImageProviderError('rejected', response.status);
        if (!response.ok || response.redirected) throw new OpenAIImageProviderError('submission_unknown', response.status);
        try {
            const result: unknown = await response.json();
            if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data)
                || result.data.length === 0 || result.data.length > input.count) throw new Error('invalid result');
            const outputs = result.data.map((item: unknown) => {
                if (!item || typeof item !== 'object' || !('b64_json' in item) || typeof item.b64_json !== 'string'
                    || item.b64_json.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
                    || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json)) throw new Error('invalid image');
                const decoded = globalThis.atob(item.b64_json);
                if (decoded.length > MAX_IMAGE_BYTES) throw new Error('image too large');
                const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0)).buffer;
                if (!['image/png', 'image/jpeg', 'image/webp'].includes(inspectImage(bytes).mime)) throw new Error('invalid format');
                return bytes;
            });
            const requestId = response.headers.get('x-request-id');
            return { kind: 'completed', outputs,
                ...(requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId) ? { requestId } : {}) };
        } catch {
            // An unusable successful response is not evidence that the paid generation never happened.
            throw new OpenAIImageProviderError('submission_unknown', response.status);
        }
    }
}

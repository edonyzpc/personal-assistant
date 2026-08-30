import { requestUrl, type RequestUrlParam } from 'obsidian';

type RequestBody = string | ArrayBuffer | undefined;

export type ProviderRequestCancellationCapability = 'signal-propagating' | 'local-only';

/**
 * One logical PA run owns one scope. Obsidian's requestUrl cannot physically
 * cancel a request, so only locally-aborted requests are retained as barriers.
 * Ordinary in-flight requests remain concurrent.
 */
export class ProviderRequestScope {
    private readonly detachedRequests = new Set<Promise<void>>();

    async waitForDetachedRequests(signal?: AbortSignal | null): Promise<void> {
        throwIfAborted(signal);
        while (this.detachedRequests.size > 0) {
            await withAbort(
                Promise.all([...this.detachedRequests]).then(() => undefined),
                signal,
            );
            throwIfAborted(signal);
        }
    }

    async startRequest<T>(
        task: () => Promise<T>,
        signal?: AbortSignal | null,
        beforeDispatch?: () => void,
    ): Promise<T> {
        while (true) {
            await this.waitForDetachedRequests(signal);
            throwIfAborted(signal);
            // Keep the final barrier check, admission hook, and raw request
            // construction in one synchronous segment. A detached request
            // observed after the prior snapshot therefore cannot be skipped.
            if (this.detachedRequests.size > 0) continue;
            beforeDispatch?.();
            throwIfAborted(signal);
            const rawRequest = task();
            return await withLocalAbort(rawRequest, signal, () => {
                this.trackDetachedRequest(rawRequest);
            });
        }
    }

    private trackDetachedRequest(request: Promise<unknown>): void {
        const barrier = request.then(() => undefined, () => undefined);
        this.detachedRequests.add(barrier);
        void barrier.then(() => {
            this.detachedRequests.delete(barrier);
        });
    }
}

export const createProviderRequestScope = (): ProviderRequestScope => new ProviderRequestScope();

export interface ObsidianFetchControl {
    /** Run-local barrier for physically-live requestUrl calls after local abort. */
    providerRequestScope?: ProviderRequestScope;
    /** Synchronous admission check immediately before each physical HTTP dispatch. */
    onProviderRequestStart?: () => void;
}

const createAbortError = (): Error => {
    if (typeof DOMException !== 'undefined') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
};

const throwIfAborted = (signal?: AbortSignal | null): void => {
    if (signal?.aborted) {
        throw createAbortError();
    }
};

const withAbort = async <T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> => {
    if (!signal) return promise;
    throwIfAborted(signal);

    return await new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(createAbortError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => {
            signal.removeEventListener('abort', onAbort);
        });
    });
};

const withLocalAbort = async <T>(
    promise: Promise<T>,
    signal: AbortSignal | null | undefined,
    onDetached: () => void,
): Promise<T> => {
    if (!signal) return promise;
    if (signal.aborted) {
        onDetached();
        throw createAbortError();
    }

    return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            onDetached();
            reject(createAbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            },
            (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            },
        );
    });
};

const copyArrayBufferView = (view: ArrayBufferView): ArrayBuffer => {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
};

const normalizeBody = async (body: BodyInit | null | undefined): Promise<RequestBody> => {
    if (body == null) return undefined;
    if (typeof body === 'string') return body;
    if (body instanceof ArrayBuffer) return body;
    if (ArrayBuffer.isView(body)) return copyArrayBufferView(body);
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return body.toString();
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return await body.arrayBuffer();
    }

    throw new TypeError('obsidianFetch only supports string, ArrayBuffer, URLSearchParams, and Blob request bodies.');
};

const getRequestBody = async (request: Request): Promise<RequestBody> => {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') return undefined;

    const body = await request.clone().arrayBuffer();
    return body.byteLength > 0 ? body : undefined;
};

const mergeHeaders = (request?: Request, initHeaders?: HeadersInit): Record<string, string> => {
    const headers = new Headers();
    request?.headers.forEach((value, key) => headers.set(key, value));

    if (initHeaders) {
        new Headers(initHeaders).forEach((value, key) => headers.set(key, value));
    }

    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
};

const getRequest = (input: string | URL | Request): Request | undefined => {
    if (typeof Request === 'undefined') return undefined;
    return input instanceof Request ? input : undefined;
};

const getUrl = (input: string | URL | Request): string => {
    const request = getRequest(input);
    if (request) return request.url;
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    if (typeof input === 'string') return input;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
    throw new TypeError('Unsupported request URL input.');
};

const normalizeStatus = (status: number | undefined): number => {
    if (typeof status === 'number' && status >= 200 && status <= 599) {
        return status;
    }
    return 500;
};

export const obsidianFetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
    control: ObsidianFetchControl = {},
): Promise<Response> => {
    throwIfAborted(init.signal);

    const request = getRequest(input);
    const headers = mergeHeaders(request, init.headers);
    const body = init.body !== undefined
        ? await normalizeBody(init.body)
        : request
            ? await getRequestBody(request)
            : undefined;
    const method = init.method ?? request?.method ?? (body === undefined ? 'GET' : 'POST');
    const contentType = headers['content-type'] ?? headers['Content-Type'];

    const requestParam: RequestUrlParam = {
        url: getUrl(input),
        method,
        headers,
        throw: false,
    };

    if (contentType) {
        requestParam.contentType = contentType;
    }
    if (body !== undefined) {
        requestParam.body = body;
    }

    const response = control.providerRequestScope
        ? await control.providerRequestScope.startRequest(
            () => requestUrl(requestParam),
            init.signal,
            control.onProviderRequestStart,
        )
        : await (async () => {
            throwIfAborted(init.signal);
            control.onProviderRequestStart?.();
            throwIfAborted(init.signal);
            return await withAbort(requestUrl(requestParam), init.signal);
        })();
    const status = normalizeStatus(response.status);
    const canHaveBody = status !== 204 && status !== 205 && status !== 304;
    const responseBody = response.arrayBuffer?.byteLength
        ? response.arrayBuffer
        : response.text ?? '';

    return new Response(canHaveBody ? responseBody : null, {
        status,
        headers: new Headers(response.headers ?? {}),
    });
};

export const createScopedObsidianFetch = (
    control: ObsidianFetchControl,
): typeof fetch => (
    input: string | URL | Request,
    init?: RequestInit,
) => obsidianFetch(input, init, control);

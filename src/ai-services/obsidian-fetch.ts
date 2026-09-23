import { requestUrl, type RequestUrlParam } from 'obsidian';
import { agentDebugErrorType } from './pa-agent-debug';
import { prepareProviderAdmission, runProviderAdmission } from './provider-admission-error';
import { observeAgentDebug, type AgentDebugCallScope } from './agent-debug-port';
import { agentDebugNow, bindAgentDebugAttempt } from './agent-debug-observation';

type RequestBody = string | ArrayBuffer | undefined;

export type ProviderRequestCancellationCapability = 'signal-propagating' | 'local-only';

/**
 * One logical PA run owns one scope. Obsidian's requestUrl cannot physically
 * cancel a request, so only locally-aborted requests are retained as barriers.
 * Ordinary in-flight requests remain concurrent.
 */
export class ProviderRequestScope {
    private readonly detachedRequests = new Set<Promise<void>>();
    private detachedEpoch = 0;

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
        prepareProviderRequest?: (signal?: AbortSignal | null) => void | Promise<void>,
    ): Promise<T> {
        while (true) {
            await this.waitForDetachedRequests(signal);
            throwIfAborted(signal);
            const detachedEpoch = this.detachedEpoch;
            if (prepareProviderRequest) {
                await withAbort(prepareProviderAdmission(() => prepareProviderRequest(signal)), signal);
                throwIfAborted(signal);
                // Cancellation and detachment listeners are promise callbacks.
                // Yield once so a change observed during preparation cannot win
                // a race against the final synchronous admission segment.
                await Promise.resolve();
                await Promise.resolve();
                if (this.detachedEpoch !== detachedEpoch) continue;
            }
            await this.waitForDetachedRequests(signal);
            throwIfAborted(signal);
            if (prepareProviderRequest && this.detachedEpoch !== detachedEpoch) continue;
            // Keep the final barrier check, admission hook, and raw request
            // construction in one synchronous segment. A detached request
            // observed after the prior snapshot therefore cannot be skipped.
            if (this.detachedRequests.size > 0) continue;
            runProviderAdmission(beforeDispatch);
            throwIfAborted(signal);
            const rawRequest = task();
            return await withLocalAbort(rawRequest, signal, () => {
                this.trackDetachedRequest(rawRequest);
            });
        }
    }

    private trackDetachedRequest(request: Promise<unknown>): void {
        const barrier = request.then(() => undefined, () => undefined);
        this.detachedEpoch += 1;
        this.detachedRequests.add(barrier);
        void barrier.then(() => {
            this.detachedRequests.delete(barrier);
        });
    }
}

export const createProviderRequestScope = (): ProviderRequestScope => new ProviderRequestScope();

export interface ObsidianFetchControl {
    agentDebugCall?: AgentDebugCallScope;
    /** Run-local barrier for physically-live requestUrl calls after local abort. */
    providerRequestScope?: ProviderRequestScope;
    /** Synchronous admission check immediately before each physical HTTP dispatch. */
    onProviderRequestStart?: () => void;
    /** Runs when a physical HTTP attempt fails or returns a non-success status. */
    onProviderRequestFailed?: () => void;
    /** Validate the already-serialized request immediately before each physical dispatch. */
    prepareProviderRequest?: (signal?: AbortSignal | null) => void | Promise<void>;
    onProviderRequestDiagnostic?: (evidence: ProviderRequestDiagnostic) => void;
    onProviderRequestTrace?: (event: ProviderRequestTrace) => void;
    isProviderRequestTraceEnabled?: () => boolean;
}

export interface ProviderRequestTrace {
    requestId: string;
    phase: 'http_dispatch' | 'http_response' | 'http_error';
    transport: 'obsidian' | 'native';
    timestamp: number;
    elapsedMs: number;
    status?: number;
    errorType?: string;
    requestChars?: number;
    messageCount?: number;
    toolCount?: number;
}

let traceRequestSequence = 0;

/** Observe the actual dispatch, without consuming the body or changing its promise. */
export function traceProviderDispatch<T extends { status?: number }>(
    task: () => Promise<T>, transport: ProviderRequestTrace['transport'],
    observer?: (event: ProviderRequestTrace) => void, body?: unknown, enabled?: () => boolean,
    observation?: { call?: AgentDebugCallScope; diagnostic?: ObsidianFetchControl['onProviderRequestDiagnostic']; signal?: AbortSignal | null },
): Promise<T> {
    if (!observer && !observation?.call && !observation?.diagnostic) return task();
    const isEnabled = () => { try { return enabled?.() !== false; } catch { return false; } };
    const startedAt = Date.now();
    const monotonicStartedAt = agentDebugNow();
    const requestId = `http_${startedAt.toString(36)}_${++traceRequestSequence}`;
    const call = observation?.call;
    if (call) bindAgentDebugAttempt(call, requestId);
    let dispatchObserved = false;
    const emit = (phase: ProviderRequestTrace['phase'], fields: Partial<ProviderRequestTrace> = {}) => {
        if (!isEnabled()) return;
        try { observer?.({ requestId, phase, transport, timestamp: Date.now(), elapsedMs: Date.now() - startedAt, ...fields }); }
        catch { /* Logging is never an admission or execution gate. */ }
    };
    const observeResult = (phase: 'response' | 'error', fields: { status?: number; errorType?: string }) => {
        if (call) observeAgentDebug(call.recorder, () => ({
            nodeId: requestId, parentId: call.callId, kind: "attempt", phase,
            callId: call.callId, attemptId: requestId, turnId: call.turnId,
            transport: transport === "obsidian" ? "buffered" : "native",
            // Native fetch resolves at headers, before the SDK consumes the stream body.
            status: phase === 'error' || (fields.status !== undefined && fields.status >= 400) ? "failed"
                : transport === "obsidian" ? "completed" : "running",
            outcome: fields.status === undefined ? fields.errorType : `http_${fields.status}`,
            timing: { event: "response", at: agentDebugNow() },
            ...(!dispatchObserved ? { missingReason: "dispatch_not_collected" } : {}),
        }));
    };
    const onAbort = () => {
        if (call) observeAgentDebug(call.recorder, () => ({
            nodeId: requestId, parentId: call.callId, kind: "attempt", phase: "local_cancelled",
            callId: call.callId, attemptId: requestId, turnId: call.turnId,
            status: "cancelled", outcome: transport === "obsidian" ? "remote_outcome_unknown" : "cancellation_requested",
        }));
    };
    try {
        const result = task();
        // Attach both handlers before calling an observer which might cancel the caller.
        void result.then(
            response => {
                observation?.signal?.removeEventListener('abort', onAbort);
                emit('http_response', { status: response.status });
                observeResult('response', { status: response.status });
            },
            error => {
                observation?.signal?.removeEventListener('abort', onAbort);
                const errorType = agentDebugErrorType(error);
                emit('http_error', { errorType });
                observeResult('error', { errorType });
            },
        );
        observation?.signal?.addEventListener('abort', onAbort, { once: true });
        const traceEnabled = isEnabled();
        // An explicit content-free diagnostic callback predates Debug capture and
        // remains independent of the console trace toggle.
        const diagnosticEnabled = observation?.diagnostic !== undefined;
        let contentEnabled = false;
        try { contentEnabled = call?.recorder.enabled() === true; } catch { /* Missing collector is optional. */ }
        const shape: Pick<ProviderRequestTrace, 'requestChars' | 'messageCount' | 'toolCount'> = {};
        let record: Record<string, unknown> | undefined;
        // This bound avoids parsing arbitrarily large inline image payloads. The original body
        // is already owned by the transport; Debug never clones/consumes Request streams.
        const inspectable = typeof body === 'string' && body.length <= 1_048_576;
        if ((traceEnabled || contentEnabled || diagnosticEnabled) && inspectable) {
            shape.requestChars = body.length;
            try {
                const value: unknown = JSON.parse(body);
                if (value && typeof value === 'object' && !Array.isArray(value)) record = value as Record<string, unknown>;
            } catch { /* Unsupported body shape stays unobservable. */ }
            if (Array.isArray(record?.messages)) shape.messageCount = record.messages.length;
            if (Array.isArray(record?.tools)) shape.toolCount = record.tools.length;
        }
        if (contentEnabled && call) {
            dispatchObserved = true;
            observeAgentDebug(call.recorder, () => ({
                nodeId: requestId, parentId: call.callId, kind: "attempt", phase: "dispatch", status: "running",
                callId: call.callId, attemptId: requestId, turnId: call.turnId,
                provider: call.provider, model: typeof record?.model === 'string' ? record.model : call.model,
                transport: transport === "obsidian" ? "buffered" : "native",
                prompt: record, lineage: call.lineage ?? { unknown: true },
                attachments: call.getAttachments?.(),
                timing: { event: "dispatch", at: monotonicStartedAt },
                ...(!record ? { missingReason: typeof body === 'string' && !inspectable ? "request_body_limit" : "unobservable_body" } : {}),
            }));
        }
        if (observation?.diagnostic) {
            try { observation.diagnostic({ ...providerRequestDiagnostic(record, transport), ...(call ? { requestId } : {}) }); }
            catch { /* The physical request is already running; observers cannot reject it. */ }
        }
        emit('http_dispatch', shape);
        return result;
    } catch (error) {
        observation?.signal?.removeEventListener('abort', onAbort);
        emit('http_error', { errorType: agentDebugErrorType(error) });
        observeResult('error', { errorType: agentDebugErrorType(error) });
        throw error;
    }
}

export interface ProviderRequestDiagnostic {
    requestId?: string;
    transport: 'obsidian' | 'native';
    bodyState: 'json_object' | 'unknown';
    maxTokens: number | 'absent' | 'unknown';
    maxCompletionTokens: number | 'absent' | 'unknown';
}

/** Inspect only the serialized dispatch body. Never expose its content to logs. */
export function reportProviderRequestDiagnostic(
    body: unknown,
    transport: ProviderRequestDiagnostic['transport'],
    observer: ObsidianFetchControl['onProviderRequestDiagnostic'],
): void {
    if (!observer) return;
    let record: Record<string, unknown> | undefined;
    if (typeof body === 'string') {
        try {
            const parsed: unknown = JSON.parse(body);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed as Record<string, unknown>;
        } catch { /* Opaque/non-JSON bodies have no observable token limits. */ }
    }
    try { observer(providerRequestDiagnostic(record, transport)); }
    catch { /* Diagnostics cannot block the physical request. */ }
}

function providerRequestDiagnostic(record: Record<string, unknown> | undefined, transport: ProviderRequestDiagnostic['transport']): ProviderRequestDiagnostic {
    const readLimit = (key: string): number | 'absent' | 'unknown' => {
        if (!record) return 'unknown';
        if (!Object.prototype.hasOwnProperty.call(record, key)) return 'absent';
        const value = record[key];
        return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 'unknown';
    };
    return { transport, bodyState: record ? 'json_object' : 'unknown',
        maxTokens: readLimit('max_tokens'), maxCompletionTokens: readLimit('max_completion_tokens') };
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
    // The request already exists. Even an immediate local cancellation must
    // consume its later rejection; requestUrl cannot cancel the physical work.
    if (signal.aborted) void promise.catch(() => undefined);
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

    const dispatch = () => {
        return traceProviderDispatch(() => requestUrl(requestParam), 'obsidian', control.onProviderRequestTrace,
            body, control.isProviderRequestTraceEnabled,
            { call: control.agentDebugCall, diagnostic: control.onProviderRequestDiagnostic, signal: init.signal });
    };
    let response;
    try {
        response = control.providerRequestScope
            ? await control.providerRequestScope.startRequest(
            dispatch,
            init.signal,
            control.onProviderRequestStart,
            control.prepareProviderRequest,
        )
            : await (async () => {
            throwIfAborted(init.signal);
            if (control.prepareProviderRequest) {
                await withAbort(
                    prepareProviderAdmission(() => control.prepareProviderRequest!(init.signal)),
                    init.signal,
                );
            }
            throwIfAborted(init.signal);
            runProviderAdmission(control.onProviderRequestStart);
            throwIfAborted(init.signal);
            return await withAbort(dispatch(), init.signal);
        })();
    } catch (error) {
        control.onProviderRequestFailed?.();
        throw error;
    }
    const status = normalizeStatus(response.status);
    if (status < 200 || status >= 300) control.onProviderRequestFailed?.();
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

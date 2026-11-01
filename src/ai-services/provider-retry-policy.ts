import { getRetryable } from '@langchain/core/errors';
import {
    AsyncCaller,
    classifyRateLimitError,
    parseRetryAfterMs,
} from '@langchain/core/utils/async_caller';
import { getProviderAdmissionError } from './provider-admission-error';

// Delegate all other errors to the installed SDK's default policy, including
// authentication/quota rejection and retryable 429/5xx/connection failures.
// No calls enter this caller's queue; it only exposes the inherited policy.
class DefaultRetryPolicy extends AsyncCaller {
    handle(error: unknown): unknown { return this.onFailedAttempt?.(error); }
}
const defaultRetryPolicy = new DefaultRetryPolicy({});

export function onProviderFailedAttempt(error: unknown): unknown {
    const admission = getProviderAdmissionError(error);
    if (admission) throw admission;
    normalizeProviderRetryAfterHeader(error);
    try {
        return defaultRetryPolicy.handle(error);
    } catch (rejected) {
        const classification = classifyProviderRateLimit(rejected);
        if (classification?.action === 'capacity'
            && classification.reason === 'headerless_429'
            && getRetryable(rejected) === true) return;
        throw rejected;
    }
}

function errorRecord(error: unknown): Record<string, unknown> | undefined {
    return error !== null && typeof error === 'object' && !Array.isArray(error)
        ? error as Record<string, unknown>
        : undefined;
}

/** Normalize the status shapes used by provider SDK errors and their wrapped responses. */
export function readProviderErrorStatus(error: unknown): number | undefined {
    const record = errorRecord(error);
    const response = errorRecord(record?.response);
    const status = finiteNumber(record?.status)
        ?? finiteNumber(record?.statusCode)
        ?? finiteNumber(response?.status)
        ?? finiteNumber(response?.statusCode);
    return status !== undefined && status >= 100 && status <= 599 ? status : undefined;
}

/**
 * Resolve retryability across SDK stamps and PA's transport contracts.
 * A quota classification wins over an earlier optimistic true stamp: SSE wrappers
 * can stamp before the default attempt handler has classified the provider body.
 */
export function resolveProviderRetryable(error: unknown): boolean {
    const explicit = getRetryable(error);
    const classification = classifyProviderRateLimit(error);
    if (explicit === false || classification?.action === 'stop'
        || defaultProviderHandlerStops(error)) return false;
    if (explicit === true) return true;
    const status = readProviderErrorStatus(error);
    if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
    const record = errorRecord(error);
    const code = finiteString(record?.code)
        ?? finiteString(errorRecord(record?.cause)?.code);
    return code !== undefined && new Set([
        'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT',
        'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
    ]).has(code.toUpperCase());
}

/** Preserve SDK Retry-After hints and PA's pre-SDK direct-value contract. */
export function readProviderRetryAfterMs(error: unknown): number | undefined {
    const record = errorRecord(error);
    const direct = finiteNonNegativeNumber(record?.retryAfterMs);
    if (direct !== undefined) return direct;
    const classified = finiteNonNegativeNumber(classifyProviderRateLimit(error)?.retryAfterMs);
    if (classified !== undefined) return classified;
    const headers = errorRecord(record?.headers) ?? errorRecord(errorRecord(record?.response)?.headers);
    if (!headers) return undefined;
    let raw: unknown;
    const getter = (headers as { get?: (name: string) => unknown }).get;
    if (typeof getter === 'function') {
        try { raw = getter.call(headers, 'retry-after'); } catch { /* malformed provider headers */ }
    }
    raw ??= headers['retry-after'] ?? headers['Retry-After'];
    if (typeof raw === 'number') {
        const seconds = finiteNonNegativeNumber(raw);
        return seconds !== undefined ? seconds * 1_000 : undefined;
    }
    if (typeof raw !== 'string') return undefined;
    return finiteNonNegativeNumber(parseRetryAfterMs(raw));
}

/** Rate limits already have a provider-owned retry/wait owner; invoke fallback must not double them. */
export function allowsProviderInvokeFallback(error: unknown): boolean {
    if (classifyProviderRateLimit(error) !== undefined) return false;
    if (getRetryable(error) === false) return false;
    if (defaultProviderHandlerStops(error)) return false;
    return readProviderErrorStatus(error) !== 429;
}

function classifyProviderRateLimit(error: unknown) {
    return classifyRateLimitError(normalizeProviderRetryAfterHeader(error));
}

/** Reuse the SDK's code-based stop classification for errors without an HTTP status. */
function defaultProviderHandlerStops(error: unknown): boolean {
    try {
        defaultRetryPolicy.handle(normalizeProviderRetryAfterHeader(error));
        return false;
    } catch (rejected) {
        return getRetryable(rejected) === false;
    }
}

function normalizeProviderRetryAfterHeader(error: unknown): unknown {
    const record = errorRecord(error);
    normalizeRetryAfterRecord(errorRecord(record?.headers));
    normalizeRetryAfterRecord(errorRecord(errorRecord(record?.response)?.headers));
    return error;
}

function normalizeRetryAfterRecord(headers: Record<string, unknown> | undefined): void {
    if (!headers) return;
    const lowercase = 'retry-after' in headers ? headers['retry-after'] : undefined;
    const capitalized = 'Retry-After' in headers ? headers['Retry-After'] : undefined;
    const raw = lowercase ?? capitalized;
    if (typeof raw !== 'number') return;
    if ('retry-after' in headers) headers['retry-after'] = String(raw);
    else headers['Retry-After'] = String(raw);
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
    const number = finiteNumber(value);
    return number !== undefined && number >= 0 ? number : undefined;
}

function finiteString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

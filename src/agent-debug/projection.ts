import { DEFAULT_DEBUG_BUDGETS, type DebugLineage, type DebugUsage, emptyDebugLineage } from './types';

export interface ProjectedDebugText { text?: string; parts?: string[]; redactions: string[]; reason?: 'capacity' | 'unobservable_body'; }

const SECRET_KEY = /^(?:authorization|proxy-authorization|headers?|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|credential)$/i;
const REASONING_KEY = /^(?:reasoning(?:_content|_details)?|thinking|thoughts?|signature|encrypted_content)$/i;
const REQUEST_KEYS = new Set(['model', 'messages', 'input', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls',
    'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'max_output_tokens', 'stream', 'stream_options',
    'response_format', 'text', 'stop', 'seed', 'frequency_penalty', 'presence_penalty', 'reasoning_effort']);
const MESSAGE_KEYS = new Set(['role', 'content', 'name', 'tool_call_id', 'tool_calls', 'function_call', 'type', 'text',
    'id', 'call_id', 'output', 'arguments', 'function', 'description', 'parameters', 'strict', 'image_url', 'url',
    'detail', 'input_image', 'input_text', 'mime_type', 'file_id', 'file_url', 'file_data']);

function ownData(value: object, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

const CAPACITY = Symbol('debug projection capacity');
interface ProjectionBudget { bytes: number; nodes: number; }
function charge(budget: ProjectionBudget, value: string | number): void {
    if (typeof value === 'string') {
        if (value.length > budget.bytes) throw CAPACITY;
        budget.bytes -= utf8Bytes(value);
    } else budget.bytes -= value;
    if (budget.bytes < 0 || --budget.nodes < 0) throw CAPACITY;
}

/** Credential-bearing protocol fields are filtered; this is not arbitrary-secret detection in user prose. */
export function filterDebugText(text: string): string {
    return text.replace(/data:[^\s"']*;base64,[A-Za-z0-9+/=\r\n]+/gi, '[media omitted]')
        .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[filtered]')
        .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[credential filtered]')
        .replace(/https?:\/\/[^\s"<>]+/gi, (value) => {
            try {
                const url = new URL(value);
                url.username = ''; url.password = '';
                for (const key of [...url.searchParams.keys()]) {
                    if (/token|key|sig(?:nature)?|secret|credential|auth|password/i.test(key)) url.searchParams.set(key, '[filtered]');
                }
                return url.toString();
            } catch { return '[invalid URL]'; }
        });
}

/** Does not invoke getters/toJSON and never preserves unknown provider envelopes. */
function projectValue(value: unknown, redactions: Set<string>, mode: 'request' | 'nested' | 'schema' | 'session', budget: ProjectionBudget, depth = 0): unknown {
    charge(budget, 8);
    if (depth > 24) { redactions.add('depth_limit'); return '[depth limit]'; }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') { charge(budget, value); return filterDebugText(value); }
    if (Array.isArray(value)) {
        if (value.length > 4096) redactions.add('array_limit');
        const result: unknown[] = [];
        for (let index = 0; index < Math.min(value.length, 4096); index++) {
            result.push(projectValue(ownData(value, String(index)), redactions, mode === 'request' ? 'nested' : mode, budget, depth + 1));
        }
        return result;
    }
    if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
        redactions.add('unsupported_value'); return '[unsupported]';
    }
    const result: Record<string, unknown> = {};
    const keys = Object.keys(value);
    if (keys.length > 4096) redactions.add('field_limit');
    for (const key of keys.slice(0, 4096)) {
        charge(budget, key);
        if (SECRET_KEY.test(key)) { redactions.add('credentials'); continue; }
        if (mode !== 'session' && REASONING_KEY.test(key)) { redactions.add('reasoning'); continue; }
        if (/^(?:file_data|data|b64_json|blob|bytes)$/i.test(key)) { redactions.add('media'); continue; }
        if ((mode === 'request' && !REQUEST_KEYS.has(key)) || (mode === 'nested' && !MESSAGE_KEYS.has(key))) {
            redactions.add(`field:${key.slice(0, 80)}`); continue;
        }
        const entry = ownData(value, key);
        if (entry === undefined) { redactions.add('accessor_or_undefined'); continue; }
        if (key === 'type' && typeof entry === 'string' && ['thinking', 'reasoning', 'redacted_thinking'].includes(entry)) {
            redactions.add('reasoning'); return '[reasoning omitted]';
        }
        if (['image_url', 'input_image', 'file_url', 'file_id'].includes(key)) {
            redactions.add('media'); result[key] = '[media reference omitted]'; continue;
        }
        // Tool schemas and arguments contain user-defined keys; secret/reasoning/media filtering still applies.
        const childMode = mode === 'session' ? 'session' : mode === 'schema' || key === 'parameters' ? 'schema' : 'nested';
        if (key === 'arguments' && typeof entry === 'string') {
            if (entry.length > budget.bytes || utf8Bytes(entry) > budget.bytes) throw CAPACITY;
            try { result[key] = projectValue(JSON.parse(entry), redactions, 'schema', budget, depth + 1); }
            catch (error) { if (error === CAPACITY) throw error; charge(budget, entry); result[key] = filterDebugText(entry); }
        } else result[key] = projectValue(entry, redactions, childMode, budget, depth + 1);
    }
    return result;
}

export function projectDebugRequest(body: unknown, maxBytes = DEFAULT_DEBUG_BUDGETS.requestBytes, includeFullText = true): ProjectedDebugText {
    if (typeof body === 'string' && (body.length > maxBytes || utf8Bytes(body) > maxBytes)) return { redactions: [], reason: 'capacity' };
    try {
        const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : body;
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return { redactions: [], reason: 'unobservable_body' };
        const redactions = new Set<string>();
        const projected = projectValue(parsed, redactions, 'request', { bytes: maxBytes, nodes: 16384 });
        const record = projected as Record<string, unknown>;
        const messages = Array.isArray(record.messages) ? record.messages : undefined;
        const parts = messages ? [JSON.stringify({ ...record, messages: '[ordered message blocks below]' }, null, 2),
            ...messages.map(message => JSON.stringify(message, null, 2))] : undefined;
        return { ...(includeFullText || !parts ? { text: JSON.stringify(projected, null, 2) } : {}), parts, redactions: [...redactions] };
    } catch (error) { return { redactions: [], reason: error === CAPACITY ? 'capacity' : 'unobservable_body' }; }
}

export function projectDebugSession(value: unknown, maxBytes = DEFAULT_DEBUG_BUDGETS.contentBytes): ProjectedDebugText {
    const redactions = new Set<string>();
    try {
        const budget = { bytes: maxBytes, nodes: 16384 };
        if (typeof value === 'string') charge(budget, value);
        const text = typeof value === 'string' ? filterDebugText(value) : JSON.stringify(projectValue(value, redactions, 'session', budget));
        if (typeof text !== 'string') return { redactions: [], reason: 'unobservable_body' };
        return utf8Bytes(text) > maxBytes ? { redactions: [...redactions], reason: 'capacity' } : { text, redactions: [...redactions] };
    } catch (error) { return { redactions: [], reason: error === CAPACITY ? 'capacity' : 'unobservable_body' }; }
}

/** Existing prepared-media receipts only; never read a Blob, fetch a URL or hash attachment bytes. */
export function projectDebugAttachments(value: unknown): ProjectedDebugText {
    if (!Array.isArray(value)) return { redactions: [], reason: 'unobservable_body' };
    const entries: Record<string, unknown>[] = [];
    for (const item of value.slice(0, 100)) {
        if (!item || typeof item !== 'object') continue;
        const entry: Record<string, unknown> = { kind: 'image' };
        for (const name of ['assetId', 'contentHash', 'variantHash', 'mime', 'processorVersion', 'policyFingerprint']) {
            const field = ownData(item, name);
            if (typeof field === 'string' && field.length <= 256) entry[name] = filterDebugText(field);
        }
        for (const name of ['ordinal', 'width', 'height', 'byteLength']) {
            const field = ownData(item, name);
            if (typeof field === 'number' && Number.isSafeInteger(field) && field >= 0) entry[name] = field;
        }
        entry.availability = ownData(item, 'availability') === 'provided' ? 'provided' : 'unknown';
        entries.push(entry);
    }
    return { text: JSON.stringify(entries, null, 2), redactions: ['media_payload_omitted'] };
}

export function normalizeDebugUsage(value: unknown): DebugUsage | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const number = (...keys: string[]): number | undefined => {
        for (const key of keys) {
            const entry = ownData(value, key);
            if (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0) return entry;
        }
        return undefined;
    };
    const input = number('input', 'input_tokens', 'prompt_tokens', 'inputTokens');
    const output = number('output', 'output_tokens', 'completion_tokens', 'outputTokens');
    const total = number('total', 'total_tokens', 'totalTokens');
    if (input === undefined && output === undefined && total === undefined) return undefined;
    return { ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}),
        ...(total !== undefined ? { total } : {}), complete: total !== undefined || (input !== undefined && output !== undefined) };
}

export function cloneDebugLineage(value?: Partial<DebugLineage>): DebugLineage {
    const fallback = emptyDebugLineage();
    if (!value) return fallback;
    return { sourceRefs: [...new Set(value.sourceRefs ?? [])], claimIds: [...new Set(value.claimIds ?? [])],
        legacyRecordIds: [...new Set(value.legacyRecordIds ?? [])], conversationIds: [...new Set(value.conversationIds ?? [])],
        possibleDomains: [...new Set(value.possibleDomains ?? fallback.possibleDomains)], completeness: value.completeness ?? 'unknown' };
}

export function utf8Bytes(text: string): number {
    // Avoid allocating an encoded copy of large input merely to enforce a budget.
    let bytes = 0;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code < 0x80) bytes++;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
            && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
        else bytes += 3;
    }
    return bytes;
}

/** A bounded block identity; storage verifies equality before reusing a hash match. */
export function debugBlockKey(text: string): string {
    let left = 2166136261, right = 2246822519;
    for (let index = 0; index < text.length; index++) {
        left = Math.imul(left ^ text.charCodeAt(index), 16777619);
        right = Math.imul(right ^ text.charCodeAt(index), 3266489917);
    }
    return `${(left >>> 0).toString(16)}${(right >>> 0).toString(16)}-${text.length}`;
}

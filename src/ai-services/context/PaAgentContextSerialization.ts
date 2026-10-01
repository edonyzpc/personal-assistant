import { finishContextSteps, prepareContextSteps } from './clone-utils';
import { createCooperativeTask, sortCooperatively } from '../cooperative-task';

const STRING_CHUNK_CHARS = 16_384;
// JSON visits include several cheap steps per field; keep the time budget, avoid a timer per few fields.
const JSON_SLICE_STEPS = 512;

function prepareJsonValue(input: unknown, key: string): unknown {
    if (input && typeof input === 'object' && typeof (input as { toJSON?: unknown }).toJSON === 'function') {
        input = (input as { toJSON(key: string): unknown }).toJSON(key);
    }
    if (input instanceof Number || input instanceof String || input instanceof Boolean) return input.valueOf();
    return input;
}

function omittedJsonValue(input: unknown): boolean {
    return input === undefined || typeof input === 'function' || typeof input === 'symbol';
}

/** JSON's exact escaping/indentation, with long values split before encoding. */
export function* stringifyContextSteps(value: unknown, space = 0): Generator<void, string | undefined, void> {
    const parts: string[] = [];
    const active = new Set<object>();
    const gap = ' '.repeat(Math.min(10, Math.max(0, space)));
    const quoted = function* (text: string): Generator<void, void, void> {
        parts.push('"');
        for (let start = 0; start < text.length;) {
            yield;
            let end = Math.min(text.length, start + STRING_CHUNK_CHARS);
            // Do not turn a valid surrogate pair into two escaped lone surrogates.
            if (end < text.length && text.charCodeAt(end - 1) >= 0xd800
                && text.charCodeAt(end - 1) <= 0xdbff) end--;
            parts.push(JSON.stringify(text.slice(start, end)).slice(1, -1));
            start = end;
        }
        parts.push('"');
    };
    const write = function* (input: unknown, depth: number): Generator<void, void, void> {
        yield;
        if (typeof input === 'string') { yield* quoted(input); return; }
        if (!input || typeof input !== 'object') { parts.push(JSON.stringify(input) ?? 'null'); return; }
        if (active.has(input)) throw new TypeError('Converting circular structure to JSON');
        active.add(input);
        const array = Array.isArray(input);
        parts.push(array ? '[' : '{');
        let count = 0;
        const keys = array ? undefined : Object.keys(input);
        const length = array ? (input as unknown[]).length : keys!.length;
        for (let index = 0; index < length; index++) {
            yield;
            const key = array ? String(index) : keys![index];
            const child = prepareJsonValue((input as Record<string, unknown>)[key], key);
            if (!array && omittedJsonValue(child)) continue;
            if (count++) parts.push(',');
            if (gap) parts.push('\n', gap.repeat(depth + 1));
            if (!array) { yield* quoted(key); parts.push(gap ? ': ' : ':'); }
            yield* write(omittedJsonValue(child) ? null : child, depth + 1);
        }
        if (gap && count > 0) parts.push('\n', gap.repeat(depth));
        parts.push(array ? ']' : '}');
        active.delete(input);
    };
    const root = prepareJsonValue(value, '');
    if (omittedJsonValue(root)) return undefined;
    yield* write(root, 0);
    return parts.join('');
}

export function stringifyContext(value: unknown, space = 0): string | undefined {
    return finishContextSteps(stringifyContextSteps(value, space));
}

export async function stringifyContextAsync(value: unknown, signal?: AbortSignal, space = 0): Promise<string | undefined> {
    return await prepareContextSteps(stringifyContextSteps(value, space), signal, JSON_SLICE_STEPS);
}

/** Same DTO result as JSON.parse(JSON.stringify(value)), without a giant parsing/encoding step. */
export async function cloneContextJsonAsync(value: unknown, signal?: AbortSignal): Promise<unknown> {
    const task = createCooperativeTask(signal, undefined, JSON_SLICE_STEPS);
    const active = new Set<object>();
    const clone = async (input: unknown, key: string): Promise<unknown> => {
        await task.checkpoint();
        input = prepareJsonValue(input, key);
        if (omittedJsonValue(input)) return undefined;
        if (typeof input === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
        if (typeof input === 'number' && !Number.isFinite(input)) return null;
        if (!input || typeof input !== 'object') return input;
        if (active.has(input)) throw new TypeError('Converting circular structure to JSON');
        active.add(input);
        const array = Array.isArray(input);
        const result: unknown[] | Record<string, unknown> = array ? [] : {};
        const keys = array ? undefined : Object.keys(input);
        const length = array ? (input as unknown[]).length : keys!.length;
        for (let index = 0; index < length; index++) {
            await task.checkpoint();
            const childKey = array ? String(index) : keys![index];
            const child = await clone((input as Record<string, unknown>)[childKey], childKey);
            if (array) (result as unknown[]).push(child === undefined ? null : child);
            else if (child !== undefined) Object.defineProperty(result, childKey,
                { value: child, writable: true, enumerable: true, configurable: true });
        }
        active.delete(input);
        return result;
    };
    return await clone(value, '');
}

/** Matches the existing canonical sorter before JSON serialization, including undefined fields. */
export async function canonicalContextJsonAsync(value: unknown, signal?: AbortSignal): Promise<string> {
    return await stringifyContextAsync(await sortContextValueAsync(value, signal), signal) ?? 'null';
}

export async function cloneCanonicalContextJsonAsync(value: unknown, signal?: AbortSignal): Promise<unknown> {
    return await cloneContextJsonAsync(await sortContextValueAsync(value, signal), signal);
}

async function sortContextValueAsync(value: unknown, signal?: AbortSignal): Promise<unknown> {
    const task = createCooperativeTask(signal, undefined, JSON_SLICE_STEPS);
    const active = new Set<object>();
    const sortValue = async (input: unknown): Promise<unknown> => {
        await task.checkpoint();
        if (!input || typeof input !== 'object') return input;
        if (active.has(input)) throw new TypeError('Converting circular structure to JSON');
        active.add(input);
        let result: unknown;
        if (Array.isArray(input)) {
            const array: unknown[] = new Array(input.length);
            for (let index = 0; index < input.length; index++) {
                await task.checkpoint();
                if (index in input) array[index] = await sortValue(input[index]);
            }
            result = array;
        } else {
            const record = Object.create(null) as Record<string, unknown>;
            const keys = await sortCooperatively(Object.keys(input), (left, right) => left === right ? 0 : left < right ? -1 : 1,
                async () => { await task.checkpoint(); });
            for (const key of keys) {
                await task.checkpoint();
                record[key] = await sortValue((input as Record<string, unknown>)[key]);
            }
            result = record;
        }
        active.delete(input);
        return result;
    };
    return await sortValue(value);
}

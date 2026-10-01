import { createAbortError, throwIfAborted } from './chat-utils';

const SLICE_MS = 8;
const SLICE_ITEMS = 64;

/** A local loop budget. Promise/microtask yields alone do not let Obsidian handle input. */
export function createCooperativeTask(signal?: AbortSignal, assertCurrent?: () => void, maxItems = SLICE_ITEMS): {
    checkpoint(force?: boolean): Promise<boolean>;
} {
    let started = now();
    let items = 0;
    const assertActive = () => {
        throwIfAborted(signal);
        assertCurrent?.();
    };
    return {
        async checkpoint(force = false) {
            assertActive();
            if (!force && ++items < maxItems && now() - started < SLICE_MS) return false;
            await new Promise<void>((resolve, reject) => {
                const onAbort = () => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', onAbort);
                    reject(createAbortError());
                };
                const timer = setTimeout(() => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve();
                }, 0);
                signal?.addEventListener('abort', onAbort, { once: true });
                if (signal?.aborted) onAbort();
            });
            assertActive();
            started = now();
            items = 0;
            return true;
        },
    };
}

function now(): number {
    return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** Small native sorts, followed by yielding merges, preserve complete ordering. */
export async function sortCooperatively<T>(
    values: readonly T[], compare: (left: T, right: T) => number, checkpoint: () => Promise<void>,
): Promise<T[]> {
    let runs: T[][] = [];
    for (let offset = 0; offset < values.length; offset += 64) {
        await checkpoint();
        runs.push(values.slice(offset, offset + 64).sort(compare));
    }
    while (runs.length > 1) {
        const merged: T[][] = [];
        for (let run = 0; run < runs.length; run += 2) {
            const left = runs[run]!;
            const right = runs[run + 1];
            if (!right) { merged.push(left); continue; }
            const result: T[] = [];
            let a = 0, b = 0;
            while (a < left.length || b < right.length) {
                await checkpoint();
                if (b === right.length || a < left.length && compare(left[a]!, right[b]!) <= 0) result.push(left[a++]!);
                else result.push(right[b++]!);
            }
            merged.push(result);
        }
        runs = merged;
    }
    return runs[0] ?? [];
}

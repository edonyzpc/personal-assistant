import { getPlatformCrypto } from "./platform-dom";
import { createCooperativeTask } from "./ai-services/cooperative-task";
import { throwIfAborted } from "./ai-services/chat-utils";

const HASH_ENCODING_CHUNK_CHARS = 16_384;

export type DirtyTimestamps = {
    first: number; // first time the file was marked dirty after last flush
    last: number;  // most recent time the file was marked dirty
    epoch?: number; // monotonic in-memory guard used to avoid clearing newer dirty work
};

export const computeContentHash = async (input: string, signal?: AbortSignal): Promise<string> => {
    throwIfAborted(signal);
    const subtle = getPlatformCrypto()?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto is required to compute VSS content hashes.');
    }

    const task = createCooperativeTask(signal);
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for (let start = 0; start < input.length;) {
        await task.checkpoint();
        let end = Math.min(input.length, start + HASH_ENCODING_CHUNK_CHARS);
        // Encoding two halves separately would replace a valid pair with two U+FFFDs.
        if (end < input.length && input.charCodeAt(end - 1) >= 0xd800
            && input.charCodeAt(end - 1) <= 0xdbff
            && input.charCodeAt(end) >= 0xdc00 && input.charCodeAt(end) <= 0xdfff) end--;
        const chunk = encoder.encode(input.slice(start, end));
        chunks.push(chunk);
        byteLength += chunk.byteLength;
        start = end;
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        await task.checkpoint();
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    throwIfAborted(signal);
    const digest = await subtle.digest('SHA-1', bytes);
    throwIfAborted(signal);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};

export const selectFlushCandidates = (
    dirty: Map<string, DirtyTimestamps>,
    now: number,
    quietWindow: number,
    maxDelay: number,
    limit: number,
): string[] => {
    const result: string[] = [];
    for (const [path, ts] of dirty.entries()) {
        if (result.length >= limit) break;
        const idleSinceLastUpdate = now - ts.last;
        const dirtyDuration = now - ts.first;
        if (idleSinceLastUpdate >= quietWindow || dirtyDuration >= maxDelay) {
            result.push(path);
        }
    }
    return result;
};

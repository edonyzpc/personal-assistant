import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

const source = readFileSync(resolve(__dirname, '../scripts/prototypes/b129-resource-probe.js'), 'utf8');
// Header-only JPEG-like input is sufficient for mocked decode lifecycle; it is
// deliberately not presented as an actual decodable media fixture.
const fixture = new Uint8Array([255, 216, 255, 192, 0, 17, 8, 1, 224, 2, 128,
    3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
// Offline lifecycle tests use fake pixels. Real decoder/storage observations
// come only from the independently persisted Obsidian host receipts.
function harness(options: { manualDecode?: boolean; manualEncode?: boolean; blob?: NodeBlob | null; process?: any } = {}) {
    const urls = new Set<string>();
    const images: any[] = [];
    const canvases: any[] = [];
    const callbacks: Array<(blob: NodeBlob | null) => void> = [];
    const sandbox: any = {
        Uint8Array, ArrayBuffer, DataView, Map, Set, Blob: NodeBlob, AbortController,
        performance: { now: () => Date.now() }, process: options.process,
        setTimeout, clearTimeout, setInterval, clearInterval,
        URL: {
            createObjectURL: () => { const url = `blob:test-${images.length}`; urls.add(url); return url; },
            revokeObjectURL: (url: string) => urls.delete(url),
        },
        Image: class {
            naturalWidth = 480;
            naturalHeight = 640;
            onload?: (() => void) | null;
            onerror?: (() => void) | null;
            value = '';
            constructor() { images.push(this); }
            set src(value: string) { this.value = value; if (value && !options.manualDecode) this.onload?.(); }
            get src() { return this.value; }
        },
        document: { createElement: (tag: string) => {
            if (tag !== 'canvas') throw new Error('unexpected DOM');
            const canvas = { width: 0, height: 0,
                getContext: () => ({ fillRect() {}, drawImage() {} }),
                toBlob: (callback: (value: NodeBlob | null) => void) => {
                    callbacks.push(callback);
                    if (!options.manualEncode) callback(options.blob === undefined ? new NodeBlob([new Uint8Array(100)], { type: 'image/jpeg' }) : options.blob);
                },
            };
            canvases.push(canvas);
            return canvas;
        } },
    };
    runInNewContext(source, sandbox);
    const api = sandbox.b129ResourceProbeInternals;
    const state = api.resources();
    const bytes = Uint8Array.from(fixture).buffer;
    return { api, state, bytes, urls, images, canvases, callbacks, sandbox };
}
function released(h: ReturnType<typeof harness>) {
    expect(h.urls.size).toBe(0);
    expect(h.images.every((image) => image.src === '' && image.onload === null && image.onerror === null)).toBe(true);
    expect(h.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(h.state).toMatchObject({ activeImages: 0, activeCanvases: 0, activeUrls: 0 });
    expect(jest.getTimerCount()).toBe(0);
}
afterEach(() => { jest.useRealTimers(); });

describe('B-129 resource prototype lifecycle and admissions', () => {
    it('rejects an already cancelled task without allocating decoder resources', async () => {
        jest.useFakeTimers();
        const h = harness();
        const controller = new AbortController(); controller.abort();
        await expect(h.api.processImage(h.bytes, { signal: controller.signal, state: h.state })).rejects.toThrow('cancelled');
        expect(h.images).toHaveLength(0);
        released(h);
    });

    it('cancels an outstanding decode and ignores a previously captured late callback', async () => {
        jest.useFakeTimers();
        const h = harness({ manualDecode: true });
        const controller = new AbortController();
        const pending = h.api.processImage(h.bytes, { signal: controller.signal, state: h.state });
        const result = expect(pending).rejects.toThrow('cancelled');
        const late = h.images[0].onload;
        controller.abort(); await result;
        late();
        expect(h.canvases).toHaveLength(0);
        released(h);
    });

    it('times out a missing encode callback and ignores completion after cleanup', async () => {
        jest.useFakeTimers();
        const h = harness({ manualEncode: true });
        const pending = h.api.processImage(h.bytes, { timeoutMs: 25, state: h.state });
        const outcome = expect(pending).rejects.toThrow('processing_timeout');
        jest.advanceTimersByTime(25); await outcome;
        released(h);
        h.callbacks[0](new NodeBlob(['late'], { type: 'image/jpeg' }));
        released(h);
    });

    it.each([null, new NodeBlob(['png'], { type: 'image/png' })])('rejects absent or mismatched output MIME and releases every allocation', async (blob) => {
        jest.useFakeTimers();
        const h = harness({ blob });
        await expect(h.api.processImage(h.bytes, { state: h.state })).rejects.toThrow('unexpected_output_mime');
        released(h);
    });

    it('reads JPEG dimensions before decoding and rejects byte/pixel budgets without starting Image', () => {
        jest.useFakeTimers();
        const h = harness();
        expect(h.api.dimensions(h.bytes)).toEqual({ width: 640, height: 480, mime: 'image/jpeg' });
        expect(() => h.api.processImage(h.bytes, { policy: { ...h.api.candidates, maxOriginalBytes: h.bytes.byteLength - 1 } })).toThrow('original_byte_budget');
        expect(() => h.api.processImage(h.bytes, { policy: { ...h.api.candidates, maxDecodedPixels: 640 * 480 - 1 } })).toThrow('decoded_pixel_budget');
        expect(h.images).toHaveLength(0);
        released(h);
    });

    it('enforces encoded output budget after releasing the real processing references', async () => {
        jest.useFakeTimers();
        const h = harness();
        await expect(h.api.processImage(h.bytes, { state: h.state, policy: { ...h.api.candidates, maxVariantBytes: 50 } })).rejects.toThrow('variant_byte_budget');
        released(h);
    });

    it('processes a batch serially and rejects aggregate overflow before starting a later image', async () => {
        const h = harness();
        const releases: Array<(result: any) => void> = [];
        const started: number[] = [];
        const pending = h.api.serialBatch([1, 2, 3], (item: number) => {
            started.push(item);
            return new Promise((resolve) => releases.push(resolve));
        }, { ...h.api.candidates, maxRequestImageBytes: 3 });
        const rejected = expect(pending).rejects.toThrow('request_image_byte_budget');
        expect(started).toEqual([1]);
        releases[0]({ blob: new NodeBlob(['ab']) });
        for (let turn = 0; turn < 10 && started.length < 2; turn++) await Promise.resolve();
        expect(started).toEqual([1, 2]);
        releases[1]({ blob: new NodeBlob(['cd']) });
        await rejected;
        expect(started).toEqual([1, 2]);
    });

    it('checks image count before executing any decoder', async () => {
        const h = harness();
        const processOne = jest.fn();
        await expect(h.api.serialBatch(Array(9), processOne)).rejects.toThrow('image_count_budget');
        expect(processOne).not.toHaveBeenCalled();
    });

    it('evicts oldest unleased entries while protecting an active lease and refusing an all-leased overflow', () => {
        const h = harness();
        const entries = new Map([['a', { bytes: 4, used: 1 }], ['b', { bytes: 4, used: 2 }], ['c', { bytes: 4, used: 3 }]]);
        expect(h.api.evictionPlan(entries, new Set(['a']), 8, 12)).toEqual({ evict: ['b', 'c'], bytesAfter: 12 });
        expect(() => h.api.evictionPlan(entries, new Set(['a', 'b', 'c']), 4, 12)).toThrow('cache_all_entries_leased');
        expect(entries.size).toBe(3);
    });

    it('requires the held native encode callback to actually arrive before asserting late replay', async () => {
        jest.useFakeTimers();
        const h = harness({ manualEncode: true });
        let finished = false;
        const pending = h.api.heldEncodeTimeout(h.bytes, h.state, 25).then((value: unknown) => { finished = true; return value; });
        await jest.advanceTimersByTimeAsync(100);
        expect(finished).toBe(false);
        expect(h.state.activeCanvases).toBe(0);
        h.callbacks[0](new NodeBlob(['actual held result'], { type: 'image/jpeg' }));
        await jest.advanceTimersByTimeAsync(10);
        await expect(pending).resolves.toMatchObject({ lateCallbackObserved: true, lateCallbackReplayed: true, lateIgnored: true });
        released(h);
    });

    it('fails rather than claiming late callback coverage when no callback is ever observed', async () => {
        jest.useFakeTimers();
        const h = harness({ manualEncode: true });
        const pending = expect(h.api.heldEncodeTimeout(h.bytes, h.state, 25)).rejects.toThrow('late_encode_callback_not_observed');
        await jest.advanceTimersByTimeAsync(15100);
        await pending;
        released(h);
    });

    it('rejects cache receipts when storage retains an evicted key or changes the leased bytes on reopen', () => {
        const h = harness();
        const expected = new Map([['variant-0', { bytes: 4 }], ['variant-3', { bytes: 4 }]]);
        const rows = [{ id: 'variant-0', storedBytes: 4, blobBytes: 4 }, { id: 'variant-3', storedBytes: 4, blobBytes: 4 }];
        expect(h.api.verifyCacheSnapshot(rows, expected, 'original', 'original')).toMatchObject({ count: 2, blobBytes: 8, persistedHashMatch: true });
        expect(() => h.api.verifyCacheSnapshot([...rows, { id: 'variant-1', storedBytes: 4, blobBytes: 4 }], expected, 'original', 'original')).toThrow('persisted_lru_keys_match');
        expect(() => h.api.verifyCacheSnapshot(rows, expected, 'original', 'corrupted')).toThrow('blob_bytes_survive_close_reopen');
        expect(() => h.api.verifyCacheSnapshot([{ ...rows[0], blobBytes: 2 }, rows[1]], expected, 'original', 'original')).toThrow('persisted_lru_capacity_match');
    });

    it('bounds a stuck native memory sampler and does not alter the final sample when it resolves late', async () => {
        jest.useFakeTimers();
        let resolveMemory!: (value: unknown) => void;
        const memory = new Promise((resolve) => { resolveMemory = resolve; });
        const h = harness({ process: { getProcessMemoryInfo: () => memory } });
        const sampler = h.api.memorySampler();
        const stopped = sampler.stop();
        await jest.advanceTimersByTimeAsync(4100);
        const report = await stopped;
        expect(report.sampledMaxProcessPrivateKiB).toBeNull();
        const before = JSON.stringify(report);
        resolveMemory({ private: 99999 });
        await Promise.resolve(); await Promise.resolve();
        expect(JSON.stringify(report)).toBe(before);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('refuses to run against a non-test vault before any storage access', async () => {
        const h = harness();
        const exists = jest.fn();
        await expect(h.sandbox.runB129ResourceProbe({ vault: { getName: () => 'private-vault', adapter: { exists } } }, { runId: 'no' })).rejects.toThrow('test_vault_required');
        expect(exists).not.toHaveBeenCalled();
    });
});

import { createHash } from 'node:crypto';
import { ImageProcessor, IMAGE_POLICY, imagePolicyFingerprint } from '../src/chat/image-processor';
import { getPlatformDocument } from '../src/platform-dom';
import { inspectImage } from '../src/chat/image-format';

jest.mock('../src/platform-dom', () => ({ getPlatformDocument: jest.fn() }));
jest.mock('../src/chat/image-macos-converter', () => ({ convertMacOsHeicToPng: jest.fn() }));
import { convertMacOsHeicToPng } from '../src/chat/image-macos-converter';
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !check(); i++) await tick();
    expect(check()).toBe(true);
}
function jpeg(width = 640, height = 480): ArrayBuffer {
    return Uint8Array.from([255, 216, 255, 192, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 255, 217]).buffer;
}

// This deterministic DOM harness tests orchestration, budgets and cleanup only.
// It does not simulate pixels, browser codec support or actual image quality.
function browserHarness(options: { holdEncode?: boolean; wrongMime?: boolean; hugeOutput?: boolean; rotateSource?: boolean;
    canvasThrows?: boolean; outputWrongSize?: boolean; failDecode?: boolean } = {}) {
    const urls = new Map<string, Blob>();
    const callbacks: Array<() => void> = [];
    const canvases: any[] = [];
    const context = { fillStyle: '', fillRect: jest.fn(), drawImage: jest.fn() };
    let id = 0, active = 0, peak = 0, loadCount = 0;
    const encode = jest.fn();
    const create = jest.fn((blob: Blob) => { const url = `blob:test-${++id}`; urls.set(url, blob); active++; peak = Math.max(active, peak); return url; });
    const revoke = jest.fn((url: string) => { if (urls.delete(url)) active--; });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    (getPlatformDocument as jest.Mock).mockReturnValue({ createElement: (tag: string) => {
        if (tag === 'img') {
            const image: any = { naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null };
            Object.defineProperty(image, 'src', { set: (url: string) => {
                const blob = urls.get(url); if (!blob) return;
                const sequence = ++loadCount;
                void blob.arrayBuffer().then((data) => {
                    if (options.failDecode) { image.onerror?.(); return; }
                    const info = inspectImage(data);
                    image.naturalWidth = options.rotateSource && sequence === 1 ? info.height : info.width;
                    image.naturalHeight = options.rotateSource && sequence === 1 ? info.width : info.height;
                    image.onload?.();
                });
            } });
            return image;
        }
        if (options.canvasThrows) throw new Error('canvas unavailable');
        const canvas = { width: 0, height: 0, getContext: () => context, toBlob(callback: (blob: Blob) => void, mime: string, quality: number) {
            encode(mime, quality, canvas.width, canvas.height);
            const data = jpeg(options.outputWrongSize ? 1 : canvas.width, canvas.height);
            const blob = new Blob([data, ...(options.hugeOutput ? [new Uint8Array(IMAGE_POLICY.maxVariantBytes)] : [])],
                { type: options.wrongMime ? 'image/png' : mime });
            if (options.holdEncode) callbacks.push(() => callback(blob)); else queueMicrotask(() => callback(blob));
        } };
        canvases.push(canvas); return canvas;
    } });
    return { callbacks, canvases, context, encode, create, revoke, urls, active: () => active, peak: () => peak, loadCount: () => loadCount };
}

describe('production local ImageProcessor', () => {
    const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const savedCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const savedRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    let processor: ImageProcessor;
    beforeEach(() => {
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest: async (_algorithm: string, data: ArrayBuffer) =>
            Uint8Array.from(createHash('sha256').update(new Uint8Array(data)).digest()).buffer } } });
        processor = new ImageProcessor({ vault: {} } as any);
    });
    afterEach(async () => {
        await processor.dispose(); jest.useRealTimers();
        for (const [owner, key, descriptor] of [[globalThis, 'crypto', savedCrypto], [URL, 'createObjectURL', savedCreate], [URL, 'revokeObjectURL', savedRevoke]] as const) {
            if (descriptor) Object.defineProperty(owner, key, descriptor); else delete (owner as any)[key];
        }
    });
    it.each([['preview', 1536, 1152], ['provider', 3200, 2400], ['note', 8000, 6000]] as const)(
        'creates independent %s output without silently sharing a smaller variant', async (purpose, width, height) => {
            const dom = browserHarness(); const source = jpeg(8000, 6000), original = source.slice(0);
            const result = await processor.process(source, { purpose });
            expect(result).toMatchObject({ width, height, mime: 'image/jpeg', sourceMime: 'image/jpeg',
                sourceHash: createHash('sha256').update(new Uint8Array(original)).digest('hex'), policyFingerprint: imagePolicyFingerprint(purpose) });
            expect(source).toEqual(original); expect(dom.encode).toHaveBeenCalledWith('image/jpeg', 0.9, width, height);
            expect(dom.context.fillStyle).toBe('#ffffff'); expect(dom.context.fillRect).toHaveBeenCalledWith(0, 0, width, height);
            expect(dom.context.drawImage).toHaveBeenCalledTimes(1); expect(dom.peak()).toBe(1); expect(dom.active()).toBe(0);
            expect(dom.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
        });
    it('does not upscale, and uses the native decoder orientation exactly once', async () => {
        const dom = browserHarness({ rotateSource: true });
        await expect(processor.process(jpeg(), { purpose: 'provider' })).resolves.toMatchObject({ width: 480, height: 640 });
        expect(dom.encode).toHaveBeenCalledWith('image/jpeg', 0.9, 480, 640);
    });
    it('fails native-size note encoding above 4 MiB, retaining the source without a 3200px retry', async () => {
        const dom = browserHarness({ hugeOutput: true }); const source = jpeg(8000, 6000), original = source.slice(0);
        await expect(processor.process(source, { purpose: 'note' })).rejects.toMatchObject({ code: 'output-byte-limit' });
        expect(dom.encode).toHaveBeenCalledTimes(1); expect(dom.encode).toHaveBeenCalledWith('image/jpeg', 0.9, 8000, 6000);
        expect(source).toEqual(original); expect(dom.active()).toBe(0);
    });
    it('rejects source byte/pixel budgets before creating any image or canvas', async () => {
        const dom = browserHarness();
        await expect(processor.process(new ArrayBuffer(IMAGE_POLICY.maxOriginalBytes + 1), { purpose: 'note' })).rejects.toMatchObject({ code: 'original-byte-limit' });
        await expect(processor.process(jpeg(8001, 6000), { purpose: 'note' })).rejects.toMatchObject({ code: 'pixel-limit' });
        expect(dom.create).not.toHaveBeenCalled(); expect(dom.encode).not.toHaveBeenCalled();
    });
    it.each(['preview', 'provider', 'note'] as const)('rejects HEIC %s before any decoder or converter runs', async (purpose) => {
        const dom = browserHarness();
        // Identifiable HEIC with no item metadata must fail at the format boundary.
        const source = Uint8Array.from([0, 0, 0, 20, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1')]).buffer;
        const original = source.slice(0);
        await expect(processor.process(source, { purpose, originalPath: 'pa-images/disguised.jpg' }))
            .rejects.toMatchObject({ code: 'heic-unsupported' });
        expect(dom.create).not.toHaveBeenCalled();
        expect(dom.encode).not.toHaveBeenCalled();
        expect(convertMacOsHeicToPng).not.toHaveBeenCalled();
        expect(source).toEqual(original);
    });
    it('accepts delivered JPEG bytes even if the source path retains a HEIC extension', async () => {
        const dom = browserHarness();
        await expect(processor.process(jpeg(), { purpose: 'preview', originalPath: 'pa-images/photo.heic' }))
            .resolves.toMatchObject({ sourceMime: 'image/jpeg', mime: 'image/jpeg' });
        expect(dom.encode).toHaveBeenCalledTimes(1);
        expect(convertMacOsHeicToPng).not.toHaveBeenCalled();
    });
    it('serializes jobs and cancels a queued job without starting a second decoder', async () => {
        const dom = browserHarness({ holdEncode: true }); const first = processor.process(jpeg(), { purpose: 'provider' });
        const abort = new AbortController(); const second = processor.process(jpeg(), { purpose: 'preview', signal: abort.signal });
        const rejected = expect(second).rejects.toMatchObject({ code: 'cancelled' });
        await until(() => dom.callbacks.length === 1); abort.abort(); await rejected;
        expect(dom.encode).toHaveBeenCalledTimes(1); dom.callbacks.shift()!(); await first;
        expect(dom.peak()).toBe(1); expect(dom.active()).toBe(0);
    });
    it('takes a source snapshot before a queued caller can modify its ArrayBuffer', async () => {
        const dom = browserHarness({ holdEncode: true }); const source = jpeg();
        const expectedHash = createHash('sha256').update(new Uint8Array(source)).digest('hex');
        const result = processor.process(source, { purpose: 'preview' }); new Uint8Array(source).fill(0);
        await until(() => dom.callbacks.length === 1); dom.callbacks.shift()!();
        await expect(result).resolves.toMatchObject({ sourceHash: expectedHash });
    });
    it('dispose rejects active/queued work, clears resources, and discards late encoding completion', async () => {
        const dom = browserHarness({ holdEncode: true }); const first = processor.process(jpeg(), { purpose: 'provider' });
        const second = processor.process(jpeg(), { purpose: 'preview' });
        const settled = Promise.all([expect(first).rejects.toMatchObject({ code: 'disposed' }), expect(second).rejects.toMatchObject({ code: 'disposed' })]);
        await until(() => dom.callbacks.length === 1); await processor.dispose(); await settled;
        dom.callbacks.shift()!(); await tick();
        expect(dom.active()).toBe(0); expect(dom.encode).toHaveBeenCalledTimes(1);
        expect(dom.canvases[0]).toMatchObject({ width: 0, height: 0 });
        await expect(processor.process(jpeg(), { purpose: 'preview' })).rejects.toMatchObject({ code: 'disposed' });
    });
    it('times out an active encoder at 15 seconds and ignores its late callback', async () => {
        const dom = browserHarness({ holdEncode: true }); jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask'] });
        const result = processor.process(jpeg(), { purpose: 'provider' });
        const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' });
        await until(() => dom.callbacks.length === 1); jest.advanceTimersByTime(15_000); await rejected;
        dom.callbacks.shift()!(); expect(dom.active()).toBe(0); expect(dom.canvases[0]).toMatchObject({ width: 0, height: 0 });
    });
    it.each([{ wrongMime: true }, { outputWrongSize: true }])('rejects an invalid encoded output %s', async (config) => {
        const dom = browserHarness(config);
        await expect(processor.process(jpeg(), { purpose: 'provider' })).rejects.toMatchObject({ code: 'encode-failed' });
        expect(dom.active()).toBe(0);
    });
    it('releases a decoded source if canvas creation throws', async () => {
        const dom = browserHarness({ canvasThrows: true });
        await expect(processor.process(jpeg(), { purpose: 'provider' })).rejects.toThrow('canvas unavailable');
        expect(dom.active()).toBe(0); expect(dom.revoke).toHaveBeenCalledTimes(1);
    });
    it('rejects an undecodable static file without changing it', async () => {
        const dom = browserHarness({ failDecode: true }); const source = jpeg(), original = source.slice(0);
        await expect(processor.process(source, { purpose: 'provider' })).rejects.toMatchObject({ code: 'decode-failed' });
        expect(source).toEqual(original); expect(dom.active()).toBe(0); expect(dom.encode).not.toHaveBeenCalled();
    });
    it('checks lifecycle currentness after the asynchronous encoder completes', async () => {
        const dom = browserHarness({ holdEncode: true }); let current = true;
        const result = processor.process(jpeg(), { purpose: 'provider', isCurrent: () => current });
        const rejected = expect(result).rejects.toMatchObject({ code: 'stale' });
        await until(() => dom.callbacks.length === 1); current = false; dom.callbacks.shift()!(); await rejected;
        expect(dom.active()).toBe(0); expect(dom.loadCount()).toBe(1);
    });
});

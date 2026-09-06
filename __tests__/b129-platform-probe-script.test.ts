import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from '@jest/globals';

const source = readFileSync(resolve(__dirname, '../scripts/prototypes/b129-platform-probe.js'), 'utf8');

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function until(predicate: () => boolean) {
    for (let index = 0; index < 2000 && !predicate(); index++) await Promise.resolve();
    expect(predicate()).toBe(true);
}

/** All host I/O and pixels are fake. These tests assert lifecycle, never decoder support. */
function harness(options: { resources?: boolean; holdCanvasIndex?: number } = {}) {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const hash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
    const fixtures = [{ filename: 'synthetic.png', format: 'PNG', frames: 1, sha256: hash },
        ...(options.resources ? [{ filename: 'resource.jpg', format: 'JPEG', frames: 1, sha256: hash, megapixels: 12 }] : [])];
    const files = new Map<string, string | ArrayBuffer>([
        ['b129-p0-fixtures/manifest.json', JSON.stringify({ fixtures })],
        ['b129-p0-fixtures/synthetic.png', bytes],
        ...(options.resources ? [['b129-p0-fixtures/resource.jpg', bytes] as [string, ArrayBuffer]] : []),
    ]);
    const folders = new Set<string>();
    const writes: Array<{ path: string; value: any }> = [];
    const created: string[] = [];
    let setting = 'original-attachments';
    let serial = 0;
    const timeouts = new Map<number, { callback: () => void; delay: number }>();
    const intervals = new Map<number, () => void>();
    const objectUrls = new Set<string>();
    const releasedUrls: string[] = [];
    const images: Array<{ src: string }> = [];
    const canvases: any[] = [];
    const heldCallbacks: Array<() => void> = [];
    let memoryCalls = 0;
    const sample = deferred<{ residentSet: number }>();
    const create = async (path: string, value: string | ArrayBuffer) => {
        if (files.has(path)) throw new Error('fixture refuses file overwrite');
        files.set(path, value);
        created.push(path);
        return { path };
    };
    const app = {
        vault: {
            getName: () => 'test',
            adapter: {
                exists: async (path: string) => files.has(path) || folders.has(path),
                read: async (path: string) => {
                    if (typeof files.get(path) !== 'string') throw new Error('unexpected fixture read');
                    return files.get(path);
                },
                readBinary: async (path: string) => {
                    const value = files.get(path);
                    if (!(value instanceof ArrayBuffer)) throw new Error('unexpected binary read');
                    return value;
                },
                write: async (path: string, value: string) => {
                    files.set(path, value);
                    writes.push({ path, value: JSON.parse(value) });
                },
            },
            createFolder: async (path: string) => { folders.add(path); },
            createBinary: create,
            create,
            getConfig: () => setting,
            setConfig: (_key: string, value: string) => { setting = value; },
        },
        fileManager: {
            // Deliberately not a simulation of Obsidian's path rules: only unique fake I/O.
            getAvailablePathForAttachment: async (name: string) => `mock-attachments/${name}`,
            generateMarkdownLink: (file: { path: string }) => `[[${file.path}]]`,
        },
        plugins: { plugins: {} },
    };
    const sandbox: any = {
        app, TextEncoder, Uint8Array, ArrayBuffer,
        crypto: { subtle: { digest: async (_algorithm: string, value: ArrayBuffer) =>
            Uint8Array.from(createHash('sha256').update(new Uint8Array(value)).digest()).buffer } },
        navigator: { userAgent: 'synthetic lifecycle test; no platform evidence' },
        performance: { now: () => 0, memory: { usedJSHeapSize: 1 } },
        process: { getProcessMemoryInfo: () => ++memoryCalls === 2
            ? sample.promise : Promise.resolve({ residentSet: memoryCalls }) },
        setTimeout: (callback: () => void, delay: number) => {
            const id = ++serial; timeouts.set(id, { callback, delay }); return id;
        },
        clearTimeout: (id: number) => { timeouts.delete(id); },
        setInterval: (callback: () => void) => {
            const id = ++serial; intervals.set(id, callback); return id;
        },
        clearInterval: (id: number) => { intervals.delete(id); },
        Blob: class { constructor(_parts: unknown[], _options: unknown) {} },
        URL: {
            createObjectURL: () => { const url = `blob:synthetic-${++serial}`; objectUrls.add(url); return url; },
            revokeObjectURL: (url: string) => { objectUrls.delete(url); releasedUrls.push(url); },
        },
        Image: class {
            naturalWidth = 2;
            naturalHeight = 2;
            onload?: () => void;
            value = '';
            constructor() { images.push(this); }
            get src() { return this.value; }
            set src(value: string) { this.value = value; if (value) this.onload?.(); }
        },
        document: { createElement: (tag: string) => {
            if (tag !== 'canvas') throw new Error('unexpected DOM surface');
            const index = canvases.length;
            const canvas = { width: 0, height: 0,
                getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [0, 0, 0, 0] }) }),
                toBlob: (callback: (value: unknown) => void, type: string) => {
                    const finish = () => callback({ type, arrayBuffer: async () => bytes });
                    if (index === options.holdCanvasIndex) heldCallbacks.push(finish);
                    else finish();
                },
            };
            canvases.push(canvas);
            return canvas;
        } },
    };
    runInNewContext(source, sandbox);
    let settled = false;
    const running = sandbox.runB129PlatformProbe(app, { runId: 'lifecycle-test' })
        .then((result: unknown) => { settled = true; return result; });
    return { sandbox, running, settled: () => settled, setting: () => setting,
        timeouts, intervals, objectUrls, releasedUrls, images, canvases, heldCallbacks,
        writes, created, sample, memoryCalls: () => memoryCalls };
}

function expectReleased(probe: ReturnType<typeof harness>) {
    expect(probe.timeouts.size).toBe(0);
    expect(probe.intervals.size).toBe(0);
    expect(probe.objectUrls.size).toBe(0);
    expect(probe.images.every((image) => image.src === '')).toBe(true);
    expect(probe.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(probe.releasedUrls).toHaveLength(probe.canvases.length);
    expect(probe.setting()).toBe('original-attachments');
}

describe('B-129 platform probe lifecycle, offline only', () => {
    it('times out missing toBlob callbacks, releases resources, and ignores a callback arriving after the receipt', async () => {
        const probe = harness({ holdCanvasIndex: 0 });
        await until(() => probe.heldCallbacks.length === 1);
        expect(probe.timeouts.size).toBe(1);
        const [id, timer] = [...probe.timeouts][0];
        expect(timer.delay).toBe(15000);
        probe.timeouts.delete(id);
        timer.callback();
        await until(probe.settled);
        await probe.running;
        expect(probe.sandbox.b129PlatformReceipt.formats[0]).toMatchObject({
            status: 'decode_failed', error: 'encode_timeout_15s',
        });
        expect(probe.created.some((path) => path.endsWith('.processed.png'))).toBe(false);
        expectReleased(probe);
        const writeCount = probe.writes.length;
        probe.heldCallbacks[0]();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(probe.writes).toHaveLength(writeCount);
        expectReleased(probe);
    });

    it.each(['resolve', 'reject'] as const)('settles a late %s sample before persisting a resource case and leaves no asynchronous writes', async (outcome) => {
        const unhandled: unknown[] = [];
        const onUnhandled = (error: unknown) => { unhandled.push(error); };
        process.on('unhandledRejection', onUnhandled);
        try {
            const probe = harness({ resources: true, holdCanvasIndex: 1 });
            await until(() => probe.heldCallbacks.length === 1);
            expect(probe.intervals.size).toBe(1);
            [...probe.intervals.values()][0]();
            await until(() => probe.memoryCalls() === 2);
            probe.heldCallbacks[0]();
            await until(() => probe.intervals.size === 0);
            // The resource processing finished, but final receipt/next case must await this sample.
            expect(probe.settled()).toBe(false);
            expect(probe.canvases).toHaveLength(2);
            expect(probe.writes.every(({ value }) => value.resources.length === 0)).toBe(true);
            if (outcome === 'resolve') probe.sample.resolve({ residentSet: 999 });
            else probe.sample.reject(new Error('synthetic memory sampling failure'));
            await until(probe.settled);
            await probe.running;
            const receipt = probe.writes.at(-1)!.value;
            expect(receipt.resources).toHaveLength(3);
            expect(receipt.resources[0].samples).toContainEqual(outcome === 'resolve'
                ? { jsHeapBytes: 1, processKiB: { residentSet: 999 } }
                : { sampleError: 'synthetic memory sampling failure' });
            const lastSnapshot = JSON.stringify(receipt);
            const writeCount = probe.writes.length;
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(unhandled).toEqual([]);
            expect(probe.writes).toHaveLength(writeCount);
            expect(JSON.stringify(probe.sandbox.b129PlatformReceipt)).toBe(lastSnapshot);
            expectReleased(probe);
        } finally { process.removeListener('unhandledRejection', onUnhandled); }
    });
});

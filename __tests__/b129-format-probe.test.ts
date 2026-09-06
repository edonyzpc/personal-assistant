import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, jest, afterEach } from '@jest/globals';

const source = readFileSync(resolve(__dirname, '../scripts/prototypes/b129-format-probe.js'), 'utf8');
const bytes = (value: string) => new TextEncoder().encode(value);
const word = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
const box = (name: string, content: Uint8Array) => Buffer.concat([word(content.length + 8), Buffer.from(name), content]);
const png = (animated = false) => Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    ...(animated ? [word(8), Buffer.from('acTL'), word(2), word(0), word(0)] : []), word(0), Buffer.from('IEND'), word(0)]);
const singleGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const gifFrame = singleGif.subarray(19, singleGif.length - 1);
const animatedGif = Buffer.concat([singleGif.subarray(0, -1), gifFrame, Buffer.from([0x3b])]);
function webp(animated = false) {
    const chunk = (name: string, body: number[]) => {
        const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
        return Buffer.concat([Buffer.from(name), size, Buffer.from(body), ...(body.length % 2 ? [Buffer.from([0])] : [])]);
    };
    const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', [animated ? 2 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        ...(animated ? [chunk('ANMF', [0, 0])] : [])]);
    const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
    return Buffer.concat([Buffer.from('RIFF'), size, body]);
}
function heic(count = 1, sequence = false) {
    const items = Array.from({ length: count }, (_, i) => box('infe', Buffer.concat([
        Buffer.from([2, 0, 0, 0, 0, i + 1, 0, 0]), Buffer.from('hvc1'), Buffer.from([0]),
    ])));
    return Buffer.concat([box('ftyp', Buffer.concat([Buffer.from(sequence ? 'hevc' : 'heic'), word(0), Buffer.from('mif1heic')])),
        box('meta', Buffer.concat([word(0), box('pitm', Buffer.from([0, 0, 0, 0, 0, 1])),
            box('iinf', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, count]), ...items]))]))]);
}
function sandbox(extra: Record<string, unknown> = {}) {
    const env: any = { Uint8Array, ArrayBuffer, TextDecoder, TextEncoder, atob, crypto: webcrypto,
        setTimeout, clearTimeout, performance, AbortController, ...extra };
    runInNewContext(source, env);
    return env;
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => { resolve = yes; });
    return { promise, resolve };
}
async function until(predicate: () => boolean) {
    for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
    expect(predicate()).toBe(true);
}

describe('B129 P0 byte classifier (no decoder claims)', () => {
    const classify = sandbox().B129FormatProbe.classify;
    it.each([
        [singleGif, 'photo.gif', 'gif', 'static'], [animatedGif, 'photo.gif', 'gif', 'animated'],
        [png(), 'photo.png', 'png', 'static'], [png(true), 'photo.png', 'png', 'animated'],
        [webp(), 'photo.webp', 'webp', 'static'], [webp(true), 'photo.webp', 'webp', 'animated'],
        [heic(), 'photo.heic', 'heic', 'static'], [heic(2), 'photo.heif', 'heic', 'multiple_images'],
        [heic(1, true), 'photo.heic', 'heic', 'multiple_images'],
    ])('classifies %s / %s from bytes', (input, name, format, policy) => {
        expect(classify(input, name)).toMatchObject({ format, policy, extensionMatches: true });
    });
    it('detects mismatched extensions without losing animation or content identity', () => {
        expect(classify(webp(true), 'picture.jpg')).toMatchObject({ format: 'webp', policy: 'animated', extensionMatches: false });
        expect(classify(png(), 'picture.heic')).toMatchObject({ format: 'png', policy: 'static', extensionMatches: false });
    });
    it.each([singleGif.subarray(0, -1), png().subarray(0, -1), webp().subarray(0, -1), heic().subarray(0, -1)])(
        'does not pass truncated container data to a decoder', (input) => {
            expect(classify(input, 'truncated')).toMatchObject({ policy: 'malformed' });
        });
    it('rejects unknown bytes and external entities even if their extension claims SVG', () => {
        expect(classify(bytes('not an image'), 'image.svg').policy).toBe('unsupported');
        const xml = bytes('<svg xmlns="http://www.w3.org/2000/svg"><!ENTITY x SYSTEM "https://invalid/"></svg>');
        const Parser = jest.fn(() => { throw new Error('must reject before parsing'); });
        expect(classify(xml, 'image.svg', { DOMParser: Parser }).policy).toBe('external_or_active_svg');
        expect(Parser).not.toHaveBeenCalled();
    });
    it('requires a real XML parser; string matching alone cannot establish safe SVG', () => {
        expect(classify(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image.svg').policy).toBe('svg_parser_unavailable');
    });
    // These fake DOM nodes test post-parse policy only; host runners test actual DOMParser XML decoding.
    it.each(['https://invalid/image.png', 'relative.png', '//invalid/x', 'data:image/svg+xml;base64,PHN2Zy8+'])('rejects external or nested active href %s', (href) => {
        const root = { localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg', attributes: [] };
        const element = { localName: 'image', namespaceURI: root.namespaceURI, attributes: [{ localName: 'href', value: href }] };
        class Parser { parseFromString() { return { documentElement: root, querySelector: () => null, querySelectorAll: () => [root, element] }; } }
        expect(classify(bytes('<svg/>'), 'image.svg', { DOMParser: Parser }).policy).toBe('external_or_active_svg');
    });
    it.each(['url(https://invalid/x)', 'u\\72l(https://invalid/x)', '@import "https://invalid/x"', 'animation: pulse 1s',
        'image-set("https://invalid/x.png" 1x)', '-webkit-image-set("https://invalid/x.png" 1x)',
        'image-/**/set("https://invalid/x.png" 1x)'])('rejects external/active CSS %s', (css) => {
        const root = { localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg', attributes: [] };
        class Parser { parseFromString() { return { documentElement: root, querySelector: () => null, querySelectorAll: () =>
            [root, { ...root, localName: 'style', textContent: css }] }; } }
        expect(classify(bytes('<svg/>'), 'image.svg', { DOMParser: Parser }).policy).toBe('external_or_active_svg');
    });
});

function systemHarness(options: { failCleanup?: boolean; delayDirectory?: boolean } = {}) {
    const env = sandbox();
    const directories = new Set<string>(); const files = new Set<string>(); const actions: string[] = [];
    const dirWait = deferred<string>();
    const path = require('node:path');
    class Adapter { getBasePath() { return '/synthetic-vault'; } }
    const adapter = new Adapter();
    const state: { callback?: (error?: unknown, stdout?: string, stderr?: string) => void; argv?: unknown[] } = {};
    const fs = {
        mkdtemp: async () => {
            const dir = options.delayDirectory ? await dirWait.promise : '/synthetic-os-temp/b129-format-one';
            directories.add(dir); actions.push('mkdir'); return dir;
        },
        unlink: async (name: string) => {
            actions.push('unlink');
            if (options.failCleanup) throw Object.assign(new Error('blocked'), { code: 'EACCES' });
            files.delete(name);
        },
        rmdir: async (name: string) => {
            actions.push('rmdir');
            if (options.failCleanup) throw Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' });
            directories.delete(name);
        },
    };
    const loadNode = jest.fn((name: string) => ({
        'node:fs/promises': fs, 'node:path': path, 'node:os': { tmpdir: () => '/synthetic-os-temp' },
        'node:child_process': { execFile: (...args: any[]) => {
            state.argv = args.slice(0, 3); state.callback = args[3]; actions.push('exec');
            return { kill: (signal: string) => { actions.push(signal); } };
        } },
    }[name]));
    const settings = { Platform: { isDesktopApp: true, isMacOS: true }, FileSystemAdapter: Adapter, adapter, loadNode };
    return { env, settings, directories, files, actions, state, dirWait };
}

describe('B129 macOS adapter lifecycle (all process/filesystem effects faked)', () => {
    afterEach(() => { jest.useRealTimers(); });
    it.each([
        { isDesktopApp: false, isMacOS: false }, { isDesktopApp: true, isMacOS: false },
    ])('does not read Node modules on unsupported host %j', async (Platform) => {
        const h = systemHarness();
        await expect(h.env.B129FormatProbe.systemConvert('b129-p0-fixtures/a.heic', { ...h.settings, Platform }, {}))
            .rejects.toThrow('system_conversion_unavailable');
        expect(h.settings.loadNode).not.toHaveBeenCalled();
    });
    it('requires the real supplied FileSystemAdapter class, not a lookalike', async () => {
        const h = systemHarness();
        await expect(h.env.B129FormatProbe.systemConvert('b129-p0-fixtures/a.heic', { ...h.settings, adapter: {} }, {}))
            .rejects.toThrow('system_conversion_unavailable');
        expect(h.settings.loadNode).not.toHaveBeenCalled();
    });
    it('guards module loading in a no-Node realm', () => {
        const env: any = {};
        Object.defineProperty(env, 'require', { get: () => { throw new Error('Node touched at load'); } });
        Object.defineProperty(env, 'process', { get: () => { throw new Error('Node touched at load'); } });
        expect(() => runInNewContext(source, env)).not.toThrow();
        expect(typeof env.runB129FormatProbe).toBe('function');
    });
    it('cleans a just-created directory when cancellation arrives during mkdtemp', async () => {
        const h = systemHarness({ delayDirectory: true }); const controller = new AbortController(); const receipt: any = {};
        const work = h.env.B129FormatProbe.systemConvert('b129-p0-fixtures/a.heic', { ...h.settings, signal: controller.signal }, receipt);
        controller.abort(); h.dirWait.resolve('/synthetic-os-temp/b129-format-one');
        await expect(work).rejects.toThrow('cancelled');
        expect(h.actions).toEqual(['mkdir', 'unlink', 'rmdir']);
        expect(h.directories.size).toBe(0); expect(receipt.tempCleaned).toBe(true);
    });
    it('kills on cancel, waits for process exit, then cleans; a late successful callback cannot commit', async () => {
        const h = systemHarness(); const controller = new AbortController(); const receipt: any = {};
        let settled = false;
        const work = h.env.B129FormatProbe.systemConvert('b129-p0-fixtures/a.heic', { ...h.settings, signal: controller.signal }, receipt)
            .finally(() => { settled = true; });
        await until(() => Boolean(h.state.callback)); controller.abort();
        expect(h.actions).toContain('SIGTERM'); expect(settled).toBe(false); expect(h.actions).not.toContain('unlink');
        h.state.callback!(undefined, '', '');
        await expect(work).rejects.toThrow('cancelled');
        expect(h.actions.slice(-2)).toEqual(['unlink', 'rmdir']);
        expect(receipt).toMatchObject({ processExited: true, tempCleaned: true });
        expect(h.state.argv).toEqual(['/usr/bin/sips', ['-s', 'format', 'png', '/synthetic-vault/b129-p0-fixtures/a.heic', '--out',
            '/synthetic-os-temp/b129-format-one/intermediate.png'], { maxBuffer: 8192, shell: false }]);
    });
    it('times out, escalates only the owned child, and still waits before cleanup', async () => {
        jest.useFakeTimers();
        const h = systemHarness(); const receipt: any = {};
        const work = h.env.B129FormatProbe.systemConvert('b129-p0-fixtures/a.heic', { ...h.settings, systemTimeoutMs: 50 }, receipt);
        await until(() => Boolean(h.state.callback));
        jest.advanceTimersByTime(2050);
        expect(h.actions).toContain('SIGTERM'); expect(h.actions).toContain('SIGKILL'); expect(h.actions).not.toContain('unlink');
        h.state.callback!(Object.assign(new Error('killed'), { code: 'SIGKILL' }));
        await expect(work).rejects.toThrow('system_conversion_timeout');
        expect(receipt.tempCleaned).toBe(true); expect(jest.getTimerCount()).toBe(0);
    });
    it('records cleanup failure instead of reporting success or recursively deleting', async () => {
        const h = systemHarness({ failCleanup: true }); const receipt: any = {};
        const work = h.env.B129FormatProbe.systemConvert('b129-p0-fixtures/a.heic', h.settings, receipt);
        await until(() => Boolean(h.state.callback));
        h.state.callback!(Object.assign(new Error('bad input'), { code: 13 }));
        await expect(work).rejects.toThrow('temporary_cleanup_failed');
        expect(receipt).toMatchObject({ tempCleaned: false, cleanupErrors: ['unlink:EACCES', 'rmdir:ENOTEMPTY'] });
        expect(h.directories.size).toBe(1); expect(h.actions.slice(-2)).toEqual(['unlink', 'rmdir']);
    });
    it('cleans rejected stale results after child exit', async () => {
        const h = systemHarness(); let current = true; const receipt: any = {};
        const work = h.env.B129FormatProbe.systemConvert('b129-p0-fixtures/a.heic', { ...h.settings, isCurrent: () => current }, receipt);
        await until(() => Boolean(h.state.callback)); current = false; h.state.callback!(undefined, '', '');
        await expect(work).rejects.toThrow('stale_operation'); expect(receipt.tempCleaned).toBe(true);
    });
    it('rejects traversal before process or temporary directory creation', async () => {
        const h = systemHarness();
        await expect(h.env.B129FormatProbe.systemConvert('b129-p0-fixtures/../a.heic', h.settings, {})).rejects.toThrow('synthetic_fixture_path_required');
        expect(h.actions).toEqual([]);
    });
});

describe('B129 failure preserves acquired bytes and draft', () => {
    function embeddedHarness(behavior: 'valid' | 'invalid' | 'hold') {
        const href = 'data:image/jpeg;base64,/9j/';
        const svg = bytes(`<svg xmlns="http://www.w3.org/2000/svg"><image href="${href}"/></svg>`);
        const root = { localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg', attributes: [] };
        const child = { ...root, localName: 'image', attributes: [{ localName: 'href', value: href }] };
        class Parser { parseFromString() { return { documentElement: root, querySelector: () => null, querySelectorAll: () => [root, child] }; } }
        const urls = new Set<string>(); const images: any[] = [];
        const env = sandbox({ DOMParser: Parser, Blob,
            URL: {
                createObjectURL: () => { const url = `blob:embedded-${images.length}`; urls.add(url); return url; },
                revokeObjectURL: (url: string) => urls.delete(url),
            },
            Image: class {
                onload?: (() => void) | null; onerror?: (() => void) | null;
                naturalWidth = 10; naturalHeight = 20; value = '';
                constructor() { images.push(this); }
                set src(value: string) { this.value = value; if (value) {
                    if (behavior === 'valid') this.onload?.(); else if (behavior === 'invalid') this.onerror?.();
                } }
                get src() { return this.value; }
            },
        });
        return { env, svg, urls, images };
    }
    it('does not rasterize an enclosing SVG when an embedded header has no decodable pixels', async () => {
        const h = embeddedHarness('invalid');
        const app = { vault: { adapter: { readBinary: async () => h.svg } } };
        const { receipt, output } = await h.env.B129FormatProbe.processFixture(app, { path: 'embedded.svg' });
        expect(receipt).toMatchObject({ status: 'needs_static_image', error: 'embedded_raster_decode_failed',
            decoderCalled: false, originalUnchanged: true, originalRetained: true, draftPreserved: true,
            urlsCreated: 1, urlsReleased: 1, embeddedRasters: [{ bytes: 3, mime: 'image/jpeg', decoded: false }] });
        expect(output).toBeUndefined(); expect(h.images).toHaveLength(1); expect(h.urls.size).toBe(0);
    });
    it('records actual embedded decoder dimensions and releases it before enclosing SVG work', async () => {
        const h = embeddedHarness('valid'); const receipt: any = {};
        await h.env.B129FormatProbe.validateEmbeddedRasters(h.svg, {}, receipt);
        expect(receipt).toMatchObject({ urlsCreated: 1, urlsReleased: 1,
            embeddedRasters: [{ decoded: true, width: 10, height: 20 }] });
        expect(h.images[0]).toMatchObject({ src: '', onload: null, onerror: null }); expect(h.urls.size).toBe(0);
    });
    it('cancels embedded validation, releases its URL, and ignores late pixel completion', async () => {
        const h = embeddedHarness('hold'); const receipt: any = {}; const controller = new AbortController();
        const work = h.env.B129FormatProbe.validateEmbeddedRasters(h.svg, { signal: controller.signal }, receipt);
        // SHA-256 is a real asynchronous operation preceding image allocation.
        while (!h.images.length) await new Promise((yes) => setTimeout(yes, 1));
        const late = h.images[0].onload; controller.abort();
        await expect(work).rejects.toThrow('cancelled'); late();
        expect(receipt).toMatchObject({ urlsCreated: 1, urlsReleased: 1, embeddedRasters: [{ decoded: false }] });
        expect(h.images[0]).toMatchObject({ src: '', onload: null, onerror: null }); expect(h.urls.size).toBe(0);
    });
    it('blocks animation before loading an Image or calling any platform adapter', async () => {
        const env = sandbox({ Image: jest.fn(() => { throw new Error('must not decode animation'); }) });
        const app = { vault: { adapter: { readBinary: async () => animatedGif } } };
        const result = await env.B129FormatProbe.processFixture(app, { path: 'source.gif' });
        expect(result.output).toBeUndefined();
        expect(result.receipt).toMatchObject({ status: 'needs_static_image', decoderCalled: false, originalUnchanged: true,
            originalRetained: true, draftPreserved: true, networkRequestsInitiated: 0 });
        expect(env.Image).not.toHaveBeenCalled();
    });
    it('ignores a late result from an aborted canvas operation', async () => {
        const env = sandbox(); const controller = new AbortController(); let finish: ((value: string) => void) | undefined;
        const work = env.B129FormatProbe.abortable((resolve: (value: string) => void) => { finish = resolve; }, controller.signal, 10000);
        controller.abort(); await expect(work).rejects.toThrow('cancelled');
        expect(() => finish!('late pixels')).not.toThrow();
    });
});

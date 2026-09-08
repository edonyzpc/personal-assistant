import { assertNewChatImageSupported, assertSafeEncodedJpeg, inspectImage } from '../src/chat/image-format';
import { IMAGE_POLICY } from '../src/chat/image-policy';

const bytes = (data: Uint8Array | number[] | string): ArrayBuffer =>
    Uint8Array.from(typeof data === 'string' ? Buffer.from(data) : data).buffer;
const word = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (name: string, body: Uint8Array): Buffer => Buffer.concat([word(body.length + 8), Buffer.from(name), body]);
function jpeg(width = 640, height = 480, extra = Buffer.alloc(0)): ArrayBuffer {
    return bytes(Buffer.concat([Buffer.from([255, 216]), extra,
        Buffer.from([255, 192, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 255, 217])]));
}
const segment = (marker: number, data: Uint8Array): Buffer => Buffer.concat([
    Buffer.from([255, marker, (data.length + 2) >> 8, (data.length + 2) & 255]), data]);
function png(width = 640, height = 480, animated = false): ArrayBuffer {
    const chunk = (name: string, body: Uint8Array): Buffer => Buffer.concat([word(body.length), Buffer.from(name), body, word(0)]);
    return bytes(Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
        chunk('IHDR', Buffer.concat([word(width), word(height), Buffer.from([8, 6, 0, 0, 0])])),
        ...(animated ? [chunk('acTL', Buffer.concat([word(2), word(0)]))] : []), chunk('IEND', Buffer.alloc(0))]));
}
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
function webp(animated = false): ArrayBuffer {
    const payload = Buffer.from([animated ? 2 : 0, 0, 0, 0, 127, 2, 0, 223, 1, 0]);
    const length = Buffer.alloc(4); length.writeUInt32LE(payload.length);
    const body = Buffer.concat([Buffer.from('WEBPVP8X'), length, payload]);
    const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
    return bytes(Buffer.concat([Buffer.from('RIFF'), size, body]));
}
function heic(options: { count?: number; sequence?: boolean; dependent?: string; width?: number; height?: number; association?: number } = {}): ArrayBuffer {
    const { count = 1, sequence = false, dependent, width = 640, height = 480, association = 1 } = options;
    const entries = Array.from({ length: count }, (_, i) => box('infe', Buffer.concat([
        Buffer.from([2, 0, 0, 0, 0, i + 1, 0, 0]), Buffer.from(dependent === 'dimg' && i === 0 ? 'grid' : 'hvc1'), Buffer.from([0])] )));
    const refs = dependent ? [box('iref', Buffer.concat([word(0), box(dependent,
        dependent === 'dimg' ? Buffer.from([0, 1, 0, 1, 0, 2]) : Buffer.from([0, 2, 0, 1, 0, 1]))]))] : [];
    return bytes(Buffer.concat([box('ftyp', Buffer.concat([Buffer.from(sequence ? 'hevc' : 'heic'), word(0), Buffer.from('mif1heic')])),
        box('meta', Buffer.concat([word(0), box('pitm', Buffer.from([0, 0, 0, 0, 0, 1])),
            box('iinf', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, count]), ...entries])), ...refs,
            box('iprp', Buffer.concat([box('ipco', box('ispe', Buffer.concat([word(0), word(width), word(height)]))),
                box('ipma', Buffer.concat([word(0), word(1), Buffer.from([0, 1, 1, association])]))]))]))]));
}

describe('new chat image format boundary', () => {
    it.each([
        ['static', heic()], ['sequence', heic({ sequence: true })], ['multiple images', heic({ count: 2 })],
        ['oversized geometry', heic({ width: 8001, height: 6000 })], ['truncated metadata', heic().slice(0, -1)],
        ['missing metadata', heic().slice(0, 24)], ['truncated file type', heic().slice(0, 12)],
        ['preceding free box', bytes(Buffer.concat([box('free', Buffer.alloc(4)), Buffer.from(heic())]))],
    ])('rejects %s HEIC without full decoding or metadata admission', (_name, input) => {
        expect(() => assertNewChatImageSupported(input as ArrayBuffer)).toThrow('image_processing:heic-unsupported');
    });
    it.each(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])(
        'recognizes major and compatible HEIF brand %s', (brand) => {
            const major = bytes(box('ftyp', Buffer.concat([Buffer.from(brand), word(0)])));
            const compatible = bytes(box('ftyp', Buffer.concat([Buffer.from('test'), word(0), Buffer.from(brand)])));
            for (const input of [major, compatible]) {
                expect(() => assertNewChatImageSupported(input)).toThrow('image_processing:heic-unsupported');
            }
        });
    it('recognizes extended-size and malformed-size HEIF boxes', () => {
        const extended = bytes(Buffer.concat([word(1), Buffer.from('ftyp'), word(0), word(24), Buffer.from('heic'), word(0)]));
        const malformed = bytes(Buffer.concat([word(4), Buffer.from('ftypheic')]));
        for (const input of [extended, malformed]) {
            expect(() => assertNewChatImageSupported(input)).toThrow('image_processing:heic-unsupported');
        }
    });
    it.each([jpeg(), png(), bytes(gif), webp(), bytes('<svg><text>ftypheic</text></svg>'),
        jpeg(640, 480, segment(254, Buffer.from('ftypheic')))])(
        'keeps other image admission separate and does not scan arbitrary image content for brands', (input) => {
            expect(() => assertNewChatImageSupported(input)).not.toThrow();
        });
});

describe('image container inspection including historical HEIC (not new input admission)', () => {
    it.each([[jpeg(), 'jpeg', 640, 480], [png(), 'png', 640, 480], [bytes(gif), 'gif', 1, 1],
        [webp(), 'webp', 640, 480], [heic(), 'heic', 640, 480]])('admits static %s', (input, format, width, height) => {
        expect(inspectImage(input as ArrayBuffer)).toMatchObject({ format, width, height, frames: 1 });
    });
    it.each([png(1, 1, true), webp(true), bytes(Buffer.concat([gif.subarray(0, -1), gif.subarray(19, -1), Buffer.from([59])]))])(
        'rejects animation from content without trusting filename or MIME', (input) => {
            expect(() => inspectImage(input)).toThrow('image_processing:animated');
        });
    it.each(['dimg', 'thmb', 'auxl'])('allows a single HEIC with %s auxiliary relationship', (dependent) => {
        expect(inspectImage(heic({ count: 2, dependent }))).toMatchObject({ format: 'heic', width: 640 });
    });
    it.each([heic({ count: 2 }), heic({ sequence: true }), jpeg(640, 480, segment(226, Buffer.from('MPF\0')))])(
        'rejects independent image collections', (input) => expect(() => inspectImage(input)).toThrow('image_processing:multiple-images'));
    it.each([png(8001, 6000), jpeg(8001, 6000), heic({ width: 8001, height: 6000 })])('enforces decoded geometry before allocation', (input) => {
        expect(() => inspectImage(input)).toThrow('image_processing:pixel-limit');
    });
    it('admits exactly 48 MP and rejects bytes above 20 MiB', () => {
        expect(inspectImage(heic({ width: 8000, height: 6000 }))).toMatchObject({ width: 8000 });
        expect(() => inspectImage(new ArrayBuffer(IMAGE_POLICY.maxOriginalBytes + 1))).toThrow('image_processing:original-byte-limit');
    });
    it.each([jpeg().slice(0, -1), png().slice(0, -1), bytes(gif.subarray(0, -1)), webp().slice(0, -1), heic().slice(0, -1), heic({ association: 2 })])(
        'rejects truncated or unbounded containers', (input) => expect(() => inspectImage(input)).toThrow('image_processing:malformed'));
});

describe('production SVG post-parse admission', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
    afterEach(() => { if (original) Object.defineProperty(globalThis, 'DOMParser', original); else delete (globalThis as any).DOMParser; });
    // Minimal parsed-node harness: actual XML parsing and browser decoding are host-smoke responsibilities.
    function parser(node: Record<string, unknown> = {}, attrs: Record<string, string> = {}): void {
        const root = { localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg', attributes: [],
            getAttribute: (name: string) => ({ width: '640', height: '480', ...attrs } as Record<string, string>)[name] ?? null };
        class Parser { parseFromString() { return { documentElement: root, querySelector: () => null,
            querySelectorAll: () => [root, { ...root, localName: 'path', ...node }] }; } }
        Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: Parser });
    }
    it.each(['url(https://invalid/x)', 'u\\72l(https://invalid/x)', '@import "https://invalid/x"',
        'image-set("https://invalid/x" 1x)', '-webkit-image-set("https://invalid/x" 1x)', 'image-/**/set("https://invalid/x" 1x)', 'animation: spin 1s'])(
        'blocks external CSS before any decoder can fetch it: %s', (textContent) => {
        parser({ localName: 'style', textContent });
        expect(() => inspectImage(bytes('<svg/>'))).toThrow('image_processing:unsafe-svg');
    });
    it.each(['https://invalid/x', 'relative.png', '//invalid/x', 'data:image/svg+xml;base64,PHN2Zy8+'])('blocks external href %s', (value) => {
        parser({ attributes: [{ localName: 'href', value }] });
        expect(() => inspectImage(bytes('<svg/>'))).toThrow('image_processing:unsafe-svg');
    });
    it.each(['script', 'foreignObject', 'animateTransform', 'set'])('blocks active element %s', (localName) => {
        parser({ localName }); expect(() => inspectImage(bytes('<svg/>'))).toThrow('image_processing:unsafe-svg');
    });
    it('permits bounded vector content and stages embedded raster bytes for full decode verification', () => {
        parser({ attributes: [{ localName: 'href', value: `data:image/jpeg;base64,${Buffer.from(jpeg()).toString('base64')}` }] });
        expect(inspectImage(bytes('<svg/>'))).toMatchObject({ format: 'svg', width: 640, embeddedImages: [{ mime: 'image/jpeg', width: 640 }] });
        parser({ attributes: [{ localName: 'fill', value: 'url(#local)' }] });
        expect(inspectImage(bytes('<svg/>')).embeddedImages).toEqual([]);
    });
    it('rejects a three-byte embedded JPEG and pre-parse XML entities', () => {
        parser({ attributes: [{ localName: 'href', value: 'data:image/jpeg;base64,/9j/' }] });
        expect(() => inspectImage(bytes('<svg/>'))).toThrow('image_processing:malformed');
        expect(() => inspectImage(bytes('<svg><!ENTITY secret SYSTEM "https://invalid/x"></svg>'))).toThrow('image_processing:unsafe-svg');
    });
});

describe('fresh JPEG output metadata admission', () => {
    function exif(tag: number): Buffer {
        const tiff = Buffer.alloc(26); tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
        tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(tag, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(1, 18);
        return segment(225, Buffer.concat([Buffer.from('Exif\0\0'), tiff]));
    }
    it('accepts metadata-free output and new orientation/resolution fields', () => {
        expect(() => assertSafeEncodedJpeg(jpeg())).not.toThrow();
        expect(() => assertSafeEncodedJpeg(jpeg(640, 480, exif(274)))).not.toThrow();
    });
    it.each([271, 272, 306, 34853, 37500])('rejects source EXIF tag %s (device/time/GPS/private data)', (tag) => {
        expect(() => assertSafeEncodedJpeg(jpeg(640, 480, exif(tag)))).toThrow('image_processing:metadata-invalid');
    });
    it.each([segment(254, Buffer.from('secret')), segment(225, Buffer.from('http://ns.adobe.com/xap/1.0/\0secret')),
        segment(228, Buffer.from('private metadata')), segment(226, Buffer.from('private metadata'))])(
        'rejects comments and XMP', (extra) => expect(() => assertSafeEncodedJpeg(jpeg(640, 480, extra))).toThrow('image_processing:metadata-invalid'));
});

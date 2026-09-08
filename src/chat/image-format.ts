import { checkImageDimensions, IMAGE_POLICY, ImageProcessingError } from './image-policy';

export type ChatImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'svg';
export type ChatImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/heic' | 'image/svg+xml';
export interface EmbeddedImage { bytes: ArrayBuffer; mime: ChatImageMime; width: number; height: number }
export interface ImageInspection {
    format: ChatImageFormat;
    mime: ChatImageMime;
    width: number;
    height: number;
    frames: number;
    embeddedImages: EmbeddedImage[];
}

const invalid = (): never => { throw new ImageProcessingError('malformed'); };
const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
const u16 = (b: Uint8Array, o: number): number => { if (o + 2 > b.length) return invalid(); return b[o] * 256 + b[o + 1]; };
const u32 = (b: Uint8Array, o: number): number => { if (o + 4 > b.length) return invalid(); return b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3]; };
const little = (b: Uint8Array, o: number, count: number): number => {
    if (o + count > b.length) return invalid();
    let result = 0; for (let i = 0; i < count; i++) result += b[o + i] * 2 ** (8 * i); return result;
};
const result = (format: ChatImageFormat, width: number, height: number, embeddedImages: EmbeddedImage[] = []): ImageInspection => {
    checkImageDimensions(width, height);
    return { format, mime: ({ jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
        heic: 'image/heic', svg: 'image/svg+xml' } as const)[format], width, height, frames: 1, embeddedImages };
};

interface JpegSegment { marker: number; start: number; end: number }
function jpegSegments(bytes: Uint8Array): JpegSegment[] {
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.length < 4) return invalid();
    const parts: JpegSegment[] = [];
    let foundEnd = false;
    for (let i = bytes.length - 2; i >= 2; i--) { if (bytes[i] === 255 && bytes[i + 1] === 217) { foundEnd = true; break; } }
    if (!foundEnd) return invalid();
    for (let offset = 2; offset < bytes.length;) {
        if (bytes[offset] !== 255) return invalid();
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const length = u16(bytes, offset);
        if (length < 2 || offset + length > bytes.length) return invalid();
        parts.push({ marker, start: offset + 2, end: offset + length });
        offset += length;
    }
    return parts;
}
function inspectJpeg(bytes: Uint8Array): ImageInspection {
    const parts = jpegSegments(bytes);
    // MPO stores multiple independent pictures behind a JPEG-compatible first image.
    if (parts.some((p) => p.marker === 226 && ascii(bytes, p.start, 4) === 'MPF\0')) throw new ImageProcessingError('multiple-images');
    const frame = parts.find((p) => [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(p.marker));
    if (!frame || frame.end - frame.start < 6) return invalid();
    return result('jpeg', u16(bytes, frame.start + 3), u16(bytes, frame.start + 1));
}
function inspectPng(bytes: Uint8Array): ImageInspection {
    let width = 0, height = 0, ended = false, animated = false;
    for (let offset = 8; offset < bytes.length;) {
        if (offset + 12 > bytes.length) return invalid();
        const size = u32(bytes, offset), kind = ascii(bytes, offset + 4, 4);
        if (offset + 12 + size > bytes.length) return invalid();
        if (offset === 8 && (kind !== 'IHDR' || size !== 13)) return invalid();
        if (kind === 'IHDR') { width = u32(bytes, offset + 8); height = u32(bytes, offset + 12); checkImageDimensions(width, height); }
        if (kind === 'acTL') { if (size !== 8 || !u32(bytes, offset + 8)) return invalid(); animated = true; }
        if (kind === 'fcTL' || kind === 'fdAT') animated = true;
        offset += 12 + size;
        if (kind === 'IEND') { if (size) return invalid(); ended = true; break; }
    }
    if (!ended) return invalid();
    if (animated) throw new ImageProcessingError('animated');
    return result('png', width, height);
}
function inspectGif(bytes: Uint8Array): ImageInspection {
    if (bytes.length < 13) return invalid();
    const width = little(bytes, 6, 2), height = little(bytes, 8, 2);
    checkImageDimensions(width, height);
    let offset = 13 + ((bytes[10] & 128) ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), frames = 0;
    const subBlocks = (): void => {
        while (offset < bytes.length) { const size = bytes[offset++]; if (!size) return; offset += size; if (offset > bytes.length) return invalid(); }
        return invalid();
    };
    while (offset < bytes.length) {
        const kind = bytes[offset++];
        if (kind === 59) { if (!frames) return invalid(); if (frames > 1) throw new ImageProcessingError('animated'); return result('gif', width, height); }
        if (kind === 33) { offset++; subBlocks(); continue; }
        if (kind !== 44 || offset + 9 > bytes.length) return invalid();
        const x = little(bytes, offset, 2), y = little(bytes, offset + 2, 2);
        const frameWidth = little(bytes, offset + 4, 2), frameHeight = little(bytes, offset + 6, 2);
        checkImageDimensions(frameWidth, frameHeight);
        if (x + frameWidth > width || y + frameHeight > height) return invalid();
        const packed = bytes[offset + 8];
        offset += 9 + ((packed & 128) ? 3 * 2 ** ((packed & 7) + 1) : 0);
        offset++; subBlocks(); frames++;
    }
    return invalid();
}
function inspectWebp(bytes: Uint8Array): ImageInspection {
    if (little(bytes, 4, 4) + 8 !== bytes.length) return invalid();
    let width = 0, height = 0, animated = false;
    for (let offset = 12; offset < bytes.length;) {
        if (offset + 8 > bytes.length) return invalid();
        const kind = ascii(bytes, offset, 4), length = little(bytes, offset + 4, 4), start = offset + 8;
        if (start + length > bytes.length) return invalid();
        if (kind === 'ANIM' || kind === 'ANMF') animated = true;
        if (kind === 'VP8X') {
            if (length !== 10) return invalid();
            animated ||= Boolean(bytes[start] & 2);
            width = little(bytes, start + 4, 3) + 1; height = little(bytes, start + 7, 3) + 1;
        } else if (!width && kind === 'VP8 ') {
            if (length < 10 || ascii(bytes, start + 3, 3) !== '\x9d\x01\x2a') return invalid();
            width = little(bytes, start + 6, 2) & 0x3fff; height = little(bytes, start + 8, 2) & 0x3fff;
        } else if (!width && kind === 'VP8L') {
            if (length < 5 || bytes[start] !== 47) return invalid();
            const bits = little(bytes, start + 1, 4);
            width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
        }
        offset = start + length + (length & 1);
    }
    if (animated) throw new ImageProcessingError('animated');
    return result('webp', width, height);
}

interface Box { type: string; start: number; end: number }
/** Reject HEIF delivery before metadata parsing can fail or an original is written.
 * Full inspection remains available for reading historical asset/save records.
 */
export function assertNewChatImageSupported(buffer: ArrayBuffer): void {
    const bytes = new Uint8Array(buffer);
    const heifBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
    for (let offset = 0; offset + 8 <= bytes.length;) {
        let length = u32(bytes, offset), header = 8;
        if (length === 1) {
            if (offset + 16 > bytes.length) return;
            length = u32(bytes, offset + 8) * 4294967296 + u32(bytes, offset + 12);
            header = 16;
        } else if (!length) length = bytes.length - offset;
        if (ascii(bytes, offset + 4, 4) === 'ftyp') {
            const start = offset + header;
            // Even a truncated/malformed container can identify its media family.
            // Do not require dimensions, item metadata, or a working HEIC decoder.
            const end = Number.isSafeInteger(length) && length >= header + 4
                ? Math.min(bytes.length, offset + length) : bytes.length;
            const rejectBrand = (position: number): void => {
                if (position + 4 <= end && heifBrands.has(ascii(bytes, position, 4))) {
                    throw new ImageProcessingError('heic-unsupported');
                }
            };
            rejectBrand(start);
            for (let position = start + 8; position + 4 <= end; position += 4) rejectBrand(position);
        }
        if (!Number.isSafeInteger(length) || length < header || offset + length > bytes.length) return;
        offset += length;
    }
}

function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
    const parts: Box[] = [];
    for (let offset = start; offset < end;) {
        if (offset + 8 > end) return invalid();
        let length = u32(bytes, offset), header = 8;
        if (length === 1) { if (offset + 16 > end) return invalid(); length = u32(bytes, offset + 8) * 4294967296 + u32(bytes, offset + 12); header = 16; }
        else if (!length) length = end - offset;
        if (!Number.isSafeInteger(length) || length < header || offset + length > end) return invalid();
        parts.push({ type: ascii(bytes, offset + 4, 4), start: offset + header, end: offset + length }); offset += length;
    }
    return parts;
}
function inspectHeic(bytes: Uint8Array): ImageInspection {
    const top = boxes(bytes), ftyp = top.find((p) => p.type === 'ftyp');
    if (!ftyp || ftyp.end - ftyp.start < 8) return invalid();
    const brands = [ascii(bytes, ftyp.start, 4)];
    for (let i = ftyp.start + 8; i + 4 <= ftyp.end; i += 4) brands.push(ascii(bytes, i, 4));
    if (!brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) throw new ImageProcessingError('unsupported');
    if (brands.some((brand) => ['hevc', 'hevx', 'msf1'].includes(brand))) throw new ImageProcessingError('multiple-images');
    const meta = top.find((p) => p.type === 'meta');
    if (!meta || meta.start + 4 > meta.end) return invalid();
    const children = boxes(bytes, meta.start + 4, meta.end), info = children.find((p) => p.type === 'iinf');
    if (!info || info.start + 6 > info.end) return invalid();
    const items: number[] = [];
    for (const item of boxes(bytes, info.start + (bytes[info.start] === 0 ? 6 : 8), info.end)) {
        if (item.type !== 'infe') continue;
        const version = bytes[item.start], idSize = version === 2 ? 2 : 4;
        if (![2, 3].includes(version) || item.start + 4 + idSize + 6 > item.end) return invalid();
        const id = idSize === 2 ? u16(bytes, item.start + 4) : u32(bytes, item.start + 4);
        const type = ascii(bytes, item.start + 4 + idSize + 2, 4);
        if (['hvc1', 'grid', 'iden', 'iovl'].includes(type)) items.push(id);
    }
    const dependent = new Set<number>(), references = children.find((p) => p.type === 'iref');
    if (references) {
        if (references.start + 4 > references.end) return invalid();
        const idSize = bytes[references.start] ? 4 : 2;
        const readId = (offset: number): number => idSize === 2 ? u16(bytes, offset) : u32(bytes, offset);
        for (const ref of boxes(bytes, references.start + 4, references.end)) {
            if (!['dimg', 'thmb', 'auxl'].includes(ref.type)) continue;
            if (ref.start + idSize + 2 > ref.end) return invalid();
            const count = u16(bytes, ref.start + idSize);
            if (ref.start + idSize + 2 + idSize * count !== ref.end) return invalid();
            if (ref.type !== 'dimg') dependent.add(readId(ref.start));
            else for (let i = 0; i < count; i++) dependent.add(readId(ref.start + idSize + 2 + i * idSize));
        }
    }
    const roots = items.filter((id) => !dependent.has(id));
    if (roots.length !== 1) throw new ImageProcessingError('multiple-images');
    const primary = children.find((p) => p.type === 'pitm');
    if (!primary || primary.start + (bytes[primary.start] ? 8 : 6) > primary.end) return invalid();
    const primaryId = bytes[primary.start] ? u32(bytes, primary.start + 4) : u16(bytes, primary.start + 4);
    if (primaryId !== roots[0]) throw new ImageProcessingError('multiple-images');
    const properties = children.find((p) => p.type === 'iprp');
    if (!properties) return invalid();
    const propertyBoxes = boxes(bytes, properties.start, properties.end), ipco = propertyBoxes.find((p) => p.type === 'ipco');
    if (!ipco) return invalid();
    const indexedProperties = boxes(bytes, ipco.start, ipco.end);
    const sizes = new Map<number, { width: number; height: number }>();
    indexedProperties.forEach((prop, index) => {
        if (prop.type !== 'ispe') return;
        if (prop.end - prop.start !== 12) return invalid();
        const width = u32(bytes, prop.start + 4), height = u32(bytes, prop.start + 8);
        checkImageDimensions(width, height); sizes.set(index + 1, { width, height });
    });
    let primarySize: { width: number; height: number } | undefined;
    for (const association of propertyBoxes.filter((p) => p.type === 'ipma')) {
        if (association.start + 8 > association.end) return invalid();
        const version = bytes[association.start], wide = Boolean(bytes[association.start + 3] & 1);
        let offset = association.start + 8;
        const entries = u32(bytes, association.start + 4);
        if (entries > bytes.length) return invalid();
        for (let entry = 0; entry < entries; entry++) {
            const idSize = version < 1 ? 2 : 4;
            if (offset + idSize + 1 > association.end) return invalid();
            const id = idSize === 2 ? u16(bytes, offset) : u32(bytes, offset); offset += idSize;
            const count = bytes[offset++];
            if (offset + count * (wide ? 2 : 1) > association.end) return invalid();
            for (let i = 0; i < count; i++) {
                const index = wide ? u16(bytes, offset) & 0x7fff : bytes[offset] & 0x7f;
                offset += wide ? 2 : 1;
                if (id === primaryId && sizes.has(index)) {
                    if (primarySize) return invalid();
                    primarySize = sizes.get(index);
                }
            }
        }
        if (offset !== association.end) return invalid();
    }
    if (!primarySize) return invalid();
    return result('heic', primarySize.width, primarySize.height);
}

function inspectSvg(bytes: Uint8Array): ImageInspection {
    const unsafe = (): never => { throw new ImageProcessingError('unsafe-svg'); };
    let source: string;
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return invalid(); }
    if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source) || typeof DOMParser === 'undefined') return unsafe();
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = doc.documentElement;
    if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') return invalid();
    const positiveSize = (value: string | null): number | undefined => {
        const match = value?.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/);
        return match ? Number(match[1]) : undefined;
    };
    const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const viewWidth = viewBox?.length === 4 ? viewBox[2] : undefined, viewHeight = viewBox?.length === 4 ? viewBox[3] : undefined;
    const width = positiveSize(root.getAttribute('width')) ?? viewWidth;
    const height = positiveSize(root.getAttribute('height')) ?? viewHeight;
    // Missing/relative intrinsic dimensions cannot prove a bounded complete raster.
    if (!width || !height) return unsafe();
    const embeddedImages: EmbeddedImage[] = [];
    const cssSafe = (value: string): boolean => {
        const css = value.replace(/\/\*[\s\S]*?\*\//g, '');
        if (/\\|@|(?:animation|transition)(?:-[\w-]+)?\s*:|expression\s*\(|(?:-webkit-)?image-set\s*\(/i.test(css)) return false;
        for (const match of css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) if (!/^#[\w:.-]+$/.test(match[2])) return false;
        return true;
    };
    for (const element of Array.from(doc.querySelectorAll('*'))) {
        if (element.namespaceURI !== 'http://www.w3.org/2000/svg' || /^(script|foreignObject|iframe|audio|video|animate.*|set|discard)$/i.test(element.localName)) return unsafe();
        if (element.localName === 'style' && !cssSafe(element.textContent ?? '')) return unsafe();
        for (const attr of Array.from(element.attributes)) {
            if (/^on/i.test(attr.localName) || ['base', 'src'].includes(attr.localName)) return unsafe();
            if (!cssSafe(attr.value)) return unsafe();
            if (attr.localName !== 'href' || !attr.value || /^#[\w:.-]+$/.test(attr.value)) continue;
            const embedded = attr.value.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i);
            if (!embedded) return unsafe();
            let data: Uint8Array;
            try { data = Uint8Array.from(atob(embedded[2]), (char) => char.charCodeAt(0)); } catch { return unsafe(); }
            const inspected = inspectImage(data.buffer);
            if (inspected.format !== embedded[1].toLowerCase()) return unsafe();
            embeddedImages.push({ bytes: data.buffer, mime: inspected.mime, width: inspected.width, height: inspected.height });
        }
    }
    return result('svg', Math.ceil(width), Math.ceil(height), embeddedImages);
}

/** Byte-based admission; never invokes a decoder or fetches SVG resources. */
export function inspectImage(buffer: ArrayBuffer): ImageInspection {
    if (buffer.byteLength > IMAGE_POLICY.maxOriginalBytes) throw new ImageProcessingError('original-byte-limit');
    const bytes = new Uint8Array(buffer);
    try {
        if (bytes[0] === 255 && bytes[1] === 216) return inspectJpeg(bytes);
        if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return inspectPng(bytes);
        if (/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return inspectGif(bytes);
        if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return inspectWebp(bytes);
        if (ascii(bytes, 4, 4) === 'ftyp') return inspectHeic(bytes);
        if (/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg[\s/>]/i.test(new TextDecoder().decode(bytes))) return inspectSvg(bytes);
        throw new ImageProcessingError('unsupported');
    } catch (error) { if (error instanceof ImageProcessingError) throw error; return invalid(); }
}

/** A fresh Canvas JPEG may add dimensions/color metadata, but never source metadata. */
export function assertSafeEncodedJpeg(buffer: ArrayBuffer): void {
    const bytes = new Uint8Array(buffer);
    const reject = (): never => { throw new ImageProcessingError('metadata-invalid'); };
    for (const segment of jpegSegments(bytes)) {
        if (segment.marker === 254) return reject();
        if (segment.marker >= 224 && segment.marker <= 239 && ![224, 225, 226, 237, 238].includes(segment.marker)) return reject();
        if (segment.marker === 224 && ascii(bytes, segment.start, 5) !== 'JFIF\0') return reject();
        if (segment.marker === 226 && ascii(bytes, segment.start, 12) !== 'ICC_PROFILE\0') return reject();
        if (segment.marker === 238 && ascii(bytes, segment.start, 5) !== 'Adobe') return reject();
        if (segment.marker === 225) {
            if (ascii(bytes, segment.start, 6) !== 'Exif\0\0') return reject();
            const start = segment.start + 6, size = segment.end - start;
            const order = ascii(bytes, start, 2);
            if (!['II', 'MM'].includes(order) || size < 8) return reject();
            const view = new DataView(bytes.buffer, bytes.byteOffset + start, size), littleEndian = order === 'II';
            const word = (o: number): number => { if (o < 0 || o + 2 > size) return reject(); return view.getUint16(o, littleEndian); };
            const long = (o: number): number => { if (o < 0 || o + 4 > size) return reject(); return view.getUint32(o, littleEndian); };
            if (word(2) !== 42) return reject();
            const visit = (offset: number, nested: boolean): void => {
                const count = word(offset);
                if (count > 128 || offset + 2 + count * 12 + 4 > size) return reject();
                for (let i = 0; i < count; i++) {
                    const entry = offset + 2 + i * 12, tag = word(entry);
                    if (!nested && tag === 34665) { visit(long(entry + 8), true); continue; }
                    if (!(nested ? [40961, 40962, 40963] : [274, 282, 283, 296]).includes(tag)) return reject();
                }
                if (long(offset + 2 + count * 12) !== 0) return reject();
            };
            visit(long(4), false);
        }
        if (segment.marker === 237) {
            if (ascii(bytes, segment.start, 14) !== 'Photoshop 3.0\0') return reject();
            for (let offset = segment.start + 14; offset < segment.end;) {
                if (offset + 7 > segment.end || ascii(bytes, offset, 4) !== '8BIM') return reject();
                const id = u16(bytes, offset + 4), nameLength = bytes[offset + 6];
                offset += 6 + ((nameLength + 2) & ~1);
                const length = u32(bytes, offset); offset += 4;
                if (offset + length > segment.end) return reject();
                if (id === 1028 ? length !== 0 : id !== 1061 || length !== 16 ||
                    Array.from(bytes.subarray(offset, offset + length)).map((v) => v.toString(16).padStart(2, '0')).join('') !== 'd41d8cd98f00b204e9800998ecf8427e') return reject();
                offset += length + (length & 1);
            }
        }
    }
}

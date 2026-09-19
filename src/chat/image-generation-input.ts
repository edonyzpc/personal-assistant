import { getPlatformDocument } from '../platform-dom';
import { assertNewChatImageSupported, inspectImage } from './image-format';
import { checkImageOperation, ImageProcessingError } from './image-policy';

const MAX_WAN_INPUT_BYTES = 20 * 1024 * 1024;

/** Make an opaque, metadata-free, full-size copy for Wan. Never alter the vault original. */
export async function prepareWanImageInput(bytes: ArrayBuffer, isCurrent: () => boolean,
    allowWhiteBackground = false): Promise<{
    dataUrl: string;
    whiteBackgroundApplied: boolean;
}> {
    if (bytes.byteLength > MAX_WAN_INPUT_BYTES) throw new ImageProcessingError('original-byte-limit');
    assertNewChatImageSupported(bytes);
    const source = inspectImage(bytes);
    if (source.width < 240 || source.height < 240 || source.width > 8000 || source.height > 8000
        || source.width / source.height > 8 || source.height / source.width > 8) {
        throw new ImageProcessingError('pixel-limit');
    }
    checkImageOperation(undefined, isCurrent);
    const image = getPlatformDocument().createElement('img');
    const sourceUrl = URL.createObjectURL(new Blob([bytes], { type: source.mime }));
    try {
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new ImageProcessingError('decode-failed'));
            image.src = sourceUrl;
        });
        checkImageOperation(undefined, isCurrent);
        const canvas = getPlatformDocument().createElement('canvas');
        try {
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new ImageProcessingError('encode-failed');
            context.drawImage(image, 0, 0);
            // Wan 2.7 does not accept alpha. Never change the outbound copy
            // until the user has approved a white background for this task.
            let whiteBackgroundApplied = false;
            for (let y = 0; y < canvas.height; y += 64) {
                const height = Math.min(64, canvas.height - y);
                const pixels = context.getImageData(0, y, canvas.width, height).data;
                for (let i = 3; i < pixels.length; i += 4) {
                    if (pixels[i] !== 255) { whiteBackgroundApplied = true; break; }
                }
                if (whiteBackgroundApplied) break;
            }
            if (whiteBackgroundApplied && !allowWhiteBackground) {
                throw new Error('image_generation:transparent_input_needs_confirmation');
            }
            if (whiteBackgroundApplied) {
                context.globalCompositeOperation = 'destination-over';
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.globalCompositeOperation = 'source-over';
            }
            checkImageOperation(undefined, isCurrent);
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
                (value) => value ? resolve(value) : reject(new ImageProcessingError('encode-failed')), 'image/png'));
            if (blob.type !== 'image/png' || blob.size > MAX_WAN_INPUT_BYTES) {
                throw new ImageProcessingError('output-byte-limit');
            }
            const output = await blob.arrayBuffer();
            checkImageOperation(undefined, isCurrent);
            const verified = inspectImage(output);
            if (verified.mime !== 'image/png' || verified.width !== canvas.width || verified.height !== canvas.height) {
                throw new ImageProcessingError('encode-failed');
            }
            return { dataUrl: `data:image/png;base64,${encodeBase64(output)}`, whiteBackgroundApplied };
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    } finally {
        image.onload = null;
        image.onerror = null;
        image.src = '';
        URL.revokeObjectURL(sourceUrl);
    }
}

function encodeBase64(bytes: ArrayBuffer): string {
    const values = new Uint8Array(bytes);
    const chunks: string[] = [];
    // Each chunk length is divisible by three, so padding only appears once.
    for (let offset = 0; offset < values.length; offset += 24_576) {
        chunks.push(globalThis.btoa(String.fromCharCode(...values.subarray(offset, offset + 24_576))));
    }
    return chunks.join('');
}

/** Device-local media admission. Model limits may be stricter. */
export const IMAGE_POLICY = Object.freeze({
    maxOriginalBytes: 20 * 1024 * 1024,
    maxDecodedPixels: 48_000_000,
    maxImagesPerTurn: 8,
    maxVariantBytes: 4 * 1024 * 1024,
    maxRequestImageBytes: 24 * 1024 * 1024,
    processingTimeoutMs: 15_000,
    cacheMaxBytes: 64 * 1024 * 1024,
    maxPreviewEdge: 1536,
    maxProviderEdge: 3200,
    jpegQuality: 0.9,
});

export const PROCESSOR_VERSION = 1;
export type ImagePurpose = 'preview' | 'provider' | 'note';
export type ImageProcessingErrorCode = 'unsupported' | 'animated' | 'multiple-images' | 'unsafe-svg' | 'malformed'
    | 'original-byte-limit' | 'pixel-limit' | 'output-byte-limit' | 'decode-failed' | 'encode-failed'
    | 'metadata-invalid' | 'conversion-unavailable' | 'conversion-failed' | 'source-changed'
    | 'cancelled' | 'timeout' | 'disposed' | 'stale' | 'cleanup-failed' | 'queue-full';

export class ImageProcessingError extends Error {
    constructor(public readonly code: ImageProcessingErrorCode) {
        super(`image_processing:${code}`);
        this.name = 'ImageProcessingError';
    }
}

export function imagePolicyFingerprint(purpose: ImagePurpose): string {
    const edge = purpose === 'preview' ? IMAGE_POLICY.maxPreviewEdge
        : purpose === 'provider' ? IMAGE_POLICY.maxProviderEdge : 'native';
    return `v${PROCESSOR_VERSION}:${purpose}:jpeg:${edge}:q${IMAGE_POLICY.jpegQuality}:white:source-metadata-stripped`;
}

export async function imageSourceHash(bytes: ArrayBuffer): Promise<string> {
    return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)))
        .map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function checkImageOperation(signal?: AbortSignal, isCurrent?: () => boolean): void {
    if (signal?.aborted) {
        throw signal.reason instanceof ImageProcessingError ? signal.reason : new ImageProcessingError('cancelled');
    }
    if (isCurrent && !isCurrent()) throw new ImageProcessingError('stale');
}

export function checkImageDimensions(width: number, height: number): void {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
        throw new ImageProcessingError('malformed');
    }
    if (width * height > IMAGE_POLICY.maxDecodedPixels) throw new ImageProcessingError('pixel-limit');
}

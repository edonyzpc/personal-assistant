import type { App } from 'obsidian';
import { getPlatformDocument } from '../platform-dom';
import { assertNewChatImageSupported, assertSafeEncodedJpeg, inspectImage, type ChatImageMime } from './image-format';
import { checkImageDimensions, checkImageOperation, IMAGE_POLICY, imagePolicyFingerprint, ImageProcessingError,
    imageSourceHash, PROCESSOR_VERSION, type ImagePurpose } from './image-policy';

export { IMAGE_POLICY, imagePolicyFingerprint, ImageProcessingError, PROCESSOR_VERSION } from './image-policy';
export type { ImagePurpose, ImageProcessingErrorCode } from './image-policy';

export interface ProcessImageOptions {
    purpose: ImagePurpose;
    signal?: AbortSignal;
    originalPath?: string;
    isCurrent?: () => boolean;
}
export interface ProcessedImage {
    blob: Blob;
    mime: 'image/jpeg';
    width: number;
    height: number;
    byteLength: number;
    sourceMime: ChatImageMime;
    sourceHash: string;
    processorVersion: number;
    policyFingerprint: string;
}
interface ImageTask {
    controller: AbortController;
    bytes?: ArrayBuffer;
    started: boolean;
    settled: boolean;
    finish: (error?: unknown, value?: ProcessedImage) => void;
}

/** One owner/queue per asset service; all operations leave original bytes untouched. */
export class ImageProcessor {
    private tail: Promise<void> = Promise.resolve();
    private readonly tasks = new Set<ImageTask>();
    private disposed = false;

    constructor(_app: Pick<App, 'vault'>) {}

    process(bytes: ArrayBuffer, options: ProcessImageOptions): Promise<ProcessedImage> {
        if (this.disposed) return Promise.reject(new ImageProcessingError('disposed'));
        if (bytes.byteLength > IMAGE_POLICY.maxOriginalBytes) return Promise.reject(new ImageProcessingError('original-byte-limit'));
        if (!['preview', 'provider', 'note'].includes(options.purpose)) return Promise.reject(new ImageProcessingError('unsupported'));
        if (this.tasks.size >= IMAGE_POLICY.maxImagesPerTurn) return Promise.reject(new ImageProcessingError('queue-full'));
        try { checkImageOperation(options.signal, options.isCurrent); } catch (error) { return Promise.reject(error); }
        let snapshot: ArrayBuffer;
        try { snapshot = bytes.slice(0); } catch { return Promise.reject(new ImageProcessingError('malformed')); }
        const controller = new AbortController();
        let task: ImageTask;
        const result = new Promise<ProcessedImage>((resolve, reject) => {
            const relayAbort = (): void => controller.abort(new ImageProcessingError('cancelled'));
            const queuedAbort = (): void => {
                if (!task.started) task.finish(controller.signal.reason ?? new ImageProcessingError('cancelled'));
            };
            task = { controller, bytes: snapshot, started: false, settled: false, finish: (error, value) => {
                if (task.settled) return;
                task.settled = true; task.bytes = undefined; this.tasks.delete(task);
                controller.signal.removeEventListener('abort', queuedAbort); options.signal?.removeEventListener('abort', relayAbort);
                if (error) reject(error); else if (value) resolve(value); else reject(new ImageProcessingError('decode-failed'));
            } };
            this.tasks.add(task);
            controller.signal.addEventListener('abort', queuedAbort, { once: true });
            options.signal?.addEventListener('abort', relayAbort, { once: true });
            if (options.signal?.aborted) relayAbort();
        });
        this.tail = this.tail.then(async () => {
            if (task.settled) return;
            task.started = true;
            const timer = setTimeout(() => controller.abort(new ImageProcessingError('timeout')), IMAGE_POLICY.processingTimeoutMs);
            try {
                checkImageOperation(controller.signal, options.isCurrent);
                if (!task.bytes) throw new ImageProcessingError('cancelled');
                task.finish(undefined, await this.run(task.bytes, options, controller.signal));
            } catch (error) { task.finish(error); }
            finally { clearTimeout(timer); }
        });
        return result;
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        for (const task of this.tasks) task.controller.abort(new ImageProcessingError('disposed'));
        await this.tail;
    }

    private async loadImage(bytes: ArrayBuffer, mime: ChatImageMime, signal: AbortSignal): Promise<{ image: HTMLImageElement; release: () => void }> {
        checkImageOperation(signal);
        const image = getPlatformDocument().createElement('img');
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        let released = false;
        const release = (): void => {
            if (released) return;
            released = true; image.onload = null; image.onerror = null; image.src = ''; URL.revokeObjectURL(url);
        };
        try {
            await this.wait<void>((resolve, reject) => {
                image.onload = () => resolve(); image.onerror = () => reject(new ImageProcessingError('decode-failed')); image.src = url;
            }, signal);
            checkImageOperation(signal);
            checkImageDimensions(image.naturalWidth, image.naturalHeight);
            return { image, release };
        } catch (error) { release(); throw error; }
    }

    private wait<T>(start: (resolve: (value: T) => void, reject: (error: unknown) => void) => void, signal: AbortSignal): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const finish = (error?: unknown, value?: T): void => {
                if (settled) return; settled = true; signal.removeEventListener('abort', abort);
                if (error) reject(error); else resolve(value as T);
            };
            const abort = (): void => { try { checkImageOperation(signal); } catch (error) { finish(error); } };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) { abort(); return; }
            try { start((value) => finish(undefined, value), (error) => finish(error)); } catch (error) { finish(error); }
        });
    }

    private async run(bytes: ArrayBuffer, options: ProcessImageOptions, signal: AbortSignal): Promise<ProcessedImage> {
        assertNewChatImageSupported(bytes);
        const sourceHash = await imageSourceHash(bytes);
        checkImageOperation(signal, options.isCurrent);
        const inspected = inspectImage(bytes);
        for (const embedded of inspected.embeddedImages) {
            const decoded = await this.loadImage(embedded.bytes, embedded.mime, signal);
            decoded.release(); checkImageOperation(signal, options.isCurrent);
        }
        const decoded = await this.loadImage(bytes, inspected.mime, signal);
        let canvas: HTMLCanvasElement | undefined;
        try {
            canvas = getPlatformDocument().createElement('canvas');
            checkImageOperation(signal, options.isCurrent);
            const width = decoded.image.naturalWidth, height = decoded.image.naturalHeight;
            const edge = options.purpose === 'preview' ? IMAGE_POLICY.maxPreviewEdge
                : options.purpose === 'provider' ? IMAGE_POLICY.maxProviderEdge : Math.max(width, height);
            const scale = Math.min(1, edge / Math.max(width, height));
            canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new ImageProcessingError('encode-failed');
            context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
            // Browser image decoding already applies EXIF orientation. Never
            // rotate again; Canvas pixels and the exported dimensions agree.
            decoded.release();
            const outputWidth = canvas.width, outputHeight = canvas.height;
            const encodingCanvas = canvas;
            const blob = await this.wait<Blob>((resolve, reject) => encodingCanvas.toBlob((value) => {
                if (value) resolve(value); else reject(new ImageProcessingError('encode-failed'));
            }, 'image/jpeg', IMAGE_POLICY.jpegQuality), signal);
            canvas.width = 0; canvas.height = 0;
            checkImageOperation(signal, options.isCurrent);
            if (blob.type !== 'image/jpeg') throw new ImageProcessingError('encode-failed');
            if (blob.size > IMAGE_POLICY.maxVariantBytes) throw new ImageProcessingError('output-byte-limit');
            const output = await blob.arrayBuffer();
            checkImageOperation(signal, options.isCurrent);
            const outputInfo = inspectImage(output);
            if (outputInfo.format !== 'jpeg') throw new ImageProcessingError('encode-failed');
            assertSafeEncodedJpeg(output);
            const verified = await this.loadImage(output, 'image/jpeg', signal);
            try {
                if (verified.image.naturalWidth !== outputWidth || verified.image.naturalHeight !== outputHeight) throw new ImageProcessingError('encode-failed');
            } finally { verified.release(); }
            checkImageOperation(signal, options.isCurrent);
            return { blob, mime: 'image/jpeg', width: outputWidth, height: outputHeight, byteLength: blob.size,
                sourceMime: inspected.mime, sourceHash, processorVersion: PROCESSOR_VERSION, policyFingerprint: imagePolicyFingerprint(options.purpose) };
        } finally { decoded.release(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
    }
}

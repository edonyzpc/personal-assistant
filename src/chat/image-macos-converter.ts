import { FileSystemAdapter, Platform, type App } from 'obsidian';
import { checkImageOperation, IMAGE_POLICY, ImageProcessingError, imageSourceHash } from './image-policy';

interface MacConversionOptions {
    originalPath: string;
    sourceBytes: ArrayBuffer;
    sourceHash: string;
    signal: AbortSignal;
    isCurrent?: () => boolean;
}

/** Only this guarded function touches Node. No shell, download, or native addon. */
export async function convertMacOsHeicToPng(app: Pick<App, 'vault'>, options: MacConversionOptions): Promise<ArrayBuffer> {
    if (!Platform.isDesktopApp || !Platform.isMacOS || !(app.vault.adapter instanceof FileSystemAdapter)) {
        throw new ImageProcessingError('conversion-unavailable');
    }
    checkImageOperation(options.signal, options.isCurrent);
    // Node must be resolved only after both Obsidian platform and adapter guards.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs: typeof import('node:fs/promises') = require('node:fs/promises');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path: typeof import('node:path') = require('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os: typeof import('node:os') = require('node:os');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cp: typeof import('node:child_process') = require('node:child_process');
    const originalPath = options.originalPath;
    if (!originalPath || originalPath.includes('\\') || originalPath.includes('\0') || path.isAbsolute(originalPath) ||
        originalPath.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new ImageProcessingError('source-changed');
    }
    let directory: string | undefined;
    const ownedFiles: string[] = [];
    let outputBytes: ArrayBuffer | undefined;
    let failure: unknown;
    try {
        const base = await fs.realpath(app.vault.adapter.getBasePath());
        const source = await fs.realpath(path.resolve(base, originalPath));
        if (!source.startsWith(base + path.sep)) throw new ImageProcessingError('source-changed');
        const handle = await fs.open(source, 'r');
        let originalBytes: ArrayBuffer;
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > IMAGE_POLICY.maxOriginalBytes) throw new ImageProcessingError('source-changed');
            const original = new Uint8Array(stat.size);
            let offset = 0;
            while (offset < original.byteLength) {
                checkImageOperation(options.signal, options.isCurrent);
                const { bytesRead } = await handle.read(original, offset, original.byteLength - offset, offset);
                if (!bytesRead) throw new ImageProcessingError('source-changed');
                offset += bytesRead;
            }
            if ((await handle.stat()).size !== original.byteLength) throw new ImageProcessingError('source-changed');
            originalBytes = original.buffer;
        } finally { await handle.close(); }
        if (await imageSourceHash(originalBytes) !== options.sourceHash ||
            await imageSourceHash(options.sourceBytes) !== options.sourceHash) throw new ImageProcessingError('source-changed');
        checkImageOperation(options.signal, options.isCurrent);
        // Entered cleanup scope before mkdtemp: cancellation during its write
        // still waits and removes the directory that was actually created.
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-chat-image-'));
        const input = path.join(directory, 'source.heic');
        const output = path.join(directory, 'intermediate.png');
        checkImageOperation(options.signal, options.isCurrent);
        // A private snapshot prevents source rename/replace races while sips runs.
        const inputHandle = await fs.open(input, 'wx', 0o600);
        ownedFiles.push(input);
        try { await inputHandle.writeFile(new Uint8Array(options.sourceBytes)); }
        finally { await inputHandle.close(); }
        checkImageOperation(options.signal, options.isCurrent);
        ownedFiles.push(output);
        await new Promise<void>((resolve, reject) => {
            let child: import('node:child_process').ChildProcess | undefined;
            let terminationTimer: ReturnType<typeof setTimeout> | undefined;
            const abort = (): void => {
                try { child?.kill('SIGTERM'); } catch { /* Exit callback owns completion. */ }
                terminationTimer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch { /* Already exited. */ } }, 2000);
            };
            const finish = (error: Error | null, _stdout = '', stderr = ''): void => {
                if (terminationTimer !== undefined) clearTimeout(terminationTimer);
                options.signal.removeEventListener('abort', abort);
                try {
                    checkImageOperation(options.signal, options.isCurrent);
                    if (error || /CoreVideo|IOSurface/i.test(stderr)) throw new ImageProcessingError('conversion-failed');
                    resolve();
                } catch (failure) { reject(failure); }
            };
            try {
                // execFile callback runs after exit and stdio close. Abort does
                // not reject before that callback, so cleanup cannot race sips.
                child = cp.execFile('/usr/bin/sips', ['-s', 'format', 'png', input, '--out', output],
                    { shell: false, maxBuffer: 8192 }, finish);
                options.signal.addEventListener('abort', abort, { once: true });
                if (options.signal.aborted) abort();
            } catch (error) { finish(error instanceof Error ? error : new Error('spawn_failed')); }
        });
        checkImageOperation(options.signal, options.isCurrent);
        const stat = await fs.stat(output);
        // The intermediate may be larger than the compressed source. Bound its
        // bytes by the admitted RGBA geometry plus a small PNG envelope.
        if (!stat.isFile() || stat.size > IMAGE_POLICY.maxDecodedPixels * 4 + 1024 * 1024) {
            throw new ImageProcessingError('output-byte-limit');
        }
        const png = await fs.readFile(output);
        checkImageOperation(options.signal, options.isCurrent);
        if (png.length < 8 || png[0] !== 137 || png.toString('ascii', 1, 4) !== 'PNG') throw new ImageProcessingError('conversion-failed');
        outputBytes = Uint8Array.from(png).buffer;
    } catch (error) {
        if (error instanceof ImageProcessingError) failure = error;
        else {
            try { checkImageOperation(options.signal, options.isCurrent); failure = new ImageProcessingError('conversion-failed'); }
            catch (cancelled) { failure = cancelled; }
        }
    } finally {
        const failures: unknown[] = [];
        for (const file of ownedFiles.reverse()) {
            await fs.unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') failures.push(error); });
        }
        if (directory) await fs.rmdir(directory).catch((error: unknown) => failures.push(error));
        // Only exact files and one empty owned directory are removed. Unknown
        // files or cleanup failures must never become successful conversion.
        if (failures.length) failure = new ImageProcessingError('cleanup-failed');
    }
    if (failure) throw failure;
    if (!outputBytes) throw new ImageProcessingError('conversion-failed');
    return outputBytes;
}

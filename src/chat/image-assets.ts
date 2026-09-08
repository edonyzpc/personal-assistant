import { TFile, type App, type EventRef } from 'obsidian';
import { getPlatformCrypto } from '../platform-dom';
import type { ChatHistoryStore } from './chat-history-store';
import { ImageProcessor, IMAGE_POLICY, imagePolicyFingerprint, PROCESSOR_VERSION,
    type ProcessedImage, type ProcessImageOptions } from './image-processor';
import { imageSourceHash, checkImageOperation } from './image-policy';
import { assertNewChatImageSupported, inspectImage } from './image-format';
import { assertImageDeletionPath } from './image-file-safety';
import { cloneImageRef, cloneImageVariant, isChatImageAsset, validateImagePath, type ImageAcquisition, type ImageAsset, type ImagePurpose,
    type ImageRef, type ImageSyncReceipt, type ImageVariantLease, type ImageVariantRecord } from './image-types';

export type { ImageAsset, ImageRef, ImageVariantLease } from './image-types';
export function imageDirectoryIgnoreRule(directory: string): string {
    validateImagePath(directory);
    return `/${directory.replace(/./g, (character) => '\\!#[]*? '.includes(character) ? `\\${character}` : character)}/`;
}
interface ImageProcessorPort {
    process(bytes: ArrayBuffer, options: ProcessImageOptions): Promise<ProcessedImage>;
    dispose(): Promise<void>;
}
export interface ImageAssetServiceOptions {
    processor?: ImageProcessorPort;
    isPathAllowed?: (path: string, purpose?: ImagePurpose) => boolean;
}
export interface ImportImageOptions {
    anchorPath?: string; anchorKind?: ImageAsset['anchorKind']; acquisition: ImageAcquisition; signal?: AbortSignal;
    /** Resolve only after the host has displayed the directory notice. No approval gate. */
    onSyncNotice?: (receipt: ImageSyncReceipt) => void | Promise<void>;
}
export interface ImportedImage { asset: ImageAsset; ref: ImageRef; sync: ImageSyncReceipt; }
export interface OriginalImage { asset: ImageAsset; bytes: ArrayBuffer; }
interface ImagePromotion {
    operationId: string;
    sourcePath: string;
    targetPath: string;
    contentHash: string;
    byteLength: number;
    state: 'started' | 'completed';
}
export class ImageAssetError extends Error {
    constructor(public readonly code: string, public readonly asset?: ImageAsset) {
        super(`image_assets:${code}`); this.name = 'ImageAssetError';
    }
}

/** Owns originals and immutable derivative leases, with no remote media access. */
export class ImageAssetService {
    private readonly processor: ImageProcessorPort;
    private tail: Promise<void> = Promise.resolve();
    private disposed = false;
    private disposePromise?: Promise<void>;
    private readonly events: EventRef[] = [];
    private readonly controllers = new Set<AbortController>();
    private readonly pins = new Map<string, number>();
    private leasedBytes = 0;
    private readonly noticeShown = new Set<string>();
    private providerNoticeShown = false;
    private fileRevision = 0;

    constructor(private readonly app: App, private readonly store: ChatHistoryStore,
        private readonly options: ImageAssetServiceOptions = {}) {
        this.processor = options.processor ?? new ImageProcessor(app);
        for (const kind of ['delete', 'modify', 'rename'] as const) {
            this.events.push(app.vault.on(kind as 'rename', (file, oldPath?: string) => {
                this.fileRevision++;
                void this.enqueue(() => this.recordFileEvent(kind, file.path, oldPath)).catch(() => undefined);
            }));
        }
    }

    importFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>, options: ImportImageOptions): Promise<ImportedImage> {
        options = { ...options };
        return this.enqueue(async () => {
            checkImageOperation(options.signal);
            if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > IMAGE_POLICY.maxOriginalBytes) throw new ImageAssetError('original_byte_limit');
            const anchorPath = validateImagePath(options.anchorPath ?? 'PA Chat.md');
            const anchorKind = options.anchorKind ?? 'logical_root';
            const anchorFile = this.checkAnchor(anchorPath, anchorKind);
            // Only one original is loaded at a time. Processing admission is
            // separate, so an acquired unsupported original remains recoverable.
            const bytes = await file.arrayBuffer();
            if (bytes.byteLength > IMAGE_POLICY.maxOriginalBytes) throw new ImageAssetError('original_byte_limit');
            assertNewChatImageSupported(bytes);
            checkImageOperation(options.signal);
            const hash = await imageSourceHash(bytes);
            let asset: ImageAsset | undefined;
            for (const candidate of await this.store.listImageAssets()) {
                if ((candidate.source !== 'imported' && !candidate.importDirectory) || candidate.originalHash !== hash
                    || candidate.anchorPath !== anchorPath || candidate.anchorKind !== anchorKind) continue;
                try {
                    const current = this.file(candidate.originalPath);
                    if (current && await imageSourceHash(await this.readFileBytes(current)) === hash) {
                        asset = { ...candidate, state: 'available', recoveryReason: undefined }; break;
                    }
                    if (!current && candidate.state === 'preserving') { asset = candidate; break; }
                } catch { /* A stale registry entry never authorizes an overwrite. */ }
            }
            if (!asset) {
                const id = this.newId();
                const ext = file.name.match(/\.([a-zA-Z0-9]{1,12})$/)?.[1]?.toLowerCase() ?? 'bin';
                this.checkAnchor(anchorPath, anchorKind, anchorFile);
                const available = validateImagePath(await this.app.fileManager.getAvailablePathForAttachment(`${id}.${ext}`, anchorPath));
                this.checkAnchor(anchorPath, anchorKind, anchorFile);
                const parent = available.includes('/') ? available.slice(0, available.lastIndexOf('/')) + '/' : '';
                const directory = validateImagePath(`${parent}pa-images`);
                const originalPath = validateImagePath(`${directory}/${id}.${ext}`);
                this.assertAllowed(originalPath);
                let detectedMime = 'application/octet-stream';
                try { detectedMime = inspectImage(bytes).mime; } catch { /* Preserve unsupported originals before processing. */ }
                asset = { id, source: 'imported', originalPath, originalHash: hash, byteLength: bytes.byteLength,
                    detectedMime, acquisition: 'original_file', state: 'preserving', anchorPath, anchorKind,
                    createdAt: Date.now(), owners: [], importDirectory: directory };
                // Failure here must never create an unregistered source file.
                await this.store.putImageAsset(asset);
            }
            this.assertAllowed(asset.originalPath);
            const inManagedDirectory = asset.originalPath.startsWith(`${asset.importDirectory}/`);
            const currentDirectory = inManagedDirectory ? asset.importDirectory!
                : asset.originalPath.split('/').slice(0, -1).join('/') || '/';
            const sync = await this.syncReceipt(currentDirectory, inManagedDirectory);
            if (sync.noticeRequired && options.onSyncNotice) {
                await options.onSyncNotice({ ...sync });
                // Do not enqueue the public acknowledgement from inside this
                // operation: it would wait on itself. A failed durable marker
                // merely permits the notice to return on the next import.
                this.noticeShown.add(sync.directory);
                try { await this.store.setImageSetting(`sync-notice:${sync.directory}`, true); } catch { /* Source preservation still has its own durable registry. */ }
            }
            checkImageOperation(options.signal);
            this.assertAllowed(asset.originalPath);
            this.checkAnchor(anchorPath, anchorKind, anchorFile);
            if (asset.state === 'preserving') {
                checkImageOperation(options.signal);
                await this.ensureDirectory(asset.importDirectory!);
                checkImageOperation(options.signal);
                this.checkAnchor(anchorPath, anchorKind, anchorFile);
                try {
                    if (this.app.vault.getAbstractFileByPath(asset.originalPath)) throw new ImageAssetError('path_conflict', asset);
                    await this.app.vault.createBinary(asset.originalPath, bytes);
                    // Once the write starts, cancellation/unload must wait for
                    // its final registry update; the original is never removed.
                    const written = this.file(asset.originalPath);
                    if (!written || await imageSourceHash(await this.readFileBytes(written)) !== hash) {
                        throw new ImageAssetError('source_changed', asset);
                    }
                    asset = { ...asset, state: 'available', recoveryReason: undefined };
                    await this.store.putImageAsset(asset);
                } catch (error) {
                    throw new ImageAssetError(error instanceof ImageAssetError ? error.code : 'preservation_incomplete', asset);
                }
            } else await this.store.putImageAsset(asset);
            checkImageOperation(options.signal);
            return { asset, ref: this.ref(asset), sync };
        });
    }

    addVaultReference(path: string, options: { anchorPath?: string; anchorKind?: ImageAsset['anchorKind']; signal?: AbortSignal } = {}): Promise<{ asset: ImageAsset; ref: ImageRef }> {
        options = { ...options };
        return this.enqueue(async () => {
            checkImageOperation(options.signal); this.assertAllowed(path);
            const anchorPath = validateImagePath(options.anchorPath ?? 'PA Chat.md'), anchorKind = options.anchorKind ?? 'logical_root';
            const anchorFile = this.checkAnchor(anchorPath, anchorKind);
            const file = this.file(path);
            if (!file) throw new ImageAssetError('source_missing');
            const bytes = await this.readFileBytes(file);
            assertNewChatImageSupported(bytes);
            const hash = await imageSourceHash(bytes);
            checkImageOperation(options.signal);
            this.checkAnchor(anchorPath, anchorKind, anchorFile);
            let asset = (await this.store.listImageAssets()).find((a) => a.originalPath === path && a.originalHash === hash
                && a.anchorPath === anchorPath && a.anchorKind === anchorKind);
            if (!asset) {
                let detectedMime = 'application/octet-stream';
                try { detectedMime = inspectImage(bytes).mime; } catch { /* Source remains usable for explicit recovery. */ }
                asset = { id: this.newId(), source: 'vault_reference', originalPath: path, originalHash: hash,
                    byteLength: bytes.byteLength, detectedMime, acquisition: 'original_file', state: 'available',
                    anchorPath, anchorKind, createdAt: Date.now(), owners: [] };
            } else asset = { ...asset, state: 'available', recoveryReason: undefined };
            await this.store.putImageAsset(asset);
            return { asset, ref: this.ref(asset) };
        });
    }

    readOriginal(ref: ImageRef, purpose: ImagePurpose = 'note'): Promise<OriginalImage> {
        ref = cloneImageRef(ref);
        return this.enqueue(() => this.readVerified(ref, purpose));
    }

    relocate(input: ImageRef, path: string): Promise<{ asset: ImageAsset; ref: ImageRef }> {
        input = cloneImageRef(input);
        return this.enqueue(async () => {
            const ref = cloneImageRef(input), existing = await this.store.getImageAsset(ref.assetId);
            if (!existing || existing.originalHash !== ref.contentHash) throw new ImageAssetError('source_unavailable');
            this.assertAllowed(path, 'note');
            const file = this.file(path);
            if (!file) throw new ImageAssetError('source_missing');
            const bytes = await this.readFileBytes(file);
            if (bytes.byteLength !== existing.byteLength || await imageSourceHash(bytes) !== ref.contentHash) throw new ImageAssetError('source_changed');
            this.assertAllowed(path, 'note');
            if (this.file(path) !== file || file.path !== path) throw new ImageAssetError('source_changed');
            // Explicitly selected copies are user-owned, even if their bytes
            // match an earlier PA import. Relocation never grants trash rights.
            const asset: ImageAsset = { ...existing, originalPath: path, source: 'vault_reference', state: 'available', recoveryReason: undefined };
            await this.store.putImageAsset(asset); await this.store.clearImageVariants(asset.id);
            const promotion = await this.promotion(ref);
            if (promotion) {
                // Explicit relocation is a new user choice, not proof that an
                // earlier PA move completed. Keep its evidence off the read path.
                await this.store.setImageSetting(`promotion-history:${asset.id}:${promotion.operationId}`, promotion);
                await this.store.setImageSetting(this.promotionKey(ref), null);
            }
            this.fileRevision++;
            return { asset, ref };
        });
    }

    verify(ref: ImageRef, purpose: ImagePurpose = 'provider'): Promise<{ asset: ImageAsset; isCurrent: () => boolean }> {
        ref = cloneImageRef(ref);
        return this.enqueue(async () => {
            await this.recoverPromotion(ref);
            const revision = this.fileRevision;
            const { asset } = await this.readVerified(ref, purpose);
            const file = this.file(asset.originalPath), mtime = file?.stat.mtime, size = file?.stat.size;
            return { asset, isCurrent: () => {
                if (this.disposed || this.fileRevision !== revision || !file || file.path !== asset.originalPath
                    || this.file(asset.originalPath) !== file || file.stat.mtime !== mtime || file.stat.size !== size) return false;
                try { this.assertAllowed(asset.originalPath, purpose); return true; } catch { return false; }
            } };
        });
    }

    /** A durable intent owns recovery across the vault rename and local registry. */
    promoteToNote(input: ImageRef, options: { sourcePath: string; targetPath: string | (() => Promise<string>); operationId: string; signal?: AbortSignal }): Promise<{ path: string }> {
        const ref = cloneImageRef(input);
        options = { ...options };
        return this.enqueue(async () => {
            checkImageOperation(options.signal);
            validateImagePath(options.sourcePath);
            if (!/^[A-Za-z0-9_-]{1,160}$/.test(options.operationId)) throw new ImageAssetError('promotion_identity_invalid');
            await this.recoverPromotion(ref);
            let promotion = await this.promotion(ref);
            if (promotion?.state === 'completed') {
                if (promotion.sourcePath !== options.sourcePath) throw new ImageAssetError('source_changed');
                const current = await this.readVerified(ref, 'note');
                if (current.asset.originalPath !== promotion.targetPath) throw new ImageAssetError('source_changed');
                return { path: promotion.targetPath };
            }
            if (promotion && (promotion.operationId !== options.operationId || promotion.sourcePath !== options.sourcePath)) {
                throw new ImageAssetError('promotion_incomplete');
            }
            const original = await this.readVerified(ref, 'note');
            if (original.asset.originalPath !== options.sourcePath || !isChatImageAsset(original.asset)) throw new ImageAssetError('source_changed');
            assertNewChatImageSupported(original.bytes);
            if (!promotion) {
                const targetPath = validateImagePath(typeof options.targetPath === 'function' ? await options.targetPath() : options.targetPath);
                if (targetPath.split('/').slice(0, -1).includes('pa-images')) throw new ImageAssetError('path_conflict');
                this.assertAllowed(targetPath, 'note');
                if (this.app.vault.getAbstractFileByPath(targetPath)) throw new ImageAssetError('path_conflict');
                promotion = { operationId: options.operationId, sourcePath: options.sourcePath, targetPath,
                    contentHash: ref.contentHash, byteLength: original.bytes.byteLength, state: 'started' };
            }
            // Every alias gets recovery evidence before any source can disappear.
            for (const asset of await this.store.listImageAssets()) {
                if (asset.originalPath === promotion.sourcePath && asset.originalHash === ref.contentHash) {
                    await this.store.setImageSetting(this.promotionKey(this.ref(asset)), promotion);
                }
            }
            checkImageOperation(options.signal);
            this.assertAllowed(promotion.sourcePath, 'note'); this.assertAllowed(promotion.targetPath, 'note');
            const parent = promotion.targetPath.split('/').slice(0, -1).join('/');
            if (parent) await this.ensureDirectory(parent);
            const source = this.file(promotion.sourcePath);
            const revision = this.fileRevision, mtime = source?.stat.mtime, size = source?.stat.size;
            if (!source || await imageSourceHash(await this.readFileBytes(source)) !== promotion.contentHash) throw new ImageAssetError('source_changed');
            checkImageOperation(options.signal);
            this.assertAllowed(promotion.sourcePath, 'note'); this.assertAllowed(promotion.targetPath, 'note');
            if (this.fileRevision !== revision || source.stat.mtime !== mtime || source.stat.size !== size
                || source.path !== promotion.sourcePath || this.file(promotion.sourcePath) !== source
                || this.app.vault.getAbstractFileByPath(promotion.targetPath)) throw new ImageAssetError('path_conflict');
            await this.app.fileManager.renameFile(source, promotion.targetPath);
            // Finish registry admission even if cancellation arrived during rename.
            await this.recoverPromotion(ref);
            const completed = await this.promotion(ref);
            if (completed?.state !== 'completed') throw new ImageAssetError('promotion_incomplete');
            return { path: completed.targetPath };
        });
    }

    private promotionKey(ref: ImageRef): string { return `promotion:v1:${ref.assetId}`; }

    private async promotion(ref: ImageRef): Promise<ImagePromotion | null> {
        const value = await this.store.getImageSetting<ImagePromotion>(this.promotionKey(ref));
        if (!value) return null;
        if (!['started', 'completed'].includes(value.state) || value.contentHash !== ref.contentHash
            || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0
            || typeof value.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.operationId)) {
            throw new ImageAssetError('promotion_invalid');
        }
        validateImagePath(value.sourcePath); validateImagePath(value.targetPath);
        if (value.sourcePath === value.targetPath || value.targetPath.split('/').slice(0, -1).includes('pa-images')) throw new ImageAssetError('promotion_invalid');
        return value;
    }

    private async recoverPromotion(ref: ImageRef): Promise<void> {
        const promotion = await this.promotion(ref);
        if (!promotion || promotion.state === 'completed') return;
        this.assertAllowed(promotion.targetPath, 'note');
        const source = this.app.vault.getAbstractFileByPath(promotion.sourcePath);
        const target = this.app.vault.getAbstractFileByPath(promotion.targetPath);
        if (source) {
            this.assertAllowed(promotion.sourcePath, 'note');
            if (target) throw new ImageAssetError('path_conflict');
            return; // Reading does not start a pending user-authorized move.
        }
        if (!(target instanceof TFile)) throw new ImageAssetError('source_missing');
        const revision = this.fileRevision, mtime = target.stat.mtime, size = target.stat.size;
        const bytes = await this.readFileBytes(target);
        if (bytes.byteLength !== promotion.byteLength || await imageSourceHash(bytes) !== promotion.contentHash
            || this.fileRevision !== revision || target.stat.mtime !== mtime || target.stat.size !== size
            || target.path !== promotion.targetPath || this.file(promotion.targetPath) !== target) throw new ImageAssetError('source_changed');
        this.assertAllowed(promotion.targetPath, 'note');
        const aliases = (await this.store.listImageAssets()).filter((asset) => asset.originalHash === promotion.contentHash
            && [promotion.sourcePath, promotion.targetPath].includes(asset.originalPath));
        for (const asset of aliases) {
            await this.store.putImageAsset({ ...asset, originalPath: promotion.targetPath, source: 'vault_reference',
                state: 'available', recoveryReason: undefined });
        }
        // Mark complete only after all shared references have been repaired.
        for (const asset of aliases) {
            const previous = await this.promotion(this.ref(asset));
            if (previous?.operationId === promotion.operationId) {
                await this.store.setImageSetting(this.promotionKey(this.ref(asset)), { ...promotion, state: 'completed' });
            }
        }
        this.fileRevision++;
    }

    resolveVariant(input: ImageRef, purpose: ImagePurpose, options: { signal?: AbortSignal } = {}): Promise<ImageVariantLease> {
        input = cloneImageRef(input); options = { ...options };
        return this.enqueue(async () => {
            checkImageOperation(options.signal);
            const ref = cloneImageRef(input), original = await this.readVerified(ref, purpose);
            const id = `${ref.assetId}:${ref.contentHash}:${imagePolicyFingerprint(purpose)}`;
            let cached: ImageVariantRecord | null = null;
            try { cached = await this.store.getImageVariant(id); } catch { /* Cache is optional; original verification is not. */ }
            if (cached && (cached.assetId !== ref.assetId || cached.contentHash !== ref.contentHash
                || cached.purpose !== purpose || cached.processorVersion !== PROCESSOR_VERSION
                || cached.policyFingerprint !== imagePolicyFingerprint(purpose))) cached = null;
            if (cached) {
                // A restored IDB Blob can retain valid metadata after its backing
                // bytes become unreadable. Only readable bytes authorize reuse.
                let cachedBytes: ArrayBuffer | undefined;
                try { cachedBytes = await cached.blob.arrayBuffer(); } catch { /* Rebuild this optional cache entry below. */ }
                checkImageOperation(options.signal, () => !this.disposed);
                cached = cachedBytes?.byteLength === cached.byteLength
                    ? { ...cached, blob: new Blob([cachedBytes], { type: cached.mime }) }
                    : null;
            }
            let record: ImageVariantRecord;
            if (cached) {
                await this.readVerified(ref, purpose);
                checkImageOperation(options.signal, () => !this.disposed);
                record = { ...cached, lastUsedAt: Date.now() };
            }
            else {
                const controller = new AbortController(); this.controllers.add(controller);
                const abort = (): void => controller.abort(options.signal?.reason);
                options.signal?.addEventListener('abort', abort, { once: true });
                if (options.signal?.aborted) abort();
                try {
                    assertNewChatImageSupported(original.bytes);
                    const processed = await this.processor.process(original.bytes, { purpose, signal: controller.signal,
                        originalPath: original.asset.originalPath, isCurrent: () => !this.disposed });
                    checkImageOperation(controller.signal);
                    if (processed.sourceHash !== ref.contentHash || processed.processorVersion !== PROCESSOR_VERSION
                        || processed.policyFingerprint !== imagePolicyFingerprint(purpose)) throw new ImageAssetError('source_changed');
                    await this.readVerified(ref, purpose);
                    record = { id, assetId: ref.assetId, contentHash: ref.contentHash, purpose,
                        processorVersion: processed.processorVersion, policyFingerprint: processed.policyFingerprint,
                        blob: processed.blob, mime: processed.mime, width: processed.width, height: processed.height,
                        byteLength: processed.byteLength, lastUsedAt: Date.now() };
                } finally { options.signal?.removeEventListener('abort', abort); this.controllers.delete(controller); }
            }
            record = cloneImageVariant(record);
            checkImageOperation(options.signal);
            let persistent = true;
            try { await this.store.putImageVariant(record, IMAGE_POLICY.cacheMaxBytes, [...this.pins.keys()]); }
            catch { persistent = false; }
            checkImageOperation(options.signal);
            return this.lease(record, persistent);
        });
    }

    listAssets(): Promise<ImageAsset[]> {
        return this.enqueue(async () => {
            for (const asset of await this.store.listImageAssets()) {
                try { await this.recoverPromotion(this.ref(asset)); }
                catch { /* A single unavailable source must not hide other registered images. */ }
            }
            return this.store.listImageAssets();
        });
    }
    recoverPending(): Promise<ImageAsset[]> {
        return this.enqueue(async () => {
            const recovered: ImageAsset[] = [];
            for (const pending of await this.store.listImageAssets()) {
                if (pending.source !== 'imported' || pending.state !== 'preserving') continue;
                this.assertAllowed(pending.originalPath);
                const file = this.file(pending.originalPath);
                const next: ImageAsset = !file ? { ...pending, recoveryReason: 'input_required' }
                    : await imageSourceHash(await this.readFileBytes(file)) === pending.originalHash
                        ? { ...pending, state: 'available', recoveryReason: undefined }
                        : { ...pending, state: 'changed', recoveryReason: 'path_conflict' };
                await this.store.putImageAsset(next); recovered.push(next);
            }
            return recovered;
        });
    }
    clearCache(): Promise<void> { return this.enqueue(() => this.store.clearImageVariants()); }
    /** Device-local disclosure receipt only; never grants provider or source access. */
    showProviderNoticeIfNeeded(show: () => boolean | Promise<boolean>): Promise<void> {
        if (this.disposed) return Promise.reject(new ImageAssetError('disposed'));
        // Share ordering with asset work, but do not require its durable-storage
        // admission: failure to store a disclosure must not prevent showing it.
        const run = this.tail.then(async () => {
            if (this.disposed) throw new ImageAssetError('disposed');
            if (this.providerNoticeShown) return;
            let storageReady = false;
            try { await this.store.initialize(); storageReady = true; }
            catch { /* Showing the notice does not depend on local storage. */ }
            if (storageReady) {
                try {
                    if (await this.store.getImageSetting('provider-notice:v1') === true) {
                        this.providerNoticeShown = true;
                        return;
                    }
                } catch { /* A missing receipt must not hide the first-use disclosure. */ }
            }
            if (this.disposed || !await show()) return;
            this.providerNoticeShown = true;
            if (storageReady) {
                try { await this.store.setImageSetting('provider-notice:v1', true); }
                catch { /* Remember in this instance; a later device restart may disclose again. */ }
            }
        });
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
    acknowledgeSyncNotice(directory: string): Promise<void> {
        return this.enqueue(async () => {
            validateImagePath(directory);
            await this.store.setImageSetting(`sync-notice:${directory}`, true);
            this.noticeShown.add(directory);
        });
    }
    cleanupSelected(selections: ReadonlyArray<{ ref: ImageRef; path: string }>): Promise<string[]> {
        selections = selections.map((selection) => ({ ref: cloneImageRef(selection.ref), path: validateImagePath(selection.path) }));
        return this.enqueue(async () => {
            const removed: string[] = [];
            for (const selected of selections) {
                const { asset } = await this.readVerified(selected.ref, 'note');
                if (asset.source !== 'imported' || !isChatImageAsset(asset) || selected.path !== asset.originalPath) throw new ImageAssetError('cleanup_selection_changed');
                if ((await this.promotion(selected.ref))?.state === 'started') throw new ImageAssetError('promotion_incomplete');
                await assertImageDeletionPath(this.app, asset.originalPath);
                // Recheck immediately before trash; never infer absence of
                // external Markdown references from our internal owner list.
                await this.readVerified(selected.ref, 'note');
                const file = this.file(asset.originalPath);
                if (!file) throw new ImageAssetError('source_missing');
                await this.app.vault.trash(file, true);
                await this.store.putImageAsset({ ...asset, state: 'missing' });
                await this.store.clearImageVariants(asset.id);
                removed.push(asset.id);
            }
            return removed;
        });
    }
    dispose(): Promise<void> {
        if (!this.disposePromise) {
            this.disposed = true;
            for (const event of this.events) this.app.vault.offref(event);
            for (const controller of this.controllers) controller.abort();
            this.disposePromise = this.tail.then(() => this.processor.dispose());
        }
        return this.disposePromise;
    }

    private enqueue<T>(work: () => Promise<T>): Promise<T> {
        if (this.disposed) return Promise.reject(new ImageAssetError('disposed'));
        const run = this.tail.then(async () => {
            if (this.disposed) throw new ImageAssetError('disposed');
            await this.store.initialize();
            return work();
        });
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
    private async readVerified(input: ImageRef, purpose: ImagePurpose): Promise<OriginalImage> {
        const ref = cloneImageRef(input);
        await this.recoverPromotion(ref);
        const asset = await this.store.getImageAsset(ref.assetId);
        if (!asset || asset.originalHash !== ref.contentHash || asset.state === 'preserving') throw new ImageAssetError('source_unavailable', asset ?? undefined);
        this.assertAllowed(asset.originalPath, purpose);
        const file = this.file(asset.originalPath);
        if (!file) {
            await this.store.putImageAsset({ ...asset, state: 'missing' });
            throw new ImageAssetError('source_missing', asset);
        }
        const bytes = await this.readFileBytes(file);
        if (bytes.byteLength !== asset.byteLength || await imageSourceHash(bytes) !== ref.contentHash) {
            await this.store.putImageAsset({ ...asset, state: 'changed' });
            throw new ImageAssetError('source_changed', asset);
        }
        const current = { ...asset, state: 'available' as const, recoveryReason: undefined };
        if (asset.state !== 'available') await this.store.putImageAsset(current);
        return { asset: current, bytes };
    }
    private lease(record: ImageVariantRecord, persistent: boolean): ImageVariantLease {
        if (record.byteLength > IMAGE_POLICY.maxVariantBytes || this.leasedBytes + record.byteLength > IMAGE_POLICY.maxRequestImageBytes) {
            throw new ImageAssetError('lease_budget');
        }
        this.leasedBytes += record.byteLength;
        this.pins.set(record.id, (this.pins.get(record.id) ?? 0) + 1);
        let released = false;
        return { blob: record.blob, mime: record.mime, width: record.width, height: record.height, persistent,
            ...(persistent ? {} : { warning: 'cache_not_retained' as const }), release: () => {
                if (released) return; released = true; this.leasedBytes -= record.byteLength;
                const count = (this.pins.get(record.id) ?? 1) - 1;
                if (count) this.pins.set(record.id, count); else this.pins.delete(record.id);
            } };
    }
    private file(path: string): TFile | null {
        validateImagePath(path);
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }
    private checkAnchor(path: string, kind: ImageAsset['anchorKind'], expected?: TFile | null): TFile | null {
        if (kind === 'logical_root') {
            if (path !== 'PA Chat.md') throw new ImageAssetError('anchor_unavailable');
            return null;
        }
        const file = this.file(path);
        if (!file || (expected && (file !== expected || expected.path !== path))) throw new ImageAssetError('anchor_unavailable');
        return file;
    }
    private async readFileBytes(file: TFile): Promise<ArrayBuffer> {
        if (!Number.isSafeInteger(file.stat.size) || file.stat.size < 0 || file.stat.size > IMAGE_POLICY.maxOriginalBytes) {
            throw new ImageAssetError('original_byte_limit');
        }
        const bytes = await this.app.vault.readBinary(file);
        if (bytes.byteLength > IMAGE_POLICY.maxOriginalBytes) throw new ImageAssetError('original_byte_limit');
        return bytes;
    }
    private assertAllowed(path: string, purpose?: ImagePurpose): void {
        validateImagePath(path);
        if (this.options.isPathAllowed && !this.options.isPathAllowed(path, purpose)) throw new ImageAssetError('path_not_allowed');
    }
    private ref(asset: ImageAsset): ImageRef { return { assetId: asset.id, contentHash: asset.originalHash }; }
    private newId(): string {
        const crypto = getPlatformCrypto();
        if (!crypto?.randomUUID) throw new ImageAssetError('secure_identity_unavailable');
        return `img_${crypto.randomUUID().replace(/-/g, '')}`;
    }
    private async ensureDirectory(directory: string): Promise<void> {
        const parts = validateImagePath(directory).split('/');
        for (let i = 1; i <= parts.length; i++) {
            const path = parts.slice(0, i).join('/');
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) throw new ImageAssetError('path_conflict');
            if (!existing) {
                try { await this.app.vault.createFolder(path); }
                catch (error) { if (!this.app.vault.getAbstractFileByPath(path)) throw error; }
            }
        }
    }
    private async syncReceipt(directory: string, allowConfigure = true): Promise<ImageSyncReceipt> {
        // A user-moved original may share its new folder with ordinary notes.
        // Never exclude that entire folder or claim its old import rule applies.
        const gitignoreRule = allowConfigure ? imageDirectoryIgnoreRule(directory) : '';
        const hasFinalRule = (text: string) => text.split(/\r?\n/)
            .filter((line) => line.trim().length > 0 && !line.startsWith('#')).at(-1) === gitignoreRule;
        let git: ImageSyncReceipt['git'] = allowConfigure ? 'needs_user_setup' : 'unknown';
        const ignore = this.file('.gitignore');
        if (allowConfigure && ignore && typeof this.app.vault.process === 'function') {
            try {
                await this.app.vault.process(ignore, (text) => {
                    // A prior matching line can be overridden by a later
                    // negation. Keep this directory rule last, preserving all
                    // user content and reporting only the checked config state.
                    if (hasFinalRule(text)) return text;
                    const eol = text.includes('\r\n') ? '\r\n' : '\n';
                    return `${text}${text && !text.endsWith('\n') ? eol : ''}${gitignoreRule}${eol}`;
                });
                git = hasFinalRule(await this.app.vault.read(ignore)) ? 'configured' : 'unknown';
            } catch { git = 'unknown'; }
        }
        let dismissed = this.noticeShown.has(directory);
        if (!dismissed) { try { dismissed = await this.store.getImageSetting(`sync-notice:${directory}`) === true; } catch { /* Prompt again when acknowledgement is not durable. */ } }
        return { directory, obsidianSync: 'needs_user_setup', git, iCloud: 'unknown', gitignoreRule,
            gitTracked: 'unknown', previouslyUploaded: 'unknown', noticeDismissed: dismissed, noticeRequired: !dismissed };
    }
    private async recordFileEvent(kind: 'delete' | 'modify' | 'rename', path: string, oldPath?: string): Promise<void> {
        if (kind === 'rename' && oldPath) await this.store.renameConversationImageAnchors(oldPath, path);
        for (const asset of await this.store.listImageAssets()) {
            if (kind === 'rename' && oldPath) {
                const move = (value: string): string => value === oldPath ? path : value.startsWith(oldPath + '/') ? path + value.slice(oldPath.length) : value;
                const originalPath = move(asset.originalPath), anchorPath = asset.anchorKind === 'existing_note' ? move(asset.anchorPath) : asset.anchorPath;
                if (originalPath !== asset.originalPath || anchorPath !== asset.anchorPath) {
                    const next = { ...asset, originalPath, anchorPath };
                    if (!isChatImageAsset(next)) next.source = 'vault_reference';
                    await this.store.putImageAsset(next);
                }
            } else if ((asset.originalPath === path || asset.originalPath.startsWith(path + '/')) && asset.state !== 'preserving') {
                await this.store.putImageAsset({ ...asset, state: kind === 'delete' ? 'missing' : 'changed' });
            }
        }
    }
}

import { TFile, type App, type EventRef } from 'obsidian';
import { getPlatformCrypto } from '../platform-dom';
import type { ChatHistoryStore } from './chat-history-store';
import type { ImageAssetService } from './image-assets';
import { cloneMessageImages, isChatImageAsset, validateImagePath, type MessageImage } from './image-types';
import { inspectImage } from './image-format';
import { imageSourceHash } from './image-policy';
import { cloneWritingVersion, hashWritingText, type WritingVersion } from './writing-types';
import { cloneSaveReceipt, type SaveAttachment, type SaveReceipt } from './save-receipt-types';
import { WRITING_NOTE_PROVENANCE_KEY } from './writing-note-provenance';

export type { SaveReceipt, SaveAttachment } from './save-receipt-types';
export interface PreparedWritingSave {
    operationId: string;
    receipt: SaveReceipt;
    /** Initial full note, preserving exact body and separately marked provenance. */
    previewMarkdown: string;
    release(): void;
}
interface SavePreview { receipt: SaveReceipt; released: boolean; }
interface FileVerification { assertCurrent(): void; release(): void; }
export class WritingSaveError extends Error {
    constructor(public readonly code: string) { super(`writing_save:${code}`); this.name = 'WritingSaveError'; }
}

/** Explicit host save. Image promotion is owned by the image service's durable journal. */
export class WritingSaveAction {
    private readonly previews = new Map<string, SavePreview>();
    private tail: Promise<void> = Promise.resolve();
    private disposed = false;
    private readonly controllers = new Set<AbortController>();

    constructor(private readonly app: App, private readonly store: ChatHistoryStore,
        private readonly images: ImageAssetService, private readonly options: { isPathAllowed?: (path: string) => boolean } = {}) {}

    prepare(input: { writingVersionId: string; targetNotePath: string; images?: readonly MessageImage[]; signal?: AbortSignal }): Promise<PreparedWritingSave> {
        input = { ...input, ...(input.images ? { images: cloneMessageImages(input.images) } : {}) };
        return this.enqueue(async (signal) => {
            input = { ...input, signal };
            this.check(input.signal); this.allowed(input.targetNotePath);
            if (!input.targetNotePath.toLowerCase().endsWith('.md')) throw new WritingSaveError('markdown_path_required');
            if (this.app.vault.getAbstractFileByPath(input.targetNotePath)) throw new WritingSaveError('target_exists');
            const version = await this.version(input.writingVersionId);
            const selected = cloneMessageImages(input.images ?? version.associatedImages);
            const permitted = new Set(version.associatedImages.map((i) => `${i.ref.assetId}:${i.ref.contentHash}`));
            if (selected.some((i) => !permitted.has(`${i.ref.assetId}:${i.ref.contentHash}`))) throw new WritingSaveError('image_outside_version');
            const crypto = getPlatformCrypto();
            if (!crypto?.randomUUID) throw new WritingSaveError('secure_identity_unavailable');
            const operationId = `save_${crypto.randomUUID().replace(/-/g, '')}`;
            const attachments: SaveAttachment[] = [];
            const identities = new Set<string>();
            for (const image of selected) {
                this.check(input.signal);
                const original = await this.images.readOriginal(image.ref, 'note');
                const key = `${original.asset.originalPath}:${image.ref.contentHash}`;
                if (identities.has(key)) continue;
                identities.add(key);
                const inspected = inspectImage(original.bytes);
                if (inspected.format === 'heic') throw new WritingSaveError('heic_unsupported');
                const sourceName = image.label || original.asset.originalPath.split('/').pop()!;
                const extension = inspected.format === 'jpeg' ? 'jpg' : inspected.format;
                attachments.push({ ref: image.ref, sourcePath: original.asset.originalPath, sourceName,
                    attachmentKind: 'original', transfer: isChatImageAsset(original.asset) ? 'move' : 'reference',
                    mime: inspected.mime,
                    filename: `pa-${operationId.slice(-16)}-${attachments.length + 1}.${extension}`,
                    outputHash: image.ref.contentHash, byteLength: original.bytes.byteLength, exportPolicy: 'original:v1', state: 'planned' });
            }
            this.check(input.signal);
            const receipt: SaveReceipt = { id: operationId, operationId, writingVersionId: version.id,
                textHash: version.textHash, targetNotePath: input.targetNotePath, origin: version.origin,
                createdAt: Date.now(), attachments, initialNoteHash: '0'.repeat(64), noteContentHash: '0'.repeat(64),
                noteState: 'pending', state: 'prepared' };
            receipt.initialNoteHash = receipt.noteContentHash = await hashWritingText(this.note(version, receipt, false));
            const preview: SavePreview = { receipt: cloneSaveReceipt(receipt), released: false };
            this.previews.set(operationId, preview);
            return { operationId, receipt: cloneSaveReceipt(receipt), previewMarkdown: this.note(version, receipt, false),
                release: () => this.releasePreview(operationId) };
        }, input.signal);
    }

    execute(operationId: string, options: { signal?: AbortSignal } = {}): Promise<SaveReceipt> {
        return this.enqueue(async (signal) => {
            const existing = await this.store.getSaveReceipt(operationId);
            const preview = this.previews.get(operationId);
            if (!existing && (!preview || preview.released)) throw new WritingSaveError('preview_released');
            const receipt = cloneSaveReceipt(existing ?? preview!.receipt);
            if (!existing) {
                this.check(signal); this.allowed(receipt.targetNotePath);
                if (this.app.vault.getAbstractFileByPath(receipt.targetNotePath)) throw new WritingSaveError('target_exists');
                await this.verifySources(receipt);
                // First durable receipt precedes every note/attachment write.
                await this.store.putSaveReceipt(receipt);
            }
            try { return await this.run(receipt, signal); }
            finally { this.releasePreview(operationId); }
        }, options.signal);
    }

    retry(operationId: string, options: { signal?: AbortSignal } = {}): Promise<SaveReceipt> {
        return this.enqueue(async (signal) => {
            const receipt = await this.store.getSaveReceipt(operationId);
            if (!receipt) throw new WritingSaveError('receipt_unavailable');
            return this.run(receipt, signal);
        }, options.signal);
    }
    listReceipts(writingVersionId?: string): Promise<SaveReceipt[]> { return this.enqueue(() => this.store.listSaveReceipts(writingVersionId)); }
    async dispose(): Promise<void> {
        this.disposed = true;
        for (const controller of this.controllers) controller.abort();
        await this.tail;
        for (const id of [...this.previews.keys()]) this.releasePreview(id);
    }

    private async run(input: SaveReceipt, signal?: AbortSignal): Promise<SaveReceipt> {
        let receipt = cloneSaveReceipt(input);
        const verifications: FileVerification[] = [];
        try {
            this.check(signal); this.allowed(receipt.targetNotePath);
            if (receipt.state === 'completed') {
                const verified = await this.verifyCompleted(receipt); verifications.push(verified);
                this.check(signal); verified.assertCurrent(); return receipt;
            }
            const version = await this.version(receipt.writingVersionId);
            if (version.textHash !== receipt.textHash) throw new WritingSaveError('version_changed');
            await this.verifySources(receipt);
            const initialText = this.note(version, receipt, false);
            if (await hashWritingText(initialText) !== receipt.initialNoteHash) throw new WritingSaveError('receipt_changed');
            let note = this.file(receipt.targetNotePath);
            if (!note) {
                if (receipt.noteState !== 'pending') throw new WritingSaveError('note_missing');
                this.check(signal);
                await this.ensureParent(receipt.targetNotePath);
                this.allowed(receipt.targetNotePath); this.check(signal);
                note = await this.app.vault.create(receipt.targetNotePath, initialText);
            }
            let currentNote = await this.app.vault.read(note), currentHash = await hashWritingText(currentNote);
            if (receipt.finalNoteHash && currentHash === receipt.finalNoteHash) {
                // Crash after Vault.process but before its receipt update.
                const verified = await this.verifyCompleted(receipt); verifications.push(verified);
                this.check(signal); verified.assertCurrent();
                const completed: SaveReceipt = { ...receipt, noteState: 'completed', state: 'completed', noteContentHash: currentHash, failureReason: undefined };
                await this.store.putSaveReceipt(completed);
                this.check(signal); verified.assertCurrent(); return completed;
            }
            if (currentHash !== receipt.noteContentHash || currentNote !== initialText) throw new WritingSaveError('note_changed');
            receipt = { ...receipt, noteState: 'created', state: 'partial', failureReason: undefined };
            await this.store.putSaveReceipt(receipt);
            for (let index = 0; index < receipt.attachments.length; index++) {
                this.check(signal);
                if (this.file(receipt.targetNotePath) !== note || note.path !== receipt.targetNotePath) throw new WritingSaveError('note_changed');
                let attachment = receipt.attachments[index];
                if (attachment.transfer) {
                    const path = await this.transferAttachment(attachment, receipt, index, note, signal);
                    if (attachment.plannedPath && attachment.plannedPath !== path) throw new WritingSaveError('attachment_path_conflict');
                    const file = this.file(path);
                    if (!file || await this.attachmentHash(file, attachment.byteLength) !== attachment.outputHash) throw new WritingSaveError('attachment_changed');
                    // The image service persists its move intent before touching
                    // the file. Only its actual result freezes this receipt path.
                    receipt.attachments[index] = { ...attachment, plannedPath: path, state: 'written', writtenHash: attachment.outputHash };
                    await this.store.putSaveReceipt(receipt);
                    continue;
                }
                if (!attachment.plannedPath) {
                    const path = validateImagePath(await this.app.fileManager.getAvailablePathForAttachment(attachment.filename, note.path));
                    this.allowed(path);
                    if (path.split('/').includes('pa-images') || receipt.attachments.some((a) => a.plannedPath === path)) throw new WritingSaveError('attachment_path_conflict');
                    attachment = { ...attachment, plannedPath: path };
                    receipt.attachments[index] = attachment;
                    await this.store.putSaveReceipt(receipt);
                }
                this.allowed(attachment.plannedPath!);
                let file = this.file(attachment.plannedPath!);
                if (file) {
                    if (await this.attachmentHash(file, attachment.byteLength) !== attachment.outputHash) throw new WritingSaveError('attachment_changed');
                } else {
                    if (attachment.state === 'written') throw new WritingSaveError('attachment_missing');
                    const output = await this.output(attachment);
                    // Materializing a held JPEG or hashing bytes can yield after
                    // the original was read. Re-admit its source at the write.
                    const source = await this.images.verify(attachment.ref, 'note');
                    this.check(signal); this.allowed(attachment.plannedPath!);
                    if (source.asset.originalPath !== attachment.sourcePath || !source.isCurrent()) throw new WritingSaveError('source_changed');
                    file = await this.app.vault.createBinary(attachment.plannedPath!, output);
                    if (await this.attachmentHash(file, attachment.byteLength) !== attachment.outputHash) throw new WritingSaveError('attachment_changed');
                }
                receipt.attachments[index] = { ...attachment, state: 'written', writtenHash: attachment.outputHash };
                await this.store.putSaveReceipt(receipt);
            }
            this.check(signal);
            await this.verifySources(receipt);
            const attachments = await this.verifyAttachments(receipt); verifications.push(attachments);
            const finalText = this.note(version, receipt, true);
            const finalHash = await hashWritingText(finalText);
            if (receipt.finalNoteHash && receipt.finalNoteHash !== finalHash) throw new WritingSaveError('note_plan_changed');
            receipt = { ...receipt, finalNoteHash: finalHash };
            await this.store.putSaveReceipt(receipt);
            this.check(signal); this.allowed(receipt.targetNotePath);
            currentNote = await this.app.vault.read(note); currentHash = await hashWritingText(currentNote);
            if (currentHash !== receipt.noteContentHash || currentNote !== initialText) throw new WritingSaveError('note_changed');
            await this.app.vault.process(note, (current) => {
                this.check(signal); this.allowed(receipt.targetNotePath);
                attachments.assertCurrent();
                if (note!.path !== receipt.targetNotePath || current !== initialText) throw new WritingSaveError('note_changed');
                return finalText;
            });
            const verified = await this.verifyCompleted(receipt); verifications.push(verified);
            this.check(signal); attachments.assertCurrent(); verified.assertCurrent();
            const completed: SaveReceipt = { ...receipt, state: 'completed', noteState: 'completed', noteContentHash: finalHash, failureReason: undefined };
            await this.store.putSaveReceipt(completed);
            // IDB and the vault are separate stores. A change while the durable
            // checkpoint commits must still prevent a successful UI result;
            // retry always verifies the files, including completed receipts.
            this.check(signal); attachments.assertCurrent(); verified.assertCurrent(); return completed;
        } catch (error) {
            const failureReason = error instanceof WritingSaveError ? error.code
                : error instanceof Error && error.name === 'ImageProcessingError' ? 'image_export_failed' : 'write_failed';
            const failed: SaveReceipt = { ...receipt, state: receipt.noteState === 'pending' ? 'failed' : 'partial', failureReason };
            // Durability may itself be unavailable. Return the observed partial
            // state honestly; pre-write plans already identify recovery paths.
            try { await this.store.putSaveReceipt(failed); } catch { /* Retry reads the last durable checkpoint. */ }
            return failed;
        } finally { for (const verified of verifications) verified.release(); }
    }

    private async transferAttachment(attachment: SaveAttachment, receipt: SaveReceipt, index: number, note: TFile, signal?: AbortSignal): Promise<string> {
        if (attachment.transfer === 'reference') {
            const source = await this.images.verify(attachment.ref, 'note');
            this.check(signal); this.allowed(attachment.sourcePath);
            if (source.asset.originalPath !== attachment.sourcePath || !source.isCurrent()) throw new WritingSaveError('source_changed');
            return attachment.sourcePath;
        }
        // A prior promotion is already the shared attachment. Resolve current
        // attachment settings only if the image service must perform a new move.
        const targetPath = async (): Promise<string> => {
            const path = attachment.plannedPath ?? validateImagePath(await this.app.fileManager.getAvailablePathForAttachment(attachment.filename, note.path));
            this.check(signal); this.allowed(path);
            if (path.split('/').includes('pa-images')) throw new WritingSaveError('attachment_path_conflict');
            return path;
        };
        const result = await this.images.promoteToNote(attachment.ref, { sourcePath: attachment.sourcePath, targetPath,
            operationId: `${receipt.id}_${index}`, signal });
        this.check(signal); this.allowed(result.path);
        if (result.path.split('/').includes('pa-images') || receipt.attachments.some((other, i) => i !== index && other.plannedPath === result.path)) {
            throw new WritingSaveError('attachment_path_conflict');
        }
        return result.path;
    }

    private async output(attachment: SaveAttachment): Promise<ArrayBuffer> {
        // Legacy plans remain frozen, but missing HEIC exports cannot restart
        // conversion after the product boundary has changed.
        if (attachment.attachmentKind === 'heic_jpeg') throw new WritingSaveError('heic_unsupported');
        const original = await this.images.readOriginal(attachment.ref, 'note');
        if (original.asset.originalPath !== attachment.sourcePath) throw new WritingSaveError('source_changed');
        const output = original.bytes;
        if (output.byteLength !== attachment.byteLength || await imageSourceHash(output) !== attachment.outputHash) throw new WritingSaveError('export_changed');
        return output;
    }
    private async verifySources(receipt: SaveReceipt): Promise<void> {
        for (const attachment of receipt.attachments) {
            if (attachment.transfer) {
                const source = await this.images.verify(attachment.ref, 'note');
                if (!source.isCurrent() || (attachment.transfer === 'reference' && source.asset.originalPath !== attachment.sourcePath)) {
                    throw new WritingSaveError('source_changed');
                }
                continue;
            }
            // A durable matching formal attachment is already a frozen output.
            // Recovery checks it first and does not require an excluded HEIC
            // original to reappear merely to complete the note links.
            if (attachment.plannedPath) {
                const written = this.file(attachment.plannedPath);
                if (written) {
                    this.allowed(attachment.plannedPath);
                    if (await this.attachmentHash(written, attachment.byteLength) !== attachment.outputHash) throw new WritingSaveError('attachment_changed');
                    continue;
                }
            }
            if (attachment.attachmentKind === 'heic_jpeg') throw new WritingSaveError('heic_unsupported');
            const source = await this.images.verify(attachment.ref, 'note');
            if (source.asset.originalPath !== attachment.sourcePath || !source.isCurrent()) throw new WritingSaveError('source_changed');
        }
    }
    private async verifyAttachments(receipt: SaveReceipt): Promise<FileVerification> {
        const paths = receipt.attachments.map((attachment) => {
            if (!attachment.plannedPath) throw new WritingSaveError('attachment_missing');
            return attachment.plannedPath;
        });
        const verified = this.guardFiles(paths, 'attachment_changed');
        try {
            for (const attachment of receipt.attachments) {
                const file = this.file(attachment.plannedPath!);
                if (!file || await this.attachmentHash(file, attachment.byteLength) !== attachment.outputHash) throw new WritingSaveError('attachment_changed');
            }
            verified.assertCurrent(); return verified;
        } catch (error) { verified.release(); throw error; }
    }
    private async verifyCompleted(receipt: SaveReceipt): Promise<FileVerification> {
        const noteGuard = this.guardFiles([receipt.targetNotePath], 'note_changed');
        let attachments: FileVerification | undefined;
        try {
            attachments = await this.verifyAttachments(receipt);
            const note = this.file(receipt.targetNotePath);
            if (!note || await hashWritingText(await this.app.vault.read(note)) !== receipt.finalNoteHash) throw new WritingSaveError('note_changed');
            const verified = { assertCurrent: (): void => { noteGuard.assertCurrent(); attachments!.assertCurrent(); },
                release: (): void => { noteGuard.release(); attachments!.release(); } };
            verified.assertCurrent(); return verified;
        } catch (error) { noteGuard.release(); attachments?.release(); throw error; }
    }
    private guardFiles(paths: string[], failure: 'note_changed' | 'attachment_changed'): FileVerification {
        const snapshots = paths.map((path) => {
            this.allowed(path);
            const file = this.file(path);
            if (!file) throw new WritingSaveError(failure);
            return { path, file, mtime: file.stat.mtime, size: file.stat.size };
        });
        let changed = false, released = false;
        const events: EventRef[] = [];
        for (const kind of ['modify', 'delete', 'rename'] as const) {
            events.push(this.app.vault.on(kind as 'rename', (file, oldPath?: string) => {
                if ([file.path, oldPath].some((path) => path && snapshots.some((snapshot) =>
                    snapshot.path === path || snapshot.path.startsWith(path + '/')))) changed = true;
            }));
        }
        return {
            assertCurrent: (): void => {
                if (changed || released) throw new WritingSaveError(failure);
                for (const snapshot of snapshots) {
                    this.allowed(snapshot.path);
                    if (snapshot.file.path !== snapshot.path || this.file(snapshot.path) !== snapshot.file
                        || snapshot.file.stat.mtime !== snapshot.mtime || snapshot.file.stat.size !== snapshot.size) throw new WritingSaveError(failure);
                }
            },
            release: (): void => {
                if (released) return; released = true;
                for (const event of events) this.app.vault.offref(event);
            },
        };
    }
    private async attachmentHash(file: TFile, expectedSize: number): Promise<string> {
        if (file.stat.size !== expectedSize) throw new WritingSaveError('attachment_changed');
        const bytes = await this.app.vault.readBinary(file);
        if (bytes.byteLength !== expectedSize) throw new WritingSaveError('attachment_changed');
        return imageSourceHash(bytes);
    }
    private note(version: WritingVersion, receipt: SaveReceipt, completed: boolean): string {
        const provenance = { version: 1, operationId: receipt.id, writingVersionId: version.id,
            origin: version.origin, adoption: version.origin === 'user_edited' ? 'user_edited' : 'ai_adopted',
            textHash: version.textHash, state: completed ? 'completed' : 'incomplete',
            sources: receipt.attachments.map((a) => ({ assetId: a.ref.assetId, originalPath: a.sourcePath,
                sourceName: a.sourceName, plannedFilename: a.filename, originalHash: a.ref.contentHash, attachmentKind: a.attachmentKind, exportPolicy: a.exportPolicy,
                outputHash: a.outputHash, ...(completed ? { attachmentPath: a.plannedPath } : {}) })),
            backgroundSourceRefs: version.backgroundSourceRefs };
        const embeds = completed ? receipt.attachments.map((a) => {
            const file = a.plannedPath && this.file(a.plannedPath);
            if (!file) throw new WritingSaveError('attachment_missing');
            const link = this.app.fileManager.generateMarkdownLink(file, receipt.targetNotePath);
            return link.startsWith('!') ? link : `!${link}`;
        }) : [];
        // JSON flow syntax is valid YAML and escapes arbitrary source labels;
        // the selected body remains byte-for-byte intact after the frontmatter.
        return `---\n${WRITING_NOTE_PROVENANCE_KEY}: ${JSON.stringify(provenance)}\n---\n\n${version.text}${embeds.length ? `\n\n${embeds.join('\n')}` : ''}`;
    }
    private async version(id: string): Promise<WritingVersion> {
        const stored = await this.store.getWritingVersion(id);
        if (!stored) throw new WritingSaveError('version_unavailable');
        const version = cloneWritingVersion(stored);
        if (await hashWritingText(version.text) !== version.textHash) throw new WritingSaveError('version_changed');
        return version;
    }
    private allowed(path: string): void {
        validateImagePath(path);
        if (this.options.isPathAllowed && !this.options.isPathAllowed(path)) throw new WritingSaveError('path_not_allowed');
    }
    private file(path: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(path); return file instanceof TFile ? file : null;
    }
    private async ensureParent(path: string): Promise<void> {
        const parts = path.split('/').slice(0, -1);
        for (let i = 1; i <= parts.length; i++) {
            const parent = parts.slice(0, i).join('/');
            if (!this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
        }
    }
    private releasePreview(operationId: string): void {
        const preview = this.previews.get(operationId);
        if (!preview || preview.released) return;
        preview.released = true;
        this.previews.delete(operationId);
    }
    private check(signal?: AbortSignal): void {
        if (this.disposed) throw new WritingSaveError('disposed');
        if (signal?.aborted) throw new WritingSaveError('cancelled');
    }
    private enqueue<T>(work: (signal: AbortSignal) => Promise<T>, inputSignal?: AbortSignal): Promise<T> {
        if (this.disposed) return Promise.reject(new WritingSaveError('disposed'));
        const task = this.tail.then(async () => {
            this.check(inputSignal);
            const controller = new AbortController(), abort = (): void => controller.abort();
            this.controllers.add(controller); inputSignal?.addEventListener('abort', abort, { once: true });
            if (inputSignal?.aborted) abort();
            try { await this.store.initialize(); this.check(controller.signal); return await work(controller.signal); }
            finally { this.controllers.delete(controller); inputSignal?.removeEventListener('abort', abort); }
        });
        this.tail = task.then(() => undefined, () => undefined); return task;
    }
}

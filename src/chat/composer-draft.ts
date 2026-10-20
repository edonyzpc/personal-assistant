/** View-local ownership for text, images and asynchronous imports. Persistence subscribes to projections. */
import { getFrontMatterInfo, type Editor, type MarkdownView } from 'obsidian';

import { cloneRecordedInputLineage, completeInputLineage, type InputLineage } from '../ai-services/input-lineage';
import type { ImageGenerationPromptOrigin } from './image-generation-types';
import { cloneImageRef, type ImageRef } from './image-types';

export interface ComposerImageTextSource {
    kind: 'note' | 'selection';
    path: string;
    displayName: string;
    text: string;
    documentText: string;
    /** Host-only identity; never copied into a durable image task. */
    file?: unknown;
    selection?: { from: number; to: number };
    inputLineage: InputLineage;
}

export interface ComposerImageGenerationOptions {
    /** Preserve an invalid legacy model for visible failure instead of normalizing it. */
    model: string;
    count: number;
    attachmentPathHint: string;
}

export interface ComposerImageIntent {
    operation?: 'generate' | 'reference' | 'edit';
    referenceImageRefs: ImageRef[];
    parentVersionId?: string;
    textSource?: ComposerImageTextSource;
    promptOrigin?: ImageGenerationPromptOrigin;
    promptLineage?: InputLineage;
    preparedPrompt?: string;
    reusePreparedPrompt?: boolean;
    sourceReceipt?: () => boolean;
    generationOptions?: ComposerImageGenerationOptions;
    /** A persisted source label is not a live source receipt. The user must reselect or remove it. */
    recoverySourceLabel?: string;
    /** Recomputed by local reference verification, never a durable authority. */
    recoveryReferencesMissing?: true;
}

function cloneTextSource(source: ComposerImageTextSource): ComposerImageTextSource {
    return {
        kind: source.kind,
        path: source.path,
        displayName: source.displayName,
        text: source.text,
        documentText: source.documentText,
        ...(source.file !== undefined ? { file: source.file } : {}),
        ...(source.selection ? { selection: { ...source.selection } } : {}),
        inputLineage: cloneRecordedInputLineage(source.inputLineage)!,
    };
}

function cloneGenerationOptions(options: ComposerImageGenerationOptions): ComposerImageGenerationOptions {
    return { model: options.model, count: options.count, attachmentPathHint: options.attachmentPathHint };
}

function clonePromptOrigin(origin: ImageGenerationPromptOrigin): ImageGenerationPromptOrigin {
    return {
        kind: origin.kind,
        displayName: origin.displayName,
        path: origin.path,
        ...(origin.selection ? { selection: { ...origin.selection } } : {}),
        inputLineage: cloneRecordedInputLineage(origin.inputLineage)!,
    };
}

function cloneImageIntent(intent: ComposerImageIntent): ComposerImageIntent {
    return {
        ...(intent.operation ? { operation: intent.operation } : {}),
        referenceImageRefs: intent.referenceImageRefs.map(cloneImageRef),
        ...(intent.parentVersionId ? { parentVersionId: intent.parentVersionId } : {}),
        ...(intent.textSource ? { textSource: cloneTextSource(intent.textSource) } : {}),
        ...(intent.promptOrigin ? { promptOrigin: clonePromptOrigin(intent.promptOrigin) } : {}),
        ...(intent.promptLineage ? { promptLineage: cloneRecordedInputLineage(intent.promptLineage)! } : {}),
        ...(intent.preparedPrompt ? { preparedPrompt: intent.preparedPrompt } : {}),
        ...(intent.reusePreparedPrompt ? { reusePreparedPrompt: true } : {}),
        ...(intent.sourceReceipt ? { sourceReceipt: intent.sourceReceipt } : {}),
        ...(intent.generationOptions ? { generationOptions: cloneGenerationOptions(intent.generationOptions) } : {}),
        ...(intent.recoverySourceLabel ? { recoverySourceLabel: intent.recoverySourceLabel } : {}),
        ...(intent.recoveryReferencesMissing ? { recoveryReferencesMissing: true } : {}),
    };
}

export interface ComposerImageEntry<T> {
    id: number;
    label: string;
    status: "processing" | "ready" | "error";
    value?: T;
    error?: string;
}

export interface ComposerImportHandle {
    draftId: number;
    entryId: number;
    signal: AbortSignal;
}

export interface ComposerSnapshot<T> {
    text: string;
    imageIntent?: ComposerImageIntent;
    writingIntent?: true;
    ghostIntent?: true;
    pageletReselectionRequired?: true;
    images: ComposerImageEntry<T>[];
    draftId: number;
    revision: number;
}

export interface SentComposerDraft<T> {
    snapshot: ComposerSnapshot<T>;
    restoreInto: { draftId: number; revision: number };
}

export class ComposerDraft<T> {
    private readonly listeners = new Set<(change: 'edit' | 'clear' | 'consume') => void>();
    private draftId = 0;
    private revision = 0;
    private nextEntryId = 0;
    private readonly entries = new Map<number, ComposerImageEntry<T>>();
    private readonly imports = new Map<number, AbortController>();
    private imageIntent: ComposerImageIntent | undefined;
    private writingIntent = false;
    private ghostIntent = false;
    private pageletReselectionRequired = false;
    private disposed = false;

    constructor(private readonly maxImages = 8) {}

    /** Call on every text edit, even an edit that eventually leaves the text empty. */
    touchText(): void { this.changed(); }

    subscribe(listener: (change: 'edit' | 'clear' | 'consume') => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private changed(change: 'edit' | 'clear' | 'consume' = 'edit'): void {
        this.revision += 1;
        for (const listener of this.listeners) listener(change);
    }

    /** Called only after the view checks route and original revision following reference verification. */
    loadRecovered(snapshot: Omit<ComposerSnapshot<T>, 'draftId' | 'revision'>): void {
        if (this.disposed) return;
        this.clear();
        for (const entry of snapshot.images) {
            const id = ++this.nextEntryId;
            this.entries.set(id, { ...entry, id });
        }
        this.imageIntent = snapshot.imageIntent ? cloneImageIntent(snapshot.imageIntent) : undefined;
        this.writingIntent = snapshot.writingIntent === true;
        this.ghostIntent = snapshot.ghostIntent === true;
        this.pageletReselectionRequired = snapshot.pageletReselectionRequired === true;
        this.changed();
    }

    snapshot(text: string): ComposerSnapshot<T> {
        return {
            text, draftId: this.draftId, revision: this.revision,
            ...(this.imageIntent ? { imageIntent: cloneImageIntent(this.imageIntent) } : {}),
            ...(this.writingIntent ? { writingIntent: true as const } : {}),
            ...(this.ghostIntent ? { ghostIntent: true as const } : {}),
            ...(this.pageletReselectionRequired ? { pageletReselectionRequired: true as const } : {}),
            images: [...this.entries.values()].map((entry) => ({ ...entry })),
        };
    }

    setImageIntent(intent: ComposerImageIntent): void {
        if (this.disposed) throw new Error('Composer is closed');
        this.imageIntent = cloneImageIntent(intent);
        this.writingIntent = false;
        this.ghostIntent = false;
        this.changed();
    }

    setPageletReselectionRequired(required: boolean): void {
        if (this.pageletReselectionRequired === required) return;
        this.pageletReselectionRequired = required;
        this.changed();
    }

    setWritingIntent(): void {
        if (this.disposed) throw new Error('Composer is closed');
        this.writingIntent = true;
        this.imageIntent = undefined;
        this.ghostIntent = false;
        this.changed();
    }

    setGhostIntent(): void {
        if (this.disposed) throw new Error('Composer is closed');
        if (this.ghostIntent) return;
        this.ghostIntent = true;
        this.changed();
    }

    clearGhostIntent(): void {
        if (!this.ghostIntent) return;
        this.ghostIntent = false;
        this.changed();
    }

    clearWritingIntent(): void {
        if (!this.writingIntent) return;
        this.writingIntent = false;
        this.changed();
    }

    clearImageIntent(): void {
        if (this.imageIntent) {
            this.imageIntent = undefined;
            this.changed();
        }
    }

    setImageTextSource(source: ComposerImageTextSource | undefined): void {
        if (this.disposed) throw new Error('Composer is closed');
        if (!this.imageIntent) throw new Error('No image action is selected');
        const next = cloneImageIntent(this.imageIntent);
        if (source) next.textSource = cloneTextSource(source);
        else delete next.textSource;
        // A changed or removed source requires new preparation. promptLineage
        // remains so an app-prefilled derived description cannot be laundered.
        delete next.promptOrigin;
        delete next.preparedPrompt;
        delete next.reusePreparedPrompt;
        delete next.sourceReceipt;
        delete next.recoverySourceLabel;
        this.imageIntent = next;
        this.changed();
    }

    setImageGenerationOptions(options: ComposerImageGenerationOptions): void {
        if (this.disposed) throw new Error('Composer is closed');
        if (!this.imageIntent) throw new Error('No image action is selected');
        this.imageIntent = { ...cloneImageIntent(this.imageIntent), generationOptions: cloneGenerationOptions(options) };
        this.changed();
    }

    hasDraft(text: string): boolean {
        return text.trim().length > 0 || this.entries.size > 0
            || this.imageIntent !== undefined || this.writingIntent || this.ghostIntent || this.pageletReselectionRequired;
    }

    canSend(text: string): boolean {
        return !this.disposed && this.hasDraft(text)
            && !this.pageletReselectionRequired
            && !this.imageIntent?.recoverySourceLabel
            && !this.imageIntent?.recoveryReferencesMissing
            && (!(this.imageIntent || this.writingIntent)
                || text.trim().length > 0 || Boolean(this.imageIntent?.textSource))
            && [...this.entries.values()].every((entry) => entry.status === "ready");
    }

    beginImport(label: string): ComposerImportHandle {
        if (this.disposed) throw new Error("Composer is closed");
        if (this.entries.size >= this.maxImages) throw new Error("Image count limit exceeded");
        const entryId = ++this.nextEntryId;
        const controller = new AbortController();
        this.imports.set(entryId, controller);
        this.entries.set(entryId, { id: entryId, label, status: "processing" });
        this.changed();
        return { draftId: this.draftId, entryId, signal: controller.signal };
    }

    completeImport(handle: ComposerImportHandle, value: T): boolean {
        if (!this.owns(handle)) return false;
        const entry = this.entries.get(handle.entryId)!;
        this.entries.set(handle.entryId, { id: entry.id, label: entry.label, status: "ready", value });
        this.imports.delete(handle.entryId);
        this.changed();
        return true;
    }

    failImport(handle: ComposerImportHandle, error: string, value?: T): boolean {
        if (!this.owns(handle)) return false;
        const entry = this.entries.get(handle.entryId)!;
        this.entries.set(handle.entryId, { ...entry, status: "error", error, value });
        this.imports.delete(handle.entryId);
        this.changed();
        return true;
    }

    removeImage(id: number): void {
        this.imports.get(id)?.abort();
        this.imports.delete(id);
        if (this.entries.delete(id)) this.changed();
    }

    /** The returned snapshot is the only image/text selection belonging to this send. */
    take(text: string): SentComposerDraft<T> | null {
        if (!this.canSend(text)) return null;
        const snapshot = this.snapshot(text);
        this.clear('consume');
        return { snapshot, restoreInto: { draftId: this.draftId, revision: this.revision } };
    }

    /** Caller assigns returned text; a new draft (including type-then-delete) is never overwritten. */
    restore(sent: SentComposerDraft<T>, currentText: string): string | null {
        if (this.disposed || this.hasDraft(currentText)
            || this.draftId !== sent.restoreInto.draftId
            || this.revision !== sent.restoreInto.revision) return null;
        for (const entry of sent.snapshot.images) this.entries.set(entry.id, { ...entry });
        this.imageIntent = sent.snapshot.imageIntent ? cloneImageIntent(sent.snapshot.imageIntent) : undefined;
        this.writingIntent = sent.snapshot.writingIntent === true;
        this.ghostIntent = sent.snapshot.ghostIntent === true;
        this.pageletReselectionRequired = sent.snapshot.pageletReselectionRequired === true;
        this.changed();
        return sent.snapshot.text;
    }

    isUnchanged(snapshot: Pick<ComposerSnapshot<T>, "draftId" | "revision">): boolean {
        return !this.disposed && this.draftId === snapshot.draftId && this.revision === snapshot.revision;
    }

    clear(change: 'clear' | 'consume' = 'clear'): void {
        for (const controller of this.imports.values()) controller.abort();
        this.imports.clear();
        this.entries.clear();
        this.imageIntent = undefined;
        this.writingIntent = false;
        this.ghostIntent = false;
        this.pageletReselectionRequired = false;
        this.draftId += 1;
        this.changed(change);
    }

    dispose(): void { this.listeners.clear(); this.clear(); this.disposed = true; }

    private owns(handle: ComposerImportHandle): boolean {
        return !this.disposed && !handle.signal.aborted && handle.draftId === this.draftId
            && this.imports.get(handle.entryId)?.signal === handle.signal
            && this.entries.has(handle.entryId);
    }
}

/** Capture an exact editor source before Chat takes focus; no asynchronous provider reads happen here. */
export function captureComposerImageNoteSource(
    file: { path: string; extension: string; basename?: string },
    documentText: string,
): ComposerImageTextSource | null {
    if (!file.path || file.extension !== 'md') return null;
    const text = documentText.slice(getFrontMatterInfo(documentText).contentStart);
    if (!text.trim()) return null;
    return Object.freeze({
        kind: 'note', path: file.path, displayName: file.basename || file.path,
        text, documentText, file,
        inputLineage: completeInputLineage([{ kind: 'vault', path: file.path, via: 'note' }]),
    });
}

export function captureComposerImageTextSource(
    editor: Editor,
    view: MarkdownView,
    kind: 'note' | 'selection',
): ComposerImageTextSource | null {
    const file = view.file;
    if (!file?.path || file.extension !== 'md') return null;
    if (typeof editor.getValue !== 'function') return null;
    const documentText = editor.getValue() ?? '';
    if (kind === 'note') {
        return captureComposerImageNoteSource(file, documentText);
    }

    if (typeof editor.getSelection !== 'function'
        || typeof editor.posToOffset !== 'function' || typeof editor.getCursor !== 'function') return null;
    const selection = editor.getSelection() ?? '';
    if (!selection.trim()) return null;
    let from = editor.posToOffset(editor.getCursor('from'));
    let to = editor.posToOffset(editor.getCursor('to'));
    if (from > to) [from, to] = [to, from];
    if (documentText.slice(from, to) !== selection) return null;
    return {
        kind,
        path: file.path,
        displayName: file.basename || file.path,
        text: selection,
        documentText,
        file,
        selection: { from, to },
        inputLineage: completeInputLineage([{ kind: 'vault', path: file.path, via: 'note' }]),
    };
}

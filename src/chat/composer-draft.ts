/** View-local ownership for text, images and asynchronous imports. No draft bytes are persisted. */
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
    images: ComposerImageEntry<T>[];
    draftId: number;
    revision: number;
}

export interface SentComposerDraft<T> {
    snapshot: ComposerSnapshot<T>;
    restoreInto: { draftId: number; revision: number };
}

export class ComposerDraft<T> {
    private draftId = 0;
    private revision = 0;
    private nextEntryId = 0;
    private readonly entries = new Map<number, ComposerImageEntry<T>>();
    private readonly imports = new Map<number, AbortController>();
    private imageIntent: ComposerImageIntent | undefined;
    private writingIntent = false;
    private disposed = false;

    constructor(private readonly maxImages = 8) {}

    /** Call on every text edit, even an edit that eventually leaves the text empty. */
    touchText(): void { this.revision += 1; }

    snapshot(text: string): ComposerSnapshot<T> {
        return {
            text, draftId: this.draftId, revision: this.revision,
            ...(this.imageIntent ? { imageIntent: cloneImageIntent(this.imageIntent) } : {}),
            ...(this.writingIntent ? { writingIntent: true as const } : {}),
            images: [...this.entries.values()].map((entry) => ({ ...entry })),
        };
    }

    setImageIntent(intent: ComposerImageIntent): void {
        if (this.disposed) throw new Error('Composer is closed');
        this.imageIntent = cloneImageIntent(intent);
        this.writingIntent = false;
        this.revision += 1;
    }

    setWritingIntent(): void {
        if (this.disposed) throw new Error('Composer is closed');
        this.writingIntent = true;
        this.imageIntent = undefined;
        this.revision += 1;
    }

    clearWritingIntent(): void {
        if (!this.writingIntent) return;
        this.writingIntent = false;
        this.revision += 1;
    }

    clearImageIntent(): void {
        if (this.imageIntent) {
            this.imageIntent = undefined;
            this.revision += 1;
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
        this.imageIntent = next;
        this.revision += 1;
    }

    setImageGenerationOptions(options: ComposerImageGenerationOptions): void {
        if (this.disposed) throw new Error('Composer is closed');
        if (!this.imageIntent) throw new Error('No image action is selected');
        this.imageIntent = { ...cloneImageIntent(this.imageIntent), generationOptions: cloneGenerationOptions(options) };
        this.revision += 1;
    }

    hasDraft(text: string): boolean {
        return text.trim().length > 0 || this.entries.size > 0
            || this.imageIntent !== undefined || this.writingIntent;
    }

    canSend(text: string): boolean {
        return !this.disposed && this.hasDraft(text)
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
        this.revision += 1;
        return { draftId: this.draftId, entryId, signal: controller.signal };
    }

    completeImport(handle: ComposerImportHandle, value: T): boolean {
        if (!this.owns(handle)) return false;
        const entry = this.entries.get(handle.entryId)!;
        this.entries.set(handle.entryId, { id: entry.id, label: entry.label, status: "ready", value });
        this.imports.delete(handle.entryId);
        this.revision += 1;
        return true;
    }

    failImport(handle: ComposerImportHandle, error: string, value?: T): boolean {
        if (!this.owns(handle)) return false;
        const entry = this.entries.get(handle.entryId)!;
        this.entries.set(handle.entryId, { ...entry, status: "error", error, value });
        this.imports.delete(handle.entryId);
        this.revision += 1;
        return true;
    }

    removeImage(id: number): void {
        this.imports.get(id)?.abort();
        this.imports.delete(id);
        if (this.entries.delete(id)) this.revision += 1;
    }

    /** The returned snapshot is the only image/text selection belonging to this send. */
    take(text: string): SentComposerDraft<T> | null {
        if (!this.canSend(text)) return null;
        const snapshot = this.snapshot(text);
        this.clear();
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
        this.revision += 1;
        return sent.snapshot.text;
    }

    isUnchanged(snapshot: Pick<ComposerSnapshot<T>, "draftId" | "revision">): boolean {
        return !this.disposed && this.draftId === snapshot.draftId && this.revision === snapshot.revision;
    }

    clear(): void {
        for (const controller of this.imports.values()) controller.abort();
        this.imports.clear();
        this.entries.clear();
        this.imageIntent = undefined;
        this.writingIntent = false;
        this.draftId += 1;
        this.revision += 1;
    }

    dispose(): void { this.clear(); this.disposed = true; }

    private owns(handle: ComposerImportHandle): boolean {
        return !this.disposed && !handle.signal.aborted && handle.draftId === this.draftId
            && this.imports.get(handle.entryId)?.signal === handle.signal
            && this.entries.has(handle.entryId);
    }
}

/** Capture an exact editor source before Chat takes focus; no asynchronous provider reads happen here. */
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
        const text = documentText.slice(getFrontMatterInfo(documentText).contentStart);
        if (!text.trim()) return null;
        return {
            kind,
            path: file.path,
            displayName: file.basename || file.path,
            text,
            documentText,
            file,
            inputLineage: completeInputLineage([{ kind: 'vault', path: file.path, via: 'note' }]),
        };
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

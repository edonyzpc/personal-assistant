/** View-local ownership for text, images and asynchronous imports. No draft bytes are persisted. */
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
    private disposed = false;

    constructor(private readonly maxImages = 8) {}

    /** Call on every text edit, even an edit that eventually leaves the text empty. */
    touchText(): void { this.revision += 1; }

    snapshot(text: string): ComposerSnapshot<T> {
        return {
            text, draftId: this.draftId, revision: this.revision,
            images: [...this.entries.values()].map((entry) => ({ ...entry })),
        };
    }

    hasDraft(text: string): boolean {
        return text.trim().length > 0 || this.entries.size > 0;
    }

    canSend(text: string): boolean {
        return !this.disposed && this.hasDraft(text)
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

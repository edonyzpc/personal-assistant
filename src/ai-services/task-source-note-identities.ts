import type { Workspace } from "obsidian";
import {
    findCurrentMarkdownView,
    type VaultFileLike,
    type MarkdownViewLike,
} from "./chat-tool-execution-helpers";

export interface TaskSourceNoteIdentity {
    readonly handle: string;
    readonly noteId: string;
    readonly path: string;
}

interface RegisteredNote {
    readonly identity: TaskSourceNoteIdentity;
    readonly file: VaultFileLike;
    invalidated: boolean;
}

/** Run-local file identity and path only. Never reads note text, title or stat. */
export class TaskSourceNoteIdentities {
    readonly currentNote: TaskSourceNoteIdentity | undefined;
    private readonly runId: string;
    private readonly workspace: Workspace;
    private readonly getFileByPath: (path: string) => unknown;
    private readonly byPath = new Map<string, RegisteredNote>();
    private readonly byNoteId = new Map<string, RegisteredNote>();
    private readonly byFile = new WeakMap<VaultFileLike, RegisteredNote>();
    private nextIdentity = 0;

    constructor(host: {
        runId: string;
        workspace: Workspace;
        getFileByPath(path: string): unknown;
    }) {
        this.runId = host.runId;
        this.workspace = host.workspace;
        this.getFileByPath = host.getFileByPath.bind(host);
        const view = this.findCurrentView();
        this.currentNote = view ? this.registerFile(view.file) : undefined;
    }

    /** A copy of all host bindings, including identities retained for exclusions. */
    noteHandles(): ReadonlyMap<string, string> {
        return new Map([...this.byNoteId.values()].map(({ identity }) => [identity.handle, identity.noteId]));
    }

    /** Register a discovered real file without changing any task authorization. */
    registerFile(file: VaultFileLike): TaskSourceNoteIdentity | undefined {
        try {
            if (!file || typeof file !== "object" || "children" in file
                || typeof file.path !== "string" || !/\.(md|canvas)$/i.test(file.path)) return undefined;
            const path = file.path;
            const existing = this.byFile.get(file) ?? this.byPath.get(path);
            if (existing) {
                const live = this.isLive(existing);
                return live && existing.file === file && existing.identity.path === path
                    ? existing.identity : undefined;
            }
            if (this.getFileByPath(path) !== file || file.path !== path) return undefined;
            const sequence = ++this.nextIdentity;
            const identity = Object.freeze({
                handle: `note_${sequence}`,
                noteId: `${this.runId}:note:${sequence}`,
                path,
            });
            const registered: RegisteredNote = { identity, file, invalidated: false };
            this.byPath.set(path, registered);
            this.byNoteId.set(identity.noteId, registered);
            this.byFile.set(file, registered);
            return identity;
        } catch {
            return undefined;
        }
    }

    resolveNoteId(path: string): string | undefined {
        const registered = this.byPath.get(path);
        return registered && this.isLive(registered) ? registered.identity.noteId : undefined;
    }

    pathForNoteId(noteId: string): string | undefined {
        const registered = this.byNoteId.get(noteId);
        return registered && this.isLive(registered) ? registered.identity.path : undefined;
    }

    /** Retain the original excluded path even after deletion or replacement. */
    capturedPathForNoteId(noteId: string): string | undefined {
        return this.byNoteId.get(noteId)?.identity.path;
    }

    /** A different pane is valid only when it still shows the same real note. */
    isCurrentNoteView(): boolean {
        if (!this.currentNote) return false;
        const registered = this.byNoteId.get(this.currentNote.noteId);
        if (!registered || !this.isLive(registered)) return false;
        const view = this.findCurrentView();
        return view?.file === registered.file && view.file.path === registered.identity.path;
    }

    private isLive(registered: RegisteredNote): boolean {
        if (registered.invalidated) return false;
        try {
            if (registered.file.path === registered.identity.path
                && this.getFileByPath(registered.identity.path) === registered.file
                && registered.file.path === registered.identity.path) return true;
        } catch {
            // A failed host lookup cannot establish that an earlier identity survived.
        }
        registered.invalidated = true;
        return false;
    }

    private findCurrentView(): MarkdownViewLike | null {
        try {
            return findCurrentMarkdownView(this.workspace);
        } catch {
            return null;
        }
    }
}

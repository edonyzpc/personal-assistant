import type { TaskSourceReadGuard } from './task-source-read-guard';
import type { NoteSearchScope } from '../vss/types';

/** Host identities, never paths or permissions supplied by a model. */
export interface TaskSourceConstraint {
    readonly runId: string;
    readonly userMessageId: string;
    readonly revision: number;
    readonly instructionQuote: string;
    /** null means the vault subject to the independent host data boundary. */
    readonly allowedNoteIds: readonly string[] | null;
    readonly excludedNoteIds: readonly string[];
    readonly webAllowed: boolean;
}

export type TaskMaterialRead =
    | { kind: "none" }
    | { kind: "note"; noteId: string }
    | { kind: "vault_search" }
    | { kind: "scoped_vault_search" }
    | { kind: "web" };

export type TaskSourceDeclarationResult =
    | { ok: true; constraint: TaskSourceConstraint }
    | { ok: false; reason: "invalid_declaration" | "invalid_instruction_quote" | "unknown_note_handle" | "scope_widening" };

/**
 * One run's task-material boundary. Personalization is deliberately not a read
 * kind: its existing host provenance and governance gates remain authoritative.
 * Preparing a declaration performs no reads and does not change the active scope.
 */
export class TaskSourceConstraintState {
    private current: TaskSourceConstraint | undefined;
    private readonly candidates = new WeakMap<TaskSourceConstraint, number>();
    private readonly noteHandles: Map<string, string>;
    private readonly host: Readonly<{
        runId: string;
        userMessageId: string;
        userText: string;
        currentNoteHandle?: string;
    }>;

    constructor(host: {
        runId: string;
        userMessageId: string;
        userText: string;
        noteHandles: ReadonlyMap<string, string>;
        currentNoteHandle?: string;
    }) {
        this.noteHandles = new Map(host.noteHandles);
        this.host = Object.freeze({ runId: host.runId, userMessageId: host.userMessageId,
            userText: host.userText, currentNoteHandle: host.currentNoteHandle });
    }

    snapshot(): TaskSourceConstraint | undefined { return this.current; }

    matchesRun(runId: string, userInput: string): boolean {
        return runId === this.host.runId && userInput === this.host.userText;
    }

    /** Host-only identity registration. Existing bindings and scopes never change. */
    registerNoteHandle(handle: string, noteId: string): boolean {
        if (typeof handle !== 'string' || !handle.trim() || typeof noteId !== 'string' || !noteId.trim()) return false;
        const existing = this.noteHandles.get(handle);
        if (existing !== undefined) return existing === noteId;
        this.noteHandles.set(handle, noteId);
        return true;
    }

    prepareDeclaration(raw: unknown): TaskSourceDeclarationResult {
        if (!isObject(raw)) return { ok: false, reason: "invalid_declaration" };
        const fields = new Set(["instructionQuote", "notes", "noteHandles", "excludedNoteHandles", "webAllowed"]);
        if (Object.keys(raw).some(key => !fields.has(key))
            || typeof raw.instructionQuote !== "string" || !raw.instructionQuote.trim()
            || !["current_note", "selected", "vault", "none"].includes(raw.notes as string)
            || typeof raw.webAllowed !== "boolean"
            || (raw.noteHandles !== undefined && !isStringList(raw.noteHandles))
            || (raw.excludedNoteHandles !== undefined && !isStringList(raw.excludedNoteHandles))) {
            return { ok: false, reason: "invalid_declaration" };
        }
        const quote = raw.instructionQuote;
        const start = this.host.userText.indexOf(quote);
        if (start < 0 || this.host.userText.indexOf(quote, start + 1) >= 0) {
            return { ok: false, reason: "invalid_instruction_quote" };
        }
        const selected = raw.noteHandles as string[] | undefined;
        if (raw.notes === "selected" ? !selected?.length : selected !== undefined) {
            return { ok: false, reason: "invalid_declaration" };
        }
        const handles = raw.notes === "current_note"
            ? (this.host.currentNoteHandle ? [this.host.currentNoteHandle] : [])
            : selected ?? [];
        if (raw.notes === "current_note" && !handles.length) {
            return { ok: false, reason: "unknown_note_handle" };
        }
        const excludedHandles = (raw.excludedNoteHandles ?? []) as string[];
        const resolve = (handle: string) => this.noteHandles.get(handle);
        if ([...handles, ...excludedHandles].some(handle => !resolve(handle))) {
            return { ok: false, reason: "unknown_note_handle" };
        }
        const excluded = [...new Set(excludedHandles.map(handle => resolve(handle)!))].sort();
        const allowed = raw.notes === "vault" ? null
            : [...new Set(handles.map(handle => resolve(handle)!))].filter(id => !excluded.includes(id)).sort();
        const constraint: TaskSourceConstraint = Object.freeze({
            runId: this.host.runId,
            userMessageId: this.host.userMessageId,
            revision: (this.current?.revision ?? 0) + 1,
            instructionQuote: quote,
            allowedNoteIds: allowed === null ? null : Object.freeze(allowed),
            excludedNoteIds: Object.freeze(excluded),
            webAllowed: raw.webAllowed,
        });
        if (this.current && !isNarrower(constraint, this.current)) {
            return { ok: false, reason: "scope_widening" };
        }
        this.candidates.set(constraint, this.current?.revision ?? 0);
        return { ok: true, constraint };
    }

    /** Commit only after the complete batch fits this exact prepared boundary. */
    commit(constraint: TaskSourceConstraint): boolean {
        if (this.candidates.get(constraint) !== (this.current?.revision ?? 0)) return false;
        this.candidates.delete(constraint);
        this.current = constraint;
        return true;
    }

    isCurrent(constraint: TaskSourceConstraint): boolean { return constraint === this.current; }

    /** Capture a committed revision for a real read; candidates cannot authorize it. */
    createReadGuard(
        constraint: TaskSourceConstraint,
        resolveHostNoteId: (path: string) => string | undefined,
        isHostCurrent: () => boolean,
        isOutputTargetAllowed?: (path: string) => boolean,
        getNoteSearchScope?: () => NoteSearchScope,
    ): TaskSourceReadGuard {
        const current = () => this.isCurrent(constraint) && isHostCurrent();
        return Object.freeze({
            isCurrent: current,
            isPathAllowed: (path: string, kind = 'task_material') => {
                if (!current()) return false;
                if (kind === 'output_target_exists' && isOutputTargetAllowed) return isOutputTargetAllowed(path);
                const noteId = resolveHostNoteId(path);
                return !!noteId && this.allows({ kind: 'note', noteId }, constraint);
            },
            ...(getNoteSearchScope ? { getNoteSearchScope: () => {
                if (!current()) throw new Error('Task source scope is no longer current.');
                const scope = getNoteSearchScope();
                if (!current()) throw new Error('Task source scope is no longer current.');
                return scope;
            } } : {}),
        });
    }

    allows(read: TaskMaterialRead, candidate: TaskSourceConstraint | undefined = this.current): boolean {
        if (read.kind === "none") return true;
        // A forged snapshot is not an authority, even if its fields look valid.
        if (!candidate || (candidate !== this.current
            && this.candidates.get(candidate) !== (this.current?.revision ?? 0))) return false;
        if (read.kind === "web") return candidate.webAllowed;
        // This read plan requires the real search to carry its host noteScope;
        // it never permits falling back to the unscoped vault_search path.
        if (read.kind === "scoped_vault_search") return true;
        if (read.kind === "vault_search") {
            // A restricted search requires a separate, actually scoped read plan.
            // A broad search followed by result filtering is already too late.
            return candidate.allowedNoteIds === null && candidate.excludedNoteIds.length === 0;
        }
        return !!read.noteId && !candidate.excludedNoteIds.includes(read.noteId)
            && (candidate.allowedNoteIds === null || candidate.allowedNoteIds.includes(read.noteId));
    }
}

function isNarrower(next: TaskSourceConstraint, previous: TaskSourceConstraint): boolean {
    if (next.webAllowed && !previous.webAllowed) return false;
    if (next.allowedNoteIds === null) {
        return previous.allowedNoteIds === null
            && previous.excludedNoteIds.every(id => next.excludedNoteIds.includes(id));
    }
    return next.allowedNoteIds.every(id => !previous.excludedNoteIds.includes(id)
        && (previous.allowedNoteIds === null || previous.allowedNoteIds.includes(id)));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === "string" && !!item.trim());
}

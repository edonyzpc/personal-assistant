import type { TaskSourceReadGuard } from './task-source-read-guard';
import type { NoteSearchScope } from '../vss/types';
import type { ChatSourceScope } from './chat-source-scope';

/** Fixed Host admission for one run. Model text cannot revise this snapshot. */
export interface TaskSourceConstraint {
    readonly runId: string;
    readonly userMessageId: string;
    readonly revision: number;
    /** null means the vault subject to the independent Data Boundary. */
    readonly allowedNoteIds: readonly string[] | null;
    readonly excludedNoteIds: readonly string[];
    readonly webAllowed: boolean;
}

export type TaskMaterialRead =
    | { kind: 'none' }
    | { kind: 'note'; noteId: string }
    | { kind: 'vault_search' }
    | { kind: 'scoped_vault_search' }
    | { kind: 'web' };

/** Real identity and lifetime checks shared by every task-material read. */
export class TaskSourceConstraintState {
    private readonly current: TaskSourceConstraint;
    private readonly noteHandles: Map<string, string>;
    private readonly host: Readonly<{ runId: string; requestText: string }>;
    private readonly sourceScope: ChatSourceScope | undefined;

    constructor(host: {
        runId: string;
        userMessageId: string;
        userText: string;
        requestText?: string;
        noteHandles: ReadonlyMap<string, string>;
        sourceScope?: ChatSourceScope;
    }) {
        this.sourceScope = host.sourceScope;
        this.noteHandles = new Map(host.noteHandles);
        this.host = Object.freeze({ runId: host.runId, requestText: host.requestText ?? host.userText });
        this.current = Object.freeze({
            runId: host.runId, userMessageId: host.userMessageId, revision: 1,
            allowedNoteIds: null, excludedNoteIds: Object.freeze([]), webAllowed: host.sourceScope !== 'notes',
        });
    }

    snapshot(): TaskSourceConstraint { return this.current; }

    matchesRun(runId: string, userInput: string): boolean {
        return runId === this.host.runId && userInput === this.host.requestText;
    }

    /** Identity registration never changes admission or grants a read. */
    registerNoteHandle(handle: string, noteId: string): boolean {
        if (typeof handle !== 'string' || typeof noteId !== 'string' || !handle.trim() || !noteId.trim()) return false;
        const existing = this.noteHandles.get(handle);
        if (existing !== undefined) return existing === noteId;
        this.noteHandles.set(handle, noteId);
        return true;
    }

    isCurrent(constraint: TaskSourceConstraint): boolean { return constraint === this.current; }

    createReadGuard(
        constraint: TaskSourceConstraint,
        resolveHostNoteId: (path: string) => string | undefined,
        isHostCurrent: () => boolean,
        isOutputTargetAllowed?: (path: string) => boolean,
        getNoteSearchScope?: () => NoteSearchScope,
        isWebAllowed?: () => boolean,
        isMemoryAllowed?: () => boolean,
        captureSourceValidity?: () => boolean,
    ): TaskSourceReadGuard {
        const current = () => {
            try {
                return this.isCurrent(constraint) && isHostCurrent()
                    && (captureSourceValidity === undefined || captureSourceValidity());
            } catch { return false; }
        };
        return Object.freeze({
            isCurrent: current,
            isWebAllowed: () => current() && this.allows({ kind: 'web' }, constraint)
                && isWebAllowed?.() !== false,
            isMemoryAllowed: () => current() && this.sourceScope !== 'web'
                && isMemoryAllowed?.() !== false,
            isNoteDomainAllowed: () => current() && this.sourceScope !== 'web',
            ...(captureSourceValidity ? { captureSourceValidity: () => captureSourceValidity } : {}),
            isPathAllowed: (path: string, kind = 'task_material') => {
                if (!current()) return false;
                if (kind === 'output_target_exists' && isOutputTargetAllowed) return isOutputTargetAllowed(path);
                const noteId = resolveHostNoteId(path);
                return !!noteId && this.allows({ kind: 'note', noteId }, constraint);
            },
            ...(getNoteSearchScope ? { getNoteSearchScope: () => {
                if (!current() || !this.allows({ kind: 'scoped_vault_search' }, constraint)) {
                    throw new Error('Task source admission is no longer current.');
                }
                const scope = getNoteSearchScope();
                if (!current()) throw new Error('Task source admission is no longer current.');
                return scope;
            } } : {}),
        });
    }

    allows(read: TaskMaterialRead, constraint: TaskSourceConstraint = this.current): boolean {
        if (read.kind === 'none') return true;
        // A copied or model-created snapshot cannot authorize a read.
        if (!this.isCurrent(constraint)) return false;
        if (this.sourceScope === 'web' && read.kind !== 'web') return false;
        if (this.sourceScope === 'notes' && read.kind === 'web') return false;
        if (read.kind === 'web') return constraint.webAllowed;
        if (read.kind === 'scoped_vault_search') return true;
        if (read.kind === 'vault_search') {
            return constraint.allowedNoteIds === null && constraint.excludedNoteIds.length === 0;
        }
        return !!read.noteId && !constraint.excludedNoteIds.includes(read.noteId)
            && (constraint.allowedNoteIds === null || constraint.allowedNoteIds.includes(read.noteId));
    }
}

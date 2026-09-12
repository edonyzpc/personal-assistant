export type TaskSourceReadKind = 'task_material' | 'output_target_exists';

/** Per-call host boundary. Never accepted from tool arguments or serialized to a provider. */
export interface TaskSourceReadGuard {
    isCurrent(): boolean;
    isPathAllowed(path: string, kind?: TaskSourceReadKind): boolean;
    /** Host-resolved query boundary; absence cannot fall back to an unrestricted search. */
    getNoteSearchScope?(): NoteSearchScope;
}

export function assertTaskSourceReadCurrent(guard: TaskSourceReadGuard | undefined): void {
    if (guard && !guard.isCurrent()) throw new Error('Task source scope is no longer current.');
}

export function isTaskSourcePathAllowed(
    guard: TaskSourceReadGuard | undefined,
    path: string,
    kind: TaskSourceReadKind = 'task_material',
): boolean {
    if (!guard) return true;
    try {
        return guard.isCurrent() && guard.isPathAllowed(path, kind) === true;
    } catch {
        return false;
    }
}
import type { NoteSearchScope } from '../vss/types';

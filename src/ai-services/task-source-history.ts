/** Read-only interpretation of source decisions saved by the retired protocol. */
export type TaskSourceDecisionKind = 'other_notes' | 'excluded_note' | 'web' | 'both';

export interface TaskSourceDecisionBoundary {
    readonly allowedPaths: readonly string[] | null;
    readonly excludedPaths: readonly string[];
    readonly webAllowed: boolean;
}

export interface TaskSourcePendingDecision {
    readonly source: TaskSourceDecisionKind;
    readonly boundary: TaskSourceDecisionBoundary;
    readonly excludedPath?: string;
}

export function isTaskSourceDecisionBoundary(value: unknown): value is TaskSourceDecisionBoundary {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const boundary = value as Record<string, unknown>;
    const stringPaths = (paths: unknown): paths is string[] =>
        Array.isArray(paths) && paths.every(path => typeof path === 'string' && !!path.trim());
    return (boundary.allowedPaths === null || stringPaths(boundary.allowedPaths))
        && stringPaths(boundary.excludedPaths)
        && typeof boundary.webAllowed === 'boolean';
}

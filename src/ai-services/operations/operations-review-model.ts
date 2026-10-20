import type { OperationExecutionResult, OperationsIntent, PreparedNoteImageRemovalOperation, PreparedOperation } from "./types";

const MAX_DIFF_SEQUENCE_ITEMS = 20_000;
const MAX_DIFF_EDIT_DISTANCE = 1_200;
const MAX_CHARACTER_HIGHLIGHT_ITEMS = 2_000;
const DIFF_CONTEXT_LINES = 3;
const DIFF_BLOCK_GAP_LINES = 4;

export type OperationsReviewDiffRowKind = "context" | "delete" | "insert";

export interface OperationsReviewDiffSegment {
    text: string;
    changed: boolean;
}

export interface OperationsReviewDiffLine {
    id: string;
    kind: OperationsReviewDiffRowKind;
    text: string;
    newline: string | null;
    oldNumber?: number;
    newNumber?: number;
    oldSegments?: readonly OperationsReviewDiffSegment[];
    newSegments?: readonly OperationsReviewDiffSegment[];
}

export interface OperationsReviewDiffBlock {
    id: string;
    startIndex: number;
    endIndex: number;
    contextBefore: number;
    contextAfter: number;
}

export interface OperationsReviewFileGroup {
    resourceKind?: import("./types").ResourceEffectFacts["kind"];
    resourcePaths?: readonly string[];
    /** Presentation of the original mkdir result, never permission to undo. */
    mkdirUndoAvailable?: boolean;
    id: string;
    path: string;
    normalizedPath: string;
    before: string;
    after: string;
    beforeExists: boolean;
    created: boolean;
    netZeroTextChange: boolean;
    operationIds: readonly string[];
    operations: readonly PreparedOperation[];
    lines: readonly OperationsReviewDiffLine[];
    blocks: readonly OperationsReviewDiffBlock[];
    changeCount: number;
    diffDegraded: boolean;
    /** Native movement is a path change; the host owns any link updates. */
    targetPath?: string;
    /** A newer snapshot did not continue the previous final state. */
    hasSnapshotBreakpoint?: boolean;
}

export interface OperationsReviewModel {
    intentId: string;
    groups: readonly OperationsReviewFileGroup[];
    /** Request-scope preview partition; absent for batch models. */
    previewGroups?: readonly OperationsReviewFileGroup[];
    previewAttachments?: NonNullable<OperationsReviewModel["attachments"]>;
    blockers?: readonly (NonNullable<PreparedNoteImageRemovalOperation["block"]> & {
        operationId: string;
        attachmentPath: string;
    })[];
    attachments?: readonly {
        id: string;
        path: string;
        action: "keep" | "delete";
        plannedAction: "retain" | "remove";
        undoLimitation: "markdown-only" | "temporary-attachment-and-note";
        blocked?: true;
        /** Request projection: the owner effect outcome, when known. */
        outcome?: "deleted" | "kept" | "unknown";
    }[];
}

interface DiffLine {
    text: string;
    newline: string | null;
}

type SequenceDiffOp<T> =
    | { type: "equal"; old: T; new: T }
    | { type: "delete"; old: T }
    | { type: "insert"; new: T };

/** Group an immutable intent by normalized path without changing execution order. */
export function createOperationsReviewModel(
    intent: OperationsIntent,
    results?: readonly OperationExecutionResult[],
): OperationsReviewModel {
    const groupsByPath = new Map<string, OperationsReviewFileGroup>();
    const operationGroups = new Map<string, PreparedOperation[]>();

    for (const operation of intent.operations) {
        const normalizedPath = normalizeOperationsReviewPath(operation.path);
        const existing = operationGroups.get(normalizedPath);
        if (existing) {
            existing.push(operation);
            continue;
        }
        operationGroups.set(normalizedPath, [operation]);
    }

    for (const [normalizedPath, operations] of operationGroups) {
        const first = operations[0];
        const before = first.expectedBefore ?? "";
        const appliedOperations = results ? operations.filter(operation => {
            const result = results.find(candidate => candidate.operationId === operation.id);
            return result?.status === "succeeded"
                || result?.effects?.some(effect => effect.key === "note" && effect.status === "applied");
        }) : operations;
        const reached = appliedOperations[appliedOperations.length - 1];
        const after = first.kind === "move" || first.kind === "resource" && first.resource.action === "move" ? before : reached?.expectedAfter ?? before;
        const group: OperationsReviewFileGroup = {
            id: `group-${normalizedPath}`,
            path: first.path,
            normalizedPath,
            before,
            after,
            beforeExists: first.expectedBefore !== null,
            created: first.expectedBefore === null && (first.kind !== "resource" || first.resource.action === "create"),
            netZeroTextChange: first.kind !== "resource" && first.expectedBefore !== null && before === after,
            operationIds: operations.map((operation) => operation.id),
            operations,
            ...(first.kind === "move" ? { targetPath: first.targetPath } : {}),
            ...(first.kind === "resource" ? {
                resourceKind: first.resource.action,
                resourcePaths: first.resource.action === "mkdir" ? first.resource.paths
                    : first.resource.action === "trash" ? first.resource.tree.map(e => e.path) : [first.path],
                ...(first.resource.action === "mkdir" && results ? { mkdirUndoAvailable: operations.some(operation =>
                    results.some(result => result.operationId === operation.id && !!result.receiptId && result.undoAvailable === true)) } : {}),
                ...(first.resource.action === "move" ? { targetPath: first.resource.to } : {}),
            } : {}),
            ...createLineDiff(before, after, normalizedPath),
        };
        groupsByPath.set(normalizedPath, group);
    }

    return {
        intentId: intent.id,
        groups: [...groupsByPath.values()],
        blockers: Object.freeze(intent.operations.flatMap(operation => {
            if (operation.kind !== "note_image_removal" || !operation.block) return [];
            return [Object.freeze({
                operationId: operation.id,
                attachmentPath: operation.effects.attachment.path,
                reason: operation.block.reason,
                conflicts: operation.block.conflicts,
            })];
        })),
        attachments: Object.freeze(intent.operations.flatMap(operation => {
            if (operation.kind !== "note_image_removal") return [];
            return [Object.freeze({
                id: `${operation.id}:attachment`,
                path: operation.effects.attachment.path,
                action: operation.effects.attachment.action,
                plannedAction: operation.effects.attachment.plannedAction,
                undoLimitation: operation.undoLimitation,
                ...(operation.block ? { blocked: true as const } : {}),
            })];
        })),
    };
}

export function normalizeOperationsReviewPath(path: string): string {
    let normalized = path.trim().replace(/\\/g, "/");
    while (normalized.startsWith("./")) normalized = normalized.slice(2);
    normalized = normalized.replace(/\/+/g, "/");
    if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
}

export interface OperationsRequestReviewIntentFacts {
    intent: OperationsIntent;
    results?: readonly OperationExecutionResult[];
}

export interface OperationsRequestReviewModelInput {
    runId: string;
    intents: readonly OperationsRequestReviewIntentFacts[];
    /** Receipts whose latest owner fact is a completed restore. */
    undoneReceiptIds?: readonly string[];
}

export interface OperationsRequestReviewModel extends Omit<OperationsReviewModel, "intentId"> {
    runId: string;
    intentIds: readonly string[];
    /** Explicit preview partition; never mixed into actual changes. */
    previewGroups?: readonly OperationsReviewFileGroup[];
    previewAttachments?: NonNullable<OperationsReviewModel["attachments"]>;
}

interface RequestTextGroupState {
    operations: PreparedOperation[];
    segments: Array<{
        before: string;
        after: string;
        breakpoint: boolean;
        startOperationId: string;
    }>;
    identity?: unknown;
}

interface EditorIdentity {
    file: unknown;
    editor: unknown;
    viewId: unknown;
}

function editorIdentity(binding: unknown): EditorIdentity | null {
    if (!binding || typeof binding !== "object") return null;
    const candidate = binding as { file?: unknown; editor?: unknown; viewId?: unknown };
    return { file: candidate.file, editor: candidate.editor, viewId: candidate.viewId };
}

function sameEditorIdentity(left: EditorIdentity | null, right: EditorIdentity | null): boolean {
    if (!left || !right) return false;
    return left.file === right.file && left.editor === right.editor && left.viewId === right.viewId;
}

/**
 * Pure request-level projection. It folds only owner-confirmed continuous
 * snapshots (A→B→C becomes A→C), keeps breakpoint segments when a newer
 * snapshot did not continue the previous final state, and never reads current
 * vault contents to reconstruct execution facts.
 */
export function createOperationsRequestReviewModel(
    input: OperationsRequestReviewModelInput,
): OperationsRequestReviewModel {
    const undone = new Set(input.undoneReceiptIds ?? []);
    const savedGroups = new Map<string, RequestTextGroupState>();
    const editorGroups = new Map<string, RequestTextGroupState>();
    const resourceGroups: OperationsReviewFileGroup[] = [];
    const previewGroups: OperationsReviewFileGroup[] = [];
    const blockers: Array<NonNullable<OperationsReviewModel["blockers"]>[number]> = [];
    const attachments: Array<NonNullable<OperationsReviewModel["attachments"]>[number]> = [];
    const previewAttachments: Array<NonNullable<OperationsReviewModel["attachments"]>[number]> = [];
    const intentIds: string[] = [];
    const moveChains = new Map<string, { originalPath: string; identity: unknown }>();

    for (const { intent, results } of input.intents) {
        intentIds.push(intent.id);
        const isPreview = intent.mode === "preview";
        const latestResult = new Map((results ?? []).map(result => [result.operationId, result]));
        for (const operation of intent.operations) {
            const result = latestResult.get(operation.id);
            const applied = isAppliedOperation(result);
            const receiptUndone = !!result?.receiptId && undone.has(result.receiptId);
            if (operation.kind === "note_image_removal") {
                if (operation.block) {
                    blockers.push(Object.freeze({
                        operationId: operation.id,
                        attachmentPath: operation.effects.attachment.path,
                        reason: operation.block.reason,
                        conflicts: operation.block.conflicts,
                    }));
                }
                const attachmentEffect = result?.effects?.find(effect => effect.key === "attachment");
                const attachmentOutcome = !result
                    ? undefined
                    : attachmentEffect?.status === "removed" && !receiptUndone
                        ? "deleted" as const
                        : attachmentEffect?.status === "unknown"
                            || attachmentEffect?.status === undefined && result.status === "unknown"
                            ? "unknown" as const
                            : "kept" as const;
                const attachmentFact = Object.freeze({
                    id: `${operation.id}:attachment`,
                    path: operation.effects.attachment.path,
                    action: attachmentEffect?.status === "removed" && !receiptUndone
                        ? "delete"
                        : result ? "keep" : operation.effects.attachment.action,
                    plannedAction: operation.effects.attachment.plannedAction,
                    undoLimitation: operation.undoLimitation,
                    ...(attachmentOutcome ? { outcome: attachmentOutcome } : {}),
                    ...(operation.block ? { blocked: true as const } : {}),
                });
                if (isPreview) previewAttachments.push(attachmentFact);
                else if (result) attachments.push(attachmentFact);
            }

            const normalizedPath = normalizeOperationsReviewPath(operation.path);
            const representation = operationRepresentation(operation);
            if (isPreview) {
                previewGroups.push(createPreviewGroup(operation, normalizedPath, representation));
                continue;
            }
            if (!applied || receiptUndone) continue;

            if (representation === "editor") {
                const before = operation.expectedBefore ?? "";
                const after = operation.expectedAfter ?? before;
                // Each capture creates a fresh binding object. The stable
                // editor facts are its live file/editor/view identity; the
                // snapshotId and whole binding object are never identity.
                const identity = operation.kind === "resource" && "binding" in operation.resource
                    ? editorIdentity(operation.resource.binding)
                    : null;
                const state = editorGroups.get(normalizedPath) ?? { operations: [], segments: [] };
                const last = state.segments[state.segments.length - 1];
                // A different binding or a non-continuous snapshot starts a
                // new editor segment; saved text stays a separate representation.
                if (!last || !sameEditorIdentity(state.identity as EditorIdentity | null, identity) || before !== last.after) {
                    state.identity = identity;
                    state.segments.push({
                        before,
                        after,
                        breakpoint: last !== undefined,
                        startOperationId: operation.id,
                    });
                } else last.after = after;
                state.operations.push(operation);
                editorGroups.set(normalizedPath, state);
                continue;
            }
            if (representation === "move") {
                const fromPath = operation.kind === "move" ? operation.sourcePath : operation.path;
                const toPath = operation.kind === "move" ? operation.targetPath
                    : operation.kind === "resource" && operation.resource.action === "move" ? operation.resource.to
                    : operation.path;
                const identity = operation.kind === "move" ? operation.fileIdentity
                    : operation.kind === "resource" && "file" in operation.resource ? operation.resource.file
                    : undefined;
                const chain = moveChains.get(fromPath);
                const chained = chain && chain.identity === identity;
                const originalPath = chained ? chain.originalPath : fromPath;
                moveChains.delete(fromPath);
                moveChains.set(toPath, { originalPath, identity });
                const chainedIndex = chained
                    ? resourceGroups.findIndex(group => group.targetPath === fromPath && group.path === originalPath)
                    : -1;
                const moveGroup = {
                    id: `request-move:${intent.id}:${operation.id}`,
                    path: originalPath,
                    normalizedPath: normalizeOperationsReviewPath(originalPath),
                    before: "",
                    after: "",
                    beforeExists: true,
                    created: false,
                    netZeroTextChange: true,
                    operationIds: Object.freeze([operation.id]),
                    operations: Object.freeze([operation]),
                    lines: Object.freeze([]),
                    blocks: Object.freeze([]),
                    changeCount: 0,
                    diffDegraded: false,
                    ...(operation.kind === "resource" ? { resourceKind: "move" as const } : {}),
                    ...(toPath !== originalPath ? { targetPath: toPath } : {}),
                };
                if (chainedIndex >= 0) resourceGroups[chainedIndex] = moveGroup;
                else resourceGroups.push(moveGroup);
                continue;
            }
            if (representation === "resource-fact") {
                const action = operation.kind === "resource" ? operation.resource.action : "open";
                if (action === "trash") {
                    for (const path of result?.resourceEffect?.paths ?? [operation.path]) moveChains.delete(path);
                }
                resourceGroups.push({
                    id: `request-resource:${intent.id}:${operation.id}`,
                    path: operation.path,
                    normalizedPath,
                    before: "",
                    after: "",
                    beforeExists: true,
                    created: false,
                    netZeroTextChange: true,
                    operationIds: Object.freeze([operation.id]),
                    operations: Object.freeze([operation]),
                    lines: Object.freeze([]),
                    blocks: Object.freeze([]),
                    changeCount: 0,
                    diffDegraded: false,
                    resourceKind: action,
                    resourcePaths: result?.resourceEffect?.paths
                        ?? (operation.kind === "resource" && operation.resource.action === "mkdir"
                            ? [...operation.resource.paths]
                            : operation.kind === "resource" && operation.resource.action === "trash"
                                ? operation.resource.tree.map(entry => entry.path)
                                : [operation.path]),
                });
                continue;
            }

            const before = operation.expectedBefore ?? "";
            const after = operation.expectedAfter ?? before;
            if (operation.expectedBefore === null) moveChains.delete(normalizedPath);
            const state = savedGroups.get(normalizedPath) ?? { operations: [], segments: [] };
            savedGroups.set(normalizedPath, state);
            state.operations.push(operation);
            const last = state.segments[state.segments.length - 1];
            if (!last) state.segments.push({
                before,
                after,
                breakpoint: false,
                startOperationId: operation.id,
            });
            // A created object never continues a prior object merely because
            // both normalize to an empty snapshot.
            else if (operation.expectedBefore !== null && before === last.after) last.after = after;
            else state.segments.push({
                before,
                after,
                breakpoint: true,
                startOperationId: operation.id,
            });
        }
    }

    const groups: OperationsReviewFileGroup[] = [];
    for (const [normalizedPath, state] of savedGroups) {
        const first = state.operations[0];
        for (const segment of state.segments) {
            groups.push({
                id: `request-${normalizedPath}:${segment.startOperationId}`,
                path: first.path,
                normalizedPath,
                before: segment.before,
                after: segment.after,
                beforeExists: segment.before !== "" || first.expectedBefore !== null,
                created: first.expectedBefore === null,
                netZeroTextChange: first.expectedBefore !== null && segment.before === segment.after,
                operationIds: Object.freeze(state.operations.map(operation => operation.id)),
                operations: Object.freeze([...state.operations]),
                ...(segment.breakpoint ? { hasSnapshotBreakpoint: true } : {}),
                ...createLineDiff(segment.before, segment.after, `${normalizedPath}:${segment.startOperationId}`),
            });
        }
    }
    groups.push(...resourceGroups);
    for (const [normalizedPath, state] of editorGroups) {
        const first = state.operations[0];
        for (const segment of state.segments) {
            groups.push({
                id: `request-editor-${normalizedPath}:${segment.startOperationId}`,
                path: first.path,
                normalizedPath,
                before: segment.before,
                after: segment.after,
                beforeExists: segment.before !== "" || first.expectedBefore !== null,
                created: false,
                netZeroTextChange: segment.before === segment.after,
                operationIds: Object.freeze(state.operations.map(operation => operation.id)),
                operations: Object.freeze([...state.operations]),
                resourceKind: "editor",
                ...(segment.breakpoint ? { hasSnapshotBreakpoint: true } : {}),
                ...createLineDiff(segment.before, segment.after, `${normalizedPath}:editor:${segment.startOperationId}`),
            });
        }
    }

    return {
        runId: input.runId,
        intentIds: Object.freeze(intentIds),
        groups: Object.freeze(groups),
        previewGroups: Object.freeze(previewGroups),
        previewAttachments: Object.freeze(previewAttachments),
        blockers: Object.freeze(blockers),
        attachments: Object.freeze(attachments),
    };
}

function isAppliedOperation(result: OperationExecutionResult | undefined): boolean {
    if (!result) return false;
    if (result.status === "succeeded") return true;
    if (result.effects?.some(effect => effect.status === "applied" || effect.status === "removed") === true) return true;
    if ((result.resourceEffect?.paths?.length ?? 0) > 0) return true;
    if (result.resourceEffect?.opened === true) return true;
    return result.resourceEffect?.kind === "undo" && result.resourceEffect.undoStatus !== undefined;
}

type RequestOperationRepresentation = "saved" | "editor" | "move" | "resource-fact";

function operationRepresentation(operation: PreparedOperation): RequestOperationRepresentation {
    if (operation.kind === "move") return "move";
    if (operation.kind !== "resource") return "saved";
    const action = operation.resource.action;
    if (action === "create" || action === "replace") return "saved";
    if (action === "move") return "move";
    if (action === "editor") return "editor";
    return "resource-fact";
}

function createPreviewGroup(
    operation: PreparedOperation,
    normalizedPath: string,
    representation: RequestOperationRepresentation,
): OperationsReviewFileGroup {
    const before = operation.expectedBefore ?? "";
    const after = operation.expectedAfter ?? before;
    return {
        id: `request-preview:${operation.id}`,
        path: operation.path,
        normalizedPath,
        before,
        after,
        beforeExists: operation.expectedBefore !== null,
        created: operation.expectedBefore === null,
        netZeroTextChange: before === after,
        operationIds: Object.freeze([operation.id]),
        operations: Object.freeze([operation]),
        ...(representation === "editor" ? { resourceKind: "editor" as const } : {}),
        ...(operation.kind === "move" || representation === "move"
            ? { targetPath: operation.kind === "move" ? operation.targetPath
                : operation.kind === "resource" && "to" in operation.resource ? operation.resource.to : operation.path }
            : {}),
        ...createLineDiff(before, after, `${normalizedPath}:preview:${operation.id}`),
    };
}

function createLineDiff(
    before: string,
    after: string,
    path: string,
): Pick<OperationsReviewFileGroup, "lines" | "blocks" | "changeCount" | "diffDegraded"> {
    const beforeLines = splitDiffLines(before);
    const afterLines = splitDiffLines(after);
    const operations = diffSequences(beforeLines, afterLines, (line) => `${line.text}\n${line.newline ?? ""}`);
    let diffDegraded = false;
    const normalizedOperations: Array<SequenceDiffOp<DiffLine>> = [];

    if (operations) {
        let index = 0;
        while (index < operations.length) {
            const operation = operations[index];
            if (operation.type === "equal") {
                normalizedOperations.push(operation);
                index += 1;
                continue;
            }

            const deletes: DiffLine[] = [];
            const inserts: DiffLine[] = [];
            while (index < operations.length && operations[index].type !== "equal") {
                const changed = operations[index];
                if (changed.type === "delete") deletes.push(changed.old);
                else inserts.push(changed.new);
                index += 1;
            }
            for (const line of deletes) normalizedOperations.push({ type: "delete", old: line });
            for (const line of inserts) normalizedOperations.push({ type: "insert", new: line });
        }
    } else {
        diffDegraded = true;
        for (const line of beforeLines) normalizedOperations.push({ type: "delete", old: line });
        for (const line of afterLines) normalizedOperations.push({ type: "insert", new: line });
    }

    const rows: OperationsReviewDiffLine[] = [];
    let oldNumber = 1;
    let newNumber = 1;
    let changeCount = 0;
    let operationIndex = 0;
    while (operationIndex < normalizedOperations.length) {
        const operation = normalizedOperations[operationIndex];
        if (operation.type === "equal") {
            rows.push({
                id: `${path}:${rows.length}`,
                kind: "context",
                text: operation.old.text,
                newline: operation.old.newline,
                oldNumber: oldNumber++,
                newNumber: newNumber++,
            });
            operationIndex += 1;
            continue;
        }

        const deletes: DiffLine[] = [];
        const inserts: DiffLine[] = [];
        while (operationIndex < normalizedOperations.length && normalizedOperations[operationIndex].type !== "equal") {
            const changed = normalizedOperations[operationIndex];
            if (changed.type === "delete") deletes.push(changed.old);
            else inserts.push(changed.new);
            operationIndex += 1;
        }
        const pairs = Math.min(deletes.length, inserts.length);
        for (let pair = 0; pair < pairs; pair += 1) {
            const segments = highlightLineSegments(deletes[pair].text, inserts[pair].text);
            rows.push({
                id: `${path}:${rows.length}`,
                kind: "delete",
                text: deletes[pair].text,
                newline: deletes[pair].newline,
                oldNumber: oldNumber++,
                oldSegments: segments.old,
            });
            rows.push({
                id: `${path}:${rows.length}`,
                kind: "insert",
                text: inserts[pair].text,
                newline: inserts[pair].newline,
                newNumber: newNumber++,
                newSegments: segments.new,
            });
        }
        for (const line of deletes.slice(pairs)) {
            rows.push({
                id: `${path}:${rows.length}`,
                kind: "delete",
                text: line.text,
                newline: line.newline,
                oldNumber: oldNumber++,
                oldSegments: [{ text: line.text, changed: true }],
            });
        }
        for (const line of inserts.slice(pairs)) {
            rows.push({
                id: `${path}:${rows.length}`,
                kind: "insert",
                text: line.text,
                newline: line.newline,
                newNumber: newNumber++,
                newSegments: [{ text: line.text, changed: true }],
            });
        }
        changeCount += deletes.length + inserts.length;
    }

    return {
        lines: rows,
        blocks: createDiffBlocks(rows),
        changeCount,
        diffDegraded,
    };
}

function splitDiffLines(value: string): DiffLine[] {
    if (value === "") return [];
    const lines: DiffLine[] = [];
    let cursor = 0;
    while (cursor < value.length) {
        let newlineStart = -1;
        for (let index = cursor; index < value.length; index += 1) {
            const character = value[index];
            if (character === "\r" || character === "\n") {
                newlineStart = index;
                break;
            }
        }
        if (newlineStart === -1) {
            lines.push({ text: value.slice(cursor), newline: null });
            break;
        }
        const newlineEnd = newlineStart + 1 < value.length
            && value[newlineStart] === "\r"
            && value[newlineStart + 1] === "\n"
            ? newlineStart + 2
            : newlineStart + 1;
        lines.push({
            text: value.slice(cursor, newlineStart),
            newline: value.slice(newlineStart, newlineEnd),
        });
        cursor = newlineEnd;
    }
    return lines;
}

function createDiffBlocks(rows: readonly OperationsReviewDiffLine[]): OperationsReviewDiffBlock[] {
    const changedIndexes = rows.map((row, index) => row.kind === "context" ? -1 : index).filter((index) => index >= 0);
    if (changedIndexes.length === 0) return [];
    const blocks: OperationsReviewDiffBlock[] = [];
    let start = 0;

    for (let index = 1; index <= changedIndexes.length; index += 1) {
        const previous = changedIndexes[index - 1];
        const current = index < changedIndexes.length ? changedIndexes[index] : rows.length;
        if (index < changedIndexes.length && current - previous <= DIFF_BLOCK_GAP_LINES) continue;
        const startIndex = Math.max(0, changedIndexes[start] - DIFF_CONTEXT_LINES);
        const endIndex = Math.min(rows.length - 1, previous + DIFF_CONTEXT_LINES);
        blocks.push({
            id: `block-${blocks.length}`,
            startIndex,
            endIndex,
            contextBefore: changedIndexes[start] - startIndex,
            contextAfter: endIndex - previous,
        });
        start = index;
    }
    return blocks;
}

function highlightLineSegments(
    before: string,
    after: string,
): { old: OperationsReviewDiffSegment[]; new: OperationsReviewDiffSegment[] } {
    const oldCharacters = Array.from(before);
    const newCharacters = Array.from(after);
    if (oldCharacters.length + newCharacters.length > MAX_CHARACTER_HIGHLIGHT_ITEMS) {
        return {
            old: [{ text: before, changed: true }],
            new: [{ text: after, changed: true }],
        };
    }

    const operations = diffSequences(oldCharacters, newCharacters);
    if (!operations) {
        return {
            old: [{ text: before, changed: true }],
            new: [{ text: after, changed: true }],
        };
    }

    const oldSegments: OperationsReviewDiffSegment[] = [];
    const newSegments: OperationsReviewDiffSegment[] = [];
    const appendOld = (text: string, changed: boolean) => appendSegment(oldSegments, text, changed);
    const appendNew = (text: string, changed: boolean) => appendSegment(newSegments, text, changed);
    for (const operation of operations) {
        if (operation.type === "equal") {
            appendOld(operation.old, false);
            appendNew(operation.new, false);
        } else if (operation.type === "delete") appendOld(operation.old, true);
        else appendNew(operation.new, true);
    }
    return { old: oldSegments, new: newSegments };
}

function appendSegment(segments: OperationsReviewDiffSegment[], text: string, changed: boolean): void {
    if (text === "") return;
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += text;
    else segments.push({ text, changed });
}

function diffSequences<T>(
    oldItems: readonly T[],
    newItems: readonly T[],
    serialize?: (item: T) => string,
): SequenceDiffOp<T>[] | null {
    if (oldItems.length + newItems.length > MAX_DIFF_SEQUENCE_ITEMS) return null;
    const equals = (left: T, right: T): boolean => serialize
        ? serialize(left) === serialize(right)
        : left === right;

    let prefix = 0;
    while (prefix < oldItems.length && prefix < newItems.length && equals(oldItems[prefix], newItems[prefix])) prefix += 1;
    let suffix = 0;
    while (
        suffix < oldItems.length - prefix
        && suffix < newItems.length - prefix
        && equals(oldItems[oldItems.length - 1 - suffix], newItems[newItems.length - 1 - suffix])
    ) suffix += 1;

    const coreOld = oldItems.slice(prefix, oldItems.length - suffix);
    const coreNew = newItems.slice(prefix, newItems.length - suffix);
    const result: SequenceDiffOp<T>[] = [];
    for (let index = 0; index < prefix; index += 1) {
        result.push({ type: "equal", old: oldItems[index], new: newItems[index] });
    }

    const coreOperations = diffSequencesCore(coreOld, coreNew, equals);
    if (!coreOperations) return null;
    result.push(...coreOperations);
    for (let index = 0; index < suffix; index += 1) {
        const oldItem = oldItems[oldItems.length - suffix + index];
        result.push({ type: "equal", old: oldItem, new: newItems[newItems.length - suffix + index] });
    }
    return result;
}

function diffSequencesCore<T>(
    oldItems: readonly T[],
    newItems: readonly T[],
    equals: (left: T, right: T) => boolean,
): SequenceDiffOp<T>[] | null {
    const oldLength = oldItems.length;
    const newLength = newItems.length;
    const maximumDistance = Math.min(MAX_DIFF_EDIT_DISTANCE, oldLength + newLength);
    const trace: Array<Map<number, number>> = [];
    trace.push(new Map([[1, 0]]));

    for (let distance = 0; distance <= maximumDistance; distance += 1) {
        const offsets = trace[distance];
        for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
            let x = diagonal === -distance || (
                diagonal !== distance
                && (offsets.get(diagonal - 1) ?? -1) < (offsets.get(diagonal + 1) ?? -1)
            )
                ? offsets.get(diagonal + 1) ?? -1
                : (offsets.get(diagonal - 1) ?? -1) + 1;
            let y = x - diagonal;
            if (x > oldLength || y < 0 || y > newLength) continue;
            while (x < oldLength && y < newLength && equals(oldItems[x], newItems[y])) {
                x += 1;
                y += 1;
            }
            offsets.set(diagonal, x);
            if (x >= oldLength && y >= newLength) {
                return reconstructOperations(trace, distance, oldItems, newItems);
            }
        }
        if (distance < maximumDistance) trace.push(new Map(trace[distance]));
    }
    return null;
}

function reconstructOperations<T>(
    trace: Array<Map<number, number>>,
    finalDistance: number,
    oldItems: readonly T[],
    newItems: readonly T[],
): SequenceDiffOp<T>[] {
    const operations: SequenceDiffOp<T>[] = [];
    let x = oldItems.length;
    let y = newItems.length;
    for (let distance = finalDistance; distance > 0; distance -= 1) {
        const previous = trace[distance - 1];
        const diagonal = x - y;
        const fromUpper = diagonal === -distance || (
            diagonal !== distance
            && (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1)
        );
        const previousDiagonal = fromUpper ? diagonal + 1 : diagonal - 1;
        const previousX = previous.get(previousDiagonal);
        if (previousX === undefined) break;
        const previousY = previousX - previousDiagonal;
        while (x > previousX && y > previousY) {
            x -= 1;
            y -= 1;
            operations.push({ type: "equal", old: oldItems[x], new: newItems[y] });
        }
        if (x === previousX) operations.push({ type: "insert", new: newItems[previousY] });
        else operations.push({ type: "delete", old: oldItems[previousX] });
        x = previousX;
        y = previousY;
    }
    operations.reverse();
    return operations;
}

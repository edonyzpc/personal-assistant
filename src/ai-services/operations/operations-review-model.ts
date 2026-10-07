import type { OperationsIntent, PreparedNoteImageRemovalOperation, PreparedOperation } from "./types";

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
}

export interface OperationsReviewModel {
    intentId: string;
    groups: readonly OperationsReviewFileGroup[];
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
export function createOperationsReviewModel(intent: OperationsIntent): OperationsReviewModel {
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
        const last = operations[operations.length - 1];
        const before = first.expectedBefore ?? "";
        const after = last.expectedAfter;
        const group: OperationsReviewFileGroup = {
            id: `group-${normalizedPath}`,
            path: first.path,
            normalizedPath,
            before,
            after,
            beforeExists: first.expectedBefore !== null,
            created: first.expectedBefore === null,
            netZeroTextChange: first.expectedBefore !== null && before === after,
            operationIds: operations.map((operation) => operation.id),
            operations,
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

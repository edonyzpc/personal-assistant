import { getFrontMatterInfo } from "obsidian";
import type {
    ReadNoteOutput,
    ReadNotePart,
    ReadNoteRange,
} from "./chat-tool-types";
import {
    READ_NOTE_RESULT_JSON_BUDGET_CHARS,
} from "./chat-tool-constants";

export interface ReadNoteFileStatSnapshot {
    mtime: number;
    size: number;
}

interface RegisteredReadNoteFileIdentity extends ReadNoteFileStatSnapshot {
    identity: string;
}

/**
 * Cursor identity is intentionally instance-local and content-free. The weak
 * file-object association plus the captured stat prevent an old cursor from
 * following a replacement object or an mtime change without persisting text.
 */
export class ReadNoteFileIdentityRegistry {
    private readonly identities = new WeakMap<object, RegisteredReadNoteFileIdentity>();
    private nextFileSequence = 0;

    constructor(private readonly instancePrefix: string) {}

    register(file: object, stat: ReadNoteFileStatSnapshot): string {
        const existing = this.identities.get(file);
        if (existing && sameStat(existing, stat)) return existing.identity;

        const identity = `${this.instancePrefix}-file-${++this.nextFileSequence}`;
        this.identities.set(file, { identity, ...stat });
        return identity;
    }

    isValid(file: object, identity: string, stat: ReadNoteFileStatSnapshot): boolean {
        const existing = this.identities.get(file);
        return Boolean(existing && existing.identity === identity && sameStat(existing, stat));
    }
}

function sameStat(left: ReadNoteFileStatSnapshot, right: ReadNoteFileStatSnapshot): boolean {
    return left.mtime === right.mtime && left.size === right.size;
}

export interface ReadNotePartView {
    text: string;
    firstOriginalLine: number;
}

export function getReadNotePartView(content: string, part: ReadNotePart): ReadNotePartView {
    if (part === "properties") {
        const info = getFrontMatterInfo(content);
        return {
            text: info.exists ? info.frontmatter : "",
            firstOriginalLine: info.exists ? lineStartingAtOffset(content, info.from) : 1,
        };
    }

    const info = getFrontMatterInfo(content);
    const bodyStart = info.exists ? info.contentStart : 0;
    return {
        text: content.slice(bodyStart),
        firstOriginalLine: lineStartingAtOffset(content, bodyStart),
    };
}

function lineStartingAtOffset(content: string, offset: number): number {
    let line = 1;
    const lineBreak = /(?:\r\n|\r|\n)/g;
    while (lineBreak.exec(content) !== null) {
        if (lineBreak.lastIndex > offset) break;
        line += 1;
    }
    return line;
}

export interface ReadNoteLineSpan {
    originalLine: number;
    start: number;
    end: number;
    selectionEnd: number;
}

export interface ReadNoteSelection {
    startOffset: number;
    endOffset: number;
    startLine?: number;
    endLine?: number;
}

export function resolveReadNoteSelection(
    view: ReadNotePartView,
    startLine?: number,
    endLine?: number,
    lineSpans: readonly ReadNoteLineSpan[] = getReadNoteLines(view),
): ReadNoteSelection {
    const lastLine = lineSpans[lineSpans.length - 1]!.originalLine;
    if (startLine === undefined || endLine === undefined) {
        return {
            startOffset: 0,
            endOffset: view.text.length,
        };
    }

    if (startLine < view.firstOriginalLine || startLine > lastLine) {
        throw new ReadNoteRangeUnavailableError(`Requested line range starts outside the note ${view.firstOriginalLine === 1 ? "body" : "properties"}.`);
    }
    const clippedEndLine = Math.min(endLine, lastLine);
    if (clippedEndLine < startLine) {
        throw new ReadNoteRangeUnavailableError("Requested line range ends before its start line.");
    }

    const start = lineSpans[startLine - view.firstOriginalLine]!;
    const end = lineSpans[clippedEndLine - view.firstOriginalLine]!;
    return {
        startOffset: start.start,
        endOffset: end.selectionEnd,
        startLine,
        endLine: clippedEndLine,
    };
}

function getReadNoteLines(view: ReadNotePartView): ReadNoteLineSpan[] {
    const lines: ReadNoteLineSpan[] = [];
    const lineBreak = /(?:\r\n|\r|\n)/g;
    let start = 0;
    let originalLine = view.firstOriginalLine;
    while (start <= view.text.length) {
        lineBreak.lastIndex = start;
        const match = lineBreak.exec(view.text);
        if (!match) {
            lines.push({ originalLine, start, end: view.text.length, selectionEnd: view.text.length });
            break;
        }

        const end = match.index;
        const selectionEnd = end + match[0].length;
        lines.push({ originalLine, start, end, selectionEnd });
        start = selectionEnd;
        originalLine += 1;
        if (start === view.text.length) {
            lines.push({ originalLine, start, end: start, selectionEnd: start });
            break;
        }
    }
    return lines;
}

export function buildReadNoteLineSpans(view: ReadNotePartView): readonly ReadNoteLineSpan[] {
    return getReadNoteLines(view);
}

export interface ReadNoteCursorData {
    version: 1;
    path: string;
    part: ReadNotePart;
    identity: string;
    sourceVersion: string;
    offset: number;
    startLine?: number;
    endLine?: number;
}

export function encodeReadNoteCursor(data: ReadNoteCursorData): string {
    return JSON.stringify(data);
}

export function decodeReadNoteCursor(cursor: string): ReadNoteCursorData | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(cursor);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const allowedKeys = new Set([
        "version", "path", "part", "identity", "sourceVersion", "offset", "startLine", "endLine",
    ]);
    if (Object.keys(value).some(key => !allowedKeys.has(key))) return null;
    if (value.version !== 1) return null;
    if (typeof value.path !== "string" || !value.path) return null;
    if (value.part !== "body" && value.part !== "properties") return null;
    if (typeof value.identity !== "string" || !value.identity) return null;
    if (typeof value.sourceVersion !== "string" || !/^[0-9a-f]{40}$/.test(value.sourceVersion)) return null;
    if (!isNonNegativeInteger(value.offset)) return null;

    const hasStart = Object.prototype.hasOwnProperty.call(value, "startLine");
    const hasEnd = Object.prototype.hasOwnProperty.call(value, "endLine");
    if (hasStart !== hasEnd) return null;
    if (hasStart && (!isNonNegativeInteger(value.startLine) || !isNonNegativeInteger(value.endLine))) return null;
    if (hasStart && value.startLine! > value.endLine!) return null;

    return {
        version: 1,
        path: value.path,
        part: value.part,
        identity: value.identity,
        sourceVersion: value.sourceVersion,
        offset: value.offset,
        ...(hasStart ? { startLine: value.startLine as number, endLine: value.endLine as number } : {}),
    };
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export interface ReadNoteSegmentOptions {
    path: string;
    part: ReadNotePart;
    view: ReadNotePartView;
    selection: ReadNoteSelection;
    startOffset: number;
    maxChars: number;
    sourceVersion: string;
    identity: string;
    lineSpans?: readonly ReadNoteLineSpan[];
}

export interface ReadNoteSegment {
    content: ReadNoteOutput;
    nextCursor: ReadNoteCursorData | null;
}

export class ReadNoteRangeUnavailableError extends RangeError {}

export class ReadNoteResultBudgetUnavailableError extends Error {}

export function buildReadNoteSegment(options: ReadNoteSegmentOptions): ReadNoteSegment {
    const selectionEnd = options.selection.endOffset;
    const start = options.startOffset;
    const remaining = selectionEnd - start;
    const lineSpans = options.lineSpans ?? getReadNoteLines(options.view);
    const maxTextEnd = start + countFittingCodePoints(
        options.view.text.slice(start, selectionEnd),
        options.maxChars,
    );

    const buildCandidate = (candidateEnd: number) => {
        const complete = candidateEnd >= selectionEnd;
        const nextCursor = complete ? null : makeCursorData(options, candidateEnd);
        const content: ReadNoteOutput = {
            ...makeReadNoteOutput(options, candidateEnd, lineSpans),
            ...(nextCursor ? { nextCursor: encodeReadNoteCursor(nextCursor) } : {}),
        };
        return { content, nextCursor };
    };

    if (selectionEnd <= maxTextEnd) {
        const completeCandidate = buildCandidate(selectionEnd);
        if (JSON.stringify(completeCandidate.content).length <= READ_NOTE_RESULT_JSON_BUDGET_CHARS) {
            return completeCandidate;
        }
    }

    // Candidate JSON length is monotonic while nextCursor remains present. A
    // bounded search over code-point boundaries avoids rescanning the whole
    // view once per character while the final cursor-free candidate is checked
    // separately above.
    const safeEnds: number[] = [];
    for (let offset = start + codePointSizeAt(options.view.text, start); offset < maxTextEnd;) {
        safeEnds.push(offset);
        offset += codePointSizeAt(options.view.text, offset);
    }
    if (maxTextEnd > start) safeEnds.push(maxTextEnd);

    let bestCandidate: ReadNoteSegment | null = null;
    let low = 0;
    let high = safeEnds.length - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = buildCandidate(safeEnds[middle]!);
        if (JSON.stringify(candidate.content).length <= READ_NOTE_RESULT_JSON_BUDGET_CHARS) {
            bestCandidate = candidate;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (!bestCandidate) {
        throw new ReadNoteResultBudgetUnavailableError(remaining > 0
            ? "read_note cannot fit the next Unicode character in the result budget."
            : "read_note result metadata exceeds the available output budget.");
    }
    return bestCandidate;
}

export function isReadNoteCodePointBoundary(value: string, offset: number): boolean {
    return offset >= 0
        && offset <= value.length
        && !(offset > 0
            && isLowSurrogate(value.charCodeAt(offset))
            && isHighSurrogate(value.charCodeAt(offset - 1)));
}

function makeReadNoteOutput(
    options: ReadNoteSegmentOptions,
    textEnd: number,
    lineSpans: readonly ReadNoteLineSpan[],
): ReadNoteOutput {
    const complete = textEnd >= options.selection.endOffset;
    return {
        path: options.path,
        part: options.part,
        contentKind: options.part === "body" ? "markdown-body" : "raw-frontmatter",
        text: options.view.text.slice(options.startOffset, textEnd),
        sourceVersion: options.sourceVersion,
        range: describeReadNoteRange(options.view, options.startOffset, textEnd, lineSpans),
        truncated: textEnd < options.selection.endOffset,
        complete,
        endOfPart: complete && options.selection.endOffset === options.view.text.length,
    };
}

function makeCursorData(options: ReadNoteSegmentOptions, offset: number): ReadNoteCursorData {
    return {
        version: 1,
        path: options.path,
        part: options.part,
        identity: options.identity,
        sourceVersion: options.sourceVersion,
        offset,
        ...(options.selection.startLine === undefined ? {} : {
            startLine: options.selection.startLine,
            endLine: options.selection.endLine,
        }),
    };
}

function describeReadNoteRange(
    view: ReadNotePartView,
    start: number,
    end: number,
    lines: readonly ReadNoteLineSpan[],
): ReadNoteRange {
    const startLine = lineForBoundary(lines, start, "start");
    const endLine = start === end
        ? startLine
        : lineForBoundary(lines, end, "end");
    const startSpan = lines[startLine - view.firstOriginalLine]!;
    const endSpan = lines[endLine - view.firstOriginalLine]!;
    const splitWithinLineBreak = end > endSpan.end && end < endSpan.selectionEnd;
    return {
        startLine,
        endLine,
        startOffset: start,
        endOffset: end,
        partialLine: start > startSpan.start || end < endSpan.end || splitWithinLineBreak,
    };
}

function lineForBoundary(
    lines: readonly ReadNoteLineSpan[],
    offset: number,
    boundary: "start" | "end",
): number {
    let index = lines.findIndex(line => offset <= line.selectionEnd);
    if (index < 0) index = lines.length - 1;
    const current = lines[index]!;
    if (offset > current.end && offset < current.selectionEnd) return current.originalLine;
    if (boundary === "start" && offset === current.selectionEnd && index < lines.length - 1) {
        return lines[index + 1]!.originalLine;
    }
    return current.originalLine;
}

function countFittingCodePoints(value: string, maxChars: number): number {
    let count = 0;
    let offset = 0;
    while (offset < value.length && count < maxChars) {
        offset += codePointSizeAt(value, offset);
        count += 1;
    }
    return offset;
}

function codePointSizeAt(value: string, offset: number): 1 | 2 {
    return isHighSurrogate(value.charCodeAt(offset))
        && offset + 1 < value.length
        && isLowSurrogate(value.charCodeAt(offset + 1))
        ? 2
        : 1;
}

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

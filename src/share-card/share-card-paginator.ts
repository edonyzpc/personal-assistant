/* Copyright 2023 edonyzpc */

import {
    attachShareCardRenderPlan,
    type CardPage,
    MAX_SHARE_CARD_CHARACTERS,
    MAX_SHARE_CARD_PAGES,
    type ShareCardRenderPlan,
    type ShareCardRenderPlanSegment,
    stripInlineCode,
} from "./share-card-types";

/**
 * Final-render fit check. For a fixed page index it must be prefix-monotonic:
 * once appended content does not fit, further appended blocks cannot fit.
 */
export type ShareCardFitPredicate = (
    markdown: string,
    pageIndex: number,
    context?: ShareCardFitContext,
) => boolean | Promise<boolean>;

/** Exact source identity for a pagination measurement candidate. */
export interface ShareCardFitContext {
    renderPlan: ShareCardRenderPlan;
}

export interface ShareCardPaginationOptions {
    /**
     * Character limit authority before resource data URLs are inlined. When
     * omitted, the paginator retains its standalone input-length guard.
     */
    originalCharacterCount?: number;
}

export type ShareCardPaginationErrorCode =
    | "content-too-large"
    | "page-limit-exceeded"
    | "measurement-failed"
    | "unpageable-content";

/** Typed failure for pagination and measurement invariants. */
export class ShareCardPaginationError extends Error {
    public readonly cause?: unknown;

    constructor(
        public readonly code: ShareCardPaginationErrorCode,
        message: string,
        options?: { cause?: unknown },
    ) {
        super(message);
        this.name = "ShareCardPaginationError";
        this.cause = options?.cause;
    }
}

/** Typed, user-recoverable signal that the v1 content/page limit was exceeded. */
export class ShareCardTooLargeError extends ShareCardPaginationError {
    constructor(
        public readonly reason: "character-limit" | "page-limit",
        public readonly limit: number,
        public readonly actual: number,
    ) {
        super(
            reason === "character-limit" ? "content-too-large" : "page-limit-exceeded",
            reason === "character-limit"
                ? `Share Card content exceeds ${limit} characters.`
                : `Share Card content exceeds ${limit} pages.`,
        );
        this.name = "ShareCardTooLargeError";
    }
}

interface FenceParts {
    opening: string;
    body: string;
    bodySourceStart: number;
    bodySourceEnd: number;
    closing: string;
    containerized: boolean;
    containers: FenceContainer[];
}

interface BlockquoteFenceContainer {
    type: "blockquote";
    opening: string;
}

interface ListFenceContainer {
    type: "list";
    opening: string;
    continuationIndent: number;
}

type FenceContainer = BlockquoteFenceContainer | ListFenceContainer;

interface FenceOpening {
    marker: string;
    info: string;
    containers: FenceContainer[];
    indent: number;
}

interface ExpandedMarkdownLine {
    text: string;
}

interface FenceContainerCandidate {
    containers: FenceContainer[];
    contentStart: number;
}

function expandMarkdownLine(source: string): ExpandedMarkdownLine {
    let text = "";
    for (const character of source) {
        const width = character === "\t" ? 4 - (text.length % 4) : 1;
        text += character === "\t" ? " ".repeat(width) : character;
    }
    return { text };
}

function parseFenceContainers(line: string, from = 0): FenceContainerCandidate {
    const containers: FenceContainer[] = [];
    let cursor = from;

    while (cursor < line.length) {
        const containerStart = cursor;
        let markerStart = cursor;
        while (
            markerStart - containerStart < 3
            && line.charAt(markerStart) === " "
        ) {
            markerStart += 1;
        }

        if (line.charAt(markerStart) === ">") {
            cursor = markerStart + 1;
            if (line.charAt(cursor) === " ") cursor += 1;
            containers.push({
                type: "blockquote",
                opening: line.slice(containerStart, cursor),
            });
            continue;
        }

        const listMarker = /^(?:[*+-]|\d{1,9}[.)])/.exec(line.slice(markerStart));
        if (!listMarker) break;
        const markerEnd = markerStart + listMarker[0].length;
        let whitespaceEnd = markerEnd;
        while (line.charAt(whitespaceEnd) === " ") whitespaceEnd += 1;
        if (whitespaceEnd === markerEnd && markerEnd < line.length) break;

        const paddingLength = whitespaceEnd - markerEnd;
        const consumedPadding = paddingLength === 0
            ? 1
            : paddingLength > 4
            ? 1
            : paddingLength;
        cursor = Math.min(markerEnd + consumedPadding, line.length);
        containers.push({
            type: "list",
            opening: line.slice(containerStart, cursor),
            continuationIndent: markerStart - containerStart
                + listMarker[0].length
                + consumedPadding,
        });
    }

    return { containers, contentStart: cursor };
}

function consumeExpandedFenceContainerPrefix(
    line: string,
    containers: readonly FenceContainer[],
): number | null {
    let cursor = 0;
    for (let index = 0; index < containers.length; index += 1) {
        const container = containers[index]!;
        if (container.type === "list") {
            let consumed = 0;
            while (
                consumed < container.continuationIndent
                && line.charAt(cursor) === " "
            ) {
                cursor += 1;
                consumed += 1;
            }
            if (consumed === container.continuationIndent) continue;

            const remaining = containers.slice(index);
            const listBlank = remaining.every((value) => value.type === "list")
                && line.slice(cursor).trim().length === 0;
            return listBlank ? line.length : null;
        }

        let markerStart = cursor;
        while (
            markerStart - cursor < 3
            && line.charAt(markerStart) === " "
        ) {
            markerStart += 1;
        }
        if (line.charAt(markerStart) !== ">") return null;
        cursor = markerStart + 1;
        if (line.charAt(cursor) === " ") cursor += 1;
    }
    return cursor;
}

function matchFenceOpening(
    source: string,
    inheritedContainers: readonly FenceContainer[] = [],
): FenceOpening | null {
    const line = expandMarkdownLine(source).text;
    const candidates: FenceContainerCandidate[] = [];
    for (let length = inheritedContainers.length; length > 0; length -= 1) {
        const inherited = inheritedContainers.slice(0, length);
        const inheritedEnd = consumeExpandedFenceContainerPrefix(line, inherited);
        if (inheritedEnd === null) continue;
        const nested = parseFenceContainers(line, inheritedEnd);
        candidates.push({
            containers: [...inherited, ...nested.containers],
            contentStart: nested.contentStart,
        });
    }
    candidates.push(parseFenceContainers(line));

    for (const candidate of candidates) {
        const match = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/.exec(
            line.slice(candidate.contentStart),
        );
        if (!match || (match[2].charAt(0) === "`" && match[3].includes("`"))) continue;
        return {
            marker: match[2],
            info: match[3],
            containers: candidate.containers,
            indent: match[1].length,
        };
    }
    return null;
}

function inheritedFenceContainers(previousBlock?: string): FenceContainer[] {
    if (!previousBlock) return [];
    const lines = previousBlock.split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const candidate = parseFenceContainers(expandMarkdownLine(lines[index]!).text);
        if (candidate.containers.some((container) => container.type === "list")) {
            return candidate.containers;
        }
    }
    return [];
}

function canonicalFenceOpening(opening: FenceOpening): string {
    return opening.containers.map((container) => container.opening).join("")
        + " ".repeat(opening.indent)
        + opening.marker
        + opening.info;
}

function syntheticFenceClosing(opening: FenceOpening): string {
    const prefix = opening.containers.map((container) => (
        container.type === "blockquote"
            ? "> "
            : " ".repeat(container.continuationIndent)
    )).join("");
    return `${prefix}${" ".repeat(opening.indent)}${opening.marker}`;
}

function parseFence(block: string, previousBlock?: string): FenceParts | null {
    const openingEnd = block.indexOf("\n");
    const sourceOpening = openingEnd >= 0 ? block.slice(0, openingEnd) : block;
    const match = matchFenceOpening(
        sourceOpening,
        inheritedFenceContainers(previousBlock),
    );
    if (!match) return null;

    const marker = match.marker;
    const opening = match.containers.length > 0
        ? canonicalFenceOpening(match)
        : sourceOpening;
    const closingPattern = new RegExp(`^ {0,3}${marker.charAt(0)}{${marker.length},} *$`);
    let cursor = openingEnd >= 0 ? openingEnd + 1 : block.length;

    while (cursor < block.length) {
        const lineEnd = block.indexOf("\n", cursor);
        const end = lineEnd >= 0 ? lineEnd : block.length;
        const line = block.slice(cursor, end);
        const expandedLine = expandMarkdownLine(line).text;
        const contentStart = consumeExpandedFenceContainerPrefix(
            expandedLine,
            match.containers,
        );
        if (contentStart === null) return null;
        if (closingPattern.test(expandedLine.slice(contentStart))) {
            const suffix = lineEnd >= 0 ? block.slice(lineEnd + 1) : "";
            if (suffix.trim().length > 0) return null;
            return {
                opening,
                body: block.slice(openingEnd + 1, cursor),
                bodySourceStart: openingEnd + 1,
                bodySourceEnd: cursor,
                closing: match.containers.length > 0
                    ? syntheticFenceClosing(match)
                    : line,
                containerized: match.containers.length > 0,
                containers: match.containers,
            };
        }
        cursor = lineEnd >= 0 ? lineEnd + 1 : block.length;
    }

    return {
        opening,
        body: openingEnd >= 0 ? block.slice(openingEnd + 1) : "",
        bodySourceStart: openingEnd >= 0 ? openingEnd + 1 : block.length,
        bodySourceEnd: block.length,
        closing: syntheticFenceClosing(match),
        containerized: match.containers.length > 0,
        containers: match.containers,
    };
}

function fencedChunk(parts: FenceParts, body: string): string {
    const separator = body.length > 0 && !body.endsWith("\n") ? "\n" : "";
    return `${parts.opening}\n${body}${separator}${parts.closing}`;
}

function fencedBodyHasText(parts: FenceParts, body: string): boolean {
    return body.split("\n").some((line) => {
        const expanded = expandMarkdownLine(line).text;
        const contentStart = consumeExpandedFenceContainerPrefix(
            expanded,
            parts.containers,
        );
        return contentStart !== null
            && expanded.slice(contentStart).trim().length > 0;
    });
}

async function measuredFit(
    fits: ShareCardFitPredicate,
    markdown: string,
    pageIndex: number,
    renderPlan: ShareCardRenderPlan,
): Promise<boolean> {
    try {
        return await fits(markdown, pageIndex, { renderPlan });
    } catch (error) {
        throw new ShareCardPaginationError(
            "measurement-failed",
            "Unable to measure Share Card content.",
            { cause: error },
        );
    }
}

async function largestFittingBoundary(
    text: string,
    boundaries: readonly number[],
    decorate: (prefix: string) => string,
    fits: ShareCardFitPredicate,
    pageIndex: number,
    hasText: (prefix: string) => boolean,
    renderPlanForBoundary: (boundary: number, markdown: string) => ShareCardRenderPlan,
): Promise<number> {
    let low = 0;
    let high = boundaries.length - 1;
    let best = 0;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const boundary = boundaries[middle];
        const prefix = text.slice(0, boundary);
        if (!hasText(prefix)) {
            low = middle + 1;
            continue;
        }

        const markdown = decorate(prefix);
        if (await measuredFit(
            fits,
            markdown,
            pageIndex,
            renderPlanForBoundary(boundary, markdown),
        )) {
            best = boundary;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return best;
}

function lineBoundaries(text: string): number[] {
    const boundaries: number[] = [];
    for (let index = 0; index < text.length - 1; index += 1) {
        if (text.charAt(index) === "\n") boundaries.push(index + 1);
    }
    return boundaries;
}

function wordBoundaries(text: string): number[] {
    const boundaries: number[] = [];
    const matcher = /\s+/gu;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
        const boundary = match.index + match[0].length;
        if (boundary < text.length) boundaries.push(boundary);
    }
    return boundaries;
}

function codePointBoundaries(text: string): number[] {
    const boundaries: number[] = [];
    let utf16Offset = 0;
    for (const codePoint of text) {
        utf16Offset += codePoint.length;
        if (utf16Offset < text.length) boundaries.push(utf16Offset);
    }
    return boundaries;
}

async function fittingPrefixLength(
    text: string,
    decorate: (prefix: string) => string,
    fits: ShareCardFitPredicate,
    pageIndex: number,
    renderPlanForBoundary: (boundary: number, markdown: string) => ShareCardRenderPlan,
    allowedBoundaries: readonly number[] | undefined,
    lineOnly = false,
    hasText: (prefix: string) => boolean = (prefix) => prefix.trim().length > 0,
): Promise<number> {
    const rawBoundaryGroups = lineOnly
        ? [lineBoundaries(text)]
        : [lineBoundaries(text), wordBoundaries(text), codePointBoundaries(text)];
    const allowed = allowedBoundaries ? new Set(allowedBoundaries) : null;
    const boundaryGroups = allowed
        ? rawBoundaryGroups.map((boundaries) => boundaries.filter((boundary) => (
            allowed.has(boundary)
        )))
        : rawBoundaryGroups;
    for (const boundaries of boundaryGroups) {
        const boundary = await largestFittingBoundary(
            text,
            boundaries,
            decorate,
            fits,
            pageIndex,
            hasText,
            renderPlanForBoundary,
        );
        if (boundary > 0) return boundary;
    }
    return 0;
}

interface InlineSpan {
    kind: "inline-code" | "markup";
    opening: string;
    closing: string;
    contentStart: number;
    contentEnd: number;
}

interface SourceRange {
    start: number;
    end: number;
}

interface MarkdownLine {
    start: number;
    end: number;
    prefixEnd: number;
    listItem: boolean;
    listMarkerColumn: number | null;
    listStructureKey: string | null;
    taskItem: boolean;
}

interface SafeFragmentPlan {
    source: string;
    lineBoundaries: number[];
    wordBoundaries: number[];
    codePointBoundaries: number[];
    literalBoundaries: ReadonlySet<number>;
    render(start: number, end: number): string;
    hasText(start: number, end: number): boolean;
}

export interface ShareCardFragmentBoundaryPlan {
    boundaries: readonly number[];
    insertions: readonly {
        insertionOffset: number;
        kind: "element" | "literal";
        snap?: "list-item-start";
        sourceOffset: number;
    }[];
    kind: "markdown" | "fenced-code";
    virtualBoundaries?: readonly {
        edge: "start" | "end";
        sourceOffset: number;
    }[];
}

/** Bound one-time sentinel DOM growth for any semantic block. */
export const MAX_SHARE_CARD_FRAGMENT_BOUNDARIES = 2_048;
const MAX_PRIORITY_LINE_BOUNDARIES = 512;
const MAX_PRIORITY_WORD_BOUNDARIES = 768;
const MIN_DENSE_CODE_POINT_BOUNDARIES = MAX_SHARE_CARD_PAGES;

function createRenderPlan(
    segments: readonly ShareCardRenderPlanSegment[],
): ShareCardRenderPlan {
    return { segments };
}

function createRenderSegment(
    blockIndex: number,
    sourceStart: number,
    sourceEnd: number,
    markdown: string,
): ShareCardRenderPlanSegment {
    return { blockIndex, sourceStart, sourceEnd, markdown };
}

function addEvenlySampledBoundaries(
    selected: Set<number>,
    candidates: readonly number[],
    requested: number,
): void {
    const available = candidates.filter((boundary) => !selected.has(boundary));
    const count = Math.min(
        requested,
        MAX_SHARE_CARD_FRAGMENT_BOUNDARIES - selected.size,
        available.length,
    );
    if (count <= 0) return;
    if (count === available.length) {
        for (const boundary of available) selected.add(boundary);
        return;
    }
    if (count === 1) {
        selected.add(available[0]!);
        return;
    }
    for (let index = 0; index < count; index += 1) {
        const candidateIndex = Math.round(
            (index * (available.length - 1)) / (count - 1),
        );
        selected.add(available[candidateIndex]!);
    }
}

function selectInstrumentedBoundaries(
    lineCandidates: readonly number[],
    wordCandidates: readonly number[],
    codePointCandidates: readonly number[],
    limit = MAX_SHARE_CARD_FRAGMENT_BOUNDARIES,
): number[] {
    if (codePointCandidates.length <= limit) return [...codePointCandidates];
    const selected = new Set<number>();
    for (const boundary of codePointCandidates.slice(
        0,
        Math.min(MIN_DENSE_CODE_POINT_BOUNDARIES, limit),
    )) {
        selected.add(boundary);
    }
    addEvenlySampledBoundaries(
        selected,
        lineCandidates,
        Math.min(MAX_PRIORITY_LINE_BOUNDARIES, limit - selected.size),
    );
    addEvenlySampledBoundaries(
        selected,
        wordCandidates,
        Math.min(MAX_PRIORITY_WORD_BOUNDARIES, limit - selected.size),
    );
    addEvenlySampledBoundaries(
        selected,
        codePointCandidates,
        limit - selected.size,
    );
    return [...selected].sort((left, right) => left - right);
}

function paginationCannotProveSafety(message: string): never {
    throw new ShareCardPaginationError("unpageable-content", message);
}

function codePointEnd(text: string, start: number): number {
    const first = text.charCodeAt(start);
    return first >= 0xD800 && first <= 0xDBFF
        && text.charCodeAt(start + 1) >= 0xDC00
        && text.charCodeAt(start + 1) <= 0xDFFF
        ? start + 2
        : start + 1;
}

function escapedAt(text: string, index: number): boolean {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === "\\"; cursor -= 1) {
        slashes += 1;
    }
    return slashes % 2 === 1;
}

function linePrefix(line: string): {
    end: number;
    listItem: boolean;
    listMarkerColumn: number | null;
    listStructureKey: string | null;
    taskItem: boolean;
} {
    let cursor = 0;
    let prefixEnd = 0;
    let sawContainer = false;
    let blockquoteDepth = 0;
    const listMarkers: string[] = [];
    let lastListMarkerColumn = -1;
    let taskItem = false;

    while (cursor < line.length) {
        const containerStart = cursor;
        let markerStart = cursor;
        while (
            markerStart - containerStart < 3
            && (line.charAt(markerStart) === " " || line.charAt(markerStart) === "\t")
        ) {
            markerStart += 1;
        }
        if (!sawContainer) prefixEnd = markerStart;

        if (line.charAt(markerStart) === ">") {
            cursor = markerStart + 1;
            if (line.charAt(cursor) === " " || line.charAt(cursor) === "\t") cursor += 1;
            prefixEnd = cursor;
            sawContainer = true;
            blockquoteDepth += 1;
            continue;
        }

        const listMarker = /^((?:[*+-])|(\d{1,9})([.)]))([ \t]+)/.exec(
            line.slice(markerStart),
        );
        if (!listMarker) break;
        cursor = markerStart + listMarker[0].length;
        prefixEnd = cursor;
        sawContainer = true;
        lastListMarkerColumn = markerStart;
        listMarkers.push(listMarker[2]
            ? `ordered:${listMarker[3]}`
            : `bullet:${listMarker[1]}`);

        const taskMarker = /^\[[ xX]\][ \t]+/.exec(line.slice(cursor));
        if (taskMarker) {
            cursor += taskMarker[0].length;
            prefixEnd = cursor;
            taskItem = true;
        }
    }

    const heading = /^(#{1,6})[ \t]+/.exec(line.slice(prefixEnd));
    if (heading) prefixEnd += heading[0].length;
    const listItem = listMarkers.length > 0;
    const listStructureKey = listItem && !line.slice(0, prefixEnd).includes("\t")
        ? [
            `quote:${blockquoteDepth}`,
            `depth:${listMarkers.length}`,
            `column:${lastListMarkerColumn}`,
            ...listMarkers,
        ].join("|")
        : null;
    return {
        end: prefixEnd,
        listItem,
        listMarkerColumn: listItem ? lastListMarkerColumn : null,
        listStructureKey,
        taskItem,
    };
}

function analyzeMarkdownLines(source: string): MarkdownLine[] {
    const lines: MarkdownLine[] = [];
    let start = 0;
    while (start <= source.length) {
        const newline = source.indexOf("\n", start);
        const end = newline >= 0 ? newline : source.length;
        const line = source.slice(start, end);
        const prefix = linePrefix(line);
        const prefixLength = prefix.end;

        if (/^(?: {4,}|\t)\S/.test(line) && prefixLength < 4) {
            paginationCannotProveSafety("Indented code cannot be split safely for Share Card pagination.");
        }
        if (/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line)) {
            paginationCannotProveSafety("Markdown tables cannot be split safely for Share Card pagination.");
        }
        if (/^\s*(?:={3,}|-{3,})\s*$/.test(line) && lines.length > 0) {
            const previous = source.slice(lines[lines.length - 1]!.start, lines[lines.length - 1]!.end);
            if (previous.trim().length > 0) {
                paginationCannotProveSafety("Setext headings cannot be split safely for Share Card pagination.");
            }
        }

        lines.push({
            start,
            end,
            prefixEnd: start + prefixLength,
            listItem: prefix.listItem,
            listMarkerColumn: prefix.listMarkerColumn,
            listStructureKey: prefix.listStructureKey,
            taskItem: prefix.taskItem,
        });
        if (newline < 0) break;
        start = newline + 1;
    }
    return lines;
}

function wouldCreateStandaloneBlock(source: string, boundary: number): boolean {
    if (boundary <= 0 || source.charAt(boundary - 1) === "\n") return false;
    const remainder = source.slice(boundary, boundary + 64);
    return /^(?: {4}|\t| {0,3}(?:#{1,6}(?:[ \t]|$)|>[ \t]?|(?:[*+-]|\d{1,9}[.)])(?:[ \t]+|$)|`{3,}|~{3,}|(?:[*_-][ \t]*){3,}))/u
        .test(remainder);
}

function delimiterFlanking(source: string, start: number, length: number): {
    canOpen: boolean;
    canClose: boolean;
} {
    const marker = source.charAt(start);
    const previous = start > 0 ? source.charAt(start - 1) : "\n";
    const next = source.charAt(start + length) || "\n";
    const previousWhitespace = /\s/u.test(previous);
    const nextWhitespace = /\s/u.test(next);
    const previousPunctuation = /[\p{P}\p{S}]/u.test(previous);
    const nextPunctuation = /[\p{P}\p{S}]/u.test(next);
    const leftFlanking = !nextWhitespace
        && (!nextPunctuation || previousWhitespace || previousPunctuation);
    const rightFlanking = !previousWhitespace
        && (!previousPunctuation || nextWhitespace || nextPunctuation);

    return marker === "_"
        ? {
            canOpen: leftFlanking && (!rightFlanking || previousPunctuation),
            canClose: rightFlanking && (!leftFlanking || nextPunctuation),
        }
        : { canOpen: leftFlanking, canClose: rightFlanking };
}

function findCodeSpanClose(source: string, start: number, limit: number): number {
    const markerLength = (() => {
        let end = start;
        while (source.charAt(end) === "`") end += 1;
        return end - start;
    })();
    let cursor = start + markerLength;
    while (cursor < limit) {
        if (source.charAt(cursor) !== "`") {
            cursor += 1;
            continue;
        }
        let runEnd = cursor + 1;
        while (source.charAt(runEnd) === "`") runEnd += 1;
        if (runEnd - cursor === markerLength) return cursor;
        cursor = runEnd;
    }
    return -1;
}

interface InlineLink {
    labelEnd: number;
    end: number;
}

function findClosingLabelBracket(source: string, start: number, limit: number): number {
    let depth = 1;
    let cursor = start + 1;
    while (cursor < limit) {
        if (source.charAt(cursor) === "\\") {
            cursor = Math.min(limit, codePointEnd(source, cursor + 1));
            continue;
        }
        if (source.charAt(cursor) === "`") {
            const close = findCodeSpanClose(source, cursor, limit);
            if (close < 0) paginationCannotProveSafety("Unclosed inline code cannot be split safely.");
            let markerEnd = cursor + 1;
            while (source.charAt(markerEnd) === "`") markerEnd += 1;
            cursor = close + (markerEnd - cursor);
            continue;
        }
        if (source.charAt(cursor) === "[") depth += 1;
        if (source.charAt(cursor) === "]") {
            depth -= 1;
            if (depth === 0) return cursor;
        }
        cursor += 1;
    }
    return -1;
}

function findInlineLink(source: string, start: number, limit: number): InlineLink | null {
    const labelEnd = findClosingLabelBracket(source, start, limit);
    if (labelEnd < 0 || source.charAt(labelEnd + 1) !== "(") return null;

    let cursor = labelEnd + 2;
    let parentheses = 1;
    let quote = "";
    let angle = false;
    while (cursor < limit) {
        const character = source.charAt(cursor);
        if (character === "\\") {
            cursor = Math.min(limit, codePointEnd(source, cursor + 1));
            continue;
        }
        if (quote) {
            if (character === quote) quote = "";
        } else if (angle) {
            if (character === ">") angle = false;
        } else if (character === "<" && parentheses === 1) {
            angle = true;
        } else if (character === "\"" || character === "'") {
            quote = character;
        } else if (character === "(") {
            parentheses += 1;
        } else if (character === ")") {
            parentheses -= 1;
            if (parentheses === 0) return { labelEnd, end: cursor + 1 };
        }
        cursor += 1;
    }
    paginationCannotProveSafety("An incomplete Markdown link cannot be split safely.");
}

function normalizeReferenceLabel(label: string): string {
    return label
        .replace(/\\([!-/:-@[-`{-~])/gu, "$1")
        .trim()
        .replace(/\s+/gu, " ")
        .toLowerCase();
}

function findReferenceLabelEnd(source: string, start: number): number {
    let cursor = start + 1;
    while (cursor < source.length) {
        if (source.charAt(cursor) === "\\") {
            cursor = Math.min(source.length, codePointEnd(source, cursor + 1));
            continue;
        }
        if (source.charAt(cursor) === "[") return -1;
        if (source.charAt(cursor) === "]") return cursor;
        cursor += 1;
    }
    return -1;
}

function referenceDefinitionLabel(line: string): string | null {
    const expanded = expandMarkdownLine(line).text;
    const containers = parseFenceContainers(expanded);
    let labelStart = containers.contentStart;
    let indentation = 0;
    while (indentation < 3 && expanded.charAt(labelStart) === " ") {
        labelStart += 1;
        indentation += 1;
    }
    if (expanded.charAt(labelStart) !== "[") return null;
    const labelEnd = findReferenceLabelEnd(expanded, labelStart);
    if (labelEnd < 0 || expanded.charAt(labelEnd + 1) !== ":") return null;
    return normalizeReferenceLabel(expanded.slice(labelStart + 1, labelEnd));
}

function markdownLinesOutsideCode(markdown: string): string[] {
    const lines: string[] = [];
    let activeFence: FenceOpening | null = null;
    let rawCodeTag: "code" | "pre" | null = null;

    for (const sourceLine of markdown.split("\n")) {
        const expandedSource = expandMarkdownLine(sourceLine).text;
        if (activeFence) {
            const contentStart = consumeExpandedFenceContainerPrefix(
                expandedSource,
                activeFence.containers,
            );
            const closingPattern = new RegExp(
                `^ {0,3}${activeFence.marker.charAt(0)}{${activeFence.marker.length},} *$`,
            );
            if (
                contentStart !== null
                && closingPattern.test(expandedSource.slice(contentStart))
            ) {
                activeFence = null;
            }
            continue;
        }

        let line = sourceLine;
        if (rawCodeTag) {
            const closing = new RegExp(`<\\/${rawCodeTag}\\s*>`, "iu").exec(line);
            if (!closing) continue;
            line = line.slice(closing.index + closing[0].length);
            rawCodeTag = null;
        }

        line = line.replace(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
        const rawOpening = /<(code|pre)\b[^>]*>/iu.exec(line);
        if (rawOpening) {
            rawCodeTag = rawOpening[1]!.toLowerCase() as "code" | "pre";
            line = line.slice(0, rawOpening.index);
        }

        const opening = matchFenceOpening(line);
        if (opening) {
            activeFence = opening;
            continue;
        }
        if (/^(?: {4}|\t)/u.test(line)) continue;
        lines.push(line);
    }
    return lines;
}

function referenceDefinitionLabels(markdown: string): Set<string> {
    const labels = new Set<string>();
    for (const line of markdownLinesOutsideCode(markdown)) {
        const label = referenceDefinitionLabel(line);
        if (label) labels.add(label);
    }
    return labels;
}

function referencedLabels(
    markdown: string,
    knownDefinitions: ReadonlySet<string>,
): Set<string> {
    const labels = new Set<string>();
    for (const line of markdownLinesOutsideCode(markdown)) {
        if (referenceDefinitionLabel(line)) continue;

        let cursor = 0;
        while (cursor < line.length) {
            if (line.charAt(cursor) === "\\") {
                cursor = Math.min(line.length, codePointEnd(line, cursor + 1));
                continue;
            }
            if (line.charAt(cursor) === "`") {
                const close = findCodeSpanClose(line, cursor, line.length);
                let markerEnd = cursor + 1;
                while (line.charAt(markerEnd) === "`") markerEnd += 1;
                if (close < 0) {
                    cursor = markerEnd;
                    continue;
                }
                cursor = close + (markerEnd - cursor);
                continue;
            }
            const isImage = line.charAt(cursor) === "!"
                && line.charAt(cursor + 1) === "["
                && !escapedAt(line, cursor);
            const labelStart = isImage ? cursor + 1 : cursor;
            if (line.charAt(labelStart) !== "[") {
                cursor += 1;
                continue;
            }
            if (
                !isImage
                && labelStart > 0
                && line.charAt(labelStart - 1) === "!"
                && !escapedAt(line, labelStart - 1)
            ) {
                cursor += 1;
                continue;
            }

            const labelEnd = findClosingLabelBracket(line, labelStart, line.length);
            if (labelEnd < 0) break;
            const primaryLabel = line.slice(labelStart + 1, labelEnd);
            if (line.charAt(labelEnd + 1) === ":") break;

            const inline = findInlineLink(line, labelStart, line.length);
            if (inline) {
                cursor = inline.end;
                continue;
            }

            let after = labelEnd + 1;
            while (line.charAt(after) === " " || line.charAt(after) === "\t") after += 1;
            let referenceLabel = primaryLabel;
            if (line.charAt(after) === "[") {
                const referenceEnd = findClosingLabelBracket(line, after, line.length);
                if (referenceEnd < 0) break;
                const explicitLabel = line.slice(after + 1, referenceEnd);
                if (explicitLabel.length > 0) referenceLabel = explicitLabel;
                cursor = referenceEnd + 1;
            } else {
                cursor = labelEnd + 1;
            }

            const normalized = normalizeReferenceLabel(referenceLabel);
            if (knownDefinitions.has(normalized)) labels.add(normalized);
        }
    }
    return labels;
}

export interface ShareCardReferenceDefinitionContext {
    readonly definitions: ReadonlyMap<string, string>;
}

/** Collect block-level reference definitions while ignoring literal code. */
export function createShareCardReferenceDefinitionContext(
    blocks: readonly string[],
): ShareCardReferenceDefinitionContext {
    const definitions = new Map<string, string>();
    for (const block of blocks) {
        const lines = markdownLinesOutsideCode(block);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]!;
            const label = referenceDefinitionLabel(line);
            if (!label || definitions.has(label)) continue;
            const definitionLines = [line];
            while (
                index + 1 < lines.length
                && /^(?: {1,3}|\t)\S/u.test(lines[index + 1] ?? "")
            ) {
                definitionLines.push(lines[index + 1]!);
                index += 1;
            }
            definitions.set(label, definitionLines.join("\n"));
        }
    }
    return { definitions };
}

/** Add only the invisible definitions referenced by one semantic block. */
export function applyShareCardReferenceDefinitionContext(
    markdown: string,
    context: ShareCardReferenceDefinitionContext,
): string {
    if (context.definitions.size === 0) return markdown;
    const knownDefinitions = new Set(context.definitions.keys());
    const availableDefinitions = referenceDefinitionLabels(markdown);
    const requiredDefinitions = [...referencedLabels(markdown, knownDefinitions)]
        .filter((label) => !availableDefinitions.has(label))
        .map((label) => context.definitions.get(label))
        .filter((definition): definition is string => Boolean(definition));
    return requiredDefinitions.length > 0
        ? `${markdown}\n\n${requiredDefinitions.join("\n")}`
        : markdown;
}

function containsOnlyReferenceDefinitions(markdown: string): boolean {
    const lines = markdownLinesOutsideCode(markdown);
    let sawDefinition = false;
    let acceptsContinuation = false;
    for (const line of lines) {
        if (line.trim().length === 0) continue;
        if (referenceDefinitionLabel(line)) {
            sawDefinition = true;
            acceptsContinuation = true;
            continue;
        }
        if (acceptsContinuation) {
            const expanded = expandMarkdownLine(line).text;
            const containers = parseFenceContainers(expanded);
            if (/^(?: {1,3}|\t)\S/u.test(expanded.slice(containers.contentStart))) {
                continue;
            }
        }
        return false;
    }
    return sawDefinition;
}

function withoutReferenceDefinitions(markdown: string): string {
    const visibleLines: string[] = [];
    let acceptsContinuation = false;
    for (const line of markdown.split("\n")) {
        if (referenceDefinitionLabel(line)) {
            acceptsContinuation = true;
            continue;
        }
        if (acceptsContinuation) {
            const expanded = expandMarkdownLine(line).text;
            const containers = parseFenceContainers(expanded);
            if (/^(?: {1,3}|\t)\S/u.test(expanded.slice(containers.contentStart))) {
                continue;
            }
        }
        acceptsContinuation = false;
        visibleLines.push(line);
    }
    while (visibleLines[visibleLines.length - 1]?.trim().length === 0) {
        visibleLines.pop();
    }
    return visibleLines.join("\n");
}

function foldInvisibleReferencePages(
    pages: Array<{ content: string; renderPlan: ShareCardRenderPlan }>,
): Array<{ content: string; renderPlan: ShareCardRenderPlan }> {
    const result: Array<{ content: string; renderPlan: ShareCardRenderPlan }> = [];
    let leadingInvisible: { content: string; renderPlan: ShareCardRenderPlan } | null = null;
    for (const page of pages) {
        if (!containsOnlyReferenceDefinitions(page.content)) {
            if (leadingInvisible) {
                page.content = joinPageRecordContent(leadingInvisible, page);
                page.renderPlan = createRenderPlan([
                    ...leadingInvisible.renderPlan.segments,
                    ...page.renderPlan.segments,
                ]);
                leadingInvisible = null;
            }
            result.push(page);
            continue;
        }
        const previous = result[result.length - 1];
        if (previous) {
            previous.content = joinPageRecordContent(previous, page);
            previous.renderPlan = createRenderPlan([
                ...previous.renderPlan.segments,
                ...page.renderPlan.segments,
            ]);
        } else if (leadingInvisible) {
            leadingInvisible.content = joinPageRecordContent(leadingInvisible, page);
            leadingInvisible.renderPlan = createRenderPlan([
                ...leadingInvisible.renderPlan.segments,
                ...page.renderPlan.segments,
            ]);
        } else {
            leadingInvisible = page;
        }
    }
    if (leadingInvisible) result.push(leadingInvisible);
    return result;
}

function joinPageRecordContent(
    left: { content: string; renderPlan: ShareCardRenderPlan },
    right: { content: string; renderPlan: ShareCardRenderPlan },
): string {
    const leftSegment = left.renderPlan.segments[left.renderPlan.segments.length - 1];
    const rightSegment = right.renderPlan.segments[0];
    const isContiguousSource = Boolean(
        leftSegment
        && rightSegment
        && leftSegment.blockIndex === rightSegment.blockIndex
        && leftSegment.sourceEnd === rightSegment.sourceStart,
    );
    return isContiguousSource
        ? left.content + right.content
        : joinBlocks(left.content, right.content);
}

function createSafeFragmentPlan(source: string): SafeFragmentPlan {
    const lines = analyzeMarkdownLines(source);
    const lineByStart = new Map(lines.map((line) => [line.start, line]));
    const listMarkerColumns = lines
        .map((line) => line.listMarkerColumn)
        .filter((column): column is number => column !== null);
    const minimumListMarkerColumn = listMarkerColumns.length > 0
        ? Math.min(...listMarkerColumns)
        : null;
    const masked = source.split("");
    const protectedBoundaries: number[] = [];
    const contentRanges: SourceRange[] = [];
    const spans: InlineSpan[] = [];

    const protectToken = (start: number, end: number): void => {
        for (let boundary = start + 1; boundary < end; boundary += 1) {
            protectedBoundaries.push(boundary);
        }
    };
    for (const line of lines) {
        for (let index = line.start; index < line.prefixEnd; index += 1) masked[index] = " ";
        for (let boundary = line.start + 1; boundary <= line.prefixEnd; boundary += 1) {
            protectedBoundaries.push(boundary);
        }
    }
    const taskScopes: SourceRange[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const item = lines[index]!;
        if (!item.taskItem) continue;
        if (taskScopes.some((scope) => item.start > scope.start && item.start < scope.end)) {
            continue;
        }
        const sibling = item.listStructureKey
            ? lines.slice(index + 1).find((line) => (
                line.listItem && line.listStructureKey === item.listStructureKey
            ))
            : undefined;
        const itemEnd = sibling?.start ?? source.length;
        taskScopes.push({ start: item.start, end: itemEnd });
        // A task owns nested child items and continuation lines. Only a proven
        // same-structure sibling starts a new pagination unit.
        for (let boundary = item.start + 1; boundary < itemEnd; boundary += 1) {
            protectedBoundaries.push(boundary);
        }
    }
    const view = masked.join("");

    const parseRange = (
        start: number,
        limit: number,
        closing?: { marker: string; length: number },
        depth = 0,
        insideLink = false,
    ): { closeStart: number; after: number } | null => {
        if (depth > 64) paginationCannotProveSafety("Markdown nesting is too deep to paginate safely.");
        let cursor = start;
        while (cursor < limit) {
            const character = view.charAt(cursor);
            if (closing && character === closing.marker) {
                let runEnd = cursor + 1;
                while (view.charAt(runEnd) === closing.marker) runEnd += 1;
                const flanking = delimiterFlanking(view, cursor, runEnd - cursor);
                if (
                    runEnd - cursor === closing.length
                    && flanking.canClose
                    && !flanking.canOpen
                ) {
                    return { closeStart: cursor, after: cursor + closing.length };
                }
            }

            if (character === "\\") {
                if (cursor + 1 >= limit) {
                    paginationCannotProveSafety("A trailing Markdown escape cannot be split safely.");
                }
                const escapedEnd = codePointEnd(source, cursor + 1);
                protectToken(cursor, escapedEnd);
                contentRanges.push({ start: cursor + 1, end: escapedEnd });
                cursor = escapedEnd;
                continue;
            }
            if (character === "`") {
                let openerEnd = cursor + 1;
                while (view.charAt(openerEnd) === "`") openerEnd += 1;
                const closeStart = findCodeSpanClose(view, cursor, limit);
                if (closeStart < 0) paginationCannotProveSafety("Unclosed inline code cannot be split safely.");
                const closeEnd = closeStart + (openerEnd - cursor);
                spans.push({
                    kind: "inline-code",
                    opening: source.slice(cursor, openerEnd),
                    closing: source.slice(closeStart, closeEnd),
                    contentStart: openerEnd,
                    contentEnd: closeStart,
                });
                protectToken(cursor, openerEnd);
                protectToken(closeStart, closeEnd);
                protectedBoundaries.push(openerEnd, closeStart);
                for (let index = openerEnd; index < closeStart;) {
                    if (source.charAt(index) === "`") {
                        paginationCannotProveSafety(
                            "An inline-code backtick run cannot be split safely.",
                        );
                    }
                    const end = codePointEnd(source, index);
                    contentRanges.push({ start: index, end });
                    index = end;
                }
                cursor = closeEnd;
                continue;
            }
            if (view.startsWith("[[", cursor)) {
                const wikiClose = view.indexOf("]]", cursor + 2);
                if (wikiClose < 0 || wikiClose >= limit) {
                    paginationCannotProveSafety("Unclosed wiki-link cannot be split safely.");
                }
                const wikiEnd = wikiClose + 2;
                protectToken(cursor, wikiEnd);
                cursor = wikiEnd;
                continue;
            }
            if (view.startsWith("![[", cursor)) {
                const embedClose = view.indexOf("]]", cursor + 3);
                if (embedClose < 0 || embedClose >= limit) {
                    paginationCannotProveSafety("Unclosed embed cannot be split safely.");
                }
                const embedEnd = embedClose + 2;
                protectToken(cursor, embedEnd);
                cursor = embedEnd;
                continue;
            }
            if (
                view.startsWith("![", cursor)
                || view.startsWith("~~", cursor)
                || view.startsWith("==", cursor)
                || view.startsWith("%%", cursor)
                || view.startsWith("$$", cursor)
                || (character === "<" && /^<\/?[a-z!]|^<https?:|^<[\w.+-]+@/i.test(
                    view.slice(cursor, cursor + 256),
                ))
            ) {
                paginationCannotProveSafety("Unsupported complex Markdown cannot be split safely.");
            }
            if (character === "[") {
                const link = findInlineLink(view, cursor, limit);
                if (link) {
                    if (insideLink) paginationCannotProveSafety("Nested Markdown links cannot be split safely.");
                    parseRange(cursor + 1, link.labelEnd, undefined, depth + 1, true);
                    spans.push({
                        kind: "markup",
                        opening: "[",
                        closing: source.slice(link.labelEnd, link.end),
                        contentStart: cursor + 1,
                        contentEnd: link.labelEnd,
                    });
                    protectToken(link.labelEnd, link.end);
                    protectedBoundaries.push(cursor + 1, link.labelEnd);
                    cursor = link.end;
                    continue;
                }
                const closingBracket = findClosingLabelBracket(view, cursor, limit);
                if (closingBracket >= 0) {
                    let tokenEnd = closingBracket + 1;
                    let referenceStart = tokenEnd;
                    while (
                        referenceStart < limit
                        && (view.charAt(referenceStart) === " "
                            || view.charAt(referenceStart) === "\t")
                    ) {
                        referenceStart += 1;
                    }
                    if (view.charAt(referenceStart) === "[") {
                        const referenceEnd = findClosingLabelBracket(
                            view,
                            referenceStart,
                            limit,
                        );
                        if (referenceEnd < 0) {
                            paginationCannotProveSafety("An incomplete reference link cannot be split safely.");
                        }
                        tokenEnd = referenceEnd + 1;
                    } else if (view.charAt(tokenEnd) === ":") {
                        const lineEnd = view.indexOf("\n", tokenEnd);
                        tokenEnd = lineEnd >= 0 ? lineEnd : limit;
                    }

                    protectToken(cursor, tokenEnd);
                    contentRanges.push({ start: cursor, end: tokenEnd });
                    cursor = tokenEnd;
                    continue;
                }
            }
            if (character === "*" || character === "_") {
                let runEnd = cursor + 1;
                while (view.charAt(runEnd) === character) runEnd += 1;
                const runLength = runEnd - cursor;
                const flanking = delimiterFlanking(view, cursor, runLength);
                if (runLength > 2 || (flanking.canOpen && flanking.canClose)) {
                    paginationCannotProveSafety("An ambiguous emphasis delimiter run cannot be split safely.");
                }
                if (flanking.canOpen) {
                    const snapshot = {
                        spans: spans.length,
                        ranges: contentRanges.length,
                        boundaries: protectedBoundaries.length,
                    };
                    const close = parseRange(
                        cursor + runLength,
                        limit,
                        { marker: character, length: runLength },
                        depth + 1,
                        insideLink,
                    );
                    if (!close) {
                        spans.length = snapshot.spans;
                        contentRanges.length = snapshot.ranges;
                        protectedBoundaries.length = snapshot.boundaries;
                        paginationCannotProveSafety("An unpaired emphasis delimiter cannot be split safely.");
                    }
                    spans.push({
                        kind: "markup",
                        opening: source.slice(cursor, runEnd),
                        closing: source.slice(close.closeStart, close.after),
                        contentStart: runEnd,
                        contentEnd: close.closeStart,
                    });
                    protectToken(cursor, runEnd);
                    protectToken(close.closeStart, close.after);
                    protectedBoundaries.push(runEnd, close.closeStart);
                    cursor = close.after;
                    continue;
                }
                protectToken(cursor, runEnd);
                contentRanges.push({ start: cursor, end: runEnd });
                cursor = runEnd;
                continue;
            }

            const entity = character === "&"
                ? /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.exec(
                    view.slice(cursor, cursor + 64),
                )
                : null;
            if (entity) {
                protectToken(cursor, cursor + entity[0].length);
                contentRanges.push({ start: cursor, end: cursor + entity[0].length });
                cursor += entity[0].length;
                continue;
            }

            const end = codePointEnd(source, cursor);
            contentRanges.push({ start: cursor, end });
            cursor = end;
        }
        return null;
    };

    parseRange(0, source.length);
    const protectedSet = new Set(protectedBoundaries);
    const allBoundaries = codePointBoundaries(source).filter((boundary) => {
        const line = lineByStart.get(boundary);
        const safeListItemStart = !line?.listItem || (
            line.listStructureKey !== null
            && line.listMarkerColumn === minimumListMarkerColumn
        );
        return !protectedSet.has(boundary)
            && safeListItemStart
            && source.charAt(boundary) !== "\n"
            && source.charAt(boundary) !== "\r"
            && !wouldCreateStandaloneBlock(source, boundary)
            && !(source.charAt(boundary - 1) === "\r" && source.charAt(boundary) === "\n");
    });
    const lineBoundarySet = new Set(lineBoundaries(source));
    const wordBoundarySet = new Set(wordBoundaries(source));
    const rawLineBoundaries = allBoundaries.filter((boundary) => lineBoundarySet.has(boundary));
    const rawWordBoundaries = allBoundaries.filter((boundary) => wordBoundarySet.has(boundary));
    const instrumentedBoundaries = selectInstrumentedBoundaries(
        rawLineBoundaries,
        rawWordBoundaries,
        allBoundaries,
    );
    const instrumentedSet = new Set(instrumentedBoundaries);
    const literalBoundaries = new Set(instrumentedBoundaries.filter((boundary) => (
        spans.some((span) => (
            span.kind === "inline-code"
            && span.contentStart < boundary
            && boundary < span.contentEnd
        ))
    )));
    const activeAt = (offset: number): InlineSpan[] => spans
        .filter((span) => span.contentStart < offset && offset < span.contentEnd)
        .sort((left, right) => left.contentStart - right.contentStart);
    const prefixAt = (offset: number): string => {
        const line = lines.find((candidate) => candidate.start <= offset && offset <= candidate.end);
        return line && offset > line.prefixEnd
            ? source.slice(line.start, line.prefixEnd)
            : "";
    };

    return {
        source,
        lineBoundaries: rawLineBoundaries.filter((boundary) => instrumentedSet.has(boundary)),
        wordBoundaries: rawWordBoundaries.filter((boundary) => instrumentedSet.has(boundary)),
        codePointBoundaries: instrumentedBoundaries,
        literalBoundaries,
        render(start, end): string {
            const opening = activeAt(start).map((span) => span.opening).join("");
            const closing = activeAt(end).reverse().map((span) => span.closing).join("");
            const slice = source.slice(start, end);
            const leading = /^\s*/u.exec(slice)?.[0] ?? "";
            const withoutLeading = slice.slice(leading.length);
            const trailing = /\s*$/u.exec(withoutLeading)?.[0] ?? "";
            const core = withoutLeading.slice(0, withoutLeading.length - trailing.length);
            return `${prefixAt(start)}${leading}${opening}${core}${closing}${trailing}`;
        },
        hasText(start, end): boolean {
            return contentRanges.some((range) => (
                range.end > start
                && range.start < end
                && source.slice(Math.max(start, range.start), Math.min(end, range.end)).trim().length > 0
            ));
        },
    };
}

/**
 * Boundaries that can be instrumented before the one semantic Markdown render.
 * Complex blocks remain whole; if they later overflow, pagination fails closed.
 */
export function createShareCardFragmentBoundaryPlan(
    block: string,
    previousBlock?: string,
): ShareCardFragmentBoundaryPlan | null {
    // Visual blocks are atomic pagination units. Instrumenting them would
    // change the source seen by Mermaid or another Markdown postprocessor even
    // though none of these boundaries can ever be consumed by pagination.
    if (isAtomicShareCardVisualBlock(block)) return null;
    const fence = parseFence(block, previousBlock);
    if (fence) {
        const bodyLineBoundaries = lineBoundaries(fence.body);
        const bodyWordBoundaries = fence.containerized ? [] : wordBoundaries(fence.body);
        const bodyCodePointBoundaries = fence.containerized
            ? bodyLineBoundaries
            : codePointBoundaries(fence.body);
        const bodyBoundaries = selectInstrumentedBoundaries(
            bodyLineBoundaries,
            bodyWordBoundaries,
            bodyCodePointBoundaries,
            MAX_SHARE_CARD_FRAGMENT_BOUNDARIES - 2,
        );
        const sourceBoundaries = [...new Set([
            fence.bodySourceStart,
            ...bodyBoundaries.map((offset) => fence.bodySourceStart + offset),
            fence.bodySourceEnd,
        ])];
        return {
            kind: "fenced-code",
            boundaries: sourceBoundaries,
            insertions: sourceBoundaries.slice(1, -1).map((offset) => ({
                insertionOffset: offset,
                kind: "literal" as const,
                sourceOffset: offset,
            })),
            virtualBoundaries: [
                { edge: "start", sourceOffset: fence.bodySourceStart },
                { edge: "end", sourceOffset: fence.bodySourceEnd },
            ],
        };
    }
    try {
        const safePlan = createSafeFragmentPlan(block);
        const lines = analyzeMarkdownLines(block);
        const referenceRanges = referenceDefinitionSourceRanges(block);
        const boundaries = safePlan.codePointBoundaries.filter((boundary) => (
            !referenceRanges.some((range) => range.start <= boundary && boundary <= range.end)
        ));
        return {
            kind: "markdown",
            boundaries,
            insertions: boundaries.map((sourceOffset) => {
                const line = lines.find((candidate) => candidate.start === sourceOffset);
                return {
                    sourceOffset,
                    insertionOffset: line?.prefixEnd ?? sourceOffset,
                    kind: safePlan.literalBoundaries.has(sourceOffset)
                        ? "literal" as const
                        : "element" as const,
                    ...(line?.listItem && line.listStructureKey
                        ? { snap: "list-item-start" as const }
                        : {}),
                };
            }),
        };
    } catch (error) {
        if (error instanceof ShareCardPaginationError) return null;
        throw error;
    }
}

function referenceDefinitionSourceRanges(source: string): SourceRange[] {
    const ranges: SourceRange[] = [];
    let start = 0;
    let active: SourceRange | null = null;
    while (start <= source.length) {
        const newline = source.indexOf("\n", start);
        const lineEnd = newline >= 0 ? newline : source.length;
        const line = source.slice(start, lineEnd);
        if (referenceDefinitionLabel(line)) {
            active = { start, end: newline >= 0 ? newline + 1 : lineEnd };
            ranges.push(active);
        } else if (
            active
            && /^(?: {1,3}|\t)\S/u.test(expandMarkdownLine(line).text)
        ) {
            active.end = newline >= 0 ? newline + 1 : lineEnd;
        } else if (line.trim().length > 0) {
            active = null;
        }
        if (newline < 0) break;
        start = newline + 1;
    }
    return ranges;
}

async function largestSafeFragmentEnd(
    plan: SafeFragmentPlan,
    start: number,
    boundaries: readonly number[],
    fits: ShareCardFitPredicate,
    pageIndex: number,
    blockIndex: number,
): Promise<number> {
    const candidates = boundaries.filter((boundary) => boundary > start);
    let low = 0;
    let high = candidates.length - 1;
    let best = start;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const end = candidates[middle]!;
        const markdown = plan.render(start, end);
        if (!plan.hasText(start, end)) {
            low = middle + 1;
        } else if (await measuredFit(
            fits,
            markdown,
            pageIndex,
            createRenderPlan([
                createRenderSegment(blockIndex, start, end, markdown),
            ]),
        )) {
            best = end;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return best;
}

async function fittingSafeFragmentEnd(
    plan: SafeFragmentPlan,
    start: number,
    fits: ShareCardFitPredicate,
    pageIndex: number,
    blockIndex: number,
): Promise<number> {
    for (const boundaries of [
        plan.lineBoundaries,
        plan.wordBoundaries,
        plan.codePointBoundaries,
    ]) {
        const end = await largestSafeFragmentEnd(
            plan,
            start,
            boundaries,
            fits,
            pageIndex,
            blockIndex,
        );
        if (end > start) return end;
    }
    return start;
}

function joinBlocks(left: string, right: string): string {
    return left.length > 0 ? `${left}\n\n${right}` : right;
}

function joinBlockRange(
    blocks: readonly string[],
    start: number,
    end: number,
): string {
    return blocks.slice(start, end).join("\n\n");
}

interface FittingBlockPrefix {
    content: string;
    count: number;
    segments: ShareCardRenderPlanSegment[];
}

/**
 * Find a measured semantic-block prefix for the current page without rendering
 * every intermediate prefix. The accepted candidate is always measured; the
 * search changes only how many block-boundary candidates are probed.
 *
 * Non-empty blocks plus the 50k character limit bound the search to at most
 * 16 binary probes per page, and the existing 24-page limit bounds the whole
 * short-block path. Block text and order are unchanged.
 */
async function largestFittingBlockPrefix(
    blocks: readonly string[],
    start: number,
    current: string,
    currentSegments: readonly ShareCardRenderPlanSegment[],
    fits: ShareCardFitPredicate,
    pageIndex: number,
): Promise<FittingBlockPrefix> {
    const remainingCount = blocks.length - start;
    if (remainingCount <= 0) {
        return { content: current, count: 0, segments: [...currentSegments] };
    }

    const candidateForCount = (count: number): string => joinBlocks(
        current,
        joinBlockRange(blocks, start, start + count),
    );
    const segmentsForCount = (count: number): ShareCardRenderPlanSegment[] => [
        ...currentSegments,
        ...blocks.slice(start, start + count).map((block, relativeIndex) => (
            createRenderSegment(start + relativeIndex, 0, block.length, block)
        )),
    ];
    const allRemaining = candidateForCount(remainingCount);
    const allSegments = segmentsForCount(remainingCount);
    if (await measuredFit(
        fits,
        allRemaining,
        pageIndex,
        createRenderPlan(allSegments),
    )) {
        return { content: allRemaining, count: remainingCount, segments: allSegments };
    }

    let low = 1;
    let high = remainingCount - 1;
    let bestCount = 0;
    let bestContent = current;
    let bestSegments = [...currentSegments];
    while (low <= high) {
        const count = Math.floor((low + high) / 2);
        const candidate = candidateForCount(count);
        const candidateSegments = segmentsForCount(count);
        if (await measuredFit(
            fits,
            candidate,
            pageIndex,
            createRenderPlan(candidateSegments),
        )) {
            bestCount = count;
            bestContent = candidate;
            bestSegments = candidateSegments;
            low = count + 1;
        } else {
            high = count - 1;
        }
    }

    return { content: bestContent, count: bestCount, segments: bestSegments };
}

function characterCount(blocks: readonly string[]): number {
    if (blocks.length === 0) return 0;
    return blocks.reduce((total, block) => total + block.length, 0)
        + ((blocks.length - 1) * 2);
}

/**
 * Visual Markdown is kept as one pagination unit. The final card CSS may
 * constrain it proportionally, but the paginator never cuts its token or DOM
 * source into text fragments.
 */
export function isAtomicShareCardVisualBlock(block: string): boolean {
    const lines = block.replace(/\r\n?/gu, "\n").split("\n");
    let fence: { character: string; length: number } | null = null;
    let rawLiteralTag: "code" | "pre" | null = null;

    for (const sourceLine of lines) {
        const expanded = expandMarkdownLine(sourceLine).text;
        const container = parseFenceContainers(expanded);
        const line = expanded.slice(container.contentStart);
        if (fence) {
            const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},} *$`, "u");
            if (closing.test(line)) fence = null;
            continue;
        }

        const opening = /^ {0,3}(`{3,}|~{3,})([^`]*)$/u.exec(line);
        if (opening) {
            const info = opening[2]?.trim().split(/[ \t]+/u, 1)[0]?.toLowerCase() ?? "";
            if (info === "mermaid") return true;
            fence = { character: opening[1]!.charAt(0), length: opening[1]!.length };
            continue;
        }
        if (/^(?: {4}|\t)/u.test(line)) continue;

        let ordinary = stripInlineCode(line);
        if (rawLiteralTag) {
            const closing = new RegExp(`<\\/${rawLiteralTag}\\s*>`, "iu").exec(ordinary);
            if (!closing) continue;
            ordinary = ordinary.slice(closing.index + closing[0].length);
            rawLiteralTag = null;
        }
        ordinary = ordinary.replace(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
        const unclosedRawLiteral = /<(code|pre)\b[^>]*>/iu.exec(ordinary);
        if (unclosedRawLiteral) {
            rawLiteralTag = unclosedRawLiteral[1]!.toLowerCase() as "code" | "pre";
            ordinary = ordinary.slice(0, unclosedRawLiteral.index);
        }

        if (
            /(?:^|[^\\])!\[\[[^\]]+\]\]/u.test(ordinary)
            || /(?:^|[^\\])!\[[^\]]*\](?:\([^\n]*\)|\[[^\]]*\])/u.test(ordinary)
            || /<(?:img|picture|svg|canvas)\b/iu.test(ordinary)
        ) {
            return true;
        }
    }
    return false;
}

/** Only an isolated visual may use the proportional overflow constraint. */
export function isPureShareCardVisualBlock(block: string): boolean {
    const source = block.trim().replace(/\r\n?/gu, "\n");
    if (!isAtomicShareCardVisualBlock(source)) return false;
    if (/^!\[\[[^\]]+\]\]$/u.test(source)) return true;
    if (/^!\[[^\]]*\](?:\([^\n]*\)|\[[^\]]*\])$/u.test(source)) return true;
    if (/^<img\b[^>]*\/?>$/iu.test(source)) return true;
    const pairedVisual = /^<(picture|svg|canvas)\b[^>]*>[\s\S]*<\/\1\s*>$/iu.exec(source);
    if (pairedVisual) return true;

    const lines = source.split("\n");
    if (lines.length < 3) return false;
    const opening = /^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*$/iu.exec(lines[0] ?? "");
    if (!opening) return false;
    const marker = opening[1]!;
    return new RegExp(`^ {0,3}${marker.charAt(0)}{${marker.length},} *$`, "u")
        .test(lines[lines.length - 1] ?? "");
}


/**
 * Greedily paginate semantic Markdown blocks using the injected final-render
 * measurement. Oversize blocks make monotonic progress at line, word, then
 * Unicode code-point boundaries; no character-count height guess is used.
 */
export async function paginateShareCardMarkdown(
    blocks: readonly string[],
    fits: ShareCardFitPredicate,
    options: ShareCardPaginationOptions = {},
): Promise<CardPage[]> {
    const inputCharacters = options.originalCharacterCount ?? characterCount(blocks);
    if (inputCharacters > MAX_SHARE_CARD_CHARACTERS) {
        throw new ShareCardTooLargeError(
            "character-limit",
            MAX_SHARE_CARD_CHARACTERS,
            inputCharacters,
        );
    }

    const semanticBlocks = blocks.filter((block) => block.trim().length > 0);
    if (semanticBlocks.length === 0) {
        return [{ pageIndex: 0, totalPages: 1, content: "" }];
    }

    const pageContents: Array<{
        content: string;
        renderPlan: ShareCardRenderPlan;
    }> = [];
    let current = "";
    let currentSegments: ShareCardRenderPlanSegment[] = [];

    const assertPageAvailable = (): void => {
        if (pageContents.length >= MAX_SHARE_CARD_PAGES) {
            throw new ShareCardTooLargeError(
                "page-limit",
                MAX_SHARE_CARD_PAGES,
                pageContents.length + 1,
            );
        }
    };

    const flush = (
        content: string,
        segments: readonly ShareCardRenderPlanSegment[],
    ): void => {
        if (content.trim().length === 0) {
            throw new ShareCardPaginationError(
                "unpageable-content",
                "Pagination attempted to create an empty Share Card page.",
            );
        }
        assertPageAvailable();
        pageContents.push({
            content,
            renderPlan: createRenderPlan([...segments]),
        });
    };

    let blockIndex = 0;
    while (blockIndex < semanticBlocks.length) {
        assertPageAvailable();
        const nextBlock = semanticBlocks[blockIndex]!;
        if (current.length === 0 && isAtomicShareCardVisualBlock(nextBlock)) {
            const segment = createRenderSegment(
                blockIndex,
                0,
                nextBlock.length,
                nextBlock,
            );
            if (!await measuredFit(
                fits,
                nextBlock,
                pageContents.length,
                createRenderPlan([segment]),
            )) {
                throw new ShareCardPaginationError(
                    "unpageable-content",
                    "A visual Share Card block cannot fit on an empty page.",
                );
            }
            current = nextBlock;
            currentSegments = [segment];
            blockIndex += 1;
            continue;
        }
        const fittingPrefix = await largestFittingBlockPrefix(
            semanticBlocks,
            blockIndex,
            current,
            currentSegments,
            fits,
            pageContents.length,
        );
        if (fittingPrefix.count > 0) {
            current = fittingPrefix.content;
            currentSegments = fittingPrefix.segments;
            blockIndex += fittingPrefix.count;
            if (blockIndex < semanticBlocks.length) {
                flush(current, currentSegments);
                current = "";
                currentSegments = [];
            }
            continue;
        }
        if (current.length > 0) {
            flush(current, currentSegments);
            current = "";
            currentSegments = [];
            continue;
        }

        const block = semanticBlocks[blockIndex]!;
        const withoutDefinitions = referenceDefinitionLabels(block).size > 0
            ? withoutReferenceDefinitions(block)
            : block;
        if (withoutDefinitions !== block && withoutDefinitions.trim().length > 0) {
            const wholeSegment = createRenderSegment(
                blockIndex,
                0,
                block.length,
                block,
            );
            if (await measuredFit(
                fits,
                withoutDefinitions,
                pageContents.length,
                createRenderPlan([wholeSegment]),
            )) {
                current = block;
                currentSegments = [wholeSegment];
                blockIndex += 1;
                continue;
            }
            paginationCannotProveSafety(
                "A Share Card block with reference definitions cannot be split safely.",
            );
        }

        const fence = parseFence(block, semanticBlocks[blockIndex - 1]);
        const fenceBoundaryPlan = fence
            ? createShareCardFragmentBoundaryPlan(block, semanticBlocks[blockIndex - 1])
            : null;
        if (!fence && /(^|\n)[ \t]{0,3}(?:>[ \t]?|(?:[*+-]|\d{1,9}[.)])[ \t]+)*(?:`{3,}|~{3,})/u.test(block)) {
            paginationCannotProveSafety("A containerized code fence cannot be split safely.");
        }
        let remaining = fence?.body ?? block;
        let sourceOffset = 0;
        const fragmentPlan = fence ? null : createSafeFragmentPlan(block);
        const decorate = fence
            ? (prefix: string): string => fencedChunk(fence, prefix)
            : (prefix: string): string => prefix;

        if (remaining.length === 0) {
            throw new ShareCardPaginationError(
                "unpageable-content",
                "A Share Card block cannot fit on an empty page.",
            );
        }

        while (remaining.length > 0) {
            assertPageAvailable();
            const wholeRemainder = fragmentPlan
                ? fragmentPlan.render(sourceOffset, block.length)
                : decorate(remaining);
            const wholeSourceStart = fence
                ? fence.bodySourceStart + sourceOffset
                : sourceOffset;
            const wholeSourceEnd = fence ? fence.bodySourceEnd : block.length;
            const wholeSegment = createRenderSegment(
                blockIndex,
                wholeSourceStart,
                wholeSourceEnd,
                wholeRemainder,
            );
            if (await measuredFit(
                fits,
                wholeRemainder,
                pageContents.length,
                createRenderPlan([wholeSegment]),
            )) {
                current = wholeRemainder;
                currentSegments = [wholeSegment];
                remaining = "";
                break;
            }

            const safeEnd = fragmentPlan
                ? await fittingSafeFragmentEnd(
                    fragmentPlan,
                    sourceOffset,
                    fits,
                    pageContents.length,
                    blockIndex,
                )
                : sourceOffset + await fittingPrefixLength(
                    remaining,
                    decorate,
                    fits,
                    pageContents.length,
                    (boundary, markdown) => createRenderPlan([
                        createRenderSegment(
                            blockIndex,
                            fence!.bodySourceStart + sourceOffset,
                            fence!.bodySourceStart + sourceOffset + boundary,
                            markdown,
                        ),
                    ]),
                    fenceBoundaryPlan?.boundaries
                        .map((offset) => offset - fence!.bodySourceStart - sourceOffset)
                        .filter((offset) => offset > 0 && offset < remaining.length),
                    fence?.containerized,
                    fence
                        ? (prefix) => fencedBodyHasText(fence, prefix)
                        : undefined,
                );
            const consumed = safeEnd - sourceOffset;
            if (consumed <= 0) {
                throw new ShareCardPaginationError(
                    "unpageable-content",
                    "A Share Card block cannot make pagination progress.",
                );
            }

            const fragmentMarkdown = fragmentPlan
                ? fragmentPlan.render(sourceOffset, safeEnd)
                : decorate(remaining.slice(0, consumed));
            flush(fragmentMarkdown, [createRenderSegment(
                blockIndex,
                fence ? fence.bodySourceStart + sourceOffset : sourceOffset,
                fence ? fence.bodySourceStart + safeEnd : safeEnd,
                fragmentMarkdown,
            )]);
            remaining = remaining.slice(consumed);
            sourceOffset = safeEnd;
        }
        blockIndex += 1;
    }

    if (current.length > 0) flush(current, currentSegments);

    const visiblePages = foldInvisibleReferencePages(pageContents);
    const totalPages = visiblePages.length;
    return visiblePages.map(({ content, renderPlan }, pageIndex) => (
        attachShareCardRenderPlan({ pageIndex, totalPages, content }, renderPlan)
    ));
}

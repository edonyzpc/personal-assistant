/* Copyright 2023 edonyzpc */

import {
    type CardPage,
    MAX_SHARE_CARD_CHARACTERS,
    MAX_SHARE_CARD_PAGES,
} from "./share-card-types";

/**
 * Final-render fit check. For a fixed page index it must be prefix-monotonic:
 * once appended content does not fit, further appended blocks cannot fit.
 */
export type ShareCardFitPredicate = (
    markdown: string,
    pageIndex: number,
) => boolean | Promise<boolean>;

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
): Promise<boolean> {
    try {
        return await fits(markdown, pageIndex);
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

        if (await measuredFit(fits, decorate(prefix), pageIndex)) {
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
    lineOnly = false,
    hasText: (prefix: string) => boolean = (prefix) => prefix.trim().length > 0,
): Promise<number> {
    const boundaryGroups = lineOnly
        ? [lineBoundaries(text)]
        : [lineBoundaries(text), wordBoundaries(text), codePointBoundaries(text)];
    for (const boundaries of boundaryGroups) {
        const boundary = await largestFittingBoundary(
            text,
            boundaries,
            decorate,
            fits,
            pageIndex,
            hasText,
        );
        if (boundary > 0) return boundary;
    }
    return 0;
}

interface InlineSpan {
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
}

interface SafeFragmentPlan {
    source: string;
    lineBoundaries: number[];
    wordBoundaries: number[];
    codePointBoundaries: number[];
    render(start: number, end: number): string;
    hasText(start: number, end: number): boolean;
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

function linePrefixEnd(line: string): number {
    let cursor = 0;
    let prefixEnd = 0;
    let sawContainer = false;

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
            continue;
        }

        const listMarker = /^(?:[*+-]|\d{1,9}[.)])([ \t]+)/.exec(line.slice(markerStart));
        if (!listMarker) break;
        cursor = markerStart + listMarker[0].length;
        prefixEnd = cursor;
        sawContainer = true;

        const taskMarker = /^\[[ xX]\][ \t]+/.exec(line.slice(cursor));
        if (taskMarker) {
            cursor += taskMarker[0].length;
            prefixEnd = cursor;
        }
    }

    const heading = /^(#{1,6})[ \t]+/.exec(line.slice(prefixEnd));
    if (heading) prefixEnd += heading[0].length;
    return prefixEnd;
}

function analyzeMarkdownLines(source: string): MarkdownLine[] {
    const lines: MarkdownLine[] = [];
    let start = 0;
    while (start <= source.length) {
        const newline = source.indexOf("\n", start);
        const end = newline >= 0 ? newline : source.length;
        const line = source.slice(start, end);
        const prefixLength = linePrefixEnd(line);

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

        lines.push({ start, end, prefixEnd: start + prefixLength });
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
        if (source.charAt(cursor) !== "`" || escapedAt(source, cursor)) {
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

    for (const line of markdown.split("\n")) {
        const expanded = expandMarkdownLine(line).text;
        if (activeFence) {
            const contentStart = consumeExpandedFenceContainerPrefix(
                expanded,
                activeFence.containers,
            );
            const closingPattern = new RegExp(
                `^ {0,3}${activeFence.marker.charAt(0)}{${activeFence.marker.length},} *$`,
            );
            if (
                contentStart !== null
                && closingPattern.test(expanded.slice(contentStart))
            ) {
                activeFence = null;
            }
            continue;
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
            if (
                line.charAt(cursor) !== "["
                || (cursor > 0 && line.charAt(cursor - 1) === "!" && !escapedAt(line, cursor - 1))
            ) {
                cursor += 1;
                continue;
            }

            const labelEnd = findClosingLabelBracket(line, cursor, line.length);
            if (labelEnd < 0) break;
            const primaryLabel = line.slice(cursor + 1, labelEnd);
            if (line.charAt(labelEnd + 1) === ":") break;

            const inline = findInlineLink(line, cursor, line.length);
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

function assertReferenceLinksResolved(
    sourceBlocks: readonly string[],
    pages: readonly string[],
): void {
    const knownDefinitions = referenceDefinitionLabels(sourceBlocks.join("\n\n"));
    if (knownDefinitions.size === 0) return;

    for (const page of pages) {
        const availableDefinitions = referenceDefinitionLabels(page);
        const uses = referencedLabels(page, knownDefinitions);
        for (const label of uses) {
            if (!availableDefinitions.has(label)) {
                paginationCannotProveSafety(
                    "A reference link cannot be separated from its definition.",
                );
            }
        }
    }
}

function createSafeFragmentPlan(source: string): SafeFragmentPlan {
    const lines = analyzeMarkdownLines(source);
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
            if (
                view.startsWith("![", cursor)
                || view.startsWith("![[", cursor)
                || view.startsWith("[[", cursor)
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
    const allBoundaries = codePointBoundaries(source).filter((boundary) => (
        !protectedSet.has(boundary)
        && source.charAt(boundary) !== "\n"
        && source.charAt(boundary) !== "\r"
        && !wouldCreateStandaloneBlock(source, boundary)
        && !(source.charAt(boundary - 1) === "\r" && source.charAt(boundary) === "\n")
    ));
    const lineBoundarySet = new Set(lineBoundaries(source));
    const wordBoundarySet = new Set(wordBoundaries(source));
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
        lineBoundaries: allBoundaries.filter((boundary) => lineBoundarySet.has(boundary)),
        wordBoundaries: allBoundaries.filter((boundary) => wordBoundarySet.has(boundary)),
        codePointBoundaries: allBoundaries,
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

async function largestSafeFragmentEnd(
    plan: SafeFragmentPlan,
    start: number,
    boundaries: readonly number[],
    fits: ShareCardFitPredicate,
    pageIndex: number,
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
        } else if (await measuredFit(fits, markdown, pageIndex)) {
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
): Promise<number> {
    for (const boundaries of [
        plan.lineBoundaries,
        plan.wordBoundaries,
        plan.codePointBoundaries,
    ]) {
        const end = await largestSafeFragmentEnd(plan, start, boundaries, fits, pageIndex);
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
    fits: ShareCardFitPredicate,
    pageIndex: number,
): Promise<FittingBlockPrefix> {
    const remainingCount = blocks.length - start;
    if (remainingCount <= 0) return { content: current, count: 0 };

    const candidateForCount = (count: number): string => joinBlocks(
        current,
        joinBlockRange(blocks, start, start + count),
    );
    const allRemaining = candidateForCount(remainingCount);
    if (await measuredFit(fits, allRemaining, pageIndex)) {
        return { content: allRemaining, count: remainingCount };
    }

    let low = 1;
    let high = remainingCount - 1;
    let bestCount = 0;
    let bestContent = current;
    while (low <= high) {
        const count = Math.floor((low + high) / 2);
        const candidate = candidateForCount(count);
        if (await measuredFit(fits, candidate, pageIndex)) {
            bestCount = count;
            bestContent = candidate;
            low = count + 1;
        } else {
            high = count - 1;
        }
    }

    return { content: bestContent, count: bestCount };
}

function characterCount(blocks: readonly string[]): number {
    if (blocks.length === 0) return 0;
    return blocks.reduce((total, block) => total + block.length, 0)
        + ((blocks.length - 1) * 2);
}

/**
 * Greedily paginate semantic Markdown blocks using the injected final-render
 * measurement. Oversize blocks make monotonic progress at line, word, then
 * Unicode code-point boundaries; no character-count height guess is used.
 */
export async function paginateShareCardMarkdown(
    blocks: readonly string[],
    fits: ShareCardFitPredicate,
): Promise<CardPage[]> {
    const inputCharacters = characterCount(blocks);
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

    const pageContents: string[] = [];
    let current = "";

    const assertPageAvailable = (): void => {
        if (pageContents.length >= MAX_SHARE_CARD_PAGES) {
            throw new ShareCardTooLargeError(
                "page-limit",
                MAX_SHARE_CARD_PAGES,
                pageContents.length + 1,
            );
        }
    };

    const flush = (content: string): void => {
        if (content.trim().length === 0) {
            throw new ShareCardPaginationError(
                "unpageable-content",
                "Pagination attempted to create an empty Share Card page.",
            );
        }
        assertPageAvailable();
        pageContents.push(content);
    };

    let blockIndex = 0;
    while (blockIndex < semanticBlocks.length) {
        assertPageAvailable();
        const fittingPrefix = await largestFittingBlockPrefix(
            semanticBlocks,
            blockIndex,
            current,
            fits,
            pageContents.length,
        );
        if (fittingPrefix.count > 0) {
            current = fittingPrefix.content;
            blockIndex += fittingPrefix.count;
            if (blockIndex < semanticBlocks.length) {
                flush(current);
                current = "";
            }
            continue;
        }
        if (current.length > 0) {
            flush(current);
            current = "";
            continue;
        }

        const block = semanticBlocks[blockIndex]!;

        const fence = parseFence(block, semanticBlocks[blockIndex - 1]);
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
            if (await measuredFit(fits, wholeRemainder, pageContents.length)) {
                current = wholeRemainder;
                remaining = "";
                break;
            }

            const safeEnd = fragmentPlan
                ? await fittingSafeFragmentEnd(
                    fragmentPlan,
                    sourceOffset,
                    fits,
                    pageContents.length,
                )
                : sourceOffset + await fittingPrefixLength(
                    remaining,
                    decorate,
                    fits,
                    pageContents.length,
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

            flush(fragmentPlan
                ? fragmentPlan.render(sourceOffset, safeEnd)
                : decorate(remaining.slice(0, consumed)));
            remaining = remaining.slice(consumed);
            sourceOffset = safeEnd;
        }
        blockIndex += 1;
    }

    if (current.length > 0) flush(current);

    assertReferenceLinksResolved(semanticBlocks, pageContents);
    const totalPages = pageContents.length;
    return pageContents.map((content, pageIndex) => ({
        pageIndex,
        totalPages,
        content,
    }));
}

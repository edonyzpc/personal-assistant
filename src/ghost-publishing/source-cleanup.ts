import type { Token } from "markdown-it";
import { GhostExportError } from "./errors";
import { createGhostMarkdownIt, parseGhostMarkdown } from "./markdown-parser";
import { getTokenSourceRange, mapInlineRangeToSource } from "./source-position";
import type { GhostPublishingFields, SourceMapSpan } from "./types";

const markdownIt = createGhostMarkdownIt();
const MANAGEMENT_TITLE = /^\[!personal-assistant\][+-]?\s+(?:Featured Images?|题图)\s*$/;

export interface CleanedMarkdown {
    text: string;
    /** For every retained character, its offset in the original raw snapshot. */
    sourceOffsets: number[];
}

/** Removes actual comments while retaining each surviving character's raw origin. */
export function cleanObsidianComments(text: string, sourcePath: string): CleanedMarkdown {
    let effective = text;
    let sourceOffsets = Array.from({ length: text.length }, (_, offset) => offset);
    for (;;) {
        const protectedCharacters = protectedCodeCharacters(effective);
        const ranges: Array<{ start: number; end: number }> = [];
        let cursor = 0;
        while (cursor < effective.length) {
            if (protectedCharacters[cursor] || effective.slice(cursor, cursor + 2) !== "%%") {
                cursor += 1;
                continue;
            }
            let end = -1;
            for (let candidate = cursor + 2; candidate < effective.length; candidate += 1) {
                if (effective.slice(candidate, candidate + 2) === "%%") {
                    end = candidate + 2;
                    break;
                }
            }
            if (end < 0) {
                throw new GhostExportError(
                    "comment-unclosed",
                    "An Obsidian comment is not closed.",
                    sourcePath,
                    lineOf(text, sourceOffsets[cursor] ?? text.length) + 1,
                );
            }
            ranges.push({ start: cursor, end });
            cursor = end;
        }
        if (!ranges.length) break;

        let cleaned = "";
        const cleanedOffsets: number[] = [];
        let rangeIndex = 0;
        for (let offset = 0; offset < effective.length; offset += 1) {
            let range = ranges[rangeIndex];
            while (range && offset >= range.end) {
                rangeIndex += 1;
                range = ranges[rangeIndex];
            }
            if (range && offset >= range.start && offset < range.end) continue;
            cleaned += effective[offset];
            cleanedOffsets.push(sourceOffsets[offset]);
        }
        if (cleanedOffsets.length >= sourceOffsets.length) {
            throw new GhostExportError(
                "comment-unclosed",
                "An Obsidian comment could not be removed.",
                sourcePath,
            );
        }
        effective = cleaned;
        sourceOffsets = cleanedOffsets;
    }
    return { text: effective, sourceOffsets };
}

export interface PreparedMainBody {
    markdown: string;
    featureImageOrigin?: { path: string; line: number };
    /** Only images explicitly declared by main-source PA Featured Image blocks. */
    paFeatureImageSources: string[];
}

/** Applies Host-only cleanup to the expanded export copy; never the vault source. */
export function prepareMainBodyForExport(options: {
    markdown: string;
    sourceMap: SourceMapSpan[];
    sourcePath: string;
    fields: GhostPublishingFields;
}): PreparedMainBody {
    let markdown = options.markdown;
    let featureImageOrigin = options.fields.featureImage.mode === "manage"
        ? { path: options.sourcePath, line: 0 }
        : undefined;
    const management = findManagementBlock(options);
    if (management.length) {
        if (options.fields.featureImage.mode === "unmanaged") {
            const candidates = [...new Set(management.flatMap((block) => block.imageSources))];
            if (candidates.length > 1) {
                throw new GhostExportError(
                    "cover-ambiguous",
                    "The PA Featured Images blocks contain more than one image.",
                    options.sourcePath,
                    management[0].startLine + 1,
                );
            }
            if (candidates[0]) {
                options.fields.featureImage = { mode: "manage", value: candidates[0] };
                featureImageOrigin = management.find((block) => block.imageSources.includes(candidates[0]))!.origin;
            }
        }
        markdown = management.reduce(
            (text, block) => maskLines(text, block.startLine, block.endLine),
            markdown,
        );
    }
    markdown = removeMatchingMainHeading({ ...options, markdown });
    return { markdown, ...(featureImageOrigin ? { featureImageOrigin } : {}),
        paFeatureImageSources: [...new Set(management.flatMap(block => block.imageSources))] };
}

function protectedCodeCharacters(text: string): Uint8Array {
    const result = new Uint8Array(text.length);
    const tokens = parseGhostMarkdown(markdownIt, text);
    const lineStarts = physicalLineStarts(text);
    const protectRange = (start: number, end: number) => {
        for (let index = start; index < end; index += 1) result[index] = 1;
    };
    const visit = (token: Token, inlineParent?: Token): void => {
        if ((token.type === "fence" || token.type === "code_block") && token.map) {
            const start = lineStarts[Math.min(token.map[0], lineStarts.length - 1)] ?? 0;
            const end = token.map[1] < lineStarts.length ? lineStarts[token.map[1]] : text.length;
            protectRange(start, end);
        }
        if (token.type === "inline") {
            for (const child of token.children ?? []) visit(child, token);
            return;
        }
        if (token.type === "code_inline" && inlineParent) {
            const range = getTokenSourceRange(token);
            const sourceRange = range ? mapInlineRangeToSource(inlineParent, range) : null;
            if (sourceRange) protectRange(sourceRange.rawStart, sourceRange.rawEnd);
        }
        for (const child of token.children ?? []) visit(child, inlineParent);
    };
    for (const token of tokens) visit(token);
    return result;
}

function findManagementBlock(options: {
    markdown: string;
    sourceMap: SourceMapSpan[];
    sourcePath: string;
}): Array<{
    startLine: number;
    endLine: number;
    imageSources: string[];
    origin: { path: string; line: number };
}> {
    const tokens = parseGhostMarkdown(markdownIt, options.markdown);
    const blocks: Array<{
        startLine: number;
        endLine: number;
        imageSources: string[];
        origin: { path: string; line: number };
    }> = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type !== "blockquote_open" || token.level !== 0 || !token.map) continue;
        const end = matchingClose(tokens, index, "blockquote_open", "blockquote_close");
        const blockStart = lineStartOffset(options.markdown, token.map[0]);
        const origin = sourceOriginAt(options, blockStart);
        if (origin?.path !== options.sourcePath || !isMainSource(options, blockStart)) continue;
        if (!startsWithManagementHeader(options.markdown.slice(
            blockStart,
            lineStartOffset(options.markdown, token.map[1]),
        ))) continue;
        const inlineTokens = tokens.slice(index + 1, end).filter((candidate) => candidate.type === "inline");
        const imageSources: string[] = [];
        for (const inline of inlineTokens) {
            for (const child of inline.children ?? []) {
                if (child.type !== "image") continue;
                const range = getTokenSourceRange(child);
                if (!range) continue;
                const expandedOffset = mapInlineRangeToSource(inline, range).rawStart;
                const imageOrigin = sourceOriginAt(options, expandedOffset);
                if (imageOrigin?.path !== options.sourcePath || !isMainSource(options, expandedOffset)) continue;
                const source = child.attrGet("src");
                if (source) imageSources.push(String(source));
            }
        }
        blocks.push({ startLine: token.map[0], endLine: token.map[1], imageSources: [...new Set(imageSources)], origin });
    }
    return blocks;
}

function startsWithManagementHeader(blockText: string): boolean {
    const firstContentLine = blockText
        .split(/\r\n|\r|\n/)
        .map((line) => line.replace(/^\s*>\s?/, "").trim())
        .find((line) => line !== "");
    return !!firstContentLine && MANAGEMENT_TITLE.test(firstContentLine);
}

function sourceOriginAt(options: {
    markdown: string;
    sourceMap: SourceMapSpan[];
}, offset: number): { path: string; line: number } | undefined {
    const span = options.sourceMap.find((candidate) => offset >= candidate.start && offset < candidate.end)
        ?? [...options.sourceMap].reverse().find((candidate) => candidate.start <= offset);
    if (!span) return undefined;
    return {
        path: span.path,
        line: span.sourceLine + countRawNewlines(options.markdown.slice(span.start, offset)),
    };
}

function isRootBlockStart(token: Token): boolean {
    return token.level === 0 && ([
        "heading_open", "paragraph_open", "blockquote_open", "bullet_list_open", "ordered_list_open", "table_open",
        "fence", "code_block", "html_block", "hr",
    ] as const).includes(token.type as never);
}

function removeMatchingMainHeading(options: {
    markdown: string;
    sourceMap: SourceMapSpan[];
    sourcePath: string;
    fields: GhostPublishingFields;
}): string {
    if (options.fields.title.mode !== "manage" || typeof options.fields.title.value !== "string") return options.markdown;
    const wanted = normalizeHeadingText(options.fields.title.value);
    const tokens = parseGhostMarkdown(markdownIt, options.markdown);
    const first = tokens.find(isRootBlockStart);
    if (first?.type !== "heading_open" || first.tag !== "h1" || !first.map) return options.markdown;
    const inline = tokens[tokens.indexOf(first) + 1];
    if (normalizeHeadingText(renderedInlineText(inline?.children ?? [])) !== wanted) return options.markdown;
    if (!isMainSource(options, lineStartOffset(options.markdown, first.map[0]))) return options.markdown;
    return maskLines(options.markdown, first.map[0], first.map[1]);
}

function renderedInlineText(tokens: Token[]): string {
    return tokens.map((token) => {
        if (token.type === "text" || token.type === "code_inline") return token.content;
        if (token.children?.length) return renderedInlineText(token.children);
        return "";
    }).join("");
}

function normalizeHeadingText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function matchingClose(tokens: Token[], start: number, openType: string, closeType: string): number {
    let depth = 0;
    for (let index = start; index < tokens.length; index += 1) {
        if (tokens[index].type === openType) depth += 1;
        if (tokens[index].type === closeType && (depth -= 1) === 0) return index;
    }
    return tokens.length;
}

function maskLines(text: string, startLine: number, endLine: number): string {
    const lineStarts = physicalLineStarts(text);
    const start = lineStarts[Math.min(startLine, lineStarts.length - 1)] ?? 0;
    const end = endLine < lineStarts.length ? lineStarts[endLine] : text.length;
    return text.slice(0, start)
        + text.slice(start, end).replace(/[^\r\n]/g, " ")
        + text.slice(end);
}

function physicalLineStarts(text: string): number[] {
    const result = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (isRawNewlineStart(text, index)) result.push(index + 1);
    }
    return result;
}

function lineStartOffset(text: string, line: number): number {
    return physicalLineStarts(text)[Math.max(0, line)] ?? text.length;
}

function isMainSource(options: { sourceMap: SourceMapSpan[]; sourcePath: string }, offset: number): boolean {
    const span = options.sourceMap.find((candidate) => offset >= candidate.start && offset < candidate.end)
        ?? [...options.sourceMap].reverse().find((candidate) => candidate.start <= offset);
    return span?.dependencyIndex === 0 && span.path === options.sourcePath;
}

function lineOf(text: string, offset: number): number {
    return countRawNewlines(text.slice(0, offset));
}

function isRawNewlineStart(text: string, index: number): boolean {
    return text[index] === "\n" || (text[index] === "\r" && text[index + 1] !== "\n");
}

function countRawNewlines(value: string): number {
    let count = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (isRawNewlineStart(value, index)) count += 1;
    }
    return count;
}

import { parseYaml, stringifyYaml } from "obsidian";

import {
    MAX_LITERAL_REPLACE_MATCHES,
    MAX_OPERATION_CONTENT_CHARS,
    MAX_OPERATION_RESULT_GROWTH_CHARS,
} from "./input-validation";
import type {
    FrontmatterUpdateInput,
    JsonLikeValue,
    VaultProcessInput,
} from "./types";

export class OperationsTransformError extends Error {
    readonly code = "transform_failed";

    constructor(message: string) {
        super(message);
        this.name = "OperationsTransformError";
    }
}

export interface FrontmatterCodec {
    parse(source: string): unknown;
    stringify(value: Record<string, unknown>): string;
}

export interface LiteralReplacementPlan {
    readonly matchOffsets: readonly number[];
    readonly generatedChars: number;
    readonly finalLength: number;
}

const DEFAULT_FRONTMATTER_CODEC: FrontmatterCodec = {
    parse: (source) => parseYaml(source),
    stringify: (value) => typeof stringifyYaml === "function" ? stringifyYaml(value) : JSON.stringify(value),
};

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function appendMarkdown(current: string, content: string): string {
    if (content.length === 0) return current;
    if (current.length === 0 || current.endsWith("\n") || content.startsWith("\n")) {
        return current + content;
    }
    return `${current}${detectEol(current)}${content}`;
}

export function transformVaultProcess(current: string, input: VaultProcessInput): string {
    switch (input.operation) {
        case "replace":
            return replaceLiteral(current, input.params.search, input.params.replace, input.params.occurrence ?? "first");
        case "insert":
            return insertMarkdown(current, input.params.anchor, input.params.position, input.params.content);
        case "delete":
            if ("section" in input.params) return deleteMarkdownSection(current, input.params.section);
            return deleteMarkdownLines(current, input.params.from, input.params.to);
    }
}

export function replaceLiteral(
    current: string,
    search: string,
    replacement: string,
    occurrence: "first" | "all" = "first",
): string {
    const plan = planLiteralReplacement(current, search, replacement, occurrence);
    const first = plan.matchOffsets[0]!;
    if (occurrence === "first") {
        return current.slice(0, first) + replacement + current.slice(first + search.length);
    }
    const chunks: string[] = [];
    let cursor = 0;
    for (const offset of plan.matchOffsets) {
        chunks.push(current.slice(cursor, offset), replacement);
        cursor = offset + search.length;
    }
    chunks.push(current.slice(cursor));
    return chunks.join("");
}

/**
 * Measure a literal replacement before constructing its output. This keeps
 * provider-controlled replace-all calls from amplifying a small replacement
 * string into an unbounded allocation before the confirmation card exists.
 */
export function planLiteralReplacement(
    current: string,
    search: string,
    replacement: string,
    occurrence: "first" | "all" = "first",
): LiteralReplacementPlan {
    if (search.length === 0) throw new OperationsTransformError("Literal search must not be empty.");
    if (search.length > MAX_OPERATION_CONTENT_CHARS) {
        throw new OperationsTransformError(`Literal search exceeds ${MAX_OPERATION_CONTENT_CHARS} characters.`);
    }
    if (replacement.length > MAX_OPERATION_CONTENT_CHARS) {
        throw new OperationsTransformError(`Literal replacement exceeds ${MAX_OPERATION_CONTENT_CHARS} characters.`);
    }

    const first = current.indexOf(search);
    if (first < 0) throw new OperationsTransformError("Literal search text was not found.");
    const matchOffsets = [first];
    if (occurrence === "all") {
        let cursor = first + search.length;
        while (cursor <= current.length) {
            const next = current.indexOf(search, cursor);
            if (next < 0) break;
            matchOffsets.push(next);
            if (matchOffsets.length > MAX_LITERAL_REPLACE_MATCHES) {
                throw new OperationsTransformError(
                    `Literal replace-all exceeds ${MAX_LITERAL_REPLACE_MATCHES} matches.`,
                );
            }
            if (
                replacement.length > 0
                && matchOffsets.length > Math.floor(MAX_OPERATION_CONTENT_CHARS / replacement.length)
            ) {
                throw new OperationsTransformError(
                    `Literal replace-all generates more than ${MAX_OPERATION_CONTENT_CHARS} characters.`,
                );
            }
            cursor = next + search.length;
        }
    }

    const generatedChars = matchOffsets.length * replacement.length;
    if (generatedChars > MAX_OPERATION_CONTENT_CHARS) {
        throw new OperationsTransformError(
            `Literal replacement generates more than ${MAX_OPERATION_CONTENT_CHARS} characters.`,
        );
    }
    const finalLength = current.length - matchOffsets.length * search.length + generatedChars;
    if (!Number.isSafeInteger(finalLength) || finalLength < 0) {
        throw new OperationsTransformError("Literal replacement output length is invalid.");
    }
    if (finalLength - current.length > MAX_OPERATION_RESULT_GROWTH_CHARS) {
        throw new OperationsTransformError(
            `Literal replacement grows the note by more than ${MAX_OPERATION_RESULT_GROWTH_CHARS} characters.`,
        );
    }
    return Object.freeze({
        matchOffsets: Object.freeze(matchOffsets),
        generatedChars,
        finalLength,
    });
}

export function insertMarkdown(
    current: string,
    anchor: { heading: string } | { line: number },
    position: "before" | "after",
    content: string,
): string {
    const lines = splitLines(current);
    if ("line" in anchor) {
        if (anchor.line < 1 || anchor.line > lines.length) {
            throw new OperationsTransformError(`Line ${anchor.line} is outside the note.`);
        }
        const line = lines[anchor.line - 1]!;
        return insertAt(current, position === "before" ? line.start : line.end, content);
    }

    const heading = findUniqueHeading(current, anchor.heading);
    return insertAt(current, position === "before" ? heading.start : heading.end, content);
}

export function deleteMarkdownLines(current: string, from: number, to: number): string {
    const lines = splitLines(current);
    if (from < 1 || to < from || to > lines.length) {
        throw new OperationsTransformError(`Line range ${from}-${to} is outside the note.`);
    }
    const start = lines[from - 1]!.start;
    const end = lines[to - 1]!.end;
    return current.slice(0, start) + current.slice(end);
}

export function deleteMarkdownSection(current: string, section: string): string {
    const headings = collectHeadings(current);
    const matches = headings.filter((heading) => heading.text === section);
    if (matches.length === 0) throw new OperationsTransformError(`Heading "${section}" was not found.`);
    if (matches.length > 1) throw new OperationsTransformError(`Heading "${section}" is ambiguous.`);
    const target = matches[0]!;
    const next = headings.find((heading) => heading.start > target.start && heading.level <= target.level);
    return current.slice(0, target.start) + current.slice(next?.start ?? current.length);
}

export function transformFrontmatter(
    current: string,
    input: FrontmatterUpdateInput,
    codec: FrontmatterCodec = DEFAULT_FRONTMATTER_CODEC,
): string {
    const parsedBlock = parseFrontmatterBlock(current, codec);
    const frontmatter = cloneExistingFrontmatter(parsedBlock.value);

    for (const key of input.delete ?? []) {
        assertSafeKey(key, "frontmatter.delete");
        delete frontmatter[key];
    }
    for (const [key, value] of Object.entries(input.set ?? {})) {
        assertSafeKey(key, "frontmatter.set");
        frontmatter[key] = cloneSafeJson(value, `frontmatter.set.${key}`, 0);
    }

    let serialized: string;
    try {
        serialized = codec.stringify(frontmatter).trimEnd();
    } catch {
        throw new OperationsTransformError("Frontmatter could not be serialized.");
    }
    const eol = parsedBlock.eol;
    const yamlBody = serialized.length > 0 ? `${serialized}${eol}` : "";
    return `---${eol}${yamlBody}---${eol}${parsedBlock.body}`;
}

interface MarkdownLine {
    start: number;
    contentEnd: number;
    end: number;
    text: string;
}

interface MarkdownHeading {
    level: number;
    text: string;
    start: number;
    end: number;
}

function splitLines(markdown: string): MarkdownLine[] {
    if (markdown.length === 0) return [{ start: 0, contentEnd: 0, end: 0, text: "" }];
    const lines: MarkdownLine[] = [];
    let start = 0;
    while (start < markdown.length) {
        const newline = markdown.indexOf("\n", start);
        const end = newline < 0 ? markdown.length : newline + 1;
        const rawContentEnd = newline < 0 ? markdown.length : newline;
        const contentEnd = rawContentEnd > start && markdown[rawContentEnd - 1] === "\r"
            ? rawContentEnd - 1
            : rawContentEnd;
        lines.push({ start, contentEnd, end, text: markdown.slice(start, contentEnd) });
        start = end;
    }
    if (markdown.endsWith("\n")) {
        lines.push({ start: markdown.length, contentEnd: markdown.length, end: markdown.length, text: "" });
    }
    return lines;
}

function collectHeadings(markdown: string): MarkdownHeading[] {
    const headings: MarkdownHeading[] = [];
    const lines = splitLines(markdown);
    let fence: { marker: "`" | "~"; length: number } | null = null;
    let inFrontmatter = lines[0]?.text === "---";
    let previousTextLine: MarkdownLine | null = null;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        if (inFrontmatter) {
            if (index > 0 && (line.text === "---" || line.text === "...")) inFrontmatter = false;
            previousTextLine = null;
            continue;
        }
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
        if (fenceMatch) {
            const run = fenceMatch[1]!;
            const marker = run[0] as "`" | "~";
            if (fence === null) {
                fence = { marker, length: run.length };
            } else if (
                marker === fence.marker
                && run.length >= fence.length
                && /^ {0,3}(?:`{3,}|~{3,})[\t ]*$/.test(line.text)
            ) {
                fence = null;
            }
            previousTextLine = null;
            continue;
        }
        if (fence !== null) {
            previousTextLine = null;
            continue;
        }
        const match = /^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/.exec(line.text);
        if (match) {
            const text = match[2]!.replace(/[\t ]+#+[\t ]*$/, "").trim();
            if (text.length > 0) {
                headings.push({
                    level: match[1]!.length,
                    text,
                    start: line.start,
                    end: line.end,
                });
            }
            previousTextLine = null;
            continue;
        }
        const setext = /^ {0,3}(=+|-+)\s*$/.exec(line.text);
        if (setext && previousTextLine) {
            const text = previousTextLine.text.trim();
            if (text.length > 0) {
                headings.push({
                    level: setext[1]![0] === "=" ? 1 : 2,
                    text,
                    start: previousTextLine.start,
                    end: line.end,
                });
            }
            previousTextLine = null;
            continue;
        }
        previousTextLine = line.text.trim().length > 0 ? line : null;
    }
    return headings;
}

function findUniqueHeading(markdown: string, text: string): MarkdownHeading {
    const matches = collectHeadings(markdown).filter((heading) => heading.text === text);
    if (matches.length === 0) throw new OperationsTransformError(`Heading "${text}" was not found.`);
    if (matches.length > 1) throw new OperationsTransformError(`Heading "${text}" is ambiguous.`);
    return matches[0]!;
}

function insertAt(markdown: string, offset: number, content: string): string {
    if (content.length === 0) return markdown;
    const eol = detectEol(markdown);
    let block = content;
    if (offset > 0 && markdown[offset - 1] !== "\n" && !block.startsWith("\n")) block = eol + block;
    if (offset < markdown.length && !block.endsWith("\n")) block += eol;
    return markdown.slice(0, offset) + block + markdown.slice(offset);
}

function detectEol(markdown: string): "\n" | "\r\n" {
    return markdown.includes("\r\n") ? "\r\n" : "\n";
}

interface ParsedFrontmatterBlock {
    value: Record<string, unknown>;
    body: string;
    eol: "\n" | "\r\n";
}

function parseFrontmatterBlock(current: string, codec: FrontmatterCodec): ParsedFrontmatterBlock {
    const eol = current.startsWith("---\r\n") ? "\r\n" : current.startsWith("---\n") ? "\n" : detectEol(current);
    if (!current.startsWith(`---${eol}`)) return { value: {}, body: current, eol };

    const firstLineEnd = eol.length + 3;
    let cursor = firstLineEnd;
    let closingStart = -1;
    let closingEnd = -1;
    while (cursor <= current.length) {
        const nextNewline = current.indexOf("\n", cursor);
        const rawEnd = nextNewline < 0 ? current.length : nextNewline;
        const lineEnd = rawEnd > cursor && current[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
        const line = current.slice(cursor, lineEnd);
        if (line === "---" || line === "...") {
            closingStart = cursor;
            closingEnd = nextNewline < 0 ? current.length : nextNewline + 1;
            break;
        }
        if (nextNewline < 0) break;
        cursor = nextNewline + 1;
    }
    if (closingStart < 0) throw new OperationsTransformError("Existing frontmatter is not closed.");

    const yaml = current.slice(firstLineEnd, closingStart).replace(/\r?\n$/, "");
    let parsed: unknown;
    try {
        parsed = yaml.trim().length === 0 ? {} : codec.parse(yaml);
    } catch {
        throw new OperationsTransformError("Existing frontmatter is invalid YAML.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new OperationsTransformError("Existing frontmatter must be a YAML mapping.");
    }
    return { value: parsed as Record<string, unknown>, body: current.slice(closingEnd), eol };
}

function cloneExistingFrontmatter(value: Record<string, unknown>): Record<string, unknown> {
    assertSafeExistingYaml(value, "frontmatter", 0, new Set());
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
        result[key] = value[key];
    }
    return result;
}

function assertSafeExistingYaml(
    value: unknown,
    path: string,
    depth: number,
    seen: Set<object>,
): void {
    if (typeof value !== "object" || value === null) return;
    if (depth > 50) throw new OperationsTransformError(`${path} is nested too deeply.`);
    if (seen.has(value)) throw new OperationsTransformError(`${path} contains a cyclic value.`);
    if (value instanceof Date) return;
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertSafeExistingYaml(item, `${path}[${index}]`, depth + 1, seen));
    } else {
        for (const key of Object.keys(value)) {
            assertSafeKey(key, path);
            assertSafeExistingYaml((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1, seen);
        }
    }
    seen.delete(value);
}

function cloneSafeJson(value: unknown, path: string, depth: number): JsonLikeValue {
    if (depth > 20) throw new OperationsTransformError(`${path} is nested too deeply.`);
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map((item, index) => cloneSafeJson(item, `${path}[${index}]`, depth + 1));
    if (typeof value !== "object" || value === null) {
        throw new OperationsTransformError(`${path} is not JSON-compatible.`);
    }
    const result = Object.create(null) as Record<string, JsonLikeValue>;
    for (const key of Object.keys(value)) {
        assertSafeKey(key, path);
        result[key] = cloneSafeJson((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
    }
    return result;
}

function assertSafeKey(key: string, path: string): void {
    if (DANGEROUS_KEYS.has(key)) throw new OperationsTransformError(`${path} contains forbidden key ${key}.`);
}

import type { VSSChunk } from "./types";

export interface HeadingAwareChunkOptions {
    path: string;
    markdown: string;
    contentHash: string;
    created: number;
    lastModified: number;
    chunkSize?: number;
    chunkOverlap?: number;
}

interface FrontmatterBlock {
    text: string;
    contentStartOffset: number;
    contentStartLine: number;
}

interface SourceLine {
    text: string;
    lineNumber: number;
}

interface SectionBlock {
    headingPath: string[];
    lines: SourceLine[];
}

const DEFAULT_CHUNK_SIZE = 4000;
const DEFAULT_CHUNK_OVERLAP = 80;
const FRONTMATTER_MAX_CHARS = 1200;

export function createHeadingAwareMarkdownChunks(options: HeadingAwareChunkOptions): VSSChunk[] {
    const chunkSize = Math.max(256, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
    const chunkOverlap = Math.max(0, Math.min(options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP, Math.floor(chunkSize / 4)));
    const frontmatter = extractFrontmatter(options.markdown);
    const frontmatterText = formatFrontmatterForChunk(frontmatter.text);
    const content = options.markdown.slice(frontmatter.contentStartOffset);
    const sections = splitMarkdownIntoHeadingSections(content, frontmatter.contentStartLine);
    const chunks: VSSChunk[] = [];

    for (const section of sections) {
        const sectionText = section.lines.map((line) => line.text).join("\n").trim();
        if (!sectionText) continue;
        for (const piece of splitSectionText(section, chunkSize, chunkOverlap, frontmatterText)) {
            const contentWithMetadata = [frontmatterText, piece.text].filter(Boolean).join("\n\n");
            const chunkIndex = chunks.length;
            chunks.push({
                path: options.path,
                chunkIndex,
                content: contentWithMetadata,
                contentHash: options.contentHash,
                created: options.created,
                lastModified: options.lastModified,
                metadata: {
                    path: options.path,
                    created: options.created,
                    lastModified: options.lastModified,
                    contentHash: options.contentHash,
                    chunkIndex,
                    startLine: piece.startLine,
                    endLine: piece.endLine,
                    headingPath: section.headingPath,
                    frontmatterIncluded: Boolean(frontmatterText),
                    chunkStrategy: "heading-aware-v2",
                },
            });
        }
    }

    return chunks;
}

function extractFrontmatter(markdown: string): FrontmatterBlock {
    if (!markdown.startsWith("---")) {
        return { text: "", contentStartOffset: 0, contentStartLine: 1 };
    }
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) {
        return { text: "", contentStartOffset: 0, contentStartLine: 1 };
    }
    return {
        text: match[1] ?? "",
        contentStartOffset: match[0].length,
        contentStartLine: countNewlines(match[0]) + 1,
    };
}

function formatFrontmatterForChunk(frontmatter: string): string {
    const lines = frontmatter
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^[#]/.test(line));
    if (lines.length === 0) return "";
    const body = lines.join("\n").slice(0, FRONTMATTER_MAX_CHARS);
    return `Frontmatter:\n${body}`;
}

function splitMarkdownIntoHeadingSections(content: string, contentStartLine: number): SectionBlock[] {
    const rawLines = content.split(/\r?\n/);
    const sections: SectionBlock[] = [];
    const headingStack: Array<{ level: number; text: string }> = [];
    let current: SectionBlock = { headingPath: [], lines: [] };

    for (let index = 0; index < rawLines.length; index++) {
        const text = rawLines[index];
        const heading = parseMarkdownHeading(text);
        if (heading) {
            if (current.lines.some((line) => line.text.trim().length > 0)) {
                sections.push(current);
            }
            while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= heading.level) {
                headingStack.pop();
            }
            headingStack.push(heading);
            current = {
                headingPath: headingStack.map((entry) => entry.text),
                lines: [],
            };
        }
        current.lines.push({
            text,
            lineNumber: contentStartLine + index,
        });
    }

    if (current.lines.some((line) => line.text.trim().length > 0)) {
        sections.push(current);
    }
    return sections.length > 0 ? sections : [{ headingPath: [], lines: [] }];
}

function parseMarkdownHeading(line: string): { level: number; text: string } | null {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return null;
    return {
        level: match[1].length,
        text: match[2].trim(),
    };
}

function splitSectionText(
    section: SectionBlock,
    chunkSize: number,
    chunkOverlap: number,
    frontmatterText: string,
): Array<{ text: string; startLine: number; endLine: number }> {
    const reserve = frontmatterText ? frontmatterText.length + 2 : 0;
    const targetSize = Math.max(256, chunkSize - reserve);
    const output: Array<{ text: string; startLine: number; endLine: number }> = [];
    let buffer: SourceLine[] = [];
    let bufferChars = 0;

    const flush = () => {
        const trimmed = buffer.map((line) => line.text).join("\n").trim();
        if (trimmed) {
            output.push({
                text: trimmed,
                startLine: buffer[0]?.lineNumber ?? 1,
                endLine: buffer[buffer.length - 1]?.lineNumber ?? buffer[0]?.lineNumber ?? 1,
            });
        }
        if (chunkOverlap <= 0) {
            buffer = [];
            bufferChars = 0;
            return;
        }
        const overlap: SourceLine[] = [];
        let overlapChars = 0;
        for (let index = buffer.length - 1; index >= 0; index--) {
            const line = buffer[index];
            overlap.unshift(line);
            overlapChars += line.text.length + 1;
            if (overlapChars >= chunkOverlap) break;
        }
        buffer = overlap;
        bufferChars = overlapChars;
    };

    for (const line of section.lines) {
        const lineLength = line.text.length + 1;
        if (buffer.length > 0 && bufferChars + lineLength > targetSize) {
            flush();
        }
        if (lineLength > targetSize) {
            for (const piece of splitLongLine(line, targetSize)) {
                if (buffer.length > 0 && bufferChars + piece.text.length > targetSize) {
                    flush();
                }
                buffer.push(piece);
                bufferChars += piece.text.length + 1;
            }
            continue;
        }
        buffer.push(line);
        bufferChars += lineLength;
    }
    if (buffer.length > 0) flush();
    return output;
}

function splitLongLine(line: SourceLine, targetSize: number): SourceLine[] {
    const pieces: SourceLine[] = [];
    for (let start = 0; start < line.text.length; start += targetSize) {
        pieces.push({
            text: line.text.slice(start, start + targetSize),
            lineNumber: line.lineNumber,
        });
    }
    return pieces;
}

function countNewlines(value: string): number {
    let count = 0;
    for (let index = 0; index < value.length; index++) {
        if (value[index] === "\n") count++;
    }
    return count;
}

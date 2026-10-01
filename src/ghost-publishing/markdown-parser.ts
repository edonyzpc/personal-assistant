import MarkdownIt, { type StateBlock, type StateInline, type Token } from "markdown-it";

export const GHOST_EMBED_TOKEN = "pa_ghost_embed";

interface EmbedMeta {
    target: string;
    rawStart: number;
    rawEnd: number;
}

interface ImageSourceMeta {
    rawStart: number;
    rawEnd: number;
}

interface CapturedLines {
    text: string;
    offsets: number[];
}

interface NormalizedSource {
    text: string;
    rawOffsets: number[];
}

type InlineRule = (state: StateInline, silent: boolean) => boolean;
type BlockRule = (state: StateBlock, startLine: number, endLine: number, silent?: boolean) => boolean;
type InternalRule = { name: string; fn: InlineRule | BlockRule; alt: string[]; enabled?: boolean };
type InternalRuler = { __rules__: InternalRule[] };

function getNamedRule(markdownIt: ReturnType<typeof MarkdownIt>, name: string): InternalRule {
    const rulers = [
        markdownIt.inline.ruler as unknown as InternalRuler,
        markdownIt.block.ruler as unknown as InternalRuler,
    ];
    const rule = rulers
        .flatMap((ruler) => ruler.__rules__)
        .find((candidate) => candidate.name === name && candidate.enabled !== false);
    if (!rule || typeof rule.fn !== "function") {
        throw new Error(`markdown-it@15.0.2 ${name} rule is unavailable.`);
    }
    return rule;
}

function consumeEmbed(state: StateInline, silent: boolean): boolean {
    const match = /^!\[\[([^\]\n]+)\]\]/.exec(state.src.slice(state.pos));
    if (!match) return false;
    const rawEnd = state.pos + match[0].length;
    if (!silent) {
        const [target, alias] = (match[1] ?? "").split("|");
        const source = target.trim();
        const isImage = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(source);
        const token = state.push(isImage ? "image" : GHOST_EMBED_TOKEN, isImage ? "img" : "", 0);
        if (isImage) {
            token.content = alias?.trim() || source.split("/").pop() || source;
            token.attrs = [["src", source], ["alt", token.content]];
        } else token.content = match[0];
        token.meta = {
            target: match[1] ?? "",
            rawStart: state.pos,
            rawEnd,
        } satisfies EmbedMeta;
    }
    state.pos = rawEnd;
    return true;
}

function wrapNativeImageRule(original: { fn: InlineRule }): InlineRule {
    return (state, silent) => {
        const rawStart = state.pos;
        const tokenCountBefore = state.tokens.length;
        const consumed = original.fn(state, silent);
        if (consumed && !silent && state.pos > rawStart) {
            for (let index = state.tokens.length - 1; index >= tokenCountBefore; index -= 1) {
                const token = state.tokens[index];
                if (token?.type === "image") {
                    token.meta = {
                        ...((token.meta as object | null | undefined) ?? {}),
                        rawStart,
                        rawEnd: state.pos,
                    } satisfies ImageSourceMeta;
                    break;
                }
            }
        }
        return consumed;
    };
}

function wrapNativeCodeInlineRule(original: { fn: InlineRule }): InlineRule {
    return (state, silent) => {
        const rawStart = state.pos;
        const tokenCountBefore = state.tokens.length;
        const consumed = original.fn(state, silent);
        if (consumed && !silent && state.pos > rawStart) {
            for (let index = state.tokens.length - 1; index >= tokenCountBefore; index -= 1) {
                const token = state.tokens[index];
                if (token?.type !== "code_inline") continue;
                token.meta = {
                    ...((token.meta as object | null | undefined) ?? {}),
                    rawStart,
                    rawEnd: state.pos,
                };
                break;
            }
        }
        return consumed;
    };
}

function isSpaceCode(code: number): boolean {
    return code === 0x20 || code === 0x09;
}

function getLinesWithOffsets(
    state: StateBlock,
    begin: number,
    end: number,
    indent: number,
    keepLastLF: boolean,
): CapturedLines {
    let text = "";
    const offsets: number[] = [];
    for (let line = begin; line < end; line += 1) {
        const lineStart = state.bMarks[line] ?? 0;
        let first = lineStart;
        const last = (line + 1 < end || keepLastLF)
            ? (state.eMarks[line] ?? 0) + 1
            : state.eMarks[line] ?? 0;
        let lineIndent = 0;
        while (first < last && lineIndent < indent) {
            const code = state.src.charCodeAt(first);
            if (isSpaceCode(code)) {
                lineIndent += code === 0x09
                    ? 4 - (lineIndent + (state.bsCount[line] ?? 0)) % 4
                    : 1;
            } else if (first - lineStart < (state.tShift[line] ?? 0)) {
                lineIndent += 1;
            } else break;
            first += 1;
        }
        if (lineIndent > indent) {
            const syntheticSpaces = lineIndent - indent;
            text += " ".repeat(syntheticSpaces);
            for (let index = 0; index < syntheticSpaces; index += 1) offsets.push(first);
        }
        const segment = state.src.slice(first, last);
        text += segment;
        for (let index = 0; index < segment.length; index += 1) offsets.push(first + index);
    }
    if (text.length !== offsets.length) {
        throw new Error("Unable to map markdown-it block content to source offsets.");
    }
    return { text, offsets };
}

function asciiTrimRange(value: string): { start: number; end: number } {
    let start = 0;
    let end = value.length;
    while (start < end && /[\t\r\n ]/.test(value[start] ?? "")) start += 1;
    while (end > start && /[\t\r\n ]/.test(value[end - 1] ?? "")) end -= 1;
    return { start, end };
}

function captureGetLines<State extends StateBlock, Result>(
    state: State,
    task: () => Result,
): { result: Result; captured: CapturedLines | null } {
    const capturedLines: CapturedLines[] = [];
    const originalGetLines = state.getLines;
    state.getLines = ((begin: number, end: number, indent: number, keepLastLF: boolean) => {
        const text = originalGetLines.call(state, begin, end, indent, keepLastLF);
        const captured = getLinesWithOffsets(state, begin, end, indent, keepLastLF);
        if (captured.text !== text) throw new Error("markdown-it block source mapping differs from native content.");
        capturedLines.push(captured);
        return text;
    }) as StateBlock["getLines"];
    try {
        const result = task();
        return { result, captured: capturedLines.at(-1) ?? null };
    } finally {
        state.getLines = originalGetLines;
    }
}

function attachCapturedSourceOffsets(tokens: Token[], captured: CapturedLines | null): void {
    if (!captured) return;
    const trim = asciiTrimRange(captured.text);
    const text = captured.text.slice(trim.start, trim.end);
    const offsets = captured.offsets.slice(trim.start, trim.end);
    for (const token of tokens) {
        if (token.type !== "inline" || token.content !== text) continue;
        token.meta = {
            ...((token.meta as object | null | undefined) ?? {}),
            sourceOffsets: offsets,
        };
    }
}

function contentCandidates(state: StateBlock, line: number, content: string): number[] {
    const lineStart = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
    const lineEnd = state.eMarks[line] ?? lineStart;
    const lineText = state.src.slice(lineStart, lineEnd);
    if (!content) return [];
    const candidates: number[] = [];
    let cursor = 0;
    while (cursor <= lineText.length) {
        const index = lineText.indexOf(content, cursor);
        if (index < 0) break;
        candidates.push(lineStart + index);
        cursor = index + 1;
    }
    return candidates;
}

function wrapHeadingRule(original: { fn: BlockRule }): BlockRule {
    return (state, startLine, endLine, silent) => {
        const tokenCountBefore = state.tokens.length;
        const consumed = original.fn(state, startLine, endLine, silent);
        if (!consumed) return false;
        for (let index = tokenCountBefore; index < state.tokens.length; index += 1) {
            const token = state.tokens[index];
            if (token?.type !== "inline") continue;
            token.meta = {
                ...((token.meta as object | null | undefined) ?? {}),
                sourceCandidates: contentCandidates(state, startLine, token.content),
            };
        }
        return true;
    };
}

function wrapTableRule(original: { fn: BlockRule }): BlockRule {
    return (state, startLine, endLine, silent) => {
        const tokenCountBefore = state.tokens.length;
        const consumed = original.fn(state, startLine, endLine, silent);
        if (!consumed) return false;
        let cells: CapturedLines[] = [];
        let cellIndex = 0;
        for (let index = tokenCountBefore; index < state.tokens.length; index += 1) {
            const token = state.tokens[index];
            if (token?.type === "tr_open" && token.map) {
                cells = tableCellSources(state, token.map[0]);
                cellIndex = 0;
            } else if (token?.type === "inline") {
                const cell = cells[cellIndex++] ?? { text: "", offsets: [] };
                if (cell.text !== token.content) throw new Error("markdown-it table cell source mapping differs from native content.");
                token.meta = {
                    ...((token.meta as object | null | undefined) ?? {}),
                    sourceOffsets: cell.offsets,
                };
            }
        }
        return true;
    };
}

function tableCellSources(state: StateBlock, line: number): CapturedLines[] {
    const start = state.bMarks[line] + state.tShift[line];
    const raw = state.src.slice(start, state.eMarks[line]);
    const trimmed = raw.trim();
    const sourceStart = start + raw.length - raw.trimStart().length;
    const cells: CapturedLines[] = [{ text: "", offsets: [] }];
    // markdown-it 15 removes the backslash immediately before a table pipe.
    // Preserve those raw offsets and use the emitted cell order, not text lookup.
    for (let index = 0; index < trimmed.length; index += 1) {
        const character = trimmed[index];
        if (character === "|" && trimmed[index - 1] !== "\\") {
            cells.push({ text: "", offsets: [] });
        } else if (!(character === "\\" && trimmed[index + 1] === "|")) {
            const cell = cells[cells.length - 1];
            cell.text += character;
            cell.offsets.push(sourceStart + index);
        }
    }
    if (cells[0]?.text === "") cells.shift();
    if (cells[cells.length - 1]?.text === "") cells.pop();
    return cells.map((cell) => {
        const left = cell.text.length - cell.text.trimStart().length;
        const text = cell.text.trim();
        return { text, offsets: cell.offsets.slice(left, left + text.length) };
    });
}

function wrapCapturedBlockRule(original: { fn: BlockRule }): BlockRule {
    return (state, startLine, endLine, silent) => {
        const tokenCountBefore = state.tokens.length;
        const { result, captured } = captureGetLines(
            state,
            () => original.fn(state, startLine, endLine, silent),
        );
        attachCapturedSourceOffsets(state.tokens.slice(tokenCountBefore), captured);
        return result;
    };
}

type MarkdownItInstance = ReturnType<typeof MarkdownIt>;

function normalizeSourceOffsets(text: string): NormalizedSource {
    let normalized = "";
    const rawOffsets: number[] = [];
    let raw = 0;
    while (raw < text.length) {
        rawOffsets.push(raw);
        if (text[raw] === "\r") {
            normalized += "\n";
            raw += text[raw + 1] === "\n" ? 2 : 1;
        } else {
            normalized += text[raw];
            raw += 1;
        }
    }
    rawOffsets.push(text.length);
    return { text: normalized, rawOffsets };
}

function translateOffset(normalized: number, rawOffsets: number[]): number {
    if (!Number.isInteger(normalized) || normalized < 0 || normalized >= rawOffsets.length) {
        throw new Error("Unable to map normalized Markdown offset to its source snapshot.");
    }
    return rawOffsets[normalized];
}

function translateTokenSourcePositions(tokens: Token[], rawOffsets: number[]): void {
    for (const token of tokens) {
        const meta = token.meta as {
            rawStart?: unknown;
            rawEnd?: unknown;
            sourceOffsets?: unknown;
            sourceCandidates?: unknown;
        } | null | undefined;
        if (token.type === "inline") {
            if (meta && Array.isArray(meta.sourceOffsets)) {
                meta.sourceOffsets = meta.sourceOffsets.map(offset => translateOffset(Number(offset), rawOffsets));
            }
            if (meta && Array.isArray(meta.sourceCandidates)) {
                meta.sourceCandidates = meta.sourceCandidates.map(offset => translateOffset(Number(offset), rawOffsets));
            }
            // Child ranges remain relative to inline.content; mapInlineRangeToSource
            // combines them with the inline token's absolute source offsets.
            continue;
        }
        if (meta && typeof meta === "object") {
            if (typeof meta.rawStart === "number" && typeof meta.rawEnd === "number") {
                meta.rawStart = translateOffset(meta.rawStart, rawOffsets);
                meta.rawEnd = translateOffset(meta.rawEnd, rawOffsets);
            }
            if (Array.isArray(meta.sourceOffsets)) {
                meta.sourceOffsets = meta.sourceOffsets.map(offset => translateOffset(Number(offset), rawOffsets));
            }
            if (Array.isArray(meta.sourceCandidates)) {
                meta.sourceCandidates = meta.sourceCandidates.map(offset => translateOffset(Number(offset), rawOffsets));
            }
        }
    }
}

export function parseGhostMarkdown(markdownIt: MarkdownItInstance, text: string): Token[] {
    const normalized = normalizeSourceOffsets(text);
    const tokens = markdownIt.parse(normalized.text, {});
    translateTokenSourcePositions(tokens, normalized.rawOffsets);
    return tokens;
}

export function parseGhostInlineMarkdown(markdownIt: MarkdownItInstance, text: string): Token[] {
    const normalized = normalizeSourceOffsets(text);
    const tokens = markdownIt.parseInline(normalized.text, {});
    translateTokenSourcePositions(tokens, normalized.rawOffsets);
    return tokens;
}

export function installGhostSourceRanges(markdownIt: MarkdownItInstance): void {
    installGhostInlineRules(markdownIt);

    const paragraphRule = getNamedRule(markdownIt, "paragraph");
    markdownIt.block.ruler.at(
        "paragraph",
        wrapCapturedBlockRule({ fn: paragraphRule.fn as BlockRule }),
        { alt: paragraphRule.alt },
    );
    const lheadingRule = getNamedRule(markdownIt, "lheading");
    markdownIt.block.ruler.at(
        "lheading",
        wrapCapturedBlockRule({ fn: lheadingRule.fn as BlockRule }),
        { alt: lheadingRule.alt },
    );
    const headingRule = getNamedRule(markdownIt, "heading");
    markdownIt.block.ruler.at(
        "heading",
        wrapHeadingRule({ fn: headingRule.fn as BlockRule }),
        { alt: headingRule.alt },
    );
    const tableRule = getNamedRule(markdownIt, "table");
    markdownIt.block.ruler.at(
        "table",
        wrapTableRule({ fn: tableRule.fn as BlockRule }),
        { alt: tableRule.alt },
    );
}

export function installGhostInlineRules(markdownIt: MarkdownItInstance): void {
    markdownIt.inline.ruler.before("text", "pa_ghost_embed", consumeEmbed);

    const nativeImageRule = getNamedRule(markdownIt, "image");
    markdownIt.inline.ruler.at(
        "image",
        wrapNativeImageRule({ fn: nativeImageRule.fn as InlineRule }),
        { alt: nativeImageRule.alt },
    );
    const nativeCodeInlineRule = getNamedRule(markdownIt, "backticks");
    markdownIt.inline.ruler.at(
        "backticks",
        wrapNativeCodeInlineRule({ fn: nativeCodeInlineRule.fn as InlineRule }),
        { alt: nativeCodeInlineRule.alt },
    );
}

export function createGhostMarkdownIt(): MarkdownItInstance {
    const markdownIt = new MarkdownIt("commonmark", {
        html: false,
        linkify: false,
        typographer: false,
    }).enable(["table", "strikethrough"]);
    installGhostSourceRanges(markdownIt);
    return markdownIt;
}

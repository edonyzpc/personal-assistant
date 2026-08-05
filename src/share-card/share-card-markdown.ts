/* Copyright 2023 edonyzpc */

/** Markdown payload consumed by measured, visual-aware pagination. */
export interface PreparedShareCardMarkdown {
    markdown: string;
    blocks: string[];
}

/** Only Pagelet fields explicitly approved for Share Card projection. */
export interface ShareablePageletFinding {
    title?: string;
    description?: string;
    insightText?: string;
}

interface BlockquoteFenceContainer {
    type: "blockquote";
}

interface ListFenceContainer {
    type: "list";
    continuationIndent: number;
    markerKind: "bullet" | "ordered";
    delimiter?: "." | ")";
    start?: number;
    hasContent: boolean;
}

type FenceContainer = BlockquoteFenceContainer | ListFenceContainer;

interface FenceMatch {
    marker: string;
    markerEnd: number;
    info: string;
    containers: FenceContainer[];
}

interface ExpandedMarkdownLine {
    source: string;
    text: string;
    sourceOffsets: number[];
}

interface FenceContainerCandidate {
    containers: FenceContainer[];
    contentStart: number;
    inheritedCount: number;
}

interface FenceLineAnalysis {
    fence: FenceMatch | null;
    listContainers: FenceContainer[];
    paragraphOpen: boolean;
}

type HtmlBlockEnd =
    | { type: "blank" }
    | { type: "closing-tag"; tagName: string }
    | { type: "sequence"; value: string };

interface HtmlBlockState {
    containers: FenceContainer[];
    end: HtmlBlockEnd;
}

interface HtmlBlockStartMatch {
    containers: FenceContainer[];
    state: HtmlBlockState | null;
}

interface IndentedCodeState {
    containers: FenceContainer[];
}

function expandMarkdownLine(source: string): ExpandedMarkdownLine {
    let text = "";
    const sourceOffsets = [0];

    for (let index = 0; index < source.length; index += 1) {
        const character = source.charAt(index);
        const width = character === "\t" ? 4 - (text.length % 4) : 1;
        text += character === "\t" ? " ".repeat(width) : character;
        for (let column = 0; column < width; column += 1) {
            sourceOffsets.push(index + 1);
        }
    }

    return { source, text, sourceOffsets };
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
            containers.push({ type: "blockquote" });
            continue;
        }

        const listMarker = /^(?:[*+-]|(\d{1,9})([.)]))/.exec(line.slice(markerStart));
        if (!listMarker) break;

        const listMarkerEnd = markerStart + listMarker[0].length;
        let whitespaceEnd = listMarkerEnd;
        while (line.charAt(whitespaceEnd) === " ") whitespaceEnd += 1;
        if (whitespaceEnd === listMarkerEnd && listMarkerEnd < line.length) break;

        const paddingLength = whitespaceEnd - listMarkerEnd;
        const consumedPadding = paddingLength === 0
            ? 1
            : paddingLength > 4
            ? 1
            : paddingLength;
        cursor = Math.min(listMarkerEnd + consumedPadding, line.length);
        containers.push({
            type: "list",
            continuationIndent: markerStart - containerStart
                + listMarker[0].length
                + consumedPadding,
            markerKind: listMarker[1] ? "ordered" : "bullet",
            delimiter: listMarker[2] as "." | ")" | undefined,
            start: listMarker[1] ? Number.parseInt(listMarker[1], 10) : undefined,
            hasContent: line.slice(cursor).trim().length > 0,
        });
    }

    return { containers, contentStart: cursor, inheritedCount: 0 };
}

function consumeExpandedFenceContainerPrefix(
    line: string,
    containers: readonly FenceContainer[],
): number | null {
    let cursor = 0;

    for (let index = 0; index < containers.length; index += 1) {
        const container = containers[index];
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

            const remainingContainers = containers.slice(index);
            const isListBlankLine = remainingContainers.every((value) => value.type === "list")
                && line.slice(cursor).trim().length === 0;
            return isListBlankLine ? line.length : null;
        }

        let markerStart = cursor;
        while (markerStart - cursor < 3 && line.charAt(markerStart) === " ") {
            markerStart += 1;
        }
        if (line.charAt(markerStart) !== ">") return null;

        cursor = markerStart + 1;
        if (line.charAt(cursor) === " ") cursor += 1;
    }

    return cursor;
}

function fenceContainerCandidates(
    line: string,
    previousContainers: readonly FenceContainer[],
): FenceContainerCandidate[] {
    const candidates: FenceContainerCandidate[] = [];

    for (let length = previousContainers.length; length > 0; length -= 1) {
        const inheritedContainers = previousContainers.slice(0, length);
        const inheritedEnd = consumeExpandedFenceContainerPrefix(line, inheritedContainers);
        if (inheritedEnd === null) continue;

        const nested = parseFenceContainers(line, inheritedEnd);
        candidates.push({
            containers: [...inheritedContainers, ...nested.containers],
            contentStart: nested.contentStart,
            inheritedCount: inheritedContainers.length,
        });
    }

    candidates.push(parseFenceContainers(line));
    return candidates;
}

function matchFenceCandidate(
    line: ExpandedMarkdownLine,
    candidate: FenceContainerCandidate,
): FenceMatch | null {
    const fenceMatch = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/.exec(
        line.text.slice(candidate.contentStart),
    );
    if (!fenceMatch) return null;

    const marker = fenceMatch[2];
    if (marker.charAt(0) === "`" && fenceMatch[3].includes("`")) return null;

    const markerEnd = candidate.contentStart + fenceMatch[1].length + marker.length;

    return {
        marker,
        markerEnd: line.sourceOffsets[markerEnd] ?? line.source.length,
        info: fenceMatch[3].trim(),
        containers: candidate.containers,
    };
}

function consumeFenceContainerPrefix(
    line: string,
    containers: readonly FenceContainer[],
): number | null {
    return consumeExpandedFenceContainerPrefix(expandMarkdownLine(line).text, containers);
}

function retainedListContainers(containers: readonly FenceContainer[]): FenceContainer[] {
    return containers.some((container) => container.type === "list") ? [...containers] : [];
}

function candidateCanInterruptParagraph(
    candidate: FenceContainerCandidate,
    previousContainers: readonly FenceContainer[],
    paragraphOpen: boolean,
): boolean {
    if (!paragraphOpen) return true;

    const firstNewContainer = candidate.containers[candidate.inheritedCount];
    if (!firstNewContainer || firstNewContainer.type === "blockquote") return true;

    const previousSibling = previousContainers[candidate.inheritedCount];
    const continuesExistingList = previousSibling?.type === "list"
        && previousSibling.markerKind === firstNewContainer.markerKind
        && (
            previousSibling.markerKind === "bullet"
            || previousSibling.delimiter === firstNewContainer.delimiter
        );
    if (!firstNewContainer.hasContent) return continuesExistingList;
    if (firstNewContainer.markerKind === "bullet" || firstNewContainer.start === 1) return true;
    return continuesExistingList;
}

const HTML_BLOCK_TAGS = [
    "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption",
    "center", "col", "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt",
    "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset", "h1", "h2",
    "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "iframe", "legend", "li",
    "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option",
    "p", "param", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th",
    "thead", "title", "tr", "track", "ul",
].join("|");
const HTML_BLOCK_TAG_START_RE = new RegExp(
    String.raw`^ {0,3}<\/?(?:${HTML_BLOCK_TAGS})(?:[ \t]|\/?>|$)`,
    "i",
);

function htmlBlockEndForStart(line: string): HtmlBlockEnd | null {
    const rawTag = /^ {0,3}<(script|pre|style|textarea)(?:[ \t]|>|$)/i.exec(line);
    if (rawTag) return { type: "closing-tag", tagName: rawTag[1].toLowerCase() };
    if (/^ {0,3}<!--/.test(line)) return { type: "sequence", value: "-->" };
    if (/^ {0,3}<\?/.test(line)) return { type: "sequence", value: "?>" };
    if (/^ {0,3}<!\[CDATA\[/.test(line)) return { type: "sequence", value: "]]>" };
    if (/^ {0,3}<![A-Z]/.test(line)) return { type: "sequence", value: ">" };
    if (HTML_BLOCK_TAG_START_RE.test(line)) return { type: "blank" };
    return null;
}

function isHtmlBlockEnd(line: string, end: HtmlBlockEnd): boolean {
    if (end.type === "blank") return line.trim().length === 0;
    if (end.type === "closing-tag") {
        return line.toLowerCase().includes(`</${end.tagName}>`);
    }
    return line.includes(end.value);
}

function matchHtmlBlockStart(
    source: string,
    previousContainers: readonly FenceContainer[],
    paragraphOpen: boolean,
): HtmlBlockStartMatch | null {
    const line = expandMarkdownLine(source);
    const candidates = fenceContainerCandidates(line.text, previousContainers).filter((candidate) => (
        candidateCanInterruptParagraph(candidate, previousContainers, paragraphOpen)
    ));

    for (const candidate of candidates) {
        const content = line.text.slice(candidate.contentStart);
        const end = htmlBlockEndForStart(content);
        if (!end) continue;

        const state: HtmlBlockState = {
            containers: [...candidate.containers],
            end,
        };
        return {
            containers: [...candidate.containers],
            state: isHtmlBlockEnd(content, end) ? null : state,
        };
    }

    return null;
}

function matchIndentedCodeStart(
    source: string,
    previousContainers: readonly FenceContainer[],
    paragraphOpen: boolean,
): IndentedCodeState | null {
    if (paragraphOpen) return null;

    const line = expandMarkdownLine(source);
    const candidate = fenceContainerCandidates(line.text, previousContainers)[0];
    if (candidate && /^ {4}/.test(line.text.slice(candidate.contentStart))) {
        return { containers: [...candidate.containers] };
    }

    return null;
}

function isParagraphContent(line: string, paragraphAlreadyOpen = false): boolean {
    if (line.trim().length === 0) return false;
    if (paragraphAlreadyOpen && /^ {0,3}(?:=+|-+) *$/.test(line)) return false;
    if (!paragraphAlreadyOpen && /^ {4}/.test(line)) return false;
    if (/^ {0,3}(?:>|#{1,6}(?: |$))/.test(line)) {
        return false;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (fence && (fence[1].charAt(0) === "~" || !fence[2].includes("`"))) return false;
    if (/^ {0,3}(?:[*+-]|1[.)])(?: |$)/.test(line)) {
        return false;
    }
    if (/^ {0,3}(?:(?:\* *){3,}|(?:_ *){3,}|(?:- *){3,})$/.test(line)) {
        return false;
    }
    return htmlBlockEndForStart(line) === null;
}

function analyzeFenceLine(
    source: string,
    previousContainers: readonly FenceContainer[],
    paragraphOpen: boolean,
): FenceLineAnalysis {
    const line = expandMarkdownLine(source);
    const allCandidates = fenceContainerCandidates(line.text, previousContainers);
    const candidates = allCandidates.filter((candidate) => (
        candidateCanInterruptParagraph(candidate, previousContainers, paragraphOpen)
    ));
    const rejectedParagraphInterrupt = paragraphOpen
        && allCandidates.length > 0
        && candidates.length === 0;

    for (const candidate of candidates) {
        const fence = matchFenceCandidate(line, candidate);
        if (fence) {
            return {
                fence,
                listContainers: retainedListContainers(fence.containers),
                paragraphOpen: false,
            };
        }
    }

    const candidate = candidates[0];
    const isLazyContinuation = paragraphOpen
        && previousContainers.length > 0
        && (!candidate || (
            candidate.containers.length === 0
            && candidate.contentStart === 0
        ))
        && (rejectedParagraphInterrupt || isParagraphContent(line.text, true));
    if (isLazyContinuation) {
        return {
            fence: null,
            listContainers: [...previousContainers],
            paragraphOpen: true,
        };
    }

    const continuesExistingParagraph = paragraphOpen && (
        rejectedParagraphInterrupt
        || (
            candidate?.inheritedCount === previousContainers.length
            && candidate.containers.length === candidate.inheritedCount
        )
    );
    return {
        fence: null,
        listContainers: retainedListContainers(candidate?.containers ?? []),
        paragraphOpen: rejectedParagraphInterrupt || isParagraphContent(
            candidate ? line.text.slice(candidate.contentStart) : line.text,
            continuesExistingParagraph,
        ),
    };
}

function isClosingFence(line: string, fence: FenceMatch): boolean {
    const expandedLine = expandMarkdownLine(line).text;
    const contentStart = consumeExpandedFenceContainerPrefix(expandedLine, fence.containers);
    if (contentStart === null) return false;

    const escapedMarker = fence.marker.charAt(0) === "`" ? "`" : "~";
    const pattern = new RegExp(
        `^ {0,3}${escapedMarker}{${fence.marker.length},} *$`,
    );
    return pattern.test(expandedLine.slice(contentStart));
}

/**
 * Transform only ordinary Markdown. Literal fenced-code content is preserved,
 * while the opening info string is removed so registered code-block processors
 * (for example diagrams or Vault queries) cannot run during card rendering.
 */
function prepareOutsideFencedCode(markdown: string): string {
    const lines = markdown.split("\n");
    const output: string[] = [];
    let ordinaryLines: string[] = [];
    let fence: FenceMatch | null = null;
    let htmlBlock: HtmlBlockState | null = null;
    let indentedCode: IndentedCodeState | null = null;
    let listContainers: FenceContainer[] = [];
    let paragraphOpen = false;

    const flushOrdinary = (): void => {
        if (ordinaryLines.length === 0) return;
        output.push(ordinaryLines.join("\n"));
        ordinaryLines = [];
    };

    for (const line of lines) {
        if (fence) {
            const belongsToContainer = consumeFenceContainerPrefix(line, fence.containers) !== null;
            if (!belongsToContainer) fence = null;
        }

        if (fence) {
            const activeContainers = fence.containers;
            output.push(line);
            if (isClosingFence(line, fence)) fence = null;
            listContainers = retainedListContainers(activeContainers);
            paragraphOpen = false;
            continue;
        }

        if (htmlBlock) {
            const activeContainers = htmlBlock.containers;
            const expandedLine = expandMarkdownLine(line).text;
            const contentStart = consumeExpandedFenceContainerPrefix(
                expandedLine,
                activeContainers,
            );
            if (contentStart === null) {
                htmlBlock = null;
            } else {
                ordinaryLines.push(line);
                if (isHtmlBlockEnd(expandedLine.slice(contentStart), htmlBlock.end)) {
                    htmlBlock = null;
                }
                listContainers = retainedListContainers(activeContainers);
                paragraphOpen = false;
                continue;
            }
        }

        const expandedLine = expandMarkdownLine(line).text;
        if (indentedCode) {
            const activeContainers = indentedCode.containers;
            const contentStart = consumeExpandedFenceContainerPrefix(
                expandedLine,
                activeContainers,
            );
            if (
                contentStart !== null
                && (
                    expandedLine.slice(contentStart).trim().length === 0
                    || /^ {4}/.test(expandedLine.slice(contentStart))
                )
            ) {
                output.push(line);
                listContainers = retainedListContainers(activeContainers);
                paragraphOpen = false;
                continue;
            }
            indentedCode = null;
        }

        const indentedCodeStart = matchIndentedCodeStart(
            line,
            listContainers,
            paragraphOpen,
        );
        if (indentedCodeStart) {
            flushOrdinary();
            output.push(line);
            indentedCode = indentedCodeStart;
            listContainers = retainedListContainers(indentedCodeStart.containers);
            paragraphOpen = false;
            continue;
        }

        const htmlBlockStart = matchHtmlBlockStart(line, listContainers, paragraphOpen);
        if (htmlBlockStart) {
            ordinaryLines.push(line);
            htmlBlock = htmlBlockStart.state;
            listContainers = retainedListContainers(htmlBlockStart.containers);
            paragraphOpen = false;
            continue;
        }

        const analysis = analyzeFenceLine(line, listContainers, paragraphOpen);
        listContainers = analysis.listContainers;
        paragraphOpen = analysis.paragraphOpen;
        if (!analysis.fence) {
            ordinaryLines.push(line);
            continue;
        }

        flushOrdinary();
        fence = analysis.fence;
        output.push(
            line.slice(0, analysis.fence.markerEnd)
            + (analysis.fence.info.toLowerCase() === "mermaid" ? "mermaid" : ""),
        );
    }

    flushOrdinary();
    return output.join("\n");
}

/**
 * Prepare Markdown for resource-localized visual rendering.
 *
 * CRLF is normalized, but leading/trailing text and frontmatter-like/thematic
 * breaks are deliberately retained. Visual syntax is preserved so the resource
 * session can localize explicit media before Obsidian renders it. Literal code
 * remains byte-for-byte equivalent apart from CRLF normalization. Mermaid is
 * the only fenced processor permitted to execute; every other info string is
 * stripped and therefore renders as ordinary code.
 */
export function prepareShareCardMarkdown(markdown: string): PreparedShareCardMarkdown {
    const prepared = prepareOutsideFencedCode(markdown.replace(/\r\n?/g, "\n"));

    return {
        markdown: prepared,
        blocks: splitShareCardMarkdown(prepared),
    };
}

/**
 * Split top-level Markdown at semantic blank-line boundaries while keeping a
 * fenced code block atomic. Blank separators do not become content blocks.
 */
export function splitShareCardMarkdown(markdown: string): string[] {
    const normalized = markdown.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    const blocks: string[] = [];
    let ordinaryLines: string[] = [];
    let fencedLines: string[] | null = null;
    let visualHtmlLines: string[] | null = null;
    let visualHtmlTag = "";
    let visualHtmlDepth = 0;
    let fence: FenceMatch | null = null;
    let listContainers: FenceContainer[] = [];
    let paragraphOpen = false;

    const flushOrdinary = (): void => {
        if (ordinaryLines.some((line) => line.trim().length > 0)) {
            blocks.push(ordinaryLines.join("\n"));
        }
        ordinaryLines = [];
    };

    const flushFence = (): void => {
        if (fencedLines) blocks.push(fencedLines.join("\n"));
        fencedLines = null;
        fence = null;
    };

    const flushVisualHtml = (): void => {
        if (visualHtmlLines) blocks.push(visualHtmlLines.join("\n"));
        visualHtmlLines = null;
        visualHtmlTag = "";
        visualHtmlDepth = 0;
    };

    for (const line of lines) {
        if (visualHtmlLines) {
            visualHtmlLines.push(line);
            visualHtmlDepth += visualHtmlTagDepth(line, visualHtmlTag);
            if (visualHtmlDepth <= 0) flushVisualHtml();
            listContainers = [];
            paragraphOpen = false;
            continue;
        }

        if (fencedLines && fence) {
            const belongsToContainer = consumeFenceContainerPrefix(line, fence.containers) !== null;
            if (!belongsToContainer) flushFence();
        }

        if (fencedLines) {
            const activeContainers = fence?.containers ?? [];
            fencedLines.push(line);
            if (fence && isClosingFence(line, fence)) flushFence();
            listContainers = retainedListContainers(activeContainers);
            paragraphOpen = false;
            continue;
        }

        const visualTag = matchVisualHtmlTag(line);
        if (visualTag) {
            const depth = visualHtmlTagDepth(line, visualTag);
            if (depth > 0) {
                flushOrdinary();
                visualHtmlLines = [line];
                visualHtmlTag = visualTag;
                visualHtmlDepth = depth;
                listContainers = [];
                paragraphOpen = false;
                continue;
            }
        }

        const analysis = analyzeFenceLine(line, listContainers, paragraphOpen);
        listContainers = analysis.listContainers;
        paragraphOpen = analysis.paragraphOpen;
        if (analysis.fence) {
            flushOrdinary();
            fencedLines = [line];
            fence = analysis.fence;
            continue;
        }

        if (line.trim().length === 0) {
            flushOrdinary();
            continue;
        }

        ordinaryLines.push(line);
    }

    flushOrdinary();
    flushFence();
    flushVisualHtml();
    return blocks;
}

function matchVisualHtmlTag(line: string): string | null {
    const withoutQuotes = line.replace(/^(?: {0,3}> ?)+/, "");
    return /^ {0,3}<(svg|canvas|picture|figure)\b/i.exec(withoutQuotes)?.[1].toLowerCase()
        ?? null;
}

function visualHtmlTagDepth(line: string, tagName: string): number {
    const tags = line.match(new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi")) ?? [];
    let depth = 0;
    for (const tag of tags) {
        if (/^<\//.test(tag)) depth -= 1;
        else if (!/\/\s*>$/.test(tag)) depth += 1;
    }
    return depth;
}

/** Explicit alias used by callers that want the longer operation name. */
export const splitShareCardMarkdownIntoBlocks = splitShareCardMarkdown;

/**
 * Project Pagelet findings into stable Markdown without leaking diagnostics,
 * actions, provider metadata or paths. Empty and repeated approved fields are
 * omitted while their first occurrence remains in input order.
 */
export function serializePageletFindings<T extends ShareablePageletFinding>(
    findings: readonly T[],
): string {
    const serializedFindings: string[] = [];

    for (const finding of findings) {
        const seen = new Set<string>();
        const fields: string[] = [];
        for (const value of [finding.title, finding.description, finding.insightText]) {
            const field = value?.trim() ?? "";
            if (field.length === 0 || seen.has(field)) continue;
            seen.add(field);
            fields.push(field);
        }
        if (fields.length === 0) continue;

        const [first, ...rest] = fields;
        const title = finding.title?.trim();
        const firstField = title === first ? `## ${first}` : first;
        serializedFindings.push([firstField, ...rest].join("\n\n"));
    }

    return serializedFindings.join("\n\n---\n\n");
}

/* Copyright 2023 edonyzpc */

/** The text-first Markdown payload consumed by measured pagination. */
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

const RAW_HTML_RESOURCE_ATTRIBUTE_RE = new RegExp(
    String.raw`\s+(?:action|background|cite|data|formaction|href|imagesrcset|ping|poster|src|srcdoc|srcset|style|xlink:href)(?![\w:-])(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?`,
    "gi",
);
const RAW_HTML_EVENT_ATTRIBUTE_RE = new RegExp(
    String.raw`\s+on[a-z0-9_-]+(?![\w:-])(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?`,
    "gi",
);
const RAW_HTML_IDENTITY_ATTRIBUTE_RE = new RegExp(
    String.raw`\s+(?:class|id|is|data-[a-z0-9_.:-]+)(?![\w:-])(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?`,
    "gi",
);

function readableLabel(kind: string, value?: string): string {
    const label = value?.replace(/\s+/g, " ").trim();
    return label ? `[${kind}: ${label}]` : `[${kind}]`;
}

function attributeValue(attributes: string, name: string): string | undefined {
    const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attributes);
    if (quoted) return quoted[2];

    return new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(attributes)?.[1];
}

function wikiEmbedLabel(value: string): string {
    const [target = "", alias = ""] = value.split("|", 2);
    const explicitAlias = alias.trim();
    if (explicitAlias && !/^\d+(?:x\d+)?$/i.test(explicitAlias)) return explicitAlias;

    const withoutAnchor = target.split(/[\^#]/, 1)[0].trim();
    const fileName = withoutAnchor.split("/").pop() ?? withoutAnchor;
    return fileName.replace(/\.[a-z0-9]{1,8}$/i, "") || "Embedded content";
}

function isEscapedAt(text: string, index: number): boolean {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === "\\"; cursor -= 1) {
        slashCount += 1;
    }
    return slashCount % 2 === 1;
}

function findClosingBracket(text: string, contentStart: number): number {
    let depth = 1;
    for (let cursor = contentStart; cursor < text.length; cursor += 1) {
        if (isEscapedAt(text, cursor)) continue;
        if (text.charAt(cursor) === "[") depth += 1;
        if (text.charAt(cursor) !== "]") continue;
        depth -= 1;
        if (depth === 0) return cursor;
    }
    return -1;
}

function replaceMarkdownInlineImages(markdown: string): string {
    let output = "";
    let copyFrom = 0;
    let searchFrom = 0;

    while (searchFrom < markdown.length) {
        const imageStart = markdown.indexOf("![", searchFrom);
        if (imageStart < 0) break;
        if (isEscapedAt(markdown, imageStart)) {
            searchFrom = imageStart + 2;
            continue;
        }

        const altEnd = findClosingBracket(markdown, imageStart + 2);
        if (altEnd < 0 || markdown.charAt(altEnd + 1) !== "(") {
            searchFrom = imageStart + 2;
            continue;
        }

        let cursor = altEnd + 2;
        let depth = 1;
        let quote = "";
        let insideAngleDestination = false;
        while (cursor < markdown.length && depth > 0) {
            const character = markdown.charAt(cursor);
            if (isEscapedAt(markdown, cursor)) {
                // Escaped parentheses/quotes are destination text, not syntax.
            } else if (quote) {
                if (character === quote) quote = "";
            } else if (insideAngleDestination) {
                if (character === ">") insideAngleDestination = false;
            } else if (
                (character === "\"" || character === "'")
                && /\s/.test(markdown.charAt(cursor - 1))
            ) {
                quote = character;
            } else if (character === "<" && depth === 1) {
                insideAngleDestination = true;
            } else if (character === "(") {
                depth += 1;
            } else if (character === ")") {
                depth -= 1;
            }
            cursor += 1;
        }
        if (depth !== 0) {
            searchFrom = imageStart + 2;
            continue;
        }

        const alt = markdown.slice(imageStart + 2, altEnd)
            .replace(/\\\[/g, "[")
            .replace(/\\]/g, "]");
        output += markdown.slice(copyFrom, imageStart);
        output += readableLabel("Image", alt);
        copyFrom = cursor;
        searchFrom = cursor;
    }

    return output + markdown.slice(copyFrom);
}

function replaceMarkdownReferenceImages(markdown: string): string {
    let output = "";
    let copyFrom = 0;
    let searchFrom = 0;

    while (searchFrom < markdown.length) {
        const imageStart = markdown.indexOf("![", searchFrom);
        if (imageStart < 0) break;
        if (isEscapedAt(markdown, imageStart)) {
            searchFrom = imageStart + 2;
            continue;
        }

        const altEnd = findClosingBracket(markdown, imageStart + 2);
        if (altEnd < 0) {
            // A malformed opener must not prevent a later valid image from
            // being neutralized.
            searchFrom = imageStart + 2;
            continue;
        }
        const referenceStart = altEnd + 1;
        if (markdown.charAt(referenceStart) === "(") {
            searchFrom = altEnd + 1;
            continue;
        }

        let imageEnd = altEnd + 1;
        if (markdown.charAt(referenceStart) === "[") {
            const referenceEnd = findClosingBracket(markdown, referenceStart + 1);
            if (referenceEnd < 0) {
                searchFrom = altEnd + 1;
                continue;
            }
            imageEnd = referenceEnd + 1;
        }

        const alt = markdown.slice(imageStart + 2, altEnd)
            .replace(/\\\[/g, "[")
            .replace(/\\]/g, "]");
        output += markdown.slice(copyFrom, imageStart);
        output += readableLabel("Image", alt);
        copyFrom = imageEnd;
        searchFrom = imageEnd;
    }

    return output + markdown.slice(copyFrom);
}

/**
 * Remove resource-bearing attributes from raw HTML before MarkdownRenderer can
 * create DOM nodes for it. This parser only identifies tag boundaries; quoted
 * `>` characters remain inside the tag and literal code is excluded by the
 * callers that split fenced and inline-code segments.
 */
function stripRawHtmlResourceAttributes(markdown: string): string {
    let output = "";
    let copyFrom = 0;
    let cursor = 0;

    while (cursor < markdown.length) {
        const tagStart = markdown.indexOf("<", cursor);
        if (tagStart < 0) break;

        const prefix = markdown.charAt(tagStart + 1);
        const tagNameStart = prefix === "/" ? tagStart + 2 : tagStart + 1;
        if (!/[a-z]/i.test(markdown.charAt(tagNameStart))) {
            cursor = tagStart + 1;
            continue;
        }

        let quote = "";
        let tagEnd = tagNameStart;
        for (; tagEnd < markdown.length; tagEnd += 1) {
            const character = markdown.charAt(tagEnd);
            if (quote) {
                if (character === quote) quote = "";
                continue;
            }
            if (character === "\"" || character === "'") {
                quote = character;
                continue;
            }
            if (character === ">") break;
        }
        if (tagEnd >= markdown.length) break;

        const rawTag = markdown.slice(tagStart, tagEnd + 1);
        const tagName = /^[a-z][a-z0-9:-]*/i.exec(markdown.slice(tagNameStart))?.[0] ?? "";
        const safeTag = tagName.includes("-")
            ? ""
            : prefix === "/"
            ? rawTag
            : rawTag
                .replace(RAW_HTML_RESOURCE_ATTRIBUTE_RE, "")
                .replace(RAW_HTML_EVENT_ATTRIBUTE_RE, "")
                .replace(RAW_HTML_IDENTITY_ATTRIBUTE_RE, "");
        output += markdown.slice(copyFrom, tagStart) + safeTag;
        copyFrom = tagEnd + 1;
        cursor = tagEnd + 1;
    }

    return output + markdown.slice(copyFrom);
}

function prepareMediaSegment(markdown: string): string {
    let prepared = markdown;

    // Obsidian embeds must be handled before ordinary Markdown image syntax.
    prepared = prepared.replace(/!\[\[([^\]]+)\]\]/g, (_match, value: string) => (
        readableLabel("Embed", wikiEmbedLabel(value))
    ));

    // Inline and reference-style Markdown images. Keep useful alt text, never
    // the resource URL/reference that could make the renderer load media.
    prepared = replaceMarkdownInlineImages(prepared);
    prepared = replaceMarkdownReferenceImages(prepared);

    // HTML media is also made inert. Paired elements are replaced first so
    // fallback children cannot leave another active media element behind.
    prepared = prepared.replace(
        /<(picture|iframe|video|audio|canvas|svg|object)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi,
        (match: string, tag: string, attributes: string) => {
            const kind = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
            const nestedImageAttributes = /<img\b([^>]*)\/?\s*>/i.exec(match)?.[1] ?? "";
            const label = attributeValue(attributes, "title")
                ?? attributeValue(nestedImageAttributes, "alt");
            return readableLabel(kind, label);
        },
    );
    prepared = prepared.replace(/<img\b([^>]*)\/?\s*>/gi, (_match, attributes: string) => (
        readableLabel("Image", attributeValue(attributes, "alt"))
    ));
    prepared = prepared.replace(
        /<(picture|iframe|video|audio|canvas|svg|object|embed|source)\b([^>]*)\/?\s*>/gi,
        (_match, tag: string, attributes: string) => {
            const kind = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
            return readableLabel(kind, attributeValue(attributes, "title"));
        },
    );
    return stripRawHtmlResourceAttributes(prepared);
}

interface BacktickRun {
    start: number;
    end: number;
    length: number;
}

function findBacktickRun(markdown: string, from: number): BacktickRun | null {
    for (let cursor = from; cursor < markdown.length; cursor += 1) {
        if (markdown.charAt(cursor) !== "`" || isEscapedAt(markdown, cursor)) continue;
        let end = cursor + 1;
        while (markdown.charAt(end) === "`") end += 1;
        return { start: cursor, end, length: end - cursor };
    }
    return null;
}

function prepareTextSegment(markdown: string): string {
    let output = "";
    let cursor = 0;

    while (cursor < markdown.length) {
        const opening = findBacktickRun(markdown, cursor);
        if (!opening) {
            output += prepareMediaSegment(markdown.slice(cursor));
            break;
        }

        let closing = findBacktickRun(markdown, opening.end);
        while (closing && closing.length !== opening.length) {
            closing = findBacktickRun(markdown, closing.end);
        }
        if (!closing) {
            output += prepareMediaSegment(markdown.slice(cursor));
            break;
        }

        output += prepareMediaSegment(markdown.slice(cursor, opening.start));
        output += markdown.slice(opening.start, closing.end);
        cursor = closing.end;
    }

    return output;
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
        output.push(prepareTextSegment(ordinaryLines.join("\n")));
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
        output.push(line.slice(0, analysis.fence.markerEnd));
    }

    flushOrdinary();
    return output.join("\n");
}

/**
 * Prepare untrusted Markdown for local, text-only rendering.
 *
 * CRLF is normalized, but leading/trailing text and frontmatter-like/thematic
 * breaks are deliberately retained. Media syntax is replaced before Obsidian's
 * renderer can resolve or fetch it.
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

    for (const line of lines) {
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
    return blocks;
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

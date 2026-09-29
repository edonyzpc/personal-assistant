import MarkdownIt, { type StateBlock, type StateInline, type Token } from "markdown-it";
import { stableHash } from "../pa/helpers";
import { lexicalSemanticSignature } from "./lexical-content";
import { GhostExportError } from "./errors";
import { GHOST_EMBED_TOKEN, installGhostInlineRules, installGhostSourceRanges } from "./markdown-parser";
import { getTokenSourceRange, mapInlineRangeToSource } from "./source-position";
import type {
    ExportBlock,
    ExportCapabilities,
    ExportResourcePlan,
    ExportWarning,
    GhostPublishingFields,
    GhostPublishingHost,
    LexicalNodeJson,
    LexicalDocumentJson,
    SourceMapSpan,
    WikiLinkTarget,
    WikiLinkOccurrence,
} from "./types";

interface MarkdownExportContext {
    host: GhostPublishingHost;
    sourcePath: string;
    expandedMarkdown: string;
    sourceMap: SourceMapSpan[];
    resources: ExportResourcePlan[];
    resourceByKey: Map<string, ExportResourcePlan>;
    resourceByPendingSrc: Map<string, ExportResourcePlan>;
    warnings: ExportWarning[];
    capabilities: ExportCapabilities;
    wikiLinks: Record<string, WikiLinkTarget>;
    wikiLinkOccurrences: WikiLinkOccurrence[];
    blockSourceRanges: Array<{ startLine: number; endLine: number }>;
}

export interface MarkdownExportOutput {
    lexical: LexicalDocumentJson;
    blocks: ExportBlock[];
    resources: ExportResourcePlan[];
    capabilities: ExportCapabilities;
    warnings: ExportWarning[];
    fieldResourceReferences: { featureImage?: string };
    wikiLinkOccurrences: WikiLinkOccurrence[];
}

const DYNAMIC_LANGUAGES = new Set(["dataview", "dataviewjs", "templater"]);
const TEXT_FORMAT = { bold: 1, italic: 2, strikethrough: 4, underline: 8, code: 16 } as const;
const WIKI_TOKEN = "pa_ghost_wiki_link";
type MarkdownItInstance = ReturnType<typeof MarkdownIt>;

function protectMathInline(state: StateInline): boolean {
    const start = state.pos;
    const source = state.src;
    if (source[start] !== "$" || (start > 0 && source[start - 1] === "\\")) return false;
    if (source.startsWith("$$", start)) {
        const end = source.indexOf("$$", start + 2);
        if (end > start && !source.slice(start + 2, end).includes("\n\n")) {
            const token = state.push("pa_display_math", "math", 0);
            token.content = source.slice(start, end + 2);
            state.pos = end + 2;
            return true;
        }
        return false;
    }
    const end = source.indexOf("$", start + 1);
    if (end <= start || source.slice(start + 1, end).includes("\n")) return false;
    const token = state.push("pa_inline_math", "math", 0);
    token.content = source.slice(start, end + 1);
    state.pos = end + 1;
    return true;
}

function installMathProtection(markdownIt: MarkdownItInstance): void {
    markdownIt.inline.ruler.before("emphasis", "pa_ghost_math", protectMathInline);
}

function footnoteReferenceInline(state: StateInline): boolean {
    if (state.src[state.pos] !== "[" || state.src[state.pos + 1] !== "^") return false;
    const match = /^\[\^[^\]\s]+\]/.exec(state.src.slice(state.pos));
    if (!match) return false;
    const token = state.push("pa_footnote_ref", "sup", 0);
    token.content = match[0];
    state.pos += match[0].length;
    return true;
}

function footnoteDefinitionBlock(
    state: StateBlock,
    startLine: number,
    _endLine: number,
    silent: boolean,
): boolean {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const end = state.eMarks[startLine];
    const line = state.src.slice(start, end);
    if (!/^\[\^[^\]\s]+\]:\s+/.test(line)) return false;
    if (silent) return true;
    const token = state.push("pa_footnote_definition", "p", 0);
    token.content = line;
    token.map = [startLine, startLine + 1];
    token.meta = { rawStart: start, rawEnd: end };
    state.line = startLine + 1;
    return true;
}

function installFootnoteRules(markdownIt: MarkdownItInstance): void {
    markdownIt.inline.ruler.before("link", "pa_ghost_footnote_ref", footnoteReferenceInline);
    markdownIt.block.ruler.before("reference", "pa_ghost_footnote_definition", footnoteDefinitionBlock);
}

function renderInlineMarkdown(
    value: string,
    context: MarkdownExportContext,
    line: number,
    sourceOffset?: number,
): string {
    const markdownIt = new MarkdownIt("commonmark", {
        html: false,
        linkify: false,
        typographer: false,
    });
    installMathProtection(markdownIt);
    installFootnoteRules(markdownIt);
    installGhostInlineRules(markdownIt);
    markdownIt.inline.ruler.before("link", WIKI_TOKEN, wikiLinkRule);
    return markdownIt.parseInline(value, {})
        .filter((token) => token.type === "inline")
        .map((token) => inlineHtml(token, context, line, sourceOffset))
        .join("");
}

function textNode(value: string, format = 0): LexicalNodeJson {
    return {
        detail: 0,
        format,
        mode: "normal",
        style: "",
        text: value,
        type: "extended-text",
        version: 1,
    };
}

function linebreakNode(): LexicalNodeJson {
    return { type: "linebreak", version: 1 };
}

function paragraphNode(children: LexicalNodeJson[]): LexicalNodeJson | null {
    return children.length === 0
        ? null
        : { children, direction: null, format: "", indent: 0, type: "paragraph", version: 1 };
}

function headingNode(children: LexicalNodeJson[], tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"): LexicalNodeJson {
    return { children, direction: null, format: "", indent: 0, type: "extended-heading", version: 1, tag };
}

function quoteNode(children: LexicalNodeJson[]): LexicalNodeJson {
    return { children, direction: null, format: "", indent: 0, type: "extended-quote", version: 1, tag: "blockquote" };
}

function codeblockNode(code: string, language: string): LexicalNodeJson {
    return { type: "codeblock", version: 1, code, language, caption: "" };
}

function htmlCardNode(html: string): LexicalNodeJson {
    return { type: "html", version: 1, html };
}

function imageNode(src: string, alt: string, title = ""): LexicalNodeJson {
    return {
        type: "image",
        version: 1,
        src,
        width: null,
        height: null,
        title,
        alt,
        caption: "",
        cardWidth: "regular",
        href: "",
    };
}

function linkNode(children: LexicalNodeJson[], url: string): LexicalNodeJson {
    return {
        children,
        direction: null,
        format: "",
        indent: 0,
        type: "link",
        version: 1,
        rel: null,
        target: null,
        title: null,
        url,
    };
}

function listNode(
    children: LexicalNodeJson[],
    tag: "ul" | "ol",
    listType: "bullet" | "number",
    start: number,
): LexicalNodeJson {
    return {
        children,
        direction: null,
        format: "",
        indent: 0,
        type: "list",
        version: 1,
        listType,
        start,
        tag,
    };
}

function listItemNode(children: LexicalNodeJson[], value: number): LexicalNodeJson {
    return { children, direction: null, format: "", indent: 0, type: "listitem", version: 1, value };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function attrValue(token: Token, name: string, fallback = ""): string {
    const value = token.attrGet(name);
    return value === null ? fallback : String(value);
}

function isRemoteUrl(value: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/i.test(value.trim());
}

function addResource(
    context: MarkdownExportContext,
    source: string,
    alt: string,
    line: number,
    title?: string,
    field?: "feature_image",
    sourceOffset?: number,
): string {
    const trimmedSource = source.trim();
    const owner = sourceOffset === undefined
        ? sourceSpanForLine(context, line)
        : sourceSpanForOffset(context, sourceOffset);
    const ownerPath = owner?.path ?? context.sourcePath;
    const originalLine = owner && sourceOffset !== undefined
        ? owner.sourceLine + (context.expandedMarkdown.slice(owner.start, sourceOffset).match(/\n/g)?.length ?? 0)
        : owner?.sourceLine ?? line;
    let resolvedPath: string | undefined;
    let kind: ExportResourcePlan["kind"] = "unresolved";
    if (isRemoteUrl(trimmedSource)) {
        kind = "remote";
    } else {
        const resolved = context.host.metadataCache?.getFirstLinkpathDest?.(trimmedSource, ownerPath) ?? null;
        if (resolved) {
            resolvedPath = resolved.path;
            kind = "local";
        }
    }
    const key = `${kind}:${resolvedPath ?? trimmedSource}`;
    const existing = context.resourceByKey.get(key);
    if (existing) {
        existing.occurrences.push({ path: ownerPath, line: originalLine, ...(field ? { field } : {}) });
        return `pending-resource://${existing.id}`;
    }
    const resource: ExportResourcePlan = {
        id: `resource-${context.resources.length + 1}`,
        kind,
        source: trimmedSource,
        ...(resolvedPath ? { resolvedPath } : {}),
        alt,
        ...(title ? { title } : {}),
        occurrences: [{ path: ownerPath, line: originalLine, ...(field ? { field } : {}) }],
    };
    context.resources.push(resource);
    context.resourceByKey.set(key, resource);
    if (kind === "unresolved") {
        throw new GhostExportError(
            "resource-not-found",
            `Image resource could not be resolved: ${trimmedSource}`,
            ownerPath,
            originalLine + 1,
        );
    }
    const pendingSrc = `pending-resource://${resource.id}`;
    context.resourceByPendingSrc.set(pendingSrc, resource);
    return pendingSrc;
}

function wikiLinkRule(state: StateInline, silent: boolean): boolean {
    if (state.src[state.pos - 1] === "!") return false;
    const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
        const token = state.push(WIKI_TOKEN, "", 0);
        token.content = match[2]?.trim() || match[1].trim();
        token.meta = { target: match[1].trim(), rawStart: state.pos, rawEnd: state.pos + match[0].length };
    }
    state.pos += match[0].length;
    return true;
}

function nodeForWikiLink(token: Token, context: MarkdownExportContext, inlineToken: Token | undefined, format: number, sourceOffset?: number): LexicalNodeJson {
    const range = getTokenSourceRange(token);
    if (!range || !inlineToken) throw new GhostExportError("unsupported-syntax", "Wiki link source location is unavailable.");
    const offset = mapInlineRangeToSource(inlineToken, range, sourceOffset).rawStart;
    const owner = sourceSpanForOffset(context, offset);
    const path = owner?.path ?? context.sourcePath;
    const line = (owner?.sourceLine ?? 0) + (context.expandedMarkdown.slice(owner?.start ?? 0, offset).match(/\n/g)?.length ?? 0) + 1;
    const target = (token.meta as { target: string }).target;
    context.wikiLinkOccurrences.push({ target, sourcePath: path, line });
    const resolution = context.wikiLinks[target];
    const warn = (code: ExportWarning["code"]) => context.warnings.push({ code, path, line, message: code });
    if (resolution?.status === "published" && resolution.url) {
        if (resolution.anchorFallback) warn("wiki-link-anchor-fallback");
        return linkNode([textNode(token.content, format)], resolution.anchor ? `${resolution.url}#${resolution.anchor}` : resolution.url);
    }
    warn(resolution?.status === "ambiguous" ? "ambiguous-wiki-link"
        : resolution?.status === "missing" ? "unresolved-wiki-link" : "unpublished-wiki-link");
    return textNode(token.content, format);
}

function inlineNodes(
    tokens: Token[] | null,
    context: MarkdownExportContext,
    line: number,
    format = 0,
    inlineToken?: Token,
): LexicalNodeJson[] {
    const output: LexicalNodeJson[] = [];
    const formatStack: number[] = [];
    let activeLinkUrl: string | null = null;
    let activeLinkChildren: LexicalNodeJson[] = [];
    for (const token of tokens ?? []) {
        if (token.type === "html_inline") {
            throw new GhostExportError("unknown-executable-content", "Raw inline HTML is not supported.", context.sourcePath, line + 1);
        }
        if (token.type === GHOST_EMBED_TOKEN) {
            throw new GhostExportError("unsupported-syntax", "A note embed was not expanded.", context.sourcePath, line + 1);
        }
        if (token.type === "link_open") {
            activeLinkUrl = attrValue(token, "href");
            activeLinkChildren = [];
        } else if (token.type === "link_close") {
            if (activeLinkUrl === null) {
                throw new GhostExportError("unsupported-syntax", "Markdown link close has no matching open.", context.sourcePath, line + 1);
            }
            output.push(linkNode(activeLinkChildren, activeLinkUrl));
            activeLinkUrl = null;
            activeLinkChildren = [];
        } else if (token.type === "strong_open" || token.type === "em_open" || token.type === "s_open") {
            formatStack.push(
                token.type === "strong_open"
                    ? TEXT_FORMAT.bold
                    : token.type === "em_open"
                        ? TEXT_FORMAT.italic
                        : TEXT_FORMAT.strikethrough,
            );
        } else if (token.type === "strong_close" || token.type === "em_close" || token.type === "s_close") {
            formatStack.pop();
        } else if (token.type === "text") {
            if (/<[a-z][^>]*>/i.test(token.content)) {
                throw new GhostExportError("unknown-executable-content", "Raw note HTML is not supported.", context.sourcePath, line + 1);
            }
            if (token.content.includes("<%") || token.content.includes("%>")) {
                throw new GhostExportError("unknown-executable-content", "Templater syntax is not supported.", context.sourcePath, line + 1);
            }
            const activeFormat = formatStack.reduce((total, value) => total | value, format);
            const nodes = [textNode(token.content, activeFormat)];
            if (activeLinkUrl === null) output.push(...nodes);
            else activeLinkChildren.push(...nodes);
        } else if (token.type === WIKI_TOKEN) {
            const activeFormat = formatStack.reduce((total, value) => total | value, format);
            if (activeLinkUrl === null) output.push(nodeForWikiLink(token, context, inlineToken, activeFormat));
            else activeLinkChildren.push(textNode(token.content, activeFormat));
        } else if (token.type === "pa_inline_math") {
            context.capabilities.hasInlineMath = true;
            const expression = token.content.slice(1, -1);
            const node = textNode(`\\(${expression}\\)`, formatStack.reduce((total, value) => total | value, format));
            if (activeLinkUrl === null) output.push(node);
            else activeLinkChildren.push(node);
        } else if (token.type === "code_inline") {
            const activeFormat = formatStack.reduce((total, value) => total | value, format);
            const node = textNode(token.content, activeFormat | TEXT_FORMAT.code);
            if (activeLinkUrl === null) output.push(node);
            else activeLinkChildren.push(node);
        } else if (token.type === "softbreak" || token.type === "hardbreak") {
            const node = linebreakNode();
            if (activeLinkUrl === null) output.push(node);
            else activeLinkChildren.push(node);
        } else if (token.type === "image") {
            const src = attrValue(token, "src");
            const alt = token.children?.map((child) => child.content).join("") ?? token.content;
            const title = attrValue(token, "title", "");
            const sourceRange = getTokenSourceRange(token);
            const sourceOffset = sourceRange && inlineToken
                ? mapInlineRangeToSource(inlineToken, sourceRange).rawStart
                : undefined;
            const pending = addResource(context, src, alt, line, title, undefined, sourceOffset);
            const node = imageNode(pending, alt, title ?? "");
            if (activeLinkUrl === null) output.push(node);
            else activeLinkChildren.push(node);
        }
    }
    if (activeLinkUrl !== null) {
        throw new GhostExportError("unsupported-syntax", "Markdown link has no matching close.", context.sourcePath, line + 1);
    }
    return output;
}

function inlineNodesWithImages(
    inline: Token | undefined,
    context: MarkdownExportContext,
    line: number,
): LexicalNodeJson[] {
    const output: LexicalNodeJson[] = [];
    let paragraphChildren: LexicalNodeJson[] = [];
    let inlineSegment: Token[] = [];
    const flush = () => {
        paragraphChildren.push(...inlineNodes(inlineSegment, context, line, 0, inline));
        inlineSegment = [];
        const paragraph = paragraphNode(paragraphChildren);
        if (paragraph) output.push(paragraph);
        paragraphChildren = [];
    };
    for (const token of inline?.children ?? []) {
        if (token.type === "image") {
            flush();
            const alt = token.children?.map((child) => child.content).join("") ?? token.content;
            const title = attrValue(token, "title", "");
            const src = attrValue(token, "src");
            const sourceRange = getTokenSourceRange(token);
            const sourceOffset = sourceRange && inline
                ? mapInlineRangeToSource(inline, sourceRange).rawStart
                : undefined;
            const pending = addResource(context, src, alt, line, title || undefined, undefined, sourceOffset);
            output.push(imageNode(pending, alt, title));
        } else if (token.type === WIKI_TOKEN || token.type === GHOST_EMBED_TOKEN || token.type === "text" || token.type === "pa_inline_math" || token.type === "code_inline" || token.type === "softbreak" || token.type === "hardbreak" || token.type.endsWith("_open") || token.type.endsWith("_close")) {
            inlineSegment.push(token);
        }
    }
    flush();
    return output;
}

function isBlockMath(token: Token, inline: Token | undefined): boolean {
    if (inline?.children?.some((child) => child.type === "pa_display_math")) return true;
    const content = inline?.content ?? "";
    return content.trimStart().startsWith("$$") && content.trimEnd().endsWith("$$") && content.trim().length >= 4;
}

function mathHtmlCard(expression: string): LexicalNodeJson {
    return htmlCardNode(`<div class="pa-ghost-math-block">\\[${escapeHtml(expression)}\\]</div>`);
}

function findClose(
    tokens: Token[],
    start: number,
    openType: string,
    closeType: string,
    context: MarkdownExportContext,
): number {
    let depth = 0;
    for (let index = start; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type === openType && token.nesting === 1) depth += 1;
        if (token.type === closeType && token.nesting === -1) {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    throw new GhostExportError("unsupported-syntax", `Unclosed Markdown block: ${openType}`, context.sourcePath);
}

function lineForToken(token: Token | undefined): number {
    return token?.map?.[0] ?? 0;
}

function recordNodeRange(
    context: MarkdownExportContext,
    token: Token,
    nodeCount: number,
): void {
    const startLine = token.map?.[0] ?? 0;
    const endLine = token.map?.[1] ?? startLine + 1;
    for (let index = 0; index < nodeCount; index += 1) {
        context.blockSourceRanges.push({ startLine, endLine });
    }
}

function inlineHtml(
    token: Token | null,
    context: MarkdownExportContext,
    line: number,
    sourceOffset?: number,
): string {
    let html = "";
    let linkUrl: string | null = null;
    for (const child of token?.children ?? []) {
        if (child.type === "html_inline") {
            throw new GhostExportError("unknown-executable-content", "Raw note HTML is not supported.", context.sourcePath, line + 1);
        }
        if (child.type === GHOST_EMBED_TOKEN) {
            throw new GhostExportError("unsupported-syntax", "A note embed was not expanded.", context.sourcePath, line + 1);
        }
        if (child.type === "text") html += escapeHtml(child.content);
        else if (child.type === WIKI_TOKEN) {
            if (linkUrl !== null) html += escapeHtml(child.content);
            else {
                const node = nodeForWikiLink(child, context, token ?? undefined, 0, sourceOffset);
                html += node.type === "link" ? `<a href="${escapeHtml(String(node.url))}">${escapeHtml(child.content)}</a>`
                    : escapeHtml(child.content);
            }
        }
        else if (child.type === "pa_footnote_ref") {
            const id = child.content.slice(2, -1);
            html += `<sup class="pa-ghost-footnote-ref" id="user-content-fnref-${escapeHtml(id)}"><a href="#user-content-fn-${escapeHtml(id)}">${escapeHtml(id)}</a></sup>`;
        }
        else if (child.type === "code_inline") html += `<code>${escapeHtml(child.content)}</code>`;
        else if (child.type === "pa_inline_math") {
            context.capabilities.hasInlineMath = true;
            html += `\\(${escapeHtml(child.content.slice(1, -1))}\\)`;
        } else if (child.type === "pa_display_math") html += escapeHtml(child.content);
        else if (child.type === "softbreak" || child.type === "hardbreak") html += "<br>";
        else if (child.type === "image") {
            const alt = child.children?.map((part) => part.content).join("") ?? child.content;
            const title = attrValue(child, "title", "");
            const src = attrValue(child, "src");
            const sourceRange = getTokenSourceRange(child);
            const resolvedSourceRange = sourceRange && token
                ? mapInlineRangeToSource(token, sourceRange, sourceOffset)
                : null;
            const pending = addResource(
                context,
                src,
                alt,
                line,
                title || undefined,
                undefined,
                resolvedSourceRange?.rawStart ?? sourceOffset,
            );
            html += `<img src="${escapeHtml(pending)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
        } else if (child.type === "link_open") {
            linkUrl = attrValue(child, "href");
            html += `<a href="${escapeHtml(linkUrl)}">`;
        } else if (child.type === "link_close") {
            html += "</a>";
            linkUrl = null;
        } else if (child.type === "strong_open") html += "<strong>";
        else if (child.type === "strong_close") html += "</strong>";
        else if (child.type === "em_open") html += "<em>";
        else if (child.type === "em_close") html += "</em>";
        else if (child.type === "s_open") html += "<s>";
        else if (child.type === "s_close") html += "</s>";
    }
    return html;
}

function tableHtml(tokens: Token[], start: number, end: number, context: MarkdownExportContext, line: number): string {
    let html = "<table>";
    let cellOpen: string | null = null;
    for (let index = start; index <= end; index += 1) {
        const token = tokens[index];
        if (token.type === "thead_open") {
            html += "<thead>";
        } else if (token.type === "thead_close") {
            html += "</thead><tbody>";
        } else if (token.type === "tbody_close") {
            html += "</tbody>";
        } else if (token.type === "tr_open") {
            html += "<tr>";
        } else if (token.type === "tr_close") {
            html += "</tr>";
        } else if (token.type === "th_open" || token.type === "td_open") {
            cellOpen = token.type === "th_open" ? "th" : "td";
        } else if ((token.type === "th_close" || token.type === "td_close") && cellOpen) {
            const inline = tokens[index - 1];
            html += `<${cellOpen}>${inlineHtml(inline?.type === "inline" ? inline : null, context, line)}</${cellOpen}>`;
            cellOpen = null;
        } else if (token.type === "inline" && cellOpen) {
            continue;
        }
    }
    return `${html}</table>`;
}

function footnoteReferenceCard(
    inline: Token | undefined,
    context: MarkdownExportContext,
    line: number,
): LexicalNodeJson | null {
    if (!inline?.children?.some((child) => child.type === "pa_footnote_ref")) return null;
    return htmlCardNode(`<p class="pa-ghost-footnote-reference">${inlineHtml(inline, context, line)}</p>`);
}

function footnoteDefinitionCard(
    token: Token | undefined,
    context: MarkdownExportContext,
    line: number,
): LexicalNodeJson | null {
    const match = /^\[\^([^\]\s]+)\]:\s*([\s\S]*)$/.exec((token?.content ?? "").trim());
    if (!match) return null;
    const id = match[1];
    const bodyText = match[2] ?? "";
    const definitionOffset = token ? getTokenSourceRange(token)?.rawStart : undefined;
    if (definitionOffset === undefined) throw new Error("Ghost footnote definition has no source range.");
    const bodyOffset = definitionOffset + Math.max(0, token?.content.indexOf(bodyText) ?? 0);
    const body = renderInlineMarkdown(bodyText, context, line, bodyOffset);
    return htmlCardNode(
        `<section class="pa-ghost-footnotes"><p id="user-content-fn-${id}"><sup>${escapeHtml(id)}</sup> ${body}</p></section>`,
    );
}

function isTaskList(tokens: Token[], start: number, end: number): boolean {
    for (let index = start; index < end; index += 1) {
        const token = tokens[index];
        if (token?.type === "inline" && /^\[[ xX]\]\s+/.test(token.content.trim())) return true;
    }
    return false;
}

function findListEntryEnd(tokens: Token[], start: number, end: number): number {
    let depth = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
        const token = tokens[cursor];
        if (token.type === "list_item_open" && token.nesting === 1) depth += 1;
        if (token.type === "list_item_close" && token.nesting === -1) {
            depth -= 1;
            if (depth === 0) return cursor;
        }
    }
    return end;
}

function renderListHtml(
    tokens: Token[],
    start: number,
    end: number,
    context: MarkdownExportContext,
    line: number,
    stripTaskMarker: boolean,
): string {
    const ordered = tokens[start].type === "ordered_list_open";
    const items: string[] = [];
    let index = start + 1;
    while (index < end) {
        if (tokens[index].type !== "list_item_open") {
            index += 1;
            continue;
        }
        const itemEnd = findListEntryEnd(tokens, index, end);
        let itemHtml = "";
        let firstInline = true;
        let cursor = index + 1;
        while (cursor < itemEnd) {
            const token = tokens[cursor];
            if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
                const closeType = token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
                const close = findClose(tokens, cursor, token.type, closeType, context);
                itemHtml += renderListHtml(tokens, cursor, close, context, line, false);
                cursor = close + 1;
            } else if (token.type === "inline") {
                let rendered = inlineHtml(token, context, line);
                if (firstInline && stripTaskMarker) rendered = rendered.replace(/^\[[ xX]\]\s+/, "");
                itemHtml += rendered;
                firstInline = false;
                cursor += 1;
            } else {
                cursor += 1;
            }
        }
        const match = /^\[([ xX])\]\s+/.exec(tokens.slice(index, itemEnd).find((token) => token.type === "inline")?.content.trim() ?? "");
        const checked = stripTaskMarker && match?.[1]?.toLowerCase() === "x";
        const prefix = stripTaskMarker
            ? `<input type="checkbox" disabled${checked ? " checked" : ""}> `
            : "";
        items.push(`<li>${prefix}${itemHtml}</li>`);
        index = itemEnd + 1;
    }
    return ordered
        ? `<ol class="pa-ghost-task-list">${items.join("")}</ol>`
        : `<ul class="pa-ghost-task-list">${items.join("")}</ul>`;
}

function taskListHtml(
    tokens: Token[],
    start: number,
    end: number,
    context: MarkdownExportContext,
    line: number,
): string {
    return renderListHtml(tokens, start, end, context, line, true);
}

function convertRange(
    tokens: Token[],
    start: number,
    end: number,
    context: MarkdownExportContext,
    recordSource = false,
): LexicalNodeJson[] {
    const output: LexicalNodeJson[] = [];
    let index = start;
    while (index < end) {
        const token = tokens[index];
        const line = lineForToken(token);
        if (token.type === "heading_open") {
            const close = index + 2;
            const tag = (token.tag || "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
            const inline = tokens[index + 1];
            const nodes = [headingNode(inlineNodes(inline?.children ?? null, context, line, 0, inline), tag)];
            output.push(...nodes);
            if (recordSource) recordNodeRange(context, token, nodes.length);
            index = close + 1;
        } else if (token.type === "pa_footnote_definition") {
            const footnoteNode = footnoteDefinitionCard(token, context, line);
            const nodes = footnoteNode ? [footnoteNode] : [];
            output.push(...nodes);
            if (recordSource) recordNodeRange(context, token, nodes.length);
            index += 1;
        } else if (token.type === "paragraph_open") {
            const close = index + 1;
            const inline = tokens[index + 1];
            let nodes: LexicalNodeJson[];
            const footnoteDefinition = footnoteDefinitionCard(inline, context, line);
            const footnoteReference = footnoteReferenceCard(inline, context, line);
            if (footnoteDefinition) nodes = [footnoteDefinition];
            else if (footnoteReference) nodes = [footnoteReference];
            else if (isBlockMath(inline, tokens[close])) {
                const content = (inline?.content ?? "").trim();
                const expression = content.slice(2, -2).trim();
                context.capabilities.hasDisplayMath = true;
                nodes = [mathHtmlCard(expression)];
            } else {
                nodes = inlineNodesWithImages(inline, context, line);
            }
            output.push(...nodes);
            if (recordSource) recordNodeRange(context, token, nodes.length);
            index = close + 1;
        } else if (token.type === "fence") {
            const language = (token.info.trim().split(/\s+/)[0] ?? "").toLowerCase();
            if (DYNAMIC_LANGUAGES.has(language)) {
                throw new GhostExportError("unknown-executable-content", `Dynamic code fence is not supported: ${language}`, context.sourcePath, line + 1);
            }
            if (language === "math") {
                context.capabilities.hasDisplayMath = true;
                const nodes = [mathHtmlCard(token.content.trim())];
                output.push(...nodes);
                if (recordSource) recordNodeRange(context, token, nodes.length);
            } else if (language === "mermaid") {
                context.capabilities.hasMermaid = true;
                const nodes = [codeblockNode(token.content, "mermaid")];
                output.push(...nodes);
                if (recordSource) recordNodeRange(context, token, nodes.length);
            } else {
                if (language) context.capabilities.codeLanguages.push(language);
                const nodes = [codeblockNode(token.content, language)];
                output.push(...nodes);
                if (recordSource) recordNodeRange(context, token, nodes.length);
            }
            index += 1;
        } else if (token.type === "code_block") {
            const nodes = [codeblockNode(token.content, "")];
            output.push(...nodes);
            if (recordSource) recordNodeRange(context, token, nodes.length);
            index += 1;
        } else if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
            const closeType = token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
            const close = findClose(tokens, index, token.type, closeType, context);
            const nodes = [isTaskList(tokens, index, close)
                ? htmlCardNode(taskListHtml(tokens, index, close, context, line))
                : convertList(tokens, index, close, context)];
            output.push(...nodes);
            if (recordSource) recordNodeRange(context, token, nodes.length);
            index = close + 1;
        } else if (token.type === "blockquote_open") {
            const close = findClose(tokens, index, "blockquote_open", "blockquote_close", context);
            const nodes = [quoteNode(convertRange(tokens, index + 1, close, context))];
            output.push(...nodes);
            if (recordSource) recordNodeRange(context, token, nodes.length);
            index = close + 1;
        } else if (token.type === "table_open") {
            const close = findClose(tokens, index, "table_open", "table_close", context);
            const nodes = [htmlCardNode(tableHtml(tokens, index + 1, close - 1, context, line))];
            output.push(...nodes);
            if (recordSource) recordNodeRange(context, token, nodes.length);
            index = close + 1;
        } else if (token.type === "html_block" || token.type === "html_inline") {
            throw new GhostExportError("unknown-executable-content", "Raw note HTML is not supported.", context.sourcePath, line + 1);
        } else {
            index += 1;
        }
    }
    return output;
}

function convertList(tokens: Token[], start: number, end: number, context: MarkdownExportContext): LexicalNodeJson {
    const open = tokens[start];
    const tag = open.type === "bullet_list_open" ? "ul" : "ol";
    const listType = tag === "ul" ? "bullet" : "number";
    const startValue = Number(open.attrGet("start") ?? 1) || 1;
    const itemChildren: LexicalNodeJson[] = [];
    let index = start + 1;
    let itemValue = 0;
    while (index < end) {
        if (tokens[index].type !== "list_item_open") {
            index += 1;
            continue;
        }
        itemValue += 1;
        let depth = 0;
        let itemEnd = index + 1;
        for (let cursor = index; cursor < end; cursor += 1) {
            const token = tokens[cursor];
            if (token.type === "list_item_open" && token.nesting === 1) depth += 1;
            if (token.type === "list_item_close" && token.nesting === -1) {
                depth -= 1;
                if (depth === 0) {
                    itemEnd = cursor;
                    break;
                }
            }
        }
        const children = listEntryNodes(tokens, index + 1, itemEnd, context);
        itemChildren.push(listItemNode(children, itemValue));
        index = itemEnd + 1;
    }
    return listNode(itemChildren, tag, listType, startValue);
}

function listEntryNodes(tokens: Token[], start: number, end: number, context: MarkdownExportContext): LexicalNodeJson[] {
    const nodes: LexicalNodeJson[] = [];
    let index = start;
    while (index < end) {
        const token = tokens[index];
        if (token.type === "paragraph_open") {
            const inline = tokens[index + 1];
            const line = lineForToken(token);
            nodes.push(...inlineNodes(inline?.children ?? null, context, line, 0, inline));
            index += 3;
        } else if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
            const closeType = token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
            const close = findClose(tokens, index, token.type, closeType, context);
            nodes.push(convertList(tokens, index, close, context));
            index = close + 1;
        } else if (token.type.endsWith("_close")) {
            index += 1;
        } else if (token.type.endsWith("_open") || token.type === "paragraph_open" || token.type === "fence" || token.type === "code_block") {
            nodes.push(...convertRange(tokens, index, end, context));
            index = end;
        } else {
            throw new GhostExportError(
                "unsupported-syntax",
                `Unsupported Markdown construct inside list: ${token.type}`,
                context.sourcePath,
                lineForToken(token) + 1,
            );
        }
    }
    return nodes.length > 0 ? nodes : [textNode("")];
}

function sourceSpan(context: MarkdownExportContext, startLine: number, endLine: number): SourceMapSpan | undefined {
    const offsets = [0];
    for (let index = 0; index < context.expandedMarkdown.length; index += 1) {
        if (context.expandedMarkdown[index] === "\n") offsets.push(index + 1);
    }
    const offset = offsets[Math.min(startLine, offsets.length - 1)] ?? 0;
    return context.sourceMap.find((span) => offset >= span.start && offset < span.end)
        ?? context.sourceMap.find((span) => span.start <= offset);
}

function sourceSpanForLine(context: MarkdownExportContext, line: number): SourceMapSpan | undefined {
    return sourceSpan(context, line, line + 1);
}

function sourceSpanForOffset(context: MarkdownExportContext, offset: number): SourceMapSpan | undefined {
    return context.sourceMap.find((span) => offset >= span.start && offset < span.end)
        ?? [...context.sourceMap].reverse().find((span) => span.start <= offset);
}

export function convertMarkdownToLexical(options: {
    markdown: string;
    sourceMap: SourceMapSpan[];
    sourcePath: string;
    host: GhostPublishingHost;
    fields: GhostPublishingFields;
    wikiLinks?: Record<string, WikiLinkTarget>;
}): MarkdownExportOutput {
    const context: MarkdownExportContext = {
        host: options.host,
        sourcePath: options.sourcePath,
        expandedMarkdown: options.markdown,
        sourceMap: options.sourceMap,
        resources: [],
        resourceByKey: new Map(),
        resourceByPendingSrc: new Map(),
        warnings: [],
        capabilities: { codeLanguages: [], hasMermaid: false, hasInlineMath: false, hasDisplayMath: false },
        wikiLinks: options.wikiLinks ?? {},
        wikiLinkOccurrences: [],
        blockSourceRanges: [],
    };
    const fieldResourceReferences: { featureImage?: string } = {};
    if (options.fields.featureImage.mode === "manage" && options.fields.featureImage.value) {
        fieldResourceReferences.featureImage = addResource(
            context,
            options.fields.featureImage.value,
            "Feature image",
            0,
            undefined,
            "feature_image",
        );
    }

    const markdownIt = new MarkdownIt("commonmark", {
        html: false,
        linkify: false,
        typographer: false,
    }).enable(["table", "strikethrough"]);
    installMathProtection(markdownIt);
    installFootnoteRules(markdownIt);
    installGhostSourceRanges(markdownIt);
    markdownIt.inline.ruler.before("link", WIKI_TOKEN, wikiLinkRule);
    const tokens = markdownIt.parse(options.markdown, {});
    const nodes = convertRange(tokens, 0, tokens.length, context, true);
    const blocks: ExportBlock[] = nodes.map((node, nodeIndex) => {
        const range = context.blockSourceRanges[nodeIndex] ?? { startLine: 0, endLine: 1 };
        const startLine = range.startLine;
        const endLine = range.endLine;
        const span = sourceSpan(context, startLine, endLine);
        const sourceText = options.markdown
            .split(/\r?\n/)
            .slice(startLine, Math.max(endLine, startLine + 1))
            .join("\n");
        return {
            id: `block-${nodeIndex + 1}`,
            nodeKind: node.type,
            sourcePath: span?.path ?? options.sourcePath,
            sourceDependencyIndex: span?.dependencyIndex ?? 0,
            sourceStartLine: startLine,
            sourceEndLine: endLine,
            sourceHash: stableHash(sourceText),
            semanticSignature: lexicalSemanticSignature(node, { image: (src) => {
                const resource = context.resourceByPendingSrc.get(src);
                return resource ? `${resource.kind}:${resource.resolvedPath ?? resource.source}` : src;
            } }),
            nodeIndex,
        };
    });
    return {
        lexical: {
            root: {
                type: "root",
                version: 1,
                direction: null,
                format: "",
                indent: 0,
                children: nodes,
            },
        },
        blocks,
        resources: context.resources,
        capabilities: {
            ...context.capabilities,
            codeLanguages: [...new Set(context.capabilities.codeLanguages)].sort(),
        },
        warnings: context.warnings,
        fieldResourceReferences,
        wikiLinkOccurrences: context.wikiLinkOccurrences,
    };
}

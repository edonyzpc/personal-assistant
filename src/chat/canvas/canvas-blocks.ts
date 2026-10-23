import MarkdownIt, { type Token } from "markdown-it";
import { stableHash } from "../../pa/helpers";
import type { CanvasArtifactRecord } from "./types";

export type CanvasNodeType = "text" | "file" | "link" | "group";

export interface CanvasNode {
    id: string;
    type: CanvasNodeType | "unknown";
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    file?: string;
    subpath?: string;
    url?: string;
    label?: string;
    background?: string;
    backgroundStyle?: "cover" | "ratio" | "repeat";
    color?: string;
    raw: unknown;
}

export interface CanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: string;
    toSide?: string;
    fromEnd: "none" | "arrow";
    toEnd: "none" | "arrow";
    label?: string;
    color?: string;
    raw: unknown;
}

export interface CanvasDocument {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    hasUnknownNodes: boolean;
}

export type CanvasFenceStatus =
    | { kind: "preview"; document: CanvasDocument }
    | { kind: "generating" }
    | { kind: "not-canvas" }
    | { kind: "invalid" };

export interface CanvasFenceBlock {
    language: string;
    raw: string;
    closed: boolean;
    sourceHash: string;
    sourceStartLine: number;
    sourceEndLine: number;
    displayStartLine: number;
    displayEndLine: number;
    occurrence: number;
    status: CanvasFenceStatus;
}

export interface CanvasCodeMatch {
    block: CanvasFenceBlock;
    pre: HTMLElement;
    code: HTMLElement;
}

interface FenceTokenInfo {
    language: string;
    raw: string;
    closed: boolean;
    startLine: number;
    endLine: number;
    token: Token;
}

const fenceParser = new MarkdownIt({ html: true }).disable("inline");
const EXPLICIT_CANVAS_LANGUAGES = new Set(["canvas", "jsoncanvas"]);

function fenceIsClosed(token: Token): boolean {
    if (!token.map) return false;
    // markdown-it removes container indentation and excludes the closing line
    // from content. Its source map still counts both delimiter lines.
    const contentLines = token.content ? token.content.split("\n").length - (token.content.endsWith("\n") ? 1 : 0) : 0;
    return token.map[1] - token.map[0] === contentLines + 2;
}

function parseFences(markdown: string): FenceTokenInfo[] {
    const lineEndings = markdown.match(/\r\n|\r|\n/g) ?? [];
    return fenceParser.parse(markdown, {}).flatMap(token => {
        if (token.type !== "fence" || !token.map) return [];
        const language = token.info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
        const closed = fenceIsClosed(token);
        // The parser owns container indentation, but normalizes line endings.
        // Restore each original terminator without re-parsing list/quote prefixes.
        let sourceLine = token.map[0] + 1;
        const raw = token.content.replace(/\n/g, () => lineEndings[sourceLine++] ?? "\n");
        return [{
            language,
            raw,
            closed,
            startLine: token.map[0],
            endLine: token.map[1],
            token,
        }];
    });
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCanvasNode(value: unknown): CanvasNode | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) return null;
    const x = finiteNumber(record.x);
    const y = finiteNumber(record.y);
    const width = finiteNumber(record.width);
    const height = finiteNumber(record.height);
    if (x === null || y === null || width === null || height === null || width < 0 || height < 0) return null;
    const type = record.type === "text" || record.type === "file" || record.type === "link" || record.type === "group"
        ? record.type
        : typeof record.type === "string" ? "unknown" : null;
    if (type === null) return null;
    if (type === "text" && typeof record.text !== "string") return null;
    if (type === "file" && typeof record.file !== "string") return null;
    if (type === "link" && typeof record.url !== "string") return null;
    if (type === "file" && record.subpath !== undefined
        && (typeof record.subpath !== "string" || !record.subpath.startsWith("#"))) return null;
    if (type === "group" && record.backgroundStyle !== undefined
        && record.backgroundStyle !== "cover" && record.backgroundStyle !== "ratio" && record.backgroundStyle !== "repeat") return null;
    return {
        id: record.id,
        type,
        x,
        y,
        width,
        height,
        ...(typeof record.text === "string" ? { text: record.text } : {}),
        ...(typeof record.file === "string" ? { file: record.file } : {}),
        ...(typeof record.subpath === "string" ? { subpath: record.subpath } : {}),
        ...(typeof record.url === "string" ? { url: record.url } : {}),
        ...(typeof record.label === "string" ? { label: record.label } : {}),
        ...(typeof record.background === "string" ? { background: record.background } : {}),
        ...(record.backgroundStyle === "cover" || record.backgroundStyle === "ratio" || record.backgroundStyle === "repeat"
            ? { backgroundStyle: record.backgroundStyle } : {}),
        ...(typeof record.color === "string" ? { color: record.color } : {}),
        raw: value,
    };
}

function parseCanvasEdge(value: unknown): CanvasEdge | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id
        || typeof record.fromNode !== "string" || typeof record.toNode !== "string") return null;
    if (record.fromEnd !== undefined && record.fromEnd !== "none" && record.fromEnd !== "arrow") return null;
    if (record.toEnd !== undefined && record.toEnd !== "none" && record.toEnd !== "arrow") return null;
    return {
        id: record.id,
        fromNode: record.fromNode,
        toNode: record.toNode,
        ...(typeof record.fromSide === "string" ? { fromSide: record.fromSide } : {}),
        ...(typeof record.toSide === "string" ? { toSide: record.toSide } : {}),
        fromEnd: record.fromEnd === "arrow" ? "arrow" : "none",
        toEnd: record.toEnd === "none" ? "none" : "arrow",
        ...(typeof record.label === "string" ? { label: record.label } : {}),
        ...(typeof record.color === "string" ? { color: record.color } : {}),
        raw: value,
    };
}

export function parseCanvasDocument(raw: string, explicit: boolean): CanvasDocument | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.nodes !== undefined && !Array.isArray(record.nodes)) return null;
    if (record.edges !== undefined && !Array.isArray(record.edges)) return null;
    const nodeValues = record.nodes ?? [];
    const edgeValues = record.edges ?? [];
    const nodes = nodeValues.map(parseCanvasNode);
    const edges = edgeValues.map(parseCanvasEdge);
    if (nodes.some(node => node === null) || edges.some(edge => edge === null)) return null;
    const typedNodes = nodes as CanvasNode[];
    const typedEdges = edges as CanvasEdge[];
    const ids = new Set(typedNodes.map(node => node.id));
    if (ids.size !== typedNodes.length) return null;
    if (new Set(typedEdges.map(edge => edge.id)).size !== typedEdges.length) return null;
    if (typedEdges.some(edge => !ids.has(edge.fromNode) || !ids.has(edge.toNode))) return null;
    const hasKnownNode = typedNodes.some(node => node.type !== "unknown");
    if (!explicit && !hasKnownNode) return null;
    return {
        nodes: typedNodes,
        edges: typedEdges,
        hasUnknownNodes: typedNodes.some(node => node.type === "unknown"),
    };
}

export function deriveCanvasTitle(raw: string): string {
    const document = parseCanvasDocument(raw, true);
    const source = document?.nodes.find(node => node.label?.trim())?.label
        ?? document?.nodes.find(node => node.text?.trim())?.text
        ?? "Canvas";
    const title = source.split(/\r?\n/, 1)[0]?.replace(/^#+\s*/, "").trim() ?? "";
    const safe = title.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return safe || "Canvas";
}

function statusFor(language: string, raw: string, closed: boolean): CanvasFenceStatus {
    const explicit = EXPLICIT_CANVAS_LANGUAGES.has(language);
    if (!closed) return explicit ? { kind: "generating" } : { kind: "not-canvas" };
    if (explicit) {
        const document = parseCanvasDocument(raw, true);
        return document ? { kind: "preview", document } : { kind: "invalid" };
    }
    if (language !== "json") return { kind: "not-canvas" };
    const document = parseCanvasDocument(raw, false);
    return document ? { kind: "preview", document } : { kind: "not-canvas" };
}

function fingerprint(info: FenceTokenInfo): string {
    return JSON.stringify([info.language, info.token.content, info.closed]);
}

export function parseCanvasBlocks(source: string, display = source): CanvasFenceBlock[] {
    const sourceFences = parseFences(source);
    const displayFences = parseFences(display);
    const displayCursors = new Map<string, number>();
    const sourceCursors = new Map<string, number>();
    const blocks: CanvasFenceBlock[] = [];
    for (const info of sourceFences) {
        const explicit = EXPLICIT_CANVAS_LANGUAGES.has(info.language);
        if (!explicit && info.language !== "json") continue;
        const status = statusFor(info.language, info.raw, info.closed);
        if (status.kind === "not-canvas" || status.kind === "invalid") continue;
        const key = fingerprint(info);
        const occurrenceKey = JSON.stringify([info.language, info.raw]);
        const occurrence = sourceCursors.get(occurrenceKey) ?? 0;
        sourceCursors.set(occurrenceKey, occurrence + 1);
        let cursor = displayCursors.get(key) ?? 0;
        let displayInfo: FenceTokenInfo | undefined;
        while (cursor < displayFences.length) {
            const candidate = displayFences[cursor];
            cursor += 1;
            if (fingerprint(candidate) === key) {
                displayInfo = candidate;
                break;
            }
        }
        displayCursors.set(key, cursor);
        if (!displayInfo) continue;
        blocks.push({
            language: info.language,
            raw: info.raw,
            closed: info.closed,
            sourceHash: stableHash(info.raw),
            sourceStartLine: info.startLine,
            sourceEndLine: info.endLine,
            displayStartLine: displayInfo.startLine,
            displayEndLine: displayInfo.endLine,
            occurrence,
            status,
        });
    }
    return blocks;
}

function languageClass(code: HTMLElement, language: string): boolean {
    return code.classList.contains(`language-${language}`);
}

function renderedCode(raw: string): string {
    return raw.replace(/\r\n?/g, "\n");
}

/** Strictly pairs source fences with native code elements; any mismatch leaves the original code. */
export function matchCanvasCodeElements(buffer: HTMLElement, blocks: readonly CanvasFenceBlock[]): CanvasCodeMatch[] {
    const codeElements = Array.from(buffer.querySelectorAll<HTMLElement>("pre > code"));
    const matches: CanvasCodeMatch[] = [];
    const byFingerprint = new Map<string, CanvasFenceBlock[]>();
    for (const block of blocks) {
        const key = JSON.stringify([block.language, renderedCode(block.raw)]);
        byFingerprint.set(key, [...byFingerprint.get(key) ?? [], block]);
    }
    for (const expected of byFingerprint.values()) {
        const candidates = codeElements.filter(code => languageClass(code, expected[0].language)
            && code.textContent === renderedCode(expected[0].raw)
            && !code.closest(".pa-chat-canvas-host"));
        if (candidates.length !== expected.length) continue;
        for (const [index, block] of expected.entries()) {
            const code = candidates[index];
            const pre = code.parentElement;
            if (!pre || pre.tagName !== "PRE") continue;
            matches.push({ block, pre, code });
        }
    }
    return matches.sort((left, right) => codeElements.indexOf(left.code) - codeElements.indexOf(right.code));
}

export function canvasArtifactBlock(block: CanvasFenceBlock): CanvasArtifactRecord["block"] {
    return {
        language: block.language,
        startLine: block.sourceStartLine,
        sourceHash: block.sourceHash,
        occurrence: block.occurrence,
    };
}

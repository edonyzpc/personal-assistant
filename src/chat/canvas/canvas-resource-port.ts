import { TFile, resolveSubpath, type App, type CachedMetadata, type Component } from "obsidian";
import MarkdownIt, { type Env } from "markdown-it";
import type { SourceAccess } from "../../plugin/source-access";
import { OperationsPathError, validateResourceVaultPath } from "../../ai-services/operations/vault-path";
import {
    scanShareCardResourceReferences,
    splitShareCardVaultReference,
    type ShareCardResourceScan,
} from "../../share-card/share-card-resources";

export interface CanvasResourceRequest {
    reference: string;
    sourcePath: string;
    owner?: Component;
    signal?: AbortSignal;
    isCurrent(this: void): boolean;
}

export type CanvasResolvedResource =
    | { status: "markdown"; file: TFile; markdown: string }
    | { status: "file"; file: TFile; subpath: string }
    | { status: "unavailable" };

export type CanvasMarkdownSlot =
    | { marker: string; kind: "markdown"; sourcePath: string; prepared: PreparedCanvasMarkdown }
    | { marker: string; kind: "unavailable" };

/** Child notes retain their own native Markdown source context instead of being inlined. */
export interface PreparedCanvasMarkdown {
    markdown: string;
    sourcePath: string;
    unavailableCount: number;
    slots: CanvasMarkdownSlot[];
}

export interface CanvasPreviewResourcePort {
    resolve(request: CanvasResourceRequest): Promise<CanvasResolvedResource>;
    prepareMarkdown(input: {
        markdown: string;
        sourcePath: string;
        owner?: Component;
        signal?: AbortSignal;
        isCurrent(this: void): boolean;
        visited?: ReadonlySet<string>;
    }): Promise<PreparedCanvasMarkdown>;
}

interface PluginCanvasResourcePortOptions {
    app: App;
    sourceAccess: SourceAccess;
}

type ResourceOccurrence = ShareCardResourceScan["references"][number];
interface ResourceGroup {
    start: number;
    end: number;
    occurrences: ResourceOccurrence[];
}

const markdownParser = new MarkdownIt({ html: true });
// This parser only discovers references; include schemes that the resource
// boundary must reject rather than dropping them before that check.
markdownParser.validateLink = () => true;

function markdownReferenceDefinitions(markdown: string): { get(label: string): string | undefined } {
    const environment: Env = {};
    markdownParser.parse(markdown, environment);
    return { get: label => environment.references?.[markdownParser.utils.normalizeReference(label)]?.href };
}

function isImageFile(file: TFile): boolean {
    return /^(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.extension);
}

function active(signal: AbortSignal | undefined, isCurrent: () => boolean): boolean {
    return !signal?.aborted && isCurrent();
}

function isRemoteReference(reference: string): boolean {
    const value = reference.trim();
    return /^data:/i.test(value) || /^https?:\/\//i.test(value) || value.startsWith("//")
        || /^[a-z][a-z0-9+.-]*:/i.test(value);
}

/** Keep host link preferences without letting an untrusted subpath/alias add syntax. */
export function canvasEmbedMarkdown(app: App, file: TFile, sourcePath: string, subpath = "", alias?: string): string | null {
    const markdown = `!${app.fileManager.generateMarkdownLink(file, sourcePath, subpath, alias)}`;
    const references = scanShareCardResourceReferences(markdown, { includeActiveHtml: true, includeImageSyntax: true }).references;
    if (references.length !== 1) return null;
    const reference = references[0];
    if (reference.start !== 0 || reference.end !== markdown.length || isRemoteReference(reference.reference)) return null;
    const parsed = splitShareCardVaultReference(reference.reference);
    const expectedSubpath = splitShareCardVaultReference(`canvas${subpath}`).subpath;
    return parsed.subpath === expectedSubpath
        && app.metadataCache.getFirstLinkpathDest(parsed.linkpath, sourcePath) === file ? markdown : null;
}

function rawTagRange(markdown: string, occurrence: ResourceOccurrence): { start: number; end: number } {
    // The opt-in scanner supplies whole iframe/style/script elements.
    if (markdown.charAt(occurrence.start) === "<") return occurrence;
    let start = markdown.lastIndexOf("<", occurrence.start);
    if (start < 0) return occurrence;
    let quote = "";
    let end = start;
    for (let cursor = start + 1; cursor < markdown.length; cursor += 1) {
        const character = markdown.charAt(cursor);
        if (quote) {
            if (character === quote) quote = "";
        } else if (character === "\"" || character === "'") quote = character;
        else if (character === ">") {
            end = cursor + 1;
            break;
        }
    }
    if (end === start) return occurrence;
    let tag = /^<\s*([a-z][a-z0-9:-]*)/i.exec(markdown.slice(start, end))?.[1]?.toLowerCase();
    if (tag === "source") {
        // Replace the owning media element, so the browser cannot select a
        // residual source after another attribute has been denied.
        const stack: Array<{ tag: string; start: number }> = [];
        for (const match of markdown.slice(0, start).matchAll(/<\s*(\/?)\s*(audio|video|picture)\b[^>]*>/gi)) {
            if (match[1]) stack.pop();
            else stack.push({ tag: match[2].toLowerCase(), start: match.index! });
        }
        const parent = stack[stack.length - 1];
        if (parent) ({ start, tag } = parent);
    }
    if (tag && ["audio", "video", "picture", "object"].includes(tag)) {
        const closing = new RegExp(`<\\/\\s*${tag}\\s*>`, "gi");
        closing.lastIndex = end;
        const match = closing.exec(markdown);
        if (match) end = match.index + match[0].length;
    }
    return { start, end };
}

function resourceGroups(markdown: string, references: ResourceOccurrence[]): ResourceGroup[] {
    const groups: ResourceGroup[] = [];
    for (const occurrence of references) {
        const range = occurrence.kind.startsWith("html-") || occurrence.kind === "css-image"
            || occurrence.kind === "svg-reference" ? rawTagRange(markdown, occurrence) : occurrence;
        groups.push({ start: range.start, end: range.end, occurrences: [occurrence] });
    }
    const merged: ResourceGroup[] = [];
    for (const group of groups.sort((a, b) => a.start - b.start || b.end - a.end)) {
        const previous = merged[merged.length - 1];
        if (previous && group.start < previous.end) {
            previous.end = Math.max(previous.end, group.end);
            previous.occurrences.push(...group.occurrences);
        } else merged.push(group);
    }
    return merged;
}

function projectMarkdown(markdown: string, cache: CachedMetadata | null, subpath: string): string | null {
    if (!subpath) return markdown;
    if (!cache) return null;
    const projection = resolveSubpath(cache, subpath);
    if (!projection) return null;
    const start = projection.start.offset;
    const end = projection.end?.offset ?? markdown.length;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > markdown.length) return null;
    return markdown.slice(start, end);
}

export function createCanvasPreviewResourcePort(options: PluginCanvasResourcePortOptions): CanvasPreviewResourcePort {
    const resolveFile = (reference: string, sourcePath: string): TFile | null => {
        const { linkpath, subpath } = splitShareCardVaultReference(reference);
        if (!linkpath && subpath && sourcePath) {
            const current = options.app.vault.getAbstractFileByPath(sourcePath);
            return current instanceof TFile ? current : null;
        }
        return linkpath ? options.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) : null;
    };

    const isCurrentVaultFile = (file: TFile): boolean => {
        if (isRemoteReference(file.path) || file.path.startsWith("/") || file.path.startsWith("\\")) return false;
        if (options.app.vault.getAbstractFileByPath(file.path) !== file) return false;
        try {
            return validateResourceVaultPath(file.path) === file.path;
        } catch (error) {
            if (error instanceof OperationsPathError) return false;
            throw error;
        }
    };

    const isAllowedFile = (file: TFile): boolean => isCurrentVaultFile(file)
        && (isImageFile(file) || (options.sourceAccess.isDataBoundaryAllowedPath(file.path)
            && options.sourceAccess.isDataBoundaryAllowedFile(file)));

    const isNativeImageGroup = (group: ResourceGroup, markdown: string, sourcePath: string): boolean => {
        const tag = /^<\s*([a-z][a-z0-9:-]*)/i.exec(markdown.slice(group.start, group.end))?.[1]?.toLowerCase();
        return group.occurrences.every(occurrence => {
            const imageSyntax = occurrence.kind === "markdown-image" || occurrence.kind === "wiki-image"
                || ((tag === "img" || tag === "image" || tag === "picture")
                    && (occurrence.kind === "html-image" || occurrence.kind === "svg-reference"
                        || (occurrence.kind === "html-active" && /^(?:img src|image href|source src)$/.test(occurrence.label))));
            if (!imageSyntax) return false;
            const reference = occurrence.reference.trim();
            if (/^(?:https?:\/\/|\/\/|data:image\/)/i.test(reference)) return true;
            if (isRemoteReference(reference)) return false;
            const file = resolveFile(reference, sourcePath);
            return file !== null && isCurrentVaultFile(file) && isImageFile(file);
        });
    };

    const resolve = async (request: CanvasResourceRequest, visited?: ReadonlySet<string>): Promise<CanvasResolvedResource> => {
        if (!active(request.signal, request.isCurrent) || isRemoteReference(request.reference)) return { status: "unavailable" };
        const file = resolveFile(request.reference, request.sourcePath);
        if (!file || !isAllowedFile(file)) return { status: "unavailable" };
        const { subpath } = splitShareCardVaultReference(request.reference);
        if (file.extension.toLowerCase() !== "md") {
            // Native Canvas embeds only read this file to draw shapes; they do
            // not expand child files/text/backgrounds. Do not read those here.
            return { status: "file", file, subpath };
        }
        if (visited?.has(file.path)) return { status: "unavailable" };
        const path = file.path;
        const source = await options.sourceAccess.captureLatestMemorySource(
            path,
            candidate => active(request.signal, request.isCurrent)
                && options.sourceAccess.isDataBoundaryAllowedPath(candidate)
                && isAllowedFile(file),
            "chat",
            request.signal,
        );
        if (!active(request.signal, request.isCurrent) || !source || file.path !== path
            || source.path !== path || !isAllowedFile(file)
            || options.sourceAccess.getLatestDataBoundaryContentBoundary(path, source.markdown)?.allowed !== true) {
            return { status: "unavailable" };
        }
        const projected = projectMarkdown(source.markdown, options.app.metadataCache.getFileCache(file), subpath);
        return projected === null ? { status: "unavailable" } : { status: "markdown", file, markdown: projected };
    };

    const port: CanvasPreviewResourcePort = {
        resolve: request => resolve(request),

        async prepareMarkdown(input) {
            const empty = (): PreparedCanvasMarkdown => ({ markdown: "", sourcePath: input.sourcePath, unavailableCount: 1, slots: [] });
            if (!active(input.signal, input.isCurrent)) return empty();
            const scan = scanShareCardResourceReferences(input.markdown, {
                includeActiveHtml: true,
                includeImageSyntax: true,
                referenceDefinitions: markdownReferenceDefinitions(input.markdown),
            });
            const groups = resourceGroups(input.markdown, scan.references);
            const slots: CanvasMarkdownSlot[] = [];
            const replacements: Array<{ start: number; end: number; markdown: string }> = [];
            const visited = input.visited ?? new Set([input.sourcePath]);
            let unavailableCount = 0;
            const markerPrefix = `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const addSlot = (group: ResourceGroup, slot: Omit<Extract<CanvasMarkdownSlot, { kind: "markdown" }>, "marker">
                | Omit<Extract<CanvasMarkdownSlot, { kind: "unavailable" }>, "marker">): void => {
                let marker = `${markerPrefix}-${slots.length}`;
                while (input.markdown.includes(marker)) marker += "x";
                slots.push({ ...slot, marker });
                replacements.push({ start: group.start, end: group.end, markdown: `<span data-pa-canvas-slot="${marker}"></span>` });
            };

            for (const group of groups) {
                if (!active(input.signal, input.isCurrent)) return empty();
                // Viewing an image is native UI rendering, not Agent source admission.
                // Keep its original syntax, sizing and reference-definition semantics.
                if (isNativeImageGroup(group, input.markdown, input.sourcePath)) continue;
                // Replace each HTML element once, including all its active
                // attributes, before the host can issue a residual request.
                if (group.occurrences.some(item => !item.reference || isRemoteReference(item.reference))) {
                    unavailableCount += 1;
                    addSlot(group, { kind: "unavailable" });
                    continue;
                }
                const primary = group.occurrences.find(item => item.label.endsWith(" src"))
                    ?? group.occurrences.find(item => item.kind === "html-image") ?? group.occurrences[0];
                let resolved: CanvasResolvedResource = { status: "unavailable" };
                let denied = false;
                for (const occurrence of group.occurrences) {
                    const candidate = await resolve({ ...input, reference: occurrence.reference }, visited);
                    if (!active(input.signal, input.isCurrent)) return empty();
                    if (candidate.status === "unavailable") { denied = true; break; }
                    if (occurrence === primary) resolved = candidate;
                }
                if (denied || resolved.status === "unavailable") {
                    unavailableCount += 1;
                    addSlot(group, { kind: "unavailable" });
                } else if (resolved.status === "file") {
                    const syntax = input.markdown.slice(primary.start, primary.end);
                    const wikiAlias = /^!\[\[[^|\]\r\n]+\|([^\]\r\n]*)\]\]$/.exec(syntax)?.[1];
                    const alias = wikiAlias ?? (primary.kind === "markdown-image" ? primary.label : undefined);
                    const markdown = canvasEmbedMarkdown(options.app, resolved.file, input.sourcePath, resolved.subpath, alias);
                    if (markdown === null) {
                        unavailableCount += 1;
                        addSlot(group, { kind: "unavailable" });
                    } else replacements.push({ start: group.start, end: group.end, markdown });
                } else {
                    const nested = await port.prepareMarkdown({
                        ...input,
                        markdown: resolved.markdown,
                        sourcePath: resolved.file.path,
                        visited: new Set([...visited, resolved.file.path]),
                    });
                    if (!active(input.signal, input.isCurrent)) return empty();
                    unavailableCount += nested.unavailableCount;
                    addSlot(group, { kind: "markdown", sourcePath: resolved.file.path, prepared: nested });
                }
            }
            let markdown = input.markdown;
            for (const replacement of replacements.reverse()) {
                markdown = markdown.slice(0, replacement.start) + replacement.markdown + markdown.slice(replacement.end);
            }
            return { markdown, sourcePath: input.sourcePath, unavailableCount, slots };
        },
    };
    return port;
}

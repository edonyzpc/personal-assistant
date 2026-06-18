/**
 * Execution helpers shared by chat-tool factories and registry-side input
 * validation: vault access, Markdown / Canvas parsing, metadata querying,
 * snippet search, tag listing, editor reading, and the `*Like` interfaces
 * that adapt obsidian-api shapes for testability.
 *
 * Moved here from the original chat-tools.ts monolith as part of Phase 3.1
 * (docs/archive/sdd-chat-tools-split.md). Depends on Module A (types) and Module B
 * (constants); leaf in the DAG aside from those.
 *
 * The `*Like` interfaces live here (not in chat-tool-types) per the SDD —
 * only Module D (factories) and this module consume them. Keeping them
 * here avoids promoting vault-adapter shapes to the public type surface.
 */

import { MarkdownView, type Workspace } from "obsidian";

import type { AiServiceHost } from "./AiServiceHost";
import type { ChatAgentSource } from "./chat-types";
import { throwIfAborted } from "./chat-utils";
import {
    CANVAS_MAX_DANGLING_EDGES,
    CANVAS_MAX_DUPLICATE_IDS,
    CANVAS_MAX_GROUPS,
    CANVAS_MAX_ISOLATED_NODES,
    CANVAS_MAX_SNIPPETS,
    CANVAS_SNIPPET_MAX_CHARS,
    FRONTMATTER_PREVIEW_MAX_KEYS,
    FRONTMATTER_VALUE_MAX_CHARS,
    INSPECT_NOTE_MAX_CALLOUTS,
    INSPECT_NOTE_MAX_HEADINGS,
    INSPECT_NOTE_MAX_LINKS,
    INSPECT_NOTE_MAX_PROPERTIES,
    INSPECT_NOTE_MAX_TAGS,
    INSPECT_NOTE_MAX_TASKS,
    INSPECT_NOTE_SCAN_LINES,
    METADATA_CACHE_UNAVAILABLE_SOURCE,
    NOTE_OUTLINE_SCAN_LINES,
    OBSIDIAN_TARGET_PATH_MAX_CHARS,
    SNIPPET_CONTEXT_CHARS,
    SNIPPET_MAX_BYTES,
    SNIPPET_MAX_CANDIDATE_FILES,
    SNIPPET_MAX_CHARS,
    SNIPPET_MAX_FILE_BYTES,
    SNIPPET_MAX_FILES,
    SNIPPET_SCOPE_UNAVAILABLE_SOURCE,
    SNIPPET_SCOPE_UNSUPPORTED_SOURCE,
    CURRENT_NOTE_CONTENT_BUDGET_CHARS,
    CURRENT_NOTE_HEADING_SCAN_LINES,
    CURRENT_NOTE_MAX_HEADINGS,
    CURRENT_NOTE_NEARBY_RADIUS_LINES,
    CURRENT_NOTE_OUTLINE_SCAN_LINES,
    TAG_REPRESENTATIVE_PATHS,
    TAGS_SCAN_MAX_FILES,
    TAGS_SCAN_YIELD_INTERVAL,
    VAULT_FILE_READ_SKIPPED_SIZE_SOURCE,
    VAULT_FILE_READ_UNAVAILABLE_SOURCE,
} from "./chat-tool-constants";
import type {
    CanvasTextSnippet,
    ChatToolResult,
    CurrentNoteContextOutput,
    InspectObsidianNoteOutput,
    NoteOutlineHeading,
    ObsidianLinkTarget,
    ReadCanvasSummaryOutput,
    RecentNoteItem,
    SearchVaultSnippetsInput,
    VaultMetadataMatch,
    VaultSnippetMatch,
    VaultSnippetSearchOutput,
    VaultTagsOutput,
} from "./chat-tool-types";

export interface EditorLike {
    getSelection?: () => string;
    getValue?: () => string;
    getCursor?: () => { line: number; ch: number };
    lineCount?: () => number;
    getLine?: (line: number) => string;
}

export interface VaultFileLike {
    path: string;
    basename?: string;
    name?: string;
    extension?: string;
    stat?: {
        mtime?: number;
        ctime?: number;
        size?: number;
    };
}

export type MarkdownFileLike = VaultFileLike;

export interface MarkdownViewLike {
    file: MarkdownFileLike;
    editor?: EditorLike;
}

export interface VaultLike {
    getMarkdownFiles?: () => MarkdownFileLike[];
    getAbstractFileByPath?: (path: string) => unknown;
    cachedRead?: (file: VaultFileLike) => Promise<string>;
}

export interface MetadataCacheLike {
    getFileCache?: (file: MarkdownFileLike) => FileCacheLike | null | undefined;
    resolvedLinks?: Record<string, Record<string, number>>;
    unresolvedLinks?: Record<string, Record<string, number>>;
}

export interface FileCacheLike {
    tags?: Array<{ tag?: string }>;
    frontmatter?: Record<string, unknown>;
    headings?: Array<{ heading?: string; level?: number }>;
    links?: Array<{ link?: string; original?: string; displayText?: string }>;
    embeds?: Array<{ link?: string; original?: string; displayText?: string }>;
    listItems?: Array<{
        task?: string;
        position?: {
            start?: { line?: number };
            end?: { line?: number };
        };
    }>;
}

export function findCurrentMarkdownView(workspace: Workspace): MarkdownViewLike | null {
    const activeView = workspace.getActiveViewOfType(MarkdownView);
    if (isMarkdownViewLike(activeView)) {
        return activeView;
    }

    const recentLeaf = workspace.getMostRecentLeaf?.();
    if (isMarkdownViewLike(recentLeaf?.view)) {
        return recentLeaf.view;
    }

    const markdownLeaf = workspace.getLeavesOfType?.("markdown")
        .find((leaf) => isMarkdownViewLike(leaf.view));
    return isMarkdownViewLike(markdownLeaf?.view) ? markdownLeaf.view : null;
}

export function isMarkdownViewLike(view: unknown): view is MarkdownViewLike {
    if (
        !view
        || typeof view !== "object"
        || !("file" in view)
        || typeof (view as MarkdownViewLike).file?.path !== "string"
    ) {
        return false;
    }

    const getViewType = (view as { getViewType?: unknown }).getViewType;
    return typeof getViewType !== "function" || getViewType.call(view) === "markdown";
}

export function createToolFailureResult<Output = unknown>(tool: string, inputSummary: string, error: string): ChatToolResult<Output> {
    return {
        ok: false,
        tool,
        inputSummary,
        content: null,
        sources: [],
        error,
    };
}

export function createCurrentNoteResult(
    inputSummary: string,
    content: CurrentNoteContextOutput,
    sources: ChatAgentSource[],
): ChatToolResult<CurrentNoteContextOutput> {
    return {
        ok: true,
        tool: "get_current_note_context",
        inputSummary,
        content,
        sources,
    };
}

export function getFileTitle(file: { basename?: string; name?: string; path: string }): string {
    if (file.basename) return file.basename;
    if (file.name) return file.name.replace(/\.md$/i, "");
    const lastSegment = file.path.split("/").pop() ?? file.path;
    return lastSegment.replace(/\.md$/i, "");
}

export function getVault(host: AiServiceHost): VaultLike {
    return host.app.vault as unknown as VaultLike;
}

export function getMetadataCache(host: AiServiceHost): MetadataCacheLike {
    return host.app.metadataCache as unknown as MetadataCacheLike;
}

export function getOptionalMetadataCache(host: AiServiceHost): MetadataCacheLike | undefined {
    const metadataCache = host.app.metadataCache as unknown;
    return metadataCache && typeof metadataCache === "object"
        ? metadataCache as MetadataCacheLike
        : undefined;
}

export function getMarkdownFiles(host: AiServiceHost): MarkdownFileLike[] {
    return getVault(host).getMarkdownFiles?.() ?? [];
}

export async function readVaultFile(host: AiServiceHost, file: VaultFileLike): Promise<string> {
    return await getVault(host).cachedRead?.(file) ?? "";
}

interface BudgetedVaultRead {
    content: string;
    truncated: boolean;
    skippedForSize: boolean;
    knownSize?: number;
}

export async function readVaultFileWithBudget(
    host: AiServiceHost,
    file: VaultFileLike,
    maxBytes: number,
): Promise<BudgetedVaultRead> {
    const knownSize = getKnownFileSize(file);
    if (knownSize !== undefined && knownSize > maxBytes) {
        return {
            content: "",
            truncated: true,
            skippedForSize: true,
            knownSize,
        };
    }

    const content = await readVaultFile(host, file);
    const contentBytes = getUtf8ByteLength(content);
    if (contentBytes <= maxBytes) {
        return {
            content,
            truncated: false,
            skippedForSize: false,
            knownSize,
        };
    }

    return {
        content: truncateToUtf8ByteLength(content, maxBytes),
        truncated: true,
        skippedForSize: false,
        knownSize,
    };
}

export function getKnownFileSize(file: VaultFileLike): number | undefined {
    const size = file.stat?.size;
    return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : undefined;
}

export function canReadVaultFiles(host: AiServiceHost): boolean {
    return typeof getVault(host).cachedRead === "function";
}

export function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

export function truncateToUtf8ByteLength(value: string, maxBytes: number): string {
    if (maxBytes <= 0) return "";
    const encoder = new TextEncoder();
    if (encoder.encode(value).length <= maxBytes) return value;

    let best = "";
    let low = 0;
    let high = value.length;
    while (low <= high) {
        const midpoint = Math.floor((low + high) / 2);
        const candidate = value.slice(0, midpoint);
        if (encoder.encode(candidate).length <= maxBytes) {
            best = candidate;
            low = midpoint + 1;
        } else {
            high = midpoint - 1;
        }
    }
    return best;
}

export function getUnavailableNoteStructureSources(
    host: AiServiceHost,
    metadataCache: MetadataCacheLike | undefined,
): string[] {
    const unavailableSources: string[] = [];
    if (!metadataCache || typeof metadataCache.getFileCache !== "function") {
        unavailableSources.push(METADATA_CACHE_UNAVAILABLE_SOURCE);
    }
    if (!canReadVaultFiles(host)) {
        unavailableSources.push(VAULT_FILE_READ_UNAVAILABLE_SOURCE);
    }
    return unavailableSources;
}

export function findMarkdownFileByPath(host: AiServiceHost, path: string): MarkdownFileLike | null {
    const byPath = getVault(host).getAbstractFileByPath?.(path);
    if (isMarkdownFileLike(byPath)) {
        return byPath;
    }
    return getMarkdownFiles(host).find((file) => file.path === path) ?? null;
}

export function findVaultFileByPath(host: AiServiceHost, path: string): VaultFileLike | null {
    const byPath = getVault(host).getAbstractFileByPath?.(path);
    if (isVaultFileLike(byPath)) {
        return byPath;
    }
    return getMarkdownFiles(host).find((file) => file.path === path) ?? null;
}

export function isVaultFileLike(value: unknown): value is VaultFileLike {
    return Boolean(value && typeof value === "object" && typeof (value as VaultFileLike).path === "string");
}

export function isMarkdownFileLike(value: unknown): value is MarkdownFileLike {
    return Boolean(
        value
        && typeof value === "object"
        && typeof (value as MarkdownFileLike).path === "string"
        && (value as MarkdownFileLike).path.toLowerCase().endsWith(".md"),
    );
}

export function validateVaultRelativeTargetPath(
    rawPath: string,
    allowedExtensions: string[],
    fieldName: string,
    options: { allowFolder?: boolean } = {},
): string {
    const path = rawPath.replace(/\\/g, "/").trim();
    if (!path) {
        throw new Error(`${fieldName} must be a non-empty vault-relative path.`);
    }
    if (path.length > OBSIDIAN_TARGET_PATH_MAX_CHARS) {
        throw new Error(`${fieldName} is too long.`);
    }
    if (
        path.startsWith("/")
        || path.startsWith("~")
        || /^[a-zA-Z]:\//.test(path)
        || path.includes("\0")
        || /\$(?:\{[^}]+\}|[A-Za-z_][A-Za-z0-9_]*)|%[A-Za-z_][A-Za-z0-9_]*%/.test(path)
    ) {
        throw new Error(`${fieldName} must be a vault-relative path.`);
    }
    const segments = path.split("/").filter((segment) => segment.length > 0);
    if (segments.some((segment) => segment === "." || segment === "..")) {
        throw new Error(`${fieldName} must not contain path traversal.`);
    }

    const lower = path.toLowerCase();
    if (allowedExtensions.some((extension) => lower.endsWith(extension))) {
        return path;
    }
    if (options.allowFolder) {
        return path.replace(/\/+$/, "");
    }
    throw new Error(`${fieldName} has an unsupported file type.`);
}

export function normalizeLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return defaultLimit;
    return Math.min(Math.max(Math.floor(numeric), 1), maxLimit);
}

export function limitInputText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength).trim();
}

interface MetadataQuerySignals {
    normalizedQuery: string;
    tokens: string[];
}

export function buildMetadataQuerySignals(query: string): MetadataQuerySignals {
    const normalizedQuery = normalizeSearchText(query);
    const rawTokens = normalizedQuery.match(/[a-z0-9_-]+|[㐀-鿿]+/g) ?? [];
    const tokens = rawTokens.flatMap((token) => {
        if (/^[㐀-鿿]+$/.test(token) && token.length > 2) {
            const bigrams: string[] = [];
            for (let index = 0; index < token.length - 1; index++) {
                bigrams.push(token.slice(index, index + 2));
            }
            return [token, ...bigrams];
        }
        return [token];
    });
    return {
        normalizedQuery,
        tokens: [...new Set(tokens.filter((token) => token.length > 0))],
    };
}

export function scoreMetadataMatch(
    file: MarkdownFileLike,
    cache: FileCacheLike | null | undefined,
    query: MetadataQuerySignals,
): VaultMetadataMatch | null {
    const title = getFileTitle(file);
    const tags = collectCacheTags(cache);
    const frontmatter = previewFrontmatter(cache?.frontmatter);
    const searchableFrontmatter = indexFrontmatter(cache?.frontmatter);
    const indexedFields = [
        file.path,
        title,
        ...tags,
        ...Object.keys(searchableFrontmatter),
        ...Object.values(searchableFrontmatter),
    ].map(normalizeSearchText);

    let score = 0;
    if (normalizeSearchText(file.path).includes(query.normalizedQuery)) score += 8;
    if (normalizeSearchText(title).includes(query.normalizedQuery)) score += 6;

    for (const token of query.tokens) {
        if (normalizeSearchText(title).includes(token)) score += 4;
        if (normalizeSearchText(file.path).includes(token)) score += 3;
        if (tags.some((tag) => normalizeSearchText(tag).includes(token))) score += 3;
        if (Object.entries(searchableFrontmatter).some(([key, value]) => (
            normalizeSearchText(key).includes(token) || normalizeSearchText(value).includes(token)
        ))) score += 2;
        if (indexedFields.some((field) => field.includes(token))) score += 1;
    }

    if (score <= 0) return null;
    return {
        path: file.path,
        title,
        score,
        tags,
        frontmatter,
        mtime: file.stat?.mtime,
        ctime: file.stat?.ctime,
    };
}

export function collectCacheTags(cache: FileCacheLike | null | undefined): string[] {
    return mergeUnique([
        ...normalizeInlineTags(cache?.tags),
        ...normalizeFrontmatterTags(cache?.frontmatter),
    ]);
}

function normalizeInlineTags(tags: FileCacheLike["tags"]): string[] {
    if (!Array.isArray(tags)) return [];
    return mergeUnique(tags
        .map((entry) => typeof entry.tag === "string" ? normalizeTagName(entry.tag) : "")
        .filter((tag) => tag.length > 0));
}

function normalizeFrontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
    if (!frontmatter || typeof frontmatter !== "object") return [];
    return mergeUnique([
        ...normalizeFrontmatterTagValue(frontmatter.tags),
        ...normalizeFrontmatterTagValue(frontmatter.tag),
    ]);
}

function normalizeFrontmatterTagValue(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap(normalizeFrontmatterTagValue);
    }
    if (typeof value !== "string") return [];
    return value
        .split(/[\s,]+/)
        .map(normalizeTagName)
        .filter((tag) => tag.length > 0);
}

function normalizeTagName(value: string): string {
    return value.replace(/^#/, "").trim();
}

export function previewFrontmatter(
    frontmatter: Record<string, unknown> | undefined,
    maxKeys = FRONTMATTER_PREVIEW_MAX_KEYS,
): Record<string, string> {
    if (!frontmatter || typeof frontmatter !== "object") return {};
    const preview: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter).slice(0, maxKeys)) {
        const rendered = renderFrontmatterValue(value);
        if (rendered) {
            preview[key] = truncate(rendered, FRONTMATTER_VALUE_MAX_CHARS);
        }
    }
    return preview;
}

export function indexFrontmatter(frontmatter: Record<string, unknown> | undefined): Record<string, string> {
    if (!frontmatter || typeof frontmatter !== "object") return {};
    const indexed: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
        const rendered = renderFrontmatterValue(value);
        if (key.trim() || rendered) {
            indexed[key] = rendered;
        }
    }
    return indexed;
}

export function renderFrontmatterValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        return value
            .map(renderFrontmatterValue)
            .filter((entry) => entry.length > 0)
            .join(", ");
    }
    return "";
}

export function normalizeSearchText(value: string): string {
    return value.toLowerCase().normalize("NFKC");
}

export function fileToRecentNote(file: MarkdownFileLike): RecentNoteItem {
    return {
        path: file.path,
        title: getFileTitle(file),
        mtime: file.stat?.mtime,
        ctime: file.stat?.ctime,
        size: file.stat?.size,
    };
}

export function buildNoteStructureSummary(
    file: MarkdownFileLike,
    cache: FileCacheLike | null | undefined,
    content: string,
    metadataCache: MetadataCacheLike | undefined,
    unavailableSources: string[] = [],
    options: { truncated?: boolean; skippedSources?: string[]; omittedCount?: number } = {},
): InspectObsidianNoteOutput {
    let omittedCount = options.omittedCount ?? 0;
    const countOmitted = (count: number) => {
        omittedCount += count;
    };
    const parsed = parseMarkdownStructure(content);
    const headingCandidates = extractNoteHeadings(cache, parsed.headings);
    const tags = takeWithOmitted(mergeUnique([...collectCacheTags(cache), ...parsed.tags]), INSPECT_NOTE_MAX_TAGS, countOmitted);
    const headings = takeWithOmitted(headingCandidates, INSPECT_NOTE_MAX_HEADINGS, countOmitted);
    const tasks = takeWithOmitted(parsed.tasks, INSPECT_NOTE_MAX_TASKS, countOmitted);
    const callouts = takeWithOmitted(parsed.callouts, INSPECT_NOTE_MAX_CALLOUTS, countOmitted);
    const wikilinks = takeWithOmitted(mergeUnique([...extractCacheLinks(cache?.links), ...parsed.wikilinks]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const embeds = takeWithOmitted(mergeUnique([...extractCacheLinks(cache?.embeds), ...parsed.embeds]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const wikilinkTargets = takeWithOmitted(mergeUniqueLinkTargets([
        ...extractCacheLinkTargets(cache?.links),
        ...parsed.wikilinkTargets,
    ]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const embedTargets = takeWithOmitted(mergeUniqueLinkTargets([
        ...extractCacheLinkTargets(cache?.embeds, true),
        ...parsed.embedTargets,
    ]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const outgoingLinks = takeWithOmitted(mergeUnique([
        ...wikilinks,
        ...embeds,
        ...Object.keys(metadataCache?.resolvedLinks?.[file.path] ?? {}),
    ]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const backlinks = takeWithOmitted(findBacklinksForPath(file.path, metadataCache?.resolvedLinks), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const unresolvedLinks = takeWithOmitted(Object.keys(metadataCache?.unresolvedLinks?.[file.path] ?? {}), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const output: InspectObsidianNoteOutput = {
        kind: "note-structure",
        path: file.path,
        title: getFileTitle(file),
        properties: previewFrontmatter(cache?.frontmatter, INSPECT_NOTE_MAX_PROPERTIES),
        tags,
        headings,
        tasks,
        callouts,
        wikilinks,
        embeds,
        wikilinkTargets,
        embedTargets,
        outgoingLinks,
        backlinks,
        unresolvedLinks,
        links: {
            outgoing: outgoingLinks,
            backlinks,
            unresolved: unresolvedLinks,
        },
    };
    if (unavailableSources.length > 0) {
        output.unavailableSources = unavailableSources;
    }
    if (options.skippedSources && options.skippedSources.length > 0) {
        output.skippedSources = options.skippedSources;
    }
    if (omittedCount > 0 || options.truncated) {
        output.truncated = true;
        if (omittedCount > 0) {
            output.omittedCount = omittedCount;
        }
    }
    return output;
}

export function extractNoteHeadings(
    cache: FileCacheLike | null | undefined,
    fallback: NoteOutlineHeading[],
): NoteOutlineHeading[] {
    if (!Array.isArray(cache?.headings)) return fallback;
    return cache.headings
        .map((heading) => ({
            level: normalizeHeadingLevel(heading.level),
            text: typeof heading.heading === "string" ? heading.heading.trim() : "",
        }))
        .filter((heading) => heading.text.length > 0);
}

interface ParsedMarkdownStructure {
    headings: NoteOutlineHeading[];
    tasks: Array<{ line: number; text: string; status: string; checked: boolean }>;
    callouts: Array<{ line: number; type: string; title?: string }>;
    wikilinks: string[];
    embeds: string[];
    wikilinkTargets: ObsidianLinkTarget[];
    embedTargets: ObsidianLinkTarget[];
    tags: string[];
}

export function parseMarkdownStructure(content: string): ParsedMarkdownStructure {
    const lines = content.split(/\r?\n/).slice(0, INSPECT_NOTE_SCAN_LINES);
    const headings: NoteOutlineHeading[] = [];
    const tasks: ParsedMarkdownStructure["tasks"] = [];
    const callouts: ParsedMarkdownStructure["callouts"] = [];
    const wikilinks: string[] = [];
    const embeds: string[] = [];
    const wikilinkTargets: ObsidianLinkTarget[] = [];
    const embedTargets: ObsidianLinkTarget[] = [];
    const tags: string[] = [];
    let fence: { marker: "`" | "~"; length: number } | null = null;

    lines.forEach((line, index) => {
        const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fenceMatch) {
            const marker = fenceMatch[1][0] as "`" | "~";
            const length = fenceMatch[1].length;
            if (!fence) {
                fence = { marker, length };
            } else if (marker === fence.marker && length >= fence.length) {
                fence = null;
            }
            return;
        }
        if (fence) return;

        const heading = parseHeading(line);
        if (heading) {
            headings.push({ level: heading.level, text: heading.text.replace(/^#{1,6}\s+/, "") });
        }
        const task = line.match(/^\s*[-*+]\s+\[([^\]\r\n])\]\s+(.+)$/);
        if (task) {
            tasks.push({
                line: index + 1,
                text: truncate(task[2].trim(), FRONTMATTER_VALUE_MAX_CHARS),
                status: task[1],
                checked: task[1].toLowerCase() === "x",
            });
        }
        const callout = line.match(/^\s*>\s*\[!([^\]\s+-]+)[^\]]*\]\s*(.*)$/);
        if (callout) {
            const title = callout[2].trim();
            callouts.push({
                line: index + 1,
                type: callout[1],
                title: title ? truncate(title, FRONTMATTER_VALUE_MAX_CHARS) : undefined,
            });
        }
        for (const match of line.matchAll(/(!?)\[\[([^\]]+)]]/g)) {
            const embedded = match[1] === "!";
            const parsedTarget = parseWikiTarget(match[2], embedded);
            if (!parsedTarget) continue;
            const target = parsedTarget.path ?? "";
            if (match[1] === "!") {
                if (target) embeds.push(target);
                embedTargets.push(parsedTarget);
            } else {
                if (target) wikilinks.push(target);
                wikilinkTargets.push(parsedTarget);
            }
        }
        for (const match of line.matchAll(/(^|[\s([{])#([A-Za-z0-9_/-]+)/g)) {
            tags.push(match[2]);
        }
    });

    return {
        headings,
        tasks,
        callouts,
        wikilinks: mergeUnique(wikilinks),
        embeds: mergeUnique(embeds),
        wikilinkTargets: mergeUniqueLinkTargets(wikilinkTargets),
        embedTargets: mergeUniqueLinkTargets(embedTargets),
        tags: mergeUnique(tags),
    };
}

export function parseWikiTarget(value: string, embedded = false): ObsidianLinkTarget | null {
    const raw = value.trim();
    if (!raw) return null;
    const [targetPart, ...aliasParts] = raw.split("|");
    const alias = aliasParts.join("|").trim();
    const hashIndex = targetPart.indexOf("#");
    const path = hashIndex >= 0 ? targetPart.slice(0, hashIndex).trim() : targetPart.trim();
    const subpath = hashIndex >= 0 ? targetPart.slice(hashIndex).trim() : "";
    return {
        raw,
        path: path || undefined,
        subpath: subpath || undefined,
        alias: alias || undefined,
        embedded: embedded || undefined,
    };
}

export function extractCacheLinks(links: FileCacheLike["links"] | FileCacheLike["embeds"]): string[] {
    if (!Array.isArray(links)) return [];
    return mergeUnique(links.map((entry) => parseWikiTarget(entry.link ?? "")?.path ?? "").filter(Boolean));
}

export function extractCacheLinkTargets(
    links: FileCacheLike["links"] | FileCacheLike["embeds"],
    embedded = false,
): ObsidianLinkTarget[] {
    if (!Array.isArray(links)) return [];
    return mergeUniqueLinkTargets(links
        .map((entry) => {
            const originalTarget = parseOriginalWikiTarget(entry.original, embedded);
            if (originalTarget) return originalTarget;
            const target = parseWikiTarget(entry.link ?? "", embedded);
            if (!target) return null;
            const alias = typeof entry.displayText === "string" && entry.displayText.trim()
                ? entry.displayText.trim()
                : target.alias;
            return { ...target, alias };
        })
        .filter((target): target is ObsidianLinkTarget => target !== null));
}

export function parseOriginalWikiTarget(original: unknown, embedded: boolean): ObsidianLinkTarget | null {
    if (typeof original !== "string") return null;
    const match = original.match(/!?\[\[([^\]]+)]]/);
    if (!match) return null;
    return parseWikiTarget(match[1], embedded || original.trim().startsWith("!"));
}

export function findBacklinksForPath(
    targetPath: string,
    resolvedLinks: Record<string, Record<string, number>> | undefined,
): string[] {
    if (!resolvedLinks) return [];
    return Object.entries(resolvedLinks)
        .filter(([, targets]) => targets && typeof targets === "object" && targetPath in targets)
        .map(([sourcePath]) => sourcePath)
        .sort((a, b) => a.localeCompare(b));
}

export function buildCanvasStructureSummary(file: VaultFileLike, content: string): ReadCanvasSummaryOutput | null {
    const parsed = parseCanvasJson(content);
    if (!parsed) return null;
    const nodes = parsed.nodes.filter(isCanvasNode);
    const edges = parsed.edges.filter(isCanvasEdge);
    const nodeIds = nodes.map((node) => node.id);
    const nodeIdSet = new Set(nodeIds);
    const duplicateIds = findDuplicateValues(nodeIds);
    const connectedIds = new Set<string>();
    const danglingEdges = edges
        .filter((edge) => !nodeIdSet.has(edge.fromNode) || !nodeIdSet.has(edge.toNode))
        .map((edge) => ({
            id: edge.id,
            fromNode: nodeIdSet.has(edge.fromNode) ? undefined : edge.fromNode,
            toNode: nodeIdSet.has(edge.toNode) ? undefined : edge.toNode,
        }));
    for (const edge of edges) {
        if (nodeIdSet.has(edge.fromNode) && nodeIdSet.has(edge.toNode)) {
            connectedIds.add(edge.fromNode);
            connectedIds.add(edge.toNode);
        }
    }
    const isolatedNodes = nodeIds.filter((id) => !connectedIds.has(id));
    const groups = nodes
        .filter((node) => node.type === "group")
        .map((node) => ({
            id: node.id,
            label: typeof node.label === "string" ? truncate(node.label, FRONTMATTER_VALUE_MAX_CHARS) : undefined,
            color: typeof node.color === "string" ? node.color : undefined,
        }));
    const snippets = nodes
        .map(canvasNodeToSnippet)
        .filter((snippet): snippet is CanvasTextSnippet => snippet !== null);
    let omittedCount = 0;
    const countOmitted = (count: number) => {
        omittedCount += count;
    };
    const output: ReadCanvasSummaryOutput = {
        kind: "canvas-structure",
        path: file.path,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        duplicateIds: takeWithOmitted(duplicateIds, CANVAS_MAX_DUPLICATE_IDS, countOmitted),
        danglingEdges: takeWithOmitted(danglingEdges, CANVAS_MAX_DANGLING_EDGES, countOmitted),
        isolatedNodes: takeWithOmitted(isolatedNodes, CANVAS_MAX_ISOLATED_NODES, countOmitted),
        groups: takeWithOmitted(groups, CANVAS_MAX_GROUPS, countOmitted),
        snippets: takeWithOmitted(snippets, CANVAS_MAX_SNIPPETS, countOmitted),
    };
    if (omittedCount > 0) {
        output.truncated = true;
        output.omittedCount = omittedCount;
    }
    return output;
}

export function createUnavailableCanvasSummary(file: VaultFileLike, unavailableSource: string): ReadCanvasSummaryOutput {
    return {
        kind: "canvas-structure",
        path: file.path,
        nodeCount: 0,
        edgeCount: 0,
        unavailableSources: [unavailableSource],
        truncated: true,
        omittedCount: 1,
    };
}

export function createSkippedCanvasSummary(file: VaultFileLike, skippedSource: string): ReadCanvasSummaryOutput {
    return {
        kind: "canvas-structure",
        path: file.path,
        nodeCount: 0,
        edgeCount: 0,
        skippedSources: [skippedSource],
        truncated: true,
        omittedCount: 1,
    };
}

function parseCanvasJson(content: string): { nodes: unknown[]; edges: unknown[] } | null {
    try {
        const parsed = JSON.parse(content) as unknown;
        if (!parsed || typeof parsed !== "object") return null;
        const record = parsed as Record<string, unknown>;
        return {
            nodes: Array.isArray(record.nodes) ? record.nodes : [],
            edges: Array.isArray(record.edges) ? record.edges : [],
        };
    } catch {
        return null;
    }
}

interface CanvasNodeLike {
    id: string;
    type?: string;
    text?: string;
    label?: string;
    file?: string;
    color?: string;
}

interface CanvasEdgeLike {
    id?: string;
    fromNode: string;
    toNode: string;
}

function isCanvasNode(value: unknown): value is CanvasNodeLike {
    return Boolean(value && typeof value === "object" && typeof (value as CanvasNodeLike).id === "string");
}

function isCanvasEdge(value: unknown): value is CanvasEdgeLike {
    return Boolean(
        value
        && typeof value === "object"
        && typeof (value as CanvasEdgeLike).fromNode === "string"
        && typeof (value as CanvasEdgeLike).toNode === "string",
    );
}

function canvasNodeToSnippet(node: CanvasNodeLike): CanvasTextSnippet | null {
    const rawText = typeof node.text === "string"
        ? node.text
        : typeof node.label === "string"
            ? node.label
            : typeof node.file === "string"
                ? node.file
                : "";
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text) return null;
    return {
        id: node.id,
        type: node.type ?? "unknown",
        text: truncate(text, CANVAS_SNIPPET_MAX_CHARS),
    };
}

function findDuplicateValues(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            duplicates.add(value);
        }
        seen.add(value);
    }
    return [...duplicates].sort((a, b) => a.localeCompare(b));
}

export async function searchVaultSnippets(
    host: AiServiceHost,
    input: SearchVaultSnippetsInput,
    signal: AbortSignal | undefined,
): Promise<VaultSnippetSearchOutput> {
    if (!canReadVaultFiles(host)) {
        return {
            kind: "vault-snippets",
            query: input.query,
            scope: input.scope,
            matches: [],
            scannedFiles: 0,
            scannedBytes: 0,
            unavailableSources: [VAULT_FILE_READ_UNAVAILABLE_SOURCE],
        };
    }

    if (input.scope && !snippetScopeHasReadableMarkdown(host, input.scope)) {
        const unsupportedScope = isUnsupportedSnippetFileScope(host, input.scope);
        return {
            kind: "vault-snippets",
            query: input.query,
            scope: input.scope,
            matches: [],
            scannedFiles: 0,
            scannedBytes: 0,
            consideredFiles: 0,
            missingScope: unsupportedScope ? undefined : true,
            unsupportedScope: unsupportedScope || undefined,
            unavailableSources: [unsupportedScope ? SNIPPET_SCOPE_UNSUPPORTED_SOURCE : SNIPPET_SCOPE_UNAVAILABLE_SOURCE],
        };
    }

    const normalizedQuery = normalizeSearchText(input.query);
    const matches: VaultSnippetMatch[] = [];
    let consideredFiles = 0;
    let scannedFiles = 0;
    let scannedBytes = 0;
    let skippedFiles = 0;
    let omittedCount = 0;
    let truncated = false;

    for (const file of getMarkdownFiles(host)) {
        if (!isFileWithinSnippetScope(file.path, input.scope)) continue;
        throwIfAborted(signal);
        if (consideredFiles >= SNIPPET_MAX_CANDIDATE_FILES) {
            truncated = true;
            omittedCount++;
            break;
        }
        consideredFiles++;
        if (scannedFiles >= SNIPPET_MAX_FILES || scannedBytes >= SNIPPET_MAX_BYTES) {
            truncated = true;
            omittedCount++;
            break;
        }
        const remainingByteBudget = SNIPPET_MAX_BYTES - scannedBytes;
        const knownSize = getKnownFileSize(file);
        if (
            knownSize !== undefined
            && (knownSize > SNIPPET_MAX_FILE_BYTES || knownSize > remainingByteBudget)
        ) {
            skippedFiles++;
            truncated = true;
            omittedCount++;
            continue;
        }

        const contentBudget = Math.min(SNIPPET_MAX_FILE_BYTES, remainingByteBudget);
        const readResult = await readVaultFileWithBudget(host, file, contentBudget);
        if (readResult.skippedForSize) {
            skippedFiles++;
            truncated = true;
            omittedCount++;
            continue;
        }
        const content = readResult.content;
        scannedFiles++;
        scannedBytes += getUtf8ByteLength(content);
        if (readResult.truncated || scannedBytes > SNIPPET_MAX_BYTES) {
            truncated = true;
            omittedCount++;
        }
        const match = findSnippetMatch(file, content, normalizedQuery);
        if (!match) continue;
        if (matches.length >= input.limit) {
            truncated = true;
            omittedCount++;
            continue;
        }
        matches.push(match);
    }

    return {
        kind: "vault-snippets",
        query: input.query,
        scope: input.scope,
        matches,
        scannedFiles,
        scannedBytes,
        consideredFiles,
        skippedFiles: skippedFiles || undefined,
        skippedSources: skippedFiles > 0 ? [VAULT_FILE_READ_SKIPPED_SIZE_SOURCE] : undefined,
        truncated: truncated || undefined,
        omittedCount: omittedCount || undefined,
    };
}

function snippetScopeHasReadableMarkdown(host: AiServiceHost, scope: string): boolean {
    if (scope.toLowerCase().endsWith(".md")) {
        return Boolean(findMarkdownFileByPath(host, scope));
    }
    return getMarkdownFiles(host).some((file) => isFileWithinSnippetScope(file.path, scope));
}

function isUnsupportedSnippetFileScope(host: AiServiceHost, scope: string): boolean {
    if (scope.toLowerCase().endsWith(".md")) return false;
    const abstractFile = getVault(host).getAbstractFileByPath?.(scope);
    if (!isVaultFileLike(abstractFile)) return false;
    const extension = typeof abstractFile.extension === "string" ? abstractFile.extension.toLowerCase() : "";
    if (extension) return extension !== "md";
    return hasKnownUnsupportedFileExtension(abstractFile.path);
}

function hasKnownUnsupportedFileExtension(path: string): boolean {
    return /\.(?:canvas|txt|pdf|png|jpe?g|gif|webp|json|ya?ml|csv|tsv|js|ts|css|html?|docx?|xlsx?|pptx?|zip)$/i.test(path);
}

function isFileWithinSnippetScope(path: string, scope: string | undefined): boolean {
    if (!scope) return true;
    if (scope.toLowerCase().endsWith(".md")) {
        return path === scope;
    }
    const prefix = scope.endsWith("/") ? scope : `${scope}/`;
    return path.startsWith(prefix);
}

function findSnippetMatch(
    file: MarkdownFileLike,
    content: string,
    normalizedQuery: string,
): VaultSnippetMatch | null {
    const normalizedContent = normalizeSearchText(content);
    const index = normalizedContent.indexOf(normalizedQuery);
    if (index < 0) return null;
    const start = Math.max(0, index - SNIPPET_CONTEXT_CHARS);
    const end = Math.min(content.length, index + normalizedQuery.length + SNIPPET_CONTEXT_CHARS);
    const line = content.slice(0, index).split(/\r?\n/).length;
    const snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
    return {
        path: file.path,
        title: getFileTitle(file),
        line,
        snippet: truncate(snippet, SNIPPET_MAX_CHARS),
    };
}

export async function listVaultTags(
    host: AiServiceHost,
    limit: number,
    signal?: AbortSignal,
): Promise<VaultTagsOutput> {
    const metadataCache = getOptionalMetadataCache(host);
    if (!metadataCache || typeof metadataCache.getFileCache !== "function") {
        return {
            kind: "vault-tags",
            tags: [],
            unavailableSources: [METADATA_CACHE_UNAVAILABLE_SOURCE],
        };
    }

    const files = getMarkdownFiles(host);
    const byTag = new Map<string, { count: number; representativePaths: string[] }>();
    let scannedFiles = 0;
    for (const file of files) {
        if (scannedFiles >= TAGS_SCAN_MAX_FILES) break;
        // P0-B: cooperative cancellation + main-thread yield every TAGS_SCAN_YIELD_INTERVAL files.
        // metadataCache.getFileCache is synchronous and the vault can hold thousands of markdown files;
        // without periodic abort checks and microtask yields, a large tag scan stalls UI rendering and
        // ignores user abort until the full scan finishes.
        if (scannedFiles % TAGS_SCAN_YIELD_INTERVAL === 0 && scannedFiles > 0) {
            throwIfAborted(signal);
            await Promise.resolve();
        }
        scannedFiles++;
        const tags = collectCacheTags(metadataCache.getFileCache?.(file));
        for (const tag of tags) {
            const displayTag = tag.startsWith("#") ? tag : `#${tag}`;
            const entry = byTag.get(displayTag) ?? { count: 0, representativePaths: [] };
            entry.count++;
            if (entry.representativePaths.length < TAG_REPRESENTATIVE_PATHS) {
                entry.representativePaths.push(file.path);
            }
            byTag.set(displayTag, entry);
        }
    }
    throwIfAborted(signal);
    const skippedFiles = Math.max(0, files.length - scannedFiles);
    const allTags = [...byTag.entries()]
        .map(([tag, entry]) => ({ tag, count: entry.count, representativePaths: entry.representativePaths }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    const tags = allTags.slice(0, limit);
    return {
        kind: "vault-tags",
        tags,
        scannedFiles,
        skippedFiles: skippedFiles || undefined,
        truncated: allTags.length > limit || skippedFiles > 0 || undefined,
        omittedCount: allTags.length > limit ? allTags.length - limit : undefined,
    };
}

export function mergeUnique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const LINK_TARGET_KEY_SEPARATOR = String.fromCharCode(0);

export function mergeUniqueLinkTargets(values: ObsidianLinkTarget[]): ObsidianLinkTarget[] {
    const seen = new Set<string>();
    const result: ObsidianLinkTarget[] = [];
    for (const value of values) {
        const key = [
            value.raw,
            value.path ?? "",
            value.subpath ?? "",
            value.alias ?? "",
            value.embedded ? "embedded" : "link",
        ].join(LINK_TARGET_KEY_SEPARATOR);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}

export function takeWithOmitted<T>(values: T[], limit: number, onOmitted: (count: number) => void): T[] {
    if (values.length <= limit) return values;
    onOmitted(values.length - limit);
    return values.slice(0, limit);
}

interface ExtractedOutline {
    headings: NoteOutlineHeading[];
    outlineTruncated: boolean;
    totalHeadings: number;
}

export function extractOutlineFromCache(cache: FileCacheLike | null | undefined, maxHeadings: number): ExtractedOutline | null {
    if (!Array.isArray(cache?.headings)) return null;
    const allHeadings = cache.headings
        .map((heading) => ({
            level: normalizeHeadingLevel(heading.level),
            text: typeof heading.heading === "string" ? heading.heading.trim() : "",
        }))
        .filter((heading) => heading.text.length > 0);
    return {
        headings: allHeadings.slice(0, maxHeadings),
        outlineTruncated: allHeadings.length > maxHeadings,
        totalHeadings: allHeadings.length,
    };
}

export async function extractOutlineFromFile(
    host: AiServiceHost,
    file: MarkdownFileLike,
    maxHeadings: number,
): Promise<ExtractedOutline> {
    const content = await getVault(host).cachedRead?.(file) ?? "";
    const allLines = content.split(/\r?\n/);
    const lines = allLines.slice(0, NOTE_OUTLINE_SCAN_LINES);
    const allHeadings: NoteOutlineHeading[] = [];
    for (const line of lines) {
        const heading = parseHeading(line);
        if (heading) {
            allHeadings.push({ level: heading.level, text: heading.text.replace(/^#{1,6}\s+/, "") });
        }
    }
    return {
        headings: allHeadings.slice(0, maxHeadings),
        outlineTruncated: allLines.length > NOTE_OUTLINE_SCAN_LINES || allHeadings.length > maxHeadings,
        totalHeadings: allHeadings.length,
    };
}

export function normalizeHeadingLevel(level: unknown): number {
    return typeof level === "number" && Number.isFinite(level)
        ? Math.min(Math.max(Math.floor(level), 1), 6)
        : 1;
}

interface CurrentNoteOutline {
    headings: string[];
    outlineTruncated: boolean;
    scannedLineLimit: number;
    totalLines: number;
    maxHeadings: number;
}

export function applyOutline(output: CurrentNoteContextOutput, outline: CurrentNoteOutline): void {
    output.headings = outline.headings;
    output.outlineTruncated = outline.outlineTruncated;
    output.scannedLineLimit = outline.scannedLineLimit;
    output.totalLines = outline.totalLines;
    output.maxHeadings = outline.maxHeadings;
}

export function extractHeadingsFromEditor(editor: EditorLike): CurrentNoteOutline {
    const lineCount = getLineCount(editor);
    if (lineCount === undefined || !editor.getLine) {
        return {
            headings: [],
            outlineTruncated: false,
            scannedLineLimit: 0,
            totalLines: 0,
            maxHeadings: CURRENT_NOTE_MAX_HEADINGS,
        };
    }
    const headings: string[] = [];
    const maxScanLine = Math.min(lineCount, CURRENT_NOTE_OUTLINE_SCAN_LINES);
    for (let index = 0; index < maxScanLine && headings.length < CURRENT_NOTE_MAX_HEADINGS; index++) {
        const heading = parseHeading(editor.getLine(index));
        if (heading) {
            headings.push(heading.text);
        }
    }
    return {
        headings,
        outlineTruncated: lineCount > maxScanLine || headings.length >= CURRENT_NOTE_MAX_HEADINGS,
        scannedLineLimit: maxScanLine,
        totalLines: lineCount,
        maxHeadings: CURRENT_NOTE_MAX_HEADINGS,
    };
}

export function getHeadingSectionOrNearbyText(editor: EditorLike): string {
    const lineCount = getLineCount(editor);
    if (lineCount === undefined || !editor.getLine) return "";
    if (lineCount === 0) return "";
    const cursor = editor.getCursor?.();
    const currentLine = clampLine(cursor?.line ?? 0, lineCount);
    const section = getCurrentHeadingSection(editor, currentLine, lineCount);
    if (section) return section;

    const start = Math.max(0, currentLine - CURRENT_NOTE_NEARBY_RADIUS_LINES);
    const end = Math.min(lineCount, currentLine + CURRENT_NOTE_NEARBY_RADIUS_LINES + 1);
    return collectLinesWithinBudget(editor, start, end, CURRENT_NOTE_CONTENT_BUDGET_CHARS).trim();
}

export function getCurrentHeadingSection(editor: EditorLike, cursorLine: number, lineCount: number): string | null {
    if (!editor.getLine) return null;
    let start = -1;
    let level = 0;
    const minScanLine = Math.max(0, cursorLine - CURRENT_NOTE_HEADING_SCAN_LINES);
    for (let index = cursorLine; index >= minScanLine; index--) {
        const heading = parseHeading(editor.getLine(index));
        if (heading) {
            start = index;
            level = heading.level;
            break;
        }
    }
    if (start < 0) return null;

    let end = lineCount;
    const maxScanLine = Math.min(lineCount, start + CURRENT_NOTE_HEADING_SCAN_LINES + 1);
    for (let index = start + 1; index < maxScanLine; index++) {
        const heading = parseHeading(editor.getLine(index));
        if (heading && heading.level <= level) {
            end = index;
            break;
        }
    }
    return collectLinesWithinBudget(editor, start, end, CURRENT_NOTE_CONTENT_BUDGET_CHARS).trim();
}

export function collectLinesWithinBudget(
    editor: EditorLike,
    start: number,
    end: number,
    maxChars = CURRENT_NOTE_CONTENT_BUDGET_CHARS,
): string {
    if (!editor.getLine) return "";
    const lines: string[] = [];
    let used = 0;
    for (let index = start; index < end; index++) {
        const line = editor.getLine(index);
        const nextUsed = used + line.length + (lines.length > 0 ? 1 : 0);
        if (nextUsed > maxChars) {
            const remaining = maxChars - used;
            if (remaining > 0) {
                lines.push(line.slice(0, remaining));
            }
            break;
        }
        lines.push(line);
        used = nextUsed;
    }
    return lines.join("\n");
}

export function parseHeading(line: string): { level: number; text: string } | null {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) return null;
    return {
        level: match[1].length,
        text: `${match[1]} ${match[2].trim()}`,
    };
}

export function getLineCount(editor: EditorLike): number | undefined {
    const lineCount = editor.lineCount?.();
    return typeof lineCount === "number" && Number.isFinite(lineCount)
        ? Math.max(0, Math.floor(lineCount))
        : undefined;
}

export function clampLine(line: number, lineCount: number): number {
    if (!Number.isFinite(line)) return 0;
    return Math.min(Math.max(Math.floor(line), 0), Math.max(lineCount - 1, 0));
}

export function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
}

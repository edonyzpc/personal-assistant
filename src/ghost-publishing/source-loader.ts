import { GhostExportError } from "./errors";
import { createGhostMarkdownIt, GHOST_EMBED_TOKEN, parseGhostMarkdown } from "./markdown-parser";
import { cleanObsidianComments } from "./source-cleanup";
import { mapInlineRangeToSource } from "./source-position";
import type {
    GhostPublishingHost,
    GhostPublishingSourceFile,
    GhostPublishingSourceGuard,
    LoadedSourceTree,
    SourceDependency,
    SourceMapSpan,
} from "./types";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
const markdownIt = createGhostMarkdownIt();

interface LoadedFile {
    file: GhostPublishingSourceFile;
    markdown: string;
    body: string;
    cleanBody: string;
    cleanOffsets: number[];
    frontmatter: Record<string, unknown>;
    frontmatterLines: number;
    bodyHash: string;
}

interface SourceSelection {
    start: number;
    end: number;
    text: string;
    rawText: string;
    sourceLine: number;
    spans: Array<Omit<SourceMapSpan, "dependencyIndex" | "path">>;
}

interface ExpansionResult {
    text: string;
    spans: SourceMapSpan[];
}

interface EmbedMatch {
    start: number;
    end: number;
    target: string;
    sourceLine: number;
}

type SourceValidity = (() => boolean) | undefined;

async function sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function normalizeVaultPath(path: string): string {
    return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function joinRelativePath(fromPath: string, linkpath: string): string {
    const normalized = normalizeVaultPath(linkpath);
    if (normalized.startsWith("/")) return normalized.slice(1);
    const directory = normalizeVaultPath(fromPath).split("/").slice(0, -1).join("/");
    return directory ? `${directory}/${normalized}` : normalized;
}

function extensionOf(path: string): string {
    const name = path.split("/").pop() ?? path;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isImagePath(path: string): boolean {
    return IMAGE_EXTENSIONS.has(extensionOf(path));
}

function lineOffsets(value: string): number[] {
    const offsets = [0];
    for (let index = 0; index < value.length; index += 1) {
        if (isRawNewlineStart(value, index)) offsets.push(index + 1);
    }
    return offsets;
}

function offsetAtLine(value: string, line: number): number {
    const offsets = lineOffsets(value);
    return offsets[Math.max(0, Math.min(line, offsets.length - 1))] ?? 0;
}

function sourceLineAt(text: string, spans: SourceMapSpan[], position: number): number {
    const span = spans.find((candidate) => position >= candidate.start && position < candidate.end)
        ?? [...spans].reverse().find((candidate) => candidate.start <= position);
    if (!span) return 0;
    return span.sourceLine + countRawNewlines(text.slice(span.start, position));
}

function assertGuardCurrent(
    guard: GhostPublishingSourceGuard,
    path: string,
    action: "before-read" | "after-read" | "after-tree",
    sourceValidity: SourceValidity,
): void {
    if (!guard.isCurrent()) {
        throw new GhostExportError("guard-revoked", `Source guard is no longer current while ${action}: ${path}`, path);
    }
    if (guard.isPathAllowed(path, "task_material") !== true) {
        throw new GhostExportError("guard-revoked", `Source guard denied ${path} before ${action}.`, path);
    }
    if (guard.isNoteDomainAllowed?.() === false) {
        throw new GhostExportError("guard-revoked", `Source guard denied the note domain before ${action}: ${path}`, path);
    }
    if (sourceValidity && sourceValidity() !== true) {
        throw new GhostExportError("guard-revoked", `Source validity receipt was revoked while ${action}: ${path}`, path);
    }
}

function parseFrontmatter(markdown: string, host: GhostPublishingHost): {
    frontmatter: Record<string, unknown>;
    body: string;
    frontmatterLines: number;
} {
    const match = FRONTMATTER_PATTERN.exec(markdown);
    if (!match) return { frontmatter: {}, body: markdown, frontmatterLines: 0 };
    const yaml = match[1] ?? "";
    if (!yaml.trim()) {
        return {
            frontmatter: {},
            body: markdown.slice(match[0].length),
            frontmatterLines: match[0].split(/\r?\n/).length - 1,
        };
    }
    let parsed: unknown;
    try {
        parsed = host.parseYaml(yaml);
    } catch (error) {
        throw new GhostExportError(
            "frontmatter-invalid",
            `Invalid frontmatter: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new GhostExportError("frontmatter-invalid", "Frontmatter must be a mapping.");
    }
    return {
        frontmatter: parsed as Record<string, unknown>,
        body: markdown.slice(match[0].length),
        frontmatterLines: match[0].endsWith("\n")
            ? match[0].split(/\r?\n/).length - 1
            : match[0].split(/\r?\n/).length,
    };
}

function findFile(
    host: GhostPublishingHost,
    linkpath: string,
    sourcePath: string,
): GhostPublishingSourceFile | null {
    const normalized = normalizeVaultPath(linkpath);
    const withExtension = extensionOf(normalized) === "md" ? normalized : `${normalized}.md`;
    const candidates = [
        normalized,
        withExtension,
        joinRelativePath(sourcePath, normalized),
        joinRelativePath(sourcePath, withExtension),
    ];
    for (const candidate of candidates) {
        const resolved = host.metadataCache?.getFirstLinkpathDest?.(candidate, sourcePath)
            ?? host.vault.getAbstractFileByPath?.(candidate)
            ?? null;
        if (resolved?.extension === "md") return resolved;
    }
    return null;
}

async function loadFile(
    host: GhostPublishingHost,
    guard: GhostPublishingSourceGuard,
    path: string,
    sourceValidity: SourceValidity,
): Promise<LoadedFile> {
    assertGuardCurrent(guard, path, "before-read", sourceValidity);
    const file = host.vault.getAbstractFileByPath?.(normalizeVaultPath(path)) ?? null;
    if (!file || file.extension !== "md") {
        throw new GhostExportError("source-not-found", `Markdown source not found: ${path}`, path);
    }
    const before = file.stat ? { ...file.stat } : undefined;
    const markdown = await host.vault.read(file);
    assertGuardCurrent(guard, file.path, "after-read", sourceValidity);
    const after = host.vault.getAbstractFileByPath?.(file.path)?.stat;
    if (before && after && (before.mtime !== after.mtime || before.size !== after.size)) {
        throw new GhostExportError("source-changed", `Source changed during read: ${file.path}`, file.path);
    }
    const parsed = parseFrontmatter(markdown, host);
    const cleaned = cleanObsidianComments(parsed.body, file.path);
    return {
        file,
        markdown,
        body: parsed.body,
        cleanBody: cleaned.text,
        cleanOffsets: cleaned.sourceOffsets,
        frontmatter: parsed.frontmatter,
        frontmatterLines: parsed.frontmatterLines,
        bodyHash: await sha256(parsed.body),
    };
}

function lineStarts(value: string): number[] {
    const result = [0];
    for (let index = 0; index < value.length; index += 1) {
        if (isRawNewlineStart(value, index)) result.push(index + 1);
    }
    return result;
}

function isRawNewlineStart(value: string, index: number): boolean {
    return value[index] === "\n" || (value[index] === "\r" && value[index + 1] !== "\n");
}

function countRawNewlines(value: string): number {
    let count = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (isRawNewlineStart(value, index)) count += 1;
    }
    return count;
}

function lineAtOffset(value: string, offset: number): number {
    const starts = lineStarts(value);
    let result = 0;
    while (result + 1 < starts.length && starts[result + 1] <= offset) result += 1;
    return result;
}

function rawRangeForCleanRange(loaded: LoadedFile, start: number, end: number): { start: number; end: number } {
    if (end <= start) return { start: loaded.body.length, end: loaded.body.length };
    const rawStart = loaded.cleanOffsets[start] ?? loaded.body.length;
    const lastRaw = loaded.cleanOffsets[end - 1] ?? rawStart;
    return { start: rawStart, end: Math.max(rawStart + 1, lastRaw + 1) };
}

function cleanOffsetForRawOffset(loaded: LoadedFile, rawOffset: number): number {
    let result = 0;
    while (result < loaded.cleanOffsets.length && loaded.cleanOffsets[result] < rawOffset) result += 1;
    return result;
}

function cleanLineForRawLine(loaded: LoadedFile, rawLine: number): number {
    const starts = lineStarts(loaded.cleanBody);
    let result = 0;
    while (result + 1 < starts.length) {
        const nextRawLine = lineAtOffset(loaded.body, loaded.cleanOffsets[starts[result + 1]] ?? loaded.body.length);
        if (nextRawLine > rawLine) break;
        result += 1;
    }
    return result;
}

function selectionSpans(loaded: LoadedFile, start: number, end: number): Array<Omit<SourceMapSpan, "dependencyIndex" | "path">> {
    const result: Array<Omit<SourceMapSpan, "dependencyIndex" | "path">> = [];
    let segmentStart: number | undefined;
    let previousRaw = -2;
    for (let offset = start; offset < end; offset += 1) {
        const raw = loaded.cleanOffsets[offset];
        if (raw === undefined) break;
        if (segmentStart === undefined || raw !== previousRaw + 1) {
            if (segmentStart !== undefined) {
                result.push({
                    start: segmentStart,
                    end: offset,
                    sourceLine: loaded.frontmatterLines + lineAtOffset(loaded.body, loaded.cleanOffsets[segmentStart] ?? 0),
                });
            }
            segmentStart = offset;
        }
        previousRaw = raw;
    }
    if (segmentStart !== undefined) {
        result.push({
            start: segmentStart,
            end,
            sourceLine: loaded.frontmatterLines + lineAtOffset(loaded.body, loaded.cleanOffsets[segmentStart] ?? 0),
        });
    }
    return result;
}

function positionToBodyOffset(loaded: LoadedFile, line: number, col: number): number {
    const bodyLine = Math.max(0, line - loaded.frontmatterLines);
    return offsetAtLine(loaded.body, bodyLine) + Math.max(0, col);
}

function resolveWholeSelection(loaded: LoadedFile): SourceSelection {
    const spans = selectionSpans(loaded, 0, loaded.cleanBody.length);
    return {
        start: 0,
        end: loaded.cleanBody.length,
        text: loaded.cleanBody,
        rawText: loaded.body,
        sourceLine: loaded.frontmatterLines + (spans[0]?.sourceLine ?? 0),
        spans,
    };
}

function selectionFromCleanRange(loaded: LoadedFile, start: number, end: number): SourceSelection {
    const raw = rawRangeForCleanRange(loaded, start, end);
    const spans = selectionSpans(loaded, start, end);
    return {
        start,
        end,
        text: loaded.cleanBody.slice(start, end),
        rawText: loaded.body.slice(raw.start, raw.end),
        sourceLine: loaded.frontmatterLines + (spans[0]?.sourceLine ?? lineAtOffset(loaded.body, raw.start)),
        spans,
    };
}

function resolveHeadingSelection(
    host: GhostPublishingHost,
    loaded: LoadedFile,
    heading: string,
): SourceSelection {
    const lines = loaded.cleanBody.split(/\r\n|\r|\n/);
    interface SnapshotHeading {
        line: number;
        endLine: number;
        level: number;
        text: string;
    }
    const tokens = parseGhostMarkdown(markdownIt, loaded.cleanBody);
    const headings: SnapshotHeading[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type !== "heading_open" || !token.map) continue;
        const inline = tokens[index + 1];
        headings.push({
            line: token.map[0] ?? 0,
            endLine: token.map[1] ?? (token.map[0] ?? 0) + 1,
            level: Number((token.tag || "h6").slice(1)),
            text: (inline?.content ?? "").trim(),
        });
    }
    for (let index = 0; index < headings.length; index += 1) {
        const current = headings[index];
        current.endLine = lines.length;
        for (let next = index + 1; next < headings.length; next += 1) {
            if (headings[next].level <= current.level) {
                current.endLine = headings[next].line;
                break;
            }
        }
    }
    const wanted = heading.trim().toLowerCase();
    const cache = host.metadataCache?.getFileCache?.(loaded.file);
    const resolved = host.resolveSubpath?.(cache ?? {}, `#${heading}`);
    const metadataLine = resolved?.type === "heading"
        ? resolved.start.line - loaded.frontmatterLines
        : undefined;
    const matching = headings.filter((candidate) => {
        if (candidate.text.toLowerCase() !== wanted) return false;
        if (metadataLine === undefined) return true;
        const cleanStart = offsetAtLine(loaded.cleanBody, candidate.line);
        const rawLine = lineAtOffset(loaded.body, loaded.cleanOffsets[cleanStart] ?? loaded.body.length);
        return rawLine === metadataLine;
    });
    const headingSnapshot = metadataLine === undefined
        ? matching[0]
        : matching.find((candidate) => candidate.line === metadataLine) ?? matching[0];
    if (!headingSnapshot) {
        throw new GhostExportError("embed-subpath-not-found", `Heading not found: #${heading}`, loaded.file.path);
    }
    const headingIndex = headingSnapshot.line;
    const endIndex = headingSnapshot.endLine;
    const start = offsetAtLine(loaded.cleanBody, headingIndex);
    const end = endIndex < lines.length ? offsetAtLine(loaded.cleanBody, endIndex) : loaded.cleanBody.length;
    const selection = selectionFromCleanRange(loaded, start, end);
    return {
        ...selection,
        text: selection.text.replace(/\s+$/, ""),
        rawText: selection.rawText.replace(/\s+$/, ""),
        sourceLine: loaded.frontmatterLines + lineAtOffset(loaded.body, rawRangeForCleanRange(loaded, start, start).start),
    };
}

function stripBlockMarker(text: string, blockId: string): string {
    return text.replace(/\s+$/, "").replace(
        new RegExp(`\\s+\\^${blockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        "",
    );
}

function resolveBlockSelection(
    host: GhostPublishingHost,
    loaded: LoadedFile,
    blockId: string,
): SourceSelection {
    const lines = loaded.cleanBody.split(/\r\n|\r|\n/);
    const marker = `^${blockId}`;
    let index = lines.findIndex((line) => line.trimEnd().endsWith(marker));
    let endIndex = index + 1;

    const cache = host.metadataCache?.getFileCache?.(loaded.file);
    const resolved = host.resolveSubpath?.(cache ?? {}, `#^${blockId}`);
    if (resolved?.type === "block") {
        const candidate = cleanLineForRawLine(loaded, resolved.start.line - loaded.frontmatterLines);
        const resolvedEnd = resolved.end
            ? cleanLineForRawLine(loaded, resolved.end.line - loaded.frontmatterLines)
            : lines.length;
        const snapshotRange = lines.slice(candidate, Math.max(candidate + 1, resolvedEnd + 1)).join("\n");
        if (candidate >= 0
            && candidate < lines.length
            && snapshotRange.includes(marker)) {
            index = candidate;
            if (resolved.end) {
                const start = offsetAtLine(loaded.cleanBody, index);
                const rawEnd = positionToBodyOffset(loaded, resolved.end.line, resolved.end.col);
                const end = Math.max(start + 1, cleanOffsetForRawOffset(loaded, rawEnd));
                const selection = selectionFromCleanRange(loaded, start, end);
                return {
                    ...selection,
                    text: stripBlockMarker(selection.text, blockId),
                    rawText: stripBlockMarker(selection.rawText, blockId),
                };
            }
            endIndex = candidate + 1;
        }
    }
    if (index < 0) {
        throw new GhostExportError("embed-subpath-not-found", `Block not found: #^${blockId}`, loaded.file.path);
    }
    while (endIndex < lines.length && lines[endIndex]?.trim() !== "") endIndex += 1;
    const start = offsetAtLine(loaded.cleanBody, index);
    const end = endIndex < lines.length ? offsetAtLine(loaded.cleanBody, endIndex) : loaded.cleanBody.length;
    const selection = selectionFromCleanRange(loaded, start, end);
    return {
        ...selection,
        text: stripBlockMarker(selection.text, blockId),
        rawText: stripBlockMarker(selection.rawText, blockId),
    };
}

function resolveSelection(
    host: GhostPublishingHost,
    loaded: LoadedFile,
    subpath: "" | "heading" | "block",
    subpathValue?: string,
): SourceSelection {
    if (subpath === "") return resolveWholeSelection(loaded);
    if (subpath === "heading") return resolveHeadingSelection(host, loaded, subpathValue ?? "");
    return resolveBlockSelection(host, loaded, subpathValue ?? "");
}

function firstNoteEmbed(text: string): EmbedMatch | null {
    const tokens = parseGhostMarkdown(markdownIt, text);
    for (const token of tokens) {
        if (token.type !== "inline") continue;
        for (const child of token.children ?? []) {
            if (child.type !== GHOST_EMBED_TOKEN) continue;
            const meta = child.meta as {
                target?: string;
                rawStart?: number;
                rawEnd?: number;
            } | null | undefined;
            const target = meta?.target?.split("|")[0] ?? "";
            if (!target
                || isImagePath(target)
                || typeof meta?.rawStart !== "number"
                || typeof meta.rawEnd !== "number") continue;
            const sourceRange = mapInlineRangeToSource(token, {
                rawStart: meta.rawStart,
                rawEnd: meta.rawEnd,
            });
            const start = sourceRange.rawStart;
            const before = text.slice(0, start);
            const sourceLine = before.length - before.lastIndexOf("\n") - 1;
            return { start, end: sourceRange.rawEnd, target, sourceLine };
        }
    }
    return null;
}


function splitEmbedTarget(target: string): { linkpath: string; subpath: "" | "heading" | "block"; subpathValue?: string } {
    const hashIndex = target.indexOf("#");
    if (hashIndex < 0) return { linkpath: target.trim(), subpath: "" };
    const linkpath = target.slice(0, hashIndex).trim();
    const subpath = target.slice(hashIndex + 1).trim();
    if (!subpath) return { linkpath, subpath: "" };
    if (subpath.startsWith("^")) return { linkpath, subpath: "block", subpathValue: subpath.slice(1) };
    return { linkpath, subpath: "heading", subpathValue: subpath };
}

function replaceRange(
    text: string,
    spans: SourceMapSpan[],
    start: number,
    end: number,
    replacement: string,
    replacementSpans: SourceMapSpan[],
): { text: string; spans: SourceMapSpan[] } {
    const delta = replacement.length - (end - start);
    const output: SourceMapSpan[] = [];
    for (const span of spans) {
        if (span.end <= start) output.push(span);
        else if (span.start >= end) {
            output.push({ ...span, start: span.start + delta, end: span.end + delta });
        } else {
            if (span.start < start) output.push({ ...span, end: start });
            if (span.end > end) {
                output.push({
                    ...span,
                    start: end + delta,
                    end: span.end + delta,
                    sourceLine: sourceLineAt(text, spans, end),
                });
            }
        }
    }
    output.push(...replacementSpans.map((span) => ({
        ...span,
        start: span.start + start,
        end: span.end + start,
    })));
    return {
        text: text.slice(0, start) + replacement + text.slice(end),
        spans: output.filter((span) => span.end > span.start).sort((a, b) => a.start - b.start || a.end - b.end),
    };
}

export async function loadGhostSourceTree(
    targetPath: string,
    host: GhostPublishingHost,
    guard: GhostPublishingSourceGuard | undefined,
): Promise<LoadedSourceTree> {
    if (!guard) {
        throw new GhostExportError("missing-guard", "A current task source guard is required.", targetPath);
    }
    assertGuardCurrent(guard, targetPath, "before-read", undefined);
    const sourceValidity = guard.captureSourceValidity?.() ?? (() => true);
    if (sourceValidity && sourceValidity() !== true) {
        throw new GhostExportError("guard-revoked", "Source validity could not be captured.", targetPath);
    }

    const main = await loadFile(host, guard, targetPath, sourceValidity);
    const mainBefore = main.file.stat ? { ...main.file.stat } : undefined;
    const dependencies: SourceDependency[] = [{
        path: main.file.path,
        kind: "main",
        subpath: "",
        contentHash: main.bodyHash,
        mtime: main.file.stat?.mtime,
        size: main.file.stat?.size,
    }];
    const expanded = await expandSelection(
        main,
        resolveWholeSelection(main),
        host,
        guard,
        sourceValidity,
        new Set([main.file.path]),
        dependencies,
        0,
        new Map(),
    );

    const mainAfter = host.vault.getAbstractFileByPath?.(main.file.path)?.stat;
    if (mainBefore && mainAfter
        && (mainBefore.mtime !== mainAfter.mtime || mainBefore.size !== mainAfter.size)) {
        throw new GhostExportError("source-changed", `Main source changed during embed reads: ${main.file.path}`, main.file.path);
    }
    for (const dependency of dependencies) {
        assertGuardCurrent(guard, dependency.path, "after-tree", sourceValidity);
    }
    if (sourceValidity && sourceValidity() !== true) {
        throw new GhostExportError("guard-revoked", "Source validity receipt was revoked after export.", main.file.path);
    }
    return {
        targetPath: main.file.path,
        markdown: expanded.text,
        frontmatter: main.frontmatter,
        dependencies,
        sourceMap: expanded.spans,
        sourceValidity,
    };
}

async function expandSelection(
    loaded: LoadedFile,
    selection: SourceSelection,
    host: GhostPublishingHost,
    guard: GhostPublishingSourceGuard,
    sourceValidity: SourceValidity,
    activePaths: ReadonlySet<string>,
    dependencies: SourceDependency[],
    dependencyIndex: number,
    expansionCache: Map<string, ExpansionResult>,
): Promise<ExpansionResult> {
    let text = selection.text;
    const replacementBase = selection.spans[0]?.start ?? 0;
    let spans: SourceMapSpan[] = selection.spans.map(span => ({
        ...span,
        start: span.start - replacementBase,
        end: span.end - replacementBase,
        path: loaded.file.path,
        dependencyIndex,
    }));
    let match = firstNoteEmbed(text);
    while (match) {
        const originalSourceLine = sourceLineAt(text, spans, match.start);
        const parsedTarget = splitEmbedTarget(match.target);
        const embeddedFile = findFile(host, parsedTarget.linkpath, loaded.file.path);
        if (!embeddedFile || embeddedFile.extension !== "md") {
            throw new GhostExportError(
                "embed-not-found",
                `Embedded note not found: ${match.target}`,
                loaded.file.path,
                originalSourceLine + 1,
            );
        }
        if (activePaths.has(embeddedFile.path)) {
            throw new GhostExportError(
                "embed-cycle",
                `Explicit embed cycle includes ${match.target}`,
                loaded.file.path,
                originalSourceLine + 1,
            );
        }
        const cacheKey = `${embeddedFile.path}#${parsedTarget.subpath}:${parsedTarget.subpathValue ?? ""}`;
        let childExpansion = expansionCache.get(cacheKey);
        if (!childExpansion) {
            const childLoaded = await loadFile(host, guard, embeddedFile.path, sourceValidity);
            const childSelection = resolveSelection(host, childLoaded, parsedTarget.subpath, parsedTarget.subpathValue);
            const childDependencyIndex = dependencies.length;
            dependencies.push({
                path: childLoaded.file.path,
                kind: "embed",
                subpath: parsedTarget.subpath,
                subpathValue: parsedTarget.subpathValue,
                contentHash: "",
                mtime: childLoaded.file.stat?.mtime,
                size: childLoaded.file.stat?.size,
            });
            childExpansion = await expandSelection(
                childLoaded,
                childSelection,
                host,
                guard,
                sourceValidity,
                new Set([...activePaths, childLoaded.file.path]),
                dependencies,
                childDependencyIndex,
                expansionCache,
            );
            dependencies[childDependencyIndex].contentHash = await sha256(childSelection.rawText);
            expansionCache.set(cacheKey, childExpansion);
        }
        const replaced = replaceRange(text, spans, match.start, match.end, childExpansion.text, childExpansion.spans);
        text = replaced.text;
        spans = replaced.spans;
        match = firstNoteEmbed(text);
    }
    return { text, spans };
}

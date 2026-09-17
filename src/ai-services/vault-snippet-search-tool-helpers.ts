import { getFrontMatterInfo } from "obsidian";

import { computeContentHash } from "../vss-helpers";
import {
    OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
    type SearchVaultSnippetPart,
    type VaultSnippetMatch,
    type VaultSnippetPage,
    type VaultSnippetRange,
    type VaultSnippetSearchOutput,
    type SearchVaultSnippetsInput,
} from "./chat-tool-types";
import {
    SNIPPET_CONTEXT_CHARS,
    SNIPPET_MAX_BYTES,
    SNIPPET_MAX_CANDIDATE_FILES,
    SNIPPET_MAX_CHARS,
    SNIPPET_MAX_FILE_BYTES,
    SNIPPET_MAX_FILES,
    SNIPPET_SCOPE_UNAVAILABLE_SOURCE,
    SNIPPET_SCOPE_UNSUPPORTED_SOURCE,
    VAULT_FILE_READ_SKIPPED_SIZE_SOURCE,
    VAULT_FILE_READ_UNAVAILABLE_SOURCE,
    VAULT_FILE_STAT_UNAVAILABLE_SOURCE,
} from "./chat-tool-constants";
import {
    canReadVaultFiles,
    getFileTitle,
    getKnownFileSize,
    getUtf8ByteLength,
    readVaultFile,
} from "./chat-tool-execution-helpers";
import type { AiServiceHost } from "./AiServiceHost";
import type { MarkdownFileLike } from "./chat-tool-execution-helpers";
import { throwIfAborted } from "./chat-utils";

export class VaultSnippetSearchUnavailableError extends Error { }
export class VaultSnippetCursorExpiredError extends Error { }
export class VaultSnippetResultBudgetUnavailableError extends Error { }
export class VaultSnippetSourcesChangedError extends VaultSnippetSearchUnavailableError { }

interface VaultSnippetFileStat {
    mtime: number;
    size: number;
}

interface VaultSnippetLineSpan {
    start: number;
    endIncludingBreak: number;
    line: number;
}

interface VaultSnippetPartView {
    part: Exclude<SearchVaultSnippetPart, "all">;
    start: number;
    end: number;
    text: string;
}

interface VaultSnippetSnapshotItem {
    path: string;
    identity: string;
    stat?: VaultSnippetFileStat;
    state: "read" | "unknown-size" | "skipped-size";
    contentHash?: string;
}

interface VaultSnippetSourceIdentityCapture {
    file: MarkdownFileLike;
    path: string;
    identity: string;
}

interface VaultSnippetCursor {
    version: 1;
    instance: string;
    query: string;
    snapshot: string;
    nextIndex: number;
}

export interface VaultSnippetIdentityRegistry {
    identity(file: object): string;
}

export class SequentialVaultSnippetIdentityRegistry implements VaultSnippetIdentityRegistry {
    private readonly identities = new WeakMap<object, string>();
    private nextSequence = 0;

    constructor(private readonly instancePrefix: string) { }

    identity(file: object): string {
        const existing = this.identities.get(file);
        if (existing) return existing;
        const identity = `${this.instancePrefix}-file-${++this.nextSequence}`;
        this.identities.set(file, identity);
        return identity;
    }
}

export interface ExecuteVaultSnippetSearchOptions {
    input: SearchVaultSnippetsInput;
    host: AiServiceHost;
    instancePrefix: string;
    identities: VaultSnippetIdentityRegistry;
    signal: AbortSignal | undefined;
    dependencyPaths: Set<string>;
    isPathReadable: (path: string) => boolean;
    assertCurrent: () => void;
}

export interface ExecuteVaultSnippetSearchResult {
    content: VaultSnippetSearchOutput;
    matchPaths: string[];
    evidence: {
        candidatePaths: string[];
        scannedVersions: unknown[];
    };
}

export async function executeVaultSnippetSearch(
    options: ExecuteVaultSnippetSearchOptions,
): Promise<ExecuteVaultSnippetSearchResult> {
    const { input, host, signal } = options;
    const part = input.part ?? "all";
    const caseSensitive = input.caseSensitive ?? false;
    const scopedFiles = enumerateScopedFiles(host, input.scope);
    const files = scopedFiles.filter(file => options.isPathReadable(file.path));
    if (input.scope && files.length === 0 && !hasScopedFile(host, input.scope)) {
        const unsupportedScope = isUnsupportedSnippetFileScope(host, input.scope);
        return {
            content: {
                kind: "vault-snippets",
                query: input.query,
                scope: input.scope,
                part,
                caseSensitive,
                matches: [],
                matchCount: 0,
                matchCountKind: "exact",
                page: makePage(0, 0, input.limit, false),
                coverage: makeCoverage(),
                scannedFiles: 0,
                scannedBytes: 0,
                consideredFiles: 0,
                missingScope: unsupportedScope ? undefined : true,
                unsupportedScope: unsupportedScope || undefined,
                unavailableSources: [
                    unsupportedScope
                        ? SNIPPET_SCOPE_UNSUPPORTED_SOURCE
                        : SNIPPET_SCOPE_UNAVAILABLE_SOURCE,
                ],
            },
            matchPaths: [],
            evidence: { candidatePaths: [], scannedVersions: [] },
        };
    }

    if (!canReadVaultFiles(host)) {
        return unavailableResult(input, part, caseSensitive, files);
    }

    const queryDigest = await hashJsonValue({
        query: input.query,
        scope: input.scope ?? "",
        part,
        caseSensitive,
    });
    const cursor = input.cursor ? decodeVaultSnippetCursor(input.cursor) : null;
    if (input.cursor && !cursor) {
        throw new VaultSnippetCursorExpiredError("search_vault_snippets cursor is invalid.");
    }
    if (cursor && cursor.instance !== options.instancePrefix) {
        throw new VaultSnippetCursorExpiredError("search_vault_snippets cursor targets a different tool instance.");
    }
    if (cursor && cursor.query !== queryDigest) {
        throw new VaultSnippetCursorExpiredError("search_vault_snippets cursor targets a different query or scope.");
    }

    const pageStartIndex = cursor?.nextIndex ?? 0;
    if (pageStartIndex < 0 || !Number.isInteger(pageStartIndex)) {
        throw new VaultSnippetCursorExpiredError("search_vault_snippets cursor has an invalid next index.");
    }

    const matcher = createLiteralMatcher(input.query, caseSensitive);
    const sourceIdentities: VaultSnippetSourceIdentityCapture[] = files.map(file => ({
        file,
        path: file.path,
        identity: options.identities.identity(file),
    }));
    const snapshot: VaultSnippetSnapshotItem[] = [];
    const sourceCaptures: Array<{
        file: MarkdownFileLike;
        path: string;
        stat: VaultSnippetFileStat | null;
    }> = [];
    const pageMatches: VaultSnippetMatch[] = [];
    const skippedSources = new Set<string>();
    let consideredFiles = 0;
    let readNotes = 0;
    let readBytes = 0;
    let evaluatedBytes = 0;
    let skippedFiles = 0;
    let omittedCount = 0;
    let matchCount = 0;
    let candidateCapExceeded = false;
    let fileCapExceeded = false;
    let byteCapExceeded = false;
    let unknownFileSize = false;

    for (const file of files) {
        throwIfAborted(signal);
        options.assertCurrent();
        if (consideredFiles >= SNIPPET_MAX_CANDIDATE_FILES) {
            candidateCapExceeded = true;
            omittedCount++;
            break;
        }
        consideredFiles++;
        options.dependencyPaths.add(file.path);
        const identity = options.identities.identity(file);
        const stat = captureStat(file);
        const capturedPath = file.path;
        const captureSource = (state: VaultSnippetSnapshotItem["state"], contentHash?: string) => {
            snapshot.push({
                path: capturedPath,
                identity,
                ...(stat ? { stat } : {}),
                state,
                ...(contentHash ? { contentHash } : {}),
            });
            sourceCaptures.push({ file, path: capturedPath, stat });
        };
        if (!stat) {
            const knownSize = getKnownFileSize(file);
            if (knownSize !== undefined
                && (knownSize > SNIPPET_MAX_FILE_BYTES || knownSize > SNIPPET_MAX_BYTES - evaluatedBytes)) {
                skippedFiles++;
                omittedCount++;
                skippedSources.add(VAULT_FILE_READ_SKIPPED_SIZE_SOURCE);
                captureSource("skipped-size");
            } else {
                unknownFileSize = true;
                skippedFiles++;
                omittedCount++;
                skippedSources.add(VAULT_FILE_STAT_UNAVAILABLE_SOURCE);
                captureSource("unknown-size");
            }
            continue;
        }

        const remainingByteBudget = SNIPPET_MAX_BYTES - readBytes;
        if (readNotes >= SNIPPET_MAX_FILES || remainingByteBudget <= 0) {
            if (readNotes >= SNIPPET_MAX_FILES) fileCapExceeded = true;
            if (remainingByteBudget <= 0) byteCapExceeded = true;
            skippedFiles++;
            omittedCount++;
            skippedSources.add(VAULT_FILE_READ_SKIPPED_SIZE_SOURCE);
            captureSource("skipped-size");
            continue;
        }
        if (
            stat.size > SNIPPET_MAX_FILE_BYTES
            || stat.size > remainingByteBudget
            || remainingByteBudget < SNIPPET_MAX_FILE_BYTES
        ) {
            skippedFiles++;
            omittedCount++;
            skippedSources.add(VAULT_FILE_READ_SKIPPED_SIZE_SOURCE);
            captureSource("skipped-size");
            continue;
        }

        const content = await readVaultFile(host, file);
        throwIfAborted(signal);
        options.assertCurrent();
        assertFileCurrent(options, file, stat);
        const actualBytes = getUtf8ByteLength(content);
        readNotes++;
        readBytes += actualBytes;
        if (actualBytes > SNIPPET_MAX_FILE_BYTES || actualBytes > SNIPPET_MAX_BYTES - readBytes) {
            byteCapExceeded = true;
            omittedCount++;
            skippedFiles++;
            skippedSources.add(VAULT_FILE_READ_SKIPPED_SIZE_SOURCE);
            captureSource("skipped-size");
            continue;
        }

        evaluatedBytes += actualBytes;
        const contentHash = await computeContentHash(content);
        throwIfAborted(signal);
        options.assertCurrent();
        assertFileCurrent(options, file, stat);
        captureSource("read", contentHash);

        const lineSpans = buildLineSpans(content);
        for (const partView of getSearchPartViews(content, part)) {
            matcher.lastIndex = 0;
            let match = matcher.exec(partView.text);
            while (match) {
                const originalStart = partView.start + match.index;
                const originalEnd = originalStart + match[0].length;
                if (matchCount >= pageStartIndex && pageMatches.length < input.limit) {
                    pageMatches.push(makeMatch(
                        file,
                        partView,
                        originalStart,
                        originalEnd,
                        contentHash,
                        lineSpans,
                        content,
                    ));
                }
                matchCount++;
                matcher.lastIndex = match.index + match[0].length;
                match = matcher.exec(partView.text);
            }
        }
    }

    throwIfAborted(signal);
    options.assertCurrent();
    assertSourceSetCurrent(options, sourceIdentities, sourceCaptures, input.scope);
    for (const path of options.dependencyPaths) {
        if (!options.isPathReadable(path)) {
            throw new VaultSnippetSourcesChangedError("Task source path is no longer permitted.");
        }
    }

    const scanComplete = !candidateCapExceeded && !fileCapExceeded && !byteCapExceeded
        && !unknownFileSize && skippedFiles === 0;
    const snapshotDigest = await hashJsonValue(snapshot);
    throwIfAborted(signal);
    options.assertCurrent();
    assertSourceSetCurrent(options, sourceIdentities, sourceCaptures, input.scope);
    if (cursor && cursor.snapshot !== snapshotDigest) {
        throw new VaultSnippetCursorExpiredError("search_vault_snippets cursor snapshot is no longer current.");
    }
    if (cursor && pageStartIndex > matchCount) {
        throw new VaultSnippetCursorExpiredError("search_vault_snippets cursor points beyond the current matches.");
    }

    const coverage = makeCoverage({
        scannedPermittedNotes: files.length,
        evaluatedCandidates: consideredFiles,
        readNotes,
        readBytes,
        evaluatedBytes,
        skippedFiles: skippedFiles || undefined,
        candidateCapExceeded: candidateCapExceeded || undefined,
        fileCapExceeded: fileCapExceeded || undefined,
        byteCapExceeded: byteCapExceeded || undefined,
        unknownFileSize: unknownFileSize || undefined,
        state: scanComplete ? "complete" : "partial",
    });

    const content = fitResultToBudget({
            query: input.query,
            scope: input.scope,
            part,
            caseSensitive,
            matches: pageMatches,
            matchCount,
            matchCountKind: scanComplete ? "exact" : "lower-bound",
            pageStartIndex,
            requestedLimit: input.limit,
            scanComplete,
            snapshotDigest,
            queryDigest,
            instancePrefix: options.instancePrefix,
            coverage,
            skippedSources: [...skippedSources],
            scannedFiles: readNotes,
            scannedBytes: evaluatedBytes,
            consideredFiles,
            skippedFiles: skippedFiles || undefined,
            truncated: scanComplete ? undefined : true,
            omittedCount: omittedCount || undefined,
    });
    return {
        content,
        matchPaths: content.matches.map(match => match.path),
        evidence: {
            candidatePaths: files.map(file => file.path),
            scannedVersions: snapshot.map(({ identity: _identity, stat: _stat, ...version }) => version),
        },
    };
}

function unavailableResult(
    input: SearchVaultSnippetsInput,
    part: SearchVaultSnippetPart,
    caseSensitive: boolean,
    files: readonly MarkdownFileLike[],
): ExecuteVaultSnippetSearchResult {
    return {
        content: {
            kind: "vault-snippets",
            query: input.query,
            scope: input.scope,
            part,
            caseSensitive,
            matches: [],
            matchCount: 0,
            matchCountKind: "lower-bound",
            page: makePage(0, 0, input.limit, false),
            coverage: makeCoverage({
                state: "partial",
                scannedPermittedNotes: files.length,
            }),
            scannedFiles: 0,
            scannedBytes: 0,
            consideredFiles: 0,
            unavailableSources: [VAULT_FILE_READ_UNAVAILABLE_SOURCE],
        },
        matchPaths: [],
        evidence: { candidatePaths: [], scannedVersions: [] },
    };
}

export function enumerateScopedFiles(
    host: AiServiceHost,
    scope: string | undefined,
    isPathAllowed?: (path: string) => boolean,
): MarkdownFileLike[] {
    const vault = host.app.vault as unknown as {
        getMarkdownFiles?: () => unknown;
    };
    if (typeof vault.getMarkdownFiles !== "function") {
        throw new VaultSnippetSearchUnavailableError("Vault getMarkdownFiles is unavailable.");
    }
    const files = vault.getMarkdownFiles();
    if (!Array.isArray(files)) {
        throw new VaultSnippetSearchUnavailableError("Vault getMarkdownFiles returned an invalid file list.");
    }
    const scoped = files.filter((file): file is MarkdownFileLike => {
        if (!file || typeof file !== "object" || typeof (file as MarkdownFileLike).path !== "string") return false;
        if (isPathAllowed && !isPathAllowed(file.path)) return false;
        return isFileWithinScope((file as MarkdownFileLike).path, scope);
    });
    const byPath = new Map<string, MarkdownFileLike>();
    for (const file of scoped) {
        if (!byPath.has(file.path)) byPath.set(file.path, file);
    }
    return [...byPath.values()].sort((left, right) => comparePaths(left.path, right.path));
}

function hasScopedFile(host: AiServiceHost, scope: string): boolean {
    if (scope.toLowerCase().endsWith(".md")) {
        const file = host.app.vault.getAbstractFileByPath?.(scope);
        return Boolean(file && typeof file === "object" && typeof (file as MarkdownFileLike).path === "string");
    }
    return enumerateScopedFiles(host, scope).length > 0;
}

function isUnsupportedSnippetFileScope(host: AiServiceHost, scope: string): boolean {
    if (scope.toLowerCase().endsWith(".md")) return false;
    const file = host.app.vault.getAbstractFileByPath?.(scope);
    if (!file || typeof file !== "object") return false;
    const path = (file as MarkdownFileLike).path;
    const extension = typeof (file as MarkdownFileLike).extension === "string"
        ? (file as MarkdownFileLike).extension!.toLowerCase()
        : "";
    if (extension) return extension !== "md";
    return /\.(?:canvas|txt|pdf|png|jpe?g|gif|webp|json|ya?ml|csv|tsv|js|ts|css|html?|docx?|xlsx?|pptx?|zip)$/i.test(path);
}

function isFileWithinScope(path: string, scope: string | undefined): boolean {
    if (!scope) return true;
    if (scope.toLowerCase().endsWith(".md")) return path === scope;
    const prefix = scope.endsWith("/") ? scope : `${scope}/`;
    return path.startsWith(prefix);
}

export function captureVaultSnippetStat(file: MarkdownFileLike): VaultSnippetFileStat | null {
    return captureStat(file);
}

function captureStat(file: MarkdownFileLike): VaultSnippetFileStat | null {
    const { mtime, size } = file.stat ?? {};
    if (typeof mtime !== "number" || !Number.isFinite(mtime)
        || typeof size !== "number" || !Number.isFinite(size) || size < 0) {
        return null;
    }
    return { mtime, size };
}

function assertFileCurrent(
    options: ExecuteVaultSnippetSearchOptions,
    file: MarkdownFileLike,
    stat: VaultSnippetFileStat,
): void {
    if (!options.isPathReadable(file.path)) {
        throw new VaultSnippetSourcesChangedError("Task source path is no longer permitted.");
    }
    const current = enumerateScopedFiles(options.host, undefined).find(candidate => candidate.path === file.path);
    const currentStat = current ? captureStat(current) : null;
    if (current !== file || current?.path !== file.path || !currentStat
        || currentStat.mtime !== stat.mtime || currentStat.size !== stat.size) {
        throw new VaultSnippetSourcesChangedError("Note sources changed while snippets were being searched.");
    }
}

function assertSourceSetCurrent(
    options: ExecuteVaultSnippetSearchOptions,
    identities: ReadonlyArray<VaultSnippetSourceIdentityCapture>,
    captures: ReadonlyArray<{
        file: MarkdownFileLike;
        path: string;
        stat: VaultSnippetFileStat | null;
    }>,
    scope: string | undefined,
): void {
    const currentFiles = enumerateScopedFiles(options.host, scope);
    if (currentFiles.length !== identities.length) {
        throw new VaultSnippetSourcesChangedError("The permitted note集合 changed while snippets were being searched.");
    }
    for (let index = 0; index < identities.length; index++) {
        const expected = identities[index]!;
        const actual = currentFiles[index]!;
        if (
            actual !== expected.file
            || actual.path !== expected.path
            || options.identities.identity(actual) !== expected.identity
        ) {
            throw new VaultSnippetSourcesChangedError("Note sources changed while snippets were being searched.");
        }
    }

    for (const expected of captures) {
        const actual = currentFiles.find(candidate => candidate.path === expected.path);
        if (!actual) {
            throw new VaultSnippetSourcesChangedError("Note sources changed while snippets were being searched.");
        }
        const actualStat = captureStat(actual);
        const sameStat = expected.stat && actualStat
            ? expected.stat.mtime === actualStat.mtime && expected.stat.size === actualStat.size
            : expected.stat === actualStat;
        if (
            actual !== expected.file
            || actual.path !== expected.path
            || !sameStat
        ) {
            throw new VaultSnippetSourcesChangedError("Note sources changed while snippets were being searched.");
        }
    }
}

export function createVaultSnippetMatcher(query: string, caseSensitive: boolean): RegExp {
    return createLiteralMatcher(query, caseSensitive);
}

function createLiteralMatcher(query: string, caseSensitive: boolean): RegExp {
    const escaped = query.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    return new RegExp(escaped, caseSensitive ? "gu" : "giu");
}

export function getVaultSnippetSearchPartViews(
    content: string,
    requestedPart: SearchVaultSnippetPart,
): Array<{ part: Exclude<SearchVaultSnippetPart, "all">; start: number; end: number; text: string }> {
    return getSearchPartViews(content, requestedPart);
}

function getSearchPartViews(content: string, requestedPart: SearchVaultSnippetPart): VaultSnippetPartView[] {
    const info = getFrontMatterInfo(content);
    if (requestedPart === "properties") {
        return info.exists
            ? [{
                part: "properties",
                start: info.from,
                end: info.to,
                text: content.slice(info.from, info.to),
            }]
            : [];
    }
    if (requestedPart === "body") {
        return [{
            part: "body",
            start: info.exists ? info.contentStart : 0,
            end: content.length,
            text: content.slice(info.exists ? info.contentStart : 0),
        }];
    }
    return [
        ...(info.exists ? [{
            part: "properties" as const,
            start: info.from,
            end: info.to,
            text: content.slice(info.from, info.to),
        }] : []),
        {
            part: "body" as const,
            start: info.exists ? info.contentStart : 0,
            end: content.length,
            text: content.slice(info.exists ? info.contentStart : 0),
        },
    ];
}

function buildLineSpans(content: string): VaultSnippetLineSpan[] {
    const spans: VaultSnippetLineSpan[] = [];
    const lineBreak = /\r\n|\r|\n/g;
    let start = 0;
    let line = 1;
    let match: RegExpExecArray | null;
    while ((match = lineBreak.exec(content)) !== null) {
        spans.push({ start, endIncludingBreak: match.index + match[0].length, line });
        start = spans[spans.length - 1]!.endIncludingBreak;
        line++;
    }
    spans.push({ start, endIncludingBreak: content.length, line });
    return spans;
}

function describeRange(
    lineSpans: readonly VaultSnippetLineSpan[],
    start: number,
    end: number,
): VaultSnippetRange {
    const startSpan = lineSpans.find(span => start < span.endIncludingBreak)
        ?? lineSpans[lineSpans.length - 1]!;
    const endSpan = lineSpans.find(span => end <= span.endIncludingBreak)
        ?? lineSpans[lineSpans.length - 1]!;
    return {
        startOffset: start,
        endOffset: end,
        startLine: startSpan.line,
        endLine: endSpan.line,
        startColumn: start - startSpan.start + 1,
        endColumn: end - endSpan.start + 1,
    };
}

function makeMatch(
    file: MarkdownFileLike,
    partView: VaultSnippetPartView,
    start: number,
    end: number,
    sourceVersion: string,
    lineSpans: readonly VaultSnippetLineSpan[],
    content: string,
): VaultSnippetMatch {
    const contextStart = Math.max(partView.start, start - SNIPPET_CONTEXT_CHARS);
    const contextEnd = Math.min(partView.end, end + SNIPPET_CONTEXT_CHARS);
    const snippet = normalizeSnippetSpaces(content.slice(contextStart, contextEnd));
    const range = describeRange(lineSpans, start, end);
    return {
        path: file.path,
        title: getFileTitle(file),
        line: range.startLine,
        snippet: truncateChars(snippet, SNIPPET_MAX_CHARS),
        part: partView.part,
        sourceVersion,
        range,
    };
}

function normalizeSnippetSpaces(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function truncateChars(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function makePage(
    startIndex: number,
    returnedCount: number,
    requestedLimit: number,
    hasMore: boolean,
    outputBudgetExceeded?: boolean,
): VaultSnippetPage {
    return {
        startIndex,
        returnedCount,
        requestedLimit,
        hasMore,
        ...(outputBudgetExceeded ? { outputBudgetExceeded: true } : {}),
    };
}

function makeCoverage(values: Partial<VaultSnippetSearchOutput["coverage"]> = {}): VaultSnippetSearchOutput["coverage"] {
    return {
        state: values.state ?? "complete",
        scannedPermittedNotes: values.scannedPermittedNotes ?? 0,
        evaluatedCandidates: values.evaluatedCandidates ?? 0,
        readNotes: values.readNotes ?? 0,
        readBytes: values.readBytes ?? 0,
        evaluatedBytes: values.evaluatedBytes ?? 0,
        ...(values.skippedFiles === undefined ? {} : { skippedFiles: values.skippedFiles }),
        ...(values.candidateCapExceeded === undefined ? {} : { candidateCapExceeded: values.candidateCapExceeded }),
        ...(values.fileCapExceeded === undefined ? {} : { fileCapExceeded: values.fileCapExceeded }),
        ...(values.byteCapExceeded === undefined ? {} : { byteCapExceeded: values.byteCapExceeded }),
        ...(values.unknownFileSize === undefined ? {} : { unknownFileSize: values.unknownFileSize }),
    };
}

function decodeVaultSnippetCursor(cursor: string): VaultSnippetCursor | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(cursor);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["instance", "nextIndex", "query", "snapshot", "version"])) {
        return null;
    }
    if (value.version !== 1
        || typeof value.instance !== "string" || !value.instance
        || typeof value.query !== "string" || !/^[0-9a-f]{40}$/.test(value.query)
        || typeof value.snapshot !== "string" || !/^[0-9a-f]{40}$/.test(value.snapshot)
        || typeof value.nextIndex !== "number" || !Number.isInteger(value.nextIndex) || value.nextIndex < 0) {
        return null;
    }
    return {
        version: 1,
        instance: value.instance,
        query: value.query,
        snapshot: value.snapshot,
        nextIndex: value.nextIndex,
    };
}

function encodeVaultSnippetCursor(cursor: VaultSnippetCursor): string {
    return JSON.stringify(cursor);
}

async function hashJsonValue(value: unknown): Promise<string> {
    try {
        return await computeContentHash(JSON.stringify(value));
    } catch {
        throw new VaultSnippetSearchUnavailableError("Snippet search content hashing is unavailable.");
    }
}

function comparePaths(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

interface FitResultOptions {
    query: string;
    scope?: string;
    part: SearchVaultSnippetPart;
    caseSensitive: boolean;
    matches: VaultSnippetMatch[];
    matchCount: number;
    matchCountKind: "exact" | "lower-bound";
    pageStartIndex: number;
    requestedLimit: number;
    scanComplete: boolean;
    snapshotDigest: string;
    queryDigest: string;
    instancePrefix: string;
    coverage: VaultSnippetSearchOutput["coverage"];
    skippedSources: string[];
    scannedFiles: number;
    scannedBytes: number;
    consideredFiles: number;
    skippedFiles?: number;
    truncated?: boolean;
    omittedCount?: number;
}

function fitResultToBudget(options: FitResultOptions): VaultSnippetSearchOutput {
    let returnedCount = options.matches.length;
    let candidate: VaultSnippetSearchOutput | undefined;
    while (returnedCount >= 0) {
        const matches = options.matches.slice(0, returnedCount);
        const nextIndex = options.pageStartIndex + returnedCount;
        const hasMore = options.scanComplete && nextIndex < options.matchCount;
        const nextCursor = hasMore
            ? encodeVaultSnippetCursor({
                version: 1,
                instance: options.instancePrefix,
                query: options.queryDigest,
                snapshot: options.snapshotDigest,
                nextIndex,
            })
            : undefined;
        const outputBudgetExceeded = returnedCount < options.matches.length;
        candidate = {
            kind: "vault-snippets",
            query: options.query,
            scope: options.scope,
            part: options.part,
            caseSensitive: options.caseSensitive,
            matches,
            matchCount: options.matchCount,
            matchCountKind: options.matchCountKind,
            page: makePage(
                options.pageStartIndex,
                returnedCount,
                options.requestedLimit,
                hasMore,
                outputBudgetExceeded || undefined,
            ),
            coverage: options.coverage,
            ...(nextCursor ? { nextCursor } : {}),
            scannedFiles: options.scannedFiles,
            scannedBytes: options.scannedBytes,
            consideredFiles: options.consideredFiles,
            ...(options.skippedFiles === undefined ? {} : { skippedFiles: options.skippedFiles }),
            ...(options.skippedSources.length === 0 ? {} : { skippedSources: options.skippedSources }),
            ...(options.truncated === undefined && !outputBudgetExceeded ? {} : { truncated: true }),
            ...(options.omittedCount === undefined ? {} : { omittedCount: options.omittedCount }),
            ...(options.scanComplete ? {} : {
                partialResultGuidance: "Narrow the scope or use read_note for a specific large note; this partial scan has no whole-range cursor.",
            }),
        };
        if (JSON.stringify(candidate).length <= OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS) {
            return candidate;
        }
        if (returnedCount <= 1) {
            throw new VaultSnippetResultBudgetUnavailableError(
                "search_vault_snippets cannot fit its metadata and first match in the result budget.",
            );
        }
        returnedCount--;
    }
    throw new VaultSnippetResultBudgetUnavailableError(
        "search_vault_snippets cannot fit its result in the output budget.",
    );
}

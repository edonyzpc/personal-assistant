import { getFrontMatterInfo } from "obsidian";

import { computeContentHash } from "../vss-helpers";
import {
    type SearchVaultSnippetPart,
    type VaultSnippetMatch,
    type VaultSnippetRange,
    type VaultSnippetSearchOutput,
    type SearchVaultSnippetsInput,
} from "./chat-tool-types";
import {
    SNIPPET_SCOPE_UNAVAILABLE_SOURCE,
    SNIPPET_SCOPE_UNSUPPORTED_SOURCE,
    VAULT_FILE_READ_UNAVAILABLE_SOURCE,
    VAULT_FILE_STAT_UNAVAILABLE_SOURCE,
} from "./chat-tool-constants";
import {
    canReadVaultFiles,
    getFileTitle,
    getUtf8ByteLength,
    readVaultFile,
    sortCooperatively,
    type CooperativeCheckpoint,
} from "./chat-tool-execution-helpers";
import type { AiServiceHost } from "./AiServiceHost";
import type { MarkdownFileLike } from "./chat-tool-execution-helpers";
import { throwIfAborted } from "./chat-utils";
import { createCooperativeTask } from "./cooperative-task";

export class VaultSnippetSearchUnavailableError extends Error { }
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

export interface VaultSnippetIdentityRegistry {
    identity(file: object): string;
}

export class SequentialVaultSnippetIdentityRegistry implements VaultSnippetIdentityRegistry {
    private readonly identities = new WeakMap<object, string>();
    private nextSequence = 0;

    identity(file: object): string {
        const existing = this.identities.get(file);
        if (existing) return existing;
        const identity = `file-${++this.nextSequence}`;
        this.identities.set(file, identity);
        return identity;
    }
}

export interface ExecuteVaultSnippetSearchOptions {
    input: SearchVaultSnippetsInput;
    host: AiServiceHost;
    identities: VaultSnippetIdentityRegistry;
    signal: AbortSignal | undefined;
    dependencyPaths: Set<string>;
    isPathReadable: (path: string) => boolean;
    assertCurrent: () => void;
    checkpoint?: CooperativeCheckpoint;
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
    const task = createCooperativeTask(signal);
    const checkpoint = options.checkpoint ?? (async () => { await task.checkpoint(); });
    const calculationCheckpoint = async () => { await task.checkpoint(); };
    const part = input.part ?? "all";
    const caseSensitive = input.caseSensitive ?? false;
    const scopedFiles = await enumerateScopedFilesCooperatively(host, input.scope, checkpoint);
    const files: MarkdownFileLike[] = [];
    for (const file of scopedFiles) {
        await checkpoint();
        if (options.isPathReadable(file.path)) files.push(file);
    }
    if (input.scope && files.length === 0 && !await hasScopedFile(host, input.scope, checkpoint)) {
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

    const matcher = createLiteralMatcher(input.query, caseSensitive);
    const sourceIdentities: VaultSnippetSourceIdentityCapture[] = [];
    for (const file of files) {
        await checkpoint();
        sourceIdentities.push({ file, path: file.path, identity: options.identities.identity(file) });
    }
    const snapshot: VaultSnippetSnapshotItem[] = [];
    const sourceCaptures: Array<{
        file: MarkdownFileLike;
        path: string;
        stat: VaultSnippetFileStat | null;
    }> = [];
    const noteMatches: VaultSnippetMatch[] = [];
    let consideredFiles = 0;
    let readNotes = 0;
    let readBytes = 0;
    let evaluatedBytes = 0;
    let unknownFileSize = false;

    for (const file of files) {
        await checkpoint();
        throwIfAborted(signal);
        options.assertCurrent();
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
            unknownFileSize = true;
            captureSource("unknown-size");
            continue;
        }

        const content = await readVaultFile(host, file);
        await checkpoint();
        throwIfAborted(signal);
        options.assertCurrent();
        assertFileCurrent(options, file, stat);
        const actualBytes = getUtf8ByteLength(content);
        readNotes++;
        readBytes += actualBytes;
        evaluatedBytes += actualBytes;
        const contentHash = await computeContentHash(content);
        await checkpoint();
        throwIfAborted(signal);
        options.assertCurrent();
        assertFileCurrent(options, file, stat);
        captureSource("read", contentHash);

        let firstMatch: VaultSnippetMatch | undefined;
        for (const partView of getSearchPartViews(content, part)) {
            matcher.lastIndex = 0;
            const match = matcher.exec(partView.text);
            if (!match) continue;
            const originalStart = partView.start + match.index;
            const originalEnd = originalStart + match[0].length;
            const spans = await buildLineSpans(content, calculationCheckpoint);
            firstMatch = makeMatch(
                file,
                partView,
                originalStart,
                originalEnd,
                contentHash,
                spans,
            );
            break;
        }
        if (firstMatch) noteMatches.push(firstMatch);
    }

    await checkpoint();
    throwIfAborted(signal);
    options.assertCurrent();
    await assertSourceSetCurrent(options, sourceIdentities, sourceCaptures, input.scope, checkpoint);
    for (const path of options.dependencyPaths) {
        await checkpoint();
        if (!options.isPathReadable(path)) {
            throw new VaultSnippetSourcesChangedError("Task source path is no longer permitted.");
        }
    }
    await hashJsonValue(snapshot);
    await checkpoint();
    throwIfAborted(signal);
    options.assertCurrent();
    if (!canReadVaultFiles(host)) {
        throw new VaultSnippetSearchUnavailableError("Vault cachedRead is unavailable.");
    }
    await assertSourceSetCurrent(options, sourceIdentities, sourceCaptures, input.scope, checkpoint);

    const scanComplete = !unknownFileSize;

    const coverage = makeCoverage({
        scannedPermittedNotes: files.length,
        evaluatedCandidates: consideredFiles,
        readNotes,
        readBytes,
        evaluatedBytes,
        unknownFileSize: unknownFileSize || undefined,
        state: scanComplete ? "complete" : "partial",
    });

    const matches = input.limit === undefined ? noteMatches : noteMatches.slice(0, input.limit);
    const content: VaultSnippetSearchOutput = {
        kind: "vault-snippets",
        query: input.query,
        scope: input.scope,
        part,
        caseSensitive,
        matches,
        matchCount: noteMatches.length,
        matchCountKind: scanComplete ? "exact" : "lower-bound",
        coverage,
        scannedFiles: readNotes,
        scannedBytes: evaluatedBytes,
        consideredFiles,
        ...(scanComplete ? {} : { unavailableSources: [VAULT_FILE_STAT_UNAVAILABLE_SOURCE] }),
    };
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

export async function enumerateScopedFilesCooperatively(
    host: AiServiceHost,
    scope: string | undefined,
    checkpoint: CooperativeCheckpoint,
): Promise<MarkdownFileLike[]> {
    const epoch = host.getTaskSourceAuthorityEpoch?.();
    const vault = host.app.vault as unknown as {
        getMarkdownFiles?: () => unknown;
        getMarkdownFilesCooperatively?: (checkpoint: CooperativeCheckpoint) => Promise<unknown>;
    };
    let files: unknown;
    if (typeof vault.getMarkdownFilesCooperatively === "function") {
        files = await vault.getMarkdownFilesCooperatively(checkpoint);
    } else {
        if (typeof vault.getMarkdownFiles !== "function") {
            throw new VaultSnippetSearchUnavailableError("Vault getMarkdownFiles is unavailable.");
        }
        // Preserve native failures for the adapter's standard, sanitized envelope.
        files = vault.getMarkdownFiles();
        await checkpoint();
    }
    if (!Array.isArray(files)) {
        throw new VaultSnippetSearchUnavailableError("Vault getMarkdownFiles returned an invalid file list.");
    }
    const byPath = new Map<string, MarkdownFileLike>();
    for (const file of files) {
        await checkpoint();
        if (!file || typeof file !== "object" || typeof file.path !== "string") continue;
        if (isFileWithinScope(file.path, scope) && !byPath.has(file.path)) byPath.set(file.path, file);
    }
    const result = await sortCooperatively([...byPath.values()], (left, right) => comparePaths(left.path, right.path), checkpoint);
    if (epoch !== undefined && epoch !== host.getTaskSourceAuthorityEpoch?.()) {
        throw new VaultSnippetSourcesChangedError("Note sources changed while snippet candidates were being enumerated.");
    }
    return result;
}

async function hasScopedFile(host: AiServiceHost, scope: string, checkpoint: CooperativeCheckpoint): Promise<boolean> {
    if (scope.toLowerCase().endsWith(".md")) {
        const file = host.app.vault.getAbstractFileByPath?.(scope);
        return Boolean(file && typeof file === "object" && typeof (file as MarkdownFileLike).path === "string");
    }
    return (await enumerateScopedFilesCooperatively(host, scope, checkpoint)).length > 0;
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
    const current = options.host.app.vault.getAbstractFileByPath?.(file.path) as MarkdownFileLike | null | undefined;
    const currentStat = current ? captureStat(current) : null;
    if (current !== file || current?.path !== file.path || !currentStat
        || currentStat.mtime !== stat.mtime || currentStat.size !== stat.size) {
        throw new VaultSnippetSourcesChangedError("Note sources changed while snippets were being searched.");
    }
}

async function assertSourceSetCurrent(
    options: ExecuteVaultSnippetSearchOptions,
    identities: ReadonlyArray<VaultSnippetSourceIdentityCapture>,
    captures: ReadonlyArray<{
        file: MarkdownFileLike;
        path: string;
        stat: VaultSnippetFileStat | null;
    }>,
    scope: string | undefined,
    checkpoint: CooperativeCheckpoint,
): Promise<void> {
    const epoch = options.host.getTaskSourceAuthorityEpoch?.();
    // Legacy hosts have no event fence: keep their final seal atomic. Native Host always supplies an epoch.
    const currentFiles = epoch === undefined ? enumerateScopedFiles(options.host, scope)
        : await enumerateScopedFilesCooperatively(options.host, scope, checkpoint);
    if (currentFiles.length !== identities.length) {
        throw new VaultSnippetSourcesChangedError("The permitted note集合 changed while snippets were being searched.");
    }
    for (let index = 0; index < identities.length; index++) {
        if (epoch !== undefined) await checkpoint();
        const expected = identities[index];
        const actual = currentFiles[index];
        if (
            actual !== expected.file
            || actual.path !== expected.path
            || options.identities.identity(actual) !== expected.identity
        ) {
            throw new VaultSnippetSourcesChangedError("Note sources changed while snippets were being searched.");
        }
    }

    const currentByPath = new Map<string, MarkdownFileLike>();
    for (const file of currentFiles) {
        if (epoch !== undefined) await checkpoint();
        currentByPath.set(file.path, file);
    }
    for (const expected of captures) {
        if (epoch !== undefined) await checkpoint();
        const actual = currentByPath.get(expected.path);
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
    if (epoch !== undefined && epoch !== options.host.getTaskSourceAuthorityEpoch?.()) {
        throw new VaultSnippetSourcesChangedError("Note sources changed while the snippet snapshot was being verified.");
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

async function buildLineSpans(content: string, checkpoint: CooperativeCheckpoint): Promise<VaultSnippetLineSpan[]> {
    const spans: VaultSnippetLineSpan[] = [];
    const lineBreak = /\r\n|\r|\n/g;
    let start = 0;
    let line = 1;
    let match: RegExpExecArray | null;
    while ((match = lineBreak.exec(content)) !== null) {
        await checkpoint();
        spans.push({ start, endIncludingBreak: match.index + match[0].length, line });
        start = spans[spans.length - 1].endIncludingBreak;
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
    const findSpan = (offset: number, inclusive: boolean) => {
        let low = 0, high = lineSpans.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (inclusive ? offset <= lineSpans[mid].endIncludingBreak : offset < lineSpans[mid].endIncludingBreak) high = mid;
            else low = mid + 1;
        }
        return lineSpans[low];
    };
    const startSpan = findSpan(start, false);
    const endSpan = findSpan(end, true);
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
): VaultSnippetMatch {
    const range = describeRange(lineSpans, start, end);
    return {
        path: file.path,
        title: getFileTitle(file),
        line: range.startLine,
        part: partView.part,
        sourceVersion,
        range,
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

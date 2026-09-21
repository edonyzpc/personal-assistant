import { getFrontMatterInfo } from "obsidian";
import type {
    QueryNotesInput,
    InspectNoteCoverage,
    InspectObsidianNoteOutput,
    QueryNotesCoverage,
    QueryNotesOutput,
    ReadNoteOutput,
    ReadNoteRange,
    SearchVaultSnippetPart,
    VaultSnippetRange,
    VaultSnippetSearchOutput,
} from "./chat-tool-types";
import type { AiServiceHost } from "./AiServiceHost";
import type { ChatMessage, PaAgentMessage } from "./chat-types";
import { computeContentHash } from "../vss-helpers";
import { getReadNotePartView } from "./read-note-tool-helpers";
import {
    createSnapshotProjectionBudget,
    isInStaticQueryScope,
    projectQueryMetadata,
    type QueryNotesPublicSnapshot,
} from "./query-notes-tool-helpers";
import {
    captureVaultSnippetStat,
    createVaultSnippetMatcher,
    enumerateScopedFiles,
    getVaultSnippetSearchPartViews,
} from "./vault-snippet-search-tool-helpers";
import {
    INSPECT_NOTE_MAX_BACKLINK_SOURCES,
    INSPECT_NOTE_MAX_HEADINGS,
    INSPECT_NOTE_MAX_LINKS,
    INSPECT_NOTE_MAX_PROPERTIES,
    INSPECT_NOTE_MAX_TAGS,
    INSPECT_NOTE_MAX_TASKS,
    FRONTMATTER_VALUE_MAX_CHARS,
    QUERY_NOTES_MAX_CANDIDATES,
    QUERY_NOTES_PROJECTION_MAX_UTF8_BYTES,
    SNIPPET_MAX_BYTES,
    SNIPPET_MAX_CANDIDATE_FILES,
    SNIPPET_MAX_FILE_BYTES,
    SNIPPET_MAX_FILES,
} from "./chat-tool-constants";
import { canonicalizeQueryNotesInput, validateQueryNotesInput } from "./chat-tool-guards";
import { getKnownFileSize } from "./chat-tool-execution-helpers";
import { throwIfAborted } from "./chat-utils";

export const VAULT_OBSERVATION_CONTRACT_VERSION = 1;
export const MAX_VAULT_OBSERVATION_ENVELOPE_UTF8_BYTES = 128_000;
export const MAX_VAULT_OBSERVATION_ENVELOPES_PER_TURN = 64;
export const MAX_VAULT_OBSERVATION_TURN_UTF8_BYTES = 512_000;

const HASH40 = /^[0-9a-f]{40}$/;
const OBSERVATION_ID_MAX = 256;
const SCOPE_PATHS_MAX = 500;
const QUERY_PATH_MAX = 1_024;
export type VaultObservationTool =
    | "read_note"
    | "query_notes"
    | "search_vault_snippets"
    | "inspect_obsidian_note";

export interface VaultObservationFingerprint {
    algorithm: "sha1";
    canonicalizationVersion: 1;
}

export interface VaultObservationScope {
    allowedPaths: string[] | null;
    excludedPaths: string[];
}

export interface ReadObservationCoverage {
    complete: boolean;
    truncated: boolean;
    endOfPart: boolean;
}

export interface ReadObservationItem {
    kind: "read-result";
    outputDigest: string;
    path: string;
    contentHash: string;
    part: "body" | "properties";
    range: ReadNoteRange;
}

export interface QueryObservationItem {
    kind: "query-match";
    index: number;
    outputDigest: string;
    path: string;
    metadataDigest: string;
}

export interface SnippetObservationItem {
    kind: "snippet-match";
    index: number;
    outputDigest: string;
    path: string;
    contentHash: string;
    part: SearchVaultSnippetPart;
    range: VaultSnippetRange;
}

export interface InspectObservationItem {
    kind: "inspect-result";
    outputDigest: string;
    path: string;
    cacheProjectionDigest: string;
    linkFactsDigest: string;
    bodyRead: boolean;
    bodyHash?: string;
}

export interface QueryObservationAggregate {
    kind: "query";
    query: Omit<QueryNotesInput, "limit" | "cursor">;
    candidateSetDigest: string;
    metadataSetDigest: string;
    evaluatedCandidates: number;
    completeCandidateSet: boolean;
    projectionComplete: boolean;
}

export interface SnippetObservationAggregate {
    kind: "snippets";
    query: string;
    scope?: string;
    part: SearchVaultSnippetPart;
    caseSensitive: boolean;
    candidateSetDigest: string;
    scannedVersionDigest: string;
    evaluatedCandidates: number;
}

export interface VaultObservationEvidenceBase {
    schemaVersion: 1;
    observationId: string;
    tool: VaultObservationTool;
    fingerprint: VaultObservationFingerprint;
    scope: VaultObservationScope;
}

export interface ReadVaultObservationEvidence extends VaultObservationEvidenceBase {
    tool: "read_note";
    coverage: ReadObservationCoverage;
    items: [ReadObservationItem];
}

export interface QueryVaultObservationEvidence extends VaultObservationEvidenceBase {
    tool: "query_notes";
    coverage: QueryNotesCoverage;
    items: QueryObservationItem[];
    aggregate: QueryObservationAggregate;
}

export interface SnippetVaultObservationEvidence extends VaultObservationEvidenceBase {
    tool: "search_vault_snippets";
    coverage: VaultSnippetSearchOutput["coverage"];
    items: SnippetObservationItem[];
    aggregate: SnippetObservationAggregate;
}

export interface InspectVaultObservationEvidence extends VaultObservationEvidenceBase {
    tool: "inspect_obsidian_note";
    coverage: InspectNoteCoverage;
    items: [InspectObservationItem];
}

export type VaultObservationEvidence =
    | ReadVaultObservationEvidence
    | QueryVaultObservationEvidence
    | SnippetVaultObservationEvidence
    | InspectVaultObservationEvidence;

export interface VaultObservationRevalidation {
    observationId: string;
    validItemIndexes: number[];
    aggregateCurrent: boolean;
}

export interface VaultObservationRevalidationOptions {
    signal?: AbortSignal;
    isPathAllowed?: (path: string) => boolean;
}

export type VaultObservationEvidenceParseResult =
    | { ok: true; evidence: VaultObservationEvidence }
    | { ok: false; reason: string };

export async function hashObservationValue(value: unknown): Promise<string> {
    return await computeContentHash(stableJson(value));
}

export function stableJson(value: unknown): string {
    return JSON.stringify(sortJsonValue(value)) ?? "null";
}

function sortJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJsonValue);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) result[key] = sortJsonValue(record[key]);
    return result;
}

let nextObservationSequence = 0;
export function createVaultObservationId(prefix: string): string {
    nextObservationSequence += 1;
    return `${prefix}-observation-${Date.now().toString(36)}-${nextObservationSequence}`;
}

export function buildReadObservationEvidence(options: {
    observationId: string;
    scope: VaultObservationScope;
    output: ReadNoteOutput;
    partitionContent: string;
}): Promise<ReadVaultObservationEvidence> {
    return withEnvelopeBudget(async () => ({
        schemaVersion: 1,
        observationId: options.observationId,
        tool: "read_note",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: cloneScope(options.scope),
        coverage: {
            complete: options.output.complete,
            truncated: options.output.truncated,
            endOfPart: options.output.endOfPart,
        },
        items: [{
            kind: "read-result",
            outputDigest: await hashObservationValue(options.output),
            path: options.output.path,
            contentHash: await computeContentHash(options.partitionContent),
            part: options.output.part,
            range: { ...options.output.range },
        }],
    })) as Promise<ReadVaultObservationEvidence>;
}

export async function buildQueryObservationEvidence(options: {
    observationId: string;
    scope: VaultObservationScope;
    output: QueryNotesOutput;
    candidatePaths: readonly string[];
    metadataSnapshots: readonly unknown[];
    matchMetadataSnapshots?: readonly unknown[];
}): Promise<QueryVaultObservationEvidence> {
    const evidence: QueryVaultObservationEvidence = {
        schemaVersion: 1,
        observationId: options.observationId,
        tool: "query_notes",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: cloneScope(options.scope),
        coverage: { ...options.output.coverage },
        aggregate: {
            kind: "query",
            query: options.output.query as QueryNotesInput,
            candidateSetDigest: await hashObservationValue(options.candidatePaths),
            metadataSetDigest: await hashObservationValue(options.metadataSnapshots),
            evaluatedCandidates: options.output.coverage.evaluatedCandidates,
            completeCandidateSet: options.output.coverage.state === "complete"
                && !options.output.coverage.candidateCapExceeded,
            projectionComplete: !options.output.coverage.projectionBudgetExceeded,
        },
        items: await Promise.all(options.output.matches.map(async (match, index) => ({
            kind: "query-match" as const,
            index,
            outputDigest: await hashObservationValue(match),
            path: match.path,
            metadataDigest: await hashObservationValue(
                (options.matchMetadataSnapshots ?? options.metadataSnapshots)[index] ?? null,
            ),
        }))),
    };
    await assertEnvelopeBudget(evidence);
    return evidence;
}

export async function buildSnippetObservationEvidence(options: {
    observationId: string;
    scope: VaultObservationScope;
    output: VaultSnippetSearchOutput;
    candidatePaths: readonly string[];
    scannedVersions: readonly unknown[];
}): Promise<SnippetVaultObservationEvidence> {
    const evidence: SnippetVaultObservationEvidence = {
        schemaVersion: 1,
        observationId: options.observationId,
        tool: "search_vault_snippets",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: cloneScope(options.scope),
        coverage: { ...options.output.coverage },
        aggregate: {
            kind: "snippets",
            query: options.output.query,
            ...(options.output.scope === undefined ? {} : { scope: options.output.scope }),
            part: options.output.part,
            caseSensitive: options.output.caseSensitive,
            candidateSetDigest: await hashObservationValue(options.candidatePaths),
            scannedVersionDigest: await hashObservationValue(options.scannedVersions),
            evaluatedCandidates: options.output.coverage.evaluatedCandidates,
        },
        items: await Promise.all(options.output.matches.map(async (match, index) => ({
            kind: "snippet-match" as const,
            index,
            outputDigest: await hashObservationValue(match),
            path: match.path,
            contentHash: match.sourceVersion,
            part: match.part,
            range: { ...match.range },
        }))),
    };
    await assertEnvelopeBudget(evidence);
    return evidence;
}

export async function buildInspectObservationEvidence(options: {
    observationId: string;
    scope: VaultObservationScope;
    output: InspectObsidianNoteOutput;
    cacheProjection: unknown;
    linkFacts: unknown;
    bodyContent?: string;
}): Promise<InspectVaultObservationEvidence> {
    const coverage = options.output.coverage;
    if (!coverage) throw new Error("inspect_obsidian_note new-contract result has no coverage.");
    const [outputDigest, cacheProjectionDigest, linkFactsDigest, bodyHash] = await Promise.all([
        hashObservationValue(options.output),
        hashObservationValue(options.cacheProjection),
        hashObservationValue(options.linkFacts),
        coverage.bodyRead && options.bodyContent !== undefined
            ? computeContentHash(options.bodyContent)
            : Promise.resolve(undefined),
    ]);
    const evidence: InspectVaultObservationEvidence = {
        schemaVersion: 1,
        observationId: options.observationId,
        tool: "inspect_obsidian_note",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: cloneScope(options.scope),
        coverage: { ...coverage },
        items: [{
            kind: "inspect-result",
            outputDigest,
            path: options.output.path,
            cacheProjectionDigest,
            linkFactsDigest,
            bodyRead: coverage.bodyRead,
            ...(bodyHash === undefined ? {} : { bodyHash }),
        }],
    };
    await assertEnvelopeBudget(evidence);
    return evidence;
}

export function parseVaultObservationEvidence(value: unknown): VaultObservationEvidenceParseResult {
    try {
        const evidence = parseStrict(value);
        return { ok: true, evidence };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "invalid vault observation evidence" };
    }
}

export function cloneVaultObservationEvidence(value: VaultObservationEvidence): VaultObservationEvidence {
    const parsed = parseVaultObservationEvidence(value);
    if (!parsed.ok) throw new Error(parsed.reason);
    return deepCloneEvidence(parsed.evidence);
}

export function assertVaultObservationHistory(values: readonly unknown[]): void {
    if (values.length > MAX_VAULT_OBSERVATION_ENVELOPES_PER_TURN) {
        throw new Error("Vault observation evidence history exceeds its envelope count budget.");
    }
    let total = 0;
    for (const value of values) {
        const parsed = parseStrict(value);
        total += byteCountForJson(parsed);
        if (total > MAX_VAULT_OBSERVATION_TURN_UTF8_BYTES) {
            throw new Error("Vault observation evidence history exceeds its byte budget.");
        }
    }
}

function byteCountForJson(value: unknown): number {
    return new TextEncoder().encode(stableJson(value)).length;
}

function assertParsedEnvelopeBudget(value: VaultObservationEvidence): void {
    if (byteCountForJson(value) > MAX_VAULT_OBSERVATION_ENVELOPE_UTF8_BYTES) {
        throw new Error("Vault observation evidence exceeds its envelope budget.");
    }
}

function deepCloneEvidence(value: VaultObservationEvidence): VaultObservationEvidence {
    return JSON.parse(stableJson(value)) as VaultObservationEvidence;
}

async function withEnvelopeBudget<T extends VaultObservationEvidence>(build: () => Promise<T>): Promise<T> {
    const evidence = await build();
    await assertEnvelopeBudget(evidence);
    return evidence;
}

async function assertEnvelopeBudget(value: unknown): Promise<void> {
    if (byteCountForJson(value) > MAX_VAULT_OBSERVATION_ENVELOPE_UTF8_BYTES) {
        throw new Error("Vault observation evidence exceeds its envelope budget.");
    }
}

function cloneScope(scope: VaultObservationScope): VaultObservationScope {
    return {
        allowedPaths: scope.allowedPaths === null ? null : [...scope.allowedPaths],
        excludedPaths: [...scope.excludedPaths],
    };
}

function parseStrict(value: unknown): VaultObservationEvidence {
    const record = asRecord(value);
    expectKeys(record, ["schemaVersion", "observationId", "tool", "fingerprint", "scope", "coverage", "items"], ["aggregate"]);
    if (record.schemaVersion !== 1) throw new Error("Unsupported vault observation schema.");
    const observationId = string(record.observationId, "observationId", OBSERVATION_ID_MAX);
    const fingerprint = asRecord(record.fingerprint);
    expectKeys(fingerprint, ["algorithm", "canonicalizationVersion"]);
    if (fingerprint.algorithm !== "sha1" || fingerprint.canonicalizationVersion !== 1) {
        throw new Error("Unsupported vault observation fingerprint.");
    }
    const scopeRecord = asRecord(record.scope);
    expectKeys(scopeRecord, ["allowedPaths", "excludedPaths"]);
    const allowedPaths = scopeRecord.allowedPaths === null ? null : pathArray(scopeRecord.allowedPaths, "allowedPaths");
    const excludedPaths = pathArray(scopeRecord.excludedPaths, "excludedPaths");
    const tool = record.tool;
    if ((tool === "read_note" || tool === "inspect_obsidian_note")
        && Object.prototype.hasOwnProperty.call(record, "aggregate")) {
        throw new Error("Vault observation aggregate is not valid for this tool.");
    }
    const evidence = tool === "read_note"
        ? parseRead(record, observationId, allowedPaths, excludedPaths)
        : tool === "query_notes"
            ? parseQuery(record, observationId, allowedPaths, excludedPaths)
            : tool === "search_vault_snippets"
                ? parseSnippet(record, observationId, allowedPaths, excludedPaths)
                : tool === "inspect_obsidian_note"
                    ? parseInspect(record, observationId, allowedPaths, excludedPaths)
                    : undefined;
    if (!evidence) throw new Error("Unknown vault observation tool.");
    assertParsedEnvelopeBudget(evidence);
    return evidence;
    throw new Error("Unknown vault observation tool.");
}

function parseRead(record: Record<string, unknown>, observationId: string, allowedPaths: string[] | null, excludedPaths: string[]): ReadVaultObservationEvidence {
    const coverage = asRecord(record.coverage);
    expectKeys(coverage, ["complete", "truncated", "endOfPart"]);
    booleans(coverage, ["complete", "truncated", "endOfPart"]);
    if (!Array.isArray(record.items) || record.items.length !== 1) throw new Error("read_note requires one item.");
    const item = asRecord(record.items[0]);
    expectKeys(item, ["kind", "outputDigest", "path", "contentHash", "part", "range"]);
    if (item.kind !== "read-result") throw new Error("Invalid read_note item kind.");
    const range = asRecord(item.range);
    expectKeys(range, ["startLine", "endLine", "startOffset", "endOffset", "partialLine"]);
    integers(range, ["startLine", "endLine", "startOffset", "endOffset"]);
    const startLine = integer(range.startLine);
    const endLine = integer(range.endLine);
    const startOffset = integer(range.startOffset);
    const endOffset = integer(range.endOffset);
    if (typeof range.partialLine !== "boolean"
        || startLine < 1 || endLine < startLine
        || startOffset < 0 || endOffset < startOffset) {
        throw new Error("Invalid read_note range.");
    }
    const part = item.part;
    if (part !== "body" && part !== "properties") throw new Error("Invalid read_note part.");
    const complete = boolean(coverage.complete);
    const truncated = boolean(coverage.truncated);
    const endOfPart = boolean(coverage.endOfPart);
    return {
        schemaVersion: 1,
        observationId,
        tool: "read_note",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: { allowedPaths, excludedPaths },
        coverage: { complete, truncated, endOfPart },
        items: [{
            kind: "read-result",
            outputDigest: hash(item.outputDigest),
            path: path(item.path),
            contentHash: hash(item.contentHash),
            part,
            range: {
                startLine,
                endLine,
                startOffset,
                endOffset,
                partialLine: range.partialLine,
            },
        }],
    };
}

function parseQuery(record: Record<string, unknown>, observationId: string, allowedPaths: string[] | null, excludedPaths: string[]): QueryVaultObservationEvidence {
    const coverage = parseQueryCoverage(record.coverage);
    const aggregate = asRecord(record.aggregate);
    expectKeys(aggregate, ["kind", "query", "candidateSetDigest", "metadataSetDigest", "evaluatedCandidates", "completeCandidateSet", "projectionComplete"]);
    if (aggregate.kind !== "query") throw new Error("Invalid query aggregate kind.");
    const queryRecord = asRecord(aggregate.query);
    const query = validateQueryNotesInput({ ...(queryRecord as object), limit: 1 });
    if (Object.prototype.hasOwnProperty.call(queryRecord, "limit")
        || Object.prototype.hasOwnProperty.call(queryRecord, "cursor")) {
        throw new Error("query_notes aggregate query must not contain paging fields.");
    }
    const canonicalQuery = JSON.parse(canonicalizeQueryNotesInput(query)) as Omit<QueryNotesInput, "limit" | "cursor">;
    const evidence = {
        schemaVersion: 1,
        observationId,
        tool: "query_notes",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: { allowedPaths, excludedPaths },
        coverage,
        aggregate: {
            kind: "query",
            query: canonicalQuery,
            candidateSetDigest: hash(aggregate.candidateSetDigest),
            metadataSetDigest: hash(aggregate.metadataSetDigest),
            evaluatedCandidates: safeInteger(aggregate.evaluatedCandidates),
            completeCandidateSet: boolean(aggregate.completeCandidateSet),
            projectionComplete: boolean(aggregate.projectionComplete),
        },
        items: parseIndexedItems(record.items, 20, item => {
            expectKeys(item, ["kind", "index", "outputDigest", "path", "metadataDigest"]);
            if (item.kind !== "query-match") throw new Error("Invalid query item kind.");
            return {
                kind: "query-match",
                index: safeInteger(item.index),
                outputDigest: hash(item.outputDigest),
                path: path(item.path, QUERY_PATH_MAX),
                metadataDigest: hash(item.metadataDigest),
            };
        }),
    } satisfies QueryVaultObservationEvidence;
    assertParsedEnvelopeBudget(evidence);
    return evidence;
}

function parseSnippet(record: Record<string, unknown>, observationId: string, allowedPaths: string[] | null, excludedPaths: string[]): SnippetVaultObservationEvidence {
    const coverage = parseSnippetCoverage(record.coverage);
    const aggregate = asRecord(record.aggregate);
    expectKeys(aggregate, ["kind", "query", "part", "caseSensitive", "candidateSetDigest", "scannedVersionDigest", "evaluatedCandidates"], ["scope"]);
    if (aggregate.kind !== "snippets") throw new Error("Invalid snippets aggregate kind.");
    return {
        schemaVersion: 1,
        observationId,
        tool: "search_vault_snippets",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: { allowedPaths, excludedPaths },
        coverage,
        aggregate: {
            kind: "snippets",
            query: string(aggregate.query, "query", 2_000),
            ...(aggregate.scope === undefined ? {} : { scope: string(aggregate.scope, "scope") }),
            part: parseSnippetPart(aggregate.part),
            caseSensitive: boolean(aggregate.caseSensitive),
            candidateSetDigest: hash(aggregate.candidateSetDigest),
            scannedVersionDigest: hash(aggregate.scannedVersionDigest),
            evaluatedCandidates: safeInteger(aggregate.evaluatedCandidates),
        },
        items: parseIndexedItems(record.items, 10, item => {
            expectKeys(item, ["kind", "index", "outputDigest", "path", "contentHash", "part", "range"]);
            if (item.kind !== "snippet-match") throw new Error("Invalid snippet item kind.");
            const range = asRecord(item.range);
            expectKeys(range, ["startOffset", "endOffset", "startLine", "endLine", "startColumn", "endColumn"]);
            integers(range, ["startOffset", "endOffset", "startLine", "endLine", "startColumn", "endColumn"]);
            const startOffset = integer(range.startOffset);
            const endOffset = integer(range.endOffset);
            const startLine = integer(range.startLine);
            const endLine = integer(range.endLine);
            const startColumn = integer(range.startColumn);
            const endColumn = integer(range.endColumn);
            if (startOffset < 0 || endOffset < startOffset
                || startLine < 1 || endLine < startLine
                || startColumn < 1 || endColumn < 1
                || (startLine === endLine && endColumn < startColumn)) {
                throw new Error("Invalid snippet observation range.");
            }
            return {
                kind: "snippet-match",
                index: safeInteger(item.index),
                outputDigest: hash(item.outputDigest),
                path: path(item.path),
                contentHash: hash(item.contentHash),
                part: enumeration(item.part, ["body", "properties"]),
                range: {
                    startOffset,
                    endOffset,
                    startLine,
                    endLine,
                    startColumn,
                    endColumn,
                },
            };
        }),
    };
}

function parseInspect(record: Record<string, unknown>, observationId: string, allowedPaths: string[] | null, excludedPaths: string[]): InspectVaultObservationEvidence {
    const coverage = parseInspectCoverage(record.coverage);
    if (!Array.isArray(record.items) || record.items.length !== 1) throw new Error("inspect_obsidian_note requires one item.");
    const raw = asRecord(record.items[0]);
    expectKeys(raw, ["kind", "outputDigest", "path", "cacheProjectionDigest", "linkFactsDigest", "bodyRead"], ["bodyHash"]);
    if (raw.kind !== "inspect-result") throw new Error("Invalid inspect item kind.");
    const bodyRead = boolean(raw.bodyRead);
    const hasBodyHash = Object.prototype.hasOwnProperty.call(raw, "bodyHash");
    if (bodyRead !== hasBodyHash) throw new Error("Invalid inspect_obsidian_note body hash coupling.");
    return {
        schemaVersion: 1,
        observationId,
        tool: "inspect_obsidian_note",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: { allowedPaths, excludedPaths },
        coverage,
        items: [{
            kind: "inspect-result",
            outputDigest: hash(raw.outputDigest),
            path: path(raw.path),
            cacheProjectionDigest: hash(raw.cacheProjectionDigest),
            linkFactsDigest: hash(raw.linkFactsDigest),
            bodyRead,
            ...(hasBodyHash ? { bodyHash: hash(raw.bodyHash) } : {}),
        }],
    };
}

function parseQueryCoverage(value: unknown): QueryNotesCoverage {
    const record = asRecord(value);
    expectKeys(record, ["state", "scannedPermittedNotes", "evaluatedCandidates"], ["candidateCapExceeded", "projectionBudgetExceeded", "cacheUnknown"]);
    return {
        state: enumeration(record.state, ["complete", "partial"]),
        scannedPermittedNotes: safeInteger(record.scannedPermittedNotes),
        evaluatedCandidates: safeInteger(record.evaluatedCandidates),
        ...(record.candidateCapExceeded === undefined ? {} : { candidateCapExceeded: boolean(record.candidateCapExceeded) }),
        ...(record.projectionBudgetExceeded === undefined ? {} : { projectionBudgetExceeded: boolean(record.projectionBudgetExceeded) }),
        ...(record.cacheUnknown === undefined ? {} : { cacheUnknown: boolean(record.cacheUnknown) }),
    };
}

function parseSnippetCoverage(value: unknown): VaultSnippetSearchOutput["coverage"] {
    const record = asRecord(value);
    expectKeys(record, ["state", "scannedPermittedNotes", "evaluatedCandidates", "readNotes", "readBytes", "evaluatedBytes"], ["skippedFiles", "candidateCapExceeded", "fileCapExceeded", "byteCapExceeded", "unknownFileSize"]);
    return {
        state: enumeration(record.state, ["complete", "partial"]),
        scannedPermittedNotes: safeInteger(record.scannedPermittedNotes),
        evaluatedCandidates: safeInteger(record.evaluatedCandidates),
        readNotes: safeInteger(record.readNotes),
        readBytes: safeInteger(record.readBytes),
        evaluatedBytes: safeInteger(record.evaluatedBytes),
        ...(record.skippedFiles === undefined ? {} : { skippedFiles: safeInteger(record.skippedFiles) }),
        ...(record.candidateCapExceeded === undefined ? {} : { candidateCapExceeded: boolean(record.candidateCapExceeded) }),
        ...(record.fileCapExceeded === undefined ? {} : { fileCapExceeded: boolean(record.fileCapExceeded) }),
        ...(record.byteCapExceeded === undefined ? {} : { byteCapExceeded: boolean(record.byteCapExceeded) }),
        ...(record.unknownFileSize === undefined ? {} : { unknownFileSize: boolean(record.unknownFileSize) }),
    };
}

function parseInspectCoverage(value: unknown): InspectNoteCoverage {
    const record = asRecord(value);
    expectKeys(record, ["state", "cacheState", "bodyRead", "bodyRequired", "evaluatedBacklinkSources"], ["cacheCoverage", "backlinkScanCapExceeded", "outputTruncated"]);
    return {
        state: enumeration(record.state, ["complete", "partial"]),
        cacheState: enumeration(record.cacheState, ["known", "unknown"]),
        bodyRead: boolean(record.bodyRead),
        bodyRequired: boolean(record.bodyRequired),
        evaluatedBacklinkSources: safeInteger(record.evaluatedBacklinkSources),
        ...(record.cacheCoverage === undefined
            ? {}
            : { cacheCoverage: enumeration<"existing-items-only">(record.cacheCoverage, ["existing-items-only"]) }),
        ...(record.backlinkScanCapExceeded === undefined ? {} : { backlinkScanCapExceeded: boolean(record.backlinkScanCapExceeded) }),
        ...(record.outputTruncated === undefined ? {} : { outputTruncated: boolean(record.outputTruncated) }),
    };
}

function parseIndexedItems<T>(value: unknown, max: number, parse: (record: Record<string, unknown>) => T): T[] {
    if (!Array.isArray(value) || value.length > max) throw new Error("Invalid observation item count.");
    const seen = new Set<number>();
    return value.map(raw => {
        const record = asRecord(raw);
        const item = parse(record);
        const index = safeInteger(record.index);
        if (seen.has(index) || index < 0 || index >= value.length) throw new Error("Invalid observation item index.");
        seen.add(index);
        return item;
    });
}

export async function revalidateVaultObservationWithHost(
    host: AiServiceHost,
    evidence: VaultObservationEvidence,
    options: VaultObservationRevalidationOptions = {},
): Promise<VaultObservationRevalidation> {
    throwIfAborted(options.signal);
    if (!host.revalidateVaultObservation) throw new Error("Vault observation revalidation is unavailable.");
    const result = await host.revalidateVaultObservation(evidence, {
        signal: options.signal,
        isPathAllowed: options.isPathAllowed,
    });
    if (!result || result.observationId !== evidence.observationId
        || !Array.isArray(result.validItemIndexes)
        || result.validItemIndexes.length !== new Set(result.validItemIndexes).size
        || result.validItemIndexes.some(index => !Number.isSafeInteger(index)
            || index < 0 || index >= evidence.items.length)
        || typeof result.aggregateCurrent !== "boolean") {
        throw new Error("Vault observation revalidation returned an invalid result.");
    }
    return result;
}

export async function readObservationPartition(content: string, part: "body" | "properties"): Promise<string> {
    return getReadNotePartView(content, part).text;
}

export function frontmatterExists(content: string): boolean {
    return getFrontMatterInfo(content).exists;
}


function boundedArray(value: unknown, max: number): unknown[] | undefined {
    return Array.isArray(value) ? value.slice(0, max) : undefined;
}

function normalizeInsightHeading(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return {
        level: typeof record.level === "number" && Number.isFinite(record.level) ? record.level : 0,
        text: typeof record.heading === "string" ? record.heading.trim() : "",
    };
}

function normalizeCacheTask(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.task !== "string") return null;
    const position = record.position as { start?: { line?: unknown } } | undefined;
    const line = position?.start?.line;
    return {
        line: typeof line === "number" && Number.isInteger(line) && line >= 0 ? line + 1 : 0,
        status: record.task,
        checked: record.task !== " ",
    };
}

function normalizeOutputTask(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.status !== "string" || typeof record.line !== "number" || typeof record.checked !== "boolean") {
        return null;
    }
    return { line: record.line, status: record.status, checked: record.checked };
}

function normalizeCacheLink(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const link = (value as Record<string, unknown>).link;
    return typeof link === "string" && link ? link : null;
}

function normalizeCacheTag(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const tag = (value as Record<string, unknown>).tag;
    return typeof tag === "string" && tag ? tag.replace(/^#/, "").trim() : null;
}

function renderBoundedFrontmatterValue(value: unknown, depth = 0): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        return value.slice(0, 64)
            .map(entry => renderBoundedFrontmatterValue(entry, depth + 1))
            .filter(entry => entry.length > 0)
            .join(", ");
    }
    return "";
}

function projectFrontmatterRecord(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    const result = Object.create(null) as Record<string, string>;
    for (const key of Object.keys(record).slice(0, INSPECT_NOTE_MAX_PROPERTIES)) {
        const rendered = renderBoundedFrontmatterValue(record[key]);
        if (rendered) {
            result[key] = rendered.length <= FRONTMATTER_VALUE_MAX_CHARS
                ? rendered
                : `${rendered.slice(0, FRONTMATTER_VALUE_MAX_CHARS)}...`;
        }
    }
    return result;
}

export function projectInspectCache(cache: unknown): Record<string, unknown> {
    if (!cache || typeof cache !== "object") return { known: false };
    const record = cache as Record<string, unknown>;
    const tags = [
        ...(boundedArray(record.tags, INSPECT_NOTE_MAX_TAGS) ?? []).map(normalizeCacheTag),
        ...projectFrontmatterTags(record.frontmatter),
    ].filter((tag): tag is string => Boolean(tag));
    return {
        known: true,
        headings: (boundedArray(record.headings, INSPECT_NOTE_MAX_HEADINGS) ?? [])
            .map(normalizeInsightHeading).filter(Boolean),
        tags: [...new Set(tags)].slice(0, INSPECT_NOTE_MAX_TAGS),
        tasks: (boundedArray(record.listItems, INSPECT_NOTE_MAX_TASKS) ?? [])
            .map(normalizeCacheTask).filter(Boolean),
        links: (boundedArray(record.links, INSPECT_NOTE_MAX_LINKS) ?? [])
            .map(normalizeCacheLink).filter(Boolean),
        embeds: (boundedArray(record.embeds, INSPECT_NOTE_MAX_LINKS) ?? [])
            .map(normalizeCacheLink).filter(Boolean),
        frontmatter: projectFrontmatterRecord(record.frontmatter),
    };
}

export function projectInspectCacheFromOutput(output: InspectObsidianNoteOutput): Record<string, unknown> {
    return {
        known: true,
        headings: (output.headings ?? []).slice(0, INSPECT_NOTE_MAX_HEADINGS),
        tags: (output.tags ?? []).slice(0, INSPECT_NOTE_MAX_TAGS),
        tasks: (output.tasks ?? []).slice(0, INSPECT_NOTE_MAX_TASKS)
            .map(normalizeOutputTask).filter(Boolean),
        links: (output.wikilinks ?? []).slice(0, INSPECT_NOTE_MAX_LINKS),
        embeds: (output.embeds ?? []).slice(0, INSPECT_NOTE_MAX_LINKS),
        frontmatter: projectFrontmatterRecord(output.properties ?? {}),
    };
}

function projectFrontmatterTags(value: unknown): string[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    return ["tags", "tag"].flatMap(key => {
        const current = record[key];
        if (Array.isArray(current)) return current.filter((tag): tag is string => typeof tag === "string");
        return typeof current === "string" ? [current] : [];
    }).map(tag => tag.replace(/^#/, "").trim()).filter(Boolean);
}

export function projectInspectLinkFacts(
    path: string,
    metadataCache: {
        resolvedLinks?: Record<string, Record<string, number>>;
        unresolvedLinks?: Record<string, Record<string, number>>;
    } | undefined,
    isPathAllowed: (path: string) => boolean = () => true,
): Record<string, unknown> {
    const resolved = metadataCache?.resolvedLinks ?? {};
    const unresolved = metadataCache?.unresolvedLinks ?? {};
    const sourcePaths = Object.keys(resolved).filter(isPathAllowed);
    const scannedSources = sourcePaths.slice(0, INSPECT_NOTE_MAX_BACKLINK_SOURCES);
    const backlinks = scannedSources.filter(source =>
        resolved[source] !== undefined && path in resolved[source] && isPathAllowed(path));
    backlinks.sort((left, right) => compareObservationPaths(left, right));
    const filterTargets = (targets: Record<string, number> | undefined) => Object.keys(targets ?? {})
        .sort().filter(isPathAllowed).slice(0, INSPECT_NOTE_MAX_LINKS);
    return {
        path,
        scannedSources,
        evaluatedSources: scannedSources.length,
        scanCapExceeded: sourcePaths.length > scannedSources.length,
        backlinks,
        outgoing: filterTargets(resolved[path]),
        unresolvedTargets: filterTargets(unresolved[path]),
    };
}

export function projectInspectLinkFactsFromBacklinkEvaluation(
    path: string,
    facts: InspectBacklinkEvidenceFacts,
    metadataCache: {
        resolvedLinks?: Record<string, Record<string, number>>;
        unresolvedLinks?: Record<string, Record<string, number>>;
    } | undefined,
    isPathAllowed: (path: string) => boolean = () => true,
): Record<string, unknown> {
    const resolved = metadataCache?.resolvedLinks ?? {};
    const unresolved = metadataCache?.unresolvedLinks ?? {};
    const filterTargets = (targets: Record<string, number> | undefined) => Object.keys(targets ?? {})
        .sort().filter(isPathAllowed).slice(0, INSPECT_NOTE_MAX_LINKS);
    return {
        path,
        scannedSources: facts.scannedSources,
        evaluatedSources: facts.evaluatedSources,
        scanCapExceeded: facts.capExceeded,
        backlinks: [...facts.backlinks].sort((left, right) => compareObservationPaths(left, right)),
        outgoing: filterTargets(resolved[path]),
        unresolvedTargets: filterTargets(unresolved[path]),
    };
}

export interface InspectBacklinkEvidenceFacts {
    scannedSources: readonly string[];
    evaluatedSources: number;
    capExceeded: boolean;
    backlinks: readonly string[];
}

export async function revalidateVaultObservationFromApp(
    host: AiServiceHost,
    evidence: VaultObservationEvidence,
    options: VaultObservationRevalidationOptions = {},
): Promise<VaultObservationRevalidation> {
    throwIfAborted(options.signal);
    const scopeAllows = (path: string): boolean => {
        if (evidence.scope.allowedPaths !== null && !evidence.scope.allowedPaths.includes(path)) return false;
        if (evidence.scope.excludedPaths.includes(path)) return false;
        return options.isPathAllowed?.(path) ?? true;
    };
    const vault = host.app.vault as unknown as {
        getMarkdownFiles?: () => unknown;
        getAbstractFileByPath?: (path: string) => unknown;
        cachedRead?: (file: unknown) => Promise<string>;
    };
    const metadataCache = host.app.metadataCache as unknown as {
        getFileCache?: (file: unknown) => unknown;
        resolvedLinks?: Record<string, Record<string, number>>;
        unresolvedLinks?: Record<string, Record<string, number>>;
    } | undefined;
    if (evidence.tool === "query_notes") {
        if (typeof vault.getMarkdownFiles !== "function") {
            throw new Error("Vault markdown enumeration is unavailable.");
        }
        const files = vault.getMarkdownFiles();
        if (!Array.isArray(files)) throw new Error("Vault markdown enumeration is unavailable.");
        const scoped = files.filter((file): file is { path: string; stat?: { ctime?: unknown; mtime?: unknown } } =>
            Boolean(file && typeof file === "object" && typeof (file as { path?: unknown }).path === "string")
            && scopeAllows((file as { path: string }).path)
            && isInStaticQueryScope((file as { path: string }).path, evidence.aggregate.query))
            .sort((left, right) => compareObservationPaths(left.path, right.path));
        const candidatePaths = scoped.map(file => file.path);
        const needsMetadataCache = Boolean(
            evidence.aggregate.query.tags?.length
            || (evidence.aggregate.query.properties ?? []).some(property => property.operator !== undefined)
            || evidence.aggregate.query.date?.field === "property",
        );
        if (needsMetadataCache
            && (!metadataCache || typeof metadataCache.getFileCache !== "function")) {
            throw new Error("MetadataCache getFileCache is unavailable.");
        }
        const evaluated = evidence.aggregate.query.path === undefined
            ? scoped.slice(0, QUERY_NOTES_MAX_CANDIDATES)
            : scoped;
        const snapshots: QueryNotesPublicSnapshot[] = [];
        const snapshotByPath = new Map<string, QueryNotesPublicSnapshot>();
        const projectionBudget = createSnapshotProjectionBudget(QUERY_NOTES_PROJECTION_MAX_UTF8_BYTES);
        for (const file of evaluated) {
            throwIfAborted(options.signal);
            const cache = needsMetadataCache ? metadataCache?.getFileCache?.(file) : undefined;
            const snapshot = projectQueryMetadata(file, cache, evidence.aggregate.query);
            if (!projectionBudget.append(snapshot)) break;
            snapshots.push(snapshot);
            snapshotByPath.set(file.path, snapshot);
        }
        const aggregateCurrent = await hashObservationValue(candidatePaths) === evidence.aggregate.candidateSetDigest
            && await hashObservationValue(snapshots) === evidence.aggregate.metadataSetDigest
            && snapshots.length === evidence.aggregate.evaluatedCandidates;
        const validItemIndexes: number[] = [];
        for (const [index, item] of evidence.items.entries()) {
            const snapshot = snapshotByPath.get(item.path);
            if (snapshot === undefined) continue;
            const digest = await hashObservationValue(snapshot);
            if (digest === item.metadataDigest) validItemIndexes.push(index);
        }
        return { observationId: evidence.observationId, validItemIndexes, aggregateCurrent };
    }
    if (evidence.tool === "search_vault_snippets") {
        return revalidateSnippetObservation(host, evidence, scopeAllows, options.signal);
    }
    if (evidence.tool === "inspect_obsidian_note") {
        const item = evidence.items[0];
        const file = vault.getAbstractFileByPath?.(item.path);
        if (!file || !scopeAllows(item.path)) {
            return { observationId: evidence.observationId, validItemIndexes: [], aggregateCurrent: false };
        }
        const cache = metadataCache?.getFileCache?.(file);
        const cacheCurrent = await hashObservationValue(projectInspectCache(cache)) === item.cacheProjectionDigest;
        const linksCurrent = await hashObservationValue(projectInspectLinkFacts(item.path, metadataCache, scopeAllows))
            === item.linkFactsDigest;
        let bodyCurrent = !item.bodyHash;
        if (item.bodyHash) {
            const content = vault.cachedRead ? await vault.cachedRead(file) : undefined;
            bodyCurrent = typeof content === "string" && await computeContentHash(content) === item.bodyHash;
        }
        const current = cacheCurrent && linksCurrent && bodyCurrent;
        return {
            observationId: evidence.observationId,
            validItemIndexes: current ? [0] : [],
            aggregateCurrent: current,
        };
    }
    const item = evidence.items[0];
    const file = vault.getAbstractFileByPath?.(item.path);
    if (!file || !scopeAllows(item.path) || typeof vault.cachedRead !== "function") {
        return { observationId: evidence.observationId, validItemIndexes: [], aggregateCurrent: false };
    }
    const content = await vault.cachedRead(file);
    const partition = getReadNotePartView(content, item.part).text;
    const current = await computeContentHash(partition) === item.contentHash;
    return {
        observationId: evidence.observationId,
        validItemIndexes: current ? [0] : [],
        aggregateCurrent: current,
    };
}

async function revalidateSnippetObservation(
    host: AiServiceHost,
    evidence: Extract<VaultObservationEvidence, { tool: "search_vault_snippets" }>,
    scopeAllows: (path: string) => boolean,
    signal?: AbortSignal,
): Promise<VaultObservationRevalidation> {
    const files = enumerateScopedFiles(host, evidence.aggregate.scope, scopeAllows);
    const candidatePaths = files.map(file => file.path);
    const scannedVersions: Array<{ path: string; state: string; contentHash?: string }> = [];
    const currentContent = new Map<string, string>();
    let readNotes = 0;
    let readBytes = 0;
    let evaluatedBytes = 0;
    for (const file of files.slice(0, SNIPPET_MAX_CANDIDATE_FILES)) {
        throwIfAborted(signal);
        const stat = captureVaultSnippetStat(file);
        const capture = (state: "read" | "unknown-size" | "skipped-size", contentHash?: string) => {
            scannedVersions.push({
                path: file.path,
                state,
                ...(contentHash ? { contentHash } : {}),
            });
        };
        if (!stat) {
            const knownSize = getKnownFileSize(file);
            if (knownSize !== undefined
                && (knownSize > SNIPPET_MAX_FILE_BYTES || knownSize > SNIPPET_MAX_BYTES - evaluatedBytes)) {
                capture("skipped-size");
                continue;
            }
            capture("unknown-size");
            continue;
        }
        const remaining = SNIPPET_MAX_BYTES - readBytes;
        if (readNotes >= SNIPPET_MAX_FILES || remaining <= 0
            || stat.size > SNIPPET_MAX_FILE_BYTES || stat.size > remaining || remaining < SNIPPET_MAX_FILE_BYTES) {
            capture("skipped-size");
            continue;
        }
        const vault = host.app.vault as unknown as { cachedRead?: (file: unknown) => Promise<string> };
        if (typeof vault.cachedRead !== "function") {
            capture("unknown-size");
            continue;
        }
        const content = await vault.cachedRead(file);
        if (typeof content !== "string") throw new Error("Vault cachedRead did not return a string.");
        const bytes = new TextEncoder().encode(content).length;
        readNotes += 1;
        readBytes += bytes;
        if (bytes > SNIPPET_MAX_FILE_BYTES || bytes > SNIPPET_MAX_BYTES - readBytes) {
            capture("skipped-size");
            continue;
        }
        evaluatedBytes += bytes;
        currentContent.set(file.path, content);
        capture("read", await computeContentHash(content));
    }
    const aggregateCurrent = await hashObservationValue(candidatePaths) === evidence.aggregate.candidateSetDigest
        && await hashObservationValue(scannedVersions) === evidence.aggregate.scannedVersionDigest
        && scannedVersions.length === evidence.aggregate.evaluatedCandidates;
    const validItemIndexes: number[] = [];
    for (const [index, item] of evidence.items.entries()) {
        const content = currentContent.get(item.path);
        if (content === undefined || await computeContentHash(content) !== item.contentHash) continue;
        if (!snippetMatchIsAtRange(content, evidence.aggregate, item)) continue;
        validItemIndexes.push(index);
    }
    return { observationId: evidence.observationId, validItemIndexes, aggregateCurrent };
}

function snippetMatchIsAtRange(
    content: string,
    aggregate: Extract<VaultObservationEvidence, { tool: "search_vault_snippets" }>["aggregate"],
    item: Extract<VaultObservationEvidence, { tool: "search_vault_snippets" }>["items"][number],
): boolean {
    const matcher = createVaultSnippetMatcher(aggregate.query, aggregate.caseSensitive);
    for (const partView of getVaultSnippetSearchPartViews(content, aggregate.part)) {
        if (partView.part !== item.part) continue;
        matcher.lastIndex = 0;
        let match = matcher.exec(partView.text);
        while (match) {
            const start = partView.start + match.index;
            const end = start + match[0].length;
            if (start === item.range.startOffset && end === item.range.endOffset) return true;
            matcher.lastIndex = match.index + match[0].length;
            match = matcher.exec(partView.text);
        }
    }
    return false;
}

function compareObservationPaths(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

export interface VaultObservationPhysicalBinding {
    prepare(signal?: AbortSignal | null): Promise<void>;
    assertCurrent(): void;
}

export interface VaultObservationProjectionOptions {
    transcript: readonly PaAgentMessage[];
    history: readonly ChatMessage[];
    revalidate: (evidence: VaultObservationEvidence, options?: VaultObservationRevalidationOptions) => Promise<VaultObservationRevalidation>;
    getEpoch?: () => string;
    isPathAllowed?: (path: string) => boolean;
    signal?: AbortSignal;
    /**
     * `current` revalidates note contents against the live vault. `read_snapshot`
     * keeps the exact, evidence-bound observation that was already returned to
     * this run while still rechecking current path authorization. The latter is
     * the ordinary Chat contract: a later edit makes the observation older, not
     * unauthorized.
     */
    validationMode?: "current" | "read_snapshot";
}

export interface VaultObservationProjection {
    transcript: PaAgentMessage[];
    history: ChatMessage[];
    binding: VaultObservationPhysicalBinding;
    hasContractMaterial: boolean;
    serializedInput?: unknown;
}

export async function prepareVaultObservationProjection(options: VaultObservationProjectionOptions): Promise<VaultObservationProjection> {
    const transcript = options.transcript.map(cloneProjectionMessage);
    const history = options.history.map(message => ({ ...message }));
    const toolEntries = collectToolEvidence(transcript);
    const historyEntries = collectHistoryEvidence(history);
    const hasContractMaterial = toolEntries.some(entry => entry.contract)
        || historyEntries.some(entry => entry.contract)
        || transcript.some(message => message.role === "toolResult" && message.content.metadata?.vaultObservationContractVersion === 1)
        || history.some(message => evidenceState(message).contract);
    let boundEpoch: string | undefined;
    let currentBoundEpoch: string | undefined;
    let revalidations: VaultObservationRevalidation[] = [];
    if (hasContractMaterial) {
        if (options.validationMode === "read_snapshot") {
            revalidations = snapshotRevalidationGroup(toolEntries, historyEntries, options);
        } else {
            const startEpoch = sealEpoch(options);
            revalidations = await revalidateGroup(toolEntries, historyEntries, options);
            if (sealEpoch(options) !== startEpoch) {
                const retryEpoch = sealEpoch(options);
                revalidations = await revalidateGroup(toolEntries, historyEntries, options);
                if (sealEpoch(options) !== retryEpoch) {
                    throw new Error("Vault observations continued changing during preparation.");
                }
                boundEpoch = retryEpoch;
            } else {
                boundEpoch = startEpoch;
            }
            currentBoundEpoch = boundEpoch;
        }
    }
    const validByObservation = new Map<string, VaultObservationRevalidation>();
    for (const result of revalidations) validByObservation.set(result.observationId, result);
    await projectTranscriptObservations(transcript, validByObservation);
    projectHistoryObservations(history, validByObservation);
    const boundToolEntries = collectToolEvidence(transcript);
    const boundHistoryEntries = collectHistoryEvidence(history);
    const fixedPayload = hasContractMaterial ? stableJson({ transcript, history }) : undefined;
    const payloadDigest = fixedPayload === undefined ? undefined : await computeContentHash(fixedPayload);
    return {
        transcript,
        history,
        hasContractMaterial,
        ...(payloadDigest === undefined ? {} : { serializedInput: { payloadDigest } }),
        binding: {
            async prepare(signal) {
                throwIfAborted(signal ?? undefined);
                throwIfAborted(options.signal);
                if (!hasContractMaterial) return;
                if (options.validationMode === "read_snapshot") {
                    const results = snapshotRevalidationGroup(boundToolEntries, boundHistoryEntries, options);
                    if (stableJson({ transcript, history }) !== fixedPayload
                        || !boundResultsStillSupportProjection(boundToolEntries, boundHistoryEntries, results)) {
                        throw new Error("Vault observation authorization changed before dispatch.");
                    }
                    return;
                }
                if (boundEpoch === undefined) return;
                const prepareStartEpoch = sealEpoch(options);
                const results = await withAbortSignals(
                    revalidateGroup(boundToolEntries, boundHistoryEntries, { ...options, signal: signal ?? options.signal }),
                    [signal, options.signal],
                );
                throwIfAborted(signal ?? undefined);
                throwIfAborted(options.signal);
                if (sealEpoch(options) !== prepareStartEpoch
                    || stableJson({ transcript, history }) !== fixedPayload
                    || !boundResultsStillSupportProjection(boundToolEntries, boundHistoryEntries, results)) {
                    throw new Error("Vault observation evidence changed before dispatch.");
                }
                currentBoundEpoch = prepareStartEpoch;
            },
            assertCurrent() {
                if (options.validationMode === "read_snapshot") {
                    if (!snapshotPathsAllowed(boundToolEntries, boundHistoryEntries, options)) {
                        throw new Error("Vault observation authorization changed before dispatch.");
                    }
                    return;
                }
                if (hasContractMaterial && currentBoundEpoch !== undefined && sealEpoch(options) !== currentBoundEpoch) {
                    throw new Error("Vault observation evidence changed before dispatch.");
                }
            },
        },
    };
}

function snapshotRevalidationGroup(
    toolEntries: readonly EvidenceEntry[],
    historyEntries: readonly EvidenceEntry[],
    options: VaultObservationProjectionOptions,
): VaultObservationRevalidation[] {
    const unique = new Map<string, VaultObservationEvidence>();
    for (const entry of [...toolEntries, ...historyEntries]) {
        if (!entry.evidence || unique.has(entry.evidence.observationId)) continue;
        unique.set(entry.evidence.observationId, entry.evidence);
    }
    return [...unique.values()].map((evidence) => {
        const validItemIndexes = evidence.items.flatMap((item, index) => (
            options.isPathAllowed?.(item.path) === false ? [] : [index]
        ));
        return {
            observationId: evidence.observationId,
            validItemIndexes,
            aggregateCurrent: validItemIndexes.length === evidence.items.length,
        };
    });
}

function snapshotPathsAllowed(
    toolEntries: readonly EvidenceEntry[],
    historyEntries: readonly EvidenceEntry[],
    options: VaultObservationProjectionOptions,
): boolean {
    return [...toolEntries, ...historyEntries].every((entry) => (
        entry.evidence !== undefined
        && entry.evidence.items.every((item) => options.isPathAllowed?.(item.path) !== false)
    ));
}

interface EvidenceEntry {
    contract: true;
    evidence?: VaultObservationEvidence;
    aggregateRequired?: boolean;
    invalid?: boolean;
}

function boundResultsStillSupportProjection(
    toolEntries: readonly EvidenceEntry[],
    historyEntries: readonly EvidenceEntry[],
    results: readonly VaultObservationRevalidation[],
): boolean {
    const byObservation = new Map(results.map(result => [result.observationId, result]));
    const byEntry = new Map<string, { evidence: VaultObservationEvidence; aggregateRequired: boolean }>();
    for (const entry of [...toolEntries, ...historyEntries]) {
        if (!entry.evidence) continue;
        const existing = byEntry.get(entry.evidence.observationId);
        byEntry.set(entry.evidence.observationId, {
            evidence: entry.evidence,
            aggregateRequired: (existing?.aggregateRequired ?? false) || entry.aggregateRequired !== false,
        });
    }
    if (byEntry.size === 0) return false;
    return [...byEntry.values()].every(({ evidence, aggregateRequired }) => {
        const result = byObservation.get(evidence.observationId);
        if (result === undefined
            || result.validItemIndexes.length !== evidence.items.length
            || evidence.items.some((_item, index) => !result.validItemIndexes.includes(index))) {
            return false;
        }
        return result.aggregateCurrent || !aggregateRequired;
    });
}

async function withAbortSignals<T>(promise: Promise<T>, signals: ReadonlyArray<AbortSignal | null | undefined>): Promise<T> {
    const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
    if (active.some(signal => signal.aborted)) throwIfAborted(active.find(signal => signal.aborted));
    if (active.length === 0) return await promise;
    return await new Promise<T>((resolve, reject) => {
        const cleanups = new Set<() => void>();
        const settle = (callback: () => void) => {
            for (const cleanup of cleanups) cleanup();
            cleanups.clear();
            callback();
        };
        for (const signal of active) {
            const onAbort = () => settle(() => {
                const error = new Error("Aborted");
                error.name = "AbortError";
                reject(error);
            });
            signal.addEventListener("abort", onAbort, { once: true });
            cleanups.add(() => signal.removeEventListener("abort", onAbort));
        }
        promise.then(
            value => settle(() => resolve(value)),
            error => settle(() => reject(error)),
        );
    });
}

function cloneProjectionMessage(message: PaAgentMessage): PaAgentMessage {
    if (message.role !== "toolResult") return message;
    const metadata = message.content.metadata;
    if (metadata?.vaultObservationContractVersion === 1) {
        const parsed = parseVaultObservationEvidence(metadata.vaultObservationEvidence);
        if (!parsed.ok) {
            // Do not serialize or traverse invalid raw metadata (including
            // unknown getters). Preserve only the strict failure state.
            return {
                ...message,
                content: {
                    ...message.content,
                    sourceRecords: [],
                    metadata: {
                        vaultObservationContractVersion: 1,
                        vaultObservationEvidenceInvalid: true,
                    },
                },
            };
        }
    }
    return {
        ...message,
        content: {
            ...message.content,
            sourceRecords: message.content.sourceRecords?.map(record => ({ ...record, metadata: record.metadata ? { ...record.metadata } : undefined })),
            metadata: metadata ? JSON.parse(stableJson(metadata)) as Record<string, unknown> : undefined,
        },
    };
}

function collectToolEvidence(transcript: readonly PaAgentMessage[]): EvidenceEntry[] {
    return transcript.flatMap((message): EvidenceEntry[] => {
        if (message.role !== "toolResult" || message.content.metadata?.vaultObservationContractVersion !== 1) return [];
        const parsed = parseVaultObservationEvidence(message.content.metadata.vaultObservationEvidence);
        const valid = parsed.ok && parsed.evidence.tool === message.toolName;
        return [{
            contract: true,
            ...(valid ? { evidence: parsed.evidence } : { invalid: true }),
            aggregateRequired: valid
                ? observationCarriesAggregatePromise(message.content.promptText)
                : true,
        }];
    });
}

function collectHistoryEvidence(history: readonly ChatMessage[]): EvidenceEntry[] {
    return history.flatMap((message): EvidenceEntry[] => {
        const state = evidenceState(message);
        if (!state.contract) return [];
        return state.evidence.map(evidence => {
            const parsed = parseVaultObservationEvidence(evidence);
            return {
                contract: true as const,
                ...(parsed.ok ? { evidence: parsed.evidence } : { invalid: true }),
                // History summaries are derived free text without a narrow
                // payload proof. Retained aggregate facts must stay aggregate-current.
                aggregateRequired: true,
            };
        });
    });
}

function observationCarriesAggregatePromise(promptText: string): boolean {
    try {
        const envelope = JSON.parse(promptText) as { tool?: unknown; observation?: Record<string, unknown> };
        const observation = envelope.observation;
        if (!observation || typeof observation !== "object" || Array.isArray(observation)) return true;
        if (envelope.tool !== "query_notes" && envelope.tool !== "search_vault_snippets") return true;
        const keys = envelope.tool === "query_notes"
            ? ["query", "matches", "matchCount", "matchCountKind", "coverage", "partialResultGuidance"]
            : ["kind", "query", "part", "caseSensitive", "matches", "matchCount", "matchCountKind", "coverage", "partialResultGuidance"];
        const present = new Set(Object.keys(observation));
        if (present.has("nextCursor") || present.has("sort") || present.has("page")) return true;
        if (!keys.every(key => present.has(key))) return true;
        const coverage = observation.coverage as Record<string, unknown> | undefined;
        if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return true;
        return Object.keys(coverage).length !== 1 || coverage.state !== "partial";
    } catch {
        return true;
    }
}

function evidenceState(message: ChatMessage): {
    contract: boolean;
    evidence: unknown[];
    hasEvidenceArray: boolean;
    invalid: boolean;
} {
    const metadata = message.memoryMetadata ?? message.canonicalTurn;
    return {
        contract: metadata?.vaultObservationContractVersion === 1,
        evidence: Array.isArray(metadata?.vaultObservationEvidence) ? metadata.vaultObservationEvidence : [],
        hasEvidenceArray: Array.isArray(metadata?.vaultObservationEvidence),
        invalid: metadata?.vaultObservationEvidenceInvalid === true,
    };
}

async function revalidateGroup(
    toolEntries: readonly EvidenceEntry[],
    historyEntries: readonly EvidenceEntry[],
    options: VaultObservationProjectionOptions,
): Promise<VaultObservationRevalidation[]> {
    const unique = new Map<string, VaultObservationEvidence>();
    for (const entry of [...toolEntries, ...historyEntries]) {
        if (!entry.evidence || unique.has(entry.evidence.observationId)) continue;
        unique.set(entry.evidence.observationId, entry.evidence);
    }
    const results: VaultObservationRevalidation[] = [];
    for (const evidence of unique.values()) {
        results.push(await options.revalidate(evidence, {
            signal: options.signal,
            isPathAllowed: options.isPathAllowed,
        }));
    }
    return results;
}

function sealEpoch(options: VaultObservationProjectionOptions): string {
    if (!options.getEpoch) throw new Error("Vault observation evidence epoch is unavailable.");
    return options.getEpoch();
}

async function projectTranscriptObservations(
    transcript: PaAgentMessage[],
    revalidations: ReadonlyMap<string, VaultObservationRevalidation>,
): Promise<void> {
    for (const message of transcript) {
        if (message.role !== "toolResult" || message.content.metadata?.vaultObservationContractVersion !== 1) continue;
        const parsed = parseVaultObservationEvidence(message.content.metadata.vaultObservationEvidence);
        if (!parsed.ok || parsed.evidence.tool !== message.toolName) {
            withdrawToolObservation(message);
            continue;
        }
        const result = revalidations.get(parsed.evidence.observationId);
        if (!result || !(await projectStructuredObservation(message, parsed.evidence, result))) {
            withdrawToolObservation(message);
        }
    }
}

function projectHistoryObservations(
    history: ChatMessage[],
    revalidations: ReadonlyMap<string, VaultObservationRevalidation>,
): void {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        const state = evidenceState(message);
        if (!state.contract) continue;
        const evidence = state.evidence.map(value => parseVaultObservationEvidence(value));
        if (state.invalid || !state.hasEvidenceArray || state.evidence.length === 0
            || evidence.some(parsed => !parsed.ok) || evidence.some(parsed => {
            if (!parsed.ok) return true;
            const result = revalidations.get(parsed.evidence.observationId);
            if (!result || result.validItemIndexes.length !== parsed.evidence.items.length) return true;
            return result.aggregateCurrent !== true;
        })) {
            history.splice(index, 1);
        }
    }
}

async function projectStructuredObservation(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
    evidence: VaultObservationEvidence,
    result: VaultObservationRevalidation,
): Promise<boolean> {
    let envelope: { tool?: unknown; status?: unknown; observation?: Record<string, unknown> };
    try {
        envelope = JSON.parse(message.content.promptText) as typeof envelope;
    } catch {
        return false;
    }
    if (envelope.tool !== evidence.tool || envelope.status !== "ok" || !envelope.observation) return false;
    const observation = envelope.observation;
    if (!result || !Array.isArray(result.validItemIndexes)
        || result.validItemIndexes.length !== new Set(result.validItemIndexes).size
        || result.validItemIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= evidence.items.length)
        || typeof result.aggregateCurrent !== "boolean") {
        return false;
    }
    if (evidence.tool !== "query_notes" && evidence.tool !== "search_vault_snippets") {
        return result.validItemIndexes.length === evidence.items.length
            && result.aggregateCurrent === true
            && await hashObservationValue(observation) === evidence.items[0].outputDigest;
    }
    const matches = observation.matches as unknown[];
    if (!Array.isArray(matches)) return false;
    if (matches.length !== evidence.items.length) return false;
    for (const [index, item] of evidence.items.entries()) {
        const match = matches[index];
        if (!match || typeof match !== "object" || Array.isArray(match)) return false;
        const matchRecord = match as Record<string, unknown>;
        if (matchRecord.path !== item.path) return false;
        const digest = await hashObservationValue(match);
        if (digest !== item.outputDigest) return false;
    }
    const retainedIndexes = new Set(result.validItemIndexes);
    const allItemsValid = evidence.items.every((_item, index) => retainedIndexes.has(index));
    if (allItemsValid && result.aggregateCurrent === true) return true;
    if (retainedIndexes.size === 0) return false;
    const originalMatches = [...matches];
    const projectedMatches = originalMatches.filter((_match, index) => retainedIndexes.has(index));
    const projectedObservation: Record<string, unknown> = {
        ...(evidence.tool === "search_vault_snippets" ? { kind: observation.kind } : {}),
        ...(observation.query === undefined ? {} : { query: observation.query }),
        ...(evidence.tool === "search_vault_snippets" && observation.scope !== undefined ? { scope: observation.scope } : {}),
        ...(evidence.tool === "search_vault_snippets" ? { part: observation.part, caseSensitive: observation.caseSensitive } : {}),
        matches: projectedMatches,
        matchCount: projectedMatches.length,
        matchCountKind: "lower-bound",
        coverage: { state: "partial" },
        partialResultGuidance: evidence.tool === "query_notes"
            ? "Some matches are no longer current. Re-query for current ordering and full coverage."
            : "Some snippets are no longer current. Re-search for current pagination and full coverage.",
    };
    envelope.observation = projectedObservation;
    message.content.promptText = JSON.stringify(envelope);
    message.content.sourceRecords = (message.content.sourceRecords ?? []).filter(record => {
        if (!record.path) return false;
        return evidence.items.some((item, index) => retainedIndexes.has(index) && item.path === record.path);
    });
    message.content.metadata = {
        ...message.content.metadata,
        vaultObservationEvidence: await rebindStructuredEvidence(evidence, observation, result, originalMatches),
        vaultObservationContractVersion: 1,
    };
    return projectedMatches.length > 0;
}

async function rebindStructuredEvidence(
    evidence: Extract<VaultObservationEvidence, { tool: "query_notes" | "search_vault_snippets" }>,
    observation: Record<string, unknown>,
    result: VaultObservationRevalidation,
    originalMatches: readonly unknown[],
): Promise<VaultObservationEvidence> {
    const retained = new Set(result.validItemIndexes);
    if (evidence.tool === "query_notes") {
        const copy = JSON.parse(stableJson(evidence)) as Extract<typeof evidence, { tool: "query_notes" }>;
        const originalItems = copy.items;
        copy.items = [];
        for (const [index, item] of originalItems.entries()) {
            if (!retained.has(index)) continue;
            copy.items.push({
                ...item,
                index: copy.items.length,
                outputDigest: await hashObservationValue(originalMatches[index]),
            });
        }
        copy.coverage = {
            ...copy.coverage,
            state: "partial",
        };
        copy.aggregate.completeCandidateSet = false;
        copy.aggregate.projectionComplete = false;
        return copy;
    }
    const copy = JSON.parse(stableJson(evidence)) as Extract<typeof evidence, { tool: "search_vault_snippets" }>;
    const originalItems = copy.items;
    copy.items = [];
    for (const [index, item] of originalItems.entries()) {
        if (!retained.has(index)) continue;
        copy.items.push({
                ...item,
                index: copy.items.length,
            outputDigest: await hashObservationValue(originalMatches[index]),
        });
    }
    copy.coverage = {
        ...copy.coverage,
        state: "partial",
    };
    return copy;
}

function withdrawToolObservation(message: Extract<PaAgentMessage, { role: "toolResult" }>): void {
    message.content.promptText = JSON.stringify({
        tool: message.toolName,
        status: "unavailable",
        error: "Vault observation evidence is currently unavailable.",
    });
    message.content.sourceRecords = [];
    message.content.metadata = {
        ...message.content.metadata,
        vaultObservationEvidenceInvalid: true,
        vaultObservationContractVersion: 1,
    };
    delete message.content.metadata.vaultObservationEvidence;
}

function parseSnippetPart(value: unknown): SearchVaultSnippetPart {
    return enumeration(value, ["body", "properties", "all"]);
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Vault observation value must be an object.");
    return value as Record<string, unknown>;
}

function expectKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
    const expected = new Set([...required, ...optional]);
    for (const key of Object.keys(record)) if (!expected.has(key)) throw new Error(`Unknown vault observation field: ${key}.`);
    for (const key of required) if (!Object.prototype.hasOwnProperty.call(record, key)) throw new Error(`Missing vault observation field: ${key}.`);
}

function string(value: unknown, name: string, max?: number): string {
    if (typeof value !== "string" || !value || (max !== undefined && value.length > max)) {
        throw new Error(`Invalid ${name}.`);
    }
    return value;
}

function path(value: unknown, max?: number): string {
    return string(value, "path", max);
}

function hash(value: unknown): string {
    if (typeof value !== "string" || !HASH40.test(value)) throw new Error("Invalid vault observation hash.");
    return value;
}

function boolean(value: unknown): boolean {
    if (typeof value !== "boolean") throw new Error("Invalid vault observation boolean.");
    return value;
}

function booleans(record: Record<string, unknown>, keys: readonly string[]): void {
    for (const key of keys) boolean(record[key]);
}

function safeInteger(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid vault observation integer.");
    return value;
}

function integers(record: Record<string, unknown>, keys: readonly string[]): void {
    for (const key of keys) safeInteger(record[key]);
}

function integer(value: unknown): number {
    return safeInteger(value);
}

function enumeration<T extends string>(value: unknown, values: readonly T[]): T {
    if (typeof value !== "string" || !values.includes(value as T)) throw new Error("Invalid vault observation enumeration.");
    return value as T;
}

function pathArray(value: unknown, name: string): string[] {
    if (!Array.isArray(value) || value.length > SCOPE_PATHS_MAX) throw new Error(`Invalid ${name}.`);
    return value.map(item => path(item));
}

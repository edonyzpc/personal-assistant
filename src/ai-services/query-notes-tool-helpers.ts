import { getAllTags } from "obsidian";
import type { MarkdownFileLike } from "./chat-tool-execution-helpers";
import {
    getFileTitle,
    getOptionalMetadataCache,
    getUtf8ByteLength,
    getVault,
} from "./chat-tool-execution-helpers";
import type {
    QueryNotesCoverage,
    QueryNotesInput,
    QueryNotesMatch,
    QueryNotesOutput,
    QueryNotesPropertyValue,
} from "./chat-tool-types";
import {
    QUERY_NOTES_MAX_CANDIDATES,
    QUERY_NOTES_PROJECTION_MAX_UTF8_BYTES,
    QUERY_NOTES_RESULT_JSON_BUDGET_CHARS,
} from "./chat-tool-constants";
import { canonicalizeQueryNotesInput } from "./chat-tool-guards";
import { throwIfAborted } from "./chat-utils";
import { computeContentHash } from "../vss-helpers";

export class QueryNotesUnavailableError extends Error {}
export class QueryNotesCursorExpiredError extends Error {}
export class QueryNotesResultBudgetUnavailableError extends Error {}

export interface QueryNotesExecutionOptions {
    input: QueryNotesInput;
    host: Parameters<typeof getVault>[0];
    instancePrefix: string;
    identities: QueryNotesFileIdentityRegistry;
    signal?: AbortSignal;
    isPathReadable?: (path: string) => boolean;
    assertCurrent?: () => void;
    onMetadataDependency?: (path: string) => void;
    dependencyPaths?: Set<string>;
}

export interface QueryNotesExecutionResult {
    content: QueryNotesOutput;
    matches: readonly QueryNotesMatch[];
    dependencyPaths: ReadonlySet<string>;
    evidence: {
        candidatePaths: string[];
        metadataSnapshots: unknown[];
        matchMetadataSnapshots: unknown[];
    };
}

export class QueryNotesFileIdentityRegistry {
    private readonly identities = new WeakMap<object, string>();
    private nextFileSequence = 0;
    private static readonly sequenceWidth = 10;
    private static readonly maxSequence = 10 ** QueryNotesFileIdentityRegistry.sequenceWidth - 1;

    constructor(private readonly instancePrefix: string) {}

    register(file: object): string {
        const existing = this.identities.get(file);
        if (existing) return existing;
        if (this.nextFileSequence >= QueryNotesFileIdentityRegistry.maxSequence) {
            throw new Error("Query notes file identity sequence is exhausted.");
        }
        this.nextFileSequence += 1;
        const identity = `${this.instancePrefix}-${String(this.nextFileSequence).padStart(
            QueryNotesFileIdentityRegistry.sequenceWidth,
            "0",
        )}`;
        this.identities.set(file, identity);
        return identity;
    }
}

const QUERY_NOTES_IDENTITY_SEQUENCE_WIDTH = 10;
/** Fixed-width private identities are excluded from durable evidence; pure
 * revalidation only needs an equal-length placeholder for the shared budget. */
export const QUERY_NOTES_PRIVATE_IDENTITY_PLACEHOLDER = "0".repeat(
    32 + 1 + QUERY_NOTES_IDENTITY_SEQUENCE_WIDTH,
);

type UnknownMarker = { state: "unknown" };
type AbsentMarker = { state: "absent" };
type OversizedMarker = { state: "oversized" };
type PresentMarker = { state: "present" };
type IncompatibleMarker = { state: "incompatible" };
type ValueMarker = { state: "value"; value: unknown };
type PropertySnapshot = UnknownMarker | AbsentMarker | OversizedMarker | PresentMarker | IncompatibleMarker | ValueMarker;
type StatSnapshot = number | UnknownMarker;
type TagSnapshot = UnknownMarker | OversizedMarker | ValueMarker;

interface QueryNotesSnapshotItem {
    path: string;
    identity: string;
    ctime?: StatSnapshot;
    mtime?: StatSnapshot;
    tags?: TagSnapshot;
    properties?: Record<string, PropertySnapshot>;
}

export type QueryNotesPublicSnapshot = Omit<QueryNotesSnapshotItem, "identity">;

interface QueryNotesSnapshot {
    version: 1;
    completeCandidateSet: boolean;
    projectionComplete: boolean;
    candidates: QueryNotesSnapshotItem[];
}

interface QueryNotesEvaluatedItem {
    file: MarkdownFileLike;
    snapshot: QueryNotesSnapshotItem;
    match: boolean | "unknown";
    sortValueKnown: boolean;
}

interface QueryNotesEvaluation {
    snapshot: QueryNotesSnapshot;
    items: QueryNotesEvaluatedItem[];
    candidatePaths: string[];
    scannedPermittedNotes: number;
    candidateCapExceeded: boolean;
    projectionBudgetExceeded: boolean;
    hasUnknownEvaluation: boolean;
}

export function isInStaticQueryScope(path: string, input: Omit<QueryNotesInput, "limit" | "cursor">): boolean {
    if (input.path !== undefined && path !== input.path) return false;
    if (input.folder === undefined || input.folder === "") return true;
    return path.startsWith(`${input.folder}/`);
}

interface PropertyUsage {
    exists: boolean;
    equals: boolean;
    contains: boolean;
    date: boolean;
}

const RELEVANT_METADATA_VALUE_MAX_UTF8_BYTES = 16_384;
const RELEVANT_METADATA_MAX_ARRAY_ENTRIES = Math.floor(RELEVANT_METADATA_VALUE_MAX_UTF8_BYTES / 2);

interface QueryNotesTagCache {
    tags?: Array<{ tag?: string }>;
    frontmatter?: Record<string, unknown>;
}

interface QueryNotesCursor {
    version: 1;
    instance: string;
    query: string;
    snapshot: string;
    nextIndex: number;
}

export async function executeQueryNotes(
    options: QueryNotesExecutionOptions,
): Promise<QueryNotesExecutionResult> {
    const { input, signal } = options;
    throwIfAborted(signal);
    options.assertCurrent?.();

    const queryDigest = await computeContentHash(canonicalizeQueryNotesInput(input));
    throwIfAborted(signal);
    options.assertCurrent?.();
    const cursor = input.cursor ? decodeQueryNotesCursor(input.cursor) : null;
    if (cursor && (cursor.instance !== options.instancePrefix || cursor.query !== queryDigest)) {
        throw new QueryNotesCursorExpiredError("query_notes cursor targets a different query or tool instance.");
    }

    let evaluation = await evaluateQueryNotes(options);
    let canonicalSnapshot = JSON.stringify(evaluation.snapshot);
    let snapshotDigest = "";
    const complete = isCompleteEvaluation(evaluation);

    if (complete) {
        snapshotDigest = await computeContentHash(canonicalSnapshot);
        throwIfAborted(signal);
        options.assertCurrent?.();
        const rebuilt = await evaluateQueryNotes(options);
        const rebuiltCanonical = JSON.stringify(rebuilt.snapshot);
        if (rebuiltCanonical !== canonicalSnapshot) {
            throw new QueryNotesCursorExpiredError("query_notes sources changed while the snapshot was being verified.");
        }
        options.assertCurrent?.();
        if (cursor && cursor.snapshot !== snapshotDigest) {
            throw new QueryNotesCursorExpiredError("query_notes cursor snapshot is no longer current.");
        }
        canonicalSnapshot = rebuiltCanonical;
        evaluation = rebuilt;
    } else if (cursor) {
        throw new QueryNotesCursorExpiredError("query_notes can no longer verify the cursor's complete snapshot.");
    }

    const knownMatches = evaluation.items.filter(item => item.match === true);
    const requestedSort = input.sort;
    const actualSort = complete ? requestedSort : { field: "path" as const, direction: "asc" as const };
    const orderedMatches = [...knownMatches].sort((left, right) => compareQueryNotesItems(
        left,
        right,
        complete ? requestedSort : actualSort,
    ));

    let nextIndex = 0;
    if (cursor) {
        if (cursor.nextIndex < 0 || cursor.nextIndex >= orderedMatches.length) {
            throw new QueryNotesCursorExpiredError("query_notes cursor page is outside the current result set.");
        }
        nextIndex = cursor.nextIndex;
    }

    const selected: QueryNotesEvaluatedItem[] = [];
    for (let index = nextIndex; index < orderedMatches.length && selected.length < input.limit; index += 1) {
        const candidate = [...selected, orderedMatches[index]!];
        const hasMore = index + 1 < orderedMatches.length;
        const prospectiveNextIndex = nextIndex + selected.length + 1;
        const content = makeOutput({
            input,
            items: candidate,
            matchCount: knownMatches.length,
            exact: complete,
            sort: actualSort,
            evaluation,
            nextCursor: hasMore ? encodeQueryNotesCursor({
                version: 1,
                instance: options.instancePrefix,
                query: queryDigest,
                snapshot: snapshotDigest,
                nextIndex: prospectiveNextIndex,
            }) : undefined,
        });
        if (JSON.stringify(content).length <= QUERY_NOTES_RESULT_JSON_BUDGET_CHARS) {
            selected.push(orderedMatches[index]!);
            continue;
        }
        if (!hasMore) {
            const withoutCursor = makeOutput({
                input,
                items: candidate,
                matchCount: knownMatches.length,
                exact: complete,
                sort: actualSort,
                evaluation,
            });
            if (JSON.stringify(withoutCursor).length <= QUERY_NOTES_RESULT_JSON_BUDGET_CHARS) {
                selected.push(orderedMatches[index]!);
            }
        }
        break;
    }

    if (selected.length === 0 && orderedMatches.length > nextIndex) {
        throw new QueryNotesResultBudgetUnavailableError(
            "query_notes cannot fit its result metadata and the next complete match in the output budget.",
        );
    }

    const finalNextIndex = nextIndex + selected.length;
    const hasMore = finalNextIndex < orderedMatches.length;
    if (!complete && cursor) throw new QueryNotesCursorExpiredError("query_notes cursor coverage is no longer complete.");
    const content = makeOutput({
        input,
        items: selected,
        matchCount: knownMatches.length,
        exact: complete,
        sort: actualSort,
        evaluation,
        nextCursor: complete && hasMore ? encodeQueryNotesCursor({
            version: 1,
            instance: options.instancePrefix,
            query: queryDigest,
            snapshot: snapshotDigest,
            nextIndex: finalNextIndex,
        }) : undefined,
    });
    if (JSON.stringify(content).length > QUERY_NOTES_RESULT_JSON_BUDGET_CHARS) {
        throw new QueryNotesResultBudgetUnavailableError("query_notes result exceeds its output budget.");
    }
    throwIfAborted(signal);
    options.assertCurrent?.();

    return {
        content,
        matches: content.matches,
        dependencyPaths: options.dependencyPaths ?? new Set<string>(),
        evidence: {
            candidatePaths: [...evaluation.candidatePaths],
            metadataSnapshots: evaluation.snapshot.candidates.map(removeSnapshotIdentity),
            matchMetadataSnapshots: selected.map(item => removeSnapshotIdentity(item.snapshot)),
        },
    };
}

function removeSnapshotIdentity(snapshot: QueryNotesSnapshotItem): Omit<QueryNotesSnapshotItem, "identity"> {
    const { identity, ...copy } = snapshot;
    return identity ? copy : copy;
}

export function projectQueryMetadata(
    file: { path: string; stat?: { ctime?: unknown; mtime?: unknown } },
    cache: unknown,
    query: Omit<QueryNotesInput, "limit" | "cursor">,
): QueryNotesPublicSnapshot {
    const cacheRecord = cache && typeof cache === "object" ? cache as QueryNotesTagCache : undefined;
    const cacheKnown = cacheRecord !== undefined;
    const frontmatter = cacheRecord?.frontmatter && typeof cacheRecord.frontmatter === "object"
        ? cacheRecord.frontmatter
        : undefined;
    const conditions = Array.isArray(query.properties)
        ? query.properties
        : [];
    const propertyUsage = new Map<string, PropertyUsage>();
    for (const condition of conditions) {
        const current = propertyUsage.get(condition.key)
            ?? { exists: false, equals: false, contains: false, date: false };
        if (condition.operator === "exists") current.exists = true;
        else if (condition.operator === "equals") current.equals = true;
        else current.contains = true;
        propertyUsage.set(condition.key, current);
    }
    if (query.date?.field === "property") {
        const key = query.date.property;
        if (key !== undefined) {
            const current = propertyUsage.get(key)
                ?? { exists: false, equals: false, contains: false, date: false };
            current.date = true;
            propertyUsage.set(key, current);
        }
    }
    const properties = [...propertyUsage.keys()].sort();
    const sort = query.sort;
    const date = query.date;
    const needsTags = Array.isArray(query.tags) && query.tags.length > 0;
    const needsCtime = sort?.field === "ctime" || date?.field === "ctime";
    const needsMtime = sort?.field === "mtime" || date?.field === "mtime";
    const statNumber = (value: unknown): StatSnapshot => typeof value === "number" && Number.isFinite(value)
        ? value
        : { state: "unknown" };
    const snapshot: QueryNotesPublicSnapshot = {
        path: file.path,
        ...(needsCtime ? { ctime: statNumber(file.stat?.ctime) } : {}),
        ...(needsMtime ? { mtime: statNumber(file.stat?.mtime) } : {}),
        ...(needsTags ? { tags: captureTagsSnapshot(cacheRecord ?? {}, cacheKnown) } : {}),
        ...(properties.length > 0 ? {
            properties: properties.reduce<Record<string, PropertySnapshot>>((result, key) => {
                result[key] = capturePropertySnapshot(frontmatter, key, cacheKnown, propertyUsage.get(key)!);
                return result;
            }, Object.create(null)),
        } : {}),
    };
    return snapshot;
    return {
        path: file.path,
        ...(needsCtime ? { ctime: statNumber(file.stat?.ctime) } : {}),
        ...(needsMtime ? { mtime: statNumber(file.stat?.mtime) } : {}),
        ...(needsTags ? { tags: captureTagsSnapshot(cacheRecord ?? {}, cacheKnown) } : {}),
        ...(properties.length > 0 ? {
            properties: properties.reduce<Record<string, PropertySnapshot>>((result, key) => {
                result[key] = capturePropertySnapshot(frontmatter, key, cacheKnown, propertyUsage.get(key)!);
                return result;
            }, Object.create(null)),
        } : {}),
    };
}

async function evaluateQueryNotes(options: QueryNotesExecutionOptions): Promise<QueryNotesEvaluation> {
    const { input, signal } = options;
    const vault = getVault(options.host);
    if (typeof vault.getMarkdownFiles !== "function") {
        throw new QueryNotesUnavailableError("Vault getMarkdownFiles is unavailable.");
    }
    throwIfAborted(signal);
    const files = vault.getMarkdownFiles();
    if (!Array.isArray(files)) throw new QueryNotesUnavailableError("Vault getMarkdownFiles returned an invalid result.");

    const neededStatFields = new Set<string>();
    if (input.sort?.field === "ctime" || input.date?.field === "ctime") neededStatFields.add("ctime");
    if (input.sort?.field === "mtime" || input.date?.field === "mtime") neededStatFields.add("mtime");
    const neededProperties = new Map<string, PropertyUsage>();
    const needProperty = (key: string, usage: Partial<PropertyUsage>) => {
        const current = neededProperties.get(key) ?? { exists: false, equals: false, contains: false, date: false };
        neededProperties.set(key, { ...current, ...usage });
    };
    for (const condition of input.properties ?? []) {
        if (condition.operator === "exists") needProperty(condition.key, { exists: true });
        else if (condition.operator === "equals") needProperty(condition.key, { equals: true });
        else needProperty(condition.key, { contains: true });
    }
    if (input.date?.field === "property") needProperty(input.date.property!, { date: true });
    const needsCache = Boolean(input.tags?.length || neededProperties.size);
    const sortedPropertyKeys = [...neededProperties.keys()].sort();
    const metadataCache = needsCache ? getOptionalMetadataCache(options.host) : undefined;
    let metadataFileCache: ((file: MarkdownFileLike) => QueryNotesTagCache | null | undefined) | undefined;
    if (needsCache) {
        if (!metadataCache || typeof metadataCache.getFileCache !== "function") {
            throw new QueryNotesUnavailableError("MetadataCache getFileCache is unavailable.");
        }
        metadataFileCache = metadataCache.getFileCache.bind(metadataCache);
    }

    const permittedFiles: MarkdownFileLike[] = [];
    let scannedPermittedNotes = 0;
    for (const file of files) {
        throwIfAborted(signal);
        options.assertCurrent?.();
        if (!file || typeof file.path !== "string" || !file.path) continue;
        if (options.isPathReadable && !options.isPathReadable(file.path)) continue;
        permittedFiles.push(file);
        scannedPermittedNotes += 1;
        if (scannedPermittedNotes % 64 === 0) {
            await Promise.resolve();
            throwIfAborted(signal);
            options.assertCurrent?.();
        }
    }
    permittedFiles.sort((left, right) => comparePaths(left.path, right.path));

    const items: QueryNotesEvaluatedItem[] = [];
    let candidateCapExceeded = false;
    let projectionBudgetExceeded = false;
    let hasUnknownEvaluation = false;
    const projectionBudget = createSnapshotProjectionBudget(QUERY_NOTES_PROJECTION_MAX_UTF8_BYTES);

    outer: for (const file of permittedFiles) {
        throwIfAborted(signal);
        options.assertCurrent?.();
        if (scannedPermittedNotes % 64 === 0) {
            await Promise.resolve();
            throwIfAborted(signal);
            options.assertCurrent?.();
        }
        if (!isInStaticQueryScope(file.path, input)) continue;
        if (input.path === undefined && items.length >= QUERY_NOTES_MAX_CANDIDATES) {
            candidateCapExceeded = true;
            break outer;
        }

        const identity = options.identities.register(file);
        options.onMetadataDependency?.(file.path);
        let ctime: StatSnapshot | undefined;
        let mtime: StatSnapshot | undefined;
        if (neededStatFields.has("ctime")) ctime = readStatValue(file, "ctime");
        if (neededStatFields.has("mtime")) mtime = readStatValue(file, "mtime");

        let tags: TagSnapshot | undefined;
        let frontmatter: Record<string, unknown> | undefined | null;
        let cacheKnown = true;
        const propertySnapshots: Record<string, PropertySnapshot> = Object.create(null);
        if (needsCache) {
            options.assertCurrent?.();
            const cache = metadataFileCache!(file);
            if (!cache || typeof cache !== "object") {
                cacheKnown = false;
                frontmatter = undefined;
                if (input.tags?.length) tags = { state: "unknown" };
            } else {
                frontmatter = cache.frontmatter;
                if (input.tags?.length) {
                    tags = captureTagsSnapshot(cache as QueryNotesTagCache, cacheKnown);
                }
            }
        }

        const conditionOutcomes: Array<boolean | "unknown"> = [];
        const sortValueKnown = input.sort?.field === "path"
            || (input.sort?.field === "ctime" && isKnownStat(ctime))
            || (input.sort?.field === "mtime" && isKnownStat(mtime));

        if (input.tags?.length) {
            conditionOutcomes.push(evaluateTagsCondition(input.tags, tags));
        }

        for (const key of sortedPropertyKeys) {
            propertySnapshots[key] = capturePropertySnapshot(
                frontmatter,
                key,
                cacheKnown,
                neededProperties.get(key)!,
            );
        }

        for (const condition of input.properties ?? []) {
            conditionOutcomes.push(evaluatePropertyCondition(
                condition,
                propertySnapshots[condition.key]!,
            ));
        }

        if (input.date) {
            conditionOutcomes.push(evaluateDateCondition(
                input.date,
                input.date.field === "ctime" ? ctime : input.date.field === "mtime" ? mtime : undefined,
                input.date.field === "property" ? propertySnapshots[input.date.property!] : undefined,
            ));
        }

        let match: boolean | "unknown" = true;
        if (conditionOutcomes.includes(false)) {
            match = false;
        } else if (conditionOutcomes.includes("unknown")) {
            match = "unknown";
        }

        for (const snapshot of Object.values(propertySnapshots)) {
            if (snapshot.state === "oversized") projectionBudgetExceeded = true;
        }
        if (tags?.state === "oversized") projectionBudgetExceeded = true;

        const itemHasUnknownEvaluation = match === "unknown"
            || (!sortValueKnown && match !== false);
        if (itemHasUnknownEvaluation) hasUnknownEvaluation = true;

        if (!projectionBudget.append({
            path: file.path,
            ...(ctime === undefined ? {} : { ctime }),
            ...(mtime === undefined ? {} : { mtime }),
            ...(tags === undefined ? {} : { tags }),
            ...(Object.keys(propertySnapshots).length === 0 ? {} : { properties: propertySnapshots }),
        }, identity)) {
            projectionBudgetExceeded = true;
            break outer;
        }

        items.push({
            file,
            snapshot: projectionBudget.lastAppended!,
            match,
            sortValueKnown,
        });
        if (input.path) break outer;
    }

    throwIfAborted(signal);
    options.assertCurrent?.();
    return {
        snapshot: {
            version: 1,
            completeCandidateSet: !candidateCapExceeded,
            projectionComplete: !projectionBudgetExceeded,
            candidates: projectionBudget.candidates,
        },
        items,
        candidatePaths: permittedFiles
            .filter(file => isInStaticQueryScope(file.path, input))
            .map(file => file.path),
        scannedPermittedNotes,
        candidateCapExceeded,
        projectionBudgetExceeded,
        hasUnknownEvaluation,
    };
}

function readStatValue(file: MarkdownFileLike, field: "ctime" | "mtime"): StatSnapshot {
    const value = file.stat?.[field];
    return typeof value === "number" && Number.isFinite(value) ? value : { state: "unknown" };
}

function isKnownStat(value: StatSnapshot | undefined): value is number {
    return typeof value === "number";
}

function capturePropertySnapshot(
    frontmatter: Record<string, unknown> | null | undefined,
    key: string,
    cacheKnown: boolean,
    usage: PropertyUsage,
): PropertySnapshot {
    if (!cacheKnown) return { state: "unknown" };
    if (!frontmatter || typeof frontmatter !== "object"
        || !Object.prototype.hasOwnProperty.call(frontmatter, key)) {
        return { state: "absent" };
    }

    // Existence only needs the key fact. In particular, it must not materialize
    // or recursively copy a complex YAML value.
    if (usage.exists && !usage.equals && !usage.contains && !usage.date) {
        return { state: "present" };
    }

    const actual = frontmatter[key]!;
    if (usage.contains && Array.isArray(actual)) {
        const captured = captureBoundedScalarArray(actual, RELEVANT_METADATA_VALUE_MAX_UTF8_BYTES);
        return captured ? { state: "value", value: captured.value } : { state: "oversized" };
    }
    if (!isJsonScalar(actual)) return { state: "incompatible" };
    if (typeof actual === "string" && actual.length > RELEVANT_METADATA_VALUE_MAX_UTF8_BYTES) {
        return { state: "oversized" };
    }

    const token = JSON.stringify(actual);
    if (getUtf8ByteLength(token) > RELEVANT_METADATA_VALUE_MAX_UTF8_BYTES) {
        return { state: "oversized" };
    }
    return { state: "value", value: actual };
}

function captureTagsSnapshot(
    cache: QueryNotesTagCache,
    cacheKnown: boolean,
): TagSnapshot {
    if (!cacheKnown) return { state: "unknown" };
    if (hasObviouslyOversizedTagInput(cache, RELEVANT_METADATA_VALUE_MAX_UTF8_BYTES)) {
        return { state: "oversized" };
    }
    if (typeof getAllTags !== "function") {
        throw new QueryNotesUnavailableError("Obsidian getAllTags is unavailable.");
    }
    let rawTags: string[] | null;
    try {
        rawTags = getAllTags(cache as Parameters<typeof getAllTags>[0]);
    } catch (error) {
        throw new QueryNotesUnavailableError(
            error instanceof Error ? error.message : "Obsidian getAllTags failed.",
        );
    }
    if ((rawTags ?? []).length > RELEVANT_METADATA_MAX_ARRAY_ENTRIES) {
        return { state: "oversized" };
    }
    const captured = captureBoundedScalarArray(rawTags ?? [], RELEVANT_METADATA_VALUE_MAX_UTF8_BYTES);
    return captured ? { state: "value", value: captured.value } : { state: "oversized" };
}

function evaluatePropertyCondition(
    condition: { key: string; operator: "exists" | "equals" | "contains"; value?: QueryNotesPropertyValue },
    snapshot: PropertySnapshot,
): boolean | "unknown" {
    if (snapshot.state === "unknown" || snapshot.state === "oversized") return "unknown";
    if (snapshot.state === "absent") return false;
    if (snapshot.state === "present") {
        return condition.operator === "exists";
    }
    if (snapshot.state === "incompatible") return false;

    const actual = snapshot.value;
    if (condition.operator === "exists") return true;
    const expected = condition.value as QueryNotesPropertyValue;
    if (condition.operator === "equals") {
        return isJsonScalar(actual) && jsonScalarEquals(actual, expected);
    }
    if (typeof actual === "string") {
        return typeof expected === "string" && actual.includes(expected);
    }
    if (Array.isArray(actual)) {
        return actual.some(member => isJsonScalar(member) && jsonScalarEquals(member, expected));
    }
    return false;
}

function hasObviouslyOversizedTagInput(
    cache: QueryNotesTagCache,
    maxBytes: number,
): boolean {
    if (Array.isArray(cache.tags)) {
        if (cache.tags.length > RELEVANT_METADATA_MAX_ARRAY_ENTRIES) return true;
        if (cache.tags.some(entry => typeof entry.tag === "string" && entry.tag.length > maxBytes)) return true;
    }
    const frontmatter = cache.frontmatter;
    if (!frontmatter || typeof frontmatter !== "object") return false;
    for (const key of ["tags", "tag"] as const) {
        const value = frontmatter[key];
        if (Array.isArray(value)) {
            if (value.length > RELEVANT_METADATA_MAX_ARRAY_ENTRIES) return true;
            if (value.some(entry => typeof entry === "string" && entry.length > maxBytes)) return true;
            continue;
        }
        if (typeof value === "string" && value.length > maxBytes) return true;
    }
    return false;
}

function evaluateTagsCondition(
    requestedTags: readonly string[],
    snapshot: TagSnapshot | undefined,
): boolean | "unknown" {
    if (!snapshot) return true;
    if (snapshot.state === "unknown" || snapshot.state === "oversized") return "unknown";
    const rawTags = snapshot.value;
    if (!Array.isArray(rawTags)) return "unknown";
    const available = new Set(rawTags
        .filter((tag): tag is string => typeof tag === "string")
        .map(tag => normalizeQueryTag(tag)));
    return requestedTags.every(tag => available.has(normalizeQueryTag(tag)));
}

function normalizeQueryTag(tag: string): string {
    return (tag.startsWith("#") ? tag.slice(1) : tag).toLowerCase();
}

function evaluateDateCondition(
    date: NonNullable<QueryNotesInput["date"]>,
    statValue: StatSnapshot | undefined,
    propertySnapshot: PropertySnapshot | undefined,
): boolean | "unknown" {
    let valueMs: number | undefined;
    if (date.field === "ctime" || date.field === "mtime") {
        if (!isKnownStat(statValue)) return "unknown";
        valueMs = statValue;
    } else {
        if (!propertySnapshot || propertySnapshot.state === "absent") return false;
        if (propertySnapshot.state !== "value") return "unknown";
        const actual = propertySnapshot.value;
        if (typeof actual !== "string") return "unknown";
        if (date.kind === "calendar-date") {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(actual) || !isValidCalendarDate(actual)) return "unknown";
            valueMs = Date.UTC(
                Number(actual.slice(0, 4)),
                Number(actual.slice(5, 7)) - 1,
                Number(actual.slice(8, 10)),
            );
        } else if (!isIsoTimestampWithValue(actual) || !isValidIsoTimestamp(actual)) {
            return "unknown";
        } else {
            valueMs = Date.parse(actual);
        }
    }

    const from = parseQueryBoundary(date.kind, date.from);
    const to = parseQueryBoundary(date.kind, date.to);
    return valueMs >= from && valueMs < to;
}

function parseQueryBoundary(kind: "timestamp" | "calendar-date", value: string): number {
    if (kind === "calendar-date") {
        return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
    }
    return Date.parse(value);
}

function isJsonScalar(value: unknown): value is QueryNotesPropertyValue {
    return value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

function jsonScalarEquals(left: QueryNotesPropertyValue, right: QueryNotesPropertyValue): boolean {
    if (typeof left !== typeof right) return false;
    if (typeof left === "number" && !Number.isFinite(left)) return false;
    return left === right;
}

function isIsoTimestampWithValue(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function isValidIsoTimestamp(value: string): boolean {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    return isValidCalendarDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function isValidCalendarDate(value: string): boolean {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (month < 1 || month > 12 || day < 1) return false;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
    return day <= daysInMonth;
}

function captureBoundedScalarArray(
    value: readonly unknown[],
    maxBytes: number,
): { value: unknown[]; bytes: number } | null {
    if (value.length > RELEVANT_METADATA_MAX_ARRAY_ENTRIES) return null;
    let bytes = 2;
    const normalized: QueryNotesPropertyValue[] = [];
    for (const entry of value) {
        // Non-scalar entries cannot satisfy the strict scalar member semantics;
        // they are intentionally ignored instead of recursively materialized.
        if (!isJsonScalar(entry)) continue;
        if (typeof entry === "string" && entry.length > maxBytes) return null;
        const token = JSON.stringify(entry);
        const tokenBytes = getUtf8ByteLength(token);
        const separator = normalized.length === 0 ? 0 : 1;
        if (bytes + separator + tokenBytes > maxBytes) return null;
        bytes += separator + tokenBytes;
        normalized.push(entry);
    }
    return { value: normalized, bytes };
}

export function createSnapshotProjectionBudget(maxBytes: number): {
    candidates: QueryNotesSnapshotItem[];
    lastAppended: QueryNotesSnapshotItem | undefined;
    append(item: QueryNotesPublicSnapshot, identity?: string): boolean;
} {
    // Reserve the larger false/false flags so partial and complete snapshots
    // measure candidate JSON with the same complete-JSON magnitude.
    const prefixBytes = getUtf8ByteLength(
        '{"version":1,"completeCandidateSet":false,"projectionComplete":false,"candidates":[',
    );
    const closingBytes = getUtf8ByteLength(']}');
    const candidates: QueryNotesSnapshotItem[] = [];
    let candidateBytes = 0;
    let appendedCount = 0;
    return {
        candidates,
        lastAppended: undefined,
        append(item: QueryNotesPublicSnapshot, identity?: string): boolean {
            const budgetedItem: QueryNotesSnapshotItem = {
                path: item.path,
                identity: identity ?? QUERY_NOTES_PRIVATE_IDENTITY_PLACEHOLDER,
                ...(item.ctime === undefined ? {} : { ctime: item.ctime }),
                ...(item.mtime === undefined ? {} : { mtime: item.mtime }),
                ...(item.tags === undefined ? {} : { tags: item.tags }),
                ...(item.properties === undefined ? {} : { properties: item.properties }),
            };
            const itemBytes = getUtf8ByteLength(JSON.stringify(budgetedItem));
            const separatorBytes = appendedCount === 0 ? 0 : 1;
            const prospectiveBytes = prefixBytes + candidateBytes
                + separatorBytes + itemBytes + closingBytes;
            if (prospectiveBytes > maxBytes) return false;
            candidateBytes += separatorBytes + itemBytes;
            appendedCount += 1;
            if (identity !== undefined) {
                candidates.push(budgetedItem);
                this.lastAppended = budgetedItem;
            }
            return true;
        },
    };
}

function isCompleteEvaluation(evaluation: QueryNotesEvaluation): boolean {
    return !evaluation.candidateCapExceeded
        && !evaluation.projectionBudgetExceeded
        && !evaluation.hasUnknownEvaluation;
}

function compareQueryNotesItems(
    left: QueryNotesEvaluatedItem,
    right: QueryNotesEvaluatedItem,
    sort: NonNullable<QueryNotesInput["sort"]>,
): number {
    if (sort.field !== "path") {
        const leftValue = sort.field === "ctime" ? left.snapshot.ctime : left.snapshot.mtime;
        const rightValue = sort.field === "ctime" ? right.snapshot.ctime : right.snapshot.mtime;
        if (isKnownStat(leftValue) && isKnownStat(rightValue) && leftValue !== rightValue) {
            const delta = leftValue - rightValue;
            return sort.direction === "asc" ? delta : -delta;
        }
        return comparePaths(left.snapshot.path, right.snapshot.path);
    }
    return comparePaths(left.snapshot.path, right.snapshot.path) * (sort.direction === "asc" ? 1 : -1);
}

function comparePaths(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function makeOutput(options: {
    input: QueryNotesInput;
    items: readonly QueryNotesEvaluatedItem[];
    matchCount: number;
    exact: boolean;
    sort: NonNullable<QueryNotesInput["sort"]>;
    evaluation: QueryNotesEvaluation;
    nextCursor?: string;
}): QueryNotesOutput {
    const query = JSON.parse(canonicalizeQueryNotesInput(options.input)) as Omit<QueryNotesInput, "limit" | "cursor">;
    const matches = options.items.map(item => {
        const match: QueryNotesMatch = {
            path: item.snapshot.path,
            title: getFileTitle(item.file),
        };
        if (typeof item.snapshot.ctime === "number") match.ctime = item.snapshot.ctime;
        if (typeof item.snapshot.mtime === "number") match.mtime = item.snapshot.mtime;
        return match;
    });
    const coverage: QueryNotesCoverage = {
        state: options.exact ? "complete" : "partial",
        scannedPermittedNotes: options.evaluation.scannedPermittedNotes,
        evaluatedCandidates: options.evaluation.items.length,
        ...(options.evaluation.candidateCapExceeded ? { candidateCapExceeded: true } : {}),
        ...(options.evaluation.projectionBudgetExceeded ? { projectionBudgetExceeded: true } : {}),
        ...(options.evaluation.hasUnknownEvaluation ? { cacheUnknown: true } : {}),
    };
    return {
        query,
        matches,
        matchCount: options.matchCount,
        matchCountKind: options.exact ? "exact" : "lower-bound",
        sort: options.sort,
        coverage,
        ...(options.exact ? {} : {
            partialResultGuidance: "Narrow the query (for example by folder, path, tag, property, or date) and query again; this partial page is sorted by path ascending.",
        }),
        ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
    };
}

function decodeQueryNotesCursor(raw: string): QueryNotesCursor {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new QueryNotesCursorExpiredError("query_notes cursor is invalid.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new QueryNotesCursorExpiredError("query_notes cursor is invalid.");
    }
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["instance", "nextIndex", "query", "snapshot", "version"])) {
        throw new QueryNotesCursorExpiredError("query_notes cursor is invalid.");
    }
    if (record.version !== 1 || typeof record.instance !== "string" || !record.instance
        || typeof record.query !== "string" || typeof record.snapshot !== "string"
        || typeof record.nextIndex !== "number" || !Number.isInteger(record.nextIndex) || record.nextIndex < 0) {
        throw new QueryNotesCursorExpiredError("query_notes cursor is invalid.");
    }
    return {
        version: 1,
        instance: record.instance,
        query: record.query,
        snapshot: record.snapshot,
        nextIndex: record.nextIndex,
    };
}

function encodeQueryNotesCursor(cursor: QueryNotesCursor): string {
    return JSON.stringify(cursor);
}

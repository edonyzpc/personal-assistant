import { getAllTags } from "obsidian";
import type { MarkdownFileLike } from "./chat-tool-execution-helpers";
import {
    getFileTitle,
    getOptionalMetadataCache,
    getVault,
    getMarkdownFilesCooperatively,
    sortCooperatively,
    type CooperativeCheckpoint,
} from "./chat-tool-execution-helpers";
import type {
    QueryNotesCoverage,
    QueryNotesInput,
    QueryNotesMatch,
    QueryNotesOutput,
    QueryNotesPropertyValue,
} from "./chat-tool-types";
import { canonicalizeQueryNotesInput } from "./chat-tool-guards";
import { throwIfAborted } from "./chat-utils";
import { createCooperativeTask } from "./cooperative-task";

export class QueryNotesUnavailableError extends Error {}
export class QueryNotesSourcesChangedError extends QueryNotesUnavailableError {}

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
    checkpoint?: CooperativeCheckpoint;
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

interface QueryNotesTagCache {
    tags?: Array<{ tag?: string }>;
    frontmatter?: Record<string, unknown>;
}

export async function executeQueryNotes(
    options: QueryNotesExecutionOptions,
): Promise<QueryNotesExecutionResult> {
    const { input, signal } = options;
    const task = createCooperativeTask(signal);
    const checkpoint = options.checkpoint ?? (async () => { await task.checkpoint(); });
    const calculationCheckpoint = async () => { await task.checkpoint(); };
    options = { ...options, checkpoint };
    throwIfAborted(signal);
    options.assertCurrent?.();

    let evaluation = await evaluateQueryNotes(options);
    const canonicalSnapshot = JSON.stringify(evaluation.snapshot);
    const complete = isCompleteEvaluation(evaluation);

    if (complete) {
        await checkpoint();
        throwIfAborted(signal);
        options.assertCurrent?.();
        const rebuilt = await evaluateQueryNotes(options);
        const rebuiltCanonical = JSON.stringify(rebuilt.snapshot);
        if (rebuiltCanonical !== canonicalSnapshot) {
            throw new QueryNotesSourcesChangedError("query_notes sources changed while the snapshot was being verified.");
        }
        options.assertCurrent?.();
        evaluation = rebuilt;
    }

    const knownMatches: QueryNotesEvaluatedItem[] = [];
    for (const item of evaluation.items) {
        await calculationCheckpoint();
        if (item.match === true) knownMatches.push(item);
    }
    const requestedSort = input.sort;
    const orderedMatches = await sortCooperatively(knownMatches, (left, right) => compareQueryNotesItems(
        left,
        right,
        requestedSort,
    ), calculationCheckpoint);
    const selected = input.limit === undefined
        ? orderedMatches
        : orderedMatches.slice(0, input.limit);
    const content = makeOutput({
        input,
        items: selected,
        matchCount: knownMatches.length,
        exact: complete,
        sort: requestedSort,
        evaluation,
    });
    await checkpoint();
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
}

async function evaluateQueryNotes(options: QueryNotesExecutionOptions): Promise<QueryNotesEvaluation> {
    const { input, signal } = options;
    const epoch = options.host.getTaskSourceAuthorityEpoch?.();
    const checkpoint = options.checkpoint!;
    const task = createCooperativeTask(signal);
    const calculationCheckpoint = async () => { await task.checkpoint(); };
    const vault = getVault(options.host);
    if (typeof vault.getMarkdownFiles !== "function") {
        throw new QueryNotesUnavailableError("Vault getMarkdownFiles is unavailable.");
    }
    throwIfAborted(signal);
    const files = await getMarkdownFilesCooperatively(options.host, checkpoint);
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
    const permittedByPath = new Map<string, MarkdownFileLike>();
    for (const file of files) {
        await checkpoint();
        throwIfAborted(signal);
        options.assertCurrent?.();
        if (!file || typeof file.path !== "string" || !file.path) continue;
        if (options.isPathReadable && !options.isPathReadable(file.path)) continue;
        if (permittedByPath.has(file.path)) continue;
        permittedByPath.set(file.path, file);
        permittedFiles.push(file);
    }
    const scannedPermittedNotes = permittedFiles.length;
    const orderedFiles = await sortCooperatively(permittedFiles, (left, right) => comparePaths(left.path, right.path), calculationCheckpoint);
    await checkpoint();

    const items: QueryNotesEvaluatedItem[] = [];
    let hasUnknownEvaluation = false;

    for (const file of orderedFiles) {
        // The native epoch permits cooperative reads. Legacy hosts keep one metadata seal atomic.
        if (epoch !== undefined) await checkpoint();
        throwIfAborted(signal);
        options.assertCurrent?.();
        if (!isInStaticQueryScope(file.path, input)) continue;

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
                    tags = epoch === undefined ? captureTagsSnapshot(cache, cacheKnown)
                        : await finishProjectionCooperatively(captureTagsSnapshotSteps(cache, cacheKnown), calculationCheckpoint);
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
            const steps = capturePropertySnapshotSteps(frontmatter, key, cacheKnown, neededProperties.get(key)!);
            propertySnapshots[key] = epoch === undefined ? finishProjection(steps)
                : await finishProjectionCooperatively(steps, calculationCheckpoint);
        }

        for (const condition of input.properties ?? []) {
            conditionOutcomes.push(evaluatePropertyCondition(
                condition,
                propertySnapshots[condition.key],
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

        const itemHasUnknownEvaluation = match === "unknown"
            || (!sortValueKnown && match !== false);
        if (itemHasUnknownEvaluation) hasUnknownEvaluation = true;

        const snapshot: QueryNotesSnapshotItem = {
            path: file.path,
            identity,
            ...(ctime === undefined ? {} : { ctime }),
            ...(mtime === undefined ? {} : { mtime }),
            ...(tags === undefined ? {} : { tags }),
            ...(Object.keys(propertySnapshots).length === 0 ? {} : { properties: propertySnapshots }),
        };

        items.push({
            file,
            snapshot,
            match,
            sortValueKnown,
        });
    }

    throwIfAborted(signal);
    options.assertCurrent?.();
    const candidatePaths: string[] = [];
    for (const file of orderedFiles) {
        if (epoch !== undefined) await checkpoint();
        if (isInStaticQueryScope(file.path, input)) candidatePaths.push(file.path);
    }
    if (epoch !== undefined) {
        if (epoch !== options.host.getTaskSourceAuthorityEpoch?.()) {
            throw new QueryNotesSourcesChangedError("query_notes sources changed while the snapshot was being verified.");
        }
    }
    return {
        snapshot: {
            version: 1,
            completeCandidateSet: true,
            projectionComplete: true,
            candidates: items.map(item => item.snapshot),
        },
        items,
        candidatePaths,
        scannedPermittedNotes,
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
    return finishProjection(capturePropertySnapshotSteps(frontmatter, key, cacheKnown, usage));
}

function* capturePropertySnapshotSteps(
    frontmatter: Record<string, unknown> | null | undefined, key: string, cacheKnown: boolean, usage: PropertyUsage,
): Generator<void, PropertySnapshot> {
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
        return { state: "value", value: yield* captureScalarArraySteps(actual) };
    }
    if (!isJsonScalar(actual)) return { state: "incompatible" };
    return { state: "value", value: actual };
}

function captureTagsSnapshot(
    cache: QueryNotesTagCache,
    cacheKnown: boolean,
): TagSnapshot {
    return finishProjection(captureTagsSnapshotSteps(cache, cacheKnown));
}

function* captureTagsSnapshotSteps(cache: QueryNotesTagCache, cacheKnown: boolean): Generator<void, TagSnapshot> {
    if (!cacheKnown) return { state: "unknown" };
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
    return { state: "value", value: yield* captureScalarArraySteps(rawTags ?? []) };
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
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    return day <= daysInMonth;
}

function* captureScalarArraySteps(value: readonly unknown[]): Generator<void, unknown[]> {
    const normalized: QueryNotesPropertyValue[] = [];
    for (const entry of value) {
        yield;
        // Non-scalar entries cannot satisfy the strict scalar member semantics;
        // they are intentionally ignored instead of recursively materialized.
        if (!isJsonScalar(entry)) continue;
        normalized.push(entry);
    }
    return normalized;
}

function finishProjection<Output>(steps: Generator<void, Output>): Output {
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}

async function finishProjectionCooperatively<Output>(
    steps: Generator<void, Output>, checkpoint: CooperativeCheckpoint,
): Promise<Output> {
    let step = steps.next();
    while (!step.done) { await checkpoint(); step = steps.next(); }
    return step.value;
}

function isCompleteEvaluation(evaluation: QueryNotesEvaluation): boolean {
    return !evaluation.hasUnknownEvaluation;
}

function compareQueryNotesItems(
    left: QueryNotesEvaluatedItem,
    right: QueryNotesEvaluatedItem,
    sort: NonNullable<QueryNotesInput["sort"]>,
): number {
    if (sort.field !== "path") {
        const leftValue = sort.field === "ctime" ? left.snapshot.ctime : left.snapshot.mtime;
        const rightValue = sort.field === "ctime" ? right.snapshot.ctime : right.snapshot.mtime;
        if (isKnownStat(leftValue) !== isKnownStat(rightValue)) {
            return isKnownStat(leftValue) ? -1 : 1;
        }
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
        ...(options.evaluation.hasUnknownEvaluation ? { cacheUnknown: true } : {}),
    };
    return {
        query,
        matches,
        matchCount: options.matchCount,
        matchCountKind: options.exact ? "exact" : "lower-bound",
        sort: options.sort,
        coverage,
    };
}

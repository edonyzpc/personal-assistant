import { isReviewQueueItemType } from "./contracts";
import { isRecord, stableHash } from "./helpers";
import {
    validateConfirmedMemoryRecord,
    type ConfirmedMemoryRecord,
} from "./memory-governance-store";
import {
    validateReviewQueueItem,
    type ReviewQueueItem,
} from "./review-queue-store";

const LEGACY_MEMORY_POLICY_THRESHOLD = 30 as const;
const MEMORY_QUEUE_TYPES = new Set<ReviewQueueItem["type"]>([
    "memory_candidate",
    "memory_conflict",
]);

export interface LegacyMemoryPayload {
    memoryGovernance: unknown;
    reviewQueue: unknown;
    confirmedMemoryCount: unknown;
    memoryAutoAcceptPaused: unknown;
}

export interface LegacyMemoryRejection {
    source: "governance" | "review_queue" | "policy";
    index?: number;
    errorCode: string;
}

export interface LegacyMemoryParseResult {
    acceptedClaims: ConfirmedMemoryRecord[];
    acceptedMemoryQueueItems: ReviewQueueItem[];
    rejected: LegacyMemoryRejection[];
    rawCounts: { governance: number; memoryQueue: number; rejected: number };
    sourceHash: string;
}

export interface ExactLegacyMemoryRedactionTargets {
    recordIdFingerprints: readonly string[];
    memoryQueueItemIdFingerprints: readonly string[];
}

export type ExactLegacyMemoryRedactionResult =
    | {
        ok: true;
        payload: LegacyMemoryPayload;
        sourceHash: string;
        removedRecordCount: number;
        removedMemoryQueueItemCount: number;
        changed: boolean;
    }
    | { ok: false; reason: string };

export interface LegacyReviewQueuePassthrough {
    preservedRawEntries: Array<{
        originalIndex: number;
        id?: string;
        reason: "memory_item" | "rejected" | "unknown";
        value: unknown;
    }>;
    liveNonMemoryItems: ReviewQueueItem[];
}

export interface LegacyMemoryPolicyBaseline {
    confirmedCount: number;
    threshold: typeof LEGACY_MEMORY_POLICY_THRESHOLD;
    autoAcceptPaused: boolean;
}

export interface LegacyMemoryPolicyNormalization {
    baseline: LegacyMemoryPolicyBaseline;
    rejected: LegacyMemoryRejection[];
}

export type LegacyReviewQueueMergeResult =
    | { ok: true; reviewQueue: unknown }
    | { ok: false; errorCode: string; reviewQueue: unknown };

export type LegacyMigrationEntityKind =
    | "migration_run"
    | "claim"
    | "revision"
    | "memory_queue"
    | "policy";

export interface DeterministicLegacyMigrationIdInput {
    kind: LegacyMigrationEntityKind;
    opaqueVaultKey: string;
    sourceHash: string;
    sourceIndex?: number;
    legacyId?: string;
}

interface ReviewQueueAnalysis {
    acceptedMemoryQueueItems: ReviewQueueItem[];
    passthrough: LegacyReviewQueuePassthrough;
    rejected: LegacyMemoryRejection[];
    rawMemoryCount: number;
}

/**
 * Captures only the four migration-owned slices from raw loadData() output.
 * The clone is taken before any current-settings normalizer can discard an
 * unknown or malformed sibling needed for compatibility/rollback.
 */
export function captureLegacyMemoryPayload(rawLoadedData: unknown): LegacyMemoryPayload {
    const raw = isRecord(rawLoadedData) ? rawLoadedData : {};
    return cloneUnknown({
        memoryGovernance: raw.memoryGovernance,
        reviewQueue: raw.reviewQueue,
        confirmedMemoryCount: raw.confirmedMemoryCount,
        memoryAutoAcceptPaused: raw.memoryAutoAcceptPaused,
    }) as LegacyMemoryPayload;
}

/**
 * Selects the raw entries owned by Memory migration. Valid non-Memory queue
 * items remain live in settings and must not change deterministic migration
 * identity, IDs, restart behavior, or rollback evidence.
 */
export function createMigrationOwnedLegacyMemoryPayload(
    rawPayload: LegacyMemoryPayload,
): LegacyMemoryPayload {
    const rawQueueItems = readRawQueueItems(rawPayload.reviewQueue);
    if (!rawQueueItems.ok) {
        return cloneUnknown({
            memoryGovernance: rawPayload.memoryGovernance,
            reviewQueue: rawPayload.reviewQueue,
            confirmedMemoryCount: rawPayload.confirmedMemoryCount,
            memoryAutoAcceptPaused: rawPayload.memoryAutoAcceptPaused,
        }) as LegacyMemoryPayload;
    }
    const passthrough = buildLegacyReviewQueuePassthrough(rawPayload.reviewQueue);
    return cloneUnknown({
        memoryGovernance: rawPayload.memoryGovernance,
        reviewQueue: {
            items: [...passthrough.preservedRawEntries]
                .sort((left, right) => left.originalIndex - right.originalIndex)
                .map((entry) => entry.value),
        },
        confirmedMemoryCount: rawPayload.confirmedMemoryCount,
        memoryAutoAcceptPaused: rawPayload.memoryAutoAcceptPaused,
    }) as LegacyMemoryPayload;
}

/** Returns a content hash without exposing legacy claim or queue text. */
export function hashLegacyMemoryPayload(payload: LegacyMemoryPayload): string {
    const canonicalPayload = createMigrationOwnedLegacyMemoryPayload(payload);
    return `legacy-v1:${stableDigest(stableSerialize(canonicalPayload))}`;
}

/**
 * Removes only valid legacy Memory entities with exact opaque IDs. Unknown,
 * malformed, non-Memory, policy, ordering, and container metadata survive
 * byte-for-JSON-value so Forget cannot become a broad settings rewrite.
 */
export function redactExactLegacyMemoryPayload(
    payload: LegacyMemoryPayload,
    targets: ExactLegacyMemoryRedactionTargets,
): ExactLegacyMemoryRedactionResult {
    const recordFingerprints = normalizeExactFingerprints(targets.recordIdFingerprints);
    const queueFingerprints = normalizeExactFingerprints(targets.memoryQueueItemIdFingerprints);
    if (!recordFingerprints || !queueFingerprints
        || recordFingerprints.size + queueFingerprints.size === 0) {
        return { ok: false, reason: "legacy_redaction_targets_invalid" };
    }
    const records = readRawRecords(payload.memoryGovernance);
    const queue = readRawQueueItems(payload.reviewQueue);
    if (!records.ok || !queue.ok) {
        return { ok: false, reason: "legacy_redaction_source_invalid" };
    }

    let removedRecordCount = 0;
    const matchedRecordFingerprints = new Set<string>();
    const nextRecords: unknown[] = [];
    for (const candidate of records.values) {
        const rawId = isRecord(candidate) && typeof candidate.id === "string"
            ? candidate.id.trim()
            : "";
        const fingerprint = rawId
            ? fingerprintLegacyMemoryEntityId("record", rawId)
            : "";
        if (!recordFingerprints.has(fingerprint)) {
            nextRecords.push(cloneUnknown(candidate));
            continue;
        }
        const validation = validateConfirmedMemoryRecord(candidate as ConfirmedMemoryRecord);
        if (!validation.ok || validation.value.id !== rawId) {
            return { ok: false, reason: "legacy_redaction_record_invalid" };
        }
        if (matchedRecordFingerprints.has(fingerprint)) {
            return { ok: false, reason: "legacy_redaction_record_ambiguous" };
        }
        matchedRecordFingerprints.add(fingerprint);
        removedRecordCount += 1;
    }

    let removedMemoryQueueItemCount = 0;
    const matchedQueueFingerprints = new Set<string>();
    const nextQueueItems: unknown[] = [];
    for (const candidate of queue.values) {
        const rawId = isRecord(candidate) && typeof candidate.id === "string"
            ? candidate.id.trim()
            : "";
        const fingerprint = rawId
            ? fingerprintLegacyMemoryEntityId("memory_queue", rawId)
            : "";
        if (!queueFingerprints.has(fingerprint)) {
            nextQueueItems.push(cloneUnknown(candidate));
            continue;
        }
        const validation = validateReviewQueueItem(candidate as unknown as ReviewQueueItem);
        if (!validation.ok
            || validation.value.id !== rawId
            || !MEMORY_QUEUE_TYPES.has(validation.value.type)) {
            return { ok: false, reason: "legacy_redaction_queue_invalid" };
        }
        if (matchedQueueFingerprints.has(fingerprint)) {
            return { ok: false, reason: "legacy_redaction_queue_ambiguous" };
        }
        matchedQueueFingerprints.add(fingerprint);
        removedMemoryQueueItemCount += 1;
    }

    const memoryGovernance = isRecord(payload.memoryGovernance)
        ? cloneUnknown(payload.memoryGovernance) as Record<string, unknown>
        : {};
    const reviewQueue = isRecord(payload.reviewQueue)
        ? cloneUnknown(payload.reviewQueue) as Record<string, unknown>
        : {};
    defineEnumerableValue(memoryGovernance, "records", nextRecords);
    defineEnumerableValue(reviewQueue, "items", nextQueueItems);
    const redacted = cloneUnknown({
        memoryGovernance,
        reviewQueue,
        confirmedMemoryCount: payload.confirmedMemoryCount,
        memoryAutoAcceptPaused: payload.memoryAutoAcceptPaused,
    }) as LegacyMemoryPayload;
    return {
        ok: true,
        payload: redacted,
        sourceHash: hashLegacyMemoryPayload(redacted),
        removedRecordCount,
        removedMemoryQueueItemCount,
        changed: removedRecordCount + removedMemoryQueueItemCount > 0,
    };
}

export function normalizeLegacyMemoryPolicy(
    payload: Pick<LegacyMemoryPayload, "confirmedMemoryCount" | "memoryAutoAcceptPaused">,
): LegacyMemoryPolicyNormalization {
    const rejected: LegacyMemoryRejection[] = [];
    let confirmedCount = 0;
    if (payload.confirmedMemoryCount === undefined) {
        confirmedCount = 0;
    } else if (typeof payload.confirmedMemoryCount === "number"
        && Number.isSafeInteger(payload.confirmedMemoryCount)
        && payload.confirmedMemoryCount >= 0) {
        confirmedCount = payload.confirmedMemoryCount;
    } else {
        rejected.push({ source: "policy", errorCode: "policy_confirmed_count_invalid" });
    }

    let autoAcceptPaused = false;
    if (payload.memoryAutoAcceptPaused === undefined) {
        autoAcceptPaused = false;
    } else if (typeof payload.memoryAutoAcceptPaused === "boolean") {
        autoAcceptPaused = payload.memoryAutoAcceptPaused;
    } else {
        rejected.push({ source: "policy", errorCode: "policy_pause_invalid" });
    }

    return {
        baseline: {
            confirmedCount,
            threshold: LEGACY_MEMORY_POLICY_THRESHOLD,
            autoAcceptPaused,
        },
        rejected,
    };
}

export function parseLegacyMemoryPayload(payload: LegacyMemoryPayload): LegacyMemoryParseResult {
    const governance = parseGovernanceSlice(payload.memoryGovernance);
    const reviewQueue = analyzeReviewQueue(payload.reviewQueue);
    const policy = normalizeLegacyMemoryPolicy(payload);
    const rejected = [
        ...governance.rejected,
        ...reviewQueue.rejected,
        ...policy.rejected,
    ];
    return {
        acceptedClaims: governance.accepted,
        acceptedMemoryQueueItems: reviewQueue.acceptedMemoryQueueItems,
        rejected,
        rawCounts: {
            governance: governance.rawCount,
            memoryQueue: reviewQueue.rawMemoryCount,
            rejected: rejected.length,
        },
        sourceHash: hashLegacyMemoryPayload(payload),
    };
}

export function buildLegacyReviewQueuePassthrough(reviewQueue: unknown): LegacyReviewQueuePassthrough {
    return analyzeReviewQueue(reviewQueue).passthrough;
}

/**
 * Merges a current live non-Memory partition back into an original raw queue.
 * Any collision or invalid input returns an untouched clone of the old slice.
 */
export function mergeLegacyReviewQueuePassthrough(
    rawReviewQueue: unknown,
    liveNonMemoryItems: readonly unknown[],
): LegacyReviewQueueMergeResult {
    const previous = cloneUnknown(rawReviewQueue);
    const rawItems = readRawQueueItems(rawReviewQueue);
    if (!rawItems.ok) {
        return {
            ok: false,
            errorCode: "review_queue_items_invalid_shape",
            reviewQueue: previous,
        };
    }

    const passthrough = analyzeReviewQueue(rawReviewQueue).passthrough;
    const preservedIds = new Set(
        passthrough.preservedRawEntries
            .map((entry) => entry.id)
            .filter((id): id is string => Boolean(id)),
    );
    const liveIds = new Set<string>();
    const nextLive: ReviewQueueItem[] = [];
    for (const candidate of liveNonMemoryItems) {
        if (!isRecord(candidate) || !isReviewQueueItemType(candidate.type)) {
            return failQueueMerge("live_non_memory_item_invalid", previous);
        }
        if (MEMORY_QUEUE_TYPES.has(candidate.type)) {
            return failQueueMerge("live_memory_item_forbidden", previous);
        }
        const validation = validateReviewQueueItem(candidate as unknown as ReviewQueueItem);
        if (!validation.ok) {
            return failQueueMerge("live_non_memory_item_invalid", previous);
        }
        const id = validation.value.id;
        if (preservedIds.has(id) || liveIds.has(id)) {
            return failQueueMerge("review_queue_id_collision", previous);
        }
        liveIds.add(id);
        nextLive.push(validation.value);
    }

    const mergedItems: unknown[] = nextLive.map((item) => cloneUnknown(item));
    const preserved = [...passthrough.preservedRawEntries]
        .sort((left, right) => left.originalIndex - right.originalIndex);
    for (const entry of preserved) {
        const insertionIndex = Math.max(0, Math.min(entry.originalIndex, mergedItems.length));
        mergedItems.splice(insertionIndex, 0, cloneUnknown(entry.value));
    }

    const container = isRecord(rawReviewQueue)
        ? cloneUnknown(rawReviewQueue) as Record<string, unknown>
        : {};
    defineEnumerableValue(container, "items", mergedItems);
    return { ok: true, reviewQueue: container };
}

export function createDeterministicLegacyMigrationId(
    input: DeterministicLegacyMigrationIdInput,
): string {
    if (!input.opaqueVaultKey.trim() || !input.sourceHash.trim()) {
        throw new Error("Invalid deterministic legacy migration ID input.");
    }
    if (input.sourceIndex !== undefined
        && (!Number.isSafeInteger(input.sourceIndex) || input.sourceIndex < 0)) {
        throw new Error("Invalid deterministic legacy migration ID index.");
    }
    const digest = stableDigest(stableSerialize({
        version: 1,
        kind: input.kind,
        opaqueVaultKey: input.opaqueVaultKey,
        sourceHash: input.sourceHash,
        sourceIndex: input.sourceIndex,
        legacyId: input.legacyId,
    }));
    return `legacy-${input.kind.replace(/_/g, "-")}-${digest.slice(0, 24)}`;
}

/** One-way, fixed-shape identity for raw legacy IDs that may contain user text. */
export function fingerprintLegacyMemoryEntityId(
    kind: "record" | "memory_queue",
    legacyId: string,
): string {
    const normalized = legacyId.trim();
    if (!normalized) throw new Error("Invalid legacy Memory entity ID.");
    return `legacy-id-v1:${stableDigest(stableSerialize({ kind, id: normalized }))}`;
}

export function createLegacyMigrationRunId(opaqueVaultKey: string, sourceHash: string): string {
    return createDeterministicLegacyMigrationId({
        kind: "migration_run",
        opaqueVaultKey,
        sourceHash,
    });
}

export function createLegacyClaimMigrationId(input: {
    opaqueVaultKey: string;
    sourceHash: string;
    sourceIndex: number;
    legacyId: string;
}): string {
    return createDeterministicLegacyMigrationId({ kind: "claim", ...input });
}

export function createLegacyRevisionMigrationId(input: {
    opaqueVaultKey: string;
    sourceHash: string;
    sourceIndex: number;
    legacyId: string;
}): string {
    return createDeterministicLegacyMigrationId({ kind: "revision", ...input });
}

export function createLegacyMemoryQueueMigrationId(input: {
    opaqueVaultKey: string;
    sourceHash: string;
    sourceIndex: number;
    legacyId: string;
}): string {
    return createDeterministicLegacyMigrationId({ kind: "memory_queue", ...input });
}

export function createLegacyPolicyMigrationId(opaqueVaultKey: string, sourceHash: string): string {
    return createDeterministicLegacyMigrationId({
        kind: "policy",
        opaqueVaultKey,
        sourceHash,
    });
}

function parseGovernanceSlice(value: unknown): {
    accepted: ConfirmedMemoryRecord[];
    rejected: LegacyMemoryRejection[];
    rawCount: number;
} {
    const records = readRawRecords(value);
    if (!records.ok) {
        return {
            accepted: [],
            rejected: [{ source: "governance", errorCode: "governance_records_invalid_shape" }],
            rawCount: 0,
        };
    }

    const validated = records.values.map((candidate, index) => {
        const validation = validateConfirmedMemoryRecord(candidate as ConfirmedMemoryRecord);
        return validation.ok
            ? { ok: true as const, index, value: validation.value }
            : { ok: false as const, index };
    });
    const idCounts = countIds(validated
        .filter((entry): entry is Extract<typeof entry, { ok: true }> => entry.ok)
        .map((entry) => entry.value.id));
    const accepted: ConfirmedMemoryRecord[] = [];
    const rejected: LegacyMemoryRejection[] = [];
    for (const entry of validated) {
        if (!entry.ok) {
            rejected.push({
                source: "governance",
                index: entry.index,
                errorCode: "governance_record_invalid",
            });
        } else if ((idCounts.get(entry.value.id) ?? 0) > 1) {
            rejected.push({
                source: "governance",
                index: entry.index,
                errorCode: "governance_id_collision",
            });
        } else {
            accepted.push(entry.value);
        }
    }
    return { accepted, rejected, rawCount: records.values.length };
}

function analyzeReviewQueue(value: unknown): ReviewQueueAnalysis {
    const rawItems = readRawQueueItems(value);
    if (!rawItems.ok) {
        return {
            acceptedMemoryQueueItems: [],
            passthrough: { preservedRawEntries: [], liveNonMemoryItems: [] },
            rejected: [{ source: "review_queue", errorCode: "review_queue_items_invalid_shape" }],
            rawMemoryCount: 0,
        };
    }

    const preliminary = rawItems.values.map((candidate, index) => {
        if (!isRecord(candidate) || !isReviewQueueItemType(candidate.type)) {
            return { kind: "unknown" as const, index, raw: candidate };
        }
        const validation = validateReviewQueueItem(candidate as unknown as ReviewQueueItem);
        if (!validation.ok) {
            return { kind: "invalid" as const, index, raw: candidate };
        }
        if (MEMORY_QUEUE_TYPES.has(validation.value.type)) {
            return { kind: "memory" as const, index, raw: candidate, item: validation.value };
        }
        return { kind: "non_memory" as const, index, item: validation.value };
    });
    const memoryIdCounts = countIds(preliminary
        .filter((entry): entry is Extract<typeof entry, { kind: "memory" }> => entry.kind === "memory")
        .map((entry) => entry.item.id));

    const acceptedMemoryQueueItems: ReviewQueueItem[] = [];
    const liveNonMemoryItems: ReviewQueueItem[] = [];
    const preservedRawEntries: LegacyReviewQueuePassthrough["preservedRawEntries"] = [];
    const rejected: LegacyMemoryRejection[] = [];
    let rawMemoryCount = 0;
    for (const entry of preliminary) {
        if (entry.kind === "unknown") {
            rejected.push({
                source: "review_queue",
                index: entry.index,
                errorCode: "review_queue_item_unknown",
            });
            preservedRawEntries.push(makePreservedEntry(entry.index, "unknown", entry.raw));
        } else if (entry.kind === "invalid") {
            if (isRecord(entry.raw) && MEMORY_QUEUE_TYPES.has(entry.raw.type as ReviewQueueItem["type"])) {
                rawMemoryCount++;
            }
            rejected.push({
                source: "review_queue",
                index: entry.index,
                errorCode: "review_queue_item_invalid",
            });
            preservedRawEntries.push(makePreservedEntry(entry.index, "rejected", entry.raw));
        } else if (entry.kind === "memory") {
            rawMemoryCount++;
            if ((memoryIdCounts.get(entry.item.id) ?? 0) > 1) {
                rejected.push({
                    source: "review_queue",
                    index: entry.index,
                    errorCode: "review_queue_id_collision",
                });
                preservedRawEntries.push(makePreservedEntry(entry.index, "rejected", entry.raw));
            } else {
                acceptedMemoryQueueItems.push(entry.item);
                preservedRawEntries.push(makePreservedEntry(entry.index, "memory_item", entry.raw));
            }
        } else {
            liveNonMemoryItems.push(entry.item);
        }
    }
    return {
        acceptedMemoryQueueItems,
        passthrough: { preservedRawEntries, liveNonMemoryItems },
        rejected,
        rawMemoryCount,
    };
}

function makePreservedEntry(
    originalIndex: number,
    reason: "memory_item" | "rejected" | "unknown",
    value: unknown,
): LegacyReviewQueuePassthrough["preservedRawEntries"][number] {
    const cloned = cloneUnknown(value);
    const id = isRecord(value) && typeof value.id === "string" && value.id.trim()
        ? value.id
        : undefined;
    return {
        originalIndex,
        ...(id ? { id } : {}),
        reason,
        value: cloned,
    };
}

function readRawRecords(value: unknown): { ok: true; values: unknown[] } | { ok: false } {
    if (value === undefined) return { ok: true, values: [] };
    if (!isRecord(value)) return { ok: false };
    if (value.records === undefined) return { ok: true, values: [] };
    return Array.isArray(value.records)
        ? { ok: true, values: value.records }
        : { ok: false };
}

function readRawQueueItems(value: unknown): { ok: true; values: unknown[] } | { ok: false } {
    if (value === undefined) return { ok: true, values: [] };
    if (!isRecord(value)) return { ok: false };
    if (value.items === undefined) return { ok: true, values: [] };
    return Array.isArray(value.items)
        ? { ok: true, values: value.items }
        : { ok: false };
}

function countIds(ids: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
}

function normalizeExactFingerprints(values: readonly string[]): Set<string> | null {
    if (!Array.isArray(values)) return null;
    const normalized = values.map((value) => typeof value === "string" ? value.trim() : "");
    if (normalized.some((value) => !/^legacy-id-v1:[a-f0-9]{32}$/.test(value))
        || new Set(normalized).size !== normalized.length) return null;
    return new Set(normalized);
}

function failQueueMerge(errorCode: string, previous: unknown): LegacyReviewQueueMergeResult {
    return { ok: false, errorCode, reviewQueue: previous };
}

function defineEnumerableValue(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
    });
}

function cloneUnknown<T>(value: T, seen = new WeakMap<object, unknown>()): T {
    if (typeof value !== "object" || value === null) return value;
    const existing = seen.get(value);
    if (existing !== undefined) return existing as T;
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) {
        const output = new Array(value.length);
        seen.set(value, output);
        for (let index = 0; index < value.length; index++) {
            if (Object.prototype.hasOwnProperty.call(value, index)) {
                output[index] = cloneUnknown(value[index], seen);
            }
        }
        return output as T;
    }
    const output: Record<string, unknown> = {};
    seen.set(value, output);
    for (const key of Object.keys(value)) {
        defineEnumerableValue(output, key, cloneUnknown((value as Record<string, unknown>)[key], seen));
    }
    return output as T;
}

function stableSerialize(value: unknown): string {
    const seen = new Map<object, number>();
    let nextReferenceId = 0;
    const visit = (candidate: unknown): string => {
        if (candidate === null) return "null";
        if (candidate === undefined) return "undefined";
        if (typeof candidate === "string") return `string:${candidate.length}:${candidate}`;
        if (typeof candidate === "boolean") return candidate ? "boolean:1" : "boolean:0";
        if (typeof candidate === "number") {
            if (Number.isNaN(candidate)) return "number:nan";
            if (candidate === Number.POSITIVE_INFINITY) return "number:+infinity";
            if (candidate === Number.NEGATIVE_INFINITY) return "number:-infinity";
            if (Object.is(candidate, -0)) return "number:-0";
            return `number:${candidate}`;
        }
        if (typeof candidate === "bigint") return `bigint:${candidate.toString()}`;
        if (typeof candidate === "symbol") return "unsupported:symbol";
        if (typeof candidate === "function") return "unsupported:function";

        const object = candidate as object;
        const priorReference = seen.get(object);
        if (priorReference !== undefined) return `reference:${priorReference}`;
        const referenceId = nextReferenceId++;
        seen.set(object, referenceId);
        if (candidate instanceof Date) return `date:${candidate.toISOString()}`;
        if (Array.isArray(candidate)) {
            const entries: string[] = [];
            for (let index = 0; index < candidate.length; index++) {
                entries.push(Object.prototype.hasOwnProperty.call(candidate, index)
                    ? visit(candidate[index])
                    : "array-hole");
            }
            return `array:${referenceId}:[${entries.join("|")}]`;
        }
        const record = candidate as Record<string, unknown>;
        const entries = Object.keys(record)
            .sort()
            .map((key) => `${visit(key)}=${visit(record[key])}`);
        return `object:${referenceId}:{${entries.join("|")}}`;
    };
    return visit(value);
}

function stableDigest(serialized: string): string {
    return ["0", "1", "2", "3"]
        .map((salt) => stableHash(`${salt}:${serialized}`))
        .join("");
}

import { isRecord } from "./helpers";
import {
    buildLegacyReviewQueuePassthrough,
    captureLegacyMemoryPayload,
    mergeLegacyReviewQueuePassthrough,
    type LegacyMemoryPayload,
} from "./memory-governance-migration";
import {
    validateReviewQueueItem,
    type ReviewQueueItem,
} from "./review-queue-store";

const MEMORY_QUEUE_TYPES = new Set<ReviewQueueItem["type"]>([
    "memory_candidate",
    "memory_conflict",
]);

export type LegacyMemoryCompatibilitySaveResult =
    | { ok: true; payload: Record<string, unknown> }
    | { ok: false; errorCode: string };

/**
 * Boot-scoped guard that keeps raw, potentially syncable Memory slices intact
 * while the device-local migration is being verified. It never mutates either
 * the captured input or the live settings object.
 */
export class LegacyMemoryCompatibilityBarrier {
    private legacyPayload: LegacyMemoryPayload;
    private state: "active" | "finalizing" | "finalized" = "active";

    constructor(rawLoadedData: unknown) {
        this.legacyPayload = captureLegacyMemoryPayload(rawLoadedData);
    }

    snapshot(): LegacyMemoryPayload {
        return cloneSerializable(this.legacyPayload);
    }

    isActive(): boolean {
        return this.state === "active";
    }

    isFinalizing(): boolean {
        return this.state === "finalizing";
    }

    beginFinalization(): void {
        if (this.state !== "finalized") this.state = "finalizing";
    }

    /**
     * Returns a failed finalization to compatibility using a fresh persisted
     * source snapshot. Callers must not reuse the boot-time snapshot after a
     * source-hash mismatch because another device may have changed Memory.
     */
    cancelFinalization(rawLoadedData: unknown): boolean {
        if (this.state === "finalized") return false;
        this.legacyPayload = captureLegacyMemoryPayload(rawLoadedData);
        this.state = "active";
        return true;
    }

    /** Refreshes the active compatibility source after a verified atomic write. */
    refreshFromPersisted(rawLoadedData: unknown): boolean {
        if (this.state !== "active") return false;
        this.legacyPayload = captureLegacyMemoryPayload(rawLoadedData);
        return true;
    }

    /**
     * Finalization is deliberately explicit. A successful local cutover does
     * not call this because another device may still need the legacy payload.
     */
    finalize(): void {
        this.state = "finalized";
    }

    /**
     * Builds the payload used by the explicit finalization coordinator. This
     * method is intentionally side-effect free; the caller separately enters
     * the blocking `finalizing` state before attempting the destructive write.
     *
     * Only the legacy Memory-owned slices are cleared. Current non-Memory
     * Review Queue work and every unrelated setting remain untouched.
     */
    composeForFinalization(currentSettings: unknown): LegacyMemoryCompatibilitySaveResult {
        if (!isRecord(currentSettings)) {
            return { ok: false, errorCode: "settings_not_object" };
        }
        const payload = cloneSerializable(currentSettings);
        const liveNonMemoryItems = readLiveNonMemoryItems(payload.reviewQueue);
        if (!liveNonMemoryItems.ok) return liveNonMemoryItems;

        const memoryGovernance = isRecord(payload.memoryGovernance)
            ? cloneSerializable(payload.memoryGovernance)
            : {};
        defineValue(memoryGovernance, "records", []);
        defineValue(payload, "memoryGovernance", memoryGovernance);

        const reviewQueue = isRecord(payload.reviewQueue)
            ? cloneSerializable(payload.reviewQueue)
            : {};
        defineValue(reviewQueue, "items", liveNonMemoryItems.items.map((item) => cloneSerializable(item)));
        defineValue(payload, "reviewQueue", reviewQueue);
        defineValue(payload, "confirmedMemoryCount", 0);
        defineValue(payload, "memoryAutoAcceptPaused", false);
        return { ok: true, payload };
    }

    composeForSave(
        currentSettings: unknown,
        currentPersistedRaw?: unknown,
    ): LegacyMemoryCompatibilitySaveResult {
        if (!isRecord(currentSettings)) {
            return { ok: false, errorCode: "settings_not_object" };
        }
        const payload = cloneSerializable(currentSettings);
        if (this.state === "finalized") return { ok: true, payload };
        if (this.state === "finalizing") {
            return { ok: false, errorCode: "memory_finalization_in_progress" };
        }

        const liveNonMemoryItems = readLiveNonMemoryItems(payload.reviewQueue);
        if (!liveNonMemoryItems.ok) return liveNonMemoryItems;
        const currentLegacyPayload = currentPersistedRaw === undefined
            ? this.legacyPayload
            : captureLegacyMemoryPayload(currentPersistedRaw);
        const baselineNonMemoryItems = buildLegacyReviewQueuePassthrough(
            this.legacyPayload.reviewQueue,
        ).liveNonMemoryItems;
        const persistedNonMemoryItems = buildLegacyReviewQueuePassthrough(
            currentLegacyPayload.reviewQueue,
        ).liveNonMemoryItems;
        const selectedNonMemoryItems = selectConcurrentNonMemoryItems(
            baselineNonMemoryItems,
            liveNonMemoryItems.items,
            persistedNonMemoryItems,
        );
        if (!selectedNonMemoryItems) {
            return { ok: false, errorCode: "review_queue_concurrent_change" };
        }
        const queueMerge = mergeLegacyReviewQueuePassthrough(
            currentLegacyPayload.reviewQueue,
            selectedNonMemoryItems,
        );
        if (!queueMerge.ok) {
            return { ok: false, errorCode: queueMerge.errorCode };
        }

        defineValue(payload, "memoryGovernance", cloneSerializable(currentLegacyPayload.memoryGovernance));
        defineValue(payload, "reviewQueue", queueMerge.reviewQueue);
        defineValue(payload, "confirmedMemoryCount", cloneSerializable(currentLegacyPayload.confirmedMemoryCount));
        defineValue(payload, "memoryAutoAcceptPaused", cloneSerializable(currentLegacyPayload.memoryAutoAcceptPaused));
        return { ok: true, payload };
    }
}

function selectConcurrentNonMemoryItems(
    baseline: readonly ReviewQueueItem[],
    current: readonly ReviewQueueItem[],
    persisted: readonly ReviewQueueItem[],
): ReviewQueueItem[] | null {
    const fingerprint = (items: readonly ReviewQueueItem[]) => JSON.stringify(items);
    const baselineFingerprint = fingerprint(baseline);
    const currentFingerprint = fingerprint(current);
    const persistedFingerprint = fingerprint(persisted);
    if (currentFingerprint === persistedFingerprint) {
        return current.map((item) => cloneSerializable(item));
    }
    if (currentFingerprint === baselineFingerprint) {
        return persisted.map((item) => cloneSerializable(item));
    }
    if (persistedFingerprint === baselineFingerprint) {
        return current.map((item) => cloneSerializable(item));
    }
    return null;
}

function readLiveNonMemoryItems(
    reviewQueue: unknown,
): { ok: true; items: ReviewQueueItem[] } | { ok: false; errorCode: string } {
    if (!isRecord(reviewQueue) || !Array.isArray(reviewQueue.items)) {
        return { ok: false, errorCode: "live_review_queue_invalid" };
    }
    const items: ReviewQueueItem[] = [];
    for (const candidate of reviewQueue.items) {
        if (!isRecord(candidate) || typeof candidate.type !== "string") {
            return { ok: false, errorCode: "live_review_queue_item_invalid" };
        }
        if (MEMORY_QUEUE_TYPES.has(candidate.type as ReviewQueueItem["type"])) continue;
        const validation = validateReviewQueueItem(candidate as unknown as ReviewQueueItem);
        if (!validation.ok) {
            return { ok: false, errorCode: "live_review_queue_item_invalid" };
        }
        items.push(validation.value);
    }
    return { ok: true, items };
}

function cloneSerializable<T>(value: T, seen = new WeakMap<object, unknown>()): T {
    if (typeof value !== "object" || value === null) return value;
    const existing = seen.get(value);
    if (existing !== undefined) return existing as T;
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) {
        const output: unknown[] = [];
        seen.set(value, output);
        for (const entry of value) output.push(cloneSerializable(entry, seen));
        return output as T;
    }
    const output: Record<string, unknown> = {};
    seen.set(value, output);
    for (const key of Object.keys(value)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        defineValue(output, key, cloneSerializable((value as Record<string, unknown>)[key], seen));
    }
    return output as T;
}

function defineValue(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
    });
}

import {
    buildLegacyReviewQueuePassthrough,
    captureLegacyMemoryPayload,
    createDeterministicLegacyMigrationId,
    createMigrationOwnedLegacyMemoryPayload,
    fingerprintLegacyMemoryEntityId,
    hashLegacyMemoryPayload,
    mergeLegacyReviewQueuePassthrough,
    normalizeLegacyMemoryPolicy,
    parseLegacyMemoryPayload,
    redactExactLegacyMemoryPayload,
    type LegacyMemoryPayload,
} from "../src/pa/memory-governance-migration";
import type { ConfirmedMemoryRecord } from "../src/pa/memory-governance-store";
import type { ReviewQueueItem } from "../src/pa/review-queue-store";

const ISO = "2026-07-10T08:00:00.000Z";

function makeClaim(id: string, overrides: Partial<ConfirmedMemoryRecord> = {}): ConfirmedMemoryRecord {
    return {
        id,
        type: "preference",
        lifecycle: "active",
        sensitivity: "low",
        sourceRefs: [{ path: `Notes/${id}.md`, whyShown: ["Explicit evidence"] }],
        summary: `Summary for ${id}`,
        scope: { kind: "current_note", paths: [`Notes/${id}.md`] },
        createdAt: ISO,
        updatedAt: ISO,
        confirmationStrength: "explicit",
        ...overrides,
    };
}

function makeQueueItem(
    id: string,
    type: ReviewQueueItem["type"] = "memory_candidate",
    overrides: Partial<ReviewQueueItem> = {},
): ReviewQueueItem {
    return {
        id,
        type,
        title: `Title for ${id}`,
        claim: `Claim for ${id}`,
        scope: { kind: "current_note", paths: [`Notes/${id}.md`] },
        sourceRefs: [{ path: `Notes/${id}.md` }],
        originSurface: "pagelet",
        priority: "normal",
        status: "suggested",
        createdAt: ISO,
        updatedAt: ISO,
        whyShown: ["Relevant now"],
        dataBoundarySnapshotId: "boundary:v1",
        admissionReason: type === "memory_candidate" || type === "memory_conflict"
            ? "memory_confirmation_required"
            : type === "task_suggestion"
                ? "task_confirmation_required"
                : "user_kept_for_later",
        ...overrides,
    };
}

function makePayload(overrides: Partial<LegacyMemoryPayload> = {}): LegacyMemoryPayload {
    return {
        memoryGovernance: { records: [] },
        reviewQueue: { enabled: true, items: [] },
        confirmedMemoryCount: 0,
        memoryAutoAcceptPaused: false,
        ...overrides,
    };
}

describe("legacy Memory raw capture", () => {
    it("clones all legacy slices before normalization and preserves unknown structure", () => {
        const rawMemory = {
            records: [{ ...makeClaim("claim-1"), futureField: { nested: [1, null, "x"] } }],
            futureContainerField: { keep: true },
        };
        const rawQueue = {
            enabled: false,
            items: [{ id: "unknown", type: "future_type", payload: { keep: ["raw"] } }],
            futureContainerField: ["keep", { exact: true }],
        };
        const loaded = {
            memoryGovernance: rawMemory,
            reviewQueue: rawQueue,
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: true,
            unrelated: { mustNotEnterPayload: true },
        };

        const captured = captureLegacyMemoryPayload(loaded);
        rawMemory.records[0].futureField.nested.push("mutated");
        rawQueue.items[0].payload.keep.push("mutated");

        expect(captured).toEqual({
            memoryGovernance: {
                records: [{ ...makeClaim("claim-1"), futureField: { nested: [1, null, "x"] } }],
                futureContainerField: { keep: true },
            },
            reviewQueue: {
                enabled: false,
                items: [{ id: "unknown", type: "future_type", payload: { keep: ["raw"] } }],
                futureContainerField: ["keep", { exact: true }],
            },
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: true,
        });
        expect(captured).not.toHaveProperty("unrelated");
    });

    it("hashes the migration-owned payload deterministically without depending on object-key order", () => {
        const first = makePayload({
            memoryGovernance: { extra: { b: 2, a: 1 }, records: [makeClaim("claim-1")] },
            reviewQueue: { items: [makeQueueItem("memory-1")], enabled: true },
            confirmedMemoryCount: 30,
        });
        const reordered = makePayload({
            memoryGovernance: { records: [makeClaim("claim-1")], extra: { a: 1, b: 2 } },
            reviewQueue: { enabled: true, items: [makeQueueItem("memory-1")] },
            confirmedMemoryCount: 30,
        });

        expect(hashLegacyMemoryPayload(first)).toBe(hashLegacyMemoryPayload(reordered));
        expect(hashLegacyMemoryPayload(first)).toMatch(/^legacy-v1:[a-f0-9]{32}$/);
        expect(parseLegacyMemoryPayload(first).sourceHash).toBe(hashLegacyMemoryPayload(first));
        expect(hashLegacyMemoryPayload({
            ...first,
            confirmedMemoryCount: 31,
        })).not.toBe(hashLegacyMemoryPayload(first));
        expect(hashLegacyMemoryPayload({
            ...first,
            reviewQueue: {
                items: [
                    makeQueueItem("task-live", "task_suggestion"),
                    makeQueueItem("memory-1"),
                ],
            },
        })).toBe(hashLegacyMemoryPayload(first));
        expect(createMigrationOwnedLegacyMemoryPayload({
            ...first,
            reviewQueue: {
                items: [
                    makeQueueItem("task-live", "task_suggestion"),
                    makeQueueItem("memory-1"),
                ],
            },
        }).reviewQueue).toEqual({ items: [makeQueueItem("memory-1")] });
    });
});

describe("parseLegacyMemoryPayload", () => {
    it("keeps valid siblings, reports redacted rejections, and counts only the Memory queue partition", () => {
        const validClaim = makeClaim("claim-valid");
        const invalidClaim = { ...makeClaim("claim-invalid"), summary: 42 };
        const validMemory = makeQueueItem("memory-valid", "memory_candidate", {
            metadata: { memoryType: "preference", sensitivity: "low" },
        });
        const invalidMemory = { ...makeQueueItem("memory-invalid"), claim: "" };
        const liveNonMemory = makeQueueItem("task-live", "task_suggestion");
        const unknown = { id: "unknown-raw", type: "future_queue_type", payload: { private: "preserve" } };
        const payload = makePayload({
            memoryGovernance: { records: [validClaim, invalidClaim] },
            reviewQueue: {
                enabled: true,
                items: [liveNonMemory, validMemory, invalidMemory, unknown],
            },
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: true,
        });
        const before = JSON.parse(JSON.stringify(payload));

        const parsed = parseLegacyMemoryPayload(payload);

        expect(parsed.acceptedClaims).toEqual([validClaim]);
        expect(parsed.acceptedMemoryQueueItems).toEqual([validMemory]);
        expect(parsed.rejected).toEqual([
            { source: "governance", index: 1, errorCode: "governance_record_invalid" },
            { source: "review_queue", index: 2, errorCode: "review_queue_item_invalid" },
            { source: "review_queue", index: 3, errorCode: "review_queue_item_unknown" },
        ]);
        expect(parsed.rawCounts).toEqual({ governance: 2, memoryQueue: 2, rejected: 3 });
        expect(payload).toEqual(before);
    });

    it("fails duplicate accepted IDs closed instead of choosing one record by order", () => {
        const claimA = makeClaim("duplicate", { summary: "A" });
        const claimB = makeClaim("duplicate", { summary: "B" });
        const memoryA = makeQueueItem("duplicate-memory", "memory_candidate", { claim: "A" });
        const memoryB = makeQueueItem("duplicate-memory", "memory_conflict", { claim: "B" });

        const parsed = parseLegacyMemoryPayload(makePayload({
            memoryGovernance: { records: [claimA, claimB] },
            reviewQueue: { items: [memoryA, memoryB] },
        }));

        expect(parsed.acceptedClaims).toEqual([]);
        expect(parsed.acceptedMemoryQueueItems).toEqual([]);
        expect(parsed.rejected).toEqual([
            { source: "governance", index: 0, errorCode: "governance_id_collision" },
            { source: "governance", index: 1, errorCode: "governance_id_collision" },
            { source: "review_queue", index: 0, errorCode: "review_queue_id_collision" },
            { source: "review_queue", index: 1, errorCode: "review_queue_id_collision" },
        ]);
        expect(parsed.rawCounts).toEqual({ governance: 2, memoryQueue: 2, rejected: 4 });
    });

    it("reports malformed slice shapes without manufacturing accepted entries", () => {
        const parsed = parseLegacyMemoryPayload({
            memoryGovernance: { records: "not-an-array" },
            reviewQueue: { items: 42 },
            confirmedMemoryCount: undefined,
            memoryAutoAcceptPaused: undefined,
        });

        expect(parsed.acceptedClaims).toEqual([]);
        expect(parsed.acceptedMemoryQueueItems).toEqual([]);
        expect(parsed.rejected).toEqual([
            { source: "governance", errorCode: "governance_records_invalid_shape" },
            { source: "review_queue", errorCode: "review_queue_items_invalid_shape" },
        ]);
        expect(parsed.rawCounts).toEqual({ governance: 0, memoryQueue: 0, rejected: 2 });
    });

    it("is deterministic across repeated parsing and includes policy rejections in the count", () => {
        const payload = makePayload({
            memoryGovernance: { records: [makeClaim("stable")] },
            reviewQueue: { items: [makeQueueItem("stable-memory")] },
            confirmedMemoryCount: "30",
            memoryAutoAcceptPaused: null,
        });

        const first = parseLegacyMemoryPayload(payload);
        first.acceptedClaims[0].sourceRefs[0].path = "mutated-output.md";
        const second = parseLegacyMemoryPayload(payload);
        const third = parseLegacyMemoryPayload(payload);

        expect(second).toEqual(third);
        expect(second.acceptedClaims[0].sourceRefs[0].path).toBe("Notes/stable.md");
        expect(second.rejected).toEqual([
            { source: "policy", errorCode: "policy_confirmed_count_invalid" },
            { source: "policy", errorCode: "policy_pause_invalid" },
        ]);
        expect(second.rawCounts).toEqual({ governance: 1, memoryQueue: 1, rejected: 2 });
    });
});

describe("legacy trust policy normalization", () => {
    it.each([29, 30, 31])("preserves cumulative count %i without inventing claim history", (count) => {
        const payload = makePayload({ confirmedMemoryCount: count, memoryAutoAcceptPaused: true });

        expect(normalizeLegacyMemoryPolicy(payload)).toEqual({
            baseline: {
                confirmedCount: count,
                threshold: 30,
                autoAcceptPaused: true,
            },
            rejected: [],
        });
        expect(parseLegacyMemoryPayload(payload).acceptedClaims).toEqual([]);
    });

    it.each([
        [-1],
        [1.5],
        [Number.POSITIVE_INFINITY],
        ["30"],
    ])("fails malformed count %p closed to zero and keeps pause false unless it is a boolean", (count) => {
        const normalized = normalizeLegacyMemoryPolicy(makePayload({
            confirmedMemoryCount: count,
            memoryAutoAcceptPaused: "true",
        }));

        expect(normalized).toEqual({
            baseline: {
                confirmedCount: 0,
                threshold: 30,
                autoAcceptPaused: false,
            },
            rejected: [
                { source: "policy", errorCode: "policy_confirmed_count_invalid" },
                { source: "policy", errorCode: "policy_pause_invalid" },
            ],
        });
    });
});

describe("legacy Review Queue passthrough", () => {
    it("preserves raw Memory/rejected/unknown entries and exposes only validated non-Memory items live", () => {
        const live = makeQueueItem("task-live", "task_suggestion");
        const rawMemory = {
            ...makeQueueItem("memory-raw", "memory_candidate"),
            futureField: { preserve: [1, 2, 3] },
        };
        const rejected = { ...makeQueueItem("task-invalid", "task_suggestion"), title: "" };
        const unknown = { id: "unknown-raw", type: "future_type", payload: { exact: true } };
        const rawReviewQueue = { enabled: false, items: [live, rawMemory, rejected, unknown] };

        const passthrough = buildLegacyReviewQueuePassthrough(rawReviewQueue);

        expect(passthrough.liveNonMemoryItems).toEqual([live]);
        expect(passthrough.preservedRawEntries).toEqual([
            { originalIndex: 1, id: "memory-raw", reason: "memory_item", value: rawMemory },
            { originalIndex: 2, id: "task-invalid", reason: "rejected", value: rejected },
            { originalIndex: 3, id: "unknown-raw", reason: "unknown", value: unknown },
        ]);
        expect(mergeLegacyReviewQueuePassthrough(
            rawReviewQueue,
            passthrough.liveNonMemoryItems,
        )).toEqual({ ok: true, reviewQueue: rawReviewQueue });
        (passthrough.preservedRawEntries[0].value as typeof rawMemory).futureField.preserve.push(4);
        expect(rawMemory.futureField.preserve).toEqual([1, 2, 3]);
    });

    it("replaces only the live non-Memory partition while preserving raw wrapper fields and relative order", () => {
        const oldTask = makeQueueItem("task-old", "task_suggestion");
        const rawMemory = {
            ...makeQueueItem("memory-raw", "memory_candidate"),
            futureField: { exact: ["raw"] },
        };
        const unknown = { id: "unknown-raw", type: "future_type", payload: { exact: true } };
        const rawReviewQueue = {
            enabled: false,
            futureContainerField: { preserve: true },
            items: [oldTask, rawMemory, unknown],
        };
        const nextTask = makeQueueItem("task-next", "task_suggestion", { status: "accepted" });
        const nextRelated = makeQueueItem("related-next", "related_note");

        const merged = mergeLegacyReviewQueuePassthrough(rawReviewQueue, [nextTask, nextRelated]);
        const repeated = mergeLegacyReviewQueuePassthrough(rawReviewQueue, [nextTask, nextRelated]);

        expect(merged).toEqual({
            ok: true,
            reviewQueue: {
                enabled: false,
                futureContainerField: { preserve: true },
                items: [nextTask, rawMemory, unknown, nextRelated],
            },
        });
        expect(repeated).toEqual(merged);
        expect(rawReviewQueue.items).toEqual([oldTask, rawMemory, unknown]);
    });

    it("fails a live/preserved ID collision closed and returns the unchanged previous payload", () => {
        const previous = {
            enabled: true,
            items: [
                makeQueueItem("task-old", "task_suggestion"),
                { ...makeQueueItem("preserved-id", "memory_candidate"), future: "keep" },
            ],
        };
        const before = JSON.parse(JSON.stringify(previous));
        const collidingLive = makeQueueItem("preserved-id", "task_suggestion");

        const merged = mergeLegacyReviewQueuePassthrough(previous, [collidingLive]);

        expect(merged).toEqual({
            ok: false,
            errorCode: "review_queue_id_collision",
            reviewQueue: before,
        });
        expect(previous).toEqual(before);
    });

    it("fails malformed live items and malformed raw containers closed", () => {
        const invalidLive = { ...makeQueueItem("memory-live", "memory_candidate") };
        expect(mergeLegacyReviewQueuePassthrough({ items: [] }, [invalidLive])).toEqual({
            ok: false,
            errorCode: "live_memory_item_forbidden",
            reviewQueue: { items: [] },
        });
        expect(mergeLegacyReviewQueuePassthrough({ items: "corrupt" }, [])).toEqual({
            ok: false,
            errorCode: "review_queue_items_invalid_shape",
            reviewQueue: { items: "corrupt" },
        });
        expect(mergeLegacyReviewQueuePassthrough({ items: [] }, [null])).toEqual({
            ok: false,
            errorCode: "live_non_memory_item_invalid",
            reviewQueue: { items: [] },
        });
    });
});

describe("exact legacy Memory redaction", () => {
    it("removes only fingerprint-matched valid entities and preserves unrelated raw siblings", () => {
        const targetRecord = makeClaim("descriptive user preference id");
        const otherRecord = makeClaim("record-other", { summary: targetRecord.summary });
        const targetQueue = makeQueueItem("descriptive queue id");
        const unlinkedQueue = makeQueueItem("queue-unlinked");
        const nonMemory = makeQueueItem("task-keep", "task_suggestion");
        const malformed = { id: "malformed-keep", type: "memory_candidate", privateFuture: true };
        const payload = makePayload({
            memoryGovernance: {
                futureContainerField: { keep: true },
                records: [otherRecord, targetRecord],
            },
            reviewQueue: {
                enabled: false,
                futureContainerField: ["keep"],
                items: [nonMemory, targetQueue, malformed, unlinkedQueue],
            },
            confirmedMemoryCount: 42,
            memoryAutoAcceptPaused: true,
        });

        const result = redactExactLegacyMemoryPayload(payload, {
            recordIdFingerprints: [fingerprintLegacyMemoryEntityId("record", targetRecord.id)],
            memoryQueueItemIdFingerprints: [
                fingerprintLegacyMemoryEntityId("memory_queue", targetQueue.id),
            ],
        });

        expect(result).toMatchObject({
            ok: true,
            changed: true,
            removedRecordCount: 1,
            removedMemoryQueueItemCount: 1,
        });
        if (!result.ok) throw new Error(result.reason);
        expect(result.payload).toEqual({
            memoryGovernance: {
                futureContainerField: { keep: true },
                records: [otherRecord],
            },
            reviewQueue: {
                enabled: false,
                futureContainerField: ["keep"],
                items: [nonMemory, malformed, unlinkedQueue],
            },
            confirmedMemoryCount: 42,
            memoryAutoAcceptPaused: true,
        });
        expect((result.payload.memoryGovernance as { records: ConfirmedMemoryRecord[] })
            .records.map((record) => record.id))
            .not.toContain("descriptive user preference id");

        const repeated = redactExactLegacyMemoryPayload(result.payload, {
            recordIdFingerprints: [fingerprintLegacyMemoryEntityId("record", targetRecord.id)],
            memoryQueueItemIdFingerprints: [
                fingerprintLegacyMemoryEntityId("memory_queue", targetQueue.id),
            ],
        });
        expect(repeated).toMatchObject({
            ok: true,
            changed: false,
            sourceHash: result.sourceHash,
        });
    });

    it("fails closed on an invalid matching entity or an invalid fingerprint plan", () => {
        const raw = makePayload({
            memoryGovernance: { records: [{ id: "target", summary: "incomplete" }] },
        });
        expect(redactExactLegacyMemoryPayload(raw, {
            recordIdFingerprints: [fingerprintLegacyMemoryEntityId("record", "target")],
            memoryQueueItemIdFingerprints: [],
        })).toEqual({ ok: false, reason: "legacy_redaction_record_invalid" });
        expect(redactExactLegacyMemoryPayload(raw, {
            recordIdFingerprints: ["target"],
            memoryQueueItemIdFingerprints: [],
        })).toEqual({ ok: false, reason: "legacy_redaction_targets_invalid" });
        expect(raw).toEqual(makePayload({
            memoryGovernance: { records: [{ id: "target", summary: "incomplete" }] },
        }));
    });
});

describe("deterministic legacy migration IDs", () => {
    it("is repeatable, opaque, and partitioned by entity, vault, source, and index", () => {
        const input = {
            kind: "claim" as const,
            opaqueVaultKey: "vault-opaque-a",
            sourceHash: "legacy-v1:0123456789abcdef0123456789abcdef",
            sourceIndex: 2,
            legacyId: "private-legacy-id",
        };
        const first = createDeterministicLegacyMigrationId(input);

        expect(createDeterministicLegacyMigrationId(input)).toBe(first);
        expect(first).toMatch(/^legacy-claim-[a-f0-9]{24}$/);
        expect(first).not.toContain("private-legacy-id");
        expect(createDeterministicLegacyMigrationId({ ...input, sourceIndex: 3 })).not.toBe(first);
        expect(createDeterministicLegacyMigrationId({ ...input, opaqueVaultKey: "vault-opaque-b" })).not.toBe(first);
        expect(createDeterministicLegacyMigrationId({ ...input, kind: "revision" })).not.toBe(first);
        expect(createDeterministicLegacyMigrationId({ ...input, sourceHash: "legacy-v1:changed" })).not.toBe(first);
    });
});

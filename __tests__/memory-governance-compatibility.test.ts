import { LegacyMemoryCompatibilityBarrier } from "../src/pa/memory-governance-compatibility";

const sourceRef = { path: "notes/source.md" };

function queueItem(id: string, type: "memory_candidate" | "evidence_insight") {
    return {
        id,
        type,
        title: id,
        claim: `${id} claim`,
        scope: { kind: "current_note", paths: ["notes/source.md"] },
        sourceRefs: [sourceRef],
        originSurface: "pagelet",
        priority: "normal",
        status: "suggested",
        createdAt: "2026-07-10T08:00:00.000Z",
        updatedAt: "2026-07-10T08:00:00.000Z",
        whyShown: [],
        dataBoundarySnapshotId: "boundary",
        admissionReason: type === "memory_candidate"
            ? "memory_confirmation_required"
            : "user_kept_for_later",
        ...(type === "memory_candidate"
            ? { metadata: { memoryType: "preference", sensitivity: "low" } }
            : {}),
    };
}

describe("LegacyMemoryCompatibilityBarrier", () => {
    it("preserves raw Memory slices while replacing only live non-Memory queue items", () => {
        const rawMemory = queueItem("legacy-memory", "memory_candidate");
        const rawUnknown = { id: "unknown", futureShape: { keep: true } };
        const raw = {
            theme: "dark",
            memoryGovernance: { records: [{ raw: "keep-structurally" }], future: 1 },
            reviewQueue: {
                enabled: true,
                future: { keep: true },
                items: [queueItem("old-live", "evidence_insight"), rawMemory, rawUnknown],
            },
            confirmedMemoryCount: 31,
            memoryAutoAcceptPaused: true,
        };
        const barrier = new LegacyMemoryCompatibilityBarrier(raw);
        const current = {
            theme: "light",
            memoryGovernance: { records: [] },
            reviewQueue: {
                enabled: true,
                items: [
                    queueItem("new-live", "evidence_insight"),
                    queueItem("new-local-memory", "memory_candidate"),
                ],
            },
            confirmedMemoryCount: 99,
            memoryAutoAcceptPaused: false,
        };

        const result = barrier.composeForSave(current);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.errorCode);
        expect(result.payload).toMatchObject({
            theme: "light",
            memoryGovernance: raw.memoryGovernance,
            confirmedMemoryCount: 31,
            memoryAutoAcceptPaused: true,
            reviewQueue: {
                enabled: true,
                future: { keep: true },
            },
        });
        expect((result.payload.reviewQueue as { items: unknown[] }).items).toEqual([
            queueItem("new-live", "evidence_insight"),
            rawMemory,
            rawUnknown,
        ]);
        expect(result.payload).not.toBe(current);
        expect(result.payload.memoryGovernance).not.toBe(raw.memoryGovernance);
    });

    it("composes from the latest persisted source so a stale window cannot restore removed Memory", () => {
        const original = {
            memoryGovernance: { records: [{ id: "legacy-original" }] },
            reviewQueue: { items: [queueItem("legacy-original", "memory_candidate")] },
            confirmedMemoryCount: 1,
            memoryAutoAcceptPaused: false,
        };
        const persistedAfterForget = {
            memoryGovernance: { records: [] },
            reviewQueue: { items: [] },
            confirmedMemoryCount: 1,
            memoryAutoAcceptPaused: false,
        };
        const barrier = new LegacyMemoryCompatibilityBarrier(original);

        const result = barrier.composeForSave({
            theme: "light",
            memoryGovernance: original.memoryGovernance,
            reviewQueue: { items: [] },
            confirmedMemoryCount: 99,
            memoryAutoAcceptPaused: true,
        }, persistedAfterForget);

        expect(result).toEqual({
            ok: true,
            payload: {
                theme: "light",
                memoryGovernance: { records: [] },
                reviewQueue: { items: [] },
                confirmedMemoryCount: 1,
                memoryAutoAcceptPaused: false,
            },
        });
        expect(barrier.refreshFromPersisted(result.ok ? result.payload : original)).toBe(true);
        expect(barrier.snapshot().memoryGovernance).toEqual({ records: [] });
    });

    it("preserves an external non-Memory queue change and rejects divergent concurrent edits", () => {
        const baselineItem = queueItem("baseline", "evidence_insight");
        const externalItem = queueItem("external", "evidence_insight");
        const localItem = queueItem("local", "evidence_insight");
        const raw = {
            memoryGovernance: { records: [] },
            reviewQueue: { items: [baselineItem] },
            confirmedMemoryCount: 0,
            memoryAutoAcceptPaused: false,
        };
        const persisted = {
            ...raw,
            reviewQueue: { items: [baselineItem, externalItem] },
        };
        const barrier = new LegacyMemoryCompatibilityBarrier(raw);

        const staleSave = barrier.composeForSave({
            ...raw,
            theme: "light",
        }, persisted);
        expect(staleSave).toMatchObject({ ok: true });
        if (!staleSave.ok) throw new Error(staleSave.errorCode);
        expect((staleSave.payload.reviewQueue as { items: unknown[] }).items)
            .toEqual([baselineItem, externalItem]);

        expect(barrier.composeForSave({
            ...raw,
            reviewQueue: { items: [baselineItem, localItem] },
        }, persisted)).toEqual({
            ok: false,
            errorCode: "review_queue_concurrent_change",
        });
    });

    it("fails closed on a collision with a preserved raw item", () => {
        const raw = {
            memoryGovernance: { records: [] },
            reviewQueue: { items: [queueItem("same-id", "memory_candidate")] },
            confirmedMemoryCount: 0,
            memoryAutoAcceptPaused: false,
        };
        const barrier = new LegacyMemoryCompatibilityBarrier(raw);

        expect(barrier.composeForSave({
            memoryGovernance: { records: [] },
            reviewQueue: { items: [queueItem("same-id", "evidence_insight")] },
            confirmedMemoryCount: 1,
            memoryAutoAcceptPaused: true,
        })).toEqual({ ok: false, errorCode: "review_queue_id_collision" });
    });

    it("keeps malformed raw queue data unsaved rather than normalizing it away", () => {
        const barrier = new LegacyMemoryCompatibilityBarrier({
            reviewQueue: { items: "future-shape" },
        });

        expect(barrier.composeForSave({
            reviewQueue: { items: [] },
        })).toEqual({ ok: false, errorCode: "review_queue_items_invalid_shape" });
    });

    it("releases legacy ownership only through explicit finalization", () => {
        const barrier = new LegacyMemoryCompatibilityBarrier({
            memoryGovernance: { records: [{ id: "legacy" }] },
            reviewQueue: { items: [] },
            confirmedMemoryCount: 30,
            memoryAutoAcceptPaused: true,
        });
        const current = {
            memoryGovernance: { records: [{ id: "current" }] },
            reviewQueue: { items: [] },
            confirmedMemoryCount: 1,
            memoryAutoAcceptPaused: false,
        };

        barrier.finalize();

        expect(barrier.isActive()).toBe(false);
        expect(barrier.composeForSave(current)).toEqual({ ok: true, payload: current });
    });

    it("blocks ordinary saves while finalization is in progress", () => {
        const barrier = new LegacyMemoryCompatibilityBarrier({
            memoryGovernance: { records: [{ id: "legacy" }] },
            reviewQueue: { items: [queueItem("legacy-memory", "memory_candidate")] },
            confirmedMemoryCount: 30,
            memoryAutoAcceptPaused: true,
        });
        const liveNonMemory = queueItem("live-insight", "evidence_insight");
        const current = {
            theme: "dark",
            memoryGovernance: { records: [{ id: "must-not-return" }] },
            reviewQueue: {
                enabled: true,
                items: [liveNonMemory, queueItem("local-memory", "memory_candidate")],
            },
            confirmedMemoryCount: 44,
            memoryAutoAcceptPaused: true,
        };

        barrier.beginFinalization();

        expect(barrier.composeForSave(current)).toEqual({
            ok: false,
            errorCode: "memory_finalization_in_progress",
        });
    });

    it("cancels finalization only with a fresh compatibility source", () => {
        const barrier = new LegacyMemoryCompatibilityBarrier({
            memoryGovernance: { records: [{ id: "legacy-before" }] },
            reviewQueue: { items: [queueItem("legacy-before", "memory_candidate")] },
            confirmedMemoryCount: 30,
            memoryAutoAcceptPaused: true,
        });
        const changedMemory = queueItem("legacy-after", "memory_candidate");
        barrier.beginFinalization();

        expect(barrier.cancelFinalization({
            memoryGovernance: { records: [{ id: "legacy-after" }] },
            reviewQueue: { items: [changedMemory] },
            confirmedMemoryCount: 31,
            memoryAutoAcceptPaused: false,
        })).toBe(true);

        expect(barrier.composeForSave({
            memoryGovernance: { records: [] },
            reviewQueue: { items: [] },
            confirmedMemoryCount: 0,
            memoryAutoAcceptPaused: true,
        })).toEqual({
            ok: true,
            payload: {
                memoryGovernance: { records: [{ id: "legacy-after" }] },
                reviewQueue: { items: [changedMemory] },
                confirmedMemoryCount: 31,
                memoryAutoAcceptPaused: false,
            },
        });
    });

    it("builds a side-effect-free finalization payload that preserves unrelated settings", () => {
        const barrier = new LegacyMemoryCompatibilityBarrier({
            memoryGovernance: { records: [{ id: "legacy" }] },
            reviewQueue: { items: [queueItem("legacy-memory", "memory_candidate")] },
            confirmedMemoryCount: 30,
            memoryAutoAcceptPaused: true,
        });
        const liveNonMemory = queueItem("live-insight", "evidence_insight");
        const current = {
            theme: "light",
            memoryGovernance: { records: [{ id: "local-only" }], future: "keep" },
            reviewQueue: {
                enabled: true,
                future: "keep",
                items: [liveNonMemory, queueItem("local-memory", "memory_candidate")],
            },
            confirmedMemoryCount: 44,
            memoryAutoAcceptPaused: true,
        };

        const result = barrier.composeForFinalization(current);

        expect(result).toEqual({
            ok: true,
            payload: {
                theme: "light",
                memoryGovernance: { records: [], future: "keep" },
                reviewQueue: {
                    enabled: true,
                    future: "keep",
                    items: [liveNonMemory],
                },
                confirmedMemoryCount: 0,
                memoryAutoAcceptPaused: false,
            },
        });
        expect(barrier.isActive()).toBe(true);
        expect(current.memoryGovernance.records).toEqual([{ id: "local-only" }]);
        expect(current.reviewQueue.items).toHaveLength(2);
    });

    it("fails finalization closed when the live non-Memory queue is invalid", () => {
        const barrier = new LegacyMemoryCompatibilityBarrier({ reviewQueue: { items: [] } });

        expect(barrier.composeForFinalization({
            reviewQueue: { items: [{ id: "broken", type: "evidence_insight" }] },
        })).toEqual({ ok: false, errorCode: "live_review_queue_item_invalid" });
        expect(barrier.isActive()).toBe(true);
    });

    it("returns clone-safe captured state", () => {
        const raw = { reviewQueue: { items: [queueItem("memory", "memory_candidate")] } };
        const barrier = new LegacyMemoryCompatibilityBarrier(raw);
        const first = barrier.snapshot();
        (first.reviewQueue as { items: unknown[] }).items.length = 0;

        expect((barrier.snapshot().reviewQueue as { items: unknown[] }).items).toHaveLength(1);
    });
});

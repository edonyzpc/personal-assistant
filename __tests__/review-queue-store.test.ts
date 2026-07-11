import { describe, expect, it, jest } from "@jest/globals";

import {
    ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES,
    CallbackReviewQueueRepository,
    ReviewQueueStore,
    groupReviewQueueItemsForTab,
    hasForbiddenPersistedTextFields,
    reviewQueueAdmissionReasonForItem,
    validateSourceRefPathShape,
} from "../src/pa";
import type {
    PersistedSourceRef,
    ReviewQueueCreateInput,
    ReviewQueueItem,
    ReviewQueueRepository,
} from "../src/pa";
import { mergeReviewQueueSettings } from "../src/settings";

const sourceRef: PersistedSourceRef = {
    path: "notes/source.md",
    excerptHash: "abc123",
    whyShown: ["Matched by content"],
    evidenceStrength: "strong",
};

function makeStore() {
    const persist = jest.fn(async (_state: unknown) => undefined);
    const store = new ReviewQueueStore({
        persist,
        idFactory: () => "rq-test",
        now: () => new Date("2026-06-28T12:00:00.000Z"),
    });
    return { store, persist };
}

describe("ReviewQueueStore", () => {
    it("activates Pagelet evidence and maintenance preview producer types", () => {
        expect(ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES).toContain("evidence_insight");
        expect(ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES).toContain("maintenance_proposal");
        expect(ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES).toContain("theme_chain");
        expect(ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES).toContain("conflict_pair");
        expect(ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES).toContain("index_note_candidate");
    });

    it("creates, persists, filters, dismisses, and snoozes local queue items", async () => {
        const { store, persist } = makeStore();

        const created = await store.create({
            type: "evidence_insight",
            title: "Evidence insight",
            claim: "This note needs clearer evidence.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later",
            whyShown: ["Part of selected scope"],
        });

        expect(created.ok).toBe(true);
        expect(store.list({ scopePaths: ["notes/source.md"] })).toHaveLength(1);
        expect(store.list({ scopePaths: ["notes/other.md"] })).toHaveLength(0);
        expect(persist).toHaveBeenCalledWith({
            items: [expect.objectContaining({ id: "rq-test", status: "suggested" })],
        });

        await store.snooze("rq-test", "2026-06-29T12:00:00.000Z");
        expect(store.list({ statuses: ["snoozed"] })[0]).toMatchObject({
            id: "rq-test",
            snoozedUntil: "2026-06-29T12:00:00.000Z",
        });

        await store.dismiss("rq-test");
        expect(store.list({ statuses: ["dismissed"] })[0]).toMatchObject({
            id: "rq-test",
            status: "dismissed",
        });
    });

    it("allows a reserved item to move to failed when the durable action fails", async () => {
        const { store } = makeStore();
        await store.create({
            type: "memory_candidate",
            title: "Memory candidate",
            claim: "Prefers concise planning notes.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "memory_confirmation_required",
            metadata: { memoryType: "preference", sensitivity: "low" },
        });

        await expect(store.updateStatus("rq-test", "accepted")).resolves.toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: "accepted" }),
        });
        await expect(store.updateStatus("rq-test", "failed")).resolves.toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: "failed" }),
        });
    });

    it("keeps direct accepted-to-suggested rollback out of the generic state machine", async () => {
        const { store } = makeStore();
        await store.create({
            type: "memory_candidate",
            title: "Memory candidate",
            claim: "Prefers concise planning notes.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "memory_confirmation_required",
            metadata: { memoryType: "preference", sensitivity: "low" },
        });

        await expect(store.updateStatus("rq-test", "accepted")).resolves.toMatchObject({
            ok: true,
            value: expect.objectContaining({ status: "accepted" }),
        });
        await expect(store.updateStatus("rq-test", "suggested")).resolves.toEqual({
            ok: false,
            reason: "invalid_transition_accepted_to_suggested",
        });
    });

    it("rejects inactive, unknown, source-less, or raw-output-shaped producer inputs", async () => {
        const { store } = makeStore();

        await expect(store.create({
            type: "memory_conflict",
            title: "Memory",
            claim: "Remember this.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "conflict_resolution_required",
        })).resolves.toEqual({ ok: false, reason: "type_not_active" });

        await expect(store.create({
            type: "evidence_insight",
            title: "No source",
            claim: "Unsupported.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later",
        })).resolves.toEqual({ ok: false, reason: "missing_source_refs" });

        await expect(store.create({
            type: "evidence_insight",
            title: "Raw output",
            claim: "Bad shape.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later",
            metadata: { providerOutput: "raw" } as never,
        })).resolves.toEqual({ ok: false, reason: "forbidden_persisted_text" });

        await expect(store.create({
            type: "evidence_insight",
            title: "Absolute source",
            claim: "Bad path.",
            scope: { kind: "current_note", paths: ["/private/source.md"] },
            sourceRefs: [{ ...sourceRef, path: "/private/source.md" }],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later",
        })).resolves.toEqual({ ok: false, reason: "invalid_source_ref_absolute_path" });

        await expect(store.create({
            type: "evidence_insight",
            title: "No admission reason",
            claim: "Unsupported.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
        } as ReviewQueueCreateInput)).resolves.toEqual({ ok: false, reason: "missing_admission_reason" });

        await expect(store.create({
            type: "related_note",
            title: "Read-only related note",
            claim: "Generated only.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "memory_confirmation_required",
        })).resolves.toEqual({ ok: false, reason: "admission_reason_not_allowed" });
    });

    it("deduplicates equivalent source-backed items instead of duplicating render-created state", async () => {
        const { store } = makeStore();
        const input = {
            type: "evidence_insight" as const,
            title: "Evidence insight",
            claim: "This note needs clearer evidence.",
            scope: { kind: "current_note" as const, paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet" as const,
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later" as const,
        };

        await store.create(input);
        await store.create(input);

        expect(store.list()).toHaveLength(1);
    });

    it("preserves handled duplicate status instead of resurfacing it as suggested", async () => {
        const { store, persist } = makeStore();
        const input = {
            type: "theme_chain" as const,
            title: "Theme chain",
            claim: "These notes may share a theme.",
            scope: { kind: "current_note" as const, paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet" as const,
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later" as const,
        };

        await store.create(input);
        await store.dismiss("rq-test");
        persist.mockClear();
        const duplicate = await store.create(input);

        expect(duplicate).toMatchObject({
            ok: true,
            value: {
                id: "rq-test",
                status: "dismissed",
            },
        });
        expect(store.list()).toHaveLength(1);
        expect(store.list({ statuses: ["dismissed"] })).toHaveLength(1);
        expect(persist).not.toHaveBeenCalled();
    });

    it("normalizes persisted queue state and drops invalid/private-text-shaped items", () => {
        const settings = mergeReviewQueueSettings({
            enabled: true,
            items: [
                {
                    id: "good",
                    type: "evidence_insight",
                    title: "Good",
                    claim: "Source-backed.",
                    scope: { kind: "current_note", paths: ["notes/source.md"] },
                    sourceRefs: [sourceRef],
                    originSurface: "pagelet",
                    priority: "normal",
                    status: "suggested",
                    createdAt: "2026-06-28T12:00:00.000Z",
                    updatedAt: "2026-06-28T12:00:00.000Z",
                    whyShown: [],
                    dataBoundarySnapshotId: "boundary-test",
                },
                {
                    id: "bad",
                    type: "evidence_insight",
                    title: "Bad",
                    claim: "Bad.",
                    scope: { kind: "current_note", paths: ["notes/source.md"] },
                    sourceRefs: [sourceRef],
                    originSurface: "pagelet",
                    priority: "normal",
                    status: "suggested",
                    createdAt: "2026-06-28T12:00:00.000Z",
                    updatedAt: "2026-06-28T12:00:00.000Z",
                    whyShown: [],
                    dataBoundarySnapshotId: "boundary-test",
                    fullProviderOutput: "raw",
                },
                {
                    id: "null-source",
                    type: "evidence_insight",
                    title: "Bad source",
                    claim: "Bad.",
                    scope: { kind: "current_note", paths: ["notes/source.md"] },
                    sourceRefs: [null],
                    originSurface: "pagelet",
                    priority: "normal",
                    status: "suggested",
                    createdAt: "2026-06-28T12:00:00.000Z",
                    updatedAt: "2026-06-28T12:00:00.000Z",
                    whyShown: [],
                    dataBoundarySnapshotId: "boundary-test",
                },
                {
                    id: "bad-scope",
                    type: "evidence_insight",
                    title: "Bad scope",
                    claim: "Bad.",
                    scope: { kind: "current_note", paths: 42 },
                    sourceRefs: [sourceRef],
                    originSurface: "pagelet",
                    priority: "normal",
                    status: "suggested",
                    createdAt: "2026-06-28T12:00:00.000Z",
                    updatedAt: "2026-06-28T12:00:00.000Z",
                    whyShown: [],
                    dataBoundarySnapshotId: "boundary-test",
                },
                {
                    id: "bad-why",
                    type: "evidence_insight",
                    title: "Bad why",
                    claim: "Bad.",
                    scope: { kind: "current_note", paths: ["notes/source.md"] },
                    sourceRefs: [sourceRef],
                    originSurface: "pagelet",
                    priority: "normal",
                    status: "suggested",
                    createdAt: "2026-06-28T12:00:00.000Z",
                    updatedAt: "2026-06-28T12:00:00.000Z",
                    whyShown: [null],
                    dataBoundarySnapshotId: "boundary-test",
                },
            ],
        });

        expect(settings.items.map((item) => item.id)).toEqual(["good"]);
        expect(reviewQueueAdmissionReasonForItem(settings.items[0])).toBe("legacy_pre_refactor");
        expect(hasForbiddenPersistedTextFields(settings.items[0])).toBe(false);
        expect(validateSourceRefPathShape(null as never)).toEqual({ ok: false, reason: "source_ref_not_object" });
        expect(validateSourceRefPathShape({ path: "\\private\\note.md" }))
            .toEqual({ ok: false, reason: "absolute_path" });
        expect(validateSourceRefPathShape({ path: "\\\\server\\share.md" }))
            .toEqual({ ok: false, reason: "absolute_path" });
    });

    it("groups queue statuses into product-facing tab buckets", () => {
        const base = {
            id: "base",
            type: "evidence_insight" as const,
            title: "Item",
            claim: "Claim.",
            scope: { kind: "current_note" as const, paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet" as const,
            priority: "normal" as const,
            createdAt: "2026-06-28T12:00:00.000Z",
            updatedAt: "2026-06-28T12:00:00.000Z",
            whyShown: [],
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later" as const,
        };

        expect(groupReviewQueueItemsForTab([
            { ...base, id: "suggested", status: "suggested" },
            { ...base, id: "accepted", status: "accepted" },
            { ...base, id: "applied", status: "applied" },
            { ...base, id: "snoozed", status: "snoozed" },
            { ...base, id: "dismissed", status: "dismissed" },
        ]).map((group) => [group.group, group.items.map((item) => item.id)])).toEqual([
            ["active", ["suggested", "accepted"]],
            ["history", ["applied", "snoozed", "dismissed"]],
        ]);
    });

    it("leaves state unchanged when create or status persistence fails", async () => {
        let rejectPersist = true;
        let nextId = 0;
        const store = new ReviewQueueStore({
            idFactory: () => `rq-${++nextId}`,
            persist: async () => {
                if (rejectPersist) throw new Error("disk unavailable");
            },
        });
        const input: ReviewQueueCreateInput = {
            type: "evidence_insight",
            title: "Evidence insight",
            claim: "This note needs clearer evidence.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later",
        };

        await expect(store.create(input)).rejects.toThrow("disk unavailable");
        expect(store.snapshot()).toEqual({ items: [] });

        rejectPersist = false;
        const created = await store.create(input);
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const beforeUpdate = store.snapshot();

        rejectPersist = true;
        await expect(store.updateStatus(created.value.id, "accepted")).rejects.toThrow("disk unavailable");
        expect(store.snapshot()).toEqual(beforeUpdate);
    });

    it("serializes persistence so an older snapshot cannot finish after a newer one", async () => {
        let releaseFirst!: () => void;
        let markFirstStarted!: () => void;
        const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
        const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
        let persistCalls = 0;
        const persist = jest.fn(async () => {
            persistCalls += 1;
            if (persistCalls === 1) {
                markFirstStarted();
                await firstBlocked;
            }
        });
        let nextId = 0;
        const store = new ReviewQueueStore({ persist, idFactory: () => `rq-${++nextId}` });
        const input = (claim: string): ReviewQueueCreateInput => ({
            type: "evidence_insight",
            title: claim,
            claim,
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [sourceRef],
            originSurface: "pagelet",
            dataBoundarySnapshotId: "boundary-test",
            admissionReason: "user_kept_for_later",
        });

        const first = store.create(input("First"));
        await firstStarted;
        const second = store.create(input("Second"));
        await Promise.resolve();
        const callsBeforeRelease = persist.mock.calls.length;
        releaseFirst();
        await Promise.all([first, second]);

        expect(callsBeforeRelease).toBe(1);
        expect(store.list().map((item) => item.claim)).toEqual(["Second", "First"]);
    });

    it("persists through the repository interface without changing queue behavior", async () => {
        const initial = makePersistedItem("repo-item");
        const writes: ReviewQueueItem[][] = [];
        const repository: ReviewQueueRepository = {
            read: () => ({ items: [initial] }),
            write: async (state) => {
                writes.push(state.items.map((item) => ({
                    ...item,
                    scope: { ...item.scope },
                    sourceRefs: item.sourceRefs.map((ref) => ({ ...ref })),
                    whyShown: [...item.whyShown],
                })));
            },
        };
        const store = new ReviewQueueStore({
            repository,
            now: () => new Date("2026-06-28T12:30:00.000Z"),
        });

        await expect(store.updateStatus("repo-item", "accepted")).resolves.toMatchObject({
            ok: true,
            value: { status: "accepted" },
        });
        expect(writes).toHaveLength(1);
        expect(writes[0][0].status).toBe("accepted");
        writes[0][0].claim = "mutated repository argument";
        expect(store.list()[0].claim).toBe(initial.claim);
    });

    it("keeps the callback repository clone-safe and publishes only after persistence", async () => {
        let rejectWrite = true;
        const initial = makePersistedItem("callback-item");
        const repository = new CallbackReviewQueueRepository([initial], async () => {
            if (rejectWrite) throw new Error("persist failed");
        });
        const failed = {
            ...initial,
            status: "accepted" as const,
            updatedAt: "2026-06-28T12:30:00.000Z",
        };

        await expect(repository.write({ items: [failed] })).rejects.toThrow("persist failed");
        expect(repository.read().items[0].status).toBe("suggested");

        rejectWrite = false;
        await expect(repository.write({ items: [failed] })).resolves.toBeUndefined();
        const firstRead = repository.read();
        firstRead.items[0].claim = "mutated read";
        firstRead.items[0].sourceRefs[0].path = "mutated.md";
        expect(repository.read().items[0]).toMatchObject({
            claim: initial.claim,
            sourceRefs: [{ path: sourceRef.path }],
            status: "accepted",
        });
    });
});

function makePersistedItem(id: string): ReviewQueueItem {
    return {
        id,
        type: "evidence_insight",
        title: `Title ${id}`,
        claim: `Claim ${id}`,
        scope: { kind: "current_note", paths: ["notes/source.md"] },
        sourceRefs: [sourceRef],
        originSurface: "pagelet",
        priority: "normal",
        status: "suggested",
        createdAt: "2026-06-28T12:00:00.000Z",
        updatedAt: "2026-06-28T12:00:00.000Z",
        whyShown: [],
        dataBoundarySnapshotId: "boundary-test",
        admissionReason: "user_kept_for_later",
    };
}

import { describe, expect, it } from "@jest/globals";

import {
    MemoryGovernanceStore,
    decideContextFirewall,
    memoryCandidateFromQueueItem,
    validateConfirmedMemoryRecord,
    type ConfirmedMemoryRecord,
    type MemoryCandidateContract,
    type PersistedSourceRef,
    type ReviewQueueItem,
} from "../src/pa";

const sourceRef: PersistedSourceRef = {
    path: "notes/current.md",
    excerptHash: "abc123",
    whyShown: ["Confirmed by user"],
    evidenceStrength: "strong",
};

function makeQueueItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
    return {
        id: overrides.id ?? "rq-memory",
        type: overrides.type ?? "memory_candidate",
        title: overrides.title ?? "Memory candidate",
        claim: overrides.claim ?? "Prefers concise weekly planning.",
        scope: overrides.scope ?? { kind: "current_note", paths: ["notes/current.md"], label: "Current note" },
        sourceRefs: overrides.sourceRefs ?? [sourceRef],
        originSurface: overrides.originSurface ?? "quick_capture",
        priority: overrides.priority ?? "normal",
        status: overrides.status ?? "suggested",
        createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
        updatedAt: overrides.updatedAt ?? "2026-06-28T12:00:00.000Z",
        whyShown: overrides.whyShown ?? ["May help later"],
        dataBoundarySnapshotId: overrides.dataBoundarySnapshotId ?? "boundary-test",
        metadata: overrides.metadata ?? {
            memoryType: "preference",
            sensitivity: "low",
        },
        replayRef: overrides.replayRef,
        snoozedUntil: overrides.snoozedUntil,
    };
}

function makeCandidate(overrides: Partial<MemoryCandidateContract> = {}): MemoryCandidateContract {
    return {
        id: overrides.id ?? "candidate-1",
        type: overrides.type ?? "preference",
        lifecycle: "candidate",
        sensitivity: overrides.sensitivity ?? "low",
        scope: overrides.scope ?? "Current note",
        sourceRefs: overrides.sourceRefs ?? [sourceRef],
        createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
        summary: overrides.summary ?? "Prefers concise weekly planning.",
    };
}

function makeRecord(overrides: Partial<ConfirmedMemoryRecord> = {}): ConfirmedMemoryRecord {
    const lifecycle = overrides.lifecycle ?? "active";
    return {
        id: overrides.id ?? "mem-1",
        type: overrides.type ?? "preference",
        lifecycle,
        sensitivity: overrides.sensitivity ?? "low",
        summary: overrides.summary ?? (lifecycle === "forgotten_tombstone" ? "" : "Prefers concise weekly planning."),
        sourceRefs: overrides.sourceRefs ?? (lifecycle === "forgotten_tombstone" ? [] : [sourceRef]),
        scope: overrides.scope ?? { kind: "current_note", paths: ["notes/current.md"], label: "Current note" },
        createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
        updatedAt: overrides.updatedAt ?? "2026-06-28T12:00:00.000Z",
        confirmedAt: overrides.confirmedAt,
        archivedAt: overrides.archivedAt,
        forgottenAt: overrides.forgottenAt,
        validFrom: overrides.validFrom,
        validUntil: overrides.validUntil,
        lastVerified: overrides.lastVerified,
        updatePolicy: overrides.updatePolicy,
        confirmationStrength: overrides.confirmationStrength,
        confirmationSource: overrides.confirmationSource,
        tombstoneReason: overrides.tombstoneReason,
        rawMemoryText: overrides.rawMemoryText,
    };
}

describe("Memory governance", () => {
    it("turns memory-candidate queue items into source-backed candidates only when typed", () => {
        expect(memoryCandidateFromQueueItem(makeQueueItem())).toMatchObject({
            ok: true,
            value: {
                id: "rq-memory",
                type: "preference",
                lifecycle: "candidate",
                sensitivity: "low",
                sourceRefs: [sourceRef],
            },
        });
        expect(memoryCandidateFromQueueItem(makeQueueItem({ metadata: { sensitivity: "low" } })))
            .toEqual({ ok: false, reason: "missing_memory_type" });
        expect(memoryCandidateFromQueueItem(makeQueueItem({
            metadata: { memoryType: "preference", sensitivity: "high" },
        }))).toEqual({ ok: false, reason: "high_sensitivity_candidate_blocked" });
    });

    it("does not create confirmed Memory until a candidate is explicitly confirmed", async () => {
        const store = new MemoryGovernanceStore({
            now: () => new Date("2026-06-28T12:00:00.000Z"),
            idFactory: () => "mem-1",
        });
        const candidate = makeCandidate();

        expect(store.list()).toEqual([]);

        const result = await store.confirmCandidate(candidate, {
            scope: { kind: "current_note", paths: ["notes/current.md"], label: "Current note" },
            confirmationSource: "pagelet",
        });

        expect(result).toMatchObject({
            ok: true,
            value: {
                id: "mem-1",
                lifecycle: "active",
                summary: "Prefers concise weekly planning.",
                confirmationStrength: "light",
            },
        });
        expect(store.list()).toHaveLength(1);
    });

    it("archives Memory without deleting its evidence and Context Firewall drops archived records", async () => {
        const store = new MemoryGovernanceStore({
            records: [makeRecord()],
            now: () => new Date("2026-06-28T12:30:00.000Z"),
        });

        const archived = await store.archive("mem-1");

        expect(archived).toMatchObject({
            ok: true,
            value: {
                lifecycle: "archived",
                summary: "Prefers concise weekly planning.",
                sourceRefs: [sourceRef],
            },
        });
        if (!archived.ok) return;
        expect(decideContextFirewall(archived.value)).toEqual({
            decision: "drop",
            reason: "archived",
            memoryId: "mem-1",
        });
    });

    it("forgets Memory by keeping only a text-free tombstone", async () => {
        const store = new MemoryGovernanceStore({
            records: [makeRecord()],
            now: () => new Date("2026-06-28T12:30:00.000Z"),
        });

        const forgotten = await store.forget("mem-1");

        expect(forgotten).toMatchObject({
            ok: true,
            value: {
                lifecycle: "forgotten_tombstone",
                summary: "",
                sourceRefs: [],
                tombstoneReason: "user_forget",
            },
        });
        if (!forgotten.ok) return;
        expect(JSON.stringify(forgotten.value)).not.toContain("Prefers concise weekly planning");
        expect(decideContextFirewall(forgotten.value)).toEqual({
            decision: "drop",
            reason: "forgotten",
            memoryId: "mem-1",
        });
        expect(validateConfirmedMemoryRecord(makeRecord({
            lifecycle: "forgotten_tombstone",
            summary: "",
            sourceRefs: [],
            rawMemoryText: "leaked text",
        }))).toEqual({ ok: false, reason: "raw_memory_text_not_allowed" });
    });

    it("rejects confirmed records that would persist raw source or provider text", () => {
        const record = makeRecord({
            sourceRefs: [{
                path: "notes/current.md",
                excerpt: "raw note text",
                providerOutput: "raw provider text",
            } as never],
        });

        expect(validateConfirmedMemoryRecord(record)).toEqual({
            ok: false,
            reason: "forbidden_persisted_text",
        });
        const store = new MemoryGovernanceStore({ records: [record] });
        expect(store.list()).toEqual([]);
    });

    it("requires explicit export confirmation and leaves lifecycle unchanged", () => {
        const store = new MemoryGovernanceStore({ records: [makeRecord()] });

        expect(store.exportMarkdown("mem-1", false)).toEqual({
            ok: false,
            reason: "confirmation_required",
        });
        const exported = store.exportMarkdown("mem-1", true);

        expect(exported).toMatchObject({ ok: true });
        if (!exported.ok) return;
        expect(exported.value).toContain("Prefers concise weekly planning.");
        expect(store.list()[0].lifecycle).toBe("active");
    });

    it("applies Context Firewall decisions for scope, sensitivity, stale, and constraints", () => {
        expect(decideContextFirewall(makeRecord(), { scopePaths: ["notes/current.md"] })).toEqual({
            decision: "auto_include",
            reason: "in_scope_low_risk",
            memoryId: "mem-1",
        });
        expect(decideContextFirewall(makeRecord({ lifecycle: "stale" }), { scopePaths: ["notes/current.md"] }))
            .toMatchObject({ decision: "ask_user", reason: "stale" });
        expect(decideContextFirewall(makeRecord({ sensitivity: "medium" }), { scopePaths: ["notes/current.md"] }))
            .toMatchObject({ decision: "ask_user", reason: "medium_sensitivity" });
        expect(decideContextFirewall(makeRecord({ sensitivity: "high" }), { scopePaths: ["notes/current.md"] }))
            .toMatchObject({ decision: "drop", reason: "high_sensitivity" });
        expect(decideContextFirewall(makeRecord({
            scope: { kind: "current_note", paths: ["notes/other.md"] },
        }), { scopePaths: ["notes/current.md"] })).toMatchObject({
            decision: "drop",
            reason: "scope_mismatch",
        });
        expect(decideContextFirewall(makeRecord({
            type: "task_constraint",
            confirmationStrength: "explicit",
            updatePolicy: "ask-before-cross-scope-use",
        }), { scopePaths: ["notes/current.md"] })).toMatchObject({
            decision: "ask_user",
            reason: "task_constraint",
        });
    });
});

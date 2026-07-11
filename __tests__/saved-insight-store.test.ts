import { describe, expect, it, jest } from "@jest/globals";

import {
    SavedInsightStore,
    normalizeSavedInsightState,
    type PersistedSourceRef,
} from "../src/pa";

const sourceRef: PersistedSourceRef = {
    path: "notes/current.md",
    excerptHash: "abc123",
    whyShown: ["Recurring theme"],
    evidenceStrength: "medium",
};

describe("SavedInsightStore", () => {
    it("requires source refs for PA-generated insights", async () => {
        const store = new SavedInsightStore({
            now: () => new Date("2026-06-28T12:00:00.000Z"),
            idFactory: () => "ins-1",
        });

        const result = await store.create({
            type: "theme",
            text: "Pricing notes keep coming back.",
            origin: "pa-generated",
            sourceRefs: [],
        });

        expect(result).toEqual({ ok: false, reason: "missing_source_refs" });
        expect(store.list()).toEqual([]);
    });

    it("allows user-authored unsourced insights as weak recall assets", async () => {
        const persist = jest.fn((_state: unknown) => undefined);
        const store = new SavedInsightStore({
            now: () => new Date("2026-06-28T12:00:00.000Z"),
            idFactory: () => "ins-user",
            persist,
        });

        const result = await store.create({
            type: "question",
            text: "Why does pricing keep blocking launch planning?",
            origin: "user-authored",
            whyShown: ["Typed by user"],
            scope: { kind: "custom", label: "Manual insight" },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toMatchObject({
            id: "ins-user",
            sourceRefs: [],
            influencePolicy: "weak-only",
            status: "active",
        });
        expect(persist).toHaveBeenCalledWith(expect.objectContaining({
            items: [expect.objectContaining({ id: "ins-user" })],
        }));
    });

    it("filters by type, status, and source scope", async () => {
        const store = new SavedInsightStore({
            now: () => new Date("2026-06-28T12:00:00.000Z"),
            idFactory: (() => {
                let next = 0;
                return () => `ins-${++next}`;
            })(),
        });

        await store.create({
            type: "theme",
            text: "Pricing notes keep coming back.",
            origin: "pa-generated",
            sourceRefs: [sourceRef],
            scope: { kind: "current_note", paths: ["notes/current.md"] },
        });
        await store.create({
            type: "decision",
            text: "Launch work waits for provider smoke.",
            origin: "pa-generated",
            sourceRefs: [{ ...sourceRef, path: "notes/launch.md" }],
            scope: { kind: "current_note", paths: ["notes/launch.md"] },
        });
        await store.archive("ins-2");

        expect(store.list({ types: ["theme"] }).map((item) => item.id)).toEqual(["ins-1"]);
        expect(store.list({ statuses: ["archived"] }).map((item) => item.id)).toEqual(["ins-2"]);
        expect(store.list({ scopePaths: ["notes/current.md"] }).map((item) => item.id)).toEqual(["ins-1"]);
    });

    it("archives, restores, and promotes insights without changing source evidence", async () => {
        const store = new SavedInsightStore({
            now: () => new Date("2026-06-28T12:00:00.000Z"),
            idFactory: () => "ins-1",
        });
        await store.create({
            type: "theme",
            text: "Pricing notes keep coming back.",
            origin: "pa-generated",
            sourceRefs: [sourceRef],
        });

        const archived = await store.archive("ins-1");
        expect(archived).toMatchObject({ ok: true, value: { status: "archived" } });
        const restored = await store.restore("ins-1");
        expect(restored).toMatchObject({ ok: true, value: { status: "active" } });
        const promoted = await store.promote("ins-1", "mem-1");
        expect(promoted).toMatchObject({
            ok: true,
            value: {
                status: "promoted",
                promotedTo: "mem-1",
                sourceRefs: [sourceRef],
                influencePolicy: "weak-only",
            },
        });
    });

    it("drops malformed persisted insights without losing valid siblings", () => {
        const valid = {
            id: "valid",
            type: "theme",
            text: "Pricing notes keep coming back.",
            origin: "pa-generated",
            sourceRefs: [sourceRef],
            whyShown: ["Recurring theme"],
            scope: { kind: "current_note", paths: ["notes/current.md"] },
            status: "active",
            influencePolicy: "weak-only",
            createdAt: "2026-06-28T12:00:00.000Z",
            updatedAt: "2026-06-28T12:00:00.000Z",
        };
        const normalized = normalizeSavedInsightState({
            items: [
                valid,
                { ...valid, id: "missing-text", text: undefined },
                { ...valid, id: "null-source", sourceRefs: [null] },
                { ...valid, id: "bad-scope", scope: { kind: "current_note", paths: 42 } },
                { ...valid, id: "forbidden-text", fullProviderOutput: "secret provider output" },
            ],
        });

        expect(normalized.items.map((item) => item.id)).toEqual(["valid"]);
        expect(normalized.items[0]).toMatchObject({
            text: valid.text,
            sourceRefs: valid.sourceRefs,
            scope: valid.scope,
        });
    });

    it("does not expose failed creates or status updates and retries once", async () => {
        let rejectPersist = true;
        let nextId = 0;
        const store = new SavedInsightStore({
            idFactory: () => `ins-${++nextId}`,
            persist: async () => {
                if (rejectPersist) throw new Error("disk unavailable");
            },
        });
        const input = {
            type: "question" as const,
            text: "Why does pricing keep blocking launch planning?",
            origin: "user-authored" as const,
            scope: { kind: "custom" as const, label: "Manual insight" },
        };

        await expect(store.create(input)).rejects.toThrow("disk unavailable");
        expect(store.snapshot()).toEqual({ items: [] });

        rejectPersist = false;
        const created = await store.create(input);
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        expect(store.list()).toHaveLength(1);
        const beforeArchive = store.snapshot();

        rejectPersist = true;
        await expect(store.archive(created.value.id)).rejects.toThrow("disk unavailable");
        expect(store.snapshot()).toEqual(beforeArchive);
        expect(store.list()[0].status).toBe("active");
    });
});

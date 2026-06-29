import { describe, expect, it, jest } from "@jest/globals";

import {
    ReviewQueueStore,
    applyGraphDiscoveryFeedback,
    discoverLightweightGraphItems,
    graphDiscoveryItemToReviewQueueInput,
    hasForbiddenPersistedTextFields,
    type GraphDiscoveryNote,
    type ReviewQueueItem,
    type ReviewQueueResult,
    type ReviewQueueStatus,
} from "../src/pa";

function fixtureNotes(): GraphDiscoveryNote[] {
    return [
        {
            path: "Projects/PA/Alpha.md",
            title: "Alpha",
            content: "status: active\nDecision: ship local graph review first.",
            tags: ["pa", "memory"],
            links: ["Projects/PA/Beta.md"],
        },
        {
            path: "Projects/PA/Beta.md",
            title: "Beta",
            content: "status: paused\nDecision: defer full graph visualization.",
            tags: ["pa", "memory"],
            backlinks: ["Projects/PA/Alpha.md"],
        },
        {
            path: "Projects/PA/Gamma.md",
            title: "Gamma",
            content: "status: active\nConstraint: review before writing.",
            tags: ["pa", "review"],
        },
        {
            path: "Projects/PA/Delta.md",
            title: "Delta",
            content: "preference: source backed claims",
            tags: ["pa", "review"],
        },
    ];
}

describe("Lightweight graph discovery", () => {
    it("produces source-backed reviewable graph item types without a graph visualization payload", () => {
        const result = discoverLightweightGraphItems(fixtureNotes(), {
            now: new Date("2026-06-29T12:00:00.000Z"),
        });

        expect(result.items.map((item) => item.type)).toEqual(expect.arrayContaining([
            "related_note",
            "theme_chain",
            "conflict_pair",
            "index_note_candidate",
        ]));
        expect(result.totalCount).toBe(result.items.length);
        for (const item of result.items) {
            expect(item.sourceRefs.length).toBeGreaterThan(0);
            expect(item.edgeState).toBeTruthy();
            expect(item.outcomeStatus).toBeTruthy();
            expect(item.metadata.edgeState).toBe(item.edgeState);
            expect(item.metadata.outcomeStatus).toBe(item.outcomeStatus);
            expect(hasForbiddenPersistedTextFields(item)).toBe(false);
            expect(item).not.toHaveProperty("nodes");
            expect(item).not.toHaveProperty("edges");
        }

        const themeChain = result.items.find((item) => item.type === "theme_chain");
        expect(themeChain?.metadata.admittedToMemory).toBe(false);
        const indexCandidate = result.items.find((item) => item.type === "index_note_candidate");
        expect(indexCandidate?.metadata.createsNoteByDefault).toBe(false);
    });

    it("keeps Data Boundary denied notes out of graph items", () => {
        const result = discoverLightweightGraphItems([
            ...fixtureNotes(),
            {
                path: "Private/Secret.md",
                title: "Secret",
                content: "status: active",
                tags: ["pa"],
            },
        ], {
            now: new Date("2026-06-29T12:00:00.000Z"),
            isPathAllowed: (path) => !path.startsWith("Private/"),
        });

        expect(result.skippedSourceCount).toBe(1);
        expect(JSON.stringify(result.items)).not.toContain("Private/Secret.md");
    });

    it("maps later-layer graph items into active Review Queue producers", async () => {
        const result = discoverLightweightGraphItems(fixtureNotes(), {
            now: new Date("2026-06-29T12:00:00.000Z"),
        });
        const store = new ReviewQueueStore({
            now: () => new Date("2026-06-29T12:00:00.000Z"),
            idFactory: () => "rq-graph",
        });

        for (const type of ["related_note", "theme_chain", "conflict_pair", "index_note_candidate"] as const) {
            const item = result.items.find((candidate) => candidate.type === type);
            expect(item).toBeTruthy();
            const created = await store.create(graphDiscoveryItemToReviewQueueInput(item!, {
                admissionReason: type === "conflict_pair"
                    ? "conflict_resolution_required"
                    : "user_kept_for_later",
            }));
            expect(created.ok).toBe(true);
            if (created.ok) {
                expect(created.value.type).toBe(type);
                expect(created.value.sourceRefs.length).toBeGreaterThan(0);
                expect(created.value.metadata?.edgeState).toBeTruthy();
            }
        }
    });

    it("keeps dismissed or rejected edges local and non-writing", async () => {
        const [item] = discoverLightweightGraphItems(fixtureNotes(), {
            now: new Date("2026-06-29T12:00:00.000Z"),
        }).items;
        const updateReviewQueueStatus = jest.fn<(
            id: string,
            status: ReviewQueueStatus,
        ) => Promise<ReviewQueueResult<ReviewQueueItem>>>(async () => ({
            ok: false,
            reason: "not_persisted_in_test",
        }));
        const writeVaultNote = jest.fn<() => void>(() => undefined);
        const createMemory = jest.fn<() => void>(() => undefined);
        const createSavedInsight = jest.fn<() => void>(() => undefined);
        const sendTelemetry = jest.fn<() => void>(() => undefined);

        const record = await applyGraphDiscoveryFeedback(item, "reject", {
            updateReviewQueueStatus,
            writeVaultNote,
            createMemory,
            createSavedInsight,
            sendTelemetry,
        }, {
            now: new Date("2026-06-29T12:05:00.000Z"),
        });

        expect(record).toMatchObject({
            itemId: item.id,
            status: "dismissed",
            edgeState: "rejected",
            localOnly: true,
            writes: {
                vault: false,
                memory: false,
                savedInsight: false,
                telemetry: false,
            },
        });
        expect(updateReviewQueueStatus).toHaveBeenCalledWith(item.id, "dismissed");
        expect(writeVaultNote).not.toHaveBeenCalled();
        expect(createMemory).not.toHaveBeenCalled();
        expect(createSavedInsight).not.toHaveBeenCalled();
        expect(sendTelemetry).not.toHaveBeenCalled();
    });
});

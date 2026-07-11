import { describe, expect, it } from "@jest/globals";

import type { UserProfileSnapshot } from "../src/ai-services/memory-extraction";
import {
    buildMemoryControlCenterSnapshot,
    type MemoryControlCenterInput,
} from "../src/pa/memory-control-center";
import type { ConfirmedMemoryRecord, PersistedSourceRef } from "../src/pa";
import type { VaultMetacognitionSnapshot } from "../src/ai-services/memory-extraction";

const NOW = new Date("2026-07-10T08:00:00.000Z");

function makeInput(overrides: Partial<MemoryControlCenterInput> = {}): MemoryControlCenterInput {
    return {
        now: NOW,
        noteMemory: {
            enabled: true,
            status: "unknown",
        },
        vaultInsights: {
            enabled: true,
            storageState: "not_loaded",
            currentDataBoundaryFingerprint: "boundary-current",
            snapshot: null,
        },
        profile: {
            featureEnabled: true,
            storageState: "loading",
            snapshot: null,
        },
        confirmedRecords: [],
        boundary: {
            vaultScopeLabel: "Current vault",
            deviceLocalProven: false,
            explanationKey: "memory.boundary.current",
        },
        capabilities: {
            correct: false,
            undoRecentChange: false,
            pauseUse: false,
            resumeUse: false,
            forget: false,
        },
        ...overrides,
    };
}

function makeVaultInsightsSnapshot(overrides: Partial<VaultMetacognitionSnapshot> = {}): VaultMetacognitionSnapshot {
    return {
        generatedAt: "2026-07-09T08:00:00.000Z",
        fileCount: 3,
        folderThemes: [{ folder: "Projects", count: 2 }],
        tagTaxonomy: [{ tag: "memory", count: 2 }],
        linkTopology: {
            hubNotes: [{ path: "Projects/PA.md", inbound: 2, outbound: 1 }],
            unresolvedLinks: [],
        },
        writingHabits: {
            busiestWeekdays: [{ weekday: "Thursday", count: 2 }],
            averageWords: 240,
            recentlyActive: ["Projects/PA.md"],
        },
        topicClusters: [{ label: "PA", paths: ["Projects/PA.md"] }],
        knowledgeGaps: [],
        trends: [{ label: "Memory", count: 2 }],
        ...overrides,
    };
}

function makeProfileSnapshot(overrides: Partial<UserProfileSnapshot> = {}): UserProfileSnapshot {
    return {
        updatedAt: "2026-07-09T09:00:00.000Z",
        records: [
            {
                key: "concise",
                text: "Keep answers concise.",
                kind: "user_explicit",
                confidence: "high",
                conversationId: "conversation-a",
                observedAt: "2026-07-08T09:00:00.000Z",
                occurrences: 2,
                conversationIds: ["conversation-a", "conversation-b"],
                confirmed: true,
            },
            {
                key: "citations",
                text: "Use evidence-backed citations.",
                kind: "user_correction",
                confidence: "high",
                conversationId: "conversation-c",
                observedAt: "2026-07-09T09:00:00.000Z",
                occurrences: 1,
                conversationIds: ["conversation-c"],
                confirmed: true,
            },
        ],
        markdown: "# User Profile\n\n- Keep answers concise.\n- Use evidence-backed citations.",
        ...overrides,
    };
}

function makeConfirmedRecord(
    id: string,
    lifecycle: ConfirmedMemoryRecord["lifecycle"],
    overrides: Partial<ConfirmedMemoryRecord> = {},
): ConfirmedMemoryRecord {
    const isForgotten = lifecycle === "forgotten_tombstone";
    return {
        id,
        type: "preference",
        lifecycle,
        sensitivity: "low",
        sourceRefs: isForgotten ? [] : [{
            path: `Notes/${id}.md`,
            whyShown: ["Explicit evidence"],
            evidenceStrength: "strong",
        }],
        summary: isForgotten ? "" : `Summary for ${id}`,
        scope: {
            kind: "current_note",
            paths: [`Notes/${id}.md`],
        },
        createdAt: "2026-07-01T08:00:00.000Z",
        updatedAt: "2026-07-09T08:00:00.000Z",
        confirmationStrength: "explicit",
        ...overrides,
    };
}

describe("buildMemoryControlCenterSnapshot", () => {
    it("preserves truthful unknown/loading states without inventing source items", () => {
        const snapshot = buildMemoryControlCenterSnapshot(makeInput());

        expect(snapshot).toEqual({
            generatedAt: NOW.toISOString(),
            noteMemory: {
                enabled: true,
                status: "unknown",
            },
            vaultInsights: {
                enabled: true,
                status: "not_loaded",
            },
            profile: {
                enabled: true,
                status: "loading",
                itemCount: 0,
            },
            durable: {
                activeCount: 0,
                pausedCount: 0,
                staleCount: 0,
            },
            boundary: {
                vaultScoped: true,
                deviceLocalProven: false,
                explanationKey: "memory.boundary.current",
            },
            items: [],
            degradedSources: [],
        });
    });

    it("projects a ready Type-C aggregate with representative evidence", () => {
        const sourceRef: PersistedSourceRef = {
            path: "Projects/PA.md",
            whyShown: ["Representative note"],
            evidenceStrength: "medium",
        };
        const input = makeInput({
            vaultInsights: {
                enabled: true,
                storageState: "ready",
                currentDataBoundaryFingerprint: "boundary-current",
                snapshot: {
                    snapshot: makeVaultInsightsSnapshot(),
                    dataBoundaryFingerprint: "boundary-current",
                    representativeSourceRefs: [sourceRef],
                },
            },
        });

        const snapshot = buildMemoryControlCenterSnapshot(input);
        const item = snapshot.items.find((candidate) => candidate.origin === "vault_insights");

        expect(snapshot.vaultInsights).toEqual({
            enabled: true,
            status: "ready",
            generatedAt: "2026-07-09T08:00:00.000Z",
            fileCount: 3,
        });
        expect(item).toMatchObject({
            id: "vault-insights",
            label: "Understanding from your notes",
            authority: "pa_inference",
            scopeLabel: "Current vault",
            effect: "future_answers",
            lifecycle: "derived",
            observedAt: "2026-07-09T08:00:00.000Z",
            updatedAt: "2026-07-09T08:00:00.000Z",
            supportedActions: [],
        });
        expect(item?.label).not.toMatch(/type-c|vss|rag|embedding/i);
        expect(item?.provenance).toEqual([{
            kind: "vault_aggregate",
            generatedAt: "2026-07-09T08:00:00.000Z",
            dataBoundaryFingerprint: "boundary-current",
            includedFileCount: 3,
            coverage: "representative",
            representativeSourceRefs: [sourceRef],
        }]);
    });

    it("hides Type-C items when the current Data Boundary invalidates the loaded snapshot", () => {
        const input = makeInput({
            vaultInsights: {
                enabled: true,
                storageState: "ready",
                currentDataBoundaryFingerprint: "boundary-new",
                snapshot: {
                    snapshot: makeVaultInsightsSnapshot(),
                    dataBoundaryFingerprint: "boundary-old",
                    representativeSourceRefs: [{ path: "Projects/PA.md" }],
                },
            },
        });

        const snapshot = buildMemoryControlCenterSnapshot(input);

        expect(snapshot.vaultInsights).toEqual({
            enabled: true,
            status: "stale_boundary",
        });
        expect(snapshot.items).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ origin: "vault_insights" }),
        ]));
        expect(snapshot.degradedSources).toContainEqual({
            source: "vault_insights",
            code: "data_boundary_changed",
        });
    });

    it("projects Type-A records with conversation provenance and current prompt effect", () => {
        const input = makeInput({
            profile: {
                featureEnabled: true,
                storageState: "ready",
                snapshot: makeProfileSnapshot(),
            },
        });

        const snapshot = buildMemoryControlCenterSnapshot(input);
        const concise = snapshot.items.find((item) => item.id === "user-profile:concise");
        const citations = snapshot.items.find((item) => item.id === "user-profile:citations");

        expect(snapshot.profile).toEqual({
            enabled: true,
            status: "ready",
            updatedAt: "2026-07-09T09:00:00.000Z",
            itemCount: 2,
        });
        expect(concise).toMatchObject({
            label: "Keep answers concise.",
            origin: "user_profile",
            authority: "explicit_user",
            scopeLabel: "Current vault",
            effect: "future_answers",
            lifecycle: "derived",
            observedAt: "2026-07-08T09:00:00.000Z",
            updatedAt: "2026-07-09T09:00:00.000Z",
            supportedActions: [],
        });
        expect(concise?.provenance).toEqual([
            {
                kind: "conversation",
                conversationId: "conversation-a",
                observedAt: "2026-07-08T09:00:00.000Z",
            },
            {
                kind: "conversation",
                conversationId: "conversation-b",
                observedAt: "2026-07-08T09:00:00.000Z",
            },
        ]);
        expect(citations?.authority).toBe("user_correction");
    });

    it("keeps retained Type-A records inspectable but marks them unused when extraction is disabled", () => {
        const snapshot = buildMemoryControlCenterSnapshot(makeInput({
            profile: {
                featureEnabled: false,
                storageState: "ready",
                snapshot: makeProfileSnapshot(),
            },
        }));

        expect(snapshot.profile).toEqual({
            enabled: false,
            status: "disabled",
            updatedAt: "2026-07-09T09:00:00.000Z",
            itemCount: 2,
        });
        expect(snapshot.items.filter((item) => item.origin === "user_profile"))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ effect: "stored_not_in_use" }),
            ]));
    });

    it.each(["unknown", "blocked", "unavailable"] as const)(
        "keeps the Profile %s state distinct from empty",
        (storageState) => {
            const snapshot = buildMemoryControlCenterSnapshot(makeInput({
                profile: {
                    featureEnabled: true,
                    storageState,
                    snapshot: null,
                },
            }));

            expect(snapshot.profile.status).toBe(storageState);
            expect(snapshot.profile.itemCount).toBe(0);
            expect(snapshot.degradedSources).toContainEqual({
                source: "user_profile",
                code: `profile_${storageState}`,
            });
        },
    );

    it("maps legacy Confirmed Memory lifecycles without pretending the records affect prompts", () => {
        const records: ConfirmedMemoryRecord[] = [
            makeConfirmedRecord("active", "active", { summary: "Use short responses." }),
            makeConfirmedRecord("archived", "archived"),
            makeConfirmedRecord("stale", "stale"),
            makeConfirmedRecord("exported", "exported"),
            makeConfirmedRecord("forgotten", "forgotten_tombstone", {
                forgottenAt: "2026-07-09T08:00:00.000Z",
            }),
            makeConfirmedRecord("candidate", "candidate"),
            {
                ...makeConfirmedRecord("malformed", "active"),
                summary: 42,
            } as unknown as ConfirmedMemoryRecord,
        ];
        const input = makeInput({ confirmedRecords: records });

        const snapshot = buildMemoryControlCenterSnapshot(input);
        const confirmedItems = snapshot.items.filter((item) => item.origin === "confirmed_memory");

        expect(snapshot.durable).toEqual({
            activeCount: 1,
            pausedCount: 0,
            staleCount: 1,
        });
        expect(confirmedItems).toHaveLength(5);
        expect(confirmedItems).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "confirmed:candidate" }),
            expect.objectContaining({ id: "confirmed:malformed" }),
        ]));
        expect(confirmedItems).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: "confirmed:active",
                claimId: "active",
                label: "Use short responses.",
                lifecycle: "active",
                effect: "stored_not_in_use",
                supportedActions: [],
            }),
            expect.objectContaining({ id: "confirmed:archived", lifecycle: "archived" }),
            expect.objectContaining({ id: "confirmed:stale", lifecycle: "stale" }),
            expect.objectContaining({ id: "confirmed:exported", lifecycle: "exported" }),
            expect.objectContaining({
                id: "confirmed:forgotten",
                claimId: "forgotten",
                label: "Forgotten item",
                lifecycle: "forgotten_marker",
                scopeLabel: "",
                effect: "none",
                provenance: [],
            }),
        ]));
        expect(confirmedItems.some((item) => /preference|task_constraint/.test(item.label))).toBe(false);
        expect(snapshot.degradedSources).toContainEqual({
            source: "confirmed_memory",
            code: "malformed_confirmed_record",
        });
    });

    it("keeps valid siblings when individual Profile records are malformed", () => {
        const profile = makeProfileSnapshot();
        profile.records.splice(1, 0, {
            ...profile.records[0],
            key: "",
            text: "",
        });

        const snapshot = buildMemoryControlCenterSnapshot(makeInput({
            profile: {
                featureEnabled: true,
                storageState: "ready",
                snapshot: profile,
            },
        }));

        expect(snapshot.profile).toMatchObject({ status: "ready", itemCount: 2 });
        expect(snapshot.items.filter((item) => item.origin === "user_profile")).toHaveLength(2);
        expect(snapshot.degradedSources).toContainEqual({
            source: "user_profile",
            code: "malformed_profile_record",
        });
    });

    it("returns deterministic clone-safe snapshots without mutating source objects", () => {
        const profile = makeProfileSnapshot();
        const confirmed = makeConfirmedRecord("clone", "active");
        const representativeRef: PersistedSourceRef = {
            path: "Projects/PA.md",
            whyShown: ["Representative note"],
        };
        const input = makeInput({
            vaultInsights: {
                enabled: true,
                storageState: "ready",
                currentDataBoundaryFingerprint: "boundary-current",
                snapshot: {
                    snapshot: makeVaultInsightsSnapshot({ fileCount: 1 }),
                    dataBoundaryFingerprint: "boundary-current",
                    representativeSourceRefs: [representativeRef],
                },
            },
            profile: {
                featureEnabled: true,
                storageState: "ready",
                snapshot: profile,
            },
            confirmedRecords: [confirmed],
            sourceErrors: [{ source: "note_memory", code: "cached_warning" }],
        });
        const before = JSON.parse(JSON.stringify(input)) as unknown;

        const first = buildMemoryControlCenterSnapshot(input);
        const second = buildMemoryControlCenterSnapshot(input);

        expect(second).toEqual(first);
        expect(JSON.parse(JSON.stringify(input))).toEqual(before);

        const aggregate = first.items
            .find((item) => item.origin === "vault_insights")
            ?.provenance.find((entry) => entry.kind === "vault_aggregate");
        if (aggregate?.kind !== "vault_aggregate") throw new Error("Expected aggregate provenance");
        aggregate.representativeSourceRefs[0].whyShown?.push("Changed output");

        const confirmedProvenance = first.items
            .find((item) => item.id === "confirmed:clone")
            ?.provenance.find((entry) => entry.kind === "note");
        if (confirmedProvenance?.kind !== "note") throw new Error("Expected note provenance");
        confirmedProvenance.sourceRef.path = "Changed.md";

        expect(representativeRef).toEqual({
            path: "Projects/PA.md",
            whyShown: ["Representative note"],
        });
        expect(confirmed.sourceRefs[0].path).toBe("Notes/clone.md");
        expect(second.items.find((item) => item.id === "confirmed:clone")?.provenance)
            .toEqual([expect.objectContaining({
                kind: "note",
                sourceRef: expect.objectContaining({ path: "Notes/clone.md" }),
            })]);
    });
});

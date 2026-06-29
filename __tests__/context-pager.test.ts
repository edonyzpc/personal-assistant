import { describe, expect, it } from "@jest/globals";

import {
    createContextPagerStateFromChatContextUsed,
    createContextPagerStateFromRetrievalOutcome,
    hasForbiddenPersistedTextFields,
    type RetrievalOutcome,
} from "../src/pa";

describe("Context Pager", () => {
    it("builds a read-only pager state from retrieval outcomes without raw excerpts", () => {
        const outcome: RetrievalOutcome = {
            id: "retrieval-1",
            status: "partial_evidence",
            sources: [{
                path: "notes/current.md",
                excerptHash: "abc123",
                whyShown: ["Matched by content"],
            }],
            skippedSources: [{
                path: "private/secret.md",
                excerptHash: "def456",
                skippedReason: "data_boundary",
                boundaryReason: "denied_by_data_boundary",
                privateTitle: "Excluded note",
            }],
            missingScopeHints: ["older notes outside scope"],
        };

        const state = createContextPagerStateFromRetrievalOutcome(outcome, { runId: "run-1" });

        expect(state.summary).toMatchObject({
            usedSourceCount: 1,
            skippedSourceCount: 1,
            usedMemoryCount: 0,
            skippedScopeCount: 1,
        });
        expect(state.usedSources[0]).toMatchObject({ path: "notes/current.md" });
        expect(state.skippedSources[0]).toMatchObject({
            path: "private/secret.md",
            reason: "privacy excluded",
        });
        expect(state.persistedTrace.usedSourceRefs[0]).toMatchObject({
            path: "notes/current.md",
            excerptHash: "abc123",
        });
        expect(JSON.stringify(state.persistedTrace)).not.toContain("raw prompt");
        expect(hasForbiddenPersistedTextFields(state.persistedTrace)).toBe(false);
    });

    it("builds chat context traces from existing context-used metadata", () => {
        const state = createContextPagerStateFromChatContextUsed("chat-run", [
            {
                category: "memory",
                label: "Selected Memory",
                detail: "1 selected note",
                sources: [{ path: "memory/profile.md" }],
            },
            {
                category: "current-note",
                label: "Current note",
                sources: [{ path: "notes/current.md" }],
            },
            {
                category: "tool-unavailable",
                label: "Search unavailable",
                detail: "Tool unavailable",
                statusOnly: true,
            },
        ]);

        expect(state.summary).toMatchObject({
            usedSourceCount: 1,
            usedMemoryCount: 1,
            skippedScopeCount: 1,
        });
        expect(state.persistedTrace.usedSourceRefs.map((ref) => ref.path)).toEqual(["notes/current.md"]);
        expect(state.persistedTrace.usedMemoryRefs.map((ref) => ref.id)).toEqual(["memory/profile.md"]);
    });
});

import { describe, expect, it } from "@jest/globals";

import {
    createContextPagerStateFromChatContextUsed,
    createContextPagerStateFromRetrievalOutcome,
    createContextPagerState,
    createContextTraceFromChatContextUsed,
    mergeContextReductionFromMetrics,
    hasForbiddenPersistedTextFields,
    type RetrievalOutcome,
} from "../src/pa";

describe("Context Pager", () => {
    it("keeps a body-free reduction receipt without inventing sources or skipped scopes", () => {
        const trace = createContextTraceFromChatContextUsed("history-only", []);
        trace.reduction = {
            historyCompressed: true,
            toolContextReduced: false,
            budgetLimited: false,
            text: "private conversation body",
        } as NonNullable<typeof trace.reduction>;
        const state = createContextPagerState(trace);

        expect(state.reduction).toEqual({ historyCompressed: true, toolContextReduced: false, budgetLimited: false });
        expect(state.persistedTrace.reduction).toEqual(state.reduction);
        expect(state.reduction).not.toBe(state.persistedTrace.reduction);
        expect(Object.values(state.summary)).toEqual([0, 0, 0, 0, 0]);
        expect(hasForbiddenPersistedTextFields(state.persistedTrace)).toBe(false);
        expect(JSON.stringify(state.persistedTrace)).not.toContain("private conversation body");
    });

    it("ORs admitted invocation outcomes and ignores rejected or preview projections", () => {
        const first = mergeContextReductionFromMetrics(undefined, [
            { type: "context_projection", outcome: { admission: "fit", historyCompressed: true } },
            { type: "context_projection", outcome: { admission: "local_overflow", budgetLimited: true } },
            { type: "model_input_metrics", outcome: { admission: "fit", budgetLimited: true } },
        ]);
        expect(first).toEqual({ historyCompressed: true, toolContextReduced: false, budgetLimited: false });
        const metrics = [{
            type: "context_projection",
            outcome: { admission: "fit", toolResultsCompacted: 2, toolResultsHardTruncated: 1, budgetLimited: true },
        }];
        const next = mergeContextReductionFromMetrics(first, metrics);
        expect(next).toEqual({ historyCompressed: true, toolContextReduced: true, budgetLimited: true });
        expect(mergeContextReductionFromMetrics(next, metrics)).toEqual(next);
        expect(first?.budgetLimited).toBe(false);
    });

    it("keeps old traces and malformed or unchanged metrics quiet", () => {
        expect(createContextPagerStateFromChatContextUsed("old", []).persistedTrace).not.toHaveProperty("reduction");
        expect(mergeContextReductionFromMetrics(undefined, [
            null,
            { type: "context_projection", outcome: { admission: "fit", historyCompressed: "true", toolResultsCompacted: -1 } },
            { type: "context_projection", outcome: { admission: "fit", toolResultsHardTruncated: Infinity } },
            { type: "context_projection", outcome: { admission: "local_overflow", budgetLimited: true } },
        ])).toBeUndefined();
    });

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
        const withReduction = createContextPagerState({
            ...createContextTraceFromChatContextUsed("chat-run", [
                { category: "memory", label: "Selected Memory", sources: [{ path: "memory/profile.md" }] },
                { category: "current-note", label: "Current note", sources: [{ path: "notes/current.md" }] },
                { category: "tool-unavailable", label: "Search unavailable", detail: "Tool unavailable", statusOnly: true },
            ]),
            reduction: { historyCompressed: true, toolContextReduced: true, budgetLimited: true },
        });
        expect(withReduction.summary).toEqual(state.summary);
        expect(withReduction.persistedTrace.usedSourceRefs).toEqual(state.persistedTrace.usedSourceRefs);
        expect(withReduction.persistedTrace.usedMemoryRefs).toEqual(state.persistedTrace.usedMemoryRefs);
    });
});

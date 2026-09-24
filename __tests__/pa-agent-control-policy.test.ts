/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import {
    createAgentControlSnapshot,
    createInitialAgentControlSnapshot,
    deriveContinuedAgentControlSnapshot,
    deriveAnswerReadyAgentControlSnapshot,
    deriveSameSourceFollowUpAgentControlSnapshot,
    toolConstraintsFromAgentControlSnapshot,
} from "../src/ai-services/pa-agent-control-policy";

describe("createAgentControlSnapshot", () => {
    it("returns a default snapshot with all fields populated", () => {
        const snapshot = createAgentControlSnapshot();
        expect(snapshot.exposureMode).toBe("semantic-first");
        expect(snapshot.sourceScope).toBe("none");
        expect(snapshot.budgetState.semanticRoundCount).toBe(0);
        expect(snapshot.diagnostics).toEqual([]);
    });

    it("deep-copies diagnostics metadata to prevent mutation leaking", () => {
        const meta = { key: "original" };
        const snapshot = createAgentControlSnapshot({
            diagnostics: [{ type: "test", message: "msg", metadata: meta }],
        });
        meta.key = "mutated";
        expect((snapshot.diagnostics[0].metadata as { key: string }).key).toBe("original");
    });
});

describe("createInitialAgentControlSnapshot", () => {
    it("intersects explicit tools with actual availability", () => {
        const snapshot = createInitialAgentControlSnapshot({
            constraints: {
                allowedToolNames: new Set(["query_notes", "webSearch"]),
            },
            availableSemanticToolNames: new Set([
                "search_memory",
                "query_notes",
                "read_note",
                "webSearch",
            ]),
            availableMetaToolNames: new Set([
                "load_skill",
                "get_writing_context",
                "resolve_chat_images",
            ]),
        });

        expect([...snapshot.allowedToolNames!].sort()).toEqual([
            "query_notes",
            "webSearch",
        ]);
    });

    it("lets explicit blocked tools win over every available capability", () => {
        const snapshot = createInitialAgentControlSnapshot({
            constraints: {
                allowedToolNames: new Set(["query_notes"]),
                blockedToolNames: new Set([
                    "load_skill",
                    "get_writing_context",
                    "resolve_chat_images",
                ]),
            },
            availableSemanticToolNames: new Set(["query_notes", "read_note", "webSearch"]),
            availableMetaToolNames: new Set([
                "load_skill",
                "get_writing_context",
                "resolve_chat_images",
            ]),
        });

        expect([...snapshot.allowedToolNames!]).toEqual(["query_notes"]);
        expect([...snapshot.blockedToolNames!].sort()).toEqual([
            "get_writing_context",
            "load_skill",
            "resolve_chat_images",
        ]);
    });
});

describe("deriveContinuedAgentControlSnapshot", () => {
    it("returns undefined when previous is undefined and no options provided", () => {
        const result = deriveContinuedAgentControlSnapshot(undefined, {});
        expect(result).toBeUndefined();
    });

    it("creates a fresh snapshot when previous is undefined but runtimeInstruction is set", () => {
        const result = deriveContinuedAgentControlSnapshot(undefined, {
            runtimeInstruction: "test instruction",
        });
        expect(result).toBeDefined();
        expect(result!.runtimeInstruction).toBe("test instruction");
        expect(result!.exposureMode).toBe("semantic-first");
    });

    it("transitions to final-only when toolMode is final_answer_only", () => {
        const base = createAgentControlSnapshot({ exposureMode: "semantic-first" });
        const result = deriveContinuedAgentControlSnapshot(base, {
            toolMode: "final_answer_only",
        });
        expect(result!.exposureMode).toBe("final-only");
        expect(result!.sourceScope).toBe("none");
    });

    it("preserves budget state from previous snapshot", () => {
        const base = createAgentControlSnapshot({
            budgetState: { semanticRoundCount: 3, followUpRoundCount: 1, realToolCallCount: 5, avoidedDuplicateCallCount: 0, wallClockExceeded: false },
        });
        const result = deriveContinuedAgentControlSnapshot(base, {});
        expect(result!.budgetState.semanticRoundCount).toBe(3);
        expect(result!.budgetState.realToolCallCount).toBe(5);
    });
});

describe("deriveAnswerReadyAgentControlSnapshot", () => {
    it("increments semanticRoundCount by 1", () => {
        const base = createAgentControlSnapshot({
            budgetState: { semanticRoundCount: 2, followUpRoundCount: 0, realToolCallCount: 0, avoidedDuplicateCallCount: 0, wallClockExceeded: false },
        });
        const result = deriveAnswerReadyAgentControlSnapshot(base, {
            runtimeInstruction: "answer now",
        });
        expect(result.budgetState.semanticRoundCount).toBe(3);
    });

    it("sets exposure mode to answer-ready", () => {
        const base = createAgentControlSnapshot({ exposureMode: "semantic-first" });
        const result = deriveAnswerReadyAgentControlSnapshot(base, {
            runtimeInstruction: "answer",
        });
        expect(result.exposureMode).toBe("answer-ready");
    });

    it("works when previous is undefined", () => {
        const result = deriveAnswerReadyAgentControlSnapshot(undefined, {
            runtimeInstruction: "answer",
        });
        expect(result.exposureMode).toBe("answer-ready");
        expect(result.budgetState.semanticRoundCount).toBe(1);
    });

    it("preserves an explicit final-only exposure as a final-answer constraint", () => {
        const base = createAgentControlSnapshot({
            exposureMode: "final-only",
            sourceScope: "notes",
            allowedToolNames: new Set(["search_vault_snippets"]),
            blockedToolNames: new Set(["webSearch"]),
        });

        const result = deriveAnswerReadyAgentControlSnapshot(base, {
            runtimeInstruction: "answer",
        });

        expect(result.exposureMode).toBe("final-only");
        expect(result.sourceScope).toBe("none");
        expect(result.toolMode).toBeUndefined();
        const constraints = toolConstraintsFromAgentControlSnapshot(result);
        expect([...constraints!.allowedToolNames!]).toEqual([]);
        expect(constraints!.blockedToolNames?.has("webSearch")).toBe(true);
    });

    it("preserves final_answer_only mode instead of reopening follow-up tools", () => {
        const base = createAgentControlSnapshot({
            sourceScope: "notes",
            allowedToolNames: new Set(["search_vault_snippets"]),
            toolMode: "final_answer_only",
        });

        const result = deriveAnswerReadyAgentControlSnapshot(base, {
            runtimeInstruction: "answer",
        });

        expect(result.exposureMode).toBe("final-only");
        expect(result.toolMode).toBe("final_answer_only");
        expect([...toolConstraintsFromAgentControlSnapshot(result)!.allowedToolNames!]).toEqual([]);
    });

    it("keeps a normal empty allowlist answer-ready rather than converting it to generic final-only", () => {
        const base = createAgentControlSnapshot({
            exposureMode: "answer-ready",
            sourceScope: "notes",
            allowedToolNames: new Set<string>(),
            toolMode: "normal",
        });

        const result = deriveAnswerReadyAgentControlSnapshot(base, {
            runtimeInstruction: "acknowledge",
        });

        expect(result.exposureMode).toBe("answer-ready");
        expect(result.toolMode).toBe("normal");
        expect([...result.allowedToolNames!]).toEqual([]);
    });
});

describe("deriveSameSourceFollowUpAgentControlSnapshot", () => {
    it("keeps an absent allowlist unconstrained for notes source scope", () => {
        const base = createAgentControlSnapshot();
        const result = deriveSameSourceFollowUpAgentControlSnapshot(base, {
            sourceScope: "notes",
            runtimeInstruction: "follow up",
        });
        expect(result.exposureMode).toBe("follow-up");
        expect(result.allowedToolNames).toBeUndefined();
    });

    it.each(["notes", "web"] as const)("keeps an explicit empty allowlist empty: %s", sourceScope => {
        const base = createAgentControlSnapshot({
            allowedToolNames: new Set<string>(),
        });
        const result = deriveSameSourceFollowUpAgentControlSnapshot(base, {
            sourceScope,
            runtimeInstruction: "follow up",
        });
        expect(result.allowedToolNames).toBeDefined();
        expect(result.allowedToolNames!.size).toBe(0);
    });

    it("increments followUpRoundCount", () => {
        const base = createAgentControlSnapshot();
        const result = deriveSameSourceFollowUpAgentControlSnapshot(base, {
            sourceScope: "notes",
            runtimeInstruction: "follow up",
        });
        expect(result.budgetState.followUpRoundCount).toBe(1);
    });

    it("keeps only allowed tools after blocked tools are removed", () => {
        const base = createAgentControlSnapshot({
            exposureMode: "source-scoped",
            sourceScope: "notes",
            allowedToolNames: new Set([
                "search_memory",
                "query_notes",
                "read_note",
                "read_note_outline",
            ]),
            blockedToolNames: new Set(["webSearch", "load_skill", "search_vault_snippets"]),
        });

        const result = deriveSameSourceFollowUpAgentControlSnapshot(base, {
            sourceScope: "notes",
            runtimeInstruction: "follow up",
        });

        expect([...result.allowedToolNames!].sort()).toEqual([
            "query_notes",
            "read_note",
            "read_note_outline",
            "search_memory",
        ]);
        expect(result.allowedToolNames!.has("webSearch")).toBe(false);
        expect(result.allowedToolNames!.has("load_skill")).toBe(false);
        expect(result.allowedToolNames!.has("search_vault_snippets")).toBe(false);
    });

    it("preserves final-only exposure without opening a follow-up allowlist", () => {
        const base = createAgentControlSnapshot({
            exposureMode: "final-only",
            sourceScope: "notes",
            allowedToolNames: new Set(["search_vault_snippets"]),
        });

        const result = deriveSameSourceFollowUpAgentControlSnapshot(base, {
            sourceScope: "notes",
            runtimeInstruction: "follow up",
        });

        expect(result.exposureMode).toBe("final-only");
        expect(result.sourceScope).toBe("none");
        expect([...toolConstraintsFromAgentControlSnapshot(result)!.allowedToolNames!]).toEqual([]);
    });

    it("preserves final_answer_only mode without opening a follow-up allowlist", () => {
        const base = createAgentControlSnapshot({
            sourceScope: "notes",
            allowedToolNames: new Set(["search_vault_snippets"]),
            toolMode: "final_answer_only",
        });

        const result = deriveSameSourceFollowUpAgentControlSnapshot(base, {
            sourceScope: "notes",
            runtimeInstruction: "follow up",
        });

        expect(result.exposureMode).toBe("final-only");
        expect(result.toolMode).toBe("final_answer_only");
        expect([...toolConstraintsFromAgentControlSnapshot(result)!.allowedToolNames!]).toEqual([]);
    });
});

describe("toolConstraintsFromAgentControlSnapshot", () => {
    it("returns undefined for undefined snapshot", () => {
        expect(toolConstraintsFromAgentControlSnapshot(undefined)).toBeUndefined();
    });

    it("returns empty allowedToolNames for final-only mode", () => {
        const snapshot = createAgentControlSnapshot({
            exposureMode: "final-only",
            allowedToolNames: new Set(["tool_a"]),
        });
        const constraints = toolConstraintsFromAgentControlSnapshot(snapshot);
        expect(constraints).toBeDefined();
        expect(constraints!.allowedToolNames).toBeDefined();
        expect(constraints!.allowedToolNames!.size).toBe(0);
    });

    it("returns empty allowedToolNames for final_answer_only toolMode", () => {
        const snapshot = createAgentControlSnapshot({
            toolMode: "final_answer_only",
            allowedToolNames: new Set(["tool_a"]),
        });
        const constraints = toolConstraintsFromAgentControlSnapshot(snapshot);
        expect(constraints!.allowedToolNames!.size).toBe(0);
    });

    it("returns undefined when no tool constraints are set", () => {
        const snapshot = createAgentControlSnapshot({ exposureMode: "semantic-first" });
        expect(toolConstraintsFromAgentControlSnapshot(snapshot)).toBeUndefined();
    });
});

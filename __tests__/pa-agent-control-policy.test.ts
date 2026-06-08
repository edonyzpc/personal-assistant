/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import {
    createAgentControlSnapshot,
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
});

describe("deriveSameSourceFollowUpAgentControlSnapshot", () => {
    it("allows search_vault_snippets for notes source scope", () => {
        const base = createAgentControlSnapshot();
        const result = deriveSameSourceFollowUpAgentControlSnapshot(base, {
            sourceScope: "notes",
            runtimeInstruction: "follow up",
        });
        expect(result.exposureMode).toBe("follow-up");
        expect(result.allowedToolNames).toBeDefined();
        expect(result.allowedToolNames!.has("search_vault_snippets")).toBe(true);
    });

    it("allows no tools for non-notes source scope", () => {
        const base = createAgentControlSnapshot();
        const result = deriveSameSourceFollowUpAgentControlSnapshot(base, {
            sourceScope: "web",
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

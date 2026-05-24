import { describe, expect, it } from "@jest/globals";

import {
    createAnswerCompletionLedger,
    decideAnswerCompletion,
    deriveAnswerCompletionTurnFacts,
    recordAnswerCompletionTurn,
} from "../src/ai-services/pa-agent-answer-completion-policy";
import type { PaAgentTurnSummary } from "../src/ai-services/pa-agent-loop";

describe("PA Agent answer completion policy", () => {
    it("allows normal tool chaining when new successful evidence was gathered", () => {
        const ledger = createAnswerCompletionLedger();
        const summary = createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("get_current_note_context")],
        });
        const facts = deriveAnswerCompletionTurnFacts(summary);

        recordAnswerCompletionTurn(ledger, summary, facts);

        expect(decideAnswerCompletion({ summary, ledger, facts })).toEqual({
            action: "continue_tooling",
            reason: "new_tool_evidence",
        });
        expect(ledger.successfulEvidenceTools.has("get_current_note_context")).toBe(true);
    });

    it("forces one no-tool finalization turn after failed-only observations", () => {
        const ledger = createAnswerCompletionLedger();
        const summary = createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("webSearch", {
                isError: true,
                outcome: "recoverable_error",
                promptText: "WebSearch request failed (HTTP 500).",
            })],
        });
        const facts = deriveAnswerCompletionTurnFacts(summary);

        recordAnswerCompletionTurn(ledger, summary, facts);

        expect(decideAnswerCompletion({ summary, ledger, facts })).toMatchObject({
            action: "force_finalize",
            reason: "tool_failure",
            toolMode: "final_answer_only",
            runtimeInstruction: expect.stringContaining("Do not call tools"),
        });
    });

    it("treats schema-invalid observations as final-answer-only failures", () => {
        const ledger = createAnswerCompletionLedger();
        const summary = createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("read_note_outline", {
                isError: true,
                outcome: "schema_invalid",
                promptText: "read_note_outline input.path must be a non-empty string.",
            })],
        });
        const facts = deriveAnswerCompletionTurnFacts(summary);

        recordAnswerCompletionTurn(ledger, summary, facts);

        expect(facts.hasOnlyFailureOrStatusResults).toBe(true);
        expect(decideAnswerCompletion({ summary, ledger, facts })).toMatchObject({
            action: "force_finalize",
            reason: "tool_failure",
            toolMode: "final_answer_only",
        });
    });

    it("turns duplicate-only tool results into one finalization attempt, then stops", () => {
        const ledger = createAnswerCompletionLedger();
        const firstSummary = createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("get_current_note_context")],
        });
        recordAnswerCompletionTurn(ledger, firstSummary);

        const duplicateSummary = createSummary({
            status: "tool_results_ready",
            toolResults: [createDuplicateToolResult("get_current_note_context")],
        });
        const duplicateFacts = deriveAnswerCompletionTurnFacts(duplicateSummary);
        recordAnswerCompletionTurn(ledger, duplicateSummary, duplicateFacts);

        expect(decideAnswerCompletion({
            summary: duplicateSummary,
            ledger,
            facts: duplicateFacts,
        })).toMatchObject({
            action: "force_finalize",
            reason: "duplicate_only",
            toolMode: "final_answer_only",
        });

        expect(decideAnswerCompletion({
            summary: duplicateSummary,
            ledger,
            facts: duplicateFacts,
        })).toMatchObject({
            action: "stop_incomplete",
            reason: "duplicate_tool_call_without_answer",
            diagnostics: [expect.objectContaining({
                tools: ["get_current_note_context"],
            })],
        });
    });

    it("retries an empty assistant once after observations were provided", () => {
        const ledger = createAnswerCompletionLedger();
        const observationSummary = createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("search_memory")],
        });
        recordAnswerCompletionTurn(ledger, observationSummary);

        const emptySummary = createSummary({
            status: "incomplete",
            diagnostics: [{ type: "assistant_empty_response" }],
        });
        const emptyFacts = deriveAnswerCompletionTurnFacts(emptySummary);

        expect(decideAnswerCompletion({
            summary: emptySummary,
            ledger,
            facts: emptyFacts,
        })).toMatchObject({
            action: "force_finalize",
            reason: "empty_after_observation",
            toolMode: "final_answer_only",
        });

        expect(decideAnswerCompletion({
            summary: emptySummary,
            ledger,
            facts: emptyFacts,
        })).toMatchObject({
            action: "stop_incomplete",
            reason: "empty_after_finalization",
        });
    });
});

function createSummary(overrides: Partial<PaAgentTurnSummary> = {}): PaAgentTurnSummary {
    return {
        turnId: "turn-1",
        turnIndex: 0,
        status: "completed",
        assistantMessage: {
            role: "assistant",
            id: "assistant-1",
            content: [],
            timestamp: 1000,
        },
        committedFinalText: "",
        pendingTextReclassified: false,
        toolCalls: [],
        toolResults: [],
        diagnostics: [],
        ...overrides,
    };
}

function createToolResult(
    toolName: string,
    options: {
        isError?: boolean;
        outcome?: string;
        promptText?: string;
    } = {},
): PaAgentTurnSummary["toolResults"][number] {
    return {
        role: "toolResult",
        id: `${toolName}-result`,
        toolCallId: `${toolName}-call`,
        toolName,
        content: {
            promptText: options.promptText ?? `${toolName} observation`,
            includeInNextPrompt: true,
            metadata: {
                outcome: options.outcome ?? "success",
            },
        },
        isError: options.isError ?? false,
        timestamp: 1000,
    };
}

function createDuplicateToolResult(toolName: string): PaAgentTurnSummary["toolResults"][number] {
    return {
        role: "toolResult",
        id: `${toolName}-duplicate-result`,
        toolCallId: `${toolName}-duplicate-call`,
        toolName,
        content: {
            promptText: "",
            includeInNextPrompt: false,
            metadata: {
                outcome: "duplicate_skipped",
            },
        },
        isError: false,
        timestamp: 1000,
    };
}

import { describe, expect, it } from "@jest/globals";
import { createRequiredCapabilityHostPolicy } from "../src/ai-services/pa-agent-required-capability-policy";
import { createAgentControlSnapshot } from "../src/ai-services/pa-agent-control-policy";
import type { PaAgentTurnSummary } from "../src/ai-services/pa-agent-loop";
import type { PaAgentResultFact } from "../src/ai-services/pa-agent-result-facts";

describe("PA Agent observation based Host policy", () => {
    it("allows one native Writing context schema correction within the existing scope", async () => {
        const policy = createRequiredCapabilityHostPolicy({ allowWritingContextSchemaRepair: true });
        const invalid = summary({ status: "tool_results_ready", toolResults: [
            toolResult("get_writing_context", { isError: true, outcome: "schema_invalid" }),
        ] });
        const first = await policy.hostPolicy.afterTurn(invalid);
        expect(first).toMatchObject({ action: "continue", reason: "tool_results_ready",
            runtimeInstruction: expect.stringContaining("correct the arguments once") });
        expect(first).not.toHaveProperty("controlSnapshot");
        expect(await policy.hostPolicy.afterTurn(invalid)).toMatchObject({ action: "continue", toolMode: "normal" });
    });

    it.each(["policy_rejected", "recoverable_error"])("keeps normal recovery for %s", async outcome => {
        const policy = createRequiredCapabilityHostPolicy({ allowWritingContextSchemaRepair: true });
        expect(await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("get_writing_context", { isError: true, outcome }),
        ] }))).toMatchObject({ action: "continue", toolMode: "normal" });
    });

    it("retries an empty answer from actual observations once, then stops incomplete", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("read_note", { resultFact: { kind: "evidence", sourceRefs: ["A.md"] } }),
        ] }));
        const empty = summary({ status: "incomplete", diagnostics: [{ type: "assistant_empty_response" }] });
        expect(await policy.hostPolicy.afterTurn(empty)).toMatchObject({ action: "continue", toolMode: "final_answer_only" });
        expect(await policy.hostPolicy.afterTurn(empty)).toMatchObject({ action: "stop", status: "incomplete",
            reason: "empty_after_finalization" });
    });

    it("offers one bound managed action after repeated note reads without treating the read as an applied action", async () => {
        const policy = createRequiredCapabilityHostPolicy({ allowManagedActionAfterDuplicateNoteRead: true });
        await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("read_note", { resultFact: { kind: "evidence", sourceRefs: ["A.md"] } }),
        ] }));
        const duplicate = summary({ status: "tool_results_ready", toolResults: [
            toolResult("read_note", { outcome: "duplicate_skipped", promptText: "", includeInNextPrompt: false }),
        ] });
        expect(await policy.hostPolicy.afterTurn(duplicate)).toMatchObject({ action: "continue",
            runtimeInstruction: expect.stringContaining("bound managed action") });
        expect(await policy.hostPolicy.afterTurn(duplicate)).not.toMatchObject({
            runtimeInstruction: expect.stringContaining("bound managed action") });
    });

    it("reports only an actual Saved Insight receipt", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        const forged = await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("manage_saved_insight", { promptText: "Saved!" }),
        ] }));
        expect(forged).not.toMatchObject({ runtimeInstruction: expect.stringContaining("already applied") });
        const applied = await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("manage_saved_insight", { resultFact: { kind: "applied", action: "saved_insight", receiptId: "receipt-1" } }),
        ] }));
        expect(applied).toMatchObject({ action: "continue", runtimeInstruction: expect.stringContaining("receipt-1") });
    });

    it("continues a valid zero-hit Memory observation without a required-tool warning", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        const decision = await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("search_memory", { resultFact: { kind: "no_match", search: "memory" },
                metadata: { memoryEvidenceState: "none" } }),
        ] }));
        expect(decision).toMatchObject({ action: "continue", reason: "tool_results_ready",
            controlSnapshot: { exposureMode: "answer-ready" } });
        expect(decision).not.toHaveProperty("warnings");
    });

    it("treats unavailable Memory as recovery rather than no match", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        const decision = await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("search_memory", { resultFact: { kind: "unavailable", capability: "search_memory", reason: "offline" },
                metadata: { memoryEvidenceState: "unavailable" } }),
        ] }));
        expect(decision).toMatchObject({ action: "continue", toolMode: "normal",
            runtimeInstruction: expect.stringContaining("recoverable observation") });
    });

    it("replaces earlier Memory evidence when the provider projection revokes it", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        const evidence = toolResult("search_memory", { resultFact: { kind: "evidence", sourceRefs: ["A.md"] },
            metadata: { memoryEvidenceState: "evidence" } });
        await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [evidence] }));
        const revoked = { ...evidence, content: { ...evidence.content,
            resultFact: { kind: "unavailable" as const, capability: "search_memory", reason: "source_revoked" },
            metadata: { ...evidence.content.metadata, memoryEvidenceState: "unavailable" } } };
        policy.synchronizeProjectedTranscript([revoked]);
        const duplicate = toolResult("search_memory", { outcome: "duplicate_skipped", promptText: "", includeInNextPrompt: false });
        const decision = await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [duplicate] }));
        expect(decision).toMatchObject({ action: "continue", toolMode: "normal" });
        expect(decision).not.toMatchObject({ toolMode: "final_answer_only" });
    });

    it("withdraws earlier Memory evidence when the full projection drops its result", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("search_memory", { resultFact: { kind: "evidence", sourceRefs: ["A.md"] } }),
        ] }));
        policy.synchronizeProjectedTranscript([]);
        const decision = await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("search_memory", { outcome: "duplicate_skipped", promptText: "", includeInNextPrompt: false }),
        ] }));
        expect(decision).toMatchObject({ action: "stop", status: "incomplete",
            reason: "duplicate_tool_call_without_answer" });
        const emptyPolicy = createRequiredCapabilityHostPolicy();
        await emptyPolicy.hostPolicy.afterTurn(summary({ status: "tool_results_ready", toolResults: [
            toolResult("search_memory", { resultFact: { kind: "evidence", sourceRefs: ["A.md"] } }),
        ] }));
        emptyPolicy.synchronizeProjectedTranscript([]);
        const empty = await emptyPolicy.hostPolicy.afterTurn(summary({ status: "incomplete",
            diagnostics: [{ type: "assistant_empty_response" }] }));
        expect(empty).toMatchObject({ action: "stop", status: "incomplete" });
    });

    it("keeps answer-ready tools within the previous allowlist", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        const decision = await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready",
            toolResults: [toolResult("read_note", { resultFact: { kind: "evidence", sourceRefs: ["A.md"] } })],
            controlSnapshot: createAgentControlSnapshot({ sourceScope: "notes",
                allowedToolNames: new Set(["read_note"]) }),
        }));
        expect(decision).toMatchObject({ action: "continue", reason: "tool_results_ready",
            controlSnapshot: { exposureMode: "answer-ready", sourceScope: "notes" } });
        if (decision.action !== "continue") throw new Error("Expected answer-ready continuation");
        expect([...decision.controlSnapshot!.allowedToolNames!]).toEqual(["read_note"]);
    });

    it("preserves Memory same-source follow-up and its existing allowlist", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        const decision = await policy.hostPolicy.afterTurn(summary({ status: "tool_results_ready",
            toolResults: [toolResult("search_memory", { resultFact: { kind: "evidence", sourceRefs: ["A.md"] },
                metadata: { needsSnippetFollowup: true } })],
            controlSnapshot: createAgentControlSnapshot({ sourceScope: "notes",
                allowedToolNames: new Set(["search_memory", "search_vault_snippets"]),
                blockedToolNames: new Set(["search_vault_snippets"]) }),
        }));
        expect(decision).toMatchObject({ action: "continue", reason: "needs_follow_up",
            controlSnapshot: { sourceScope: "notes" } });
        if (decision.action !== "continue") throw new Error("Expected follow-up");
        expect([...decision.controlSnapshot!.allowedToolNames!]).toEqual(["search_memory"]);
    });

    it("returns the actual terminal status on repeated calls", async () => {
        const policy = createRequiredCapabilityHostPolicy();
        const terminal = summary({ status: "incomplete", committedFinalText: "" });
        expect(await policy.hostPolicy.afterTurn(terminal)).toMatchObject({ action: "stop", status: "incomplete" });
        expect(await policy.hostPolicy.afterTurn(terminal)).toMatchObject({ action: "stop", status: "incomplete" });
    });
});

function summary(overrides: Partial<PaAgentTurnSummary> = {}): PaAgentTurnSummary {
    return { turnId: "turn-1", turnIndex: 0, status: "completed",
        assistantMessage: { role: "assistant", id: "assistant-1", content: [], timestamp: 1000 },
        committedFinalText: "", pendingTextReclassified: false, toolCalls: [], toolResults: [],
        diagnostics: [], metrics: [], timing: { turnIndex: 0, status: "completed", elapsedMs: 0,
            modelElapsedMs: 0, modelChunkCount: 0, toolCallCount: 0, toolResultCount: 0 }, ...overrides };
}

function toolResult(toolName: string, options: {
    isError?: boolean; outcome?: string; promptText?: string; includeInNextPrompt?: boolean;
    metadata?: Record<string, unknown>; resultFact?: PaAgentResultFact;
} = {}): PaAgentTurnSummary["toolResults"][number] {
    return { role: "toolResult", id: `${toolName}-result`, toolCallId: `${toolName}-call`, toolName,
        content: { promptText: options.promptText ?? `${toolName} observation`,
            includeInNextPrompt: options.includeInNextPrompt ?? true,
            metadata: { outcome: options.outcome ?? "success", ...options.metadata },
            ...(options.resultFact ? { resultFact: options.resultFact } : {}) },
        isError: options.isError ?? false, timestamp: 1000 };
}

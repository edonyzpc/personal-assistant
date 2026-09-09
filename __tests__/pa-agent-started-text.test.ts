import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
    PaAgentLoop,
    type PaAgentModelInput,
} from "../src/ai-services/pa-agent-loop";
import { PageletLeadDrivenPolicy } from "../src/pagelet/agent/lead-driven-policy";
import type { PageletInsightSourceSupportFailure } from "../src/pagelet/agent/pagelet-agent-quality-gate";

const anchorPath = "notes/anchor.md";
const relatedPath = "notes/related.md";
const supportedBody = [
    "## Release validation conflict",
    "`notes/anchor.md` requires validation before release, while",
    "`notes/related.md` records that direct release creates risk.",
].join("\n");

async function runPageletStartedText(
    body: string,
    sourceFailure: PageletInsightSourceSupportFailure | null = null,
) {
    const startedAt = Date.now();
    const validateSource = jest.fn(async (_body: string) => sourceFailure);
    const policy = new PageletLeadDrivenPolicy({
        anchorPath,
        anchorContent: "Validate before release.",
        maxTurns: 8,
        maxToolCalls: 10,
        maxWallClockMs: 100,
        finalizationReserveMs: 30,
        now: Date.now,
        startedAt,
        validateTerminalSourceSupport: validateSource,
    });
    const afterTurn = jest.spyOn(policy, "afterTurn");
    const modelInputs: PaAgentModelInput[] = [];
    const loop = new PaAgentLoop({
        runId: "pagelet-started-text",
        userInput: "Find the release validation conflict.",
        model: {
            stream: async function* (input) {
                modelInputs.push(input);
                input.notifyProviderRequestStarted?.();
                if (input.turnIndex === 0) {
                    yield { type: "toolcall_delta", id: "anchor", name: "get_current_note_context", input: {}, index: 0 } as const;
                    yield { type: "toolcall_delta", id: "related", name: "inspect_obsidian_note", input: { path: relatedPath }, index: 1 } as const;
                    return;
                }
                if (input.turnIndex !== 1) throw new Error("Unexpected request after the terminal boundary.");
                yield { type: "text_delta", text: body.slice(0, 10) } as const;
                await new Promise<void>((resolve) => setTimeout(resolve, 75));
                yield { type: "text_delta", text: body.slice(10) } as const;
                yield { type: "provider_completion", completion: "stop" } as const;
            },
        },
        toolExecutor: {
            execute: async ({ toolCall }) => {
                const isAnchor = toolCall.name === "get_current_note_context";
                const path = isAnchor ? anchorPath : relatedPath;
                return {
                    outcome: "success",
                    promptText: isAnchor ? "Validate before release." : "Direct release creates risk.",
                    sourceRecords: [{ kind: "context-used", dedupKey: path, path, citationEligible: true }],
                };
            },
        },
        hostPolicy: policy,
        maxWallClockMs: 100,
        finalizationReserveMs: 30,
        assistantIdleTimeoutMs: 1000,
        runStartedAt: startedAt,
    });
    const pending = loop.run();
    await jest.advanceTimersByTimeAsync(75);
    const result = await pending;
    return { result, policy, afterTurn, validateSource, modelInputs };
}

describe("started text and the production Pagelet terminal policy", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it("validates a complete answer after softAt and keeps the accepted Pagelet text", async () => {
        const { result, policy, afterTurn, validateSource, modelInputs } = await runPageletStartedText(supportedBody);

        expect(modelInputs).toHaveLength(2);
        expect(afterTurn).toHaveBeenCalledTimes(2);
        expect(validateSource).toHaveBeenCalledTimes(1);
        expect(validateSource).toHaveBeenCalledWith(supportedBody);
        expect(result.status).toBe("completed");
        expect(result.committedFinalText).toBe(supportedBody);
        expect(result.turns[1].assistantMessage).toMatchObject({ providerCompletion: "stop", stopReason: "stop" });
        expect(result.turns[1].diagnostics).toContainEqual(expect.objectContaining({ type: "finalization_reserve_used_by_text" }));
        expect(policy.resolveRunTerminal(result.turns[1])).toEqual({ finalText: supportedBody, protocolFailure: null });
    });

    it("keeps the real source rejection authoritative after the model has completed", async () => {
        const { result, policy, validateSource, modelInputs } = await runPageletStartedText(supportedBody, "stale-source");

        expect(modelInputs).toHaveLength(2);
        expect(validateSource).toHaveBeenCalledWith(supportedBody);
        expect(result.status).toBe("incomplete");
        expect(result.endPayload).toMatchObject({ reason: "pagelet_terminal_source_support_exhausted" });
        expect(policy.resolveRunTerminal(result.turns[1])).toEqual({ finalText: "", protocolFailure: "terminal-source-support" });
    });

    it("does not dispatch the correction requested by the real Pagelet policy after softAt", async () => {
        const invalidCitationBody = supportedBody.replace(relatedPath, "notes/unread.md");
        const { result, policy, afterTurn, validateSource, modelInputs } = await runPageletStartedText(invalidCitationBody);

        expect(afterTurn).toHaveBeenCalledTimes(2);
        await expect(afterTurn.mock.results[1].value).resolves.toMatchObject({ action: "continue", reason: "corrective_turn" });
        expect(modelInputs).toHaveLength(2);
        expect(validateSource).not.toHaveBeenCalled();
        expect(result.status).toBe("incomplete");
        expect(result.endPayload).toMatchObject({ reason: "finalization_policy_requested_continuation" });
        expect(policy.resolveRunTerminal(result.turns[1])).toEqual({ finalText: "", protocolFailure: "citation" });
    });
});

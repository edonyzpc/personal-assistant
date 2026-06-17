import { describe, expect, it } from "@jest/globals";

import {
    PaAgentContextCompactor,
    PaAgentContextHygiene,
    PaAgentContextManager,
} from "../src/ai-services/context";
import type { PaAgentMessage } from "../src/ai-services/chat-types";

function user(id: string, content = "user"): PaAgentMessage {
    return { role: "user", id, content, timestamp: 1 };
}

function assistantWithToolCall(id: string, callId: string): PaAgentMessage {
    return {
        role: "assistant",
        id,
        content: [{ type: "toolCall", id: callId, name: "search_memory", input: {} }],
        timestamp: 2,
    };
}

function toolResult(
    id: string,
    callId: string,
    promptText: string,
    metadata: Record<string, unknown> = {},
): PaAgentMessage {
    return {
        role: "toolResult",
        id,
        toolCallId: callId,
        toolName: "search_memory",
        isError: false,
        timestamp: 3,
        content: {
            promptText,
            includeInNextPrompt: true,
            metadata,
            sourceRecords: [{ kind: "memory-reference", dedupKey: id, path: "notes/a.md" }],
        },
    };
}

describe("PaAgentContextHygiene", () => {
    it("hides status-only tool results and removes orphan tool results", () => {
        const hygiene = new PaAgentContextHygiene();
        const result = hygiene.clean([
            user("u1"),
            assistantWithToolCall("a1", "call-1"),
            toolResult("t1", "call-1", "duplicate status", { outcome: "duplicate_skipped" }),
            toolResult("t2", "missing-call", "orphan result"),
        ]);

        expect(result.hiddenStatusOnlyToolResults).toBe(1);
        expect(result.removedOrphanToolResults).toBe(1);
        expect(result.transcript).toHaveLength(3);
        const hidden = result.transcript.find((message) => message.id === "t1");
        expect(hidden?.role).toBe("toolResult");
        if (hidden?.role !== "toolResult") return;
        expect(hidden.content.includeInNextPrompt).toBe(false);
        expect(hidden.content.promptText).toBe("");
        expect(hidden.content.metadata?.hygieneHiddenFromPrompt).toBe(true);
    });
});

describe("PaAgentContextCompactor", () => {
    it("micro-compacts older tool results while preserving the latest turn", () => {
        const compactor = new PaAgentContextCompactor();
        const oldObservation = "old observation ".repeat(80);
        const latestObservation = "latest observation ".repeat(20);
        const transcript: PaAgentMessage[] = [
            user("u1"),
            assistantWithToolCall("a1", "call-1"),
            toolResult("t1", "call-1", oldObservation),
            user("u2"),
            assistantWithToolCall("a2", "call-2"),
            toolResult("t2", "call-2", oldObservation),
            user("u3"),
            assistantWithToolCall("a3", "call-3"),
            toolResult("t3", "call-3", latestObservation),
        ];

        const result = compactor.microCompact(transcript, {
            maxObservationChars: 2000,
            protectedRecentTurns: 1,
            triggerRatio: 0.1,
            targetRatio: 0.5,
        });

        const compacted = result.transcript.find((message) => message.id === "t1");
        const recent = result.transcript.find((message) => message.id === "t3");
        expect(result.compactedToolResults).toBeGreaterThan(0);
        expect(compacted?.role).toBe("toolResult");
        expect(recent?.role).toBe("toolResult");
        if (compacted?.role !== "toolResult" || recent?.role !== "toolResult") return;
        expect(compacted.content.metadata?.compacted).toBe(true);
        expect(compacted.content.sourceRecords?.[0]?.path).toBe("notes/a.md");
        expect(recent.content.metadata?.compacted).toBeUndefined();
        expect(recent.content.promptText).toBe(latestObservation);
    });

    it("applies a hard observation cap at projection time without mutating source records", () => {
        const compactor = new PaAgentContextCompactor();
        const transcript: PaAgentMessage[] = [
            user("u1"),
            assistantWithToolCall("a1", "call-1"),
            toolResult("t1", "call-1", "latest observation ".repeat(80)),
        ];

        const result = compactor.microCompact(transcript, {
            maxObservationChars: 160,
            protectedRecentTurns: 1,
            triggerRatio: 0.1,
            targetRatio: 0.5,
        });

        const capped = result.transcript.find((message) => message.id === "t1");
        expect(capped?.role).toBe("toolResult");
        if (capped?.role !== "toolResult") return;
        expect(capped.content.promptText.length).toBeLessThanOrEqual(160);
        expect(capped.content.metadata?.contextBudgetTruncated).toBe(true);
        expect(capped.content.sourceRecords?.[0]?.path).toBe("notes/a.md");
    });
});

describe("PaAgentContextManager", () => {
    it("projects injected profile and vault insight context with hygiene diagnostics", () => {
        const manager = new PaAgentContextManager();
        const projection = manager.forPrompt({
            prompt: "What should I focus on?",
            chatHistory: [{ role: "user", content: "Remember I prefer concrete plans." }],
            transcript: [
                user("u1"),
                assistantWithToolCall("a1", "call-1"),
                toolResult("t1", "call-1", "policy status", { outcome: "policy_rejected" }),
            ],
            turnIndex: 1,
            injectedContext: {
                userProfile: "# User Profile\n- I prefer concrete plans.",
                vaultInsights: "# Vault Insights\n- Research has open gaps.",
            },
            availableSkills: "None",
            toolDefinitions: "No tools",
            maxHistoryChars: 2000,
            maxPromptChars: 4000,
            maxObservationChars: 1000,
            formatToolObservations: (transcript) => {
                const visible = transcript
                    .filter((message): message is Extract<PaAgentMessage, { role: "toolResult" }> =>
                        message.role === "toolResult" && message.content.includeInNextPrompt)
                    .map((message) => message.content.promptText);
                return visible.length ? visible.join("\n") : "None";
            },
        });

        expect(projection.input).toContain("<user_profile context_only=\"true\" source=\"memory_extraction\">");
        expect(projection.input).toContain("I prefer concrete plans.");
        expect(projection.input).toContain("<vault_insights context_only=\"true\" source=\"memory_extraction\">");
        expect(projection.input).toContain("Research has open gaps.");
        expect(projection.toolObservations).toBe("None");
        expect((projection.diagnostics.hygiene as { hiddenStatusOnlyToolResults: number }).hiddenStatusOnlyToolResults)
            .toBe(1);
        expect(projection.budget.estimatedPromptTokens).toBeGreaterThan(0);
    });

    it("trims long history without cutting through sandbox wrappers", () => {
        const manager = new PaAgentContextManager();
        const chatHistory = Array.from({ length: 16 }, (_, index) => ([
            { role: "user" as const, content: `user-turn-${index} ${"x".repeat(120)}` },
            { role: "assistant" as const, content: `assistant-turn-${index} ${"y".repeat(120)}` },
        ])).flat();
        const projection = manager.forPrompt({
            prompt: "Summarize the recent state.",
            chatHistory,
            transcript: [user("u1")],
            turnIndex: 1,
            availableSkills: "None",
            toolDefinitions: "No tools",
            maxHistoryChars: 700,
            maxPromptChars: 2000,
            maxObservationChars: 1000,
            formatToolObservations: () => "None",
        });

        const historyStart = projection.input.indexOf("Recent chat history:");
        expect(historyStart).toBeGreaterThanOrEqual(0);
        const historyText = projection.input.slice(historyStart);
        expect(historyText).toMatch(/<(chat_history|compaction_summary)\b[^>]*>/);
        expect(historyText).toMatch(/<\/(chat_history|compaction_summary)>/);
        expect(historyText).not.toMatch(/^Recent chat history:\n[^<]/);
    });
});

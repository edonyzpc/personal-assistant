import { describe, expect, it } from "@jest/globals";
import type { ChatMessage, PaAgentMessage } from "../src/ai-services/chat-types";
import { PaAgentContextCompactor } from "../src/ai-services/context/PaAgentContextCompactor";
import { PaAgentContextManager } from "../src/ai-services/context/PaAgentContextManager";
import { PaAgentContextProjector } from "../src/ai-services/context/PaAgentContextProjector";
import {
    fitFullHistory,
    formatHistoryMessages,
    formatSemanticHistorySummary,
    planHistoryContext,
} from "../src/ai-services/context/PaAgentHistoryContextPlan";
import type {
    PaAgentContextSummaries,
    PaAgentHistorySummary,
    PaAgentToolSummarySource,
} from "../src/ai-services/context/PaAgentContextSummaryTypes";
import type { RepeatedSourceContent } from "../src/ai-services/context/PaAgentContextTextEncoding";

function history(turns = 12, bodyChars = 250): ChatMessage[] {
    return Array.from({ length: turns }, (_, index) => [
        { role: "user" as const, content: `user-${index}: ${"x".repeat(bodyChars)}` },
        { role: "assistant" as const, content: `assistant-${index}: ${"y".repeat(bodyChars)}` },
    ]).flat();
}

function summaryFor(messages: ChatMessage[], covered: number, text = JSON.stringify({ decisions: ["Keep SQLite."] })): PaAgentHistorySummary {
    return { text, sourceMessages: messages.slice(0, covered).map((message) => ({ ...message })) };
}

function result(id: string, body = "raw evidence ".repeat(1000)): PaAgentToolSummarySource {
    return {
        id, role: "toolResult", timestamp: 1, toolCallId: `call-${id}`,
        toolName: "search_memory", isError: false,
        content: {
            promptText: body,
            includeInNextPrompt: true,
            sourceRecords: [{ kind: "memory-reference", dedupKey: id, path: "notes/evidence.md", metadata: { revision: 1 } }],
        },
    };
}

function transcriptFor(...results: PaAgentToolSummarySource[]): PaAgentMessage[] {
    return [{ id: "user", role: "user", content: "Review evidence without writing.", timestamp: 0 }, ...results.flatMap((tool): PaAgentMessage[] => [
        {
            id: `assistant-${tool.id}`, role: "assistant", timestamp: 1,
            content: [{ type: "toolCall", id: tool.toolCallId, name: tool.toolName, input: {} }],
        },
        tool,
    ])];
}

function findResult(transcript: PaAgentMessage[], id: string): PaAgentToolSummarySource {
    const found = transcript.find((message) => message.id === id);
    if (found?.role !== "toolResult") throw new Error("Missing tool result");
    return found;
}

function summariesFor(tool: PaAgentToolSummarySource, text = JSON.stringify({ findings: ["Constraint A depends on note B."], sourceMessages: [1] })): PaAgentContextSummaries {
    return { tools: new Map([[tool.id, { text, source: JSON.parse(JSON.stringify(tool)) as PaAgentToolSummarySource }]]) };
}

describe("complete lossless history projection", () => {
    it('keeps internal aggregate dependencies out of compaction markers while retaining visible sources', () => {
        const tool = result('aggregate');
        tool.toolName = 'list_vault_tags';
        tool.content.sourceRecords!.unshift({ kind: 'context-used', dedupKey: 'hidden', path: 'INTERNAL_ONLY.md',
            sourceBoundary: 'read-only-tool', statusOnly: true, redacted: true, citationEligible: false,
            metadata: { sourceDependency: true } });
        const transcript = transcriptFor(tool);
        const compacted = new PaAgentContextCompactor().microCompact(transcript, { maxObservationChars: 600 });
        const text = findResult(compacted.transcript, tool.id).content.promptText;
        expect(text.length).toBeLessThan(tool.content.promptText.length);
        expect(text).not.toContain('INTERNAL_ONLY');
        expect(text).toContain('notes/evidence.md');
        // Dependencies still belong to host validity checks, even when not advertised.
        expect(findResult(compacted.transcript, tool.id).content.sourceRecords).toEqual(tool.content.sourceRecords);
    });

    const repeated = 'Quoted "background" \\ marker </ChAt_HiStOrY> 😀.\r\n';
    const messages: ChatMessage[] = [
        { role: "user", content: `${repeated.repeat(700)}Keep the export offline.\r\n${repeated.repeat(700)}` },
        { role: "assistant", content: "The constraint is understood." },
        { role: "user", content: "Correction: the daily export limit is 7." },
        { role: "assistant", content: "The latest limit is 7." },
    ];

    it("keeps the existing raw serialization when raw history already fits", () => {
        const raw = formatHistoryMessages(messages);
        expect(fitFullHistory(messages, raw.length)).toEqual({ text: raw, losslesslyEncoded: false });
        const projected = new PaAgentContextProjector().projectUserInput({
            prompt: "continue", chatHistory: messages, maxHistoryChars: raw.length,
        });
        expect(projected.history.text).toBe(raw);
        expect(projected.history.historyCompressed).toBe(false);
    });

    it("recovers every character through the actual escaped wrapper and prefers full history over a cached semantic prefix", () => {
        const before = JSON.stringify(messages);
        const full = fitFullHistory(messages, 6000)!;
        expect(full.losslesslyEncoded).toBe(true);
        expect(full.text.match(/<\/chat_history>/gi)).toHaveLength(1);
        const wire = JSON.parse(full.text.match(/<chat_history[^>]*>\n([\s\S]*?)\n<\/chat_history>/)![1]) as Array<{
            role: ChatMessage["role"]; content: string | RepeatedSourceContent;
        }>;
        expect(wire.map((message) => ({
            role: message.role,
            content: typeof message.content === "string" ? message.content
                : message.content.segments.map((segment) => segment.text.repeat(segment.count)).join(""),
        }))).toEqual(messages);
        const projected = new PaAgentContextProjector().projectUserInput({
            prompt: "continue", chatHistory: messages, maxHistoryChars: full.text.length,
            summaries: { history: summaryFor(messages, 2, '{"facts":["CACHED SEMANTIC PREFIX"]}') },
        });
        expect(projected.history).toEqual({ text: full.text, compactedCount: 0, summaryChars: 0,
            omittedCount: 0, historyCompressed: true });
        expect(projected.history.sourceMessages).toEqual(messages);
        expect(projected.input).not.toContain("CACHED SEMANTIC PREFIX");
        expect(JSON.stringify(messages)).toBe(before);
    });

    it("uses the same actual wrapper boundary in planning and projection and falls back when it no longer fits", () => {
        const full = fitFullHistory(messages, 6000)!;
        expect(planHistoryContext(messages, full.text.length)).toEqual({ mode: "full", coveredMessages: 0, summaryMaxChars: 0 });
        expect(fitFullHistory(messages, full.text.length - 1)).toBeUndefined();
        expect(planHistoryContext(messages, full.text.length - 1).mode).toBe("summarized");
        const fallback = new PaAgentContextProjector().projectUserInput({
            prompt: "continue", chatHistory: messages, maxHistoryChars: full.text.length - 1,
        });
        expect(fallback.history.text.length).toBeLessThan(full.text.length);
        expect(fallback.history.text).not.toContain("adjacent-repeats-v1");
    });
});

describe("semantic history coverage planning", () => {
    it("does not request a summary when the escaped full history fits", () => {
        const messages = history();
        expect(planHistoryContext(messages, formatHistoryMessages(messages).length)).toEqual({
            mode: "full", coveredMessages: 0, summaryMaxChars: 0,
        });
    });

    it("reserves summary room before choosing a complete raw suffix", () => {
        const messages = history();
        const budget = 2400;
        const plan = planHistoryContext(messages, budget);
        const summary = summaryFor(messages, plan.coveredMessages, "x".repeat(plan.summaryMaxChars));
        const raw = formatHistoryMessages(messages.slice(plan.coveredMessages));

        expect(plan.mode).toBe("summarized");
        expect(plan.summaryMaxChars).toBeGreaterThan(0);
        expect(plan.coveredMessages % 2).toBe(0);
        expect(plan.coveredMessages).toBeLessThan(messages.length);
        expect(formatSemanticHistorySummary(summary.text).length + raw.length + 2).toBeLessThanOrEqual(budget);
        expect(plan.coveredMessages).toBeGreaterThan(
            messages.length - JSON.parse(new PaAgentContextProjector().projectUserInput({
                prompt: "", chatHistory: messages, maxHistoryChars: budget, maxHistorySummaryChars: 0,
            }).history.text.match(/<chat_history[^>]*>\n([\s\S]*?)\n<\/chat_history>/)![1]).length,
        );
    });

    it("can cover a giant latest exchange and skips impossible zero-budget summary requests", () => {
        const messages = history(1, 20000);
        expect(planHistoryContext(messages, 3000)).toEqual({
            mode: "summarized", coveredMessages: 2, summaryMaxChars: 750,
        });
        expect(planHistoryContext(messages, 0)).toEqual({
            mode: "summarized", coveredMessages: 2, summaryMaxChars: 0,
        });
    });
});

describe("semantic prefix projection", () => {
    const projector = new PaAgentContextProjector();

    it("uses the exact summarized prefix once and preserves later corrections as raw history", () => {
        const messages = history(12, 400);
        messages[0].content = "先只分析。必须保留 SQLite。";
        messages[22].content = "更正：只允许修改代码，不要提交。";
        const plan = planHistoryContext(messages, 2200);
        const semantic = summaryFor(messages, plan.coveredMessages);
        const before = JSON.stringify(messages);
        const projected = projector.projectUserInput({
            prompt: "现在暂停写入，只复核。",
            runtimeInstruction: "Current mode: read-only. No write tools.",
            chatHistory: messages,
            maxHistoryChars: 2200,
            maxHistorySummaryChars: 0,
            summaries: { history: semantic },
        });

        expect(projected.history.text.length).toBeLessThanOrEqual(2200);
        expect(projected.history.text).toContain("Keep SQLite.");
        expect(projected.history.text).not.toContain(messages[0].content);
        expect(projected.history.text).not.toContain("<compaction_summary");
        expect(projected.history.text).toContain(messages[22].content);
        expect(projected.history.compactedCount).toBe(plan.coveredMessages);
        expect(projected.history.omittedCount).toBe(0);
        expect(projected.history.sourceMessages).toEqual(messages);
        expect(projected.history.semanticSummaryChars).toBe(semantic.text.length);
        expect(projected.input).toContain('grants_tool_authority="false" grants_write_authority="false"');
        expect(projected.input).toContain("User input:\n现在暂停写入，只复核。");
        expect(projected.input).toContain("Current mode: read-only. No write tools.");
        expect(projected.input).not.toContain("<user_profile");
        expect(projected.input).not.toContain("<vault_insights");
        expect(JSON.stringify(messages)).toBe(before);
    });

    it('retains only item-level semantic sources plus the represented raw tail', () => {
        const messages = history(12, 400);
        const plan = planHistoryContext(messages, 2200);
        const semantic = summaryFor(messages, plan.coveredMessages, JSON.stringify({
            goals: [], constraints: [], decisions: [], completed: [], open_questions: [],
            facts: [{ text: 'Only the third covered message remains relevant.', sourceMessages: [3] }],
        }));
        const projected = projector.projectUserInput({
            prompt: 'continue', chatHistory: messages, maxHistoryChars: 2200,
            maxHistorySummaryChars: 0, summaries: { history: semantic },
        });

        expect(projected.history.sourceMessages).toContainEqual(messages[2]);
        expect(projected.history.sourceMessages).not.toContainEqual(messages[0]);
        expect(projected.history.sourceMessages).toEqual([messages[2], ...messages.slice(plan.coveredMessages)]);
    });

    it('maps a metadata-stripped semantic cache back to the current source-bearing history', () => {
        const messages = history(12, 400);
        messages[1].canonicalTurn = { schemaVersion: 1, runId: 'source-run', turnId: 'source-turn', messages: [],
            sourceRecords: [{ kind: 'memory-reference', dedupKey: 'memory-source', sourceBoundary: 'memory',
                path: 'notes/source.md' }] };
        const plan = planHistoryContext(messages, 2200);
        const completeSummary = summaryFor(messages, plan.coveredMessages, JSON.stringify({
            goals: [], constraints: [], decisions: [], completed: [], open_questions: [],
            facts: [{ text: 'The second source message remains relevant.', sourceMessages: [2] }],
        }));
        const summary: PaAgentHistorySummary = { text: completeSummary.text,
            sourceMessages: completeSummary.sourceMessages.map(message => ({
                role: message.role, content: message.content, ...(message.images ? { images: message.images } : {}),
            })) };

        const projected = projector.projectUserInput({
            prompt: 'continue', chatHistory: messages, maxHistoryChars: 2200,
            maxHistorySummaryChars: 0, summaries: { history: summary },
        });

        expect(projected.history.sourceMessages[0]).toBe(messages[1]);
        expect(projected.history.sourceMessages[0].canonicalTurn?.sourceRecords).toEqual(
            messages[1].canonicalTurn?.sourceRecords,
        );
    });

    it.each(["edit", "delete"])("rejects a cached summary after prefix %s", (change) => {
        const messages = history(12, 400);
        const semantic = summaryFor(messages, 12, JSON.stringify({ decisions: ["stale unique decision"] }));
        if (change === "edit") messages[0].content = "New replacement instruction.";
        else messages.splice(0, 2);
        const projected = projector.projectUserInput({
            prompt: "continue", chatHistory: messages, maxHistoryChars: 1500,
            summaries: { history: semantic },
        });

        expect(projected.history.text).not.toContain("stale unique decision");
        expect(projected.history.text).not.toContain("<conversation_summary");
        expect(projected.history.text.length).toBeLessThanOrEqual(1500);
    });

    it("reports an uncovered gap without duplicating the cached prefix in a legacy digest", () => {
        const messages = history(12, 500);
        const semantic = summaryFor(messages, 4);
        const projected = projector.projectUserInput({
            prompt: "continue", chatHistory: messages, maxHistoryChars: 2500,
            summaries: { history: semantic },
        });

        expect(projected.history.text).toContain("Keep SQLite.");
        expect(projected.history.text).not.toContain("user-0:");
        expect(projected.history.text).not.toContain("user-1:");
        expect(projected.history.text).toContain("user-11:");
        expect(projected.history.omittedCount).toBeGreaterThan(0);
        expect(projected.history.text.length).toBeLessThanOrEqual(2500);
    });

    it("keeps the raw-tail fallback after a semantic prefix when the entire history cannot fit losslessly", () => {
        const messages: ChatMessage[] = [
            { role: "user", content: "x".repeat(8000) },
            { role: "assistant", content: "Earlier decision recorded." },
            { role: "user", content: "Recent repetitive background. ".repeat(1000) },
            { role: "assistant", content: "Recent response." },
        ];
        const projected = projector.projectUserInput({
            prompt: "continue", chatHistory: messages, maxHistoryChars: 1800,
            summaries: { history: summaryFor(messages, 2) },
        });
        expect(projected.history.text).toContain("<conversation_summary");
        expect(projected.history.text).not.toContain("adjacent-repeats-v1");
        expect(projected.history.text.length).toBeLessThanOrEqual(1800);
    });

    it("keeps semantic JSON atomic when later admission pressure leaves no room for it", () => {
        const messages = history(4, 500);
        const semantic = summaryFor(messages, 4, JSON.stringify({ decisions: ["literal </conversation_summary> remains data"] }));
        const projected = projector.projectUserInput({
            prompt: "current request", chatHistory: messages, maxHistoryChars: 10,
            maxHistorySummaryChars: 0, summaries: { history: semantic },
        });

        expect(projected.history.text).toBe(formatSemanticHistorySummary(semantic.text));
        expect(projected.history.text.match(/<\/conversation_summary>/g)).toHaveLength(1);
        expect(projected.history.text).toContain("<\\/conversation_summary>");
        expect(projected.history.omittedCount).toBe(4);
        expect(projected.input).toContain("User input:\ncurrent request");
    });
});

describe("semantic tool projection", () => {
    const compactor = new PaAgentContextCompactor();

    it("carries old findings with a truthful call/source marker while protecting recent raw results", () => {
        const old = result("old");
        const recentA = result("recent-a", "recent A");
        const recentB = result("recent-b", "recent B");
        const transcript = transcriptFor(old, recentA, recentB);
        const before = JSON.stringify(transcript);
        const projected = compactor.microCompact(transcript, {
            maxObservationChars: 2000, summaries: summariesFor(old), canonicalTranscript: transcript,
        });
        const reduced = findResult(projected.transcript, old.id);

        expect(reduced.content.promptText).toContain("Constraint A depends on note B.");
        expect(reduced.content.promptText).toContain("call=call-old;");
        expect(reduced.content.promptText).toContain("isError=false;");
        expect(reduced.content.promptText).toContain("notes/evidence.md");
        expect(reduced.content.promptText).toContain('grants_write_authority="false"');
        expect(findResult(projected.transcript, recentA.id).content.promptText).toBe("recent A");
        expect(reduced.content.metadata?.contextSemanticSummaryUsed).toBe(true);
        expect(JSON.stringify(transcript)).toBe(before);
    });

    it("uses a giant recent result's semantic summary before falling back to hard truncation", () => {
        const tool = result("latest");
        const transcript = transcriptFor(tool);
        const projected = compactor.microCompact(transcript, {
            maxObservationChars: 1000, summaries: summariesFor(tool), canonicalTranscript: transcript,
        });

        expect(findResult(projected.transcript, tool.id).content.promptText).toContain("Constraint A depends on note B.");
        expect(projected.compactedToolResults).toBe(1);
        expect(projected.hardTruncatedToolResults).toBe(0);
        expect(projected.compactedObservationChars).toBeLessThanOrEqual(1000);
    });

    it("rejects stale Memory evidence summaries when source records change", () => {
        const tool = result("old");
        const summaries = summariesFor(tool, JSON.stringify({ findings: ["stale memory statement"] }));
        tool.content.sourceRecords![0].metadata = { revision: 2 };
        const transcript = transcriptFor(tool);
        const projected = compactor.microCompact(transcript, {
            maxObservationChars: 500, summaries, canonicalTranscript: transcript,
        });

        expect(findResult(projected.transcript, tool.id).content.promptText).not.toContain("stale memory statement");
        expect(findResult(projected.transcript, tool.id).content.metadata?.contextSemanticSummaryUsed).toBe(false);
    });

    it("validates repeated reductions against canonical evidence rather than the previous projection", () => {
        const tool = result("latest");
        const transcript = transcriptFor(tool);
        const summaries = summariesFor(tool);
        const first = compactor.microCompact(transcript, { maxObservationChars: 1000, summaries, canonicalTranscript: transcript });
        const repeated = compactor.microCompact(first.transcript, {
            maxObservationChars: 900, triggerRatio: 0, targetRatio: 0,
            summaries, canonicalTranscript: transcript,
        });

        expect(findResult(repeated.transcript, tool.id).content.promptText).toBe(findResult(first.transcript, tool.id).content.promptText);
        expect(findResult(repeated.transcript, tool.id).content.metadata?.contextSemanticSummaryUsed).toBe(true);
        expect(findResult(repeated.transcript, tool.id).content.metadata?.originalPromptTextLength).toBe(tool.content.promptText.length);
    });

    it("drops an indivisible semantic block as a whole if hard pressure cannot fit it", () => {
        const tool = result("latest");
        const transcript = transcriptFor(tool);
        const projected = compactor.microCompact(transcript, {
            maxObservationChars: 200, summaries: summariesFor(tool), canonicalTranscript: transcript,
        });
        const reduced = findResult(projected.transcript, tool.id);

        expect(reduced.content.promptText).not.toContain("<tool_context_summary");
        expect(reduced.content.promptText).not.toContain('"findings"');
        expect(reduced.content.promptText).toMatch(/result truncated;.*details omitted\.\]$/);
        expect(reduced.content.metadata?.contextSemanticSummaryUsed).toBe(false);
        expect(projected.hardTruncatedToolResults).toBe(1);
    });
});

describe("semantic Manager integration", () => {
    it("exposes real usage and reduction candidates without putting summary snapshots in diagnostics", () => {
        const messages = history(12, 400);
        const tool = result("tool");
        const transcript = transcriptFor(tool);
        const tools = summariesFor(tool);
        const plan = planHistoryContext(messages, 2400);
        const summaries: PaAgentContextSummaries = { ...tools, history: summaryFor(messages, plan.coveredMessages) };
        const projected = new PaAgentContextManager().forPrompt({
            prompt: "continue without writing", chatHistory: messages, transcript, turnIndex: 1,
            summaries, availableSkills: "None", toolDefinitions: "None",
            maxHistoryChars: 2400, maxObservationChars: 1000, maxPromptChars: 6000,
            formatToolObservations: (items) => items.filter((message) => message.role === "toolResult")
                .map((message) => message.content.promptText).join("\n"),
        });

        expect(projected.historyBudgetChars).toBe(2400);
        expect(projected.reducedToolMessageIds).toEqual(["tool"]);
        expect(projected.outcome.admission).toBe("fit");
        expect(projected.diagnostics.historyCompaction).toMatchObject({ semanticSummaryUsed: true });
        expect(projected.diagnostics.microCompaction).toMatchObject({ semanticSummaryUsed: true, semanticToolSummaries: 1 });
        expect(JSON.stringify(projected.diagnostics)).not.toContain("Keep SQLite.");
        expect(JSON.stringify(projected.diagnostics)).not.toContain("Constraint A depends on note B.");
    });

    it("keeps complete semantic JSON for the guard to reject instead of truncating it under final pressure", () => {
        const messages = history(4, 500);
        const semantic = summaryFor(messages, 8);
        const projected = new PaAgentContextManager().forPrompt({
            prompt: "x".repeat(1000), chatHistory: messages, transcript: [], turnIndex: 1,
            summaries: { history: semantic }, availableSkills: "None", toolDefinitions: "None",
            maxHistoryChars: 1000, maxObservationChars: 1000, maxPromptChars: 1100,
            formatToolObservations: () => "None",
        });

        expect(projected.outcome.admission).toBe("local_overflow");
        expect(projected.input).toContain(formatSemanticHistorySummary(semantic.text));
        expect(projected.input).toContain(`User input:\n${"x".repeat(1000)}`);
    });
});

import { describe, expect, it } from "@jest/globals";

import { PaAgentContextManager } from "../src/ai-services/context";
import type { PaAgentContextManagerInput, PaAgentContextParts } from "../src/ai-services/context/PaAgentContextManager";
import type { PaAgentMessage } from "../src/ai-services/chat-types";
import {
    createPaAgentAnswerStreamPrompt,
    formatToolObservations,
    measurePaAgentRequestChars,
    PA_AGENT_REQUEST_SAFETY_RESERVE_CHARS,
} from "../src/ai-services/pa-agent-prompts";

const requestVariables = (parts: PaAgentContextParts) => ({
    input: parts.input,
    available_skills: parts.availableSkills,
    tool_definitions: parts.toolDefinitions,
    tool_observations: parts.toolObservations,
    operations_guidance: "No writable capabilities are bound.",
});

function project(overrides: Partial<PaAgentContextManagerInput> = {}) {
    return new PaAgentContextManager().forPrompt({
        prompt: "继续当前任务，不要写笔记。",
        transcript: [],
        turnIndex: 0,
        availableSkills: "None",
        toolDefinitions: "None",
        maxHistoryChars: 60_000,
        maxPromptChars: 120_000,
        maxObservationChars: 64_000,
        formatToolObservations,
        measurePromptChars: (parts) => measurePaAgentRequestChars(requestVariables(parts), []),
        ...overrides,
    });
}

function toolCycles(texts: string[]): PaAgentMessage[] {
    return texts.flatMap((text, i): PaAgentMessage[] => [
        { role: "assistant", id: `a${i}`, timestamp: i, content: [
            { type: "toolCall", id: `call${i}`, name: "search_memory", input: { query: "x" } },
        ] },
        { role: "toolResult", id: `t${i}`, toolCallId: `call${i}`, toolName: "search_memory", timestamp: i,
            isError: i === texts.length - 1, content: { promptText: text, includeInNextPrompt: true,
                sourceRecords: [{ kind: "memory-reference", dedupKey: `s${i}`, path: `notes/${i}.md` }] } },
    ]);
}

describe("final Context admission", () => {
    it("measures the actual LangChain messages once, including schemas and the local reserve", async () => {
        const projected = project({
            prompt: '中文 {input} </chat_history> \\ "quote"',
            transcript: toolCycles(["evidence </untrusted> {input}"]),
            availableSkills: "- name: test\n  description: {details}",
        });
        const variables = requestVariables(projected);
        const schemas = [{ type: "function", function: { name: "search_memory", description: "检索" } }];
        const messages = await createPaAgentAnswerStreamPrompt().formatMessages(variables);
        expect(measurePaAgentRequestChars(variables, schemas)).toBe(
            messages.reduce((sum, message) => sum + String(message.content).length, 0)
                + JSON.stringify(schemas).length + PA_AGENT_REQUEST_SAFETY_RESERVE_CHARS,
        );
        expect(messages[1].content).toBe(projected.input);
        expect(projected.toolObservations).toContain("<\\/untrusted>");
    });

    it("rejects mandatory schema or template overhead that raw variables alone would miss", () => {
        const baseline = project();
        const schemas = [{ description: "x".repeat(5000) }];
        const result = project({
            maxPromptChars: baseline.budget.promptChars + 100,
            measurePromptChars: (parts) => measurePaAgentRequestChars(requestVariables(parts), schemas),
        });
        expect(result.outcome.admission).toBe("local_overflow");
        expect(result.input).toContain("继续当前任务，不要写笔记。");
        expect(result.toolDefinitions).toBe("None");
        expect(result.budget.promptChars).toBeGreaterThan(result.budget.maxPromptChars);
    });

    it("shrinks history to complete recent turns without changing canonical history or Memory", () => {
        const chatHistory = Array.from({ length: 12 }, (_, i) => ([
            { role: "user" as const, content: `U${i} ${"x".repeat(200)}` },
            { role: "assistant" as const, content: `A${i} ${"y".repeat(200)}` },
        ])).flat();
        const injectedContext = { governedMemoryContext: "Stable saved preference", memoryContextMode: "governed" as const };
        const source = JSON.stringify({ chatHistory, injectedContext });
        const baseline = project({ injectedContext });
        const result = project({ chatHistory, injectedContext, maxPromptChars: baseline.budget.promptChars + 1400 });
        expect(result.outcome).toMatchObject({ admission: "fit", historyCompressed: true, budgetLimited: true });
        expect(result.budget.promptChars).toBeLessThanOrEqual(result.budget.maxPromptChars);
        expect(result.input).toContain(chatHistory.at(-1)!.content);
        expect(result.input).toContain(chatHistory.at(-2)!.content);
        expect(result.input).toContain("Stable saved preference");
        expect(result.input).toContain('grants_write_authority="false"');
        expect(JSON.stringify({ chatHistory, injectedContext })).toBe(source);
    });

    it("reduces old tool cycles before recent evidence or fitting chat history", () => {
        const transcript = toolCycles(["old ".repeat(2000), "recent evidence 1", "recent evidence 2"]);
        const chatHistory = [{ role: "user" as const, content: "Earlier requirement" },
            { role: "assistant" as const, content: "Agreed decision" }];
        const original = JSON.stringify(transcript);
        const full = project({ transcript, chatHistory });
        const result = project({ transcript, chatHistory, maxPromptChars: full.budget.promptChars - 3000 });
        expect(result.outcome).toMatchObject({ admission: "fit", historyCompressed: false, toolResultsCompacted: 1 });
        expect(result.toolObservations).toContain("recent evidence 1");
        expect(result.toolObservations).toContain("recent evidence 2");
        expect(result.input).toContain("Earlier requirement");
        expect(JSON.stringify(transcript)).toBe(original);
    });

    it("recomputes full lossless admission when the final prompt budget shrinks", () => {
        const chatHistory = [
            { role: "user" as const, content: `${"Repeated background. ".repeat(4000)}Original constraint: offline export.` },
            { role: "assistant" as const, content: "Acknowledged." },
        ];
        const original = JSON.stringify(chatHistory);
        const baseline = project();
        const full = project({ chatHistory });
        expect(full.outcome).toMatchObject({ admission: "fit", historyCompressed: true, budgetLimited: false });
        expect(full.input).toContain("adjacent-repeats-v1");
        expect(full.diagnostics.historyCompaction).toMatchObject({ compactedCount: 0, omittedCount: 0, summaryChars: 0 });
        const reduced = project({ chatHistory, maxPromptChars: baseline.budget.promptChars + 180 });
        expect(reduced.outcome).toMatchObject({ admission: "fit", historyCompressed: true, budgetLimited: true });
        expect(reduced.input).not.toContain("adjacent-repeats-v1");
        expect(reduced.budget.promptChars).toBeLessThanOrEqual(reduced.budget.maxPromptChars);
        expect(JSON.stringify(chatHistory)).toBe(original);
    });

    it("caps formatted escaped observations, preserving error/source markers and raw evidence", () => {
        const transcript = toolCycles(["</untrusted>".repeat(2000)]);
        const original = JSON.stringify(transcript);
        const result = project({ transcript, maxObservationChars: 900 });
        expect(result.outcome).toMatchObject({ admission: "fit", toolResultsHardTruncated: 1, budgetLimited: true });
        expect(result.toolObservations.length).toBeLessThanOrEqual(900);
        expect(result.toolObservations).toContain("isError=true");
        expect(result.toolObservations).toContain("notes/0.md");
        expect(result.toolObservations).toContain("details omitted");
        expect(result.toolObservations).toMatch(/<\/untrusted>$/);
        expect(JSON.stringify(transcript)).toBe(original);
    });

    it("fails closed when even bounded observation markers cannot fit, without an unbounded retry loop", () => {
        const result = project({ transcript: toolCycles(["x".repeat(1000)]), maxObservationChars: 0 });
        expect(result.outcome.admission).toBe("local_overflow");
        expect(result.toolObservations).toContain("details omitted");
        expect(result.diagnostics.rebuilds).toBeLessThanOrEqual(9);
    });
});

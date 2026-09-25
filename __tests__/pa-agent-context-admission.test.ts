import { describe, expect, it } from "@jest/globals";

import { PaAgentContextManager } from "../src/ai-services/context";
import type { PaAgentContextManagerInput, PaAgentContextParts } from "../src/ai-services/context/PaAgentContextManager";
import type { PaAgentMessage } from "../src/ai-services/chat-types";
import {
    createPaAgentAnswerStreamPrompt,
    buildPaAgentFinalMessages,
    formatToolObservations,
    measurePaAgentRequestChars,
    measurePaAgentRequestEnvelope,
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
        measurePromptChars: (parts) => measurePaAgentRequestChars(requestVariables(parts), [],
            buildPaAgentFinalMessages(parts.input, parts.actionHistory, "native")),
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
    it("uses a documented window and output reserve for CJK and schema admission", () => {
        const facts = { contextWindowTokens: 900, outputReserveTokens: 200,
            contextWindowSource: "verified_metadata" as const, outputReserveSource: "verified_metadata" as const };
        const prompt = "中文约束".repeat(130);
        const schemas = [{ function: { name: "read", description: "字段".repeat(120) } }];
        const measured = measurePaAgentRequestEnvelope({ ...requestVariables(project()), input: prompt }, schemas);
        expect(measured.estimatedPromptTokens).toBeGreaterThan(Math.ceil(measured.promptChars / 4));
        const result = project({ prompt, modelBudgetFacts: facts,
            measurePromptEnvelope: parts => measurePaAgentRequestEnvelope(requestVariables(parts), schemas,
                buildPaAgentFinalMessages(parts.input, parts.actionHistory, "native")) });
        expect(result.budget.contextWindowTokens).toBe(900);
        expect(result.budget.outputReserveTokens).toBe(200);
        expect(result.budget.estimatedPromptTokens).toBeGreaterThan(result.budget.maxInputTokens!);
        expect(result.outcome.admission).toBe("local_overflow");
    });

    it("keeps an unknown window on the labelled character fallback and marks images estimated", () => {
        const measured = measurePaAgentRequestEnvelope({ ...requestVariables(project()), input: "中文" }, [],
            buildPaAgentFinalMessages("中文", [], "native"));
        expect(measured.estimateMethod).toBe("cjk_text_and_serialized_schema");
        const result = project({ modelBudgetFacts: { contextWindowSource: "unknown", outputReserveSource: "unknown" },
            measurePromptEnvelope: parts => measurePaAgentRequestEnvelope(requestVariables(parts), [],
                buildPaAgentFinalMessages(parts.input, parts.actionHistory, "native")) });
        expect(result.budget.maxInputTokens).toBeUndefined();
        expect(result.budget.admissionBasis).toBe("character_fallback");
        expect(result.budget.outputReserveTokens).toBeUndefined();
    });
    it("measures the actual LangChain messages once, including schemas and the local reserve", async () => {
        const projected = project({
            prompt: '中文 {input} </chat_history> \\ "quote"',
            transcript: toolCycles(["evidence </untrusted> {input}"]),
            availableSkills: "- name: test\n  description: {details}",
        });
        const variables = requestVariables(projected);
        const schemas = [{ type: "function", function: { name: "search_memory", description: "检索" } }];
        const outgoing = buildPaAgentFinalMessages(projected.input, projected.actionHistory, "native");
        const messages = await createPaAgentAnswerStreamPrompt().formatMessages({ ...variables, messages: outgoing });
        expect(measurePaAgentRequestChars(variables, schemas, outgoing)).toBe(
            String(messages[0].content).length + JSON.stringify(outgoing.map(message => message.toDict())).length
                + JSON.stringify(schemas).length + PA_AGENT_REQUEST_SAFETY_RESERVE_CHARS,
        );
        expect(messages[1].content).toBe(projected.input);
        expect(messages[0].content).not.toContain("evidence </untrusted>");
        expect(JSON.stringify(messages.slice(2))).toContain("evidence");
        expect(projected.toolObservations).toContain("<\\/untrusted>");
    });

    it("rejects mandatory schema or template overhead that raw variables alone would miss", () => {
        const baseline = project();
        const schemas = [{ description: "x".repeat(5000) }];
        const result = project({
            maxPromptChars: baseline.budget.promptChars + 100,
            measurePromptChars: (parts) => measurePaAgentRequestChars(requestVariables(parts), schemas,
                buildPaAgentFinalMessages(parts.input, parts.actionHistory, "native")),
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
        expect(result.outcome).toMatchObject({ admission: "local_overflow", historyCompressed: true, budgetLimited: true });
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
        expect(result.outcome).toMatchObject({ admission: "local_overflow", historyCompressed: false, toolResultsCompacted: 1 });
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
        expect(reduced.outcome).toMatchObject({ admission: "local_overflow", historyCompressed: true, budgetLimited: true });
        expect(reduced.input).not.toContain("adjacent-repeats-v1");
        expect(reduced.budget.promptChars).toBeLessThanOrEqual(reduced.budget.maxPromptChars);
        expect(JSON.stringify(chatHistory)).toBe(original);
    });

    it('does not answer a three-result comparison after masking the only first value', () => {
        const transcript = toolCycles([
            `Query one value: 42. ${'large closed background '.repeat(500)}`,
            'Query two value: 17.', 'Query three value: 9.',
        ]);
        const result = project({ prompt: 'Compare the three query values.', transcript,
            maxObservationChars: 1100 });
        expect(result.outcome.admission).toBe('local_overflow');
        expect(result.outcome.toolResultsCompacted + result.outcome.toolResultsHardTruncated)
            .toBeGreaterThan(0);
        expect(result.toolObservations).not.toContain('Query one value: 42.');
    });

    it("does not silently truncate a recent unclosed result when its formatted observation cannot fit", () => {
        const transcript = toolCycles(["</untrusted>".repeat(2000)]);
        const original = JSON.stringify(transcript);
        const result = project({ transcript, maxObservationChars: 900 });
        expect(result.outcome).toMatchObject({ admission: "local_overflow", toolResultsHardTruncated: 0 });
        expect(result.toolObservations).toContain('is_error="true"');
        expect(result.toolObservations).toContain("<\\/untrusted>");
        expect(result.toolObservations).toMatch(/<\/untrusted>$/);
        expect(JSON.stringify(transcript)).toBe(original);
    });

    it("rejects a narrow digest that drops an early offline-export constraint", () => {
        const chatHistory = [{ role: "user" as const,
            content: `${"background ".repeat(70)}Export must remain offline.` },
        { role: "assistant" as const, content: "Acknowledged." },
        ...Array.from({ length: 12 }, (_, i) => ([
            { role: "user" as const, content: `Unrelated question ${i}` },
            { role: "assistant" as const, content: `Unrelated answer ${i}` },
        ])).flat()];
        const result = project({ chatHistory, maxHistoryChars: 1800 });
        expect(result.outcome.admission).toBe("local_overflow");
        expect(result.input).not.toContain("Export must remain offline.");
        expect(result.history.summaryChars + result.history.omittedCount).toBeGreaterThan(0);
    });

    it("fails closed when even bounded observation markers cannot fit, without an unbounded retry loop", () => {
        const result = project({ transcript: toolCycles(["x".repeat(1000)]), maxObservationChars: 0 });
        expect(result.outcome.admission).toBe("local_overflow");
        expect(result.outcome.toolResultsHardTruncated).toBe(0);
        expect(result.toolObservations).toContain("x".repeat(1000));
        expect(result.diagnostics.rebuilds).toBeLessThanOrEqual(9);
    });
});

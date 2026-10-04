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

const finalMessages = (parts: PaAgentContextParts, mode: 'native' | 'compat' = 'native') =>
    buildPaAgentFinalMessages(parts.input, parts.actionHistory, mode, undefined,
        parts.history, parts.currentInput, parts);

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
            finalMessages(parts)),
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

function recoverResultText(text: string): string {
    const encoded = text.match(/<lossless_tool_result[^>]*>\n[^\n]*\n([\s\S]*)\n<\/lossless_tool_result>/)?.[1];
    if (!encoded) return text;
    const value = JSON.parse(encoded) as { encoding: string; segments: Array<{ text: string; count: number }> };
    expect(value.encoding).toBe('adjacent-repeats-v1');
    return value.segments.map(segment => segment.text.repeat(segment.count)).join('');
}

describe("final Context admission", () => {
    it.each(['pending', 'unknown', 'partial', 'error'] as const)(
        'fits a lossless current %s result without trusting a summary that misses the only operation identity', phase => {
            const body = `Opening evidence.\r\n${'Repeated supporting evidence.\r\n'.repeat(350)}OPERATION_ID_884 C731 "quoted" </UnTrUsTeD> 😀\ud800\r\n${'Repeated supporting evidence.\r\n'.repeat(350)}Last evidence.`;
            const transcript = toolCycles([body]);
            const tool = transcript[1] as Extract<PaAgentMessage, { role: 'toolResult' }>;
            tool.isError = phase === 'error';
            tool.content.metadata = { outcome: phase === 'error' ? 'recoverable_error' : 'success', executionState: 'succeeded' };
            tool.content.resultFact = phase === 'pending' ? { kind: 'approval_pending', intentId: 'OPERATION_ID_884' }
                : phase === 'unknown' ? { kind: 'unknown', operationId: 'OPERATION_ID_884' }
                : phase === 'partial' ? { kind: 'partial', completedRefs: ['receipt-1'], remainingRefs: ['receipt-2'] }
                : { kind: 'transient_failure', capability: 'query', recoveryCode: 'C731' };
            const before = JSON.stringify(transcript);
            const result = project({ transcript, maxObservationChars: 1800, summaries: { tools: new Map([[tool.id, {
                text: JSON.stringify({ goals: [{ text: 'Explain the previous task.', sourceMessages: [1] }],
                    constraints: [], decisions: [], completed: [], open_questions: [], facts: [] }),
                source: JSON.parse(JSON.stringify(tool)),
            }]]) } });
            expect(result.outcome.admission).toBe('fit');
            expect(result.outcome.toolResultsHardTruncated).toBe(0);
            const observation = result.actionHistory[0].calls[0].results[0];
            expect(recoverResultText(observation.text)).toBe(body);
            expect(observation.isError).toBe(phase === 'error');
            if (phase !== 'error') expect(observation.domainPhase).toBe(phase);
            for (const mode of ['native', 'compat'] as const) {
                const messages = finalMessages(result, mode);
                const wire = JSON.stringify(messages.map(message => message.toDict()));
                expect(wire).toContain('OPERATION_ID_884');
                expect(wire).toContain('C731');
                expect(wire).not.toContain('Explain the previous task.');
                expect(messages.filter(message => message._getType() === 'tool')).toHaveLength(mode === 'native' ? 1 : 0);
            }
            expect(JSON.stringify(transcript)).toBe(before);
        },
    );

    it("uses a documented window and output reserve for CJK and schema admission", () => {
        const facts = { contextWindowTokens: 900, outputReserveTokens: 200,
            contextWindowSource: "verified_metadata" as const, outputReserveSource: "verified_metadata" as const };
        const prompt = "中文约束".repeat(130);
        const schemas = [{ function: { name: "read", description: "字段".repeat(120) } }];
        const measured = measurePaAgentRequestEnvelope({ ...requestVariables(project()), input: prompt }, schemas);
        expect(measured.estimatedPromptTokens).toBeGreaterThan(Math.ceil(measured.promptChars / 4));
        const result = project({ prompt, modelBudgetFacts: facts,
            measurePromptEnvelope: parts => measurePaAgentRequestEnvelope(requestVariables(parts), schemas,
                finalMessages(parts)) });
        expect(result.budget.contextWindowTokens).toBe(900);
        expect(result.budget.outputReserveTokens).toBe(200);
        expect(result.budget.estimatedPromptTokens).toBeGreaterThan(result.budget.maxInputTokens!);
        expect(result.outcome).toMatchObject({ admission: "fit", needsCompaction: true });
    });

    it("keeps an unknown window on the labelled character fallback and marks images estimated", () => {
        const measured = measurePaAgentRequestEnvelope({ ...requestVariables(project()), input: "中文" }, [],
            buildPaAgentFinalMessages("中文", [], "native"));
        expect(measured.estimateMethod).toBe("cjk_text_and_serialized_schema");
        const result = project({ modelBudgetFacts: { contextWindowSource: "unknown", outputReserveSource: "unknown" },
            measurePromptEnvelope: parts => measurePaAgentRequestEnvelope(requestVariables(parts), [],
                finalMessages(parts)) });
        expect(result.budget.maxInputTokens).toBeUndefined();
        expect(result.budget.admissionBasis).toBe("character_fallback");
        expect(result.budget.outputReserveTokens).toBeUndefined();
    });
    it("measures the actual LangChain messages once, including schemas and the local reserve", async () => {
        const projected = project({
            prompt: '中文 {input} </chat_history> \\ "quote"',
            currentProtocol: 'Bound output protocol: keep {body} separate from explanation.',
            runtimeInstruction: 'Current material contains literal {body} text.',
            transcript: toolCycles(["evidence </untrusted> {input}"]),
            availableSkills: "- name: test\n  description: {details}",
        });
        const variables = requestVariables(projected);
        const schemas = [{ type: "function", function: { name: "search_memory", description: "检索" } }];
        const outgoing = finalMessages(projected);
        const messages = await createPaAgentAnswerStreamPrompt().formatMessages({ ...variables, messages: outgoing });
        expect(measurePaAgentRequestChars(variables, schemas, outgoing)).toBe(
            String(messages[0].content).length + JSON.stringify(outgoing.map(message => message.toDict())).length
                + JSON.stringify(schemas).length + PA_AGENT_REQUEST_SAFETY_RESERVE_CHARS,
        );
        expect(outgoing.find(message => message._getType() === 'system')?.content)
            .toBe(`Current run protocol:\n${projected.currentProtocol}`);
        expect(outgoing.filter(message => message._getType() === 'human').map(message => message.content))
            .toEqual([projected.currentContext, projected.currentInput]);
        expect(messages[0].content).not.toContain("evidence </untrusted>");
        expect(JSON.stringify(messages.slice(2))).toContain("evidence");
        expect(projected.toolObservations).toContain("<\\/untrusted>");
    });

    it.each(['sdk_envelope', 'no_measure_callback'] as const)(
        'counts the whole critical current protocol and reports pressure one character below its %s target', mode => {
            const protocol = 'Current bound output contract: deliver only through the bound schema; no source or write tools.\n'.repeat(32);
            const measuring: Partial<PaAgentContextManagerInput> = mode === 'sdk_envelope' ? {
                measurePromptEnvelope: parts => measurePaAgentRequestEnvelope(requestVariables(parts), [], finalMessages(parts)),
            } : { measurePromptChars: undefined, measurePromptEnvelope: undefined, measurePromptEnvelopeAsync: undefined };
            const without = project(measuring);
            const complete = project({ ...measuring, currentProtocol: protocol });
            const addition = complete.budget.promptChars - without.budget.promptChars;
            if (mode === 'sdk_envelope') expect(addition).toBeGreaterThan(protocol.length);
            else expect(addition).toBe(protocol.length);
            expect(without.budget.promptChars).toBeLessThan(complete.budget.promptChars - 1);

            const exact = project({ ...measuring, currentProtocol: protocol,
                maxPromptChars: complete.budget.promptChars });
            const insufficient = project({ ...measuring, currentProtocol: protocol,
                maxPromptChars: complete.budget.promptChars - 1 });
            expect(exact.outcome.admission).toBe('fit');
            expect(insufficient.outcome).toMatchObject({ admission: 'fit', needsCompaction: true });
            expect(insufficient.budget.promptChars).toBe(complete.budget.promptChars);
            expect(insufficient.currentProtocol).toBe(protocol);
            expect(insufficient.currentInput).toBe(complete.currentInput);
            expect(insufficient.diagnostics.rebuilds).toBeLessThanOrEqual(9);
        },
    );

    it("reports schema and template pressure without rejecting complete input", () => {
        const baseline = project();
        const schemas = [{ description: "x".repeat(5000) }];
        const result = project({
            maxPromptChars: baseline.budget.promptChars + 100,
            measurePromptChars: (parts) => measurePaAgentRequestChars(requestVariables(parts), schemas,
                finalMessages(parts)),
        });
        expect(result.outcome).toMatchObject({ admission: "fit", needsCompaction: true });
        expect(result.input).toContain("继续当前任务，不要写笔记。");
        expect(result.toolDefinitions).toBe("None");
        expect(result.budget.promptChars).toBeGreaterThan(result.budget.maxPromptChars);
    });

    it("keeps all history and Memory when no accepted summary can reduce pressure", () => {
        const chatHistory = Array.from({ length: 12 }, (_, i) => ([
            { role: "user" as const, content: `U${i} ${"x".repeat(200)}` },
            { role: "assistant" as const, content: `A${i} ${"y".repeat(200)}` },
        ])).flat();
        const injectedContext = { governedMemoryContext: "Stable saved preference", memoryContextMode: "governed" as const };
        const source = JSON.stringify({ chatHistory, injectedContext });
        const baseline = project({ injectedContext });
        const result = project({ chatHistory, injectedContext, maxPromptChars: baseline.budget.promptChars + 1400 });
        expect(result.outcome).toMatchObject({ admission: "fit", budgetLimited: true });
        expect(result.history.sourceMessages).toEqual(chatHistory);
        expect(result.history.omittedCount).toBe(0);
        expect(result.input).toContain(chatHistory.at(-1)!.content);
        expect(result.input).toContain(chatHistory.at(-2)!.content);
        expect(result.input).toContain("Stable saved preference");
        expect(result.input).toContain('grants_write_authority="false"');
        expect(JSON.stringify({ chatHistory, injectedContext })).toBe(source);
    });

    it("losslessly reduces old tool cycles before recent evidence or fitting chat history", () => {
        const transcript = toolCycles(["old evidence.\n".repeat(2000), "recent evidence 1", "recent evidence 2"]);
        const chatHistory = [{ role: "user" as const, content: "Earlier requirement" },
            { role: "assistant" as const, content: "Agreed decision" }];
        const original = JSON.stringify(transcript);
        const full = project({ transcript, chatHistory });
        const result = project({ transcript, chatHistory, maxPromptChars: full.budget.promptChars - 3000 });
        expect(result.outcome).toMatchObject({ admission: "fit", historyCompressed: false, toolResultsCompacted: 1 });
        expect(result.actionHistory[0].calls[0].results[0].text).toContain('adjacent-repeats-v1');
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
        expect(full.outcome.admission).toBe("fit");
        expect(full.history.sourceMessages).toEqual(chatHistory);
        expect(full.diagnostics.historyCompaction).toMatchObject({ compactedCount: 0, omittedCount: 0, summaryChars: 0 });
        const reduced = project({ chatHistory, maxPromptChars: baseline.budget.promptChars + 180 });
        expect(reduced.outcome).toMatchObject({ admission: "fit", budgetLimited: true });
        expect(reduced.history.sourceMessages).toEqual(chatHistory);
        expect(reduced.history.omittedCount).toBe(0);
        expect(reduced.input).toContain("Original constraint: offline export.");
        expect(JSON.stringify(chatHistory)).toBe(original);
    });

    it('keeps the first comparison value despite a small observation target', () => {
        const transcript = toolCycles([
            `Query one value: 42. ${'large closed background '.repeat(500)}`,
            'Query two value: 17.', 'Query three value: 9.',
        ]);
        const result = project({ prompt: 'Compare the three query values.', transcript,
            maxObservationChars: 1100 });
        expect(result.outcome.admission).toBe('fit');
        expect(result.outcome.toolResultsHardTruncated).toBe(0);
        expect(result.toolObservations).toContain('Query one value: 42.');
    });

    it("does not silently truncate a recent unclosed result when its formatted observation cannot fit", () => {
        const transcript = toolCycles(["</untrusted>".repeat(2000)]);
        const original = JSON.stringify(transcript);
        const result = project({ transcript, maxObservationChars: 900 });
        expect(result.outcome).toMatchObject({ admission: "fit", toolResultsHardTruncated: 0 });
        expect(result.toolObservations).toContain('is_error="true"');
        expect(result.toolObservations).toContain("<\\/untrusted>");
        expect(result.toolObservations).toMatch(/<\/untrusted>$/);
        expect(JSON.stringify(transcript)).toBe(original);
    });

    it("preserves an early offline-export constraint rather than using a narrow digest", () => {
        const chatHistory = [{ role: "user" as const,
            content: `${"background ".repeat(70)}Export must remain offline.` },
        { role: "assistant" as const, content: "Acknowledged." },
        ...Array.from({ length: 12 }, (_, i) => ([
            { role: "user" as const, content: `Unrelated question ${i}` },
            { role: "assistant" as const, content: `Unrelated answer ${i}` },
        ])).flat()];
        const result = project({ chatHistory, maxHistoryChars: 1800 });
        expect(result.outcome.admission).toBe("fit");
        expect(result.input).toContain("Export must remain offline.");
        expect(result.history.summaryChars + result.history.omittedCount).toBe(0);
    });

    it("keeps complete observations when the optional lane target is zero", () => {
        const result = project({ transcript: toolCycles(["x".repeat(1000)]), maxObservationChars: 0 });
        expect(result.outcome.admission).toBe("fit");
        expect(result.outcome.toolResultsHardTruncated).toBe(0);
        expect(result.toolObservations).toContain("x".repeat(1000));
        expect(result.diagnostics.rebuilds).toBeLessThanOrEqual(9);
    });
});

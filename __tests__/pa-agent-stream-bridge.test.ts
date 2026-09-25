import { describe, expect, it } from "@jest/globals";
import { AgentEventEmitter } from "../src/ai-services/agent-runtime-primitives";
import type { AgentEvent, LegacyAgentEvent, ProviderCompletion } from "../src/ai-services/chat-types";
import { PaAgentLoop } from "../src/ai-services/pa-agent-loop";
import { createRequiredCapabilityHostPolicy } from "../src/ai-services/pa-agent-required-capability-policy";
import { streamWithInvokeFallback } from "../src/ai-services/pa-agent-runtime";
import { CanonicalToLegacyEventAdapter, type WritingDeliveryDiagnostic } from "../src/ai-services/pa-agent-stream-bridge";
import type { GenerationInputSnapshot } from "../src/ai-services/generation-input-snapshot";

const request = { requestId: "b135-writing-tail" };
const body = "  原样正文：海风 🌊\r\n\t";
const envelope = JSON.stringify({ kind: "pa.writing", version: 1, requestId: request.requestId, body, explanation: "说明" });

async function runWritingTail(input: { raw?: string; completion?: ProviderCompletion; current?: boolean; omitFinish?: boolean; revokeAfterContent?: boolean; failDiagnostic?: boolean; generationInput?: GenerationInputSnapshot; native?: boolean }) {
    const events: LegacyAgentEvent[] = [];
    const diagnostics: WritingDeliveryDiagnostic[] = [];
    const adapter = new CanonicalToLegacyEventAdapter(new AgentEventEmitter((event) => events.push(event)), undefined, {
        request,
        maxTextChars: 10_000,
        isCurrent: () => input.current !== false,
        ...(input.native ? { nativeContextHandle: request.requestId } : {}),
        ...(input.generationInput ? { getGenerationInputSnapshot: () => input.generationInput } : {}),
        onDiagnostic: (diagnostic) => {
            expect(events.some((event) => event.kind === "writing-recovery" || event.kind === "writing-artifact")).toBe(false);
            diagnostics.push(diagnostic);
            if (input.failDiagnostic) throw new Error("local debug sink unavailable");
        },
    });
    const loop = new PaAgentLoop({
        runId: "b135-writing-tail-run",
        userInput: "Write a short draft.",
        writingRequest: request,
        model: {
            stream: () => streamWithInvokeFallback({
                input: {},
                chain: {
                    stream: async function* () {
                        yield {
                            content: [{ type: "text", text: input.raw ?? envelope }],
                            ...(input.omitFinish ? {} : { response_metadata: { finish_reason: input.completion ?? "stop" } }),
                        };
                        if (input.revokeAfterContent) input.current = false;
                        throw new Error("transport tail failed");
                    },
                    invoke: async () => { throw new Error("must not generate a second draft"); },
                },
            }),
        },
        onEvent: (event) => adapter.handle(event),
    });
    return { result: await loop.run(), events, diagnostics };
}

describe("B-135 writing completion across adapter, loop and legacy bridge", () => {
    it.each([true, false])('emits ordinary answer snapshots only after source-checked commit: %s', async remainsCurrent => {
        const events: LegacyAgentEvent[] = [];
        let sourceCurrent = true;
        const adapter = new CanonicalToLegacyEventAdapter(new AgentEventEmitter(event => events.push(event)));
        const result = await new PaAgentLoop({
            runId: `ordinary-source-${remainsCurrent}`,
            userInput: 'Answer from the note.',
            isFinalTextCurrent: () => sourceCurrent,
            model: { stream: async function* () {
                yield { type: 'text_delta', text: 'Source-derived answer.' } as const;
                yield { type: 'provider_completion', completion: 'stop' } as const;
                if (!remainsCurrent) sourceCurrent = false;
            } },
            onEvent: event => adapter.handle(event),
            onCommittedFinalText: snapshot => adapter.syncCommittedAnswer(snapshot),
        }).run();
        expect(result.status).toBe(remainsCurrent ? 'completed' : 'incomplete');
        expect(events.filter(event => event.kind === 'answer-snapshot').map(event => event.snapshot))
            .toEqual(remainsCurrent ? ['Source-derived answer.'] : []);
    });

    it.each([false, true])("withdraws a malformed tool phase through the real loop and host policy (native preview: %s)", async native => {
        const text = "I need to read the note.\n<tool_calls>\n</tool_calls>";
        const events: LegacyAgentEvent[] = [];
        const adapter = new CanonicalToLegacyEventAdapter(new AgentEventEmitter(event => events.push(event)), undefined,
            native ? { request, nativeContextHandle: request.requestId, maxTextChars: 10000, isCurrent: () => true } : undefined);
        const { hostPolicy } = createRequiredCapabilityHostPolicy();
        const loop = new PaAgentLoop({ runId: "missing-native-call", userInput: "Explain this idea.",
            hostPolicy, model: { stream: async function* () {
                yield { type: "text_delta", text };
                yield { type: "provider_completion", completion: "tool_calls" };
            } }, onEvent: event => adapter.handle(event),
        });
        const result = await loop.run();
        expect(result.status).toBe("incomplete");
        expect(result.committedFinalText).toBe("");
        expect(result.endPayload?.diagnostics).toContainEqual({ type: "provider_tool_calls_missing" });
        expect(events.filter(event => event.kind === "answer-snapshot" || event.kind === "writing-artifact"
            || event.kind === "writing-recovery")).toEqual([]);
        expect(events.filter(event => event.kind === "writing-preview").map(event => event.text))
            .toEqual(native ? [text, ""] : []);
    });

    it("preserves a literal XML example through native ordinary preview and final delivery", async () => {
        const text = "XML example: `<tool_calls></tool_calls>`.";
        const { result, events } = await runWritingTail({ native: true, raw: text, completion: "stop" });
        expect(result.status).toBe("completed");
        expect(events.filter(event => event.kind === "writing-preview").map(event => event.text)).toEqual([text]);
        expect(events.filter(event => event.kind === "answer-snapshot")).toEqual([
            expect.objectContaining({ snapshot: text }),
        ]);
    });

    it("keeps a missing native call incomplete without predicting a required capability", async () => {
        const { hostPolicy } = createRequiredCapabilityHostPolicy();
        const result = await new PaAgentLoop({ runId: "required-missing-native", userInput: "Read the current note.",
            hostPolicy, model: { stream: async function* () {
                yield { type: "text_delta", text: "<tool_calls></tool_calls>" };
                yield { type: "provider_completion", completion: "tool_calls" };
            } },
        }).run();
        expect(result.status).toBe("incomplete");
        expect(result.committedFinalText).toBe("");
        expect(result.turns).toHaveLength(1);
        expect(result.turns.every(turn => turn.status === "incomplete")).toBe(true);
    });
    it.each(["current", "revoked", "cancelled"] as const)(
        "keeps final native ordinary delivery consistent after an awaited host policy: %s",
        async scenario => {
            let sourceCurrent = true;
            let enterPolicy!: () => void;
            let releasePolicy!: () => void;
            const policyEntered = new Promise<void>(resolve => { enterPolicy = resolve; });
            const policyReleased = new Promise<void>(resolve => { releasePolicy = resolve; });
            const controller = new AbortController();
            const events: LegacyAgentEvent[] = [];
            const lifecycle: AgentEvent[] = [];
            const committedSnapshots: string[] = [];
            const adapter = new CanonicalToLegacyEventAdapter(
                new AgentEventEmitter(event => events.push(event)),
                event => lifecycle.push(event),
                {
                    request,
                    nativeContextHandle: request.requestId,
                    maxTextChars: 10_000,
                    isCurrent: () => sourceCurrent && !controller.signal.aborted,
                    isPreviewCurrent: () => sourceCurrent,
                },
            );
            const loop = new PaAgentLoop({
                runId: `late-native-ordinary-${scenario}`,
                userInput: "Explain the idea.",
                signal: controller.signal,
                writingRequest: request,
                isFinalTextCurrent: () => sourceCurrent,
                onCommittedFinalText: text => committedSnapshots.push(text),
                model: {
                    stream: async function* () {
                        yield { type: "text_delta", text: body };
                        yield { type: "provider_completion", completion: "stop" };
                    },
                },
                hostPolicy: {
                    afterTurn: async () => {
                        enterPolicy();
                        await policyReleased;
                        return { action: "stop", status: "completed", reason: "answer_ready" };
                    },
                },
                onEvent: event => adapter.handle(event),
            });
            const running = loop.run();
            await policyEntered;
            expect(lifecycle.filter(event => event.type === "turn_end")).toEqual([
                expect.objectContaining({ status: "completed" }),
            ]);
            expect(committedSnapshots).toEqual([body]);
            if (scenario !== "current") sourceCurrent = false;
            if (scenario === "cancelled") controller.abort();
            releasePolicy();
            const result = await running;
            const status = scenario === "current" ? "completed" : scenario === "cancelled" ? "aborted" : "incomplete";
            expect(result.status).toBe(status);
            expect(lifecycle.filter(event => event.type === "agent_end")).toEqual([
                expect.objectContaining({ status }),
            ]);
            expect(events.filter(event => event.kind === "writing-artifact")).toEqual([]);
            if (scenario === "current") {
                expect(result.committedFinalText).toBe(body);
                expect(committedSnapshots).toEqual([body]);
                expect(events.filter(event => event.kind === "answer-snapshot")).toEqual([
                    expect.objectContaining({ snapshot: body }),
                ]);
                expect(events.filter(event => event.kind === "writing-recovery")).toEqual([]);
            } else {
                expect(result.committedFinalText).toBe("");
                expect(committedSnapshots).toEqual([body, ""]);
                expect(events.filter(event => event.kind === "answer-snapshot")).toEqual([]);
                expect(events.filter(event => event.kind === "writing-preview").map(event => event.text)).toEqual([body, ""]);
                expect(events.filter(event => event.kind === "writing-recovery")).toEqual([]);
                expect(lifecycle.find(event => event.type === "agent_end")?.metadata?.diagnostics).toEqual(
                    expect.arrayContaining([expect.objectContaining({ type: "assistant_source_changed" })]),
                );
            }
        },
    );

    it("delivers source-current native ordinary text without creating an artifact or recovery", async () => {
        const { events, diagnostics } = await runWritingTail({ native: true, raw: body });
        expect(events.filter(event => event.kind === "answer-snapshot")).toEqual([
            expect.objectContaining({ snapshot: body }),
        ]);
        expect(events.filter(event => event.kind === "writing-preview").map(event => event.text)).toEqual([body]);
        expect(events.filter(event => event.kind === "writing-artifact" || event.kind === "writing-recovery")).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it.each(["after-content", "before-content"] as const)(
        "keeps native ordinary text revoked %s out of Writing recovery",
        async phase => {
            const { events, diagnostics } = await runWritingTail({ native: true, raw: body,
                ...(phase === "after-content" ? { revokeAfterContent: true } : { current: false }),
            });
            expect(events.filter(event => event.kind === "writing-preview").map(event => event.text))
                .toEqual(phase === "after-content" ? [body, ""] : []);
            const recoveries = events.filter(event => event.kind === "writing-recovery");
            expect(recoveries).toEqual([]);
            expect(events.filter(event => event.kind === "answer-snapshot" || event.kind === "writing-artifact")).toEqual([]);
            expect(diagnostics).toEqual([]);
            expect(JSON.stringify({ recoveries, diagnostics })).not.toContain("海风");
        },
    );

    it("does not turn a local diagnostic failure into a delivery failure", async () => {
        const { result, events } = await runWritingTail({ failDiagnostic: true });
        expect(result.status).toBe("completed");
        expect(events.filter((event) => event.kind === "writing-artifact")).toHaveLength(1);
        expect(events.filter((event) => event.kind === "writing-recovery")).toHaveLength(0);
    });
    it.each([
        { input: {}, completion: "stop", schema: "valid", result: "artifact" },
        { input: { omitFinish: true }, completion: "unknown", schema: "valid", result: "incomplete" },
        { input: { raw: envelope.slice(0, -1) }, completion: "stop", schema: "invalid", result: "invalid_output" },
    ])("records independent finish and structure evidence before projection: $result", async ({ input, completion, schema, result }) => {
        const { diagnostics, result: loopResult } = await runWritingTail(input);
        expect(diagnostics).toEqual([{
            runId: "b135-writing-tail-run", requestId: request.requestId,
            messageId: expect.any(String), turnId: expect.any(String),
            stage: "writing_projection", timestamp: expect.any(Number),
            runStatus: loopResult.status, stopReason: input.omitFinish ? "error" : "stop",
            providerCompletion: completion, transportOutcome: "error",
            schemaState: schema, textChars: (input.raw ?? envelope).length,
            maxTextChars: 10_000, result,
        }]);
        expect(JSON.stringify(diagnostics)).not.toContain(body);
        expect(JSON.stringify(diagnostics)).not.toContain("transport tail failed");
    });
    it("creates one exact artifact when the complete JSON and stop precede a transport failure", async () => {
        const { result, events } = await runWritingTail({});
        expect(result.status).toBe("completed");
        expect(events.filter((event) => event.kind === "writing-artifact")).toEqual([
            expect.objectContaining({ requestId: request.requestId, body, explanation: "说明" }),
        ]);
        expect(events.filter((event) => event.kind === "writing-recovery")).toEqual([]);
        expect(events.filter((event) => event.kind === "writing-preview")).toEqual([
            expect.objectContaining({ requestId: request.requestId, text: body }),
        ]);
        expect(result.turns[0].metrics).toContainEqual(expect.objectContaining({
            type: "provider_transport_end", outcome: "error",
        }));
    });

    it.each([{ omitFinish: false, kind: 'writing-artifact' }, { omitFinish: true, kind: 'writing-recovery' }] as const)(
        'clones the physical input snapshot before emitting $kind',
        async ({ omitFinish, kind }) => {
            const generationInput: GenerationInputSnapshot = {
                schemaVersion: 1, inputPurpose: 'writing', task: { state: 'none', sources: [] },
                personal: { state: 'none' }, insights: { state: 'none' },
                style: { state: 'identified', revisionIds: ['style-1'] }, images: [],
                parent: { state: 'none' }, pagelet: { state: 'none' },
            };
            const { events } = await runWritingTail({ omitFinish, generationInput });
            const delivered = events.find(event => event.kind === kind);
            expect(delivered).toMatchObject({ generationInput });
            generationInput.style = { state: 'identified', revisionIds: ['mutated'] };
            expect(delivered).toMatchObject({ generationInput: {
                style: { state: 'identified', revisionIds: ['style-1'] },
            } });
        },
    );

    it("withdraws a preview when the host source guard changes before recovery", async () => {
        const { events } = await runWritingTail({ revokeAfterContent: true, omitFinish: true });
        expect(events.filter((event) => event.kind === "writing-preview").map((event) => event.text)).toEqual([body, ""]);
        expect(events.filter((event) => event.kind === "writing-recovery")).toEqual([
            expect.objectContaining({ previewText: "", rawText: "", reason: "source_changed" }),
        ]);
        expect(events.filter((event) => event.kind === "writing-artifact")).toEqual([]);
    });

    it("keeps the decoded body prefix readable without repairing a truncated envelope into an artifact", async () => {
        const raw = `{"kind":"pa.writing","version":1,"requestId":"${request.requestId}","body":"  海风\\n还没结束`;
        const { events } = await runWritingTail({ raw, omitFinish: true });
        expect(events.filter((event) => event.kind === "writing-recovery")).toEqual([
            expect.objectContaining({ rawText: raw, previewText: "  海风\n还没结束" }),
        ]);
        expect(events.filter((event) => event.kind === "writing-artifact")).toEqual([]);
    });

    it.each([
        { label: "invalid JSON", raw: envelope.slice(0, -1), reason: "invalid_output" },
        { label: "revoked source", current: false, reason: "source_changed" },
        { label: "length finish", completion: "length" as const, reason: "incomplete" },
        { label: "missing finish", omitFinish: true, reason: "incomplete" },
    ])("does not promote $label merely because some text was received", async ({ label: _label, reason, ...input }) => {
        const { events } = await runWritingTail(input);
        expect(events.filter((event) => event.kind === "writing-artifact")).toEqual([]);
        expect(events.filter((event) => event.kind === "writing-recovery")).toEqual([
            expect.objectContaining({ rawText: reason === "source_changed" ? "" : input.raw ?? envelope, reason }),
        ]);
    });
});

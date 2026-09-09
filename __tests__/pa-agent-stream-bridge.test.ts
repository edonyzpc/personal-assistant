import { describe, expect, it } from "@jest/globals";
import { AgentEventEmitter } from "../src/ai-services/agent-runtime-primitives";
import type { LegacyAgentEvent, ProviderCompletion } from "../src/ai-services/chat-types";
import { PaAgentLoop } from "../src/ai-services/pa-agent-loop";
import { streamWithInvokeFallback } from "../src/ai-services/pa-agent-runtime";
import { CanonicalToLegacyEventAdapter, type WritingDeliveryDiagnostic } from "../src/ai-services/pa-agent-stream-bridge";

const request = { requestId: "b135-writing-tail" };
const body = "  原样正文：海风 🌊\r\n\t";
const envelope = JSON.stringify({ kind: "pa.writing", version: 1, requestId: request.requestId, body, explanation: "说明" });

async function runWritingTail(input: { raw?: string; completion?: ProviderCompletion; current?: boolean; omitFinish?: boolean; revokeAfterContent?: boolean; failDiagnostic?: boolean }) {
    const events: LegacyAgentEvent[] = [];
    const diagnostics: WritingDeliveryDiagnostic[] = [];
    const adapter = new CanonicalToLegacyEventAdapter(new AgentEventEmitter((event) => events.push(event)), undefined, {
        request,
        maxTextChars: 10_000,
        isCurrent: () => input.current !== false,
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

    it("withdraws a preview when the host source guard changes before recovery", async () => {
        const { events } = await runWritingTail({ revokeAfterContent: true, omitFinish: true });
        expect(events.filter((event) => event.kind === "writing-preview").map((event) => event.text)).toEqual([body, ""]);
        expect(events.filter((event) => event.kind === "writing-recovery")).toEqual([
            expect.objectContaining({ previewText: "" }),
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
            expect.objectContaining({ rawText: input.raw ?? envelope, reason }),
        ]);
    });
});

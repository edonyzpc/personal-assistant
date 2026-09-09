import { describe, expect, it } from "@jest/globals";
import { AgentEventEmitter } from "../src/ai-services/agent-runtime-primitives";
import { PaAgentLoop } from "../src/ai-services/pa-agent-loop";
import { streamWithInvokeFallback } from "../src/ai-services/pa-agent-runtime";
import { CanonicalToLegacyEventAdapter } from "../src/ai-services/pa-agent-stream-bridge";
import type { AgentEvent, LegacyAgentEvent } from "../src/ai-services/chat-types";
import trace from "./fixtures/b135-native-identity-trace.json";
import currentSchemaTrace from "./fixtures/b135-current-schema-trace.json";
import { nativeWritingOutputSchema, nativeWritingOutputInstruction } from "../src/ai-services/writing-output";

const request = { requestId: "bridge-request" };
const handle = "b135-identity";
const raw = trace.deltas.map((delta) => delta.args).join("");
const body = JSON.parse(raw).body as string;

async function run(options: { truncate?: boolean; revoke?: boolean; mixed?: boolean; ordinary?: boolean; denyProof?: boolean; cancel?: boolean; preamble?: string;
    cancelClosesCurrent?: boolean; previewCurrent?: () => boolean; deltas?: unknown[]; contextHandle?: string } = {}) {
    const contextHandle = options.contextHandle ?? handle;
    const events: LegacyAgentEvent[] = [];
    const lifecycle: AgentEvent[] = [];
    const controller = new AbortController();
    let current = true;
    const adapter = new CanonicalToLegacyEventAdapter(new AgentEventEmitter((event) => events.push(event)), undefined, {
        request, nativeContextHandle: contextHandle, maxTextChars: 20_000, isCurrent: () => current,
        isPreviewCurrent: options.previewCurrent,
    });
    const loop = new PaAgentLoop({
        runId: "native-bridge", userInput: "Synthetic writing", signal: controller.signal,
        nativeWriting: { contextHandle, maxTextChars: 20_000, isCurrent: () => current },
        model: { stream: () => streamWithInvokeFallback({ input: {}, captureToolIdentity: true, chain: {
            stream: async function* () {
                if (options.ordinary) {
                    yield { content: "A normal answer.", response_metadata: { finish_reason: "stop" } };
                    return;
                }
                const sourceDeltas = options.deltas ?? trace.deltas;
                const deltas = options.truncate || options.cancel ? sourceDeltas.slice(0, 6) : sourceDeltas;
                if (options.preamble) yield { content: options.preamble };
                for (const delta of deltas) yield { tool_call_chunks: [delta] };
                if (options.cancel) {
                    if (options.cancelClosesCurrent) current = false;
                    controller.abort();
                }
                if (options.mixed) yield { tool_call_chunks: [{ id: "other", index: 1, name: "read_file", args: "{}" }] };
                if (!options.truncate) yield { response_metadata: { finish_reason: "tool_calls" } };
            },
            invoke: async () => { throw new Error("no additional generation"); },
        } }) },
        hostPolicy: { afterTurn: async () => {
            if (options.revoke) current = false;
            return { action: "stop", status: "completed", reason: "host checked" };
        } },
        onEvent: (event) => {
            lifecycle.push(event);
            adapter.handle(options.denyProof && event.type === "message_end"
                ? { ...event, metadata: {} } : event);
        },
    });
    const result = await loop.run();
    for (const event of lifecycle) adapter.handle(event);
    return { result, events };
}

describe("native writing bridge host gates", () => {
    it("replays the real current-schema response through adapter, loop, preview and one artifact", async () => {
        const currentRequest = { requestId: 'b135-current-schema' };
        expect(currentSchemaTrace.declaration.schema).toEqual(nativeWritingOutputSchema(currentRequest));
        expect(currentSchemaTrace.declaration.instruction).toBe(nativeWritingOutputInstruction(currentRequest));
        expect(currentSchemaTrace.finishes).toEqual(['tool_calls']);
        const { result, events } = await run({ contextHandle: currentRequest.requestId,
            deltas: currentSchemaTrace.deltas, preamble: currentSchemaTrace.text || undefined,
        });
        expect(result.status).toBe('completed');
        expect(events.filter((event) => event.kind === 'writing-artifact')).toEqual([
            expect.objectContaining({ body: currentSchemaTrace.expected }),
        ]);
        expect(events.filter((event) => event.kind === 'writing-preview').some((event) =>
            event.text.length > 0 && event.text.length < currentSchemaTrace.expected.length)).toBe(true);
        expect(events.some((event) => event.kind === 'writing-recovery')).toBe(false);
    });
    it("retains permitted partial text when cancellation closes generation but not the preview source", async () => {
        const { events } = await run({ cancel: true, cancelClosesCurrent: true, previewCurrent: () => true });
        expect(events.filter((event) => event.kind === "writing-artifact")).toHaveLength(0);
        expect(events.filter((event) => event.kind === "writing-recovery")).toEqual([
            expect.objectContaining({ reason: "incomplete", previewText: expect.stringContaining("第一行") }),
        ]);
    });

    it.each([() => false, () => { throw new Error("source check unavailable"); }])(
        "withholds native output when its independent source check denies or fails", async (previewCurrent) => {
            const { events } = await run({ previewCurrent });
            expect(events.filter((event) => event.kind === "writing-artifact")).toHaveLength(0);
            expect(events.filter((event) => event.kind === "writing-recovery")).toEqual([
                expect.objectContaining({ reason: "source_changed", rawText: "", previewText: "" }),
            ]);
        },
    );

    it("keeps ordinary explanation separate from the exact artifact body", async () => {
        const preamble = "先说明写作取舍。";
        const { events } = await run({ preamble });
        expect(events.filter((event) => event.kind === "writing-artifact")).toEqual([
            expect.objectContaining({ body, preamble, explanation: "" }),
        ]);
    });

    it("previews real argument fragments and delivers one exact artifact without replay duplication", async () => {
        const { result, events } = await run();
        expect(result.status).toBe("completed");
        const previews = events.filter((event) => event.kind === "writing-preview");
        expect(previews.some((event) => event.text.length > 0 && event.text.length < body.length)).toBe(true);
        expect(events.filter((event) => event.kind === "writing-artifact")).toEqual([
            expect.objectContaining({ requestId: request.requestId, body, explanation: "" }),
        ]);
        expect(events.filter((event) => event.kind === "writing-recovery")).toHaveLength(0);
    });

    it.each(["truncate", "cancel", "revoke", "mixed", "denyProof"] as const)("never promotes %s to an artifact", async (mode) => {
        const { events } = await run({ [mode]: true });
        expect(events.filter((event) => event.kind === "writing-artifact")).toHaveLength(0);
        const recoveries = events.filter((event) => event.kind === "writing-recovery");
        expect(recoveries).toHaveLength(1);
        if (mode === "truncate" || mode === "cancel") {
            expect(recoveries[0]).toMatchObject({ previewText: expect.stringContaining("第一行") });
        }
        if (mode === "revoke" || mode === "mixed") expect(recoveries[0]).toMatchObject({ previewText: "" });
        if (mode === "revoke") expect(recoveries[0]).toMatchObject({ reason: "source_changed", rawText: "" });
    });

    it("allows ordinary text in native mode without demanding a writing envelope", async () => {
        const { events } = await run({ ordinary: true });
        expect(events.filter((event) => event.kind === "writing-preview")).toContainEqual(
            expect.objectContaining({ text: "A normal answer." }),
        );
        expect(events.filter((event) => event.kind === "writing-preview").at(-1)).toMatchObject({ text: "A normal answer." });
        expect(events.filter((event) => event.kind === "writing-artifact" || event.kind === "writing-recovery")).toHaveLength(0);
    });
});

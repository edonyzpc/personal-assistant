import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
    createOfflineModel, decodeEnvelope, FIXTURE_IMAGE, makeImageInput,
    manualVersion, readProviderCompletion, WritingCandidate,
} from "./b129-runtime-prototype.mjs";

// Process-local guard: no credentials, provider configuration, tracing or real network.
const originalFetch = globalThis.fetch;
const tracingKeys = ["LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2", "LANGCHAIN_TRACING"];
const tracingValues = tracingKeys.map((key) => process.env[key]);
before(() => {
    for (const key of tracingKeys) process.env[key] = "false";
    globalThis.fetch = async () => { throw new Error("Real network is forbidden in the B-129 prototype"); };
});
after(() => {
    globalThis.fetch = originalFetch;
    tracingKeys.forEach((key, index) => {
        if (tracingValues[index] === undefined) delete process.env[key];
        else process.env[key] = tracingValues[index];
    });
});

const requestId = "request-synthetic-1";
const body = "沿着海岸，慢慢走。\n她说：\"今天很好\"。";
const envelope = { kind: "pa.writing", version: 1, requestId, body, explanation: "仅为合成测试。" };
const text = JSON.stringify(envelope);
const associatedImages = [{ ref: { assetId: "photo-A", contentHash: "hash-A" }, ordinal: 1 },
    { ref: { assetId: "reference-B", contentHash: "hash-B" }, ordinal: 2 }];
const candidate = () => {
    const value = new WritingCandidate({ requestId, maxTextChars: 4096, associatedImages });
    value.messageStart("message-synthetic-1");
    return value;
};

for (const method of ["stream", "invoke"]) {
    for (const finishReason of ["stop", "length", "content_filter", "unexpected", undefined]) {
        test(`real SDK ${method}: bound image content and finish reason ${String(finishReason)}`, async () => {
            const fixture = createOfflineModel({ text, finishReason, omitFinishReason: finishReason === undefined });
            const value = candidate();
            const sdkMessages = [];
            if (method === "stream") {
                for await (const chunk of await fixture.chain.stream(makeImageInput(requestId))) {
                    sdkMessages.push(chunk);
                    value.sdkMessage(chunk);
                    assert.equal(value.finished, false, "JSON or finish signal is not agent_end");
                }
            } else {
                const result = await fixture.chain.invoke(makeImageInput(requestId));
                sdkMessages.push(result);
                value.sdkMessage(result);
            }
            value.messageEnd();
            const result = value.agentEnd();
            const expectedReason = ["stop", "length", "content_filter"].includes(finishReason) ? finishReason : "unknown";
            assert.equal(value.message.providerCompletion, expectedReason);
            assert.equal(result.kind, finishReason === "stop" ? "artifact" : "manual");
            assert.equal(fixture.requests.length, 1);
            const wire = fixture.requests[0];
            assert.equal(wire.tools[0].function.name, "resolve_chat_images");
            assert.equal(wire.response_format, undefined, "No SDK JSON mode");
            const user = wire.messages.find((message) => message.role === "user");
            assert.deepEqual(user.content, makeImageInput(requestId).messages[0].content);
            assert.equal(user.content[1].image_url.url, FIXTURE_IMAGE);
            assert.equal(fixture.observedMessages.length, 1, "Observe the actual model after bindTools");
            assert.deepEqual(fixture.observedMessages[0].at(-1).content, user.content);
            if (finishReason !== undefined) {
                assert.ok(sdkMessages.some((message) => message.response_metadata.finish_reason === finishReason));
            } else {
                assert.ok(sdkMessages.every((message) => readProviderCompletion(message) === "unknown"));
            }
            if (result.kind === "artifact") {
                assert.equal(result.body, body, "Exact newlines and quotes survive parsing");
                assert.deepEqual(result.associatedImages, associatedImages);
            } else assert.equal(result.raw, text, "Preserve model output for manual recovery");
        });
    }
}

test("reserved final uses no tools and still returns the same ordinary-text envelope", async () => {
    const fixture = createOfflineModel({ text, tools: false });
    const value = candidate();
    for await (const chunk of await fixture.chain.stream(makeImageInput(requestId))) value.sdkMessage(chunk);
    value.messageEnd();
    assert.equal(fixture.requests[0].tools, undefined);
    assert.equal(fixture.requests[0].response_format, undefined);
    assert.equal(value.agentEnd().body, body);
});

test("strict whole-envelope schema rejects missing/extra fields, wrong ID, fences and trailing text", () => {
    assert.equal(decodeEnvelope(text, requestId, 4096).ok, true);
    for (const invalid of [
        JSON.stringify({ ...envelope, imageIds: ["model-selected-image"] }),
        JSON.stringify({ ...envelope, targetPath: "model-chosen.md" }),
        JSON.stringify({ ...envelope, body: undefined }),
        JSON.stringify({ ...envelope, body: 1 }),
        JSON.stringify({ ...envelope, version: 2 }),
        JSON.stringify({ ...envelope, kind: "other" }),
        JSON.stringify({ ...envelope, requestId: "old-request" }),
        `\`\`\`json\n${text}\n\`\`\``, `${text} trailing`, text.slice(0, -1),
    ]) assert.equal(decodeEnvelope(invalid, requestId, 4096).ok, false);
    assert.equal(decodeEnvelope(text, requestId, text.length - 1).reason, "text_budget");
});

test("legal JSON and stop cannot freeze aborted/error/incomplete/stale or unusable output", () => {
    for (const terminal of [
        { status: "aborted" }, { status: "error" }, { status: "incomplete" },
        { current: false }, { inputsUsable: false },
        { status: "completed_with_warning" },
        { status: "completed_with_warning", warningAffectsCompleteness: true },
    ]) {
        const value = candidate();
        value.sdkMessage({ content: text, response_metadata: { finish_reason: "stop" } });
        value.messageEnd();
        assert.equal(value.agentEnd(terminal).kind, "manual");
    }
});

test("actual SDK stream failure after complete JSON plus stop keeps manual recovery, no invoke", async () => {
    const fixture = createOfflineModel({ text, failStreamAfterText: true });
    const value = candidate();
    await assert.rejects(async () => {
        for await (const chunk of await fixture.chain.stream(makeImageInput(requestId))) value.sdkMessage(chunk);
    });
    value.messageEnd();
    const result = value.agentEnd({ status: "error" });
    assert.equal(value.message.providerCompletion, "stop");
    assert.equal(result.kind, "manual");
    assert.equal(result.raw, text);
    assert.equal(fixture.requests.length, 1);
});

test("actual SDK abort after a delta cannot produce an artifact or trigger recovery calls", async () => {
    const fixture = createOfflineModel({ text });
    const controller = new AbortController();
    const value = candidate();
    try {
        for await (const chunk of await fixture.chain.stream(makeImageInput(requestId), { signal: controller.signal })) {
            value.sdkMessage(chunk);
            controller.abort();
        }
    } catch { /* The SDK may throw or terminate on cancellation; local abort owns eligibility. */ }
    value.messageEnd();
    assert.ok(value.message.text.length > 0, "Cancellation was exercised after an observed delta");
    assert.equal(value.agentEnd({ status: "aborted" }).kind, "manual");
    assert.equal(fixture.requests.length, 1);
});

test("pre-output stream failure and a separately prepared invoke retain request ID and image bytes", async () => {
    const fixture = createOfflineModel({ text, failStreamSetup: true });
    await assert.rejects(async () => {
        for await (const _chunk of await fixture.chain.stream(makeImageInput(requestId))) assert.fail("No output expected");
    });
    const value = candidate();
    // Production's existing fallback owns admission/revalidation; this only proves SDK transport parity.
    value.sdkMessage(await fixture.chain.invoke(makeImageInput(requestId)));
    value.messageEnd();
    assert.equal(value.agentEnd().body, body);
    assert.equal(fixture.requests.length, 2);
    assert.deepEqual(fixture.requests[0].messages, fixture.requests[1].messages);
    assert.equal(fixture.requests[0].stream, true);
    assert.equal(fixture.requests[1].stream, false);
});

test("tool-round text is replaced by the final candidate; duplicate final event is idempotent", () => {
    const value = candidate();
    value.sdkMessage({ content: text, response_metadata: { finish_reason: "tool_calls" }, tool_calls: [{ id: "call" }] });
    value.messageEnd();
    value.messageStart("final-message");
    value.sdkMessage({ content: text, response_metadata: { finish_reason: "stop" } });
    value.sdkMessage({ content: "", response_metadata: { usage: { total_tokens: 20 } } });
    value.messageEnd();
    const artifact = value.agentEnd();
    assert.equal(artifact.body, body);
    assert.equal(artifact.messageId, "final-message");
    assert.deepEqual(value.agentEnd(), { kind: "duplicate" });
});

test("unassessed warnings and unfinished/tool messages cannot freeze even valid text", () => {
    const unfinished = candidate();
    unfinished.sdkMessage({ content: text, response_metadata: { finish_reason: "stop" } });
    assert.equal(unfinished.agentEnd().kind, "manual");
    const tool = candidate();
    tool.sdkMessage({ content: text, response_metadata: { finish_reason: "stop" }, tool_calls: [{ id: "call" }] });
    tool.messageEnd();
    assert.equal(tool.agentEnd().kind, "manual");
    const assessedWarning = candidate();
    assessedWarning.sdkMessage({ content: text, response_metadata: { finish_reason: "stop" } });
    assessedWarning.messageEnd();
    assert.equal(assessedWarning.agentEnd({ status: "completed_with_warning", warningAffectsCompleteness: false }).kind, "artifact");
});

test("manual selection versus edit preserves provenance and every associated image locally", () => {
    const selected = manualVersion(body, body, associatedImages);
    const edited = manualVersion(body, `${body} 再慢一点。`, associatedImages);
    assert.equal(selected.origin, "ai_generated");
    assert.equal(edited.origin, "user_edited");
    assert.deepEqual(selected.associatedImages, associatedImages);
    assert.deepEqual(edited.associatedImages, associatedImages);
});

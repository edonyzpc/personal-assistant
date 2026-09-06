/**
 * B-129 G-04a, independent offline feasibility prototype. Not plugin runtime.
 * Run: node --test scripts/prototypes/b129-runtime-prototype.cases.mjs
 * Only synthetic pixels/text enter an injected fetch; no user/provider config.
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { z } from "zod";

export const FIXTURE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=";
export const FIXTURE_TOOL = {
    type: "function",
    function: {
        name: "resolve_chat_images",
        description: "Synthetic read-only fixture; this prototype never executes tools.",
        parameters: { type: "object", properties: { imageId: { type: "string" } }, required: ["imageId"] },
    },
};

const envelopeSchema = z.object({
    kind: z.literal("pa.writing"),
    version: z.literal(1),
    requestId: z.string(),
    body: z.string(),
    explanation: z.string(),
}).strict();

export function decodeEnvelope(text, requestId, maxTextChars) {
    if (text.length > maxTextChars) return { ok: false, reason: "text_budget" };
    let json;
    try { json = JSON.parse(text); }
    catch { return { ok: false, reason: "whole_json_required" }; }
    const decoded = envelopeSchema.safeParse(json);
    if (!decoded.success) return { ok: false, reason: "strict_schema_required" };
    if (decoded.data.requestId !== requestId) return { ok: false, reason: "request_mismatch" };
    return { ok: true, envelope: decoded.data };
}

export function readProviderCompletion(message) {
    const reason = message?.response_metadata?.finish_reason;
    if (["stop", "length", "content_filter", "tool_calls"].includes(reason)) return reason;
    return "unknown";
}

/** Proposed host boundary: nothing becomes an artifact before agent_end. */
export class WritingCandidate {
    constructor({ requestId, maxTextChars, associatedImages }) {
        this.requestId = requestId;
        this.maxTextChars = maxTextChars;
        this.associatedImages = structuredClone(associatedImages);
        this.message = undefined;
        this.finished = false;
    }

    messageStart(messageId) {
        if (this.finished) return;
        this.message = { messageId, text: "", providerCompletion: "unknown", ended: false, hasTools: false };
    }

    sdkMessage(message) {
        if (this.finished || !this.message || this.message.ended) return;
        if (typeof message.content === "string") this.message.text += message.content;
        // Usage-only SDK tail chunks must not erase the actual completion signal.
        if (message.response_metadata?.finish_reason != null) {
            this.message.providerCompletion = readProviderCompletion(message);
        }
        if (message.tool_calls?.length || message.tool_call_chunks?.length) this.message.hasTools = true;
    }

    messageEnd() {
        if (this.message) this.message.ended = true;
    }

    agentEnd({ status = "completed", current = true, inputsUsable = true, warningAffectsCompleteness } = {}) {
        if (this.finished) return { kind: "duplicate" };
        this.finished = true;
        const message = this.message;
        const manual = (reason) => ({ kind: "manual", reason, raw: message?.text ?? "" });
        if (!message?.ended) return manual("message_incomplete");
        if (!["completed", "completed_with_warning"].includes(status)) return manual(status);
        if (!current || !inputsUsable || warningAffectsCompleteness
            || (status === "completed_with_warning" && warningAffectsCompleteness !== false)) {
            return manual("inputs_or_completion_unusable");
        }
        if (message.hasTools || message.providerCompletion !== "stop") return manual(`provider_${message.providerCompletion}`);
        const decoded = decodeEnvelope(message.text, this.requestId, this.maxTextChars);
        if (!decoded.ok) return manual(decoded.reason);
        return {
            kind: "artifact",
            messageId: message.messageId,
            body: decoded.envelope.body,
            explanation: decoded.envelope.explanation,
            origin: "ai_generated",
            associatedImages: structuredClone(this.associatedImages),
        };
    }
}

/** Manual recovery is purely local: selection alone does not imply an edit. */
export function manualVersion(selectedAiText, acceptedText, associatedImages) {
    return {
        body: acceptedText,
        origin: selectedAiText === acceptedText ? "ai_generated" : "user_edited",
        associatedImages: structuredClone(associatedImages),
    };
}

export function makeImageInput(requestId) {
    return {
        messages: [new HumanMessage({ content: [
            { type: "text", text: `请根据图片写文案。requestId=${requestId}` },
            { type: "image_url", image_url: { url: FIXTURE_IMAGE } },
        ] })],
    };
}

/** Real SDK, real bindTools and prompt formatting, wholly synthetic HTTP transport. */
export function createOfflineModel({ text, finishReason = "stop", omitFinishReason = false,
    tools = true, failStreamAfterText = false, failStreamSetup = false } = {}) {
    const requests = [];
    const observedMessages = [];
    const fetch = async (url, init) => {
        if (String(url) !== "https://b129-offline.invalid/v1/chat/completions") throw new Error("Unexpected fixture URL");
        const body = JSON.parse(init.body);
        requests.push(body);
        if (body.stream && failStreamSetup) throw new Error("Synthetic streaming setup failure");
        const reason = omitFinishReason ? {} : { finish_reason: finishReason };
        const common = { id: "b129-fixture", created: 0, model: "b129-offline-model" };
        if (!body.stream) {
            return new Response(JSON.stringify({ ...common, object: "chat.completion", choices: [{
                index: 0, message: { role: "assistant", content: text }, ...reason,
            }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), {
                headers: { "Content-Type": "application/json" },
            });
        }
        const frame = (delta, completion = {}) => `data: ${JSON.stringify({ ...common,
            object: "chat.completion.chunk", choices: [{ index: 0, delta, ...completion }],
        })}\n\n`;
        // Multiple model deltas plus arbitrary UTF-8 transport boundaries.
        const pieces = [text.slice(0, 9), text.slice(9, 37), text.slice(37)];
        const frames = pieces.map((content, index) => frame({ ...(index === 0 ? { role: "assistant" } : {}), content }));
        frames.push(frame({}, reason));
        const bytes = new TextEncoder().encode(frames.join("") + (failStreamAfterText ? "" : "data: [DONE]\n\n"));
        let offset = 0;
        return new Response(new ReadableStream({
            pull(controller) {
                if (offset < bytes.length) {
                    controller.enqueue(bytes.slice(offset, offset + 37));
                    offset += 37;
                } else if (failStreamAfterText) controller.error(new Error("Synthetic stream interruption"));
                else controller.close();
            },
        }), { headers: { "Content-Type": "text/event-stream" } });
    };
    const base = new ChatOpenAI({
        model: "b129-offline-model", apiKey: "synthetic-not-a-secret", maxRetries: 0,
        configuration: { baseURL: "https://b129-offline.invalid/v1", fetch },
    });
    const model = tools ? base.bindTools([FIXTURE_TOOL]) : base;
    // Attach on the actual post-bind model; a pre-bind instance callback can be lost.
    model.callbacks = [{ name: "b129-offline-bound-model", raiseError: true,
        handleChatModelStart(_serialized, batches) { observedMessages.push(...batches); },
    }];
    const prompt = ChatPromptTemplate.fromMessages([
        new SystemMessage("Return one whole JSON object: kind=pa.writing, version=1, requestId, body, explanation. No other fields or fences."),
        new MessagesPlaceholder("messages"),
    ]);
    return { chain: prompt.pipe(model), requests, observedMessages };
}

import type { ChatWritingContext, ChatWritingRequest, ProviderCompletion } from "./chat-types";
import { escapeTaggedBoundary } from "./agent-utils";

export interface WritingOutputEnvelope {
    kind: "pa.writing";
    version: 1;
    requestId: string;
    body: string;
    explanation: string;
}

/** This is only an intent hint for the host. Ordinary visual questions stay ordinary chat. */
export function isWritingRequestPrompt(text: string, writingContext = false): boolean {
    return /(?:文案|配文|润色|改写|重写)|\b(?:caption|copywriting|rewrite|redraft|polish (?:this|the))\b/i.test(text)
        || /(?:写|起草|生成|创作).{0,16}(?:邮件|短信|帖子|推文|公告|文章|邀请函)|\b(?:write|draft|compose|create)\b.{0,35}\b(?:email|message|post|tweet|article|caption|copy)\b/i.test(text)
        || (writingContext && isWritingContinuationPrompt(text));
}

export function isWritingContinuationPrompt(text: string): boolean {
    if (isNewWritingTopicPrompt(text)) return false;
    if (/(?:继续|重试)(?:刚才|之前|上一轮)(?:的)?(?:文案|写作|配文)(?:任务)?|\b(?:continue|retry) (?:the |my )?(?:previous|last) (?:writing task|draft|caption)\b/i.test(text)) return true;
    return /(?:短一点|长一点|简洁一点|换个说法|改(?:写)?这(?:版|段|篇)|(?:继续|修改|编辑|润色|重写)(?:这版|这段|上段|文案))|\b(?:make (?:it|this) (?:shorter|longer|more concise)|shorter|longer|rephrase (?:this|it)|rewrite (?:this|it)|less formal|continue (?:this|the draft))\b/i.test(text);
}

export function isNewWritingTopicPrompt(text: string): boolean {
    return /(?:换个话题|另一个问题)|\b(?:new topic|different question|unrelated question)\b/i.test(text);
}

export function cloneChatWritingRequest(request: ChatWritingRequest): ChatWritingRequest {
    if (!request || typeof request.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(request.requestId)) {
        throw new Error("writing_request_invalid");
    }
    return { requestId: request.requestId };
}

export function writingOutputInstruction(request: ChatWritingRequest): string {
    const { requestId } = cloneChatWritingRequest(request);
    return [
        "The host requests a writing result. Use tools as needed, then return exactly one complete JSON object as your FINAL text, without Markdown fences or trailing text.",
        `Required shape: ${JSON.stringify({ kind: "pa.writing", version: 1, requestId, body: "exact writing text", explanation: "brief optional explanation" })}`,
        "Keep the requestId exactly as supplied. body and explanation must be strings; use an empty explanation when unnecessary. No extra keys. Do not include host source IDs, paths, permissions or images in this object.",
        "This same final-text contract applies when tools are disabled and on retries. Do not return an unfinished draft as a completed object.",
    ].join("\n");
}

export function selectedWritingContext(context: ChatWritingContext | undefined): string {
    if (!context) return "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(context.parentVersionId) || !/^[a-f0-9]{64}$/.test(context.textHash)
        || typeof context.text !== "string") throw new Error("writing_context_invalid");
    return `<selected_writing_version context_only="true" grants_tool_authority="false" grants_write_authority="false" format="json">\n${escapeTaggedBoundary(escapeTaggedBoundary(JSON.stringify({
        parentVersionId: context.parentVersionId, textHash: context.textHash, text: context.text,
    }), "selected_writing_version"), "runtime_instruction")}\n</selected_writing_version>`;
}

/** Whole JSON, optionally in one complete json fence. Never extract or repair a partial body. */
export function decodeWritingOutput(rawText: string, request: ChatWritingRequest, maxTextChars: number): WritingOutputEnvelope | undefined {
    if (!Number.isSafeInteger(maxTextChars) || maxTextChars <= 0 || rawText.length > maxTextChars) return undefined;
    try {
        // Only recognize the entire reply's wrapper. Fences within a JSON
        // string remain data, and mixed prose/multiple blocks never parse.
        // Keep rawText intact for recovery and include its wrapper in the budget.
        const fenced = /^```json[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(rawText.trim());
        const value: unknown = JSON.parse(fenced ? fenced[1] : rawText);
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const record = value as Record<string, unknown>;
        if (Object.keys(record).sort().join(",") !== "body,explanation,kind,requestId,version"
            || record.kind !== "pa.writing" || record.version !== 1 || record.requestId !== request.requestId
            || typeof record.body !== "string" || !record.body.trim() || typeof record.explanation !== "string"
            || record.body.length + record.explanation.length > maxTextChars) return undefined;
        return record as unknown as WritingOutputEnvelope;
    } catch { return undefined; }
}

/** Missing metadata is absent, so a usage-only tail cannot erase an earlier stop. */
export function readProviderCompletion(value: unknown): ProviderCompletion | undefined {
    if (!value || typeof value !== "object") return undefined;
    const metadata = (value as { response_metadata?: unknown }).response_metadata;
    if (!metadata || typeof metadata !== "object" || !Object.prototype.hasOwnProperty.call(metadata, "finish_reason")) return undefined;
    const reason = (metadata as { finish_reason?: unknown }).finish_reason;
    if (reason === undefined || reason === null || reason === "") return undefined;
    return reason === "stop" || reason === "length" || reason === "content_filter" ? reason : "unknown";
}

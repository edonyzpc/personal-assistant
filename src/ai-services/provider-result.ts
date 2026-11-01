import type { ProviderCompletion } from "./chat-types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

export class ProviderCompletionError extends Error {
    constructor(
        readonly completion: ProviderCompletion | "missing_terminal",
        message?: string,
    ) {
        super(message ?? `Provider result was not completed (${completion}).`);
        this.name = "ProviderCompletionError";
    }
}

function responsesCompletion(value: Record<string, unknown>): ProviderCompletion | undefined {
    const metadata = asRecord(value.response_metadata);
    const status = metadata?.status;
    if (status !== "completed" && status !== "incomplete" && status !== "failed") return undefined;
    if (status !== "completed") {
        const reason = asRecord(metadata?.incomplete_details)?.reason;
        if (reason === "max_output_tokens") return "length";
        if (reason === "content_filter") return "content_filter";
        return "unknown";
    }
    const output = metadata?.output;
    if (Array.isArray(output) && output.some(item => asRecord(item)?.type === "function_call")) {
        return "tool_calls";
    }
    return "stop";
}

/** Missing metadata is absent, so a usage-only tail cannot erase an earlier stop. */
export function readProviderCompletion(value: unknown): ProviderCompletion | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const metadata = asRecord(record.response_metadata);
    if (metadata && Object.prototype.hasOwnProperty.call(metadata, "finish_reason")) {
        const reason = metadata.finish_reason;
        if (reason === undefined || reason === null || reason === "") return undefined;
        return reason === "stop" || reason === "tool_calls" || reason === "length" || reason === "content_filter"
            ? reason
            : "unknown";
    }
    return responsesCompletion(record);
}

/** SDK text projection without flattening tools, media, or refusals into prose. */
export function readProviderText(value: unknown): string | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    if (!Array.isArray(record.content)) return undefined;
    const texts: string[] = [];
    for (const part of record.content) {
        if (typeof part === "string") texts.push(part);
        else {
            const text = asRecord(part)?.text;
            if (typeof text === "string") texts.push(text);
        }
    }
    return texts.join("");
}

export function assertProviderCompletion(value: unknown): ProviderCompletion {
    const completion = readProviderCompletion(value);
    if (completion !== "stop" && completion !== "tool_calls") {
        throw new ProviderCompletionError(completion ?? "missing_terminal");
    }
    return completion;
}

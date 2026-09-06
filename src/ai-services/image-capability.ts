export type ChatImageCapability = "supported" | "unsupported" | "unknown";
export interface ChatImageModelIdentity { aiProvider: string; baseURL: string; chatModelName: string; }

export function chatImageModelKey(identity: ChatImageModelIdentity): string {
    return JSON.stringify([identity.aiProvider, identity.baseURL, identity.chatModelName]);
}

/** Exact endpoint/model evidence only. Provider brand names do not imply vision support. */
export class ChatImageCapabilityRegistry {
    private currentKey?: string;
    private state: ChatImageCapability = "unknown";
    get(identity: ChatImageModelIdentity): ChatImageCapability {
        const next = chatImageModelKey(identity);
        if (next !== this.currentKey) { this.currentKey = next; this.state = "unknown"; }
        return this.state;
    }
    recordSupported(identity: ChatImageModelIdentity): void { this.record(identity, "supported"); }
    recordError(identity: ChatImageModelIdentity, error: unknown): void {
        if (isStructuredImageUnsupportedError(error)) this.record(identity, "unsupported");
    }
    private record(identity: ChatImageModelIdentity, state: ChatImageCapability): void {
        const identityKey = chatImageModelKey(identity);
        if (this.currentKey === undefined) this.currentKey = identityKey;
        if (identityKey === this.currentKey) this.state = state;
    }
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function isStructuredImageUnsupportedError(error: unknown): boolean {
    const outer = record(error);
    if (!outer) return false;
    // Authentication, network, rate limit, quota and timeouts never change capability.
    if (outer.status !== 400 && outer.status !== 422) return false;
    const detail = record(outer.error) ?? outer;
    const code = detail.code;
    if (code === "image_input_not_supported" || code === "vision_not_supported" || code === "unsupported_image_input") return true;
    const param = typeof detail.param === "string" ? detail.param : "";
    const message = typeof detail.message === "string" ? detail.message : "";
    return (code === "invalid_value" || code === "unsupported_value" || code === "unsupported_content_type")
        && /^messages\[\d+\]\.content\[\d+\](?:\.type)?$/.test(param)
        && /image_url/i.test(message)
        && /(?:only supported by certain models|(?:model|models).{0,50}(?:does not support|do not support|not support|unsupported))|(?:not supported.{0,30}model)/i.test(message);
}

/** Never forward SDK error bodies which can echo full serialized image requests. */
export class ChatImageRequestError extends Error {
    constructor(public readonly code: "unsupported_model" | "source_unavailable" | "image_budget" | "provider_failed" | "request_changed") {
        super(`chat_images:${code}`); this.name = "ChatImageRequestError";
    }
}

import { requestUrl, type RequestUrlParam } from "obsidian";

import { getDashScopeTasksUrl } from "./ai-utils";

export type WanImageModel = "wan2.7-image" | "wan2.7-image-pro";
export type WanImageTaskStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";

export interface WanImageTask {
    taskId: string;
    status: WanImageTaskStatus;
    requestId?: string;
    providerCode?: string;
    /** Expiring provider locators. Validate each destination before downloading; never persist as the image. */
    imageUrls: string[];
}

export interface WanImageSubmitInput {
    model: WanImageModel;
    prompt: string;
    count: number;
    /** Original reference data, in display order; no public upload URL is created by this adapter. */
    referenceImages?: string[];
    size?: "1K" | "2K" | "4K";
}

export type WanImageProviderErrorKind =
    | "invalid_input"
    | "unsupported_endpoint"
    | "rejected"
    | "submission_unknown"
    | "transport"
    | "invalid_response";

export class WanImageProviderError extends Error {
    constructor(
        public readonly kind: WanImageProviderErrorKind,
        public readonly httpStatus?: number,
        public readonly providerCode?: string,
        public readonly requestId?: string,
    ) {
        super(kind);
        this.name = "WanImageProviderError";
    }
}

type WanImageRequest = (params: RequestUrlParam) => Promise<{ status: number; json: unknown }>;

interface ProviderResponse {
    request_id?: unknown;
    code?: unknown;
    output?: {
        task_id?: unknown;
        task_status?: unknown;
        finished?: unknown;
        choices?: unknown;
    };
}

function safeString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}

function taskStatus(value: unknown): WanImageTaskStatus | undefined {
    if (value === "PENDING" || value === "RUNNING" || value === "SUCCEEDED"
        || value === "FAILED" || value === "CANCELED" || value === "UNKNOWN") return value;
    return undefined;
}

function taskId(value: unknown): string | undefined {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

export function resolveWanImageEndpoints(baseURL: string): { submit: string; tasks: string } {
    const publicTasks = getDashScopeTasksUrl(baseURL);
    if (publicTasks) {
        return {
            submit: `${new URL(publicTasks).origin}/api/v1/services/aigc/image-generation/generation`,
            tasks: publicTasks,
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(baseURL);
    } catch {
        throw new WanImageProviderError("unsupported_endpoint");
    }
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const workspaceHost = /^[a-z0-9][a-z0-9-]*\.(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/i;
    if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password
        || parsed.search || parsed.hash || !workspaceHost.test(parsed.hostname)
        || !["/", "/api/v1", "/compatible-mode/v1"].includes(path)) {
        throw new WanImageProviderError("unsupported_endpoint");
    }
    return {
        submit: `${parsed.origin}/api/v1/services/aigc/image-generation/generation`,
        tasks: `${parsed.origin}/api/v1/tasks`,
    };
}

function parseResponse(value: unknown): ProviderResponse {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as ProviderResponse;
}

function outputImages(choices: unknown): string[] {
    if (!Array.isArray(choices) || choices.length === 0) return [];
    const urls: string[] = [];
    for (const choice of choices) {
        if (!choice || choice.finish_reason !== "stop" || !Array.isArray(choice.message?.content)) continue;
        for (const part of choice.message.content) {
            if (!part || part.type !== "image" || typeof part.image !== "string") continue;
            try {
                const url = new URL(part.image);
                if (url.protocol !== "https:" || url.username || url.password || url.hash) continue;
            } catch {
                continue;
            }
            urls.push(part.image);
        }
    }
    return urls;
}

/** One transport call per method; the caller owns durable admission, polling, and download policy. */
export class WanImageProvider {
    private readonly urls: { submit: string; tasks: string };
    private readonly request: WanImageRequest;

    constructor(input: { baseURL: string; apiKey: string; request?: WanImageRequest }) {
        this.urls = resolveWanImageEndpoints(input.baseURL);
        if (!input.apiKey.trim()) throw new WanImageProviderError("invalid_input");
        this.apiKey = input.apiKey.trim();
        this.request = input.request ?? requestUrl;
    }

    private readonly apiKey: string;

    private headers(): Record<string, string> {
        return { Authorization: `Bearer ${this.apiKey}` };
    }

    async submit(input: WanImageSubmitInput): Promise<WanImageTask> {
        const prompt = input.prompt.trim();
        const images = input.referenceImages ?? [];
        if ((input.model !== "wan2.7-image" && input.model !== "wan2.7-image-pro")
            || !prompt || Array.from(prompt).length > 5000
            || !Number.isInteger(input.count) || input.count < 1 || input.count > 4
            || images.length > 9 || images.some((image) => !/^data:image\/(?:jpeg|png|bmp|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(image))
            || (input.size === "4K" && (input.model !== "wan2.7-image-pro" || images.length > 0))) {
            throw new WanImageProviderError("invalid_input");
        }
        const body = {
            model: input.model,
            input: { messages: [{ role: "user", content: [
                ...images.map((image) => ({ image })),
                { text: prompt },
            ] }] },
            parameters: {
                size: input.size ?? "2K",
                n: input.count,
                watermark: false,
                ...(images.length === 0 ? { thinking_mode: true } : {}),
            },
        };
        let response: { status: number; json: unknown };
        try {
            response = await this.request({
                url: this.urls.submit,
                method: "POST",
                contentType: "application/json",
                headers: { ...this.headers(), "X-DashScope-Async": "enable" },
                body: JSON.stringify(body),
                throw: false,
            });
        } catch {
            // A transport error after dispatch does not prove the provider rejected the paid task.
            throw new WanImageProviderError("submission_unknown");
        }
        const parsed = parseResponse(response.json);
        const id = taskId(parsed.output?.task_id);
        const status = taskStatus(parsed.output?.task_status);
        const requestId = safeString(parsed.request_id);
        const providerCode = safeString(parsed.code);
        if (id && status) return { taskId: id, status, requestId, providerCode, imageUrls: [] };
        if (response.status >= 400 && response.status < 500 || providerCode) {
            throw new WanImageProviderError("rejected", response.status, providerCode, requestId);
        }
        throw new WanImageProviderError("submission_unknown", response.status, providerCode, requestId);
    }

    async query(id: string): Promise<WanImageTask> {
        const validId = taskId(id);
        if (!validId) throw new WanImageProviderError("invalid_input");
        let response: { status: number; json: unknown };
        try {
            response = await this.request({
                url: `${this.urls.tasks}/${encodeURIComponent(validId)}`,
                method: "GET",
                headers: this.headers(),
                throw: false,
            });
        } catch {
            throw new WanImageProviderError("transport");
        }
        const parsed = parseResponse(response.json);
        const requestId = safeString(parsed.request_id);
        const providerCode = safeString(parsed.code);
        if (response.status < 200 || response.status >= 300) {
            throw new WanImageProviderError("rejected", response.status, providerCode, requestId);
        }
        const status = taskStatus(parsed.output?.task_status);
        if (!status || taskId(parsed.output?.task_id) !== validId) {
            throw new WanImageProviderError("invalid_response", response.status, providerCode, requestId);
        }
        const imageUrls = status === "SUCCEEDED" ? outputImages(parsed.output?.choices) : [];
        if (status === "SUCCEEDED" && (parsed.output?.finished !== true || imageUrls.length === 0)) {
            throw new WanImageProviderError("invalid_response", response.status, providerCode, requestId);
        }
        return { taskId: validId, status, requestId, providerCode, imageUrls };
    }

    async cancel(id: string, knownStatus: WanImageTaskStatus): Promise<{
        cancellationAccepted: boolean;
        reason?: "not_pending" | "provider_rejected";
    }> {
        const validId = taskId(id);
        if (!validId) throw new WanImageProviderError("invalid_input");
        if (knownStatus !== "PENDING") return { cancellationAccepted: false, reason: "not_pending" };
        let response: { status: number; json: unknown };
        try {
            response = await this.request({
                url: `${this.urls.tasks}/${encodeURIComponent(validId)}/cancel`,
                method: "POST",
                headers: this.headers(),
                throw: false,
            });
        } catch {
            throw new WanImageProviderError("transport");
        }
        if (response.status >= 200 && response.status < 300) return { cancellationAccepted: true };
        if (response.status >= 400 && response.status < 500) {
            return { cancellationAccepted: false, reason: "provider_rejected" };
        }
        throw new WanImageProviderError("transport", response.status);
    }
}

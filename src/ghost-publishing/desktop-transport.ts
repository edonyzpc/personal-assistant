import { GhostClientError } from "./client";
import type { GhostImageUpload, GhostTransport, GhostTransportResponse } from "./client";
import type { ClientRequest, IncomingMessage } from "node:http";

export interface GhostDesktopTransport {
    sendDesktopRequest: GhostTransport;
    createAdminToken(key: string): Promise<string>;
    createImageMultipart(image: GhostImageUpload): Promise<{ body: Uint8Array; contentType: string }>;
}

type NodeNetworkModule = typeof import("node:http") | typeof import("node:https");

/** Loaded only by GhostClient after its desktop platform check. */
export async function createAdminToken(key: string): Promise<string> {
    if (typeof key !== "string" || !/^[a-f\d]{24}:[a-f\d]{64}$/i.test(key)) {
        throw new GhostClientError("invalid-credentials", "not-sent");
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian's desktop renderer provides Node builtins through require.
    const { createHmac }: typeof import("node:crypto") = require("node:crypto");
    const [id, secret] = key.split(":");
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iat: issuedAt, exp: issuedAt + 120, aud: "/admin/" })).toString("base64url");
    const unsigned = `${header}.${payload}`;
    const signature = createHmac("sha256", Buffer.from(secret, "hex")).update(unsigned).digest("base64url");
    return `${unsigned}.${signature}`;
}

export async function createImageMultipart(image: GhostImageUpload): Promise<{ body: Uint8Array; contentType: string }> {
    const bytes = Buffer.from(image.bytes);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian's desktop renderer provides Node builtins through require.
    const { randomBytes }: typeof import("node:crypto") = require("node:crypto");
    const boundary = `pa-ghost-${randomBytes(24).toString("hex")}`;
    const header = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${image.filename}"\r\n`
        + `Content-Type: ${image.mimeType}\r\n\r\n`,
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    return { body: Buffer.concat([header, bytes, footer]), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** No cookies, redirects, retries or browser session state. Every hop is explicit. */
export const sendDesktopRequest: GhostTransport = async (input) => {
    let url: URL;
    try {
        url = new URL(input.url);
        if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
            throw new Error("Invalid URL");
        }
    } catch {
        throw new GhostClientError("invalid-input", "not-sent");
    }
    // Obsidian's desktop renderer supports CommonJS Node builtins, unlike node: dynamic import.
    // The request's final admission gates still run after this synchronous module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Desktop-only transport selected by GhostClient.
    const network: NodeNetworkModule = url.protocol === "https:" ? require("node:https") : require("node:http");
    return new Promise<GhostTransportResponse>((resolve, reject) => {
        let request: ClientRequest | undefined;
        let response: IncomingMessage | undefined;
        let settled = false;
        const chunks: Buffer[] = [];
        let receivedBytes = 0;

        const cleanup = () => {
            clearTimeout(timer);
            input.gate.signal?.removeEventListener("abort", onAbort);
        };
        const finish = (error?: GhostClientError, result?: GhostTransportResponse) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) {
                request?.destroy();
                response?.destroy();
                reject(error);
            } else if (result) {
                resolve(result);
            }
        };
        const onAbort = () => finish(new GhostClientError("cancelled", "not-sent"));
        const onError = () => finish(new GhostClientError("network", "not-sent"));
        const onData = (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > input.maxResponseBytes) {
                finish(new GhostClientError("response-too-large", "not-sent"));
                return;
            }
            chunks.push(chunk);
        };
        const onEnd = () => {
            if (!response || !response.complete) {
                onError();
                return;
            }
            // Only the two headers used by the client leave this module. Never retain Set-Cookie.
            const location = response.headers.location;
            const contentType = response.headers["content-type"];
            finish(undefined, {
                status: response.statusCode ?? 0,
                headers: { location, "content-type": contentType },
                body: Buffer.concat(chunks, receivedBytes),
            });
        };
        const onResponseClose = () => {
            if (!settled) onError();
            response?.removeListener("data", onData);
            response?.removeListener("end", onEnd);
            response?.removeListener("error", onError);
            response?.removeListener("aborted", onError);
            response?.removeListener("close", onResponseClose);
        };
        const onResponse = (incoming: IncomingMessage) => {
            response = incoming;
            response.on("data", onData);
            response.once("end", onEnd);
            response.once("error", onError);
            response.once("aborted", onError);
            response.once("close", onResponseClose);
            const length = Number(response.headers["content-length"]);
            if (Number.isFinite(length) && length > input.maxResponseBytes) {
                finish(new GhostClientError("response-too-large", "not-sent"));
            }
        };
        const onRequestClose = () => {
            if (!settled) onError();
            request?.removeListener("error", onError);
            request?.removeListener("response", onResponse);
            request?.removeListener("close", onRequestClose);
        };
        const timer = setTimeout(() => finish(new GhostClientError("timeout", "not-sent")), input.timeoutMs);
        input.gate.signal?.addEventListener("abort", onAbort, { once: true });

        const start = async () => {
            try {
                if (input.gate.signal?.aborted) { onAbort(); return; }
                await input.gate.beforeSend();
                if (settled) return;
                input.gate.assertCurrent();
                if (input.gate.signal?.aborted) { onAbort(); return; }
            } catch {
                finish(new GhostClientError("gate-rejected", "not-sent"));
                return;
            }
            try {
                request = network.request(url, {
                    method: input.method,
                    headers: {
                        ...input.headers,
                        ...(input.body ? { "Content-Length": String(input.body.length) } : {}),
                    },
                    agent: false,
                });
                request.on("error", onError);
                request.once("response", onResponse);
                request.once("close", onRequestClose);
            } catch {
                onError();
                return;
            }
            try {
                // Nothing asynchronous, no writes and no flushHeaders between this gate and end.
                input.gate.assertCurrent();
                if (input.gate.signal?.aborted) { onAbort(); return; }
            } catch {
                finish(new GhostClientError("gate-rejected", "not-sent"));
                return;
            }
            try {
                input.onDispatch();
                request.end(input.body);
            } catch {
                onError();
            }
        };
        void start();
    });
};

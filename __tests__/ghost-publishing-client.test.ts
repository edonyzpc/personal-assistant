import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
    GhostClient, GhostClientError,
    type GhostClientOptions, type GhostPost, type GhostPostWrite,
    type GhostRequestGate, type GhostTransport, type GhostTransportRequest,
} from "../src/ghost-publishing/client";

const POST_ID = "0123456789abcdef01234567";
const SECOND_ID = "1123456789abcdef01234567";
const KEY_ID = "abcdef0123456789abcdef01";
const SECRET = "ab".repeat(32);
const KEY = `${KEY_ID}:${SECRET}`;
const VERSION = "2026-09-29T02:00:00.000Z";
const MARKER = "#pa-ghost-op-00000000-0000-4000-8000-000000000001";
const PRIVATE_PAYLOAD = "do not expose the article or preview token";
const LEXICAL = JSON.stringify({ root: { type: "root", children: [] } });

function post(overrides: Partial<GhostPost> = {}): GhostPost {
    return {
        id: POST_ID, uuid: "00000000-0000-4000-8000-000000000002",
        status: "draft", updated_at: VERSION, created_at: VERSION, url: "https://ghost.example/post/",
        slug: "post", title: "Article", lexical: LEXICAL,
        tags: [{ name: MARKER, slug: MARKER.slice(1), visibility: "internal" }],
        authors: [{ id: KEY_ID, name: "Author", slug: "author" }], visibility: "public",
        custom_template: null, feature_image: null, feature_image_alt: null,
        feature_image_caption: null, custom_excerpt: null,
        codeinjection_head: null, codeinjection_foot: null, published_at: null,
        ...overrides,
    };
}

function gate(overrides: Partial<GhostRequestGate> = {}): GhostRequestGate {
    return { beforeSend: async () => {}, assertCurrent: () => {}, ...overrides };
}

function client(siteUrl: string, options: Partial<GhostClientOptions> = {}): GhostClient {
    return new GhostClient({ siteUrl, isDesktop: () => true, getAdminKey: async () => KEY, ...options });
}

function json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

const servers: Server[] = [];
async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", reject);
            resolve();
        });
    });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => error ? reject(error) : resolve());
    })));
    jest.restoreAllMocks();
});

async function failure(promise: Promise<unknown>): Promise<GhostClientError> {
    try {
        await promise;
        throw new Error("Expected failure");
    } catch (error) {
        expect(error).toBeInstanceOf(GhostClientError);
        return error as GhostClientError;
    }
}

describe("Ghost Admin desktop requests", () => {
    it("uses the fixed subdirectory endpoint, a short HS256 JWT, and a draft-only write projection", async () => {
        const received: Array<{ url: string; method?: string; headers: IncomingMessage["headers"]; content: unknown }> = [];
        const site = await serve((request, response) => {
            void body(request).then((bytes) => {
                received.push({ url: request.url ?? "", method: request.method, headers: request.headers, content: JSON.parse(bytes.toString()) });
                json(response, 201, { posts: [post()] });
            });
        });
        const fields = {
            title: "Article", lexical: LEXICAL, status: "published",
            tags: [{ name: "Primary" }, { name: MARKER, visibility: "internal" }],
            authors: [{ id: KEY_ID, email: "private@example.com" }],
            feature_image_alt: "Cover alt", feature_image_caption: "Cover caption",
            newsletter: "forbidden", email_only: true, id: SECOND_ID, updated_at: "forged",
        } as unknown as GhostPostWrite;
        const result = await client(`${site}/blog/`).createDraft(fields, gate());
        expect(result.id).toBe(POST_ID);
        expect(received).toHaveLength(1);
        const request = received[0];
        expect(request.url).toBe("/blog/ghost/api/admin/posts/?formats=lexical");
        expect(request.method).toBe("POST");
        expect(request.headers["accept-version"]).toBe("v6.0");
        expect(request.headers.cookie).toBeUndefined();
        expect(request.content).toEqual({ posts: [{
            title: "Article", lexical: LEXICAL, status: "draft",
            tags: [{ name: "Primary" }, { name: MARKER, visibility: "internal" }],
            authors: [{ id: KEY_ID }], feature_image_alt: "Cover alt", feature_image_caption: "Cover caption",
        }] });
        const token = request.headers.authorization?.replace(/^Ghost /, "") ?? "";
        const [encodedHeader, encodedPayload, signature] = token.split(".");
        expect(JSON.parse(Buffer.from(encodedHeader, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT", kid: KEY_ID });
        const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
        expect(claims.aud).toBe("/admin/");
        expect(claims.exp - claims.iat).toBe(120);
        expect(Math.abs(claims.iat - Math.floor(Date.now() / 1000))).toBeLessThan(3);
        expect(signature).toBe(createHmac("sha256", Buffer.from(SECRET, "hex")).update(`${encodedHeader}.${encodedPayload}`).digest("base64url"));
    });

    it("updates only explicit fields and the supplied version without changing slug, authors or status", async () => {
        const received: unknown[] = [];
        const site = await serve((request, response) => {
            void body(request).then((bytes) => {
                received.push({ method: request.method, url: request.url, body: JSON.parse(bytes.toString()) });
                json(response, 200, { posts: [post({ status: "published" })] });
            });
        });
        await client(site).updatePost(POST_ID, VERSION, { title: "New title", custom_excerpt: null }, gate());
        expect(received).toEqual([{
            method: "PUT", url: `/ghost/api/admin/posts/${POST_ID}/?formats=lexical`,
            body: { posts: [{ title: "New title", custom_excerpt: null, updated_at: VERSION }] },
        }]);
    });

    it.each(["same-origin", "cross-origin"])("never replays Admin JWTs for %s redirects", async (kind) => {
        const received: string[] = [];
        const target = await serve((request, response) => {
            received.push(`target:${request.method}`);
            json(response, 201, { posts: [post()] });
        });
        const site = await serve((request, response) => {
            received.push(request.url ?? "");
            response.writeHead(307, { Location: kind === "same-origin" ? "/redirected" : `${target}/redirected` });
            response.end(PRIVATE_PAYLOAD);
        });
        const error = await failure(client(site).createDraft({ title: "Article" }, gate()));
        expect(error).toMatchObject({ code: "redirect", status: 307, outcome: "unknown" });
        expect(received).toEqual(["/ghost/api/admin/posts/?formats=lexical"]);
        expect(JSON.stringify(error) + error.message + error.stack).not.toContain(PRIVATE_PAYLOAD);
        expect(JSON.stringify(error) + error.message).not.toContain(KEY);
    });

    it("also refuses redirects on read-only Admin requests", async () => {
        let calls = 0;
        const site = await serve((_request, response) => {
            calls++;
            response.writeHead(302, { Location: "/another" });
            response.end();
        });
        expect(await failure(client(site).readPost(POST_ID, gate()))).toMatchObject({ code: "redirect", outcome: "failed", status: 302 });
        expect(calls).toBe(1);
    });

    it("returns zero or ambiguous marker results and verifies exact internal ownership plus pagination", async () => {
        const replies = [
            { posts: [], meta: { pagination: { total: 0 } } },
            { posts: [post(), post({ id: SECOND_ID })], meta: { pagination: { total: 5 } } },
            { posts: [post()], meta: { pagination: { total: 2 } } },
            { posts: [post({ tags: [{ name: `${MARKER}-wrong`, visibility: "internal" }] })], meta: { pagination: { total: 1 } } },
            { posts: [post({ tags: [{ name: MARKER, visibility: "public" }] })], meta: { pagination: { total: 1 } } },
        ];
        const requests: Array<{ method?: string; query: URLSearchParams }> = [];
        const site = await serve((request, response) => {
            requests.push({ method: request.method, query: new URL(request.url ?? "", "http://local").searchParams });
            json(response, 200, replies.shift());
        });
        const ghost = client(site);
        expect(await ghost.findPostsByMarker(MARKER, gate())).toEqual([]);
        expect((await ghost.findPostsByMarker(MARKER, gate())).map((found) => found.id)).toEqual([POST_ID, SECOND_ID]);
        for (let i = 0; i < 3; i++) {
            expect(await failure(ghost.findPostsByMarker(MARKER, gate()))).toMatchObject({ code: "invalid-response", outcome: "failed" });
        }
        expect(requests).toHaveLength(5);
        for (const request of requests) {
            expect(request.method).toBe("GET");
            expect(request.query.get("limit")).toBe("2");
            expect(request.query.get("filter")).toBe(`tags.name:'${MARKER}'+status:[draft,published,scheduled,sent]`);
        }
    });

    it("projects a read response to the necessary fields without retaining credentials or author email", async () => {
        const remote = { ...post(), secret: PRIVATE_PAYLOAD, newsletter: { id: "forbidden" }, authors: [{ id: KEY_ID, name: "Author", slug: "author", email: "private@example.com" }] };
        const site = await serve((_request, response) => json(response, 200, { posts: [remote] }));
        const result = await client(site).readPost(POST_ID, gate());
        expect(result).toEqual(post());
        expect(JSON.stringify(result)).not.toContain("private@example.com");
        expect(JSON.stringify(result)).not.toContain(PRIVATE_PAYLOAD);
    });

    it("requires complete bounded binding results before callers may ignore old drafts", async () => {
        const matches = Array.from({ length: 100 }, (_, index) => post({ id: (index + 1).toString(16).padStart(24, "0") }));
        const replies = [
            { posts: matches.slice(0, 3), meta: { pagination: { total: 3 } } },
            { posts: matches, meta: { pagination: { total: 101 } } },
        ];
        const limits: string[] = [];
        const site = await serve((request, response) => {
            limits.push(new URL(request.url!, "http://local").searchParams.get("limit")!);
            json(response, 200, replies.shift());
        });
        const ghost = client(site);
        const complete = await ghost.findPostsByMarker(MARKER, gate(), true);
        expect(complete).toHaveLength(3);
        expect(complete[0].created_at).toBe(VERSION);
        expect(await failure(ghost.findPostsByMarker(MARKER, gate(), true)))
            .toMatchObject({ code: "invalid-response", outcome: "failed" });
        expect(limits).toEqual(["100", "100"]);
    });

    it.each([
        { status: 409, code: "conflict", outcome: "failed" },
        { status: 422, code: "http", outcome: "failed" },
        { status: 500, code: "http", outcome: "unknown" },
        { status: 408, code: "http", outcome: "unknown" },
    ])("classifies HTTP $status without any automatic re-read or replay", async ({ status, code, outcome }) => {
        const requests: string[] = [];
        const site = await serve((request, response) => {
            requests.push(request.method ?? "");
            json(response, status, { errors: [{ message: `${KEY} ${PRIVATE_PAYLOAD}` }] });
        });
        const error = await failure(client(site).updatePost(POST_ID, VERSION, { title: "new" }, gate()));
        expect(error).toMatchObject({ code, status, outcome });
        expect(requests).toEqual(["PUT"]);
        expect(error.message).not.toContain(KEY);
        expect(error.message).not.toContain(PRIVATE_PAYLOAD);
    });

    it.each(["POST", "PUT", "DELETE"])("marks %s response loss as unknown and makes exactly one request", async (method) => {
        const requests: string[] = [];
        const site = await serve((request) => {
            void body(request).then(() => {
                requests.push(request.method ?? "");
                request.socket.destroy();
            });
        });
        const ghost = client(site);
        const promise = method === "POST" ? ghost.createDraft({ title: "Article" }, gate())
            : method === "PUT" ? ghost.updatePost(POST_ID, VERSION, { title: "New" }, gate())
                : ghost.deleteDraft(POST_ID, gate());
        expect(await failure(promise)).toMatchObject({ code: "network", outcome: "unknown" });
        expect(requests).toEqual([method]);
    });

    it.each([
        { name: "invalid ID", remote: { ...post(), id: "../settings" } },
        { name: "invalid UUID", remote: { ...post(), uuid: "not-a-uuid" } },
        { name: "missing version", remote: { ...post(), updated_at: null } },
        { name: "invalid creation time", remote: { ...post(), created_at: "unknown" } },
        { name: "unexpected live post", remote: post({ status: "published" }) },
    ])("treats a successful create with $name as unknown", async ({ remote }) => {
        let calls = 0;
        const site = await serve((_request, response) => { calls++; json(response, 201, { posts: [remote] }); });
        expect(await failure(client(site).createDraft({ title: "Article" }, gate()))).toMatchObject({ code: "invalid-response", outcome: "unknown" });
        expect(calls).toBe(1);
    });

    it("rejects malformed success JSON, unexpected success status and update identity mismatch", async () => {
        let calls = 0;
        const site = await serve((_request, response) => {
            calls++;
            if (calls === 1) { response.writeHead(201); response.end(PRIVATE_PAYLOAD); }
            else if (calls === 2) json(response, 202, { posts: [post()] });
            else json(response, 200, { posts: [post({ id: SECOND_ID })] });
        });
        const ghost = client(site);
        const failures = [
            await failure(ghost.createDraft({ title: "Article" }, gate())),
            await failure(ghost.createDraft({ title: "Article" }, gate())),
            await failure(ghost.updatePost(POST_ID, VERSION, { title: "Article" }, gate())),
        ];
        for (const error of failures) expect(error).toMatchObject({ code: "invalid-response", outcome: "unknown" });
        expect(calls).toBe(3);
    });

    it("deletes only the supplied post ID and accepts the documented empty 204", async () => {
        const calls: string[] = [];
        const site = await serve((request, response) => {
            calls.push(`${request.method} ${request.url}`);
            response.writeHead(204); response.end();
        });
        await client(site).deleteDraft(POST_ID, gate());
        expect(calls).toEqual([`DELETE /ghost/api/admin/posts/${POST_ID}/`]);
    });
});

describe("image credential isolation", () => {
    it("manually follows external image redirects without credentials, cookies, or reading the Admin key", async () => {
        const received: Array<IncomingMessage["headers"]> = [];
        const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 0, 255]);
        const target = await serve((request, response) => {
            received.push(request.headers);
            response.writeHead(200, { "Content-Type": "image/png" }); response.end(bytes);
        });
        const source = await serve((request, response) => {
            received.push(request.headers);
            response.writeHead(302, { Location: `${target}/actual.png`, "Set-Cookie": "session=private" }); response.end();
        });
        const secret = jest.fn<() => Promise<string>>().mockResolvedValue(KEY);
        const beforeSend = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const result = await client("https://ghost.example", { getAdminKey: secret }).downloadImage(`${source}/image`, gate({ beforeSend }));
        expect(Buffer.from(result.bytes)).toEqual(bytes);
        expect(result.mimeType).toBe("image/png");
        expect(secret).not.toHaveBeenCalled();
        expect(beforeSend).toHaveBeenCalledTimes(2);
        expect(received).toHaveLength(2);
        for (const headers of received) {
            expect(headers.authorization).toBeUndefined();
            expect(headers.cookie).toBeUndefined();
            expect(headers["accept-version"]).toBeUndefined();
        }
    });

    it.each(["file:///tmp/private.png", "ftp://example.com/image", "https://user:password@example.com/image"])("refuses an unsafe image redirect to %s", async (location) => {
        let calls = 0;
        const source = await serve((_request, response) => {
            calls++; response.writeHead(302, { Location: location }); response.end();
        });
        expect(await failure(client(source).downloadImage(`${source}/image`, gate()))).toMatchObject({ code: "redirect", outcome: "failed" });
        expect(calls).toBe(1);
    });

    it("bounds redirects without inheriting any credentials", async () => {
        let calls = 0;
        const source = await serve((_request, response) => {
            calls++; response.writeHead(302, { Location: "/loop" }); response.end();
        });
        expect(await failure(client(source).downloadImage(`${source}/image`, gate()))).toMatchObject({ code: "redirect" });
        expect(calls).toBe(4);
    });

    it("uploads unchanged image bytes as multipart to the target Admin endpoint with its JWT", async () => {
        const bytes = Buffer.from([0, 255, 13, 10, 137, 80, 78, 71]);
        const received: Array<{ url?: string; method?: string; headers: IncomingMessage["headers"]; body: Buffer }> = [];
        const site = await serve((request, response) => {
            void body(request).then((content) => {
                received.push({ url: request.url, method: request.method, headers: request.headers, body: content });
                json(response, 201, { images: [{ url: `${site}/content/images/cover.png` }] });
            });
        });
        const result = await client(site).uploadImage({ bytes, filename: "cover.png", mimeType: "image/png" }, gate());
        expect(result.url).toBe(`${site}/content/images/cover.png`);
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ method: "POST", url: "/ghost/api/admin/images/upload/" });
        expect(received[0].headers.authorization).toMatch(/^Ghost /);
        expect(received[0].headers.cookie).toBeUndefined();
        expect(received[0].headers["content-type"]).toMatch(/^multipart\/form-data; boundary=pa-ghost-/);
        expect(received[0].body.includes(bytes)).toBe(true);
        expect(received[0].body.toString()).toContain('name="file"; filename="cover.png"');
        expect(received[0].body.toString()).not.toContain("newsletter");
    });

    it("rejects oversized responses and invalid image bodies without retaining their content", async () => {
        const site = await serve((_request, response) => {
            response.writeHead(200, { "Content-Type": "image/png", "Content-Length": "100" }); response.end("x".repeat(100));
        });
        expect(await failure(client(site, { maxImageBytes: 16 }).downloadImage(`${site}/image`, gate())))
            .toMatchObject({ code: "response-too-large", outcome: "failed" });
    });
});

describe("final dispatch admission and lifecycle", () => {
    it("loads no desktop module and makes no requests or secret reads on mobile", async () => {
        const load = jest.fn(() => { throw new Error("desktop must not load"); });
        jest.doMock("../src/ghost-publishing/desktop-transport", load);
        try {
            const transport = jest.fn<GhostTransport>();
            const getAdminKey = jest.fn<() => Promise<string>>();
            const ghost = client("https://ghost.example", { isDesktop: () => false, transport, getAdminKey });
            const operations = [
                ghost.readPost(POST_ID, gate()), ghost.createDraft({ title: "Article" }, gate()),
                ghost.uploadImage({ bytes: new Uint8Array([1]), filename: "a.png", mimeType: "image/png" }, gate()),
                ghost.downloadImage("https://example.com/a.png", gate()),
            ];
            for (const promise of operations) {
                expect(await failure(promise)).toMatchObject({ code: "unsupported-platform", outcome: "not-sent" });
            }
            expect(transport).not.toHaveBeenCalled();
            expect(getAdminKey).not.toHaveBeenCalled();
            expect(load).not.toHaveBeenCalled();
        } finally {
            jest.dontMock("../src/ghost-publishing/desktop-transport");
        }
    });

    it("requires a complete gate and never leaks exceptions from the Host secret getter", async () => {
        const transport = jest.fn<GhostTransport>();
        const ghost = client("https://ghost.example", { transport, getAdminKey: async () => { throw new Error(`${KEY} ${PRIVATE_PAYLOAD}`); } });
        expect(await failure(ghost.createDraft({ title: "a" }, undefined as unknown as GhostRequestGate))).toMatchObject({ code: "gate-rejected", outcome: "not-sent" });
        const error = await failure(ghost.createDraft({ title: "a" }, gate()));
        expect(error).toMatchObject({ code: "invalid-credentials", outcome: "not-sent" });
        expect(error.message + JSON.stringify(error)).not.toContain(SECRET);
        expect(error.message).not.toContain(PRIVATE_PAYLOAD);
        expect(transport).not.toHaveBeenCalled();
    });

    it.each(["secret", "asynchronous final check"])("sends zero writes when authority is revoked after the %s barrier", async (barrier) => {
        let calls = 0;
        let current = true;
        const site = await serve((_request, response) => { calls++; json(response, 201, { posts: [post()] }); });
        const ghost = client(site, { getAdminKey: async () => { await Promise.resolve(); if (barrier === "secret") current = false; return KEY; } });
        const admission = gate({
            beforeSend: async () => { await Promise.resolve(); if (barrier === "asynchronous final check") current = false; },
            assertCurrent: () => { if (!current) throw new Error(PRIVATE_PAYLOAD); },
        });
        expect(await failure(ghost.createDraft({ title: "a" }, admission))).toMatchObject({ code: "gate-rejected", outcome: "not-sent" });
        expect(calls).toBe(0);
    });

    it("rechecks admission after an asynchronous transport dependency resolves", async () => {
        let calls = 0;
        let current = true;
        const transport: GhostTransport = async (request: GhostTransportRequest) => {
            await Promise.resolve();
            current = false;
            await request.gate.beforeSend();
            request.gate.assertCurrent();
            request.onDispatch();
            calls++;
            return { status: 201, headers: {}, body: Buffer.from(JSON.stringify({ posts: [post()] })) };
        };
        const ghost = client("https://ghost.example", { transport });
        const admission = gate({ assertCurrent: () => { if (!current) throw new Error(PRIVATE_PAYLOAD); } });
        expect(await failure(ghost.createDraft({ title: "a" }, admission))).toMatchObject({ code: "gate-rejected", outcome: "not-sent" });
        expect(calls).toBe(0);
    });

    it("cancels a pending final check, releases its timer/listener, and never dispatches after that check resolves", async () => {
        const controller = new AbortController();
        const add = jest.spyOn(controller.signal, "addEventListener");
        const remove = jest.spyOn(controller.signal, "removeEventListener");
        let release!: () => void;
        let entered!: () => void;
        const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
        const wait = new Promise<void>((resolve) => { release = resolve; });
        let calls = 0;
        const site = await serve((_request, response) => { calls++; json(response, 201, { posts: [post()] }); });
        const operation = client(site).createDraft({ title: "a" }, gate({
            signal: controller.signal, beforeSend: async () => { entered(); await wait; },
        }));
        const result = failure(operation);
        await enteredGate;
        controller.abort();
        expect(await result).toMatchObject({ code: "cancelled", outcome: "not-sent" });
        release();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(calls).toBe(0);
        expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
        expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    });

    it("reports cancellation after dispatch as unknown and releases the abort listener", async () => {
        const controller = new AbortController();
        const remove = jest.spyOn(controller.signal, "removeEventListener");
        let calls = 0;
        const site = await serve((request) => {
            void body(request).then(() => { calls++; controller.abort(); });
        });
        expect(await failure(client(site).createDraft({ title: "a" }, gate({ signal: controller.signal }))))
            .toMatchObject({ code: "cancelled", outcome: "unknown" });
        expect(calls).toBe(1);
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it("times out an already received write as unknown with no retry", async () => {
        let calls = 0;
        const site = await serve(() => { calls++; });
        expect(await failure(client(site, { timeoutMs: 50 }).createDraft({ title: "a" }, gate())))
            .toMatchObject({ code: "timeout", outcome: "unknown" });
        expect(calls).toBe(1);
    });

    it("rejects arbitrary post paths, marker filters and invalid write values before reading secrets", async () => {
        const secret = jest.fn<() => Promise<string>>().mockResolvedValue(KEY);
        const ghost = client("https://ghost.example", { getAdminKey: secret });
        for (const operation of [
            ghost.readPost("../settings", gate()),
            ghost.findPostsByMarker(`${MARKER}',status:published`, gate()),
            ghost.updatePost(POST_ID, "invalid", { title: "a" }, gate()),
            ghost.updatePost(POST_ID, VERSION, { status: "scheduled" } as unknown as GhostPostWrite, gate()),
        ]) expect(await failure(operation)).toMatchObject({ code: "invalid-input", outcome: "not-sent" });
        expect(secret).not.toHaveBeenCalled();
    });
});

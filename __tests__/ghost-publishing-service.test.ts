import { describe, expect, it, jest } from "@jest/globals";
import { GhostClientError, type GhostPost, type GhostPostWrite, type GhostRequestGate } from "../src/ghost-publishing/client";
import { ghostPreviewMarker } from "../src/ghost-publishing/markers";
import { GhostPublishingService, type GhostActionContext } from "../src/ghost-publishing/service";
import { managedGhostFields, type GhostLocalOperation, type GhostPreviewPointer, type GhostSnapshot } from "../src/ghost-publishing/state-schema";

const SITE = "https://ghost.example/";
const POST = "a".repeat(24);
const NOW = "2026-10-06T00:00:00.000Z";
function candidate(title = "Current note"): GhostSnapshot {
    return {
        content: { title, lexical: JSON.stringify({ root: { type: "root", version: 1, children: [
            { type: "paragraph", version: 1, children: [{ type: "extended-text", version: 1, text: title }] },
        ] } }), tags: [{ name: "Note tag" }], authors: [{ id: "f".repeat(24) }], visibility: "public",
        feature_image: null, feature_image_alt: null, feature_image_caption: null,
        custom_excerpt: "Current summary", meta_description: "Current SEO", custom_template: null,
        codeinjection_head: null, codeinjection_foot: null, published_at: null },
        managedFields: [...managedGhostFields], source: { targetPath: "Note.md", dependencies: [
            { path: "Note.md", kind: "main", subpath: "", contentHash: "ab".repeat(32) },
        ] }, blocks: [], resources: [], profile: { siteId: "site-a" },
        recipe: { version: "b153-v1", needsPrism: false, loadsPrism: false, initializesPrism: false,
            prismLanguages: [], needsMermaid: false, loadsMermaid: false, initializesMermaid: false,
            needsKatex: false, loadsKatex: false, initializesKatex: false,
            reuse: { prism: false, mermaid: false, katex: false }, headAssets: [], footAssets: [], contentHash: "12345678" },
    };
}
function post(id = POST, status: GhostPost["status"] = "published"): GhostPost {
    return { ...candidate("Old online article").content, id, uuid: "11111111-1111-1111-1111-111111111111",
        status, updated_at: NOW, url: `${SITE}original-url/`, slug: "original-url" };
}
function error(code: string): Error { return Object.assign(new Error(code), { code }); }
function fixture(remote?: GhostPost) {
    let version = 0, sequence = 0;
    const nextVersion = () => new Date(Date.parse(NOW) + ++version * 1000).toISOString();
    const posts = new Map<string, GhostPost>(remote ? [[remote.id, structuredClone(remote)]] : []);
    const pointers = new Map<string, GhostPreviewPointer>();
    const changes: GhostLocalOperation[] = [];
    const state = { active: true, identity: true, bindFailure: false, pointerFailure: false,
        createError: undefined as GhostClientError | undefined, updateError: undefined as GhostClientError | undefined,
        readError: undefined as GhostClientError | undefined, deleteFailure: false, uploadError: undefined as GhostClientError | undefined };
    const send = async (gate: GhostRequestGate) => {
        try { await gate.beforeSend(); gate.assertCurrent(); }
        catch { throw new GhostClientError("gate-rejected", "not-sent"); }
    };
    const client = {
        readPost: jest.fn(async (id: string, gate: GhostRequestGate) => {
            await send(gate);
            if (state.readError) throw state.readError;
            const value = posts.get(id);
            if (!value) throw new GhostClientError("post-not-found", "failed", 404);
            return structuredClone(value);
        }),
        createDraft: jest.fn(async (fields: GhostPostWrite, gate: GhostRequestGate) => {
            await send(gate);
            if (state.createError) throw state.createError;
            const id = (++sequence).toString(16).padStart(24, "0");
            const saved = { ...post(id, "draft"), ...fields, id, status: "draft" as const,
                tags: (fields.tags ?? []).map(tag => ({ ...tag, name: tag.name! })), updated_at: nextVersion(),
                slug: fields.slug ?? "preview", url: `${SITE}p/11111111-1111-1111-1111-111111111111/` };
            posts.set(id, saved);
            return structuredClone(saved);
        }),
        updatePost: jest.fn(async (id: string, expected: string, fields: GhostPostWrite, gate: GhostRequestGate) => {
            await send(gate);
            if (state.updateError) throw state.updateError;
            const old = posts.get(id)!;
            if (old.updated_at !== expected) throw new GhostClientError("conflict", "failed", 409);
            const saved = { ...old, ...fields, tags: (fields.tags ?? old.tags).map(tag => ({ ...tag, name: tag.name! })), updated_at: nextVersion() };
            posts.set(id, saved);
            return structuredClone(saved);
        }),
        deleteDraft: jest.fn(async (id: string, gate: GhostRequestGate) => {
            await send(gate);
            if (state.deleteFailure) throw new GhostClientError("http", "failed", 403);
            posts.delete(id);
        }),
        uploadImage: jest.fn(async (_image: unknown, gate: GhostRequestGate) => {
            await send(gate);
            if (state.uploadError) throw state.uploadError;
            return { url: `${SITE}content/images/upload.png` };
        }),
    };
    let source = candidate();
    const context: GhostActionContext = {
        gate: { assertCurrent: () => { if (!state.active) throw error("source-revoked"); }, beforeSend: async () => undefined },
        assertIdentity: () => { if (!state.identity) throw error("source-changed"); },
        validate: async () => { if (!state.active) throw error("source-revoked"); },
        prepare: async current => ({ candidate: structuredClone({ ...source, content: { ...source.content,
            authors: current?.authors ?? source.content.authors, visibility: current?.visibility ?? source.content.visibility } }),
            slugCandidate: current ? undefined : "new-note", images: source.resources.map(metadata => ({
                metadata, bytes: new Uint8Array([1, 2]), filename: "image.png",
            })) }),
        bind: jest.fn(async () => { if (state.bindFailure) throw error("write-failed"); }),
    };
    const previews = {
        read: jest.fn(async (siteId: string, postId: string) => pointers.get(`${siteId}/${postId}`)),
        write: jest.fn(async (pointer: GhostPreviewPointer) => {
            if (state.pointerFailure) throw error("storage-unavailable");
            pointers.set(`${pointer.siteId}/${pointer.postId}`, structuredClone(pointer));
        }),
        remove: jest.fn(async (siteId: string, postId: string) => { pointers.delete(`${siteId}/${postId}`); }),
    };
    let operationSequence = 0;
    const newService = () => new GhostPublishingService({ siteId: "site-a", site: SITE, isDesktop: () => true, client, previews,
        newId: () => `operation-${++operationSequence}`, onUpdate: operation => changes.push(operation) });
    const service = newService();
    return { service, newService, context, client, previews, posts, pointers, state, changes, nextVersion,
        setSource: (next: GhostSnapshot) => { source = next; } };
}

describe("Ghost session publishing service", () => {
    it("creates only a draft, returns its exact identity and binds after confirmed success", async () => {
        const f = fixture();
        const saved = await f.service.prepare("Note.md", undefined, f.context);
        expect(saved).toMatchObject({ state: "draft_saved", executionState: "succeeded", target: { postStatus: "draft" }, verified: { status: "draft" } });
        expect(f.client.createDraft.mock.calls[0][0]).toMatchObject({ status: "draft", slug: "new-note", custom_excerpt: "Current summary" });
        expect(f.context.bind).toHaveBeenCalledWith(expect.objectContaining({ id: saved.target.postId }));
        expect(f.client.updatePost).not.toHaveBeenCalled();
    });
    it("overwrites the original draft with no baseline, preserves operational fields and never publishes", async () => {
        const remote = { ...post(POST, "draft"), visibility: "members" as const, custom_template: "custom" };
        const f = fixture(remote);
        const saved = await f.service.prepare("Note.md", POST, f.context);
        expect(saved.target.postId).toBe(POST);
        const fields = f.client.updatePost.mock.calls[0][2];
        expect(fields).toMatchObject({ title: "Current note", status: "draft", feature_image: null });
        for (const field of ["slug", "authors", "visibility", "published_at", "custom_template"]) expect(fields).not.toHaveProperty(field);
        expect(f.client.createDraft).not.toHaveBeenCalled();
    });
    it.each([
        { failure: new GhostClientError("http", "failed", 404), expected: "http-404" },
        { failure: new GhostClientError("http", "failed", 401), expected: "http-401" },
        { failure: new GhostClientError("network", "failed"), expected: "network" },
    ])("reports a query failure as no publishing write ($expected)", async ({ failure, expected }) => {
        const f = fixture();
        f.state.readError = failure;
        expect(await f.service.prepare("Note.md", POST, f.context)).toMatchObject({ state: "failed", executionState: "not_started", error: expected });
        expect(f.client.createDraft).not.toHaveBeenCalled();
        expect(f.client.updatePost).not.toHaveBeenCalled();
        expect(f.context.bind).not.toHaveBeenCalled();
    });
    it("creates a replacement only for a trusted exact-post absence and changes the association after success", async () => {
        const f = fixture();
        const saved = await f.service.prepare("Note.md", POST, f.context);
        expect(saved.state).toBe("draft_saved");
        expect(saved.target.postId).not.toBe(POST);
        expect(f.context.bind).toHaveBeenCalledWith(expect.objectContaining({ id: saved.target.postId }));
    });
    it("keeps a known draft ID after local binding failure and reuses it within the current session", async () => {
        const f = fixture();
        f.state.bindFailure = true;
        const first = await f.service.prepare("Note.md", undefined, f.context);
        expect(first).toMatchObject({ state: "draft_saved", executionState: "succeeded", warnings: ["binding-failed"] });
        f.state.bindFailure = false;
        const again = await f.service.prepare("Note.md", undefined, f.context);
        expect(again.target.postId).toBe(first.target.postId);
        expect(f.client.createDraft).toHaveBeenCalledTimes(1);
        expect(f.client.updatePost).toHaveBeenCalledTimes(1);
    });
    it("keeps the confirmed draft identity through a later read failure", async () => {
        const f = fixture();
        f.state.bindFailure = true;
        const first = await f.service.prepare("Note.md", undefined, f.context);
        f.state.readError = new GhostClientError("network", "failed");
        expect(await f.service.prepare("Note.md", undefined, f.context)).toMatchObject({ state: "failed", executionState: "not_started" });
        f.state.readError = undefined;
        f.state.bindFailure = false;
        const saved = await f.service.prepare("Note.md", undefined, f.context);
        expect(saved.target.postId).toBe(first.target.postId);
        expect(f.client.createDraft).toHaveBeenCalledTimes(1);
        expect(f.client.updatePost).toHaveBeenCalledTimes(1);
    });
    it("creates an independent preview after the saved draft is manually published in Ghost", async () => {
        const f = fixture();
        const first = await f.service.prepare("Note.md", undefined, f.context);
        const original = f.posts.get(first.target.postId!)!;
        original.status = "published";
        original.updated_at = f.nextVersion();
        const prepared = await f.service.prepare("Note.md", original.id, f.context);
        expect(prepared).toMatchObject({ state: "prepared", target: { postId: original.id, postStatus: "published" } });
        expect(prepared.target.previewId).not.toBe(original.id);
        expect(f.posts.get(original.id)?.status).toBe("published");
        expect(f.client.createDraft).toHaveBeenCalledTimes(2);
        expect(f.client.updatePost).not.toHaveBeenCalled();
    });
    it("prepares an independent preview while the original remains online, then confirms without a probe", async () => {
        const f = fixture(post());
        const prepared = await f.service.prepare("Note.md", POST, f.context);
        expect(prepared.state).toBe("prepared");
        expect(f.posts.get(POST)?.title).toBe("Old online article");
        expect(prepared.target.previewId).toMatch(/^[a-f\d]{24}$/);
        expect(prepared.target.previewId).not.toBe(POST);
        expect(f.context.bind).not.toHaveBeenCalled();
        const result = await f.service.confirm("Note.md", prepared.operationId, f.context);
        expect(result).toMatchObject({ state: "updated", executionState: "succeeded", verified: { postId: POST, status: "published" } });
        expect(f.posts.get(POST)).toMatchObject({ title: "Current note", status: "published", url: `${SITE}original-url/` });
        expect(f.client.deleteDraft).toHaveBeenCalledWith(prepared.target.previewId!, expect.anything());
        expect(f.pointers.size).toBe(0);
    });
    it("uses the latest original version while submitting the frozen reviewed candidate", async () => {
        const f = fixture(post());
        const prepared = await f.service.prepare("Note.md", POST, f.context);
        const original = f.posts.get(POST)!;
        original.title = "Changed in Ghost";
        original.updated_at = f.nextVersion();
        const expectedVersion = original.updated_at;
        f.setSource(candidate("A later Obsidian edit"));
        const result = await f.service.confirm("Note.md", prepared.operationId, f.context);
        expect(result.state).toBe("updated");
        expect(f.client.updatePost.mock.calls.at(-1)?.slice(0, 2)).toEqual([POST, expectedVersion]);
        expect(f.posts.get(POST)?.title).toBe("Current note");
    });
    it("reuses the exact preview resource on new preparation and expires old confirmation", async () => {
        const f = fixture(post());
        const first = await f.service.prepare("Note.md", POST, f.context);
        f.setSource(candidate("Freshly synchronized note"));
        const second = await f.service.prepare("Note.md", POST, f.context);
        expect(second.target.previewId).toBe(first.target.previewId);
        expect(f.client.createDraft).toHaveBeenCalledTimes(1);
        await expect(f.service.confirm("Note.md", first.operationId, f.context)).rejects.toMatchObject({ code: "confirmation-required" });
        expect((await f.service.confirm("Note.md", second.operationId, f.context)).state).toBe("updated");
    });
    it("revokes confirmation while preserving the already saved preview result", async () => {
        const f = fixture(post());
        const prepared = await f.service.prepare("Note.md", POST, f.context);
        f.service.invalidate(prepared.operationId);
        expect(f.service.get(prepared.operationId)).toEqual(prepared);
        expect(f.service.list("Note.md")[0]).toMatchObject({ state: "prepared", executionState: "succeeded", verified: { status: "draft" } });
        await expect(f.service.confirm("Note.md", prepared.operationId, f.context)).rejects.toMatchObject({ code: "confirmation-required" });
        expect(f.client.updatePost).not.toHaveBeenCalled();
    });
    it.each(["preview-edited", "preview-published", "original-draft", "identity-replaced"] as const)("stops final write for %s", async condition => {
        const f = fixture(post());
        const prepared = await f.service.prepare("Note.md", POST, f.context);
        if (condition === "preview-edited") f.posts.get(prepared.target.previewId!)!.updated_at = f.nextVersion();
        if (condition === "preview-published") f.posts.get(prepared.target.previewId!)!.status = "published";
        if (condition === "original-draft") f.posts.get(POST)!.status = "draft";
        if (condition === "identity-replaced") f.state.identity = false;
        const freshContext = { ...f.context, assertIdentity: () => undefined };
        expect((await f.service.confirm("Note.md", prepared.operationId, freshContext)).state).toBe("failed");
        expect(f.client.updatePost).not.toHaveBeenCalled();
        expect(f.client.deleteDraft).not.toHaveBeenCalled();
    });
    it("keeps successful publication separate from cleanup failure", async () => {
        const f = fixture(post());
        const prepared = await f.service.prepare("Note.md", POST, f.context);
        f.state.deleteFailure = true;
        expect(await f.service.confirm("Note.md", prepared.operationId, f.context)).toMatchObject({ state: "updated", executionState: "succeeded", warnings: ["cleanup-failed"] });
        expect(f.posts.get(POST)?.status).toBe("published");
        expect(f.pointers.size).toBe(1);
    });
    it("keeps exact preview identity when pointer persistence fails and avoids a second draft in this session", async () => {
        const f = fixture(post());
        f.state.pointerFailure = true;
        const first = await f.service.prepare("Note.md", POST, f.context);
        expect(first.warnings).toEqual(["preview-pointer-failed"]);
        const second = await f.service.prepare("Note.md", POST, f.context);
        expect(second.target.previewId).toBe(first.target.previewId);
        expect(f.client.createDraft).toHaveBeenCalledTimes(1);
    });
    it("returns initial unknown POST facts and never retries by inventing a new operation", async () => {
        const f = fixture();
        f.state.createError = new GhostClientError("network", "unknown");
        const result = await f.service.prepare("Note.md", undefined, f.context);
        expect(result).toMatchObject({ state: "outcome_unknown", executionState: "acceptance_unknown", error: "network" });
        expect(result.operationId).toBeTruthy();
        expect(f.service.get(result.operationId)).toEqual(result);
        await expect(f.service.prepare("Note.md", undefined, f.context)).rejects.toMatchObject({ code: "result-unknown" });
        expect(f.client.createDraft).toHaveBeenCalledTimes(1);
    });
    it("does not treat an earlier saved preview as proof of an unknown final PUT", async () => {
        const f = fixture(post());
        const prepared = await f.service.prepare("Note.md", POST, f.context);
        f.state.updateError = new GhostClientError("network", "unknown");
        expect(await f.service.confirm("Note.md", prepared.operationId, f.context)).toMatchObject({ state: "outcome_unknown", executionState: "acceptance_unknown", verified: { status: "draft" } });
        expect(f.client.deleteDraft).not.toHaveBeenCalled();
        await expect(f.service.confirm("Note.md", prepared.operationId, f.context)).rejects.toMatchObject({ code: "confirmation-required" });
        expect(f.client.updatePost).toHaveBeenCalledTimes(1);
    });
    it("reports partial image effects and deduplicates bytes only within the current preparation", async () => {
        const f = fixture();
        const source = candidate();
        source.resources = ["one", "two"].map(id => ({ id, source: `${id}.png`, resolvedPath: `${id}.png`,
            byteHash: "ab".repeat(32), byteLength: 2, mimeType: "image/png" }));
        f.setSource(source);
        f.state.createError = new GhostClientError("http", "failed", 422);
        expect(await f.service.prepare("Note.md", undefined, f.context)).toMatchObject({ state: "failed", executionState: "failed" });
        expect(f.client.uploadImage).toHaveBeenCalledTimes(1);
        expect(f.client.createDraft).toHaveBeenCalledTimes(1);
    });
    it("stops repeated concurrent writes to the same original ID even from different notes", async () => {
        const f = fixture(post());
        let release!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        const basePrepare = f.context.prepare;
        f.context.prepare = async remote => { await waiting; return basePrepare(remote); };
        const first = f.service.prepare("Note.md", POST, f.context);
        await Promise.resolve();
        await expect(f.service.prepare("Other.md", POST, f.context)).rejects.toMatchObject({ code: "operation-active" });
        release();
        await first;
    });
    it("retains only a resource pointer across a new service; old confirmations cannot continue", async () => {
        const f = fixture(post());
        const first = await f.service.prepare("Note.md", POST, f.context);
        f.service.close();
        const restarted = f.newService();
        await expect(restarted.confirm("Note.md", first.operationId, f.context)).rejects.toMatchObject({ code: "operation-missing" });
        const prepared = await restarted.prepare("Note.md", POST, f.context);
        expect(prepared.target.previewId).toBe(first.target.previewId);
        expect(f.client.createDraft).toHaveBeenCalledTimes(1);
    });
});

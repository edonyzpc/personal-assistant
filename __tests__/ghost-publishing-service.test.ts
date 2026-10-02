import { describe, expect, it, jest } from "@jest/globals";
import { GhostClientError, type GhostPost, type GhostPostWrite, type GhostRequestGate } from "../src/ghost-publishing/client";
import { prepareGhostExport } from "../src/ghost-publishing/exporter";
import { GhostPublishingService, type GhostActionContext } from "../src/ghost-publishing/service";
import { prepareGhostRestore, prepareGhostSnapshot } from "../src/ghost-publishing/snapshot";
import { sealCompletedRecord, sealLocalOperation, type GhostCompletedRecord, type GhostLocalOperation, type GhostSnapshot } from "../src/ghost-publishing/state-schema";
import { GhostOperationStore } from "../src/ghost-publishing/state-store";
import { FakeGovernanceIndexedDbFactory } from "./helpers/fake-governance-indexeddb";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const site = "https://synthetic.example/";
const profile = { siteId: "synthetic-site" };
const noteUid = "synthetic-note";
const originalId = "1".repeat(24);
const initialTime = "2026-09-29T09:00:00.000Z";

async function exportText(body: string) {
    const file = { path: "A.md", extension: "md" };
    return prepareGhostExport({ targetPath: file.path, siteProfile: profile,
        host: { vault: { getAbstractFileByPath: () => file, read: async () => body }, parseYaml: () => ({}) },
        guard: { isCurrent: () => true, isPathAllowed: () => true, captureSourceValidity: () => () => true },
    });
}
async function initialSnapshot() {
    return prepareGhostSnapshot({ exported: await exportText("Old body"), profile, resources: [], defaultVisibility: "public" });
}
function makePost(candidate: GhostSnapshot, id = originalId): GhostPost {
    return { ...copy(candidate.content), id, uuid: "11111111-1111-1111-1111-111111111111", slug: "stable-url", url: `${site}stable-url/`,
        authors: [{ id: "2".repeat(24) }], status: "published", updated_at: initialTime };
}

async function setup(existing = false, stableDraftPreview = false) {
    let sequence = 0;
    const prepareOptions: Array<{ regenerateMetadata?: boolean } | undefined> = [];
    let allowed = true;
    let previewCurrent = true;
    let source = existing ? "New body" : "Old body";
    let failRecord = false;
    let failBind = false;
    let createUnknown: "none" | "accepted" | "absent" | "multiple" = "none";
    let updateUnknown = false;
    let cleanupFails = false;
    let revokeOnFinal = false;
    let visibility: "public" | "members" | undefined;
    let draftSlug = "generated-slug";
    let createSlugSuffix = "";
    let includeImage = false;
    let uploadOutcome: "ok" | "failed" | "unknown" = "ok";
    const calls: Array<{ method: string; id?: string; fields?: GhostPostWrite }> = [];
    const bindings: string[] = [];
    const posts = new Map<string, GhostPost>();
    const baseline = await initialSnapshot();
    let record: GhostCompletedRecord | null = null;
    // Persist only the content projection, never raw API response identity fields.
    if (existing) {
        const remote = makePost(baseline);
        posts.set(originalId, remote);
        record = sealCompletedRecord({ schemaVersion: 1, revision: 1,
            binding: { siteId: profile.siteId, site, noteUid, postId: originalId, postUrl: remote.url },
            completed: { postId: originalId, postUrl: remote.url, updatedAt: initialTime, verifiedAt: initialTime, status: "published" },
            baseline: { ...baseline, content: { ...baseline.content, authors: remote.authors } },
        });
    }
    const factory = new FakeGovernanceIndexedDbFactory();
    const operationOptions = { dbName: "service-test", indexedDb: factory as unknown as IDBFactory, isDesktop: () => true };
    let operations = new GhostOperationStore(operationOptions);
    const records = {
        read: async () => record && copy(record),
        write: async (next: GhostCompletedRecord, expected: string | null) => {
            if (failRecord) { failRecord = false; throw new Error("Synthetic disk failure"); }
            if ((record?.checksum ?? null) !== expected) throw new Error("Revision conflict");
            record = copy(next);
        },
    };
    const now = () => new Date(Date.parse(initialTime) + ++sequence * 1000).toISOString();
    const send = async (gate: GhostRequestGate, final = false) => {
        if (final && revokeOnFinal) allowed = false;
        try { await gate.beforeSend(); gate.assertCurrent(); }
        catch { throw new GhostClientError("gate-rejected", "not-sent"); }
    };
    const client = {
        readPost: async (id: string, gate: GhostRequestGate) => {
            await send(gate); calls.push({ method: "GET", id });
            const post = posts.get(id);
            if (!post) throw new GhostClientError("http", "failed", 404);
            return copy(post);
        },
        findPostsByMarker: async (marker: string, gate: GhostRequestGate) => {
            await send(gate); calls.push({ method: "FIND", id: marker });
            return [...posts.values()].filter((post) => post.tags.some((tag) => tag.name === marker)).map(copy);
        },
        createDraft: async (fields: GhostPostWrite, gate: GhostRequestGate) => {
            await send(gate); calls.push({ method: "POST", fields: copy(fields) });
            const id = (++sequence).toString(16).padStart(24, "0");
            const post: GhostPost = { ...makePost(baseline, id), ...copy(fields), status: "draft", lexical: fields.lexical ?? baseline.content.lexical, created_at: now(),
                tags: (fields.tags ?? []).map((tag) => ({ name: tag.name!, ...tag })), updated_at: now() };
            if (fields.slug !== undefined) {
                post.slug = `${fields.slug}${createSlugSuffix}`;
                post.url = `${site}${post.slug}/`;
            } else post.url = `${site}draft-${id}/`;
            if (stableDraftPreview) post.url = `${site}p/${post.uuid}/`;
            if (createUnknown !== "absent") posts.set(id, post);
            if (createUnknown === "multiple") posts.set("f".repeat(24), { ...post, id: "f".repeat(24) });
            if (createUnknown !== "none") throw new GhostClientError("network", "unknown");
            return copy(post);
        },
        updatePost: async (id: string, version: string, fields: GhostPostWrite, gate: GhostRequestGate) => {
            await send(gate, id === originalId); calls.push({ method: "PUT", id, fields: copy(fields) });
            const current = posts.get(id)!;
            if (version !== current.updated_at) throw new GhostClientError("conflict", "failed", 409);
            const updated = {
                ...current,
                ...copy(fields),
                ...(fields.slug !== undefined ? { url: stableDraftPreview && current.status === "draft"
                    ? current.url : `${site}${fields.slug}/` } : {}),
                updated_at: now(),
            } as GhostPost;
            posts.set(id, updated);
            if (updateUnknown) throw new GhostClientError("network", "unknown");
            return copy(updated);
        },
        deleteDraft: async (id: string, gate: GhostRequestGate) => {
            await send(gate); calls.push({ method: "DELETE", id });
            if (cleanupFails) throw new GhostClientError("network", "unknown");
            posts.delete(id);
        },
        uploadImage: async (image: { bytes: Uint8Array }, gate: GhostRequestGate) => {
            await send(gate);
            const [pending] = (await operations.list(profile.siteId, noteUid)).filter((item) => item.state !== "terminal");
            expect(pending.state).toBe("pending");
            expect(pending.pending?.kind).toBe("resource_upload");
            expect(image.bytes).toEqual(new Uint8Array([1, 2, 3]));
            calls.push({ method: "UPLOAD" });
            if (uploadOutcome !== "ok") throw new GhostClientError("network", uploadOutcome);
            return { url: `${site}content/images/synthetic.png` };
        },
    };
    const preparedImage = () => ({ metadata: { id: "image-1", source: "cover.png", resolvedPath: "cover.png",
        byteHash: "ab".repeat(32), byteLength: 3, mimeType: "image/png" }, bytes: new Uint8Array([1, 2, 3]), filename: "synthetic.png" });
    const newContext = (): GhostActionContext => ({
        gate: { assertCurrent: () => { if (!allowed) throw new Error("Scope revoked"); }, beforeSend: async () => { if (!allowed) throw new Error("Scope revoked"); } },
        prepare: async (remote, completed, kind, previous, options) => {
            prepareOptions.push(options);
            const exported = await exportText(source);
            let candidate = kind === "restore"
                ? prepareGhostRestore(completed!.lastUndo!, remote!, profile)
                : prepareGhostSnapshot({ exported, profile, resources: [], defaultVisibility: "public", remote: remote ?? undefined, baseline: completed?.baseline ?? previous });
            if (visibility) candidate = { ...candidate, content: { ...candidate.content, visibility }, managedFields: [...candidate.managedFields, "visibility"] };
            if (includeImage) candidate = { ...candidate, content: { ...candidate.content, feature_image: "pending-resource://image-1" },
                resources: [preparedImage().metadata], managedFields: [...candidate.managedFields, "feature_image"] };
            return {
                candidate,
                currentSource: exported.sourceManifest,
                currentIntentHash: exported.candidateHash,
                images: includeImage ? [preparedImage()] : [],
                ...(remote === null && kind === "create" ? { slugCandidate: draftSlug } : {}),
            };
        },
        validate: async (operation, purpose = "candidate") => {
            if (!allowed) throw new Error("Scope revoked");
            if (purpose !== "candidate") return;
            const exported = await exportText(source);
            if (exported.sourceManifest.dependencies[0].contentHash !== operation.currentSource?.dependencies[0].contentHash) throw new Error("Source changed");
        },
        readImage: async () => { if (!includeImage) throw new Error("No fixture image expected"); return preparedImage(); },
        prepareDraftSlug: async () => ({ slug: draftSlug, currentIntentHash: "0".repeat(64) }),
        bind: async (post) => {
            if (!allowed) throw new Error("Scope revoked");
            if (failBind) { failBind = false; throw new Error("Synthetic binding failure"); }
            bindings.push(post.id);
        },
    });
    const newService = () => new GhostPublishingService({ siteId: profile.siteId, site, isDesktop: () => true,
        client, operations, records, newId: () => `op-${++sequence}`, now });
    let service = newService();
    let context = newContext();
    const ready = (operation: GhostLocalOperation) => service.checkPreview(noteUid, operation.operationId, context,
        async (_operation, candidateHash) => ({ candidateHash, passed: true, isCurrent: () => previewCurrent }));
    return {
        get service() { return service; }, get context() { return context; }, get record() { return record; },
        prepareOptions,
        calls, posts, bindings, ready, get operations() { return operations; },
        setSource: (value: string) => { source = value; }, setAllowed: (value: boolean) => { allowed = value; },
        setPreviewCurrent: (value: boolean) => { previewCurrent = value; },
        setCreateUnknown: (value: typeof createUnknown) => { createUnknown = value; },
        setUpdateUnknown: () => { updateUnknown = true; }, failRecord: () => { failRecord = true; },
        failBind: () => { failBind = true; },
        setCleanupFails: () => { cleanupFails = true; }, revokeOnFinal: () => { revokeOnFinal = true; },
        setVisibility: () => { visibility = "members"; },
        setDraftSlug: (value: string) => { draftSlug = value; },
        setCreateSlugSuffix: (value: string) => { createSlugSuffix = value; },
        setImage: (outcome: typeof uploadOutcome = "ok") => { includeImage = true; uploadOutcome = outcome; },
        loseRecord: () => { record = null; },
        restart: () => { operations.close(); operations = new GhostOperationStore(operationOptions); context = newContext(); service = newService(); },
        // Unit-level independent local storage; this is not the two-device app gate.
        useFreshDesktopStore: () => {
            operations.close();
            operations = new GhostOperationStore({ ...operationOptions,
                indexedDb: new FakeGovernanceIndexedDbFactory() as unknown as IDBFactory });
            context = newContext(); service = newService();
        },
    };
}

describe("Ghost persistent publishing service", () => {
    it("uses readable versioned markers and queries both source identity formats completely", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        expect((operation as unknown as { markerVersion?: number }).markerVersion).toBe(2);
        const draft = app.posts.get(operation.target.previewId!)!;
        expect(draft.tags.map((tag) => tag.name)).toEqual(expect.arrayContaining([
            `#PA Draft ${operation.operationId}`,
            `#PA Note ${noteUid}`,
        ]));
        const queried = app.calls.filter((call) => call.method === "FIND").map((call) => call.id);
        expect(queried).toEqual(expect.arrayContaining([
            `#PA Note ${noteUid}`,
            `#pa-ghost-op-${noteUid}`,
        ]));
    });

    it("creates an English slug once and preserves it across reprepare and metadata regeneration", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        expect(app.posts.get(operation.target.previewId!)?.slug).toBe("generated-slug");
        expect(operation.resolvedSlug).toBe("generated-slug");
        const createPut = app.calls.filter((call) => call.method === "POST").at(-1)!;
        expect(createPut.fields?.slug).toBe("generated-slug");

        app.setSource("Changed title and body");
        app.setDraftSlug("unwanted-new-url");
        const next = await app.service.reprepare(noteUid, operation.operationId, app.context);
        expect(next.resolvedSlug).toBe("generated-slug");
        expect(next.slugCandidate).toBeUndefined();
        const previewPut = app.calls.filter((call) => call.method === "PUT").at(-1)!;
        expect(previewPut.fields?.slug).toBeUndefined();
        expect(app.posts.get(next.target.previewId!)?.slug).toBe("generated-slug");

        const regenerated = await app.service.reprepare(noteUid, next.operationId, app.context, { regenerateMetadata: true });
        expect(regenerated.resolvedSlug).toBe("generated-slug");
        expect(app.calls.filter((call) => call.method === "PUT").at(-1)?.fields?.slug).toBeUndefined();
    });

    it("accepts a Ghost collision suffix longer than the strict slug request limit", async () => {
        const app = await setup();
        const requested = "a".repeat(80);
        app.setDraftSlug(requested);
        app.setCreateSlugSuffix("-2");
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        expect(operation.slugCandidate).toBe(requested);
        expect(operation.resolvedSlug).toBe(`${requested}-2`);
        expect(operation.target.postUrl).toBe(`${site}${requested}-2/`);
        expect(operation.target.postId).toBeDefined();
        expect(app.posts.get(operation.target.postId!)?.slug).toBe(`${requested}-2`);
    });

    it("retains a created ID with a collision slug before a binding failure and never posts again", async () => {
        const app = await setup();
        app.setDraftSlug("a".repeat(80));
        app.setCreateSlugSuffix("-2");
        app.failBind();
        await expect(app.service.prepare(noteUid, undefined, app.context)).rejects.toThrow("Synthetic binding failure");
        const [known] = await app.operations.list(profile.siteId, noteUid);
        expect(known.target.postId).toBeDefined();
        expect(known.target.postUrl).toBe(`${site}${"a".repeat(80)}-2/`);
        app.restart();
        const resolved = await app.service.refresh(noteUid, known.operationId, app.context);
        expect(resolved.target.postId).toBe(known.target.postId);
        expect(app.calls.filter(call => call.method === "POST")).toHaveLength(1);
    });

    it("recovers a legacy unknown create with a long or non-ASCII actual slug", async () => {
        for (const actualSlug of ["pinyin-".repeat(20).slice(0, -1), "旧文章地址"]) {
            const app = await setup();
            app.setCreateUnknown("accepted");
            await expect(app.service.prepare(noteUid, undefined, app.context)).rejects.toThrow("network");
            const [unknown] = await app.operations.list(profile.siteId, noteUid);
            const legacyBody = copy(unknown);
            delete legacyBody.markerVersion;
            delete legacyBody.slugCandidate;
            delete legacyBody.resolvedSlug;
            delete legacyBody.currentNonSlugIntentHash;
            delete legacyBody.candidate.slug;
            const marker = `#pa-ghost-op-${unknown.operationId}`;
            const legacy = sealLocalOperation({ ...legacyBody, revision: unknown.revision + 1,
                pending: { ...unknown.pending!, marker } });
            await app.operations.save(legacy, unknown.revision);
            const remote = [...app.posts.values()][0];
            remote.tags = [{ name: marker }, { name: `#pa-ghost-op-${noteUid}` }];
            remote.slug = actualSlug;
            remote.url = `${site}${actualSlug}/`;
            app.restart();
            const resolved = await app.service.refresh(noteUid, legacy.operationId, app.context);
            expect(resolved.target.postId).toBe(remote.id);
            expect(resolved.resolvedSlug).toBe(actualSlug);
            expect(resolved.markerVersion).toBeUndefined();
            expect(app.calls.filter(call => call.method === "POST")).toHaveLength(1);
        }
    });

    it("changes only the slug of an explicit original draft and binds the returned URL", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        app.setDraftSlug("manual-draft-url");
        const changed = await app.service.changeDraftUrl(noteUid, operation.operationId, app.context);
        const put = app.calls.filter((call) => call.method === "PUT").at(-1)!;
        expect(put.id).toBe(operation.target.postId);
        expect(put.fields).toEqual({ slug: "manual-draft-url" });
        expect(changed.target.postId).toBe(operation.target.postId);
        expect(changed.target.postUrl).toBe(`${site}manual-draft-url/`);
        expect(changed.resolvedSlug).toBe("manual-draft-url");
        expect(app.bindings.at(-1)).toBe(operation.target.postId);
    });

    it("uses a same-ID readback after an unknown draft URL update instead of retrying", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        app.setDraftSlug("unknown-result-url");
        app.setUpdateUnknown();
        await expect(app.service.changeDraftUrl(noteUid, operation.operationId, app.context)).rejects.toThrow("network");
        const [unknown] = (await app.operations.list(profile.siteId, noteUid)).filter((item) => item.operationId === operation.operationId);
        expect(unknown.state).toBe("outcome_unknown");
        expect(unknown.pending).toMatchObject({ kind: "change_draft_slug", slug: "unknown-result-url", targetId: operation.target.postId });
        const putsBeforeRefresh = app.calls.filter((call) => call.method === "PUT").length;
        app.restart();
        const resolved = await app.service.refresh(noteUid, operation.operationId, app.context);
        expect(resolved.state).toBe("prepared");
        expect(resolved.target.postId).toBe(operation.target.postId);
        expect(resolved.target.postUrl).toBe(`${site}unknown-result-url/`);
        expect(resolved.resolvedSlug).toBe("unknown-result-url");
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(putsBeforeRefresh);
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
    });

    it.each([false, true])("accepts Ghost's stable UUID draft preview after slug-only PUT (unknown=%s)", async (unknown) => {
        const app = await setup(false, true);
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        const before = copy(app.posts.get(operation.target.postId!)!);
        app.setDraftSlug("human-time-while-ai-agents-work");
        let changed: GhostLocalOperation;
        if (unknown) {
            app.setUpdateUnknown();
            await expect(app.service.changeDraftUrl(noteUid, operation.operationId, app.context)).rejects.toThrow("network");
            app.restart();
            changed = await app.service.refresh(noteUid, operation.operationId, app.context);
        } else changed = await app.service.changeDraftUrl(noteUid, operation.operationId, app.context);
        expect(changed.state).toBe("prepared");
        expect(changed.resolvedSlug).toBe("human-time-while-ai-agents-work");
        expect(changed.target.postId).toBe(before.id);
        expect(changed.target.postUrl).toBe(before.url);
        expect(app.posts.get(before.id)).toEqual({ ...before, slug: changed.resolvedSlug, updated_at: changed.target.postVersion });
        expect(app.calls.filter(call => call.method === "PUT")).toEqual([
            { method: "PUT", id: before.id, fields: { slug: "human-time-while-ai-agents-work" } },
        ]);
        expect(app.calls.filter(call => call.method === "POST")).toHaveLength(1);
        expect(app.bindings.at(-1)).toBe(before.id);
    });

    it("does not accept an unchanged draft preview URL for a different post UUID", async () => {
        const app = await setup(false, true);
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        app.posts.get(operation.target.postId!)!.uuid = "22222222-2222-2222-2222-222222222222";
        app.setDraftSlug("human-time-while-ai-agents-work");
        await expect(app.service.changeDraftUrl(noteUid, operation.operationId, app.context))
            .rejects.toMatchObject({ code: "result-unknown" });
        app.restart();
        await expect(app.service.refresh(noteUid, operation.operationId, app.context))
            .rejects.toMatchObject({ code: "result-unknown" });
        expect(app.calls.filter(call => call.method === "POST")).toHaveLength(1);
        expect(app.calls.filter(call => call.method === "PUT")).toHaveLength(1);
        expect(app.bindings).toHaveLength(1);
    });

    it("verifies a numeric collision suffix and later publication after an unknown slug-only PUT", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        app.setDraftSlug("wanted-slug");
        app.setUpdateUnknown();
        await expect(app.service.changeDraftUrl(noteUid, operation.operationId, app.context)).rejects.toThrow("network");
        const remote = app.posts.get(operation.target.postId!)!;
        remote.slug = "wanted-slug-2";
        remote.url = `${site}wanted-slug-2/`;
        remote.status = "published";
        remote.published_at = "2026-09-29T11:00:00.000Z";
        remote.updated_at = "2026-09-29T11:00:00.000Z";
        const writesBefore = app.calls.filter(call => ["POST", "PUT"].includes(call.method)).length;
        app.restart();
        const resolved = await app.service.refresh(noteUid, operation.operationId, app.context);
        expect(resolved.state).toBe("terminal");
        expect(app.record?.binding.postUrl).toBe(`${site}wanted-slug-2/`);
        expect(app.calls.filter(call => ["POST", "PUT"].includes(call.method))).toHaveLength(writesBefore);
    });

    it("stops URL replacement when the original draft is published during slug preparation", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        app.context.prepareDraftSlug = async () => {
            const remote = app.posts.get(operation.target.postId!)!;
            remote.status = "published";
            remote.updated_at = "2026-09-29T11:00:00.000Z";
            return { slug: "wanted-slug", currentIntentHash: "0".repeat(64) };
        };
        await expect(app.service.changeDraftUrl(noteUid, operation.operationId, app.context))
            .rejects.toMatchObject({ code: "remote-conflict" });
        expect(app.calls.filter(call => call.method === "PUT")).toHaveLength(0);
        expect(app.posts.get(operation.target.postId!)?.slug).toBe("generated-slug");
    });

    it("retains an unknown draft URL request when a human changes the draft URL and content", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        app.setDraftSlug("wanted-slug");
        app.setUpdateUnknown();
        await expect(app.service.changeDraftUrl(noteUid, operation.operationId, app.context)).rejects.toThrow("network");
        const remote = app.posts.get(operation.target.postId!)!;
        remote.slug = "human-other-url";
        remote.url = `${site}human-other-url/`;
        remote.title = "Human edited title";
        remote.updated_at = "2026-09-29T11:00:00.000Z";
        const bindingsBeforeReadback = app.bindings.length;
        app.restart();
        await expect(app.service.refresh(noteUid, operation.operationId, app.context))
            .rejects.toMatchObject({ code: "result-unknown" });
        const [retained] = (await app.operations.list(profile.siteId, noteUid))
            .filter((item) => item.operationId === operation.operationId);
        expect(retained.state).toBe("outcome_unknown");
        expect(retained.pending).toMatchObject({ kind: "change_draft_slug", slug: "wanted-slug" });
        expect(app.bindings).toHaveLength(bindingsBeforeReadback);
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
    });

    it("does not adopt an arbitrary URL merely because a concurrently published draft matches content", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        app.setDraftSlug("wanted-slug");
        app.setUpdateUnknown();
        await expect(app.service.changeDraftUrl(noteUid, operation.operationId, app.context)).rejects.toThrow("network");
        const remote = app.posts.get(operation.target.postId!)!;
        remote.slug = "human-other-url";
        remote.url = `${site}human-other-url/`;
        remote.status = "published";
        remote.updated_at = "2026-09-29T11:00:00.000Z";
        app.restart();
        await expect(app.service.refresh(noteUid, operation.operationId, app.context))
            .rejects.toMatchObject({ code: "result-unknown" });
        const [retained] = (await app.operations.list(profile.siteId, noteUid))
            .filter((item) => item.operationId === operation.operationId);
        expect(retained.state).toBe("outcome_unknown");
        expect(app.record).toBeNull();
    });

    it("does not offer or execute draft URL replacement for a published original", async () => {
        const app = await setup(true);
        const operation = await app.service.prepare(noteUid, originalId, app.context);
        await expect(app.service.changeDraftUrl(noteUid, operation.operationId, app.context))
            .rejects.toThrow("remote-conflict");
        expect(app.calls.filter((call) => call.method === "PUT" && call.fields?.slug !== undefined)).toHaveLength(0);
    });

    it.each(["ok", "failed", "unknown"] as const)("persists image requests before upload and handles %s without an extra article", async (outcome) => {
        const app = await setup();
        app.setImage(outcome);
        const action = app.service.prepare(noteUid, undefined, app.context);
        if (outcome === "ok") {
            const operation = await action;
            expect(operation.candidate.content.feature_image).toBe(`${site}content/images/synthetic.png`);
            await app.service.refresh(noteUid, operation.operationId, app.context);
            expect(app.calls.filter((call) => call.method === "UPLOAD")).toHaveLength(1);
        } else {
            await expect(action).rejects.toThrow("network");
            expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(0);
            const [operation] = await app.operations.list(profile.siteId, noteUid);
            app.setImage("ok");
            if (outcome === "failed") {
                await app.service.refresh(noteUid, operation.operationId, app.context);
                expect(app.calls.filter((call) => call.method === "UPLOAD")).toHaveLength(2);
            } else {
                await expect(app.service.refresh(noteUid, operation.operationId, app.context)).rejects.toThrow("resource-result-unknown");
                expect(app.calls.filter((call) => call.method === "UPLOAD")).toHaveLength(1);
            }
        }
    });

    it("saves a draft identity immediately and only records publication after explicit readback", async () => {
        const app = await setup();
        const operation = await app.service.prepare(noteUid, undefined, app.context);
        expect(operation.state).toBe("prepared");
        expect(app.record).toBeNull();
        expect(app.bindings).toEqual([operation.target.postId]);
        app.setSource("A later local edit while the prepared draft is still remote");
        const stillDraft = await app.service.refresh(noteUid, operation.operationId, app.context);
        expect(stillDraft.state).toBe("prepared");
        await expect(app.ready(stillDraft)).rejects.toThrow("gate-rejected");
        const post = app.posts.get(operation.target.postId!)!;
        post.status = "published"; post.updated_at = "2026-09-29T10:00:00.000Z"; post.published_at = post.updated_at;
        app.restart();
        const done = await app.service.refresh(noteUid, operation.operationId, app.context);
        expect(done.state).toBe("terminal");
        expect(app.record?.binding.postId).toBe(post.id);
        expect(app.record?.lastUndo).toBeUndefined();
        expect(app.record?.baseline.content.tags).toEqual(post.tags.map(({ id, name }) => id ? { id, name } : { name }));
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
        expect(app.record?.baseline.content.lexical).toContain("Old body");
        app.setSource("Later update on the completed article");
        const update = await app.service.prepare(noteUid, post.id, app.context);
        expect(update.target.postId).toBe(post.id);
        expect(update.target.previewId).not.toBe(post.id);
    });

    it("writes the original only after current preview confirmation, preserves identity, and captures one undo", async () => {
        const app = await setup(true);
        const operation = await app.service.prepare(noteUid, originalId, app.context);
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
        const ticket = await app.ready(operation);
        const done = await app.service.confirm(noteUid, ticket, app.context);
        expect(done.state).toBe("terminal");
        expect(app.record?.baseline.content.lexical).toContain("New body");
        expect(app.record?.lastUndo?.content.lexical).toContain("Old body");
        expect(app.posts.get(originalId)).toMatchObject({ id: originalId, slug: "stable-url", url: `${site}stable-url/`, status: "published", authors: [{ id: "2".repeat(24) }] });
        expect(app.calls.filter((call) => call.method === "DELETE").map((call) => call.id)).toEqual([operation.target.previewId]);
        await expect(app.service.confirm(noteUid, ticket, app.context)).rejects.toThrow("confirmation-required");
        const writes = app.calls.filter((call) => call.method === "PUT");
        expect(writes).toHaveLength(1);
        expect(writes[0].fields).not.toHaveProperty("status");
        expect(writes[0].fields).not.toHaveProperty("newsletter");
    });

    it.each(["before preparation", "after preparation"] as const)(
        "rejects an image-bearing update before any durable write when source is revoked %s",
        async phase => {
            const app = await setup(true);
            app.setImage();
            const originalPrepare = app.context.prepare;
            let preparedCandidate: GhostSnapshot | undefined;
            const prepare = jest.spyOn(app.context, "prepare").mockImplementation(async (...args) => {
                const prepared = await originalPrepare(...args);
                preparedCandidate = prepared.candidate;
                return prepared;
            });
            const originalValidate = app.context.validate;
            const validate = jest.spyOn(app.context, "validate").mockImplementation(async (...args) => {
                if (phase === "after preparation") app.setAllowed(false);
                return originalValidate(...args);
            });
            const save = jest.spyOn(app.operations, "save");
            if (phase === "before preparation") app.setAllowed(false);
            try {
                await expect(app.service.prepare(noteUid, originalId, app.context)).rejects.toThrow("Scope revoked");
                if (phase === "after preparation") {
                    expect(prepare).toHaveBeenCalledTimes(1);
                    expect(preparedCandidate).toMatchObject({
                        content: { feature_image: "pending-resource://image-1" },
                        resources: [expect.objectContaining({ id: "image-1" })],
                    });
                    expect(validate).toHaveBeenCalledTimes(1);
                } else {
                    expect(prepare).not.toHaveBeenCalled();
                    expect(validate).not.toHaveBeenCalled();
                    expect(app.calls).toEqual([]);
                }
                expect(save).not.toHaveBeenCalled();
                expect(await app.operations.list(profile.siteId, noteUid)).toEqual([]);
                expect(app.calls.filter(({ method }) => ["UPLOAD", "POST", "PUT", "DELETE"].includes(method))).toEqual([]);
            } finally {
                app.operations.close();
            }
        },
    );

    it("re-prepares changed source in the same local operation and requires a new ticket", async () => {
        const app = await setup(true);
        const operation = await app.service.prepare(noteUid, originalId, app.context);
        const oldTicket = await app.ready(operation);
        app.setSource("Last local revision");
        const next = await app.service.reprepare(noteUid, operation.operationId, app.context);
        expect(next.target.previewId).toBe(operation.target.previewId);
        expect(next.candidate.content.lexical).toContain("Last local revision");
        await expect(app.service.confirm(noteUid, oldTicket, app.context)).rejects.toThrow("confirmation-required");
        await app.service.confirm(noteUid, await app.ready(next), app.context);
        expect(app.posts.get(originalId)?.lexical).toContain("Last local revision");
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
        expect(app.calls.filter((call) => call.method === "PUT" && call.id === originalId)).toHaveLength(1);
    });

    it("passes the explicit metadata regeneration intent and invalidates the old confirmation", async () => {
        const app = await setup(true);
        const operation = await app.service.prepare(noteUid, originalId, app.context);
        const oldTicket = await app.ready(operation);
        app.prepareOptions.length = 0;
        const next = await app.service.reprepare(noteUid, operation.operationId, app.context, {
            regenerateMetadata: true,
        });
        expect(app.prepareOptions.at(-1)).toEqual({ regenerateMetadata: true });
        expect(next.target.previewId).toBe(operation.target.previewId);
        expect(next.target.previewHash).toBeDefined();
        await expect(app.service.confirm(noteUid, oldTicket, app.context)).rejects.toThrow("confirmation-required");
    });

    it.each(["source", "preview", "restart", "dispatch"] as const)("invalidates %s changes before an original-post write", async (kind) => {
        const app = await setup(true);
        const operation = await app.service.prepare(noteUid, originalId, app.context);
        const ticket = await app.ready(operation);
        if (kind === "source") app.setSource("Changed after preview");
        if (kind === "preview") app.setPreviewCurrent(false);
        if (kind === "restart") app.restart();
        if (kind === "dispatch") app.revokeOnFinal();
        await expect(app.service.confirm(noteUid, ticket, app.context)).rejects.toThrow();
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
        expect(app.posts.get(originalId)?.lexical).toContain("Old body");
    });

    it.each(["accepted", "absent", "multiple"] as const)("reconciles a %s unknown draft POST without creating another article", async (outcome) => {
        const app = await setup();
        app.setCreateUnknown(outcome);
        await expect(app.service.prepare(noteUid, undefined, app.context)).rejects.toThrow("network");
        const [pending] = await app.operations.list(profile.siteId, noteUid);
        expect(pending.state).toBe("outcome_unknown");
        app.restart();
        const action = app.service.refresh(noteUid, pending.operationId, app.context);
        if (outcome === "accepted") expect((await action).target.postId).toBeDefined();
        else await expect(action).rejects.toThrow("result-unknown");
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
    });

    it.each(["format-only", "substantive-change"] as const)("verifies a manually published unknown create with %s", async (change) => {
        const app = await setup();
        app.setCreateUnknown("accepted");
        await expect(app.service.prepare(noteUid, undefined, app.context)).rejects.toThrow("network");
        const [pending] = await app.operations.list(profile.siteId, noteUid);
        const post = app.posts.get(pending.target.postId ?? [...app.posts.keys()].at(-1)!)!;
        const lexical = JSON.parse(post.lexical!);
        if (change === "format-only") lexical.root.children[0].children[0].format = 1;
        else lexical.root.children[0].children[0].text += " changed";
        post.lexical = JSON.stringify(lexical);
        post.status = "published";
        post.updated_at = "2026-09-29T10:30:00.000Z";
        post.published_at = post.updated_at;
        app.restart();
        const action = app.service.refresh(noteUid, pending.operationId, app.context);
        if (change === "format-only") {
            const done = await action;
            expect(done.state).toBe("terminal");
            expect(done.target.postId).toBe(post.id);
            expect(app.record?.binding.postId).toBe(post.id);
            expect(app.record?.baseline.content.lexical).toBe(post.lexical);
        } else {
            await expect(action).rejects.toThrow("result-unknown");
            expect(app.record).toBeNull();
        }
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
    });

    it("never adopts a manually published update preview as the formal article", async () => {
        const app = await setup(true);
        const originalRecord = copy(app.record!);
        app.setCreateUnknown("accepted");
        await expect(app.service.prepare(noteUid, originalId, app.context)).rejects.toThrow("network");
        const [pending] = await app.operations.list(profile.siteId, noteUid);
        const preview = [...app.posts.values()].find((post) => post.id !== originalId && post.status === "draft")!;
        preview.status = "published";
        preview.updated_at = "2026-09-29T10:45:00.000Z";
        preview.published_at = preview.updated_at;
        app.restart();
        await expect(app.service.refresh(noteUid, pending.operationId, app.context)).rejects.toThrow("result-unknown");
        const [saved] = await app.operations.list(profile.siteId, noteUid);
        expect(saved.target.postId).toBe(originalId);
        expect(saved.target.postUrl).toBe(originalRecord.binding.postUrl);
        expect(app.record?.checksum).toBe(originalRecord.checksum);
        expect(app.bindings).not.toContain(preview.id);
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
    });

    it.each(["format-only", "substantive-change"] as const)("reconciles a manually published first-draft save with %s", async (change) => {
        const app = await setup();
        const first = await app.service.prepare(noteUid, undefined, app.context);
        const postId = first.target.postId!;
        app.setSource("First local revision");
        app.setUpdateUnknown();
        await expect(app.service.reprepare(noteUid, first.operationId, app.context)).rejects.toThrow("network");
        const [pending] = await app.operations.list(profile.siteId, noteUid);
        expect(pending.pending?.kind).toBe("save_preview");
        expect(pending.target.postId).toBe(postId);

        const post = app.posts.get(postId)!;
        const lexical = JSON.parse(post.lexical!);
        if (change === "format-only") lexical.root.children[0].children[0].format = 1;
        else lexical.root.children[0].children[0].text += " changed";
        post.lexical = JSON.stringify(lexical);
        post.status = "published";
        post.updated_at = "2026-09-29T11:00:00.000Z";
        post.published_at = post.updated_at;
        app.restart();

        const action = app.service.refresh(noteUid, pending.operationId, app.context);
        if (change === "format-only") {
            const done = await action;
            expect(done.state).toBe("terminal");
            expect(done.target.postId).toBe(postId);
            expect(app.record?.binding.postId).toBe(postId);
            expect(app.record?.baseline.content.lexical).toBe(post.lexical);
        } else {
            await expect(action).rejects.toThrow("result-unknown");
            expect(app.record).toBeNull();
        }
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    });

    it("reconciles an accepted unknown PUT and repairs a failed record without sending another PUT", async () => {
        const app = await setup(true);
        const operation = await app.service.prepare(noteUid, originalId, app.context);
        const ticket = await app.ready(operation);
        app.setUpdateUnknown();
        await expect(app.service.confirm(noteUid, ticket, app.context)).rejects.toThrow("network");
        app.setSource("New edits after the request was sent");
        app.failRecord(); app.restart();
        await expect(app.service.refresh(noteUid, operation.operationId, app.context)).rejects.toThrow("record-pending");
        app.setSource("More edits while the completed record is still pending");
        app.setAllowed(false);
        await expect(app.service.refresh(noteUid, operation.operationId, app.context)).rejects.toThrow("Scope revoked");
        app.setAllowed(true);
        app.restart();
        const done = await app.service.refresh(noteUid, operation.operationId, app.context);
        expect(done.state).toBe("terminal");
        expect(app.record?.baseline.content.lexical).toContain("New body");
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    });

    it.each(["retained", "pending"] as const)("keeps %s cleanup separate through later updates", async (cleanupState) => {
        const app = await setup(true);
        const first = await app.service.prepare(noteUid, originalId, app.context);
        app.setCleanupFails();
        const completed = await app.service.confirm(noteUid, await app.ready(first), app.context);
        expect(completed.state).toBe("cleanup_pending");
        const retained = app.posts.get(first.target.previewId!)!;
        if (cleanupState === "retained") {
            retained.title = "Human edited preview";
            retained.updated_at = "2026-09-29T12:00:00.000Z";
            expect((await app.service.refresh(noteUid, first.operationId, app.context)).state).toBe("terminal");
        }
        for (const body of ["Second update", "Third update"]) {
            app.setSource(body);
            app.restart();
            const next = await app.service.prepare(noteUid, originalId, app.context);
            await app.service.refresh(noteUid, first.operationId, app.context);
            await app.service.confirm(noteUid, await app.ready(next), app.context);
            expect(app.record?.baseline.content.lexical).toContain(body);
        }
        const owned = await app.operations.list(profile.siteId, noteUid);
        expect(owned.find((operation) => operation.operationId === first.operationId)?.cleanup?.postId).toBe(retained.id);
        expect(app.posts.has(retained.id)).toBe(true);
        expect(app.calls.filter((call) => call.method === "PUT" && call.id === originalId)).toHaveLength(3);
    });

    it("starts a fresh desktop update after a completed version despite a later human edit to its old preview", async () => {
        const app = await setup(true);
        const first = await app.service.prepare(noteUid, originalId, app.context);
        app.setCleanupFails();
        await app.service.confirm(noteUid, await app.ready(first), app.context);
        const retained = app.posts.get(first.target.previewId!)!;
        retained.title = "Human edited old preview";
        retained.updated_at = "2026-09-29T12:00:00.000Z";
        await app.service.refresh(noteUid, first.operationId, app.context);
        const deleteAttempts = app.calls.filter((call) => call.method === "DELETE").length;
        app.useFreshDesktopStore();
        expect((await app.operations.list(profile.siteId, noteUid)).length).toBe(0);
        app.setSource("Fresh desktop update");
        const next = await app.service.prepare(noteUid, originalId, app.context);
        expect(next.target.postId).toBe(originalId);
        expect(next.target.previewId).not.toBe(retained.id);
        expect(app.posts.get(retained.id)?.title).toBe("Human edited old preview");
        expect(app.calls.filter((call) => call.method === "DELETE")).toHaveLength(deleteAttempts);
    });

    it.each(["newer", "equal", "missing"] as const)("still rejects another desktop preview with %s creation evidence", async (time) => {
        const app = await setup(true);
        const pending = await app.service.prepare(noteUid, originalId, app.context);
        const remote = app.posts.get(pending.target.previewId!)!;
        if (time === "equal") remote.created_at = app.record!.completed.updatedAt;
        if (time === "missing") delete remote.created_at;
        app.useFreshDesktopStore();
        await expect(app.service.prepare(noteUid, originalId, app.context)).rejects.toThrow("other-desktop");
        expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
        expect(app.posts.has(remote.id)).toBe(true);
    });

    it("restores historical content while the local note stays different and treats cleanup separately", async () => {
        const app = await setup(true);
        const update = await app.service.prepare(noteUid, originalId, app.context);
        await app.service.confirm(noteUid, await app.ready(update), app.context);
        app.setSource("Current note now has more changes");
        const restore = await app.service.prepare(noteUid, originalId, app.context, true);
        expect(restore.candidate.content.lexical).toContain("Old body");
        app.setCleanupFails();
        const done = await app.service.confirm(noteUid, await app.ready(restore), app.context);
        expect(done.state).toBe("cleanup_pending");
        expect(app.record?.baseline.content.lexical).toContain("Old body");
        expect(app.record?.lastUndo).toBeUndefined();
        const temp = app.posts.get(restore.target.previewId!)!;
        temp.status = "published";
        app.restart();
        expect((await app.service.refresh(noteUid, restore.operationId, app.context)).state).toBe("terminal");
        expect(app.posts.has(temp.id)).toBe(true);
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(2);
    });

    it("requires completed records on another desktop and separately confirms visibility changes", async () => {
        const missing = await setup(true);
        missing.loseRecord();
        await expect(missing.service.prepare(noteUid, originalId, missing.context)).rejects.toThrow("sync-required");
        expect(missing.calls.filter((call) => call.method === "POST")).toHaveLength(0);
        const app = await setup(true);
        app.setVisibility();
        const operation = await app.service.prepare(noteUid, originalId, app.context);
        await expect(app.service.confirm(noteUid, await app.ready(operation), app.context)).rejects.toThrow("confirmation-required");
        expect(app.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
        await app.service.confirm(noteUid, await app.ready(operation), app.context, true);
        expect(app.posts.get(originalId)?.visibility).toBe("members");
    });
});

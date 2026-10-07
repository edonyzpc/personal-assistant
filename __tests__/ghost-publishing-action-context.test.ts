import { describe, expect, it, jest } from "@jest/globals";
import { createGhostActionContext, type GhostActionContextOptions, type GhostActionHost, type GhostMetadataGenerator } from "../src/ghost-publishing/action-context";
import type { GhostPost, GhostRequestGate } from "../src/ghost-publishing/client";
import type { GhostActionContext } from "../src/ghost-publishing/service";
import type { GhostLocalOperation } from "../src/ghost-publishing/state-schema";
import type { GhostPublishingSourceFile, SitePublishingProfile } from "../src/ghost-publishing/types";

const SITE = "https://ghost.example/";
const POST = "a".repeat(24);
const NOW = "2026-09-29T08:00:00.000Z";
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
interface File extends GhostPublishingSourceFile { text: string; bytes: Uint8Array; revision: number; stat: { mtime: number; size: number } }

function info(markdown: string) {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
    return match ? { exists: true, frontmatter: match[1], contentStart: match[0].length }
        : { exists: false, frontmatter: "", contentStart: 0 };
}
function properties(file: File): Record<string, unknown> { return info(file.text).exists ? JSON.parse(info(file.text).frontmatter) : {}; }
function body(file: File): string { return file.text.slice(info(file.text).contentStart); }
function text(content: string, fields: Record<string, unknown> = {}): string { return `---\n${JSON.stringify(fields)}\n---\n${content}`; }

function fixture(content = "Current paragraph.") {
    const files: File[] = [
        { path: "Article.md", extension: "md", text: text(content), bytes: new Uint8Array(), revision: 1, stat: { mtime: 1, size: 100 } },
        { path: "Embed.md", extension: "md", text: text("Embedded paragraph."), bytes: new Uint8Array(), revision: 1, stat: { mtime: 1, size: 100 } },
        { path: "cover.png", extension: "png", text: "", bytes: bytes.slice(), revision: 1, stat: { mtime: 1, size: bytes.length } },
    ];
    const state = { receipt: true, current: true, desktop: true, web: true, denied: "", connection: "config-1-key-ref-revision-1",
        profile: { siteId: "site-a" } as SitePublishingProfile, readHook: undefined as undefined | (() => Promise<void>) };
    const controller = new AbortController();
    const replace = (file: File, content: string, fields = properties(file)) => {
        file.text = text(content, fields);
        file.revision++;
        // Deliberately preserve mtime/size: generation and actual content are distinct evidence.
    };
    const read = jest.fn(async (source: GhostPublishingSourceFile) => {
        await state.readHook?.();
        if ((source as File).text.includes("#no-ai")) throw Object.assign(new Error("Source denied"), { code: "source-revoked" });
        return (source as File).text;
    });
    const readBinary = jest.fn(async (source: GhostPublishingSourceFile) => {
        await state.readHook?.();
        return (source as File).bytes.slice().buffer;
    });
    const processFrontMatter = jest.fn(async (source: GhostPublishingSourceFile, mutate: (fields: Record<string, unknown>) => void) => {
        const file = source as File;
        const fields = properties(file);
        mutate(fields);
        replace(file, body(file), fields);
    });
    const host: GhostActionHost = {
        vault: { getAbstractFileByPath: (path) => files.find((file) => file.path === path) ?? null,
            getMarkdownFiles: () => files.filter((file) => file.extension === "md"), read, readBinary },
        metadataCache: {
            getFileCache: (source) => ({ frontmatter: properties(source as File) }),
            getFirstLinkpathDest: (link) => files.find((file) => file.path === link || file.path === `${link}.md`) ?? null,
        },
        fileManager: { processFrontMatter }, getFrontMatterInfo: info, parseYaml: (yaml) => JSON.parse(yaml),
    };
    const downloadImage = jest.fn(async (_url: string, gate: GhostRequestGate) => {
        await gate.beforeSend();
        gate.assertCurrent();
        return { bytes, mimeType: "image/png" };
    });
    const readPost = jest.fn(async (id: string, gate: GhostRequestGate): Promise<GhostPost> => {
        await gate.beforeSend(); gate.assertCurrent();
        return remotePost(id);
    });
    const generateMetadata = jest.fn<GhostMetadataGenerator>(async input => ({
        ...(input.needed.customExcerpt ? { customExcerpt: "Generated article summary" } : {}),
        ...(input.needed.metaDescription ? { metaDescription: "Generated independent SEO description" } : {}),
        ...(input.needed.slug ? { slug: "generated-article-url" } : {}),
    }));
    const options: GhostActionContextOptions = {
        selection: { path: "Article.md" }, host, client: { downloadImage, readPost }, isDesktop: () => state.desktop,
        guard: { isCurrent: () => state.current, isPathAllowed: (path) => path !== state.denied,
            isNoteDomainAllowed: () => true, isWebAllowed: () => state.web, captureSourceValidity: () => () => state.receipt },
        sourceValidity: () => state.receipt, siteId: "site-a", siteUrl: SITE,
        getConnectionIdentity: () => state.connection, getProfile: () => state.profile,
        getSourceRevision: (path) => files.find((file) => file.path === path)?.revision ?? "missing",
        defaultVisibility: "public", signal: controller.signal, generateMetadata,
    };
    return { files, state, controller, replace, read, readBinary, processFrontMatter, downloadImage, readPost, generateMetadata, options };
}


type Prepared = Awaited<ReturnType<GhostActionContext["prepare"]>>;
function operation(prepared: Prepared, sourcePostId?: string): GhostLocalOperation {
    return { operationId: "op-one", revision: 1, siteId: "site-a", site: SITE, noteKey: "Article.md",
        sourcePostId, kind: sourcePostId ? "update" : "create", state: "prepared", executionState: "succeeded",
        candidate: prepared.candidate, target: {}, updatedAt: NOW };
}
function remotePost(id = POST): GhostPost {
    return { id, uuid: "11111111-1111-1111-1111-111111111111", status: "published", updated_at: NOW,
        url: `${SITE}article/`, slug: "article", title: "Old title", lexical: null, tags: [],
        authors: [{ id: "f".repeat(24) }], visibility: "members", custom_template: "custom",
        feature_image: null, feature_image_alt: null, feature_image_caption: null,
        custom_excerpt: "Old summary", meta_description: "Old SEO", codeinjection_head: null, codeinjection_foot: null, published_at: NOW };
}
describe("Ghost current-source preparation and frozen candidate authority", () => {
    it("captures the selected note with no UID or initial property writes", async () => {
        const f = fixture();
        const selected = await createGhostActionContext(f.options);
        expect(selected.noteKey).toBe("Article.md");
        expect(selected.selection).toEqual({ path: "Article.md" });
        expect(selected.postId).toBeUndefined();
        expect(f.processFrontMatter).not.toHaveBeenCalled();
    });
    it("generates missing metadata from current cleaned content instead of remote old fields", async () => {
        const f = fixture("Current body.\n\n%% hidden comment %%");
        f.replace(f.files[0], body(f.files[0]), { GHOST_ID: POST });
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(remotePost());
        expect(prepared.candidate.content).toMatchObject({ custom_excerpt: "Generated article summary", meta_description: "Generated independent SEO description" });
        expect(f.generateMetadata.mock.calls[0][0]).toMatchObject({ needed: { customExcerpt: true, metaDescription: true, slug: false } });
        expect(f.generateMetadata.mock.calls[0][0].articleText).toContain("Current body.");
        expect(f.generateMetadata.mock.calls[0][0].articleText).not.toContain("hidden comment");
        expect(prepared.slugCandidate).toBeUndefined();
    });
    it("prefers manual fields and honors explicit clearing without regeneration", async () => {
        const f = fixture();
        f.replace(f.files[0], body(f.files[0]), { GHOST_ID: POST, ghost: { custom_excerpt: "", meta_description: null } });
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(remotePost());
        expect(prepared.candidate.content.custom_excerpt).toBeNull();
        expect(prepared.candidate.content.meta_description).toBeNull();
        expect(f.generateMetadata).not.toHaveBeenCalled();
    });
    it("generates a new English slug only when no article exists", async () => {
        const f = fixture();
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null);
        expect(prepared.slugCandidate).toBe("generated-article-url");
        expect(f.generateMetadata.mock.calls[0][0].needed.slug).toBe(true);
    });
    it("uses a current linked note GHOST_ID and real published URL without a completed record", async () => {
        const f = fixture("Read [[Embed]].");
        f.replace(f.files[1], body(f.files[1]), { GHOST_ID: POST });
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null);
        expect(prepared.candidate.content.lexical).toContain(`${SITE}article/`);
        expect(f.readPost).toHaveBeenCalledTimes(1);
    });
    it("does not read or query an excluded ordinary link target", async () => {
        const f = fixture("Read [[Embed]].");
        f.state.denied = "Embed.md";
        const action = await createGhostActionContext(f.options);
        await action.context.prepare(null);
        expect(f.read.mock.calls.every(([file]) => file.path !== "Embed.md")).toBe(true);
        expect(f.readPost).not.toHaveBeenCalled();
    });
    it("permits later note and embedded text edits without replacing the frozen candidate", async () => {
        const f = fixture("Original body.\n\n![[Embed]]");
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null);
        const frozen = JSON.stringify(prepared.candidate);
        f.replace(f.files[0], "Later main body.");
        f.replace(f.files[1], "Later embedded text.");
        await expect(action.context.validate(operation(prepared))).resolves.toBeUndefined();
        expect(JSON.stringify(prepared.candidate)).toBe(frozen);
        expect(f.generateMetadata).toHaveBeenCalledTimes(1);
    });
    it("checks current embedded #no-ai permission on a fresh confirmation scope without re-exporting", async () => {
        const f = fixture("Original body.\n\n![[Embed]]");
        f.replace(f.files[0], body(f.files[0]), { GHOST_ID: POST });
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(remotePost());
        const op = operation(prepared, POST);
        f.replace(f.files[1], "A normal later edit.");
        const fresh = await createGhostActionContext(f.options);
        await expect(fresh.context.validate(op)).resolves.toBeUndefined();
        f.replace(f.files[1], "Private content #no-ai");
        await expect(fresh.context.validate(op)).rejects.toMatchObject({ code: "source-revoked" });
        expect(f.generateMetadata).toHaveBeenCalledTimes(1);
    });
    it("allows fresh navigation after confirmed GHOST_ID writeback and rejects a third ID", async () => {
        const f = fixture();
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null);
        const op = { ...operation(prepared), state: "draft_saved" as const,
            target: { postId: POST, postStatus: "draft" as const },
            verified: { postId: POST, postUrl: `${SITE}article/`, updatedAt: NOW, status: "draft" as const } };
        await action.context.bind({ id: POST, url: `${SITE}article/` });
        const fresh = await createGhostActionContext(f.options);
        await expect(fresh.context.validate(op)).resolves.toBeUndefined();
        f.replace(f.files[0], body(f.files[0]), { GHOST_ID: "b".repeat(24) });
        const other = await createGhostActionContext(f.options);
        await expect(other.context.validate(op)).rejects.toMatchObject({ code: "invalid-operation" });
    });
    it("does not mistake its own GHOST_ID write for source revocation", async () => {
        const f = fixture("Body to preserve.");
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null);
        await action.context.bind({ id: POST, url: `${SITE}article/` });
        expect(properties(f.files[0])).toEqual({ GHOST_ID: POST });
        expect(body(f.files[0])).toBe("Body to preserve.");
        await expect(action.context.validate(operation(prepared))).resolves.toBeUndefined();
    });
    it("retains only identity proof after the original scope is aborted", async () => {
        const f = fixture();
        const action = await createGhostActionContext(f.options);
        await action.context.prepare(null);
        f.controller.abort();
        expect(() => action.context.assertIdentity()).not.toThrow();
        f.files[0] = { ...f.files[0], text: text("Same path, different file") };
        expect(() => action.context.assertIdentity()).toThrow(expect.objectContaining({ code: "source-changed" }));
    });
    it.each(["permission", "receipt", "connection", "cancel"] as const)("stops true %s revocation", async kind => {
        const f = fixture();
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null);
        if (kind === "permission") f.state.current = false;
        if (kind === "receipt") f.state.receipt = false;
        if (kind === "connection") f.state.connection = "another-site-or-key";
        if (kind === "cancel") f.controller.abort();
        await expect(action.context.validate(operation(prepared))).rejects.toBeInstanceOf(Error);
    });
    it("rejects mixed dependency revisions while metadata is preparing", async () => {
        const f = fixture("Main.\n\n![[Embed]]");
        const result = { customExcerpt: "Summary", metaDescription: "SEO", slug: "slug" };
        f.generateMetadata.mockImplementation(async () => { f.replace(f.files[1], "Changed during preparation"); return result; });
        const action = await createGhostActionContext(f.options);
        await expect(action.context.prepare(null)).rejects.toMatchObject({ code: "source-changed" });
    });
    it("checks source permission again after an awaited metadata generation", async () => {
        const f = fixture();
        f.generateMetadata.mockImplementation(async () => { f.state.receipt = false; return {}; });
        const action = await createGhostActionContext(f.options);
        await expect(action.context.prepare(null)).rejects.toMatchObject({ code: "source-revoked" });
    });
    it("reports failed metadata generation with actionable preparation semantics", async () => {
        const f = fixture();
        f.generateMetadata.mockRejectedValue(new Error("Provider failed"));
        const action = await createGhostActionContext(f.options);
        await expect(action.context.prepare(null)).rejects.toMatchObject({ code: "metadata-unavailable" });
        expect(f.processFrontMatter).not.toHaveBeenCalled();
    });
    it.each(["provider_failure", "input_too_large", "invalid_result"])("retains the safe metadata failure %s before preparing images", async code => {
        const f = fixture("Article.\n\n![Local](cover.png)");
        f.generateMetadata.mockRejectedValue(Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code }));
        const action = await createGhostActionContext(f.options);
        await expect(action.context.prepare(null)).rejects.toMatchObject({ code });
        expect(f.readBinary).not.toHaveBeenCalled();
        expect(f.processFrontMatter).not.toHaveBeenCalled();
    });
    it("prioritizes revoked source authority over a metadata provider failure", async () => {
        const f = fixture();
        f.generateMetadata.mockImplementation(async () => {
            f.state.receipt = false;
            throw Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code: "provider_failure" });
        });
        const action = await createGhostActionContext(f.options);
        await expect(action.context.prepare(null)).rejects.toMatchObject({ code: "source-revoked" });
    });
    it("does not expose an unknown metadata provider code", async () => {
        const f = fixture();
        f.generateMetadata.mockRejectedValue(Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code: "PRIVATE_PROVIDER_CODE" }));
        const action = await createGhostActionContext(f.options);
        await expect(action.context.prepare(null)).rejects.toMatchObject({ code: "metadata-unavailable" });
    });
    it("admits an explicit image from an allowed Markdown owner even when the note guard excludes binaries", async () => {
        const f = fixture("Article.\n\n![Local](cover.png)");
        f.options.guard.isPathAllowed = path => path.endsWith(".md");
        f.options.isResourcePathAllowed = (path, owner) => path === "cover.png" && owner === "Article.md";
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null);
        expect(prepared.images).toHaveLength(1);
        expect(f.readBinary).toHaveBeenCalledTimes(1);
        expect(prepared.candidate.content.lexical).toContain("pending-resource://");
    });
    it("rejects an excluded image before binary reads or metadata provider work", async () => {
        const f = fixture("Article.\n\n![Local](cover.png)");
        f.state.denied = "cover.png";
        const action = await createGhostActionContext(f.options);
        await expect(action.context.prepare(null)).rejects.toMatchObject({ code: "source-revoked" });
        expect(f.readBinary).not.toHaveBeenCalled();
        expect(f.generateMetadata).not.toHaveBeenCalled();
    });
    it("keeps a fetched explicit remote image fixed during later authority validation", async () => {
        const f = fixture("Article.\n\n![Remote](https://images.example/one.png)");
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null);
        await action.context.validate(operation(prepared));
        await action.context.validate(operation(prepared));
        expect(f.downloadImage).toHaveBeenCalledTimes(1);
        expect(prepared.images).toHaveLength(1);
    });
    it("detects binary changes during an awaited preparation read", async () => {
        const f = fixture("Article.\n\n![Local](cover.png)");
        f.readBinary.mockImplementation(async source => {
            const file = source as File;
            const data = file.bytes.slice().buffer;
            file.revision++;
            return data;
        });
        const action = await createGhostActionContext(f.options);
        await expect(action.context.prepare(null)).rejects.toMatchObject({ code: "context-revoked" });
    });
});

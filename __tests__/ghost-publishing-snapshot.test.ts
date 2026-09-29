import { describe, expect, it } from "@jest/globals";
import { prepareGhostExport } from "../src/ghost-publishing/exporter";
import { buildRecipeInjection, restoreRecipeInjection } from "../src/ghost-publishing/recipe";
import {
    acceptGhostFormatting, fillGhostResourceUrls, ghostContentFromPost, ghostManagedContentMatches,
    ghostManagedWrite, ghostPayloadHash, ghostPreviewWrite, prepareGhostRestore, prepareGhostSnapshot,
} from "../src/ghost-publishing/snapshot";
import type { GhostPost } from "../src/ghost-publishing/client";
import type { GhostSnapshot, GhostStoredResource } from "../src/ghost-publishing/state-schema";
import type { LexicalDocumentJson } from "../src/ghost-publishing/types";

const profile = { siteId: "test-site" };
const now = "2026-09-29T09:00:00.000Z";
const capabilities = { codeLanguages: [], hasMermaid: false, hasInlineMath: false, hasDisplayMath: false };
async function exported(body = "Keep paragraph.\n\nChange this.", frontmatter: Record<string, unknown> = {}, path = "A.md") {
    const note = { path, extension: "md" };
    const image = { path: "cover.png", extension: "png" };
    return prepareGhostExport({
        targetPath: path, siteProfile: profile,
        host: {
            vault: { getAbstractFileByPath: (target) => target === path ? note : image, read: async () => `---\nfixture: true\n---\n${body}` },
            metadataCache: { getFirstLinkpathDest: () => image }, parseYaml: () => frontmatter,
        },
        guard: { isCurrent: () => true, isPathAllowed: () => true, isNoteDomainAllowed: () => true, captureSourceValidity: () => () => true },
    });
}
async function candidate(body?: string, fields?: Record<string, unknown>): Promise<GhostSnapshot> {
    return prepareGhostSnapshot({ exported: await exported(body, fields), profile, resources: [], defaultVisibility: "public" });
}
function post(value: GhostSnapshot, changes: Partial<GhostPost> = {}): GhostPost {
    return { ...value.content, id: "a".repeat(24), uuid: "11111111-1111-1111-1111-111111111111", status: "published", updated_at: now,
        url: "https://example.test/stable-slug/", slug: "stable-slug", ...changes };
}

describe("Ghost candidate snapshots", () => {
    it("stores only known warning locations, excluding raw messages and link targets", async () => {
        const result = await exported("[[Unpublished|Visible]]");
        result.warnings[0].message = "Host-only raw target detail";
        const value = prepareGhostSnapshot({ exported: result, profile, resources: [], defaultVisibility: "public" });
        expect(value.warnings).toEqual([{ code: "unpublished-wiki-link", path: "A.md", line: 4 }]);
        expect(JSON.stringify(value.warnings)).not.toContain("Host-only");
    });

    it("keeps remote rendering fields and distinguishes unmanaged, set and cleared fields", async () => {
        const baseline = await candidate();
        const remote = post(baseline, { tags: [{ id: "a".repeat(24), name: "Old" }, { name: "#manual" }],
            authors: [{ id: "b".repeat(24) }], visibility: "members", custom_template: "custom",
            feature_image: "https://example.test/old.png", feature_image_alt: "Owner alt", custom_excerpt: "Owner summary", published_at: now });
        const updated = prepareGhostSnapshot({ exported: await exported(), baseline, remote, profile, resources: [], defaultVisibility: "public" });
        expect(updated.content).toMatchObject({ tags: remote.tags, authors: remote.authors, visibility: "members", custom_template: "custom", custom_excerpt: "Owner summary", published_at: now });
        const changed = prepareGhostSnapshot({ exported: await exported(undefined, { ghost: { title: "New title", tags: ["New"], feature_image: null, custom_excerpt: null } }), baseline, remote, profile, resources: [], defaultVisibility: "public" });
        expect(changed.content).toMatchObject({ title: "New title", tags: [{ name: "New" }, { name: "#manual" }], feature_image: null, custom_excerpt: null, feature_image_alt: "Owner alt" });
        expect(ghostManagedWrite(changed)).not.toHaveProperty("slug");
        expect(ghostManagedWrite(changed)).not.toHaveProperty("authors");
        expect(ghostManagedWrite(changed)).not.toHaveProperty("visibility");
        const preview = ghostPreviewWrite(changed, "#pa-ghost-preview-note");
        expect(preview).toMatchObject({ status: "draft", authors: remote.authors, visibility: "members", custom_template: "custom", published_at: now });
        expect(preview.tags?.at(-1)).toEqual({ name: "#pa-ghost-preview-note", visibility: "internal" });
        expect(changed.content.tags).toHaveLength(2);
        expect(() => ghostContentFromPost({ ...remote, visibility: "tiers" })).toThrow("unsupported-remote");
    });

    it("retains actual remote formatting only for unchanged blocks, including a uniquely renamed main note", async () => {
        const initial = await candidate();
        const lexical = JSON.parse(initial.content.lexical);
        lexical.root.children[0].format = "center";
        lexical.root.children[0].children = [
            { type: "text", version: 1, text: "Keep ", format: 1 },
            { type: "extended-text", version: 1, text: "paragraph.", format: 0 },
        ];
        const remote = post(initial, { lexical: JSON.stringify(lexical) });
        const baseline = acceptGhostFormatting(initial, remote);
        expect(baseline.content.lexical).toBe(remote.lexical);
        expect(baseline.blocks.every((block) => block.remoteBlockId === undefined)).toBe(true);
        const updated = prepareGhostSnapshot({ exported: await exported("Keep paragraph.\n\nChanged locally.", {}, "Renamed.md"), profile, resources: [], baseline, remote, defaultVisibility: "public" });
        const nodes = JSON.parse(updated.content.lexical).root.children;
        expect(nodes[0]).toEqual(lexical.root.children[0]);
        expect(nodes[1].children[0].text).toBe("Changed locally.");
        expect(updated.source.targetPath).toBe("Renamed.md");
    });

    it("stops on remote content changes or ambiguous duplicates and allows only an explicit replacement", async () => {
        const baseline = await candidate();
        const remote = post(baseline);
        const lexical = JSON.parse(remote.lexical!);
        lexical.root.children[0].children[0].text = "Different remote content";
        remote.lexical = JSON.stringify(lexical);
        const options = { exported: await exported("A new local version"), profile, resources: [], baseline, remote, defaultVisibility: "public" as const };
        expect(() => prepareGhostSnapshot(options)).toThrow("content-conflict");
        expect(prepareGhostSnapshot({ ...options, replacement: "replace-all" }).content.lexical).toContain("A new local version");
        const duplicates = await candidate("Same\n\nSame");
        expect(() => prepareGhostSnapshot({ ...options, exported: { ...options.exported }, baseline: duplicates, remote: post(duplicates) })).toThrow("content-conflict");
        expect(() => acceptGhostFormatting(baseline, remote)).toThrow("content-conflict");
    });

    it("uses bytes rather than the unchanged filename as image identity and substitutes only image URLs", async () => {
        const source = await exported("![cover](cover.png)\n\n| picture |\n|---|\n| ![cover](cover.png) |\n\n`pending-resource://resource-1`");
        const resource: GhostStoredResource = { id: source.resources[0].id, source: "cover.png", resolvedPath: "cover.png", byteHash: "ab".repeat(32), byteLength: 10, mimeType: "image/png", url: "https://example.test/images/old.png" };
        const baseline = prepareGhostSnapshot({ exported: source, profile, resources: [resource], defaultVisibility: "public" });
        expect(baseline.content.lexical).toContain("pending-resource://resource-1");
        expect(baseline.content.lexical).toContain("https://example.test/images/old.png");
        const remoteLexical = JSON.parse(baseline.content.lexical);
        remoteLexical.root.children[0].cardWidth = "wide";
        const remote = post(baseline, { lexical: JSON.stringify(remoteLexical) });
        const retained = prepareGhostSnapshot({ exported: source, profile, resources: [resource], defaultVisibility: "public", baseline, remote });
        expect(JSON.parse(retained.content.lexical).root.children[0].cardWidth).toBe("wide");
        const next = { ...resource, byteHash: "cd".repeat(32), url: "https://example.test/images/new.png" };
        const updated = prepareGhostSnapshot({ exported: source, profile, resources: [next], defaultVisibility: "public", baseline, remote });
        expect(JSON.parse(updated.content.lexical).root.children[0]).toMatchObject({ src: next.url, cardWidth: "regular" });
        expect(updated.content.lexical).not.toContain("https://example.test/images/old.png");
        expect(() => fillGhostResourceUrls(source.lexical, [])).toThrow("resource-unavailable");
        const literal: LexicalDocumentJson = { ...source.lexical, root: { ...source.lexical.root, children: [{ type: "codeblock", version: 1, code: `pending-resource://${resource.id}`, language: "" }] } };
        expect(fillGhostResourceUrls(literal, [resource])).toEqual(literal);
    });

    it("restores only the previous managed scope and PA region while keeping current manual fields", async () => {
        const history = await candidate("Historical body", { ghost: { custom_excerpt: "Historical summary", tags: ["Old"] } });
        const oldRecipe = buildRecipeInjection(capabilities, { ...profile, manualHeadInjection: "<!-- old manual -->" });
        history.content.codeinjection_head = oldRecipe.head;
        const current = await candidate("Current note is different", { ghost: { custom_excerpt: "Current summary", tags: ["New"] } });
        const liveHead = buildRecipeInjection(capabilities, { ...profile, manualHeadInjection: "<!-- keep current -->" }).head;
        const remote = post(current, { codeinjection_head: liveHead, tags: [{ name: "New" }, { name: "#owner" }], authors: [{ id: "owner" }], visibility: "paid" });
        const restored = prepareGhostRestore(history, remote, profile);
        expect(restored.content.lexical).toContain("Historical body");
        expect(restored.content.custom_excerpt).toBe("Historical summary");
        expect(restored.content.tags).toEqual([{ name: "Old" }, { name: "#owner" }]);
        expect(restored.content).toMatchObject({ authors: [{ id: "owner" }], visibility: "paid" });
        expect(restored.content.codeinjection_head).toContain("<!-- keep current -->");
        expect(restored.content.codeinjection_head).not.toContain("<!-- old manual -->");
        expect(current.content.lexical).toContain("Current note is different");
        expect(restoreRecipeInjection("manual", null, "head")).toBe("manual");
        expect(() => prepareGhostRestore(history, { ...remote, codeinjection_head: liveHead.replace("hash=", "hash=broken") }, profile)).toThrow("marker");
    });

    it("compares actual managed payloads without tag-ID or object-order noise, but never ignores code text", async () => {
        const value = await candidate("```ts\nconst  x = 1;\n```", { ghost: { tags: ["Example"] } });
        const remote = post(value, { tags: [{ id: "a".repeat(24), name: "Example" }, { name: "#pa-ghost-op-synthetic" }] });
        expect(ghostManagedContentMatches(value, remote, ["#pa-ghost-op-synthetic"])).toBe(true);
        expect(ghostManagedContentMatches(value, remote)).toBe(false);
        const changed = { ...remote, lexical: remote.lexical!.replace("const  x", "const x") };
        expect(() => acceptGhostFormatting(value, changed, ["#pa-ghost-op-synthetic"])).toThrow("content-conflict");
        expect(await ghostPayloadHash(ghostManagedWrite(value))).toMatch(/^[a-f0-9]{64}$/);
        expect(await ghostPayloadHash({ a: 1, b: 2 })).toBe(await ghostPayloadHash({ b: 2, a: 1 }));
    });
});

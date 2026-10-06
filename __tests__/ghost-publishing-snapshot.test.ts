import { describe, expect, it } from "@jest/globals";
import { prepareGhostExport } from "../src/ghost-publishing/exporter";
import { buildRecipeInjection } from "../src/ghost-publishing/recipe";
import {
    fillGhostResourceUrls, ghostContentFromPost, ghostManagedContentMatches,
    ghostManagedWrite, ghostPayloadHash, ghostPreviewWrite, materializeGhostSnapshot, prepareGhostSnapshot,
} from "../src/ghost-publishing/snapshot";
import type { GhostPost } from "../src/ghost-publishing/client";
import type { GhostSnapshot, GhostStoredResource } from "../src/ghost-publishing/state-schema";
import type { LexicalDocumentJson } from "../src/ghost-publishing/types";

const profile = { siteId: "test-site" };
const now = "2026-09-29T09:00:00.000Z";
async function exported(body = "Current note body.", frontmatter: Record<string, unknown> = {}, path = "A.md") {
    const note = { path, extension: "md" };
    const image = { path: "cover.png", extension: "png" };
    return prepareGhostExport({
        targetPath: path, siteProfile: profile,
        host: {
            vault: { getAbstractFileByPath: (target) => target === path ? note : image, read: async () => "---\nfixture: true\n---\n" + body },
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

describe("Ghost current publication candidates", () => {
    it("keeps diagnostic locations without storing raw messages or link targets", async () => {
        const result = await exported("[[Unpublished|Visible]]");
        result.warnings[0].message = "Host-only raw target detail";
        const value = prepareGhostSnapshot({ exported: result, profile, resources: [], defaultVisibility: "public" });
        expect(value.warnings).toEqual([{ code: "unpublished-wiki-link", path: "A.md", line: 4 }]);
        expect(JSON.stringify(value.warnings)).not.toContain("Host-only");
    });

    it("overwrites complete managed content without a baseline while preserving operational fields", async () => {
        const previous = await candidate("Ghost-only old body");
        const remote = post(previous, { lexical: null, tags: [{ id: "a".repeat(24), name: "Old" }, { name: "#manual" }],
            authors: [{ id: "b".repeat(24) }], visibility: "members", custom_template: "custom",
            feature_image: "https://example.test/old.png", feature_image_alt: "Owner alt", feature_image_caption: "Owner caption",
            custom_excerpt: "Remote summary", meta_description: "Remote SEO", published_at: now });
        const updated = prepareGhostSnapshot({ exported: await exported(), remote, profile, resources: [], defaultVisibility: "public" });
        expect(updated.content).toMatchObject({
            tags: [{ name: "#manual" }], authors: remote.authors, visibility: "members", custom_template: "custom",
            feature_image: null, custom_excerpt: null, meta_description: null, feature_image_alt: "Owner alt",
            feature_image_caption: "Owner caption", published_at: now,
        });
        expect(updated.content.lexical).toContain("Current note body.");
        expect(updated.content.lexical).not.toContain("Ghost-only");
        expect(ghostManagedWrite(updated)).toMatchObject({ tags: [{ name: "#manual" }], feature_image: null, custom_excerpt: null, meta_description: null });
        for (const field of ["slug", "authors", "visibility", "published_at", "custom_template", "feature_image_alt", "feature_image_caption"]) {
            expect(ghostManagedWrite(updated)).not.toHaveProperty(field);
        }
        const preview = ghostPreviewWrite(updated, "#pa-ghost-preview-note");
        expect(preview).toMatchObject({ status: "draft", authors: remote.authors, visibility: "members", custom_template: "custom", published_at: now });
        expect(preview.tags?.at(-1)).toEqual({ name: "#pa-ghost-preview-note", visibility: "internal" });
        expect(updated.content.tags).toHaveLength(1);
        expect(() => ghostContentFromPost({ ...remote, visibility: "tiers" })).toThrow("unsupported-remote");
    });

    it("uses current explicit or generated metadata and never copies remote managed metadata", async () => {
        const remote = post(await candidate(), { custom_excerpt: "Old summary", meta_description: "Old SEO", tags: [{ name: "Old" }] });
        const updated = prepareGhostSnapshot({ exported: await exported("New note", {
            ghost: { title: "Exact title", tags: ["New"], custom_excerpt: "Generated summary", meta_description: "Generated SEO" },
        }), remote, profile, resources: [], defaultVisibility: "public" });
        expect(ghostManagedWrite(updated)).toMatchObject({
            title: "Exact title", tags: [{ name: "New" }], custom_excerpt: "Generated summary", meta_description: "Generated SEO",
        });
        expect(updated.managedFields).toEqual(expect.arrayContaining(["tags", "feature_image", "custom_excerpt", "meta_description"]));
    });

    it("rebuilds PA injection and preserves injection outside its region", async () => {
        const old = buildRecipeInjection({ codeLanguages: ["ts"], hasMermaid: false, hasInlineMath: false, hasDisplayMath: false },
            { ...profile, manualHeadInjection: "<!-- owner head -->", manualFootInjection: "<!-- owner foot -->" });
        const remote = post(await candidate(), { codeinjection_head: old.head, codeinjection_foot: old.foot });
        const updated = prepareGhostSnapshot({ exported: await exported(), remote, profile, resources: [], defaultVisibility: "public" });
        expect(updated.content.codeinjection_head).toContain("<!-- owner head -->");
        expect(updated.content.codeinjection_foot).toContain("<!-- owner foot -->");
        expect(updated.recipe.needsPrism).toBe(false);
        expect(updated.content.codeinjection_head).not.toContain("prism.min.js");
    });

    it("replaces only actual image URLs, including table images and the cover, without retaining remote formatting", async () => {
        const inlineCode = String.fromCharCode(96) + "pending-resource://resource-1" + String.fromCharCode(96);
        const source = await exported("![cover](cover.png)\n\n| picture |\n|---|\n| ![cover](cover.png) |\n\n" + inlineCode,
            { ghost: { feature_image: "cover.png" } });
        const resource: GhostStoredResource = { id: source.resources[0].id, source: "cover.png", resolvedPath: "cover.png",
            byteHash: "ab".repeat(32), byteLength: 10, mimeType: "image/png", url: "https://example.test/images/current.png" };
        const updated = prepareGhostSnapshot({ exported: source, profile, resources: [resource], defaultVisibility: "public" });
        expect(updated.content.lexical).toContain("pending-resource://resource-1");
        expect(updated.content.lexical).toContain(resource.url);
        expect(updated.content.feature_image).toBe(resource.url);
        expect(JSON.parse(updated.content.lexical).root.children[0].cardWidth).toBe("regular");
        expect(() => fillGhostResourceUrls(source.lexical, [])).toThrow("resource-unavailable");
        const literal: LexicalDocumentJson = { ...source.lexical, root: { ...source.lexical.root,
            children: [{ type: "codeblock", version: 1, code: "pending-resource://" + resource.id, language: "" }] } };
        expect(fillGhostResourceUrls(literal, [resource])).toEqual(literal);
        const pending = prepareGhostSnapshot({ exported: source, profile, resources: [{ ...resource, url: undefined }],
            defaultVisibility: "public", allowPendingResources: true });
        expect(materializeGhostSnapshot(pending, [resource]).content.feature_image).toBe(resource.url);
    });

    it("compares current managed payloads without tag-ID or object-order noise but detects real content changes", async () => {
        const value = await candidate("    const  x = 1;", { ghost: { tags: ["Example"] } });
        const remote = post(value, { tags: [{ id: "a".repeat(24), name: "Example" }, { name: "#pa-ghost-preview-note" }] });
        expect(ghostManagedContentMatches(value, remote, ["#pa-ghost-preview-note"])).toBe(true);
        expect(ghostManagedContentMatches(value, remote)).toBe(false);
        const changed = { ...remote, lexical: remote.lexical!.replace("const  x", "const x") };
        expect(ghostManagedContentMatches(value, changed, ["#pa-ghost-preview-note"])).toBe(false);
        expect(await ghostPayloadHash(ghostManagedWrite(value))).toMatch(/^[a-f0-9]{64}$/);
        expect(await ghostPayloadHash({ a: 1, b: 2 })).toBe(await ghostPayloadHash({ b: 2, a: 1 }));
    });
});

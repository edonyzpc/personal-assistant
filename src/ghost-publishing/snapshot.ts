import { stableStringify } from "../ai-services/agent-utils";
import type { GhostPost, GhostPostWrite, GhostVisibility } from "./client";
import { ghostFieldsForCandidate } from "./fields";
import { lexicalSemanticSignature, type LexicalContentIdentity } from "./lexical-content";
import { buildRecipeInjection } from "./recipe";
import { ghostContentSchema, ghostSnapshotSchema, type GhostSnapshot, type GhostStoredContent, type GhostStoredResource } from "./state-schema";
import type { GhostExportResult, LexicalDocumentJson, LexicalNodeJson, SitePublishingProfile } from "./types";

export class GhostCandidateError extends Error {
    constructor(readonly code: "invalid-content" | "unsupported-remote" | "resource-unavailable") {
        super(`Ghost publishing: ${code}.`);
        this.name = "GhostCandidateError";
    }
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function documentOf(lexical: string): LexicalDocumentJson {
    try { return JSON.parse(lexical) as LexicalDocumentJson; }
    catch { throw new GhostCandidateError("invalid-content"); }
}

/** Own generated image tags only. URLs are replaced in src, never in visible text/code. */
function mapHtmlImages(html: string, map: (src: string) => string): string {
    return html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi, (_whole, prefix: string, quote: string, encoded: string) => {
        const src = encoded.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
        const next = map(src);
        if (next === src) return `${prefix}${quote}${encoded}${quote}`;
        const escaped = next.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        return `${prefix}${quote}${escaped}${quote}`;
    });
}

function resourceIdentity(resources: readonly GhostStoredResource[]): LexicalContentIdentity {
    const image = (src: string): string => {
        const matches = resources.filter((resource) => src === `pending-resource://${resource.id}` || src === resource.url);
        const hashes = [...new Set(matches.map((resource) => resource.byteHash))];
        if (hashes.length > 1) throw new GhostCandidateError("resource-unavailable");
        return hashes.length === 1 ? `sha256:${hashes[0]}` : src;
    };
    return { image, html: (html) => mapHtmlImages(html, image) };
}

export function fillGhostResourceUrls(lexical: LexicalDocumentJson, resources: readonly GhostStoredResource[], allowPending = false): LexicalDocumentJson {
    const result = copy(lexical);
    const replace = (src: string): string => {
        if (!src.startsWith("pending-resource://")) return src;
        const resource = resources.find((item) => `pending-resource://${item.id}` === src);
        if (!resource?.url) {
            if (allowPending && resource) return src;
            throw new GhostCandidateError("resource-unavailable");
        }
        return resource.url;
    };
    const visit = (node: LexicalNodeJson): void => {
        if (node.type === "image") node.src = replace(String(node.src));
        if (node.type === "html") node.html = mapHtmlImages(String(node.html), replace);
        if (Array.isArray(node.children)) (node.children as LexicalNodeJson[]).forEach(visit);
    };
    result.root.children.forEach(visit);
    return result;
}

/** Projects real readback; no response-wide spread, UUID or preview URL enters a snapshot. */
export function ghostContentFromPost(post: GhostPost, ignoredMarkers: readonly string[] = []): GhostStoredContent {
    if (post.visibility === "tiers" || !["draft", "published"].includes(post.status) || post.lexical === null) {
        throw new GhostCandidateError("unsupported-remote");
    }
    const content = ghostContentSchema.safeParse({
        title: post.title, lexical: post.lexical,
        tags: post.tags.filter((tag) => !ignoredMarkers.includes(tag.name)).map(({ id, name }) => id ? { id, name } : { name }),
        authors: post.authors.map(({ id }) => ({ id })), visibility: post.visibility,
        feature_image: post.feature_image, feature_image_alt: post.feature_image_alt,
        feature_image_caption: post.feature_image_caption, custom_excerpt: post.custom_excerpt,
        meta_description: post.meta_description,
        custom_template: post.custom_template, published_at: post.published_at,
        codeinjection_head: post.codeinjection_head, codeinjection_foot: post.codeinjection_foot,
    });
    if (!content.success) throw new GhostCandidateError("invalid-content");
    return content.data;
}

function emptyContent(visibility: GhostVisibility): GhostStoredContent {
    if (visibility === "tiers") throw new GhostCandidateError("unsupported-remote");
    return {
        title: "", lexical: JSON.stringify({ root: { type: "root", version: 1, children: [] } }),
        tags: [], authors: [], visibility, feature_image: null, feature_image_alt: null,
        feature_image_caption: null, custom_excerpt: null, custom_template: null, published_at: null,
        meta_description: null,
        codeinjection_head: null, codeinjection_foot: null,
    };
}

function snapshot(value: GhostSnapshot): GhostSnapshot {
    const parsed = ghostSnapshotSchema.safeParse(value);
    if (!parsed.success) throw new GhostCandidateError("invalid-content");
    return parsed.data;
}

export interface PrepareGhostSnapshotOptions {
    exported: GhostExportResult;
    profile: SitePublishingProfile;
    resources: GhostStoredResource[];
    remote?: GhostPost;
    defaultVisibility: GhostVisibility;
    /** Only exact operation markers confirmed by the owning service may be omitted. */
    ignoredMarkers?: string[];
    /** Resource URLs are materialized before any article write. */
    allowPendingResources?: boolean;
}

export function prepareGhostSnapshot(options: PrepareGhostSnapshotOptions): GhostSnapshot {
    const { exported, resources, remote, profile } = options;
    const content = emptyContent(remote?.visibility ?? options.defaultVisibility);
    if (remote) {
        // Preserve only operational fields and injection outside PA's managed region.
        // Old body and managed metadata never fill gaps in the current note.
        content.tags = remote.tags.filter((tag) => tag.name.startsWith("#") && !options.ignoredMarkers?.includes(tag.name))
            .map(({ id, name }) => id ? { id, name } : { name });
        content.authors = remote.authors.map(({ id }) => ({ id }));
        content.feature_image_alt = remote.feature_image_alt;
        content.feature_image_caption = remote.feature_image_caption;
        content.custom_template = remote.custom_template;
        content.published_at = remote.published_at;
        content.codeinjection_head = remote.codeinjection_head;
        content.codeinjection_foot = remote.codeinjection_foot;
    }
    const lexical = fillGhostResourceUrls(exported.lexical, resources, options.allowPendingResources);
    const identity = resourceIdentity(resources);
    const blocks = exported.blocks.map((block) => ({ ...block,
        semanticSignature: lexicalSemanticSignature(lexical.root.children[block.nodeIndex], identity),
    }));
    const fields = ghostFieldsForCandidate(exported.fields);
    const managedFields: GhostSnapshot["managedFields"] = ["title", "lexical", "tags", "feature_image", "custom_excerpt", "meta_description", "codeinjection_head", "codeinjection_foot"];
    content.title = fields.title;
    content.lexical = JSON.stringify(lexical);
    const publicTags = fields.tags.map((name) => {
        if (!name.trim() || name.startsWith("#")) throw new GhostCandidateError("invalid-content");
        return { name };
    });
    content.tags = [...publicTags, ...content.tags];
    const resource = resources.find((item) => `pending-resource://${item.id}` === fields.feature_image);
    content.feature_image = fields.feature_image === null ? null : resource?.url ?? (options.allowPendingResources && resource ? fields.feature_image : null);
    if (fields.feature_image !== null && !content.feature_image) throw new GhostCandidateError("resource-unavailable");
    content.custom_excerpt = fields.custom_excerpt;
    content.meta_description = fields.meta_description;
    const injection = buildRecipeInjection(exported.capabilities, {
        ...profile, manualHeadInjection: content.codeinjection_head ?? "", manualFootInjection: content.codeinjection_foot ?? "",
    });
    content.codeinjection_head = injection.head;
    content.codeinjection_foot = injection.foot;
    return snapshot({ content, managedFields, source: exported.sourceManifest, blocks, resources,
        profile, recipe: injection.selection, warnings: exported.warnings.map(({ code, path, line }) => ({ code, path, line })),
        ...(fields.slug !== undefined ? { slug: fields.slug } : {}) });
}

export function ghostPreviewWrite(candidate: GhostSnapshot, marker: string): GhostPostWrite {
    const result: GhostPostWrite = { ...copy(candidate.content), tags: [...copy(candidate.content.tags), { name: marker, visibility: "internal" }], status: "draft" };
    if (result.authors?.length === 0) delete result.authors;
    return result;
}

export function materializeGhostSnapshot(candidate: GhostSnapshot, resources: GhostStoredResource[]): GhostSnapshot {
    const content = { ...candidate.content, lexical: JSON.stringify(fillGhostResourceUrls(documentOf(candidate.content.lexical), resources)) };
    if (content.feature_image?.startsWith("pending-resource://")) {
        const url = resources.find((item) => `pending-resource://${item.id}` === content.feature_image)?.url;
        if (!url) throw new GhostCandidateError("resource-unavailable");
        content.feature_image = url;
    }
    return snapshot({ ...candidate, content, resources });
}

export function ghostManagedWrite(candidate: GhostSnapshot): GhostPostWrite {
    const result: Record<string, unknown> = {};
    for (const field of candidate.managedFields) result[field] = copy(candidate.content[field]);
    return result;
}

function comparable(content: GhostStoredContent, fields: GhostSnapshot["managedFields"]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of fields) result[field] = field === "tags" ? content.tags.map((tag) => tag.name)
        : field === "lexical" ? documentOf(content.lexical) : content[field];
    return result;
}

export async function ghostPayloadHash(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(stableStringify(value));
    return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Tag IDs assigned by Ghost do not change the intended ordered relationship. */
export function ghostManagedContentMatches(candidate: GhostSnapshot, post: GhostPost, markers: string[] = []): boolean {
    const content = ghostContentFromPost(post, markers);
    return stableStringify(comparable(candidate.content, candidate.managedFields)) === stableStringify(comparable(content, candidate.managedFields));
}

import { stableStringify } from "../ai-services/agent-utils";
import type { GhostPost, GhostPostWrite, GhostVisibility } from "./client";
import { ghostFieldsForCandidate } from "./fields";
import { planFormatPreservation, type FormatReplacementMode } from "./format-preservation";
import { lexicalSemanticSignature, type LexicalContentIdentity } from "./lexical-content";
import { buildRecipeInjection, restoreRecipeInjection } from "./recipe";
import { ghostContentSchema, ghostSnapshotSchema, type GhostSnapshot, type GhostStoredContent, type GhostStoredResource } from "./state-schema";
import type { GhostExportResult, LexicalDocumentJson, LexicalNodeJson, SitePublishingProfile } from "./types";

export class GhostCandidateError extends Error {
    constructor(readonly code: "invalid-content" | "unsupported-remote" | "resource-unavailable" | "content-conflict" | "missing-baseline") {
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
    baseline?: GhostSnapshot;
    defaultVisibility: GhostVisibility;
    replacement?: FormatReplacementMode;
    /** Only exact operation markers confirmed by the owning service may be omitted. */
    ignoredMarkers?: string[];
    /** Only for a durable prepared operation before the service uploads its resources. */
    allowPendingResources?: boolean;
}

export function prepareGhostSnapshot(options: PrepareGhostSnapshotOptions): GhostSnapshot {
    const { exported, resources, baseline, remote, profile } = options;
    if (remote && !baseline) throw new GhostCandidateError("missing-baseline");
    const content = remote ? ghostContentFromPost(remote, options.ignoredMarkers) : emptyContent(options.defaultVisibility);
    const lexical = fillGhostResourceUrls(exported.lexical, resources, options.allowPendingResources);
    const identity = resourceIdentity(resources);
    const blocks = exported.blocks.map((block) => ({ ...block,
        semanticSignature: lexicalSemanticSignature(lexical.root.children[block.nodeIndex], identity),
    }));
    if (baseline && remote) {
        if (baseline.profile.siteId !== profile.siteId) throw new GhostCandidateError("missing-baseline");
        const metadataFields = baseline.managedFields.filter((field) => !["lexical", "codeinjection_head", "codeinjection_foot"].includes(field));
        if (options.replacement !== "replace-all" && stableStringify(comparable(baseline.content, metadataFields)) !== stableStringify(comparable(content, metadataFields))) {
            throw new GhostCandidateError("content-conflict");
        }
        const remoteNodes = documentOf(content.lexical).root.children;
        const previousIdentity = resourceIdentity(baseline.resources);
        const remoteBlocks = remoteNodes.map((node, index) => ({
            id: `read-${index}`, node, semanticSignature: lexicalSemanticSignature(node, previousIdentity),
        }));
        // A binding survives a main-note rename. Embedded paths retain their separate identity.
        const priorBlocks = baseline.blocks.map(({ remoteBlockId: _unused, ...block }) => ({ ...block,
            sourcePath: block.sourcePath === baseline.source.targetPath ? exported.sourceManifest.targetPath : block.sourcePath,
        }));
        const plan = planFormatPreservation(blocks, remoteBlocks, priorBlocks, options.replacement);
        if (plan.status !== "ok") throw new GhostCandidateError("content-conflict");
        for (const preserved of plan.preservedNodes) {
            const block = blocks.find((item) => item.id === preserved.blockId);
            if (block) lexical.root.children[block.nodeIndex] = copy(preserved.node);
        }
    }
    const fields = ghostFieldsForCandidate(exported.fields);
    const managedFields: GhostSnapshot["managedFields"] = ["title", "lexical", "codeinjection_head", "codeinjection_foot"];
    content.title = fields.title;
    content.lexical = JSON.stringify(lexical);
    if (fields.tags !== undefined) {
        const publicTags = (fields.tags ?? []).map((name) => {
            if (!name.trim() || name.startsWith("#")) throw new GhostCandidateError("invalid-content");
            return content.tags.find((tag) => tag.name === name) ?? { name };
        });
        content.tags = [...publicTags, ...content.tags.filter((tag) => tag.name.startsWith("#"))];
        managedFields.push("tags");
    }
    if (fields.feature_image !== undefined) {
        const resource = resources.find((item) => `pending-resource://${item.id}` === fields.feature_image);
        content.feature_image = fields.feature_image === null ? null : resource?.url ?? (options.allowPendingResources && resource ? fields.feature_image : null);
        if (fields.feature_image !== null && !content.feature_image) throw new GhostCandidateError("resource-unavailable");
        managedFields.push("feature_image");
    }
    if (fields.custom_excerpt !== undefined) { content.custom_excerpt = fields.custom_excerpt; managedFields.push("custom_excerpt"); }
    const injection = buildRecipeInjection(exported.capabilities, {
        ...profile, manualHeadInjection: content.codeinjection_head ?? "", manualFootInjection: content.codeinjection_foot ?? "",
    });
    content.codeinjection_head = injection.head;
    content.codeinjection_foot = injection.foot;
    return snapshot({ content, managedFields, source: exported.sourceManifest, blocks, resources,
        profile, recipe: injection.selection, warnings: exported.warnings.map(({ code, path, line }) => ({ code, path, line })) });
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

/** Re-preparing a local operation keeps reliable formatting from its own edited draft. */
export function preserveGhostPreviewFormatting(next: GhostSnapshot, previous: GhostSnapshot, preview: GhostPost, markers: string[], replaceAll = false): GhostSnapshot {
    if (replaceAll) return next;
    if (!ghostRenderingMatches(previous, preview, markers)) throw new GhostCandidateError("content-conflict");
    const lexical = documentOf(next.content.lexical);
    const remote = documentOf(ghostContentFromPost(preview, markers).lexical).root.children;
    const identity = resourceIdentity(previous.resources);
    const remoteBlocks = remote.map((node, index) => ({ id: `read-${index}`, node, semanticSignature: lexicalSemanticSignature(node, identity) }));
    const prior = previous.blocks.map(({ remoteBlockId: _unused, ...block }) => ({ ...block,
        sourcePath: block.sourcePath === previous.source.targetPath ? next.source.targetPath : block.sourcePath,
    }));
    const plan = planFormatPreservation(next.blocks, remoteBlocks, prior);
    if (plan.status !== "ok") throw new GhostCandidateError("content-conflict");
    for (const item of plan.preservedNodes) {
        const block = next.blocks.find((candidate) => candidate.id === item.blockId);
        if (block) lexical.root.children[block.nodeIndex] = copy(item.node);
    }
    return snapshot({ ...next, content: { ...next.content, lexical: JSON.stringify(lexical) } });
}

export function ghostRenderingMatches(candidate: GhostSnapshot, post: GhostPost, markers: string[] = [], initialCreate = false): boolean {
    const actual = ghostContentFromPost(post, markers);
    const expected = copy(candidate.content);
    if (initialCreate && expected.authors.length === 0) expected.authors = actual.authors;
    const fields = Object.keys(expected).filter((key) => key !== "lexical") as Array<keyof GhostStoredContent>;
    for (const field of fields) {
        const normalize = (content: GhostStoredContent) => field === "tags" ? content.tags.map((tag) => tag.name) : content[field];
        if (stableStringify(normalize(expected)) !== stableStringify(normalize(actual))) return false;
    }
    const identity = resourceIdentity(candidate.resources);
    const expectedNodes = documentOf(expected.lexical).root.children;
    const actualNodes = documentOf(actual.lexical).root.children;
    return expectedNodes.length === actualNodes.length && expectedNodes.every((node, index) =>
        lexicalSemanticSignature(node, identity) === lexicalSemanticSignature(actualNodes[index], identity));
}

export function ghostManagedWrite(candidate: GhostSnapshot): GhostPostWrite {
    const result: Record<string, unknown> = {};
    for (const field of candidate.managedFields) result[field] = copy(candidate.content[field]);
    return result as GhostPostWrite;
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

/** Used after manual Ghost formatting/publish, and before accepting an edited preview. */
export function acceptGhostFormatting(candidate: GhostSnapshot, post: GhostPost, markers: string[] = []): GhostSnapshot {
    const content = ghostContentFromPost(post, markers);
    const identity = resourceIdentity(candidate.resources);
    const currentNodes = documentOf(candidate.content.lexical).root.children;
    const remoteNodes = documentOf(content.lexical).root.children;
    if (currentNodes.length !== remoteNodes.length || currentNodes.some((node, index) =>
        lexicalSemanticSignature(node, identity) !== lexicalSemanticSignature(remoteNodes[index], identity))) {
        throw new GhostCandidateError("content-conflict");
    }
    const otherFields = candidate.managedFields.filter((field) => field !== "lexical");
    if (stableStringify(comparable(candidate.content, otherFields)) !== stableStringify(comparable(content, otherFields))) {
        throw new GhostCandidateError("content-conflict");
    }
    return snapshot({ ...candidate, content, blocks: candidate.blocks.map(({ remoteBlockId: _unused, ...block }) => ({
        ...block, semanticSignature: lexicalSemanticSignature(remoteNodes[block.nodeIndex], identity),
    })) });
}

export function prepareGhostRestore(lastUndo: GhostSnapshot, remote: GhostPost, profile: SitePublishingProfile): GhostSnapshot {
    if (lastUndo.profile.siteId !== profile.siteId) throw new GhostCandidateError("missing-baseline");
    const content = ghostContentFromPost(remote);
    for (const field of lastUndo.managedFields) {
        if (field === "codeinjection_head" || field === "codeinjection_foot") {
            content[field] = restoreRecipeInjection(content[field], lastUndo.content[field], field === "codeinjection_head" ? "head" : "foot");
        } else if (field === "tags") {
            content.tags = [...copy(lastUndo.content.tags.filter((tag) => !tag.name.startsWith("#"))), ...content.tags.filter((tag) => tag.name.startsWith("#"))];
        } else {
            Object.assign(content, { [field]: copy(lastUndo.content[field]) });
        }
    }
    // The historical manifest stays authoritative for restored material. Current-note
    // source validity is a separate per-operation Host gate, never an equality test.
    return snapshot({ ...lastUndo, content, profile });
}

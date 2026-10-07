import { z } from "zod";

export const GHOST_RECORD_LIMIT = 16 * 1024 * 1024;
const identity = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const digest = z.string().regex(/^[a-f0-9]{8}$/);
const sha256Digest = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const notePath = z.string().min(1).max(4096).refine((value) =>
    !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === ".." || part === "."));
const webUrl = z.string().url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
});
const nullableText = z.string().nullable();
const requestedSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);

function validLexical(value: string): boolean {
    try {
        const document = JSON.parse(value) as { root?: unknown };
        let count = 0;
        const validNode = (node: unknown, depth: number): boolean => {
            if (!node || typeof node !== "object" || Array.isArray(node) || depth > 64 || ++count > 100_000) return false;
            const item = node as Record<string, unknown>;
            return typeof item.type === "string" && Number.isInteger(item.version)
                && (item.children === undefined || (Array.isArray(item.children) && item.children.every((child) => validNode(child, depth + 1))));
        };
        return validNode(document.root, 0)
            && (document.root as { type: unknown }).type === "root"
            && Array.isArray((document.root as { children: unknown }).children);
    } catch { return false; }
}

export const ghostContentSchema = z.object({
    title: z.string(),
    lexical: z.string().max(GHOST_RECORD_LIMIT).refine(validLexical),
    tags: z.array(z.object({ id: z.string().optional(), name: z.string() }).strict()).max(1000),
    authors: z.array(z.object({ id: z.string() }).strict()).max(100),
    visibility: z.enum(["public", "members", "paid", "tiers"]),
    feature_image: nullableText,
    feature_image_alt: nullableText,
    feature_image_caption: nullableText,
    custom_excerpt: nullableText,
    meta_description: nullableText.optional(),
    custom_template: nullableText,
    codeinjection_head: nullableText,
    codeinjection_foot: nullableText,
    published_at: date.nullable(),
}).strict();

export const managedGhostFields = ["title", "lexical", "tags", "feature_image", "feature_image_caption", "custom_excerpt", "meta_description", "codeinjection_head", "codeinjection_foot"] as const;
const sourceSchema = z.object({
    targetPath: notePath,
    dependencies: z.array(z.object({
        path: notePath, kind: z.enum(["main", "embed"]), subpath: z.enum(["", "heading", "block"]),
        subpathValue: z.string().optional(), contentHash: sha256Digest,
        mtime: z.number().finite().nonnegative().optional(), size: z.number().int().nonnegative().optional(),
    }).strict()).min(1).max(1000),
}).strict().refine((value) => value.dependencies[0].kind === "main" && value.dependencies[0].path === value.targetPath);

const blockSchema = z.object({
    id: z.string(), nodeKind: z.string(), sourcePath: notePath,
    sourceDependencyIndex: z.number().int().nonnegative(), sourceStartLine: z.number().int().nonnegative(),
    sourceEndLine: z.number().int().nonnegative(), sourceHash: digest, semanticSignature: digest,
    nodeIndex: z.number().int().nonnegative(), remoteBlockId: z.string().optional(),
}).strict().refine((value) => value.sourceEndLine >= value.sourceStartLine);
const librarySchema = z.object({
    compatible: z.boolean(), version: z.string().optional(),
    evidence: z.enum(["settings-whitelist", "page-check", "unknown"]),
    initialization: z.enum(["auto", "explicit", "unknown"]).optional(),
}).strict();
const profileSchema = z.object({
    siteId: identity, prism: librarySchema.optional(), mermaid: librarySchema.optional(), katex: librarySchema.optional(),
    manualHeadInjection: z.string().optional(), manualFootInjection: z.string().optional(),
}).strict();
const assetSchema = z.object({ url: webUrl, integrity: z.string() }).strict();
const recipeSchema = z.object({
    version: z.literal("b153-v1"), needsPrism: z.boolean(), loadsPrism: z.boolean(), initializesPrism: z.boolean(),
    prismLanguages: z.array(z.string()), needsMermaid: z.boolean(), loadsMermaid: z.boolean(), initializesMermaid: z.boolean(),
    needsKatex: z.boolean(), loadsKatex: z.boolean(), initializesKatex: z.boolean(),
    reuse: z.object({ prism: z.boolean(), mermaid: z.boolean(), katex: z.boolean() }).strict(),
    headAssets: z.array(assetSchema), footAssets: z.array(assetSchema), contentHash: digest,
}).strict();

export const ghostResourceSchema = z.object({
    id: z.string(), source: z.string(), resolvedPath: notePath.optional(),
    byteHash: sha256Digest, byteLength: z.number().int().nonnegative(), mimeType: z.string(),
    url: webUrl.optional(),
}).strict();

export const ghostSnapshotSchema = z.object({
    slug: requestedSlug.optional(),
    content: ghostContentSchema,
    managedFields: z.array(z.enum(managedGhostFields)).min(1),
    source: sourceSchema, blocks: z.array(blockSchema).max(100_000), resources: z.array(ghostResourceSchema).max(10_000),
    profile: profileSchema, recipe: recipeSchema,
    warnings: z.array(z.object({
        code: z.enum(["unresolved-wiki-link", "unpublished-wiki-link", "ambiguous-wiki-link", "wiki-link-anchor-fallback",
            "unknown-highlight-language", "profile-page-check-required"]),
        path: notePath, line: z.number().int().nonnegative(),
    }).strict()).max(10_000).optional(),
}).strict().refine((value) => value.blocks.every((block) =>
    block.sourceDependencyIndex < value.source.dependencies.length
    && value.source.dependencies[block.sourceDependencyIndex].path === block.sourcePath));

/** A frozen candidate and real effects belonging only to the current desktop session. */
export type GhostStoredContent = z.infer<typeof ghostContentSchema>;
export type GhostSnapshot = z.infer<typeof ghostSnapshotSchema>;
export type GhostStoredResource = z.infer<typeof ghostResourceSchema>;
export type GhostOperationState = "preparing" | "prepared" | "draft_saved" | "updated" | "failed" | "outcome_unknown";

export interface GhostLocalOperation {
    operationId: string;
    revision: number;
    siteId: string;
    site: string;
    noteKey: string;
    /** GHOST_ID observed when this action began, including a failed association write. */
    sourcePostId?: string;
    kind: "create" | "update";
    state: GhostOperationState;
    executionState: "not_started" | "succeeded" | "failed" | "acceptance_unknown";
    candidate?: GhostSnapshot;
    target: {
        postId?: string; postUrl?: string; postVersion?: string; postStatus?: "draft" | "published";
        previewId?: string; previewUuid?: string; previewUrl?: string; previewVersion?: string; previewHash?: string;
    };
    verified?: { postId: string; postUrl: string; updatedAt: string; status: "draft" | "published" };
    warnings?: Array<"binding-failed" | "cleanup-failed" | "preview-pointer-failed">;
    error?: string;
    updatedAt: string;
}

export const ghostPreviewPointerSchema = z.object({
    siteId: identity,
    postId: z.string().regex(/^[a-f\d]{24}$/i),
    previewId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();
export type GhostPreviewPointer = z.infer<typeof ghostPreviewPointerSchema>;

export class GhostStateError extends Error {
    constructor(readonly code: "invalid-state" | "storage-unavailable" | "desktop-required") {
        super(`Ghost publishing: ${code}.`);
        this.name = "GhostStateError";
    }
}

export function parsePreviewPointer(value: unknown): GhostPreviewPointer {
    const parsed = ghostPreviewPointerSchema.safeParse(value);
    if (!parsed.success || parsed.data.postId === parsed.data.previewId) throw new GhostStateError("invalid-state");
    return parsed.data;
}

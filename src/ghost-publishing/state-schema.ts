import { z } from "zod";
import { stableStringify } from "../ai-services/agent-utils";
import { stableHash } from "../pa/helpers";

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
const verifiedRemoteSlug = z.string().min(1);

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

export const managedGhostFields = ["title", "lexical", "tags", "feature_image", "custom_excerpt", "meta_description", "codeinjection_head", "codeinjection_foot", "visibility"] as const;
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

export const ghostBindingSchema = z.object({
    noteUid: identity, siteId: identity, site: webUrl, postId: identity, postUrl: webUrl,
}).strict();
const verifiedSchema = z.object({ postId: identity, postUrl: webUrl, updatedAt: date, status: z.enum(["draft", "published"]) }).strict();
const recordBodySchema = z.object({
    schemaVersion: z.literal(1), revision: z.number().int().positive(), binding: ghostBindingSchema,
    completed: verifiedSchema.extend({ verifiedAt: date }).strict(),
    baseline: ghostSnapshotSchema, lastUndo: ghostSnapshotSchema.optional(),
}).strict();
const recordSchema = recordBodySchema.extend({ checksum: digest }).strict();

const operationBodySchema = z.object({
    schemaVersion: z.literal(1), operationId: identity, revision: z.number().int().positive(),
    siteId: identity, site: webUrl, noteUid: identity, kind: z.enum(["create", "update", "restore"]),
    state: z.enum(["prepared", "ready", "pending", "outcome_unknown", "succeeded_remote_pending_record", "cleanup_pending", "terminal"]),
    markerVersion: z.literal(2).optional(),
    slugCandidate: requestedSlug.optional(),
    resolvedSlug: verifiedRemoteSlug.optional(),
    candidate: ghostSnapshotSchema, baselineRevision: z.number().int().positive().nullable(),
    /** Current source is checked separately when the candidate restores historical material. */
    currentSource: sourceSchema.optional(),
    currentIntentHash: sha256Digest.optional(),
    currentNonSlugIntentHash: sha256Digest.optional(),
    baselineChecksum: digest.optional(),
    visibilityChange: z.object({ from: z.enum(["public", "members", "paid"]), to: z.enum(["public", "members", "paid"]) }).strict().optional(),
    target: z.object({
        postId: identity.optional(), postUrl: webUrl.optional(), postVersion: date.optional(),
        previewId: identity.optional(), previewUuid: identity.optional(), previewVersion: date.optional(), previewHash: sha256Digest.optional(),
        postStatus: z.enum(["draft", "published"]).optional(),
    }).strict(),
    pending: z.object({
        kind: z.enum(["resource_upload", "create_draft", "save_preview", "final_put", "change_draft_slug", "cleanup"]),
        marker: z.string(), targetId: identity.optional(), payloadHash: sha256Digest,
        slug: requestedSlug.optional(),
        beforeVersion: date.optional(),
        beforeUrl: webUrl.optional(),
        beforePublishedAt: date.nullable().optional(),
        nonSlugHash: sha256Digest.optional(),
        resource: ghostResourceSchema.optional(),
    }).strict().optional(),
    preUpdate: ghostSnapshotSchema.optional(), verified: verifiedSchema.optional(),
    completedRecord: recordSchema.optional(),
    cleanup: z.object({ postId: identity, marker: z.string(), updatedAt: date, payloadHash: sha256Digest }).strict().optional(),
    confirmation: z.null(), updatedAt: date,
}).strict();
const operationSchema = operationBodySchema.extend({ checksum: digest }).strict();

export type GhostStoredContent = z.infer<typeof ghostContentSchema>;
export type GhostSnapshot = z.infer<typeof ghostSnapshotSchema>;
export type GhostStoredResource = z.infer<typeof ghostResourceSchema>;
export type GhostBinding = z.infer<typeof ghostBindingSchema>;
export type GhostCompletedRecord = z.infer<typeof recordSchema>;
export type GhostLocalOperation = z.infer<typeof operationSchema>;

export class GhostStateError extends Error {
    constructor(readonly code: "invalid-state" | "storage-unavailable" | "record-conflict" | "operation-conflict" | "desktop-required") {
        super(`Ghost publishing: ${code}.`);
        this.name = "GhostStateError";
    }
}

export function ghostStateHash(value: unknown): string {
    return stableHash(stableStringify(JSON.parse(JSON.stringify(value))));
}

function hasChecksum(value: { checksum: string }): boolean {
    const { checksum, ...body } = value;
    return checksum === ghostStateHash(body);
}

function bounded(value: unknown): void {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > GHOST_RECORD_LIMIT) throw new GhostStateError("invalid-state");
}

export function parseCompletedRecord(value: unknown): GhostCompletedRecord {
    bounded(value);
    const parsed = recordSchema.safeParse(value);
    if (!parsed.success) throw new GhostStateError("invalid-state");
    const record = parsed.data;
    if (!hasChecksum(record) || record.binding.postId !== record.completed.postId
        || record.binding.postUrl !== record.completed.postUrl || record.binding.siteId !== record.baseline.profile.siteId
        || (record.lastUndo && record.lastUndo.profile.siteId !== record.binding.siteId)) throw new GhostStateError("invalid-state");
    return record;
}

export function sealCompletedRecord(value: z.infer<typeof recordBodySchema> & { checksum?: string }): GhostCompletedRecord {
    const body = { ...value };
    delete body.checksum;
    return parseCompletedRecord({ ...body, checksum: ghostStateHash(body) });
}

export function parseLocalOperation(value: unknown): GhostLocalOperation {
    bounded(value);
    const parsed = operationSchema.safeParse(value);
    if (!parsed.success) throw new GhostStateError("invalid-state");
    const operation = parsed.data;
    if (!hasChecksum(operation) || operation.siteId !== operation.candidate.profile.siteId
        || (operation.preUpdate && operation.siteId !== operation.preUpdate.profile.siteId)
        || (["pending", "outcome_unknown"].includes(operation.state) && !operation.pending)
        || (operation.pending?.kind === "change_draft_slug" && (!operation.pending.slug || !operation.pending.targetId
            || !operation.pending.beforeVersion || !operation.pending.beforeUrl
            || operation.pending.beforePublishedAt === undefined || !operation.pending.nonSlugHash))
        || (operation.state === "cleanup_pending" && (!operation.verified || !operation.completedRecord || !operation.cleanup))
        || (operation.state === "succeeded_remote_pending_record" && (!operation.verified || !operation.completedRecord))) {
        throw new GhostStateError("invalid-state");
    }
    if (operation.completedRecord) {
        const record = parseCompletedRecord(operation.completedRecord);
        if (record.binding.noteUid !== operation.noteUid || record.binding.siteId !== operation.siteId
            || record.binding.site !== operation.site) throw new GhostStateError("invalid-state");
    }
    return operation;
}

export function isGhostPublicationActive(operation: GhostLocalOperation): boolean {
    return operation.state !== "terminal" && operation.state !== "cleanup_pending";
}

export function sealLocalOperation(value: z.infer<typeof operationBodySchema> & { checksum?: string }): GhostLocalOperation {
    const body = { ...value };
    delete body.checksum;
    return parseLocalOperation({ ...body, checksum: ghostStateHash(body) });
}

export function ghostOperationKey(value: Pick<GhostLocalOperation, "siteId" | "noteUid" | "operationId">): string {
    return `${value.siteId}/${value.noteUid}/${value.operationId}`;
}

export function ghostRecordPath(siteId: string, noteUid: string): string {
    if (!identity.safeParse(siteId).success || !identity.safeParse(noteUid).success) throw new GhostStateError("invalid-state");
    return `PA System/Ghost Publishing/${siteId}/${noteUid}.md`;
}

export function encodeCompletedRecord(input: GhostCompletedRecord): string {
    const record = parseCompletedRecord(input);
    return `---\npa_system: ghost-publishing\nschemaVersion: 1\nsite: ${record.binding.siteId}\nnote_uid: ${record.binding.noteUid}\n---\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}

export function decodeCompletedRecord(text: string, siteId: string, noteUid: string): GhostCompletedRecord {
    if (new TextEncoder().encode(text).byteLength > GHOST_RECORD_LIMIT) throw new GhostStateError("invalid-state");
    const prefix = `---\npa_system: ghost-publishing\nschemaVersion: 1\nsite: ${siteId}\nnote_uid: ${noteUid}\n---\n\n\`\`\`json\n`;
    if (!text.startsWith(prefix) || !text.endsWith("\n```\n")) throw new GhostStateError("invalid-state");
    try {
        const record = parseCompletedRecord(JSON.parse(text.slice(prefix.length, -5)));
        if (record.binding.siteId !== siteId || record.binding.noteUid !== noteUid) throw new GhostStateError("invalid-state");
        return record;
    } catch { throw new GhostStateError("invalid-state"); }
}

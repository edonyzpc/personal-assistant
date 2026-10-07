import { stableStringify } from "../ai-services/agent-utils";
import { ghostMetadataFailureReason } from "../ai-services/ghost-tool-receipt";
import { GhostNoteBindingAdapter, type GhostBindingHost, type GhostNoteSelection } from "./binding";
import type { GhostClient, GhostPost, GhostRequestGate, GhostVisibility } from "./client";
import { prepareGhostExport } from "./exporter";
import { GHOST_CUSTOM_EXCERPT_MAX, GHOST_META_DESCRIPTION_MAX, mergeGhostTagNames, PA_GENERATED_FEATURE_IMAGE_CAPTION } from "./fields";
import { isValidGhostSlug } from "./slug";
import { resolveGhostWikiLinks } from "./wiki-links";
import { prepareGhostResource, type GhostResourceOptions } from "./resources";
import type { GhostActionContext, GhostPreparedImage } from "./service";
import { prepareGhostSnapshot } from "./snapshot";
import type { ExportResourcePlan, GhostExportResult, GhostPublishingHost, GhostPublishingSourceFile,
    GhostPublishingSourceGuard, SitePublishingProfile, WikiLinkTarget } from "./types";

export type GhostActionHost = GhostBindingHost & GhostPublishingHost & GhostResourceOptions["host"];

export interface GhostMetadataGeneratorInput {
    title: string;
    articleText: string;
    needed: { customExcerpt: boolean; metaDescription: boolean; slug: boolean; tags?: boolean };
    tagSelection?: { existingTags: string[]; allowKeywords: boolean };
    signal: AbortSignal;
    isSourceCurrent(): boolean;
    isConnectionCurrent?(): boolean;
    debug?: import("../ai-services/ghost-metadata").GhostMetadataDebugScope;
}
export type GhostMetadataGenerator = (input: GhostMetadataGeneratorInput) => Promise<{ customExcerpt?: string; metaDescription?: string; slug?: string; tags?: string[] }>;

export interface GhostActionContextOptions {
    selection: GhostNoteSelection;
    host: GhostActionHost;
    client: Pick<GhostClient, "downloadImage" | "readPost" | "listTags">;
    isDesktop(this: void): boolean;
    guard: GhostPublishingSourceGuard;
    sourceValidity(): boolean;
    siteId: string; siteUrl: string;
    getConnectionIdentity(): string;
    getProfile(): SitePublishingProfile;
    /** Actual dependencies only, used for consistency while preparing a new candidate. */
    getSourceRevision(this: void, path: string): string | number;
    isResourcePathAllowed?(resourcePath: string, ownerPath: string): boolean;
    defaultVisibility: GhostVisibility;
    signal?: AbortSignal;
    wikiLinks?: Record<string, WikiLinkTarget>;
    generateMetadata?: GhostMetadataGenerator;
    metadataDebug?: import("../ai-services/ghost-metadata").GhostMetadataDebugScope;
    /** Body-free provenance for the already admitted local cover bytes. */
    isPaGeneratedImage?(path: string, byteHash: string): Promise<boolean>;
}

export class GhostActionContextError extends Error {
    constructor(readonly code: "desktop-required" | "cancelled" | "source-revoked" | "source-changed"
        | "connection-changed" | "invalid-operation" | "resource-changed" | "source-unavailable"
        | "metadata-unavailable" | "metadata-invalid" | "provider_failure" | "input_too_large" | "invalid_result") {
        super(`Ghost publishing context: ${code}.`);
        this.name = "GhostActionContextError";
    }
}
function fail(code: GhostActionContextError["code"]): never { throw new GhostActionContextError(code); }
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function same(left: unknown, right: unknown): boolean { return stableStringify(left) === stableStringify(right); }

function lexicalPlainText(node: unknown): string {
    if (!node || typeof node !== "object") return "";
    const value = node as {
        type?: string;
        text?: unknown;
        code?: unknown;
        html?: unknown;
        children?: unknown;
    };
    if (value.type === "extended-text" && typeof value.text === "string") return value.text;
    if (value.type === "codeblock" && typeof value.code === "string") return `\n${value.code}\n`;
    if (value.type === "image") return "\n[Image]\n";
    if (value.type === "linebreak") return "\n";
    const children = Array.isArray(value.children) ? value.children.map(lexicalPlainText).join("") : "";
    if (value.type === "paragraph" || value.type === "extended-heading" || value.type === "listitem") return `${children}\n`;
    if (value.type === "html" && typeof value.html === "string") return `\n${value.html}\n`;
    return children;
}


/** Captures source identity and permissions once; subsequent confirmation submits the frozen candidate. */
export async function createGhostActionContext(options: GhostActionContextOptions): Promise<{
    noteKey: string; postId?: string; selection: GhostNoteSelection; context: GhostActionContext;
}> {
    const { host, guard, signal, siteId, isDesktop } = options;
    const connection = options.getConnectionIdentity();
    const profile = copy(options.getProfile());
    const selection = { path: options.selection.path };
    const adapter = new GhostNoteBindingAdapter(host, { site: options.siteUrl, isDesktop });
    const files = new Map<string, GhostPublishingSourceFile>();
    const revisions = new Map<string, string | number>();
    const resourceAdmissions = new Map<string, string[]>();
    let preparing = true;
    let boundPostId: string | undefined;

    function assertCore(): void {
        if (!isDesktop()) fail("desktop-required");
        if (signal?.aborted) fail("cancelled");
        try {
            if (!guard?.isCurrent() || guard.isNoteDomainAllowed?.() === false || options.sourceValidity() !== true) fail("source-revoked");
        } catch { fail("source-revoked"); }
        if (!connection || options.getConnectionIdentity() !== connection || !same(options.getProfile(), profile) || profile.siteId !== siteId) {
            fail("connection-changed");
        }
    }
    function assertIdentity(): void {
        for (const [path, file] of files) {
            if (file.path !== path || host.vault.getAbstractFileByPath(path) !== file) fail("source-changed");
        }
    }
    function assertPath(path: string): void {
        assertCore();
        if (guard.isPathAllowed(path, "task_material") === true) return;
        const owners = resourceAdmissions.get(path);
        if (!owners?.length || !owners.every(owner => guard.isPathAllowed(owner, "task_material") === true
            && options.isResourcePathAllowed?.(path, owner) === true)) fail("source-revoked");
    }
    function assertWeb(): void {
        assertCore();
        if (guard.isWebAllowed?.() !== true) fail("source-revoked");
    }
    function assertPreparing(): void {
        assertCore();
        assertIdentity();
        for (const [path, revision] of revisions) {
            assertPath(path);
            if (preparing && options.getSourceRevision(path) !== revision) fail("source-changed");
        }
    }
    const sourceGuard: GhostPublishingSourceGuard = {
        isCurrent: () => { try { assertCore(); assertIdentity(); return true; } catch { return false; } },
        isPathAllowed: (path) => { try { assertPath(path); return true; } catch { return false; } },
        isNoteDomainAllowed: () => { try { assertCore(); return true; } catch { return false; } },
        isWebAllowed: () => { try { assertWeb(); return true; } catch { return false; } },
        captureSourceValidity: () => () => { try { assertCore(); assertIdentity(); return true; } catch { return false; } },
    };
    assertCore();
    const initial = await adapter.resolve(selection, sourceGuard);
    files.set(initial.path, initial.file);
    boundPostId = initial.postId;
    assertCore();
    assertIdentity();

    function trackedHost(): GhostActionHost {
        const read = async <T>(file: GhostPublishingSourceFile, action: () => Promise<T>): Promise<T> => {
            assertPreparing();
            const path = file.path;
            assertPath(path);
            if (host.vault.getAbstractFileByPath(path) !== file) fail("source-changed");
            const revision = options.getSourceRevision(path);
            if (typeof revision !== "string" && (typeof revision !== "number" || !Number.isFinite(revision))) fail("source-unavailable");
            files.set(path, file);
            revisions.set(path, revision);
            const result = await action();
            assertPreparing();
            return result;
        };
        return { ...host, vault: { ...host.vault,
            read: file => read(file, () => host.vault.read(file)),
            readBinary: file => read(file, () => host.vault.readBinary(file)),
        } };
    }
    const gate: GhostRequestGate = { signal, assertCurrent: assertPreparing, beforeSend: async () => assertPreparing() };

    async function prepareMetadata(exported: GhostExportResult, remote: GhostPost | null): Promise<void> {
        const automaticTags = exported.fields.tags.mode === "unmanaged";
        const noteTags = exported.fields.noteTags ?? [];
        let tagSelection: GhostMetadataGeneratorInput["tagSelection"];
        if (automaticTags) {
            const catalog = await options.client.listTags(gate);
            assertPreparing();
            tagSelection = { existingTags: mergeGhostTagNames(catalog.map(tag => tag.name)), allowKeywords: noteTags.length === 0 };
            exported.fields.tags = { mode: "manage", value: noteTags };
        }
        const needed = {
            customExcerpt: exported.fields.customExcerpt.mode === "unmanaged",
            metaDescription: exported.fields.metaDescription.mode === "unmanaged",
            slug: remote === null && exported.fields.slug.mode === "unmanaged",
            tags: automaticTags && (Boolean(tagSelection?.existingTags.length) || noteTags.length === 0),
        };
        if (remote) exported.fields.slug = { mode: "unmanaged" };
        if (!needed.customExcerpt && !needed.metaDescription && !needed.slug && !needed.tags) return;
        if (!options.generateMetadata) fail("metadata-unavailable");
        const title = exported.fields.title.value;
        const articleText = lexicalPlainText(exported.lexical.root).trim();
        if (typeof title !== "string" || !articleText) fail("metadata-invalid");
        for (const resource of exported.resources) {
            if (resource.kind === "remote") assertWeb();
            else if (resource.resolvedPath) assertPath(resource.resolvedPath);
        }
        let generated: Awaited<ReturnType<GhostMetadataGenerator>>;
        try {
            generated = await options.generateMetadata({
                title, articleText, needed, signal: signal ?? new AbortController().signal,
                ...(needed.tags ? { tagSelection } : {}),
                isSourceCurrent: () => { try { assertPreparing(); return true; } catch { return false; } },
                isConnectionCurrent: () => { try { assertCore(); return true; } catch { return false; } },
                ...(options.metadataDebug ? { debug: { ...options.metadataDebug,
                    lineage: { sourcePaths: exported.sourceManifest.dependencies.map(dependency => dependency.path),
                        domains: ["vault_notes"], unknown: false },
                } } : {}),
            });
        } catch (error) {
            assertPreparing();
            const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
            fail(ghostMetadataFailureReason(code) ?? "metadata-unavailable");
        }
        assertPreparing();
        const assign = (field: "customExcerpt" | "metaDescription", value: string | undefined, maxLength: number): void => {
            if (!needed[field]) return;
            if (typeof value !== "string" || !value.trim() || Array.from(value).length > maxLength) fail("metadata-invalid");
            exported.fields[field] = { mode: "manage", value };
        };
        assign("customExcerpt", generated.customExcerpt, GHOST_CUSTOM_EXCERPT_MAX);
        assign("metaDescription", generated.metaDescription, GHOST_META_DESCRIPTION_MAX);
        if (needed.slug) {
            if (typeof generated.slug !== "string" || !isValidGhostSlug(generated.slug)) fail("metadata-invalid");
            exported.fields.slug = { mode: "manage", value: generated.slug };
        }
        if (needed.tags) {
            if (!Array.isArray(generated.tags)) fail("metadata-invalid");
            exported.fields.tags = { mode: "manage", value: mergeGhostTagNames([...generated.tags, ...noteTags]) };
        }
    }
    async function resource(plan: ExportResourcePlan): Promise<GhostPreparedImage> {
        const owners = plan.resolvedPath ? resourceAdmissions.get(plan.resolvedPath) : undefined;
        const resourceGuard: GhostPublishingSourceGuard = plan.resolvedPath && owners ? {
            ...sourceGuard,
            isPathAllowed: path => {
                try { assertPath(path); return true; } catch { return false; }
            },
        } : sourceGuard;
        const image = await prepareGhostResource(plan, { host: trackedHost(), client: options.client, isDesktop,
            guard: resourceGuard, sourceValidity: () => sourceGuard.isCurrent(), gate, siteId, siteUrl: adapter.site });
        assertPreparing();
        return image;
    }
    const context: GhostActionContext = {
        gate,
        assertIdentity,
        prepare: async remote => {
            assertPreparing();
            const exported = await prepareGhostExport({
                targetPath: selection.path, host: trackedHost(), guard: sourceGuard, siteProfile: profile, wikiLinks: options.wikiLinks,
                resolveWikiLinks: async occurrences => {
                    const links = await resolveGhostWikiLinks(occurrences, {
                        host: trackedHost(), guard: sourceGuard, siteUrl: adapter.site, assertCurrent: assertPreparing,
                        getSourceRevision: options.getSourceRevision,
                        readPost: async id => options.client.readPost(id, gate),
                    });
                    links.assertCurrent();
                    return links.targets;
                },
            });
            for (const plan of exported.resources) {
                if (plan.kind === "local" && plan.resolvedPath) {
                    resourceAdmissions.set(plan.resolvedPath, [...new Set(plan.occurrences.map(occurrence => occurrence.path))]);
                }
            }
            await prepareMetadata(exported, remote);
            const images: GhostPreparedImage[] = [];
            for (const plan of exported.resources) images.push(await resource(plan));
            if (exported.fields.featureImageCaption?.mode !== "manage" && options.isPaGeneratedImage) {
                const cover = images.find(image => `pending-resource://${image.metadata.id}` === exported.fields.featureImage.value);
                if (cover?.metadata.resolvedPath) {
                    assertPreparing();
                    const generated = await options.isPaGeneratedImage(cover.metadata.resolvedPath, cover.metadata.byteHash);
                    assertPreparing();
                    if (generated) exported.fields.featureImageCaption = { mode: "manage", value: PA_GENERATED_FEATURE_IMAGE_CAPTION };
                }
            }
            const candidate = prepareGhostSnapshot({ exported, profile, resources: images.map(image => image.metadata),
                remote: remote ?? undefined, defaultVisibility: options.defaultVisibility, allowPendingResources: true });
            assertPreparing();
            preparing = false;
            return { candidate, images, slugCandidate: exported.fields.slug.mode === "manage" ? exported.fields.slug.value : undefined };
        },
        validate: async operation => {
            assertPreparing();
            const matchesSavedDraft = operation.target.postStatus === "draft" && operation.verified?.status === "draft"
                && operation.verified.postId === operation.target.postId && initial.postId === operation.target.postId;
            if (operation.siteId !== siteId || operation.site !== adapter.site || operation.noteKey !== selection.path
                || operation.sourcePostId !== initial.postId && !matchesSavedDraft
                || operation.candidate && !same(operation.candidate.profile, profile)) fail("invalid-operation");
            // Fresh confirmation scopes validate current authority without re-exporting any article.
            for (const dependency of operation.candidate?.source.dependencies ?? []) {
                assertPath(dependency.path);
                const file = host.vault.getAbstractFileByPath(dependency.path);
                if (!file || file.extension !== "md") fail("source-unavailable");
                // The Host read checks current content permission (including #no-ai).
                // Text changes do not replace or invalidate the already-reviewed candidate.
                await host.vault.read(file);
                assertPreparing();
            }
            for (const item of operation.candidate?.resources ?? []) {
                if (item.resolvedPath) {
                    assertCore();
                    if (options.isResourcePathAllowed?.(item.resolvedPath, selection.path) !== true
                        && guard.isPathAllowed(item.resolvedPath, "task_material") !== true) fail("source-revoked");
                } else if (/^https?:/.test(item.source)) assertWeb();
            }
            const resolved = await adapter.resolve(selection, sourceGuard);
            assertPreparing();
            if (resolved.file !== initial.file || resolved.postId !== boundPostId) fail("source-changed");
        },
        bind: async post => {
            assertCore();
            assertIdentity();
            const bound = await adapter.writeBinding(selection, { postId: post.id, expectedPostId: boundPostId ?? null }, sourceGuard);
            if (bound.file !== initial.file) fail("source-changed");
            boundPostId = post.id;
            assertCore();
            assertIdentity();
        },
    };
    return { noteKey: selection.path, postId: initial.postId, selection, context };
}

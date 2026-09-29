import { stableStringify } from "../ai-services/agent-utils";
import { GhostNoteBindingAdapter, type GhostBindingHost, type GhostNoteSelection } from "./binding";
import type { GhostClient, GhostRequestGate, GhostVisibility } from "./client";
import { prepareGhostExport } from "./exporter";
import { resolveGhostWikiLinks, type GhostWikiLinkRecordAccess, type GhostWikiLinkReceipt } from "./wiki-links";
import type { FormatReplacementMode } from "./format-preservation";
import { prepareGhostResource, type GhostResourceOptions } from "./resources";
import type { GhostActionContext, GhostPreparedImage } from "./service";
import { ghostPayloadHash, prepareGhostRestore, prepareGhostSnapshot } from "./snapshot";
import type { GhostCompletedRecord, GhostLocalOperation, GhostSnapshot, GhostStoredResource } from "./state-schema";
import type { ExportResourcePlan, GhostExportResult, GhostPublishingHost, GhostPublishingSourceFile,
    GhostPublishingSourceGuard, SitePublishingProfile, WikiLinkTarget } from "./types";

export type GhostActionHost = GhostBindingHost & GhostPublishingHost & GhostResourceOptions["host"];

export interface GhostActionContextOptions extends GhostWikiLinkRecordAccess {
    /** Captured at the explicit entry point; never re-read from the active editor. */
    selection: GhostNoteSelection;
    host: GhostActionHost;
    client: Pick<GhostClient, "downloadImage">;
    isDesktop(): boolean;
    guard: GhostPublishingSourceGuard;
    sourceValidity(): boolean;
    siteId: string;
    siteUrl: string;
    /** Public configuration plus credential-reference revision; never the secret itself. */
    getConnectionIdentity(): string;
    getProfile(): SitePublishingProfile;
    /** Host event generation covering text, Properties, attachments and deletion/rename.
     * Must change even when filesystem timestamps/size are unchanged. This is only a
     * final synchronous freshness fence; validate still reads and hashes actual content. */
    getSourceRevision(path: string): string | number;
    /** Admits only a binary explicitly resolved from an already-admitted Markdown owner. */
    isResourcePathAllowed?(resourcePath: string, ownerPath: string): boolean;
    defaultVisibility: GhostVisibility;
    signal?: AbortSignal;
    replacement?: FormatReplacementMode;
    wikiLinks?: Record<string, WikiLinkTarget>;
    createNoteUid?(): string;
}

export class GhostActionContextError extends Error {
    constructor(readonly code: "desktop-required" | "cancelled" | "source-revoked" | "source-changed"
        | "connection-changed" | "invalid-operation" | "resource-changed" | "restore-unavailable" | "source-unavailable") {
        super(`Ghost publishing context: ${code}.`);
        this.name = "GhostActionContextError";
    }
}

function fail(code: GhostActionContextError["code"]): never { throw new GhostActionContextError(code); }
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function same(left: unknown, right: unknown): boolean { return stableStringify(left) === stableStringify(right); }

function sourceIdentity(source: GhostSnapshot["source"]): unknown {
    return { targetPath: source.targetPath, dependencies: source.dependencies.map(({ mtime: _mtime, size: _size, ...dependency }) => dependency) };
}

/** Includes effective frontmatter and exact image/link intentions, not pa_ghost or source line offsets. */
async function intentHash(exported: GhostExportResult): Promise<string> {
    return ghostPayloadHash({ source: sourceIdentity(exported.sourceManifest), fields: exported.fields, lexical: exported.lexical,
        resources: exported.resources.map((resource) => ({ ...resource,
            occurrences: resource.occurrences.map(({ line: _line, ...occurrence }) => occurrence),
        })) });
}

function resourceMatches(plan: ExportResourcePlan, resource: GhostStoredResource): boolean {
    return plan.id === resource.id && plan.source === resource.source && plan.resolvedPath === resource.resolvedPath;
}

function sameBytes(left: GhostStoredResource, right: GhostStoredResource): boolean {
    return left.byteHash === right.byteHash && left.byteLength === right.byteLength && left.mimeType === right.mimeType;
}

interface CapturedSource {
    exported: GhostExportResult;
    intent: string;
    revisions: Map<string, string | number>;
    resourceAdmissions: Map<string, { resourcePath: string; ownerPaths: string[] }>;
    links?: GhostWikiLinkReceipt;
}

interface ResourceAdmission { resourcePath: string; ownerPaths: string[] }

/** Builds a fresh Host-only context for one explicit action, including restart/continuation. */
export async function createGhostActionContext(options: GhostActionContextOptions): Promise<{
    noteUid: string; postId?: string; selection: GhostNoteSelection & { noteUid: string }; context: GhostActionContext;
}> {
    const { host, guard, sourceValidity, isDesktop, signal, siteId, defaultVisibility, replacement } = options;
    if (isDesktop() !== true) fail("desktop-required");
    const connection = options.getConnectionIdentity();
    const profile = copy(options.getProfile());
    const wikiLinks = options.wikiLinks && copy(options.wikiLinks);
    const sourceGuard: GhostPublishingSourceGuard = {
        isCurrent: () => { try { assertCore(); return true; } catch { return false; } },
        isPathAllowed: (path, kind) => { try { assertCore(); return guard.isPathAllowed(path, kind) === true; } catch { return false; } },
        isNoteDomainAllowed: () => { try { assertCore(); return true; } catch { return false; } },
        isWebAllowed: () => { try { assertCore(); return guard.isWebAllowed?.() === true; } catch { return false; } },
        captureSourceValidity: () => sourceValidity,
    };
    function assertCore(): void {
        if (isDesktop() !== true) fail("desktop-required");
        if (signal?.aborted) fail("cancelled");
        try {
            if (!guard || guard.isCurrent() !== true || guard.isNoteDomainAllowed?.() === false
                || typeof sourceValidity !== "function" || sourceValidity() !== true) fail("source-revoked");
        } catch { fail("source-revoked"); }
        try {
            if (!connection || options.getConnectionIdentity() !== connection || !same(options.getProfile(), profile)
                || profile.siteId !== siteId) fail("connection-changed");
        } catch { fail("connection-changed"); }
    }
    function assertPath(path: string): void {
        assertCore();
        if (!sourceGuard.isPathAllowed(path, "task_material")) fail("source-revoked");
    }
    function assertWeb(): void {
        if (sourceGuard.isWebAllowed?.() !== true) fail("source-revoked");
    }
    function isResourceAdmissionCurrent(admission: ResourceAdmission): boolean {
        return admission.ownerPaths.length > 0
            && admission.ownerPaths.every((ownerPath) => sourceGuard.isPathAllowed(ownerPath, "task_material") === true)
            && options.isResourcePathAllowed?.(admission.resourcePath, admission.ownerPaths[0]) === true;
    }
    function assertAdmittedPath(path: string, admissions: Iterable<ResourceAdmission>): void {
        assertCore();
        if (sourceGuard.isPathAllowed(path, "task_material") === true) return;
        for (const admission of admissions) {
            if (admission.resourcePath === path && isResourceAdmissionCurrent(admission)) return;
        }
        fail("source-revoked");
    }
    function assertRevisions(
        revisions: CapturedSource["revisions"],
        admissions: Iterable<ResourceAdmission> = [],
    ): void {
        assertCore();
        for (const [path, revision] of revisions) {
            assertAdmittedPath(path, admissions);
            if (options.getSourceRevision(path) !== revision) fail("source-changed");
        }
    }
    function track(
        revisions: CapturedSource["revisions"],
        path: string,
        admissions: Iterable<ResourceAdmission> = [],
    ): void {
        assertRevisions(revisions, admissions);
        assertAdmittedPath(path, admissions);
        const revision = options.getSourceRevision(path);
        if (typeof revision !== "string" && (typeof revision !== "number" || !Number.isFinite(revision))) fail("source-unavailable");
        revisions.set(path, revision);
    }
    function trackedHost(
        revisions: CapturedSource["revisions"],
        admissions: Iterable<ResourceAdmission> = [],
    ): GhostActionHost {
        const admissionsById = [...admissions];
        const read = async <T>(file: GhostPublishingSourceFile, action: () => Promise<T>): Promise<T> => {
            const path = file.path;
            track(revisions, path, admissionsById);
            const result = await action();
            assertRevisions(revisions, admissionsById);
            if (file.path !== path) fail("source-changed");
            return result;
        };
        return { ...host, vault: {
            getAbstractFileByPath: (path) => host.vault.getAbstractFileByPath(path),
            getMarkdownFiles: () => host.vault.getMarkdownFiles(),
            read: (file) => read(file, () => host.vault.read(file)),
            readBinary: (file) => read(file, () => host.vault.readBinary(file)),
        } };
    }
    const adapter = new GhostNoteBindingAdapter(host, { site: options.siteUrl, isDesktop, createNoteUid: options.createNoteUid });
    assertCore();
    const initial = await adapter.ensureNoteUid({ ...options.selection }, sourceGuard);
    assertCore();
    if (!initial.binding) fail("source-unavailable");
    const selection = { path: initial.path, noteUid: initial.binding.note_uid };
    async function capture(): Promise<CapturedSource> {
        assertCore();
        const revisions = new Map<string, string | number>();
        track(revisions, selection.path);
        const resolved = await adapter.resolve(selection, sourceGuard);
        assertRevisions(revisions);
        if (resolved.path !== selection.path) fail("source-changed");
        let links: GhostWikiLinkReceipt | undefined;
        // Link receipts own Markdown/source freshness only. The shared revision map
        // later receives explicitly admitted binaries; do not route those through
        // the note-only wiki-link authority.
        const linkRevisions = new Map(revisions);
        const exported = await prepareGhostExport({ targetPath: resolved.path, host: trackedHost(revisions), guard: sourceGuard, siteProfile: profile, wikiLinks,
            resolveWikiLinks: async (occurrences) => {
                links = await resolveGhostWikiLinks(occurrences, { host: trackedHost(revisions), guard: sourceGuard,
                    siteId, siteUrl: adapter.site, assertCurrent: () => assertRevisions(linkRevisions),
                    getSourceRevision: options.getSourceRevision, readCompletedRecord: options.readCompletedRecord,
                    getCompletedRecordRevision: options.getCompletedRecordRevision });
                for (const [path, revision] of revisions) {
                    if (path.toLowerCase().endsWith(".md")) linkRevisions.set(path, revision);
                }
                return links.targets;
            } });
        const intent = await intentHash(exported);
        assertRevisions(revisions);
        links?.assertCurrent();
        const resourceAdmissions = new Map(exported.resources.flatMap((resource) => {
            if (resource.kind !== "local" || !resource.resolvedPath) return [];
            const ownerPaths = [...new Set(resource.occurrences.map((occurrence) => occurrence.path))];
            return ownerPaths.length ? [[resource.resolvedPath, {
                resourcePath: resource.resolvedPath, ownerPaths,
            }] as const] : [];
        }));
        return { exported, revisions, resourceAdmissions, intent, links };
    }
    let accepted: CapturedSource | undefined;
    let originalIntent: string | undefined;
    let selectionRevisions = new Map<string, string | number>();
    track(selectionRevisions, selection.path);
    let historicalPaths: string[] = [];
    let historicalRevisions = new Map<string, string | number>();
    let historicalResourceAdmissions = new Map<string, ResourceAdmission>();
    let historicalWeb = false;
    let completedBaseline: GhostCompletedRecord | null = null;
    const images = new Map<string, GhostPreparedImage>();

    function assertCaptured(source: CapturedSource): void {
        assertRevisions(source.revisions, source.resourceAdmissions.values());
        source.links?.assertCurrent();
        for (const resource of source.exported.resources) {
            for (const occurrence of resource.occurrences) assertPath(occurrence.path);
            if (resource.resolvedPath
                && !(source.resourceAdmissions.get(resource.resolvedPath)
                    && isResourceAdmissionCurrent(source.resourceAdmissions.get(resource.resolvedPath)!))) {
                assertPath(resource.resolvedPath);
            }
            if (resource.kind === "remote") assertWeb();
        }
        assertRevisions(historicalRevisions, historicalResourceAdmissions.values());
        historicalPaths.forEach(path => assertAdmittedPath(path, historicalResourceAdmissions.values()));
        if (historicalWeb) assertWeb();
    }
    function sourceGate(source: CapturedSource): GhostRequestGate {
        return { signal, assertCurrent: () => assertCaptured(source), beforeSend: async () => assertCaptured(source) };
    }
    async function readResource(plan: ExportResourcePlan, source: CapturedSource): Promise<GhostPreparedImage> {
        const resourcePath = plan.kind === "local" ? plan.resolvedPath : undefined;
        const admission = resourcePath === undefined ? undefined : source.resourceAdmissions.get(resourcePath);
        const explicitResourceAdmitted = !!admission && isResourceAdmissionCurrent(admission);
        const resourceGuard: GhostPublishingSourceGuard = resourcePath === undefined || !explicitResourceAdmitted ? sourceGuard : {
            isCurrent: () => sourceGuard.isCurrent(),
            isPathAllowed: (path, kind) => sourceGuard.isPathAllowed(path, kind) === true
                || (path === resourcePath && (kind === undefined || kind === "task_material")),
            isNoteDomainAllowed: () => sourceGuard.isNoteDomainAllowed?.() !== false,
            isWebAllowed: () => sourceGuard.isWebAllowed?.() === true,
            captureSourceValidity: sourceGuard.captureSourceValidity,
        };
        const resourceHost = trackedHost(source.revisions, source.resourceAdmissions.values());
        const image = await prepareGhostResource(plan, {
            host: resourceHost, client: options.client, isDesktop, guard: resourceGuard,
            sourceValidity, gate: sourceGate(source), siteId, siteUrl: adapter.site,
            ...(completedBaseline ? { baseline: { siteId: completedBaseline.binding.siteId,
                site: completedBaseline.binding.site, resources: completedBaseline.baseline.resources } } : {}),
        });
        assertCaptured(source);
        return image;
    }
    async function historical(snapshots: GhostSnapshot[], requireUrls = false): Promise<void> {
        historicalResourceAdmissions = new Map();
        historicalPaths = [...new Set(snapshots.flatMap((candidate) => {
            const mainPath = candidate.source.targetPath;
            // The binding adapter already proved this context's unique note UID.
            // Map only the snapshot's main dependency to the current main path;
            // an unrelated file that later occupies the old path is not that note.
            const remappedMain = mainPath === selection.path ? mainPath : selection.path;
            return [
                ...candidate.source.dependencies.map((dependency) => dependency.path === mainPath ? remappedMain : dependency.path),
                ...candidate.resources.flatMap((resource) => resource.resolvedPath ? [resource.resolvedPath] : []),
            ];
        }))];
        for (const candidate of snapshots) {
            const mainPath = candidate.source.targetPath;
            const remappedMain = mainPath === selection.path ? mainPath : selection.path;
            const ownerPaths = candidate.source.dependencies.map((dependency) =>
                dependency.path === mainPath ? remappedMain : dependency.path);
            for (const resource of candidate.resources) {
                if (!resource.resolvedPath) continue;
                const previous = historicalResourceAdmissions.get(resource.resolvedPath);
                const merged = [...new Set([...previous?.ownerPaths ?? [], ...ownerPaths])];
                historicalResourceAdmissions.set(resource.resolvedPath, {
                    resourcePath: resource.resolvedPath, ownerPaths: merged,
                });
            }
        }
        historicalWeb = snapshots.some((candidate) => candidate.resources.some((resource) => !resource.resolvedPath && /^https?:/.test(resource.source)));
        historicalRevisions = new Map();
        for (const path of historicalPaths) {
            track(historicalRevisions, path, historicalResourceAdmissions.values());
            if (!path.toLowerCase().endsWith(".md")) continue;
            const file = host.vault.getAbstractFileByPath(path);
            if (!file) fail("source-unavailable");
            await trackedHost(historicalRevisions, historicalResourceAdmissions.values()).vault.read(file);
        }
        assertRevisions(historicalRevisions, historicalResourceAdmissions.values());
        if (historicalWeb) assertWeb();
        if (requireUrls && snapshots.some((candidate) => candidate.resources.some((resource) => !resource.url))) fail("restore-unavailable");
    }
    async function current(): Promise<CapturedSource> {
        const fresh = await capture();
        if (originalIntent && fresh.intent !== originalIntent) fail("source-changed");
        return fresh;
    }
    function assertActive(): void {
        if (accepted) assertCaptured(accepted);
        else {
            assertRevisions(selectionRevisions);
            historicalPaths.forEach(path => assertAdmittedPath(path, historicalResourceAdmissions.values()));
            if (historicalWeb) assertWeb();
        }
    }
    async function bindingIntent(): Promise<{ intent: string; revisions: CapturedSource["revisions"] }> {
        const revisions = new Map<string, string | number>();
        track(revisions, selection.path);
        const resolved = await adapter.resolve(selection, sourceGuard);
        if (resolved.path !== selection.path) fail("source-changed");
        const markdown = await trackedHost(revisions).vault.read(resolved.file);
        const info = host.getFrontMatterInfo(markdown);
        const frontmatter = info.exists ? host.parseYaml(info.frontmatter) as Record<string, unknown> : {};
        const intent = await ghostPayloadHash({ body: markdown.slice(info.contentStart), ghost: frontmatter.ghost ?? null });
        assertRevisions(revisions);
        return { intent, revisions };
    }
    const context: GhostActionContext = {
        gate: { signal, assertCurrent: assertActive, beforeSend: async () => assertActive() },
        prepare: async (remote, completed, kind, previous) => {
            assertActive();
            const fresh = await current();
            if (completed && (completed.binding.siteId !== siteId || completed.binding.site !== adapter.site
                || completed.binding.noteUid !== selection.noteUid)) fail("invalid-operation");
            completedBaseline = completed;
            let candidate: GhostSnapshot;
            const prepared: GhostPreparedImage[] = [];
            if (kind === "restore") {
                if (!remote || !completed?.lastUndo) fail("restore-unavailable");
                candidate = prepareGhostRestore(completed.lastUndo, remote, profile);
                await historical([candidate], true);
            } else {
                historicalPaths = [];
                historicalRevisions = new Map();
                historicalResourceAdmissions = new Map();
                historicalWeb = false;
                for (const plan of fresh.exported.resources) {
                    const image = await readResource(plan, fresh);
                    images.set(plan.id, image);
                    prepared.push(image);
                }
                candidate = prepareGhostSnapshot({ exported: fresh.exported, profile, resources: prepared.map((image) => image.metadata),
                    remote: remote ?? undefined, baseline: completed?.baseline ?? previous, defaultVisibility,
                    replacement, allowPendingResources: true });
            }
            assertCaptured(fresh);
            accepted = fresh;
            originalIntent ??= fresh.intent;
            return { candidate, currentSource: fresh.exported.sourceManifest, currentIntentHash: fresh.intent, images: prepared,
                replacePreview: replacement === "replace-all" };
        },
        validate: async (operation: GhostLocalOperation, purpose = "candidate") => {
            assertCore();
            if (!["candidate", "reconcile", "completed"].includes(purpose)
                || !operation.currentSource || !operation.currentIntentHash || operation.siteId !== siteId
                || operation.site !== adapter.site || operation.noteUid !== selection.noteUid
                || !same(operation.candidate.profile, profile)) fail("invalid-operation");
            if (purpose !== "candidate") {
                // Reconciliation checks already-sent material. Current editor content
                // may differ or be unsupported for a new export without blocking repair.
                const currentBinding = await bindingIntent();
                await historical([operation.candidate, ...[operation.preUpdate, operation.completedRecord?.baseline,
                    operation.completedRecord?.lastUndo, completedBaseline?.baseline, completedBaseline?.lastUndo]
                    .filter((value): value is GhostSnapshot => value !== undefined)]);
                historicalPaths = [...new Set([...historicalPaths, ...operation.currentSource.dependencies.map((dependency) => dependency.path)])];
                historicalPaths.forEach(path => assertAdmittedPath(path, historicalResourceAdmissions.values()));
                assertRevisions(currentBinding.revisions);
                selectionRevisions = currentBinding.revisions;
                accepted = undefined;
                return;
            }
            const fresh = await current();
            if (!same(sourceIdentity(operation.currentSource), sourceIdentity(fresh.exported.sourceManifest))
                || operation.currentIntentHash !== fresh.intent) fail("source-changed");
            if (operation.kind === "restore") {
                await historical([operation.candidate], true);
            } else {
                historicalPaths = [];
                historicalRevisions = new Map();
                historicalResourceAdmissions = new Map();
                historicalWeb = false;
                if (!same(sourceIdentity(operation.candidate.source), sourceIdentity(fresh.exported.sourceManifest))
                    || fresh.exported.resources.length !== operation.candidate.resources.length) fail("source-changed");
                for (const plan of fresh.exported.resources) {
                    const resource = operation.candidate.resources.find((item) => resourceMatches(plan, item));
                    if (!resource) fail("resource-changed");
                    if (plan.kind === "local") {
                        const image = await readResource(plan, fresh);
                        if (!sameBytes(image.metadata, resource)) fail("resource-changed");
                        images.set(plan.id, image);
                    } else if (plan.kind === "remote") {
                        assertWeb();
                        const image = images.get(plan.id);
                        if (image && !sameBytes(image.metadata, resource)) fail("resource-changed");
                    } else fail("resource-changed");
                }
            }
            assertCaptured(fresh);
            accepted = fresh;
            originalIntent ??= fresh.intent;
        },
        readImage: async (resource) => {
            if (!accepted) fail("invalid-operation");
            assertCaptured(accepted);
            const plan = accepted.exported.resources.find((item) => resourceMatches(item, resource));
            if (!plan) fail("resource-changed");
            const cached = images.get(plan.id);
            const image = plan.kind === "remote" && cached ? cached : await readResource(plan, accepted);
            if (plan.kind === "remote") assertWeb();
            if (!sameBytes(image.metadata, resource)) fail("resource-changed");
            assertCaptured(accepted);
            return { ...image, metadata: { ...image.metadata }, bytes: new Uint8Array(image.bytes) };
        },
        bind: async (post) => {
            assertActive();
            const before = await bindingIntent();
            assertActive();
            const bound = await adapter.writeBinding(selection, { postId: post.id, postUrl: post.url }, sourceGuard);
            if (bound.path !== selection.path) fail("source-changed");
            selection.path = bound.path;
            // The adapter verifies body preservation; the additional fresh intent also
            // checks ghost Properties. This works even during a completed-record repair.
            const after = await bindingIntent();
            if (before.intent !== after.intent) fail("source-changed");
            if (accepted?.links) {
                // Our own pa_ghost write advances the note event generation. Re-read link
                // receipts against the new binding instead of blessing an old receipt.
                const refreshed = await capture();
                if (refreshed.intent !== accepted.intent) fail("source-changed");
                accepted = refreshed;
            }
            for (const [path, revision] of accepted?.revisions ?? selectionRevisions) {
                if (path !== selection.path && options.getSourceRevision(path) !== revision) fail("source-changed");
                if (path !== selection.path) after.revisions.set(path, revision);
            }
            if (accepted) accepted = { ...accepted, revisions: after.revisions };
            selectionRevisions = after.revisions;
            assertActive();
        },
    };
    return { noteUid: selection.noteUid, postId: initial.binding.post_id, selection, context };
}

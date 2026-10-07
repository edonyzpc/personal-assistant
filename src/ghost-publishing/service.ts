import { GhostClientError, type GhostClient, type GhostPost, type GhostPostWrite, type GhostRequestGate } from "./client";
import { ghostContentFromPost, ghostManagedContentMatches, ghostManagedWrite, ghostPayloadHash, ghostPreviewWrite, materializeGhostSnapshot } from "./snapshot";
import type { GhostLocalOperation, GhostSnapshot, GhostStoredResource } from "./state-schema";
import type { GhostPreviewStore } from "./state-store";
import { ghostPreviewMarker } from "./markers";
import { getPlatformCrypto } from "../platform-dom";

type PublishingClient = Pick<GhostClient, "readPost" | "createDraft" | "updatePost" | "deleteDraft" | "uploadImage">;
type PreviewStore = Pick<GhostPreviewStore, "read" | "write" | "remove">;

export interface GhostPreparedImage {
    metadata: GhostStoredResource;
    bytes: Uint8Array;
    filename: string;
}

/** Host-only authority for a fixed source; model parameters cannot supply this context. */
export interface GhostActionContext {
    gate: GhostRequestGate;
    /** Identity facts survive the preparation scope; this does not grant current permission. */
    assertIdentity(): void;
    prepare(remote: GhostPost | null): Promise<{ candidate: GhostSnapshot; images: GhostPreparedImage[]; slugCandidate?: string }>;
    validate(operation: GhostLocalOperation): Promise<void>;
    bind(post: Pick<GhostPost, "id" | "url">): Promise<void>;
}

export class GhostWorkflowError extends Error {
    constructor(readonly code: "desktop-required" | "operation-active" | "operation-missing"
        | "remote-conflict" | "confirmation-required" | "result-unknown" | "cancelled") {
        super(`Ghost publishing: ${code}.`);
        this.name = "GhostWorkflowError";
    }
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function errorCode(error: unknown): string {
    if (error instanceof GhostClientError) return error.code === "http" && error.status ? `http-${error.status}` : error.code;
    return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "prepare-failed";
}

/** Current session candidates and real effects. Only preview resource pointers are durable. */
export class GhostPublishingService {
    private readonly active = new Set<string>();
    private readonly sessions = new Map<string, GhostLocalOperation>();
    private readonly confirmations = new Set<string>();
    private readonly identities = new Map<string, () => void>();
    private closed = false;

    constructor(private readonly options: {
        siteId: string; site: string; isDesktop(): boolean;
        client: PublishingClient; previews: PreviewStore;
        newId?: () => string; now?: () => string; onUpdate?(operation: GhostLocalOperation): void;
    }) {}

    private now(): string { return this.options.now?.() ?? new Date().toISOString(); }
    private patch(operation: GhostLocalOperation, changes: Partial<GhostLocalOperation>): GhostLocalOperation {
        const next = copy({ ...operation, ...changes, revision: operation.revision + 1, updatedAt: this.now() });
        this.sessions.set(next.operationId, next);
        this.options.onUpdate?.(copy(next));
        return next;
    }
    get(operationId: string): GhostLocalOperation | undefined {
        const operation = this.sessions.get(operationId);
        return operation && copy(operation);
    }
    list(noteKey: string): GhostLocalOperation[] {
        return [...this.sessions.values()].filter(operation => operation.noteKey === noteKey).reverse().map(copy);
    }
    private async serial<T>(noteKey: string, postId: string | undefined, context: GhostActionContext, action: () => Promise<T>): Promise<T> {
        if (this.closed) throw new GhostWorkflowError("cancelled");
        if (!this.options.isDesktop()) throw new GhostWorkflowError("desktop-required");
        context.gate.assertCurrent();
        const keys = [`note:${noteKey}`, ...(postId ? [`post:${postId}`] : [])];
        if (keys.some(key => this.active.has(key))) throw new GhostWorkflowError("operation-active");
        keys.forEach(key => this.active.add(key));
        try { return await action(); }
        finally { keys.forEach(key => this.active.delete(key)); }
    }
    private gate(operation: GhostLocalOperation, context: GhostActionContext): GhostRequestGate {
        const assertCurrent = () => {
            if (this.closed) throw new GhostWorkflowError("cancelled");
            if (!this.options.isDesktop()) throw new GhostWorkflowError("desktop-required");
            context.gate.assertCurrent();
            this.identities.get(operation.operationId)?.();
        };
        return { signal: context.gate.signal, assertCurrent, beforeSend: async () => {
            assertCurrent();
            await context.gate.beforeSend();
            await context.validate(operation);
            assertCurrent();
        } };
    }
    private failed(operation: GhostLocalOperation, error: unknown, writeAttempted: boolean, stage: "prepare" | "confirm" = "prepare"): GhostLocalOperation {
        this.confirmations.delete(operation.operationId);
        const unknown = error instanceof GhostClientError && error.outcome === "unknown";
        const knownSave = operation.verified && (stage === "prepare" || operation.state === "updated");
        const sentFailure = writeAttempted && error instanceof GhostClientError && error.outcome === "failed";
        const executionState = unknown ? "acceptance_unknown" : knownSave ? "succeeded"
            : sentFailure || stage === "prepare" && operation.executionState === "succeeded" ? "failed" : "not_started";
        return this.patch(operation, { state: unknown ? "outcome_unknown" : "failed", executionState, error: errorCode(error) });
    }
    private warn(operation: GhostLocalOperation, warning: NonNullable<GhostLocalOperation["warnings"]>[number]): GhostLocalOperation {
        return this.patch(operation, { warnings: [...new Set([...operation.warnings ?? [], warning])] });
    }
    private verified(post: GhostPost): NonNullable<GhostLocalOperation["verified"]> {
        return { postId: post.id, postUrl: post.url, updatedAt: post.updated_at, status: post.status as "draft" | "published" };
    }
    private async read(id: string, gate: GhostRequestGate): Promise<GhostPost | null> {
        try { return await this.options.client.readPost(id, gate); }
        catch (error) {
            if (error instanceof GhostClientError && error.code === "post-not-found") return null;
            throw error;
        }
    }

    async prepare(noteKey: string, postId: string | undefined, context: GhostActionContext): Promise<GhostLocalOperation> {
        const previous = this.list(noteKey).filter(operation => operation.sourcePostId === postId);
        if (previous[0]?.state === "outcome_unknown") throw new GhostWorkflowError("result-unknown");
        // A successful write followed by a local property failure still has an exact ID.
        const lastSaved = previous.find(operation => operation.verified?.status === "draft" && operation.target.postStatus === "draft");
        const knownId = lastSaved?.warnings?.includes("binding-failed") ? lastSaved.target.postId : postId;
        return this.serial(noteKey, knownId, context, async () => {
            for (const operation of this.sessions.values()) {
                if (operation.noteKey === noteKey || knownId && operation.target.postId === knownId) this.invalidate(operation.operationId);
            }
            let operation: GhostLocalOperation = {
                operationId: this.options.newId?.() ?? getPlatformCrypto()!.randomUUID(), revision: 0,
                siteId: this.options.siteId, site: this.options.site, noteKey, sourcePostId: postId,
                kind: knownId ? "update" : "create", state: "preparing", executionState: "not_started",
                target: knownId ? { postId: knownId } : {}, updatedAt: this.now(),
            };
            operation = this.patch(operation, {});
            let writeAttempted = false;
            try {
                const remote = knownId ? await this.read(knownId, this.gate(operation, context)) : null;
                if (remote && !["draft", "published"].includes(remote.status)) throw new GhostWorkflowError("remote-conflict");
                operation = this.patch(operation, { kind: remote ? "update" : "create", target: remote
                    ? { postId: remote.id, postUrl: remote.url, postVersion: remote.updated_at, postStatus: remote.status as "draft" | "published" } : {} });
                let preview: GhostPost | null = null;
                if (remote?.status === "published") {
                    const localPreview = [...this.sessions.values()].reverse().find(item => item.target.postId === remote.id
                        && item.target.postStatus === "published" && item.target.previewId && item.target.previewId !== remote.id)?.target.previewId;
                    const pointer = await this.options.previews.read(this.options.siteId, remote.id);
                    const previewId = localPreview ?? pointer?.previewId;
                    preview = previewId ? await this.read(previewId, this.gate(operation, context)) : null;
                    if (preview && (preview.id === remote.id || preview.status !== "draft"
                        || !preview.tags.some(tag => tag.name === ghostPreviewMarker(this.options.siteId, remote.id)))) {
                        throw new GhostWorkflowError("remote-conflict");
                    }
                }
                const prepared = await context.prepare(remote);
                this.identities.set(operation.operationId, () => context.assertIdentity());
                operation = this.patch(operation, { candidate: copy(prepared.candidate) });
                const resources: GhostStoredResource[] = [];
                const uploaded = new Map<string, string>();
                for (const resource of prepared.candidate.resources) {
                    const key = `${resource.byteHash}/${resource.byteLength}/${resource.mimeType}`;
                    let url = resource.url ?? uploaded.get(key);
                    if (!url) {
                        const image = prepared.images.find(item => item.metadata.id === resource.id);
                        if (!image || image.metadata.byteHash !== resource.byteHash || image.metadata.byteLength !== resource.byteLength
                            || image.metadata.mimeType !== resource.mimeType) throw new GhostWorkflowError("remote-conflict");
                        writeAttempted = true;
                        const result = await this.options.client.uploadImage({ bytes: image.bytes, filename: image.filename, mimeType: resource.mimeType }, this.gate(operation, context));
                        url = result.url;
                        operation = this.patch(operation, { executionState: "succeeded" });
                    }
                    uploaded.set(key, url);
                    resources.push({ ...resource, url });
                }
                const candidate = materializeGhostSnapshot(prepared.candidate, resources);
                operation = this.patch(operation, { candidate });
                const marker = remote?.status === "published" ? ghostPreviewMarker(this.options.siteId, remote.id) : undefined;
                let fields: GhostPostWrite;
                if (marker) fields = ghostPreviewWrite(candidate, marker);
                else fields = { ...ghostManagedWrite(candidate), status: "draft",
                    ...(!remote && prepared.slugCandidate ? { slug: prepared.slugCandidate } : {}),
                    ...(!remote ? { visibility: candidate.content.visibility } : {}) };
                const destination = remote?.status === "draft" ? remote : preview;
                if (destination) operation = this.patch(operation, { target: { ...operation.target,
                    previewId: destination.id, previewUuid: destination.uuid, previewVersion: destination.updated_at } });
                writeAttempted = true;
                const saved = destination
                    ? await this.options.client.updatePost(destination.id, destination.updated_at, fields, this.gate(operation, context))
                    : await this.options.client.createDraft(fields, this.gate(operation, context));
                // Preserve the actual saved resource before property/pointer writes or later checks.
                operation = this.patch(operation, { executionState: "succeeded", verified: this.verified(saved), target: {
                    ...operation.target,
                    ...(!marker ? { postId: saved.id, postUrl: saved.url, postVersion: saved.updated_at, postStatus: "draft" as const } : {}),
                    previewId: saved.id, previewUuid: saved.uuid, previewVersion: saved.updated_at,
                } });
                if (saved.status !== "draft" || !ghostManagedContentMatches(candidate, saved, marker ? [marker] : [])) {
                    throw new GhostWorkflowError("remote-conflict");
                }
                if (marker) {
                    operation = this.patch(operation, { state: "prepared", target: { ...operation.target,
                        previewHash: await ghostPayloadHash(ghostContentFromPost(saved, [marker])) } });
                    this.confirmations.add(operation.operationId);
                    try { await this.options.previews.write({ siteId: this.options.siteId, postId: remote!.id, previewId: saved.id }); }
                    catch { operation = this.warn(operation, "preview-pointer-failed"); }
                } else {
                    operation = this.patch(operation, { state: "draft_saved" });
                    try { await context.bind(saved); }
                    catch { operation = this.warn(operation, "binding-failed"); }
                }
                return operation;
            } catch (error) {
                return this.failed(operation, error, writeAttempted);
            }
        });
    }

    async confirm(noteKey: string, operationId: string, context: GhostActionContext): Promise<GhostLocalOperation> {
        const existing = this.sessions.get(operationId);
        if (!existing || existing.noteKey !== noteKey) throw new GhostWorkflowError("operation-missing");
        return this.serial(noteKey, existing.target.postId, context, async () => {
            let operation = this.sessions.get(operationId)!;
            if (!this.confirmations.delete(operationId) || operation.state !== "prepared" || !operation.candidate
                || operation.target.postStatus !== "published" || !operation.target.postId || !operation.target.previewId) {
                throw new GhostWorkflowError("confirmation-required");
            }
            let writeAttempted = false;
            try {
                this.identities.get(operationId)?.();
                const gate = this.gate(operation, context);
                const original = await this.read(operation.target.postId, gate);
                const preview = await this.read(operation.target.previewId, gate);
                const marker = ghostPreviewMarker(this.options.siteId, operation.target.postId);
                if (!original || original.status !== "published" || !preview || preview.status !== "draft"
                    || preview.updated_at !== operation.target.previewVersion
                    || !preview.tags.some(tag => tag.name === marker)
                    || await ghostPayloadHash(ghostContentFromPost(preview, [marker])) !== operation.target.previewHash) {
                    throw new GhostWorkflowError("remote-conflict");
                }
                const payload = { ...ghostManagedWrite(operation.candidate), status: "published" as const };
                writeAttempted = true;
                const saved = await this.options.client.updatePost(original.id, original.updated_at, payload, gate);
                operation = this.patch(operation, { state: "updated", executionState: "succeeded", verified: this.verified(saved),
                    target: { ...operation.target, postUrl: saved.url, postVersion: saved.updated_at }, error: undefined });
                if (saved.status !== "published" || !ghostManagedContentMatches(operation.candidate!, saved)) throw new GhostWorkflowError("remote-conflict");
                // Cleanup is independent of the already-confirmed published update.
                try {
                    const current = await this.read(preview.id, this.gate(operation, context));
                    if (current && (current.status !== "draft" || current.updated_at !== preview.updated_at
                        || !current.tags.some(tag => tag.name === marker))) throw new GhostWorkflowError("remote-conflict");
                    if (current) await this.options.client.deleteDraft(current.id, this.gate(operation, context));
                    await this.options.previews.remove(this.options.siteId, original.id);
                } catch { operation = this.warn(operation, "cleanup-failed"); }
                return operation;
            } catch (error) {
                return this.failed(operation, error, writeAttempted, "confirm");
            }
        });
    }

    invalidate(operationId?: string): void {
        for (const id of operationId ? [operationId] : [...this.confirmations]) {
            this.confirmations.delete(id);
            this.identities.delete(id);
        }
    }
    close(): void {
        this.closed = true;
        this.confirmations.clear();
        this.identities.clear();
        this.sessions.clear();
    }
}

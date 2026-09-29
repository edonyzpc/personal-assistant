import { GhostClientError, type GhostClient, type GhostPost, type GhostRequestGate } from "./client";
import {
    acceptGhostFormatting, GhostCandidateError, ghostContentFromPost, ghostManagedContentMatches, ghostManagedWrite,
    ghostPayloadHash, ghostPreviewWrite, ghostRenderingMatches, materializeGhostSnapshot, preserveGhostPreviewFormatting,
} from "./snapshot";
import {
    isGhostPublicationActive, sealCompletedRecord, sealLocalOperation, type GhostCompletedRecord, type GhostLocalOperation,
    type GhostSnapshot, type GhostStoredResource,
} from "./state-schema";
import type { GhostCompletedRecordStore, GhostOperationStore } from "./state-store";

type PublishingClient = Pick<GhostClient, "readPost" | "findPostsByMarker" | "createDraft" | "updatePost" | "deleteDraft" | "uploadImage">;
type OperationStore = Pick<GhostOperationStore, "list" | "save">;
type RecordStore = Pick<GhostCompletedRecordStore, "read" | "write">;

export interface GhostPreparedImage {
    metadata: GhostStoredResource;
    bytes: Uint8Array;
    filename: string;
}

/** Created by Host for this explicit action. Never accepted from model arguments. */
export interface GhostActionContext {
    gate: GhostRequestGate;
    /** Recheck current source, historical restore sources, resources and connection/profile. */
    validate(operation: GhostLocalOperation, purpose?: "candidate" | "reconcile" | "completed"): Promise<void>;
    prepare(remote: GhostPost | null, completed: GhostCompletedRecord | null, kind: GhostLocalOperation["kind"], previous?: GhostSnapshot): Promise<{
        candidate: GhostSnapshot;
        currentSource: GhostSnapshot["source"];
        currentIntentHash: string;
        images: GhostPreparedImage[];
        /** Set only for the user's explicit full-replacement action, never a model argument. */
        replacePreview?: boolean;
    }>;
    readImage(resource: GhostStoredResource): Promise<GhostPreparedImage>;
    /** Uses the guarded note binding adapter; failure must preserve this operation's known ID. */
    bind(post: Pick<GhostPost, "id" | "url">): Promise<void>;
}

export interface GhostPreviewCheck {
    candidateHash: string;
    /** Captured by the fixed native probe; navigation/reload/close invalidates the receipt. */
    isCurrent(): boolean;
    passed: boolean;
}

export interface GhostConfirmationTicket { operationId: string; nonce: string; candidateHash: string }

export class GhostWorkflowError extends Error {
    constructor(readonly code: "desktop-required" | "operation-active" | "operation-missing" | "sync-required"
        | "remote-conflict" | "other-desktop" | "confirmation-required" | "preview-required"
        | "result-unknown" | "resource-result-unknown" | "record-pending" | "restore-unavailable") {
        super(`Ghost publishing: ${code}.`);
        this.name = "GhostWorkflowError";
    }
}

interface ReadyConfirmation {
    ticket: GhostConfirmationTicket;
    revision: number;
    context: GhostActionContext;
    check: GhostPreviewCheck;
}

/** Owns one desktop's durable requests. Synced records contain completed facts only. */
export class GhostPublishingService {
    private readonly active = new Set<string>();
    private readonly confirmations = new Map<string, ReadyConfirmation>();

    constructor(private readonly options: {
        siteId: string; site: string; isDesktop(): boolean;
        client: PublishingClient; operations: OperationStore; records: RecordStore;
        newId?: () => string; now?: () => string;
    }) {}

    private now(): string { return this.options.now?.() ?? new Date().toISOString(); }
    private id(): string { return this.options.newId?.() ?? globalThis.crypto.randomUUID(); }
    private bindingMarker(noteUid: string, create: boolean): string {
        return `#pa-ghost-${create ? "op" : "preview"}-${noteUid}`;
    }
    private markers(operation: GhostLocalOperation): string[] {
        return [`#pa-ghost-op-${operation.operationId}`, this.bindingMarker(operation.noteUid, operation.kind === "create")];
    }
    private async serial<T>(noteUid: string, context: GhostActionContext, action: () => Promise<T>): Promise<T> {
        if (!this.options.isDesktop()) throw new GhostWorkflowError("desktop-required");
        context.gate.assertCurrent();
        if (context.gate.signal?.aborted) throw new GhostWorkflowError("confirmation-required");
        if (this.active.has(noteUid)) throw new GhostWorkflowError("operation-active");
        this.active.add(noteUid);
        try { return await action(); } finally { this.active.delete(noteUid); }
    }
    private gate(operation: GhostLocalOperation, context: GhostActionContext, extra?: () => void,
        purpose: "candidate" | "reconcile" | "completed" = "candidate"): GhostRequestGate {
        const assertCurrent = () => {
            if (!this.options.isDesktop()) throw new GhostWorkflowError("desktop-required");
            context.gate.assertCurrent();
            if (context.gate.signal?.aborted) throw new GhostWorkflowError("confirmation-required");
            extra?.();
        };
        return { signal: context.gate.signal, assertCurrent, beforeSend: async () => {
            assertCurrent();
            await context.gate.beforeSend();
            await context.validate(operation, purpose);
            assertCurrent();
        } };
    }
    private async load(noteUid: string, operationId: string): Promise<GhostLocalOperation> {
        const operation = (await this.options.operations.list(this.options.siteId, noteUid)).find((item) => item.operationId === operationId);
        if (!operation || operation.site !== this.options.site) throw new GhostWorkflowError("operation-missing");
        return operation;
    }
    private async save(operation: GhostLocalOperation, changes: Partial<GhostLocalOperation>): Promise<GhostLocalOperation> {
        const next = sealLocalOperation({ ...operation, ...changes, revision: operation.revision + 1,
            confirmation: null, updatedAt: this.now() });
        await this.options.operations.save(next, operation.revision);
        return next;
    }
    private async persistWrite(
        operation: GhostLocalOperation, pending: NonNullable<GhostLocalOperation["pending"]>,
        context: GhostActionContext, send: (gate: GhostRequestGate) => Promise<GhostPost>,
    ): Promise<{ operation: GhostLocalOperation; post: GhostPost }> {
        const sending = await this.save(operation, { state: "pending", pending });
        try { return { operation: sending, post: await send(this.gate(sending, context)) }; }
        catch (error) {
            const unknown = !(error instanceof GhostClientError) || error.outcome === "unknown";
            await this.save(sending, { state: unknown ? "outcome_unknown" : "prepared", pending: unknown ? pending : undefined });
            throw error;
        }
    }

    async prepare(noteUid: string, postId: string | undefined, context: GhostActionContext, restore = false): Promise<GhostLocalOperation> {
        return this.serial(noteUid, context, async () => {
            const locals = await this.options.operations.list(this.options.siteId, noteUid);
            if (locals.some(isGhostPublicationActive)) throw new GhostWorkflowError("operation-active");
            const record = await this.options.records.read(this.options.siteId, noteUid);
            if (postId && (!record || record.binding.postId !== postId) || record && record.binding.site !== this.options.site) {
                throw new GhostWorkflowError("sync-required");
            }
            if (restore && !record?.lastUndo) throw new GhostWorkflowError("restore-unavailable");
            const knownId = postId ?? record?.binding.postId;
            const remote = knownId ? await this.options.client.readPost(knownId, context.gate) : null;
            if (remote && (remote.status !== "published" && remote.status !== "draft"
                || record && remote.url !== record.binding.postUrl)) throw new GhostWorkflowError("remote-conflict");
            const kind = restore ? "restore" : remote ? "update" : "create";
            const previousDrafts = await this.options.client.findPostsByMarker(this.bindingMarker(noteUid, !remote), context.gate, true);
            const unfinished = previousDrafts.filter((post) => {
                if (post.id === knownId) return false;
                if (locals.some((local) => !isGhostPublicationActive(local) && local.completedRecord && local.cleanup?.postId === post.id)) return false;
                // A newer completed server version supersedes earlier draft candidates.
                // Their old version/baseline cannot authorize another final PUT. Retain
                // the drafts untouched, including later human edits; never take them over.
                return !(record && post.status === "draft" && post.created_at
                    && Date.parse(post.created_at) < Date.parse(record.completed.updatedAt));
            });
            if (unfinished.length) throw new GhostWorkflowError("other-desktop");
            const prepared = await context.prepare(remote, record, kind);
            context.gate.assertCurrent();
            let operation = sealLocalOperation({
                schemaVersion: 1, revision: 1, operationId: this.id(), siteId: this.options.siteId, site: this.options.site, noteUid,
                kind, state: "prepared", candidate: prepared.candidate, currentSource: prepared.currentSource, currentIntentHash: prepared.currentIntentHash,
                baselineRevision: record?.revision ?? null, baselineChecksum: record?.checksum,
                ...(remote && remote.visibility !== prepared.candidate.content.visibility ? {
                    visibilityChange: { from: remote.visibility as "public" | "members" | "paid", to: prepared.candidate.content.visibility as "public" | "members" | "paid" },
                } : {}),
                target: remote ? { postId: remote.id, postUrl: remote.url, postVersion: remote.updated_at, postStatus: remote.status as "draft" | "published" } : {},
                confirmation: null, updatedAt: this.now(),
            });
            await context.validate(operation);
            await this.options.operations.save(operation, 0);
            operation = await this.uploadResources(operation, context, prepared.images);
            return this.savePreview(operation, context);
        });
    }

    /** An explicit fresh preparation after edits; pending writes must be reconciled first. */
    async reprepare(noteUid: string, operationId: string, context: GhostActionContext): Promise<GhostLocalOperation> {
        return this.serial(noteUid, context, async () => {
            this.confirmations.delete(operationId);
            let operation = await this.load(noteUid, operationId);
            if (!["prepared", "ready"].includes(operation.state)) throw new GhostWorkflowError("result-unknown");
            const record = await this.options.records.read(this.options.siteId, noteUid);
            if ((record?.checksum ?? undefined) !== operation.baselineChecksum) throw new GhostWorkflowError("sync-required");
            // The new context authorizes current material; comparing the old source here
            // would make any legitimate local edit permanently impossible to re-prepare.
            const original = operation.target.postId ? await this.options.client.readPost(operation.target.postId, context.gate) : null;
            const preview = operation.target.previewId ? await this.options.client.readPost(operation.target.previewId, context.gate) : null;
            if (original && (original.status !== operation.target.postStatus || original.url !== operation.target.postUrl)
                || preview && (preview.status !== "draft" || !this.markers(operation).every((marker) => preview.tags.some((tag) => tag.name === marker)))) {
                throw new GhostWorkflowError("remote-conflict");
            }
            const preparationRemote = original && operation.target.postStatus === "draft"
                ? { ...original, tags: original.tags.filter((tag) => !this.markers(operation).includes(tag.name)) } : original;
            const prepared = await context.prepare(preparationRemote, record, operation.kind, operation.candidate);
            let candidate = prepared.candidate;
            if (preview) candidate = preserveGhostPreviewFormatting(candidate, operation.candidate, preview, this.markers(operation), prepared.replacePreview);
            const resources = candidate.resources.map((resource) => {
                const reusable = operation.candidate.resources.find((item) => item.byteHash === resource.byteHash && item.url);
                return resource.url || !reusable ? resource : { ...resource, url: reusable.url };
            });
            operation = await this.save(operation, {
                state: "prepared", pending: undefined, candidate: { ...candidate, resources }, currentSource: prepared.currentSource, currentIntentHash: prepared.currentIntentHash,
                target: { ...operation.target, ...(original ? { postVersion: original.updated_at } : {}),
                    ...(preview ? { previewVersion: preview.updated_at } : {}), previewHash: undefined },
                visibilityChange: original && original.visibility !== candidate.content.visibility
                    ? { from: original.visibility as "public" | "members" | "paid", to: candidate.content.visibility as "public" | "members" | "paid" } : undefined,
            });
            await context.validate(operation);
            operation = await this.uploadResources(operation, context, prepared.images);
            return this.savePreview(operation, context);
        });
    }

    private async uploadResources(operation: GhostLocalOperation, context: GhostActionContext, prepared: GhostPreparedImage[] = []): Promise<GhostLocalOperation> {
        let current = operation;
        for (const resource of current.candidate.resources) {
            if (resource.url) continue;
            const image = prepared.find((item) => item.metadata.id === resource.id) ?? await context.readImage(resource);
            if (image.metadata.byteHash !== resource.byteHash || image.metadata.byteLength !== resource.byteLength) throw new GhostWorkflowError("remote-conflict");
            const pending = { kind: "resource_upload" as const, marker: this.markers(current)[0], payloadHash: resource.byteHash, resource };
            current = await this.save(current, { state: "pending", pending });
            let result: { url: string };
            try { result = await this.options.client.uploadImage({ bytes: image.bytes, filename: image.filename, mimeType: resource.mimeType }, this.gate(current, context)); }
            catch (error) {
                const unknown = !(error instanceof GhostClientError) || error.outcome === "unknown";
                await this.save(current, { state: unknown ? "outcome_unknown" : "prepared", pending: unknown ? pending : undefined });
                throw error;
            }
            const resources = current.candidate.resources.map((item) => item.id === resource.id ? { ...item, url: result.url } : item);
            current = await this.save(current, { state: "prepared", pending: undefined, candidate: { ...current.candidate, resources } });
        }
        return this.save(current, { candidate: materializeGhostSnapshot(current.candidate, current.candidate.resources) });
    }

    private async savePreview(operation: GhostLocalOperation, context: GhostActionContext): Promise<GhostLocalOperation> {
        const markers = this.markers(operation);
        const fields = ghostPreviewWrite(operation.candidate, markers[0]);
        fields.tags?.push({ name: markers[1], visibility: "internal" });
        const isOriginalDraft = operation.target.postStatus === "draft";
        const targetId = operation.target.previewId ?? (isOriginalDraft ? operation.target.postId : undefined);
        const version = operation.target.previewVersion ?? operation.target.postVersion;
        const pending = { kind: targetId ? "save_preview" as const : "create_draft" as const,
            marker: markers[0], targetId, payloadHash: await ghostPayloadHash(fields) };
        const result = await this.persistWrite(operation, pending, context, (gate) => targetId && version
            ? this.options.client.updatePost(targetId, version, fields, gate) : this.options.client.createDraft(fields, gate));
        return this.adoptPreview(result.operation, result.post, context);
    }

    private async adoptPreview(operation: GhostLocalOperation, post: GhostPost, context: GhostActionContext): Promise<GhostLocalOperation> {
        if (post.status !== "draft" || !this.markers(operation).every((marker) => post.tags.some((tag) => tag.name === marker))) {
            throw new GhostWorkflowError("result-unknown");
        }
        const isOriginal = operation.kind === "create" || operation.target.postStatus === "draft";
        // Persist the known ID before validating details or writing note properties.
        let current = await this.save(operation, { state: "prepared", pending: undefined, target: {
            ...operation.target, ...(isOriginal ? { postId: post.id, postUrl: post.url, postVersion: post.updated_at, postStatus: "draft" as const } : {}),
            previewId: post.id, previewUuid: post.uuid, previewVersion: post.updated_at,
        } });
        if (isOriginal) await context.bind(post);
        if (!ghostRenderingMatches(current.candidate, post, this.markers(current), current.kind === "create")) throw new GhostWorkflowError("remote-conflict");
        current = await this.save(current, { candidate: acceptGhostFormatting(current.candidate, post, this.markers(current)),
            target: { ...current.target, previewHash: await ghostPayloadHash(ghostContentFromPost(post, this.markers(current))) } });
        return current;
    }

    /** Resolve the rare unknown create whose exact draft was manually published. */
    private async adoptPublished(operation: GhostLocalOperation, post: GhostPost, context: GhostActionContext): Promise<GhostLocalOperation> {
        if (!this.markers(operation).every((marker) => post.tags.some((tag) => tag.name === marker))) {
            throw new GhostWorkflowError("result-unknown");
        }
        const current = await this.save(operation, { state: "prepared", pending: undefined, target: {
            ...operation.target, postId: post.id, postUrl: post.url, postVersion: post.updated_at,
            postStatus: "published" as const, previewId: post.id, previewUuid: post.uuid,
            previewVersion: post.updated_at,
        } });
        await context.bind(post);
        try {
            return await this.complete(current, post, context);
        } catch (error) {
            if (error instanceof GhostCandidateError) throw new GhostWorkflowError("result-unknown");
            throw error;
        }
    }

    /** Host probe only: returned nonce stays in the button closure, never in model-visible facts. */
    async checkPreview(noteUid: string, operationId: string, context: GhostActionContext,
        probe: (operation: GhostLocalOperation, candidateHash: string) => Promise<GhostPreviewCheck>): Promise<GhostConfirmationTicket> {
        return this.serial(noteUid, context, async () => {
            let operation = await this.load(noteUid, operationId);
            this.confirmations.delete(operationId);
            if (!["prepared", "ready"].includes(operation.state) || !operation.target.previewId) throw new GhostWorkflowError("preview-required");
            const remote = await this.options.client.readPost(operation.target.previewId, this.gate(operation, context));
            if (remote.status !== "draft") throw new GhostWorkflowError("remote-conflict");
            if (!ghostRenderingMatches(operation.candidate, remote, this.markers(operation))) throw new GhostWorkflowError("remote-conflict");
            // Accept a user's formatting adjustment, then inspect that exact new version.
            operation = await this.save(operation, { state: "prepared", candidate: acceptGhostFormatting(operation.candidate, remote, this.markers(operation)),
                target: { ...operation.target, previewVersion: remote.updated_at, previewHash: await ghostPayloadHash(ghostContentFromPost(remote, this.markers(operation))) } });
            const candidateHash = await ghostPayloadHash(operation.candidate);
            const check = await probe(operation, candidateHash);
            await context.validate(operation);
            if (!check.passed || check.candidateHash !== candidateHash || !check.isCurrent()) throw new GhostWorkflowError("preview-required");
            operation = await this.save(operation, { state: "ready" });
            const ticket = { operationId, candidateHash, nonce: this.id() };
            this.confirmations.set(operationId, { ticket, revision: operation.revision, context, check });
            return ticket;
        });
    }

    /** Called only from the Host confirmation button for its current ticket. */
    async confirm(noteUid: string, ticket: GhostConfirmationTicket, context: GhostActionContext, visibilityConfirmed = false): Promise<GhostLocalOperation> {
        return this.serial(noteUid, context, async () => {
            let operation = await this.load(noteUid, ticket.operationId);
            const ready = this.confirmations.get(ticket.operationId);
            this.confirmations.delete(ticket.operationId);
            if (!ready || ready.context !== context || ready.revision !== operation.revision || ready.ticket.nonce !== ticket.nonce
                || ready.ticket.candidateHash !== ticket.candidateHash || !ready.check.isCurrent()
                || operation.state !== "ready" || operation.target.postStatus !== "published" || !operation.target.postId || !operation.target.previewId
                || operation.visibilityChange && !visibilityConfirmed) {
                throw new GhostWorkflowError("confirmation-required");
            }
            const extra = () => { if (!ready.check.isCurrent()) throw new GhostWorkflowError("preview-required"); };
            const gate = this.gate(operation, context, extra);
            const preview = await this.options.client.readPost(operation.target.previewId, gate);
            const original = await this.options.client.readPost(operation.target.postId, gate);
            if (preview.status !== "draft" || preview.updated_at !== operation.target.previewVersion
                || await ghostPayloadHash(ghostContentFromPost(preview, this.markers(operation))) !== operation.target.previewHash
                || original.updated_at !== operation.target.postVersion || original.status !== "published" || original.url !== operation.target.postUrl) {
                throw new GhostWorkflowError("remote-conflict");
            }
            const record = await this.options.records.read(this.options.siteId, noteUid);
            if (!record || record.checksum !== operation.baselineChecksum) throw new GhostWorkflowError("sync-required");
            const preUpdate = { ...record.baseline, content: ghostContentFromPost(original), managedFields: operation.candidate.managedFields };
            operation = await this.save(operation, { preUpdate, cleanup: {
                postId: preview.id, marker: this.markers(operation)[0], updatedAt: preview.updated_at,
                payloadHash: await ghostPayloadHash(ghostContentFromPost(preview, this.markers(operation))),
            } });
            const payload = ghostManagedWrite(operation.candidate);
            const result = await this.persistWrite(operation, { kind: "final_put", marker: this.markers(operation)[0],
                targetId: original.id, payloadHash: await ghostPayloadHash(payload) }, context,
            (requestGate) => this.options.client.updatePost(original.id, original.updated_at, payload, {
                ...requestGate, assertCurrent: () => { requestGate.assertCurrent(); extra(); },
            }));
            const verified = await this.options.client.readPost(original.id, this.gate(result.operation, context, undefined, "reconcile"));
            return this.complete(result.operation, verified, context);
        });
    }

    /** Explicit check/continue after restart. It never reuses a confirmation or blindly resends an unknown request. */
    async refresh(noteUid: string, operationId: string, context: GhostActionContext): Promise<GhostLocalOperation> {
        return this.serial(noteUid, context, async () => {
            this.confirmations.delete(operationId);
            let operation = await this.load(noteUid, operationId);
            // A readback can discover that Ghost's manual Publish already succeeded,
            // even if the local note has moved on. Any new write below still uses
            // its own candidate gate, and preview confirmation always revalidates it.
            const purpose = operation.verified && operation.completedRecord ? "completed" : "reconcile";
            await context.validate(operation, purpose);
            if (operation.state === "succeeded_remote_pending_record") return this.repairRecord(operation, context);
            if (operation.state === "cleanup_pending") return this.cleanup(operation, context);
            if (operation.state === "terminal") return operation;
            if (operation.state === "pending" || operation.state === "outcome_unknown") {
                const pending = operation.pending!;
                if (pending.kind === "resource_upload") throw new GhostWorkflowError("resource-result-unknown");
                if (pending.kind === "cleanup") return this.cleanup(operation, context);
                if (pending.kind === "final_put") {
                    const post = await this.options.client.readPost(pending.targetId!, this.gate(operation, context, undefined, "reconcile"));
                    if (post.updated_at !== operation.target.postVersion && ghostManagedContentMatches(operation.candidate, post, this.markers(operation))) return this.complete(operation, post, context);
                    throw new GhostWorkflowError("result-unknown");
                }
                const matches = pending.targetId
                    ? [await this.options.client.readPost(pending.targetId, this.gate(operation, context, undefined, "reconcile"))]
                    : await this.options.client.findPostsByMarker(pending.marker, this.gate(operation, context, undefined, "reconcile"));
                if (matches.length === 1 && (pending.kind === "create_draft" || pending.kind === "save_preview")
                    && operation.kind === "create"
                    && matches[0].status === "published") {
                    return this.adoptPublished(operation, matches[0], context);
                }
                if (matches.length !== 1 || !ghostRenderingMatches(operation.candidate, matches[0], this.markers(operation), operation.kind === "create")) {
                    throw new GhostWorkflowError("result-unknown");
                }
                return this.adoptPreview(operation, matches[0], context);
            }
            if (!operation.target.previewId) {
                operation = await this.uploadResources(operation, context);
                return this.savePreview(operation, context);
            }
            const post = await this.options.client.readPost(operation.target.previewId, this.gate(operation, context, undefined, "reconcile"));
            if ((operation.kind === "create" || operation.target.postStatus === "draft") && post.status === "published") {
                return this.complete(operation, post, context);
            }
            if (post.status !== "draft" || !ghostRenderingMatches(operation.candidate, post, this.markers(operation))) throw new GhostWorkflowError("remote-conflict");
            if (operation.kind === "create" || operation.target.postStatus === "draft") await context.bind(post);
            return this.save(operation, { state: "prepared", candidate: acceptGhostFormatting(operation.candidate, post, this.markers(operation)),
                target: { ...operation.target, previewVersion: post.updated_at, previewHash: await ghostPayloadHash(ghostContentFromPost(post, this.markers(operation))) } });
        });
    }

    private async complete(operation: GhostLocalOperation, post: GhostPost, context: GhostActionContext): Promise<GhostLocalOperation> {
        if (post.id !== operation.target.postId || post.status !== "published"
            || operation.target.postStatus === "published" && post.url !== operation.target.postUrl) throw new GhostWorkflowError("result-unknown");
        const baseline = acceptGhostFormatting(operation.candidate, post, this.markers(operation));
        // First drafts become the formal article. Keep their actual internal tags in
        // the completed baseline; temporary preview markers never reach a final PUT.
        if (operation.kind === "create" || operation.target.postStatus === "draft") baseline.content = ghostContentFromPost(post);
        const completedRecord = sealCompletedRecord({ schemaVersion: 1, revision: (operation.baselineRevision ?? 0) + 1,
            binding: { siteId: operation.siteId, site: operation.site, noteUid: operation.noteUid, postId: post.id, postUrl: post.url },
            completed: { postId: post.id, postUrl: post.url, updatedAt: post.updated_at, status: "published", verifiedAt: this.now() }, baseline,
            ...(operation.kind === "update" && operation.preUpdate ? { lastUndo: operation.preUpdate } : {}),
        });
        const current = await this.save(operation, { state: "succeeded_remote_pending_record", pending: undefined,
            verified: { postId: post.id, postUrl: post.url, updatedAt: post.updated_at, status: "published" }, completedRecord });
        return this.repairRecord(current, context);
    }

    private async repairRecord(operation: GhostLocalOperation, context: GhostActionContext): Promise<GhostLocalOperation> {
        const record = operation.completedRecord;
        if (!record || !operation.verified) throw new GhostWorkflowError("record-pending");
        await context.validate(operation, "completed");
        try {
            await context.bind({ id: operation.verified.postId, url: operation.verified.postUrl });
            context.gate.assertCurrent();
            const saved = await this.options.records.read(operation.siteId, operation.noteUid);
            context.gate.assertCurrent();
            if (saved?.checksum !== record.checksum) await this.options.records.write(record, operation.baselineChecksum ?? null);
        } catch { throw new GhostWorkflowError("record-pending"); }
        const current = await this.save(operation, { state: operation.cleanup ? "cleanup_pending" : "terminal", pending: undefined });
        return operation.cleanup ? this.cleanup(current, context) : current;
    }

    private async cleanup(operation: GhostLocalOperation, context: GhostActionContext): Promise<GhostLocalOperation> {
        const cleanup = operation.cleanup;
        if (!cleanup) return this.save(operation, { state: "terminal", pending: undefined });
        let post: GhostPost;
        try { post = await this.options.client.readPost(cleanup.postId, this.gate(operation, context, undefined, "completed")); }
        catch (error) {
            if (error instanceof GhostClientError && error.status === 404) return this.save(operation, { state: "terminal", pending: undefined, cleanup: undefined });
            return operation;
        }
        if (post.status !== "draft" || post.updated_at !== cleanup.updatedAt || !post.tags.some((tag) => tag.name === cleanup.marker)
            || await ghostPayloadHash(ghostContentFromPost(post, this.markers(operation))) !== cleanup.payloadHash) {
            // A changed/published draft is now the user's. Retain it and end our cleanup ownership.
            return this.save(operation, { state: "terminal", pending: undefined });
        }
        const current = await this.save(operation, { state: "cleanup_pending", pending: {
            kind: "cleanup", marker: cleanup.marker, targetId: post.id, payloadHash: cleanup.payloadHash,
        } });
        try { await this.options.client.deleteDraft(post.id, this.gate(current, context, undefined, "completed")); }
        catch { return current; }
        return this.save(current, { state: "terminal", pending: undefined, cleanup: undefined });
    }

    invalidate(operationId?: string): void {
        if (operationId) this.confirmations.delete(operationId);
        else this.confirmations.clear();
    }
}

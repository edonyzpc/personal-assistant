import { getFrontMatterInfo, parseYaml, resolveSubpath, TFile, type App, type CachedMetadata } from "obsidian";
import { getVaultConfigDir } from "../obsidian-paths";
import { createGhostActionContext, type GhostActionContextOptions, type GhostActionHost } from "./action-context";
import { GhostClient } from "./client";
import { GhostPublishingConfiguration, type GhostConnection } from "./configuration";
import { GhostNativePreviewAdapter, ghostPreviewExpectations, ghostPreviewUrl, type GhostPreviewDiagnostics, type GhostPreviewHost } from "./preview";
import { GhostPublishingService, type GhostActionContext, type GhostConfirmationTicket } from "./service";
import { GhostCompletedRecordStore, GhostOperationStore, ghostDatabaseName } from "./state-store";
import { ghostRecordPath, isGhostPublicationActive, type GhostLocalOperation } from "./state-schema";
import type { GhostNoteSelection } from "./binding";
import type { GhostPublishingSourceGuard } from "./types";

export interface GhostActionAuthority { guard: GhostPublishingSourceGuard; sourceValidity(): boolean; signal?: AbortSignal }
export type GhostCardAction = "continue" | "reprepare" | "change-draft-url" | "regenerate-metadata" | "replace-all" | "check-preview" | "confirm" | "check-published"
    | "restore" | "open-editor" | "open-browser";
export interface GhostCardState {
    title: string; site: string; operationId?: string;
    status: "preparing" | "prepared" | "awaiting-publish" | "checked" | "checked-restore" | "completed"
        | "completed-restore" | "cleanup-pending" | "needs-attention" | "outcome-unknown";
    busy: boolean; errorKey?: string;
    previewStatus?: GhostPreviewDiagnostics["status"]; previewReasonKey?: string;
    warningKeys?: string[];
    visibilityChange?: { from: string; to: string };
    actions: GhostCardAction[];
    operationKind?: GhostLocalOperation["kind"];
}
export interface GhostPublishingSession {
    getState(): GhostCardState;
    getContextReceipt(): { operationId: string; revision: number; state: GhostLocalOperation['state']; verified: boolean } | undefined;
    registerContextPersistence?(persist: (receipt: NonNullable<ReturnType<GhostPublishingSession['getContextReceipt']>>) => Promise<boolean>, conversationId: string): void;
    unregisterContextPersistence?(): void;
    subscribe(listener: () => void): () => void;
    run(action: GhostCardAction, confirmation?: { visibilityConfirmed?: boolean; replacementConfirmed?: boolean }): Promise<void>;
    dispose(): void;
}
export interface GhostControllerOptions {
    app: App; configuration: GhostPublishingConfiguration; vaultPath: string; pluginId: string;
    isDesktop(): boolean; isCurrent(): boolean; isWebViewerEnabled(): boolean;
    getSourceRevision(path: string): string | number;
    isPathAllowed(path: string): boolean;
    /** Re-evaluate actual freshly read Markdown; metadata caches may lag new private tags. */
    isContentAllowed(path: string, markdown: string): boolean;
    /** Desktop Host external opener; window.open can be captured by the core Web viewer. */
    openExternal(url: string): void | Promise<void>;
    generateMetadata?: GhostActionContextOptions["generateMetadata"];
}
export interface GhostControllerRequest {
    path: string; intent: "prepare" | "restore"; authority: GhostActionAuthority;
    createActionAuthority(): GhostActionAuthority;
    onSession(session: GhostPublishingSession): void;
}
export interface GhostControllerResult { status: "prepared" | "needs_attention" | "outcome_unknown"; operationId?: string }

const KEY = "plugin.ghost.card.";
const WARNING_CODES = new Set(["unresolved-wiki-link", "unpublished-wiki-link", "ambiguous-wiki-link", "wiki-link-anchor-fallback",
    "unknown-highlight-language", "profile-page-check-required"]);
function failure(code: string): Error & { code: string } { return Object.assign(new Error("Ghost publishing action could not finish."), { code }); }
function errorCode(error: unknown): string { return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown"; }
function errorKey(error: unknown): string {
    const code = errorCode(error);
    if (["desktop-required", "unsupported-platform"].includes(code)) return `${KEY}error.platform`;
    if (["not-configured", "invalid-key", "invalid-credentials", "invalid-settings"].includes(code)) return `${KEY}error.configuration`;
    if (["connection-changed", "connection_changed", "changing", "site-mismatch"].includes(code)) return `${KEY}error.connection`;
    if (["guard-revoked", "source-revoked", "source-changed", "source_changed", "context-revoked", "gate-rejected", "cancelled", "web-denied"].includes(code)) return `${KEY}error.source`;
    if (["content-conflict", "remote-conflict", "duplicate-identity", "post-mismatch", "other-desktop"].includes(code)) return `${KEY}error.conflict`;
    if (["sync-required", "missing-baseline", "restore-unavailable"].includes(code)) return `${KEY}error.sync`;
    if (["resource-changed", "resource-unavailable", "unsupported-image", "resource-too-large", "read-failed"].includes(code)) return `${KEY}error.resource`;
    if (["confirmation-required", "preview-required"].includes(code)) return `${KEY}error.confirmation`;
    if (["storage-unavailable", "record-conflict", "operation-conflict", "invalid-state"].includes(code)) return `${KEY}error.storage`;
    if (code === "record-pending") return `${KEY}error.record`;
    if (code === "comment-unclosed") return `${KEY}error.commentUnclosed`;
    if (code === "cover-ambiguous") return `${KEY}error.coverChoice`;
    if (["metadata-unavailable", "metadata-invalid", "provider_failure", "input_too_large", "invalid_result"].includes(code)) {
        return `${KEY}error.metadata`;
    }
    return `${KEY}error.generic`;
}
interface Runtime { client: GhostClient; service: GhostPublishingService; operations: GhostOperationStore; records: GhostCompletedRecordStore }
interface ActionScope { context: GhostActionContext; selection: GhostNoteSelection & { noteUid: string }; noteUid: string; postId?: string; release(): void }

/** One service per site serializes all cards targeting that site's note identities. */
export class GhostPublishingController {
    private readonly runtimes = new Map<string, Runtime>();
    private readonly sessions = new Set<PublishingSession>();
    private disposed = false;
    constructor(readonly options: GhostControllerOptions) {}

    async readContextReceipt(operationId: string): Promise<ReturnType<GhostPublishingSession['getContextReceipt']>> {
        if (this.disposed || !this.options.isDesktop() || !this.options.isCurrent()) return undefined;
        const connection = await this.options.configuration.connection();
        const operation = await this.runtime(connection).operations.findForContext(connection.siteId, operationId);
        if (this.disposed || !this.options.isCurrent() || connection.identity !== this.options.configuration.getIdentity()) return undefined;
        return operation ? { operationId: operation.operationId, revision: operation.revision,
            state: operation.state, verified: operation.verified?.status === 'published' } : undefined;
    }

    private runtime(connection: GhostConnection): Runtime {
        const existing = this.runtimes.get(connection.siteId);
        if (existing) return existing;
        const isDesktop = () => !this.disposed && this.options.isDesktop() && this.options.isCurrent();
        const client = new GhostClient({ siteUrl: connection.siteUrl, isDesktop, getAdminKey: async () => {
            const live = await this.options.configuration.connection();
            if (live.siteId !== connection.siteId) throw failure("connection-changed");
            return this.options.configuration.getAdminKey(live);
        } });
        const operations = new GhostOperationStore({ isDesktop, dbName: ghostDatabaseName({ pluginId: this.options.pluginId,
            vaultId: this.options.app.vault.getName(), configDir: getVaultConfigDir(this.options.app.vault), localPath: this.options.vaultPath }) });
        const records = new GhostCompletedRecordStore({ vaultPath: this.options.vaultPath, isDesktop });
        const service = new GhostPublishingService({ siteId: connection.siteId, site: connection.siteUrl, isDesktop, client, operations, records });
        const runtime = { client, service, operations, records };
        this.runtimes.set(connection.siteId, runtime);
        return runtime;
    }

    async createScope(connection: GhostConnection, runtime: Runtime, selection: GhostNoteSelection,
        authority: GhostActionAuthority, lifetime: AbortSignal, replaceAll = false): Promise<ActionScope> {
        const { app } = this.options;
        const abort = new AbortController();
        const cancel = () => abort.abort();
        const signals = [lifetime, authority?.signal].filter((signal): signal is AbortSignal => !!signal);
        signals.forEach((signal) => { if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true }); });
        const release = () => { signals.forEach((signal) => signal.removeEventListener("abort", cancel)); abort.abort(); };
        try {
            if (!this.options.isDesktop()) throw failure("desktop-required");
            if (!authority?.guard || typeof authority.sourceValidity !== "function") throw failure("source-revoked");
            if (connection.identity !== this.options.configuration.getIdentity()) throw failure("connection-changed");
            const isCurrent = () => !this.disposed && this.options.isCurrent() && !abort.signal.aborted && authority.guard.isCurrent();
            const guard: GhostPublishingSourceGuard = {
                isCurrent,
                isPathAllowed: (path, kind) => isCurrent() && this.options.isPathAllowed(path) && authority.guard.isPathAllowed(path, kind),
                isNoteDomainAllowed: () => authority.guard.isNoteDomainAllowed?.() !== false,
                isWebAllowed: () => authority.guard.isWebAllowed?.() === true,
                captureSourceValidity: () => () => isCurrent() && authority.sourceValidity(),
            };
            if (!isCurrent() || !authority.sourceValidity()) throw failure("source-revoked");
            // Only the explicitly resolved link's record is inspected. This stamp is a
            // final freshness fence; records.read still parses and verifies its checksum.
            // Obsidian's desktop renderer provides Node builtins through require rather than node: dynamic import.
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- Desktop-only record inspection after admission.
            const fs: typeof import("node:fs") = require("node:fs");
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- Desktop-only record inspection after admission.
            const path: typeof import("node:path") = require("node:path");
            const recordRevision = (siteId: string, noteUid: string): string => {
                if (!this.options.isDesktop() || !isCurrent() || !authority.sourceValidity()) throw failure("source-revoked");
                if (siteId !== connection.siteId) throw failure("site-mismatch");
                const relative = ghostRecordPath(siteId, noteUid);
                try {
                    let current = fs.realpathSync(this.options.vaultPath);
                    const parts = relative.split("/");
                    for (let index = 0; index < parts.length; index++) {
                        current = path.join(current, parts[index]);
                        const stat = fs.lstatSync(current, { bigint: true });
                        const last = index === parts.length - 1;
                        if (stat.isSymbolicLink() || (last ? !stat.isFile() : !stat.isDirectory())) throw failure("storage-unavailable");
                        if (last) return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
                    }
                } catch (error) {
                    if (errorCode(error) === "ENOENT") return "missing";
                    throw failure("storage-unavailable");
                }
                throw failure("storage-unavailable");
            };
            const host: GhostActionHost = {
                vault: {
                    getAbstractFileByPath: (path) => { const file = app.vault.getAbstractFileByPath(path); return file instanceof TFile ? file : null; },
                    getMarkdownFiles: () => app.vault.getMarkdownFiles(),
                    read: async (file) => {
                        const markdown = await app.vault.read(file as TFile);
                        if (!isCurrent() || !this.options.isContentAllowed(file.path, markdown)) throw failure("source-revoked");
                        return markdown;
                    },
                    readBinary: (file) => app.vault.readBinary(file as TFile),
                },
                metadataCache: { getFileCache: (file) => app.metadataCache.getFileCache(file as TFile),
                    getFirstLinkpathDest: (link, path) => app.metadataCache.getFirstLinkpathDest(link, path) },
                fileManager: { processFrontMatter: (file, change) => app.fileManager.processFrontMatter(file as TFile, change) },
                getFrontMatterInfo, parseYaml, resolveSubpath: (cache, subpath) => resolveSubpath(cache as CachedMetadata, subpath),
            };
            const created = await createGhostActionContext({ selection, host, client: runtime.client,
                isDesktop: () => this.options.isDesktop() && !this.disposed, guard, sourceValidity: () => isCurrent() && authority.sourceValidity(),
                siteId: connection.siteId, siteUrl: connection.siteUrl, getConnectionIdentity: () => this.options.configuration.getIdentity(),
                getProfile: () => connection.profile, getSourceRevision: (path) => this.options.getSourceRevision(path),
                isResourcePathAllowed: (resourcePath, ownerPath) => this.options.isPathAllowed(ownerPath)
                    && this.options.isPathAllowed(resourcePath),
                readCompletedRecord: (siteId, noteUid) => {
                    recordRevision(siteId, noteUid);
                    return runtime.records.read(siteId, noteUid);
                },
                getCompletedRecordRevision: recordRevision,
                defaultVisibility: connection.defaultVisibility, signal: abort.signal, replacement: replaceAll ? "replace-all" : "preserve-matching",
                generateMetadata: this.options.generateMetadata });
            return { ...created, release };
        } catch (error) { release(); throw error; }
    }

    async prepare(request: GhostControllerRequest): Promise<GhostControllerResult> {
        let session: PublishingSession | undefined;
        let scope: ActionScope | undefined;
        try {
            if (!this.options.isDesktop()) throw failure("desktop-required");
            if (this.disposed || !this.options.isCurrent()) throw failure("source-revoked");
            const connection = await this.options.configuration.connection();
            const runtime = this.runtime(connection);
            const lifetime = new AbortController();
            scope = await this.createScope(connection, runtime, { path: request.path }, request.authority, lifetime.signal);
            session = new PublishingSession(this, connection, runtime, scope.selection, request, lifetime, () => this.sessions.delete(session!));
            this.sessions.add(session);
            request.onSession(session);
            await session.initialize(scope);
            const state = session.getState();
            return { status: state.status === "outcome-unknown" ? "outcome_unknown"
                : state.errorKey || state.status === "needs-attention" ? "needs_attention" : "prepared", operationId: state.operationId };
        } catch (error) {
            if (session) session.report(error);
            else {
                const state: GhostCardState = { title: request.path.split("/").pop() ?? "", site: "", status: "needs-attention", busy: false, errorKey: errorKey(error), actions: [] };
                request.onSession({ getState: () => ({ ...state, actions: [] }), getContextReceipt: () => undefined,
                    subscribe: () => () => {}, run: async () => {}, dispose: () => {} });
            }
            return { status: "needs_attention", ...(session?.getState().operationId ? { operationId: session.getState().operationId } : {}) };
        } finally { scope?.release(); }
    }

    clearContextPersistence(conversationId: string): void {
        for (const runtime of this.runtimes.values()) runtime.operations.clearContextPersistence(conversationId);
    }

    dispose(): void {
        this.disposed = true;
        for (const session of [...this.sessions]) session.dispose();
        for (const runtime of this.runtimes.values()) { runtime.service.invalidate(); runtime.operations.close(); }
        this.runtimes.clear();
    }
}

class PublishingSession implements GhostPublishingSession {
    private readonly listeners = new Set<() => void>();
    private readonly preview: GhostNativePreviewAdapter;
    private operation?: GhostLocalOperation;
    private ticket?: { value: GhostConfirmationTicket; scope: ActionScope };
    private ticketTimer?: ReturnType<typeof setInterval>;
    private busy = true;
    private disposed = false;
    private resumeOnly = false;
    private error?: string;
    private replaceAllowed = false;
    private canRestore = false;
    constructor(private readonly controller: GhostPublishingController, private readonly connection: GhostConnection,
        private readonly runtime: Runtime, private selection: GhostNoteSelection & { noteUid: string },
        private readonly request: GhostControllerRequest, private readonly lifetime: AbortController, private readonly onDispose: () => void) {
        this.preview = new GhostNativePreviewAdapter(controller.options.app as unknown as GhostPreviewHost,
            { isDesktop: controller.options.isDesktop, isWebViewerEnabled: controller.options.isWebViewerEnabled });
    }
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    private emit(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
    private invalidate(preservePreview = false): void {
        if (this.ticketTimer !== undefined) clearInterval(this.ticketTimer);
        this.ticketTimer = undefined;
        this.ticket?.scope.release();
        this.ticket = undefined;
        this.runtime.service.invalidate(this.operation?.operationId);
        if (!preservePreview) this.preview.invalidate();
    }
    report(error: unknown): void {
        this.error = errorKey(error);
        this.replaceAllowed = errorCode(error) === "content-conflict";
        if (["result-unknown", "resource-result-unknown"].includes(errorCode(error))) this.error = undefined;
        this.emit();
    }
    async initialize(scope: ActionScope): Promise<void> {
        try {
            const locals = await this.runtime.operations.list(this.connection.siteId, this.selection.noteUid);
            scope.context.gate.assertCurrent();
            const record = await this.runtime.records.read(this.connection.siteId, this.selection.noteUid);
            scope.context.gate.assertCurrent();
            this.canRestore = !!record?.lastUndo;
            const active = locals.filter(isGhostPublicationActive);
            if (active.length > 1) throw failure("operation-conflict");
            if (active.length) { this.operation = active[0]; this.resumeOnly = true; }
            else {
                this.operation = await this.runtime.service.prepare(this.selection.noteUid, scope.postId, scope.context, this.request.intent === "restore");
                const connection = await this.controller.options.configuration.connection();
                if (connection.siteId !== this.connection.siteId) throw failure("connection-changed");
                const previewScope = await this.controller.createScope(connection, this.runtime, this.selection,
                    this.request.createActionAuthority(), this.lifetime.signal);
                try {
                    // The automatic check remains inside this request's original scope,
                    // while its resulting ticket uses a current, lasting Host authority.
                    await scope.context.validate(this.operation);
                    await previewScope.context.validate(this.operation);
                    const gate = previewScope.context.gate;
                    const original = { beforeSend: gate.beforeSend, assertCurrent: gate.assertCurrent };
                    gate.assertCurrent = () => { original.assertCurrent(); scope.context.gate.assertCurrent(); };
                    gate.beforeSend = async () => { await original.beforeSend(); await scope.context.gate.beforeSend(); gate.assertCurrent(); };
                    try { await this.checkPreview(previewScope); }
                    finally { gate.beforeSend = original.beforeSend; gate.assertCurrent = original.assertCurrent; }
                } finally { if (this.ticket?.scope !== previewScope) previewScope.release(); }
            }
        } catch (error) { this.invalidate(true); await this.reload(); this.report(error); }
        finally { this.busy = false; this.emit(); }
    }
    private async reload(): Promise<void> {
        try {
            const locals = await this.runtime.operations.list(this.connection.siteId, this.selection.noteUid);
            this.operation = locals.find((item) => item.operationId === this.operation?.operationId)
                ?? locals.find(isGhostPublicationActive) ?? this.operation;
        } catch { /* Preserve the last known operation; never guess a successful write. */ }
    }
    getState(): GhostCardState {
        const operation = this.operation;
        const diagnostics = this.preview.getDiagnostics();
        let status: GhostCardState["status"] = this.busy ? "preparing" : "prepared";
        if (operation?.state === "pending" || operation?.state === "outcome_unknown") status = "outcome-unknown";
        else if (operation?.state === "cleanup_pending" && operation.verified) status = "cleanup-pending";
        else if (operation?.state === "terminal" && operation.verified) {
            status = operation.kind === "restore" ? "completed-restore" : "completed";
        }
        else if (this.error) status = "needs-attention";
        else if (!this.busy && !this.resumeOnly && operation?.target.previewId && diagnostics.status !== "passed") status = "needs-attention";
        else if (this.ticket && operation?.target.postStatus === "published" && diagnostics.status === "passed") {
            status = operation?.kind === "restore" ? "checked-restore" : "checked";
        }
        else if (operation && diagnostics.status === "passed" && (operation.kind === "create" || operation.target.postStatus === "draft")) status = "awaiting-publish";
        const actions: GhostCardAction[] = [];
        if (this.resumeOnly) {
            actions.push("continue");
            if (operation && ["prepared", "ready"].includes(operation.state)) actions.push("reprepare");
        } else if (status === "outcome-unknown") actions.push("continue");
        else if (status === "completed" || status === "completed-restore" || status === "cleanup-pending") {
            if (status === "cleanup-pending") actions.push("continue");
            if (status !== "completed-restore" && (this.canRestore || operation?.completedRecord?.lastUndo)) actions.push("restore");
        } else {
            if (operation?.state === "succeeded_remote_pending_record") actions.push("continue");
            else {
                actions.push("reprepare");
                if (operation?.kind !== "restore") actions.push("regenerate-metadata");
                if (operation?.kind !== "restore" && operation?.target.postId && operation.target.postStatus === "draft") {
                    actions.push("change-draft-url");
                }
                if (operation?.target.previewId) {
                    actions.push("check-preview");
                    if ((operation.kind === "create" || operation.target.postStatus === "draft") && diagnostics.status === "passed") actions.push("check-published");
                    else if (this.ticket && diagnostics.status === "passed") actions.push("confirm");
                }
                if (this.replaceAllowed) actions.push("replace-all");
            }
        }
        if (!this.resumeOnly && operation?.target.postId) actions.push("open-editor");
        if (!this.resumeOnly && operation?.target.previewId && !operation.verified) actions.push("open-browser");
        return { title: this.selection.path.split("/").pop()?.replace(/\.md$/i, "") ?? "", site: this.connection.siteUrl,
            operationId: operation?.operationId, status, busy: this.busy, errorKey: this.error,
            previewStatus: diagnostics.status,
            previewReasonKey: diagnostics.status === "failed" ? `${KEY}preview.failed` : diagnostics.status === "unavailable"
                ? `${KEY}preview.${diagnostics.reason === "enable-web-viewer" ? "enable-web-viewer" : "unavailable"}` : undefined,
            warningKeys: [...new Set(operation?.candidate.warnings?.map((warning) => warning.code).filter((code) => WARNING_CODES.has(code)) ?? [])]
                .map((code) => `${KEY}warning.${code}`),
            visibilityChange: operation?.visibilityChange, actions: this.disposed ? [] : actions,
            operationKind: operation?.kind };
    }
    getContextReceipt(): { operationId: string; revision: number; state: GhostLocalOperation['state']; verified: boolean } | undefined {
        const operation = this.operation;
        return operation ? { operationId: operation.operationId, revision: operation.revision,
            state: operation.state, verified: operation.verified?.status === 'published' } : undefined;
    }
    registerContextPersistence(persist: (receipt: NonNullable<ReturnType<GhostPublishingSession['getContextReceipt']>>) => Promise<boolean>, conversationId: string): void {
        if (!this.operation) return;
        this.runtime.operations.registerContextPersistence(this.operation.operationId, operation => {
            return persist({ operationId: operation.operationId, revision: operation.revision, state: operation.state,
                verified: operation.verified?.status === 'published' });
        }, conversationId);
    }
    unregisterContextPersistence(): void {
        if (this.operation) this.runtime.operations.unregisterContextPersistence(this.operation.operationId);
    }
    private async checkPreview(scope: ActionScope): Promise<void> {
        if (!this.operation?.target.previewId) throw failure("preview-required");
        const value = await this.runtime.service.checkPreview(this.selection.noteUid, this.operation.operationId, scope.context, async (operation, candidateHash) => {
            const post = await this.runtime.client.readPost(operation.target.previewId!, scope.context.gate);
            const url = ghostPreviewUrl(this.connection.siteUrl, post.uuid);
            return this.preview.check({ url, candidateHash, expectations: ghostPreviewExpectations(operation.candidate),
                isCandidateCurrent: () => { try { scope.context.gate.assertCurrent(); return !this.disposed; } catch { return false; } } }, scope.context.gate);
        });
        this.ticket = { value, scope };
        await this.reload();
        this.ticketTimer = setInterval(() => {
            try { this.ticket?.scope.context.gate.assertCurrent(); if (this.preview.getDiagnostics().status === "passed") return; }
            catch { /* Source/configuration changed; a new check is required. */ }
            this.invalidate(); this.error = `${KEY}error.confirmation`; this.emit();
        }, 1000);
    }
    async run(action: GhostCardAction, confirmation: { visibilityConfirmed?: boolean; replacementConfirmed?: boolean } = {}): Promise<void> {
        if (this.busy || this.disposed || !this.getState().actions.includes(action)) return;
        if (action === "replace-all" && !confirmation.replacementConfirmed) return;
        this.busy = true;
        this.error = undefined;
        this.emit();
        let scope: ActionScope | undefined;
        try {
            const connection = await this.controller.options.configuration.connection();
            if (connection.siteId !== this.connection.siteId) throw failure("connection-changed");
            scope = await this.controller.createScope(connection, this.runtime, this.selection, this.request.createActionAuthority(), this.lifetime.signal, action === "replace-all");
            this.selection = scope.selection;
            if (action === "confirm") {
                const ticket = this.ticket;
                if (!ticket || !this.operation) throw failure("confirmation-required");
                await scope.context.validate(this.operation);
                ticket.scope.context.gate.assertCurrent();
                const oldGate = ticket.scope.context.gate;
                const freshGate = scope.context.gate;
                // Keep the exact ticket context identity while intersecting its authority
                // with the latest Host scope at every physical request boundary.
                ticket.scope.context.gate = { signal: oldGate.signal, assertCurrent: () => { oldGate.assertCurrent(); freshGate.assertCurrent(); },
                    beforeSend: async () => { await oldGate.beforeSend(); await freshGate.beforeSend(); oldGate.assertCurrent(); freshGate.assertCurrent(); } };
                this.operation = await this.runtime.service.confirm(this.selection.noteUid, ticket.value, ticket.scope.context, confirmation.visibilityConfirmed);
                this.invalidate();
            } else {
                if (action !== "open-editor" && action !== "open-browser") this.invalidate();
                this.resumeOnly = false;
                if (action === "reprepare" || action === "replace-all") {
                    this.operation = this.operation && isGhostPublicationActive(this.operation)
                        ? await this.runtime.service.reprepare(this.selection.noteUid, this.operation.operationId, scope.context)
                        : await this.runtime.service.prepare(this.selection.noteUid, scope.postId, scope.context, this.request.intent === "restore");
                    await this.checkPreview(scope);
                } else if (action === "regenerate-metadata") {
                    if (!this.operation) throw failure("operation-missing");
                    this.operation = await this.runtime.service.reprepare(
                        this.selection.noteUid,
                        this.operation.operationId,
                        scope.context,
                        { regenerateMetadata: true },
                    );
                    await this.checkPreview(scope);
                } else if (action === "change-draft-url") {
                    if (!this.operation) throw failure("operation-missing");
                    this.operation = await this.runtime.service.changeDraftUrl(
                        this.selection.noteUid,
                        this.operation.operationId,
                        scope.context,
                    );
                    await this.checkPreview(scope);
                } else if (action === "restore") {
                    this.operation = await this.runtime.service.prepare(this.selection.noteUid, scope.postId, scope.context, true);
                    await this.checkPreview(scope);
                } else if (action === "continue" || action === "check-published") {
                    if (!this.operation) throw failure("operation-missing");
                    this.operation = await this.runtime.service.refresh(this.selection.noteUid, this.operation.operationId, scope.context);
                } else if (action === "check-preview") {
                    await this.checkPreview(scope);
                } else {
                    if (!this.operation) throw failure("operation-missing");
                    await scope.context.validate(this.operation, "reconcile");
                    let url: string;
                    if (action === "open-editor") {
                        const id = this.operation.verified ? this.operation.target.postId
                            : this.operation.target.previewId ?? this.operation.target.postId;
                        if (!id || !/^[a-f\d]{24}$/i.test(id)) throw failure("operation-missing");
                        url = new URL(`ghost/#/editor/post/${id}`, connection.siteUrl).href;
                    } else {
                        if (!this.operation.target.previewId) throw failure("preview-required");
                        const post = await this.runtime.client.readPost(this.operation.target.previewId, scope.context.gate);
                        url = this.preview.systemBrowserUrl(ghostPreviewUrl(connection.siteUrl, post.uuid));
                    }
                    scope.context.gate.assertCurrent();
                    await this.controller.options.openExternal(url);
                    scope.context.gate.assertCurrent();
                }
            }
        } catch (error) { this.invalidate(true); await this.reload(); this.report(error); }
        finally { if (this.ticket?.scope !== scope) scope?.release(); this.busy = false; this.emit(); }
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.lifetime.abort();
        this.invalidate();
        this.preview.dispose();
        this.listeners.clear();
        this.onDispose();
    }
}

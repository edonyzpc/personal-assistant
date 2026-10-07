import { getFrontMatterInfo, parseYaml, resolveSubpath, TFile, type App, type CachedMetadata } from "obsidian";
import { getVaultConfigDir } from "../obsidian-paths";
import { createGhostActionContext, type GhostActionContextOptions, type GhostActionHost } from "./action-context";
import { GhostClient } from "./client";
import { GhostPublishingConfiguration, type GhostConnection } from "./configuration";
import { GhostTabPreview, ghostPreviewUrl } from "./preview";
import { GhostPublishingService, type GhostActionContext } from "./service";
import { GhostPreviewStore, ghostDatabaseName } from "./state-store";
import type { GhostLocalOperation } from "./state-schema";
import type { GhostNoteSelection } from "./binding";
import type { GhostPublishingSourceGuard } from "./types";
import { ghostMetadataFailureReason, type GhostMetadataFailureReason } from "../ai-services/ghost-tool-receipt";

export interface GhostActionAuthority { guard: GhostPublishingSourceGuard; sourceValidity(): boolean; signal?: AbortSignal }
export type GhostCardAction = "confirm" | "open-editor" | "open-preview" | "open-post";
export interface GhostCardState {
    title: string;
    site: string;
    operationId?: string;
    status: "preparing" | "prepared" | "draft_saved" | "updating" | "updated" | "needs-attention" | "outcome-unknown";
    busy: boolean;
    errorKey?: string;
    warningKeys?: string[];
    actions: GhostCardAction[];
}
export interface GhostContextReceipt {
    operationId: string;
    revision: number;
    state: GhostLocalOperation["state"];
    verified: boolean;
}
export interface GhostPublishingSession {
    getState(): GhostCardState;
    getContextReceipt(): GhostContextReceipt | undefined;
    registerContextPersistence?(persist: (receipt: GhostContextReceipt) => Promise<boolean>, conversationId: string): void;
    unregisterContextPersistence?(): void;
    subscribe(listener: () => void): () => void;
    run(action: GhostCardAction): Promise<void>;
    dispose(): void;
}
export interface GhostControllerOptions {
    app: App;
    configuration: GhostPublishingConfiguration;
    vaultPath: string;
    pluginId: string;
    isDesktop(this: void): boolean;
    isCurrent(): boolean;
    isWebViewerEnabled(this: void): boolean;
    getSourceRevision(path: string): string | number;
    isPathAllowed(path: string): boolean;
    isContentAllowed(path: string, markdown: string): boolean;
    generateMetadata?: GhostActionContextOptions["generateMetadata"];
}
export interface GhostControllerRequest {
    path: string;
    intent: "prepare";
    authority: GhostActionAuthority;
    createActionAuthority(): GhostActionAuthority;
    onSession(session: GhostPublishingSession): void;
}
export interface GhostControllerResult {
    status: "prepared" | "needs_attention" | "outcome_unknown";
    operationId?: string;
    executionState: "not_started" | "succeeded" | "failed" | "acceptance_unknown";
    failureReason?: GhostMetadataFailureReason;
}

const KEY = "plugin.ghost.card.";
const WARNING_CODES = new Set(["unresolved-wiki-link", "unpublished-wiki-link", "ambiguous-wiki-link", "wiki-link-anchor-fallback",
    "unknown-highlight-language", "profile-page-check-required"]);
function failure(code: string): Error & { code: string } { return Object.assign(new Error("Ghost publishing action could not finish."), { code }); }
function errorCode(error: unknown): string {
    return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";
}
function errorKey(code: string): string {
    if (["desktop-required", "unsupported-platform"].includes(code)) return `${KEY}error.platform`;
    if (["not-configured", "invalid-key", "invalid-credentials", "invalid-settings", "http-401", "http-403"].includes(code)) return `${KEY}error.configuration`;
    if (["network", "timeout"].includes(code)) return `${KEY}error.network`;
    if (["invalid-response", "response-too-large", "redirect"].includes(code)) return `${KEY}error.response`;
    if (code === "http" || code.startsWith("http-")) return `${KEY}error.request`;
    if (["invalid-binding", "identity-mismatch", "invalid-selection"].includes(code)) return `${KEY}error.binding`;
    if (["connection-changed", "connection_changed", "changing", "site-mismatch"].includes(code)) return `${KEY}error.connection`;
    if (["guard-revoked", "source-revoked", "source-changed", "source_changed", "context-revoked", "gate-rejected", "cancelled", "web-denied"].includes(code)) return `${KEY}error.source`;
    if (["content-conflict", "remote-conflict", "post-mismatch", "preview-changed", "target-changed", "conflict"].includes(code)) return `${KEY}error.conflict`;
    if (["resource-changed", "resource-unavailable", "unsupported-image", "resource-too-large", "read-failed"].includes(code)) return `${KEY}error.resource`;
    if (["confirmation-required", "preview-required", "operation-missing"].includes(code)) return `${KEY}error.confirmation`;
    if (["storage-unavailable", "invalid-state"].includes(code)) return `${KEY}error.storage`;
    if (code === "comment-unclosed") return `${KEY}error.commentUnclosed`;
    if (code === "cover-ambiguous") return `${KEY}error.coverChoice`;
    if (code === "enable-web-viewer") return `${KEY}error.webViewer`;
    if (code === "provider_failure") return `${KEY}error.metadataProvider`;
    if (code === "input_too_large") return `${KEY}error.metadataInput`;
    if (code === "invalid_result" || code === "metadata-invalid") return `${KEY}error.metadataInvalid`;
    if (code === "metadata-unavailable") return `${KEY}error.metadata`;
    return `${KEY}error.generic`;
}
interface Runtime { client: GhostClient; service: GhostPublishingService; previews: GhostPreviewStore }
interface ActionScope { context: GhostActionContext; selection: GhostNoteSelection; noteKey: string; postId?: string; release(): void }
function receipt(operation: GhostLocalOperation): GhostContextReceipt {
    return { operationId: operation.operationId, revision: operation.revision, state: operation.state, verified: Boolean(operation.verified) };
}

/** Owns live sessions and one resource-pointer store per configured site. */
export class GhostPublishingController {
    private readonly runtimes = new Map<string, Runtime>();
    private readonly sessions = new Set<PublishingSession>();
    private disposed = false;
    constructor(readonly options: GhostControllerOptions) {}

    async readContextReceipt(operationId: string): Promise<GhostContextReceipt | undefined> {
        if (this.disposed) return undefined;
        for (const runtime of this.runtimes.values()) {
            const operation = runtime.service.get(operationId);
            if (operation) return receipt(operation);
        }
        return undefined;
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
        const previews = new GhostPreviewStore({ isDesktop, dbName: ghostDatabaseName({ pluginId: this.options.pluginId,
            vaultId: this.options.app.vault.getName(), configDir: getVaultConfigDir(this.options.app.vault), localPath: this.options.vaultPath }) });
        const service = new GhostPublishingService({ siteId: connection.siteId, site: connection.siteUrl, isDesktop, client, previews,
            onUpdate: operation => { for (const session of this.sessions) session.observe(connection.siteId, operation); } });
        const runtime = { client, service, previews };
        this.runtimes.set(connection.siteId, runtime);
        return runtime;
    }

    async createScope(connection: GhostConnection, runtime: Runtime, selection: GhostNoteSelection,
        authority: GhostActionAuthority, lifetime: AbortSignal): Promise<ActionScope> {
        const { app } = this.options;
        const abort = new AbortController();
        const cancel = () => abort.abort();
        const signals = [lifetime, authority.signal].filter((signal): signal is AbortSignal => !!signal);
        signals.forEach(signal => { if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true }); });
        const release = () => { signals.forEach(signal => signal.removeEventListener("abort", cancel)); abort.abort(); };
        try {
            if (!this.options.isDesktop()) throw failure("desktop-required");
            if (!authority.guard || typeof authority.sourceValidity !== "function") throw failure("source-revoked");
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
            const host: GhostActionHost = {
                vault: {
                    getAbstractFileByPath: path => { const file = app.vault.getAbstractFileByPath(path); return file instanceof TFile ? file : null; },
                    getMarkdownFiles: () => app.vault.getMarkdownFiles(),
                    read: async file => {
                        const markdown = await app.vault.read(file as TFile);
                        if (!isCurrent() || !this.options.isContentAllowed(file.path, markdown)) throw failure("source-revoked");
                        return markdown;
                    },
                    readBinary: file => app.vault.readBinary(file as TFile),
                },
                metadataCache: { getFileCache: file => app.metadataCache.getFileCache(file as TFile),
                    getFirstLinkpathDest: (link, path) => app.metadataCache.getFirstLinkpathDest(link, path) },
                fileManager: { processFrontMatter: (file, change) => app.fileManager.processFrontMatter(file as TFile, change) },
                getFrontMatterInfo, parseYaml, resolveSubpath: (cache, subpath) => resolveSubpath(cache as CachedMetadata, subpath),
            };
            const created = await createGhostActionContext({ selection, host, client: runtime.client,
                isDesktop: () => this.options.isDesktop() && !this.disposed, guard, sourceValidity: () => isCurrent() && authority.sourceValidity(),
                siteId: connection.siteId, siteUrl: connection.siteUrl, getConnectionIdentity: () => this.options.configuration.getIdentity(),
                getProfile: () => connection.profile, getSourceRevision: path => this.options.getSourceRevision(path),
                isResourcePathAllowed: (resourcePath, ownerPath) => this.options.isPathAllowed(ownerPath) && this.options.isPathAllowed(resourcePath),
                defaultVisibility: connection.defaultVisibility, signal: abort.signal, generateMetadata: this.options.generateMetadata });
            return { ...created, release };
        } catch (error) { release(); throw error; }
    }

    async prepare(request: GhostControllerRequest): Promise<GhostControllerResult> {
        let scope: ActionScope | undefined;
        let session: PublishingSession | undefined;
        try {
            if (!this.options.isDesktop()) throw failure("desktop-required");
            if (this.disposed || !this.options.isCurrent()) throw failure("source-revoked");
            const connection = await this.options.configuration.connection();
            const runtime = this.runtime(connection);
            const lifetime = new AbortController();
            scope = await this.createScope(connection, runtime, { path: request.path }, request.authority, lifetime.signal);
            session = new PublishingSession(this, connection, runtime, scope, request, lifetime, () => this.sessions.delete(session!));
            this.sessions.add(session);
            request.onSession(session);
            await session.initialize(scope);
            return session.result();
        } catch (error) {
            if (session) { session.report(error); return session.result(); }
            const state: GhostCardState = { title: request.path.split("/").pop() ?? "", site: "", status: "needs-attention",
                busy: false, errorKey: errorKey(errorCode(error)), actions: [] };
            request.onSession({ getState: () => ({ ...state, actions: [] }), getContextReceipt: () => undefined,
                subscribe: () => () => {}, run: async () => {}, dispose: () => {} });
            const failureReason = ghostMetadataFailureReason(errorCode(error));
            return { status: "needs_attention", executionState: "not_started", ...(failureReason ? { failureReason } : {}) };
        } finally { scope?.release(); }
    }

    clearContextPersistence(conversationId: string): void {
        for (const session of this.sessions) session.clearContextPersistence(conversationId);
    }
    dispose(): void {
        this.disposed = true;
        for (const session of [...this.sessions]) session.dispose();
        for (const runtime of this.runtimes.values()) { runtime.service.close(); runtime.previews.close(); }
        this.runtimes.clear();
    }
}

class PublishingSession implements GhostPublishingSession {
    private readonly listeners = new Set<() => void>();
    private readonly preview: GhostTabPreview;
    private operation?: GhostLocalOperation;
    private busy = true;
    private confirming = false;
    private disposed = false;
    private error?: string;
    private errorCode?: string;
    private noteKey: string;
    private selection: GhostNoteSelection;
    private contextPersistence?: { conversationId: string; persist: (receipt: GhostContextReceipt) => Promise<boolean> };

    constructor(private readonly controller: GhostPublishingController, private readonly connection: GhostConnection,
        private readonly runtime: Runtime, scope: ActionScope, private readonly request: GhostControllerRequest,
        private readonly lifetime: AbortController, private readonly onDispose: () => void) {
        this.noteKey = scope.noteKey;
        this.selection = scope.selection;
        this.preview = new GhostTabPreview(controller.options.app,
            { isDesktop: controller.options.isDesktop, isWebViewerEnabled: controller.options.isWebViewerEnabled });
    }
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    private emit(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
    observe(siteId: string, operation: GhostLocalOperation): void {
        if (this.disposed || siteId !== this.connection.siteId || operation.noteKey !== this.noteKey
            || operation.operationId !== this.operation?.operationId) return;
        this.operation = operation;
        this.emit();
        if (this.contextPersistence) {
            void this.contextPersistence.persist(receipt(operation)).catch(() => {
                console.warn("Ghost result history could not be updated.");
            });
        }
    }
    report(error: unknown): void { this.errorCode = errorCode(error); this.error = errorKey(this.errorCode); this.emit(); }
    async initialize(scope: ActionScope): Promise<void> {
        try { this.operation = await this.runtime.service.prepare(scope.noteKey, scope.postId, scope.context); }
        catch (error) { this.report(error); }
        finally { this.busy = false; this.emit(); }
    }
    result(): GhostControllerResult {
        const operation = this.operation;
        const executionState = operation?.executionState ?? "not_started";
        const failureReason = executionState === "not_started"
            ? ghostMetadataFailureReason(this.errorCode ?? operation?.error) : undefined;
        return { status: operation?.state === "outcome_unknown" ? "outcome_unknown"
            : this.error || operation?.state === "failed" || operation?.warnings?.length ? "needs_attention" : "prepared",
            ...(operation ? { operationId: operation.operationId } : {}), executionState,
            ...(failureReason ? { failureReason } : {}) };
    }
    getState(): GhostCardState {
        const operation = this.operation;
        let status: GhostCardState["status"] = "preparing";
        if (this.busy && !operation) status = "preparing";
        else if (this.busy && this.confirming) status = "updating";
        else if (operation?.state === "draft_saved") status = "draft_saved";
        else if (operation?.state === "updated") status = "updated";
        else if (operation?.state === "prepared") status = "prepared";
        else if (operation?.state === "outcome_unknown") status = "outcome-unknown";
        else status = "needs-attention";
        const actions: GhostCardAction[] = [];
        if (operation?.state === "updated" && operation.target.postUrl) actions.push("open-post");
        if (operation?.target.previewUuid && (operation.state !== "updated" || operation.warnings?.includes("cleanup-failed"))) actions.push("open-preview");
        if (operation?.state === "prepared") actions.push("confirm");
        if (operation?.target.postId && operation.state !== "prepared") actions.push("open-editor");
        const warningKeys = [...new Set(operation?.candidate?.warnings?.map(warning => warning.code).filter(code => WARNING_CODES.has(code)) ?? [])]
            .map(code => `${KEY}warning.${code}`);
        for (const warning of operation?.warnings ?? []) warningKeys.push(`${KEY}warning.${warning}`);
        return { title: this.selection.path.split("/").pop()?.replace(/\.md$/i, "") ?? "", site: this.connection.siteUrl,
            operationId: operation?.operationId, status, busy: this.busy,
            errorKey: this.error ?? (operation?.error ? errorKey(operation.error) : undefined), warningKeys,
            actions: this.disposed ? [] : actions };
    }
    getContextReceipt(): GhostContextReceipt | undefined { return this.operation ? receipt(this.operation) : undefined; }
    registerContextPersistence(persist: (value: GhostContextReceipt) => Promise<boolean>, conversationId: string): void {
        this.contextPersistence = { persist, conversationId };
    }
    unregisterContextPersistence(): void { this.contextPersistence = undefined; }
    clearContextPersistence(conversationId: string): void {
        if (this.contextPersistence?.conversationId === conversationId) this.contextPersistence = undefined;
    }
    async run(action: GhostCardAction): Promise<void> {
        if (this.busy || this.disposed || !this.getState().actions.includes(action)) return;
        this.busy = true;
        this.confirming = action === "confirm";
        this.error = undefined;
        this.errorCode = undefined;
        this.emit();
        let scope: ActionScope | undefined;
        try {
            const connection = await this.controller.options.configuration.connection();
            if (connection.siteId !== this.connection.siteId) throw failure("connection-changed");
            if (action === "confirm" && connection.identity !== this.connection.identity) throw failure("connection-changed");
            scope = await this.controller.createScope(connection, this.runtime, this.selection, this.request.createActionAuthority(), this.lifetime.signal);
            this.selection = scope.selection;
            this.noteKey = scope.noteKey;
            if (action === "confirm") {
                if (!this.operation) throw failure("confirmation-required");
                this.operation = await this.runtime.service.confirm(scope.noteKey, this.operation.operationId, scope.context);
            } else {
                if (!this.operation) throw failure("operation-missing");
                await scope.context.validate(this.operation);
                let url: string;
                if (action === "open-preview") {
                    if (!this.operation.target.previewUuid) throw failure("preview-required");
                    url = ghostPreviewUrl(connection.siteUrl, this.operation.target.previewUuid);
                } else if (action === "open-editor") {
                    const id = this.operation.target.postId;
                    if (!id || !/^[a-f\d]{24}$/i.test(id)) throw failure("operation-missing");
                    url = new URL(`ghost/#/editor/post/${id}`, connection.siteUrl).href;
                } else {
                    const postUrl = this.operation.target.postUrl;
                    if (!postUrl) throw failure("operation-missing");
                    url = postUrl;
                }
                scope.context.gate.assertCurrent();
                try { await this.preview.open(url); }
                catch (error) { this.error = errorCode(error) === "enable-web-viewer" ? errorKey("enable-web-viewer") : `${KEY}error.open`; }
            }
        } catch (error) { this.report(error); }
        finally {
            scope?.release();
            this.confirming = false;
            this.busy = false;
            this.emit();
        }
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.lifetime.abort();
        if (this.operation) this.runtime.service.invalidate(this.operation.operationId);
        this.preview.dispose();
        this.listeners.clear();
        this.contextPersistence = undefined;
        this.onDispose();
    }
}

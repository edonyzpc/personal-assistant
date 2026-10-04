import { Platform, TFile, type App, type EventRef } from "obsidian";
import type { GhostHostBinding } from "../ai-services/chat-tool-types";
import type { RunSourceSelection } from "../ai-services/chat-source-scope";
import { TaskSourceConstraintState } from "../ai-services/task-source-constraint";
import { getVaultConfigDir } from "../obsidian-paths";
import { GhostPublishingConfiguration, type GhostPublishingSettings } from "./configuration";
import { GhostPublishingController, type GhostActionAuthority, type GhostControllerOptions, type GhostPublishingSession } from "./controller";
import { GhostEntryError, parseGhostCommand, resolveGhostRequestedNote } from "./entry";
import { GhostHostAdmissionError } from "./types";

export interface GhostChatBindingRequest {
    conversationId: string;
    stableMessageId: string;
    userText: string;
    capturedPath: string;
    isCurrent(): boolean;
    getSourceSelection(): Pick<RunSourceSelection, "scope" | "selectionId">;
    onSession(session: GhostPublishingSession): void;
}

/** Obsidian-specific lifetime and fresh action admission; no model-controlled credentials or target IDs. */
export class GhostPublishingIntegration {
    readonly configuration: GhostPublishingConfiguration;
    private readonly controller: GhostPublishingController;
    private readonly events: EventRef[] = [];
    private readonly revisions = new Map<string, number>();
    private revision = 0;
    private disposed = false;

    constructor(private readonly dependencies: {
        app: App;
        pluginId: string;
        vaultPath: string;
        getSettings(): GhostPublishingSettings;
        saveSettings(settings: GhostPublishingSettings): Promise<void>;
        isCurrent(): boolean;
        isPathAllowed(path: string): boolean;
    isContentAllowed(path: string, markdown: string): boolean;
    isWebAllowed(): boolean;
    generateMetadata?: GhostControllerOptions["generateMetadata"];
    }) {
        const { app, vaultPath, pluginId } = dependencies;
        const isDesktop = () => Platform.isDesktop && !Platform.isMobile && !this.disposed && dependencies.isCurrent();
        const openExternal = async (url: string) => {
            if (!isDesktop()) throw new Error("Ghost publishing desktop is unavailable.");
            // Obsidian's renderer captures window.open for its Web viewer. Electron's
            // shell API is the explicit system-browser/editor path on desktop.
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- Never loaded by mobile.
            const electron: { shell?: { openExternal?: (target: string) => void | Promise<void> } } = require("electron");
            const shell = electron.shell;
            if (typeof shell?.openExternal !== "function") throw new Error("Ghost publishing external opener is unavailable.");
            await shell.openExternal(url);
        };
        this.configuration = new GhostPublishingConfiguration({
            isDesktop, localScope: `${vaultPath}\n${getVaultConfigDir(app.vault)}`,
            getSettings: dependencies.getSettings, saveSettings: dependencies.saveSettings,
            secrets: {
                getSecret: id => app.secretStorage.getSecret(id),
                setSecret: (id, value) => app.secretStorage.setSecret(id, value),
            },
        });
        this.controller = new GhostPublishingController({
            app, configuration: this.configuration, vaultPath, pluginId, isDesktop,
            getSourceRevision: path => this.revisions.get(path) ?? 0,
            isPathAllowed: dependencies.isPathAllowed,
            isContentAllowed: dependencies.isContentAllowed,
            openExternal,
            isCurrent: () => !this.disposed && dependencies.isCurrent(),
            generateMetadata: dependencies.generateMetadata,
            isWebViewerEnabled: () => {
                const internal = app as unknown as { internalPlugins?: {
                    getPluginById?(id: string): { enabled?: boolean } | undefined;
                    plugins?: Record<string, { enabled?: boolean }>;
                } };
                const viewer = internal.internalPlugins?.getPluginById?.("webviewer")
                    ?? internal.internalPlugins?.plugins?.webviewer;
                return viewer?.enabled === true;
            },
        });
        const changed = (file: { path: string }, oldPath?: string) => {
            this.revisions.set(file.path, ++this.revision);
            if (oldPath) this.revisions.set(oldPath, this.revision);
        };
        this.events.push(app.vault.on("create", changed), app.vault.on("modify", changed),
            app.vault.on("delete", changed), app.vault.on("rename", changed));
    }

    createBinding(request: GhostChatBindingRequest): GhostHostBinding | undefined {
        if (!Platform.isDesktop || Platform.isMobile || this.disposed || !request.isCurrent()
            || parseGhostCommand(request.userText) === null) return undefined;
        const current = () => !this.disposed && this.dependencies.isCurrent() && request.isCurrent();
        const createActionAuthority = (): GhostActionAuthority => {
            const selection = { ...request.getSourceSelection() };
            const selectionCurrent = () => current()
                && request.getSourceSelection().scope === selection.scope
                && request.getSourceSelection().selectionId === selection.selectionId;
            const state = new TaskSourceConstraintState({
                runId: `ghost-action-${request.stableMessageId}-${globalThis.crypto.randomUUID()}`,
                userMessageId: request.stableMessageId, userText: request.userText,
                noteHandles: new Map(), sourceScope: selection.scope,
            });
            const guard = state.createReadGuard(state.snapshot(), path => {
                const file = this.dependencies.app.vault.getAbstractFileByPath(path);
                return file instanceof TFile && this.dependencies.isPathAllowed(path) ? path : undefined;
            }, selectionCurrent, undefined, undefined,
            this.dependencies.isWebAllowed, () => false, selectionCurrent);
            return { guard, sourceValidity: selectionCurrent };
        };
        return {
            conversationId: request.conversationId, stableMessageId: request.stableMessageId,
            submit: async (input, guard, sourceValidity, signal) => {
                let path: string;
                try {
                    if (!current() || !guard.isCurrent() || !sourceValidity()) {
                        throw new GhostHostAdmissionError("stale", {
                            executionState: "not_started",
                            recovery: { code: "ghost_request_stale", allowedActions: ["none"] },
                        });
                    }
                    const { app } = this.dependencies;
                    path = resolveGhostRequestedNote({ input, userText: request.userText, capturedPath: request.capturedPath,
                        host: {
                            getAbstractFileByPath: value => {
                                const file = app.vault.getAbstractFileByPath(value);
                                return file instanceof TFile ? file : null;
                            },
                            getMarkdownFiles: () => app.vault.getMarkdownFiles(),
                            getFirstLinkpathDest: (value, source) => app.metadataCache.getFirstLinkpathDest(value, source),
                        },
                    });
                } catch (error) {
                    if (error instanceof GhostEntryError) {
                        throw new GhostHostAdmissionError("target", {
                            executionState: "not_started",
                            recovery: { code: `ghost_${error.code.replace(/-/g, "_")}`, allowedActions: ["correct_input"] },
                        });
                    }
                    if (error instanceof GhostHostAdmissionError) throw error;
                    throw new GhostHostAdmissionError("stale", {
                        executionState: "not_started",
                        recovery: { code: "ghost_request_stale", allowedActions: ["none"] },
                    });
                }
                if (!guard.isPathAllowed(path, "task_material") || !this.dependencies.isPathAllowed(path)) {
                    throw new GhostHostAdmissionError("source", {
                        executionState: "not_started",
                        recovery: { code: "ghost_source_unavailable", allowedActions: ["needs_user"] },
                    });
                }
                return this.controller.prepare({ path, intent: input.intent,
                    authority: { guard, sourceValidity, signal }, createActionAuthority,
                    onSession: session => {
                        if (!current()) { session.dispose(); return; }
                        request.onSession(session);
                    },
                });
            },
        };
    }

    readContextReceipt(operationId: string): Promise<ReturnType<GhostPublishingSession['getContextReceipt']>> {
        return this.controller.readContextReceipt(operationId);
    }
    clearContextPersistence(conversationId: string): void { this.controller.clearContextPersistence(conversationId); }

    dispose(): void {
        this.disposed = true;
        for (const event of this.events) this.dependencies.app.vault.offref(event);
        this.events.length = 0;
        this.revisions.clear();
        this.controller.dispose();
    }
}

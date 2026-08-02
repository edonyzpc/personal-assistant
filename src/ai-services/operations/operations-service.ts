import type { CapabilityProvider } from "../capability-types";
import {
    OperationsAuditStore,
    type OperationsAuditStoreOptions,
} from "./operations-audit-store";
import {
    OperationsControllerError,
    OperationsIntentController,
} from "./operations-intent-controller";
import { OperationsToolProvider } from "./operations-tool-provider";
import type { FrontmatterCodec } from "./vault-transform";
import type {
    OperationsControllerEvent,
    OperationsEventListener,
    OperationsExecutionResult,
    OperationsIntent,
    OperationsVault,
    OperationsVaultFile,
    StageOperationsIntentInput,
    UndoResult,
} from "./types";

const OPERATIONS_DISABLED_MESSAGE = "Operations is no longer enabled. Nothing was written.";

export interface OperationsServiceOptions {
    vault: OperationsVault;
    trashFile: (file: OperationsVaultFile) => Promise<void>;
    isOperationsAgentEnabled: () => boolean;
    audit?: OperationsAuditStoreOptions;
    auditStore?: OperationsAuditStore;
    isPathAllowed?: (path: string) => boolean;
    frontmatterCodec?: FrontmatterCodec;
    log?: (message: string, ...args: unknown[]) => void;
    now?: () => number;
    createId?: () => string;
    pendingTtlMs?: number;
}

export interface CreateOperationsSessionOptions {
    /** Human-readable surface identity used only in diagnostics. */
    surface: string;
    markSelfWrite?: (path: string) => void;
}

/**
 * Plugin-owned Operations composition root.
 *
 * Provider discovery, audit policy, Data Boundary, and diagnostics are shared.
 * Mutable intent, undo, timer, and listener state remains isolated per surface.
 */
export class OperationsService {
    readonly provider: OperationsToolProvider;
    readonly capabilityProvider: CapabilityProvider;

    private readonly auditStore: OperationsAuditStore;
    private readonly sessions = new Set<OperationsSession>();
    private disposed = false;

    constructor(private readonly options: OperationsServiceOptions) {
        this.provider = new OperationsToolProvider();
        this.capabilityProvider = this.provider;
        this.auditStore = options.auditStore ?? new OperationsAuditStore(options.vault, options.audit);
    }

    createSession(options: CreateOperationsSessionOptions): OperationsSession {
        if (this.disposed) {
            throw new OperationsControllerError("cancelled", "Operations service is disposed.");
        }
        const controller = new OperationsIntentController({
            vault: this.options.vault,
            trashFile: this.options.trashFile,
            auditStore: this.auditStore,
            ...(this.options.isPathAllowed ? { isPathAllowed: this.options.isPathAllowed } : {}),
            ...(options.markSelfWrite ? { markSelfWrite: options.markSelfWrite } : {}),
            ...(this.options.frontmatterCodec ? { frontmatterCodec: this.options.frontmatterCodec } : {}),
            ...(this.options.now ? { now: this.options.now } : {}),
            ...(this.options.createId ? { createId: this.options.createId } : {}),
            ...(this.options.pendingTtlMs !== undefined ? { pendingTtlMs: this.options.pendingTtlMs } : {}),
            onEvent: (event) => this.handleControllerEvent(options.surface, event),
        });
        const session = new OperationsSession({
            controller,
            isOperationsAgentEnabled: this.options.isOperationsAgentEnabled,
            capabilityProvider: this.provider,
            onDispose: () => this.sessions.delete(session),
        });
        this.sessions.add(session);
        return session;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const session of [...this.sessions]) session.dispose();
        this.sessions.clear();
    }

    private handleControllerEvent(surface: string, event: OperationsControllerEvent): void {
        const result = event.type === "operation-result" || event.type === "undo-result"
            ? event.result
            : undefined;
        if (result?.auditRetentionWarning) {
            this.options.log?.("Operations audit retention cleanup incomplete", {
                surface,
                operationId: "operationId" in result ? result.operationId : undefined,
                path: result.path,
                warning: result.auditRetentionWarning,
            });
        }
        if (result?.auditStatus !== "failed") return;
        this.options.log?.("Operations audit record unavailable", {
            surface,
            operationId: "operationId" in result ? result.operationId : undefined,
            path: result.path,
            error: result.auditError,
        });
    }
}

interface OperationsSessionOptions {
    controller: OperationsIntentController;
    isOperationsAgentEnabled: () => boolean;
    capabilityProvider: OperationsToolProvider;
    onDispose: () => void;
}

/** Surface-scoped pending/undo boundary backed by the shared service policy. */
export class OperationsSession {
    readonly provider: OperationsToolProvider;
    readonly capabilityProvider: CapabilityProvider;

    private readonly controller: OperationsIntentController;
    private readonly isOperationsAgentEnabled: () => boolean;
    private readonly onDispose: () => void;
    private disposed = false;

    constructor(options: OperationsSessionOptions) {
        this.controller = options.controller;
        this.isOperationsAgentEnabled = options.isOperationsAgentEnabled;
        this.provider = options.capabilityProvider;
        this.capabilityProvider = this.provider;
        this.onDispose = options.onDispose;
    }

    async stage(input: StageOperationsIntentInput, signal?: AbortSignal): Promise<OperationsIntent> {
        this.assertEnabled();
        const intent = await this.controller.stageIntent(input, signal);
        if (this.isOperationsAgentEnabled()) return intent;
        this.tryCancel(intent.id);
        throw operationsDisabledError();
    }

    /** Compatibility with the runtime's narrow OperationsIntentStager port. */
    async stageIntent(input: StageOperationsIntentInput, signal?: AbortSignal): Promise<OperationsIntent> {
        return await this.stage(input, signal);
    }

    async confirm(intentId: string): Promise<OperationsExecutionResult> {
        if (!this.isOperationsAgentEnabled()) {
            this.tryCancel(intentId);
            throw operationsDisabledError();
        }
        return await this.controller.executeIntent(intentId);
    }

    cancel(intentId: string): OperationsIntent {
        return this.controller.cancelIntent(intentId);
    }

    cancelPending(): void {
        for (const intent of this.controller.listPendingIntents()) {
            this.controller.cancelIntent(intent.id);
        }
    }

    async undoMany(receiptIds: readonly string[]): Promise<UndoResult[]> {
        return await this.controller.undoMany(receiptIds);
    }

    subscribe(listener: OperationsEventListener): () => void {
        return this.controller.subscribe(listener);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.controller.dispose();
        this.onDispose();
    }

    private assertEnabled(): void {
        if (!this.isOperationsAgentEnabled()) throw operationsDisabledError();
    }

    private tryCancel(intentId: string): void {
        try {
            this.controller.cancelIntent(intentId);
        } catch {
            // Missing, expired, or terminal intents are already fail-closed.
        }
    }
}

function operationsDisabledError(): OperationsControllerError {
    return new OperationsControllerError("cancelled", OPERATIONS_DISABLED_MESSAGE);
}

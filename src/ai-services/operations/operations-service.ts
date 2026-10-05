import type { CapabilityProvider } from "../capability-types";
import {
    OperationsControllerError,
    OperationsIntentController,
} from "./operations-intent-controller";
import { OperationsToolProvider } from "./operations-tool-provider";
import type { NoteImageRemovalHost } from "./note-image-removal";
import { NoteImageRemovalResourceOwner } from "./note-image-removal-resources";
import {
    assertTaskSourceReadCurrent,
    isTaskSourcePathAllowed,
} from "../task-source-read-guard";
import type { FrontmatterCodec } from "./vault-transform";
import type {
    ExecuteCurrentOperationsIntentInput,
    OperationsEventListener,
    OperationsExecutionResult,
    OperationsIntent,
    PreparedOperation,
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
    isPathAllowed?: (path: string) => boolean;
    frontmatterCodec?: FrontmatterCodec;
    now?: () => number;
    createId?: () => string;
    pendingTtlMs?: number;
    noteImageRemovalHost?: NoteImageRemovalHost;
    noteImageRemovalResources?: NoteImageRemovalResourceOwner;
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

    private readonly sessions = new Set<OperationsSession>();
    private readonly noteImageRemovalResources: NoteImageRemovalResourceOwner;
    private disposed = false;

    constructor(private readonly options: OperationsServiceOptions) {
        this.provider = new OperationsToolProvider();
        this.capabilityProvider = this.provider;
        this.noteImageRemovalResources = this.options.noteImageRemovalResources
            ?? new NoteImageRemovalResourceOwner({
                ...(this.options.now ? { now: this.options.now } : {}),
            });
    }

    createSession(options: CreateOperationsSessionOptions): OperationsSession {
        if (this.disposed) {
            throw new OperationsControllerError("cancelled", "Operations service is disposed.");
        }
        const controller = new OperationsIntentController({
            vault: this.options.vault,
            trashFile: this.options.trashFile,
            ...(this.options.isPathAllowed ? { isPathAllowed: this.options.isPathAllowed } : {}),
            ...(options.markSelfWrite ? { markSelfWrite: options.markSelfWrite } : {}),
            ...(this.options.frontmatterCodec ? { frontmatterCodec: this.options.frontmatterCodec } : {}),
            ...(this.options.now ? { now: this.options.now } : {}),
            ...(this.options.createId ? { createId: this.options.createId } : {}),
            ...(this.options.pendingTtlMs !== undefined ? { pendingTtlMs: this.options.pendingTtlMs } : {}),
            ...(this.options.noteImageRemovalHost
                ? { noteImageRemovalHost: this.options.noteImageRemovalHost }
                : {}),
            noteImageRemovalResources: this.noteImageRemovalResources,
        });
        const session = new OperationsSession({
            controller,
            isOperationsAgentEnabled: this.options.isOperationsAgentEnabled,
            capabilityProvider: this.provider,
            readContextResult: (intentId, runId) => this.readContextResult(intentId, runId),
            onDispose: () => {
                this.sessions.delete(session);
            },
        });
        this.sessions.add(session);
        return session;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const session of [...this.sessions]) session.dispose();
        this.sessions.clear();
        this.noteImageRemovalResources.dispose();
    }

    /** Read-only context may follow a live owner on another Chat surface.
     * Confirmation, cancellation and Undo remain local to its original session. */
    private readContextResult(intentId: string, runId?: string): ReturnType<OperationsIntentController['getContextResult']> {
        for (const session of this.sessions) {
            const observed = session.getOwnedContextResult(intentId, runId);
            if (observed.pending || observed.executing || observed.execution || observed.terminal) return observed;
        }
        return { undoneReceiptIds: [], undoResults: [], pending: false, executing: false };
    }

}

interface OperationsSessionOptions {
    controller: OperationsIntentController;
    isOperationsAgentEnabled: () => boolean;
    capabilityProvider: OperationsToolProvider;
    onDispose: () => void;
    readContextResult: (intentId: string, runId?: string) => ReturnType<OperationsIntentController['getContextResult']>;
}

/** Surface-scoped pending/undo boundary backed by the shared service policy. */
export class OperationsSession {
    readonly provider: OperationsToolProvider;
    readonly capabilityProvider: CapabilityProvider;

    private readonly controller: OperationsIntentController;
    private readonly isOperationsAgentEnabled: () => boolean;
    private readonly onDispose: () => void;
    private readonly readContextResult: OperationsSessionOptions['readContextResult'];
    private disposed = false;

    get isDisposed(): boolean {
        return this.disposed;
    }

    constructor(options: OperationsSessionOptions) {
        this.controller = options.controller;
        this.isOperationsAgentEnabled = options.isOperationsAgentEnabled;
        this.provider = options.capabilityProvider;
        this.capabilityProvider = this.provider;
        this.onDispose = options.onDispose;
        this.readContextResult = options.readContextResult;
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

    /**
     * Runtime-only execution port. The run and live source boundary come from the
     * Host closure; the model may contribute only the opaque pending intent id.
     */
    async executeCurrentIntent(input: ExecuteCurrentOperationsIntentInput): Promise<OperationsExecutionResult> {
        if (!input.runId || !input.intentId) {
            throw new OperationsControllerError("schema_invalid", "Run and intent identities are required.");
        }

        const observed = this.controller.getContextResult(input.intentId, input.runId);
        if (observed.executing) {
            return Object.freeze({ intentId: input.intentId, state: "executing", operations: [] });
        }
        if (observed.execution) return observed.execution;

        // Observation of a prior execution does not initiate another write and
        // must retain its actual result even after new execution is revoked.
        if (!this.isOperationsAgentEnabled()) {
            this.tryCancel(input.intentId);
            throw operationsDisabledError();
        }
        if (input.signal?.aborted) {
            throw new OperationsControllerError("cancelled", "Operations execution was cancelled before it started.");
        }

        if (!observed.pending) {
            throw new OperationsControllerError(
                observed.terminal === "cancelled" ? "cancelled" : "expired",
                `The Operations intent is ${observed.terminal ?? "no longer pending"}.`,
            );
        }
        const intent = this.controller.getIntent(input.intentId);
        if (!intent || intent.runId !== input.runId) {
            throw new OperationsControllerError(
                "expired",
                "The pending Operations intent is unavailable or belongs to another user request.",
            );
        }

        const sourceAuthority = input.taskSourceReadGuard.captureSourceAuthority?.();
        const assertOperationAllowed = (operation: PreparedOperation, afterSelfWrite: boolean): void => {
            if (!this.isOperationsAgentEnabled() || input.signal?.aborted) {
                throw new OperationsControllerError("cancelled", "Operations execution is no longer authorized.");
            }
            try {
                // Native writes advance the observation fence. The already
                // admitted target scope stays bound to this intent, while the
                // existing authority receipt rechecks ancestry and permissions.
                if (afterSelfWrite && sourceAuthority) {
                    if (!sourceAuthority()) throw new OperationsControllerError(
                        "boundary_denied", "The task source authority changed during Operations execution.");
                    return;
                }
                assertTaskSourceReadCurrent(input.taskSourceReadGuard);
                if (input.taskSourceReadGuard.isNoteDomainAllowed?.() === false) {
                    throw new OperationsControllerError(
                        "boundary_denied",
                        "The current source scope does not permit note Operations.",
                    );
                }
                if (operation.name !== "vault_create"
                    && !isTaskSourcePathAllowed(
                        input.taskSourceReadGuard,
                        operation.path,
                        "task_material",
                    )) {
                    throw new OperationsControllerError(
                        "boundary_denied",
                        `Target is outside the current task source scope: ${operation.path}.`,
                    );
                }
            } catch (error) {
                if (error instanceof OperationsControllerError) throw error;
                throw new OperationsControllerError(
                    "boundary_denied",
                    "The task source scope changed before Operations execution.",
                );
            }
        };
        for (const operation of intent.operations) assertOperationAllowed(operation, false);

        // executeIntent synchronously changes pending to executing before its
        // first await, so a repeated call above observes rather than rewrites.
        return await this.controller.executeIntent(input.intentId, assertOperationAllowed);
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

    getContextResult(intentId: string, runId?: string): ReturnType<OperationsIntentController['getContextResult']> {
        return this.readContextResult(intentId, runId);
    }

    getOwnedContextResult(intentId: string, runId?: string): ReturnType<OperationsIntentController['getContextResult']> {
        return this.controller.getContextResult(intentId, runId);
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

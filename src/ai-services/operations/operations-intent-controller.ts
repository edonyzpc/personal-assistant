import { getPlatformCrypto } from "../../platform-dom";
import {
    OperationsValidationError,
    isCoreWriteToolName,
    validateVaultAppendInput,
    validateVaultCreateInput,
    validateVaultProcessInput,
    validateFrontmatterUpdateInput,
    validateRemoveNoteImageInput,
    validateVaultMoveInput,
} from "./input-validation";
import { OperationsUndoStore } from "./operations-undo-store";
import { imageSourceHash } from "../../chat/image-policy";
import { cloneInputLineage } from "../input-lineage";
import {
    createRetainedNoteImageReadGuard,
    prepareNoteImageRemoval,
    verifyNoteImageReferenceCoverage,
    type NoteImageRemovalHost,
    type NoteImageRemovalPrivatePreparation,
} from "./note-image-removal";
import { NoteImageRemovalResourceOwner } from "./note-image-removal-resources";
import { isResourceOperationToolName, validateResourceOperationInput } from "./resource-input-validation";
import { OperationsResourceError, prepareResourceOperation, prepareResourceRecovery, executeResourceOperation,
    undoResourceOperation, type ResourceEffectHost, type ResourceRecovery } from "./operations-resource-effects";
import type {
    FrontmatterUpdateInput,
    OperationExecutionResult,
    OperationsControllerEvent,
    OperationsEventListener,
    OperationsExecutionResult,
    OperationsFailureCategory,
    OperationsIntent,
    OperationsIntentState,
    OperationsVault,
    OperationsVaultFile,
    NoteImageRemovalEffectResult,
    PreparedMarkdownOperation,
    PreparedOperation,
    StageOperationsIntentInput,
    UndoReceipt,
    UndoResult,
    VaultAppendInput,
    VaultCreateInput,
    VaultProcessInput,
    RemoveNoteImageInput,
    PreparedMoveOperation,
    VaultMoveInput,
    ResourceOperationInput,
} from "./types";
import { getOperationsBlockedReason, REMOVE_NOTE_IMAGE_TOOL_NAME } from "./types";
import { operationsResultObservation } from "../operations-status-tool";
import { OperationsPathError, parentVaultPath, validateOperationsVaultPath } from "./vault-path";
import {
    assertTaskSourceReadCurrent,
    isTaskSourcePathAllowed,
    type TaskSourceReadGuard,
    type TaskSourceReadKind,
} from "../task-source-read-guard";
import {
    type FrontmatterCodec,
    OperationsTransformError,
    appendMarkdown,
    transformFrontmatter,
    transformVaultProcess,
} from "./vault-transform";

export const DEFAULT_PENDING_INTENT_TTL_MS = 30 * 60 * 1_000;

export class OperationsControllerError extends Error {
    constructor(readonly category: OperationsFailureCategory, message: string) {
        super(message);
        this.name = "OperationsControllerError";
    }
}

export class StaleTargetError extends OperationsControllerError {
    constructor(message = "The target changed after preview. Review it and try again.") {
        super("stale_target", message);
        this.name = "StaleTargetError";
    }
}

export interface OperationsIntentControllerOptions {
    vault: OperationsVault;
    trashFile: (file: OperationsVaultFile) => Promise<void>;
    renameFile?: (file: OperationsVaultFile, targetPath: string) => Promise<void>;
    trashResource?: (file: OperationsVaultFile) => Promise<void>;
    removeEmptyFolder?: (file: OperationsVaultFile) => Promise<void>;
    undoStore?: OperationsUndoStore;
    isPathAllowed?: (path: string) => boolean;
    markSelfWrite?: (path: string) => void;
    frontmatterCodec?: FrontmatterCodec;
    now?: () => number;
    createId?: () => string;
    pendingTtlMs?: number;
    onEvent?: OperationsEventListener;
    noteImageRemovalHost?: NoteImageRemovalHost;
    noteImageRemovalResources?: NoteImageRemovalResourceOwner;
}

interface VirtualTarget {
    exists: boolean;
    content: string | null;
}

interface PreparedImageRecovery {
    bytes: ArrayBuffer;
    contentHash: string;
    reservation: import("./note-image-removal-resources").NoteImageRemovalReservation;
}

type MarkdownWriteTool =
    | { name: "vault_create"; input: VaultCreateInput }
    | { name: "vault_append"; input: VaultAppendInput }
    | { name: "vault_process"; input: VaultProcessInput }
    | { name: "frontmatter_update"; input: FrontmatterUpdateInput };

/**
 * Memory-only staging/execution boundary used by both the runtime wrapper and
 * Chat inline card. No method except executeIntent/undo can mutate the vault.
 */
export class OperationsIntentController {
    private readonly vault: OperationsVault;
    private readonly trashFile: (file: OperationsVaultFile) => Promise<void>;
    private readonly renameFile?: (file: OperationsVaultFile, targetPath: string) => Promise<void>;
    private readonly trashResource?: (file: OperationsVaultFile) => Promise<void>;
    private readonly removeEmptyFolder?: (file: OperationsVaultFile) => Promise<void>;
    private readonly resourceRecoveryOwner: NoteImageRemovalResourceOwner;
    private readonly ownsResourceRecoveryOwner: boolean;
    private readonly undoStore: OperationsUndoStore;
    private readonly isPathAllowed?: (path: string) => boolean;
    private readonly markSelfWrite?: (path: string) => void;
    private readonly frontmatterCodec?: FrontmatterCodec;
    private readonly now: () => number;
    private readonly createId: () => string;
    private readonly pendingTtlMs: number;
    private readonly noteImageRemovalHost?: NoteImageRemovalHost;
    private readonly noteImageRemovalResources?: NoteImageRemovalResourceOwner;
    private readonly noteImageProposals = new Map<string, NoteImageRemovalPrivatePreparation>();
    private readonly listeners = new Set<OperationsEventListener>();
    private readonly intents = new Map<string, OperationsIntent>();
    private readonly terminalStates = new Map<string, { state: OperationsIntentState; runId: string }>();
    /** Finite domain results for context; no note contents or undo capabilities. */
    private readonly contextResults = new Map<string, { result: OperationsExecutionResult; runId: string; turnId: string }>();
    private readonly contextUndone = new Map<string, Set<string>>();
    private readonly contextUndoResults = new Map<string, UndoResult[]>();
    private readonly expiredIntentIds = new Map<string, string>();
    private readonly expirationTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private disposed = false;
    private lifecycleEpoch = 0;

    constructor(options: OperationsIntentControllerOptions) {
        this.vault = options.vault;
        this.trashFile = options.trashFile;
        this.renameFile = options.renameFile;
        this.trashResource = options.trashResource;
        this.removeEmptyFolder = options.removeEmptyFolder;
        this.resourceRecoveryOwner = options.noteImageRemovalResources ?? new NoteImageRemovalResourceOwner({ now: options.now });
        this.ownsResourceRecoveryOwner = !options.noteImageRemovalResources;
        this.undoStore = options.undoStore ?? new OperationsUndoStore({ now: options.now });
        this.isPathAllowed = options.isPathAllowed;
        this.markSelfWrite = options.markSelfWrite;
        this.frontmatterCodec = options.frontmatterCodec;
        this.now = options.now ?? Date.now;
        this.createId = options.createId ?? defaultId;
        this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_INTENT_TTL_MS;
        this.noteImageRemovalHost = options.noteImageRemovalHost;
        this.noteImageRemovalResources = options.noteImageRemovalResources;
        if (options.onEvent) this.listeners.add(options.onEvent);
    }

    subscribe(listener: OperationsEventListener): () => void {
        this.assertUsable();
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async stageIntent(input: StageOperationsIntentInput, signal?: AbortSignal): Promise<OperationsIntent> {
        this.assertUsable();
        const lifecycleEpoch = this.lifecycleEpoch;
        const hostParentBinding = input.hostParentBinding ? Object.freeze({ ...input.hostParentBinding }) : undefined;
        const inputLineage = cloneInputLineage(input.inputLineage);
        freezeUnknown(inputLineage);
        const taskSourceReadGuard = input.taskSourceReadGuard;
        const assertCurrent = () => this.assertStageActive(signal, lifecycleEpoch, taskSourceReadGuard);
        const assertReadAllowed = (path: string, kind: TaskSourceReadKind) => {
            assertCurrent();
            this.assertPathAllowed(path);
            if (!isTaskSourcePathAllowed(taskSourceReadGuard, path, kind)) {
                throw new OperationsControllerError("boundary_denied", `Target is outside the current task source scope: ${path}.`);
            }
        };
        assertCurrent();
        if (!input.runId || !input.turnId) {
            throw new OperationsControllerError("schema_invalid", "runId and turnId are required.");
        }
        if (input.operations.length < 1) {
            throw new OperationsControllerError(
                "schema_invalid",
                "An intent must contain at least one operation.",
            );
        }
        const toolCallIds = new Set<string>();
        const virtualTargets = new Map<string, VirtualTarget>();
        const initialReadKinds = new Map<string, TaskSourceReadKind>();
        const prepared: PreparedOperation[] = [];

        // Validate the complete target list before a guarded batch reads any
        // baseline. The guard stays local to this call, including concurrent runs.
        const normalizedCalls = input.operations.map((call) => {
            if (!call.toolCallId || toolCallIds.has(call.toolCallId)) {
                throw new OperationsControllerError("schema_invalid", "Tool call ids must be non-empty and unique per intent.");
            }
            toolCallIds.add(call.toolCallId);
            if (!isCoreWriteToolName(call.name)) {
                throw new OperationsControllerError("schema_invalid", `Unsupported Operations tool: ${String(call.name)}.`);
            }
            if (isResourceOperationToolName(call.name)) {
                let resourceInput: ResourceOperationInput;
                try { resourceInput = validateResourceOperationInput(call.name, { ...(call.input as object), mode: input.mode ?? "apply" }); }
                catch (error) { throw new OperationsControllerError("schema_invalid", safeError(error, "Invalid resource operation.")); }
                return { resourceInput, input: resourceInput, call, name: call.name, path: resourceInput.path ?? "", readKind: "task_material" as const };
            }
            let tool: MarkdownWriteTool | { name: typeof REMOVE_NOTE_IMAGE_TOOL_NAME; input: RemoveNoteImageInput }
                | { name: "vault_move"; input: VaultMoveInput };
            let path: string;
            try {
                if (call.name === "vault_move") {
                    const moveInput = validateVaultMoveInput(call.input);
                    path = moveInput.sourcePath;
                    tool = { name: call.name, input: moveInput };
                    this.assertPathAllowed(moveInput.targetPath);
                    if (taskSourceReadGuard) assertReadAllowed(moveInput.targetPath, "output_target_exists");
                } else if (call.name === REMOVE_NOTE_IMAGE_TOOL_NAME) {
                    const input = validateRemoveNoteImageInput(call.input);
                    path = validateOperationsVaultPath(input.notePath);
                    tool = { name: call.name, input };
                } else if (call.name === "vault_create") {
                    const input = validateVaultCreateInput(call.input);
                    path = validateOperationsVaultPath(input.path);
                    tool = { name: call.name, input };
                } else if (call.name === "vault_append") {
                    const input = validateVaultAppendInput(call.input);
                    path = validateOperationsVaultPath(input.path);
                    tool = { name: call.name, input };
                } else if (call.name === "vault_process") {
                    const input = validateVaultProcessInput(call.input);
                    path = validateOperationsVaultPath(input.path);
                    tool = { name: call.name, input };
                } else {
                    const input = validateFrontmatterUpdateInput(call.input);
                    path = validateOperationsVaultPath(input.path);
                    tool = { name: call.name, input };
                }
            } catch (error) {
                throw normalizeStageError(error);
            }
            // Later operations on this path use the virtual baseline produced
            // in this batch; create does not grant permission to read old text.
            const readKind = initialReadKinds.get(path)
                ?? (call.name === "vault_create" ? "output_target_exists" : "task_material");
            initialReadKinds.set(path, readKind);
            if (taskSourceReadGuard) assertReadAllowed(path, readKind);
            return { ...tool, call, path, readKind, resourceInput: undefined };
        });

        // A native move may update relative links. Do not prepare later body
        // transforms against a guessed post-move baseline (or move a newly
        // created virtual file whose Host identity does not exist yet).
        const movedPaths = new Set<string>();
        const priorPaths = new Set<string>();
        for (const call of normalizedCalls) {
            if (call.resourceInput) continue;
            if (movedPaths.has(call.path)) {
                throw new OperationsControllerError("schema_invalid", "Read the moved note in a new call before preparing dependent operations.");
            }
            if (call.name === "vault_move") {
                if (priorPaths.has(call.path) || movedPaths.has(call.input.targetPath)) {
                    throw new OperationsControllerError("schema_invalid", "A dependent move must be prepared in a separate call from prior changes to its source.");
                }
                movedPaths.add(call.path);
                movedPaths.add(call.input.targetPath);
            }
            priorPaths.add(call.path);
        }

        for (const normalizedCall of normalizedCalls) {
            if (normalizedCall.resourceInput && isResourceOperationToolName(normalizedCall.name)) {
                const resourceHost = this.resourceHost((path, output = false) => assertReadAllowed(path, output ? "output_target_exists" : "task_material"), taskSourceReadGuard, signal);
                try { prepared.push(await prepareResourceOperation(resourceHost, { name: normalizedCall.name,
                    input: normalizedCall.resourceInput, toolCallId: normalizedCall.call.toolCallId, context: input.resourceContext })); }
                catch (error) { throw normalizeStageError(error); }
                assertCurrent(); continue;
            }
            const { call, path, readKind } = normalizedCall;
            assertReadAllowed(path, readKind);
            if (normalizedCall.name === "vault_move") {
                if (!this.renameFile) throw new OperationsControllerError("boundary_denied", "The native move adapter is unavailable.");
                const source = this.resolveFile(path);
                if (!source) throw new OperationsControllerError("target_missing", `Source note does not exist: ${path}.`);
                const fileVersion = source.stat ? Object.freeze({ ...source.stat }) : undefined;
                const expectedBefore = await this.readFreshFile(source);
                assertReadAllowed(path, readKind);
                assertReadAllowed(normalizedCall.input.targetPath, "output_target_exists");
                await this.assertMoveDestination(source, normalizedCall.input.targetPath);
                await this.assertMoveBaseline(source, expectedBefore, fileVersion);
                assertCurrent();
                prepared.push(deepFreeze({ kind: "move", id: this.createId(), toolCallId: call.toolCallId,
                    name: "vault_move", input: normalizedCall.input, path,
                    sourcePath: path, targetPath: normalizedCall.input.targetPath,
                    fileIdentity: source, ...(fileVersion ? { fileVersion } : {}), expectedBefore, expectedAfter: expectedBefore }));
                continue;
            }
            if (normalizedCall.name === REMOVE_NOTE_IMAGE_TOOL_NAME) {
                if (!this.noteImageRemovalHost || !taskSourceReadGuard) {
                    throw new OperationsControllerError(
                        "boundary_denied",
                        "The Host boundary required for note-image removal is unavailable.",
                    );
                }
                const operationId = this.createId();
                const preparation = await prepareNoteImageRemoval({
                    runId: input.runId,
                    turnId: input.turnId,
                    toolCallId: call.toolCallId,
                    input: normalizedCall.input,
                    host: this.noteImageRemovalHost,
                    taskSourceReadGuard,
                    createId: () => operationId,
                });
                assertReadAllowed(path, readKind);
                this.noteImageProposals.set(operationId, preparation.privatePreparation);
                prepared.push(preparation.operation);
                const target = virtualTargets.get(path) ?? { exists: true, content: null };
                target.content = preparation.operation.expectedAfter;
                virtualTargets.set(path, target);
                continue;
            }
            let target = virtualTargets.get(path);
            if (!target) {
                target = await this.readInitialTarget(path, normalizedCall.name !== "vault_create", () => assertReadAllowed(path, readKind));
                assertReadAllowed(path, readKind);
                virtualTargets.set(path, target);
            }
            const expectedBefore = target.exists ? target.content : null;
            let expectedAfter: string;
            try {
                expectedAfter = await this.prepareExpectedAfter(normalizedCall as MarkdownWriteTool, path, target);
                assertReadAllowed(path, readKind);
            } catch (error) {
                throw normalizeStageError(error);
            }

            target.exists = true;
            target.content = expectedAfter;
            prepared.push(deepFreeze({
                kind: "markdown",
                id: this.createId(),
                toolCallId: call.toolCallId,
                name: normalizedCall.name as MarkdownWriteTool["name"],
                input: normalizedCall.input as MarkdownWriteTool["input"],
                path,
                expectedBefore,
                expectedAfter,
            }));
        }

        const createdAt = this.now();
        const intent = freezeIntent({
            id: this.createId(),
            runId: input.runId,
            turnId: input.turnId,
            createdAt,
            expiresAt: createdAt + this.pendingTtlMs,
            operations: prepared,
            state: "pending",
            ...(input.mode ? { mode: input.mode } : {}),
            ...(hostParentBinding ? { hostParentBinding } : {}),
            ...(inputLineage ? { inputLineage } : {}),
        });
        assertCurrent();
        this.intents.set(intent.id, intent);
        try {
            assertCurrent();
            this.scheduleExpiration(intent);
            assertCurrent();
            this.emit({ type: "intent-staged", intent });
            return intent;
        } catch (error) {
            this.clearExpiration(intent.id);
            this.intents.delete(intent.id);
            throw error;
        }
    }

    getIntent(intentId: string): OperationsIntent | undefined {
        const intent = this.intents.get(intentId);
        if (!intent) return undefined;
        if (intent.state === "pending" && intent.expiresAt <= this.now()) {
            this.expireIntent(intentId);
            return undefined;
        }
        return intent;
    }

    /** Existing owner state is also the replay fence; no parallel result ledger. */
    getBatchContextResult(runId: string, turnId: string, toolCallIds: readonly string[]): {
        intent?: OperationsIntent;
        execution?: OperationsExecutionResult;
    } {
        const matches = (operations: readonly { toolCallId: string }[]) => operations.length === toolCallIds.length
            && operations.every((operation, index) => operation.toolCallId === toolCallIds[index]);
        for (const intent of this.intents.values()) {
            if (intent.runId === runId && intent.turnId === turnId && matches(intent.operations)) return { intent };
        }
        for (const recorded of this.contextResults.values()) {
            if (recorded.runId === runId && recorded.turnId === turnId && matches(recorded.result.operations)) return { execution: recorded.result };
        }
        return {};
    }

    getCallContextResult(runId: string, turnId: string, toolCallId: string): {
        intent?: OperationsIntent;
        execution?: OperationsExecutionResult;
    } {
        for (const intent of this.intents.values()) {
            if (intent.runId === runId && intent.turnId === turnId && intent.operations.some(operation => operation.toolCallId === toolCallId)) return { intent };
        }
        for (const recorded of this.contextResults.values()) {
            if (recorded.runId === runId && recorded.turnId === turnId && recorded.result.operations.some(operation => operation.toolCallId === toolCallId)) return { execution: recorded.result };
        }
        return {};
    }

    listPendingIntents(): OperationsIntent[] {
        this.pruneExpiredIntents();
        return [...this.intents.values()].filter((intent) => intent.state === "pending");
    }

    getContextResult(intentId: string, runId?: string): {
        execution?: OperationsExecutionResult;
        undoneReceiptIds: string[];
        undoResults: readonly UndoResult[];
        terminal?: OperationsIntentState | 'expired';
        pending: boolean;
        executing: boolean;
        blockedReason?: "shared_reference";
    } {
        const intent = this.getIntent(intentId);
        const completed = this.contextResults.get(intentId);
        const terminal = this.terminalStates.get(intentId);
        const recordedRunId = intent?.runId ?? completed?.runId ?? terminal?.runId ?? this.expiredIntentIds.get(intentId);
        if (runId !== undefined && recordedRunId !== runId) {
            return { undoneReceiptIds: [], undoResults: [], pending: false, executing: false };
        }
        const execution = completed?.result;
        const recordedUndoResults = this.contextUndoResults.get(intentId) ?? [];
        const availableReceiptIds = new Set(this.undoStore.listAvailable().map(receipt => receipt.id));
        const projectedExecution = execution ? {
            ...execution,
            operations: execution.operations.map(operation => {
                const undoResult = [...recordedUndoResults]
                    .reverse()
                    .find(candidate => candidate.receiptId === operation.receiptId);
                return {
                    ...operation,
                    undoAvailable: !this.disposed && undoResult?.status !== "undone"
                        && undoResult?.undoAvailable !== false
                        && (this.noteImageProposals.get(operation.operationId)?.revalidateUndo() ?? true)
                        && operation.receiptId !== undefined
                        && availableReceiptIds.has(operation.receiptId)
                        && (!operation.effects?.some(effect => effect.key === "attachment" && effect.status === "removed")
                            || this.noteImageRemovalResources?.has(operation.receiptId) === true),
                };
            }),
        } : undefined;
        const undoResults = recordedUndoResults.map(result => ({
            ...result,
            undoAvailable: projectedExecution?.operations.find(operation =>
                operation.receiptId === result.receiptId)?.undoAvailable === true,
        }));
        return { ...(projectedExecution ? { execution: projectedExecution } : {}),
            undoneReceiptIds: [...(this.contextUndone.get(intentId) ?? [])],
            undoResults,
            terminal: this.expiredIntentIds.has(intentId) ? 'expired' : terminal?.state,
            pending: intent?.state === 'pending', executing: intent?.state === 'executing',
            ...(intent?.state === 'pending' && getOperationsBlockedReason(intent.operations)
                ? { blockedReason: "shared_reference" as const } : {}) };
    }

    cancelIntent(intentId: string): OperationsIntent {
        this.assertUsable();
        const intent = this.requirePendingIntent(intentId);
        this.clearExpiration(intentId);
        const cancelled = replaceIntentState(intent, "cancelled");
        this.intents.delete(intentId);
        this.terminalStates.set(intentId, { state: "cancelled", runId: intent.runId });
        this.emit({ type: "intent-cancelled", intent: cancelled });
        return cancelled;
    }

    async executeIntent(
        intentId: string,
        assertOperationAllowed?: (operation: PreparedOperation, afterSelfWrite: boolean) => void,
        resourceBoundary?: { guard: TaskSourceReadGuard; signal?: AbortSignal },
    ): Promise<OperationsExecutionResult> {
        this.assertUsable();
        const lifecycleEpoch = this.lifecycleEpoch;
        const pending = this.requirePendingIntent(intentId);
        if (pending.mode === "preview") throw new OperationsControllerError("boundary_denied", "A preview cannot be executed. Prepare a new apply call against current files.");
        if (getOperationsBlockedReason(pending.operations)) {
            throw new OperationsControllerError("boundary_denied",
                "This proposal is blocked by a shared image reference. Submit a new proposal to continue.");
        }
        this.clearExpiration(intentId);
        const executing = replaceIntentState(pending, "executing");
        this.intents.set(intentId, executing);
        this.emit({ type: "intent-state-changed", intent: executing });

        const results: OperationExecutionResult[] = [];
        const imageRecovery = new Map<string, PreparedImageRecovery>();
        const resourceRecovery = new Map<string, ResourceRecovery>();
        let preparationFailure: { operationId: string; error: OperationsControllerError } | undefined;
        // Prepare recovery before the first effect. Resource trash may explicitly
        // proceed without PA Undo when only backup capacity is insufficient.
        // Reservations transfer to the existing Undo owner or are released below.
        for (const operation of executing.operations) {
            if (operation.kind === "resource" && operation.resource.action === "trash") {
                try {
                    this.assertExecutionActive(lifecycleEpoch); assertOperationAllowed?.(operation, false);
                    const recovery = await prepareResourceRecovery(this.resourceHost((path, output) => {
                        this.assertExecutionActive(lifecycleEpoch); this.assertPathAllowed(path);
                        assertOperationAllowed?.(operation, false);
                        if (!isTaskSourcePathAllowed(resourceBoundary?.guard, path, output ? "output_target_exists" : "task_material")) {
                            throw new OperationsControllerError("boundary_denied", "The recovery path is outside the current source scope.");
                        }
                    }, resourceBoundary?.guard, resourceBoundary?.signal), operation);
                    if (recovery) resourceRecovery.set(operation.id, recovery);
                } catch (error) { preparationFailure = { operationId: operation.id, error: normalizeExecutionError(error) }; break; }
                continue;
            }
            if (operation.kind !== "note_image_removal" || operation.input.attachmentAction !== "delete") continue;
            try {
                this.assertExecutionActive(lifecycleEpoch);
                assertOperationAllowed?.(operation, false);
                imageRecovery.set(operation.id, await this.prepareImageRecovery(operation));
            } catch (error) {
                preparationFailure = { operationId: operation.id, error: normalizeExecutionError(error) };
                break;
            }
        }
        let stop = preparationFailure !== undefined;
        let hasAppliedEffect = false;
        for (const operation of executing.operations) {
            const assertBeforeEffect = (afterSelfWrite = false): void => {
                this.assertExecutionActive(lifecycleEpoch);
                this.assertPathAllowed(operation.path);
                if (operation.kind === "move") this.assertPathAllowed(operation.targetPath);
                assertOperationAllowed?.(operation, hasAppliedEffect || afterSelfWrite);
            };
            // A native effect already in progress must settle. Lost admission
            // prevents the next effect; it cannot retroactively undo that write.
            if (!stop && results.length > 0) {
                try { assertBeforeEffect(); }
                catch { stop = true; }
            }
            if (stop) {
                const skipped: OperationExecutionResult = {
                    operationId: operation.id,
                    toolCallId: operation.toolCallId,
                    name: operation.name,
                    path: operation.path,
                    status: preparationFailure?.operationId === operation.id ? "failed" : "skipped",
                    ...(preparationFailure?.operationId === operation.id ? {
                        failureCategory: preparationFailure.error.category, message: preparationFailure.error.message,
                        ...(operation.kind === "note_image_removal" ? { effects: [
                            { key: "note" as const, status: this.isExecutionActive(lifecycleEpoch) ? "failed" as const : "not_started" as const,
                                failureCategory: preparationFailure.error.category },
                            { key: "attachment" as const, status: "not_started" as const },
                        ] } : {}),
                    } : { message: "Skipped because execution stopped before this operation." }),
                };
                results.push(skipped);
                if (this.isExecutionActive(lifecycleEpoch)) this.emit({ type: "operation-result", intentId, result: skipped });
                continue;
            }

            const recovery = imageRecovery.get(operation.id);
            imageRecovery.delete(operation.id);
            let result: OperationExecutionResult;
            if (operation.kind === "resource") {
                const resourceHost = this.resourceHost((path, output) => {
                    assertBeforeEffect(true); this.assertPathAllowed(path);
                    if (!isTaskSourcePathAllowed(resourceBoundary?.guard, path, output ? "output_target_exists" : "task_material")) {
                        throw new OperationsControllerError("boundary_denied", "The resource path is outside the current source scope.");
                    }
                }, resourceBoundary?.guard, resourceBoundary?.signal);
                resourceHost.undo = receiptId => this.undo(receiptId, path => resourceHost.assertAllowed(path, true));
                const resourcePrepared = resourceRecovery.get(operation.id); resourceRecovery.delete(operation.id);
                result = await executeResourceOperation(resourceHost, executing, operation, resourcePrepared);
            } else result = await this.executeOperation(executing, operation, lifecycleEpoch, assertBeforeEffect, recovery);
            results.push(result);
            hasAppliedEffect ||= result.status === "succeeded"
                || result.resourceEffect?.opened === true || (result.resourceEffect?.paths?.length ?? 0) > 0
                || result.effects?.some(effect => effect.status === "applied" || effect.status === "removed") === true;
            if (this.isExecutionActive(lifecycleEpoch)) this.emit({ type: "operation-result", intentId, result });
            if (result.status !== "succeeded" && result.status !== "unchanged") stop = true;
        }
        for (const recovery of imageRecovery.values()) recovery.reservation.release();
        for (const recovery of resourceRecovery.values()) if (recovery.kind === "snapshot") recovery.reservation.release();

        const active = this.isExecutionActive(lifecycleEpoch);
        if (!active) {
            for (let index = 0; index < results.length; index += 1) {
                results[index] = { ...results[index], undoAvailable: false };
            }
        }

        const succeeded = results.filter(result => result.status === "succeeded"
            || result.resourceEffect?.opened === true || result.status === "partial" && (result.resourceEffect?.paths?.length ?? 0) > 0
            || result.effects?.some(effect => effect.status === "applied" || effect.status === "removed")).length;
        const unknown = results.some(result => result.status === "unknown"
            || result.effects?.some(effect => effect.status === "unknown"));
        const state: OperationsExecutionResult["state"] = results.every(result => result.status === "succeeded" || result.status === "unchanged")
            ? "completed" : succeeded > 0 ? "partial" : unknown ? "unknown" : "failed";
        const finalIntent = replaceIntentState(executing, state);
        const resultFact = { kind: "operations_result" as const,
            observation: operationsResultObservation({ intentId, state, operations: results }) };
        const executionResult = Object.freeze({ intentId, state, operations: Object.freeze(results),
            ...(resultFact ? { resultFact } : {}) });
        // The captured history sink can consume this finite result after close.
        // Do not recreate any disposed owner's state or notify its old UI.
        if (!active) return executionResult;
        this.intents.delete(intentId);
        this.terminalStates.set(intentId, { state, runId: executing.runId });
        this.contextResults.set(intentId, { runId: executing.runId, turnId: executing.turnId, result: { intentId, state,
            ...(resultFact ? { resultFact } : {}), operations: results.map(result => ({
            operationId: result.operationId, toolCallId: result.toolCallId, name: result.name,
            path: '', status: result.status,
            ...(result.failureCategory ? { failureCategory: result.failureCategory } : {}),
            ...(result.effects ? { effects: result.effects.map(effect => ({ ...effect })) } : {}),
            ...(result.resourceEffect ? { resourceEffect: { ...result.resourceEffect,
                ...(result.resourceEffect.paths ? { paths: [...result.resourceEffect.paths] } : {}),
                ...(result.resourceEffect.position ? { position: { ...result.resourceEffect.position,
                    requested: { ...result.resourceEffect.position.requested },
                    ...(result.resourceEffect.position.actual ? { actual: { ...result.resourceEffect.position.actual } } : {}),
                } } : {}),
            } } : {}),
            ...(result.undoAvailable !== undefined ? { undoAvailable: result.undoAvailable } : {}),
            ...(result.receiptId ? { receiptId: result.receiptId } : {}),
        })) } });
        this.emit({ type: "intent-state-changed", intent: finalIntent });
        this.emit({ type: "intent-result", result: executionResult });
        return executionResult;
    }

    async undo(receiptId: string, assertResourceAllowed?: (path: string) => void): Promise<UndoResult> {
        this.assertUsable();
        const lookup = this.undoStore.get(receiptId);
        if (!lookup.ok) {
            const status = lookup.reason === "expired" ? "expired" : "unavailable";
            const result: UndoResult = {
                receiptId,
                status,
                failureCategory: lookup.reason === "expired" ? "expired" : "undo_unavailable",
                message: `Undo receipt is ${lookup.reason}.`,
            };
            this.emit({ type: "undo-result", result });
            return result;
        }

        const receipt = lookup.receipt;
        if (this.intents.get(receipt.intentId)?.state === "executing") {
            return { receiptId, operationId: receipt.operationId, path: receipt.path,
                status: "unavailable", failureCategory: "undo_unavailable",
                message: "The batch is still executing; Undo becomes available after its effects settle." };
        }
        if (receipt.resource) {
            if (!this.undoStore.acquire(receiptId)) return { receiptId, status: "unavailable", failureCategory: "undo_unavailable", message: "This Undo receipt is already in use." };
            try {
                const host = this.resourceHost(path => {
                    this.assertUsable(); this.assertPathAllowed(path); assertResourceAllowed?.(path);
                });
                const result = await undoResourceOperation(host, receipt);
                if (result.status === "undone") {
                    this.undoStore.markUsed(receipt.id);
                    const undone = this.contextUndone.get(receipt.intentId) ?? new Set<string>();
                    undone.add(receipt.id); this.contextUndone.set(receipt.intentId, undone);
                }
                const observed = this.recordUndoResult(receipt.intentId, result);
                this.emit({ type: "undo-result", result: observed }); return observed;
            } finally { this.undoStore.releaseLease(receiptId); }
        }
        let result: UndoResult;
        let compoundUndoResult: UndoResult | undefined;
        try {
            this.assertPathAllowed(receipt.path);
            if (receipt.kind === REMOVE_NOTE_IMAGE_TOOL_NAME) {
                const proposal = this.noteImageProposals.get(receipt.operationId);
                const undone = proposal?.attachmentAction === "keep"
                    ? await this.undoMarkdownImageRemoval(receipt, proposal)
                    : await this.undoNoteImageRemoval(receipt);
                if (undone.status !== "undone") {
                    result = undone;
                    result = this.recordUndoResult(receipt.intentId, result);
                    this.emit({ type: "undo-result", result });
                    return result;
                }
                result = undone;
                compoundUndoResult = undone;
            } else if (receipt.kind === "vault_move") {
                compoundUndoResult = await this.undoMove(receipt);
                if (compoundUndoResult.status !== "undone") {
                    const observed = this.recordUndoResult(receipt.intentId, compoundUndoResult);
                    this.emit({ type: "undo-result", result: observed });
                    return observed;
                }
            } else if (receipt.kind === "vault_create") await this.undoCreate(receipt);
            else await this.undoExisting(receipt);
            this.undoStore.markUsed(receipt.id);
            const undone = this.contextUndone.get(receipt.intentId) ?? new Set<string>();
            undone.add(receipt.id);
            this.contextUndone.set(receipt.intentId, undone);
            result = compoundUndoResult ?? {
                receiptId,
                operationId: receipt.operationId,
                path: receipt.path,
                status: "undone",
            };
        } catch (error) {
            const normalized = normalizeExecutionError(error);
            result = {
                receiptId,
                operationId: receipt.operationId,
                path: receipt.path,
                status: normalized.category === "stale_target" ? "stale" : "failed",
                failureCategory: normalized.category,
                message: normalized.message,
            };
        }

        result = this.recordUndoResult(receipt.intentId, result);
        this.emit({ type: "undo-result", result });
        return result;
    }

    private recordUndoResult(intentId: string, result: UndoResult): UndoResult {
        const results = this.contextUndoResults.get(intentId) ?? [];
        const previous = results.find(candidate => candidate.receiptId === result.receiptId);
        const retainedCheckpoint = previous?.checkpoint === "attachment-restored" && result.status !== "undone"
            && result.checkpoint !== "attachment-restored";
        const current: UndoResult = {
            ...result,
            ...(retainedCheckpoint ? { checkpoint: previous.checkpoint,
                effects: previous.effects?.map(effect => ({ ...effect })) } : {}),
        };
        if (current.undoAvailable !== undefined) {
            current.undoAvailable = current.undoAvailable && !this.disposed
                && this.undoStore.listAvailable().some(receipt => receipt.id === result.receiptId)
                && (!current.effects?.some(effect => effect.key === "attachment")
                    || this.noteImageRemovalResources?.has(result.receiptId) === true);
        }
        this.contextUndoResults.set(intentId, [
            ...results.filter(candidate => candidate.receiptId !== result.receiptId), current,
        ]);
        return current;
    }

    private async undoMarkdownImageRemoval(
        receipt: UndoReceipt,
        proposal: NoteImageRemovalPrivatePreparation,
    ): Promise<UndoResult> {
        const base = { receiptId: receipt.id, operationId: receipt.operationId, path: receipt.path };
        if (!proposal.revalidateUndo()) {
            return { ...base, status: "unavailable", failureCategory: "boundary_denied" };
        }
        try {
            await this.undoExisting(receipt);
            return {
                ...base,
                status: "undone",
                effects: [
                    { key: "note", status: "restored" },
                ],
                undoAvailable: false,
            };
        } catch (error) {
            const normalized = normalizeExecutionError(error);
            return {
                ...base,
                status: normalized.category === "stale_target" ? "stale" : "failed",
                failureCategory: normalized.category,
                message: normalized.message,
                undoAvailable: true,
            };
        }
    }

    private async undoNoteImageRemoval(
        receipt: UndoReceipt,
    ): Promise<UndoResult> {
        const base = { receiptId: receipt.id, operationId: receipt.operationId, path: receipt.path };
        if (!this.noteImageRemovalHost || !this.noteImageRemovalResources) {
            return { ...base, status: "unavailable", failureCategory: "undo_unavailable" };
        }
        const proposal = this.noteImageProposals.get(receipt.operationId);
        if (!proposal) {
            return { ...base, status: "unavailable", failureCategory: "undo_unavailable" };
        }
        let leased = false;
        let restoreAttempted = false;
        let attachmentRestored = false;
        let noteRestoreAttempted = false;
        try {
            this.assertPathAllowed(receipt.path);
            if (!proposal.revalidateUndo()) {
                return { ...base, status: "unavailable", failureCategory: "boundary_denied" };
            }
            const noteFileBeforeRestore = this.vault.getAbstractFileByPath(receipt.path);
            if (!noteFileBeforeRestore
                || await this.readFreshFile(noteFileBeforeRestore) !== receipt.expectedAfter) {
                return {
                    ...base,
                    status: "stale",
                    failureCategory: "stale_target",
                    effects: [
                        { key: "note", status: "applied" },
                        { key: "attachment", status: "removed" },
                    ],
                    undoAvailable: true,
                };
            }
            if (!proposal.revalidateUndo()) {
                return {
                    ...base,
                    status: "unavailable",
                    failureCategory: "boundary_denied",
                    effects: [
                        { key: "note", status: "applied" },
                        { key: "attachment", status: "removed" },
                    ],
                    undoAvailable: false,
                };
            }
            const snapshot = this.noteImageRemovalResources.acquire(receipt.id);
            leased = true;
            if (!this.noteImageRemovalHost.isAttachmentPathAllowed(snapshot.attachment.path)) {
                return { ...base, status: "unavailable", failureCategory: "boundary_denied" };
            }
            const existing = this.noteImageRemovalHost.getAttachmentFileByPath?.(snapshot.attachment.path);
            if (existing) {
                const currentBytes = await this.noteImageRemovalHost.readAttachmentFile?.(snapshot.attachment);
                if (!currentBytes) {
                    return { ...base, status: "unavailable", failureCategory: "undo_unavailable" };
                }
                const bytes = currentBytes instanceof Uint8Array ? currentBytes.slice().buffer : currentBytes.slice(0);
                if (bytes.byteLength !== snapshot.bytes.byteLength
                    || await imageSourceHash(bytes) !== snapshot.contentHash) {
                    throw new OperationsControllerError("target_collision", "Another file now uses the original attachment path.");
                }
            } else {
                restoreAttempted = true;
                const restored = await this.noteImageRemovalHost.restoreAttachmentFile?.(
                    snapshot.attachment,
                    snapshot.bytes,
                );
                const restoredBytes = restored
                    ? await this.noteImageRemovalHost.readAttachmentFile?.(restored)
                    : undefined;
                if (!restored || !restoredBytes) {
                    return { ...base, status: "unknown", failureCategory: "unknown", message: "Attachment restoration result is unknown.",
                        effects: [{ key: "note", status: "applied" }, { key: "attachment", status: "unknown" }],
                        undoAvailable: true };
                }
                const bytes = restoredBytes instanceof Uint8Array ? restoredBytes.slice().buffer : restoredBytes.slice(0);
                if (bytes.byteLength !== snapshot.bytes.byteLength
                    || await imageSourceHash(bytes) !== snapshot.contentHash) {
                    return {
                        ...base,
                        status: "failed",
                        failureCategory: "fs_error",
                        message: "Restored attachment bytes did not match.",
                        effects: [
                            { key: "note", status: "applied" },
                            { key: "attachment", status: "unknown" },
                        ],
                        undoAvailable: true,
                    };
                }
            }
            attachmentRestored = true;

            if (!proposal.revalidateUndo()) {
                return {
                    ...base,
                    status: "unavailable",
                    failureCategory: "boundary_denied",
                    checkpoint: "attachment-restored",
                    effects: [
                        { key: "note", status: "applied" },
                        { key: "attachment", status: "restored" },
                    ],
                    undoAvailable: false,
                };
            }
            if (this.disposed) {
                return {
                    ...base,
                    status: "unavailable",
                    failureCategory: "cancelled",
                    checkpoint: "attachment-restored",
                    effects: [
                        { key: "note", status: "applied" },
                        { key: "attachment", status: "restored" },
                    ],
                    undoAvailable: false,
                };
            }

            const noteFile = this.vault.getAbstractFileByPath(receipt.path);
            if (!noteFile) throw new StaleTargetError("The modified note no longer exists.");
            this.markSelfWrite?.(receipt.path);
            noteRestoreAttempted = true;
            await this.vault.process(noteFile, current => {
                if (current !== receipt.expectedAfter) throw new StaleTargetError();
                return receipt.before ?? "";
            });
            this.undoStore.markUsed(receipt.id);
            this.noteImageRemovalResources.releaseLease(receipt.id);
            this.noteImageRemovalResources.release(receipt.id);
            leased = false;
            return {
                ...base,
                status: "undone",
                effects: [
                    { key: "note", status: "restored" },
                    { key: "attachment", status: "restored" },
                ],
                undoAvailable: false,
            };
        } catch (error) {
            const normalized = normalizeExecutionError(error);
            return {
                ...base,
                status: normalized.category === "stale_target" || normalized.category === "target_collision"
                    ? "stale"
                    : normalized.category === "boundary_denied" ? "unavailable" : "unknown",
                failureCategory: normalized.category,
                message: normalized.category === "stale_target"
                    ? "The attachment was restored, but the note changed. Recovery remains available."
                    : normalized.message,
                ...(attachmentRestored ? {
                    checkpoint: "attachment-restored",
                    effects: [
                        { key: "note", status: noteRestoreAttempted && normalized.category !== "stale_target" ? "unknown" : "applied" },
                        { key: "attachment", status: "restored" },
                    ],
                    undoAvailable: normalized.category !== "boundary_denied",
                } : restoreAttempted ? { effects: [
                    { key: "note", status: "applied" }, { key: "attachment", status: "unknown" }],
                    undoAvailable: normalized.category !== "boundary_denied" } : {}),
            };
        } finally {
            if (leased) this.noteImageRemovalResources.releaseLease(receipt.id);
        }
    }

    async undoMany(receiptIds: readonly string[]): Promise<UndoResult[]> {
        const results: UndoResult[] = [];
        for (const receiptId of [...receiptIds].reverse()) results.push(await this.undo(receiptId));
        return results;
    }

    async undoCompleted(execution: OperationsExecutionResult): Promise<UndoResult[]> {
        return await this.undoMany(execution.operations.flatMap((result) => result.receiptId ? [result.receiptId] : []));
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.lifecycleEpoch += 1;
        for (const timer of this.expirationTimers.values()) clearTimeout(timer);
        this.expirationTimers.clear();
        this.intents.clear();
        this.terminalStates.clear();
        this.contextResults.clear();
        this.contextUndone.clear();
        this.expiredIntentIds.clear();
        for (const receipt of this.undoStore.listAvailable()) {
            if (receipt.kind === REMOVE_NOTE_IMAGE_TOOL_NAME) this.noteImageRemovalResources?.retire(receipt.id);
        }
        this.undoStore.clear();
        if (this.ownsResourceRecoveryOwner) this.resourceRecoveryOwner.dispose();
        this.emit({ type: "disposed" });
        this.listeners.clear();
    }

    private async prepareExpectedAfter(
        tool: MarkdownWriteTool,
        path: string,
        target: VirtualTarget,
    ): Promise<string> {
        const { name, input } = tool;
        if (name === "vault_create") {
            if (target.exists) throw new OperationsControllerError("target_collision", `Target already exists: ${path}.`);
            const parent = parentVaultPath(path);
            if (parent && !this.resolveFolder(parent)) {
                throw new OperationsControllerError("parent_missing", `Parent folder does not exist: ${parent}.`);
            }
            return input.content;
        }
        if (!target.exists || target.content === null) {
            throw new OperationsControllerError("target_missing", `Target note does not exist: ${path}.`);
        }
        if (name === "vault_append") return appendMarkdown(target.content, input.content);
        if (name === "vault_process") return transformVaultProcess(target.content, input);
        return transformFrontmatter(target.content, input, this.frontmatterCodec);
    }

    private async executeOperation(
        intent: OperationsIntent,
        operation: PreparedOperation,
        lifecycleEpoch: number,
        assertBeforeEffect: (afterSelfWrite?: boolean) => void,
        preparedRecovery?: PreparedImageRecovery,
    ): Promise<OperationExecutionResult> {
        if (operation.kind === "resource") throw new OperationsControllerError("schema_invalid", "Resource effects require their admitted execution context.");
        if (operation.kind === "note_image_removal") {
            return await this.executeNoteImageRemoval(intent, operation, lifecycleEpoch, assertBeforeEffect, preparedRecovery);
        }
        if (operation.kind === "move") return this.executeMove(intent, operation, lifecycleEpoch, assertBeforeEffect);
        let writeAttempted = false;
        const markWriteAttempted = (): void => { writeAttempted = true; };
        try {
            assertBeforeEffect();
            if (operation.name === "vault_create") {
                await this.executeCreate(operation, assertBeforeEffect, markWriteAttempted);
            } else {
                await this.executeExisting(operation, assertBeforeEffect, markWriteAttempted);
            }
            const active = this.isExecutionActive(lifecycleEpoch);
            const receiptId = active ? this.undoStore.create({
                intentId: intent.id,
                operationId: operation.id,
                path: operation.path,
                kind: operation.name,
                before: operation.expectedBefore,
                expectedAfter: operation.expectedAfter,
            }).id : this.createId();
            return {
                operationId: operation.id,
                toolCallId: operation.toolCallId,
                name: operation.name,
                path: operation.path,
                status: "succeeded",
                receiptId,
                undoAvailable: active,
            };
        } catch (error) {
            const normalized = normalizeExecutionError(error);
            return {
                operationId: operation.id,
                toolCallId: operation.toolCallId,
                name: operation.name,
                path: operation.path,
                status: writeAttempted ? "unknown" : normalized.category === "stale_target" ? "stale" : "failed",
                failureCategory: writeAttempted ? "unknown" : normalized.category,
                message: normalized.message,
            };
        }
    }

    /** Private resource adapters share this controller's lifecycle and Undo store. */
    private resourceHost(assertAllowed: ResourceEffectHost["assertAllowed"], guard?: TaskSourceReadGuard, signal?: AbortSignal): ResourceEffectHost {
        return { vault: this.vault, undoStore: this.undoStore, recoveryOwner: this.resourceRecoveryOwner,
            renameFile: this.renameFile, trashResource: this.trashResource, removeEmptyFolder: this.removeEmptyFolder, createId: this.createId,
            isActive: () => !this.disposed, assertAllowed: (path, output) => {
                try { assertAllowed(path, output); }
                catch (error) { if (error instanceof OperationsControllerError) throw new OperationsResourceError(error.category, error.message); throw error; }
            }, guard, signal, markSelfWrite: this.markSelfWrite };
    }

    getUndoTargetPaths(receiptId: string): readonly string[] | undefined {
        const lookup = this.undoStore.get(receiptId);
        if (!lookup.ok) return undefined;
        const receipt = lookup.receipt;
        const resource = receipt.resource;
        return resource?.action === "trash" ? resource.tree.map(e => e.path)
            : resource?.action === "mkdir" ? resource.folders.map(e => e.path)
            : resource?.action === "editor" ? [resource.binding.path]
            : resource?.action === "move" ? [receipt.path, resource.originalPath, ...resource.tree.flatMap(e =>
                [e.path, resource.originalPath + e.path.slice(receipt.path.length)])]
                : [receipt.path];
    }

    private async assertMoveDestination(file: OperationsVaultFile, targetPath: string): Promise<void> {
        const parent = parentVaultPath(targetPath);
        if (parent && !this.resolveFolder(parent)) throw new OperationsControllerError("parent_missing", `Parent folder does not exist: ${parent}.`);
        const target = this.vault.getAbstractFileByPath(targetPath);
        if ((target && target !== file) || (!target && await this.vault.adapter.exists(targetPath))) {
            throw new OperationsControllerError("target_collision", `Target already exists: ${targetPath}.`);
        }
    }

    private isMoveApplied(file: OperationsVaultFile, sourcePath: string, targetPath: string): boolean {
        return this.vault.getAbstractFileByPath(targetPath) === file && file.path === targetPath
            && this.vault.getAbstractFileByPath(sourcePath)?.path !== sourcePath;
    }

    private async executeMove(
        intent: OperationsIntent,
        operation: PreparedMoveOperation,
        lifecycleEpoch: number,
        assertBeforeEffect: (afterSelfWrite?: boolean) => void,
    ): Promise<OperationExecutionResult> {
        const base = { operationId: operation.id, toolCallId: operation.toolCallId, name: operation.name,
            path: operation.sourcePath, targetPath: operation.targetPath };
        let attempted = false;
        try {
            assertBeforeEffect();
            const file = this.resolveFile(operation.sourcePath);
            const version = operation.fileVersion ?? (file?.stat ? { ...file.stat } : undefined);
            if (file !== operation.fileIdentity || !file || await this.readFreshFile(file) !== operation.expectedBefore) throw new StaleTargetError();
            assertBeforeEffect();
            await this.assertMoveDestination(file, operation.targetPath);
            await this.assertMoveBaseline(file, operation.expectedBefore, version);
            assertBeforeEffect();
            if (this.resolveFile(operation.sourcePath) !== file) throw new StaleTargetError();
            if (operation.sourcePath === operation.targetPath) return { ...base, status: "unchanged", undoAvailable: false };
            if (!this.renameFile) throw new OperationsControllerError("boundary_denied", "The native move adapter is unavailable.");
            this.markSelfWrite?.(operation.sourcePath);
            this.markSelfWrite?.(operation.targetPath);
            attempted = true;
            await this.renameFile(file, operation.targetPath);
            if (!this.isMoveApplied(file, operation.sourcePath, operation.targetPath)) {
                return { ...base, status: "unknown", failureCategory: "unknown", undoAvailable: false };
            }
            return await this.completedMove(intent, operation, lifecycleEpoch);
        } catch (error) {
            // A rejected native promise may still have moved the file. Preserve
            // a proven effect, and never turn a secondary read into a replay.
            if (attempted && this.isMoveApplied(operation.fileIdentity, operation.sourcePath, operation.targetPath)) {
                return await this.completedMove(intent, operation, lifecycleEpoch);
            }
            const normalized = normalizeExecutionError(error);
            return { ...base, status: attempted ? "unknown" : normalized.category === "stale_target" ? "stale" : "failed",
                failureCategory: attempted ? "unknown" : normalized.category, message: normalized.message, undoAvailable: false };
        }
    }

    private async completedMove(intent: OperationsIntent, operation: PreparedMoveOperation, lifecycleEpoch: number): Promise<OperationExecutionResult> {
        const base = { operationId: operation.id, toolCallId: operation.toolCallId, name: operation.name,
            path: operation.sourcePath, targetPath: operation.targetPath, status: "succeeded" as const };
        try {
            const actualAfter = await this.readFreshFile(operation.fileIdentity);
            if (!this.isExecutionActive(lifecycleEpoch)) return { ...base, receiptId: this.createId(), undoAvailable: false };
            const receipt = this.undoStore.create({ intentId: intent.id, operationId: operation.id,
                path: operation.targetPath, kind: "vault_move", before: operation.expectedBefore, expectedAfter: actualAfter,
                move: { originalPath: operation.sourcePath, fileIdentity: operation.fileIdentity,
                    ...(operation.fileIdentity.stat ? { fileVersion: Object.freeze({ ...operation.fileIdentity.stat }) } : {}) } });
            return { ...base, receiptId: receipt.id, undoAvailable: true };
        } catch {
            return { ...base, receiptId: this.createId(), undoAvailable: false, failureCategory: "undo_unavailable",
                message: "The note moved, but its actual post-move content could not be read for Undo." };
        }
    }

    private async undoMove(receipt: UndoReceipt): Promise<UndoResult> {
        const base = { receiptId: receipt.id, operationId: receipt.operationId, path: receipt.path };
        const move = receipt.move;
        if (!move || !this.renameFile) return { ...base, status: "unavailable", failureCategory: "undo_unavailable" };
        this.assertPathAllowed(move.originalPath);
        const file = this.resolveFile(receipt.path);
        const version = move.fileVersion ?? (file?.stat ? { ...file.stat } : undefined);
        if (file !== move.fileIdentity || !file || await this.readFreshFile(file) !== receipt.expectedAfter) throw new StaleTargetError("The moved note changed after the move.");
        await this.assertMoveDestination(file, move.originalPath);
        await this.assertMoveBaseline(file, receipt.expectedAfter, version);
        this.assertUsable();
        this.assertPathAllowed(receipt.path);
        this.assertPathAllowed(move.originalPath);
        if (this.resolveFile(receipt.path) !== file) throw new StaleTargetError();
        this.markSelfWrite?.(receipt.path);
        this.markSelfWrite?.(move.originalPath);
        try {
            await this.renameFile(file, move.originalPath);
        } catch (error) {
            if (!this.isMoveApplied(file, receipt.path, move.originalPath)) return { ...base, status: "unknown", failureCategory: "unknown", message: safeError(error, "Move recovery result is unknown.") };
        }
        return this.isMoveApplied(file, receipt.path, move.originalPath)
            ? { ...base, status: "undone", undoAvailable: false }
            : { ...base, status: "unknown", failureCategory: "unknown" };
    }

    private async assertMoveBaseline(file: OperationsVaultFile, content: string,
        version: OperationsVaultFile["stat"]): Promise<void> {
        if (version && file.stat) {
            if (file.stat.mtime !== version.mtime || file.stat.size !== version.size) throw new StaleTargetError();
        } else if (await this.readFreshFile(file) !== content) {
            throw new StaleTargetError();
        }
    }

    private async prepareImageRecovery(operation: PreparedOperation & { kind: "note_image_removal" }): Promise<PreparedImageRecovery> {
        const host = this.noteImageRemovalHost;
        const proposal = this.noteImageProposals.get(operation.id);
        if (!host?.readAttachmentFile || !this.noteImageRemovalResources || !proposal) {
            throw new OperationsControllerError("undo_unavailable", "Temporary image recovery is unavailable.");
        }
        if (!proposal.revalidate() || !host.isAttachmentPathAllowed(proposal.attachment.path)) {
            throw new OperationsControllerError("boundary_denied", "The selected image recovery source is unavailable.");
        }
        const reservation = this.noteImageRemovalResources.reserve(proposal.attachment.version.size, this.createId);
        try {
            const read = await host.readAttachmentFile(proposal.attachment);
            this.assertUsable();
            const bytes = read instanceof Uint8Array ? read.slice().buffer : read.slice(0);
            const current = host.getAttachmentFileByPath?.(proposal.attachment.path);
            if (!proposal.revalidate()) throw new OperationsControllerError("boundary_denied", "The selected image source authority changed during recovery preparation.");
            if (!current || current.file !== proposal.attachment.file
                || current.version.mtime !== proposal.attachment.version.mtime || current.version.size !== proposal.attachment.version.size
                || bytes.byteLength !== proposal.attachment.version.size) throw new StaleTargetError("The selected attachment changed while its recovery snapshot was prepared.");
            const contentHash = await imageSourceHash(bytes);
            this.assertUsable();
            return { bytes, contentHash, reservation };
        } catch (error) {
            reservation.release();
            throw error;
        }
    }

    private async executeNoteImageRemoval(
        intent: OperationsIntent,
        operation: PreparedOperation & { kind: "note_image_removal" },
        lifecycleEpoch: number,
        assertBeforeEffect: (afterSelfWrite?: boolean) => void,
        preparedRecovery?: PreparedImageRecovery,
    ): Promise<OperationExecutionResult> {
        if (!this.noteImageRemovalHost) {
            return this.noteImageFailure(operation, [], "failed", "boundary_denied", "The note-image Host boundary is unavailable.");
        }
        const proposal = this.noteImageProposals.get(operation.id);
        if (!proposal) {
            return this.noteImageFailure(operation, [], "failed", "unknown", "The staged note-image evidence is unavailable.");
        }

        const effects: NoteImageRemovalEffectResult[] = [
            { key: "note", status: "not_started" },
            {
                key: "attachment",
                status: "not_started",
                ...(operation.input.attachmentAction === "keep"
                    ? {}
                    : {}),
            },
        ];
        let bytes: ArrayBuffer | undefined;
        let contentHash: string | undefined;
        let reservation: import("./note-image-removal-resources").NoteImageRemovalReservation | undefined = preparedRecovery?.reservation;
        let receiptId: string | undefined;
        let noteApplied = false;
        let executionLease = false;
        let noteWriteAttempted = false;
        let trashAttempted = false;
        let readAttachmentFile: NonNullable<NoteImageRemovalHost["readAttachmentFile"]> | undefined;

        try {
            assertBeforeEffect();
            if (!proposal.revalidate()) {
                throw new OperationsControllerError("boundary_denied", "The staged note-image source evidence is no longer current.");
            }
            const before = await this.readNoteImageSource(operation.path);
            if (before.source.file !== proposal.note.file
                || before.source.version.mtime !== proposal.note.version.mtime
                || before.source.version.size !== proposal.note.version.size
                || before.content !== operation.expectedBefore) {
                throw new StaleTargetError("The selected note changed after preview.");
            }
            assertBeforeEffect();

            if (operation.input.attachmentAction === "delete") {
                const guard = createRetainedNoteImageReadGuard(this.noteImageRemovalHost, proposal);
                const preScan = await verifyNoteImageReferenceCoverage({
                    host: this.noteImageRemovalHost,
                    guard,
                    sourceValidity: proposal.sourceValidity,
                    selectedNote: before.source,
                    selectedAttachmentPath: proposal.attachment.path,
                    expectedAfter: operation.expectedAfter,
                });
                if (preScan.conflicts.length) {
                    throw new OperationsControllerError("boundary_denied", "Another reference now uses the selected attachment.");
                }
                if (!preScan.coverage.complete) {
                    throw new OperationsControllerError("boundary_denied", `Reference coverage is incomplete: ${preScan.coverage.reason ?? "unknown"}`);
                }
                if (!this.noteImageRemovalResources || !this.noteImageRemovalHost.readAttachmentFile) {
                    throw new OperationsControllerError("undo_unavailable", "Temporary image recovery is unavailable.");
                }
                readAttachmentFile = this.noteImageRemovalHost.readAttachmentFile;
                if (!this.noteImageRemovalHost.isAttachmentPathAllowed(proposal.attachment.path)) {
                    throw new OperationsControllerError("boundary_denied", "The selected attachment is no longer allowed.");
                }
                const exactAttachment = this.noteImageRemovalHost.getAttachmentFileByPath?.(proposal.attachment.path);
                if (!exactAttachment || exactAttachment.file !== proposal.attachment.file
                    || exactAttachment.version.mtime !== proposal.attachment.version.mtime
                    || exactAttachment.version.size !== proposal.attachment.version.size) {
                    throw new StaleTargetError("The selected attachment changed after preview.");
                }
                reservation ??= this.noteImageRemovalResources.reserve(
                    proposal.attachment.version.size,
                    this.createId,
                );
                const readBytes = preparedRecovery?.bytes ?? await readAttachmentFile(proposal.attachment);
                bytes = readBytes instanceof Uint8Array
                    ? readBytes.slice().buffer
                    : readBytes.slice(0);
                if (bytes.byteLength !== proposal.attachment.version.size) {
                    throw new StaleTargetError("The selected attachment changed while being read.");
                }
                const postReadAttachment = this.noteImageRemovalHost.getAttachmentFileByPath?.(proposal.attachment.path);
                if (!postReadAttachment || postReadAttachment.file !== proposal.attachment.file
                    || postReadAttachment.version.mtime !== proposal.attachment.version.mtime
                    || postReadAttachment.version.size !== proposal.attachment.version.size) {
                    throw new StaleTargetError("The selected attachment changed while being read.");
                }
                contentHash = await imageSourceHash(bytes);
                if (preparedRecovery && contentHash !== preparedRecovery.contentHash) throw new StaleTargetError();
                assertBeforeEffect();
                if (!proposal.revalidate()) {
                    throw new OperationsControllerError("boundary_denied", "The staged source authority changed while the attachment was prepared.");
                }
                if (!this.noteImageRemovalHost.isAttachmentPathAllowed(proposal.attachment.path)) {
                    throw new OperationsControllerError("boundary_denied", "The selected attachment is no longer allowed.");
                }
                const preparedAttachment = this.noteImageRemovalHost.getAttachmentFileByPath?.(proposal.attachment.path);
                if (!preparedAttachment || preparedAttachment.file !== proposal.attachment.file
                    || preparedAttachment.version.mtime !== proposal.attachment.version.mtime
                    || preparedAttachment.version.size !== proposal.attachment.version.size) {
                    throw new StaleTargetError("The selected attachment changed while its recovery snapshot was prepared.");
                }
                const verifyBytes = await readAttachmentFile(proposal.attachment);
                const verifyBuffer = verifyBytes instanceof Uint8Array
                    ? verifyBytes.slice().buffer
                    : verifyBytes.slice(0);
                if (verifyBuffer.byteLength !== bytes.byteLength
                    || await imageSourceHash(verifyBuffer) !== contentHash) {
                    throw new StaleTargetError("The selected attachment changed while its recovery snapshot was prepared.");
                }
                if (!proposal.revalidate()) {
                    throw new OperationsControllerError("boundary_denied", "The staged source authority changed before the note write.");
                }
                if (!this.noteImageRemovalHost.isAttachmentPathAllowed(proposal.attachment.path)) {
                    throw new OperationsControllerError("boundary_denied", "The selected attachment is no longer allowed.");
                }
                const finalPreNoteAttachment = this.noteImageRemovalHost.getAttachmentFileByPath?.(proposal.attachment.path);
                if (!finalPreNoteAttachment || finalPreNoteAttachment.file !== proposal.attachment.file
                    || finalPreNoteAttachment.version.mtime !== proposal.attachment.version.mtime
                    || finalPreNoteAttachment.version.size !== proposal.attachment.version.size) {
                    throw new StaleTargetError("The selected attachment changed before the note write.");
                }
            }

            assertBeforeEffect();
            if (!proposal.revalidate()) {
                throw new OperationsControllerError("boundary_denied", "The original source is no longer current before the note write.");
            }
            const noteFile = this.vault.getAbstractFileByPath(operation.path);
            if (!noteFile) throw new StaleTargetError("The selected note no longer exists.");
            this.markSelfWrite?.(operation.path);
            await this.vault.process(noteFile, current => {
                assertBeforeEffect();
                if (current !== operation.expectedBefore) throw new StaleTargetError();
                noteWriteAttempted = true;
                return operation.expectedAfter;
            });
            if (!this.isExecutionActive(lifecycleEpoch)) {
                reservation?.release();
                receiptId = this.createId();
                noteApplied = true;
                effects[0] = { key: "note", status: "applied" };
                effects[1] = { key: "attachment", status: "not_started" };
                return this.noteImageResult(operation,
                    operation.input.attachmentAction === "keep" ? "succeeded" : "partial", effects, receiptId, false);
            }
            noteApplied = true;
            proposal.markNoteApplied();

            const receipt = this.undoStore.create({
                intentId: intent.id,
                operationId: operation.id,
                path: operation.path,
                kind: operation.name,
                before: operation.expectedBefore,
                expectedAfter: operation.expectedAfter,
            });
            receiptId = receipt.id;
            effects[0] = { key: "note", status: "applied" };

            if (operation.input.attachmentAction === "keep") {
                return this.noteImageResult(
                    operation,
                    "succeeded",
                    [effects[0]],
                    receipt.id,
                    true,
                );
            }

            if (!this.noteImageRemovalResources || !bytes || !contentHash || !reservation) {
                throw new OperationsControllerError("undo_unavailable", "Temporary image recovery is unavailable.");
            }
            this.noteImageRemovalResources.retain(reservation, {
                receiptId: receipt.id,
                bytes,
                contentHash,
                attachment: proposal.attachment,
                expiresAt: receipt.expiresAt,
            });
            reservation = undefined;
            bytes = undefined;
            const recoverySnapshot = this.noteImageRemovalResources.acquire(receipt.id);
            executionLease = true;

            assertBeforeEffect(true);
            const after = await this.readNoteImageSource(operation.path);
            if (!proposal.revalidateAfterSelfWrite()) {
                effects[1] = { key: "attachment", status: "failed", failureCategory: "boundary_denied", message: "The staged source authority changed after the note was applied." };
                return this.noteImageResult(operation, "partial", effects, receipt.id, true);
            }
            const postGuard = createRetainedNoteImageReadGuard(
                this.noteImageRemovalHost,
                proposal,
                "after_self_write",
            );
            const postScan = await verifyNoteImageReferenceCoverage({
                host: this.noteImageRemovalHost,
                guard: postGuard,
                sourceValidity: proposal.sourceAuthority,
                selectedNote: after.source,
                selectedAttachmentPath: proposal.attachment.path,
                expectedAfter: after.content,
            });
            if (postScan.conflicts.length || !postScan.coverage.complete) {
                effects[1] = {
                    key: "attachment",
                    status: "failed",
                    failureCategory: "boundary_denied",
                    message: postScan.conflicts.length
                        ? "A new reference stopped attachment deletion."
                        : `Reference coverage became incomplete: ${postScan.coverage.reason ?? "unknown"}`,
                };
                return this.noteImageResult(operation, "partial", effects, receipt.id, true);
            }
            if (!this.isExecutionActive(lifecycleEpoch) || !proposal.revalidateAfterSelfWrite()) {
                effects[1] = { key: "attachment", status: "not_started" };
                return this.noteImageResult(operation, "partial", effects, receipt.id, false);
            }

            const trashTarget = this.noteImageRemovalHost.getAttachmentFileByPath?.(proposal.attachment.path);
            if (!trashTarget || trashTarget.file !== proposal.attachment.file
                || trashTarget.version.mtime !== proposal.attachment.version.mtime
                || trashTarget.version.size !== proposal.attachment.version.size
                || !this.noteImageRemovalHost.isAttachmentPathAllowed(proposal.attachment.path)) {
                effects[1] = { key: "attachment", status: "failed", failureCategory: "stale_target" };
                return this.noteImageResult(operation, "partial", effects, receipt.id, true);
            }
            if (!readAttachmentFile) {
                effects[1] = { key: "attachment", status: "failed", failureCategory: "undo_unavailable" };
                return this.noteImageResult(operation, "partial", effects, receipt.id, false);
            }
            const finalBytes = await readAttachmentFile(proposal.attachment);
            const finalBuffer = finalBytes instanceof Uint8Array
                ? finalBytes.slice().buffer
                : finalBytes.slice(0);
            if (finalBuffer.byteLength !== recoverySnapshot.bytes.byteLength
                || await imageSourceHash(finalBuffer) !== recoverySnapshot.contentHash) {
                effects[1] = { key: "attachment", status: "failed", failureCategory: "stale_target" };
                return this.noteImageResult(operation, "partial", effects, receipt.id, true);
            }
            if (!proposal.revalidateAfterSelfWrite()
                || !this.noteImageRemovalHost.isAttachmentPathAllowed(proposal.attachment.path)) {
                effects[1] = { key: "attachment", status: "failed", failureCategory: "boundary_denied" };
                return this.noteImageResult(operation, "partial", effects, receipt.id, false);
            }
            const finalPreTrashAttachment = this.noteImageRemovalHost.getAttachmentFileByPath?.(proposal.attachment.path);
            if (!finalPreTrashAttachment || finalPreTrashAttachment.file !== proposal.attachment.file
                || finalPreTrashAttachment.version.mtime !== proposal.attachment.version.mtime
                || finalPreTrashAttachment.version.size !== proposal.attachment.version.size) {
                effects[1] = { key: "attachment", status: "failed", failureCategory: "stale_target" };
                return this.noteImageResult(operation, "partial", effects, receipt.id, true);
            }
            if (!this.isExecutionActive(lifecycleEpoch)) {
                effects[1] = { key: "attachment", status: "not_started" };
                return this.noteImageResult(operation, "partial", effects, receipt.id, false);
            }
            assertBeforeEffect(true);
            this.markSelfWrite?.(proposal.attachment.path);
            trashAttempted = true;
            await this.trashFile(proposal.attachment.file as unknown as OperationsVaultFile);
            const remained = this.noteImageRemovalHost.getAttachmentFileByPath?.(proposal.attachment.path);
            if (remained) {
                effects[1] = {
                    key: "attachment",
                    status: "failed",
                    failureCategory: "fs_error",
                    message: "The attachment is still present after deletion.",
                };
                return this.noteImageResult(operation, "partial", effects, receipt.id, true);
            }
            if (!this.isExecutionActive(lifecycleEpoch)) {
                effects[1] = { key: "attachment", status: "removed" };
                return this.noteImageResult(operation, "succeeded", effects, receipt.id, false);
            }
            effects[1] = { key: "attachment", status: "removed" };
            return this.noteImageResult(operation, "succeeded", effects, receipt.id, true);
        } catch (error) {
            if (reservation) reservation.release();
            if (!this.isExecutionActive(lifecycleEpoch)) {
                if (noteApplied) {
                    effects[0] = { key: "note", status: "applied" };
                    effects[1] = { key: "attachment", status: trashAttempted ? "unknown" : "not_started",
                        ...(trashAttempted ? { failureCategory: "unknown" as const } : {}) };
                    return this.noteImageResult(
                        operation,
                        trashAttempted ? "unknown" : "partial",
                        effects,
                        receiptId,
                        receiptId !== undefined && this.noteImageRemovalResources?.has(receiptId) === true,
                    );
                }
                effects[0] = { key: "note", status: noteWriteAttempted ? "unknown" : "not_started" };
                effects[1] = { key: "attachment", status: "not_started" };
                return this.noteImageResult(operation, noteWriteAttempted ? "unknown" : "failed", effects, receiptId, false);
            }
            const normalized = normalizeExecutionError(error);
            if (noteApplied) {
                effects[0] = { key: "note", status: "applied" };
                effects[1] = {
                    key: "attachment",
                    status: trashAttempted ? "unknown" : "failed",
                    failureCategory: normalized.category,
                    message: normalized.message,
                };
                return this.noteImageResult(
                    operation,
                    effects[1].status === "failed" ? "partial" : "unknown",
                    effects,
                    receiptId,
                    receiptId !== undefined && this.noteImageRemovalResources?.has(receiptId) === true,
                );
            }
            effects[0] = {
                key: "note",
                status: !noteWriteAttempted || normalized.category === "stale_target" ? "failed" : "unknown",
                failureCategory: normalized.category,
                message: normalized.message,
            };
            effects[1] = { key: "attachment", status: "failed", failureCategory: normalized.category, message: normalized.message };
            return this.noteImageResult(
                operation,
                effects[0].status === "failed" ? "failed" : "unknown",
                effects,
            );
        }
        finally {
            if (executionLease) this.noteImageRemovalResources?.releaseLease(receiptId!);
        }
    }

    private async readNoteImageSource(path: string): Promise<{
        source: import("./note-image-removal").NoteImageRemovalSourceFile;
        content: string;
    }> {
        if (!this.noteImageRemovalHost) throw new OperationsControllerError("boundary_denied", "The note-image Host boundary is unavailable.");
        const source = this.noteImageRemovalHost.getSourceFile(path);
        if (!source) throw new StaleTargetError("The selected note no longer exists.");
        const content = await this.noteImageRemovalHost.readSourceFile(source);
        return { source, content };
    }

    private noteImageFailure(
        operation: PreparedOperation & { kind: "note_image_removal" },
        effects: NoteImageRemovalEffectResult[],
        status: OperationExecutionResult["status"],
        failureCategory: OperationsFailureCategory,
        message: string,
    ): OperationExecutionResult {
        return this.noteImageResult(operation, status, [
            effects[0] ?? { key: "note", status: "failed", failureCategory, message },
            effects[1] ?? { key: "attachment", status: "failed", failureCategory, message },
        ], undefined, false, failureCategory, message);
    }

    private noteImageResult(
        operation: PreparedOperation & { kind: "note_image_removal" },
        status: OperationExecutionResult["status"],
        effects: readonly NoteImageRemovalEffectResult[],
        receiptId?: string,
        undoAvailable = false,
        failureCategory?: OperationsFailureCategory,
        message?: string,
    ): OperationExecutionResult {
        return {
            operationId: operation.id,
            toolCallId: operation.toolCallId,
            name: operation.name,
            path: operation.path,
            status,
            ...(failureCategory ? { failureCategory } : {}),
            ...(message ? { message } : {}),
            ...(receiptId ? { receiptId } : {}),
            effects: Object.freeze(effects.filter(effect => operation.input.attachmentAction === "delete" || effect.key === "note")
                .map(effect => Object.freeze({ ...effect }))),
            ...(receiptId ? { undoAvailable } : {}),
        };
    }

    private async executeCreate(
        operation: PreparedMarkdownOperation,
        assertBeforeEffect: () => void,
        markWriteAttempted: () => void,
    ): Promise<void> {
        if (await this.pathExists(operation.path)) {
            throw new OperationsControllerError("target_collision", `Target already exists: ${operation.path}.`);
        }
        assertBeforeEffect();
        const parent = parentVaultPath(operation.path);
        if (parent && !this.resolveFolder(parent)) {
            throw new OperationsControllerError("parent_missing", `Parent folder no longer exists: ${parent}.`);
        }
        assertBeforeEffect();
        this.markSelfWrite?.(operation.path);
        markWriteAttempted();
        await this.vault.create(operation.path, operation.expectedAfter);
    }

    private async executeExisting(
        operation: PreparedMarkdownOperation,
        assertBeforeEffect: () => void,
        markWriteAttempted: () => void,
    ): Promise<void> {
        const file = this.resolveFile(operation.path);
        if (!file) throw new StaleTargetError("The target note no longer exists.");
        this.markSelfWrite?.(operation.path);
        await this.vault.process(file, (current) => {
            assertBeforeEffect();
            if (current !== operation.expectedBefore) throw new StaleTargetError();
            markWriteAttempted();
            return operation.expectedAfter;
        });
    }

    private async undoCreate(receipt: UndoReceipt): Promise<void> {
        const file = this.resolveFile(receipt.path);
        if (!file) throw new StaleTargetError("The created note no longer exists.");
        const current = await this.readFreshFile(file);
        if (current !== receipt.expectedAfter) throw new StaleTargetError("The created note changed and cannot be undone safely.");
        this.markSelfWrite?.(receipt.path);
        await this.trashFile(file);
    }

    private async undoExisting(receipt: UndoReceipt): Promise<void> {
        if (receipt.before === null) throw new OperationsControllerError("undo_unavailable", "Undo baseline is unavailable.");
        const file = this.resolveFile(receipt.path);
        if (!file) throw new StaleTargetError("The target note no longer exists.");
        this.markSelfWrite?.(receipt.path);
        await this.vault.process(file, (current) => {
            if (current !== receipt.expectedAfter) throw new StaleTargetError("The note changed after the write and cannot be undone safely.");
            return receipt.before!;
        });
    }

    private async readInitialTarget(
        path: string,
        readContent: boolean,
        assertReadAllowed: () => void,
    ): Promise<VirtualTarget> {
        assertReadAllowed();
        const file = this.resolveFile(path);
        assertReadAllowed();
        if (file) {
            const content = readContent ? await this.readFile(file) : null;
            assertReadAllowed();
            return { exists: true, content };
        }
        const exists = await this.vault.adapter.exists(path);
        assertReadAllowed();
        if (exists) {
            throw new OperationsControllerError("target_missing", `Target is not a readable Markdown note: ${path}.`);
        }
        return { exists: false, content: null };
    }

    private resolveFile(path: string): OperationsVaultFile | null {
        const file = this.vault.getAbstractFileByPath(path);
        if (file?.path !== path) return null;
        if (Array.isArray(file.children)) return null;
        if (typeof file.extension === "string" && file.extension.toLowerCase() !== "md") return null;
        return file;
    }

    private resolveFolder(path: string): OperationsVaultFile | null {
        const folder = this.vault.getAbstractFileByPath(path);
        if (folder?.path !== path || !Array.isArray(folder.children)) return null;
        return folder;
    }

    private async readFile(file: OperationsVaultFile): Promise<string> {
        if (this.vault.cachedRead) return await this.vault.cachedRead(file);
        if (this.vault.read) return await this.vault.read(file);
        if (this.vault.adapter.read) return await this.vault.adapter.read(file.path);
        throw new OperationsControllerError("fs_error", "Vault read is unavailable.");
    }

    private async readFreshFile(file: OperationsVaultFile): Promise<string> {
        if (this.vault.read) return await this.vault.read(file);
        if (this.vault.adapter.read) return await this.vault.adapter.read(file.path);
        throw new OperationsControllerError("fs_error", "Fresh vault read is unavailable.");
    }

    private async pathExists(path: string): Promise<boolean> {
        return this.vault.getAbstractFileByPath(path) !== null || await this.vault.adapter.exists(path);
    }

    private assertPathAllowed(path: string): void {
        if (!this.isPathAllowed) return;
        let allowed = false;
        try {
            allowed = this.isPathAllowed(path) === true;
        } catch {
            allowed = false;
        }
        if (!allowed) throw new OperationsControllerError("boundary_denied", `Target is outside the current Data Boundary: ${path}.`);
    }

    private requirePendingIntent(intentId: string): OperationsIntent {
        const intent = this.getIntent(intentId);
        if (!intent) {
            if (this.expiredIntentIds.has(intentId)) {
                throw new OperationsControllerError("expired", "Intent has expired.");
            }
            const terminal = this.terminalStates.get(intentId)?.state;
            if (terminal === "cancelled") throw new OperationsControllerError("cancelled", "Intent was cancelled.");
            if (terminal) throw new OperationsControllerError("already_executed", "Intent has already finished.");
            throw new OperationsControllerError("expired", "Intent is missing or expired.");
        }
        if (intent.state !== "pending") throw new OperationsControllerError("already_executed", "Intent is not pending.");
        return intent;
    }

    private scheduleExpiration(intent: OperationsIntent): void {
        const timer = setTimeout(() => this.expireIntent(intent.id), Math.max(0, intent.expiresAt - this.now()));
        if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") timer.unref();
        this.expirationTimers.set(intent.id, timer);
    }

    private expireIntent(intentId: string): void {
        const intent = this.intents.get(intentId);
        if (!intent || intent.state !== "pending") return;
        this.clearExpiration(intentId);
        this.intents.delete(intentId);
        this.expiredIntentIds.set(intentId, intent.runId);
        this.emit({ type: "intent-expired", intentId });
    }

    private pruneExpiredIntents(): void {
        const now = this.now();
        for (const intent of this.intents.values()) {
            if (intent.state === "pending" && intent.expiresAt <= now) this.expireIntent(intent.id);
        }
    }

    private clearExpiration(intentId: string): void {
        const timer = this.expirationTimers.get(intentId);
        if (timer !== undefined) clearTimeout(timer);
        this.expirationTimers.delete(intentId);
    }

    private emit(event: OperationsControllerEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // UI observers cannot break the safety controller.
            }
        }
    }

    private assertUsable(): void {
        if (this.disposed) throw new OperationsControllerError("cancelled", "Operations controller is disposed.");
    }

    private assertStageActive(
        signal: AbortSignal | undefined,
        lifecycleEpoch: number,
        taskSourceReadGuard?: TaskSourceReadGuard,
    ): void {
        if (signal?.aborted) {
            throw new OperationsControllerError("cancelled", "Operations staging was cancelled.");
        }
        if (this.disposed || lifecycleEpoch !== this.lifecycleEpoch) {
            throw new OperationsControllerError("cancelled", "Operations controller was disposed during staging.");
        }
        try {
            assertTaskSourceReadCurrent(taskSourceReadGuard);
        } catch {
            throw new OperationsControllerError("boundary_denied", "The task source scope changed during Operations staging.");
        }
    }

    private isExecutionActive(lifecycleEpoch: number): boolean {
        return !this.disposed && lifecycleEpoch === this.lifecycleEpoch;
    }

    private assertExecutionActive(lifecycleEpoch: number): void {
        if (!this.isExecutionActive(lifecycleEpoch)) {
            throw new OperationsControllerError("cancelled", "Operations execution was cancelled because the controller was disposed.");
        }
    }
}

function freezeIntent(intent: OperationsIntent): OperationsIntent {
    return Object.freeze({ ...intent, operations: Object.freeze([...intent.operations]) });
}

function replaceIntentState(intent: OperationsIntent, state: OperationsIntentState): OperationsIntent {
    return freezeIntent({ ...intent, state });
}

function deepFreeze<Op extends PreparedOperation>(operation: Op): Op {
    freezeUnknown(operation.input);
    return Object.freeze(operation);
}

function freezeUnknown(value: unknown): void {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
    for (const nested of Object.values(value)) freezeUnknown(nested);
    Object.freeze(value);
}

function normalizeStageError(error: unknown): OperationsControllerError {
    if (error instanceof OperationsControllerError) return error;
    if (error instanceof OperationsResourceError) return new OperationsControllerError(error.category, error.message);
    if (error instanceof OperationsValidationError) return new OperationsControllerError("schema_invalid", error.message);
    if (error instanceof OperationsPathError) return new OperationsControllerError("path_rejected", error.message);
    if (error instanceof OperationsTransformError) return new OperationsControllerError("transform_failed", error.message);
    return new OperationsControllerError("fs_error", safeError(error, "Operations staging failed."));
}

function normalizeExecutionError(error: unknown): OperationsControllerError {
    if (error instanceof OperationsControllerError) return error;
    if (error instanceof OperationsResourceError) return new OperationsControllerError(error.category, error.message);
    return new OperationsControllerError("fs_error", safeError(error, "Vault operation failed."));
}

function safeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function defaultId(): string {
    return getPlatformCrypto()?.randomUUID?.() ?? `operations-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

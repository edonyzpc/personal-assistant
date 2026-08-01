import {
    MAX_INTENT_GENERATED_CHARS,
    MAX_INTENT_OPERATIONS,
    MAX_OPERATION_RESULT_GROWTH_CHARS,
    OperationsValidationError,
    isCoreWriteToolName,
    validateCoreWriteInput,
} from "./input-validation";
import type { AuditWriteResult, OperationsAuditStore } from "./operations-audit-store";
import { OperationsUndoStore } from "./operations-undo-store";
import type {
    CoreWriteInput,
    CoreWriteToolName,
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
    PreparedOperation,
    StageOperationsIntentInput,
    UndoReceipt,
    UndoResult,
    VaultAppendInput,
    VaultCreateInput,
    VaultProcessInput,
} from "./types";
import { OperationsPathError, parentVaultPath, validateOperationsVaultPath } from "./vault-path";
import {
    type FrontmatterCodec,
    OperationsTransformError,
    appendMarkdown,
    planLiteralReplacement,
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
    auditStore?: OperationsAuditStore;
    undoStore?: OperationsUndoStore;
    isPathAllowed?: (path: string) => boolean;
    markSelfWrite?: (path: string) => void;
    frontmatterCodec?: FrontmatterCodec;
    now?: () => number;
    createId?: () => string;
    pendingTtlMs?: number;
    onEvent?: OperationsEventListener;
}

interface VirtualTarget {
    exists: boolean;
    content: string | null;
}

/**
 * Memory-only staging/execution boundary used by both the runtime wrapper and
 * Chat inline card. No method except executeIntent/undo can mutate the vault.
 */
export class OperationsIntentController {
    private readonly vault: OperationsVault;
    private readonly trashFile: (file: OperationsVaultFile) => Promise<void>;
    private readonly auditStore?: OperationsAuditStore;
    private readonly undoStore: OperationsUndoStore;
    private readonly isPathAllowed?: (path: string) => boolean;
    private readonly markSelfWrite?: (path: string) => void;
    private readonly frontmatterCodec?: FrontmatterCodec;
    private readonly now: () => number;
    private readonly createId: () => string;
    private readonly pendingTtlMs: number;
    private readonly listeners = new Set<OperationsEventListener>();
    private readonly intents = new Map<string, OperationsIntent>();
    private readonly terminalStates = new Map<string, OperationsIntentState>();
    private readonly expiredIntentIds = new Set<string>();
    private readonly expirationTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private disposed = false;
    private lifecycleEpoch = 0;

    constructor(options: OperationsIntentControllerOptions) {
        this.vault = options.vault;
        this.trashFile = options.trashFile;
        this.auditStore = options.auditStore;
        this.undoStore = options.undoStore ?? new OperationsUndoStore({ now: options.now });
        this.isPathAllowed = options.isPathAllowed;
        this.markSelfWrite = options.markSelfWrite;
        this.frontmatterCodec = options.frontmatterCodec;
        this.now = options.now ?? Date.now;
        this.createId = options.createId ?? defaultId;
        this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_INTENT_TTL_MS;
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
        this.assertStageActive(signal, lifecycleEpoch);
        if (!input.runId || !input.turnId) {
            throw new OperationsControllerError("schema_invalid", "runId and turnId are required.");
        }
        if (input.operations.length < 1 || input.operations.length > MAX_INTENT_OPERATIONS) {
            throw new OperationsControllerError(
                "schema_invalid",
                `An intent must contain 1-${MAX_INTENT_OPERATIONS} operations.`,
            );
        }
        const toolCallIds = new Set<string>();
        const virtualTargets = new Map<string, VirtualTarget>();
        const prepared: PreparedOperation[] = [];
        let generatedChars = 0;

        for (const call of input.operations) {
            if (!call.toolCallId || toolCallIds.has(call.toolCallId)) {
                throw new OperationsControllerError("schema_invalid", "Tool call ids must be non-empty and unique per intent.");
            }
            toolCallIds.add(call.toolCallId);
            if (!isCoreWriteToolName(call.name as string)) {
                throw new OperationsControllerError("schema_invalid", `Unsupported Operations tool: ${String(call.name)}.`);
            }
            let validated: CoreWriteInput;
            let path: string;
            try {
                validated = validateCoreWriteInput(call.name, call.input);
                path = validateOperationsVaultPath(validated.path);
            } catch (error) {
                throw normalizeStageError(error);
            }
            this.assertPathAllowed(path);
            const normalizedInput = Object.freeze({ ...validated, path }) as CoreWriteInput;
            let target = virtualTargets.get(path);
            if (!target) {
                target = await this.readInitialTarget(path, call.name !== "vault_create");
                this.assertStageActive(signal, lifecycleEpoch);
                virtualTargets.set(path, target);
            }
            const expectedBefore = target.exists ? target.content : null;
            let expectedAfter: string;
            try {
                expectedAfter = await this.prepareExpectedAfter(call.name, normalizedInput, path, target);
                this.assertStageActive(signal, lifecycleEpoch);
                assertExpectedAfterGrowth(expectedBefore, expectedAfter);
                generatedChars += countPreparedGeneratedCharacters(
                    call.name,
                    normalizedInput,
                    expectedBefore,
                );
                if (generatedChars > MAX_INTENT_GENERATED_CHARS) {
                    throw new OperationsControllerError(
                        "schema_invalid",
                        `Intent generated content exceeds ${MAX_INTENT_GENERATED_CHARS} characters.`,
                    );
                }
            } catch (error) {
                throw normalizeStageError(error);
            }

            target.exists = true;
            target.content = expectedAfter;
            prepared.push(deepFreeze({
                id: this.createId(),
                toolCallId: call.toolCallId,
                name: call.name,
                input: normalizedInput,
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
        });
        this.assertStageActive(signal, lifecycleEpoch);
        this.intents.set(intent.id, intent);
        try {
            this.assertStageActive(signal, lifecycleEpoch);
            this.scheduleExpiration(intent);
            this.assertStageActive(signal, lifecycleEpoch);
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

    listPendingIntents(): OperationsIntent[] {
        this.pruneExpiredIntents();
        return [...this.intents.values()].filter((intent) => intent.state === "pending");
    }

    cancelIntent(intentId: string): OperationsIntent {
        this.assertUsable();
        const intent = this.requirePendingIntent(intentId);
        this.clearExpiration(intentId);
        const cancelled = replaceIntentState(intent, "cancelled");
        this.intents.delete(intentId);
        this.terminalStates.set(intentId, "cancelled");
        this.emit({ type: "intent-cancelled", intent: cancelled });
        return cancelled;
    }

    async executeIntent(intentId: string): Promise<OperationsExecutionResult> {
        this.assertUsable();
        const lifecycleEpoch = this.lifecycleEpoch;
        const pending = this.requirePendingIntent(intentId);
        this.clearExpiration(intentId);
        const executing = replaceIntentState(pending, "executing");
        this.intents.set(intentId, executing);
        this.emit({ type: "intent-state-changed", intent: executing });

        const results: OperationExecutionResult[] = [];
        let stop = false;
        for (const operation of executing.operations) {
            this.assertExecutionActive(lifecycleEpoch);
            if (stop) {
                const skipped: OperationExecutionResult = {
                    operationId: operation.id,
                    toolCallId: operation.toolCallId,
                    name: operation.name,
                    path: operation.path,
                    status: "skipped",
                    message: "Skipped because an earlier operation failed.",
                };
                results.push(skipped);
                this.assertExecutionActive(lifecycleEpoch);
                this.emit({ type: "operation-result", intentId, result: skipped });
                continue;
            }

            const result = await this.executeOperation(executing, operation, lifecycleEpoch);
            this.assertExecutionActive(lifecycleEpoch);
            results.push(result);
            this.emit({ type: "operation-result", intentId, result });
            if (result.status !== "succeeded") stop = true;
        }

        const succeeded = results.filter((result) => result.status === "succeeded").length;
        const failed = results.some((result) => result.status === "failed" || result.status === "stale");
        const state: OperationsExecutionResult["state"] = failed
            ? (succeeded > 0 ? "partial" : "failed")
            : "completed";
        this.assertExecutionActive(lifecycleEpoch);
        const finalIntent = replaceIntentState(executing, state);
        this.intents.delete(intentId);
        this.terminalStates.set(intentId, state);
        this.emit({ type: "intent-state-changed", intent: finalIntent });
        const executionResult = Object.freeze({ intentId, state, operations: Object.freeze(results) });
        this.emit({ type: "intent-result", result: executionResult });
        return executionResult;
    }

    async undo(receiptId: string): Promise<UndoResult> {
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
        const startedAt = toIso(this.now());
        let result: UndoResult;
        try {
            this.assertPathAllowed(receipt.path);
            if (receipt.kind === "vault_create") await this.undoCreate(receipt);
            else await this.undoExisting(receipt);
            this.undoStore.markUsed(receipt.id);
            result = {
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

        const audit = result.failureCategory === "boundary_denied"
            ? undefined
            : await this.writeAudit({
                version: 1,
                operationId: receipt.operationId,
                intentId: receipt.intentId,
                tool: "undo",
                targetPath: receipt.path,
                status: result.status === "undone" ? "undone" : "undo_failed",
                startedAt,
                completedAt: toIso(this.now()),
                ...(result.failureCategory ? { errorCategory: result.failureCategory } : {}),
                ...(result.status === "undone"
                    ? { before: receipt.expectedAfter, after: receipt.before }
                    : {}),
            });
        attachAuditResult(result, audit);
        this.emit({ type: "undo-result", result });
        return result;
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
        this.expiredIntentIds.clear();
        this.undoStore.clear();
        this.emit({ type: "disposed" });
        this.listeners.clear();
    }

    private async prepareExpectedAfter(
        name: CoreWriteToolName,
        input: CoreWriteInput,
        path: string,
        target: VirtualTarget,
    ): Promise<string> {
        if (name === "vault_create") {
            if (target.exists) throw new OperationsControllerError("target_collision", `Target already exists: ${path}.`);
            const parent = parentVaultPath(path);
            if (parent && !this.resolveFolder(parent)) {
                throw new OperationsControllerError("parent_missing", `Parent folder does not exist: ${parent}.`);
            }
            return (input as VaultCreateInput).content;
        }
        if (!target.exists || target.content === null) {
            throw new OperationsControllerError("target_missing", `Target note does not exist: ${path}.`);
        }
        if (name === "vault_append") return appendMarkdown(target.content, (input as VaultAppendInput).content);
        if (name === "vault_process") return transformVaultProcess(target.content, input as VaultProcessInput);
        return transformFrontmatter(target.content, input as FrontmatterUpdateInput, this.frontmatterCodec);
    }

    private async executeOperation(
        intent: OperationsIntent,
        operation: PreparedOperation,
        lifecycleEpoch: number,
    ): Promise<OperationExecutionResult> {
        const startedAt = toIso(this.now());
        let result: OperationExecutionResult;
        try {
            this.assertExecutionActive(lifecycleEpoch);
            this.assertPathAllowed(operation.path);
            if (operation.name === "vault_create") {
                await this.executeCreate(operation, lifecycleEpoch);
            } else {
                await this.executeExisting(operation);
            }
            this.assertExecutionActive(lifecycleEpoch);
            const receipt = this.undoStore.create({
                intentId: intent.id,
                operationId: operation.id,
                path: operation.path,
                kind: operation.name,
                before: operation.expectedBefore,
                expectedAfter: operation.expectedAfter,
            });
            result = {
                operationId: operation.id,
                toolCallId: operation.toolCallId,
                name: operation.name,
                path: operation.path,
                status: "succeeded",
                receiptId: receipt.id,
            };
        } catch (error) {
            if (!this.isExecutionActive(lifecycleEpoch)) {
                throw new OperationsControllerError("cancelled", "Operations execution was cancelled because the controller was disposed.");
            }
            const normalized = normalizeExecutionError(error);
            result = {
                operationId: operation.id,
                toolCallId: operation.toolCallId,
                name: operation.name,
                path: operation.path,
                status: normalized.category === "stale_target" ? "stale" : "failed",
                failureCategory: normalized.category,
                message: normalized.message,
            };
        }

        const audit = result.failureCategory === "boundary_denied"
            ? undefined
            : await this.writeAudit({
                version: 1,
                operationId: operation.id,
                intentId: intent.id,
                tool: operation.name,
                targetPath: operation.path,
                status: result.status === "succeeded" ? "succeeded" : result.status === "stale" ? "stale" : "failed",
                startedAt,
                completedAt: toIso(this.now()),
                ...(result.failureCategory ? { errorCategory: result.failureCategory } : {}),
                ...(result.status === "succeeded"
                    ? { before: operation.expectedBefore, after: operation.expectedAfter }
                    : {}),
            });
        this.assertExecutionActive(lifecycleEpoch);
        attachAuditResult(result, audit);
        return result;
    }

    private async executeCreate(operation: PreparedOperation, lifecycleEpoch: number): Promise<void> {
        if (await this.pathExists(operation.path)) {
            throw new OperationsControllerError("target_collision", `Target already exists: ${operation.path}.`);
        }
        this.assertExecutionActive(lifecycleEpoch);
        const parent = parentVaultPath(operation.path);
        if (parent && !this.resolveFolder(parent)) {
            throw new OperationsControllerError("parent_missing", `Parent folder no longer exists: ${parent}.`);
        }
        this.assertExecutionActive(lifecycleEpoch);
        this.markSelfWrite?.(operation.path);
        await this.vault.create(operation.path, operation.expectedAfter);
    }

    private async executeExisting(operation: PreparedOperation): Promise<void> {
        const file = this.resolveFile(operation.path);
        if (!file) throw new StaleTargetError("The target note no longer exists.");
        this.markSelfWrite?.(operation.path);
        await this.vault.process(file, (current) => {
            if (current !== operation.expectedBefore) throw new StaleTargetError();
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

    private async readInitialTarget(path: string, readContent: boolean): Promise<VirtualTarget> {
        const file = this.resolveFile(path);
        if (file) return { exists: true, content: readContent ? await this.readFile(file) : null };
        if (await this.vault.adapter.exists(path)) {
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
            const terminal = this.terminalStates.get(intentId);
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
        this.expiredIntentIds.add(intentId);
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

    private async writeAudit(input: Parameters<OperationsAuditStore["write"]>[0]): Promise<AuditWriteResult | undefined> {
        if (!this.auditStore) return undefined;
        return await this.auditStore.write(input);
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

    private assertStageActive(signal: AbortSignal | undefined, lifecycleEpoch: number): void {
        if (signal?.aborted) {
            throw new OperationsControllerError("cancelled", "Operations staging was cancelled.");
        }
        if (this.disposed || lifecycleEpoch !== this.lifecycleEpoch) {
            throw new OperationsControllerError("cancelled", "Operations controller was disposed during staging.");
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
    if (error instanceof OperationsValidationError) return new OperationsControllerError("schema_invalid", error.message);
    if (error instanceof OperationsPathError) return new OperationsControllerError("path_rejected", error.message);
    if (error instanceof OperationsTransformError) return new OperationsControllerError("transform_failed", error.message);
    return new OperationsControllerError("fs_error", safeError(error, "Operations staging failed."));
}

function normalizeExecutionError(error: unknown): OperationsControllerError {
    if (error instanceof OperationsControllerError) return error;
    return new OperationsControllerError("fs_error", safeError(error, "Vault operation failed."));
}

function attachAuditResult(
    result: OperationExecutionResult | UndoResult,
    audit: AuditWriteResult | undefined,
): void {
    if (!audit) return;
    if (audit.retentionWarning) result.auditRetentionWarning = audit.retentionWarning;
    if (audit.ok) result.auditStatus = "written";
    else {
        result.auditStatus = "failed";
        result.auditError = audit.error ?? "Audit record could not be written.";
    }
}

function assertExpectedAfterGrowth(expectedBefore: string | null, expectedAfter: string): void {
    const beforeLength = expectedBefore?.length ?? 0;
    const growth = expectedAfter.length - beforeLength;
    if (growth > MAX_OPERATION_RESULT_GROWTH_CHARS) {
        throw new OperationsTransformError(
            `Operation result grows the note by more than ${MAX_OPERATION_RESULT_GROWTH_CHARS} characters.`,
        );
    }
}

function countPreparedGeneratedCharacters(
    name: CoreWriteToolName,
    input: CoreWriteInput,
    expectedBefore: string | null,
): number {
    if (name === "vault_create" || name === "vault_append") {
        return (input as VaultCreateInput | VaultAppendInput).content.length;
    }
    if (name === "frontmatter_update") {
        return JSON.stringify((input as FrontmatterUpdateInput).set ?? {}).length;
    }
    const process = input as VaultProcessInput;
    if (process.operation === "insert") return process.params.content.length;
    if (process.operation === "delete") return 0;
    if (expectedBefore === null) return process.params.replace.length;
    return planLiteralReplacement(
        expectedBefore,
        process.params.search,
        process.params.replace,
        process.params.occurrence ?? "first",
    ).generatedChars;
}

function toIso(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

function safeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function defaultId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `operations-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

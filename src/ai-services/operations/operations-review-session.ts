import {
    createOperationsReviewModel,
    type OperationsReviewModel,
} from "./operations-review-model";
import type {
    OperationExecutionResult,
    OperationsControllerEvent,
    OperationsExecutionResult,
    OperationsIntent,
    UndoResult,
} from "./types";

export type OperationsReviewStatus =
    | "pending"
    | "executing"
    | "completed"
    | "partial"
    | "failed"
    | "unknown"
    | "undone"
    | "cancelled"
    | "expired"
    | "discarded"
    | "unavailable";

export type OperationsReviewAction = "confirm" | "cancel" | "undo";

export interface OperationsReviewSnapshot {
    reviewId: string;
    intentId: string;
    status: OperationsReviewStatus;
    activated: boolean;
    actionInFlight: OperationsReviewAction | null;
    model: OperationsReviewModel | null;
    execution: OperationsExecutionResult | null;
    operationResults: readonly OperationExecutionResult[];
    undoResults: readonly UndoResult[];
    error: string | null;
}

export interface OperationsReviewSessionPort {
    confirm(intentId: string): Promise<OperationsExecutionResult>;
    cancel(intentId: string): OperationsIntent;
    undoMany(receiptIds: readonly string[]): Promise<UndoResult[]>;
    subscribe?(listener: (event: OperationsControllerEvent) => void): () => void;
}

export interface OperationsReviewSessionOptions {
    intent: OperationsIntent;
    controller: OperationsReviewSessionPort;
    sessionIdentity: string | number;
    isSourceCurrent(this: void): boolean;
    onInvalidate?(this: void, reviewId: string): void;
}

type OperationsReviewListener = (snapshot: OperationsReviewSnapshot) => void;

/** UI adapter only. OperationsIntentController remains the single write owner. */
export class OperationsReviewSession {
    readonly reviewId: string;

    private readonly intentId: string;
    private model: OperationsReviewModel | null;
    private readonly controller: OperationsReviewSessionPort;
    private readonly isSourceCurrent: () => boolean;
    private readonly onInvalidate?: (reviewId: string) => void;
    private readonly listeners = new Set<OperationsReviewListener>();
    private unsubscribe: (() => void) | null = null;
    private invalidationEpoch = 0;
    private status: OperationsReviewStatus = "pending";
    private activated = false;
    private actionInFlight: OperationsReviewAction | null = null;
    private execution: OperationsExecutionResult | null = null;
    private operationResults: OperationExecutionResult[] = [];
    private undoResults: UndoResult[] = [];
    private readonly ownedOperationIds = new Set<string>();
    private readonly ownedReceiptIds = new Set<string>();
    private error: string | null = null;

    constructor(options: OperationsReviewSessionOptions) {
        this.intentId = options.intent.id;
        this.model = createOperationsReviewModel(options.intent);
        this.controller = options.controller;
        this.isSourceCurrent = options.isSourceCurrent;
        this.onInvalidate = options.onInvalidate;
        this.reviewId = createOperationsReviewId(options.intent.id, options.sessionIdentity);
        try {
            this.unsubscribe = this.controller.subscribe?.((event) => this.handleControllerEvent(event)) ?? null;
        } catch {
            this.invalidate("unavailable");
        }
    }

    getSnapshot(): OperationsReviewSnapshot {
        return {
            reviewId: this.reviewId,
            intentId: this.intentId,
            status: this.status,
            activated: this.activated,
            actionInFlight: this.actionInFlight,
            model: this.status === "unavailable" || this.status === "discarded" ? null : this.model,
            execution: this.status === "unavailable" || this.status === "discarded" ? null : this.execution,
            operationResults: this.status === "unavailable" || this.status === "discarded"
                ? []
                : [...this.operationResults],
            undoResults: this.status === "unavailable" || this.status === "discarded"
                ? []
                : [...this.undoResults],
            error: this.error,
        };
    }

    subscribe(listener: OperationsReviewListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    activate(): void {
        if (!this.isSourceCurrent() || this.status !== "pending") return;
        this.activated = true;
        this.emit();
    }

    canConfirm(): boolean {
        return this.isSourceCurrent()
            && this.activated
            && this.status === "pending"
            && !this.model?.blockers?.length
            && this.actionInFlight === null;
    }

    canCancel(): boolean {
        return this.isSourceCurrent()
            && this.activated
            && this.status === "pending"
            && this.actionInFlight === null;
    }

    async confirm(): Promise<OperationsExecutionResult | null> {
        if (!this.canConfirm()) return null;
        const epoch = this.invalidationEpoch;
        this.actionInFlight = "confirm";
        this.status = "executing";
        this.emit();
        try {
            const result = await this.controller.confirm(this.intentId);
            if (this.isCurrentEpoch(epoch) && this.isSourceCurrent()) this.applyExecutionResult(result);
            return result;
        } catch (error) {
            if (this.isCurrentEpoch(epoch) && this.isSourceCurrent()) {
                this.error = errorText(error);
                if (this.status === "executing") this.status = "failed";
            }
            return null;
        } finally {
            if (this.isCurrentEpoch(epoch) && this.isSourceCurrent()) {
                this.actionInFlight = null;
                this.emit();
            }
        }
    }

    cancel(): OperationsIntent | null {
        if (!this.canCancel()) return null;
        this.actionInFlight = "cancel";
        try {
            const cancelled = this.controller.cancel(this.intentId);
            if (this.isSourceCurrent() && this.status === "pending") {
                this.status = "cancelled";
                this.activated = false;
            }
            return cancelled;
        } catch (error) {
            if (this.isSourceCurrent()) this.error = errorText(error);
            return null;
        } finally {
            if (this.isSourceCurrent()) {
                this.actionInFlight = null;
                this.emit();
            }
        }
    }

    async undo(receiptIds: readonly string[]): Promise<UndoResult[] | null> {
        if (!this.canUndo()) return null;
        const epoch = this.invalidationEpoch;
        this.actionInFlight = "undo";
        this.emit();
        try {
            const results = await this.controller.undoMany(receiptIds);
            if (this.isCurrentEpoch(epoch) && this.isSourceCurrent()) this.applyUndoResults(results);
            return results;
        } catch (error) {
            if (this.isCurrentEpoch(epoch) && this.isSourceCurrent()) this.error = errorText(error);
            return null;
        } finally {
            if (this.isCurrentEpoch(epoch) && this.isSourceCurrent()) {
                this.actionInFlight = null;
                this.emit();
            }
        }
    }

    async undoAll(): Promise<UndoResult[] | null> {
        return await this.undo(this.activeReceiptIds());
    }

    canUndo(): boolean {
        return this.isSourceCurrent()
            && (this.status === "completed" || this.status === "partial")
            && this.actionInFlight === null
            && this.activeReceiptIds().length > 0;
    }

    activeReceiptIds(): string[] {
        return this.operationResults
            .filter((result) => result.receiptId
                && !this.undoResults.some(candidate => candidate.receiptId === result.receiptId
                    && candidate.status === "undone")
                && result.undoAvailable !== false
                && (result.status === "succeeded"
                    || result.effects?.some(effect => effect.status === "applied" || effect.status === "removed")))
            .map((result) => result.receiptId!);
    }

    discard(): void {
        if (!this.isSourceCurrent()) {
            this.invalidate("unavailable");
            return;
        }
        if (this.status === "pending" && this.actionInFlight === null) {
            try {
                this.controller.cancel(this.intentId);
            } catch {
                // The controller already reports missing/expired intents fail-closed.
            }
        }
        this.invalidate("discarded");
    }

    invalidate(status: Exclude<OperationsReviewStatus, "pending" | "executing"> = "unavailable"): void {
        this.invalidationEpoch += 1;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.status = status;
        this.activated = false;
        this.actionInFlight = null;
        this.model = null;
        this.execution = null;
        this.operationResults = [];
        this.undoResults = [];
        this.error = null;
        const snapshot = this.getSnapshot();
        for (const listener of [...this.listeners]) listener(snapshot);
        this.listeners.clear();
        this.onInvalidate?.(this.reviewId);
    }

    private handleControllerEvent(event: OperationsControllerEvent): void {
        if (!this.isSourceCurrent()) {
            this.invalidate("unavailable");
            return;
        }
        switch (event.type) {
            case "intent-state-changed":
                if (event.intent.id !== this.intentId) return;
                if (event.intent.state === "executing") this.status = "executing";
                else if (event.intent.state === "completed") this.status = "completed";
                else if (event.intent.state === "partial") this.status = "partial";
                else if (event.intent.state === "failed") this.status = "failed";
                break;
            case "operation-result":
                if (event.intentId !== this.intentId) return;
                this.upsertOperationResult(event.result);
                break;
            case "intent-result":
                if (event.result.intentId !== this.intentId) return;
                this.applyExecutionResult(event.result);
                break;
            case "intent-cancelled":
                if (event.intent.id !== this.intentId) return;
                this.status = "cancelled";
                this.activated = false;
                break;
            case "intent-expired":
                if (event.intentId !== this.intentId) return;
                this.status = "expired";
                this.activated = false;
                break;
            case "undo-result":
                this.applyUndoResults([event.result]);
                break;
            case "disposed":
                this.invalidate("unavailable");
                return;
                break;
            default:
                return;
        }
        this.emit();
    }

    private applyExecutionResult(result: OperationsExecutionResult): void {
        if (result.intentId !== this.intentId) return;
        this.execution = result;
        this.operationResults = [...result.operations];
        for (const operation of this.operationResults) {
            this.ownedOperationIds.add(operation.operationId);
            if (operation.receiptId) this.ownedReceiptIds.add(operation.receiptId);
        }
        this.status = result.state;
    }

    private upsertOperationResult(result: OperationExecutionResult): void {
        const index = this.operationResults.findIndex((existing) => existing.operationId === result.operationId);
        if (index >= 0) this.operationResults[index] = result;
        else this.operationResults.push(result);
    }

    private applyUndoResults(results: readonly UndoResult[]): void {
        for (const result of results) {
            const isOwnedResult = this.ownedReceiptIds.has(result.receiptId)
                || (result.operationId !== undefined && this.ownedOperationIds.has(result.operationId));
            if (!isOwnedResult) continue;
            const index = this.undoResults.findIndex((existing) => existing.receiptId === result.receiptId);
            if (index >= 0) this.undoResults[index] = result;
            else this.undoResults.push(result);
            const receiptId = result.receiptId;
            const operation = this.operationResults.find((candidate) => candidate.receiptId === receiptId);
            if (operation) {
                this.operationResults[this.operationResults.indexOf(operation)] = {
                    ...operation,
                    ...(result.effects ? { effects: result.effects } : {}),
                    ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
                    undoAvailable: result.status === "undone"
                        ? false
                        : result.undoAvailable ?? operation.undoAvailable,
                };
            }
            if (this.operationResults.length
                && this.operationResults.every(candidate => candidate.undoAvailable === false)
                && this.undoResults.every(candidate => candidate.status === "undone")) {
                this.status = "undone";
            }
        }
    }

    private emit(): void {
        const snapshot = this.getSnapshot();
        for (const listener of [...this.listeners]) listener(snapshot);
    }

    private isCurrentEpoch(epoch: number): boolean {
        return epoch === this.invalidationEpoch;
    }
}

export function createOperationsReviewId(intentId: string, sessionIdentity: string | number): string {
    const safeIntent = intentId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "intent";
    const identity = String(sessionIdentity).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    const random = Math.random().toString(36).slice(2, 10);
    return `opr-${safeIntent}-${identity}-${random}`;
}

function errorText(error: unknown): string {
    return error instanceof Error && error.message ? error.message : "Operations review action failed.";
}

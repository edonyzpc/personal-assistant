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
    | "preview"
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

export type OperationsReviewAction = "undo";

export interface OperationsReviewSnapshot {
    reviewId: string;
    intentId: string;
    status: OperationsReviewStatus;
    actionInFlight: OperationsReviewAction | null;
    model: OperationsReviewModel | null;
    execution: OperationsExecutionResult | null;
    operationResults: readonly OperationExecutionResult[];
    undoResults: readonly UndoResult[];
    error: string | null;
}

export interface OperationsReviewSessionPort {
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
    private intent: OperationsIntent | null;
    private readonly controller: OperationsReviewSessionPort;
    private readonly isSourceCurrent: () => boolean;
    private readonly onInvalidate?: (reviewId: string) => void;
    private readonly listeners = new Set<OperationsReviewListener>();
    private unsubscribe: (() => void) | null = null;
    private invalidationEpoch = 0;
    private status: OperationsReviewStatus = "pending";
    private actionInFlight: OperationsReviewAction | null = null;
    private execution: OperationsExecutionResult | null = null;
    private operationResults: OperationExecutionResult[] = [];
    private undoResults: UndoResult[] = [];
    private readonly ownedOperationIds = new Set<string>();
    private readonly ownedReceiptIds = new Set<string>();
    private error: string | null = null;

    constructor(options: OperationsReviewSessionOptions) {
        this.intentId = options.intent.id;
        this.intent = options.intent;
        this.status = options.intent.mode === "preview" ? "preview" : options.intent.state;
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
        this.invalidate("discarded");
    }

    invalidate(status: Exclude<OperationsReviewStatus, "pending" | "executing"> = "unavailable"): void {
        this.invalidationEpoch += 1;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.status = status;
        this.actionInFlight = null;
        this.model = null;
        this.intent = null;
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
                break;
            case "intent-expired":
                if (event.intentId !== this.intentId) return;
                this.status = "expired";
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
        if (this.intent) this.model = createOperationsReviewModel(this.intent, this.operationResults);
    }

    private upsertOperationResult(result: OperationExecutionResult): void {
        const index = this.operationResults.findIndex((existing) => existing.operationId === result.operationId);
        if (index >= 0) this.operationResults[index] = result;
        else this.operationResults.push(result);
        this.ownedOperationIds.add(result.operationId);
        if (result.receiptId) this.ownedReceiptIds.add(result.receiptId);
        if (this.intent) this.model = createOperationsReviewModel(this.intent, this.operationResults);
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

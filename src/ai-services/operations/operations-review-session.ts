import {
    createOperationsReviewModel,
    createOperationsRequestReviewModel,
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
    scope?: "request";
    runId?: string;
    terminalCause?: OperationsRequestTerminalCause;
    /** Frozen pre-Undo projection kept only for history display. */
    historicalModel?: OperationsReviewModel | null;
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

export type OperationsRequestTerminalCause = "completed" | "stopped" | "failed" | "unknown";

export interface OperationsRequestReviewSessionPort {
    undoRequest(input: {
        runId: string;
        intentIds: readonly string[];
        signal: AbortSignal;
        isSourceCurrent(this: void): boolean;
    }): Promise<UndoResult[]>;
    subscribe?(listener: (event: OperationsControllerEvent) => void): () => void;
}

export interface OperationsRequestReviewSessionOptions {
    scope: "request";
    runId: string;
    controller: OperationsRequestReviewSessionPort;
    sessionIdentity: string | number;
    isSourceCurrent(this: void): boolean;
    /** Host generation busy state; generation is not source invalidation. */
    isHostBusy?(this: void): boolean;
    onInvalidate?(this: void, reviewId: string): void;
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
    private readonly scope: "batch" | "request";
    private readonly requestRunId?: string;
    private readonly requestController?: OperationsRequestReviewSessionPort;
    private readonly recoveryLifetime = new AbortController();
    private readonly memberIntentIds = new Set<string>();
    private readonly memberIntents: OperationsIntent[] = [];
    private readonly resultsByIntent = new Map<string, OperationExecutionResult[]>();
    private readonly intentStates = new Map<string, OperationsExecutionResult["state"]>();
    private readonly memberTerminalOverrides = new Map<string, "cancelled" | "expired">();
    private terminalCause: OperationsRequestTerminalCause | undefined;
    private model: OperationsReviewModel | null;
    private historicalModel: OperationsReviewModel | null = null;
    /** Set by the first user whole-request recovery, never by SDK restores. */
    private userRecoveryStarted = false;
    private intent: OperationsIntent | null;
    private readonly controller: OperationsReviewSessionPort;
    private readonly isSourceCurrent: () => boolean;
    private readonly isHostBusy?: () => boolean;
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

    constructor(options: OperationsReviewSessionOptions | OperationsRequestReviewSessionOptions) {
        this.scope = "scope" in options && options.scope === "request" ? "request" : "batch";
        if (this.scope === "request") {
            const request = options as OperationsRequestReviewSessionOptions;
            this.intentId = request.runId;
            this.requestRunId = request.runId;
            this.requestController = request.controller;
            this.isHostBusy = request.isHostBusy;
            this.intent = null;
            this.status = "pending";
            this.model = null;
            this.controller = { undoMany: async () => [] };
            this.reviewId = createOperationsReviewId(`request-${request.runId}`, request.sessionIdentity);
        } else {
            const batch = options as OperationsReviewSessionOptions;
            this.intentId = batch.intent.id;
            this.intent = batch.intent;
            this.status = batch.intent.mode === "preview" ? "preview" : batch.intent.state;
            this.model = createOperationsReviewModel(batch.intent);
            this.controller = batch.controller;
            this.reviewId = createOperationsReviewId(batch.intent.id, batch.sessionIdentity);
        }
        this.isSourceCurrent = options.isSourceCurrent;
        this.onInvalidate = options.onInvalidate;
        try {
            this.unsubscribe = (this.requestController ?? this.controller).subscribe?.((event) => this.handleControllerEvent(event)) ?? null;
        } catch {
            this.invalidate("unavailable");
        }
    }

    getSnapshot(): OperationsReviewSnapshot {
        return {
            reviewId: this.reviewId,
            intentId: this.intentId,
            ...(this.scope === "request" ? {
                scope: "request" as const,
                runId: this.requestRunId,
                ...(this.terminalCause ? { terminalCause: this.terminalCause } : {}),
                historicalModel: this.projectHistory(),
            } : {}),
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

    /** Re-emit the current snapshot when only Host UI state changed. */
    refresh(): void {
        this.emit();
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

    /** Host-admitted member of the same real user run. Identity is deduped. */
    addIntent(intent: OperationsIntent): void {
        if (this.scope !== "request" || !this.isSourceCurrent()) return;
        if (intent.runId !== this.requestRunId || this.memberIntentIds.has(intent.id)) return;
        this.memberIntentIds.add(intent.id);
        this.memberIntents.push(intent);
        this.rebuildRequestModel();
        this.emit();
    }

    finishRun(cause: OperationsRequestTerminalCause): void {
        if (this.scope !== "request" || !this.isSourceCurrent()) return;
        this.terminalCause = cause;
        const hasApplyMember = this.memberIntents.some(intent => intent.mode !== "preview");
        if (!hasApplyMember) {
            this.status = "preview";
            this.emit();
            return;
        }
        if (this.status === "pending" || this.status === "executing") {
            // The run ended while an owner effect has not converged. Keep the
            // unknown fact; never present the planned effects as completed.
            this.status = "unknown";
        }
        this.emit();
    }

    async undoRequest(): Promise<UndoResult[] | null> {
        if (this.scope !== "request" || !this.requestController || !this.canUndo()) return null;
        // Re-check the Host busy boundary at the entry itself; card and tab
        // DOM state can never grant recovery admission.
        if (this.isHostBusy?.() === true) return null;
        const epoch = this.invalidationEpoch;
        if (!this.userRecoveryStarted) {
            // The first user whole-request recovery freezes the request's
            // then-current final model. Earlier SDK restore facts never seal
            // this point; retries and partial recovery reuse the same history.
            this.userRecoveryStarted = true;
            if (this.model) this.historicalModel = this.model;
        }
        this.actionInFlight = "undo";
        this.emit();
        try {
            const results = await this.requestController.undoRequest({
                runId: this.requestRunId!,
                intentIds: [...this.memberIntentIds],
                signal: this.recoveryLifetime.signal,
                isSourceCurrent: this.isSourceCurrent,
            });
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

    canUndo(): boolean {
        if (this.scope === "request") {
            return this.isSourceCurrent()
                && (this.status === "completed" || this.status === "partial")
                && this.actionInFlight === null
                && this.terminalCause !== undefined
                && this.isHostBusy?.() !== true
                && this.activeReceiptIds().length > 0;
        }
        return this.isSourceCurrent()
            && (this.status === "completed" || this.status === "partial")
            && this.actionInFlight === null
            && this.activeReceiptIds().length > 0;
    }

    activeReceiptIds(): string[] {
        const results = this.scope === "request"
            ? [...this.resultsByIntent.values()].flat()
            : this.operationResults;
        return results
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
        this.recoveryLifetime.abort();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.status = status;
        this.actionInFlight = null;
        this.model = null;
        this.historicalModel = null;
        this.userRecoveryStarted = false;
        this.intent = null;
        this.execution = null;
        this.operationResults = [];
        this.undoResults = [];
        this.error = null;
        this.terminalCause = undefined;
        this.resultsByIntent.clear();
        this.intentStates.clear();
        this.memberTerminalOverrides.clear();
        this.memberIntentIds.clear();
        this.memberIntents.length = 0;
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
                if (!this.ownsIntent(event.intent.id)) return;
                if (event.intent.state === "executing") this.status = "executing";
                else if (this.scope === "batch") {
                    if (event.intent.state === "completed") this.status = "completed";
                    else if (event.intent.state === "partial") this.status = "partial";
                    else if (event.intent.state === "failed") this.status = "failed";
                }
                break;
            case "operation-result":
                if (!this.ownsIntent(event.intentId)) return;
                this.upsertOperationResult(event.result);
                if (this.scope === "request") {
                    this.trackIntentResult(event.intentId, event.result);
                    // Project each settled owner fact immediately; an
                    // outstanding later native write must not hide the
                    // already-applied change until the intent terminates.
                    this.syncRequestOperationResults();
                    this.rebuildRequestModel();
                }
                break;
            case "intent-result":
                if (!this.ownsIntent(event.result.intentId)) return;
                this.applyExecutionResult(event.result);
                break;
            case "intent-cancelled":
                if (!this.ownsIntent(event.intent.id)) return;
                if (this.scope === "request") {
                    // A cancelled member is a dead proposal, not a whole-request
                    // terminal; other members' real effects keep their Undo.
                    this.memberTerminalOverrides.set(event.intent.id, "cancelled");
                    this.aggregateRequestStatus();
                } else this.status = "cancelled";
                break;
            case "intent-expired":
                if (!this.ownsIntent(event.intentId)) return;
                if (this.scope === "request") {
                    this.memberTerminalOverrides.set(event.intentId, "expired");
                    this.aggregateRequestStatus();
                } else this.status = "expired";
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
        if (!this.ownsIntent(result.intentId)) return;
        this.execution = result;
        if (this.scope === "request") {
            this.resultsByIntent.set(result.intentId, [...result.operations]);
            this.intentStates.set(result.intentId, result.state);
            for (const operation of result.operations) {
                this.ownedOperationIds.add(operation.operationId);
                if (operation.receiptId) this.ownedReceiptIds.add(operation.receiptId);
            }
            this.syncRequestOperationResults();
            this.aggregateRequestStatus();
            // An explicit SDK Undo member completes after its restore fact;
            // actual recovery facts keep the all-restored verdict instead of
            // letting that member's terminal state reopen the request.
            if (this.allApplyMembersSettled()) {
                const recovery = this.computeRequestRecovery();
                if (recovery.recovered > 0 && recovery.remaining === 0) this.status = "undone";
            }
            this.rebuildRequestModel();
            return;
        }
        this.operationResults = [...result.operations];
        for (const operation of this.operationResults) {
            this.ownedOperationIds.add(operation.operationId);
            if (operation.receiptId) this.ownedReceiptIds.add(operation.receiptId);
        }
        this.status = result.state;
        if (this.intent) this.model = createOperationsReviewModel(this.intent, this.operationResults);
    }

    private ownsIntent(intentId: string): boolean {
        return this.scope === "batch" ? intentId === this.intentId : this.memberIntentIds.has(intentId);
    }

    private trackIntentResult(intentId: string, result: OperationExecutionResult): void {
        const current = this.resultsByIntent.get(intentId) ?? [];
        const index = current.findIndex(existing => existing.operationId === result.operationId);
        if (index >= 0) current[index] = result;
        else current.push(result);
        this.resultsByIntent.set(intentId, current);
    }

    private aggregateRequestStatus(): void {
        const applyMembers = this.memberIntents.filter(intent => intent.mode !== "preview");
        if (applyMembers.length === 0) return;
        if (applyMembers.some(intent => !this.resultsByIntent.has(intent.id)
            && !this.memberTerminalOverrides.has(intent.id))) return;
        const states = applyMembers.map(intent => {
            if (!this.resultsByIntent.has(intent.id)) {
                // A cancelled/expired member proposal produced no effect; only
                // report it when every member died the same way.
                return this.memberTerminalOverrides.get(intent.id) ?? "failed";
            }
            const ownerState = this.intentStates.get(intent.id);
            if (ownerState === "unknown" || ownerState === "partial") return ownerState;
            const results = this.resultsByIntent.get(intent.id)!;
            const succeeded = results.some(result => result.status === "succeeded"
                || result.effects?.some(effect => effect.status === "applied" || effect.status === "removed") === true);
            const unknown = results.some(result => result.status === "unknown"
                || result.effects?.some(effect => effect.status === "unknown") === true);
            const failed = results.some(result => result.status === "failed" || result.status === "stale");
            if (unknown) return "unknown";
            if (succeeded && !failed) return "completed";
            if (succeeded) return "partial";
                return failed ? "failed" : "completed";
        });
        if (states.length === 0) return;
        const hasRealOutcome = applyMembers.some(intent => this.resultsByIntent.has(intent.id));
        const effectiveStates = hasRealOutcome
            ? states.filter(state => state !== "cancelled" && state !== "expired")
            : states;
        if (!hasRealOutcome && effectiveStates.every(state => state === "cancelled")) this.status = "cancelled";
        else if (!hasRealOutcome && effectiveStates.every(state => state === "expired")) this.status = "expired";
        else if (effectiveStates.some(state => state === "unknown")) this.status = "unknown";
        else if (effectiveStates.some(state => state === "partial")) this.status = "partial";
        else if (effectiveStates.every(state => state === "completed")) this.status = "completed";
        else if (effectiveStates.some(state => state === "failed") && effectiveStates.some(state => state === "completed")) this.status = "partial";
        else this.status = "failed";
    }

    private syncRequestOperationResults(): void {
        this.operationResults = this.memberIntents
            .flatMap(intent => this.resultsByIntent.get(intent.id) ?? []);
    }

    /**
     * Effect-based request recovery accounting. Zero-effect failures never
     * block an all-recovered verdict; unrecovered or unknown effects do.
     */
    private computeRequestRecovery(): { recovered: number; remaining: number } {
        let recovered = 0;
        let remaining = 0;
        const undoneReceipts = new Set(this.undoResults
            .filter(result => result.status === "undone")
            .map(result => result.receiptId));
        for (const operation of this.resultsByIntent.values()) {
            for (const result of operation) {
                const resourceKind = result.resourceEffect?.kind;
                if (resourceKind === "open") continue;
                if (resourceKind === "undo"
                    && result.resourceEffect?.undoStatus === "undone") continue;
                const hasEffect = result.status === "succeeded" || result.status === "unknown"
                    || result.effects?.some(effect => effect.status === "applied"
                        || effect.status === "removed" || effect.status === "unknown") === true
                    || (result.resourceEffect?.paths?.length ?? 0) > 0
                    || resourceKind === "undo";
                if (!hasEffect) continue;
                const isRecovered = (result.receiptId && undoneReceipts.has(result.receiptId)) === true
                    || (result.effects?.length ?? 0) > 0 && result.undoAvailable === false
                        && result.effects!.every(effect => effect.status === "restored") === true;
                if (isRecovered) recovered += 1;
                else remaining += 1;
            }
        }
        for (const result of this.undoResults) {
            if (result.status === "undone") continue;
            const matchesMember = [...this.resultsByIntent.values()]
                .some(operations => operations.some(operation => operation.receiptId === result.receiptId
                    || operation.operationId === result.operationId));
            if (!matchesMember) remaining += 1;
        }
        return { recovered, remaining };
    }

    /**
     * Every non-preview member has an owner terminal fact (final execution
     * state or explicit cancelled/expired override). Queued/executing members
     * without results are still open and never support an all-restored
     * verdict.
     */
    private allApplyMembersSettled(): boolean {
        return this.memberIntents
            .filter(intent => intent.mode !== "preview")
            .every(intent => this.intentStates.has(intent.id)
                || this.memberTerminalOverrides.has(intent.id));
    }

    private rebuildRequestModel(): void {
        if (this.scope !== "request") return;
        const undone = new Set(this.undoResults
            .filter(result => result.status === "undone")
            .map(result => result.receiptId));
        this.model = {
            intentId: this.requestRunId!,
            ...createOperationsRequestReviewModel({
            runId: this.requestRunId!,
            intents: this.memberIntents.map(intent => ({
                intent,
                results: this.resultsByIntent.get(intent.id),
            })),
            undoneReceiptIds: [...undone],
            }),
        };
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
            if (this.scope === "request" && !this.historicalModel
                && !this.userRecoveryStarted
                && result.status === "undone" && this.model) {
                this.historicalModel = this.model;
            }
            const receiptId = result.receiptId;
            const merge = (operation: OperationExecutionResult): OperationExecutionResult => ({
                ...operation,
                ...(result.effects ? { effects: result.effects } : {}),
                ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
                undoAvailable: result.status === "undone"
                    ? false
                    : result.undoAvailable ?? operation.undoAvailable,
            });
            const operation = this.operationResults.find((candidate) => candidate.receiptId === receiptId);
            if (operation) this.operationResults[this.operationResults.indexOf(operation)] = merge(operation);
            if (this.scope === "request") {
                for (const [intentId, operations] of this.resultsByIntent) {
                    const index = operations.findIndex(candidate => candidate.receiptId === receiptId);
                    if (index >= 0) {
                        operations[index] = merge(operations[index]);
                        this.resultsByIntent.set(intentId, operations);
                    }
                }
            }
            const currentResults = this.scope === "request"
                ? [...this.resultsByIntent.values()].flat()
                : this.operationResults;
            const recovery = this.scope === "request"
                ? (this.allApplyMembersSettled()
                    ? this.computeRequestRecovery()
                    : { recovered: 0, remaining: 1 })
                : currentResults.length
                    && currentResults.every(candidate => candidate.undoAvailable === false)
                    && this.undoResults.every(candidate => candidate.status === "undone")
                    ? { recovered: currentResults.length, remaining: 0 }
                    : { recovered: 0, remaining: currentResults.length };
            if (recovery.remaining === 0 && recovery.recovered > 0) {
                this.status = "undone";
            }
            if (this.scope === "request") {
                if (this.status !== "undone" && recovery.recovered > 0 && recovery.remaining > 0) {
                    this.status = "partial";
                }
                this.rebuildRequestModel();
            }
        }
    }

    private emit(): void {
        const snapshot = this.getSnapshot();
        for (const listener of [...this.listeners]) listener(snapshot);
    }

    /**
     * Project history only when it is the applicable view. While the current
     * request still has visible real changes, an earlier SDK restore fact
     * must not turn the whole request into a historical view.
     */
    private projectHistory(): OperationsReviewModel | null {
        if (!this.historicalModel) return null;
        if (this.userRecoveryStarted || this.status === "undone") return this.historicalModel;
        return !this.model || this.model.groups.length === 0 ? this.historicalModel : null;
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

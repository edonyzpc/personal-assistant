/* Copyright 2023 edonyzpc */

import { Modal, Notice, Platform, Setting, type App } from "obsidian";
import type { MemoryHost } from "./memory";
import type {
    VSS,
    VSSMemoryStatus,
    VSSOperationSummary,
    VSSPreparedRebuildHandle,
    VSSProgressEvent,
} from "./vss";
import { getPluginUiLanguage, pluginT, type PluginLocale } from "./locales/plugin";
import {
    clearPlatformInterval,
    clearPlatformTimeout,
    getOptionalPlatformDocument,
    getOptionalPlatformWindow,
    getPlatformDocument,
    setPlatformInterval,
    setPlatformTimeout,
    type PlatformIntervalHandle,
    type PlatformTimeoutHandle,
} from "./platform-dom";

export type MemoryDecision = "use-memory" | "answer-now" | "cancel";
export type MemoryMode = "auto" | "use-memory" | "skip-memory";

export type MemoryPlanReason =
    | "ready"
    | "first-use"
    | "changed-notes"
    | "local-memory-missing"
    | "settings-changed"
    | "lexical-profile-stale"
    | "unavailable";

export interface MemoryMaintenancePlan {
    reason: MemoryPlanReason;
    action: "none" | "refresh" | "rebuild" | "rebuild-lexical";
    notesToCheck: number;
    notesLikelyToUpdate?: number;
    verificationPending?: number;
    requiresApproval: boolean;
    canAnswerNow: boolean;
}

export interface MemoryPrepareResult {
    ok: boolean;
    partial: boolean;
    summary?: VSSOperationSummary;
    message?: string;
}

export interface MemoryPreparationStatus {
    action: Exclude<MemoryMaintenancePlan["action"], "none">;
    message: string;
    phase?: VSSProgressEvent["phase"];
    filesDone?: number;
    filesTotal?: number;
    chunksEmbedded?: number;
    chunksTotal?: number;
    lexicalRowsDone?: number;
    lexicalRowsTotal?: number;
    failed?: number;
    startedAt: number;
}

export type MemoryStatus = "disabled" | "preparing" | VSSMemoryStatus;

export interface MemoryStatusSnapshot {
    enabled: boolean;
    status: MemoryStatus;
    indexedDocumentCount?: number;
    dirtyCount: number;
    verificationPending: number;
    lastErrorCode?: string;
    preparation?: MemoryPreparationStatus;
}

export interface MemoryDecisionResult {
    decision: MemoryDecision;
    message?: string;
}

export interface MemoryApprovalCopy {
    title: string;
    primaryAction: string;
    secondaryAction: string;
    cancelAction: string;
}

const DECLINE_COOLDOWN_MS = 10 * 60 * 1000;
const AUTO_MEMORY_POLICY = "auto-refresh-after-prepare";
const AUTO_FLUSH_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
const STARTUP_RECONCILE_DELAY_MS = 60_000;
const PREPARE_RECONCILE_DELAY_MS = 5_000;
const RESUME_RECONCILE_DELAY_MS = 30_000;
const PERIODIC_RECONCILE_INTERVAL_MS = 60 * 60_000;
const QUIET_AUTO_FLUSH_DELAY_MS = 30_000;
const DESKTOP_VERIFY_DELAY_MS = 1_000;
const MOBILE_VERIFY_DELAY_MS = 5_000;
type MemoryApprovalContext = "chat" | "command";
type BackgroundTaskKind = "flush" | "reconcile" | "verify";
type MemoryPreparationAction = Exclude<MemoryMaintenancePlan["action"], "none">;
type MemoryRebuildRecoveryReason = "first-use" | "settings-changed" | "local-memory-missing";
interface ActivePreparationIdentity {
    id: number;
    action: MemoryPreparationAction;
    lifecycleVersion: number;
    controller?: AbortController;
}
interface ActivePreparationRun extends ActivePreparationIdentity {
    promise: Promise<MemoryPrepareResult>;
    origin: "chat" | "shared";
    hasSharedConsumer: boolean;
    chatConsumers: Set<number>;
}
interface MemoryAdmissionOwner extends ActivePreparationIdentity {
    previousPolicy: string;
}
interface MemoryPolicyAdmissionResult {
    enabled: boolean;
    previousPolicy: string | null;
}
interface MemoryPreparationAcquisition {
    promise: Promise<MemoryPrepareResult>;
    run: ActivePreparationRun | null;
}
type ChatOperationResult<T> =
    | { aborted: true }
    | { aborted: false; value: T };

function awaitChatOperation<T>(
    operation: Promise<T>,
    signal?: AbortSignal,
): Promise<ChatOperationResult<T>> {
    if (!signal) {
        return operation.then((value) => ({ aborted: false, value }));
    }
    if (signal.aborted) {
        void operation.catch(() => undefined);
        return Promise.resolve({ aborted: true });
    }
    return new Promise<ChatOperationResult<T>>((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ aborted: true });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
            onAbort();
        }
        void operation.then(
            (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve({ aborted: false, value });
            },
            (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            },
        );
    });
}

export const MEMORY_USER_FORBIDDEN_TERMS = [
    "VSS",
    "RAG",
    "embedding",
    "SQLite",
    "OPFS",
    "chunks",
    "backend",
    "stale",
    "fallback",
    "vector",
];

export const MEMORY_APPROVAL_SECTIONS = [
    {
        title: "Data",
        body: "Your notes will not be changed or deleted.",
    },
    {
        title: "AI provider",
        body: "To prepare memory, note text may be sent to your configured AI provider.",
    },
    {
        title: "Memory search",
        body: "When Memory is ready, your question may be sent to your configured AI provider to search Memory. This does not send all note text.",
    },
    {
        title: "Background updates",
        body: "After Memory is prepared, changed note text may be sent to your configured AI provider while updates continue in the background. You can turn this off in Advanced memory controls.",
    },
    {
        title: "Cost",
        body: "This may use AI credits or API calls. Unchanged notes will be skipped when possible.",
    },
];

function getLocalizedMemoryApprovalSections(
    plan: MemoryMaintenancePlan,
    locale: PluginLocale,
): typeof MEMORY_APPROVAL_SECTIONS {
    if (plan.action === "rebuild-lexical") {
        return [
            {
                title: pluginT("plugin.memory.approval.section.lexicalData.title", locale),
                body: pluginT("plugin.memory.approval.section.lexicalData.body", locale),
            },
            {
                title: pluginT("plugin.memory.approval.section.lexicalLocal.title", locale),
                body: pluginT("plugin.memory.approval.section.lexicalLocal.body", locale),
            },
        ];
    }
    return [
        {
            title: pluginT("plugin.memory.approval.section.data.title", locale),
            body: pluginT("plugin.memory.approval.section.data.body", locale),
        },
        {
            title: pluginT("plugin.memory.approval.section.provider.title", locale),
            body: pluginT("plugin.memory.approval.section.provider.body", locale),
        },
        {
            title: pluginT("plugin.memory.approval.section.search.title", locale),
            body: pluginT("plugin.memory.approval.section.search.body", locale),
        },
        {
            title: pluginT("plugin.memory.approval.section.background.title", locale),
            body: pluginT("plugin.memory.approval.section.background.body", locale),
        },
        {
            title: pluginT("plugin.memory.approval.section.cost.title", locale),
            body: pluginT("plugin.memory.approval.section.cost.body", locale),
        },
    ];
}

export function getMemoryApprovalCopy(
    plan: MemoryMaintenancePlan,
    context: MemoryApprovalContext = "chat",
    locale: PluginLocale = getPluginUiLanguage(),
): MemoryApprovalCopy {
    const titleByReason: Record<MemoryPlanReason, string> = {
        "ready": pluginT("plugin.memory.approval.title.ready", locale),
        "first-use": pluginT("plugin.memory.approval.title.firstUse", locale),
        "changed-notes": pluginT("plugin.memory.approval.title.changedNotes", locale),
        "local-memory-missing": pluginT("plugin.memory.approval.title.localMissing", locale),
        "settings-changed": pluginT("plugin.memory.approval.title.settingsChanged", locale),
        "lexical-profile-stale": pluginT("plugin.memory.approval.title.lexicalChanged", locale),
        "unavailable": pluginT("plugin.memory.approval.title.unavailable", locale),
    };

    return {
        title: titleByReason[plan.reason],
        primaryAction: plan.action === "refresh"
            ? pluginT("plugin.memory.approval.primary.update", locale)
            : plan.action === "rebuild-lexical"
                ? pluginT("plugin.memory.approval.primary.rebuildSearch", locale)
                : pluginT("plugin.memory.approval.primary.prepare", locale),
        secondaryAction: context === "chat"
            ? pluginT("plugin.memory.approval.secondary.answerNow", locale)
            : pluginT("plugin.memory.approval.secondary.notNow", locale),
        cancelAction: pluginT("plugin.memory.approval.cancel", locale),
    };
}

function memoryT(key: string, params?: Readonly<Record<string, string | number>>, fallback?: string): string {
    return pluginT(key, getPluginUiLanguage(), params, fallback);
}

export class MemoryManager {
    private readonly host: MemoryHost;
    private readonly vss: VSS;
    private lastAnswerNowAt = 0;
    private started = false;
    private autoFlushTimer: PlatformTimeoutHandle | null = null;
    private verifyTimer: PlatformTimeoutHandle | null = null;
    private reconcileTimer: PlatformTimeoutHandle | null = null;
    private periodicReconcileTimer: PlatformIntervalHandle | null = null;
    private maintenanceQueue: Promise<void> = Promise.resolve();
    private backgroundFailureCount = 0;
    private readonly cleanupListeners: Array<() => void> = [];
    private lifecycleVersion = 0;
    private shuttingDown = false;
    private manualCommandInFlight = false;
    private readonly activeOperationControllers = new Set<AbortController>();
    private readonly activeOperationPromises = new Set<Promise<unknown>>();
    private activePreparationStatus: (MemoryPreparationStatus & { id: number; lifecycleVersion: number }) | null = null;
    private activePreparationRun: ActivePreparationRun | null = null;
    private memoryAdmissionOwner: MemoryAdmissionOwner | null = null;
    private nextPreparationId = 1;
    private nextChatPreparationConsumerId = 1;

    constructor(host: MemoryHost, vss: VSS) {
        this.host = host;
        this.vss = vss;
    }

    async getMaintenancePlan(): Promise<MemoryMaintenancePlan> {
        return this.vss.getMemoryReadiness();
    }

    getActivePreparationStatus(): MemoryPreparationStatus | null {
        if (!this.activePreparationStatus) return null;
        if (!this.activePreparationRun) return null;
        if (!this.isSamePreparation(this.activePreparationStatus, this.activePreparationRun)) return null;
        if (!this.isLifecycleCurrent(this.activePreparationStatus.lifecycleVersion)) return null;
        return {
            action: this.activePreparationStatus.action,
            message: this.activePreparationStatus.message,
            phase: this.activePreparationStatus.phase,
            filesDone: this.activePreparationStatus.filesDone,
            filesTotal: this.activePreparationStatus.filesTotal,
            chunksEmbedded: this.activePreparationStatus.chunksEmbedded,
            chunksTotal: this.activePreparationStatus.chunksTotal,
            lexicalRowsDone: this.activePreparationStatus.lexicalRowsDone,
            lexicalRowsTotal: this.activePreparationStatus.lexicalRowsTotal,
            failed: this.activePreparationStatus.failed,
            startedAt: this.activePreparationStatus.startedAt,
        };
    }

    getStatusSnapshot(): MemoryStatusSnapshot {
        const vssSnapshot = this.vss.getMemoryStatusSnapshot();
        const enabled = this.isMemoryEnabled();
        const preparation = enabled ? this.getActivePreparationStatus() : null;
        const snapshot: MemoryStatusSnapshot = {
            enabled,
            status: enabled
                ? (preparation ? "preparing" : vssSnapshot.status)
                : "disabled",
            dirtyCount: vssSnapshot.dirtyCount,
            verificationPending: vssSnapshot.verificationPending,
        };
        if (vssSnapshot.indexedDocumentCount !== undefined) {
            snapshot.indexedDocumentCount = vssSnapshot.indexedDocumentCount;
        }
        if (vssSnapshot.lastErrorCode) {
            snapshot.lastErrorCode = vssSnapshot.lastErrorCode;
        }
        if (preparation) {
            snapshot.preparation = preparation;
        }
        return snapshot;
    }

    startAutoMaintenance(): void {
        if (this.started) return;
        this.started = true;
        this.shuttingDown = false;
        this.lifecycleVersion++;
        this.scheduleReconcile("startup", STARTUP_RECONCILE_DELAY_MS);
        this.periodicReconcileTimer = setPlatformInterval(() => {
            this.scheduleReconcile("periodic");
        }, PERIODIC_RECONCILE_INTERVAL_MS);

        const scheduleResume = () => this.scheduleReconcile("resume", RESUME_RECONCILE_DELAY_MS);
        const win = getOptionalPlatformWindow();
        if (win) {
            win.addEventListener("focus", scheduleResume);
            this.cleanupListeners.push(() => win.removeEventListener("focus", scheduleResume));
        }
        const doc = getOptionalPlatformDocument();
        if (doc) {
            const onVisibilityChange = () => {
                if (doc.visibilityState === "visible") {
                    scheduleResume();
                }
            };
            doc.addEventListener("visibilitychange", onVisibilityChange);
            this.cleanupListeners.push(() => doc.removeEventListener("visibilitychange", onVisibilityChange));
        }
    }

    cancelActivePreparation(): void {
        this.lifecycleVersion++;
        this.activePreparationRun?.controller?.abort();
        for (const controller of this.activeOperationControllers) {
            controller.abort();
        }
        this.activeOperationControllers.clear();
        this.activePreparationRun = null;
        this.activePreparationStatus = null;
    }

    stopAutoMaintenance(): void {
        this.started = false;
        this.shuttingDown = true;
        this.cancelActivePreparation();
        if (this.autoFlushTimer) {
            clearPlatformTimeout(this.autoFlushTimer);
            this.autoFlushTimer = null;
        }
        if (this.verifyTimer) {
            clearPlatformTimeout(this.verifyTimer);
            this.verifyTimer = null;
        }
        if (this.reconcileTimer) {
            clearPlatformTimeout(this.reconcileTimer);
            this.reconcileTimer = null;
        }
        if (this.periodicReconcileTimer) {
            clearPlatformInterval(this.periodicReconcileTimer);
            this.periodicReconcileTimer = null;
        }
        while (this.cleanupListeners.length > 0) {
            this.cleanupListeners.pop()?.();
        }
    }

    scheduleAutoFlush(reason: string, delayMs = QUIET_AUTO_FLUSH_DELAY_MS): void {
        if (!this.started) return;
        if (!this.isAutoPolicyEnabled()) return;
        if (this.autoFlushTimer) {
            clearPlatformTimeout(this.autoFlushTimer);
        }
        this.autoFlushTimer = setPlatformTimeout(() => {
            this.autoFlushTimer = null;
            this.enqueueBackgroundTask("flush", reason);
        }, Math.max(0, delayMs));
    }

    scheduleVerify(reason: string, delayMs = this.getVerifyDelayMs()): void {
        if (!this.started) return;
        if (!this.isMemoryEnabled()) return;
        if (this.verifyTimer) {
            clearPlatformTimeout(this.verifyTimer);
        }
        this.verifyTimer = setPlatformTimeout(() => {
            this.verifyTimer = null;
            this.enqueueBackgroundTask("verify", reason);
        }, Math.max(0, delayMs));
    }

    scheduleReconcile(reason: string, delayMs = 0): void {
        if (!this.started) return;
        if (!this.isAutoPolicyEnabled()) return;
        if (this.reconcileTimer) {
            clearPlatformTimeout(this.reconcileTimer);
        }
        this.reconcileTimer = setPlatformTimeout(() => {
            this.reconcileTimer = null;
            this.enqueueBackgroundTask("reconcile", reason);
        }, Math.max(0, delayMs));
    }

    async ensureReadyForChat(
        _prompt?: string,
        signal?: AbortSignal,
        preparationOwnerSignal: AbortSignal | undefined = signal,
    ): Promise<MemoryDecisionResult> {
        if (signal?.aborted) {
            return { decision: "cancel" };
        }
        const lifecycleToken = this.lifecycleVersion;
        if (!this.host.settings.memoryEnabled) {
            return { decision: "answer-now" };
        }

        if (!this.host.settings.memoryAutoCheckBeforeChat) {
            return { decision: "use-memory" };
        }

        const initialPlan = await awaitChatOperation(this.getMaintenancePlan(), signal);
        if (initialPlan.aborted) {
            return { decision: "cancel" };
        }
        let plan = initialPlan.value;
        if (!this.isLifecycleCurrent(lifecycleToken)) {
            return { decision: "answer-now" };
        }
        const activePreparation = this.activePreparationRun;
        if (activePreparation
            && this.isActivePreparationCurrent(activePreparation)
            && (activePreparation.action === "rebuild" || plan.reason === "unavailable")) {
            return {
                decision: "answer-now",
                message: memoryT("plugin.memory.message.buildingInBackground"),
            };
        }
        if (plan.reason === "unavailable") {
            new Notice(memoryT("plugin.memory.notice.unavailableAnswerNow"), 5000);
            return {
                decision: "answer-now",
                message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
            };
        }
        if (this.shouldTryChatFastVerification(plan)) {
            const localMaintenance = await awaitChatOperation(this.canRunLocalMaintenance(), signal);
            if (localMaintenance.aborted) {
                return { decision: "cancel" };
            }
            if (localMaintenance.value) {
                const verification = await awaitChatOperation(
                    this.trackActiveOperation(this.verifyPendingBeforeChat(lifecycleToken, signal)),
                    signal,
                );
                if (verification.aborted) {
                    return { decision: "cancel" };
                }
                if (!this.isLifecycleCurrent(lifecycleToken)) {
                    return { decision: "answer-now" };
                }
                const verifiedPlan = await awaitChatOperation(this.getMaintenancePlan(), signal);
                if (verifiedPlan.aborted) {
                    return { decision: "cancel" };
                }
                plan = verifiedPlan.value;
                if (!this.isLifecycleCurrent(lifecycleToken)) {
                    return { decision: "answer-now" };
                }
            }
        }

        if (plan.reason === "ready" || plan.action === "none" && !plan.requiresApproval) {
            return { decision: "use-memory" };
        }

        if (plan.reason === "changed-notes" && this.isAutoPolicyEnabled()) {
            const autoMaintenance = await awaitChatOperation(this.canRunAutoMaintenance(), signal);
            if (autoMaintenance.aborted) {
                return { decision: "cancel" };
            }
            if (autoMaintenance.value) {
                this.scheduleReconcile("chat", 0);
                if (plan.verificationPending && plan.verificationPending > 0) {
                    this.scheduleVerify("chat");
                }
                this.scheduleAutoFlush("chat", 0);
                return {
                    decision: "use-memory",
                    message: memoryT("plugin.memory.message.usingLastPrepared"),
                };
            } else {
                this.host.log("Memory changed, but background maintenance is waiting for durable local memory.");
                return {
                    decision: "use-memory",
                    message: memoryT("plugin.memory.message.backgroundUnavailable"),
                };
            }
        }

        const canUseExistingMemory = plan.action === "rebuild-lexical";

        if (plan.reason === "first-use") {
            if (preparationOwnerSignal?.aborted) {
                return { decision: "cancel" };
            }
            const prepareLifecycle = this.lifecycleVersion;
            void this.prepareMemoryForChat(plan, preparationOwnerSignal).then((result) => {
                if (result === null) return;
                if (!this.isLifecycleCurrent(prepareLifecycle)) return;
                if (!result.ok) {
                    this.host.log("Background memory prepare did not succeed", result.message);
                    new Notice(result.message ?? memoryT("plugin.memory.error.prepareFailedAnswerNow"), 5000);
                }
            }).catch((error) => {
                if (!this.isLifecycleCurrent(prepareLifecycle)) return;
                this.host.log("Background memory prepare failed", error);
                new Notice(memoryT("plugin.memory.error.prepareFailedAnswerNow"), 5000);
            });
            if (signal?.aborted) {
                return { decision: "cancel" };
            }
            return {
                decision: "answer-now",
                message: memoryT("plugin.memory.message.buildingInBackground"),
            };
        }

        if (this.isAnswerNowCoolingDown()) {
            return {
                decision: canUseExistingMemory ? "use-memory" : "answer-now",
                message: canUseExistingMemory
                    ? memoryT("plugin.memory.message.usingLastPrepared")
                    : memoryT("plugin.memory.message.notUsed"),
            };
        }

        const decision = signal
            ? await this.requestApproval(plan, "chat", signal)
            : await this.requestApproval(plan);
        if (signal?.aborted) {
            return { decision: "cancel" };
        }
        if (decision === "cancel") {
            return { decision: "cancel" };
        }

        if (decision === "answer-now") {
            this.lastAnswerNowAt = Date.now();
            return {
                decision: canUseExistingMemory ? "use-memory" : "answer-now",
                message: canUseExistingMemory
                    ? memoryT("plugin.memory.message.usingLastPrepared")
                    : memoryT("plugin.memory.message.notUsed"),
            };
        }

        if (!this.isLifecycleCurrent(lifecycleToken) || !this.isMemoryEnabled()) {
            return { decision: "answer-now" };
        }

        const result = await this.prepareMemoryForChat(plan, signal);
        if (result === null || signal?.aborted) {
            return { decision: "cancel" };
        }
        if (!this.isLifecycleCurrent(lifecycleToken)) {
            return { decision: "answer-now" };
        }
        if (!result.ok) {
            new Notice(result.message ?? memoryT("plugin.memory.error.prepareFailedAnswerNow"), 7000);
            return {
                decision: canUseExistingMemory ? "use-memory" : "answer-now",
                message: canUseExistingMemory
                    ? memoryT("plugin.memory.message.usingLastPrepared")
                    : result.message ?? memoryT("plugin.memory.message.prepareFailedAnswerNow"),
            };
        }

        return {
            decision: "use-memory",
            message: result.partial ? memoryT("plugin.memory.notice.updatedPartial") : undefined,
        };
    }

    async prepareMemory(plan: MemoryMaintenancePlan): Promise<MemoryPrepareResult> {
        return this.acquirePreparation(plan, "shared").promise;
    }

    private prepareMemoryForChat(
        plan: MemoryMaintenancePlan,
        ownerSignal?: AbortSignal,
    ): Promise<MemoryPrepareResult | null> {
        if (ownerSignal?.aborted) {
            return Promise.resolve(null);
        }
        const acquisition = this.acquirePreparation(plan, "chat");
        if (!acquisition.run) {
            return acquisition.promise.then((result) => (
                ownerSignal?.aborted ? null : result
            ));
        }
        return this.waitForChatPreparation(acquisition.run, ownerSignal);
    }

    private acquirePreparation(
        plan: MemoryMaintenancePlan,
        origin: ActivePreparationRun["origin"],
    ): MemoryPreparationAcquisition {
        if (!this.isMemoryEnabled() || this.shuttingDown) {
            return { promise: Promise.resolve({
                ok: false,
                partial: false,
                message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
            }), run: null };
        }
        const requestedAction = this.getPreparationAction(plan);
        const activePreparation = this.activePreparationRun;
        if (activePreparation) {
            if (this.canReuseActivePreparation(activePreparation, requestedAction)) {
                if (origin === "shared") {
                    activePreparation.hasSharedConsumer = true;
                }
                return { promise: activePreparation.promise, run: activePreparation };
            }
            if (this.isActivePreparationCurrent(activePreparation)) {
                return { promise: Promise.resolve({
                    ok: false,
                    partial: false,
                    message: memoryT("plugin.memory.notice.actionAlreadyRunning"),
                }), run: null };
            }
        }

        const activeIdentity: ActivePreparationIdentity = {
            id: this.nextPreparationId++,
            action: requestedAction,
            lifecycleVersion: this.lifecycleVersion,
            controller: new AbortController(),
        };
        const promise = this.trackActiveOperation(
            Promise.resolve().then(() => this.runPreparation(plan, activeIdentity)),
        );
        const run: ActivePreparationRun = {
            ...activeIdentity,
            promise,
            origin,
            hasSharedConsumer: origin === "shared",
            chatConsumers: new Set<number>(),
        };
        this.activePreparationRun = run;
        const clear = () => {
            this.clearActivePreparation(activeIdentity);
        };
        void promise.then(clear, clear);
        return { promise, run };
    }

    private waitForChatPreparation(
        run: ActivePreparationRun,
        signal?: AbortSignal,
    ): Promise<MemoryPrepareResult | null> {
        const consumerId = this.nextChatPreparationConsumerId++;
        run.chatConsumers.add(consumerId);
        return new Promise<MemoryPrepareResult | null>((resolve, reject) => {
            let settled = false;
            const cleanup = (aborted: boolean) => {
                run.chatConsumers.delete(consumerId);
                signal?.removeEventListener("abort", onAbort);
                if (aborted) {
                    this.abortUnsharedChatPreparation(run);
                }
            };
            const settle = (
                result: MemoryPrepareResult | null,
                error?: unknown,
                aborted = false,
            ) => {
                if (settled) return;
                settled = true;
                cleanup(aborted);
                if (error !== undefined) {
                    reject(error);
                } else {
                    resolve(result);
                }
            };
            const onAbort = () => settle(null, undefined, true);

            if (signal?.aborted) {
                onAbort();
                return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) {
                onAbort();
                return;
            }
            void run.promise.then(
                (result) => settle(result),
                (error) => settle(null, error),
            );
        });
    }

    private abortUnsharedChatPreparation(run: ActivePreparationRun): void {
        if (run.origin !== "chat" || run.hasSharedConsumer || run.chatConsumers.size > 0) return;
        if (!this.activePreparationRun || !this.isSamePreparation(this.activePreparationRun, run)) return;
        run.controller?.abort();
    }

    private async runPreparation(plan: MemoryMaintenancePlan, activePreparation: ActivePreparationIdentity): Promise<MemoryPrepareResult> {
        const lifecycleToken = activePreparation.lifecycleVersion;
        const action = activePreparation.action;
        const startedAt = Date.now();
        const setActiveStatus = (message: string, event?: VSSProgressEvent) => {
            if (!this.isActivePreparationCurrent(activePreparation)) return;
            this.activePreparationStatus = {
                id: activePreparation.id,
                lifecycleVersion: activePreparation.lifecycleVersion,
                action,
                message,
                phase: event?.phase,
                filesDone: event?.filesDone,
                filesTotal: event?.filesTotal,
                chunksEmbedded: event?.chunksEmbedded,
                chunksTotal: event?.chunksTotal,
                lexicalRowsDone: event?.lexicalRowsDone,
                lexicalRowsTotal: event?.lexicalRowsTotal,
                failed: event?.failed,
                startedAt,
            };
        };
        if (!this.isLifecycleCurrent(lifecycleToken)
            || !this.isMemoryEnabled()
            || activePreparation.controller?.signal.aborted) {
            return {
                ok: false,
                partial: false,
                message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
            };
        }
        const progress = createMemoryProgressNotice(
            action === "rebuild-lexical"
                ? memoryT("plugin.memory.progress.rebuildingSearch")
                : memoryT("plugin.memory.progress.preparing"),
            action === "rebuild-lexical"
                ? () => activePreparation.controller?.abort()
                : undefined,
        );
        setActiveStatus(memoryT("plugin.memory.progress.preparing"));
        const updateProgress = createMemoryProgressUpdater(progress.notice, () => !this.isLifecycleCurrent(lifecycleToken));
        const updateProgressAndStatus = (event: VSSProgressEvent) => {
            if (event.phase === "finalizing" && progress.cancelButton) {
                progress.cancelButton.disabled = true;
            }
            updateProgress(event);
            const text = formatMemoryProgressEvent(event);
            if (text) {
                setActiveStatus(text, event);
            }
        };
        const abortController = activePreparation.controller ?? new AbortController();
        const isRebuild = plan.action !== "refresh";
        const rebuildReason = this.getRebuildRecoveryReason(plan);
        let deferredRebuildHandle: VSSPreparedRebuildHandle | null = null;
        let previousApprovalPolicy: string | null = null;
        const rollbackDeferredRebuild = async () => {
            const handle = deferredRebuildHandle;
            if (!handle || !isRebuild) return;
            await this.vss.rollbackPreparedRebuild(handle, rebuildReason);
            if (deferredRebuildHandle === handle) {
                deferredRebuildHandle = null;
            }
        };
        try {
            if (action === "rebuild-lexical") {
                const lexicalSummary = await this.vss.rebuildLexicalIndex({
                    silent: true,
                    signal: abortController.signal,
                    onProgress: updateProgressAndStatus,
                });
                if (!this.isLifecycleCurrent(lifecycleToken)
                    || abortController.signal.aborted
                    || lexicalSummary.aborted) {
                    return {
                        ok: false,
                        partial: false,
                        message: lexicalSummary.aborted
                            ? memoryT("plugin.memory.progress.cancelled")
                            : memoryT("plugin.memory.message.prepareFailedAnswerNow"),
                    };
                }
                setMemoryProgressStep(progress.notice, memoryT("plugin.memory.progress.ready"));
                setActiveStatus(memoryT("plugin.memory.progress.ready"));
                new Notice(memoryT("plugin.memory.notice.searchReadyNotesUnchanged"), 3000);
                this.host.notifyStatusChanged();
                return { ok: true, partial: false };
            }

            setMemoryProgressStep(progress.notice, memoryT("plugin.memory.progress.checking"));
            setActiveStatus(memoryT("plugin.memory.progress.checking"));
            this.activeOperationControllers.add(abortController);
            if (abortController.signal.aborted) {
                return {
                    ok: false,
                    partial: false,
                    message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
                };
            }
            const operationOptions = {
                silent: true,
                onProgress: updateProgressAndStatus,
                abortSignal: abortController.signal,
                rebuildReason,
                deferAdmission: isRebuild,
            };
            const summary = plan.action === "refresh"
                ? await this.vss.refreshLocalIndex(operationOptions)
                : await this.vss.rebuildLocalIndex(operationOptions);
            const rebuildWasPrepared = isRebuild && !summary.aborted && !(summary.updated === 0 && summary.failed > 0);
            deferredRebuildHandle = rebuildWasPrepared ? summary.preparedRebuildHandle ?? null : null;
            if (rebuildWasPrepared && !deferredRebuildHandle) {
                throw new Error("Memory local state did not return a prepared rebuild handle.");
            }
            if (!this.isLifecycleCurrent(lifecycleToken) || abortController.signal.aborted) {
                await rollbackDeferredRebuild();
                return {
                    ok: false,
                    partial: false,
                    summary,
                    message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
                };
            }
            if (summary.aborted) {
                return {
                    ok: false,
                    partial: false,
                    summary,
                    message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
                };
            }

            if (summary.updated === 0 && summary.failed > 0) {
                return {
                    ok: false,
                    partial: false,
                    summary,
                    message: memoryT("plugin.memory.error.prepareFailedAnswerNow"),
                };
            }

            const partial = summary.failed > 0;
            const policyAdmission = await this.enableAutoRefreshAfterPrepare(
                lifecycleToken,
                abortController.signal,
                activePreparation,
            );
            previousApprovalPolicy = policyAdmission.previousPolicy;
            if (!policyAdmission.enabled || !this.isLifecycleCurrent(lifecycleToken) || abortController.signal.aborted) {
                await rollbackDeferredRebuild();
                return {
                    ok: false,
                    partial: false,
                    summary,
                    message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
                };
            }
            if (isRebuild) {
                const rebuildHandle = deferredRebuildHandle;
                if (!rebuildHandle) {
                    throw new Error("Memory local state lost the prepared rebuild handle before admission.");
                }
                const admitted = await this.vss.admitPreparedRebuild(rebuildHandle, { abortSignal: abortController.signal });
                if (!admitted || !this.isLifecycleCurrent(lifecycleToken) || abortController.signal.aborted) {
                    await rollbackDeferredRebuild();
                    if (previousApprovalPolicy !== null) {
                        await this.restoreMemoryApprovalPolicy(previousApprovalPolicy, activePreparation);
                    }
                    return {
                        ok: false,
                        partial: false,
                        summary,
                        message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
                    };
                }
                deferredRebuildHandle = null;
            }
            this.releaseMemoryAdmissionOwner(activePreparation);
            setMemoryProgressStep(progress.notice, memoryT("plugin.memory.progress.ready"));
            setActiveStatus(memoryT("plugin.memory.progress.ready"));
            if (partial) {
                new Notice(memoryT("plugin.memory.notice.updatedPartial"), 5000);
            } else if (summary.storagePersisted === false && Platform.isMobile) {
                new Notice(memoryT("plugin.memory.notice.prepareAgainLater"), 5000);
            } else {
                new Notice(memoryT("plugin.memory.notice.readyNotesUnchanged"), 3000);
            }

            if (this.isLifecycleCurrent(lifecycleToken)) {
                this.scheduleReconcile("prepare", PREPARE_RECONCILE_DELAY_MS);
                this.host.notifyStatusChanged();
            }
            return { ok: true, partial, summary };
        } catch (error) {
            const shouldRestoreAdmissionPolicy = deferredRebuildHandle !== null
                && previousApprovalPolicy !== null
                && this.isMemoryAdmissionOwner(activePreparation);
            try {
                await rollbackDeferredRebuild();
            } catch (rollbackError) {
                this.host.log("Could not roll back prepared memory", rollbackError);
            }
            if (shouldRestoreAdmissionPolicy && previousApprovalPolicy !== null) {
                try {
                    await this.restoreMemoryApprovalPolicy(previousApprovalPolicy, activePreparation);
                } catch (policyRollbackError) {
                    this.host.log("Could not restore Memory approval policy", policyRollbackError);
                }
            }
            if (!this.isLifecycleCurrent(lifecycleToken) || abortController.signal.aborted) {
                return {
                    ok: false,
                    partial: false,
                    message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
                };
            }
            this.host.log("Could not prepare memory", error);
            return {
                ok: false,
                partial: false,
                message: getMemoryPrepareFailureMessage(error),
            };
        } finally {
            this.activeOperationControllers.delete(abortController);
            this.clearActivePreparationStatus(activePreparation);
            progress.notice.hide();
        }
    }

    async prepareFromCommand(): Promise<void> {
        await this.runManualCommand(async () => {
            const plan = await this.getMaintenancePlan();
            await this.runApprovedCommandPlan(plan);
        });
    }

    async updateFromCommand(): Promise<void> {
        await this.runManualCommand(async () => {
            const plan = await this.getMaintenancePlan();
            const actionPlan: MemoryMaintenancePlan = plan.reason === "ready"
                ? {
                    ...plan,
                    reason: "changed-notes",
                    action: "refresh",
                    notesLikelyToUpdate: plan.notesToCheck,
                    requiresApproval: true,
                }
                : plan;
            await this.runApprovedCommandPlan(actionPlan);
        });
    }

    private async runManualCommand(command: () => Promise<void>): Promise<void> {
        if (this.manualCommandInFlight) {
            new Notice(memoryT("plugin.memory.notice.actionAlreadyRunning"), 4000);
            return;
        }
        this.manualCommandInFlight = true;
        try {
            await command();
        } finally {
            this.manualCommandInFlight = false;
        }
    }

    private async runApprovedCommandPlan(plan: MemoryMaintenancePlan): Promise<void> {
        if (plan.reason === "ready") {
            new Notice(memoryT("plugin.memory.notice.readyNotesUnchanged"), 3000);
            return;
        }
        if (plan.reason === "unavailable") {
            new Notice(memoryT("plugin.memory.notice.unavailableAskNormally"), 5000);
            return;
        }
        const actionPlan: MemoryMaintenancePlan = plan.action === "none"
            ? { ...plan, action: "rebuild", requiresApproval: true }
            : plan;
        const decision = await this.requestApproval(actionPlan, "command");
        if (decision !== "use-memory") return;
        if (!this.isMemoryEnabled() || this.shuttingDown) return;
        const result = await this.prepareMemory(actionPlan);
        if (!result.ok) {
            new Notice(result.message ?? memoryT("plugin.notice.memoryPrepareFailed"), 7000);
        }
    }

    private enqueueBackgroundTask(kind: BackgroundTaskKind, reason: string): void {
        const run = this.trackActiveOperation(this.maintenanceQueue.then(
            () => this.runBackgroundTask(kind, reason),
            () => this.runBackgroundTask(kind, reason),
        ));
        this.maintenanceQueue = run.then(() => undefined, () => undefined);
        void run;
    }

    async waitForIdle(): Promise<void> {
        while (this.activeOperationPromises.size > 0) {
            await Promise.allSettled(Array.from(this.activeOperationPromises));
        }
        await this.maintenanceQueue.catch(() => undefined);
    }

    private trackActiveOperation<T>(operation: Promise<T>): Promise<T> {
        this.activeOperationPromises.add(operation);
        const remove = () => this.activeOperationPromises.delete(operation);
        void operation.then(remove, remove);
        return operation;
    }

    private async runBackgroundTask(kind: BackgroundTaskKind, reason: string): Promise<void> {
        const lifecycleToken = this.lifecycleVersion;
        let abortController: AbortController | null = null;
        try {
            if (!this.isLifecycleCurrent(lifecycleToken)) return;
            if (kind === "verify") {
                if (!this.isMemoryEnabled()) return;
                if (!await this.canRunLocalMaintenance()) return;
            } else if (!await this.canRunAutoMaintenance()) {
                return;
            }
            if (!this.isLifecycleCurrent(lifecycleToken)) return;
            abortController = new AbortController();
            this.activeOperationControllers.add(abortController);
            if (!this.isLifecycleCurrent(lifecycleToken)) {
                abortController.abort();
                return;
            }
            if (kind === "flush") {
                const summary = await this.vss.flush({
                    silent: true,
                    reason: "auto-refresh",
                    abortSignal: abortController.signal,
                });
                if (!this.isLifecycleCurrent(lifecycleToken)) return;
                if (summary.aborted) return;
                if (summary.failed > 0) {
                    throw new Error(`Background memory update skipped ${summary.failed} note(s).`);
                }
                if (!summary.aborted) {
                    this.host.notifyStatusChanged();
                }
                if (this.vss.hasDirtyChanges()) {
                    this.scheduleAutoFlush("dirty-pending", QUIET_AUTO_FLUSH_DELAY_MS);
                }
            } else if (kind === "verify") {
                const summary = await this.vss.verifyPendingChanges({
                    reason,
                    abortSignal: abortController.signal,
                });
                if (!this.isLifecycleCurrent(lifecycleToken)) return;
                if (summary.aborted) return;
                if (!summary.aborted) {
                    this.host.notifyStatusChanged();
                }
                if (summary.dirtyConfirmed > 0 || this.vss.hasDirtyChanges()) {
                    this.scheduleAutoFlush("verify", 0);
                }
                const hasPendingVerification = summary.hasMore || this.vss.hasPendingVerification();
                if (summary.failed > 0) {
                    this.host.log("Background memory verification skipped some notes", { failed: summary.failed });
                    const delay = AUTO_FLUSH_RETRY_DELAYS_MS[Math.min(this.backgroundFailureCount, AUTO_FLUSH_RETRY_DELAYS_MS.length - 1)];
                    this.backgroundFailureCount++;
                    if (hasPendingVerification) {
                        this.scheduleVerify(`retry:${reason}`, delay);
                    }
                    return;
                }
                if (hasPendingVerification) {
                    this.scheduleVerify(reason);
                }
            } else {
                const summary = await this.vss.reconcileLocalFiles({
                    reason,
                    verifyHashLimit: reason === "periodic" ? 50 : 0,
                    abortSignal: abortController.signal,
                });
                if (!this.isLifecycleCurrent(lifecycleToken)) return;
                if (summary.aborted) return;
                if (summary.failed > 0) {
                    throw new Error(`Background memory reconcile failed for ${summary.failed} note(s).`);
                }
                if (!summary.aborted) {
                    this.host.notifyStatusChanged();
                }
                if (summary.hasMore) {
                    this.scheduleReconcile(reason, 1_000);
                }
                if (summary.verificationQueued > 0 || this.vss.hasPendingVerification()) {
                    this.scheduleVerify("reconcile");
                }
                if (summary.markedDirty > 0 || this.vss.hasDirtyChanges()) {
                    this.scheduleAutoFlush("reconcile", 0);
                }
            }
            this.backgroundFailureCount = 0;
        } catch (error) {
            if (abortController?.signal.aborted || !this.isLifecycleCurrent(lifecycleToken)) return;
            this.host.log("Background memory maintenance failed", { kind, reason, error });
            const delay = AUTO_FLUSH_RETRY_DELAYS_MS[Math.min(this.backgroundFailureCount, AUTO_FLUSH_RETRY_DELAYS_MS.length - 1)];
            this.backgroundFailureCount++;
            if (kind === "flush") {
                this.scheduleAutoFlush(`retry:${reason}`, delay);
            } else if (kind === "verify") {
                this.scheduleVerify(`retry:${reason}`, delay);
            } else {
                this.scheduleReconcile(`retry:${reason}`, delay);
            }
        } finally {
            if (abortController) {
                this.activeOperationControllers.delete(abortController);
            }
        }
    }

    private shouldTryChatFastVerification(plan: MemoryMaintenancePlan): boolean {
        return (plan.reason === "ready" || plan.action === "none" && !plan.requiresApproval)
            && Boolean(plan.verificationPending && plan.verificationPending > 0);
    }

    private async verifyPendingBeforeChat(
        lifecycleToken: number,
        signal?: AbortSignal,
    ): Promise<void> {
        const abortController = new AbortController();
        const abortFromChat = () => abortController.abort();
        this.activeOperationControllers.add(abortController);
        if (signal?.aborted) {
            abortController.abort();
        } else {
            signal?.addEventListener("abort", abortFromChat, { once: true });
        }
        try {
            if (abortController.signal.aborted) return;
            const summary = await this.vss.verifyPendingChanges({
                reason: "chat",
                fastPath: true,
                abortSignal: abortController.signal,
            });
            if (abortController.signal.aborted || !this.isLifecycleCurrent(lifecycleToken)) return;
            if (summary.aborted) return;
            if (!summary.aborted) {
                this.host.notifyStatusChanged();
            }
            if (summary.dirtyConfirmed > 0 || this.vss.hasDirtyChanges()) {
                this.scheduleAutoFlush("verify", 0);
            }
            const hasPendingVerification = summary.hasMore || this.vss.hasPendingVerification();
            if (summary.failed > 0) {
                this.host.log("Chat memory verification skipped some notes", { failed: summary.failed });
                const delay = AUTO_FLUSH_RETRY_DELAYS_MS[Math.min(this.backgroundFailureCount, AUTO_FLUSH_RETRY_DELAYS_MS.length - 1)];
                this.backgroundFailureCount++;
                if (hasPendingVerification) {
                    this.scheduleVerify("chat-retry", delay);
                }
            } else if (hasPendingVerification) {
                this.scheduleVerify("chat");
            }
        } catch (error) {
            if (abortController.signal.aborted || !this.isLifecycleCurrent(lifecycleToken)) return;
            this.host.log("Chat memory verification failed", error);
            this.scheduleVerify("chat-retry");
        } finally {
            signal?.removeEventListener("abort", abortFromChat);
            this.activeOperationControllers.delete(abortController);
        }
    }

    private isAutoPolicyEnabled(): boolean {
        return this.isMemoryEnabled()
            && this.host.settings.memoryApprovalPolicy === AUTO_MEMORY_POLICY;
    }

    private isMemoryEnabled(): boolean {
        return this.host.settings.memoryEnabled;
    }

    private isLifecycleCurrent(token: number): boolean {
        return !this.shuttingDown && token === this.lifecycleVersion;
    }

    private getPreparationAction(plan: MemoryMaintenancePlan): MemoryPreparationAction {
        if (plan.action === "refresh") return "refresh";
        if (plan.action === "rebuild-lexical") return "rebuild-lexical";
        return "rebuild";
    }

    private canReuseActivePreparation(activePreparation: ActivePreparationRun, requestedAction: MemoryPreparationAction): boolean {
        if (!this.isActivePreparationCurrent(activePreparation)) return false;
        if (activePreparation.controller?.signal.aborted) return false;
        return activePreparation.action === requestedAction
            || activePreparation.action === "rebuild" && requestedAction === "refresh";
    }

    private isActivePreparationCurrent(activePreparation: ActivePreparationIdentity): boolean {
        return Boolean(
            this.activePreparationRun
            && this.isSamePreparation(this.activePreparationRun, activePreparation)
            && this.isLifecycleCurrent(activePreparation.lifecycleVersion),
        );
    }

    private isSamePreparation(left: ActivePreparationIdentity, right: ActivePreparationIdentity): boolean {
        return left.id === right.id && left.lifecycleVersion === right.lifecycleVersion;
    }

    private clearActivePreparation(activePreparation: ActivePreparationIdentity): void {
        if (this.activePreparationRun && this.isSamePreparation(this.activePreparationRun, activePreparation)) {
            this.activePreparationRun = null;
        }
        this.clearActivePreparationStatus(activePreparation);
    }

    private clearActivePreparationStatus(activePreparation: ActivePreparationIdentity): void {
        if (this.activePreparationStatus && this.isSamePreparation(this.activePreparationStatus, activePreparation)) {
            this.activePreparationStatus = null;
        }
    }

    private async canRunAutoMaintenance(): Promise<boolean> {
        if (!this.isAutoPolicyEnabled()) return false;
        return this.canRunLocalMaintenance();
    }

    private async canRunLocalMaintenance(): Promise<boolean> {
        try {
            return await this.vss.canAutoMaintain();
        } catch (error) {
            this.host.log("Could not check background memory readiness", error);
            return false;
        }
    }

    private async enableAutoRefreshAfterPrepare(
        lifecycleToken: number,
        abortSignal: AbortSignal,
        activePreparation: ActivePreparationIdentity,
    ): Promise<MemoryPolicyAdmissionResult> {
        if (!this.isLifecycleCurrent(lifecycleToken) || abortSignal.aborted || !this.isMemoryEnabled()) {
            return { enabled: false, previousPolicy: null };
        }
        const pendingAdmission = this.memoryAdmissionOwner;
        if (this.host.settings.memoryApprovalPolicy === AUTO_MEMORY_POLICY && !pendingAdmission) {
            return { enabled: true, previousPolicy: null };
        }
        const previousPolicy = pendingAdmission?.previousPolicy ?? this.host.settings.memoryApprovalPolicy;
        this.memoryAdmissionOwner = { ...activePreparation, previousPolicy };
        if (this.host.settings.memoryApprovalPolicy !== AUTO_MEMORY_POLICY) {
            this.host.updateMemorySetting("memoryApprovalPolicy", AUTO_MEMORY_POLICY);
        }
        try {
            await this.host.persistMemoryAdmissionSettings();
        } catch (error) {
            if (!this.isMemoryAdmissionOwner(activePreparation)) {
                throw error;
            }
            if (this.host.settings.memoryApprovalPolicy === AUTO_MEMORY_POLICY) {
                this.host.updateMemorySetting("memoryApprovalPolicy", previousPolicy);
            }
            try {
                await this.host.persistMemoryAdmissionSettings();
            } catch (compensationError) {
                this.releaseMemoryAdmissionOwner(activePreparation);
                throw Object.assign(new Error("Could not persist or compensate the Memory approval policy."), {
                    cause: error,
                    compensationError,
                });
            }
            this.releaseMemoryAdmissionOwner(activePreparation);
            throw error;
        }
        if (this.isLifecycleCurrent(lifecycleToken) && !abortSignal.aborted && this.isMemoryEnabled()) {
            return { enabled: true, previousPolicy };
        }
        if (this.isMemoryAdmissionOwner(activePreparation)
            && this.host.settings.memoryApprovalPolicy === AUTO_MEMORY_POLICY) {
            this.host.updateMemorySetting("memoryApprovalPolicy", previousPolicy);
            await this.host.persistMemoryAdmissionSettings();
        }
        this.releaseMemoryAdmissionOwner(activePreparation);
        return { enabled: false, previousPolicy };
    }

    private async restoreMemoryApprovalPolicy(
        previousPolicy: string,
        activePreparation: ActivePreparationIdentity,
    ): Promise<void> {
        if (!this.isMemoryAdmissionOwner(activePreparation)) return;
        if (this.host.settings.memoryApprovalPolicy !== previousPolicy) {
            this.host.updateMemorySetting("memoryApprovalPolicy", previousPolicy);
        }
        await this.host.persistMemoryAdmissionSettings();
        this.releaseMemoryAdmissionOwner(activePreparation);
    }

    private isMemoryAdmissionOwner(activePreparation: ActivePreparationIdentity): boolean {
        return Boolean(
            this.memoryAdmissionOwner
            && this.isSamePreparation(this.memoryAdmissionOwner, activePreparation),
        );
    }

    private releaseMemoryAdmissionOwner(activePreparation: ActivePreparationIdentity): void {
        if (this.isMemoryAdmissionOwner(activePreparation)) {
            this.memoryAdmissionOwner = null;
        }
    }

    private getRebuildRecoveryReason(plan: MemoryMaintenancePlan): MemoryRebuildRecoveryReason {
        if (plan.reason === "first-use") return "first-use";
        if (plan.reason === "local-memory-missing") return "local-memory-missing";
        return "settings-changed";
    }

    private getVerifyDelayMs(): number {
        return Platform.isMobile ? MOBILE_VERIFY_DELAY_MS : DESKTOP_VERIFY_DELAY_MS;
    }

    private requestApproval(
        plan: MemoryMaintenancePlan,
        context: MemoryApprovalContext = "chat",
        signal?: AbortSignal,
    ): Promise<MemoryDecision> {
        if (signal?.aborted) {
            return Promise.resolve("cancel");
        }
        return new Promise((resolve) => {
            new MemoryApprovalModal(this.host.app, plan, resolve, context, signal).open();
        });
    }

    private isAnswerNowCoolingDown(): boolean {
        return Date.now() - this.lastAnswerNowAt < DECLINE_COOLDOWN_MS;
    }
}

function getMemoryPrepareFailureMessage(error: unknown): string {
    const code = getErrorCode(error);
    if (code === "opfs-sahpool-locked") {
        return memoryT("plugin.memory.error.localStorageBusy");
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Local memory storage is busy")) {
        return memoryT("plugin.memory.error.localStorageBusy");
    }
    return memoryT("plugin.memory.message.prepareFailedAnswerNow");
}

function getErrorCode(error: unknown): string | undefined {
    if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
        return (error as { code: string }).code;
    }
    return undefined;
}

export class MemoryApprovalModal extends Modal {
    private readonly plan: MemoryMaintenancePlan;
    private readonly onDecision: (decision: MemoryDecision) => void;
    private readonly context: MemoryApprovalContext;
    private readonly signal?: AbortSignal;
    private settled = false;
    private abortListenerAttached = false;

    constructor(
        app: App,
        plan: MemoryMaintenancePlan,
        onDecision: (decision: MemoryDecision) => void,
        context: MemoryApprovalContext = "chat",
        signal?: AbortSignal,
    ) {
        super(app);
        this.plan = plan;
        this.onDecision = onDecision;
        this.context = context;
        this.signal = signal;
    }

    onOpen(): void {
        if (this.signal?.aborted) {
            this.resolve("cancel");
            return;
        }
        if (this.signal) {
            this.signal.addEventListener("abort", this.handleAbort, { once: true });
            this.abortListenerAttached = true;
            if (this.signal.aborted) {
                this.resolve("cancel");
                return;
            }
        }
        const { contentEl } = this;
        const locale = getPluginUiLanguage();
        const copy = getMemoryApprovalCopy(this.plan, this.context, locale);
        contentEl.empty();
        contentEl.addClass("pa-memory-modal");
        contentEl.createEl("h2", { text: copy.title });
        contentEl.createEl("p", {
            cls: "pa-memory-modal__intro",
            text: pluginT("plugin.memory.approval.intro", locale),
        });

        for (const section of getLocalizedMemoryApprovalSections(this.plan, locale)) {
            this.addSection(section.title, section.body);
        }

        const details = contentEl.createDiv({ cls: "pa-memory-modal__details" });
        details.createDiv({
            text: pluginT("plugin.memory.approval.notesToCheck", locale, { count: this.plan.notesToCheck }),
        });
        if (typeof this.plan.notesLikelyToUpdate === "number") {
            details.createDiv({
                text: pluginT("plugin.memory.approval.notesLikelyToUpdate", locale, { count: this.plan.notesLikelyToUpdate }),
            });
        }
        details.createDiv({ text: pluginT("plugin.memory.approval.device", locale) });

        new Setting(contentEl)
            .addButton((button) => {
                button
                    .setCta()
                    .setButtonText(copy.primaryAction)
                    .onClick(() => this.resolve("use-memory"));
            })
            .addButton((button) => {
                if (this.context === "chat") {
                    button
                        .setButtonText(copy.secondaryAction)
                        .onClick(() => this.resolve("answer-now"));
                    return;
                }
                button
                    .setButtonText(copy.cancelAction)
                    .onClick(() => this.resolve("cancel"));
            });
        if (this.context === "chat") {
            new Setting(contentEl)
                .addButton((button) => {
                    button
                        .setButtonText(copy.cancelAction)
                        .onClick(() => this.resolve("cancel"));
                });
        }
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.settled) {
            this.settle("cancel");
        }
    }

    private addSection(title: string, body: string): void {
        const section = this.contentEl.createDiv({ cls: "pa-memory-modal__section" });
        section.createDiv({ cls: "pa-memory-modal__section-title", text: title });
        section.createDiv({ cls: "pa-memory-modal__section-body", text: body });
    }

    private resolve(decision: MemoryDecision): void {
        if (!this.settle(decision)) return;
        this.close();
    }

    private readonly handleAbort = (): void => {
        this.resolve("cancel");
    };

    private settle(decision: MemoryDecision): boolean {
        if (this.settled) return false;
        this.settled = true;
        if (this.abortListenerAttached) {
            this.signal?.removeEventListener("abort", this.handleAbort);
            this.abortListenerAttached = false;
        }
        this.onDecision(decision);
        return true;
    }
}

function createMemoryProgressNotice(
    title: string,
    onCancel?: () => void,
): { notice: Notice; cancelButton?: HTMLButtonElement } {
    const fragment = getPlatformDocument().createDocumentFragment();
    const wrapper = fragment.createEl("div", { attr: { class: "pa-notice" } });
    const header = wrapper.createDiv({ cls: "pa-notice__header" });
    const spinner = header.createDiv({ cls: "pa-notice__spinner" });
    spinner.createSpan({ text: "" });
    header.createSpan({ text: title, attr: { class: "pa-notice__text" } });
    let cancelButton: HTMLButtonElement | undefined;
    if (onCancel) {
        cancelButton = header.createEl("button", {
            text: memoryT("plugin.memory.approval.cancel"),
            attr: { type: "button" },
        });
        cancelButton.addEventListener("click", onCancel, { once: true });
    }
    wrapper.createDiv({ cls: "pa-notice__body" });
    const notice = new Notice(fragment, 0);
    notice.messageEl.addClass("pa-notice-shell");
    notice.messageEl.parentElement?.addClass("pa-notice-shell");
    notice.messageEl.setCssStyles({
        background: "transparent",
        boxShadow: "none",
        border: "none",
        padding: "0",
    });
    return { notice, cancelButton };
}

function setMemoryProgressStep(notice: Notice, text: string): void {
    const body = notice.messageEl.querySelector<HTMLElement>(".pa-notice__body");
    if (!body) return;
    body.empty();
    body.createEl("div", {
        cls: "pa-notice__item",
        text,
    });
}

function createMemoryProgressUpdater(notice: Notice, shouldStop: () => boolean = () => false): (event: VSSProgressEvent) => void {
    let lastUpdatedAt = 0;
    return (event) => {
        if (shouldStop()) return;
        const text = formatMemoryProgressEvent(event);
        if (!text) return;
        const now = Date.now();
        const force = event.phase === "retrying" || event.phase === "finalizing" || event.phase === "ready";
        if (!force && now - lastUpdatedAt < 350) return;
        lastUpdatedAt = now;
        setMemoryProgressStep(notice, text);
    };
}

function formatMemoryProgressEvent(event: VSSProgressEvent): string {
    if (event.phase === "retrying") {
        const seconds = Math.max(1, Math.ceil((event.retryDelayMs ?? 0) / 1000));
        return `Retrying in ${seconds}s`;
    }
    if (event.phase === "ready") {
        return "Ready";
    }
    if (event.phase === "cancelling") {
        return memoryT("plugin.memory.progress.cancelling");
    }
    if (event.phase === "finalizing") {
        return memoryT("plugin.memory.progress.finalizingSearch");
    }
    if (event.phase === "lexical-rebuilding") {
        return formatCountProgress(
            memoryT("plugin.memory.progress.rebuildingSearch"),
            event.lexicalRowsDone,
            event.lexicalRowsTotal,
        );
    }
    if (event.phase === "writing") {
        return formatCountProgress("Saving memory", event.filesDone, event.filesTotal);
    }
    if (event.phase === "embedding") {
        return formatCountProgress("Preparing notes", event.chunksEmbedded, event.chunksTotal);
    }
    if (event.phase === "scanning") {
        return formatCountProgress("Checking notes", event.filesDone, event.filesTotal, event.currentFile);
    }
    return "";
}

function formatCountProgress(label: string, done?: number, total?: number, detail?: string): string {
    const count = typeof done === "number" && typeof total === "number" && total > 0
        ? ` ${Math.min(done, total)}/${total}`
        : "";
    const suffix = detail ? `: ${detail}` : "";
    return `${label}${count}${suffix}`;
}

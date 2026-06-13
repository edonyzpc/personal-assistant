/* Copyright 2023 edonyzpc */

import { Modal, Notice, Platform, Setting } from "obsidian";
import type { PluginManager } from "./plugin";
import type { VSSOperationSummary, VSSProgressEvent } from "./vss";
import { getPluginUiLanguage, pluginT, type PluginLocale } from "./locales/plugin";

export type MemoryDecision = "use-memory" | "answer-now" | "cancel";
export type MemoryMode = "auto" | "use-memory" | "skip-memory";

export type MemoryPlanReason =
    | "ready"
    | "first-use"
    | "changed-notes"
    | "local-memory-missing"
    | "settings-changed"
    | "unavailable";

export interface MemoryMaintenancePlan {
    reason: MemoryPlanReason;
    action: "none" | "refresh" | "rebuild";
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

function getLocalizedMemoryApprovalSections(locale: PluginLocale): typeof MEMORY_APPROVAL_SECTIONS {
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
        "unavailable": pluginT("plugin.memory.approval.title.unavailable", locale),
    };

    return {
        title: titleByReason[plan.reason],
        primaryAction: plan.action === "refresh"
            ? pluginT("plugin.memory.approval.primary.update", locale)
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
    private readonly plugin: PluginManager;
    private lastAnswerNowAt = 0;
    private started = false;
    private autoFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private verifyTimer: ReturnType<typeof setTimeout> | null = null;
    private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    private periodicReconcileTimer: ReturnType<typeof setInterval> | null = null;
    private maintenanceQueue: Promise<void> = Promise.resolve();
    private backgroundFailureCount = 0;
    private readonly cleanupListeners: Array<() => void> = [];
    private lifecycleVersion = 0;
    private shuttingDown = false;

    constructor(plugin: PluginManager) {
        this.plugin = plugin;
    }

    async getMaintenancePlan(): Promise<MemoryMaintenancePlan> {
        return this.plugin.vss.getMemoryReadiness();
    }

    startAutoMaintenance(): void {
        if (this.started) return;
        this.started = true;
        this.shuttingDown = false;
        this.lifecycleVersion++;
        this.scheduleReconcile("startup", STARTUP_RECONCILE_DELAY_MS);
        this.periodicReconcileTimer = setInterval(() => {
            this.scheduleReconcile("periodic");
        }, PERIODIC_RECONCILE_INTERVAL_MS);

        const scheduleResume = () => this.scheduleReconcile("resume", RESUME_RECONCILE_DELAY_MS);
        if (typeof window !== "undefined") {
            window.addEventListener("focus", scheduleResume);
            this.cleanupListeners.push(() => window.removeEventListener("focus", scheduleResume));
        }
        if (typeof document !== "undefined") {
            const onVisibilityChange = () => {
                if (document.visibilityState === "visible") {
                    scheduleResume();
                }
            };
            document.addEventListener("visibilitychange", onVisibilityChange);
            this.cleanupListeners.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));
        }
    }

    stopAutoMaintenance(): void {
        this.started = false;
        this.shuttingDown = true;
        this.lifecycleVersion++;
        if (this.autoFlushTimer) {
            clearTimeout(this.autoFlushTimer);
            this.autoFlushTimer = null;
        }
        if (this.verifyTimer) {
            clearTimeout(this.verifyTimer);
            this.verifyTimer = null;
        }
        if (this.reconcileTimer) {
            clearTimeout(this.reconcileTimer);
            this.reconcileTimer = null;
        }
        if (this.periodicReconcileTimer) {
            clearInterval(this.periodicReconcileTimer);
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
            clearTimeout(this.autoFlushTimer);
        }
        this.autoFlushTimer = setTimeout(() => {
            this.autoFlushTimer = null;
            this.enqueueBackgroundTask("flush", reason);
        }, Math.max(0, delayMs));
    }

    scheduleVerify(reason: string, delayMs = this.getVerifyDelayMs()): void {
        if (!this.started) return;
        if (!this.isAutoPolicyEnabled()) return;
        if (this.verifyTimer) {
            clearTimeout(this.verifyTimer);
        }
        this.verifyTimer = setTimeout(() => {
            this.verifyTimer = null;
            this.enqueueBackgroundTask("verify", reason);
        }, Math.max(0, delayMs));
    }

    scheduleReconcile(reason: string, delayMs = 0): void {
        if (!this.started) return;
        if (!this.isAutoPolicyEnabled()) return;
        if (this.reconcileTimer) {
            clearTimeout(this.reconcileTimer);
        }
        this.reconcileTimer = setTimeout(() => {
            this.reconcileTimer = null;
            this.enqueueBackgroundTask("reconcile", reason);
        }, Math.max(0, delayMs));
    }

    async ensureReadyForChat(_prompt?: string): Promise<MemoryDecisionResult> {
        const lifecycleToken = this.lifecycleVersion;
        if (!this.plugin.settings.memoryEnabled) {
            return { decision: "answer-now" };
        }

        if (!this.plugin.settings.memoryAutoCheckBeforeChat) {
            return { decision: "use-memory" };
        }

        let plan = await this.getMaintenancePlan();
        if (!this.isLifecycleCurrent(lifecycleToken)) {
            return { decision: "answer-now" };
        }
        if (plan.reason === "unavailable") {
            new Notice(memoryT("plugin.memory.notice.unavailableAnswerNow"), 5000);
            return {
                decision: "answer-now",
                message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
            };
        }
        if (this.shouldTryChatFastVerification(plan) && await this.canRunLocalMaintenance()) {
            await this.verifyPendingBeforeChat(lifecycleToken);
            if (!this.isLifecycleCurrent(lifecycleToken)) {
                return { decision: "answer-now" };
            }
            plan = await this.getMaintenancePlan();
            if (!this.isLifecycleCurrent(lifecycleToken)) {
                return { decision: "answer-now" };
            }
        }

        if (plan.reason === "ready" || plan.action === "none" && !plan.requiresApproval) {
            return { decision: "use-memory" };
        }

        if (plan.reason === "changed-notes" && this.isAutoPolicyEnabled()) {
            if (await this.canRunAutoMaintenance()) {
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
                this.plugin.log("Memory changed, but background maintenance is waiting for durable local memory.");
                return {
                    decision: "use-memory",
                    message: memoryT("plugin.memory.message.backgroundUnavailable"),
                };
            }
        }

        if (this.isAnswerNowCoolingDown()) {
            return {
                decision: "answer-now",
                message: memoryT("plugin.memory.message.notUsed"),
            };
        }

        const decision = await this.requestApproval(plan);
        if (decision === "cancel") {
            return { decision: "cancel" };
        }

        if (decision === "answer-now") {
            this.lastAnswerNowAt = Date.now();
            return {
                decision: "answer-now",
                message: memoryT("plugin.memory.message.notUsed"),
            };
        }

        const result = await this.prepareMemory(plan);
        if (!this.isLifecycleCurrent(lifecycleToken)) {
            return { decision: "answer-now" };
        }
        if (!result.ok) {
            new Notice(result.message ?? memoryT("plugin.memory.error.prepareFailedAnswerNow"), 7000);
            return {
                decision: "answer-now",
                message: result.message ?? memoryT("plugin.memory.message.prepareFailedAnswerNow"),
            };
        }

        return {
            decision: "use-memory",
            message: result.partial ? memoryT("plugin.memory.notice.updatedPartial") : undefined,
        };
    }

    async prepareMemory(plan: MemoryMaintenancePlan): Promise<MemoryPrepareResult> {
        const lifecycleToken = this.lifecycleVersion;
        const progress = createMemoryProgressNotice(memoryT("plugin.memory.progress.preparing"));
        const updateProgress = createMemoryProgressUpdater(progress.notice, () => !this.isLifecycleCurrent(lifecycleToken));
        try {
            setMemoryProgressStep(progress.notice, memoryT("plugin.memory.progress.checking"));
            const summary = plan.action === "refresh"
                ? await this.plugin.vss.refreshLocalIndex({ silent: true, onProgress: updateProgress })
                : await this.plugin.vss.rebuildLocalIndex({ silent: true, onProgress: updateProgress });
            if (!this.isLifecycleCurrent(lifecycleToken)) {
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

            setMemoryProgressStep(progress.notice, memoryT("plugin.memory.progress.ready"));
            const partial = summary.failed > 0;
            if (partial) {
                new Notice(memoryT("plugin.memory.notice.updatedPartial"), 5000);
            } else if (summary.storagePersisted === false && Platform.isMobile) {
                new Notice(memoryT("plugin.memory.notice.prepareAgainLater"), 5000);
            } else {
                new Notice(memoryT("plugin.memory.notice.readyNotesUnchanged"), 3000);
            }

            await this.enableAutoRefreshAfterPrepare();
            if (this.isLifecycleCurrent(lifecycleToken)) {
                this.scheduleReconcile("prepare", PREPARE_RECONCILE_DELAY_MS);
                await this.plugin.updateMemoryStatusBar();
            }
            return { ok: true, partial, summary };
        } catch (error) {
            if (!this.isLifecycleCurrent(lifecycleToken)) {
                return {
                    ok: false,
                    partial: false,
                    message: memoryT("plugin.memory.message.prepareFailedAnswerNow"),
                };
            }
            this.plugin.log("Could not prepare memory", error);
            return {
                ok: false,
                partial: false,
                message: getMemoryPrepareFailureMessage(error),
            };
        } finally {
            progress.notice.hide();
        }
    }

    async prepareFromCommand(): Promise<void> {
        const plan = await this.getMaintenancePlan();
        await this.runApprovedCommandPlan(plan);
    }

    async updateFromCommand(): Promise<void> {
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
        const result = await this.prepareMemory(actionPlan);
        if (!result.ok) {
            new Notice(result.message ?? memoryT("plugin.notice.memoryPrepareFailed"), 7000);
        }
    }

    private enqueueBackgroundTask(kind: BackgroundTaskKind, reason: string): void {
        const run = this.maintenanceQueue.then(
            () => this.runBackgroundTask(kind, reason),
            () => this.runBackgroundTask(kind, reason),
        );
        this.maintenanceQueue = run.then(() => undefined, () => undefined);
        void run;
    }

    private async runBackgroundTask(kind: BackgroundTaskKind, reason: string): Promise<void> {
        const lifecycleToken = this.lifecycleVersion;
        try {
            if (!this.isLifecycleCurrent(lifecycleToken)) return;
            if (!await this.canRunAutoMaintenance()) return;
            if (!this.isLifecycleCurrent(lifecycleToken)) return;
            if (kind === "flush") {
                const summary = await this.plugin.vss.flush({
                    silent: true,
                    reason: "auto-refresh",
                });
                if (!this.isLifecycleCurrent(lifecycleToken)) return;
                if (summary.failed > 0) {
                    throw new Error(`Background memory update skipped ${summary.failed} note(s).`);
                }
                if (!summary.aborted) {
                    await this.plugin.updateMemoryStatusBar();
                }
                if (this.plugin.vss.hasDirtyChanges()) {
                    this.scheduleAutoFlush("dirty-pending", QUIET_AUTO_FLUSH_DELAY_MS);
                }
            } else if (kind === "verify") {
                const summary = await this.plugin.vss.verifyPendingChanges({ reason });
                if (!this.isLifecycleCurrent(lifecycleToken)) return;
                if (!summary.aborted) {
                    await this.plugin.updateMemoryStatusBar();
                }
                if (summary.dirtyConfirmed > 0 || this.plugin.vss.hasDirtyChanges()) {
                    this.scheduleAutoFlush("verify", 0);
                }
                const hasPendingVerification = summary.hasMore || this.plugin.vss.hasPendingVerification();
                if (summary.failed > 0) {
                    this.plugin.log("Background memory verification skipped some notes", { failed: summary.failed });
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
                const summary = await this.plugin.vss.reconcileLocalFiles({
                    reason,
                    verifyHashLimit: reason === "periodic" ? 50 : 0,
                });
                if (!this.isLifecycleCurrent(lifecycleToken)) return;
                if (summary.failed > 0) {
                    throw new Error(`Background memory reconcile failed for ${summary.failed} note(s).`);
                }
                if (!summary.aborted) {
                    await this.plugin.updateMemoryStatusBar();
                }
                if (summary.hasMore) {
                    this.scheduleReconcile(reason, 1_000);
                }
                if (summary.verificationQueued > 0 || this.plugin.vss.hasPendingVerification()) {
                    this.scheduleVerify("reconcile");
                }
                if (summary.markedDirty > 0 || this.plugin.vss.hasDirtyChanges()) {
                    this.scheduleAutoFlush("reconcile", 0);
                }
            }
            this.backgroundFailureCount = 0;
        } catch (error) {
            if (!this.isLifecycleCurrent(lifecycleToken)) return;
            this.plugin.log("Background memory maintenance failed", { kind, reason, error });
            const delay = AUTO_FLUSH_RETRY_DELAYS_MS[Math.min(this.backgroundFailureCount, AUTO_FLUSH_RETRY_DELAYS_MS.length - 1)];
            this.backgroundFailureCount++;
            if (kind === "flush") {
                this.scheduleAutoFlush(`retry:${reason}`, delay);
            } else if (kind === "verify") {
                this.scheduleVerify(`retry:${reason}`, delay);
            } else {
                this.scheduleReconcile(`retry:${reason}`, delay);
            }
        }
    }

    private shouldTryChatFastVerification(plan: MemoryMaintenancePlan): boolean {
        return (plan.reason === "ready" || plan.action === "none" && !plan.requiresApproval)
            && Boolean(plan.verificationPending && plan.verificationPending > 0);
    }

    private async verifyPendingBeforeChat(lifecycleToken: number): Promise<void> {
        try {
            const summary = await this.plugin.vss.verifyPendingChanges({
                reason: "chat",
                fastPath: true,
            });
            if (!this.isLifecycleCurrent(lifecycleToken)) return;
            if (!summary.aborted) {
                await this.plugin.updateMemoryStatusBar();
            }
            if (summary.dirtyConfirmed > 0 || this.plugin.vss.hasDirtyChanges()) {
                this.scheduleAutoFlush("verify", 0);
            }
            const hasPendingVerification = summary.hasMore || this.plugin.vss.hasPendingVerification();
            if (summary.failed > 0) {
                this.plugin.log("Chat memory verification skipped some notes", { failed: summary.failed });
                const delay = AUTO_FLUSH_RETRY_DELAYS_MS[Math.min(this.backgroundFailureCount, AUTO_FLUSH_RETRY_DELAYS_MS.length - 1)];
                this.backgroundFailureCount++;
                if (hasPendingVerification) {
                    this.scheduleVerify("chat-retry", delay);
                }
            } else if (hasPendingVerification) {
                this.scheduleVerify("chat");
            }
        } catch (error) {
            if (!this.isLifecycleCurrent(lifecycleToken)) return;
            this.plugin.log("Chat memory verification failed", error);
            this.scheduleVerify("chat-retry");
        }
    }

    private isAutoPolicyEnabled(): boolean {
        return this.plugin.settings.memoryEnabled
            && this.plugin.settings.memoryApprovalPolicy === AUTO_MEMORY_POLICY;
    }

    private isLifecycleCurrent(token: number): boolean {
        return !this.shuttingDown && token === this.lifecycleVersion;
    }

    private async canRunAutoMaintenance(): Promise<boolean> {
        if (!this.isAutoPolicyEnabled()) return false;
        return this.canRunLocalMaintenance();
    }

    private async canRunLocalMaintenance(): Promise<boolean> {
        try {
            return await this.plugin.vss.canAutoMaintain();
        } catch (error) {
            this.plugin.log("Could not check background memory readiness", error);
            return false;
        }
    }

    private async enableAutoRefreshAfterPrepare(): Promise<void> {
        if (this.plugin.settings.memoryApprovalPolicy === AUTO_MEMORY_POLICY) return;
        this.plugin.settings.memoryApprovalPolicy = AUTO_MEMORY_POLICY;
        await (this.plugin as { saveSettings?: () => Promise<void> }).saveSettings?.();
    }

    private getVerifyDelayMs(): number {
        return Platform.isMobile ? MOBILE_VERIFY_DELAY_MS : DESKTOP_VERIFY_DELAY_MS;
    }

    private requestApproval(
        plan: MemoryMaintenancePlan,
        context: MemoryApprovalContext = "chat",
    ): Promise<MemoryDecision> {
        return new Promise((resolve) => {
            new MemoryApprovalModal(this.plugin, plan, resolve, context).open();
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
    private readonly plugin: PluginManager;
    private readonly plan: MemoryMaintenancePlan;
    private readonly onDecision: (decision: MemoryDecision) => void;
    private readonly context: MemoryApprovalContext;
    private settled = false;

    constructor(
        plugin: PluginManager,
        plan: MemoryMaintenancePlan,
        onDecision: (decision: MemoryDecision) => void,
        context: MemoryApprovalContext = "chat",
    ) {
        super(plugin.app);
        this.plugin = plugin;
        this.plan = plan;
        this.onDecision = onDecision;
        this.context = context;
    }

    onOpen(): void {
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

        for (const section of getLocalizedMemoryApprovalSections(locale)) {
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
            this.onDecision("cancel");
        }
    }

    private addSection(title: string, body: string): void {
        const section = this.contentEl.createDiv({ cls: "pa-memory-modal__section" });
        section.createDiv({ cls: "pa-memory-modal__section-title", text: title });
        section.createDiv({ cls: "pa-memory-modal__section-body", text: body });
    }

    private resolve(decision: MemoryDecision): void {
        this.settled = true;
        this.onDecision(decision);
        this.close();
    }
}

function createMemoryProgressNotice(title: string): { notice: Notice } {
    const fragment = document.createDocumentFragment();
    const wrapper = fragment.createEl("div", { attr: { class: "pa-notice" } });
    const header = wrapper.createDiv({ cls: "pa-notice__header" });
    const spinner = header.createDiv({ cls: "pa-notice__spinner" });
    spinner.createSpan({ text: "" });
    header.createSpan({ text: title, attr: { class: "pa-notice__text" } });
    wrapper.createDiv({ cls: "pa-notice__body" });
    const notice = new Notice(fragment, 0);
    notice.noticeEl.addClass("pa-notice-shell");
    notice.noticeEl.parentElement?.addClass("pa-notice-shell");
    notice.noticeEl.setCssStyles({
        background: "transparent",
        boxShadow: "none",
        border: "none",
        padding: "0",
    });
    return { notice };
}

function setMemoryProgressStep(notice: Notice, text: string): void {
    const body = notice.noticeEl.querySelector(".pa-notice__body") as HTMLElement | null;
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
        const force = event.phase === "retrying" || event.phase === "ready";
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

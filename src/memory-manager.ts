/* Copyright 2023 edonyzpc */

import { Modal, Notice, Platform, Setting } from "obsidian";
import type { PluginManager } from "./plugin";
import type { VSSOperationSummary } from "./vss";

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
type MemoryApprovalContext = "chat" | "command";

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
        title: "Cost",
        body: "This may use AI credits or API calls. Unchanged notes will be skipped when possible.",
    },
];

export function getMemoryApprovalCopy(
    plan: MemoryMaintenancePlan,
    context: MemoryApprovalContext = "chat",
): MemoryApprovalCopy {
    const titleByReason: Record<MemoryPlanReason, string> = {
        "ready": "Memory is ready",
        "first-use": "Prepare memory from your notes?",
        "changed-notes": "Update memory before answering?",
        "local-memory-missing": "Prepare memory again on this device?",
        "settings-changed": "Prepare memory again for the new AI settings?",
        "unavailable": "Memory is unavailable",
    };

    return {
        title: titleByReason[plan.reason],
        primaryAction: context === "chat" ? "Prepare memory and answer" : "Prepare memory",
        secondaryAction: context === "chat" ? "Answer now" : "Not now",
        cancelAction: "Cancel",
    };
}

export class MemoryManager {
    private readonly plugin: PluginManager;
    private lastAnswerNowAt = 0;

    constructor(plugin: PluginManager) {
        this.plugin = plugin;
    }

    async getMaintenancePlan(): Promise<MemoryMaintenancePlan> {
        return this.plugin.vss.getMemoryReadiness();
    }

    async ensureReadyForChat(_prompt?: string): Promise<MemoryDecisionResult> {
        if (!this.plugin.settings.memoryEnabled) {
            return { decision: "answer-now" };
        }

        if (!this.plugin.settings.memoryAutoCheckBeforeChat) {
            return { decision: "use-memory" };
        }

        const plan = await this.getMaintenancePlan();
        if (plan.reason === "unavailable") {
            new Notice("Memory is unavailable. I will answer normally for now.", 5000);
            return {
                decision: "answer-now",
                message: "I could not prepare memory this time, so I answered normally.",
            };
        }
        if (plan.reason === "ready" || plan.action === "none" && !plan.requiresApproval) {
            return { decision: "use-memory" };
        }

        if (this.isAnswerNowCoolingDown()) {
            return {
                decision: "answer-now",
                message: "Memory was not used for this answer.",
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
                message: "Memory was not used for this answer.",
            };
        }

        const result = await this.prepareMemory(plan);
        if (!result.ok) {
            new Notice(result.message ?? "Could not prepare memory. I will answer normally for now.", 7000);
            return {
                decision: "answer-now",
                message: result.message ?? "I could not prepare memory this time, so I answered normally.",
            };
        }

        return {
            decision: "use-memory",
            message: result.partial ? "Memory was updated, but some notes were skipped." : undefined,
        };
    }

    async prepareMemory(plan: MemoryMaintenancePlan): Promise<MemoryPrepareResult> {
        const progress = createMemoryProgressNotice("Preparing memory...");
        try {
            setMemoryProgressStep(progress.notice, "Checking notes");
            const summary = plan.action === "refresh"
                ? await this.plugin.vss.refreshLocalIndex({ silent: true })
                : await this.plugin.vss.rebuildLocalIndex({ silent: true });
            if (summary.aborted) {
                return {
                    ok: false,
                    partial: false,
                    summary,
                    message: "I could not prepare memory this time, so I answered normally.",
                };
            }

            setMemoryProgressStep(progress.notice, "Ready");
            const partial = summary.failed > 0;
            if (partial) {
                new Notice("Memory was updated, but some notes were skipped.", 5000);
            } else if (summary.storagePersisted === false && Platform.isMobile) {
                new Notice("This device may need to prepare memory again later.", 5000);
            } else {
                new Notice("Memory is ready. Your notes were not changed.", 3000);
            }

            await this.plugin.updateMemoryStatusBar();
            return { ok: true, partial, summary };
        } catch (error) {
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
            new Notice("Memory is ready. Your notes were not changed.", 3000);
            return;
        }
        if (plan.reason === "unavailable") {
            new Notice("Memory is unavailable. You can still ask normally.", 5000);
            return;
        }
        const actionPlan: MemoryMaintenancePlan = plan.action === "none"
            ? { ...plan, action: "rebuild", requiresApproval: true }
            : plan;
        const decision = await this.requestApproval(actionPlan, "command");
        if (decision !== "use-memory") return;
        const result = await this.prepareMemory(actionPlan);
        if (!result.ok) {
            new Notice(result.message ?? "Could not prepare memory.", 7000);
        }
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
        return "Could not prepare memory because local storage is busy. Close other Obsidian windows for this vault, then try again.";
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Local memory storage is busy")) {
        return "Could not prepare memory because local storage is busy. Close other Obsidian windows for this vault, then try again.";
    }
    return "I could not prepare memory this time, so I answered normally.";
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
        const copy = getMemoryApprovalCopy(this.plan, this.context);
        contentEl.empty();
        contentEl.addClass("pa-memory-modal");
        contentEl.createEl("h2", { text: copy.title });
        contentEl.createEl("p", {
            cls: "pa-memory-modal__intro",
            text: "The assistant can use memory from your notes when answering.",
        });

        for (const section of MEMORY_APPROVAL_SECTIONS) {
            this.addSection(section.title, section.body);
        }

        const details = contentEl.createDiv({ cls: "pa-memory-modal__details" });
        details.createDiv({ text: `Notes to check: ${this.plan.notesToCheck}` });
        if (typeof this.plan.notesLikelyToUpdate === "number") {
            details.createDiv({ text: `Notes likely to update: ${this.plan.notesLikelyToUpdate}` });
        }
        details.createDiv({ text: "Device: this device only" });

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

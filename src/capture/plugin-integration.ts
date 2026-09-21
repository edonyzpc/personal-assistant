import { type App, moment as obsidianMoment, Notice } from "obsidian";

import { confirmUserAction } from "../confirm";
import type { PluginMessageKey } from "../locales/plugin";
import { estimateTokens } from "../pagelet/pa-review-cost";
import type { DataBoundaryDecision } from "../pa/contracts";
import type { ReviewQueueCreateInput, ReviewQueueItem, ReviewQueueResult } from "../pa";
import {
    QuickCaptureService,
    type QuickCapturePostProcessInput,
    type QuickCaptureRuntimeSettings,
    type QuickCaptureSettings,
} from "../quick-capture";
import { runQuickCaptureEnrichment } from "../quick-capture-enrichment";

export interface QuickCapturePluginSettings extends QuickCaptureRuntimeSettings {
    aiProvider?: string;
    chatModelName?: string;
    quickCapture: QuickCaptureSettings;
}

interface QuickCaptureChatModel {
    invoke(prompt: string): Promise<unknown>;
}

interface QuickCaptureProviderCost {
    inputTokens: number;
    outputTokens: number;
    provider?: string;
    model?: string;
}

export interface QuickCaptureIntegrationDependencies {
    app: App;
    getSettings(): QuickCapturePluginSettings;
    translate(key: PluginMessageKey, params?: Readonly<Record<string, string | number>>, fallback?: string): string;
    log(message: string, ...args: unknown[]): void;
    decideDataBoundaryForPath(path: string): DataBoundaryDecision;
    createChatModel(): Promise<QuickCaptureChatModel | null>;
    recordProviderCost(usage: QuickCaptureProviderCost): void;
    createReviewQueueItem(input: ReviewQueueCreateInput): Promise<ReviewQueueResult<ReviewQueueItem>>;
    saveSettings(): Promise<void>;
    maybeShowOnboardingNudge(): Promise<void>;
}

const moment = obsidianMoment as unknown as (...args: unknown[]) => { format: (format: string) => string };

export class QuickCapturePluginIntegration {
    private service: QuickCaptureService | null = null;
    private draft = "";

    constructor(private readonly dependencies: QuickCaptureIntegrationDependencies) {}

    openModal(): void {
        if (!this.dependencies.getSettings().quickCapture.enabled) {
            new Notice(this.dependencies.translate("plugin.quickCapture.notice.disabled"), 3000);
            return;
        }
        this.getService().openModal();
    }

    getService(): QuickCaptureService {
        if (this.service) return this.service;
        this.service = new QuickCaptureService({
            app: this.dependencies.app,
            settings: this.dependencies.getSettings(),
            formatDate: (format: string) => moment().format(format),
            now: () => new Date(),
            log: (...args: unknown[]) => this.dependencies.log(args[0] as string, ...args.slice(1)),
            draft: {
                get: () => this.draft,
                set: (value) => { this.draft = value; },
                clear: () => { this.draft = ""; },
            },
            onCaptureSaved: () => {
                void this.dependencies.maybeShowOnboardingNudge();
            },
            postProcessCapture: (input) => this.postProcess(input),
        });
        return this.service;
    }

    reset(): void {
        this.service = null;
    }

    private async postProcess(input: QuickCapturePostProcessInput): Promise<void> {
        const settings = this.dependencies.getSettings();
        if (!settings.quickCapture.postProcessingEnabled) return;
        const boundaryDecision = this.dependencies.decideDataBoundaryForPath(input.path);
        if (boundaryDecision.decision === "deny") {
            this.dependencies.log("Quick Capture post-processing skipped by Data Boundary", boundaryDecision.reason, input.path);
            return;
        }
        const requiresRunDisclosure = boundaryDecision.decision === "ask";
        await runQuickCaptureEnrichment(input, {
            disclosureAccepted: settings.quickCapture.postProcessingDisclosureAccepted && !requiresRunDisclosure,
            dataBoundarySnapshotId: boundaryDecision.reason,
            provider: settings.aiProvider,
            model: settings.chatModelName,
            requestDisclosure: () => confirmUserAction(this.dependencies.app, {
                title: this.dependencies.translate("plugin.quickCapture.disclosure.title"),
                message: this.dependencies.translate("plugin.quickCapture.disclosure.message"),
                confirmText: this.dependencies.translate("plugin.quickCapture.disclosure.confirm"),
            }),
            markDisclosureAccepted: async () => {
                const currentSettings = this.dependencies.getSettings();
                if (currentSettings.quickCapture.postProcessingDisclosureAccepted) return;
                currentSettings.quickCapture.postProcessingDisclosureAccepted = true;
                await this.dependencies.saveSettings();
            },
            invokeModel: async (prompt) => {
                const model = await this.dependencies.createChatModel();
                if (!model) return null;
                const result = await model.invoke(prompt);
                const currentSettings = this.dependencies.getSettings();
                const text = coerceModelResultToString(result);
                this.dependencies.recordProviderCost({
                    inputTokens: estimateTokens(prompt),
                    outputTokens: estimateTokens(text),
                    provider: currentSettings.aiProvider,
                    model: currentSettings.chatModelName,
                });
                return text;
            },
            createReviewQueueItem: (queueInput) => this.dependencies.createReviewQueueItem(queueInput),
            now: () => new Date(),
            log: (...args) => this.dependencies.log(args[0] as string, ...args.slice(1)),
        });
    }
}

function coerceModelResultToString(result: unknown): string {
    if (typeof result === "string") return result;
    const content = (result as { content?: unknown })?.content;
    return content != null ? String(content) : String(result);
}

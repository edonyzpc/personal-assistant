import { Notice, normalizePath, TFile } from "obsidian";

import { buildPageletScopeReviewBundle } from "./scope";
import { PageletReviewModel } from "./pa-review-model";
import { PageletRateLimiter } from "./pa-review-rate-limit";
import { estimateTokens } from "./pa-review-cost";
import { buildPageletRelatedNotesQuery } from "./related-notes-query";
import {
    PageletProviderCallAdmission,
    PageletProviderCallControlError,
} from "./provider-call-admission";
import type { PageletRateLimitStorage } from "./pa-review-rate-limit";
import {
    type PageletReviewHighRiskChoice,
    type PageletReviewHighRiskSummary,
} from "./ReviewHighRiskModal";
import type { AnalyzeCallback } from "./preload/types";
import { pageletT } from "../locales/pagelet";
import type { PageletSettings } from "../settings/pagelet";
import type { PageletCostTracker } from "./pa-review-cost";

export const PAGELET_FOREGROUND_REVIEW_TIMEOUT_MS = 120_000;
export const PAGELET_DISCOVERY_MAX_RELATED_NOTES = 6;
type RetainedReviewChatModel = Awaited<ReturnType<ConstructorParameters<typeof PageletReviewModel>[0]>>;

export interface RetainedReviewSettingsSnapshot {
    pagelet: Pick<
        PageletSettings,
        | "enabled"
        | "temperature"
        | "maxInputTokens"
        | "maxOutputTokens"
        | "foregroundPerHourCap"
        | "foregroundPerDayCap"
        | "outputLanguage"
    >;
    mergedPagelet: RetainedReviewSettingsSnapshot["pagelet"];
    provider: string;
    model: string;
    embeddingModel: string;
}

export interface RetainedReviewSourceCapability {
    isPageletProviderSourceAllowedFile(file: TFile, markdown?: string): boolean;
}

export interface RetainedReviewAppHost {
    vault: {
        cachedRead(file: TFile): Promise<string>;
        getAbstractFileByPath(path: string): unknown;
    };
    workspace: { getActiveFile(): TFile | null };
}

export interface RetainedReviewPluginIntegrationDependencies {
    app: RetainedReviewAppHost;
    source: RetainedReviewSourceCapability;
    getSettings(): RetainedReviewSettingsSnapshot;
    getLocale(): "zh" | "en";
    isRuntimeCurrent(): boolean;
    getScopeRecapAuthorizationContextId(): string;
    getScopeRecapProviderInfo(): { provider: string; model: string; endpoint: string };
    getProviderCallAdmission(): PageletProviderCallAdmission;
    getCostTracker(): PageletCostTracker;
    requestHighRiskDecision(
        summary: PageletReviewHighRiskSummary,
        signal?: AbortSignal,
    ): Promise<PageletReviewHighRiskChoice>;
    getVaultStorageScope(): string | null;
    createRateLimitStorage(vaultStorageScope: string | null): PageletRateLimitStorage;
    getRateLimitStorageKey(vaultStorageScope: string | null): string;
    findRelatedNotes(
        primarySourcePath: string,
        noteContents: Array<{ path: string; content: string }>,
        sourcePaths: readonly string[],
        options: {
            limit: number;
            additionalCurrentCheck: () => boolean;
            executeProviderCall: <TResult>(
                invoke: () => Promise<TResult>,
                options: { signal: AbortSignal },
            ) => Promise<TResult>;
            onProviderInvoke?: () => void;
        },
    ): Promise<Array<{
        path: string;
        content: string;
        score?: number;
        headingPath?: string[];
        mtime?: number;
        size?: number;
    }>>;
    createChatModel(temperature: number, options?: {
        modelName?: string;
        maxTokens?: number;
    }): Promise<RetainedReviewChatModel>;
    log(message: string, detail?: unknown): void;
}

function createPageletProviderAbortError(): Error {
    const error = new Error("Pagelet provider call aborted");
    error.name = "PageletProviderCallAbortError";
    return error;
}

export class RetainedReviewPluginIntegration {
    private rateLimiter: PageletRateLimiter | null = null;

    constructor(private readonly dependencies: RetainedReviewPluginIntegrationDependencies) {}

    invalidateLimiter(): void {
        this.rateLimiter = null;
    }

    getRateLimiter(): PageletRateLimiter {
        if (!this.rateLimiter) {
            const vaultStorageScope = this.dependencies.getVaultStorageScope();
            this.rateLimiter = new PageletRateLimiter({
                ...(vaultStorageScope ? {
                    storage: this.dependencies.createRateLimitStorage(vaultStorageScope),
                    coordinationKey: this.dependencies.getRateLimitStorageKey(vaultStorageScope),
                } : {}),
                config: {
                    hourlyCap: this.dependencies.getSettings().pagelet.foregroundPerHourCap,
                    dailyCap: this.dependencies.getSettings().pagelet.foregroundPerDayCap,
                },
            });
        }
        return this.rateLimiter;
    }

    createAnalyzeCallback(): AnalyzeCallback {
        return async (files, config) => {
            const noteContents = await this.readNoteContents(files, config.tokenBudget.input);
            if (noteContents.length === 0) {
                return {
                    findings: [],
                    analyzedFiles: [],
                    analyzedAt: Date.now(),
                    tokenCost: { input: 0, output: 0 },
                    usedGovernedMemoryClaimIds: [],
                };
            }
            const primarySourcePath = noteContents[0]?.path ?? "";
            const bundle = buildPageletScopeReviewBundle({
                entries: noteContents,
                primarySourcePath,
                settings: this.dependencies.getSettings().mergedPagelet,
                uiLanguage: this.dependencies.getLocale(),
            });
            if (!bundle) {
                return {
                    findings: [],
                    analyzedFiles: files.map((file) => file.path),
                    analyzedAt: Date.now(),
                    tokenCost: { input: 0, output: 0 },
                    usedGovernedMemoryClaimIds: [],
                };
            }

            const bundleSourcePaths = new Set(
                bundle.sourcePaths.map((path) => normalizePath(path)),
            );
            const includedNoteContents = noteContents.filter((entry) => (
                bundleSourcePaths.has(normalizePath(entry.path))
            ));
            const initialSourceSnapshots = this.captureSourceSnapshots(includedNoteContents);
            if (!initialSourceSnapshots) {
                throw new Error("Pagelet review sources became unavailable");
            }
            let sourceSnapshots = initialSourceSnapshots;
            const expectedProviderPolicyIdentity = this.dependencies.getScopeRecapAuthorizationContextId();
            const admittedProvider = this.dependencies.getSettings().provider;
            const admittedModel = this.dependencies.getSettings().model;
            const admittedEmbeddingModel = this.dependencies.getSettings().embeddingModel;
            const requestIsCurrent = () => (
                expectedProviderPolicyIdentity === this.dependencies.getScopeRecapAuthorizationContextId()
                && this.sourceSnapshotsAreCurrent(
                    sourceSnapshots,
                    bundle.primarySourcePath,
                )
            );
            const stoppedResult = (error: unknown) => {
                if (!(error instanceof PageletProviderCallControlError)) throw error;
                if (error.reason === "blocked" || error.reason === "rate-limit") throw error;
                if (error.reason === "adjust") {
                    new Notice(pageletT(
                        "pagelet.review.highRisk.adjustNotice",
                        this.dependencies.getLocale(),
                    ), 5000);
                }
                return {
                    findings: [],
                    analyzedFiles: bundle.sourcePaths,
                    analyzedAt: Date.now(),
                    tokenCost: { input: 0, output: 0 },
                    usedGovernedMemoryClaimIds: [],
                };
            };
            let highRiskRunApproved = false;
            const limiter = this.getRateLimiter();
            const executeReviewProviderCall = async <TResult>(
                invoke: () => Promise<TResult>,
                options: { signal: AbortSignal },
            ): Promise<TResult> => {
                if (options.signal.aborted) throw createPageletProviderAbortError();
                const capacity = await limiter.peek();
                if (options.signal.aborted) throw createPageletProviderAbortError();
                if (!capacity.ok) {
                    const key = capacity.reason === "hr-cap"
                        ? "pagelet.errors.rate_limit_hourly"
                        : "pagelet.errors.rate_limit_daily";
                    throw new PageletProviderCallControlError(
                        "rate-limit",
                        pageletT(key, this.dependencies.getLocale()),
                    );
                }
                const sourceCount = new Set(
                    sourceSnapshots.map((snapshot) => normalizePath(snapshot.path)),
                ).size;
                let reservationBlock: "condition" | "rate-limit" | null = null;
                const providerInfo = this.dependencies.getScopeRecapProviderInfo();
                const result = await this.dependencies.getProviderCallAdmission().executeRiskAwareCall({
                    signal: options.signal,
                    input: {
                        sourceCount,
                        summary: {
                            scopeLabel: bundle.sourceLabel,
                            includedSourceCount: sourceCount,
                            skippedSourceCount: Math.max(0, files.length - bundle.sourcePaths.length),
                            provider: providerInfo.provider,
                            model: providerInfo.model,
                            endpoint: providerInfo.endpoint,
                            hourlyCap: this.dependencies.getSettings().pagelet.foregroundPerHourCap,
                            dailyCap: this.dependencies.getSettings().pagelet.foregroundPerDayCap,
                        } satisfies PageletReviewHighRiskSummary,
                    },
                    classifyRisk: (input) => (
                        !highRiskRunApproved && input.sourceCount > 1
                            ? "high-risk"
                            : "standard"
                    ),
                    requestHighRiskDecision: async (input, signal) => {
                        const choice = await this.dependencies.requestHighRiskDecision(
                            input.summary,
                            signal,
                        );
                        if (choice === "run") {
                            highRiskRunApproved = true;
                            return { action: "run" as const };
                        }
                        if (choice === "adjust") return { action: "adjust" as const };
                        return { action: choice };
                    },
                    revalidate: () => !options.signal.aborted && requestIsCurrent(),
                    reserve: async () => {
                        const reservation = await limiter.reserveLeaseIf(() => (
                            !options.signal.aborted && requestIsCurrent()
                        ));
                        reservationBlock = reservation.ok
                            ? null
                            : reservation.reason === "condition"
                                ? "condition"
                                : "rate-limit";
                        return reservation.ok ? reservation.reservation : false;
                    },
                    invoke,
                });
                if (result.status === "cancelled") {
                    throw new PageletProviderCallControlError(
                        result.action,
                        `Pagelet review ${result.action}`,
                    );
                }
                if (result.status === "blocked") {
                    throw new PageletProviderCallControlError(
                        reservationBlock === "rate-limit" ? "rate-limit" : "blocked",
                        reservationBlock === "rate-limit"
                            ? pageletT("pagelet.notice.foregroundLimit", this.dependencies.getLocale())
                            : "Pagelet review request became stale",
                    );
                }
                return result.value;
            };

            let relatedNotes: Awaited<ReturnType<RetainedReviewPluginIntegrationDependencies["findRelatedNotes"]>> = [];
            if (bundle.sourcePaths.length === 1) {
                try {
                    relatedNotes = await this.dependencies.findRelatedNotes(
                        bundle.primarySourcePath,
                        includedNoteContents,
                        bundle.sourcePaths,
                        {
                            limit: PAGELET_DISCOVERY_MAX_RELATED_NOTES,
                            additionalCurrentCheck: requestIsCurrent,
                            executeProviderCall: executeReviewProviderCall,
                            onProviderInvoke: () => {
                                const primary = includedNoteContents[0];
                                if (!primary) return;
                                this.dependencies.getCostTracker().record({
                                    inputTokens: estimateTokens(buildPageletRelatedNotesQuery(primary)),
                                    outputTokens: 0,
                                    provider: admittedProvider,
                                    model: admittedEmbeddingModel,
                                    feature: "foreground-review",
                                    attemptKind: "semantic-retrieval",
                                });
                            },
                        },
                    );
                } catch (error) {
                    return stoppedResult(error);
                }
            }
            const reviewRelatedNotes = relatedNotes.map((note) => ({
                path: note.path,
                content: note.content,
                ...(note.score === undefined ? {} : { score: note.score }),
                ...(note.headingPath === undefined ? {} : { headingPath: note.headingPath }),
            }));
            const reviewInput = reviewRelatedNotes.length > 0
                ? { ...bundle.input, relatedNotes: reviewRelatedNotes }
                : bundle.input;
            const enrichedSourceSnapshots = this.captureSourceSnapshots([
                ...includedNoteContents,
                ...relatedNotes,
            ]);
            if (!enrichedSourceSnapshots) {
                throw new Error("Pagelet review sources became unavailable");
            }
            sourceSnapshots = enrichedSourceSnapshots;

            const settings = this.dependencies.getSettings();
            const reviewModel = new PageletReviewModel(
                (temperature, options) => this.dependencies.createChatModel(temperature, {
                    modelName: options?.modelName,
                    maxTokens: config.tokenBudget.output,
                }),
                {
                    temperature: settings.pagelet.temperature,
                    modelName: settings.model,
                    costBudget: {
                        maxInputTokens: settings.pagelet.maxInputTokens,
                        maxOutputTokens: settings.pagelet.maxOutputTokens,
                    },
                    costTracker: this.dependencies.getCostTracker(),
                    providerCallOwnsRateLimitReservation: true,
                    providerForPricing: admittedProvider,
                    modelForPricing: admittedModel,
                    executeProviderCall: executeReviewProviderCall,
                    userMessageLocale: this.dependencies.getLocale(),
                    reviewTimeoutMs: PAGELET_FOREGROUND_REVIEW_TIMEOUT_MS,
                },
            );

            let outcome;
            try {
                outcome = await reviewModel.reviewNote(reviewInput);
            } catch (error) {
                return stoppedResult(error);
            }
            if (outcome.status === "error") throw new Error(outcome.userMessage);
            if (!requestIsCurrent()) throw new Error("Pagelet review request became stale");

            const sourceById = new Map(
                bundle.sourceReferences.map((reference) => [reference.sourceId, reference]),
            );
            const findings = outcome.result.suggestions.map((suggestion) => {
                const source = sourceById.get(suggestion.source_id);
                const sourceFile = source?.path ?? bundle.primarySourcePath;
                return {
                    text: suggestion.proposed_action,
                    sourceFile,
                    sourceTitle: sourceFile.split("/").pop()?.replace(/\.md$/, "") ?? sourceFile,
                    suggestion,
                    diagnostics: {
                        truncated: outcome.diagnostics.truncated,
                        partial: outcome.diagnostics.partial,
                        droppedSuggestionsCount: outcome.diagnostics.droppedSuggestionsCount,
                        costEntry: outcome.diagnostics.costEntry,
                    },
                };
            });
            const costEntry = outcome.diagnostics.costEntry;
            return {
                findings,
                analyzedFiles: bundle.sourcePaths,
                analyzedAt: Date.now(),
                tokenCost: {
                    input: costEntry?.inputTokens ?? outcome.diagnostics.estimatedInputTokens ?? 0,
                    output: costEntry?.outputTokens ?? 0,
                },
                usedGovernedMemoryClaimIds: [],
            };
        };
    }

    async readNoteContents(
        files: TFile[],
        inputTokenBudget: number,
    ): Promise<Array<{ path: string; content: string; mtime: number; size: number }>> {
        const allowedFiles = files.filter((file) => this.dependencies.source.isPageletProviderSourceAllowedFile(file));
        if (allowedFiles.length === 0) return [];
        const maxFiles = Math.max(
            1,
            Math.min(allowedFiles.length, 20, Math.floor(Math.max(1, inputTokenBudget) / 100)),
        );
        const selectedFiles = allowedFiles.slice(0, maxFiles);
        const totalCharBudget = Math.max(1_000, Math.max(1, inputTokenBudget) * 4);
        const perFileCharBudget = Math.max(1_000, Math.floor(totalCharBudget / selectedFiles.length));
        const noteContents: Array<{ path: string; content: string; mtime: number; size: number }> = [];
        for (const file of selectedFiles) {
            try {
                const before = { mtime: file.stat.mtime, size: file.stat.size };
                const content = await this.dependencies.app.vault.cachedRead(file);
                const current = this.dependencies.app.vault.getAbstractFileByPath(file.path);
                if (
                    !(current instanceof TFile)
                    || current.extension !== "md"
                    || current.stat.mtime !== before.mtime
                    || current.stat.size !== before.size
                    || !this.dependencies.source.isPageletProviderSourceAllowedFile(current, content)
                ) continue;
                noteContents.push({
                    path: current.path,
                    content: content.length > perFileCharBudget
                        ? `${content.slice(0, perFileCharBudget)}\n[...truncated]`
                        : content,
                    mtime: before.mtime,
                    size: before.size,
                });
            } catch (error) {
                this.dependencies.log("Failed to read Pagelet note content", { path: file.path, error });
            }
        }
        return noteContents;
    }

    captureSourceSnapshots(
        notes: readonly { path: string; mtime?: number; size?: number }[],
    ): Array<{ path: string; mtime: number; size: number }> | null {
        const snapshots: Array<{ path: string; mtime: number; size: number }> = [];
        const seen = new Set<string>();
        for (const note of notes) {
            const path = normalizePath(note.path);
            if (seen.has(path)) continue;
            seen.add(path);
            const file = this.dependencies.app.vault.getAbstractFileByPath(path);
            if (
                !(file instanceof TFile)
                || file.extension !== "md"
                || !this.dependencies.source.isPageletProviderSourceAllowedFile(file)
            ) return null;
            const mtime = note.mtime ?? file.stat.mtime;
            const size = note.size ?? file.stat.size;
            if (file.stat.mtime !== mtime || file.stat.size !== size) return null;
            snapshots.push({ path: file.path, mtime, size });
        }
        return snapshots;
    }

    sourceSnapshotsAreCurrent(
        snapshots: readonly { path: string; mtime: number; size: number }[],
        requiredActivePath?: string,
    ): boolean {
        if (!this.dependencies.isRuntimeCurrent() || this.dependencies.getSettings().pagelet.enabled !== true) {
            return false;
        }
        if (requiredActivePath) {
            const activeFile = this.dependencies.app.workspace.getActiveFile();
            if (
                !(activeFile instanceof TFile)
                || normalizePath(activeFile.path) !== normalizePath(requiredActivePath)
            ) return false;
        }
        return snapshots.every((snapshot) => {
            const file = this.dependencies.app.vault.getAbstractFileByPath(snapshot.path);
            return file instanceof TFile
                && file.extension === "md"
                && file.stat.mtime === snapshot.mtime
                && file.stat.size === snapshot.size
                && this.dependencies.source.isPageletProviderSourceAllowedFile(file);
        });
    }
}

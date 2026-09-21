import { normalizePath, TFile } from "obsidian";

import { clearPlatformTimeout, setPlatformTimeout } from "../platform-dom";
import { stableStringify } from "../ai-services/agent-utils";
import { stableHash, parentFolder } from "../pa/helpers";
import {
    buildScopeRecapLocalOverview,
    prepareScopeRecapWithLlm,
    type GenerateRecapInsightsCallback,
    type ScopeRecapAttemptCost,
    type ScopeRecapLocalOverview,
    type ScopeRecapPreparationResult,
    type ScopeRecapSourceNote,
} from "../pa/scope-recap";
import { supportsDashScopeThinkingControl } from "../ai-services/ai-utils";
import {
    buildRecapInsightsPrompt,
    parseRecapInsightsResponse,
    resolveOutputLanguage,
} from "../pa/pagelet-prompts";
import type { PageletCostEntry, PageletCostTracker } from "./pa-review-cost";
import { estimateTokens } from "./pa-review-cost";
import { PageletRateLimiter, type PageletRateLimitStorage } from "./pa-review-rate-limit";
import type { PageletProviderCallAdmission } from "./provider-call-admission";
import type { SourceAccess } from "../plugin/source-access";
import type { PageletSettings } from "../settings/pagelet";

export const SCOPE_RECAP_CALL_LIMITS = Object.freeze({ hourly: 2, daily: 10 });
const SCOPE_RECAP_PROVIDER_TIMEOUT_MS = 60_000;

export interface ScopeRecapProviderModel {
    invoke(input: string): Promise<unknown> | unknown;
}

export interface ScopeRecapCostRecorder {
    record(entry: Parameters<PageletCostTracker["record"]>[0]): PageletCostEntry;
}

export interface ScopeRecapSettingsSnapshot {
    provider: string;
    providerPreset: string | null;
    model: string;
    embeddingModel: string;
    endpoint: string;
    pagelet: Pick<
        PageletSettings,
        | "enabled"
        | "temperature"
        | "maxOutputTokens"
        | "outputLanguage"
        | "reviewsFolder"
        | "excludedFolders"
        | "excludedTags"
        | "excludedPatterns"
        | "scopeRecapPreparationEnabled"
        | "scopeRecapBackgroundAuthorization"
    >;
    mergedPagelet: Pick<
        PageletSettings,
        "reviewsFolder" | "excludedFolders" | "excludedTags" | "excludedPatterns"
    >;
}

export interface ScopeRecapAppHost {
    workspace: { getActiveFile(): TFile | null };
    vault: {
        getMarkdownFiles(): TFile[];
        getAbstractFileByPath(path: string): unknown;
        cachedRead(file: TFile): Promise<string>;
    };
}

export interface ScopeRecapPluginIntegrationDependencies {
    app: ScopeRecapAppHost;
    source: Pick<
        SourceAccess,
        | "createPageletProviderSourceResolver"
        | "isPageletProviderSourceAllowedByResolver"
        | "getDataBoundaryTags"
        | "isGeneratedDataBoundaryFile"
        | "getLatestPageletContentBoundary"
    >;
    getSettings(): ScopeRecapSettingsSnapshot;
    getDataBoundaryFingerprint(): string;
    isRuntimeCurrent(): boolean;
    getProviderCallAdmission(): PageletProviderCallAdmission;
    getCostTracker(): ScopeRecapCostRecorder;
    createRateLimitStorage(): PageletRateLimitStorage;
    getVaultStorageScope(): string | null;
    getRateLimitStorageKey(vaultStorageScope: string | null): string;
    createModel(temperature: number, options: {
        maxTokens: number;
        qwenRequestOptions?: { enableThinking: false };
    }): Promise<ScopeRecapProviderModel | null>;
    log(message: string, detail?: unknown): void;
}

export class ScopeRecapPluginIntegration {
    private rateLimiter: PageletRateLimiter | null = null;

    constructor(private readonly dependencies: ScopeRecapPluginIntegrationDependencies) {}

    dispose(): void {
        this.rateLimiter = null;
    }

    getRateLimiter(): PageletRateLimiter {
        if (!this.rateLimiter) {
            const vaultStorageScope = this.dependencies.getVaultStorageScope();
            this.rateLimiter = new PageletRateLimiter({
                storage: this.dependencies.createRateLimitStorage(),
                ...(vaultStorageScope ? {
                    coordinationKey: this.dependencies.getRateLimitStorageKey(vaultStorageScope),
                } : {}),
                config: {
                    hourlyCap: SCOPE_RECAP_CALL_LIMITS.hourly,
                    dailyCap: SCOPE_RECAP_CALL_LIMITS.daily,
                },
            });
        }
        return this.rateLimiter;
    }

    async getFeatureRateSnapshot(): Promise<{
        hourlyUsed: number;
        hourlyCap: number;
        hourlyRemaining: number;
        dailyUsed: number;
        dailyCap: number;
        dailyRemaining: number;
        dailyResetAt: number;
    }> {
        const usage = await this.getRateLimiter().getStateSnapshot();
        return {
            hourlyUsed: usage.hourlyTimestamps.length,
            hourlyCap: SCOPE_RECAP_CALL_LIMITS.hourly,
            hourlyRemaining: Math.max(
                0,
                SCOPE_RECAP_CALL_LIMITS.hourly - usage.hourlyTimestamps.length,
            ),
            dailyUsed: usage.dailyCount,
            dailyCap: SCOPE_RECAP_CALL_LIMITS.daily,
            dailyRemaining: Math.max(
                0,
                SCOPE_RECAP_CALL_LIMITS.daily - usage.dailyCount,
            ),
            dailyResetAt: usage.dailyResetAt,
        };
    }

    async buildScopeRecapLocalOverview(): Promise<ScopeRecapLocalOverview> {
        const notes = await this.collectScopeRecapSourceNotes({ includeContent: true });
        return buildScopeRecapLocalOverview(
            notes,
            this.scopeRecapBuildOptions(notes, { includeRecentChanges: true }),
        );
    }

    async runScopeRecap(
        options: {
            mode: "background" | "foreground-retry";
            expectedSourceSnapshotId?: string;
            expectedDataBoundarySnapshotId?: string;
            expectedAuthorizationContextId?: string;
        },
    ): Promise<ScopeRecapPreparationResult> {
        const runtimeGateIsCurrent = () => {
            if (!this.dependencies.isRuntimeCurrent() || this.dependencies.getSettings().pagelet?.enabled === false) return false;
            const currentAuthorizationContextId = this.getScopeRecapAuthorizationContextId();
            if (
                options.mode === "background"
                && (
                    this.dependencies.getSettings().pagelet.scopeRecapPreparationEnabled !== true
                    || this.dependencies.getSettings().pagelet.scopeRecapBackgroundAuthorization === "declined-v1"
                )
            ) return false;
            return (
                (!options.expectedDataBoundarySnapshotId
                    || options.expectedDataBoundarySnapshotId === this.dependencies.getDataBoundaryFingerprint())
                && (!options.expectedAuthorizationContextId
                    || options.expectedAuthorizationContextId === currentAuthorizationContextId)
            );
        };
        if (!runtimeGateIsCurrent()) {
            const rejected = await prepareScopeRecapWithLlm([], async () => null, {
                dataBoundarySnapshotId: this.dependencies.getDataBoundaryFingerprint(),
            });
            if (rejected.status === "ready") {
                throw new Error("Scope Recap runtime guard unexpectedly produced an artifact");
            }
            rejected.attempt.outcome = "quality_rejected";
            rejected.attempt.providerCallMade = false;
            return rejected;
        }
        const notes = await this.collectScopeRecapSourceNotes({ includeContent: true });
        const buildOptions = this.scopeRecapBuildOptions(notes);
        const localOverview = buildScopeRecapLocalOverview(
            notes,
            this.scopeRecapBuildOptions(notes, { includeRecentChanges: true }),
        );
        const rejectStaleRequest = async (): Promise<ScopeRecapPreparationResult> => {
            const rejected = await prepareScopeRecapWithLlm(notes, async () => null, buildOptions);
            if (rejected.status === "ready") {
                throw new Error("Scope Recap stale-request guard unexpectedly produced an artifact");
            }
            rejected.attempt.outcome = "quality_rejected";
            rejected.attempt.providerCallMade = false;
            rejected.localOverview = localOverview;
            return rejected;
        };
        const requestIdentityIsCurrent = () => {
            if (!runtimeGateIsCurrent()) return false;
            return (
                (!options.expectedSourceSnapshotId
                    || options.expectedSourceSnapshotId === localOverview.sourceSnapshotId)
            );
        };
        const sourceIdentityIsCurrentAtProviderBoundary = async (): Promise<boolean> => {
            if (!requestIdentityIsCurrent()) return false;
            const currentNotes = await this.collectScopeRecapSourceNotes({ includeContent: true });
            if (!requestIdentityIsCurrent()) return false;
            const currentOverview = buildScopeRecapLocalOverview(
                currentNotes,
                this.scopeRecapBuildOptions(currentNotes),
            );
            return requestIdentityIsCurrent()
                && currentOverview.sourceSnapshotId === localOverview.sourceSnapshotId
                && currentOverview.dataBoundarySnapshotId === localOverview.dataBoundarySnapshotId;
        };
        if (!requestIdentityIsCurrent()) return rejectStaleRequest();

        const providerInfo = this.getScopeRecapProviderInfo();
        let model: ScopeRecapProviderModel | null = null;
        try {
            model = await this.dependencies.createModel(
                this.dependencies.getSettings().pagelet.temperature,
                {
                    maxTokens: Math.min(1000, this.dependencies.getSettings().pagelet.maxOutputTokens),
                    // Recap expects a short strict-JSON answer. DashScope hybrid models
                    // otherwise spend this bounded budget on reasoning before final content.
                    qwenRequestOptions: supportsDashScopeThinkingControl(
                        this.dependencies.getSettings().provider,
                        this.dependencies.getSettings().endpoint,
                        this.dependencies.getSettings().model,
                    ) ? { enableThinking: false } : undefined,
                },
            );
        } catch (error) {
            this.dependencies.log("Scope Recap model setup failed", error);
        }
        if (!requestIdentityIsCurrent()) return rejectStaleRequest();

        if (!model) {
            const unavailable = await prepareScopeRecapWithLlm(notes, async () => null, buildOptions);
            if (unavailable.status === "no_reliable_insight") {
                unavailable.attempt.providerCallMade = false;
            }
            return unavailable;
        }

        let attemptedPrompt = "";
        let providerText = "";
        let budgetBlocked = false;
        let providerTimedOut = false;
        let requestBecameStale = false;
        const generateInsights: GenerateRecapInsightsCallback = async (input) => {
            const boundedInput = {
                ...input,
                noteDigests: input.noteDigests.slice(0, 12).map((note) => ({
                    ...note,
                    digest: note.digest.slice(0, 800),
                    tags: note.tags.slice(0, 8).map((tag) => tag.slice(0, 40)),
                })),
            };
            const recapLanguage = resolveOutputLanguage(
                this.dependencies.getSettings().pagelet.outputLanguage,
                boundedInput.noteDigests.map((n) => n.digest).join("\n"),
            );
            const prompt = buildRecapInsightsPrompt({ ...boundedInput, language: recapLanguage });
            attemptedPrompt = prompt;
            if (!requestIdentityIsCurrent()) {
                requestBecameStale = true;
                throw new Error("scope_recap_request_stale");
            }
            let result: unknown;
            try {
                result = await this.dependencies.getProviderCallAdmission().executeStandardCall(() => (
                    this.withPageletProviderTimeout(
                        Promise.resolve().then(() => model.invoke(prompt)),
                        SCOPE_RECAP_PROVIDER_TIMEOUT_MS,
                        "Scope Recap",
                    )
                ), {
                    revalidate: async () => {
                        const current = await sourceIdentityIsCurrentAtProviderBoundary();
                        if (!current) requestBecameStale = true;
                        return current;
                    },
                    reserve: async () => {
                        let reservation: Awaited<ReturnType<PageletRateLimiter["reserveLeaseIf"]>>;
                        try {
                            reservation = await this.getRateLimiter().reserveLeaseIf(
                                sourceIdentityIsCurrentAtProviderBoundary,
                            );
                        } catch (error) {
                            budgetBlocked = true;
                            throw error;
                        }
                        if (reservation.ok) return reservation.reservation;
                        if (reservation.reason === "condition") {
                            requestBecameStale = true;
                            throw new Error("scope_recap_request_stale");
                        }
                        budgetBlocked = true;
                        throw new Error(`scope_recap_${reservation.reason}`);
                    },
                });
            } catch (error) {
                if (error instanceof Error && error.message === "Scope Recap timed out") {
                    providerTimedOut = true;
                }
                throw error;
            }
            providerText = coerceModelResultToString(result);
            if (providerText.trim().length === 0) return [];
            const parsed = parseRecapInsightsResponse(providerText);
            // A non-empty parser miss after an actual provider response is
            // malformed output, not provider unavailability.
            return parsed ?? { malformed: true };
        };

        const preparation = await prepareScopeRecapWithLlm(notes, generateInsights, buildOptions);
        preparation.localOverview = localOverview;
        if (preparation.status === "no_reliable_insight" && requestBecameStale) {
            preparation.attempt.outcome = "quality_rejected";
            preparation.attempt.providerCallMade = false;
        } else if (preparation.status === "no_reliable_insight" && budgetBlocked) {
            preparation.attempt.outcome = "budget_blocked";
            preparation.attempt.providerCallMade = false;
        } else if (preparation.status === "no_reliable_insight" && providerTimedOut) {
            preparation.attempt.outcome = "timeout";
        }
        if (preparation.attempt.providerCallMade) {
            const outcome = preparation.attempt.outcome === "success"
                ? "success" as const
                : preparation.attempt.outcome === "timeout"
                    ? "timeout" as const
                    : preparation.attempt.outcome === "empty"
                        ? "empty" as const
                        : preparation.attempt.outcome === "malformed"
                            ? "malformed" as const
                            : preparation.attempt.outcome === "quality_rejected"
                                ? "quality-rejected" as const
                                : "provider-error" as const;
            const costEntry = this.dependencies.getCostTracker().record({
                inputTokens: estimateTokens(attemptedPrompt),
                outputTokens: estimateTokens(providerText),
                provider: providerInfo.provider,
                model: providerInfo.model,
                feature: "scope-recap",
                attemptKind: "single",
                outcome,
            });
            const attemptCost: ScopeRecapAttemptCost = {
                inputTokens: costEntry.inputTokens,
                outputTokens: costEntry.outputTokens,
                estimatedCost: costEntry.estimatedCost,
                currency: costEntry.currency,
                pricingKnown: costEntry.pricingKnown,
            };
            preparation.attempt.cost = attemptCost;
        }
        if (preparation.status === "ready") {
            preparation.artifact.providerInfo = providerInfo;
        } else if (budgetBlocked) {
            this.dependencies.log("Scope Recap provider call skipped by its bounded budget");
        }
        return preparation;
    }

    getScopeRecapProviderInfo(): { provider: string; model: string; endpoint: string } {
        return {
            provider: this.dependencies.getSettings().provider || "Not configured",
            model: this.dependencies.getSettings().model || "Default model",
            endpoint: this.scopeRecapEndpointDisplay(),
        };
    }

    scopeRecapEndpointIdentity(): string {
        return (this.dependencies.getSettings().endpoint ?? "").trim().replace(/\/+$/, "");
    }

    scopeRecapEndpointDisplay(): string {
        const raw = this.scopeRecapEndpointIdentity();
        if (!raw) return "Not configured";
        try {
            const endpoint = new URL(raw);
            endpoint.username = "";
            endpoint.password = "";
            endpoint.search = "";
            endpoint.hash = "";
            return endpoint.toString().replace(/\/+$/, "");
        } catch {
            return "Custom endpoint";
        }
    }

    getScopeRecapAuthorizationContextId(): string {
        const provider = this.getScopeRecapProviderInfo();
        const settings = this.dependencies.getSettings().mergedPagelet;
        return `scope-recap-authorization:${stableHash(stableStringify({
            version: 2,
            provider: provider.provider,
            model: provider.model,
            embeddingModel: this.dependencies.getSettings().embeddingModel || "Default embedding model",
            providerPreset: this.dependencies.getSettings().providerPreset ?? null,
            endpoint: this.scopeRecapEndpointIdentity(),
            dataBoundarySnapshotId: this.dependencies.getDataBoundaryFingerprint(),
            excludedFolders: [...settings.excludedFolders].sort(),
            excludedTags: [...settings.excludedTags].sort(),
            excludedPatterns: [...settings.excludedPatterns].sort(),
            reviewsFolder: settings.reviewsFolder,
        }))}`;
    }

    scopeRecapBuildOptions(
        notes: readonly ScopeRecapSourceNote[],
        options: { includeRecentChanges?: boolean } = {},
    ) {
        const activeFile = this.dependencies.app.workspace.getActiveFile();
        const resolver = this.dependencies.source.createPageletProviderSourceResolver();
        const now = new Date();
        const allowedPaths = new Set(notes
            .filter((note) => {
                if (note.skipReason) return false;
                const file = this.dependencies.app.vault.getAbstractFileByPath(note.path);
                return file instanceof TFile && this.dependencies.source.isPageletProviderSourceAllowedByResolver(file, resolver);
            })
            .map((note) => normalizePath(note.path)));
        const includedPaths = notes
            .filter((note) => allowedPaths.has(normalizePath(note.path)))
            .map((note) => note.path);
        const recentChangeCutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
        const changedSourcePaths = notes
            .filter((note) => (
                allowedPaths.has(normalizePath(note.path))
                && typeof note.modifiedAt === "string"
                && Date.parse(note.modifiedAt) >= recentChangeCutoff
            ))
            .map((note) => note.path);
        return {
            now,
            isPathAllowed: (path: string) => allowedPaths.has(normalizePath(path)),
            scope: activeFile instanceof TFile && activeFile.extension === "md"
                ? {
                    kind: "folder" as const,
                    label: parentFolder(activeFile.path) || activeFile.basename,
                    paths: includedPaths,
                }
                : { kind: "selected_notes" as const, paths: includedPaths },
            dataBoundarySnapshotId: this.dependencies.getDataBoundaryFingerprint(),
            ...(options.includeRecentChanges ? { changedSourcePaths } : {}),
        };
    }

    async collectScopeRecapSourceNotes(
        options: { includeContent: boolean } = { includeContent: true },
    ): Promise<ScopeRecapSourceNote[]> {
        const activeFile = this.dependencies.app.workspace.getActiveFile();
        if (!(activeFile instanceof TFile) || activeFile.extension !== "md") return [];
        const resolver = this.dependencies.source.createPageletProviderSourceResolver();
        if (!this.dependencies.source.isPageletProviderSourceAllowedByResolver(activeFile, resolver)) {
            return [{
                path: activeFile.path,
                title: activeFile.basename,
                tags: this.dependencies.source.getDataBoundaryTags(activeFile),
                modifiedAt: new Date(activeFile.stat.mtime).toISOString(),
                isGenerated: this.dependencies.source.isGeneratedDataBoundaryFile(activeFile),
            }];
        }
        const activeFolder = parentFolder(activeFile.path);
        const files = this.dependencies.app.vault.getMarkdownFiles()
            .filter((file) => parentFolder(file.path) === activeFolder)
            .sort((left, right) => {
                if (left.path === activeFile.path) return -1;
                if (right.path === activeFile.path) return 1;
                return right.stat.mtime - left.stat.mtime;
            });
        const notes: ScopeRecapSourceNote[] = [];
        const contentSnapshots: Array<{ path: string; mtime: number; size: number }> = [];
        let selectedAllowedCount = 0;
        for (const file of files) {
            const base: ScopeRecapSourceNote = {
                path: file.path,
                title: file.basename,
                tags: this.dependencies.source.getDataBoundaryTags(file),
                modifiedAt: new Date(file.stat.mtime).toISOString(),
                isGenerated: this.dependencies.source.isGeneratedDataBoundaryFile(file),
            };
            if (!this.dependencies.source.isPageletProviderSourceAllowedByResolver(file, resolver)) {
                notes.push(base);
                continue;
            }
            if (selectedAllowedCount >= 12) {
                notes.push({
                    ...base,
                    skipReason: "out_of_scope",
                    skipLabel: "Outside bounded preparation scope",
                });
                continue;
            }
            selectedAllowedCount += 1;
            if (!options.includeContent) {
                notes.push(base);
                continue;
            }
            try {
                const before = { mtime: file.stat.mtime, size: file.stat.size };
                const content = await this.dependencies.app.vault.cachedRead(file);
                const current = this.dependencies.app.vault.getAbstractFileByPath(file.path);
                const latestBoundary = this.dependencies.source.getLatestPageletContentBoundary(file.path, content);
                if (
                    !(current instanceof TFile)
                    || current.extension !== "md"
                    || current.stat.mtime !== before.mtime
                    || current.stat.size !== before.size
                    || !this.dependencies.source.isPageletProviderSourceAllowedByResolver(current, resolver)
                ) {
                    notes.push({
                        ...base,
                        skipReason: "unreadable",
                        skipLabel: "Source changed during preparation",
                    });
                    continue;
                }
                if (latestBoundary?.allowed !== true) {
                    notes.push({
                        ...base,
                        skipReason: "data_boundary",
                        skipLabel: "Source excluded by current data boundary",
                    });
                    continue;
                }
                notes.push({
                    ...base,
                    content,
                    tags: latestBoundary.tags,
                    isGenerated: latestBoundary.isGenerated,
                });
                contentSnapshots.push({
                    path: current.path,
                    mtime: before.mtime,
                    size: before.size,
                });
            } catch (error) {
                this.dependencies.log("Failed to read note for Scope Recap", { path: file.path, error });
                notes.push({
                    ...base,
                    skipReason: "unreadable",
                    skipLabel: "Unreadable source skipped",
                });
            }
        }
        const collectionIsCurrent = contentSnapshots.every((snapshot) => {
            const current = this.dependencies.app.vault.getAbstractFileByPath(snapshot.path);
            return current instanceof TFile
                && current.extension === "md"
                && current.stat.mtime === snapshot.mtime
                && current.stat.size === snapshot.size
                && this.dependencies.source.isPageletProviderSourceAllowedByResolver(current, resolver);
        });
        if (!collectionIsCurrent) {
            this.dependencies.log("Scope Recap source collection became stale");
            return [];
        }
        return notes;
    }
    withPageletProviderTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        label: string,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const timeout = setPlatformTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error(`${label} timed out`));
            }, timeoutMs);
            promise.then(
                (value) => {
                    if (settled) return;
                    settled = true;
                    clearPlatformTimeout(timeout);
                    resolve(value);
                },
                (error) => {
                    if (settled) return;
                    settled = true;
                    clearPlatformTimeout(timeout);
                    reject(error);
                },
            );
        });
    }

}

function coerceModelResultToString(result: unknown): string {
    if (typeof result === "string") return result;
    const content = (result as { content?: unknown })?.content;
    return content != null ? String(content) : String(result);
}

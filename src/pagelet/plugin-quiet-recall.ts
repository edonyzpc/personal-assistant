import { Notice, normalizePath, TFile } from "obsidian";

import {
    clearPlatformTimeout,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../platform-dom";
import { stableStringify } from "../ai-services/agent-utils";
import { parentFolder, stableHash } from "../pa/helpers";
import {
    applyRetrievalHabitProfileToRecallCandidates,
    type RetrievalHabitFeedbackKind,
    type RetrievalHabitProfileRecordResult,
    type RetrievalHabitProfileSettings,
} from "../pa/retrieval-habit-profile";
import {
    buildQuietRecallCandidates,
    buildQuietRecallSourceSnapshotId,
    quietRecallCandidateToSavedInsightInput,
    quietRecallLinkTargetPath,
    coerceQuietRecallSaveResult,
    extractRecallDigest,
    type QuietRecallCandidate,
    type QuietRecallRelatedNote,
    type QuietRecallRunResult,
    type QuietRecallSaveResult,
    QUIET_RECALL_BUBBLE_MIN_SCORE,
    type QuietRecallVaultNote,
    type RecallNoteDigest,
} from "../pa/quiet-recall";
import {
    buildRecallRelevancePrompt,
    parseRecallRelevanceResponse,
    resolveOutputLanguage,
} from "../pa/pagelet-prompts";
import {
    QuietRecallEvaluationCoordinator,
    type QuietRecallEvaluationAttempt,
    type QuietRecallEvaluationBlockReason,
    type QuietRecallEvaluationDecision,
    type QuietRecallEvaluationDiagnostics,
} from "../pa/quiet-recall-evaluation";
import type {
    SavedInsight,
    SavedInsightCreateInput,
    SavedInsightResult,
} from "../pa/saved-insight-store";
import type { QuietRecallSettings } from "../settings";
import type { PageletSettings } from "../settings/pagelet";
import { pageletT } from "../locales/pagelet";
import {
    estimateTokens,
    type PageletCostEntry,
    type PageletCostTracker,
} from "./pa-review-cost";
import {
    PageletRateLimiter,
    type PageletRateLimitStorage,
} from "./pa-review-rate-limit";
import {
    type PageletProviderCallAdmission,
    type PageletProviderCallReservation,
} from "./provider-call-admission";
import type { SourceAccess } from "../plugin/source-access";
import type { PaRelatedLinkResult } from "../pa/frontmatter-link";
import { buildPageletRelatedNotesQuery } from "./related-notes-query";

export const QUIET_RECALL_CALL_LIMITS = Object.freeze({ hourly: 10, daily: 50 });
const QUIET_RECALL_PROVIDER_TIMEOUT_MS = 20_000;
const QUIET_RECALL_EVALUATOR_VERSION = "quiet-recall-why-now-v1";
const QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES = 40;
const RECALL_LLM_COOLDOWN_MS = 60_000;

export interface QuietRecallSourceSnapshot {
    path: string;
    mtime: number;
    size: number;
}

export interface QuietRecallVaultNoteCollection {
    vaultNotes: QuietRecallVaultNote[];
    relatedNotes: QuietRecallRelatedNote[];
    sourceSnapshots?: QuietRecallSourceSnapshot[];
    retrievalMode?: "semantic" | "metadata";
}

export interface QuietRecallSavedInsightCollection {
    insights: SavedInsight[];
    sourceSnapshots: QuietRecallSourceSnapshot[];
}

export interface QuietRecallVaultNoteRead {
    note: QuietRecallVaultNote;
    snapshot: QuietRecallSourceSnapshot;
}

export interface QuietRecallLimiterUsage {
    hourlyUsed: number;
    hourlyCap: number;
    hourlyRemaining: number;
    dailyUsed: number;
    dailyCap: number;
    dailyRemaining: number;
}

export type QuietRecallProviderCallReservation =
    | {
        ok: true;
        startedRound: boolean;
        reservation: PageletProviderCallReservation;
        limiterUsage?: QuietRecallLimiterUsage;
    }
    | {
        ok: false;
        reason: QuietRecallEvaluationBlockReason;
    };

export interface QuietRecallEvaluationMaterial {
    candidateDigest: RecallNoteDigest;
    candidateAge: string;
    prompt: string;
    sourceSnapshots: Array<{
        path: string;
        contentHash: string;
        modifiedAt: string | null;
    }>;
    relationInputs: {
        relation: QuietRecallCandidate["relation"];
        score: number;
        context: QuietRecallCandidate["context"] | null;
        sourceInsightId: string | null;
    };
}

export interface QuietRecallProviderModel {
    invoke(input: string): Promise<unknown> | unknown;
}

export interface QuietRecallCostRecorder {
    record(entry: Parameters<PageletCostTracker["record"]>[0]): PageletCostEntry | null;
}

export interface QuietRecallPluginSettingsSnapshot {
    provider: string;
    providerPreset: string | null;
    model: string;
    embeddingModel: string;
    endpoint: string;
    quietRecall: QuietRecallSettings;
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
    >;
    retrievalHabitProfile: RetrievalHabitProfileSettings;
    savedInsights: SavedInsight[];
}

export interface QuietRecallAppHost {
    workspace: { getActiveFile(): TFile | null };
    vault: {
        read?(file: TFile): Promise<string>;
        cachedRead(file: TFile): Promise<string>;
        getAbstractFileByPath(path: string): unknown;
        getMarkdownFiles(): TFile[];
    };
    metadataCache?: {
        getFileCache?(file: TFile): unknown;
        resolvedLinks?: Record<string, Record<string, number>>;
    };
}

export interface QuietRecallRelatedNoteSearchResult {
    path: string;
    content: string;
    score?: number;
    headingPath?: string[];
    mtime?: number;
    size?: number;
}

export interface QuietRecallPluginIntegrationDependencies {
    app: QuietRecallAppHost;
    source: Pick<
        SourceAccess,
        | "isPageletProviderSourceAllowedFile"
        | "isPageletProviderPathAllowed"
        | "isDataBoundaryAllowedPath"
        | "getDataBoundaryTags"
        | "getLatestPageletContentBoundary"
    >;
    getSettings(): QuietRecallPluginSettingsSnapshot;
    getLocale(): "zh" | "en";
    getDataBoundaryFingerprint(): string;
    isRuntimeCurrent(): boolean;
    isMemorySearchReady(): Promise<boolean>;
    findRelatedNotes(
        activePath: string,
        contents: Array<{ path: string; content: string }>,
        excludedPaths: string[],
        options: {
            limit: number;
            requireActivePrimary: boolean;
            reserveProviderCall: () =>
                | boolean
                | PageletProviderCallReservation
                | PromiseLike<boolean | PageletProviderCallReservation>;
            additionalCurrentCheck: () => boolean;
            onProviderInvoke?: () => void;
            onSearchOutcome?: (outcome: "completed" | "failed") => void;
        },
    ): Promise<QuietRecallRelatedNoteSearchResult[]>;
    getGraphDiscoveryBacklinkMap(): Map<string, string[]>;
    getResolvedOutgoingLinks(path: string): string[];
    getGraphDiscoveryLinks(file: TFile): string[];
    getProviderCallAdmission(): PageletProviderCallAdmission;
    getCostTracker(): QuietRecallCostRecorder;
    createRateLimitStorage(): PageletRateLimitStorage;
    getVaultStorageScope(): string | null;
    getRateLimitStorageKey(vaultStorageScope: string | null): string;
    getAISetupIssue(): string | null;
    createModel(temperature: number, options: { maxTokens: number }): Promise<QuietRecallProviderModel | null>;
    listSavedInsights(): SavedInsight[];
    createSavedInsight(input: SavedInsightCreateInput): Promise<SavedInsightResult<SavedInsight>>;
    confirmLink(input: {
        title: string;
        message: string;
        confirmText: string;
    }): Promise<boolean>;
    addRelatedLink(
        currentPath: string,
        candidatePath: string,
    ): Promise<PaRelatedLinkResult>;
    recordFeedback(
        candidate: QuietRecallCandidate,
        feedback: RetrievalHabitFeedbackKind,
    ): Promise<RetrievalHabitProfileRecordResult>;
    log(message: string, detail?: unknown): void;
}

export class QuietRecallPluginIntegration {
    private rateLimiter: PageletRateLimiter | null = null;
    private evaluationCoordinator: QuietRecallEvaluationCoordinator | null = null;
    private evaluationPolicyIdentitySnapshot: string | null = null;
    private lastRecallLlmEvalAt = 0;
    private roundAdmissionTail: Promise<void> = Promise.resolve();

    constructor(private readonly dependencies: QuietRecallPluginIntegrationDependencies) {}

    syncPolicyIdentity(): void {
        const current = this.getPolicyIdentity();
        if (
            this.evaluationPolicyIdentitySnapshot !== null
            && this.evaluationPolicyIdentitySnapshot !== current
        ) {
            this.evaluationCoordinator?.clear();
            this.evaluationCoordinator = null;
        }
        this.evaluationPolicyIdentitySnapshot = current;
    }

    dispose(): void {
        this.rateLimiter = null;
        this.evaluationCoordinator?.clear();
        this.evaluationCoordinator = null;
        this.evaluationPolicyIdentitySnapshot = null;
        this.lastRecallLlmEvalAt = 0;
        this.roundAdmissionTail = Promise.resolve();
    }

    getPolicyIdentity(): string {
        const settings = this.dependencies.getSettings();
        return `quiet-recall-policy:${stableHash(stableStringify({
            version: QUIET_RECALL_EVALUATOR_VERSION,
            provider: settings.provider,
            providerPreset: settings.providerPreset ?? null,
            model: settings.model,
            embeddingModel: settings.embeddingModel,
            endpoint: (settings.endpoint ?? "").trim().replace(/\/+$/, ""),
            locale: this.dependencies.getLocale(),
            dataBoundarySnapshotId: this.dependencies.getDataBoundaryFingerprint(),
            quietRecall: settings.quietRecall,
            retrievalHabitProfile: settings.retrievalHabitProfile,
            savedInsights: settings.savedInsights.map((insight) => ({
                id: insight.id,
                text: insight.text,
                status: insight.status,
                updatedAt: insight.updatedAt,
                sourceRefs: insight.sourceRefs,
            })),
            pageletSourcePolicy: {
                reviewsFolder: settings.pagelet.reviewsFolder ?? "",
                excludedFolders: [...(settings.pagelet.excludedFolders ?? [])].sort(),
                excludedTags: [...(settings.pagelet.excludedTags ?? [])].sort(),
                excludedPatterns: [...(settings.pagelet.excludedPatterns ?? [])].sort(),
            },
            temperature: settings.pagelet.temperature,
            maxOutputTokens: settings.pagelet.maxOutputTokens,
        }))}`;
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
                    hourlyCap: QUIET_RECALL_CALL_LIMITS.hourly,
                    dailyCap: QUIET_RECALL_CALL_LIMITS.daily,
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
            hourlyCap: QUIET_RECALL_CALL_LIMITS.hourly,
            hourlyRemaining: Math.max(
                0,
                QUIET_RECALL_CALL_LIMITS.hourly - usage.hourlyTimestamps.length,
            ),
            dailyUsed: usage.dailyCount,
            dailyCap: QUIET_RECALL_CALL_LIMITS.daily,
            dailyRemaining: Math.max(
                0,
                QUIET_RECALL_CALL_LIMITS.daily - usage.dailyCount,
            ),
            dailyResetAt: usage.dailyResetAt,
        };
    }

    async collectQuietRecallVaultNotes(
        activeFile: TFile,
        currentContent: string,
        options: {
            reserveProviderCall: () =>
                | boolean
                | PageletProviderCallReservation
                | PromiseLike<boolean | PageletProviderCallReservation>;
            additionalCurrentCheck: () => boolean;
            onProviderInvoke?: () => void;
        },
    ): Promise<QuietRecallVaultNoteCollection> {
        if (await this.dependencies.isMemorySearchReady()) {
            let searchCompleted = false;
            const relatedNotes = await this.dependencies.findRelatedNotes(
                activeFile.path,
                [{ path: activeFile.path, content: currentContent }],
                [activeFile.path],
                {
                    limit: QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES,
                    requireActivePrimary: true,
                    reserveProviderCall: options.reserveProviderCall,
                    additionalCurrentCheck: options.additionalCurrentCheck,
                    onProviderInvoke: options.onProviderInvoke,
                    onSearchOutcome: (outcome) => {
                        searchCompleted = outcome === "completed";
                    },
                },
            );
            if (searchCompleted) {
                return this.collectQuietRecallVaultNotesFromRelatedNotes(relatedNotes);
            }
        }
        return this.collectQuietRecallVaultNotesFromMetadata(activeFile);
    }

    async collectQuietRecallVaultNotesFromRelatedNotes(
        relatedNotes: Array<{
            path: string;
            content: string;
            score?: number;
            headingPath?: string[];
        }>,
    ): Promise<QuietRecallVaultNoteCollection> {
        const backlinkMap = this.dependencies.getGraphDiscoveryBacklinkMap();
        const vaultNotes: QuietRecallVaultNote[] = [];
        const recallRelatedNotes: QuietRecallRelatedNote[] = [];
        const sourceSnapshots: QuietRecallSourceSnapshot[] = [];
        for (const related of relatedNotes.slice(0, QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES)) {
            const path = normalizePath(related.path).replace(/^\.\//, "");
            const file = this.dependencies.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile) || file.extension !== "md") continue;
            if (!this.dependencies.source.isPageletProviderSourceAllowedFile(file)) continue;
            // Search results are ranking evidence only. Re-read the current
            // Markdown body and retain the exact stats paired with that body.
            const read = await this.readQuietRecallVaultNote(file, backlinkMap);
            if (!read) continue;
            vaultNotes.push(read.note);
            sourceSnapshots.push(read.snapshot);
            recallRelatedNotes.push({
                path: read.note.path,
                score: related.score ?? 0.5,
                headingPath: related.headingPath,
            });
        }
        if (!this.quietRecallSourceSnapshotsAreCurrent(sourceSnapshots)) {
            return {
                vaultNotes: [],
                relatedNotes: [],
                sourceSnapshots: [],
                retrievalMode: "semantic",
            };
        }
        return {
            vaultNotes,
            relatedNotes: recallRelatedNotes,
            sourceSnapshots,
            retrievalMode: "semantic",
        };
    }

    async collectQuietRecallVaultNotesFromMetadata(activeFile: TFile): Promise<QuietRecallVaultNoteCollection> {
        const backlinkMap = this.dependencies.getGraphDiscoveryBacklinkMap();
        const candidates = this.rankQuietRecallMetadataCandidates(activeFile, backlinkMap)
            .slice(0, QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES);
        const vaultNotes: QuietRecallVaultNote[] = [];
        const relatedNotes: QuietRecallRelatedNote[] = [];
        const sourceSnapshots: QuietRecallSourceSnapshot[] = [];
        for (const candidate of candidates) {
            const read = await this.readQuietRecallVaultNote(candidate.file, backlinkMap);
            if (!read) continue;
            vaultNotes.push(read.note);
            sourceSnapshots.push(read.snapshot);
            relatedNotes.push({
                path: read.note.path,
                score: candidate.score,
            });
        }
        if (!this.quietRecallSourceSnapshotsAreCurrent(sourceSnapshots)) {
            return {
                vaultNotes: [],
                relatedNotes: [],
                sourceSnapshots: [],
                retrievalMode: "metadata",
            };
        }
        return { vaultNotes, relatedNotes, sourceSnapshots, retrievalMode: "metadata" };
    }

    private rankQuietRecallMetadataCandidates(
        activeFile: TFile,
        backlinkMap: Map<string, string[]>,
    ): Array<{ file: TFile; score: number }> {
        const activePath = normalizePath(activeFile.path);
        const activeFolder = parentFolder(activeFile.path);
        const activeTags = new Set(this.dependencies.source.getDataBoundaryTags(activeFile));
        const activeResolvedLinks = new Set(this.dependencies.getResolvedOutgoingLinks(activeFile.path));
        const activeBacklinks = new Set(backlinkMap.get(activePath) ?? []);
        const scores = new Map<string, { file: TFile; score: number }>();

        const addScore = (file: TFile | null | undefined, amount: number): void => {
            if (!(file instanceof TFile) || file.extension !== "md") return;
            if (file.path === activeFile.path) return;
            if (!this.dependencies.source.isPageletProviderSourceAllowedFile(file)) return;
            const existing = scores.get(file.path);
            const score = Math.min(0.95, (existing?.score ?? 0) + amount);
            scores.set(file.path, { file, score });
        };

        for (const path of activeResolvedLinks) {
            addScore(this.dependencies.app.vault.getAbstractFileByPath(path) as TFile | null, 0.5);
        }
        for (const path of activeBacklinks) {
            addScore(this.dependencies.app.vault.getAbstractFileByPath(path) as TFile | null, 0.45);
        }

        const resolvedLinks = this.dependencies.app.metadataCache?.resolvedLinks as
            Record<string, Record<string, number>> | undefined;
        for (const file of this.dependencies.app.vault.getMarkdownFiles()) {
            if (file.path === activeFile.path || !this.dependencies.source.isPageletProviderSourceAllowedFile(file)) continue;
            if (parentFolder(file.path) === activeFolder) addScore(file, 0.18);
            const tags = this.dependencies.source.getDataBoundaryTags(file);
            const sharedTagCount = tags.filter((tag) => activeTags.has(tag)).length;
            if (sharedTagCount > 0) addScore(file, Math.min(0.36, sharedTagCount * 0.12));
            const fileLinks = resolvedLinks?.[file.path];
            if (fileLinks && Number(fileLinks[activePath] ?? 0) > 0) addScore(file, 0.35);
            if (fileLinks) {
                for (const linkedPath of Object.keys(fileLinks)) {
                    if (Number(fileLinks[linkedPath]) > 0 && activeResolvedLinks.has(linkedPath)) {
                        addScore(file, 0.12);
                        break;
                    }
                }
            }
        }

        return [...scores.values()]
            .filter((entry) => entry.score > 0)
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                return right.file.stat.mtime - left.file.stat.mtime;
            });
    }

    async readQuietRecallVaultNote(
        file: TFile,
        backlinkMap: Map<string, string[]>,
    ): Promise<QuietRecallVaultNoteRead | null> {
        try {
            const before = { mtime: file.stat.mtime, size: file.stat.size };
            const content = typeof this.dependencies.app.vault.read === "function"
                ? await this.dependencies.app.vault.read(file)
                : await this.dependencies.app.vault.cachedRead(file);
            const current = this.dependencies.app.vault.getAbstractFileByPath(file.path);
            const latestBoundary = this.dependencies.source.getLatestPageletContentBoundary(file.path, content);
            if (
                !(current instanceof TFile)
                || current.extension !== "md"
                || current.stat.mtime !== before.mtime
                || current.stat.size !== before.size
                || !this.dependencies.source.isPageletProviderSourceAllowedFile(current, content)
                || latestBoundary?.allowed !== true
            ) return null;
            return {
                note: {
                    path: current.path,
                    title: current.basename,
                    content,
                    tags: latestBoundary.tags,
                    links: this.dependencies.getGraphDiscoveryLinks(current),
                    backlinks: backlinkMap.get(normalizePath(current.path)) ?? [],
                    modifiedAt: new Date(before.mtime).toISOString(),
                    createdAt: new Date(current.stat.ctime).toISOString(),
                },
                snapshot: {
                    path: current.path,
                    mtime: before.mtime,
                    size: before.size,
                },
            };
        } catch (error) {
            this.dependencies.log("Failed to read note for Quiet Recall", { path: file.path, error });
            return null;
        }
    }

    quietRecallSourceSnapshotsAreCurrent(
        snapshots: readonly QuietRecallSourceSnapshot[],
    ): boolean {
        return snapshots.every((snapshot) => {
            const file = this.dependencies.app.vault.getAbstractFileByPath(normalizePath(snapshot.path));
            return file instanceof TFile
                && file.extension === "md"
                && file.stat.mtime === snapshot.mtime
                && file.stat.size === snapshot.size
                && this.dependencies.source.isPageletProviderSourceAllowedFile(file);
        });
    }


    getEvaluationCoordinator(): QuietRecallEvaluationCoordinator {
        if (!this.evaluationCoordinator) {
            this.evaluationCoordinator = new QuietRecallEvaluationCoordinator();
        }
        return this.evaluationCoordinator;
    }

    async runQuietRecall(): Promise<QuietRecallRunResult> {
        const locale = this.dependencies.getLocale();
        const runNow = new Date();
        const providerSnapshot = this.dependencies.getSettings().provider;
        const modelSnapshot = this.dependencies.getSettings().model;
        const embeddingModelSnapshot = this.dependencies.getSettings().embeddingModel;
        const evaluationPolicySnapshotId = this.getPolicyIdentity();
        const dataBoundarySnapshotId = this.dependencies.getDataBoundaryFingerprint();
        if (
            !this.dependencies.isRuntimeCurrent()
            || this.dependencies.getSettings().pagelet.enabled !== true
            || this.dependencies.getSettings().quietRecall.enabled !== true
        ) {
            return buildQuietRecallCandidates({ now: runNow, locale });
        }

        const activeFile = this.dependencies.app.workspace.getActiveFile();
        if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
            return buildQuietRecallCandidates({ now: runNow, locale });
        }
        if (!this.dependencies.source.isPageletProviderSourceAllowedFile(activeFile)) {
            return buildQuietRecallCandidates({ now: runNow, locale });
        }

        const activeSnapshot: QuietRecallSourceSnapshot = {
            path: activeFile.path,
            mtime: activeFile.stat.mtime,
            size: activeFile.stat.size,
        };
        const content = typeof this.dependencies.app.vault.read === "function"
            ? await this.dependencies.app.vault.read(activeFile)
            : await this.dependencies.app.vault.cachedRead(activeFile);
        const currentActiveFile = this.dependencies.app.vault.getAbstractFileByPath(activeFile.path);
        const activeWorkspaceFileIsCurrent = () => {
            const currentWorkspaceFile = this.dependencies.app.workspace.getActiveFile();
            return currentWorkspaceFile instanceof TFile
                && currentWorkspaceFile.extension === "md"
                && normalizePath(currentWorkspaceFile.path) === normalizePath(activeSnapshot.path);
        };
        if (
            !(currentActiveFile instanceof TFile)
            || currentActiveFile.extension !== "md"
            || currentActiveFile.stat.mtime !== activeSnapshot.mtime
            || currentActiveFile.stat.size !== activeSnapshot.size
            || !this.dependencies.source.isPageletProviderSourceAllowedFile(currentActiveFile, content)
            || !activeWorkspaceFileIsCurrent()
        ) return buildQuietRecallCandidates({ now: runNow, locale });
        const activeSourceIdentityIsCurrent = () => (
            !!this.dependencies.isRuntimeCurrent()
            && this.dependencies.getSettings().pagelet.enabled === true
            && this.dependencies.getSettings().quietRecall.enabled === true
            && evaluationPolicySnapshotId === this.getPolicyIdentity()
            && dataBoundarySnapshotId === this.dependencies.getDataBoundaryFingerprint()
            && activeWorkspaceFileIsCurrent()
            && this.quietRecallSourceSnapshotsAreCurrent([activeSnapshot])
        );
        let providerCallIdentityIsCurrent = activeSourceIdentityIsCurrent;
        let roundStarted = false;
        let retrievalProviderCalls = 0;
        let retrievalEstimatedCost = 0;
        let retrievalPricingKnown = true;
        const reserveActualProviderCall = async (): Promise<QuietRecallProviderCallReservation> => {
            const decision = await this.reserveQuietRecallProviderCall({
                roundStarted,
                revalidate: providerCallIdentityIsCurrent,
            });
            if (!decision.ok || !decision.startedRound) return decision;
            const reservation = decision.reservation;
            return {
                ...decision,
                reservation: {
                    commit: () => {
                        reservation.commit();
                        roundStarted = true;
                    },
                    rollback: () => reservation.rollback(),
                },
            };
        };
        const collectedVaultNotes = await this.collectQuietRecallVaultNotes(activeFile, content, {
            additionalCurrentCheck: activeSourceIdentityIsCurrent,
            reserveProviderCall: async () => {
                if (this.dependencies.getAISetupIssue() !== null) {
                    throw new Error("quiet_recall_provider_unavailable");
                }
                const reservation = await reserveActualProviderCall();
                if (!reservation.ok) {
                    throw new Error(`quiet_recall_${reservation.reason}`);
                }
                return reservation.reservation;
            },
            onProviderInvoke: () => {
                retrievalProviderCalls += 1;
                const cost = this.dependencies.getCostTracker().record({
                    inputTokens: estimateTokens(buildPageletRelatedNotesQuery({
                        path: activeFile.path,
                        content,
                    })),
                    outputTokens: 0,
                    provider: providerSnapshot,
                    model: embeddingModelSnapshot,
                    feature: "quiet-recall",
                    attemptKind: "semantic-retrieval",
                });
                if (cost) {
                    retrievalEstimatedCost += cost.estimatedCost;
                    retrievalPricingKnown = retrievalPricingKnown && cost.pricingKnown;
                }
            },
        }).catch((error) => {
            this.dependencies.log("Quiet Recall vault-note collection skipped", error);
            return {
                vaultNotes: [],
                relatedNotes: [],
                sourceSnapshots: [],
                retrievalMode: "metadata",
            } satisfies QuietRecallVaultNoteCollection;
        });
        const relatedNotes = collectedVaultNotes.relatedNotes
            .filter((note) => this.dependencies.source.isPageletProviderPathAllowed(note.path));
        const vaultNotes = collectedVaultNotes.vaultNotes
            .filter((note) => this.dependencies.source.isPageletProviderPathAllowed(note.path));
        const savedInsightCollection = await this.collectPageletProviderAllowedSavedInsights();

        const baseInput = {
            now: runNow,
            locale,
            currentNote: {
                path: activeFile.path,
                title: activeFile.basename,
                content,
            },
            relatedNotes,
            vaultNotes,
            savedInsights: savedInsightCollection.insights,
        };
        const contextFingerprint = quietRecallContextFingerprint({
            currentPath: activeFile.path,
            currentContent: content,
            locale,
            provider: providerSnapshot,
            model: modelSnapshot,
            dataBoundarySnapshot: dataBoundarySnapshotId,
            evaluationPolicySnapshotId,
        });
        const retrievalOnlyDiagnostics = async (
            candidateCount: number,
            blockedReason?: QuietRecallEvaluationBlockReason,
        ): Promise<QuietRecallEvaluationDiagnostics | undefined> => {
            if (retrievalProviderCalls === 0) return undefined;
            const usage = await this.getQuietRecallLimiterUsage(this.getRateLimiter());
            return {
                roundId: stableHash(`${contextFingerprint}:${runNow.getTime()}`),
                startedAt: runNow.getTime(),
                contextFingerprint,
                candidateCount,
                evaluatedCandidateCount: 0,
                providerCalls: 0,
                semanticRetrievalCalls: retrievalProviderCalls,
                totalProviderCalls: retrievalProviderCalls,
                initialCalls: 0,
                languageRetryCalls: 0,
                cacheHits: 0,
                inFlightHits: 0,
                estimatedCost: retrievalEstimatedCost,
                pricingKnown: retrievalPricingKnown,
                ...(usage.limiterUsage ? { limiterUsage: usage.limiterUsage } : {}),
                ...(blockedReason ? { blockedReason } : {}),
                attempts: [],
            };
        };
        const localResult = buildQuietRecallCandidates(baseInput);
        const discoverCandidates = applyRetrievalHabitProfileToRecallCandidates(
            localResult.candidates,
            this.dependencies.getSettings().retrievalHabitProfile,
            { now: runNow },
        ).filter((candidate) => this.quietRecallCandidateSourcesAreCurrent(candidate));
        const capturedSourceSnapshots = this.resolveQuietRecallRunSourceSnapshots(
            activeSnapshot,
            [
                ...(collectedVaultNotes.sourceSnapshots ?? []),
                ...savedInsightCollection.sourceSnapshots,
            ],
            discoverCandidates,
        );
        const sourceSnapshotId = capturedSourceSnapshots
            ? buildQuietRecallSourceSnapshotId(capturedSourceSnapshots)
            : null;
        const sourcePaths = capturedSourceSnapshots?.map((snapshot) => snapshot.path);
        if (!sourceSnapshotId || !capturedSourceSnapshots) {
            const evaluationDiagnostics = await retrievalOnlyDiagnostics(
                discoverCandidates.length,
                "invalid_context",
            );
            return {
                ...localResult,
                totalCount: 0,
                candidates: [],
                discoverCandidates: [],
                dataBoundarySnapshotId,
                evaluationPolicySnapshotId,
                ...(evaluationDiagnostics ? { evaluationDiagnostics } : {}),
            };
        }
        const evaluationCandidates = discoverCandidates.filter((candidate) => (
            candidate.score >= QUIET_RECALL_BUBBLE_MIN_SCORE
            && (
                collectedVaultNotes.retrievalMode !== "metadata"
                || candidate.context?.kind === "governed_claim"
            )
        ));
        if (evaluationCandidates.length === 0) {
            const evaluationDiagnostics = await retrievalOnlyDiagnostics(0);
            return {
                ...localResult,
                totalCount: 0,
                candidates: [],
                discoverCandidates,
                sourceSnapshotId,
                ...(sourcePaths ? { sourcePaths } : {}),
                dataBoundarySnapshotId,
                evaluationPolicySnapshotId,
                ...(evaluationDiagnostics ? { evaluationDiagnostics } : {}),
            };
        }

        const currentDigest = extractRecallDigest(baseInput.currentNote);
        const recallLanguage = resolveOutputLanguage(this.dependencies.getSettings().pagelet.outputLanguage, content);
        const evaluationMaterials = new Map<string, QuietRecallEvaluationMaterial>();
        for (const candidate of evaluationCandidates) {
            evaluationMaterials.set(
                candidate.id,
                quietRecallEvaluationMaterial(candidate, currentDigest, vaultNotes, runNow, recallLanguage),
            );
        }
        const runIdentityIsCurrent = () => (
            !!this.dependencies.isRuntimeCurrent()
            && this.dependencies.getSettings().pagelet.enabled === true
            && this.dependencies.getSettings().quietRecall.enabled === true
            && evaluationPolicySnapshotId === this.getPolicyIdentity()
            && dataBoundarySnapshotId === this.dependencies.getDataBoundaryFingerprint()
            && activeWorkspaceFileIsCurrent()
            && this.quietRecallSourceSnapshotsAreCurrent(capturedSourceSnapshots)
        );
        providerCallIdentityIsCurrent = runIdentityIsCurrent;

        const lastRoundStartedAt = Number.isFinite(this.lastRecallLlmEvalAt)
            ? this.lastRecallLlmEvalAt
            : 0;
        let blockedReason: QuietRecallEvaluationBlockReason | undefined;
        if (this.dependencies.getAISetupIssue() !== null) {
            blockedReason = "provider_unavailable";
        } else if (
            !roundStarted
            &&
            lastRoundStartedAt > 0
            && runNow.getTime() - lastRoundStartedAt < RECALL_LLM_COOLDOWN_MS
        ) {
            blockedReason = "cooldown";
        }

        let model: QuietRecallProviderModel | null = null;
        if (!blockedReason) {
            try {
                model = await this.dependencies.createModel(
                    this.dependencies.getSettings().pagelet.temperature,
                    { maxTokens: 300 },
                );
            } catch (error) {
                this.dependencies.log("Quiet Recall model setup failed", error);
            }
            if (!model) blockedReason = "provider_unavailable";
        }

        const recall = await this.getEvaluationCoordinator().evaluate({
            localResult: {
                ...localResult,
                totalCount: evaluationCandidates.length,
                candidates: evaluationCandidates,
            },
            contextFingerprint,
            startedAt: runNow.getTime(),
            ...(blockedReason ? { blockedReason } : {}),
            fingerprintCandidate: (fingerprint, candidate) => {
                const material = evaluationMaterials.get(candidate.id);
                return material
                    ? quietRecallCandidateEvaluationFingerprint(fingerprint, candidate, material)
                    : `quiet-recall-missing-material:${stableHash(`${fingerprint}:${candidate.id}`)}`;
            },
            reserve: async () => {
                if (!runIdentityIsCurrent()) return { ok: false, reason: "invalid_context" };
                const reservation = await reserveActualProviderCall();
                if (!reservation.ok) return reservation;
                return {
                    ok: true,
                    providerCallReservation: reservation.reservation,
                    ...(reservation.limiterUsage
                        ? { limiterUsage: reservation.limiterUsage }
                        : {}),
                };
            },
            evaluator: async (attempt: QuietRecallEvaluationAttempt, providerCallReservation) => {
                const material = evaluationMaterials.get(attempt.candidate.id);
                if (!runIdentityIsCurrent()) return { status: "rejected", reason: "cancelled" };
                if (!model) return { status: "rejected", reason: "provider_unavailable" };
                if (!material) return { status: "rejected", reason: "malformed" };
                const prompt = attempt.kind === "language_retry"
                    ? `${material.prompt}\n\n${buildQuietRecallLanguageRetryInstruction(recallLanguage)}`
                    : material.prompt;
                return this.evaluateQuietRecallProviderAttempt(
                    model,
                    prompt,
                    content,
                    attempt.kind,
                    { provider: providerSnapshot, model: modelSnapshot },
                    runIdentityIsCurrent,
                    providerCallReservation,
                );
            },
        });
        const postRunLimiterUsage = recall.evaluationDiagnostics
            ? await this.getQuietRecallLimiterUsage(this.getRateLimiter())
            : {};
        const evaluationDiagnostics = recall.evaluationDiagnostics
            ? {
                ...recall.evaluationDiagnostics,
                semanticRetrievalCalls: retrievalProviderCalls,
                totalProviderCalls: recall.evaluationDiagnostics.providerCalls
                    + retrievalProviderCalls,
                estimatedCost: recall.evaluationDiagnostics.estimatedCost
                    + retrievalEstimatedCost,
                pricingKnown: recall.evaluationDiagnostics.pricingKnown
                    && retrievalPricingKnown,
                ...(postRunLimiterUsage.limiterUsage
                    ? { limiterUsage: postRunLimiterUsage.limiterUsage }
                    : {}),
            }
            : undefined;
        return {
            ...recall,
            ...(evaluationDiagnostics ? { evaluationDiagnostics } : {}),
            discoverCandidates,
            sourceSnapshotId,
            ...(sourcePaths ? { sourcePaths } : {}),
            dataBoundarySnapshotId,
            evaluationPolicySnapshotId,
        };
    }

    quietRecallCandidateSourcesAreCurrent(candidate: QuietRecallCandidate): boolean {
        return candidate.sourceRefs.length > 0 && candidate.sourceRefs.every((ref) => {
            const file = this.dependencies.app.vault.getAbstractFileByPath(normalizePath(ref.path));
            return file instanceof TFile
                && file.extension === "md"
                && this.dependencies.source.isPageletProviderSourceAllowedFile(file);
        });
    }

    resolveQuietRecallRunSourceSnapshots(
        activeSnapshot: QuietRecallSourceSnapshot,
        capturedCandidateSnapshots: readonly QuietRecallSourceSnapshot[],
        candidates: readonly QuietRecallCandidate[],
    ): QuietRecallSourceSnapshot[] | null {
        const capturedByPath = new Map<string, QuietRecallSourceSnapshot>();
        const rememberCaptured = (snapshot: QuietRecallSourceSnapshot): boolean => {
            const path = normalizePath(snapshot.path);
            const existing = capturedByPath.get(path);
            if (
                existing
                && (existing.mtime !== snapshot.mtime || existing.size !== snapshot.size)
            ) return false;
            capturedByPath.set(path, { ...snapshot, path });
            return true;
        };
        if (!rememberCaptured(activeSnapshot)) return null;
        for (const snapshot of capturedCandidateSnapshots) {
            if (!rememberCaptured(snapshot)) return null;
        }

        const paths = new Set<string>([normalizePath(activeSnapshot.path)]);
        for (const candidate of candidates) {
            for (const ref of candidate.sourceRefs) paths.add(normalizePath(ref.path));
        }
        const snapshots: QuietRecallSourceSnapshot[] = [];
        for (const path of paths) {
            const captured = capturedByPath.get(path);
            if (captured) {
                snapshots.push(captured);
                continue;
            }
            // Derived candidate text is provider-bound only when every source
            // body was freshly validated and paired with its captured stat.
            return null;
        }
        return this.quietRecallSourceSnapshotsAreCurrent(snapshots) ? snapshots : null;
    }

    async reserveQuietRecallProviderCall(options: {
        roundStarted: boolean;
        revalidate: () => boolean;
    }): Promise<QuietRecallProviderCallReservation> {
        const reserve = async (startedRound: boolean): Promise<QuietRecallProviderCallReservation> => {
            if (!options.revalidate()) return { ok: false, reason: "invalid_context" };
            const limiter = this.getRateLimiter();
            let decision: Awaited<ReturnType<PageletRateLimiter["reserveLeaseIf"]>>;
            try {
                decision = await limiter.reserveLeaseIf(options.revalidate);
            } catch (error) {
                this.dependencies.log("Quiet Recall rate-limit reservation failed closed", error);
                return { ok: false, reason: "budget" };
            }
            if (!decision.ok) {
                return {
                    ok: false,
                    reason: decision.reason === "condition" ? "invalid_context" : "budget",
                };
            }
            if (!options.revalidate()) {
                await decision.reservation.rollback();
                return { ok: false, reason: "invalid_context" };
            }
            let settled = false;
            return {
                ok: true,
                startedRound,
                reservation: {
                    commit: () => {
                        decision.reservation.commit();
                        settled = true;
                    },
                    rollback: async () => {
                        if (settled) return;
                        await decision.reservation.rollback();
                        settled = true;
                    },
                },
            };
        };

        if (options.roundStarted) return reserve(false);

        const tail = this.roundAdmissionTail ?? Promise.resolve();
        let releaseClaim!: () => void;
        let claimReleased = false;
        const claimSettled = new Promise<void>((resolve) => {
            releaseClaim = () => {
                if (claimReleased) return;
                claimReleased = true;
                resolve();
            };
        });
        // Hold the serialized first-round claim until the provisional slot is
        // committed or rolled back. Concurrent runs then re-check cooldown
        // against the actual outcome instead of racing past a returned lease.
        this.roundAdmissionTail = tail.then(
            () => claimSettled,
            () => claimSettled,
        ).then(() => undefined);
        const admission = tail.then(async (): Promise<QuietRecallProviderCallReservation> => {
            if (!options.revalidate()) {
                releaseClaim();
                return { ok: false, reason: "invalid_context" };
            }
            const now = Date.now();
            if (
                this.lastRecallLlmEvalAt > 0
                && now - this.lastRecallLlmEvalAt < RECALL_LLM_COOLDOWN_MS
            ) {
                releaseClaim();
                return { ok: false, reason: "cooldown" };
            }
            const decision = await reserve(true);
            if (!decision.ok) {
                releaseClaim();
                return decision;
            }
            const reservation = decision.reservation;
            let settled = false;
            return {
                ...decision,
                reservation: {
                    commit: () => {
                        if (settled) return;
                        try {
                            reservation.commit();
                            this.lastRecallLlmEvalAt = now;
                            settled = true;
                        } finally {
                            releaseClaim();
                        }
                    },
                    rollback: async () => {
                        if (settled) return;
                        try {
                            await reservation.rollback();
                            settled = true;
                        } finally {
                            releaseClaim();
                        }
                    },
                },
            };
        }).catch((error) => {
            releaseClaim();
            throw error;
        });
        return admission;
    }

    async getQuietRecallLimiterUsage(
        limiter: PageletRateLimiter,
    ): Promise<{ limiterUsage?: QuietRecallLimiterUsage }> {
        try {
            if (typeof limiter.getStateSnapshot !== "function") return {};
            const usage = await limiter.getStateSnapshot();
            return {
                limiterUsage: {
                    hourlyUsed: usage.hourlyTimestamps.length,
                    hourlyCap: QUIET_RECALL_CALL_LIMITS.hourly,
                    hourlyRemaining: Math.max(
                        0,
                        QUIET_RECALL_CALL_LIMITS.hourly - usage.hourlyTimestamps.length,
                    ),
                    dailyUsed: usage.dailyCount,
                    dailyCap: QUIET_RECALL_CALL_LIMITS.daily,
                    dailyRemaining: Math.max(
                        0,
                        QUIET_RECALL_CALL_LIMITS.daily - usage.dailyCount,
                    ),
                },
            };
        } catch (error) {
            this.dependencies.log("Quiet Recall post-reservation usage diagnostics unavailable", error);
            return {};
        }
    }

    buildQuietRecallRunSourceSnapshotId(
        currentPath: string,
        candidates: readonly QuietRecallCandidate[],
        capturedSourcePaths?: readonly string[],
    ): string | null {
        const paths = new Set<string>();
        if (capturedSourcePaths && capturedSourcePaths.length > 0) {
            for (const path of capturedSourcePaths) paths.add(normalizePath(path));
        } else {
            paths.add(normalizePath(currentPath));
            for (const candidate of candidates) {
                for (const ref of candidate.sourceRefs) paths.add(normalizePath(ref.path));
            }
        }
        const sources: Array<{ path: string; mtime: number; size: number }> = [];
        for (const path of paths) {
            const file = this.dependencies.app.vault.getAbstractFileByPath(path);
            if (
                !(file instanceof TFile)
                || file.extension !== "md"
                || !this.dependencies.source.isPageletProviderSourceAllowedFile(file)
            ) return null;
            sources.push({
                path: file.path,
                mtime: file.stat.mtime,
                size: file.stat.size,
            });
        }
        return buildQuietRecallSourceSnapshotId(sources);
    }

    isQuietRecallRunCurrent(result: QuietRecallRunResult): boolean {
        if (
            !result.currentPath
            || !result.sourceSnapshotId
            || !result.dataBoundarySnapshotId
            || !result.evaluationPolicySnapshotId
        ) return false;
        const activeFile = this.dependencies.app.workspace.getActiveFile();
        if (
            !(activeFile instanceof TFile)
            || activeFile.extension !== "md"
            || normalizePath(activeFile.path) !== normalizePath(result.currentPath)
        ) return false;
        if (result.dataBoundarySnapshotId !== this.dependencies.getDataBoundaryFingerprint()) return false;
        if (result.evaluationPolicySnapshotId !== this.getPolicyIdentity()) return false;
        return result.sourceSnapshotId === this.buildQuietRecallRunSourceSnapshotId(
            result.currentPath,
            result.discoverCandidates ?? result.candidates,
            result.sourcePaths,
        );
    }

    async evaluateQuietRecallProviderAttempt(
        model: QuietRecallProviderModel,
        prompt: string,
        currentNoteContent: string,
        attemptKind: QuietRecallEvaluationAttempt["kind"],
        pricingIdentity: { provider: string; model: string },
        revalidate: () => boolean,
        providerCallReservation?: PageletProviderCallReservation,
    ): Promise<QuietRecallEvaluationDecision> {
        let text = "";
        let outcome: "accepted" | "rejected" | "malformed" | "timeout" | "provider-error" = "provider-error";
        let providerInvoked = false;
        let decision: QuietRecallEvaluationDecision;
        try {
            const result = await this.dependencies.getProviderCallAdmission().executeStandardCall(() => {
                providerInvoked = true;
                return withQuietRecallProviderTimeout(
                    Promise.resolve().then(() => model.invoke(prompt)),
                );
            }, {
                revalidate,
                ...(providerCallReservation
                    ? { reserve: () => providerCallReservation }
                    : {}),
            });
            text = coerceModelResultToString(result);
            decision = parseQuietRecallEvaluationDecision(text, currentNoteContent);
            outcome = decision.status === "accepted"
                ? "accepted"
                : decision.status === "rejected" && decision.reason === "malformed"
                    ? "malformed"
                    : "rejected";
        } catch (error) {
            this.dependencies.log("Quiet Recall LLM evaluation failed", error);
            const timedOut = error instanceof QuietRecallProviderTimeoutError;
            outcome = timedOut ? "timeout" : "provider-error";
            decision = {
                status: "rejected",
                reason: timedOut
                    ? "timeout"
                    : providerInvoked
                        ? "provider_error"
                        : "cancelled",
            };
        }
        if (!providerInvoked) return decision;
        const cost = this.dependencies.getCostTracker().record({
            inputTokens: estimateTokens(prompt),
            outputTokens: estimateTokens(text),
            provider: pricingIdentity.provider,
            model: pricingIdentity.model,
            feature: "quiet-recall",
            attemptKind: attemptKind === "language_retry" ? "language-retry" : "initial",
            outcome,
        });
        // Keep the evaluation decision usable with legacy/test trackers that
        // record successfully but do not return an entry object.
        if (!cost) return decision;
        return {
            ...decision,
            cost: {
                inputTokens: cost.inputTokens,
                outputTokens: cost.outputTokens,
                estimatedCost: cost.estimatedCost,
                currency: cost.currency,
                pricingKnown: cost.pricingKnown,
            },
        };
    }

    async saveQuietRecallAsInsight(candidate: QuietRecallCandidate): Promise<QuietRecallSaveResult> {
        if (!this.dependencies.getSettings().quietRecall.enabled) {
            return {
                ok: false as const,
                reason: "disabled",
                message: pageletT("pagelet.recall.save.disabled", this.dependencies.getLocale()),
            };
        }
        const input = quietRecallCandidateToSavedInsightInput(candidate);
        const result = await this.dependencies.createSavedInsight(input);
        const coerced = coerceQuietRecallSaveResult(result);
        if (coerced.ok) {
            void this.recordQuietRecallFeedback(candidate, "accept").catch((error) => {
                this.dependencies.log("Quiet Recall accept feedback skipped", error);
            });
            new Notice(pageletT("pagelet.recall.save.saved", this.dependencies.getLocale()), 4000);
            return {
                ...coerced,
                message: pageletT("pagelet.recall.save.saved", this.dependencies.getLocale()),
            };
        } else {
            const message = pageletT("pagelet.recall.save.failed", this.dependencies.getLocale());
            new Notice(message, 5000);
            return { ...coerced, message };
        }
    }

    recordQuietRecallFeedback(
        candidate: QuietRecallCandidate,
        feedback: RetrievalHabitFeedbackKind,
    ): Promise<RetrievalHabitProfileRecordResult> {
        return this.dependencies.recordFeedback(candidate, feedback);
    }

    async linkQuietRecallCandidateFromActiveNote(
        candidate: QuietRecallCandidate,
        currentPath?: string,
    ): Promise<{ ok: boolean; message: string }> {
        const sourcePath = currentPath ? normalizePath(currentPath).replace(/^\.\//, "") : "";
        const activeFile = this.dependencies.app.workspace.getActiveFile();
        const resolvedSourcePath = sourcePath || (activeFile instanceof TFile && activeFile.extension === "md" ? activeFile.path : "");
        if (!resolvedSourcePath) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkNoActiveNote", this.dependencies.getLocale()),
            };
        }
        const candidatePath = quietRecallLinkTargetPath(candidate, resolvedSourcePath);
        if (!candidatePath) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkNoDistinctSource", this.dependencies.getLocale()),
            };
        }
        return this.linkRecallCandidate(resolvedSourcePath, candidatePath);
    }

    async linkRecallCandidate(currentPath: string, candidatePath: string): Promise<{ ok: boolean; message: string }> {
        const locale = this.dependencies.getLocale();
        const normalizedCurrentPath = normalizePath(currentPath).replace(/^\.\//, "");
        const normalizedCandidatePath = normalizePath(candidatePath).replace(/^\.\//, "");
        if (!normalizedCurrentPath || normalizedCurrentPath === normalizedCandidatePath) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkNoDistinctSource", locale),
            };
        }
        const currentFile = this.dependencies.app.vault.getAbstractFileByPath(normalizedCurrentPath);
        const candidateFile = this.dependencies.app.vault.getAbstractFileByPath(normalizedCandidatePath);
        if (
            !(currentFile instanceof TFile)
            || currentFile.extension !== "md"
            || !(candidateFile instanceof TFile)
            || candidateFile.extension !== "md"
        ) {
            return {
                ok: false,
                message: this.quietRecallLinkFailureMessage("file-not-found"),
            };
        }
        if (!this.dependencies.source.isDataBoundaryAllowedPath(currentFile.path) || !this.dependencies.source.isDataBoundaryAllowedPath(candidateFile.path)) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkBlocked", locale),
            };
        }

        const confirmed = await this.dependencies.confirmLink({
            title: pageletT("pagelet.tab.recall.linkConfirmTitle", locale),
            message: pageletT("pagelet.tab.recall.linkConfirmMessage", locale, {
                currentPath: currentFile.path,
                candidatePath: candidateFile.path,
            }),
            confirmText: pageletT("pagelet.tab.recall.linkConfirm", locale),
        });
        if (!confirmed) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkCancelled", locale),
            };
        }

        const result = await this.dependencies.addRelatedLink(currentFile.path, candidateFile.path);
        if (!result.ok) {
            return {
                ok: false,
                message: this.quietRecallLinkFailureMessage(result.reason),
            };
        }
        void this.recordQuietRecallFeedback({
            id: `quiet-recall-link:${currentFile.path}:${candidateFile.path}`,
            title: candidateFile.basename,
            summary: `Linked ${currentFile.path} and ${candidateFile.path}.`,
            sourceRefs: [{ path: candidateFile.path, evidenceStrength: "medium" }],
            whyNow: [],
            nextAction: "",
            relation: "related",
            score: 0,
            generatedAt: new Date().toISOString(),
        }, "accept").catch((error) => {
            this.dependencies.log("Quiet Recall link feedback skipped", error);
        });
        return {
            ok: true,
            message: result.changed
                ? pageletT("pagelet.tab.recall.linked", locale)
                : pageletT("pagelet.tab.recall.alreadyLinked", locale),
        };
    }

    quietRecallLinkFailureMessage(reason: string): string {
        const locale = this.dependencies.getLocale();
        switch (reason) {
            case "file-not-found":
                return pageletT("pagelet.tab.recall.linkFailed.fileMissing", locale);
            case "frontmatter-unavailable":
                return pageletT("pagelet.tab.recall.linkFailed.frontmatterUnavailable", locale);
            case "frontmatter-write-failed":
                return pageletT("pagelet.tab.recall.linkFailed.writeFailed", locale);
            default:
                return pageletT("pagelet.tab.recall.linkFailed", locale);
        }
    }


    async collectPageletProviderAllowedSavedInsights(): Promise<QuietRecallSavedInsightCollection> {
        const validationByPath = new Map<string, Promise<QuietRecallSourceSnapshot | null>>();
        const validateSource = (rawPath: string): Promise<QuietRecallSourceSnapshot | null> => {
            const path = normalizePath(rawPath);
            const existing = validationByPath.get(path);
            if (existing) return existing;
            const validation = (async () => {
                try {
                    const file = this.dependencies.app.vault.getAbstractFileByPath(path);
                    if (
                        !(file instanceof TFile)
                        || file.extension !== "md"
                        || !this.dependencies.source.isPageletProviderSourceAllowedFile(file)
                    ) return null;
                    const before = { path: file.path, mtime: file.stat.mtime, size: file.stat.size };
                    const content = typeof this.dependencies.app.vault.read === "function"
                        ? await this.dependencies.app.vault.read(file)
                        : await this.dependencies.app.vault.cachedRead(file);
                    const current = this.dependencies.app.vault.getAbstractFileByPath(path);
                    if (
                        !(current instanceof TFile)
                        || current.extension !== "md"
                        || current.stat.mtime !== before.mtime
                        || current.stat.size !== before.size
                        || !this.dependencies.source.isPageletProviderSourceAllowedFile(current, content)
                    ) return null;
                    return before;
                } catch (error) {
                    this.dependencies.log("Saved Insight source validation skipped", { path, error });
                    return null;
                }
            })();
            validationByPath.set(path, validation);
            return validation;
        };

        const insights: SavedInsight[] = [];
        const snapshots = new Map<string, QuietRecallSourceSnapshot>();
        for (const insight of this.dependencies.listSavedInsights()) {
            if (insight.status !== "active" || insight.sourceRefs.length === 0) continue;
            const scopeAllowed = (insight.scope.paths ?? []).every((rawPath) => {
                const path = normalizePath(rawPath);
                const file = this.dependencies.app.vault.getAbstractFileByPath(path);
                return file instanceof TFile
                    ? this.dependencies.source.isPageletProviderSourceAllowedFile(file)
                    : this.dependencies.source.isDataBoundaryAllowedPath(path);
            });
            if (!scopeAllowed) continue;
            const sourceSnapshots = await Promise.all(
                insight.sourceRefs.map((ref) => validateSource(ref.path)),
            );
            if (sourceSnapshots.some((snapshot) => snapshot === null)) continue;
            insights.push(insight);
            for (const snapshot of sourceSnapshots) {
                if (snapshot) snapshots.set(normalizePath(snapshot.path), snapshot);
            }
        }
        return { insights, sourceSnapshots: [...snapshots.values()] };
    }
}

class QuietRecallProviderTimeoutError extends Error {
    constructor() {
        super(`Quiet Recall provider timed out after ${QUIET_RECALL_PROVIDER_TIMEOUT_MS}ms.`);
        this.name = "QuietRecallProviderTimeoutError";
    }
}

function coerceModelResultToString(result: unknown): string {
    if (typeof result === "string") return result;
    const content = (result as { content?: unknown })?.content;
    return content != null ? String(content) : String(result);
}

function quietRecallCandidateAge(note: QuietRecallVaultNote, now: Date): string {
    const value = note.modifiedAt ?? note.createdAt;
    if (!value) return "unknown";
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "unknown";
    const ageDays = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
    if (ageDays < 1) return "today";
    const days = Math.round(ageDays);
    if (ageDays < 7) return days === 1 ? "1 day" : `${days} days`;
    const weeks = Math.round(ageDays / 7);
    if (ageDays < 30) return weeks === 1 ? "1 week" : `${weeks} weeks`;
    const months = Math.round(ageDays / 30);
    if (ageDays < 365) return months === 1 ? "1 month" : `${months} months`;
    const years = Math.round(ageDays / 365);
    return years === 1 ? "1 year" : `${years} years`;
}

function quietRecallEvaluationMaterial(
    candidate: QuietRecallCandidate,
    currentDigest: RecallNoteDigest,
    vaultNotes: readonly QuietRecallVaultNote[],
    now: Date,
    language?: "zh" | "en",
): QuietRecallEvaluationMaterial {
    const candidatePaths = new Set(candidate.sourceRefs.map((ref) => normalizePath(ref.path)));
    const matchedNote = vaultNotes.find((note) => candidatePaths.has(normalizePath(note.path)));
    const candidateDigest = candidate.sourceInsightId
        ? {
            title: candidate.title.replace(/^(Recall:|回忆：)\s*/, ""),
            headings: [],
            firstParagraph: candidate.summary,
        }
        : matchedNote
        ? extractRecallDigest(matchedNote)
        : {
            title: candidate.title.replace(/^(Recall:|回忆：)\s*/, ""),
            headings: [],
            firstParagraph: candidate.summary,
        };
    const candidateAge = matchedNote ? quietRecallCandidateAge(matchedNote, now) : "unknown";
    const noteByPath = new Map(vaultNotes.map((note) => [normalizePath(note.path), note]));
    const sourceSnapshots = candidate.sourceRefs
        .map((ref) => {
            const path = normalizePath(ref.path);
            const note = noteByPath.get(path);
            return {
                path,
                contentHash: stableHash(note?.content ?? ""),
                modifiedAt: note?.modifiedAt ?? note?.createdAt ?? null,
            };
        })
        .sort((left, right) => left.path.localeCompare(right.path));
    return {
        candidateDigest,
        candidateAge,
        prompt: buildRecallRelevancePrompt({ currentDigest, candidateDigest, candidateAge, language }),
        sourceSnapshots,
        relationInputs: {
            relation: candidate.relation,
            score: candidate.score,
            context: candidate.context ?? null,
            sourceInsightId: candidate.sourceInsightId ?? null,
        },
    };
}

function quietRecallContextFingerprint(input: {
    currentPath: string;
    currentContent: string;
    locale: string;
    provider: string;
    model: string;
    dataBoundarySnapshot: string;
    evaluationPolicySnapshotId: string;
}): string {
    return `quiet-recall-context:${stableHash(stableStringify({
        version: QUIET_RECALL_EVALUATOR_VERSION,
        currentPath: normalizePath(input.currentPath),
        currentContentHash: stableHash(input.currentContent),
        locale: input.locale,
        provider: input.provider,
        model: input.model,
        dataBoundarySnapshot: input.dataBoundarySnapshot,
        evaluationPolicySnapshotId: input.evaluationPolicySnapshotId,
    }))}`;
}

function quietRecallCandidateEvaluationFingerprint(
    contextFingerprint: string,
    candidate: QuietRecallCandidate,
    material: QuietRecallEvaluationMaterial,
): string {
    return `quiet-recall-evaluation:${stableHash(stableStringify({
        contextFingerprint,
        candidateId: candidate.id,
        candidateContent: {
            title: candidate.title,
            summary: candidate.summary,
            nextAction: candidate.nextAction,
        },
        candidateDigest: material.candidateDigest,
        candidateAge: material.candidateAge,
        promptHash: stableHash(material.prompt),
        sourceSnapshots: material.sourceSnapshots,
        relationInputs: material.relationInputs,
    }))}`;
}

function quietRecallLanguageMismatch(whyNow: string, noteContent: string): boolean {
    const noteSample = noteContent.slice(0, 2_000);
    const noteHasCjk = /[一-鿿぀-ゟ゠-ヿ]/.test(noteSample);
    const noteHasLatin = /[A-Za-z]/.test(noteSample);
    const whyNowHasCjk = /[一-鿿぀-ゟ゠-ヿ]/.test(whyNow);
    if (noteHasCjk) return !whyNowHasCjk;
    if (noteHasLatin) return whyNowHasCjk;
    return false;
}

function parseQuietRecallEvaluationDecision(
    text: string,
    noteContent: string,
): QuietRecallEvaluationDecision {
    let raw: unknown;
    try {
        const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        raw = JSON.parse(cleaned);
    } catch {
        return { status: "rejected", reason: "malformed" };
    }
    if (!raw || typeof raw !== "object" || typeof (raw as { isConvincing?: unknown }).isConvincing !== "boolean") {
        return { status: "rejected", reason: "malformed" };
    }
    const parsed = parseRecallRelevanceResponse(text);
    if (!parsed.isConvincing) return { status: "rejected", reason: "not_convincing" };
    const whyNow = parsed.whyNow?.trim();
    if (!whyNow) return { status: "rejected", reason: "malformed" };
    if (quietRecallLanguageMismatch(whyNow, noteContent)) {
        return { status: "retry", reason: "language_mismatch" };
    }
    return { status: "accepted", whyNow };
}

async function withQuietRecallProviderTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeout: PlatformTimeoutHandle | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setPlatformTimeout(() => reject(new QuietRecallProviderTimeoutError()), QUIET_RECALL_PROVIDER_TIMEOUT_MS);
    });
    try {
        return await Promise.race([operation, timeoutPromise]);
    } finally {
        if (timeout !== null) clearPlatformTimeout(timeout);
    }
}

function buildQuietRecallLanguageRetryInstruction(language?: "zh" | "en"): string {
    const langDirective = language === "zh"
        ? "Respond in Simplified Chinese"
        : language === "en"
            ? "Respond in English"
            : "Respond in the same language as the notes above";
    return `IMPORTANT: Your previous response used the wrong language. ${langDirective} and keep the same JSON-only format.`;
}

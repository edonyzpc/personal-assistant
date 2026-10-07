import { Notice, normalizePath, TFile } from "obsidian";

import { stableStringify } from "../ai-services/agent-utils";
import { parentFolder, stableHash } from "../pa/helpers";
import type {
    RetrievalHabitFeedbackKind,
    RetrievalHabitProfileRecordResult,
    RetrievalHabitProfileSettings,
} from "../pa/retrieval-habit-profile";
import {
    quietRecallCandidateToSavedInsightInput,
    quietRecallLinkTargetPath,
    coerceQuietRecallSaveResult,
    type QuietRecallCandidate,
    type QuietRecallRelatedNote,
    type QuietRecallSaveResult,
    type QuietRecallVaultNote,
} from "../pa/quiet-recall";
import type {
    SavedInsight,
    SavedInsightCreateInput,
    SavedInsightResult,
} from "../pa/saved-insight-store";
import type { QuietRecallSettings } from "../settings";
import type { PageletSettings } from "../settings/pagelet";
import { pageletT } from "../locales/pagelet";
import {
    PageletRateLimiter,
    type PageletRateLimitStorage,
} from "./pa-review-rate-limit";
import type { PageletProviderCallReservation } from "./provider-call-admission";
import type { SourceAccess } from "../plugin/source-access";
import type { PaRelatedLinkResult } from "../pa/frontmatter-link";

export const QUIET_RECALL_CALL_LIMITS = Object.freeze({ hourly: 10, daily: 50 });
const QUIET_RECALL_EVALUATOR_VERSION = "quiet-recall-why-now-v1";
const QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES = 40;

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
    createRateLimitStorage(): PageletRateLimitStorage;
    getVaultStorageScope(): string | null;
    getRateLimitStorageKey(vaultStorageScope: string | null): string;
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
    private evaluationPolicyIdentitySnapshot: string | null = null;

    constructor(private readonly dependencies: QuietRecallPluginIntegrationDependencies) {}

    syncPolicyIdentity(): void {
        this.evaluationPolicyIdentitySnapshot = this.getPolicyIdentity();
    }

    dispose(): void {
        this.rateLimiter = null;
        this.evaluationPolicyIdentitySnapshot = null;
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

        const resolvedLinks = this.dependencies.app.metadataCache?.resolvedLinks;
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

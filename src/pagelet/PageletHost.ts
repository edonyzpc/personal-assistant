/* Copyright 2023 edonyzpc */

/**
 * Narrow host interface -- what the Pagelet orchestrator needs from the plugin.
 *
 * Deliberately thin: only the settings and methods the orchestrator
 * actually reads. Everything else stays behind the plugin boundary.
 *
 * Extracted from orchestrator.ts so it can be imported independently
 * by sub-modules (BubbleCoordinator, BackgroundPreparationCoordinator,
 * PeriodicSummaryFlow, etc.) without pulling in the full orchestrator.
 */

import type { App, EventRef } from "obsidian";

import type { PetCorner } from "./pet/types";
import type { AnalyzeCallback } from "./preload/types";
import type { GenerateCallback, GeneratedReviewNote } from "./output/types";
import type { WriteResult } from "./output/types";
import type { PageletDetailPayload } from "./tab/types";
import type { DiscoveryResult } from "./panel/types";
import type {
    ConfirmedMemoryRecord,
    GraphDiscoveryRunResult,
    MaintenanceReviewRunResult,
    QuietRecallCandidate,
    QuietRecallRunResult,
    QuietRecallSaveResult,
    RetrievalHabitFeedbackKind,
    RetrievalHabitProfileRecordResult,
    ReviewQueueCreateInput,
    ReviewQueueItem,
    ReviewQueueListFilter,
    ReviewQueueResult,
    SavedInsight,
    ScopeRecapRunResult,
    WeeklyReviewRunResult,
} from "../pa";

/**
 * Narrow host interface -- what the Pagelet orchestrator needs from the plugin.
 *
 * Deliberately thin: only the settings and methods the orchestrator
 * actually reads. Everything else stays behind the plugin boundary.
 */
export interface PageletHost {
    readonly app: App;

    readonly settings: {
        pagelet: {
            enabled: boolean;
            petVisible: boolean;
            petCorner: PetCorner;
            proactiveHints: boolean;
            proactiveHintsCooldown: number;
            proactiveHintsQuietHours: {
                enabled: boolean;
                start: string;
                end: string;
            };
            preloadEnabled: boolean;
            preloadInterval: number;
            preloadPerHourCap: number;
            preloadPerDayCap: number;
            preloadTokenBudget: { input: number; output: number };
            outputLanguage: "auto" | "zh" | "en";
            temperature: number;
            foregroundPerHourCap: number;
            foregroundPerDayCap: number;
            maxInputTokens: number;
            maxOutputTokens: number;
            reviewsFolder: string;
            periodicSummaryScope: "3d" | "7d" | "14d";
            excludedFolders: string[];
            excludedTags: string[];
            excludedPatterns: string[];
            onboardingShown: boolean;
        };
        contextPager: {
            enabled: boolean;
        };
        quietRecall: {
            enabled: boolean;
            bubbleNudgesEnabled: boolean;
        };
    };

    /** Structured debug log (no-op when debug is false). */
    log(message: string, ...args: unknown[]): void;

    /**
     * Register an Obsidian EventRef so the plugin can detach it on unload.
     * Delegates to `Plugin.registerEvent`.
     */
    registerEvent(ref: EventRef): void;

    /**
     * Factory for the LLM callback used by PreloadEngine.
     * The host MUST enforce `allowWrite=false` on the returned callback.
     */
    createPreloadAnalyzeCallback(): AnalyzeCallback;

    /** Factory for the LLM callback used by foreground review commands. */
    createForegroundAnalyzeCallback(): AnalyzeCallback;

    /** Factory for the LLM callback used by ReviewNoteGenerator. */
    createGenerateCallback(): GenerateCallback;

    /** Write a review note through the Pagelet write framework. */
    writeReviewNote(note: GeneratedReviewNote): Promise<WriteResult>;

    /** Update a pagelet setting and persist to disk. */
    updatePageletSetting<K extends keyof PageletHost["settings"]["pagelet"]>(
        key: K,
        value: PageletHost["settings"]["pagelet"][K],
    ): void;

    /** Persist current settings to disk. */
    saveSettings(): Promise<void> | void;

    /** Open the shared Quick Capture modal. */
    openQuickCapture(): void;

    /** Open Pagelet detail results in a native Obsidian workspace leaf. */
    openPageletDetailView(payload: PageletDetailPayload): Promise<void> | void;

    /** Find semantically related notes via VSS hybrid search. */
    findRelatedNotes(
        primarySourcePath: string,
        noteContents: Array<{ path: string; content: string }>,
        sourcePaths: readonly string[],
    ): Promise<Array<{ path: string; content: string; score?: number; headingPath?: string[] }>>;

    /** Whether Memory is prepared enough for Pagelet connection discovery. */
    isMemoryReadyForPageletDiscovery(): Promise<boolean>;

    /** Run discovery analysis: find connections, themes, and gaps between the current note and related notes. */
    discoverConnections(
        currentNote: { path: string; content: string },
        relatedNotes: Array<{ path: string; content: string }>,
    ): Promise<DiscoveryResult | null>;

    /** List local Review Queue items for the current Pagelet surface. */
    listReviewQueueItems(filter?: ReviewQueueListFilter): ReviewQueueItem[];

    /** Create a local Review Queue item after provider/write gates have completed elsewhere. */
    createReviewQueueItem(input: ReviewQueueCreateInput): Promise<ReviewQueueResult<ReviewQueueItem>>;

    /** Dismiss a local Review Queue item without applying durable actions. */
    dismissReviewQueueItem(id: string): Promise<ReviewQueueResult<ReviewQueueItem>>;

    /** Run a local preview-only Maintenance Review scan. Queue entry is explicit only. */
    runMaintenanceReview(options?: {
        enqueueProposals?: boolean;
        scopePaths?: readonly string[];
        maxFiles?: number;
        maxProposalsPerCategory?: number;
        includeWholeVault?: boolean;
    }): Promise<MaintenanceReviewRunResult>;

    /** Run local graph-aware discovery. Queue entry is explicit only. */
    runGraphDiscovery(options?: { enqueueItems?: boolean }): Promise<GraphDiscoveryRunResult>;

    /** Build an on-demand source-backed recap for the current Pagelet scope. */
    runScopeRecap(): Promise<ScopeRecapRunResult>;

    /** Run the manual Weekly Review loop for the recent seven-day range. */
    runWeeklyReview(): Promise<WeeklyReviewRunResult>;

    /** Save user-selected Weekly Review items as a generated review note. */
    saveWeeklyReviewNote(review: WeeklyReviewRunResult, acceptedItemIds: readonly string[]): Promise<WriteResult>;

    /** Generate quiet recall candidates for the active note. */
    runQuietRecall(): Promise<QuietRecallRunResult>;

    /** Save a quiet recall candidate into the Saved Insight ledger. */
    saveQuietRecallAsInsight(candidate: QuietRecallCandidate): Promise<QuietRecallSaveResult>;

    /** Record local aggregate-only Quiet Recall feedback when the profile is enabled. */
    recordQuietRecallFeedback(
        candidate: QuietRecallCandidate,
        feedback: RetrievalHabitFeedbackKind,
    ): Promise<RetrievalHabitProfileRecordResult>;

    /** List local Saved Insights for the Pagelet detail ledger. */
    listSavedInsights(): SavedInsight[];

    /** List local Confirmed Memory governance records for the Pagelet detail shell. */
    listConfirmedMemories(): ConfirmedMemoryRecord[];
}

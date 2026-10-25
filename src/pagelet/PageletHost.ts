/* Copyright 2023 edonyzpc */

/**
 * Narrow host interface -- what the Pagelet orchestrator needs from the plugin.
 *
 * Deliberately thin: only the settings and methods the orchestrator
 * actually reads. Everything else stays behind the plugin boundary.
 *
 * Extracted from orchestrator.ts so it can be imported independently
 * by sub-modules without pulling in the full orchestrator.
 * without pulling in the full orchestrator.
 */

import type { App, EventRef, WorkspaceLeaf } from "obsidian";

import type {
    PageletChatHandoffContext,
    PageletChatHandoffPreparationResult,
} from "../ai-services/pagelet-handoff";
import type { PetCorner } from "./pet/types";
import type { PageletAttentionStorage } from "./attention";
import type { GeneratedReviewNote } from "./output/types";
import type { WriteResult } from "./output/types";
import type {
    PageletDetailOpenOptions,
    PageletDetailPayload,
    PageletDetailPathState,
} from "./tab/types";
import type { DiscoveryResult, PanelMemoryGovernanceState } from "./panel/types";
import type {
    PageletAgentValidationIdentity,
    PageletAgentVerifiedInsightCollection,
    PageletDeepDiscoverCommitSeal,
    PageletDeepDiscoverControllerResult,
    PageletDeepDiscoverTriggerReason,
} from "./agent/types";
import type { PageletAgentDeliveryCandidate } from "./agent/delivery-adapter";
import type { PageletDeepDiscoverReadResult } from "./agent/pagelet-deep-discover-controller";
import type { PageletDeepDiscoverActivity } from "./agent/pagelet-deep-discover-scheduler";
import type {
    ConfirmedMemoryRecord,
    GraphDiscoveryRunResult,
    MaintenanceReviewRunResult,
    PatternDetectionResult,
    ReviewQueueCreateInput,
    ReviewQueueItem,
    ReviewQueueListFilter,
    ReviewQueueResult,
    SavedInsight,
} from "../pa";

export interface PageletDeepDiscoverUsage {
    runs: number;
    dailyCap: number;
    modelTurns: number;
    toolCalls: number;
}

/**
 * Narrow host interface -- what the Pagelet orchestrator needs from the plugin.
 *
 * Deliberately thin: only the settings and methods the orchestrator
 * actually reads. Everything else stays behind the plugin boundary.
 */
export interface PageletHost {
    readonly app: App;
    readonly pageletFeatureScope: object;
    isFeatureScopeCurrent(scope: object): boolean;

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
            backgroundDiscoveryEnabled: boolean;
            outputLanguage: "auto" | "zh" | "en";
            temperature: number;
            foregroundPerHourCap: number;
            foregroundPerDayCap: number;
            maxInputTokens: number;
            maxOutputTokens: number;
            reviewsFolder: string;
            excludedFolders: string[];
            excludedTags: string[];
            excludedPatterns: string[];
            onboardingShown: boolean;
            maintenanceScanSuggested: boolean;
            quickCaptureExplained: boolean;
            pageletProviderFirstUseNotified: boolean;
        };
        contextPager: {
            enabled: boolean;
        };
        focusMode: boolean;
        confirmedMemoryCount: number;
    };

    /** Structured debug log (no-op when debug is false). */
    log(message: string, ...args: unknown[]): void;

    /**
     * Register an Obsidian EventRef so the plugin can detach it on unload.
     * Delegates to `Plugin.registerEvent`.
     */
    registerEvent(ref: EventRef): void;

    /** Device-local, per-vault storage for content-free delivery seen/ack state. */
    createPageletAttentionStorage?(): PageletAttentionStorage | undefined;

    /** Run the unified read-only Pagelet Agent for an exact vault path. */
    runDeepDiscover?(input: {
        path: string;
        triggerReason: PageletDeepDiscoverTriggerReason;
        force?: boolean;
        signal?: AbortSignal;
    }): Promise<PageletDeepDiscoverControllerResult>;

    /** Read existing results without initializing a provider or scheduling analysis. */
    readDeepDiscover?(input: { path: string; signal?: AbortSignal }): Promise<PageletDeepDiscoverReadResult>;
    getDeepDiscoverActivity?(path: string): PageletDeepDiscoverActivity;
    subscribeDeepDiscoverActivity?(listener: (path: string) => void): () => void;

    /** Diagnostic catalog lookup after an explicit run fails without tool use. */
    getDeepDiscoverFunctionCallingCapability?(): Promise<"supported" | "unsupported" | "unknown">;

    /** Commit content-free smoke evidence only after current-route acceptance. */
    acknowledgeDeepDiscoverResult?(
        result: PageletDeepDiscoverControllerResult,
        acceptedCandidates: readonly PageletAgentDeliveryCandidate[],
    ): void;

    /** Reject a controller result superseded before Orchestrator acceptance. */
    discardDeepDiscoverResult?(result: PageletDeepDiscoverControllerResult): void;

    /** Cancel active/pending Deep Discover work and clear in-memory derived content. */
    cancelDeepDiscover?(): void;

    /** Content-free usage for the current local day. */
    getDeepDiscoverUsage?(): Promise<PageletDeepDiscoverUsage>;

    /** Opaque runtime identity used to invalidate derived Deep Discover UI. */
    getDeepDiscoverPolicyIdentity?(): string;

    /** Synchronous fail-closed gate before a controller result mutates Pagelet UI/receipts. */
    isDeepDiscoverCommitSealCurrent?(
        seal: PageletDeepDiscoverCommitSeal,
        collection: PageletAgentVerifiedInsightCollection,
    ): boolean;

    /** Provider-free exact-source validation before a Pagelet action or Chat handoff. */
    validateDeepDiscoverInsight?(
        identity: PageletAgentValidationIdentity,
        signal?: AbortSignal,
    ): Promise<boolean>;

    /** Open a new Chat with a visible, context-only Pagelet attachment. */
    openPageletChatHandoff?(
        context: PageletChatHandoffContext,
        signal?: AbortSignal,
    ): Promise<PageletChatHandoffPreparationResult>;

    /** Write a review note through the Pagelet write framework. */
    writeReviewNote(note: GeneratedReviewNote): Promise<WriteResult>;

    /** Update a pagelet setting and persist to disk. */
    updatePageletSetting<K extends keyof PageletHost["settings"]["pagelet"]>(
        key: K,
        value: PageletHost["settings"]["pagelet"][K],
    ): void;

    /** Persist current settings to disk. */
    saveSettings(): Promise<void> | void;

    /** Start Memory preparation from a Pagelet setup state. */
    prepareMemoryForPagelet(): Promise<void> | void;

    /** Synchronous snapshot of active Memory preparation, if any. */
    getMemoryPreparationStatus?(): {
        filesDone?: number;
        filesTotal?: number;
        chunksEmbedded?: number;
        chunksTotal?: number;
    } | null;

    /** Check whether a path is inside PA's Data Boundary for Pagelet surfaces. */
    isPathAllowedForPagelet(path: string): boolean;

    /** Open PA settings from a trust/boundary explanation. */
    openPageletSettings(): void;

    /** Re-render the visible PA settings tab after an external state transition. */
    refreshPageletSettings?(): void;

    /** Open the shared Quick Capture modal. */
    openQuickCapture(): void;

    /** Open Pagelet detail results in a native Obsidian workspace leaf. */
    openPageletDetailView(payload: PageletDetailPayload, options?: PageletDetailOpenOptions): Promise<void> | void;
    /** Return the current native Detail routing state for a vault-relative note path. */
    getPageletDetailPathState?(path: string): PageletDetailPathState;
    /** Return the actual note anchor owned by this exact Detail leaf, if any. */
    getPageletDetailLeafAnchorPath?(leaf: WorkspaceLeaf): string | null;
    /** Reveal the live Detail for a note without changing its payload. */
    revealPageletDetailViewForPath?(path: string): Promise<boolean>;
    /** Project a per-note new-results cue onto any live Detail for that note. */
    markPageletDetailNewResults?(path: string, hasNewResults: boolean): void;

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

    /** Run local structure-based cross-note pattern detection. */
    detectCrossNotePatterns(): Promise<PatternDetectionResult | null>;

    /** List local Saved Insights for the Pagelet detail ledger. */
    listSavedInsights(): SavedInsight[];

    /** List local Confirmed Memory governance records for the Pagelet detail shell. */
    listConfirmedMemories(): ConfirmedMemoryRecord[];

    /** Governed record/effect/change projection when the device-local reader is authoritative. */
    getMemoryGovernancePanelState?(): PanelMemoryGovernanceState;
}

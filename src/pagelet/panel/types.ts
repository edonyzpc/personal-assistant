/* Copyright 2023 edonyzpc */

/**
 * Pagelet -- Panel component types.
 *
 * The Panel is a side panel (~380px wide) for deeper exploration.
 * It supports scenario-adaptive layouts that change based on which
 * scenario opened it (review, current note, discovery, summary).
 */

import type { PageletReviewDiagnostics } from "../pa-review-model";
import type { PageletSuggestion } from "../pa-review-schemas";
import type {
    PageletReviewRange,
    PageletScopeCandidateReason,
    PageletScopeSkippedReason,
} from "../scope";
import type {
    ConfirmedMemoryRecord,
    ContextPagerState,
    GraphDiscoveryRunResult,
    MaintenanceReviewRunResult,
    PatternDetectionResult,
    QuietRecallRunResult,
    ReviewQueueItem,
    SavedInsight,
    WeeklyReviewRunResult,
} from "../../pa";

/** Which scenario opened the Panel -- determines layout */
export type PanelLayoutType = "review" | "current" | "discover" | "summary";

export type PanelFindingDiagnostics = Pick<
    PageletReviewDiagnostics,
    "truncated" | "partial" | "droppedSuggestionsCount" | "costEntry"
>;

/** A panel finding item */
export interface PanelFinding {
    title: string;
    description: string;
    sourceFile?: string;
    sourceTitle?: string;
    insightText?: string;
    timestamp?: string;
    actions?: PanelAction[];
    suggestion?: PageletSuggestion;
    diagnostics?: PanelFindingDiagnostics;
    sourceId?: string;
}

/** Panel action button */
export interface PanelAction {
    label: string;
    callback: () => void;
}

/** Panel callbacks to parent */
export interface PanelCallbacks {
    onExpandToTab: () => void;
    onClose: () => void;
    onSourceClick: (sourceLink: string) => void;
    onSaveAsReviewNote: (findings: PanelFinding[]) => void | Promise<void>;
    onRunReview?: () => void | Promise<void>;
    onRunSelectedReview?: () => void | Promise<void>;
    onScopeRangeChange?: (range: PageletReviewRange) => void;
    onScopeCandidateToggle?: (path: string, included: boolean) => void;
    onRelatedNoteClick?: (noteName: string, sourcePath?: string) => void;
    onResearchFinding?: (finding: PanelFinding) => void | Promise<void>;
    onToggleHints?: () => void;
    onReviewQueueItemDismiss?: (id: string) => void | Promise<void>;
}

/** Options for creating a PanelView */
export interface PanelViewOptions {
    app?: import("obsidian").App;
    callbacks: PanelCallbacks;
    getLocale?: () => import("../../locales/pagelet").PageletLocale;
}

export interface PanelScopeCandidate {
    path: string;
    title: string;
    reason: PageletScopeCandidateReason;
    included: boolean;
    locked?: boolean;
    skippedReason?: PageletScopeSkippedReason;
}

export interface PanelScopeState {
    range: PageletReviewRange;
    candidates: PanelScopeCandidate[];
    includedCount: number;
    skippedCount: number;
    excludedReviewOutputCount?: number;
    estimatedInputTokens?: number;
}

export interface PanelReviewQueueState {
    items: ReviewQueueItem[];
    totalCount: number;
}

export interface PanelSavedInsightState {
    items: SavedInsight[];
    totalCount: number;
}

export interface PanelMemoryGovernanceState {
    records: ConfirmedMemoryRecord[];
    candidates?: ReviewQueueItem[];
    totalCount: number;
}

export type PanelMaintenanceReviewState = MaintenanceReviewRunResult;
export type PanelWeeklyReviewState = WeeklyReviewRunResult;
export type PanelQuietRecallState = QuietRecallRunResult;
export type PanelGraphDiscoveryState = GraphDiscoveryRunResult;
export type PanelPatternDetectionState = PatternDetectionResult;

export interface PanelOpenExtra {
    connections?: NoteConnection[];
    markdown?: string;
    scope?: PanelScopeState;
    sourcePath?: string;
    reviewQueue?: PanelReviewQueueState;
    contextPager?: ContextPagerState;
    savedInsights?: PanelSavedInsightState;
    memoryGovernance?: PanelMemoryGovernanceState;
    maintenanceReview?: PanelMaintenanceReviewState;
    weeklyReview?: PanelWeeklyReviewState;
    quietRecall?: PanelQuietRecallState;
    graphDiscovery?: PanelGraphDiscoveryState;
    patternDetection?: PanelPatternDetectionState;
}

/** Discovery connection between notes */
export interface NoteConnection {
    fromNote: string;
    toNote: string;
    strength: "strong" | "medium" | "weak";
    sharedConcepts: string[];
}

/** Discovery result */
export interface DiscoveryResult {
    connections: NoteConnection[];
    themes: Array<{ name: string; notes: string[]; concepts: string[] }>;
    gaps: Array<{ topic: string; description: string }>;
}

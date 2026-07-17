/* Copyright 2023 edonyzpc */

import type { PageletLocale } from "../../locales/pagelet";
import type { GeneratedReviewNote } from "../output/types";
import type { NoteConnection, PanelFinding } from "../panel/types";
import type {
    PanelMaintenanceReviewState,
    PanelMemoryGovernanceState,
    PanelQuietRecallState,
    PanelGraphDiscoveryState,
    PanelPatternDetectionState,
    PanelReviewQueueState,
    PanelSavedInsightState,
} from "../panel/types";
import type { ContextPagerState } from "../../pa";
import type { ScopeRecapRunResult } from "../../pa";

/**
 * Pagelet -- Tab component types.
 *
 * The Tab is a full editor tab for complex exploration.
 * It shows overview, theme clustering, and action suggestions.
 */

/** A section within the Tab view */
export interface TabSection {
    title: string;
    cards: TabCard[];
}

export type TabCardStyle = "default" | "insight" | "comparison" | "action" | "quote" | "source-list";

/** A card within a Tab section */
export interface TabCard {
    title?: string;
    body: string;
    tags?: string[];
    cardStyle?: TabCardStyle;
    sourceLinks?: Array<{ path: string; title?: string }>;
    actionLabel?: string;
    actionCallback?: () => void;
}

export type PageletDetailContent = PanelFinding[] | TabSection[];
export type PageletDetailLayoutType = "review" | "current" | "discover" | "summary";

export interface PageletDetailExtra {
    connections?: NoteConnection[];
    markdown?: string;
    /** @deprecated ReviewQueue items are now routed into memoryGovernance/maintenanceReview (D5 merge). Field kept for deserialization compat. */
    reviewQueue?: PanelReviewQueueState;
    contextPager?: ContextPagerState;
    savedInsights?: PanelSavedInsightState;
    memoryGovernance?: PanelMemoryGovernanceState;
    maintenanceReview?: PanelMaintenanceReviewState;
    /** @deprecated Weekly Review decomposed (2026-07-02). Field kept for deserialization compat. */
    weeklyReview?: unknown;
    quietRecall?: PanelQuietRecallState;
    graphDiscovery?: PanelGraphDiscoveryState;
    patternDetection?: PanelPatternDetectionState;
    scopeRecap?: ScopeRecapRunResult;
}

export type TabEntryReason =
    | "panel-expand"
    | "maintenance"
    | "quiet-recall"
    | "graph-discovery"
    | "pattern-detection"
    | "scope-recap"
    | "default";

export interface PageletDetailPayload {
    title: string;
    content: PageletDetailContent;
    locale: PageletLocale;
    layoutType?: PageletDetailLayoutType;
    extra?: PageletDetailExtra;
    sourcePath?: string;
    summarySaveNote?: GeneratedReviewNote;
    restoredFromState?: boolean;
    entryReason?: TabEntryReason;
}

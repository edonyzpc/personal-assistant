/* Copyright 2023 edonyzpc */

import type { PageletLocale } from "../../locales/pagelet";

/**
 * Pagelet — Bubble component types.
 *
 * The Bubble is a lightweight speech bubble that appears near the Pet
 * character, showing quick review findings and action buttons.
 */

/** Bubble visibility state */
export type BubbleState = "hidden" | "visible";

/** Content type determines which scenario's content to render */
export type BubbleContentType =
    | "recall-delivery"
    | "recap-delivery"
    | "pattern-delivery"
    | "bridge-hint"
    | "needs-setup"
    | "preparing"
    | "ready-empty"
    | "intentionally-quiet"
    | "context-limited"
    | "quick-review"
    | "writing-assist"
    | "discovery"
    | "nudge"
    | "empty";

export type DeliveryCandidateKind = "recall" | "recap" | "pattern" | "review";
export type DeliveryCandidateStaleStatus = "fresh" | "stale" | "low-coverage" | "boundary-changed";

export type BubbleExplanationState =
    | "needs-setup"
    | "preparing"
    | "ready-empty"
    | "intentionally-quiet"
    | "context-limited-short"
    | "context-limited-boundary";

export interface DeliveryCandidateSourceRef {
    path: string;
    title?: string;
    excerpt?: string;
}

export interface DeliveryCandidateRoute {
    surface: "panel" | "tab";
    payloadType: string;
}

export interface DeliveryCandidate {
    id: string;
    kind: DeliveryCandidateKind;
    title: string;
    body: string;
    sourceRefs: DeliveryCandidateSourceRef[];
    whyNow: string[];
    preparedAt: string;
    staleStatus?: DeliveryCandidateStaleStatus;
    route: DeliveryCandidateRoute;
}

export interface InlineContextHint {
    text: string;
    icon?: string;
}

export interface BubbleContextAction {
    label: string;
    action: "discover" | "review";
    callback: () => void;
}

export interface BubbleCard {
    id: string;
    findings: BubbleFinding[];
    actions: BubbleAction[];
    inlineHint?: InlineContextHint;
}

/** A single finding item displayed in the Bubble */
export interface BubbleFinding {
    text: string;
    sourceLink?: string;
    sourceTitle?: string;
}

/** Bubble content to render */
export interface BubbleContent {
    type: BubbleContentType;
    findings: BubbleFinding[];
    actions: BubbleAction[];
    inlineHint?: InlineContextHint;
    cards?: BubbleCard[];
    contextAction?: BubbleContextAction;
}

/** Quick action button in the Bubble */
export interface BubbleAction {
    label: string;
    description?: string;
    icon?: string;
    primary?: boolean;
    variant?: "compact";
    callback: () => void;
}

/** Callbacks from Bubble to parent */
export interface BubbleCallbacks {
    onExpandPanel: (type?: string) => void;
    onSourceClick: (sourceLink: string) => void;
    onDismiss: () => void;
}

/** Quick-access callbacks for Pagelet's primary user-facing functions. */
export interface BubbleQuickAccessCallbacks extends BubbleCallbacks {
    onReviewCurrentNote: () => void;
    onDiscoverConnections: () => void;
}

/** Callbacks for B-type Bubble explanation states. */
export interface BubbleStateCallbacks extends BubbleQuickAccessCallbacks {
    onPrepareMemory: () => void;
    onQuickCapture: () => void;
    onOpenSettings: () => void;
}

/** Options for creating a BubbleView */
export interface BubbleViewOptions {
    callbacks: BubbleCallbacks;
    getLocale?: () => PageletLocale;
    /**
     * F-09: Return the active Markdown leaf's content bounds for desktop
     * placement clamping. If absent or returns null, falls back to container.
     */
    getActiveLeafBounds?: () => DOMRect | null;
}

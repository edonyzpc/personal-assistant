/* Copyright 2023 edonyzpc */

import type { PageletLocale } from "../../locales/pagelet";

/**
 * Pagelet — Bubble component types.
 *
 * The Bubble is a lightweight speech bubble that appears near the Pet
 * character, showing quick review findings and action buttons.
 */

/** Bubble visibility state */
export type BubbleState = "hidden" | "visible" | "degraded";

/** Content type determines which scenario's content to render */
export type BubbleContentType = "quick-review" | "writing-assist" | "discovery" | "nudge" | "empty";

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
}

/** Quick action button in the Bubble */
export interface BubbleAction {
    label: string;
    primary?: boolean;
    callback: () => void;
}

/** Callbacks from Bubble to parent */
export interface BubbleCallbacks {
    onExpandPanel: (type?: string) => void;
    onSourceClick: (sourceLink: string) => void;
    onDismiss: () => void;
}

/** Options for creating a BubbleView */
export interface BubbleViewOptions {
    callbacks: BubbleCallbacks;
    getLocale?: () => PageletLocale;
}

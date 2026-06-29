/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Bubble component barrel.
 *
 * Re-exports the public surface of the Bubble module:
 *   - `BubbleView`    — DOM lifecycle manager (mount/show/close).
 *   - Content builders — scenario-specific `BubbleContent` factories.
 *   - Types           — data-only interfaces consumed by both.
 */

export { BubbleView } from "./BubbleView";

export {
    buildQuickReviewContent,
    buildWritingAssistContent,
    buildDiscoveryContent,
    buildNudgeContent,
    buildEmptyContent,
    buildWeeklyReviewNudgeContent,
} from "./BubbleContent";

export type {
    BubbleState,
    BubbleContentType,
    BubbleFinding,
    BubbleContent,
    BubbleAction,
    BubbleCallbacks,
    BubbleQuickAccessCallbacks,
    BubbleViewOptions,
} from "./types";

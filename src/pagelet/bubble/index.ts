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
    buildNeedsSetupContent,
    buildPreparingContent,
    buildReadyEmptyContent,
    buildIntentionallyQuietContent,
    buildContextLimitedContent,
    buildPreparedRecapDeliveryContent,
    buildRecallDeliveryContent,
    buildRecallDeliveryStackContent,
} from "./BubbleContent";
export { quietRecallCandidateToDeliveryCandidate } from "./recall-card";
export { scopeRecapToDeliveryCandidate } from "./recap-card";
export { resolveBubbleExplanationState } from "./state-resolver";
export type { BubbleStateContext } from "./state-resolver";

export type {
    BubbleState,
    BubbleContentType,
    BubbleFinding,
    BubbleContent,
    BubbleAction,
    BubbleCard,
    BubbleCallbacks,
    BubbleQuickAccessCallbacks,
    BubbleStateCallbacks,
    BubbleViewOptions,
    BubbleExplanationState,
    DeliveryCandidate,
    DeliveryCandidateKind,
    DeliveryCandidateRoute,
    DeliveryCandidateSourceRef,
    DeliveryCandidateStaleStatus,
    InlineContextHint,
} from "./types";

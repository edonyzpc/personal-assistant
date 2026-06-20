/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Bubble content builders.
 *
 * Each function builds a `BubbleContent` descriptor for a specific
 * scenario. The content is pure data — no DOM — so it is trivially
 * testable and can be fed straight into `BubbleView.show()`.
 */

import type {
    BubbleAction,
    BubbleCallbacks,
    BubbleContent,
    BubbleFinding,
    BubbleQuickAccessCallbacks,
} from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum findings shown in a standard bubble */
const MAX_FINDINGS = 3;
/** Maximum findings shown in the nudge bubble */
const MAX_NUDGE_FINDINGS = 2;

function buildPageletQuickAccessActions(
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale,
    options: { primaryReview?: boolean } = {},
): BubbleAction[] {
    return [
        {
            label: pageletT("pagelet.bubble.triggerAnalysis", locale),
            description: pageletT("pagelet.bubble.triggerAnalysisDescription", locale),
            icon: "search",
            primary: options.primaryReview ?? true,
            callback: callbacks.onReviewCurrentNote,
        },
        {
            label: pageletT("pagelet.bubble.discover", locale),
            description: pageletT("pagelet.bubble.discoverDescription", locale),
            icon: "link",
            callback: callbacks.onDiscoverConnections,
        },
        {
            label: pageletT("pagelet.bubble.periodicSummary", locale),
            description: pageletT("pagelet.bubble.periodicSummaryDescription", locale),
            icon: "calendar",
            callback: callbacks.onPeriodicSummary,
        },
    ];
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/** Build content for Quick Review (Scenario 1) */
export function buildQuickReviewContent(
    findings: BubbleFinding[],
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "quick-review",
        findings: findings.slice(0, MAX_FINDINGS),
        actions: [
            {
                label: pageletT("pagelet.bubble.viewDetails", locale),
                description: pageletT("pagelet.bubble.viewDetailsDescription", locale),
                icon: "panel-right-open",
                primary: true,
                callback: () => callbacks.onExpandPanel("prepared"),
            },
            ...buildPageletQuickAccessActions(callbacks, locale, { primaryReview: false }),
        ],
    };
}

/** Build content for Writing Assistance (Scenario 2) */
export function buildWritingAssistContent(
    findings: BubbleFinding[],
    callbacks: BubbleCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    const actions: BubbleAction[] = [
        {
            label: pageletT("pagelet.bubble.viewDetails", locale),
            primary: true,
            callback: () => callbacks.onExpandPanel("current"),
        },
        {
            label: pageletT("pagelet.bubble.ignore", locale),
            callback: () => callbacks.onDismiss(),
        },
    ];

    return {
        type: "writing-assist",
        findings: findings.slice(0, MAX_FINDINGS),
        actions,
    };
}

/** Build content for Knowledge Discovery (Scenario 3) */
export function buildDiscoveryContent(
    findings: BubbleFinding[],
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "discovery",
        findings: findings.slice(0, MAX_FINDINGS),
        actions: buildPageletQuickAccessActions(callbacks, locale),
    };
}

/** Build content for Proactive Hint (nudge state) */
export function buildNudgeContent(
    findings: BubbleFinding[],
    callbacks: BubbleCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    const actions: BubbleAction[] = [
        {
            label: pageletT("pagelet.bubble.viewSuggestions", locale),
            primary: true,
            callback: () => callbacks.onExpandPanel("prepared"),
        },
        {
            label: pageletT("pagelet.bubble.later", locale),
            callback: () => callbacks.onDismiss(),
        },
    ];

    return {
        type: "nudge",
        findings: findings.slice(0, MAX_NUDGE_FINDINGS),
        actions,
    };
}

/** Build onboarding content (first-time user guide) */
export function buildOnboardingContent(
    onDismiss: () => void,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "empty",
        findings: [{ text: pageletT("pagelet.bubble.onboarding", locale) }],
        actions: [{
            label: pageletT("pagelet.bubble.onboardingAction", locale),
            primary: true,
            callback: onDismiss,
        }],
    };
}

/** Build empty state content (no cached results) */
export function buildEmptyContent(
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "empty",
        findings: [{ text: pageletT("pagelet.bubble.empty", locale) }],
        actions: buildPageletQuickAccessActions(callbacks, locale),
    };
}

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
} from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum findings shown in a standard bubble */
const MAX_FINDINGS = 3;
/** Maximum findings shown in the nudge bubble */
const MAX_NUDGE_FINDINGS = 2;

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/** Build content for Quick Review (Scenario 1) */
export function buildQuickReviewContent(
    findings: BubbleFinding[],
    callbacks: BubbleCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    const actions: BubbleAction[] = [
        {
            label: pageletT("pagelet.bubble.reviewRecent", locale),
            primary: true,
            callback: () => callbacks.onExpandPanel("review"),
        },
        {
            label: pageletT("pagelet.bubble.viewCurrent", locale),
            callback: () => callbacks.onExpandPanel("current"),
        },
        {
            label: pageletT("pagelet.bubble.discover", locale),
            callback: () => callbacks.onExpandPanel("discover"),
        },
    ];

    return {
        type: "quick-review",
        findings: findings.slice(0, MAX_FINDINGS),
        actions,
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
    callbacks: BubbleCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    const actions: BubbleAction[] = [
        {
            label: pageletT("pagelet.bubble.discover", locale),
            primary: true,
            callback: () => callbacks.onExpandPanel("discover"),
        },
        {
            label: pageletT("pagelet.bubble.viewCurrent", locale),
            callback: () => callbacks.onExpandPanel("current"),
        },
    ];

    return {
        type: "discovery",
        findings: findings.slice(0, MAX_FINDINGS),
        actions,
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
            callback: () => callbacks.onExpandPanel(),
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
    onTriggerAnalysis: () => void,
    locale: PageletLocale = "en",
): BubbleContent {
    const actions: BubbleAction[] = [
        {
            label: pageletT("pagelet.bubble.triggerAnalysis", locale),
            primary: true,
            callback: onTriggerAnalysis,
        },
    ];

    return {
        type: "empty",
        findings: [{ text: pageletT("pagelet.bubble.empty", locale) }],
        actions,
    };
}

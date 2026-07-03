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
import type { PatternDetectionResult, QuietRecallBubbleNudge } from "../../pa";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum findings shown in a standard bubble */
const MAX_FINDINGS = 3;
/** Maximum findings shown in the nudge bubble */
const MAX_NUDGE_FINDINGS = 2;

export interface WeeklyReviewNudgeOptions {
    pageletEnabled: boolean;
    preparedReviewEnabled: boolean;
    proactiveHints: boolean;
    quietHoursActive?: boolean;
    count: number;
}

export interface QuietRecallNudgeOptions {
    pageletEnabled: boolean;
    quietRecallEnabled: boolean;
    bubbleNudgesEnabled: boolean;
    proactiveHints: boolean;
    quietHoursActive?: boolean;
    candidate: QuietRecallBubbleNudge | null;
}

export interface QuietRecallNudgeCallbacks {
    onView(candidate: QuietRecallBubbleNudge): void;
    onLink(candidate: QuietRecallBubbleNudge): void;
    onDismiss(candidate: QuietRecallBubbleNudge): void;
    onLater(candidate: QuietRecallBubbleNudge): void;
}

export type OnboardingNudgeKind = "maintenance_scan" | "quick_capture";

export interface OnboardingNudge {
    kind: OnboardingNudgeKind;
    generatedAt: string;
}

export interface OnboardingNudgeOptions {
    pageletEnabled: boolean;
    proactiveHints: boolean;
    quietHoursActive?: boolean;
    nudge: OnboardingNudge | null;
}

export interface OnboardingNudgeCallbacks {
    onDismiss(nudge: OnboardingNudge): void;
}

export interface PatternDetectionNudgeOptions {
    pageletEnabled: boolean;
    proactiveHints: boolean;
    quietHoursActive?: boolean;
    result: PatternDetectionResult | null;
}

export interface PatternDetectionNudgeCallbacks {
    onView(result: PatternDetectionResult): void;
    onDismiss(result: PatternDetectionResult): void;
}

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

function laterAction(callbacks: BubbleCallbacks, locale: PageletLocale): BubbleAction {
    return {
        label: pageletT("pagelet.bubble.later", locale),
        variant: "compact",
        callback: () => callbacks.onDismiss(),
    };
}

function appendQuickAccessActions(
    actions: BubbleAction[],
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale,
): BubbleAction[] {
    return [
        ...actions,
        ...buildPageletQuickAccessActions(callbacks, locale, { primaryReview: false }),
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
    const actions: BubbleAction[] = findings.length > 0
        ? [
            {
                label: pageletT("pagelet.bubble.viewSuggestions", locale),
                primary: true,
                callback: () => callbacks.onExpandPanel("prepared"),
            },
            {
                label: pageletT("pagelet.bubble.later", locale),
                variant: "compact",
                callback: () => callbacks.onDismiss(),
            },
        ]
        : [
            {
                label: pageletT("pagelet.bubble.later", locale),
                variant: "compact",
                primary: true,
                callback: () => callbacks.onDismiss(),
            },
        ];

    return {
        type: "nudge",
        findings: findings.slice(0, MAX_NUDGE_FINDINGS),
        actions,
    };
}

/** Build a lightweight reminder for items the user already kept for later. */
export function buildReviewQueueNudgeContent(
    count: number,
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "nudge",
        findings: [{
            text: pageletT("pagelet.bubble.reviewQueue.count", locale, { count }),
        }],
        actions: appendQuickAccessActions([
            {
                label: pageletT("pagelet.bubble.reviewQueue.open", locale),
                description: pageletT("pagelet.bubble.reviewQueue.openDescription", locale),
                icon: "bookmark-check",
                primary: true,
                callback: () => callbacks.onExpandPanel("review"),
            },
            laterAction(callbacks, locale),
        ], callbacks, locale),
    };
}

/** Build a quiet Weekly Review hint. Full review sections stay in Panel/Tab. */
export function buildWeeklyReviewNudgeContent(
    options: WeeklyReviewNudgeOptions,
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale = "en",
): BubbleContent | null {
    if (!options.pageletEnabled || !options.preparedReviewEnabled || !options.proactiveHints || options.quietHoursActive) {
        return null;
    }
    return {
        type: "nudge",
        findings: [{
            text: pageletT("pagelet.bubble.weeklyReview.ready", locale, { count: options.count }),
        }],
        actions: appendQuickAccessActions([
            {
                label: pageletT("pagelet.bubble.weeklyReview.open", locale),
                description: pageletT("pagelet.bubble.weeklyReview.openDescription", locale),
                icon: "calendar-check",
                primary: true,
                callback: () => {
                    if (callbacks.onWeeklyReview) callbacks.onWeeklyReview();
                    else callbacks.onExpandPanel("review");
                },
            },
            laterAction(callbacks, locale),
        ], callbacks, locale),
    };
}

/** Build a restrained Quiet Recall nudge. Full evidence/actions stay in the Quiet Recall Tab. */
export function buildQuietRecallNudgeContent(
    options: QuietRecallNudgeOptions,
    callbacks: QuietRecallNudgeCallbacks,
    locale: PageletLocale = "en",
): BubbleContent | null {
    const candidate = options.candidate;
    if (
        !candidate
        || !options.pageletEnabled
        || !options.quietRecallEnabled
        || !options.bubbleNudgesEnabled
        || !options.proactiveHints
        || options.quietHoursActive
    ) {
        return null;
    }

    const textKey = candidate.relation === "current"
        ? "pagelet.bubble.quietRecall.current"
        : candidate.relation === "related"
            ? "pagelet.bubble.quietRecall.related"
            : "pagelet.bubble.quietRecall.far";

    return {
        type: "nudge",
        findings: [
            { text: pageletT(textKey, locale) },
            ...(candidate.onboardingExplanation
                ? [{ text: pageletT("pagelet.onboarding.quietRecall", locale) }]
                : []),
        ],
        actions: [
            {
                label: pageletT("pagelet.bubble.quietRecall.view", locale),
                description: pageletT("pagelet.bubble.quietRecall.viewDescription", locale),
                icon: "panel-right-open",
                primary: true,
                callback: () => callbacks.onView(candidate),
            },
            {
                label: pageletT("pagelet.bubble.quietRecall.link", locale),
                description: pageletT("pagelet.bubble.quietRecall.linkDescription", locale),
                icon: "link",
                callback: () => callbacks.onLink(candidate),
            },
            {
                label: pageletT("pagelet.bubble.quietRecall.dismiss", locale),
                variant: "compact",
                callback: () => callbacks.onDismiss(candidate),
            },
            {
                label: pageletT("pagelet.bubble.later", locale),
                variant: "compact",
                callback: () => callbacks.onLater(candidate),
            },
        ],
    };
}

export function buildOnboardingNudgeContent(
    options: OnboardingNudgeOptions,
    callbacks: OnboardingNudgeCallbacks,
    locale: PageletLocale = "en",
): BubbleContent | null {
    const nudge = options.nudge;
    if (!nudge || !options.pageletEnabled || !options.proactiveHints || options.quietHoursActive) {
        return null;
    }
    const textKey = nudge.kind === "maintenance_scan"
        ? "pagelet.onboarding.maintenanceScan"
        : "pagelet.onboarding.quickCapture";
    return {
        type: "nudge",
        findings: [{ text: pageletT(textKey, locale) }],
        actions: [{
            label: pageletT("pagelet.onboarding.gotIt", locale),
            primary: true,
            callback: () => callbacks.onDismiss(nudge),
        }],
    };
}

export function buildPatternDetectionNudgeContent(
    options: PatternDetectionNudgeOptions,
    callbacks: PatternDetectionNudgeCallbacks,
    locale: PageletLocale = "en",
): BubbleContent | null {
    const result = options.result;
    if (
        !result
        || result.totalCount === 0
        || !options.pageletEnabled
        || !options.proactiveHints
        || options.quietHoursActive
    ) {
        return null;
    }
    return {
        type: "nudge",
        findings: [{
            text: pageletT("pagelet.bubble.patterns.ready", locale, { count: result.totalCount }),
        }],
        actions: [
            {
                label: pageletT("pagelet.bubble.patterns.open", locale),
                description: pageletT("pagelet.bubble.patterns.openDescription", locale),
                icon: "git-branch",
                primary: true,
                callback: () => callbacks.onView(result),
            },
            {
                label: pageletT("pagelet.bubble.patterns.dismiss", locale),
                variant: "compact",
                callback: () => callbacks.onDismiss(result),
            },
        ],
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

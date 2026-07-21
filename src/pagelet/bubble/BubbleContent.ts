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
    BubbleStateCallbacks,
    DeliveryCandidate,
} from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import type { PatternDetectionResult, QuietRecallBubbleNudge } from "../../pa";
import type { LocalDiscoveryCandidate } from "./recall-card";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum findings shown in a standard bubble */
const MAX_FINDINGS = 3;
/** Maximum findings shown in the nudge bubble */
const MAX_NUDGE_FINDINGS = 2;

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

function discoverRelatedAction(
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale,
    primary = true,
): BubbleAction {
    return {
        label: pageletT("pagelet.bubble.findRelatedOldNotes", locale),
        description: pageletT("pagelet.bubble.findRelatedOldNotesDescription", locale),
        icon: "link",
        primary,
        callback: callbacks.onDiscoverConnections,
    };
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
            discoverRelatedAction(callbacks, locale, false),
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
        actions: [discoverRelatedAction(callbacks, locale)],
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
        type: "recall-delivery",
        findings: [
            { text: pageletT(textKey, locale) },
            ...(candidate.onboardingExplanation
                ? [{ text: pageletT("pagelet.onboarding.quietRecall", locale) }]
                : []),
        ],
        actions: proactiveRecallActions({
            onView: () => callbacks.onView(candidate),
            onLater: () => callbacks.onLater(candidate),
            onDismiss: () => callbacks.onDismiss(candidate),
        }, locale),
    };
}

interface ProactiveRecallActionCallbacks {
    onView(): void;
    onLater(): void;
    onDismiss(): void;
}

function proactiveRecallActions(
    callbacks: ProactiveRecallActionCallbacks,
    locale: PageletLocale,
): BubbleAction[] {
    return [
        {
            label: pageletT("pagelet.bubble.quietRecall.view", locale),
            description: pageletT("pagelet.bubble.quietRecall.viewDescription", locale),
            icon: "panel-right-open",
            primary: true,
            callback: callbacks.onView,
        },
        {
            label: pageletT("pagelet.bubble.later", locale),
            variant: "compact",
            callback: callbacks.onLater,
        },
        {
            label: pageletT("pagelet.bubble.quietRecall.dismiss", locale),
            variant: "compact",
            callback: callbacks.onDismiss,
        },
    ];
}

export interface DeliveryCandidateCallbacks {
    onOpen(candidate: DeliveryCandidate): void;
    onLinkToCurrent?(candidate: DeliveryCandidate): void;
    canLinkToCurrent?(candidate: DeliveryCandidate): boolean;
    onLater(candidate: DeliveryCandidate): void;
}

export interface LocalDiscoveryCandidateCallbacks {
    onOpen(candidate: LocalDiscoveryCandidate): void;
    onLinkToCurrent?(candidate: LocalDiscoveryCandidate): void;
    canLinkToCurrent?(candidate: LocalDiscoveryCandidate): boolean;
    onLater(candidate: LocalDiscoveryCandidate): void;
}

function deliveryCandidateFinding(candidate: DeliveryCandidate): BubbleFinding {
    const firstSource = candidate.sourceRefs[0];
    return {
        text: candidate.body,
        sourceLink: firstSource?.path,
        sourceTitle: firstSource?.title ?? firstSource?.path,
    };
}

export function buildRecallDeliveryContent(
    candidate: DeliveryCandidate & { kind: "recall" },
    callbacks: DeliveryCandidateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "recall-delivery",
        findings: [deliveryCandidateFinding(candidate)],
        inlineHint: candidate.whyNow[0]
            ? { text: candidate.whyNow[0], icon: "info" }
            : undefined,
        actions: [
            {
                label: pageletT("pagelet.bubble.delivery.openSource", locale),
                description: pageletT("pagelet.bubble.delivery.openSourceDescription", locale),
                icon: "file-text",
                primary: true,
                callback: () => callbacks.onOpen(candidate),
            },
            ...(callbacks.onLinkToCurrent && callbacks.canLinkToCurrent?.(candidate) !== false ? [{
                label: pageletT("pagelet.bubble.quietRecall.link", locale),
                description: pageletT("pagelet.bubble.quietRecall.linkDescription", locale),
                icon: "link",
                callback: () => callbacks.onLinkToCurrent?.(candidate),
            }] satisfies BubbleAction[] : []),
            {
                label: pageletT("pagelet.bubble.later", locale),
                variant: "compact",
                callback: () => callbacks.onLater(candidate),
            },
        ],
    };
}

/** Proactive Recall keeps Link/Save in the Detail Tab. */
export function buildProactiveRecallDeliveryContent(
    candidate: DeliveryCandidate & { kind: "recall" },
    callbacks: {
        onView(candidate: DeliveryCandidate & { kind: "recall" }): void;
        onLater(candidate: DeliveryCandidate & { kind: "recall" }): void;
        onDismiss(candidate: DeliveryCandidate & { kind: "recall" }): void;
    },
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "recall-delivery",
        findings: [deliveryCandidateFinding(candidate)],
        inlineHint: candidate.whyNow[0]
            ? { text: candidate.whyNow[0], icon: "info" }
            : undefined,
        actions: proactiveRecallActions({
            onView: () => callbacks.onView(candidate),
            onLater: () => callbacks.onLater(candidate),
            onDismiss: () => callbacks.onDismiss(candidate),
        }, locale),
    };
}

/** Explicit local Discover is provenance-labeled and never rendered as Recall Delivery. */
export function buildLocalDiscoveryClueContent(
    candidate: LocalDiscoveryCandidate,
    callbacks: LocalDiscoveryCandidateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    const firstSource = candidate.sourceRefs[0];
    return {
        type: "discovery",
        findings: [
            { text: pageletT("pagelet.recall.localClue", locale) },
            {
                text: pageletT(`pagelet.recall.localRelation.${candidate.relation}`, locale),
                sourceLink: firstSource?.path,
                sourceTitle: firstSource?.title ?? firstSource?.path,
            },
        ],
        actions: [
            {
                label: pageletT("pagelet.bubble.delivery.openSource", locale),
                icon: "file-text",
                primary: true,
                callback: () => callbacks.onOpen(candidate),
            },
            ...(callbacks.onLinkToCurrent && callbacks.canLinkToCurrent?.(candidate) !== false ? [{
                label: pageletT("pagelet.bubble.quietRecall.link", locale),
                icon: "link",
                callback: () => callbacks.onLinkToCurrent?.(candidate),
            }] satisfies BubbleAction[] : []),
            {
                label: pageletT("pagelet.bubble.later", locale),
                variant: "compact",
                callback: () => callbacks.onLater(candidate),
            },
        ],
    };
}

export function buildRecallDeliveryStackContent(
    candidates: Array<DeliveryCandidate & { kind: "recall" }>,
    callbacks: DeliveryCandidateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    const cards = candidates.slice(0, 3).map((candidate) => {
        const content = buildRecallDeliveryContent(candidate, callbacks, locale);
        return {
            id: candidate.id,
            findings: content.findings,
            actions: content.actions,
            inlineHint: content.inlineHint,
        };
    });
    const firstCard = cards[0];
    return {
        type: "recall-delivery",
        findings: firstCard?.findings ?? [],
        actions: firstCard?.actions ?? [],
        inlineHint: firstCard?.inlineHint,
        cards,
    };
}

/**
 * F-02: Recap Bubble content — candidate.body is primary finding text.
 * candidate.title and source count become secondary metadata.
 * whyNow stays as inline hint.
 */
export function buildPreparedRecapDeliveryContent(
    candidate: DeliveryCandidate & { kind: "recap" },
    callbacks: { onViewRecap(candidate: DeliveryCandidate & { kind: "recap" }): void; onLater(candidate: DeliveryCandidate & { kind: "recap" }): void },
    locale: PageletLocale = "en",
): BubbleContent {
    const sourceCount = candidate.sourceRefs.length;
    const firstSource = candidate.sourceRefs[0];
    const sourceMetadata = sourceCount > 1
        ? pageletT("pagelet.bubble.recapDelivery.sourceCount", locale, { count: sourceCount })
        : firstSource?.title ?? firstSource?.path;
    const secondaryMetadata = [candidate.title.trim(), sourceMetadata]
        .filter((value): value is string => Boolean(value))
        .join(" · ");
    return {
        type: "recap-delivery",
        findings: [
            {
                text: candidate.body,
                sourceLink: firstSource?.path,
                sourceTitle: secondaryMetadata || undefined,
            },
        ],
        inlineHint: candidate.whyNow[0]
            ? { text: candidate.whyNow[0], icon: "calendar" }
            : undefined,
        actions: [
            {
                label: pageletT("pagelet.bubble.recapDelivery.view", locale),
                description: pageletT("pagelet.bubble.recapDelivery.viewDescription", locale),
                icon: "calendar",
                primary: true,
                callback: () => callbacks.onViewRecap(candidate),
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

/** Build a one-time bridge hint. Prefer real delivery when it exists. */
export function buildOnboardingContent(onDismiss: () => void, locale: PageletLocale = "en"): BubbleContent {
    return {
        type: "bridge-hint",
        findings: [{ text: pageletT("pagelet.bubble.onboarding", locale) }],
        actions: [{
            label: pageletT("pagelet.bubble.onboardingAction", locale),
            primary: true,
            callback: onDismiss,
        }],
    };
}

export function buildNeedsSetupContent(
    callbacks: BubbleStateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "needs-setup",
        findings: [{ text: pageletT("pagelet.bubble.needsSetup", locale) }],
        actions: [
            {
                label: pageletT("pagelet.bubble.needsSetup.prepare", locale),
                description: pageletT("pagelet.bubble.needsSetup.prepareDescription", locale),
                icon: "database",
                primary: true,
                callback: callbacks.onPrepareMemory,
            },
            {
                label: pageletT("pagelet.bubble.needsSetup.review", locale),
                description: pageletT("pagelet.bubble.needsSetup.reviewDescription", locale),
                icon: "search",
                variant: "compact",
                callback: callbacks.onReviewCurrentNote,
            },
        ],
    };
}

export function buildPreparingContent(
    progress: { current: number; total: number } | null,
    locale: PageletLocale = "en",
): BubbleContent {
    const showProgress = progress && progress.total >= 20;
    return {
        type: "preparing",
        findings: [{
            text: showProgress
                ? pageletT("pagelet.bubble.preparing.progress", locale, {
                    current: progress.current,
                    total: progress.total,
                })
                : pageletT("pagelet.bubble.preparing", locale),
        }],
        actions: [],
    };
}

export function buildReadyEmptyContent(
    callbacks: BubbleStateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "ready-empty",
        findings: [{ text: pageletT("pagelet.bubble.readyEmpty", locale) }],
        actions: [discoverRelatedAction(callbacks, locale)],
    };
}

export function buildContextLimitedContent(
    variant: "short" | "boundary",
    callbacks: BubbleStateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    if (variant === "boundary") {
        return {
            type: "context-limited",
            findings: [{ text: pageletT("pagelet.bubble.contextLimited.boundary", locale) }],
            actions: [{
                label: pageletT("pagelet.bubble.contextLimited.settings", locale),
                description: pageletT("pagelet.bubble.contextLimited.settingsDescription", locale),
                icon: "settings",
                variant: "compact",
                callback: callbacks.onOpenSettings,
            }],
        };
    }
    return {
        type: "context-limited",
        findings: [{ text: pageletT("pagelet.bubble.contextLimited.short", locale) }],
        actions: [{
            label: pageletT("pagelet.bubble.contextLimited.capture", locale),
            description: pageletT("pagelet.bubble.contextLimited.captureDescription", locale),
            icon: "pencil",
            primary: true,
            callback: callbacks.onQuickCapture,
        }],
    };
}

/** Build empty state content (no cached results) */
export function buildEmptyContent(
    callbacks: BubbleStateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return buildReadyEmptyContent(callbacks, locale);
}

export function buildIntentionallyQuietContent(
    callbacks: BubbleStateCallbacks,
    acknowledged = false,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "intentionally-quiet",
        findings: acknowledged ? [] : [{ text: pageletT("pagelet.bubble.intentionallyQuiet", locale) }],
        actions: [discoverRelatedAction(callbacks, locale)],
    };
}

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
    BubbleContent,
    BubbleQuickAccessCallbacks,
    BubbleStateCallbacks,
    DeliveryCandidate,
} from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import type { PatternDetectionResult } from "../../pa";
/** Keep Deep Discover Bubble copy compact; the complete body stays in the Panel. */
const MAX_AGENT_INSIGHT_SUMMARY_CHARS = 96;

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

/**
 * Deep Discover stays free-form in the Panel; the Bubble only previews the
 * strongest text and carries the exact delivery receipt that became visible.
 */
export function buildAgentInsightDeliveryContent(
    candidate: DeliveryCandidate & { kind: "review" },
    callbacks: {
        onView(candidate: DeliveryCandidate & { kind: "review" }): void;
        onLater(candidate: DeliveryCandidate & { kind: "review" }): void;
    },
    locale: PageletLocale = "en",
): BubbleContent {
    const firstSource = candidate.sourceRefs[0];
    return {
        type: "review-delivery",
        findings: [{
            text: agentInsightSummary(candidate),
            sourceLink: firstSource?.path,
            sourceTitle: firstSource?.title ?? firstSource?.path,
        }],
        deliveryReceipt: candidate.deliveryReceipt,
        inlineHint: candidate.whyNow[0]
            ? { text: candidate.whyNow[0], icon: "sparkles" }
            : undefined,
        actions: [
            {
                label: pageletT("pagelet.bubble.agentInsight.view", locale),
                description: pageletT("pagelet.bubble.agentInsight.viewDescription", locale),
                icon: "panel-right-open",
                primary: true,
                callback: () => callbacks.onView(candidate),
            },
            {
                label: pageletT("pagelet.bubble.later", locale),
                variant: "compact",
                callback: () => callbacks.onLater(candidate),
            },
        ],
    };
}

function agentInsightSummary(candidate: DeliveryCandidate & { kind: "review" }): string {
    const summary = (candidate.title.trim() || candidate.body)
        .replace(/\s+/gu, " ")
        .trim();
    return summary.length > MAX_AGENT_INSIGHT_SUMMARY_CHARS
        ? `${summary.slice(0, MAX_AGENT_INSIGHT_SUMMARY_CHARS - 1).trimEnd()}…`
        : summary;
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
        findings: [
            { text: pageletT("pagelet.bubble.readyEmpty", locale) },
            { text: pageletT("pagelet.bubble.readyEmptyTeaching", locale) },
        ],
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

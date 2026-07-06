# Pagelet Bubble Readiness & Recall — SDD

## Status

| Field | Value |
| --- | --- |
| Document type | Software Design Document |
| Scope | Bubble empty-state redesign, state model, Recall/Discover unification |
| Status | Draft |
| Created | 2026-07-05 |
| Product Spec | [pagelet-bubble-readiness-and-recall-product-spec.md](./pagelet-bubble-readiness-and-recall-product-spec.md) |
| Discussion | [pagelet-bubble-product-discussion-2026-07-05.md](./pagelet-bubble-product-discussion-2026-07-05.md) |
| Product amendment | [pagelet-delivery-preparation-consolidation-product-note.md](./pagelet-delivery-preparation-consolidation-product-note.md) |

---

## 1. Scope

### In Scope

1. Redefine `BubbleContentType` to reflect the new A/B state model.
2. Add state-determination logic to `BubbleCoordinator` for 5 B-type states.
3. Replace `buildEmptyContent` with state-specific B-type builders.
4. Add Recall Delivery content builder (A-type) for L3 result cards.
5. Unify Discover and Quiet Recall into shared result card format.
6. Add inline context hint support to `BubbleView`.
7. Remove "Generate summary" and demote "Review current note" from the
   default empty-state actions.
8. Add new locale strings for all B-type states (EN + ZH).
9. Wire Discover trigger from Bubble empty-state to async Recall pipeline.
10. Add the Bubble single-visible-card stack contract (max 3 cards, desktop
    arrows/dots, mobile swipe, reduced-motion safe).
11. Add the DeliveryCandidate / prepared Recap Delivery contract and runtime
    adapter. Runtime Recap Delivery must not be faked with a foreground
    "generate recap" CTA.

### Out of Scope

- Pet visual state redesign (OD-1 from spec).
- Panel/Tab layout changes.
- Recall L3 LLM pipeline implementation (backend). This SDD covers the
  Bubble-side integration contract; the LLM pipeline is a separate SDD.
- Write Action Framework for "Link to current note".
- Saved Insight creation from Recall card.
- Recall L3 backend quality/ranking improvements beyond adapting existing
  candidates into Bubble delivery cards.

### Dependencies

- Recall delivery pipeline: This SDD should adapt existing
  `QuietRecallCandidate` / `QuietRecallBubbleNudge` data into delivery cards
  before adding any parallel model.
- Recap delivery pipeline: Bubble Recap Delivery requires a prepared recap
  artifact. Phase 6 provides this as a local derived cache from Scope Recap
  output.

---

## 1.1 Review Amendments That Supersede Earlier Draft Details

The following amendments are binding. If later sections conflict with this
section, use this section.

1. **Use existing Quiet Recall data first.** The implementation should adapt
   existing `QuietRecallCandidate` / `QuietRecallBubbleNudge` into Bubble
   delivery cards before introducing a parallel `RecallResult` model.

2. **Bubble supports a card stack, not multiple visible list cards.** The
   active card owns the active actions. `Open`, `Link to current`, and `Later`
   must apply to the currently selected card only.

3. **Save as insight is not a Bubble action in this iteration.** It remains in
   Panel/Tab detail surfaces.

4. **Real delivery beats onboarding.** Bridge hints must not outrank real Recall
   or prepared Recap delivery. First-use education becomes inline context on the
   real delivery when possible.

5. **Recap Delivery means prepared recap artifact.** Bubble must not show
   "PA can build a recap" or trigger foreground summary generation as a delivery
   substitute. If no prepared recap exists, there is no Recap card. Prepared
   recap artifacts are local derived cache objects with enough structured
   detail for Panel/Tab, not auto-written Markdown notes and not full raw
   provider output.

6. **Periodic Summary terminal migration is implemented in Phase 6.** The
   standalone Periodic Summary concept migrates into Recap time-range mode.
   Runtime command/locale/removal work directly deletes old Periodic Summary /
   Generate Summary entrypoints without legacy alias or redirect.

7. **Readiness must be snapshot-based.** Existing Memory readiness checks are
   asynchronous. Do not implement readiness by calling async vault reads from a
   synchronous Bubble state resolver.

8. **Data Boundary copy is a trust signal.** The Bubble should say PA will stay
   quiet, and the settings route should be weak/secondary.

9. **Delivery Preparation is the target architecture.** Recall, Recap, Pattern,
   and Review should converge on a `DeliveryCandidate` pool over time. Phase 6
   ships Recall/readiness, prepared Recap Delivery, and the initial
   consolidation contract.

10. **DeliveryCandidate is not a durable inbox.** The shared contract is for
    display, ranking, routing, and active-card actions. Recap may use local
    derived cache; Pattern may use short-term dedupe; Recall and Review should
    not add new long-term persistence by default.

11. **Review candidates need a higher bar.** Generic Quick Review findings do
    not belong in Bubble. A `review` candidate may appear only when it is
    source-backed, high-confidence, has a clear why-now, and offers a
    low-burden next action. Review ranks below Recall, Recap, and Pattern.

12. **Discover is source-bound async.** A click on "Find related old notes"
    starts a lightweight Bubble search. Fast high-quality results may render in
    Bubble; slow, weak, or complex results route to Panel. Results must be bound
    to the active-note snapshot captured at trigger time.

---

## 2. Key Files

| File | Role | Change Type |
| --- | --- | --- |
| `src/pagelet/bubble/types.ts` | Type definitions | **Modify** — extend `BubbleContentType`, add new interfaces |
| `src/pagelet/bubble/BubbleContent.ts` | Content builders | **Modify** — replace `buildEmptyContent`, add new builders |
| `src/pagelet/BubbleCoordinator.ts` | Cascade orchestration | **Modify** — rewrite `showBubble` and `showNudgeBubble` cascades |
| `src/pagelet/bubble/BubbleView.ts` | DOM rendering | **Modify** — add inline hint rendering, new content-type styles |
| `src/locales/pagelet/en.json` | EN locale strings | **Modify** — add new keys |
| `src/locales/pagelet/zh.json` | ZH locale strings | **Modify** — add new keys |
| `src/pagelet/bubble/state-resolver.ts` | State determination | **Create** — pure function for B-type state resolution |
| `src/pagelet/bubble/recall-card.ts` | Recall card builder | **Create** — L3 result card content builder |

---

## 3. Type Changes

### 3.1 Extend `BubbleContentType`

**File:** `src/pagelet/bubble/types.ts`

Current:

```typescript
export type BubbleContentType =
    | "quick-review"
    | "writing-assist"
    | "discovery"
    | "nudge"
    | "empty";
```

New:

```typescript
export type BubbleContentType =
    // A-type: Delivery
    | "recall-delivery"       // NEW — L3 recall result card
    | "recap-delivery"        // NEW — prepared Scope Recap delivery
    | "quick-review"          // Existing — background preparation results
    | "pattern-delivery"      // NEW — cross-note pattern (replaces "nudge" for patterns)
    | "bridge-hint"           // NEW — one-time onboarding nudge
    // B-type: Explanation
    | "needs-setup"           // NEW — Memory not prepared
    | "preparing"             // NEW — Memory preparation in progress
    | "ready-empty"           // NEW — replaces "empty" for Ready Nothing Found
    | "intentionally-quiet"   // NEW — proactive hints disabled
    | "context-limited"       // NEW — note too short or Data Boundary
    // Legacy BubbleContentType values kept only for internal code migration;
    // this does not approve user-facing Periodic Summary aliases or redirects.
    | "writing-assist"        // Existing — foreground analysis results
    | "discovery"             // Existing — used by discover flow results
    | "nudge"                 // Existing — legacy nudge (review queue, etc.)
    | "empty";                // DEPRECATED — replaced by B-type states
```

### 3.2 New Interfaces

**File:** `src/pagelet/bubble/types.ts`

```typescript
export type DeliveryCandidateKind = "recall" | "recap" | "pattern" | "review";

/**
 * Unified delivery candidate consumed by Bubble, Panel, and Tab routing.
 * Runtime adapters should be built from existing source types first:
 * - recall: QuietRecallCandidate / QuietRecallBubbleNudge
 * - recap: prepared ScopeRecap artifact
 * - pattern: PatternDetectionResult
 * - review: PreloadFinding or future review delivery artifact
 */
export interface DeliveryCandidate {
    id: string;
    kind: DeliveryCandidateKind;
    title: string;
    body: string;
    sourceRefs: Array<{ path: string; title?: string; excerpt?: string }>;
    whyNow: string[];
    preparedAt: string;
    staleStatus?: "fresh" | "stale" | "low-coverage" | "boundary-changed";
    route: { surface: "panel" | "tab"; payloadType: string };
}

/**
 * Inline context hint shown at the bottom of A-type delivery content.
 * Maximum one per delivery. Not interactive.
 */
export interface InlineContextHint {
    text: string;
    icon?: string;  // defaults to "💡"
}

/**
 * Extended BubbleContent that supports inline context hints.
 */
export interface BubbleContent {
    type: BubbleContentType;
    findings: BubbleFinding[];
    actions: BubbleAction[];
    /** Optional inline context hint, shown at bottom of delivery content */
    inlineHint?: InlineContextHint;
}

/**
 * B-type explanation state, resolved by state-resolver.
 */
export type BubbleExplanationState =
    | "needs-setup"
    | "preparing"
    | "ready-empty"
    | "intentionally-quiet"
    | "context-limited-short"
    | "context-limited-boundary";

/**
 * Callbacks for active delivery card actions.
 */
export interface DeliveryCardCallbacks {
    onOpen: (candidate: DeliveryCandidate) => void;
    onLinkToCurrent: (candidate: DeliveryCandidate) => void;
    onLater: (candidate: DeliveryCandidate) => void;
    onDismiss: () => void;
}

/**
 * Callbacks for the redesigned Bubble.
 * Replaces BubbleQuickAccessCallbacks for new states.
 */
export interface BubbleStateCallbacks extends BubbleCallbacks {
    onPrepareMemory: () => void;
    onReviewCurrentNote: () => void;
    onDiscoverConnections: () => void;
    onQuickCapture: () => void;
    onOpenSettings: () => void;
}
```

### 3.3 State Context for Resolver

**File:** `src/pagelet/bubble/state-resolver.ts` (new file)

```typescript
/**
 * Input context for resolving which B-type state to show.
 * Gathered by BubbleCoordinator from host/settings.
 */
export interface BubbleStateContext {
    /** Is Memory/VSS ready for recall? */
    memoryReady: boolean;
    /** Is Memory currently being prepared? */
    memoryPreparing: boolean;
    /** Are proactive hints enabled? */
    proactiveHintsEnabled: boolean;
    /** Is current file a markdown note? */
    isMarkdownNote: boolean;
    /** Current note content length in characters */
    noteContentLength: number;
    /** Is current note excluded by Data Boundary? */
    isDataBoundaryExcluded: boolean;
    /** Is Pagelet enabled? */
    pageletEnabled: boolean;
}

/** Minimum note content length for meaningful recall */
const MIN_NOTE_CONTENT_LENGTH = 50;

/**
 * Pure function: resolve which B-type explanation state to show.
 *
 * Priority order (matching Product Spec §3.2):
 *   Needs Setup > Preparing > Context Limited > Intentionally Quiet > Ready Empty
 */
export function resolveBubbleExplanationState(
    ctx: BubbleStateContext,
): BubbleExplanationState {
    // 1. Memory not ready and not preparing → needs setup
    if (!ctx.memoryReady && !ctx.memoryPreparing) {
        return "needs-setup";
    }

    // 2. Memory actively preparing → preparing
    if (ctx.memoryPreparing) {
        return "preparing";
    }

    // 3. Context limitations
    if (!ctx.isMarkdownNote || ctx.noteContentLength < MIN_NOTE_CONTENT_LENGTH) {
        return "context-limited-short";
    }
    if (ctx.isDataBoundaryExcluded) {
        return "context-limited-boundary";
    }

    // 4. Proactive hints disabled → intentionally quiet
    if (!ctx.proactiveHintsEnabled) {
        return "intentionally-quiet";
    }

    // 5. Everything ready, nothing found → ready empty
    return "ready-empty";
}
```

---

## 4. Content Builder Changes

### 4.1 New B-type Builders

**File:** `src/pagelet/bubble/BubbleContent.ts`

Replace `buildEmptyContent` and add state-specific builders:

```typescript
/**
 * B1: Needs Setup — Memory not prepared.
 * Primary: Prepare Memory. Fallback: Review this note.
 */
export function buildNeedsSetupContent(
    callbacks: BubbleStateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "needs-setup",
        findings: [{
            text: pageletT("pagelet.bubble.needsSetup", locale),
        }],
        actions: [
            {
                label: pageletT("pagelet.bubble.needsSetup.prepare", locale),
                icon: "database",
                primary: isShort,
                callback: callbacks.onPrepareMemory,
            },
            {
                label: pageletT("pagelet.bubble.needsSetup.review", locale),
                icon: "search",
                variant: "compact",
                callback: callbacks.onReviewCurrentNote,
            },
        ],
    };
}

/**
 * B2: Preparing — Memory preparation in progress.
 * Informational only, no action buttons.
 */
export function buildPreparingContent(
    progress: { current: number; total: number } | null,
    locale: PageletLocale = "en",
): BubbleContent {
    const text = progress && progress.total > 20
        ? pageletT("pagelet.bubble.preparing.progress", locale, {
            current: String(progress.current),
            total: String(progress.total),
        })
        : pageletT("pagelet.bubble.preparing", locale);

    return {
        type: "preparing",
        findings: [{ text }],
        actions: [],
    };
}

/**
 * B3: Ready, Nothing Found — everything ready, no high-confidence results.
 * Primary: Find related old notes (triggers Discover).
 */
export function buildReadyEmptyContent(
    callbacks: BubbleStateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "ready-empty",
        findings: [{
            text: pageletT("pagelet.bubble.readyEmpty", locale),
        }],
        actions: [
            {
                label: pageletT("pagelet.bubble.readyEmpty.discover", locale),
                icon: "link",
                primary: true,
                callback: callbacks.onDiscoverConnections,
            },
        ],
    };
}

/**
 * B4: Intentionally Quiet — proactive hints disabled.
 * Shows explanation once, then minimal on subsequent opens.
 */
export function buildIntentionallyQuietContent(
    callbacks: BubbleStateCallbacks,
    acknowledged: boolean,
    locale: PageletLocale = "en",
): BubbleContent {
    const findings = acknowledged
        ? []  // Minimal: no explanation text
        : [{ text: pageletT("pagelet.bubble.quiet", locale) }];

    return {
        type: "intentionally-quiet",
        findings,
        actions: [
            {
                label: pageletT("pagelet.bubble.readyEmpty.discover", locale),
                icon: "link",
                primary: true,
                callback: callbacks.onDiscoverConnections,
            },
        ],
    };
}

/**
 * B5: Context Limited — note too short or Data Boundary exclusion.
 */
export function buildContextLimitedContent(
    variant: "short" | "boundary",
    callbacks: BubbleStateCallbacks,
    locale: PageletLocale = "en",
): BubbleContent {
    const isShort = variant === "short";
    return {
        type: "context-limited",
        findings: [{
            text: pageletT(
                isShort
                    ? "pagelet.bubble.contextLimited.short"
                    : "pagelet.bubble.contextLimited.boundary",
                locale,
            ),
        }],
        actions: [
            {
                label: pageletT(
                    isShort
                        ? "pagelet.bubble.contextLimited.capture"
                        : "pagelet.bubble.contextLimited.settings",
                    locale,
                ),
                icon: isShort ? "pencil" : "settings",
                primary: true,
                callback: isShort
                    ? callbacks.onQuickCapture
                    : callbacks.onOpenSettings,
            },
        ],
    };
}
```

### 4.2 A-type: Recall Delivery Adapter + Card Stack

**File:** `src/pagelet/bubble/recall-card.ts` (new file)

```typescript
import type {
    BubbleContent,
    DeliveryCandidate,
    DeliveryCardCallbacks,
    InlineContextHint,
} from "./types";
import type { PageletLocale } from "../../locales/pagelet/types";
import { pageletT } from "../../locales/pagelet/pagelet-t";
import type { QuietRecallCandidate } from "../../pa";

const MAX_BUBBLE_CARDS = 3;

/**
 * Adapt existing Quiet Recall runtime data into the unified delivery model.
 * Do this before introducing any parallel result model.
 */
export function quietRecallCandidateToDeliveryCandidate(
    candidate: QuietRecallCandidate,
): DeliveryCandidate {
    return {
        id: candidate.id,
        kind: "recall",
        title: candidate.title,
        body: candidate.summary,
        sourceRefs: candidate.sourceRefs.map((ref) => ({
            path: ref.path,
            title: ref.title,
            excerpt: ref.excerpt,
        })),
        whyNow: candidate.whyNow,
        preparedAt: candidate.generatedAt,
        route: { surface: "tab", payloadType: "quiet-recall" },
    };
}

/**
 * Build a single-visible-card stack. Only the active card's actions fire.
 */
export function buildRecallDeliveryContent(
    candidates: DeliveryCandidate[],
    activeIndex: number,
    callbacks: DeliveryCardCallbacks,
    options: {
        inlineHint?: InlineContextHint;
        locale?: PageletLocale;
    } = {},
): BubbleContent {
    const locale = options.locale ?? "en";
    const displayCandidates = candidates.slice(0, MAX_BUBBLE_CARDS);
    const activeCandidate = displayCandidates[Math.max(0, Math.min(activeIndex, displayCandidates.length - 1))];

    const findings = activeCandidate ? [{
        text: formatDeliveryFinding(activeCandidate, locale),
        sourceLink: activeCandidate.sourceRefs[0]?.path,
        sourceTitle: activeCandidate.sourceRefs[0]?.title ?? activeCandidate.title,
    }] : [];

    const actions = [
        {
            label: pageletT("pagelet.bubble.recall.open", locale),
            icon: "file-text",
            primary: true,
            callback: () => activeCandidate && callbacks.onOpen(activeCandidate),
        },
        {
            label: pageletT("pagelet.bubble.recall.link", locale),
            icon: "link",
            callback: () => activeCandidate && callbacks.onLinkToCurrent(activeCandidate),
        },
        {
            label: pageletT("pagelet.bubble.recall.later", locale),
            icon: "clock",
            variant: "compact" as const,
            callback: () => activeCandidate && callbacks.onLater(activeCandidate),
        },
    ];

    return {
        type: "recall-delivery",
        findings,
        actions,
        inlineHint: options.inlineHint,
    };
}

function formatDeliveryFinding(candidate: DeliveryCandidate, locale: PageletLocale): string {
    // Format: "📄 Title\nWhy-now sentence\n\"Source excerpt...\""
    const title = `📄 ${candidate.title}`;
    const whyNow = candidate.whyNow[0] ?? "";
    const excerpt = candidate.sourceRefs[0]?.excerpt
        ? `"${truncate(candidate.sourceRefs[0].excerpt, 120)}"`
        : "";
    return `${title}\n${whyNow}\n${excerpt}`;
}

function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + "...";
}
```

### 4.3 A-type: Bridge Hint Builder

Map existing `buildOnboardingContent` to Bridge Hint content type:

```typescript
/**
 * Bridge Hint — one-time onboarding nudge. Wraps existing onboarding
 * builders but uses the new "bridge-hint" content type.
 */
export function buildBridgeHintContent(
    kind: "first-use" | "first-capture" | "first-recall",
    onDismiss: () => void,
    locale: PageletLocale = "en",
): BubbleContent {
    const textKey = {
        "first-use": "pagelet.bubble.onboarding",
        "first-capture": "pagelet.onboarding.quickCapture",
        "first-recall": "pagelet.onboarding.quietRecall",
    }[kind];

    return {
        type: "bridge-hint",
        findings: [{ text: pageletT(textKey, locale) }],
        actions: [
            {
                label: pageletT("pagelet.onboarding.gotIt", locale),
                primary: true,
                callback: onDismiss,
            },
        ],
    };
}
```

### 4.4 Prepared Recap Delivery

```typescript
/**
 * Prepared Recap Delivery — A-type, only shown when a fresh prepared
 * Scope Recap artifact already exists.
 *
 * The candidate must be backed by a local derived artifact that includes
 * sourceRefs, source coverage, stale status, preparedAt, and scope/range
 * metadata. It must not be a foreground "generate summary" promise.
 */
export function buildPreparedRecapDeliveryContent(
    candidate: DeliveryCandidate & { kind: "recap" },
    callbacks: { onViewRecap: () => void; onLater: () => void },
    locale: PageletLocale = "en",
): BubbleContent {
    return {
        type: "recap-delivery",
        findings: [{
            text: pageletT("pagelet.bubble.recapDelivery", locale),
            sourceTitle: candidate.title,
        }],
        actions: [
            {
                label: pageletT("pagelet.bubble.recapDelivery.view", locale),
                icon: "calendar",
                primary: true,
                callback: callbacks.onViewRecap,
            },
            {
                label: pageletT("pagelet.bubble.later", locale),
                variant: "compact",
                callback: callbacks.onLater,
            },
        ],
    };
}
```

### 4.5 Deprecate `buildEmptyContent`

Mark `buildEmptyContent` as `@deprecated`. It remains callable for the
migration period but the coordinator should no longer call it.

```typescript
/**
 * @deprecated Use state-specific builders: buildNeedsSetupContent,
 * buildPreparingContent, buildReadyEmptyContent, buildIntentionallyQuietContent,
 * buildContextLimitedContent. Scheduled for removal after migration.
 */
export function buildEmptyContent(
    callbacks: BubbleQuickAccessCallbacks,
    locale: PageletLocale = "en",
): BubbleContent { /* ... existing implementation ... */ }
```

---

## 5. BubbleCoordinator Changes

### 5.1 Bubble Readiness Snapshot

The Bubble resolver must consume a snapshot, not perform async reads inline.
Current Memory readiness and note reads are asynchronous; the coordinator should
refresh a snapshot through the orchestrator and use the latest available value
when opening Bubble.

```typescript
export interface BubbleReadinessSnapshot {
    memoryReady: boolean;
    memoryPreparing: boolean;
    proactiveHintsEnabled: boolean;
    quietRecallEnabled: boolean;
    quietRecallBubbleNudgesEnabled: boolean;
    focusModeEnabled: boolean;
    quietHoursActive: boolean;
    isMarkdownNote: boolean;
    noteContentLength: number;
    isDataBoundaryExcluded: boolean;
    pageletEnabled: boolean;
    petVisible: boolean;
    updatedAt: number;
}
```

State resolution can remain pure, but its input must be this snapshot. If the
snapshot is stale or unavailable, prefer a calm Ready/Preparing explanation
rather than blocking Bubble open.

### 5.2 Rewritten `showBubble` Cascade

The new cascade implements the A > B priority rule:

```typescript
showBubble(bubbleView: BubbleView | null, petView: PetView | null): void {
    const anchorEl = petView?.rootEl;
    if (!bubbleView || !anchorEl) return;

    const locale = getPageletUiLanguage();
    const stateCallbacks = this.buildStateCallbacks(bubbleView);

    // ─── A-type: Check for delivery content (in priority order) ───

    // A4: Bridge Hint (first-time onboarding)
    if (!this.host.settings.pagelet.onboardingShown) {
        const content = buildBridgeHintContent("first-use", () => {
            this.host.updatePageletSetting("onboardingShown", true);
            bubbleView.close();
        }, locale);
        bubbleView.show(content, anchorEl);
        return;
    }

    // Mark onboarding as shown if not yet (safety)
    if (!this.host.settings.pagelet.onboardingShown) {
        this.host.updatePageletSetting("onboardingShown", true);
    }

    // A1: Recall Delivery (from Quiet Recall candidates)
    const recallResults = this.getRecallDeliveryResults();
    if (recallResults.length > 0) {
        const inlineHint = this.resolveInlineHint(locale);
        const content = buildRecallDeliveryContent(
            recallResults,
            this.buildRecallCardCallbacks(bubbleView),
            { inlineHint, locale },
        );
        bubbleView.show(content, anchorEl);
        return;
    }

    // A3: Pattern Delivery
    const patternResult = this.callbacks.getPatternDetectionNudge?.();
    if (patternResult && patternResult.totalCount > 0) {
        const content = buildPatternDetectionNudgeContent(
            /* ... existing pattern options ... */
        );
        bubbleView.show(content, anchorEl);
        return;
    }

    // A2: Quick Review Delivery (cached background findings)
    const cachedFindings = this.preloadCache.getFindings();
    if (cachedFindings.length > 0) {
        const mappedFindings = this.mapFindings(cachedFindings);
        const inlineHint = this.resolveInlineHint(locale);
        const content = buildQuickReviewContent(mappedFindings, stateCallbacks, locale);
        if (inlineHint) content.inlineHint = inlineHint;
        bubbleView.show(content, anchorEl);
        return;
    }

    // ─── B-type: No delivery content → resolve explanation state ───

    const stateCtx = this.gatherBubbleStateContext();
    const explanationState = resolveBubbleExplanationState(stateCtx);

    const content = this.buildExplanationContent(explanationState, stateCallbacks, locale);
    bubbleView.show(content, anchorEl);
}
```

### 5.3 Explanation Content Dispatcher

```typescript
private buildExplanationContent(
    state: BubbleExplanationState,
    callbacks: BubbleStateCallbacks,
    locale: PageletLocale,
): BubbleContent {
    switch (state) {
        case "needs-setup":
            return buildNeedsSetupContent(callbacks, locale);

        case "preparing": {
            const progress = this.host.getMemoryPreparationProgress?.() ?? null;
            return buildPreparingContent(progress, locale);
        }

        case "context-limited-short":
            return buildContextLimitedContent("short", callbacks, locale);

        case "context-limited-boundary":
            return buildContextLimitedContent("boundary", callbacks, locale);

        case "intentionally-quiet": {
            const ack = this.host.settings.pagelet.quietAcknowledged ?? false;
            return buildIntentionallyQuietContent(callbacks, ack, locale);
        }

        case "ready-empty":
        default:
            return buildReadyEmptyContent(callbacks, locale);
    }
}
```

### 5.4 Inline Context Hint Resolution

```typescript
private resolveInlineHint(locale: PageletLocale): InlineContextHint | undefined {
    // Only show inline hint when A-type content is displayed but a B-type
    // condition also applies
    if (this.host.isMemoryPreparing()) {
        return {
            text: pageletT("pagelet.bubble.inlineHint.preparing", locale),
        };
    }
    return undefined;
}
```

### 5.5 Discover Trigger Lifecycle (resolves F2)

When user clicks "Find related old notes" from a B-type empty state:

```typescript
private async handleDiscoverFromBubble(bubbleView: BubbleView): Promise<void> {
    const anchorEl = bubbleView.getAnchorEl();
    if (!anchorEl) return;

    const locale = getPageletUiLanguage();

    // 1. Show loading state in Bubble
    const loadingContent: BubbleContent = {
        type: "ready-empty",
        findings: [{ text: pageletT("pagelet.bubble.discover.loading", locale) }],
        actions: [],
    };
    bubbleView.show(loadingContent, anchorEl);

    try {
        // 2. Run Recall L3 pipeline
        const results = await this.host.runDiscoverRecall();

        // 3a. Results found → show Recall Delivery
        if (results.length > 0) {
            const content = buildRecallDeliveryContent(
                results,
                this.buildRecallCardCallbacks(bubbleView),
                { locale },
            );
            bubbleView.show(content, anchorEl);
        } else {
            // 3b. No convincing results → brief message, then back to empty
            const noResultContent: BubbleContent = {
                type: "ready-empty",
                findings: [{
                    text: pageletT("pagelet.bubble.discover.noResults", locale),
                }],
                actions: [],
            };
            bubbleView.show(noResultContent, anchorEl);

            // Auto-close after 3 seconds
            setTimeout(() => {
                if (bubbleView.bubbleState === "visible") {
                    bubbleView.close();
                }
            }, 3000);
        }
    } catch {
        // 3c. Error → close bubble silently, rely on Pet state for error
        bubbleView.close();
    }
}
```

### 5.6 Rewritten `showNudgeBubble` Cascade

The nudge path also follows A > B priority:

```typescript
showNudgeBubble(bubbleView: BubbleView | null, petView: PetView | null): void {
    const anchorEl = petView?.rootEl;
    if (!bubbleView || !anchorEl) return;

    const locale = getPageletUiLanguage();
    const stateCallbacks = this.buildStateCallbacks(bubbleView);

    // A4: Bridge hint (onboarding nudge)
    const onboardingNudge = this.callbacks.getOnboardingNudge?.();
    if (onboardingNudge) {
        const kind = onboardingNudge.kind === "quick_capture"
            ? "first-capture" : "first-use";
        const content = buildBridgeHintContent(kind, () => {
            this.callbacks.onOnboardingNudgeDismiss(onboardingNudge);
            bubbleView.close();
        }, locale);
        bubbleView.show(content, anchorEl);
        return;
    }

    // A1: Recall Delivery (from Quiet Recall)
    const recallResults = this.getRecallDeliveryResults();
    if (recallResults.length > 0) {
        const inlineHint = this.resolveInlineHint(locale);
        const content = buildRecallDeliveryContent(
            recallResults,
            this.buildRecallCardCallbacks(bubbleView),
            { inlineHint, locale },
        );
        bubbleView.show(content, anchorEl);
        return;
    }

    // A3: Pattern Delivery
    const patternResult = this.callbacks.getPatternDetectionNudge?.();
    if (patternResult && patternResult.totalCount > 0) {
        const content = buildPatternDetectionNudgeContent(
            /* ... existing ... */
        );
        bubbleView.show(content, anchorEl);
        return;
    }

    // Generic cached Quick Review findings and Review Queue reminders do not
    // render in Bubble. They remain Panel/Tab surfaces unless a later adapter
    // can prove a source-backed, high-confidence review delivery candidate.

    // B-type fallback
    const stateCtx = this.gatherBubbleStateContext();
    const explanationState = resolveBubbleExplanationState(stateCtx);
    const content = this.buildExplanationContent(explanationState, stateCallbacks, locale);
    bubbleView.show(content, anchorEl);
}
```

### 5.7 New Callback Builder

```typescript
private buildStateCallbacks(bubbleView: BubbleView): BubbleStateCallbacks {
    return {
        onExpandPanel: (type) => {
            bubbleView.close();
            this.callbacks.onExpandPanel(type ?? "");
        },
        onSourceClick: (link) => {
            bubbleView.close();
            this.callbacks.onSourceClick(link);
        },
        onDismiss: () => bubbleView.close(),
        onPrepareMemory: () => {
            bubbleView.close();
            this.callbacks.onPrepareMemory();
        },
        onReviewCurrentNote: () => {
            bubbleView.close();
            this.callbacks.onReviewCurrentNote();
        },
        onDiscoverConnections: () => {
            // Route through async discover handler
            void this.handleDiscoverFromBubble(bubbleView);
        },
        onQuickCapture: () => {
            bubbleView.close();
            this.callbacks.onQuickCapture();
        },
        onOpenSettings: () => {
            bubbleView.close();
            this.callbacks.onOpenSettings();
        },
    };
}
```

### 5.8 BubbleCoordinatorCallbacks Extension

```typescript
export interface BubbleCoordinatorCallbacks {
    // ... existing callbacks ...
    onPrepareMemory(): void;          // NEW
    onQuickCapture(): void;           // NEW
    onOpenSettings(): void;           // NEW
    getDeliveryCandidates?(): DeliveryCandidate[];  // NEW — prepared delivery pool
    runDiscoverRecall?(): Promise<DeliveryCandidate[]>;  // NEW — user-initiated recall adapter
    onDeliveryOpen?(candidate: DeliveryCandidate): void;      // NEW
    onDeliveryLink?(candidate: DeliveryCandidate): void;      // NEW
    onDeliveryLater?(candidate: DeliveryCandidate): void;     // NEW
}
```

---

## 6. BubbleView Changes

### 6.1 Inline Context Hint Rendering

Add to `renderContent()` in `BubbleView.ts`:

```typescript
private renderContent(content: BubbleContent): void {
    if (!this.rootEl) return;
    this.rootEl.setAttribute("data-content-type", content.type);

    // ... existing findings + actions rendering ...

    // NEW: Render inline context hint
    this.renderInlineHint(content.inlineHint);
}

private renderInlineHint(hint?: InlineContextHint): void {
    // Remove existing hint if any
    const existing = this.rootEl?.querySelector(".pa-pagelet-bubble-inline-hint");
    existing?.remove();

    if (!hint) return;

    const hintEl = document.createElement("div");
    hintEl.className = "pa-pagelet-bubble-inline-hint";

    const iconEl = document.createElement("span");
    iconEl.className = "pa-pagelet-bubble-inline-hint-icon";
    iconEl.textContent = hint.icon ?? "💡";
    hintEl.appendChild(iconEl);

    const textEl = document.createElement("span");
    textEl.className = "pa-pagelet-bubble-inline-hint-text";
    textEl.textContent = hint.text;
    hintEl.appendChild(textEl);

    // Insert after actions, as last child
    this.rootEl?.appendChild(hintEl);
}
```

### 6.2 CSS for Inline Hint

Add to `src/custom.pcss`:

```css
.pa-pagelet-bubble-inline-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    margin-top: 4px;
    font-size: 0.8em;
    color: var(--text-muted);
    opacity: 0.75;
    border-top: 1px solid var(--background-modifier-border);
}

.pa-pagelet-bubble-inline-hint-icon {
    flex-shrink: 0;
    font-size: 0.9em;
}

.pa-pagelet-bubble-inline-hint-text {
    line-height: 1.3;
}
```

### 6.3 CSS for New Content Types

Add `data-content-type` selectors for new B-type states:

```css
/* B-type states: quieter visual treatment */
.pa-pagelet-bubble[data-content-type="needs-setup"],
.pa-pagelet-bubble[data-content-type="preparing"],
.pa-pagelet-bubble[data-content-type="ready-empty"],
.pa-pagelet-bubble[data-content-type="intentionally-quiet"],
.pa-pagelet-bubble[data-content-type="context-limited"] {
    /* Reduce visual weight for explanation states */
    .pa-pagelet-bubble-items {
        opacity: 0.9;
    }
}

/* Recall delivery: slightly elevated visual treatment */
.pa-pagelet-bubble[data-content-type="recall-delivery"] {
    .pa-pagelet-bubble-items {
        font-size: 0.92em;
        line-height: 1.5;
    }
    .pa-pagelet-bubble-text {
        white-space: pre-line;  /* Preserve newlines in recall cards */
    }
}
```

---

## 7. Host Interface Changes

The `PageletHost` interface should expose snapshot and delivery hooks rather
than synchronous Memory readiness probes:

```typescript
// Add to PageletHost interface
interface PageletHost {
    // ... existing ...

    /** Latest non-blocking Bubble readiness snapshot. */
    getBubbleReadinessSnapshot(): BubbleReadinessSnapshot;

    /** Prepared delivery candidates for Bubble. */
    getDeliveryCandidates(): DeliveryCandidate[];

    /** Run user-initiated Discover Recall and adapt results to delivery cards. */
    runDiscoverRecall(): Promise<DeliveryCandidate[]>;
}
```

Implementation notes:

- The snapshot may be produced asynchronously by the orchestrator. Bubble open
  should not block on VSS stats or vault reads.
- `getDeliveryCandidates()` may return adapted Quiet Recall candidates and
  fresh prepared Recap candidates from the local derived cache.
- `runDiscoverRecall()` may reuse existing Quiet Recall / Discover paths, then
  adapt results to `DeliveryCandidate[]`.

### 7.1 Settings Extension

Add to pagelet settings:

```typescript
// In settings type
interface PageletSettings {
    // ... existing ...
    /** User has acknowledged the "intentionally quiet" explanation */
    quietAcknowledged?: boolean;
}
```

---

## 8. Locale String Additions

### 8.1 English (`src/locales/pagelet/en.json`)

```json
{
    "pagelet.bubble.needsSetup": "PA needs to learn your notes before it can bring old ideas back.",
    "pagelet.bubble.needsSetup.prepare": "Prepare Memory",
    "pagelet.bubble.needsSetup.review": "Review this note",

    "pagelet.bubble.preparing": "PA is learning your notes. Findings will appear when ready.",
    "pagelet.bubble.preparing.progress": "PA is learning your notes ({current}/{total}). Findings will appear when ready.",

    "pagelet.bubble.readyEmpty": "No new findings yet.",
    "pagelet.bubble.readyEmpty.discover": "Find related old notes",

    "pagelet.bubble.quiet": "PA is quiet unless you open it.",

    "pagelet.bubble.contextLimited.short": "This note is still too light for meaningful recall.",
    "pagelet.bubble.contextLimited.boundary": "This note is outside PA's boundary, so PA will stay quiet.",
    "pagelet.bubble.contextLimited.capture": "Capture a thought",
    "pagelet.bubble.contextLimited.settings": "View boundary settings",

    "pagelet.bubble.discover.loading": "Looking for related old notes...",
    "pagelet.bubble.discover.noResults": "No strong connections found this time.",

    "pagelet.bubble.recall.open": "Open",
    "pagelet.bubble.recall.link": "Link to current note",
    "pagelet.bubble.recall.later": "Later",

    "pagelet.bubble.inlineHint.preparing": "PA is still learning your notes — more findings may follow.",

    "pagelet.bubble.recapDelivery": "PA prepared a short recap for this scope.",
    "pagelet.bubble.recapDelivery.view": "View recap"
}
```

### 8.2 Chinese (`src/locales/pagelet/zh.json`)

```json
{
    "pagelet.bubble.needsSetup": "PA 需要先了解你的笔记，才能帮你找回旧想法。",
    "pagelet.bubble.needsSetup.prepare": "准备记忆",
    "pagelet.bubble.needsSetup.review": "先看看这篇笔记",

    "pagelet.bubble.preparing": "PA 正在熟悉你的笔记，准备好后会有发现。",
    "pagelet.bubble.preparing.progress": "PA 正在熟悉你的笔记（{current}/{total}），准备好后会有发现。",

    "pagelet.bubble.readyEmpty": "暂时没有新发现。",
    "pagelet.bubble.readyEmpty.discover": "从这篇笔记查找关联",

    "pagelet.bubble.quiet": "PA 只在你打开时才会查找。",

    "pagelet.bubble.contextLimited.short": "这篇笔记内容还太少，暂时无法进行有效的关联查找。",
    "pagelet.bubble.contextLimited.boundary": "这篇笔记不在 PA 当前边界内，PA 会保持安静。",
    "pagelet.bubble.contextLimited.capture": "随手记一笔",
    "pagelet.bubble.contextLimited.settings": "查看边界设置",

    "pagelet.bubble.discover.loading": "正在查找相关的旧笔记...",
    "pagelet.bubble.discover.noResults": "这次没有找到强关联。",

    "pagelet.bubble.recall.open": "打开",
    "pagelet.bubble.recall.link": "链接到当前笔记",
    "pagelet.bubble.recall.later": "稍后",

    "pagelet.bubble.inlineHint.preparing": "PA 还在熟悉你的笔记，可能有更多发现。",

    "pagelet.bubble.recapDelivery": "PA 已为这个范围准备了一份简短回顾。",
    "pagelet.bubble.recapDelivery.view": "查看回顾"
}
```

---

## 9. Migration Strategy

### Phase 1: Types + State Resolver + B-type Builders

1. Extend `BubbleContentType` union.
2. Add new interfaces to `types.ts`.
3. Create `state-resolver.ts`.
4. Add B-type content builders to `BubbleContent.ts`.
5. Mark `buildEmptyContent` as `@deprecated`.
6. Add locale strings.

**Test gate:** Unit tests for `resolveBubbleExplanationState` covering all
5 B-type states + priority correctness.

### Phase 2: Coordinator Cascade Rewrite

1. Add `gatherBubbleStateContext()` to coordinator.
2. Rewrite `showBubble` cascade with A > B priority.
3. Rewrite `showNudgeBubble` cascade.
4. Add `buildStateCallbacks` and `buildExplanationContent`.
5. Wire `handleDiscoverFromBubble` for Discover trigger.

**Test gate:** Unit tests for cascade priority (A beats B, B-type priority
order). Integration test with mock host for state determination.

### Phase 3: View + CSS

1. Add inline hint rendering to `BubbleView`.
2. Add CSS for inline hints and new content types.
3. Add `pre-line` white-space for recall card text.
4. Run `npm run tailwind:build`.

**Test gate:** `rg` community-scan command (no `innerHTML`, no runtime
`<style>` injection). Visual smoke in test vault via `make deploy`.

### Phase 4: Recall Card Builder + Integration

1. Create `recall-card.ts`.
2. Wire `DeliveryCardCallbacks` through coordinator.
3. Add `BubbleCoordinatorCallbacks` extensions for delivery candidates.
4. Integrate with Quiet Recall candidate pipeline (or mock).

**Test gate:** End-to-end smoke with mock `DeliveryCandidate` data.

---

## 10. Validation

### Local Validation Gate

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

### Smoke Scenarios (from Product Spec §10)

Priority scenarios for `make deploy` + Obsidian test vault:

| # | Scenario | Validation |
| --- | --- | --- |
| 1 | First install, open Bubble | Needs Setup state, no three-button menu |
| 3 | After Memory prepared, open note | Ready Empty with "Find related old notes" |
| 6 | Open note, no match | Ready Empty, not feature menu |
| 7 | Proactive hints off | Intentionally Quiet state |
| 14 | No "Generate summary" in any B-type state | Regression guard |
| 15 | No "Review current note" as primary in Ready Empty | Regression guard |

### New Unit Tests

| Test File | Coverage |
| --- | --- |
| `__tests__/pagelet/bubble/state-resolver.test.ts` | All 6 `BubbleExplanationState` values, priority ordering |
| `__tests__/pagelet/bubble/recall-card.test.ts` | `buildRecallDeliveryContent` with 1/2/3 results, truncation, inline hint |
| `__tests__/pagelet/bubble/bubble-content.test.ts` | New B-type builders: each produces correct type, findings, actions |

---

## 11. Spec Review Findings Resolution

| Finding | Resolution |
| --- | --- |
| **F1**: Onboarding maps to which state? | Onboarding (`buildOnboardingContent`) → Bridge Hint (A4). See §5.2. |
| **F2**: Discover trigger lifecycle | Defined in §5.5: loading → result card or "no results" auto-close. |
| **F3**: Save as insight missing from §6 | Deferred to out-of-scope (Saved Insight data model needed). Recall card ships with Open / Link / Later. |
| **F4**: Summary delivery priority | Lowest A-type, below Quick Review. See §5.2 cascade order. |
| **F5**: Intentionally Quiet acknowledgment persistence | `settings.pagelet.quietAcknowledged` flag. See §7.1. |
| **F6**: "Note too short" threshold | `MIN_NOTE_CONTENT_LENGTH = 50` chars. See §3.3. |
| **F7**: Saved Insight data model | Out of scope for this iteration. |
| **F8**: Locale strategy | Reuse existing `pageletT()` locale system. See §8. |

---

## References

- [Product Spec](./pagelet-bubble-readiness-and-recall-product-spec.md)
- [Product Discussion](./pagelet-bubble-product-discussion-2026-07-05.md)
- [Pagelet Product Design](./pagelet-product-design.md)
- [PA Product North Star](./pa-product-north-star.md)

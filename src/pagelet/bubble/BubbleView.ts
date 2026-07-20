/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Bubble DOM lifecycle manager.
 *
 * The Bubble is a speech bubble that appears near the Pet character.
 * It supports two visibility states:
 *
 *   - `hidden`   — DOM mounted but invisible (opacity 0, no events).
 *   - `visible`  — fully shown with content and interactions.
 *
 * Dismiss contract:
 *   - Click outside → close
 *   - Press Escape → close
 *   - Click × button → close
 *
 * Mobile mode (`.is-mobile` on body or viewport ≤ 768px):
 *   Full-width bottom sheet, no tail, slides up from bottom.
 *
 * Why raw DOM instead of a framework:
 *   Same rationale as mascot/dom-renderer.ts — the Bubble is a small
 *   component (~20 nodes) and the project already uses raw DOM for
 *   all pagelet UI.
 */

import type {
    BubbleAction,
    BubbleCard,
    BubbleContent,
    BubbleState,
    BubbleViewOptions,
} from "./types";
import { setIcon } from "obsidian";
import { getPageletUiLanguage, pageletT } from "../../locales/pagelet";
import {
    clearPlatformTimeout,
    getOptionalPlatformWindow,
    getPlatformDocument,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../../platform-dom";
import { appendIconButtonLabel, clearChildren, createHtmlElement, isObsidianModalOpen } from "../dom-utils";

/** Detect mobile context using the Obsidian convention or viewport width. */
function isMobile(): boolean {
    const doc = getPlatformDocument();
    const win = getOptionalPlatformWindow();
    return (
        doc.body.classList.contains("is-mobile") ||
        (win?.innerWidth ?? Number.POSITIVE_INFINITY) <= 768
    );
}

// ---------------------------------------------------------------------------
// Bubble positioning
// ---------------------------------------------------------------------------

/** Margin between the anchor element and the bubble. */
const ANCHOR_MARGIN = 20;
/** Minimum distance from the viewport top before flipping below. */
const MIN_TOP_SPACE = 16;
/** Minimum visible inset from the bubble to the containing viewport edge. */
const EDGE_MARGIN = 16;
/** Desktop bubble width used by CSS and measurement fallbacks. */
const DESKTOP_BUBBLE_WIDTH = 380;
let bubbleLabelSequence = 0;

// calculatePlacement logic is inlined in applyDesktopLayout to account
// for container-relative positioning (position:fixed inside a
// transformed container).

interface VisibleBounds {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
}

interface BubbleCloseOptions {
    restoreFocus?: boolean;
}

interface TouchPoint {
    x: number;
    y: number;
}

interface RenderableBubbleContent {
    findings: BubbleContent["findings"];
    actions: BubbleAction[];
    inlineHint?: BubbleContent["inlineHint"];
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

function minPositive(fallback: number, ...values: Array<number | undefined>): number {
    const positive = values.filter((value): value is number => typeof value === "number" && value > 0);
    return positive.length > 0 ? Math.min(...positive) : fallback;
}

function usesRichActionLayout(actions: BubbleAction[]): boolean {
    return actions.some((action) => Boolean(action.icon || action.description));
}

function getVisibleBounds(
    containerRect: DOMRect | undefined,
    positioningRect: DOMRect | undefined,
    positioningScrollLeft: number,
    positioningScrollTop: number,
): VisibleBounds {
    const docEl = getPlatformDocument().documentElement;
    const win = getOptionalPlatformWindow();
    const viewportW = minPositive(DESKTOP_BUBBLE_WIDTH, docEl.clientWidth, win?.innerWidth, containerRect?.right);
    const viewportH = minPositive(600, docEl.clientHeight, win?.innerHeight, containerRect?.bottom);
    const offsetX = positioningRect?.left ?? 0;
    const offsetY = positioningRect?.top ?? 0;
    const containerLeft = containerRect?.left ?? 0;
    const containerRight = containerRect?.right ?? viewportW;
    const containerTop = containerRect?.top ?? 0;
    const containerBottom = containerRect?.bottom ?? viewportH;

    const visibleLeft = Math.max(0, containerLeft);
    const visibleRight = Math.max(visibleLeft, Math.min(viewportW, containerRight));
    const visibleTop = Math.max(0, containerTop);
    const visibleBottom = Math.max(visibleTop, Math.min(viewportH, containerBottom));

    return {
        left: visibleLeft - offsetX + positioningScrollLeft,
        right: visibleRight - offsetX + positioningScrollLeft,
        top: visibleTop - offsetY + positioningScrollTop,
        bottom: visibleBottom - offsetY + positioningScrollTop,
        width: visibleRight - visibleLeft,
    };
}

function getPositioningContext(
    rootEl: HTMLElement,
    containerEl: HTMLElement | null,
): { rect: DOMRect | undefined; scrollLeft: number; scrollTop: number } {
    const offsetParent = rootEl.offsetParent as HTMLElement | null | undefined;
    const positioningEl = offsetParent ?? containerEl;
    return {
        rect: positioningEl?.getBoundingClientRect(),
        scrollLeft: positioningEl?.scrollLeft ?? 0,
        scrollTop: positioningEl?.scrollTop ?? 0,
    };
}

// ---------------------------------------------------------------------------
// BubbleView
// ---------------------------------------------------------------------------

/**
 * Bubble DOM lifecycle manager.
 *
 * Usage:
 *   const bubble = new BubbleView({ callbacks });
 *   bubble.mount(bodyEl);
 *   bubble.show(content, petElement);
 *   // ... later
 *   bubble.destroy();
 */
export class BubbleView {
    private readonly options: BubbleViewOptions;
    private rootEl: HTMLDivElement | null = null;
    private containerEl: HTMLElement | null = null;
    private state: BubbleState = "hidden";
    private currentContent: BubbleContent | null = null;

    // Bound event handlers (stored for removal on destroy).
    private readonly handleDocumentClick: (e: MouseEvent) => void;
    private readonly handleKeydown: (e: KeyboardEvent) => void;
    private readonly handleResize: () => void;

    // Reference to the anchor element for click-outside detection.
    private anchorEl: HTMLElement | null = null;
    private focusRestoreEl: HTMLElement | null = null;

    // Timer ID for deferred global listener attachment (see Fix 1).
    private attachTimerId: PlatformTimeoutHandle | null = null;
    private globalListenerDocument: Document | null = null;
    private resizeListenerWindow: Window | null = null;

    // Touch tracking for mobile swipe-down dismiss.
    private touchStartY: number | null = null;
    private readonly handleTouchStart: (e: TouchEvent) => void;
    private readonly handleTouchMove: (e: TouchEvent) => void;
    private readonly handleTouchEnd: (e: TouchEvent) => void;
    private readonly handleCardTouchStart: (e: TouchEvent) => void;
    private readonly handleCardTouchEnd: (e: TouchEvent) => void;
    /** Pending unmount-after-transition timer; cleared if the bubble reopens. */
    private unmountTimer: PlatformTimeoutHandle | null = null;
    /** Pending transitionend listener; cleared if the bubble reopens. */
    private unmountTransitionHandler: ((e: TransitionEvent) => void) | null = null;
    private readonly getLocale: NonNullable<BubbleViewOptions["getLocale"]>;
    /** Fallback timeout (ms) for transitionend in reduced-motion / hidden tabs. */
    private static readonly UNMOUNT_FALLBACK_MS = 350;
    /** Maximum movement still treated as an action-button tap on touch devices. */
    private static readonly ACTION_TAP_THRESHOLD = 12;
    /** Suppress synthetic clicks after a touch action has already fired. */
    private static readonly TOUCH_CLICK_SUPPRESS_MS = 500;
    /** Minimum horizontal swipe distance for card switching. */
    private static readonly CARD_SWIPE_THRESHOLD = 36;
    private activeCardIndex = 0;
    private cardTouchStart: TouchPoint | null = null;

    constructor(options: BubbleViewOptions) {
        this.options = options;
        this.getLocale = options.getLocale ?? getPageletUiLanguage;
        this.handleDocumentClick = this.onDocumentClick.bind(this);
        this.handleKeydown = this.onKeydown.bind(this);
        this.handleResize = () => {
            if (this.state !== "hidden" && this.anchorEl && this.rootEl) {
                if (isMobile()) {
                    this.applyMobileLayout();
                } else {
                    this.repositionBubble();
                }
            }
        };
        this.handleTouchStart = this.onTouchStart.bind(this);
        this.handleTouchMove = this.onTouchMove.bind(this);
        this.handleTouchEnd = this.onTouchEnd.bind(this);
        this.handleCardTouchStart = this.onCardTouchStart.bind(this);
        this.handleCardTouchEnd = this.onCardTouchEnd.bind(this);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Register the mount root. The Bubble uses lazy DOM attachment:
     * the speech-bubble element is built and appended only on `show()`,
     * then removed after the close transition. This keeps the workspace
     * free of long-lived fixed overlays while idle (D037 progressive
     * disclosure) and prevents interference with Obsidian's window
     * drag region.
     */
    mount(containerEl: HTMLElement): void {
        this.containerEl = containerEl;
    }

    /** Build (if needed) and attach the bubble root to the container. */
    private ensureMounted(): void {
        if (!this.containerEl) return;
        this.cancelPendingUnmount();
        if (!this.rootEl) {
            this.rootEl = this.buildDOM();
            this.containerEl.appendChild(this.rootEl);
        } else if (!this.rootEl.isConnected) {
            this.containerEl.appendChild(this.rootEl);
        }
    }

    /** Show the bubble with content, positioned relative to the given element. */
    show(content: BubbleContent, anchorEl: HTMLElement, options: { preserveFocus?: boolean } = {}): void {
        this.ensureMounted();
        if (!this.rootEl) return;

        this.anchorEl = anchorEl;
        this.focusRestoreEl = anchorEl;
        const shouldResetCard = this.state === "hidden" || this.currentContent !== content;
        this.currentContent = content;
        this.activeCardIndex = shouldResetCard
            ? 0
            : clamp(this.activeCardIndex, 0, Math.max((content.cards?.length ?? 1) - 1, 0));
        this.renderContent(content);

        if (isMobile()) {
            this.applyMobileLayout();
            this.attachSwipeDismiss();
        } else {
            this.detachSwipeDismiss();
            this.applyDesktopLayout(anchorEl);
        }

        this.setState("visible");
        if (!options.preserveFocus) this.focusInitialControl();
        this.attachGlobalListeners();
    }

    /** Fully close/hide the bubble. */
    close(options: BubbleCloseOptions = {}): void {
        const wasVisible = this.state !== "hidden" && !!this.rootEl?.isConnected;
        const focusRestoreEl = this.focusRestoreEl;
        this.setState("hidden");
        this.detachGlobalListeners();
        this.anchorEl = null;
        this.focusRestoreEl = null;
        this.currentContent = null;
        this.activeCardIndex = 0;
        if (wasVisible && this.rootEl) {
            this.scheduleUnmount(this.rootEl);
        }
        if (options.restoreFocus !== false) {
            this.restoreFocus(focusRestoreEl);
        }
    }

    /** Get current state. */
    get bubbleState(): BubbleState {
        return this.state;
    }

    /** Check if bubble has content (visible). */
    get hasContent(): boolean {
        return this.state === "visible";
    }

    /** Clean up — remove DOM, detach listeners. */
    destroy(): void {
        this.detachGlobalListeners();
        this.cancelPendingUnmount();
        if (this.rootEl) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        this.containerEl = null;
        this.anchorEl = null;
        this.focusRestoreEl = null;
        this.currentContent = null;
        this.activeCardIndex = 0;
        this.state = "hidden";
    }

    // -----------------------------------------------------------------------
    // Lazy unmount helpers
    // -----------------------------------------------------------------------

    /**
     * Detach the bubble root after the close transition completes so
     * the fixed overlay no longer participates in hit-testing.
     */
    private scheduleUnmount(root: HTMLDivElement): void {
        this.cancelPendingUnmount();
        const finalize = () => {
            this.cancelPendingUnmount();
            // Only unmount if the DOM is still in the hidden state -- a
            // re-show may have flipped data-state back to "visible" while
            // the transition was running. Reading the attribute keeps
            // this check aligned with PanelView/TabView.
            if (this.rootEl === root && root.getAttribute("data-state") === "hidden") {
                root.remove();
            }
        };
        const handler = (e: TransitionEvent) => {
            if (e.target !== root) return;
            if (e.propertyName !== "opacity") return;
            finalize();
        };
        this.unmountTransitionHandler = handler;
        root.addEventListener("transitionend", handler);
        this.unmountTimer = setPlatformTimeout(finalize, BubbleView.UNMOUNT_FALLBACK_MS);
    }

    private cancelPendingUnmount(): void {
        if (this.unmountTimer !== null) {
            clearPlatformTimeout(this.unmountTimer);
            this.unmountTimer = null;
        }
        if (this.unmountTransitionHandler && this.rootEl) {
            this.rootEl.removeEventListener("transitionend", this.unmountTransitionHandler);
        }
        this.unmountTransitionHandler = null;
    }

    // -----------------------------------------------------------------------
    // DOM construction
    // -----------------------------------------------------------------------

    private buildDOM(): HTMLDivElement {
        const root = createHtmlElement("div");
        root.className = "pa-pagelet-bubble";
        root.setAttribute("data-state", "hidden");
        root.setAttribute("role", "dialog");
        const locale = this.getLocale();
        const label = createHtmlElement("span");
        label.className = "pa-sr-only";
        label.setAttribute("id", `pa-pagelet-bubble-label-${++bubbleLabelSequence}`);
        label.textContent = pageletT("pagelet.bubble.ariaLabel", locale);
        root.setAttribute("aria-labelledby", label.getAttribute("id") ?? "");
        root.appendChild(label);

        // Tail
        const tail = createHtmlElement("div");
        tail.className = "pa-pagelet-bubble-tail";
        root.appendChild(tail);

        // Header with close button
        const header = createHtmlElement("div");
        header.className = "pa-pagelet-bubble-header";

        const closeBtn = createHtmlElement("button");
        closeBtn.className = "pa-pagelet-bubble-close";
        const closeText = pageletT("pagelet.bubble.close", locale);
        closeBtn.setAttribute("title", closeText);
        appendIconButtonLabel(closeBtn, "×", closeText);
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.close();
            this.options.callbacks.onDismiss();
        });
        header.appendChild(closeBtn);
        root.appendChild(header);

        // Items list (populated by renderContent)
        const items = createHtmlElement("ul");
        items.className = "pa-pagelet-bubble-items";
        root.appendChild(items);

        const hint = createHtmlElement("div");
        hint.className = "pa-pagelet-bubble-inline-hint";
        hint.setAttribute("hidden", "true");
        root.appendChild(hint);

        const stackNav = createHtmlElement("div");
        stackNav.className = "pa-pagelet-bubble-stack-nav";
        stackNav.setAttribute("hidden", "true");
        root.appendChild(stackNav);

        // Actions row (populated by renderContent)
        const actions = createHtmlElement("div");
        actions.className = "pa-pagelet-bubble-actions";
        root.appendChild(actions);

        return root;
    }

    // -----------------------------------------------------------------------
    // Content rendering
    // -----------------------------------------------------------------------

    private renderContent(content: BubbleContent): void {
        if (!this.rootEl) return;

        this.rootEl.setAttribute("data-content-type", content.type);
        const renderable = this.getRenderableContent(content);

        // Rebuild findings list
        const itemsEl = this.rootEl.querySelector(".pa-pagelet-bubble-items");
        if (itemsEl) {
            clearChildren(itemsEl);
            itemsEl.removeEventListener("touchstart", this.handleCardTouchStart as EventListener);
            itemsEl.removeEventListener("touchend", this.handleCardTouchEnd as EventListener);
            if ((content.cards?.length ?? 0) > 1) {
                itemsEl.addEventListener("touchstart", this.handleCardTouchStart as EventListener, { passive: true });
                itemsEl.addEventListener("touchend", this.handleCardTouchEnd as EventListener, { passive: true });
            }
            for (const finding of renderable.findings) {
                const li = createHtmlElement("li");

                const bullet = createHtmlElement("span");
                bullet.className = "pa-pagelet-bubble-bullet";
                li.appendChild(bullet);

                const itemBody = createHtmlElement("span");
                itemBody.className = "pa-pagelet-bubble-item-body";

                const textSpan = createHtmlElement("span");
                textSpan.className = "pa-pagelet-bubble-text";
                textSpan.textContent = finding.text;
                itemBody.appendChild(textSpan);

                if (finding.sourceLink) {
                    const link = createHtmlElement("a");
                    link.className = "pa-pagelet-bubble-source-link";
                    link.textContent = finding.sourceTitle ?? finding.sourceLink;
                    link.setAttribute("href", "#");
                    link.setAttribute("title", finding.sourceTitle ?? finding.sourceLink);
                    link.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.options.callbacks.onSourceClick(finding.sourceLink!);
                    });
                    itemBody.appendChild(link);
                }

                li.appendChild(itemBody);
                itemsEl.appendChild(li);
            }
        }

        this.renderInlineHint(renderable.inlineHint);
        this.renderStackNav(content);

        // Rebuild action buttons
        const actionsEl = this.rootEl.querySelector(".pa-pagelet-bubble-actions");
        if (actionsEl) {
            clearChildren(actionsEl);
            actionsEl.className = usesRichActionLayout(renderable.actions)
                ? "pa-pagelet-bubble-actions pa-pagelet-bubble-actions--rich"
                : "pa-pagelet-bubble-actions";
            for (const action of renderable.actions) {
                const btn = createHtmlElement("button");
                btn.className = "pa-pagelet-bubble-btn";
                btn.setAttribute("type", "button");
                if (action.primary) {
                    btn.classList.add("primary");
                }
                if (action.variant) {
                    btn.classList.add(`pa-pagelet-bubble-btn--${action.variant}`);
                }
                if (action.description) {
                    btn.setAttribute("title", `${action.label}: ${action.description}`);
                }
                if (action.icon) {
                    const icon = createHtmlElement("span");
                    icon.className = "pa-pagelet-bubble-btn-icon";
                    icon.setAttribute("aria-hidden", "true");
                    setIcon(icon, action.icon);
                    btn.appendChild(icon);
                }

                const copy = createHtmlElement("span");
                copy.className = "pa-pagelet-bubble-btn-copy";

                const label = createHtmlElement("span");
                label.className = "pa-pagelet-bubble-btn-label";
                label.textContent = action.label;
                copy.appendChild(label);

                if (action.description) {
                    const description = createHtmlElement("span");
                    description.className = "pa-pagelet-bubble-btn-description";
                    description.textContent = action.description;
                    copy.appendChild(description);
                }

                btn.appendChild(copy);
                this.attachActionActivation(btn, action.callback);
                actionsEl.appendChild(btn);
            }
        }

        this.renderContextAction(content.contextAction);
    }

    private renderContextAction(contextAction: BubbleContent["contextAction"]): void {
        if (!this.rootEl) return;
        let zone = this.rootEl.querySelector(".pa-pagelet-bubble-context-action");
        if (!contextAction) {
            if (zone) zone.remove();
            return;
        }
        if (!zone) {
            zone = createHtmlElement("div");
            zone.className = "pa-pagelet-bubble-context-action";
            this.rootEl.appendChild(zone);
        }
        clearChildren(zone);
        const label = createHtmlElement("span");
        label.className = "pa-pagelet-bubble-context-action-label";
        label.textContent = contextAction.label;
        zone.appendChild(label);
        const btn = createHtmlElement("button");
        btn.className = "pa-pagelet-bubble-context-action-btn";
        btn.setAttribute("type", "button");
        btn.textContent = pageletT(
            contextAction.action === "discover"
                ? "pagelet.bubble.contextAction.discover"
                : "pagelet.bubble.contextAction.review",
            this.getLocale(),
        );
        this.attachActionActivation(btn, contextAction.callback);
        zone.appendChild(btn);
    }

    private getRenderableContent(content: BubbleContent): RenderableBubbleContent {
        const cards = this.getCards(content);
        if (cards.length === 0) {
            return {
                findings: content.findings,
                actions: content.actions,
                inlineHint: content.inlineHint,
            };
        }
        this.activeCardIndex = clamp(this.activeCardIndex, 0, cards.length - 1);
        const active = cards[this.activeCardIndex];
        return {
            findings: active.findings,
            actions: active.actions,
            inlineHint: active.inlineHint ?? content.inlineHint,
        };
    }

    private getCards(content: BubbleContent): BubbleCard[] {
        return (content.cards ?? []).slice(0, 3);
    }

    private renderInlineHint(hint: BubbleContent["inlineHint"]): void {
        if (!this.rootEl) return;
        const hintEl = this.rootEl.querySelector<HTMLElement>(".pa-pagelet-bubble-inline-hint");
        if (!hintEl) return;
        clearChildren(hintEl);
        if (!hint?.text) {
            hintEl.setAttribute("hidden", "true");
            return;
        }
        hintEl.removeAttribute("hidden");
        const icon = createHtmlElement("span");
        icon.className = "pa-pagelet-bubble-inline-hint-icon";
        if (hint.icon) {
            setIcon(icon, hint.icon);
        }
        icon.setAttribute("aria-hidden", "true");
        hintEl.appendChild(icon);
        const text = createHtmlElement("span");
        text.className = "pa-pagelet-bubble-inline-hint-text";
        text.textContent = hint.text;
        hintEl.appendChild(text);
    }

    private renderStackNav(content: BubbleContent): void {
        if (!this.rootEl) return;
        const nav = this.rootEl.querySelector<HTMLElement>(".pa-pagelet-bubble-stack-nav");
        if (!nav) return;
        clearChildren(nav);
        const cards = this.getCards(content);
        if (cards.length <= 1) {
            nav.setAttribute("hidden", "true");
            return;
        }
        nav.removeAttribute("hidden");
        nav.setAttribute("aria-label", pageletT("pagelet.bubble.cardStack.ariaLabel", this.getLocale()));

        const previous = createHtmlElement("button");
        previous.className = "pa-pagelet-bubble-stack-btn";
        previous.setAttribute("type", "button");
        previous.setAttribute("title", pageletT("pagelet.bubble.cardStack.previous", this.getLocale()));
        appendIconButtonLabel(previous, "‹", pageletT("pagelet.bubble.cardStack.previous", this.getLocale()));
        previous.disabled = this.activeCardIndex === 0;
        previous.addEventListener("click", (event) => {
            event.stopPropagation();
            this.activateCard(this.activeCardIndex - 1);
        });
        nav.appendChild(previous);

        const dots = createHtmlElement("div");
        dots.className = "pa-pagelet-bubble-stack-dots";
        for (let index = 0; index < cards.length; index += 1) {
            const dot = createHtmlElement("button");
            dot.className = "pa-pagelet-bubble-stack-dot";
            dot.setAttribute("type", "button");
            dot.setAttribute("title", pageletT("pagelet.bubble.cardStack.goTo", this.getLocale(), { current: index + 1, total: cards.length }));
            dot.setAttribute("aria-current", index === this.activeCardIndex ? "true" : "false");
            const dotLabel = createHtmlElement("span");
            dotLabel.className = "pa-sr-only";
            dotLabel.textContent = pageletT("pagelet.bubble.cardStack.goTo", this.getLocale(), { current: index + 1, total: cards.length });
            dot.appendChild(dotLabel);
            dot.addEventListener("click", (event) => {
                event.stopPropagation();
                this.activateCard(index);
            });
            dots.appendChild(dot);
        }
        nav.appendChild(dots);

        const next = createHtmlElement("button");
        next.className = "pa-pagelet-bubble-stack-btn";
        next.setAttribute("type", "button");
        next.setAttribute("title", pageletT("pagelet.bubble.cardStack.next", this.getLocale()));
        appendIconButtonLabel(next, "›", pageletT("pagelet.bubble.cardStack.next", this.getLocale()));
        next.disabled = this.activeCardIndex >= cards.length - 1;
        next.addEventListener("click", (event) => {
            event.stopPropagation();
            this.activateCard(this.activeCardIndex + 1);
        });
        nav.appendChild(next);
    }

    private activateCard(index: number): void {
        if (!this.currentContent) return;
        const cards = this.getCards(this.currentContent);
        if (cards.length <= 1) return;
        const next = clamp(index, 0, cards.length - 1);
        if (next === this.activeCardIndex) return;
        this.activeCardIndex = next;
        this.renderContent(this.currentContent);
        this.focusActiveStackDot();
    }

    private focusActiveStackDot(): void {
        const dots = this.rootEl?.querySelectorAll<HTMLButtonElement>(".pa-pagelet-bubble-stack-dot") ?? [];
        const dot = dots[this.activeCardIndex];
        if (dot) {
            dot.focus({ preventScroll: true });
            return;
        }
        this.focusInitialControl();
    }

    private attachActionActivation(btn: HTMLButtonElement, callback: () => void): void {
        let touchStart: TouchPoint | null = null;
        let lastTouchActivation = 0;

        const activate = (e: Event): void => {
            e.stopPropagation();
            callback();
        };

        btn.addEventListener("click", (e) => {
            const now = Date.now();
            if (now - lastTouchActivation < BubbleView.TOUCH_CLICK_SUPPRESS_MS) {
                e.stopPropagation();
                return;
            }
            activate(e);
        });

        btn.addEventListener("touchstart", (e) => {
            if (e.touches.length !== 1) {
                touchStart = null;
                return;
            }
            const touch = e.touches[0];
            touchStart = { x: touch.clientX, y: touch.clientY };
        }, { passive: true });

        btn.addEventListener("touchend", (e) => {
            const start = touchStart;
            touchStart = null;
            if (!start) return;

            const touch = e.changedTouches[0];
            if (!touch) return;
            const dx = Math.abs(touch.clientX - start.x);
            const dy = Math.abs(touch.clientY - start.y);
            if (dx > BubbleView.ACTION_TAP_THRESHOLD || dy > BubbleView.ACTION_TAP_THRESHOLD) {
                return;
            }

            e.preventDefault();
            lastTouchActivation = Date.now();
            activate(e);
        }, { passive: false });

        btn.addEventListener("touchcancel", () => {
            touchStart = null;
        }, { passive: true });
    }

    // -----------------------------------------------------------------------
    // Layout / positioning
    // -----------------------------------------------------------------------

    private applyDesktopLayout(anchorEl: HTMLElement): void {
        if (!this.rootEl) return;

        this.rootEl.classList.remove("pa-pagelet-bubble--mobile");

        const anchorRect = anchorEl.getBoundingClientRect();

        // F-09: Use active leaf bounds for desktop clamping when available
        const leafBounds = this.options.getActiveLeafBounds?.() ?? null;
        const containerRect = leafBounds ?? this.containerEl?.getBoundingClientRect();
        const positioning = getPositioningContext(this.rootEl, this.containerEl);
        const offsetX = positioning.rect?.left ?? 0;
        const offsetY = positioning.rect?.top ?? 0;
        const visibleBounds = getVisibleBounds(
            containerRect,
            positioning.rect,
            positioning.scrollLeft,
            positioning.scrollTop,
        );
        const maxBubbleW = Math.max(1, visibleBounds.width - EDGE_MARGIN * 2);
        const maxBubbleH = Math.max(160, visibleBounds.bottom - visibleBounds.top - EDGE_MARGIN * 2);

        // Use a temporary measurement to get the bubble's natural size.
        this.rootEl.setCssStyles({
            maxWidth: `${maxBubbleW}px`,
            maxHeight: `${maxBubbleH}px`,
            overflowY: "auto",
            visibility: "hidden",
            display: "block",
        });
        this.rootEl.setAttribute("data-state", "visible");
        const bubbleRect = this.rootEl.getBoundingClientRect();
        this.rootEl.setAttribute("data-state", "hidden");
        this.rootEl.setCssStyles({
            visibility: "",
            display: "",
        });

        const bubbleW = Math.min(this.rootEl.offsetWidth || bubbleRect.width || DESKTOP_BUBBLE_WIDTH, maxBubbleW);
        const bubbleH = Math.min(this.rootEl.offsetHeight || bubbleRect.height || 200, maxBubbleH);

        // Place above anchor by default; flip below if not enough room.
        let placement: "above" | "below" = "above";
        let top = anchorRect.top - offsetY + positioning.scrollTop - bubbleH - ANCHOR_MARGIN;
        if (top < visibleBounds.top + MIN_TOP_SPACE) {
            placement = "below";
            top = anchorRect.bottom - offsetY + positioning.scrollTop + ANCHOR_MARGIN;
        }
        const maxTop = Math.max(visibleBounds.top + MIN_TOP_SPACE, visibleBounds.bottom - bubbleH - EDGE_MARGIN);
        top = clamp(top, visibleBounds.top + MIN_TOP_SPACE, maxTop);

        // Center horizontally on anchor, clamped to container bounds.
        const anchorCenterX = anchorRect.left - offsetX + positioning.scrollLeft + anchorRect.width / 2;
        const minLeft = visibleBounds.left + EDGE_MARGIN;
        const maxLeft = Math.max(minLeft, visibleBounds.right - bubbleW - EDGE_MARGIN);
        const left = clamp(anchorCenterX - bubbleW / 2, minLeft, maxLeft);

        this.rootEl.setCssStyles({
            top: `${top}px`,
            left: `${left}px`,
            right: "",
            bottom: "",
            maxWidth: `${maxBubbleW}px`,
            maxHeight: `${maxBubbleH}px`,
            overflowY: "auto",
        });
        this.rootEl.setAttribute("data-placement", placement);

        // Position tail to point at anchor center
        const tail = this.rootEl.querySelector<HTMLElement>(".pa-pagelet-bubble-tail");
        if (tail) {
            const tailLeft = Math.max(16, Math.min(anchorCenterX - left - 7, bubbleW - 24));
            tail.setCssStyles({ left: `${tailLeft}px` });
        }
    }

    /** Lightweight reposition without measurement dance (safe during resize). */
    private repositionBubble(): void {
        if (!this.rootEl || !this.anchorEl || !this.containerEl) return;

        const anchorRect = this.anchorEl.getBoundingClientRect();
        // F-09: Use active leaf bounds for desktop clamping when available
        const leafBounds = this.options.getActiveLeafBounds?.() ?? null;
        const containerRect = leafBounds ?? this.containerEl.getBoundingClientRect();
        const positioning = getPositioningContext(this.rootEl, this.containerEl);
        const offsetX = positioning.rect?.left ?? 0;
        const offsetY = positioning.rect?.top ?? 0;
        const visibleBounds = getVisibleBounds(
            containerRect,
            positioning.rect,
            positioning.scrollLeft,
            positioning.scrollTop,
        );
        const maxBubbleW = Math.max(1, visibleBounds.width - EDGE_MARGIN * 2);
        const maxBubbleH = Math.max(160, visibleBounds.bottom - visibleBounds.top - EDGE_MARGIN * 2);
        this.rootEl.setCssStyles({
            maxWidth: `${maxBubbleW}px`,
            maxHeight: `${maxBubbleH}px`,
            overflowY: "auto",
        });
        const bubbleW = Math.min(this.rootEl.offsetWidth || DESKTOP_BUBBLE_WIDTH, maxBubbleW);
        const bubbleH = Math.min(this.rootEl.offsetHeight || 200, maxBubbleH);
        const placement = this.rootEl.getAttribute("data-placement") as "above" | "below" || "above";

        let top: number;
        if (placement === "below") {
            top = anchorRect.bottom - offsetY + positioning.scrollTop + ANCHOR_MARGIN;
        } else {
            top = anchorRect.top - offsetY + positioning.scrollTop - bubbleH - ANCHOR_MARGIN;
        }
        const maxTop = Math.max(visibleBounds.top + MIN_TOP_SPACE, visibleBounds.bottom - bubbleH - EDGE_MARGIN);
        top = clamp(top, visibleBounds.top + MIN_TOP_SPACE, maxTop);

        const anchorCenterX = anchorRect.left - offsetX + positioning.scrollLeft + anchorRect.width / 2;
        const minLeft = visibleBounds.left + EDGE_MARGIN;
        const maxLeft = Math.max(minLeft, visibleBounds.right - bubbleW - EDGE_MARGIN);
        const left = clamp(anchorCenterX - bubbleW / 2, minLeft, maxLeft);

        this.rootEl.setCssStyles({
            top: `${top}px`,
            left: `${left}px`,
        });

        const tail = this.rootEl.querySelector<HTMLElement>(".pa-pagelet-bubble-tail");
        if (tail) {
            const tailLeft = Math.max(16, Math.min(anchorCenterX - left - 7, bubbleW - 24));
            tail.setCssStyles({ left: `${tailLeft}px` });
        }
    }

    private applyMobileLayout(): void {
        if (!this.rootEl) return;

        this.rootEl.classList.add("pa-pagelet-bubble--mobile");
        // Mobile: bottom-sheet surface. Portrait stays near-full-width while
        // shallow landscape viewports are centered and bounded by CSS. Clear
        // any desktop inline styles so rotation can reflow without residue.
        this.rootEl.setCssStyles({
            top: "",
            left: "",
            right: "",
            bottom: "",
            maxWidth: "",
            maxHeight: "",
            overflowY: "",
        });
        this.rootEl.removeAttribute("data-placement");
    }

    private focusInitialControl(): void {
        if (!this.rootEl) return;
        const buttons = Array.from(this.rootEl.querySelectorAll<HTMLElement>(".pa-pagelet-bubble-btn"));
        const target = buttons.find((button) => button.classList.contains("primary"))
            ?? buttons[0]
            ?? this.rootEl.querySelector<HTMLElement>(".pa-pagelet-bubble-close");
        this.focusElement(target);
    }

    private restoreFocus(target: HTMLElement | null): void {
        if (!target?.isConnected) return;
        this.focusElement(target);
    }

    private focusElement(target: HTMLElement | null): void {
        if (!target) return;
        try {
            target.focus({ preventScroll: true });
        } catch {
            target.focus();
        }
    }

    // -----------------------------------------------------------------------
    // State management
    // -----------------------------------------------------------------------

    private setState(newState: BubbleState): void {
        this.state = newState;
        if (this.rootEl) {
            this.rootEl.setAttribute("data-state", newState);
        }
    }

    // -----------------------------------------------------------------------
    // Global event handlers
    // -----------------------------------------------------------------------

    private attachGlobalListeners(): void {
        this.attachTimerId = setPlatformTimeout(() => {
            this.attachTimerId = null;
            if (this.state === "hidden") return;
            const doc = getPlatformDocument();
            this.globalListenerDocument = doc;
            doc.addEventListener("click", this.handleDocumentClick, true);
            doc.addEventListener("keydown", this.handleKeydown, true);
        }, 0);
        const win = getOptionalPlatformWindow();
        this.resizeListenerWindow = win ?? null;
        win?.addEventListener("resize", this.handleResize);
    }

    private detachGlobalListeners(): void {
        if (this.attachTimerId !== null) {
            clearPlatformTimeout(this.attachTimerId);
            this.attachTimerId = null;
        }
        this.globalListenerDocument?.removeEventListener("click", this.handleDocumentClick, true);
        this.globalListenerDocument?.removeEventListener("keydown", this.handleKeydown, true);
        this.globalListenerDocument = null;
        this.resizeListenerWindow?.removeEventListener("resize", this.handleResize);
        this.resizeListenerWindow = null;
        this.detachSwipeDismiss();
    }

    private onDocumentClick(e: MouseEvent): void {
        const target = e.target as Node | null;
        if (!target || !this.rootEl) return;

        const clickInsideBubble = this.rootEl.contains(target);
        const clickOnAnchor = this.anchorEl?.contains(target) ?? false;

        if (clickInsideBubble || clickOnAnchor) {
            // Clicks inside the bubble or on the anchor are handled by
            // their own listeners.
            return;
        }

        // Click outside — close the bubble.
        if (this.state === "visible") {
            this.close({ restoreFocus: false });
            this.options.callbacks.onDismiss();
        }
    }

    private onKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape") {
            if (isObsidianModalOpen(e)) return;
            e.preventDefault();
            e.stopPropagation();
            this.close();
            this.options.callbacks.onDismiss();
        }
    }

    // -----------------------------------------------------------------------
    // Mobile swipe-down dismiss
    // -----------------------------------------------------------------------

    /** Minimum swipe distance (px) to trigger dismiss. */
    private static readonly SWIPE_THRESHOLD = 60;

    private attachSwipeDismiss(): void {
        if (!this.rootEl) return;
        this.rootEl.addEventListener("touchstart", this.handleTouchStart, { passive: true });
        this.rootEl.addEventListener("touchmove", this.handleTouchMove, { passive: true });
        this.rootEl.addEventListener("touchend", this.handleTouchEnd, { passive: true });
    }

    private detachSwipeDismiss(): void {
        if (!this.rootEl) return;
        this.rootEl.removeEventListener("touchstart", this.handleTouchStart);
        this.rootEl.removeEventListener("touchmove", this.handleTouchMove);
        this.rootEl.removeEventListener("touchend", this.handleTouchEnd);
        this.touchStartY = null;
    }

    private onTouchStart(e: TouchEvent): void {
        if (e.touches.length === 1) {
            this.touchStartY = e.touches[0].clientY;
        }
    }

    private onTouchMove(_e: TouchEvent): void {
        // Intentionally no-op — we only evaluate on touchend.
    }

    private onTouchEnd(e: TouchEvent): void {
        if (this.touchStartY === null) return;
        const endY = e.changedTouches[0]?.clientY ?? this.touchStartY;
        const delta = endY - this.touchStartY;
        this.touchStartY = null;

        if (delta > BubbleView.SWIPE_THRESHOLD) {
            this.close();
            this.options.callbacks.onDismiss();
        }
    }

    private onCardTouchStart(e: TouchEvent): void {
        if (e.touches.length !== 1) {
            this.cardTouchStart = null;
            return;
        }
        const touch = e.touches[0];
        this.cardTouchStart = { x: touch.clientX, y: touch.clientY };
    }

    private onCardTouchEnd(e: TouchEvent): void {
        const start = this.cardTouchStart;
        this.cardTouchStart = null;
        if (!start) return;
        const touch = e.changedTouches[0];
        if (!touch) return;

        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < BubbleView.CARD_SWIPE_THRESHOLD) return;
        if (Math.abs(dy) > Math.abs(dx)) return;

        e.stopPropagation();
        this.activateCard(dx < 0 ? this.activeCardIndex + 1 : this.activeCardIndex - 1);
    }
}

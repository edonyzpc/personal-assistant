/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 — Bubble DOM lifecycle manager.
 *
 * The Bubble is a speech bubble that appears near the Pet character.
 * It supports three visibility states:
 *
 *   - `hidden`   — DOM mounted but invisible (opacity 0, no events).
 *   - `visible`  — fully shown with content and interactions.
 *   - `degraded` — semi-transparent (opacity 0.4, pointer-events off)
 *                  after clicking outside. The close button remains
 *                  clickable so the user can still dismiss it.
 *
 * Dismiss contract:
 *   - Click outside → degrade (NOT close)
 *   - Click Pet when degraded → restore
 *   - Press Escape → fully close
 *   - Click × button → fully close
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
    BubbleContent,
    BubbleState,
    BubbleViewOptions,
} from "./types";

// ---------------------------------------------------------------------------
// CSS — injected once via <style> on first mount
// ---------------------------------------------------------------------------

const BUBBLE_CSS_ID = "pa-pagelet-bubble-styles";

const BUBBLE_CSS = /* css */ `
.pa-pagelet-bubble {
    position: absolute;
    z-index: 999;
    background: var(--background-secondary, #2a2a2a);
    border: 1px solid var(--background-modifier-border, #3a3a3a);
    border-radius: 12px;
    padding: 16px 18px;
    width: 300px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.4);
    opacity: 0;
    transform: scale(0.9) translateY(8px);
    transform-origin: bottom right;
    pointer-events: none;
    transition: opacity 0.25s ease, transform 0.25s ease;
    font-family: var(--font-interface, inherit);
    color: var(--text-normal, #dcddde);
    box-sizing: border-box;
}

.pa-pagelet-bubble[data-state="visible"] {
    opacity: 1;
    transform: scale(1) translateY(0);
    pointer-events: auto;
}

.pa-pagelet-bubble[data-state="degraded"] {
    opacity: 0.4;
    transform: scale(1) translateY(0);
    pointer-events: none;
}

/* Close button stays clickable even in degraded state */
.pa-pagelet-bubble[data-state="degraded"] .pa-pagelet-bubble-close {
    pointer-events: auto;
}

/* Tail — triangular pointer toward the Pet (positioned dynamically via JS) */
.pa-pagelet-bubble-tail {
    position: absolute;
    width: 14px;
    height: 14px;
    background: var(--background-secondary, #2a2a2a);
    border-right: 1px solid var(--background-modifier-border, #3a3a3a);
    border-bottom: 1px solid var(--background-modifier-border, #3a3a3a);
    transform: rotate(45deg);
    bottom: -8px;
    left: 50%;
}

/* When bubble is placed below anchor, tail points up */
.pa-pagelet-bubble[data-placement="below"] .pa-pagelet-bubble-tail {
    top: -8px;
    bottom: auto;
    border-right: none;
    border-bottom: none;
    border-left: 1px solid var(--background-modifier-border, #3a3a3a);
    border-top: 1px solid var(--background-modifier-border, #3a3a3a);
}

/* Header */
.pa-pagelet-bubble-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 8px;
}

.pa-pagelet-bubble-close {
    background: none;
    border: none;
    color: var(--text-muted, #999);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0 2px;
    opacity: 0.7;
    transition: opacity 0.15s ease;
}

.pa-pagelet-bubble-close:hover {
    opacity: 1;
    color: var(--text-normal, #dcddde);
}

/* Findings list */
.pa-pagelet-bubble-items {
    list-style: none;
    margin: 0 0 12px 0;
    padding: 0;
}

.pa-pagelet-bubble-items li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-normal, #dcddde);
}

.pa-pagelet-bubble-items li:last-child {
    margin-bottom: 0;
}

.pa-pagelet-bubble-bullet {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-faint, #666);
    margin-top: 7px;
}

.pa-pagelet-bubble-source-link {
    color: var(--text-accent, #7f6df2);
    cursor: pointer;
    text-decoration: none;
    margin-left: 4px;
    font-size: 12px;
}

.pa-pagelet-bubble-source-link:hover {
    text-decoration: underline;
}

/* Actions row */
.pa-pagelet-bubble-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.pa-pagelet-bubble-btn {
    background: var(--background-modifier-hover, #3a3a3a);
    border: 1px solid var(--background-modifier-border, #4a4a4a);
    border-radius: 6px;
    color: var(--text-muted, #999);
    cursor: pointer;
    font-size: 12px;
    padding: 4px 12px;
    transition: background 0.15s ease, color 0.15s ease;
}

.pa-pagelet-bubble-btn:hover {
    background: var(--background-modifier-border, #4a4a4a);
    color: var(--text-normal, #dcddde);
}

.pa-pagelet-bubble-btn.primary {
    background: var(--interactive-accent, #7f6df2);
    border-color: var(--interactive-accent, #7f6df2);
    color: var(--text-on-accent, #fff);
}

.pa-pagelet-bubble-btn.primary:hover {
    filter: brightness(1.1);
}

/* ---- Mobile: bottom sheet layout ---- */
.pa-pagelet-bubble.pa-pagelet-bubble--mobile {
    left: 8px !important;
    right: 8px !important;
    bottom: 80px !important;
    top: auto !important;
    width: auto;
    border-radius: 16px 16px 12px 12px;
    transform-origin: bottom center;
}

.pa-pagelet-bubble.pa-pagelet-bubble--mobile .pa-pagelet-bubble-tail {
    display: none;
}

.pa-pagelet-bubble.pa-pagelet-bubble--mobile[data-state="visible"] {
    transform: scale(1) translateY(0);
}

.pa-pagelet-bubble.pa-pagelet-bubble--mobile[data-state="hidden"] {
    transform: scale(0.95) translateY(16px);
}

/* ---- Light theme: softer shadows ---- */
.theme-light .pa-pagelet-bubble,
[data-theme="light"] .pa-pagelet-bubble {
    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
}

/* ---- Reduced motion ---- */
@media (prefers-reduced-motion: reduce) {
    .pa-pagelet-bubble {
        transition-duration: 0.01s !important;
    }
}

/* ---- Mobile: larger touch targets ---- */
body.is-mobile .pa-pagelet-bubble .pa-pagelet-bubble-items li {
    padding: 10px 12px;
    font-size: 14px;
}
body.is-mobile .pa-pagelet-bubble .pa-pagelet-bubble-btn {
    padding: 10px 18px;
    font-size: 13px;
}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inject Bubble CSS into `<head>` (idempotent). */
function injectStyles(): void {
    if (document.getElementById(BUBBLE_CSS_ID)) return;
    const style = document.createElement("style");
    style.id = BUBBLE_CSS_ID;
    style.textContent = BUBBLE_CSS;
    document.head.appendChild(style);
}

/** Detect mobile context using the Obsidian convention or viewport width. */
function isMobile(): boolean {
    return (
        document.body.classList.contains("is-mobile") ||
        window.innerWidth <= 768
    );
}

// ---------------------------------------------------------------------------
// Bubble positioning
// ---------------------------------------------------------------------------

/** Margin between the anchor element and the bubble. */
const ANCHOR_MARGIN = 20;
/** Minimum distance from the viewport top before flipping below. */
const MIN_TOP_SPACE = 16;

// calculatePlacement logic is inlined in applyDesktopLayout to account
// for container-relative positioning (position:fixed inside a
// transformed container).

// ---------------------------------------------------------------------------
// BubbleView
// ---------------------------------------------------------------------------

/**
 * Bubble DOM lifecycle manager.
 *
 * Usage:
 *   const bubble = new BubbleView({ callbacks });
 *   bubble.mount(document.body);
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

    // Timer ID for deferred global listener attachment (see Fix 1).
    private attachTimerId: ReturnType<typeof setTimeout> | null = null;

    // Touch tracking for mobile swipe-down dismiss.
    private touchStartY: number | null = null;
    private readonly handleTouchStart: (e: TouchEvent) => void;
    private readonly handleTouchMove: (e: TouchEvent) => void;
    private readonly handleTouchEnd: (e: TouchEvent) => void;
    /** Pending unmount-after-transition timer; cleared if the bubble reopens. */
    private unmountTimer: ReturnType<typeof setTimeout> | null = null;
    /** Pending transitionend listener; cleared if the bubble reopens. */
    private unmountTransitionHandler: ((e: TransitionEvent) => void) | null = null;
    /** Fallback timeout (ms) for transitionend in reduced-motion / hidden tabs. */
    private static readonly UNMOUNT_FALLBACK_MS = 350;

    constructor(options: BubbleViewOptions) {
        this.options = options;
        this.handleDocumentClick = this.onDocumentClick.bind(this);
        this.handleKeydown = this.onKeydown.bind(this);
        this.handleResize = () => {
            if (this.state !== "hidden" && this.anchorEl && this.rootEl) {
                this.repositionBubble();
            }
        };
        this.handleTouchStart = this.onTouchStart.bind(this);
        this.handleTouchMove = this.onTouchMove.bind(this);
        this.handleTouchEnd = this.onTouchEnd.bind(this);
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
        injectStyles();
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
    show(content: BubbleContent, anchorEl: HTMLElement): void {
        this.ensureMounted();
        if (!this.rootEl) return;

        this.anchorEl = anchorEl;
        this.currentContent = content;
        this.renderContent(content);

        if (isMobile()) {
            this.applyMobileLayout();
            this.attachSwipeDismiss();
        } else {
            this.detachSwipeDismiss();
            this.applyDesktopLayout(anchorEl);
        }

        this.setState("visible");
        this.attachGlobalListeners();
    }

    /** Degrade the bubble (semi-transparent, click-outside behavior). */
    degrade(): void {
        if (this.state !== "visible") return;
        this.setState("degraded");
    }

    /** Restore from degraded state. */
    restore(): void {
        if (this.state !== "degraded") return;
        this.setState("visible");
    }

    /** Fully close/hide the bubble. */
    close(): void {
        const wasVisible = this.state !== "hidden" && !!this.rootEl?.isConnected;
        this.setState("hidden");
        this.detachGlobalListeners();
        this.anchorEl = null;
        if (wasVisible && this.rootEl) {
            this.scheduleUnmount(this.rootEl);
        }
    }

    /** Get current state. */
    get bubbleState(): BubbleState {
        return this.state;
    }

    /** Check if bubble has content (visible or degraded). */
    get hasContent(): boolean {
        return this.state === "visible" || this.state === "degraded";
    }

    /** Clean up — remove DOM, detach listeners. */
    destroy(): void {
        this.detachGlobalListeners();
        this.cancelPendingUnmount();
        if (this.rootEl) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        document.getElementById(BUBBLE_CSS_ID)?.remove();
        this.containerEl = null;
        this.anchorEl = null;
        this.currentContent = null;
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
        this.unmountTimer = setTimeout(finalize, BubbleView.UNMOUNT_FALLBACK_MS);
    }

    private cancelPendingUnmount(): void {
        if (this.unmountTimer !== null) {
            clearTimeout(this.unmountTimer);
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
        const root = document.createElement("div");
        root.className = "pa-pagelet-bubble";
        root.setAttribute("data-state", "hidden");
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-label", "拾页");

        // Tail
        const tail = document.createElement("div");
        tail.className = "pa-pagelet-bubble-tail";
        root.appendChild(tail);

        // Header with close button
        const header = document.createElement("div");
        header.className = "pa-pagelet-bubble-header";

        const closeBtn = document.createElement("button");
        closeBtn.className = "pa-pagelet-bubble-close";
        closeBtn.setAttribute("title", "关闭");
        closeBtn.setAttribute("aria-label", "关闭");
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.close();
            this.options.callbacks.onDismiss();
        });
        header.appendChild(closeBtn);
        root.appendChild(header);

        // Items list (populated by renderContent)
        const items = document.createElement("ul");
        items.className = "pa-pagelet-bubble-items";
        root.appendChild(items);

        // Actions row (populated by renderContent)
        const actions = document.createElement("div");
        actions.className = "pa-pagelet-bubble-actions";
        root.appendChild(actions);

        return root;
    }

    // -----------------------------------------------------------------------
    // Content rendering
    // -----------------------------------------------------------------------

    private renderContent(content: BubbleContent): void {
        if (!this.rootEl) return;

        // Rebuild findings list
        const itemsEl = this.rootEl.querySelector(".pa-pagelet-bubble-items");
        if (itemsEl) {
            itemsEl.innerHTML = "";
            for (const finding of content.findings) {
                const li = document.createElement("li");

                const bullet = document.createElement("span");
                bullet.className = "pa-pagelet-bubble-bullet";
                li.appendChild(bullet);

                const textSpan = document.createElement("span");
                textSpan.textContent = finding.text;
                li.appendChild(textSpan);

                if (finding.sourceLink) {
                    const link = document.createElement("a");
                    link.className = "pa-pagelet-bubble-source-link";
                    link.textContent = finding.sourceTitle ?? finding.sourceLink;
                    link.setAttribute("href", "#");
                    link.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.options.callbacks.onSourceClick(finding.sourceLink!);
                    });
                    li.appendChild(link);
                }

                itemsEl.appendChild(li);
            }
        }

        // Rebuild action buttons
        const actionsEl = this.rootEl.querySelector(".pa-pagelet-bubble-actions");
        if (actionsEl) {
            actionsEl.innerHTML = "";
            for (const action of content.actions) {
                const btn = document.createElement("button");
                btn.className = "pa-pagelet-bubble-btn";
                if (action.primary) {
                    btn.classList.add("primary");
                }
                btn.textContent = action.label;
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    action.callback();
                });
                actionsEl.appendChild(btn);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Layout / positioning
    // -----------------------------------------------------------------------

    private applyDesktopLayout(anchorEl: HTMLElement): void {
        if (!this.rootEl) return;

        this.rootEl.classList.remove("pa-pagelet-bubble--mobile");

        const anchorRect = anchorEl.getBoundingClientRect();

        // Compute container offset for absolute positioning.
        const containerRect = this.containerEl?.getBoundingClientRect();
        const offsetX = containerRect?.left ?? 0;
        const offsetY = containerRect?.top ?? 0;
        // Account for container scroll (absolute pos is relative to content, not viewport)
        const scrollTop = this.containerEl?.scrollTop ?? 0;
        const scrollLeft = this.containerEl?.scrollLeft ?? 0;

        // Use a temporary measurement to get the bubble's natural size.
        this.rootEl.style.visibility = "hidden";
        this.rootEl.style.display = "block";
        this.rootEl.setAttribute("data-state", "visible");
        const bubbleRect = this.rootEl.getBoundingClientRect();
        this.rootEl.setAttribute("data-state", "hidden");
        this.rootEl.style.visibility = "";
        this.rootEl.style.display = "";

        const bubbleW = bubbleRect.width || 300;
        const bubbleH = bubbleRect.height || 200;
        const containerW = containerRect?.width ?? document.documentElement.clientWidth;

        // Place above anchor by default; flip below if not enough room.
        let placement: "above" | "below" = "above";
        let top = anchorRect.top - offsetY + scrollTop - bubbleH - ANCHOR_MARGIN;
        if (anchorRect.top - offsetY - bubbleH - ANCHOR_MARGIN < MIN_TOP_SPACE) {
            placement = "below";
            top = anchorRect.bottom - offsetY + scrollTop + ANCHOR_MARGIN;
        }

        // Center horizontally on anchor, clamped to container bounds.
        const anchorCenterX = anchorRect.left - offsetX + scrollLeft + anchorRect.width / 2;
        let left = anchorCenterX - bubbleW / 2;
        if (left < 8) left = 8;
        const maxLeft = containerW - bubbleW - 16;
        if (left > maxLeft) left = maxLeft;

        this.rootEl.style.top = `${top}px`;
        this.rootEl.style.left = `${left}px`;
        this.rootEl.style.right = "";
        this.rootEl.style.bottom = "";
        this.rootEl.setAttribute("data-placement", placement);

        // Position tail to point at anchor center
        const tail = this.rootEl.querySelector<HTMLElement>(".pa-pagelet-bubble-tail");
        if (tail) {
            const tailLeft = Math.max(16, Math.min(anchorCenterX - left - 7, bubbleW - 24));
            tail.style.left = `${tailLeft}px`;
        }
    }

    /** Lightweight reposition without measurement dance (safe during resize). */
    private repositionBubble(): void {
        if (!this.rootEl || !this.anchorEl || !this.containerEl) return;

        const anchorRect = this.anchorEl.getBoundingClientRect();
        const containerRect = this.containerEl.getBoundingClientRect();
        const offsetX = containerRect.left;
        const offsetY = containerRect.top;
        const scrollTop = this.containerEl.scrollTop;
        const scrollLeft = this.containerEl.scrollLeft;
        const bubbleW = this.rootEl.offsetWidth || 300;
        const bubbleH = this.rootEl.offsetHeight || 200;
        const containerW = containerRect.width;
        const placement = this.rootEl.getAttribute("data-placement") as "above" | "below" || "above";

        let top: number;
        if (placement === "below") {
            top = anchorRect.bottom - offsetY + scrollTop + ANCHOR_MARGIN;
        } else {
            top = anchorRect.top - offsetY + scrollTop - bubbleH - ANCHOR_MARGIN;
        }

        const anchorCenterX = anchorRect.left - offsetX + scrollLeft + anchorRect.width / 2;
        let left = anchorCenterX - bubbleW / 2;
        if (left < 8) left = 8;
        const maxLeft = containerW - bubbleW - 16;
        if (left > maxLeft) left = maxLeft;

        this.rootEl.style.top = `${top}px`;
        this.rootEl.style.left = `${left}px`;

        const tail = this.rootEl.querySelector<HTMLElement>(".pa-pagelet-bubble-tail");
        if (tail) {
            const tailLeft = Math.max(16, Math.min(anchorCenterX - left - 7, bubbleW - 24));
            tail.style.left = `${tailLeft}px`;
        }
    }

    private applyMobileLayout(): void {
        if (!this.rootEl) return;

        this.rootEl.classList.add("pa-pagelet-bubble--mobile");
        // Mobile: full-width bottom sheet. CSS handles positioning via
        // the --mobile modifier class. Clear any desktop inline styles.
        this.rootEl.style.top = "";
        this.rootEl.style.left = "";
        this.rootEl.style.right = "";
        this.rootEl.style.bottom = "";
        this.rootEl.removeAttribute("data-placement");
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
        this.attachTimerId = setTimeout(() => {
            this.attachTimerId = null;
            if (this.state === "hidden") return;
            document.addEventListener("click", this.handleDocumentClick, true);
            document.addEventListener("keydown", this.handleKeydown, true);
        }, 0);
        window.addEventListener("resize", this.handleResize);
    }

    private detachGlobalListeners(): void {
        if (this.attachTimerId !== null) {
            clearTimeout(this.attachTimerId);
            this.attachTimerId = null;
        }
        document.removeEventListener("click", this.handleDocumentClick, true);
        document.removeEventListener("keydown", this.handleKeydown, true);
        window.removeEventListener("resize", this.handleResize);
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

        // Click outside — degrade, don't close.
        if (this.state === "visible") {
            this.degrade();
        }
    }

    private onKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape") {
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
}

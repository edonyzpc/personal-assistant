/* Copyright 2023 edonyzpc */

/**
 * Pagelet -- Panel DOM lifecycle manager.
 *
 * The Panel is a side panel (~380px wide) that slides in from the right.
 * It provides scenario-adaptive layouts for deeper exploration:
 *
 *   - review:   Timeline of recent note activity with AI insights.
 *   - current:  Current note AI analysis.
 *   - discover: Connection map and related notes.
 *   - summary:  Periodic summary preview.
 *
 * Mobile mode (`body.is-mobile`):
 *   Full-screen overlay that slides up from the bottom.
 *   Footer with "expand to tab" is hidden on mobile.
 *
 * Why raw DOM instead of a framework:
 *   Same rationale as BubbleView.ts -- the Panel is a bounded component
 *   and the project already uses raw DOM for all pagelet UI.
 */

import { Component } from "obsidian";

import type {
    NoteConnection,
    PanelFinding,
    PanelLayoutType,
    PanelViewOptions,
} from "./types";

import {
    renderCurrentNoteAnalysis,
    renderDiscoveryLayout,
    renderReviewTimeline,
    renderSummaryPreview,
} from "./PanelLayouts";

import { pageletT, type PageletLocale } from "../../locales/pagelet";

function clearChildren(node: Element): void {
    node.textContent = "";
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

/** Detect mobile context using the Obsidian convention. */
function isMobile(): boolean {
    return document.body.classList.contains("is-mobile");
}

/** Layout type to i18n key mapping. */
const LAYOUT_TITLE_KEYS: Record<PanelLayoutType, string> = {
    review: "pagelet.panel.layout.review",
    current: "pagelet.panel.layout.current",
    discover: "pagelet.panel.layout.discover",
    summary: "pagelet.panel.layout.summary",
};

// ---------------------------------------------------------------------------
// PanelView
// ---------------------------------------------------------------------------

/**
 * Panel DOM lifecycle manager.
 *
 * Usage:
 *   const panel = new PanelView({ callbacks });
 *   panel.mount(document.body);
 *   panel.open("review", findings);
 *   // ... later
 *   panel.destroy();
 */
export class PanelView {
    private readonly options: PanelViewOptions;
    private readonly locale: PageletLocale;
    private rootEl: HTMLDivElement | null = null;
    private bodyEl: HTMLDivElement | null = null;
    private titleEl: HTMLHeadingElement | null = null;
    private saveBtnEl: HTMLButtonElement | null = null;
    private containerEl: HTMLElement | null = null;
    private _isOpen = false;
    private currentLayout: PanelLayoutType | null = null;
    private primaryButtonMode: "save" | "run" = "save";

    get currentLayoutType(): PanelLayoutType | null {
        return this.currentLayout;
    }
    private currentFindings: PanelFinding[] = [];
    /** Obsidian Component for MarkdownRenderer lifecycle management. */
    private renderComponent: Component | null = null;

    // Bound event handlers for cleanup.
    private readonly handleKeydown: (e: KeyboardEvent) => void;
    private readonly handleTouchStart: (e: TouchEvent) => void;
    private readonly handleTouchMove: (e: TouchEvent) => void;
    private readonly handleTouchEnd: (e: TouchEvent) => void;
    private touchStartY: number | null = null;
    /** Pending unmount-after-transition timer; cleared if the panel reopens. */
    private unmountTimer: ReturnType<typeof setTimeout> | null = null;
    /** Pending transitionend listener; cleared if the panel reopens. */
    private unmountTransitionHandler: ((e: TransitionEvent) => void) | null = null;
    /** Fallback timeout (ms) for transitionend in reduced-motion / hidden tabs. */
    private static readonly UNMOUNT_FALLBACK_MS = 400;

    constructor(options: PanelViewOptions) {
        this.options = options;
        this.locale = options.locale ?? "en";
        this.handleKeydown = this.onKeydown.bind(this);
        this.handleTouchStart = (e: TouchEvent) => {
            if (!isMobile()) return;
            const target = e.target instanceof Element ? e.target : null;
            if (!target?.closest(".pa-pagelet-panel-header")) return;
            this.touchStartY = e.touches[0].clientY;
        };
        this.handleTouchMove = (e: TouchEvent) => {
            if (this.touchStartY === null) return;
            if ((this.bodyEl?.scrollTop ?? 0) > 0) {
                this.touchStartY = null;
                return;
            }
            const dy = e.touches[0].clientY - this.touchStartY;
            if (dy > 80) {
                this.close();
                this.touchStartY = null;
            }
        };
        this.handleTouchEnd = () => { this.touchStartY = null; };
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Register the mount root. The Panel uses lazy DOM attachment:
     * the root element is built and appended only on `open()`, then
     * removed after the close transition. This keeps the workspace
     * free of full-height fixed overlays while idle (D037 progressive
     * disclosure) and guarantees Obsidian's window drag region is
     * never intercepted.
     */
    mount(containerEl: HTMLElement): void {
        this.containerEl = containerEl;
    }

    /** Build (if needed) and attach the panel root to the container. */
    private ensureMounted(): void {
        if (!this.containerEl) return;
        // A pending unmount may still hold the previous root in the DOM;
        // cancel it so we reuse the existing root and avoid double-mount.
        this.cancelPendingUnmount();
        if (!this.rootEl) {
            this.rootEl = this.buildDOM();
            this.containerEl.appendChild(this.rootEl);
        } else if (!this.rootEl.isConnected) {
            this.containerEl.appendChild(this.rootEl);
        }
    }

    /**
     * Open the panel with a specific layout and content.
     *
     * @param layoutType - determines which layout renderer to use
     * @param content    - findings to display
     * @param extra      - optional data (connections for discovery, markdown for summary)
     */
    open(
        layoutType: PanelLayoutType,
        content: PanelFinding[],
        extra?: { connections?: NoteConnection[]; markdown?: string },
    ): void {
        this.ensureMounted();
        if (!this.rootEl || !this.bodyEl || !this.titleEl) return;

        this.currentLayout = layoutType;
        this.currentFindings = content;
        this.updatePrimaryButtonState(layoutType, layoutType === "summary" || content.length > 0);
        this.titleEl.textContent =
            pageletT(LAYOUT_TITLE_KEYS[layoutType], this.locale) || layoutType;

        if (layoutType !== "summary") {
            this.renderComponent?.unload();
            this.renderComponent = null;
        }

        // Render layout
        switch (layoutType) {
            case "review":
                renderReviewTimeline(this.bodyEl, content, this.locale);
                break;
            case "current":
                renderCurrentNoteAnalysis(this.bodyEl, content, this.locale);
                break;
            case "discover":
                renderDiscoveryLayout(
                    this.bodyEl, content, extra?.connections, this.locale,
                );
                break;
            case "summary": {
                // Clean up previous render component
                this.renderComponent?.unload();
                this.renderComponent = new Component();
                this.renderComponent.load();

                renderSummaryPreview(
                    this.bodyEl,
                    extra?.markdown ?? "",
                    this.options.app,
                    this.renderComponent,
                    "",
                    this.locale,
                );
                break;
            }
        }

        // Force a layout flush so the initial `data-state="hidden"`
        // styles apply before flipping to `visible`; otherwise the
        // browser may collapse the transition into a single frame.
        void this.rootEl.offsetWidth;
        // Defer to next frame so the slide-in transition runs.
        const root = this.rootEl;
        this._isOpen = true;
        const show = () => {
            if (this._isOpen && this.rootEl === root && root.isConnected) {
                root.setAttribute("data-state", "visible");
            }
        };
        requestAnimationFrame(show);
        setTimeout(show, 0);
        this.attachGlobalListeners();
    }

    /** Close the panel. */
    close(): void {
        if (!this.rootEl) return;
        const root = this.rootEl;
        root.setAttribute("data-state", "hidden");
        this._isOpen = false;
        this.detachGlobalListeners();
        this.renderComponent?.unload();
        this.renderComponent = null;
        this.scheduleUnmount(root);
        this.options.callbacks.onClose();
    }

    /** Whether the panel is currently open. */
    get isOpen(): boolean {
        return this._isOpen;
    }

    /** Clean up -- remove DOM, detach listeners. */
    destroy(): void {
        this.detachGlobalListeners();
        this.cancelPendingUnmount();
        this.renderComponent?.unload();
        this.renderComponent = null;
        if (this.rootEl) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        this.bodyEl = null;
        this.titleEl = null;
        this.saveBtnEl = null;
        this.containerEl = null;
        this._isOpen = false;
        this.currentLayout = null;
    }

    // -----------------------------------------------------------------------
    // Lazy unmount helpers
    // -----------------------------------------------------------------------

    /**
     * Detach the panel root after the close transition completes so the
     * fixed full-height overlay no longer occupies the viewport (and
     * therefore cannot block Obsidian's titlebar drag region).
     */
    private scheduleUnmount(root: HTMLDivElement): void {
        this.cancelPendingUnmount();
        const finalize = () => {
            this.cancelPendingUnmount();
            // Only unmount if still hidden -- a re-open may have flipped
            // state back to visible while the transition was running.
            if (this.rootEl === root && root.getAttribute("data-state") === "hidden") {
                root.remove();
            }
        };
        const handler = (e: TransitionEvent) => {
            if (e.target !== root) return;
            if (e.propertyName !== "transform") return;
            finalize();
        };
        this.unmountTransitionHandler = handler;
        root.addEventListener("transitionend", handler);
        this.unmountTimer = setTimeout(finalize, PanelView.UNMOUNT_FALLBACK_MS);
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
        root.className = "pa-pagelet-panel";
        root.setAttribute("data-state", "hidden");
        root.setAttribute("role", "complementary");
        root.setAttribute("aria-label",
            pageletT("pagelet.panel.ariaLabel", this.locale));

        // Header
        const header = document.createElement("div");
        header.className = "pa-pagelet-panel-header";

        const title = document.createElement("h3");
        title.className = "pa-pagelet-panel-title";
        title.textContent = pageletT("pagelet.panel.title", this.locale);
        this.titleEl = title;
        header.appendChild(title);

        const actions = document.createElement("div");
        actions.className = "pa-pagelet-panel-header-actions";

        // Hints toggle button
        const hintsBtn = document.createElement("button");
        hintsBtn.className = "pa-pagelet-panel-icon-btn";
        hintsBtn.setAttribute("title",
            pageletT("pagelet.panel.hintsToggle.off", this.locale));
        hintsBtn.setAttribute("aria-label",
            pageletT("pagelet.panel.hintsToggle.off", this.locale));
        hintsBtn.setAttribute("aria-pressed", "false");
        hintsBtn.textContent = "\u{1F515}"; // bell with slash
        hintsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.options.callbacks.onToggleHints?.();
            const pressed = hintsBtn.getAttribute("aria-pressed") === "true";
            const nextPressed = !pressed;
            hintsBtn.setAttribute("aria-pressed", String(nextPressed));
            const label = pageletT(
                nextPressed ? "pagelet.panel.hintsToggle.on" : "pagelet.panel.hintsToggle.off",
                this.locale,
            );
            hintsBtn.setAttribute("title", label);
            hintsBtn.setAttribute("aria-label", label);
        });
        actions.appendChild(hintsBtn);

        // Expand to tab button
        const expandBtn = document.createElement("button");
        expandBtn.className = "pa-pagelet-panel-icon-btn pa-pagelet-panel-header-expand-btn";
        expandBtn.setAttribute("title",
            pageletT("pagelet.panel.expand", this.locale));
        expandBtn.setAttribute("aria-label",
            pageletT("pagelet.panel.expand", this.locale));
        expandBtn.textContent = "↗"; // ↗
        expandBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.options.callbacks.onExpandToTab();
        });
        actions.appendChild(expandBtn);

        // Close button
        const closeBtn = document.createElement("button");
        closeBtn.className = "pa-pagelet-panel-icon-btn";
        closeBtn.setAttribute("title",
            pageletT("pagelet.panel.close", this.locale));
        closeBtn.setAttribute("aria-label",
            pageletT("pagelet.panel.close", this.locale));
        closeBtn.textContent = "×"; // ×
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.close();
        });
        actions.appendChild(closeBtn);

        header.appendChild(actions);
        root.appendChild(header);

        // Body (scrollable content area)
        const body = document.createElement("div");
        body.className = "pa-pagelet-panel-body";
        this.bodyEl = body;
        root.appendChild(body);

        // Footer
        const footer = document.createElement("div");
        footer.className = "pa-pagelet-panel-footer";

        // Save button (accent-colored, before expand)
        const saveBtn = document.createElement("button");
        saveBtn.className = "pa-pagelet-panel-save-btn";
        saveBtn.textContent = pageletT("pagelet.panel.save", this.locale);
        saveBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (this.primaryButtonMode === "run") {
                if (!this.options.callbacks.onRunReview) return;
                saveBtn.disabled = true;
                saveBtn.setAttribute("aria-busy", "true");
                const previousLabel = saveBtn.textContent ?? "";
                saveBtn.textContent = pageletT("pagelet.panel.status.reviewingCurrent", this.locale);
                this.renderReviewProgress();
                try {
                    await this.options.callbacks.onRunReview();
                } finally {
                    if (this.saveBtnEl === saveBtn && this.primaryButtonMode === "run") {
                        saveBtn.disabled = false;
                        saveBtn.removeAttribute("aria-busy");
                        saveBtn.textContent = previousLabel;
                        if (this.currentLayout === "review" && this.currentFindings.length === 0 && this.bodyEl) {
                            renderReviewTimeline(this.bodyEl, this.currentFindings, this.locale);
                        }
                    }
                }
                return;
            }
            if (saveBtn.disabled) return;
            saveBtn.disabled = true;
            saveBtn.setAttribute("aria-busy", "true");
            const previousLabel = saveBtn.textContent ?? "";
            saveBtn.textContent = pageletT("pagelet.panel.status.saving", this.locale);
            try {
                await this.options.callbacks.onSaveAsReviewNote(this.currentFindings);
            } finally {
                if (this.saveBtnEl === saveBtn && this.primaryButtonMode === "save") {
                    saveBtn.disabled = false;
                    saveBtn.removeAttribute("aria-busy");
                    saveBtn.textContent = previousLabel;
                }
            }
        });
        this.saveBtnEl = saveBtn;
        footer.appendChild(saveBtn);

        const expandTabBtn = document.createElement("button");
        expandTabBtn.className = "pa-pagelet-panel-expand-btn";
        expandTabBtn.textContent =
            pageletT("pagelet.panel.expandToTab", this.locale);
        expandTabBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.options.callbacks.onExpandToTab();
        });
        footer.appendChild(expandTabBtn);
        root.appendChild(footer);

        return root;
    }

    private renderReviewProgress(): void {
        if (!this.bodyEl) return;
        clearChildren(this.bodyEl);

        const card = document.createElement("div");
        card.className = "pa-pagelet-panel-progress-card";
        card.setAttribute("role", "status");
        card.setAttribute("aria-live", "polite");

        const dot = document.createElement("div");
        dot.className = "pa-pagelet-panel-progress-dot";
        card.appendChild(dot);

        const text = document.createElement("div");
        text.textContent = pageletT("pagelet.panel.status.reviewingCurrent", this.locale);
        card.appendChild(text);

        this.bodyEl.appendChild(card);
    }

    // -----------------------------------------------------------------------
    // Global event handlers
    // -----------------------------------------------------------------------

    private attachGlobalListeners(): void {
        document.addEventListener("keydown", this.handleKeydown, true);
        if (this.rootEl) {
            this.rootEl.addEventListener("touchstart", this.handleTouchStart, { passive: true });
            this.rootEl.addEventListener("touchmove", this.handleTouchMove, { passive: true });
            this.rootEl.addEventListener("touchend", this.handleTouchEnd, { passive: true });
        }
    }

    private detachGlobalListeners(): void {
        document.removeEventListener("keydown", this.handleKeydown, true);
        if (this.rootEl) {
            this.rootEl.removeEventListener("touchstart", this.handleTouchStart);
            this.rootEl.removeEventListener("touchmove", this.handleTouchMove);
            this.rootEl.removeEventListener("touchend", this.handleTouchEnd);
        }
    }

    private updatePrimaryButtonState(layoutType: PanelLayoutType, saveEnabled: boolean): void {
        if (!this.saveBtnEl) return;
        const canRunReview = !saveEnabled && layoutType === "review" && Boolean(this.options.callbacks.onRunReview);
        this.primaryButtonMode = canRunReview ? "run" : "save";

        if (canRunReview) {
            this.saveBtnEl.disabled = false;
            this.saveBtnEl.removeAttribute("aria-busy");
            this.saveBtnEl.setAttribute("aria-disabled", "false");
            this.saveBtnEl.textContent = pageletT("pagelet.panel.action.reviewCurrent", this.locale);
            return;
        }

        this.saveBtnEl.disabled = !saveEnabled;
        this.saveBtnEl.removeAttribute("aria-busy");
        this.saveBtnEl.setAttribute("aria-disabled", String(!saveEnabled));
        this.saveBtnEl.textContent = pageletT("pagelet.panel.save", this.locale);
    }

    private onKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape" && this._isOpen) {
            e.preventDefault();
            e.stopPropagation();
            this.close();
        }
    }
}

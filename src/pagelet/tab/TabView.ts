/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 -- Tab (full workspace) DOM lifecycle manager.
 *
 * The Tab is a full-screen overlay that serves as a full editor tab
 * for complex exploration. It renders:
 *
 *   - Overview section (summary card with tag chips)
 *   - Theme clustering (cards grouped by AI-detected themes)
 *   - Action suggestions (insight cards with numbered recommendations)
 *
 * Mobile: Tab does not apply on mobile -- Panel already takes full
 * screen. The `open()` method shows a Notice and returns early.
 *
 * Why raw DOM instead of a framework:
 *   Same rationale as BubbleView.ts and PanelView.ts -- bounded
 *   component, consistent with the project's existing raw DOM pattern.
 */

import { Notice } from "obsidian";

import type { PanelFinding } from "../panel/types";
import type { TabSection } from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";

// ---------------------------------------------------------------------------
// CSS -- injected once via <style> on first mount
// ---------------------------------------------------------------------------

const TAB_CSS_ID = "pa-pagelet-tab-styles";

const TAB_CSS = /* css */ `
/* ---- Tab container ---- */
.pa-pagelet-tab {
    position: fixed;
    inset: 0;
    background: var(--background-primary, #1e1e1e);
    z-index: 950;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
    display: flex;
    flex-direction: column;
    font-family: var(--font-interface, inherit);
    color: var(--text-normal, #dcddde);
    box-sizing: border-box;
}

.pa-pagelet-tab[data-state="visible"] {
    opacity: 1;
    pointer-events: auto;
}

/* ---- Header ---- */
.pa-pagelet-tab-header {
    padding: 12px 20px;
    border-bottom: 1px solid var(--background-modifier-border, #3a3a3a);
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
    background: var(--background-secondary, #252525);
}

.pa-pagelet-tab-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 6px;
    background: var(--background-modifier-hover, #2d2d2d);
    font-size: 13px;
    color: var(--text-normal, #dcddde);
    font-weight: 500;
}

.pa-pagelet-tab-pill svg {
    flex-shrink: 0;
}

.pa-pagelet-tab-close {
    margin-left: auto;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-faint, #666);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    transition: all 0.15s;
    font-family: inherit;
    padding: 0;
    line-height: 1;
}

.pa-pagelet-tab-close:hover {
    background: var(--background-modifier-hover, #2d2d2d);
    color: var(--text-normal, #dcddde);
}

/* ---- Body ---- */
.pa-pagelet-tab-body {
    flex: 1;
    overflow-y: auto;
    padding: 32px 48px;
    max-width: 800px;
    margin: 0 auto;
}

/* ---- Sections ---- */
.pa-pagelet-tab-section {
    margin-bottom: 32px;
}

.pa-pagelet-tab-section h2 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-normal, #dcddde);
}

.pa-pagelet-tab-section h4 {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-normal, #dcddde);
    margin-bottom: 8px;
}

/* ---- Insight cards ---- */
.pa-pagelet-tab-insight-card {
    background: var(--background-secondary-alt, #232323);
    border: 1px solid var(--background-modifier-border, #3a3a3a);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
}

.pa-pagelet-tab-insight-card p {
    font-size: 13px;
    color: var(--text-muted, #999);
    line-height: 1.7;
    margin: 0;
}

/* ---- Tag row ---- */
.pa-pagelet-tab-tag-row {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
}

.pa-pagelet-tab-tag-chip {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    background: var(--background-secondary, #252525);
    color: var(--text-faint, #666);
    border: 1px solid var(--background-modifier-border, #3a3a3a);
}

/* ---- Light theme ---- */
.theme-light .pa-pagelet-tab,
[data-theme="light"] .pa-pagelet-tab {
    box-shadow: none;
}

/* ---- Reduced motion ---- */
@media (prefers-reduced-motion: reduce) {
    .pa-pagelet-tab {
        transition-duration: 0.01s !important;
    }
}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inject Tab CSS into `<head>` (idempotent). */
function injectStyles(): void {
    if (document.getElementById(TAB_CSS_ID)) return;
    const style = document.createElement("style");
    style.id = TAB_CSS_ID;
    style.textContent = TAB_CSS;
    document.head.appendChild(style);
}

/** Detect mobile context. */
function isMobile(): boolean {
    return document.body.classList.contains("is-mobile");
}

/** Create a DOM element with optional class and text. */
function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Build the Pet mini SVG icon for the tab pill. */
function buildPillSvg(): SVGElement {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 44 44");
    svg.setAttribute("aria-hidden", "true");

    const body = document.createElementNS(svgNS, "path");
    body.setAttribute("d", "M10.2 8.3 L30 8 L36.1 14.2 L36 37.8 L10 38.1 Z");
    body.setAttribute("fill", "none");
    body.setAttribute("stroke", "currentColor");
    body.setAttribute("stroke-width", "1.6");
    body.setAttribute("stroke-linejoin", "round");
    body.setAttribute("stroke-linecap", "round");
    svg.appendChild(body);

    const fold = document.createElementNS(svgNS, "path");
    fold.setAttribute("d", "M30 8.1 L29.9 14.2 L36 14");
    fold.setAttribute("fill", "none");
    fold.setAttribute("stroke", "currentColor");
    fold.setAttribute("stroke-width", "1.6");
    fold.setAttribute("stroke-linejoin", "round");
    fold.setAttribute("stroke-linecap", "round");
    svg.appendChild(fold);

    return svg;
}

// ---------------------------------------------------------------------------
// TabView
// ---------------------------------------------------------------------------

/**
 * Tab (full workspace) DOM lifecycle manager.
 *
 * Usage:
 *   const tab = new TabView(() => { ... on close ... });
 *   tab.mount(document.body);
 *   tab.open("Title", findings);
 *   // ... later
 *   tab.destroy();
 */
export class TabView {
    private readonly onCloseCallback: () => void;
    private readonly locale: PageletLocale;
    private rootEl: HTMLDivElement | null = null;
    private bodyEl: HTMLDivElement | null = null;
    private titleEl: HTMLSpanElement | null = null;
    private containerEl: HTMLElement | null = null;
    private _isOpen = false;

    // Bound event handler for cleanup.
    private readonly handleKeydown: (e: KeyboardEvent) => void;
    /** Pending unmount-after-transition timer; cleared if the tab reopens. */
    private unmountTimer: ReturnType<typeof setTimeout> | null = null;
    /** Pending transitionend listener; cleared if the tab reopens. */
    private unmountTransitionHandler: ((e: TransitionEvent) => void) | null = null;
    /** Fallback timeout (ms) for transitionend in reduced-motion / hidden tabs. */
    private static readonly UNMOUNT_FALLBACK_MS = 400;

    constructor(onClose: () => void, locale: PageletLocale = "en") {
        this.onCloseCallback = onClose;
        this.locale = locale;
        this.handleKeydown = this.onKeydown.bind(this);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Register the mount root. The Tab uses lazy DOM attachment: the
     * full-viewport overlay (`position: fixed; inset: 0`) is built and
     * appended only on `open()`, then removed after the close fade so
     * it never intercepts Obsidian's titlebar drag region while idle
     * (D037 progressive disclosure).
     */
    mount(containerEl: HTMLElement): void {
        injectStyles();
        this.containerEl = containerEl;
    }

    /** Build (if needed) and attach the tab root to the container. */
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

    /**
     * Open the tab with a title and content.
     *
     * On mobile, shows a Notice instead (Panel already covers full screen).
     *
     * @param title   - displayed in the header pill
     * @param content - findings to display, or TabSection[] for structured content
     */
    open(
        title: string,
        content: PanelFinding[] | TabSection[],
    ): void {
        if (isMobile()) {
            new Notice(
                pageletT("pagelet.tab.mobileNotice", this.locale), 3000,
            );
            return;
        }

        this.ensureMounted();
        if (!this.rootEl || !this.bodyEl || !this.titleEl) return;

        this.titleEl.textContent =
            pageletT("pagelet.tab.titlePrefix", this.locale, { title });
        this.renderContent(content);
        // Force layout flush so the hidden-state styles apply before
        // the visibility transition runs.
        void this.rootEl.offsetWidth;
        const root = this.rootEl;
        requestAnimationFrame(() => {
            if (root.isConnected) root.setAttribute("data-state", "visible");
        });
        this._isOpen = true;
        this.attachGlobalListeners();
    }

    /** Close the tab. */
    close(): void {
        if (!this.rootEl) return;
        const root = this.rootEl;
        root.setAttribute("data-state", "hidden");
        this._isOpen = false;
        this.detachGlobalListeners();
        this.scheduleUnmount(root);
        this.onCloseCallback();
    }

    /** Whether the tab is currently open. */
    get isOpen(): boolean {
        return this._isOpen;
    }

    /** Clean up -- remove DOM, detach listeners. */
    destroy(): void {
        this.detachGlobalListeners();
        this.cancelPendingUnmount();
        if (this.rootEl) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        document.getElementById(TAB_CSS_ID)?.remove();
        this.bodyEl = null;
        this.titleEl = null;
        this.containerEl = null;
        this._isOpen = false;
    }

    // -----------------------------------------------------------------------
    // Lazy unmount helpers
    // -----------------------------------------------------------------------

    /**
     * Detach the tab root after the close transition completes so the
     * full-viewport overlay no longer occupies the screen (and therefore
     * cannot block Obsidian's window drag region).
     */
    private scheduleUnmount(root: HTMLDivElement): void {
        this.cancelPendingUnmount();
        const finalize = () => {
            this.cancelPendingUnmount();
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
        this.unmountTimer = setTimeout(finalize, TabView.UNMOUNT_FALLBACK_MS);
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
        root.className = "pa-pagelet-tab";
        root.setAttribute("data-state", "hidden");
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-label",
            pageletT("pagelet.tab.ariaLabel", this.locale));

        // Header
        const header = el("div", "pa-pagelet-tab-header");

        const pill = el("div", "pa-pagelet-tab-pill");
        pill.appendChild(buildPillSvg());
        const titleSpan = el("span", undefined,
            pageletT("pagelet.tab.title", this.locale));
        this.titleEl = titleSpan;
        pill.appendChild(titleSpan);
        header.appendChild(pill);

        const closeBtn = el("button", "pa-pagelet-tab-close", "×");
        closeBtn.setAttribute("aria-label",
            pageletT("pagelet.panel.close", this.locale));
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.close();
        });
        header.appendChild(closeBtn);
        root.appendChild(header);

        // Body
        const body = el("div", "pa-pagelet-tab-body");
        this.bodyEl = body;
        root.appendChild(body);

        return root;
    }

    // -----------------------------------------------------------------------
    // Content rendering
    // -----------------------------------------------------------------------

    private renderContent(content: PanelFinding[] | TabSection[]): void {
        if (!this.bodyEl) return;
        this.bodyEl.innerHTML = "";

        if (content.length === 0) return;

        // Detect whether content is TabSection[] or PanelFinding[]
        if (isTabSections(content)) {
            this.renderTabSections(content);
        } else {
            this.renderFromFindings(content as PanelFinding[]);
        }
    }

    /** Render structured TabSection content. */
    private renderTabSections(sections: TabSection[]): void {
        if (!this.bodyEl) return;

        for (const section of sections) {
            const sectionEl = el("div", "pa-pagelet-tab-section");
            sectionEl.appendChild(el("h2", undefined, section.title));

            for (const card of section.cards) {
                const cardEl = el("div", "pa-pagelet-tab-insight-card");

                if (card.title) {
                    cardEl.appendChild(el("h4", undefined, card.title));
                }

                const bodyP = el("p");
                bodyP.textContent = card.body;
                cardEl.appendChild(bodyP);

                if (card.tags && card.tags.length > 0) {
                    const tagRow = el("div", "pa-pagelet-tab-tag-row");
                    for (const tag of card.tags) {
                        tagRow.appendChild(
                            el("span", "pa-pagelet-tab-tag-chip", tag),
                        );
                    }
                    cardEl.appendChild(tagRow);
                }

                sectionEl.appendChild(cardEl);
            }

            this.bodyEl.appendChild(sectionEl);
        }
    }

    /**
     * Render PanelFinding[] content as an auto-generated layout:
     * overview section + findings grouped into theme cards + action suggestions.
     */
    private renderFromFindings(findings: PanelFinding[]): void {
        if (!this.bodyEl) return;

        // Overview section
        const overviewSection = el("div", "pa-pagelet-tab-section");
        overviewSection.appendChild(el("h2", undefined,
            pageletT("pagelet.tab.overview", this.locale)));

        const overviewCard = el("div", "pa-pagelet-tab-insight-card");
        const overviewP = el("p");
        overviewP.textContent = pageletT(
            "pagelet.tab.overview.summary", this.locale,
            { count: findings.length },
        );
        overviewCard.appendChild(overviewP);

        // Tag chips for stats
        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(
            el("span", "pa-pagelet-tab-tag-chip",
                pageletT("pagelet.tab.tag.findings", this.locale,
                    { count: findings.length })),
        );
        const withInsight = findings.filter(f => f.insightText).length;
        if (withInsight > 0) {
            tagRow.appendChild(
                el("span", "pa-pagelet-tab-tag-chip",
                    pageletT("pagelet.tab.tag.insights", this.locale,
                        { count: withInsight })),
            );
        }
        const withSource = findings.filter(f => f.sourceFile).length;
        if (withSource > 0) {
            tagRow.appendChild(
                el("span", "pa-pagelet-tab-tag-chip",
                    pageletT("pagelet.tab.tag.sources", this.locale,
                        { count: withSource })),
            );
        }
        overviewCard.appendChild(tagRow);
        overviewSection.appendChild(overviewCard);
        this.bodyEl.appendChild(overviewSection);

        // Findings as individual insight cards
        if (findings.length > 0) {
            const findingsSection = el("div", "pa-pagelet-tab-section");
            findingsSection.appendChild(el("h2", undefined,
                pageletT("pagelet.tab.findings", this.locale)));

            for (let i = 0; i < findings.length; i++) {
                const f = findings[i];
                const card = el("div", "pa-pagelet-tab-insight-card");

                if (f.title) {
                    card.appendChild(el("h4", undefined, f.title));
                }

                const desc = el("p");
                desc.textContent = f.insightText ?? f.description;
                card.appendChild(desc);

                if (f.sourceFile) {
                    const sourceTag = el("div", "pa-pagelet-tab-tag-row");
                    sourceTag.appendChild(
                        el("span", "pa-pagelet-tab-tag-chip",
                            f.sourceTitle ?? f.sourceFile),
                    );
                    card.appendChild(sourceTag);
                }

                findingsSection.appendChild(card);
            }

            this.bodyEl.appendChild(findingsSection);
        }
    }

    // -----------------------------------------------------------------------
    // Global event handlers
    // -----------------------------------------------------------------------

    private attachGlobalListeners(): void {
        document.addEventListener("keydown", this.handleKeydown, true);
    }

    private detachGlobalListeners(): void {
        document.removeEventListener("keydown", this.handleKeydown, true);
    }

    private onKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape" && this._isOpen) {
            e.preventDefault();
            e.stopPropagation();
            this.close();
        }
    }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** Check if content is TabSection[] (has `cards` property on first element). */
function isTabSections(
    content: PanelFinding[] | TabSection[],
): content is TabSection[] {
    return (
        content.length > 0 &&
        "cards" in content[0] &&
        Array.isArray((content[0] as TabSection).cards)
    );
}

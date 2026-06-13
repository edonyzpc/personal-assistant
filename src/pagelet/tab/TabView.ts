/* Copyright 2023 edonyzpc */

/**
 * Pagelet -- detail view content DOM lifecycle manager.
 *
 * The detail view content is hosted by Obsidian's native WorkspaceLeaf
 * via PageletDetailView. This renderer owns only the view content:
 *
 *   - Overview section (summary card with tag chips)
 *   - Theme clustering (cards grouped by AI-detected themes)
 *   - Action suggestions (insight cards with numbered recommendations)
 *
 * Why raw DOM instead of a framework:
 *   Same rationale as BubbleView.ts and PanelView.ts -- bounded
 *   component, consistent with the project's existing raw DOM pattern.
 */

import type { PanelFinding } from "../panel/types";
import type { TabSection } from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";

// ---------------------------------------------------------------------------
// CSS -- injected once via <style> on first mount
// ---------------------------------------------------------------------------

const TAB_CSS_ID = "pa-pagelet-tab-styles";
let tabStyleRefCount = 0;

const TAB_CSS = /* css */ `
/* ---- Tab container ---- */
.pa-pagelet-tab {
    background: var(--background-primary, #1e1e1e);
    min-height: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-interface, inherit);
    color: var(--text-normal, #dcddde);
    box-sizing: border-box;
}

/* ---- Body ---- */
.pa-pagelet-tab-body {
    flex: 1;
    overflow-y: auto;
    padding: 32px 48px;
    max-width: 800px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
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

.pa-pagelet-tab-empty-card {
    background: var(--background-secondary-alt, #232323);
    border: 1px solid var(--background-modifier-border, #3a3a3a);
    border-radius: 8px;
    padding: 20px;
}

.pa-pagelet-tab-empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-normal, #dcddde);
    margin-bottom: 8px;
}

.pa-pagelet-tab-empty-body {
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-muted, #999);
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
    max-width: 100%;
    overflow-wrap: anywhere;
}

/* ---- Light theme ---- */
.theme-light .pa-pagelet-tab,
[data-theme="light"] .pa-pagelet-tab {
    box-shadow: none;
}

/* ---- Reduced motion ---- */
@media (prefers-reduced-motion: reduce) {
    .pa-pagelet-tab {
        scroll-behavior: auto !important;
    }
}

@media (max-width: 720px) {
    .pa-pagelet-tab-body {
        padding: 16px;
        max-width: none;
    }
}

body.is-mobile .pa-pagelet-tab-body {
    padding: 16px;
    max-width: none;
}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inject Tab CSS into `<head>` (idempotent). */
function injectStyles(): void {
    const existing = document.getElementById(TAB_CSS_ID);
    if (existing) {
        if (existing.textContent !== TAB_CSS) {
            existing.textContent = TAB_CSS;
        }
        return;
    }
    const style = document.createElement("style");
    style.id = TAB_CSS_ID;
    style.textContent = TAB_CSS;
    document.head.appendChild(style);
}

function retainStyles(): void {
    tabStyleRefCount += 1;
    injectStyles();
}

function releaseStyles(): void {
    tabStyleRefCount = Math.max(0, tabStyleRefCount - 1);
    if (tabStyleRefCount === 0) {
        document.getElementById(TAB_CSS_ID)?.remove();
    }
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

// ---------------------------------------------------------------------------
// TabView
// ---------------------------------------------------------------------------

/**
 * Pagelet detail content DOM lifecycle manager.
 *
 * Usage:
 *   const tab = new TabView("en");
 *   tab.mount(itemView.contentEl);
 *   tab.open("Title", findings);
 *   // ... later
 *   tab.destroy();
 */
export class TabView {
    private locale: PageletLocale;
    private rootEl: HTMLDivElement | null = null;
    private bodyEl: HTMLDivElement | null = null;
    private containerEl: HTMLElement | null = null;
    private hasStyleRef = false;
    private _isOpen = false;

    constructor(locale: PageletLocale = "en") {
        this.locale = locale;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Register the mount root. The native WorkspaceLeaf owns the tab chrome;
     * this renderer appends only content under the leaf's `view-content`.
     */
    mount(containerEl: HTMLElement): void {
        if (!this.hasStyleRef) {
            retainStyles();
            this.hasStyleRef = true;
        }
        this.containerEl = containerEl;
    }

    /** Build (if needed) and attach the tab root to the container. */
    private ensureMounted(): void {
        if (!this.containerEl) return;
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
     * @param title   - used as the content region aria-label
     * @param content - findings to display, or TabSection[] for structured content
     */
    open(
        title: string,
        content: PanelFinding[] | TabSection[],
    ): void {
        this.ensureMounted();
        if (!this.rootEl || !this.bodyEl) return;

        this.rootEl.setAttribute("aria-label", title);
        this.renderContent(content);
        this._isOpen = true;
    }

    /** Update locale before the next render. */
    setLocale(locale: PageletLocale): void {
        this.locale = locale;
    }

    /** Whether the tab is currently open. */
    get isOpen(): boolean {
        return this._isOpen;
    }

    /** Clean up -- remove DOM, detach listeners. */
    destroy(): void {
        if (this.rootEl) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        if (this.hasStyleRef) {
            releaseStyles();
            this.hasStyleRef = false;
        }
        this.bodyEl = null;
        this.containerEl = null;
        this._isOpen = false;
    }

    // -----------------------------------------------------------------------
    // DOM construction
    // -----------------------------------------------------------------------

    private buildDOM(): HTMLDivElement {
        const root = document.createElement("div");
        root.className = "pa-pagelet-tab";
        root.setAttribute("role", "region");
        root.setAttribute("aria-label",
            pageletT("pagelet.tab.ariaLabel", this.locale));

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

        if (content.length === 0) {
            this.renderEmptyState();
            return;
        }

        // Detect whether content is TabSection[] or PanelFinding[]
        if (isTabSections(content)) {
            this.renderTabSections(content);
        } else {
            this.renderFromFindings(content as PanelFinding[]);
        }
    }

    /** Render an explicit no-content state instead of a blank detail view. */
    private renderEmptyState(): void {
        if (!this.bodyEl) return;

        const section = el("div", "pa-pagelet-tab-section");
        section.appendChild(el("h2", undefined,
            pageletT("pagelet.tab.overview", this.locale)));

        const card = el("div", "pa-pagelet-tab-empty-card");
        card.appendChild(el("div", "pa-pagelet-tab-empty-title",
            pageletT("pagelet.tab.empty.title", this.locale)));
        card.appendChild(el("div", "pa-pagelet-tab-empty-body",
            pageletT("pagelet.tab.empty.body", this.locale)));
        section.appendChild(card);

        this.bodyEl.appendChild(section);
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

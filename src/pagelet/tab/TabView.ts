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

import { Component } from "obsidian";
import type { App } from "obsidian";

import type { GeneratedReviewNote, WriteResult } from "../output/types";
import type { PanelFinding } from "../panel/types";
import type { PageletDetailPayload, TabSection } from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import { clearChildren, el } from "../dom-utils";
import { renderDiscoveryLayout, renderSummaryPreview } from "../panel/PanelLayouts";

interface TabViewOptions {
    app?: App;
    onConnectionNodeClick?: (noteName: string, sourcePath?: string) => void;
    onSaveSummaryNote?: (note: GeneratedReviewNote) => Promise<WriteResult>;
}

type TabOpenOptions = Pick<PageletDetailPayload, "layoutType" | "extra" | "sourcePath" | "summarySaveNote" | "restoredFromState">;

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
    private _isOpen = false;
    private readonly options: TabViewOptions;
    private renderComponent: Component | null = null;

    constructor(locale: PageletLocale = "en", options: TabViewOptions = {}) {
        this.locale = locale;
        this.options = options;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Register the mount root. The native WorkspaceLeaf owns the tab chrome;
     * this renderer appends only content under the leaf's `view-content`.
     */
    mount(containerEl: HTMLElement): void {
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
        options: TabOpenOptions = {},
    ): void {
        this.ensureMounted();
        if (!this.rootEl || !this.bodyEl) return;

        this.rootEl.setAttribute("aria-label", title);
        this.renderContent(content, options);
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
        this.unloadRenderComponent();
        if (this.rootEl) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        this.bodyEl = null;
        this.containerEl = null;
        this._isOpen = false;
    }

    // -----------------------------------------------------------------------
    // DOM construction
    // -----------------------------------------------------------------------

    private buildDOM(): HTMLDivElement {
        const root = el("div");
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

    private renderContent(
        content: PanelFinding[] | TabSection[],
        options: TabOpenOptions = {},
    ): void {
        if (!this.bodyEl) return;
        clearChildren(this.bodyEl);

        if (options.restoredFromState) {
            this.unloadRenderComponent();
            this.renderRestoredState();
            return;
        }

        if (options.layoutType === "summary") {
            const markdown = options.extra?.markdown;
            if (typeof markdown === "string" && markdown.trim().length > 0) {
                this.renderSummaryContent(markdown, options);
            } else {
                this.unloadRenderComponent();
                this.renderEmptyState();
            }
            return;
        }

        this.unloadRenderComponent();

        if (options.layoutType === "discover" && !isTabSections(content)) {
            renderDiscoveryLayout(
                this.bodyEl,
                content as PanelFinding[],
                options.extra?.connections,
                this.locale,
                {
                    sourcePath: options.sourcePath,
                    onConnectionNodeClick: this.options.onConnectionNodeClick,
                },
            );
            return;
        }

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

    /** Render state restored from Obsidian without hidden full AI output. */
    private renderRestoredState(): void {
        if (!this.bodyEl) return;

        const section = el("div", "pa-pagelet-tab-section");
        section.appendChild(el("h2", undefined,
            pageletT("pagelet.tab.overview", this.locale)));

        const card = el("div", "pa-pagelet-tab-empty-card");
        card.appendChild(el("div", "pa-pagelet-tab-empty-title",
            pageletT("pagelet.tab.restored.title", this.locale)));
        card.appendChild(el("div", "pa-pagelet-tab-empty-body",
            pageletT("pagelet.tab.restored.body", this.locale)));
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

    private renderSummaryContent(markdown: string, options: TabOpenOptions): void {
        if (!this.bodyEl) return;
        this.unloadRenderComponent();
        this.renderComponent = new Component();
        this.renderComponent.load();

        renderSummaryPreview(
            this.bodyEl,
            markdown,
            this.options.app,
            this.renderComponent,
            options.sourcePath ?? "",
            this.locale,
        );
        this.renderSummaryActions(options.summarySaveNote);
    }

    private renderSummaryActions(summarySaveNote?: GeneratedReviewNote): void {
        if (!this.bodyEl || !summarySaveNote || !this.options.onSaveSummaryNote) return;

        const actions = el("div", "pa-pagelet-tab-summary-actions");
        const saveBtn = el("button", "pa-pagelet-tab-summary-save", pageletT("pagelet.panel.save", this.locale));
        saveBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            if (saveBtn.disabled) return;
            saveBtn.disabled = true;
            saveBtn.setAttribute("aria-busy", "true");
            saveBtn.textContent = pageletT("pagelet.panel.status.saving", this.locale);

            const result = await this.options.onSaveSummaryNote?.(summarySaveNote);
            saveBtn.removeAttribute("aria-busy");
            if (result?.success) {
                saveBtn.textContent = pageletT("pagelet.tab.summarySaved", this.locale);
                saveBtn.setAttribute("aria-disabled", "true");
                return;
            }

            saveBtn.disabled = false;
            saveBtn.setAttribute("aria-disabled", "false");
            saveBtn.textContent = pageletT("pagelet.panel.save", this.locale);
        });
        actions.appendChild(saveBtn);
        this.bodyEl.appendChild(actions);
    }

    private unloadRenderComponent(): void {
        this.renderComponent?.unload();
        this.renderComponent = null;
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

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
import { confirmUserAction } from "../../confirm";

import type { GeneratedReviewNote, WriteResult } from "../output/types";
import type { PanelFinding } from "../panel/types";
import type { PageletDetailPayload, TabEntryReason, TabSection } from "./types";
import {
    type ContextPagerState,
    type GraphDiscoveryItem,
    type MaintenanceMoveApplyResult,
    type MaintenanceMoveUndoResult,
    type MaintenanceProposal,
    type QuietRecallCandidate,
    type QuietRecallSaveResult,
    type ReviewQueueItem,
} from "../../pa";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import { clearChildren, el, renderEmptyCard } from "../dom-utils";
import { renderDiscoveryLayout, renderSummaryPreview } from "../panel/PanelLayouts";
import type {
    MaintenanceActionUiState,
    MemoryCandidateActionState,
    MemoryCandidateActionResult,
    QuietRecallLinkState,
    QuietRecallLinkResult,
    QuietRecallSaveState,
    TabSectionCallbacks,
    TabSectionRenderer,
} from "./sections/types";
import { MemoryGovernanceSection } from "./sections/MemoryGovernanceSection";
import { MaintenanceReviewSection } from "./sections/MaintenanceReviewSection";
import { QuietRecallSection } from "./sections/QuietRecallSection";

interface TabViewOptions {
    app?: App;
    onConnectionNodeClick?: (noteName: string, sourcePath?: string) => void;
    onSourcePathClick?: (path: string) => void;
    onSaveSummaryNote?: (note: GeneratedReviewNote) => Promise<WriteResult>;
    onApplyMaintenanceProposal?: (proposal: MaintenanceProposal) => Promise<MaintenanceMoveApplyResult>;
    onUndoMaintenanceAction?: (actionId: string) => Promise<MaintenanceMoveUndoResult>;
    onConfirmMemoryCandidate?: (item: ReviewQueueItem) => Promise<MemoryCandidateActionResult>;
    onDismissMemoryCandidate?: (item: ReviewQueueItem) => Promise<MemoryCandidateActionResult>;
    onSaveQuietRecallAsInsight?: (candidate: QuietRecallCandidate) => Promise<QuietRecallSaveResult>;
    onLinkRecallCandidate?: (candidate: QuietRecallCandidate, currentPath?: string) => Promise<QuietRecallLinkResult>;
    onOpenSettings?: () => void;
}

type TabOpenOptions = Pick<PageletDetailPayload, "layoutType" | "extra" | "sourcePath" | "summarySaveNote" | "restoredFromState" | "entryReason">;
type DetailExtra = NonNullable<PageletDetailPayload["extra"]>;

let tabLabelSequence = 0;

const ENTRY_REASON_TO_PRIMARY_SECTION: Partial<Record<TabEntryReason, string>> = {
    "maintenance": "maintenance",
    "quiet-recall": "quiet-recall",
    "graph-discovery": "graph-discovery",
    "pattern-detection": "pattern-detection",
};

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
    private labelEl: HTMLElement | null = null;
    private containerEl: HTMLElement | null = null;
    private _isOpen = false;
    private readonly options: TabViewOptions;
    private renderComponent: Component | null = null;
    private currentContent: PanelFinding[] | TabSection[] = [];
    private currentOptions: TabOpenOptions = {};
    private readonly sectionRenderers: TabSectionRenderer[] = [];
    private sectionsExpanded = false;
    private readonly dismissedPatternIds = new Set<string>();
    private readonly memoryCandidateActionState = new Map<string, MemoryCandidateActionState>();
    private readonly maintenanceActionState = new Map<string, MaintenanceActionUiState>();
    private readonly quietRecallSaveState = new Map<string, QuietRecallSaveState>();
    private readonly quietRecallLinkState = new Map<string, QuietRecallLinkState>();
    private memoryDigestDeferred = false;
    private actionStateGeneration = 0;
    private disposed = false;

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
     * @param title   - used as the content region's accessible name
     * @param content - findings to display, or TabSection[] for structured content
     */
    open(
        title: string,
        content: PanelFinding[] | TabSection[],
        options: TabOpenOptions = {},
    ): void {
        this.ensureMounted();
        if (!this.rootEl || !this.bodyEl) return;

        this.disposed = false;
        if (this.currentContent !== content || this.currentOptions !== options) {
            this.clearSectionActionState();
        }
        this.currentContent = content;
        this.currentOptions = options;
        if (this.labelEl) {
            this.labelEl.textContent = title;
        }
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
        this.disposed = true;
        this.unloadRenderComponent();
        this.destroySectionRenderers();
        if (this.rootEl) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        this.bodyEl = null;
        this.labelEl = null;
        this.containerEl = null;
        this._isOpen = false;
        this.dismissedPatternIds.clear();
        this.clearSectionActionState();
    }

    private destroySectionRenderers(): void {
        for (const renderer of this.sectionRenderers) {
            renderer.destroy();
        }
        this.sectionRenderers.length = 0;
    }

    private clearSectionActionState(): void {
        this.actionStateGeneration += 1;
        this.sectionsExpanded = false;
        this.memoryCandidateActionState.clear();
        this.maintenanceActionState.clear();
        this.quietRecallSaveState.clear();
        this.quietRecallLinkState.clear();
    }

    private createSectionCallbacks(): TabSectionCallbacks {
        const generation = this.actionStateGeneration;
        const app = this.options.app;
        return {
            requestRerender: () => this.handleSectionRerender(),
            canCommitActionState: () => !this.disposed && generation === this.actionStateGeneration,
            confirmAction: app
                ? (message: string) => confirmUserAction(app, {
                    title: pageletT("pagelet.tab.memory.confirmAllTitle", this.locale),
                    message,
                })
                : undefined,
        };
    }

    private renderExtractedSection<T>(data: T | undefined, factory: (data: T) => TabSectionRenderer): boolean {
        if (!this.bodyEl || !data) return false;
        const renderer = factory(data);
        if (!renderer.hasContent()) {
            renderer.destroy();
            return false;
        }
        const wrapper = el("div");
        renderer.render(wrapper);
        this.bodyEl.appendChild(wrapper);
        this.sectionRenderers.push(renderer);
        return true;
    }

    private handleSectionRerender(): void {
        const scrollTop = this.bodyEl?.scrollTop ?? 0;
        for (const renderer of this.sectionRenderers) {
            renderer.rerender();
        }
        if (this.bodyEl) this.bodyEl.scrollTop = scrollTop;
    }

    private rerenderCurrentContentPreservingScroll(): void {
        const scrollTop = this.bodyEl?.scrollTop ?? 0;
        this.renderContent(this.currentContent, this.currentOptions);
        if (this.bodyEl) this.bodyEl.scrollTop = scrollTop;
    }

    // -----------------------------------------------------------------------
    // DOM construction
    private renderSectionNav(slots: { id: string; labelKey: string }[]): void {
        if (!this.bodyEl) return;
        const nav = el("div", "pa-pagelet-tab-nav");
        nav.setAttribute("role", "navigation");
        nav.setAttribute("aria-label", pageletT("pagelet.tab.nav.ariaLabel", this.locale));
        for (const slot of slots) {
            const btn = el("button", "pa-pagelet-tab-nav-item", pageletT(slot.labelKey, this.locale));
            btn.setAttribute("type", "button");
            btn.addEventListener("click", () => {
                const target = this.bodyEl?.querySelector(`.pa-pagelet-tab-${slot.id}, .pa-pagelet-tab-section.pa-pagelet-tab-${slot.id}`);
                if (!target) {
                    const sections = this.bodyEl?.querySelectorAll(".pa-pagelet-tab-section, .pa-pagelet-tab-context-pager-details");
                    const index = slots.indexOf(slot);
                    const fallbackTarget = sections?.[index];
                    if (fallbackTarget) this.scrollTabNavTarget(fallbackTarget);
                    return;
                }
                this.scrollTabNavTarget(target);
            });
            nav.appendChild(btn);
        }
        this.bodyEl.prepend(nav);
    }

    private scrollTabNavTarget(target: Element): void {
        const details = target.closest(".pa-pagelet-tab-context-pager-details") as HTMLDetailsElement | null;
        if (details) {
            details.open = true;
            details.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // -----------------------------------------------------------------------

    private buildDOM(): HTMLDivElement {
        const root = el("div");
        root.className = "pa-pagelet-tab";
        root.setAttribute("role", "region");

        const label = el("h1", "pa-sr-only", pageletT("pagelet.tab.ariaLabel", this.locale));
        label.setAttribute("id", `pa-pagelet-tab-label-${++tabLabelSequence}`);
        this.labelEl = label;
        root.setAttribute("aria-labelledby", label.getAttribute("id") ?? "");
        root.appendChild(label);

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
        this.destroySectionRenderers();
        clearChildren(this.bodyEl);

        if (options.restoredFromState) {
            this.unloadRenderComponent();
            this.renderRestoredState();
            return;
        }

        const sectionCallbacks = this.createSectionCallbacks();

        if (options.layoutType === "summary") {
            const markdown = options.extra?.markdown;
            if (typeof markdown === "string" && markdown.trim().length > 0) {
                this.renderSummaryContent(markdown, options);
                this.renderSavedInsightContent(options.extra?.savedInsights);
                this.renderExtractedSection(options.extra?.memoryGovernance, (data) =>
                    new MemoryGovernanceSection(this.locale, data, {
                        onConfirm: this.options.onConfirmMemoryCandidate,
                        onDismiss: this.options.onDismissMemoryCandidate,
                        isDigestDeferred: () => this.memoryDigestDeferred,
                        onDeferDigest: () => { this.memoryDigestDeferred = true; },
                    }, sectionCallbacks, this.memoryCandidateActionState),
                );
            } else {
                this.unloadRenderComponent();
                const renderedSavedInsights = this.renderSavedInsightContent(options.extra?.savedInsights);
                const renderedMemoryGovernance = this.renderExtractedSection(options.extra?.memoryGovernance, (data) =>
                    new MemoryGovernanceSection(this.locale, data, {
                        onConfirm: this.options.onConfirmMemoryCandidate,
                        onDismiss: this.options.onDismissMemoryCandidate,
                        isDigestDeferred: () => this.memoryDigestDeferred,
                        onDeferDigest: () => { this.memoryDigestDeferred = true; },
                    }, sectionCallbacks, this.memoryCandidateActionState),
                );
                if (!renderedSavedInsights && !renderedMemoryGovernance) this.renderEmptyState();
            }
            return;
        }

        this.unloadRenderComponent();

        if (options.layoutType === "discover" && !isTabSections(content)) {
            renderDiscoveryLayout(
                this.bodyEl,
                content,
                options.extra?.connections,
                this.locale,
                {
                    sourcePath: options.sourcePath,
                    onConnectionNodeClick: this.options.onConnectionNodeClick,
                },
            );
            return;
        }

        type SectionSlot = { id: string; labelKey: string; render: () => boolean };
        const allSlots: SectionSlot[] = [
            { id: "memory", labelKey: "pagelet.tab.memory.title", render: () => this.renderExtractedSection(options.extra?.memoryGovernance, (data) =>
                new MemoryGovernanceSection(this.locale, data, {
                    onConfirm: this.options.onConfirmMemoryCandidate,
                    onDismiss: this.options.onDismissMemoryCandidate,
                    isDigestDeferred: () => this.memoryDigestDeferred,
                    onDeferDigest: () => { this.memoryDigestDeferred = true; },
                }, sectionCallbacks, this.memoryCandidateActionState)) },
            { id: "maintenance", labelKey: "pagelet.tab.maintenance.title", render: () => this.renderExtractedSection(options.extra?.maintenanceReview, (data) =>
                new MaintenanceReviewSection(this.locale, data, {
                    onApply: this.options.onApplyMaintenanceProposal,
                    onUndo: this.options.onUndoMaintenanceAction,
                    onOpenSettings: this.options.onOpenSettings,
                }, sectionCallbacks, this.maintenanceActionState)) },
            { id: "quiet-recall", labelKey: "pagelet.tab.recall.title", render: () => this.renderExtractedSection(options.extra?.quietRecall, (data) =>
                new QuietRecallSection(this.locale, data, {
                    onSave: this.options.onSaveQuietRecallAsInsight,
                    onLink: this.options.onLinkRecallCandidate,
                }, sectionCallbacks, options.sourcePath, this.quietRecallSaveState, this.quietRecallLinkState)) },
            { id: "graph-discovery", labelKey: "pagelet.tab.graphDiscovery.title", render: () => this.renderGraphDiscoveryContent(options.extra?.graphDiscovery) },
            { id: "pattern-detection", labelKey: "pagelet.tab.patterns.title", render: () => this.renderPatternDetectionContent(options.extra?.patternDetection) },
            { id: "saved-insights", labelKey: "pagelet.tab.savedInsights.title", render: () => this.renderSavedInsightContent(options.extra?.savedInsights) },
        ];

        const entryReason = options.entryReason ?? "default";
        const primaryId = ENTRY_REASON_TO_PRIMARY_SECTION[entryReason];
        const sorted = primaryId
            ? [
                ...allSlots.filter((s) => s.id === primaryId),
                ...allSlots.filter((s) => s.id !== primaryId),
            ]
            : allSlots;

        const renderedSlots: SectionSlot[] = [];
        for (const slot of sorted) {
            if (slot.render()) renderedSlots.push(slot);
        }

        if (content.length > 0) {
            if (isTabSections(content)) {
                this.renderTabSections(content);
            } else {
                this.renderFromFindings(content);
            }
            renderedSlots.push({ id: "findings", labelKey: "pagelet.tab.overview", render: () => true });
        }

        if (this.renderContextPagerAsDetails(options.extra?.contextPager)) {
            renderedSlots.push({ id: "context-pager", labelKey: "pagelet.panel.contextPager.usedSources", render: () => true });
        }

        const visibleSlots = (renderedSlots.length > 3 && !this.sectionsExpanded)
            ? renderedSlots.slice(0, 3)
            : renderedSlots;
        if (visibleSlots.length >= 3) {
            this.renderSectionNav(visibleSlots);
        }

        if (renderedSlots.length > 3 && !this.sectionsExpanded && this.bodyEl) {
            const allSections = Array.from(this.bodyEl.querySelectorAll(".pa-pagelet-tab-section"));
            let visibleCount = 0;
            for (const sectionEl of allSections) {
                if (visibleCount >= 3) {
                    sectionEl.classList.add("pa-pagelet-tab-section--hidden");
                }
                visibleCount++;
            }
            const overflowId = `pa-tab-overflow-${++tabLabelSequence}`;
            const controlledIds: string[] = [];
            for (const [index, sectionEl] of allSections.slice(3).entries()) {
                const sectionId = sectionEl.id || `${overflowId}-${index + 1}`;
                sectionEl.id = sectionId;
                sectionEl.setAttribute("data-overflow-group", overflowId);
                controlledIds.push(sectionId);
            }
            const showMoreBtn = el("button", "pa-pagelet-tab-show-more",
                pageletT("pagelet.tab.showMore", this.locale, { count: renderedSlots.length - 3 }));
            showMoreBtn.setAttribute("type", "button");
            showMoreBtn.setAttribute("aria-expanded", "false");
            showMoreBtn.setAttribute("aria-controls", controlledIds.join(" "));
            showMoreBtn.addEventListener("click", () => {
                this.sectionsExpanded = true;
                showMoreBtn.setAttribute("aria-expanded", "true");
                this.rerenderCurrentContentPreservingScroll();
            });
            this.bodyEl.appendChild(showMoreBtn);
        }

        if (renderedSlots.length === 0) {
            this.renderEmptyState();
        }
    }

    private renderContextPagerContent(contextPager: ContextPagerState | undefined): boolean {
        if (!this.bodyEl || !contextPager) return false;
        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-context-pager");
        section.appendChild(el("h2", undefined, pageletT("pagelet.panel.contextPager.usedSources", this.locale)));
        const skipped = contextPager.summary.skippedSourceCount
            + contextPager.summary.droppedMemoryCount
            + contextPager.summary.skippedScopeCount;
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.panel.contextPager.summary", this.locale, {
                sources: contextPager.summary.usedSourceCount,
                memories: contextPager.summary.usedMemoryCount,
                skipped,
            })));

        const appendList = (label: string, items: string[]): void => {
            if (items.length === 0) return;
            const group = el("div", "pa-pagelet-tab-review-queue-group");
            group.appendChild(el("h3", undefined, label));
            const card = el("div", "pa-pagelet-tab-insight-card");
            const list = el("ul", "pa-pagelet-tab-context-pager-list");
            for (const item of items) {
                const row = el("li");
                row.textContent = item;
                list.appendChild(row);
            }
            card.appendChild(list);
            group.appendChild(card);
            section.appendChild(group);
        };

        appendList(
            pageletT("pagelet.panel.contextPager.usedSources", this.locale),
            contextPager.usedSources.map((item) => item.label ?? item.path),
        );
        appendList(
            pageletT("pagelet.panel.contextPager.skippedSources", this.locale),
            contextPager.skippedSources.map((item) =>
                `${item.label ?? item.path} · ${item.reason ?? pageletT("pagelet.panel.contextPager.reason.notUsed", this.locale)}`),
        );
        appendList(
            pageletT("pagelet.panel.contextPager.usedMemories", this.locale),
            contextPager.usedMemories.map((item) => item.label ?? item.id),
        );
        appendList(
            pageletT("pagelet.panel.contextPager.droppedMemories", this.locale),
            contextPager.droppedMemories.map((item) =>
                `${item.label ?? item.id} · ${item.reason ?? pageletT("pagelet.panel.contextPager.reason.notUsed", this.locale)}`),
        );

        this.bodyEl.appendChild(section);
        return true;
    }

    private renderContextPagerAsDetails(contextPager: ContextPagerState | undefined): boolean {
        if (!this.bodyEl || !contextPager) return false;
        const details = el("details", "pa-pagelet-tab-context-pager-details") as HTMLDetailsElement;
        const summary = el("summary");
        summary.textContent = pageletT("pagelet.panel.contextPager.usedSources", this.locale);
        details.appendChild(summary);
        const wrapper = el("div");
        const saved = this.bodyEl;
        this.bodyEl = wrapper;
        this.renderContextPagerContent(contextPager);
        this.bodyEl = saved;
        details.appendChild(wrapper);
        this.bodyEl.appendChild(details);
        return true;
    }

    private renderSavedInsightContent(savedInsights: DetailExtra["savedInsights"]): boolean {
        if (!this.bodyEl || !savedInsights || savedInsights.items.length === 0) return false;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-saved-insights");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.savedInsights.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.savedInsights.summary", this.locale, { count: savedInsights.totalCount })));

        for (const insight of savedInsights.items) {
            const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-saved-insight-card");
            cardEl.appendChild(el("h4", undefined,
                pageletT(`pagelet.tab.savedInsights.type.${insight.type}`, this.locale)));
            cardEl.appendChild(el("p", undefined, insight.text));

            const tagRow = el("div", "pa-pagelet-tab-tag-row");
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT(`pagelet.tab.savedInsights.status.${insight.status}`, this.locale)));
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT(`pagelet.tab.savedInsights.origin.${insight.origin}`, this.locale)));
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT("pagelet.tab.savedInsights.influence.weakOnly", this.locale)));
            const source = insight.sourceRefs[0]?.path;
            if (source) tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", source));
            cardEl.appendChild(tagRow);

            section.appendChild(cardEl);
        }

        this.bodyEl.appendChild(section);
        return true;
    }

    private renderGraphDiscoveryContent(graphDiscovery: DetailExtra["graphDiscovery"]): boolean {
        if (!this.bodyEl || !graphDiscovery) return false;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-graph-discovery");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.graphDiscovery.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.graphDiscovery.summary", this.locale, {
                count: graphDiscovery.totalCount,
                skipped: graphDiscovery.skippedSourceCount,
            })));

        const overviewCard = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-graph-overview-card");
        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el("span", "pa-pagelet-tab-muted", pageletT("pagelet.tab.graphDiscovery.previewOnly", this.locale)));
        overviewCard.appendChild(tagRow);
        section.appendChild(overviewCard);

        if (graphDiscovery.items.length === 0) {
            section.appendChild(renderEmptyCard(
                "pa-pagelet-tab-graph-empty", "pagelet.graphDiscovery.none", undefined, this.locale));
            this.bodyEl.appendChild(section);
            return true;
        }

        const group = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-graph-items");
        group.appendChild(el("h3", undefined, pageletT("pagelet.tab.graphDiscovery.items", this.locale)));
        for (const item of graphDiscovery.items) {
            group.appendChild(this.renderGraphDiscoveryItem(item));
        }
        section.appendChild(group);
        this.bodyEl.appendChild(section);
        return true;
    }

    private renderGraphDiscoveryItem(item: GraphDiscoveryItem): HTMLElement {
        const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-graph-card");
        cardEl.appendChild(el("h4", undefined, item.title));
        cardEl.appendChild(el("p", undefined, item.claim));

        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.graphDiscovery.type.${item.type}`, this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.graphDiscovery.edge.${item.edgeState}`, this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.graphDiscovery.outcome.${item.outcomeStatus}`, this.locale)));
        cardEl.appendChild(tagRow);

        if (item.whyShown.length > 0) {
            cardEl.appendChild(el("p", "pa-pagelet-tab-review-queue-why",
                pageletT("pagelet.tab.common.whyNow", this.locale, { reason: item.whyShown.slice(0, 2).join("; ") })));
        }

        const sourcePaths = [...new Set(item.sourceRefs.map((ref) => ref.path).filter(Boolean))].slice(0, 6);
        if (sourcePaths.length > 0) {
            const list = el("ul", "pa-pagelet-tab-context-pager-list");
            for (const path of sourcePaths) {
                list.appendChild(el("li", undefined, path));
            }
            cardEl.appendChild(list);
        }
        return cardEl;
    }

    private renderPatternDetectionContent(patternDetection: DetailExtra["patternDetection"]): boolean {
        if (!this.bodyEl || !patternDetection) return false;
        const visiblePatterns = patternDetection.patterns.filter((pattern) => !this.dismissedPatternIds.has(pattern.id));

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-pattern-detection");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.patterns.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.patterns.summary", this.locale, { count: visiblePatterns.length })));

        if (visiblePatterns.length === 0) {
            section.appendChild(el("div", "pa-pagelet-tab-empty-card", pageletT("pagelet.tab.patterns.empty", this.locale)));
            this.bodyEl.appendChild(section);
            return true;
        }

        const group = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-pattern-items");
        for (const pattern of visiblePatterns) {
            const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-pattern-card");
            cardEl.appendChild(el("h4", undefined, pattern.title));
            cardEl.appendChild(el("p", undefined, pattern.summary));

            const tagRow = el("div", "pa-pagelet-tab-tag-row");
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT(`pagelet.tab.patterns.type.${pattern.patternType}`, this.locale)));
            cardEl.appendChild(tagRow);

            if (pattern.whyShown.length > 0) {
                cardEl.appendChild(el("p", "pa-pagelet-tab-review-queue-why",
                    pageletT("pagelet.tab.common.whyNow", this.locale, { reason: pattern.whyShown.slice(0, 2).join("; ") })));
            }

            const sourcePaths = [...new Set(pattern.sourceRefs.map((ref) => ref.path).filter(Boolean))].slice(0, 8);
            if (sourcePaths.length > 0) {
                const list = el("ul", "pa-pagelet-tab-context-pager-list");
                for (const path of sourcePaths) {
                    const item = el("li");
                    if (this.options.onSourcePathClick) {
                        const button = el("button", "pa-pagelet-tab-source-link", path);
                        button.setAttribute("type", "button");
                        button.addEventListener("click", (event) => {
                            event.preventDefault();
                            this.options.onSourcePathClick?.(path);
                        });
                        item.appendChild(button);
                    } else {
                        item.textContent = path;
                    }
                    list.appendChild(item);
                }
                cardEl.appendChild(list);
            }

            const actions = el("div", "pa-pagelet-tab-memory-candidate-actions");
            const dismissButton = el("button", "pa-pagelet-tab-pattern-dismiss",
                pageletT("pagelet.tab.patterns.dismiss", this.locale));
            dismissButton.setAttribute("type", "button");
            dismissButton.addEventListener("click", (event) => {
                event.preventDefault();
                this.dismissedPatternIds.add(pattern.id);
                this.rerenderCurrentContentPreservingScroll();
            });
            actions.appendChild(dismissButton);
            cardEl.appendChild(actions);
            group.appendChild(cardEl);
        }
        section.appendChild(group);
        this.bodyEl.appendChild(section);
        return true;
    }

    /** Render an explicit no-content state instead of a blank detail view. */
    private renderEmptyState(): void {
        if (!this.bodyEl) return;

        const section = el("div", "pa-pagelet-tab-section");
        section.appendChild(el("h2", undefined,
            pageletT("pagelet.tab.overview", this.locale)));

        section.appendChild(renderEmptyCard(
            "", "pagelet.tab.empty.title", "pagelet.tab.empty.body", this.locale));

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
        saveBtn.addEventListener("click", (event) => {
            event.preventDefault();
            void this.handleSummarySaveClick(saveBtn, summarySaveNote).catch((error) => {
                console.error("Pagelet summary save failed", error);
                saveBtn.removeAttribute("aria-busy");
                saveBtn.disabled = false;
                saveBtn.setAttribute("aria-disabled", "false");
                saveBtn.textContent = pageletT("pagelet.panel.save", this.locale);
            });
        });
        actions.appendChild(saveBtn);
        this.bodyEl.appendChild(actions);
    }

    private async handleSummarySaveClick(
        saveBtn: HTMLButtonElement,
        summarySaveNote: GeneratedReviewNote,
    ): Promise<void> {
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
        Array.isArray(content[0].cards)
    );
}

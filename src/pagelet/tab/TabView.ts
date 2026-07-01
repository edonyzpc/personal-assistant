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
import {
    groupReviewQueueItemsForTab,
    type ContextPagerState,
    type GraphDiscoveryItem,
    type MaintenanceMoveApplyResult,
    type MaintenanceMoveUndoResult,
    type MaintenanceProposal,
    type QuietRecallCandidate,
    type QuietRecallSaveResult,
    type ReviewQueueItem,
    type ReviewQueueTabGroup,
    type WeeklyReviewRunResult,
} from "../../pa";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import { clearChildren, el } from "../dom-utils";
import { renderDiscoveryLayout, renderSummaryPreview } from "../panel/PanelLayouts";

interface TabViewOptions {
    app?: App;
    onConnectionNodeClick?: (noteName: string, sourcePath?: string) => void;
    onSaveSummaryNote?: (note: GeneratedReviewNote) => Promise<WriteResult>;
    onApplyMaintenanceProposal?: (proposal: MaintenanceProposal) => Promise<MaintenanceMoveApplyResult>;
    onUndoMaintenanceAction?: (actionId: string) => Promise<MaintenanceMoveUndoResult>;
    onSaveWeeklyReviewNote?: (review: WeeklyReviewRunResult, acceptedItemIds: readonly string[]) => Promise<WriteResult>;
    onSaveQuietRecallAsInsight?: (candidate: QuietRecallCandidate) => Promise<QuietRecallSaveResult>;
}

type TabOpenOptions = Pick<PageletDetailPayload, "layoutType" | "extra" | "sourcePath" | "summarySaveNote" | "restoredFromState">;
type DetailExtra = NonNullable<PageletDetailPayload["extra"]>;
type MaintenanceActionUiStatus = "applying" | "applied" | "failed" | "undoing" | "undone";
type WeeklyReviewUiMode = "digest" | "selecting";
type WeeklyReviewSaveStatus = "idle" | "saving" | "saved" | "failed";
type QuietRecallSaveStatus = "saving" | "saved" | "failed";

interface MaintenanceActionUiState {
    status: MaintenanceActionUiStatus;
    message: string;
    actionId?: string;
}

interface QuietRecallSaveState {
    status: QuietRecallSaveStatus;
    message: string;
}

let tabLabelSequence = 0;
let weeklyAcceptLabelSequence = 0;

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
    private labelEl: HTMLSpanElement | null = null;
    private containerEl: HTMLElement | null = null;
    private _isOpen = false;
    private readonly options: TabViewOptions;
    private renderComponent: Component | null = null;
    private currentContent: PanelFinding[] | TabSection[] = [];
    private currentOptions: TabOpenOptions = {};
    private reviewQueueTabFilter: ReviewQueueTabGroup | "all" = "all";
    private readonly maintenanceActionState = new Map<string, MaintenanceActionUiState>();
    private readonly weeklyAcceptedItemIds = new Set<string>();
    private weeklyReviewUiStateKey: string | null = null;
    private weeklyReviewUiMode: WeeklyReviewUiMode = "digest";
    private weeklyReviewActionsEl: HTMLElement | null = null;
    private weeklyReviewSaveStatus: WeeklyReviewSaveStatus = "idle";
    private weeklyReviewSaveMessage = "";
    private readonly quietRecallSaveState = new Map<string, QuietRecallSaveState>();

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
        this.unloadRenderComponent();
        if (this.rootEl) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        this.bodyEl = null;
        this.labelEl = null;
        this.containerEl = null;
        this._isOpen = false;
        this.maintenanceActionState.clear();
        this.weeklyAcceptedItemIds.clear();
        this.quietRecallSaveState.clear();
    }

    // -----------------------------------------------------------------------
    // DOM construction
    // -----------------------------------------------------------------------

    private buildDOM(): HTMLDivElement {
        const root = el("div");
        root.className = "pa-pagelet-tab";
        root.setAttribute("role", "region");

        const label = el("span", "pa-sr-only", pageletT("pagelet.tab.ariaLabel", this.locale));
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
        this.weeklyReviewActionsEl = null;
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
                this.renderSavedInsightContent(options.extra?.savedInsights);
                this.renderMemoryGovernanceContent(options.extra?.memoryGovernance);
            } else {
                this.unloadRenderComponent();
                const renderedSavedInsights = this.renderSavedInsightContent(options.extra?.savedInsights);
                const renderedMemoryGovernance = this.renderMemoryGovernanceContent(options.extra?.memoryGovernance);
                if (!renderedSavedInsights && !renderedMemoryGovernance) this.renderEmptyState();
            }
            return;
        }

        this.unloadRenderComponent();

        const renderedContextPager = this.renderContextPagerContent(options.extra?.contextPager);
        const renderedQueue = this.renderReviewQueueContent(options.extra?.reviewQueue);
        const renderedSavedInsights = this.renderSavedInsightContent(options.extra?.savedInsights);
        const renderedMemoryGovernance = this.renderMemoryGovernanceContent(options.extra?.memoryGovernance);
        const renderedMaintenanceReview = this.renderMaintenanceReviewContent(options.extra?.maintenanceReview);
        const renderedGraphDiscovery = this.renderGraphDiscoveryContent(options.extra?.graphDiscovery);
        const renderedWeeklyReview = this.renderWeeklyReviewContent(options.extra?.weeklyReview);
        const renderedQuietRecall = this.renderQuietRecallContent(options.extra?.quietRecall);

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

        if (content.length === 0) {
            if (
                !renderedContextPager
                && !renderedQueue
                && !renderedSavedInsights
                && !renderedMemoryGovernance
                && !renderedMaintenanceReview
                && !renderedGraphDiscovery
                && !renderedWeeklyReview
                && !renderedQuietRecall
            ) {
                this.renderEmptyState();
            }
            return;
        }

        // Detect whether content is TabSection[] or PanelFinding[]
        if (isTabSections(content)) {
            this.renderTabSections(content);
        } else {
            this.renderFromFindings(content);
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

    private renderWeeklyReviewContent(weeklyReview: DetailExtra["weeklyReview"]): boolean {
        if (!this.bodyEl || !weeklyReview) return false;
        this.ensureWeeklyReviewUiState(weeklyReview);
        const selectionMode = this.weeklyReviewUiMode === "selecting";

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-weekly-review");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.weekly.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.weekly.summary", this.locale, {
                count: weeklyReview.totalCount,
                range: weeklyReview.range.label,
            })));

        const overviewCard = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-weekly-overview-card");
        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", pageletT("pagelet.tab.weekly.manualOnly", this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", weeklyReview.range.label));
        overviewCard.appendChild(tagRow);
        section.appendChild(overviewCard);

        for (const reviewSection of weeklyReview.sections) {
            const group = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-weekly-section");
            group.appendChild(el("h3", undefined, reviewSection.title));
            if (reviewSection.items.length === 0) {
                const emptyCard = el("div", "pa-pagelet-tab-empty-card pa-pagelet-tab-weekly-empty");
                emptyCard.appendChild(el("div", "pa-pagelet-tab-empty-title",
                    pageletT("pagelet.tab.weekly.emptySection", this.locale)));
                group.appendChild(emptyCard);
                section.appendChild(group);
                continue;
            }

            for (const item of reviewSection.items) {
                const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-weekly-card");
                const header = el("div", "pa-pagelet-tab-weekly-card-header");
                const titleEl = el("h4", undefined, item.title);
                if (selectionMode) {
                    const checkbox = el("input", "pa-pagelet-tab-weekly-accept") as HTMLInputElement;
                    const titleId = `pa-pagelet-tab-weekly-title-${++weeklyAcceptLabelSequence}`;
                    checkbox.setAttribute("type", "checkbox");
                    checkbox.setAttribute("aria-labelledby", titleId);
                    checkbox.checked = this.weeklyAcceptedItemIds.has(item.id);
                    checkbox.addEventListener("change", () => {
                        if (checkbox.checked) this.weeklyAcceptedItemIds.add(item.id);
                        else this.weeklyAcceptedItemIds.delete(item.id);
                        this.weeklyReviewSaveStatus = "idle";
                        this.weeklyReviewSaveMessage = "";
                        this.refreshWeeklyReviewActions(weeklyReview);
                    });
                    header.appendChild(checkbox);
                    titleEl.setAttribute("id", titleId);
                }
                header.appendChild(titleEl);
                cardEl.appendChild(header);
                cardEl.appendChild(el("p", undefined, item.summary));

                const itemTags = el("div", "pa-pagelet-tab-tag-row");
                itemTags.appendChild(el("span", "pa-pagelet-tab-tag-chip", reviewSection.title));
                const source = item.sourceRefs[0]?.path;
                if (source) itemTags.appendChild(el("span", "pa-pagelet-tab-tag-chip", source));
                cardEl.appendChild(itemTags);

                if (item.whyShown.length > 0) {
                    cardEl.appendChild(el("p", "pa-pagelet-tab-muted",
                        pageletT("pagelet.tab.weekly.whyNow", this.locale, {
                            reason: item.whyShown.slice(0, 2).join("; "),
                        })));
                }

                group.appendChild(cardEl);
            }
            section.appendChild(group);
        }

        this.renderWeeklyReviewActions(section, weeklyReview);
        this.bodyEl.appendChild(section);
        return true;
    }

    private renderWeeklyReviewActions(section: HTMLElement, weeklyReview: WeeklyReviewRunResult): void {
        if (!this.options.onSaveWeeklyReviewNote) return;
        const actions = el("div", "pa-pagelet-tab-weekly-actions");
        this.weeklyReviewActionsEl = actions;
        this.populateWeeklyReviewActions(actions, weeklyReview);
        section.appendChild(actions);
    }

    private resetWeeklyReviewUiState(): void {
        this.weeklyAcceptedItemIds.clear();
        this.weeklyReviewUiMode = "digest";
        this.weeklyReviewSaveStatus = "idle";
        this.weeklyReviewSaveMessage = "";
    }

    private ensureWeeklyReviewUiState(weeklyReview: WeeklyReviewRunResult): void {
        const key = [
            weeklyReview.generatedAt,
            weeklyReview.range.label,
            weeklyReview.sections
                .flatMap((section) => section.items.map((item) => item.id))
                .join("|"),
        ].join("::");
        if (this.weeklyReviewUiStateKey === key) return;
        this.weeklyReviewUiStateKey = key;
        this.resetWeeklyReviewUiState();
    }

    private acceptedWeeklyItemIdsForReview(weeklyReview: WeeklyReviewRunResult): string[] {
        const currentIds = new Set(
            weeklyReview.sections.flatMap((section) => section.items.map((item) => item.id)),
        );
        return [...this.weeklyAcceptedItemIds].filter((id) => currentIds.has(id));
    }

    private refreshWeeklyReviewActions(weeklyReview: WeeklyReviewRunResult): void {
        if (!this.weeklyReviewActionsEl) return;
        clearChildren(this.weeklyReviewActionsEl);
        this.populateWeeklyReviewActions(this.weeklyReviewActionsEl, weeklyReview);
    }

    private rerenderCurrentContentPreservingScroll(): void {
        const scrollTop = this.bodyEl?.scrollTop ?? 0;
        this.renderContent(this.currentContent, this.currentOptions);
        if (this.bodyEl) this.bodyEl.scrollTop = scrollTop;
    }

    private populateWeeklyReviewActions(actions: HTMLElement, weeklyReview: WeeklyReviewRunResult): void {
        if (this.weeklyReviewUiMode === "digest") {
            if (weeklyReview.totalCount === 0) return;
            const chooseBtn = el(
                "button",
                "pa-pagelet-tab-weekly-save pa-pagelet-tab-weekly-choose",
                pageletT("pagelet.tab.weekly.chooseItems", this.locale),
            );
            chooseBtn.setAttribute("type", "button");
            chooseBtn.addEventListener("click", (event) => {
                event.preventDefault();
                this.weeklyReviewUiMode = "selecting";
                this.weeklyReviewSaveStatus = "idle";
                this.weeklyReviewSaveMessage = "";
                this.rerenderCurrentContentPreservingScroll();
            });
            actions.appendChild(chooseBtn);
            return;
        }

        const acceptedItemIds = this.acceptedWeeklyItemIdsForReview(weeklyReview);
        const acceptedCount = acceptedItemIds.length;
        const saveBtn = el(
            "button",
            "pa-pagelet-tab-weekly-save",
            this.weeklyReviewSaveStatus === "saving"
                ? pageletT("pagelet.panel.status.saving", this.locale)
                : this.weeklyReviewSaveStatus === "saved"
                    ? pageletT("pagelet.tab.weekly.saved", this.locale)
                    : pageletT("pagelet.tab.weekly.saveSelected", this.locale, { count: acceptedCount }),
        );
        saveBtn.setAttribute("type", "button");
        if (acceptedCount === 0 || this.weeklyReviewSaveStatus === "saving" || this.weeklyReviewSaveStatus === "saved") {
            saveBtn.disabled = true;
            saveBtn.setAttribute("aria-disabled", "true");
        }
        if (this.weeklyReviewSaveStatus === "saving") {
            saveBtn.setAttribute("aria-busy", "true");
        }
        saveBtn.addEventListener("click", (event) => {
            event.preventDefault();
            void this.saveWeeklyReviewFromTab(weeklyReview);
        });
        actions.appendChild(saveBtn);
        if (this.weeklyReviewSaveStatus !== "saving") {
            const backBtn = el(
                "button",
                "pa-pagelet-tab-maintenance-action pa-pagelet-tab-weekly-back",
                pageletT("pagelet.tab.weekly.backToDigest", this.locale),
            );
            backBtn.setAttribute("type", "button");
            backBtn.addEventListener("click", (event) => {
                event.preventDefault();
                this.weeklyAcceptedItemIds.clear();
                this.weeklyReviewUiMode = "digest";
                this.weeklyReviewSaveStatus = "idle";
                this.weeklyReviewSaveMessage = "";
                this.rerenderCurrentContentPreservingScroll();
            });
            actions.appendChild(backBtn);
        }
        if (this.weeklyReviewSaveMessage) {
            actions.appendChild(el("span", "pa-pagelet-tab-maintenance-status", this.weeklyReviewSaveMessage));
        }
    }

    private async saveWeeklyReviewFromTab(weeklyReview: WeeklyReviewRunResult): Promise<void> {
        if (!this.options.onSaveWeeklyReviewNote) return;
        const acceptedItemIds = this.acceptedWeeklyItemIdsForReview(weeklyReview);
        if (acceptedItemIds.length === 0) return;
        this.weeklyReviewSaveStatus = "saving";
        this.weeklyReviewSaveMessage = pageletT("pagelet.panel.status.saving", this.locale);
        this.refreshWeeklyReviewActions(weeklyReview);
        try {
            const result = await this.options.onSaveWeeklyReviewNote(weeklyReview, acceptedItemIds);
            if (result.success) {
                this.weeklyReviewSaveStatus = "saved";
                this.weeklyReviewSaveMessage = result.filePath ?? pageletT("pagelet.tab.weekly.saved", this.locale);
            } else {
                this.weeklyReviewSaveStatus = "failed";
                this.weeklyReviewSaveMessage = result.error ?? pageletT("pagelet.reviewNote.createFailed", this.locale, { error: "" });
            }
        } catch (error) {
            this.weeklyReviewSaveStatus = "failed";
            this.weeklyReviewSaveMessage = error instanceof Error ? error.message : String(error);
        }
        this.refreshWeeklyReviewActions(weeklyReview);
    }

    private renderQuietRecallContent(quietRecall: DetailExtra["quietRecall"]): boolean {
        if (!this.bodyEl || !quietRecall) return false;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-quiet-recall");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.recall.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.recall.summary", this.locale, { count: quietRecall.totalCount })));

        if (quietRecall.candidates.length === 0) {
            const emptyCard = el("div", "pa-pagelet-tab-empty-card pa-pagelet-tab-recall-empty");
            emptyCard.appendChild(el("div", "pa-pagelet-tab-empty-title",
                pageletT("pagelet.tab.recall.empty", this.locale)));
            section.appendChild(emptyCard);
            this.bodyEl.appendChild(section);
            return true;
        }

        for (const candidate of quietRecall.candidates) {
            const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-recall-card");
            cardEl.appendChild(el("h4", undefined, candidate.title));
            cardEl.appendChild(el("p", undefined, candidate.summary));

            const tagRow = el("div", "pa-pagelet-tab-tag-row");
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT(`pagelet.tab.recall.relation.${candidate.relation}`, this.locale)));
            const source = candidate.sourceRefs[0]?.path;
            if (source) tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", source));
            cardEl.appendChild(tagRow);

            cardEl.appendChild(el("p", "pa-pagelet-tab-muted",
                pageletT("pagelet.tab.recall.whyNow", this.locale, {
                    reason: candidate.whyNow.slice(0, 2).join("; "),
                })));
            cardEl.appendChild(el("p", "pa-pagelet-tab-muted",
                pageletT("pagelet.tab.recall.nextAction", this.locale, {
                    action: candidate.nextAction,
                })));

            this.renderQuietRecallActions(cardEl, candidate);
            section.appendChild(cardEl);
        }

        this.bodyEl.appendChild(section);
        return true;
    }

    private renderQuietRecallActions(cardEl: HTMLElement, candidate: QuietRecallCandidate): void {
        if (!this.options.onSaveQuietRecallAsInsight) return;
        const state = this.quietRecallSaveState.get(candidate.id);
        const actionRow = el("div", "pa-pagelet-tab-recall-actions");
        const saveBtn = el(
            "button",
            "pa-pagelet-tab-recall-save",
            state?.status === "saving"
                ? pageletT("pagelet.tab.recall.saving", this.locale)
                : state?.status === "saved"
                    ? pageletT("pagelet.tab.recall.saved", this.locale)
                    : pageletT("pagelet.tab.recall.saveInsight", this.locale),
        );
        saveBtn.setAttribute("type", "button");
        if (state?.status === "saving" || state?.status === "saved") {
            saveBtn.disabled = true;
            saveBtn.setAttribute("aria-disabled", "true");
        }
        saveBtn.addEventListener("click", (event) => {
            event.preventDefault();
            void this.saveQuietRecallFromTab(candidate);
        });
        actionRow.appendChild(saveBtn);
        if (state) {
            actionRow.appendChild(el("span", "pa-pagelet-tab-maintenance-status", state.message));
        }
        cardEl.appendChild(actionRow);
    }

    private async saveQuietRecallFromTab(candidate: QuietRecallCandidate): Promise<void> {
        if (!this.options.onSaveQuietRecallAsInsight) return;
        this.quietRecallSaveState.set(candidate.id, {
            status: "saving",
            message: pageletT("pagelet.tab.recall.saving", this.locale),
        });
        this.renderContent(this.currentContent, this.currentOptions);
        try {
            const result = await this.options.onSaveQuietRecallAsInsight(candidate);
            if (result.ok) {
                this.quietRecallSaveState.set(candidate.id, {
                    status: "saved",
                    message: result.message,
                });
            } else {
                this.quietRecallSaveState.set(candidate.id, {
                    status: "failed",
                    message: result.message,
                });
            }
        } catch (error) {
            this.quietRecallSaveState.set(candidate.id, {
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        this.renderContent(this.currentContent, this.currentOptions);
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

    private renderMemoryGovernanceContent(memoryGovernance: DetailExtra["memoryGovernance"]): boolean {
        if (!this.bodyEl || !memoryGovernance || memoryGovernance.records.length === 0) return false;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-memory-governance");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.memory.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.memory.summary", this.locale, { count: memoryGovernance.totalCount })));

        for (const record of memoryGovernance.records) {
            const isTombstone = record.lifecycle === "forgotten_tombstone";
            const cardEl = el(
                "div",
                isTombstone
                    ? "pa-pagelet-tab-insight-card pa-pagelet-tab-memory-card pa-pagelet-tab-memory-card--tombstone"
                    : "pa-pagelet-tab-insight-card pa-pagelet-tab-memory-card",
            );
            cardEl.appendChild(el("h4", undefined,
                pageletT(`pagelet.tab.memory.type.${record.type}`, this.locale)));
            cardEl.appendChild(el("p", undefined, isTombstone
                ? pageletT("pagelet.tab.memory.forgottenMarker", this.locale)
                : record.summary));

            const tagRow = el("div", "pa-pagelet-tab-tag-row");
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT(`pagelet.tab.memory.lifecycle.${record.lifecycle}`, this.locale)));
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT(`pagelet.tab.memory.sensitivity.${record.sensitivity}`, this.locale)));
            const scopeLabel = record.scope.label ?? record.scope.paths?.[0] ?? record.scope.kind;
            if (scopeLabel) tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", scopeLabel));
            if (!isTombstone) {
                const source = record.sourceRefs[0]?.path;
                if (source) tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", source));
            }
            cardEl.appendChild(tagRow);

            section.appendChild(cardEl);
        }

        this.bodyEl.appendChild(section);
        return true;
    }

    private renderMaintenanceReviewContent(maintenanceReview: DetailExtra["maintenanceReview"]): boolean {
        if (!this.bodyEl || !maintenanceReview) return false;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-maintenance-review");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.maintenance.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.maintenance.summary", this.locale, { count: maintenanceReview.totalCount })));

        const overviewCard = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-maintenance-overview-card");
        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", pageletT("pagelet.tab.maintenance.previewOnly", this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", pageletT("pagelet.tab.maintenance.weeklyDisabled", this.locale)));
        overviewCard.appendChild(tagRow);
        section.appendChild(overviewCard);

        const categories = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-maintenance-categories");
        categories.appendChild(el("h3", undefined, pageletT("pagelet.tab.maintenance.categories", this.locale)));
        for (const category of maintenanceReview.categories) {
            const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-maintenance-category-card");
            cardEl.appendChild(el("h4", undefined, category.label));
            cardEl.appendChild(el("p", undefined, String(category.count)));
            categories.appendChild(cardEl);
        }
        section.appendChild(categories);

        if (maintenanceReview.proposals.length === 0) {
            const emptyCard = el("div", "pa-pagelet-tab-insight-card");
            emptyCard.appendChild(el("p", undefined, pageletT("pagelet.tab.maintenance.noProposals", this.locale)));
            section.appendChild(emptyCard);
        }
        if (maintenanceReview.proposals.length > 0) {
            const proposals = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-maintenance-proposals");
            proposals.appendChild(el("h3", undefined, pageletT("pagelet.tab.maintenance.proposals", this.locale)));
            for (const proposal of maintenanceReview.proposals) {
                const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-maintenance-card");
                cardEl.appendChild(el("h4", undefined, proposal.title));
                cardEl.appendChild(el("p", undefined, proposal.claim));

                const proposalTags = el("div", "pa-pagelet-tab-tag-row");
                proposalTags.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                    pageletT(`pagelet.tab.maintenance.action.${proposal.actionType}`, this.locale)));
                proposalTags.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                    pageletT(`pagelet.tab.maintenance.confidence.${proposal.confidence}`, this.locale)));
                proposalTags.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                    pageletT("pagelet.tab.maintenance.previewOnly", this.locale)));
                cardEl.appendChild(proposalTags);

                const affectedPaths = el("div", "pa-pagelet-tab-maintenance-affected-paths");
                affectedPaths.appendChild(el("div", "pa-pagelet-tab-empty-title",
                    pageletT("pagelet.tab.maintenance.affectedPaths", this.locale)));
                const list = el("ul", "pa-pagelet-tab-context-pager-list");
                for (const path of proposal.preview.affectedPaths) {
                    list.appendChild(el("li", undefined, path));
                }
                affectedPaths.appendChild(list);
                cardEl.appendChild(affectedPaths);

                this.renderMaintenanceProposalActions(cardEl, proposal);
                proposals.appendChild(cardEl);
            }
            section.appendChild(proposals);
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
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", pageletT("pagelet.tab.graphDiscovery.previewOnly", this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", pageletT("pagelet.tab.graphDiscovery.noQueue", this.locale)));
        overviewCard.appendChild(tagRow);
        section.appendChild(overviewCard);

        if (graphDiscovery.items.length === 0) {
            section.appendChild(el("div", "pa-pagelet-tab-empty-card", pageletT("pagelet.graphDiscovery.none", this.locale)));
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
                pageletT("pagelet.tab.weekly.whyNow", this.locale, { reason: item.whyShown.slice(0, 2).join("; ") })));
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

    private renderMaintenanceProposalActions(cardEl: HTMLElement, proposal: MaintenanceProposal): void {
        if (!this.options.onApplyMaintenanceProposal) return;

        const actionRow = el("div", "pa-pagelet-tab-maintenance-actions");
        const state = this.maintenanceActionState.get(proposal.id);
        const hasUndoTarget = Boolean(this.options.onUndoMaintenanceAction
            && state?.actionId
            && (state.status === "applied" || state.status === "undoing" || state.status === "failed"));

        if (proposal.actionType !== "move") {
            actionRow.appendChild(el("span", "pa-pagelet-tab-maintenance-status",
                pageletT("pagelet.tab.maintenance.actionUnavailable", this.locale)));
            cardEl.appendChild(actionRow);
            return;
        }

        if (!hasUndoTarget && state?.status !== "undone" && state?.status !== "applied") {
            const button = el(
                "button",
                "pa-pagelet-tab-maintenance-action pa-pagelet-tab-maintenance-apply",
                state?.status === "applying"
                    ? pageletT("pagelet.tab.maintenance.applying", this.locale)
                    : pageletT("pagelet.tab.maintenance.applyMove", this.locale),
            );
            button.setAttribute("type", "button");
            if (state?.status === "applying") {
                button.disabled = true;
                button.setAttribute("aria-busy", "true");
            }
            button.addEventListener("click", (event) => {
                event.preventDefault();
                void this.applyMaintenanceProposalFromTab(proposal);
            });
            actionRow.appendChild(button);
        }

        if (hasUndoTarget) {
            const button = el(
                "button",
                "pa-pagelet-tab-maintenance-action pa-pagelet-tab-maintenance-undo",
                state?.status === "undoing"
                    ? pageletT("pagelet.tab.maintenance.undoing", this.locale)
                    : pageletT("pagelet.tab.maintenance.undoMove", this.locale),
            );
            button.setAttribute("type", "button");
            if (state?.status === "undoing") {
                button.disabled = true;
                button.setAttribute("aria-busy", "true");
            }
            button.addEventListener("click", (event) => {
                event.preventDefault();
                if (state?.actionId) {
                    void this.undoMaintenanceActionFromTab(proposal.id, state.actionId);
                }
            });
            actionRow.appendChild(button);
        }

        if (state) {
            const status = el(
                "span",
                "pa-pagelet-tab-maintenance-status",
                this.maintenanceActionStatusText(state),
            );
            status.setAttribute("data-status", state.status);
            actionRow.appendChild(status);
        }

        cardEl.appendChild(actionRow);
    }

    private maintenanceActionStatusText(state: MaintenanceActionUiState): string {
        if (state.status === "applying") return pageletT("pagelet.tab.maintenance.applying", this.locale);
        if (state.status === "applied") return pageletT("pagelet.tab.maintenance.moved", this.locale);
        if (state.status === "undoing") return pageletT("pagelet.tab.maintenance.undoing", this.locale);
        if (state.status === "undone") return pageletT("pagelet.tab.maintenance.undone", this.locale);
        return state.message || pageletT("pagelet.tab.maintenance.actionFailed", this.locale);
    }

    private async applyMaintenanceProposalFromTab(proposal: MaintenanceProposal): Promise<void> {
        if (!this.options.onApplyMaintenanceProposal) return;
        this.maintenanceActionState.set(proposal.id, {
            status: "applying",
            message: pageletT("pagelet.tab.maintenance.applying", this.locale),
        });
        this.renderContent(this.currentContent, this.currentOptions);

        try {
            const result = await this.options.onApplyMaintenanceProposal(proposal);
            if (result.ok) {
                this.maintenanceActionState.set(proposal.id, {
                    status: "applied",
                    message: result.message,
                    actionId: result.action.id,
                });
            } else {
                this.maintenanceActionState.set(proposal.id, {
                    status: "failed",
                    message: result.message || pageletT("pagelet.tab.maintenance.actionFailed", this.locale),
                });
            }
        } catch (error) {
            this.maintenanceActionState.set(proposal.id, {
                status: "failed",
                message: error instanceof Error
                    ? error.message
                    : pageletT("pagelet.tab.maintenance.actionFailed", this.locale),
            });
        }

        this.renderContent(this.currentContent, this.currentOptions);
    }

    private async undoMaintenanceActionFromTab(proposalId: string, actionId: string): Promise<void> {
        if (!this.options.onUndoMaintenanceAction) return;
        this.maintenanceActionState.set(proposalId, {
            status: "undoing",
            message: pageletT("pagelet.tab.maintenance.undoing", this.locale),
            actionId,
        });
        this.renderContent(this.currentContent, this.currentOptions);

        try {
            const result = await this.options.onUndoMaintenanceAction(actionId);
            if (result.ok) {
                this.maintenanceActionState.set(proposalId, {
                    status: "undone",
                    message: result.message,
                    actionId: result.action.id,
                });
            } else {
                this.maintenanceActionState.set(proposalId, {
                    status: "failed",
                    message: result.message || pageletT("pagelet.tab.maintenance.actionFailed", this.locale),
                    actionId,
                });
            }
        } catch (error) {
            this.maintenanceActionState.set(proposalId, {
                status: "failed",
                message: error instanceof Error
                    ? error.message
                    : pageletT("pagelet.tab.maintenance.actionFailed", this.locale),
                actionId,
            });
        }

        this.renderContent(this.currentContent, this.currentOptions);
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

    private renderReviewQueueContent(reviewQueue: { items: ReviewQueueItem[]; totalCount: number } | undefined): boolean {
        if (!this.bodyEl || !reviewQueue || reviewQueue.items.length === 0) return false;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-review-queue");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.reviewQueue.title", this.locale)));
        const summary = el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.reviewQueue.summary", this.locale, { count: reviewQueue.totalCount }));
        section.appendChild(summary);

        const allGroups = groupReviewQueueItemsForTab(reviewQueue.items);
        const filters = el("div", "pa-pagelet-tab-review-queue-filters");
        const renderFilterButton = (filter: ReviewQueueTabGroup | "all", label: string): void => {
            const button = el("button", "pa-pagelet-tab-review-queue-filter", label);
            button.setAttribute("type", "button");
            button.setAttribute("aria-pressed", String(this.reviewQueueTabFilter === filter));
            button.setAttribute("data-active", String(this.reviewQueueTabFilter === filter));
            button.addEventListener("click", (event) => {
                event.preventDefault();
                this.reviewQueueTabFilter = filter;
                this.renderContent(this.currentContent, this.currentOptions);
            });
            filters.appendChild(button);
        };
        renderFilterButton("all", pageletT("pagelet.tab.reviewQueue.filter.all", this.locale));
        for (const group of allGroups) {
            renderFilterButton(group.group, pageletT(`pagelet.tab.reviewQueue.group.${group.group}`, this.locale));
        }
        section.appendChild(filters);

        const groups = this.reviewQueueTabFilter === "all"
            ? allGroups
            : allGroups.filter((group) => group.group === this.reviewQueueTabFilter);
        for (const group of groups) {
            const groupEl = el("div", "pa-pagelet-tab-review-queue-group");
            groupEl.appendChild(el("h3", undefined, pageletT(`pagelet.tab.reviewQueue.group.${group.group}`, this.locale)));
            for (const item of group.items) {
                const isAiCallout = item.metadata?.renderStyle === "ai_callout";
                const cardEl = el(
                    "div",
                    isAiCallout
                        ? "pa-pagelet-tab-insight-card pa-pagelet-tab-review-queue-card pa-pagelet-tab-review-queue-card--ai-callout"
                        : "pa-pagelet-tab-insight-card pa-pagelet-tab-review-queue-card",
                );
                cardEl.appendChild(el("h4", undefined, item.title));
                const bodyP = el("p");
                if (isAiCallout) {
                    bodyP.appendChild(el(
                        "span",
                        "pa-pagelet-tab-review-queue-callout-label",
                        pageletT("pagelet.tab.reviewQueue.aiGenerated", this.locale),
                    ));
                    bodyP.appendChild(el("span", undefined, item.claim));
                } else {
                    bodyP.textContent = item.claim;
                }
                cardEl.appendChild(bodyP);
                const tagRow = el("div", "pa-pagelet-tab-tag-row");
                const typeLabel = pageletT(`pagelet.tab.reviewQueue.type.${item.type}`, this.locale);
                tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", typeLabel));
                tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", item.status));
                const source = item.sourceRefs[0]?.path;
                if (source) {
                    tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", source));
                }
                cardEl.appendChild(tagRow);
                groupEl.appendChild(cardEl);
            }
            section.appendChild(groupEl);
        }

        this.bodyEl.appendChild(section);
        return true;
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

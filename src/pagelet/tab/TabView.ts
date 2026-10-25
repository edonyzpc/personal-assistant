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
import type { PageletReadingTarget } from "../../ai-services/pagelet-handoff";
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../../platform-dom";
import { PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS } from "../agent/types";

import type { GeneratedReviewNote, WriteResult } from "../output/types";
import type { PanelFinding, PanelMemoryRecentChange, PageletReadingPosition } from "../panel/types";
import type { PageletAgentDeliveryCandidate } from "../agent/delivery-adapter";
import type {
    PageletDetailDeliveryTarget,
    PageletDetailPayload,
    PageletDetailReadingPayload,
    TabCard,
    TabEntryReason,
    TabSection,
} from "./types";
import {
    type ConfirmedMemoryRecord,
    type ContextPagerState,
    type GraphDiscoveryItem,
    type MaintenanceMoveApplyResult,
    type MaintenanceMoveUndoResult,
    type MaintenanceProposal,
    type ReviewQueueItem,
} from "../../pa";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import { clearChildren, el, renderEmptyCard } from "../dom-utils";
import {
    restorePageletReadingPosition,
    renderPageletReadingControls,
    renderPageletFindingActions,
    renderDiscoveryLayout,
    renderSummaryPreview,
    updatePageletDiscovery,
} from "../panel/PanelLayouts";
import type {
    MaintenanceActionUiState,
    MemoryCandidateActionState,
    MemoryCandidateActionResult,
    MemoryRecordActionResult,
    TabSectionCallbacks,
    TabSectionRenderer,
} from "./sections/types";
import { MemoryGovernanceSection } from "./sections/MemoryGovernanceSection";
import { MaintenanceReviewSection } from "./sections/MaintenanceReviewSection";
import { PageletNativeMarkdown } from "../native-markdown";
import { ReadingPositionController, type ReadingSnapshot } from "../../ui/reading-position";
import { pageletReadingAnchors, pageletReadingPosition, pageletReadingSnapshot, renderSimpleMarkdownPreview } from "../panel/PanelLayouts";
import { createPageletUiStore } from "../ui/pagelet-ui-store";
import { mountSavedInsightList, type SavedInsightListHandle } from "../ui/SavedInsightList";

export interface TabViewOptions {
    app?: App;
    isViewDisplayed?: () => boolean;
    onConnectionNodeClick?: (noteName: string, sourcePath?: string) => void;
    onSourcePathClick?: (path: string) => void;
    onSaveSummaryNote?: (note: GeneratedReviewNote) => Promise<WriteResult>;
    onApplyMaintenanceProposal?: (proposal: MaintenanceProposal) => Promise<MaintenanceMoveApplyResult>;
    onUndoMaintenanceAction?: (actionId: string) => Promise<MaintenanceMoveUndoResult>;
    onConfirmMemoryCandidate?: (item: ReviewQueueItem) => Promise<MemoryCandidateActionResult>;
    onDismissMemoryCandidate?: (item: ReviewQueueItem) => Promise<MemoryCandidateActionResult>;
    onCorrect?: (record: ConfirmedMemoryRecord, summary: string) => Promise<MemoryRecordActionResult>;
    onPauseUse?: (record: ConfirmedMemoryRecord) => Promise<MemoryRecordActionResult>;
    onResumeUse?: (record: ConfirmedMemoryRecord) => Promise<MemoryRecordActionResult>;
    onForget?: (record: ConfirmedMemoryRecord) => Promise<MemoryRecordActionResult>;
    onUndoRecentChange?: (change: PanelMemoryRecentChange) => Promise<MemoryRecordActionResult>;
    onOpenSource?: (path: string) => void;
    onOpenMemorySettings?: (targetId?: string) => void;
    /** @deprecated Use onForget. Kept while the plugin host migrates. */
    onForgetConfirmedMemory?: (record: ConfirmedMemoryRecord) => Promise<MemoryCandidateActionResult>;
}

type TabOpenOptions = Pick<PageletDetailPayload, "layoutType" | "extra" | "sourcePath" | "summarySaveNote" | "restoredFromState" | "entryReason" | "deliveryTarget" | "reading">;
type DetailExtra = NonNullable<PageletDetailPayload["extra"]>;

let tabLabelSequence = 0;

const ENTRY_REASON_TO_PRIMARY_SECTION: Partial<Record<TabEntryReason, string>> = {
    "maintenance": "maintenance",
    "graph-discovery": "graph-discovery",
    "pattern-detection": "pattern-detection",
};

const SECTION_TARGET_SUFFIXES: Partial<Record<string, readonly string[]>> = {
    memory: ["memory-governance", "memory"],
    maintenance: ["maintenance-review", "maintenance"],
    "context-pager": ["context-pager-details", "context-pager"],
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
    private readonly ui = createPageletUiStore();
    private savedSection: HTMLElement | null = null;
    private savedListHost: HTMLElement | null = null;
    private savedList: SavedInsightListHandle | null = null;
    private savedInsights: DetailExtra["savedInsights"];
    private readingPosition: ReadingPositionController | null = null;
    private lastPosition: PageletReadingPosition = { scrollTop: 0, sourcesExpanded: [] };
    private listPosition: ReadingSnapshot | null = null;
    private nativeBodies: PageletNativeMarkdown[] = [];
    private nativeEntity: string | null = null;
    private summaryEntity: GeneratedReviewNote | undefined;
    private readonly dismissedPatternIds = new Set<string>();
    private readonly memoryCandidateActionState = new Map<string, MemoryCandidateActionState>();
    private readonly maintenanceActionState = new Map<string, MaintenanceActionUiState>();
    private memoryDigestDeferred = false;
    private actionStateGeneration = 0;
    private disposed = false;
    private readonly committedDeliveryTargets = new WeakSet<object>();
    private reading: PageletDetailReadingPayload | null = null;
    private selectedReading: PageletAgentDeliveryCandidate | null = null;
    private readingControlsEl: HTMLElement | null = null;
    private readingNavigationEl: HTMLElement | null = null;
    private readingCandidatesEl: HTMLElement | null = null;
    private readingCandidateListEl: HTMLElement | null = null;
    private readingCandidateCountEl: HTMLElement | null = null;
    private readingCandidateSelectEl: HTMLSelectElement | null = null;
    private readingUpdateEl: HTMLElement | null = null;
    private readingSectionNavEl: HTMLElement | null = null;
    private readingSectionSelectEl: HTMLSelectElement | null = null;
    private readingScrollHandler: (() => void) | null = null;
    private sectionScrollHandler: (() => void) | null = null;
    private readingNavigationIdentity = "";
    private readingInitialSelectionPending = false;
    private readingUnsubscribe: (() => void) | null = null;
    private readingAction: AbortController | null = null;
    private readingHandoffPending = false;
    private readingValidation: AbortController | null = null;
    private readingValidationTask: Promise<boolean> | null = null;
    private readingMessage = "";
    private readingUnavailable = false;
    private readingExpiryTimer: PlatformTimeoutHandle | null = null;

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
            this.clearSectionActionState(this.currentOptions.layoutType !== options.layoutType
                || this.currentOptions.sourcePath !== options.sourcePath);
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

    /** Recheck a displayed reading after its native leaf becomes visible. */
    notifyDisplayed(): void {
        this.savedList?.notifyLayout();
        this.readingPosition?.notifyLayout();
        if (this.readingInitialSelectionPending) void this.validateDisplayedReading();
    }

    hasLivePageletReading(target: PageletReadingTarget): boolean {
        const candidate = this.findExactReadingCandidate(target);
        return candidate !== null && candidate.staleStatus !== "boundary-changed";
    }

    async revealPageletReading(target: PageletReadingTarget): Promise<boolean> {
        const reading = this.reading;
        const candidate = this.findExactReadingCandidate(target);
        if (!reading || !candidate || this.disposed || candidate.staleStatus === "boundary-changed") return false;

        if (this.selectedReading === candidate) {
            if (this.readingAction) return false;
            const valid = await this.validateDisplayedReading();
            if (this.disposed || this.reading !== reading || this.selectedReading !== candidate) return false;
            if (valid && this.readingInitialSelectionPending) {
                this.readingInitialSelectionPending = false;
                reading.onSelect(candidate);
            }
            return this.hasLivePageletReading(target);
        }

        return this.selectReading(candidate);
    }

    setDisplayed(visible: boolean): void {
        const wasVisible = this.ui.getState().viewVisible;
        if (!visible) this.readingPosition?.capture();
        this.ui.getState().setViewVisible(visible);
        for (const body of this.nativeBodies) body.setVisible(visible);
        if (visible) {
            if (!wasVisible) {
                const snapshot = this.reading ? pageletReadingSnapshot(this.lastPosition) : this.listPosition;
                if (snapshot) this.restorePosition(snapshot);
            }
            this.notifyDisplayed();
        }
    }

    rebindDocument(): void {
        for (const body of this.nativeBodies) body.rebindDocument();
        this.savedList?.rebindDocument();
        this.readingPosition?.rebindDocument();
    }

    /** Clean up -- remove DOM, detach listeners. */
    destroy(): void {
        this.disposed = true;
        this.releaseReading();
        this.readingPosition?.dispose();
        this.readingPosition = null;
        this.disposeSavedList();
        this.disposeNativeBodies();
        if (this.bodyEl && this.sectionScrollHandler) {
            this.bodyEl.removeEventListener("scroll", this.sectionScrollHandler);
        }
        this.sectionScrollHandler = null;
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

    private clearSectionActionState(resetExpansion = true): void {
        this.actionStateGeneration += 1;
        if (resetExpansion) this.ui.getState().setSectionsExpanded(false);
        this.memoryCandidateActionState.clear();
        this.maintenanceActionState.clear();
    }

    private createSectionCallbacks(): TabSectionCallbacks {
        const generation = this.actionStateGeneration;
        const app = this.options.app;
        return {
            requestRerender: () => this.handleSectionRerender(),
            canCommitActionState: () => !this.disposed && generation === this.actionStateGeneration,
            confirmAction: app
                ? (options) => confirmUserAction(app, options)
                : undefined,
        };
    }

    private renderExtractedSection<T>(
        data: T | undefined,
        factory: (data: T) => TabSectionRenderer,
        afterAppend?: (renderer: TabSectionRenderer) => void,
    ): boolean {
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
        afterAppend?.(renderer);
        return true;
    }

    private commitDeliveryTarget(target: PageletDetailDeliveryTarget | undefined): void {
        if (!target || this.committedDeliveryTargets.has(target)) return;
        this.committedDeliveryTargets.add(target);
        target.onVisible(target.receipt);
    }

    private handleSectionRerender(): void {
        const position = this.readingPosition?.capture();
        for (const renderer of this.sectionRenderers) {
            renderer.rerender();
        }
        this.savedList?.notifyLayout();
        if (position) this.restorePosition(position);
    }

    private rerenderCurrentContentPreservingScroll(): void {
        const position = this.readingPosition?.capture();
        this.renderContent(this.currentContent, this.currentOptions);
        if (position) this.restorePosition(position);
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
            btn.setAttribute("data-section-id", slot.id);
            btn.addEventListener("click", () => {
                const target = this.resolveSectionTarget(slot.id, slots);
                if (!target) return;
                this.scrollTabNavTarget(target);
            });
            nav.appendChild(btn);
        }
        this.bodyEl.prepend(nav);
        this.updateSectionNavigationCurrent();
    }

    private scrollTabNavTarget(target: Element): void {
        this.readingPosition?.cancelRestore();
        this.ui.getState().setSavedInsightRestoreTargetId(null);
        const details = target.closest(".pa-pagelet-tab-context-pager-details") as HTMLDetailsElement | null;
        if (details) {
            details.open = true;
            details.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    private updateSectionNavigationCurrent(): void {
        const body = this.bodyEl;
        if (!body) return;
        const buttons = Array.from(body.querySelectorAll("button"))
            .filter(button => button.getAttribute("data-section-id") !== null);
        if (buttons.length === 0) return;
        const bodyTop = body.getBoundingClientRect().top;
        let currentId = buttons[0]?.getAttribute("data-section-id") ?? "";
        const slots = buttons
            .map(button => button.getAttribute("data-section-id"))
            .filter((id): id is string => id !== null)
            .map(id => ({ id }));
        for (const button of buttons) {
            const sectionId = button.getAttribute("data-section-id");
            const target = sectionId ? this.resolveSectionTarget(sectionId, slots) : null;
            if (target && target.getBoundingClientRect().top - bodyTop <= 120) {
                currentId = sectionId ?? currentId;
            }
        }
        for (const button of buttons) {
            const sectionId = button.getAttribute("data-section-id");
            if (sectionId === currentId) button.setAttribute("aria-current", "true");
            else button.removeAttribute("aria-current");
        }
    }

    private resolveSectionTarget(
        sectionId: string,
        slots: readonly { id: string }[],
    ): Element | null {
        const body = this.bodyEl;
        if (!body) return null;
        const targetSuffixes = SECTION_TARGET_SUFFIXES[sectionId] ?? [sectionId];
        for (const suffix of targetSuffixes) {
            const target = body.querySelector(`.pa-pagelet-tab-${suffix}`);
            if (target) return target;
        }

        const sections = body.querySelectorAll(".pa-pagelet-tab-section, .pa-pagelet-tab-context-pager-details");
        const slotIndex = slots.findIndex(slot => slot.id === sectionId);
        return sections[slotIndex] ?? null;
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
        this.sectionScrollHandler = () => this.updateSectionNavigationCurrent();
        body.addEventListener("scroll", this.sectionScrollHandler);
        root.appendChild(body);
        this.readingPosition = new ReadingPositionController({
            scrollport: body,
            getAnchors: () => pageletReadingAnchors(body),
            isVisible: () => this.ui.getState().viewVisible,
            isReady: () => {
                if (!this.nativeBodies.every(native => native.isReady())) return false;
                const target = this.ui.getState().savedInsightRestoreTargetId;
                if (!target || !this.savedInsights?.items.some(item => item.id === target)) return true;
                const anchor = pageletReadingAnchors(body).find(item => item.id === `saved-insight:${target}`);
                const rect = anchor?.element.getBoundingClientRect();
                return !!rect && rect.width > 0 && rect.height > 0;
            },
            onSnapshot: snapshot => {
                this.lastPosition = pageletReadingPosition(body, snapshot);
                if (this.reading && this.selectedReading) {
                    this.reading.onPositionChange(this.selectedReading.id, this.lastPosition);
                } else this.listPosition = snapshot;
            },
            onUserIntent: () => this.ui.getState().setSavedInsightRestoreTargetId(null),
            restoreDisclosures: ids => {
                for (const toggle of Array.from(body.querySelectorAll<HTMLElement>('.pa-pagelet-panel-source-toggle'))) {
                    const expanded = ids.includes(toggle.getAttribute('data-pa-source-disclosure') ?? 'sources');
                    toggle.setAttribute('aria-expanded', String(expanded));
                    const chips = toggle.parentElement?.querySelector('.pa-pagelet-panel-source-chips');
                    if (expanded) chips?.removeAttribute('hidden'); else chips?.setAttribute('hidden', '');
                }
            },
        });

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
        if (options.reading && this.reading === options.reading && !options.restoredFromState) {
            this.renderSelectedReading();
            this.refreshReadingControls();
            return;
        }
        const keepSummary = options.layoutType === 'summary' && options.summarySaveNote
            && this.summaryEntity === options.summarySaveNote
            && this.nativeEntity === `summary:${options.summarySaveNote.targetPath}`;
        if (keepSummary && this.nativeBodies.length && typeof options.extra?.markdown === 'string') {
            this.nativeBodies[0].update(options.extra.markdown, options.sourcePath ?? '');
            this.renderSavedInsightContent(options.extra?.savedInsights);
            this.destroySectionRenderers();
            this.bodyEl.querySelector('.pa-pagelet-tab-memory-governance')?.parentElement?.remove();
            this.renderMemoryGovernance(options.extra?.memoryGovernance);
            this.activateSavedList();
            return;
        }
        const position = this.readingPosition?.capture();
        this.readingPosition?.cancelRestore();
        this.ui.getState().setSavedInsightRestoreTargetId(null);
        this.releaseReading();
        this.disposeNativeBodies();
        if (options.reading || options.restoredFromState || !options.extra?.savedInsights?.items.length
            || options.layoutType === 'discover' || options.layoutType === 'summary') this.disposeSavedList();
        this.destroySectionRenderers();
        for (const child of Array.from(this.bodyEl.children)) {
            if (child !== this.savedSection) child.remove();
        }

        if (options.reading && !options.restoredFromState) {
            this.renderReading(options.reading);
            return;
        }

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
                        onCorrect: this.options.onCorrect,
                        onPauseUse: this.options.onPauseUse,
                        onResumeUse: this.options.onResumeUse,
                        onForget: this.options.onForget ?? this.options.onForgetConfirmedMemory,
                        onUndoRecentChange: this.options.onUndoRecentChange,
                        onOpenSource: this.options.onOpenSource,
                        onOpenMemorySettings: this.options.onOpenMemorySettings,
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
                        onCorrect: this.options.onCorrect,
                        onPauseUse: this.options.onPauseUse,
                        onResumeUse: this.options.onResumeUse,
                        onForget: this.options.onForget ?? this.options.onForgetConfirmedMemory,
                        onUndoRecentChange: this.options.onUndoRecentChange,
                        onOpenSource: this.options.onOpenSource,
                        onOpenMemorySettings: this.options.onOpenMemorySettings,
                        isDigestDeferred: () => this.memoryDigestDeferred,
                        onDeferDigest: () => { this.memoryDigestDeferred = true; },
                    }, sectionCallbacks, this.memoryCandidateActionState),
                );
                if (!renderedSavedInsights && !renderedMemoryGovernance) this.renderEmptyState();
            }
            this.activateSavedList();
            if (position) this.restorePosition(position);
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
                    collapsibleConnectionGraph: true,
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
                    onCorrect: this.options.onCorrect,
                    onPauseUse: this.options.onPauseUse,
                    onResumeUse: this.options.onResumeUse,
                    onForget: this.options.onForget ?? this.options.onForgetConfirmedMemory,
                    onUndoRecentChange: this.options.onUndoRecentChange,
                    onOpenSource: this.options.onOpenSource,
                    onOpenMemorySettings: this.options.onOpenMemorySettings,
                    isDigestDeferred: () => this.memoryDigestDeferred,
                    onDeferDigest: () => { this.memoryDigestDeferred = true; },
                }, sectionCallbacks, this.memoryCandidateActionState)) },
            { id: "maintenance", labelKey: "pagelet.tab.maintenance.title", render: () => this.renderExtractedSection(options.extra?.maintenanceReview, (data) =>
                new MaintenanceReviewSection(this.locale, data, {
                    onApply: this.options.onApplyMaintenanceProposal,
                    onUndo: this.options.onUndoMaintenanceAction,
                }, sectionCallbacks, this.maintenanceActionState)) },
            { id: "graph-discovery", labelKey: "pagelet.tab.graphDiscovery.title", render: () => this.renderGraphDiscoveryContent(options.extra?.graphDiscovery) },
            { id: "pattern-detection", labelKey: "pagelet.tab.patterns.title", render: () => this.renderPatternDetectionContent(options.extra?.patternDetection) },
            { id: "saved-insights", labelKey: "pagelet.tab.savedInsights.title", render: () => this.renderSavedInsightContent(options.extra?.savedInsights, true) },
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

        const visibleSlots = (renderedSlots.length > 3 && !this.ui.getState().sectionsExpanded)
            ? renderedSlots.slice(0, 3)
            : renderedSlots;
        if (visibleSlots.length >= 3) {
            this.renderSectionNav(visibleSlots);
        }

        if (renderedSlots.length > 3 && !this.ui.getState().sectionsExpanded && this.bodyEl) {
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
                this.readingPosition?.cancelRestore();
                this.ui.getState().setSavedInsightRestoreTargetId(null);
                this.ui.getState().setSectionsExpanded(true);
                showMoreBtn.setAttribute("aria-expanded", "true");
                for (const section of allSections) section.classList.remove('pa-pagelet-tab-section--hidden');
                showMoreBtn.remove();
                this.bodyEl?.querySelector('.pa-pagelet-tab-nav')?.remove();
                this.renderSectionNav(renderedSlots);
                this.activateSavedList();
            });
            this.bodyEl.appendChild(showMoreBtn);
        }

        if (renderedSlots.length === 0) {
            this.renderEmptyState();
        }
        this.activateSavedList();
        if (position) this.restorePosition(position);
    }

    private renderReading(reading: PageletDetailReadingPayload): void {
        this.reading = reading;
        this.rootEl?.classList.add("pa-pagelet-tab--reading");
        this.selectedReading = reading.candidates.find(candidate => candidate.id === reading.selectedId) ?? null;
        this.readingInitialSelectionPending = this.selectedReading !== null;
        this.readingUnavailable = this.selectedReading?.staleStatus === "stale";
        this.readingMessage = this.readingUnavailable ? pageletT("pagelet.reading.stale", this.locale) : "";
        this.readingControlsEl = el("div", "pa-pagelet-reading-controls");
        const navigation = this.buildReadingNavigation();
        this.rootEl?.prepend(navigation);
        this.rootEl?.prepend(this.readingControlsEl);
        this.renderSelectedReading();
        this.refreshReadingControls();
        this.readingScrollHandler = () => this.updateReadingCurrentSection();
        this.bodyEl?.addEventListener("scroll", this.readingScrollHandler);
        this.readingUnsubscribe = reading.subscribe(() => {
            if (this.disposed || this.reading !== reading) return;
            const hydrated = !this.selectedReading
                && reading.candidates.find(candidate => candidate.id === reading.selectedId);
            if (hydrated) {
                this.selectedReading = hydrated;
                this.readingInitialSelectionPending = true;
                this.renderSelectedReading();
            }
            if (this.selectedReading?.staleStatus === "stale") this.markDisplayedReadingStale();
            this.refreshReadingControls();
            void this.validateDisplayedReading();
        });
        void this.validateDisplayedReading();
    }

    private buildReadingNavigation(): HTMLElement {
        const navigation = el("nav", "pa-pagelet-reading-navigation");
        navigation.setAttribute("aria-label", pageletT("pagelet.reading.navigation.ariaLabel", this.locale));

        const header = el("header", "pa-pagelet-reading-header");
        header.appendChild(el("div", "pa-pagelet-reading-eyebrow",
            pageletT("pagelet.reading.currentResultType", this.locale)));
        header.appendChild(el("div", "pa-pagelet-reading-note", this.reading?.anchorPath ?? ""));
        navigation.appendChild(header);

        const candidates = el("section", "pa-pagelet-reading-candidates");
        candidates.setAttribute("aria-label", pageletT("pagelet.reading.candidates.ariaLabel", this.locale));
        this.readingCandidatesEl = candidates;
        this.readingCandidateListEl = el("div", "pa-pagelet-reading-candidate-list");
        candidates.appendChild(this.readingCandidateListEl);
        const picker = el("label", "pa-pagelet-reading-picker");
        this.readingCandidateCountEl = el("span", "pa-pagelet-reading-picker-count");
        picker.appendChild(this.readingCandidateCountEl);
        this.readingCandidateSelectEl = el("select", "pa-pagelet-reading-select");
        this.readingCandidateSelectEl.setAttribute("aria-label",
            pageletT("pagelet.reading.candidates.ariaLabel", this.locale));
        this.readingCandidateSelectEl.addEventListener("change", () => {
            const candidate = this.reading?.candidates.find(item => item.id === this.readingCandidateSelectEl?.value);
            if (candidate) void this.selectReading(candidate);
        });
        picker.appendChild(this.readingCandidateSelectEl);
        candidates.appendChild(picker);
        navigation.appendChild(candidates);

        this.readingUpdateEl = el("section", "pa-pagelet-reading-update");
        this.readingUpdateEl.setAttribute("aria-label",
            pageletT("pagelet.reading.newResults", this.locale));
        this.readingUpdateEl.setAttribute("hidden", "");
        navigation.appendChild(this.readingUpdateEl);

        this.readingSectionNavEl = el("section", "pa-pagelet-reading-sections");
        this.readingSectionNavEl.setAttribute("aria-label",
            pageletT("pagelet.tab.nav.ariaLabel", this.locale));
        this.readingSectionNavEl.setAttribute("hidden", "");
        navigation.appendChild(this.readingSectionNavEl);

        const sectionPicker = el("label", "pa-pagelet-reading-picker pa-pagelet-reading-section-picker");
        sectionPicker.appendChild(el("span", "pa-sr-only",
            pageletT("pagelet.reading.sections.ariaLabel", this.locale)));
        this.readingSectionSelectEl = el("select", "pa-pagelet-reading-select");
        this.readingSectionSelectEl.setAttribute("aria-label",
            pageletT("pagelet.reading.sections.ariaLabel", this.locale));
        this.readingSectionSelectEl.setAttribute("hidden", "");
        this.readingSectionSelectEl.addEventListener("change", () => {
            const target = this.bodyEl?.querySelector(`[id="${this.readingSectionSelectEl?.value}"]`);
            if (target) this.scrollTabNavTarget(target);
        });
        sectionPicker.appendChild(this.readingSectionSelectEl);
        navigation.appendChild(sectionPicker);

        this.readingNavigationEl = navigation;
        return navigation;
    }

    private rememberReadingPosition(): void {
        if (!this.reading || !this.selectedReading || !this.bodyEl
            || this.selectedReading.staleStatus === "boundary-changed") return;
        this.readingPosition?.capture();
        const position = this.lastPosition;
        this.reading.positions = { ...this.reading.positions, [this.selectedReading.id]: position };
        this.reading.onPositionChange(this.selectedReading.id, position);
    }

    private releaseReading(): void {
        this.rememberReadingPosition();
        this.rootEl?.classList.remove("pa-pagelet-tab--reading");
        this.readingUnsubscribe?.();
        this.readingUnsubscribe = null;
        this.readingAction?.abort();
        this.readingAction = null;
        this.readingHandoffPending = false;
        this.readingValidation?.abort();
        this.readingValidation = null;
        this.readingValidationTask = null;
        this.clearReadingExpiry();
        this.readingControlsEl?.remove();
        this.readingControlsEl = null;
        if (this.bodyEl && this.readingScrollHandler) {
            this.bodyEl.removeEventListener("scroll", this.readingScrollHandler);
        }
        this.readingScrollHandler = null;
        this.readingNavigationEl?.remove();
        this.readingNavigationEl = null;
        this.readingCandidatesEl = null;
        this.readingCandidateListEl = null;
        this.readingCandidateCountEl = null;
        this.readingCandidateSelectEl = null;
        this.readingUpdateEl = null;
        this.readingSectionNavEl = null;
        this.readingSectionSelectEl = null;
        this.readingNavigationIdentity = "";
        this.readingInitialSelectionPending = false;
        this.reading = null;
        this.selectedReading = null;
        this.readingMessage = "";
        this.readingUnavailable = false;
    }

    private renderSelectedReading(): void {
        if (!this.bodyEl || !this.reading) return;
        const candidate = this.selectedReading;
        const body = this.bodyEl;
        if (!candidate || candidate.staleStatus === 'boundary-changed') {
            this.readingPosition?.cancelRestore();
            this.disposeNativeBodies();
            clearChildren(body);
            this.renderReadingSectionNavigation();
            return;
        }
        const position: PageletReadingPosition = this.reading.positions[candidate.id]
            ?? { scrollTop: 0, sourcesExpanded: [] };
        const findings: PanelFinding[] = candidate.sourceRefs.map((source, index) => ({
            title: index === 0 ? candidate.title : source.title ?? source.path,
            description: index === 0 ? candidate.body : source.path,
            sourceFile: source.path,
            ...(index === 0 ? {
                insightText: candidate.body,
                actions: this.readingActions(candidate),
            } : {}),
        }));
        if (findings.length === 0) {
            findings.push({
                title: candidate.title,
                description: candidate.body,
                insightText: candidate.body,
                actions: this.readingActions(candidate),
            });
        }
        if (this.nativeEntity === `candidate:${candidate.id}` && this.nativeBodies.length) {
            this.nativeBodies[0].update(candidate.body, this.reading.anchorPath);
            updatePageletDiscovery(body, findings, this.locale, { sourcePath: this.reading.anchorPath,
                onConnectionNodeClick: this.options.onConnectionNodeClick,
                onSourceDisclosureChange: () => this.readingPosition?.capture() });
            this.readingPosition?.notifyLayout();
            return;
        }
        this.readingPosition?.cancelRestore();
        this.unloadRenderComponent();
        this.disposeNativeBodies();
        clearChildren(body);
        this.nativeEntity = `candidate:${candidate.id}`;
        renderDiscoveryLayout(body, findings, undefined, this.locale, {
            sourcePath: this.reading.anchorPath,
            onConnectionNodeClick: this.options.onConnectionNodeClick,
            onSourceDisclosureChange: () => this.readingPosition?.capture(),
            reading: true,
            renderNativeMarkdown: (host, markdown) => this.mountNativeBody(host, markdown, this.reading?.anchorPath ?? ''),
        });
        restorePageletReadingPosition(body, position);
        this.lastPosition = position;
        this.restorePosition(pageletReadingSnapshot(position));
        this.renderReadingSectionNavigation();
    }

    private refreshReadingControls(): void {
        const reading = this.reading;
        if (!reading || !this.readingControlsEl || !this.readingNavigationEl) return;
        reading.candidates = reading.candidates.filter(candidate => candidate.staleStatus !== "boundary-changed");
        const partial = this.selectedReading?.pageletAgent.runIncomplete
            ? pageletT("pagelet.deepDiscover.partialResults", this.locale) : "";
        const controls = reading.getReadingControls();
        renderPageletReadingControls(this.readingControlsEl, {
            ...controls,
            label: [this.readingMessage, controls.label, partial].filter(Boolean).join(" "),
        });
        const latest = reading.getLatestCandidates();
        const navigationIdentity = JSON.stringify([
            reading.candidates.map(candidate => [candidate.id, candidate.preparedAt]),
            this.selectedReading?.id,
            latest.map(candidate => [candidate.id, candidate.preparedAt]),
        ]);
        if (navigationIdentity === this.readingNavigationIdentity) return;
        this.readingNavigationIdentity = navigationIdentity;
        this.refreshReadingCandidates(reading, latest);
    }

    private refreshReadingCandidates(
        reading: PageletDetailReadingPayload,
        latest: readonly PageletAgentDeliveryCandidate[],
    ): void {
        const hasCandidates = reading.candidates.length > 0;
        const list = this.readingCandidateListEl;
        const select = this.readingCandidateSelectEl;
        if (list) clearChildren(list);
        if (select) clearChildren(select);
        if (this.readingCandidatesEl) {
            if (hasCandidates) this.readingCandidatesEl.removeAttribute("hidden");
            else this.readingCandidatesEl.setAttribute("hidden", "");
        }
        if (hasCandidates) {
            if (list && select) {
                const selectedIndex = reading.candidates.findIndex(
                    candidate => candidate.id === this.selectedReading?.id,
                );
                const currentIndex = selectedIndex >= 0
                    ? selectedIndex + 1
                    : reading.candidates.length;
                const countLabel = pageletT("pagelet.reading.candidateCount", this.locale, {
                    current: currentIndex,
                    total: reading.candidates.length,
                });
                list.appendChild(el("div", "pa-pagelet-reading-candidate-count", countLabel));
                if (this.readingCandidateCountEl) this.readingCandidateCountEl.textContent = countLabel;
                for (const candidate of reading.candidates) {
                    const button = el("button", "pa-pagelet-tab-nav-item", candidate.title);
                    button.setAttribute("type", "button");
                    button.setAttribute("aria-pressed", String(candidate.id === this.selectedReading?.id));
                    button.setAttribute("data-index", String(select.children.length + 1));
                    button.addEventListener("click", () => { void this.selectReading(candidate); });
                    list.appendChild(button);
                    const option = el("option", undefined, candidate.title);
                    option.value = candidate.id;
                    if (candidate.id === this.selectedReading?.id) option.setAttribute("selected", "true");
                    select.appendChild(option);
                }
                select.value = this.selectedReading?.id ?? "";
            }
        }

        const hasNewResults = latest.some(candidate => !reading.candidates.some(current => current.id === candidate.id
            && current.preparedAt === candidate.preparedAt));
        const updateEl = this.readingUpdateEl;
        if (!updateEl) return;
        clearChildren(updateEl);
        if (!hasNewResults) {
            updateEl.setAttribute("hidden", "");
            return;
        }
        updateEl.removeAttribute("hidden");
        const button = el("button", "pa-pagelet-tab-nav-item",
            pageletT("pagelet.reading.showNew", this.locale));
        button.setAttribute("type", "button");
        button.addEventListener("click", () => {
            if (this.reading !== reading || latest.length === 0) return;
            void this.selectReading(latest[0]!, latest);
        });
        button.classList.add("pa-pagelet-reading-candidate--new");
        updateEl.appendChild(button);
    }

    private renderReadingSectionNavigation(): void {
        const sectionNav = this.readingSectionNavEl;
        const sectionSelect = this.readingSectionSelectEl;
        if (!sectionNav || !sectionSelect || !this.bodyEl) return;
        clearChildren(sectionNav);
        clearChildren(sectionSelect);
        const headings = Array.from(this.bodyEl.querySelectorAll("h1, h2, h3"))
            .filter(heading => (heading.textContent ?? "").trim().length > 0);
        if (headings.length <= 1) {
            sectionNav.setAttribute("hidden", "");
            sectionSelect.setAttribute("hidden", "");
            return;
        }

        sectionNav.removeAttribute("hidden");
        sectionSelect.removeAttribute("hidden");
        sectionNav.appendChild(el("span", "pa-pagelet-reading-section-label",
            pageletT("pagelet.reading.sections.ariaLabel", this.locale)));
        const links = el("div", "pa-pagelet-reading-section-links");
        sectionNav.appendChild(links);
        headings.forEach((heading, index) => {
            const id = heading.getAttribute("id") ?? `pa-pagelet-reading-section-${++tabLabelSequence}`;
            heading.setAttribute("id", id);
            const label = (heading.textContent ?? "").trim();
            const button = el("button", "pa-pagelet-tab-nav-item", label);
            button.setAttribute("type", "button");
            button.setAttribute("data-target-id", id);
            button.addEventListener("click", () => this.scrollTabNavTarget(heading));
            links.appendChild(button);

            const option = el("option", undefined, label);
            option.value = id;
            if (index === 0) option.setAttribute("selected", "true");
            sectionSelect.appendChild(option);
        });
        sectionSelect.value = headings[0]?.getAttribute("id") ?? "";
    }

    private updateReadingCurrentSection(): void {
        const sectionSelect = this.readingSectionSelectEl;
        if (!sectionSelect || !this.bodyEl) return;
        const buttons = Array.from(this.readingSectionNavEl?.querySelectorAll("button") ?? []);
        const bodyTop = this.bodyEl.getBoundingClientRect().top;
        let currentId = buttons[0]?.getAttribute("data-target-id") ?? "";
        for (const button of buttons) {
            const id = button.getAttribute("data-target-id");
            const target = id ? this.bodyEl.querySelector(`[id="${id}"]`) : null;
            if (target && target.getBoundingClientRect().top - bodyTop <= 112) currentId = id ?? currentId;
        }
        for (const button of buttons) {
            const id = button.getAttribute("data-target-id");
            if (id === currentId) button.setAttribute("aria-current", "true");
            else button.removeAttribute("aria-current");
        }
        sectionSelect.value = currentId;
    }

    private async validateDisplayedReading(): Promise<boolean> {
        const reading = this.reading;
        const candidate = this.selectedReading;
        if (!reading || !candidate) return false;
        if (this.readingValidation && this.readingValidationTask
            && !this.readingValidation.signal.aborted
            && this.reading === reading
            && this.selectedReading === candidate) return this.readingValidationTask;
        this.readingValidation?.abort();
        const controller = new AbortController();
        this.readingValidation = controller;
        const validation = (async () => {
            let valid = false;
            try {
                valid = await reading.validate(candidate, controller.signal);
            } catch { /* Source validation is unavailable. */ }
            if (controller.signal.aborted || this.reading !== reading || this.selectedReading !== candidate) return false;
            this.readingValidation = null;
            this.readingValidationTask = null;
            if (valid) {
                candidate.staleStatus = "fresh";
                if (this.readingInitialSelectionPending) {
                    if (this.options.isViewDisplayed?.() ?? true) {
                        this.readingInitialSelectionPending = false;
                        reading.onSelect(candidate);
                    }
                }
                if (this.readingUnavailable) {
                    this.readingUnavailable = false;
                    this.readingMessage = "";
                    this.refreshReadingActions();
                    this.refreshReadingControls();
                }
                this.scheduleReadingExpiry(candidate);
                return true;
            }
            this.markDisplayedReadingStale();
            return false;
        })();
        this.readingValidationTask = validation;
        return validation;
    }

    private readingActions(candidate: PageletAgentDeliveryCandidate): NonNullable<PanelFinding["actions"]> {
        return [{
            label: pageletT("pagelet.panel.agentInsight.discuss", this.locale),
            disabled: this.readingUnavailable || candidate.staleStatus === "stale" || candidate.staleStatus === "boundary-changed",
            callback: () => { void this.discussReading(candidate); },
        }];
    }

    private refreshReadingActions(): void {
        const candidate = this.selectedReading;
        const region = this.bodyEl?.querySelector<HTMLElement>(".pa-pagelet-panel-finding-actions");
        if (candidate && region) renderPageletFindingActions(region, {
            title: candidate.title, description: candidate.body, actions: this.readingActions(candidate),
        });
    }

    private markDisplayedReadingStale(): void {
        const candidate = this.selectedReading;
        if (!candidate) return;
        this.readingUnavailable = true;
        this.clearReadingExpiry();
        const boundaryChanged = candidate.staleStatus === "boundary-changed";
        if (!boundaryChanged) candidate.staleStatus = "stale";
        this.readingMessage = pageletT(boundaryChanged ? "pagelet.deepDiscover.boundaryDenied" : "pagelet.reading.stale", this.locale);
        if (this.readingHandoffPending) {
            this.readingAction?.abort();
            this.readingAction = null;
            this.readingHandoffPending = false;
        }
        if (boundaryChanged) this.renderSelectedReading();
        else this.refreshReadingActions();
        this.refreshReadingControls();
    }

    private clearReadingExpiry(): void {
        if (this.readingExpiryTimer !== null) clearPlatformTimeout(this.readingExpiryTimer);
        this.readingExpiryTimer = null;
    }

    private scheduleReadingExpiry(candidate: PageletAgentDeliveryCandidate): void {
        this.clearReadingExpiry();
        const identity = candidate.pageletAgent.validationIdentity;
        if (!identity || candidate.staleStatus === "stale" || (!identity.webObservations.length
            && !identity.inputEvidence?.lineage.dependencies.some(dependency => dependency.kind === "web"))) return;
        const remaining = identity.preparedAt + PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS - Date.now();
        if (remaining <= 0) return;
        this.readingExpiryTimer = setPlatformTimeout(() => {
            this.readingExpiryTimer = null;
            if (this.selectedReading === candidate) void this.validateDisplayedReading();
        }, remaining);
    }

    private findExactReadingCandidate(target: PageletReadingTarget): PageletAgentDeliveryCandidate | null {
        return this.reading?.candidates.find(candidate => (
            this.reading!.anchorPath === target.anchorPath
            && candidate.id === target.candidateId
            && candidate.pageletAgent.handoff.id === target.candidateId
            && candidate.pageletAgent.handoff.anchor.path === target.anchorPath
            && candidate.pageletAgent.handoff.bodyHash === target.bodyHash
        )) ?? null;
    }

    private async selectReading(
        candidate: PageletAgentDeliveryCandidate,
        candidates?: readonly PageletAgentDeliveryCandidate[],
    ): Promise<boolean> {
        const reading = this.reading;
        if (!reading || this.disposed) return false;
        this.readingInitialSelectionPending = false;
        this.readingAction?.abort();
        this.readingHandoffPending = false;
        const controller = new AbortController();
        this.readingAction = controller;
        let valid = false;
        try { valid = await reading.validate(candidate, controller.signal); } catch { /* Keep the current reading on validation failure. */ }
        if (controller.signal.aborted || this.reading !== reading) return false;
        this.readingAction = null;
        if (!valid && (candidate.staleStatus === "boundary-changed" || candidates)) {
            this.readingMessage = pageletT("pagelet.deepDiscover.stale", this.locale);
            this.refreshReadingControls();
            return false;
        }
        this.rememberReadingPosition();
        this.readingValidation?.abort();
        this.readingValidation = null;
        if (candidates) reading.candidates = candidates;
        this.selectedReading = candidate;
        reading.selectedId = candidate.id;
        this.readingMessage = valid ? "" : pageletT("pagelet.reading.stale", this.locale);
        this.readingUnavailable = !valid;
        if (!valid) candidate.staleStatus = "stale";
        this.renderSelectedReading();
        if (candidates) reading.onSelect(candidate, candidates);
        else reading.onSelect(candidate);
        this.refreshReadingControls();
        if (valid) this.scheduleReadingExpiry(candidate);
        else this.clearReadingExpiry();
        return candidate.staleStatus !== "boundary-changed";
    }

    private async discussReading(candidate: PageletAgentDeliveryCandidate): Promise<void> {
        const reading = this.reading;
        if (!reading || this.disposed || this.selectedReading !== candidate || this.readingAction || this.readingUnavailable
            || candidate.staleStatus === "stale" || candidate.staleStatus === "boundary-changed") return;
        const controller = new AbortController();
        this.readingAction = controller;
        this.readingHandoffPending = true;
        this.readingMessage = pageletT("pagelet.panel.agentInsight.handoffOpening", this.locale);
        this.refreshReadingControls();
        try {
            const valid = await reading.validate(candidate, controller.signal);
            if (controller.signal.aborted || this.reading !== reading || this.selectedReading !== candidate) return;
            if (!valid) {
                this.markDisplayedReadingStale();
                return;
            }
            const result = await reading.discuss(candidate, controller.signal);
            if (controller.signal.aborted || this.reading !== reading || this.selectedReading !== candidate) return;
            const key = result.status === "busy" ? "pagelet.panel.agentInsight.handoffBusy"
                : result.status === "draft-conflict" ? "pagelet.panel.agentInsight.handoffDraft"
                    : "pagelet.panel.agentInsight.handoffUnavailable";
            this.readingMessage = result.status === "prepared" ? "" : pageletT(key, this.locale);
        } catch {
            if (!controller.signal.aborted && this.reading === reading && this.selectedReading === candidate) {
                this.readingMessage = pageletT("pagelet.panel.agentInsight.handoffUnavailable", this.locale);
            }
        } finally {
            if (this.readingAction === controller) {
                this.readingAction = null;
                this.readingHandoffPending = false;
                this.refreshReadingControls();
            }
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
        const details = el("details", "pa-pagelet-tab-context-pager-details");
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

    private renderSavedInsightContent(savedInsights: DetailExtra["savedInsights"], placeAfterRenderedSections = false): boolean {
        if (!this.bodyEl || !savedInsights?.items.length) { this.disposeSavedList(); return false; }
        this.savedInsights = savedInsights;
        if (!this.savedSection) {
            this.savedSection = el('div', 'pa-pagelet-tab-section pa-pagelet-tab-saved-insights');
            this.savedSection.appendChild(el('h2'));
            this.savedSection.appendChild(el('p', 'pa-pagelet-tab-review-queue-summary'));
            this.savedListHost = el('div');
            this.savedSection.appendChild(this.savedListHost);
        }
        this.savedSection.classList.remove('pa-pagelet-tab-section--hidden');
        this.savedSection.querySelector('h2')!.textContent = pageletT('pagelet.tab.savedInsights.title', this.locale);
        this.savedSection.querySelector('p')!.textContent = pageletT('pagelet.tab.savedInsights.summary', this.locale, { count: savedInsights.totalCount });
        if (this.savedSection.parentElement !== this.bodyEl) this.bodyEl.appendChild(this.savedSection);
        else if (placeAfterRenderedSections) {
            // Keep the live React host connected; only move newly built preceding sections.
            for (const child of Array.from(this.bodyEl.children)) {
                if (child !== this.savedSection) this.bodyEl.insertBefore(child, this.savedSection);
            }
        }
        return true;
    }

    private renderMemoryGovernance(data: DetailExtra['memoryGovernance']): boolean {
        return this.renderExtractedSection(data, value => new MemoryGovernanceSection(this.locale, value, {
            onConfirm: this.options.onConfirmMemoryCandidate,
            onDismiss: this.options.onDismissMemoryCandidate,
            onCorrect: this.options.onCorrect,
            onPauseUse: this.options.onPauseUse,
            onResumeUse: this.options.onResumeUse,
            onForget: this.options.onForget ?? this.options.onForgetConfirmedMemory,
            onUndoRecentChange: this.options.onUndoRecentChange,
            onOpenSource: this.options.onOpenSource,
            onOpenMemorySettings: this.options.onOpenMemorySettings,
            isDigestDeferred: () => this.memoryDigestDeferred,
            onDeferDigest: () => { this.memoryDigestDeferred = true; },
        }, this.createSectionCallbacks(), this.memoryCandidateActionState));
    }

    private activateSavedList(): void {
        if (!this.savedListHost || !this.savedInsights || !this.bodyEl
            || this.savedSection?.classList.contains('pa-pagelet-tab-section--hidden')) {
            this.savedList?.notifyLayout();
            return;
        }
        const props = { items: this.savedInsights.items, locale: this.locale, scrollport: this.bodyEl,
            store: this.ui, isRestoring: () => this.readingPosition?.isRestoring() ?? false,
            onLayout: () => {
                this.readingPosition?.notifyLayout();
                if (this.ui.getState().savedInsightRestoreTargetId === null) {
                    this.readingPosition?.capture();
                }
            } };
        if (this.savedList) this.savedList.update(props);
        else this.savedList = mountSavedInsightList(this.savedListHost, props);
        this.savedList.notifyLayout();
    }

    private disposeSavedList(): void {
        this.savedList?.unmount();
        this.savedList = null;
        this.savedSection?.remove();
        this.savedSection = null;
        this.savedListHost = null;
        this.savedInsights = undefined;
        this.listPosition = null;
        this.ui.getState().setSavedInsightRestoreTargetId(null);
    }

    private restorePosition(snapshot: ReadingSnapshot): void {
        this.ui.getState().setSavedInsightRestoreTargetId(snapshot.anchorId?.startsWith('saved-insight:')
            ? snapshot.anchorId.slice('saved-insight:'.length) : null);
        this.readingPosition?.restore(snapshot);
        this.savedList?.notifyLayout();
    }

    private mountNativeBody(host: HTMLElement, markdown: string, sourcePath: string): HTMLElement {
        if (this.nativeEntity) host.setAttribute('data-pa-reading-id', this.nativeEntity);
        const native = new PageletNativeMarkdown(host, { app: this.options.app, locale: this.locale,
            visible: this.ui.getState().viewVisible, fallback: renderSimpleMarkdownPreview,
            onLayout: () => {
                this.renderReadingSectionNavigation();
                this.updateReadingCurrentSection();
                this.readingPosition?.notifyLayout();
                this.savedList?.notifyLayout();
            } });
        this.nativeBodies.push(native);
        native.update(markdown, sourcePath);
        return native.controls;
    }

    private disposeNativeBodies(): void {
        for (const native of this.nativeBodies) native.dispose();
        this.nativeBodies = [];
        this.nativeEntity = null;
        this.summaryEntity = undefined;
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

        const hasNoteAnchor = Boolean(
            this.currentOptions.reading?.anchorPath
            ?? (this.currentOptions.layoutType === "discover" ? this.currentOptions.sourcePath : undefined),
        );
        const titleKey = hasNoteAnchor
            ? "pagelet.tab.restoredNote.title"
            : "pagelet.tab.restored.title";
        const bodyKey = hasNoteAnchor
            ? "pagelet.tab.restoredNote.body"
            : "pagelet.tab.restored.body";
        const section = el("div", "pa-pagelet-tab-section");
        section.appendChild(el("h2", undefined,
            pageletT("pagelet.tab.overview", this.locale)));

        const card = el("div", "pa-pagelet-tab-empty-card");
        card.appendChild(el("div", "pa-pagelet-tab-empty-title",
            pageletT(titleKey, this.locale)));
        card.appendChild(el("div", "pa-pagelet-tab-empty-body",
            pageletT(bodyKey, this.locale)));
        section.appendChild(card);

        this.bodyEl.appendChild(section);
    }

    /** Render structured TabSection content. */
    private renderTabSections(sections: TabSection[]): void {
        if (!this.bodyEl) return;

        for (const section of sections) {
            const sectionEl = el("div", "pa-pagelet-tab-section");
            sectionEl.appendChild(el("h2", undefined, section.title));
            let renderedTarget = false;

            for (const card of section.cards) {
                sectionEl.appendChild(this.renderStyledCard(card));
                if (
                    this.currentOptions.deliveryTarget?.kind === "tab-card"
                    && this.currentOptions.deliveryTarget.card === card
                ) {
                    renderedTarget = true;
                }
            }

            this.bodyEl.appendChild(sectionEl);
            if (renderedTarget) {
                this.commitDeliveryTarget(this.currentOptions.deliveryTarget);
            }
        }
    }

    private renderStyledCard(card: TabCard): HTMLElement {
        const style = card.cardStyle ?? "default";
        switch (style) {
            case "insight": return this.renderInsightStyleCard(card);
            case "action": return this.renderActionStyleCard(card);
            case "quote": return this.renderQuoteStyleCard(card);
            case "comparison": return this.renderComparisonStyleCard(card);
            case "source-list": return this.renderSourceListStyleCard(card);
            default: return this.renderDefaultStyleCard(card);
        }
    }

    private renderDefaultStyleCard(card: TabCard): HTMLElement {
        const cardEl = el("div", "pa-pagelet-tab-insight-card");
        if (card.title) cardEl.appendChild(el("h4", undefined, card.title));
        const bodyP = el("p");
        bodyP.textContent = card.body;
        cardEl.appendChild(bodyP);
        this.appendCardTags(cardEl, card);
        this.appendCardSources(cardEl, card);
        return cardEl;
    }

    private renderInsightStyleCard(card: TabCard): HTMLElement {
        const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-card--insight");
        if (card.title) cardEl.appendChild(el("h4", undefined, card.title));
        const bodyP = el("p");
        bodyP.textContent = card.body;
        cardEl.appendChild(bodyP);
        this.appendCardTags(cardEl, card);
        this.appendCardSources(cardEl, card);
        return cardEl;
    }

    private renderActionStyleCard(card: TabCard): HTMLElement {
        const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-card--action");
        if (card.title) cardEl.appendChild(el("h4", undefined, card.title));
        const bodyP = el("p");
        bodyP.textContent = card.body;
        cardEl.appendChild(bodyP);
        if (card.actionLabel && card.actionCallback) {
            const btn = el("button", "pa-pagelet-tab-card-action-btn");
            btn.setAttribute("type", "button");
            btn.textContent = card.actionLabel;
            btn.addEventListener("click", card.actionCallback);
            cardEl.appendChild(btn);
        }
        this.appendCardTags(cardEl, card);
        return cardEl;
    }

    private renderQuoteStyleCard(card: TabCard): HTMLElement {
        const cardEl = el("div", "pa-pagelet-tab-card--quote");
        const quoteP = el("p", "pa-pagelet-tab-card-quote-text");
        quoteP.textContent = card.body;
        cardEl.appendChild(quoteP);
        if (card.title) {
            const attr = el("span", "pa-pagelet-tab-card-quote-attr");
            attr.textContent = card.title;
            cardEl.appendChild(attr);
        }
        return cardEl;
    }

    private renderComparisonStyleCard(card: TabCard): HTMLElement {
        const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-card--comparison");
        if (card.title) cardEl.appendChild(el("h4", undefined, card.title));
        const bodyP = el("p");
        bodyP.textContent = card.body;
        cardEl.appendChild(bodyP);
        this.appendCardSources(cardEl, card);
        this.appendCardTags(cardEl, card);
        return cardEl;
    }

    private renderSourceListStyleCard(card: TabCard): HTMLElement {
        const cardEl = el("div", "pa-pagelet-tab-card--source-list");
        if (card.title) cardEl.appendChild(el("h4", undefined, card.title));
        this.appendCardSources(cardEl, card);
        return cardEl;
    }

    private appendCardTags(cardEl: HTMLElement, card: TabCard): void {
        if (!card.tags || card.tags.length === 0) return;
        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        for (const tag of card.tags) {
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", tag));
        }
        cardEl.appendChild(tagRow);
    }

    private appendCardSources(cardEl: HTMLElement, card: TabCard): void {
        if (!card.sourceLinks || card.sourceLinks.length === 0) return;
        const sourceRow = el("div", "pa-pagelet-tab-tag-row");
        for (const src of card.sourceLinks) {
            const link = el("button", "pa-pagelet-tab-tag-chip pa-pagelet-tab-tag-chip--link");
            link.setAttribute("type", "button");
            link.textContent = src.title ?? src.path.split("/").pop() ?? src.path;
            link.addEventListener("click", () => {
                this.options.onSourcePathClick?.(src.path);
            });
            sourceRow.appendChild(link);
        }
        cardEl.appendChild(sourceRow);
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
        this.summaryEntity = options.summarySaveNote;
        this.nativeEntity = options.summarySaveNote ? `summary:${options.summarySaveNote.targetPath}` : null;

        renderSummaryPreview(
            this.bodyEl,
            markdown,
            this.options.app,
            undefined,
            options.sourcePath ?? "",
            this.locale,
            (host, text) => this.mountNativeBody(host, text, options.sourcePath ?? ''),
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

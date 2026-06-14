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
    PanelFinding,
    PanelLayoutType,
    PanelOpenExtra,
    PanelScopeCandidate,
    PanelScopeState,
    PanelViewOptions,
} from "./types";

import {
    type PanelLayoutRenderOptions,
    renderCurrentNoteAnalysis,
    renderDiscoveryLayout,
    renderReviewTimeline,
    renderSummaryPreview,
} from "./PanelLayouts";

import { pageletT, type PageletLocale } from "../../locales/pagelet";
import {
    clearPlatformTimeout,
    eventPathContainsSelector,
    getPlatformDocument,
    requestPlatformAnimationFrame,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../../platform-dom";
import type { SuggestionCardRenderer } from "../../ui/pagelet";
import type { PageletSuggestion } from "../pa-review-schemas";
import type { PageletReviewRange } from "../scope";

interface PanelDraftItem {
    id: string;
    title: string;
    text: string;
    sourceFile?: string;
    sourceTitle?: string;
    suggestion?: PageletSuggestion;
}

function clearChildren(node: Element): void {
    node.textContent = "";
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function createHtmlElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    return getPlatformDocument().createElement(tag);
}

/** Detect mobile context using the Obsidian convention. */
function isMobile(): boolean {
    return getPlatformDocument().body.classList.contains("is-mobile");
}

const OBSIDIAN_MODAL_SELECTOR = ".modal-container, .modal";

function isObsidianModalOpen(event?: Event): boolean {
    if (event?.defaultPrevented) return true;
    if (event && eventPathContainsSelector(event, OBSIDIAN_MODAL_SELECTOR)) return true;
    const doc = getPlatformDocument();
    return Boolean(doc.body?.querySelector(OBSIDIAN_MODAL_SELECTOR));
}

const PANEL_SCOPE_RANGES: readonly PageletReviewRange[] = [
    "current",
    "yesterday",
    "last3",
    "last7",
];

function suggestionKey(finding: PanelFinding): string | null {
    const suggestion = finding.suggestion;
    if (suggestion) {
        return [
            suggestion.source_id,
            suggestion.kind,
            suggestion.rationale,
            suggestion.proposed_action,
            ...(suggestion.related_notes ?? []),
        ].join("\u001f");
    }
    return finding.sourceId
        ?? (finding.sourceFile ? `${finding.sourceFile}:${finding.title}` : null);
}

function makeDraftText(finding: PanelFinding): string {
    const suggestion = finding.suggestion;
    if (suggestion) {
        return suggestion.proposed_action.trim();
    }
    return (finding.description || finding.insightText || finding.title).trim();
}

function makeContentKey(findings: PanelFinding[]): string {
    return findings
        .map((finding) => [
            suggestionKey(finding) ?? "",
            finding.title,
            finding.description,
            finding.suggestion?.rationale ?? "",
            finding.suggestion?.proposed_action ?? "",
        ].join(":"))
        .join("|");
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
 *   panel.mount(bodyEl);
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
    private primaryButtonMode: "save" | "run" | "run-selected" = "save";

    get currentLayoutType(): PanelLayoutType | null {
        return this.currentLayout;
    }
    private currentFindings: PanelFinding[] = [];
    private currentExtra: PanelOpenExtra | undefined;
    private currentContentKey = "";
    private readonly dismissedSuggestionIds = new Set<string>();
    private draftItems: PanelDraftItem[] = [];
    private suggestionRenderers: SuggestionCardRenderer[] = [];
    /** Obsidian Component for MarkdownRenderer lifecycle management. */
    private renderComponent: Component | null = null;

    // Bound event handlers for cleanup.
    private readonly handleKeydown: (e: KeyboardEvent) => void;
    private readonly handleTouchStart: (e: TouchEvent) => void;
    private readonly handleTouchMove: (e: TouchEvent) => void;
    private readonly handleTouchEnd: (e: TouchEvent) => void;
    private touchStartY: number | null = null;
    private globalListenerDocument: Document | null = null;
    /** Pending unmount-after-transition timer; cleared if the panel reopens. */
    private unmountTimer: PlatformTimeoutHandle | null = null;
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
        extra?: PanelOpenExtra,
    ): void {
        this.ensureMounted();
        if (!this.rootEl || !this.bodyEl || !this.titleEl) return;

        this.currentLayout = layoutType;
        this.currentFindings = content;
        this.currentExtra = extra;
        const contentKey = makeContentKey(content);
        if (contentKey !== this.currentContentKey) {
            this.currentContentKey = contentKey;
            this.dismissedSuggestionIds.clear();
            this.draftItems = [];
        }
        const visibleFindings = this.visibleFindings();
        this.updatePrimaryButtonState(
            layoutType,
            layoutType === "summary" || this.canSaveCurrentContent(visibleFindings),
            extra?.scope,
        );
        this.titleEl.textContent =
            pageletT(LAYOUT_TITLE_KEYS[layoutType], this.locale) || layoutType;

        if (layoutType !== "summary") {
            this.renderComponent?.unload();
            this.renderComponent = null;
        }

        this.renderCurrentLayout();

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
        requestPlatformAnimationFrame(show);
        setPlatformTimeout(show, 0);
        this.attachGlobalListeners();
    }

    private renderCurrentLayout(): void {
        if (!this.bodyEl || !this.currentLayout) return;
        this.destroySuggestionRenderers();
        clearChildren(this.bodyEl);
        const body = this.bodyEl;
        const layoutType = this.currentLayout;
        const visibleFindings = this.visibleFindings();
        const renderOptions = this.buildRenderOptions();

        if (layoutType === "review" && this.currentExtra?.scope) {
            body.appendChild(this.renderScopeControls(this.currentExtra.scope));
        }

        const contentEl = createHtmlElement("div");
        contentEl.className = "pa-pagelet-panel-content-region";
        body.appendChild(contentEl);

        switch (layoutType) {
            case "review":
                renderReviewTimeline(contentEl, visibleFindings, this.locale, renderOptions);
                break;
            case "current":
                renderCurrentNoteAnalysis(contentEl, visibleFindings, this.locale, renderOptions);
                break;
            case "discover":
                renderDiscoveryLayout(
                    contentEl, visibleFindings, this.currentExtra?.connections, this.locale,
                );
                break;
            case "summary": {
                // Clean up previous render component
                this.renderComponent?.unload();
                this.renderComponent = new Component();
                this.renderComponent.load();

                renderSummaryPreview(
                    contentEl,
                    this.currentExtra?.markdown ?? "",
                    this.options.app,
                    this.renderComponent,
                    "",
                    this.locale,
                );
                break;
            }
        }

        if ((layoutType === "review" || layoutType === "current") && this.hasSuggestionFindings()) {
            body.appendChild(this.renderDraftSection());
        }
    }

    /** Close the panel. */
    close(): void {
        if (!this.rootEl) return;
        const root = this.rootEl;
        root.setAttribute("data-state", "hidden");
        this._isOpen = false;
        this.detachGlobalListeners();
        this.destroySuggestionRenderers();
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
        this.destroySuggestionRenderers();
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

    private destroySuggestionRenderers(): void {
        for (const renderer of this.suggestionRenderers.splice(0)) {
            renderer.destroy();
        }
    }

    private buildRenderOptions(): PanelLayoutRenderOptions {
        const options: PanelLayoutRenderOptions = {
            onSuggestionRenderer: (renderer) => {
                this.suggestionRenderers.push(renderer);
            },
            onSuggestionSourceClick: (finding, sourceId) => {
                this.options.callbacks.onSourceClick(finding.sourceFile || sourceId);
            },
            onSuggestionAccept: (finding) => this.addSuggestionToDraft(finding),
            onSuggestionDismiss: (finding) => this.dismissSuggestion(finding),
        };
        if (this.options.callbacks.onRelatedNoteClick) {
            options.onRelatedNoteClick = (noteName) => this.options.callbacks.onRelatedNoteClick?.(noteName);
        }
        if (this.options.callbacks.onResearchFinding) {
            options.onResearchFinding = (finding) => {
                void this.options.callbacks.onResearchFinding?.(finding);
            };
        }
        return options;
    }

    private visibleFindings(): PanelFinding[] {
        return this.currentFindings.filter((finding) => {
            const key = suggestionKey(finding);
            return !key || !this.dismissedSuggestionIds.has(key);
        });
    }

    private hasSuggestionFindings(): boolean {
        return this.currentFindings.some((finding) => Boolean(finding.suggestion));
    }

    private addSuggestionToDraft(finding: PanelFinding): void {
        const key = suggestionKey(finding);
        if (key && this.draftItems.some((item) => item.id === key)) return;
        this.draftItems.push({
            id: key ?? `draft-${Date.now()}-${this.draftItems.length}`,
            title: finding.title || finding.sourceTitle || finding.sourceFile || "",
            text: makeDraftText(finding),
            sourceFile: finding.sourceFile,
            sourceTitle: finding.sourceTitle,
            suggestion: finding.suggestion,
        });
        this.updatePrimaryButtonState(
            this.currentLayout ?? "review",
            this.canSaveCurrentContent(),
            this.currentExtra?.scope,
        );
        this.renderCurrentLayout();
    }

    private dismissSuggestion(finding: PanelFinding): void {
        const key = suggestionKey(finding);
        if (!key) return;
        this.dismissedSuggestionIds.add(key);
        this.draftItems = this.draftItems.filter((item) => item.id !== key);
        this.updatePrimaryButtonState(
            this.currentLayout ?? "review",
            this.canSaveCurrentContent(),
            this.currentExtra?.scope,
        );
        this.renderCurrentLayout();
    }

    private saveFindings(): PanelFinding[] {
        if (this.draftItems.length === 0) {
            return this.visibleFindings();
        }
        return this.draftItems
            .filter((item) => item.text.trim().length > 0)
            .map((item, index) => ({
            title: item.title || pageletT("pagelet.panel.draft.title", this.locale),
            description: item.text.trim(),
            sourceFile: item.sourceFile,
            sourceTitle: item.sourceTitle,
            timestamp: undefined,
            sourceId: item.id || `draft-${index + 1}`,
            suggestion: item.suggestion
                ? { ...item.suggestion, proposed_action: item.text.trim() }
                : undefined,
        }));
    }

    private canSaveCurrentContent(visibleFindings = this.visibleFindings()): boolean {
        if (this.draftItems.length > 0) {
            return this.draftItems.some((item) => item.text.trim().length > 0);
        }
        return visibleFindings.length > 0;
    }

    private renderScopeControls(scope: PanelScopeState): HTMLElement {
        const section = createHtmlElement("section");
        section.className = "pa-pagelet-panel-scope";
        section.setAttribute("aria-label", pageletT("pagelet.panel.scope.title", this.locale));

        const header = createHtmlElement("div");
        header.className = "pa-pagelet-panel-scope-header";
        const title = createHtmlElement("div");
        title.className = "pa-pagelet-panel-scope-title";
        title.textContent = pageletT("pagelet.panel.scope.title", this.locale);
        header.appendChild(title);
        const count = createHtmlElement("div");
        count.className = "pa-pagelet-panel-scope-count";
        count.textContent = pageletT("pagelet.panel.action.reviewSelected", this.locale, {
            count: scope.includedCount,
        });
        header.appendChild(count);
        section.appendChild(header);

        const ranges = createHtmlElement("div");
        ranges.className = "pa-pagelet-panel-scope-ranges";
        for (const range of PANEL_SCOPE_RANGES) {
            const btn = createHtmlElement("button");
            btn.className = "pa-pagelet-panel-scope-range-btn";
            btn.setAttribute("type", "button");
            btn.setAttribute("aria-pressed", String(scope.range === range));
            btn.setAttribute("data-active", String(scope.range === range));
            btn.textContent = pageletT(`pagelet.panel.scope.${range}`, this.locale);
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.options.callbacks.onScopeRangeChange?.(range);
            });
            ranges.appendChild(btn);
        }
        section.appendChild(ranges);

        const summary = createHtmlElement("div");
        summary.className = "pa-pagelet-panel-scope-summary";
        if (scope.estimatedInputTokens) {
            summary.appendChild(this.renderScopeChip(
                pageletT("pagelet.panel.scope.tokenEstimateShort", this.locale, {
                    tokens: scope.estimatedInputTokens,
                }),
            ));
        }
        if (scope.excludedReviewOutputCount) {
            summary.appendChild(this.renderScopeChip(
                pageletT("pagelet.panel.scope.summary.review-output", this.locale, {
                    count: scope.excludedReviewOutputCount,
                }),
            ));
        }
        if (summary.children.length > 0) {
            section.appendChild(summary);
        }

        const included = scope.candidates.filter((candidate) => candidate.included);
        const skipped = scope.candidates.filter((candidate) => !candidate.included);
        section.appendChild(this.renderScopeCandidateGroup(
            pageletT("pagelet.panel.scope.included", this.locale),
            included,
        ));
        if (skipped.length > 0) {
            section.appendChild(this.renderScopeCandidateGroup(
                pageletT("pagelet.panel.scope.skipped", this.locale),
                skipped,
            ));
        }
        if (scope.candidates.length === 0) {
            const empty = createHtmlElement("div");
            empty.className = "pa-pagelet-panel-scope-empty";
            empty.textContent = pageletT("pagelet.panel.scope.empty", this.locale);
            section.appendChild(empty);
        }
        return section;
    }

    private renderScopeChip(text: string): HTMLElement {
        const chip = createHtmlElement("span");
        chip.className = "pa-pagelet-panel-scope-chip";
        chip.textContent = text;
        return chip;
    }

    private renderScopeCandidateGroup(label: string, candidates: PanelScopeCandidate[]): HTMLElement {
        const group = createHtmlElement("div");
        group.className = "pa-pagelet-panel-scope-group";
        const heading = createHtmlElement("div");
        heading.className = "pa-pagelet-panel-scope-group-label";
        heading.textContent = label;
        group.appendChild(heading);

        const list = createHtmlElement("div");
        list.className = "pa-pagelet-panel-scope-list";
        for (const candidate of candidates) {
            list.appendChild(this.renderScopeCandidate(candidate));
        }
        group.appendChild(list);
        return group;
    }

    private renderScopeCandidate(candidate: PanelScopeCandidate): HTMLElement {
        const row = createHtmlElement("label");
        row.className = "pa-pagelet-panel-scope-row";
        row.setAttribute("data-included", String(candidate.included));
        if (candidate.locked) row.setAttribute("data-locked", "true");

        const checkbox = createHtmlElement("input");
        checkbox.className = "pa-pagelet-panel-scope-checkbox";
        checkbox.setAttribute("type", "checkbox");
        checkbox.checked = candidate.included;
        checkbox.disabled = Boolean(candidate.locked);
        checkbox.addEventListener("change", (e) => {
            e.stopPropagation();
            this.options.callbacks.onScopeCandidateToggle?.(candidate.path, checkbox.checked);
        });
        row.appendChild(checkbox);

        const text = createHtmlElement("span");
        text.className = "pa-pagelet-panel-scope-row-text";
        const title = createHtmlElement("span");
        title.className = "pa-pagelet-panel-scope-row-title";
        title.textContent = candidate.title;
        text.appendChild(title);
        const meta = createHtmlElement("span");
        meta.className = "pa-pagelet-panel-scope-row-meta";
        const reasonKey = candidate.included
            ? `pagelet.panel.scope.reason.${candidate.reason}`
            : `pagelet.panel.scope.skipped.${candidate.skippedReason ?? "unchecked"}`;
        meta.textContent = pageletT(reasonKey, this.locale);
        text.appendChild(meta);
        row.appendChild(text);

        return row;
    }

    private renderDraftSection(): HTMLElement {
        const section = createHtmlElement("section");
        section.className = "pa-pagelet-panel-draft";
        section.setAttribute("aria-label", pageletT("pagelet.panel.draft.title", this.locale));

        const title = createHtmlElement("div");
        title.className = "pa-pagelet-panel-draft-title";
        title.textContent = pageletT("pagelet.panel.draft.title", this.locale);
        section.appendChild(title);

        if (this.draftItems.length === 0) {
            const empty = createHtmlElement("div");
            empty.className = "pa-pagelet-panel-draft-empty";
            empty.textContent = pageletT("pagelet.panel.draft.empty", this.locale);
            section.appendChild(empty);
            return section;
        }

        for (const item of this.draftItems) {
            const block = createHtmlElement("div");
            block.className = "pa-pagelet-panel-draft-block";

            const textarea = createHtmlElement("textarea");
            textarea.className = "pa-pagelet-panel-draft-textarea";
            textarea.setAttribute("aria-label", pageletT("pagelet.a11y.draftBlockLabel", this.locale));
            textarea.setAttribute("placeholder", pageletT("pagelet.panel.draft.placeholder", this.locale));
            textarea.value = item.text;
            textarea.addEventListener("input", () => {
                item.text = textarea.value;
                this.updatePrimaryButtonState(
                    this.currentLayout ?? "review",
                    this.canSaveCurrentContent(),
                    this.currentExtra?.scope,
                );
            });
            block.appendChild(textarea);

            const remove = createHtmlElement("button");
            remove.className = "pa-pagelet-panel-draft-remove";
            remove.setAttribute("type", "button");
            remove.textContent = pageletT("pagelet.panel.draft.remove", this.locale);
            remove.addEventListener("click", (e) => {
                e.stopPropagation();
                this.draftItems = this.draftItems.filter((candidate) => candidate.id !== item.id);
                this.updatePrimaryButtonState(
                    this.currentLayout ?? "review",
                    this.canSaveCurrentContent(),
                    this.currentExtra?.scope,
                );
                this.renderCurrentLayout();
            });
            block.appendChild(remove);
            section.appendChild(block);
        }

        return section;
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
        this.unmountTimer = setPlatformTimeout(finalize, PanelView.UNMOUNT_FALLBACK_MS);
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
        root.className = "pa-pagelet-panel";
        root.setAttribute("data-state", "hidden");
        root.setAttribute("role", "complementary");
        root.setAttribute("aria-label",
            pageletT("pagelet.panel.ariaLabel", this.locale));

        // Header
        const header = createHtmlElement("div");
        header.className = "pa-pagelet-panel-header";

        const title = createHtmlElement("h3");
        title.className = "pa-pagelet-panel-title";
        title.textContent = pageletT("pagelet.panel.title", this.locale);
        this.titleEl = title;
        header.appendChild(title);

        const actions = createHtmlElement("div");
        actions.className = "pa-pagelet-panel-header-actions";

        // Hints toggle button
        const hintsBtn = createHtmlElement("button");
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
        const expandBtn = createHtmlElement("button");
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
        const closeBtn = createHtmlElement("button");
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
        const body = createHtmlElement("div");
        body.className = "pa-pagelet-panel-body";
        this.bodyEl = body;
        root.appendChild(body);

        // Footer
        const footer = createHtmlElement("div");
        footer.className = "pa-pagelet-panel-footer";

        // Save button (accent-colored, before expand)
        const saveBtn = createHtmlElement("button");
        saveBtn.className = "pa-pagelet-panel-save-btn";
        saveBtn.textContent = pageletT("pagelet.panel.save", this.locale);
        saveBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (this.primaryButtonMode === "run" || this.primaryButtonMode === "run-selected") {
                const run = this.primaryButtonMode === "run-selected"
                    ? this.options.callbacks.onRunSelectedReview
                    : this.options.callbacks.onRunReview;
                if (!run) return;
                saveBtn.disabled = true;
                saveBtn.setAttribute("aria-busy", "true");
                const previousLabel = saveBtn.textContent ?? "";
                const progressLabel = this.primaryButtonMode === "run-selected"
                    ? pageletT("pagelet.panel.status.thinking", this.locale)
                    : pageletT("pagelet.panel.status.reviewingCurrent", this.locale);
                saveBtn.textContent = progressLabel;
                this.renderReviewProgress(progressLabel);
                try {
                    await run();
                } finally {
                    if (
                        this.saveBtnEl === saveBtn
                        && (this.primaryButtonMode === "run" || this.primaryButtonMode === "run-selected")
                    ) {
                        saveBtn.disabled = false;
                        saveBtn.removeAttribute("aria-busy");
                        saveBtn.textContent = previousLabel;
                        if (this.currentLayout === "review" && this.currentFindings.length === 0 && this.bodyEl) {
                            this.renderCurrentLayout();
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
                await this.options.callbacks.onSaveAsReviewNote(this.saveFindings());
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

        const expandTabBtn = createHtmlElement("button");
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

    private renderReviewProgress(label?: string): void {
        if (!this.bodyEl) return;
        clearChildren(this.bodyEl);

        const card = createHtmlElement("div");
        card.className = "pa-pagelet-panel-progress-card";
        card.setAttribute("role", "status");
        card.setAttribute("aria-live", "polite");

        const dot = createHtmlElement("div");
        dot.className = "pa-pagelet-panel-progress-dot";
        card.appendChild(dot);

        const text = createHtmlElement("div");
        text.textContent = label ?? pageletT("pagelet.panel.status.reviewingCurrent", this.locale);
        card.appendChild(text);

        this.bodyEl.appendChild(card);
    }

    // -----------------------------------------------------------------------
    // Global event handlers
    // -----------------------------------------------------------------------

    private attachGlobalListeners(): void {
        this.globalListenerDocument = getPlatformDocument();
        this.globalListenerDocument.addEventListener("keydown", this.handleKeydown, true);
        if (this.rootEl) {
            this.rootEl.addEventListener("touchstart", this.handleTouchStart, { passive: true });
            this.rootEl.addEventListener("touchmove", this.handleTouchMove, { passive: true });
            this.rootEl.addEventListener("touchend", this.handleTouchEnd, { passive: true });
        }
    }

    private detachGlobalListeners(): void {
        this.globalListenerDocument?.removeEventListener("keydown", this.handleKeydown, true);
        this.globalListenerDocument = null;
        if (this.rootEl) {
            this.rootEl.removeEventListener("touchstart", this.handleTouchStart);
            this.rootEl.removeEventListener("touchmove", this.handleTouchMove);
            this.rootEl.removeEventListener("touchend", this.handleTouchEnd);
        }
    }

    private updatePrimaryButtonState(
        layoutType: PanelLayoutType,
        saveEnabled: boolean,
        scope?: PanelScopeState,
    ): void {
        if (!this.saveBtnEl) return;
        const canRunSelected = !saveEnabled
            && layoutType === "review"
            && Boolean(scope)
            && Boolean(this.options.callbacks.onRunSelectedReview);
        const canRunReview = !canRunSelected
            && !saveEnabled
            && layoutType === "review"
            && Boolean(this.options.callbacks.onRunReview);
        this.primaryButtonMode = canRunSelected ? "run-selected" : canRunReview ? "run" : "save";

        if (canRunSelected) {
            const count = scope?.includedCount ?? 0;
            this.saveBtnEl.disabled = count === 0;
            this.saveBtnEl.removeAttribute("aria-busy");
            this.saveBtnEl.setAttribute("aria-disabled", String(count === 0));
            this.saveBtnEl.textContent = pageletT("pagelet.panel.action.reviewSelected", this.locale, {
                count,
            });
            this.saveBtnEl.setAttribute("title", pageletT("pagelet.panel.action.reviewSelectedDescription", this.locale, {
                count,
            }));
            return;
        }

        if (canRunReview) {
            this.saveBtnEl.disabled = false;
            this.saveBtnEl.removeAttribute("aria-busy");
            this.saveBtnEl.setAttribute("aria-disabled", "false");
            this.saveBtnEl.textContent = pageletT("pagelet.panel.action.reviewCurrent", this.locale);
            this.saveBtnEl.removeAttribute("title");
            return;
        }

        this.saveBtnEl.disabled = !saveEnabled;
        this.saveBtnEl.removeAttribute("aria-busy");
        this.saveBtnEl.setAttribute("aria-disabled", String(!saveEnabled));
        this.saveBtnEl.textContent = pageletT("pagelet.panel.save", this.locale);
        this.saveBtnEl.removeAttribute("title");
    }

    private onKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape" && this._isOpen) {
            if (isObsidianModalOpen(e)) return;
            e.preventDefault();
            e.stopPropagation();
            this.close();
        }
    }
}

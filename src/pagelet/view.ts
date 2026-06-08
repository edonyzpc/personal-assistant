/* Copyright 2023 edonyzpc */

import { ItemView, WorkspaceLeaf } from "obsidian";

import type {
    PreviewShowOptions,
    PreviewShowResult,
    PreviewSpec,
} from "../ai-services/write-action-framework";
import { getPageletUiLanguage, pageletT, type PageletLocale } from "../locales/pagelet";
import {
    createMascotRenderer,
    createSuggestionCardRenderer,
    type MascotRenderer,
    type MascotState,
    type SuggestionCardRenderer,
} from "../ui/pagelet";

import { formatUsd, type PageletCostSummary } from "./pa-review-cost";
import type { PageletReviewDiagnostics } from "./pa-review-model";
import type { PageletLanguageCode, PageletReviewResult, PageletSuggestion } from "./pa-review-schemas";
import {
    applyPageletScopeToggle,
    selectPageletScope,
    type PageletReviewRange,
    type PageletScopePlan,
    type PageletScopeSelection,
    type PageletScopeSkippedReason,
    type PageletScopeSourceReference,
} from "./scope";

export const PAGELET_VIEW_TYPE = "pa-pagelet-view";
const PAGELET_PENDING_DRAFT_STORAGE_KEY = "personal-assistant:pagelet:pending-draft:v1";

const UNDO_TIMEOUT_MS = 5000;

export interface PageletPanelReviewData {
    /** Display label shown in the Pagelet panel. May summarize multiple notes. */
    sourcePath: string;
    /** Primary vault path used when saving frontmatter and write-action context. */
    primarySourcePath?: string;
    result: PageletReviewResult;
    diagnostics: PageletReviewDiagnostics;
    costSummary: PageletCostSummary;
    targetPath?: string;
    detectedLanguage?: PageletLanguageCode;
    mode?: "basic" | "deeper";
    sourceReferences?: readonly PageletScopeSourceReference[];
    sourcePaths?: readonly string[];
}

export interface PageletDraftReviewSaveRequest {
    sourcePath: string;
    result: PageletReviewResult;
    diagnostics: PageletReviewDiagnostics;
    costSummary: PageletCostSummary;
    targetPath?: string;
    detectedLanguage: PageletLanguageCode;
    mode: "basic" | "deeper";
}

interface AcceptedDraftItem {
    key: string;
    suggestion: PageletSuggestion;
    text: string;
}

interface PendingDraftSnapshot {
    version: 1;
    sourcePath?: string;
    items: AcceptedDraftItem[];
}

function suggestionKey(suggestion: PageletSuggestion): string {
    return [
        suggestion.source_id,
        suggestion.kind,
        suggestion.proposed_action,
    ].join("\u001f");
}

function isAcceptedDraftItem(value: unknown): value is AcceptedDraftItem {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<AcceptedDraftItem>;
    return typeof item.key === "string"
        && typeof item.text === "string"
        && Boolean(item.suggestion)
        && typeof item.suggestion === "object"
        && typeof (item.suggestion as Partial<PageletSuggestion>).source_id === "string"
        && typeof (item.suggestion as Partial<PageletSuggestion>).kind === "string"
        && typeof (item.suggestion as Partial<PageletSuggestion>).rationale === "string"
        && typeof (item.suggestion as Partial<PageletSuggestion>).proposed_action === "string";
}

interface PageletDomRefs {
    root: HTMLElement | null;
    mascotHost: HTMLElement | null;
    status: HTMLElement | null;
    source: HTMLElement | null;
    cost: HTMLElement | null;
    summary: HTMLElement | null;
    cards: HTMLElement | null;
    draft: HTMLElement | null;
    writePreview: HTMLElement | null;
    target: HTMLElement | null;
    scope: HTMLElement | null;
    scopeRange: HTMLElement | null;
    scopeList: HTMLElement | null;
    reviewButton: HTMLButtonElement | null;
    cancelReview: HTMLButtonElement | null;
}

function emptyDomRefs(): PageletDomRefs {
    return {
        root: null, mascotHost: null, status: null, source: null, cost: null,
        summary: null, cards: null, draft: null, writePreview: null, target: null,
        scope: null, scopeRange: null, scopeList: null, reviewButton: null, cancelReview: null,
    };
}

export interface PageletViewCallbacks {
    refreshScope(range: PageletReviewRange, activePath?: string): void;
    runReview(): void;
    saveDraftReview(request: PageletDraftReviewSaveRequest): Promise<void>;
    openSourceReference(reference: PageletScopeSourceReference): Promise<boolean>;
    openRelatedNote(noteName: string, sourcePath: string): Promise<boolean>;
    prepareResearchPrompt(suggestion: PageletSuggestion): Promise<boolean>;
}

export class PageletView extends ItemView {
    private dom = emptyDomRefs();
    private mascot: MascotRenderer | null = null;
    private cardRenderers: SuggestionCardRenderer[] = [];
    private currentReview: PageletPanelReviewData | null = null;
    private sourceReferences = new Map<string, PageletScopeSourceReference>();
    private scopePlan: PageletScopePlan | null = null;
    private scopeRangeButtons: HTMLButtonElement[] = [];
    private scopeRange: PageletReviewRange = "current";
    private closed = true;
    private dismissedKeys = new Set<string>();
    private acceptedDraft: AcceptedDraftItem[] = [];
    private acceptedDraftSourcePath: string | undefined;
    private writePreviewMarkdownExpanded = false;
    private reviewRunning = false;
    private reviewCancelHandler: (() => void) | null = null;
    private undoTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingWritePreview: {
        spec: PreviewSpec;
        resolve: (result: PreviewShowResult) => void;
        signal?: AbortSignal;
        onAbort?: () => void;
    } | null = null;
    private draftSaveInFlight = false;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly callbacks: PageletViewCallbacks,
    ) {
        super(leaf);
    }

    getViewType(): string {
        return PAGELET_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Pagelet";
    }

    getIcon(): string {
        return "scroll-text";
    }

    async onOpen(): Promise<void> {
        this.closed = false;
        this.renderShell();
        this.renderDraft();
        void this.callbacks.refreshScope(this.scopeRange);
        this.setStatus("idle", this.t("pagelet.panel.status.idle", "Ready"));
    }

    async onClose(): Promise<void> {
        this.settleWritePreview({ outcome: "cancelled" });
        if (this.undoTimer !== null) { clearTimeout(this.undoTimer); this.undoTimer = null; }
        this.closed = true;
        this.destroyCards();
        this.mascot?.destroy();
        this.mascot = null;
        this.dom = emptyDomRefs();
        this.reviewCancelHandler = null;
        this.reviewRunning = false;
    }

    getScopeSelection(): PageletScopeSelection {
        if (!this.scopePlan) return { range: this.scopeRange, paths: [] };
        return selectPageletScope(this.scopePlan);
    }

    showScopePlan(plan: PageletScopePlan): void {
        this.renderShell();
        this.scopePlan = plan;
        this.scopeRange = plan.range;
        this.setSource(plan.activePath);
        this.reconcileDraftWithSource(plan.activePath);
        this.renderScope();
        this.updateReviewButton();
    }

    showIdle(): void {
        this.renderShell();
        this.clearReview();
        this.setStatus("idle", this.t("pagelet.panel.status.idle", "Ready"));
    }

    showReviewStarted(sourcePath: string, options?: { onCancel?: () => void }): void {
        this.renderShell();
        this.clearReview();
        this.reviewRunning = true;
        this.reviewCancelHandler = options?.onCancel ?? null;
        this.updateReviewButton();
        this.updateCancelReviewButton();
        this.setStatus("thinking", this.t("pagelet.panel.status.thinking", "Reviewing current note..."));
        this.setSource(sourcePath);
    }

    showReviewProgress(message: string): void {
        this.renderShell();
        if (!this.reviewRunning) return;
        this.setStatus("thinking", message);
    }

    showReviewResult(data: PageletPanelReviewData): void {
        this.renderShell();
        this.clearReviewRunningState();
        this.settleWritePreview({ outcome: "cancelled" });
        this.clearWritePreview();
        this.currentReview = data;
        this.draftSaveInFlight = false;
        this.sourceReferences = new Map(
            (data.sourceReferences ?? []).map((reference) => [reference.sourceId, reference]),
        );
        this.dismissedKeys.clear();
        this.acceptedDraft = [];
        this.acceptedDraftSourcePath = this.reviewDraftIdentity(data);
        this.writePreviewMarkdownExpanded = false;
        this.setStatus("done", this.t("pagelet.panel.status.ready", "Suggestions ready"));
        this.setSource(data.sourcePath);
        this.renderSummary(data.result);
        this.renderCards();
        this.renderDraft();
        this.renderCost(data.costSummary);
        if (data.targetPath) this.setTarget(data.targetPath, false);
        this.refreshInteractionLocks();
    }

    showReviewSaved(targetPath: string, costSummary: PageletCostSummary): void {
        this.renderShell();
        this.clearReviewRunningState();
        this.clearWritePreview();
        this.draftSaveInFlight = false;
        this.setStatus("done", this.t("pagelet.panel.status.saved", "Review note saved"));
        this.renderCost(costSummary);
        this.setTarget(targetPath, true);
        this.currentReview = null;
        this.sourceReferences.clear();
        this.dismissedKeys.clear();
        this.destroyCards();
        if (this.dom.cards) this.dom.cards.textContent = "";
        this.acceptedDraft = [];
        this.acceptedDraftSourcePath = undefined;
        this.renderDraft();
        this.clearPendingDraftSnapshot();
        this.refreshInteractionLocks();
    }

    showReviewNotSaved(): void {
        this.renderShell();
        this.clearReviewRunningState();
        this.clearWritePreview();
        this.draftSaveInFlight = false;
        this.setStatus("done", this.t("pagelet.panel.status.notSaved", "Suggestions ready; note not saved"));
        this.renderDraft();
        this.refreshInteractionLocks();
    }

    showReviewSaveError(message: string, sourcePath?: string): void {
        this.renderShell();
        this.clearReviewRunningState();
        this.clearWritePreview();
        this.draftSaveInFlight = false;
        this.setStatus("error", message);
        this.setSource(this.currentReview?.sourcePath ?? sourcePath ?? this.t("pagelet.panel.source.none", "No note selected"));
        this.renderDraft();
        this.refreshInteractionLocks();
    }

    showReviewEmpty(sourcePath: string): void {
        this.renderShell();
        this.clearReviewRunningState();
        this.clearReview();
        this.setStatus("done", this.t("pagelet.panel.status.empty", "No suggestions worth saving"));
        this.setSource(sourcePath);
    }

    showReviewAborted(sourcePath: string): void {
        this.renderShell();
        this.clearReviewRunningState();
        this.setStatus("idle", this.t("pagelet.panel.status.aborted", "Review stopped"));
        this.setSource(sourcePath);
    }

    showReviewError(message: string, sourcePath?: string): void {
        this.renderShell();
        this.clearReviewRunningState();
        this.clearReview();
        this.setStatus("error", message);
        if (sourcePath) this.setSource(sourcePath);
    }

    showWritePreview(spec: PreviewSpec, options?: PreviewShowOptions): Promise<PreviewShowResult> {
        if (options?.signal?.aborted) {
            return Promise.resolve({ outcome: "aborted" });
        }
        this.renderShell();
        if (this.closed || !this.dom.writePreview) {
            return Promise.resolve({ outcome: "cancelled" });
        }
        this.settleWritePreview({ outcome: "cancelled" });
        return new Promise<PreviewShowResult>((resolve) => {
            const onAbort = (): void => {
                this.settleWritePreview({ outcome: "aborted" });
            };
            this.pendingWritePreview = {
                spec,
                resolve,
                ...(options?.signal ? { signal: options.signal, onAbort } : {}),
            };
            options?.signal?.addEventListener("abort", onAbort, { once: true });
            this.refreshInteractionLocks();
            this.renderWritePreview(spec, false);
        });
    }

    private renderShell(): void {
        if (this.closed) return;
        if (this.dom.root) return;

        this.contentEl.textContent = "";
        this.contentEl.classList.add("pa-pagelet-view");
        this.contentEl.setAttribute("data-plugin", "pa-pagelet");

        const root = this.createEl("div", "pa-pagelet-shell");
        const header = this.createEl("header", "pa-pagelet-header", root);
        this.dom.mascotHost = this.createEl("div", "pa-pagelet-header__mascot", header);
        this.mascot = createMascotRenderer(this.dom.mascotHost, {
            locale: this.locale(),
            initialState: "idle",
        });

        const titleGroup = this.createEl("div", "pa-pagelet-header__title", header);
        this.createEl("h2", "pa-pagelet-title", titleGroup, this.t("pagelet.panel.title", "Pagelet"));
        this.dom.source = this.createEl("p", "pa-pagelet-source", titleGroup, this.t("pagelet.panel.source.none", "No note selected"));

        const actions = this.createEl("div", "pa-pagelet-header__actions", header);
        const reviewButton = this.createEl("button", "pa-pagelet-button pa-pagelet-button--primary", actions, this.t("pagelet.command.reviewCurrent", "Pagelet: Review current note"));
        reviewButton.setAttribute("type", "button");
        this.registerDomEvent(reviewButton, "click", () => {
            if (this.isSaveInteractionLocked()) return;
            void this.callbacks.runReview();
        });
        this.dom.reviewButton = reviewButton;

        const cancelButton = this.createEl("button", "pa-pagelet-button pa-pagelet-review-stop", actions, this.t("pagelet.panel.action.stopReview", "Stop"));
        cancelButton.setAttribute("type", "button");
        this.registerDomEvent(cancelButton, "click", () => {
            this.reviewCancelHandler?.();
        });
        this.dom.cancelReview = cancelButton;
        this.updateReviewButton();
        this.updateCancelReviewButton();

        this.dom.scope = this.createEl("section", "pa-pagelet-scope", root);
        this.renderScope();

        const statusBar = this.createEl("section", "pa-pagelet-status", root);
        this.dom.status = this.createEl("div", "pa-pagelet-status__state", statusBar);
        this.dom.cost = this.createEl("div", "pa-pagelet-status__cost", statusBar, this.t("pagelet.panel.cost.none", "No review cost yet"));
        this.dom.target = this.createEl("div", "pa-pagelet-status__target", statusBar);

        const body = this.createEl("main", "pa-pagelet-workspace", root);
        const findings = this.createEl("section", "pa-pagelet-findings", body);
        this.dom.summary = this.createEl("div", "pa-pagelet-summary", findings, this.t("pagelet.panel.empty", "Run Pagelet to review the current note."));
        this.dom.cards = this.createEl("div", "pa-pagelet-cards", findings);
        this.dom.cards.setAttribute("aria-label", this.t("pagelet.a11y.suggestionsRegion", "Pagelet suggestions"));
        this.dom.cards.setAttribute("role", "region");
        this.dom.cards.setAttribute("aria-live", "polite");
        this.dom.cards.setAttribute("aria-atomic", "false");

        const draft = this.createEl("aside", "pa-pagelet-draft", body);
        this.createEl("h3", "pa-pagelet-draft__title", draft, this.t("pagelet.panel.draft.title", "Draft"));
        this.dom.draft = this.createEl("div", "pa-pagelet-draft__items", draft);
        this.dom.writePreview = this.createEl("div", "pa-pagelet-write-preview-host", draft);
        this.renderDraft();

        this.contentEl.appendChild(root);
        this.dom.root = root;
    }

    private renderScope(): void {
        if (!this.dom.scope) return;
        this.dom.scope.textContent = "";
        this.scopeRangeButtons = [];
        const header = this.createEl("div", "pa-pagelet-scope__header", this.dom.scope);
        this.createEl("h3", "pa-pagelet-scope__title", header, this.t("pagelet.panel.scope.title", "Scope"));
        this.dom.scopeRange = this.createEl("div", "pa-pagelet-scope__ranges", header);
        this.dom.scopeRange.setAttribute("role", "radiogroup");
        this.dom.scopeRange.setAttribute("aria-label", this.t("pagelet.panel.scope.title", "Scope"));
        const ranges: PageletReviewRange[] = ["current", "yesterday", "last3", "last7"];
        for (const range of ranges) {
            const button = this.createEl(
                "button",
                range === this.scopeRange
                    ? "pa-pagelet-scope__range is-active"
                    : "pa-pagelet-scope__range",
                this.dom.scopeRange,
                this.scopeLabel(range),
            );
            button.setAttribute("type", "button");
            button.setAttribute("role", "radio");
            button.setAttribute("aria-checked", String(range === this.scopeRange));
            button.setAttribute("aria-label", this.t("pagelet.panel.scope.rangeLabel", "Scope: {range}", { range: this.scopeLabel(range) }));
            button.disabled = this.isSaveInteractionLocked();
            this.scopeRangeButtons.push(button);
            this.registerDomEvent(button, "click", () => {
                if (this.isSaveInteractionLocked()) return;
                this.scopeRange = range;
                void this.callbacks.refreshScope(range, this.scopePlan?.activePath);
            });
        }

        this.dom.scopeList = this.createEl("div", "pa-pagelet-scope__list", this.dom.scope);
        const excludedReviewOutputCount = this.scopePlan?.excludedReviewOutputCount ?? 0;
        if (!this.scopePlan || (this.scopePlan.candidates.length === 0 && excludedReviewOutputCount === 0)) {
            this.createEl("p", "pa-pagelet-scope__empty", this.dom.scopeList, this.t("pagelet.panel.scope.empty", "No notes in scope."));
            return;
        }

        const included = this.scopePlan.candidates.filter((candidate) => candidate.included);
        const skipped = this.scopePlan.candidates.filter((candidate) => !candidate.included);
        if (included.length === 0 && skipped.length === 0) {
            this.createEl("p", "pa-pagelet-scope__empty", this.dom.scopeList, this.t("pagelet.panel.scope.empty", "No notes in scope."));
        }
        this.renderScopeGroup(this.t("pagelet.panel.scope.included", "Included"), included);
        if (skipped.length > 0) {
            this.renderScopeGroup(this.t("pagelet.panel.scope.skipped", "Skipped"), skipped);
        }
        this.renderScopeSummaries();
        this.updateReviewButton();
    }

    private renderScopeSummaries(): void {
        if (!this.dom.scopeList || !this.scopePlan) return;
        const count = this.scopePlan.excludedReviewOutputCount ?? 0;
        if (count <= 0) return;
        this.createEl(
            "p",
            "pa-pagelet-scope__summary",
            this.dom.scopeList,
            this.t(
                "pagelet.panel.scope.summary.review-output",
                "Excluded: {count} Pagelet review notes",
                { count },
            ),
        );
    }

    private renderScopeGroup(label: string, candidates: PageletScopePlan["candidates"]): void {
        if (!this.dom.scopeList || candidates.length === 0) return;
        const group = this.createEl("div", "pa-pagelet-scope__group", this.dom.scopeList);
        this.createEl("div", "pa-pagelet-scope__group-label", group, `${label} (${candidates.length})`);
        for (const candidate of candidates) {
            const row = this.createEl("label", "pa-pagelet-scope__row", group);
            const checkbox = this.createEl("input", "pa-pagelet-scope__checkbox", row);
            checkbox.setAttribute("type", "checkbox");
            checkbox.checked = candidate.included;
            checkbox.disabled = Boolean(candidate.locked);
            checkbox.addEventListener("change", () => {
                if (!this.scopePlan) return;
                this.scopePlan = applyPageletScopeToggle(this.scopePlan, candidate.path, checkbox.checked);
                this.renderScope();
            });
            const text = this.createEl("span", "pa-pagelet-scope__path", row, candidate.path);
            text.setAttribute("title", candidate.path);
            const reason = candidate.included
                ? this.scopeReasonLabel(candidate.reason)
                : this.scopeSkippedLabel(candidate.skippedReason);
            this.createEl("span", "pa-pagelet-scope__reason", row, reason);
        }
    }

    private scopeLabel(range: PageletReviewRange): string {
        switch (range) {
            case "current":
                return this.t("pagelet.panel.scope.current", "Current");
            case "yesterday":
                return this.t("pagelet.panel.scope.yesterday", "Yesterday");
            case "last3":
                return this.t("pagelet.panel.scope.last3", "Last 3 days");
            case "last7":
                return this.t("pagelet.panel.scope.last7", "Last 7 days");
        }
    }

    private scopeReasonLabel(reason: PageletScopePlan["candidates"][number]["reason"]): string {
        return this.t(`pagelet.panel.scope.reason.${reason}`, reason);
    }

    private scopeSkippedLabel(reason?: PageletScopeSkippedReason): string {
        if (!reason) return "";
        return this.t(`pagelet.panel.scope.skipped.${reason}`, reason);
    }

    private clearReview(): void {
        this.settleWritePreview({ outcome: "cancelled" });
        this.clearReviewRunningState();
        this.currentReview = null;
        this.draftSaveInFlight = false;
        this.sourceReferences.clear();
        this.dismissedKeys.clear();
        this.acceptedDraft = [];
        this.acceptedDraftSourcePath = undefined;
        this.clearPendingDraftSnapshot();
        this.destroyCards();
        if (this.dom.summary) {
            this.dom.summary.textContent = this.t("pagelet.panel.empty", "Run Pagelet to review the current note.");
        }
        if (this.dom.cost) {
            this.dom.cost.textContent = this.t("pagelet.panel.cost.none", "No review cost yet");
        }
        if (this.dom.target) this.dom.target.textContent = "";
        this.clearWritePreview();
        this.renderDraft();
        this.refreshInteractionLocks();
    }

    private setStatus(state: MascotState, message: string): void {
        if (this.dom.status) this.dom.status.textContent = message;
        this.mascot?.setState(state, { message });
    }

    private setSource(sourcePath: string): void {
        if (this.dom.source) {
            this.dom.source.textContent = sourcePath;
            this.dom.source.setAttribute("title", sourcePath);
        }
    }

    private setTarget(targetPath: string, saved: boolean): void {
        if (!this.dom.target) return;
        const label = saved
            ? this.t("pagelet.panel.target.saved", "Saved to")
            : this.t("pagelet.panel.target.pending", "Review note");
        this.dom.target.textContent = `${label}: ${targetPath}`;
        this.dom.target.setAttribute("title", targetPath);
    }

    private isSaveInteractionLocked(): boolean {
        return this.draftSaveInFlight || this.pendingWritePreview !== null;
    }

    private reviewDraftIdentity(review: PageletPanelReviewData | null = this.currentReview): string | undefined {
        return review?.primarySourcePath ?? review?.sourcePath;
    }

    private refreshInteractionLocks(): void {
        const locked = this.isSaveInteractionLocked();
        if (this.dom.reviewButton) {
            const count = this.getScopeSelection().paths.length;
            this.dom.reviewButton.disabled = this.reviewRunning || count === 0 || locked;
        }
        for (const button of this.scopeRangeButtons) {
            button.disabled = locked;
        }
    }

    private updateReviewButton(): void {
        if (!this.dom.reviewButton) return;
        const count = this.getScopeSelection().paths.length;
        const label = this.t(
            "pagelet.panel.action.reviewSelected",
            "Review selected ({count})",
            { count },
        );
        const tokens = this.scopePlan?.estimatedInputTokens;
        const tokenLabel = tokens
            ? tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
            : undefined;
        const tokenHint = tokenLabel
            ? ` (${this.t("pagelet.panel.scope.tokenEstimateShort", "~{tokens} tokens", { tokens: tokenLabel })})`
            : "";
        const description = this.t(
            "pagelet.panel.action.reviewSelectedDescription",
            "Review {count} selected notes. Selected note text may be sent to your configured AI provider and may use credits.",
            { count },
        ) + tokenHint;
        this.dom.reviewButton.textContent = label;
        this.dom.reviewButton.setAttribute("title", description);
        this.dom.reviewButton.setAttribute("aria-label", description);
        this.dom.reviewButton.disabled = this.reviewRunning || count === 0 || this.isSaveInteractionLocked();
        if (this.dom.target && !this.reviewRunning) {
            this.dom.target.textContent = tokens
                ? this.t("pagelet.panel.scope.tokenEstimate", "Est. ~{tokens} input tokens", { tokens: tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens) })
                : "";
        }
    }

    private updateCancelReviewButton(): void {
        if (!this.dom.cancelReview) return;
        const visible = this.reviewRunning && this.reviewCancelHandler !== null;
        this.dom.cancelReview.hidden = !visible;
        this.dom.cancelReview.disabled = !visible;
    }

    private clearReviewRunningState(): void {
        if (!this.reviewRunning && this.reviewCancelHandler === null) return;
        this.reviewRunning = false;
        this.reviewCancelHandler = null;
        this.updateReviewButton();
        this.updateCancelReviewButton();
    }

    private renderSummary(result: PageletReviewResult): void {
        if (!this.dom.summary) return;
        this.dom.summary.textContent = result.overall_remark?.trim()
            || this.t("pagelet.panel.summary.fallback", "Pagelet found suggestions for this note.");
    }

    private renderCards(): void {
        if (!this.dom.cards || !this.currentReview) return;
        this.destroyCards();
        const locale = this.locale();
        const visibleSuggestions = this.currentReview.result.suggestions
            .filter((suggestion) => !this.dismissedKeys.has(suggestionKey(suggestion)));
        if (visibleSuggestions.length === 0) {
            this.dom.cards.textContent = this.t("pagelet.panel.cards.empty", "No visible suggestions.");
            return;
        }
        this.dom.cards.textContent = "";
        for (const suggestion of visibleSuggestions) {
            const renderer = createSuggestionCardRenderer(
                this.dom.cards,
                {
                    suggestion,
                    diagnostics: this.currentReview.diagnostics,
                    onSourceClick: (sourceId) => this.openSourceReference(sourceId),
                    onRelatedNoteClick: (noteName, fromSuggestion) =>
                        this.openRelatedNote(noteName, fromSuggestion),
                    onResearch: (researchSuggestion) => this.prepareResearchPrompt(researchSuggestion),
                    onAccept: (accepted) => this.acceptSuggestion(accepted),
                    onDismiss: (dismissed) => this.dismissSuggestion(dismissed),
                },
                { locale },
            );
            this.cardRenderers.push(renderer);
        }
    }

    private acceptSuggestion(suggestion: PageletSuggestion): void {
        const key = suggestionKey(suggestion);
        this.acceptedDraftSourcePath = this.reviewDraftIdentity() ?? this.acceptedDraftSourcePath;
        if (!this.acceptedDraft.some((item) => item.key === key)) {
            this.acceptedDraft.push({ key, suggestion, text: suggestion.proposed_action });
        }
        this.renderDraft();
        this.savePendingDraftSnapshot();
        this.flashStatus(this.t("pagelet.panel.status.added", "Added to draft"));
    }

    private dismissSuggestion(suggestion: PageletSuggestion): void {
        const key = suggestionKey(suggestion);
        this.dismissedKeys.add(key);
        this.renderCards();
        this.flashStatusWithUndo(
            this.t("pagelet.panel.status.dismissed", "Suggestion dismissed"),
            () => {
                this.dismissedKeys.delete(key);
                this.renderCards();
                this.flashStatus(this.t("pagelet.panel.status.idle", "Ready"));
            },
        );
    }

    private openSourceReference(sourceId: string): void {
        const reference = this.sourceReferences.get(sourceId);
        if (!reference) {
            this.flashStatus(this.t("pagelet.panel.status.source", "Source") + `: ${sourceId}`);
            return;
        }
        this.runPanelAction(this.callbacks.openSourceReference(reference), (opened) => {
            this.flashStatus(opened
                ? `${this.t("pagelet.panel.status.source", "Source")}: ${reference.label}`
                : this.t("pagelet.panel.status.relatedMissing", "Related note not found"));
        });
    }

    private openRelatedNote(noteName: string, suggestion: PageletSuggestion): void {
        const source = this.sourceReferences.get(suggestion.source_id)?.path
            ?? this.currentReview?.sourcePath
            ?? "";
        this.runPanelAction(this.callbacks.openRelatedNote(noteName, source), (opened) => {
            this.flashStatus(opened
                ? this.t("pagelet.panel.status.relatedOpened", "Opened related note")
                : this.t("pagelet.panel.status.relatedMissing", "Related note not found"));
        });
    }

    private prepareResearchPrompt(suggestion: PageletSuggestion): void {
        this.runPanelAction(this.callbacks.prepareResearchPrompt(suggestion), (prepared) => {
            if (prepared) {
                this.flashStatus(this.t("pagelet.panel.status.researchReady", "Research prompt prepared in Chat"));
            } else {
                this.flashStatus(this.t("pagelet.panel.status.researchBlocked", "Chat already has text; prompt not replaced"));
            }
        });
    }

    private runPanelAction(action: Promise<boolean>, onSettled: (ok: boolean) => void): void {
        void action
            .then(onSettled)
            .catch(() => {
                this.flashStatus(this.t("pagelet.panel.status.actionFailed", "Action failed"));
            });
    }

    private renderDraft(): void {
        if (!this.dom.draft) return;
        this.dom.draft.textContent = "";
        if (this.acceptedDraft.length === 0) {
            this.createEl("p", "pa-pagelet-draft__empty", this.dom.draft, this.t("pagelet.panel.draft.empty", "Add suggestions to collect a draft."));
            return;
        }
        const list = this.createEl("ol", "pa-pagelet-draft__list", this.dom.draft);
        for (const item of this.acceptedDraft) {
            const li = this.createEl("li", "pa-pagelet-draft__item", list);
            this.createEl("div", "pa-pagelet-draft__source", li, item.suggestion.source_id);
            const text = this.createEl("textarea", "pa-pagelet-draft__text", li);
            text.value = item.text;
            text.setAttribute("rows", "4");
            text.setAttribute(
                "aria-label",
                `${this.t("pagelet.a11y.draftBlockLabel", "Draft block")}: ${item.suggestion.source_id}`,
            );
            text.setAttribute(
                "placeholder",
                this.t("pagelet.panel.draft.placeholder", "Edit this draft block..."),
            );
            text.addEventListener("input", () => {
                item.text = text.value;
                this.savePendingDraftSnapshot();
            });
            const remove = this.createEl("button", "pa-pagelet-button pa-pagelet-button--ghost", li, this.t("pagelet.panel.draft.remove", "Remove"));
            remove.setAttribute("type", "button");
            remove.addEventListener("click", () => {
                this.acceptedDraft = this.acceptedDraft.filter((draftItem) => draftItem.key !== item.key);
                if (this.acceptedDraft.length === 0) this.acceptedDraftSourcePath = undefined;
                this.renderDraft();
                this.savePendingDraftSnapshot();
            });
        }
        const save = this.createEl("button", "pa-pagelet-button pa-pagelet-button--primary pa-pagelet-draft__save", this.dom.draft, this.t("pagelet.panel.draft.save", "Save review note"));
        save.setAttribute("type", "button");
        save.setAttribute("aria-label", this.t("pagelet.panel.draft.save", "Save review note"));
        if (this.pendingWritePreview || this.draftSaveInFlight) save.disabled = true;
        save.addEventListener("click", () => {
            this.saveDraftReview();
        });
    }

    private saveDraftReview(): void {
        if (this.pendingWritePreview || this.draftSaveInFlight) return;
        const request = this.buildDraftReviewSaveRequest();
        if (!request) {
            this.flashStatus(this.t("pagelet.panel.draft.empty", "Add suggestions to collect a draft."));
            return;
        }
        this.draftSaveInFlight = true;
        this.refreshInteractionLocks();
        this.renderDraft();
        void this.callbacks.saveDraftReview(request)
            .catch(() => {
                this.flashStatus(this.t("pagelet.panel.status.actionFailed", "Action failed"));
            })
            .finally(() => {
                this.draftSaveInFlight = false;
                this.refreshInteractionLocks();
                this.renderDraft();
            });
    }

    private buildDraftReviewSaveRequest(): PageletDraftReviewSaveRequest | null {
        if (!this.currentReview || this.acceptedDraft.length === 0) return null;
        const suggestions = this.acceptedDraft.map((item) => ({
            ...item.suggestion,
            proposed_action: item.text.trim() || item.suggestion.proposed_action,
        }));
        const result: PageletReviewResult = {
            ...this.currentReview.result,
            suggestions,
        };
        return {
            sourcePath: this.currentReview.primarySourcePath ?? this.currentReview.sourcePath,
            result,
            diagnostics: this.currentReview.diagnostics,
            costSummary: this.currentReview.costSummary,
            ...(this.currentReview.targetPath ? { targetPath: this.currentReview.targetPath } : {}),
            detectedLanguage: this.currentReview.detectedLanguage ?? result.detected_language,
            mode: this.currentReview.mode ?? "basic",
        };
    }

    private renderWritePreview(spec: PreviewSpec, busy: boolean): void {
        if (!this.dom.writePreview) return;
        this.dom.writePreview.textContent = "";
        const panel = this.createEl("section", "pa-pagelet-write-preview", this.dom.writePreview);
        panel.setAttribute("role", "region");
        panel.setAttribute(
            "aria-label",
            this.t("pagelet.preview.panel.label", "Save review note"),
        );

        const header = this.createEl("div", "pa-pagelet-write-preview__header", panel);
        this.createEl(
            "h3",
            "pa-pagelet-write-preview__title",
            header,
            this.t("pagelet.preview.panel.title", "Save review note"),
        );
        this.createEl(
            "p",
            "pa-pagelet-write-preview__body",
            panel,
            this.t(
                "pagelet.preview.panel.description",
                "Create one Markdown review note. Source notes are not modified.",
            ),
        );
        this.createEl(
            "div",
            "pa-pagelet-write-preview__target",
            panel,
            this.t("pagelet.preview.panel.target", "Target") + `: ${spec.target.displayPath}`,
        ).setAttribute("title", spec.target.displayPath);

        const previewToggle = this.createEl(
            "button",
            this.writePreviewMarkdownExpanded
                ? "pa-pagelet-write-preview__toggle is-expanded"
                : "pa-pagelet-write-preview__toggle",
            panel,
            this.t("pagelet.preview.panel.markdown", "Preview Markdown"),
        );
        previewToggle.setAttribute("type", "button");
        previewToggle.setAttribute("aria-expanded", String(this.writePreviewMarkdownExpanded));
        previewToggle.addEventListener("click", () => {
            this.writePreviewMarkdownExpanded = !this.writePreviewMarkdownExpanded;
            previewToggle.classList.toggle("is-expanded", this.writePreviewMarkdownExpanded);
            previewToggle.setAttribute("aria-expanded", String(this.writePreviewMarkdownExpanded));
            pre.hidden = !this.writePreviewMarkdownExpanded;
        });
        const pre = this.createEl("pre", "pa-pagelet-write-preview__markdown", panel);
        pre.textContent = spec.contentPreview.body;
        pre.hidden = !this.writePreviewMarkdownExpanded;

        const actions = this.createEl("div", "pa-pagelet-write-preview__actions", panel);
        const cancel = this.createEl(
            "button",
            "pa-pagelet-button pa-pagelet-button--ghost pa-pagelet-write-preview__cancel",
            actions,
            spec.confirmCopy.cancelLabel,
        );
        cancel.setAttribute("type", "button");
        cancel.disabled = busy;
        cancel.addEventListener("click", () => {
            this.settleWritePreview({ outcome: "cancelled" });
        });

        const confirm = this.createEl(
            "button",
            "pa-pagelet-button pa-pagelet-button--primary pa-pagelet-write-preview__confirm",
            actions,
            busy
                ? this.t("pagelet.panel.status.saving", "Saving review note...")
                : spec.confirmCopy.confirmLabel,
        );
        confirm.setAttribute("type", "button");
        confirm.disabled = busy;
        confirm.addEventListener("click", () => {
            this.settleWritePreview({ outcome: "confirmed" });
        });
    }

    private clearWritePreview(): void {
        if (this.dom.writePreview) this.dom.writePreview.textContent = "";
    }

    private settleWritePreview(result: PreviewShowResult): void {
        const pending = this.pendingWritePreview;
        if (!pending) return;
        if (pending.signal && pending.onAbort) {
            pending.signal.removeEventListener("abort", pending.onAbort);
        }
        this.pendingWritePreview = null;
        if (result.outcome === "confirmed") {
            this.renderWritePreview(pending.spec, true);
            this.setStatus("thinking", this.t("pagelet.panel.status.saving", "Saving review note..."));
        } else {
            this.clearWritePreview();
        }
        pending.resolve(result);
        this.refreshInteractionLocks();
    }

    private savePendingDraftSnapshot(): void {
        if (this.acceptedDraft.length === 0) {
            this.clearPendingDraftSnapshot();
            return;
        }
        const snapshot: PendingDraftSnapshot = {
            version: 1,
            sourcePath: this.acceptedDraftSourcePath ?? this.reviewDraftIdentity(),
            items: this.acceptedDraft,
        };
        try {
            globalThis.localStorage?.setItem(PAGELET_PENDING_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
        } catch {
            // Local storage is best-effort; losing draft restore should not break review.
        }
    }

    private restorePendingDraft(expectedSourcePath?: string): void {
        if (this.acceptedDraft.length > 0) return;
        try {
            const raw = globalThis.localStorage?.getItem(PAGELET_PENDING_DRAFT_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as Partial<PendingDraftSnapshot>;
            if (parsed.version !== 1 || !Array.isArray(parsed.items)) return;
            if (
                expectedSourcePath
                && parsed.sourcePath
                && parsed.sourcePath !== expectedSourcePath
            ) {
                this.clearPendingDraftSnapshot();
                return;
            }
            this.acceptedDraft = parsed.items.filter(isAcceptedDraftItem);
            this.acceptedDraftSourcePath = this.acceptedDraft.length > 0
                ? parsed.sourcePath
                : undefined;
        } catch {
            this.clearPendingDraftSnapshot();
        }
    }

    private reconcileDraftWithSource(sourcePath: string): void {
        if (this.acceptedDraft.length === 0) {
            this.restorePendingDraft(sourcePath);
            this.renderDraft();
            return;
        }
        if (this.acceptedDraftSourcePath && this.acceptedDraftSourcePath !== sourcePath) {
            this.acceptedDraft = [];
            this.acceptedDraftSourcePath = undefined;
            this.clearPendingDraftSnapshot();
            this.renderDraft();
        }
    }

    private clearPendingDraftSnapshot(): void {
        try {
            globalThis.localStorage?.removeItem(PAGELET_PENDING_DRAFT_STORAGE_KEY);
        } catch {
            // Ignore best-effort storage cleanup failures.
        }
    }

    private renderCost(summary: PageletCostSummary): void {
        if (!this.dom.cost) return;
        const label = this.t("pagelet.cost.todayTotal", "Today's cost");
        this.dom.cost.textContent = `${label}: ${formatUsd(summary.estimatedCost)}`;
        this.dom.cost.setAttribute("data-pricing-known", String(summary.pricingKnown));
    }

    private destroyCards(): void {
        for (const renderer of this.cardRenderers) {
            renderer.destroy();
        }
        this.cardRenderers = [];
        if (this.dom.cards) this.dom.cards.textContent = "";
    }

    private flashStatus(message: string): void {
        if (this.dom.status) this.dom.status.textContent = message;
    }

    private flashStatusWithUndo(message: string, onUndo: () => void): void {
        const el = this.dom.status;
        if (!el) return;
        el.textContent = "";
        const span = document.createElement("span");
        span.textContent = message + " ";
        el.appendChild(span);
        const btn = document.createElement("button");
        btn.textContent = this.t("pagelet.panel.action.undo", "Undo");
        btn.className = "pa-pagelet-status__undo";
        btn.setAttribute("type", "button");
        btn.setAttribute("aria-label", this.t("pagelet.panel.action.undoDismiss", "Undo dismiss"));
        let expired = this.closed;
        btn.addEventListener("click", () => {
            if (expired) return;
            expired = true;
            onUndo();
        });
        el.appendChild(btn);
        if (this.undoTimer !== null) clearTimeout(this.undoTimer);
        this.undoTimer = setTimeout(() => {
            this.undoTimer = null;
            expired = true;
            if (el.contains(btn)) el.textContent = message;
        }, UNDO_TIMEOUT_MS);
    }

    private createEl<K extends keyof HTMLElementTagNameMap>(
        tag: K,
        className: string,
        parent?: HTMLElement,
        text?: string,
    ): HTMLElementTagNameMap[K] {
        const el = document.createElement(tag);
        el.className = className;
        if (text !== undefined) el.textContent = text;
        (parent ?? this.contentEl).appendChild(el);
        return el;
    }

    private locale(): PageletLocale {
        return getPageletUiLanguage();
    }

    private t(
        key: string,
        fallback: string,
        params?: Readonly<Record<string, string | number>>,
    ): string {
        return pageletT(key, this.locale(), params, fallback);
    }
}

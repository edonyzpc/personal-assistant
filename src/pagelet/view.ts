/* Copyright 2023 edonyzpc */

import { ItemView, WorkspaceLeaf } from "obsidian";

import type {
    PreviewShowOptions,
    PreviewShowResult,
    PreviewSpec,
} from "../ai-services/write-action-framework";
import type { PluginManager } from "../plugin";
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
import type { PageletReviewResult, PageletSuggestion } from "./pa-review-schemas";
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

export interface PageletPanelReviewData {
    sourcePath: string;
    result: PageletReviewResult;
    diagnostics: PageletReviewDiagnostics;
    costSummary: PageletCostSummary;
    targetPath?: string;
    sourceReferences?: readonly PageletScopeSourceReference[];
    sourcePaths?: readonly string[];
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

export class PageletView extends ItemView {
    private rootEl: HTMLElement | null = null;
    private mascotHostEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private sourceEl: HTMLElement | null = null;
    private costEl: HTMLElement | null = null;
    private summaryEl: HTMLElement | null = null;
    private cardsEl: HTMLElement | null = null;
    private draftEl: HTMLElement | null = null;
    private writePreviewEl: HTMLElement | null = null;
    private targetEl: HTMLElement | null = null;
    private scopeEl: HTMLElement | null = null;
    private scopeRangeEl: HTMLElement | null = null;
    private scopeListEl: HTMLElement | null = null;
    private reviewButtonEl: HTMLButtonElement | null = null;
    private mascot: MascotRenderer | null = null;
    private cardRenderers: SuggestionCardRenderer[] = [];
    private currentReview: PageletPanelReviewData | null = null;
    private sourceReferences = new Map<string, PageletScopeSourceReference>();
    private scopePlan: PageletScopePlan | null = null;
    private scopeRange: PageletReviewRange = "current";
    private closed = true;
    private dismissedKeys = new Set<string>();
    private acceptedDraft: AcceptedDraftItem[] = [];
    private acceptedDraftSourcePath: string | undefined;
    private writePreviewMarkdownExpanded = false;
    private pendingWritePreview: {
        spec: PreviewSpec;
        resolve: (result: PreviewShowResult) => void;
        signal?: AbortSignal;
        onAbort?: () => void;
    } | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: PluginManager,
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
        void this.plugin.refreshPageletScope(this.scopeRange);
        this.setStatus("idle", this.t("pagelet.panel.status.idle", "Ready"));
    }

    async onClose(): Promise<void> {
        this.settleWritePreview({ outcome: "cancelled" });
        this.closed = true;
        this.destroyCards();
        this.mascot?.destroy();
        this.mascot = null;
        this.rootEl = null;
        this.mascotHostEl = null;
        this.statusEl = null;
        this.sourceEl = null;
        this.costEl = null;
        this.summaryEl = null;
        this.cardsEl = null;
        this.draftEl = null;
        this.writePreviewEl = null;
        this.targetEl = null;
        this.scopeEl = null;
        this.scopeRangeEl = null;
        this.scopeListEl = null;
        this.reviewButtonEl = null;
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

    showReviewStarted(sourcePath: string): void {
        this.renderShell();
        this.clearReview();
        this.setStatus("thinking", this.t("pagelet.panel.status.thinking", "Reviewing current note..."));
        this.setSource(sourcePath);
    }

    showReviewResult(data: PageletPanelReviewData): void {
        this.renderShell();
        this.settleWritePreview({ outcome: "cancelled" });
        this.clearWritePreview();
        this.currentReview = data;
        this.sourceReferences = new Map(
            (data.sourceReferences ?? []).map((reference) => [reference.sourceId, reference]),
        );
        this.dismissedKeys.clear();
        this.acceptedDraft = [];
        this.acceptedDraftSourcePath = data.sourcePath;
        this.writePreviewMarkdownExpanded = false;
        this.setStatus("done", this.t("pagelet.panel.status.ready", "Suggestions ready"));
        this.setSource(data.sourcePath);
        this.renderSummary(data.result);
        this.renderCards();
        this.renderDraft();
        this.renderCost(data.costSummary);
        if (data.targetPath) this.setTarget(data.targetPath, false);
    }

    showReviewSaved(targetPath: string, costSummary: PageletCostSummary): void {
        this.renderShell();
        this.clearWritePreview();
        this.setStatus("done", this.t("pagelet.panel.status.saved", "Review note saved"));
        this.renderCost(costSummary);
        this.setTarget(targetPath, true);
        this.clearPendingDraftSnapshot();
    }

    showReviewNotSaved(): void {
        this.renderShell();
        this.clearWritePreview();
        this.setStatus("done", this.t("pagelet.panel.status.notSaved", "Suggestions ready; note not saved"));
    }

    showReviewEmpty(sourcePath: string): void {
        this.renderShell();
        this.clearReview();
        this.setStatus("done", this.t("pagelet.panel.status.empty", "No suggestions worth saving"));
        this.setSource(sourcePath);
    }

    showReviewAborted(sourcePath: string): void {
        this.renderShell();
        this.setStatus("idle", this.t("pagelet.panel.status.aborted", "Review stopped"));
        this.setSource(sourcePath);
    }

    showReviewError(message: string, sourcePath?: string): void {
        this.renderShell();
        this.clearReview();
        this.setStatus("error", message);
        if (sourcePath) this.setSource(sourcePath);
    }

    showWritePreview(spec: PreviewSpec, options?: PreviewShowOptions): Promise<PreviewShowResult> {
        if (options?.signal?.aborted) {
            return Promise.resolve({ outcome: "aborted" });
        }
        this.renderShell();
        if (this.closed || !this.writePreviewEl) {
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
            this.renderWritePreview(spec, false);
        });
    }

    private renderShell(): void {
        if (this.closed) return;
        if (this.rootEl) return;

        this.contentEl.textContent = "";
        this.contentEl.classList.add("pa-pagelet-view");
        this.contentEl.setAttribute("data-plugin", "pa-pagelet");

        const root = this.createEl("div", "pa-pagelet-shell");
        const header = this.createEl("header", "pa-pagelet-header", root);
        this.mascotHostEl = this.createEl("div", "pa-pagelet-header__mascot", header);
        this.mascot = createMascotRenderer(this.mascotHostEl, {
            locale: this.locale(),
            initialState: "idle",
        });

        const titleGroup = this.createEl("div", "pa-pagelet-header__title", header);
        this.createEl("h2", "pa-pagelet-title", titleGroup, this.t("pagelet.panel.title", "Pagelet"));
        this.sourceEl = this.createEl("p", "pa-pagelet-source", titleGroup, this.t("pagelet.panel.source.none", "No note selected"));

        const actions = this.createEl("div", "pa-pagelet-header__actions", header);
        const reviewButton = this.createEl("button", "pa-pagelet-button pa-pagelet-button--primary", actions, this.t("pagelet.command.reviewCurrent", "Pagelet: Review current note"));
        reviewButton.setAttribute("type", "button");
        reviewButton.addEventListener("click", () => {
            void this.plugin.runPageletReviewForPageletScope();
        });
        this.reviewButtonEl = reviewButton;
        this.updateReviewButton();

        this.scopeEl = this.createEl("section", "pa-pagelet-scope", root);
        this.renderScope();

        const statusBar = this.createEl("section", "pa-pagelet-status", root);
        this.statusEl = this.createEl("div", "pa-pagelet-status__state", statusBar);
        this.costEl = this.createEl("div", "pa-pagelet-status__cost", statusBar, this.t("pagelet.panel.cost.none", "No review cost yet"));
        this.targetEl = this.createEl("div", "pa-pagelet-status__target", statusBar);

        const body = this.createEl("main", "pa-pagelet-workspace", root);
        const findings = this.createEl("section", "pa-pagelet-findings", body);
        this.summaryEl = this.createEl("div", "pa-pagelet-summary", findings, this.t("pagelet.panel.empty", "Run Pagelet to review the current note."));
        this.cardsEl = this.createEl("div", "pa-pagelet-cards", findings);
        this.cardsEl.setAttribute("aria-label", this.t("pagelet.a11y.suggestionsRegion", "Pagelet suggestions"));
        this.cardsEl.setAttribute("role", "region");
        this.cardsEl.setAttribute("aria-live", "polite");
        this.cardsEl.setAttribute("aria-atomic", "false");

        const draft = this.createEl("aside", "pa-pagelet-draft", body);
        this.createEl("h3", "pa-pagelet-draft__title", draft, this.t("pagelet.panel.draft.title", "Draft"));
        this.draftEl = this.createEl("div", "pa-pagelet-draft__items", draft);
        this.writePreviewEl = this.createEl("div", "pa-pagelet-write-preview-host", draft);
        this.renderDraft();

        this.contentEl.appendChild(root);
        this.rootEl = root;
    }

    private renderScope(): void {
        if (!this.scopeEl) return;
        this.scopeEl.textContent = "";
        const header = this.createEl("div", "pa-pagelet-scope__header", this.scopeEl);
        this.createEl("h3", "pa-pagelet-scope__title", header, this.t("pagelet.panel.scope.title", "Scope"));
        this.scopeRangeEl = this.createEl("div", "pa-pagelet-scope__ranges", header);
        const ranges: PageletReviewRange[] = ["current", "yesterday", "last3", "last7"];
        for (const range of ranges) {
            const button = this.createEl(
                "button",
                range === this.scopeRange
                    ? "pa-pagelet-scope__range is-active"
                    : "pa-pagelet-scope__range",
                this.scopeRangeEl,
                this.scopeLabel(range),
            );
            button.setAttribute("type", "button");
            button.setAttribute("aria-pressed", String(range === this.scopeRange));
            button.addEventListener("click", () => {
                this.scopeRange = range;
                void this.plugin.refreshPageletScope(range, this.scopePlan?.activePath);
            });
        }

        this.scopeListEl = this.createEl("div", "pa-pagelet-scope__list", this.scopeEl);
        const excludedReviewOutputCount = this.scopePlan?.excludedReviewOutputCount ?? 0;
        if (!this.scopePlan || (this.scopePlan.candidates.length === 0 && excludedReviewOutputCount === 0)) {
            this.createEl("p", "pa-pagelet-scope__empty", this.scopeListEl, this.t("pagelet.panel.scope.empty", "No notes in scope."));
            return;
        }

        const included = this.scopePlan.candidates.filter((candidate) => candidate.included);
        const skipped = this.scopePlan.candidates.filter((candidate) => !candidate.included);
        if (included.length === 0 && skipped.length === 0) {
            this.createEl("p", "pa-pagelet-scope__empty", this.scopeListEl, this.t("pagelet.panel.scope.empty", "No notes in scope."));
        }
        this.renderScopeGroup(this.t("pagelet.panel.scope.included", "Included"), included);
        if (skipped.length > 0) {
            this.renderScopeGroup(this.t("pagelet.panel.scope.skipped", "Skipped"), skipped);
        }
        this.renderScopeSummaries();
        this.updateReviewButton();
    }

    private renderScopeSummaries(): void {
        if (!this.scopeListEl || !this.scopePlan) return;
        const count = this.scopePlan.excludedReviewOutputCount ?? 0;
        if (count <= 0) return;
        this.createEl(
            "p",
            "pa-pagelet-scope__summary",
            this.scopeListEl,
            this.t(
                "pagelet.panel.scope.summary.review-output",
                "Excluded: {count} Pagelet review notes",
                { count },
            ),
        );
    }

    private renderScopeGroup(label: string, candidates: PageletScopePlan["candidates"]): void {
        if (!this.scopeListEl || candidates.length === 0) return;
        const group = this.createEl("div", "pa-pagelet-scope__group", this.scopeListEl);
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
        this.currentReview = null;
        this.sourceReferences.clear();
        this.dismissedKeys.clear();
        this.acceptedDraft = [];
        this.acceptedDraftSourcePath = undefined;
        this.clearPendingDraftSnapshot();
        this.destroyCards();
        if (this.summaryEl) {
            this.summaryEl.textContent = this.t("pagelet.panel.empty", "Run Pagelet to review the current note.");
        }
        if (this.costEl) {
            this.costEl.textContent = this.t("pagelet.panel.cost.none", "No review cost yet");
        }
        if (this.targetEl) this.targetEl.textContent = "";
        this.clearWritePreview();
        this.renderDraft();
    }

    private setStatus(state: MascotState, message: string): void {
        if (this.statusEl) this.statusEl.textContent = message;
        this.mascot?.setState(state, { message });
    }

    private setSource(sourcePath: string): void {
        if (this.sourceEl) {
            this.sourceEl.textContent = sourcePath;
            this.sourceEl.setAttribute("title", sourcePath);
        }
    }

    private setTarget(targetPath: string, saved: boolean): void {
        if (!this.targetEl) return;
        const label = saved
            ? this.t("pagelet.panel.target.saved", "Saved to")
            : this.t("pagelet.panel.target.pending", "Review note");
        this.targetEl.textContent = `${label}: ${targetPath}`;
        this.targetEl.setAttribute("title", targetPath);
    }

    private updateReviewButton(): void {
        if (!this.reviewButtonEl) return;
        const count = this.getScopeSelection().paths.length;
        const label = this.t(
            "pagelet.panel.action.reviewSelected",
            "Review selected ({count})",
            { count },
        );
        const description = this.t(
            "pagelet.panel.action.reviewSelectedDescription",
            "Review {count} selected notes. Selected note text may be sent to your configured AI provider and may use credits.",
            { count },
        );
        this.reviewButtonEl.textContent = label;
        this.reviewButtonEl.setAttribute("title", description);
        this.reviewButtonEl.setAttribute("aria-label", description);
        this.reviewButtonEl.disabled = count === 0;
    }

    private renderSummary(result: PageletReviewResult): void {
        if (!this.summaryEl) return;
        this.summaryEl.textContent = result.overall_remark?.trim()
            || this.t("pagelet.panel.summary.empty", "Pagelet found suggestions for this note.");
    }

    private renderCards(): void {
        if (!this.cardsEl || !this.currentReview) return;
        this.destroyCards();
        const locale = this.locale();
        const visibleSuggestions = this.currentReview.result.suggestions
            .filter((suggestion) => !this.dismissedKeys.has(suggestionKey(suggestion)));
        if (visibleSuggestions.length === 0) {
            this.cardsEl.textContent = this.t("pagelet.panel.cards.empty", "No visible suggestions.");
            return;
        }
        this.cardsEl.textContent = "";
        for (const suggestion of visibleSuggestions) {
            const renderer = createSuggestionCardRenderer(
                this.cardsEl,
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
        this.acceptedDraftSourcePath = this.currentReview?.sourcePath ?? this.acceptedDraftSourcePath;
        if (!this.acceptedDraft.some((item) => item.key === key)) {
            this.acceptedDraft.push({ key, suggestion, text: suggestion.proposed_action });
        }
        this.renderDraft();
        this.savePendingDraftSnapshot();
        this.flashStatus(this.t("pagelet.panel.status.added", "Added to draft"));
    }

    private dismissSuggestion(suggestion: PageletSuggestion): void {
        this.dismissedKeys.add(suggestionKey(suggestion));
        this.renderCards();
        this.flashStatus(this.t("pagelet.panel.status.dismissed", "Suggestion dismissed"));
    }

    private openSourceReference(sourceId: string): void {
        const reference = this.sourceReferences.get(sourceId);
        if (!reference) {
            this.flashStatus(this.t("pagelet.panel.status.source", "Source") + `: ${sourceId}`);
            return;
        }
        this.runPanelAction(this.plugin.openPageletSourceReference(reference), (opened) => {
            this.flashStatus(opened
                ? `${this.t("pagelet.panel.status.source", "Source")}: ${reference.label}`
                : this.t("pagelet.panel.status.relatedMissing", "Related note not found"));
        });
    }

    private openRelatedNote(noteName: string, suggestion: PageletSuggestion): void {
        const source = this.sourceReferences.get(suggestion.source_id)?.path
            ?? this.currentReview?.sourcePath
            ?? "";
        this.runPanelAction(this.plugin.openPageletRelatedNote(noteName, source), (opened) => {
            this.flashStatus(opened
                ? this.t("pagelet.panel.status.relatedOpened", "Opened related note")
                : this.t("pagelet.panel.status.relatedMissing", "Related note not found"));
        });
    }

    private prepareResearchPrompt(suggestion: PageletSuggestion): void {
        this.runPanelAction(this.plugin.preparePageletResearchPrompt(suggestion), (prepared) => {
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
        if (!this.draftEl) return;
        this.draftEl.textContent = "";
        if (this.acceptedDraft.length === 0) {
            this.createEl("p", "pa-pagelet-draft__empty", this.draftEl, this.t("pagelet.panel.draft.empty", "Add suggestions to collect a draft."));
            return;
        }
        const list = this.createEl("ol", "pa-pagelet-draft__list", this.draftEl);
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
    }

    private renderWritePreview(spec: PreviewSpec, busy: boolean): void {
        if (!this.writePreviewEl) return;
        this.writePreviewEl.textContent = "";
        const panel = this.createEl("section", "pa-pagelet-write-preview", this.writePreviewEl);
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
    }

    private clearWritePreview(): void {
        if (this.writePreviewEl) this.writePreviewEl.textContent = "";
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
    }

    private savePendingDraftSnapshot(): void {
        if (this.acceptedDraft.length === 0) {
            this.clearPendingDraftSnapshot();
            return;
        }
        const snapshot: PendingDraftSnapshot = {
            version: 1,
            sourcePath: this.acceptedDraftSourcePath ?? this.currentReview?.sourcePath,
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
        if (!this.costEl) return;
        const label = this.t("pagelet.cost.todayTotal", "Today's cost");
        this.costEl.textContent = `${label}: ${formatUsd(summary.estimatedCost)}`;
        this.costEl.setAttribute("data-pricing-known", String(summary.pricingKnown));
    }

    private destroyCards(): void {
        for (const renderer of this.cardRenderers) {
            renderer.destroy();
        }
        this.cardRenderers = [];
        if (this.cardsEl) this.cardsEl.textContent = "";
    }

    private flashStatus(message: string): void {
        if (this.statusEl) this.statusEl.textContent = message;
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

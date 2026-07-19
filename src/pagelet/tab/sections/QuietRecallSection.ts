/* Copyright 2023 edonyzpc */

import {
    quietRecallGovernedClaimId,
    quietRecallLinkTargetPath,
    type QuietRecallCandidate,
    type QuietRecallSaveResult,
} from "../../../pa";
import type { PanelQuietRecallState } from "../../panel/types";
import type { PageletLocale } from "../../../locales/pagelet";
import { pageletT } from "../../../locales/pagelet";
import { clearChildren, el, renderEmptyCard } from "../../dom-utils";
import type { TabSectionRenderer, TabSectionCallbacks, QuietRecallLinkResult, QuietRecallSaveState, QuietRecallLinkState } from "./types";

export interface QuietRecallCallbacks {
    onSave?: (candidate: QuietRecallCandidate) => Promise<QuietRecallSaveResult>;
    onLink?: (candidate: QuietRecallCandidate, currentPath?: string) => Promise<QuietRecallLinkResult>;
    onOpenSource?: (path: string) => void;
    onOpenMemorySettings?: (targetId?: string) => void;
}

function isAiEvaluatedCandidate(candidate: QuietRecallCandidate): boolean {
    return candidate.evaluationProvenance === "ai"
        && Boolean(candidate.evaluationFingerprint?.trim());
}

function hasValidSourceRefs(candidate: QuietRecallCandidate): boolean {
    return candidate.sourceRefs.length > 0
        && candidate.sourceRefs.every((ref) => Boolean(ref.path.trim()));
}

function sourceTitle(path: string): string {
    const name = path.split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export class QuietRecallSection implements TabSectionRenderer {
    private readonly saveState: Map<string, QuietRecallSaveState>;
    private readonly linkState: Map<string, QuietRecallLinkState>;
    private readonly ownsSaveState: boolean;
    private readonly ownsLinkState: boolean;
    private containerEl: HTMLElement | null = null;
    private pendingFocusKeys: string[] = [];
    private destroyed = false;

    constructor(
        private readonly locale: PageletLocale,
        private readonly data: PanelQuietRecallState,
        private readonly callbacks: QuietRecallCallbacks,
        private readonly section: TabSectionCallbacks,
        private readonly sourcePath?: string,
        saveState?: Map<string, QuietRecallSaveState>,
        linkState?: Map<string, QuietRecallLinkState>,
    ) {
        this.saveState = saveState ?? new Map<string, QuietRecallSaveState>();
        this.linkState = linkState ?? new Map<string, QuietRecallLinkState>();
        this.ownsSaveState = saveState === undefined;
        this.ownsLinkState = linkState === undefined;
    }

    hasContent(): boolean {
        return true;
    }

    render(container: HTMLElement): void {
        this.containerEl = container;
        this.renderInto();
    }

    rerender(): void {
        if (!this.containerEl) return;
        clearChildren(this.containerEl);
        this.renderInto();
        this.restorePendingFocus();
    }

    destroy(): void {
        this.destroyed = true;
        if (this.ownsSaveState) this.saveState.clear();
        if (this.ownsLinkState) this.linkState.clear();
        this.pendingFocusKeys = [];
        this.containerEl = null;
    }

    private requestRerenderWithFocus(...focusKeys: string[]): void {
        this.pendingFocusKeys = focusKeys;
        this.section.requestRerender();
    }

    private restorePendingFocus(): void {
        if (this.pendingFocusKeys.length === 0 || !this.containerEl) return;
        const focusKeys = this.pendingFocusKeys;
        this.pendingFocusKeys = [];
        const keyedElements = Array.from(this.containerEl.querySelectorAll<HTMLElement>(
            "[data-pa-recall-focus-key]",
        ));
        const target = focusKeys
            .map((focusKey) => keyedElements.find((element) => (
                element.getAttribute("data-pa-recall-focus-key") === focusKey
            )))
            .find((element) => element !== undefined
                && (element.tagName !== "BUTTON" || !(element as HTMLButtonElement).disabled));
        target?.focus({ preventScroll: true });
    }

    private candidateFocusKey(candidateId: string, target: "card" | "link" | "save"): string {
        return `recall:${candidateId}:${target}`;
    }

    private setFocusKey(element: HTMLElement, focusKey: string): void {
        element.setAttribute("data-pa-recall-focus-key", focusKey);
    }

    private canCommitSaveState(): boolean {
        return !this.destroyed || (!this.ownsSaveState && this.section.canCommitActionState?.() !== false);
    }

    private canCommitLinkState(): boolean {
        return !this.destroyed || (!this.ownsLinkState && this.section.canCommitActionState?.() !== false);
    }

    private renderInto(): void {
        if (!this.containerEl) return;
        const candidates = this.visibleCandidates().filter(hasValidSourceRefs);
        const recallCandidates = candidates.filter(isAiEvaluatedCandidate);
        const localCandidates = candidates.filter((candidate) => !isAiEvaluatedCandidate(candidate));

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-quiet-recall");
        section.appendChild(el("h2", undefined, pageletT(
            recallCandidates.length > 0
                ? "pagelet.tab.recall.title"
                : localCandidates.length > 0
                    ? "pagelet.recall.localClue"
                    : "pagelet.tab.recall.title",
            this.locale,
        )));

        if (candidates.length === 0) {
            section.appendChild(renderEmptyCard(
                "pa-pagelet-tab-recall-empty", "pagelet.tab.recall.empty", undefined, this.locale));
            this.containerEl.appendChild(section);
            return;
        }

        if (recallCandidates.length > 0) {
            section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
                pageletT("pagelet.tab.recall.summary", this.locale, { count: recallCandidates.length })));
            for (const candidate of recallCandidates) {
                section.appendChild(this.renderRecallCard(candidate));
            }
        }

        if (localCandidates.length > 0) {
            const localGroup = el("div", "pa-pagelet-tab-local-clue-group");
            if (recallCandidates.length > 0) {
                localGroup.appendChild(el(
                    "h3",
                    undefined,
                    pageletT("pagelet.recall.localClue", this.locale),
                ));
            }
            for (const candidate of localCandidates) {
                localGroup.appendChild(this.renderLocalClueCard(candidate));
            }
            section.appendChild(localGroup);
        }

        this.containerEl.appendChild(section);
    }

    private visibleCandidates(): QuietRecallCandidate[] {
        const byId = new Map<string, QuietRecallCandidate>();
        for (const candidate of this.data.discoverCandidates ?? []) {
            byId.set(candidate.id, candidate);
        }
        for (const candidate of this.data.candidates) {
            const existing = byId.get(candidate.id);
            if (!existing || isAiEvaluatedCandidate(candidate) || !isAiEvaluatedCandidate(existing)) {
                byId.set(candidate.id, candidate);
            }
        }
        return [...byId.values()];
    }

    private renderRecallCard(candidate: QuietRecallCandidate): HTMLElement {
        const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-recall-card");
        cardEl.tabIndex = -1;
        this.setFocusKey(cardEl, this.candidateFocusKey(candidate.id, "card"));
        cardEl.appendChild(el("h4", undefined, candidate.title));
        cardEl.appendChild(el("p", undefined, candidate.summary));

        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.recall.relation.${candidate.relation}`, this.locale)));
        cardEl.appendChild(tagRow);

        this.appendCandidateMetadata(cardEl, candidate);

        cardEl.appendChild(el("p", "pa-pagelet-tab-muted",
            pageletT("pagelet.tab.recall.whyNow", this.locale, {
                reason: candidate.whyNow.slice(0, 2).join("; "),
            })));
        cardEl.appendChild(el("p", "pa-pagelet-tab-muted",
            pageletT("pagelet.tab.recall.nextAction", this.locale, {
                action: candidate.nextAction,
            })));

        const memoryClaimId = quietRecallGovernedClaimId(candidate);
        if (memoryClaimId && this.callbacks.onOpenMemorySettings) {
            const memoryTarget = el(
                "button",
                "pa-pagelet-tab-recall-memory-target pa-pagelet-tab-memory-settings",
                pageletT("pagelet.tab.memory.openSettings", this.locale),
            );
            memoryTarget.setAttribute("type", "button");
            memoryTarget.addEventListener("click", (event) => {
                event.preventDefault();
                this.callbacks.onOpenMemorySettings?.(memoryClaimId);
            });
            cardEl.appendChild(memoryTarget);
        }

        this.renderActions(cardEl, candidate);
        return cardEl;
    }

    private renderLocalClueCard(candidate: QuietRecallCandidate): HTMLElement {
        const cardEl = el(
            "div",
            "pa-pagelet-tab-insight-card pa-pagelet-tab-card--source-list pa-pagelet-tab-local-clue-card",
        );
        cardEl.tabIndex = -1;
        this.setFocusKey(cardEl, this.candidateFocusKey(candidate.id, "card"));

        const source = candidate.sourceRefs[0]?.path;
        cardEl.appendChild(el(
            "span",
            "pa-pagelet-tab-tag-chip pa-pagelet-tab-local-clue-label",
            pageletT("pagelet.recall.localClue", this.locale),
        ));
        if (source) cardEl.appendChild(el("h4", undefined, sourceTitle(source)));

        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el(
            "span",
            "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.recall.localRelation.${candidate.relation}`, this.locale),
        ));
        cardEl.appendChild(tagRow);

        this.appendCandidateMetadata(cardEl, candidate);
        this.renderActions(cardEl, candidate, { allowSave: false });
        return cardEl;
    }

    private appendCandidateMetadata(cardEl: HTMLElement, candidate: QuietRecallCandidate): void {
        const metadata = el("div", "pa-pagelet-tab-recall-meta");
        const source = candidate.sourceRefs[0]?.path;
        if (source) {
            this.appendMetadataRow(
                metadata,
                "pagelet.tab.recall.sourceLabel",
                source,
                this.callbacks.onOpenSource
                    ? () => this.callbacks.onOpenSource?.(source)
                    : undefined,
            );
        }
        this.appendMetadataRow(
            metadata,
            "pagelet.tab.recall.scopeLabel",
            pageletT("pagelet.tab.recall.scope.currentVault", this.locale),
        );
        this.appendMetadataRow(
            metadata,
            "pagelet.tab.recall.effectLabel",
            pageletT("pagelet.tab.recall.effect.retrievalOnly", this.locale),
        );
        cardEl.appendChild(metadata);
    }

    private appendMetadataRow(
        container: HTMLElement,
        labelKey: string,
        value: string,
        onOpen?: () => void,
    ): void {
        const row = el("div", "pa-pagelet-tab-memory-meta-row pa-pagelet-tab-recall-meta-row");
        row.appendChild(el(
            "span",
            "pa-pagelet-tab-memory-meta-label pa-pagelet-tab-recall-meta-label",
            pageletT(labelKey, this.locale),
        ));
        if (onOpen) {
            const button = el(
                "button",
                "pa-pagelet-tab-source-link pa-pagelet-tab-recall-source",
                value,
            );
            button.setAttribute("type", "button");
            button.addEventListener("click", (event) => {
                event.preventDefault();
                onOpen();
            });
            row.appendChild(button);
        } else {
            row.appendChild(el(
                "span",
                "pa-pagelet-tab-memory-meta-value pa-pagelet-tab-recall-meta-value",
                value,
            ));
        }
        container.appendChild(row);
    }

    private renderActions(
        cardEl: HTMLElement,
        candidate: QuietRecallCandidate,
        options: { allowSave?: boolean } = {},
    ): void {
        const candidateSaveState = this.saveState.get(candidate.id);
        const candidateLinkState = this.linkState.get(candidate.id);
        const currentPath = this.data.currentPath ?? this.sourcePath;
        const linkTargetPath = quietRecallLinkTargetPath(candidate, currentPath);
        const canLink = Boolean(this.callbacks.onLink && linkTargetPath);
        const canSave = options.allowSave !== false && Boolean(this.callbacks.onSave);
        if (!canLink && !canSave) return;
        const actionRow = el("div", "pa-pagelet-tab-recall-actions");

        if (this.callbacks.onLink && linkTargetPath) {
            const linkBtn = el(
                "button",
                "pa-pagelet-tab-recall-link",
                candidateLinkState?.status === "linking"
                    ? pageletT("pagelet.tab.recall.linking", this.locale)
                    : candidateLinkState?.status === "linked"
                        ? pageletT("pagelet.tab.recall.linked", this.locale)
                        : pageletT("pagelet.tab.recall.link", this.locale),
            );
            linkBtn.setAttribute("type", "button");
            this.setFocusKey(linkBtn, this.candidateFocusKey(candidate.id, "link"));
            if (candidateLinkState?.status === "linking" || candidateLinkState?.status === "linked") {
                linkBtn.disabled = true;
                linkBtn.setAttribute("aria-disabled", "true");
            }
            linkBtn.addEventListener("click", (event) => {
                event.preventDefault();
                void this.linkCandidate(candidate);
            });
            actionRow.appendChild(linkBtn);
        }

        if (canSave) {
            const saveBtn = el(
                "button",
                "pa-pagelet-tab-recall-save",
                candidateSaveState?.status === "saving"
                    ? pageletT("pagelet.tab.recall.saving", this.locale)
                    : candidateSaveState?.status === "saved"
                        ? pageletT("pagelet.tab.recall.saved", this.locale)
                        : pageletT("pagelet.tab.recall.saveInsight", this.locale),
            );
            saveBtn.setAttribute("type", "button");
            this.setFocusKey(saveBtn, this.candidateFocusKey(candidate.id, "save"));
            if (candidateSaveState?.status === "saving" || candidateSaveState?.status === "saved") {
                saveBtn.disabled = true;
                saveBtn.setAttribute("aria-disabled", "true");
            }
            saveBtn.addEventListener("click", (event) => {
                event.preventDefault();
                void this.saveCandidate(candidate);
            });
            actionRow.appendChild(saveBtn);
        }

        for (const status of [candidateLinkState, candidateSaveState]) {
            if (!status) continue;
            const statusEl = el("span", "pa-pagelet-tab-maintenance-status", status.message);
            statusEl.setAttribute("role", "status");
            statusEl.setAttribute("aria-live", "polite");
            actionRow.appendChild(statusEl);
        }
        cardEl.appendChild(actionRow);
    }

    private async linkCandidate(candidate: QuietRecallCandidate): Promise<void> {
        if (!this.callbacks.onLink) return;
        const currentPath = this.data.currentPath ?? this.sourcePath;
        if (!quietRecallLinkTargetPath(candidate, currentPath)) return;
        this.linkState.set(candidate.id, {
            status: "linking",
            message: pageletT("pagelet.tab.recall.linking", this.locale),
        });
        const focusKeys = [
            this.candidateFocusKey(candidate.id, "link"),
            this.candidateFocusKey(candidate.id, "save"),
            this.candidateFocusKey(candidate.id, "card"),
        ];
        this.requestRerenderWithFocus(...focusKeys);
        try {
            const result = await this.callbacks.onLink(candidate, currentPath);
            if (!this.canCommitLinkState()) return;
            this.linkState.set(candidate.id, {
                status: result.ok ? "linked" : "failed",
                message: result.message,
            });
        } catch {
            if (!this.canCommitLinkState()) return;
            this.linkState.set(candidate.id, {
                status: "failed",
                message: pageletT("pagelet.tab.recall.linkFailed", this.locale),
            });
        }
        this.requestRerenderWithFocus(...focusKeys);
    }

    private async saveCandidate(candidate: QuietRecallCandidate): Promise<void> {
        if (!this.callbacks.onSave) return;
        this.saveState.set(candidate.id, {
            status: "saving",
            message: pageletT("pagelet.tab.recall.saving", this.locale),
        });
        const focusKeys = [
            this.candidateFocusKey(candidate.id, "save"),
            this.candidateFocusKey(candidate.id, "link"),
            this.candidateFocusKey(candidate.id, "card"),
        ];
        this.requestRerenderWithFocus(...focusKeys);
        try {
            const result = await this.callbacks.onSave(candidate);
            if (!this.canCommitSaveState()) return;
            this.saveState.set(candidate.id, {
                status: result.ok ? "saved" : "failed",
                message: result.message,
            });
        } catch {
            if (!this.canCommitSaveState()) return;
            this.saveState.set(candidate.id, {
                status: "failed",
                message: pageletT("pagelet.recall.save.failed", this.locale),
            });
        }
        this.requestRerenderWithFocus(...focusKeys);
    }
}

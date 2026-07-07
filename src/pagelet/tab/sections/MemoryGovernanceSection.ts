/* Copyright 2023 edonyzpc */

import type { ReviewQueueItem } from "../../../pa";
import type { PanelMemoryGovernanceState } from "../../panel/types";
import type { PageletLocale } from "../../../locales/pagelet";
import { pageletT } from "../../../locales/pagelet";
import { clearChildren, el, renderEmptyCard } from "../../dom-utils";
import type { TabSectionRenderer, TabSectionCallbacks, MemoryCandidateActionResult, MemoryCandidateActionState } from "./types";
import { getMemoryTrustLevel } from "../../../pa/memory-trust-level";

export interface MemoryGovernanceCallbacks {
    onConfirm?: (item: ReviewQueueItem) => Promise<MemoryCandidateActionResult>;
    onDismiss?: (item: ReviewQueueItem) => Promise<MemoryCandidateActionResult>;
}

export class MemoryGovernanceSection implements TabSectionRenderer {
    private readonly actionState: Map<string, MemoryCandidateActionState>;
    private readonly ownsActionState: boolean;
    private containerEl: HTMLElement | null = null;
    private destroyed = false;

    constructor(
        private readonly locale: PageletLocale,
        private readonly data: PanelMemoryGovernanceState,
        private readonly callbacks: MemoryGovernanceCallbacks,
        private readonly section: TabSectionCallbacks,
        actionState?: Map<string, MemoryCandidateActionState>,
    ) {
        this.actionState = actionState ?? new Map<string, MemoryCandidateActionState>();
        this.ownsActionState = actionState === undefined;
    }

    hasContent(): boolean {
        return (this.data.candidates?.length ?? 0) > 0
            || this.data.records.length > 0
            || (this.data.routedItems?.length ?? 0) > 0;
    }

    render(container: HTMLElement): void {
        this.containerEl = container;
        this.renderInto();
    }

    rerender(): void {
        if (!this.containerEl) return;
        clearChildren(this.containerEl);
        this.renderInto();
    }

    destroy(): void {
        this.destroyed = true;
        if (this.ownsActionState) this.actionState.clear();
        this.containerEl = null;
    }

    private canCommitActionState(): boolean {
        return !this.destroyed || (!this.ownsActionState && this.section.canCommitActionState?.() !== false);
    }

    private renderInto(): void {
        if (!this.containerEl) return;
        const candidates = this.data.candidates ?? [];
        const { records } = this.data;
        const trustLevel = getMemoryTrustLevel(this.data.confirmedMemoryCount ?? 0);

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-memory-governance");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.memory.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.memory.summary", this.locale, {
                count: this.data.totalCount,
            })));

        const pendingCandidates = candidates.filter((item) => item.type === "memory_candidate");

        // Level 1 batch digest card: show when trust level = 1 and 3+ pending candidates
        if (trustLevel === 1 && pendingCandidates.length >= 3) {
            const digestCard = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-memory-digest");
            digestCard.appendChild(el("p", undefined,
                pageletT("pagelet.tab.memory.trustDigest", this.locale, { count: pendingCandidates.length })));
            const digestActions = el("div", "pa-pagelet-tab-memory-candidate-actions");

            const acceptAllBtn = el("button", "pa-pagelet-tab-memory-confirm",
                pageletT("pagelet.tab.memory.trustDigestAcceptAll", this.locale));
            acceptAllBtn.setAttribute("type", "button");
            acceptAllBtn.addEventListener("click", () => { void this.confirmAll(pendingCandidates); });
            digestActions.appendChild(acceptAllBtn);

            const laterBtn = el("button", "pa-pagelet-tab-memory-dismiss",
                pageletT("pagelet.tab.memory.trustDigestLater", this.locale));
            laterBtn.setAttribute("type", "button");
            laterBtn.addEventListener("click", () => { this.section.requestRerender(); });
            digestActions.appendChild(laterBtn);

            digestCard.appendChild(digestActions);
            section.appendChild(digestCard);
        }

        if (candidates.length > 0) {
            const candidateGroup = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-memory-candidates");
            const headerRow = el("div", "pa-pagelet-tab-memory-candidates-header");
            headerRow.appendChild(el("h3", undefined, pageletT("pagelet.tab.memory.candidatesTitle", this.locale)));
            // At Level 2, hide "Confirm All" — candidates are auto-accepted
            if (trustLevel < 2 && pendingCandidates.length > 1 && this.callbacks.onConfirm) {
                const confirmAllButton = el("button", "pa-pagelet-tab-memory-confirm-all",
                    pageletT("pagelet.tab.memory.confirmAll", this.locale, { count: pendingCandidates.length }));
                confirmAllButton.setAttribute("type", "button");
                confirmAllButton.addEventListener("click", (event) => {
                    event.preventDefault();
                    void this.confirmAll(pendingCandidates);
                });
                headerRow.appendChild(confirmAllButton);
            }
            candidateGroup.appendChild(headerRow);
            candidateGroup.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
                trustLevel === 2
                    ? pageletT("pagelet.tab.memory.level2Summary", this.locale, { count: pendingCandidates.length })
                    : pageletT("pagelet.tab.memory.candidatesSummary", this.locale, { count: candidates.length })));
            for (const item of candidates) {
                candidateGroup.appendChild(this.renderCandidateItem(item, trustLevel));
            }
            section.appendChild(candidateGroup);
        } else {
            section.appendChild(renderEmptyCard(
                "pa-pagelet-tab-memory-candidates-empty", "pagelet.tab.memory.noCandidates", undefined, this.locale));
        }

        if (records.length > 0) {
            const recordsGroup = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-memory-records");
            recordsGroup.appendChild(el("h3", undefined, pageletT("pagelet.tab.memory.recordsTitle", this.locale)));
            for (const record of records) {
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
                recordsGroup.appendChild(cardEl);
            }
            section.appendChild(recordsGroup);
        }

        const routedItems = this.data.routedItems ?? [];
        if (routedItems.length > 0) {
            const suggestionsGroup = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-memory-suggestions");
            suggestionsGroup.appendChild(el("h3", undefined, pageletT("pagelet.tab.memory.suggestionsTitle", this.locale)));
            for (const item of routedItems) {
                suggestionsGroup.appendChild(this.renderRoutedItem(item));
            }
            section.appendChild(suggestionsGroup);
        }

        this.containerEl.appendChild(section);
    }

    private renderCandidateItem(item: ReviewQueueItem, trustLevel: 0 | 1 | 2 = 0): HTMLElement {
        const state = this.actionState.get(item.id);
        const isMemoryCandidate = item.type === "memory_candidate";
        // Level 2 auto-accept applies only to memory_candidate; memory_conflict always manual
        const isAutoAccepted = trustLevel === 2 && isMemoryCandidate;
        const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-memory-candidate-card");
        cardEl.appendChild(el("h4", undefined, item.title));
        cardEl.appendChild(el("p", undefined, item.claim));

        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.memory.candidateType.${item.type}`, this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.reviewQueue.status.${item.status}`, this.locale)));
        // Level 2: show "Auto-accepted" badge on memory_candidate items
        if (isAutoAccepted) {
            const badge = el("span", "pa-pagelet-tab-tag-chip",
                pageletT("pagelet.tab.memory.autoAccepted", this.locale));
            badge.setAttribute("role", "status");
            tagRow.appendChild(badge);
        }
        const memoryType = item.metadata?.memoryType;
        if (typeof memoryType === "string") {
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT(`pagelet.tab.memory.type.${memoryType}`, this.locale)));
        }
        const source = item.sourceRefs[0]?.path;
        if (source) tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", source));
        cardEl.appendChild(tagRow);

        const actionRow = el("div", "pa-pagelet-tab-memory-candidate-actions");
        if (isAutoAccepted) {
            // Level 2: no Confirm button for memory_candidate — only Remove (calls onDismiss)
            if (this.callbacks.onDismiss) {
                const removeButton = el("button", "pa-pagelet-tab-memory-dismiss",
                    state?.status === "dismissing"
                        ? pageletT("pagelet.tab.memory.dismissing", this.locale)
                        : state?.status === "dismissed"
                            ? pageletT("pagelet.tab.memory.dismissed", this.locale)
                            : pageletT("pagelet.tab.memory.remove", this.locale));
                removeButton.setAttribute("type", "button");
                if (state?.status === "dismissing" || state?.status === "confirmed" || state?.status === "dismissed") {
                    removeButton.disabled = true;
                    removeButton.setAttribute("aria-disabled", "true");
                }
                removeButton.addEventListener("click", (event) => {
                    event.preventDefault();
                    void this.dismissCandidate(item);
                });
                actionRow.appendChild(removeButton);
            }
        } else {
            // Level 0/1: render Confirm + Dismiss as before
            if (this.callbacks.onConfirm && isMemoryCandidate) {
                const confirmButton = el("button", "pa-pagelet-tab-memory-confirm",
                    state?.status === "confirming"
                        ? pageletT("pagelet.tab.memory.confirming", this.locale)
                        : state?.status === "confirmed"
                            ? pageletT("pagelet.tab.memory.confirmed", this.locale)
                            : pageletT("pagelet.tab.memory.confirm", this.locale));
                confirmButton.setAttribute("type", "button");
                if (state?.status === "confirming" || state?.status === "confirmed" || state?.status === "dismissed") {
                    confirmButton.disabled = true;
                    confirmButton.setAttribute("aria-disabled", "true");
                }
                confirmButton.addEventListener("click", (event) => {
                    event.preventDefault();
                    void this.confirmCandidate(item);
                });
                actionRow.appendChild(confirmButton);
            } else if (item.type === "memory_conflict") {
                actionRow.appendChild(el("span", "pa-pagelet-tab-maintenance-status",
                    pageletT("pagelet.tab.memory.conflictHint", this.locale)));
            }
            if (this.callbacks.onDismiss) {
                const dismissButton = el("button", "pa-pagelet-tab-memory-dismiss",
                    state?.status === "dismissing"
                        ? pageletT("pagelet.tab.memory.dismissing", this.locale)
                        : state?.status === "dismissed"
                            ? pageletT("pagelet.tab.memory.dismissed", this.locale)
                            : pageletT("pagelet.tab.memory.dismiss", this.locale));
                dismissButton.setAttribute("type", "button");
                if (state?.status === "dismissing" || state?.status === "confirmed" || state?.status === "dismissed") {
                    dismissButton.disabled = true;
                    dismissButton.setAttribute("aria-disabled", "true");
                }
                dismissButton.addEventListener("click", (event) => {
                    event.preventDefault();
                    void this.dismissCandidate(item);
                });
                actionRow.appendChild(dismissButton);
            }
        }
        if (state) {
            actionRow.appendChild(el("span", "pa-pagelet-tab-maintenance-status", state.message));
        }
        cardEl.appendChild(actionRow);
        return cardEl;
    }

    private renderRoutedItem(item: ReviewQueueItem): HTMLElement {
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
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.reviewQueue.type.${item.type}`, this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.reviewQueue.status.${item.status}`, this.locale)));
        const source = item.sourceRefs[0]?.path;
        if (source) tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", source));
        cardEl.appendChild(tagRow);

        if (item.whyShown.length > 0) {
            cardEl.appendChild(el("p", "pa-pagelet-tab-review-queue-why",
                pageletT("pagelet.tab.common.whyNow", this.locale, { reason: item.whyShown.slice(0, 2).join("; ") })));
        }
        return cardEl;
    }

    private async confirmAll(items: readonly ReviewQueueItem[]): Promise<void> {
        const pending = items.filter((item) => {
            const state = this.actionState.get(item.id);
            return !state || (state.status !== "confirmed" && state.status !== "confirming" && state.status !== "dismissed");
        });
        if (pending.length === 0) return;
        const message = pageletT("pagelet.tab.memory.confirmAllPrompt", this.locale, { count: pending.length });
        const confirmed = this.section.confirmAction
            ? await this.section.confirmAction(message)
            : confirm(message);
        if (!confirmed) return;
        for (const item of pending) {
            await this.confirmCandidate(item);
            if (!this.canCommitActionState()) return;
        }
    }

    private async confirmCandidate(item: ReviewQueueItem): Promise<void> {
        if (!this.callbacks.onConfirm) return;
        this.actionState.set(item.id, {
            status: "confirming",
            message: pageletT("pagelet.tab.memory.confirming", this.locale),
        });
        this.section.requestRerender();
        try {
            const result = await this.callbacks.onConfirm(item);
            if (!this.canCommitActionState()) return;
            this.actionState.set(item.id, {
                status: result.ok ? "confirmed" : "failed",
                message: result.message,
            });
        } catch (error) {
            if (!this.canCommitActionState()) return;
            this.actionState.set(item.id, {
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        this.section.requestRerender();
    }

    private async dismissCandidate(item: ReviewQueueItem): Promise<void> {
        if (!this.callbacks.onDismiss) return;
        this.actionState.set(item.id, {
            status: "dismissing",
            message: pageletT("pagelet.tab.memory.dismissing", this.locale),
        });
        this.section.requestRerender();
        try {
            const result = await this.callbacks.onDismiss(item);
            if (!this.canCommitActionState()) return;
            this.actionState.set(item.id, {
                status: result.ok ? "dismissed" : "failed",
                message: result.message,
            });
        } catch (error) {
            if (!this.canCommitActionState()) return;
            this.actionState.set(item.id, {
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        this.section.requestRerender();
    }
}

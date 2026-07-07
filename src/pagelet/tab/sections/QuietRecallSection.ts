/* Copyright 2023 edonyzpc */

import type { QuietRecallCandidate, QuietRecallSaveResult } from "../../../pa";
import type { PanelQuietRecallState } from "../../panel/types";
import type { PageletLocale } from "../../../locales/pagelet";
import { pageletT } from "../../../locales/pagelet";
import { clearChildren, el, renderEmptyCard } from "../../dom-utils";
import type { TabSectionRenderer, TabSectionCallbacks, QuietRecallLinkResult, QuietRecallSaveState, QuietRecallLinkState } from "./types";

export interface QuietRecallCallbacks {
    onSave?: (candidate: QuietRecallCandidate) => Promise<QuietRecallSaveResult>;
    onLink?: (candidate: QuietRecallCandidate, currentPath?: string) => Promise<QuietRecallLinkResult>;
}

export class QuietRecallSection implements TabSectionRenderer {
    private readonly saveState: Map<string, QuietRecallSaveState>;
    private readonly linkState: Map<string, QuietRecallLinkState>;
    private readonly ownsSaveState: boolean;
    private readonly ownsLinkState: boolean;
    private containerEl: HTMLElement | null = null;
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
        return this.data.candidates.length > 0;
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
        if (this.ownsSaveState) this.saveState.clear();
        if (this.ownsLinkState) this.linkState.clear();
        this.containerEl = null;
    }

    private canCommitSaveState(): boolean {
        return !this.destroyed || (!this.ownsSaveState && this.section.canCommitActionState?.() !== false);
    }

    private canCommitLinkState(): boolean {
        return !this.destroyed || (!this.ownsLinkState && this.section.canCommitActionState?.() !== false);
    }

    private renderInto(): void {
        if (!this.containerEl) return;
        const { candidates } = this.data;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-quiet-recall");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.recall.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.recall.summary", this.locale, { count: candidates.length })));

        if (candidates.length === 0) {
            section.appendChild(renderEmptyCard(
                "pa-pagelet-tab-recall-empty", "pagelet.tab.recall.empty", undefined, this.locale));
            this.containerEl.appendChild(section);
            return;
        }

        for (const candidate of candidates) {
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

            this.renderActions(cardEl, candidate);
            section.appendChild(cardEl);
        }

        this.containerEl.appendChild(section);
    }

    private renderActions(cardEl: HTMLElement, candidate: QuietRecallCandidate): void {
        if (!this.callbacks.onSave && !this.callbacks.onLink) return;
        const candidateSaveState = this.saveState.get(candidate.id);
        const candidateLinkState = this.linkState.get(candidate.id);
        const actionRow = el("div", "pa-pagelet-tab-recall-actions");

        if (this.callbacks.onLink) {
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

        if (this.callbacks.onSave) {
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
            actionRow.appendChild(el("span", "pa-pagelet-tab-maintenance-status", status.message));
        }
        cardEl.appendChild(actionRow);
    }

    private async linkCandidate(candidate: QuietRecallCandidate): Promise<void> {
        if (!this.callbacks.onLink) return;
        this.linkState.set(candidate.id, {
            status: "linking",
            message: pageletT("pagelet.tab.recall.linking", this.locale),
        });
        this.section.requestRerender();
        try {
            const currentPath = this.data.currentPath ?? this.sourcePath;
            const result = await this.callbacks.onLink(candidate, currentPath);
            if (!this.canCommitLinkState()) return;
            this.linkState.set(candidate.id, {
                status: result.ok ? "linked" : "failed",
                message: result.message,
            });
        } catch (error) {
            if (!this.canCommitLinkState()) return;
            this.linkState.set(candidate.id, {
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        this.section.requestRerender();
    }

    private async saveCandidate(candidate: QuietRecallCandidate): Promise<void> {
        if (!this.callbacks.onSave) return;
        this.saveState.set(candidate.id, {
            status: "saving",
            message: pageletT("pagelet.tab.recall.saving", this.locale),
        });
        this.section.requestRerender();
        try {
            const result = await this.callbacks.onSave(candidate);
            if (!this.canCommitSaveState()) return;
            this.saveState.set(candidate.id, {
                status: result.ok ? "saved" : "failed",
                message: result.message,
            });
        } catch (error) {
            if (!this.canCommitSaveState()) return;
            this.saveState.set(candidate.id, {
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        this.section.requestRerender();
    }
}

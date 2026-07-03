/* Copyright 2023 edonyzpc */

import type { MaintenanceMoveApplyResult, MaintenanceMoveUndoResult, MaintenanceProposal } from "../../../pa";
import type { PanelMaintenanceReviewState } from "../../panel/types";
import type { PageletLocale } from "../../../locales/pagelet";
import { pageletT } from "../../../locales/pagelet";
import { clearChildren, el } from "../../dom-utils";
import type { TabSectionRenderer, TabSectionCallbacks, MaintenanceActionUiState } from "./types";

export interface MaintenanceReviewCallbacks {
    onApply?: (proposal: MaintenanceProposal) => Promise<MaintenanceMoveApplyResult>;
    onUndo?: (actionId: string) => Promise<MaintenanceMoveUndoResult>;
}

export class MaintenanceReviewSection implements TabSectionRenderer {
    private readonly actionState: Map<string, MaintenanceActionUiState>;
    private readonly ownsActionState: boolean;
    private containerEl: HTMLElement | null = null;
    private destroyed = false;

    constructor(
        private readonly locale: PageletLocale,
        private readonly data: PanelMaintenanceReviewState,
        private readonly callbacks: MaintenanceReviewCallbacks,
        private readonly section: TabSectionCallbacks,
        actionState?: Map<string, MaintenanceActionUiState>,
    ) {
        this.actionState = actionState ?? new Map<string, MaintenanceActionUiState>();
        this.ownsActionState = actionState === undefined;
    }

    hasContent(): boolean {
        return this.data.categories.length > 0 || this.data.proposals.length > 0;
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
        const { categories, proposals, totalCount } = this.data;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-maintenance-review");
        section.appendChild(el("h2", undefined, pageletT("pagelet.tab.maintenance.title", this.locale)));
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT("pagelet.tab.maintenance.summary", this.locale, { count: totalCount })));

        const overviewCard = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-maintenance-overview-card");
        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", pageletT("pagelet.tab.maintenance.previewOnly", this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", pageletT("pagelet.tab.maintenance.weeklyDisabled", this.locale)));
        overviewCard.appendChild(tagRow);
        section.appendChild(overviewCard);

        const categoriesGroup = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-maintenance-categories");
        categoriesGroup.appendChild(el("h3", undefined, pageletT("pagelet.tab.maintenance.categories", this.locale)));
        for (const category of categories) {
            const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-maintenance-category-card");
            cardEl.appendChild(el("h4", undefined, category.label));
            cardEl.appendChild(el("p", undefined, String(category.count)));
            categoriesGroup.appendChild(cardEl);
        }
        section.appendChild(categoriesGroup);

        if (proposals.length === 0) {
            const emptyCard = el("div", "pa-pagelet-tab-insight-card");
            emptyCard.appendChild(el("p", undefined, pageletT("pagelet.tab.maintenance.noProposals", this.locale)));
            section.appendChild(emptyCard);
        }
        if (proposals.length > 0) {
            const proposalsGroup = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-maintenance-proposals");
            proposalsGroup.appendChild(el("h3", undefined, pageletT("pagelet.tab.maintenance.proposals", this.locale)));
            for (const proposal of proposals) {
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

                this.renderProposalActions(cardEl, proposal);
                proposalsGroup.appendChild(cardEl);
            }
            section.appendChild(proposalsGroup);
        }

        this.containerEl.appendChild(section);
    }

    private renderProposalActions(cardEl: HTMLElement, proposal: MaintenanceProposal): void {
        if (!this.callbacks.onApply) return;

        const actionRow = el("div", "pa-pagelet-tab-maintenance-actions");
        const state = this.actionState.get(proposal.id);
        const hasUndoTarget = Boolean(this.callbacks.onUndo
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
                void this.applyProposal(proposal);
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
                    void this.undoAction(proposal.id, state.actionId);
                }
            });
            actionRow.appendChild(button);
        }

        if (state) {
            const status = el("span", "pa-pagelet-tab-maintenance-status", this.statusText(state));
            status.setAttribute("data-status", state.status);
            actionRow.appendChild(status);
        }

        cardEl.appendChild(actionRow);
    }

    private statusText(state: MaintenanceActionUiState): string {
        if (state.status === "applying") return pageletT("pagelet.tab.maintenance.applying", this.locale);
        if (state.status === "applied") return pageletT("pagelet.tab.maintenance.moved", this.locale);
        if (state.status === "undoing") return pageletT("pagelet.tab.maintenance.undoing", this.locale);
        if (state.status === "undone") return pageletT("pagelet.tab.maintenance.undone", this.locale);
        return state.message || pageletT("pagelet.tab.maintenance.actionFailed", this.locale);
    }

    private async applyProposal(proposal: MaintenanceProposal): Promise<void> {
        if (!this.callbacks.onApply) return;
        this.actionState.set(proposal.id, {
            status: "applying",
            message: pageletT("pagelet.tab.maintenance.applying", this.locale),
        });
        this.section.requestRerender();
        try {
            const result = await this.callbacks.onApply(proposal);
            if (!this.canCommitActionState()) return;
            if (result.ok) {
                this.actionState.set(proposal.id, {
                    status: "applied",
                    message: result.message,
                    actionId: result.action.id,
                });
            } else {
                this.actionState.set(proposal.id, {
                    status: "failed",
                    message: result.message || pageletT("pagelet.tab.maintenance.actionFailed", this.locale),
                });
            }
        } catch (error) {
            if (!this.canCommitActionState()) return;
            this.actionState.set(proposal.id, {
                status: "failed",
                message: error instanceof Error
                    ? error.message
                    : pageletT("pagelet.tab.maintenance.actionFailed", this.locale),
            });
        }
        this.section.requestRerender();
    }

    private async undoAction(proposalId: string, actionId: string): Promise<void> {
        if (!this.callbacks.onUndo) return;
        this.actionState.set(proposalId, {
            status: "undoing",
            message: pageletT("pagelet.tab.maintenance.undoing", this.locale),
            actionId,
        });
        this.section.requestRerender();
        try {
            const result = await this.callbacks.onUndo(actionId);
            if (!this.canCommitActionState()) return;
            if (result.ok) {
                this.actionState.set(proposalId, {
                    status: "undone",
                    message: result.message,
                    actionId: result.action.id,
                });
            } else {
                this.actionState.set(proposalId, {
                    status: "failed",
                    message: result.message || pageletT("pagelet.tab.maintenance.actionFailed", this.locale),
                    actionId,
                });
            }
        } catch (error) {
            if (!this.canCommitActionState()) return;
            this.actionState.set(proposalId, {
                status: "failed",
                message: error instanceof Error
                    ? error.message
                    : pageletT("pagelet.tab.maintenance.actionFailed", this.locale),
                actionId,
            });
        }
        this.section.requestRerender();
    }
}

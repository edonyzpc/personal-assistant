/* Copyright 2023 edonyzpc */

import {
    canAutoConfirmMemoryCandidate,
    memoryCandidateFromQueueItem,
    type ConfirmedMemoryRecord,
    type ReviewQueueItem,
} from "../../../pa";
import type {
    PanelMemoryGovernanceRecord,
    PanelMemoryGovernanceState,
    PanelMemoryRecentChange,
    PanelMemoryUseStatus,
} from "../../panel/types";
import type { PageletLocale } from "../../../locales/pagelet";
import { pageletT } from "../../../locales/pagelet";
import { clearChildren, el, renderEmptyCard } from "../../dom-utils";
import type {
    MemoryCandidateActionResult,
    MemoryCandidateActionState,
    MemoryRecordActionResult,
    MemoryRecordActionState,
    TabSectionCallbacks,
    TabSectionRenderer,
} from "./types";
import { getMemoryTrustLevel } from "../../../pa/memory-trust-level";

export interface MemoryGovernanceCallbacks {
    onConfirm?: (item: ReviewQueueItem) => Promise<MemoryCandidateActionResult>;
    onDismiss?: (item: ReviewQueueItem) => Promise<MemoryCandidateActionResult>;
    onCorrect?: (record: ConfirmedMemoryRecord, summary: string) => Promise<MemoryRecordActionResult>;
    onPauseUse?: (record: ConfirmedMemoryRecord) => Promise<MemoryRecordActionResult>;
    onResumeUse?: (record: ConfirmedMemoryRecord) => Promise<MemoryRecordActionResult>;
    onForget?: (record: ConfirmedMemoryRecord) => Promise<MemoryRecordActionResult>;
    onUndoRecentChange?: (change: PanelMemoryRecentChange) => Promise<MemoryRecordActionResult>;
    onOpenSource?: (path: string) => void;
    onOpenMemorySettings?: (targetId?: string) => void;
    isDigestDeferred?: () => boolean;
    onDeferDigest?: () => void;
}

export class MemoryGovernanceSection implements TabSectionRenderer {
    private readonly actionState: Map<string, MemoryCandidateActionState>;
    private readonly ownsActionState: boolean;
    private readonly recordActionState = new Map<string, MemoryRecordActionState>();
    private readonly editingRecordIds = new Set<string>();
    private readonly correctedSummaries = new Map<string, string>();
    private readonly useStatusOverrides = new Map<string, PanelMemoryUseStatus>();
    private containerEl: HTMLElement | null = null;
    private pendingFocusKeys: string[] = [];
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
        if (this.data.contextual === true) return this.data.records.length > 0;
        return (this.data.candidates?.length ?? 0) > 0
            || this.data.records.length > 0
            || (this.data.routedItems?.length ?? 0) > 0
            || this.data.recentChanges !== undefined;
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
        if (this.ownsActionState) this.actionState.clear();
        this.recordActionState.clear();
        this.editingRecordIds.clear();
        this.correctedSummaries.clear();
        this.useStatusOverrides.clear();
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
            "[data-pa-memory-focus-key]",
        ));
        const target = focusKeys
            .map((focusKey) => keyedElements.find((element) => (
                element.getAttribute("data-pa-memory-focus-key") === focusKey
            )))
            .find((element) => element !== undefined
                && (element.tagName !== "BUTTON" || !(element as HTMLButtonElement).disabled));
        target?.focus({ preventScroll: true });
    }

    private recordFocusKey(recordId: string, target: string): string {
        return `record:${recordId}:${target}`;
    }

    private recentFocusKey(changeId: string, target: string): string {
        return `recent:${changeId}:${target}`;
    }

    private candidateFocusKey(itemId: string, target: string): string {
        return `candidate:${itemId}:${target}`;
    }

    private setFocusKey(element: HTMLElement, focusKey: string): void {
        element.setAttribute("data-pa-memory-focus-key", focusKey);
    }

    private canCommitActionState(): boolean {
        return !this.destroyed
            && (this.ownsActionState || this.section.canCommitActionState?.() !== false);
    }

    private renderInto(): void {
        if (!this.containerEl) return;
        const candidates = this.data.candidates ?? [];
        const { records } = this.data;
        const contextual = this.data.contextual === true;
        const usesLegacyTrust = this.data.governanceMode === undefined
            || this.data.governanceMode === "legacy_threshold";
        const trustLevel = usesLegacyTrust
            ? getMemoryTrustLevel(this.data.confirmedMemoryCount ?? 0)
            : 0;
        const showDurableGovernance = this.data.governanceMode !== "unavailable"
            && (this.data.governanceMode !== "effect_based" || this.data.contextual === true);
        const showRecentChanges = showDurableGovernance && !contextual;

        const section = el("div", "pa-pagelet-tab-section pa-pagelet-tab-memory-governance");
        const sectionHeader = el("div", "pa-pagelet-tab-memory-section-header");
        sectionHeader.appendChild(el("h2", undefined, pageletT(
            contextual ? "pagelet.tab.memory.contextualTitle" : "pagelet.tab.memory.title",
            this.locale,
        )));
        if (this.callbacks.onOpenMemorySettings && !contextual) {
            const settingsButton = el(
                "button",
                "pa-pagelet-tab-memory-settings",
                pageletT("pagelet.tab.memory.openSettings", this.locale),
            );
            settingsButton.setAttribute("type", "button");
            settingsButton.addEventListener("click", (event) => {
                event.preventDefault();
                this.callbacks.onOpenMemorySettings?.();
            });
            sectionHeader.appendChild(settingsButton);
        }
        section.appendChild(sectionHeader);
        section.appendChild(el("p", "pa-pagelet-tab-review-queue-summary",
            pageletT(
                contextual ? "pagelet.tab.memory.contextualSummary" : "pagelet.tab.memory.summary",
                this.locale,
            )));

        if (!contextual) {
            const pendingCandidates = candidates.filter((item) => item.type === "memory_candidate");
            const autoAcceptedCandidates = pendingCandidates.filter((item) => this.isAutoAcceptedCandidate(item, trustLevel));

            // Level 1 batch digest card: show when trust level = 1 and 3+ pending candidates
            if (usesLegacyTrust && trustLevel === 1
                && pendingCandidates.length >= 3 && this.callbacks.isDigestDeferred?.() !== true) {
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
                laterBtn.addEventListener("click", () => {
                    this.callbacks.onDeferDigest?.();
                    this.section.requestRerender();
                });
                digestActions.appendChild(laterBtn);

                digestCard.appendChild(digestActions);
                section.appendChild(digestCard);
            }

            if (candidates.length > 0) {
                const candidateGroup = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-memory-candidates");
                const headerRow = el("div", "pa-pagelet-tab-memory-candidates-header");
                headerRow.appendChild(el("h3", undefined, pageletT("pagelet.tab.memory.candidatesTitle", this.locale)));
                // Level 2 hides batch confirm; candidates that still need action keep per-item controls.
                if (usesLegacyTrust && trustLevel < 2 && pendingCandidates.length > 1 && this.callbacks.onConfirm) {
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
                    usesLegacyTrust && trustLevel === 2 && autoAcceptedCandidates.length > 0
                        ? pageletT("pagelet.tab.memory.level2Summary", this.locale, { count: autoAcceptedCandidates.length })
                        : pageletT("pagelet.tab.memory.candidatesSummary", this.locale, { count: candidates.length })));
                for (const item of candidates) {
                    candidateGroup.appendChild(this.renderCandidateItem(item, trustLevel));
                }
                section.appendChild(candidateGroup);
            } else {
                section.appendChild(renderEmptyCard(
                    "pa-pagelet-tab-memory-candidates-empty", "pagelet.tab.memory.noCandidates", undefined, this.locale));
            }
        }

        if (showDurableGovernance && records.length > 0) {
            const recordsGroup = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-memory-records");
            recordsGroup.appendChild(el("h3", undefined, pageletT("pagelet.tab.memory.recordsTitle", this.locale)));
            for (const record of records) {
                recordsGroup.appendChild(this.renderMemoryRecord(record));
            }
            section.appendChild(recordsGroup);
        }

        if (showRecentChanges && this.data.recentChanges !== undefined) {
            section.appendChild(this.renderRecentChanges(this.data.recentChanges));
        }

        const routedItems = this.data.routedItems ?? [];
        if (!contextual && routedItems.length > 0) {
            const suggestionsGroup = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-memory-suggestions");
            suggestionsGroup.appendChild(el("h3", undefined, pageletT("pagelet.tab.memory.suggestionsTitle", this.locale)));
            for (const item of routedItems) {
                suggestionsGroup.appendChild(this.renderRoutedItem(item));
            }
            section.appendChild(suggestionsGroup);
        }

        this.containerEl.appendChild(section);
    }

    private renderMemoryRecord(record: PanelMemoryGovernanceRecord): HTMLElement {
        const state = this.recordActionState.get(record.id);
        const isForgotten = record.lifecycle === "forgotten_tombstone"
            || (state?.action === "forget" && state.status === "succeeded");
        const cardEl = el(
            "article",
            isForgotten
                ? "pa-pagelet-tab-insight-card pa-pagelet-tab-memory-card pa-pagelet-tab-memory-card--tombstone"
                : "pa-pagelet-tab-insight-card pa-pagelet-tab-memory-card",
        );
        cardEl.tabIndex = -1;
        this.setFocusKey(cardEl, this.recordFocusKey(record.id, "card"));
        if (isForgotten) {
            cardEl.appendChild(el(
                "h4",
                "pa-pagelet-tab-memory-summary",
                pageletT("pagelet.tab.memory.forgottenMarker", this.locale),
            ));
            this.appendMemoryMetaRow(
                cardEl,
                "pagelet.tab.memory.statusLabel",
                pageletT("pagelet.tab.memory.status.forgotten", this.locale),
            );
            this.appendMemoryMetaRow(
                cardEl,
                "pagelet.tab.memory.timeLabel",
                formatMemoryTime(record.forgottenAt ?? record.updatedAt, this.locale),
            );
            const settingsButton = this.createMemorySettingsButton(record.id, "record");
            if (settingsButton) {
                const actions = el("div", "pa-pagelet-tab-memory-actions");
                actions.appendChild(settingsButton);
                cardEl.appendChild(actions);
            }
            return cardEl;
        }

        const summary = this.correctedSummaries.get(record.id) ?? record.summary;
        cardEl.appendChild(el("h4", "pa-pagelet-tab-memory-summary", summary));
        const sourcePath = record.sourceRefs[0]?.path;
        if (sourcePath) this.appendSourceMetaRow(cardEl, sourcePath);
        this.appendMemoryMetaRow(
            cardEl,
            "pagelet.tab.memory.scopeLabel",
            record.scope.label ?? record.scope.paths?.[0] ?? pageletT("pagelet.tab.memory.scope.currentVault", this.locale),
        );
        const effect = record.effect ?? "stored_not_in_use";
        this.appendMemoryMetaRow(
            cardEl,
            "pagelet.tab.memory.effectLabel",
            pageletT(`pagelet.tab.memory.effect.${effect}`, this.locale),
        );
        const useStatus = this.getRecordUseStatus(record);
        this.appendMemoryMetaRow(
            cardEl,
            "pagelet.tab.memory.statusLabel",
            useStatus
                ? pageletT(`pagelet.tab.memory.status.${useStatus}`, this.locale)
                : pageletT(`pagelet.tab.memory.lifecycle.${record.lifecycle}`, this.locale),
        );
        this.appendMemoryMetaRow(
            cardEl,
            "pagelet.tab.memory.timeLabel",
            formatMemoryTime(record.updatedAt, this.locale),
        );

        if (this.editingRecordIds.has(record.id)
            && this.callbacks.onCorrect
            && this.recordActionAllowed(record, "correct")) {
            cardEl.appendChild(this.renderCorrectionEditor(record, summary, state));
        }
        const actions = this.renderRecordActions(record, state);
        if (actions) cardEl.appendChild(actions);
        if (state?.message) {
            const feedback = el("p", "pa-pagelet-tab-memory-action-feedback", state.message);
            feedback.setAttribute("data-status", state.status);
            feedback.setAttribute("role", "status");
            feedback.setAttribute("aria-live", "polite");
            cardEl.appendChild(feedback);
        }
        return cardEl;
    }

    private appendSourceMetaRow(container: HTMLElement, sourcePath: string): void {
        const row = this.createMemoryMetaRow("pagelet.tab.memory.sourceLabel");
        if (this.callbacks.onOpenSource) {
            const button = el("button", "pa-pagelet-tab-source-link", sourcePath);
            button.setAttribute("type", "button");
            button.addEventListener("click", (event) => {
                event.preventDefault();
                this.callbacks.onOpenSource?.(sourcePath);
            });
            row.appendChild(button);
        } else {
            row.appendChild(el("span", "pa-pagelet-tab-memory-meta-value", sourcePath));
        }
        container.appendChild(row);
    }

    private appendMemoryMetaRow(
        container: HTMLElement,
        labelKey: string,
        value: string,
    ): void {
        if (!value) return;
        const row = this.createMemoryMetaRow(labelKey);
        row.appendChild(el("span", "pa-pagelet-tab-memory-meta-value", value));
        container.appendChild(row);
    }

    private createMemoryMetaRow(labelKey: string): HTMLElement {
        const row = el("div", "pa-pagelet-tab-memory-meta-row");
        row.appendChild(el(
            "span",
            "pa-pagelet-tab-memory-meta-label",
            pageletT(labelKey, this.locale),
        ));
        return row;
    }

    private getRecordUseStatus(record: PanelMemoryGovernanceRecord): PanelMemoryUseStatus | null {
        const override = this.useStatusOverrides.get(record.id);
        if (override) return override;
        if (record.useStatus) return record.useStatus;
        return record.lifecycle === "active" ? "active" : null;
    }

    private getRecordDurableUseStatus(
        record: PanelMemoryGovernanceRecord,
    ): PanelMemoryUseStatus | null {
        const override = this.useStatusOverrides.get(record.id);
        if (override) return override;
        if (record.durableUseStatus) return record.durableUseStatus;
        if (record.useStatus) return record.useStatus;
        return record.lifecycle === "active" ? "active" : null;
    }

    private recordActionAllowed(
        record: PanelMemoryGovernanceRecord,
        action: "correct" | "pause" | "resume" | "forget",
    ): boolean {
        if (this.data.governanceMode === "legacy_threshold" && action !== "forget") {
            return false;
        }
        const usesGateAwarePolicy = this.data.governanceMode === "effect_based"
            || record.actionPolicy !== undefined
            || record.effect !== undefined
            || record.useStatus !== undefined
            || record.durableUseStatus !== undefined;
        if (usesGateAwarePolicy) {
            return record.actionPolicy?.[action] === true;
        }
        return true;
    }

    private renderRecordActions(
        record: PanelMemoryGovernanceRecord,
        state: MemoryRecordActionState | undefined,
    ): HTMLElement | null {
        const pending = state?.status === "correcting"
            || state?.status === "pausing"
            || state?.status === "resuming"
            || state?.status === "forgetting";
        const durableUseStatus = this.getRecordDurableUseStatus(record);
        const row = el("div", "pa-pagelet-tab-memory-actions");
        let actionCount = 0;
        const appendAction = (
            actionKey: string,
            className: string,
            label: string,
            onClick: () => void,
            destructive = false,
        ): void => {
            const button = el(
                "button",
                `pa-pagelet-tab-memory-action ${className}${destructive ? " pa-pagelet-tab-memory-action--danger" : ""}`,
                label,
            );
            button.setAttribute("type", "button");
            this.setFocusKey(button, this.recordFocusKey(record.id, actionKey));
            if (pending) {
                button.disabled = true;
                button.setAttribute("aria-disabled", "true");
            }
            button.addEventListener("click", (event) => {
                event.preventDefault();
                if (!button.disabled) onClick();
            });
            row.appendChild(button);
            actionCount += 1;
        };

        if (this.callbacks.onCorrect
            && this.recordActionAllowed(record, "correct")
            && !this.editingRecordIds.has(record.id)) {
            appendAction(
                "correct",
                "pa-pagelet-tab-memory-correct",
                pageletT("pagelet.tab.memory.correct", this.locale),
                () => {
                    this.recordActionState.delete(record.id);
                    this.editingRecordIds.add(record.id);
                    this.requestRerenderWithFocus(
                        this.recordFocusKey(record.id, "correction-input"),
                        this.recordFocusKey(record.id, "card"),
                    );
                },
            );
        }
        if (durableUseStatus === "active"
            && this.callbacks.onPauseUse
            && this.recordActionAllowed(record, "pause")) {
            appendAction(
                "pause",
                "pa-pagelet-tab-memory-pause",
                state?.status === "pausing"
                    ? pageletT("pagelet.tab.memory.pausing", this.locale)
                    : pageletT("pagelet.tab.memory.pauseUse", this.locale),
                () => { void this.runRecordAction(record, "pause"); },
            );
        }
        if (durableUseStatus === "paused"
            && this.callbacks.onResumeUse
            && this.recordActionAllowed(record, "resume")) {
            appendAction(
                "resume",
                "pa-pagelet-tab-memory-resume",
                state?.status === "resuming"
                    ? pageletT("pagelet.tab.memory.resuming", this.locale)
                    : pageletT("pagelet.tab.memory.resumeUse", this.locale),
                () => { void this.runRecordAction(record, "resume"); },
            );
        }
        if (this.callbacks.onForget && this.recordActionAllowed(record, "forget")) {
            appendAction(
                "forget",
                "pa-pagelet-tab-memory-forget",
                state?.status === "forgetting"
                    ? pageletT("pagelet.tab.memory.forgetting", this.locale)
                    : pageletT("pagelet.tab.memory.forgetPermanently", this.locale),
                () => { void this.runRecordAction(record, "forget"); },
                true,
            );
        }
        const settingsButton = this.createMemorySettingsButton(record.id, "record");
        if (settingsButton) {
            row.appendChild(settingsButton);
            actionCount += 1;
        }
        return actionCount > 0 ? row : null;
    }

    private createMemorySettingsButton(
        targetId: string,
        context: "record" | "change",
    ): HTMLElement | null {
        if (!this.callbacks.onOpenMemorySettings
            || targetId.length === 0
            || targetId !== targetId.trim()) return null;
        const button = el(
            "button",
            `pa-pagelet-tab-memory-action pa-pagelet-tab-memory-settings pa-pagelet-tab-memory-settings--${context}`,
            pageletT("pagelet.tab.memory.openSettings", this.locale),
        );
        button.setAttribute("type", "button");
        button.addEventListener("click", (event) => {
            event.preventDefault();
            this.callbacks.onOpenMemorySettings?.(targetId);
        });
        return button;
    }

    private renderCorrectionEditor(
        record: PanelMemoryGovernanceRecord,
        currentSummary: string,
        state: MemoryRecordActionState | undefined,
    ): HTMLElement {
        const pending = state?.status === "correcting";
        const editor = el("div", "pa-pagelet-tab-memory-correction-editor");
        const textarea = el("textarea", "pa-pagelet-tab-memory-correction-input") as HTMLTextAreaElement;
        textarea.value = currentSummary;
        textarea.setAttribute("aria-label", pageletT("pagelet.tab.memory.correctLabel", this.locale));
        this.setFocusKey(textarea, this.recordFocusKey(record.id, "correction-input"));
        if (pending) textarea.disabled = true;
        editor.appendChild(textarea);
        const actions = el("div", "pa-pagelet-tab-memory-editor-actions");
        const save = el(
            "button",
            "pa-pagelet-tab-memory-action pa-pagelet-tab-memory-correction-save",
            pending
                ? pageletT("pagelet.tab.memory.correcting", this.locale)
                : pageletT("pagelet.tab.memory.saveCorrection", this.locale),
        );
        save.setAttribute("type", "button");
        this.setFocusKey(save, this.recordFocusKey(record.id, "correction-save"));
        if (pending) {
            save.disabled = true;
            save.setAttribute("aria-disabled", "true");
        }
        save.addEventListener("click", (event) => {
            event.preventDefault();
            void this.correctRecord(record, textarea.value);
        });
        actions.appendChild(save);
        const cancel = el(
            "button",
            "pa-pagelet-tab-memory-action pa-pagelet-tab-memory-correction-cancel",
            pageletT("pagelet.tab.memory.cancel", this.locale),
        );
        cancel.setAttribute("type", "button");
        this.setFocusKey(cancel, this.recordFocusKey(record.id, "correction-cancel"));
        if (pending) {
            cancel.disabled = true;
            cancel.setAttribute("aria-disabled", "true");
        }
        cancel.addEventListener("click", (event) => {
            event.preventDefault();
            this.editingRecordIds.delete(record.id);
            this.recordActionState.delete(record.id);
            this.requestRerenderWithFocus(
                this.recordFocusKey(record.id, "correct"),
                this.recordFocusKey(record.id, "card"),
            );
        });
        actions.appendChild(cancel);
        editor.appendChild(actions);
        return editor;
    }

    private renderRecentChanges(changes: readonly PanelMemoryRecentChange[]): HTMLElement {
        const group = el("div", "pa-pagelet-tab-review-queue-group pa-pagelet-tab-memory-recent-changes");
        group.appendChild(el("h3", undefined, pageletT("pagelet.tab.memory.recentChangesTitle", this.locale)));
        if (changes.length === 0) {
            group.appendChild(el(
                "p",
                "pa-pagelet-tab-muted pa-pagelet-tab-memory-recent-empty",
                pageletT("pagelet.tab.memory.recentChangesEmpty", this.locale),
            ));
            return group;
        }
        for (const change of changes) group.appendChild(this.renderRecentChange(change));
        return group;
    }

    private renderRecentChange(change: PanelMemoryRecentChange): HTMLElement {
        const isForget = change.kind === "forget";
        const card = el(
            "article",
            isForget
                ? "pa-pagelet-tab-memory-change pa-pagelet-tab-memory-change--redacted"
                : "pa-pagelet-tab-memory-change",
        );
        card.tabIndex = -1;
        this.setFocusKey(card, this.recentFocusKey(change.id, "card"));
        card.appendChild(el(
            "h4",
            undefined,
            isForget
                ? pageletT("pagelet.tab.memory.recentChange.forget", this.locale)
                : change.summary ?? pageletT(`pagelet.tab.memory.recentChange.${change.kind}`, this.locale),
        ));
        if (isForget) {
            card.appendChild(el(
                "p",
                "pa-pagelet-tab-muted",
                pageletT("pagelet.tab.memory.recentChangeForgotten", this.locale),
            ));
            this.appendMemoryMetaRow(
                card,
                "pagelet.tab.memory.statusLabel",
                pageletT("pagelet.tab.memory.status.forgotten", this.locale),
            );
        } else {
            if (change.sourcePath) this.appendSourceMetaRow(card, change.sourcePath);
            if (change.scopeLabel) {
                this.appendMemoryMetaRow(card, "pagelet.tab.memory.scopeLabel", change.scopeLabel);
            }
            if (change.effect) {
                this.appendMemoryMetaRow(
                    card,
                    "pagelet.tab.memory.effectLabel",
                    pageletT(`pagelet.tab.memory.effect.${change.effect}`, this.locale),
                );
            }
            if (change.status) {
                this.appendMemoryMetaRow(
                    card,
                    "pagelet.tab.memory.statusLabel",
                    pageletT(`pagelet.tab.memory.status.${change.status}`, this.locale),
                );
            }
        }
        this.appendMemoryMetaRow(
            card,
            "pagelet.tab.memory.timeLabel",
            formatMemoryTime(change.occurredAt, this.locale),
        );
        const stateKey = `recent:${change.id}`;
        const state = this.recordActionState.get(stateKey);
        const actions = el("div", "pa-pagelet-tab-memory-actions");
        let actionCount = 0;
        if (!isForget && change.undoAvailable && this.callbacks.onUndoRecentChange) {
            const undo = el(
                "button",
                "pa-pagelet-tab-memory-action pa-pagelet-tab-memory-undo",
                state?.status === "undoing"
                    ? pageletT("pagelet.tab.memory.undoing", this.locale)
                    : pageletT("pagelet.tab.memory.undo", this.locale),
            );
            undo.setAttribute("type", "button");
            this.setFocusKey(undo, this.recentFocusKey(change.id, "undo"));
            if (state?.status === "undoing" || state?.status === "succeeded") {
                undo.disabled = true;
                undo.setAttribute("aria-disabled", "true");
            }
            undo.addEventListener("click", (event) => {
                event.preventDefault();
                if (!undo.disabled) void this.undoRecentChange(change);
            });
            actions.appendChild(undo);
            actionCount += 1;
        }
        const settingsButton = this.createMemorySettingsButton(change.claimId, "change");
        if (settingsButton) {
            actions.appendChild(settingsButton);
            actionCount += 1;
        }
        if (actionCount > 0) card.appendChild(actions);
        if (state?.message) {
            const feedback = el("p", "pa-pagelet-tab-memory-action-feedback", state.message);
            feedback.setAttribute("data-status", state.status);
            feedback.setAttribute("role", "status");
            feedback.setAttribute("aria-live", "polite");
            card.appendChild(feedback);
        }
        return card;
    }

    private renderCandidateItem(item: ReviewQueueItem, trustLevel: 0 | 1 | 2 = 0): HTMLElement {
        const state = this.actionState.get(item.id);
        const isMemoryCandidate = item.type === "memory_candidate";
        // Level 2 auto-accept applies only to eligible memory_candidate; memory_conflict and task constraints stay manual
        const isAutoAccepted = this.isAutoAcceptedCandidate(item, trustLevel);
        const cardEl = el("div", "pa-pagelet-tab-insight-card pa-pagelet-tab-memory-candidate-card");
        cardEl.tabIndex = -1;
        this.setFocusKey(cardEl, this.candidateFocusKey(item.id, "card"));
        cardEl.appendChild(el("h4", undefined, item.title));
        cardEl.appendChild(el("p", undefined, item.claim));

        const tagRow = el("div", "pa-pagelet-tab-tag-row");
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.memory.candidateType.${item.type}`, this.locale)));
        tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
            pageletT(`pagelet.tab.reviewQueue.status.${item.status}`, this.locale)));
        // Level 2: show "Auto-accepted" only after the candidate was actually applied.
        if (isAutoAccepted) {
            const badge = el("span", "pa-pagelet-tab-tag-chip",
                pageletT("pagelet.tab.memory.autoAccepted", this.locale));
            badge.setAttribute("role", "status");
            tagRow.appendChild(badge);
        }
        const memoryType = item.metadata?.memoryType;
        if (this.data.governanceMode !== "effect_based" && typeof memoryType === "string") {
            tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
                pageletT(`pagelet.tab.memory.type.${memoryType}`, this.locale)));
        }
        const source = item.sourceRefs[0]?.path;
        if (source) tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", source));
        cardEl.appendChild(tagRow);
        if (this.data.governanceMode === "effect_based") {
            this.appendEffectBasedCandidateMetadata(cardEl, item);
        }

        const actionRow = el("div", "pa-pagelet-tab-memory-candidate-actions");
        if (isAutoAccepted) {
            // Already-applied candidate rows can be dismissed from this suggestion surface.
            if (this.callbacks.onDismiss) {
                const removeButton = el("button", "pa-pagelet-tab-memory-dismiss",
                    state?.status === "dismissing"
                        ? pageletT("pagelet.tab.memory.dismissing", this.locale)
                        : state?.status === "dismissed"
                            ? pageletT("pagelet.tab.memory.dismissed", this.locale)
                            : pageletT("pagelet.tab.memory.dismiss", this.locale));
                removeButton.setAttribute("type", "button");
                this.setFocusKey(removeButton, this.candidateFocusKey(item.id, "dismiss"));
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
            // Manual candidates render Confirm + Dismiss.
            if (this.callbacks.onConfirm && isMemoryCandidate) {
                const confirmButton = el("button", "pa-pagelet-tab-memory-confirm",
                    state?.status === "confirming"
                        ? pageletT("pagelet.tab.memory.confirming", this.locale)
                        : state?.status === "confirmed"
                            ? pageletT("pagelet.tab.memory.confirmed", this.locale)
                            : pageletT("pagelet.tab.memory.confirm", this.locale));
                confirmButton.setAttribute("type", "button");
                this.setFocusKey(confirmButton, this.candidateFocusKey(item.id, "confirm"));
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
                this.setFocusKey(dismissButton, this.candidateFocusKey(item.id, "dismiss"));
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
            const feedback = el(
                "span",
                "pa-pagelet-tab-maintenance-status pa-pagelet-tab-memory-action-feedback",
                state.message,
            );
            feedback.setAttribute("data-status", state.status);
            feedback.setAttribute("role", "status");
            feedback.setAttribute("aria-live", "polite");
            actionRow.appendChild(feedback);
        }
        cardEl.appendChild(actionRow);
        return cardEl;
    }

    private appendEffectBasedCandidateMetadata(
        container: HTMLElement,
        item: ReviewQueueItem,
    ): void {
        const sourceKey = candidateSourceMessageKey(item.metadata?.memorySource);
        if (sourceKey) {
            this.appendMemoryMetaRow(
                container,
                "pagelet.tab.memory.sourceLabel",
                pageletT(sourceKey, this.locale),
            );
        }
        const scopeKey = candidateScopeMessageKey(item.metadata?.memoryScope);
        if (scopeKey) {
            this.appendMemoryMetaRow(
                container,
                "pagelet.tab.memory.scopeLabel",
                pageletT(scopeKey, this.locale),
            );
        }
        const effect = item.metadata?.memoryEffect;
        if (isCandidateEffect(effect)) {
            this.appendMemoryMetaRow(
                container,
                "pagelet.tab.memory.effectLabel",
                pageletT(`pagelet.tab.memory.effect.${effect}`, this.locale),
            );
        }
    }

    private isAutoAcceptedCandidate(item: ReviewQueueItem, trustLevel: 0 | 1 | 2): boolean {
        if (trustLevel !== 2 || item.type !== "memory_candidate" || item.status !== "applied") return false;
        const memoryCandidate = memoryCandidateFromQueueItem(item);
        return memoryCandidate.ok && canAutoConfirmMemoryCandidate(memoryCandidate.value);
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
            ? await this.section.confirmAction({
                title: pageletT("pagelet.tab.memory.confirmAllTitle", this.locale),
                message,
            })
            : confirm(message);
        if (!confirmed) return;
        for (const item of pending) {
            await this.confirmCandidate(item, false);
            if (!this.canCommitActionState()) return;
        }
    }

    private async confirmCandidate(item: ReviewQueueItem, restoreFocus = true): Promise<void> {
        if (!this.callbacks.onConfirm) return;
        const rerender = (...focusKeys: string[]): void => {
            if (restoreFocus) this.requestRerenderWithFocus(...focusKeys);
            else this.section.requestRerender();
        };
        this.actionState.set(item.id, {
            status: "confirming",
            message: pageletT("pagelet.tab.memory.confirming", this.locale),
        });
        rerender(this.candidateFocusKey(item.id, "card"));
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
        const focusTarget = this.actionState.get(item.id)?.status === "failed" ? "confirm" : "card";
        rerender(
            this.candidateFocusKey(item.id, focusTarget),
            this.candidateFocusKey(item.id, "card"),
        );
    }

    private async dismissCandidate(item: ReviewQueueItem): Promise<void> {
        if (!this.callbacks.onDismiss) return;
        this.actionState.set(item.id, {
            status: "dismissing",
            message: pageletT("pagelet.tab.memory.dismissing", this.locale),
        });
        this.requestRerenderWithFocus(this.candidateFocusKey(item.id, "card"));
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
        const focusTarget = this.actionState.get(item.id)?.status === "failed" ? "dismiss" : "card";
        this.requestRerenderWithFocus(
            this.candidateFocusKey(item.id, focusTarget),
            this.candidateFocusKey(item.id, "card"),
        );
    }

    private async correctRecord(record: ConfirmedMemoryRecord, proposedSummary: string): Promise<void> {
        if (!this.callbacks.onCorrect) return;
        const summary = proposedSummary.trim();
        const currentSummary = this.correctedSummaries.get(record.id) ?? record.summary;
        if (!summary || summary === currentSummary.trim()) {
            this.recordActionState.set(record.id, {
                action: "correct",
                status: "failed",
                message: pageletT("pagelet.tab.memory.correctionRequired", this.locale),
            });
            this.requestRerenderWithFocus(
                this.recordFocusKey(record.id, "correction-input"),
                this.recordFocusKey(record.id, "card"),
            );
            return;
        }
        this.recordActionState.set(record.id, {
            action: "correct",
            status: "correcting",
            message: pageletT("pagelet.tab.memory.correcting", this.locale),
        });
        this.requestRerenderWithFocus(this.recordFocusKey(record.id, "card"));
        try {
            const result = await this.callbacks.onCorrect(record, summary);
            if (!this.canCommitActionState()) return;
            if (result.ok) {
                this.correctedSummaries.set(record.id, result.record?.summary ?? summary);
                this.editingRecordIds.delete(record.id);
            }
            this.recordActionState.set(record.id, {
                action: "correct",
                status: result.ok ? "succeeded" : "failed",
                message: result.message,
            });
        } catch (error) {
            if (!this.canCommitActionState()) return;
            this.recordActionState.set(record.id, {
                action: "correct",
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        const focusTarget = this.recordActionState.get(record.id)?.status === "succeeded"
            ? "correct"
            : "correction-input";
        this.requestRerenderWithFocus(
            this.recordFocusKey(record.id, focusTarget),
            this.recordFocusKey(record.id, "card"),
        );
    }

    private async runRecordAction(
        record: ConfirmedMemoryRecord,
        action: "pause" | "resume" | "forget",
    ): Promise<void> {
        const callback = action === "pause"
            ? this.callbacks.onPauseUse
            : action === "resume"
                ? this.callbacks.onResumeUse
                : this.callbacks.onForget;
        if (!callback) return;
        const pendingStatus = action === "pause"
            ? "pausing"
            : action === "resume"
                ? "resuming"
                : "forgetting";
        this.recordActionState.set(record.id, {
            action,
            status: pendingStatus,
            message: pageletT(`pagelet.tab.memory.${pendingStatus}`, this.locale),
        });
        this.requestRerenderWithFocus(this.recordFocusKey(record.id, "card"));
        try {
            // Forget confirmation is intentionally owned by the host callback,
            // which has the durable-operation context required for two-step consent.
            const result = await callback(record);
            if (!this.canCommitActionState()) return;
            if (result.ok && action === "pause") this.useStatusOverrides.set(record.id, "paused");
            if (result.ok && action === "resume") this.useStatusOverrides.set(record.id, "active");
            this.recordActionState.set(record.id, {
                action,
                status: result.ok ? "succeeded" : "failed",
                message: result.message,
            });
        } catch (error) {
            if (!this.canCommitActionState()) return;
            this.recordActionState.set(record.id, {
                action,
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        const finalState = this.recordActionState.get(record.id);
        const focusTarget = finalState?.status === "succeeded"
            ? action === "pause"
                ? "resume"
                : action === "resume"
                    ? "pause"
                    : "card"
            : action;
        this.requestRerenderWithFocus(
            this.recordFocusKey(record.id, focusTarget),
            this.recordFocusKey(record.id, "card"),
        );
    }

    private async undoRecentChange(change: PanelMemoryRecentChange): Promise<void> {
        if (!this.callbacks.onUndoRecentChange) return;
        const stateKey = `recent:${change.id}`;
        this.recordActionState.set(stateKey, {
            action: "undo",
            status: "undoing",
            message: pageletT("pagelet.tab.memory.undoing", this.locale),
        });
        this.requestRerenderWithFocus(this.recentFocusKey(change.id, "card"));
        try {
            const result = await this.callbacks.onUndoRecentChange(change);
            if (!this.canCommitActionState()) return;
            this.recordActionState.set(stateKey, {
                action: "undo",
                status: result.ok ? "succeeded" : "failed",
                message: result.message,
            });
        } catch (error) {
            if (!this.canCommitActionState()) return;
            this.recordActionState.set(stateKey, {
                action: "undo",
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        const focusTarget = this.recordActionState.get(stateKey)?.status === "failed" ? "undo" : "card";
        this.requestRerenderWithFocus(
            this.recentFocusKey(change.id, focusTarget),
            this.recentFocusKey(change.id, "card"),
        );
    }
}

function formatMemoryTime(value: string | undefined, locale: PageletLocale): string {
    if (!value) return "";
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return value;
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(timestamp));
}

function candidateSourceMessageKey(value: unknown): string | null {
    if (value === "notes") return "pagelet.tab.memory.source.notes";
    if (value === "interactions") return "pagelet.tab.memory.source.interactions";
    if (value === "settings") return "pagelet.tab.memory.source.settings";
    if (value === "mixed") return "pagelet.tab.memory.source.mixed";
    if (value === "unknown") return "pagelet.tab.memory.source.unknown";
    return null;
}

function candidateScopeMessageKey(value: unknown): string | null {
    if (value === "current_vault") return "pagelet.tab.memory.scope.currentVault";
    if (value === "same_device") return "pagelet.tab.memory.scope.sameDevice";
    return null;
}

function isCandidateEffect(value: unknown): value is "none" | "stored_not_in_use" | "retrieval_only"
    | "future_answers" | "collaboration_default" {
    return value === "none"
        || value === "stored_not_in_use"
        || value === "retrieval_only"
        || value === "future_answers"
        || value === "collaboration_default";
}

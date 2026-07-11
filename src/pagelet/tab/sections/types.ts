/* Copyright 2023 edonyzpc */

/**
 * Shared interface and types for extracted Tab section renderers.
 *
 * Each action-heavy section (Memory Governance, Maintenance Review,
 * Quiet Recall) implements TabSectionRenderer. TabView orchestrates
 * layout, scroll preservation, and shared async action state.
 */

// ---------------------------------------------------------------------------
// Section renderer interface
// ---------------------------------------------------------------------------

export interface TabSectionRenderer {
    hasContent(): boolean;
    render(container: HTMLElement): void;
    rerender(): void;
    destroy(): void;
}

export interface TabSectionCallbacks {
    requestRerender: () => void;
    canCommitActionState?: () => boolean;
    confirmAction?: (options: { title: string; message: string }) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Memory Governance types (extracted from TabView)
// ---------------------------------------------------------------------------

export type MemoryCandidateActionStatus = "confirming" | "confirmed" | "dismissing" | "dismissed" | "failed";

export interface MemoryCandidateActionResult {
    ok: boolean;
    message: string;
}

export interface MemoryCandidateActionState {
    status: MemoryCandidateActionStatus;
    message: string;
}

export type MemoryRecordActionStatus =
    | "correcting"
    | "pausing"
    | "resuming"
    | "forgetting"
    | "undoing"
    | "succeeded"
    | "failed";

export interface MemoryRecordActionState {
    status: MemoryRecordActionStatus;
    message: string;
    action: "correct" | "pause" | "resume" | "forget" | "undo";
}

export interface MemoryRecordActionResult extends MemoryCandidateActionResult {
    record?: import("../../../pa").ConfirmedMemoryRecord;
}

// ---------------------------------------------------------------------------
// Maintenance Review types (extracted from TabView)
// ---------------------------------------------------------------------------

export type MaintenanceActionUiStatus = "applying" | "applied" | "failed" | "undoing" | "undone";

export interface MaintenanceActionUiState {
    status: MaintenanceActionUiStatus;
    message: string;
    actionId?: string;
}

// ---------------------------------------------------------------------------
// Quiet Recall types (extracted from TabView)
// ---------------------------------------------------------------------------

export type QuietRecallSaveStatus = "saving" | "saved" | "failed";
export type QuietRecallLinkStatus = "linking" | "linked" | "failed";

export interface QuietRecallSaveState {
    status: QuietRecallSaveStatus;
    message: string;
}

export interface QuietRecallLinkState {
    status: QuietRecallLinkStatus;
    message: string;
}

export interface QuietRecallLinkResult {
    ok: boolean;
    message: string;
}

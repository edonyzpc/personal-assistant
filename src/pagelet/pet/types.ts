/* Copyright 2023 edonyzpc */

import type { PageletLocale } from "../../locales/pagelet";

/** Pet states — system-driven, user cannot manually control */
export type PetState = "resting" | "idle" | "working" | "nudge";

/** Current Pagelet task visualized while the Pet is working. */
export type PetTaskKind = "review" | "connection" | "summary" | "background";

/** Configurable corner position */
export type PetCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** Callback interface for Pet interactions */
export interface PetCallbacks {
    onToggleBubble: () => void;
    onQuickCaptureOpen?: () => void;
    onReviewCurrentNote?: () => void;
    onDiscoverConnections?: () => void;
}

/** Options for creating a PetRenderer */
export interface PetRendererOptions {
    initialState?: PetState;
    initialTaskKind?: PetTaskKind;
    corner?: PetCorner;
    callbacks: PetCallbacks;
    prefersReducedMotion?: () => boolean;
    getLocale?: () => PageletLocale;
}

/** Public renderer contract */
export interface PetRenderer {
    readonly state: PetState;
    readonly taskKind: PetTaskKind;
    readonly corner: PetCorner;
    mount(containerEl: HTMLElement): void;
    unmount(): void;
    setState(state: PetState): void;
    setTaskKind(taskKind: PetTaskKind): void;
    setCorner(corner: PetCorner): void;
    flashError(durationMs?: number): void;
    destroy(): void;
}

/* Copyright 2023 edonyzpc */

/** v2 Pet states — system-driven, user cannot manually control */
export type PetState = "resting" | "idle" | "working" | "nudge";

/** Configurable corner position */
export type PetCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** Callback interface for Pet interactions */
export interface PetCallbacks {
    onToggleBubble: () => void;
}

/** Options for creating a PetRenderer */
export interface PetRendererOptions {
    initialState?: PetState;
    corner?: PetCorner;
    callbacks: PetCallbacks;
    prefersReducedMotion?: () => boolean;
}

/** Public renderer contract */
export interface PetRenderer {
    readonly state: PetState;
    readonly corner: PetCorner;
    mount(containerEl: HTMLElement): void;
    unmount(): void;
    setState(state: PetState): void;
    setCorner(corner: PetCorner): void;
    flashError(durationMs?: number): void;
    destroy(): void;
}

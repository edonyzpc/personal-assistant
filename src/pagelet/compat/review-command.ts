/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — command-palette review entry.
 *
 * The ribbon icon is only one affordance. Users can hide it, so the current
 * beta path needs a stable Obsidian command that still starts the same
 * current-note review flow.
 */

import type {
    PageletCommandHost,
    PageletHotkey,
} from "./focus-command";

export const PAGELET_REVIEW_CURRENT_COMMAND_ID = "pa-pagelet:review-current" as const;
export const PAGELET_OPEN_PANEL_COMMAND_ID = "pa-pagelet:open-panel" as const;

export interface RegisterPageletReviewCurrentCommandOptions {
    /** Localized display name. Defaults to an English command-palette label. */
    name?: string;
    /** Optional default hotkeys. Omit to let users bind their own in Obsidian. */
    hotkeys?: readonly PageletHotkey[] | null;
    /** Starts the same review flow as the Pagelet ribbon icon. */
    onReviewCurrent: () => void | Promise<void>;
}

export interface RegisterPageletOpenPanelCommandOptions {
    /** Localized display name. Defaults to an English command-palette label. */
    name?: string;
    /** Optional default hotkeys. Omit to let users bind their own in Obsidian. */
    hotkeys?: readonly PageletHotkey[] | null;
    /** Opens the Pagelet panel without reading note text or calling AI. */
    onOpenPanel: () => void | Promise<void>;
}

const DEFAULT_NAME_EN = "Pagelet: Review current note";
const DEFAULT_OPEN_PANEL_NAME_EN = "Pagelet: Open Pagelet";

export function registerPageletReviewCurrentCommand(
    host: PageletCommandHost,
    options: RegisterPageletReviewCurrentCommandOptions,
): void {
    host.addCommand({
        id: PAGELET_REVIEW_CURRENT_COMMAND_ID,
        name: options.name ?? DEFAULT_NAME_EN,
        ...(options.hotkeys ? { hotkeys: options.hotkeys } : {}),
        callback: () => {
            void options.onReviewCurrent();
        },
    });
}

export function registerPageletOpenPanelCommand(
    host: PageletCommandHost,
    options: RegisterPageletOpenPanelCommandOptions,
): void {
    host.addCommand({
        id: PAGELET_OPEN_PANEL_COMMAND_ID,
        name: options.name ?? DEFAULT_OPEN_PANEL_NAME_EN,
        ...(options.hotkeys ? { hotkeys: options.hotkeys } : {}),
        callback: () => {
            void options.onOpenPanel();
        },
    });
}

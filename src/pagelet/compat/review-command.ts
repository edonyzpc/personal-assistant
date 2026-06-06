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

export interface RegisterPageletReviewCurrentCommandOptions {
    /** Localized display name. Defaults to an English command-palette label. */
    name?: string;
    /** Optional default hotkeys. Omit to let users bind their own in Obsidian. */
    hotkeys?: readonly PageletHotkey[] | null;
    /** Starts the same review flow as the Pagelet ribbon icon. */
    onReviewCurrent: () => void | Promise<void>;
}

const DEFAULT_NAME_EN = "Pagelet: Review current note";

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

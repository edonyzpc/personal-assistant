/* Copyright 2023 edonyzpc */

import type { PageletCommandHost } from "./compat/focus-command";
import { pageletT, type PageletLocale } from "../locales/pagelet";

// ---------------------------------------------------------------------------
// Command IDs — v2
// ---------------------------------------------------------------------------

export const PAGELET_QUICK_REVIEW_COMMAND_ID = "pa-pagelet:quick-review" as const;
export const PAGELET_DISCOVER_COMMAND_ID = "pa-pagelet:discover-connections" as const;
export const PAGELET_PERIODIC_SUMMARY_COMMAND_ID = "pa-pagelet:periodic-summary" as const;
export const PAGELET_TOGGLE_HINTS_COMMAND_ID = "pa-pagelet:toggle-proactive-hints" as const;
export const PAGELET_PRELOAD_STATUS_COMMAND_ID = "pa-pagelet:preload-status" as const;
export const PAGELET_MOVE_PET_COMMAND_ID = "pa-pagelet:move-pet-corner" as const;
export const PAGELET_TOGGLE_PET_COMMAND_ID = "pa-pagelet:toggle-pet-visibility" as const;

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface PageletV2CommandCallbacks {
    onQuickReview: () => void | Promise<void>;
    onDiscoverConnections: () => void | Promise<void>;
    onPeriodicSummary: () => void | Promise<void>;
    onToggleProactiveHints: () => void | Promise<void>;
    onShowPreloadStatus: () => void | Promise<void>;
    onMovePetCorner: () => void | Promise<void>;
    onTogglePetVisibility: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPageletV2Commands(
    host: PageletCommandHost,
    callbacks: PageletV2CommandCallbacks,
    locale: PageletLocale = "en",
): void {
    host.addCommand({
        id: PAGELET_QUICK_REVIEW_COMMAND_ID,
        name: pageletT("pagelet.command.quickReview", locale),
        callback: () => { void callbacks.onQuickReview(); },
    });

    host.addCommand({
        id: PAGELET_DISCOVER_COMMAND_ID,
        name: pageletT("pagelet.command.discoverConnections", locale),
        callback: () => { void callbacks.onDiscoverConnections(); },
    });

    host.addCommand({
        id: PAGELET_PERIODIC_SUMMARY_COMMAND_ID,
        name: pageletT("pagelet.command.periodicSummary", locale),
        callback: () => { void callbacks.onPeriodicSummary(); },
    });

    host.addCommand({
        id: PAGELET_TOGGLE_HINTS_COMMAND_ID,
        name: pageletT("pagelet.command.toggleHints", locale),
        callback: () => { void callbacks.onToggleProactiveHints(); },
    });

    host.addCommand({
        id: PAGELET_PRELOAD_STATUS_COMMAND_ID,
        name: pageletT("pagelet.command.preloadStatus", locale),
        callback: () => { void callbacks.onShowPreloadStatus(); },
    });

    host.addCommand({
        id: PAGELET_MOVE_PET_COMMAND_ID,
        name: pageletT("pagelet.command.movePet", locale),
        callback: () => { void callbacks.onMovePetCorner(); },
    });

    host.addCommand({
        id: PAGELET_TOGGLE_PET_COMMAND_ID,
        name: pageletT("pagelet.command.togglePet", locale),
        callback: () => { void callbacks.onTogglePetVisibility(); },
    });
}

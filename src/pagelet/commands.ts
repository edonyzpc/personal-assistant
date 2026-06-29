/* Copyright 2023 edonyzpc */

import type { PageletCommandHost } from "./compat/focus-command";
import { pageletT, type PageletLocale } from "../locales/pagelet";

// ---------------------------------------------------------------------------
// Command IDs
// ---------------------------------------------------------------------------

export const PAGELET_OPEN_PANEL_COMMAND_ID = "pa-pagelet:open-panel" as const;
export const PAGELET_REVIEW_CURRENT_COMMAND_ID = "pa-pagelet:review-current" as const;
export const PAGELET_QUICK_REVIEW_COMMAND_ID = "pa-pagelet:quick-review" as const;
export const PAGELET_DISCOVER_COMMAND_ID = "pa-pagelet:discover-connections" as const;
export const PAGELET_PERIODIC_SUMMARY_COMMAND_ID = "pa-pagelet:periodic-summary" as const;
export const PAGELET_MAINTENANCE_REVIEW_COMMAND_ID = "pa-pagelet:maintenance-review" as const;
export const PAGELET_WEEKLY_REVIEW_COMMAND_ID = "pa-pagelet:weekly-review" as const;
export const PAGELET_QUIET_RECALL_COMMAND_ID = "pa-pagelet:quiet-recall" as const;
export const PAGELET_GRAPH_DISCOVERY_COMMAND_ID = "pa-pagelet:graph-discovery" as const;
export const PAGELET_SCOPE_RECAP_COMMAND_ID = "pa-pagelet:scope-recap" as const;
export const PAGELET_TOGGLE_HINTS_COMMAND_ID = "pa-pagelet:toggle-proactive-hints" as const;
export const PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID = "pa-pagelet:preload-status" as const;
export const PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID = "pa-pagelet:background-preparation-status" as const;
export const PAGELET_MOVE_PET_COMMAND_ID = "pa-pagelet:move-pet-corner" as const;
export const PAGELET_TOGGLE_PET_COMMAND_ID = "pa-pagelet:toggle-pet-visibility" as const;

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface PageletCommandCallbacks {
    onOpenPanel: () => void | Promise<void>;
    onReviewCurrent: () => void | Promise<void>;
    onQuickReview: () => void | Promise<void>;
    onDiscoverConnections: () => void | Promise<void>;
    onPeriodicSummary: () => void | Promise<void>;
    onMaintenanceReview: () => void | Promise<void>;
    onWeeklyReview: () => void | Promise<void>;
    onQuietRecall: () => void | Promise<void>;
    onGraphDiscovery: () => void | Promise<void>;
    onScopeRecap: () => void | Promise<void>;
    onToggleProactiveHints: () => void | Promise<void>;
    onShowBackgroundPreparationStatus: () => void | Promise<void>;
    onMovePetCorner: () => void | Promise<void>;
    onTogglePetVisibility: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPageletCommands(
    host: PageletCommandHost,
    callbacks: PageletCommandCallbacks,
    locale: PageletLocale = "en",
): void {
    host.addCommand({
        id: PAGELET_OPEN_PANEL_COMMAND_ID,
        name: pageletT("pagelet.command.openPanel", locale),
        callback: () => { void callbacks.onOpenPanel(); },
    });

    host.addCommand({
        id: PAGELET_REVIEW_CURRENT_COMMAND_ID,
        name: pageletT("pagelet.command.reviewCurrent", locale),
        callback: () => { void callbacks.onReviewCurrent(); },
    });

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
        id: PAGELET_MAINTENANCE_REVIEW_COMMAND_ID,
        name: pageletT("pagelet.command.maintenanceReview", locale),
        callback: () => { void callbacks.onMaintenanceReview(); },
    });

    host.addCommand({
        id: PAGELET_WEEKLY_REVIEW_COMMAND_ID,
        name: pageletT("pagelet.command.weeklyReview", locale),
        callback: () => { void callbacks.onWeeklyReview(); },
    });

    host.addCommand({
        id: PAGELET_QUIET_RECALL_COMMAND_ID,
        name: pageletT("pagelet.command.quietRecall", locale),
        callback: () => { void callbacks.onQuietRecall(); },
    });

    host.addCommand({
        id: PAGELET_GRAPH_DISCOVERY_COMMAND_ID,
        name: pageletT("pagelet.command.graphDiscovery", locale),
        callback: () => { void callbacks.onGraphDiscovery(); },
    });

    host.addCommand({
        id: PAGELET_SCOPE_RECAP_COMMAND_ID,
        name: pageletT("pagelet.command.scopeRecap", locale),
        callback: () => { void callbacks.onScopeRecap(); },
    });

    host.addCommand({
        id: PAGELET_TOGGLE_HINTS_COMMAND_ID,
        name: pageletT("pagelet.command.toggleHints", locale),
        callback: () => { void callbacks.onToggleProactiveHints(); },
    });

    host.addCommand({
        id: PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID,
        name: pageletT("pagelet.command.preloadStatus", locale),
        callback: () => { void callbacks.onShowBackgroundPreparationStatus(); },
    });

    host.addCommand({
        id: PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID,
        name: pageletT("pagelet.command.preloadStatusLegacy", locale),
        callback: () => { void callbacks.onShowBackgroundPreparationStatus(); },
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

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
export const PAGELET_MAINTENANCE_REVIEW_COMMAND_ID = "pa-pagelet:maintenance-review" as const;
export const PAGELET_QUIET_RECALL_COMMAND_ID = "pa-pagelet:quiet-recall" as const;
export const PAGELET_GRAPH_DISCOVERY_COMMAND_ID = "pa-pagelet:graph-discovery" as const;
export const PAGELET_SCOPE_RECAP_COMMAND_ID = "pa-pagelet:scope-recap" as const;
export const PAGELET_CLEAR_SCOPE_RECAP_CACHE_COMMAND_ID = "pa-pagelet:clear-scope-recap-cache" as const;
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
    onMaintenanceReview: () => void | Promise<void>;
    onQuietRecall: () => void | Promise<void>;
    onGraphDiscovery: () => void | Promise<void>;
    onScopeRecap: () => void | Promise<void>;
    onClearScopeRecapCache: () => void | Promise<void>;
    onToggleProactiveHints: () => void | Promise<void>;
    onShowBackgroundPreparationStatus: () => void | Promise<void>;
    onMovePetCorner: () => void | Promise<void>;
    onTogglePetVisibility: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function safeCallback(fn: () => void | Promise<void>): () => void {
    return () => {
        void Promise.resolve(fn()).catch((error) => {
            console.error("[PA] pagelet command error:", error);
        });
    };
}

export function registerPageletCommands(
    host: PageletCommandHost,
    callbacks: PageletCommandCallbacks,
    locale: PageletLocale = "en",
): void {
    host.addCommand({
        id: PAGELET_OPEN_PANEL_COMMAND_ID,
        name: pageletT("pagelet.command.openPanel", locale),
        callback: safeCallback(callbacks.onOpenPanel),
    });

    host.addCommand({
        id: PAGELET_REVIEW_CURRENT_COMMAND_ID,
        name: pageletT("pagelet.command.reviewCurrent", locale),
        callback: safeCallback(callbacks.onReviewCurrent),
    });

    host.addCommand({
        id: PAGELET_QUICK_REVIEW_COMMAND_ID,
        name: pageletT("pagelet.command.quickReview", locale),
        callback: safeCallback(callbacks.onQuickReview),
    });

    host.addCommand({
        id: PAGELET_DISCOVER_COMMAND_ID,
        name: pageletT("pagelet.command.discoverConnections", locale),
        callback: safeCallback(callbacks.onDiscoverConnections),
    });

    host.addCommand({
        id: PAGELET_MAINTENANCE_REVIEW_COMMAND_ID,
        name: pageletT("pagelet.command.maintenanceReview", locale),
        callback: safeCallback(callbacks.onMaintenanceReview),
    });

    host.addCommand({
        id: PAGELET_QUIET_RECALL_COMMAND_ID,
        name: pageletT("pagelet.command.quietRecall", locale),
        callback: safeCallback(callbacks.onQuietRecall),
    });

    host.addCommand({
        id: PAGELET_GRAPH_DISCOVERY_COMMAND_ID,
        name: pageletT("pagelet.command.graphDiscovery", locale),
        callback: safeCallback(callbacks.onGraphDiscovery),
    });

    host.addCommand({
        id: PAGELET_SCOPE_RECAP_COMMAND_ID,
        name: pageletT("pagelet.command.scopeRecap", locale),
        callback: safeCallback(callbacks.onScopeRecap),
    });

    host.addCommand({
        id: PAGELET_CLEAR_SCOPE_RECAP_CACHE_COMMAND_ID,
        name: pageletT("pagelet.command.clearScopeRecapCache", locale),
        callback: safeCallback(callbacks.onClearScopeRecapCache),
    });

    host.addCommand({
        id: PAGELET_TOGGLE_HINTS_COMMAND_ID,
        name: pageletT("pagelet.command.toggleHints", locale),
        callback: safeCallback(callbacks.onToggleProactiveHints),
    });

    host.addCommand({
        id: PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID,
        name: pageletT("pagelet.command.preloadStatus", locale),
        callback: safeCallback(callbacks.onShowBackgroundPreparationStatus),
    });

    host.addCommand({
        id: PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID,
        name: pageletT("pagelet.command.preloadStatusLegacy", locale),
        callback: safeCallback(callbacks.onShowBackgroundPreparationStatus),
    });

    host.addCommand({
        id: PAGELET_MOVE_PET_COMMAND_ID,
        name: pageletT("pagelet.command.movePet", locale),
        callback: safeCallback(callbacks.onMovePetCorner),
    });

    host.addCommand({
        id: PAGELET_TOGGLE_PET_COMMAND_ID,
        name: pageletT("pagelet.command.togglePet", locale),
        callback: safeCallback(callbacks.onTogglePetVisibility),
    });
}

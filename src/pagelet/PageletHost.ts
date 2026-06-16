/* Copyright 2023 edonyzpc */

/**
 * Narrow host interface -- what the Pagelet orchestrator needs from the plugin.
 *
 * Deliberately thin: only the settings and methods the orchestrator
 * actually reads. Everything else stays behind the plugin boundary.
 *
 * Extracted from orchestrator.ts so it can be imported independently
 * by sub-modules (BubbleCoordinator, BackgroundPreparationCoordinator,
 * PeriodicSummaryFlow, etc.) without pulling in the full orchestrator.
 */

import type { App, EventRef } from "obsidian";

import type { PetCorner } from "./pet/types";
import type { AnalyzeCallback } from "./preload/types";
import type { GenerateCallback, GeneratedReviewNote } from "./output/types";
import type { WriteResult } from "./output/types";
import type { PageletDetailPayload } from "./tab/types";

/**
 * Narrow host interface -- what the Pagelet orchestrator needs from the plugin.
 *
 * Deliberately thin: only the settings and methods the orchestrator
 * actually reads. Everything else stays behind the plugin boundary.
 */
export interface PageletHost {
    readonly app: App;

    readonly settings: {
        pagelet: {
            enabled: boolean;
            petVisible: boolean;
            petCorner: PetCorner;
            proactiveHints: boolean;
            proactiveHintsCooldown: number;
            proactiveHintsQuietHours: {
                enabled: boolean;
                start: string;
                end: string;
            };
            preloadEnabled: boolean;
            preloadInterval: number;
            preloadPerHourCap: number;
            preloadPerDayCap: number;
            preloadTokenBudget: { input: number; output: number };
            outputLanguage: "auto" | "zh" | "en";
            temperature: number;
            foregroundPerHourCap: number;
            foregroundPerDayCap: number;
            maxInputTokens: number;
            maxOutputTokens: number;
            reviewsFolder: string;
            periodicSummaryScope: "3d" | "7d" | "14d";
            excludedFolders: string[];
            excludedTags: string[];
            excludedPatterns: string[];
            onboardingShown: boolean;
        };
    };

    /** Structured debug log (no-op when debug is false). */
    log(message: string, ...args: unknown[]): void;

    /**
     * Register an Obsidian EventRef so the plugin can detach it on unload.
     * Delegates to `Plugin.registerEvent`.
     */
    registerEvent(ref: EventRef): void;

    /**
     * Factory for the LLM callback used by PreloadEngine.
     * The host MUST enforce `allowWrite=false` on the returned callback.
     */
    createPreloadAnalyzeCallback(): AnalyzeCallback;

    /** Factory for the LLM callback used by foreground review commands. */
    createForegroundAnalyzeCallback(): AnalyzeCallback;

    /** Factory for the LLM callback used by ReviewNoteGenerator. */
    createGenerateCallback(): GenerateCallback;

    /** Write a review note through the Pagelet write framework. */
    writeReviewNote(note: GeneratedReviewNote): Promise<WriteResult>;

    /** Update a pagelet setting and persist to disk. */
    updatePageletSetting<K extends keyof PageletHost["settings"]["pagelet"]>(
        key: K,
        value: PageletHost["settings"]["pagelet"][K],
    ): void;

    /** Persist current settings to disk. */
    saveSettings(): Promise<void> | void;

    /** Open Pagelet detail results in a native Obsidian workspace leaf. */
    openPageletDetailView(payload: PageletDetailPayload): Promise<void> | void;
}

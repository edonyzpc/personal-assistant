/* Copyright 2023 edonyzpc */

import type { App, EventRef, TFile } from "obsidian";

/**
 * Narrow host interface for the Memory subsystem.
 *
 * Keeps MemoryManager and VSS behind a small plugin boundary while preserving
 * the live settings reference used by the rest of the plugin.
 */
export interface MemoryHost {
    readonly app: App;
    readonly pluginId: string;
    readonly settings: {
        memoryEnabled: boolean;
        memoryAutoCheckBeforeChat: boolean;
        memoryApprovalPolicy: string;
        vssCacheExcludePath: string[];
        debug: boolean;
        aiProvider: string;
        chatModelName: string;
        embeddingModelName: string;
        baseURL: string;
        statisticsVaultId: string;
    };

    /** Structured debug log (no-op when debug is false). */
    log(message: string, ...args: unknown[]): void;

    /** Register an Obsidian EventRef so the plugin can detach it on unload. */
    registerEvent(ref: EventRef): void;

    /** Persist current settings to disk. */
    saveSettings(): Promise<void> | void;

    /** Return the Markdown files that are eligible for Memory indexing. */
    getVSSFiles(): TFile[];

    /** Resolve the configured provider API token. */
    getAPIToken(): Promise<string>;

    /** Notify UI consumers that Memory status has changed. */
    notifyStatusChanged(): void;

    /** Update a Memory setting and persist to disk. */
    updateMemorySetting<K extends keyof MemoryHost["settings"]>(
        key: K,
        value: MemoryHost["settings"][K],
    ): void;
}

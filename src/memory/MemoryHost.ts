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

    /** Persist Memory admission/compensation even while plugin unload is draining. */
    persistMemoryAdmissionSettings(): Promise<void>;

    /** Return the Markdown files that are eligible for Memory indexing. */
    getVSSFiles(): TFile[];

    /**
     * Re-check current shared Data Boundary and Memory exclusions for one file.
     * When Markdown is supplied, eligibility must be derived from that exact
     * provider-bound body instead of MetadataCache.
     */
    isVSSFileEligible(file: TFile, markdown?: string): boolean;

    /** Resolve the configured provider API token. */
    getAPIToken(): Promise<string>;

    /** Notify UI consumers that Memory status has changed. */
    notifyStatusChanged(): void;

    /** Mutate a Memory setting; the caller owns the persistence transaction. */
    updateMemorySetting<K extends keyof MemoryHost["settings"]>(
        key: K,
        value: MemoryHost["settings"][K],
    ): void;
}

/* Copyright 2023 edonyzpc */

import type { App } from "obsidian";

import type { MemorySearchPort } from "../memory/MemorySearchPort";
import type { AgentCapabilityTier } from "./capability-types";

/**
 * Narrow host interface for AI services.
 *
 * Keeps PaAgentRuntime and ChatService behind the plugin boundary while
 * exposing only the settings, Memory search port, and vault metadata they use.
 */
export interface AiServiceHost {
    readonly app: App;
    readonly settings: {
        debug: boolean;
        aiProvider: string;
        baseURL: string;
        chatModelName: string;
        policyModelName: string;
        embeddingModelName: string;
        shareAnonymousCapabilityUsage: boolean;
        skillContextEnabled: boolean;
        enabledSkillIds: string[];
        qwenThinkingEnabled: boolean;
        webSearchEnabled: boolean;
        licenseTier: AgentCapabilityTier;
        memoryEnabled: boolean;
        operationsAgentEnabled: boolean;
        statisticsVaultId: string;
    };

    /** Structured debug log (no-op when debug is false). */
    log(message: string, ...args: unknown[]): void;

    /** Resolve the configured provider API token. */
    getAPIToken(): Promise<string>;

    /** Whether the operations agent is enabled after runtime gates. */
    readonly isOperationsAgentEnabled: boolean;

    /** Build optional Memory extraction prompt context for PA Agent turns. */
    getMemoryExtractionPromptContext(): Record<string, unknown> | undefined;

    /** Search/read Memory through a narrow port. */
    readonly memorySearch: MemorySearchPort;

    /** Return Obsidian resolved links for graph-aware tools. */
    getResolvedLinks(): Record<string, Record<string, number>> | undefined;

    /** Whether a vault path may be used as Memory evidence under current privacy settings. */
    isDataBoundaryAllowedPath?(path: string): boolean;
}

/* Copyright 2023 edonyzpc */

import type { App } from "obsidian";

import type { GraphBoundarySnapshotSource } from "../graph/graph-boundary-snapshot";
import type { MemorySearchPort } from "../memory/MemorySearchPort";
import type { AgentRunCoordinatorPort } from "./agent-run-coordinator";
import type { AgentCapabilityTier } from "./capability-types";
import type {
    RetrievalDiagnosticEventInput,
    RetrievalDiagnosticRecorder,
    RetrievalDiagnosticSurface,
} from "./retrieval-diagnostics";

export interface RetrievalOptimizationFlags {
    lexicalProfile?: boolean;
    strictReranker?: boolean;
    graphPpr?: boolean;
    relaxedRecovery?: boolean;
}

export interface LatestMemorySourceMaterial {
    path: string;
    markdown: string;
    mtime: number;
    size: number;
}

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
        retrievalOptimizationFlags?: RetrievalOptimizationFlags;
        operationsAgentEnabled: boolean;
        operationsProactiveSaveSuggestionsEnabled: boolean;
        operationsAuditIncludeContent: boolean;
        operationsAuditRetentionDays: 30 | 90;
        statisticsVaultId: string;
    };

    /** Structured debug log (no-op when debug is false). */
    log(message: string, ...args: unknown[]): void;

    /**
     * Local, content-free calibration sink. The surface is a separate trusted
     * argument so event producers cannot relabel an event through its payload.
     * It is a no-op unless explicitly activated.
     */
    recordRetrievalDiagnostic?(
        surface: RetrievalDiagnosticSurface,
        event: RetrievalDiagnosticEventInput,
    ): void;

    /** Invocation-scoped, surface-bound sink; late completions cannot enter a later session. */
    createRetrievalDiagnosticRecorder?(
        surface: RetrievalDiagnosticSurface,
    ): RetrievalDiagnosticRecorder | undefined;

    /** Chat-only, diagnostics-session-bound cancellation probe for a dispatched graph Worker. */
    scheduleArmedGraphWorkerCancellation?(
        surface: RetrievalDiagnosticSurface,
        cancel: () => void,
    ): boolean;

    /** Live retrieval gate for runtimes whose settings object is an invocation snapshot. */
    isGraphPprEnabled?(): boolean;

    /** Live retrieval flags; never infer enabled from a stale runtime settings snapshot. */
    getRetrievalOptimizationFlags?(): Readonly<RetrievalOptimizationFlags>;

    /** Stable identity for the current retrieval-flag policy. */
    getRetrievalOptimizationEpoch?(): string;

    /** Observe persisted settings changes; the returned function must detach the listener. */
    onSettingsChanged?(listener: () => void | Promise<void>): () => void;

    /** Resolve the configured provider API token. */
    getAPIToken(): Promise<string>;

    /** Whether the operations agent is enabled after runtime gates. */
    readonly isOperationsAgentEnabled: boolean;

    /** Build optional Memory extraction prompt context for PA Agent turns. */
    getMemoryExtractionPromptContext(): Record<string, unknown> | undefined;

    /** Search/read Memory through a narrow port. */
    readonly memorySearch: MemorySearchPort;

    /**
     * Return one invocation-local, epoch-checked graph source. The classifier
     * is Host-owned so excluded Markdown can remain opaque without exposing it
     * as provider evidence, while generated/non-Markdown paths stay blocked.
     */
    getGraphBoundarySnapshotSource?(): GraphBoundarySnapshotSource | undefined;

    /**
     * Content/privacy epoch for one consumer. It changes on vault mutations and
     * Data Boundary policy changes, allowing a bounded group of latest-source
     * reads to be sealed before provider use.
     */
    getMemoryEvidenceEpoch?(): string;

    /** Whether a vault path may be used as Memory evidence under current privacy settings. */
    isDataBoundaryAllowedPath?(path: string): boolean;

    /** Stable latest Markdown read after the current consumer's full Data Boundary policy. */
    readLatestMemorySource?(path: string, signal?: AbortSignal): Promise<LatestMemorySourceMaterial | null>;

    /** Optional capacity-one coordinator shared by Chat and Pagelet Agent runs. */
    readonly agentRunCoordinator?: AgentRunCoordinatorPort;
}

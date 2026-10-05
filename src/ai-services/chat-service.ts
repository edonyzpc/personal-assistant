/* Copyright 2023 edonyzpc */
import { Platform, type TAbstractFile } from 'obsidian';
import {
    AIUtils,
    DASHSCOPE_INTL_COMPATIBLE_BASE_URL,
    isDashScopeCompatibleBaseURL,
    type QwenRequestOptions,
} from './ai-utils';
import type { AiServiceHost } from './AiServiceHost';
import type { MemoryMode } from '../memory-manager';
import type { PageletChatHandoffContext } from './pagelet-handoff';
import {
    PaAgentRuntime,
    canFallbackToNonStreaming,
    type PaAgentRuntimeOptions,
} from './pa-agent-runtime';
import {
    BuiltinWebSearchProvider,
    BAILIAN_INTL_WEB_SEARCH_MCP_ENDPOINT,
    BAILIAN_WEB_SEARCH_MCP_ENDPOINT,
    createBailianWebSearchNetworkPolicy,
    requestBailianWebSearchMcp,
} from './builtin-web-search-provider';
import type { CapabilityProvider } from './capability-types';
import type { AgentEvent, ChatAgentStatus, ChatContextUsedItem, ChatMessage, ChatTurnMemoryMetadata, LegacyAgentEvent } from './chat-types';
import { OperationsService, OperationsSession } from './operations/operations-service';
import { createObsidianNoteImageHost } from './operations/obsidian-note-image-host';
import { PaAgentContextSummarizer } from './context/PaAgentContextSummarizer';
import { createAbortError, throwIfAborted } from './chat-utils';
import { createAgentDebugLog, traceAgentPhase } from './pa-agent-debug';
import { agentDebugError, agentDebugStatus, observeAgentDebugPhase } from './agent-debug-observation';
import type { AgentDebugNodeStatus, AgentDebugRunRecorder } from './agent-debug-port';
import type { AgentRunLease } from './agent-run-coordinator';
import { applyOperationsExecutionResult, applyOperationsUndoResult, cloneActionStates,
    type PaAgentActionState } from './pa-agent-result-facts';
import { ChatImageCapabilityRegistry, chatImageModelKey, type ChatImageCapability } from './image-capability';
import type { PaAgentCommandInvocation } from './pa-agent-command';
import type {
    OperationsControllerEvent,
    OperationsExecutionResult,
    OperationsIntent,
    OperationsVault,
    OperationsVaultFile,
    UndoResult,
} from './operations/types';

export type { AgentEvent, ChatAgentStatus, ChatContextUsedItem, ChatMessage, ChatTurnMemoryMetadata, LegacyAgentEvent };
export { canFallbackToNonStreaming };

let debugRequestSequence = 0;

export function getBailianWebSearchEndpointForBaseURL(baseURL: string): string {
    const normalizedBaseURL = baseURL.trim().replace(/\/+$/, "");
    return normalizedBaseURL === DASHSCOPE_INTL_COMPATIBLE_BASE_URL
        ? BAILIAN_INTL_WEB_SEARCH_MCP_ENDPOINT
        : BAILIAN_WEB_SEARCH_MCP_ENDPOINT;
}

export interface StreamLLMOptions {
    /** Exact user-authored text before this call's app-owned prompt additions. */
    userText?: string;
    /** Host-owned actual lineage when visible text is app-prefilled from an image task. */
    inputLineage?: import('./input-lineage').InputLineage;
    /** Immutable Host choice captured with the exact Chat user message. */
    runSourceSelection?: import('./chat-source-scope').RunSourceSelection;
    images?: import('../chat/image-types').MessageImage[];
    imageAssetService?: import('../chat/image-assets').ImageAssetService;
    writingRequest?: import('./chat-types').ChatWritingRequest;
    writingContext?: import('./chat-types').ChatWritingContext;
    writingMaterialContext?: import('./chat-types').ChatWritingMaterialContext;
    writingContextHost?: import('./pa-agent-runtime').PaAgentRunOptions['writingContextHost'];
    writingHistoryHost?: import('./pa-agent-runtime').PaAgentRunOptions['writingHistoryHost'];
    imageStatus?: import('./pa-agent-runtime').PaAgentRunOptions['imageStatus'];
    operationsStatus?: import('./pa-agent-runtime').PaAgentRunOptions['operationsStatus'];
    /** Explicit compatibility candidate; no default protocol switch. */
    writingOutputProtocol?: 'native';
    memoryMode?: MemoryMode;
    /** Optional per-turn history cap; the runtime only permits lowering its normal limit. */
    historyBudgetChars?: number;
    /** Current or reserved conversation identity for host-bound Memory actions. */
    conversationId?: string;
    /** Host binding for one activated command; omitted by standalone callers. */
    commandInvocation?: PaAgentCommandInvocation;
    /** Explicit app-owned command template; never mixed into the raw user text. */
    commandGuidance?: string;
    /** Per-user-request image authority; omitted when the image service is unavailable. */
    createImage?: import('./chat-tool-types').CreateImageHostBinding;
    ghostPublishing?: import('./chat-tool-types').GhostHostBinding;
    /** Visible Pagelet evidence to inject into this explicit user turn only. */
    pageletHandoff?: PageletChatHandoffContext;
    onLifecycleEvent?: (event: AgentEvent) => void;
    /** Content-free run accounting; used by the controlled evaluation recorder. */
    onUsageAccounting?: (snapshot: import('./agent-usage-ledger').PaAgentUsageLedgerSnapshot) => void;
    /** Host-validated final text, including a pure incomplete result. */
    onCommittedFinalText?: (snapshot: string) => void;
    onEvent?: (event: LegacyAgentEvent) => void;
    onStatus?: (status: ChatAgentStatus) => void;
    onReasoningChunk?: (chunk: string) => void;
    onTurnMetadata?: (metadata: ChatTurnMemoryMetadata) => void;
    onOperationsIntentStaged?: (intent: OperationsIntent) => void;
}

/**
 * 聊天服务类，提供聊天相关的功能
 */
export class ChatService {
    private aiUtils: AIUtils;
    private host: AiServiceHost;
    private readonly operationsSession: OperationsSession;
    private readonly ownedOperationsService: OperationsService | null;
    private readonly contextSummarizer = new PaAgentContextSummarizer();
    private contextModelKey: string | undefined;
    private contextEpoch = 0;
    private readonly imageCapabilities = new ChatImageCapabilityRegistry();
    private readonly operationsContextObservers = new Map<string,
        (execution?: OperationsExecutionResult, undoResults?: readonly UndoResult[]) => Promise<void>>();
    private operationsContextUnsubscribe?: () => void;

    registerOperationsContextPersistence(intentId: string,
        persist: (execution?: OperationsExecutionResult, undoResults?: readonly UndoResult[]) => Promise<void>): void {
        this.operationsContextObservers.set(intentId, persist);
        if (this.operationsContextUnsubscribe) return;
        this.operationsContextUnsubscribe = this.operationsSession.subscribe(() => {
            for (const persistState of this.operationsContextObservers.values()) {
                void persistState().catch(error => this.host.log('Could not persist Operations context state', error));
            }
        });
    }

    getImageCapability(): ChatImageCapability { return this.imageCapabilities.get(this.host.settings); }

    constructor(host: AiServiceHost, operationsSession?: OperationsSession) {
        this.host = host;
        this.aiUtils = new AIUtils(host);
        if (operationsSession) {
            this.operationsSession = operationsSession;
            this.ownedOperationsService = null;
            return;
        }

        const operationsVault = host.app.vault as unknown as OperationsVault;
        const service = new OperationsService({
            vault: operationsVault,
            trashFile: async (file: OperationsVaultFile) => {
                await host.app.fileManager.trashFile(file as unknown as TAbstractFile);
            },
            isOperationsAgentEnabled: () => host.isOperationsAgentEnabled,
            ...(host.isDataBoundaryAllowedPath
                ? { isPathAllowed: (path: string) => host.isDataBoundaryAllowedPath?.(path) === true }
                : {}),
            ...(host.app.metadataCache
                ? {
                    noteImageRemovalHost: createObsidianNoteImageHost({
                        app: host.app,
                        isPathAllowed: (path: string) => host.isDataBoundaryAllowedPath?.(path) === true,
                        isAttachmentPathAllowed: (path: string) => host.isDataBoundaryAllowedPath?.(path) === true,
                    }),
                }
                : {}),
        });
        this.ownedOperationsService = service;
        this.operationsSession = service.createSession({ surface: "chat-fallback" });
    }

    async confirmOperationsIntent(intentId: string): Promise<OperationsExecutionResult> {
        const persist = this.operationsContextObservers.get(intentId);
        const result = await this.operationsSession.confirm(intentId);
        // The admitted native call can settle after the surface closes. Its finite
        // fact belongs to the original history sink; it does not restore authority.
        if (persist) {
            const settled = this.operationsSession.isDisposed ? { ...result,
                operations: result.operations.map(operation => ({ ...operation, undoAvailable: false })) } : undefined;
            await persist(settled).catch(error => this.host.log('Could not persist Operations context state', error));
        }
        return result;
    }

    cancelOperationsIntent(intentId: string): OperationsIntent {
        return this.operationsSession.cancel(intentId);
    }

    cancelPendingOperations(): void {
        this.operationsSession.cancelPending();
    }

    async undoOperations(receiptIds: readonly string[]): Promise<UndoResult[]> {
        const persist = [...this.operationsContextObservers.values()];
        const result = await this.operationsSession.undoMany(receiptIds);
        if (this.operationsSession.isDisposed) {
            for (const sink of persist) await sink(undefined, result)
                .catch(error => this.host.log('Could not persist Operations context state', error));
        }
        return result;
    }

    subscribeOperations(listener: (event: OperationsControllerEvent) => void): () => void {
        return this.operationsSession.subscribe(listener);
    }

    getVisibleOperationsStatus(
        intentId: string,
        runId: string,
    ): import('./operations-status-tool').OperationsStatusObservation {
        const observed = this.operationsSession.getContextResult(intentId, runId);
        const execution = observed.execution;
        if (!execution && !observed.terminal && !observed.pending && !observed.executing) {
            return { intentId, available: false, undoAvailable: false, reason: 'owner_unavailable' };
        }
        if (observed.blockedReason) {
            return { intentId, available: true, state: 'blocked', undoAvailable: false,
                blockedReason: observed.blockedReason };
        }
        const latestUndoResults = new Map(observed.undoResults.map(result => [result.receiptId, result]));
        const projectedOperations = execution?.operations.map(operation => {
            const undoResult = latestUndoResults.get(operation.receiptId ?? "");
            return undoResult?.effects ? { ...operation, effects: undoResult.effects } : operation;
        }) ?? [];
        const allEffects = projectedOperations.flatMap(operation => operation.effects ?? []);
        const undoneOperations = execution?.operations.filter(operation =>
            latestUndoResults.get(operation.receiptId ?? "")?.status === 'undone').length ?? 0;
        const hasRecovery = undoneOperations > 0 || allEffects.some(effect => effect.status === 'restored')
            || observed.undoResults.some(result => result.effects?.some(effect => effect.status === 'unknown'));
        const state = hasRecovery
            ? (undoneOperations === execution?.operations.length ? "undone" : "partial")
            : execution?.state
            ?? (observed.executing ? 'executing' : observed.pending ? 'pending' : observed.terminal);
        const effects = allEffects.map(effect => ({ key: effect.key, status: effect.status }));
        return {
            intentId,
            available: true,
            ...(state ? { state } : {}),
            ...(effects.length ? { effects } : {}),
            undoAvailable: execution?.operations.some(operation => operation.undoAvailable === true) ?? false,
        };
    }

    refreshOperationsActionState(state: PaAgentActionState): PaAgentActionState {
        if (state.owner !== 'operations') return state;
        const observed = this.operationsSession.getContextResult(state.operationId, state.origin.runId);
        let refreshed = observed.execution ? applyOperationsExecutionResult(state, observed.execution) ?? state : state;
        const undoAvailable = observed.execution?.operations.some(operation => operation.undoAvailable === true) ?? false;
        for (const undoResult of observed.undoResults) {
            refreshed = applyOperationsUndoResult(refreshed, undoResult, undoAvailable) ?? refreshed;
        }
        const lost = refreshed.phase === 'lost' && refreshed.receipt.kind === 'operations-terminal'
            && refreshed.receipt.state === 'lost';
        if ((refreshed.phase === 'pending' || lost) && observed.executing) {
            return cloneActionStates([{ ...refreshed, phase: 'running', revision: refreshed.revision + 1,
                receipt: { kind: 'operations-executing', intentId: state.operationId } }])[0] ?? refreshed;
        }
        const knownTerminal = observed.terminal === 'cancelled' || observed.terminal === 'expired';
        if ((refreshed.phase === 'pending' || refreshed.phase === 'running' || (lost && knownTerminal))
            && !observed.pending && !observed.executing) {
            const phase = observed.terminal === 'cancelled' ? 'cancelled'
                : observed.terminal === 'expired' ? 'expired' : 'lost';
            return cloneActionStates([{ ...refreshed, phase, revision: refreshed.revision + 1,
                receipt: { kind: 'operations-terminal', intentId: state.operationId, state: phase } }])[0] ?? refreshed;
        }
        return refreshed;
    }

    dispose(): void {
        this.contextEpoch += 1;
        this.contextSummarizer.dispose();
        this.operationsSession.dispose();
        this.operationsContextUnsubscribe?.();
        this.operationsContextUnsubscribe = undefined;
        this.operationsContextObservers.clear();
        this.ownedOperationsService?.dispose();
    }

    /** Derived context belongs to this view's current conversation only. */
    resetContext(): void {
        this.contextEpoch += 1;
        this.contextSummarizer.reset();
    }

    private getFinalAnswerQwenRequestOptions(): QwenRequestOptions | undefined {
        if (this.host.settings.aiProvider !== "qwen") return undefined;
        if (!isDashScopeCompatibleBaseURL(this.host.settings.baseURL)) return undefined;

        const qwenRequestOptions: QwenRequestOptions = {};
        if (this.host.settings.qwenThinkingEnabled) {
            qwenRequestOptions.enableThinking = true;
        }
        return qwenRequestOptions.enableThinking
            ? qwenRequestOptions
            : undefined;
    }

    private shouldLoadBuiltinWebSearchProvider(): boolean {
        return this.host.settings.aiProvider === "qwen"
            && this.host.settings.webSearchEnabled === true
            && isDashScopeCompatibleBaseURL(this.host.settings.baseURL);
    }

    private async getAdditionalCapabilityProviders(): Promise<CapabilityProvider[]> {
        if (!this.shouldLoadBuiltinWebSearchProvider()) return [];
        const apiKey = await this.aiUtils.getAPIToken();
        const endpoint = this.getBuiltinWebSearchEndpoint();
        return [new BuiltinWebSearchProvider({
            policy: createBailianWebSearchNetworkPolicy(endpoint),
            apiKey,
            request: requestBailianWebSearchMcp,
            isEnabled: () => this.shouldLoadBuiltinWebSearchProvider()
                && this.getBuiltinWebSearchEndpoint() === endpoint,
        })];
    }

    private getBuiltinWebSearchEndpoint(): string {
        return getBailianWebSearchEndpointForBaseURL(this.host.settings.baseURL);
    }

    private createAgentRuntime(options: PaAgentRuntimeOptions): PaAgentRuntime {
        return new PaAgentRuntime(this.host, this.aiUtils, options);
    }

    /**
     * 流式LLM调用
     */
    async streamLLM(
        prompt: string,
        onChunk: (chunk: string) => void,
        signal?: AbortSignal,
        chatHistory?: ChatMessage[],
        options: StreamLLMOptions = {},
    ): Promise<void> {
        let debugRecorder: AgentDebugRunRecorder | undefined;
        try {
            debugRecorder = this.host.agentDebug?.startRun({ conversationId: options.conversationId,
                prompt, provider: this.host.settings.aiProvider, model: this.host.settings.chatModelName });
        } catch { /* Observability cannot reject a Chat request. */ }
        let debugStatus: AgentDebugNodeStatus = "completed";
        let debugFailure: ReturnType<typeof agentDebugError>;
        const debugRequestId = debugRecorder?.captureId
            ?? `chat_${Date.now().toString(36)}_${++debugRequestSequence}`;
        const debug = createAgentDebugLog(() => this.host.settings.debug === true,
            (message, fields) => {
                this.host.log(message, fields);
                observeAgentDebugPhase(debugRecorder, String(fields.phase), fields);
            },
            { chatRequestId: debugRequestId, runId: null, turnId: null });
        debug('chat_start', { promptChars: prompt.length, historyCount: chatHistory?.length ?? 0 });
        const modelKey = JSON.stringify([
            this.host.settings.aiProvider,
            this.host.settings.baseURL,
            this.host.settings.chatModelName,
        ]);
        if (this.contextModelKey !== undefined && this.contextModelKey !== modelKey) this.resetContext();
        this.contextModelKey = modelKey;
        const contextEpoch = this.contextEpoch;
        const imageModelIdentity = { aiProvider: this.host.settings.aiProvider, baseURL: this.host.settings.baseURL, chatModelName: this.host.settings.chatModelName };
        const imageModelKey = chatImageModelKey(imageModelIdentity);
        let startupLease: AgentRunLease | undefined;
        let unsubscribeOperations: (() => void) | undefined;
        let runtime: PaAgentRuntime | undefined;
        try {
            startupLease = await traceAgentPhase(debug, 'chat_startup_lease', () => this.host.agentRunCoordinator?.acquireChatLease(signal));
            unsubscribeOperations = options.onOperationsIntentStaged
                ? this.operationsSession.subscribe((event: OperationsControllerEvent) => {
                    if (event.type === "intent-staged") options.onOperationsIntentStaged?.(event.intent);
                }) : undefined;
            throwIfAborted(signal);
            if (contextEpoch !== this.contextEpoch) throw createAbortError();
            const memoryMode = options.memoryMode ?? "auto";
            const nativeToolPlanningOptions = {
                nativeToolPlanningInternalGate: true,
            };
            const additionalCapabilityProviders = await traceAgentPhase(debug, 'service_capabilities', () => this.getAdditionalCapabilityProviders());
            throwIfAborted(signal);
            if (contextEpoch !== this.contextEpoch) throw createAbortError();
            const providerResponseDelivery = this.aiUtils
                .resolveChatTransport("native")
                .responseDelivery;
            runtime = this.createAgentRuntime({
                ...nativeToolPlanningOptions,
                contextSummarizer: this.contextSummarizer,
                runtimePlatform: Platform.isMobile ? "mobile" : "desktop",
                providerResponseDelivery,
                additionalCapabilityProviders,
                policyOptions: {
                    licenseTier: this.host.settings.licenseTier,
                },
                operationsIntentController: this.operationsSession,
                operationsToolProvider: this.operationsSession.provider,
            });
            // Startup admission protects the conversation/model snapshot. The
            // long-running operation lane is reacquired per Agent turn below.
            startupLease?.release();
            startupLease = undefined;
            await runtime.streamTurn({
                ...(debugRequestId ? { debugRequestId } : {}),
                debugRecorder,
                onUsageAccounting: options.onUsageAccounting,
                prompt,
                userText: options.userText,
                inputLineage: options.inputLineage,
                runSourceSelection: options.runSourceSelection,
                conversationId: options.conversationId,
                commandInvocation: options.commandInvocation,
                commandGuidance: options.commandGuidance,
                createImage: options.createImage,
                ghostPublishing: options.ghostPublishing,
                chatHistory,
                images: options.images,
                imageAssetService: options.imageAssetService,
                writingRequest: options.writingRequest,
                writingContext: options.writingContext,
                writingMaterialContext: options.writingMaterialContext,
                writingContextHost: options.writingContextHost,
                writingHistoryHost: options.writingHistoryHost,
                imageStatus: options.imageStatus,
                ...(options.operationsStatus ? { operationsStatus: options.operationsStatus } : {}),
                writingOutputProtocol: options.writingOutputProtocol,
                isCurrent: () => contextEpoch === this.contextEpoch && imageModelKey === chatImageModelKey(this.host.settings),
                imageCapability: {
                    get: () => this.imageCapabilities.get(imageModelIdentity),
                    onSuccess: () => this.imageCapabilities.recordSupported(imageModelIdentity),
                    onError: (error) => this.imageCapabilities.recordError(imageModelIdentity, error),
                },
                historyBudgetChars: options.historyBudgetChars,
                memoryMode,
                pageletHandoff: options.pageletHandoff,
                signal,
                ...(this.host.agentRunCoordinator ? {
                    turnLeaseProvider: ({ signal: turnSignal }) => (
                        this.host.agentRunCoordinator!.acquireChatLease(turnSignal)
                    ),
                } : {}),
                qwenRequestOptions: this.getFinalAnswerQwenRequestOptions(),
                onLifecycleEvent: (event) => {
                    if (event.type === "agent_end") debugStatus = agentDebugStatus(event.status);
                    options.onLifecycleEvent?.(event);
                },
                onCommittedFinalText: options.onCommittedFinalText,
                onEvent: (event) => adaptAgentEvent(event, onChunk, options),
            });
        } catch (error) {
            debugStatus = signal?.aborted || (error instanceof Error && error.name === "AbortError") ? "cancelled" : "failed";
            debugFailure = agentDebugError(error);
            throw error;
        } finally {
            runtime?.dispose();
            unsubscribeOperations?.();
            startupLease?.release();
            debug('chat_end', { aborted: signal?.aborted === true });
            try { debugRecorder?.finish(debugStatus, debugFailure); } catch { /* Never replace the business result. */ }
        }
    }
}

function adaptAgentEvent(
    event: LegacyAgentEvent,
    onChunk: (chunk: string) => void,
    options: StreamLLMOptions,
): void {
    options.onEvent?.(event);
    switch (event.kind) {
        case "activity": {
            const legacyStatus = event.detail?.legacyStatus as ChatAgentStatus | undefined;
            if (legacyStatus) {
                options.onStatus?.(legacyStatus);
            }
            return;
        }
        case "answer-snapshot":
            onChunk(event.snapshot);
            return;
        case "reasoning-chunk":
            options.onReasoningChunk?.(event.chunk);
            return;
        case "turn-metadata":
            options.onTurnMetadata?.(event.metadata);
            return;
        case "answer-started":
        case "writing-artifact":
        case "writing-recovery":
        case "answer-complete":
        case "partial-output-error":
        case "aborted":
            return;
    }
}

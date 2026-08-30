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

export function getBailianWebSearchEndpointForBaseURL(baseURL: string): string {
    const normalizedBaseURL = baseURL.trim().replace(/\/+$/, "");
    return normalizedBaseURL === DASHSCOPE_INTL_COMPATIBLE_BASE_URL
        ? BAILIAN_INTL_WEB_SEARCH_MCP_ENDPOINT
        : BAILIAN_WEB_SEARCH_MCP_ENDPOINT;
}

export interface StreamLLMOptions {
    memoryMode?: MemoryMode;
    /** Visible Pagelet evidence to inject into this explicit user turn only. */
    pageletHandoff?: PageletChatHandoffContext;
    onLifecycleEvent?: (event: AgentEvent) => void;
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
            audit: {
                includeContent: () => host.settings.operationsAuditIncludeContent,
                retentionDays: () => host.settings.operationsAuditRetentionDays,
            },
            ...(host.isDataBoundaryAllowedPath
                ? { isPathAllowed: (path: string) => host.isDataBoundaryAllowedPath?.(path) === true }
                : {}),
            log: (message, ...args) => host.log(message, ...args),
        });
        this.ownedOperationsService = service;
        this.operationsSession = service.createSession({ surface: "chat-fallback" });
    }

    async confirmOperationsIntent(intentId: string): Promise<OperationsExecutionResult> {
        return await this.operationsSession.confirm(intentId);
    }

    cancelOperationsIntent(intentId: string): OperationsIntent {
        return this.operationsSession.cancel(intentId);
    }

    cancelPendingOperations(): void {
        this.operationsSession.cancelPending();
    }

    async undoOperations(receiptIds: readonly string[]): Promise<UndoResult[]> {
        return await this.operationsSession.undoMany(receiptIds);
    }

    dispose(): void {
        this.operationsSession.dispose();
        this.ownedOperationsService?.dispose();
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
        return [new BuiltinWebSearchProvider({
            policy: createBailianWebSearchNetworkPolicy(this.getBuiltinWebSearchEndpoint()),
            apiKey,
            request: requestBailianWebSearchMcp,
        })];
    }

    private getBuiltinWebSearchEndpoint(): string {
        return getBailianWebSearchEndpointForBaseURL(this.host.settings.baseURL);
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
        const lease = await this.host.agentRunCoordinator?.acquireChatLease(signal);
        const unsubscribeOperations = options.onOperationsIntentStaged
            ? this.operationsSession.subscribe((event: OperationsControllerEvent) => {
                if (event.type === "intent-staged") options.onOperationsIntentStaged?.(event.intent);
            })
            : undefined;
        let runtime: PaAgentRuntime | undefined;
        try {
            const memoryMode = options.memoryMode ?? "auto";
            const nativeToolPlanningOptions = {
                nativeToolPlanningInternalGate: true,
            };
            const additionalCapabilityProviders = await this.getAdditionalCapabilityProviders();
            const providerResponseDelivery = this.aiUtils
                .resolveChatTransport("native")
                .responseDelivery;
            runtime = new PaAgentRuntime(
                this.host,
                this.aiUtils,
                {
                    ...nativeToolPlanningOptions,
                    runtimePlatform: Platform.isMobile ? "mobile" : "desktop",
                    providerResponseDelivery,
                    additionalCapabilityProviders,
                    policyOptions: {
                        licenseTier: this.host.settings.licenseTier,
                    },
                    operationsIntentController: this.operationsSession,
                    operationsToolProvider: this.operationsSession.provider,
                },
            );
            await runtime.streamTurn({
                prompt,
                chatHistory,
                memoryMode,
                pageletHandoff: options.pageletHandoff,
                signal,
                qwenRequestOptions: this.getFinalAnswerQwenRequestOptions(),
                onLifecycleEvent: options.onLifecycleEvent,
                onEvent: (event) => adaptAgentEvent(event, onChunk, options),
            });
        } finally {
            runtime?.dispose();
            unsubscribeOperations?.();
            lease?.release();
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
        case "answer-complete":
        case "partial-output-error":
        case "aborted":
            return;
    }
}

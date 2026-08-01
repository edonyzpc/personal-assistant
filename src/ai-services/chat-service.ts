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
import { OperationsAuditStore } from './operations/operations-audit-store';
import { OperationsIntentController } from './operations/operations-intent-controller';
import type {
    OperationsControllerEvent,
    OperationsExecutionResult,
    OperationsIntent,
    OperationsVault,
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
    private readonly operationsController: OperationsIntentController;

    constructor(host: AiServiceHost) {
        this.host = host;
        this.aiUtils = new AIUtils(host);
        const operationsVault = host.app.vault as unknown as OperationsVault;
        this.operationsController = new OperationsIntentController({
            vault: operationsVault,
            trashFile: async (file) => await host.app.fileManager.trashFile(file as unknown as TAbstractFile),
            auditStore: new OperationsAuditStore(operationsVault, {
                includeContent: () => host.settings.operationsAuditIncludeContent,
                retentionDays: () => host.settings.operationsAuditRetentionDays,
            }),
            ...(host.isDataBoundaryAllowedPath
                ? { isPathAllowed: (path: string) => host.isDataBoundaryAllowedPath?.(path) === true }
                : {}),
            onEvent: (event) => {
                const result = event.type === "operation-result" || event.type === "undo-result"
                    ? event.result
                    : undefined;
                if (result?.auditRetentionWarning) {
                    host.log("Operations audit retention cleanup incomplete", {
                        operationId: "operationId" in result ? result.operationId : undefined,
                        path: result.path,
                        warning: result.auditRetentionWarning,
                    });
                }
                if (result?.auditStatus !== "failed") return;
                host.log("Operations audit record unavailable", {
                    operationId: "operationId" in result ? result.operationId : undefined,
                    path: result.path,
                    error: result.auditError,
                });
            },
        });
    }

    async confirmOperationsIntent(intentId: string): Promise<OperationsExecutionResult> {
        if (!this.host.isOperationsAgentEnabled) {
            try {
                this.operationsController.cancelIntent(intentId);
            } catch {
                // Missing, expired, or terminal intents are already fail-closed.
            }
            throw new Error("Operations is no longer enabled. Nothing was written.");
        }
        return await this.operationsController.executeIntent(intentId);
    }

    cancelOperationsIntent(intentId: string): OperationsIntent {
        return this.operationsController.cancelIntent(intentId);
    }

    cancelPendingOperations(): void {
        for (const intent of this.operationsController.listPendingIntents()) {
            this.operationsController.cancelIntent(intent.id);
        }
    }

    async undoOperations(receiptIds: readonly string[]): Promise<UndoResult[]> {
        return await this.operationsController.undoMany(receiptIds);
    }

    dispose(): void {
        this.operationsController.dispose();
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
            ? this.operationsController.subscribe((event: OperationsControllerEvent) => {
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
            runtime = new PaAgentRuntime(
                this.host,
                this.aiUtils,
                {
                    ...nativeToolPlanningOptions,
                    runtimePlatform: Platform.isMobile ? "mobile" : "desktop",
                    additionalCapabilityProviders,
                    policyOptions: {
                        licenseTier: this.host.settings.licenseTier,
                    },
                    operationsIntentController: this.operationsController,
                },
            );
            await runtime.streamTurn({
                prompt,
                chatHistory,
                memoryMode,
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

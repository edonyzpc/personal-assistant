/* Copyright 2023 edonyzpc */
import {
    AIUtils,
    isDashScopeCompatibleBaseURL,
    type QwenRequestOptions,
    SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS,
} from './ai-utils';
import type { PluginManager } from '../plugin'
import type { MemoryMode } from '../memory-manager';
import {
    ChatAgentRuntime,
    canFallbackToNonStreaming,
} from './chat-agent';
import type { AgentEvent, ChatAgentStatus, ChatContextUsedItem, ChatMessage, ChatTurnMemoryMetadata } from './chat-types';

export type { AgentEvent, ChatAgentStatus, ChatContextUsedItem, ChatMessage, ChatTurnMemoryMetadata };
export { canFallbackToNonStreaming };

export interface StreamLLMOptions {
    memoryMode?: MemoryMode;
    onEvent?: (event: AgentEvent) => void;
    onStatus?: (status: ChatAgentStatus) => void;
    onReasoningChunk?: (chunk: string) => void;
    onTurnMetadata?: (metadata: ChatTurnMemoryMetadata) => void;
}

/**
 * 聊天服务类，提供聊天相关的功能
 */
export class ChatService {
    private aiUtils: AIUtils;
    private plugin: PluginManager;

    constructor(plugin: PluginManager) {
        this.plugin = plugin;
        this.aiUtils = new AIUtils(plugin);
    }

    private getFinalAnswerQwenRequestOptions(): QwenRequestOptions | undefined {
        if (this.plugin.settings.aiProvider !== "qwen") return undefined;
        if (!isDashScopeCompatibleBaseURL(this.plugin.settings.baseURL)) return undefined;

        const qwenRequestOptions: QwenRequestOptions = {};
        if (this.plugin.settings.qwenThinkingEnabled) {
            qwenRequestOptions.enableThinking = true;
        }
        if (this.plugin.settings.qwenWebSearchEnabled) {
            qwenRequestOptions.enableWebSearch = true;
            qwenRequestOptions.searchOptions = { forced_search: false };
        }
        return qwenRequestOptions.enableThinking || qwenRequestOptions.enableWebSearch
            ? qwenRequestOptions
            : undefined;
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
        const memoryMode = options.memoryMode ?? "auto";
        const nativeToolPlanningOptions = this.plugin.settings.nativeToolPlanningSmokeEnabled
            ? {
                nativeToolPlanningInternalGate: true,
                nativeToolCallingValidatedModels: SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS,
            }
            : {
                nativeToolPlanningInternalGate: true,
            };
        const runtime = new ChatAgentRuntime(
            this.plugin,
            this.aiUtils,
            nativeToolPlanningOptions,
        );
        await runtime.streamTurn({
            prompt,
            chatHistory,
            memoryMode,
            signal,
            qwenRequestOptions: this.getFinalAnswerQwenRequestOptions(),
            onEvent: (event) => adaptAgentEvent(event, onChunk, options),
        });
    }
}

function adaptAgentEvent(
    event: AgentEvent,
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

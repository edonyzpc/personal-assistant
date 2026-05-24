/* Copyright 2023 edonyzpc */
import { Platform } from 'obsidian';
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
import {
    BuiltinWebSearchProvider,
    createBailianWebSearchNetworkPolicy,
    requestBailianWebSearchMcp,
} from './builtin-web-search-provider';
import type { CapabilityProvider } from './capability-types';
import { extractCanonicalTurnMetadata } from './pa-agent-history';
import type { AgentEvent, ChatAgentStatus, ChatContextUsedItem, ChatMessage, ChatTurnMemoryMetadata, LegacyAgentEvent, PaAgentMessage } from './chat-types';

export type { AgentEvent, ChatAgentStatus, ChatContextUsedItem, ChatMessage, ChatTurnMemoryMetadata, LegacyAgentEvent };
export { canFallbackToNonStreaming };

export interface StreamLLMOptions {
    memoryMode?: MemoryMode;
    onLifecycleEvent?: (event: AgentEvent) => void;
    onEvent?: (event: LegacyAgentEvent) => void;
    onStatus?: (status: ChatAgentStatus) => void;
    onReasoningChunk?: (chunk: string) => void;
    onTurnMetadata?: (metadata: ChatTurnMemoryMetadata) => void;
}

export interface PaAgentLifecycleLegacyAdapterCallbacks {
    onChunk: (snapshot: string) => void;
    onReasoningChunk?: (chunk: string) => void;
    onTurnMetadata?: (metadata: ChatTurnMemoryMetadata) => void;
}

export function createPaAgentLifecycleLegacyAdapter(
    callbacks: PaAgentLifecycleLegacyAdapterCallbacks,
): (event: AgentEvent) => void {
    let committedSnapshot = "";
    const canonicalMessages = new Map<string, PaAgentMessage>();
    let metadataEmitted = false;

    return (event: AgentEvent) => {
        switch (event.type) {
            case "message_start":
            case "message_end":
                canonicalMessages.set(event.message.id, event.message);
                if (event.type === "message_start") return;
                if (event.message.role === "toolResult") return;
                if (event.message.role !== "assistant") return;
                if (event.message.content.some((part) => part.type === "toolCall")) return;

                {
                    const finalText = event.message.content
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join("");
                    if (!finalText) return;

                    committedSnapshot += finalText;
                    callbacks.onChunk(committedSnapshot);
                    return;
                }
            case "message_update":
                if (event.update.kind === "thinking_delta") {
                    callbacks.onReasoningChunk?.(event.update.text);
                }
                return;
            case "turn_end": {
                for (const toolResult of event.toolResults ?? []) {
                    canonicalMessages.set(toolResult.id, toolResult);
                }
                return;
            }
            case "agent_end": {
                if (metadataEmitted) return;
                metadataEmitted = true;
                const metadata = extractCanonicalTurnMetadata({ messages: [...canonicalMessages.values()] });
                if (
                    metadata.hasMemoryContent
                    || (metadata.contextUsed?.length ?? 0) > 0
                    || (metadata.sourceRecords?.length ?? 0) > 0
                ) {
                    callbacks.onTurnMetadata?.(metadata);
                }
                return;
            }
            case "agent_start":
            case "turn_start":
            case "tool_execution_start":
            case "tool_execution_update":
            case "tool_execution_end":
                return;
        }
    };
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
        return qwenRequestOptions.enableThinking
            ? qwenRequestOptions
            : undefined;
    }

    private shouldLoadBuiltinWebSearchProvider(): boolean {
        return this.plugin.settings.aiProvider === "qwen"
            && this.plugin.settings.webSearchEnabled === true
            && isDashScopeCompatibleBaseURL(this.plugin.settings.baseURL);
    }

    private async getAdditionalCapabilityProviders(): Promise<CapabilityProvider[]> {
        if (!this.shouldLoadBuiltinWebSearchProvider()) return [];
        const apiKey = await this.aiUtils.getAPIToken();
        return [new BuiltinWebSearchProvider({
            policy: createBailianWebSearchNetworkPolicy(),
            apiKey,
            request: requestBailianWebSearchMcp,
        })];
    }

    private shouldUsePaAgentAnswerStream(): boolean {
        if (this.plugin.settings.paAgentAnswerStreamEnabled === false) return false;
        if (this.plugin.settings.aiProvider === "openai") return true;
        return this.plugin.settings.aiProvider === "qwen"
            && isDashScopeCompatibleBaseURL(this.plugin.settings.baseURL);
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
        const additionalCapabilityProviders = await this.getAdditionalCapabilityProviders();
        const runtime = new ChatAgentRuntime(
            this.plugin,
            this.aiUtils,
            {
                ...nativeToolPlanningOptions,
                paAgentAnswerStreamEnabled: this.shouldUsePaAgentAnswerStream(),
                runtimePlatform: Platform.isMobile ? "mobile" : "desktop",
                additionalCapabilityProviders,
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
        case "segment-boundary":
        case "answer-complete":
        case "partial-output-error":
        case "aborted":
            return;
    }
}

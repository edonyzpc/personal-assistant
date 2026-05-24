import type { AIMessageChunk } from "@langchain/core/messages";

import type {
    AIUtils,
    NativeToolCallingCapability,
    NativeToolCallingCapabilityOptions,
} from "../../ai-services/ai-utils";
import type { ChatToolProviderSchema } from "../../ai-services/chat-tools";
import {
    directAnswerFixture,
    replayAiMessageStream,
    type RecordedLlmStreamFixture,
} from "../fixtures/llm-stream";

export type FakeProviderFailureMode = "unavailable" | "timeout" | "protocol-error";

export interface FakeChatModelStep {
    invokeResponse?: unknown;
    streamFixture?: RecordedLlmStreamFixture;
    failure?: FakeProviderFailureMode;
}

export interface FakeChatModelCall {
    temperature: number | undefined;
    options: Parameters<AIUtils["createChatModel"]>[1];
}

export interface FakeChatModel {
    readonly invokeInputs: unknown[];
    readonly streamInputs: unknown[];
    readonly boundTools: unknown[][];
    invoke(input: unknown, options?: unknown): Promise<unknown>;
    stream(input: unknown, options?: unknown): AsyncGenerator<AIMessageChunk>;
    bindTools(tools: unknown[]): FakeChatModel;
}

const SUPPORTED_NATIVE_TOOL_CAPABILITY: NativeToolCallingCapability = {
    supported: true,
    status: "supported",
    provider: "qwen",
    model: "qwen-plus",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    reason: "Fake provider supports native tool calling.",
};

export class FakeChatModelProvider {
    readonly createChatModelCalls: FakeChatModelCall[] = [];
    readonly models: FakeChatModel[] = [];
    private readonly steps: FakeChatModelStep[];
    private readonly capability: NativeToolCallingCapability;

    constructor(
        steps: readonly FakeChatModelStep[] = [{ streamFixture: directAnswerFixture }],
        capability: NativeToolCallingCapability = SUPPORTED_NATIVE_TOOL_CAPABILITY,
    ) {
        this.steps = [...steps];
        this.capability = capability;
    }

    readonly createChatModel = (async (
        temperature?: number,
        options?: Parameters<AIUtils["createChatModel"]>[1],
    ) => {
        this.createChatModelCalls.push({ temperature, options });
        const model = new ScriptedFakeChatModel(this.steps.shift() ?? { streamFixture: directAnswerFixture });
        this.models.push(model);
        return model as unknown as Awaited<ReturnType<AIUtils["createChatModel"]>>;
    }) as AIUtils["createChatModel"];

    readonly getNativeToolCallingCapability = (
        _options?: NativeToolCallingCapabilityOptions,
    ): NativeToolCallingCapability => this.capability;

    toChatPlannerDependencies(): Pick<AIUtils, "createChatModel" | "getNativeToolCallingCapability"> {
        return {
            createChatModel: this.createChatModel,
            getNativeToolCallingCapability: this.getNativeToolCallingCapability,
        };
    }

    toChatAgentRuntimeAiUtils(): AIUtils {
        return this.toChatPlannerDependencies() as unknown as AIUtils;
    }
}

export function createFailingFakeChatModelProvider(failure: FakeProviderFailureMode): FakeChatModelProvider {
    return new FakeChatModelProvider([{ failure }]);
}

export function createFakeProviderFailureError(failure: FakeProviderFailureMode): Error {
    if (failure === "timeout") {
        const error = new Error("Fake provider timed out.");
        error.name = "TimeoutError";
        return error;
    }
    if (failure === "protocol-error") {
        const error = new Error("Fake provider emitted an invalid tool-call protocol shape.");
        error.name = "ProtocolError";
        return error;
    }
    const error = new Error("Fake provider is unavailable.");
    error.name = "ProviderUnavailableError";
    return error;
}

class ScriptedFakeChatModel implements FakeChatModel {
    readonly invokeInputs: unknown[] = [];
    readonly streamInputs: unknown[] = [];
    readonly boundTools: unknown[][] = [];
    private readonly step: FakeChatModelStep;

    constructor(step: FakeChatModelStep) {
        this.step = step;
    }

    async invoke(input: unknown): Promise<unknown> {
        this.invokeInputs.push(input);
        if (this.step.failure) {
            throw createFakeProviderFailureError(this.step.failure);
        }
        return this.step.invokeResponse ?? { content: "" };
    }

    async *stream(input: unknown, options?: unknown): AsyncGenerator<AIMessageChunk> {
        this.streamInputs.push(input);
        if (this.step.failure) {
            throw createFakeProviderFailureError(this.step.failure);
        }
        yield* replayAiMessageStream(this.step.streamFixture ?? directAnswerFixture, {
            signal: getAbortSignal(options),
        });
    }

    bindTools(tools: ChatToolProviderSchema[]): FakeChatModel {
        this.boundTools.push(tools);
        return this;
    }
}

function getAbortSignal(options: unknown): AbortSignal | undefined {
    if (!options || typeof options !== "object" || !("signal" in options)) {
        return undefined;
    }
    const signal = (options as { signal?: unknown }).signal;
    return signal instanceof AbortSignal ? signal : undefined;
}

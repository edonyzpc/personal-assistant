import {
    ChatOpenAI,
    ChatOpenAIResponses,
    convertMessagesToResponsesInput,
    convertResponsesDeltaToChatGenerationChunk,
    convertResponsesMessageToAIMessage,
    convertResponsesUsageToUsageMetadata,
    type ChatOpenAICallOptions,
    type ChatOpenAIFields,
    type ResponsesCreateInvoke,
} from '@langchain/openai';
import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';

export const OPENAI_TERRA_MODEL = 'gpt-6.1-terra';
export const OFFICIAL_OPENAI_BASE_URL = 'https://api.openai.com/v1';

type ResponsesInvocationParams = ReturnType<ChatOpenAIResponses['invocationParams']>;
type ResponsesTerminalResponse = Parameters<typeof convertResponsesMessageToAIMessage>[0];

/** Only the exact official Terra model/endpoint pair uses this protocol adapter. */
export function isOfficialOpenAITerraTarget(input: {
    provider: unknown;
    model: unknown;
    baseURL: unknown;
}): boolean {
    const provider = typeof input.provider === 'string' ? input.provider.trim().toLowerCase() : '';
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    const baseURL = typeof input.baseURL === 'string'
        ? input.baseURL.trim().toLowerCase().replace(/\/+$/, '') : '';
    return provider === 'openai' && model === OPENAI_TERRA_MODEL && baseURL === OFFICIAL_OPENAI_BASE_URL;
}

type TerminalCompletion = 'length' | 'content_filter' | 'unknown';

export class OpenAIResponsesTerminalError extends Error {
    constructor(
        readonly terminal: 'failed' | 'incomplete' | 'missing_terminal',
        options: { code?: string; message?: string; completion?: TerminalCompletion } = {},
    ) {
        super(options.message ?? (terminal === 'failed'
            ? 'OpenAI Responses request failed.'
            : terminal === 'incomplete'
                ? 'OpenAI Responses request ended before completion.'
                : 'OpenAI Responses stream ended without a terminal event.'));
        this.name = 'OpenAIResponsesTerminalError';
        if (options.code !== undefined) this.code = options.code;
        if (options.completion !== undefined) this.completion = options.completion;
    }

    readonly code?: string;
    readonly completion?: TerminalCompletion;
}

function terminalCompletion(response: ResponsesTerminalResponse): TerminalCompletion {
    const reason = (response as { incomplete_details?: { reason?: unknown } }).incomplete_details?.reason;
    if (reason === 'max_output_tokens') return 'length';
    if (reason === 'content_filter') return 'content_filter';
    return 'unknown';
}

function failedResponseError(response: ResponsesTerminalResponse): OpenAIResponsesTerminalError {
    const failure = (response as { error?: { code?: unknown; message?: unknown } }).error;
    const code = typeof failure?.code === 'string' ? failure.code : undefined;
    const message = typeof failure?.message === 'string' ? failure.message : undefined;
    return new OpenAIResponsesTerminalError('failed', { code, message });
}

function completedFinishReason(response: ResponsesTerminalResponse): 'stop' | 'tool_calls' {
    const output = response.output;
    return Array.isArray(output) && output.some(item => item?.type === 'function_call')
        ? 'tool_calls' : 'stop';
}

function responseUsage(response: ResponsesTerminalResponse) {
    return convertResponsesUsageToUsageMetadata(response.usage);
}

/** Existing textual auxiliary consumers expect a string, not LangChain text blocks. */
function asTextualAIMessage(message: AIMessage): AIMessage {
    return new AIMessage({
        id: message.id,
        name: message.name,
        content: message.text,
        tool_calls: message.tool_calls,
        invalid_tool_calls: message.invalid_tool_calls,
        usage_metadata: message.usage_metadata,
        additional_kwargs: message.additional_kwargs,
        response_metadata: message.response_metadata,
    });
}

function incompleteResponseMetadata(
    response: ResponsesTerminalResponse,
    completion: TerminalCompletion,
) {
    return {
        model_provider: 'openai',
        model: response.model,
        model_name: response.model,
        id: response.id,
        created_at: response.created_at,
        status: response.status,
        incomplete_details: response.incomplete_details,
        finish_reason: completion,
    };
}

class TerraChatOpenAIResponses extends ChatOpenAIResponses {
    override invocationParams(options?: this['ParsedCallOptions']): ResponsesInvocationParams {
        const params = super.invocationParams(options) as ResponsesInvocationParams & Record<string, unknown>;
        // Terra's default reasoning mode rejects the legacy Chat Completions sampling controls.
        delete params.temperature;
        delete params.top_p;
        params.reasoning = { ...params.reasoning, effort: params.reasoning?.effort ?? 'high' };
        delete params.previous_response_id;
        return { ...params, store: false };
    }

    override async _generate(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun,
    ): Promise<ChatResult> {
        options.signal?.throwIfAborted();
        const invocationParams = this.invocationParams(options);
        if (invocationParams.stream) {
            const stream = this._streamResponseChunks(messages, options, runManager);
            let finalChunk: ChatGenerationChunk | undefined;
            for await (const chunk of stream) {
                chunk.message.response_metadata = {
                    ...chunk.generationInfo,
                    ...chunk.message.response_metadata,
                };
                finalChunk = finalChunk?.concat(chunk) ?? chunk;
            }
            return {
                generations: finalChunk ? [finalChunk] : [],
                llmOutput: {
                    estimatedTokenUsage: (finalChunk?.message as AIMessageChunk | undefined)?.usage_metadata,
                },
            };
        }

        const data = await this.completionWithRetry({
            input: convertMessagesToResponsesInput({
                messages,
                zdrEnabled: this.zdrEnabled ?? false,
                model: this.model,
            }),
            ...invocationParams,
            stream: false,
        }, { signal: options?.signal, ...options?.options }) as ResponsesCreateInvoke;
        if (data.status === 'failed') throw failedResponseError(data);
        if (data.status === 'incomplete') {
            throw new OpenAIResponsesTerminalError('incomplete', { completion: terminalCompletion(data) });
        }
        if (data.status !== 'completed') {
            throw new OpenAIResponsesTerminalError('missing_terminal', {
                message: `OpenAI Responses returned unsupported status: ${String(data.status)}.`,
            });
        }
        const message = convertResponsesMessageToAIMessage(data);
        message.response_metadata.finish_reason = completedFinishReason(data);
        const textualMessage = asTextualAIMessage(message);
        return {
            generations: [{ text: textualMessage.text, message: textualMessage }],
            llmOutput: {
                id: data.id,
                estimatedTokenUsage: data.usage ? {
                    promptTokens: data.usage.input_tokens,
                    completionTokens: data.usage.output_tokens,
                    totalTokens: data.usage.total_tokens,
                } : undefined,
            },
        };
    }

    override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        const streamIterable = await this.completionWithRetry({
            ...this.invocationParams(options),
            input: convertMessagesToResponsesInput({
                messages,
                zdrEnabled: this.zdrEnabled ?? false,
                model: this.model,
            }),
            stream: true,
        }, options);
        let sawTerminal = false;
        for await (const data of streamIterable) {
            if (options.signal?.aborted) return;
            if (data.type === 'response.failed') {
                sawTerminal = true;
                throw failedResponseError(data.response);
            }
            if (data.type === 'response.incomplete') {
                sawTerminal = true;
                const response = data.response;
                const completion = terminalCompletion(response);
                yield new ChatGenerationChunk({
                    text: '',
                    message: new AIMessageChunk({
                        content: '',
                        usage_metadata: responseUsage(response),
                        response_metadata: incompleteResponseMetadata(response, completion),
                    }),
                });
                throw new OpenAIResponsesTerminalError('incomplete', { completion });
            }
            if (data.type === 'response.completed') {
                sawTerminal = true;
                const chunk = convertResponsesDeltaToChatGenerationChunk(data);
                if (!chunk) throw new OpenAIResponsesTerminalError('failed', {
                    message: 'OpenAI Responses completed event could not be converted.',
                });
                chunk.message.response_metadata = {
                    ...chunk.message.response_metadata,
                    finish_reason: completedFinishReason(data.response),
                };
                yield chunk;
                await runManager?.handleLLMNewToken(chunk.text || '', {
                    prompt: options.promptIndex ?? 0,
                    completion: 0,
                }, undefined, undefined, undefined, { chunk });
                continue;
            }
            const chunk = convertResponsesDeltaToChatGenerationChunk(data);
            if (chunk == null) continue;
            yield chunk;
            await runManager?.handleLLMNewToken(chunk.text || '', {
                prompt: options.promptIndex ?? 0,
                completion: 0,
            }, undefined, undefined, undefined, { chunk });
        }
        if (!sawTerminal && !options.signal?.aborted) {
            throw new OpenAIResponsesTerminalError('missing_terminal');
        }
    }
}

/** Remains a ChatOpenAI so PA's native action-history selection is unchanged. */
export class TerraChatOpenAI extends ChatOpenAI {
    constructor(fields: ChatOpenAIFields) {
        const terraFields: ChatOpenAIFields = {
            ...fields,
            useResponsesApi: true,
            supportsStrictToolCalling: false,
        };
        super(terraFields);
        this.responses = new TerraChatOpenAIResponses(terraFields);
    }

    override withConfig(config: Partial<ChatOpenAICallOptions>) {
        const model = new TerraChatOpenAI(this.fields ?? {});
        model.defaultOptions = { ...this.defaultOptions, ...config };
        return model;
    }
}

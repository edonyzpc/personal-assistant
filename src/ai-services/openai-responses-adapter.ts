import {
    ChatOpenAI,
    ChatOpenAIResponses,
    type ChatOpenAICallOptions,
    type ChatOpenAIFields,
} from '@langchain/openai';
import type OpenAI from 'openai';
import { ProviderCompletionError } from './provider-result';

export const OPENAI_TERRA_MODEL = 'gpt-6.1-terra';

export type PaChatProtocolPolicy = 'responses' | 'chat-completions' | 'sdk';

type ResponsesInvocationParams = ReturnType<ChatOpenAIResponses['invocationParams']>;
type ResponsesStreamingRequest = OpenAI.Responses.ResponseCreateParamsStreaming;
type ResponsesNonStreamingRequest = OpenAI.Responses.ResponseCreateParamsNonStreaming;
type TerminalCompletion = 'length' | 'content_filter' | 'unknown';

export class OpenAIResponsesTerminalError extends ProviderCompletionError {
    constructor(
        readonly terminal: 'failed' | 'incomplete' | 'missing_terminal',
        options: { code?: string; message?: string; completion?: TerminalCompletion } = {},
    ) {
        super(options.completion ?? 'missing_terminal', options.message ?? (
            terminal === 'failed'
                ? 'OpenAI Responses request failed.'
                : terminal === 'incomplete'
                    ? 'OpenAI Responses request ended before completion.'
                    : 'OpenAI Responses stream ended without a terminal event.'
        ));
        this.name = 'OpenAIResponsesTerminalError';
        if (options.code !== undefined) this.code = options.code;
    }

    readonly code?: string;
}

function terminalCompletion(response: OpenAI.Responses.Response): TerminalCompletion {
    const reason = response.incomplete_details?.reason;
    if (reason === 'max_output_tokens') return 'length';
    if (reason === 'content_filter') return 'content_filter';
    return 'unknown';
}

function failedResponseError(response: OpenAI.Responses.Response): OpenAIResponsesTerminalError {
    return new OpenAIResponsesTerminalError('failed', {
        code: response.error?.code,
        message: response.error?.message,
    });
}

async function* preserveResponsesStreamFailures(
    events: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
    for await (const event of events) {
        if (event.type === 'response.failed') throw failedResponseError(event.response);
        yield event;
    }
}

/**
 * Keeps PA's no-remote-response-session policy while leaving message and stream
 * protocol conversion to the installed LangChain SDK implementation.
 */
class PaChatOpenAIResponses extends ChatOpenAIResponses {
    override invocationParams(options?: this['ParsedCallOptions']): ResponsesInvocationParams {
        const params = super.invocationParams(options) as ResponsesInvocationParams & Record<string, unknown>;
        delete params.previous_response_id;
        return params;
    }

    override completionWithRetry(
        request: ResponsesStreamingRequest,
        requestOptions?: OpenAI.RequestOptions,
    ): Promise<AsyncIterable<OpenAI.Responses.ResponseStreamEvent>>;
    override completionWithRetry(
        request: ResponsesNonStreamingRequest,
        requestOptions?: OpenAI.RequestOptions,
    ): Promise<OpenAI.Responses.Response>;
    override async completionWithRetry(
        request: OpenAI.Responses.ResponseCreateParams,
        requestOptions?: OpenAI.RequestOptions,
    ): Promise<OpenAI.Responses.Response | AsyncIterable<OpenAI.Responses.ResponseStreamEvent>> {
        if (request.stream) {
            return super.completionWithRetry(request, requestOptions)
                .then(events => preserveResponsesStreamFailures(events));
        }

        return super.completionWithRetry(request, requestOptions).then(response => {
            if (response.status === 'failed') throw failedResponseError(response);
            if (response.status === 'incomplete') {
                throw new OpenAIResponsesTerminalError('incomplete', {
                    completion: terminalCompletion(response),
                });
            }
            if (response.status !== 'completed') {
                throw new OpenAIResponsesTerminalError('missing_terminal', {
                    message: `OpenAI Responses returned unsupported status: ${String(response.status)}.`,
                });
            }
            return response;
        });
    }
}

/** Remains a ChatOpenAI so PA's existing action-history and tool binding continue to apply. */
export class PaChatOpenAI extends ChatOpenAI {
    constructor(
        fields: ChatOpenAIFields,
        readonly protocolPolicy: PaChatProtocolPolicy = 'sdk',
    ) {
        super({
            ...fields,
            ...(protocolPolicy === 'responses' ? { useResponsesApi: true }
                : protocolPolicy === 'chat-completions' ? { useResponsesApi: false } : {}),
            ...(protocolPolicy === 'responses' ? {
                supportsStrictToolCalling: false,
                modelKwargs: { ...fields.modelKwargs, store: false },
                ...(fields.model === OPENAI_TERRA_MODEL ? {
                    reasoning: { ...fields.reasoning, effort: fields.reasoning?.effort ?? 'high' },
                } : {}),
            } : {}),
        });
        if (protocolPolicy === 'responses') {
            this.responses = new PaChatOpenAIResponses(this.fields ?? {});
        }
    }

    protected override _useResponsesApi(options: this['ParsedCallOptions'] | undefined): boolean {
        if (this.protocolPolicy === 'responses') return true;
        if (this.protocolPolicy === 'chat-completions') return false;
        return super._useResponsesApi(options);
    }

    override withConfig(config: Partial<ChatOpenAICallOptions>) {
        const model = new PaChatOpenAI(this.fields ?? {}, this.protocolPolicy);
        model.defaultOptions = { ...this.defaultOptions, ...config };
        return model;
    }
}

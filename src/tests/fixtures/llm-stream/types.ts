import {
    AIMessageChunk,
    type AIMessageChunkFields,
    type ToolCallChunk,
} from "@langchain/core/messages";

export interface RecordedAiMessageChunk {
    content: string;
    tool_call_chunks?: ToolCallChunk[];
    additional_kwargs?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
}

export interface RecordedLlmStreamFixture {
    name: string;
    description: string;
    chunks: RecordedAiMessageChunk[];
}

export interface ReplayLlmStreamOptions {
    signal?: AbortSignal;
}

export function createAiMessageChunk(fields: RecordedAiMessageChunk): AIMessageChunk {
    const chunkFields: AIMessageChunkFields = {
        content: fields.content,
        ...(fields.tool_call_chunks ? { tool_call_chunks: cloneJson(fields.tool_call_chunks) } : {}),
        ...(fields.additional_kwargs ? { additional_kwargs: cloneJson(fields.additional_kwargs) } : {}),
        ...(fields.response_metadata ? { response_metadata: cloneJson(fields.response_metadata) } : {}),
    };
    return new AIMessageChunk(chunkFields);
}

export function serializeAiMessageChunk(chunk: AIMessageChunk | RecordedAiMessageChunk): RecordedAiMessageChunk {
    const record = chunk as {
        content?: unknown;
        tool_call_chunks?: ToolCallChunk[];
        additional_kwargs?: Record<string, unknown>;
        response_metadata?: Record<string, unknown>;
    };

    const toolCallChunks = record.tool_call_chunks && record.tool_call_chunks.length > 0
        ? cloneJson(record.tool_call_chunks)
        : undefined;
    const additionalKwargs = record.additional_kwargs && Object.keys(record.additional_kwargs).length > 0
        ? cloneJson(record.additional_kwargs)
        : undefined;
    const responseMetadata = record.response_metadata && Object.keys(record.response_metadata).length > 0
        ? cloneJson(record.response_metadata)
        : undefined;

    return {
        content: typeof record.content === "string" ? record.content : "",
        ...(toolCallChunks ? { tool_call_chunks: toolCallChunks } : {}),
        ...(additionalKwargs ? { additional_kwargs: additionalKwargs } : {}),
        ...(responseMetadata ? { response_metadata: responseMetadata } : {}),
    };
}

export function recordAiMessageChunks(
    name: string,
    description: string,
    chunks: Iterable<AIMessageChunk | RecordedAiMessageChunk>,
): RecordedLlmStreamFixture {
    return {
        name,
        description,
        chunks: [...chunks].map(serializeAiMessageChunk),
    };
}

export async function recordAiMessageStream(
    name: string,
    description: string,
    stream: AsyncIterable<AIMessageChunk | RecordedAiMessageChunk>,
): Promise<RecordedLlmStreamFixture> {
    const chunks: RecordedAiMessageChunk[] = [];
    for await (const chunk of stream) {
        chunks.push(serializeAiMessageChunk(chunk));
    }
    return { name, description, chunks };
}

export async function* replayAiMessageStream(
    fixture: RecordedLlmStreamFixture,
    options: ReplayLlmStreamOptions = {},
): AsyncGenerator<AIMessageChunk> {
    for (const chunk of fixture.chunks) {
        if (options.signal?.aborted) {
            throw createStreamReplayAbortError();
        }
        yield createAiMessageChunk(chunk);
    }
}

function createStreamReplayAbortError(): Error {
    const error = new Error("LLM stream fixture replay aborted.");
    error.name = "AbortError";
    return error;
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

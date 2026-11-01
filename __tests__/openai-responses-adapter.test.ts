import { describe, expect, it, jest } from '@jest/globals';
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { ChatOpenAI, type ChatOpenAIFields } from '@langchain/openai';
import { OpenAIResponsesTerminalError, PaChatOpenAI } from '../src/ai-services/openai-responses-adapter';
import { assertProviderCompletion, readProviderCompletion } from '../src/ai-services/provider-result';
import { PaAgentLoop } from '../src/ai-services/pa-agent-loop';
import { streamWithInvokeFallback } from '../src/ai-services/pa-agent-runtime';

const usage = { input_tokens: 4, output_tokens: 3, total_tokens: 7 };

interface ResponsesRequestBody {
    tools?: Array<{
        type?: unknown;
        name?: unknown;
        strict?: boolean;
        parameters?: unknown;
    }>;
    input?: unknown;
}

function completedResponse(output: Array<Record<string, unknown>>) {
    return {
        id: 'resp_offline', object: 'response', created_at: 0, status: 'completed',
        model: 'gpt-6.1-terra', error: null, incomplete_details: null, instructions: null,
        metadata: {}, output, parallel_tool_calls: false, usage,
        output_text: output.some(item => item.type === 'message') ? 'final answer' : '',
    };
}

function functionCallOutput() {
    return [{
        id: 'fc_offline', type: 'function_call', status: 'completed', call_id: 'call_offline',
        name: 'read_note', arguments: '{"path":"note.md"}',
    }];
}

function jsonResponse(response: unknown) {
    return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
}

function sseResponse(events: Array<Record<string, unknown>>) {
    const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function createModel(customFetch: typeof fetch, reasoning?: ChatOpenAIFields['reasoning']) {
    return new PaChatOpenAI({
        model: 'gpt-6.1-terra',
        apiKey: 'offline-key',
        maxTokens: 123,
        configuration: { baseURL: 'https://api.openai.com/v1', fetch: customFetch },
        ...(reasoning === undefined ? {} : { reasoning }),
    }, 'responses');
}

describe('PA OpenAI Responses model boundary', () => {
    it('keeps the SDK ChatOpenAI identity, request policy, and canonical call IDs', async () => {
        const bodies: ResponsesRequestBody[] = [];
        let call = 0;
        const fetcher = jest.fn<typeof fetch>(async (_url, init) => {
            bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            call += 1;
            return call === 1
                ? jsonResponse(completedResponse(functionCallOutput()))
                : jsonResponse(completedResponse([{
                    id: 'msg_offline', type: 'message', status: 'completed', role: 'assistant',
                    content: [{ type: 'output_text', text: 'final answer', annotations: [] }],
                }]));
        });
        const model = createModel(fetcher).bindTools([{
            type: 'function',
            function: {
                name: 'read_note',
                description: 'Read a note',
                parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
        }], { signal: new AbortController().signal });

        expect(model).toBeInstanceOf(ChatOpenAI);
        expect(model).toBeInstanceOf(PaChatOpenAI);
        const first = await model.invoke([new HumanMessage('read the note')]);
        const canonicalCall = first.tool_calls?.[0];
        expect(canonicalCall).toMatchObject({ id: 'call_offline', name: 'read_note' });
        const second = await model.invoke([
            new HumanMessage('read the note'),
            new AIMessage({
                content: 'action context',
                tool_calls: [canonicalCall ?? { id: 'must-not', name: 'must-not', args: {} }],
            }),
            new ToolMessage({ tool_call_id: 'call_offline', name: 'read_note', content: 'note evidence' }),
            new HumanMessage('answer with the evidence'),
        ]);

        expect(second.text).toBe('final answer');
        expect(String(fetcher.mock.calls[0][0])).toBe('https://api.openai.com/v1/responses');
        for (const body of bodies) {
            expect(body).toMatchObject({
                model: 'gpt-6.1-terra', store: false, max_output_tokens: 123, stream: false,
                reasoning: { effort: 'high' },
            });
            expect(body).not.toHaveProperty('temperature');
            expect(body).not.toHaveProperty('top_p');
            expect(body).not.toHaveProperty('previous_response_id');
        }
        expect(bodies[1].input).toEqual([
            { type: 'message', role: 'user', content: 'read the note' },
            { type: 'message', role: 'assistant', content: 'action context' },
            { type: 'function_call', call_id: 'call_offline', name: 'read_note', arguments: '{"path":"note.md"}' },
            { type: 'function_call_output', call_id: 'call_offline', output: 'note evidence' },
            { type: 'message', role: 'user', content: 'answer with the evidence' },
        ]);
        const tool = bodies[0].tools?.[0];
        if (tool === undefined) {
            throw new Error('expected the first request to include the read_note tool');
        }
        expect(tool).toMatchObject({ type: 'function', name: 'read_note', strict: false });
        expect(tool.parameters).toEqual({
            type: 'object', properties: { path: { type: 'string' } }, required: ['path'],
        });
    });

    it('keeps an explicit SDK reasoning effort and sibling option', async () => {
        let requestBody: Record<string, unknown> | undefined;
        const fetcher = jest.fn<typeof fetch>(async (_url, init) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return jsonResponse(completedResponse([{
                id: 'msg_offline', type: 'message', status: 'completed', role: 'assistant',
                content: [{ type: 'output_text', text: 'final answer', annotations: [] }],
            }]));
        });
        await createModel(fetcher, { effort: 'medium', summary: 'auto' }).invoke('answer');
        expect(requestBody).toMatchObject({ reasoning: { effort: 'medium', summary: 'auto' } });
    });

    it('rejects an incomplete invoke result with the actual provider reason', async () => {
        const incomplete = {
            ...completedResponse([{
                id: 'msg_offline', type: 'message', status: 'incomplete', role: 'assistant',
                content: [{ type: 'output_text', text: 'partial answer', annotations: [] }],
            }]),
            status: 'incomplete',
            incomplete_details: { reason: 'content_filter' },
        };
        const fetcher = jest.fn<typeof fetch>(async () => jsonResponse(incomplete));

        await expect(createModel(fetcher).invoke('answer')).rejects.toMatchObject({
            terminal: 'incomplete', completion: 'content_filter',
        });
    });

    it('rejects a failed invoke result with its structured provider code', async () => {
        const fetcher = jest.fn<typeof fetch>(async () => jsonResponse({
            ...completedResponse([]), status: 'failed',
            error: { code: 'rate_limited', message: 'Provider failed.' },
        }));

        const rejection = createModel(fetcher).invoke('answer');
        await expect(rejection).rejects.toBeInstanceOf(OpenAIResponsesTerminalError);
        await expect(rejection).rejects.toMatchObject({ terminal: 'failed', code: 'rate_limited' });
    });

    it('keeps streamed partial output visible and marks an incomplete terminal', async () => {
        const response = {
            ...completedResponse([{
                id: 'msg_partial', type: 'message', status: 'incomplete', role: 'assistant',
                content: [{ type: 'output_text', text: 'partial answer', annotations: [] }],
            }]),
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
        };
        const fetcher = jest.fn<typeof fetch>(async () => sseResponse([
            { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'partial answer' },
            { type: 'response.incomplete', response },
        ]));
        const chunks: AIMessageChunk[] = [];
        for await (const chunk of await createModel(fetcher).stream('answer')) chunks.push(chunk);

        expect(chunks[0].text).toBe('partial answer');
        expect(chunks.map(chunk => readProviderCompletion(chunk)).filter(Boolean)).toEqual(['length']);
        expect(readProviderCompletion(chunks.at(-1))).toBe('length');
        expect(() => assertProviderCompletion(chunks.at(-1))).toThrow('not completed');
    });

    it('does not invent a terminal completion when the SDK stream reaches EOF', async () => {
        const fetcher = jest.fn<typeof fetch>(async () => sseResponse([
            { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'partial answer' },
        ]));
        const chunks: AIMessageChunk[] = [];
        for await (const chunk of await createModel(fetcher).stream('answer')) chunks.push(chunk);

        expect(chunks.map(chunk => chunk.text).join('')).toBe('partial answer');
        expect(chunks.some(chunk => readProviderCompletion(chunk) !== undefined)).toBe(false);
    });

    it('keeps streamed partial text visible before a failed terminal error', async () => {
        const fetcher = jest.fn<typeof fetch>(async () => sseResponse([
            { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'partial answer' },
            { type: 'response.failed', response: { ...completedResponse([]), status: 'failed',
                error: { code: 'server_error', message: 'Provider failed.' } } },
        ]));
        const chunks: string[] = [];

        await expect((async () => {
            for await (const chunk of await createModel(fetcher).stream('answer')) chunks.push(chunk.text);
        })()).rejects.toMatchObject({ terminal: 'failed', code: 'server_error' });
        expect(chunks).toEqual(['partial answer']);
    });

    it.each(['completed', 'incomplete', 'failed', 'eof'] as const)(
        'routes real SDK terminal fact %s through the loop before tool execution',
        async mode => {
            const terminalResponse = {
            ...completedResponse(functionCallOutput()),
                ...(mode === 'incomplete' ? {
                    status: 'incomplete',
                    incomplete_details: { reason: 'max_output_tokens' },
                } : {}),
            };
            let responseCall = 0;
            const fetcher = jest.fn<typeof fetch>(async () => {
                responseCall += 1;
                if (mode === 'completed' && responseCall === 2) {
                    return sseResponse([
                        { type: 'response.output_text.delta', output_index: 0, content_index: 0,
                            delta: 'note evidence answer' },
                        { type: 'response.completed', response: completedResponse([{
                            id: 'msg_offline', type: 'message', status: 'completed', role: 'assistant',
                            content: [{ type: 'output_text', text: 'note evidence answer', annotations: [] }],
                        }]) },
                    ]);
                }
                return sseResponse([
            { type: 'response.output_item.added', output_index: 0, item: {
                id: 'fc_offline', type: 'function_call', call_id: 'call_offline',
                name: 'read_note', arguments: '',
            } },
            { type: 'response.function_call_arguments.delta', output_index: 0,
                delta: '{"path":"note.md"}' },
                ...(mode === 'completed'
                    ? [{ type: 'response.completed', response: terminalResponse }]
                    : mode === 'incomplete'
                        ? [{ type: 'response.incomplete', response: terminalResponse }]
                        : mode === 'failed'
                            ? [{
                                type: 'response.failed',
                                response: { ...completedResponse([]), status: 'failed',
                                    error: { code: 'server_error', message: 'Provider failed.' } },
                            }]
                            : []),
                ]);
            });
            const model = createModel(fetcher);
            const executorCalls: string[] = [];
            const fallbacks: string[] = [];
            const invoke = jest.fn(async () => {
                throw new Error('invoke fallback must not run');
            });
            let policyDecisions = 0;
            const loop = new PaAgentLoop({
                runId: `run_${mode}`,
                userInput: 'read the note',
                model: {
                    stream: async function* (input) {
                        yield* streamWithInvokeFallback({
                            chain: {
                                stream: (_input: unknown, options?: { signal?: AbortSignal }) =>
                                    model.stream('read the note', options),
                                invoke: invoke as never,
                            },
                            input: 'read the note',
                            signal: input.signal,
                            prepareInvokeInput: () => 'read the note',
                            onFallback: reason => fallbacks.push(reason),
                        });
                    },
                },
                toolExecutor: {
                    execute: async ({ toolCall }) => {
                        executorCalls.push(toolCall.name);
                        return { outcome: 'success', promptText: 'note evidence' };
                    },
                },
                hostPolicy: {
                    afterTurn: () => {
                        policyDecisions += 1;
                        return mode === 'completed' && policyDecisions === 1
                            ? { action: 'continue', reason: 'tool_results_ready' }
                            : { action: 'stop', reason: 'done' };
                    },
                },
                createId: prefix => `${prefix}_${mode}`,
                now: () => 1,
            });

            const result = await loop.run();
            expect(result.status).toBe(mode === 'completed' ? 'completed'
                : mode === 'failed' ? 'error' : 'incomplete');
            const assistantMessage = result.turns[0]?.assistantMessage;
            if (assistantMessage?.role !== 'assistant') throw new Error('expected an assistant turn');
            expect(assistantMessage.providerCompletion).toBe(
                mode === 'completed' ? 'tool_calls' : mode === 'incomplete' ? 'length' : undefined,
            );
            expect(executorCalls).toHaveLength(mode === 'completed' ? 1 : 0);
            expect(invoke).not.toHaveBeenCalled();
            expect(fallbacks).toEqual([]);
        },
    );
});

import { describe, expect, it, jest } from '@jest/globals';
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { ChatOpenAI, type ChatOpenAIFields } from '@langchain/openai';
import { TerraChatOpenAI } from '../src/ai-services/openai-responses-adapter';
import { PaAgentLoop } from '../src/ai-services/pa-agent-loop';
import { streamWithInvokeFallback } from '../src/ai-services/pa-agent-runtime';

const usage = { input_tokens: 4, output_tokens: 3, total_tokens: 7 };

function completedResponse(output: Array<Record<string, unknown>>) {
    return {
        id: 'resp_offline', object: 'response', created_at: 0, status: 'completed',
        model: 'gpt-6.1-terra', error: null, incomplete_details: null, instructions: null,
        metadata: {}, output, parallel_tool_calls: false, temperature: undefined, top_p: undefined,
        usage, output_text: output.some(item => item.type === 'message')
            ? 'final answer' : '',
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
    return new TerraChatOpenAI({
        model: 'gpt-6.1-terra',
        apiKey: 'offline-key',
        temperature: 0.8,
        maxTokens: 123,
        configuration: { baseURL: 'https://api.openai.com/v1', fetch: customFetch },
        ...(reasoning === undefined ? {} : { modelKwargs: { reasoning } }),
    });
}

describe('OpenAI gpt-6.1-terra Responses adapter', () => {
    it('sends official Responses parameters and replays canonical function calls by call_id', async () => {
        const bodies: Array<Record<string, unknown>> = [];
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
        const first = await model.invoke([new HumanMessage('read the note')]);
        expect(first.content).toBe('');
        const canonicalCall = first.tool_calls?.[0];
        expect(canonicalCall).toMatchObject({ id: 'call_offline', name: 'read_note' });
        const replayAssistant = new AIMessage({
            content: 'action context',
            tool_calls: [canonicalCall ?? { id: 'must-not', name: 'must-not', args: {} }],
        });
        expect(replayAssistant.response_metadata).toEqual({});
        expect(replayAssistant.additional_kwargs).toEqual({});
        const second = await model.invoke([
            new HumanMessage('read the note'),
            replayAssistant,
            new ToolMessage({ tool_call_id: 'call_offline', name: 'read_note', content: 'note evidence' }),
            new HumanMessage('answer with the evidence'),
        ]);

        expect(second.text).toBe('final answer');
        expect(second.content).toBe('final answer');
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
        expect(bodies[0].tools).toEqual([{
            type: 'function', name: 'read_note', description: 'Read a note', strict: false,
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        }]);
        expect(bodies[1].input).toEqual([
            { type: 'message', role: 'user', content: 'read the note' },
            { type: 'message', role: 'assistant', content: 'action context' },
            { type: 'function_call', call_id: 'call_offline', name: 'read_note', arguments: '{"path":"note.md"}' },
            { type: 'function_call_output', call_id: 'call_offline', output: 'note evidence' },
            { type: 'message', role: 'user', content: 'answer with the evidence' },
        ]);
    });

    it('maps completed streamed function calls from the terminal response', async () => {
        let requestBody: Record<string, unknown> | undefined;
        const fetcher = jest.fn<typeof fetch>(async (_url, init) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return sseResponse([
                { type: 'response.created', response: { id: 'resp_stream', model: 'gpt-6.1-terra' } },
                { type: 'response.output_item.added', output_index: 0, item: {
                    id: 'fc_offline', type: 'function_call', call_id: 'call_offline', name: 'read_note', arguments: '',
                } },
                { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"path":"note.md"}' },
                { type: 'response.completed', response: completedResponse(functionCallOutput()) },
            ]);
        });
        const chunks = [];
        for await (const chunk of await createModel(fetcher).stream('read the note')) chunks.push(chunk);
        const final = chunks.at(-1);
        expect(final?.tool_calls ?? final?.tool_call_chunks).toBeDefined();
        expect(final?.response_metadata).toMatchObject({ status: 'completed', finish_reason: 'tool_calls' });
        expect(requestBody).toMatchObject({ stream: true, reasoning: { effort: 'high' } });
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
        expect(requestBody).toMatchObject({
            reasoning: { effort: 'medium', summary: 'auto' },
        });
    });

    it('keeps streamed partial output visible, then rejects the incomplete terminal', async () => {
        const response = {
            ...completedResponse([...functionCallOutput(), {
                id: 'msg_partial', type: 'message', status: 'incomplete', role: 'assistant',
                content: [{ type: 'output_text', text: 'partial answer', annotations: [] }],
            }]),
            status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
        };
        const fetcher = jest.fn<typeof fetch>(async () => sseResponse([
            { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: 'partial answer' },
            { type: 'response.incomplete', response },
        ]));
        const chunks: AIMessageChunk[] = [];
        await expect((async () => {
            for await (const chunk of await createModel(fetcher).stream('answer')) chunks.push(chunk);
        })()).rejects.toMatchObject({
            name: 'OpenAIResponsesTerminalError', terminal: 'incomplete', completion: 'length',
        });
        expect(chunks[0].text).toBe('partial answer');
        expect(chunks.at(-1)?.response_metadata).toMatchObject({
            status: 'incomplete', finish_reason: 'length',
        });
        expect(chunks.filter(chunk => chunk.tool_calls?.length || chunk.tool_call_chunks?.length)).toEqual([]);
    });

    it('throws a structured failure for response.failed and missing terminal EOF', async () => {
        const failed = jest.fn<typeof fetch>(async () => sseResponse([
            { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'partial' },
            { type: 'response.failed', response: { ...completedResponse([]), status: 'failed',
                error: { code: 'server_error', message: 'Provider failed.' } } },
        ]));
        const failedText: string[] = [];
        await expect((async () => {
            for await (const chunk of await createModel(failed).stream('answer')) failedText.push(chunk.text);
        })()).rejects.toMatchObject({ name: 'OpenAIResponsesTerminalError', terminal: 'failed', code: 'server_error' });
        expect(failedText).toEqual(['partial']);

        const eof = jest.fn<typeof fetch>(async () => sseResponse([
            { type: 'response.created', response: { id: 'resp_eof', model: 'gpt-6.1-terra' } },
        ]));
        await expect((async () => {
            for await (const _chunk of await createModel(eof).stream('answer')) { /* consume */ }
        })()).rejects.toMatchObject({ name: 'OpenAIResponsesTerminalError', terminal: 'missing_terminal' });
    });

    it('rejects an incomplete invoke result with the actual provider reason', async () => {
        const response = {
            ...completedResponse(functionCallOutput()),
            status: 'incomplete', incomplete_details: { reason: 'content_filter' },
        };
        const fetcher = jest.fn<typeof fetch>(async () => jsonResponse(response));
        await expect(createModel(fetcher).invoke('answer')).rejects.toMatchObject({
            name: 'OpenAIResponsesTerminalError', terminal: 'incomplete', completion: 'content_filter',
        });
    });

    it('rejects a failed non-stream response with its structured provider error', async () => {
        const fetcher = jest.fn<typeof fetch>(async () => jsonResponse({
            ...completedResponse([]), status: 'failed',
            error: { code: 'rate_limited', message: 'Provider failed.' },
        }));
        await expect(createModel(fetcher).invoke('answer')).rejects.toMatchObject({
            name: 'OpenAIResponsesTerminalError', terminal: 'failed', code: 'rate_limited',
        });
    });

    it('rejects an aborted signal before physical dispatch', async () => {
        const fetcher = jest.fn<typeof fetch>(async () => new Response(null));
        const controller = new AbortController();
        controller.abort(new Error('user cancelled'));
        await expect(createModel(fetcher).invoke('answer', { signal: controller.signal }))
            .rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(['completed', 'incomplete'] as const)(
        'stops before tool execution only for a Terra incomplete terminal (%s)',
        async mode => {
            const executorCalls: string[] = [];
            const fallbacks: string[] = [];
            const terminalResponse = mode === 'completed'
                ? completedResponse(functionCallOutput())
                : {
                    ...completedResponse(functionCallOutput()),
                    status: 'incomplete' as const,
                    incomplete_details: { reason: 'max_output_tokens' },
                };
            const fetcher = jest.fn<typeof fetch>(async () => sseResponse([
                { type: 'response.output_item.added', output_index: 0, item: {
                    id: 'fc_offline', type: 'function_call', call_id: 'call_offline',
                    name: 'read_note', arguments: '',
                } },
                { type: 'response.function_call_arguments.delta', output_index: 0,
                    delta: '{"path":"note.md"}' },
                mode === 'completed'
                    ? { type: 'response.completed', response: terminalResponse }
                    : { type: 'response.incomplete', response: terminalResponse },
            ]));
            const terra = createModel(fetcher);
            const invoke = jest.fn(async () => {
                throw new Error('invoke fallback must not run');
            });
            const loop = new PaAgentLoop({
                runId: `run_${mode}`,
                userInput: 'read the note',
                model: {
                    stream: async function* (input) {
                        yield* streamWithInvokeFallback({
                            chain: {
                                stream: (_input: unknown, options?: { signal?: AbortSignal }) =>
                                    terra.stream('read the note', options),
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
                    afterTurn: () => ({ action: 'stop', status: 'completed', reason: 'done' }),
                },
                createId: prefix => `${prefix}_${mode}`,
                now: () => 1,
            });

            const result = await loop.run();
            expect(result.status).toBe(mode === 'completed' ? 'completed' : 'error');
            expect(executorCalls).toHaveLength(mode === 'completed' ? 1 : 0);
            expect(invoke).not.toHaveBeenCalled();
            expect(fallbacks).toEqual([]);
        },
    );
});

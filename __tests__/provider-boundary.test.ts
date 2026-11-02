import { describe, expect, it, jest } from '@jest/globals';
import type { ChatOpenAIFields } from '@langchain/openai';
import { PaAgentLoop, type PaAgentLoopOptions } from '../src/ai-services/pa-agent-loop';
import { streamWithInvokeFallback } from '../src/ai-services/pa-agent-runtime';
import { projectPaAgentActionHistory } from '../src/ai-services/pa-agent-action-history';
import { PaChatOpenAI } from '../src/ai-services/openai-responses-adapter';
import { createPaAgentHostPolicy } from '../src/ai-services/pa-agent-host-policy';
import { normalizeProviderToolCalls } from '../src/ai-services/provider-tool-call-normalization';
import type { AssistantMessagePart } from '../src/ai-services/chat-types';
import type { AgentEvent, AgentMessageUpdate } from '../src/ai-services/chat-types';
import { AgentEventEmitter } from '../src/ai-services/agent-runtime-primitives';
import type { LegacyAgentEvent } from '../src/ai-services/chat-types';
import { CanonicalToLegacyEventAdapter } from '../src/ai-services/pa-agent-stream-bridge';
import { NativeWritingCallCollector } from '../src/ai-services/native-writing-call';
import { isValidWritingContextHandle } from '../src/ai-services/writing-output';

type Protocol = 'responses' | 'chat-completions';
type Delivery = 'stream' | 'invoke';
type ChatToolCall = { index: number; id: string; type: 'function'; function: { name: string; arguments: string } };
type ToolCallPart = Extract<AssistantMessagePart, { type: 'toolCall' }>;
type ToolCallUpdate = Extract<AgentMessageUpdate, { kind: 'toolcall_start' | 'toolcall_delta' | 'toolcall_end' }>;

function isToolCallUpdate(update: AgentMessageUpdate): update is ToolCallUpdate {
    return update.kind === 'toolcall_start' || update.kind === 'toolcall_delta' || update.kind === 'toolcall_end';
}

const usage = { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 };

function createModel(protocol: Protocol, fetcher: typeof fetch, disableStreaming = false) {
    const fields: ChatOpenAIFields = {
        model: protocol === 'responses' ? 'gpt-6.1-terra' : 'custom-model',
        apiKey: 'offline-key',
        maxTokens: 123,
        configuration: { baseURL: 'https://provider.test/v1', fetch: fetcher },
        ...(disableStreaming ? { disableStreaming: true } : {}),
    };
    return new PaChatOpenAI(fields, protocol);
}

function jsonResponse(body: unknown) {
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function sseResponse(events: Array<Record<string, unknown>>) {
    const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function completedResponse(output: Array<Record<string, unknown>>) {
    return {
        id: 'resp_boundary', object: 'response', created_at: 0, status: 'completed',
        model: 'gpt-6.1-terra', error: null, incomplete_details: null, instructions: null,
        metadata: {}, output, parallel_tool_calls: false,
        usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 },
        output_text: '',
    };
}

function functionCall(callId: string, argumentsText: string, id = `fc_${callId}`) {
    return { id, type: 'function_call', status: 'completed', call_id: callId,
        name: 'list_vault_tags', arguments: argumentsText };
}

function responsesToolBody(delivery: Delivery) {
    const output = [functionCall('call_limit', '{"limit":1}'), functionCall('call_default', '{}')];
    if (delivery === 'invoke') return jsonResponse(completedResponse(output));
    return sseResponse([
        { type: 'response.output_item.added', output_index: 0, item: functionCall('call_limit', '', 'fc_limit') },
        { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"limit":1}' },
        { type: 'response.output_item.added', output_index: 1, item: functionCall('call_default', '', 'fc_default') },
        { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{}' },
        { type: 'response.completed', response: completedResponse(output) },
    ]);
}

function chatToolCall(index: number, callId: string, argumentsText = ''): ChatToolCall {
    return { index, id: callId, type: 'function',
        function: { name: 'list_vault_tags', arguments: argumentsText } };
}

function chatCompletion(toolCalls: ChatToolCall[]) {
    return {
        id: 'chat_boundary', object: 'chat.completion', created: 0, model: 'custom-model',
        choices: [{ index: 0, finish_reason: 'tool_calls',
            message: { role: 'assistant', content: '', tool_calls: toolCalls } }],
        usage,
    };
}

function chatToolBody(delivery: Delivery) {
    const toolCalls: ChatToolCall[] = [
        chatToolCall(0, 'call_limit', '{"limit":1}'),
        chatToolCall(1, 'call_default', '{}'),
    ];
    if (delivery === 'invoke') return jsonResponse(chatCompletion(toolCalls));
    return sseResponse([
        { id: 'chat_boundary', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
            choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', tool_calls: [chatToolCall(0, 'call_limit')] } }] },
        { id: 'chat_boundary', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
            choices: [{ index: 0, finish_reason: null, delta: { tool_calls: [{ index: 0, function: { arguments: '{"limit":1}' } }] } }] },
        { id: 'chat_boundary', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
            choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', tool_calls: [chatToolCall(1, 'call_default')] } }] },
        { id: 'chat_boundary', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
            choices: [{ index: 0, finish_reason: null, delta: { tool_calls: [{ index: 1, function: { arguments: '{}' } }] } }] },
        { id: 'chat_boundary', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
            choices: [{ index: 0, finish_reason: 'tool_calls', delta: {} }] },
    ]);
}

function refusalOutput() {
    return [{
        id: 'msg_refusal', type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'refusal', refusal: 'I cannot answer that request.' }],
    }];
}

function responsesRefusalBody(delivery: Delivery) {
    if (delivery === 'invoke') return jsonResponse(completedResponse(refusalOutput()));
    return sseResponse([
        { type: 'response.refusal.done', refusal: 'I cannot answer that request.' },
        { type: 'response.completed', response: completedResponse(refusalOutput()) },
    ]);
}

function chatRefusalBody(delivery: Delivery) {
    if (delivery === 'invoke') {
        return jsonResponse({
            id: 'chat_refusal', object: 'chat.completion', created: 0, model: 'custom-model',
            choices: [{ index: 0, finish_reason: 'stop',
                message: { role: 'assistant', content: '', refusal: 'I cannot answer that request.' } }],
            usage,
        });
    }
    return sseResponse([
        { id: 'chat_refusal', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
            choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', refusal: 'I cannot answer that request.' } }] },
        { id: 'chat_refusal', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
            choices: [{ index: 0, finish_reason: 'stop', delta: {} }] },
    ]);
}

function providerBody(protocol: Protocol, delivery: Delivery, kind: 'tools' | 'refusal') {
    if (kind === 'tools') return protocol === 'responses' ? responsesToolBody(delivery) : chatToolBody(delivery);
    return protocol === 'responses' ? responsesRefusalBody(delivery) : chatRefusalBody(delivery);
}

async function runProviderLoop(
    protocol: Protocol,
    delivery: Delivery,
    kind: 'tools' | 'refusal',
    responseBody?: Response,
) {
    let physicalRequests = 0;
    let streamSetupFailures = 0;
    const events: AgentEvent[] = [];
    const fetcher = jest.fn<typeof fetch>(async (_url, init) => {
        physicalRequests += 1;
        expect(init).toBeDefined();
        return responseBody ?? providerBody(protocol, delivery, kind);
    });
    const model = createModel(protocol, fetcher);
    const executions: Array<{ id: string; name: string; input: unknown }> = [];
    const result = await new PaAgentLoop({
        runId: `provider_${protocol}_${delivery}_${kind}`,
        userInput: kind === 'tools' ? 'List tags twice.' : 'Answer a refused question.',
        onEvent: event => events.push(event),
        hostPolicy: kind === 'tools' ? {
            afterTurn: summary => summary.status === 'tool_results_ready'
                ? { action: 'stop', status: 'completed', reason: 'done' }
                : { action: 'stop', reason: summary.status },
        } : createPaAgentHostPolicy(),
        model: {
            stream: async function* (input) {
                yield* streamWithInvokeFallback({
                    chain: {
                        stream: delivery === 'invoke'
                            ? async function* () {
                                streamSetupFailures += 1;
                                throw new Error('stream unavailable');
                            }
                            : (_input: unknown, options?: { signal?: AbortSignal }) =>
                                model.stream('provider boundary request', options),
                        invoke: (_input: unknown, options?: { signal?: AbortSignal }) =>
                            model.invoke('provider boundary request', options),
                    },
                    input: 'provider boundary request',
                    signal: input.signal,
                    prepareInvokeInput: () => 'provider boundary request',
                });
            },
        },
        toolExecutor: {
            execute: async ({ toolCall }) => {
                executions.push({ id: toolCall.id, name: toolCall.name, input: toolCall.input });
                return { outcome: 'success', promptText: `${toolCall.id}:observed` };
            },
        },
        now: () => 1,
    }).run();
    return { result, executions, events, physicalRequests, streamSetupFailures, fetcher };
}

describe('provider result boundary', () => {
    it.each([
        ['responses', 'stream'],
        ['responses', 'invoke'],
        ['chat-completions', 'stream'],
        ['chat-completions', 'invoke'],
    ] as const)('keeps legal same-name calls distinct (%s %s)', async (protocol, delivery) => {
        const { result, executions } = await runProviderLoop(protocol, delivery, 'tools');
        expect(result.status).toBe('completed');
        expect(executions).toEqual([
            { id: 'call_limit', name: 'list_vault_tags', input: { limit: 1 } },
            { id: 'call_default', name: 'list_vault_tags', input: {} },
        ]);
        const observedToolCalls = result.turns[0].toolCalls
            .filter((call): call is ToolCallPart => call.type === 'toolCall')
            .map(call => ({ id: call.id, name: call.name, input: call.input }));
        expect(observedToolCalls)
            .toEqual(delivery === 'stream'
                ? [
                    { id: 'call_limit', name: 'list_vault_tags', input: '{"limit":1}' },
                    { id: 'call_default', name: 'list_vault_tags', input: '{}' },
                ]
                : executions);
    });


    it.each(['responses', 'chat-completions'] as const)(
        'keeps a malformed invoke tool call visible without executing it (%s)',
        async protocol => {
            const toolCalls = protocol === 'responses'
                ? [functionCall('call_valid', '{"limit":1}'), functionCall('call_invalid', '{"limit":')]
                : [
                    chatToolCall(0, 'call_valid', '{"limit":1}') as ChatToolCall,
                    chatToolCall(1, 'call_invalid', '{"limit":') as ChatToolCall,
                ];
            const fetcher = jest.fn<typeof fetch>(async () => protocol === 'responses'
                ? jsonResponse(completedResponse(toolCalls))
                : jsonResponse(chatCompletion(toolCalls as ChatToolCall[])));
            const model = createModel(protocol, fetcher);
            const executions: string[] = [];
            const result = await new PaAgentLoop({
                runId: `malformed_${protocol}`,
                userInput: 'List tags.',
                hostPolicy: { afterTurn: summary => ({ action: 'stop', reason: summary.status }) },
                model: {
                    stream: async function* (input) {
                        yield* streamWithInvokeFallback({
                            chain: {
                                stream: async function* () { throw new Error('stream unavailable'); },
                                invoke: (_input: unknown, options?: { signal?: AbortSignal }) =>
                                    model.invoke('list tags', options),
                            },
                            input: 'list tags',
                            signal: input.signal,
                            prepareInvokeInput: () => 'list tags',
                        });
                    },
                },
                toolExecutor: {
                    execute: async ({ toolCall }) => {
                        executions.push(toolCall.id);
                        return { outcome: 'success', promptText: 'observed' };
                    },
                },
                now: () => 1,
            }).run();

            expect(result.turns[0].toolCalls
                .filter((call): call is ToolCallPart => call.type === 'toolCall')
                .map(call => ({ id: call.id, input: call.input })))
                .toEqual([
                    { id: 'call_valid', input: { limit: 1 } },
                    { id: 'call_invalid', input: '{"limit":' },
                ]);
            expect(executions).toEqual(['call_valid']);
            expect(result.turns[0].toolResults.some(result => result.content.metadata?.reason === 'invalid_tool_input'))
                .toBe(true);
        },
    );

    it.each(['responses', 'chat-completions'] as const)(
        'consumes one complete SDK stream result without fallback or duplicate consumption (%s)',
        async protocol => {
            const toolCalls = protocol === 'responses'
                ? [
                    functionCall('call_limit', '{"limit":1}'),
                    functionCall('call_default', '{}'),
                    functionCall('call_invalid', ''),
                    functionCall('call_invalid_nonobject', '[]'),
                ]
                : [
                    chatToolCall(0, 'call_limit', '{"limit":1}') as ChatToolCall,
                    chatToolCall(1, 'call_default', '{}') as ChatToolCall,
                    chatToolCall(2, 'call_invalid', '') as ChatToolCall,
                    chatToolCall(3, 'call_invalid_nonobject', '[]') as ChatToolCall,
                ];
            const body = protocol === 'responses'
                ? jsonResponse(completedResponse(toolCalls))
                : jsonResponse(chatCompletion(toolCalls as ChatToolCall[]));
            const fetcher = jest.fn<typeof fetch>(async () => body);
            const model = createModel(protocol, fetcher, true);
            const executions: string[] = [];
            const fallbacks: string[] = [];
            let fallbackInvokes = 0;
            const result = await new PaAgentLoop({
                runId: `complete_stream_${protocol}`,
                userInput: 'List tags three ways.',
                hostPolicy: {
                    afterTurn: summary => summary.status === 'tool_results_ready'
                        ? { action: 'stop', status: 'completed', reason: 'done' }
                        : { action: 'stop', reason: summary.status },
                },
                model: {
                    stream: async function* (input) {
                        yield* streamWithInvokeFallback({
                            chain: {
                                stream: (_input: unknown, options?: { signal?: AbortSignal }) =>
                                    model.stream('provider boundary request', options),
                                invoke: (_input: unknown, options?: { signal?: AbortSignal }) => {
                                    fallbackInvokes += 1;
                                    return model.invoke('provider boundary request', options);
                                },
                            },
                            input: 'provider boundary request',
                            signal: input.signal,
                            prepareInvokeInput: () => 'provider boundary request',
                            onFallback: reason => fallbacks.push(reason),
                        });
                    },
                },
                toolExecutor: {
                    execute: async ({ toolCall }) => {
                        executions.push(toolCall.id);
                        return { outcome: 'success', promptText: `${toolCall.id}:observed` };
                    },
                },
                now: () => 1,
            }).run();

            expect(result.status).toBe('completed');
            expect(fetcher).toHaveBeenCalledTimes(1);
            expect(fallbacks).toEqual([]);
            expect(fallbackInvokes).toBe(0);
            expect(executions).toEqual(['call_limit', 'call_default']);
            expect(result.turns[0].toolCalls
                .filter((call): call is ToolCallPart => call.type === 'toolCall')
                .map(call => ({ id: call.id, name: call.name, input: call.input })))
                .toEqual([
                    { id: 'call_limit', name: 'list_vault_tags', input: { limit: 1 } },
                    { id: 'call_default', name: 'list_vault_tags', input: {} },
                    { id: 'call_invalid_nonobject', name: 'list_vault_tags', input: '' },
                    { id: 'call_invalid', name: 'list_vault_tags', input: '' },
                ]);
            expect(result.turns[0].toolResults
                .filter(toolResult => toolResult.content.metadata?.outcome === 'success')
                .map(toolResult => toolResult.toolCallId))
                .toEqual(['call_limit', 'call_default']);
            for (const callId of ['call_invalid', 'call_invalid_nonobject']) {
                expect(result.turns[0].toolResults.find(toolResult =>
                    toolResult.toolCallId === callId)?.content.metadata)
                    .toMatchObject({
                        outcome: 'schema_invalid',
                        reason: 'invalid_tool_input',
                        parseError: 'Tool call arguments are invalid.',
                    });
            }
        },
    );

    it.each(['responses', 'chat-completions'] as const)(
        'marks complete parsed non-object arguments invalid without executing them (%s invoke)',
        async protocol => {
            const argumentTexts: Array<[id: string, argumentsText: string]> = [
                ['call_array', '[]'],
                ['call_null', 'null'],
                ['call_number', '7'],
                ['call_boolean', 'false'],
                ['call_string', JSON.stringify('{}')],
                ['call_valid', '{}'],
            ];
            const toolCalls = protocol === 'responses'
                ? argumentTexts.map(([callId, argumentsText]) => functionCall(callId, argumentsText))
                : argumentTexts.map(([callId, argumentsText], index) => (
                    chatToolCall(index, callId, argumentsText) as ChatToolCall
                ));
            const body = protocol === 'responses'
                ? jsonResponse(completedResponse(toolCalls))
                : jsonResponse(chatCompletion(toolCalls as ChatToolCall[]));
            const { result, executions } = await runProviderLoop(protocol, 'invoke', 'tools', body);

            expect(executions).toEqual([
                { id: 'call_valid', name: 'list_vault_tags', input: {} },
            ]);
            const invalidResults = result.turns[0].toolResults.filter(toolResult =>
                toolResult.toolCallId !== 'call_valid');
            expect(invalidResults.map(toolResult => toolResult.toolCallId)).toEqual([
                'call_array',
                'call_null',
                'call_number',
                'call_boolean',
                'call_string',
            ]);
            for (const invalidResult of invalidResults) {
                expect(invalidResult.content.metadata).toMatchObject({
                    outcome: 'schema_invalid',
                    reason: 'invalid_tool_input',
                });
            }
        },
    );

    it('suppresses parsed and raw complete mirrors when a stream value explicitly has fragments', () => {
        expect(normalizeProviderToolCalls({
            tool_call_chunks: [],
            tool_calls: [{ id: 'parsed', name: 'list_vault_tags', args: {} }],
            invalid_tool_calls: [{ id: 'invalid', name: 'list_vault_tags', args: '' }],
            additional_kwargs: {
                tool_calls: [{ id: 'raw', type: 'function', function: { name: 'list_vault_tags', arguments: '{}' } }],
            },
        }, 'stream')).toEqual({ kind: 'fragments', calls: [] });
    });

    it.each(['responses', 'chat-completions'] as const)(
        'preserves SDK-invalid empty arguments as schema-invalid (%s invoke)',
        async protocol => {
            const toolCalls = protocol === 'responses'
                ? [functionCall('call_valid', '{"limit":1}'), functionCall('call_invalid', '')]
                : [
                    chatToolCall(0, 'call_valid', '{"limit":1}') as ChatToolCall,
                    chatToolCall(1, 'call_invalid', '') as ChatToolCall,
                ];
            const body = protocol === 'responses'
                ? jsonResponse(completedResponse(toolCalls))
                : jsonResponse(chatCompletion(toolCalls as ChatToolCall[]));
            const { result, executions } = await runProviderLoop(protocol, 'invoke', 'tools', body);

            expect(executions).toEqual([
                { id: 'call_valid', name: 'list_vault_tags', input: { limit: 1 } },
            ]);
            const invalidResult = result.turns[0].toolResults.find(toolResult =>
                toolResult.toolCallId === 'call_invalid');
            expect(invalidResult?.content.metadata).toMatchObject({
                outcome: 'schema_invalid',
                reason: 'invalid_tool_input',
                parseError: 'Tool call arguments are invalid.',
            });
            expect(result.turns[0].toolCalls
                .filter((call): call is ToolCallPart => call.type === 'toolCall')
                .map(call => call.id)).toEqual(['call_valid', 'call_invalid']);
        },
    );

    it('merges a provider index introduced later on the same real call ID', async () => {
        const executions: unknown[] = [];
        const result = await new PaAgentLoop({
            runId: 'index_added_to_id',
            userInput: 'List tags.',
            hostPolicy: {
                afterTurn: summary => summary.status === 'tool_results_ready'
                    ? { action: 'stop', status: 'completed', reason: 'done' }
                    : { action: 'stop', reason: summary.status },
            },
            model: { stream: async function* () {
                yield { type: 'toolcall_delta', id: 'call_a', name: 'list_vault_tags', argsText: '{}' };
                yield { type: 'toolcall_delta', id: 'call_a', index: 3, name: '', argsText: '' };
                yield { type: 'provider_completion', completion: 'tool_calls' };
            } },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executions.push(toolCall.input);
                    return { outcome: 'success', promptText: 'observed' };
                },
            },
            now: () => 1,
        }).run();

        expect(result.status).toBe('completed');
        expect(executions).toEqual([{}]);
        expect(result.turns[0].diagnostics).not.toContainEqual({ type: 'tool_call_identity_conflict' });
    });

    it('keeps an ID-only call separate from an independent indexed call', async () => {
        const executions: string[] = [];
        const result = await new PaAgentLoop({
            runId: 'id_only_plus_indexed',
            userInput: 'List tags.',
            hostPolicy: {
                afterTurn: summary => summary.status === 'tool_results_ready'
                    ? { action: 'stop', status: 'completed', reason: 'done' }
                    : { action: 'stop', reason: summary.status },
            },
            model: { stream: async function* () {
                yield { type: 'toolcall_delta', id: 'call_id_only', name: 'list_vault_tags', argsText: '{}' };
                yield { type: 'toolcall_delta', id: 'call_indexed', index: 0, name: 'list_vault_tags', argsText: '{"limit":1}' };
                yield { type: 'provider_completion', completion: 'tool_calls' };
            } },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executions.push(toolCall.id);
                    return { outcome: 'success', promptText: 'observed' };
                },
            },
            now: () => 1,
        }).run();

        expect(result.status).toBe('completed');
        expect(executions).toEqual(['call_id_only', 'call_indexed']);
        expect(result.turns[0].diagnostics).not.toContainEqual({ type: 'tool_call_identity_conflict' });
    });

    it('assembles one anonymous stream header with a nameless continuation through the SDK adapter', async () => {
        const anonymousHeader = {
            type: 'function',
            function: { name: 'list_vault_tags', arguments: '' },
        };
        const body = sseResponse([
            { id: 'chat_anonymous', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
                choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', tool_calls: [anonymousHeader] } }] },
            { id: 'chat_anonymous', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
                choices: [{ index: 0, finish_reason: null, delta: { tool_calls: [{ function: { arguments: '{}' } }] } }] },
            { id: 'chat_anonymous', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
                choices: [{ index: 0, finish_reason: 'tool_calls', delta: {} }] },
        ]);
        const { result, executions, events } = await runProviderLoop('chat-completions', 'stream', 'tools', body);

        expect(result.status).toBe('completed');
        expect(executions).toHaveLength(1);
        expect(executions[0]).toMatchObject({ name: 'list_vault_tags', input: {} });
        expect(result.turns[0].toolCalls
            .filter((call): call is ToolCallPart => call.type === 'toolCall')
            .map(call => call.input)).toEqual(['{}']);
        const updates = events
            .filter((event): event is Extract<AgentEvent, { type: 'message_update' }> => event.type === 'message_update')
            .map(event => event.update)
            .filter(isToolCallUpdate);
        expect(updates).toHaveLength(3);
        expect(updates[0].kind).toBe('toolcall_start');
        expect(updates[1]).toMatchObject({ kind: 'toolcall_delta', text: '{}' });
        expect(updates[2].kind).toBe('toolcall_end');
        expect(new Set([
            updates[0].toolCallId,
            updates[1].toolCallId,
            updates[2].toolCallId,
        ]).size).toBe(1);
    });

    it.each([
        'delayed-id',
        'delayed-name',
    ] as const)('propagates a delayed Chat SDK header fact through one call lifecycle (%s)', async kind => {
        const first = kind === 'delayed-id'
            ? { index: 0, function: { name: 'read_note', arguments: '' } }
            : { index: 0, id: 'call_real', function: { arguments: '' } };
        const second = kind === 'delayed-id'
            ? { index: 0, id: 'call_real', function: { arguments: '{"path":"a.md"}' } }
            : { index: 0, function: { name: 'read_note', arguments: '{"path":"a.md"}' } };
        const body = sseResponse([
            { id: 'chat_delayed_header', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
                choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', tool_calls: [first] } }] },
            { id: 'chat_delayed_header', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
                choices: [{ index: 0, finish_reason: null, delta: { tool_calls: [second] } }] },
            { id: 'chat_delayed_header', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
                choices: [{ index: 0, finish_reason: 'tool_calls', delta: {} }] },
        ]);
        const { result, executions, events } = await runProviderLoop('chat-completions', 'stream', 'tools', body);
        const call = result.turns[0].toolCalls.find((part): part is ToolCallPart => part.type === 'toolCall');

        expect(result.status).toBe('completed');
        expect(executions).toEqual([
            { id: 'call_real', name: 'read_note', input: { path: 'a.md' } },
        ]);
        expect(call).toMatchObject({ id: 'call_real', name: 'read_note', input: '{"path":"a.md"}', index: 0 });
        const updates = events
            .filter((event): event is Extract<AgentEvent, { type: 'message_update' }> => event.type === 'message_update')
            .map(event => event.update)
            .filter(isToolCallUpdate);
        expect(updates).toEqual([
            { kind: 'toolcall_start', toolCallId: 'call_real', name: 'read_note', index: 0 },
            { kind: 'toolcall_delta', toolCallId: 'call_real', index: 0, text: '{"path":"a.md"}' },
            { kind: 'toolcall_end', toolCallId: 'call_real', index: 0 },
        ]);
        const projected = projectPaAgentActionHistory(result.transcript);
        expect(projected).toHaveLength(1);
        expect(projected[0].calls).toHaveLength(1);
        expect(projected[0].calls[0]).toMatchObject({ id: 'call_real', name: 'read_note' });
        expect(projected[0].calls[0].results).toHaveLength(1);
    });

    it('keeps complete anonymous invoke entries distinct', async () => {
        const toolCalls = [
            { type: 'function', id: '', function: { name: 'list_vault_tags', arguments: '{"limit":1}' } },
            { type: 'function', id: '', function: { name: 'list_vault_tags', arguments: '{}' } },
        ];
        const body = jsonResponse(chatCompletion(toolCalls as ChatToolCall[]));
        const { result, executions } = await runProviderLoop('chat-completions', 'invoke', 'tools', body);

        expect(result.status).toBe('completed');
        expect(executions.map(({ input }) => input)).toEqual([{ limit: 1 }, {}]);
        expect(result.turns[0].toolCalls).toHaveLength(2);
    });

    it.each(['{"path":', 'null', '   '] as const)(
        'keeps nonempty raw arguments authoritative over a structured mirror (%s)',
        async argsText => {
            const executions: unknown[] = [];
            const result = await new PaAgentLoop({
                runId: `raw_authoritative_${argsText.length}`,
                userInput: 'Read a note.',
                model: { stream: async function* () {
                    yield { type: 'toolcall_delta', id: 'call_raw', name: 'list_vault_tags',
                        argsText, input: { path: 'a.md' } };
                    yield { type: 'provider_completion', completion: 'tool_calls' };
                } },
                toolExecutor: {
                    execute: async ({ toolCall }) => {
                        executions.push(toolCall.input);
                        return { outcome: 'success', promptText: 'must not run' };
                    },
                },
                now: () => 1,
            }).run();

            expect(executions).toEqual([]);
            expect(result.turns[0].toolResults.some(toolResult =>
                toolResult.content.metadata?.reason === 'invalid_tool_input')).toBe(true);
        },
    );

    it('does not execute contradictory provider identities as one merged call', async () => {
        const executions: string[] = [];
        const result = await new PaAgentLoop({
            runId: 'contradictory_tool_identity',
            userInput: 'List tags.',
            model: { stream: async function* () {
                yield { type: 'toolcall_delta', id: 'call_a', index: 0, name: 'list_vault_tags', argsText: '{}' };
                yield { type: 'toolcall_delta', id: 'call_b', index: 0, name: 'list_vault_tags', argsText: '{}' };
                yield { type: 'provider_completion', completion: 'tool_calls' };
            } },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executions.push(toolCall.id);
                    return { outcome: 'success', promptText: 'must not run' };
                },
            },
            now: () => 1,
        }).run();

        expect(result.status).toBe('incomplete');
        expect(executions).toEqual([]);
        expect(result.endPayload?.diagnostics).toContainEqual({ type: 'tool_call_identity_conflict' });
        expect(result.turns[0].toolCalls
            .filter((call): call is ToolCallPart => call.type === 'toolCall')
            .map(call => call.id)).toEqual(['call_a', 'call_b']);
    });

    it.each([
        ['responses', 'stream'],
        ['responses', 'invoke'],
        ['chat-completions', 'stream'],
        ['chat-completions', 'invoke'],
    ] as const)('preserves refusal explanation as an incomplete result (%s %s)', async (protocol, delivery) => {
        const { result, physicalRequests, streamSetupFailures } = await runProviderLoop(protocol, delivery, 'refusal');

        expect(physicalRequests).toBe(1);
        expect(streamSetupFailures).toBe(delivery === 'invoke' ? 1 : 0);
        expect(result.status).toBe('incomplete');
        expect(result.committedFinalText).toBe('I cannot answer that request.');
        expect(result.turns[0].assistantMessage.content).toEqual([
            { type: 'text', text: 'I cannot answer that request.' },
        ]);
        expect(result.endPayload?.diagnostics).toContainEqual({ type: 'provider_refusal' });
        expect(result.endPayload?.warnings).toContainEqual({ type: 'provider_refusal' });
    });

    it('preserves exact Chat Completions refusal fragments from the installed SDK', async () => {
        const fragments = ['I', ' ', 'cannot'];
        const body = sseResponse([
            ...fragments.map(refusal => ({
                id: 'chat_refusal_fragments', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
                choices: [{ index: 0, finish_reason: null, delta: { refusal } }],
            })),
            { id: 'chat_refusal_fragments', object: 'chat.completion.chunk', created: 0, model: 'custom-model',
                choices: [{ index: 0, finish_reason: 'stop', delta: {} }] },
        ]);
        const { result } = await runProviderLoop('chat-completions', 'stream', 'refusal', body);
        const assistantMessage = result.turns[0].assistantMessage;
        if (assistantMessage.role !== 'assistant') throw new Error('expected an assistant message');

        expect(result.committedFinalText).toBe('I cannot');
        expect(assistantMessage.providerRefusal).toBe('I cannot');
    });

    it('does not commit a mixed refusal answer when final text sources changed', async () => {
        const committed: string[] = [];
        const executions: string[] = [];
        const result = await new PaAgentLoop({
            runId: 'refusal_tool_source_changed',
            userInput: 'Answer and list tags.',
            isFinalTextCurrent: () => false,
            onCommittedFinalText: snapshot => committed.push(snapshot),
            model: { stream: async function* () {
                yield { type: 'refusal_delta', text: 'I cannot answer that request.' };
                yield { type: 'toolcall_delta', id: 'call_tags', name: 'list_vault_tags', argsText: '{}' };
                yield { type: 'provider_completion', completion: 'tool_calls' };
            } },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executions.push(toolCall.id);
                    return { outcome: 'success', promptText: 'must not run' };
                },
            },
            now: () => 1,
        }).run();

        expect(committed.filter(snapshot => snapshot.length > 0)).toEqual([]);
        expect(result.committedFinalText).toBe('');
        expect(executions).toEqual([]);
        expect(result.endPayload?.diagnostics).toEqual(expect.arrayContaining([
            { type: 'provider_refusal' },
            expect.objectContaining({ type: 'assistant_source_changed' }),
        ]));
    });

    it('does not commit a mixed refusal Writing candidate when native sources changed', async () => {
        const committed: string[] = [];
        const events: LegacyAgentEvent[] = [];
        const contextHandle = 'run:writing:refusal-source';
        const adapter = new CanonicalToLegacyEventAdapter(
            new AgentEventEmitter(event => events.push(event)),
            undefined,
            { request: { requestId: 'refusal-source' }, nativeContextHandle: contextHandle,
                maxTextChars: 10_000, isCurrent: () => false },
        );
        const execute = jest.fn<NonNullable<PaAgentLoopOptions['toolExecutor']>['execute']>();
        const result = await new PaAgentLoop({
            runId: 'refusal_writing_source_changed',
            userInput: 'Write a refused draft.',
            nativeWriting: {
                contextHandle,
                maxTextChars: 10_000,
                isCurrent: () => false,
                isValidContextHandle: isValidWritingContextHandle,
                createCollector: (handle, maxTextChars) => new NativeWritingCallCollector(handle, maxTextChars),
                outputName: 'present_writing',
                finalizationInstruction: 'Produce present_writing.',
                correctionInstruction: 'Correct present_writing.',
                strategyChangeInstruction: 'Change strategy.',
            },
            onEvent: event => adapter.handle(event),
            onCommittedFinalText: snapshot => {
                committed.push(snapshot);
                adapter.syncCommittedAnswer(snapshot);
            },
            model: { stream: async function* () {
                yield { type: 'refusal_delta', text: 'I cannot write that request.' };
                yield {
                    type: 'toolcall_delta', id: 'call_writing', index: 0, name: 'present_writing',
                    input: { contextHandle, body: 'Must not become an artifact.', explanation: 'Must not become an artifact.' },
                    providerIdentity: { id: 'call_writing', index: 0, name: 'present_writing' },
                };
                yield { type: 'provider_completion', completion: 'tool_calls' };
            } },
            toolExecutor: { execute },
            now: () => 1,
        }).run();

        expect(committed.filter(snapshot => snapshot.length > 0)).toEqual([]);
        expect(result.committedFinalText).toBe('');
        expect(execute).not.toHaveBeenCalled();
        expect(events.some(event => event.kind === 'answer-snapshot' && event.snapshot.length > 0)).toBe(false);
        expect(events.some(event => event.kind === 'writing-artifact' || event.kind === 'writing-recovery'))
            .toBe(false);
        expect(result.endPayload?.diagnostics).toEqual(expect.arrayContaining([
            { type: 'provider_refusal' },
            expect.objectContaining({ type: 'assistant_source_changed' }),
        ]));
    });

    it.each([
        ['missing-terminal', undefined],
        ['incomplete-terminal', 'length' as const],
    ])('does not commit an unfinished refusal stream (%s)', async (label, completion) => {
        const committed: string[] = [];
        const executions: string[] = [];
        const result = await new PaAgentLoop({
            runId: `refusal_${label}`,
            userInput: 'Answer a refused question.',
            onCommittedFinalText: snapshot => committed.push(snapshot),
            model: { stream: async function* () {
                yield { type: 'refusal_delta', text: 'I cannot answer that request.' };
                if (completion) yield { type: 'provider_completion', completion };
            } },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executions.push(toolCall.id);
                    return { outcome: 'success', promptText: 'must not run' };
                },
            },
            now: () => 1,
        }).run();

        expect(committed.filter(snapshot => snapshot.length > 0)).toEqual([]);
        expect(result.committedFinalText).toBe('');
        expect(executions).toEqual([]);
        expect(result.status).toBe('incomplete');
        expect(result.endPayload?.diagnostics).toEqual(expect.arrayContaining([
            { type: 'provider_refusal' },
            completion === undefined
                ? { type: 'provider_completion_missing' }
                : { type: 'provider_incomplete', completion },
        ]));
    });

    it.each([
        ['missing-terminal', undefined],
        ['incomplete-terminal', 'length' as const],
    ])('does not commit a conflicted refusal stream without actual completion (%s)', async (label, completion) => {
        const committed: string[] = [];
        const executions: string[] = [];
        let modelTurns = 0;
        const result = await new PaAgentLoop({
            runId: `refusal_conflict_${label}`,
            userInput: 'Answer a refused question.',
            onCommittedFinalText: snapshot => committed.push(snapshot),
            model: { stream: async function* () {
                modelTurns += 1;
                yield { type: 'refusal_delta', text: 'I cannot answer that request.' };
                yield { type: 'toolcall_delta', id: 'call_a', index: 0, name: 'list_vault_tags', argsText: '{}' };
                yield { type: 'toolcall_delta', id: 'call_b', index: 0, name: 'list_vault_tags', argsText: '{}' };
                if (completion) yield { type: 'provider_completion', completion };
            } },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executions.push(toolCall.id);
                    return { outcome: 'success', promptText: 'must not run' };
                },
            },
            now: () => 1,
        }).run();

        expect(modelTurns).toBe(1);
        expect(committed.filter(snapshot => snapshot.length > 0)).toEqual([]);
        expect(result.committedFinalText).toBe('');
        expect(executions).toEqual([]);
        expect(result.status).toBe('incomplete');
        expect(result.endPayload?.diagnostics).toEqual(expect.arrayContaining([
            { type: 'provider_refusal' },
            { type: 'tool_call_identity_conflict' },
        ]));
    });

    it('does not schedule provider recovery after refusal is followed by transport failure', async () => {
        let modelTurns = 0;
        const executions: string[] = [];
        const committed: string[] = [];
        const result = await new PaAgentLoop({
            runId: 'refusal_then_transport_failure',
            userInput: 'Answer a refused question.',
            model: { stream: async function* () {
                modelTurns += 1;
                yield { type: 'refusal_delta', text: 'I cannot answer that request.' };
                throw Object.assign(new Error('transport failed after refusal'), { code: 'ECONNRESET' });
            } },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executions.push(toolCall.id);
                    return { outcome: 'success', promptText: 'must not run' };
                },
            },
            onCommittedFinalText: snapshot => committed.push(snapshot),
            now: () => 1,
        }).run();

        expect(modelTurns).toBe(1);
        expect(executions).toEqual([]);
        expect(committed.filter(snapshot => snapshot.length > 0)).toEqual([]);
        expect(result.committedFinalText).toBe('');
        expect(result.status).toBe('incomplete');
        expect(result.endPayload?.diagnostics).toEqual([
            { type: 'provider_refusal' },
            expect.objectContaining({ type: 'provider_error', retryable: true }),
        ]);
    });
});

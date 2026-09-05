import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from '@jest/globals';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { CallbackManager } from '@langchain/core/callbacks/manager';
import { ChatOpenAI } from '@langchain/openai';

const runnerSource = readFileSync(resolve(__dirname, '../scripts/context-continuity-smoke-runner.js'), 'utf8');
const summaryText = JSON.stringify({
    goals: [], constraints: [{ text: 'Synthetic requirement only.', sourceMessages: [1] }],
    decisions: [], completed: [], open_questions: [], facts: [],
});
const semanticBlock = `<conversation_summary context_only="true" format="json">\n${summaryText}\n</conversation_summary>`;

const syntheticTool = { type: 'function' as const, function: {
    name: 'synthetic_tool', description: 'Synthetic test only.', parameters: { type: 'object', properties: {} },
} };

function offlineModel(response: string, callbacks?: any, recordRequest?: (body: any) => void, failStream = false) {
    // Exercise the installed ChatOpenAI, including its real bindTools/withConfig
    // clone and transform paths. The injected fetch never opens a network socket.
    return new ChatOpenAI({
        model: 'synthetic-model', apiKey: 'sk-private-secret', maxRetries: 0, callbacks,
        configuration: { baseURL: 'https://private-endpoint.invalid/v1', fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            recordRequest?.(body);
            if (failStream && body.stream) return new Response(JSON.stringify({ error: {
                message: 'Synthetic stream failure before output.', type: 'synthetic_error',
            } }), { status: 400, headers: { 'content-type': 'application/json' } });
            const common = { id: 'synthetic-completion', created: 0, model: 'synthetic-model' };
            const data = body.stream
                ? `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{
                    index: 0, delta: { role: 'assistant', content: response }, finish_reason: 'stop',
                }] })}\n\ndata: [DONE]\n\n`
                : JSON.stringify({ ...common, object: 'chat.completion', choices: [{
                    index: 0, message: { role: 'assistant', content: response }, finish_reason: 'stop',
                }] });
            return new Response(data, { headers: { 'content-type': body.stream ? 'text/event-stream' : 'application/json' } });
        } },
    });
}

function harness(mode: 'lossless' | 'semantic' | 'unused-summary' | 'error' = 'lossless', callbackManager = false,
    options: { rebind?: boolean; fallback?: boolean } = {}) {
    const streamOptions: any[] = [];
    const histories: any[] = [];
    const providerRequests: any[] = [];
    let modelInvocations = 0;
    const settings = {
        aiProvider: 'synthetic-provider', chatModelName: 'synthetic-model',
        baseURL: 'https://private-endpoint.invalid/v1', apiKey: 'sk-private-secret',
        memoryEnabled: true, skillContextEnabled: true,
    };
    const plugin = {
        settings,
        createChatService() {
            const service: any = {
                host: { settings, app: { vault: {} } },
                aiUtils: { createChatModel: async (temperature: number) => offlineModel(
                    temperature === 0 ? summaryText : '{"synthetic":true}',
                    callbackManager
                        ? CallbackManager.fromHandlers({ handleChatModelStart: () => { modelInvocations++; } })
                        : [{ name: 'existing-synthetic-observer', handleChatModelStart: () => { modelInvocations++; } }],
                    (body) => providerRequests.push(body), temperature !== 0 && options.fallback,
                ) },
                contextSummarizer: {
                    async prepareHistory(input: any) {
                        const response = await input.invoke({
                            messages: [{ role: 'system', content: 'Summary must be at most 1500 characters.' },
                                { role: 'user', content: JSON.stringify({ sourceMessages: [{ index: 1, start: 0, end: 4, content: 'test' }] }) }],
                            maxOutputTokens: 300,
                        }, input.signal);
                        return { text: response.content, sourceMessages: input.history };
                    },
                    async prepareTool(input: any) {
                        const response = await input.invoke({
                            messages: [{ role: 'system', content: 'Summary must be at most 1500 characters.' },
                                { role: 'user', content: JSON.stringify({ sourceMessages: [{ index: 1, content: 'synthetic tool' }] }) }],
                            maxOutputTokens: 300,
                        }, input.signal);
                        return { text: response.content, source: input.source };
                    },
                },
                async streamLLM(_prompt: string, onChunk: (text: string) => void, signal: AbortSignal, history: any[], turnOptions: any) {
                    streamOptions.push(turnOptions);
                    histories.push(JSON.parse(JSON.stringify(history)));
                    expect(service.host.settings.memoryEnabled).toBe(false);
                    expect(service.host.settings.skillContextEnabled).toBe(false);
                    expect(service.host.app.vault.getMarkdownFiles()).toEqual([]);
                    expect(() => service.host.app.vault.read()).toThrow('Synthetic evaluation blocks vault access and writes.');
                    if (mode === 'error') throw new Error(`Provider ${settings.baseURL} rejected Bearer ${settings.apiKey}`);
                    if (mode === 'semantic' || mode === 'unused-summary') {
                        await service.contextSummarizer.prepareHistory({ history, historyBudgetChars: turnOptions.historyBudgetChars, signal,
                            invoke: async (request: any, summarySignal: AbortSignal) => {
                                const model = await service.aiUtils.createChatModel(0, { maxTokens: request.maxOutputTokens });
                                return model.invoke(request.messages, { signal: summarySignal });
                            } });
                    }
                    const material = mode === 'semantic' ? semanticBlock
                        : `<chat_history context_only="true" format="json">\n${JSON.stringify([{ role: 'user', content: {
                            encoding: 'adjacent-repeats-v1', segments: [{ text: 'synthetic repeat.', count: 2 }],
                        } }], null, 2)}\n</chat_history>`;
                    const model: ChatOpenAI = await service.aiUtils.createChatModel(0.8);
                    const bound = model.bindTools([syntheticTool]);
                    if (!(bound instanceof ChatOpenAI)) throw new Error('Expected the installed ChatOpenAI binding to return a model clone.');
                    const runnable = options.rebind ? bound.bindTools([syntheticTool]) : bound;
                    const chain = ChatPromptTemplate.fromMessages([
                        ['system', 'Static system instructions.'], ['human', '{input}'],
                    ]).pipe(runnable);
                    const input = { input: `Recent chat history:\n${material}` };
                    let answer = '';
                    try {
                        for await (const chunk of await chain.stream(input, { signal })) {
                            answer += chunk.content;
                        }
                    } catch (error) {
                        if (!options.fallback) throw error;
                        answer = (await chain.invoke(input, { signal })).content as string;
                    }
                    onChunk(answer);
                    turnOptions.onLifecycleEvent({ type: 'turn_end', metadata: { metrics: [{
                        type: 'context_projection', historyBudgetChars: turnOptions.historyBudgetChars ?? 60_000,
                        historyCompaction: { semanticSummaryUsed: mode === 'semantic', semanticSummaryChars: mode === 'semantic' ? summaryText.length : 0 },
                    }] } });
                },
                dispose() {},
            };
            return service;
        },
    };
    const sandbox: any = {
        app: { vault: { getName: () => 'test' }, plugins: { plugins: { 'personal-assistant': plugin } } },
        crypto: webcrypto, TextEncoder, AbortController, setTimeout, clearTimeout,
    };
    runInNewContext(runnerSource, sandbox);
    return { evaluation: sandbox.__b128ContextEval, streamOptions, histories, settings, providerRequests,
        modelInvocations: () => modelInvocations };
}

describe('context continuity synthetic runner', () => {
    it('does no model work on load and preserves default budgets, fixtures, and manual semantic review', async () => {
        const app = harness();
        expect(app.modelInvocations()).toBe(0);
        expect(app.evaluation.cases.map((item: any) => item.id)).toEqual([
            'early-constraints', 'latest-correction', 'completed-and-pending', 'unknown-and-assumption', 'revoked-permission',
        ]);
        const history = app.evaluation.fixture('early-constraints');
        expect(history).toHaveLength(28);
        expect(history[0].content).toContain('输出为 UTF-8 CSV；每天最多生成 7 个文件');
        const report = await app.evaluation.start({ arms: ['candidate'] });
        expect(report.results.map((result: any) => result.id)).toEqual([
            'early-constraints', 'latest-correction', 'completed-and-pending', 'unknown-and-assumption', 'revoked-permission',
            'incremental-1', 'incremental-2', 'incremental-3', 'tool-middle-evidence',
        ]);
        expect(app.streamOptions).toHaveLength(8);
        expect(app.streamOptions.every((options) => !Object.prototype.hasOwnProperty.call(options, 'historyBudgetChars'))).toBe(true);
        expect(report.semanticVerdict).toBe('requires_human_review');
        expect(report.status).toBe('recorded_for_review');
        expect(report.results[0].pathEvidence).toMatchObject({
            actualBudgetChars: 60_000, observed: 'full_lossless_history', required: null, status: 'not_required',
        });
        expect(report.modelCalls).toBe(10);
        expect(app.modelInvocations()).toBe(report.modelCalls);
        expect(app.providerRequests.filter((body) => body.stream).every((body) => body.tools[0].function.name === 'synthetic_tool')).toBe(true);
        expect(app.settings.memoryEnabled).toBe(true);
        expect(app.settings.skillContextEnabled).toBe(true);
        expect(JSON.stringify(report)).not.toContain('private-endpoint');
        expect(JSON.stringify(report)).not.toContain('sk-private-secret');
    });

    it.each([false, true])('passes a budget across incremental turns, captures real pipe inputs and preserves callbacks manager=%s', async (callbackManager) => {
        const app = harness('semantic', callbackManager);
        const report = await app.evaluation.start({ cases: [], arms: ['candidate'], toolSummary: false,
            historyBudgetChars: 6000, requireSemanticHistory: true });
        expect(app.streamOptions).toHaveLength(3);
        expect(app.streamOptions.every((options) => options.historyBudgetChars === 6000)).toBe(true);
        for (const result of report.results) {
            expect(result.status).toBe('recorded_for_review');
            expect(result.requestedHistoryBudgetChars).toBe(6000);
            expect(result.pathEvidence).toMatchObject({
                required: 'semantic_history', observed: 'semantic_history', actualBudgetChars: 6000,
                status: 'observed_requires_semantic_review', summaryModelCalls: 1, appliedSummaryChars: summaryText.length,
            });
            const request = result.modelRequests.find((item: any) => item.kind === 'answer');
            expect(request.inputEvidence.historyBlocks).toEqual([{
                kind: 'conversation_summary', text: semanticBlock, chars: semanticBlock.length, truncated: false,
                sha256: createHash('sha256').update(semanticBlock).digest('hex'),
            }]);
        }
        expect(app.histories[1]).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', content: '{"synthetic":true}' }),
        ]));
        expect(report.semanticVerdict).toBe('requires_human_review');
        expect(report.modelCalls).toBe(6);
        expect(app.modelInvocations()).toBe(6);
        expect(app.providerRequests).toHaveLength(6);
    });

    it.each([false, true])('preserves observers and tool binding across real ChatOpenAI rebinding and invoke fallback manager=%s', async (callbackManager) => {
        const app = harness('semantic', callbackManager, { rebind: true, fallback: true });
        const report = await app.evaluation.start({ cases: ['early-constraints'], arms: ['candidate'],
            incremental: false, toolSummary: false, historyBudgetChars: 6000, requireSemanticHistory: true });
        expect(report.status).toBe('recorded_for_review');
        expect(report.results[0].actual).toBe('{"synthetic":true}');
        expect(report.results[0].pathEvidence.status).toBe('observed_requires_semantic_review');
        const answers = report.results[0].modelRequests.filter((request: any) => request.kind === 'answer');
        expect(answers).toHaveLength(2);
        expect(answers.every((request: any) => request.inputEvidence.historyBlocks[0].text === semanticBlock)).toBe(true);
        expect(app.providerRequests.map((body) => body.stream === true)).toEqual([false, true, false]);
        expect(app.providerRequests.slice(1).every((body) => body.tools[0].function.name === 'synthetic_tool')).toBe(true);
        expect(report.modelCalls).toBe(3);
        expect(app.modelInvocations()).toBe(3);
    });

    it('reproduces why a stream/invoke-only proxy misses RunnableSequence streaming', async () => {
        let intercepted = 0;
        const model = offlineModel('synthetic');
        const oldProxy = new Proxy(model, {
            get(target, property) {
                const value = Reflect.get(target, property, target);
                if ((property === 'stream' || property === 'invoke') && typeof value === 'function') {
                    return (...args: unknown[]) => { intercepted++; return value.apply(target, args); };
                }
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const chain = ChatPromptTemplate.fromMessages([['human', '{input}']]).pipe(oldProxy);
        let output = '';
        for await (const chunk of await chain.stream({ input: 'synthetic input' })) output += chunk.content;
        expect(output).toBe('synthetic');
        expect(intercepted).toBe(0);
    });

    it.each(['lossless', 'unused-summary'] as const)('does not accept a requested semantic path when %s was sent', async (mode) => {
        const app = harness(mode);
        const report = await app.evaluation.start({ cases: ['early-constraints'], arms: ['candidate'],
            incremental: false, toolSummary: false, historyBudgetChars: 6000, requireSemanticHistory: true });
        expect(report.status).toBe('path_not_observed');
        expect(report.results[0].status).toBe('path_not_observed');
        expect(report.results[0].pathEvidence).toMatchObject({
            required: 'semantic_history', observed: 'full_lossless_history', status: 'not_observed',
            summaryModelCalls: mode === 'unused-summary' ? 1 : 0,
        });
        expect(report.semanticVerdict).toBe('requires_human_review');
    });

    it('rejects invalid options before creating model work and redacts provider errors', async () => {
        const app = harness('error');
        for (const historyBudgetChars of [0, -1, 1.5, Infinity, NaN]) {
            await expect(app.evaluation.start({ historyBudgetChars })).rejects.toThrow('positive safe integer');
        }
        expect(app.modelInvocations()).toBe(0);
        const report = await app.evaluation.start({ cases: ['early-constraints'], arms: ['candidate'], incremental: false, toolSummary: false });
        expect(report.results[0].status).toBe('error');
        expect(report.results[0].error).toContain('[redacted-url]');
        expect(JSON.stringify(report)).not.toContain('private-endpoint');
        expect(JSON.stringify(report)).not.toContain('sk-private-secret');
    });
});

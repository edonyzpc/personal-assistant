import { AIUtils } from '../src/ai-services/ai-utils';
import { PaAgentContextManager } from '../src/ai-services/context/PaAgentContextManager';
import { PaAgentContextSummarizer } from '../src/ai-services/context/PaAgentContextSummarizer';
import type { ChatMessage } from '../src/ai-services/chat-types';
import { buildPaAgentFinalMessages, formatToolObservations,
    measurePaAgentRequestEnvelope } from '../src/ai-services/pa-agent-prompts';
import { estimateApproximateTokens } from '../src/token-estimate';
import { PaAgentRunUsageLedger } from '../src/ai-services/agent-usage-ledger';
import { createAgentDebugCall } from '../src/ai-services/agent-debug-observation';
import { createPaAgentAuxiliarySummaryBudget } from '../src/ai-services/pa-agent-runtime';

jest.mock('obsidian');

type Policy = 'no_auxiliary' | 'existing' | 'candidate';
const EMPTY_SUMMARY = { goals: [], constraints: [], decisions: [], completed: [], open_questions: [], facts: [] };

function fixture(turns: number, words: number): ChatMessage[] {
    return Array.from({ length: turns }, (_, turn): ChatMessage[] => [
        { role: 'user', content: turn === 0
            ? `Export must remain offline. ${Array.from({ length: words }, (_, i) => `user-${turn}-${i}`).join(' ')}`
            : `Question ${turn}. ${Array.from({ length: words }, (_, i) => `user-${turn}-${i}`).join(' ')}` },
        { role: 'assistant', content: `Answer ${turn}. ${Array.from({ length: words }, (_, i) => `answer-${turn}-${i}`).join(' ')}` },
    ]).flat();
}

function project(history: ChatMessage[], maxHistoryChars: number,
    summary?: Awaited<ReturnType<PaAgentContextSummarizer['prepareHistory']>>) {
    return new PaAgentContextManager().forPrompt({
        prompt: 'Compare the material; preserve the offline export constraint.',
        chatHistory: history, transcript: [], turnIndex: 0, availableSkills: 'None', toolDefinitions: 'None',
        maxHistoryChars, maxPromptChars: 120_000, maxObservationChars: 64_000,
        formatToolObservations,
        ...(summary ? { summaries: { history: summary } } : {}),
        measurePromptEnvelope: parts => measurePaAgentRequestEnvelope({
            input: parts.input, available_skills: parts.availableSkills, tool_definitions: parts.toolDefinitions,
            tool_observations: parts.toolObservations, operations_guidance: 'No writable capabilities are bound.',
        }, [], buildPaAgentFinalMessages(parts.input, parts.actionHistory, 'native')),
    });
}

function fixedSummaryContent(userBody: string): string {
    const source = JSON.parse(userBody) as {
        previousSummary?: { constraints: Array<{ text: string; sourceMessages: number[] }>;
            open_questions: Array<{ text: string; sourceMessages: number[] }> };
        sourceMessages: Array<{ index: number }>;
    };
    const constraints = source.previousSummary?.constraints.length
        ? source.previousSummary.constraints
        : [{ text: 'Export must remain offline.', sourceMessages: [source.sourceMessages[0].index] }];
    const latestUser = source.sourceMessages.filter(message => message.index > 1 && message.index % 2 === 1)
        .at(-1)?.index;
    const open_questions = latestUser
        ? [{ text: `Question ${(latestUser - 1) / 2}.`, sourceMessages: [latestUser] }]
        : source.previousSummary?.open_questions ?? [];
    return JSON.stringify({ ...EMPTY_SUMMARY, constraints, open_questions });
}

describe('B-149 T-11 fixed offline pressure comparison', () => {
    it('compares the same small, medium and long sources across three auxiliary policies through SDK HTTP', async () => {
        const realFetch = globalThis.fetch;
        const settings = { aiProvider: 'qwen', chatModelName: 'deepseek-v4-pro',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };
        const aiUtils = new AIUtils({ settings, getAPIToken: async () => 'offline-token', log: () => undefined } as never);
        const measurements: Array<Record<string, unknown>> = [];
        try {
            for (const tier of [
                { name: 'small', history: fixture(2, 8), maxHistoryChars: 60_000 },
                { name: 'medium', history: fixture(12, 28), maxHistoryChars: 3_000 },
                { name: 'long', history: fixture(12, 180), maxHistoryChars: 3_000 },
            ]) for (const policy of ['no_auxiliary', 'existing', 'candidate'] as Policy[]) {
                const bodies: Array<Record<string, unknown>> = [];
                let scriptedUsageTokens = 0;
                globalThis.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
                    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
                    bodies.push(body);
                    const content = fixedSummaryContent(String((body.messages as Array<{ content: string }>)[1].content));
                    const promptTokens = estimateApproximateTokens(JSON.stringify(body.messages));
                    const completionTokens = estimateApproximateTokens(content);
                    scriptedUsageTokens += promptTokens + completionTokens;
                    return new Response(JSON.stringify({ id: 'offline-pressure', object: 'chat.completion', created: 0,
                        model: 'deepseek-v4-pro', choices: [{ index: 0, message: { role: 'assistant', content },
                            finish_reason: 'stop' }], usage: { prompt_tokens: promptTokens,
                            completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } }),
                    { headers: { 'content-type': 'application/json' } });
                }) as typeof fetch;
                const startedAt = performance.now();
                const preview = project(tier.history, tier.maxHistoryChars);
                const shouldSummarize = policy === 'existing' ? preview.outcome.historyCompressed
                    : policy === 'candidate' && preview.outcome.admission === 'local_overflow';
                const summarizer = new PaAgentContextSummarizer();
                const ledger = new PaAgentRunUsageLedger();
                const auxiliaryBudget = createPaAgentAuxiliarySummaryBudget(() => ledger.snapshot().attempts);
                const invoke = async (payload: Parameters<Parameters<PaAgentContextSummarizer['prepareHistory']>[0]['invoke']>[0],
                    signal: AbortSignal) => {
                    const call = policy === 'candidate' ? createAgentDebugCall(undefined,
                        { parentId: 'pressure', purpose: 'context_summary' }, ledger) : undefined;
                    const activity = call ? auxiliaryBudget.begin(call.callId, payload.maxOutputTokens) : undefined;
                    try {
                        const model = await aiUtils.createChatModel(0, { transport: 'native',
                            maxTokens: payload.maxOutputTokens,
                            ...(call ? { agentDebugCall: call, onProviderRequestStart: () => {
                                const tokens = estimateApproximateTokens(JSON.stringify(payload.messages));
                                call.promptEstimate = { tokens, method: 'cjk_json_messages' };
                                activity!.admit(tokens);
                            } } : {}) });
                        return await model.invoke(payload.messages, { signal });
                    } finally { activity?.finish(); }
                };
                const summary = shouldSummarize ? await summarizer.prepareHistory({ history: tier.history,
                    historyBudgetChars: preview.historyBudgetChars, invoke }) : undefined;
                const beforeCache = bodies.length;
                const beforeCacheBudget = auxiliaryBudget.snapshot();
                if (summary) expect(await summarizer.prepareHistory({ history: tier.history,
                    historyBudgetChars: preview.historyBudgetChars, invoke })).toBeDefined();
                const cacheHit = summary ? bodies.length === beforeCache : null;
                if (summary && policy === 'candidate') expect(auxiliaryBudget.snapshot()).toEqual(beforeCacheBudget);
                const outcome = project(tier.history, tier.maxHistoryChars, summary);
                const localElapsedMs = performance.now() - startedAt;
                const sourceSlices = bodies.map(body => {
                    const userBody = String((body.messages as Array<{ content: string }>)[1].content);
                    const parsed = JSON.parse(userBody) as { sourceMessages: Array<{
                        index: number; start: number; end: number }> };
                    return parsed.sourceMessages.map(part => `${part.index}:${part.start}-${part.end}`);
                });
                measurements.push({ tier: tier.name, policy, admission: outcome.outcome.admission,
                    retainedOfflineConstraint: outcome.input.includes('Export must remain offline.'),
                    retainedLatestQuestion: outcome.input.includes(`Question ${tier.history.length / 2 - 1}.`),
                    auxiliarySdkCalls: bodies.length, auxiliarySdkReportedTokens: scriptedUsageTokens,
                    auxiliaryEstimatedReservedTokens: bodies.reduce((sum, body) => sum
                        + estimateApproximateTokens(JSON.stringify(body.messages))
                        + Number(body.max_tokens ?? body.max_completion_tokens), 0),
                    ...(policy === 'candidate' ? { auxiliaryBudget: auxiliaryBudget.snapshot() } : {}),
                    estimatedAnswerInputTokens: outcome.budget.estimatedPromptTokens,
                    cacheHit, localElapsedMs, requestMaxTokens: bodies.map(body => body.max_tokens ?? body.max_completion_tokens),
                    sourceSlices });
                expect(bodies.every(body => body.stream === false)).toBe(true);
                expect(bodies.every(body => Number(body.max_tokens ?? body.max_completion_tokens) > 0)).toBe(true);
            }
            if (process.env.B149_T11_PRESSURE === '1') console.log(`B149_T11_PRESSURE=${JSON.stringify(measurements)}`);
            const at = (tier: string, policy: Policy) => measurements.find(item => item.tier === tier && item.policy === policy)!;
            expect(measurements).toHaveLength(9);
            expect(at('small', 'no_auxiliary')).toMatchObject({ admission: 'fit', auxiliarySdkCalls: 0,
                retainedOfflineConstraint: true, retainedLatestQuestion: true });
            expect(at('small', 'candidate')).toMatchObject({ admission: 'fit', auxiliarySdkCalls: 0 });
            for (const tier of ['medium', 'long']) {
                expect(at(tier, 'no_auxiliary')).toMatchObject({ admission: 'local_overflow', auxiliarySdkCalls: 0 });
                for (const policy of ['existing', 'candidate'] as Policy[]) {
                    expect(at(tier, policy)).toMatchObject({ admission: 'fit', retainedOfflineConstraint: true,
                        retainedLatestQuestion: true, cacheHit: true });
                    expect(at(tier, policy).auxiliarySdkCalls).toBeGreaterThan(0);
                }
                expect((at(tier, 'candidate').auxiliaryBudget as { estimatedReservedTokens: number })
                    .estimatedReservedTokens).toBe(at(tier, 'candidate').auxiliaryEstimatedReservedTokens);
            }
        } finally { globalThis.fetch = realFetch; }
    });

    it.each([{ name: 'medium', words: 28, requiredCalls: 2 },
        { name: 'long', words: 180, requiredCalls: 12 }])
    ('keeps $name incomplete when one rolling source chunk is omitted by a lower auxiliary cap', async tier => {
        const history = fixture(12, tier.words);
        const preview = project(history, 3_000);
        let calls = 0;
        const summary = await new PaAgentContextSummarizer().prepareHistory({ history,
            historyBudgetChars: preview.historyBudgetChars,
            invoke: async payload => {
                calls++;
                if (calls >= tier.requiredCalls) throw new Error('synthetic auxiliary cap reached');
                return { content: fixedSummaryContent(payload.messages[1].content) };
            },
        });
        expect(calls).toBe(tier.requiredCalls);
        expect(summary).toBeUndefined();
        expect(project(history, 3_000, summary).outcome.admission).toBe('local_overflow');
    });
});

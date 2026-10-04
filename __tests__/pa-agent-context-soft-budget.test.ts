import type { ChatMessage, PaAgentMessage } from '../src/ai-services/chat-types';
import { PaAgentContextManager, type PaAgentContextManagerInput } from '../src/ai-services/context/PaAgentContextManager';
import { PaAgentContextSummarizer } from '../src/ai-services/context/PaAgentContextSummarizer';
import { getPaAgentToolSummaryCandidates } from '../src/ai-services/context/PaAgentContextCompactor';
import { planHistoryContext } from '../src/ai-services/context/PaAgentHistoryContextPlan';
import { buildPaAgentFinalMessages, formatToolObservations, measurePaAgentRequestEnvelope } from '../src/ai-services/pa-agent-prompts';

const empty = { goals: [], constraints: [], decisions: [], completed: [], open_questions: [], facts: [] };
const unique = (count: number) => Array.from({ length: count }, (_, i) => `source-item-${i}: factual detail ${i * 7919}`).join('\n');
function project(overrides: Partial<PaAgentContextManagerInput>) {
    return new PaAgentContextManager().forPrompt({ prompt: 'Continue the current task.', transcript: [], turnIndex: 0,
        maxHistoryChars: 60_000, maxObservationChars: 64_000, maxPromptChars: 120_000,
        availableSkills: 'None', toolDefinitions: 'None', formatToolObservations,
        measurePromptEnvelope: parts => measurePaAgentRequestEnvelope({ input: parts.input,
            available_skills: parts.availableSkills, tool_definitions: parts.toolDefinitions,
            tool_observations: parts.toolObservations, operations_guidance: '' }, [],
        buildPaAgentFinalMessages(parts.input, parts.actionHistory, 'native', undefined,
            parts.history, parts.currentInput, parts)), ...overrides });
}
function cycles(text: string, count = 1): PaAgentMessage[] {
    return Array.from({ length: count }, (_, i): PaAgentMessage[] => [
        { role: 'assistant', id: `a${i}`, timestamp: i, content: [{ type: 'toolCall', id: `c${i}`,
            name: 'read_note', input: { path: `public-${i}.md` } }] },
        { role: 'toolResult', id: `r${i}`, timestamp: i, toolCallId: `c${i}`, toolName: 'read_note', isError: false,
            content: { promptText: text, includeInNextPrompt: true,
                metadata: { retrySafety: 'read_only', outcome: 'success', executionState: 'succeeded' } } },
    ]).flat();
}

describe('soft context capacity', () => {
    it('sends complete history and observations above both lane targets when the measured model envelope fits', () => {
        const body = unique(2300);
        const history: ChatMessage[] = [{ role: 'user', content: 'Earlier request' }, { role: 'assistant', content: body }];
        const transcript = cycles(body);
        const result = project({ chatHistory: history, transcript, modelBudgetFacts: {
            contextWindowTokens: 1_000_000, outputReserveTokens: 10_000,
            contextWindowSource: 'verified_metadata', outputReserveSource: 'verified_metadata' } });
        expect(result.history.text.length).toBeGreaterThan(60_000);
        expect(result.budget.toolObservationChars).toBeGreaterThan(64_000);
        expect(result.outcome).toMatchObject({ admission: 'fit', needsCompaction: false, toolResultsHardTruncated: 0 });
        expect(result.history.sourceMessages).toEqual(history);
        expect(result.actionHistory[0].calls[0].results[0].text).toBe(body);
    });

    it('treats an unknown-model 120k fallback as pressure while retaining the entire current input', () => {
        const prompt = unique(4000);
        const result = project({ prompt });
        expect(result.budget.promptChars).toBeGreaterThan(120_000);
        expect(result.outcome).toMatchObject({ admission: 'fit', needsCompaction: true });
        expect(result.currentInput).toBe(`User input:\n${prompt}`);
    });

    it('requires a smaller actual recovery envelope even when the rejected request already used a cached summary', () => {
        const history = Array.from({ length: 6 }, (_, index): ChatMessage[] => [
            { role: 'user', content: `Public request ${index}` },
            { role: 'assistant', content: `Public observation ${index}\n${unique(index === 5 ? 150 : 900)}` },
        ]).flat();
        const before = JSON.stringify(history);
        const cached = { text: 'Earlier public observations were reviewed.', sourceMessages: history.slice(0, 6) };
        const rejected = project({ chatHistory: history, summaries: { history: cached } });
        expect(rejected.history.semanticSummaryChars).toBeGreaterThan(0);
        expect(rejected.outcome).toMatchObject({ admission: 'fit', needsCompaction: false });
        const recoveryMaxPromptChars = Math.floor(rejected.budget.promptChars * 0.7);
        const recovery = project({ chatHistory: history, summaries: { history: cached },
            recoveryRequested: true, recoveryMaxPromptChars });
        expect(recovery.budget.promptChars).toBeGreaterThan(recoveryMaxPromptChars);
        expect(recovery.outcome).toMatchObject({ admission: 'fit', needsCompaction: true });
        expect(recovery.historyBudgetChars).toBeLessThan(rejected.historyBudgetChars);
        const current = { text: 'A longer source-bound prefix was reviewed.', sourceMessages: history.slice(0, 8) };
        const reduced = project({ chatHistory: history, summaries: { history: current },
            recoveryRequested: true, recoveryMaxPromptChars });
        expect(reduced.budget.promptChars).toBeLessThanOrEqual(recoveryMaxPromptChars);
        expect(reduced.outcome).toMatchObject({ admission: 'fit', needsCompaction: false });
        expect(reduced.history.entries.slice(-2)).toEqual(history.slice(-2).map(message => ({ kind: 'message', message })));
        expect(reduced.history.sourceMessages).toEqual(history);
        const next = project({ chatHistory: history, summaries: { history: current } });
        expect(next.history.text).toBe(reduced.history.text);
        expect(next.budget.promptChars).toBe(reduced.budget.promptChars);
        expect(next.outcome).toMatchObject({ admission: 'fit', needsCompaction: false, budgetLimited: false });
        expect(next.historyBudgetChars).toBe(60_000);
        expect(next.history.sourceMessages).toEqual(history);
        expect(JSON.stringify(history)).toBe(before);
    });

    it('summarizes a whole old mixed/legacy action turn while retaining unknown facts, current parent and latest correction', async () => {
        const old = cycles(unique(700));
        (old[0] as Extract<PaAgentMessage, { role: 'assistant' }>).content.push({ type: 'toolCall', id: 'unresolved',
            name: 'legacy_effect', input: { original: unique(400) } });
        const result = old[1] as Extract<PaAgentMessage, { role: 'toolResult' }>;
        result.content.metadata = { outcome: 'success' };
        result.content.resultFact = { kind: 'unknown', operationId: 'uncertain-operation' };
        const history: ChatMessage[] = [
            { role: 'user', content: 'Original task' },
            { role: 'assistant', content: 'The operation needs checking.', canonicalTurn: {
                schemaVersion: 1, runId: 'old-run', turnId: 'old-turn', messages: old } },
            { role: 'user', content: 'Parent request' }, { role: 'assistant', content: 'CURRENT_PARENT', writingVersionId: 'parent' },
            { role: 'user', content: 'LATEST_CORRECTION: do not repeat the operation.' }, { role: 'assistant', content: 'Understood.' },
        ];
        const before = JSON.stringify(history);
        const protectedWritingVersionIds = new Set(['parent']);
        const plan = planHistoryContext(history, 5000, 8000, undefined, protectedWritingVersionIds);
        expect(plan).toMatchObject({ mode: 'summarized', coveredMessages: 2 });
        expect(plan.summaryMaxChars).toBeGreaterThan(0);
        const requests: Array<Parameters<Parameters<PaAgentContextSummarizer['prepareHistory']>[0]['invoke']>[0]> = [];
        const summary = await new PaAgentContextSummarizer().prepareHistory({ history, historyBudgetChars: 5000,
            protectedWritingVersionIds, invoke: async payload => {
                requests.push(payload);
                const source = JSON.parse(payload.messages[1].content).sourceMessages[0];
                return { ...empty, facts: [{ text: 'Earlier material was reviewed.', sourceMessages: [source.index] }] };
            } });
        expect(summary).toBeDefined();
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.map(request => request.messages[1].content).join('')).toContain('source-item-699');
        const references = JSON.stringify(requests.map(request => JSON.parse(request.messages[2].content)));
        expect(references).not.toContain('source-item-');
        expect(summary!.text).toContain('outcome=unknown');
        expect(summary!.text).toContain('uncertain-operation');
        const projected = project({ chatHistory: history, recoveryRequested: true,
            protectedWritingVersionIds, summaries: { history: summary } });
        const next = project({ chatHistory: history,
            protectedWritingVersionIds, summaries: { history: summary } });
        expect(next.history.text).toBe(projected.history.text);
        expect(next.history.entries.slice(-4)).toEqual(history.slice(-4).map(message => ({ kind: 'message', message })));
        for (const mode of ['native', 'compat'] as const) {
            const wire = JSON.stringify(buildPaAgentFinalMessages(next.input, next.actionHistory, mode,
                undefined, next.history, next.currentInput, next).map(message => message.toDict()));
            expect(wire).toContain('LATEST_CORRECTION');
            expect(wire).toContain('CURRENT_PARENT');
            expect(wire).toContain('outcome=unknown');
            expect(wire).not.toContain('source-item-699');
        }
        expect(projected.history.sourceMessages).toHaveLength(history.length);
        expect(JSON.stringify(history)).toBe(before);
        const changed = structuredClone(history);
        changed[1].content = 'Source revoked or changed.';
        const stale = project({ chatHistory: changed, summaries: { history: summary } });
        expect(stale.history.semanticSummaryChars ?? 0).toBe(0);
        expect(stale.input).toContain('Source revoked or changed.');
        expect(stale.input).toContain('source-item-699');
    });

    it('compacts only old successful read observations with current summaries and keeps their original source snapshots', () => {
        const transcript = cycles(unique(80), 5);
        const tools = transcript.filter((message): message is Extract<PaAgentMessage, { role: 'toolResult' }> => message.role === 'toolResult');
        tools[0].toolName = 'get_writing_context';
        tools[1].content.resultFact = { kind: 'unknown', operationId: 'effect' };
        expect(getPaAgentToolSummaryCandidates(transcript).map(message => message.id)).toEqual(['r2']);
        const summary = { text: JSON.stringify({ ...empty, facts: [{ text: 'Observed evidence.', sourceMessages: [1] }] }),
            source: structuredClone(tools[2]) };
        const before = JSON.stringify(transcript);
        const projected = project({ transcript, recoveryRequested: true, summaries: { tools: new Map([['r2', summary]]) } });
        expect(projected.outcome).toMatchObject({ admission: 'fit', toolResultsCompacted: 1 });
        expect(projected.actionHistory[2].calls[0].results[0].text).toContain('Observed evidence.');
        expect(projected.actionHistory[3].calls[0].results[0].text).toBe(tools[3].content.promptText);
        expect(projected.sourceToolMessages.find(message => message.id === 'r2')).toEqual(tools[2]);
        const next = project({ transcript, summaries: { tools: new Map([['r2', summary]]) } });
        expect(next.outcome).toMatchObject({ admission: 'fit', needsCompaction: false, toolResultsCompacted: 1 });
        expect(next.actionHistory[2].calls[0].results[0].text).toBe(projected.actionHistory[2].calls[0].results[0].text);
        expect(next.actionHistory[3].calls[0].results[0].text).toBe(tools[3].content.promptText);
        expect(next.actionHistory[4].calls[0].results[0].text).toBe(tools[4].content.promptText);
        expect(next.sourceToolMessages).toEqual(tools);
        expect(JSON.stringify(transcript)).toBe(before);
        tools[2].content.promptText += '\nChanged source';
        const stale = project({ transcript, summaries: { tools: new Map([['r2', summary]]) } });
        expect(stale.actionHistory[2].calls[0].results[0].text).toBe(tools[2].content.promptText);
        expect(stale.actionHistory[2].calls[0].results[0].text).not.toContain('Observed evidence.');
    });
});

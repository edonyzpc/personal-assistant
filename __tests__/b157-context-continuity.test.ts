import type { ChatMessage, PaAgentMessage } from '../src/ai-services/chat-types';
import { formatHistoryMessages } from '../src/ai-services/context/PaAgentHistoryContextPlan';
import { PaAgentContextSummarizer } from '../src/ai-services/context/PaAgentContextSummarizer';
import { createCreateImageTool, type ChatToolContext } from '../src/ai-services/chat-tools';
import { cloneActionStates, refreshWritingSaveStates, type PaAgentActionState } from '../src/ai-services/pa-agent-result-facts';
import { completeInputLineage, unknownInputLineage } from '../src/ai-services/input-lineage';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import type { SaveReceipt } from '../src/chat/save-receipt-types';
import { isCurrentHistorySummary } from '../src/ai-services/context/PaAgentContextSummaryTypes';
import { buildPaAgentFinalMessages, buildPaAgentFinalMessagesAsync } from '../src/ai-services/pa-agent-prompts';
import { PaAgentContextProjector } from '../src/ai-services/context/PaAgentContextProjector';
import { PaAgentContextManager } from '../src/ai-services/context/PaAgentContextManager';
import { formatToolObservations } from '../src/ai-services/pa-agent-prompts';
import { AIUtils } from '../src/ai-services/ai-utils';
import { createPaAgentAnswerStreamPrompt } from '../src/ai-services/pa-agent-prompts';
import { streamWithInvokeFallback } from '../src/ai-services/pa-agent-runtime';

jest.mock('obsidian');

function acceptedState(): PaAgentActionState {
    return { schemaVersion: 1, owner: 'image', operationId: 'task-1', phase: 'accepted', revision: 0,
        origin: { runId: 'run-1', turnId: 'turn-1', assistantId: 'assistant-image', callId: 'call-image', resultId: 'result-image' },
        receipt: { kind: 'image-accepted', taskId: 'task-1' },
        inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user-1' }]) };
}

function resultHistory(): ChatMessage[] {
    const messages: PaAgentMessage[] = [
        { role: 'user', id: 'user-1', content: 'Find the contract number', timestamp: 1 },
        { role: 'assistant', id: 'assistant-1', timestamp: 2, content: [
            { type: 'toolCall', id: 'call-1', name: 'query_notes', input: { query: 'contract' } },
        ] },
        { role: 'toolResult', id: 'result-1', toolCallId: 'call-1', toolName: 'query_notes',
            timestamp: 3, isError: false, content: { promptText: 'Contract number CONTRACT_ID_734',
                includeInNextPrompt: true, metadata: { outcome: 'success' } } },
    ];
    return [
        { role: 'user', content: 'Find the contract number' },
        { role: 'assistant', content: 'Found the contract.', canonicalTurn: {
            schemaVersion: 1, runId: 'run-1', turnId: 'turn-1', messages,
        } },
    ];
}

describe('B-157 continuity regressions', () => {
    it.each(['native', 'compat'] as const)('keeps a pure Writing output receipt independent of missing tool observations in %s', async protocol => {
        const ready: PaAgentActionState = { ...acceptedState(), owner: 'writing', operationId: 'writing-version',
            phase: 'ready', origin: { runId: 'run-1', turnId: 'turn-1', assistantId: 'writing-result', resultId: 'writing-result' },
            receipt: { kind: 'writing-version', versionId: 'writing-version' } };
        const history: ChatMessage[] = [{ role: 'user', content: 'Write the synthetic Ginkgo paragraph.' },
            { role: 'assistant', content: 'The writing is ready.', actionStates: [ready], canonicalTurn: {
                schemaVersion: 1, runId: 'run-1', turnId: 'turn-1', actionStates: [ready], messages: [
                    { role: 'assistant', id: 'writing-result', timestamp: 1, content: [
                        { type: 'toolCall', id: 'pure-output', name: 'present_writing', input: { body: 'Synthetic Ginkgo.' } },
                    ] },
                ],
            } }];
        const projection = new PaAgentContextProjector().projectUserInput({ prompt: 'Explain the existing result.',
            chatHistory: history, maxHistoryChars: 60_000 });
        const messages = await buildPaAgentFinalMessagesAsync(projection.input, [], protocol, undefined,
            projection.history, projection.currentInput);
        const wire = JSON.stringify(messages.map(message => message.toDict()));
        expect(wire).toContain('writing-version');
        expect(wire).toContain('ready');
        expect(wire).not.toContain('execution and side effects are unknown');
        expect(wire).not.toContain('noteState');
        if (protocol === 'native') {
            const observation = messages.find(message => message._getType() === 'tool');
            expect(JSON.parse(String(observation!.content))).toMatchObject({
                status: 'result_unknown', unknownScope: 'tool_observation', callId: 'pure-output',
            });
        } else {
            expect(wire).toContain('results');
            expect(messages.some(message => message._getType() === 'tool')).toBe(false);
        }
        expect(ready.phase).toBe('ready');
        expect(ready.receipt).toEqual({ kind: 'writing-version', versionId: 'writing-version' });
    });

    it('keeps saved output and possible unknown effects in both final builders without exposing Host revisions', async () => {
        const saved: PaAgentActionState = { ...acceptedState(), phase: 'completed', revision: 1,
            receipt: { kind: 'image-task', taskId: 'task-1', taskRevision: 3, state: 'completed' } };
        const unknown: PaAgentActionState = { ...acceptedState(), owner: 'ghost', operationId: 'ghost-unknown', phase: 'unknown',
            receipt: { kind: 'ghost-preparation', operationId: 'ghost-unknown', status: 'outcome_unknown' } };
        expect(cloneActionStates([saved, unknown])).toEqual([saved, unknown]);
        const projection = new PaAgentContextProjector().projectUserInput({ prompt: 'Explain the existing results.',
            chatHistory: [{ role: 'assistant', content: '', actionStates: [saved, unknown] }], maxHistoryChars: 60_000 });
        for (const protocol of ['native', 'compat'] as const) {
            const sync = buildPaAgentFinalMessages(projection.input, [], protocol, undefined, projection.history, projection.currentInput);
            const asyncMessages = await buildPaAgentFinalMessagesAsync(projection.input, [], protocol, undefined,
                projection.history, projection.currentInput);
            for (const messages of [sync, asyncMessages]) {
                const payload = JSON.stringify(messages.map(message => message.toDict()));
                expect(payload).toContain('imageOutputStatus');
                expect(payload).toContain('saved');
                expect(payload).toContain('effectOutcome');
                expect(payload).toContain('sideEffectsMayHaveOccurred');
                expect(payload).toContain('unknown');
                expect(payload).not.toContain('revision');
                expect(payload).not.toContain('taskRevision');
                expect(payload).not.toContain('outcome_unknown');
            }
        }
        expect(saved.revision).toBe(1);
        expect(saved.receipt).toMatchObject({ taskRevision: 3 });
    });
    it('preserves a created note within a partial Writing save through history hydration and both provider protocols', async () => {
        const store = new MemoryChatHistoryStore();
        await store.initialize();
        const ready: PaAgentActionState = { ...acceptedState(), owner: 'writing', operationId: 'writing-version',
            phase: 'ready', origin: { runId: 'run-1', turnId: 'turn-1', assistantId: 'writing-result', resultId: 'writing-result' },
            receipt: { kind: 'writing-version', versionId: 'writing-version' } };
        const receipt: SaveReceipt = { id: 'writing-save', operationId: 'writing-save', writingVersionId: ready.operationId,
            textHash: 'a'.repeat(64), targetNotePath: 'HOST_ONLY_PRIVATE_TARGET.md', origin: 'ai_generated', createdAt: 1,
            attachments: [], initialNoteHash: 'b'.repeat(64), noteContentHash: 'b'.repeat(64), noteState: 'created', state: 'partial' };
        const partial = refreshWritingSaveStates(ready, [receipt])!;
        expect(partial.phase).toBe('partial');
        const history: ChatMessage[] = [{ role: 'user', content: 'Write the synthetic Ginkgo paragraph.' },
            { role: 'assistant', content: 'The writing is ready for saving.', actionStates: [partial],
                canonicalTurn: { schemaVersion: 1, runId: 'run-1', turnId: 'turn-1', messages: [], actionStates: [partial] } }];
        const manager = new ChatHistoryManager({ store });
        await store.appendTurn(manager.serializeTurn({ kind: 'history', user: history[0], assistant: history[1] }, 'writing-conversation', 0));
        const reopened = new ChatHistoryManager({ store });
        const stored = (await store.getTurns('writing-conversation'))[0];
        expect(stored.assistant.actionStates).toEqual([partial]);
        expect(JSON.stringify(stored)).not.toContain('HOST_ONLY_PRIVATE_TARGET');
        const hydrated = reopened.deserializeTurn(stored);
        const projection = new PaAgentContextProjector().projectUserInput({ prompt: 'Explain the existing save result.',
            chatHistory: [hydrated.userMessage, hydrated.assistantMessage], maxHistoryChars: 60_000 });
        for (const protocol of ['native', 'compat'] as const) {
            const messages = await buildPaAgentFinalMessagesAsync(projection.input, [], protocol, undefined,
                projection.history, projection.currentInput);
            const payload = JSON.stringify(messages.map(message => message.toDict()));
            expect(payload).toContain('noteState');
            expect(payload).toContain('created');
            expect(payload).toContain('partial');
            expect(payload).toContain('writing-save');
            expect(payload).not.toContain('revision');
            expect(payload).not.toContain('HOST_ONLY_PRIVATE_TARGET');
            expect(payload).not.toContain('noteContentHash');
        }
        await store.dispose();
    });
    it('carries verified Ghost publication through storage, both final protocols and the actual summary request', async () => {
        const published: PaAgentActionState = { ...acceptedState(), owner: 'ghost', operationId: 'ghost-published',
            phase: 'completed', revision: 2,
            receipt: { kind: 'ghost-operation', operationId: 'ghost-published', operationRevision: 2, state: 'terminal', verified: true } };
        expect(cloneActionStates([published])).toEqual([published]);
        const history: ChatMessage[] = [{ role: 'user', content: 'Prepare the synthetic post.' },
            { role: 'assistant', content: 'The draft is prepared and has not been published.', actionStates: [published],
                canonicalTurn: { schemaVersion: 1, runId: 'run-1', turnId: 'turn-1', messages: [], actionStates: [published] } }];
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        await store.appendTurn(manager.serializeTurn({ kind: 'history', user: history[0], assistant: history[1] }, 'ghost-conversation', 0));
        const reopened = new ChatHistoryManager({ store });
        const hydrated = reopened.deserializeTurn((await store.getTurns('ghost-conversation'))[0]);
        const current = [hydrated.userMessage, hydrated.assistantMessage];
        const projection = new PaAgentContextProjector().projectUserInput({ prompt: 'Explain the current publication status.',
            chatHistory: current, maxHistoryChars: 60_000 });
        for (const protocol of ['native', 'compat'] as const) {
            const sync = buildPaAgentFinalMessages(projection.input, [], protocol, undefined, projection.history, projection.currentInput);
            const asyncMessages = await buildPaAgentFinalMessagesAsync(projection.input, [], protocol, undefined,
                projection.history, projection.currentInput);
            for (const messages of [sync, asyncMessages]) {
                const payload = JSON.stringify(messages.map(message => message.toDict()));
                expect(payload).toContain('ghostPublicationStatus');
                expect(payload).toContain('published');
                expect(payload).not.toContain('ghost-operation');
                expect(payload).not.toContain('inputLineage');
            }
        }
        const summaryHistory = [...current];
        for (let index = 0; index < 14; index++) summaryHistory.push(
            { role: 'user', content: `Question ${index}: ${Array.from({ length: 80 }, (_, n) => `${index}-${n}`).join(' ')}` },
            { role: 'assistant', content: `Answer ${index}: ${Array.from({ length: 80 }, (_, n) => `${n}:${index}`).join(' ')}` });
        const payloads: string[] = [];
        const summarizer = new PaAgentContextSummarizer();
        try {
            const summary = await summarizer.prepareHistory({ history: summaryHistory, historyBudgetChars: 3000,
                invoke: async request => {
                    payloads.push(JSON.stringify(request.messages));
                    const source = JSON.parse(request.messages[1].content).sourceMessages[0];
                    return { content: JSON.stringify({ goals: [], constraints: [], decisions: [], completed: [],
                        open_questions: [], facts: [{ text: 'Ordinary background question.', sourceMessages: [source.index] }] }) };
                } });
            expect(summary).toBeDefined();
            expect(JSON.parse(summary!.text).completed).toEqual([expect.objectContaining({
                text: expect.stringContaining('ghostPublicationStatus=published'), sourceMessages: [2],
            })]);
            expect(payloads.length).toBeGreaterThan(0);
            expect(payloads[0]).toContain('ghostPublicationStatus');
            expect(payloads[0]).not.toContain('ghost-operation');
            const actual = JSON.parse(JSON.parse(payloads[0])[1].content);
            expect(actual.sourceMessages.find((source: { index: number }) => source.index === 2).content)
                .toBe('The draft is prepared and has not been published.');
            expect(actual).not.toHaveProperty('retainedActionFacts');
        } finally { summarizer.dispose(); }
    });
    it.each(['native', 'compat', 'compressed-native'] as const)('preserves action history and one state fragment through %s invoke fallback and a physical SDK retry', async mode => {
        const originalFetch = globalThis.fetch;
        const requests: Array<{ messages: Array<{ role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }> }> = [];
        jest.useFakeTimers();
        globalThis.fetch = jest.fn(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            if (requests.length === 1) return new Response('{"error":{"message":"retry"}}', {
                status: 500, headers: { 'content-type': 'application/json', 'retry-after': '0' },
            });
            return new Response(JSON.stringify({ id: 'fixed', object: 'chat.completion', created: 0, model: 'fixed',
                choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Observed accepted.' } }] }),
            { headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        try {
            const history = [...resultHistory(), { role: 'assistant' as const, content: '', actionStates: [acceptedState()] }];
            if (mode === 'compressed-native') history[0].content = `${'Synthetic background.\n'.repeat(1500)}Find the contract number`;
            const projection = new PaAgentContextProjector().projectUserInput({ prompt: 'Explain current status', chatHistory: history,
                maxHistoryChars: mode === 'compressed-native' ? 5000 : 60_000 });
            if (mode === 'compressed-native') {
                expect(projection.history.historyCompressed).toBe(true);
                expect(projection.history.historyBudgetLimited).not.toBe(true);
            }
            const admission = jest.fn();
            const utils = new AIUtils({ settings: { aiProvider: 'openai', chatModelName: 'fixed', embeddingModelName: 'fixed',
                baseURL: 'https://b157-dispatch.invalid/v1' }, getAPIToken: async () => 'synthetic-token', log: jest.fn() });
            const model = await utils.createChatModel(0, { transport: 'native', onProviderRequestStart: admission });
            const chain = createPaAgentAnswerStreamPrompt().pipe(model);
            const buildInput = () => ({ available_skills: 'None', tool_definitions: 'None', operations_guidance: 'No writes',
                messages: buildPaAgentFinalMessages(projection.input, [], mode === 'compressed-native' ? 'native' : mode,
                    undefined, projection.history, projection.currentInput) });
            const prepare = jest.fn(buildInput);
            const chunks: unknown[] = [];
            const run = (async () => {
                for await (const chunk of streamWithInvokeFallback({
                    chain: { stream: async () => { throw new Error('synthetic stream setup failure'); },
                        invoke: (input, options) => chain.invoke(input as ReturnType<typeof buildInput>, options) },
                    input: buildInput(), prepareInvokeInput: prepare,
                })) chunks.push(chunk);
            })();
            await jest.runAllTimersAsync();
            await run;
            expect(prepare).toHaveBeenCalledTimes(1);
            expect(requests).toHaveLength(2);
            expect(admission).toHaveBeenCalledTimes(2);
            expect(requests[0]).toEqual(requests[1]);
            for (const request of requests) {
                if (mode === 'native') {
                    expect(request.messages.find(message => message.role === 'assistant' && message.tool_calls)?.tool_calls)
                        .toHaveLength(1);
                    expect(request.messages.find(message => message.role === 'tool')?.tool_call_id).toBe('call-1');
                } else expect(request.messages.some(message => message.role === 'tool')).toBe(false);
                const wire = JSON.stringify(request.messages);
                expect(wire.match(/Explain current status/g)).toHaveLength(1);
                expect(wire.match(/task-1/g)).toHaveLength(1);
                expect(wire).toContain('accepted');
                expect(wire).toContain('CONTRACT_ID_734');
                expect(wire).not.toContain('inputLineage');
                expect(wire).not.toContain('image-accepted');
                expect(wire).not.toContain('synthetic-token');
            }
            expect(chunks).toContainEqual({ type: 'text_delta', text: 'Observed accepted.' });
        } finally { globalThis.fetch = originalFetch; jest.useRealTimers(); }
    });
    it('fails a combined state limit without clearing individually valid persisted facts', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        const history = resultHistory();
        const states = Array.from({ length: 256 }, (_, index): PaAgentActionState => ({ ...acceptedState(),
            operationId: `task-${index}`, receipt: { kind: 'image-accepted', taskId: `task-${index}` } }));
        history[1].canonicalTurn!.actionStates = states;
        const turn = manager.serializeTurn({ kind: 'history', user: history[0], assistant: history[1] }, 'conversation-1', 0);
        await store.appendTurn(turn);
        const extra: PaAgentActionState = { ...acceptedState(), operationId: 'task-over-limit',
            receipt: { kind: 'image-accepted', taskId: 'task-over-limit' } };
        await expect(store.updateActionStates(turn.assistant.actionStateBinding!, () => [extra])).rejects.toThrow('storage limit');
        expect((await store.getTurns('conversation-1'))[0].assistant.actionStates).toEqual(states);
    });
    it('locates the original persisted operation without using the stage iteration as its container turn', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        await manager.initialize();
        const history = resultHistory();
        history[1].canonicalTurn!.actionStates = [acceptedState()];
        await store.appendTurn(manager.serializeTurn({ kind: 'history', user: history[0], assistant: history[1] }, 'conversation-1', 0));
        const transform = jest.fn((states: PaAgentActionState[]) => states.map(state => ({ ...state, phase: 'running' as const,
            revision: 1, receipt: { kind: 'image-task' as const, taskId: state.operationId, taskRevision: 1, state: 'running' as const } })));
        expect(await manager.updateActionStates('conversation-1', 'run-1', 'different-stage-iteration', transform)).toBeUndefined();
        expect(await manager.updateActionStatesForOperation('conversation-1', 'run-1', 'image', 'task-1', transform))
            .toMatchObject([{ phase: 'running', origin: { turnId: 'turn-1' } }]);
        await store.appendTurn({ ...(await store.getTurns('conversation-1'))[0], turnIndex: 1,
            assistant: { ...(await store.getTurns('conversation-1'))[0].assistant,
                actionStateBinding: { conversationId: 'conversation-1', turnIndex: 1, runId: 'run-1', turnId: 'turn-1' } } });
        transform.mockClear();
        await expect(manager.updateActionStatesForOperation('conversation-1', 'run-1', 'image', 'task-1', transform))
            .rejects.toThrow('ambiguous');
        expect(transform).not.toHaveBeenCalled();
    });
    it('keeps unavailable action storage distinct from a confirmed missing original record', async () => {
        const manager = new ChatHistoryManager({ store: new MemoryChatHistoryStore() });
        const transform = jest.fn((states: PaAgentActionState[]) => states);
        await expect(manager.updateActionStatesForOperation('conversation-1', 'run-1', 'image', 'task-1', transform))
            .rejects.toThrow('unavailable');
        await manager.initialize();
        expect(await manager.updateActionStatesForOperation('conversation-1', 'run-1', 'image', 'task-1', transform)).toBeUndefined();
        expect(transform).not.toHaveBeenCalled();
    });
    it('refuses a copied outer conversation binding before invoking a domain transform', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        await manager.initialize();
        const history = resultHistory();
        history[1].canonicalTurn!.actionStates = [acceptedState()];
        const original = manager.serializeTurn({ kind: 'history', user: history[0], assistant: history[1] }, 'conversation-1', 0);
        await store.appendTurn(original);
        await store.appendTurn({ ...original, conversationId: 'copied-conversation' });
        const transform = jest.fn((states: PaAgentActionState[]) => states);
        expect(await manager.updateActionStates('copied-conversation', 'run-1', 'turn-1', transform)).toBeUndefined();
        expect(transform).not.toHaveBeenCalled();
        expect((await store.getTurns('conversation-1'))[0].assistant.actionStates).toEqual([acceptedState()]);
    });
    it.each(['approval_pending', 'unknown', 'partial'] as const)('keeps unresolved %s details when a bound summary covers a different finding', kind => {
        const history = resultHistory();
        const result = history[1].canonicalTurn!.messages[2] as Extract<PaAgentMessage, { role: 'toolResult' }>;
        result.content.promptText = 'VERIFY_OPERATION_884 needs confirmation; output is not yet saved.';
        result.content.resultFact = kind === 'approval_pending' ? { kind, intentId: 'intent-884' }
            : kind === 'unknown' ? { kind, operationId: 'operation-884' }
            : { kind, completedRefs: ['receipt-1'], remainingRefs: ['receipt-2'] };
        const projected = new PaAgentContextProjector().projectUserInput({ prompt: 'Explain', chatHistory: history,
            maxHistoryChars: 600, summaries: { history: { text: JSON.stringify({ facts: [
                { text: 'Another finding.', sourceMessages: [1] },
            ] }), sourceMessages: history } } });
        expect(projected.history.text).toContain('VERIFY_OPERATION_884');
        expect(projected.history.historyBudgetLimited).toBe(true);
    });

    it('keeps a full protected result when only the history lane target is exceeded', () => {
        const history = resultHistory();
        const result = history[1].canonicalTurn!.messages[2] as Extract<PaAgentMessage, { role: 'toolResult' }>;
        result.content.promptText = `Begin ${'Long result '.repeat(700)} CONTRACT_ID_734 end`;
        const original = JSON.stringify(history);
        const projected = new PaAgentContextManager().forPrompt({ prompt: 'Explain', transcript: [], turnIndex: 1,
            chatHistory: history, maxHistoryChars: 1200, maxPromptChars: 60000, maxObservationChars: 1000,
            availableSkills: 'None', toolDefinitions: 'None', formatToolObservations });
        expect(projected.history.omittedCount).toBe(0);
        expect(projected.history.text.length).toBeGreaterThan(1200);
        expect(projected.outcome).toMatchObject({ admission: 'fit', budgetLimited: false, needsCompaction: false });
        expect(projected.history.text).toContain(result.content.promptText);
        expect(projected.history.sourceMessages).toEqual(history);
        expect(JSON.stringify(history)).toBe(original);
    });
    it('rejects phase/owner/receipt tampering and clones finite state without shared references', () => {
        const state = acceptedState();
        expect(cloneActionStates([{ ...state, phase: 'completed' }])).toEqual([]);
        expect(cloneActionStates([{ ...state, owner: 'ghost' }])).toEqual([]);
        expect(cloneActionStates([{ ...state, receipt: { kind: 'image-accepted', taskId: 'other-task' } }])).toEqual([]);
        expect(cloneActionStates([{ ...state, secret: 'PRIVATE_BODY' }])).toEqual([]);
        const clone = cloneActionStates([state]);
        if (clone[0].receipt.kind !== 'image-accepted' || state.receipt.kind !== 'image-accepted') {
            throw new Error('Expected the original image acceptance receipt.');
        }
        clone[0].receipt.taskId = 'mutated';
        expect(state.receipt.taskId).toBe('task-1');
    });

    it('roundtrips finite state with a new manager over the same Memory store, rejecting copied-turn binding', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        const history = resultHistory();
        history[1].canonicalTurn!.actionStates = [acceptedState()];
        history[1].canonicalTurn!.inputLineage = unknownInputLineage();
        const persisted = manager.serializeTurn({ kind: 'history', user: history[0], assistant: history[1] }, 'conversation-1', 0);
        expect(JSON.stringify(persisted)).not.toContain('CONTRACT_ID_734');
        await store.appendTurn(persisted);
        const newManager = new ChatHistoryManager({ store });
        const hydrated = newManager.deserializeTurn((await store.getTurns('conversation-1'))[0]);
        expect(hydrated.assistantMessage.actionStates).toEqual([acceptedState()]);
        expect(hydrated.assistantMessage.canonicalTurn!.messages).toEqual([]);
        expect(hydrated.assistantMessage.inputLineage?.completeness).toBe('unknown');
        await store.appendTurn({ ...persisted, conversationId: 'other-conversation' });
        expect((await store.getTurns('other-conversation'))[0].assistant.actionStates).toEqual([]);
        await store.appendTurn({ ...persisted, turnIndex: 1 });
        expect((await store.getTurns('conversation-1'))[1].assistant.actionStates).toEqual([]);
    });

    it('sends state-only fragments alongside real native actions in both final builders', async () => {
        const history = resultHistory();
        history.push({ role: 'assistant', content: '', actionStates: [acceptedState()] });
        const projection = new PaAgentContextProjector().projectUserInput({ prompt: 'Explain', chatHistory: history,
            maxHistoryChars: 60000 });
        const sync = buildPaAgentFinalMessages(projection.input, [], 'native', undefined, projection.history, projection.currentInput);
        const asyncMessages = await buildPaAgentFinalMessagesAsync(projection.input, [], 'native', undefined,
            projection.history, projection.currentInput);
        for (const messages of [sync, asyncMessages]) {
            expect(messages.some(message => message._getType() === 'tool')).toBe(true);
            const payload = JSON.stringify(messages.map(message => message.toDict()));
            expect(payload).toContain('task-1');
            expect(payload).toContain('accepted');
            expect(payload).not.toContain('inputLineage');
        }
    });

    it('invalidates summary reuse when finite state changes without changing prose', () => {
        const original: ChatMessage[] = [{ role: 'assistant', content: '', actionStates: [acceptedState()] }];
        const changed: ChatMessage[] = [{ ...original[0], actionStates: [{ ...acceptedState(), operationId: 'task-2',
            receipt: { kind: 'image-accepted', taskId: 'task-2' } }] }];
        expect(isCurrentHistorySummary({ text: '{}', sourceMessages: original }, changed)).toBe(false);
    });
    it('records image accepted as a domain fact without claiming ready or saved', async () => {
        const tool = createCreateImageTool({ conversationId: 'conversation-1', stableMessageId: 'message-1',
            operationId: 'operation-1', submit: async () => ({ taskId: 'task-1' }) });
        const result = await tool.execute(tool.validateInput({ prompt: 'Synthetic scene', operation: 'generate' }),
            {} as ChatToolContext);
        expect(result.resultFact).toEqual({ kind: 'accepted', action: 'image', operationId: 'task-1' });
    });

    it('preserves the known result identifier and original history during lossless formatting', () => {
        const history = resultHistory();
        const original = JSON.stringify(history);
        expect(formatHistoryMessages(history, true)).toContain('CONTRACT_ID_734');
        expect(JSON.stringify(history)).toBe(original);
    });

    it('sends canonical action findings in the actual summary payload, not only Host binding', async () => {
        const history = resultHistory();
        for (let index = 0; index < 14; index++) history.push(
            { role: 'user', content: `Question ${index}: ${Array.from({ length: 80 }, (_, n) => `${index}-${n}`).join(' ')}` },
            { role: 'assistant', content: `Answer ${index}: ${Array.from({ length: 80 }, (_, n) => `${n}:${index}`).join(' ')}` });
        const original = JSON.stringify(history);
        const payloads: string[] = [];
        const summarizer = new PaAgentContextSummarizer();
        try {
            const summary = await summarizer.prepareHistory({ history, historyBudgetChars: 3000,
                invoke: async request => {
                    payloads.push(JSON.stringify(request.messages));
                    const free = JSON.parse(request.messages[1].content);
                    const source = free.sourceMessages[0];
                    const facts = [...(free.previousSummary?.facts ?? [])];
                    if (free.sourceMessages.some((item: { index: number; content: string }) =>
                        item.index === 2 && item.content.includes('CONTRACT_ID_734'))
                        && !facts.some(item => item.text.includes('CONTRACT_ID_734'))) {
                        facts.push({ text: 'Contract number CONTRACT_ID_734', sourceMessages: [2] });
                    }
                    if (facts.length === 0) facts.push({ text: 'Ordinary background question.', sourceMessages: [source.index] });
                    return { content: JSON.stringify({ goals: [], constraints: [], decisions: [], completed: [],
                        open_questions: [], facts }) };
                } });
            expect(summary).toBeDefined();
            expect(payloads.length).toBeGreaterThan(0);
            const actualMessages = JSON.parse(payloads[0]) as Array<{ role: string; content: string }>;
            expect(actualMessages.map(message => message.role)).toEqual(['system', 'user', 'user']);
            const freeSources = JSON.parse(actualMessages[1].content);
            const actionReference = JSON.parse(actualMessages[2].content);
            expect(actionReference).toMatchObject({ sourceKind: 'retained_action_facts', purpose: 'read_only_reference' });
            expect(actionReference.retainedActionFacts).toEqual([expect.objectContaining({ index: 2, actionResults: [expect.objectContaining({
                callId: 'call-1', id: 'result-1', outcome: 'success', toolName: 'query_notes', isError: false,
            })] })]);
            expect(actionReference.retainedActionFacts[0].actionResults[0]).not.toHaveProperty('text');
            expect(JSON.stringify(actionReference)).not.toContain('CONTRACT_ID_734');
            expect(freeSources).not.toHaveProperty('retainedActionFacts');
            expect(freeSources.sourceMessages.find((source: { index: number }) => source.index === 2).content)
                .toContain(history[1].content);
            expect(JSON.stringify(freeSources)).toContain('Contract number CONTRACT_ID_734');
            const combined = JSON.parse(summary!.text);
            expect(combined.completed).toEqual([]);
            expect(combined.facts).toEqual(expect.arrayContaining([expect.objectContaining({
                text: expect.stringContaining('resultId=result-1'), sourceMessages: [2],
            })]));
            const final = new PaAgentContextProjector().projectUserInput({ prompt: 'Explain the existing result.',
                chatHistory: history, maxHistoryChars: 3000, summaries: { history: summary } });
            expect(final.history.text).toContain('CONTRACT_ID_734');
            expect(summary!.sourceMessages[0].content).toContain('Find the contract number');
            expect(final.history.historyBudgetLimited).not.toBe(true);
            expect(JSON.stringify(history)).toBe(original);
        } finally { summarizer.dispose(); }
    });
});

import { describe, expect, it, jest, beforeAll, afterAll } from '@jest/globals';
import { build } from 'esbuild';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { ChatService } from '../src/ai-services/chat-service';
import { MemoryChatHistoryStore, IndexedDbChatHistoryStore, buildTurnRecordKey } from '../src/chat/chat-history-store';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { PaAgentContextProjector } from '../src/ai-services/context/PaAgentContextProjector';
import { formatHistoryMessages, formatSemanticHistorySummary, planHistoryContext, protectedHistoryLayoutSteps,
    selectHistoryTurnsSteps } from '../src/ai-services/context/PaAgentHistoryContextPlan';
import { finishContextSteps } from '../src/ai-services/context/clone-utils';
import { isCurrentHistorySummary, projectPaAgentRetainedActionFacts } from '../src/ai-services/context/PaAgentContextSummaryTypes';
import { PaAgentContextSummarizer, buildPaAgentDeterministicActionSummary } from '../src/ai-services/context/PaAgentContextSummarizer';
import { TaskSourceRun } from '../src/ai-services/task-source-run';
import { traceProviderDispatch } from '../src/ai-services/obsidian-fetch';
import { FakeGovernanceIndexedDbFactory } from './helpers/fake-governance-indexeddb';

jest.mock('obsidian', () => {
    const original: any = jest.requireActual('../__mocks__/obsidian');
    const assertFileArguments = (vault: any, path: unknown) => {
        if (!vault || typeof vault.getAbstractFileByPath !== 'function' || typeof path !== 'string') {
            throw new TypeError('Obsidian file constructor requires (vault, path)');
        }
    };
    return { ...original,
        TFile: class extends original.TFile {
            constructor(vault: any, path: string) { assertFileArguments(vault, path); super(path); this.vault = vault; this.parent = null; }
        },
        TFolder: class extends original.TFolder {
            constructor(vault: any, path: string) { assertFileArguments(vault, path); super(path); this.vault = vault; this.parent = null; }
        },
    };
});

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../scripts/fixtures/b157-context-eval.json'), 'utf8'));
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const info = { schemaVersion: 1, fixtureId: fixture.id,
    fixtureSha256: sha(readFileSync(resolve(__dirname, '../scripts/fixtures/b157-context-eval.json'), 'utf8')),
    entrySha256: sha(readFileSync(resolve(__dirname, '../scripts/b157-context-eval-entry.mjs'), 'utf8')) };
let harness: any;
const originalCrypto = globalThis.crypto;
const originalKeyRange = (globalThis as any).IDBKeyRange;

beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: {
        bound: (lower: string, upper: string, lowerOpen: boolean, upperOpen: boolean) => ({ lower, upper, lowerOpen, upperOpen }),
    } });
    const bundled = await build({ absWorkingDir: resolve(__dirname, '..'),
        entryPoints: ['scripts/b157-context-eval-entry.mjs'], bundle: true, write: false,
        platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian', 'electron', 'node:*'],
        define: { __B157_BUILD_INFO__: JSON.stringify(info) } });
    const module = { exports: {} };
    const localRequire = createRequire(resolve(__dirname, '../package.json'));
    const mockObsidian = require('obsidian');
    const scopedRequire = (name: string) => name === 'obsidian' ? mockObsidian : localRequire(name);
    new Function('require', 'module', 'exports', bundled.outputFiles[0]!.text)(scopedRequire, module, module.exports);
    harness = module.exports;
});

afterAll(async () => {
    await (globalThis as any).__b157ContextEval?.cleanup();
    delete (globalThis as any).__b157ContextEval;
    delete (globalThis as any).__b157PreReloadPlugin;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    if (originalKeyRange === undefined) Reflect.deleteProperty(globalThis, 'IDBKeyRange');
    else Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: originalKeyRange });
});

function offlineServicePlugin(reply: (body: any, index: number) => any, configureService?: (service: any) => void) {
    const bodies: any[] = [];
    const plugin: any = { manifest: { version: 'synthetic-version' }, settings: {
        aiProvider: 'qwen', chatModelName: 'synthetic-model', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        qwenThinkingEnabled: false, licenseTier: 'paid', writingOutputProtocol: 'native', operationsAgentEnabled: false,
    }, createChatService() {
        const service: any = new ChatService({ settings: plugin.settings, app: harness.createSyntheticApp(),
            isOperationsAgentEnabled: false, getAPIToken: async () => 'synthetic-placeholder', log: () => undefined } as any);
        service.aiUtils.createChatModel = async (_temperature: number, options: any) => new ChatOpenAI({
            model: plugin.settings.chatModelName, apiKey: 'SYNTHETIC_NEVER_SENT', maxRetries: 0,
            configuration: { baseURL: 'https://synthetic.invalid/v1', fetch: async (_url, init) => {
                await options.prepareProviderRequest?.(init?.signal); options.onProviderRequestStart?.();
                const body = JSON.parse(String(init?.body)); bodies.push(body);
                const message = reply(body, bodies.length - 1);
                const common = { id: `offline-${bodies.length}`, created: 0, model: body.model };
                const finish = message.tool_calls ? 'tool_calls' : 'stop';
                const data = body.stream ? `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk',
                    choices: [{ index: 0, delta: message, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`
                    : JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }] });
                return traceProviderDispatch(async () => new Response(data, { headers: {
                    'content-type': body.stream ? 'text/event-stream' : 'application/json' } }),
                'native', options.onProviderRequestTrace, init?.body, () => true);
            } },
        });
        configureService?.(service);
        return service;
    } };
    const bundle = 'synthetic plugin bytes', script = 'synthetic harness bytes';
    const app: any = harness.createSyntheticApp();
    app.vault.adapter.read = async (path: string) => path.endsWith('main.js') ? bundle : script;
    app.plugins = { plugins: { 'personal-assistant': plugin } };
    const options = { maxRequests: 30, expectedBundleSha256: sha(bundle), expectedHarnessSha256: sha(script),
        expectedPluginVersion: 'synthetic-version', harnessPath: 'B157-context-eval/b157-context-eval.js' };
    return { plugin, bodies, app, options };
}

function nativeHistoryFactory() {
    const factory: any = new FakeGovernanceIndexedDbFactory(), modes: string[] = [];
    const open = factory.open.bind(factory);
    factory.open = (name: string, version: number) => {
        const request = open(name, version), database = factory.connections.at(-1);
        Object.defineProperty(database, 'version', { get: () => factory.backend.version });
        const transaction = database.transaction.bind(database);
        database.transaction = (...args: any[]) => {
            modes.push(args[1] ?? 'readonly');
            const result = transaction(...args), objectStore = result.objectStore.bind(result);
            result.objectStore = (storeName: string) => {
                const store = objectStore(storeName), put = store.put.bind(store), getAll = store.getAll.bind(store);
                store.put = (value: any, key: any) => put(value, key ?? value.key ?? value.id ?? value.taskId ?? value.versionId);
                // This governance fake has no keyPath/range support. Model the
                // real Store's inline keys and IDBKeyRange rather than returning
                // every conversation's rows for one getTurns query.
                store.getAll = (range?: any) => {
                    const request = getAll();
                    if (!range) return request;
                    return new Proxy(request, { set(target, property, value) {
                        if (property === 'onsuccess') target.onsuccess = (event: Event) => {
                            target.result = target.result.filter((row: any) =>
                                (range.lowerOpen ? row.key > range.lower : row.key >= range.lower)
                                && (range.upperOpen ? row.key < range.upper : row.key <= range.upper));
                            value.call(request, event);
                        };
                        else Reflect.set(target, property, value);
                        return true;
                    } });
                };
                return store;
            };
            return result;
        };
        return request;
    };
    factory.databases = async () => [...new Set(factory.openCalls.map((call: any) => call.name))]
        .map(name => ({ name, version: factory.backend.version }));
    factory.deleteDatabase = jest.fn((_name: string) => { const request: any = {};
        queueMicrotask(() => request.onsuccess?.({})); return request; });
    return { factory, modes };
}

async function storedNativeHistory() {
    const { factory, modes } = nativeHistoryFactory();
    const databaseName = 'b157-context-eval-a7440e6c-bcb0-41bf-aba5-b1693e008d85';
    const conversations = [
        { id: 'd3e1e0f4-7b0a-4679-8eaf-7ec56863b26a', turnCount: 5 },
        { id: 'ea99567e-6be5-4fe7-9a3a-e83546a2e6d5', turnCount: 6 },
        { id: '30da14e6-4695-4c6b-88be-61bff9852261', turnCount: 4 },
        { id: '0b1760fd-d631-43d2-9c6f-207c72038050', turnCount: 2 },
    ];
    const store = new IndexedDbChatHistoryStore(databaseName, factory), originalTurns: any[] = [];
    await store.initialize(); await store.setSchemaVersion(2);
    for (const item of conversations) {
        const conversation = { ...item, title: 'Stored synthetic native fixture', preview: '',
            createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
        await store.upsertConversation(conversation);
        for (let turnIndex = 0; turnIndex < item.turnCount; turnIndex++) {
            const turn = { conversationId: item.id, turnIndex,
                user: { role: 'user' as const, content: `Stored synthetic question ${item.id}/${turnIndex}` },
                assistant: { role: 'assistant' as const, content: `Stored synthetic answer ${item.id}/${turnIndex}` } };
            await store.appendTurn(turn); originalTurns.push(turn);
        }
    }
    await store.setActiveConversationId(conversations.at(-1)!.id); store.dispose(); modes.length = 0;
    return { factory, modes, originalTurns, existingHistory: { databaseName, conversations } };
}

function recordedNeutralReply(label: string, chars = 712) {
    // Capacity witness matches the observed live reply length. Its distinct,
    // neutral prose supplies no plan/status oracle and cannot compress away.
    return Array.from({ length: 60 }, (_, index) =>
        `阅读记录${label}${String.fromCharCode(0x4e00 + index)}：这里只描述核对现有上下文的阅读过程，继续依据用户各轮原文及原回执判断，不提供新的目标、结论或操作授权。`).join('').slice(0, chars);
}

function historySummaryMaterials(request: any) {
    expect(request.messages.map((message: any) => message.role)).toEqual(['system', 'user', 'user']);
    const source = JSON.parse(request.messages[1].content);
    const actionFacts = JSON.parse(request.messages[2].content);
    expect(Object.keys(source).sort()).toEqual(['phase', 'previousSummary', 'sourceKind', 'sourceMessages']);
    expect(source).toMatchObject({ sourceKind: 'chat_history', phase: 'rolling', sourceMessages: expect.any(Array) });
    expect(Object.keys(actionFacts).sort()).toEqual(['purpose', 'retainedActionFacts', 'sourceKind']);
    expect(actionFacts).toMatchObject({ sourceKind: 'retained_action_facts', purpose: 'read_only_reference',
        retainedActionFacts: expect.any(Array) });
    return { source, actionFacts };
}

function summaryEpisodeReply(onSummary: () => void, followupReplyChars = 712) {
    const staged = new Set<string>();
    return (body: any) => {
        if (body.messages[0].content.startsWith('Produce a source-grounded summary')) {
            const { source: material } = historySummaryMaterials(body);
            const sourceText = (source: any) => typeof source.content === 'string' ? source.content
                : source.content.segments.map((segment: any) => segment.text.repeat(segment.count)).join('');
            const source = material.sourceMessages.filter((item: any) => item.role === 'user'
                && fixture.summaryUpdates.some((update: string) => sourceText(item).endsWith(update))).at(-1);
            const previous = material.previousSummary ?? {};
            expect(material.sourceMessages.every((source: any) => source.index > 0 && source.end >= source.start)).toBe(true);
            expect(previous.completed ?? []).toEqual([]);
            expect(previous.open_questions ?? []).toEqual([]);
            onSummary();
            const currentUpdate = source && fixture.summaryUpdates.find((update: string) => sourceText(source).endsWith(update));
            const decisions = currentUpdate ? [{ text: `用户原文：${currentUpdate.split('同时依据')[0]}`, sourceMessages: [source.index] }]
                : previous.decisions ?? [];
            return { role: 'assistant', content: JSON.stringify({ goals: [], constraints: [], decisions, completed: [],
                open_questions: [], facts: [] }) };
        }
        const current = [...body.messages].reverse().find((message: any) => message.role === 'user')?.content;
        const text = typeof current === 'string' ? (current.split('User input:\n').at(-1) ?? '').split('\n\n<runtime_instruction>')[0] : '';
        const seedIndex = fixture.summaryOperationSeeds.findIndex((seed: string) => text.endsWith(seed));
        if (seedIndex >= 0 && !staged.has(text)) {
            staged.add(text);
            return { role: 'assistant', content: '', tool_calls: [{ index: 0, id: `summary-operation-${seedIndex}`,
                type: 'function', function: { name: 'vault_append', arguments: JSON.stringify({
                    path: `${fixture.syntheticPrefix}${seedIndex === 0 ? 'source' : 'new-source'}.md`,
                    content: `B157 摘要操作 ${seedIndex === 0 ? 'A' : 'B'}`,
                }) } }] };
        }
        const correction = fixture.summaryUpdates.findIndex((update: string) => text.endsWith(update));
        const verification = /请简短核对当前方案和原操作状态，沿用已有最新决定，不新增任务、写入或发布授权。$/.test(text);
        if (followupReplyChars && (correction >= 0 || verification)) {
            const sample = verification ? text.match(/样本-(\d+)-00/)?.[1] : undefined;
            const label = correction >= 0 ? `修正${String.fromCharCode(65 + correction)}` : `核对${String.fromCharCode(65 + Number(sample))}`;
            return { role: 'assistant', content: recordedNeutralReply(label, followupReplyChars) };
        }
        return { role: 'assistant', content: '已收到合成说明。' };
    };
}

function assertSummaryOperations(episode: any) {
    const diagnostics = { error: episode.error, turns: episode.turns.length,
        turnErrors: episode.turns.map((turn: any) => turn.error),
        toolCalls: episode.providerInputs.flatMap((input: any) => input.body.messages.flatMap((message: any) =>
            message.tool_calls?.map((call: any) => call.function.name) ?? [])),
        lastUserTails: episode.providerInputs.slice(0, 4).map((input: any) =>
            input.body.messages.filter((message: any) => message.role === 'user').at(-1)?.content?.slice(-190)),
        beforeReopenPresent: Boolean(episode.summaryStateBeforeReopen) };
    if (!diagnostics.beforeReopenPresent) throw new Error(JSON.stringify(diagnostics));
    expect(episode.summaryStateBeforeReopen.map((turn: any) => turn.assistant.actionStates[0].phase)).toEqual(['completed', 'pending']);
    expect(episode.summaryStateAfterReopen.map((turn: any) => turn.assistant.actionStates[0].phase)).toEqual(['completed', 'lost']);
    expect(episode.confirmations).toHaveLength(1);
    expect(episode.confirmations[0]).toMatchObject({ domain: 'operations', boundary: 'actual-session-confirm',
        intentId: episode.summaryStateAfterReopen[0].assistant.actionStates[0].operationId });
    expect(episode.reopen).toMatchObject({ hydratedTurnCount: 2, newStore: true, newManager: true, newService: true });
    expect(episode.localSyntheticNotes.find((note: any) => note.path.endsWith('/source.md')).content).toContain('B157 摘要操作 A');
    expect(episode.localSyntheticNotes.find((note: any) => note.path.endsWith('/new-source.md')).content).not.toContain('B157 摘要操作 B');
    expect(episode.localMutations.filter((mutation: any) => mutation.path.endsWith('/new-source.md'))).toEqual([]);
}

function summaryHistory(episode: any, preparationIndex = 0) {
    const manager = new ChatHistoryManager({ store: new MemoryChatHistoryStore() });
    const initialTurns = fixture.summaryOperationSeeds.length + fixture.summaryWarmup.length;
    const stored = [...episode.summaryStateBeforeUpdates,
        ...(episode.summaryCorrectionTurns ?? []).map((turn: any) => turn.persistedTurn),
        ...(episode.summaryVerificationTurns ?? []).filter((turn: any) => turn.persistedTurn).map((turn: any) => turn.persistedTurn)]
        .slice(0, initialTurns + preparationIndex);
    const history = stored.flatMap((turn: any) => {
        const hydrated = manager.deserializeTurn(turn); return [hydrated.userMessage, hydrated.assistantMessage];
    });
    const app = harness.createSyntheticApp();
    const turnIndex = initialTurns + preparationIndex;
    const messageId = `b157_${episode.id}_${turnIndex}`;
    const noteFiles = app.vault.getMarkdownFiles();
    const sourceRun = new TaskSourceRun({
        runId: episode.turns[turnIndex].events.find((event: any) => event.type === 'agent_start').runId,
        conversationId: episode.summaryStateBeforeUpdates[0].conversationId, userMessageId: messageId,
        runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: `scope_${messageId}`,
            userMessageId: messageId, persistedSelectionRevision: 0 },
        userText: episode.turns[turnIndex].userText, workspace: app.workspace,
        getFileByPath: (path: string) => app.vault.getAbstractFileByPath(path),
        isCurrent: () => noteFiles.every((file: any) => app.vault.getAbstractFileByPath(file.path) === file),
        isMemoryAllowed: () => true, isWebAllowed: () => false,
        isPathAllowed: (path: string) => path.startsWith(fixture.syntheticPrefix),
        getMemoryEvidenceEpoch: () => 'b157-synthetic-source-epoch',
    });
    const admitted = sourceRun.projectHistory(history);
    expect(admitted).toHaveLength(history.length);
    return admitted;
}

function summaryFreeAllowance(episode: any, preparationIndex = 0): number {
    const history = summaryHistory(episode, preparationIndex), plan = planHistoryContext(history, fixture.summaryHistoryBudgetChars);
    const covered = history.slice(0, plan.coveredMessages);
    const host = buildPaAgentDeterministicActionSummary(projectPaAgentRetainedActionFacts(covered), covered);
    const empty = { goals: [], constraints: [], decisions: [], completed: [], open_questions: [], facts: [] };
    const free = plan.summaryMaxChars - (JSON.stringify(host).length - JSON.stringify(empty).length)
        - Object.values(host).filter(items => items.length > 0).length;
    expect(free).toBeGreaterThan(JSON.stringify(empty).length);
    expect(free).toBeLessThan(plan.summaryMaxChars);
    return free;
}

function summaryLaneEvidence(episode: any) {
    const history = summaryHistory(episode);
    const projector = new PaAgentContextProjector();
    const project = (chatHistory: any[]) => projector.projectUserInput({ chatHistory,
        prompt: fixture.summaryUpdates[0], maxHistoryChars: fixture.summaryHistoryBudgetChars }).history;
    const protectedOnly = project(history.slice(0, 4)), all = project(history);
    return { budget: fixture.summaryHistoryBudgetChars, protectedOnlyChars: protectedOnly.text.length,
        protectedAndLatestChars: all.text.length, historyBudgetLimited: all.historyBudgetLimited,
        preparations: episode.summaryPreparations.map((item: any) => ({ covered: item.coveredMessageCount,
            summaryChars: item.text?.length, outcome: item.outcome })), turnErrors: episode.turns.map((turn: any) => turn.error) };
}

function assertSummaryPressureAndOverflow(episode: any) {
    const history = summaryHistory(episode), projector = new PaAgentContextProjector();
    const project = (chatHistory: any[], budget: number, summary?: any) => projector.projectUserInput({ chatHistory,
        prompt: fixture.summaryUpdates[0], maxHistoryChars: budget,
        ...(summary ? { summaries: { history: summary } } : {}) }).history;
    expect(project(history, fixture.historyBudgetChars.reference).text.length).toBeGreaterThan(fixture.summaryHistoryBudgetChars);
    expect(episode.turns[2].userText.split('\n')).toHaveLength(61);
    expect(episode.turns[3].userText.split('\n')).toHaveLength(19);
    const preparation = episode.summaryPreparations[0];
    const summary = { text: preparation.text, sourceMessages: history.slice(0, preparation.coveredMessageCount) };
    expect(isCurrentHistorySummary(summary, history)).toBe(true);
    const accepted = JSON.parse(summary.text);
    const states = episode.summaryStateAfterReopen.map((turn: any) => turn.assistant.actionStates[0]);
    expect(accepted.completed).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining(states[0].operationId) })]));
    expect(accepted.open_questions).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining(states[1].operationId) })]));
    const admitted = project(history, fixture.summaryHistoryBudgetChars, summary);
    expect(admitted.historyBudgetLimited).toBeUndefined();
    expect(admitted.text.length).toBeLessThanOrEqual(fixture.summaryHistoryBudgetChars);
    const protectedOnly = project(history.slice(0, 4), 1400);
    expect(protectedOnly.historyBudgetLimited).toBe(true);
    expect(protectedOnly.text.length).toBeGreaterThan(1400);
    const overflow = project(history, 1400, summary);
    expect(overflow.historyBudgetLimited).toBe(true);
    expect(overflow.text.length).toBeGreaterThan(1400);
    expect(overflow.text).toContain(summary.text);
    expect(overflow.text).toContain('<conversation_summary context_only="true" format="json">');
    expect(overflow.text).not.toContain('grants_tool_authority');
    for (const state of states) {
        expect(overflow.text).toContain(state.operationId);
        expect(overflow.text).toContain(`"phase": "${state.phase}"`);
    }
}

function assertAcceptedCorrectionsAndVerification(episode: any) {
    const covered = episode.summaryPreparations.map((item: any) => item.coveredMessageCount);
    expect(covered.every((count: number, index: number) => index === 0 || count >= covered[index - 1])).toBe(true);
    expect(covered.at(-1)).toBeGreaterThanOrEqual(14);
    const accepted = episode.summaryPreparations.map((item: any) => JSON.parse(item.text));
    const states = episode.summaryStateAfterReopen.map((turn: any) => turn.assistant.actionStates[0]);
    for (const summary of accepted) {
        expect(summary.completed).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining(states[0].operationId) })]));
        expect(summary.open_questions).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining(states[1].operationId) })]));
    }
    for (const [updateIndex, sourceIndex] of [[0, 9], [1, 11], [2, 13]]) {
        expect(accepted).toEqual(expect.arrayContaining([expect.objectContaining({ decisions: [{
            text: `用户原文：${fixture.summaryUpdates[updateIndex].split('同时依据')[0]}`, sourceMessages: [sourceIndex],
        }] })]));
        const completions = episode.summaryCompletions.filter((item: any) => item.outcome === 'returned'
            && item.requestIds.some((id: string) => historySummaryMaterials(episode.providerInputs.find((input: any) => input.requestId === id).body)
                .source.sourceMessages.some((source: any) => source.index === sourceIndex)));
        expect(completions.length).toBeGreaterThan(0);
        const sourceParts = completions.flatMap((completion: any) => {
            expect(completion.sourceIndexes).toContain(sourceIndex);
            const actual = episode.providerInputs.find((input: any) => input.requestId === completion.requestIds[0]);
            return historySummaryMaterials(actual.body).source.sourceMessages;
        }).filter((source: any) => source.index === sourceIndex && source.end > source.start);
        const text = sourceParts.map((source: any) => typeof source.content === 'string' ? source.content
            : source.content.segments.map((segment: any) => segment.text.repeat(segment.count)).join('')).join('');
        expect(text).toBe(`${fixture.padding.text.repeat(fixture.padding.repeat)}\n${fixture.summaryUpdates[updateIndex]}`);
    }
    const nineDay = accepted.find((summary: any) => summary.decisions.some((item: any) => item.sourceMessages.includes(11)));
    expect(nineDay.decisions[0].text).toContain('保留 9 天');
    const latestSemantic = accepted.filter((summary: any) => summary.decisions.length > 0).at(-1);
    expect(latestSemantic.decisions[0].sourceMessages).toEqual([13]);
    expect(latestSemantic.decisions[0].text).toContain('保留改为 11 天');
    expect(latestSemantic.decisions[0].text).not.toMatch(/保留 9 天|17 天|银杏/);
    const semanticUpdates = accepted.filter((item: any) => item.decisions.length > 0);
    expect(new Set(semanticUpdates.map((item: any) => JSON.stringify(item.decisions))).size).toBe(3);
    const replies = episode.turns.slice(4).filter((turn: any) => !turn.error).map((turn: any) => turn.answer);
    expect(replies.every((content: string) => content.length === 712)).toBe(true);
    expect(replies).toHaveLength(episode.status === 'failed' ? 4 : 5);
    expect(new Set(replies).size).toBe(replies.length);
    for (const content of replies) {
        expect(content).not.toMatch(/银杏|枫树|17\s*天|9\s*天|11\s*天|completed|lost|applied/);
        const reply = { role: 'assistant' as const, content };
        expect(formatHistoryMessages([reply], true)).toBe(formatHistoryMessages([reply]));
    }
    for (const [index, verification] of episode.summaryVerificationTurns.entries()) {
        expect(verification).toMatchObject({ turnIndex: 7 + index, userSourceIndex: 15 + 2 * index, materialParts: 12 });
        const text = episode.turns[verification.turnIndex].userText;
        expect(text.split('\n')).toHaveLength(13);
        expect(text).toContain(`样本-${index + fixture.summaryWarmup.length}-00：${fixture.summaryWarmupMaterial.text}`);
        expect(text).toContain(`样本-${index + fixture.summaryWarmup.length}-11：${fixture.summaryWarmupMaterial.text}`);
        expect(text).toMatch(/请简短核对当前方案和原操作状态，沿用已有最新决定，不新增任务、写入或发布授权。$/);
        expect(text).not.toMatch(/银杏|枫树|17\s*天|9\s*天|11\s*天|completed|lost/);
        if (verification.status === 'completed') expect(verification.persistedTurn.user.content).toBe(text);
    }
}

function projectedHistoryRecords(input: any) {
    const historyMessages = input.body.messages.filter((message: any) => message.role === 'user'
        && typeof message.content === 'string' && (message.content.startsWith('Recent chat history:\n')
            || message.content.startsWith('<chat_history ')));
    expect(historyMessages).toHaveLength(1);
    const records = JSON.parse(historyMessages[0].content.match(/<chat_history[^>]*>\n([\s\S]*?)\n<\/chat_history>/)[1]);
    const decode = (content: any) => typeof content === 'string' ? content
        : content.segments.map((segment: any) => segment.text.repeat(segment.count)).join('');
    for (const record of records) {
        record.content = decode(record.content);
        for (const group of record.actionHistory ?? []) for (const call of group.calls) for (const result of call.results) {
            result.text = decode(result.text);
        }
    }
    return records;
}

async function assertOldCapacityBoundary(episode: any) {
    // Replay the observed owner-reply lengths and long explanatory reply using
    // real admitted UUID states. Removing redundant provider permission flags
    // makes this former 3600-lane overflow reachable. The original failed live
    // report remains historical evidence, not the current formatter's boundary.
    const history = summaryHistory(episode, 1).map((message: any, index: number) => ({ ...message,
        content: index === 1 ? recordedNeutralReply('原回执甲', 86)
            : index === 3 ? recordedNeutralReply('原回执乙', 90) : message.content }));
    expect(history[9].content).toHaveLength(712);
    const facts = projectPaAgentRetainedActionFacts(history), text = JSON.stringify(buildPaAgentDeterministicActionSummary(facts, history));
    const reachablePlan = planHistoryContext(history, 3600);
    expect(reachablePlan.summaryMaxChars).toBeGreaterThanOrEqual(text.length);
    const requests: any[] = [], summarizer = new PaAgentContextSummarizer();
    let summary: any;
    try {
        summary = await summarizer.prepareHistory({ history, historyBudgetChars: 3600,
            invoke: async request => {
                requests.push(request);
                return { content: JSON.stringify({ goals: [], constraints: [], decisions: [], completed: [], open_questions: [], facts: [] }) };
            } });
    } finally { summarizer.dispose(); }
    expect(requests.length).toBeGreaterThan(0);
    expect(summary).toMatchObject({ text, sourceMessages: history.slice(0, reachablePlan.coveredMessages) });
    const payloads = requests.map(historySummaryMaterials);
    expect([...new Set(payloads.flatMap(({ source }) => source.sourceMessages.map((part: any) => part.index)))])
        .toEqual(Array.from({ length: reachablePlan.coveredMessages }, (_, index) => index + 1));
    for (const { source, actionFacts } of payloads) {
        expect(actionFacts.retainedActionFacts).toEqual(projectPaAgentRetainedActionFacts(summary.sourceMessages));
        for (const part of source.sourceMessages) {
            const content = typeof part.content === 'string' ? part.content
                : part.content.segments.map((segment: any) => segment.text.repeat(segment.count)).join('');
            expect(content).toBe(history[part.index - 1].content.slice(part.start, part.end));
        }
    }
    const layout = finishContextSteps(protectedHistoryLayoutSteps(history));
    const mandatory = finishContextSteps(selectHistoryTurnsSteps(layout.evidenceTurns, layout.mandatoryIndices));
    const necessaryChars = Math.min(formatHistoryMessages(mandatory).length, formatHistoryMessages(mandatory, true).length)
        + formatSemanticHistorySummary(text).length + 2;
    const insufficientBudget = necessaryChars - 1;
    expect(insufficientBudget).toBeLessThan(3600);
    const insufficientPlan = planHistoryContext(history, insufficientBudget);
    expect(insufficientPlan.summaryMaxChars).toBe(text.length - 1);
    let auxCalls = 0;
    const blockedSummarizer = new PaAgentContextSummarizer();
    try {
        expect(await blockedSummarizer.prepareHistory({ history, historyBudgetChars: insufficientBudget,
            invoke: async () => { auxCalls++; throw new Error('Unreachable: necessary facts do not fit.'); } })).toBeUndefined();
    } finally { blockedSummarizer.dispose(); }
    expect(auxCalls).toBe(0);
    const projector = new PaAgentContextProjector();
    const blocked = projector.projectUserInput({ chatHistory: history, prompt: fixture.summaryUpdates[1], maxHistoryChars: insufficientBudget,
        summaries: { history: summary } }).history;
    expect(blocked.historyBudgetLimited).toBe(true);
    expect(blocked.text.length).toBe(necessaryChars);
    const reachable = projector.projectUserInput({ chatHistory: history, prompt: fixture.summaryUpdates[1], maxHistoryChars: 3600,
        summaries: { history: summary } }).history;
    expect(reachable.historyBudgetLimited).toBeUndefined();
    expect(reachable.text.length).toBeLessThanOrEqual(3600);
    const next = projector.projectUserInput({ chatHistory: history, prompt: fixture.summaryUpdates[1],
        maxHistoryChars: fixture.summaryHistoryBudgetChars, summaries: { history: summary } }).history;
    expect(next.historyBudgetLimited).toBeUndefined();
    expect(next.text.length).toBeLessThanOrEqual(fixture.summaryHistoryBudgetChars);
    expect(Math.min(formatHistoryMessages(history).length, formatHistoryMessages(history, true).length)).toBeGreaterThan(fixture.summaryHistoryBudgetChars);
    const expected = projectedHistoryRecords({ body: { messages: [{ role: 'user', content: formatHistoryMessages(mandatory) }] } });
    for (const projection of [blocked, reachable, next]) {
        expect(projectedHistoryRecords({ body: { messages: [{ role: 'user', content: `Recent chat history:\n${projection.text}` }] } }))
            .toEqual(expected);
    }
    for (const turn of episode.summaryStateAfterReopen) {
        expect(blocked.text).toContain(turn.assistant.actionStates[0].operationId);
        expect(reachable.text).toContain(turn.assistant.actionStates[0].operationId);
        expect(next.text).toContain(turn.assistant.actionStates[0].operationId);
    }
}

describe('B157 independent context harness contracts (offline)', () => {
    it('schedules exactly four domains × three followups × both arms with independent fixture identity', () => {
        const episodes = harness.episodeSchedule();
        expect(episodes).toHaveLength(24);
        expect(new Set(episodes.map((item: any) => item.domain))).toEqual(new Set(['image', 'ghost', 'writing', 'operations']));
        for (const domain of ['image', 'ghost', 'writing', 'operations']) {
            expect(episodes.filter((item: any) => item.domain === domain)).toHaveLength(6);
        }
        expect(fixture.summaryUpdates).toHaveLength(3);
        expect(fixture.historyBudgetChars.reference).toBeGreaterThan(fixture.historyBudgetChars.candidate);
        expect(info.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('requires an explicit positive physical cap without inheriting B149 maxRequests <= 50', () => {
        const valid = { maxRequests: 151, expectedBundleSha256: 'a'.repeat(64), expectedHarnessSha256: 'b'.repeat(64),
            harnessPath: 'B157-context-eval/b157-context-eval.js', expectedPluginVersion: 'synthetic-version' };
        expect(harness.validateStartOptions(valid)).toBe(valid);
        for (const maxRequests of [undefined, 0, -1, 1.2, Infinity]) {
            expect(() => harness.validateStartOptions({ ...valid, maxRequests })).toThrow('EXPLICIT_REQUEST_CAP_REQUIRED');
        }
        expect(() => harness.validateStartOptions({ ...valid, caseIds: ['E-01'] })).toThrow('INVALID_CASE_SELECTION');
        expect(() => harness.validateStartOptions({ ...valid, harnessPath: '../private.js' })).toThrow('SYNTHETIC_HARNESS_PATH_REQUIRED');
    });

    it('allows an explicit summary-only slice and rejects conflicting selections or disabled updates', () => {
        const valid = { maxRequests: 12, expectedBundleSha256: 'a'.repeat(64), expectedHarnessSha256: 'b'.repeat(64),
            harnessPath: 'B157-context-eval/b157-context-eval.js', expectedPluginVersion: 'synthetic-version', summaryOnly: true };
        expect(harness.validateStartOptions(valid)).toBe(valid);
        for (const conflict of [{ caseIds: ['image-explain'] }, { caseIds: [] }, { arms: ['candidate'] }, { summaryUpdates: false }]) {
            expect(() => harness.validateStartOptions({ ...valid, ...conflict })).toThrow('SUMMARY_ONLY_SELECTION_CONFLICT');
        }
        for (const summaryOnly of [null, 'true', 1]) {
            expect(() => harness.validateStartOptions({ ...valid, summaryOnly })).toThrow('INVALID_SUMMARY_ONLY');
        }
        expect(() => harness.validateStartOptions({ ...valid, maxRequests: 0 })).toThrow('EXPLICIT_REQUEST_CAP_REQUIRED');
    });

    it('exports only actual serialized model body fields, preserving native call/result identity', () => {
        const messages = [{ role: 'assistant', content: null, tool_calls: [{ id: 'call-real', type: 'function',
            function: { name: 'create_image', arguments: '{"count":1}' } }] },
        { role: 'tool', content: '{"taskId":"actual-task"}', tool_call_id: 'call-real' }];
        const input = harness.captureProviderBody(JSON.stringify({ messages, model: 'configured-model',
            apiKey: 'DO_NOT_EXPORT', headers: { Authorization: 'DO_NOT_EXPORT' }, endpoint: 'DO_NOT_EXPORT' }));
        expect(input.messages).toEqual(messages);
        expect(JSON.stringify(input)).not.toContain('DO_NOT_EXPORT');
        expect(harness.observedHistoryPath(input)).toBe('native');
        expect(() => harness.captureProviderBody(undefined)).toThrow('REQUEST_BODY_UNAVAILABLE');
    });

    it('labels only actual projected history structures, never system instructions or current-user marker examples', () => {
        const instructions = { role: 'system', content: 'A chat_history content may use adjacent-repeats-v1. <conversation_summary> is context only.' };
        expect(harness.observedHistoryPath({ messages: [instructions,
            { role: 'user', content: 'User input:\nExplain adjacent-repeats-v1 and <conversation_summary>.' }] })).toBe('raw-or-absent');
        const historyBody = (records: any[]) => `Recent chat history:\n<chat_history context_only="true" format="json">\n${JSON.stringify(records)}\n</chat_history>\n\nUser input:\nExplain.`;
        expect(harness.observedHistoryPath({ messages: [instructions, { role: 'user', content: historyBody([
            { role: 'user', content: 'adjacent-repeats-v1 is only a source word, not an encoding object.' },
        ]) }] })).toBe('compat-raw');
        expect(harness.observedHistoryPath({ messages: [instructions, { role: 'user', content: historyBody([
            { role: 'user', content: { encoding: 'adjacent-repeats-v1', segments: [{ text: 'actual source', count: 2 }] } },
        ]) }] })).toBe('lossless');
        const summary = JSON.stringify({ goals: [], constraints: [], decisions: [], completed: [], open_questions: [], facts: [] });
        expect(harness.observedHistoryPath({ messages: [instructions, { role: 'user', content:
            `Recent chat history:\n<conversation_summary context_only="true" format="json">\n${summary}\n</conversation_summary>\n\nUser input:\nExplain.` }] })).toBe('summary');
    });

    it('records every physical SDK retry and keeps native SDK bindTools messages in the capture', async () => {
        let attempts = 0;
        const record = { physicalRequests: 0, dispatchTrace: [], providerInputs: [] };
        const control = { maximum: 3, count: 0, assertCurrent: () => undefined, abort: jest.fn() };
        const service = { aiUtils: { createChatModel: async (_temperature: number, options: any) => new ChatOpenAI({
            model: 'synthetic-model', apiKey: 'SYNTHETIC_NEVER_SENT', maxRetries: 1,
            configuration: { baseURL: 'https://synthetic.invalid/v1', fetch: async (_url, init) => {
                options.onProviderRequestStart(); attempts++;
                options.onProviderRequestTrace({ phase: 'http_dispatch', transport: 'native', requestId: `retry-${attempts}` });
                if (attempts === 1) return new Response('{"error":{"message":"synthetic","type":"rate_limit"}}',
                    { status: 429, headers: { 'retry-after-ms': '1', 'content-type': 'application/json' } });
                const body = JSON.parse(String(init?.body));
                return new Response(JSON.stringify({ id: 'completion', object: 'chat.completion', created: 0,
                    model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: '合成回答' }, finish_reason: 'stop' }] }),
                { headers: { 'content-type': 'application/json' } });
            } },
        }) } };
        harness.installDispatchRecorder(service, control, record);
        const model = await service.aiUtils.createChatModel(0.5, {});
        await model.bindTools([{ type: 'function', function: { name: 'create_image', description: 'Synthetic recording port.',
            parameters: { type: 'object', properties: {} } } }]).invoke([
            new HumanMessage('解释旧结果'), new AIMessage({ content: '', tool_calls: [{ id: 'native-id',
                name: 'create_image', args: { count: 1 }, type: 'tool_call' }] }),
            new ToolMessage({ content: '{"taskId":"real-task"}', tool_call_id: 'native-id' }),
        ]);
        expect(attempts).toBe(2);
        expect(control.count).toBe(2);
        expect(record.physicalRequests).toBe(2);
        expect(record.providerInputs).toHaveLength(2);
        expect((record.providerInputs[1] as any).body.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'native-id' })] }),
            expect.objectContaining({ role: 'tool', tool_call_id: 'native-id', content: '{"taskId":"real-task"}' }),
        ]));
    });

    it('rejects a retry at the physical limit before calling its recording transport', async () => {
        let dispatched = 0, aborted = false;
        const record = { physicalRequests: 0, dispatchTrace: [], providerInputs: [] };
        const control = { maximum: 1, count: 0, assertCurrent: () => { if (aborted) throw new Error('B157_ABORTED'); },
            abort: () => { aborted = true; } };
        const service = { aiUtils: { createChatModel: async (_temperature: number, options: any) => ({ clientConfig: {
            fetch: async (_input: unknown, _init: unknown) => { options.onProviderRequestStart(); dispatched++; return new Response('{}'); },
        } }) } };
        harness.installDispatchRecorder(service, control, record);
        const model = await service.aiUtils.createChatModel(0.5, {});
        await model.clientConfig.fetch('never-observed', { body: '{"messages":[]}' });
        await expect(model.clientConfig.fetch('never-observed', { body: '{"messages":[]}' })).rejects.toThrow('B157_REQUEST_CAP_REACHED');
        expect(dispatched).toBe(1);
        expect(control.count).toBe(1);
        expect((record.providerInputs[1] as any).status).toBe('rejected_before_dispatch');
        expect((record.providerInputs[1] as any).requestId).toBeUndefined();
    });

    it('loads a ready handle without creating a ChatService, changing settings or dispatching', async () => {
        const createChatService = jest.fn();
        const plugin = { createChatService, settings: Object.freeze({ aiProvider: 'actual-provider', chatModelName: 'actual-model' }) };
        const app = { vault: { getName: () => 'test' }, plugins: { plugins: { 'personal-assistant': plugin } } };
        const handle = harness.installB157ContextEval(app);
        expect(handle.state.status).toBe('ready');
        expect(handle.state.humanVerdict).toBe('pending');
        expect(createChatService).not.toHaveBeenCalled();
        expect(handle.safeExport()).toEqual(handle.state);
        expect(handle.markBeforeReload().status).toBe('marked_requires_reload');
        await handle.cleanup();
        expect(plugin.settings.chatModelName).toBe('actual-model');
    });

    it('keeps synthetic local writes inside the isolated vault and blocks unrelated reads/writes', async () => {
        const app = harness.createSyntheticApp();
        const source = app.vault.getAbstractFileByPath('B157-context-eval/source.md');
        expect(source.vault).toBe(app.vault);
        expect(source.parent.path).toBe('B157-context-eval');
        expect(app.vault.getRoot().vault).toBe(app.vault);
        const { TFile, TFolder } = require('obsidian');
        expect(() => new TFile()).toThrow('requires (vault, path)');
        expect(() => new TFolder()).toThrow('requires (vault, path)');
        await app.vault.process(source, (text: string) => `${text}真实合成服务修改\n`);
        expect(app.synthetic.mutations).toEqual([expect.objectContaining({ kind: 'process', path: source.path })]);
        await expect(app.vault.create('private.md', 'never admitted')).rejects.toThrow('SYNTHETIC_PATH_ONLY');
        await expect(app.vault.read({ path: 'private.md' })).rejects.toThrow('SYNTHETIC_PATH_ONLY');
        expect(app.synthetic.allowed('pa-images/output.png')).toBe(false);
        expect(app.synthetic.storageAllowed('pa-images/output.png')).toBe(true);
    });

    it('uses actual lifecycle messages for canonical conversion, never prose as a terminal receipt', () => {
        const recorder = harness.lifecycleRecorder();
        expect(() => recorder.canonical()).toThrow('CANONICAL_LIFECYCLE_MISSING');
        const common = { version: 2, runId: 'run', seq: 1, timestamp: 1 };
        recorder.observe({ ...common, type: 'agent_start', turnId: 'run', scope: 'run' });
        recorder.observe({ ...common, type: 'turn_start', turnId: 'turn', scope: 'turn' });
        recorder.observe({ ...common, type: 'message_end', turnId: 'turn', scope: 'turn', message: {
            id: 'actual-assistant', role: 'assistant', runId: 'run', turnId: 'turn', createdAt: 1,
            content: [{ type: 'text', text: '我猜测已经生成图片' }],
        } });
        recorder.commit('我猜测已经生成图片');
        const canonical = recorder.canonical();
        expect(canonical.messages).toHaveLength(1);
        expect(canonical.actionStates).toEqual([]);
    });

    it('runs a real ChatService image turn, real background completion, store/hydrate and a new service before followup', async () => {
        let dispatches = 0, responseIndex = 0;
        const backendBodies: any[] = [];
        const plugin: any = { manifest: { version: 'synthetic-version' }, settings: {
            aiProvider: 'qwen', chatModelName: 'synthetic-model', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            qwenThinkingEnabled: false, licenseTier: 'paid',
        }, createChatService() {
            const host: any = { settings: plugin.settings, app: harness.createSyntheticApp(),
                isOperationsAgentEnabled: true, getAPIToken: async () => 'synthetic-placeholder', log: () => undefined };
            const service: any = new ChatService(host);
            service.aiUtils.createChatModel = async (_temperature: number, options: any) => new ChatOpenAI({
                model: plugin.settings.chatModelName, apiKey: 'SYNTHETIC_NEVER_SENT', maxRetries: 0,
                configuration: { baseURL: 'https://synthetic.invalid/v1', fetch: async (_url, init) => {
                    await options.prepareProviderRequest?.(init?.signal);
                    options.onProviderRequestStart?.(); dispatches++;
                    const body = JSON.parse(String(init?.body)); backendBodies.push(body);
                    const tool = responseIndex++ === 0;
                    const message = tool ? { role: 'assistant', content: '', tool_calls: [{ index: 0,
                        id: 'b157-actual-call', type: 'function', function: { name: 'create_image',
                            arguments: JSON.stringify({ prompt: 'Synthetic ginkgo tree', operation: 'generate', count: 1 }) } }] }
                        : { role: 'assistant', content: '合成图片已有任务；只解释现有结果。' };
                    const common = { id: `synthetic-${responseIndex}`, created: 0, model: plugin.settings.chatModelName };
                    const data = body.stream ? `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk',
                        choices: [{ index: 0, delta: message, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
                        : JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message,
                            finish_reason: tool ? 'tool_calls' : 'stop' }] });
                    return traceProviderDispatch(async () => new Response(data, { headers: {
                        'content-type': body.stream ? 'text/event-stream' : 'application/json' } }),
                    'native', options.onProviderRequestTrace, init?.body, () => true);
                } },
            });
            return service;
        } };
        const bundle = 'synthetic deployed plugin bundle', script = 'synthetic verified harness bytes';
        const app: any = { vault: { getName: () => 'test', configDir: '.obsidian',
            adapter: { read: async (path: string) => path.endsWith('main.js') ? bundle : script } },
        plugins: { plugins: { 'personal-assistant': plugin } } };
        (globalThis as any).__b157PreReloadPlugin = { oldInstance: true };
        const handle = harness.installB157ContextEval(app);
        const report = await handle.start({ maxRequests: 20, expectedBundleSha256: sha(bundle),
            expectedHarnessSha256: sha(script), expectedPluginVersion: 'synthetic-version',
            harnessPath: 'B157-context-eval/b157-context-eval.js', caseIds: ['image-explain'], arms: ['candidate'], summaryUpdates: false });
        expect({ status: report.status, error: report.error, episode: report.results[0]?.error }).toEqual({
            status: 'recorded_for_review', error: null, episode: undefined });
        const episode = report.results[0];
        expect(episode.reopen).toMatchObject({ newStore: true, newManager: true, newService: true, hydratedTurnCount: 1 });
        expect(episode.domainEvents).toEqual(expect.arrayContaining([expect.objectContaining({ owner: 'image-service', state: 'completed' })]));
        expect(episode.domainStateAfterEvents[0].assistant.actionStates).toEqual(expect.arrayContaining([
            expect.objectContaining({ owner: 'image', phase: 'completed', receipt: expect.objectContaining({ kind: 'image-task', state: 'completed' }) }),
        ]));
        expect(episode.turns[0].canonical.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'toolResult', toolCallId: 'b157-actual-call' }),
        ]));
        expect(episode.persistedAfterFollowup[0].assistant.actionStates[0].phase).toBe('completed');
        expect(episode.submissions.filter((item: any) => item.domain === 'image' && item.method === 'POST')).toHaveLength(1);
        expect(episode.followupSubmissions).toEqual([]);
        expect(report.physicalRequests).toBe(dispatches);
        expect(episode.providerInputs.map((item: any) => item.body)).toEqual(backendBodies.map(body => harness.captureProviderBody(JSON.stringify(body))));
        expect(episode.providerInputs.every((item: any) => /^http_/.test(item.requestId))).toBe(true);
        expect(episode.humanVerdict).toBe('pending');
        await handle.cleanup();
    }, 20_000);

    it('uses real WritingSaveAction create→process failure and leaves a non-completed durable receipt', async () => {
        const { MemoryChatHistoryStore } = await import('../src/chat/chat-history-store');
        const store = new MemoryChatHistoryStore(); await store.initialize();
        const app = harness.createSyntheticApp();
        const record: any = { id: 'writing-unknown-offline', submissions: [], domainEvents: [], confirmations: [] };
        const domains = harness.createControlledDomains(app, store, record);
        try {
            const version = await domains.versions.create({ requestId: 'actual-writing-request', messageId: 'actual-writing-message',
                conversationId: 'writing-conversation', turnIndex: 0, text: '合成作品正文', explanation: '', images: [] });
            const preview = await domains.save.prepare({ writingVersionId: version.id, targetNotePath: 'B157-context-eval/unknown-save.md' });
            app.synthetic.failNext('process');
            const failed = await domains.save.execute(preview.operationId);
            expect(failed).toMatchObject({ state: 'partial', noteState: 'created', failureReason: 'write_failed' });
            expect(failed.resultFact).toBeUndefined();
            const receipt = (await domains.save.listReceipts())[0];
            expect(app.synthetic.mutations).toEqual(expect.arrayContaining([
                expect.objectContaining({ kind: 'create', path: 'B157-context-eval/unknown-save.md' }),
                expect.objectContaining({ kind: 'process', path: 'B157-context-eval/unknown-save.md' }),
            ]));
            expect(receipt.noteState).not.toBe('completed');
            expect(receipt.state).not.toBe('completed');
        } finally { await domains.dispose(); }
    });

    it('carries three corrections into accepted summaries through original updates and natural verification turns', async () => {
        let summaries = 0;
        const summaryReply = summaryEpisodeReply(() => summaries++);
        const setup = offlineServicePlugin((body, index) => {
            if (index === 0) return { role: 'assistant', content: '', tool_calls: [{ index: 0, id: 'summary-seed-image',
                type: 'function', function: { name: 'create_image', arguments: '{"prompt":"Synthetic ginkgo","operation":"generate","count":1}' } }] };
            return summaryReply(body);
        });
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            const report = await handle.start({ ...setup.options, caseIds: ['image-explain'], arms: ['reference'] });
            const episode = report.results.find((item: any) => item.caseId === 'three-summary-updates');
            assertSummaryOperations(episode);
            expect(report).toMatchObject({ status: 'recorded_for_review', error: null });
            expect(report.physicalRequests).toBe(setup.bodies.length);
            expect(episode.turns.map((turn: any) => turn.error)).toEqual(Array(episode.turns.length).fill(undefined));
            const auxiliaryInputs = episode.providerInputs.filter((input: any) =>
                input.body.messages[0].content.startsWith('Produce a source-grounded summary'));
            expect(summaries).toBe(auxiliaryInputs.length);
            expect(summaries).toBeGreaterThanOrEqual(fixture.summaryUpdates.length);
            const preparations = episode.summaryPreparations.filter((item: any) => item.text);
            expect(episode.summaryEvidence).toMatchObject({ summaryCallCount: auxiliaryInputs.length,
                preparedSummaryCount: preparations.length,
                coveredMessageCounts: preparations.map((item: any) => item.coveredMessageCount),
                verificationTurnIndices: episode.summaryVerificationTurns.map((item: any) => item.turnIndex) });
            expect(episode.providerInputs.filter((item: any) => item.historyPath === 'summary'))
                .toHaveLength(fixture.summaryUpdates.length + episode.summaryVerificationTurns.length);
            assertAcceptedCorrectionsAndVerification(episode);
            expect(episode.humanVerdict).toBe('pending');
        } finally { await handle.cleanup(); }
    }, 20_000);

    it('does not mistake short-reply cache preparations for coverage of the later corrections', async () => {
        const setup = offlineServicePlugin(summaryEpisodeReply(() => undefined, 0));
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            const report = await handle.start({ ...setup.options, summaryOnly: true }), episode = report.results[0];
            expect(report).toMatchObject({ status: 'recorded_for_review', physicalRequests: 13, humanVerdict: 'pending' });
            assertSummaryOperations(episode);
            const plannedCoverage = episode.summaryPreparations.map((_item: any, index: number) =>
                planHistoryContext(summaryHistory(episode, index), fixture.summaryHistoryBudgetChars).coveredMessages);
            expect(episode.summaryEvidence).toMatchObject({ summaryCallCount: 2, observedSummaryUpdates: 1, preparedSummaryCount: 5,
                coveredMessageCounts: plannedCoverage });
            const returned = episode.summaryCompletions.filter((item: any) => item.outcome === 'returned');
            expect(returned).toHaveLength(2);
            const actualPayloads = returned.map((completion: any) => {
                const dispatched = episode.providerInputs.find((input: any) => input.requestId === completion.requestIds[0]);
                expect(completion.requestIds).toHaveLength(1);
                return historySummaryMaterials(dispatched.body).source;
            });
            // Physical calls consume distinct ordinary source intervals;
            // cached preparations alone cannot prove the 9/11-day corrections
            // entered the semantic prefix.
            expect(actualPayloads.map((payload: any) => [...new Set(payload.sourceMessages.map((part: any) => part.index))]))
                .toEqual([[1, 2, 3, 4, 5, 6], [7, 8]]);
            const lastHistory = summaryHistory(episode, 4);
            for (const payload of actualPayloads) for (const part of payload.sourceMessages) {
                const text = typeof part.content === 'string' ? part.content
                    : part.content.segments.map((segment: any) => segment.text.repeat(segment.count)).join('');
                expect(text).toBe(lastHistory[part.index - 1].content.slice(part.start, part.end));
            }
            expect(new Set(episode.summaryPreparations.slice(0, 4).map((item: any) => item.text)).size).toBe(1);
            const last = JSON.parse(episode.summaryPreparations.at(-1).text);
            expect(last.decisions).toEqual([]);
            const records = projectedHistoryRecords(episode.providerInputs.filter((input: any) => input.historyPath === 'summary').at(-1));
            for (const index of [0, 1, 2]) {
                expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user',
                    content: `${fixture.padding.text.repeat(fixture.padding.repeat)}\n${fixture.summaryUpdates[index]}` })]));
            }
            expect(episode.humanVerdict).toBe('pending');
        } finally { await handle.cleanup(); }
    }, 20_000);

    it.each([15, 13, 12])('runs actual seeds, original corrections and natural verification through ChatService with physical cap %i', async maxRequests => {
        let summaries = 0;
        const setup = offlineServicePlugin(summaryEpisodeReply(() => summaries++));
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            const options = { ...setup.options, summaryOnly: true, maxRequests };
            if (maxRequests === 15) {
                await expect(handle.start({ ...options, expectedHarnessSha256: '0'.repeat(64) })).rejects.toThrow('DEPLOYED_BUNDLE_MISMATCH');
                expect(setup.bodies).toEqual([]);
            }
            const report = await handle.start(options), episode = report.results[0];
            const complete = maxRequests >= 15, verified = maxRequests >= 14;
            const actualAuxCalls = maxRequests >= 14 ? 4 : 3;
            expect(report.summaryOnly).toBe(true);
            expect(report.results).toHaveLength(1);
            expect(episode.caseId).toBe('three-summary-updates');
            expect(episode.submissions).toEqual([]);
            assertSummaryOperations(episode);
            expect({ status: report.status, error: report.error, physicalRequests: report.physicalRequests, summaries,
                lane: summaryLaneEvidence(episode) }).toEqual({ status: complete ? 'recorded_for_review' : 'aborted',
                error: complete ? null : expect.any(String), physicalRequests: complete ? 15 : maxRequests, summaries: actualAuxCalls,
                lane: expect.objectContaining({ budget: fixture.summaryHistoryBudgetChars, historyBudgetLimited: undefined }) });
            expect(episode.turns).toHaveLength(maxRequests >= 13 ? 9 : 8);
            for (let index = 0; index < fixture.summaryOperationSeeds.length; index++) {
                expect(episode.turns[index].userText).toBe(fixture.summaryOperationSeeds[index]);
            }
            for (let index = 0; index < fixture.summaryWarmup.length; index++) {
                expect(episode.turns[index + fixture.summaryOperationSeeds.length].userText.endsWith(fixture.summaryWarmup[index])).toBe(true);
            }
            for (let index = 0; index < fixture.summaryUpdates.length; index++) {
                expect(episode.turns[index + fixture.summaryOperationSeeds.length + fixture.summaryWarmup.length].userText.endsWith(fixture.summaryUpdates[index])).toBe(true);
            }
            expect(summaries).toBe(actualAuxCalls);
            expect(episode.summaryCompletions.filter((item: any) => item.outcome === 'returned')).toHaveLength(actualAuxCalls);
            const returned = episode.summaryCompletions.filter((completion: any) => completion.outcome === 'returned');
            const updateCallGroups = [...new Set(returned.map((completion: any) => completion.callId.split(':llm:')[0]))];
            expect(updateCallGroups).toHaveLength(actualAuxCalls);
            expect(updateCallGroups.map(group => returned.filter((completion: any) => completion.callId.startsWith(`${group}:llm:`)).length))
                .toEqual(Array(actualAuxCalls).fill(1));
            for (const completion of returned) {
                const updateIndex = updateCallGroups.indexOf(completion.callId.split(':llm:')[0]);
                const maxChars = summaryFreeAllowance(episode, updateIndex);
                expect(completion).toMatchObject({ outcome: 'returned', maxChars,
                    maxCharsMeaning: 'free_output_after_deterministic_fact_reservation',
                    parserInput: { type: 'string', truncated: false } });
                expect(completion.requestIds).toHaveLength(1);
                expect(episode.providerInputs).toEqual(expect.arrayContaining([expect.objectContaining({ requestId: completion.requestIds[0] })]));
                const dispatched = episode.providerInputs.find((input: any) => input.requestId === completion.requestIds[0]);
                expect(dispatched.body.messages[0].content).toContain(`at most ${maxChars} characters`);
                const { source, actionFacts } = historySummaryMaterials(dispatched.body);
                expect(completion.freeSourceIndexes).toEqual(source.sourceMessages.map((part: any) => part.index));
                expect(completion.retainedActionFactIndexes).toEqual(actionFacts.retainedActionFacts.map((fact: any) => fact.index));
                expect(completion.sourceIndexes.length).toBeGreaterThan(0);
                expect(episode.summaryConsumerUpdates).toEqual(expect.arrayContaining([expect.objectContaining({
                    callId: completion.callId, phase: 'consumer_end', status: 'completed',
                })]));
                expect(completion.parserInput.rejectionCondition).toBeUndefined();
            }
            expect(episode.summaryPreparations.length).toBeGreaterThanOrEqual(actualAuxCalls);
            const dispatched = episode.providerInputs.filter((input: any) => input.requestId);
            expect(dispatched.map((input: any) => input.body)).toEqual(setup.bodies);
            expect(setup.bodies.flatMap(body => body.messages.flatMap((message: any) =>
                message.tool_calls?.filter((call: any) => call.function.name === 'vault_append') ?? []))).toHaveLength(2);
            expect(report.physicalRequests).toBe(complete ? 15 : maxRequests);
            expect(setup.bodies[0].tools).toEqual(expect.arrayContaining(['search_memory', 'vault_append'].map(name =>
                expect.objectContaining({ function: expect.objectContaining({ name }) }))));
            const summaryInputs = dispatched.filter((input: any) => input.body.messages[0].content.startsWith('Produce a source-grounded summary'));
            expect(summaryInputs).toHaveLength(actualAuxCalls);
            expect(new Set(returned.map((completion: any) => completion.callId)).size).toBe(actualAuxCalls);
            expect(episode.summaryCompletions.flatMap((completion: any) => completion.requestIds)).toEqual(summaryInputs.map((input: any) => input.requestId));
            const { source: initial } = historySummaryMaterials(summaryInputs[0].body);
            expect(initial.sourceMessages.map((source: any) => source.index)).toEqual([1, 2, 3, 4, 5, 6]);
            for (const input of summaryInputs) {
                const { source: payload, actionFacts } = historySummaryMaterials(input.body);
                const parts = payload.sourceMessages;
                expect(parts.every((source: any) => source.index > 0)).toBe(true);
                expect(payload.previousSummary?.completed ?? []).toEqual([]);
                expect(payload.previousSummary?.open_questions ?? []).toEqual([]);
                expect(payload).not.toHaveProperty('retainedActionFacts');
                for (const turn of episode.summaryStateAfterReopen) {
                    const state = turn.assistant.actionStates[0];
                    expect(actionFacts.retainedActionFacts.flatMap((source: any) => source.actionStates ?? [])).toEqual(expect.arrayContaining([
                        expect.objectContaining({ operationId: state.operationId, phase: state.phase,
                            ...(state.phase === 'completed' ? { operationsEffectStatus: 'applied' } : { effectOutcome: 'unknown', sideEffectsMayHaveOccurred: true }) }),
                    ]));
                }
            }
            if (!complete) {
                expect(report.status).toBe('aborted');
                expect(episode.status).toBe('failed');
                expect(episode.providerInputs.at(-1)).toMatchObject({ status: 'rejected_before_dispatch' });
                expect(episode.providerInputs.at(-1).requestId).toBeUndefined();
                if (episode.providerInputs.at(-1).body.messages[0].content.startsWith('Produce a source-grounded summary')) {
                    expect(episode.summaryCompletions.at(-1)).toMatchObject({ outcome: 'invoke_error', requestIds: [] });
                } else {
                    expect(episode.providerInputs.at(-1).historyPath).toBe('summary');
                    expect(episode.providerInputs.at(-1).body.messages[0].content).not.toMatch(/^Produce a source-grounded summary/);
                }
                expect(episode.turns.at(-1).answer).toBe('');
                if (verified) assertAcceptedCorrectionsAndVerification(episode);
            } else {
                expect({ status: report.status, error: report.error }).toEqual({ status: 'recorded_for_review', error: null });
                expect(episode.summaryEvidence).toMatchObject({ summaryCallCount: 4, observedSummaryUpdates: 4, preparedSummaryCount: 5,
                    verificationTurnIndices: [7, 8] });
                const covered = episode.summaryEvidence.coveredMessageCounts;
                expect(covered[1]).toBeGreaterThanOrEqual(covered[0]);
                expect(covered[2]).toBeGreaterThan(covered[1]);
                assertSummaryPressureAndOverflow(episode);
                assertAcceptedCorrectionsAndVerification(episode);
                await assertOldCapacityBoundary(episode);
                const answers = dispatched.filter((input: any) => input.historyPath === 'summary');
                expect(answers).toHaveLength(5);
                for (const [index, input] of answers.entries()) {
                    const historyMaterial = input.body.messages.find((message: any) => message.role === 'user'
                        && typeof message.content === 'string' && message.content.startsWith('Recent chat history:\n'));
                    const serializedHistory = historyMaterial.content.match(/^Recent chat history:\n([\s\S]*?<\/chat_history>)/)[1];
                    expect(serializedHistory.length).toBeLessThanOrEqual(fixture.summaryHistoryBudgetChars);
                    expect(input.body.tools).toEqual(expect.arrayContaining([expect.objectContaining({
                        function: expect.objectContaining({ name: 'vault_append' }),
                    })]));
                    const records = projectedHistoryRecords(input), history = summaryHistory(episode, index);
                    const expected = projectedHistoryRecords({ body: { messages: [{ role: 'user', content: formatHistoryMessages(history) }] } });
                    expect(records.slice(0, 4)).toEqual(expected.slice(0, 4).map((record: any) => ({ ...record, content: '',
                        ...(record.actionHistory ? { actionHistory: record.actionHistory.map((group: any) => ({ ...group, text: '' })) } : {}) })));
                    expect(records.slice(-2)).toEqual(expected.slice(-2));
                    const states = records.flatMap((record: any) => record.actionStates ?? []);
                    for (const turn of episode.summaryStateAfterReopen) {
                        const state = turn.assistant.actionStates[0];
                        expect(states).toEqual(expect.arrayContaining([expect.objectContaining({
                            owner: 'operations', operationId: state.operationId, phase: state.phase,
                        })]));
                    }
                }
            }
            expect(report.humanVerdict).toBe('pending');
            expect(episode.humanVerdict).toBe('pending');
        } finally {
            await handle.cleanup();
            expect(handle.hasOwnedResources()).toBe(false);
        }
    }, 20_000);

    it.each(['forged', 'missing', 'wrong-index', 'free-protected-index', 'wrong-fact-role', 'wrong-fact-purpose',
        'duplicate-fact-message', 'source-in-fact-lane'] as const)(
        'rejects %s actual seeded action anchors before physical auxiliary or answer dispatch', async scenario => {
            let intercepted = false;
            const reply = summaryEpisodeReply(() => undefined);
            const setup = offlineServicePlugin(reply, service => {
                const summarizer = service.contextSummarizer, prepare = summarizer.prepareHistory.bind(summarizer);
                summarizer.prepareHistory = (input: any) => prepare({ ...input, invoke: (request: any, signal: any) => {
                    const { source: material, actionFacts } = historySummaryMaterials(request);
                    expect(actionFacts.retainedActionFacts.map((source: any) => source.index)).toEqual([2, 4]);
                    expect(actionFacts.retainedActionFacts[0].actionStates[0]).toMatchObject({
                        owner: 'operations', phase: 'completed', operationsEffectStatus: 'applied',
                    });
                    expect(actionFacts.retainedActionFacts[1].actionStates[0]).toMatchObject({
                        owner: 'operations', phase: 'lost', effectOutcome: 'unknown', sideEffectsMayHaveOccurred: true,
                    });
                    if (scenario === 'missing') delete actionFacts.retainedActionFacts;
                    else if (scenario === 'forged') actionFacts.retainedActionFacts[1].actionStates[0].phase = 'completed';
                    else if (scenario === 'wrong-index') actionFacts.retainedActionFacts[0].index = 999;
                    else if (scenario === 'free-protected-index') material.sourceMessages.push({ index: 1, role: 'user', start: 0,
                        end: fixture.summaryOperationSeeds[0].length, content: 'FORGED_SOURCE_CONTENT' });
                    else if (scenario === 'wrong-fact-role') request.messages[2].role = 'assistant';
                    else if (scenario === 'wrong-fact-purpose') actionFacts.purpose = 'write_authority';
                    else if (scenario === 'duplicate-fact-message') request.messages.push({ ...request.messages[2] });
                    else {
                        actionFacts.sourceMessages = material.sourceMessages;
                        delete material.sourceMessages;
                    }
                    request.messages[1].content = JSON.stringify(material);
                    request.messages[2].content = JSON.stringify(actionFacts);
                    intercepted = true;
                    return input.invoke(request, signal);
                } });
            });
            (globalThis as any).__b157PreReloadPlugin = {};
            const handle = harness.installB157ContextEval(setup.app);
            try {
                const report = await handle.start({ ...setup.options, summaryOnly: true, maxRequests: 24 }), episode = report.results[0];
                expect(intercepted).toBe(true);
                expect(report).toMatchObject({ status: 'failed', error: 'B157_TURN_FAILED', physicalRequests: 6 });
                assertSummaryOperations(episode);
                expect(setup.bodies).toHaveLength(6);
                expect(setup.bodies.some(body => body.messages[0].content.startsWith('Produce a source-grounded summary'))).toBe(false);
                expect(episode.summaryCompletions).toEqual([expect.objectContaining({ outcome: 'invoke_error', requestIds: [] })]);
                expect(episode.providerInputs).toHaveLength(6);
                expect(episode.turns.at(-1).answer).toBe('');
            } finally { await handle.cleanup(); }
        }, 20_000,
    );

    it('observes a bounded actual aux parser input and its original rejection without exporting reasoning or changing the result', async () => {
        const summaryReply = summaryEpisodeReply(() => undefined);
        const raw = `synthetic-aux-prefix:${'x'.repeat(8_100)}:UNEXPORTED_MIDDLE_MARKER:${'z'.repeat(8_500)}:synthetic-aux-tail`;
        const setup = offlineServicePlugin(body => body.messages[0].content.startsWith('Produce a source-grounded summary')
            ? { role: 'assistant', content: raw, reasoning_content: 'DO_NOT_EXPORT_AUX_REASONING' } : summaryReply(body));
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            const report = await handle.start({ ...setup.options, summaryOnly: true, maxRequests: 24 }), episode = report.results[0];
            expect({ status: report.status, error: report.error, physicalRequests: report.physicalRequests }).toEqual({
                status: 'failed', error: 'B157_TURN_FAILED', physicalRequests: 7,
            });
            assertSummaryOperations(episode);
            expect(episode.summaryPreparations).toEqual([{ historyBudgetChars: fixture.summaryHistoryBudgetChars, historyMessageCount: 8, outcome: 'no_summary' }]);
            expect(episode.summaryCompletions).toHaveLength(1);
            const completion = episode.summaryCompletions[0];
            const { source: actualPayload, actionFacts } = historySummaryMaterials(episode.providerInputs.at(-1).body);
            expect(completion).toMatchObject({ outcome: 'returned', maxChars: summaryFreeAllowance(episode), sourceIndexes: [1, 2, 3, 4, 5, 6],
                freeSourceIndexes: actualPayload.sourceMessages.map((source: any) => source.index),
                retainedActionFactIndexes: actionFacts.retainedActionFacts.map((source: any) => source.index),
                parserInput: { type: 'string', chars: raw.length, rawParseLimitChars: 16_000, truncated: true,
                    prefix: raw.slice(0, 512), suffix: raw.slice(-512), captureReason: 'capture_limit_exceeded',
                    rejectionCondition: 'raw_text_exceeds_parse_limit' } });
            expect(completion.parserInput.text).toBeUndefined();
            expect(completion.parserInput.parserTextChars).toBeUndefined();
            expect(completion.parserInput.canonicalJSONStringChars).toBeUndefined();
            expect(completion.requestIds).toEqual([episode.providerInputs.at(-1).requestId]);
            expect(episode.summaryConsumerUpdates).toEqual(expect.arrayContaining([expect.objectContaining({
                callId: completion.callId, phase: 'consumer_end', status: 'completed',
            })]));
            expect(episode.turns.at(-1).answer).toBe('');
            expect(episode.turns.at(-1).providerInputEnd).toBe(episode.providerInputs.length);
            expect(episode.providerInputs.at(-1).body.messages[0].content).toMatch(/^Produce a source-grounded summary/);
            const exported = JSON.stringify(handle.safeExport());
            expect(exported).not.toContain('UNEXPORTED_MIDDLE_MARKER');
            expect(exported).not.toContain('DO_NOT_EXPORT_AUX_REASONING');
            expect(exported).not.toContain('SYNTHETIC_NEVER_SENT');
        } finally { await handle.cleanup(); }
    }, 20_000);

    it.each(['formatting only', 'canonical over budget'] as const)(
        'reports %s independently of raw size and the actual summary consumer outcome', async scenario => {
            const summaryReply = summaryEpisodeReply(() => undefined);
            const setup = offlineServicePlugin(body => {
                const reply = summaryReply(body);
                if (!body.messages[0].content.startsWith('Produce a source-grounded summary')) return reply;
                const structured = JSON.parse(reply.content);
                if (scenario === 'canonical over budget') {
                    const source = historySummaryMaterials(body).source.sourceMessages[0];
                    structured.facts.push({ text: '', sourceMessageIndexes: [source.index] });
                    const maxChars = Number(body.messages[0].content.match(/at most (\d+) characters/)[1]);
                    structured.facts[0].text = 'x'.repeat(maxChars + 1 - JSON.stringify(structured).length);
                    return { ...reply, content: JSON.stringify(structured) };
                }
                const formatted = JSON.stringify(structured, null, 2);
                const newline = formatted.indexOf('\n') + 1;
                const maxChars = Number(body.messages[0].content.match(/at most (\d+) characters/)[1]);
                return { ...reply, content: formatted.slice(0, newline)
                    + ' '.repeat(Math.max(0, maxChars + 1 - formatted.length)) + formatted.slice(newline) };
            });
            (globalThis as any).__b157PreReloadPlugin = {};
            const handle = harness.installB157ContextEval(setup.app);
            try {
                const report = await handle.start({ ...setup.options, summaryOnly: true, maxRequests: 24 }), episode = report.results[0];
                assertSummaryOperations(episode);
                const first = episode.summaryCompletions[0];
                expect(first).toMatchObject({ outcome: 'returned', maxChars: summaryFreeAllowance(episode), parserInput: {
                    type: 'string', rawParseLimitChars: 16_000, truncated: false,
                    observation: 'format_and_length_only; inspect_actual_consumer_for_schema_source_and_admission',
                } });
                expect(first.requestIds).toHaveLength(1);
                if (scenario === 'formatting only') {
                    expect({ status: report.status, physicalRequests: report.physicalRequests }).toEqual({
                        status: 'recorded_for_review', physicalRequests: 15,
                    });
                    expect(episode.summaryCompletions).toHaveLength(4);
                    expect(episode.summaryPreparations).toHaveLength(5);
                    expect(episode.summaryEvidence).toMatchObject({ summaryCallCount: 4, observedSummaryUpdates: 4 });
                    assertAcceptedCorrectionsAndVerification(episode);
                    for (const completion of episode.summaryCompletions) {
                        expect(completion.parserInput.formattingOverBudget).toBe(true);
                        expect(completion.parserInput.chars).toBeGreaterThan(completion.maxChars);
                        expect(completion.parserInput.parserTextChars).toBe(completion.parserInput.chars);
                        expect(completion.parserInput.canonicalJSONStringChars).toBeLessThanOrEqual(completion.maxChars);
                        expect(completion.parserInput.rejectionCondition).toBeUndefined();
                    }
                    const combined = JSON.parse(episode.summaryPreparations[0].text), free = JSON.parse(first.parserInput.text);
                    for (const field of ['goals', 'constraints', 'decisions', 'facts']) expect(combined[field]).toEqual(free[field]);
                    expect(free.completed).toEqual([]);
                    expect(free.open_questions).toEqual([]);
                    const ownerStates = episode.summaryStateAfterReopen.flatMap((turn: any) => turn.assistant.actionStates);
                    expect(combined.completed).toEqual([expect.objectContaining({ text: expect.stringContaining(ownerStates[0].operationId), sourceMessages: [2] })]);
                    expect(combined.open_questions).toEqual([expect.objectContaining({ text: expect.stringContaining(ownerStates[1].operationId), sourceMessages: [4] })]);
                } else {
                    expect({ status: report.status, physicalRequests: report.physicalRequests }).toEqual({ status: 'failed', physicalRequests: 7 });
                    expect(first.parserInput).toMatchObject({ chars: first.maxChars + 1, canonicalJSONStringChars: first.maxChars + 1,
                        formattingOverBudget: false, rejectionCondition: 'canonical_summary_exceeds_max_chars' });
                    expect(episode.summaryCompletions).toHaveLength(1);
                    expect(episode.summaryPreparations).toEqual([{ historyBudgetChars: fixture.summaryHistoryBudgetChars, historyMessageCount: 8, outcome: 'no_summary' }]);
                    expect(episode.turns.at(-1).answer).toBe('');
                }
                expect(episode.humanVerdict).toBe('pending');
            } finally { await handle.cleanup(); }
        }, 20_000,
    );

    it('uses actual Ghost preparation, remote draft material and refresh to establish completed state', async () => {
        const record: any = { id: 'ghost-offline', submissions: [], domainEvents: [] };
        const app = harness.createSyntheticApp();
        const ghost = harness.recordingGhostRuntime(app, record, { site: 'http://127.0.0.1:15700/' });
        const guard = { isCurrent: () => true, isPathAllowed: (path: string) => path.startsWith(fixture.syntheticPrefix),
            isNoteDomainAllowed: () => true, isWebAllowed: () => false, captureSourceValidity: () => () => true };
        try {
            const source = await ghost.contextFor('B157-context-eval/source.md', guard, () => true);
            const prepared = await ghost.service.prepare(source.noteUid, source.postId, source.context, false);
            expect(prepared.state).toBe('prepared');
            const material = await ghost.readPreviewMaterial(prepared.operationId);
            expect(material.status).toBe('draft');
            expect(material.lexical).toContain('合成银杏');
            expect(material.snapshot.recipe.contentHash).toBe(prepared.candidate.recipe.contentHash);
            ghost.publishRecordingRemote(material.postId);
            const refreshed = await ghost.service.refresh(source.noteUid, prepared.operationId, source.context);
            expect(refreshed).toMatchObject({ state: 'terminal', verified: { status: 'published' } });
            expect(record.domainEvents).toEqual(expect.arrayContaining([expect.objectContaining({ owner: 'ghost-record' })]));
            expect(record.submissions).toEqual(expect.arrayContaining([expect.objectContaining({ domain: 'ghost', method: 'create' })]));
        } finally { ghost.dispose(); }
    });

    it('ends the real Ghost Agent run, rejects its old guard, then uses fresh Host authority for refresh before history reload', async () => {
        const setup = offlineServicePlugin((_body, index) => index === 0 ? { role: 'assistant', content: '', tool_calls: [{
            index: 0, id: 'actual-ghost-prepare', type: 'function', function: { name: 'prepare_ghost_post',
                arguments: '{"intent":"prepare","path":"B157-context-eval/source.md"}' },
        }] } : { role: 'assistant', content: '已有合成发布结果；只解释当前状态。' });
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            const report = await handle.start({ ...setup.options, caseIds: ['ghost-explain'], arms: ['candidate'], summaryUpdates: false });
            expect({ status: report.status, error: report.error }).toEqual({ status: 'recorded_for_review', error: null });
            const episode = report.results[0];
            expect(episode.turns[0].events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'agent_end' })]));
            expect(episode.domainEvents).toEqual(expect.arrayContaining([
                expect.objectContaining({ owner: 'ghost-action-authority', oldRunGuardCurrent: false, oldContextRejected: true }),
                expect.objectContaining({ owner: 'ghost-action-authority', freshAuthority: true, sourceScope: 'notes', sourceSelectionRevision: 0 }),
                expect.objectContaining({ owner: 'ghost-record' }),
            ]));
            expect(episode.submissions.filter((item: any) => item.domain === 'ghost' && item.method === 'create')).toHaveLength(1);
            expect(episode.submissions.some((item: any) => item.domain === 'ghost' && item.method === 'read')).toBe(true);
            expect(episode.domainStateAfterEvents[0].assistant.actionStates).toEqual(expect.arrayContaining([
                expect.objectContaining({ owner: 'ghost', phase: 'completed' }),
            ]));
            expect(episode.persistedAfterFollowup[0].assistant.actionStates[0].phase).toBe('completed');
            expect(episode.reopen).toMatchObject({ newStore: true, newManager: true, newService: true });
            const followup = episode.providerInputs.slice(episode.turns[0].providerInputEnd).filter((item: any) => item.requestId);
            expect(JSON.stringify(followup.map((item: any) => item.body.messages))).toContain('completed');
            expect(episode.followupSubmissions).toEqual([]);
            expect(episode.comparison.observedPaths).toEqual(['lossless']);
            expect(episode.humanVerdict).toBe('pending');
        } finally { await handle.cleanup(); }
    }, 20_000);

    it('projects a real Ghost lost-response operation as typed unknown across store and service reload without another submission', async () => {
        const setup = offlineServicePlugin((_body, index) => index === 0 ? { role: 'assistant', content: '', tool_calls: [{
            index: 0, id: 'actual-ghost-unknown', type: 'function', function: { name: 'prepare_ghost_post',
                arguments: '{"intent":"prepare","path":"B157-context-eval/source.md"}' },
        }] } : { role: 'assistant', content: '准备结果未知，应先核实已有操作，不能声称已发布。' });
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            const report = await handle.start({ ...setup.options, caseIds: ['ghost-unknown'], arms: ['candidate'], summaryUpdates: false });
            expect({ status: report.status, error: report.error }).toEqual({ status: 'recorded_for_review', error: null });
            const episode = report.results[0];
            const operation = episode.domainEvents.find((event: any) => event.owner === 'ghost-binding');
            expect(operation).toMatchObject({ state: 'outcome_unknown', evidence: 'actual-new-owned-persisted-operation' });
            const result = episode.turns[0].canonical.messages.find((message: any) => message.role === 'toolResult'
                && message.toolName === 'prepare_ghost_post');
            expect(result).toMatchObject({ isError: false, content: { resultFact: {
                kind: 'unknown', operationId: operation.operationId,
            } } });
            expect(JSON.parse(result.content.promptText).observation).toMatchObject({
                status: 'outcome_unknown', operationId: operation.operationId,
            });
            expect(episode.domainStateAfterEvents[0].assistant.actionStates).toEqual(expect.arrayContaining([
                expect.objectContaining({ owner: 'ghost', operationId: operation.operationId, phase: 'unknown',
                    receipt: expect.objectContaining({ kind: 'ghost-operation', state: 'outcome_unknown', verified: false }) }),
            ]));
            expect(episode.reopen).toMatchObject({ newStore: true, newManager: true, newService: true });
            expect(episode.persistedAfterFollowup[0].assistant.actionStates[0]).toMatchObject({
                operationId: operation.operationId, phase: 'unknown',
            });
            const followup = episode.providerInputs.slice(episode.turns[0].providerInputEnd).filter((item: any) => item.requestId);
            // Store hydration rebuilds the source transcript; original tool text
            // is not persisted. Require the actual finite domain state in the
            // serialized history rather than matching prose or system guidance.
            const historicalStates = followup.flatMap((item: any) => item.body.messages.flatMap((message: any) => {
                if (message.role !== 'user' || typeof message.content !== 'string'
                    || !message.content.startsWith('Recent chat history:\n')) return [];
                const json = message.content.match(/<chat_history context_only="true" format="json">\n([\s\S]*?)\n<\/chat_history>/)?.[1];
                return json ? JSON.parse(json).flatMap((entry: any) => entry.actionStates ?? []) : [];
            }));
            expect(historicalStates).toEqual(expect.arrayContaining([expect.objectContaining({
                owner: 'ghost', operationId: operation.operationId, phase: 'unknown',
                contextOnly: true, effectOutcome: 'unknown', sideEffectsMayHaveOccurred: true,
            })]));
            for (const state of historicalStates) expect(state).not.toHaveProperty('grantsWriteAuthority');
            expect(historicalStates.some((state: any) => state.operationId === operation.operationId && state.phase === 'completed')).toBe(false);
            expect(episode.submissions.filter((item: any) => item.domain === 'ghost' && item.method === 'create')).toHaveLength(1);
            expect(episode.submissions.some((item: any) => item.domain === 'ghost' && ['update', 'delete'].includes(item.method))).toBe(false);
            expect(episode.followupSubmissions).toEqual([]);
            expect(episode.comparison.observedPaths).toEqual(['lossless']);
            expect(episode.humanVerdict).toBe('pending');
        } finally { await handle.cleanup(); }
    }, 20_000);

    it('never recovers an existing, ambiguous or revoked Ghost operation as this request\'s unknown receipt', async () => {
        for (const boundary of ['existing', 'ambiguous', 'revoked']) {
            const record: any = { id: `ghost-${boundary}`, submissions: [], domainEvents: [] };
            const app = harness.createSyntheticApp(), store = new MemoryChatHistoryStore();
            await store.initialize();
            const domains = harness.createControlledDomains(app, store, record, { unknown: true });
            domains.attach({ conversation: { id: `conversation-${boundary}` } });
            let current = true;
            const guard = { isCurrent: () => current, isPathAllowed: (path: string) => current && path.startsWith(fixture.syntheticPrefix),
                isNoteDomainAllowed: () => current, isWebAllowed: () => false, captureSourceValidity: () => () => current };
            const submit = () => domains.bindings('Prepare this fixture.', 0).ghostPublishing.submit(
                { intent: 'prepare', path: 'B157-context-eval/source.md' }, guard, () => current);
            try {
                if (boundary === 'existing') {
                    expect(await submit()).toMatchObject({ status: 'outcome_unknown' });
                } else if (boundary === 'ambiguous') {
                    const list = domains.ghost.operations.list.bind(domains.ghost.operations);
                    domains.ghost.operations.list = async (...args: any[]) => {
                        const result = await list(...args);
                        return result.some((operation: any) => operation.state === 'outcome_unknown')
                            ? [...result, { ...result[0], operationId: 'ambiguous-extra-operation' }] : result;
                    };
                } else {
                    const create = domains.ghost.client.createDraft.bind(domains.ghost.client);
                    domains.ghost.client.createDraft = async (...args: any[]) => {
                        try { return await create(...args); } finally { current = false; }
                    };
                }
                await expect(submit()).rejects.toMatchObject(boundary === 'existing' ? { code: 'operation-active' }
                    : boundary === 'ambiguous' ? { name: 'GhostClientError', outcome: 'unknown' } : { code: 'source-revoked' });
                expect(record.submissions.filter((event: any) => event.method === 'create')).toHaveLength(1);
                expect(record.domainEvents.filter((event: any) => event.owner === 'ghost-binding')).toHaveLength(boundary === 'existing' ? 1 : 0);
            } finally { await domains.dispose(); await store.dispose(); }
        }
    });

    it('keeps original Operations disabled while the authorized fixture stages and confirms a real operation', async () => {
        const setup = offlineServicePlugin((_body, index) => index === 0 ? { role: 'assistant', content: '', tool_calls: [{
            index: 0, id: 'controlled-append', type: 'function', function: { name: 'vault_append',
                arguments: '{"path":"B157-context-eval/source.md","content":"B157 已执行银杏"}' },
        }] } : { role: 'assistant', content: '已有合成笔记操作结果。' });
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            const report = await handle.start({ ...setup.options, caseIds: ['operations-explain'], arms: ['candidate'], summaryUpdates: false });
            expect({ status: report.status, error: report.error }).toEqual({ status: 'recorded_for_review', error: null });
            const episode = report.results[0];
            expect(episode.operationsCapability).toMatchObject({ originalEnabled: false, controlledEnabled: true });
            expect(setup.plugin.settings.operationsAgentEnabled).toBe(false);
            expect(setup.bodies[0].tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'vault_append' }) })]));
            expect(episode.confirmations).toEqual(expect.arrayContaining([expect.objectContaining({
                domain: 'operations', boundary: 'actual-session-confirm',
            })]));
            expect(episode.domainStateAfterEvents[0].assistant.actionStates).toEqual(expect.arrayContaining([
                expect.objectContaining({ owner: 'operations', phase: 'completed' }),
            ]));
            expect(episode.localSyntheticNotes.find((item: any) => item.path === 'B157-context-eval/source.md').content).toContain('B157 已执行银杏');
            expect(episode.followupSubmissions).toEqual([]);
        } finally { await handle.cleanup(); }
    }, 20_000);

    it('uses native get_writing_context and present_writing before real save; ordinary followup records its actual protocol', async () => {
        const setup = offlineServicePlugin((body, index) => {
            if (index === 0) return { role: 'assistant', content: '', tool_calls: [{ index: 0, id: 'actual-writing-context',
                type: 'function', function: { name: 'get_writing_context', arguments:
                    '{"parentHandle":null,"currentInstructionConflicts":false,"imageRefs":[]}' } }] };
            if (index === 1) {
                const present = body.tools.find((tool: any) => tool.function.name === 'present_writing');
                const contextHandle = present.function.parameters.properties.contextHandle.enum[0];
                return { role: 'assistant', content: '', tool_calls: [{ index: 0, id: 'actual-present-writing',
                    type: 'function', function: { name: 'present_writing', arguments: JSON.stringify({
                        contextHandle, body: '合成银杏映照旅途。合成落叶留下回忆。', explanation: '仅使用合成素材。' }) } }] };
            }
            return { role: 'assistant', content: '已有合成文案；保存回执已完成。' };
        });
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            const report = await handle.start({ ...setup.options, caseIds: ['writing-explain'], arms: ['candidate'], summaryUpdates: false });
            expect({ status: report.status, error: report.error, episode: report.results[0]?.error }).toEqual({
                status: 'recorded_for_review', error: null, episode: undefined });
            const episode = report.results[0];
            expect(episode.turns[0]).toMatchObject({ writingProtocol: 'native', writingRequestPresent: true });
            expect(episode.turns[0].writingArtifacts).toHaveLength(1);
            expect(episode.turns[1]).toMatchObject({ writingProtocol: 'ordinary', writingRequestPresent: false, writingArtifacts: [] });
            expect(setup.bodies[0].tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'get_writing_context' }) })]));
            expect(setup.bodies[1].tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'present_writing' }) })]));
            expect(episode.domainStateAfterEvents[0].assistant.actionStates).toEqual(expect.arrayContaining([
                expect.objectContaining({ owner: 'writing', phase: 'completed' }),
            ]));
            expect(episode.localMutations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'process' })]));
            expect(episode.humanVerdict).toBe('pending');
        } finally { await handle.cleanup(); }
    }, 20_000);

    it('isolates native history and preparation ports, creates the owned root, and awaits disposal before database deletion', async () => {
        const setup = offlineServicePlugin(() => { throw new Error('NO_MODEL_CALL_ALLOWED'); });
        const originalHost: any = { settings: { ...setup.plugin.settings, operationsAgentEnabled: false }, writingOutputProtocol: 'native',
            get chatHistoryManager() { throw new Error('ORIGINAL_HISTORY_MUST_NOT_BE_READ'); },
            prepareWritingStyle: () => { throw new Error('PRIVATE_STYLE_MUST_NOT_BE_READ'); },
            memoryStatus: { prepareFromCommand: () => { throw new Error('ORIGINAL_MEMORY_MUST_NOT_RUN'); } } };
        const originalFactory = () => originalHost; setup.plugin.createChatHost = originalFactory;
        const priorIndexedDb = globalThis.indexedDB;
        const { factory } = nativeHistoryFactory(), deleteDatabase = factory.deleteDatabase;
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
        const initialSource = setup.app.vault.getAbstractFileByPath('B157-context-eval/source.md');
        const initialNew = setup.app.vault.getAbstractFileByPath('B157-context-eval/new-source.md');
        await setup.app.vault.delete(initialSource); await setup.app.vault.delete(initialNew);
        // Remove the existing synthetic root through its storage map API; the
        // real bounded adapter must explicitly admit this exact root path.
        const root = setup.app.vault.getAbstractFileByPath('B157-context-eval');
        const underlyingDelete = setup.app.vault.delete;
        setup.app.vault.delete = async (file: any) => file === root ? undefined : underlyingDelete(file);
        const abstract = setup.app.vault.getAbstractFileByPath;
        setup.app.vault.getAbstractFileByPath = (path: string) => path === 'B157-context-eval' ? null : abstract(path);
        const createFolder = setup.app.vault.createFolder;
        setup.app.vault.createFolder = async (path: string) => { expect(path).toBe('B157-context-eval'); return root; };
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            await handle.installNativeAdapters(setup.options);
            const host = setup.plugin.createChatHost();
            expect(await host.chatHistoryManager.listConversations()).toEqual([]);
            expect(host.chatHistoryManager.isAvailable()).toBe(true);
            expect(host.isOperationsAgentEnabled).toBe(true);
            expect(setup.plugin.settings.operationsAgentEnabled).toBe(false);
            expect(await host.prepareWritingStyle()).toMatchObject({ context: '', revisionIds: [] });
            await expect(host.memoryStatus.prepareFromCommand()).rejects.toThrow('OUTSIDE_FIXTURE');
            await expect(host.prepareWritingRecoverySources()).rejects.toThrow('OUTSIDE_FIXTURE');
            await handle.nativeAdapters.prepareSyntheticNotes();
            expect(setup.app.vault.getAbstractFileByPath('B157-context-eval/source.md')).toBeTruthy();
            expect(setup.bodies).toEqual([]);
            const status = await handle.nativeAdapters.status();
            expect(status.persistedTurns).toEqual([]);
            expect(factory.openCalls).toEqual([expect.objectContaining({ name: status.historyDatabase })]);
            await expect(handle.nativeAdapters.deleteOwnedHistoryDatabase()).rejects.toThrow('CLEANUP_BEFORE_DATABASE_DELETE');
            await handle.cleanup();
            expect(setup.plugin.createChatHost).toBe(originalFactory);
            expect(factory.connections.every((connection: any) => connection.closeCalls === 1)).toBe(true);
            await handle.nativeAdapters.deleteOwnedHistoryDatabase();
            expect(deleteDatabase).toHaveBeenCalledWith(status.historyDatabase);
            setup.app.vault.createFolder = createFolder;
        } finally { await handle.cleanup(); Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: priorIndexedDb }); }
    });

    it('reopens the exact existing native database without model dispatch, preserves all stored turns, and accepts the next actual snapshot', async () => {
        const setup = offlineServicePlugin(() => { throw new Error('NO_MODEL_CALL_ALLOWED'); });
        const stored = await storedNativeHistory(), priorIndexedDb = globalThis.indexedDB;
        const originalFactory = () => ({ settings: setup.plugin.settings,
            get chatHistoryManager() { throw new Error('ORIGINAL_HISTORY_MUST_NOT_BE_READ'); } });
        setup.plugin.createChatHost = originalFactory;
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: stored.factory });
        (globalThis as any).__b157PreReloadPlugin = {};
        let handle = harness.installB157ContextEval(setup.app);
        try {
            const openBefore = stored.factory.openCalls.length;
            await handle.installNativeAdapters({ ...setup.options, existingHistory: stored.existingHistory });
            expect(stored.modes.every(mode => mode === 'readonly')).toBe(true);
            expect(stored.factory.openCalls.slice(openBefore)).toEqual([
                { name: stored.existingHistory.databaseName, version: 4 }, { name: stored.existingHistory.databaseName, version: 4 } ]);
            const status = await handle.nativeAdapters.status();
            expect(status.historyDatabase).toBe(stored.existingHistory.databaseName);
            expect(status.persistedTurns).toEqual(stored.originalTurns); expect(status.physicalRequests).toBe(0);
            expect(handle.safeExport().ownedHistoryDatabase.reconnected).toBe(true);
            expect(setup.bodies).toEqual([]);
            // A future reconnect uses the actual next exported collection,
            // including additional owned conversations; it does not reload old counts.
            const host = setup.plugin.createChatHost(), manager = host.chatHistoryManager;
            const conversation = await manager.startConversation('Another synthetic native question');
            await manager.recordTurn({ conversationId: conversation.id, conversation, turnIndex: 0,
                userPrompt: 'Another synthetic native question', entry: { kind: 'history',
                    user: { role: 'user', content: 'Another synthetic native question' },
                    assistant: { role: 'assistant', content: 'Another synthetic native answer' } } });
            const nextStatus = await handle.nativeAdapters.status();
            expect(nextStatus.existingHistory.conversations).toHaveLength(5);
            expect(nextStatus.persistedTurns).toHaveLength(18);
            await handle.cleanup(); expect(setup.plugin.createChatHost).toBe(originalFactory);
            await handle.installNativeAdapters({ ...setup.options,
                existingHistory: nextStatus.existingHistory });
            expect((await handle.nativeAdapters.status()).persistedTurns).toHaveLength(18);
            expect(setup.bodies).toEqual([]);
            await handle.cleanup(); await handle.nativeAdapters.deleteOwnedHistoryDatabase();
            expect(stored.factory.deleteDatabase).toHaveBeenCalledWith(stored.existingHistory.databaseName);
        } finally { await handle.cleanup(); Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: priorIndexedDb }); }
    });

    it.each(['unknown-database', 'version', 'schema', 'identity', 'count', 'extra-conversation', 'missing-turn', 'orphan-turn', 'active-conversation'])(
        'refuses existing native history with %s before installing ports or dispatching a model request', async mutation => {
            const setup = offlineServicePlugin(() => { throw new Error('NO_MODEL_CALL_ALLOWED'); });
            const stored = await storedNativeHistory(), priorIndexedDb = globalThis.indexedDB;
            const originalFactory = () => ({ settings: setup.plugin.settings }); setup.plugin.createChatHost = originalFactory;
            const expected = JSON.parse(JSON.stringify(stored.existingHistory));
            const first = expected.conversations[0];
            if (mutation === 'unknown-database') stored.factory.databases = async () => [];
            if (mutation === 'version') stored.factory.backend.version = 3;
            if (mutation === 'schema') stored.factory.backend.getStore('metadata').set('schema-version', { key: 'schema-version', value: 1 });
            if (mutation === 'identity') first.id = '11111111-1111-4111-8111-111111111111';
            if (mutation === 'count') first.turnCount--;
            if (mutation === 'extra-conversation') stored.factory.backend.getStore('conversations').set('extra',
                { ...stored.factory.backend.getStore('conversations').get(first.id), id: '11111111-1111-4111-8111-111111111111', turnCount: 0 });
            if (mutation === 'missing-turn') stored.factory.backend.getStore('turns').delete(buildTurnRecordKey(first.id, 0));
            if (mutation === 'orphan-turn') {
                const row = stored.factory.backend.getStore('turns').get(buildTurnRecordKey(first.id, 0));
                row.turn.conversationId = '11111111-1111-4111-8111-111111111111';
            }
            if (mutation === 'active-conversation') stored.factory.backend.getStore('metadata').set('active-conversation', { key: 'active-conversation', value: 'foreign' });
            Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: stored.factory });
            (globalThis as any).__b157PreReloadPlugin = {};
            const handle = harness.installB157ContextEval(setup.app), before = stored.factory.openCalls.length;
            try {
                await expect(handle.installNativeAdapters({ ...setup.options, existingHistory: expected })).rejects.toThrow('B157_NATIVE_EXISTING_');
                expect(setup.plugin.createChatHost).toBe(originalFactory); expect(setup.bodies).toEqual([]);
                expect(stored.modes.every(mode => mode === 'readonly')).toBe(true);
                if (['unknown-database', 'version'].includes(mutation)) expect(stored.factory.openCalls).toHaveLength(before);
                expect(handle.safeExport().ownedHistoryDatabase).toBeUndefined();
            } finally { await handle.cleanup(); Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: priorIndexedDb }); }
        },
    );

    it('aborts an upgrade race instead of creating a missing native database', async () => {
        const setup = offlineServicePlugin(() => { throw new Error('NO_MODEL_CALL_ALLOWED'); });
        const stored = await storedNativeHistory(), priorIndexedDb = globalThis.indexedDB;
        const abort = jest.fn(() => { queueMicrotask(() => request.onerror?.({})); });
        const request: any = { transaction: { abort } };
        const open = jest.fn<(name: string, version: number) => any>(() => {
            queueMicrotask(() => request.onupgradeneeded?.({ oldVersion: 0, newVersion: 4 })); return request;
        });
        const factory = { databases: stored.factory.databases, open };
        setup.plugin.createChatHost = () => ({ settings: setup.plugin.settings });
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            await expect(handle.installNativeAdapters({ ...setup.options, existingHistory: stored.existingHistory })).rejects.toThrow('EXISTING_DATABASE_OPEN_FAILED');
            expect(abort).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith(stored.existingHistory.databaseName, 4);
            expect(setup.bodies).toEqual([]); expect(handle.safeExport().ownedHistoryDatabase).toBeUndefined();
        } finally { await handle.cleanup(); Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: priorIndexedDb }); }
    });

    it('keeps the no-upgrade guard when the real Store opens after the readonly identity probe', async () => {
        const setup = offlineServicePlugin(() => { throw new Error('NO_MODEL_CALL_ALLOWED'); });
        const stored = await storedNativeHistory(), priorIndexedDb = globalThis.indexedDB;
        const createObjectStore = jest.fn(), request: any = { result: { createObjectStore,
            objectStoreNames: { contains: () => false } } };
        let aborted = false;
        request.transaction = { abort: jest.fn(() => { aborted = true; queueMicrotask(() => request.onerror?.({})); }) };
        const actualOpen = stored.factory.open;
        let opens = 0;
        stored.factory.open = (name: string, version: number) => {
            if (++opens === 1) return actualOpen(name, version);
            queueMicrotask(() => { request.onupgradeneeded?.({ oldVersion: 0, newVersion: 4 });
                if (!aborted) request.onsuccess?.({}); });
            return request;
        };
        const originalFactory = () => ({ settings: setup.plugin.settings }); setup.plugin.createChatHost = originalFactory;
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: stored.factory });
        (globalThis as any).__b157PreReloadPlugin = {};
        const handle = harness.installB157ContextEval(setup.app);
        try {
            await expect(handle.installNativeAdapters({ ...setup.options, existingHistory: stored.existingHistory })).rejects.toThrow('HISTORY_STORE_UNAVAILABLE');
            expect(opens).toBe(2); expect(request.transaction.abort).toHaveBeenCalledTimes(1);
            expect(createObjectStore).not.toHaveBeenCalled(); expect(setup.plugin.createChatHost).toBe(originalFactory);
            expect(setup.bodies).toEqual([]);
        } finally { await handle.cleanup(); Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: priorIndexedDb }); }
    });

    it.each(['foreign-name', 'invalid-owned-uuid', 'extra-key', 'duplicate-id', 'too-many', 'too-many-turns'])(
        'rejects the bounded existing native identity input %s without opening a database', async mutation => {
            const setup = offlineServicePlugin(() => { throw new Error('NO_MODEL_CALL_ALLOWED'); });
            const stored = await storedNativeHistory(), priorIndexedDb = globalThis.indexedDB;
            const expected: any = JSON.parse(JSON.stringify(stored.existingHistory));
            if (mutation === 'foreign-name') expected.databaseName = 'personal-assistant-chat-history-v1';
            if (mutation === 'invalid-owned-uuid') expected.databaseName = 'b157-context-eval-not-a-uuid';
            if (mutation === 'extra-key') expected.authorized = true;
            if (mutation === 'duplicate-id') expected.conversations[1].id = expected.conversations[0].id;
            if (mutation === 'too-many') expected.conversations = Array.from({ length: 9 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, turnCount: 0 }));
            if (mutation === 'too-many-turns') expected.conversations[0].turnCount = 51;
            setup.plugin.createChatHost = () => ({ settings: setup.plugin.settings });
            Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: stored.factory });
            (globalThis as any).__b157PreReloadPlugin = {};
            const handle = harness.installB157ContextEval(setup.app), before = stored.factory.openCalls.length;
            try {
                await expect(handle.installNativeAdapters({ ...setup.options, existingHistory: expected })).rejects.toThrow('EXISTING_HISTORY_IDENTITY_INVALID');
                expect(stored.factory.openCalls).toHaveLength(before); expect(setup.bodies).toEqual([]);
            } finally { await handle.cleanup(); Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: priorIndexedDb }); }
        },
    );

    it('builds an app-loadable test bundle with exact fixture and transitive source identities', async () => {
        const temporary = mkdtempSync(join(tmpdir(), 'b157-build-test-'));
        try {
            const result = spawnSync(process.execPath, [resolve(__dirname, '../scripts/build-b157-context-eval.mjs'),
                '--outdir', temporary], { cwd: resolve(__dirname, '..'), encoding: 'utf8' });
            expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
            const manifest = JSON.parse(readFileSync(join(temporary, 'b157-context-eval-manifest.json'), 'utf8'));
            expect(manifest.fixtureSha256).toBe(info.fixtureSha256);
            expect(manifest.bundleSha256).toBe(sha(readFileSync(join(temporary, 'b157-context-eval.js'), 'utf8')));
            expect(manifest.inputs['src/chat/chat-history-manager.ts']).toMatch(/^[a-f0-9]{64}$/);
            expect(manifest.pluginRuntimeSourceInputs['src/ai-services/chat-service.ts']).toMatch(/^[a-f0-9]{64}$/);
            expect(readFileSync(join(temporary, 'b157-context-eval.js'), 'utf8')).toContain('B157ContextEvalModule');
        } finally { rmSync(temporary, { recursive: true, force: true }); }
    });
});

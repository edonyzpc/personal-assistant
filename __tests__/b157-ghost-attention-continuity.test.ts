import { describe, expect, it, jest } from '@jest/globals';
import { Script } from 'node:vm';
import { App, Platform, TFile } from 'obsidian';
import { ChatService } from '../src/ai-services/chat-service';
import { createPaAgentPersistedTurn } from '../src/ai-services/pa-agent-history';
import { completeInputLineage } from '../src/ai-services/input-lineage';
import { refreshGhostActionState } from '../src/ai-services/pa-agent-result-facts';
import type { AgentEvent, ChatMessage } from '../src/ai-services/chat-types';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { GhostClientError, type GhostPost, type GhostPostWrite, type GhostRequestGate } from '../src/ghost-publishing/client';
import { GhostPublishingIntegration } from '../src/ghost-publishing/host-integration';
import type { GhostPublishingController, GhostPublishingSession } from '../src/ghost-publishing/controller';
import { GhostPublishingService } from '../src/ghost-publishing/service';
import { GhostOperationStore } from '../src/ghost-publishing/state-store';
import type { GhostCompletedRecord } from '../src/ghost-publishing/state-schema';
import { FakeGovernanceIndexedDbFactory } from './helpers/fake-governance-indexeddb';

jest.mock('obsidian');
const mockCreateChatModel = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('../src/ai-services/ai-utils', () => ({
    ...jest.requireActual<typeof import('../src/ai-services/ai-utils')>('../src/ai-services/ai-utils'),
    AIUtils: jest.fn(() => ({ createChatModel: mockCreateChatModel,
        getNativeToolCallingCapability: () => ({ supported: true, status: 'supported', provider: 'qwen',
            model: 'qwen3.6-plus', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }),
        resolveChatTransport: () => ({ responseDelivery: 'incremental' }) })),
}));
jest.mock('@langchain/core/prompts', () => ({
    ...jest.requireActual<typeof import('@langchain/core/prompts')>('@langchain/core/prompts'),
    ChatPromptTemplate: { fromMessages: () => ({ pipe: (model: unknown) => model }) },
    SystemMessagePromptTemplate: { fromTemplate: (template: string) => ({ template }) },
    HumanMessagePromptTemplate: { fromTemplate: (template: string) => ({ template }) },
}));

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const notePath = 'B157-context-eval/source.md';
const site = 'https://b157.synthetic.invalid/';
const siteId = 'b157-synthetic-site';

async function fixture() {
    const file = new (TFile as unknown as new (path: string) => TFile)(notePath);
    let frontmatter: Record<string, unknown> = {};
    const markdown = () => `---\n${Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n# Synthetic article\n\nSynthetic body.\n`;
    const operations = new GhostOperationStore({ dbName: 'b157-attention-continuity', isDesktop: () => true,
        indexedDb: new FakeGovernanceIndexedDbFactory() as unknown as IDBFactory });
    const remote = new Map<string, GhostPost>();
    const pageProbes: unknown[] = [];
    let completed: GhostCompletedRecord | null = null;
    let ordinal = 0, matchingPage = false, ownedOperationId = '';
    const now = () => new Date(Date.UTC(2026, 9, 2) + ++ordinal * 1000).toISOString();
    const records = { read: async () => completed && copy(completed),
        write: async (record: GhostCompletedRecord, checksum: string | null) => {
            if ((completed?.checksum ?? null) !== checksum) throw new Error('Synthetic record conflict');
            completed = copy(record);
        } };
    const send = async (gate: GhostRequestGate) => { await gate.beforeSend(); gate.assertCurrent(); };
    const createDraft = jest.fn(async (fields: GhostPostWrite, gate: GhostRequestGate) => {
        await send(gate);
        const post = { id: (++ordinal).toString(16).padStart(24, '0'),
            uuid: '00000000-0000-4000-8000-000000000001', title: '', lexical: null,
            slug: 'synthetic-article', status: 'draft', authors: [{ id: '2'.repeat(24) }], visibility: 'public',
            feature_image: null, feature_image_alt: null, feature_image_caption: null,
            custom_excerpt: null, meta_title: null, meta_description: null, custom_template: null,
            codeinjection_head: null, codeinjection_foot: null, tags: [], published_at: null,
            created_at: now(), updated_at: now(), url: `${site}synthetic-article/`, ...copy(fields) } as GhostPost;
        remote.set(post.id, post); return copy(post);
    });
    const client = {
        readPost: async (id: string, gate: GhostRequestGate) => { await send(gate);
            const post = remote.get(id); if (!post) throw new GhostClientError('http', 'failed', 404); return copy(post); },
        findPostsByMarker: async (marker: string, gate: GhostRequestGate) => { await send(gate);
            return [...remote.values()].filter(post => post.tags.some(tag => tag.name === marker)).map(copy); },
        createDraft,
        updatePost: async (id: string, version: string, fields: GhostPostWrite, gate: GhostRequestGate) => {
            await send(gate); const post = remote.get(id)!;
            if (post.updated_at !== version) throw new GhostClientError('conflict', 'failed', 409);
            const next = { ...post, ...copy(fields), tags: fields.tags?.map(tag => {
                if (!tag.name) throw new Error('Recording update requires named fixture tags');
                return { ...tag, name: tag.name };
            }) ?? post.tags, updated_at: now() }; remote.set(id, next); return copy(next); },
        deleteDraft: async (id: string, gate: GhostRequestGate) => { await send(gate); remote.delete(id); },
        uploadImage: async () => { throw new Error('No image in this fixture'); },
    };
    const service = new GhostPublishingService({ siteId, site, isDesktop: () => true,
        client: client as unknown as ConstructorParameters<typeof GhostPublishingService>[0]['client'],
        operations, records, newId: () => { ownedOperationId = `b157-owned-ghost-${++ordinal}`; return ownedOperationId; }, now });

    // A synthetic native frame executes the production fixed page probe. This
    // protects the preview gate contract; it is not real Obsidian/browser proof.
    const listeners = new Map<string, Set<() => void>>();
    const emit = (name: string) => { for (const listener of listeners.get(name) ?? []) listener(); };
    const frame = { isConnected: true, offsetWidth: 900, offsetHeight: 700, url: '',
        getURL() { return this.url; }, isLoading: () => false,
        addEventListener: (name: string, listener: () => void) => {
            const current = listeners.get(name) ?? new Set(); current.add(listener); listeners.set(name, current);
        }, removeEventListener: (name: string, listener: () => void) => { listeners.get(name)?.delete(listener); },
        async executeJavaScript(script: string) {
            const operation = (await operations.findForContext(siteId, ownedOperationId))!;
            const article = { getBoundingClientRect: () => ({ width: 900, height: 700 }) };
            const result = new Script(script).runInNewContext({ URL, Set,
                location: { href: matchingPage ? frame.url : `${site}unavailable-preview/` },
                getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
                window: { __paGhostRecipe: { ...operation.candidate.recipe,
                    ...(!matchingPage ? { contentHash: 'mismatched-page' } : {}) } },
                document: { readyState: 'complete', querySelector: () => article, querySelectorAll: () => [] } });
            pageProbes.push(copy(result));
            return result;
        } };
    const leaves: unknown[] = [];
    const view = { mode: 'webview', containerEl: { querySelector: () => frame }, navigate: (url: string) => {
        emit('did-start-loading'); frame.url = url; emit('did-stop-loading');
    } };
    const leaf = { view, setViewState: async (state: { state?: { url?: string } }) => {
        frame.url = state.state?.url ?? ''; leaves.push(leaf);
    } };
    const app = { vault: { configDir: '.obsidian', getName: () => 'test',
        getAbstractFileByPath: (path: string) => path === notePath ? file : null, getMarkdownFiles: () => [file],
        read: async () => markdown(), cachedRead: async () => markdown(), on: () => ({}), offref: () => {} },
        metadataCache: { getFileCache: () => ({ frontmatter }), getFirstLinkpathDest: () => null },
        fileManager: { processFrontMatter: async (_file: TFile, mutate: (value: Record<string, unknown>) => void) => {
            frontmatter = { ...frontmatter }; mutate(frontmatter);
        } }, workspace: { getLeaf: () => leaf, getLeavesOfType: (type: string) => type === 'webviewer' ? leaves : [],
            getActiveViewOfType: () => null, getMostRecentLeaf: () => null },
        internalPlugins: { getPluginById: () => ({ enabled: true }) },
        secretStorage: { getSecret: () => { throw new Error('Secrets forbidden'); }, setSecret: () => { throw new Error('Secrets forbidden'); } },
    } as unknown as App;
    const integration = new GhostPublishingIntegration({ app, pluginId: 'b157-test-only', vaultPath: '/nonexistent-b157-test-only',
        getSettings: () => ({ siteUrl: site, defaultVisibility: 'public', profile: {} }),
        saveSettings: async () => { throw new Error('Settings writes forbidden'); }, isCurrent: () => true,
        isPathAllowed: path => path === notePath, isContentAllowed: path => path === notePath, isWebAllowed: () => false,
        generateMetadata: async () => ({ customExcerpt: 'Synthetic article.', metaDescription: 'Synthetic article.', slug: 'synthetic-article' }) });
    jest.spyOn(integration.configuration, 'getIdentity').mockReturnValue('b157-recording-connection');
    jest.spyOn(integration.configuration, 'connection').mockResolvedValue({ siteId, siteUrl: site,
        identity: 'b157-recording-connection', profile: { siteId }, defaultVisibility: 'public' });
    const controller = (integration as unknown as { controller: GhostPublishingController }).controller;
    (controller as unknown as { runtimes: Map<string, unknown> }).runtimes.set(siteId, { client, service, operations, records });
    return { app, integration, operations, createDraft, pageProbes, matchPage: () => { matchingPage = true; },
        publish: (id: string) => { const post = remote.get(id)!; post.status = 'published'; post.published_at = post.updated_at = now(); } };
}

describe('B157 real Ghost attention continuity (synthetic page and recorded model only)', () => {
    it('retains the owned operation from needs_attention through verified publication and reopened follow-up', async () => {
        (Platform as { isDesktop: boolean; isMobile: boolean }).isDesktop = true;
        (Platform as { isDesktop: boolean; isMobile: boolean }).isMobile = false;
        const f = await fixture(), store = new MemoryChatHistoryStore(), manager = new ChatHistoryManager({ store });
        await manager.initialize();
        const initialText = '@blog2ghost prepare the current note';
        const conversation = await manager.startConversation(initialText);
        const inputLineage = completeInputLineage([{ kind: 'user-text', messageId: 'b157-initial-user' }]);
        const selection = { schemaVersion: 1 as const, scope: 'notes' as const, selectionId: 'b157-initial-selection', userMessageId: 'b157-initial-user' };
        const host = { app: f.app, settings: { aiProvider: 'qwen', chatModelName: 'qwen3.6-plus',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', memoryEnabled: false,
            operationsAgentEnabled: true, operationsProactiveSaveSuggestionsEnabled: false, shareAnonymousCapabilityUsage: false },
            isOperationsAgentEnabled: true, log: () => {}, getAPIToken: async () => 'synthetic-placeholder',
            getMemoryEvidenceEpoch: () => 'b157-synthetic-epoch', getMemoryExtractionPromptContext: () => undefined };
        const providerInputs: unknown[] = [];
        const boundSchemas: unknown[] = [];
        let dispatch = 0;
        const model = { bindTools: (schemas: unknown) => { boundSchemas.push(schemas); return model; }, stream: async function* (input: unknown) {
            providerInputs.push(input);
            if (dispatch++ === 0) yield { tool_call_chunks: [{ index: 0, id: 'b157-real-prepare-call',
                name: 'prepare_ghost_post', args: JSON.stringify({ intent: 'prepare' }) }] };
            else yield { content: 'Use the publishing card to verify its status.' };
        } };
        mockCreateChatModel.mockResolvedValue(model);
        const chat = new ChatService(host as unknown as ConstructorParameters<typeof ChatService>[0]);
        let session!: GhostPublishingSession;
        const binding = f.integration.createBinding({ conversationId: conversation.id, stableMessageId: 'b157-initial-user',
            userText: initialText, capturedPath: notePath, isCurrent: () => true, getSourceSelection: () => selection,
            onSession: value => { session = value; } })!;
        const submit = jest.spyOn(binding, 'submit');
        const events: AgentEvent[] = [];
        let committedFinalText = '';
        try {
            await chat.streamLLM(initialText, () => {}, undefined, [], { conversationId: conversation.id, memoryMode: 'skip-memory',
                inputLineage, runSourceSelection: selection, ghostPublishing: binding,
                onLifecycleEvent: event => events.push(copy(event)), onCommittedFinalText: text => { committedFinalText = text; } });
            expect(submit).toHaveBeenCalledTimes(1);
            const result = await submit.mock.results[0].value as Awaited<ReturnType<typeof binding.submit>>;
            expect(result).toMatchObject({ status: 'needs_attention', operationId: expect.any(String) });
            const operationId = result.operationId!;
            const initialOperation = await f.operations.findForContext(siteId, operationId);
            expect(initialOperation).toMatchObject({ operationId, state: 'prepared' });
            expect(session.getState()).toMatchObject({ operationId, status: 'needs-attention', previewStatus: 'failed' });
            expect(f.pageProbes[0]).toMatchObject({ urlMatches: false, recipe: { matches: false } });
            const lastTurn = [...events].reverse().find(event => event.type === 'turn_end')!;
            expect(lastTurn.status).toBe('completed');
            const canonical = createPaAgentPersistedTurn({ runId: events[0].runId, turnId: lastTurn.turnId,
                status: lastTurn.status, committedFinalText,
                messages: events.flatMap(event => event.type === 'message_end' ? [event.message] : []) });
            // RED before the fix: the real owned needs_attention result lost its
            // canonical action identity, so strict later domain updates found no row.
            expect(canonical.actionStates).toEqual(expect.arrayContaining([expect.objectContaining({
                owner: 'ghost', operationId, origin: expect.objectContaining({ callId: 'b157-real-prepare-call' }),
                inputLineage: expect.objectContaining({ completeness: 'complete', dependencies: expect.arrayContaining([
                    { kind: 'user-text', messageId: 'b157-initial-user' } ]) }) })]));
            await manager.recordTurn({ conversationId: conversation.id, conversation, turnIndex: 0, userPrompt: initialText,
                entry: { kind: 'history', user: { role: 'user', content: initialText, inputLineage, runSourceSelection: selection,
                    hostProvenance: { version: 1, kind: 'ordinary_user_statement', messageId: 'b157-initial-user' } },
                assistant: { role: 'assistant', content: committedFinalText, canonicalTurn: canonical, actionStates: canonical.actionStates } } });
            session.registerContextPersistence!(async receipt => {
                const updated = await manager.updateActionStatesForOperation(conversation.id, canonical.runId, 'ghost', operationId,
                    states => states.map(state => refreshGhostActionState(state, receipt) ?? state));
                return updated?.some(state => state.owner === 'ghost' && state.operationId === operationId && state.phase === 'completed') ?? false;
            }, conversation.id);
            f.matchPage(); await session.run('check-preview');
            expect(session.getState()).toMatchObject({ operationId, status: 'awaiting-publish', previewStatus: 'passed' });
            expect(f.pageProbes.at(-1)).toMatchObject({ urlMatches: true, recipe: { matches: true } });
            f.publish(initialOperation!.target.previewId!); await session.run('check-published');
            expect(session.getContextReceipt()).toMatchObject({ operationId, state: 'terminal', verified: true });
            const saved = (await store.getTurns(conversation.id))[0];
            expect(saved.assistant.actionStateBinding).toMatchObject({ conversationId: conversation.id,
                turnIndex: 0, runId: canonical.runId, turnId: canonical.turnId });
            expect(saved.assistant.actionStates).toEqual(expect.arrayContaining([expect.objectContaining({
                operationId, phase: 'completed', receipt: expect.objectContaining({ verified: true, state: 'terminal' }) })]));
            expect(saved.assistant.actionStates![0].origin).toEqual(canonical.actionStates![0].origin);
            expect(saved.assistant.actionStates![0].inputLineage).toEqual(canonical.actionStates![0].inputLineage);
            chat.dispose();
            const reopened = new ChatHistoryManager({ store }); await reopened.initialize();
            const history: ChatMessage[] = (await reopened.getTurns(conversation.id)).flatMap(turn => {
                const hydrated = reopened.deserializeTurn(turn); return [hydrated.userMessage, hydrated.assistantMessage];
            });
            const next = new ChatService(host as unknown as ConstructorParameters<typeof ChatService>[0]);
            const before = providerInputs.length;
            try { await next.streamLLM('What happened to that article?', () => {}, undefined, history,
                { conversationId: conversation.id, memoryMode: 'skip-memory',
                    inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'b157-followup' }]),
                    runSourceSelection: { ...selection, selectionId: 'b157-followup-selection', userMessageId: 'b157-followup' } }); }
            finally { next.dispose(); }
            const payload = JSON.stringify(providerInputs[before]);
            expect(payload).toContain(operationId); expect(payload).toContain('completed');
            expect(payload).toContain('ghostPublicationStatus'); expect(payload).toContain('published');
            expect(JSON.stringify(boundSchemas.at(-1))).not.toContain('prepare_ghost_post');
            expect(submit).toHaveBeenCalledTimes(1); expect(f.createDraft).toHaveBeenCalledTimes(1);
        } finally { chat.dispose(); f.integration.dispose(); }
    });
});

import { ChatService } from '../src/ai-services/chat-service';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import type { TaskSourceRunHost } from '../src/ai-services/task-source-run';
import type { InputLineage } from '../src/ai-services/input-lineage';
import { completeInputLineage } from '../src/ai-services/input-lineage';
import { createAbortError } from '../src/ai-services/chat-utils';

jest.mock('obsidian');

let mockAuthority = 1;
let mockPreparations = 0;
let mockProviderRequests = 0;
let mockRevoke: (() => void) | undefined;
let mockOrdinaryEdit: (() => void) | undefined;
let mockOrdinaryEditApplied = false;
// Exercise the actual SDK/runtime connection and compare the completed receipt
// with the original complete source validator. No real provider is contacted.
jest.mock('../src/ai-services/task-source-run', () => {
    const actual = jest.requireActual<typeof import('../src/ai-services/task-source-run')>('../src/ai-services/task-source-run');
    return { ...actual, TaskSourceRun: class extends actual.TaskSourceRun {
        constructor(host: TaskSourceRunHost) {
            super(host);
            const original = this.prepareLineageAdmission;
            Object.defineProperty(this, 'prepareLineageAdmission', { value: async (lineage: InputLineage | undefined, signal?: AbortSignal) => {
                expect(this.admitsLineage(lineage)).toBe(true);
                mockPreparations += 1;
                if (mockRevoke && mockProviderRequests > 0) {
                    const revoke = mockRevoke; mockRevoke = undefined; setTimeout(revoke, 0);
                }
                const receipt = await original(lineage, signal);
                expect(receipt.sourceValidity()).toBe(this.captureLineageSourceValidity(lineage)());
                if (mockOrdinaryEdit && mockProviderRequests === 0) {
                    const edit = mockOrdinaryEdit; mockOrdinaryEdit = undefined; edit();
                    mockOrdinaryEditApplied = true;
                    expect(receipt.isCurrent()).toBe(false);
                    expect(receipt.sourceValidity()).toBe(true);
                }
                return receipt;
            } });
        }
    } };
});

function createScenario(change: 'unchanged' | 'revoked' | 'ordinary-edit') {
    const revoke = change === 'revoked';
    mockAuthority = 1;
    mockPreparations = 0;
    mockProviderRequests = 0;
    mockRevoke = undefined;
    mockOrdinaryEdit = undefined;
    mockOrdinaryEditApplied = false;
    const files = Array.from({ length: 500 }, (_, index) => ({ path: `notes/source-${index}.md`,
        name: `source-${index}.md`, basename: `source-${index}`, extension: 'md',
        stat: { mtime: 1, ctime: 1, size: 12 } }));
    const byPath = new Map(files.map(file => [file.path, file]));
    const denied = new Set<string>();
    const read = jest.fn(async () => {
        // Vault I/O may finish after the currently queued timers drained.
        await new Promise<void>(resolve => setImmediate(resolve));
        return 'Synthetic note';
    });
    if (revoke) mockRevoke = () => { denied.add(files[0].path); mockAuthority += 1; };
    if (change === 'ordinary-edit') mockOrdinaryEdit = () => { mockAuthority += 1; };
    const host = { settings: { debug: false, aiProvider: 'openai', baseURL: 'https://source-admission.invalid/v1',
        chatModelName: 'fixed-model', policyModelName: '', embeddingModelName: 'fixed-embedding',
        shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false, webSearchEnabled: false,
        memoryEnabled: false, licenseTier: 'paid', operationsAgentEnabled: false,
        operationsProactiveSaveSuggestionsEnabled: false, operationsAuditIncludeContent: false,
        operationsAuditRetentionDays: 30, statisticsVaultId: 'synthetic-source-admission', retrievalOptimizationFlags: {} },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => byPath.get(path), read, cachedRead: read },
            metadataCache: { getFileCache: () => ({ headings: [], tags: [], frontmatter: {} }),
                getCache: () => ({ headings: [], tags: [], frontmatter: {} }) } },
        memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }), searchHybrid: async () => [] },
        isDataBoundaryAllowedPath: (path: string) => !denied.has(path), getMemoryEvidenceEpoch: () => 'synthetic-boundary',
        getTaskSourceAuthorityEpoch: () => String(mockAuthority),
        getAPIToken: async () => 'synthetic-token', log: () => undefined,
        isOperationsAgentEnabled: false, getMemoryExtractionPromptContext: () => undefined,
    } as unknown as AiServiceHost;
    const requests: unknown[] = [];
    const controller = new AbortController();
    let releaseFirstResponse: (() => void) | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        mockProviderRequests = requests.length;
        const first = requests.length === 1;
        if (first) await new Promise<void>((resolve, reject) => {
            const signal = init?.signal ?? controller.signal;
            const abort = () => { signal.removeEventListener('abort', abort); reject(createAbortError()); };
            releaseFirstResponse = () => { signal.removeEventListener('abort', abort); resolve(); };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
        });
        const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read-target', type: 'function',
            function: { name: 'read_note', arguments: JSON.stringify({ path: files[499].path }) } }] }
            : { role: 'assistant', content: '依据不足' };
        const frame = (value: unknown, finish: string | null) => `data: ${JSON.stringify({ id: 'fixed', created: 0,
            model: 'fixed-model', object: 'chat.completion.chunk', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
        return new Response(frame(delta, null) + frame({}, first ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    // This integration proves source authority, not CPU speed under V8
    // coverage. Advance timers without accumulating idle delay, preserving
    // item-bounded yields and the scheduled revocation. Real macrotasks and
    // elapsed-time admission have independent cooperative-task tests.
    const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
    jest.useFakeTimers({ doNotFake: ['Date', 'performance', 'nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
    let running: ReturnType<ChatService['streamLLM']> | undefined;
    let settled = false;
    let closed = false;
    let pump: Promise<void> | undefined;
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () => cleanupPromise ??= (async () => {
        closed = true;
        controller.abort();
        await running?.catch(() => undefined);
        await pump?.catch(() => undefined);
        jest.useRealTimers(); clock.mockRestore(); globalThis.fetch = originalFetch;
    })();
    const start = () => {
        if (running || closed) throw new Error('Source scenario already started or closed');
        running = new ChatService(host).streamLLM('根据笔记读取资料', jest.fn(), controller.signal, [{ role: 'assistant',
            content: 'Synthetic private history', inputLineage: completeInputLineage(files.map(file => ({
                kind: 'vault', path: file.path, via: 'note' }))) }], {
            userText: '根据笔记读取资料', memoryMode: 'skip-memory', runSourceSelection: { schemaVersion: 1,
                scope: 'notes', selectionId: 'scope', userMessageId: 'user' },
        });
        void running.then(() => { settled = true; }, () => { settled = true; });
    };
    const driveUntil = (predicate: () => boolean) => pump = (async () => {
        // A one-shot drain can finish before native SDK/WebCrypto I/O
        // schedules the next slice. Each phase owns one timer driver.
        for (let tick = 0; tick < 1_000 && !closed && !settled && !predicate(); tick++) await jest.advanceTimersByTimeAsync(10);
        expect(predicate()).toBe(true);
    })();
    const firstRequest = async () => {
        start();
        await driveUntil(() => requests.length === 1);
        expect(mockPreparations).toBeGreaterThan(0);
        expect(requests).toHaveLength(1);
        expect(read).not.toHaveBeenCalled();
        expect(releaseFirstResponse).toBeDefined();
    };
    const finish = async () => {
        if (!running || !releaseFirstResponse || closed) throw new Error('First source request is not paused');
        releaseFirstResponse();
        await driveUntil(() => settled);
        await running;
        expect(mockPreparations).toBeGreaterThan(0);
        expect(requests).toHaveLength(2);
        expect(read).toHaveBeenCalledTimes(revoke ? 0 : 1);
        if (!revoke) {
            const messages = (requests[1] as { messages: Array<{ role: string; content: string }> }).messages;
            const observation = messages.find(message => message.role === 'tool');
            expect(observation).toBeDefined();
            expect(JSON.parse(observation!.content.split('\n')[0]).isError).toBe(false);
        }
        if (revoke) expect(JSON.stringify(requests[1])).not.toContain('Synthetic private history');
        if (change === 'ordinary-edit') {
            expect(mockOrdinaryEditApplied).toBe(true);
            for (const request of requests) expect(JSON.stringify(request)).toContain('Synthetic private history');
        }
    };
    return { firstRequest, finish, cleanup };
}

describe.each(['unchanged', 'revoked', 'ordinary-edit'] as const)('source admission in one continuous actual SDK run: %s', change => {
    let scenario: ReturnType<typeof createScenario>;
    let firstStageVerified = false;
    let phasePassed = false;
    beforeAll(() => { scenario = createScenario(change); });
    beforeEach(() => { phasePassed = false; });
    afterEach(async () => {
        // A Jest timeout does not enter the interrupted body's finally. Abort
        // and await both the run and its driver before another phase can start.
        if (!phasePassed) await scenario.cleanup();
    });
    afterAll(async () => { await scenario.cleanup(); });

    it('admits 500 sources before the first physical request', async () => {
        await scenario.firstRequest();
        firstStageVerified = true;
        phasePassed = true;
    });
    it('preserves the legacy read gate and history after the tool response', async () => {
        // Both phases keep the same run, history, authority and production
        // deadline. Each default test timeout bounds its own request phase.
        expect(firstStageVerified).toBe(true);
        await scenario.finish();
        phasePassed = true;
    });
});

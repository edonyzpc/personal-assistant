import { beforeEach, describe, it, expect, jest } from '@jest/globals';
import { ChatService, canFallbackToNonStreaming } from '../src/ai-services/chat-service';
import { parsePlannerAction } from '../src/ai-services/chat-agent';

jest.mock('obsidian');

const mockCreateChatModel = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../src/ai-services/ai-utils', () => ({
    AIUtils: jest.fn().mockImplementation(() => ({
        createChatModel: mockCreateChatModel,
    })),
}));

jest.mock('@langchain/core/prompts', () => ({
    ChatPromptTemplate: {
        fromMessages: jest.fn(() => ({
            pipe: (model: unknown) => model,
        })),
    },
    SystemMessagePromptTemplate: {
        fromTemplate: jest.fn((template: string) => ({ template })),
    },
    HumanMessagePromptTemplate: {
        fromTemplate: jest.fn((template: string) => ({ template })),
    },
}));

beforeEach(() => {
    mockCreateChatModel.mockReset();
});

function createInvokeModel(content: string, onInput?: (input: unknown) => void) {
    return {
        invoke: jest.fn(async (input: unknown) => {
            onInput?.(input);
            return { content };
        }),
    };
}

function createStreamModel(content: string, onInput?: (input: Record<string, string>) => void) {
    return {
        stream: jest.fn(async function* (input: Record<string, string>) {
            onInput?.(input);
            yield { content };
        }),
    };
}

function createPlugin(overrides: {
    searchSimilarity?: (query: string) => Promise<unknown[]>;
    ensureReadyForChat?: (query?: string) => Promise<{ decision: 'use-memory' | 'answer-now' | 'cancel'; message?: string }>;
    getMaintenancePlan?: () => Promise<{ reason: string; action: string; requiresApproval: boolean }>;
} = {}) {
    return {
        vss: {
            searchSimilarity: jest.fn(overrides.searchSimilarity ?? (async () => [])),
        },
        memoryManager: {
            ensureReadyForChat: jest.fn(overrides.ensureReadyForChat ?? (async () => ({ decision: 'use-memory' }))),
            getMaintenancePlan: jest.fn(overrides.getMaintenancePlan ?? (async () => ({
                reason: 'ready',
                action: 'none',
                requiresApproval: false,
            }))),
        },
        log: jest.fn(),
    };
}

describe('streaming fallback policy', () => {
    it('allows fallback when streaming fails before any chunk', () => {
        expect(canFallbackToNonStreaming(new Error('network failed'), false)).toBe(true);
    });

    it('does not fallback after receiving a chunk', () => {
        expect(canFallbackToNonStreaming(new Error('stream interrupted'), true)).toBe(false);
    });

    it('does not fallback when the user aborts', () => {
        const controller = new AbortController();
        controller.abort();

        expect(canFallbackToNonStreaming(new Error('aborted'), false, controller.signal)).toBe(false);
    });
});

describe('planner action parser', () => {
    it('parses answer actions', () => {
        expect(parsePlannerAction('{"action":"answer","reason":"general question"}')).toEqual({
            action: 'answer',
            reason: 'general question',
        });
    });

    it('parses retrieve actions from fenced JSON', () => {
        expect(parsePlannerAction('```json\n{"action":"retrieve","query":"project notes","reason":"needs notes"}\n```')).toEqual({
            action: 'retrieve',
            query: 'project notes',
            reason: 'needs notes',
        });
    });

    it('rejects retrieve actions without a query', () => {
        expect(() => parsePlannerAction('{"action":"retrieve","reason":"missing"}')).toThrow(/query/i);
    });
});

describe('ChatService memory behavior', () => {
    it('answers without memory when planner chooses answer', async () => {
        let chainInput: Record<string, string> | undefined;
        const planner = createInvokeModel('{"action":"answer","reason":"no memory needed"}');
        const final = createStreamModel('answer without memory', (input) => {
            chainInput = input;
        });
        mockCreateChatModel
            .mockResolvedValueOnce(planner)
            .mockResolvedValueOnce(final);

        const plugin = createPlugin();
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);
        const chunks: string[] = [];

        await service.streamLLM('hello', (chunk) => chunks.push(chunk));

        expect(plugin.vss.searchSimilarity).not.toHaveBeenCalled();
        expect(plugin.memoryManager.ensureReadyForChat).not.toHaveBeenCalled();
        expect(chainInput).toMatchObject({
            input: 'Human: hello\nAssistant:',
        });
        expect(chainInput).not.toHaveProperty('memory_content');
        expect(final.stream).toHaveBeenCalledTimes(1);
        expect(chunks).toEqual(['answer without memory']);
    });

    it('uses planner query for memory retrieval', async () => {
        let chainInput: Record<string, string> | undefined;
        const plannerRetrieve = createInvokeModel('{"action":"retrieve","query":"project alpha decision","reason":"needs notes"}');
        const plannerAnswer = createInvokeModel('{"action":"answer","reason":"memory gathered"}');
        const final = createStreamModel('answer with memory', (input) => {
            chainInput = input;
        });
        mockCreateChatModel
            .mockResolvedValueOnce(plannerRetrieve)
            .mockResolvedValueOnce(plannerAnswer)
            .mockResolvedValueOnce(final);

        const plugin = createPlugin({
            searchSimilarity: async () => [{
                score: 0.9,
                doc: {
                    pageContent: 'Alpha decision from notes',
                    metadata: { path: 'alpha.md', chunkIndex: 2 },
                },
            }],
        });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);
        const chunks: string[] = [];

        await service.streamLLM('what did we decide?', (chunk) => chunks.push(chunk));

        expect(plugin.memoryManager.ensureReadyForChat).toHaveBeenCalledWith('project alpha decision');
        expect(plugin.vss.searchSimilarity).toHaveBeenCalledWith('project alpha decision');
        expect(plugin.vss.searchSimilarity).not.toHaveBeenCalledWith('what did we decide?');
        expect(chainInput?.memory_content).toContain('Alpha decision from notes');
        expect(chainInput?.memory_content).toContain('alpha.md');
        expect(chainInput?.allowed_sources).toBe('alpha.md');
        expect(chunks).toEqual(['answer with memory']);
    });

    it('does not repeat duplicate retrieve queries', async () => {
        const plannerRetrieve = createInvokeModel('{"action":"retrieve","query":"same query","reason":"needs notes"}');
        const plannerDuplicate = createInvokeModel('{"action":"retrieve","query":"same query","reason":"try again"}');
        const final = createStreamModel('answer');
        mockCreateChatModel
            .mockResolvedValueOnce(plannerRetrieve)
            .mockResolvedValueOnce(plannerDuplicate)
            .mockResolvedValueOnce(final);

        const plugin = createPlugin({
            searchSimilarity: async () => [{
                score: 0.8,
                doc: {
                    pageContent: 'Memory content',
                    metadata: { path: 'note.md', chunkIndex: 0 },
                },
            }],
        });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        await service.streamLLM('question', jest.fn());

        expect(plugin.vss.searchSimilarity).toHaveBeenCalledTimes(1);
        expect(plugin.vss.searchSimilarity).toHaveBeenCalledWith('same query');
    });

    it('skips planner and memory lookup when asked to answer now', async () => {
        let chainInput: Record<string, string> | undefined;
        const final = createStreamModel('plain answer', (input) => {
            chainInput = input;
        });
        mockCreateChatModel.mockResolvedValueOnce(final);

        const plugin = createPlugin({
            searchSimilarity: async () => {
                throw new Error('memory should not be searched');
            },
        });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);
        const chunks: string[] = [];

        await service.streamLLM('hello', (chunk) => chunks.push(chunk), undefined, undefined, {
            memoryMode: 'skip-memory',
        });

        expect(mockCreateChatModel).toHaveBeenCalledTimes(1);
        expect(plugin.memoryManager.ensureReadyForChat).not.toHaveBeenCalled();
        expect(plugin.vss.searchSimilarity).not.toHaveBeenCalled();
        expect(chainInput).toMatchObject({
            input: 'Human: hello\nAssistant:',
        });
        expect(chainInput).not.toHaveProperty('memory_content');
        expect(chunks).toEqual(['plain answer']);
    });

    it('falls back when planner output cannot be parsed', async () => {
        let chainInput: Record<string, string> | undefined;
        const planner = createInvokeModel('not json');
        const final = createStreamModel('fallback answer', (input) => {
            chainInput = input;
        });
        mockCreateChatModel
            .mockResolvedValueOnce(planner)
            .mockResolvedValueOnce(final);

        const plugin = createPlugin({
            searchSimilarity: async () => [{
                score: 0.7,
                doc: {
                    pageContent: 'Fallback memory',
                    metadata: { path: 'fallback.md', chunkIndex: 1 },
                },
            }],
        });
        const statuses: string[] = [];
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        await service.streamLLM('question', jest.fn(), undefined, undefined, {
            onStatus: (status) => statuses.push(status.type),
        });

        expect(plugin.memoryManager.getMaintenancePlan).toHaveBeenCalled();
        expect(plugin.vss.searchSimilarity).toHaveBeenCalledWith('question');
        expect(chainInput?.memory_content).toContain('Fallback memory');
        expect(statuses).toContain('fallback');
    });

    it('strips trailing memory reference callouts from chat history with flexible whitespace', async () => {
        let chainInput: Record<string, string> | undefined;
        const planner = createInvokeModel('{"action":"answer","reason":"no memory needed"}');
        const final = createStreamModel('next answer', (input) => {
            chainInput = input;
        });
        mockCreateChatModel
            .mockResolvedValueOnce(planner)
            .mockResolvedValueOnce(final);

        const plugin = createPlugin();
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        await service.streamLLM(
            'next question',
            jest.fn(),
            undefined,
            [{
                role: 'assistant',
                content: 'previous answer\n\n---   \n> [!personal-assistant-ai]-   Memory references\n> 1. [[note.md]]',
            }],
        );

        expect(chainInput?.input).toBe('Assistant: previous answer\nHuman: next question\nAssistant:');
    });
});

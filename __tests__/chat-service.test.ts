import { beforeEach, describe, it, expect, jest } from '@jest/globals';
import { ChatService, canFallbackToNonStreaming } from '../src/ai-services/chat-service';

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

describe('ChatService RAG behavior', () => {
    it('uses the normal chat path when VSS returns no RAG results', async () => {
        let chainInput: Record<string, string> | undefined;
        const stream = jest.fn(async function* (input: Record<string, string>) {
            chainInput = input;
            yield { content: 'answer without rag' };
        });
        mockCreateChatModel.mockResolvedValueOnce({ stream });

        const plugin = {
            vss: {
                searchSimilarity: jest.fn<(query: string) => Promise<unknown[]>>(async () => []),
            },
            log: jest.fn(),
        };
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);
        const chunks: string[] = [];

        await service.streamLLM('hello', (chunk) => chunks.push(chunk));

        expect(plugin.vss.searchSimilarity).toHaveBeenCalledWith('hello');
        expect(chainInput).toMatchObject({
            input: 'Human: hello\nAssistant:',
        });
        expect(chainInput).not.toHaveProperty('rag_content');
        expect(stream).toHaveBeenCalledTimes(1);
        expect(chunks).toEqual(['answer without rag']);
    });
});

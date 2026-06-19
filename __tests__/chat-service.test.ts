import { beforeEach, describe, it, expect, jest } from '@jest/globals';
import { SystemMessagePromptTemplate } from '@langchain/core/prompts';
import { Platform } from 'obsidian';
import { ChatService, canFallbackToNonStreaming, getBailianWebSearchEndpointForBaseURL } from '../src/ai-services/chat-service';
import {
    PaAgentRuntime,
    MAX_READ_ONLY_TOOL_CONTEXT_CHARS,
    getReadOnlyToolObservationMessage,
    isReadOnlyContextToolResult,
    parseNativeToolCallsFromModelResponse,
} from '../src/ai-services/pa-agent-runtime';
import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import { MOCK_LICENSE_TIER, type AgentCapabilityTier } from '../src/ai-services/capability-types';
import { createChatToolCapability } from '../src/ai-services/capability-adapter';
import { type ChatToolDefinition, type ChatToolResult } from '../src/ai-services/chat-tools';
import type { AgentEvent as CanonicalAgentEvent, ChatMessage, LegacyAgentEvent as AgentEvent } from '../src/ai-services/chat-types';
import {
    BAILIAN_INTL_WEB_SEARCH_MCP_ENDPOINT,
    BAILIAN_WEB_SEARCH_MCP_ENDPOINT,
} from '../src/ai-services/builtin-web-search-provider';

jest.mock('obsidian');

const mockCreateChatModel = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetNativeToolCallingCapability = jest.fn<(...args: unknown[]) => unknown>();

jest.mock('../src/ai-services/ai-utils', () => ({
    AIUtils: jest.fn().mockImplementation(() => ({
        createChatModel: mockCreateChatModel,
        getAPIToken: jest.fn(async () => 'sk-SECRET_TOKEN_SENTINEL'),
        getNativeToolCallingCapability: mockGetNativeToolCallingCapability,
    })),
    DASHSCOPE_INTL_COMPATIBLE_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    isDashScopeCompatibleBaseURL: (baseURL: string) => {
        const normalized = baseURL.replace(/\/+$/, '').toLowerCase();
        return normalized === 'https://dashscope.aliyuncs.com/compatible-mode/v1'
            || normalized === 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    },
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
    (Platform as { isDesktop: boolean; isMobile: boolean }).isDesktop = true;
    (Platform as { isDesktop: boolean; isMobile: boolean }).isMobile = false;
    mockCreateChatModel.mockReset();
    mockGetNativeToolCallingCapability.mockReset();
    mockGetNativeToolCallingCapability.mockReturnValue({
        supported: true,
        status: 'supported',
        provider: 'qwen',
        model: 'qwen3.6-plus',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        reason: 'Provider/model/baseURL is validated for native tool calling.',
    });
    (SystemMessagePromptTemplate.fromTemplate as unknown as jest.Mock).mockClear();
});

function createInvokeModel(content: unknown, onInput?: (input: unknown) => void) {
    const model = {
        invoke: jest.fn(async (input: unknown) => {
            onInput?.(input);
            return { content };
        }),
        bindTools: jest.fn(() => model),
    };
    return model;
}

function createNativeToolPlanningModel(
    response: unknown,
    callbacks: {
        onTools?: (tools: unknown[]) => void;
        onInput?: (input: unknown) => void;
    } = {},
) {
    const bound = {
        invoke: jest.fn(async (input: unknown) => {
            callbacks.onInput?.(input);
            return response;
        }),
    };
    return {
        bindTools: jest.fn((tools: unknown[]) => {
            callbacks.onTools?.(tools);
            return bound;
        }),
        boundInvoke: bound.invoke,
    };
}

function createStreamModel(content: string, onInput?: (input: Record<string, string>) => void) {
    const model = {
        bindTools: jest.fn(() => model),
        stream: jest.fn(async function* (input: Record<string, string>) {
            onInput?.(input);
            yield { content };
        }),
    };
    return model;
}

function createStreamChunksModel(chunks: unknown[], onInput?: (input: Record<string, string>) => void) {
    const model = {
        bindTools: jest.fn(() => model),
        stream: jest.fn(async function* (input: Record<string, string>) {
            onInput?.(input);
            for (const chunk of chunks) {
                yield chunk;
            }
        }),
    };
    return model;
}

async function flushMicrotasks(times = 6) {
    for (let index = 0; index < times; index++) {
        await Promise.resolve();
    }
}

async function waitForEvent(
    events: AgentEvent[],
    predicate: (event: AgentEvent) => boolean,
    message: string,
    timeoutMs = 1000,
) {
    const started = Date.now();
    while (!events.some(predicate)) {
        if (Date.now() - started > timeoutMs) {
            throw new Error(message);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

function canonicalEvent(overrides: Partial<CanonicalAgentEvent> & { type: CanonicalAgentEvent['type'] }): CanonicalAgentEvent {
    return {
        version: 2,
        runId: 'run_1',
        turnId: 'turn_1',
        scope: 'turn',
        seq: 1,
        timestamp: 100,
        ...overrides,
    } as CanonicalAgentEvent;
}

function createPlugin(overrides: {
    searchSimilarity?: (query: string) => Promise<unknown[]>;
    ensureReadyForChat?: (query?: string) => Promise<{ decision: 'use-memory' | 'answer-now' | 'cancel'; message?: string }>;
    getMaintenancePlan?: () => Promise<{ reason: string; action: string; requiresApproval: boolean }>;
    activeMarkdownView?: unknown;
    mostRecentLeafView?: unknown;
    markdownLeaves?: unknown[];
    markdownFiles?: Array<{
        path: string;
        basename?: string;
        name?: string;
        stat?: { mtime?: number; ctime?: number; size?: number };
    }>;
    abstractFiles?: Array<{
        path: string;
        basename?: string;
        name?: string;
        extension?: string;
        stat?: { mtime?: number; ctime?: number; size?: number };
    }>;
    fileContents?: Record<string, string>;
    metadataByPath?: Record<string, {
        tags?: Array<{ tag?: string }>;
        frontmatter?: Record<string, unknown>;
        headings?: Array<{ heading?: string; level?: number }>;
        links?: Array<{ link?: string; original?: string; displayText?: string }>;
        embeds?: Array<{ link?: string; original?: string; displayText?: string }>;
    }>;
    resolvedLinks?: Record<string, Record<string, number>>;
    unresolvedLinks?: Record<string, Record<string, number>>;
    aiProvider?: string;
    chatModelName?: string;
    baseURL?: string;
    qwenThinkingEnabled?: boolean;
    webSearchEnabled?: boolean;
    licenseTier?: AgentCapabilityTier;
    skillContextEnabled?: boolean;
    enabledSkillIds?: string[];
    memoryExtractionPromptContext?: Record<string, unknown>;
} = {}) {
    const markdownFiles = overrides.markdownFiles ?? [];
    const abstractFiles = [...markdownFiles, ...(overrides.abstractFiles ?? [])];
    return {
        settings: {
            aiProvider: overrides.aiProvider ?? 'qwen',
            chatModelName: overrides.chatModelName ?? 'qwen3.6-plus',
            baseURL: overrides.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            apiToken: 'sk-SECRET_TOKEN_SENTINEL',
            qwenThinkingEnabled: overrides.qwenThinkingEnabled ?? false,
            webSearchEnabled: overrides.webSearchEnabled ?? false,
            licenseTier: overrides.licenseTier ?? MOCK_LICENSE_TIER,
            policyModelName: '',
            embeddingModelName: 'text-embedding-3-small',
            memoryEnabled: true,
            operationsAgentEnabled: false,
            statisticsVaultId: 'test-vault',
            skillContextEnabled: overrides.skillContextEnabled ?? false,
            enabledSkillIds: overrides.enabledSkillIds ?? [],
            shareAnonymousCapabilityUsage: false,
        },
        app: {
            workspace: {
                getActiveViewOfType: jest.fn(() => overrides.activeMarkdownView ?? null),
                getMostRecentLeaf: jest.fn(() => overrides.mostRecentLeafView ? { view: overrides.mostRecentLeafView } : null),
                getLeavesOfType: jest.fn((type: string) => type === 'markdown'
                    ? (overrides.markdownLeaves ?? []).map((view) => ({ view }))
                    : []),
            },
            vault: {
                getMarkdownFiles: jest.fn(() => markdownFiles),
                getAbstractFileByPath: jest.fn((path: string) => abstractFiles.find((file) => file.path === path) ?? null),
                cachedRead: jest.fn(async (file: { path: string }) => overrides.fileContents?.[file.path] ?? ''),
            },
            metadataCache: {
                getFileCache: jest.fn((file: { path: string }) => overrides.metadataByPath?.[file.path] ?? null),
                resolvedLinks: overrides.resolvedLinks,
                unresolvedLinks: overrides.unresolvedLinks,
            },
        },
        vss: {
            searchSimilarity: jest.fn(overrides.searchSimilarity ?? (async () => [])),
            searchHybrid: jest.fn(async (query: string) => {
                const search = overrides.searchSimilarity ?? (async () => []);
                return search(query);
            }),
            getChunksByPath: jest.fn(async () => []),
        },
        memoryManager: {
            ensureReadyForChat: jest.fn(overrides.ensureReadyForChat ?? (async () => ({ decision: 'use-memory' }))),
            getMaintenancePlan: jest.fn(overrides.getMaintenancePlan ?? (async () => ({
                reason: 'ready',
                action: 'none',
                requiresApproval: false,
            }))),
        },
        memorySearch: {
            ensureReadyForChat: jest.fn(overrides.ensureReadyForChat ?? (async () => ({ decision: 'use-memory' }))),
            searchHybrid: jest.fn(async (query: string) => {
                const search = overrides.searchSimilarity ?? (async () => []);
                return search(query);
            }),
            getChunksByPath: jest.fn(async () => []),
        },
        log: jest.fn(),
        getAPIToken: jest.fn(async () => 'sk-SECRET_TOKEN_SENTINEL'),
        isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: jest.fn(() => overrides.memoryExtractionPromptContext),
        getResolvedLinks: jest.fn(() => overrides.resolvedLinks),
    };
}

function createRuntime(
    host: ReturnType<typeof createPlugin>,
    nativeToolPlanningInternalGate = false,
    extraOptions: Partial<ConstructorParameters<typeof PaAgentRuntime>[2]> = {},
) {
    return new PaAgentRuntime(
        host as unknown as ConstructorParameters<typeof PaAgentRuntime>[0],
        {
            createChatModel: mockCreateChatModel,
            getNativeToolCallingCapability: mockGetNativeToolCallingCapability,
        } as never,
        { nativeToolPlanningInternalGate, ...extraOptions },
    );
}

function createMarkdownView(overrides: {
    path?: string;
    basename?: string;
    selection?: string;
    value?: string;
    cursorLine?: number;
} = {}) {
    const value = overrides.value ?? '';
    const lines = value.split(/\r?\n/);
    return {
        file: {
            path: overrides.path ?? 'current.md',
            basename: overrides.basename ?? 'current',
        },
        editor: {
            getSelection: jest.fn(() => overrides.selection ?? ''),
            getValue: jest.fn(() => value),
            getCursor: jest.fn(() => ({ line: overrides.cursorLine ?? 0, ch: 0 })),
            lineCount: jest.fn(() => lines.length),
            getLine: jest.fn((line: number) => lines[line] ?? ''),
        },
    };
}

function extractCurrentNoteContextPayload(input: string | undefined): Record<string, unknown> {
    const match = input?.match(/<current_note_context>\n([\s\S]*?)\n<\/current_note_context>/);
    if (!match) {
        throw new Error('Current note context block was not found.');
    }
    return JSON.parse(match[1]) as Record<string, unknown>;
}

function extractToolContextPayload(input: string | undefined, tool: string): Record<string, unknown> {
    const match = input?.match(new RegExp(`<tool_context tool="${tool}">\\n([\\s\\S]*?)\\n<\\/tool_context>`));
    if (!match) {
        throw new Error(`${tool} context block was not found.`);
    }
    return JSON.parse(match[1]) as Record<string, unknown>;
}

function extractSerializedToolContextBlocks(input: string | undefined): string[] {
    return [...(input ?? '').matchAll(/<tool_context tool="[^"]+">\n[\s\S]*?\n<\/tool_context>/g)]
        .map((match) => match[0]);
}

function extractPlannerRegistryDefinitions(input: unknown): Array<Record<string, unknown>> {
    const text = typeof (input as { input?: unknown })?.input === 'string'
        ? (input as { input: string }).input
        : '';
    const match = text.match(/Registry tool definitions:\n([\s\S]*?)\n\nRelated Memory candidates/);
    if (!match) {
        throw new Error('Registry tool definitions block was not found.');
    }
    return match[1]
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
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

    it('throws canonical abort errors when a tool failure races with cancellation', async () => {
        const registry = new CapabilityRegistry();
        const controller = new AbortController();
        const execute = async (): Promise<ChatToolResult<string>> => {
            controller.abort();
            throw new Error('tool failed during cancellation');
        };
        const definition: ChatToolDefinition<Record<string, never>, string> = {
            name: 'get_current_note_context',
            description: 'test tool',
            plannerGuidance: ['test planner guidance'],
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false,
            },
            permission: 'read-only',
            cost: 'free',
            outputBudgetChars: 100,
            requiresConfirmation: false,
            failureBehavior: 'recoverable',
            statusMessageText: 'running test tool',
            sourceBoundary: 'current-note',
            statusMessage: () => 'running test tool',
            validateInput: () => ({}),
            execute,
        };
        registry.register(createChatToolCapability(definition, { providerId: 'test-cancel' }));

        await expect(registry.execute('get_current_note_context', {}, {
            host: createPlugin() as unknown as Parameters<typeof registry.execute>[2]["host"],
            signal: controller.signal,
        })).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('keeps registered tool metadata available for policy and provider schema export', () => {
        const registry = new CapabilityRegistry();
        const definition: ChatToolDefinition<{ query: string }, string> = {
            name: 'search_memory',
            description: 'Search test memory.',
            plannerGuidance: ['Use for test memory.'],
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Memory query' },
                },
                required: ['query'],
                additionalProperties: false,
            },
            permission: 'read-only',
            cost: 'ai-calls',
            outputBudgetChars: 1000,
            requiresConfirmation: false,
            failureBehavior: 'recoverable',
            statusMessageText: 'Searching memory',
            sourceBoundary: 'memory',
            statusMessage: (input) => `Searching memory: ${input.query}`,
            validateInput: (input) => input as { query: string },
            execute: async () => ({
                ok: true,
                tool: 'search_memory',
                inputSummary: 'query',
                content: 'ok',
                sources: [],
            }),
        };

        registry.register(createChatToolCapability(definition, { providerId: 'test-metadata' }));

        expect(registry.getDefinition('search_memory')).toMatchObject({
            name: 'search_memory',
            permission: 'read-only',
            plannerGuidance: ['Use for test memory.'],
            cost: 'ai-calls',
            outputBudgetChars: 1000,
            requiresConfirmation: false,
            failureBehavior: 'recoverable',
            statusMessage: 'Searching memory',
            sourceBoundary: 'memory',
        });
        expect(registry.listDefinitions()).toHaveLength(1);
        expect(registry.exportProviderSchemas()).toEqual([{
            type: 'function',
            function: {
                name: 'search_memory',
                description: 'Search test memory.',
                parameters: definition.inputSchema,
            },
        }]);
    });
});



describe('native tool call fixtures', () => {
    it('parses OpenAI-compatible tool call response shapes', () => {
        const result = parseNativeToolCallsFromModelResponse({
            additional_kwargs: {
                tool_calls: [{
                    id: 'call_1',
                    function: {
                        name: 'search_vault_metadata',
                        arguments: '{"query":"dog","limit":2}',
                    },
                }],
            },
        });

        expect(result).toEqual({
            ok: true,
            calls: [{
                id: 'call_1',
                name: 'search_vault_metadata',
                input: { query: 'dog', limit: 2 },
                index: undefined,
            }],
        });
    });

    it('parses LangChain tool call chunks with complete arguments', () => {
        const result = parseNativeToolCallsFromModelResponse({
            tool_call_chunks: [{
                index: 0,
                name: 'get_current_note_context',
                args: '{"mode":"metadata"}',
            }],
        });

        expect(result).toEqual({
            ok: true,
            calls: [{
                id: undefined,
                name: 'get_current_note_context',
                input: { mode: 'metadata' },
                index: 0,
            }],
        });
    });

    it('merges streamed native tool call chunks before parsing arguments', () => {
        const result = parseNativeToolCallsFromModelResponse({
            tool_call_chunks: [
                { index: 0, name: 'search_vault_metadata', args: '{"query":"' },
                { index: 0, args: 'roadmap","limit":5}' },
                { index: 1, name: 'get_current_note_context', args: '{"mode":"outline"}' },
            ],
        });

        expect(result).toEqual({
            ok: true,
            calls: [
                {
                    id: undefined,
                    name: 'search_vault_metadata',
                    input: { query: 'roadmap', limit: 5 },
                    index: 0,
                },
                {
                    id: undefined,
                    name: 'get_current_note_context',
                    input: { mode: 'outline' },
                    index: 1,
                },
            ],
        });
    });

    it('merges continuation chunks without provider ids or indexes into the previous call', () => {
        const result = parseNativeToolCallsFromModelResponse({
            tool_call_chunks: [
                { name: 'search_vault_metadata', args: '{"query":"' },
                { args: 'roadmap","limit":5}' },
            ],
        });

        expect(result).toEqual({
            ok: true,
            calls: [{
                id: undefined,
                name: 'search_vault_metadata',
                input: { query: 'roadmap', limit: 5 },
                index: undefined,
            }],
        });
    });

    it('returns a bounded failure for incomplete native tool arguments', () => {
        expect(parseNativeToolCallsFromModelResponse({
            tool_call_chunks: [{
                index: 0,
                name: 'search_memory',
                args: '{"query":"unfinished"',
            }],
        })).toEqual({
            ok: false,
            calls: [],
            reason: 'tool_call_chunks contained incomplete or invalid JSON arguments.',
        });
    });
});

describe('ChatService.streamLLM integration', () => {
    it('uses the matching regional WebSearch MCP endpoint for DashScope-compatible base URLs', () => {
        expect(getBailianWebSearchEndpointForBaseURL('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(BAILIAN_WEB_SEARCH_MCP_ENDPOINT);
        expect(getBailianWebSearchEndpointForBaseURL('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/')).toBe(BAILIAN_INTL_WEB_SEARCH_MCP_ENDPOINT);
    });

    it('routes a simple PA canonical turn from model chunk to onChunk callback', async () => {
        const model = createStreamModel('Hello there.');
        mockCreateChatModel.mockResolvedValue(model);
        const plugin = createPlugin();
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        const chunks: string[] = [];
        const events: AgentEvent[] = [];
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await service.streamLLM(
            'hello',
            (chunk) => chunks.push(chunk),
            undefined,
            undefined,
            {
                onEvent: (event) => events.push(event),
                onLifecycleEvent: (event) => canonicalEvents.push(event),
            },
        );

        // PA canonical → adapter → adaptAgentEvent → onChunk receives at least one snapshot
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[chunks.length - 1]).toContain('Hello there.');
        // Legacy v1 stream should include answer-snapshot + answer-complete
        const eventKinds = events.map((e) => e.kind);
        expect(eventKinds).toContain('answer-snapshot');
        expect(eventKinds).toContain('answer-complete');
        expect(canonicalEvents.find((event) => event.type === 'turn_end')).toMatchObject({
            metadata: {
                metrics: [expect.objectContaining({
                    type: 'model_input_metrics',
                    inputChars: expect.any(Number),
                    exportedProviderSchemaCount: expect.any(Number),
                    boundProviderSchemaCount: expect.any(Number),
                    toolDefinitionsChars: expect.any(Number),
                })],
            },
        });
        expect(canonicalEvents.find((event) => event.type === 'turn_end')).not.toMatchObject({
            metadata: {
                diagnostics: [expect.objectContaining({ type: 'model_input_metrics' })],
            },
        });
        const boundToolNames = ((model.bindTools as jest.Mock).mock.calls[0]?.[0] as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name)
            .sort();
        expect(boundToolNames).toEqual(['get_current_note_context', 'search_memory']);
    });

    it('exports builtin WebSearch capability when enabled for a DashScope-compatible provider', async () => {
        const model = createStreamChunksModel([{ content: 'with web search' }]);
        mockCreateChatModel.mockResolvedValue(model);
        const plugin = createPlugin({ webSearchEnabled: true });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        await service.streamLLM('use web search', jest.fn());

        const exportedToolNames = ((model.bindTools as jest.Mock).mock.calls[0]?.[0] as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name);
        expect(exportedToolNames).toContain('webSearch');
    });

    it('honors explicit notes-only source scope when WebSearch is available', async () => {
        const model = createStreamChunksModel([{ content: 'notes only' }]);
        mockCreateChatModel.mockResolvedValue(model);
        const plugin = createPlugin({ webSearchEnabled: true });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        await service.streamLLM('只从我的笔记里找周至擅长什么', jest.fn());

        const exportedToolNames = ((model.bindTools as jest.Mock).mock.calls[0]?.[0] as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name)
            .sort();
        expect(exportedToolNames).toEqual(['search_memory']);
    });

    it('honors Chinese explicit no-web when weather/current-info would otherwise route to WebSearch', async () => {
        const modelInputs: Record<string, string>[] = [];
        const model = createStreamChunksModel([{ content: 'no web weather answer' }], (input) => {
            modelInputs.push(input);
        });
        mockCreateChatModel.mockResolvedValue(model);
        const plugin = createPlugin({ webSearchEnabled: true });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);
        const canonicalEvents: CanonicalAgentEvent[] = [];
        const chatHistory: ChatMessage[] = [
            {
                role: 'user',
                content: '不要联网，看一下杭州今天的天气',
            },
            {
                role: 'assistant',
                content: '我目前只有 webSearch 这个工具可以查天气。',
            },
        ];

        await service.streamLLM(
            '不要联网，看一下杭州今天的天气',
            jest.fn(),
            undefined,
            chatHistory,
            { onLifecycleEvent: (event) => canonicalEvents.push(event) },
        );

        const exportedToolNames = ((model.bindTools as jest.Mock).mock.calls[0]?.[0] as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name)
            .sort();
        expect(exportedToolNames).toEqual(['get_current_note_context', 'search_memory']);
        expect(modelInputs[0]?.tool_definitions).not.toContain('webSearch');
        expect(modelInputs[0]?.input).toContain('Recent chat history');
        expect(modelInputs[0]?.input).toContain('我目前只有 webSearch');
        expect(modelInputs[0]?.input).toContain('explicitly forbids web or internet access');
        expect(modelInputs[0]?.input).toContain('Ignore any prior assistant message that described webSearch as available');
        expect(canonicalEvents.find((event) => event.type === 'agent_end')).toMatchObject({
            status: 'completed',
            metadata: expect.not.objectContaining({
                warnings: expect.any(Array),
            }),
        });
    });

    it('does not let polluted User Profile suppress available WebSearch', async () => {
        const modelInputs: Record<string, string>[] = [];
        const model = createStreamChunksModel([{ content: 'weather answer' }], (input) => {
            modelInputs.push(input);
        });
        mockCreateChatModel.mockResolvedValue(model);
        const plugin = createPlugin({
            webSearchEnabled: true,
            memoryExtractionPromptContext: {
                userProfile: [
                    '# User Profile',
                    '- 不要联网，看一下杭州今天的天气。',
                    '- I prefer concise plans.',
                ].join('\n'),
            },
        });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        await service.streamLLM('看一下杭州今天的天气', jest.fn());

        const exportedToolNames = ((model.bindTools as jest.Mock).mock.calls[0]?.[0] as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name)
            .sort();
        expect(exportedToolNames).toEqual(['webSearch']);
        expect(modelInputs[0]?.tool_definitions).toContain('webSearch');
        expect(modelInputs[0]?.input).not.toContain('不要联网');
        expect(modelInputs[0]?.input).not.toContain('杭州今天的天气。');
        expect(modelInputs[0]?.input).toContain('I prefer concise plans.');
        expect(modelInputs[0]?.input).not.toContain('explicitly forbids web or internet access');
    });

    it('lets current-turn no-web override profile content that mentions using WebSearch', async () => {
        const modelInputs: Record<string, string>[] = [];
        const model = createStreamChunksModel([{ content: 'no web weather answer' }], (input) => {
            modelInputs.push(input);
        });
        mockCreateChatModel.mockResolvedValue(model);
        const plugin = createPlugin({
            webSearchEnabled: true,
            memoryExtractionPromptContext: {
                userProfile: [
                    '# User Profile',
                    '- I usually prefer web search for weather checks.',
                    '- I prefer concise plans.',
                ].join('\n'),
            },
        });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        await service.streamLLM('不要联网，看一下杭州今天的天气', jest.fn());

        const exportedToolNames = ((model.bindTools as jest.Mock).mock.calls[0]?.[0] as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name)
            .sort();
        expect(exportedToolNames).toEqual(['get_current_note_context', 'search_memory']);
        expect(modelInputs[0]?.tool_definitions).not.toContain('webSearch');
        expect(modelInputs[0]?.input).toContain('explicitly forbids web or internet access');
        expect(modelInputs[0]?.input).toContain('I usually prefer web search for weather checks.');
    });

    it('keeps load_skill bound when a skill catalog is rendered in narrowed source-scoped turns', async () => {
        const model = createStreamChunksModel([{ content: 'weather answer' }]);
        mockCreateChatModel.mockResolvedValue(model);
        const plugin = createPlugin({
            webSearchEnabled: true,
            skillContextEnabled: true,
            enabledSkillIds: ['obsidian-markdown'],
        });
        const service = new ChatService(plugin as unknown as ConstructorParameters<typeof ChatService>[0]);

        await service.streamLLM('看一下杭州今天的天气', jest.fn());

        const exportedToolNames = ((model.bindTools as jest.Mock).mock.calls[0]?.[0] as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name)
            .sort();
        expect(exportedToolNames).toEqual(['load_skill', 'webSearch']);
    });
});

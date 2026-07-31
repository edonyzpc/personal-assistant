import { describe, expect, it, jest } from '@jest/globals';

import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import { BUILTIN_WEB_SEARCH_TOOL_NAME } from '../src/ai-services/builtin-web-search-provider';
import { createCoreToolCapabilities } from '../src/ai-services/capability-adapter';
import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import type {
    AgentCapability,
    AgentCapabilityContext,
} from '../src/ai-services/capability-types';
import type { ChatToolRegistryDefinition } from '../src/ai-services/chat-tools';
import type { PaAgentMessage } from '../src/ai-services/chat-types';
import { createAgentControlSnapshot } from '../src/ai-services/pa-agent-control-policy';
import type {
    PaAgentModel,
    PaAgentModelInput,
    PaAgentModelStreamChunk,
} from '../src/ai-services/pa-agent-loop';
import { createAnchorBoundCurrentNoteTool } from '../src/pagelet/agent/anchor-note-tool';
import {
    PAGELET_AGENT_READ_ONLY_TOOL_ALLOWLIST,
    createPageletAgentRuntime,
} from '../src/pagelet/agent/pagelet-agent-runtime';
import {
    createPageletNativeModel,
    type PageletNativePrompt,
} from '../src/pagelet/agent/pagelet-native-model';
import type {
    PageletAgentSourceMaterial,
    PageletAnchorSnapshot,
} from '../src/pagelet/agent/types';

jest.mock('obsidian');

const anchor: PageletAnchorSnapshot = {
    path: 'notes/anchor.md',
    content: '# Anchor\nvalidate first before release',
    mtime: 10,
    size: 38,
    contentHash: 'a'.repeat(64),
    capturedAt: 100,
};
const relatedContent = '# Related\nrelease directly creates risk';
const relatedMaterial: PageletAgentSourceMaterial = {
    path: 'notes/related.md',
    content: relatedContent,
    mtime: 11,
    size: relatedContent.length,
    contentHash: 'b'.repeat(64),
    capturedAt: 101,
};

function createFakeWebCapability() {
    const definition: ChatToolRegistryDefinition = {
        name: BUILTIN_WEB_SEARCH_TOOL_NAME,
        description: 'Verify one established vault lead on the web.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
            },
            required: ['query'],
            additionalProperties: false,
        },
        plannerGuidance: ['Use only after a vault lead is established.'],
        permission: 'network-read',
        cost: 'network-calls',
        outputBudgetChars: 2_000,
        requiresConfirmation: false,
        failureBehavior: 'recoverable',
        statusMessage: 'Verifying on the web',
        sourceBoundary: 'web',
    };
    const execute = jest.fn(async (
        input: unknown,
        _context: AgentCapabilityContext,
    ) => ({
        status: 'ok' as const,
        observation: {
            query: (input as { query?: unknown }).query,
            results: [{ title: 'Official result', snippet: 'Verified external fact.' }],
        },
        sourceRecords: [{
            kind: 'web-source' as const,
            dedupKey: 'https://example.com/official',
            providerId: 'pagelet-test-web',
            capabilityName: BUILTIN_WEB_SEARCH_TOOL_NAME,
            sourceBoundary: 'web' as const,
            title: 'Official result',
            url: 'https://example.com/official',
            snippet: 'Verified external fact.',
            citationEligible: true,
        }],
        inputSummary: String((input as { query?: unknown }).query ?? ''),
        sources: [],
    }));
    const capability: AgentCapability = {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        plannerGuidance: [...definition.plannerGuidance],
        kind: 'tool',
        origin: 'builtin-mcp',
        providerId: 'pagelet-test-web',
        permission: definition.permission,
        sourceBoundary: definition.sourceBoundary,
        cost: definition.cost,
        platform: 'both',
        outputBudgetChars: definition.outputBudgetChars,
        timeoutMs: 5_000,
        requiresConfirmation: definition.requiresConfirmation,
        failureBehavior: definition.failureBehavior,
        statusMessageText: definition.statusMessage,
        sourceRecordKind: 'web-source',
        toProviderSchema: () => ({
            type: 'function',
            function: {
                name: definition.name,
                description: definition.description,
                parameters: definition.inputSchema,
            },
        }),
        toRegistryDefinition: () => ({
            ...definition,
            plannerGuidance: [...definition.plannerGuidance],
        }),
        execute,
    };
    return {
        execute,
        capability,
    };
}

function createHost(): AiServiceHost {
    const contents: Record<string, string> = {
        'notes/anchor.md': anchor.content,
        'notes/related.md': relatedContent,
    };
    const files = Object.entries(contents).map(([path, content], index) => ({
        path,
        basename: path.split('/').pop()?.replace(/\.md$/, ''),
        stat: { mtime: 10 + index, ctime: 1, size: content.length },
    }));
    return {
        app: {
            vault: {
                getMarkdownFiles: () => files,
                getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
                cachedRead: async (file: { path: string }) => contents[file.path] ?? '',
            },
            metadataCache: {
                getFileCache: (file: { path: string }) => ({
                    headings: [{ heading: file.path.includes('related') ? 'Related' : 'Anchor', level: 1 }],
                    links: [],
                    embeds: [],
                }),
                resolvedLinks: {},
                unresolvedLinks: {},
            },
            workspace: {
                getActiveViewOfType: () => ({
                    file: files[1],
                    editor: { getValue: () => contents['notes/related.md'] },
                }),
            },
        },
        settings: {
            debug: false,
            aiProvider: 'test',
            baseURL: '',
            chatModelName: 'test-model',
            policyModelName: 'test-policy',
            embeddingModelName: 'test-embedding',
            shareAnonymousCapabilityUsage: false,
            skillContextEnabled: false,
            enabledSkillIds: [],
            qwenThinkingEnabled: false,
            webSearchEnabled: false,
            licenseTier: 'paid',
            memoryEnabled: false,
            operationsAgentEnabled: false,
            statisticsVaultId: 'vault',
        },
        log: jest.fn(),
        getAPIToken: async () => '',
        isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: () => undefined,
        memorySearch: {} as AiServiceHost['memorySearch'],
        getResolvedLinks: () => ({}),
    } as unknown as AiServiceHost;
}

function scriptedModel(onInput?: (input: PaAgentModelInput) => void): PaAgentModel {
    return {
        stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
            onInput?.(input);
            if (input.turnIndex === 0) {
                yield {
                    type: 'toolcall_delta',
                    id: 'anchor-call',
                    name: 'get_current_note_context',
                    input: { mode: 'full' },
                    index: 0,
                };
                yield {
                    type: 'toolcall_delta',
                    id: 'related-call',
                    name: 'inspect_obsidian_note',
                    input: { path: 'notes/related.md' },
                    index: 1,
                };
                return;
            }
            yield {
                type: 'text_delta',
                text: [
                    '## 发布假设发生冲突',
                    '`notes/anchor.md` 要求 validate first，',
                    '而 `notes/related.md` 主张 release directly；这意味着直接发布会增加 risk。',
                ].join('\n'),
            };
        },
    };
}

describe('Pagelet agent runtime', () => {
    it('uses the fixed read-only registry, loop fuses, provenance, and optional turn leases', async () => {
        const host = createHost();
        const registeredNames: string[][] = [];
        const modelInputs: PaAgentModelInput[] = [];
        const releases: Array<jest.Mock> = [];
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async (path) => (
                path === relatedMaterial.path ? { ...relatedMaterial } : null
            ),
            createModel: (context) => {
                registeredNames.push(context.registry.listDefinitions().map((definition) => definition.name));
                return scriptedModel((input) => modelInputs.push(input));
            },
            turnLeaseProvider: async () => {
                const release = jest.fn();
                releases.push(release);
                return { release };
            },
            now: (() => {
                let value = 1_000;
                return () => value += 5;
            })(),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-test',
        });

        expect(result.loopResult.status).toBe('completed');
        expect(result.metrics).toMatchObject({ modelTurns: 2, toolCalls: 2 });
        expect(result.sourceSnapshots.map((source) => source.path)).toEqual([
            'notes/anchor.md',
            'notes/related.md',
        ]);
        expect(result.sourceTools.get('notes/anchor.md')).toContain('get_current_note_context');
        expect(result.sourceTools.get('notes/related.md')).toContain('inspect_obsidian_note');
        expect(registeredNames[0]).toEqual(expect.arrayContaining([
            'search_memory',
            'get_current_note_context',
            'search_vault_snippets',
            'inspect_obsidian_note',
            'search_vault_metadata',
            'list_recent_notes',
            'read_note_outline',
        ]));
        expect(registeredNames[0]).not.toEqual(expect.arrayContaining([
            'read_canvas_summary',
            'list_vault_tags',
            'load_skill',
        ]));
        expect(PAGELET_AGENT_READ_ONLY_TOOL_ALLOWLIST.has('append_to_current_note')).toBe(false);
        expect(releases).toHaveLength(2);
        expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
        expect(modelInputs[0]?.runtimeInstruction).toContain('3–5 model turns');
        expect(modelInputs[0]?.runtimeInstruction).toContain('inline code');
        expect(modelInputs[1]?.runtimeInstruction).toContain(
            'The anchor and at least one non-anchor content source are already observed.',
        );
        expect(modelInputs[1]?.runtimeInstruction).toContain('never mention an unverified .md path');
    });

    it('reserves the last available turn for a source-grounded final answer', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path === relatedMaterial.path,
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async (path) => (
                path === relatedMaterial.path ? { ...relatedMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.toolMode === 'final_answer_only') {
                        yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                        return;
                    }
                    yield {
                        type: 'toolcall_delta',
                        id: `recent-${input.turnIndex}`,
                        name: 'list_recent_notes',
                        input: {
                            limit: input.turnIndex + 1,
                            order: input.turnIndex % 2 === 0 ? 'modified' : 'created',
                        },
                        index: 0,
                    } as const;
                },
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-final-turn-reserve-test',
        });

        expect(result.loopResult.status).toBe('completed');
        expect(result.finalText).toBe('NO_INSIGHT');
        expect(result.loopResult.turns).toHaveLength(12);
        expect(modelInputs[11]).toMatchObject({
            turnIndex: 11,
            toolMode: 'final_answer_only',
        });
        expect(modelInputs[11]?.runtimeInstruction).toContain(
            'never mention an unverified .md path',
        );
    });

    it('reserves finalization before a penultimate blocked WebSearch correction', async () => {
        const web = createFakeWebCapability();
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async () => null,
            webCapabilities: [web.capability],
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.toolMode === 'final_answer_only') {
                        yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                        return;
                    }
                    if (input.turnIndex === 10) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'penultimate-web',
                            name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                            input: { query: 'unverified external lead' },
                            index: 0,
                        } as const;
                        return;
                    }
                    yield {
                        type: 'toolcall_delta',
                        id: `memory-${input.turnIndex}`,
                        name: 'search_memory',
                        input: { query: `lead-${input.turnIndex}` },
                        index: 0,
                    } as const;
                },
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-penultimate-web-reserve-test',
        });

        expect(result.loopResult.status).toBe('completed');
        expect(result.finalText).toBe('NO_INSIGHT');
        expect(result.loopResult.turns).toHaveLength(12);
        expect(result.loopResult.turns[10]?.toolResults[0]).toMatchObject({
            toolName: BUILTIN_WEB_SEARCH_TOOL_NAME,
            isError: true,
            content: {
                metadata: {
                    reason: 'control_snapshot_tool_blocked',
                },
            },
        });
        expect(modelInputs[11]).toMatchObject({
            turnIndex: 11,
            toolMode: 'final_answer_only',
        });
        expect(web.execute).not.toHaveBeenCalled();
    });

    it('allows one corrected attempt after a later recoverable vault read failure', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async (path) => (
                path === relatedMaterial.path ? { ...relatedMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'anchor-first',
                            name: 'get_current_note_context',
                            input: { mode: 'full' },
                            index: 0,
                        } as const;
                        return;
                    }
                    if (input.turnIndex === 1) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'missing-note',
                            name: 'inspect_obsidian_note',
                            input: { path: 'notes/missing.md' },
                            index: 0,
                        } as const;
                        return;
                    }
                    if (input.turnIndex === 2) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'corrected-note',
                            name: 'inspect_obsidian_note',
                            input: { path: relatedMaterial.path },
                            index: 0,
                        } as const;
                        return;
                    }
                    yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                },
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-recoverable-correction-test',
        });

        expect(result.loopResult.status).toBe('completed');
        expect(result.loopResult.turns[1]?.toolResults[0]).toMatchObject({
            toolName: 'inspect_obsidian_note',
            isError: true,
            content: {
                metadata: {
                    outcome: 'recoverable_error',
                },
            },
        });
        expect(modelInputs[2]?.runtimeInstruction).toContain(
            'Make one corrected read-only attempt',
        );
        expect(result.sourceSnapshots.map((source) => source.path)).toEqual([
            'notes/anchor.md',
            'notes/related.md',
        ]);
    });

    it('allows one corrected attempt after a later vault schema error', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async (path) => (
                path === relatedMaterial.path ? { ...relatedMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'schema-anchor',
                            name: 'get_current_note_context',
                            input: { mode: 'full' },
                            index: 0,
                        } as const;
                        return;
                    }
                    if (input.turnIndex === 1) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'malformed-inspect',
                            name: 'inspect_obsidian_note',
                            argsText: '{"path"',
                            index: 0,
                        } as const;
                        return;
                    }
                    if (input.turnIndex === 2) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'schema-corrected-note',
                            name: 'inspect_obsidian_note',
                            input: { path: relatedMaterial.path },
                            index: 0,
                        } as const;
                        return;
                    }
                    yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                },
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-schema-correction-test',
        });

        expect(result.loopResult.turns[1]?.toolResults[0]).toMatchObject({
            toolName: 'inspect_obsidian_note',
            isError: true,
            content: {
                metadata: {
                    outcome: 'schema_invalid',
                },
            },
        });
        expect(modelInputs[2]?.runtimeInstruction).toContain(
            'Make one corrected read-only attempt',
        );
        expect(result.sourceSnapshots.map((source) => source.path)).toEqual([
            'notes/anchor.md',
            'notes/related.md',
        ]);
    });

    it('does not retry a hard policy rejection as a recoverable vault correction', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.toolMode === 'final_answer_only') {
                        yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                        return;
                    }
                    yield {
                        type: 'toolcall_delta',
                        id: 'blocked-write',
                        name: 'append_to_current_note',
                        input: { content: 'not allowed' },
                        index: 0,
                    } as const;
                },
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-hard-rejection-test',
        });

        expect(result.loopResult.turns[0]?.toolResults[0]).toMatchObject({
            toolName: 'append_to_current_note',
            isError: true,
            content: {
                metadata: {
                    outcome: 'policy_rejected',
                },
            },
        });
        expect(modelInputs).toHaveLength(2);
        expect(modelInputs[1]).toMatchObject({
            turnIndex: 1,
            toolMode: 'final_answer_only',
        });
        expect(modelInputs[1]?.runtimeInstruction).not.toContain(
            'Make one corrected read-only attempt',
        );
    });

    it('discards a metadata observation before the next model turn when content verification rejects it', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const captureSourceMaterial = jest.fn(async (
            _path: string,
            _signal?: AbortSignal,
        ) => null);
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'metadata-call',
                            name: 'search_vault_metadata',
                            input: { query: 'related', limit: 5 },
                            index: 0,
                        } as const;
                        return;
                    }
                    yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                },
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-content-boundary-test',
        });

        expect(captureSourceMaterial).toHaveBeenCalledWith(
            'notes/related.md',
            expect.any(AbortSignal),
        );
        expect(modelInputs).toHaveLength(2);
        const nextTurnTranscript = JSON.stringify(modelInputs[1]?.transcript);
        expect(nextTurnTranscript).not.toContain('notes/related.md');
        expect(nextTurnTranscript).toContain('Tool observation was discarded');
        expect(result.sourceSnapshots).toEqual([]);
        expect(result.toolProvenance).toEqual([
            expect.objectContaining({
                toolName: 'search_vault_metadata',
                sourceRecords: [],
                isError: true,
                promptText: expect.stringContaining('discarded'),
            }),
        ]);
    });

    it('blocks same-turn WebSearch until a successful vault lead unlocks the identical call', async () => {
        const web = createFakeWebCapability();
        const modelInputs: PaAgentModelInput[] = [];
        const repeatedWebInput = { query: 'official release policy' };
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async () => null,
            webCapabilities: [web.capability],
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'anchor-lead',
                            name: 'get_current_note_context',
                            input: { mode: 'full' },
                            index: 0,
                        } as const;
                        yield {
                            type: 'toolcall_delta',
                            id: 'web-blocked',
                            name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                            input: repeatedWebInput,
                            index: 1,
                        } as const;
                        return;
                    }
                    if (input.turnIndex === 1) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'web-unlocked',
                            name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                            input: repeatedWebInput,
                            index: 0,
                        } as const;
                        return;
                    }
                    yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                },
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-web-control-snapshot-test',
        });

        const blockedWeb = result.loopResult.turns[0]?.toolResults.find(
            (toolResult) => toolResult.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME,
        );
        const unlockedWeb = result.loopResult.turns[1]?.toolResults.find(
            (toolResult) => toolResult.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME,
        );
        expect(blockedWeb).toMatchObject({
            isError: true,
            content: {
                metadata: {
                    outcome: 'policy_rejected',
                    reason: 'control_snapshot_tool_blocked',
                    preflightOnly: true,
                },
            },
        });
        expect(web.execute).toHaveBeenCalledTimes(1);
        expect(web.execute).toHaveBeenCalledWith(
            repeatedWebInput,
            expect.objectContaining({ turnId: result.loopResult.turns[1]?.turnId }),
        );
        expect(unlockedWeb).toMatchObject({
            isError: false,
            content: {
                metadata: {
                    outcome: 'success',
                },
            },
        });
        expect(modelInputs[0]?.controlSnapshot?.blockedToolNames)
            .toContain(BUILTIN_WEB_SEARCH_TOOL_NAME);
        expect(modelInputs[1]?.controlSnapshot?.blockedToolNames?.has(
            BUILTIN_WEB_SEARCH_TOOL_NAME,
        )).not.toBe(true);
        expect(result.webObservations).toHaveLength(1);
    });

    it('provides a reusable native model adapter that binds registry schemas', async () => {
        const registry = new CapabilityRegistry();
        registry.registerMany(createCoreToolCapabilities([
            createAnchorBoundCurrentNoteTool(anchor),
        ]));
        const turnController = new AbortController();
        const streamSignals: Array<AbortSignal | undefined> = [];
        const bindTools = jest.fn((_schemas: unknown[]) => runnable);
        const runnable = {
            bindTools,
            stream: async function* (
                _input: unknown,
                options?: { signal?: AbortSignal },
            ) {
                streamSignals.push(options?.signal);
                yield { content: 'native answer' };
            },
            invoke: async () => ({ content: 'fallback answer' }),
        };
        const prompt: PageletNativePrompt = {
            pipe: (model) => model as typeof runnable,
        };
        const model = createPageletNativeModel({
            registry,
            allowedToolNames: new Set(['get_current_note_context']),
            createChatModel: async () => runnable,
            createPrompt: () => prompt,
        });

        const chunks: PaAgentModelStreamChunk[] = [];
        for await (const chunk of model.stream({
            runId: 'native',
            turnId: 'turn',
            turnIndex: 0,
            userInput: 'discover',
            transcript: [],
            signal: turnController.signal,
        })) {
            chunks.push(chunk);
        }

        expect(bindTools).toHaveBeenCalledWith([
            expect.objectContaining({
                function: expect.objectContaining({ name: 'get_current_note_context' }),
            }),
        ]);
        expect(chunks).toContainEqual({ type: 'text_delta', text: 'native answer' });
        expect(streamSignals).toEqual([turnController.signal]);
    });

    it('projects cumulative observations through the Pagelet context budget without mutating provenance', async () => {
        const registry = new CapabilityRegistry();
        registry.registerMany(createCoreToolCapabilities([
            createAnchorBoundCurrentNoteTool(anchor),
        ]));
        const projectedTranscripts: PaAgentMessage[][] = [];
        const runnable = {
            stream: async function* () {
                yield { content: 'native answer' };
            },
            invoke: async () => ({ content: 'fallback answer' }),
        };
        const prompt: PageletNativePrompt = {
            pipe: () => runnable,
        };
        const anchorObservation = `anchor-marker-${'a'.repeat(340)}-anchor-tail`;
        const oldSearchObservation = `old-search-marker-${'s'.repeat(330)}-old-search-tail`;
        const relatedObservation = `related-marker-${'r'.repeat(150)}-related-tail`;
        const laterAnchorObservation = `later-anchor-marker-${'z'.repeat(360)}-later-anchor-tail`;
        const transcript: PaAgentMessage[] = [
            {
                role: 'user',
                id: 'user',
                content: 'discover',
                timestamp: 1,
            },
            {
                role: 'assistant',
                id: 'assistant-anchor',
                content: [{
                    type: 'toolCall',
                    id: 'anchor-call',
                    name: 'get_current_note_context',
                    input: { mode: 'full' },
                    index: 0,
                }],
                timestamp: 2,
            },
            {
                role: 'toolResult',
                id: 'anchor-result',
                toolCallId: 'anchor-call',
                toolName: 'get_current_note_context',
                isError: false,
                timestamp: 3,
                content: {
                    promptText: anchorObservation,
                    includeInNextPrompt: true,
                    sourceRecords: [{
                        kind: 'context-used',
                        dedupKey: anchor.path,
                        path: anchor.path,
                    }],
                },
            },
            {
                role: 'assistant',
                id: 'assistant-search',
                content: [{
                    type: 'toolCall',
                    id: 'search-call',
                    name: 'search_memory',
                    input: { query: 'release' },
                    index: 0,
                }],
                timestamp: 4,
            },
            {
                role: 'toolResult',
                id: 'search-result',
                toolCallId: 'search-call',
                toolName: 'search_memory',
                isError: false,
                timestamp: 5,
                content: {
                    promptText: oldSearchObservation,
                    includeInNextPrompt: true,
                },
            },
            {
                role: 'assistant',
                id: 'assistant-related',
                content: [{
                    type: 'toolCall',
                    id: 'related-call',
                    name: 'inspect_obsidian_note',
                    input: { path: relatedMaterial.path },
                    index: 0,
                }],
                timestamp: 6,
            },
            {
                role: 'toolResult',
                id: 'related-result',
                toolCallId: 'related-call',
                toolName: 'inspect_obsidian_note',
                isError: false,
                timestamp: 7,
                content: {
                    promptText: relatedObservation,
                    includeInNextPrompt: true,
                    sourceRecords: [{
                        kind: 'context-used',
                        dedupKey: relatedMaterial.path,
                        path: relatedMaterial.path,
                    }],
                },
            },
            {
                role: 'assistant',
                id: 'assistant-anchor-inspect',
                content: [{
                    type: 'toolCall',
                    id: 'anchor-inspect-call',
                    name: 'inspect_obsidian_note',
                    input: { path: anchor.path },
                    index: 0,
                }],
                timestamp: 8,
            },
            {
                role: 'toolResult',
                id: 'anchor-inspect-result',
                toolCallId: 'anchor-inspect-call',
                toolName: 'inspect_obsidian_note',
                isError: false,
                timestamp: 9,
                content: {
                    promptText: laterAnchorObservation,
                    includeInNextPrompt: true,
                    sourceRecords: [{
                        kind: 'context-used',
                        dedupKey: `later:${anchor.path}`,
                        path: anchor.path,
                    }],
                },
            },
        ];
        const model = createPageletNativeModel({
            registry,
            allowedToolNames: new Set(['get_current_note_context']),
            createChatModel: async () => runnable,
            createPrompt: () => prompt,
            maxObservationChars: 850,
            buildPromptInput: (input, context) => {
                projectedTranscripts.push([...input.transcript]);
                return { tool_observations: context.toolObservations };
            },
        });

        for await (const chunk of model.stream({
            runId: 'native-observation-budget',
            turnId: 'turn',
            turnIndex: 2,
            userInput: 'discover',
            transcript,
        })) {
            void chunk;
        }

        const projectedResults = projectedTranscripts[0]?.filter(
            (message): message is Extract<PaAgentMessage, { role: 'toolResult' }> => (
                message.role === 'toolResult'
            ),
        ) ?? [];
        const projectedChars = projectedResults.reduce(
            (total, message) => total + (
                message.content.includeInNextPrompt ? message.content.promptText.length : 0
            ),
            0,
        );
        expect(projectedChars).toBeLessThanOrEqual(595);
        expect(projectedResults.find((message) => (
            message.toolName === 'get_current_note_context'
        ))?.content.promptText).toContain('anchor-marker');
        expect(projectedResults.find((message) => (
            message.toolName === 'inspect_obsidian_note'
            && message.id === 'related-result'
        ))?.content.promptText).toContain('related-tail');
        expect(projectedResults.find((message) => (
            message.id === 'anchor-inspect-result'
        ))?.content.promptText).not.toContain('later-anchor-tail');
        expect(projectedResults.find((message) => (
            message.toolName === 'search_memory'
        ))?.content.promptText).not.toContain('old-search-tail');
        expect((transcript[2] as Extract<PaAgentMessage, { role: 'toolResult' }>)
            .content.promptText).toBe(anchorObservation);
        expect((transcript[6] as Extract<PaAgentMessage, { role: 'toolResult' }>)
            .content.promptText).toBe(relatedObservation);
        expect((transcript[8] as Extract<PaAgentMessage, { role: 'toolResult' }>)
            .content.promptText).toBe(laterAnchorObservation);
    });

    it('binds WebSearch natively only after the control snapshot unlocks it', async () => {
        const registry = new CapabilityRegistry();
        const web = createFakeWebCapability();
        registry.registerMany([
            ...createCoreToolCapabilities([
                createAnchorBoundCurrentNoteTool(anchor),
            ]),
            web.capability,
        ]);
        const bindTools = jest.fn((_schemas: unknown[]) => runnable);
        const runnable = {
            bindTools,
            stream: async function* () {
                yield { content: 'native answer' };
            },
            invoke: async () => ({ content: 'fallback answer' }),
        };
        const prompt: PageletNativePrompt = {
            pipe: (model) => model as typeof runnable,
        };
        const allowedToolNames = new Set([
            'get_current_note_context',
            BUILTIN_WEB_SEARCH_TOOL_NAME,
        ]);
        const model = createPageletNativeModel({
            registry,
            allowedToolNames,
            createChatModel: async () => runnable,
            createPrompt: () => prompt,
        });
        const baseInput = {
            runId: 'native-web-gate',
            turnId: 'turn',
            userInput: 'discover',
            transcript: [],
        };

        for await (const chunk of model.stream({
            ...baseInput,
            turnIndex: 0,
            controlSnapshot: createAgentControlSnapshot({
                exposureMode: 'source-scoped',
                sourceScope: 'notes',
                allowedToolNames,
                blockedToolNames: new Set([BUILTIN_WEB_SEARCH_TOOL_NAME]),
            }),
        })) {
            void chunk;
        }
        for await (const chunk of model.stream({
            ...baseInput,
            turnIndex: 1,
            controlSnapshot: createAgentControlSnapshot({
                exposureMode: 'source-scoped',
                sourceScope: 'mixed',
                allowedToolNames,
            }),
        })) {
            void chunk;
        }

        const boundNames = bindTools.mock.calls.map(([schemas]) => (
            (schemas as Array<{ function: { name: string } }>)
                .map((schema) => schema.function.name)
                .sort()
        ));
        expect(boundNames[0]).toEqual(['get_current_note_context']);
        expect(boundNames[1]).toEqual([
            'get_current_note_context',
            BUILTIN_WEB_SEARCH_TOOL_NAME,
        ]);
    });
});

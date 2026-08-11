import { describe, expect, it, jest } from '@jest/globals';
import { RunnableLambda } from '@langchain/core/runnables';

import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import { BUILTIN_WEB_SEARCH_TOOL_NAME } from '../src/ai-services/builtin-web-search-provider';
import { createCoreToolCapabilities } from '../src/ai-services/capability-adapter';
import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import type {
    AgentCapability,
    AgentCapabilityContext,
} from '../src/ai-services/capability-types';
import type { ChatToolRegistryDefinition } from '../src/ai-services/chat-tools';
import type { MemorySearchResult, PaAgentMessage } from '../src/ai-services/chat-types';
import { createAgentControlSnapshot } from '../src/ai-services/pa-agent-control-policy';
import {
    RetrievalDiagnosticsController,
    type RetrievalDiagnosticSurface,
} from '../src/ai-services/retrieval-diagnostics';
import type {
    PaAgentModel,
    PaAgentModelInput,
    PaAgentModelStreamChunk,
} from '../src/ai-services/pa-agent-loop';
import { hashPageletContent } from '../src/pagelet/agent/anchor-snapshot';
import { createAnchorBoundCurrentNoteTool } from '../src/pagelet/agent/anchor-note-tool';
import { PageletDeepDiscoverController } from '../src/pagelet/agent/pagelet-deep-discover-controller';
import { extractPageletExactIdentifiers } from '../src/pagelet/agent/lead-driven-policy';
import {
    PAGELET_AGENT_READ_ONLY_TOOL_ALLOWLIST,
    createPageletAgentRuntime,
} from '../src/pagelet/agent/pagelet-agent-runtime';
import {
    createDefaultPageletPrompt,
    createPageletNativeModel,
    type PageletNativePrompt,
} from '../src/pagelet/agent/pagelet-native-model';
import type {
    PageletAgentModelContext,
    PageletAgentPolicyIdentity,
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
const leadContent = '# Rollback lead\nmissing rollback checkpoint creates action risk';
const leadMaterial: PageletAgentSourceMaterial = {
    path: 'notes/rollback-lead.md',
    content: leadContent,
    mtime: 12,
    size: leadContent.length,
    contentHash: 'c'.repeat(64),
    capturedAt: 102,
};
const exactLeadAnchorContent = [
    '# Pagelet 单洞察入口',
    '',
    '唯一待查问题是：`PGL-KITE-507` 纸鹤队列为什么只在雨天演练中跳过校验？',
    '',
    '当前笔记只记录症状，不包含原因、处理方法或其他来源链接。',
].join('\n');
const exactLeadAnchor: PageletAnchorSnapshot = {
    ...anchor,
    content: exactLeadAnchorContent,
    size: exactLeadAnchorContent.length,
    contentHash: 'd'.repeat(64),
};
const stagedExactLeadAnchorContent = [
    '# Incident',
    'validate first before release.',
    'PGL-KITE-507 remains unresolved.',
].join('\n');
const stagedExactLeadAnchor: PageletAnchorSnapshot = {
    ...anchor,
    content: stagedExactLeadAnchorContent,
    size: stagedExactLeadAnchorContent.length,
    contentHash: 'e'.repeat(64),
};
const unsupportedExactLeadTerminal = [
    '## Queue validation risk',
    'The unresolved queue behavior could hide a release validation gap.',
].join('\n');
const supportedExactLeadTerminal = [
    '## Rollback checkpoint risk',
    '`notes/rollback-lead.md` records a missing rollback checkpoint, which makes the release path unsafe.',
].join('\n');
const compatibleNonAnchorTerminal = [
    '## Release validation conflict',
    '`notes/related.md` says release directly creates risk, so the current validation plan needs review.',
].join('\n');
const groundedCitationInsight = [
    '## Release validation conflict',
    '`notes/anchor.md` requires validation before release, while',
    '`notes/related.md` says release directly creates risk; this conflict makes the current plan unsafe.',
].join('\n');
const shortBasenameCitationInsight = [
    '## Release validation conflict',
    '`anchor.md` requires validation before release, while',
    '`related.md` says release directly creates risk; this conflict makes the current plan unsafe.',
].join('\n');
const dualLeadAnchorContent = [
    '# Two concrete leads',
    'PGL-CORAL-318 remains unresolved: why does the archive queue wait on Wednesday?',
    'PGL-SILVER-624 remains unresolved: why is the first morning humidity sample wrong?',
    'Read [[notes/coral.md]] and [[notes/silver.md]] for the separate source records.',
].join('\n');
const dualLeadAnchor: PageletAnchorSnapshot = {
    ...anchor,
    content: dualLeadAnchorContent,
    size: dualLeadAnchorContent.length,
    contentHash: 'f'.repeat(64),
};
const coralContent = [
    '# Coral archive',
    'PGL-CORAL-318 waits because compression and archive share one serial queue.',
].join('\n');
const coralMaterial: PageletAgentSourceMaterial = {
    path: 'notes/coral.md',
    content: coralContent,
    mtime: 21,
    size: coralContent.length,
    contentHash: '1'.repeat(64),
    capturedAt: 201,
};
const silverContent = [
    '# Silver greenhouse',
    'PGL-SILVER-624 is wrong because sampling starts before sensor warmup completes.',
].join('\n');
const silverMaterial: PageletAgentSourceMaterial = {
    path: 'notes/silver.md',
    content: silverContent,
    mtime: 22,
    size: silverContent.length,
    contentHash: '2'.repeat(64),
    capturedAt: 202,
};
const coralInsight = [
    '## Archive queue conflict',
    '`notes/anchor.md` records the unresolved PGL-CORAL-318 delay, while',
    '`notes/coral.md` shows compression and archive share one serial queue; this conflict causes the Wednesday wait.',
].join('\n');
const silverInsight = [
    '## Sensor warmup gap',
    '`notes/anchor.md` records the unresolved PGL-SILVER-624 symptom, while',
    '`notes/silver.md` shows sampling starts before warmup completes; this gap causes the false morning reading.',
].join('\n');
const shallowSilverInsight = [
    '## Related records',
    '`notes/anchor.md` mentions PGL-SILVER-624, and',
    '`notes/silver.md` also mentions PGL-SILVER-624; the records are related.',
].join('\n');
const pageletPolicyIdentity: PageletAgentPolicyIdentity = {
    dataBoundaryIdentity: 'boundary-two-leads',
    providerPolicyIdentity: 'provider-policy-two-leads',
    modelIdentity: 'provider:test-model',
    locale: 'en',
};

function leadMemoryResult(query: string): MemorySearchResult {
    return {
        usedMemory: true,
        query,
        documents: [{
            content: leadMaterial.content,
            score: 0.9,
            source: { path: leadMaterial.path, chunkIndex: 0, score: 0.9 },
        }],
        sources: [{ path: leadMaterial.path, chunkIndex: 0, score: 0.9 }],
        candidates: [],
        hasAnswerableContent: true,
        memoryEvidenceState: 'evidence',
        rerankVerdict: 'relevant',
        needsMoreEvidence: false,
    };
}

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

function createHost(extraContents: Record<string, string> = {}): AiServiceHost {
    const contents: Record<string, string> = {
        'notes/anchor.md': anchor.content,
        'notes/related.md': relatedContent,
        ...extraContents,
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

function citationCorrectionModel(options: {
    repeatInvalid?: boolean;
    onInput?: (input: PaAgentModelInput) => void;
} = {}): PaAgentModel {
    return {
        stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
            options.onInput?.(input);
            if (input.turnIndex === 0) {
                yield {
                    type: 'toolcall_delta',
                    id: 'citation-anchor-call',
                    name: 'get_current_note_context',
                    input: { mode: 'full' },
                    index: 0,
                };
                yield {
                    type: 'toolcall_delta',
                    id: 'citation-related-call',
                    name: 'inspect_obsidian_note',
                    input: { path: relatedMaterial.path },
                    index: 1,
                };
                return;
            }
            yield {
                type: 'text_delta',
                text: input.turnIndex === 1 || options.repeatInvalid
                    ? shortBasenameCitationInsight
                    : groundedCitationInsight,
            };
        },
    };
}

function stagedInsightModel(terminalText: string): PaAgentModel {
    return {
        stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
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
            if (input.turnIndex === 1) {
                yield {
                    type: 'toolcall_delta',
                    id: 'stage-call',
                    name: 'stage_pagelet_insight',
                    input: {
                        insightMarkdown: [
                            '## Release validation conflict',
                            '`notes/anchor.md` requires validate first before release, while',
                            '`notes/related.md` says release directly creates risk; this conflict increases risk.',
                        ].join('\n'),
                        sourceIds: ['notes/anchor.md', 'notes/related.md'],
                        unresolvedLead: {
                            leadKey: 'rollback checkpoint evidence',
                            supportingSourceIds: ['notes/related.md'],
                            requestRelaxedRecovery: false,
                        },
                    },
                    index: 0,
                };
                return;
            }
            yield { type: 'text_delta', text: terminalText };
        },
    };
}

function disjointLeadModel(options: {
    terminalText: string;
    leadTool?: 'inspect_obsidian_note' | 'search_memory';
}): PaAgentModel {
    return {
        stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
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
                    input: { path: relatedMaterial.path },
                    index: 1,
                };
                yield {
                    type: 'toolcall_delta',
                    id: 'lead-call',
                    name: options.leadTool ?? 'inspect_obsidian_note',
                    input: options.leadTool === 'search_memory'
                        ? { query: 'missing rollback checkpoint' }
                        : { path: leadMaterial.path },
                    index: 2,
                };
                return;
            }
            if (input.turnIndex === 1) {
                yield {
                    type: 'toolcall_delta',
                    id: 'stage-call',
                    name: 'stage_pagelet_insight',
                    input: {
                        insightMarkdown: [
                            '## Release validation conflict',
                            '`notes/anchor.md` requires validate first before release, while',
                            '`notes/related.md` says release directly creates risk; this conflict increases risk.',
                        ].join('\n'),
                        sourceIds: [anchor.path, relatedMaterial.path],
                        unresolvedLead: {
                            leadKey: 'missing rollback checkpoint action risk',
                            supportingSourceIds: [leadMaterial.path],
                            requestRelaxedRecovery: false,
                        },
                    },
                    index: 0,
                };
                return;
            }
            yield { type: 'text_delta', text: options.terminalText };
        },
    };
}

function sourceCompleteTwoLeadModel(options: {
    terminalSecond: string;
    readSecond?: boolean;
    onInput?: (input: PaAgentModelInput) => void;
}): PaAgentModel {
    return {
        stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
            options.onInput?.(input);
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
                    id: 'coral-call',
                    name: 'inspect_obsidian_note',
                    input: { path: coralMaterial.path },
                    index: 1,
                };
                if (options.readSecond !== false) {
                    yield {
                        type: 'toolcall_delta',
                        id: 'silver-call',
                        name: 'inspect_obsidian_note',
                        input: { path: silverMaterial.path },
                        index: 2,
                    };
                }
                return;
            }
            if (input.turnIndex === 1) {
                yield { type: 'text_delta', text: coralInsight };
                return;
            }
            if (input.turnIndex === 2) {
                yield {
                    type: 'toolcall_delta',
                    id: 'stage-call',
                    name: 'stage_pagelet_insight',
                    input: {
                        insightMarkdown: coralInsight,
                        sourceIds: [dualLeadAnchor.path, coralMaterial.path],
                        unresolvedLead: {
                            leadKey: 'independent sensor warmup finding',
                            supportingSourceIds: [silverMaterial.path],
                            requestRelaxedRecovery: false,
                        },
                    },
                    index: 0,
                };
                return;
            }
            yield { type: 'text_delta', text: options.terminalSecond };
        },
    };
}

function interruptedSourceCompleteTwoLeadModel(
    mode: 'empty-followup' | 'validation-rejected-stage',
): PaAgentModel {
    return {
        stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
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
                    id: 'coral-call',
                    name: 'inspect_obsidian_note',
                    input: { path: coralMaterial.path },
                    index: 1,
                };
                yield {
                    type: 'toolcall_delta',
                    id: 'silver-call',
                    name: 'inspect_obsidian_note',
                    input: { path: silverMaterial.path },
                    index: 2,
                };
                return;
            }
            if (input.turnIndex === 1) {
                yield { type: 'text_delta', text: coralInsight };
                return;
            }
            if (input.turnIndex !== 2 || mode === 'empty-followup') return;
            yield {
                type: 'toolcall_delta',
                id: 'stage-call',
                name: 'stage_pagelet_insight',
                    input: {
                        insightMarkdown: coralInsight,
                        sourceIds: [dualLeadAnchor.path, coralMaterial.path],
                    unresolvedLead: {
                        leadKey: 'independent sensor warmup finding',
                        supportingSourceIds: [silverMaterial.path],
                        requestRelaxedRecovery: false,
                    },
                },
                index: 0,
            };
        },
    };
}

function stageShapeRetryModel(options: {
    repeatInvalid: boolean;
    invalidKind?: 'source-binding' | 'unread-lead';
    onInput?: (input: PaAgentModelInput) => void;
}): PaAgentModel {
    return {
        stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
            options.onInput?.(input);
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
                    id: 'coral-call',
                    name: 'inspect_obsidian_note',
                    input: { path: coralMaterial.path },
                    index: 1,
                };
                yield {
                    type: 'toolcall_delta',
                    id: 'silver-call',
                    name: 'inspect_obsidian_note',
                    input: { path: silverMaterial.path },
                    index: 2,
                };
                return;
            }
            if (input.turnIndex === 1) {
                yield { type: 'text_delta', text: coralInsight };
                return;
            }
            if (input.turnIndex === 2 || (input.turnIndex === 3 && options.repeatInvalid)) {
                yield {
                    type: 'toolcall_delta',
                    id: `invalid-stage-${input.turnIndex}`,
                    name: 'stage_pagelet_insight',
                    input: {
                        insightMarkdown: coralInsight,
                        sourceIds: options.invalidKind === 'unread-lead'
                            ? [dualLeadAnchor.path, coralMaterial.path]
                            : [dualLeadAnchor.path, silverMaterial.path],
                        unresolvedLead: {
                            leadKey: 'independent sensor warmup finding',
                            supportingSourceIds: options.invalidKind === 'unread-lead'
                                ? ['notes/unread-lead.md']
                                : [silverMaterial.path],
                            requestRelaxedRecovery: false,
                        },
                    },
                    index: 0,
                };
                return;
            }
            if (input.turnIndex === 3) {
                yield {
                    type: 'toolcall_delta',
                    id: 'corrected-stage',
                    name: 'stage_pagelet_insight',
                    input: {
                        insightMarkdown: coralInsight,
                        sourceIds: [dualLeadAnchor.path, coralMaterial.path],
                        unresolvedLead: {
                            leadKey: 'independent sensor warmup finding',
                            supportingSourceIds: [silverMaterial.path],
                            requestRelaxedRecovery: false,
                        },
                    },
                    index: 0,
                };
                return;
            }
            yield { type: 'text_delta', text: silverInsight };
        },
    };
}

function createTwoLeadRuntime(options: {
    terminalSecond: string;
    readSecond?: boolean;
    onInput?: (input: PaAgentModelInput) => void;
}) {
    const host = createHost({
        [dualLeadAnchor.path]: dualLeadAnchor.content,
        [coralMaterial.path]: coralMaterial.content,
        [silverMaterial.path]: silverMaterial.content,
    });
    host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
    const materials = new Map<string, PageletAgentSourceMaterial>([
        [dualLeadAnchor.path, { ...dualLeadAnchor }],
        [coralMaterial.path, coralMaterial],
        [silverMaterial.path, silverMaterial],
    ]);
    return {
        materials,
        runtime: createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => materials.get(path) ?? null,
            createModel: () => sourceCompleteTwoLeadModel(options),
        }),
    };
}

function createStageShapeRetryRuntime(options: {
    repeatInvalid: boolean;
    invalidKind?: 'source-binding' | 'unread-lead';
    onInput?: (input: PaAgentModelInput) => void;
}) {
    const host = createHost({
        [dualLeadAnchor.path]: dualLeadAnchor.content,
        [coralMaterial.path]: coralMaterial.content,
        [silverMaterial.path]: silverMaterial.content,
    });
    host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
    const materials = new Map<string, PageletAgentSourceMaterial>([
        [dualLeadAnchor.path, { ...dualLeadAnchor }],
        [coralMaterial.path, coralMaterial],
        [silverMaterial.path, silverMaterial],
    ]);
    return createPageletAgentRuntime({
        host,
        isPathAllowed: (path) => path.startsWith('notes/'),
        executeMemorySearch: async (input) => ({
            usedMemory: false,
            query: input.query,
            documents: [],
            sources: [],
        }),
        revalidateMemorySearch: async (result) => result,
        captureSourceMaterial: async (path) => materials.get(path) ?? null,
        createModel: () => stageShapeRetryModel(options),
    });
}

function providerPromptText(input: unknown): string {
    const promptValue = input as {
        toChatMessages?: () => Array<{ content?: unknown }>;
    };
    if (typeof promptValue?.toChatMessages === 'function') {
        return promptValue.toChatMessages().map((message) => (
            typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content)
        )).join('\n');
    }
    return JSON.stringify(input);
}

describe('Pagelet exact-lead identifier extraction', () => {
    it('extracts the unresolved identifier from the Pagelet 51 live anchor wording', () => {
        expect(extractPageletExactIdentifiers(exactLeadAnchorContent)).toEqual([
            'PGL-KITE-507',
        ]);
    });

    it('keeps a bounded distinct set of code-like literals and ignores ordinary phrases', () => {
        expect(extractPageletExactIdentifiers([
            'release-phase-1 and follow-up are ordinary prose.',
            'Unresolved: PGL-KITE-507, incident-42, PGL-KITE-507.',
            'Pending: TASK-9, ERR_TIMEOUT-2, BUG-3, CASE-4, ISSUE-5.',
        ].join('\n'))).toEqual([
            'PGL-KITE-507',
            'incident-42',
            'TASK-9',
            'ERR_TIMEOUT-2',
        ]);
    });

    it('does not arm the gate for completed technical notes or resolved identifiers', () => {
        expect(extractPageletExactIdentifiers([
            '# Completed compatibility note',
            'Verified UTF-8, SHA-256, HTTP-404, API-v2, and 2026-08-09.',
            'Endpoint: https://example.com/release-build-42.',
            'Resolved INC-42 and closed PGL-KITE-507.',
        ].join('\n'))).toEqual([]);
    });

    it('ignores common technical literals even when the surrounding prose asks why', () => {
        expect(extractPageletExactIdentifiers([
            '待查为什么 UTF-8、SHA-256、HTTP-404 与 API-v2 的输出不同？',
            '需核查 2026-08-09 和 https://example.com/release-build-42。',
        ].join('\n'))).toEqual([]);
    });

    it('pairs resolved and unresolved cues with the identifier in the same clause', () => {
        expect(extractPageletExactIdentifiers(
            'INC-41 was fixed. PGL-KITE-507 remains unresolved.',
        )).toEqual(['PGL-KITE-507']);
        expect(extractPageletExactIdentifiers(
            'PGL-OLD-1 已修复；PGL-KITE-507 仍待查。',
        )).toEqual(['PGL-KITE-507']);
    });

    it('does not borrow an unresolved cue from the preceding sentence', () => {
        expect(extractPageletExactIdentifiers(
            'Why is the build slow? TASK-9 only records routine cleanup.',
        )).toEqual([]);
    });
});

describe('Pagelet agent runtime', () => {
    it('binds the complete Pagelet run to pagelet diagnostics', async () => {
        const controller = new RetrievalDiagnosticsController(
            () => 0,
            () => 0,
            () => 'pagelet-surface-session',
        );
        const session = controller.start();
        const requestedSurfaces: RetrievalDiagnosticSurface[] = [];
        const host = createHost();
        host.createRetrievalDiagnosticRecorder = (surface) => {
            requestedSurfaces.push(surface);
            return controller.createRecorder(surface);
        };
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* () {
                    yield {
                        type: 'text_delta' as const,
                        text: 'No useful finding survived verification.\nNO_INSIGHT',
                    };
                },
            }),
        });

        await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-surface-run',
        });

        const snapshot = controller.snapshot(session.sessionId);
        expect(requestedSurfaces).toEqual(['pagelet']);
        expect(snapshot.events.length).toBeGreaterThan(0);
        expect(snapshot.events.every((event) => event.surface === 'pagelet')).toBe(true);
        expect(snapshot.events.every((event) => event.runId === 'pagelet-surface-run')).toBe(true);
    });

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
            'stage_pagelet_insight',
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

    it('corrects short inline-code basenames once and delivers the full-path finding', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const materials = new Map<string, PageletAgentSourceMaterial>([
            [anchor.path, { ...anchor }],
            [relatedMaterial.path, relatedMaterial],
        ]);
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async (path) => materials.get(path) ?? null,
            createModel: () => citationCorrectionModel({
                onInput: (input) => modelInputs.push(input),
            }),
        });
        let observedRun: Awaited<ReturnType<typeof runtime.run>> | undefined;
        const controller = new PageletDeepDiscoverController({
            runtime: {
                run: async (request) => {
                    observedRun = await runtime.run(request);
                    return observedRun;
                },
            },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials.get(path) ?? null,
            getPolicyIdentity: () => pageletPolicyIdentity,
            isPathAllowed: (path) => path.startsWith('notes/'),
            now: () => 2_000,
        });

        const result = await controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(result.status).toBe('verified');
        if (result.status !== 'verified') throw new Error('expected corrected citation to verify');
        expect(result.insights).toHaveLength(1);
        expect(result.insight.body).toBe(groundedCitationInsight);
        expect(modelInputs).toHaveLength(3);
        expect(modelInputs[2]).toMatchObject({ toolMode: 'final_answer_only' });
        expect(modelInputs[2]?.runtimeInstruction).toContain('one citation-only corrective turn');
        expect(modelInputs[2]?.runtimeInstruction).toContain(JSON.stringify([
            anchor.path,
            relatedMaterial.path,
        ]));
        expect(observedRun?.loopResult.status).toBe('completed');
        expect(observedRun?.finalText).toBe(groundedCitationInsight);
    });

    it('fails closed after one repeated invalid citation without opening another turn', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const materials = new Map<string, PageletAgentSourceMaterial>([
            [anchor.path, { ...anchor }],
            [relatedMaterial.path, relatedMaterial],
        ]);
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async (path) => materials.get(path) ?? null,
            createModel: () => citationCorrectionModel({
                repeatInvalid: true,
                onInput: (input) => modelInputs.push(input),
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-citation-repeat-invalid',
        });

        expect(modelInputs).toHaveLength(3);
        expect(modelInputs[2]?.toolMode).toBe('final_answer_only');
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.loopResult.endPayload).toMatchObject({
            reason: 'pagelet_citation_protocol_exhausted',
        });
        expect(result.finalText).toBe('');
        expect(result.insightDrafts).toEqual([]);
    });

    it('deduplicates Pagelet Memory alias and whitespace equivalents in one batch', async () => {
        const host = createHost();
        const executeMemorySearch = jest.fn(async (input: { query: string }) => ({
            usedMemory: false,
            query: input.query,
            documents: [],
            sources: [],
            candidates: [],
            memoryEvidenceState: 'none' as const,
            rerankVerdict: 'none_relevant' as const,
            needsMoreEvidence: false,
        }));
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch,
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'memory-q',
                            name: 'search_memory',
                            input: { q: '  project launch  ' },
                            index: 0,
                        };
                        yield {
                            type: 'toolcall_delta',
                            id: 'memory-query',
                            name: 'search_memory',
                            input: { query: 'project launch' },
                            index: 1,
                        };
                        return;
                    }
                    yield { type: 'text_delta', text: 'No matching Memory evidence.' };
                },
            }),
            now: (() => {
                let value = 1_000;
                return () => value += 5;
            })(),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-canonical-dedupe',
        });

        expect(executeMemorySearch).toHaveBeenCalledTimes(1);
        expect(executeMemorySearch.mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({ query: 'project launch' }),
        );
        expect(result.loopResult.turns[0]?.toolResults.map((message) => message.content.metadata?.outcome))
            .toEqual(['success', 'duplicate_skipped']);
    });

    it('retries one schema-invalid Pagelet stage with the exact stage-only shape', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createStageShapeRetryRuntime({
            repeatInvalid: false,
            onInput: (input) => modelInputs.push(input),
        });

        const result = await runtime.run({
            anchor: dualLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-stage-shape-corrected',
        });

        expect(result.loopResult.status).toBe('completed');
        expect(result.metrics).toMatchObject({ modelTurns: 5, toolCalls: 5 });
        expect(result.loopResult.turns[2]?.toolResults[0]).toMatchObject({
            toolName: 'stage_pagelet_insight',
            isError: true,
            content: {
                metadata: {
                    outcome: 'schema_invalid',
                    reason: 'input_validation_failed',
                },
            },
        });
        expect(modelInputs[3]?.runtimeInstruction).toContain(
            'one stage-shape corrective turn',
        );
        expect(modelInputs[3]?.runtimeInstruction).toContain(
            `include the frozen anchor "${dualLeadAnchor.path}"`,
        );
        expect(modelInputs[3]?.runtimeInstruction).not.toContain(
            'Make one corrected read-only attempt',
        );
        expect([...modelInputs[3]!.controlSnapshot!.allowedToolNames!]).toEqual([
            'stage_pagelet_insight',
        ]);
        expect(result.insightDrafts).toEqual([
            expect.objectContaining({
                body: coralInsight,
                origin: 'staged',
                declaredSourceIds: [dualLeadAnchor.path, coralMaterial.path],
            }),
            {
                body: silverInsight,
                origin: 'terminal',
                declaredSourceIds: [],
            },
        ]);
        expect(result.recovery).toMatchObject({
            stageControlCalled: true,
            relaxedTokenConsumed: false,
        });
    });

    it('routes an unread supporting source through the same stage-only correction', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createStageShapeRetryRuntime({
            repeatInvalid: false,
            invalidKind: 'unread-lead',
            onInput: (input) => modelInputs.push(input),
        });

        const result = await runtime.run({
            anchor: dualLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-stage-unread-lead-corrected',
        });

        expect(result.loopResult.turns[2]?.toolResults[0]).toMatchObject({
            toolName: 'stage_pagelet_insight',
            isError: true,
            content: {
                metadata: {
                    outcome: 'schema_invalid',
                    reason: 'input_validation_failed',
                },
            },
        });
        expect(modelInputs[3]?.runtimeInstruction).toContain(
            'non-anchor paths from successful content reads',
        );
        expect(modelInputs[3]?.runtimeInstruction).not.toContain('notes/unread-lead.md');
        expect(result.insightDrafts).toHaveLength(2);
        expect(result.recovery).toMatchObject({ stageControlCalled: true });
    });

    it('fails closed after the one corrected stage shape also fails', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createStageShapeRetryRuntime({
            repeatInvalid: true,
            onInput: (input) => modelInputs.push(input),
        });

        const result = await runtime.run({
            anchor: dualLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-stage-shape-exhausted',
        });

        expect(modelInputs).toHaveLength(4);
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.loopResult.endPayload).toMatchObject({
            reason: 'pagelet_stage_shape_protocol_incomplete',
            diagnostics: [expect.objectContaining({
                type: 'pagelet_stage_shape_protocol_incomplete',
            })],
        });
        expect(result.finalText).toBe('');
        expect(result.insightDrafts).toEqual([]);
        expect(result.recovery).toMatchObject({
            stageControlCalled: false,
            relaxedTokenConsumed: false,
        });
    });

    it.each([
        ['NO_INSIGHT', 1],
        [[
            '## Rollback checkpoint gap',
            '`notes/anchor.md` requires validate first before release, but',
            '`notes/related.md` shows release directly creates risk; therefore a rollback action is missing.',
        ].join('\n'), 2],
    ])('keeps one canonical model run for terminal %s and collects %i results', async (
        terminalText,
        expectedCount,
    ) => {
        const host = createHost();
        host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
        const createModel = jest.fn((context: PageletAgentModelContext) => {
            expect(context.allowedToolNames.has('stage_pagelet_insight')).toBe(true);
            return stagedInsightModel(terminalText as string);
        });
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => {
                if (path === anchor.path) return { ...anchor };
                return path === relatedMaterial.path ? { ...relatedMaterial } : null;
            },
            createModel,
        });

        const result = await runtime.run({ anchor, triggerReason: 'explicit' });

        expect(createModel).toHaveBeenCalledTimes(1);
        expect(result.finalText).toBe(terminalText);
        expect(result.insightDrafts).toHaveLength(expectedCount as number);
        expect(result.insightDrafts?.[0]).toMatchObject({ origin: 'staged' });
        expect(result.recovery).toMatchObject({
            enabled: true,
            stageControlCalled: true,
            relaxedTokenConsumed: false,
        });
    });

    it('stages first-source A and independently verified lead-source B into two unchanged drafts', async () => {
        const host = createHost({ [leadMaterial.path]: leadMaterial.content });
        host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
        const terminalText = [
            '## Missing rollback checkpoint',
            '`notes/anchor.md` requires validation before release, while',
            '`notes/rollback-lead.md` shows the missing rollback checkpoint creates action risk.',
        ].join('\n');
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => {
                if (path === anchor.path) return { ...anchor };
                if (path === relatedMaterial.path) return { ...relatedMaterial };
                return path === leadMaterial.path ? { ...leadMaterial } : null;
            },
            createModel: () => disjointLeadModel({ terminalText }),
        });

        const result = await runtime.run({ anchor, triggerReason: 'explicit' });

        expect(result.insightDrafts).toEqual([
            expect.objectContaining({
                origin: 'staged',
                declaredSourceIds: [anchor.path, relatedMaterial.path],
            }),
            {
                body: terminalText,
                origin: 'terminal',
                declaredSourceIds: [],
            },
        ]);
        expect(result.insightDrafts?.[0]?.body).not.toContain(leadMaterial.path);
        expect(result.recovery).toMatchObject({
            stageControlCalled: true,
            relaxedTokenConsumed: false,
        });
    });

    it('defers a premature one-result terminal when two exact anchor leads already have distinct current content reads', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const { runtime } = createTwoLeadRuntime({
            terminalSecond: silverInsight,
            onInput: (input) => modelInputs.push(input),
        });

        const result = await runtime.run({
            anchor: dualLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-source-complete-two-leads',
        });

        expect(result.metrics).toMatchObject({ modelTurns: 4, toolCalls: 4 });
        expect(result.insightDrafts).toEqual([
            expect.objectContaining({
                body: coralInsight,
                origin: 'staged',
                declaredSourceIds: [dualLeadAnchor.path, coralMaterial.path],
            }),
            {
                body: silverInsight,
                origin: 'terminal',
                declaredSourceIds: [],
            },
        ]);
        expect(modelInputs[1]?.runtimeInstruction).toContain(
            'content sources for at least two concrete anchor leads are already observed',
        );
        expect(modelInputs[1]?.runtimeInstruction).toContain(
            'if both independently clear',
        );
        expect(modelInputs[2]?.runtimeInstruction).toContain(
            'Do not stop after the first finding',
        );
        expect(modelInputs[2]?.runtimeInstruction).toContain(
            'do not call another discovery or search tool',
        );
        expect(result.recovery).toMatchObject({
            stageControlCalled: true,
            relaxedTokenConsumed: false,
        });
    });

    it.each([
        ['an empty follow-up', 'empty-followup', 4, 3, false],
        ['a lead-validation-rejected stage call', 'validation-rejected-stage', 3, 4, true],
    ] as const)('preserves the first finding after %s without reopening discovery', async (
        _case,
        mode,
        expectedTurns,
        expectedToolCalls,
        stageControlCalled,
    ) => {
        const host = createHost({
            [dualLeadAnchor.path]: dualLeadAnchor.content,
            [coralMaterial.path]: coralMaterial.content,
            [silverMaterial.path]: silverMaterial.content,
        });
        host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
        const materials = new Map<string, PageletAgentSourceMaterial>([
            [dualLeadAnchor.path, { ...dualLeadAnchor }],
            [coralMaterial.path, coralMaterial],
            [silverMaterial.path, silverMaterial],
        ]);
        let leadCaptureCount = 0;
        const captureRuntimeSourceMaterial = async (path: string) => {
            const material = materials.get(path) ?? null;
            if (path !== silverMaterial.path || mode !== 'validation-rejected-stage') {
                return material;
            }
            leadCaptureCount += 1;
            return leadCaptureCount === 2
                ? {
                    ...silverMaterial,
                    mtime: silverMaterial.mtime + 1,
                    contentHash: '9'.repeat(64),
                }
                : material;
        };
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: captureRuntimeSourceMaterial,
            createModel: () => interruptedSourceCompleteTwoLeadModel(mode),
        });
        let observedRun: Awaited<ReturnType<typeof runtime.run>> | undefined;
        const controller = new PageletDeepDiscoverController({
            runtime: {
                run: async (request) => {
                    observedRun = await runtime.run(request);
                    return observedRun;
                },
            },
            captureSnapshot: async () => dualLeadAnchor,
            captureSourceMaterial: async (path) => materials.get(path) ?? null,
            getPolicyIdentity: () => pageletPolicyIdentity,
            isPathAllowed: (path) => path.startsWith('notes/'),
            now: () => 2_000,
        });

        const controllerResult = await controller.run({
            path: dualLeadAnchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(controllerResult.status).toBe('verified');
        if (controllerResult.status !== 'verified') {
            throw new Error('expected the preserved first insight to survive');
        }
        expect(controllerResult.insights).toHaveLength(1);
        expect(controllerResult.insight.body).toBe(coralInsight);
        expect(observedRun).toBeDefined();
        const result = observedRun!;
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.metrics).toMatchObject({
            modelTurns: expectedTurns,
            toolCalls: expectedToolCalls,
        });
        expect(result.finalText).toBe(coralInsight);
        expect(result.insightDrafts).toEqual([{
            body: coralInsight,
            origin: 'terminal',
            declaredSourceIds: [],
        }]);
        expect(result.recovery).toMatchObject({
            stageControlCalled,
            relaxedTokenConsumed: false,
        });
        if (mode === 'validation-rejected-stage') {
            expect(result.loopResult.turns[2]?.toolResults[0]).toMatchObject({
                toolName: 'stage_pagelet_insight',
                isError: true,
                content: {
                    metadata: {
                        outcome: 'recoverable_error',
                        unavailableReason: 'pagelet_stage_lead_rejected',
                    },
                },
            });
            expect(result.loopResult.endPayload).toMatchObject({
                reason: 'pagelet_stage_lead_rejected',
            });
        }
    });

    it('does not preserve the earlier terminal candidate when first-insight validation rejects', async () => {
        const host = createHost({
            [dualLeadAnchor.path]: dualLeadAnchor.content,
            [coralMaterial.path]: coralMaterial.content,
            [silverMaterial.path]: silverMaterial.content,
        });
        host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
        const materials = new Map<string, PageletAgentSourceMaterial>([
            [dualLeadAnchor.path, { ...dualLeadAnchor }],
            [coralMaterial.path, coralMaterial],
            [silverMaterial.path, silverMaterial],
        ]);
        let firstCaptureCount = 0;
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => {
                const material = materials.get(path) ?? null;
                if (path !== coralMaterial.path) return material;
                firstCaptureCount += 1;
                return firstCaptureCount === 2
                    ? {
                        ...coralMaterial,
                        mtime: coralMaterial.mtime + 1,
                        contentHash: '8'.repeat(64),
                    }
                    : material;
            },
            createModel: () => interruptedSourceCompleteTwoLeadModel(
                'validation-rejected-stage',
            ),
        });

        const result = await runtime.run({
            anchor: dualLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-stage-first-rejected',
        });

        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
        expect(result.insightDrafts).toEqual([]);
        expect(result.loopResult.turns[2]?.toolResults[0]).toMatchObject({
            toolName: 'stage_pagelet_insight',
            isError: true,
            content: {
                metadata: {
                    outcome: 'recoverable_error',
                    unavailableReason: 'pagelet_stage_first_rejected',
                },
            },
        });
        expect(result.loopResult.endPayload).toMatchObject({
            reason: 'pagelet_stage_first_rejected',
        });
        expect(result.metrics).toMatchObject({ modelTurns: 3, toolCalls: 4 });
    });

    it.each([
        ['unread second source', false, silverInsight, 2],
        ['rewritten second finding', true, coralInsight, 4],
        ['no-value second finding', true, shallowSilverInsight, 4],
    ] as const)('keeps the valid first finding when the %s does not qualify', async (
        _case,
        readSecond,
        terminalSecond,
        expectedTurns,
    ) => {
        const modelInputs: PaAgentModelInput[] = [];
        const { runtime, materials } = createTwoLeadRuntime({
            terminalSecond,
            readSecond,
            onInput: (input) => modelInputs.push(input),
        });
        const controller = new PageletDeepDiscoverController({
            runtime,
            captureSnapshot: async () => dualLeadAnchor,
            captureSourceMaterial: async (path) => materials.get(path) ?? null,
            getPolicyIdentity: () => pageletPolicyIdentity,
            isPathAllowed: (path) => path.startsWith('notes/'),
            now: () => 2_000,
        });

        const result = await controller.run({
            path: dualLeadAnchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(result.status).toBe('verified');
        if (result.status !== 'verified') throw new Error('expected the first insight to survive');
        expect(result.insights).toHaveLength(1);
        expect(result.insight.body).toBe(coralInsight);
        expect(modelInputs).toHaveLength(expectedTurns);
        if (!readSecond) {
            expect(modelInputs[1]?.runtimeInstruction).toContain(
                'Normally finalize one worthwhile',
            );
            expect(modelInputs[1]?.runtimeInstruction).not.toContain(
                'stage the complete first',
            );
        }
    });

    it('keeps the staged first insight when the second repeats an invalid short citation', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const invalidSecond = silverInsight.replace('`notes/silver.md`', '`silver.md`');
        const { runtime, materials } = createTwoLeadRuntime({
            terminalSecond: invalidSecond,
            onInput: (input) => modelInputs.push(input),
        });
        const controller = new PageletDeepDiscoverController({
            runtime,
            captureSnapshot: async () => dualLeadAnchor,
            captureSourceMaterial: async (path) => materials.get(path) ?? null,
            getPolicyIdentity: () => pageletPolicyIdentity,
            isPathAllowed: (path) => path.startsWith('notes/'),
            now: () => 2_000,
        });

        const result = await controller.run({
            path: dualLeadAnchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(result.status).toBe('verified');
        if (result.status !== 'verified') throw new Error('expected staged first insight to survive');
        expect(result.insights).toHaveLength(1);
        expect(result.insight.body).toBe(coralInsight);
        expect(modelInputs).toHaveLength(5);
        expect(modelInputs[4]).toMatchObject({ toolMode: 'final_answer_only' });
        expect(modelInputs[4]?.runtimeInstruction).toContain('one citation-only corrective turn');
    });

    it.each([
        ['stale', 'inspect_obsidian_note'],
        ['search-only', 'search_memory'],
    ] as const)('rejects a %s disjoint lead before staging', async (mode, leadTool) => {
        const host = createHost({ [leadMaterial.path]: leadMaterial.content });
        host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
        let leadReads = 0;
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => leadMemoryResult(input.query),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => {
                if (path === anchor.path) return { ...anchor };
                if (path === relatedMaterial.path) return { ...relatedMaterial };
                if (path !== leadMaterial.path) return null;
                leadReads += 1;
                return mode === 'stale' && leadReads > 1
                    ? { ...leadMaterial, contentHash: 'd'.repeat(64) }
                    : { ...leadMaterial };
            },
            createModel: () => disjointLeadModel({
                terminalText: 'NO_INSIGHT',
                leadTool,
            }),
        });

        const result = await runtime.run({ anchor, triggerReason: 'explicit' });

        expect(result.insightDrafts).toEqual([]);
        expect(result.recovery).toMatchObject({
            stageControlCalled: mode === 'stale',
            relaxedTokenConsumed: false,
        });
        if (mode === 'search-only') {
            expect(result.sourceTools.get(leadMaterial.path)).toEqual(new Set(['search_memory']));
        }
    });

    it('projects the one-terminal-insight stage protocol through runtime and native prompts', async () => {
        const host = createHost();
        host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: () => true,
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async () => null,
            createModel: (context) => {
                const stage = context.toolDefinitions.find((definition) => (
                    String(definition.name) === 'stage_pagelet_insight'
                ));
                expect(stage?.description).toContain('terminal response may contain at most one insight');
                return {
                    stream: async function* (input: PaAgentModelInput) {
                        modelInputs.push(input);
                        yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                    },
                };
            },
        });

        await runtime.run({ anchor, triggerReason: 'explicit' });

        expect(modelInputs[0]?.userInput).toContain('terminal response may contain at most one insight');
        expect(modelInputs[0]?.userInput).toContain('stage the complete first insight');
        expect(modelInputs[0]?.runtimeInstruction).toContain('sourceIds for the first insight only');
        expect(modelInputs[0]?.runtimeInstruction).toContain('requestRelaxedRecovery=false');
        expect(modelInputs[0]?.runtimeInstruction).toContain('return only the second as terminal Markdown');
        expect(modelInputs[0]?.runtimeInstruction).toContain('normally finalize instead of broadening');
        expect(modelInputs[0]?.runtimeInstruction).toContain('concrete independent second lead');
        expect(modelInputs[0]?.runtimeInstruction).toContain('smallest current non-anchor source set');
        expect(modelInputs[0]?.runtimeInstruction).toContain('If both already-read findings independently clear');
        expect(modelInputs[0]?.runtimeInstruction).not.toContain(
            'support a worthwhile finding, finalize instead of broadening',
        );

        const nativePrompt = createDefaultPageletPrompt() as unknown as {
            promptMessages: Array<{ prompt?: { template?: string } }>;
        };
        const systemTemplate = nativePrompt.promptMessages[0]?.prompt?.template ?? '';
        expect(systemTemplate).toContain('Every terminal response may contain at most one');
        expect(systemTemplate).toContain('supportingSourceIds identify separately verified content evidence');
        expect(systemTemplate).toContain('requestRelaxedRecovery=false');
        expect(systemTemplate).toContain('return only the second as terminal Markdown');
        expect(systemTemplate).toContain('normally finalize instead of broadening');
        expect(systemTemplate).toContain('concrete independent second lead');
        expect(systemTemplate).toContain('smallest current non-anchor source set');
        expect(systemTemplate).toContain('If both already-read findings independently clear');
        expect(systemTemplate).not.toContain(
            'support a worthwhile finding, finalize instead of broadening',
        );
        expect(systemTemplate).toContain('During ordinary tool-enabled exploration');
        expect(systemTemplate).toContain('one or more distinct unresolved leads');
        expect(systemTemplate).toContain('smallest relevant linked-note set for each lead');
        expect(systemTemplate).toContain('checking multiple leads never requires producing multiple insights');
        expect(systemTemplate).toContain('unresolved exact identifier');
        expect(systemTemplate).toContain('call search_memory with that exact literal');
        expect(systemTemplate).toContain('same literal is already verified in a successful non-anchor content-reading observation');
        expect(systemTemplate).toContain('verify any promising search result with a content-reading tool');
    });

    it('keeps exact NO_INSIGHT as a zero-result terminal when nothing was staged', async () => {
        const host = createHost();
        host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: () => true,
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* () {
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({ anchor, triggerReason: 'explicit' });
        expect(result.finalText).toBe('NO_INSIGHT');
        expect(result.loopResult.status).toBe('completed');
        expect(result.loopResult.turns).toHaveLength(1);
        expect(result.insightDrafts).toEqual([]);
    });

    it('uses one tool-enabled corrective turn, then fails closed when exact-lead search is ignored twice', async () => {
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
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-ignore-twice',
        });

        expect(modelInputs).toHaveLength(2);
        expect(modelInputs[1]).toMatchObject({ turnIndex: 1, toolMode: undefined });
        expect(modelInputs[1]?.runtimeInstruction).toContain('PGL-KITE-507');
        expect(modelInputs[1]?.runtimeInstruction).toContain('call search_memory with exactly');
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.loopResult.endPayload).toMatchObject({
            reason: 'pagelet_exact_lead_protocol_incomplete',
        });
        expect(result.finalText).toBe('');
        expect(result.insightDrafts).toEqual([]);
    });

    it('keeps the third live turn tool-enabled after a duplicate anchor read and requires the exact search', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const executeMemorySearch = jest.fn(async (input: { query: string }) => ({
            usedMemory: false,
            query: input.query,
            documents: [],
            sources: [],
            candidates: [],
            memoryEvidenceState: 'none' as const,
            rerankVerdict: 'none_relevant' as const,
            needsMoreEvidence: false,
        }));
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch,
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex <= 1) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: `duplicate-anchor-${input.turnIndex}`,
                            name: 'get_current_note_context',
                            input: { mode: 'full' },
                            index: 0,
                        };
                        return;
                    }
                    if (input.turnIndex === 2) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'duplicate-anchor-exact-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-duplicate-anchor-recovery',
        });

        expect(result.loopResult.turns[1]?.toolResults[0]).toMatchObject({
            toolName: 'get_current_note_context',
            isError: false,
            content: {
                includeInNextPrompt: false,
                metadata: {
                    outcome: 'duplicate_skipped',
                    reason: 'duplicate_tool_call',
                },
            },
        });
        expect(modelInputs[2]).toMatchObject({ turnIndex: 2, toolMode: undefined });
        expect(modelInputs[2]?.runtimeInstruction).toContain('one bounded tool-enabled corrective turn');
        expect(modelInputs[2]?.runtimeInstruction).toContain('PGL-KITE-507');
        expect(executeMemorySearch).toHaveBeenCalledTimes(1);
        expect(result.loopResult.status).toBe('completed');
        expect(result.finalText).toBe('NO_INSIGHT');
    });

    it('fails closed when the model repeats duplicate anchor status after the one exact-search correction', async () => {
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
                    yield {
                        type: 'toolcall_delta' as const,
                        id: `repeat-duplicate-anchor-${input.turnIndex}`,
                        name: 'get_current_note_context',
                        input: { mode: 'full' },
                        index: 0,
                    };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-duplicate-anchor-exhausted',
        });

        expect(modelInputs).toHaveLength(3);
        expect(modelInputs[2]?.toolMode).toBeUndefined();
        expect(result.loopResult.turns[2]?.toolResults[0]?.content.metadata).toMatchObject({
            outcome: 'duplicate_skipped',
            reason: 'duplicate_tool_call',
        });
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.loopResult.endPayload).toMatchObject({
            reason: 'pagelet_exact_lead_protocol_incomplete',
        });
        expect(result.finalText).toBe('');
    });

    it('keeps the ordinary Pagelet0 duplicate path on its existing finalization behavior', async () => {
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
                        yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                        return;
                    }
                    yield {
                        type: 'toolcall_delta' as const,
                        id: `pagelet0-duplicate-anchor-${input.turnIndex}`,
                        name: 'get_current_note_context',
                        input: { mode: 'full' },
                        index: 0,
                    };
                },
            }),
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet0-duplicate-anchor-existing-finalization',
        });

        expect(modelInputs).toHaveLength(3);
        expect(modelInputs[2]?.toolMode).toBe('final_answer_only');
        expect(modelInputs.every((input) => (
            !input.runtimeInstruction?.includes('one citation-only corrective turn')
        ))).toBe(true);
        expect(result.loopResult.status).toBe('completed');
        expect(result.finalText).toBe('NO_INSIGHT');
    });

    it('accepts NO_INSIGHT after an exact-literal Memory search returns zero candidates', async () => {
        const executeMemorySearch = jest.fn(async (input: { query: string }) => ({
            usedMemory: false,
            query: input.query,
            documents: [],
            sources: [],
            candidates: [],
            memoryEvidenceState: 'none' as const,
            rerankVerdict: 'none_relevant' as const,
            needsMoreEvidence: false,
        }));
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch,
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    if (input.turnIndex === 0) {
                        yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                        return;
                    }
                    if (input.turnIndex === 1) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'exact-zero-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield {
                        type: 'text_delta' as const,
                        text: 'No useful finding survived verification.\nNO_INSIGHT',
                    };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-zero-result',
        });

        expect(executeMemorySearch).toHaveBeenCalledTimes(1);
        expect(executeMemorySearch.mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({ query: 'PGL-KITE-507' }),
        );
        expect(result.loopResult.status).toBe('completed');
        expect(result.loopResult.committedFinalText).toBe('NO_INSIGHT');
        expect(result.finalText).toBe('NO_INSIGHT');
    });

    it('fails closed when an exact search returns a candidate but the corrective content-read is ignored', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost({ [leadMaterial.path]: leadMaterial.content }),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => leadMemoryResult(input.query),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => (
                path === leadMaterial.path ? { ...leadMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'exact-candidate-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-candidate-unread',
        });

        expect(modelInputs).toHaveLength(3);
        expect(modelInputs[2]?.runtimeInstruction).toContain('tool-enabled corrective turn');
        expect(modelInputs[2]?.runtimeInstruction).toContain('non-anchor content source');
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
        expect(result.insightDrafts).toEqual([]);
    });

    it('corrects an unsupported non-empty terminal once and accepts it after a later same-path content read', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost({ [leadMaterial.path]: leadMaterial.content }),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => leadMemoryResult(input.query),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => (
                path === leadMaterial.path ? { ...leadMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'non-empty-terminal-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    if (input.turnIndex === 2) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'non-empty-terminal-candidate-read',
                            name: 'inspect_obsidian_note',
                            input: { path: leadMaterial.path },
                            index: 0,
                        };
                        return;
                    }
                    yield {
                        type: 'text_delta' as const,
                        text: input.turnIndex === 3
                            ? supportedExactLeadTerminal
                            : unsupportedExactLeadTerminal,
                    };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-non-empty-corrected',
        });

        expect(modelInputs).toHaveLength(4);
        expect(modelInputs[2]).toMatchObject({ turnIndex: 2, toolMode: undefined });
        expect(modelInputs[2]?.runtimeInstruction).toContain('one bounded tool-enabled corrective turn');
        expect(modelInputs[2]?.runtimeInstruction).toContain(leadMaterial.path);
        expect(result.loopResult.status).toBe('completed');
        expect(result.finalText).toBe(supportedExactLeadTerminal);
    });

    it('fails closed when the unsupported non-empty terminal is repeated after its one correction', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost({ [leadMaterial.path]: leadMaterial.content }),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => leadMemoryResult(input.query),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => (
                path === leadMaterial.path ? { ...leadMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'repeated-non-empty-terminal-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield {
                        type: 'text_delta' as const,
                        text: unsupportedExactLeadTerminal,
                    };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-non-empty-repeated',
        });

        expect(modelInputs).toHaveLength(3);
        expect(modelInputs[2]?.runtimeInstruction).toContain('one bounded tool-enabled corrective turn');
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.loopResult.endPayload).toMatchObject({
            reason: 'pagelet_exact_lead_protocol_incomplete',
        });
        expect(result.finalText).toBe('');
    });

    it('does not treat a search-only full-path citation as content-read evidence', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const searchOnlyTerminal = [
            '## Rollback checkpoint risk',
            '`notes/anchor.md` requires validation before release, while',
            '`notes/rollback-lead.md` records a missing rollback checkpoint that makes the release path unsafe.',
        ].join('\n');
        const runtime = createPageletAgentRuntime({
            host: createHost({ [leadMaterial.path]: leadMaterial.content }),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => leadMemoryResult(input.query),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => (
                path === leadMaterial.path ? { ...leadMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'search-only-citation-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield { type: 'text_delta' as const, text: searchOnlyTerminal };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-search-only-citation',
        });

        expect(modelInputs).toHaveLength(3);
        expect(modelInputs[2]?.toolMode).toBeUndefined();
        expect(modelInputs[2]?.runtimeInstruction).toContain('content-read evidence');
        expect(modelInputs[2]?.runtimeInstruction).not.toContain('citation-only corrective turn');
        expect(result.sourceTools.get(leadMaterial.path)).toEqual(new Set(['search_memory']));
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
        expect(result.insightDrafts).toEqual([]);
    });

    it('does not reopen tools for an unsupported non-empty terminal in final-answer-only mode', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost({ [leadMaterial.path]: leadMaterial.content }),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => leadMemoryResult(input.query),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => (
                path === leadMaterial.path ? { ...leadMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex <= 1) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: `final-only-non-empty-search-${input.turnIndex}`,
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield {
                        type: 'text_delta' as const,
                        text: unsupportedExactLeadTerminal,
                    };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-non-empty-final-only',
        });

        expect(modelInputs).toHaveLength(3);
        expect(modelInputs[2]?.toolMode).toBe('final_answer_only');
        expect(result.loopResult.turns[1]?.toolResults[0]?.content.metadata).toMatchObject({
            outcome: 'duplicate_skipped',
            reason: 'duplicate_tool_call',
        });
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
    });

    it('keeps ordinary non-empty terminals compatible when other non-anchor content evidence exists', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host: createHost({ [leadMaterial.path]: leadMaterial.content }),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => leadMemoryResult(input.query),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => {
                if (path === leadMaterial.path) return { ...leadMaterial };
                return path === relatedMaterial.path ? { ...relatedMaterial } : null;
            },
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'compatible-non-empty-terminal-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'compatible-non-empty-terminal-read',
                            name: 'inspect_obsidian_note',
                            input: { path: relatedMaterial.path },
                            index: 1,
                        };
                        return;
                    }
                    yield {
                        type: 'text_delta' as const,
                        text: compatibleNonAnchorTerminal,
                    };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-non-empty-compatible',
        });

        expect(modelInputs).toHaveLength(2);
        expect(result.loopResult.status).toBe('completed');
        expect(result.finalText).toBe(compatibleNonAnchorTerminal);
        expect(result.sourceTools.get(relatedMaterial.path)).toContain('inspect_obsidian_note');
    });

    it.each(['same-turn', 'unrelated-path'] as const)(
        'does not satisfy exact-candidate verification with a %s content read',
        async (mode) => {
            const runtime = createPageletAgentRuntime({
                host: createHost({ [leadMaterial.path]: leadMaterial.content }),
                isPathAllowed: (path) => path.startsWith('notes/'),
                executeMemorySearch: async (input) => leadMemoryResult(input.query),
                revalidateMemorySearch: async (result) => result,
                captureSourceMaterial: async (path) => {
                    if (path === leadMaterial.path) return { ...leadMaterial };
                    return path === relatedMaterial.path ? { ...relatedMaterial } : null;
                },
                createModel: () => ({
                    stream: async function* (input: PaAgentModelInput) {
                        if (input.turnIndex === 0) {
                            yield {
                                type: 'toolcall_delta' as const,
                                id: `exact-${mode}-search`,
                                name: 'search_memory',
                                input: { query: 'PGL-KITE-507' },
                                index: 0,
                            };
                            if (mode === 'same-turn') {
                                yield {
                                    type: 'toolcall_delta' as const,
                                    id: 'exact-same-turn-read',
                                    name: 'inspect_obsidian_note',
                                    input: { path: leadMaterial.path },
                                    index: 1,
                                };
                            }
                            return;
                        }
                        if (mode === 'unrelated-path' && input.turnIndex === 1) {
                            yield {
                                type: 'toolcall_delta' as const,
                                id: 'exact-unrelated-read',
                                name: 'inspect_obsidian_note',
                                input: { path: relatedMaterial.path },
                                index: 0,
                            };
                            return;
                        }
                        yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                    },
                }),
            });

            const result = await runtime.run({
                anchor: exactLeadAnchor,
                triggerReason: 'explicit',
                runId: `pagelet-exact-lead-${mode}`,
            });

            expect(result.loopResult.status).toBe('incomplete');
            expect(result.finalText).toBe('');
        },
    );

    it('fails closed when candidate metadata has no verifiable source path', async () => {
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
                candidates: [{
                    candidateId: 'hidden-candidate',
                    path: leadMaterial.path,
                    score: 0.7,
                    documents: [],
                    excerpt: 'host-only candidate',
                }],
                hasAnswerableContent: false,
                memoryEvidenceState: 'none',
                rerankVerdict: 'none_relevant',
                needsMoreEvidence: false,
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'exact-hidden-candidate-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-hidden-candidate',
        });

        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
    });

    it('allows quiet when the exact search only returns the immutable anchor itself', async () => {
        const currentAnchor = {
            ...exactLeadAnchor,
            contentHash: await hashPageletContent(exactLeadAnchor.content),
        };
        const runtime = createPageletAgentRuntime({
            host: createHost({ [currentAnchor.path]: currentAnchor.content }),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: true,
                query: input.query,
                documents: [{
                    content: currentAnchor.content,
                    score: 0.9,
                    source: { path: currentAnchor.path, chunkIndex: 0, score: 0.9 },
                }],
                sources: [{ path: currentAnchor.path, chunkIndex: 0, score: 0.9 }],
                candidates: [],
                hasAnswerableContent: true,
                memoryEvidenceState: 'evidence',
                rerankVerdict: 'relevant',
                needsMoreEvidence: false,
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'exact-anchor-only-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({
            anchor: currentAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-anchor-only',
        });

        expect(result.loopResult.status).toBe('completed');
        expect(result.finalText).toBe('NO_INSIGHT');
    });

    it('accepts NO_INSIGHT after an exact candidate is verified by a non-anchor content read', async () => {
        const runtime = createPageletAgentRuntime({
            host: createHost({ [leadMaterial.path]: leadMaterial.content }),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => leadMemoryResult(input.query),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => (
                path === leadMaterial.path ? { ...leadMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'exact-candidate-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    if (input.turnIndex === 1) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'exact-candidate-read',
                            name: 'inspect_obsidian_note',
                            input: { path: leadMaterial.path },
                            index: 0,
                        };
                        return;
                    }
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-candidate-read',
        });

        expect(result.loopResult.status).toBe('completed');
        expect(result.finalText).toBe('NO_INSIGHT');
        expect(result.sourceTools.get(leadMaterial.path)).toEqual(new Set([
            'search_memory',
            'inspect_obsidian_note',
        ]));
    });

    it('does not count a successful exact search after currentness revalidation revokes it', async () => {
        const revalidateMemorySearch = jest.fn(async (result: MemorySearchResult): Promise<MemorySearchResult> => ({
            ...result,
            usedMemory: false,
            documents: [],
            sources: [],
            candidates: [],
            hasAnswerableContent: false,
            memoryEvidenceState: 'unavailable',
            rerankVerdict: 'relevant',
            needsMoreEvidence: false,
        }));
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
                candidates: [],
                memoryEvidenceState: 'none',
                rerankVerdict: 'none_relevant',
                needsMoreEvidence: false,
            }),
            revalidateMemorySearch,
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'exact-revoked-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-revoked-search',
        });

        expect(revalidateMemorySearch).toHaveBeenCalled();
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
    });

    it('does not count a successful exact search whose result state is unavailable', async () => {
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
                candidates: [],
                hasAnswerableContent: false,
                memoryEvidenceState: 'unavailable',
                rerankVerdict: 'relevant',
                needsMoreEvidence: false,
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async () => null,
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta' as const,
                            id: 'exact-unavailable-search',
                            name: 'search_memory',
                            input: { query: 'PGL-KITE-507' },
                            index: 0,
                        };
                        return;
                    }
                    yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-unavailable-search',
        });

        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
    });

    it('preserves a verified staged first insight when the later exact-lead NO_INSIGHT protocol fails', async () => {
        const host = createHost();
        host.settings.retrievalOptimizationFlags = { relaxedRecovery: true };
        const runtime = createPageletAgentRuntime({
            host,
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async (input) => ({
                usedMemory: false,
                query: input.query,
                documents: [],
                sources: [],
            }),
            revalidateMemorySearch: async (result) => result,
            captureSourceMaterial: async (path) => {
                if (path === stagedExactLeadAnchor.path) return { ...stagedExactLeadAnchor };
                return path === relatedMaterial.path ? { ...relatedMaterial } : null;
            },
            createModel: () => stagedInsightModel('NO_INSIGHT'),
        });

        const result = await runtime.run({
            anchor: stagedExactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-preserve-staged',
        });

        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
        expect(result.insightDrafts).toEqual([
            expect.objectContaining({
                origin: 'staged',
                declaredSourceIds: [stagedExactLeadAnchor.path, relatedMaterial.path],
            }),
        ]);
    });

    it('fails closed without reopening tools when the exact-lead violation occurs in final-answer-only mode', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const executeMemorySearch = jest.fn(async (input: { query: string }) => ({
            usedMemory: false,
            query: input.query,
            documents: [],
            sources: [],
        }));
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch,
            captureSourceMaterial: async (path) => (
                path === relatedMaterial.path ? { ...relatedMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.toolMode === 'final_answer_only') {
                        yield { type: 'text_delta' as const, text: 'NO_INSIGHT' };
                        return;
                    }
                    yield {
                        type: 'toolcall_delta' as const,
                        id: `recent-${input.turnIndex}`,
                        name: 'list_recent_notes',
                        input: {
                            limit: input.turnIndex + 1,
                            order: input.turnIndex % 2 === 0 ? 'modified' : 'created',
                        },
                        index: 0,
                    };
                },
            }),
        });

        const result = await runtime.run({
            anchor: exactLeadAnchor,
            triggerReason: 'explicit',
            runId: 'pagelet-exact-lead-final-only',
        });

        expect(modelInputs).toHaveLength(4);
        expect(modelInputs[3]?.toolMode).toBe('final_answer_only');
        expect(executeMemorySearch).not.toHaveBeenCalled();
        expect(result.loopResult.status).toBe('incomplete');
        expect(result.finalText).toBe('');
    });

    it('revalidates Memory before Pagelet model requests and removes revoked provenance', async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const staleMemory: MemorySearchResult = {
            usedMemory: true,
            query: 'release',
            documents: [{
                content: 'STALE MEMORY EVIDENCE',
                score: 0.9,
                source: { path: relatedMaterial.path, chunkIndex: 0, score: 0.9 },
            }],
            sources: [{ path: relatedMaterial.path, chunkIndex: 0, score: 0.9 }],
            candidates: [],
            hasAnswerableContent: true,
            memoryEvidenceState: 'evidence',
            rerankVerdict: 'relevant',
            needsMoreEvidence: false,
        };
        const revalidateMemorySearch = jest.fn(async (result: MemorySearchResult): Promise<MemorySearchResult> => ({
            ...result,
            usedMemory: false,
            documents: [],
            sources: [],
            candidates: [],
            hasAnswerableContent: false,
            memoryEvidenceState: 'unavailable',
            rerankVerdict: 'relevant',
            needsMoreEvidence: false,
            retrievalGuidance: 'Memory evidence is currently unavailable.',
        }));
        const runtime = createPageletAgentRuntime({
            host: createHost(),
            isPathAllowed: (path) => path.startsWith('notes/'),
            executeMemorySearch: async () => staleMemory,
            revalidateMemorySearch,
            captureSourceMaterial: async (path) => (
                path === relatedMaterial.path ? { ...relatedMaterial } : null
            ),
            createModel: () => ({
                stream: async function* (input: PaAgentModelInput) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: 'toolcall_delta',
                            id: 'gate-anchor',
                            name: 'get_current_note_context',
                            input: { mode: 'full' },
                            index: 0,
                        } as const;
                        yield {
                            type: 'toolcall_delta',
                            id: 'gate-memory',
                            name: 'search_memory',
                            input: { query: 'release' },
                            index: 1,
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
            runId: 'pagelet-memory-request-gate',
        });

        const gatedMemory = modelInputs[1]?.transcript.find((message) => (
            message.role === 'toolResult' && message.toolName === 'search_memory'
        ));
        expect(revalidateMemorySearch).toHaveBeenCalled();
        expect(gatedMemory).toMatchObject({
            role: 'toolResult',
            content: { sourceRecords: [] },
        });
        expect((gatedMemory as Extract<PaAgentMessage, { role: 'toolResult' }>).content.promptText)
            .not.toContain('STALE MEMORY EVIDENCE');
        expect(result.toolProvenance.find((entry) => entry.toolName === 'search_memory')).toMatchObject({
            sourceRecords: [],
        });
        expect(result.toolProvenance.find((entry) => entry.toolName === 'search_memory')?.promptText)
            .not.toContain('STALE MEMORY EVIDENCE');
        expect(result.sourceTools.has(relatedMaterial.path)).toBe(false);
        expect(result.sourceSnapshots.map((source) => source.path)).not.toContain(relatedMaterial.path);
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

    it('records the Loop-reserved Pagelet finalization boundary', async () => {
        const diagnostics = new RetrievalDiagnosticsController(
            () => 0,
            () => 0,
            () => 'pagelet-final-reserve-session',
        );
        const diagnosticsSession = diagnostics.start();
        const host = createHost();
        host.createRetrievalDiagnosticRecorder = (surface) => diagnostics.createRecorder(surface);
        let nowCalls = 0;
        const modelInputs: PaAgentModelInput[] = [];
        const runtime = createPageletAgentRuntime({
            host,
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
                    yield { type: 'text_delta', text: 'NO_INSIGHT' } as const;
                },
            }),
            now: () => nowCalls++ < 2 ? 0 : 150_001,
        });

        const result = await runtime.run({
            anchor,
            triggerReason: 'explicit',
            runId: 'pagelet-soft-deadline-reserve-test',
        });

        expect(result.loopResult.status).toBe('completed');
        expect(modelInputs).toHaveLength(1);
        expect(modelInputs[0]?.toolMode).toBe('final_answer_only');
        expect(diagnostics.snapshot(diagnosticsSession.sessionId).events
            .filter((event) => event.phase === 'finalization_reserve')
            .map((event) => ({ surface: event.surface, outcome: event.outcome })))
            .toEqual([
                { surface: 'pagelet', outcome: 'started' },
                { surface: 'pagelet', outcome: 'completed' },
            ]);
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

    it('keeps conditional per-lead probes in the second-turn provider prompt', async () => {
        const registry = new CapabilityRegistry();
        const providerInputs: unknown[] = [];
        const runnable = RunnableLambda.from(async (input: unknown) => {
            providerInputs.push(input);
            return { content: 'NO_INSIGHT' };
        });
        const model = createPageletNativeModel({
            registry,
            allowedToolNames: new Set(),
            createChatModel: async () => runnable,
        });
        const baseInput = {
            runId: 'native-stable-lead-probes',
            userInput: 'discover',
            transcript: [],
        };

        for (const turnIndex of [0, 1]) {
            for await (const chunk of model.stream({
                ...baseInput,
                turnId: `turn-${turnIndex}`,
                turnIndex,
                runtimeInstruction: turnIndex === 0
                    ? 'Read the anchor first.'
                    : 'Continue from the observed anchor evidence.',
            })) {
                void chunk;
            }
        }

        const secondPrompt = providerPromptText(providerInputs[1]);
        expect(secondPrompt).toContain('During ordinary tool-enabled exploration');
        expect(secondPrompt).toContain('one or more distinct unresolved leads');
        expect(secondPrompt).toContain('smallest relevant linked-note set for each lead');
        expect(secondPrompt).toContain('checking multiple leads never requires producing multiple insights');
        expect(secondPrompt).toContain('unresolved exact identifier');
        expect(secondPrompt).toContain('call search_memory with that exact literal');
        expect(secondPrompt).toContain('Continue from the observed anchor evidence.');
    });

    it('rebuilds the Pagelet prompt after deferred model construction revokes Memory', async () => {
        const registry = new CapabilityRegistry();
        const stalePath = 'notes/revoked-pagelet.md';
        const staleBody = 'REVOKED PAGELET MEMORY BODY';
        const staleTranscript: PaAgentMessage[] = [{
            role: 'toolResult',
            id: 'stale-pagelet-memory',
            toolCallId: 'stale-pagelet-memory-call',
            toolName: 'search_memory',
            isError: false,
            timestamp: 1,
            content: {
                promptText: staleBody,
                includeInNextPrompt: true,
                sourceRecords: [{
                    kind: 'memory-reference',
                    dedupKey: stalePath,
                    path: stalePath,
                }],
            },
        }];
        const safeTranscript: PaAgentMessage[] = [{
            ...staleTranscript[0] as Extract<PaAgentMessage, { role: 'toolResult' }>,
            content: {
                promptText: 'Memory evidence is currently unavailable.',
                includeInNextPrompt: true,
                sourceRecords: [],
            },
        }];
        const providerInputs: unknown[] = [];
        const runnable = {
            stream: jest.fn(async function* (input: unknown) {
                providerInputs.push(input);
                yield { content: 'safe pagelet answer' };
            }),
            invoke: jest.fn(async () => ({ content: 'fallback answer' })),
        };
        let resolveModel!: (model: unknown) => void;
        let markModelRequested!: () => void;
        const modelRequested = new Promise<void>((resolve) => {
            markModelRequested = resolve;
        });
        const deferredModel = new Promise<unknown>((resolve) => {
            resolveModel = resolve;
        });
        let sourceRevoked = false;
        const prepareForProviderRetry = jest.fn(async (input: PaAgentModelInput) => ({
            ...input,
            transcript: sourceRevoked ? safeTranscript : staleTranscript,
        }));
        const model = createPageletNativeModel({
            registry,
            allowedToolNames: new Set(),
            createChatModel: async () => {
                markModelRequested();
                return deferredModel;
            },
            createPrompt: () => ({ pipe: () => runnable }),
            buildPromptInput: (_input, context) => ({ observations: context.toolObservations }),
        });
        const baseInput: PaAgentModelInput = {
            runId: 'pagelet-deferred-model',
            turnId: 'turn',
            turnIndex: 1,
            userInput: 'discover',
            transcript: staleTranscript,
        };
        const run = (async () => {
            for await (const chunk of model.stream({
                ...baseInput,
                prepareForProviderRetry: () => prepareForProviderRetry(baseInput),
            })) {
                void chunk;
            }
        })();

        await modelRequested;
        sourceRevoked = true;
        resolveModel(runnable);
        await run;

        expect(prepareForProviderRetry).toHaveBeenCalledTimes(1);
        expect(providerInputs).toHaveLength(1);
        expect(JSON.stringify(providerInputs[0])).not.toContain(stalePath);
        expect(JSON.stringify(providerInputs[0])).not.toContain(staleBody);
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

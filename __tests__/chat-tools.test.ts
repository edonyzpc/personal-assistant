import { describe, expect, it, jest } from '@jest/globals';

import { createChatToolCapability } from '../src/ai-services/capability-adapter';
import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import {
    OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
    OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES,
    createInspectObsidianNoteTool,
    createListVaultTagsTool,
    createReadCanvasSummaryTool,
    createSearchVaultSnippetsTool,
    isChatToolName,
    isInspectObsidianNoteResult,
    isObsidianOperationsV1AToolName,
    type ChatToolDefinition,
    type ChatToolResult,
} from '../src/ai-services/chat-tools';
import { buildObsidianOperationsPlannerGuidance } from '../src/ai-services/obsidian-operations-capability-catalog';

jest.mock('obsidian');

function createV1AToolDefinition(
    overrides: Partial<ChatToolDefinition<Record<string, never>, { kind: 'note-structure'; path: string }>> = {},
): ChatToolDefinition<Record<string, never>, { kind: 'note-structure'; path: string }> {
    return {
        name: 'inspect_obsidian_note',
        description: 'Inspect note structure.',
        plannerGuidance: ['Use for bounded note structure.'],
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
        },
        permission: 'read-only',
        cost: 'free',
        outputBudgetChars: 1000,
        requiresConfirmation: false,
        failureBehavior: 'recoverable',
        statusMessageText: 'Reading note structure',
        sourceBoundary: 'read-only-tool',
        statusMessage: () => 'Reading note structure',
        validateInput: () => ({}),
        execute: async (): Promise<ChatToolResult<{ kind: 'note-structure'; path: string }>> => ({
            ok: true,
            tool: 'inspect_obsidian_note',
            inputSummary: 'current note',
            content: {
                kind: 'note-structure',
                path: 'notes/current.md',
            },
            sources: [{ path: 'notes/current.md' }],
        }),
        ...overrides,
    };
}

function registerV1ATool<Input, Output>(
    registry: CapabilityRegistry,
    definition: ChatToolDefinition<Input, Output>,
): void {
    const capability = createChatToolCapability(definition, { providerId: 'test-v1a' });
    registry.register(capability);
}

describe('Obsidian Operations v1A tool policy', () => {
    it('exposes v1A tool names as valid chat tool names without registering them by default', () => {
        const registry = new CapabilityRegistry();

        expect(OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES).toEqual([
            'inspect_obsidian_note',
            'read_canvas_summary',
            'search_vault_snippets',
            'list_vault_tags',
        ]);
        for (const name of OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES) {
            expect(isChatToolName(name)).toBe(true);
            expect(isObsidianOperationsV1AToolName(name)).toBe(true);
            expect(registry.has(name)).toBe(false);
        }
    });

    it('keeps provider schema export registration-driven for v1A tools', () => {
        const registry = new CapabilityRegistry();

        expect(registry.exportProviderSchemas()).toEqual([]);

        registerV1ATool(registry, createV1AToolDefinition());

        expect(registry.exportProviderSchemas()).toEqual([
            expect.objectContaining({
                type: 'function',
                function: expect.objectContaining({
                    name: 'inspect_obsidian_note',
                    description: 'Inspect note structure.',
                }),
            }),
        ]);
    });

    it('accepts v1A tools with strict read-only metadata', () => {
        const registry = new CapabilityRegistry();

        registerV1ATool(registry, createV1AToolDefinition({
            outputBudgetChars: OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
        }));

        expect(registry.getDefinition('inspect_obsidian_note')).toMatchObject({
            name: 'inspect_obsidian_note',
            permission: 'read-only',
            cost: 'free',
            outputBudgetChars: OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
            requiresConfirmation: false,
            failureBehavior: 'recoverable',
            sourceBoundary: 'read-only-tool',
        });
    });

    it('composes registered v1A tool guidance from the catalog safety sections', () => {
        const registry = new CapabilityRegistry();
        registerV1ATool(registry, createInspectObsidianNoteTool());
        registerV1ATool(registry, createReadCanvasSummaryTool());
        registerV1ATool(registry, createSearchVaultSnippetsTool());
        registerV1ATool(registry, createListVaultTagsTool());
        const markdownSafetyGuidance = buildObsidianOperationsPlannerGuidance(['markdown', 'safety']);
        const canvasSafetyGuidance = buildObsidianOperationsPlannerGuidance(['canvas', 'safety']);

        for (const tool of ['inspect_obsidian_note', 'search_vault_snippets', 'list_vault_tags']) {
            const guidance = registry.getDefinition(tool)?.plannerGuidance ?? [];
            for (const line of markdownSafetyGuidance) {
                expect(guidance).toContain(line);
            }
        }
        const canvasGuidance = registry.getDefinition('read_canvas_summary')?.plannerGuidance ?? [];
        for (const line of canvasSafetyGuidance) {
            expect(canvasGuidance).toContain(line);
        }
    });

    it('rejects invalid v1A permission, cost, confirmation, failure behavior, and source boundary metadata', () => {
        const invalidDefinition = {
            ...createV1AToolDefinition(),
            permission: 'write',
            cost: 'ai-calls',
            requiresConfirmation: true,
            failureBehavior: 'fatal',
            sourceBoundary: 'memory',
        } as unknown as ChatToolDefinition<Record<string, never>, { kind: 'note-structure'; path: string }>;
        const registry = new CapabilityRegistry();

        expect(() => createChatToolCapability(invalidDefinition, { providerId: 'test-v1a' })).toThrow(
            /permission must be read-only.*cost must be free.*requiresConfirmation must be false.*failureBehavior must be recoverable.*sourceBoundary must be read-only-tool/,
        );
        expect(registry.has('inspect_obsidian_note')).toBe(false);
    });

    it('rejects missing, non-positive, and oversized v1A output budgets', () => {
        for (const outputBudgetChars of [0, -1, Number.NaN, OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS + 1]) {
            const registry = new CapabilityRegistry();
            const definition = createV1AToolDefinition({ outputBudgetChars });

            expect(() => createChatToolCapability(definition, { providerId: 'test-v1a' })).toThrow(/outputBudgetChars/);
            expect(registry.has('inspect_obsidian_note')).toBe(false);
        }
    });

    it('recognizes v1A-shaped read-only outputs through guarded result shapes', () => {
        expect(isInspectObsidianNoteResult({
            kind: 'note-structure',
            path: 'notes/current.md',
        })).toBe(true);
        expect(isInspectObsidianNoteResult({
            path: 'notes/current.md',
        })).toBe(false);
    });
});

describe('list_vault_tags cooperative cancellation (P0-B)', () => {
    function makeFakePlugin(fileCount: number, onGetFileCache?: (path: string) => void): unknown {
        const files = Array.from({ length: fileCount }, (_, index) => ({ path: `notes/note-${index}.md` }));
        return {
            app: {
                vault: {
                    getMarkdownFiles: () => files,
                },
                metadataCache: {
                    getFileCache: (file: { path: string }) => {
                        onGetFileCache?.(file.path);
                        return { tags: [{ tag: '#example' }] };
                    },
                },
            },
        };
    }

    it('throws AbortError when the signal is already aborted', async () => {
        const tool = createListVaultTagsTool();
        const plugin = makeFakePlugin(2_000);
        const controller = new AbortController();
        controller.abort();

        await expect(
            tool.execute({ limit: 10 }, {
                host: plugin as never,
                signal: controller.signal,
            } as never),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('aborts mid-scan when the signal is fired before the next yield interval and stops calling getFileCache', async () => {
        const tool = createListVaultTagsTool();
        const fileScanLog: string[] = [];
        const controller = new AbortController();
        // Abort deterministically inside the getFileCache callback at file 100.
        // The abort signal is checked at the next yield checkpoint (scannedFiles=2048),
        // so the scan should stop well before all 5_000 files are visited.
        const plugin = makeFakePlugin(5_000, (path) => {
            fileScanLog.push(path);
            if (fileScanLog.length === 100) {
                controller.abort();
            }
        });

        const result = await tool.execute({ limit: 10 }, {
            host: plugin as never,
            signal: controller.signal,
        } as never).then(
            (v) => ({ status: 'fulfilled' as const, value: v }),
            (e: unknown) => ({ status: 'rejected' as const, reason: e }),
        );

        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
            expect((result.reason as Error).name).toBe('AbortError');
        }
        // The abort fires at file 100, but the sync batch runs until the next yield
        // checkpoint at 2048. The scan must stop at or shortly after that checkpoint.
        expect(fileScanLog.length).toBeLessThan(5_000);
    });

    it('returns tags successfully when no abort fires (regression: still completes after going async)', async () => {
        const tool = createListVaultTagsTool();
        const plugin = makeFakePlugin(50);

        const result = await tool.execute({ limit: 10 }, {
            host: plugin as never,
            signal: new AbortController().signal,
        } as never);

        expect(result.ok).toBe(true);
        const content = result.content as { kind: string; tags: Array<{ tag: string; count: number }>; scannedFiles: number };
        expect(content.kind).toBe('vault-tags');
        expect(content.scannedFiles).toBe(50);
        expect(content.tags).toEqual([
            expect.objectContaining({ tag: '#example', count: 50 }),
        ]);
    });
});

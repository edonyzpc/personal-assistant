import { describe, expect, it, jest } from '@jest/globals';

import {
    OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
    OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES,
    ToolRegistry,
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

describe('Obsidian Operations v1A tool policy', () => {
    it('exposes v1A tool names as valid chat tool names without registering them by default', () => {
        const registry = new ToolRegistry();

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
        const registry = new ToolRegistry();

        expect(registry.exportProviderSchemas()).toEqual([]);

        registry.register(createV1AToolDefinition());

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
        const registry = new ToolRegistry();

        registry.register(createV1AToolDefinition({
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
        const registry = new ToolRegistry();
        registry.register(createInspectObsidianNoteTool());
        registry.register(createReadCanvasSummaryTool());
        registry.register(createSearchVaultSnippetsTool());
        registry.register(createListVaultTagsTool());
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
        const registry = new ToolRegistry();

        expect(() => registry.register(invalidDefinition)).toThrow(
            /permission must be read-only.*cost must be free.*requiresConfirmation must be false.*failureBehavior must be recoverable.*sourceBoundary must be read-only-tool/,
        );
        expect(registry.has('inspect_obsidian_note')).toBe(false);
    });

    it('rejects missing, non-positive, and oversized v1A output budgets', () => {
        for (const outputBudgetChars of [0, -1, Number.NaN, OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS + 1]) {
            const registry = new ToolRegistry();
            const definition = createV1AToolDefinition({ outputBudgetChars });

            expect(() => registry.register(definition)).toThrow(/outputBudgetChars/);
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

import { describe, expect, it, jest } from "@jest/globals";

import {
    createCapabilityFromChatToolDefinition,
    createCoreToolCapabilities,
    chatToolResultToAgentCapabilityResult,
} from "../src/ai-services/capability-adapter";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import type {
    AgentCapability,
    CapabilityProvider,
    ProviderLoadContext,
} from "../src/ai-services/capability-types";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import {
    createCurrentNoteContextTool,
    createInspectObsidianNoteTool,
    createListRecentNotesTool,
    createListVaultTagsTool,
    createReadCanvasSummaryTool,
    createReadNoteOutlineTool,
    createSearchMemoryTool,
    createSearchVaultMetadataTool,
    createSearchVaultSnippetsTool,
    type ChatToolContext,
    type ChatToolDefinition,
    type ChatToolRegistryDefinition,
    type ChatToolResult,
    type SearchMemoryInput,
} from "../src/ai-services/chat-tools";
import type { MemorySearchResult } from "../src/ai-services/chat-types";
import { createTestChatToolDefinition } from "../src/tests/factories";

jest.mock("obsidian");

const executeMemorySearch = async (
    input: SearchMemoryInput,
    _context: ChatToolContext,
): Promise<MemorySearchResult> => ({
    usedMemory: true,
    query: input.query,
    documents: [],
    sources: [{ path: "memory/source.md", chunkIndex: 0, score: 0.9 }],
});

describe("CapabilityRegistry and core tool capabilities", () => {
    it("exports the 9 core tools as provider schemas in canonical order", () => {
        const registry = new CapabilityRegistry();
        registry.registerMany(createCoreCapabilities());

        expect(registry.exportProviderSchemas()).toEqual(buildExpectedCoreSchemas());
        expect(registry.exportProviderSchemas()).toHaveLength(9);
    });

    it("keeps provider schema ordering stable across sequential turns", () => {
        const registry = new CapabilityRegistry();
        registry.registerMany(createCoreCapabilities());
        const namesByTurn = [
            registry.exportProviderSchemas().map((schema) => schema.function.name),
            registry.exportProviderSchemas().map((schema) => schema.function.name),
            registry.exportProviderSchemas().map((schema) => schema.function.name),
        ];

        expect(namesByTurn[0]).toEqual([
            "search_memory",
            "get_current_note_context",
            "search_vault_metadata",
            "list_recent_notes",
            "read_note_outline",
            "inspect_obsidian_note",
            "read_canvas_summary",
            "search_vault_snippets",
            "list_vault_tags",
        ]);
        expect(namesByTurn[1]).toEqual(namesByTurn[0]);
        expect(namesByTurn[2]).toEqual(namesByTurn[0]);
    });

    it("filters capabilities before provider schema generation", () => {
        const [searchMemory, , , , readNoteOutline] = createCoreCapabilities();
        const registry = new CapabilityRegistry();
        registry.register(searchMemory);
        registry.register({
            ...readNoteOutline,
            toProviderSchema: () => {
                throw new Error("hidden schema should not be serialized");
            },
        });

        expect(registry.exportProviderSchemasSafe({
            allowedToolNames: new Set(["search_memory"]),
        })).toEqual({
            ok: true,
            schemas: [searchMemory.toProviderSchema()],
        });
    });

    it("rejects duplicate capability names with a diagnostic and keeps the earlier registration", () => {
        const registry = new CapabilityRegistry();
        const first = createCapabilityFromChatToolDefinition(
            toRegistryDefinition(createTestChatToolDefinition({
                name: "search_vault_metadata",
                description: "First capability.",
            })),
            {
                providerId: "first-provider",
                execute: async () => createOkToolResult("search_vault_metadata"),
            },
        );
        const second = {
            ...first,
            description: "Second capability.",
            providerId: "second-provider",
            toRegistryDefinition: () => ({
                ...first.toRegistryDefinition(),
                description: "Second capability.",
            }),
        } satisfies AgentCapability;

        expect(registry.register(first)).toBe(true);
        expect(registry.register(second)).toBe(false);

        expect(registry.getDefinition("search_vault_metadata")?.description).toBe("First capability.");
        expect(registry.listDiagnostics()).toEqual([{
            type: "duplicate",
            capabilityName: "search_vault_metadata",
            providerId: "second-provider",
            reason: "duplicate capability name rejected; earlier registration kept",
        }]);
    });

    it("rejects direct Obsidian Operations capabilities that bypass v1A policy", () => {
        const registry = new CapabilityRegistry();
        const invalidCapability = {
            ...createTestCapability("inspect_obsidian_note"),
            sourceBoundary: "memory",
        } satisfies AgentCapability;

        expect(registry.register(invalidCapability)).toBe(false);
        expect(registry.exportProviderSchemas()).toEqual([]);
        expect(registry.listDiagnostics()).toEqual([{
            type: "policy",
            capabilityName: "inspect_obsidian_note",
            providerId: "test-provider",
            reason: "invalid Obsidian Operations v1A capability policy: sourceBoundary must be read-only-tool",
        }]);
    });

    it("filters action and write capabilities before schema export and execution", async () => {
        const base = createCapabilityFromChatToolDefinition(
            toRegistryDefinition(createTestChatToolDefinition({ name: "search_vault_metadata" })),
            {
                providerId: "test-provider",
                execute: async () => createOkToolResult("search_vault_metadata"),
            },
        );
        const actionCapability = {
            ...base,
            kind: "action",
        } satisfies AgentCapability;
        const writeCapability = {
            ...base,
            name: "read_note_outline",
            permission: "write",
            toProviderSchema: () => ({
                type: "function" as const,
                function: {
                    name: "read_note_outline",
                    description: "Write capability.",
                    parameters: base.inputSchema,
                },
            }),
            toRegistryDefinition: () => ({
                ...base.toRegistryDefinition(),
                name: "read_note_outline",
                description: "Write capability.",
            }),
        } satisfies AgentCapability;
        const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine() });
        registry.register(actionCapability);
        registry.register(writeCapability);

        expect(registry.exportProviderSchemas()).toEqual([]);
        await expect(registry.execute("search_vault_metadata", {}, {
            host: createPlugin(),
        })).resolves.toMatchObject({
            ok: false,
            error: "Skipped a capability that is unavailable in this mode.",
        });
        await expect(registry.execute("read_note_outline", {}, {
            host: createPlugin(),
        })).resolves.toMatchObject({
            ok: false,
            error: "Skipped a capability that is unavailable in this mode.",
        });
    });

    it("omits unsupported capabilities while registering provider load results on mobile", async () => {
        const desktopOnly = createTestCapability("search_vault_metadata", {
            platform: "desktop",
            providerId: "mixed-provider",
        });
        const mobileSafe = createTestCapability("read_note_outline", {
            platform: "both",
            providerId: "mixed-provider",
        });
        const provider = createProvider([desktopOnly, mobileSafe], {
            id: "mixed-provider",
        });
        const registry = new CapabilityRegistry({
            policyEngine: new PolicyEngine({ platform: "mobile" }),
        });

        const result = await registry.registerProvider(provider, createProviderLoadContext("mobile"));

        expect(result.capabilities.map((capability) => capability.name)).toEqual(["read_note_outline"]);
        expect(registry.exportProviderSchemas().map((schema) => schema.function.name)).toEqual(["read_note_outline"]);
        expect(registry.listDiagnostics()).toContainEqual({
            type: "policy",
            capabilityName: "search_vault_metadata",
            providerId: "mixed-provider",
            reason: "capability is not supported on mobile",
        });
    });

    it("skips provider loading when the provider is not supported on the runtime platform", async () => {
        const load = jest.fn<CapabilityProvider["load"]>();
        const provider = createProvider([], {
            platform: "desktop",
            load,
        });
        const registry = new CapabilityRegistry({
            policyEngine: new PolicyEngine({ platform: "mobile" }),
        });

        await expect(registry.registerProvider(provider, createProviderLoadContext("mobile")))
            .resolves.toMatchObject({
                status: "unavailable",
                capabilities: [],
                unavailableReason: "provider is not supported on mobile",
            });
        expect(load).not.toHaveBeenCalled();
        expect(registry.exportProviderSchemas()).toEqual([]);
    });

    it("isolates provider load failures without clearing already registered capabilities", async () => {
        const registry = new CapabilityRegistry();
        registry.register(createTestCapability("search_vault_metadata"));
        const provider = createProvider([], {
            id: "failing-provider",
            load: jest.fn(async () => {
                throw new TypeError("provider unavailable");
            }),
        });

        await expect(registry.registerProvider(provider, createProviderLoadContext("desktop")))
            .resolves.toMatchObject({
                status: "unavailable",
                capabilities: [],
                unavailableReason: "provider unavailable",
                diagnostics: { errorType: "TypeError" },
            });
        expect(registry.exportProviderSchemas().map((schema) => schema.function.name)).toEqual([
            "search_vault_metadata",
        ]);
    });
});

describe("CapabilityAdapter source mapping", () => {
    it("maps current-note sources to context-used records", () => {
        const result = chatToolResultToAgentCapabilityResult(
            toRegistryDefinition(createTestChatToolDefinition({
                name: "get_current_note_context",
                metadata: { sourceBoundary: "current-note" },
            })),
            "core-tools",
            {
                ok: true,
                tool: "get_current_note_context",
                inputSummary: "metadata",
                content: { path: "notes/current.md" },
                sources: [{ path: "notes/current.md" }],
            },
        );

        expect(result.sourceRecords).toEqual([expect.objectContaining({
            kind: "context-used",
            capabilityName: "get_current_note_context",
            path: "notes/current.md",
            citationEligible: false,
        })]);
    });

    it("maps Memory sources to memory-reference records", () => {
        const result = chatToolResultToAgentCapabilityResult(
            toRegistryDefinition(createTestChatToolDefinition({
                name: "search_memory",
                metadata: { sourceBoundary: "memory", cost: "ai-calls", outputBudgetChars: 8000 },
            })),
            "core-tools",
            {
                ok: true,
                tool: "search_memory",
                inputSummary: "project",
                content: { usedMemory: true },
                sources: [{ path: "notes/memory.md", chunkIndex: 1, score: 0.82 }],
            },
        );

        expect(result.sourceRecords).toEqual([expect.objectContaining({
            kind: "memory-reference",
            capabilityName: "search_memory",
            path: "notes/memory.md",
            citationEligible: true,
        })]);
    });
});

describe("Capability telemetry hook", () => {
    it("does not emit events when telemetry is disabled", async () => {
        const onCapabilityEvent = jest.fn();
        const registry = new CapabilityRegistry({ telemetryEnabled: false, onCapabilityEvent });
        registry.register(createCapabilityFromChatToolDefinition(
            toRegistryDefinition(createTestChatToolDefinition({ name: "search_vault_metadata" })),
            {
                providerId: "test-provider",
                execute: async () => createOkToolResult("search_vault_metadata"),
            },
        ));

        await registry.execute("search_vault_metadata", {}, { host: createPlugin() });

        expect(onCapabilityEvent).not.toHaveBeenCalled();
    });

    it("emits one content-free local event when telemetry is enabled", async () => {
        const onCapabilityEvent = jest.fn();
        const registry = new CapabilityRegistry({ telemetryEnabled: true, onCapabilityEvent });
        registry.register(createCapabilityFromChatToolDefinition(
            toRegistryDefinition(createTestChatToolDefinition({ name: "search_vault_metadata" })),
            {
                providerId: "test-provider",
                execute: async () => createOkToolResult("search_vault_metadata"),
            },
        ));

        await registry.execute("search_vault_metadata", { query: "PRIVATE_PROMPT_SENTINEL" }, { host: createPlugin() });

        expect(onCapabilityEvent).toHaveBeenCalledTimes(1);
        expect(onCapabilityEvent).toHaveBeenCalledWith({
            capabilityName: "search_vault_metadata",
            providerId: "test-provider",
            status: "invoked",
            durationMs: expect.any(Number),
        });
        expect(Object.keys(onCapabilityEvent.mock.calls[0][0] as Record<string, unknown>).join(" ")).not.toMatch(/note|prompt|content|path/i);
        expect(JSON.stringify(onCapabilityEvent.mock.calls[0][0])).not.toContain("PRIVATE_PROMPT_SENTINEL");
    });

});

function createCoreCapabilities(): AgentCapability[] {
    return createCoreToolCapabilities([
        createSearchMemoryTool(executeMemorySearch),
        createCurrentNoteContextTool(),
        createSearchVaultMetadataTool(),
        createListRecentNotesTool(),
        createReadNoteOutlineTool(),
        createInspectObsidianNoteTool(),
        createReadCanvasSummaryTool(),
        createSearchVaultSnippetsTool(),
        createListVaultTagsTool(),
    ]);
}

function buildExpectedCoreSchemas() {
    return createCoreCapabilities().map((capability) => capability.toProviderSchema());
}

function createOkToolResult(tool: string): ChatToolResult<{ ok: true }> {
    return {
        ok: true,
        tool,
        inputSummary: "ok",
        content: { ok: true },
        sources: [],
    };
}

function createTestCapability(
    name: ChatToolRegistryDefinition["name"],
    overrides: Partial<AgentCapability> = {},
): AgentCapability {
    return createCapabilityFromChatToolDefinition(
        toRegistryDefinition(createTestChatToolDefinition({ name })),
        {
            providerId: typeof overrides.providerId === "string" ? overrides.providerId : "test-provider",
            platform: overrides.platform,
            execute: async () => createOkToolResult(name),
        },
    );
}

function createProvider(
    capabilities: AgentCapability[],
    overrides: Partial<CapabilityProvider> = {},
): CapabilityProvider {
    return {
        id: "test-provider",
        displayName: "Test provider",
        required: false,
        kind: "tool-provider",
        platform: "both",
        load: jest.fn(async () => ({
            status: "available" as const,
            capabilities,
        })),
        ...overrides,
    };
}

function createProviderLoadContext(platform: ProviderLoadContext["platform"]): ProviderLoadContext {
    return {
        turnId: "test-turn",
        platform,
        settings: {},
    };
}

function createPlugin() {
    return {
        log: jest.fn(),
    } as unknown as Parameters<CapabilityRegistry["execute"]>[2]["host"];
}

function toRegistryDefinition<Input, Output>(
    tool: ChatToolDefinition<Input, Output>,
): ChatToolRegistryDefinition {
    return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        plannerGuidance: [...tool.plannerGuidance],
        permission: tool.permission,
        cost: tool.cost,
        outputBudgetChars: tool.outputBudgetChars,
        requiresConfirmation: tool.requiresConfirmation,
        failureBehavior: tool.failureBehavior,
        statusMessage: tool.statusMessageText,
        sourceBoundary: tool.sourceBoundary,
    };
}

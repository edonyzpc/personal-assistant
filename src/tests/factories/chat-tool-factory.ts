import {
    ToolRegistry,
    type ChatToolCost,
    type ChatToolDefinition,
    type ChatToolFailureBehavior,
    type ChatToolInputSchema,
    type ChatToolName,
    type ChatToolPermission,
    type ChatToolResult,
    type ChatToolSourceBoundary,
} from "../../ai-services/chat-tools";
import type { ChatAgentSource } from "../../ai-services/chat-types";

export const TEST_CHAT_TOOL_NAMES: readonly ChatToolName[] = [
    "search_memory",
    "get_current_note_context",
    "search_vault_metadata",
    "list_recent_notes",
    "read_note_outline",
    "inspect_obsidian_note",
    "read_canvas_summary",
    "search_vault_snippets",
    "list_vault_tags",
];

export interface TestChatToolOutput {
    kind: string;
    path?: string;
    value?: string;
}

export interface TestChatToolMetadata {
    permission: ChatToolPermission;
    cost: ChatToolCost;
    outputBudgetChars: number;
    requiresConfirmation: boolean;
    failureBehavior: ChatToolFailureBehavior;
    sourceBoundary: ChatToolSourceBoundary;
}

export interface TestChatToolDefinitionOptions<Output> {
    name?: ChatToolName;
    description?: string;
    plannerGuidance?: string[];
    inputSchema?: ChatToolInputSchema;
    metadata?: Partial<TestChatToolMetadata>;
    statusMessageText?: string;
    inputSummary?: string;
    output?: Output;
    sources?: ChatAgentSource[];
    ok?: boolean;
    error?: string;
}

export function createTestChatToolDefinition<Output = TestChatToolOutput>(
    options: TestChatToolDefinitionOptions<Output> = {},
): ChatToolDefinition<Record<string, unknown>, Output> {
    const name = options.name ?? "search_vault_metadata";
    const metadata = {
        ...getDefaultMetadataForTool(name),
        ...options.metadata,
    };
    const output = options.output ?? ({
        kind: `${name}-result`,
        path: `${name}.md`,
        value: "fixture",
    } as Output);
    const sources = options.sources ?? [{ path: `${name}.md` }];

    return {
        name,
        description: options.description ?? `Test definition for ${name}.`,
        plannerGuidance: options.plannerGuidance ?? [`Use ${name} in PA Agent tests.`],
        inputSchema: options.inputSchema ?? createEmptyInputSchema(),
        permission: metadata.permission,
        cost: metadata.cost,
        outputBudgetChars: metadata.outputBudgetChars,
        requiresConfirmation: metadata.requiresConfirmation,
        failureBehavior: metadata.failureBehavior,
        statusMessageText: options.statusMessageText ?? `Running ${name}`,
        sourceBoundary: metadata.sourceBoundary,
        statusMessage: () => options.statusMessageText ?? `Running ${name}`,
        validateInput: (input) => input as Record<string, unknown>,
        execute: async (input): Promise<ChatToolResult<Output>> => ({
            ok: options.ok ?? true,
            tool: name,
            inputSummary: options.inputSummary ?? JSON.stringify(input),
            content: options.ok === false ? null : output,
            sources: options.ok === false ? [] : sources,
            ...(options.error ? { error: options.error } : {}),
        }),
    };
}

export function createTestToolRegistry(
    names: readonly ChatToolName[] = TEST_CHAT_TOOL_NAMES,
): ToolRegistry {
    const registry = new ToolRegistry();
    for (const name of names) {
        registry.register(createTestChatToolDefinition({ name }));
    }
    return registry;
}

export function createEmptyInputSchema(): ChatToolInputSchema {
    return {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
    };
}

function getDefaultMetadataForTool(name: ChatToolName): TestChatToolMetadata {
    if (name === "search_memory") {
        return {
            permission: "read-only",
            cost: "ai-calls",
            outputBudgetChars: 8000,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            sourceBoundary: "memory",
        };
    }
    if (name === "get_current_note_context") {
        return {
            permission: "read-only",
            cost: "free",
            outputBudgetChars: 3000,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            sourceBoundary: "current-note",
        };
    }
    return {
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 6000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        sourceBoundary: "read-only-tool",
    };
}

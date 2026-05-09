import type { PluginManager } from "../plugin";
import type { ChatAgentSource, MemorySearchResult } from "./chat-agent";

export type ChatToolName =
    | "search_memory"
    | "get_current_note_context";

export interface ChatToolContext {
    plugin: PluginManager;
    signal?: AbortSignal;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
}

export interface ChatToolResult<Output> {
    ok: boolean;
    tool: string;
    inputSummary: string;
    content: Output | null;
    sources: ChatAgentSource[];
    error?: string;
}

export interface ChatToolDefinition<Input, Output> {
    name: ChatToolName;
    description: string;
    permission: "read-only";
    cost: "free" | "ai-calls";
    outputBudgetChars: number;
    statusMessage(input: Input): string;
    validateInput(input: unknown): Input;
    execute(input: Input, context: ChatToolContext): Promise<ChatToolResult<Output>>;
}

interface RegisteredChatTool {
    name: ChatToolName;
    validateInput(input: unknown): unknown;
    statusMessage(input: unknown): string;
    execute(input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>>;
}

export interface SearchMemoryInput {
    query: string;
}

export class ToolRegistry {
    private readonly tools = new Map<ChatToolName, RegisteredChatTool>();

    register<Input, Output>(definition: ChatToolDefinition<Input, Output>): void {
        this.tools.set(definition.name, definition as unknown as RegisteredChatTool);
    }

    get(name: string): RegisteredChatTool | undefined {
        if (!isChatToolName(name)) return undefined;
        return this.tools.get(name);
    }

    has(name: string): boolean {
        return Boolean(this.get(name));
    }

    async execute(name: string, input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>> {
        throwIfAborted(context.signal);
        const tool = this.get(name);
        if (!tool) {
            context.plugin.log("Chat tool is not registered", { tool: name });
            return createToolFailureResult(name, describeToolInput(input), "Skipped an unavailable read-only tool.");
        }

        let validatedInput: unknown;
        try {
            validatedInput = tool.validateInput(input);
        } catch (error) {
            context.plugin.log("Chat tool input validation failed", { tool: name, error: getErrorMessage(error) });
            return createToolFailureResult(name, describeToolInput(input), "Skipped a read-only tool because its input was invalid.");
        }

        throwIfAborted(context.signal);
        context.onToolRunning?.(name, tool.statusMessage(validatedInput));
        try {
            const result = await tool.execute(validatedInput, context);
            throwIfAborted(context.signal);
            return result;
        } catch (error) {
            if (isAbortError(error, context.signal)) {
                throw error;
            }
            context.plugin.log("Chat tool execution failed", { tool: name, error: getErrorMessage(error) });
            return createToolFailureResult(name, tool.statusMessage(validatedInput), "Read-only tool was unavailable.");
        }
    }
}

export function createSearchMemoryTool(
    executeSearch: (input: SearchMemoryInput, context: ChatToolContext) => Promise<MemorySearchResult>,
): ChatToolDefinition<SearchMemoryInput, MemorySearchResult> {
    return {
        name: "search_memory",
        description: "Search Memory prepared from the user's notes.",
        permission: "read-only",
        cost: "ai-calls",
        outputBudgetChars: 8000,
        statusMessage: (input) => `Searching memory: ${input.query}`,
        validateInput: validateSearchMemoryInput,
        execute: async (input, context) => {
            const result = await executeSearch(input, context);
            return {
                ok: true,
                tool: "search_memory",
                inputSummary: input.query,
                content: result,
                sources: result.sources,
            };
        },
    };
}

export function isSearchMemoryResult(content: unknown): content is MemorySearchResult {
    return Boolean(
        content
        && typeof content === "object"
        && "query" in content
        && "documents" in content
        && "sources" in content,
    );
}

function validateSearchMemoryInput(input: unknown): SearchMemoryInput {
    if (!input || typeof input !== "object") {
        throw new Error("search_memory input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const query = typeof value.query === "string" ? value.query.trim() : "";
    if (!query) {
        throw new Error("search_memory input.query must be a non-empty string.");
    }
    return { query };
}

function isChatToolName(name: string): name is ChatToolName {
    return name === "search_memory" || name === "get_current_note_context";
}

function createToolFailureResult(tool: string, inputSummary: string, error: string): ChatToolResult<unknown> {
    return {
        ok: false,
        tool,
        inputSummary,
        content: null,
        sources: [],
        error,
    };
}

function describeToolInput(input: unknown): string {
    if (typeof input === "string") return input;
    if (!input || typeof input !== "object") return String(input);
    try {
        return JSON.stringify(input);
    } catch {
        return "[unserializable input]";
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
        return true;
    }
    return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw createAbortError();
    }
}

function createAbortError(): Error {
    if (typeof DOMException !== "undefined") {
        return new DOMException("Aborted", "AbortError");
    }
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
}

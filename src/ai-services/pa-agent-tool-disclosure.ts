import type { AgentCapability } from "./capability-types";
import { createChatToolCapability } from "./capability-adapter";
import type {
    ChatToolDefinition,
    ChatToolProviderSchema,
    ChatToolRegistryDefinition,
} from "./chat-tool-types";
import type { PaAgentMessage } from "./chat-types";

export const PA_AGENT_LOAD_TOOLS_TOOL_NAME = "load_tools" as const;

export const PA_AGENT_DIRECT_TOOL_NAMES = [
    "query_notes",
    "read_note",
    "search_memory",
    "get_current_note_context",
    "load_skill",
    "search_vault_metadata",
    "execute_code",
] as const;

const DIRECT_TOOL_NAMES: ReadonlySet<string> = new Set(PA_AGENT_DIRECT_TOOL_NAMES);

export type PaAgentLoadToolsStatus = "loaded" | "already_loaded" | "unavailable";

export interface PaAgentLoadToolsObservation {
    results: Array<{ name: string; status: PaAgentLoadToolsStatus }>;
}

export interface PaAgentToolDisclosureEntry {
    name: string;
    description: string;
}

export interface PaAgentToolDisclosureProjection {
    readonly availableNames: ReadonlySet<string>;
    readonly visibleNames: ReadonlySet<string>;
    readonly deferredNames: ReadonlySet<string>;
    readonly loadedNames: ReadonlySet<string>;
    readonly schemas: readonly ChatToolProviderSchema[];
    readonly definitions: readonly ChatToolRegistryDefinition[];
    readonly directory: readonly PaAgentToolDisclosureEntry[];
    readonly finalAnswerOnly: boolean;
}

export function projectPaAgentToolDisclosure(input: {
    schemas: readonly ChatToolProviderSchema[];
    definitions: readonly ChatToolRegistryDefinition[];
    predisclosedToolNames: readonly string[];
    loadedToolNames: ReadonlySet<string>;
    loaderToolName?: string;
    finalAnswerOnly?: boolean;
}): PaAgentToolDisclosureProjection {
    const availableNames = new Set(input.schemas.map(schema => schema.function.name));
    if (input.finalAnswerOnly) {
        return {
            availableNames,
            visibleNames: new Set<string>(),
            deferredNames: new Set<string>(),
            loadedNames: new Set<string>(),
            schemas: [],
            definitions: [],
            directory: [],
            finalAnswerOnly: true,
        };
    }

    const loaderName = input.loaderToolName;
    const predisclosed = new Set(input.predisclosedToolNames);
    const requested = new Set([
        ...DIRECT_TOOL_NAMES,
        ...predisclosed,
        ...input.loadedToolNames,
    ]);
    const visibleNames = new Set([...availableNames]
        .filter(name => requested.has(name) && name !== loaderName));
    const deferredNames = new Set([...availableNames]
        .filter(name => name !== loaderName && !visibleNames.has(name)));
    if (deferredNames.size > 0 && loaderName && availableNames.has(loaderName)) {
        visibleNames.add(loaderName);
    }

    const definitionsByName = new Map(input.definitions.map(definition => [definition.name, definition]));
    const definitions = [...visibleNames]
        .map(name => definitionsByName.get(name as ChatToolRegistryDefinition["name"]))
        .filter((definition): definition is ChatToolRegistryDefinition => definition !== undefined);
    const schemasByName = new Map(input.schemas.map(schema => [schema.function.name, schema]));
    const schemas = [...visibleNames]
        .map(name => schemasByName.get(name))
        .filter((schema): schema is ChatToolProviderSchema => schema !== undefined);
    const directory = [...deferredNames]
        .map(name => definitionsByName.get(name as ChatToolRegistryDefinition["name"]))
        .filter((definition): definition is ChatToolRegistryDefinition => definition !== undefined)
        .map(definition => ({ name: definition.name, description: definition.description }));

    return {
        availableNames,
        visibleNames,
        deferredNames,
        loadedNames: new Set([...availableNames]
            .filter(name => input.loadedToolNames.has(name))),
        schemas,
        definitions,
        directory,
        finalAnswerOnly: false,
    };
}

export function formatPaAgentToolDisclosureDirectory(
    directory: readonly PaAgentToolDisclosureEntry[],
): string {
    if (!directory.length) return "";
    return [
        "Deferred tools (exact names and short purposes; call load_tools with names to bind their schemas):",
        ...directory.map(entry => `- name: ${entry.name}\n  description: ${entry.description}`),
    ].join("\n");
}

export function createLoadToolsCapability(options: {
    loadedToolNames: Set<string>;
    getDisclosure: () => PaAgentToolDisclosureProjection;
    assertCurrent: (signal?: AbortSignal) => void;
}): AgentCapability {
    type LoadToolsInput = { names: string[] };
    const definition: ChatToolDefinition<LoadToolsInput, PaAgentLoadToolsObservation> = {
        name: PA_AGENT_LOAD_TOOLS_TOOL_NAME,
        description: "Bind exact deferred tool interfaces for the remainder of this run.",
        inputSchema: {
            type: "object",
            properties: {
                names: {
                    type: "array",
                    description: "Exact deferred tool names; each name must be a non-empty string.",
                    items: { type: "string", minLength: 1 },
                },
            },
            required: ["names"],
            additionalProperties: false,
        },
        plannerGuidance: [
            "Use load_tools only after reading the deferred tool directory. Supply exact names in first-requested order; it neither executes a tool nor grants a new permission.",
        ],
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 4000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Loading tool definitions",
        sourceBoundary: "read-only-tool",
        statusMessage: input => `Loading tool definitions: ${input.names.join(", ")}`,
        validateInput: (raw): LoadToolsInput => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                throw new Error("names must be an array");
            }
            if (Object.keys(raw).length !== 1 || !("names" in raw)) {
                throw new Error("input must contain only names");
            }
            const names = (raw as { names?: unknown }).names;
            if (!Array.isArray(names) || names.length === 0) {
                throw new Error("names must be a non-empty array");
            }
            if (names.some(name => typeof name !== "string" || name.length === 0)) {
                throw new Error("every names element must be a non-empty string");
            }
            return { names };
        },
        execute: async (input, context) => {
            options.assertCurrent(context.signal);
            const disclosure = options.getDisclosure();
            const names = [...new Set(input.names)];
            const results = names.map(name => {
                if (!disclosure.availableNames.has(name)) return { name, status: "unavailable" as const };
                if (name === PA_AGENT_LOAD_TOOLS_TOOL_NAME
                    || options.loadedToolNames.has(name)
                    || disclosure.visibleNames.has(name)) return { name, status: "already_loaded" as const };
                options.loadedToolNames.add(name);
                return { name, status: "loaded" as const };
            });
            return {
                ok: true,
                tool: PA_AGENT_LOAD_TOOLS_TOOL_NAME,
                inputSummary: names.join(", "),
                content: { results },
                sources: [],
                sourceRecords: [],
            };
        },
    };
    return createChatToolCapability(definition, { providerId: "pa-agent-tool-disclosure" });
}

type ToolResultMessage = Extract<PaAgentMessage, { role: "toolResult" }>;

export function isClosedLoadToolsResult(
    message: ToolResultMessage,
    isCurrentLoaderResult: (message: ToolResultMessage) => boolean,
): boolean {
    if (!isCurrentLoaderResult(message) || message.isError
        || !message.content.includeInNextPrompt
        || message.content.sourceRecords?.length
        || message.content.contextUsed?.length) return false;
    return isClosedLoadToolsObservationText(message.content.promptText);
}

export function isClosedLoadToolsObservationText(promptText: string): boolean {
    try {
        const observation = JSON.parse(promptText) as PaAgentLoadToolsObservation;
        const results = Array.isArray(observation?.results) ? observation.results
            : Array.isArray((observation as unknown as { observation?: PaAgentLoadToolsObservation }).observation?.results)
                ? (observation as unknown as { observation: PaAgentLoadToolsObservation }).observation.results
                : undefined;
        return Array.isArray(results)
            && results.length > 0
            && results.every(result => result !== null && typeof result === "object"
                && typeof result.name === "string" && result.name.length > 0
                && (result.status === "loaded" || result.status === "already_loaded"
                    || result.status === "unavailable"));
    } catch {
        return false;
    }
}

export function isRejectedLoadToolsResult(
    message: ToolResultMessage,
    isCurrentLoaderResult: (message: ToolResultMessage) => boolean,
): boolean {
    if (!isCurrentLoaderResult(message)) return false;
    const metadata = message.content.metadata;
    const recoveryCode = typeof metadata?.recovery === "object" && metadata.recovery !== null
        ? (metadata.recovery as { code?: unknown }).code : undefined;
    return (message.content.sourceRecords?.length ?? 0) === 0
        && (message.content.contextUsed?.length ?? 0) === 0
        && !message.content.resultFact
        && metadata?.outcome === "schema_invalid"
        && metadata.executionState === "not_started"
        && ((metadata.reason === "input_validation_failed"
            && recoveryCode === "input_validation_failed")
            || (metadata.reason === "invalid_tool_input"
                && recoveryCode === "tool_input_parse_failed"));
}

export function projectLoadToolsExecutionResult<T extends {
    promptText: string;
    sourceRecords?: unknown[];
    contextUsed?: unknown[];
    metadata?: Record<string, unknown>;
}>(result: T, isClosedResult: (result: T) => boolean): T {
    if (!isClosedResult(result)) return result;
    return {
        ...result,
        sourceRecords: [],
        contextUsed: [],
        metadata: {
            ...result.metadata,
            sourceRecordCount: 0,
            contextUsedCount: 0,
            statusOnly: true,
        },
    };
}

export function projectLoadToolsProviderTranscript(
    transcript: readonly PaAgentMessage[],
    isCurrentLoaderResult: (message: ToolResultMessage) => boolean,
): PaAgentMessage[] {
    const rejectionsByAssistantIndex = new Map<number, ToolResultMessage[]>();
    const assistantIndexByCallId = new Map<string, number>();
    for (let messageIndex = 0; messageIndex < transcript.length; messageIndex++) {
        const message = transcript[messageIndex];
        if (message.role === "user") {
            assistantIndexByCallId.clear();
            continue;
        }
        if (message.role === "assistant") {
            assistantIndexByCallId.clear();
            for (const part of message.content) {
                if (part.type !== "toolCall" || !part.id) continue;
                assistantIndexByCallId.set(part.id, assistantIndexByCallId.has(part.id)
                    ? -1 : messageIndex);
            }
            continue;
        }
        if (message.role !== "toolResult" || !isRejectedLoadToolsResult(message, isCurrentLoaderResult)) continue;
        const assistantIndex = assistantIndexByCallId.get(message.toolCallId);
        if (assistantIndex !== undefined && assistantIndex >= 0) {
            const rejections = rejectionsByAssistantIndex.get(assistantIndex) ?? [];
            rejections.push(message);
            rejectionsByAssistantIndex.set(assistantIndex, rejections);
        }
    }
    if (!rejectionsByAssistantIndex.size) return transcript as PaAgentMessage[];
    const rejectedResults = new Set([...rejectionsByAssistantIndex.values()].flat());

    return transcript.map((message, messageIndex) => {
        if (message.role === "assistant") {
            const rejections = rejectionsByAssistantIndex.get(messageIndex);
            if (!rejections) return message;
            let changed = false;
            const content = message.content.map(part => {
                if (part.type !== "toolCall" || !part.id) return part;
                const rejection = rejections.find(candidate => candidate.toolCallId === part.id);
                if (!rejection) return part;
                changed = true;
                const parseFailed = rejection.content.metadata?.reason === "invalid_tool_input";
                return { ...part, input: parseFailed ? undefined : {} };
            });
            return changed ? { ...message, content } : message;
        }
        if (message.role !== "toolResult" || !rejectedResults.has(message)) return message;
        const reason = message.content.metadata?.reason;
        const promptText = reason === "invalid_tool_input"
            ? "输入必须为有效 JSON，请按 schema 修正。"
            : "names 必须为非空的精确工具名称数组，元素必须为非空字符串，请修正后重试。";
        return {
            ...message,
            isError: true,
            content: {
                ...message.content,
                promptText,
                previewText: promptText,
                sourceRecords: [],
                contextUsed: [],
                metadata: {
                    outcome: "schema_invalid",
                    reason,
                    executionState: "not_started",
                    statusOnly: true,
                    recovery: { code: reason === "invalid_tool_input"
                        ? "tool_input_parse_failed" : "input_validation_failed", allowedActions: ["correct_input"] },
                },
            },
        };
    });
}

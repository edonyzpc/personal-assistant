import type { AiServiceHost } from "./AiServiceHost";
import { BUILTIN_WEB_SEARCH_TOOL_NAME } from "./builtin-web-search-provider";
import type { CapabilityRegistry } from "./capability-registry";
import type { AgentCapabilityExecutionMode, AgentRuntimePlatform } from "./capability-types";
import {
    isCurrentNoteContextResult,
    isSearchMemoryResult,
} from "./chat-tools";
import type {
    ChatAgentSource,
    ChatContextUsedItem,
    ChatToolResult,
    MemorySearchResult,
    SourceRecord,
} from "./chat-types";
import type {
    PaAgentToolCall,
    PaAgentToolExecutionInput,
    PaAgentToolExecutionResult,
    PaAgentToolExecutor,
} from "./pa-agent-loop";
import { LOAD_SKILL_TOOL_NAME } from "./skill-context-provider";

const MAX_PREVIEW_CHARS = 1200;

export interface PaAgentCapabilityToolExecutorOptions {
    registry: CapabilityRegistry;
    host: AiServiceHost;
    platform?: AgentRuntimePlatform;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
    allowedToolNames?: ReadonlySet<string>;
    blockedToolNames?: ReadonlySet<string>;
}

export function createPaAgentCapabilityToolExecutor(
    options: PaAgentCapabilityToolExecutorOptions,
): PaAgentToolExecutor {
    return {
        getExecutionMode: (toolName: string): AgentCapabilityExecutionMode | undefined => {
            // pi hybrid dispatch hook: look up the capability's declared executionMode (defaults to undefined
            // ⇒ treated as "parallel" by the loop). Returning "sequential" for any tool forces the whole
            // batch serial. v2.0.0 capabilities are all read-only and omit executionMode; this hook is wired
            // for future write/mutate tools.
            return options.registry.get(toolName)?.executionMode;
        },
        execute: async (input: PaAgentToolExecutionInput): Promise<PaAgentToolExecutionResult> => {
            // SPEC-TCR-04: removed cross-cutting normalizeHostToolCallInput dispatch.
            // Per-tool prepareArguments hooks in chat-tools.ts now handle alias mapping;
            // CapabilityRegistry.prepareAndValidate runs prepareArguments + validateInput.
            // Failure → schema_invalid outcome → HostPolicy corrective turn + answer-completion failed-only path.
            const toolCall = input.toolCall;
            if (!isAllowedHostToolCall(toolCall.name, options.allowedToolNames, options.blockedToolNames)) {
                return {
                    outcome: "policy_rejected",
                    promptText: `Tool ${toolCall.name} was skipped because the user limited this request to different available context.`,
                    previewText: `Skipped ${toolCall.name}; outside the user-requested context scope.`,
                    metadata: {
                        outcome: "policy_rejected",
                        reason: "tool_outside_user_requested_scope",
                    },
                };
            }
            if (toolCall.name === LOAD_SKILL_TOOL_NAME) {
                const disabledRejection = preflightLoadSkill(toolCall, options.host);
                if (disabledRejection) return disabledRejection;
            }
            const preparedResult = options.registry.prepareAndValidate(
                toolCall.name,
                toolCall.input,
                { userInput: input.userInput },
            );
            if (!preparedResult.ok) {
                const message = preparedResult.error.message;
                return {
                    outcome: "schema_invalid",
                    promptText: `Tool ${toolCall.name} input invalid: ${message}. Retry with the correct schema.`,
                    previewText: `Schema validation failed for ${toolCall.name}.`,
                    metadata: {
                        outcome: "schema_invalid",
                        reason: "input_validation_failed",
                        tool: toolCall.name,
                    },
                };
            }
            const result = await options.registry.execute(
                toolCall.name,
                preparedResult.input,
                {
                    host: options.host,
                    turnId: input.turnId,
                    signal: input.signal,
                    platform: options.platform ?? "desktop",
                    onBeforeVssSearch: options.onBeforeVssSearch,
                    onToolRunning: options.onToolRunning,
                },
            );
            const canonicalResult = chatToolResultToPaAgentToolExecutionResult(toolCall, result);
            // Phase 4 preflight metadata: when prepareArguments mutated raw input,
            // record audit fields on toolResult.metadata for Phase B alias-usage analytics
            // and Ops Agent write-tool audit ("model intent vs actual execution" comparison).
            const augmentedMetadata = preparedResult.repaired
                ? {
                    ...(canonicalResult.metadata ?? {}),
                    inputRepaired: true,
                    repairReason: preparedResult.repaired.reason,
                    originalInputSummary: preparedResult.repaired.originalInputSummary,
                    originalInputKeys: preparedResult.repaired.originalKeys,
                }
                : canonicalResult.metadata;
            return {
                ...canonicalResult,
                metadata: augmentedMetadata,
                sourceRecords: canonicalResult.sourceRecords?.map((record) => ({
                    ...record,
                    turnId: record.turnId ?? input.turnId,
                })),
            };
        },
    };
}

/**
 * Tool-name allow/block list gate shared by the chat-runtime executor (this
 * file) and the action-aware wrapper in `pa-agent-runtime.ts`. Returns `true`
 * when the call is permitted; `false` triggers a `policy_rejected` outcome
 * upstream. Both sets are optional — omitting both behaves as "always allow".
 */
export function isAllowedHostToolCall(
    toolName: string,
    allowedToolNames?: ReadonlySet<string>,
    blockedToolNames?: ReadonlySet<string>,
): boolean {
    if (allowedToolNames && !allowedToolNames.has(toolName)) return false;
    if (blockedToolNames?.has(toolName)) return false;
    return true;
}

function preflightLoadSkill(
    toolCall: PaAgentToolCall,
    host: AiServiceHost,
): PaAgentToolExecutionResult | null {
    const settings = host.settings as unknown as Record<string, unknown>;
    const skillContextEnabled = settings.skillContextEnabled !== false;
    const enabledSkillIds = Array.isArray(settings.enabledSkillIds)
        ? (settings.enabledSkillIds as readonly string[])
        : undefined;

    if (!skillContextEnabled) {
        return {
            outcome: "policy_rejected",
            promptText: "load_skill is unavailable because skill guides are disabled in user settings.",
            previewText: "Skipped load_skill; skill guides disabled in settings.",
            metadata: {
                outcome: "policy_rejected",
                reason: "skill_context_disabled",
            },
        };
    }

    if (enabledSkillIds && enabledSkillIds.length === 0) {
        return {
            outcome: "policy_rejected",
            promptText: "load_skill is unavailable because no skills are enabled in user settings.",
            previewText: "Skipped load_skill; no skills enabled.",
            metadata: {
                outcome: "policy_rejected",
                reason: "no_enabled_skills",
            },
        };
    }

    const inputRecord = (toolCall.input && typeof toolCall.input === "object")
        ? (toolCall.input as Record<string, unknown>)
        : {};
    const requestedName = typeof inputRecord.name === "string" ? inputRecord.name.trim() : "";

    if (requestedName && enabledSkillIds && !enabledSkillIds.includes(requestedName)) {
        const enabledList = enabledSkillIds.join(", ");
        return {
            outcome: "policy_rejected",
            promptText: `Skill "${requestedName}" is disabled in user settings. Enabled skills: ${enabledList || "(none)"}.`,
            previewText: `Skipped load_skill("${requestedName}"); not in enabled skill list.`,
            metadata: {
                outcome: "policy_rejected",
                reason: "skill_disabled",
                requestedSkill: requestedName,
            },
        };
    }

    return null;
}

export function chatToolResultToPaAgentToolExecutionResult(
    toolCall: PaAgentToolCall,
    result: ChatToolResult<unknown>,
): PaAgentToolExecutionResult {
    const outcome = result.ok ? "success" : "recoverable_error";
    const promptText = serializeToolObservation(result);
    const sourceRecords = cloneSourceRecords(result.sourceRecords ?? []);
    const contextUsed = buildContextUsed(result, sourceRecords);
    return {
        outcome,
        promptText,
        previewText: truncate(result.error ?? promptText, MAX_PREVIEW_CHARS),
        sourceRecords,
        contextUsed,
        metadata: {
            outcome,
            tool: result.tool,
            toolCallId: toolCall.id,
            inputSummary: result.inputSummary,
            ok: result.ok,
            sourceRecordCount: sourceRecords.length,
            contextUsedCount: contextUsed.length,
            ...getToolResultControlMetadata(result),
        },
    };
}

function getToolResultControlMetadata(result: ChatToolResult<unknown>): Record<string, unknown> {
    if (result.tool !== "search_memory" || !isSearchMemoryResult(result.content)) return {};
    const memory = result.content as MemorySearchResult;
    const documentCount = memory.documents.length;
    const candidateCount = memory.candidates?.length ?? 0;
    const hasAnswerableContent = memory.hasAnswerableContent ?? (memory.usedMemory && documentCount > 0);
    const needsSnippetFollowup = memory.needsSnippetFollowup
        ?? (!hasAnswerableContent && candidateCount > 0);
    return {
        hitCount: documentCount,
        candidateCount,
        hasAnswerableContent,
        needsSnippetFollowup,
    };
}

function serializeToolObservation(result: ChatToolResult<unknown>): string {
    return safeStringify({
        tool: result.tool,
        status: result.ok ? "ok" : "unavailable",
        input: result.inputSummary,
        ...(result.ok ? { observation: result.content } : { error: result.error ?? "Tool unavailable." }),
    });
}

function buildContextUsed(
    result: ChatToolResult<unknown>,
    sourceRecords: SourceRecord[],
): ChatContextUsedItem[] {
    if (!result.ok) {
        return [createUnavailableContextUsed(result)];
    }
    if (result.tool === "search_memory") {
        return [createMemoryContextUsed(result)];
    }
    if (result.tool === "get_current_note_context") {
        return [createCurrentNoteContextUsed(result)];
    }
    if (result.tool === BUILTIN_WEB_SEARCH_TOOL_NAME) {
        return [createWebSearchContextUsed(result, sourceRecords)];
    }
    return [createReadOnlyToolContextUsed(result)];
}

function createMemoryContextUsed(result: ChatToolResult<unknown>): ChatContextUsedItem {
    const memory = isSearchMemoryResult(result.content) ? result.content : undefined;
    const sources = dedupeSources(result.sources);
    const sourceCount = sources.length;
    return {
        category: "memory",
        label: "Selected Memory",
        detail: memory?.skipReason
            ?? (sourceCount === 1 ? "1 selected note" : `${sourceCount} selected notes`),
        sources,
        citationEligible: true,
        ...(sourceCount === 0 ? { statusOnly: true } : {}),
    };
}

function createCurrentNoteContextUsed(result: ChatToolResult<unknown>): ChatContextUsedItem {
    const currentNote = isCurrentNoteContextResult(result.content) ? result.content : undefined;
    return {
        category: "current-note",
        label: "Current note",
        detail: currentNote?.mode
            ? `Read-only current note context (${currentNote.mode})`
            : "Read-only current note context",
        sources: dedupeSources(result.sources),
        citationEligible: false,
    };
}

function createWebSearchContextUsed(
    result: ChatToolResult<unknown>,
    sourceRecords: SourceRecord[],
): ChatContextUsedItem {
    const webSourceCount = sourceRecords.filter((record) => record.kind === "web-source").length;
    return {
        category: "read-only-tool",
        label: "WebSearch",
        detail: webSourceCount === 1 ? "1 normalized web source" : `${webSourceCount} normalized web sources`,
        citationEligible: false,
        ...(webSourceCount === 0 ? { statusOnly: true } : {}),
    };
}

function createReadOnlyToolContextUsed(result: ChatToolResult<unknown>): ChatContextUsedItem {
    const info = getReadOnlyToolContextInfo(result.tool);
    return {
        ...info,
        sources: dedupeSources(result.sources),
        citationEligible: false,
    };
}

function createUnavailableContextUsed(result: ChatToolResult<unknown>): ChatContextUsedItem {
    const info = getReadOnlyToolContextInfo(result.tool);
    return {
        category: "tool-unavailable",
        label: `${info.label} unavailable`,
        detail: result.error ?? "Tool was unavailable for this turn.",
        citationEligible: false,
        statusOnly: true,
    };
}

const READ_ONLY_TOOL_CONTEXT_INFO: Record<string, Pick<ChatContextUsedItem, "category" | "label" | "detail">> = {
    search_memory: {
        category: "memory",
        label: "Selected Memory",
        detail: "Memory search",
    },
    get_current_note_context: {
        category: "current-note",
        label: "Current note",
        detail: "Read-only current note context",
    },
    [BUILTIN_WEB_SEARCH_TOOL_NAME]: {
        category: "read-only-tool",
        label: "WebSearch",
        detail: "External web search",
    },
    search_vault_metadata: {
        category: "vault-metadata",
        label: "Vault metadata",
        detail: "Read-only metadata search results",
    },
    list_recent_notes: {
        category: "recent-notes",
        label: "Recent notes",
        detail: "Read-only recent note list",
    },
    read_note_outline: {
        category: "note-outline",
        label: "Note outline",
        detail: "Read-only note outline",
    },
    inspect_obsidian_note: {
        category: "read-only-tool",
        label: "Note structure",
        detail: "Read-only note structure, links/backlinks, tasks, and properties",
    },
    read_canvas_summary: {
        category: "read-only-tool",
        label: "Canvas structure",
        detail: "Read-only canvas structure",
    },
    search_vault_snippets: {
        category: "read-only-tool",
        label: "Note snippets",
        detail: "Bounded note snippet search results",
    },
    list_vault_tags: {
        category: "read-only-tool",
        label: "Vault tags",
        detail: "Read-only vault tag counts",
    },
};

function getReadOnlyToolContextInfo(
    tool: string,
): Pick<ChatContextUsedItem, "category" | "label" | "detail"> {
    return READ_ONLY_TOOL_CONTEXT_INFO[tool] ?? {
        category: "read-only-tool",
        label: "Read-only tool",
        detail: `${tool} output`,
    };
}

function dedupeSources(sources: readonly ChatAgentSource[]): ChatAgentSource[] {
    const seen = new Set<string>();
    const result: ChatAgentSource[] = [];
    for (const source of sources) {
        if (!source.path) continue;
        const key = `${source.path}:${source.chunkIndex ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ ...source });
    }
    return result;
}

function cloneSourceRecords(records: readonly SourceRecord[]): SourceRecord[] {
    return records.map((record) => ({
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
    }));
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

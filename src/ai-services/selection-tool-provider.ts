/**
 * Replace Selection Tool Provider — Operations Agent mode capability provider.
 *
 * Registers `replace_selection` only when Operations Agent mode is enabled.
 * Until replace-selection is wired through the Write Action Framework, direct
 * execution remains disabled so no caller can bypass the write gates.
 */

import type {
    AgentCapability,
    AgentCapabilityResult,
    AgentCapabilitySourceBoundary,
    AgentSourceRecordKind,
    CapabilityProvider,
    PrepareCapabilityArgumentsContext,
    PrepareCapabilityArgumentsResult,
    ProviderLoadContext,
    ProviderLoadResult,
} from "./capability-types";
import type {
    ChatToolInputSchema,
    ChatToolName,
    ChatToolProviderSchema,
    ChatToolRegistryDefinition,
} from "./chat-tools";
import { OPERATIONS_AGENT_RUNTIME_ENABLED } from "../operations-agent-flags";

export const SELECTION_TOOL_PROVIDER_ID = "selection-tool";
export const REPLACE_SELECTION_TOOL_NAME = "replace_selection" as ChatToolName;

interface ReplaceSelectionInput {
    replacement: string;
}

function toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeReplaceSelectionInput(raw: unknown): ReplaceSelectionInput {
    if (typeof raw === "string" && raw.trim().length > 0) {
        return { replacement: raw };
    }
    const record = toRecord(raw);
    const replacement = record
        ? record.replacement ?? record.text ?? record.content ?? record.markdown
        : undefined;
    if (typeof replacement !== "string" || replacement.length === 0) {
        throw new Error("replace_selection requires a non-empty replacement string.");
    }
    return { replacement };
}

export class SelectionToolProvider implements CapabilityProvider {
    readonly id = SELECTION_TOOL_PROVIDER_ID;
    readonly displayName = "Selection Tools";
    readonly required = false;
    readonly kind = "tool-provider" as const;
    readonly platform = "both" as const;

    async load(context: ProviderLoadContext): Promise<ProviderLoadResult> {
        const operationsAgentEnabled = OPERATIONS_AGENT_RUNTIME_ENABLED && context.settings.operationsAgentEnabled === true;
        if (!operationsAgentEnabled) {
            return {
                status: "unavailable",
                capabilities: [],
                unavailableReason: "Operations Agent mode is not enabled.",
            };
        }

        return {
            status: "available",
            capabilities: [new ReplaceSelectionCapability()],
        };
    }
}

class ReplaceSelectionCapability implements AgentCapability {
    readonly name: ChatToolName = REPLACE_SELECTION_TOOL_NAME;
    readonly description =
        "Replace the currently selected text in the active Markdown note. " +
        "Use only when the user asks to rewrite, simplify, translate, or otherwise replace selected text.";
    readonly inputSchema: ChatToolInputSchema = {
        type: "object",
        properties: {
            replacement: {
                type: "string",
                description: "Replacement Markdown text for the current editor selection.",
            },
        },
        required: ["replacement"],
        additionalProperties: false,
    };
    readonly plannerGuidance = [
        "Use replace_selection only when the user explicitly asks to replace selected text.",
        "Never call replace_selection unless get_current_note_context reported a non-empty selection in this turn.",
        "The target is always the active editor selection; do not ask for or invent a path.",
    ];
    readonly kind = "action" as const;
    readonly origin = "core" as const;
    readonly providerId = SELECTION_TOOL_PROVIDER_ID;
    readonly permission = "local-filesystem-write" as const;
    readonly sourceBoundary: AgentCapabilitySourceBoundary = "vault";
    readonly cost = "free" as const;
    readonly tier = "paid" as const;
    readonly platform = "both" as const;
    readonly outputBudgetChars = 1_000;
    readonly timeoutMs = 30_000;
    readonly requiresConfirmation = true;
    readonly failureBehavior = "recoverable" as const;
    readonly statusMessageText = "Replacing selected text...";
    readonly sourceRecordKind: AgentSourceRecordKind = "context-used";
    readonly executionMode = "sequential" as const;

    toProviderSchema(): ChatToolProviderSchema {
        return {
            type: "function",
            function: {
                name: this.name,
                description: this.description,
                parameters: this.inputSchema,
            },
        };
    }

    toRegistryDefinition(): ChatToolRegistryDefinition {
        return {
            name: this.name,
            description: this.description,
            inputSchema: this.inputSchema,
            plannerGuidance: [...this.plannerGuidance],
            permission: "read-only",
            cost: this.cost,
            outputBudgetChars: this.outputBudgetChars,
            requiresConfirmation: this.requiresConfirmation,
            failureBehavior: this.failureBehavior,
            statusMessage: this.statusMessageText,
            sourceBoundary: "read-only-tool",
        };
    }

    prepareAndValidate(
        raw: unknown,
        _ctx: PrepareCapabilityArgumentsContext,
    ): PrepareCapabilityArgumentsResult {
        try {
            return { ok: true, input: normalizeReplaceSelectionInput(raw) };
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    async execute(input: unknown): Promise<AgentCapabilityResult> {
        try {
            normalizeReplaceSelectionInput(input);
        } catch (error) {
            return this.failure(error instanceof Error ? error.message : String(error));
        }
        return this.failure(
            "replace_selection must be executed through the Write Action Framework pipeline before it can modify the active selection.",
        );
    }

    private failure(message: string): AgentCapabilityResult {
        return {
            status: "failed",
            observation: null,
            sourceRecords: [],
            inputSummary: "replace active selection",
            sources: [],
            error: message,
            userSafeMessage: message,
        };
    }
}

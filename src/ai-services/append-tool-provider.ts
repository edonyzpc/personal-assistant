/**
 * Append Tool Provider — Operations Agent mode capability provider.
 *
 * Registers the "append_to_current_note" tool capability with the capability
 * registry. Only active when `operationsAgentEnabled` is true in settings.
 *
 * The tool delegates to the Write Action Framework's append action family,
 * which enforces all 4 gates (target-confinement → preview-confirmation →
 * stale-reread → executeWrite) before any content is written.
 */

import type {
    AgentCapability,
    AgentCapabilityContext,
    AgentCapabilityResult,
    AgentCapabilitySourceBoundary,
    AgentSourceRecordKind,
    CapabilityProvider,
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
import { validateAppendConfinement } from "./write-action-framework/target-confinement";

export const APPEND_TOOL_PROVIDER_ID = "append-tool";
export const APPEND_TOOL_NAME = "append_to_current_note" as ChatToolName;

export class AppendToolProvider implements CapabilityProvider {
    readonly id = APPEND_TOOL_PROVIDER_ID;
    readonly displayName = "Append to Current Note";
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
            capabilities: [new AppendToCurrentNoteCapability()],
        };
    }
}

class AppendToCurrentNoteCapability implements AgentCapability {
    readonly name: ChatToolName = APPEND_TOOL_NAME;
    readonly description =
        "Append content to the end of the currently active note. " +
        "The target is the user's active file — not a path from the conversation. " +
        "Content is appended after a boundary marker for traceability.";
    readonly inputSchema: ChatToolInputSchema = {
        type: "object",
        properties: {
            content: {
                type: "string",
                description:
                    "The markdown content to append to the current note. " +
                    "Maximum 50,000 characters.",
            },
        },
        required: ["content"],
        additionalProperties: false,
    };
    readonly plannerGuidance = [
        "Use append_to_current_note ONLY when the user explicitly asks to add content to their current note.",
        "The target is always the user's active file — never specify a path.",
        "Content is appended at the end of the file with a boundary marker.",
        "Requires user confirmation via a preview modal before writing.",
    ];
    readonly kind = "action" as const;
    readonly origin = "core" as const;
    readonly providerId = APPEND_TOOL_PROVIDER_ID;
    readonly permission = "local-filesystem-write" as const;
    readonly sourceBoundary: AgentCapabilitySourceBoundary = "vault";
    readonly cost = "free" as const;
    readonly tier = "paid" as const;
    readonly platform = "both" as const;
    readonly outputBudgetChars = 1_000;
    readonly timeoutMs = 30_000;
    readonly requiresConfirmation = true;
    readonly failureBehavior = "recoverable" as const;
    readonly statusMessageText = "Appending to current note...";
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
        // Registry definition uses "read-only" permission/sourceBoundary intentionally:
        // the registry's permission field gates which tools the LLM can *discover*,
        // not what they can *do*. Actual write permission is enforced by the
        // PolicyEngine (this.permission = "local-filesystem-write") and the
        // ActionExecutor 4-gate pipeline, not the registry definition.
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

    async execute(input: unknown, context: AgentCapabilityContext): Promise<AgentCapabilityResult> {
        // WriteActionCapability.execute() MUST throw per framework SDD §3.2.
        // All writes go through the ActionExecutor's 4-gate pipeline.
        // This method exists only to satisfy the AgentCapability interface;
        // the real write path is via the WriteActionCapability adapter that
        // the framework ActionExecutor drives.
        //
        // For now, validate the active file confinement and return a
        // descriptive error directing callers to use the framework pipeline.
        const activeFile = context.host?.app?.workspace?.getActiveFile?.() ?? null;
        const confinement = validateAppendConfinement(activeFile);
        if (!confinement.valid) {
            return {
                status: "failed",
                observation: null,
                sourceRecords: [],
                inputSummary: "append_to_current_note",
                sources: [],
                error: confinement.reason,
                userSafeMessage: confinement.reason,
            };
        }

        return {
            status: "failed",
            observation: null,
            sourceRecords: [],
            inputSummary: "append_to_current_note",
            sources: [],
            error: "append_to_current_note must be executed through the Write Action Framework pipeline (ActionExecutor).",
            userSafeMessage: "This action requires the Write Action Framework pipeline.",
        };
    }
}

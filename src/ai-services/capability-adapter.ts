import type {
    AgentCapability,
    AgentCapabilityContext,
    AgentCapabilityResult,
    AgentCapabilitySourceBoundary,
    AgentCapabilityCost,
    AgentPermissionV1,
    AgentSourceRecordKind,
    PrepareCapabilityArgumentsContext,
    PrepareCapabilityArgumentsResult,
    SourceRecord,
} from "./capability-types";
import type {
    ChatToolContext,
    ChatToolDefinition,
    ChatToolFailureBehavior,
    ChatToolInputSchema,
    ChatToolName,
    ChatToolProviderSchema,
    ChatToolRegistryDefinition,
    ChatToolResult,
    ChatToolSourceBoundary,
} from "./chat-tools";
import {
    assertObsidianOperationsV1AToolPolicy,
    buildPrepareRepairInfo,
    enforceToolOutputBudget,
    sanitizeToolErrorMessage,
    summarizeInvalidToolInput,
} from "./chat-tool-registry";
import { createToolFailureResult } from "./chat-tool-execution-helpers";
import { createAbortError, isAbortError, throwIfAborted } from "./chat-utils";
import { getErrorType } from "./agent-utils";
import type { ChatAgentSource } from "./chat-types";
import { createSourceDedupKey } from "./source-store";

export interface ChatToolCapabilityAdapterOptions {
    providerId: string;
    origin?: AgentCapability["origin"];
    platform?: AgentCapability["platform"];
    timeoutMs?: number;
    execute: (input: unknown, context: AgentCapabilityContext) => Promise<ChatToolResult<unknown>>;
    /**
     * Pre-validation pipeline (prepareArguments → validateInput → repair-info detection).
     * Bound by `createChatToolCapability` to bridge `ChatToolDefinition` into the capability.
     * If omitted, the capability has no prepareAndValidate (CapabilityRegistry passes raw input through).
     */
    prepareAndValidate?: (raw: unknown, ctx: PrepareCapabilityArgumentsContext) => PrepareCapabilityArgumentsResult;
}

export function createCapabilityFromChatToolDefinition(
    definition: ChatToolRegistryDefinition,
    options: ChatToolCapabilityAdapterOptions,
): AgentCapability {
    return new ChatToolCapability(definition, options);
}

export function chatToolResultToAgentCapabilityResult(
    definition: Pick<ChatToolRegistryDefinition, "name" | "sourceBoundary">,
    providerId: string,
    result: ChatToolResult<unknown>,
): AgentCapabilityResult {
    return {
        status: result.ok ? "ok" : "unavailable",
        observation: result.content,
        inputSummary: result.inputSummary,
        sources: result.sources,
        sourceRecords: chatSourcesToSourceRecords(
            result.sources,
            definition.name,
            providerId,
            definition.sourceBoundary,
        ),
        ...(result.error ? {
            error: result.error,
            unavailableReason: result.error,
            userSafeMessage: result.error,
        } : {}),
    };
}

function chatSourcesToSourceRecords(
    sources: readonly ChatAgentSource[],
    capabilityName: string,
    providerId: string,
    sourceBoundary: AgentCapabilitySourceBoundary,
): SourceRecord[] {
    return sources.map((source) => ({
        kind: sourceBoundaryToSourceRecordKind(sourceBoundary),
        dedupKey: createSourceDedupKey(source.path),
        capabilityName,
        providerId,
        sourceBoundary,
        path: source.path,
        chunkIndex: source.chunkIndex,
        score: source.score,
        citationEligible: sourceBoundary === "memory",
    }));
}

function sourceBoundaryToSourceRecordKind(
    sourceBoundary: AgentCapabilitySourceBoundary,
): AgentSourceRecordKind {
    if (sourceBoundary === "memory") return "memory-reference";
    if (sourceBoundary === "web") return "web-source";
    if (sourceBoundary === "skill-context") return "skill-guide";
    return "context-used";
}

class ChatToolCapability implements AgentCapability {
    readonly name: ChatToolName;
    readonly description: string;
    readonly inputSchema: ChatToolInputSchema;
    readonly plannerGuidance: string[];
    readonly kind = "tool" as const;
    readonly origin: AgentCapability["origin"];
    readonly providerId: string;
    readonly permission: AgentPermissionV1;
    readonly sourceBoundary: ChatToolSourceBoundary;
    readonly cost: AgentCapabilityCost;
    readonly platform: AgentCapability["platform"];
    readonly outputBudgetChars: number;
    readonly timeoutMs: number;
    readonly requiresConfirmation: boolean;
    readonly failureBehavior: ChatToolFailureBehavior;
    readonly statusMessageText: string;
    readonly sourceRecordKind: AgentSourceRecordKind;
    private readonly definition: ChatToolRegistryDefinition;
    private readonly executeLegacyTool: ChatToolCapabilityAdapterOptions["execute"];
    private readonly prepareAndValidateImpl?: ChatToolCapabilityAdapterOptions["prepareAndValidate"];

    constructor(
        definition: ChatToolRegistryDefinition,
        options: ChatToolCapabilityAdapterOptions,
    ) {
        this.definition = cloneRegistryDefinition(definition);
        this.name = definition.name;
        this.description = definition.description;
        this.inputSchema = cloneInputSchema(definition.inputSchema);
        this.plannerGuidance = [...definition.plannerGuidance];
        this.origin = options.origin ?? "core";
        this.providerId = options.providerId;
        this.permission = definition.permission;
        this.sourceBoundary = definition.sourceBoundary;
        this.cost = definition.cost;
        this.platform = options.platform ?? "both";
        this.outputBudgetChars = definition.outputBudgetChars;
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.requiresConfirmation = definition.requiresConfirmation;
        this.failureBehavior = definition.failureBehavior;
        this.statusMessageText = definition.statusMessage;
        this.sourceRecordKind = sourceBoundaryToSourceRecordKind(definition.sourceBoundary);
        this.executeLegacyTool = options.execute;
        this.prepareAndValidateImpl = options.prepareAndValidate;
    }

    prepareAndValidate(raw: unknown, ctx: PrepareCapabilityArgumentsContext): PrepareCapabilityArgumentsResult {
        if (!this.prepareAndValidateImpl) return { ok: true, input: raw };
        return this.prepareAndValidateImpl(raw, ctx);
    }

    toProviderSchema(): ChatToolProviderSchema {
        return {
            type: "function",
            function: {
                name: this.name,
                description: this.description,
                parameters: cloneInputSchema(this.inputSchema),
            },
        };
    }

    toRegistryDefinition(): ChatToolRegistryDefinition {
        return cloneRegistryDefinition(this.definition);
    }

    async execute(input: unknown, context: AgentCapabilityContext): Promise<AgentCapabilityResult> {
        const result = await this.executeLegacyTool(input, context);
        return chatToolResultToAgentCapabilityResult(this.definition, this.providerId, result);
    }
}

function cloneRegistryDefinition(definition: ChatToolRegistryDefinition): ChatToolRegistryDefinition {
    return {
        ...definition,
        inputSchema: cloneInputSchema(definition.inputSchema),
        plannerGuidance: [...definition.plannerGuidance],
    };
}

function cloneInputSchema(schema: ChatToolInputSchema): ChatToolInputSchema {
    return {
        ...schema,
        properties: Object.fromEntries(Object.entries(schema.properties).map(([name, property]) => [
            name,
            { ...property, enum: property.enum ? [...property.enum] : undefined },
        ])),
        required: schema.required ? [...schema.required] : undefined,
    };
}

/**
 * Wrap a `ChatToolDefinition` directly into an `AgentCapability` (kind: "tool"),
 * collapsing the legacy `ToolRegistry` + `CoreToolProvider` middle layers (SPEC-A5).
 *
 * Responsibilities (subsumed from chat-tool-registry.ts ToolRegistry):
 * - register-time: assertObsidianOperationsV1AToolPolicy
 * - prepareAndValidate: prepareArguments → validateInput → repair-info detection
 * - execute: emit onToolRunning(statusMessage) → run definition.execute → enforce output budget
 *   → recover from non-abort errors via createToolFailureResult; re-throw AbortError on abort
 */
export function createChatToolCapability<Input, Output>(
    definition: ChatToolDefinition<Input, Output>,
    options: {
        providerId: string;
        origin?: AgentCapability["origin"];
        platform?: AgentCapability["platform"];
        timeoutMs?: number;
    },
): AgentCapability {
    assertObsidianOperationsV1AToolPolicy(definition);

    const registryDef: ChatToolRegistryDefinition = {
        name: definition.name,
        description: definition.description,
        inputSchema: cloneInputSchema(definition.inputSchema),
        plannerGuidance: [...definition.plannerGuidance],
        permission: definition.permission,
        cost: definition.cost,
        outputBudgetChars: definition.outputBudgetChars,
        requiresConfirmation: definition.requiresConfirmation,
        failureBehavior: definition.failureBehavior,
        statusMessage: definition.statusMessageText,
        sourceBoundary: definition.sourceBoundary,
    };

    return createCapabilityFromChatToolDefinition(registryDef, {
        providerId: options.providerId,
        origin: options.origin,
        platform: options.platform,
        timeoutMs: options.timeoutMs,
        prepareAndValidate: (raw, ctx) => {
            try {
                const prepared = definition.prepareArguments
                    ? definition.prepareArguments(raw, ctx)
                    : raw;
                definition.validateInput(prepared);
                const repaired = buildPrepareRepairInfo(raw, prepared);
                return repaired
                    ? { ok: true, input: prepared, repaired }
                    : { ok: true, input: prepared };
            } catch (error) {
                return {
                    ok: false,
                    error: error instanceof Error ? error : new Error(String(error)),
                };
            }
        },
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            // ToolRegistry.execute parity: when invoked directly without going through
            // CapabilityRegistry.prepareAndValidate first, surface validateInput errors
            // as ChatToolResult.error rather than letting bad input crash inside execute.
            // Tests covering rejected paths (e.g. obsidian-operations-tools "rejects malformed
            // note inspection input instead of falling back to the active note") rely on
            // this exact error message.
            let validatedInput: Input;
            try {
                validatedInput = definition.validateInput(input);
            } catch (error) {
                context.host.log("Chat tool input validation failed", {
                    tool: definition.name,
                    errorType: getErrorType(error),
                });
                return createToolFailureResult(
                    definition.name,
                    summarizeInvalidToolInput(input),
                    sanitizeToolErrorMessage(error, "Skipped a read-only tool because its input was invalid."),
                );
            }
            try {
                const message = definition.statusMessage(validatedInput);
                context.onToolRunning?.(definition.name, message);
            } catch {
                // statusMessage callbacks should not throw; ignore defensively.
            }
            const chatContext: ChatToolContext = {
                host: context.host,
                signal: context.signal,
                onBeforeVssSearch: context.onBeforeVssSearch,
                onToolRunning: context.onToolRunning,
            };
            try {
                const result = await definition.execute(validatedInput, chatContext);
                throwIfAborted(context.signal);
                return enforceToolOutputBudget(registryDef, result);
            } catch (error) {
                if (isAbortError(error, context.signal)) {
                    throw context.signal?.aborted ? createAbortError() : error;
                }
                context.host.log("Chat tool execution failed", {
                    tool: definition.name,
                    errorType: getErrorType(error),
                });
                return createToolFailureResult(
                    definition.name,
                    "execution failed",
                    "Read-only tool was unavailable.",
                );
            }
        },
    });
}

/**
 * Factory bundle for the 9 core read-only capabilities, formerly produced
 * via `CoreToolProvider`. Direct entry point used by PaAgentRuntime in Phase B,
 * and the canonical replacement after `core-tool-provider.ts` is removed in Phase C.
 *
 * The `factories` argument erases each core factory's concrete Input/Output
 * generics at the bundle boundary. Each wrapped tool still validates raw
 * model input through its own `validateInput` implementation before execution.
 */
type BivariantInputMethod<Return> = {
    bivarianceHack(input: unknown): Return;
}["bivarianceHack"];
type BivariantExecuteMethod = {
    bivarianceHack(input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>>;
}["bivarianceHack"];
type AnyChatToolDefinition = Omit<ChatToolDefinition<unknown, unknown>, "statusMessage" | "execute"> & {
    statusMessage: BivariantInputMethod<string>;
    execute: BivariantExecuteMethod;
};

export function createCoreToolCapabilities(
    factories: readonly AnyChatToolDefinition[],
    options: { providerId?: string; origin?: AgentCapability["origin"]; platform?: AgentCapability["platform"] } = {},
): AgentCapability[] {
    const providerId = options.providerId ?? "core-tools";
    return factories.map((definition) => createChatToolCapability(definition, {
        providerId,
        origin: options.origin ?? "core",
        platform: options.platform ?? "both",
    }));
}

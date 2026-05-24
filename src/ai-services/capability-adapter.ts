import type {
    AgentCapability,
    AgentCapabilityContext,
    AgentCapabilityResult,
    AgentCapabilitySourceBoundary,
    AgentCapabilityCost,
    AgentPermissionV1,
    AgentSourceRecordKind,
    SourceRecord,
} from "./capability-types";
import type {
    ChatToolCost,
    ChatToolFailureBehavior,
    ChatToolInputSchema,
    ChatToolName,
    ChatToolProviderSchema,
    ChatToolRegistryDefinition,
    ChatToolResult,
    ChatToolSourceBoundary,
} from "./chat-tools";
import type { ChatAgentSource } from "./chat-types";
import { createSourceDedupKey } from "./source-store";

export interface ChatToolCapabilityAdapterOptions {
    providerId: string;
    origin?: AgentCapability["origin"];
    platform?: AgentCapability["platform"];
    timeoutMs?: number;
    execute: (input: unknown, context: AgentCapabilityContext) => Promise<ChatToolResult<unknown>>;
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

export function chatSourcesToSourceRecords(
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

export function sourceBoundaryToSourceRecordKind(
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

export function toAgentPermission(permission: ChatToolRegistryDefinition["permission"]): AgentPermissionV1 {
    return permission;
}

export function toAgentCost(cost: ChatToolCost): AgentCapabilityCost {
    return cost;
}

import type { PluginManager } from "../plugin";
import type {
    SourceRecord,
    SourceRecordBoundary,
    SourceRecordKind,
} from "./chat-types";
import type {
    ChatToolCost,
    ChatToolFailureBehavior,
    ChatToolInputSchema,
    ChatToolName,
    ChatToolPermission,
    ChatToolProviderSchema,
    ChatToolRegistryDefinition,
    ChatToolResult,
    ChatToolSourceBoundary,
} from "./chat-tools";
import type { ChatAgentSource } from "./chat-types";

export type AgentCapabilityKind = "tool" | "context" | "action";
export type AgentCapabilityOrigin = "core" | "builtin-mcp" | "skill";
export type AgentPermissionV1 = ChatToolPermission | "network-read";
export type AgentPermissionFuture = "write" | "local-script" | "shell" | "stdio-mcp";
export type AgentPermission = AgentPermissionV1 | AgentPermissionFuture;
export type AgentCapabilityCost = ChatToolCost | "network-calls";
export type AgentPlatformSupport = "desktop" | "mobile" | "both";
export type AgentRuntimePlatform = "desktop" | "mobile";
export type AgentSourceRecordKind = SourceRecordKind;

export interface AgentNetworkPolicy {
    transport: "streamable-http";
    allowedEndpoints: string[];
    authKeyId: string;
    redactHeaders: string[];
    redactQueryParams: string[];
    maxResponseBytes: number;
    maxCallsPerTurn: number;
    maxCallsPerMinute?: number;
}

export type { SourceRecord };

export type AgentCapabilitySourceBoundary =
    | ChatToolSourceBoundary
    | Extract<SourceRecordBoundary, "vault" | "web" | "skill-context">;

export interface AgentCapabilityContext {
    plugin: PluginManager;
    turnId?: string;
    signal?: AbortSignal;
    platform?: AgentRuntimePlatform;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
}

export interface AgentCapabilityResult {
    status: "ok" | "unavailable" | "failed";
    observation: unknown;
    sourceRecords: SourceRecord[];
    inputSummary: string;
    sources: ChatAgentSource[];
    error?: string;
    truncated?: boolean;
    omittedCount?: number;
    unavailableReason?: string;
    userSafeMessage?: string;
}

export interface PrepareCapabilityArgumentsContext {
    userInput: string;
}

/**
 * Phase 4 preflight metadata: when prepareArguments mutates the raw input,
 * `repaired` carries audit info so toolResult.metadata can record the change.
 * Detection is automatic via deepEqualJson (CapabilityRegistry.prepareAndValidate
 * compares prepared !== raw).
 */
export interface PrepareCapabilityArgumentsRepair {
    /** Comma-joined top-level keys of the raw input (e.g., "q,limit") for Phase B alias-usage analytics. */
    originalKeys: string;
    /** Length-bounded JSON.stringify of raw input for audit replay. */
    originalInputSummary: string;
    /** Short human-readable reason; Phase A path B uses a generic "alias mapping or normalization applied". */
    reason: string;
}

export type PrepareCapabilityArgumentsResult =
    | { ok: true; input: unknown; repaired?: PrepareCapabilityArgumentsRepair }
    | { ok: false; error: Error };

export interface AgentCapability {
    name: ChatToolName;
    description: string;
    inputSchema: ChatToolInputSchema;
    plannerGuidance: string[];
    kind: AgentCapabilityKind;
    origin: AgentCapabilityOrigin;
    providerId: string;
    permission: AgentPermission;
    sourceBoundary: AgentCapabilitySourceBoundary;
    cost: AgentCapabilityCost;
    platform: AgentPlatformSupport;
    outputBudgetChars: number;
    timeoutMs: number;
    requiresConfirmation: boolean;
    failureBehavior: ChatToolFailureBehavior;
    statusMessageText: string;
    sourceRecordKind: AgentSourceRecordKind;
    networkPolicy?: AgentNetworkPolicy;
    toProviderSchema(): ChatToolProviderSchema;
    toRegistryDefinition(): ChatToolRegistryDefinition;
    /**
     * Pre-validation pipeline (pi-style). Runs the optional per-tool prepareArguments
     * hook (alias mapping) then validateInput. Failure → caller converts to schema_invalid
     * outcome BEFORE execute, bypassing ChatToolResult's recoverable_error flattening.
     * Capabilities without per-tool validation (e.g., context capabilities) may omit this.
     */
    prepareAndValidate?(raw: unknown, ctx: PrepareCapabilityArgumentsContext): PrepareCapabilityArgumentsResult;
    execute(input: unknown, context: AgentCapabilityContext): Promise<AgentCapabilityResult>;
}

export type CapabilityProviderKind = "tool-provider" | "context-provider";

export interface ProviderLoadContext {
    turnId: string;
    platform: AgentRuntimePlatform;
    settings: Record<string, unknown>;
    signal?: AbortSignal;
}

export interface ProviderLoadResult {
    status: "available" | "unavailable";
    capabilities: AgentCapability[];
    unavailableReason?: string;
    diagnostics?: Record<string, unknown>;
}

export interface CapabilityProvider {
    id: string;
    displayName: string;
    required: boolean;
    kind: CapabilityProviderKind;
    platform: AgentPlatformSupport;
    load(context: ProviderLoadContext): Promise<ProviderLoadResult>;
    execute?(name: string, input: unknown, context: AgentCapabilityContext): Promise<AgentCapabilityResult>;
}

export type CapabilityEventStatus = "invoked" | "failed" | "skipped" | "unavailable";

export interface CapabilityUsageEvent {
    capabilityName: string;
    providerId: string;
    status: CapabilityEventStatus;
    durationMs: number;
}

export interface CapabilityDiagnostic {
    type: "duplicate" | "policy";
    capabilityName: string;
    providerId: string;
    reason: string;
}

export function agentResultToChatToolResult(
    capabilityName: string,
    result: AgentCapabilityResult,
): ChatToolResult<unknown> {
    return {
        ok: result.status === "ok",
        tool: capabilityName,
        inputSummary: result.inputSummary,
        content: result.status === "ok" ? result.observation : null,
        sources: result.sources,
        sourceRecords: result.sourceRecords,
        ...(result.userSafeMessage ?? result.error ? { error: result.userSafeMessage ?? result.error } : {}),
    };
}

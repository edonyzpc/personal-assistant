import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from "@langchain/core/prompts";

import type {
    AIUtils,
    NativeToolCallingValidation,
    QwenRequestOptions,
} from "./ai-utils";
import type { AiServiceHost, RetrievalOptimizationFlags } from "./AiServiceHost";
import type { MemoryMode } from "../memory-manager";
import { resolveB125RetrievalOptimizationFlags } from "../retrieval-optimization-platform-policy";
import type { PageletChatHandoffContext } from "./pagelet-handoff";
import { MemorySearchTool } from "./memory-search-tool";
import {
    captureExplicitTemporalIntent,
    ChatMemoryRecoveryCoordinator,
} from "./retrieval-recovery-coordinator";
import type { RetrievalDiagnosticEventInput } from "./retrieval-diagnostics";
import {
    createPaAgentAnswerStreamPrompt,
    createOperationsPromptGuidance,
    formatCanonicalHostContext,
    formatSkillCatalog,
    formatToolObservations,
} from "./pa-agent-prompts";
import {
    type ChatToolProviderSchema,
    isInspectObsidianNoteResult,
    isObsidianOperationsV1AToolName,
    isListRecentNotesResult,
    isReadCanvasSummaryResult,
    isReadNoteOutlineResult,
    isSearchVaultMetadataResult,
    isVaultSnippetSearchResult,
    isVaultTagsResult,
    createCurrentNoteContextTool,
    createInspectObsidianNoteTool,
    createListRecentNotesTool,
    createListVaultTagsTool,
    createReadCanvasSummaryTool,
    createReadNoteOutlineTool,
    createSearchMemoryTool,
    createSearchVaultMetadataTool,
    createSearchVaultSnippetsTool,
    type ChatToolRegistryDefinition,
} from "./chat-tools";
import {
    AgentEventEmitter,
} from "./agent-runtime-primitives";
import { CanonicalToLegacyEventAdapter } from "./pa-agent-stream-bridge";
import { BUNDLED_SKILL_RESOURCES } from "./bundled-skills";
import { CapabilityRegistry } from "./capability-registry";
import { createCoreToolCapabilities } from "./capability-adapter";
import {
    agentResultToChatToolResult,
    type AgentCapability,
    type AgentCapabilityContext,
    type AgentRuntimePlatform,
    type CapabilityProvider,
} from "./capability-types";
import {
    PolicyEngine,
    type CapabilityPolicyDecision,
    type PolicyEngineOptions,
} from "./policy-engine";
import { createAbortError, isAbortError, throwIfAborted } from "./chat-utils";
import {
    createProviderRequestScope,
    type ProviderRequestScope,
} from "./obsidian-fetch";
import { errorMessage } from "./agent-utils";
import { LOAD_SKILL_TOOL_NAME, SkillContextProvider } from "./skill-context-provider";
import { OperationsToolProvider } from "./operations/operations-tool-provider";
import {
    createOperationsStagingToolExecutor,
    type OperationsIntentStager,
} from "./operations/operations-tool-executor";
import { CORE_WRITE_TOOL_NAMES } from "./operations/types";
import {
    chatToolResultToPaAgentToolExecutionResult,
    createPaAgentCapabilityToolExecutor,
    isAllowedHostToolCall,
    MemoryEvidenceRegistry,
} from "./pa-agent-host-tools";
import {
    ConsoleDebugObserver,
    createActionExecutor,
    createSelfWriteRegistry,
    NOOP_DEBUG_OBSERVER,
    type ActionExecutor,
    type DebugObserver,
    type FsProbe,
    type PreviewRenderer,
    type SelfWriteRegistry,
    type WriteActionCapability,
} from "./write-action-framework";
import {
    applyUserExplicitCapabilityConstraints,
    createRequiredCapabilityHostPolicy,
    getExplicitlySuppressedRequiredCapabilities,
    isExplicitCurrentNoteOnlyRequest,
    resolveRequiredCapabilityClassification,
    type RequiredCapabilityClassifier,
    type RequiredCapability,
} from "./pa-agent-required-capability-policy";
import {
    PaAgentLoop,
    type PaAgentLoopResult,
    type PaAgentModel,
    type PaAgentModelInput,
    type PaAgentModelStreamChunk,
    type PaAgentTurnSummary,
    type PaAgentToolExecutor,
} from "./pa-agent-loop";
import {
    PaAgentContextManager,
    type PaAgentInjectedContext,
    type PaAgentProviderUsage,
} from "./context";
import {
    createAgentControlSnapshot,
    createInitialAgentControlSnapshot,
    toolConstraintsFromAgentControlSnapshot,
    type AgentControlSnapshot,
} from "./pa-agent-control-policy";
import type {
    AgentEvent,
    LegacyAgentEvent,
    ChatAgentStatus,
    ChatMessage,
} from "./chat-types";

export type {
    AgentEvent,
    LegacyAgentEvent,
    ChatAgentIntent,
    ChatAgentSource,
    ChatAgentStatus,
    ChatContextItem,
    ChatContextUsedItem,
    ChatMessage,
    ChatPlannerAction,
    MemorySearchDocument,
    MemorySearchResult,
    SourceRecord,
} from "./chat-types";

export interface PaAgentRunOptions {
    prompt: string;
    chatHistory?: ChatMessage[];
    memoryMode: MemoryMode;
    /** Visible Pagelet evidence. It is context-only and never grants tool authority. */
    pageletHandoff?: PageletChatHandoffContext;
    signal?: AbortSignal;
    onStatus?: (status: ChatAgentStatus) => void;
}

export interface PaAgentStreamOptions extends PaAgentRunOptions {
    qwenRequestOptions?: QwenRequestOptions;
    onLifecycleEvent?: (event: AgentEvent) => void;
    onEvent?: (event: LegacyAgentEvent) => void;
}

export interface PaAgentRuntimeOptions {
    nativeToolPlanningInternalGate?: boolean;
    nativeToolCallingValidatedModels?: readonly NativeToolCallingValidation[];
    maxModelTurns?: number;
    maxWallClockMs?: number;
    finalizationReserveMs?: number;
    providerResponseDelivery?: 'incremental' | 'buffered';
    answerStreamMaxToolCalls?: number;
    answerStreamMaxObservationChars?: number;
    runtimePlatform?: AgentRuntimePlatform;
    additionalCapabilityProviders?: readonly CapabilityProvider[];
    skillContextProvider?: SkillContextProvider | null;
    /** Per-view Operations controller. Its presence enables staging, never direct writes. */
    operationsIntentController?: OperationsIntentStager;
    /** Plugin-owned provider shared across surface-scoped Operations sessions. */
    operationsToolProvider?: OperationsToolProvider;
    /**
     * Write Action Framework v1 PolicyEngine parameters (SDD §4 + §5.1).
     *
     * Omit (chat runtime default) → PolicyEngine stays in strict chat mode
     * (kind="action" rejected, only read-only/network-read non-action allowed).
     *
     * Provide `runKind: "review"` + `allowWrite: true` + an
     * `allowedActionPermissions` allowlist (e.g., `["local-filesystem-write"]`)
     * to unlock WriteActionCapability registration — used by Pagelet's
     * PaReviewRuntime caller.
     */
    policyOptions?: Pick<PolicyEngineOptions, "licenseTier" | "runKind" | "allowWrite" | "allowedActionPermissions">;
    /**
     * Write Action Framework v1 runtime wiring (SDD §5.2 + §5.3).
     *
     * Omit → the framework is inert; `kind="action"` tool calls fall through
     * to {@link CapabilityRegistry.execute} which will reject them per
     * PolicyEngine (default-deny). Chat runtime callers should NOT set this.
     *
     * Provide a {@link PreviewRenderer} to enable the 4-gate orchestrator:
     * toolExecutor dispatches `kind="action"` capabilities through
     * {@link ActionExecutor} (target-confinement → preview-confirmation →
     * stale-reread → executeWrite). `fsProbe` enables Gate 1 collision/folder
     * checks and Gate 3 snapshot drift detection; omit on platforms where the
     * vault adapter is unreachable. `debugObserver` defaults to
     * {@link ConsoleDebugObserver} when `plugin.settings.debug` is true,
     * otherwise {@link NOOP_DEBUG_OBSERVER}.
     */
    writeAction?: {
        previewRenderer: PreviewRenderer;
        fsProbe?: FsProbe;
        debugObserver?: DebugObserver;
    };
}

type ReadOnlyToolContextAvailability = "available" | "partial" | "unavailable";

interface PaAgentStartupTiming {
    phase: string;
    elapsedMs: number;
    metadata?: Record<string, unknown>;
}

const MAX_TURN_WALL_CLOCK_MS = 180_000;
const DEFAULT_FINALIZATION_RESERVE_MS = 15_000;
const MAX_CHAT_HISTORY_CHARS = 60_000;
export const MAX_READ_ONLY_TOOL_CONTEXT_CHARS = 24000;
const OPERATIONS_SUPPORT_TOOL_NAMES = [
    "search_vault_metadata",
    "list_recent_notes",
    "read_note_outline",
    "inspect_obsidian_note",
    "search_vault_snippets",
    "list_vault_tags",
] as const;

class OperationsTurnPolicyEngine extends PolicyEngine {
    private actionsAllowedForTurn = false;

    setActionsAllowedForTurn(allowed: boolean): void {
        this.actionsAllowedForTurn = allowed;
    }

    override canExport(capability: AgentCapability): CapabilityPolicyDecision {
        if (capability.kind === "action" && !this.actionsAllowedForTurn) {
            return { allowed: false, reason: "action capabilities require current-turn write intent" };
        }
        return super.canExport(capability);
    }

    override canExecute(capability: AgentCapability): CapabilityPolicyDecision {
        if (capability.kind === "action" && !this.actionsAllowedForTurn) {
            return { allowed: false, reason: "action capabilities require current-turn write intent" };
        }
        return super.canExecute(capability);
    }
}
export const canFallbackToNonStreaming = (
    error: unknown,
    receivedAnyVisibleOutput: boolean,
    signal?: AbortSignal,
): boolean => {
    return !receivedAnyVisibleOutput && !isAbortError(error, signal);
};

type ModelContentPart = string | Record<string, unknown>;

export interface NativeToolCallCandidate {
    id?: string;
    name: string;
    input: unknown;
    index?: number;
}

export type NativeToolCallParseResult =
    | { ok: true; calls: NativeToolCallCandidate[] }
    | { ok: false; calls: []; reason: string };

interface NativeToolBindableModel {
    bindTools(tools: unknown[]): NativeToolRunnable;
}

interface NativeToolRunnable {
    invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

type MaybePromise<T> = T | PromiseLike<T>;

interface NativeToolStreamingRunnable {
    stream(input: unknown, options?: { signal?: AbortSignal }): MaybePromise<AsyncIterable<unknown>>;
}

interface NativeToolStreamingAndInvocableRunnable extends NativeToolStreamingRunnable {
    invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export type StreamWithInvokeFallbackReason = "stream_setup_failed" | "stream_iteration_failed";

export function parseNativeToolCallsFromModelResponse(response: unknown): NativeToolCallParseResult {
    const value = asRecord(response);
    if (!value) {
        return { ok: true, calls: [] };
    }

    const directCalls = parseNativeToolCallArray(value.tool_calls, "tool_calls");
    if (!directCalls.ok || directCalls.calls.length > 0) {
        return directCalls;
    }

    const additionalKwargs = asRecord(value.additional_kwargs);
    const openaiCalls = parseNativeToolCallArray(additionalKwargs?.tool_calls, "additional_kwargs.tool_calls");
    if (!openaiCalls.ok || openaiCalls.calls.length > 0) {
        return openaiCalls;
    }

    return parseNativeToolCallChunks(value.tool_call_chunks);
}

function parseNativeToolCallArray(value: unknown, source: string): NativeToolCallParseResult {
    if (!Array.isArray(value)) {
        return { ok: true, calls: [] };
    }

    const calls: NativeToolCallCandidate[] = [];
    for (const entry of value) {
        const record = asRecord(entry);
        const functionRecord = asRecord(record?.function);
        const name = readNativeToolCallName(record, functionRecord);
        if (!name) {
            return {
                ok: false,
                calls: [],
                reason: `${source} contained a tool call without a function name.`,
            };
        }

        const input = parseNativeToolCallInput(
            record?.args ?? record?.arguments ?? functionRecord?.arguments,
            source,
        );
        if (!input.ok) {
            return input;
        }

        calls.push({
            id: typeof record?.id === "string" && record.id.trim() ? record.id.trim() : undefined,
            name,
            input: input.value,
            index: typeof record?.index === "number" ? record.index : undefined,
        });
    }

    return { ok: true, calls };
}

function parseNativeToolCallChunks(value: unknown): NativeToolCallParseResult {
    if (!Array.isArray(value)) {
        return { ok: true, calls: [] };
    }

    const groups = new Map<string, {
        id?: string;
        name?: string;
        index?: number;
        argsParts: string[];
        objectInput?: unknown;
    }>();
    let lastKey: string | undefined;
    value.forEach((entry, order) => {
        const record = asRecord(entry);
        const id = typeof record?.id === "string" && record.id.trim() ? record.id.trim() : undefined;
        const index = typeof record?.index === "number" ? record.index : undefined;
        const functionRecord = asRecord(record?.function);
        const name = readNativeToolCallName(record, functionRecord);
        const rawArgs = record?.args ?? record?.arguments ?? functionRecord?.arguments;
        const key = id
            ?? (index === undefined
                ? (!name && lastKey && typeof rawArgs === "string" ? lastKey : `order:${order}`)
                : `index:${index}`);
        const group = groups.get(key) ?? {
            id,
            index,
            argsParts: [],
        };
        if (name) {
            group.name = name;
        }
        if (typeof rawArgs === "string") {
            group.argsParts.push(rawArgs);
        } else if (rawArgs !== undefined && rawArgs !== null && rawArgs !== "") {
            group.objectInput = rawArgs;
        }
        groups.set(key, group);
        lastKey = key;
    });

    const calls: NativeToolCallCandidate[] = [];
    for (const group of groups.values()) {
        if (!group.name) {
            return {
                ok: false,
                calls: [],
                reason: "tool_call_chunks contained a tool call without a function name.",
            };
        }
        const input = parseNativeToolCallInput(
            group.objectInput ?? group.argsParts.join(""),
            "tool_call_chunks",
        );
        if (!input.ok) {
            return input;
        }

        calls.push({
            id: group.id,
            name: group.name,
            input: input.value,
            index: group.index,
        });
    }

    calls.sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER));
    return { ok: true, calls };
}

function readNativeToolCallName(
    record: Record<string, unknown> | undefined,
    functionRecord: Record<string, unknown> | undefined,
): string {
    const directName = typeof record?.name === "string" ? record.name.trim() : "";
    if (directName) return directName;
    return typeof functionRecord?.name === "string" ? functionRecord.name.trim() : "";
}

function parseNativeToolCallInput(
    value: unknown,
    source: string,
): { ok: true; value: unknown } | { ok: false; calls: []; reason: string } {
    if (value === undefined || value === null || value === "") {
        return { ok: true, value: {} };
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return { ok: true, value: parsed };
            }
        } catch {
            // Fall through to the bounded fallback reason below.
        }
        return {
            ok: false,
            calls: [],
            reason: `${source} contained incomplete or invalid JSON arguments.`,
        };
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
        return { ok: true, value };
    }

    return {
        ok: false,
        calls: [],
        reason: `${source} contained non-object tool arguments.`,
    };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function safeStringifyEndPayload(payload: Record<string, unknown>): string {
    try {
        return JSON.stringify(payload);
    } catch {
        return `[unserializable endPayload keys=${Object.keys(payload).join(",")}]`;
    }
}

/**
 * Options for the Write Action Framework aware tool executor (SDD §5.2).
 */
export interface WriteActionAwareToolExecutorOptions {
    /** Base executor used for `kind="tool"` capabilities (chat-runtime path). */
    baseExecutor: PaAgentToolExecutor;
    /** 4-gate orchestrator used for `kind="action"` capabilities. */
    actionExecutor: ActionExecutor;
    /** Registry source for capability lookup + prepareAndValidate. */
    registry: CapabilityRegistry;
    host: AiServiceHost;
    platform?: AgentRuntimePlatform;
    onToolRunning?: (tool: string, message: string) => void;
    /**
     * Required-capability allowlist passed through from the runtime so the
     * action route honors the same scope as the chat-runtime executor (Fix #6).
     */
    allowedToolNames?: ReadonlySet<string>;
    /**
     * Required-capability blocklist passed through from the runtime so the
     * action route honors the same scope as the chat-runtime executor (Fix #6).
     */
    blockedToolNames?: ReadonlySet<string>;
}

/**
 * Wrap the standard chat-runtime tool executor so {@link WriteActionCapability}
 * calls are routed through the framework's 4-gate {@link ActionExecutor}
 * instead of {@link CapabilityRegistry.execute}.
 *
 * Why a wrapping executor (vs mutating capability.execute as the SDD §5.2
 * pseudocode suggests): the chat-runtime path in
 * `createPaAgentCapabilityToolExecutor` already owns input gating
 * (allowed/blocked names), `prepareAndValidate`, host-tool preflight, and
 * result conversion. Wrapping at this seam keeps all that logic in one place
 * and avoids cross-cutting side effects on registered capabilities.
 *
 * Routing flow (per tool call):
 *   1. Tool not in registry, or `kind !== "action"` → delegate to baseExecutor
 *      verbatim (chat tools, builtin web search, skill context, …).
 *   2. `kind === "action"`:
 *      a. Run {@link CapabilityRegistry.prepareAndValidate} to honor
 *         schema_invalid outcome ordering (matches chat-runtime semantics).
 *      b. Call `ActionExecutor.execute(capability, input, ctx)` — the
 *         framework drives the 4 gates + execute + (optional) rollback and
 *         returns an {@link AgentCapabilityResult}.
 *      c. Convert through `agentResultToChatToolResult` →
 *         {@link chatToolResultToPaAgentToolExecutionResult} so the loop sees
 *         the same `PaAgentToolExecutionResult` shape as a tool call.
 *
 * Implements `getExecutionMode` by forwarding to the base executor, which in
 * turn reads the registry. WriteActionCapability declares
 * `executionMode: "sequential"` per framework type contract, so the loop's
 * hybrid dispatch correctly serializes the batch.
 */
export function createWriteActionAwareToolExecutor(
    options: WriteActionAwareToolExecutorOptions,
): PaAgentToolExecutor {
    return {
        getCanonicalToolCallKey: (toolCall, context) => (
            options.baseExecutor.getCanonicalToolCallKey?.(toolCall, context)
        ),
        getExecutionMode: (toolName: string) => {
            return options.baseExecutor.getExecutionMode?.(toolName);
        },
        execute: async (input) => {
            const toolCall = input.toolCall;
            const capability = options.registry.get(toolCall.name);
            if (!capability || capability.kind !== "action") {
                // Non-action tool → standard chat-runtime path.
                return options.baseExecutor.execute(input);
            }
            // Cast is safe here: scope/policy checks below only use toolCall.name,
            // not capability-specific fields. executeWrite is validated after them.
            const writeCapability = capability as WriteActionCapability;
            // Fix #6: honor allowedToolNames/blockedToolNames before any
            // action-specific work so out-of-scope writes never reach the
            // framework (matches `createPaAgentCapabilityToolExecutor` semantics).
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
            // Fix #2: action route MUST consult PolicyEngine.canExecute and
            // emit CapabilityUsageEvent — same as the chat-runtime executor.
            const policyDecision = options.registry.canExecute(toolCall.name);
            if (!policyDecision.allowed) {
                options.registry.recordCapabilityEvent({
                    capabilityName: writeCapability.name,
                    providerId: writeCapability.providerId,
                    status: "skipped",
                    durationMs: 0,
                });
                return {
                    outcome: "policy_rejected",
                    promptText: `Tool ${toolCall.name} was skipped by policy: ${policyDecision.reason ?? "policy rejected"}.`,
                    previewText: `Skipped ${toolCall.name}; policy rejected.`,
                    metadata: {
                        outcome: "policy_rejected",
                        reason: "policy_denied_capability",
                        tool: toolCall.name,
                        policyReason: policyDecision.reason ?? "policy rejected",
                    },
                };
            }
            if (typeof writeCapability.executeWrite !== "function") {
                return {
                    outcome: "policy_rejected",
                    promptText: `Tool ${toolCall.name} was not executed because its write action implementation is incomplete.`,
                    previewText: `Skipped ${toolCall.name}; missing executeWrite.`,
                    metadata: {
                        outcome: "policy_rejected",
                        reason: "missing_execute_write",
                        toolName: toolCall.name,
                    },
                };
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
            options.onToolRunning?.(toolCall.name, `Running ${toolCall.name}`);
            const ctx: AgentCapabilityContext = {
                host: options.host,
                turnId: input.turnId,
                signal: input.signal,
                platform: options.platform ?? "desktop",
            };
            const startedAt = Date.now();
            const agentResult = await options.actionExecutor.execute(
                writeCapability,
                preparedResult.input,
                ctx,
            );
            options.registry.recordCapabilityEvent({
                capabilityName: writeCapability.name,
                providerId: writeCapability.providerId,
                status: agentResult.status === "ok" ? "invoked" : "failed",
                durationMs: Math.max(0, Date.now() - startedAt),
            });
            const chatToolResult = agentResultToChatToolResult(writeCapability.name, agentResult);
            const canonicalResult = chatToolResultToPaAgentToolExecutionResult(toolCall, chatToolResult);
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

export class PaAgentRuntime {
    private readonly host: AiServiceHost;
    private readonly planner: ChatPlanner;
    private readonly memoryTool: MemorySearchTool;
    private readonly contextManager: PaAgentContextManager;
    private readonly toolRegistry: CapabilityRegistry;
    private readonly operationsPolicyEngine: OperationsTurnPolicyEngine | null;
    private readonly skillContextProvider: SkillContextProvider | null;
    private skillContextProviderRegistered = false;
    private readonly options: PaAgentRuntimeOptions;
    /**
     * Write Action Framework v1 per-runtime singletons (SDD §5.2 + §5.3).
     * Null when {@link PaAgentRuntimeOptions.writeAction} is omitted (chat
     * runtime default — framework inert). Owned by the runtime so the TTL
     * timers in {@link SelfWriteRegistry} share the runtime's lifecycle;
     * {@link PaAgentRuntime.dispose} clears them on plugin unload.
     */
    private readonly selfWriteRegistry: SelfWriteRegistry | null;
    private readonly actionExecutor: ActionExecutor | null;
    private readonly activeMemoryRecoveryCoordinators = new Set<ChatMemoryRecoveryCoordinator>();

    constructor(host: AiServiceHost, aiUtils: AIUtils, options: PaAgentRuntimeOptions = {}) {
        this.host = host;
        this.options = options;
        this.planner = new ChatPlanner(aiUtils);
        this.memoryTool = new MemorySearchTool(host, aiUtils);
        this.contextManager = new PaAgentContextManager();
        const runtimePlatform = this.options.runtimePlatform ?? "desktop";
        const operationsRuntimeAvailable = this.host.isOperationsAgentEnabled
            && Boolean(options.operationsIntentController);
        const effectivePolicyOptions = operationsRuntimeAvailable
            ? {
                ...options.policyOptions,
                runKind: "chat-with-actions" as const,
                allowWrite: true,
                allowedActionPermissions: ["local-filesystem-write" as const],
            }
            : options.policyOptions;
        this.operationsPolicyEngine = operationsRuntimeAvailable
            ? new OperationsTurnPolicyEngine({
                platform: runtimePlatform,
                ...effectivePolicyOptions,
            })
            : null;
        this.toolRegistry = new CapabilityRegistry({
            policyEngine: this.operationsPolicyEngine ?? new PolicyEngine({
                platform: runtimePlatform,
                ...effectivePolicyOptions,
            }),
            telemetryEnabled: this.host.settings.shareAnonymousCapabilityUsage === true,
            onCapabilityEvent: (event) => {
                this.host.log("PA capability usage event", event);
            },
        });
        // Per-runtime Write Action Framework wiring (SDD §5.2 + §5.3). Build
        // selfWriteRegistry + actionExecutor exactly once when writeAction is
        // provided so the TTL timers + debug observer share the runtime's
        // lifetime; chat runtime callers leave both null.
        if (options.writeAction) {
            const selfWriteRegistry = createSelfWriteRegistry();
            this.selfWriteRegistry = selfWriteRegistry;
            this.actionExecutor = createActionExecutor({
                previewRenderer: options.writeAction.previewRenderer,
                ...(options.writeAction.fsProbe ? { fsProbe: options.writeAction.fsProbe } : {}),
                selfWrite: selfWriteRegistry,
                debugObserver:
                    options.writeAction.debugObserver
                    ?? (host.settings.debug ? new ConsoleDebugObserver() : NOOP_DEBUG_OBSERVER),
            });
        } else {
            this.selfWriteRegistry = null;
            this.actionExecutor = null;
        }
        const memoryTool = this.memoryTool;
        const coreCapabilities = createCoreToolCapabilities([
            createSearchMemoryTool((input, context) => {
                return memoryTool.search(input.query, context.signal, context.onBeforeVssSearch);
            }),
            createCurrentNoteContextTool(),
            createSearchVaultMetadataTool(),
            createListRecentNotesTool(),
            createReadNoteOutlineTool(),
            createInspectObsidianNoteTool(),
            createReadCanvasSummaryTool(),
            createSearchVaultSnippetsTool(),
            createListVaultTagsTool(),
        ]);
        this.toolRegistry.registerMany(coreCapabilities);
        this.skillContextProvider = options.skillContextProvider === null
            ? null
            : options.skillContextProvider ?? new SkillContextProvider(BUNDLED_SKILL_RESOURCES);
        // Register the four bounded Operations actions only when both the
        // persisted feature opt-in and the per-view staging controller exist.
        if (operationsRuntimeAvailable) {
            const operationsProvider = options.operationsToolProvider ?? new OperationsToolProvider();
            const existingProviders = this.options.additionalCapabilityProviders ?? [];
            this.options = {
                ...this.options,
                additionalCapabilityProviders: [...existingProviders, operationsProvider],
            };
        }
    }

    /**
     * Release per-runtime resources. MUST be called by the owner (e.g., on
     * plugin unload) to cancel any pending self-write TTL timers held by the
     * Write Action Framework. Safe to invoke multiple times.
     */
    dispose(): void {
        for (const coordinator of this.activeMemoryRecoveryCoordinators) coordinator.close();
        this.activeMemoryRecoveryCoordinators.clear();
        this.memoryTool.dispose();
        this.selfWriteRegistry?.dispose();
    }

    async streamTurn(options: PaAgentStreamOptions): Promise<void> {
        return this.streamPaAgentCanonicalTurn(options);
    }

    private async streamPaAgentCanonicalTurn(options: PaAgentStreamOptions): Promise<void> {
        const runtimeStartedAt = Date.now();
        const startupTimings: PaAgentStartupTiming[] = [];
        const operationsActionsEligible = this.host.isOperationsAgentEnabled
            && Boolean(this.options.operationsIntentController)
            && hasOperationsWriteIntent(options.prompt);
        let operationsIntentStaged = false;
        let operationsAcknowledgementRequested = false;
        this.operationsPolicyEngine?.setActionsAllowedForTurn(operationsActionsEligible);
        const recordStartupTiming = <T>(
            phase: string,
            startedAt: number,
            value: T,
            metadata?: Record<string, unknown>,
        ): T => {
            startupTimings.push({
                phase,
                elapsedMs: Math.max(0, Date.now() - startedAt),
                ...(metadata ? { metadata } : {}),
            });
            return value;
        };
        const recordStartupTimingAsync = async <T>(
            phase: string,
            task: () => Promise<T>,
            metadata?: Record<string, unknown>,
        ): Promise<T> => {
            const startedAt = Date.now();
            const value = await task();
            return recordStartupTiming(phase, startedAt, value, metadata);
        };

        const runId = createAgentRunId();
        const providerRequestScope = createProviderRequestScope();
        const memoryPreparationOwnerSignal = options.signal;
        const maxWallClockMs = this.options.maxWallClockMs ?? MAX_TURN_WALL_CLOCK_MS;
        const configuredReserveMs = this.options.finalizationReserveMs
            ?? Math.min(DEFAULT_FINALIZATION_RESERVE_MS, Math.max(1, Math.floor(maxWallClockMs / 10)));
        const finalizationReserveMs = maxWallClockMs > 0
            ? Math.min(Math.max(1, configuredReserveMs), maxWallClockMs)
            : 0;
        const hardAt = runtimeStartedAt + maxWallClockMs;
        const softAt = hardAt - finalizationReserveMs;
        const relaxedRecoveryEnabled = isHostRetrievalFlagEnabled(this.host, "relaxedRecovery");
        const retrievalPolicyEpoch = getHostRetrievalPolicyEpoch(this.host);
        const unboundRetrievalRecorder = this.host.createRetrievalDiagnosticRecorder
            ? this.host.createRetrievalDiagnosticRecorder("chat")
            : this.host.recordRetrievalDiagnostic
                ? (event: RetrievalDiagnosticEventInput) => (
                    this.host.recordRetrievalDiagnostic!("chat", event)
                )
                : undefined;
        const retrievalRecorder = unboundRetrievalRecorder
            ? (event: RetrievalDiagnosticEventInput) => unboundRetrievalRecorder({
                ...event,
                runId,
                ...(event.phase === "finalization_reserve"
                    ? {
                        metrics: {
                            ...event.metrics,
                            configuredReserveMs: finalizationReserveMs,
                        },
                    }
                    : {}),
            })
            : undefined;
        let finalizationOutcome: "completed" | "aborted" | "deadline" | "failed" = "failed";
        let finalizationBoundaryEntered = false;
        let finalizationBoundaryTerminal = false;
        const memoryRecoveryCoordinator = new ChatMemoryRecoveryCoordinator({
            runId,
            runEpoch: runId,
            hardAt,
            softAt,
            toolAt: softAt,
            signal: options.signal,
            enabled: relaxedRecoveryEnabled,
            policyEpoch: retrievalPolicyEpoch,
            isEnabled: () => isHostRetrievalFlagEnabled(this.host, "relaxedRecovery"),
            getPolicyEpoch: () => getHostRetrievalPolicyEpoch(this.host),
            ...(this.host.onSettingsChanged
                ? { onPolicyChanged: (listener: () => void | Promise<void>) => this.host.onSettingsChanged!(listener) }
                : {}),
            temporalIntent: captureExplicitTemporalIntent(options.prompt),
            recordDiagnostic: retrievalRecorder,
        });
        this.activeMemoryRecoveryCoordinators.add(memoryRecoveryCoordinator);
        const memoryEvidenceRegistry = new MemoryEvidenceRegistry((result, signal, temporalFilter) => (
            this.memoryTool.revalidateForProvider(result, signal, temporalFilter)
        ));
        try {
        const legacyEvents = new AgentEventEmitter(options.onEvent);
        const injectedContext = this.readInjectedContext(options.pageletHandoff);
        const governedMemoryTrace = injectedContext?.governedMemoryTrace ?? [];
        if (governedMemoryTrace.length > 0) {
            legacyEvents.turnMetadata({
                hasMemoryContent: true,
                allowedMemorySourcePaths: [],
                contextUsed: governedMemoryTrace.map((trace) => ({
                    category: "memory",
                    label: "Saved understanding",
                    statusOnly: true,
                    memoryClaimId: trace.claimId,
                    memoryEffect: trace.effect,
                    ...(trace.source ? { memorySource: trace.source } : {}),
                    ...(trace.scope ? { memoryScope: trace.scope } : {}),
                })),
            });
        }
        const eventAdapter = new CanonicalToLegacyEventAdapter(legacyEvents, options.onLifecycleEvent);
        let additionalProvidersLoaded = false;
        await recordStartupTimingAsync(
            "capability_preload",
            () => this.loadAdditionalCapabilityProviders(`${runId}:capability-preload`, options.signal),
        );
        additionalProvidersLoaded = true;
        const hostContext = await recordStartupTimingAsync(
            "host_context",
            () => this.loadCanonicalHostContextForRun(options, runId, options.signal),
        );
        const rawRequiredCapabilityClassification = await recordStartupTimingAsync(
            "required_capability_classification",
            () => resolveRequiredCapabilityClassification({
                userInput: options.prompt,
                classifier: this.createRequiredCapabilityClassifier(providerRequestScope),
                signal: options.signal,
            }),
        );
        const requiredCapabilityClassification = applyUserExplicitCapabilityConstraints(
            rawRequiredCapabilityClassification,
            options.prompt,
        );
        startupTimings.push({
            phase: "runtime_startup_total",
            elapsedMs: Math.max(0, Date.now() - runtimeStartedAt),
            metadata: {
                promptLength: options.prompt.length,
                memoryMode: options.memoryMode,
            },
        });
        const availableRequiredCapabilities = this.getAvailableRequiredCapabilities(options);
        const availableSemanticToolNames = new Set<string>(availableRequiredCapabilities);
        if (operationsActionsEligible) {
            for (const toolName of [...CORE_WRITE_TOOL_NAMES, ...OPERATIONS_SUPPORT_TOOL_NAMES]) {
                availableSemanticToolNames.add(toolName);
            }
        }
        const availableMetaToolNames = new Set<string>();
        if (this.toolRegistry.getDefinition(LOAD_SKILL_TOOL_NAME)) {
            availableMetaToolNames.add(LOAD_SKILL_TOOL_NAME);
        }
        const requiredCapabilityPolicy = createRequiredCapabilityHostPolicy({
            userInput: options.prompt,
            availableCapabilities: availableRequiredCapabilities,
            classification: requiredCapabilityClassification,
        });
        const toolUseConstraints = includeOperationsInToolUseConstraints(
            createPaAgentToolUseConstraints(options.prompt),
            operationsActionsEligible,
        );
        const initialRuntimeInstruction = combineRuntimeInstructions([
            requiredCapabilityPolicy.initialRuntimeInstruction,
            createPaAgentToolConstraintRuntimeInstruction(toolUseConstraints),
        ]);
        const initialControlSnapshot = createInitialAgentControlSnapshot({
            ...(toolUseConstraints ? { constraints: toolUseConstraints } : {}),
            availableSemanticToolNames,
            availableMetaToolNames,
            requiredToolNames: new Set([
                ...requiredCapabilityClassification.items
                    .filter((item) => item.level === "required")
                    .map((item) => item.capability),
                ...(operationsActionsEligible
                    ? [...CORE_WRITE_TOOL_NAMES, ...OPERATIONS_SUPPORT_TOOL_NAMES]
                    : []),
            ]),
            ...(initialRuntimeInstruction
                ? { initialRuntimeInstruction }
                : {}),
        });

        const loadAdditionalCapabilityProviders = this.loadAdditionalCapabilityProviders.bind(this);
        const toolRegistry = this.toolRegistry;
        const planner = this.planner;
        const contextManager = this.contextManager;
        const buildCanonicalModelInput = (
            input: PaAgentModelInput,
            toolDefinitions?: ChatToolRegistryDefinition[],
        ) =>
            this.buildPaAgentCanonicalModelInput(
                options,
                input,
                toolConstraintsFromAgentControlSnapshot(input.controlSnapshot) ?? toolUseConstraints,
                toolDefinitions,
                injectedContext,
            );
        const model: PaAgentModel = {
            stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
                if (!additionalProvidersLoaded) {
                    additionalProvidersLoaded = true;
                    await loadAdditionalCapabilityProviders(input.turnId, input.signal);
                }
                const activeToolUseConstraints = toolConstraintsFromAgentControlSnapshot(input.controlSnapshot)
                    ?? toolUseConstraints;
                const exportFilter = {
                    ...activeToolUseConstraints,
                    includeActions: operationsActionsEligible,
                };
                const schemaResult = toolRegistry.exportProviderSchemasSafe(exportFilter);
                if (!schemaResult.ok) {
                    legacyEvents.activity("fallback-tool-disabled", "Native tool schema export failed", {
                        legacyStatus: { type: "fallback", reason: "Native tool schema export failed." } satisfies ChatAgentStatus,
                    });
                }
                const schemas = schemaResult.ok && input.toolMode !== "final_answer_only"
                    ? schemaResult.schemas
                    : [];
                const toolDefinitions = input.toolMode === "final_answer_only"
                    ? []
                    : toolRegistry.listDefinitions(exportFilter);
                const metricsInput = buildCanonicalModelInput(input, toolDefinitions);
                yield {
                    type: "diagnostic",
                    diagnostic: createPaAgentModelInputMetricsDiagnostic({
                        canonicalInput: metricsInput,
                        providerSchemaExportOk: schemaResult.ok,
                        exportedProviderSchemaCount: schemaResult.ok ? schemaResult.schemas.length : 0,
                        boundProviderSchemas: schemas,
                        plannerToolDefinitions: toolDefinitions,
                    }),
                };
                const llm = await planner.createFinalAnswerModel(0.8, {
                    transport: "native",
                    qwenRequestOptions: options.qwenRequestOptions,
                    providerRequestScope,
                    onProviderRequestStart: input.notifyProviderRequestStarted,
                });
                const runnable = bindStreamingToolsIfAvailable(llm, schemas);
                const streamedToolNames = new Map<string, string>();
                const prompt = createPaAgentAnswerStreamPrompt();
                const chain = prompt.pipe(runnable) as unknown as NativeToolStreamingAndInvocableRunnable;
                // Model/provider construction may suspend after the Loop's
                // ordinary preflight. Revalidate again only once the real
                // chain is ready, then synchronously rebuild the canonical
                // prompt immediately before the first provider request.
                const providerInput = input.prepareForProviderRetry
                    ? await input.prepareForProviderRetry()
                    : input;
                const canonicalProviderInput = buildCanonicalModelInput(providerInput, toolDefinitions);
                // P0-D: if streaming fails before any visible output (e.g., provider rejected stream
                // outright or dropped the connection pre-flight), retry via chain.invoke() so the user
                // still gets the answer instead of a hard runtime error.
                for await (const chunk of streamWithInvokeFallback({
                    chain,
                    input: canonicalProviderInput,
                    // The loop-owned signal links user cancellation with the
                    // current soft/hard deadline. The outer request signal
                    // alone would let a timed-out stream/invoke keep running.
                    signal: providerInput.signal,
                    streamedToolNames,
                    prepareInvokeInput: async () => {
                        const retryInput = input.prepareForProviderRetry
                            ? await input.prepareForProviderRetry()
                            : input;
                        return buildCanonicalModelInput(retryInput, toolDefinitions);
                    },
                    onFallback: (reason, error) => {
                        legacyEvents.activity(
                            "fallback-stream-invoke",
                            `Native streaming failed (${reason}); retrying via invoke(): ${errorMessage(error)}`,
                            {
                                legacyStatus: {
                                    type: "fallback",
                                    reason: "Streaming unavailable; falling back to invoke().",
                                } satisfies ChatAgentStatus,
                            },
                        );
                    },
                })) {
                    const providerUsage = readProviderUsageDiagnostic(chunk);
                    if (providerUsage) {
                        contextManager.recordProviderUsage(providerUsage);
                    }
                    yield chunk;
                }
            },
        };
        const baseToolExecutor = createPaAgentCapabilityToolExecutor({
            registry: this.toolRegistry,
            host: this.host,
            platform: this.options.runtimePlatform ?? "desktop",
            memoryEvidenceRegistry,
            memoryRecoveryCoordinator,
            providerRequestScope,
            memoryPreparationOwnerSignal,
            revalidateMemorySearch: (result, signal, temporalFilter, temporalAudit) => (
                this.memoryTool.revalidateForProvider(
                    result,
                    signal,
                    temporalFilter,
                    temporalAudit,
                )
            ),
            onBeforeVssSearch: () => {
                options.onStatus?.({ type: "retrieving", query: "memory" });
            },
            onToolRunning: (tool, message) => {
                if (tool === "search_memory") return;
                options.onStatus?.({ type: "tool-running", tool, message });
            },
            ...(toolUseConstraints?.allowedToolNames
                ? { allowedToolNames: toolUseConstraints.allowedToolNames }
                : {}),
            ...(toolUseConstraints?.blockedToolNames
                ? { blockedToolNames: toolUseConstraints.blockedToolNames }
                : {}),
        });
        const toolExecutor = operationsActionsEligible && this.options.operationsIntentController
            ? createOperationsStagingToolExecutor({
                baseExecutor: baseToolExecutor,
                registry: this.toolRegistry,
                controller: this.options.operationsIntentController,
                onToolRunning: (tool, message) => {
                    options.onStatus?.({ type: "tool-running", tool, message });
                },
                ...(toolUseConstraints?.allowedToolNames
                    ? { allowedToolNames: toolUseConstraints.allowedToolNames }
                    : {}),
                ...(toolUseConstraints?.blockedToolNames
                    ? { blockedToolNames: toolUseConstraints.blockedToolNames }
                    : {}),
            })
            : this.actionExecutor
            ? createWriteActionAwareToolExecutor({
                baseExecutor: baseToolExecutor,
                actionExecutor: this.actionExecutor,
                registry: this.toolRegistry,
                host: this.host,
                platform: this.options.runtimePlatform ?? "desktop",
                onToolRunning: (tool, message) => {
                    options.onStatus?.({ type: "tool-running", tool, message });
                },
                ...(toolUseConstraints?.allowedToolNames
                    ? { allowedToolNames: toolUseConstraints.allowedToolNames }
                    : {}),
                ...(toolUseConstraints?.blockedToolNames
                    ? { blockedToolNames: toolUseConstraints.blockedToolNames }
                    : {}),
            })
            : baseToolExecutor;
        const loop = new PaAgentLoop({
            runId,
            userInput: options.prompt,
            model,
            prepareModelInput: async (input) => {
                const failClosedOnAbort = () => memoryEvidenceRegistry.failClosed();
                input.signal?.addEventListener("abort", failClosedOnAbort, { once: true });
                if (input.signal?.aborted) failClosedOnAbort();
                try {
                    return {
                        ...input,
                        transcript: await memoryEvidenceRegistry.prepareTranscript(
                            input.transcript,
                            input.signal,
                        ),
                    };
                } finally {
                    input.signal?.removeEventListener("abort", failClosedOnAbort);
                }
            },
            toolExecutor,
            hostPolicy: {
                afterTurn: async (summary) => {
                    operationsIntentStaged ||= hasStagedOperationsIntent(summary);
                    const decision = await requiredCapabilityPolicy.hostPolicy.afterTurn(summary);
                    if (
                        operationsIntentStaged
                        && operationsAcknowledgementRequested
                        && decision.action === "continue"
                    ) {
                        return {
                            action: "stop" as const,
                            status: "completed" as const,
                            reason: "operations_intent_staged_acknowledgement_empty",
                            diagnostics: [{
                                type: "operations_intent_staged_acknowledgement_empty",
                                message: "The inline confirmation card is the successful output; no generic finalization turn was run.",
                            }],
                        };
                    }
                    if (operationsIntentStaged && decision.action === "continue") {
                        operationsAcknowledgementRequested = true;
                        return {
                            ...decision,
                            runtimeInstruction: OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION,
                            toolMode: "normal" as const,
                            controlSnapshot: createOperationsAcknowledgementControlSnapshot(
                                decision.controlSnapshot ?? summary.controlSnapshot,
                            ),
                        };
                    }
                    if (
                        decision.action !== "continue"
                        || decision.toolMode === "final_answer_only"
                        || !decision.controlSnapshot
                    ) {
                        return decision;
                    }
                    return {
                        ...decision,
                        controlSnapshot: preserveOperationsActionsInControlSnapshot(
                            decision.controlSnapshot,
                            operationsActionsEligible,
                        ),
                    };
                },
            },
            onEvent: (event) => eventAdapter.handle(event),
            ...(hostContext ? { hostContext } : {}),
            ...(initialRuntimeInstruction
                ? { initialRuntimeInstruction }
                : {}),
            initialControlSnapshot,
            signal: options.signal,
            maxTurns: this.options.maxModelTurns ?? 20,
            maxWallClockMs,
            finalizationReserveMs,
            providerResponseDelivery: this.options.providerResponseDelivery,
            ...(retrievalRecorder
                ? {
                onFinalizationReserve: (event: {
                        stage: "entered" | "completed" | "aborted" | "failed" | "exhausted" | "overrun";
                        remainingMs: number;
                    }) => {
                        if (event.stage === "entered") finalizationBoundaryEntered = true;
                        else finalizationBoundaryTerminal = true;
                        retrievalRecorder({
                            phase: "finalization_reserve",
                            outcome: event.stage === "entered"
                                ? "started"
                            : event.stage === "exhausted" || event.stage === "overrun" ? "deadline" : event.stage,
                            reason: event.stage === "overrun"
                                ? "reserve_overrun"
                                : event.stage === "exhausted"
                                    ? "reserve_exhausted"
                                : event.stage === "aborted"
                                    ? "reserve_aborted"
                                    : event.stage === "failed" ? "reserve_failed" : undefined,
                            metrics: {
                                remainingMs: event.remainingMs,
                                configuredReserveMs: finalizationReserveMs,
                            },
                        });
                    },
                }
                : {}),
            maxToolCalls: this.options.answerStreamMaxToolCalls ?? 30,
            maxObservationChars: this.options.answerStreamMaxObservationChars ?? 64_000,
            startupTimings,
            // pi hybrid dispatch (P0-A): read-only/idempotent v2.0.0 tools run concurrently when the model
            // requests multiple in one batch. Any future tool that declares executionMode === "sequential"
            // (e.g., write tools) forces the whole batch serial via PaAgentToolExecutor.getExecutionMode.
            toolExecutionMode: "hybrid",
        });

        const result = await loop.run();
        finalizationOutcome = result.status === "aborted"
            ? "aborted"
            : Date.now() >= hardAt
                ? "deadline"
                : result.status === "error" ? "failed" : "completed";
        this.logPaAgentTiming(runId, startupTimings, result);
        if (result.status === "aborted") {
            throw createAbortError();
        }
        if (result.status === "error") {
            // P0-C: preserve loop diagnostics (provider error, host_policy_error, schema failures…) so
            // upstream logs aren't left with a generic "canonical runtime failed" with no context. The
            // payload mirrors the final agent_end event details; safe to JSON.stringify because
            // PaAgentLoop only stores plain-object diagnostics in endPayload.
            const detail = result.endPayload ? `: ${safeStringifyEndPayload(result.endPayload)}` : "";
            throw new Error(`PA Agent canonical runtime failed${detail}`);
        }
        } finally {
            try {
                const observedFinalizationOutcome = options.signal?.aborted
                    ? "aborted"
                    : Date.now() >= hardAt ? "deadline" : finalizationOutcome;
                if (!finalizationBoundaryTerminal) {
                    retrievalRecorder?.({
                        phase: "finalization_reserve",
                        outcome: finalizationBoundaryEntered ? observedFinalizationOutcome : "skipped",
                        reason: !finalizationBoundaryEntered
                            ? "reserve_not_entered"
                            : observedFinalizationOutcome === "deadline"
                                ? "hard_deadline"
                                : observedFinalizationOutcome === "aborted"
                                    ? "reserve_aborted"
                                    : observedFinalizationOutcome === "failed" ? "reserve_failed" : undefined,
                        metrics: {
                            remainingMs: Math.max(0, hardAt - Date.now()),
                            configuredReserveMs: finalizationReserveMs,
                        },
                    });
                }
            } catch {
                // Diagnostics are observational only.
            }
            memoryRecoveryCoordinator.close();
            memoryEvidenceRegistry.clear();
            this.activeMemoryRecoveryCoordinators.delete(memoryRecoveryCoordinator);
        }
    }

    private logPaAgentTiming(
        runId: string,
        startupTimings: readonly PaAgentStartupTiming[],
        result: PaAgentLoopResult,
    ): void {
        if (!this.host.settings.debug) return;
        const payload = result.endPayload ?? {};
        this.host.log("PA Agent timing", {
            runId,
            startupTimings,
            loopElapsedMs: payload.loopElapsedMs,
            status: result.status,
            turnCount: result.turns.length,
            turnTimings: payload.turnTimings ?? result.turns.map((turn) => turn.timing),
            endTiming: payload.endTiming,
            ...(payload.reason ? { reason: payload.reason } : {}),
            ...(payload.warnings ? { warnings: payload.warnings } : {}),
            ...(payload.diagnostics ? { diagnostics: payload.diagnostics } : {}),
        });
    }

    private getAvailableRequiredCapabilities(options: PaAgentStreamOptions): Set<RequiredCapability> {
        const available = new Set<RequiredCapability>();
        if (options.memoryMode !== "skip-memory" && this.toolRegistry.getDefinition("search_memory")) {
            available.add("search_memory");
        }
        if (this.toolRegistry.getDefinition("get_current_note_context")) {
            available.add("get_current_note_context");
        }
        if (this.toolRegistry.getDefinition("webSearch")) {
            available.add("webSearch");
        }
        return available;
    }

    private createRequiredCapabilityClassifier(
        providerRequestScope: ProviderRequestScope,
    ): RequiredCapabilityClassifier | undefined {
        const policyModelName = this.host.settings.policyModelName.trim();
        if (!policyModelName) return undefined;
        return {
            classify: async ({ userInput, signal }) =>
                this.planner.classifyRequiredCapabilities(
                    userInput,
                    policyModelName,
                    signal,
                    providerRequestScope,
                ),
        };
    }

    private async loadCanonicalHostContextForRun(
        options: PaAgentStreamOptions,
        runId: string,
        signal?: AbortSignal,
    ): Promise<Record<string, unknown> | undefined> {
        if (!this.skillContextProvider) return undefined;
        if (this.host.settings.skillContextEnabled === false) return undefined;
        const enabledSkillIds = Array.isArray(this.host.settings.enabledSkillIds)
            ? this.host.settings.enabledSkillIds
            : undefined;
        if (enabledSkillIds && enabledSkillIds.length === 0) return undefined;

        if (!this.skillContextProviderRegistered) {
            const loadResult = await this.toolRegistry.registerProvider(this.skillContextProvider, {
                turnId: `${runId}:host-context`,
                platform: this.options.runtimePlatform ?? "desktop",
                settings: this.host.settings as unknown as Record<string, unknown>,
                signal,
            });
            if (loadResult.status !== "available") {
                this.host.log("Skill context provider unavailable", {
                    reason: loadResult.unavailableReason,
                });
                return undefined;
            }
            this.skillContextProviderRegistered = true;
        }

        const catalog = this.skillContextProvider.getCatalog({ enabledSkillIds });
        if (catalog.entries.length === 0) return undefined;

        return {
            catalog,
        };
    }

    private async loadAdditionalCapabilityProviders(turnId: string, signal?: AbortSignal): Promise<void> {
        for (const provider of this.options.additionalCapabilityProviders ?? []) {
            const result = await this.toolRegistry.registerProvider(provider, {
                turnId,
                platform: this.options.runtimePlatform ?? "desktop",
                settings: this.host.settings as unknown as Record<string, unknown>,
                signal,
            });
            if (result.status === "unavailable") {
                this.host.log("Optional capability provider unavailable", {
                    providerId: provider.id,
                    reason: result.unavailableReason,
                });
            }
        }
    }

    private buildPaAgentCanonicalModelInput(
        options: PaAgentStreamOptions,
        input: PaAgentModelInput,
        toolUseConstraints?: PaAgentToolUseConstraints,
        toolDefinitions?: ChatToolRegistryDefinition[],
        injectedContext?: PaAgentInjectedContext,
    ): Record<string, string> {
        const availableSkills = formatSkillCatalog(input.hostContext);
        const hostContext = formatCanonicalHostContext(input.hostContext);
        const toolDefinitionsText = input.toolMode === "final_answer_only"
            ? "No tools are available in this finalization turn."
            : formatPlannerToolDefinitions(toolDefinitions ?? filterToolDefinitionsByToolUseConstraints(
                this.toolRegistry.listDefinitions(),
                toolUseConstraints,
            ));
        const projection = this.contextManager.forPrompt({
            prompt: options.prompt,
            chatHistory: isOperationsStagedAcknowledgement(input.runtimeInstruction)
                ? undefined
                : options.chatHistory,
            transcript: input.transcript,
            turnIndex: input.turnIndex,
            hostContext,
            runtimeInstruction: input.runtimeInstruction,
            injectedContext,
            availableSkills,
            toolDefinitions: toolDefinitionsText,
            maxHistoryChars: MAX_CHAT_HISTORY_CHARS,
            maxPromptChars: 120_000,
            maxObservationChars: this.options.answerStreamMaxObservationChars ?? 64_000,
            formatToolObservations,
        });

        return {
            input: projection.input,
            available_skills: projection.availableSkills,
            tool_definitions: projection.toolDefinitions,
            tool_observations: projection.toolObservations,
            operations_guidance: createOperationsPromptGuidance(toolDefinitions ?? []),
            __context_projection_diagnostic: JSON.stringify(projection.diagnostics),
        };
    }

    private readInjectedContext(
        pageletHandoff?: PageletChatHandoffContext,
    ): PaAgentInjectedContext | undefined {
        const memoryContext = this.host.getMemoryExtractionPromptContext();
        if (!pageletHandoff) return memoryContext;
        return {
            ...(memoryContext ?? {}),
            pageletHandoff,
        };
    }


}

class ChatPlanner {
    private readonly aiUtils: AIUtils;

    constructor(aiUtils: AIUtils) {
        this.aiUtils = aiUtils;
    }

    createFinalAnswerModel(
        temperature: number,
        options: Parameters<AIUtils["createChatModel"]>[1],
    ) {
        return this.aiUtils.createChatModel(temperature, options);
    }

    async classifyRequiredCapabilities(
        userInput: string,
        policyModelName: string,
        signal?: AbortSignal,
        providerRequestScope?: ProviderRequestScope,
    ): Promise<unknown> {
        const policyPrompt = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate([
                "You classify whether a Personal Assistant chat request requires read-only capabilities.",
                "Read only the user request. Do not assume hidden vault, Memory, current-note, WebSearch, or SkillContext content.",
                "Return JSON only with this shape:",
                "{\"items\":[{\"capability\":\"search_memory|webSearch|get_current_note_context\",\"confidence\":0.0,\"reason\":\"short reason\"}]}",
                "Use confidence >= 0.75 when the capability is required, 0.45-0.74 when it is only suggested, and below 0.45 when it should be ignored.",
            ].join("\n")),
            HumanMessagePromptTemplate.fromTemplate("{input}"),
        ]);
        const llm = await this.aiUtils.createChatModel(0, {
            transport: "obsidian",
            modelName: policyModelName,
            providerRequestScope,
        });
        const response = await policyPrompt.pipe(llm).invoke({ input: userInput }, { signal });
        return response.content;
    }

}

// Exported so __tests__/pa-agent-runtime-tool-definitions.test.ts can assert that the
// trimmed payload still surfaces planner_guidance (the only project-specific field that
// `bindTools(schemas)` does NOT pass through to the model) without spinning up the full
// runtime. See SDD §3.3 / item 2.1 for the token-saving rationale.
export function formatPlannerToolDefinitions(definitions: ChatToolRegistryDefinition[]): string {
    if (definitions.length === 0) return "None";
    return definitions.map((definition) => JSON.stringify({
        name: definition.name,
        planner_guidance: definition.plannerGuidance,
    }, null, 0)).join("\n");
}

export interface PaAgentModelInputMetricsDiagnosticOptions {
    canonicalInput: Record<string, string>;
    providerSchemaExportOk: boolean;
    exportedProviderSchemaCount: number;
    boundProviderSchemas: ChatToolProviderSchema[];
    plannerToolDefinitions: ChatToolRegistryDefinition[];
}

export function createPaAgentModelInputMetricsDiagnostic(
    options: PaAgentModelInputMetricsDiagnosticOptions,
): Record<string, unknown> {
    const base = {
        type: "model_input_metrics",
        inputChars: options.canonicalInput.input.length,
        availableSkillsChars: options.canonicalInput.available_skills.length,
        toolDefinitionsChars: options.canonicalInput.tool_definitions.length,
        toolObservationsChars: options.canonicalInput.tool_observations.length,
        providerSchemaExportOk: options.providerSchemaExportOk,
        exportedProviderSchemaCount: options.exportedProviderSchemaCount,
        boundProviderSchemaCount: options.boundProviderSchemas.length,
        boundProviderSchemaChars: estimateSerializedChars(options.boundProviderSchemas),
        boundProviderToolNames: options.boundProviderSchemas
            .map((schema) => schema.function.name)
            .sort(),
        plannerToolDefinitionCount: options.plannerToolDefinitions.length,
        plannerToolDefinitionNames: options.plannerToolDefinitions
            .map((definition) => definition.name)
            .sort(),
    };
    const contextProjection = parseOptionalDiagnostic(options.canonicalInput.__context_projection_diagnostic);
    return {
        ...base,
        ...(contextProjection ? { contextProjection } : {}),
    };
}

function estimateSerializedChars(value: unknown): number {
    try {
        return JSON.stringify(value)?.length ?? 0;
    } catch {
        return 0;
    }
}

function parseOptionalDiagnostic(value: unknown): unknown {
    if (typeof value !== "string" || !value.trim()) return undefined;
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}


function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
            const record = entry as Record<string, unknown>;
            if (typeof record.candidate_id === "string") return record.candidate_id;
            if (typeof record.candidateId === "string") return record.candidateId;
            if (typeof record.source_path === "string") return record.source_path;
            if (typeof record.sourcePath === "string") return record.sourcePath;
            if (typeof record.path === "string") return record.path;
            if (typeof record.id === "string") return record.id;
        }
        return "";
    }).map((entry) => entry.trim()).filter(Boolean);
}

// A3 progressive disclosure: ContextUsed is derived from tool execution results
// (chat-view.ts builds them from canonical toolResult metadata), not from host
// pre-context. The catalog (L1) is metadata only. The A1 helpers
// `buildContextUsedItems` / `contextItemToContextUsedItem` /
// `readToolContextAvailability` / `getToolContextUsedInfo` were removed.

function asNativeToolBindableModel(value: unknown): NativeToolBindableModel | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const bindTools = (value as { bindTools?: unknown }).bindTools;
    return typeof bindTools === "function" ? value as NativeToolBindableModel : undefined;
}

function getReadOnlyToolContentAvailability(content: unknown): ReadOnlyToolContextAvailability {
    if (!content || typeof content !== "object") return "available";
    const record = content as Record<string, unknown>;
    if (
        readStringArray(record.unavailableSources).length > 0
        || record.missingScope === true
        || record.unsupportedScope === true
    ) {
        return "unavailable";
    }
    if (readStringArray(record.skippedSources).length > 0 || record.truncated === true) {
        return "partial";
    }
    return "available";
}

export function isReadOnlyContextToolResult(tool: string, content: unknown): boolean {
    if (tool === "search_vault_metadata") return isSearchVaultMetadataResult(content);
    if (tool === "list_recent_notes") return isListRecentNotesResult(content);
    if (tool === "read_note_outline") return isReadNoteOutlineResult(content);
    if (tool === "inspect_obsidian_note") return isInspectObsidianNoteResult(content);
    if (tool === "read_canvas_summary") return isReadCanvasSummaryResult(content);
    if (tool === "search_vault_snippets") return isVaultSnippetSearchResult(content);
    if (tool === "list_vault_tags") return isVaultTagsResult(content);
    return false;
}

export function getReadOnlyToolObservationMessage(tool: string, content: unknown): string {
    const availability = getReadOnlyToolContentAvailability(content);
    if (availability === "unavailable") {
        return getUnavailableReadOnlyToolObservationMessage(tool, content);
    }
    if (tool === "search_vault_metadata" && isSearchVaultMetadataResult(content)) {
        return `Found ${content.matches.length} metadata match(es).`;
    }
    if (tool === "list_recent_notes" && isListRecentNotesResult(content)) {
        return `Listed ${content.notes.length} recent note(s).`;
    }
    if (tool === "read_note_outline" && isReadNoteOutlineResult(content)) {
        return `Read ${content.headings.length} heading(s) from note outline.`;
    }
    if (tool === "inspect_obsidian_note" && isInspectObsidianNoteResult(content)) {
        const facts = [
            Array.isArray(content.headings) ? `${content.headings.length} heading(s)` : undefined,
            Array.isArray(content.tasks) ? `${content.tasks.length} task(s)` : undefined,
            Array.isArray(content.tags) ? `${content.tags.length} tag(s)` : undefined,
            Array.isArray(content.outgoingLinks) ? `${content.outgoingLinks.length} outgoing link(s)` : undefined,
            Array.isArray(content.backlinks) ? `${content.backlinks.length} backlink(s)` : undefined,
        ].filter(Boolean);
        return facts.length > 0
            ? `${availability === "partial" ? "Read partial note structure" : "Read note structure"}: ${facts.join(", ")}.`
            : availability === "partial" ? "Read partial note structure." : "Read note structure.";
    }
    if (tool === "read_canvas_summary" && isReadCanvasSummaryResult(content)) {
        return availability === "partial"
            ? `Read partial canvas structure: ${content.nodeCount} node(s), ${content.edgeCount} edge(s).`
            : `Read canvas structure: ${content.nodeCount} node(s), ${content.edgeCount} edge(s).`;
    }
    if (tool === "search_vault_snippets" && isVaultSnippetSearchResult(content)) {
        return availability === "partial"
            ? `Found ${content.matches.length} bounded snippet match(es); some files were skipped.`
            : `Found ${content.matches.length} bounded snippet match(es).`;
    }
    if (tool === "list_vault_tags" && isVaultTagsResult(content)) {
        return availability === "partial"
            ? `Listed ${content.tags.length} vault tag(s) from partial metadata.`
            : `Listed ${content.tags.length} vault tag(s).`;
    }
    if (isObsidianOperationsV1AToolName(tool)) {
        return "Read Obsidian context.";
    }
    return `${tool} completed.`;
}

function getUnavailableReadOnlyToolObservationMessage(tool: string, content: unknown): string {
    const record = content && typeof content === "object" ? content as Record<string, unknown> : {};
    if (tool === "search_vault_snippets") {
        if (record.unsupportedScope === true) return "Snippet scope is not a supported Markdown scope.";
        if (record.missingScope === true) return "Snippet scope was not found.";
        return "Snippet search unavailable.";
    }
    if (tool === "read_canvas_summary") return "Canvas structure unavailable.";
    if (tool === "list_vault_tags") return "Vault tags unavailable.";
    if (tool === "inspect_obsidian_note") return "Note structure unavailable.";
    return "Vault context unavailable.";
}

function bindStreamingToolsIfAvailable(llm: unknown, schemas: ChatToolProviderSchema[]): NativeToolStreamingRunnable {
    const bindable = schemas.length > 0 ? asNativeToolBindableModel(llm) : undefined;
    const runnable = bindable ? bindable.bindTools(schemas) : llm;
    if (!runnable || typeof runnable !== "object" || typeof (runnable as { stream?: unknown }).stream !== "function") {
        throw new Error("PA Agent answer-stream model does not expose stream().");
    }
    return runnable as NativeToolStreamingRunnable;
}

interface PaAgentToolUseConstraints {
    allowedToolNames?: ReadonlySet<string>;
    blockedToolNames?: ReadonlySet<string>;
}

export const OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION = [
    "The current user's Operations proposal was staged successfully in the inline confirmation card, and nothing has been written yet.",
    "Reply only with a concise acknowledgement that this current proposal is ready for review.",
    "Do not mention internal turns, tool availability, or the state or content of any earlier proposal.",
    "Do not call tools or claim that a write has completed.",
].join(" ");

export function isOperationsStagedAcknowledgement(runtimeInstruction?: string): boolean {
    return runtimeInstruction === OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION;
}

function hasStagedOperationsIntent(summary: PaAgentTurnSummary): boolean {
    return summary.toolResults.some((result) => (
        CORE_WRITE_TOOL_NAMES.some((toolName) => toolName === result.toolName)
        && result.content.metadata?.staged === true
        && result.content.metadata?.wrote === false
    ));
}

export function createOperationsAcknowledgementControlSnapshot(
    previous?: AgentControlSnapshot,
): AgentControlSnapshot {
    return createAgentControlSnapshot({
        exposureMode: "answer-ready",
        sourceScope: previous?.sourceScope ?? "none",
        allowedToolNames: new Set(),
        ...(previous?.blockedToolNames ? { blockedToolNames: previous.blockedToolNames } : {}),
        ...(previous ? { blockedReasons: previous.blockedReasons } : {}),
        runtimeInstruction: OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION,
        toolMode: "normal",
        ...(previous ? { budgetState: previous.budgetState } : {}),
        diagnostics: [
            ...(previous?.diagnostics ?? []),
            {
                type: "operations_intent_staged_acknowledgement",
                message: "Operations proposal is staged; the next turn may only acknowledge the inline confirmation card.",
            },
        ],
    });
}

export function preserveOperationsActionsInControlSnapshot(
    snapshot: AgentControlSnapshot,
    includeOperations: boolean,
): AgentControlSnapshot {
    if (!includeOperations || snapshot.toolMode === "final_answer_only" || !snapshot.allowedToolNames) {
        return snapshot;
    }
    return {
        ...snapshot,
        allowedToolNames: new Set([
            ...snapshot.allowedToolNames,
            ...CORE_WRITE_TOOL_NAMES,
        ]),
    };
}

const OPERATIONS_WRITE_INTENT_ENGLISH = [
    /^(?:please\s+)?save(?:\s+(?:it|this))?[.!]?$/iu,
    /\b(?:save|store|persist)\s+(?:it|this|that|these|previous|above)\b/iu,
    /\b(?:save|store|persist)\s+(?:(?:the|our|your|my)\s+)?(?:conclusion|decision|result|summary|plan|answer|analysis)\b/iu,
    /\b(?:save|store|persist)\b.{0,40}\b(?:to|into|in|as)\b.{0,30}\b(?:note|notes|vault|markdown|frontmatter|propert(?:y|ies)|file)\b/iu,
    /\b(?:write|append|add)\b.{0,60}\b(?:to|into)\b.{0,30}\b(?:note|notes|vault|markdown|file)\b/iu,
    /\b(?:insert|replace)\b.{0,60}\b(?:in|into|within)\b.{0,30}\b(?:note|notes|vault|markdown|file)\b/iu,
    /\b(?:delete|remove)\b.{0,60}\b(?:from|in|within)\b.{0,30}\b(?:note|notes|vault|markdown|file)\b/iu,
    /\b(?:in|within)\s+(?:the\s+)?(?:(?:current|existing)\s+)?(?:note|file|markdown)\b.{0,60}\b(?:write|append|add|update|edit|insert|replace|set|change|remove|delete)\b/iu,
    /\b(?:create|write|add)\s+(?:(?:a|an|the|this|that|my|our|your|new)\s+)?(?:markdown\s+)?(?:note|file)\b/iu,
    /\b(?:update|edit)\s+(?:(?:the|this|that|my|our|your)\s+)?(?:(?:current|existing)\s+)?(?:note|file|markdown|frontmatter)\b/iu,
    /\b(?:update|edit|set|change|remove|delete)\s+(?:the\s+)?(?:[\p{L}\p{N}_-]+\s+){0,3}(?:frontmatter|propert(?:y|ies))\b/iu,
    /\b(?:save|store|persist|write|append|add|create|update|edit|insert|replace|remove|delete)\b.{0,100}[^\s"'`<>|]+\.md\b/iu,
    /[^\s"'`<>|]+\.md\b.{0,60}\b(?:save|store|persist|write|append|add|create|update|edit|insert|replace|remove|delete)\b/iu,
];
const OPERATIONS_WRITE_INTENT_CHINESE = [
    /^(?:请)?(?:保存|存一下|保存一下)(?:它|这个|这条)?[。！!]?$/u,
    /(?:保存|存下|存到|写入|写到|记到|记录到|落到|追加|加到|新建|创建|更新|修改|插入|替换|删除|移除|设置|变更|更改).{0,60}(?:笔记|知识库|属性|正文|文件|Markdown)/u,
    /(?:把|将).{0,100}(?:保存|存下|存到|写入|写到|记到|记录到|落到|追加|加到|新建|创建|更新|修改|插入|替换|删除|移除|设置|变更|更改)/u,
    /(?:在|向).{0,40}(?:笔记|知识库|正文|文件|Markdown).{0,80}(?:保存|存下|存到|写入|写到|记到|记录到|落到|追加|加到|新建|创建|更新|修改|插入|替换|删除|移除|设置|变更|更改)/u,
    /(?:保存|存下)(?:这个|这条|这些|以上|上述|刚才|上一条|结论|内容|方案|决定)/u,
    /(?:保存|存下|存到|写入|写到|记到|记录到|落到|追加|加到|新建|创建|更新|修改|插入|替换|删除|移除|设置|变更|更改).{0,100}[^\s"'`<>|]+\.md\b/iu,
    /[^\s"'`<>|]+\.md\b.{0,80}(?:保存|存下|存到|写入|写到|记到|记录到|落到|追加|加到|新建|创建|更新|修改|插入|替换|删除|移除|设置|变更|更改)/iu,
];

const OPERATIONS_WRITE_ACTION_ENGLISH_SOURCE = "save|store|persist|write|create|append|add|update|edit|insert|replace|set|change|remove|delete";
const OPERATIONS_WRITE_ACTION_CHINESE_SOURCE = "保存|存下|存到|写入|写到|记到|记录到|落到|追加|加到|新建|创建|更新|修改|插入|替换|设置|变更|更改|移除|删除";
const OPERATIONS_WRITE_ACTION_ENGLISH = new RegExp(`\\b(?:${OPERATIONS_WRITE_ACTION_ENGLISH_SOURCE})\\b`, "iu");
const OPERATIONS_WRITE_ACTION_CHINESE = new RegExp(`(?:${OPERATIONS_WRITE_ACTION_CHINESE_SOURCE})`, "u");
const OPERATIONS_WRITE_NEGATION_ENGLISH = /\b(?:do\s+not|don't|never|should\s+not|shouldn't|must\s+not|mustn't|need\s+not|no\s+need\s+to|without)\b/iu;
const OPERATIONS_WRITE_NEGATION_CHINESE = /(?:不要|别|无需|不用|不必|不应|不应该|不可|禁止)/u;
const OPERATIONS_EXPLICIT_WRITE_ENGLISH = new RegExp([
    `^(?:(?:please|just|only)\\s+)?(?:${OPERATIONS_WRITE_ACTION_ENGLISH_SOURCE})\\b`,
    `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:${OPERATIONS_WRITE_ACTION_ENGLISH_SOURCE})\\b`,
    `^i\\s+(?:want|need|would\\s+like)\\s+(?:you\\s+)?to\\s+(?:${OPERATIONS_WRITE_ACTION_ENGLISH_SOURCE})\\b`,
    `^(?:in\\s+)?[^\\n]{0,120}\\.md\\b(?:\\s+(?:after|before|under|at)\\s+[^,;.!?\\n]{1,40})?[\\s,:-]{0,8}(?:please\\s+)?(?:${OPERATIONS_WRITE_ACTION_ENGLISH_SOURCE})\\b`,
    `^(?:in|within)\\s+(?:the\\s+)?(?:(?:current|existing)\\s+)?(?:note|file|markdown)\\b(?:\\s+(?:after|before|under|at)\\s+[^,;.!?\\n]{1,40})?[\\s,:-]{0,8}(?:please\\s+)?(?:${OPERATIONS_WRITE_ACTION_ENGLISH_SOURCE})\\b`,
].join("|"), "iu");
const OPERATIONS_EXPLICIT_WRITE_CHINESE = new RegExp([
    `^(?:(?:请|请帮我|帮我|麻烦你?|可以帮我|能否帮我|只需|只)\\s*)?(?:${OPERATIONS_WRITE_ACTION_CHINESE_SOURCE})`,
    `^(?:(?:请|我想|我要|我需要)\\s*)?(?:把|将).{0,120}(?:${OPERATIONS_WRITE_ACTION_CHINESE_SOURCE})`,
    `^[^\\n]{0,120}\\.md\\b(?:中|里|内|\\s*的?(?:末尾|开头|尾部|顶部)|\\s*的?[^，,。；;]{1,40}(?:后|前|下))?[\\s，,:：-]*(?:(?:请)?(?:${OPERATIONS_WRITE_ACTION_CHINESE_SOURCE})|(?:请)?(?:把|将).{0,80}(?:${OPERATIONS_WRITE_ACTION_CHINESE_SOURCE}))`,
    `^(?:请)?(?:在|向).{0,40}(?:笔记|知识库|正文|文件|Markdown)(?:中|里|内|的[^，,。；;]{0,30})?[\\s，,:：-]*(?:(?:请)?(?:${OPERATIONS_WRITE_ACTION_CHINESE_SOURCE})|(?:请)?(?:把|将).{0,80}(?:${OPERATIONS_WRITE_ACTION_CHINESE_SOURCE}))`,
].join("|"), "iu");

function operationsWriteIntentCandidates(input: string): string[] {
    const candidates = new Set<string>();
    const clauses = input.split(/[;；。！？!?\n]+|\.(?=\s|$)/u);
    for (const clause of clauses) {
        const trimmed = clause.trim();
        if (!trimmed) continue;
        candidates.add(trimmed);
        if (isOperationsInstructionalScope(trimmed)) continue;
        const boundaryPattern = isOperationsNegationScope(trimmed)
            ? /,\s*(?:and\s+)?(?:just|only)\b|，\s*(?:只需|只要|只|就)|\b(?:but|instead)\b|(?:但是|但|而是)/giu
            : new RegExp([
                ",\\s*(?:and\\s+)?(?:just|only)\\b",
                "，\\s*(?:只需|只要|只|就)",
                `\\band\\s+(?=(?:please\\s+)?(?:${OPERATIONS_WRITE_ACTION_ENGLISH_SOURCE})\\b)`,
                "\\b(?:and\\s+then|then|after\\s+that|but|instead)\\b",
                "(?:然后|接着|随后|但是|但|而是)",
            ].join("|"), "giu");
        let segmentStart = 0;
        for (const boundary of trimmed.matchAll(boundaryPattern)) {
            const boundaryIndex = boundary.index ?? 0;
            const segment = trimmed.slice(segmentStart, boundaryIndex).trim();
            if (segment) candidates.add(segment);
            segmentStart = boundaryIndex + boundary[0].length;
        }
        const tail = trimmed.slice(segmentStart).trim();
        if (tail) candidates.add(tail);
    }
    return [...candidates];
}

function isOperationsInstructionalScope(candidate: string): boolean {
    return /^(?:how\s+(?:do|can|should)\s+i|(?:should|can|could|would)\s+i)\b/iu.test(candidate)
        || /^(?:what|which|why|when|where)\s+(?:is|are|do|does|would|should|can|could)\b/iu.test(candidate)
        || /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:explain|describe|teach|translate|quote|proofread)\b/iu.test(candidate)
        || /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:show|tell)\s+me\s+(?:how|why|when|whether|the\s+(?:steps?|method|way))\b/iu.test(candidate)
        || /^(?:如何|怎么|怎样|是否|要不要|可否)/u.test(candidate)
        || /^(?:请)?(?:解释|说明|描述|教我|翻译|改写|润色|校对|引用)/u.test(candidate)
        || /^(?:请)?(?:把|将)\s*[“"'`].{0,240}[”"'`]\s*(?:翻译|改写|润色|校对|解释|说明)(?:成|为|一下)?/u.test(candidate)
        || /^(?:请)?(?:告诉我|展示|演示)(?:如何|怎么|怎样|为什么|何时|是否)/u.test(candidate);
}

function isOperationsInstructionalCandidate(candidate: string): boolean {
    return isOperationsInstructionalScope(candidate)
        || /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:show|tell)\b/iu.test(candidate)
        || /^(?:请)?(?:告诉我|展示|演示)/u.test(candidate);
}

function isOperationsNegationScope(candidate: string): boolean {
    return /^(?:please\s+)?(?:do\s+not|don't|never|need\s+not|no\s+need\s+to|without)\b/iu.test(candidate)
        || /^(?:请)?(?:不要|别|无需|不用|不必|不应|不应该|不可|禁止)/u.test(candidate);
}

function isOperationsWriteNegatedBeforeAction(candidate: string): boolean {
    const actionIndexes = [
        OPERATIONS_WRITE_ACTION_ENGLISH.exec(candidate)?.index,
        OPERATIONS_WRITE_ACTION_CHINESE.exec(candidate)?.index,
    ].filter((index): index is number => index !== undefined);
    if (actionIndexes.length === 0) return false;
    const firstActionIndex = Math.min(...actionIndexes);
    const negationIndexes = [
        OPERATIONS_WRITE_NEGATION_ENGLISH.exec(candidate)?.index,
        OPERATIONS_WRITE_NEGATION_CHINESE.exec(candidate)?.index,
    ].filter((index): index is number => index !== undefined);
    return negationIndexes.some((index) => index < firstActionIndex);
}

/** Latest-message-only discovery gate; it exposes schemas but never authorizes a write. */
export function hasOperationsWriteIntent(userInput: string): boolean {
    const input = userInput.trim();
    if (!input) return false;
    const writeIntentPatterns = [...OPERATIONS_WRITE_INTENT_ENGLISH, ...OPERATIONS_WRITE_INTENT_CHINESE];
    return operationsWriteIntentCandidates(input).some((candidate) => (
        !isOperationsInstructionalCandidate(candidate)
        && !isOperationsWriteNegatedBeforeAction(candidate)
        && (OPERATIONS_EXPLICIT_WRITE_ENGLISH.test(candidate) || OPERATIONS_EXPLICIT_WRITE_CHINESE.test(candidate))
        && writeIntentPatterns.some((pattern) => pattern.test(candidate))
    ));
}

function includeOperationsInToolUseConstraints(
    constraints: PaAgentToolUseConstraints | undefined,
    includeOperations: boolean,
): PaAgentToolUseConstraints | undefined {
    if (!includeOperations || !constraints?.allowedToolNames) return constraints;
    return {
        ...constraints,
        allowedToolNames: new Set([
            ...constraints.allowedToolNames,
            ...CORE_WRITE_TOOL_NAMES,
        ]),
    };
}

function createPaAgentToolUseConstraints(userInput: string): PaAgentToolUseConstraints | undefined {
    const blockedToolNames = new Set<string>(getExplicitlySuppressedRequiredCapabilities(userInput));
    if (isExplicitCurrentNoteOnlyRequest(userInput)) {
        return {
            allowedToolNames: new Set(["get_current_note_context"]),
            blockedToolNames,
        };
    }
    if (isExplicitNotesOnlyRequest(userInput)) {
        blockedToolNames.add("webSearch");
        blockedToolNames.add("get_current_note_context");
        return {
            allowedToolNames: new Set(["search_memory"]),
            blockedToolNames,
        };
    }
    return blockedToolNames.size > 0 ? { blockedToolNames } : undefined;
}

function createPaAgentToolConstraintRuntimeInstruction(
    constraints: PaAgentToolUseConstraints | undefined,
): string | undefined {
    if (!constraints?.blockedToolNames?.has("webSearch")) return undefined;
    return [
        "The user explicitly forbids web or internet access for this request.",
        "Do not call webSearch and do not claim webSearch is available in this run.",
        "Ignore any prior assistant message that described webSearch as available for a different run.",
        "If a live or current external fact cannot be verified without web access, say that directly and answer only from non-web context or prior conversation when appropriate.",
    ].join(" ");
}

function combineRuntimeInstructions(instructions: Array<string | undefined>): string | undefined {
    const parts = instructions
        .map((instruction) => instruction?.trim())
        .filter((instruction): instruction is string => !!instruction);
    return parts.length > 0 ? parts.join(" ") : undefined;
}

function isExplicitNotesOnlyRequest(userInput: string): boolean {
    const normalized = userInput.toLowerCase();
    return /\b(only|just)\s+(from|use|using|search)\s+(my\s+)?(notes|vault|memory)\b/.test(normalized)
        || /\b(from|in)\s+my\s+(notes|vault|memory)\s+only\b/.test(normalized)
        || [
            "只从我的笔记",
            "仅从我的笔记",
            "只从笔记",
            "仅从笔记",
            "只看我的笔记",
            "仅看我的笔记",
        ].some((token) => userInput.includes(token));
}

function filterToolDefinitionsByToolUseConstraints(
    definitions: ChatToolRegistryDefinition[],
    constraints?: PaAgentToolUseConstraints,
): ChatToolRegistryDefinition[] {
    if (!constraints) return definitions;
    return definitions.filter((definition) => isToolAllowedByToolUseConstraints(definition.name, constraints));
}

function isToolAllowedByToolUseConstraints(
    toolName: string,
    constraints: PaAgentToolUseConstraints,
): boolean {
    if (constraints.allowedToolNames && !constraints.allowedToolNames.has(toolName)) return false;
    if (constraints.blockedToolNames?.has(toolName)) return false;
    return true;
}

function getCanonicalToolCallDeltas(
    chunk: unknown,
    streamedToolNames: Map<string, string>,
): PaAgentModelStreamChunk[] {
    // Prefer tool_call_chunks (LangChain raw streaming format) over tool_calls.
    // tool_calls includes both LangChain's pre-parsed entries (args already an object)
    // AND additional_kwargs.tool_calls (raw OpenAI-format string fragments). Combining
    // both sources causes double-accumulation of argument fragments in the same buffer.
    const rawChunks = getNativeToolCallArray(chunk, "tool_call_chunks");
    const toolCallEntries = rawChunks.length > 0
        ? rawChunks
        : getNativeToolCallArray(chunk, "tool_calls");
    return toolCallEntries.flatMap((entry): PaAgentModelStreamChunk[] => {
        const record = asRecord(entry);
        const functionRecord = asRecord(record?.function);
        const rawArgs = record?.args ?? record?.arguments ?? functionRecord?.arguments;
        const key = getOrCreateStreamingToolCallKey(record, functionRecord, rawArgs, streamedToolNames);
        const explicitName = readNativeToolCallName(record, functionRecord);
        if (explicitName && key) {
            streamedToolNames.set(key, explicitName);
            // Cross-register under index key so subsequent index-only streaming
            // deltas can resolve the name (first chunk often has both id + index,
            // while follow-up chunks only carry index).
            const recordIndex = record?.index;
            if (typeof recordIndex === "number") {
                const indexKey = `index:${recordIndex}`;
                if (indexKey !== key) {
                    streamedToolNames.set(indexKey, explicitName);
                }
            }
        }
        const name = explicitName || (key ? streamedToolNames.get(key) : undefined);
        if (!name) return [];
        const delta: Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }> = {
            type: "toolcall_delta",
            name,
            ...getStreamingToolCallIdentity(record, key),
        };
        if (typeof rawArgs === "string") {
            delta.argsText = rawArgs;
        } else if (rawArgs !== undefined && rawArgs !== null && rawArgs !== "") {
            delta.input = rawArgs;
        }
        return [delta];
    });
}

const STREAMING_TOOL_CALL_LAST_KEY = "__pa_last_tool_call_key__";
const STREAMING_TOOL_CALL_NEXT_ORDER = "__pa_next_tool_call_order__";

function getOrCreateStreamingToolCallKey(
    record: Record<string, unknown> | undefined,
    functionRecord: Record<string, unknown> | undefined,
    rawArgs: unknown,
    streamedToolNames: Map<string, string>,
): string | undefined {
    const explicitKey = getStreamingToolCallKey(record);
    const name = readNativeToolCallName(record, functionRecord);
    if (explicitKey) {
        const lastKey = streamedToolNames.get(STREAMING_TOOL_CALL_LAST_KEY);
        if (
            name
            && lastKey
            && streamedToolNames.get(lastKey) === name
            && typeof record?.index !== "number"
            && !hasMeaningfulStreamingToolArgs(rawArgs)
        ) {
            streamedToolNames.set(STREAMING_TOOL_CALL_LAST_KEY, lastKey);
            return lastKey;
        }
        streamedToolNames.set(STREAMING_TOOL_CALL_LAST_KEY, explicitKey);
        return explicitKey;
    }
    if (name) {
        const lastKey = streamedToolNames.get(STREAMING_TOOL_CALL_LAST_KEY);
        if (lastKey && streamedToolNames.get(lastKey) === name) {
            streamedToolNames.set(STREAMING_TOOL_CALL_LAST_KEY, lastKey);
            return lastKey;
        }
        const nextOrder = readNextStreamingToolCallOrder(streamedToolNames);
        const syntheticKey = `order:${nextOrder}`;
        streamedToolNames.set(STREAMING_TOOL_CALL_NEXT_ORDER, String(nextOrder + 1));
        streamedToolNames.set(STREAMING_TOOL_CALL_LAST_KEY, syntheticKey);
        return syntheticKey;
    }
    return streamedToolNames.get(STREAMING_TOOL_CALL_LAST_KEY);
}

function hasMeaningfulStreamingToolArgs(value: unknown): boolean {
    if (value === null || value === undefined || value === "") return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.some(hasMeaningfulStreamingToolArgs);
    if (typeof value === "object") {
        return Object.values(value as Record<string, unknown>).some(hasMeaningfulStreamingToolArgs);
    }
    return true;
}

function readNextStreamingToolCallOrder(streamedToolNames: Map<string, string>): number {
    const raw = Number(streamedToolNames.get(STREAMING_TOOL_CALL_NEXT_ORDER) ?? "0");
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

function getStreamingToolCallIdentity(
    record: Record<string, unknown> | undefined,
    key: string | undefined,
): Pick<Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }>, "id" | "index"> {
    if (key?.startsWith("id:")) return { id: key.slice(3) };
    if (key?.startsWith("index:")) {
        const index = Number(key.slice(6));
        return Number.isFinite(index) ? { index } : {};
    }
    if (key?.startsWith("order:")) {
        const index = Number(key.slice(6));
        return Number.isFinite(index) ? { index } : {};
    }
    const recordId = typeof record?.id === "string" && record.id.trim() ? record.id.trim() : undefined;
    if (recordId) return { id: recordId };
    if (typeof record?.index === "number") return { index: record.index };
    return {};
}

function getStreamingToolCallKey(record: Record<string, unknown> | undefined): string | undefined {
    if (!record) return undefined;
    if (typeof record.id === "string" && record.id.trim()) return `id:${record.id.trim()}`;
    if (typeof record.index === "number") return `index:${record.index}`;
    return undefined;
}

function getNativeToolCallArray(chunk: unknown, key: "tool_calls" | "tool_call_chunks"): unknown[] {
    if (!chunk || typeof chunk !== "object") return [];
    const record = chunk as Record<string, unknown>;
    const direct = Array.isArray(record[key]) ? record[key] : [];
    const additionalKwargs = record.additional_kwargs;
    const nested = additionalKwargs && typeof additionalKwargs === "object"
        && Array.isArray((additionalKwargs as Record<string, unknown>)[key])
        ? (additionalKwargs as Record<string, unknown>)[key] as unknown[]
        : [];
    return [...direct, ...nested];
}

function getReasoningContent(chunk: unknown): string {
    const additionalKwargs = chunk && typeof chunk === "object"
        ? (chunk as { additional_kwargs?: Record<string, unknown> }).additional_kwargs
        : undefined;
    const reasoning = additionalKwargs?.reasoning_content;
    return typeof reasoning === "string" ? reasoning : "";
}

function stringifyChunkContent(chunk: unknown): string {
    const content = chunk && typeof chunk === "object"
        ? (chunk as { content?: unknown }).content
        : undefined;
    return stringifyModelContent(content);
}

function createAgentRunId(): string {
    return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isHostRetrievalFlagEnabled(
    host: AiServiceHost,
    flag: keyof RetrievalOptimizationFlags,
): boolean {
    return resolveB125RetrievalOptimizationFlags(
        host.getRetrievalOptimizationFlags?.()
        ?? host.settings.retrievalOptimizationFlags,
    )[flag];
}

function getHostRetrievalPolicyEpoch(host: AiServiceHost): string {
    const liveEpoch = host.getRetrievalOptimizationEpoch?.();
    if (liveEpoch) return liveEpoch;
    const flags = resolveB125RetrievalOptimizationFlags(
        host.getRetrievalOptimizationFlags?.()
        ?? host.settings.retrievalOptimizationFlags,
    );
    return [
        "legacy-retrieval-flags",
        flags?.lexicalProfile === true ? "1" : "0",
        flags?.strictReranker === true ? "1" : "0",
        flags?.graphPpr === true ? "1" : "0",
        flags?.relaxedRecovery === true ? "1" : "0",
    ].join(":");
}

/**
 * P0-D: Drives `chain.stream()` and transparently falls back to `chain.invoke()` when streaming
 * fails before any visible chunk has been emitted. Fallback only fires when
 * {@link canFallbackToNonStreaming} says it's safe — abort errors and post-output failures rethrow.
 *
 * Exported for testing; the production caller is the PA Agent canonical model in
 * `streamCanonicalPaAgentRun`. The helper deliberately holds no closure over runtime state so
 * unit tests can drive it with a stub chain.
 */
export async function* streamWithInvokeFallback(args: {
    chain: NativeToolStreamingAndInvocableRunnable;
    input: unknown;
    signal?: AbortSignal;
    streamedToolNames?: Map<string, string>;
    onFallback?: (reason: StreamWithInvokeFallbackReason, error: unknown) => void;
    prepareInvokeInput?: () => unknown | PromiseLike<unknown>;
}): AsyncGenerator<PaAgentModelStreamChunk, void, unknown> {
    const { chain, input, signal, onFallback } = args;
    const streamedToolNames = args.streamedToolNames ?? new Map<string, string>();
    let receivedAnyVisibleOutput = false;

    let stream: AsyncIterable<unknown>;
    try {
        stream = await chain.stream(input, { signal });
    } catch (error) {
        if (canFallbackToNonStreaming(error, receivedAnyVisibleOutput, signal)) {
            onFallback?.("stream_setup_failed", error);
            const invokeInput = args.prepareInvokeInput
                ? await args.prepareInvokeInput()
                : input;
            throwIfAborted(signal);
            yield* invokeAsModelChunks(chain, invokeInput, signal, streamedToolNames);
            return;
        }
        throw error;
    }

    try {
        for await (const chunk of stream) {
            throwIfAborted(signal);
            const providerUsage = extractProviderUsage(chunk);
            if (providerUsage) {
                yield { type: "diagnostic", diagnostic: { type: "provider_usage", usage: providerUsage } };
            }
            const reasoning = getReasoningContent(chunk);
            if (reasoning) {
                receivedAnyVisibleOutput = true;
                yield { type: "thinking_delta", text: reasoning };
            }
            const content = stringifyChunkContent(chunk);
            if (content) {
                receivedAnyVisibleOutput = true;
                yield { type: "text_delta", text: content };
            }
            for (const toolDelta of getCanonicalToolCallDeltas(chunk, streamedToolNames)) {
                receivedAnyVisibleOutput = true;
                yield toolDelta;
            }
        }
    } catch (error) {
        if (canFallbackToNonStreaming(error, receivedAnyVisibleOutput, signal)) {
            onFallback?.("stream_iteration_failed", error);
            const invokeInput = args.prepareInvokeInput
                ? await args.prepareInvokeInput()
                : input;
            throwIfAborted(signal);
            yield* invokeAsModelChunks(chain, invokeInput, signal, streamedToolNames);
            return;
        }
        throw error;
    }
}

async function* invokeAsModelChunks(
    chain: NativeToolStreamingAndInvocableRunnable,
    input: unknown,
    signal: AbortSignal | undefined,
    streamedToolNames: Map<string, string>,
): AsyncGenerator<PaAgentModelStreamChunk, void, unknown> {
    const response = await chain.invoke(input, signal ? { signal } : undefined);
    throwIfAborted(signal);
    const providerUsage = extractProviderUsage(response);
    if (providerUsage) {
        yield { type: "diagnostic", diagnostic: { type: "provider_usage", usage: providerUsage } };
    }
    const reasoning = getReasoningContent(response);
    if (reasoning) {
        yield { type: "thinking_delta", text: reasoning };
    }
    const content = stringifyChunkContent(response);
    if (content) {
        yield { type: "text_delta", text: content };
    }
    for (const toolDelta of getCanonicalToolCallDeltas(response, streamedToolNames)) {
        yield toolDelta;
    }
}

function extractProviderUsage(value: unknown): PaAgentProviderUsage | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const responseMetadata = asRecord(record.response_metadata);
    const additionalKwargs = asRecord(record.additional_kwargs);
    const usageCandidates = [
        record.usage_metadata,
        record.usage,
        additionalKwargs?.usage,
        responseMetadata?.usage,
        responseMetadata?.tokenUsage,
        responseMetadata?.token_usage,
        asRecord(record.llm_output)?.tokenUsage,
    ];

    for (const candidate of usageCandidates) {
        const usage = normalizeProviderUsage(candidate);
        if (usage) return usage;
    }
    return undefined;
}

function readProviderUsageDiagnostic(chunk: PaAgentModelStreamChunk): PaAgentProviderUsage | undefined {
    if (chunk.type !== "diagnostic") return undefined;
    const diagnostic = asRecord(chunk.diagnostic);
    if (diagnostic?.type !== "provider_usage") return undefined;
    return normalizeProviderUsage(diagnostic.usage);
}

function normalizeProviderUsage(value: unknown): PaAgentProviderUsage | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const usage: PaAgentProviderUsage = {};
    const promptTokens = firstFiniteNumber(record, ["promptTokens", "prompt_tokens", "inputTokens", "input_tokens"]);
    const completionTokens = firstFiniteNumber(record, [
        "completionTokens",
        "completion_tokens",
        "outputTokens",
        "output_tokens",
    ]);
    const totalTokens = firstFiniteNumber(record, ["totalTokens", "total_tokens"]);
    if (promptTokens !== undefined) usage.promptTokens = promptTokens;
    if (completionTokens !== undefined) usage.completionTokens = completionTokens;
    if (totalTokens !== undefined) {
        usage.totalTokens = totalTokens;
    } else if (promptTokens !== undefined || completionTokens !== undefined) {
        usage.totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
    }
    return Object.keys(usage).length > 0 ? usage : undefined;
}

function firstFiniteNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
}

function stringifyModelContent(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map(stringifyModelContentPart).join("\n").trim();
    }
    if (content === null || content === undefined) {
        return "";
    }
    try {
        return JSON.stringify(content);
    } catch {
        return "[unserializable content]";
    }
}

function stringifyModelContentPart(part: ModelContentPart): string {
    if (typeof part === "string") {
        return part;
    }
    if (typeof part.text === "string") {
        return part.text;
    }
    if (typeof part.content === "string") {
        return part.content;
    }
    return JSON.stringify(part);
}

export {
    MemorySearchTool,
    parseRerankResponse,
    normalizeSearchCandidates,
    type RawSearchResult,
} from "./memory-search-tool";
export { CanonicalToLegacyEventAdapter } from "./pa-agent-stream-bridge";
export {
    PA_AGENT_ANSWER_STREAM_SYSTEM_PROMPT_LINES,
    createOperationsPromptGuidance,
    formatCanonicalChatHistory,
    formatToolObservations,
    formatSkillCatalog,
} from "./pa-agent-prompts";

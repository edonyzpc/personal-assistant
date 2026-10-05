
import type {
    AIUtils,
    NativeToolCallingValidation,
    QwenRequestOptions,
} from "./ai-utils";
import { resolvePaAgentModelBudgetFacts } from "./ai-utils";
import { PaAgentRunUsageLedger, type PaAgentUsageLedgerSnapshot } from './agent-usage-ledger';
import type { AiServiceHost, RetrievalOptimizationFlags } from "./AiServiceHost";
import type { MemoryMode } from "../memory-manager";
import { createAgentDebugLog, createAgentEventDebugObserver, describeAgentError, traceAgentPhase } from './pa-agent-debug';
import type { AgentDebugCallScope, AgentDebugRunRecorder } from './agent-debug-port';
import { agentDebugError, agentDebugNow, createAgentDebugCall, observeAgentDebugCall,
    observeAgentDebugLifecycle, observeAgentDebugPhase, observeAgentDebugResponse,
    beginAgentDebugResponsePhase, finishAgentDebugResponsePhase } from './agent-debug-observation';
import { getProviderAdmissionError, ProviderAdmissionError, ProviderInputReprepareRequiredError } from './provider-admission-error';
import { resolveB125RetrievalOptimizationFlags } from "../retrieval-optimization-platform-policy";
import type { PageletChatHandoffContext } from "./pagelet-handoff";
import { stableHash } from "../pa/helpers";
import { MemorySearchTool } from "./memory-search-tool";
import { TaskSourceRun, historyInputLineage } from "./task-source-run";
import { parseRunSourceSelection } from './chat-source-scope';
import { cloneInputLineage, completeInputLineage, sourceRecordsInputLineage,
    toGenerationInputLineage, unionInputLineages, unknownInputLineage,
    resolveWritingVersionInputLineage, writingVersionInputLineage,
    type InputLineage, type InputDependency } from './input-lineage';
import { WritingContextRun, writingContextObservation, type WritingContextRunHost } from "./writing-context-run";
import { createWritingContextCapability, GET_WRITING_CONTEXT } from "./writing-context-tool";
import { createWritingHistoryTool, type WritingHistoryHost, type WritingHistoryAdmission } from './writing-history-tool';
import { createImageStatusTool, isImageStatusObservation, type ImageStatusHost } from './image-status-tool';
import {
    createOperationsStatusTool,
    isOperationsStatusObservation,
    type OperationsStatusHost,
} from './operations-status-tool';
import { createTaskSourceConstrainedExecutor } from "./task-source-executor";
import { ChatMemoryRecoveryCoordinator } from "./retrieval-recovery-coordinator";
import type { RetrievalDiagnosticEventInput } from "./retrieval-diagnostics";
import {
    createPaAgentAnswerStreamPrompt,
    buildPaAgentFinalMessagesAsync,
    createOperationsPromptGuidance,
    formatCanonicalHostContext,
    formatSkillCatalog,
    formatToolObservations,
    formatToolObservationsAsync,
    measurePaAgentRequestEnvelopeAsync,
    estimatePaAgentTextTokensAsync,
    type PaAgentRequestEnvelopeEstimate,
} from "./pa-agent-prompts";
import { canonicalContextJsonAsync, stringifyContextAsync } from './context/PaAgentContextSerialization';
import { createCooperativeTask } from './cooperative-task';
import { projectPaAgentToolStatus, type PaAgentActionGroup } from "./pa-agent-action-history";
import { cloneActionStateBinding, isSafeImageAcceptedObservation, isSafeImageFailureObservation, isSafeOperationsStagedObservation } from './pa-agent-result-facts';
import { cloneChatHostProvenance } from './chat-provenance';
import { historySummaryContentSteps, protectedHistorySourceIndexesSteps, type ColdWritingVersion } from './context/PaAgentHistoryContextPlan';
import { ChatOpenAI } from "@langchain/openai";
import {
    type ChatToolProviderSchema,
    createCurrentNoteContextTool,
    createInspectObsidianNoteTool,
    createListRecentNotesTool,
    createListVaultTagsTool,
    createReadCanvasSummaryTool,
    createReadNoteTool,
    createReadNoteOutlineTool,
    createSearchMemoryTool,
    createSearchVaultMetadataTool,
    createSearchVaultSnippetsTool,
    createQueryNotesTool,
    createCreateImageTool,
    createPrepareGhostPostTool,
    type CreateImageHostBinding,
    type GhostHostBinding,
    type ChatToolRegistryDefinition,
} from "./chat-tools";
import {
    AgentEventEmitter,
    TurnExecutionDeadline,
} from "./agent-runtime-primitives";
import { PaAgentContextSummarizer,
    type PaAgentSummaryInvoke } from "./context/PaAgentContextSummarizer";
import { resolvePaAgentInputTokenLimit, resolvePaAgentPromptCharCeiling,
    type PaAgentModelBudgetFacts } from "./context/PaAgentContextBudget";
import { cloneMessage, prepareContextSteps } from "./context/clone-utils";
import { getPaAgentToolSummaryCandidates } from './context/PaAgentContextCompactor';
import { isCurrentHistorySummary, isCurrentToolSummary, projectPaAgentSummaryActionStates,
    projectPaAgentRetainedActionFactsSteps, matchesPaAgentHistorySummaryPayloadSteps,
    type PaAgentContextSummaries, type PaAgentSummaryBindingSource, type PaAgentToolSummarySource } from "./context/PaAgentContextSummaryTypes";
import { chatHistoryImageMetadata } from "./chat-image-identity";
import { readChatHistoryTurnMetadata } from "./pa-agent-history";
import { stableJson, type VaultObservationProjection } from "./vault-observation-evidence";
import { cloneMessageImages, type MessageImage } from "../chat/image-types";
import {
    cloneGenerationInputBackgroundSources,
    cloneGenerationInputSnapshot,
    type GenerationInputBackgroundSources,
    type GenerationInputPageletSource,
    type GenerationInputSnapshot,
} from "./generation-input-snapshot";
import { CanonicalToLegacyEventAdapter } from "./pa-agent-stream-bridge";
import { readProviderCompletion, writingOutputInstruction, nativeWritingOutputInstruction, nativeWritingPreparationInstruction, nativeWritingOutputSchema, cloneChatWritingRequest, selectedWritingContext, isValidWritingContextHandle } from "./writing-output";
import { REPORT_TASK_INCOMPLETE, taskIncompleteOutputSchema } from './pa-agent-task-outcome';
import { NativeWritingCallCollector } from "./native-writing-call";
import { ChatImageRequestScope, createResolveChatImagesTool, RESOLVE_CHAT_IMAGES } from "./image-request";
import { ChatImageRequestError, isStructuredImageUnsupportedError, type ChatImageCapability } from "./image-capability";
import { formatInjectedContext, MEMORY_CONTEXT_MAX_CHARS } from "./context/PaAgentContextProjector";
import { WRITING_STYLE_MAX_CONTEXT_CHARS } from "../pa/writing-style";
import { BUNDLED_SKILL_RESOURCES } from "./bundled-skills";
import { CapabilityRegistry } from "./capability-registry";
import { createCoreToolCapabilities, createChatToolCapability } from "./capability-adapter";
import {
    createPaAgentCommandCapabilityScope,
    formatPaAgentCommandInvocationGuidance,
    type PaAgentCommandCapabilityScope,
    type PaAgentCommandInvocation,
} from "./pa-agent-command";
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
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from '../platform-dom';
import {
    createProviderRequestScope,
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
    createOperationsAcknowledgementControlSnapshot,
    hasOperationsStagedAcknowledgementInstruction,
    hasStagedOperationsIntent,
    isOperationsStagedAcknowledgement,
    OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION,
} from "./operations/operations-acknowledgement-policy";
import {
    chatToolResultToPaAgentToolExecutionResult,
    createPaAgentCapabilityToolExecutor,
    isAllowedHostToolCall,
    MemoryEvidenceRegistry,
} from "./pa-agent-host-tools";
import { createMemoryManagementTools } from "./memory-management-tools";
import { createInsightReadTools } from "./insight-read-tools";
import { createInsightActionTool } from "./insight-action-tool";
import { createMemoryActionTool } from "./memory-action-tools";
import {
    prepareMemoryManagementProjection,
    type MemoryManagementProjection,
} from "./memory-management-evidence";
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
import { createPaAgentHostPolicy } from './pa-agent-host-policy';
import { isLiveHostBatchPreflightRejection } from './pa-agent-preflight-facts';
import {
    PaAgentLoop,
    isProviderContextOverflow,
    type PaAgentLoopResult,
    type PaAgentModel,
    type PaAgentModelInput,
    type PaAgentModelStreamChunk,
    type PaAgentTurnLeaseProvider,
    type PaAgentToolExecutor,
} from "./pa-agent-loop";
import {
    PaAgentContextManager,
    PaAgentContextOverflowError,
    type PaAgentInjectedContext,
    type PaAgentProviderUsage,
} from "./context";
import {
    createInitialAgentControlSnapshot,
    toolConstraintsFromAgentControlSnapshot,
} from "./pa-agent-control-policy";
import type {
    AgentEvent,
    LegacyAgentEvent,
    ChatAgentStatus,
    ChatMessage,
    PaAgentMessage,
} from "./chat-types";
import { isChatToolFailureReason } from './chat-types';

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
    /** Exact user-authored text before Chat appends capability instructions. */
    userText?: string;
    /** Host-provided actual lineage for an app-prefilled or explicitly sourced first request. */
    inputLineage?: import('./input-lineage').InputLineage;
    /** Chat-only Host snapshot; omission preserves standalone caller behavior. */
    runSourceSelection?: import('./chat-source-scope').RunSourceSelection;
    chatHistory?: ChatMessage[];
    images?: import("../chat/image-types").MessageImage[];
    imageAssetService?: import("../chat/image-assets").ImageAssetService;
    writingRequest?: import("./chat-types").ChatWritingRequest;
    writingContext?: import("./chat-types").ChatWritingContext;
    writingMaterialContext?: import("./chat-types").ChatWritingMaterialContext;
    /** Host-authorized candidates and semantic style reader; consumed only by the native candidate. */
    writingContextHost?: Omit<WritingContextRunHost, "runId" | "verifyImages">;
    writingHistoryHost?: Omit<WritingHistoryHost, 'admitVersion' | 'onObservation'> & { isSourceCurrent?: () => boolean };
    imageStatus?: ImageStatusHost & { conversationId: string };
    operationsStatus?: OperationsStatusHost & { conversationId: string };
    /** Host-owned model/conversation epoch; checked at physical dispatch. */
    isCurrent?: () => boolean;
    /** Existing or reserved Chat conversation identity; never fabricated for standalone runs. */
    conversationId?: string;
    /** Host-bound command identity; capability declarations alone grant no authority. */
    commandInvocation?: PaAgentCommandInvocation;
    /** Explicit app-owned command template; kept out of the raw user input channel. */
    commandGuidance?: string;
    /** Stable host-only identity and durable dispatch port for one user image request. */
    createImage?: CreateImageHostBinding;
    /** One explicit Chat publishing request; never inferred from skill content. */
    ghostPublishing?: GhostHostBinding;
    imageCapability?: { get: () => ChatImageCapability; onSuccess: () => void; onError: (error: unknown) => void };
    memoryMode: MemoryMode;
    /** Visible Pagelet evidence. It is context-only and never grants tool authority. */
    pageletHandoff?: PageletChatHandoffContext;
    signal?: AbortSignal;
    /** Operation admission for each provider/tool turn; never held across host recovery or user waiting. */
    turnLeaseProvider?: PaAgentTurnLeaseProvider;
    onStatus?: (status: ChatAgentStatus) => void;
}

export interface PaAgentStreamOptions extends PaAgentRunOptions {
    /** In-memory owner bindings, never persisted or supplied by a model. */
    coldWritingVersions?: ReadonlyMap<string, ColdWritingVersion>;
    protectedWritingVersionIds?: ReadonlySet<string>;
    /** Run-local request to compact after the provider rejected its context window. */
    recoveryRequested?: boolean;
    recoveryMaxPromptChars?: number;
    /** Explicit Chat ownership; standalone/background runs never inherit a global observer. */
    debugRecorder?: AgentDebugRunRecorder;
    /** Content-free, run-local accounting report for evaluation and diagnostics. */
    onUsageAccounting?: (snapshot: PaAgentUsageLedgerSnapshot) => void;
    /** Debug correlation with the service's pre-runtime lease wait. Never enters model input. */
    debugRequestId?: string;
    /** Host-only writing output selection. Production Chat enables native after B-135 validation. */
    writingOutputProtocol?: "native";
    /** Internal projection value, resolved from the run receipt rather than model input. */
    writingContextHandle?: string;
    /** Internal per-turn budget override. Never increases the normal history allowance. */
    historyBudgetChars?: number;
    qwenRequestOptions?: QwenRequestOptions;
    onLifecycleEvent?: (event: AgentEvent) => void;
    onCommittedFinalText?: (snapshot: string) => void;
    onEvent?: (event: LegacyAgentEvent) => void;
}

export interface PaAgentRuntimeOptions {
    /** Conversation-owned derived cache. A standalone runtime owns its own instance. */
    contextSummarizer?: PaAgentContextSummarizer;
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
     * (kind="action" rejected; fixed domain tools retain narrow host ports).
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

interface PaAgentStartupTiming {
    phase: string;
    elapsedMs: number;
    metadata?: Record<string, unknown>;
}

const MAX_TURN_WALL_CLOCK_MS = Number.POSITIVE_INFINITY;
const DEFAULT_FINALIZATION_RESERVE_MS = 15_000;
const MAX_CHAT_HISTORY_CHARS = 60_000;
const MAX_PA_AGENT_PROMPT_CHARS = 120_000;
const BASE_VAULT_READ_TOOL_NAMES = [
    "search_vault_metadata",
    "list_recent_notes",
    "read_note_outline",
    "inspect_obsidian_note",
    "read_canvas_summary",
    "search_vault_snippets",
    "list_vault_tags",
] as const;
// Keep this security admission explicit; adding a read tool to exposure alone
// must not make its errors source-free observations.
const SOURCE_FREE_VAULT_FAILURE_LABELS: ReadonlyMap<string, string> = new Map([
    ["search_vault_metadata", "Vault metadata unavailable"],
    ["search_vault_snippets", "Note snippets unavailable"],
    ["query_notes", "Read-only tool unavailable"],
    ["list_vault_tags", "Vault tags unavailable"],
    ["list_recent_notes", "Recent notes unavailable"],
    ["read_note", "Read-only tool unavailable"],
    ["read_note_outline", "Note outline unavailable"],
    ["inspect_obsidian_note", "Note structure unavailable"],
    ["read_canvas_summary", "Canvas structure unavailable"],
]);
const APPROVED_FIRST_TURN_READ_TOOL_NAMES = [
    "search_memory",
    "get_memory_status",
    "query_memories",
    "get_memory_usage",
    "get_vault_insights",
    "query_saved_insights",
    "get_current_note_context",
    "query_notes",
    "read_note",
    ...BASE_VAULT_READ_TOOL_NAMES,
    "webSearch",
] as const;
const NOTE_SOURCE_TOOL_NAMES = [
    'search_memory', 'get_memory_status', 'query_memories', 'get_memory_usage',
    'manage_memory', 'get_vault_insights', 'query_saved_insights', 'manage_saved_insight',
    'get_current_note_context', 'query_notes', 'read_note', ...BASE_VAULT_READ_TOOL_NAMES,
] as const;

class OperationsTurnPolicyEngine extends PolicyEngine {
    private actionsAllowedForTurn = false;

    constructor(options: PolicyEngineOptions, private readonly isEnabled: () => boolean) {
        super(options);
    }

    private allowsAction(capability: AgentCapability): boolean {
        return this.actionsAllowedForTurn && this.isEnabled()
            && CORE_WRITE_TOOL_NAMES.some((name) => name === capability.name);
    }

    setActionsAllowedForTurn(allowed: boolean): void {
        this.actionsAllowedForTurn = allowed;
    }

    override canExport(capability: AgentCapability): CapabilityPolicyDecision {
        if (capability.kind === "action" && !this.allowsAction(capability)) {
            return { allowed: false, reason: "Operations core actions require live opt-in and a staging controller" };
        }
        return super.canExport(capability);
    }

    override canExecute(capability: AgentCapability): CapabilityPolicyDecision {
        if (capability.kind === "action" && !this.allowsAction(capability)) {
            return { allowed: false, reason: "Operations core actions require live opt-in and a staging controller" };
        }
        return super.canExecute(capability);
    }
}

function resolveChatOperationsPolicyOptions(
    options: PaAgentRuntimeOptions,
): { eligible: boolean; policyOptions?: PolicyEngineOptions } {
    const policyOptions = options.policyOptions;
    const runKind = policyOptions?.runKind;
    const allowedActionPermissions = policyOptions?.allowedActionPermissions;
    const eligible = Boolean(options.operationsIntentController)
        && (runKind === undefined || runKind === "chat-with-actions")
        && policyOptions?.allowWrite !== false
        && (
            allowedActionPermissions === undefined
            || allowedActionPermissions.includes("local-filesystem-write")
        );
    if (!eligible) return { eligible: false, ...(policyOptions ? { policyOptions } : {}) };
    return {
        eligible: true,
        policyOptions: {
            ...policyOptions,
            runKind: "chat-with-actions",
            allowWrite: policyOptions?.allowWrite ?? true,
            allowedActionPermissions: allowedActionPermissions ?? ["local-filesystem-write"],
        },
    };
}
export const canFallbackToNonStreaming = (
    error: unknown,
    receivedAnyVisibleOutput: boolean,
    signal?: AbortSignal,
    canReprepareInput = false,
): boolean => {
    return !receivedAnyVisibleOutput
        && (!getProviderAdmissionError(error) || (canReprepareInput
            && getProviderAdmissionError(error) instanceof ProviderInputReprepareRequiredError))
        && !(error instanceof PaAgentContextOverflowError)
        && !isProviderContextOverflow(error)
        && !(error instanceof ChatImageRequestError)
        && !isStructuredImageUnsupportedError(error)
        && !isAbortError(error, signal);
};

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

const GHOST_STATUS_MESSAGES = {
    prepared: "A draft or restoration preview is prepared. Check its publishing card and preview; publication has not been confirmed.",
    needs_attention_owned: "Preparation needs attention. Check its publishing card before continuing; publication has not been confirmed.",
    needs_attention_unowned: "Preparation needs attention. Follow verified Host attention facts before continuing; publication has not been confirmed.",
    outcome_unknown: "The preparation result needs verification in its publishing card. Do not repeat the request or claim it is published.",
} as const;
const GHOST_ADMISSION_RECOVERY = {
    ghost_request_required: { message: "The structured Ghost target is missing, invalid, or ambiguous. Correct the target from the user's request; no preparation was started.", actions: ["correct_input"] },
    ghost_target_missing: { message: "The structured Ghost target is missing, invalid, or ambiguous. Correct the target from the user's request; no preparation was started.", actions: ["correct_input"] },
    ghost_target_ambiguous: { message: "The structured Ghost target is missing, invalid, or ambiguous. Correct the target from the user's request; no preparation was started.", actions: ["correct_input"] },
    ghost_source_unavailable: { message: "The Ghost source is unavailable or not authorized for this request. Ask the user; do not select another target to bypass admission.", actions: ["needs_user"] },
    ghost_request_stale: { message: "The Ghost request or its source guard is no longer current. Start from the current user request; no preparation was started.", actions: ["none"] },
    ghost_source_guard_missing: { message: "The Ghost request or its source guard is no longer current. Start from the current user request; no preparation was started.", actions: ["none"] },
} as const;
const GHOST_UNKNOWN_RECOVERY = {
    ghost_preparation_acceptance_unknown: { message: "The preparation result is unknown. Verify an existing Ghost operation if one is verifiable; otherwise say it cannot be verified. Do not retry or claim publication.", actions: ["query_operation", "needs_user"] },
} as const;

/** B153 publishes only a closed Host status, never article content or remote addresses. */
function isSafeGhostPublishingStatusObservation(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
    envelope: Record<string, unknown>,
): boolean {
    if (message.toolName !== "prepare_ghost_post"
        || envelope.input !== "prepare" && envelope.input !== "restore") return false;
    const fact = message.content.resultFact;
    const metadata = message.content.metadata;
    const contextRecord = asRecord(message.content.contextUsed?.[0]);
    if (message.content.sourceRecords?.length || message.content.contextUsed?.length !== 1
        || metadata?.tool !== message.toolName || metadata.inputSummary !== envelope.input
        || metadata.sourceRecordCount !== 0) return false;

    if (message.isError) {
        const error = envelope.error;
        const execution = asRecord(envelope.execution);
        const executionState = execution?.executionState;
        const executionRecovery = asRecord(execution?.recovery);
        const recovery = asRecord(metadata?.recovery);
        const recoveryCode = typeof recovery?.code === "string" ? recovery.code : undefined;
        const expectedAdmission = recoveryCode !== undefined
            ? GHOST_ADMISSION_RECOVERY[recoveryCode as keyof typeof GHOST_ADMISSION_RECOVERY]
            : undefined;
        const expectedUnknown = recoveryCode !== undefined
            ? GHOST_UNKNOWN_RECOVERY[recoveryCode as keyof typeof GHOST_UNKNOWN_RECOVERY]
            : undefined;
        const expected = expectedAdmission ?? expectedUnknown;
        const allowedActions = Array.isArray(recovery?.allowedActions) ? recovery.allowedActions : undefined;
        return metadata.outcome === "recoverable_error" && metadata.ok === false
            && envelope.status === "unavailable" && expected !== undefined
            && error === expected.message
            && metadata.executionState === (expectedAdmission ? "not_started" : "acceptance_unknown")
            && JSON.stringify(allowedActions) === JSON.stringify(expected.actions)
            && executionState === metadata.executionState
            && executionRecovery?.code === recoveryCode
            && JSON.stringify(executionRecovery?.allowedActions) === JSON.stringify(allowedActions)
            && metadata.unavailableReason === undefined
            && message.content.previewText === error
            && hasOnlyKeys(envelope, ["tool", "status", "input", "error", "execution"])
            && hasOnlyKeys(execution, ["executionState", "recovery"])
            && hasOnlyKeys(contextRecord, ["category", "label", "detail", "citationEligible", "statusOnly"])
            && contextRecord?.category === "tool-unavailable"
            && contextRecord.label === "Read-only tool unavailable"
            && contextRecord.detail === error
            && contextRecord.citationEligible === false && contextRecord.statusOnly === true;
    }

    const observation = asRecord(envelope.observation);
    const execution = asRecord(envelope.execution);
    const executionState = execution?.executionState;
    const executionRecovery = asRecord(execution?.recovery);
    if (metadata.outcome !== "success" || metadata.ok !== true || envelope.status !== "ok"
        || !hasOnlyKeys(envelope, execution ? ["tool", "status", "input", "observation", "execution"]
            : ["tool", "status", "input", "observation"])
        || message.content.previewText !== message.content.promptText) return false;
    const operationId = observation?.operationId;
    const validOperationId = typeof operationId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(operationId);
    if (!observation) return false;
    const metadataRecovery = asRecord(metadata.recovery);
    const expectedExecutionState = observation.status === "prepared" ? "succeeded" : "acceptance_unknown";
    if (executionState !== undefined && executionState !== expectedExecutionState) return false;
    if (execution) {
        if (!hasOnlyKeys(execution, executionRecovery ? ["executionState", "recovery"] : ["executionState"])
            || executionState !== metadata.executionState) return false;
        if (observation.status === "prepared" ? executionRecovery !== undefined
            : executionRecovery?.code !== metadataRecovery?.code
                || JSON.stringify(executionRecovery?.allowedActions)
                    !== JSON.stringify(metadataRecovery?.allowedActions)) return false;
    } else if (observation.status !== "prepared"
        || metadata.executionState !== expectedExecutionState) return false;
    if (!observation || !hasOnlyKeys(observation, ["status", "operationId", "message"])
        || observation.message !== (observation.status === "prepared" ? GHOST_STATUS_MESSAGES.prepared
            : observation.status === "outcome_unknown" ? GHOST_STATUS_MESSAGES.outcome_unknown
                : observation.status === "needs_attention"
                    ? validOperationId ? GHOST_STATUS_MESSAGES.needs_attention_owned
                        : operationId === undefined ? GHOST_STATUS_MESSAGES.needs_attention_unowned : undefined
                    : undefined)) return false;
    if (!hasOnlyKeys(contextRecord, ["category", "label", "detail", "sources", "citationEligible"])
        || contextRecord?.category !== "read-only-tool" || contextRecord.label !== "Read-only tool"
        || contextRecord.detail !== "prepare_ghost_post output" || !emptyArray(contextRecord.sources)
        || contextRecord.citationEligible !== false) return false;
    if (observation.status === "prepared") {
        return validOperationId && fact?.kind === "approval_pending" && fact.intentId === operationId;
    }
    if (observation.status === "needs_attention") {
        if (fact?.kind === "unknown") {
            return validOperationId && fact.operationId === operationId;
        }
        // Older source-free observations remain readable; only the typed owned
        // operation above can establish an action state for later Host updates.
        return (operationId === undefined || validOperationId)
            && fact?.kind === "unavailable" && fact.capability === message.toolName
            && fact.reason === "ghost_attention_required";
    }
    return observation.status === "outcome_unknown" && validOperationId
        && fact?.kind === "unknown" && fact.operationId === operationId;
}

function hasMatchingFailureReason(envelope: Record<string, unknown>, metadata?: Record<string, unknown>): boolean {
    if (envelope.failureReason === undefined && metadata?.failureReason === undefined) return true;
    return isChatToolFailureReason(envelope.failureReason) && envelope.failureReason === metadata?.failureReason;
}

/** Empty searches and standard read-only failures have no path receipts.
 * Admit only owner-classified observations with closed, source-free provider text. */
function isSafeSourceFreeToolObservation(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
): boolean {
    if (message.toolName === 'create_image') return isSafeImageAcceptedObservation(message) || isSafeImageFailureObservation(message);
    if (isSafeOperationsStagedObservation(message)) return true;
    if (message.content.sourceRecords?.length || !message.content.includeInNextPrompt) return false;
    let envelope: Record<string, unknown> | undefined;
    try { envelope = asRecord(JSON.parse(message.content.promptText)); } catch { return false; }
    if (!envelope || envelope.tool !== message.toolName || typeof envelope.input !== "string") return false;
    if (message.toolName === "prepare_ghost_post") return isSafeGhostPublishingStatusObservation(message, envelope);

    const fact = message.content.resultFact;
    const expectedVaultFailureLabel = SOURCE_FREE_VAULT_FAILURE_LABELS.get(message.toolName);
    if (expectedVaultFailureLabel && message.isError
        && message.content.metadata?.outcome === "recoverable_error") {
        const contextUsed = message.content.contextUsed;
        const statusContext = asRecord(contextUsed?.[0]);
        return fact?.kind === "unavailable" && fact.capability === message.toolName
            && fact.reason === "tool_unavailable"
            && contextUsed?.length === 1
            && hasOnlyKeys(statusContext, ["category", "label", "detail", "citationEligible", "statusOnly"])
            && statusContext?.category === "tool-unavailable"
            && statusContext.label === expectedVaultFailureLabel
            && statusContext.detail === "Read-only tool was unavailable."
            && statusContext.citationEligible === false && statusContext.statusOnly === true
            && message.content.previewText === "Read-only tool was unavailable."
            && message.content.metadata.tool === message.toolName
            && message.content.metadata.inputSummary === "execution failed"
            && message.content.metadata.ok === false
            && message.content.metadata.sourceRecordCount === 0
            && message.content.metadata.contextUsedCount === 1
            && (message.content.metadata.unavailableReason === undefined
                || message.content.metadata.unavailableReason === "Read-only tool was unavailable.")
            && message.content.metadata.vaultObservationEvidence === undefined
            && message.content.metadata.vaultObservationContractVersion === undefined
            && hasOnlyKeys(envelope, ["tool", "status", "input", "error", "failureReason"])
            && hasMatchingFailureReason(envelope, message.content.metadata)
            && envelope.status === "unavailable" && envelope.input === "execution failed"
            && envelope.error === "Read-only tool was unavailable.";
    }

    if (message.toolName === "search_memory" && message.isError
        && message.content.metadata?.outcome === "recoverable_error") {
        return hasOnlyKeys(envelope, ["tool", "status", "input", "error", "failureReason"])
            && hasMatchingFailureReason(envelope, message.content.metadata)
            && envelope.status === "unavailable" && envelope.input === "execution failed"
            && envelope.error === "Read-only tool was unavailable.";
    }

    if (message.toolName === "search_memory" && !message.isError
        && message.content.metadata?.outcome === "success"
        && fact?.kind === "unavailable" && fact.capability === "search_memory"
        && fact.reason === "memory_evidence_unavailable" && envelope.status === "ok"
        && hasOnlyKeys(envelope, ["tool", "status", "input", "observation"])) {
        const observation = asRecord(envelope.observation);
        return hasOnlyKeys(observation, ["query", "documents", "sources", "hasAnswerableContent",
            "memoryEvidenceState", "rerankVerdict", "retrievalGuidance"])
            && observation?.query === envelope.input && emptyArray(observation.documents)
            && emptyArray(observation.sources) && observation.hasAnswerableContent === false
            && observation.memoryEvidenceState === "unavailable"
            && (observation.rerankVerdict === "relevant" || observation.rerankVerdict === "none_relevant")
            && (observation.retrievalGuidance === undefined
                || observation.retrievalGuidance === "Memory evidence is currently unavailable; do not infer note content."
                || observation.retrievalGuidance === "Memory retrieval is currently unavailable; empty results do not establish that no matching notes exist. Do not infer note content.");
    }
    if (message.isError || message.content.metadata?.outcome !== "success"
        || fact?.kind !== "no_match" || envelope.status !== "ok"
        || !hasOnlyKeys(envelope, ["tool", "status", "input", "observation"])) return false;
    const observation = asRecord(envelope.observation);
    if (!observation) return false;

    if (message.toolName === "search_vault_metadata" && fact.search === "metadata") {
        return hasOnlyKeys(observation, ["query", "matches"])
            && typeof observation.query === "string" && emptyArray(observation.matches);
    }
    if (message.toolName === "query_notes" && fact.search === "metadata"
        && message.content.metadata?.vaultObservationContractVersion === 1) {
        const coverage = asRecord(observation.coverage);
        return hasOnlyKeys(observation, ["query", "matches", "matchCount", "matchCountKind", "sort", "coverage"])
            && isSafeQueryNotesQuery(observation.query) && isSafeQueryNotesSort(observation.sort)
            && emptyArray(observation.matches) && observation.matchCount === 0
            && observation.matchCountKind === "exact" && coverage?.state === "complete"
            && hasOnlyKeys(coverage, ["state", "scannedPermittedNotes", "evaluatedCandidates",
                "candidateCapExceeded", "projectionBudgetExceeded", "cacheUnknown"])
            && isCount(coverage.scannedPermittedNotes) && isCount(coverage.evaluatedCandidates)
            && coverage.candidateCapExceeded === undefined
            && coverage.projectionBudgetExceeded === undefined && coverage.cacheUnknown === undefined;
    }
    if (message.toolName === "search_vault_snippets" && fact.search === "snippet"
        && message.content.metadata?.vaultObservationContractVersion === 1) {
        const coverage = asRecord(observation.coverage);
        const page = asRecord(observation.page);
        return hasOnlyKeys(observation, ["kind", "query", "scope", "part", "caseSensitive",
            "matches", "matchCount", "matchCountKind", "page", "coverage", "scannedFiles",
            "scannedBytes", "consideredFiles", "skippedFiles", "truncated", "omittedCount"])
            && observation.kind === "vault-snippets" && typeof observation.query === "string"
            && (observation.scope === undefined || typeof observation.scope === "string")
            && (observation.part === "body" || observation.part === "properties"
                || observation.part === "all")
            && typeof observation.caseSensitive === "boolean"
            && emptyArray(observation.matches) && observation.matchCount === 0
            && observation.matchCountKind === "exact" && coverage?.state === "complete"
            && hasOnlyKeys(coverage, ["state", "scannedPermittedNotes", "evaluatedCandidates",
                "readNotes", "readBytes", "evaluatedBytes", "skippedFiles",
                "candidateCapExceeded", "fileCapExceeded", "byteCapExceeded", "unknownFileSize"])
            && ["scannedPermittedNotes", "evaluatedCandidates", "readNotes", "readBytes",
                "evaluatedBytes"].every(key => isCount(coverage[key]))
            && ["skippedFiles", "candidateCapExceeded", "fileCapExceeded", "byteCapExceeded",
                "unknownFileSize"].every(key => coverage[key] === undefined)
            && page !== undefined && hasOnlyKeys(page, ["startIndex", "returnedCount", "requestedLimit", "hasMore",
                "outputBudgetExceeded"])
            && page.startIndex === 0 && page.returnedCount === 0
            && isCount(page.requestedLimit) && page.requestedLimit > 0
            && page.hasMore === false && page.outputBudgetExceeded === undefined
            && ["scannedFiles", "scannedBytes", "consideredFiles", "skippedFiles",
                "omittedCount"].every(key => observation[key] === undefined || isCount(observation[key]))
            && observation.skippedFiles === undefined && observation.truncated === undefined;
    }
    if (message.toolName === "search_memory" && fact.search === "memory") {
        return hasOnlyKeys(observation, ["query", "documents", "sources", "hasAnswerableContent",
            "memoryEvidenceState", "rerankVerdict", "retrievalGuidance"])
            && typeof observation.query === "string" && emptyArray(observation.documents)
            && emptyArray(observation.sources) && observation.hasAnswerableContent === false
            && observation.memoryEvidenceState === "none"
            && observation.rerankVerdict === "none_relevant"
            && (observation.retrievalGuidance === undefined
                || observation.retrievalGuidance === "No relevant Memory evidence was selected.");
    }
    return false;
}

function hasOnlyKeys(value: Record<string, unknown> | undefined, allowed: readonly string[]): boolean {
    return Boolean(value && Object.keys(value).every(key => allowed.includes(key)));
}

function emptyArray(value: unknown): boolean {
    return Array.isArray(value) && value.length === 0;
}

function isCount(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafeQueryNotesSort(value: unknown): boolean {
    const sort = asRecord(value);
    return Boolean(sort && hasOnlyKeys(sort, ["field", "direction"])
        && (sort.field === "path" || sort.field === "ctime" || sort.field === "mtime")
        && (sort.direction === "asc" || sort.direction === "desc"));
}

function isSafeQueryNotesQuery(value: unknown): boolean {
    const query = asRecord(value);
    if (!query || !hasOnlyKeys(query, ["path", "folder", "tags", "properties", "date", "sort"])
        || !isSafeQueryNotesSort(query.sort)) return false;
    if (query.path !== undefined && typeof query.path !== "string") return false;
    if (query.folder !== undefined && typeof query.folder !== "string") return false;
    if (query.tags !== undefined && (!Array.isArray(query.tags)
        || !query.tags.every(tag => typeof tag === "string"))) return false;
    if (query.properties !== undefined && (!Array.isArray(query.properties)
        || !query.properties.every(property => {
            const condition = asRecord(property);
            return condition && hasOnlyKeys(condition, ["key", "operator", "value"])
                && typeof condition.key === "string"
                && (condition.operator === "exists" || condition.operator === "equals"
                    || condition.operator === "contains")
                && (condition.value === undefined || condition.value === null
                    || ["string", "number", "boolean"].includes(typeof condition.value));
        }))) return false;
    if (query.date !== undefined) {
        const date = asRecord(query.date);
        if (!date || !hasOnlyKeys(date, ["field", "property", "kind", "from", "to"])
            || (date.field !== "ctime" && date.field !== "mtime" && date.field !== "property")
            || (date.property !== undefined && typeof date.property !== "string")
            || (date.kind !== "timestamp" && date.kind !== "calendar-date")
            || typeof date.from !== "string" || typeof date.to !== "string") return false;
    }
    return true;
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
        preflightBatch: options.baseExecutor.preflightBatch?.bind(options.baseExecutor),
        getCanonicalToolCallKey: (toolCall, context) => (
            options.baseExecutor.getCanonicalToolCallKey?.(toolCall, context)
        ),
        getExecutionMode: (toolName: string) => {
            return options.baseExecutor.getExecutionMode?.(toolName);
        },
        getTimeoutMs: options.baseExecutor.getTimeoutMs?.bind(options.baseExecutor),
        getRetrySafety: (toolName: string) => {
            const capability = options.registry.get(toolName);
            return capability?.kind === "action"
                ? "side_effect"
                : options.baseExecutor.getRetrySafety?.(toolName);
        },
        canReuseSuccessfulResult: options.baseExecutor.canReuseSuccessfulResult?.bind(options.baseExecutor),
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
    private readonly contextSummarizer: PaAgentContextSummarizer;
    private readonly toolRegistry: CapabilityRegistry;
    private readonly operationsPolicyEngine: OperationsTurnPolicyEngine | null;
    private readonly operationsActionsPolicyEligible: boolean;
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
        this.contextSummarizer = options.contextSummarizer ?? new PaAgentContextSummarizer();
        const runtimePlatform = this.options.runtimePlatform ?? "desktop";
        const operationsPolicy = resolveChatOperationsPolicyOptions(options);
        this.operationsActionsPolicyEligible = operationsPolicy.eligible;
        const operationsRuntimeAvailable = this.areOperationsActionsAvailable();
        const effectivePolicyOptions = operationsPolicy.eligible
            ? operationsPolicy.policyOptions
            : options.policyOptions;
        this.operationsPolicyEngine = operationsRuntimeAvailable
            ? new OperationsTurnPolicyEngine({
                platform: runtimePlatform,
                ...effectivePolicyOptions,
            }, () => this.areOperationsActionsAvailable())
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
                return memoryTool.search(
                    input.query,
                    context.signal,
                    context.onBeforeVssSearch,
                    context.taskSourceReadGuard,
                );
            }),
            createCurrentNoteContextTool(),
            createQueryNotesTool(),
            createReadNoteTool(),
            createSearchVaultMetadataTool(),
            createListRecentNotesTool(),
            createReadNoteOutlineTool(),
            createInspectObsidianNoteTool(),
            createReadCanvasSummaryTool(),
            createSearchVaultSnippetsTool(),
            createListVaultTagsTool(),
            ...createMemoryManagementTools(),
            ...(this.host.insightRead ? createInsightReadTools() : []),
            ...(this.host.insightActions ? [createInsightActionTool()] : []),
            ...(this.host.memoryActions ? [createMemoryActionTool()] : []),
        ]);
        this.toolRegistry.registerMany(coreCapabilities);
        this.skillContextProvider = options.skillContextProvider === null
            ? null
            : options.skillContextProvider ?? new SkillContextProvider(BUNDLED_SKILL_RESOURCES);
        // Register the four bounded Operations actions only when a real staging
        // controller and the current caller policy admit Chat actions.
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
        if (!this.options.contextSummarizer) this.contextSummarizer.dispose();
        for (const coordinator of this.activeMemoryRecoveryCoordinators) coordinator.close();
        this.activeMemoryRecoveryCoordinators.clear();
        this.memoryTool.dispose();
        this.selfWriteRegistry?.dispose();
    }

    async streamTurn(options: PaAgentStreamOptions): Promise<void> {
        return this.streamPaAgentCanonicalTurn(options);
    }

    private async streamPaAgentCanonicalTurn(options: PaAgentStreamOptions): Promise<void> {
        if (options.writingRequest) options = { ...options, writingRequest: cloneChatWritingRequest(options.writingRequest) };
        const runSourceSelection = parseRunSourceSelection(options.runSourceSelection);
        if (options.runSourceSelection !== undefined && !runSourceSelection) {
            throw new Error('Invalid Chat run source selection');
        }
        if (options.commandInvocation && runSourceSelection
            && runSourceSelection.userMessageId !== options.commandInvocation.stableMessageId) {
            throw new Error('PA Agent command invocation is not bound to this Chat source selection.');
        }
        if (options.commandInvocation && (!options.conversationId
            || options.commandInvocation.conversationId !== options.conversationId)) {
            throw new Error('PA Agent command invocation is not bound to this conversation.');
        }
        if (options.createImage && options.commandInvocation
            && options.createImage.stableMessageId !== options.commandInvocation.stableMessageId) {
            throw new Error('PA Agent command invocation is not bound to this image request.');
        }
        if (options.ghostPublishing && options.commandInvocation
            && options.ghostPublishing.stableMessageId !== options.commandInvocation.stableMessageId) {
            throw new Error('PA Agent command invocation is not bound to this publishing request.');
        }
        const nativeWritingRequest = options.writingOutputProtocol === "native" ? options.writingRequest : undefined;
        const budgetModelIdentity = {
            provider: this.host.settings.aiProvider,
            model: this.host.settings.chatModelName,
            baseURL: this.host.settings.baseURL,
        };
        const modelBudgetFacts = resolvePaAgentModelBudgetFacts(budgetModelIdentity);
        const maxPromptChars = resolvePaAgentPromptCharCeiling(modelBudgetFacts, MAX_PA_AGENT_PROMPT_CHARS);
        const maxInputTokens = resolvePaAgentInputTokenLimit(modelBudgetFacts);
        const writingContextHost = nativeWritingRequest ? options.writingContextHost : undefined;
        let allowLegacyWritingContext = !runSourceSelection;
        let legacyWritingContextIdentity: string | undefined;
        let writingContextRun: WritingContextRun | undefined;
        let writingContextCapability: AgentCapability | undefined;
        let writingHistoryCapability: AgentCapability | undefined;
        let imageStatusCapability: AgentCapability | undefined;
        let operationsStatusCapability: AgentCapability | undefined;
        let ghostPublishingCapability: AgentCapability | undefined;
        let commandCapabilities: PaAgentCommandCapabilityScope | undefined;
        let writingContextBudget = { remainingTextChars: 0, remainingMemoryChars: 0 };
        const currentWritingContext = () => {
            try { return writingContextRun?.current(); } catch { return undefined; }
        };
        const currentWritingHandle = () => writingContextHost ? currentWritingContext()?.handle : nativeWritingRequest?.requestId;
        let contextRecoveryRequested = false;
        let recoveryMaxPromptChars: number | undefined;
        let lastAnswerPromptChars: number | undefined;
        const projectionOptions = () => ({ ...options,
            recoveryRequested: contextRecoveryRequested,
            recoveryMaxPromptChars,
            protectedWritingVersionIds: new Set([
                writingContextHost?.selectedParentVersionId, currentWritingContext()?.parent?.id,
                allowLegacyWritingContext ? options.writingContext?.parentVersionId : undefined,
            ].filter((id): id is string => Boolean(id))),
            coldWritingVersions: new Map([...coldWritingVersions].filter(([id]) => id !== writingContextHost?.selectedParentVersionId
                    && id !== currentWritingContext()?.parent?.id
                    && writingHistoryAdmissions.get(id)?.isSourceCurrent())),
            ...(!allowLegacyWritingContext || writingContextHost
                ? { writingContext: undefined, writingContextHandle: currentWritingHandle() } : {}),
        });
        let writingStyle: import("./chat-types").ChatWritingStyleResult | undefined;
        type WritingGenerationSnapshot = {
            assertCurrent: () => void;
            isSourceCurrent: () => boolean;
            associatedImages: MessageImage[];
            styleRevisionIds: string[];
            context?: import('./chat-types').ChatWritingContextMetadata;
            generationInput: GenerationInputSnapshot;
        };
        let preparedWritingGeneration: WritingGenerationSnapshot | undefined;
        let writingGeneration: WritingGenerationSnapshot | undefined;
        let answerSourceValidity: (() => boolean) | undefined;
        const assertRequestSourcesCurrent = (signal?: AbortSignal): void => {
            if (this.host.settings.aiProvider !== budgetModelIdentity.provider
                || this.host.settings.chatModelName !== budgetModelIdentity.model
                || this.host.settings.baseURL !== budgetModelIdentity.baseURL) {
                throw new Error('PA Agent model configuration changed during this run');
            }
            if (options.isCurrent?.() === false) throw createAbortError();
            if (runSourceSelection && allowLegacyWritingContext && options.writingContext
                && (JSON.stringify(options.writingContext) !== legacyWritingContextIdentity
                    || !sourceRun.admitsLineage(options.writingContext.inputLineage))) {
                throw new ChatImageRequestError('request_changed');
            }
            imageScope?.assertReady(signal);
            if (writingStyle && !(writingStyle.isSourceCurrent ? writingStyle.isSourceCurrent() : writingStyle.isCurrent())) {
                throw new ChatImageRequestError("request_changed");
            }
            if (imageScope?.hasSelectedImages && options.imageCapability?.get() === "unsupported") throw new ChatImageRequestError("unsupported_model");
        };
        const assertRequestCurrent = (signal?: AbortSignal): void => {
            throwIfAborted(signal ?? options.signal);
            assertRequestSourcesCurrent(signal);
        };
        // Local estimates guide compaction, not admission. Only an impossible
        // explicit model configuration can fail before the provider is tried.
        if (maxInputTokens === 0) throw new PaAgentContextOverflowError(0, maxPromptChars);
        const runtimeStartedAt = Date.now();
        const startupTimings: PaAgentStartupTiming[] = [];
        const operationsActionsEligible = this.areOperationsActionsAvailable();
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
        const debugRecorder = options.debugRecorder;
        const usageLedger = new PaAgentRunUsageLedger();
        const auxiliarySummaryBudget = createPaAgentAuxiliarySummaryBudget(() => usageLedger.snapshot().attempts);
        try { debugRecorder?.bindRun(runId); } catch { /* Debug cannot affect runtime admission. */ }
        const debugEnabled = () => this.host.settings.debug === true;
        const debug = createAgentDebugLog(debugEnabled,
            (message, fields) => {
                observeAgentDebugPhase(debugRecorder, String(fields.phase), fields);
                this.host.log(message, fields);
            },
            { runId, chatRequestId: options.debugRequestId, turnId: null });
        const debugLifecycle = createAgentEventDebugObserver(debug);
        debug('runtime_start', { model: this.host.settings.chatModelName, provider: this.host.settings.aiProvider,
            historyCount: options.chatHistory?.length ?? 0, promptChars: options.prompt.length });
        const userMessageId = runSourceSelection?.userMessageId
            ?? options.commandInvocation?.stableMessageId ?? `${runId}:source-user`;
        const explicitAttachmentKeys = new Set([
            ...(options.images ?? []),
            ...(options.chatHistory ?? []).flatMap(message => message.role === 'user'
                && (message.hostProvenance?.messageId || message.runSourceSelection?.userMessageId)
                ? message.images ?? [] : []),
        ].map(image => `${image.ref.assetId}:${image.ref.contentHash}`));
        const admittedParentLineages = new Map<string, InputLineage>();
        const admittedParentSourceValidity = new Map<string, { textHash: string; isCurrent: () => boolean }>();
        const coldWritingVersions = new Map<string, ColdWritingVersion>();
        const writingHistoryAdmissions = new Map<string, WritingHistoryAdmission>();
        const writingHistoryObservations = new Map<string, readonly WritingHistoryAdmission[]>();
        const writingReadReceipts = new Map<string, readonly WritingHistoryAdmission[]>();
        const styleGuards = new Map<string, () => boolean>();
        const styleKey = (ids: readonly string[]) => JSON.stringify([...new Set(ids)].sort());
        const captureStyles = async (lineage: InputLineage | undefined): Promise<void> => {
            if (!runSourceSelection || runSourceSelection.scope === 'web' || lineage?.completeness !== 'complete') return;
            for (const dependency of lineage.dependencies) {
                if (dependency.kind !== 'writing-style') continue;
                const key = styleKey(dependency.revisionIds);
                if (styleGuards.has(key)) continue;
                try {
                    const receipt = await this.host.captureWritingStyleSourceValidity?.(dependency.revisionIds);
                    styleGuards.set(key, receipt?.isCurrent() ? receipt.isCurrent : () => false);
                } catch { styleGuards.set(key, () => false); }
            }
        };
        let checkingParentLineage: InputLineage | undefined;
        const hasVerifiedVersion = (versionId: string, textHash: string): boolean => {
            const matches = (lineage: InputLineage | undefined) => lineage?.completeness === 'complete'
                && lineage.dependencies.some(dependency => dependency.kind === 'writing-version'
                    && dependency.versionId === versionId && dependency.textHash === textHash);
            return matches(checkingParentLineage)
                || matches(options.writingContext?.inputLineage)
                || [...admittedParentLineages.values()].some(matches);
        };
        let sourceRunActive = true;
        const rawRequestText = options.userText ?? options.prompt;
        const sourceRun = new TaskSourceRun({
            ...(options.conversationId ? { conversationId: options.conversationId } : {}),
            runId, userMessageId, userText: rawRequestText,
            runSourceSelection,
            requestText: rawRequestText,
            workspace: this.host.app.workspace,
            getFileByPath: path => this.host.isDataBoundaryAllowedPath?.(path) === false
                ? undefined : this.host.app.vault.getAbstractFileByPath(path),
            getCurrentNoteLinks: path => {
                try {
                    const cache = this.host.app.metadataCache?.getCache(path);
                    return (cache?.links ?? []).flatMap(link => {
                        const file = this.host.app.metadataCache.getFirstLinkpathDest(link.link, path);
                        // Link display text belongs to the source note body. Only
                        // the target file identity may outlive that note's access.
                        return file ? [{ path: file.path }] : [];
                    });
                } catch { return []; }
            },
            isCurrent: () => sourceRunActive && !options.signal?.aborted && options.isCurrent?.() !== false,
            areSourcesCurrent: () => options.isCurrent?.() !== false,
            isMemoryAllowed: () => this.host.settings.memoryEnabled !== false,
            isWebAllowed: () => this.host.settings.webSearchEnabled === true,
            isAttachmentAllowed: ref => Boolean(options.imageAssetService)
                && explicitAttachmentKeys.has(`${ref.assetId}:${ref.contentHash}`),
            isWritingVersionAllowed: hasVerifiedVersion,
            isWritingStyleAllowed: ids => styleGuards.get(styleKey(ids))?.() === true,
            isPersonalAllowed: source => this.host.isPersonalSourceCurrent?.(source) === true,
            revalidateVaultObservation: this.host.revalidateVaultObservation?.bind(this.host),
            isPathAllowed: path => this.host.isDataBoundaryAllowedPath?.(path) !== false,
            getMemoryEvidenceEpoch: this.host.getMemoryEvidenceEpoch?.bind(this.host),
            getTaskSourceAuthorityEpoch: this.host.getTaskSourceAuthorityEpoch?.bind(this.host),
        });
        const admitHistoryVersion = async (version: import('../chat/writing-types').WritingVersion,
            signal?: AbortSignal): Promise<WritingHistoryAdmission | undefined> => {
            const binding = options.writingHistoryHost;
            if (!binding || binding.conversationId !== options.conversationId
                || version.conversationId !== binding.conversationId || !binding.isCurrent()) return undefined;
            throwIfAborted(signal);
            const lineage = await resolveWritingVersionInputLineage(version, id => binding.versions.get(id));
            await captureStyles(lineage);
            checkingParentLineage = lineage;
            const admitted = sourceRun.admitsLineage(lineage, true);
            checkingParentLineage = undefined;
            if (!admitted || !binding.isCurrent() || binding.isSourceCurrent?.() === false) return undefined;
            admittedParentLineages.set(version.id, lineage);
            const sourceCurrent = sourceRun.captureLineageSourceValidity(lineage);
            const guard = {
                isCurrent: () => binding.isCurrent() && sourceRun.isCurrent() && sourceCurrent(),
                isSourceCurrent: () => binding.isSourceCurrent?.() !== false && sourceCurrent(),
            };
            admittedParentSourceValidity.set(version.id, { textHash: version.textHash, isCurrent: guard.isSourceCurrent });
            const parentHandle = writingContextRun?.registerCandidate(version, guard);
            const receipt: WritingHistoryAdmission = { lineage, ...guard, ...(parentHandle ? { parentHandle } : {}) };
            writingHistoryAdmissions.set(version.id, receipt);
            return receipt;
        };
        if (options.writingHistoryHost) {
            const versionIds = new Set((options.chatHistory ?? []).flatMap(message => [
                ...(message.writingVersionId ? [message.writingVersionId] : []),
                ...(message.actionStates ?? message.canonicalTurn?.actionStates ?? []).flatMap(state =>
                    state.owner === 'writing' && 'versionId' in state.receipt ? [state.receipt.versionId] : []),
            ]));
            for (const id of versionIds) {
                const version = await options.writingHistoryHost.versions.get(id);
                if (version && await admitHistoryVersion(version, options.signal)) {
                    coldWritingVersions.set(id, { textHash: version.textHash, text: version.text });
                }
            }
        }
        if (runSourceSelection && options.writingContext) {
            const parentLineage = cloneInputLineage(options.writingContext.inputLineage);
            await captureStyles(parentLineage);
            allowLegacyWritingContext = Boolean(parentLineage?.dependencies.some(dependency =>
                dependency.kind === 'writing-version'
                && dependency.versionId === options.writingContext!.parentVersionId
                && dependency.textHash === options.writingContext!.textHash))
                && sourceRun.admitsLineage(parentLineage);
            if (allowLegacyWritingContext) legacyWritingContextIdentity = JSON.stringify(options.writingContext);
        }
        if (runSourceSelection) {
            for (const message of options.chatHistory ?? []) {
                await captureStyles(cloneInputLineage(message.inputLineage
                    ?? readChatHistoryTurnMetadata(message)?.inputLineage));
            }
        }
        const admittedImageHistory = await sourceRun.projectHistoryAsync(options.chatHistory ?? [], options.signal);
        const admittedImageKeys = new Set([...(options.images ?? []),
            ...admittedImageHistory.flatMap(message => message.images ?? [])]
            .map(image => `${image.ref.assetId}:${image.ref.contentHash}`));
        const admittedWritingMaterials = runSourceSelection && options.writingMaterialContext
            ? { ...options.writingMaterialContext,
                associatedImages: options.writingMaterialContext.associatedImages.filter(image =>
                    admittedImageKeys.has(`${image.ref.assetId}:${image.ref.contentHash}`)) }
            : options.writingMaterialContext;
        const imageScope: ChatImageRequestScope | undefined = options.images?.length || admittedImageHistory.some(message => message.images?.length)
            || (allowLegacyWritingContext && options.writingContext) || admittedWritingMaterials?.associatedImages.length
            ? new ChatImageRequestScope({ images: options.images, history: admittedImageHistory,
                ...(allowLegacyWritingContext ? { writingContext: options.writingContext } : {}),
                writingMaterialContext: admittedWritingMaterials,
                prompt: options.prompt, service: options.imageAssetService, isCurrent: options.isCurrent }) : undefined;
        const memoryActionRequest = {
            runId,
            userMessageId,
            userPrompt: options.prompt,
            userPromptHash: stableHash(options.prompt),
            ...(options.conversationId ? { conversationId: options.conversationId } : {}),
            isCurrent: sourceRun.isCurrent,
        };
        const providerRequestScope = createProviderRequestScope();
        const explicitUserLineage = cloneInputLineage(options.inputLineage);
        if (explicitUserLineage && !sourceRun.admitsLineage(explicitUserLineage)) {
            throw new Error('Image request source scope rejected before provider dispatch.');
        }
        const currentUserLineage = explicitUserLineage ?? completeInputLineage([
            { kind: 'user-text', messageId: userMessageId },
            ...(options.images ?? []).map(image => ({ kind: 'attachment' as const,
                ownerMessageId: userMessageId, ref: { ...image.ref } })),
        ]);
        const answerLineageByTurn = new Map<string, InputLineage>();
        const answerAttachmentValidityByTurn = new Map<string, () => boolean>();
        const callLineageById = new Map<string, InputLineage>();
        const callNotesObservationStateById = new Map<string, {
            sourceEpoch?: string; memoryEnabled?: boolean;
        }>();
        const callAttachmentValidityById = new Map<string, () => boolean>();
        const captureAttachmentSourceValidity = async (lineage: InputLineage, signal?: AbortSignal): Promise<() => boolean> => {
            const refs = [...new Map(lineage.dependencies.flatMap(dependency => dependency.kind === 'attachment'
                ? [[`${dependency.ref.assetId}:${dependency.ref.contentHash}`, dependency.ref] as const] : [])).values()];
            if (!refs.length) return () => true;
            if (!options.imageAssetService) throw new ChatImageRequestError('source_unavailable');
            const receipts = await Promise.all(refs.map(ref => options.imageAssetService!.verify(ref, 'provider', {
                signal, isCurrent: () => sourceRun.isCurrent(),
            })));
            const isCurrent = () => {
                try { return receipts.every(receipt => receipt.isCurrent()); }
                catch { return false; }
            };
            if (!isCurrent()) throw new ChatImageRequestError('request_changed');
            return isCurrent;
        };
        let physicalRequestSequence = 0;
        const requestDiagnostic = (stage: "answer" | "context_summary" | "query_rewrite" | "rerank", turnId: string) =>
            (evidence: import("./obsidian-fetch").ProviderRequestDiagnostic) => {
                const attempt = ++physicalRequestSequence;
                if (this.host.settings.debug) this.host.log("PA Agent physical request", {
                    runId, turnId, stage, attemptId: `${runId}:http:${attempt}`, timestamp: Date.now(),
                    ...evidence,
                });
            };
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
            recordDiagnostic: retrievalRecorder,
        });
        this.activeMemoryRecoveryCoordinators.add(memoryRecoveryCoordinator);
        const memoryEvidenceRegistry = new MemoryEvidenceRegistry((result, signal, temporalFilter, guard) => (
            this.memoryTool.revalidateForProvider(result, signal, temporalFilter, undefined, guard)
        ), {
            mode: "read_snapshot",
            isMemoryAllowed: () => this.host.settings.memoryEnabled !== false,
        });
        try {
        commandCapabilities = createPaAgentCommandCapabilityScope(this.toolRegistry);
        const legacyEvents = new AgentEventEmitter(options.onEvent);
        const readAdmittedInjectedContext = (): PaAgentInjectedContext | undefined => {
            // A web run must not even prepare automatic private background.
            if (runSourceSelection?.scope === 'web') return undefined;
            const context = this.readInjectedContext(runSourceSelection ? undefined : options.pageletHandoff);
            if (!runSourceSelection || !context) return context;
            const lineage = backgroundInputLineage(context, generationInputBackgroundSources(context));
            return context.isSourceCurrent?.() !== false && sourceRun.admitsLineage(lineage)
                ? context : undefined;
        };
        let injectedContext = readAdmittedInjectedContext();
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
        // Use the same receipt for canonical completion and visible delivery.
        // Cancellation alone does not revoke a received partial answer.
        const isPreviewCurrent = (): boolean => {
            assertRequestSourcesCurrent();
            if (answerSourceValidity?.() === false) return false;
            writingGeneration?.assertCurrent();
            if (writingGeneration && !writingGeneration.isSourceCurrent()) return false;
            return imageScope?.isUsable() ?? true;
        };
        const eventAdapter = new CanonicalToLegacyEventAdapter(legacyEvents, options.onLifecycleEvent, options.writingRequest ? {
            request: options.writingRequest, maxTextChars: Number.MAX_SAFE_INTEGER,
            ...(nativeWritingRequest ? { nativeContextHandle: nativeWritingRequest.requestId,
                ...(writingContextHost ? { getContextHandle: currentWritingHandle } : {}) } : {}),
            isCurrent: () => {
                assertRequestCurrent();
                if (!writingGeneration) return false;
                writingGeneration.assertCurrent();
                if (!writingGeneration.isSourceCurrent()) return false;
                return imageScope?.isUsable() ?? true;
            },
            // Stopping generation does not revoke already received text. Source,
            // model, image and style changes still invalidate its visible preview.
            isPreviewCurrent,
            getStyleRevisionIds: () => writingGeneration?.styleRevisionIds ?? [],
            getAssociatedImages: () => writingGeneration?.associatedImages ?? imageScope?.writingMaterials ?? [],
            getWritingContext: () => writingGeneration?.context,
            getSourceValidity: () => writingGeneration?.isSourceCurrent,
            getGenerationInputSnapshot: () => writingGeneration
                ? cloneGenerationInputSnapshot(writingGeneration.generationInput) : undefined,
            onDiagnostic: (diagnostic) => {
                if (this.host.settings.debug) this.host.log("PA Agent writing delivery", diagnostic);
            },
        } : undefined);
        let imageCapability: AgentCapability | undefined;
        let imageGenerationCapability: AgentCapability | undefined;
        if (imageScope?.hasImages) {
            const capability = createChatToolCapability(createResolveChatImagesTool(imageScope), { providerId: "chat-images" });
            capability.executionMode = "sequential";
            if (!commandCapabilities.register(capability)) throw new Error("Chat image capability unavailable.");
            imageCapability = capability;
        }
        if (options.createImage) {
            if (!options.conversationId || options.createImage.conversationId !== options.conversationId
                || !options.createImage.stableMessageId || !options.createImage.operationId) {
                throw new Error("Image generation host identity is unavailable.");
            }
            const hostImageBinding = options.createImage;
            const scopedImageBinding: typeof hostImageBinding = {
                ...hostImageBinding,
                submit: async (input, isSourceCurrent, requestLineage, _imageSourceCurrent, runtime) => {
                    const lineage = requestLineage ?? hostImageBinding.resolveRequestLineage?.(input, undefined);
                    if (!lineage || !sourceRun.admitsLineage(lineage)) {
                        throw new Error(!lineage
                            ? 'Image request actual lineage is missing.'
                            : 'Image request source scope rejected.');
                    }
                    const attachmentValidity = await captureAttachmentSourceValidity(lineage);
                    const sourceLineageCurrent = sourceRun.captureImageTaskSourceValidity(lineage);
                    const imageSourceCurrent = () => sourceLineageCurrent()
                        && (!attachmentValidity || attachmentValidity());
                    return await hostImageBinding.submit(input, isSourceCurrent, lineage, imageSourceCurrent, runtime);
                },
            };
            imageGenerationCapability = createChatToolCapability(createCreateImageTool(scopedImageBinding), { providerId: "chat-image-generation" });
            imageGenerationCapability.executionMode = "sequential";
            if (!commandCapabilities.register(imageGenerationCapability)) throw new Error("Image generation capability unavailable");
        }
        if (options.ghostPublishing && (this.options.runtimePlatform ?? "desktop") === "desktop") {
            const binding = options.ghostPublishing;
            if (!options.conversationId || binding.conversationId !== options.conversationId || !binding.stableMessageId) {
                throw new Error("Ghost publishing host identity is unavailable.");
            }
            ghostPublishingCapability = createChatToolCapability(createPrepareGhostPostTool(binding), {
                providerId: "chat-ghost-publishing", platform: "desktop",
            });
            ghostPublishingCapability.executionMode = "sequential";
            if (!commandCapabilities.register(ghostPublishingCapability)) throw new Error("Ghost publishing capability unavailable.");
        }
        if (options.imageStatus) {
            if (!options.conversationId || options.imageStatus.conversationId !== options.conversationId) {
                throw new Error('Image status is not bound to this conversation');
            }
            imageStatusCapability = createChatToolCapability(createImageStatusTool(options.imageStatus), { providerId: 'chat-image-status' });
            if (!commandCapabilities.register(imageStatusCapability)) throw new Error('Image status capability unavailable');
        }
        if (options.operationsStatus) {
            if (!options.conversationId || options.operationsStatus.conversationId !== options.conversationId) {
                throw new Error('Operations status is not bound to this conversation');
            }
            operationsStatusCapability = createChatToolCapability(
                createOperationsStatusTool(options.operationsStatus),
                { providerId: 'operations-status' },
            );
            if (!commandCapabilities.register(operationsStatusCapability)) throw new Error('Operations status capability unavailable');
        }
        if (writingContextHost) {
            const candidates = runSourceSelection ? (await Promise.all(writingContextHost.candidates.map(async candidate => {
                const lineage = await resolveWritingVersionInputLineage(candidate,
                    id => writingContextHost.versions.get(id));
                await captureStyles(lineage);
                checkingParentLineage = lineage;
                const admitted = sourceRun.admitsLineage(lineage);
                checkingParentLineage = undefined;
                if (!admitted) return undefined;
                admittedParentLineages.set(candidate.id, lineage);
                admittedParentSourceValidity.set(candidate.id, { textHash: candidate.textHash,
                    isCurrent: sourceRun.captureLineageSourceValidity(lineage) });
                return candidate;
            }))).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
                : writingContextHost.candidates;
            writingContextRun = new WritingContextRun({
                ...writingContextHost, runId,
                candidates,
                ...(runSourceSelection?.scope === 'web' ? { styles: { prepare: async () => ({
                    context: '', revisionIds: [], isCurrent: () => true,
                }) } } : runSourceSelection ? { styles: { prepare: async (...args: Parameters<typeof writingContextHost.styles.prepare>) => {
                    const prepared = await writingContextHost.styles.prepare(...args);
                    if (prepared.context || prepared.revisionIds.length) {
                        styleGuards.set(styleKey(prepared.revisionIds),
                            prepared.isSourceCurrent?.bind(prepared) ?? (() => false));
                    }
                    return prepared;
                } } } : {}),
                isCurrent: () => sourceRunActive && options.isCurrent?.() !== false && writingContextHost.isCurrent(),
                isParentCurrent: parent => writingContextHost.isParentCurrent(parent)
                    && (!runSourceSelection || sourceRun.admitsLineage(admittedParentLineages.get(parent.id))),
                isParentSourceCurrent: parent => (writingContextHost.isParentSourceCurrent?.(parent)
                    ?? writingContextHost.isParentCurrent(parent))
                    && (!runSourceSelection || (admittedParentSourceValidity.get(parent.id)?.textHash === parent.textHash
                        && admittedParentSourceValidity.get(parent.id)?.isCurrent() === true)),
                verifyImages: async (refs, signal) => {
                    throwIfAborted(signal);
                    if (imageScope) return imageScope.verifyWritingMaterials(refs, signal);
                    if (refs.length) throw new ChatImageRequestError("source_unavailable");
                    return { images: [], isCurrent: () => sourceRunActive && options.isCurrent?.() !== false && writingContextHost.isCurrent() };
                },
            });
            writingContextCapability = createWritingContextCapability(writingContextRun, {
                outputBudgetChars: Number.MAX_SAFE_INTEGER,
                getBudget: () => ({ ...writingContextBudget,
                    remainingMemoryChars: Math.max(0, Math.min(writingContextBudget.remainingMemoryChars,
                        MEMORY_CONTEXT_MAX_CHARS - formatBackground(readInjectedContext()).length - 2)) }),
                onPrepared: context => imageScope?.selectWritingMaterials(context.images.map(image => image.ref)),
            });
            if (!commandCapabilities.register(writingContextCapability)) throw new Error("Writing context capability unavailable");
        }
        if (options.writingHistoryHost) {
            if (!options.conversationId || options.writingHistoryHost.conversationId !== options.conversationId) {
                throw new Error('Writing history is not bound to this conversation');
            }
            writingHistoryCapability = createChatToolCapability(createWritingHistoryTool({
                ...options.writingHistoryHost, admitVersion: admitHistoryVersion,
                onObservation: (observation, admissions) => writingHistoryObservations.set(JSON.stringify(observation), admissions),
            }), { providerId: 'chat-writing-history' });
            writingHistoryCapability.executionMode = 'sequential';
            if (!commandCapabilities.register(writingHistoryCapability)) throw new Error('Writing history capability unavailable');
        }
        let additionalProvidersLoaded = false;
        await recordStartupTimingAsync(
            "capability_preload",
            () => traceAgentPhase(debug, 'capability_preload', () => this.loadAdditionalCapabilityProviders(`${runId}:capability-preload`, options.signal)),
        );
        additionalProvidersLoaded = true;
        const hostContext = await recordStartupTimingAsync(
            "host_context",
            () => traceAgentPhase(debug, 'host_context', () => this.loadCanonicalHostContextForRun(options, runId, options.signal)),
        );
        startupTimings.push({
            phase: "runtime_startup_total",
            elapsedMs: Math.max(0, Date.now() - runtimeStartedAt),
            metadata: {
                promptLength: options.prompt.length,
                memoryMode: options.memoryMode,
            },
        });
        const exportableToolNames = new Set(
            this.toolRegistry.listDefinitions().map((definition) => definition.name),
        );
        const availableSemanticToolNames = new Set<string>(
            APPROVED_FIRST_TURN_READ_TOOL_NAMES
                .filter((toolName) => exportableToolNames.has(toolName))
                .filter((toolName) => options.memoryMode !== "skip-memory" || toolName !== "search_memory"),
        );
        if (this.host.memoryActions && exportableToolNames.has("manage_memory")) {
            availableSemanticToolNames.add("manage_memory");
        }
        if (this.host.insightActions && exportableToolNames.has("manage_saved_insight")) {
            availableSemanticToolNames.add("manage_saved_insight");
        }
        if (operationsActionsEligible) {
            for (const toolName of CORE_WRITE_TOOL_NAMES.filter((toolName) => this.toolRegistry.getDefinition(toolName))) {
                availableSemanticToolNames.add(toolName);
            }
        }
        const availableMetaToolNames = new Set<string>();
        if (writingContextCapability) availableMetaToolNames.add(GET_WRITING_CONTEXT);
        if (imageScope?.hasImages) availableMetaToolNames.add(RESOLVE_CHAT_IMAGES);
        if (options.createImage && exportableToolNames.has("create_image")) availableSemanticToolNames.add("create_image");
        if (ghostPublishingCapability && exportableToolNames.has("prepare_ghost_post")) availableSemanticToolNames.add("prepare_ghost_post");
        if (this.toolRegistry.getDefinition(LOAD_SKILL_TOOL_NAME)) {
            availableMetaToolNames.add(LOAD_SKILL_TOOL_NAME);
        }
        if (writingHistoryCapability) availableMetaToolNames.add('read_writing_history');
        if (imageStatusCapability) availableMetaToolNames.add('get_image_status');
        if (operationsStatusCapability) availableMetaToolNames.add('get_operations_status');
        const hostPolicy = createPaAgentHostPolicy();
        // Structured host controls apply before dispatch. Natural-language task
        // boundaries are interpreted by the same main Agent and admitted below.
        const fixedBlockedToolNames = new Set<string>([
            ...(options.memoryMode === "skip-memory" ? ["search_memory"] : []),
            ...(runSourceSelection?.scope === 'web' ? NOTE_SOURCE_TOOL_NAMES : []),
            ...(runSourceSelection?.scope === 'notes' ? ['webSearch'] : []),
        ]);
        const toolUseConstraints: PaAgentToolUseConstraints = {
            blockedToolNames: fixedBlockedToolNames,
        };
        const initialControlSnapshot = createInitialAgentControlSnapshot({
            ...(toolUseConstraints ? { constraints: toolUseConstraints } : {}),
            availableSemanticToolNames,
            availableMetaToolNames,
        });

        const loadAdditionalCapabilityProviders = this.loadAdditionalCapabilityProviders.bind(this);
        const toolRegistry = this.toolRegistry;
        const planner = this.planner;
        const contextManager = this.contextManager;
        const contextSummarizer = this.contextSummarizer;
        let runSummaries: PaAgentContextSummaries = {};
        const toolSummaryAttempts = new Map<string, string>();
        let actionProjectionMode: "native" | "compat" = "compat";
        const snapshotHistory = async (signal?: AbortSignal): Promise<ChatMessage[]> => (await sourceRun.projectHistoryAsync(options.chatHistory ?? [], signal)).map(message => {
            // Keep the run-owned finite fragment's source proof through the
            // budget/summary snapshot; it contains no historical prose or tools.
            if (sourceRun.isOwnedHistoricalActionFragment(message)) return message;
            const metadata = readChatHistoryTurnMetadata(message);
            const inputLineage = historyInputLineage(message);
            const actionStateBinding = cloneActionStateBinding(message.actionStateBinding);
            const sourceSelection = parseRunSourceSelection(message.runSourceSelection);
            return { role: message.role, content: message.content, ...chatHistoryImageMetadata(message),
                ...(message.writingVersionId ? { writingVersionId: message.writingVersionId } : {}),
                ...(message.actionStates ? { actionStates: message.actionStates } : {}),
                ...(actionStateBinding ? { actionStateBinding } : {}),
                ...(message.hostProvenance !== undefined ? { hostProvenance: cloneChatHostProvenance(message.hostProvenance) } : {}),
                ...(sourceSelection ? { runSourceSelection: sourceSelection } : {}),
                ...(inputLineage ? { inputLineage } : {}),
                ...(metadata ? { memoryMetadata: metadata } : {}),
                ...(message.canonicalTurn ? { canonicalTurn: message.canonicalTurn } : {}) };
        });
        const currentMemoryUsage = () => {
            const context = injectedContext;
            return {
                ...(context?.governedMemoryTrace ? {
                    governedMemoryTrace: context.governedMemoryTrace.map(trace => ({ ...trace })),
                } : {}),
                ...(context?.generationInputSources ? {
                    generationInputSources: cloneGenerationInputBackgroundSources(context.generationInputSources),
                } : {}),
                ...(writingGeneration ? {
                    writingGenerationInput: cloneGenerationInputSnapshot(writingGeneration.generationInput),
                } : {}),
            };
        };
        const projectManagementObservations = async (transcript: readonly PaAgentMessage[]): Promise<PaAgentMessage[]> => (
            await prepareManagementProjection(transcript).then(projection => projection.transcript)
        );
        const prepareManagementProjection = async (
            transcript: readonly PaAgentMessage[],
            history: readonly ChatMessage[] = [],
        ): Promise<MemoryManagementProjection> => await prepareMemoryManagementProjection({
            transcript,
            history,
            portAvailable: Boolean(this.host.memoryManagement || this.host.insightRead),
            prepareObservation: evidence => {
                if (evidence.tool === "get_vault_insights" || evidence.tool === "query_saved_insights") {
                    if (!this.host.insightRead) throw new Error("Insight revalidation is unavailable.");
                    return this.host.insightRead.prepareObservation(evidence);
                }
                if (!this.host.memoryManagement) throw new Error("Memory management revalidation is unavailable.");
                return this.host.memoryManagement.prepareObservation(evidence, currentMemoryUsage);
            },
        });
        const writingPreparationInstruction = (toolMode: PaAgentModelInput['toolMode']): string | undefined => {
            if (!writingContextRun || toolMode === 'final_answer_only') return undefined;
            const prepared = currentWritingContext();
            if (prepared) {
                return `Rewording the same scene is not a reason to prepare again. Reprepare only for a user correction, new evidence that changes the selected parent, scene, conflicts or materials, or a host-reported invalid context. Necessary source work remains subject to the current permissions. Authorized parent handles (JSON data): ${JSON.stringify(writingContextRun.candidateDirectory())}`;
            }
            return `Select the parent and scene from the conversation semantically; use parentHandle=null for a new topic and omit scene when unknown. Authorized parent handles (JSON data): ${JSON.stringify(writingContextRun.candidateDirectory())}`;
        };
        type ContextInstructionReceipt = ReturnType<TaskSourceRun['captureContextInstruction']>;
        const commandDeclarationGuidance = (boundSchemas?: ChatToolProviderSchema[]) => options.commandInvocation
            ? formatPaAgentCommandInvocationGuidance(
                options.commandInvocation,
                new Set((boundSchemas ?? [])
                    .map(schema => schema.function.name)
                    .filter(name => name !== REPORT_TASK_INCOMPLETE)),
            )
            : undefined;
        const withImageContext = (input: PaAgentModelInput,
            directory?: ContextInstructionReceipt,
            boundSchemas?: ChatToolProviderSchema[]): PaAgentModelInput => {
            // Recognize the fixed Host protocol before appending any source material.
            const operationsAcknowledgement = isOperationsStagedAcknowledgement(input.runtimeInstruction);
            return {
                ...input,
                currentProtocol: operationsAcknowledgement
                    ? OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION : input.currentProtocol,
                runtimeInstruction: combineRuntimeInstructions([
                    operationsAcknowledgement ? undefined : input.runtimeInstruction,
                    commandDeclarationGuidance(boundSchemas),
                    options.commandGuidance,
                    directory?.instruction ?? sourceRun.contextInstruction(),
                    imageScope?.hasImages ? imageScope.contextText() : undefined,
                    operationsAcknowledgement
                        ? undefined : writingPreparationInstruction(input.toolMode),
                ]),
            };
        };
        const buildCanonicalModelInput = async (
            input: PaAgentModelInput,
            toolDefinitions?: ChatToolRegistryDefinition[],
            boundSchemas?: ChatToolProviderSchema[],
            history?: ChatMessage[],
            directory?: ContextInstructionReceipt,
        ) =>
            this.buildPaAgentCanonicalModelInput(
                { ...projectionOptions(), chatHistory: history ?? await sourceRun.projectHistoryAsync(options.chatHistory ?? [], input.signal) },
                withImageContext(input, directory, boundSchemas),
                toolConstraintsFromAgentControlSnapshot(input.controlSnapshot) ?? toolUseConstraints,
                toolDefinitions,
                injectedContext,
                boundSchemas,
                runSummaries,
                actionProjectionMode,
                modelBudgetFacts,
            );
        const previewCanonicalModelInput = async (
            input: PaAgentModelInput,
            toolDefinitions: ChatToolRegistryDefinition[],
            boundSchemas: ChatToolProviderSchema[],
        ) => (await this.projectPaAgentCanonicalModelInput(
            { ...projectionOptions(), chatHistory: await sourceRun.projectHistoryAsync(options.chatHistory ?? [], input.signal) },
            withImageContext(input, undefined, boundSchemas),
            toolConstraintsFromAgentControlSnapshot(input.controlSnapshot) ?? toolUseConstraints,
            toolDefinitions, injectedContext, boundSchemas,
            runSummaries, actionProjectionMode, modelBudgetFacts,
        )).projection;
        const readInjectedContext = readAdmittedInjectedContext;
        const formatBackground = (context: PaAgentInjectedContext | undefined) => formatInjectedContext({
            ...context, pageletHandoff: undefined, writingStyleContext: undefined,
        });
        let preparedBackground: string | undefined;
        let preparedBackgroundSourceCurrent: (() => boolean) | undefined;
        const assertProviderInputCurrent = (signal?: AbortSignal): void => {
            assertRequestCurrent(signal);
            let backgroundCurrent = false;
            try {
                // Revalidate the sources of the already serialized background.
                // A fresh projection (for example, a new Insights timestamp)
                // does not replace that input or revoke a still-live receipt.
                backgroundCurrent = preparedBackground !== undefined && (preparedBackgroundSourceCurrent
                    ? preparedBackgroundSourceCurrent()
                    : preparedBackground === formatBackground(readInjectedContext()));
            } catch { /* A source receipt that cannot be checked is not current. */ }
            assertRequestCurrent(signal);
            if (!backgroundCurrent) {
                // This check also runs before entering the SDK; keep that local
                // rejection nonretryable just like the physical fetch guard.
                throw new ProviderAdmissionError(new Error("Personal context changed before provider dispatch"));
            }
        };
        const availableStyleBudget = () => {
            return {
                // The selected parent is required material. Context pressure
                // is handled on the complete request, not by refusing its read.
                remainingTextChars: Number.MAX_SAFE_INTEGER,
                remainingMemoryChars: Math.max(0, MEMORY_CONTEXT_MAX_CHARS - formatBackground(injectedContext).length - 2),
            };
        };
        interface AnswerVaultBinding {
            projection: VaultObservationProjection;
            providerInput: Record<string, unknown>;
            serializedInput: string;
            promptEstimate?: PaAgentRequestEnvelopeEstimate;
            actualToolSources: Array<Extract<PaAgentMessage, { role: "toolResult" }>>;
            actualHistorySources: ChatMessage[];
            sourceHistoryJson: string;
            isSourceCurrent: () => boolean;
            managementProjection?: MemoryManagementProjection;
            prepareInputCurrent?: (signal?: AbortSignal) => Promise<void>;
            assertInputCurrent?: () => void;
        }
        const assertManagementBindingCurrent = async (binding: AnswerVaultBinding | undefined): Promise<void> => {
            await binding?.managementProjection?.binding.prepare();
        };
        const rejectStaleProjection = (error: unknown): never => {
            // Only host projection boundaries opt into one fresh-input fallback.
            // Never convert cancellation or an explicit authorization rejection.
            if (isAbortError(error) || getProviderAdmissionError(error)) throw error;
            throw new ProviderInputReprepareRequiredError(error);
        };
        const assertAnswerVaultCurrent = (binding: AnswerVaultBinding | undefined): void => {
            if (!binding) return;
            try { binding.projection.binding.assertCurrent(); }
            catch (error) { rejectStaleProjection(error); }
            if (stableProviderJson(binding.providerInput) !== binding.serializedInput) {
                throw new Error("Vault observation projection changed before provider dispatch");
            }
        };
        const stableProviderJson = (value: unknown): string => {
            try { return JSON.stringify(value) ?? "undefined"; } catch { return "[unserializable]"; }
        };
        const stableProviderJsonAsync = async (value: unknown, signal?: AbortSignal): Promise<string> => {
            try { return await stringifyContextAsync(value, signal) ?? 'undefined'; }
            catch (error) { if (isAbortError(error)) throw error; return '[unserializable]'; }
        };
        const assertTranscriptCurrentAsync = async (transcript: readonly PaAgentMessage[], signal?: AbortSignal): Promise<void> => {
            const projected = await sourceRun.projectTranscriptAsync(transcript, signal);
            if (!sourceRun.isCurrent() || projected.length !== transcript.length
                || projected.some((message, index) => message !== transcript[index])) {
                throw new Error('Task material changed before provider dispatch');
            }
        };
        const buildProviderInput = async (
            input: PaAgentModelInput,
            definitions: ChatToolRegistryDefinition[],
            schemas: ChatToolProviderSchema[],
            vaultObservationProjection: VaultObservationProjection,
            sourceHistoryJson: string,
            managementProjection?: MemoryManagementProjection,
        ): Promise<{ providerInput: Record<string, unknown>; vaultBinding: AnswerVaultBinding }> => {
            assertRequestCurrent(input.signal);
            // All asynchronous preparation has finished. Even an absent result
            // replaces the previous background; it must never revive old Memory.
            injectedContext = readInjectedContext();
            const backgroundSourceCurrent = injectedContext?.isSourceCurrent;
            const backgroundGenerationSources = generationInputBackgroundSources(injectedContext);
            preparedBackground = formatBackground(injectedContext);
            preparedBackgroundSourceCurrent = backgroundSourceCurrent;
            if (writingStyle) {
                const budget = availableStyleBudget();
                if (writingStyle.context.length <= Math.min(WRITING_STYLE_MAX_CONTEXT_CHARS, budget.remainingTextChars, budget.remainingMemoryChars)) {
                    injectedContext = { ...injectedContext, writingStyleContext: writingStyle.context };
                } else {
                    writingStyle = undefined;
                }
            }
            let directoryReceipt = sourceRun.captureContextInstruction();
            let { providerInput: result, projection } = await buildCanonicalModelInput(
                input,
                definitions,
                schemas,
                vaultObservationProjection.history,
                directoryReceipt,
            );
            let actualToolSources = projection.sourceToolMessages;
            let actualHistorySources = projection.history.sourceMessages;
            let physicalVaultProjection = await sourceRun.prepareVaultObservationProjection(
                actualToolSources,
                actualHistorySources,
                input.signal,
            );
            if (await canonicalContextJsonAsync(physicalVaultProjection.transcript, input.signal) !== await canonicalContextJsonAsync(actualToolSources, input.signal)
                || await canonicalContextJsonAsync(physicalVaultProjection.history, input.signal) !== await canonicalContextJsonAsync(actualHistorySources, input.signal)) {
                // Revalidation can replace source observations while the request is
                // being assembled. Rebuild from the newer physical material; never
                // reuse the old projection's admission for the new payload.
                directoryReceipt = sourceRun.captureContextInstruction();
                const rebuilt = await buildCanonicalModelInput(
                    input,
                    definitions,
                    schemas,
                    physicalVaultProjection.history,
                    directoryReceipt,
                );
                result = rebuilt.providerInput;
                projection = rebuilt.projection;
                actualToolSources = projection.sourceToolMessages;
                actualHistorySources = projection.history.sourceMessages;
                physicalVaultProjection = await sourceRun.prepareVaultObservationProjection(
                    actualToolSources,
                    actualHistorySources,
                    input.signal,
                );
                if (await canonicalContextJsonAsync(physicalVaultProjection.transcript, input.signal) !== await canonicalContextJsonAsync(actualToolSources, input.signal)
                    || await canonicalContextJsonAsync(physicalVaultProjection.history, input.signal) !== await canonicalContextJsonAsync(actualHistorySources, input.signal)) {
                    throw new Error("Vault observation projection changed before provider dispatch");
                }
            }
            const writingContextAtRequest = currentWritingContext();
            const selectedImageDependencies: InputDependency[] = [];
            let selectedImageLineageUnknown = false;
            for (const image of imageScope?.selectedImages ?? []) {
                const historyOwner = admittedImageHistory.find(message => message.role === 'user'
                    && message.images?.some(candidate => candidate.ref.assetId === image.ref.assetId
                        && candidate.ref.contentHash === image.ref.contentHash));
                const owner = (options.images ?? []).some(current =>
                    current.ref.assetId === image.ref.assetId && current.ref.contentHash === image.ref.contentHash)
                    ? userMessageId : historyOwner?.hostProvenance?.messageId
                        ?? historyOwner?.runSourceSelection?.userMessageId;
                if (owner) selectedImageDependencies.push({ kind: 'attachment', ownerMessageId: owner, ref: { ...image.ref } });
                else selectedImageLineageUnknown = true;
            }
            const requestLineage = unionInputLineages(
                currentUserLineage,
                completeInputLineage(directoryReceipt.paths.map(path => ({ kind: 'vault', path, via: 'note' }))),
                ...actualHistorySources.map(historyInputLineage),
                ...actualToolSources.map(message => cloneInputLineage(message.inputLineage)),
                backgroundInputLineage(injectedContext, backgroundGenerationSources),
                selectedImageLineageUnknown ? unknownInputLineage(selectedImageDependencies)
                    : completeInputLineage(selectedImageDependencies),
                ...(writingContextAtRequest?.parent
                    ? [admittedParentLineages.get(writingContextAtRequest.parent.id)
                        ?? writingVersionInputLineage(writingContextAtRequest.parent)]
                    : allowLegacyWritingContext && options.writingContext
                        ? [cloneInputLineage(options.writingContext.inputLineage) ?? unknownInputLineage()] : []),
                ...(writingContextAtRequest?.styleContext ? [writingContextAtRequest.styleRevisionIds.length
                    ? completeInputLineage([{ kind: 'writing-style',
                        revisionIds: [...writingContextAtRequest.styleRevisionIds] }])
                    : unknownInputLineage()] : []),
                ...(writingStyle?.context ? [writingStyle.revisionIds.length
                    ? completeInputLineage([{ kind: 'writing-style', revisionIds: [...writingStyle.revisionIds] }])
                    : unknownInputLineage()] : []),
                ...(injectedContext?.pageletHandoff
                    ? [unknownInputLineage()] : []),
            );
            if (!await sourceRun.admitsLineageAsync(requestLineage, input.signal)) {
                throw new Error('Answer input lineage is outside the current task source scope');
            }
            const isAttachmentSourceCurrent = await captureAttachmentSourceValidity(requestLineage, input.signal);
            const isRequestLineageSourceCurrent = sourceRun.captureLineageSourceValidity(requestLineage);
            answerLineageByTurn.set(input.turnId, requestLineage);
            answerAttachmentValidityByTurn.set(input.turnId, isAttachmentSourceCurrent);
            const taskTranscript = input.transcript.map(cloneMessage);
            const admittedPaths = projection.sourceToolMessages.flatMap(message =>
                (message.content.sourceRecords ?? []).flatMap(record =>
                    record.path && !record.redacted && !record.statusOnly
                        && (record.kind === "context-used"
                            || (record.kind === "memory-reference" && record.citationEligible !== false))
                        ? [record.path] : []));
            const publishableAdmittedPaths = admittedPaths.filter(path => sourceRun.resolveNoteId(path) !== undefined);
            const admittedConstraint = sourceRun.state.snapshot();
            if (admittedConstraint && !sourceRun.publishAdmittedNotePaths(publishableAdmittedPaths, admittedConstraint)) {
                throw new Error("Admitted task sources changed before provider dispatch");
            }
            const assertWritingInputCurrent = writingContextRun?.captureTranscriptValidity(taskTranscript);
            const assertHistoryInputCurrent = sourceRun.captureSourceValidity([], actualHistorySources);
            const writingReadsCurrent = () => actualToolSources.every(message =>
                (writingReadReceipts.get(message.id) ?? []).every(receipt => receipt.isSourceCurrent()));
            // This receipt belongs to the exact projected material sent for the
            // answer. Keep it independent of Writing, and check authorization
            // and file identity at visible/final delivery without treating a
            // same-file content edit as revocation.
            const assertDeliveredTaskSources = sourceRun.capturePersistenceSourceValidity(
                actualToolSources, actualHistorySources);
            const isDeliveredSourceCurrent = () => {
                try {
                    assertDeliveredTaskSources();
                    if (!directoryReceipt.isCurrent() || !writingReadsCurrent()) return false;
                    if (backgroundSourceCurrent?.() === false || !isRequestLineageSourceCurrent()
                        || !isAttachmentSourceCurrent()) return false;
                    return true;
                } catch { return false; }
            };
            const answerVaultBinding: AnswerVaultBinding = {
                projection: physicalVaultProjection,
                providerInput: result,
                serializedInput: await stableProviderJsonAsync(result, input.signal),
                actualToolSources,
                actualHistorySources,
                sourceHistoryJson,
                isSourceCurrent: isDeliveredSourceCurrent,
                ...(managementProjection ? { managementProjection } : {}),
            };
            let preparedInputAdmission: Awaited<ReturnType<TaskSourceRun['prepareLineageAdmission']>> | undefined;
            const prepareInputCurrent = async (signal?: AbortSignal) => {
                assertWritingInputCurrent?.();
                if (!writingReadsCurrent()) throw new Error('Writing history source changed before provider dispatch');
                try {
                    if (!isAttachmentSourceCurrent()) {
                        throw new Error('Answer attachment source changed before provider dispatch');
                    }
                    await assertTranscriptCurrentAsync(taskTranscript, signal);
                    assertHistoryInputCurrent();
                    if (!directoryReceipt.isAttemptCurrent()) {
                        throw new Error('Published note directory changed before provider dispatch');
                    }
                    if (await stableProviderJsonAsync(await snapshotHistory(signal), signal) !== sourceHistoryJson) {
                        throw new Error("Chat history changed before provider dispatch");
                    }
                    if (await stableProviderJsonAsync(answerVaultBinding.providerInput, signal) !== answerVaultBinding.serializedInput) {
                        throw new Error('Vault observation projection changed before provider dispatch');
                    }
                    // Keep the fixed payload; ordinary edits only require another authorization seal.
                    // Bound retries so continuous changes still fail closed in the existing owner budget.
                    const sealingTask = createCooperativeTask(signal);
                    for (let attempt = 0; attempt < 3; attempt++) {
                        preparedInputAdmission = await sourceRun.prepareLineageAdmission(requestLineage, signal);
                        await answerVaultBinding.projection.binding.assertCurrentAsync?.(signal);
                        if (preparedInputAdmission.isCurrent()) {
                            answerVaultBinding.projection.binding.assertCurrent();
                            return;
                        }
                        if (attempt < 2) await sealingTask.checkpoint(true);
                    }
                    throw new Error('Answer input continued changing during preparation');
                } catch (error) { rejectStaleProjection(error); }
            };
            const assertInputCurrent = () => {
                assertWritingInputCurrent?.();
                if (!preparedInputAdmission?.isCurrent() || !writingReadsCurrent() || !isAttachmentSourceCurrent()
                    || !directoryReceipt.isAttemptCurrent()) {
                    rejectStaleProjection(new Error('Answer input changed before provider dispatch'));
                }
                assertAnswerVaultCurrent(answerVaultBinding);
            };
            answerVaultBinding.prepareInputCurrent = prepareInputCurrent;
            answerVaultBinding.assertInputCurrent = assertInputCurrent;
            if (writingContextRun) writingContextBudget = availableStyleBudget();
            if (options.writingRequest) {
                const context = currentWritingContext();
                const assertSourceValidity = sourceRun.captureSourceValidity(actualToolSources, actualHistorySources);
                const assertStoredSources = sourceRun.capturePersistenceSourceValidity(actualToolSources, actualHistorySources);
                const taskSources = sourceRun.captureGenerationInputTaskSources(actualToolSources, actualHistorySources);
                const assertContextSources = context ? writingContextRun?.captureSourceValidity() : undefined;
                const assertImageSources = imageScope?.captureSourceValidity();
                const styleSourceCurrent = writingStyle?.isSourceCurrent ?? writingStyle?.isCurrent;
                const background = preparedBackground;
                const historyIdentity = JSON.stringify((options.chatHistory ?? []).map(message => ({
                    role: message.role, content: message.content, ...chatHistoryImageMetadata(message),
                })));
                const selectedImages = cloneMessageImages(context?.images ?? imageScope?.writingMaterials ?? []);
                const styleRevisionIds = [...(context?.styleRevisionIds ?? writingStyle?.revisionIds ?? [])];
                const usesStyle = Boolean(context?.styleContext || writingStyle?.context || styleRevisionIds.length);
                const parent = context?.parent
                    ? { versionId: context.parent.id, textHash: context.parent.textHash }
                    : !writingContextHost && allowLegacyWritingContext && options.writingContext
                        ? { versionId: options.writingContext.parentVersionId, textHash: options.writingContext.textHash }
                        : undefined;
                preparedWritingGeneration = {
                    isSourceCurrent: () => {
                        let source = 'task';
                        const rejected = () => {
                            debug('generation_source_rejected', { turnId: input.turnId, source,
                                personalState: backgroundGenerationSources.personal.state,
                                insightsState: backgroundGenerationSources.insights.state });
                            return false;
                        };
                        try {
                            assertStoredSources();
                            if (!directoryReceipt.isCurrent()) return rejected();
                            source = 'writing_context';
                            assertContextSources?.();
                            source = 'images';
                            assertImageSources?.();
                            source = 'style';
                            if (styleSourceCurrent?.() === false) return rejected();
                            source = 'background';
                            if (backgroundSourceCurrent ? !backgroundSourceCurrent()
                                : background && background !== formatBackground(readInjectedContext())) return rejected();
                            source = 'history';
                            const historyCurrent = historyIdentity === JSON.stringify((options.chatHistory ?? []).map(message => ({
                                role: message.role, content: message.content, ...chatHistoryImageMetadata(message),
                            })));
                            return historyCurrent || rejected();
                        } catch { return rejected(); }
                    },
                    associatedImages: selectedImages,
                    styleRevisionIds,
                    generationInput: {
                        schemaVersion: 2,
                        inputPurpose: 'writing',
                        task: taskSources,
                        lineage: toGenerationInputLineage(requestLineage, taskSources.sources),
                        ...cloneGenerationInputBackgroundSources(backgroundGenerationSources),
                        style: !usesStyle ? { state: 'none' }
                            : styleRevisionIds.length > 0
                                ? { state: 'identified', revisionIds: [...styleRevisionIds] }
                                : { state: 'unknown' },
                        images: selectedImages.map(image => ({
                            ref: { ...image.ref }, hashAlgorithm: 'sha256',
                        })),
                        parent: parent
                            ? { state: 'identified', versionId: parent.versionId,
                                textHash: { algorithm: 'sha256', value: parent.textHash } }
                            : { state: 'none' },
                        pagelet: generationInputPageletSource(runSourceSelection?.scope === 'web'
                            ? undefined : options.pageletHandoff),
                    },
                    ...(context ? { context: { ...(context.parent ? { parentVersionId: context.parent.id } : {}),
                        ...(context.scene ? { scene: { ...context.scene } } : {}) } } : {}),
                    assertCurrent: () => {
                        assertRequestSourcesCurrent();
                        assertSourceValidity();
                        assertWritingInputCurrent?.();
                        if (context && currentWritingHandle() !== context.handle) throw new Error('Writing context changed');
                        if ((backgroundSourceCurrent ? !backgroundSourceCurrent()
                            : background !== formatBackground(readInjectedContext()))
                            || historyIdentity !== JSON.stringify((options.chatHistory ?? []).map(message => ({
                                role: message.role, content: message.content, ...chatHistoryImageMetadata(message),
                            })))) throw new Error('Writing generation input changed');
                    },
                };
            }
            if (imageScope?.hasImages) {
                result.messages = await buildPaAgentFinalMessagesAsync(projection.input, projection.actionHistory,
                    actionProjectionMode, imageScope.message(projection.input, input.signal),
                    projection.history, projection.currentInput, input.signal, projection);
            }
            const actualEnvelope = await measurePaAgentRequestEnvelopeAsync(result as Record<string, string>, schemas,
                result.messages as import("@langchain/core/messages").BaseMessage[], input.signal);
            const actualMaxChars = maxPromptChars;
            if (actualEnvelope.promptChars > actualMaxChars
                || (maxInputTokens !== undefined
                    && actualEnvelope.estimatedPromptTokens > maxInputTokens)) {
                debug('context_capacity_pressure', { promptChars: actualEnvelope.promptChars,
                    estimatedPromptTokens: actualEnvelope.estimatedPromptTokens,
                    maxInputTokens, basis: modelBudgetFacts.contextWindowSource });
            }
            assertProviderInputCurrent(input.signal);
            answerVaultBinding.serializedInput = await stableProviderJsonAsync(result, input.signal);
            answerVaultBinding.promptEstimate = actualEnvelope;
            lastAnswerPromptChars = actualEnvelope.promptChars;
            physicalVaultProjection.serializedInput = answerVaultBinding.serializedInput;
            answerVaultBinding.providerInput = result;
            await prepareInputCurrent(input.signal);
            answerSourceValidity = answerVaultBinding.isSourceCurrent;
            return { providerInput: result, vaultBinding: answerVaultBinding };
        };
        const prepareCanonicalProviderInput = async (
            input: PaAgentModelInput, definitions: ChatToolRegistryDefinition[], schemas: ChatToolProviderSchema[],
        ): Promise<{ providerInput: Record<string, unknown>; vaultBinding: AnswerVaultBinding }> => {
            if (imageScope?.hasSelectedImages && options.imageCapability?.get() === "unsupported") throw new ChatImageRequestError("unsupported_model");
            if (imageScope?.hasSelectedImages) await imageScope.prepare(input.signal);
            const prepared = input.prepareForProviderRetry ? await input.prepareForProviderRetry() : input;
            const sourceHistory = await snapshotHistory(prepared.signal);
            const managementProjection = await prepareManagementProjection(prepared.transcript, sourceHistory);
            const vaultObservationProjection = await sourceRun.prepareVaultObservationProjection(
                managementProjection.transcript,
                managementProjection.history,
                prepared.signal,
            );
            return await buildProviderInput({
                ...prepared,
                transcript: vaultObservationProjection.transcript,
            }, definitions, schemas, vaultObservationProjection, await stableProviderJsonAsync(sourceHistory, input.signal), managementProjection);
        };
        const debugModelIdentity = () => ({ provider: this.host.settings.aiProvider, model: this.host.settings.chatModelName });
        const model: PaAgentModel = {
            reportsProviderRequestStart: true,
            stream: async function* (input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
                const debugCall = createAgentDebugCall(debugRecorder, {
                    parentId: input.turnId, turnId: input.turnId, purpose: "answer",
                    ...debugModelIdentity(),
                    lineage: { unknown: true },
                    getAttachments: imageScope ? () => imageScope.debugAttachments() : undefined,
                }, usageLedger);
                let debugConsumerEnded = false;
                let debugProviderCompletion: string | undefined;
                try {
                if (!additionalProvidersLoaded) {
                    additionalProvidersLoaded = true;
                    await loadAdditionalCapabilityProviders(input.turnId, input.signal);
                }
                const activeToolUseConstraints = toolConstraintsFromAgentControlSnapshot(input.controlSnapshot)
                    ?? toolUseConstraints;
                const exportFilter = {
                    ...activeToolUseConstraints,
                    blockedToolNames: new Set([
                        ...(activeToolUseConstraints.blockedToolNames ?? []), ...fixedBlockedToolNames,
                    ]),
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
                if (!hasOperationsStagedAcknowledgementInstruction(input.runtimeInstruction)) {
                    schemas.push(taskIncompleteOutputSchema());
                }
                const nativeContextHandle = currentWritingHandle();
                if (nativeWritingRequest && nativeContextHandle && input.controlSnapshot?.writingOutput === "present_writing") {
                    schemas.push(nativeWritingOutputSchema(nativeWritingRequest, nativeContextHandle));
                }
                const toolDefinitions = input.toolMode === "final_answer_only"
                    ? []
                    : toolRegistry.listDefinitions(exportFilter);
                const streamAttempt: { binding?: AnswerVaultBinding } = {};
                const invokeAttempt: { binding?: AnswerVaultBinding } = {};
                const createAnswerModel = async (attempt: { binding?: AnswerVaultBinding }) =>
                    await planner.createFinalAnswerModel(0.8, {
                        transport: "native",
                        expectedModelIdentity: budgetModelIdentity,
                        ...(modelBudgetFacts.maxTokens ? { maxTokens: modelBudgetFacts.maxTokens } : {}),
                        qwenRequestOptions: options.qwenRequestOptions,
                        providerRequestScope,
                        agentDebugCall: debugCall,
                        prepareProviderRequest: async signal => {
                            await traceAgentPhase(debug, 'provider_source_prepare', async () => {
                                if (!attempt.binding) throw new Error("Answer vault observation projection is not bound");
                                try { await attempt.binding.projection.binding.prepare(signal); }
                                catch (error) { rejectStaleProjection(error); }
                                await assertManagementBindingCurrent(attempt.binding);
                                await attempt.binding.prepareInputCurrent?.(signal ?? undefined);
                                assertAnswerVaultCurrent(attempt.binding);
                            }, { turnId: input.turnId, stage: 'answer' });
                        },
                        onProviderRequestStart: () => {
                            debug('provider_admission:start', { turnId: input.turnId, stage: 'answer' });
                            try {
                                const binding = attempt.binding;
                                if (!binding) throw new Error("Answer vault observation projection is not bound");
                                if (binding.promptEstimate && debugCall) debugCall.promptEstimate = {
                                    tokens: binding.promptEstimate.estimatedPromptTokens,
                                    method: binding.promptEstimate.estimateMethod,
                                };
                                assertProviderInputCurrent(input.signal);
                                binding.assertInputCurrent?.();
                                assertAnswerVaultCurrent(binding);
                                binding.managementProjection?.binding.assertCurrent();
                                if (preparedWritingGeneration && !preparedWritingGeneration.isSourceCurrent()) {
                                    throw new Error('Writing generation sources changed before provider dispatch');
                                }
                                answerSourceValidity = binding.isSourceCurrent;
                                writingGeneration = preparedWritingGeneration;
                                input.notifyProviderRequestStarted?.();
                                debug('provider_admission:end', { turnId: input.turnId, stage: 'answer' });
                            } catch (error) {
                                debug('provider_admission:error', { turnId: input.turnId, stage: 'answer', ...describeAgentError(error) });
                                throw error;
                            }
                        },
                        onProviderRequestFailed: input.notifyProviderRequestFailed,
                        onProviderRequestDiagnostic: requestDiagnostic("answer", input.turnId),
                        isProviderRequestTraceEnabled: debugEnabled,
                        onProviderRequestTrace: (event: import('./obsidian-fetch').ProviderRequestTrace) =>
                            debug(event.phase, { ...event, stage: 'answer', turnId: input.turnId }),
                    });
                const llm = await traceAgentPhase(debug, 'model_create', () => createAnswerModel(streamAttempt), { turnId: input.turnId });
                actionProjectionMode = llm instanceof ChatOpenAI ? "native" : "compat";
                if (nativeWritingRequest && !asNativeToolBindableModel(llm)) {
                    throw new Error("Native writing requires model tool binding.");
                }
                const streamedToolNames = new Map<string, string>();
                const prompt = createPaAgentAnswerStreamPrompt();
                const streamRunnable = bindStreamingToolsIfAvailable(llm, schemas);
                const streamChain = prompt.pipe(streamRunnable) as unknown as NativeToolStreamingAndInvocableRunnable;
                let invokeChain: NativeToolStreamingAndInvocableRunnable | undefined;
                const chain: NativeToolStreamingAndInvocableRunnable = {
                    stream: (request, config) => {
                        assertProviderInputCurrent(input.signal);
                        if (!streamAttempt.binding) throw new Error("Answer vault observation projection is not bound");
                        return streamChain.stream(request, config);
                    },
                    invoke: async (request, config) => {
                        assertProviderInputCurrent(input.signal);
                        if (!invokeAttempt.binding) throw new Error("Answer vault observation projection is not bound");
                        if (!invokeChain) {
                            const invokeLlm = await createAnswerModel(invokeAttempt);
                            if (actionProjectionMode === "native" && !(invokeLlm instanceof ChatOpenAI)) {
                                throw new Error("Invoke adapter cannot represent the native action history");
                            }
                            if (nativeWritingRequest && !asNativeToolBindableModel(invokeLlm)) {
                                throw new Error("Native writing requires model tool binding.");
                            }
                            invokeChain = prompt.pipe(
                                bindStreamingToolsIfAvailable(invokeLlm, schemas),
                            ) as unknown as NativeToolStreamingAndInvocableRunnable;
                        }
                        return invokeChain.invoke(request, config);
                    },
                };
                // Model/provider construction may suspend after the Loop's
                // ordinary preflight. Revalidate again only once the real
                // chain is ready, then synchronously rebuild the canonical
                // prompt immediately before the first provider request.
                let providerInput = input.prepareForProviderRetry
                    ? await traceAgentPhase(debug, 'input_revalidation', () => input.prepareForProviderRetry!(), { turnId: input.turnId })
                    : input;
                injectedContext = readInjectedContext();
                const preview = await previewCanonicalModelInput(providerInput, toolDefinitions, schemas);
                const needsHistorySummary = preview.history.historyBudgetLimited === true;
                if (input.toolMode !== "final_answer_only" && preview.outcome.needsCompaction) {
                    debug('context_summary:start', { turnId: input.turnId });
                    // Summary guards include selected image currentness. Establish
                    // those receipts before the optional summary invokes them.
                    if (imageScope?.hasSelectedImages) {
                        if (options.imageCapability?.get() === "unsupported") throw new ChatImageRequestError("unsupported_model");
                        await imageScope.prepare(providerInput.signal);
                    }
                    const startedAt = Date.now();
                    let modelCalls = 0;
                    // Each physical summary request owns its 30-minute attempt
                    // budget. The orchestration block itself must not impose an
                    // older short aggregate deadline across multiple requests.
                    const preparation = new TurnExecutionDeadline(
                        input.signal,
                        Number.POSITIVE_INFINITY,
                        "context_summary_timeout",
                    );
                    const tools = new Map(runSummaries.tools);
                    // Summary models are tool-free and share the run's provider request scope.
                    // Revalidate each tool source after model construction, immediately before dispatch.
                    const invokeForSource = (source?: PaAgentToolSummarySource, history?: readonly ChatMessage[]): PaAgentSummaryInvoke => async (payload, signal) => {
                        const summaryCall = createAgentDebugCall(debugRecorder, {
                            parentId: input.turnId, turnId: input.turnId, purpose: "context_summary",
                            ...debugModelIdentity(),
                            lineage: { unknown: true },
                        }, usageLedger);
                        if (!summaryCall) throw new Error('Summary usage accounting is unavailable');
                        interface SummaryVaultBinding {
                            projection: VaultObservationProjection;
                            lineage: InputLineage;
                            isAttachmentSourceCurrent: () => boolean;
                            serializedInput: string;
                            expectedSources: readonly PaAgentSummaryBindingSource[];
                            historySources?: readonly ChatMessage[];
                            historySourceIndexes?: readonly number[];
                            managementSource?: PaAgentToolSummarySource;
                            serializedManagementSource?: string;
                            managementProjection?: MemoryManagementProjection;
                            admission?: Awaited<ReturnType<TaskSourceRun['prepareLineageAdmission']>>;
                            estimatedPromptTokens?: number;
                        }
                        const summaryVaultState: { binding?: SummaryVaultBinding } = {};
                        const budgetActivity = auxiliarySummaryBudget.begin(summaryCall.callId, payload.maxOutputTokens);
                        const summaryAttemptClock = createPaAgentSummaryAttemptClock(signal);
                        try {
                        let summarySource = source;
                        const summaryModel = await planner.createFinalAnswerModel(0, {
                            transport: "native", maxTokens: payload.maxOutputTokens,
                            expectedModelIdentity: budgetModelIdentity,
                            qwenRequestOptions: { enableThinking: false }, providerRequestScope,
                            agentDebugCall: summaryCall,
                            prepareProviderRequest: async prepareSignal => {
                                if (!summaryVaultState.binding) throw new Error("Summary vault observation projection is not bound");
                                if (!await sourceRun.admitsLineageAsync(summaryVaultState.binding.lineage, prepareSignal ?? undefined)) {
                                    throw new Error('Context summary lineage changed before dispatch');
                                }
                                if (!summaryVaultState.binding.isAttachmentSourceCurrent()) {
                                    throw new Error('Context summary attachment source changed before dispatch');
                                }
                                await summaryVaultState.binding.projection.binding.prepare(prepareSignal);
                                if (summaryVaultState.binding.managementSource) {
                                    const currentManagement = await projectManagementObservations([summaryVaultState.binding.managementSource]);
                                    const current = currentManagement.find(message => message.id === summaryVaultState.binding?.managementSource?.id);
                                    if (current?.role !== "toolResult" || stableJson(current) !== summaryVaultState.binding.serializedManagementSource) {
                                        throw new Error("Context summary Memory management source changed before dispatch");
                                    }
                                }
                                await summaryVaultState.binding.managementProjection?.binding.prepare(prepareSignal);
                                if (summarySource) await assertTranscriptCurrentAsync([summarySource], prepareSignal ?? undefined);
                                const boundHistory = summaryVaultState.binding.historySources;
                                const indexes = summaryVaultState.binding.historySourceIndexes;
                                if (boundHistory && indexes) {
                                    const currentHistory = await sourceRun.projectHistoryAsync(options.chatHistory ?? [], prepareSignal ?? undefined);
                                    boundHistory.forEach((message, index) => {
                                        const current = currentHistory[indexes[index]! - 1];
                                        if (!current || !isCurrentHistorySummary({ text: '', sourceMessages: [message] }, [current])) {
                                            throw new Error('Context summary source changed before dispatch');
                                        }
                                    });
                                }
                                if (await stableProviderJsonAsync(payload.messages, prepareSignal ?? undefined) !== summaryVaultState.binding.serializedInput
                                    || await stableProviderJsonAsync(payload.bindingSources ?? [], prepareSignal ?? undefined)
                                        !== await stableProviderJsonAsync(summaryVaultState.binding.expectedSources, prepareSignal ?? undefined)) {
                                    throw new Error("Summary vault observation projection changed before dispatch");
                                }
                                const sealingTask = createCooperativeTask(prepareSignal ?? undefined);
                                for (let attempt = 0; attempt < 3; attempt++) {
                                    summaryVaultState.binding.admission = await sourceRun.prepareLineageAdmission(
                                        summaryVaultState.binding.lineage, prepareSignal ?? undefined);
                                    await summaryVaultState.binding.projection.binding.assertCurrentAsync?.(prepareSignal ?? undefined);
                                    if (summaryVaultState.binding.admission.isCurrent()) {
                                        summaryVaultState.binding.projection.binding.assertCurrent();
                                        return;
                                    }
                                    if (attempt < 2) await sealingTask.checkpoint(true);
                                }
                                throw new Error('Context summary sources continued changing during preparation');
                            },
                            onProviderRequestStart: () => {
                                assertRequestCurrent(signal);
                                if (!summaryVaultState.binding) throw new Error("Summary vault observation projection is not bound");
                                if (!summaryVaultState.binding.admission?.isCurrent()) {
                                    throw new Error('Context summary lineage changed before physical dispatch');
                                }
                                if (!summaryVaultState.binding.isAttachmentSourceCurrent()) {
                                    throw new Error('Context summary attachment source changed before physical dispatch');
                                }
                                if (summarySource) writingContextRun?.captureTranscriptValidity([summarySource])();
                                summaryVaultState.binding.projection.binding.assertCurrent();
                                summaryVaultState.binding.managementProjection?.binding.assertCurrent();
                                const estimatedPromptTokens = summaryVaultState.binding.estimatedPromptTokens;
                                if (estimatedPromptTokens === undefined) throw new Error('Context summary budget is not prepared');
                                summaryCall.promptEstimate = {
                                    tokens: estimatedPromptTokens,
                                    method: 'cjk_json_messages',
                                };
                                budgetActivity.admit(estimatedPromptTokens);
                                summaryAttemptClock.start();
                            },
                            onProviderRequestFailed: summaryAttemptClock.failed,
                            onProviderRequestDiagnostic: requestDiagnostic("context_summary", input.turnId),
                            onProviderRequestTrace: (event: import('./obsidian-fetch').ProviderRequestTrace) =>
                                debug(event.phase, { ...event, stage: 'context_summary', turnId: input.turnId }),
                            isProviderRequestTraceEnabled: debugEnabled,
                        });
                        assertRequestCurrent(signal);
                        if (source) {
                            // Optional summary work uses its own cancellation scope. Do not
                            // mutate the Loop's retry input or fail-close the entire run on
                            // a summary timeout. The registry rejects aborted/late projections.
                            let refreshed = await sourceRun.projectTranscriptAsync(
                                await projectManagementObservations([cloneMessage(source)]), signal,
                            );
                            refreshed = await sourceRun.projectTranscriptAsync(
                                await memoryEvidenceRegistry.prepareTranscript(refreshed, signal), signal,
                            );
                            if (writingContextRun) refreshed = await writingContextRun.projectTranscript(refreshed, signal);
                            const current = refreshed.find((message) => message.id === source.id);
                            if (current?.role !== "toolResult" || !isCurrentToolSummary({ text: "", source }, current)) {
                                throw new Error("Context summary source changed before dispatch");
                            }
                            if (current?.role === "toolResult") summarySource = current;
                        }
                        assertRequestCurrent(signal);
                        const sourceForSummary = summarySource ? [summarySource] : [];
                        const bindingHistorySources = payload.bindingSourceMessages
                            ? [...payload.bindingSourceMessages]
                            : [];
                        const summaryManagementProjection = await prepareManagementProjection(sourceForSummary, bindingHistorySources);
                        const summaryVaultProjection = await sourceRun.prepareVaultObservationProjection(
                            summaryManagementProjection.transcript,
                            summaryManagementProjection.history,
                            signal,
                        );
                        let expectedSources: readonly PaAgentSummaryBindingSource[];
                        const suppliedSources = payload.bindingSources ?? [];
                        if (summarySource) {
                            const projectedSource = summaryVaultProjection.transcript.find(message => message.id === summarySource?.id);
                            if (projectedSource?.role !== "toolResult"
                                || projectedSource.content.promptText !== summarySource.content.promptText) {
                                throw new Error("Context summary source changed before dispatch");
                            }
                            expectedSources = [{ index: 1, role: "tool", content: projectedSource.content.promptText,
                                actionResult: projectPaAgentToolStatus(projectedSource) }];
                        } else {
                            if (
                                bindingHistorySources.length !== suppliedSources.length
                                || summaryVaultProjection.history.length !== suppliedSources.length
                            ) {
                                throw new Error("Context summary source changed before dispatch");
                            }
                            let sourceMatchesProjection = true;
                            for (const [index, item] of suppliedSources.entries()) {
                                const message = summaryVaultProjection.history[index];
                                const content = message ? await prepareContextSteps(historySummaryContentSteps(message), signal) : undefined;
                                const actionStates = message ? projectPaAgentSummaryActionStates(message) : undefined;
                                if (!message || message.role !== item.role || content !== item.content
                                    || stableProviderJson(item.actionStates) !== stableProviderJson(actionStates)) {
                                    sourceMatchesProjection = false;
                                    break;
                                }
                            }
                            if (!sourceMatchesProjection) {
                                throw new Error("Context summary source changed before dispatch");
                            }
                            expectedSources = suppliedSources;
                        }
                        if (stableProviderJson(payload.bindingSources ?? []) !== stableProviderJson(expectedSources)) {
                            throw new Error("Context summary source changed before dispatch");
                        }
                        if (!summarySource) {
                            const currentHistory = await sourceRun.projectHistoryAsync(options.chatHistory ?? [], signal);
                            for (const [offset, source] of suppliedSources.entries()) {
                                const current = currentHistory[source.index - 1];
                                if (!current || !isCurrentHistorySummary({ text: '', sourceMessages: [bindingHistorySources[offset]] }, [current])) {
                                    throw new Error('Context summary source changed before invoke');
                                }
                            }
                            const coveredCount = payload.bindingCoveredMessageCount;
                            if (!Number.isInteger(coveredCount) || coveredCount! <= 0 || coveredCount! > currentHistory.length) {
                                throw new Error('Context summary covered source domain is unavailable');
                            }
                            const coveredHistory = currentHistory.slice(0, coveredCount);
                            const protectedIndexes = await prepareContextSteps(protectedHistorySourceIndexesSteps(coveredHistory), signal);
                            if (stableProviderJson([...protectedIndexes]) !== stableProviderJson(payload.bindingProtectedSourceIndexes)
                                || [...protectedIndexes].some(index => !suppliedSources.some(source => source.index === index))) {
                                throw new Error('Context summary protected source domain changed');
                            }
                            const retainedFacts = await prepareContextSteps(projectPaAgentRetainedActionFactsSteps(coveredHistory), signal);
                            if (!await prepareContextSteps(matchesPaAgentHistorySummaryPayloadSteps(payload.messages,
                                expectedSources, protectedIndexes, retainedFacts, payload.bindingPreviousSummary), signal)) {
                                throw new Error('Context summary action anchors or free sources changed');
                            }
                        }
                        const summaryLineage = unionInputLineages(
                            ...(summarySource ? [cloneInputLineage(summarySource.inputLineage)] : []),
                            ...bindingHistorySources.map(historyInputLineage),
                        );
                        if (!await sourceRun.admitsLineageAsync(summaryLineage, signal)) {
                            throw new Error('Context summary sources are outside the current scope');
                        }
                        const isAttachmentSourceCurrent = await captureAttachmentSourceValidity(summaryLineage, signal);
                        summaryVaultState.binding = {
                            projection: summaryVaultProjection,
                            lineage: summaryLineage,
                            isAttachmentSourceCurrent,
                            serializedInput: await stableProviderJsonAsync(payload.messages, signal),
                            expectedSources,
                            historySources: bindingHistorySources,
                            historySourceIndexes: suppliedSources.map(source => source.index),
                            ...(summarySource ? {
                                managementSource: summarySource,
                                serializedManagementSource: stableJson(summarySource),
                            } : {}),
                            managementProjection: summaryManagementProjection,
                            admission: await sourceRun.prepareLineageAdmission(summaryLineage, signal),
                        };
                        summaryVaultState.binding.estimatedPromptTokens = await estimatePaAgentTextTokensAsync(
                            summaryVaultState.binding.serializedInput, signal);
                        modelCalls++;
                        const response = await summaryModel.invoke(payload.messages, { signal: summaryAttemptClock.signal });
                        // The provider has already returned this usage. Record it even if
                        // the source changed while the request was in flight.
                        observeAgentDebugResponse(summaryCall, response, "replace", "provider-usage", "usage_only");
                        if (!isAttachmentSourceCurrent()) {
                            throw new Error('Context summary attachment source changed before delivery');
                        }
                        const cancelledBeforeDelivery = summaryAttemptClock.signal.aborted
                            || signal.aborted || input.signal?.aborted === true;
                        const sourceCurrent = summaryVaultState.binding !== undefined
                            && sourceRun.isCurrent()
                            && sourceRun.admitsLineage(summaryVaultState.binding.lineage);
                        if (cancelledBeforeDelivery || !sourceCurrent) {
                            observeAgentDebugCall(summaryCall, { phase: 'consumer_end',
                                status: cancelledBeforeDelivery ? 'cancelled' : 'partial',
                                missingReason: cancelledBeforeDelivery
                                    ? 'cancelled_before_delivery' : 'source_changed_before_delivery' });
                            return undefined;
                        }
                        observeAgentDebugResponse(summaryCall, response, "replace", "provider-usage", "content_only");
                        observeAgentDebugCall(summaryCall, { phase: "consumer_end", status: "completed",
                            timing: { event: "consumer_end", at: agentDebugNow() } });
                        return stringifyChunkContent(response);
                        } catch (error) {
                            observeAgentDebugCall(summaryCall, { phase: "error", status: signal?.aborted ? "cancelled" : "failed", error: agentDebugError(error) });
                            throw error;
                        } finally {
                            summaryAttemptClock.dispose();
                            budgetActivity.finish();
                        }
                    };
                    try {
                        const outerManagementProjection = await prepareManagementProjection(
                            providerInput.transcript,
                            await snapshotHistory(preparation.signal),
                        );
                        providerInput = {
                            ...providerInput,
                            transcript: outerManagementProjection.transcript,
                        };
                        const summaryProjection = await sourceRun.prepareVaultObservationProjection(
                            providerInput.transcript,
                            outerManagementProjection.history,
                            preparation.signal,
                        );
                        providerInput = {
                            ...providerInput,
                            transcript: summaryProjection.transcript,
                        };
                        const historySources = isOperationsStagedAcknowledgement(input.runtimeInstruction)
                            ? undefined
                            : summaryProjection.history;
                        const history = needsHistorySummary ? await contextSummarizer.prepareHistory({
                            history: historySources ?? [],
                            historyBudgetChars: preview.historyBudgetChars,
                            coldWritingVersions: projectionOptions().coldWritingVersions,
                            protectedWritingVersionIds: projectionOptions().protectedWritingVersionIds,
                            invoke: invokeForSource(undefined, historySources), signal: preparation.signal,
                            deadlineManagedByInvoke: true,
                        }) : runSummaries.history;
                        runSummaries = { history, tools };
                        let remaining = await previewCanonicalModelInput(providerInput, toolDefinitions, schemas);
                        for (const source of getPaAgentToolSummaryCandidates(summaryProjection.transcript)) {
                            if (!remaining.outcome.needsCompaction) break;
                            const serializedSource = await stableProviderJsonAsync(source, preparation.signal);
                            if (toolSummaryAttempts.get(source.id) === serializedSource) continue;
                            // A failed or non-reducing optional summary must not
                            // repeat on every turn while its exact source is unchanged.
                            toolSummaryAttempts.set(source.id, serializedSource);
                            const summary = await contextSummarizer.prepareTool({ source,
                                invoke: invokeForSource(source), signal: preparation.signal,
                                deadlineManagedByInvoke: true });
                            if (summary) {
                                tools.set(source.id, summary);
                                remaining = await previewCanonicalModelInput(providerInput, toolDefinitions, schemas);
                            }
                        }
                    } catch (error) {
                        // Optional compaction failure keeps complete original context;
                        // user cancellation and the final source checks still apply.
                        if (input.signal?.aborted) throw error;
                    } finally {
                        preparation.dispose();
                        debug('context_summary:end', { turnId: input.turnId, modelCalls, durationMs: Date.now() - startedAt });
                    }
                    yield { type: "diagnostic", diagnostic: {
                        type: "context_summary_preparation", modelCalls,
                        elapsedMs: Math.max(0, Date.now() - startedAt),
                        auxiliaryBudget: auxiliarySummaryBudget.snapshot(),
                        historyReady: Boolean(runSummaries.history), toolSummaries: tools.size,
                    } };
                    // No summary derived before this await may bypass final source validation.
                    providerInput = input.prepareForProviderRetry
                        ? await input.prepareForProviderRetry() : input;
                }
                const canonicalAnswer = await traceAgentPhase(debug, 'canonical_projection',
                    () => prepareCanonicalProviderInput(providerInput, toolDefinitions, schemas),
                    { turnId: input.turnId, toolMode: input.toolMode ?? 'normal', toolCount: schemas.length });
                streamAttempt.binding = canonicalAnswer.vaultBinding;
                debug('llm_stream:start', { turnId: input.turnId, toolCount: schemas.length });
                // P0-D: if streaming fails before any visible output (e.g., provider rejected stream
                // outright or dropped the connection pre-flight), retry via chain.invoke() so the user
                // still gets the answer instead of a hard runtime error.
                for await (const chunk of streamWithInvokeFallback({
                    chain,
                    debugCall,
                    input: canonicalAnswer.providerInput,
                    // The loop-owned signal links user cancellation with the
                    // current soft/hard deadline. The outer request signal
                    // alone would let a timed-out stream/invoke keep running.
                    signal: providerInput.signal,
                    isDebugContentCurrent: () => {
                        try { return isPreviewCurrent(); }
                        catch { return false; } // A stale receipt must not persist rejected content in Debug.
                    },
                    streamedToolNames,
                    captureToolIdentity: Boolean(nativeWritingRequest),
                    requestDiagnostics: (requestInput) => {
                        const canonicalInput = requestInput as Record<string, string>;
                        const projection = parseOptionalDiagnostic(canonicalInput.__context_projection_diagnostic);
                        return [
                            ...(projection && typeof projection === "object"
                                ? [projection as Record<string, unknown>] : []),
                            createPaAgentModelInputMetricsDiagnostic({
                                canonicalInput,
                                providerSchemaExportOk: schemaResult.ok,
                                exportedProviderSchemaCount: schemaResult.ok ? schemaResult.schemas.length : 0,
                                boundProviderSchemas: schemas,
                                plannerToolDefinitions: toolDefinitions,
                            }),
                            ...(imageScope?.hasImages ? [imageScope.diagnostics()] : []),
                        ];
                    },
                    prepareInvokeInput: async () => {
                        const invokeAnswer = await prepareCanonicalProviderInput(input, toolDefinitions, schemas);
                        invokeAttempt.binding = invokeAnswer.vaultBinding;
                        return invokeAnswer.providerInput;
                    },
                    onFallback: (reason, error) => {
                        debug('llm_invoke_fallback', { turnId: input.turnId, reason, ...describeAgentError(error) });
                        legacyEvents.activity(
                            "fallback-stream-invoke",
                            imageScope?.hasImages
                                ? `Native streaming failed (${reason}); retrying the same image request via invoke().`
                                : `Native streaming failed (${reason}); retrying via invoke(): ${errorMessage(error)}`,
                            {
                                legacyStatus: {
                                    type: "fallback",
                                    reason: "Streaming unavailable; falling back to invoke().",
                                } satisfies ChatAgentStatus,
                            },
                        );
                    },
                })) {
                    if (chunk.type === "provider_completion") debugProviderCompletion = chunk.completion;
                    const providerUsage = readProviderUsageDiagnostic(chunk);
                    if (providerUsage) {
                        contextManager.recordProviderUsage(providerUsage);
                    }
                    yield chunk;
                }
                if (imageScope?.hasSelectedImages) options.imageCapability?.onSuccess();
                debug('llm_stream:end', { turnId: input.turnId });
                observeAgentDebugCall(debugCall, { phase: "consumer_end", status: "completed",
                    timing: { event: "consumer_end", at: agentDebugNow() } });
                debugConsumerEnded = true;
                } catch (error) {
                    const debugErrorStatus = debugProviderCompletion === "stop" ? "completed" : input.signal?.aborted ? "cancelled" : "failed";
                    observeAgentDebugCall(debugCall, { phase: "error", status: debugErrorStatus, error: agentDebugError(error),
                        ...(debugProviderCompletion ? { missingReason: "transport_ended_after_completion" } : {}),
                        timing: { event: "consumer_end", at: agentDebugNow() } });
                    debugConsumerEnded = true;
                    debug('llm_stream:error', { turnId: input.turnId, status: debugErrorStatus, ...describeAgentError(error) });
                    if (!imageScope?.hasImages || isAbortError(error, input.signal) || error instanceof PaAgentContextOverflowError) throw error;
                    // Preserve the recoverable category without exposing SDK errors
                    // that may contain the private image request body.
                    if (isProviderContextOverflow(error)) throw Object.assign(
                        new Error('Provider context window exceeded'), { code: 'context_length_exceeded' });
                    options.imageCapability?.onError(error);
                    throw error instanceof ChatImageRequestError ? error
                        : new ChatImageRequestError(isStructuredImageUnsupportedError(error) ? "unsupported_model" : "provider_failed");
                } finally {
                    if (!debugConsumerEnded) observeAgentDebugCall(debugCall, {
                        phase: "consumer_end", status: debugProviderCompletion ? "completed" : input.signal?.aborted ? "cancelled" : "partial",
                        missingReason: "consumer_closed_before_eof", timing: { event: "consumer_end", at: agentDebugNow() },
                    });
                }
            },
        };
        const baseToolExecutor = createPaAgentCapabilityToolExecutor({
            registry: this.toolRegistry,
            ...(writingContextRun ? { isWritingSelectionCurrent: writingContextRun.matchesCurrentSelection.bind(writingContextRun) } : {}),
            host: this.host,
            platform: this.options.runtimePlatform ?? "desktop",
            memoryEvidenceRegistry,
            memoryRecoveryCoordinator,
            providerRequestScope,
            memoryPreparationOwnerSignal,
            getMemoryRequestDiagnostic: (turnId) => (stage) => requestDiagnostic(stage, turnId),
            getMemoryDebugScope: (turnId, toolCallId) => ({
                recorder: debugRecorder, usageLedger,
                parentId: `${turnId}:tool:${toolCallId}`, turnId,
            }),
            getImageRequestLineage: turnId => cloneInputLineage(answerLineageByTurn.get(turnId ?? '')),
            getCreateImageRuntime: turnId => ({
                recorder: debugRecorder, usageLedger,
                parentId: turnId ?? `${runId}:image-preparation`,
                turnId,
            }),
            currentMemoryUsage,
            memoryActionRequest,
            revalidateMemorySearch: (result, signal, temporalFilter, temporalAudit, guard) => (
                this.memoryTool.revalidateForProvider(
                    result,
                    signal,
                    temporalFilter,
                    temporalAudit,
                    guard,
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
        const materialToolExecutor = operationsActionsEligible && this.options.operationsIntentController
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
        const batchSourceInputs = new WeakMap<object, { lineage: InputLineage; attachmentCallIds: string[] }>();
        const toolExecutor = createTaskSourceConstrainedExecutor({
            baseExecutor: materialToolExecutor, state: sourceRun.state,
            resolveHostNoteId: sourceRun.resolveNoteId,
            isHostCurrent: sourceRun.isCurrent,
            isWebAllowed: sourceRun.isWebReadAllowed,
            isMemoryAllowed: sourceRun.isMemoryReadAllowed,
            prepareInputSourceAdmission: async (calls, signal) => {
                let input = batchSourceInputs.get(calls);
                if (!input) {
                    const lineages = calls.map(call => callLineageById.get(call.id));
                    input = { lineage: unionInputLineages(...lineages),
                        attachmentCallIds: calls.filter((_call, index) => lineages[index]?.dependencies.some(
                            dependency => dependency.kind === 'attachment')).map(call => call.id) };
                    batchSourceInputs.set(calls, input);
                }
                const admission = await sourceRun.prepareLineageAdmission(input.lineage, signal);
                const attachmentCallIds = input.attachmentCallIds;
                const attachmentsCurrent = () => attachmentCallIds.every(id => callAttachmentValidityById.get(id)?.() === true);
                return {
                    isCurrent: () => admission.isCurrent() && attachmentsCurrent(),
                    sourceValidity: () => admission.sourceValidity() && attachmentsCurrent(),
                    authorityValidity: () => admission.authorityValidity() && attachmentsCurrent(),
                };
            },
            resolveNoteSearchScope: sourceRun.resolveNoteSearchScope,
            resolveReadPlans: calls => {
                // These fixed capabilities use their own admission ports.
                // create_image rechecks registered image refs and cost in the
                // host callback; it grants no generic vault source read.
                const independent = calls.filter(call => {
                    const capability = this.toolRegistry.get(call.name);
                    const memoryManagement = this.host.memoryManagement !== undefined
                        && (call.name === "get_memory_status"
                            || call.name === "query_memories"
                            || call.name === "get_memory_usage"
                            || call.name === "manage_memory");
                    const insightRead = this.host.insightRead !== undefined
                        && (call.name === "get_vault_insights" || call.name === "query_saved_insights");
                    const insightAction = this.host.insightActions !== undefined
                        && call.name === "manage_saved_insight";
                    return capability !== undefined && (capability === imageCapability
                        || capability === imageGenerationCapability
                        || capability === ghostPublishingCapability
                        || capability === imageStatusCapability
                        || capability === operationsStatusCapability
                        || capability === writingHistoryCapability
                        || insightRead
                        || insightAction
                        || capability === writingContextCapability
                        || memoryManagement
                        || (call.name === LOAD_SKILL_TOOL_NAME && this.skillContextProvider?.ownsCapability(capability)));
                });
                const independentIds = new Set(independent.map(call => call.id));
                const readPlans = sourceRun.resolveReadPlansWithReason(calls.filter(call => !independentIds.has(call.id)));
                if (!readPlans.ok) return { rejectionReason: readPlans.reason === 'source_excluded'
                    ? 'source_excluded' as const : 'source_read_plan_unavailable' as const };
                const complete = new Map(readPlans.plans);
                for (const call of independent) {
                    const reads = [
                        'get_memory_status', 'query_memories', 'get_memory_usage', 'manage_memory',
                        'get_vault_insights', 'query_saved_insights', 'manage_saved_insight',
                    ].includes(call.name) ? [{ kind: 'scoped_vault_search' as const }] : [];
                    complete.set(call.id, { reads });
                }
                return complete;
            },
        });
        const loop = new PaAgentLoop({
            runId,
            userMessageId,
            userInput: options.userText ?? options.prompt,
            ...(options.userText !== undefined ? { userMessageContent: options.userText } : {}),
            userImages: options.images,
            writingRequest: options.writingRequest,
            isFinalTextCurrent: () => answerSourceValidity !== undefined && isPreviewCurrent(),
            allowTaskIncompleteReport: runtimeInstruction => !hasOperationsStagedAcknowledgementInstruction(runtimeInstruction),
            ...(nativeWritingRequest ? { nativeWriting: {
                contextHandle: nativeWritingRequest.requestId,
                ...(writingContextHost ? { getContextHandle: currentWritingHandle } : {}),
                maxTextChars: Number.MAX_SAFE_INTEGER,
                isCurrent: () => { assertRequestCurrent(); return (!writingContextRun || !!currentWritingContext()) && (imageScope?.isUsable() ?? true); },
                isValidContextHandle: isValidWritingContextHandle,
                createCollector: (contextHandle, maxTextChars) => new NativeWritingCallCollector(contextHandle, maxTextChars),
                outputName: "present_writing",
                finalizationInstruction: [
                    "The ordinary turn deadline has been reached.",
                    "This is the single reserved finalization turn. Reply with ordinary text or one present_writing output; no source, context or action calls are allowed.",
                    "Use only existing observations and available context to answer.",
                    "If evidence is unavailable or insufficient, say so directly without inferring it.",
                ].join(" "),
                correctionInstruction: "The writing candidate was not accepted. Correct the native present_writing arguments using the current writing context, then submit one complete candidate. A validation failure is not task completion and does not mean the work was saved.",
                strategyChangeInstruction: "The writing candidate has failed validation three times without progress. Change strategy: rebuild one complete present_writing candidate from the current writing context and required schema. Do not emit partial arguments, multiple candidates, or ordinary text pretending the work was saved.",
            } } : {}),
            model,
            providerModelIdentity: debugModelIdentity,
            prepareModelInput: async (input) => {
                const failClosedOnAbort = () => memoryEvidenceRegistry.failClosed();
                input.signal?.addEventListener("abort", failClosedOnAbort, { once: true });
                if (input.signal?.aborted) failClosedOnAbort();
                try {
                    let transcript = await sourceRun.projectTranscriptAsync(await traceAgentPhase(debug, 'memory_evidence_prepare',
                        () => memoryEvidenceRegistry.prepareTranscript(input.transcript, input.signal), { turnId: input.turnId }), input.signal);
                    if (writingContextRun) transcript = await writingContextRun.projectTranscript(transcript, input.signal);
                    const primaryVaultProjection = await traceAgentPhase(debug, 'vault_evidence_prepare',
                        () => sourceRun.prepareVaultObservationProjection(transcript, [], input.signal), { turnId: input.turnId });
                    transcript = primaryVaultProjection.transcript;
                    const constraint = sourceRun.state.snapshot();
                    if (constraint) {
                        const paths = transcript.flatMap(message => {
                            if (message.role !== "toolResult" || message.isError || !message.content.includeInNextPrompt) return [];
                            return (message.content.sourceRecords ?? []).flatMap(record =>
                                record.path && !record.redacted && !record.statusOnly
                                && (record.kind === "context-used"
                                    || (record.kind === "memory-reference" && record.citationEligible !== false))
                                    ? [record.path] : []);
                        });
                        // Publish the complete projected transcript once. A later
                        // result must not erase an earlier still-valid source.
                        sourceRun.publishAdmittedNotePaths(paths, constraint);
                    }
                    return {
                        ...input,
                        transcript,
                    };
                } finally {
                    input.signal?.removeEventListener("abort", failClosedOnAbort);
                }
            },
            toolExecutor,
            hostPolicy: {
                afterTurn: async (summary) => {
                    const assistant = summary.assistantMessage;
                    if ((summary.status === 'completed' || summary.status === 'tool_results_ready')
                        && assistant.role === 'assistant'
                        && (assistant.providerCompletion === 'stop' || assistant.providerCompletion === 'tool_calls')) {
                        // The provider accepted this context. Future turns return to
                        // model-window pressure instead of inheriting a stale retry target.
                        contextRecoveryRequested = false;
                        recoveryMaxPromptChars = undefined;
                    }
                    operationsIntentStaged ||= hasStagedOperationsIntent(summary);
                    const decision = await hostPolicy.afterTurn(summary);
                    if (
                        operationsIntentStaged
                        && operationsAcknowledgementRequested
                        && decision.action === "continue"
                    ) {
                        const terminalPolicy = hostPolicy;
                        const terminalDecision = terminalPolicy.finalizeAfterTurn
                            ? await terminalPolicy.finalizeAfterTurn(summary, {
                                defaultStatus: "completed",
                                reason: "operations_intent_staged_acknowledgement_empty",
                            })
                            : {
                                action: "stop" as const,
                                status: "completed" as const,
                                reason: "operations_intent_staged_acknowledgement_empty",
                            };
                        return {
                            ...terminalDecision,
                            diagnostics: [
                                ...(terminalDecision.diagnostics ?? []),
                                {
                                    type: "operations_intent_staged_acknowledgement_empty",
                                    message: "The inline confirmation card is the successful output; no generic finalization turn was run.",
                                },
                            ],
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
                    return decision;
                },
                prepareFinalizationTurn: (summary, context) => {
                    operationsIntentStaged ||= hasStagedOperationsIntent(summary);
                    if (!operationsIntentStaged && !operationsAcknowledgementRequested) return {};

                    operationsAcknowledgementRequested = true;
                    return {
                        runtimeInstruction: OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION,
                        controlSnapshot: createOperationsAcknowledgementControlSnapshot(
                            context.defaultControlSnapshot ?? summary.controlSnapshot,
                        ),
                        allowEmptyResponse: true,
                    };
                },
                finalizeAfterTurn: async (summary, context) => {
                    operationsIntentStaged ||= Boolean(
                        context.unobservedTurnSummary
                        && hasStagedOperationsIntent(context.unobservedTurnSummary)
                    );
                    const operationsAcknowledgementCompleted = operationsIntentStaged
                        && operationsAcknowledgementRequested
                        && context.defaultStatus === "completed";
                    const terminalContext = operationsAcknowledgementCompleted
                        ? {
                            ...context,
                            reason: "operations_intent_staged_acknowledgement_completed",
                        }
                        : context;
                    const terminalPolicy = hostPolicy;
                    const decision = terminalPolicy.finalizeAfterTurn
                        ? await terminalPolicy.finalizeAfterTurn(summary, terminalContext)
                        : {
                            action: "stop" as const,
                            status: context.defaultStatus,
                            reason: terminalContext.reason,
                        };
                    if (!operationsIntentStaged || !operationsAcknowledgementRequested) {
                        return decision;
                    }
                    return {
                        ...decision,
                        diagnostics: [
                            ...(decision.diagnostics ?? []),
                            {
                                type: "operations_intent_staged_acknowledgement_completed",
                                message: "The reserved final turn acknowledged the inline confirmation card; no write occurred.",
                            },
                        ],
                    };
                },
            },
            onEvent: (event) => {
                if (event.type === 'message_end') {
                    const message = event.message;
                    if (message.role === 'user') message.inputLineage = cloneInputLineage(currentUserLineage);
                    else if (message.role === 'assistant') {
                        message.inputLineage = cloneInputLineage(answerLineageByTurn.get(event.turnId))
                            ?? unknownInputLineage();
                        for (const part of message.content) if (part.type === 'toolCall' && part.id) {
                            callLineageById.set(part.id, message.inputLineage);
                            callNotesObservationStateById.set(part.id, {
                                sourceEpoch: sourceRun.currentNotesObservationEpoch(),
                                ...(part.name === 'search_memory'
                                    ? { memoryEnabled: sourceRun.currentMemoryAvailability() } : {}),
                            });
                            const attachmentValidity = answerAttachmentValidityByTurn.get(event.turnId);
                            if (attachmentValidity) callAttachmentValidityById.set(part.id, attachmentValidity);
                        }
                    } else {
                        const records = message.content.sourceRecords ?? [];
                        let writingContextLineage: InputLineage | undefined;
                        if (!message.isError && message.content.includeInNextPrompt) {
                            try {
                                const payload = JSON.parse(message.content.promptText) as { observation?: unknown };
                                if (message.toolName === 'read_writing_history'
                                    && this.toolRegistry.get(message.toolName) === writingHistoryCapability) {
                                    const receipts = writingHistoryObservations.get(JSON.stringify(payload.observation));
                                    if (receipts?.every(receipt => receipt.isCurrent() && receipt.isSourceCurrent())) {
                                        writingContextLineage = unionInputLineages(...receipts.map(receipt => receipt.lineage));
                                        writingReadReceipts.set(message.id, receipts);
                                    }
                                } else if (message.toolName === 'get_image_status'
                                    && this.toolRegistry.get(message.toolName) === imageStatusCapability
                                    && isImageStatusObservation(payload.observation)) writingContextLineage = completeInputLineage();
                                else if (message.toolName === 'get_operations_status'
                                    && this.toolRegistry.get(message.toolName) === operationsStatusCapability
                                    && isOperationsStatusObservation(payload.observation)) writingContextLineage = completeInputLineage();
                            } catch { /* Unmatched observations remain unknown. */ }
                        }
                        if (runSourceSelection && message.toolName === GET_WRITING_CONTEXT
                            && !message.isError && message.content.includeInNextPrompt) {
                            try {
                                const prepared = writingContextRun?.current();
                                const payload = JSON.parse(message.content.promptText) as {
                                    observation?: { contextHandle?: unknown };
                                };
                                if (prepared && payload.observation?.contextHandle === prepared.handle
                                    && JSON.stringify(payload.observation) === JSON.stringify(writingContextObservation(prepared))) {
                                    const parentLineage = prepared.parent
                                        ? admittedParentLineages.get(prepared.parent.id) : completeInputLineage();
                                    const styleLineage = prepared.styleContext || prepared.styleRevisionIds.length
                                        ? prepared.styleRevisionIds.length
                                            ? completeInputLineage([{ kind: 'writing-style',
                                                revisionIds: [...prepared.styleRevisionIds] }])
                                            : unknownInputLineage()
                                        : completeInputLineage();
                                    const imageDependencies: InputDependency[] = [];
                                    let imagesIdentified = true;
                                    for (const image of prepared.images) {
                                        const current = (options.images ?? []).some(candidate =>
                                            candidate.ref.assetId === image.ref.assetId
                                            && candidate.ref.contentHash === image.ref.contentHash);
                                        const historyOwner = (options.chatHistory ?? []).find(candidate => candidate.role === 'user'
                                                && candidate.images?.some(attached => attached.ref.assetId === image.ref.assetId
                                                    && attached.ref.contentHash === image.ref.contentHash));
                                        const owner = current ? userMessageId
                                            : historyOwner?.hostProvenance?.messageId
                                                ?? historyOwner?.runSourceSelection?.userMessageId;
                                        if (!owner) { imagesIdentified = false; continue; }
                                        imageDependencies.push({ kind: 'attachment', ownerMessageId: owner,
                                            ref: { ...image.ref } });
                                    }
                                    writingContextLineage = unionInputLineages(parentLineage, styleLineage,
                                        imagesIdentified ? completeInputLineage(imageDependencies)
                                            : unknownInputLineage(imageDependencies));
                                }
                            } catch { /* An unmatched or invalid tool observation remains unknown. */ }
                        }
                        const sourceFreeNotesObservation = records.length === 0
                            && isSafeSourceFreeToolObservation(message);
                        const resultLineage = writingContextLineage
                            ?? (records.length ? sourceRecordsInputLineage(records)
                                : isLiveHostBatchPreflightRejection(message) || message.content.metadata?.statusOnly === true
                                    ? completeInputLineage()
                                        : sourceFreeNotesObservation
                                        ? message.toolName === 'prepare_ghost_post' || message.toolName === 'create_image'
                                            || isSafeOperationsStagedObservation(message)
                                            ? completeInputLineage()
                                            : sourceRun.captureRunNotesObservationLineage(
                                                message.toolName === 'search_memory' ? 'memory' : 'vault',
                                                callNotesObservationStateById.get(message.toolCallId)?.sourceEpoch,
                                                callNotesObservationStateById.get(message.toolCallId)?.memoryEnabled)
                                        : unknownInputLineage());
                        message.inputLineage = unionInputLineages(
                            callLineageById.get(message.toolCallId), resultLineage);
                    }
                }
                observeAgentDebugLifecycle(debugRecorder, event);
                if (this.host.settings.debug) {
                    try { debugLifecycle(event); } catch { /* Keep diagnostic failures outside lifecycle delivery. */ }
                }
                eventAdapter.handle(event);
            },
            onCommittedFinalText: snapshot => {
                eventAdapter.syncCommittedAnswer(snapshot);
                options.onCommittedFinalText?.(snapshot);
            },
            onDebug: debug,
            ...(hostContext ? { hostContext } : {}),
            initialControlSnapshot,
            signal: options.signal,
            ...(options.turnLeaseProvider ? { turnLeaseProvider: options.turnLeaseProvider } : {}),
            maxTurns: this.options.maxModelTurns ?? Number.POSITIVE_INFINITY,
            recoverContextOverflow: () => {
                if (options.signal?.aborted || options.isCurrent?.() === false) return false;
                contextRecoveryRequested = true;
                // Reduce relative to the rejected request, including any summary
                // it already used. This is a compression goal, never admission.
                recoveryMaxPromptChars = lastAnswerPromptChars === undefined ? undefined
                    : Math.max(1, Math.floor(lastAnswerPromptChars * 0.7));
                toolSummaryAttempts.clear();
                debug('context_overflow_recovery', { recovery: 'compact_and_retry', recoveryMaxPromptChars });
                return true;
            },
            maxWallClockMs,
            runStartedAt: runtimeStartedAt,
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
            maxToolCalls: this.options.answerStreamMaxToolCalls ?? Number.POSITIVE_INFINITY,
            remoteAttemptTimeoutMs: 1_800_000,
            toolTimeoutMs: 1_800_000,
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
            try { options.onUsageAccounting?.(usageLedger.snapshot()); }
            catch { /* Accounting observers cannot change the Agent outcome. */ }
            sourceRunActive = false;
            writingContextRun?.dispose();
            commandCapabilities?.dispose();
            imageScope?.dispose();
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

    private areOperationsActionsAvailable(): boolean {
        return this.operationsActionsPolicyEligible
            && this.host.isOperationsAgentEnabled
            && Boolean(this.options.operationsIntentController);
    }

    private async loadCanonicalHostContextForRun(
        options: PaAgentStreamOptions,
        runId: string,
        signal?: AbortSignal,
    ): Promise<Record<string, unknown> | undefined> {
        if (!this.skillContextProvider) return undefined;

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

        const catalog = this.skillContextProvider.getCatalog();
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

    private async buildPaAgentCanonicalModelInput(
        options: PaAgentStreamOptions,
        input: PaAgentModelInput,
        toolUseConstraints?: PaAgentToolUseConstraints,
        toolDefinitions?: ChatToolRegistryDefinition[],
        injectedContext?: PaAgentInjectedContext,
        boundSchemas: ChatToolProviderSchema[] = [],
        summaries?: PaAgentContextSummaries,
        actionMode: "native" | "compat" = "compat",
        modelBudgetFacts?: PaAgentModelBudgetFacts,
    ) {
        const { projection, operationsGuidance } = await this.projectPaAgentCanonicalModelInput(
            options, input, toolUseConstraints, toolDefinitions, injectedContext, boundSchemas, summaries, actionMode,
            modelBudgetFacts,
        );
        if (options.writingContextHost && options.writingContextHandle) {
            assertCompleteWritingContextProjection(input.transcript, projection.actionHistory,
                options.writingContextHandle);
        }
        if (projection.outcome.admission === "local_overflow") {
            if (options.writingContextHost && options.writingContextHandle) {
                throw new Error("Complete writing context does not fit in the provider input");
            }
            throw new PaAgentContextOverflowError(projection.budget.promptChars, projection.budget.maxPromptChars);
        }
        return {
            providerInput: {
                input: projection.input,
                available_skills: projection.availableSkills,
                tool_definitions: projection.toolDefinitions,
                tool_observations: projection.toolObservations,
                operations_guidance: operationsGuidance,
                messages: await buildPaAgentFinalMessagesAsync(projection.input, projection.actionHistory,
                    actionMode, undefined, projection.history, projection.currentInput, input.signal, projection),
                __context_projection_diagnostic: JSON.stringify(projection.diagnostics),
            } as Record<string, unknown>,
            projection,
        };
    }

    private async projectPaAgentCanonicalModelInput(
        options: PaAgentStreamOptions,
        input: PaAgentModelInput,
        toolUseConstraints?: PaAgentToolUseConstraints,
        toolDefinitions?: ChatToolRegistryDefinition[],
        injectedContext?: PaAgentInjectedContext,
        boundSchemas: ChatToolProviderSchema[] = [],
        summaries?: PaAgentContextSummaries,
        actionMode: "native" | "compat" = "compat",
        modelBudgetFacts?: PaAgentModelBudgetFacts,
    ) {
        const availableSkills = formatSkillCatalog(input.hostContext);
        const hostContext = formatCanonicalHostContext(input.hostContext);
        const nativeWritingRequest = options.writingOutputProtocol === "native" ? options.writingRequest : undefined;
        const nativeContextHandle = nativeWritingRequest
            ? (options.writingContextHost ? options.writingContextHandle : nativeWritingRequest.requestId) : undefined;
        const operationsAcknowledgement = isOperationsStagedAcknowledgement(input.currentProtocol)
            || isOperationsStagedAcknowledgement(input.runtimeInstruction);
        const mayReportIncomplete = !operationsAcknowledgement;
        const currentInput = options.userText ?? options.prompt;
        let toolDefinitionsText = input.toolMode === "final_answer_only"
            ? (nativeContextHandle ? "Only present_writing or report_task_incomplete (pure outputs) are available. No source, context or action tools are available in this finalization turn."
                : mayReportIncomplete ? "No source, context or action tools are available in this finalization turn."
                    : "No tools are available in this finalization turn.")
            : formatPlannerToolDefinitions(toolDefinitions ?? filterToolDefinitionsByToolUseConstraints(
                this.toolRegistry.listDefinitions(),
                toolUseConstraints,
            ));
        if (mayReportIncomplete) {
            toolDefinitionsText += `\nIf you cannot complete the user task, call ${REPORT_TASK_INCOMPLETE} as one native function/tool call with the explanation in answer. Do not print <${REPORT_TASK_INCOMPLETE}>, JSON, or any marker in ordinary text: that text will be shown literally and will not mark the task incomplete. Optional pure output schema: ${JSON.stringify(taskIncompleteOutputSchema().function)}`;
        }
        if (nativeWritingRequest && nativeContextHandle && mayReportIncomplete && input.toolMode !== "final_answer_only") {
            toolDefinitionsText += `\nPure output declaration (not a source or action): ${JSON.stringify(nativeWritingOutputSchema(nativeWritingRequest, nativeContextHandle).function)}`;
        }
        const operationsGuidance = createOperationsPromptGuidance(toolDefinitions ?? []);
        const projection = await this.contextManager.forPromptAsync({
            coldWritingVersions: options.coldWritingVersions,
            protectedWritingVersionIds: options.protectedWritingVersionIds,
            recoveryRequested: options.recoveryRequested,
            recoveryMaxPromptChars: options.recoveryMaxPromptChars,
            prompt: currentInput,
            chatHistory: operationsAcknowledgement
                ? undefined
                : options.chatHistory,
            transcript: input.transcript,
            turnIndex: input.turnIndex,
            hostContext,
            runtimeInstruction: combineRuntimeInstructions([input.runtimeInstruction,
                selectedWritingContext(options.writingContext)]),
            currentProtocol: combineRuntimeInstructions([
                input.currentProtocol,
                options.writingRequest && mayReportIncomplete ? (nativeWritingRequest ? (nativeContextHandle ? nativeWritingOutputInstruction(options.writingRequest, nativeContextHandle)
                    : nativeWritingPreparationInstruction(options.writingRequest,
                        boundSchemas.some(schema => schema.function.name === 'get_writing_context')))
                    : writingOutputInstruction(options.writingRequest)) : "",
            ]),
            injectedContext,
            summaries,
            availableSkills,
            toolDefinitions: toolDefinitionsText,
            maxHistoryChars: typeof options.historyBudgetChars === "number" && Number.isFinite(options.historyBudgetChars)
                ? Math.max(0, Math.floor(options.historyBudgetChars))
                : MAX_CHAT_HISTORY_CHARS,
            maxPromptChars: MAX_PA_AGENT_PROMPT_CHARS,
            modelBudgetFacts,
            maxObservationChars: this.options.answerStreamMaxObservationChars ?? 64_000,
            formatToolObservations,
            formatToolObservationsAsync: (transcript, turnIndex) => formatToolObservationsAsync(transcript, turnIndex, input.signal),
            measurePromptEnvelopeAsync: async (parts) => measurePaAgentRequestEnvelopeAsync({
                input: parts.input,
                available_skills: parts.availableSkills,
                tool_definitions: parts.toolDefinitions,
                tool_observations: parts.toolObservations,
                operations_guidance: operationsGuidance,
            }, boundSchemas, await buildPaAgentFinalMessagesAsync(parts.input, parts.actionHistory,
                actionMode, undefined, parts.history, parts.currentInput, input.signal, parts), input.signal),
        }, input.signal);
        return { projection, operationsGuidance };
    }

    private readInjectedContext(
        pageletHandoff?: PageletChatHandoffContext,
    ): PaAgentInjectedContext | undefined {
        const memoryContext = this.host.getMemoryExtractionPromptContext() as PaAgentInjectedContext | undefined;
        if (!pageletHandoff) return memoryContext;
        const result: PaAgentInjectedContext = {
            ...(memoryContext ?? {}),
            pageletHandoff,
        };
        if (memoryContext?.isSourceCurrent) Object.defineProperty(result, 'isSourceCurrent', { value: memoryContext.isSourceCurrent });
        if (memoryContext?.generationInputSources) {
            Object.defineProperty(result, 'generationInputSources', {
                value: cloneGenerationInputBackgroundSources(memoryContext.generationInputSources),
            });
        }
        return result;
    }


}

function generationInputBackgroundSources(
    context: PaAgentInjectedContext | undefined,
): GenerationInputBackgroundSources {
    if (context?.generationInputSources) {
        return cloneGenerationInputBackgroundSources(context.generationInputSources);
    }
    if (context?.memoryContextMode === 'governed' || context?.governedMemoryContext) {
        if (!context.governedMemoryContext?.trim()) {
            return { personal: { state: 'none' }, insights: { state: 'none' } };
        }
        // Older/custom hosts expose one opaque governed block. Its Personal and
        // Insights portions cannot be separated without host-owned identities.
        return {
            personal: { state: 'unknown', mode: 'governed' },
            insights: { state: 'unknown', mode: 'governed' },
        };
    }
    return {
        personal: context?.userProfile
            ? { state: 'unknown', mode: 'legacy' }
            : { state: 'none' },
        insights: context?.vaultInsights
            ? { state: 'unknown', mode: 'legacy' }
            : { state: 'none' },
    };
}

function backgroundInputLineage(
    context: PaAgentInjectedContext | undefined,
    sources: GenerationInputBackgroundSources,
): InputLineage {
    const rendered = formatInjectedContext({ ...context,
        pageletHandoff: undefined, writingStyleContext: undefined });
    if (!rendered) return completeInputLineage();
    const dependencies: InputDependency[] = [];
    if (sources.personal.state === 'identified') {
        dependencies.push({ kind: 'personal', source: sources.personal });
    }
    if (sources.insights.state === 'unknown') dependencies.push({ kind: 'insight', source: sources.insights });
    // The current run can use a live guarded opaque projection, but cannot
    // claim a complete persistable ancestry for it or a legacy profile.
    return sources.personal.state === 'unknown' || sources.insights.state === 'unknown'
        || dependencies.length === 0 ? unknownInputLineage(dependencies)
        : completeInputLineage(dependencies);
}

function generationInputPageletSource(
    pagelet: PageletChatHandoffContext | undefined,
): GenerationInputPageletSource {
    if (!pagelet) return { state: 'none' };
    // The handoff lacks a hash for its rendered body. Preserve its exact backing
    // revisions while marking reload verification unknown instead of inferring it.
    return {
        state: 'unknown',
        id: pagelet.id,
        pipelineVersion: pagelet.pipelineVersion,
        anchor: {
            path: pagelet.anchor.path, mtime: pagelet.anchor.mtime, size: pagelet.anchor.size,
            contentHash: { algorithm: 'unspecified', value: pagelet.anchor.contentHash },
        },
        sources: pagelet.sources.map(source => ({
            path: source.path, mtime: source.mtime, size: source.size,
            contentHash: { algorithm: 'unspecified', value: source.contentHash },
        })),
    };
}

/** A valid receipt cannot authorize output if prompt compaction removed any of its actual context. */
function assertCompleteWritingContextProjection(
    transcript: readonly PaAgentMessage[], actionHistory: readonly PaAgentActionGroup[], handle: string,
): void {
    const source = transcript.find((message): message is Extract<PaAgentMessage, { role: "toolResult" }> => {
        if (message.role !== "toolResult" || message.toolName !== GET_WRITING_CONTEXT
            || message.isError || !message.content.includeInNextPrompt) return false;
        try {
            const payload = JSON.parse(message.content.promptText) as { observation?: { contextHandle?: unknown } };
            return payload?.observation?.contextHandle === handle;
        } catch { return false; }
    });
    if (!source) throw new Error("Complete writing context is missing from the provider input");
    if (actionHistory.some(group => group.calls.some(call => call.name === GET_WRITING_CONTEXT
        && call.id === source.toolCallId && call.results.some(result => result.id === source.id
            && result.text === source.content.promptText)))) return;
    throw new Error("Complete writing context does not fit in the provider input");
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

}

// Exported so __tests__/pa-agent-runtime-tool-definitions.test.ts can assert that the
// trimmed payload still surfaces planner_guidance (the only project-specific field that
// `bindTools(schemas)` does NOT pass through to the model) without spinning up the full
// runtime. See SDD §3.3 / item 2.1 for the token-saving rationale.
export function formatPlannerToolDefinitions(definitions: ChatToolRegistryDefinition[]): string {
    if (definitions.length === 0) return "None";

    const guidanceTools = new Map<string, Set<string>>();
    for (const definition of definitions) {
        for (const guidance of definition.plannerGuidance) {
            const tools = guidanceTools.get(guidance) ?? new Set<string>();
            tools.add(definition.name);
            guidanceTools.set(guidance, tools);
        }
    }

    // Share only exact text with the same bound-tool scope. A source tool's
    // instructions must not become global rules for unrelated capabilities.
    const sharedGroups = new Map<string, { tools: string[]; planner_guidance: string[] }>();
    for (const [guidance, tools] of guidanceTools) {
        if (tools.size < 2) continue;
        const names = [...tools];
        const key = JSON.stringify(names);
        const group = sharedGroups.get(key) ?? { tools: names, planner_guidance: [] };
        group.planner_guidance.push(guidance);
        sharedGroups.set(key, group);
    }

    const sharedRows = [...sharedGroups.values()].map((group) => JSON.stringify({
        shared_planner_guidance: group,
    }));
    const toolRows = definitions.map((definition) => JSON.stringify({
        name: definition.name,
        planner_guidance: definition.plannerGuidance.filter((guidance) =>
            guidanceTools.get(guidance)!.size < 2),
    }, null, 0));
    return [...sharedRows, ...toolRows].join("\n");
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

function combineRuntimeInstructions(instructions: Array<string | undefined>): string | undefined {
    const parts = instructions
        .map((instruction) => instruction?.trim())
        .filter((instruction): instruction is string => !!instruction);
    return parts.length > 0 ? parts.join(" ") : undefined;
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
    captureToolIdentity = false,
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
        if (!name && !captureToolIdentity) return [];
        const delta: Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }> = {
            type: "toolcall_delta",
            name: name ?? "",
            ...getStreamingToolCallIdentity(record, key),
            ...(captureToolIdentity && typeof record?.index === "number" ? { index: record.index } : {}),
            ...(captureToolIdentity ? { providerIdentity: {
                id: record?.id, index: record?.index, name: record?.name ?? functionRecord?.name,
            } } : {}),
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
    isDebugContentCurrent?: () => boolean;
    streamedToolNames?: Map<string, string>;
    /** Preserve original identity for the opt-in native output admission path. */
    captureToolIdentity?: boolean;
    onFallback?: (reason: StreamWithInvokeFallbackReason, error: unknown) => void;
    prepareInvokeInput?: () => unknown | PromiseLike<unknown>;
    /** Emitted for each attempted request, never for preliminary projections. */
    requestDiagnostics?: (input: unknown) => Array<Record<string, unknown>>;
    debugCall?: AgentDebugCallScope;
}): AsyncGenerator<PaAgentModelStreamChunk, void, unknown> {
    const { chain, input, signal, onFallback } = args;
    const streamedToolNames = args.streamedToolNames ?? new Map<string, string>();
    let receivedAnyVisibleOutput = false;
    let providerCompletion: import("./chat-types").ProviderCompletion | undefined;

    let stream: AsyncIterable<unknown>;
    beginAgentDebugResponsePhase(args.debugCall);
    try {
        stream = await chain.stream(input, { signal });
    } catch (error) {
        finishAgentDebugResponsePhase(args.debugCall, signal?.aborted ? 'cancelled' : 'failed');
        yield* requestDiagnosticChunks(args.requestDiagnostics, input);
        if (canFallbackToNonStreaming(error, receivedAnyVisibleOutput, signal, Boolean(args.prepareInvokeInput))) {
            onFallback?.("stream_setup_failed", error);
            const invokeInput = args.prepareInvokeInput
                ? await args.prepareInvokeInput()
                : input;
            throwIfAborted(signal);
            yield* invokeAsModelChunks(chain, invokeInput, signal, streamedToolNames, args.requestDiagnostics,
                args.captureToolIdentity, args.debugCall, args.isDebugContentCurrent);
            return;
        }
        throw error;
    }

    yield* requestDiagnosticChunks(args.requestDiagnostics, input);

    try {
        let firstContent = true;
        let firstText = true;
        for await (const chunk of stream) {
            observeAgentDebugResponse(args.debugCall, chunk, "delta", "stream", "usage_only");
            throwIfAborted(signal);
            if (args.isDebugContentCurrent?.() !== false) {
                observeAgentDebugResponse(args.debugCall, chunk, "delta", "stream", "content_only");
            }
            const chunkCompletion = readProviderCompletion(chunk);
            const providerUsage = extractProviderUsage(chunk);
            if (providerUsage) {
                yield { type: "diagnostic", diagnostic: { type: "provider_usage", usage: providerUsage } };
            }
            const reasoning = getReasoningContent(chunk);
            const content = stringifyChunkContent(chunk);
            if (firstContent && (reasoning || content)) {
                firstContent = false;
                observeAgentDebugCall(args.debugCall, { phase: "first_model_content",
                    timing: { event: "first_model_content", at: agentDebugNow() } });
            }
            if (firstText && content) {
                firstText = false;
                observeAgentDebugCall(args.debugCall, { phase: "first_provider_text",
                    timing: { event: "first_provider_text", at: agentDebugNow() } });
            }
            if (reasoning) {
                receivedAnyVisibleOutput = true;
                yield { type: "thinking_delta", text: reasoning };
            }
            if (content) {
                receivedAnyVisibleOutput = true;
                yield { type: "text_delta", text: content };
            }
            for (const toolDelta of getCanonicalToolCallDeltas(chunk, streamedToolNames, args.captureToolIdentity)) {
                receivedAnyVisibleOutput = true;
                yield toolDelta;
            }
            // Finish belongs to this content chunk, not to the optional usage/EOF tail.
            // Publish it after the chunk's content so downstream retains both facts
            // even if advancing the transport subsequently fails.
            if (chunkCompletion && chunkCompletion !== providerCompletion) {
                providerCompletion = chunkCompletion;
                observeAgentDebugCall(args.debugCall, { phase: "provider_completion", outcome: providerCompletion,
                    timing: { event: "provider_completion", at: agentDebugNow() } });
                yield { type: "provider_completion", completion: providerCompletion };
            }
        }
    } catch (error) {
        finishAgentDebugResponsePhase(args.debugCall, signal?.aborted ? 'cancelled' : 'failed');
        if (providerCompletion === undefined && canFallbackToNonStreaming(error, receivedAnyVisibleOutput, signal, Boolean(args.prepareInvokeInput))) {
            onFallback?.("stream_iteration_failed", error);
            const invokeInput = args.prepareInvokeInput
                ? await args.prepareInvokeInput()
                : input;
            throwIfAborted(signal);
            yield* invokeAsModelChunks(chain, invokeInput, signal, streamedToolNames, args.requestDiagnostics,
                args.captureToolIdentity, args.debugCall, args.isDebugContentCurrent);
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
    requestDiagnostics?: (input: unknown) => Array<Record<string, unknown>>,
    captureToolIdentity = false,
    debugCall?: AgentDebugCallScope,
    isDebugContentCurrent?: () => boolean,
): AsyncGenerator<PaAgentModelStreamChunk, void, unknown> {
    let response: unknown;
    beginAgentDebugResponsePhase(debugCall);
    try {
        response = await chain.invoke(input, signal ? { signal } : undefined);
    } catch (error) {
        finishAgentDebugResponsePhase(debugCall, signal?.aborted ? 'cancelled' : 'failed');
        yield* requestDiagnosticChunks(requestDiagnostics, input);
        throw error;
    }
    observeAgentDebugResponse(debugCall, response, "replace", "invoke", "usage_only");
    yield* requestDiagnosticChunks(requestDiagnostics, input);
    if (signal?.aborted) finishAgentDebugResponsePhase(debugCall, 'cancelled');
    throwIfAborted(signal);
    if (isDebugContentCurrent?.() !== false) {
        observeAgentDebugResponse(debugCall, response, "replace", "invoke", "content_only");
    }
    const providerUsage = extractProviderUsage(response);
    if (providerUsage) {
        yield { type: "diagnostic", diagnostic: { type: "provider_usage", usage: providerUsage } };
    }
    const reasoning = getReasoningContent(response);
    if (reasoning) {
        yield { type: "thinking_delta", text: reasoning };
    }
    const content = stringifyChunkContent(response);
    if (reasoning || content) observeAgentDebugCall(debugCall, { phase: "first_model_content",
        timing: { event: "first_model_content", at: agentDebugNow() } });
    if (content) observeAgentDebugCall(debugCall, { phase: "first_provider_text",
        timing: { event: "first_provider_text", at: agentDebugNow() } });
    if (content) {
        yield { type: "text_delta", text: content };
    }
    for (const toolDelta of getCanonicalToolCallDeltas(response, streamedToolNames, captureToolIdentity)) {
        yield toolDelta;
    }
    const completion = readProviderCompletion(response);
    if (completion) {
        observeAgentDebugCall(debugCall, { phase: "provider_completion", outcome: completion,
            timing: { event: "provider_completion", at: agentDebugNow() } });
        yield { type: "provider_completion", completion };
    }
}

function* requestDiagnosticChunks(
    read: ((input: unknown) => Array<Record<string, unknown>>) | undefined,
    input: unknown,
): Generator<PaAgentModelStreamChunk> {
    for (const diagnostic of read?.(input) ?? []) yield { type: "diagnostic", diagnostic };
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
    } else if (promptTokens !== undefined && completionTokens !== undefined) {
        usage.totalTokens = promptTokens + completionTokens;
    }
    return Object.keys(usage).length > 0 ? usage : undefined;
}

/** Starts at the transport's physical admission hook, not during source preparation. */
export function createPaAgentSummaryAttemptClock(ownerSignal: AbortSignal,
    timeoutMs = 1_800_000): {
        signal: AbortSignal; start: () => void; failed: () => void; dispose: () => void;
    } {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    ownerSignal.addEventListener('abort', cancel, { once: true });
    if (ownerSignal.aborted) controller.abort();
    let timer: PlatformTimeoutHandle | undefined;
    const clear = () => {
        if (timer !== undefined) clearPlatformTimeout(timer);
        timer = undefined;
    };
    return { signal: controller.signal,
        start: () => { clear(); if (!controller.signal.aborted) {
            timer = setPlatformTimeout(cancel, timeoutMs);
        } },
        failed: clear,
        dispose: () => { clear(); ownerSignal.removeEventListener('abort', cancel); },
    };
}

const SUMMARY_REQUEST_WARNING = 30;
const SUMMARY_ACTIVE_TIME_WARNING_MS = 60 * 60_000;
const SUMMARY_TOKEN_WARNING = 90_000;
type AuxiliaryBudgetReason = 'physical_requests' | 'active_elapsed'
    | 'estimated_or_known_tokens' | 'estimate_unknown';

/** Run-local summary accounting. Soft pressure is diagnostic, never a task stop. */
export function createPaAgentAuxiliarySummaryBudget(
    attempts: () => PaAgentUsageLedgerSnapshot['attempts'],
    now: () => number = agentDebugNow,
): {
    begin: (callId: string, maxOutputTokens: number) => { admit: (estimatedPromptTokens: number) => void; finish: () => void };
    snapshot: () => { physicalRequests: number; activeElapsedMs: number;
        estimatedReservedTokens: number | null; admissionTokens: number | null;
        pressureReason?: AuxiliaryBudgetReason };
} {
    const outputReserveByCall = new Map<string, number>();
    const active = new Map<symbol, number>();
    let completedElapsedMs = 0;
    let pressureReason: AuxiliaryBudgetReason | undefined;
    const elapsedMs = () => completedElapsedMs + [...active.values()]
        .reduce((total, startedAt) => total + Math.max(0, now() - startedAt), 0);
    const usage = () => {
        const physical = attempts().filter(attempt => attempt.purpose === 'context_summary');
        let estimatedReservedTokens = 0;
        let admissionTokens = 0;
        let estimateKnown = true;
        let admissionKnown = true;
        for (const attempt of physical) {
            const outputReserve = outputReserveByCall.get(attempt.callId);
            if (outputReserve === undefined) {
                estimateKnown = false;
                admissionKnown = false;
                continue;
            }
            if (attempt.estimatedPromptTokens === undefined) estimateKnown = false;
            else estimatedReservedTokens += attempt.estimatedPromptTokens + outputReserve;
            const promptFloor = Math.max(attempt.estimatedPromptTokens ?? -1,
                attempt.measuredPromptTokens ?? -1);
            // A partial/cancelled response is not a complete bill, but any
            // provider total already attributed to this attempt is a cost floor.
            const knownTotal = attempt.totalTokens;
            if (promptFloor < 0 && knownTotal === undefined) admissionKnown = false;
            else admissionTokens += Math.max(promptFloor < 0 ? 0 : promptFloor + outputReserve,
                knownTotal ?? 0);
        }
        return { physicalRequests: physical.length,
            estimatedReservedTokens: estimateKnown ? estimatedReservedTokens : null,
            admissionTokens: admissionKnown ? admissionTokens : null };
    };
    return {
        begin: (callId, maxOutputTokens) => {
            if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) pressureReason = 'estimate_unknown';
            outputReserveByCall.set(callId, maxOutputTokens);
            const identity = Symbol(callId);
            active.set(identity, now());
            return {
                admit: estimatedPromptTokens => {
                    const current = usage();
                    const spent = current.admissionTokens;
                    if (!Number.isSafeInteger(estimatedPromptTokens) || estimatedPromptTokens < 0 || spent === null) {
                        pressureReason = 'estimate_unknown';
                    } else if (current.physicalRequests >= SUMMARY_REQUEST_WARNING) {
                        pressureReason = 'physical_requests';
                    } else if (elapsedMs() >= SUMMARY_ACTIVE_TIME_WARNING_MS) {
                        pressureReason = 'active_elapsed';
                    } else if (spent + estimatedPromptTokens + maxOutputTokens > SUMMARY_TOKEN_WARNING) {
                        pressureReason = 'estimated_or_known_tokens';
                    }
                },
                finish: () => {
                    const startedAt = active.get(identity);
                    if (startedAt === undefined) return;
                    completedElapsedMs += Math.max(0, now() - startedAt);
                    active.delete(identity);
                    if (!attempts().some(attempt => attempt.purpose === 'context_summary' && attempt.callId === callId)) {
                        outputReserveByCall.delete(callId);
                    }
                },
            };
        },
        snapshot: () => ({ ...usage(), activeElapsedMs: elapsedMs(),
            ...(pressureReason ? { pressureReason } : {}) }),
    };
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
        return content.map(stringifyModelContentPart).join("");
    }
    return "";
}

function stringifyModelContentPart(part: unknown): string {
    if (typeof part === "string") {
        return part;
    }
    const record = asRecord(part);
    if (!record || (record.type !== undefined && record.type !== "text" && record.type !== "output_text")) {
        return "";
    }
    if (typeof record.text === "string") {
        return record.text;
    }
    return typeof record.content === "string" ? record.content : "";
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

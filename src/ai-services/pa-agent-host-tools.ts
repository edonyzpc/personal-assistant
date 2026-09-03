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
    MemorySearchDocument,
    MemorySearchObservation,
    MemorySearchResult,
    MemoryTemporalFilter,
    MemoryTemporalProjectionAudit,
    PaAgentMessage,
    PaToolResultContent,
    SourceRecord,
} from "./chat-types";
import type {
    PaAgentToolCall,
    PaAgentToolExecutionInput,
    PaAgentToolExecutionResult,
    PaAgentToolExecutor,
} from "./pa-agent-loop";
import {
    PA_AGENT_PRE_EMIT_TOOL_RESULTS,
    type PaAgentPreEmitToolResultsFinalizer,
} from "./pa-agent-tool-dispatcher";
import { truncate } from "./chat-tool-execution-helpers";
import { dedupeSources } from "./pa-agent-history";
import { LOAD_SKILL_TOOL_NAME } from "./skill-context-provider";
import { createSourceDedupKey } from "./source-store";
import { cloneTranscript } from "./context/clone-utils";
import { createAbortError } from "./chat-utils";
import {
    createRelaxedMemorySearchInvocation,
    createStandardMemorySearchInvocation,
    runWithMemorySearchInvocation,
    type MemorySearchTemporalFilterCapture,
} from "./memory-search-tool";
import type { ChatMemoryRecoveryCoordinator } from "./retrieval-recovery-coordinator";
import type { ProviderRequestScope } from "./obsidian-fetch";
import { stableStringify } from "./agent-utils";

const MAX_PREVIEW_CHARS = 1200;

export interface PaAgentCapabilityToolExecutorOptions {
    registry: CapabilityRegistry;
    host: AiServiceHost;
    platform?: AgentRuntimePlatform;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
    allowedToolNames?: ReadonlySet<string>;
    blockedToolNames?: ReadonlySet<string>;
    memoryEvidenceRegistry?: MemoryEvidenceRegistry;
    memoryRecoveryCoordinator?: ChatMemoryRecoveryCoordinator;
    /** Shared by every Provider request in one logical Agent run. */
    providerRequestScope?: ProviderRequestScope;
    /** Run-owned lifetime for detached DEC-028 Memory preparation. */
    memoryPreparationOwnerSignal?: AbortSignal;
    revalidateMemorySearch?: (
        result: MemorySearchResult,
        signal?: AbortSignal,
        temporalFilter?: MemoryTemporalFilter | null,
        temporalAudit?: MemoryTemporalProjectionAudit,
    ) => Promise<MemorySearchResult>;
}

interface RegisteredMemoryEvidence {
    toolCall: PaAgentToolCall;
    turnId: string;
    result: Omit<ChatToolResult<MemorySearchResult>, "content"> & { content: MemorySearchResult };
    temporalFilter: MemoryTemporalFilter | null;
}

interface MemoryEvidenceCollision {
    query: string;
}

type MemoryEvidenceCaptureOutcome =
    | { status: "captured" | "ignored" }
    | { status: "collision"; query: string };

export class MemoryEvidenceRegistry {
    private readonly entries = new Map<string, RegisteredMemoryEvidence>();
    private readonly seenToolCallIds = new Set<string>();
    private readonly collisions = new Map<string, MemoryEvidenceCollision>();
    private readonly liveMessages = new Map<string, Set<Extract<PaAgentMessage, { role: "toolResult" }>>>();
    private failClosedForRun = false;
    private projectionGeneration = 0;

    constructor(private readonly revalidate: (
        result: MemorySearchResult,
        signal?: AbortSignal,
        temporalFilter?: MemoryTemporalFilter | null,
    ) => Promise<MemorySearchResult>) { }

    capture(
        toolCall: PaAgentToolCall,
        result: ChatToolResult<unknown>,
        turnId: string,
        temporalFilter: MemoryTemporalFilter | null = null,
    ): MemoryEvidenceCaptureOutcome {
        if (toolCall.name !== "search_memory") return { status: "ignored" };
        if (this.seenToolCallIds.has(toolCall.id)) {
            const query = this.collisions.get(toolCall.id)?.query
                ?? this.entries.get(toolCall.id)?.result.content.query
                ?? (isSearchMemoryResult(result.content) ? result.content.query : result.inputSummary);
            this.tombstoneCollision(toolCall.id, query);
            return { status: "collision", query };
        }
        this.seenToolCallIds.add(toolCall.id);
        if (
            result.tool !== "search_memory"
            || !result.ok
            || !isSearchMemoryResult(result.content)
        ) return { status: "ignored" };
        this.entries.set(toolCall.id, {
            toolCall: { ...toolCall },
            turnId,
            result: result as Omit<ChatToolResult<MemorySearchResult>, "content"> & { content: MemorySearchResult },
            temporalFilter: cloneMemoryTemporalFilter(temporalFilter),
        });
        return { status: "captured" };
    }

    async prepareTranscript(
        transcript: readonly PaAgentMessage[],
        signal?: AbortSignal,
    ): Promise<PaAgentMessage[]> {
        this.detectTranscriptCollisions(transcript);
        const generation = this.advanceProjectionGeneration();
        const projected = cloneTranscript(transcript);
        let superseded = false;
        for (let index = 0; index < projected.length; index++) {
            const message = projected[index];
            if (message.role !== "toolResult" || message.toolName !== "search_memory") continue;
            this.trackLiveMessage(message, transcript[index]);
            const collision = this.collisions.get(message.toolCallId);
            if (collision) {
                this.projectCollidedMemoryMessage(message, collision.query);
                this.syncLiveMessages(message.toolCallId, message);
                continue;
            }
            const registered = this.entries.get(message.toolCallId);
            if (!registered) continue;
            if (signal?.aborted) throw createAbortError();

            let current: MemorySearchResult;
            if (this.failClosedForRun) {
                current = createUnavailableMemoryObservationResult(registered.result.content.query);
            } else {
                try {
                    current = await this.revalidate(
                        registered.result.content,
                        signal,
                        cloneMemoryTemporalFilter(registered.temporalFilter),
                    );
                } catch {
                    if (signal?.aborted) throw createAbortError();
                    current = createUnavailableMemoryObservationResult(registered.result.content.query);
                }
            }
            // A non-cooperative revalidator may resolve after its request was
            // aborted, fail-closed, or superseded by a newer provider request.
            // Never let that late success restore captured evidence.
            if (signal?.aborted) throw createAbortError();
            const isCurrentGeneration = generation === this.projectionGeneration;
            if (this.failClosedForRun || !isCurrentGeneration) {
                current = createUnavailableMemoryObservationResult(registered.result.content.query);
                superseded ||= !isCurrentGeneration;
            }
            this.projectMemoryMessage(message, registered, current, isCurrentGeneration);
        }
        if (superseded) {
            for (const message of projected) {
                if (message.role !== "toolResult" || message.toolName !== "search_memory") continue;
                const collision = this.collisions.get(message.toolCallId);
                if (collision) {
                    this.projectCollidedMemoryMessage(message, collision.query);
                    this.syncLiveMessages(message.toolCallId, message);
                    continue;
                }
                const registered = this.entries.get(message.toolCallId);
                if (!registered) continue;
                this.projectMemoryMessage(
                    message,
                    registered,
                    createUnavailableMemoryObservationResult(registered.result.content.query),
                    false,
                );
            }
        }
        return projected;
    }

    /** Permanently revokes captured evidence for the rest of this Agent run. */
    failClosed(): void {
        this.failClosedForRun = true;
        this.advanceProjectionGeneration();
    }

    clear(): void {
        this.advanceProjectionGeneration();
        this.entries.clear();
        this.seenToolCallIds.clear();
        this.collisions.clear();
        this.liveMessages.clear();
        this.failClosedForRun = false;
    }

    finalizePendingRawIdCollision(
        toolCallId: string,
        query: string,
        pendingResults: readonly PaAgentToolExecutionResult[],
    ): void {
        const collisionQuery = this.collisions.get(toolCallId)?.query
            ?? this.entries.get(toolCallId)?.result.content.query
            ?? query;
        if (!this.collisions.has(toolCallId)) {
            this.tombstoneCollision(toolCallId, collisionQuery);
        }
        const unavailable = chatToolResultToPaAgentToolExecutionResult(
            {
                type: "toolCall",
                id: toolCallId,
                index: 0,
                name: "search_memory",
                input: { query: collisionQuery },
            },
            createUnavailableMemoryToolResult(collisionQuery),
        );
        for (const pending of pendingResults) {
            overwritePendingMemoryExecution(pending, unavailable);
        }
    }

    private advanceProjectionGeneration(): number {
        this.projectionGeneration = this.projectionGeneration >= Number.MAX_SAFE_INTEGER
            ? 1
            : this.projectionGeneration + 1;
        return this.projectionGeneration;
    }

    private projectMemoryMessage(
        message: Extract<PaAgentMessage, { role: "toolResult" }>,
        registered: RegisteredMemoryEvidence,
        current: MemorySearchResult,
        commit: boolean,
    ): void {
        const rebuiltSourceRecords = rebuildRevalidatedMemorySourceRecords(registered, current);
        const safeCurrent = rebuiltSourceRecords === null
            ? createUnavailableMemoryObservationResult(registered.result.content.query)
            : current;
        const currentResult: Omit<ChatToolResult<MemorySearchResult>, "content"> & { content: MemorySearchResult } = {
            ...registered.result,
            content: safeCurrent,
            sources: safeCurrent.sources,
            sourceRecords: rebuiltSourceRecords ?? [],
        };
        if (commit) registered.result = currentResult;
        const execution = chatToolResultToPaAgentToolExecutionResult(
            registered.toolCall,
            currentResult,
        );
        this.applyMemoryExecution(message, execution, registered.turnId);
        if (commit) this.syncLiveMessages(message.toolCallId, message);
    }

    private projectCollidedMemoryMessage(
        message: Extract<PaAgentMessage, { role: "toolResult" }>,
        query: string,
    ): void {
        const execution = chatToolResultToPaAgentToolExecutionResult(
            {
                type: "toolCall",
                id: message.toolCallId,
                index: 0,
                name: "search_memory",
                input: { query },
            },
            createUnavailableMemoryToolResult(query),
        );
        this.applyMemoryExecution(message, execution);
    }

    private applyMemoryExecution(
        message: Extract<PaAgentMessage, { role: "toolResult" }>,
        execution: PaAgentToolExecutionResult,
        turnId?: string,
    ): void {
        const sourceRecords = (execution.sourceRecords ?? []).map((record) => ({
            ...record,
            ...(record.turnId === undefined && turnId !== undefined ? { turnId } : {}),
        }));
        const nextContent: PaToolResultContent = {
            ...message.content,
            promptText: execution.promptText,
            ...(execution.previewText !== undefined ? { previewText: execution.previewText } : {}),
            sourceRecords,
            contextUsed: execution.contextUsed ?? [],
            metadata: {
                ...(message.content.metadata ?? {}),
                ...(execution.metadata ?? {}),
            },
        };
        message.content = nextContent;
    }

    private trackLiveMessage(
        projected: Extract<PaAgentMessage, { role: "toolResult" }>,
        live: PaAgentMessage | undefined,
    ): void {
        if (live?.role !== "toolResult" || live.toolCallId !== projected.toolCallId) return;
        const refs = this.liveMessages.get(projected.toolCallId) ?? new Set();
        refs.add(live);
        this.liveMessages.set(projected.toolCallId, refs);
    }

    private syncLiveMessages(
        toolCallId: string,
        message: Extract<PaAgentMessage, { role: "toolResult" }>,
    ): void {
        for (const live of this.liveMessages.get(toolCallId) ?? []) {
            const cloned = cloneTranscript([message])[0];
            if (cloned?.role === "toolResult") live.content = cloned.content;
        }
    }

    private revokeCollidedLiveMessages(toolCallId: string, query: string): void {
        for (const live of this.liveMessages.get(toolCallId) ?? []) {
            this.projectCollidedMemoryMessage(live, query);
        }
    }

    private detectTranscriptCollisions(transcript: readonly PaAgentMessage[]): void {
        const counts = new Map<string, number>();
        for (const message of transcript) {
            if (message.role !== "toolResult" || message.toolName !== "search_memory") continue;
            counts.set(message.toolCallId, (counts.get(message.toolCallId) ?? 0) + 1);
        }
        for (const [toolCallId, count] of counts) {
            if (count < 2 || this.collisions.has(toolCallId)) continue;
            this.tombstoneCollision(
                toolCallId,
                this.entries.get(toolCallId)?.result.content.query ?? "",
            );
        }
    }

    private tombstoneCollision(toolCallId: string, query: string): void {
        this.seenToolCallIds.add(toolCallId);
        this.entries.delete(toolCallId);
        this.collisions.set(toolCallId, { query });
        this.advanceProjectionGeneration();
        this.revokeCollidedLiveMessages(toolCallId, query);
    }
}

function cloneMemoryTemporalFilter(
    temporalFilter: MemoryTemporalFilter | null | undefined,
): MemoryTemporalFilter | null {
    return temporalFilter ? { ...temporalFilter } : null;
}

function rebuildRevalidatedMemorySourceRecords(
    registered: RegisteredMemoryEvidence,
    current: MemorySearchResult,
): SourceRecord[] | null {
    const projectedDocuments = projectMemoryDocuments(current.documents);
    if (projectedDocuments.length !== current.documents.length) return null;

    const projectedSources: ChatAgentSource[] = [];
    for (const source of current.sources) {
        const projected = projectMemorySource(source, Number.NaN);
        if (!projected) return null;
        projectedSources.push(projected);
    }
    const documentSources = sourcesFromProjectedDocuments(projectedDocuments);
    if (
        projectedSources.length !== documentSources.length
        || projectedSources.some((source, index) => !sameMemorySource(source, documentSources[index]))
    ) return null;

    const inherited = readSafeMemorySourceMetadata(registered.result.sourceRecords ?? []);
    return projectedSources.map((source) => ({
        kind: "memory-reference",
        dedupKey: createSourceDedupKey(source.path),
        turnId: registered.turnId,
        ...(inherited.providerId ? { providerId: inherited.providerId } : {}),
        ...(inherited.capabilityName ? { capabilityName: inherited.capabilityName } : {}),
        sourceBoundary: "memory",
        path: source.path,
        ...(source.score !== undefined ? { score: source.score } : {}),
        ...(source.chunkIndex !== undefined ? { chunkIndex: source.chunkIndex } : {}),
        citationEligible: true,
    }));
}

function sameMemorySource(left: ChatAgentSource, right: ChatAgentSource | undefined): boolean {
    return right !== undefined
        && memorySourceKey(left) === memorySourceKey(right)
        && left.score === right.score;
}

function readSafeMemorySourceMetadata(
    records: readonly SourceRecord[],
): Partial<Pick<SourceRecord, "providerId" | "capabilityName">> {
    const memoryRecords = records.filter((record) => record.kind === "memory-reference");
    return {
        ...readUniformStringField(memoryRecords, "providerId"),
        ...readUniformStringField(memoryRecords, "capabilityName"),
    };
}

function readUniformStringField<K extends "providerId" | "capabilityName">(
    records: readonly SourceRecord[],
    field: K,
): Partial<Pick<SourceRecord, K>> {
    const values = new Set(records.flatMap((record) => {
        const value = record[field];
        return typeof value === "string" && value.length > 0 ? [value] : [];
    }));
    if (values.size !== 1) return {};
    return { [field]: [...values][0] } as Partial<Pick<SourceRecord, K>>;
}

function createUnavailableMemoryObservationResult(query: string): MemorySearchResult {
    return {
        usedMemory: false,
        query,
        documents: [],
        sources: [],
        candidates: [],
        skipReason: "Memory evidence is currently unavailable.",
        hasAnswerableContent: false,
        needsSnippetFollowup: false,
        memoryEvidenceState: "unavailable",
        rerankVerdict: "relevant",
        needsMoreEvidence: false,
        retrievalGuidance: "Memory evidence is currently unavailable; do not infer note content.",
        operationalReason: "final_source_changed",
    };
}

function createUnavailableMemoryToolResult(
    query: string,
): Omit<ChatToolResult<MemorySearchResult>, "content"> & { content: MemorySearchResult } {
    const content = createUnavailableMemoryObservationResult(query);
    return {
        ok: true,
        tool: "search_memory",
        inputSummary: query,
        content,
        sources: [],
        sourceRecords: [],
    };
}

export function createPaAgentCapabilityToolExecutor(
    options: PaAgentCapabilityToolExecutorOptions,
): PaAgentToolExecutor {
    return {
        getCanonicalToolCallKey: (toolCall, context) => {
            const prepared = options.registry.prepareAndValidate(
                toolCall.name,
                toolCall.input,
                { userInput: context.userInput },
            );
            return prepared.ok
                ? `${toolCall.name}:${stableStringify(prepared.input)}`
                : undefined;
        },
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
            const executeCapability = (signal: AbortSignal, hidden = false) => options.registry.execute(
                toolCall.name,
                preparedResult.input,
                {
                    host: options.host,
                    turnId: input.turnId,
                    signal,
                    outerToolDeadlineAt: input.outerToolDeadlineAt,
                    providerRequestScope: options.providerRequestScope,
                    platform: options.platform ?? "desktop",
                    ...(!hidden && options.onBeforeVssSearch
                        ? { onBeforeVssSearch: options.onBeforeVssSearch }
                        : {}),
                    ...(!hidden && options.onToolRunning
                        ? { onToolRunning: options.onToolRunning }
                        : {}),
                },
            );
            const memoryQuery = toolCall.name === "search_memory"
                && preparedResult.input
                && typeof preparedResult.input === "object"
                && typeof (preparedResult.input as Record<string, unknown>).query === "string"
                ? ((preparedResult.input as Record<string, unknown>).query as string)
                : undefined;
            const temporalFilterCapture: MemorySearchTemporalFilterCapture = {};
            const result = memoryQuery
                && options.memoryRecoveryCoordinator
                && options.revalidateMemorySearch
                ? await options.memoryRecoveryCoordinator.execute({
                    query: memoryQuery,
                    signal: input.signal,
                    ...(input.outerToolDeadlineAt === undefined
                        ? {}
                        : { outerToolDeadlineAt: input.outerToolDeadlineAt }),
                    executeAttempt: async (attempt, signal) => {
                        const invocation = attempt.mode === "standard"
                            ? createStandardMemorySearchInvocation({
                                temporalIntent: attempt.temporalIntent,
                                captureRecoverySeed: attempt.captureRecoverySeed,
                                invocationOrdinal: attempt.invocationOrdinal,
                                temporalFilterCapture,
                                runEpoch: attempt.runEpoch,
                                absoluteDeadlineMs: attempt.absoluteDeadlineMs,
                                providerRequestScope: options.providerRequestScope,
                                memoryPreparationOwnerSignal: options.memoryPreparationOwnerSignal,
                            })
                            : createRelaxedMemorySearchInvocation(attempt.seed, {
                                invocationOrdinal: attempt.invocationOrdinal,
                                runEpoch: attempt.runEpoch,
                                absoluteDeadlineMs: attempt.absoluteDeadlineMs,
                                providerRequestScope: options.providerRequestScope,
                                memoryPreparationOwnerSignal: options.memoryPreparationOwnerSignal,
                            });
                        return runWithMemorySearchInvocation(
                            invocation,
                            signal,
                            () => executeCapability(signal, attempt.mode === "relaxed"),
                        );
                    },
                    revalidate: (memory, signal, temporalFilter, temporalAudit) => (
                        options.revalidateMemorySearch!(
                            memory,
                            signal,
                            temporalFilter,
                            temporalAudit,
                        )
                    ),
                })
                : await executeCapability(input.signal);
            const memoryCapture = options.memoryEvidenceRegistry?.capture(
                toolCall,
                result,
                input.turnId,
                temporalFilterCapture.temporalFilter ?? null,
            );
            const canonicalResult = chatToolResultToPaAgentToolExecutionResult(
                toolCall,
                memoryCapture?.status === "collision"
                    ? createUnavailableMemoryToolResult(memoryCapture.query)
                    : result,
            );
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
            const executionResult: PaAgentToolExecutionResult = {
                ...canonicalResult,
                metadata: augmentedMetadata,
                sourceRecords: canonicalResult.sourceRecords?.map((record) => ({
                    ...record,
                    turnId: record.turnId ?? input.turnId,
                })),
            };
            if (toolCall.name === "search_memory" && options.memoryEvidenceRegistry) {
                const collisionQuery = memoryCapture?.status === "collision"
                    ? memoryCapture.query
                    : isSearchMemoryResult(result.content)
                        ? result.content.query
                        : result.inputSummary;
                const finalizer: PaAgentPreEmitToolResultsFinalizer = (pendingResults) => {
                    options.memoryEvidenceRegistry!.finalizePendingRawIdCollision(
                        toolCall.id,
                        collisionQuery,
                        pendingResults,
                    );
                };
                Object.defineProperty(executionResult, PA_AGENT_PRE_EMIT_TOOL_RESULTS, {
                    value: finalizer,
                    enumerable: true,
                    configurable: false,
                    writable: false,
                });
            }
            return executionResult;
        },
    };
}

function overwritePendingMemoryExecution(
    pending: PaAgentToolExecutionResult,
    unavailable: PaAgentToolExecutionResult,
): void {
    const executionElapsedMs = pending.metadata?.executionElapsedMs;
    pending.outcome = unavailable.outcome;
    pending.promptText = unavailable.promptText;
    if (unavailable.previewText === undefined) delete pending.previewText;
    else pending.previewText = unavailable.previewText;
    if (unavailable.includeInNextPrompt === undefined) delete pending.includeInNextPrompt;
    else pending.includeInNextPrompt = unavailable.includeInNextPrompt;
    pending.sourceRecords = unavailable.sourceRecords?.map((record) => ({ ...record })) ?? [];
    pending.contextUsed = unavailable.contextUsed?.map((item) => ({
        ...item,
        ...(item.sources ? { sources: item.sources.map((source) => ({ ...source })) } : {}),
    })) ?? [];
    pending.metadata = {
        ...(unavailable.metadata ?? {}),
        ...(typeof executionElapsedMs === "number" && Number.isFinite(executionElapsedMs)
            ? { executionElapsedMs }
            : {}),
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
    const providerResult = projectToolResultForProvider(result);
    const outcome = result.ok ? "success" : "recoverable_error";
    const promptText = serializeToolObservation(providerResult);
    const sourceRecords = cloneSourceRecords(providerResult.sourceRecords ?? []);
    const contextUsed = buildContextUsed(providerResult, sourceRecords);
    return {
        outcome,
        promptText,
        previewText: truncate(result.error ?? promptText, Math.max(0, MAX_PREVIEW_CHARS - 3)),
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
            ...(result.unavailableReason
                ? { unavailableReason: result.unavailableReason }
                : {}),
            // Trust-sensitive evidence metadata comes from the same fail-closed
            // projection serialized for the Provider. The helper may retain
            // only safe raw candidate aggregates for valid same-source follow-up.
            ...getToolResultControlMetadata(providerResult, result),
        },
    };
}

function projectToolResultForProvider(result: ChatToolResult<unknown>): ChatToolResult<unknown> {
    if (result.tool !== "search_memory" || !result.ok) {
        return result;
    }
    if (
        !isSearchMemoryResult(result.content)
        || result.content.query.trim() !== result.inputSummary.trim()
    ) {
        return {
            ...result,
            content: createUnavailableMemoryObservation(result.inputSummary),
            sources: [],
            sourceRecords: [],
        };
    }
    const observation = projectMemorySearchObservation(result.content);
    return {
        ...result,
        content: observation,
        sources: observation.sources,
        sourceRecords: projectMemorySourceRecords(result.sourceRecords ?? [], observation.sources),
    };
}

export function projectMemorySearchObservation(result: MemorySearchResult): MemorySearchObservation {
    const projection = projectMemoryDocumentsWithIntegrity(result.documents);
    const memoryEvidenceState = projection.lostEvidence
        ? null
        : deriveCoherentMemoryEvidenceState(result, projection.documents.length > 0);
    if (!memoryEvidenceState) {
        return createUnavailableMemoryObservation(result.query);
    }
    const documents = projection.documents;
    const sources = sourcesFromProjectedDocuments(documents);
    const hasAnswerableContent = documents.length > 0;
    const rerankVerdict = result.rerankVerdict
        ?? defaultRerankVerdict(memoryEvidenceState);
    const retrievalGuidance = typeof result.retrievalGuidance === "string"
        ? truncate(result.retrievalGuidance.trim(), 500)
        : "";
    return {
        query: result.query,
        documents,
        sources,
        hasAnswerableContent,
        memoryEvidenceState,
        rerankVerdict,
        ...(retrievalGuidance ? { retrievalGuidance } : {}),
    };
}

function deriveCoherentMemoryEvidenceState(
    result: MemorySearchResult,
    hasProjectedDocuments: boolean,
): MemorySearchObservation["memoryEvidenceState"] | null {
    if (
        !result.query.trim()
        || typeof result.usedMemory !== "boolean"
        || (
            result.hasAnswerableContent !== undefined
            && typeof result.hasAnswerableContent !== "boolean"
        )
    ) return null;

    if (hasProjectedDocuments) {
        if (
            !result.usedMemory
            || result.hasAnswerableContent === false
            || result.memoryEvidenceState === "none"
            || result.memoryEvidenceState === "unavailable"
        ) return null;
        const evidenceState = result.memoryEvidenceState
            ?? (result.rerankVerdict === "partially_relevant" ? "partial" : "evidence");
        return result.rerankVerdict !== undefined
            && result.rerankVerdict !== defaultRerankVerdict(evidenceState)
            ? null
            : evidenceState;
    }
    if (
        result.usedMemory
        || result.hasAnswerableContent === true
        || result.memoryEvidenceState === "evidence"
        || result.memoryEvidenceState === "partial"
    ) return null;
    if (result.memoryEvidenceState === "unavailable") {
        return result.rerankVerdict === "partially_relevant" ? null : "unavailable";
    }
    return result.rerankVerdict !== undefined && result.rerankVerdict !== "none_relevant"
        ? null
        : "none";
}

function defaultRerankVerdict(
    state: MemorySearchObservation["memoryEvidenceState"],
): MemorySearchObservation["rerankVerdict"] {
    if (state === "partial") return "partially_relevant";
    if (state === "none") return "none_relevant";
    return "relevant";
}

function createUnavailableMemoryObservation(query: string): MemorySearchObservation {
    return {
        query,
        documents: [],
        sources: [],
        hasAnswerableContent: false,
        memoryEvidenceState: "unavailable",
        rerankVerdict: "relevant",
        retrievalGuidance: "Memory evidence is currently unavailable; do not infer note content.",
    };
}

function projectMemoryDocuments(documents: readonly MemorySearchDocument[]): MemorySearchDocument[] {
    return projectMemoryDocumentsWithIntegrity(documents).documents;
}

function projectMemoryDocumentsWithIntegrity(
    documents: readonly MemorySearchDocument[],
): { documents: MemorySearchDocument[]; lostEvidence: boolean } {
    const projected: MemorySearchDocument[] = [];
    const seen = new Set<string>();
    let lostEvidence = false;
    for (const document of documents) {
        if (
            typeof document?.content !== "string"
            || !document.content.trim()
            || !Number.isFinite(document.score)
        ) {
            lostEvidence = true;
            continue;
        }
        const source = projectMemorySource(document.source, document.score);
        if (!source) {
            lostEvidence = true;
            continue;
        }
        const key = memorySourceKey(source);
        if (seen.has(key)) {
            lostEvidence = true;
            continue;
        }
        seen.add(key);
        if (projected.length >= 8) continue;
        projected.push({
            content: document.content,
            score: document.score,
            source,
        });
    }
    return { documents: projected, lostEvidence };
}

function projectMemorySource(source: ChatAgentSource, fallbackScore: number): ChatAgentSource | null {
    const path = normalizeMemoryObservationPath(source?.path);
    if (!path) return null;
    const chunkIndex = source.chunkIndex;
    if (chunkIndex !== undefined && (!Number.isInteger(chunkIndex) || chunkIndex < 0)) return null;
    const score = Number.isFinite(source.score)
        ? source.score
        : Number.isFinite(fallbackScore) ? fallbackScore : undefined;
    return {
        path,
        ...(chunkIndex !== undefined ? { chunkIndex } : {}),
        ...(score !== undefined ? { score } : {}),
    };
}

function sourcesFromProjectedDocuments(documents: readonly MemorySearchDocument[]): ChatAgentSource[] {
    return documents.map((document) => ({ ...document.source }));
}

function projectMemorySourceRecords(
    records: readonly SourceRecord[],
    sources: readonly ChatAgentSource[],
): SourceRecord[] {
    const sourceByKey = new Map(sources.map((source) => [memorySourceKey(source), source]));
    const sourceByPath = new Map(sources.map((source) => [source.path, source]));
    const projected: SourceRecord[] = [];
    const seen = new Set<string>();
    for (const record of records) {
        const path = normalizeMemoryObservationPath(record.path);
        if (!path) continue;
        const source = record.chunkIndex === undefined
            ? sourceByPath.get(path)
            : sourceByKey.get(memorySourceKey({ path, chunkIndex: record.chunkIndex }));
        if (!source) continue;
        const key = memorySourceKey(source);
        if (seen.has(key)) continue;
        seen.add(key);
        projected.push({
            kind: "memory-reference",
            dedupKey: createSourceDedupKey(source.path),
            ...(typeof record.turnId === "string" ? { turnId: record.turnId } : {}),
            ...(typeof record.providerId === "string" ? { providerId: record.providerId } : {}),
            ...(typeof record.capabilityName === "string" ? { capabilityName: record.capabilityName } : {}),
            sourceBoundary: "memory",
            path: source.path,
            ...(source.score !== undefined ? { score: source.score } : {}),
            ...(source.chunkIndex !== undefined ? { chunkIndex: source.chunkIndex } : {}),
            citationEligible: true,
        });
    }
    return projected;
}

function memorySourceKey(source: ChatAgentSource): string {
    return `${source.path}#${source.chunkIndex ?? ""}`;
}

function normalizeMemoryObservationPath(path: unknown): string | null {
    if (typeof path !== "string") return null;
    const normalized = path.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
    if (
        !normalized
        || !normalized.toLowerCase().endsWith(".md")
        || normalized.startsWith("/")
        || /^[A-Za-z]:\//.test(normalized)
        || normalized.split("/").some((segment) => !segment || segment === "..")
    ) return null;
    return normalized;
}

function getToolResultControlMetadata(
    result: ChatToolResult<unknown>,
    rawResult: ChatToolResult<unknown>,
): Record<string, unknown> {
    if (result.tool !== "search_memory" || !isSearchMemoryResult(result.content)) return {};
    const memory = result.content;
    const rawMemory = rawResult.tool === "search_memory" && isSearchMemoryResult(rawResult.content)
        ? rawResult.content
        : undefined;
    const documentCount = memory.documents.length;
    // Candidate excerpts are intentionally absent from the Provider projection.
    // Retain only their safe aggregate for the Host's same-source follow-up
    // policy, and never let raw control hints override an unavailable projection.
    const rawCandidateCount = Array.isArray(rawMemory?.candidates)
        ? rawMemory.candidates.length
        : 0;
    const candidateCount = memory.memoryEvidenceState === "unavailable"
        ? 0
        : rawCandidateCount;
    const hasAnswerableContent = memory.hasAnswerableContent ?? (memory.usedMemory && documentCount > 0);
    const rawNeedsSnippetFollowup = typeof rawMemory?.needsSnippetFollowup === "boolean"
        ? rawMemory.needsSnippetFollowup
        : undefined;
    const needsSnippetFollowup = memory.memoryEvidenceState !== "unavailable"
        && rawNeedsSnippetFollowup !== false
        && !hasAnswerableContent
        && candidateCount > 0;
    return {
        hitCount: documentCount,
        candidateCount,
        hasAnswerableContent,
        needsSnippetFollowup,
        memoryEvidenceState: memory.memoryEvidenceState
            ?? (hasAnswerableContent ? "evidence" : "none"),
        rerankVerdict: memory.rerankVerdict
            ?? (hasAnswerableContent ? "relevant" : "none_relevant"),
        needsMoreEvidence: memory.memoryEvidenceState === "unavailable"
            ? false
            : rawMemory?.needsMoreEvidence === true,
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

function cloneSourceRecords(records: readonly SourceRecord[]): SourceRecord[] {
    return records.map((record) => ({
        ...record,
        ...(record.metadata ? { metadata: { ...record.metadata } } : {}),
    }));
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

import type { AIUtils } from "../../ai-services/ai-utils";
import type { AiServiceHost } from "../../ai-services/AiServiceHost";
import type { AgentDebugNodeStatus, AgentDebugObservation, AgentDebugRunRecorder } from "../../ai-services/agent-debug-port";
import type { AgentEndStatus, AgentEvent, LegacyAgentEvent } from "../../ai-services/chat-types";
import type { RunSourceSelection } from "../../ai-services/chat-source-scope";
import { PaAgentRuntime, type PaAgentRuntimeOptions, type PaAgentStreamOptions } from "../../ai-services/pa-agent-runtime";
import type { PaAgentUsageLedgerSnapshot } from '../../ai-services/agent-usage-ledger';
import { runEvalCase } from "./runner";
import type { EvalAssertionFailure } from "./types";
import type { PaRuntimeEvalCase } from "./runtime-cases";

export interface PaRuntimeEvalActual {
    caseId: string;
    baseline: PaRuntimeEvalCase["baseline"];
    offlineLimit?: string;
    status: "completed" | "completed_with_warning" | "needs_user" | "incomplete" | "failed" | "cancelled" | "unknown";
    terminalStatus: AgentEndStatus | null;
    runtimeRunId?: string;
    error?: string;
    answer: string;
    writingArtifact?: string;
    sourcePaths: string[];
    sourceUrls: string[];
    toolResults: Array<{ name: string; promptText: string; sourcePaths: string[]; sourceUrls: string[]; isError: boolean }>;
    sourceAssertions: EvalAssertionFailure[];
    toolCalls: Array<{ name: string; input: unknown; outcome?: string }>;
    calls: Array<{ callId: string; purpose: string; totalTokens?: number }>;
    attempts: Array<{ attemptId: string; callId?: string; outcome?: string }>;
    usage: { estimatedPromptTokens: number | null; measuredPromptTokens: number | null;
        logicalTotalTokens: number | null; knownUnassignedLogicalTokens: number | null;
        physicalTotalTokens: number | null; knownPhysicalTokens: number;
        physicalAttribution: PaAgentUsageLedgerSnapshot['physicalAttribution'];
        attempts: PaAgentUsageLedgerSnapshot['attempts']; logicalCalls: PaAgentUsageLedgerSnapshot['logicalCalls'];
        price: { amount: null; currency: null; reason: string } };
    visibleOutputs: Array<{ kind: "answer-snapshot" | "writing-artifact"; atMs: number; text: string }>;
    firstVisibleOutputMs: number | null;
    firstUsefulMs: number | null;
    usefulRubric: "pending_human_review";
    deliveredMs: number | null;
}

/** Counts every physical native fetch, including SDK retries and auxiliary calls. */
export function createPaRuntimeEvalRequestBudget(fetchImpl: typeof fetch, maximum: number): {
    fetch: typeof fetch;
    count: () => number;
} {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Physical request maximum must be a positive integer");
    let count = 0;
    return {
        fetch: ((input, init) => {
            if (count >= maximum) throw new Error(`B149_EVAL_PHYSICAL_REQUEST_LIMIT:${maximum}`);
            count++;
            return fetchImpl(input, init);
        }) as typeof fetch,
        count: () => count,
    };
}

/** Uses the production runtime and a volatile observation port; the caller owns the model transport. */
export async function runPaRuntimeEvalCase(
    evalCase: PaRuntimeEvalCase,
    host: AiServiceHost,
    aiUtils: AIUtils,
    options: {
        signal?: AbortSignal;
        turnLeaseProvider?: PaAgentStreamOptions["turnLeaseProvider"];
        runtimeOptions?: PaAgentRuntimeOptions;
    } = {},
): Promise<PaRuntimeEvalActual> {
    const observations: AgentDebugObservation[] = [];
    const lifecycle: AgentEvent[] = [];
    const legacy: LegacyAgentEvent[] = [];
    const started = Date.now();
    let runtimeRunId: string | undefined;
    const visibleOutputs: PaRuntimeEvalActual["visibleOutputs"] = [];
    let deliveredMs: number | null = null;
    let recorderStatus: AgentDebugNodeStatus | undefined;
    let usageLedger: PaAgentUsageLedgerSnapshot | undefined;
    const recorder: AgentDebugRunRecorder = {
        captureId: `b149-${evalCase.id}`,
        enabled: () => true,
        bindRun: id => { runtimeRunId = id; },
        observe: event => { observations.push(event); },
        finish: status => { recorderStatus = status; },
    };
    const runtime = new PaAgentRuntime(host, aiUtils, { skillContextProvider: null, ...options.runtimeOptions });
    const controller = new AbortController();
    if (evalCase.offline === "cancel" && !options.signal) controller.abort();
    const signal = options.signal ?? controller.signal;
    const runSourceSelection: RunSourceSelection = Object.freeze({
        schemaVersion: 1,
        scope: evalCase.requestedScope,
        selectionId: `b149-${evalCase.id}-selection`,
        userMessageId: `b149-${evalCase.id}-user`,
    });
    let error: string | undefined;
    try {
        await runtime.streamTurn({
            prompt: evalCase.prompt,
            userText: evalCase.prompt,
            runSourceSelection,
            chatHistory: evalCase.history ? [...evalCase.history] : undefined,
            memoryMode: "auto",
            ...(evalCase.offline === "writing" ? { writingRequest: { requestId: `b149-${evalCase.id}` } } : {}),
            signal,
            turnLeaseProvider: options.turnLeaseProvider,
            debugRecorder: recorder,
            onUsageAccounting: snapshot => { usageLedger = snapshot; },
            onLifecycleEvent: event => {
                lifecycle.push(event);
                if (event.type === "agent_end") deliveredMs = Date.now() - started;
            },
            onEvent: event => {
                legacy.push(event);
                if (event.kind === "answer-snapshot" && event.snapshot.trim()) {
                    visibleOutputs.push({ kind: event.kind, atMs: Date.now() - started, text: event.snapshot });
                } else if (event.kind === "writing-artifact" && event.body.trim()) {
                    visibleOutputs.push({ kind: event.kind, atMs: Date.now() - started, text: event.body });
                }
                if (event.kind === "answer-complete" || event.kind === "partial-output-error"
                    || event.kind === "aborted" || event.kind === "writing-artifact") {
                    deliveredMs = Date.now() - started;
                }
            },
        });
    } catch (cause) {
        error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    } finally {
        runtime.dispose();
    }
    const end = [...lifecycle].reverse().find(event => event.type === "agent_end");
    const terminalStatus = end?.status ?? null;
    const status: PaRuntimeEvalActual["status"] = signal.aborted || recorderStatus === "cancelled" || terminalStatus === "aborted"
        ? "cancelled" : error || recorderStatus === "failed" || terminalStatus === "error" ? "failed"
            : terminalStatus ?? "unknown";
    if (deliveredMs === null && status !== "completed") deliveredMs = Date.now() - started;
    const firstVisibleOutputMs = visibleOutputs.length ? visibleOutputs[0].atMs : null;
    if (firstVisibleOutputMs !== null && deliveredMs !== null) deliveredMs = Math.max(deliveredMs, firstVisibleOutputMs);
    const toolResults = lifecycle.flatMap(event => event.type === "message_end" && event.message.role === "toolResult"
        ? [{ name: event.message.toolName, promptText: event.message.content.promptText,
            sourcePaths: (event.message.content.sourceRecords ?? []).flatMap(source => source.path ? [source.path] : []),
            sourceUrls: (event.message.content.sourceRecords ?? []).flatMap(source => source.url ? [source.url] : []),
            isError: event.message.isError }] : []);
    const sourcePaths = [...new Set(toolResults.filter(result => !result.isError).flatMap(result => result.sourcePaths))];
    const sourceUrls = [...new Set(toolResults.filter(result => !result.isError).flatMap(result => result.sourceUrls))];
    const requiredPaths = evalCase.requiredNotePaths ?? [];
    const sourceAssertions = requiredPaths.length ? runEvalCase({
        id: evalCase.id, title: evalCase.title, category: "retrieval",
        actual: { sourceRefs: sourcePaths.map(path => ({ path })) },
        expected: { assertions: requiredPaths.map(path => ({ type: "must_include_source" as const, path })) },
    }, { sourceExists: path => evalCase.notes.some(note => note.path === path) }).failures : [];
    const toolStarts = lifecycle.filter(event => event.type === "tool_execution_start");
    const toolEnds = lifecycle.filter(event => event.type === "tool_execution_end");
    const toolCalls = toolStarts.map(start => ({
        name: start.toolName, input: start.input,
        outcome: toolEnds.find(endEvent => endEvent.toolCallId === start.toolCallId)?.outcome,
    }));
    const callMap = new Map<string, { callId: string; purpose: string; totalTokens?: number }>();
    for (const observation of observations) {
        if (observation.kind !== "llm" || !observation.callId) continue;
        const prior = callMap.get(observation.callId);
        callMap.set(observation.callId, {
            callId: observation.callId, purpose: observation.purpose ?? prior?.purpose ?? "unknown",
            totalTokens: observation.usage?.totalTokens ?? prior?.totalTokens,
        });
    }
    const calls = [...callMap.values()];
    const attemptMap = new Map<string, { attemptId: string; callId?: string; outcome?: string }>();
    for (const observation of observations) {
        if (observation.kind !== "attempt" || !observation.attemptId) continue;
        const prior = attemptMap.get(observation.attemptId);
        attemptMap.set(observation.attemptId, {
            attemptId: observation.attemptId, callId: observation.callId ?? prior?.callId,
            outcome: observation.outcome ?? prior?.outcome,
        });
    }
    const attempts = [...attemptMap.values()];
    return {
        caseId: evalCase.id, baseline: evalCase.baseline, ...(evalCase.offlineLimit ? { offlineLimit: evalCase.offlineLimit } : {}),
        status, terminalStatus,
        runtimeRunId, ...(error ? { error } : {}),
        answer: legacy.filter((event): event is Extract<LegacyAgentEvent, { kind: "answer-snapshot" }> => event.kind === "answer-snapshot")
            .slice(-1)[0]?.snapshot ?? "",
        writingArtifact: legacy.find((event): event is Extract<LegacyAgentEvent, { kind: "writing-artifact" }> => event.kind === "writing-artifact")?.body,
        sourcePaths, sourceUrls, sourceAssertions, toolCalls, toolResults, calls, attempts,
        usage: { estimatedPromptTokens: usageLedger?.attempts.length
            && usageLedger.attempts.every(attempt => attempt.estimatedPromptTokens !== undefined)
            ? usageLedger.attempts.reduce((sum, attempt) => sum + attempt.estimatedPromptTokens!, 0) : null,
        measuredPromptTokens: usageLedger?.physicalAttribution === 'complete'
            && usageLedger.attempts.every(attempt => attempt.measuredPromptTokens !== undefined)
            ? usageLedger.attempts.reduce((sum, attempt) => sum + attempt.measuredPromptTokens!, 0) : null,
        logicalTotalTokens: usageLedger?.logicalTotalTokens ?? null,
        knownUnassignedLogicalTokens: usageLedger?.knownUnassignedLogicalTokens ?? null,
        physicalTotalTokens: usageLedger?.physicalTotalTokens ?? null,
        knownPhysicalTokens: usageLedger?.knownPhysicalTokens ?? 0,
        physicalAttribution: usageLedger?.physicalAttribution ?? 'unknown',
        attempts: usageLedger?.attempts ?? [], logicalCalls: usageLedger?.logicalCalls ?? [],
        price: { amount: null, currency: null, reason: 'pricing_not_verified_for_endpoint_model' } },
        visibleOutputs, firstVisibleOutputMs, firstUsefulMs: null, usefulRubric: "pending_human_review", deliveredMs,
    };
}

/** Mechanical evidence checks; semantic usefulness and claim support still need human review. */
export function validatePaRuntimeEvalEvidence(
    evalCase: PaRuntimeEvalCase,
    actual: PaRuntimeEvalActual,
    requestBodies: readonly unknown[],
): string[] {
    const failures = actual.sourceAssertions.map(failure => failure.message);
    for (const path of evalCase.requiredNotePaths ?? []) {
        if (!actual.sourcePaths.includes(path)) failures.push(`Missing observed note source: ${path}`);
    }
    for (const url of evalCase.requiredWebUrls ?? []) {
        if (!actual.sourceUrls.includes(url)) failures.push(`Missing web source URL: ${url}`);
    }
    const toolText = actual.toolResults.map(result => result.promptText).join("\n");
    for (const sentinel of evalCase.requiredToolText ?? []) {
        if (!toolText.includes(sentinel)) failures.push(`Missing tool-result evidence: ${sentinel}`);
    }
    const laterRequests = requestBodies.slice(1).map(body => JSON.stringify(body)).join("\n");
    const allRequests = requestBodies.map(body => JSON.stringify(body)).join("\n");
    for (const sentinel of evalCase.requiredNextRequestText ?? []) {
        if (!laterRequests.includes(sentinel)) failures.push(`Evidence was not sent in a subsequent model request: ${sentinel}`);
    }
    if (evalCase.requiredToolError && !actual.toolResults.some(result =>
        result.name === evalCase.requiredToolError && result.isError)) {
        failures.push(`Missing recorded tool error: ${evalCase.requiredToolError}`);
    }
    for (const sentinel of evalCase.forbiddenModelInputText ?? []) {
        if (allRequests.includes(sentinel)) failures.push(`Forbidden material entered a model request: ${sentinel}`);
    }
    return failures;
}

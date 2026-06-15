import type {
    PaAgentHostPolicy,
    PaAgentTurnSummary,
} from "./pa-agent-loop";
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../platform-dom";
import {
    createAnswerCompletionLedger,
    decideAnswerCompletion,
    deriveAnswerCompletionTurnFacts,
    recordAnswerCompletionTurn,
    type AnswerCompletionLedger,
} from "./pa-agent-answer-completion-policy";
import {
    deriveAnswerReadyAgentControlSnapshot,
    deriveSameSourceFollowUpAgentControlSnapshot,
} from "./pa-agent-control-policy";

export const REQUIRED_CAPABILITY_CLASSIFIER_TIMEOUT_MS = 800;

type TimeoutHandle = PlatformTimeoutHandle;

export type RequiredCapability =
    | "search_memory"
    | "webSearch"
    | "get_current_note_context";

export interface RequiredCapabilityClassificationItem {
    capability: RequiredCapability;
    confidence: number;
    reason: string;
    level: "required" | "suggested";
}

export interface RequiredCapabilityClassification {
    items: RequiredCapabilityClassificationItem[];
}

type CapabilityRuntimePhase =
    | { kind: "awaiting_initial_tools" }
    | { kind: "corrective_issued" }
    | { kind: "failed_retry_issued" }
    | { kind: "terminal"; from: "initial" | "corrective" | "failed_retry" };

interface RequiredCapabilityRuntimeState {
    classification: RequiredCapabilityClassification;
    availableCapabilities: ReadonlySet<RequiredCapability>;
    usedCapabilities: Set<RequiredCapability>;
    phase: CapabilityRuntimePhase;
    answerCompletionLedger: AnswerCompletionLedger;
}

export interface RequiredCapabilityClassifier {
    classify(input: { userInput: string; signal?: AbortSignal }): Promise<unknown>;
}

export interface ResolveRequiredCapabilityClassificationOptions {
    userInput: string;
    classifier?: RequiredCapabilityClassifier | null;
    timeoutMs?: number;
    signal?: AbortSignal;
}

const CAPABILITY_LABELS: Record<RequiredCapability, string> = {
    search_memory: "Memory from notes",
    webSearch: "WebSearch",
    get_current_note_context: "current note context",
};

export function createRequiredCapabilityHostPolicy(
    options: {
        userInput: string;
        availableCapabilities: ReadonlySet<RequiredCapability>;
        classification?: RequiredCapabilityClassification;
    },
): {
    hostPolicy: PaAgentHostPolicy;
    initialRuntimeInstruction?: string;
    classification: RequiredCapabilityClassification;
} {
    const classification = applyUserExplicitCapabilityConstraints(
        options.classification ?? classifyRequiredCapabilitiesDeterministic(options.userInput),
        options.userInput,
    );
    const state: RequiredCapabilityRuntimeState = {
        classification,
        availableCapabilities: options.availableCapabilities,
        usedCapabilities: new Set(),
        phase: { kind: "awaiting_initial_tools" },
        answerCompletionLedger: createAnswerCompletionLedger(),
    };

    const hostPolicy: PaAgentHostPolicy = {
        afterTurn: (summary) => decideAfterTurn(summary, state),
    };
    HOST_POLICY_STATE_MAP.set(hostPolicy, state);

    return {
        classification,
        initialRuntimeInstruction: buildInitialRuntimeInstruction(state),
        hostPolicy,
    };
}

export type RequiredCapabilityPhaseKind =
    | "awaiting_initial_tools"
    | "corrective_issued"
    | "failed_retry_issued"
    | "terminal";

const HOST_POLICY_STATE_MAP = new WeakMap<PaAgentHostPolicy, RequiredCapabilityRuntimeState>();

/**
 * Test-only inspector for the runtime phase of a host policy created by
 * {@link createRequiredCapabilityHostPolicy}. Production code MUST NOT depend on
 * this — phase transitions are an internal mechanism, and decisions should be
 * driven by the values returned from `afterTurn`.
 */
export function inspectRequiredCapabilityPhase(
    hostPolicy: PaAgentHostPolicy,
): RequiredCapabilityPhaseKind | undefined {
    return HOST_POLICY_STATE_MAP.get(hostPolicy)?.phase.kind;
}

export async function resolveRequiredCapabilityClassification(
    options: ResolveRequiredCapabilityClassificationOptions,
): Promise<RequiredCapabilityClassification> {
    const fallback = applyUserExplicitCapabilityConstraints(
        classifyRequiredCapabilitiesDeterministic(options.userInput),
        options.userInput,
    );
    if (!options.classifier) {
        return fallback;
    }

    const timeoutMs = options.timeoutMs ?? REQUIRED_CAPABILITY_CLASSIFIER_TIMEOUT_MS;
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (options.signal?.aborted) {
        controller.abort();
    } else {
        options.signal?.addEventListener("abort", abortFromParent, { once: true });
    }

    let timeoutId: TimeoutHandle | undefined;
    try {
        const timeout = new Promise<"timeout">((resolve) => {
            timeoutId = setRequiredCapabilityTimeout(() => {
                controller.abort();
                resolve("timeout");
            }, timeoutMs);
        });
        const result = await Promise.race([
            options.classifier.classify({
                userInput: options.userInput,
                signal: controller.signal,
            }),
            timeout,
        ]);

        if (result === "timeout") return fallback;

        const normalized = normalizeClassifierResult(result);
        if (!normalized) return fallback;
        return applyUserExplicitCapabilityConstraints(normalized, options.userInput);
    } catch {
        return fallback;
    } finally {
        if (timeoutId) clearRequiredCapabilityTimeout(timeoutId);
        options.signal?.removeEventListener("abort", abortFromParent);
    }
}

function setRequiredCapabilityTimeout(callback: () => void, ms: number): TimeoutHandle {
    return setPlatformTimeout(callback, ms);
}

function clearRequiredCapabilityTimeout(timeoutId: TimeoutHandle): void {
    clearPlatformTimeout(timeoutId);
}

export function applyUserExplicitCapabilityConstraints(
    classification: RequiredCapabilityClassification,
    userInput: string,
): RequiredCapabilityClassification {
    const suppressed = getExplicitlySuppressedRequiredCapabilities(userInput);
    if (suppressed.size === 0) return classification;
    return {
        items: classification.items.filter((item) => !suppressed.has(item.capability)),
    };
}

export function classifyRequiredCapabilitiesDeterministic(userInput: string): RequiredCapabilityClassification {
    const items: RequiredCapabilityClassificationItem[] = [];
    for (const table of CAPABILITY_SIGNALS) {
        const score = scoreCapability(userInput, table);
        if (score) addItem(items, table.capability, score);
    }
    return { items };
}

// Definition moved to `./chat-tool-prepare-helpers` so chat-tools.ts prepareArguments
// can call it without a circular import. Re-exported here for backward compatibility
// with existing callers in pa-agent-runtime.ts and other modules.
export { isExplicitCurrentNoteOnlyRequest, isExplicitNoWebRequest, shouldUseFullCurrentNoteContext } from "./chat-tool-prepare-helpers";
import { isExplicitCurrentNoteOnlyRequest, isExplicitNoWebRequest } from "./chat-tool-prepare-helpers";

function normalizeClassifierResult(result: unknown): RequiredCapabilityClassification | null {
    const parsed = typeof result === "string" ? parseJsonObject(result) : result;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { items?: unknown }).items)) {
        return null;
    }

    const items = (parsed as { items: unknown[] }).items
        .map(normalizeClassifierItem)
        .filter((item): item is RequiredCapabilityClassificationItem => Boolean(item));
    return { items };
}

function normalizeClassifierItem(value: unknown): RequiredCapabilityClassificationItem | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.capability !== "string" || !isRequiredCapability(record.capability)) return null;
    const confidence = typeof record.confidence === "number"
        ? Math.max(0, Math.min(1, record.confidence))
        : 0;
    const level = classifyConfidenceToLevel(confidence);
    if (!level) return null;
    return {
        capability: record.capability,
        confidence,
        reason: typeof record.reason === "string" && record.reason.trim()
            ? record.reason.trim()
            : "classifier signal",
        level,
    };
}

function parseJsonObject(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function decideAfterTurn(
    summary: PaAgentTurnSummary,
    state: RequiredCapabilityRuntimeState,
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    if (state.phase.kind === "terminal") {
        return { action: "stop", reason: "terminal_idempotent", status: "completed" };
    }

    const facts = deriveAnswerCompletionTurnFacts(summary);
    recordUsedCapabilities(summary, state.usedCapabilities);
    recordAnswerCompletionTurn(state.answerCompletionLedger, summary, facts);

    const failedRequiredCapabilities = getFailedRequiredCapabilityNames(summary, state);
    if (failedRequiredCapabilities.length > 0) {
        return handleFailedRequired(summary, state, facts, failedRequiredCapabilities);
    }

    const completionDecision = decideAnswerCompletion({
        summary,
        ledger: state.answerCompletionLedger,
        facts,
    });
    if (completionDecision?.action === "force_finalize") {
        return {
            action: "continue",
            reason: "needs_follow_up",
            runtimeInstruction: completionDecision.runtimeInstruction,
            toolMode: completionDecision.toolMode,
        };
    }
    if (completionDecision?.action === "continue_tooling" && shouldOpenSameSourceFollowUp(summary)) {
        return buildSameSourceFollowUpDecision(summary);
    }
    if (completionDecision?.action === "continue_tooling" && facts.hasPromptIncludedObservation) {
        return buildAnswerReadyDecision(summary, completionDecision.reason);
    }
    if (completionDecision?.action === "stop_incomplete") {
        state.phase = phaseToTerminal(state.phase);
        return {
            action: "stop",
            reason: completionDecision.reason,
            status: "incomplete",
            diagnostics: completionDecision.diagnostics,
        };
    }

    if (summary.status === "tool_results_ready") {
        return { action: "continue", reason: "tool_results_ready" };
    }

    const missing = computeMissingRequired(state);

    if (missing.available.length > 0 && state.phase.kind === "awaiting_initial_tools") {
        state.phase = { kind: "corrective_issued" };
        return {
            action: "continue",
            reason: "corrective_turn",
            runtimeInstruction: buildCorrectiveInstruction(missing.available),
        };
    }

    if (missing.all.length > 0) {
        state.phase = phaseToTerminal(state.phase);
        return buildMissingRequiredDecision(summary, state, "required_capability_missing");
    }

    state.phase = phaseToTerminal(state.phase);
    return {
        action: "stop",
        reason: summary.status,
        status: mapTerminalStatus(summary.status),
    };
}

function buildAnswerReadyDecision(
    summary: PaAgentTurnSummary,
    reason: "new_tool_evidence" | "tool_chain_allowed",
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    const runtimeInstruction = buildAnswerReadyInstruction(reason);
    return {
        action: "continue",
        reason: "tool_results_ready",
        runtimeInstruction,
        controlSnapshot: deriveAnswerReadyAgentControlSnapshot(summary.controlSnapshot, {
            runtimeInstruction,
            diagnostics: [{
                type: "answer_ready_decision",
                message: "Host policy marked the next turn as answer-ready after useful tool observations.",
                metadata: { reason },
            }],
        }),
    };
}

function buildAnswerReadyInstruction(reason: "new_tool_evidence" | "tool_chain_allowed"): string {
    return [
        reason === "new_tool_evidence"
            ? "Tool observations are now available."
            : "Tool observations or status information are now available.",
        "Answer directly if the existing observations are sufficient.",
        "Call another allowed tool only when a specific missing fact is needed; do not repeat an identical source/query.",
    ].join(" ");
}

function shouldOpenSameSourceFollowUp(summary: PaAgentTurnSummary): boolean {
    return summary.toolResults.some((result) =>
        result.toolName === "search_memory"
        && !result.isError
        && result.content.includeInNextPrompt
        && (
            result.content.metadata?.needsSnippetFollowup === true
            || result.content.metadata?.needsFollowup === true
        ));
}

function buildSameSourceFollowUpDecision(
    summary: PaAgentTurnSummary,
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    const runtimeInstruction = [
        "The Memory result indicates that a targeted note follow-up may be useful.",
        "Use one allowed notes follow-up tool only if it resolves a specific missing fact; otherwise answer from the existing observations.",
    ].join(" ");
    return {
        action: "continue",
        reason: "needs_follow_up",
        runtimeInstruction,
        controlSnapshot: deriveSameSourceFollowUpAgentControlSnapshot(summary.controlSnapshot, {
            sourceScope: "notes",
            runtimeInstruction,
            diagnostics: [{
                type: "same_source_follow_up_decision",
                message: "Host policy opened notes follow-up tools because Memory requested snippet follow-up.",
            }],
        }),
    };
}

function handleFailedRequired(
    summary: PaAgentTurnSummary,
    state: RequiredCapabilityRuntimeState,
    facts: ReturnType<typeof deriveAnswerCompletionTurnFacts>,
    failedRequiredCapabilities: RequiredCapability[],
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    if (state.phase.kind === "awaiting_initial_tools") {
        state.phase = { kind: "failed_retry_issued" };
        return buildFailedRetryDecision(summary, state, facts, failedRequiredCapabilities);
    }
    state.phase = phaseToTerminal(state.phase);
    return buildMissingRequiredDecision(summary, state, "required_capability_failed");
}

function buildFailedRetryDecision(
    summary: PaAgentTurnSummary,
    state: RequiredCapabilityRuntimeState,
    facts: ReturnType<typeof deriveAnswerCompletionTurnFacts>,
    failedRequiredCapabilities: RequiredCapability[],
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    const completionDecision = decideAnswerCompletion({
        summary,
        ledger: state.answerCompletionLedger,
        facts,
        failedRequiredCapabilities,
    });
    if (completionDecision?.action === "force_finalize") {
        return {
            action: "continue",
            reason: "needs_follow_up",
            runtimeInstruction: completionDecision.runtimeInstruction,
            toolMode: completionDecision.toolMode,
        };
    }
    return {
        action: "continue",
        reason: "needs_follow_up",
        runtimeInstruction: buildFailedRequiredToolInstruction(failedRequiredCapabilities),
        toolMode: "final_answer_only",
    };
}

function computeMissingRequired(state: RequiredCapabilityRuntimeState): {
    all: RequiredCapabilityClassificationItem[];
    available: RequiredCapabilityClassificationItem[];
} {
    const all = getRequiredItems(state.classification)
        .filter((item) => !state.usedCapabilities.has(item.capability));
    const available = all
        .filter((item) => state.availableCapabilities.has(item.capability));
    return { all, available };
}

function mapTerminalStatus(
    status: PaAgentTurnSummary["status"],
): "completed" | "completed_with_warning" | "aborted" | "error" | "incomplete" {
    if (status === "completed_with_warning") return "completed_with_warning";
    if (status === "aborted") return "aborted";
    if (status === "error") return "error";
    if (status === "incomplete") return "incomplete";
    return "completed";
}

// Convert any non-terminal phase to terminal, preserving which prior phase issued
// the corrective / failed-retry attempt so that warning metadata can expose the
// `correctiveAttempted` / `failedRequiredToolRetryAttempted` booleans that downstream
// consumers (and tests) inspect.
function phaseToTerminal(phase: CapabilityRuntimePhase): CapabilityRuntimePhase {
    if (phase.kind === "corrective_issued") return { kind: "terminal", from: "corrective" };
    if (phase.kind === "failed_retry_issued") return { kind: "terminal", from: "failed_retry" };
    if (phase.kind === "terminal") return phase;
    return { kind: "terminal", from: "initial" };
}

function isCorrectiveAttempted(phase: CapabilityRuntimePhase): boolean {
    return phase.kind === "corrective_issued"
        || (phase.kind === "terminal" && phase.from === "corrective");
}

function isFailedRetryAttempted(phase: CapabilityRuntimePhase): boolean {
    return phase.kind === "failed_retry_issued"
        || (phase.kind === "terminal" && phase.from === "failed_retry");
}

function getRequiredItems(
    classification: RequiredCapabilityClassification,
): RequiredCapabilityClassificationItem[] {
    return classification.items.filter((item) => item.level === "required");
}

function getSuggestedItems(
    classification: RequiredCapabilityClassification,
): RequiredCapabilityClassificationItem[] {
    return classification.items.filter((item) => item.level === "suggested");
}

function buildInitialRuntimeInstruction(state: RequiredCapabilityRuntimeState): string | undefined {
    const parts: string[] = [];
    const required = getRequiredItems(state.classification);
    const availableRequired = required
        .filter((item) => state.availableCapabilities.has(item.capability));
    const unavailableRequired = required
        .filter((item) => !state.availableCapabilities.has(item.capability));
    const suggested = getSuggestedItems(state.classification)
        .filter((item) => item.confidence >= 0.60 && state.availableCapabilities.has(item.capability));

    if (availableRequired.length > 0) {
        parts.push([
            `The user request appears to require ${formatCapabilities(availableRequired)}.`,
            "Use the listed tool or tools if available before answering.",
            "If a listed tool is unavailable, answer from available context and do not claim unavailable evidence.",
        ].join(" "));
    }
    if (unavailableRequired.length > 0) {
        parts.push([
            `The user request appears to require ${formatCapabilities(unavailableRequired)}, but that capability is unavailable in this runtime.`,
            "Answer from available context and do not claim unavailable evidence.",
        ].join(" "));
    }
    if (suggested.length > 0) {
        parts.push([
            `The user request may benefit from ${formatCapabilities(suggested)}.`,
            "Use the listed tool or tools if helpful and available.",
        ].join(" "));
    }

    return parts.length > 0 ? parts.join("\n") : undefined;
}

function buildCorrectiveInstruction(items: RequiredCapabilityClassificationItem[]): string {
    return [
        `The answer still appears to require ${formatCapabilities(items)}.`,
        "Use the listed tool or tools if available before giving the final answer.",
        "If the tool is unavailable, answer from available context and do not claim unavailable evidence.",
    ].join(" ");
}

function buildFailedRequiredToolInstruction(capabilities: RequiredCapability[]): string {
    const toolList = capabilities
        .map((capability) => `${CAPABILITY_LABELS[capability]} (${capability})`)
        .join(", ");
    return [
        `${toolList} was already attempted but returned an unavailable or invalid tool result.`,
        "Do not call that failed tool again in this run.",
        "Produce the final answer from only available context.",
        "If the requested evidence is unavailable, do not claim it was verified.",
    ].join(" ");
}

function buildMissingRequiredDecision(
    summary: PaAgentTurnSummary,
    state: RequiredCapabilityRuntimeState,
    reason: "required_capability_missing" | "required_capability_failed",
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    const missingRequired = getRequiredItems(state.classification)
        .filter((item) => !state.usedCapabilities.has(item.capability));
    const correctiveAttempted = isCorrectiveAttempted(state.phase);
    const failedRequiredToolRetryAttempted = isFailedRetryAttempted(state.phase);
    const warnings = missingRequired.map((item) => ({
        type: "required_capability_missing",
        capability: item.capability,
        message: "Answer may be incomplete",
        detail: reason === "required_capability_failed" || failedRequiredToolRetryAttempted
            ? `${CAPABILITY_LABELS[item.capability]} was required but failed or was unavailable.`
            : `${CAPABILITY_LABELS[item.capability]} was required but was not used.`,
        metadata: {
            confidence: item.confidence,
            reason: item.reason,
            available: state.availableCapabilities.has(item.capability),
            correctiveAttempted,
            failedRequiredToolRetryAttempted,
        },
    }));
    const diagnostics = summary.committedFinalText ? undefined : [{
        type: "required_capability_missing",
        message: "No answer was produced because required context was not successfully used.",
        capabilities: missingRequired.map((item) => item.capability),
    }];
    return {
        action: "stop",
        reason,
        status: summary.committedFinalText ? "completed_with_warning" : "incomplete",
        warnings,
        ...(diagnostics ? { diagnostics } : {}),
    };
}

function formatCapabilities(items: readonly RequiredCapabilityClassificationItem[]): string {
    return items
        .map((item) => `${CAPABILITY_LABELS[item.capability]} (${item.capability})`)
        .join(", ");
}

function recordUsedCapabilities(
    summary: PaAgentTurnSummary,
    usedCapabilities: Set<RequiredCapability>,
): void {
    for (const result of summary.toolResults) {
        const capability = getSatisfiedRequiredCapability(result);
        if (capability) {
            usedCapabilities.add(capability);
        }
    }
}

function getSatisfiedRequiredCapability(
    result: PaAgentTurnSummary["toolResults"][number],
): RequiredCapability | undefined {
    if (isSuccessfulRequiredCapabilityResult(result)) {
        return result.toolName;
    }
    if (
        result.toolName === "inspect_obsidian_note"
        && !result.isError
        && result.content.metadata?.outcome === "success"
    ) {
        return "get_current_note_context";
    }
    return undefined;
}

function getFailedRequiredCapabilityNames(
    summary: PaAgentTurnSummary,
    state: RequiredCapabilityRuntimeState,
): RequiredCapability[] {
    const requiredNames = new Set(getRequiredItems(state.classification).map((item) => item.capability));
    return [...new Set(summary.toolResults
        .filter((result) =>
            isRequiredCapability(result.toolName)
            && requiredNames.has(result.toolName)
            && state.availableCapabilities.has(result.toolName)
            && result.isError
            && result.content.metadata?.outcome !== "duplicate_skipped"
        )
        .map((result) => result.toolName as RequiredCapability))];
}

function isSuccessfulRequiredCapabilityResult(
    result: PaAgentTurnSummary["toolResults"][number],
): result is PaAgentTurnSummary["toolResults"][number] & { toolName: RequiredCapability } {
    return isRequiredCapability(result.toolName)
        && !result.isError
        && result.content.metadata?.outcome === "success";
}

function addItem(
    items: RequiredCapabilityClassificationItem[],
    capability: RequiredCapability,
    score: { confidence: number; reason: string },
): void {
    const level = classifyConfidenceToLevel(score.confidence);
    if (!level) return;
    items.push({
        capability,
        confidence: score.confidence,
        reason: score.reason,
        level,
    });
}

function classifyConfidenceToLevel(
    confidence: number,
): "required" | "suggested" | null {
    if (confidence >= 0.75) return "required";
    if (confidence >= 0.45) return "suggested";
    return null;
}

interface CapabilitySignalTable {
    capability: RequiredCapability;
    /** Strong signal — any hit → confidence 0.9 ("required") */
    strong: { regex: RegExp[]; chineseTokens: string[] };
    /** Weak signal — any hit → confidence 0.65 ("suggested") */
    weak: { regex: RegExp[]; chineseTokens: string[] };
}

// Single source of truth for deterministic capability signals.
// CJK token guidance (SDD §4.4): only include double-character-plus, domain-specific
// compounds. Generic adverbs like 最新/今天/当前/最近/上下文/更新/实时 are intentionally
// excluded because they collide across topics and produce false positives.
const CAPABILITY_SIGNALS: readonly CapabilitySignalTable[] = [
    {
        capability: "webSearch",
        // SDD §4.2: keep `latest|today's|this week's` tied to an external/current
        // information noun so note-domain phrases like "today I wrote" do not match.
        strong: {
            regex: [
                /\b(search the web|look online|official site|web search)\b/,
                /\bcurrent (news|events|price|version|status|weather|release|information|info|situation)\b/,
                /\b(latest|today's|this week's) (news|version|release|update)\b/,
                /\bwhat(?:'s| is) (?:the )?(latest|newest)\b.*\b(news|version|release|update|status|price|weather|docs|documentation)\b/,
                /\btoday(?:'s)?\b.*\b(news|version|release|update|status|price|weather|schedule|events)\b/,
                /\b(latest|newest) (docs|documentation|guide|api|sdk|model|pricing|rules|regulations|law|standard|schedule)\b/,
                /(今天|今日|现在|实时).*空气质量/,
                /当前(?!笔记).*空气质量/,
            ],
            chineseTokens: [
                "搜索网",
                "网上查",
                "网络搜索",
                "在线查",
                "上网查",
                "查一下网",
                "今天的天气",
                "今日天气",
                "天气预报",
                "现在气温",
                "当前气温",
                "今天空气质量",
                "今日空气质量",
                "现在空气质量",
                "当前空气质量",
                "实时空气质量",
            ],
        },
        weak: {
            regex: [/\b(recent|may have changed|up to date|newest)\b/],
            chineseTokens: ["最新版本", "最新动态", "新版本发布"],
        },
    },
    {
        capability: "search_memory",
        strong: {
            regex: [/\b(my notes|my vault|memory|in my notes|from my notes)\b/],
            chineseTokens: ["我的笔记", "笔记库", "我的记忆", "我写过", "我的文档", "我的资料"],
        },
        weak: {
            regex: [/\b(i wrote before|my materials|my docs|my documents)\b/],
            chineseTokens: ["以前写过", "之前记录", "笔记里写"],
        },
    },
    {
        capability: "get_current_note_context",
        strong: {
            regex: [/\b(current note|this note|opened file|active note)\b/],
            chineseTokens: ["当前笔记", "这篇笔记", "打开的文件", "正在编辑"],
        },
        weak: {
            regex: [/\b(this article|the content here|this document|selected text)\b/],
            chineseTokens: ["这篇文章", "这个文档", "选中的文字", "这一段", "光标处"],
        },
    },
];

function scoreCapability(
    text: string,
    table: CapabilitySignalTable,
): { confidence: number; reason: string } | null {
    const lower = text.toLowerCase();
    const strongHit = table.strong.regex.some((r) => r.test(lower))
        || table.strong.chineseTokens.some((t) => text.includes(t));
    if (strongHit) {
        return { confidence: 0.9, reason: `strong ${table.capability} signal` };
    }
    const weakHit = table.weak.regex.some((r) => r.test(lower))
        || table.weak.chineseTokens.some((t) => text.includes(t));
    if (weakHit) {
        return { confidence: 0.65, reason: `weak ${table.capability} signal` };
    }
    return null;
}

export function getExplicitlySuppressedRequiredCapabilities(text: string): Set<RequiredCapability> {
    const normalized = text.toLowerCase();
    const suppressed = new Set<RequiredCapability>();
    if (isExplicitNoWebRequest(text)
        || isExplicitCurrentNoteOnlyRequest(normalized)) {
        suppressed.add("webSearch");
    }
    if (/\b(do not|don't|without|no)\s+(answer\s+from\s+)?(use\s+)?(memory|my notes|my vault|notes from memory)\b/.test(normalized)
        || /\bdo not answer from memory\b/.test(normalized)
        || isExplicitCurrentNoteOnlyRequest(normalized)) {
        suppressed.add("search_memory");
    }
    return suppressed;
}

function isRequiredCapability(value: string): value is RequiredCapability {
    return value === "search_memory"
        || value === "webSearch"
        || value === "get_current_note_context";
}

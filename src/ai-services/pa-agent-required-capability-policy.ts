import type {
    PaAgentHostPolicy,
    PaAgentTurnSummary,
} from "./pa-agent-loop";
import {
    createAnswerCompletionLedger,
    decideAnswerCompletion,
    deriveAnswerCompletionTurnFacts,
    recordAnswerCompletionTurn,
    type AnswerCompletionLedger,
} from "./pa-agent-answer-completion-policy";

export const REQUIRED_CAPABILITY_CLASSIFIER_TIMEOUT_MS = 800;

export type RequiredCapability =
    | "search_memory"
    | "webSearch"
    | "get_current_note_context";

export type RequiredCapabilityLevel = "required" | "suggested" | "ignore";

export interface RequiredCapabilityClassificationItem {
    capability: RequiredCapability;
    confidence: number;
    reason: string;
    level: RequiredCapabilityLevel;
}

export interface RequiredCapabilityClassification {
    items: RequiredCapabilityClassificationItem[];
    metadata: {
        policyModelAvailable: boolean;
        classifierUsed: boolean;
        classifierTimedOut: boolean;
        fallbackUsed: boolean;
    };
}

export interface RequiredCapabilityHostPolicyOptions {
    userInput: string;
    availableCapabilities: ReadonlySet<RequiredCapability>;
    classification?: RequiredCapabilityClassification;
}

export interface RequiredCapabilityHostPolicyResult {
    hostPolicy: PaAgentHostPolicy;
    initialRuntimeInstruction?: string;
    classification: RequiredCapabilityClassification;
}

interface RequiredCapabilityRuntimeState {
    required: RequiredCapabilityClassificationItem[];
    suggested: RequiredCapabilityClassificationItem[];
    availableCapabilities: ReadonlySet<RequiredCapability>;
    usedCapabilities: Set<RequiredCapability>;
    correctiveAttempted: boolean;
    failedRequiredToolRetryAttempted: boolean;
    answerCompletionLedger: AnswerCompletionLedger;
}

export interface RequiredCapabilityClassifierInput {
    userInput: string;
    signal?: AbortSignal;
}

export interface RequiredCapabilityClassifier {
    classify(input: RequiredCapabilityClassifierInput): Promise<unknown>;
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
    options: RequiredCapabilityHostPolicyOptions,
): RequiredCapabilityHostPolicyResult {
    const classification = options.classification ?? classifyRequiredCapabilitiesDeterministic(options.userInput);
    const state: RequiredCapabilityRuntimeState = {
        required: classification.items.filter((item) => item.level === "required"),
        suggested: classification.items.filter((item) => item.level === "suggested"),
        availableCapabilities: options.availableCapabilities,
        usedCapabilities: new Set(),
        correctiveAttempted: false,
        failedRequiredToolRetryAttempted: false,
        answerCompletionLedger: createAnswerCompletionLedger(),
    };

    return {
        classification,
        initialRuntimeInstruction: buildInitialRuntimeInstruction(state),
        hostPolicy: {
            afterTurn: (summary) => decideAfterTurn(summary, state),
        },
    };
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

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeout = new Promise<"timeout">((resolve) => {
            timeoutId = setTimeout(() => {
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

        if (result === "timeout") {
            return withClassificationMetadata(fallback, {
                policyModelAvailable: true,
                classifierUsed: false,
                classifierTimedOut: true,
                fallbackUsed: true,
            });
        }

        const normalized = normalizeClassifierResult(result);
        if (!normalized) {
            return withClassificationMetadata(fallback, {
                policyModelAvailable: true,
                classifierUsed: false,
                classifierTimedOut: false,
                fallbackUsed: true,
            });
        }
        return applyUserExplicitCapabilityConstraints(normalized, options.userInput);
    } catch {
        return withClassificationMetadata(fallback, {
            policyModelAvailable: true,
            classifierUsed: false,
            classifierTimedOut: false,
            fallbackUsed: true,
        });
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        options.signal?.removeEventListener("abort", abortFromParent);
    }
}

function applyUserExplicitCapabilityConstraints(
    classification: RequiredCapabilityClassification,
    userInput: string,
): RequiredCapabilityClassification {
    const suppressed = getExplicitlySuppressedRequiredCapabilities(userInput);
    if (suppressed.size === 0) return classification;
    return {
        items: classification.items.filter((item) => !suppressed.has(item.capability)),
        metadata: classification.metadata,
    };
}

export function classifyRequiredCapabilitiesDeterministic(userInput: string): RequiredCapabilityClassification {
    const text = userInput.toLowerCase();
    const items: RequiredCapabilityClassificationItem[] = [];

    addItem(items, "webSearch", scoreWebSearch(text));
    addItem(items, "search_memory", scoreMemory(text));
    addItem(items, "get_current_note_context", scoreCurrentNote(text));

    return {
        items,
        metadata: {
            policyModelAvailable: false,
            classifierUsed: false,
            classifierTimedOut: false,
            fallbackUsed: true,
        },
    };
}

export function isExplicitCurrentNoteOnlyRequest(text: string): boolean {
    const normalized = text.toLowerCase();
    return /\b(current note|this note)\s+only\b/.test(normalized)
        || /\buse\s+(the\s+)?current note\s+only\b/.test(normalized);
}

function normalizeClassifierResult(result: unknown): RequiredCapabilityClassification | null {
    const parsed = typeof result === "string" ? parseJsonObject(result) : result;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { items?: unknown }).items)) {
        return null;
    }

    const items = (parsed as { items: unknown[] }).items
        .map(normalizeClassifierItem)
        .filter((item): item is RequiredCapabilityClassificationItem => Boolean(item));
    return {
        items,
        metadata: {
            policyModelAvailable: true,
            classifierUsed: true,
            classifierTimedOut: false,
            fallbackUsed: false,
        },
    };
}

function normalizeClassifierItem(value: unknown): RequiredCapabilityClassificationItem | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.capability !== "string" || !isRequiredCapability(record.capability)) return null;
    const confidence = typeof record.confidence === "number"
        ? Math.max(0, Math.min(1, record.confidence))
        : 0;
    const level = confidence >= 0.75
        ? "required"
        : confidence >= 0.45
            ? "suggested"
            : "ignore";
    if (level === "ignore") return null;
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

function withClassificationMetadata(
    classification: RequiredCapabilityClassification,
    metadata: RequiredCapabilityClassification["metadata"],
): RequiredCapabilityClassification {
    return {
        items: classification.items.map((item) => ({ ...item })),
        metadata,
    };
}

function decideAfterTurn(
    summary: PaAgentTurnSummary,
    state: RequiredCapabilityRuntimeState,
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    const facts = deriveAnswerCompletionTurnFacts(summary);
    recordUsedCapabilities(summary, state.usedCapabilities);
    recordAnswerCompletionTurn(state.answerCompletionLedger, summary, facts);

    const failedRequiredCapabilities = getFailedRequiredCapabilityNames(summary, state);
    if (failedRequiredCapabilities.length > 0) {
        if (!state.failedRequiredToolRetryAttempted && !state.correctiveAttempted) {
            state.failedRequiredToolRetryAttempted = true;
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
        return buildMissingRequiredDecision(summary, state, "required_capability_failed");
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
    if (completionDecision?.action === "stop_incomplete") {
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

    const missingRequired = state.required
        .filter((item) => !state.usedCapabilities.has(item.capability));
    const missingAvailable = missingRequired
        .filter((item) => state.availableCapabilities.has(item.capability));

    if (missingAvailable.length > 0 && !state.correctiveAttempted && !state.failedRequiredToolRetryAttempted) {
        state.correctiveAttempted = true;
        return {
            action: "continue",
            reason: "corrective_turn",
            runtimeInstruction: buildCorrectiveInstruction(missingAvailable),
        };
    }

    if (missingRequired.length > 0) {
        return buildMissingRequiredDecision(summary, state, "required_capability_missing");
    }

    return {
        action: "stop",
        reason: summary.status,
        status: summary.status === "completed_with_warning"
            ? "completed_with_warning"
            : summary.status === "aborted"
                ? "aborted"
                : summary.status === "error"
                    ? "error"
                    : summary.status === "incomplete"
                        ? "incomplete"
                        : "completed",
    };
}

function buildInitialRuntimeInstruction(state: RequiredCapabilityRuntimeState): string | undefined {
    const parts: string[] = [];
    const availableRequired = state.required
        .filter((item) => state.availableCapabilities.has(item.capability));
    const unavailableRequired = state.required
        .filter((item) => !state.availableCapabilities.has(item.capability));
    const suggested = state.suggested
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
    const missingRequired = state.required
        .filter((item) => !state.usedCapabilities.has(item.capability));
    const warnings = missingRequired.map((item) => ({
        type: "required_capability_missing",
        capability: item.capability,
        message: "Answer may be incomplete",
        detail: reason === "required_capability_failed" || state.failedRequiredToolRetryAttempted
            ? `${CAPABILITY_LABELS[item.capability]} was required but failed or was unavailable.`
            : `${CAPABILITY_LABELS[item.capability]} was required but was not used.`,
        metadata: {
            confidence: item.confidence,
            reason: item.reason,
            available: state.availableCapabilities.has(item.capability),
            correctiveAttempted: state.correctiveAttempted,
            failedRequiredToolRetryAttempted: state.failedRequiredToolRetryAttempted,
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
    const requiredNames = new Set(state.required.map((item) => item.capability));
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
    const level = score.confidence >= 0.75
        ? "required"
        : score.confidence >= 0.45
            ? "suggested"
            : "ignore";
    if (level === "ignore") return;
    items.push({
        capability,
        confidence: score.confidence,
        reason: score.reason,
        level,
    });
}

function scoreWebSearch(text: string): { confidence: number; reason: string } {
    if (/\b(search the web|look online|latest|today|official site|web search)\b/.test(text)
        || /\bcurrent (news|events|price|version|status|weather|release|information|info|situation)\b/.test(text)) {
        return { confidence: 0.9, reason: "strong web freshness signal" };
    }
    if (/\b(recent|may have changed|up to date|newest)\b/.test(text)) {
        return { confidence: 0.65, reason: "weak web freshness signal" };
    }
    return { confidence: 0, reason: "no web signal" };
}

export function getExplicitlySuppressedRequiredCapabilities(text: string): Set<RequiredCapability> {
    const normalized = text.toLowerCase();
    const suppressed = new Set<RequiredCapability>();
    if (/\b(do not|don't|without|no)\s+(use\s+)?(web\s*search|searching the web|web search results)\b/.test(normalized)
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

function scoreMemory(text: string): { confidence: number; reason: string } {
    if (/\b(my notes|my vault|memory|in my notes|from my notes)\b/.test(text)) {
        return { confidence: 0.9, reason: "strong Memory signal" };
    }
    if (/\b(i wrote before|my materials|my docs|my documents)\b/.test(text)) {
        return { confidence: 0.65, reason: "weak Memory signal" };
    }
    return { confidence: 0, reason: "no Memory signal" };
}

function scoreCurrentNote(text: string): { confidence: number; reason: string } {
    if (/\b(current note|this note|opened file|active note)\b/.test(text)) {
        return { confidence: 0.9, reason: "strong current-note signal" };
    }
    if (/\b(this article|the content here|this document|selected text)\b/.test(text)) {
        return { confidence: 0.65, reason: "weak current-note signal" };
    }
    return { confidence: 0, reason: "no current-note signal" };
}

function isRequiredCapability(value: string): value is RequiredCapability {
    return value === "search_memory"
        || value === "webSearch"
        || value === "get_current_note_context";
}

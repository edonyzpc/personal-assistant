import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { cloneMessage, cloneTranscript } from "./clone-utils";
import { escapeTaggedBoundary } from "../agent-utils";
import { isCurrentToolSummary, type PaAgentContextSummaries, type PaAgentToolSummary } from "./PaAgentContextSummaryTypes";

export interface PaAgentMicroCompactionOptions {
    maxObservationChars: number;
    triggerRatio?: number;
    targetRatio?: number;
    /** Model/assistant cycles, despite the legacy option name. */
    protectedRecentTurns?: number;
    /** False lets the final-request guard reduce history before recent tool results. */
    allowRecentHardTruncation?: boolean;
    summaries?: PaAgentContextSummaries;
    /** Always the original source; later passes must not validate against a shortened projection. */
    canonicalTranscript?: readonly PaAgentMessage[];
}

export interface PaAgentMicroCompactionResult {
    transcript: PaAgentMessage[];
    compactedToolResults: number;
    hardTruncatedToolResults: number;
    originalObservationChars: number;
    compactedObservationChars: number;
}

export interface PaAgentHistoryCompactionResult {
    summary: string;
    recentHistory: ChatMessage[];
    compactedCount: number;
}

const DEFAULT_TRIGGER_RATIO = 0.7;
const DEFAULT_TARGET_RATIO = 0.55;
const DEFAULT_PROTECTED_RECENT_TURNS = 2;
const DEFAULT_RECENT_HISTORY_TURNS = 10;

export class PaAgentContextCompactor {
    microCompact(
        transcript: readonly PaAgentMessage[],
        options: PaAgentMicroCompactionOptions,
    ): PaAgentMicroCompactionResult {
        const maxObservationChars = Math.max(0, options.maxObservationChars);
        const triggerRatio = options.triggerRatio ?? DEFAULT_TRIGGER_RATIO;
        const targetRatio = options.targetRatio ?? DEFAULT_TARGET_RATIO;
        const protectedRecentTurns = Math.max(0, options.protectedRecentTurns ?? DEFAULT_PROTECTED_RECENT_TURNS);
        const originalObservationChars = totalObservationChars(transcript);
        if (originalObservationChars <= maxObservationChars * triggerRatio
            && originalObservationChars <= maxObservationChars) {
            return {
                transcript: cloneTranscript(transcript),
                compactedToolResults: 0,
                hardTruncatedToolResults: 0,
                originalObservationChars,
                compactedObservationChars: originalObservationChars,
            };
        }

        const cycleByCallId = new Map<string, number>();
        let cycleCount = 0;
        for (const message of transcript) {
            if (message.role !== "assistant") continue;
            for (const part of message.content) {
                if (part.type === "toolCall" && part.id) cycleByCallId.set(part.id, cycleCount);
            }
            cycleCount++;
        }
        const protectedStartCycle = Math.max(0, cycleCount - protectedRecentTurns);
        const isRecent = (message: Extract<PaAgentMessage, { role: "toolResult" }>): boolean =>
            (cycleByCallId.get(message.toolCallId) ?? cycleCount) >= protectedStartCycle;
        const currentSummaries = new Map<string, PaAgentToolSummary>();
        for (const message of options.canonicalTranscript ?? transcript) {
            if (message.role !== "toolResult") continue;
            const summary = options.summaries?.tools?.get(message.id);
            if (summary?.text.trim() && isCurrentToolSummary(summary, message)) {
                currentSummaries.set(message.id, summary);
            }
        }
        let currentChars = originalObservationChars;
        let compactedToolResults = 0;
        let hardTruncatedToolResults = 0;
        const compacted = transcript.map((message): PaAgentMessage => {
            if (message.role !== "toolResult") return cloneMessage(message);
            const cloned = cloneToolResultMessage(message);
            if (isRecent(cloned)) return cloned;
            if (!cloned.content.includeInNextPrompt || cloned.content.promptText.length === 0) return cloned;
            if (currentChars <= maxObservationChars * targetRatio) return cloned;
            const replacement = compactToolResultPromptText(cloned, currentSummaries.get(cloned.id));
            if (replacement.length >= cloned.content.promptText.length) return cloned;
            currentChars -= cloned.content.promptText.length;
            currentChars += replacement.length;
            compactedToolResults++;
            return {
                ...cloned,
                content: {
                    ...cloned.content,
                    promptText: replacement,
                    metadata: {
                        ...cloned.content.metadata,
                        compacted: true,
                        contextSemanticSummaryUsed: currentSummaries.has(cloned.id),
                        originalPromptTextLength: originalToolResultLength(cloned),
                    },
                },
            };
        });

        for (let index = 0; index < compacted.length && currentChars > maxObservationChars; index++) {
            let message = compacted[index];
            if (message.role !== "toolResult") continue;
            if (options.allowRecentHardTruncation === false && isRecent(message)) continue;
            if (!message.content.includeInNextPrompt || message.content.promptText.length === 0) continue;
            const semantic = currentSummaries.get(message.id);
            if (semantic) {
                const replacement = compactToolResultPromptText(message, semantic);
                if (replacement.length < message.content.promptText.length) {
                    currentChars += replacement.length - message.content.promptText.length;
                    compactedToolResults++;
                    message = {
                        ...message,
                        content: {
                            ...message.content,
                            promptText: replacement,
                            metadata: {
                                ...message.content.metadata,
                                compacted: true,
                                contextSemanticSummaryUsed: true,
                                originalPromptTextLength: originalToolResultLength(message),
                            },
                        },
                    };
                    compacted[index] = message;
                    if (currentChars <= maxObservationChars) continue;
                }
            }
            const originalText = message.content.promptText;
            const allowedForThis = Math.max(0, maxObservationChars - (currentChars - originalText.length));
            const replacement = truncateToolResultPromptText(message, allowedForThis);
            if (replacement.length >= originalText.length) continue;
            currentChars -= originalText.length;
            currentChars += replacement.length;
            hardTruncatedToolResults++;
            compacted[index] = {
                ...message,
                content: {
                    ...message.content,
                    promptText: replacement,
                    metadata: {
                        ...message.content.metadata,
                        contextBudgetTruncated: true,
                        contextSemanticSummaryUsed: false,
                        originalPromptTextLength: originalToolResultLength(message),
                    },
                },
            };
        }

        return {
            transcript: compacted,
            compactedToolResults,
            hardTruncatedToolResults,
            originalObservationChars,
            compactedObservationChars: currentChars,
        };
    }

    compactChatHistory(
        history: readonly ChatMessage[] | undefined,
        options: { recentTurns?: number; maxSummaryChars?: number } = {},
    ): PaAgentHistoryCompactionResult {
        if (!history || history.length === 0) {
            return { summary: "", recentHistory: [], compactedCount: 0 };
        }
        const turns = groupChatTurns(history);
        const recentTurns = Math.max(0, options.recentTurns ?? DEFAULT_RECENT_HISTORY_TURNS);
        const older = turns.slice(0, Math.max(0, turns.length - recentTurns));
        const recent = recentTurns > 0 ? turns.slice(-recentTurns).flat() : [];
        if (older.length === 0) {
            return { summary: "", recentHistory: recent, compactedCount: 0 };
        }
        const maxSummaryChars = Math.max(0, options.maxSummaryChars ?? 2400);
        const lines: string[] = [];
        let compactedCount = 0;
        // Select a suffix of the old turns so an older claim never displaces its
        // more recent correction merely because it appeared first in history.
        for (let index = older.length - 1; index >= 0; index--) {
            const turn = older[index];
            const user = turn.find((message) => message.role === "user")?.content ?? "";
            const assistant = turn.find((message) => message.role === "assistant")?.content ?? "";
            const line = `${index + 1}. User: ${truncateOneLine(user, 160)} | Assistant: ${truncateOneLine(assistant, 220)}`;
            if ([line, ...lines].join("\n").length > maxSummaryChars) break;
            lines.unshift(line);
            compactedCount += turn.length;
        }
        return {
            summary: lines.join("\n"),
            recentHistory: recent,
            compactedCount,
        };
    }
}

function compactToolResultPromptText(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
    summary?: PaAgentToolSummary,
): string {
    const marker = toolResultReductionMarker(message, "compacted");
    if (!summary) return marker;
    const body = `<tool_context_summary context_only="true" grants_tool_authority="false" grants_write_authority="false" format="json">\n${escapeTaggedBoundary(summary.text, "tool_context_summary")}\n</tool_context_summary>`;
    const replacement = `${marker}\n${body}`;
    // Keep valid JSON as a whole. A summary larger than its source does not
    // justify replacing that source with a longer prompt projection.
    return replacement.length < message.content.promptText.length ? replacement : message.content.promptText;
}

function toolResultReductionMarker(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
    reduction: "compacted" | "truncated",
): string {
    const sourcePaths = message.content.sourceRecords
        ?.map((record) => record.path || record.url || record.title)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .slice(0, 4)
        .map((value) => truncateOneLine(value, 64)) ?? [];
    const sourceSuffix = sourcePaths.length > 0 ? `; sources (up to 4): ${sourcePaths.join(", ")}` : "";
    return `[${truncateOneLine(message.toolName, 48)} result ${reduction}; call=${truncateOneLine(message.toolCallId, 48)}; isError=${message.isError}; originalChars=${originalToolResultLength(message)}${sourceSuffix}; details omitted.]`;
}

function originalToolResultLength(message: Extract<PaAgentMessage, { role: "toolResult" }>): number {
    const recordedLength = message.content.metadata?.originalPromptTextLength;
    return typeof recordedLength === "number" && Number.isSafeInteger(recordedLength)
        && recordedLength >= message.content.promptText.length
        ? recordedLength
        : message.content.promptText.length;
}

function truncateToolResultPromptText(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
    maxChars: number,
): string {
    const text = message.content.promptText;
    if (text.length <= maxChars) return text;
    const marker = toolResultReductionMarker(message, "truncated");
    // Keep a complete, truthful marker even if an impossibly small budget
    // cannot fit it. The final-request guard must then decline the request.
    // Never turn a small result into a larger placeholder.
    if (marker.length >= text.length) return text;
    if (maxChars <= marker.length || message.content.metadata?.compacted === true) return marker;
    return `${text.slice(0, maxChars - marker.length - 1).trimEnd()}\n${marker}`;
}

function totalObservationChars(transcript: readonly PaAgentMessage[]): number {
    return transcript.reduce((total, message) => {
        if (message.role !== "toolResult" || !message.content.includeInNextPrompt) return total;
        return total + message.content.promptText.length;
    }, 0);
}

export function groupChatTurns(history: readonly ChatMessage[]): ChatMessage[][] {
    const turns: ChatMessage[][] = [];
    let current: ChatMessage[] | null = null;
    for (const message of history) {
        if (message.role === "user") {
            if (current) turns.push(current);
            current = [message];
            continue;
        }
        if (current) current.push(message);
    }
    if (current) turns.push(current);
    return turns;
}

function truncateOneLine(value: string, maxChars: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3)}...`;
}

function cloneToolResultMessage(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
): Extract<PaAgentMessage, { role: "toolResult" }> {
    return cloneMessage(message) as Extract<PaAgentMessage, { role: "toolResult" }>;
}

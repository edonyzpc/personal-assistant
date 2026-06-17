import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { cloneMessage, cloneTranscript } from "./clone-utils";

export interface PaAgentMicroCompactionOptions {
    maxObservationChars: number;
    triggerRatio?: number;
    targetRatio?: number;
    protectedRecentTurns?: number;
}

export interface PaAgentMicroCompactionResult {
    transcript: PaAgentMessage[];
    compactedToolResults: number;
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
        if (maxObservationChars <= 0 || originalObservationChars <= maxObservationChars * triggerRatio) {
            return {
                transcript: cloneTranscript(transcript),
                compactedToolResults: 0,
                originalObservationChars,
                compactedObservationChars: originalObservationChars,
            };
        }

        const protectedStartTurn = Math.max(0, countUserTurns(transcript) - protectedRecentTurns);
        let currentChars = originalObservationChars;
        let compactedToolResults = 0;
        let currentTurn = -1;
        const compacted = transcript.map((message): PaAgentMessage => {
            if (message.role === "user") currentTurn++;
            if (message.role !== "toolResult") return cloneMessage(message);
            const cloned = cloneToolResultMessage(message);
            if (currentTurn >= protectedStartTurn) return cloned;
            if (!cloned.content.includeInNextPrompt || cloned.content.promptText.length === 0) return cloned;
            if (currentChars <= maxObservationChars * targetRatio) return cloned;
            const replacement = compactToolResultPromptText(cloned);
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
                        originalPromptTextLength: cloned.content.promptText.length,
                    },
                },
            };
        });

        for (let index = 0; index < compacted.length && currentChars > maxObservationChars; index++) {
            const message = compacted[index];
            if (message.role !== "toolResult") continue;
            if (!message.content.includeInNextPrompt || message.content.promptText.length === 0) continue;
            const originalText = message.content.promptText;
            const allowedForThis = Math.max(0, maxObservationChars - (currentChars - originalText.length));
            const replacement = truncateToolResultPromptText(message, allowedForThis);
            if (replacement.length >= originalText.length) continue;
            currentChars -= originalText.length;
            currentChars += replacement.length;
            compacted[index] = {
                ...message,
                content: {
                    ...message.content,
                    promptText: replacement,
                    metadata: {
                        ...message.content.metadata,
                        contextBudgetTruncated: true,
                        originalPromptTextLength: message.content.metadata?.originalPromptTextLength
                            ?? originalText.length,
                    },
                },
            };
        }

        return {
            transcript: compacted,
            compactedToolResults,
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
        const recentTurns = Math.max(1, options.recentTurns ?? DEFAULT_RECENT_HISTORY_TURNS);
        const older = turns.slice(0, Math.max(0, turns.length - recentTurns));
        const recent = turns.slice(-recentTurns).flat();
        if (older.length === 0) {
            return { summary: "", recentHistory: recent, compactedCount: 0 };
        }
        const maxSummaryChars = Math.max(200, options.maxSummaryChars ?? 2400);
        const summary = older
            .map((turn, index) => {
                const user = turn.find((message) => message.role === "user")?.content ?? "";
                const assistant = turn.find((message) => message.role === "assistant")?.content ?? "";
                return `${index + 1}. User: ${truncateOneLine(user, 160)} | Assistant: ${truncateOneLine(assistant, 220)}`;
            })
            .join("\n")
            .slice(0, maxSummaryChars);
        return {
            summary,
            recentHistory: recent,
            compactedCount: older.flat().length,
        };
    }
}

function compactToolResultPromptText(message: Extract<PaAgentMessage, { role: "toolResult" }>): string {
    const sourcePaths = message.content.sourceRecords
        ?.map((record) => record.path || record.url || record.title)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .slice(0, 4) ?? [];
    const sourceSuffix = sourcePaths.length > 0 ? ` from ${sourcePaths.join(", ")}` : "";
    return `[Earlier ${message.toolName} result compacted${sourceSuffix}. Source metadata is still available.]`;
}

function truncateToolResultPromptText(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
    maxChars: number,
): string {
    const compacted = compactToolResultPromptText(message);
    if (maxChars <= 0) return "";
    if (maxChars <= compacted.length) return compacted.slice(0, maxChars);
    const text = message.content.promptText;
    if (text.length <= maxChars) return text;
    const suffix = "\n[...truncated by context budget]";
    if (maxChars <= suffix.length) return text.slice(0, maxChars);
    return `${text.slice(0, maxChars - suffix.length).trimEnd()}${suffix}`;
}

function totalObservationChars(transcript: readonly PaAgentMessage[]): number {
    return transcript.reduce((total, message) => {
        if (message.role !== "toolResult" || !message.content.includeInNextPrompt) return total;
        return total + message.content.promptText.length;
    }, 0);
}

function countUserTurns(transcript: readonly PaAgentMessage[]): number {
    return transcript.filter((message) => message.role === "user").length;
}

function groupChatTurns(history: readonly ChatMessage[]): ChatMessage[][] {
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
    return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}...`;
}

function cloneToolResultMessage(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
): Extract<PaAgentMessage, { role: "toolResult" }> {
    return cloneMessage(message) as Extract<PaAgentMessage, { role: "toolResult" }>;
}

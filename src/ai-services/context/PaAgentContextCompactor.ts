import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { cloneTranscriptSteps, finishContextSteps } from "./clone-utils";
import { isCurrentToolSummary, type PaAgentContextSummaries } from "./PaAgentContextSummaryTypes";
import { encodeToolResultTextSteps } from './PaAgentContextTextEncoding';
import { summarizableReadOnlyResultIds } from '../pa-agent-action-history';

export interface PaAgentMicroCompactionOptions {
    maxObservationChars: number;
    triggerRatio?: number;
    targetRatio?: number;
    /** Model/assistant cycles, despite the legacy option name. */
    protectedRecentTurns?: number;
    /** Compatibility option: tool bodies are never hard-truncated. */
    allowRecentHardTruncation?: boolean;
    /** Accepted summaries may replace older successful read-only observations. */
    summaries?: PaAgentContextSummaries;
    /** Compatibility source snapshot; reversible encoding preserves the supplied text exactly. */
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

/** Preparation receipts, effect facts, unresolved observations and recent cycles remain exact. */
export function getPaAgentToolSummaryCandidates(transcript: readonly PaAgentMessage[], protectedRecentTurns = 2):
    Array<Extract<PaAgentMessage, { role: 'toolResult' }>> {
    const readonlyIds = summarizableReadOnlyResultIds(transcript);
    const cycles = new Map<string, number>();
    let cycle = 0;
    for (const message of transcript) {
        if (message.role === 'assistant') {
            for (const part of message.content) if (part.type === 'toolCall' && part.id) cycles.set(part.id, cycle);
            cycle++;
        }
    }
    const protectedStart = Math.max(0, cycle - protectedRecentTurns);
    return transcript.filter((message): message is Extract<PaAgentMessage, { role: 'toolResult' }> =>
        message.role === 'toolResult' && readonlyIds.has(message.id) && message.toolName !== 'get_writing_context'
        && (cycles.get(message.toolCallId) ?? cycle) < protectedStart);
}

export class PaAgentContextCompactor {
    microCompact(
        transcript: readonly PaAgentMessage[],
        options: PaAgentMicroCompactionOptions,
    ): PaAgentMicroCompactionResult {
        return finishContextSteps(this.microCompactSteps(transcript, options));
    }

    *microCompactSteps(
        transcript: readonly PaAgentMessage[],
        options: PaAgentMicroCompactionOptions,
    ): Generator<void, PaAgentMicroCompactionResult, void> {
        const maxObservationChars = Math.max(0, options.maxObservationChars);
        const triggerRatio = options.triggerRatio ?? DEFAULT_TRIGGER_RATIO;
        const targetRatio = options.targetRatio ?? DEFAULT_TARGET_RATIO;
        const protectedRecentTurns = Math.max(0, options.protectedRecentTurns ?? DEFAULT_PROTECTED_RECENT_TURNS);
        let originalObservationChars = 0;
        for (const message of transcript) {
            yield;
            if (message.role === "toolResult" && message.content.includeInNextPrompt) {
                originalObservationChars += message.content.promptText.length;
            }
        }
        if (!options.summaries?.tools?.size && originalObservationChars <= maxObservationChars * triggerRatio
            && originalObservationChars <= maxObservationChars) {
            return {
                transcript: yield* cloneTranscriptSteps(transcript),
                compactedToolResults: 0,
                hardTruncatedToolResults: 0,
                originalObservationChars,
                compactedObservationChars: originalObservationChars,
            };
        }

        const cycleByCallId = new Map<string, number>();
        let cycleCount = 0;
        for (const message of transcript) {
            yield;
            if (message.role !== "assistant") continue;
            for (const part of message.content) {
                if (part.type === "toolCall" && part.id) cycleByCallId.set(part.id, cycleCount);
            }
            cycleCount++;
        }
        const protectedStartCycle = Math.max(0, cycleCount - protectedRecentTurns);
        const isRecent = (message: Extract<PaAgentMessage, { role: "toolResult" }>): boolean =>
            (cycleByCallId.get(message.toolCallId) ?? cycleCount) >= protectedStartCycle;
        let currentChars = originalObservationChars;
        let compactedToolResults = 0;
        const compacted = yield* cloneTranscriptSteps(transcript);
        const summaryCandidates = new Set(getPaAgentToolSummaryCandidates(transcript, protectedRecentTurns).map(message => message.id));
        for (const [index, message] of compacted.entries()) {
            yield;
            if (message.role !== 'toolResult' || !summaryCandidates.has(message.id)) continue;
            const summary = options.summaries?.tools?.get(message.id);
            if (!summary?.text.trim() || !isCurrentToolSummary(summary, message)) continue;
            const replacement = `<tool_observation_summary context_only="true">\n${summary.text.replace(/<\/tool_observation_summary/gi, '<\\/tool_observation_summary')}\n</tool_observation_summary>`;
            if (replacement.length >= message.content.promptText.length) continue;
            currentChars += replacement.length - message.content.promptText.length;
            compactedToolResults++;
            compacted[index] = { ...message, content: { ...message.content, promptText: replacement,
                metadata: { ...message.content.metadata, compacted: true, contextSemanticSummaryUsed: true,
                    originalPromptTextLength: originalToolResultLength(message) } } };
        }
        // Prefer older results. Recent evidence is also safe to encode when it
        // cannot fit or the Manager requests a stronger envelope projection.
        for (const recentPass of [false, true]) {
            for (const [index, message] of compacted.entries()) {
                yield;
                if (currentChars <= maxObservationChars * targetRatio) break;
                if (message.role !== 'toolResult' || isRecent(message) !== recentPass
                    || !message.content.includeInNextPrompt || !message.content.promptText
                    || message.content.metadata?.contextLosslessEncodingUsed === true
                    || message.content.metadata?.contextSemanticSummaryUsed === true) continue;
                if (recentPass && currentChars <= maxObservationChars && triggerRatio !== 0) continue;
                const replacement = yield* encodeToolResultTextSteps(message.content.promptText);
                if (!replacement) continue;
                currentChars += replacement.length - message.content.promptText.length;
                compactedToolResults++;
                compacted[index] = { ...message, content: { ...message.content, promptText: replacement,
                    metadata: { ...message.content.metadata, compacted: true,
                        contextSemanticSummaryUsed: false, contextLosslessEncodingUsed: true,
                        originalPromptTextLength: originalToolResultLength(message) } } };
            }
        }

        return {
            transcript: compacted,
            compactedToolResults,
            hardTruncatedToolResults: 0,
            originalObservationChars,
            compactedObservationChars: currentChars,
        };
    }

    compactChatHistory(
        history: readonly ChatMessage[] | undefined,
        options: { recentTurns?: number; maxSummaryChars?: number } = {},
    ): PaAgentHistoryCompactionResult {
        return finishContextSteps(this.compactChatHistorySteps(history, options));
    }

    *compactChatHistorySteps(
        history: readonly ChatMessage[] | undefined,
        options: { recentTurns?: number; maxSummaryChars?: number } = {},
    ): Generator<void, PaAgentHistoryCompactionResult, void> {
        if (!history || history.length === 0) {
            return { summary: "", recentHistory: [], compactedCount: 0 };
        }
        const turns = yield* groupChatTurnsSteps(history);
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
            yield;
            const turn = older[index];
            const user = turn.find((message) => message.role === "user")?.content ?? "";
            const assistant = turn.find((message) => message.role === "assistant")?.content ?? "";
            const images = turn.flatMap((message) => message.images ?? []);
            const imageIndex = images.length ? ` | Image references (not pixels): ${JSON.stringify(images)}` : "";
            const line = `${index + 1}. User: ${truncateOneLine(user, 160)} | Assistant: ${truncateOneLine(assistant, 220)}${imageIndex}`;
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

function originalToolResultLength(message: Extract<PaAgentMessage, { role: "toolResult" }>): number {
    const recordedLength = message.content.metadata?.originalPromptTextLength;
    return typeof recordedLength === "number" && Number.isSafeInteger(recordedLength)
        && recordedLength >= message.content.promptText.length
        ? recordedLength
        : message.content.promptText.length;
}

export function groupChatTurns(history: readonly ChatMessage[]): ChatMessage[][] {
    return finishContextSteps(groupChatTurnsSteps(history));
}

export function* groupChatTurnsSteps(history: readonly ChatMessage[]): Generator<void, ChatMessage[][], void> {
    const turns: ChatMessage[][] = [];
    let current: ChatMessage[] | null = null;
    for (const message of history) {
        yield;
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

import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { PaAgentContextCompactor } from "./PaAgentContextCompactor";

export interface PaAgentInjectedContext {
    userProfile?: string;
    vaultInsights?: string;
}

export interface PaAgentProjectedInputOptions {
    prompt: string;
    chatHistory?: ChatMessage[];
    hostContext?: string;
    runtimeInstruction?: string;
    injectedContext?: PaAgentInjectedContext;
    maxHistoryChars: number;
}

export interface PaAgentProjectedHistory {
    text: string;
    compactedCount: number;
    summaryChars: number;
}

export class PaAgentContextProjector {
    private readonly compactor: PaAgentContextCompactor;
    private previousInjectedContextKey: string | null = null;

    constructor(compactor = new PaAgentContextCompactor()) {
        this.compactor = compactor;
    }

    projectUserInput(options: PaAgentProjectedInputOptions): { input: string; history: PaAgentProjectedHistory } {
        const history = this.projectHistory(options.chatHistory, options.maxHistoryChars);
        const currentInjected = formatInjectedContext(options.injectedContext);
        let injected: string;
        if (currentInjected && currentInjected === this.previousInjectedContextKey) {
            injected = "[Personal context unchanged from previous turn]";
        } else {
            injected = currentInjected;
            this.previousInjectedContextKey = currentInjected;
        }
        const runtimeInstruction = options.runtimeInstruction
            ? `\n\n<runtime_instruction>\n${options.runtimeInstruction}\n</runtime_instruction>`
            : "";
        const input = [
            history.text ? `Recent chat history:\n${history.text}` : "",
            options.hostContext ? `Host context:\n${options.hostContext}` : "",
            injected ? `Personal context:\n${injected}` : "",
            `User input:\n${options.prompt}${runtimeInstruction}`,
        ].filter(Boolean).join("\n\n");
        return { input, history };
    }

    annotateOrigins(transcript: readonly PaAgentMessage[]): Array<{ id: string; origin: string }> {
        return transcript.map((message) => ({
            id: message.id,
            origin: message.role === "toolResult" ? "tool_result" : message.role,
        }));
    }

    private projectHistory(history: ChatMessage[] | undefined, maxHistoryChars: number): PaAgentProjectedHistory {
        const compacted = this.compactor.compactChatHistory(history);
        let summary = compacted.summary;
        let recentHistory = [...compacted.recentHistory];

        while (summary || recentHistory.length > 0) {
            const text = formatProjectedHistory(summary, recentHistory);
            if (text.length <= maxHistoryChars) {
                return { text, compactedCount: compacted.compactedCount, summaryChars: summary.length };
            }
            if (recentHistory.length > 2) {
                recentHistory = recentHistory.slice(2);
                continue;
            }
            if (recentHistory.length > 0) {
                recentHistory = [];
                continue;
            }
            if (summary.length > 0) {
                summary = summary.slice(0, Math.max(0, summary.length - 500)).trim();
                continue;
            }
            break;
        }
        return {
            text: "",
            compactedCount: compacted.compactedCount,
            summaryChars: 0,
        };
    }
}

function formatProjectedHistory(summary: string, history: ChatMessage[]): string {
    const summaryText = summary
        ? `<compaction_summary context_only="true">\n${escapeTaggedBoundary(summary, "compaction_summary")}\n</compaction_summary>`
        : "";
    const recentText = formatChatHistory(history);
    return [summaryText, recentText].filter(Boolean).join("\n\n");
}

function formatChatHistory(history: ChatMessage[]): string {
    if (history.length === 0) return "";
    const body = JSON.stringify(
        history.map((message) => ({
            role: message.role,
            content: message.content,
        })),
        null,
        2,
    );
    return `<chat_history context_only="true" format="json">\n${escapeTaggedBoundary(body, "chat_history")}\n</chat_history>`;
}

function formatInjectedContext(context: PaAgentInjectedContext | undefined): string {
    if (!context) return "";
    const blocks = [
        context.userProfile?.trim()
            ? `<user_profile context_only="true" source="memory_extraction">\n${escapeTaggedBoundary(context.userProfile.trim(), "user_profile")}\n</user_profile>`
            : "",
        context.vaultInsights?.trim()
            ? `<vault_insights context_only="true" source="memory_extraction">\n${escapeTaggedBoundary(context.vaultInsights.trim(), "vault_insights")}\n</vault_insights>`
            : "",
    ].filter(Boolean);
    return blocks.join("\n\n");
}

function escapeTaggedBoundary(value: string, tagName: string): string {
    const pattern = new RegExp(`</${tagName}`, "gi");
    return value.replace(pattern, `<\\/${tagName}`);
}

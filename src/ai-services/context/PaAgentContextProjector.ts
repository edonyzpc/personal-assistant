import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { sanitizeUserProfileMarkdownForPrompt } from "../memory-extraction/type-a-extractor";
import { PaAgentContextCompactor } from "./PaAgentContextCompactor";

export interface PaAgentInjectedContext {
    /** Select exactly one Memory projection path for this prompt. */
    memoryContextMode?: "legacy" | "governed";
    userProfile?: string;
    vaultInsights?: string;
    /** Bounded output from the governed Memory selector; context only. */
    governedMemoryContext?: string;
    /** UI-only trace; never serialized into the model prompt. */
    governedMemoryTrace?: Array<{
        claimId: string;
        effect: "future_answers" | "collaboration_default";
        source?: "notes" | "interactions" | "settings" | "mixed";
        scope?: "current_vault" | "same_device";
        sourcePaths?: string[];
    }>;
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

    constructor(compactor = new PaAgentContextCompactor()) {
        this.compactor = compactor;
    }

    projectUserInput(options: PaAgentProjectedInputOptions): { input: string; history: PaAgentProjectedHistory } {
        const history = this.projectHistory(options.chatHistory, options.maxHistoryChars);
        const injected = formatInjectedContext(options.injectedContext);
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
    const governedMemoryContext = context.governedMemoryContext?.trim();
    if (context.memoryContextMode === "governed" || (
        context.memoryContextMode === undefined && governedMemoryContext
    )) {
        // An explicitly governed prompt never falls back to legacy fields,
        // including when the governed selector intentionally returns empty.
        if (!governedMemoryContext) return "";
        return `<governed_memory_projection context_only="true" source="memory_governance" grants_tool_authority="false" grants_write_authority="false" grants_network_authority="false" grants_external_action_authority="false">\n${escapeTaggedBoundary(
            governedMemoryContext.slice(0, 6_000),
            "governed_memory_projection",
        )}\n</governed_memory_projection>`;
    }
    const userProfile = context.userProfile
        ? sanitizeUserProfileMarkdownForPrompt(context.userProfile)
        : "";
    const blocks = [
        userProfile
            ? `<user_profile context_only="true" source="memory_extraction">\n${escapeTaggedBoundary(userProfile, "user_profile")}\n</user_profile>`
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

import type { PaAgentMessage } from "../chat-types";
import { cloneMessage } from "./clone-utils";

const STATUS_ONLY_OUTCOMES = new Set(["duplicate_skipped", "policy_rejected"]);

export interface PaAgentContextHygieneResult {
    transcript: PaAgentMessage[];
    removedEmptyAssistantMessages: number;
    hiddenStatusOnlyToolResults: number;
    removedOrphanToolResults: number;
}

export class PaAgentContextHygiene {
    clean(transcript: readonly PaAgentMessage[]): PaAgentContextHygieneResult {
        const toolCallIds = new Set<string>();
        for (const message of transcript) {
            if (message.role !== "assistant") continue;
            for (const part of message.content) {
                if (part.type === "toolCall" && part.id) {
                    toolCallIds.add(part.id);
                }
            }
        }

        let removedEmptyAssistantMessages = 0;
        let hiddenStatusOnlyToolResults = 0;
        let removedOrphanToolResults = 0;
        const cleaned: PaAgentMessage[] = [];

        for (const message of transcript) {
            if (message.role === "assistant" && message.content.length === 0) {
                removedEmptyAssistantMessages++;
                continue;
            }
            if (message.role === "toolResult") {
                if (message.toolCallId && !toolCallIds.has(message.toolCallId)) {
                    removedOrphanToolResults++;
                    continue;
                }
                const outcome = typeof message.content.metadata?.outcome === "string"
                    ? message.content.metadata.outcome
                    : "";
                if (STATUS_ONLY_OUTCOMES.has(outcome)) {
                    hiddenStatusOnlyToolResults++;
                    cleaned.push({
                        ...message,
                        content: {
                            ...message.content,
                            promptText: "",
                            includeInNextPrompt: false,
                            metadata: {
                                ...message.content.metadata,
                                hygieneHiddenFromPrompt: true,
                            },
                        },
                    });
                    continue;
                }
            }
            cleaned.push(cloneMessage(message));
        }

        return {
            transcript: cleaned,
            removedEmptyAssistantMessages,
            hiddenStatusOnlyToolResults,
            removedOrphanToolResults,
        };
    }
}

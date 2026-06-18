import { AgentEventEmitter } from "./agent-runtime-primitives";
import { extractCanonicalTurnMetadata } from "./pa-agent-history";
import type {
    AgentEvent,
    AssistantMessagePart,
    ChatAgentStatus,
    PaAgentMessage,
} from "./chat-types";

/**
 * Translates canonical PaAgentLoop lifecycle events into the v1 LegacyAgentEvent stream
 * that the existing chat-view UI subscribes to via `options.onEvent`. Holds the per-turn
 * cumulative state (canonical message map / committed legacy snapshot / metadata-emitted
 * latch) that previously lived as closure variables inside `streamPaAgentCanonicalTurn`.
 */
export class CanonicalToLegacyEventAdapter {
    private readonly canonicalMessages = new Map<string, PaAgentMessage>();
    private committedLegacySnapshot = "";
    private legacyMetadataEmitted = false;

    constructor(
        private readonly legacyEvents: AgentEventEmitter,
        private readonly onLifecycleEvent?: (event: AgentEvent) => void,
    ) {}

    handle(event: AgentEvent): void {
        this.onLifecycleEvent?.(event);
        switch (event.type) {
            case "agent_start":
                this.legacyEvents.activity("loop-start", "Starting assistant loop");
                return;
            case "turn_start":
                this.legacyEvents.activity("loop-start", "Deciding what context to use", {
                    legacyStatus: { type: "thinking" } satisfies ChatAgentStatus,
                });
                return;
            case "message_start":
                this.canonicalMessages.set(event.message.id, event.message);
                return;
            case "message_update":
                if (event.update.kind === "thinking_delta") {
                    this.legacyEvents.reasoningChunk(event.update.text);
                }
                return;
            case "message_end":
                this.canonicalMessages.set(event.message.id, event.message);
                if (event.message.role !== "assistant") return;
                if (event.message.content.some((part) => part.type === "toolCall")) return;
                this.appendAssistantText(event.message.content);
                return;
            case "tool_execution_start":
                this.legacyEvents.activity("tool-running", `Running ${event.toolName}`, {
                    legacyStatus: {
                        type: "tool-running",
                        tool: event.toolName,
                        message: `Running ${event.toolName}`,
                    } satisfies ChatAgentStatus,
                });
                return;
            case "tool_execution_end":
                this.legacyEvents.activity("tool-done", `${event.toolName} finished`, {
                    legacyStatus: event.outcome === "success"
                        ? {
                            type: "tool-done",
                            tool: event.toolName,
                            message: `${event.toolName} finished`,
                            sources: [],
                        } satisfies ChatAgentStatus
                        : {
                            type: "tool-skipped",
                            tool: event.toolName,
                            reason: `${event.toolName} did not complete successfully.`,
                        } satisfies ChatAgentStatus,
                });
                return;
            case "turn_end":
                for (const toolResult of event.toolResults ?? []) {
                    this.canonicalMessages.set(toolResult.id, toolResult);
                }
                return;
            case "agent_end":
                this.emitLegacyMetadata();
                if (event.status === "aborted") {
                    this.legacyEvents.aborted();
                } else if (event.status === "error") {
                    this.legacyEvents.partialOutputError("Error");
                } else {
                    this.legacyEvents.answerComplete();
                }
                return;
            case "tool_execution_update":
                return;
        }
    }

    private appendAssistantText(content: AssistantMessagePart[]): void {
        const finalText = content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
        if (!finalText) return;
        if (!this.committedLegacySnapshot) {
            this.legacyEvents.answerStarted();
        }
        this.committedLegacySnapshot += finalText;
        this.legacyEvents.answerSnapshot(this.committedLegacySnapshot);
    }

    private emitLegacyMetadata(): void {
        if (this.legacyMetadataEmitted) return;
        this.legacyMetadataEmitted = true;
        const metadata = extractCanonicalTurnMetadata({ messages: [...this.canonicalMessages.values()] });
        if (
            metadata.hasMemoryContent
            || (metadata.contextUsed?.length ?? 0) > 0
            || (metadata.sourceRecords?.length ?? 0) > 0
        ) {
            this.legacyEvents.turnMetadata(metadata);
        }
    }
}

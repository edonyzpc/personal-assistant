import { AgentEventEmitter } from "./agent-runtime-primitives";
import { extractCanonicalTurnMetadata } from "./pa-agent-history";
import { cloneChatWritingRequest, decodeWritingOutput } from "./writing-output";
import { cloneMessageImages, type MessageImage } from "../chat/image-types";
import type {
    AgentEvent,
    AssistantMessagePart,
    ChatAgentStatus,
    PaAgentMessage,
    ChatWritingRequest,
    WritingRecoveryReason,
} from "./chat-types";

export interface WritingEventContext {
    request: ChatWritingRequest;
    maxTextChars: number;
    /** Host-owned current source/run guard, never model evidence. */
    isCurrent: () => boolean;
    getStyleRevisionIds?: () => readonly string[];
    /** Frozen host provenance, independent of the model envelope and provider pixel subset. */
    getAssociatedImages?: () => readonly MessageImage[];
}

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
    private ended = false;
    private runId?: string;
    private writingCandidate?: Extract<PaAgentMessage, { role: "assistant" }>;
    private readonly writing?: WritingEventContext;

    constructor(
        private readonly legacyEvents: AgentEventEmitter,
        private readonly onLifecycleEvent?: (event: AgentEvent) => void,
        writing?: WritingEventContext,
    ) {
        this.writing = writing ? { ...writing, request: cloneChatWritingRequest(writing.request) } : undefined;
    }

    handle(event: AgentEvent): void {
        if (this.ended) return;
        this.runId ??= event.runId;
        if (event.runId !== this.runId) return;
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
                if (event.message.role === "assistant") this.writingCandidate = undefined;
                return;
            case "message_update":
                if (event.update.kind === "thinking_delta") {
                    this.legacyEvents.reasoningChunk(event.update.text);
                }
                return;
            case "message_end":
                this.canonicalMessages.set(event.message.id, event.message);
                if (event.message.role !== "assistant") return;
                if (this.writing) {
                    this.writingCandidate = { ...event.message, content: event.message.content.map((part) => ({ ...part })) };
                    return;
                }
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
                this.ended = true;
                this.emitLegacyMetadata();
                if (this.writing) this.emitWritingResult(event);
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

    private emitWritingResult(event: Extract<AgentEvent, { type: "agent_end" }>): void {
        const writing = this.writing!;
        const candidate = this.writingCandidate;
        const rawText = candidate?.content.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
        let reason: WritingRecoveryReason | undefined;
        // A warning's impact is unknown here. It must not silently become a verified version.
        if (event.status !== "completed" || !candidate || candidate.stopReason !== "stop"
            || candidate.content.some((part) => part.type === "toolCall")) reason = "incomplete";
        else if (candidate.providerCompletion !== "stop") reason = "provider_incomplete";
        else {
            try { if (!writing.isCurrent()) reason = "source_changed"; }
            catch { reason = "source_changed"; }
        }
        const output = reason ? undefined : decodeWritingOutput(rawText, writing.request, writing.maxTextChars);
        const material = writing.getAssociatedImages ? { associatedImages: cloneMessageImages(writing.getAssociatedImages()) } : {};
        if (!output) {
            this.legacyEvents.writingRecovery({ runId: event.runId, requestId: writing.request.requestId,
                ...(candidate ? { messageId: candidate.id } : {}), rawText, reason: reason ?? "invalid_output", ...material });
            return;
        }
        this.legacyEvents.writingArtifact({ runId: event.runId, requestId: output.requestId,
            messageId: candidate!.id, body: output.body, explanation: output.explanation, ...material,
            ...(writing.getStyleRevisionIds ? { styleRevisionIds: [...writing.getStyleRevisionIds()] } : {}) });
        this.appendAssistantText([{ type: "text", text: output.body }]);
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

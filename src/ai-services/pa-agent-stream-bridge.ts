import { AgentEventEmitter } from "./agent-runtime-primitives";
import { extractCanonicalTurnMetadata } from "./pa-agent-history";
import { cloneChatWritingRequest, decodeNativeWritingOutput, decodeWritingOutput } from "./writing-output";
import { decodeNativeWritingPreview, decodeWritingPreview } from "./writing-preview";
import { cloneMessageImages, type MessageImage } from "../chat/image-types";
import type {
    AgentEvent,
    AssistantMessagePart,
    ChatAgentStatus,
    PaAgentMessage,
    ChatWritingRequest,
    WritingRecoveryReason,
    ProviderCompletion,
} from "./chat-types";

/** Local debug evidence only. Never include model content or arbitrary metadata. */
export interface WritingDeliveryDiagnostic {
    runId: string;
    requestId: string;
    messageId?: string;
    turnId?: string;
    stage: "writing_projection";
    timestamp: number;
    runStatus: Extract<AgentEvent, { type: "agent_end" }>["status"];
    stopReason: NonNullable<Extract<PaAgentMessage, { role: "assistant" }>["stopReason"]> | "unknown";
    providerCompletion: ProviderCompletion;
    transportOutcome: "done" | "idle" | "aborted" | "wall_clock_exceeded" | "error" | "unknown";
    schemaState: "valid" | "invalid" | "missing";
    textChars: number;
    maxTextChars: number;
    result: "artifact" | WritingRecoveryReason;
}

export interface WritingEventContext {
    request: ChatWritingRequest;
    /** Explicit host protocol selection; absent keeps the legacy envelope path. */
    nativeContextHandle?: string;
    maxTextChars: number;
    /** Host-owned current source/run guard, never model evidence. */
    isCurrent: () => boolean;
    /** Same source checks, optionally independent of generation cancellation. */
    isPreviewCurrent?: () => boolean;
    getStyleRevisionIds?: () => readonly string[];
    /** Frozen host provenance, independent of the model envelope and provider pixel subset. */
    getAssociatedImages?: () => readonly MessageImage[];
    onDiagnostic?: (diagnostic: WritingDeliveryDiagnostic) => void;
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
    private writingText = "";
    private writingMessageId?: string;
    private writingHasTool = false;
    private writingPreviewText = "";
    private writingTurnId?: string;
    private writingTransportOutcome: WritingDeliveryDiagnostic["transportOutcome"] = "unknown";
    private nativeArguments = "";
    private nativeValidated = false;

    constructor(
        private readonly legacyEvents: AgentEventEmitter,
        private readonly onLifecycleEvent?: (event: AgentEvent) => void,
        writing?: WritingEventContext,
    ) {
        this.writing = writing ? { ...writing, request: cloneChatWritingRequest(writing.request) } : undefined;
        if (writing?.nativeContextHandle !== undefined) cloneChatWritingRequest({ requestId: writing.nativeContextHandle });
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
                if (event.message.role === "assistant") {
                    this.writingCandidate = undefined;
                    this.writingTurnId = event.turnId;
                    this.writingTransportOutcome = "unknown";
                    this.writingText = "";
                    this.writingMessageId = event.message.id;
                    this.writingHasTool = false;
                    this.nativeArguments = "";
                    this.nativeValidated = false;
                    this.emitWritingPreview(event.runId, event.message.id, "");
                }
                return;
            case "message_update":
                if (this.writing && event.messageId === this.writingMessageId) {
                    if (this.writing.nativeContextHandle !== undefined && event.update.kind === "toolcall_delta"
                        && event.metadata?.nativeWritingContextHandle === this.writing.nativeContextHandle
                        && typeof event.metadata.nativeWritingArguments === "string") {
                        this.nativeArguments = event.metadata.nativeWritingArguments.slice(0, this.writing.maxTextChars + 1);
                        this.emitWritingPreview(event.runId, event.messageId, this.currentWritingPreview(this.nativeArguments));
                    }
                    if (event.update.kind === "text_delta" && !this.writingHasTool) {
                        // Keep one over-budget character so the decoder rejects
                        // this candidate without retaining an unbounded preview buffer.
                        const capacity = Math.max(0, this.writing.maxTextChars + 1 - this.writingText.length);
                        this.writingText += event.update.text.slice(0, capacity);
                        this.emitWritingPreview(event.runId, event.messageId, this.writing.nativeContextHandle !== undefined
                            ? (this.isWritingPreviewCurrent() ? this.writingText : "") : this.currentWritingPreview(this.writingText));
                    } else if (event.update.kind === "toolcall_start") {
                        this.writingHasTool = true;
                        this.emitWritingPreview(event.runId, event.messageId, "");
                    }
                }
                if (event.update.kind === "thinking_delta") {
                    this.legacyEvents.reasoningChunk(event.update.text);
                }
                return;
            case "message_end":
                this.canonicalMessages.set(event.message.id, event.message);
                if (event.message.role !== "assistant") return;
                if (this.writing) {
                    const transport = event.metadata?.transportOutcome;
                    this.writingTransportOutcome = transport === "done" || transport === "idle" || transport === "aborted"
                        || transport === "wall_clock_exceeded" || transport === "error" ? transport : "unknown";
                    this.writingCandidate = { ...event.message, content: event.message.content.map((part) => ({ ...part })) };
                    if (this.writing.nativeContextHandle !== undefined) {
                        this.nativeValidated = event.metadata?.nativeWritingValidated === true
                            && event.metadata.nativeWritingContextHandle === this.writing.nativeContextHandle;
                        const calls = event.message.content.filter((part) => part.type === "toolCall");
                        if (this.nativeValidated && calls.length === 1 && typeof calls[0].input === "string") {
                            this.nativeArguments = calls[0].input.slice(0, this.writing.maxTextChars + 1);
                        }
                        const plainText = calls.length === 0
                            ? event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("") : undefined;
                        this.emitWritingPreview(event.runId, event.message.id, plainText !== undefined
                            ? (this.isWritingPreviewCurrent() ? plainText : "") : this.currentWritingPreview(this.nativeArguments));
                        return;
                    }
                    const text = event.message.content.some((part) => part.type === "toolCall") ? ""
                        : event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
                    this.emitWritingPreview(event.runId, event.message.id, this.currentWritingPreview(text));
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
        const native = writing.nativeContextHandle !== undefined;
        const calls = candidate?.content.filter((part) => part.type === "toolCall") ?? [];
        if (native && candidate && calls.length === 0 && !this.nativeArguments) {
            if (this.isWritingPreviewCurrent()) this.appendAssistantText(candidate.content);
            return;
        }
        const rawText = native ? this.nativeArguments
            : candidate?.content.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
        let reason: WritingRecoveryReason | undefined;
        // A warning's impact is unknown here. It must not silently become a verified version.
        if (native && !this.isWritingPreviewCurrent()) reason = "source_changed";
        else if (event.status !== "completed" || !candidate
            || (native ? !this.nativeValidated || candidate.stopReason !== "tool_calls" || calls.length !== 1
                || calls[0].name !== "present_writing" : candidate.stopReason !== "stop" || calls.length > 0)) reason = "incomplete";
        else if (candidate.providerCompletion !== (native ? "tool_calls" : "stop")) reason = "provider_incomplete";
        else {
            try { if (!writing.isCurrent()) reason = "source_changed"; }
            catch { reason = "source_changed"; }
        }
        // Structural validity is evidence independent of provider finish and
        // source permission. A valid envelope alone never authorizes an artifact.
        const nativeDecoded = native ? decodeNativeWritingOutput(rawText, writing.nativeContextHandle!, writing.maxTextChars) : undefined;
        const decoded = native ? (nativeDecoded ? { ...nativeDecoded, requestId: writing.request.requestId } : undefined)
            : decodeWritingOutput(rawText, writing.request, writing.maxTextChars);
        const output = reason ? undefined : decoded;
        try {
            writing.onDiagnostic?.({
                runId: event.runId, requestId: writing.request.requestId,
                ...(candidate ? { messageId: candidate.id } : {}),
                ...(this.writingTurnId ? { turnId: this.writingTurnId } : {}),
                stage: "writing_projection", timestamp: event.timestamp,
                runStatus: event.status, stopReason: candidate?.stopReason ?? "unknown",
                providerCompletion: candidate?.providerCompletion ?? "unknown",
                transportOutcome: this.writingTransportOutcome,
                schemaState: !candidate ? "missing" : decoded ? "valid" : "invalid",
                textChars: rawText.length, maxTextChars: writing.maxTextChars,
                result: output ? "artifact" : reason ?? "invalid_output",
            });
        } catch { /* Debug sinks must not change delivery or recovery. */ }
        const material = writing.getAssociatedImages ? { associatedImages: cloneMessageImages(writing.getAssociatedImages()) } : {};
        if (!output) {
            const previewText = this.currentWritingPreview(rawText);
            if (candidate) this.emitWritingPreview(event.runId, candidate.id, previewText);
            this.legacyEvents.writingRecovery({ runId: event.runId, requestId: writing.request.requestId,
                ...(candidate ? { messageId: candidate.id } : {}),
                rawText: native && reason === "source_changed" ? "" : rawText,
                reason: reason ?? "invalid_output", previewText, ...material });
            return;
        }
        const preamble = native ? candidate!.content.filter((part) => part.type === "text").map((part) => part.text).join("") : "";
        this.legacyEvents.writingArtifact({ runId: event.runId, requestId: output.requestId,
            messageId: candidate!.id, body: output.body, explanation: output.explanation, ...material,
            ...(preamble ? { preamble } : {}),
            ...(writing.getStyleRevisionIds ? { styleRevisionIds: [...writing.getStyleRevisionIds()] } : {}) });
        this.appendAssistantText([{ type: "text", text: preamble ? `${preamble}\n\n${output.body}` : output.body }]);
    }

    private currentWritingPreview(rawText: string): string {
        const writing = this.writing;
        if (!writing) return "";
        try {
            if (!this.isWritingPreviewCurrent()) return "";
            return (writing.nativeContextHandle !== undefined
                ? decodeNativeWritingPreview(rawText, writing.maxTextChars)
                : decodeWritingPreview(rawText, writing.request.requestId, writing.maxTextChars))?.text ?? "";
        } catch { return ""; }
    }

    private isWritingPreviewCurrent(): boolean {
        try { return this.writing ? (this.writing.isPreviewCurrent?.() ?? this.writing.isCurrent()) : false; }
        catch { return false; }
    }

    private emitWritingPreview(runId: string, messageId: string, text: string): void {
        if (!this.writing || text === this.writingPreviewText) return;
        this.writingPreviewText = text;
        this.legacyEvents.writingPreview({ runId, messageId, requestId: this.writing.request.requestId, text });
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

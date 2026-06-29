import type {
    ChatAgentSource,
    ChatContextUsedItem,
    ChatMessage,
    ChatTurnMemoryMetadata,
    PaAgentMessage,
    PaAgentPersistedTurn,
    SourceRecord,
    TurnEndStatus,
} from "./chat-types";
import { PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION } from "./chat-types";
import { createContextPagerStateFromChatContextUsed } from "../pa";

export interface CreatePaAgentPersistedTurnInput {
    runId: string;
    turnId: string;
    status?: TurnEndStatus;
    committedFinalText?: string;
    sourceRecords?: readonly SourceRecord[];
    contextUsed?: readonly ChatContextUsedItem[];
    messages: readonly PaAgentMessage[];
}

export function createPaAgentPersistedTurn(input: CreatePaAgentPersistedTurnInput): PaAgentPersistedTurn {
    return {
        schemaVersion: PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION,
        runId: input.runId,
        turnId: input.turnId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.committedFinalText !== undefined ? { committedFinalText: input.committedFinalText } : {}),
        ...(input.sourceRecords && input.sourceRecords.length > 0
            ? { sourceRecords: input.sourceRecords.map(cloneSourceRecord) }
            : {}),
        ...(input.contextUsed && input.contextUsed.length > 0
            ? { contextUsed: input.contextUsed.map(cloneContextUsedItem) }
            : {}),
        messages: input.messages.map(clonePaAgentMessage),
    };
}

export function readChatHistoryTurnMetadata(
    assistantMessage: ChatMessage,
    legacyMetadata?: ChatTurnMemoryMetadata,
): ChatTurnMemoryMetadata | undefined {
    if (assistantMessage.canonicalTurn) {
        return extractCanonicalTurnMetadata(assistantMessage.canonicalTurn);
    }
    const metadata = assistantMessage.memoryMetadata ?? legacyMetadata;
    return metadata ? cloneTurnMetadata(metadata) : undefined;
}

export function extractCanonicalTurnMetadata(
    turn: Pick<PaAgentPersistedTurn, "messages"> & Partial<Pick<PaAgentPersistedTurn, "runId" | "turnId" | "sourceRecords" | "contextUsed">>,
): ChatTurnMemoryMetadata {
    const sourceRecords = dedupeSourceRecords([
        ...(turn.sourceRecords ?? []).map(cloneSourceRecord),
        ...collectToolResultSourceRecords(turn.messages),
    ]);
    const contextUsed = mergeContextUsed([
        ...(turn.contextUsed ?? []).map(cloneContextUsedItem),
        ...collectToolResultContextUsed(turn.messages),
    ]);
    const allowedMemorySourcePaths = uniqueStrings(
        sourceRecords
            .filter((record) => record.kind === "memory-reference")
            .map((record) => record.path)
            .filter((path): path is string => Boolean(path)),
    );
    return {
        hasMemoryContent: allowedMemorySourcePaths.length > 0,
        allowedMemorySourcePaths,
        ...(contextUsed.length > 0 ? { contextUsed } : {}),
        ...(sourceRecords.length > 0 ? { sourceRecords } : {}),
        ...(contextUsed.length > 0
            ? {
                contextTrace: createContextPagerStateFromChatContextUsed(
                    turn.runId ?? turn.turnId ?? "chat-turn",
                    contextUsed,
                ).persistedTrace,
            }
            : {}),
    };
}

function collectToolResultSourceRecords(messages: readonly PaAgentMessage[]): SourceRecord[] {
    return messages.flatMap((message) => message.role === "toolResult"
        ? (message.content.sourceRecords ?? []).map(cloneSourceRecord)
        : []);
}

function collectToolResultContextUsed(messages: readonly PaAgentMessage[]): ChatContextUsedItem[] {
    return messages.flatMap((message) => message.role === "toolResult"
        ? (message.content.contextUsed ?? []).map(cloneContextUsedItem)
        : []);
}

function dedupeSourceRecords(records: SourceRecord[]): SourceRecord[] {
    const byKey = new Map<string, SourceRecord>();
    for (const record of records) {
        const key = [
            record.dedupKey,
            record.sourceBoundary ?? "",
            record.path ?? "",
            record.url ?? "",
            record.title ?? "",
        ].join("\u0000");
        if (!byKey.has(key)) {
            byKey.set(key, record);
        }
    }
    return [...byKey.values()];
}

function mergeContextUsed(items: ChatContextUsedItem[]): ChatContextUsedItem[] {
    const byKey = new Map<string, ChatContextUsedItem>();
    for (const item of items) {
        const key = `${item.category}:${item.label}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, {
                ...item,
                sources: item.sources ? dedupeSources(item.sources) : undefined,
            });
            continue;
        }
        existing.sources = dedupeSources([
            ...(existing.sources ?? []),
            ...(item.sources ?? []),
        ]);
        if (!existing.detail && item.detail) {
            existing.detail = item.detail;
        }
        existing.citationEligible = existing.citationEligible === true || item.citationEligible === true;
        existing.statusOnly = existing.statusOnly === true && item.statusOnly === true;
    }
    return [...byKey.values()];
}

function dedupeSources(sources: readonly ChatAgentSource[]): ChatAgentSource[] {
    const seen = new Set<string>();
    const result: ChatAgentSource[] = [];
    for (const source of sources) {
        if (!source.path) continue;
        const key = `${source.path}:${source.chunkIndex ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ ...source });
    }
    return result;
}

function cloneTurnMetadata(metadata: ChatTurnMemoryMetadata): ChatTurnMemoryMetadata {
    return {
        hasMemoryContent: metadata.hasMemoryContent,
        allowedMemorySourcePaths: [...metadata.allowedMemorySourcePaths],
        ...(metadata.contextUsed ? { contextUsed: metadata.contextUsed.map(cloneContextUsedItem) } : {}),
        ...(metadata.sourceRecords ? { sourceRecords: metadata.sourceRecords.map(cloneSourceRecord) } : {}),
        ...(metadata.contextTrace ? { contextTrace: cloneContextTrace(metadata.contextTrace) } : {}),
    };
}

function cloneContextTrace(trace: NonNullable<ChatTurnMemoryMetadata["contextTrace"]>): NonNullable<ChatTurnMemoryMetadata["contextTrace"]> {
    return {
        ...trace,
        usedSourceRefs: trace.usedSourceRefs.map((ref) => ({
            ...ref,
            whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
        })),
        skippedSourceRefs: trace.skippedSourceRefs.map((ref) => ({
            ...ref,
            whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
        })),
        usedMemoryRefs: trace.usedMemoryRefs.map((ref) => ({ ...ref })),
        droppedMemoryRefs: trace.droppedMemoryRefs.map((ref) => ({ ...ref })),
    };
}

function cloneContextUsedItem(item: ChatContextUsedItem): ChatContextUsedItem {
    return {
        ...item,
        sources: item.sources ? item.sources.map((source) => ({ ...source })) : undefined,
    };
}

function cloneSourceRecord(record: SourceRecord): SourceRecord {
    return {
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
    };
}

function clonePaAgentMessage(message: PaAgentMessage): PaAgentMessage {
    if (message.role === "assistant") {
        return {
            ...message,
            content: message.content.map((part) => ({ ...part })),
        };
    }
    if (message.role === "toolResult") {
        return {
            ...message,
            content: {
                ...message.content,
                sourceRecords: message.content.sourceRecords?.map(cloneSourceRecord),
                contextUsed: message.content.contextUsed?.map(cloneContextUsedItem),
                metadata: message.content.metadata ? { ...message.content.metadata } : undefined,
            },
        };
    }
    return Array.isArray(message.content)
        ? { ...message, content: message.content.map((part) => ({ ...part })) }
        : { ...message };
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values)];
}

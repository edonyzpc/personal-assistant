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
import { cloneSourceRecord } from "./source-store";
import { cloneContextReductionReceipt, createContextPagerStateFromChatContextUsed } from "../pa";
import { cloneMessageImages } from "../chat/image-types";
import {
    assertVaultObservationHistory,
    cloneVaultObservationEvidence,
    parseVaultObservationEvidence,
    type VaultObservationEvidence,
} from "./vault-observation-evidence";
import {
    cloneMemoryManagementEvidence,
    parseMemoryManagementEvidence,
    type MemoryManagementEvidence,
} from "./memory-management-evidence";

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
    const finalWritingMessage = [...input.messages].reverse().find((message) => message.role === "assistant" && message.writingRequestId);
    const observationEvidence: VaultObservationEvidence[] = [];
    let observationEvidenceInvalid = false;
    const managementEvidence: MemoryManagementEvidence[] = [];
    let managementEvidenceInvalid = false;
    for (const message of input.messages) {
        if (message.role !== "toolResult" || message.content.metadata?.vaultObservationContractVersion !== 1) continue;
        const evidence = message.content.metadata.vaultObservationEvidence;
        const parsed = parseVaultObservationEvidence(evidence);
        if (!parsed.ok || parsed.evidence.tool !== message.toolName) {
            observationEvidenceInvalid = true;
            continue;
        }
        if (!observationEvidence.some(existing => existing.observationId === parsed.evidence.observationId)) {
            observationEvidence.push(parsed.evidence);
        }
    }
    for (const message of input.messages) {
        if (message.role !== "toolResult" || message.content.metadata?.memoryManagementContractVersion !== 1) continue;
        const parsed = parseMemoryManagementEvidence(message.content.metadata.memoryManagementEvidence);
        if (!parsed.ok || parsed.evidence.tool !== message.toolName) {
            managementEvidenceInvalid = true;
            continue;
        }
        if (!managementEvidence.some(existing => existing.observationId === parsed.evidence.observationId)) {
            managementEvidence.push(parsed.evidence);
        }
    }
    if (observationEvidenceInvalid) observationEvidence.length = 0;
    try {
        assertVaultObservationHistory(observationEvidence);
    } catch {
        observationEvidenceInvalid = true;
        observationEvidence.length = 0;
    }
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
        ...(observationEvidenceInvalid ? {
            vaultObservationEvidence: [],
            vaultObservationContractVersion: 1 as const,
        } : observationEvidence.length > 0 ? {
            vaultObservationEvidence: observationEvidence.map(cloneVaultObservationEvidence),
            vaultObservationContractVersion: 1 as const,
        } : {}),
        ...(observationEvidenceInvalid ? { vaultObservationEvidenceInvalid: true } : {}),
        ...(managementEvidence.length > 0 ? {
            memoryManagementEvidence: managementEvidence.map(cloneMemoryManagementEvidence),
            memoryManagementContractVersion: 1 as const,
        } : {}),
        ...(managementEvidenceInvalid ? {
            memoryManagementEvidence: [],
            memoryManagementContractVersion: 1 as const,
            memoryManagementEvidenceInvalid: true,
        } : {}),
        messages: input.messages.map((message) => {
            const copy = clonePaAgentMessage(message);
            if (copy.role === "assistant" && copy.writingRequestId) {
                // Raw response belongs only to the explicit recovery field. No
                // parsing or implicit version creation when persisting history.
                copy.content = copy.content.filter((part) => part.type === "toolCall");
                if (copy.id === finalWritingMessage?.id && input.committedFinalText && copy.content.length === 0) {
                    copy.content = [{ type: "text", text: input.committedFinalText }];
                }
            }
            return copy;
        }),
    };
}

export function readChatHistoryTurnMetadata(
    assistantMessage: ChatMessage,
    legacyMetadata?: ChatTurnMemoryMetadata,
): ChatTurnMemoryMetadata | undefined {
    const metadata = assistantMessage.memoryMetadata ?? legacyMetadata;
    if (assistantMessage.canonicalTurn) {
        const canonical = extractCanonicalTurnMetadata(assistantMessage.canonicalTurn);
        // Source/Memory truth still comes from the canonical turn. The body-free
        // reduction receipt lives in turn metadata, including after rehydration.
        const reduction = cloneContextReductionReceipt(metadata?.contextTrace?.reduction);
        if (reduction) {
            canonical.contextTrace = {
                ...(canonical.contextTrace ?? createContextPagerStateFromChatContextUsed(
                    assistantMessage.canonicalTurn.runId,
                    canonical.contextUsed ?? [],
                ).persistedTrace),
                reduction,
            };
        }
        return canonical;
    }
    return metadata ? cloneTurnMetadata(metadata) : undefined;
}

export function extractCanonicalTurnMetadata(
    turn: Pick<PaAgentPersistedTurn, "messages"> & Partial<Pick<PaAgentPersistedTurn, "runId" | "turnId" | "sourceRecords" | "contextUsed" | "vaultObservationEvidence" | "vaultObservationContractVersion" | "vaultObservationEvidenceInvalid" | "memoryManagementEvidence" | "memoryManagementContractVersion" | "memoryManagementEvidenceInvalid">>,
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
        ...(turn.vaultObservationEvidenceInvalid || turn.vaultObservationEvidence ? {
            vaultObservationEvidence: turn.vaultObservationEvidenceInvalid
                ? []
                : (turn.vaultObservationEvidence ?? []).map(cloneVaultObservationEvidence),
            vaultObservationContractVersion: 1,
        } : {}),
        ...(turn.vaultObservationEvidenceInvalid ? { vaultObservationEvidenceInvalid: true } : {}),
        ...(turn.memoryManagementEvidenceInvalid || turn.memoryManagementEvidence ? {
            memoryManagementEvidence: turn.memoryManagementEvidenceInvalid
                ? []
                : (turn.memoryManagementEvidence ?? []).map(cloneMemoryManagementEvidence),
            memoryManagementContractVersion: 1,
        } : {}),
        ...(turn.memoryManagementEvidenceInvalid ? { memoryManagementEvidenceInvalid: true } : {}),
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
        const key = `${item.category}:${item.label}:${item.memoryClaimId ?? ""}`;
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

export function dedupeSources(sources: readonly ChatAgentSource[]): ChatAgentSource[] {
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
        ...(metadata.vaultObservationContractVersion === 1 ? {
            ...(metadata.vaultObservationEvidenceInvalid ? {
                vaultObservationEvidence: [],
            } : {
                vaultObservationEvidence: (metadata.vaultObservationEvidence ?? []).map(cloneVaultObservationEvidence),
            }),
            vaultObservationContractVersion: 1,
            ...(metadata.vaultObservationEvidenceInvalid ? { vaultObservationEvidenceInvalid: true } : {}),
        } : {}),
        ...(metadata.memoryManagementContractVersion === 1 ? {
            ...(metadata.memoryManagementEvidenceInvalid ? {
                memoryManagementEvidence: [],
            } : {
                memoryManagementEvidence: (metadata.memoryManagementEvidence ?? []).map(cloneMemoryManagementEvidence),
            }),
            memoryManagementContractVersion: 1,
            ...(metadata.memoryManagementEvidenceInvalid ? { memoryManagementEvidenceInvalid: true } : {}),
        } : {}),
    };
}

function cloneToolMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...metadata };
    if (metadata.vaultObservationContractVersion === 1) {
        const parsed = parseVaultObservationEvidence(metadata.vaultObservationEvidence);
        if (parsed.ok) {
            copy.vaultObservationEvidence = cloneVaultObservationEvidence(parsed.evidence);
        } else {
            delete copy.vaultObservationEvidence;
            copy.vaultObservationEvidenceInvalid = true;
        }
    }
    if (metadata.memoryManagementContractVersion === 1) {
        const parsed = parseMemoryManagementEvidence(metadata.memoryManagementEvidence);
        if (parsed.ok) {
            copy.memoryManagementEvidence = cloneMemoryManagementEvidence(parsed.evidence);
        } else {
            delete copy.memoryManagementEvidence;
            copy.memoryManagementEvidenceInvalid = true;
        }
    }
    return copy;
}

function cloneContextTrace(trace: NonNullable<ChatTurnMemoryMetadata["contextTrace"]>): NonNullable<ChatTurnMemoryMetadata["contextTrace"]> {
    const { reduction: rawReduction, ...rest } = trace;
    const reduction = cloneContextReductionReceipt(rawReduction);
    return {
        ...rest,
        ...(reduction ? { reduction } : {}),
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

function clonePaAgentMessage(message: PaAgentMessage): PaAgentMessage {
    if (message.role === "assistant") {
        return {
            ...message,
            content: message.content.map((part) => ({ ...part })),
            ...(message.memoryManagementEvidence ? {
                memoryManagementEvidence: message.memoryManagementEvidence.map(cloneMemoryManagementEvidence),
            } : {}),
        };
    }
    if (message.role === "toolResult") {
        return {
            ...message,
            content: {
                ...message.content,
                sourceRecords: message.content.sourceRecords?.map(cloneSourceRecord),
                contextUsed: message.content.contextUsed?.map(cloneContextUsedItem),
                metadata: message.content.metadata ? cloneToolMetadata(message.content.metadata) : undefined,
            },
        };
    }
    return Array.isArray(message.content)
        ? { ...message, ...(message.images ? { images: cloneMessageImages(message.images) } : {}), content: message.content.map((part) => ({ ...part })) }
        : { ...message, ...(message.images ? { images: cloneMessageImages(message.images) } : {}) };
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values)];
}

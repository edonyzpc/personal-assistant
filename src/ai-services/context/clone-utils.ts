import type { PaAgentMessage } from "../chat-types";
import { cloneMessageImages } from "../../chat/image-types";
import { cloneVaultObservationEvidence } from "../vault-observation-evidence";
import { cloneMemoryManagementEvidence } from "../memory-management-evidence";
import { cloneSourceRecord } from "../source-store";
import { cloneInputLineage } from "../input-lineage";
import { cloneResultFact } from "../pa-agent-result-facts";

export function cloneMessage(message: PaAgentMessage): PaAgentMessage {
    if (message.role === "user") {
        return {
            ...message,
            ...(cloneInputLineage(message.inputLineage) ? { inputLineage: cloneInputLineage(message.inputLineage) } : {}),
            ...(message.images ? { images: cloneMessageImages(message.images) } : {}),
            content: Array.isArray(message.content)
                ? message.content.map((part) => ({ ...part, metadata: part.metadata ? { ...part.metadata } : undefined }))
                : message.content,
        };
    }
    if (message.role === "assistant") {
        return {
            ...message,
            ...(cloneInputLineage(message.inputLineage) ? { inputLineage: cloneInputLineage(message.inputLineage) } : {}),
            content: message.content.map((part) => ({ ...part })),
            ...(message.memoryManagementEvidence ? {
                memoryManagementEvidence: message.memoryManagementEvidence.map(cloneMemoryManagementEvidence),
            } : {}),
        };
    }
    return {
        ...message,
        ...(cloneInputLineage(message.inputLineage) ? { inputLineage: cloneInputLineage(message.inputLineage) } : {}),
        content: {
            ...message.content,
            sourceRecords: message.content.sourceRecords?.map(cloneSourceRecord),
            contextUsed: message.content.contextUsed?.map((item) => ({ ...item })),
            resultFact: cloneResultFact(message.content.resultFact),
            metadata: message.content.metadata ? cloneToolMetadata(message.content.metadata) : undefined,
        },
    };
}

function cloneToolMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...metadata };
    if (metadata.vaultObservationEvidence !== undefined) {
        copy.vaultObservationEvidence = cloneVaultObservationEvidence(
            metadata.vaultObservationEvidence as Parameters<typeof cloneVaultObservationEvidence>[0],
        );
    }
    if (metadata.memoryManagementEvidence !== undefined) {
        copy.memoryManagementEvidence = Array.isArray(metadata.memoryManagementEvidence)
            ? metadata.memoryManagementEvidence.map(value =>
                cloneMemoryManagementEvidence(value as Parameters<typeof cloneMemoryManagementEvidence>[0]))
            : cloneMemoryManagementEvidence(
                metadata.memoryManagementEvidence as Parameters<typeof cloneMemoryManagementEvidence>[0],
            );
    }
    return copy;
}

export function cloneTranscript(transcript: readonly PaAgentMessage[]): PaAgentMessage[] {
    return transcript.map(cloneMessage);
}

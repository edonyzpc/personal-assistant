import type { PaAgentMessage } from "../chat-types";
import { cloneMessageImages } from "../../chat/image-types";

export function cloneMessage(message: PaAgentMessage): PaAgentMessage {
    if (message.role === "user") {
        return {
            ...message,
            ...(message.images ? { images: cloneMessageImages(message.images) } : {}),
            content: Array.isArray(message.content)
                ? message.content.map((part) => ({ ...part, metadata: part.metadata ? { ...part.metadata } : undefined }))
                : message.content,
        };
    }
    if (message.role === "assistant") {
        return {
            ...message,
            content: message.content.map((part) => ({ ...part })),
        };
    }
    return {
        ...message,
        content: {
            ...message.content,
            sourceRecords: message.content.sourceRecords?.map((record) => ({
                ...record,
                metadata: record.metadata ? { ...record.metadata } : undefined,
            })),
            contextUsed: message.content.contextUsed?.map((item) => ({ ...item })),
            metadata: message.content.metadata ? { ...message.content.metadata } : undefined,
        },
    };
}

export function cloneTranscript(transcript: readonly PaAgentMessage[]): PaAgentMessage[] {
    return transcript.map(cloneMessage);
}

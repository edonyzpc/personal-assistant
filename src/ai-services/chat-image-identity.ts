import type { ChatMessage } from "./chat-types";
import { cloneMessageImages, type MessageImage } from "../chat/image-types";

/** Metadata identity only: safe for source snapshots and summary cache keys. */
export function chatImageIdentity(images: readonly MessageImage[] | undefined): string {
    return JSON.stringify(images?.map((image) => [image.ref.assetId, image.ref.contentHash, image.ordinal, image.label]) ?? []);
}

export function chatHistoryImageMetadata(message: Pick<ChatMessage, "images">): { images?: MessageImage[] } {
    return message.images?.length ? { images: cloneMessageImages(message.images) } : {};
}

/** Host material metadata retains chat ordinals; a WritingVersion can separately number its display list. */
export function mergeChatImageMaterials(...groups: readonly (readonly MessageImage[])[]): MessageImage[] {
    const images = new Map<string, MessageImage>();
    for (const group of groups) for (const image of cloneMessageImages(group)) {
        const identity = `${image.ref.assetId}:${image.ref.contentHash}`;
        if (!images.has(identity)) images.set(identity, image);
    }
    return cloneMessageImages([...images.values()]);
}

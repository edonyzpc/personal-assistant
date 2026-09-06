import { z } from 'zod';
import type { PersistedSourceRef } from '../pa/contracts/source-ref';
import { hasForbiddenPersistedTextFields, validateSourceRefPathShape } from '../pa/contracts/source-ref';
import { cloneMessageImages, type MessageImage } from './image-types';
import { getPlatformCrypto } from '../platform-dom';

export interface WritingScene {
    writingTask: string;
    purpose: string;
    audience: string;
    domain: string;
}

export interface WritingVersion {
    id: string;
    parentVersionId?: string;
    requestId: string;
    messageId: string;
    text: string;
    textHash: string;
    explanation: string;
    origin: 'ai_generated' | 'user_edited';
    conversationId: string;
    turnIndex: number;
    createdAt: number;
    associatedImages: MessageImage[];
    backgroundSourceRefs: PersistedSourceRef[];
    styleRevisionIds: string[];
    /** Absent on older records whose references may include ancestor requests. */
    referenceScope?: 'request';
    scene?: WritingScene;
}

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const scenePart = z.string().trim().min(1).max(64);
export const writingSceneSchema = z.object({
    writingTask: scenePart, purpose: scenePart, audience: scenePart, domain: scenePart,
}).strict();
const versionSchema = z.object({
    id, parentVersionId: id.optional(), requestId: id, messageId: id,
    text: z.string().min(1).max(1_000_000), textHash: z.string().regex(/^[a-f0-9]{64}$/),
    explanation: z.string().max(1_000_000), origin: z.enum(['ai_generated', 'user_edited']),
    conversationId: id, turnIndex: z.number().int().nonnegative(), createdAt: z.number().finite().nonnegative(),
    associatedImages: z.array(z.unknown()).max(2048), backgroundSourceRefs: z.array(z.unknown()).max(2048),
    styleRevisionIds: z.array(id).max(2048), scene: writingSceneSchema.optional(),
    referenceScope: z.literal('request').optional(),
}).strict();

export function cloneWritingVersion(value: unknown): WritingVersion {
    const parsed = versionSchema.parse(value);
    const backgroundSourceRefs = parsed.backgroundSourceRefs.map((source) => {
        if (!validateSourceRefPathShape(source).ok || hasForbiddenPersistedTextFields(source)) throw new Error('Invalid writing source');
        const ref = source as PersistedSourceRef;
        return {
            path: ref.path,
            ...(ref.heading !== undefined ? { heading: ref.heading } : {}),
            ...(ref.blockId !== undefined ? { blockId: ref.blockId } : {}),
            ...(ref.contentHash !== undefined ? { contentHash: ref.contentHash } : {}),
            ...(ref.sourceId !== undefined ? { sourceId: ref.sourceId } : {}),
            ...(ref.retrievalOutcomeId !== undefined ? { retrievalOutcomeId: ref.retrievalOutcomeId } : {}),
        };
    });
    return { ...parsed, associatedImages: cloneMessageImages(parsed.associatedImages), backgroundSourceRefs };
}

export async function hashWritingText(text: string): Promise<string> {
    const crypto = getPlatformCrypto();
    if (!crypto?.subtle) throw new Error('Secure text hashing is unavailable');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Per-version material is independent of the smaller set actually sent this turn. */
export function mergeWritingImages(...groups: readonly (readonly MessageImage[])[]): MessageImage[] {
    const seen = new Set<string>();
    const images: MessageImage[] = [];
    for (const group of groups) for (const image of cloneMessageImages(group)) {
        const identity = `${image.ref.assetId}:${image.ref.contentHash}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        images.push({ ...image, ordinal: images.length + 1 });
    }
    return images;
}

import type { ChatTurnMemoryMetadata, ChatWritingRecovery } from '../ai-services/chat-types';
import { hasForbiddenPersistedTextFields, validateSourceRefPathShape, type PersistedSourceRef } from '../pa/contracts/source-ref';
import { cloneMessageImages, type MessageImage } from './image-types';
import type { WritingVersionService } from './writing-versions';

export interface WritingRecoverySourceReceipt { isCurrent: () => boolean; }

export interface WritingRecoverySourceHost {
    captureLifetime: (conversationId: string) => () => boolean;
    versions?: Pick<WritingVersionService, 'get'>;
    isMemoryAllowed: () => boolean;
    verifyNote: (ref: PersistedSourceRef, memory: boolean) => Promise<WritingRecoverySourceReceipt>;
    verifyImage: (image: MessageImage) => Promise<WritingRecoverySourceReceipt>;
}

/**
 * Revalidate only sources actually recorded with an old draft. A successful
 * receipt does not establish completeness: the recovery UI separately obtains
 * explicit consent for missing historical Personal/Insights/source identities.
 */
export async function prepareWritingRecoverySources(
    host: WritingRecoverySourceHost,
    recovery: ChatWritingRecovery,
    images: readonly MessageImage[],
    conversationId: string,
    metadata?: ChatTurnMemoryMetadata,
): Promise<WritingRecoverySourceReceipt> {
    // Match TaskSourceRun.historySourceRecords: a typed status-only reference
    // must not become material through the legacy path inventory. Capture only
    // primitive source facts before awaiting; later metadata edits cannot grant
    // or revoke a different historical purpose for this receipt.
    const records = metadata?.sourceRecords ?? [];
    const sources = records.filter((record) => (!record.statusOnly || record.metadata?.sourceDependency === true)
        && (record.sourceBoundary === 'current-note' || record.sourceBoundary === 'read-only-tool'
            || record.sourceBoundary === 'vault' || record.sourceBoundary === 'memory'
            || record.sourceBoundary === 'web' || record.kind === 'memory-reference'))
        .map((record) => ({ path: record.path, web: record.sourceBoundary === 'web',
            memory: record.sourceBoundary === 'memory' || record.kind === 'memory-reference' }));
    const legacyMemory = metadata?.hasMemoryContent === true && !records.some((record) => record.kind === 'memory-reference');
    if (legacyMemory) {
        sources.push(...(metadata?.allowedMemorySourcePaths ?? []).map((path) => ({ path, web: false, memory: true })));
    }
    const usesMemory = legacyMemory || sources.some((source) => source.memory);
    const memoryPaths = new Set(sources.filter((source) => source.memory && !source.web).map((source) => source.path));
    const guards = [host.captureLifetime(conversationId)];
    if (usesMemory) guards.push(host.isMemoryAllowed);
    const isCurrent = () => guards.every((guard) => guard());
    const assertCurrent = () => {
        if (!isCurrent()) throw new Error('Writing recovery sources changed');
    };
    const refs = (recovery.backgroundSourceRefs ?? []).map((ref) => ({ ...ref }));
    for (const source of sources) {
        if (source.path && !source.web && !refs.some((ref) => ref.path === source.path)) refs.push({ path: source.path });
    }
    const selectedImages = cloneMessageImages(images);
    const parentId = recovery.parentVersionId;
    assertCurrent();
    if (parentId) {
        // get() verifies the immutable body's hash; captureLifetime, obtained
        // before reading, also rejects deletion/pruning during later awaits.
        const parent = await host.versions?.get(parentId);
        assertCurrent();
        if (!parent || parent.conversationId !== conversationId) throw new Error('Writing parent unavailable');
        // Continuation reads this parent body. Its historical background/style
        // choices are not automatically reused; images is already the complete
        // host-resolved selection, including an explicit empty set or subset.
    }
    for (const ref of refs) {
        if (!validateSourceRefPathShape(ref).ok || hasForbiddenPersistedTextFields(ref)) {
            throw new Error('Writing source reference invalid');
        }
        guards.push((await host.verifyNote(ref, memoryPaths.has(ref.path))).isCurrent);
        assertCurrent();
    }
    const verifiedImages = new Set<string>();
    for (const image of selectedImages) {
        const key = `${image.ref.assetId}:${image.ref.contentHash}`;
        if (verifiedImages.has(key)) continue;
        verifiedImages.add(key);
        guards.push((await host.verifyImage(image)).isCurrent);
        assertCurrent();
    }
    return { isCurrent };
}

import type { ChatTurnMemoryMetadata, ChatWritingRecovery } from '../ai-services/chat-types';
import {
    cloneGenerationInputSnapshot,
    type GenerationInputInsightsSource,
    type GenerationInputPageletSource,
    type GenerationInputPersonalSource,
    type GenerationInputStyleSource,
    type GenerationInputTaskSource,
} from '../ai-services/generation-input-snapshot';
import { hasForbiddenPersistedTextFields, validateSourceRefPathShape, type PersistedSourceRef } from '../pa/contracts/source-ref';
import { cloneMessageImages, type MessageImage } from './image-types';
import type { WritingVersionService } from './writing-versions';

export interface WritingRecoverySourceReceipt { isCurrent: () => boolean; }

export type WritingRecoveryGenerationSource =
    | { kind: 'task'; source: GenerationInputTaskSource }
    | { kind: 'personal'; source: Exclude<GenerationInputPersonalSource, { state: 'none' }> }
    | { kind: 'insights'; source: Exclude<GenerationInputInsightsSource, { state: 'none' }> }
    | { kind: 'style'; source: Exclude<GenerationInputStyleSource, { state: 'none' }> }
    | { kind: 'pagelet'; source: Exclude<GenerationInputPageletSource, { state: 'none' }> };

export interface WritingRecoverySourceHost {
    captureLifetime: (conversationId: string) => () => boolean;
    versions?: Pick<WritingVersionService, 'get'>;
    isMemoryAllowed: () => boolean;
    verifyNote: (ref: PersistedSourceRef, memory: boolean) => Promise<WritingRecoverySourceReceipt>;
    verifyImage: (image: MessageImage) => Promise<WritingRecoverySourceReceipt>;
    verifyGenerationSource: (source: WritingRecoveryGenerationSource) => Promise<WritingRecoverySourceReceipt>;
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
    const generationInput = recovery.generationInput
        ? cloneGenerationInputSnapshot(recovery.generationInput) : undefined;
    const selectedImages = cloneMessageImages(images);
    const guards = [host.captureLifetime(conversationId)];
    const isCurrent = () => guards.every((guard) => guard());
    const assertCurrent = () => {
        if (!isCurrent()) throw new Error('Writing recovery sources changed');
    };
    if (generationInput) {
        const expectedImages = generationInput.images.map(image => `${image.ref.assetId}:${image.ref.contentHash}`);
        const actualImages = selectedImages.map(image => `${image.ref.assetId}:${image.ref.contentHash}`);
        if (expectedImages.length !== actualImages.length
            || expectedImages.some((identity, index) => identity !== actualImages[index])) {
            throw new Error('Writing recovery image snapshot changed');
        }
        const recordedParentId = generationInput.parent.state === 'identified'
            ? generationInput.parent.versionId : undefined;
        if (recovery.parentVersionId !== recordedParentId) {
            throw new Error('Writing recovery parent snapshot changed');
        }
        assertCurrent();
        if (generationInput.parent.state === 'identified') {
            const parent = await host.versions?.get(generationInput.parent.versionId);
            assertCurrent();
            if (!parent || parent.conversationId !== conversationId
                || parent.textHash !== generationInput.parent.textHash.value) {
                throw new Error('Writing parent unavailable');
            }
        }
        const generationSources: WritingRecoveryGenerationSource[] = [
            ...generationInput.task.sources.map(source => ({ kind: 'task' as const, source })),
            ...(generationInput.personal.state !== 'none'
                ? [{ kind: 'personal' as const, source: generationInput.personal }] : []),
            ...(generationInput.insights.state !== 'none'
                ? [{ kind: 'insights' as const, source: generationInput.insights }] : []),
            ...(generationInput.style.state !== 'none'
                ? [{ kind: 'style' as const, source: generationInput.style }] : []),
            ...(generationInput.pagelet.state !== 'none'
                ? [{ kind: 'pagelet' as const, source: generationInput.pagelet }] : []),
        ];
        for (const source of generationSources) {
            guards.push((await host.verifyGenerationSource(source)).isCurrent);
            assertCurrent();
        }
        for (const image of selectedImages) {
            guards.push((await host.verifyImage(image)).isCurrent);
            assertCurrent();
        }
        return { isCurrent };
    }
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
    if (usesMemory) guards.push(host.isMemoryAllowed);
    const refs = (recovery.backgroundSourceRefs ?? []).map((ref) => ({ ...ref }));
    for (const source of sources) {
        if (source.path && !source.web && !refs.some((ref) => ref.path === source.path)) refs.push({ path: source.path });
    }
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

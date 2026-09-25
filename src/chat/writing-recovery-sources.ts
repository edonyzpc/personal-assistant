import type { ChatTurnMemoryMetadata, ChatWritingRecovery } from '../ai-services/chat-types';
import {
    cloneGenerationInputSnapshot,
    type GenerationInputSnapshot,
    type GenerationInputInsightsSource,
    type GenerationInputPageletSource,
    type GenerationInputPersonalSource,
    type GenerationInputStyleSource,
    type GenerationInputTaskSource,
} from '../ai-services/generation-input-snapshot';
import { generationInputSnapshotInputLineage, resolveWritingVersionInputLineage,
    type InputLineage } from '../ai-services/input-lineage';
import type { ChatSourceScope } from '../ai-services/chat-source-scope';
import { hasForbiddenPersistedTextFields, validateSourceRefPathShape, type PersistedSourceRef } from '../pa/contracts/source-ref';
import { cloneMessageImages, type MessageImage } from './image-types';
import type { WritingVersionService } from './writing-versions';
import type { WritingVersion } from './writing-types';

export interface WritingRecoverySourceReceipt { isCurrent: () => boolean; lineageComplete?: boolean; }

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
    scope?: ChatSourceScope,
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
        let lineageComplete = generationInput.schemaVersion === 2;
        const verifiedSources = new Set<string>();
        const verifiedNotes = new Set<string>();
        const verifiedImages = new Set<string>();
        const pendingVersions: Array<{ versionId: string; textHash: string }> = [];
        const verifySource = async (source: WritingRecoveryGenerationSource) => {
            const web = source.kind === 'task'
                && (source.source.kind === 'web-source' || source.source.boundary === 'web');
            if (scope === 'web' && !web || scope === 'notes' && web) {
                throw new Error('Writing source outside current scope');
            }
            const key = JSON.stringify(source);
            if (verifiedSources.has(key)) return;
            guards.push((await host.verifyGenerationSource(source)).isCurrent);
            verifiedSources.add(key);
            assertCurrent();
        };
        const verifyNote = async (path: string, memory: boolean) => {
            if (scope === 'web') throw new Error('Writing source outside current scope');
            if (memory && !host.isMemoryAllowed()) throw new Error('Writing Memory source unavailable');
            const key = `${memory ? 'memory' : 'note'}:${path}`;
            if (verifiedNotes.has(key)) return;
            guards.push((await host.verifyNote({ path }, memory)).isCurrent);
            verifiedNotes.add(key);
            assertCurrent();
        };
        const verifyImage = async (image: MessageImage) => {
            const key = `${image.ref.assetId}:${image.ref.contentHash}`;
            if (verifiedImages.has(key)) return;
            guards.push((await host.verifyImage(image)).isCurrent);
            verifiedImages.add(key);
            assertCurrent();
        };
        const verifyLineage = async (lineage: InputLineage) => {
            if (lineage.completeness !== 'complete') lineageComplete = false;
            for (const dependency of lineage.dependencies) {
                if (scope === 'web' && dependency.kind !== 'user-text'
                    && dependency.kind !== 'attachment' && dependency.kind !== 'web'
                    || scope === 'notes' && dependency.kind === 'web') {
                    throw new Error('Writing source outside current scope');
                }
                if (dependency.kind === 'vault') {
                    await verifyNote(dependency.path, dependency.via === 'memory');
                    if (dependency.via === 'pagelet') lineageComplete = false;
                } else if (dependency.kind === 'personal') {
                    await verifySource({ kind: 'personal', source: dependency.source });
                } else if (dependency.kind === 'insight') {
                    await verifySource({ kind: 'insights', source: dependency.source });
                    lineageComplete = false;
                } else if (dependency.kind === 'writing-style') {
                    await verifySource({ kind: 'style', source: { state: 'identified',
                        revisionIds: dependency.revisionIds } });
                } else if (dependency.kind === 'writing-version') {
                    pendingVersions.push(dependency);
                } else if (dependency.kind === 'web') {
                    await verifySource({ kind: 'task', source: { purpose: 'task_material',
                        kind: 'web-source', boundary: 'web', dedupKey: dependency.resultKey,
                        providerId: dependency.providerId,
                        revision: { state: 'unknown', reason: 'not_captured' } } });
                } else if (dependency.kind === 'attachment') {
                    await verifyImage({ ref: dependency.ref, ordinal: 1, label: '' });
                }
            }
        };
        const verifySnapshot = async (snapshot: GenerationInputSnapshot) => {
            for (const source of recordedGenerationSources(snapshot)) await verifySource(source);
            if (snapshot.task.state === 'unknown' || snapshot.personal.state === 'unknown'
                || snapshot.insights.state !== 'none'
                || snapshot.style.state === 'unknown' || snapshot.pagelet.state !== 'none') lineageComplete = false;
            await verifyLineage(generationInputSnapshotInputLineage(snapshot));
        };
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
            pendingVersions.push({ versionId: parent.id, textHash: parent.textHash });
        }
        await verifySnapshot(generationInput);
        for (const image of selectedImages) await verifyImage(image);
        const visitedVersions = new Map<string, string>();
        while (pendingVersions.length > 0 && visitedVersions.size < 2048) {
            const expected = pendingVersions.shift()!;
            const visitedHash = visitedVersions.get(expected.versionId);
            if (visitedHash) {
                if (visitedHash !== expected.textHash) lineageComplete = false;
                continue;
            }
            const version: WritingVersion | null = await host.versions?.get(expected.versionId) ?? null;
            assertCurrent();
            if (!version || version.conversationId !== conversationId || version.textHash !== expected.textHash) {
                lineageComplete = false;
                continue;
            }
            visitedVersions.set(version.id, expected.textHash);
            if (version.generationInput) {
                const snapshot = cloneGenerationInputSnapshot(version.generationInput);
                await verifySnapshot(snapshot);
                if (version.parentVersionId && snapshot.parent.state === 'identified'
                    && snapshot.parent.versionId === version.parentVersionId) {
                    pendingVersions.push({ versionId: snapshot.parent.versionId,
                        textHash: snapshot.parent.textHash.value });
                } else if (version.parentVersionId || snapshot.parent.state !== 'none') lineageComplete = false;
            } else lineageComplete = false;
            if ((await resolveWritingVersionInputLineage(version,
                id => host.versions?.get(id) ?? Promise.resolve(null))).completeness !== 'complete') {
                lineageComplete = false;
            }
        }
        if (pendingVersions.length > 0) lineageComplete = false;
        return { isCurrent, lineageComplete };
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

function recordedGenerationSources(snapshot: GenerationInputSnapshot): WritingRecoveryGenerationSource[] {
    return [
        ...snapshot.task.sources.map(source => ({ kind: 'task' as const, source })),
        ...(snapshot.personal.state !== 'none'
            ? [{ kind: 'personal' as const, source: snapshot.personal }] : []),
        ...(snapshot.insights.state !== 'none'
            ? [{ kind: 'insights' as const, source: snapshot.insights }] : []),
        ...(snapshot.style.state !== 'none'
            ? [{ kind: 'style' as const, source: snapshot.style }] : []),
        ...(snapshot.pagelet.state !== 'none'
            ? [{ kind: 'pagelet' as const, source: snapshot.pagelet }] : []),
    ];
}

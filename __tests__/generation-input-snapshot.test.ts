import {
    cloneGenerationInputSnapshot,
    generationInputNeedsRecoveryConfirmation,
    generationInputRequiresConfirmationDespiteLiveReceipt,
    type GenerationInputSnapshot,
    type GenerationInputSnapshotV1,
    type GenerationInputSnapshotV2,
} from '../src/ai-services/generation-input-snapshot';

function snapshot(): GenerationInputSnapshotV1 {
    return {
        schemaVersion: 1, inputPurpose: 'writing',
        task: { state: 'identified', sources: [{ purpose: 'task_material', kind: 'context-used',
            boundary: 'read-only-tool', dedupKey: 'note:source', capabilityName: 'read_note_outline',
            revision: { state: 'identified', scope: 'current_process', path: 'notes/source.md', mtime: 10, size: 20 } }] },
        personal: { state: 'identified', mode: 'governed',
            revisions: [{ claimId: 'claim-1', revisionId: 'revision-1' }] },
        insights: { state: 'none' }, style: { state: 'identified', revisionIds: ['style-1'] },
        images: [{ ref: { assetId: 'image-1', contentHash: 'a'.repeat(64) }, hashAlgorithm: 'sha256' }],
        parent: { state: 'identified', versionId: 'parent-1',
            textHash: { algorithm: 'sha256', value: 'b'.repeat(64) } },
        pagelet: { state: 'unknown', id: 'pagelet-1', pipelineVersion: 'pagelet-v1',
            anchor: { path: 'notes/anchor.md', mtime: 30, size: 40,
                contentHash: { algorithm: 'unspecified', value: 'anchor-hash' } },
            sources: [] },
    };
}

function snapshotV2(): GenerationInputSnapshotV2 {
    const { task: _legacyTask, ...common } = snapshot();
    return { ...common, schemaVersion: 2,
        task: { state: 'identified', sources: [{ purpose: 'task_material', kind: 'context-used',
            boundary: 'read-only-tool', dedupKey: 'note:source', path: 'notes/source.md',
            revision: { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'a'.repeat(40) },
                stat: { mtime: 10, size: 20 } } }] },
        lineage: { state: 'complete', dependencies: [
            { kind: 'vault', identity: 'notes/source.md', observedRevision: { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'a'.repeat(40) } } },
            { kind: 'current_input', identity: 'message-1' },
        ] },
    };
}

describe('persisted generation input snapshot', () => {
    it('preserves strict v1 without upgrading process stat into an observed revision', () => {
        const legacy = cloneGenerationInputSnapshot(snapshot());
        expect(legacy.schemaVersion).toBe(1);
        expect(legacy.task.sources[0].revision).toEqual({ state: 'identified', scope: 'current_process',
            path: 'notes/source.md', mtime: 10, size: 20 });
        expect(generationInputNeedsRecoveryConfirmation(legacy)).toBe(true);
        expect(generationInputRequiresConfirmationDespiteLiveReceipt(legacy)).toBe(true);
        expect(generationInputRequiresConfirmationDespiteLiveReceipt({ ...snapshot(),
            task: { state: 'none', sources: [] }, style: { state: 'unknown' } })).toBe(true);
    });

    it('clones v2 observed identity and complete lineage independently', () => {
        const input = snapshotV2();
        const cloned = cloneGenerationInputSnapshot(input);
        expect(cloned).toEqual(input);
        if (input.task.sources[0].revision.state === 'identified') input.task.sources[0].revision.digest.value = 'b'.repeat(40);
        if (input.lineage?.state === 'complete') input.lineage.dependencies[0].identity = 'changed';
        if (input.lineage?.state === 'complete'
            && input.lineage.dependencies[0].observedRevision?.state === 'identified') {
            input.lineage.dependencies[0].observedRevision.digest.value = 'c'.repeat(40);
        }
        expect(cloned).toEqual(snapshotV2());
        expect(JSON.stringify(cloned)).not.toContain('rawText');
        expect(generationInputNeedsRecoveryConfirmation({ ...snapshotV2(), lineage: undefined })).toBe(true);
        expect(generationInputRequiresConfirmationDespiteLiveReceipt({ ...snapshotV2(), lineage: undefined })).toBe(true);
        expect(generationInputRequiresConfirmationDespiteLiveReceipt(snapshotV2())).toBe(false);
        const editor = snapshotV2();
        editor.task.sources[0].revision = { state: 'identified', basis: 'editor_snapshot',
            digest: { algorithm: 'sha1', scope: 'editor_projection', value: 'c'.repeat(40) } };
        expect(generationInputRequiresConfirmationDespiteLiveReceipt(editor)).toBe(true);
        const partition = snapshotV2();
        partition.task.sources[0].revision = { state: 'identified', basis: 'vault_read',
            digest: { algorithm: 'sha1', scope: 'body_partition', value: 'd'.repeat(40) } };
        expect(generationInputRequiresConfirmationDespiteLiveReceipt(partition)).toBe(true);
        expect(generationInputRequiresConfirmationDespiteLiveReceipt({ ...snapshotV2(),
            task: { state: 'unknown', sources: [] } })).toBe(true);
        const skill = snapshotV2();
        skill.task.sources[0].kind = 'skill-guide';
        skill.task.sources[0].boundary = 'skill-context';
        expect(generationInputRequiresConfirmationDespiteLiveReceipt(skill)).toBe(true);
    });

    it.each([
        { ...snapshotV2(), task: { ...snapshotV2().task, sources: [
            { ...snapshotV2().task.sources[0], path: undefined }] } },
        { ...snapshotV2(), task: { ...snapshotV2().task, sources: [
            { ...snapshotV2().task.sources[0], revision: { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'bad' } } }] } },
        { ...snapshotV2(), task: { ...snapshotV2().task, sources: [
            { ...snapshotV2().task.sources[0], revision: { state: 'identified', basis: 'metadata_snapshot',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'a'.repeat(40) } } }] } },
        { ...snapshotV2(), lineage: { state: 'complete', dependencies: [{ kind: 'vault', identity: 'notes/source.md',
            rawText: 'forbidden' }] } },
        { ...snapshotV2(), lineage: { state: 'complete', dependencies: [{ kind: 'vault', identity: 'notes/source.md',
            observedRevision: { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'bad' } } }] } },
    ])('rejects malformed v2 revisions or lineage %#', value => {
        expect(() => cloneGenerationInputSnapshot(value)).toThrow();
        expect(generationInputRequiresConfirmationDespiteLiveReceipt(value)).toBe(true);
    });

    it('strictly clones content-free identities without sharing nested state', () => {
        const input = snapshot();
        const cloned = cloneGenerationInputSnapshot(input);
        expect(cloned).toEqual(input);
        input.task.sources[0].revision.path = 'mutated.md';
        if (input.personal.state === 'identified') input.personal.revisions[0].revisionId = 'changed';
        input.images[0].ref.assetId = 'changed';
        expect(cloned).toEqual(snapshot());
        expect(JSON.stringify(cloned)).not.toContain('rawText');
    });

    it.each([
        { ...snapshot(), extra: 'forbidden' },
        { ...snapshot(), schemaVersion: 2 },
        { ...snapshot(), parent: { state: 'identified', versionId: 'parent-1',
            textHash: { algorithm: 'sha256', value: 'not-a-hash' } } },
        { ...snapshot(), task: { ...snapshot().task,
            sources: [{ ...snapshot().task.sources[0], rawText: 'forbidden body' }] } },
        { ...snapshot(), task: { state: 'none', sources: snapshot().task.sources } },
        { ...snapshot(), task: { state: 'unknown', sources: [{ ...snapshot().task.sources[0],
            revision: { state: 'unknown', path: '../private.md' } }] } },
        { ...snapshot(), task: { state: 'unknown', sources: [{ ...snapshot().task.sources[0],
            revision: { state: 'unknown', url: 'data:text/plain,forbidden-body' } }] } },
        { ...snapshot(), task: { state: 'identified', sources: [{ ...snapshot().task.sources[0],
            kind: 'context-used', boundary: 'skill-context' }] } },
        { ...snapshot(), task: { state: 'unknown', sources: [{ ...snapshot().task.sources[0],
            kind: 'web-source', boundary: 'read-only-tool',
            revision: { state: 'unknown', url: 'https://example.com/source' } }] } },
        { ...snapshot(), personal: { state: 'identified', mode: 'governed', revisions: [] } },
        { ...snapshot(), style: { state: 'identified', revisionIds: [] } },
        { ...snapshot(), images: Array.from({ length: 2049 }, () => snapshot().images[0]) },
    ])('rejects malformed, body-bearing or unbounded persisted input %#', value => {
        expect(() => cloneGenerationInputSnapshot(value)).toThrow();
    });

    it('requires D13 confirmation only for identities that cannot be completely replayed', () => {
        const complete: GenerationInputSnapshot = { ...snapshot(), task: { state: 'none', sources: [] },
            insights: { state: 'none' }, pagelet: { state: 'none' } };
        expect(generationInputNeedsRecoveryConfirmation(complete)).toBe(false);
        for (const incomplete of [
            snapshot(),
            { ...complete, personal: { state: 'unknown' as const, mode: 'governed' as const } },
            { ...complete, insights: { state: 'unknown' as const, mode: 'governed' as const } },
            { ...complete, style: { state: 'unknown' as const } },
            { ...complete, pagelet: snapshot().pagelet },
        ]) expect(generationInputNeedsRecoveryConfirmation(incomplete)).toBe(true);
    });
});

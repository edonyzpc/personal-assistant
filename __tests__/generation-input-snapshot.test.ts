import {
    cloneGenerationInputSnapshot,
    generationInputNeedsRecoveryConfirmation,
    type GenerationInputSnapshot,
} from '../src/ai-services/generation-input-snapshot';

function snapshot(): GenerationInputSnapshot {
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

describe('persisted generation input snapshot', () => {
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

import { WritingStyleService, normalizeWritingScene, getWritingSceneDisplayValues } from '../src/chat/writing-style-service';
import { MemoryGovernanceCoordinator } from '../src/pa/memory-governance-coordinator';
import { InMemoryMemoryGovernanceRepository } from '../src/pa/memory-governance-persistence';
import { hashWritingStyleText } from '../src/pa/writing-style';

const scene = { writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel' };
const text = '我在旅途中，收集了一些温柔的光。';
async function harness() {
    const repository = new InMemoryMemoryGovernanceRepository();
    await repository.transact((state) => { state.policyStates.vault = { version: 1, mode: 'effect_based', contextProjectionMode: 'governed' }; });
    let current = await repository.initialize(), count = 0, enabled = true, allowed = true, sourceCurrent = true, snapshotAvailable = true;
    let service: WritingStyleService;
    const coordinator = new MemoryGovernanceCoordinator({ repository, opaqueVaultKey: 'vault', idFactory: () => `h-${++count}`,
        projectionCleanupPort: { invalidateGenerationClaim: ({ claimId }) => service.invalidateGenerationClaim(claimId),
            cleanupExactProjection: async () => undefined } });
    const get = jest.fn(async () => ({ id: 'version-1', text, textHash: hashWritingStyleText(text), conversationId: 'conv-1', messageId: 'msg-1' } as any));
    const source = jest.fn(async () => ({ allowed, isCurrent: () => sourceCurrent }));
    service = new WritingStyleService({ versions: { get }, coordinator, getStateSnapshot: () => snapshotAvailable ? ({ state: current, vaultScopeKey: 'vault' }) : null,
        isRuntimeEnabled: () => enabled, verifyNoteSource: source });
    const refresh = async () => { current = await repository.initialize(); };
    const prepare = () => service.prepare(scene, { remainingTextChars: 6000, remainingMemoryChars: 6000 });
    return { repository, coordinator, service, get, source, refresh, prepare, current: () => current,
        setEnabled: (value: boolean) => { enabled = value; }, setAllowed: (value: boolean) => { allowed = value; },
        setSnapshotAvailable: (value: boolean) => { snapshotAvailable = value; },
        setSourceCurrent: (value: boolean) => { sourceCurrent = value; } };
}

describe('host writing-style service', () => {
    it('revokes a durably forgotten style before delayed cleanup or projection refresh, while ordinary null caches retain it', async () => {
        const h = await harness();
        const added = await h.service.remember('version-1', scene, 'action');
        await h.refresh();
        const prepared = await h.prepare();
        await h.coordinator.pauseUse({ claimId: added.claimId });
        h.setSnapshotAvailable(false);
        h.setEnabled(false);
        expect(prepared.isGenerationRetained?.()).toBe(true);

        let enterCleanup!: () => void;
        let releaseCleanup!: () => void;
        const cleanupEntered = new Promise<void>(resolve => { enterCleanup = resolve; });
        const cleanupReleased = new Promise<void>(resolve => { releaseCleanup = resolve; });
        const initialize = h.repository.initialize.bind(h.repository);
        const heldInitialize = jest.spyOn(h.repository, 'initialize').mockImplementation(async () => {
            const state = await initialize();
            if (state.claims.some(claim => claim.id === added.claimId && claim.lifecycle === 'forget_pending')) {
                enterCleanup();
                await cleanupReleased;
            }
            return state;
        });
        const forget = h.coordinator.forget({ claimId: added.claimId });
        try {
            await cleanupEntered;
            expect(h.current().claims.find(claim => claim.id === added.claimId)?.lifecycle).toBe('active');
            expect(prepared.isGenerationRetained?.()).toBe(false);
        } finally {
            releaseCleanup();
        }
        await expect(forget).resolves.toMatchObject({ ok: true });
        heldInitialize.mockRestore();
    });

    it('revokes a selected style after Undo-add and its replay even before the projection cache refreshes', async () => {
        const h = await harness();
        const added = await h.service.remember('version-1', scene, 'action');
        await h.refresh();
        const prepared = await h.prepare();
        const eventId = h.current().changeEvents.find(event => event.claimId === added.claimId && event.kind === 'add')!.id;
        const invalidate = jest.spyOn(h.service, 'invalidateGenerationClaim');
        h.setSnapshotAvailable(false);
        const input = { eventId, action: { actionIdentity: 'undo-style-add', actionFingerprint: 'undo-style-add-fingerprint' } };
        const first = await h.coordinator.undoRecentChange(input);
        expect(first).toMatchObject({ ok: true });
        expect(h.current().claims.find(claim => claim.id === added.claimId)?.lifecycle).toBe('active');
        expect(prepared.isGenerationRetained?.()).toBe(false);
        await expect(h.coordinator.undoRecentChange(input)).resolves.toEqual(first);
        expect(invalidate.mock.calls).toEqual([[added.claimId], [added.claimId]]);
    });

    it.each(['pause', 'correction'] as const)('retains the current generation after ordinary %s Undo with a null cache', async change => {
        const h = await harness();
        const added = await h.service.remember('version-1', scene, 'action');
        await h.refresh();
        const prepared = await h.prepare();
        if (change === 'pause') await h.coordinator.pauseUse({ claimId: added.claimId });
        else await h.service.correct(added.claimId, 'Replacement sample', scene, 'correction');
        const state = await h.repository.initialize();
        const eventId = state.changeEvents.filter(event => event.claimId === added.claimId).at(-1)!.id;
        const invalidate = jest.spyOn(h.service, 'invalidateGenerationClaim');
        h.setSnapshotAvailable(false);
        await expect(h.coordinator.undoRecentChange({ eventId })).resolves.toMatchObject({ ok: true });
        expect(prepared.isGenerationRetained?.()).toBe(true);
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('reads the exact sample, permits paused inspection, and never substitutes a corrected revision', async () => {
        const h = await harness(); const added = await h.service.remember('version-1', scene, 'read-action'); await h.refresh();
        const [reference] = await h.service.readReferences([added.revisionId]);
        expect(reference.exactText).toBe(text); expect(reference.isCurrent()).toBe(true);
        await h.coordinator.pauseUse({ claimId: added.claimId }); await h.refresh();
        expect(reference.isCurrent()).toBe(false);
        expect((await h.service.readReferences([added.revisionId]))[0].exactText).toBe(text);
        await h.service.correct(added.claimId, 'Replacement sample', scene, 'correction'); await h.refresh();
        expect(await h.service.readReferences([added.revisionId])).toEqual([]);
        const latestId = h.current().claims.find((claim) => claim.id === added.claimId)!.activeRevisionId!;
        expect((await h.service.readReferences([latestId]))[0].exactText).toBe('Replacement sample');
        await h.coordinator.forget({ claimId: added.claimId }); await h.refresh();
        expect(await h.service.readReferences([latestId, added.revisionId])).toEqual([]);
    });
    it('fails closed for changed source, denied boundary, missing revision, cancellation and disabled access', async () => {
        const h = await harness(); const added = await h.service.remember('version-1', scene, 'read-action', { path: 'saved.md', contentHash: 'hash' }); await h.refresh();
        const [reference] = await h.service.readReferences([added.revisionId]);
        h.setSourceCurrent(false); expect(reference.isCurrent()).toBe(false);
        expect(await h.service.readReferences([added.revisionId])).toEqual([]);
        h.setSourceCurrent(true); h.setAllowed(false);
        expect(await h.service.readReferences([added.revisionId])).toEqual([]);
        h.source.mockRejectedValue(new Error('IO failed'));
        expect(await h.service.readReferences([added.revisionId, 'missing'])).toEqual([]);
        h.setEnabled(false); expect(await h.service.readReferences([added.revisionId])).toEqual([]);
        const abort = new AbortController(); abort.abort();
        await expect(h.service.readReferences([added.revisionId], abort.signal)).rejects.toThrow('cancelled');
    });
    it('binds exact verified writing version without saving a note or copying images', async () => {
        const h = await harness(); const result = await h.service.remember('version-1', scene, 'host-action'); await h.refresh();
        expect(result).toMatchObject({ claimId: expect.any(String), revisionId: expect.any(String) });
        expect(h.get).toHaveBeenCalledWith('version-1'); expect(h.source).not.toHaveBeenCalled();
        expect((await h.prepare()).revisionIds).toEqual([result.revisionId]);
        const stored = JSON.stringify(h.current()); expect(stored).toContain(text); expect(stored).not.toContain('associatedImages');
    });
    it('rechecks note existence/hash/boundary before every use and guards changes after prepare', async () => {
        const h = await harness(); const note = { path: 'saved.md', contentHash: 'note-hash' };
        await h.service.remember('version-1', scene, 'action', note); await h.refresh();
        const first = await h.prepare(); expect(first.context).toContain(text); expect(h.source).toHaveBeenCalledTimes(2);
        expect(first.isCurrent()).toBe(true); h.setSourceCurrent(false); expect(first.isCurrent()).toBe(false);
        h.setAllowed(false); expect((await h.prepare()).context).toBe(''); expect(h.source).toHaveBeenCalledTimes(3);
    });
    it('rejects an old prepared sample after pause, correction, Forget or any governance commit', async () => {
        const h = await harness(); const added = await h.service.remember('version-1', scene, 'action'); await h.refresh();
        const prepared = await h.prepare(); expect(prepared.isCurrent()).toBe(true);
        await h.coordinator.pauseUse({ claimId: added.claimId }); await h.refresh();
        expect(prepared.isCurrent()).toBe(false); expect((await h.prepare()).context).toBe('');
    });
    it('keeps prepared source validity after generation is cancelled', async () => {
        const h = await harness();
        const added = await h.service.remember('version-1', scene, 'action', { path: 'saved.md', contentHash: 'hash' });
        await h.refresh();
        const abort = new AbortController();
        const prepared = await h.service.prepare(scene, {
            remainingTextChars: 6000, remainingMemoryChars: 6000, signal: abort.signal,
        });
        expect(prepared.context).toContain(text);
        expect(prepared.revisionIds).toEqual([added.revisionId]);
        expect(prepared.isCurrent()).toBe(true);
        expect(prepared.isSourceCurrent?.()).toBe(true);

        abort.abort();

        expect(prepared.isCurrent()).toBe(false);
        expect(prepared.isSourceCurrent?.()).toBe(true);
        expect((await h.prepare()).revisionIds).toEqual([added.revisionId]);
    });
    it('revalidates an exact persisted style revision without binding unrelated governance commits', async () => {
        const h = await harness();
        const added = await h.service.remember('version-1', scene, 'action', { path: 'saved.md', contentHash: 'hash' });
        await h.refresh();
        const receipt = await h.service.captureGenerationSourceValidity([added.revisionId]);
        expect(receipt.isCurrent()).toBe(true);
        h.current().commitSequence++;
        expect(receipt.isCurrent()).toBe(true);
        h.setSourceCurrent(false);
        expect(receipt.isCurrent()).toBe(false);
    });
    it.each(['disabled runtime', 'pause', 'Forget', 'correction'] as const)(
        'rejects a persisted style revision after %s', async (change) => {
            const h = await harness();
            const added = await h.service.remember('version-1', scene, 'action');
            await h.refresh();
            const receipt = await h.service.captureGenerationSourceValidity([added.revisionId]);
            if (change === 'disabled runtime') h.setEnabled(false);
            else if (change === 'pause') await h.coordinator.pauseUse({ claimId: added.claimId });
            else if (change === 'Forget') await h.coordinator.forget({ claimId: added.claimId });
            else await h.service.correct(added.claimId, 'Replacement sample', scene, 'correction');
            await h.refresh();
            expect(receipt.isCurrent()).toBe(false);
            await expect(h.service.captureGenerationSourceValidity([added.revisionId]))
                .rejects.toThrow('Writing style source unavailable');
        },
    );
    it.each(['note source', 'disabled runtime', 'pause', 'Forget', 'correction', 'dispose'] as const)(
        'still revokes source validity after cancellation when %s changes', async (change) => {
            const h = await harness();
            const added = await h.service.remember('version-1', scene, 'action', { path: 'saved.md', contentHash: 'hash' });
            await h.refresh();
            const abort = new AbortController();
            const prepared = await h.service.prepare(scene, {
                remainingTextChars: 6000, remainingMemoryChars: 6000, signal: abort.signal,
            });
            expect(prepared.context).toContain(text);
            abort.abort();
            expect(prepared.isCurrent()).toBe(false);
            expect(prepared.isSourceCurrent?.()).toBe(true);

            switch (change) {
                case 'note source': h.setSourceCurrent(false); break;
                case 'disabled runtime': h.setEnabled(false); break;
                case 'pause': await h.coordinator.pauseUse({ claimId: added.claimId }); break;
                case 'Forget': await h.coordinator.forget({ claimId: added.claimId }); break;
                case 'correction': await h.service.correct(added.claimId, 'Replacement sample', scene, 'correction'); break;
                case 'dispose': h.service.dispose(); break;
            }
            await h.refresh();

            expect(prepared.isCurrent()).toBe(false);
            expect(prepared.isSourceCurrent?.()).toBe(false);
            expect(prepared.isGenerationRetained?.()).toBe(change !== 'Forget');
        },
    );
    it('snapshots commitSequence even if a host mutates its cached state object in place', async () => {
        const h = await harness(); await h.service.remember('version-1', scene, 'action'); await h.refresh();
        const result = await h.prepare(); h.current().commitSequence++;
        expect(result.isCurrent()).toBe(false);
        expect(result.isGenerationRetained?.()).toBe(true);
    });
    it('preserves independent authorization when the source conversation naturally disappears', async () => {
        const h = await harness(); await h.service.remember('version-1', scene, 'action'); await h.refresh();
        h.get.mockResolvedValue(null);
        expect((await h.prepare()).context).toContain(text); expect(h.get).toHaveBeenCalledTimes(1);
    });
    it('fails closed for disabled runtime, cancellation, dispose and unavailable note IO', async () => {
        const h = await harness(); await h.service.remember('version-1', scene, 'action', { path: 'saved.md', contentHash: 'hash' }); await h.refresh();
        h.setEnabled(false); expect((await h.prepare()).context).toBe(''); h.setEnabled(true);
        h.source.mockRejectedValue(new Error('source unavailable')); expect((await h.prepare()).context).toBe('');
        const abort = new AbortController(); abort.abort();
        await expect(h.service.prepare(scene, { remainingMemoryChars: 1, remainingTextChars: 1, signal: abort.signal })).rejects.toThrow('cancelled');
        h.service.dispose(); await expect(h.prepare()).rejects.toThrow('cancelled');
    });
    it('corrects exact samples through typed revision without depending on an active matching scene', async () => {
        const h = await harness(); const added = await h.service.remember('version-1', scene, 'action'); await h.refresh();
        await h.service.correct(added.claimId, '  更正的完整样例\n', { ...scene, domain: 'food' }, 'correct-action'); await h.refresh();
        expect((await h.prepare()).context).toBe('');
        expect((await h.service.prepare({ ...scene, domain: 'food' }, { remainingMemoryChars: 6000, remainingTextChars: 6000 })).context).toContain('更正的完整样例');
    });
});

describe('structured writing-scene normalization', () => {
    it('maps readable structured fields and display values to the same stable scene', () => {
        expect(normalizeWritingScene({ writingTask: '文案', purpose: '朋友圈', audience: '朋友', domain: '旅行' })).toEqual(scene);
        expect(normalizeWritingScene({ writingTask: '旅行短文', purpose: '分享旅行', audience: '好友', domain: '旅途' })).toEqual(scene);
        for (const locale of ['zh', 'en'] as const) expect(normalizeWritingScene(getWritingSceneDisplayValues(scene, locale))).toEqual(scene);
    });
});

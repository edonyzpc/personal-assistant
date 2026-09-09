import { WritingStyleService, normalizeWritingScene, inferWritingScene, hasConflictingWritingStyleInstruction, getWritingSceneDisplayValues } from '../src/chat/writing-style-service';
import { MemoryGovernanceCoordinator } from '../src/pa/memory-governance-coordinator';
import { InMemoryMemoryGovernanceRepository } from '../src/pa/memory-governance-persistence';
import { hashWritingStyleText } from '../src/pa/writing-style';

const scene = { writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel' };
const text = '我在旅途中，收集了一些温柔的光。';
async function harness() {
    const repository = new InMemoryMemoryGovernanceRepository();
    await repository.transact((state) => { state.policyStates.vault = { version: 1, mode: 'effect_based', contextProjectionMode: 'governed' }; });
    let current = await repository.initialize(), count = 0, enabled = true, allowed = true, sourceCurrent = true;
    const coordinator = new MemoryGovernanceCoordinator({ repository, opaqueVaultKey: 'vault', idFactory: () => `h-${++count}` });
    const get = jest.fn(async () => ({ id: 'version-1', text, textHash: hashWritingStyleText(text), conversationId: 'conv-1', messageId: 'msg-1' } as any));
    const source = jest.fn(async () => ({ allowed, isCurrent: () => sourceCurrent }));
    const service = new WritingStyleService({ versions: { get }, coordinator, getStateSnapshot: () => ({ state: current, vaultScopeKey: 'vault' }),
        isRuntimeEnabled: () => enabled, verifyNoteSource: source });
    const refresh = async () => { current = await repository.initialize(); };
    const prepare = () => service.prepare(scene, { remainingTextChars: 6000, remainingMemoryChars: 6000 });
    return { repository, coordinator, service, get, source, refresh, prepare, current: () => current,
        setEnabled: (value: boolean) => { enabled = value; }, setAllowed: (value: boolean) => { allowed = value; },
        setSourceCurrent: (value: boolean) => { sourceCurrent = value; } };
}

describe('host writing-style service', () => {
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
        },
    );
    it('snapshots commitSequence even if a host mutates its cached state object in place', async () => {
        const h = await harness(); await h.service.remember('version-1', scene, 'action'); await h.refresh();
        const result = await h.prepare(); h.current().commitSequence++;
        expect(result.isCurrent()).toBe(false);
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

describe('conservative local writing-scene mapping', () => {
    it('maps readable Chinese fields and explicit travel copy to the same stable scene', () => {
        expect(normalizeWritingScene({ writingTask: '文案', purpose: '朋友圈', audience: '朋友', domain: '旅行' })).toEqual(scene);
        expect(normalizeWritingScene({ writingTask: '旅行短文', purpose: '分享旅行', audience: '好友', domain: '旅途' })).toEqual(scene);
        expect(inferWritingScene('写旅行短文，分享旅行给朋友')).toEqual(scene);
        for (const locale of ['zh', 'en'] as const) expect(normalizeWritingScene(getWritingSceneDisplayValues(scene, locale))).toEqual(scene);
        expect(inferWritingScene('帮我写一段旅行朋友圈文案')).toEqual(scene);
        expect(inferWritingScene('帮我写工作邮件给同事')).toEqual({ writingTask: 'email', purpose: 'work_email', audience: 'colleagues', domain: 'work' });
    });
    it('does not inherit an unrelated parent scene or guess missing domains/audiences', () => {
        expect(inferWritingScene('帮我写文案', scene)).toBeUndefined();
        expect(inferWritingScene('帮我写工作邮件', scene)).toBeUndefined();
        expect(inferWritingScene('帮我看看这张图片', scene)).toBeUndefined();
        for (const prompt of ['改短一点', '短一点', '长一点', '再短一点', '换个说法', 'make it shorter']) {
            expect(inferWritingScene(prompt, scene)).toEqual(scene);
        }
        expect(inferWritingScene('换个话题，短一点', scene)).toBeUndefined();
        expect(inferWritingScene('new topic: make it shorter', scene)).toBeUndefined();
        expect(inferWritingScene('改写成工作邮件给同事', scene)).toEqual({ writingTask: 'email', purpose: 'work_email', audience: 'colleagues', domain: 'work' });
    });
    it.each(['不要参考旧风格', '这次换一种风格', '不要学我', '不要旅行风格', "don't use my previous style", 'ignore my previous style'])(
        'respects a current explicit refusal: %s', (prompt) => {
            expect(hasConflictingWritingStyleInstruction(prompt)).toBe(true); expect(inferWritingScene(`帮我写旅行朋友圈文案，${prompt}`, scene)).toBeUndefined();
        },
    );
});

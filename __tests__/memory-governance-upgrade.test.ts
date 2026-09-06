import { MemoryGovernanceUpgradeCoordinator, type MemoryGovernanceUpgradeOptions } from '../src/pa/memory-governance-upgrade';
import { MemoryGovernanceMigrationCoordinator, createTypeATargetSuppressionFingerprint } from '../src/pa/memory-governance-migration-coordinator';
import { InMemoryMemoryGovernanceRepository } from '../src/pa/memory-governance-persistence';
import { MemoryGovernanceCoordinator } from '../src/pa/memory-governance-coordinator';
import { createMemoryReviewQueueRepository } from '../src/pa/memory-review-queue-repository';
import { CallbackReviewQueueRepository, ReviewQueueStore } from '../src/pa/review-queue-store';
import { buildLegacyMemoryRollbackProjection } from '../src/pa/memory-governance-rollback';
import { hashLegacyMemoryPayload } from '../src/pa/memory-governance-migration';
import { renderUserProfileMarkdown, type UserProfileRecord } from '../src/ai-services/memory-extraction/type-a-extractor';
import type { UserProfileReadResult } from '../src/ai-services/memory-extraction/profile-store';
import type { PersistedTurn } from '../src/chat/chat-history-store';

const NOW = '2026-07-01T00:00:00.000Z';
const TEXT = 'Please always answer with bullet points.';
function row(extra: Partial<UserProfileRecord> = {}): UserProfileRecord {
    return { profileRecordId: 'profile-one', key: 'format', text: TEXT, kind: 'user_explicit', confidence: 'high',
        conversationId: 'chat-one', conversationIds: ['chat-one'], observedAt: NOW, occurrences: 1, confirmed: true, ...extra };
}
function profile(records = [row()]): UserProfileReadResult {
    return { state: 'ready', snapshot: { updatedAt: NOW, records, markdown: renderUserProfileMarkdown(records, new Date(NOW)) } };
}
function turn(text = TEXT, kind = 'ordinary_user_statement'): PersistedTurn {
    return { conversationId: 'chat-one', turnIndex: 0, user: { role: 'user', content: text,
        hostProvenance: { version: 1, messageId: 'message-one', kind } }, assistant: { role: 'assistant', content: 'OK' } } as PersistedTurn;
}
async function harness() {
    const repository = new InMemoryMemoryGovernanceRepository();
    const payload = { memoryGovernance: { records: [] }, reviewQueue: { items: [] }, confirmedMemoryCount: 0, memoryAutoAcceptPaused: false };
    await new MemoryGovernanceMigrationCoordinator({ repository, opaqueVaultKey: 'vault', payload, now: () => new Date(NOW) }).run();
    let rawProfile = profile();
    let leaseCurrent = true;
    const release = jest.fn(() => { leaseCurrent = false; });
    const reader = { read: jest.fn(async () => structuredClone(rawProfile)), acquireReadLease: jest.fn(async () => {
        leaseCurrent = true;
        return { result: structuredClone(rawProfile), isCurrent: () => leaseCurrent, release };
    }) };
    const options: MemoryGovernanceUpgradeOptions = {
        repository, opaqueVaultKey: 'vault', profileReader: reader,
        readLegacySource: jest.fn(async () => ({ sourceHash: hashLegacyMemoryPayload(payload),
            projection: { records: [], memoryQueueItems: [], confirmedMemoryCount: 0, memoryAutoAcceptPaused: false } })),
        readConversation: jest.fn(async () => [turn()]), isCurrent: jest.fn(() => true), isPathAllowed: jest.fn(() => true),
    };
    return { repository, reader, release, options, run: () => new MemoryGovernanceUpgradeCoordinator(options).run(),
        getProfile: () => rawProfile, setProfile: (value: UserProfileReadResult) => { rawProfile = value; },
        expire: () => { leaseCurrent = false; } };
}

describe('explicit compatibility upgrade', () => {
    it('preserves legitimate local queue add/dismiss deltas while the legacy source stays unchanged', async () => {
        const h = await harness();
        const settings = new CallbackReviewQueueRepository();
        const adapter = await createMemoryReviewQueueRepository({ repository: h.repository,
            settingsRepository: settings, opaqueVaultKey: 'vault', now: () => new Date(NOW) });
        const queue = new ReviewQueueStore({ repository: adapter, now: () => new Date(NOW), idFactory: () => 'local-candidate' });
        expect(await queue.create({ type: 'memory_candidate', title: 'Writing preference', claim: TEXT,
            scope: { kind: 'current_note', paths: ['notes/source.md'] }, sourceRefs: [{ path: 'notes/source.md' }], originSurface: 'pagelet',
            dataBoundarySnapshotId: 'boundary', admissionReason: 'memory_confirmation_required',
            metadata: { memoryType: 'preference', sensitivity: 'low' } })).toMatchObject({ ok: true });
        expect(await queue.updateStatus('local-candidate', 'dismissed')).toMatchObject({ ok: true });
        const before = await h.repository.initialize();
        const source = await h.options.readLegacySource();
        const rawProfile = structuredClone(h.getProfile());
        expect(source.projection.memoryQueueItems).toEqual([]);
        expect(settings.read().items).toEqual([]);
        expect(before.migrationDeltas.map((delta) => delta.kind)).toEqual(['queue_changed', 'queue_changed']);
        expect(buildLegacyMemoryRollbackProjection(before, 'vault', new Date(NOW))).toMatchObject({
            ok: true, projection: { memoryQueueItems: [{ id: 'local-candidate', status: 'dismissed' }] },
        });

        expect(await h.run()).toEqual({ ok: true, adoptedCount: 1 });
        const after = await h.repository.initialize();
        expect(after.policyStates.vault).toMatchObject({ mode: 'effect_based', contextProjectionMode: 'governed' });
        expect(after.memoryQueueItems).toEqual(before.memoryQueueItems);
        expect(after.migrationDeltas).toEqual(before.migrationDeltas);
        expect(after.rollbackPayloadEntries).toEqual(before.rollbackPayloadEntries);
        expect(after.migrationStates).toEqual(before.migrationStates);
        expect(await h.options.readLegacySource()).toEqual(source);
        expect(h.getProfile()).toEqual(rawProfile);
    });

    it('still rejects a damaged original rollback proof without adopting or rewriting anything', async () => {
        const h = await harness();
        await h.repository.transact((draft) => { draft.rollbackPayloadEntries[0].checksum = 'invalid-checksum'; });
        const before = await h.repository.initialize();
        const rawProfile = structuredClone(h.getProfile());
        expect(await h.run()).toEqual({ ok: false, reason: 'legacy_projection_mismatch' });
        expect(await h.repository.initialize()).toEqual(before);
        expect(h.getProfile()).toEqual(rawProfile);
        expect(h.reader.acquireReadLease).not.toHaveBeenCalled();
    });

    it('atomically maps the complete exact user source and preserves old Profile and expired rollback deadline', async () => {
        const h = await harness(); const before = await h.repository.initialize(); const raw = structuredClone(h.getProfile());
        expect(await h.run()).toEqual({ ok: true, adoptedCount: 1 });
        const after = await h.repository.initialize();
        expect(after.commitSequence).toBe(before.commitSequence + 1);
        expect(after.policyStates.vault).toMatchObject({ mode: 'effect_based', contextProjectionMode: 'governed' });
        expect(after.migrationStates).toEqual(before.migrationStates);
        expect(after.rollbackPayloadEntries).toEqual(before.rollbackPayloadEntries);
        expect(after.migrationDeltas).toEqual(before.migrationDeltas);
        expect(after.revisions[0].summary).toBe(TEXT);
        expect(after.projectionLinks.map((link) => link.target.kind).sort()).toEqual(['prompt_projection', 'type_a_profile']);
        expect(after.pendingOperations).toEqual([]);
        expect(h.getProfile()).toEqual(raw); expect(h.release).toHaveBeenCalledTimes(1);
        expect(buildLegacyMemoryRollbackProjection(after, 'vault', new Date('2026-09-06'))).toMatchObject({ ok: false, reason: 'rollback_window_expired' });
        expect(await h.run()).toMatchObject({ ok: false, reason: 'upgrade_not_available' });
        expect(await h.repository.initialize()).toEqual(after);
    });

    it.each([
        [row({ profileRecordId: undefined }), 'profile_invalid'],
        [row({ kind: 'inferred_behavior' }), 'profile_evidence_unsupported'],
        [row({ text: 'My medical diagnosis is private.' }), 'profile_evidence_unsupported'],
        [row({ text: `${TEXT} Keep them short.` }), 'conversation_evidence_mismatch'],
    ])('never sanitizes or skips an unverifiable row: %s', async (bad, reason) => {
        const h = await harness(); h.setProfile(profile([row(), { ...bad, key: 'second', profileRecordId: bad.profileRecordId ? 'second' : undefined }]));
        const before = await h.repository.initialize(); const raw = structuredClone(h.getProfile());
        expect(await h.run()).toEqual({ ok: false, reason });
        expect(await h.repository.initialize()).toEqual(before); expect(h.getProfile()).toEqual(raw);
        expect(h.reader.acquireReadLease).not.toHaveBeenCalled();
    });

    it.each(['writing_request', 'user_local_edit', 'explicit_style_action'])('does not accept %s as ordinary source authority', async (kind) => {
        const h = await harness(); h.options.readConversation = async () => [turn(TEXT, kind)];
        const before = await h.repository.initialize();
        expect(await h.run()).toMatchObject({ ok: false, reason: 'conversation_evidence_mismatch' });
        expect(await h.repository.initialize()).toEqual(before);
    });

    it('does not treat missing history or a mismatched markdown projection as empty', async () => {
        const h = await harness(); h.options.readConversation = async () => undefined;
        const before = await h.repository.initialize();
        expect(await h.run()).toMatchObject({ ok: false, reason: 'conversation_missing' });
        const raw = profile(); if (raw.state === 'ready' && raw.snapshot) raw.snapshot.markdown += '\n- Unregistered preference';
        h.setProfile(raw);
        expect(await h.run()).toMatchObject({ ok: false, reason: 'profile_projection_mismatch' });
        expect(await h.repository.initialize()).toEqual(before);
    });

    it('reuses an exact governed revision without recreating source history or resetting identity', async () => {
        const h = await harness(); await h.run();
        await h.repository.transact((draft) => {
            draft.policyStates.vault.mode = 'legacy_threshold'; draft.policyStates.vault.contextProjectionMode = 'legacy';
            draft.projectionLinks = draft.projectionLinks.filter((link) => link.target.kind !== 'prompt_projection');
        });
        const before = await h.repository.initialize(); h.options.readConversation = async () => undefined;
        expect(await h.run()).toEqual({ ok: true, adoptedCount: 1 });
        const after = await h.repository.initialize();
        expect(after.claims).toEqual(before.claims); expect(after.revisions).toEqual(before.revisions);
        expect(after.migrationStates).toEqual(before.migrationStates);
    });

    it('cannot resurrect a corrected or forgotten target', async () => {
        const h = await harness();
        await h.repository.transact((draft) => { draft.suppressionMarkers.push({ id: 'forgotten', partition: { kind: 'vault', key: 'vault' },
            sourceFingerprintId: createTypeATargetSuppressionFingerprint('vault', 'profile-one'), ruleFingerprint: 'type-a-target-suppression-v1',
            reason: 'forgotten', createdAt: NOW, updatedAt: NOW }); });
        const before = await h.repository.initialize();
        expect(await h.run()).toMatchObject({ ok: false, reason: 'source_suppressed' });
        expect(await h.repository.initialize()).toEqual(before);
    });

    it('leaves pending removal, changed revision and dangling Profile projections unchanged', async () => {
        const h = await harness(); await h.run();
        await h.repository.transact((draft) => {
            draft.policyStates.vault.mode = 'legacy_threshold'; draft.policyStates.vault.contextProjectionMode = 'legacy';
            const claim = draft.claims[0];
            draft.pendingOperations.push({ id: 'pending', kind: 'profile_projection', claimId: claim.id, profileRecordId: 'profile-one',
                targetRevisionId: claim.activeRevisionId!, state: 'pending', attemptCount: 0, createdAt: NOW, updatedAt: NOW });
        });
        let before = await h.repository.initialize();
        expect(await h.run()).toMatchObject({ ok: false, reason: 'pending_operations' }); expect(await h.repository.initialize()).toEqual(before);
        await h.repository.transact((draft) => { draft.pendingOperations = []; draft.revisions[0].summary = 'Corrected'; });
        before = await h.repository.initialize();
        expect(await h.run()).toMatchObject({ ok: false, reason: 'profile_projection_mismatch' }); expect(await h.repository.initialize()).toEqual(before);
        h.setProfile({ state: 'ready', snapshot: null });
        expect(await h.run()).toMatchObject({ ok: false, reason: 'profile_projection_mismatch' }); expect(await h.repository.initialize()).toEqual(before);
    });

    it.each(['profile', 'history', 'legacy', 'governance', 'lease', 'boundary'])('rechecks %s at the final commit boundary', async (change) => {
        const h = await harness(); const initial = await h.repository.initialize();
        if (change === 'profile') h.reader.acquireReadLease.mockImplementation(async () => ({
            result: profile([row({ text: 'Please always answer concisely.' })]), isCurrent: () => true, release: h.release,
        }));
        if (change === 'history') {
            let calls = 0; h.options.readConversation = async () => ++calls === 1 ? [turn()] : [turn('Changed')];
        }
        if (change === 'legacy') {
            const read = h.options.readLegacySource; let calls = 0;
            h.options.readLegacySource = async () => ({ ...(await read()), ...(++calls > 1 ? { sourceHash: 'changed' } : {}) });
        }
        if (change === 'governance') {
            const acquire = h.reader.acquireReadLease.getMockImplementation()!;
            h.reader.acquireReadLease.mockImplementation(async () => {
                await h.repository.transact((draft) => { draft.policyStates.vault.legacyBaseline!.confirmedCount += 1; });
                return acquire();
            });
        }
        if (change === 'lease' || change === 'boundary') {
            const transact = h.repository.transact.bind(h.repository);
            jest.spyOn(h.repository, 'transact').mockImplementation((operation, assertCurrent) => transact(async (draft) => {
                const result = await operation(draft);
                if (change === 'lease') h.expire(); else h.options.isCurrent = () => false;
                return result;
            }, assertCurrent));
        }
        expect(await h.run()).toMatchObject({ ok: false });
        const after = await h.repository.initialize();
        expect(after.claims).toEqual(initial.claims); expect(after.revisions).toEqual(initial.revisions);
        expect(after.policyStates.vault.mode).toBe('legacy_threshold'); expect(h.release).toHaveBeenCalledTimes(1);
    });

    it.each(['not_present', 'unknown', 'unavailable', 'error'] as const)('keeps %s distinct and never initializes or creates Profile', async (state) => {
        const h = await harness(); h.setProfile(state === 'error' ? { state, errorCode: 'failed' } : { state });
        h.reader.acquireReadLease.mockImplementation(async () => ({ result: h.getProfile(), isCurrent: () => false, release: h.release }));
        const before = await h.repository.initialize();
        expect(await h.run()).toMatchObject({ ok: false, reason: state === 'not_present' ? 'profile_absence_unlocked' : `profile_${state}` });
        expect(await h.repository.initialize()).toEqual(before);
    });

    it('uses ordinary governed Forget after upgrade and leaves no Profile text for a legacy rollback', async () => {
        const h = await harness(); expect((await h.run()).ok).toBe(true);
        const state = await h.repository.initialize(); let ids = 0;
        const coordinator = new MemoryGovernanceCoordinator({ repository: h.repository, opaqueVaultKey: 'vault', now: () => new Date('2026-07-02'),
            idFactory: () => `forget-${++ids}`, projectionCleanupPort: { cleanupExactProjection: async ({ projectionLink }) => {
                if (projectionLink.target.kind === 'type_a_profile') h.setProfile(profile([]));
            } } });
        expect(await coordinator.forget({ claimId: state.claims[0].id })).toMatchObject({ ok: true });
        const after = await h.repository.initialize();
        expect(JSON.stringify(h.getProfile())).not.toContain(TEXT);
        expect(JSON.stringify(buildLegacyMemoryRollbackProjection(after, 'vault', new Date('2026-07-02')))).not.toContain(TEXT);
        expect(after.migrationStates.vault.rollbackExpiresAt).toBe(state.migrationStates.vault.rollbackExpiresAt);
    });
});

import { FakeGovernanceIndexedDbFactory, seedLegacyFactory, cloneStores } from "./helpers/fake-governance-indexeddb";
import { stableHash } from '../src/pa/helpers';
import { CHAT_MEMORY_SEMANTIC_RULE, chatMemorySemanticSourceFingerprint, type ChatMemorySemanticReceipt } from '../src/pa/chat-memory-semantic-receipt';
import {
    MEMORY_GOVERNANCE_LOGICAL_STORES,
    IndexedDbMemoryGovernanceRepository,
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    getMemoryGovernanceDeviceDbName,
    normalizeDeviceMemoryGovernanceStateV1,
    validateDeviceMemoryGovernanceStateV1,
    type DeviceMemoryGovernanceStateV1,
} from "../src/pa/memory-governance-persistence";

describe("Memory governance V1 state", () => {
    it.each(['valid', 'legacy-schema', 'missing-key', 'raw-key', 'unknown-store', 'wrong-outbox', 'undo-missing-key'] as const)(
        'retains governed Profile routing and opaque identity or rejects %s before a whitelist can discard it', (variant) => {
            const state = createCompleteState();
            state.schemaVersion = 3;
            const target = { kind: 'type_a_profile' as const, profileRecordId: 'profile-1',
                store: 'governed' as const, profileKey: 'semantic-1234abcd' };
            state.projectionLinks[0].target = target;
            state.undoSnapshots[0].projectionLinks = [{ ...state.projectionLinks[0], target: { ...target } }];
            Object.assign(state.pendingOperations[0], { profileStore: 'governed', profileKey: target.profileKey });
            if (variant === 'legacy-schema') state.schemaVersion = 2;
            if (variant === 'missing-key') Object.assign(target, { profileKey: undefined });
            if (variant === 'raw-key') target.profileKey = 'A personal statement must not survive Forget';
            if (variant === 'unknown-store') Object.assign(target, { store: 'legacy' });
            if (variant === 'wrong-outbox') Object.assign(state.pendingOperations[0], { profileKey: 'semantic-ffffffff' });
            if (variant === 'undo-missing-key') Object.assign(state.undoSnapshots[0].projectionLinks[0].target, { profileKey: undefined });
            const parsed = normalizeDeviceMemoryGovernanceStateV1(state);
            if (variant === 'valid') {
                expect(parsed?.projectionLinks[0].target).toEqual(target);
                expect(parsed?.undoSnapshots[0].projectionLinks[0].target).toEqual(target);
                expect(parsed?.pendingOperations[0]).toMatchObject({ profileStore: 'governed', profileKey: target.profileKey });
            } else expect(parsed).toBeNull();
        },
    );
    it.each([1, 2, 3] as const)('only accepts the preserving migration phase in schema 3 (input %s)', (schemaVersion) => {
        const state = createCompleteState();
        state.schemaVersion = schemaVersion;
        state.migrationStates.vault.phase = 'governed_preserving_legacy';
        const parsed = normalizeDeviceMemoryGovernanceStateV1(state);
        if (schemaVersion === 3) expect(parsed?.migrationStates.vault.phase).toBe('governed_preserving_legacy');
        else expect(parsed).toBeNull();
    });
    it.each(['memory', 'indexeddb'] as const)('retains bound receipts in revisions, queue admission and Undo after %s readback', async (backend) => {
        const source = createReceiptState();
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = backend === 'memory' ? new InMemoryMemoryGovernanceRepository() : createIndexedRepository(factory);
        await repository.transact((draft) => { Object.assign(draft, source); });
        const before = await repository.initialize();
        const reader = backend === 'memory' ? repository : createIndexedRepository(factory);
        const read = await reader.initialize();
        expect(read).toEqual(before);
        expect(read.revisions[0].chatSemanticReceipt).toEqual(source.revisions[0].chatSemanticReceipt);
        expect(read.memoryQueueItems[0].governanceAdmission?.chatSemanticReceipt).toEqual(source.revisions[0].chatSemanticReceipt);
        expect(read.undoSnapshots[0]).toMatchObject({ revisions: [expect.objectContaining({ chatSemanticReceipt: source.revisions[0].chatSemanticReceipt })] });
        await reader.dispose();
        if (reader !== repository) await repository.dispose();
    });

    it.each(['revision', 'queue', 'undo', 'misplaced', 'legacy1', 'legacy2', 'null', 'missing', 'rule', 'fingerprint', 'conversation', 'extra-conversation', 'extra-note'] as const)('rejects invalid or unsupported receipt placement: %s', (location) => {
        const source = createReceiptState();
        if (location === 'revision') source.revisions[0].summary = 'Different candidate';
        if (location === 'queue') source.memoryQueueItems[0].claim = 'Different queue claim';
        if (location === 'undo') Object.assign(source.undoSnapshots[0], { revisions: [{ ...source.revisions[0], chatSemanticReceipt: null }] });
        if (location === 'misplaced') Object.assign(source.pendingOperations[0], { chatSemanticReceipt: source.revisions[0].chatSemanticReceipt });
        if (location === 'legacy1') source.schemaVersion = 1;
        if (location === 'legacy2') source.schemaVersion = 2;
        if (location === 'null') Object.assign(source.revisions[0], { chatSemanticReceipt: null });
        if (location === 'missing') delete source.memoryQueueItems[0].governanceAdmission!.chatSemanticReceipt;
        if (location === 'rule') source.memoryQueueItems[0].governanceAdmission!.ruleFingerprint = 'other-rule';
        if (location === 'fingerprint') source.memoryQueueItems[0].governanceAdmission!.sourceFingerprintId = 'other-source';
        if (location === 'conversation') source.memoryQueueItems[0].governanceAdmission!.provenance = [{ kind: 'conversation', conversationIds: ['other-conversation'], observedAt: '2026-09-09T00:00:00Z' }];
        if (location === 'extra-conversation') source.revisions[0].provenance = [{ kind: 'conversation', conversationIds: ['unproven', 'conversation'], observedAt: '2026-09-09T00:00:00Z' }];
        if (location === 'extra-note') source.memoryQueueItems[0].governanceAdmission!.provenance.push({ kind: 'note', sourceRef: { path: 'unproven.md' } });
        expect(normalizeDeviceMemoryGovernanceStateV1(source)).toBeNull();
    });
    it('does not make an unknown additive receipt a required admission condition', () => {
        const source = createCompleteState();
        const provenance = [{ kind: 'conversation' as const, conversationIds: ['conversation'], observedAt: '2026-09-09T00:00:00Z' }];
        source.revisions[0].provenance = provenance;
        Object.assign(source.revisions[0], { b135ProbeReceipt: { version: 1, candidateHash: 'bound-candidate' } });
        source.memoryQueueItems.push({ id: 'queue-probe', type: 'memory_candidate', partition: { kind: 'vault', key: 'vault' },
            title: 'Synthetic candidate', claim: 'Prefer concise replies', scope: { kind: 'selected_notes', paths: ['notes/source.md'] },
            sourceRefs: [], originSurface: 'chat', priority: 'normal', status: 'suggested',
            createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', whyShown: [], dataBoundarySnapshotId: 'boundary',
            governanceAdmission: { version: 1, origin: 'type_a', memoryType: 'preference', sensitivity: 'low', authority: 'explicit_user',
                effect: 'future_answers', applicability: { kind: 'selected_notes', paths: ['notes/source.md'] }, provenance,
                sourceFingerprintId: 'source-probe', ruleFingerprint: 'b135-semantic-probe', admissionKey: 'probe' },
        });
        Object.assign(source.memoryQueueItems[0].governanceAdmission!, { b135ProbeReceipt: { version: 1, candidateHash: 'bound-candidate' } });
        expect(validateDeviceMemoryGovernanceStateV1(source)).toEqual({ ok: true });
        const read = normalizeDeviceMemoryGovernanceStateV1(source);
        expect(read).not.toBeNull();
        expect(read!.revisions[0]).not.toHaveProperty('b135ProbeReceipt');
        expect(read!.revisions[0].summary).toBe('Prefer concise replies');
        expect(read!.memoryQueueItems[0].governanceAdmission).not.toHaveProperty('b135ProbeReceipt');
        expect(read!.memoryQueueItems[0].governanceAdmission?.ruleFingerprint).toBe('b135-semantic-probe');
    });

    it.each(['revision', 'schema'] as const)('rejects the whole state instead of discarding unsupported %s data', (boundary) => {
        const source = createCompleteState();
        if (boundary === 'revision') Object.assign(source.revisions[0].provenance[0], { kind: 'b135_unsupported_probe' });
        else Object.assign(source, { schemaVersion: 99999 });
        expect(normalizeDeviceMemoryGovernanceStateV1(source)).toBeNull();
        expect(() => new InMemoryMemoryGovernanceBackend(source)).toThrow();
        expect(source.claims[0].id).toBe('claim-1');
        expect(source.revisions[0].summary).toBe('Prefer concise replies');
    });
    it('rejects invalidation between the repository callback and the in-memory backend commit', async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const before = await repository.initialize(); const controller = new AbortController();
        const guard = Object.assign(jest.fn(), { signal: controller.signal });
        await expect(repository.transact((draft) => {
            draft.policyStates.vault = createPolicyState(1);
            // The second microtask runs after the repository callback resumes,
            // but before the backend resumes its await and commits the state.
            queueMicrotask(() => queueMicrotask(() => controller.abort()));
        }, guard)).rejects.toMatchObject({ code: 'commit_conflict' });
        expect(await repository.initialize()).toEqual(before); expect(guard).not.toHaveBeenCalled();
        await repository.dispose();
    });

    it.each(['memory', 'indexeddb'])('checks the source guard at %s commit and preserves state if it fails', async (backend) => {
        const repository = backend === 'memory' ? new InMemoryMemoryGovernanceRepository()
            : createIndexedRepository(new FakeGovernanceIndexedDbFactory());
        const before = await repository.initialize();
        let mutationFinished = false;
        const guard = jest.fn(() => { expect(mutationFinished).toBe(true); throw new Error('Source changed'); });
        await expect(repository.transact(async (draft) => {
            draft.policyStates.vault = createPolicyState(1);
            await Promise.resolve(); mutationFinished = true;
        }, guard)).rejects.toThrow('Source changed');
        expect(guard).toHaveBeenCalledTimes(1);
        expect(await repository.initialize()).toEqual(before);
        await repository.dispose();
    });

    it("creates a complete clone-safe empty schema", () => {
        const first = createEmptyDeviceMemoryGovernanceStateV1();
        expect(first).toEqual({
            schemaVersion: 3,
            commitSequence: 0,
            claims: [],
            revisions: [],
            memoryQueueItems: [],
            projectionLinks: [],
            changeEvents: [],
            undoSnapshots: [],
            suppressionMarkers: [],
            pendingOperations: [],
            policyStates: {},
            migrationStates: {},
            migrationDeltas: [],
            rollbackPayloadEntries: [],
        });

        first.claims.push({} as never);
        expect(createEmptyDeviceMemoryGovernanceStateV1().claims).toEqual([]);
    });

    it("normalizes a complete state without exposing mutable nested values", () => {
        const source = createCompleteState();
        const normalized = normalizeDeviceMemoryGovernanceStateV1(source);

        expect(normalized).not.toBeNull();
        expect(validateDeviceMemoryGovernanceStateV1(source)).toEqual({ ok: true });
        normalized!.claims[0].applicability.paths!.push("mutated.md");
        normalized!.revisions[0].provenance[0].kind === "note"
            && normalized!.revisions[0].provenance[0].sourceRef.whyShown?.push("mutated");
        expect(source.claims[0].applicability.paths).toEqual(["notes/source.md"]);
        const noteProvenance = source.revisions[0].provenance[0];
        expect(noteProvenance.kind === "note" && noteProvenance.sourceRef.whyShown).toEqual(["source"]);
    });

    it("fails closed for invalid references and forbidden persisted text", () => {
        const missingRevision = createCompleteState();
        missingRevision.claims[0].activeRevisionId = "missing";
        expect(validateDeviceMemoryGovernanceStateV1(missingRevision)).toEqual({
            ok: false,
            reason: "claim_active_revision_missing",
        });

        const forbiddenMarker = createCompleteState() as unknown as Record<string, unknown>;
        (forbiddenMarker.suppressionMarkers as Array<Record<string, unknown>>)[0].rawMemoryText = "secret";
        expect(validateDeviceMemoryGovernanceStateV1(forbiddenMarker)).toEqual({
            ok: false,
            reason: "invalid_suppression_marker",
        });
        expect(normalizeDeviceMemoryGovernanceStateV1(forbiddenMarker)).toBeNull();
    });

    it("round-trips a text-free automatic-add Undo snapshot with exact links", () => {
        const source = createCompleteState();
        source.changeEvents[0].kind = "add";
        source.undoSnapshots = [{
            id: "undo-1",
            claimId: "claim-1",
            eventId: "event-1",
            partition: { kind: "vault", key: "vault" },
            restoreMode: "remove_added_claim",
            revisions: [],
            projectionLinks: [source.projectionLinks[0]],
            createdAt: "2026-07-10T08:00:00.000Z",
            expiresAt: "2026-07-17T08:00:00.000Z",
        }];

        const normalized = normalizeDeviceMemoryGovernanceStateV1(source);
        expect(normalized?.undoSnapshots[0]).toMatchObject({
            restoreMode: "remove_added_claim",
            projectionLinks: [expect.objectContaining({ id: "link-1" })],
        });

        const invalid = JSON.parse(JSON.stringify(source));
        invalid.undoSnapshots[0].claim = source.claims[0];
        expect(normalizeDeviceMemoryGovernanceStateV1(invalid)).toBeNull();
    });

    it("requires text-free removal deltas and a content payload for every other delta", () => {
        const removal = createCompleteState();
        removal.migrationDeltas = [{
            sequence: 1,
            migrationRunId: "migration-1",
            partition: { kind: "vault", key: "vault" },
            committedAt: "2026-07-10T08:00:00.000Z",
            kind: "claim_removed",
            entityId: "claim-1",
        }];
        removal.rollbackPayloadEntries = [];
        expect(normalizeDeviceMemoryGovernanceStateV1(removal)).not.toBeNull();

        const removalWithPayload = JSON.parse(JSON.stringify(removal));
        removalWithPayload.migrationDeltas[0].payloadEntryId = "payload";
        removalWithPayload.migrationDeltas[0].payloadChecksum = "checksum";
        expect(normalizeDeviceMemoryGovernanceStateV1(removalWithPayload)).toBeNull();

        const changedWithoutPayload = JSON.parse(JSON.stringify(removal));
        changedWithoutPayload.migrationDeltas[0].kind = "claim_changed";
        expect(normalizeDeviceMemoryGovernanceStateV1(changedWithoutPayload)).toBeNull();
    });
});

describe("InMemoryMemoryGovernanceRepository", () => {
    it("serializes cross-connection writes with monotonic commitSequence", async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const first = new InMemoryMemoryGovernanceRepository(backend);
        const second = new InMemoryMemoryGovernanceRepository(backend);
        const seen: number[] = [];
        first.subscribe((sequence) => seen.push(sequence));
        await Promise.all([first.initialize(), second.initialize()]);

        await Promise.all(Array.from({ length: 20 }, (_, index) => {
            const repository = index % 2 === 0 ? first : second;
            return repository.transact(async (draft) => {
                const current = draft.policyStates.vault?.legacyBaseline?.confirmedCount ?? 0;
                await Promise.resolve();
                draft.policyStates.vault = createPolicyState(current + 1);
            });
        }));

        const snapshot = await second.initialize();
        expect(snapshot.commitSequence).toBe(20);
        expect(snapshot.policyStates.vault.legacyBaseline?.confirmedCount).toBe(20);
        expect(seen).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    });

    it("commits only after a valid operation succeeds and returns clone-safe state", async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const repository = new InMemoryMemoryGovernanceRepository(backend);
        const notifications: number[] = [];
        repository.subscribe((sequence) => notifications.push(sequence));

        await expect(repository.transact((draft) => {
            draft.policyStates.vault = createPolicyState(1);
            throw new Error("operation failed");
        })).rejects.toThrow("operation failed");
        expect((await repository.initialize()).commitSequence).toBe(0);
        expect(notifications).toEqual([]);

        await expect(repository.transact((draft) => {
            (draft as unknown as { schemaVersion: number }).schemaVersion = 99;
            draft.policyStates.vault = createPolicyState(1);
        })).resolves.toBeUndefined();
        const first = await repository.initialize();
        expect(first.schemaVersion).toBe(3);
        expect(first.commitSequence).toBe(1);
        first.policyStates.vault.legacyBaseline!.confirmedCount = 99;
        expect((await repository.initialize()).policyStates.vault.legacyBaseline?.confirmedCount).toBe(1);
    });

    it("rejects new work after dispose", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        await repository.initialize();
        await repository.dispose();

        await expect(repository.initialize()).rejects.toMatchObject({ code: "repository_disposed" });
        await expect(repository.transact(() => undefined)).rejects.toMatchObject({ code: "repository_disposed" });
        expect(() => repository.subscribe(() => undefined)).toThrow(expect.objectContaining({
            code: "repository_disposed",
        }));
    });
});

describe("IndexedDbMemoryGovernanceRepository", () => {
    it.each([1, 2] as const)('does not strip an unsupported receipt during V%s upgrade', async (oldVersion) => {
        const factory = new FakeGovernanceIndexedDbFactory();
        seedLegacyFactory(factory, createReceiptState());
        factory.backend.version = oldVersion;
        factory.backend.getStore('meta').set('device-state-v1', { schemaVersion: oldVersion, commitSequence: 7 });
        const before = cloneStores(factory.backend.stores);
        const repository = createIndexedRepository(factory);
        await expect(repository.initialize()).rejects.toMatchObject({ code: 'database_open_failed' });
        expect(factory.backend.stores).toEqual(before);
        expect(factory.backend.version).toBe(oldVersion);
        await repository.dispose();
    });
    it.each([1, 2] as const)('upgrades a complete V%s transaction in place without inventing receipts and prevents old-version reopen', async (oldVersion) => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const original = createCompleteState(); seedLegacyFactory(factory, original);
        original.schemaVersion = oldVersion;
        factory.backend.version = oldVersion;
        factory.backend.getStore('meta').set('device-state-v1', { schemaVersion: oldVersion, commitSequence: original.commitSequence });
        const repository = createIndexedRepository(factory);
        const upgraded = await repository.initialize();
        expect(upgraded).toEqual({ ...normalizeDeviceMemoryGovernanceStateV1(original), schemaVersion: 3 });
        expect(factory.backend.version).toBe(3);
        expect(upgraded.revisions[0]).not.toHaveProperty('chatSemanticReceipt');
        const oldOpen = factory.open('old-writer', oldVersion);
        await expect(new Promise((resolve, reject) => { oldOpen.onsuccess = resolve; oldOpen.onerror = () => reject(oldOpen.error); }))
            .rejects.toMatchObject({ name: 'VersionError' });
        expect(await repository.initialize()).toEqual(upgraded); await repository.dispose();
    });

    it.each([[1, 'invalid-state'], [1, 'upgrade-commit-failed'], [2, 'invalid-state'], [2, 'upgrade-commit-failed']] as const)('aborts V%s upgrade without changing the original stores: %s', async (oldVersion, failure) => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const original = createCompleteState();
        if (failure === 'invalid-state') original.claims.push({ ...original.claims[0] });
        seedLegacyFactory(factory, original);
        factory.backend.version = oldVersion;
        factory.backend.getStore('meta').set('device-state-v1', { schemaVersion: oldVersion, commitSequence: original.commitSequence });
        if (failure === 'upgrade-commit-failed') factory.backend.failNextWriteCommit = true;
        const before = cloneStores(factory.backend.stores);
        const repository = createIndexedRepository(factory);
        await expect(repository.initialize()).rejects.toMatchObject({ code: 'database_open_failed' });
        expect(factory.backend.version).toBe(oldVersion); expect(factory.backend.stores).toEqual(before); await repository.dispose();
    });

    it.each(['logical-schema', 'database-version'] as const)(
        'preserves opaque future governance data when the current reader rejects %s, including write and reopen attempts',
        async (boundary) => {
            const factory = new FakeGovernanceIndexedDbFactory();
            const source = createCompleteState();
            seedLegacyFactory(factory, source);
            factory.backend.version = boundary === 'database-version' ? 4 : 3;
            factory.backend.getStore('meta').set('device-state-v1', {
                schemaVersion: 4,
                commitSequence: source.commitSequence,
            });
            const revision = factory.backend.getStore('revisions').get('0') as Record<string, unknown>;
            revision.b135ProbeReceipt = { version: 1, candidateHash: 'future-source-bound-candidate' };
            const before = cloneStores(factory.backend.stores);
            const expectedError = { code: boundary === 'database-version' ? 'database_open_failed' : 'invalid_state' };
            for (let attempt = 0; attempt < 2; attempt++) {
                const repository = createIndexedRepository(factory);
                const changed = jest.fn();
                const mutate = jest.fn();
                repository.subscribe(changed);
                await expect(repository.initialize()).rejects.toMatchObject(expectedError);
                await expect(repository.transact(mutate)).rejects.toMatchObject(expectedError);
                expect(mutate).not.toHaveBeenCalled();
                expect(changed).not.toHaveBeenCalled();
                await repository.dispose();
                expect(factory.backend.stores).toEqual(before);
                expect(factory.backend.version).toBe(boundary === 'database-version' ? 4 : 3);
            }
        },
    );

    it("creates the complete logical schema under one device-shared database name", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);

        await expect(repository.initialize()).resolves.toEqual(createEmptyDeviceMemoryGovernanceStateV1());

        expect(factory.openCalls).toEqual([{
            name: getMemoryGovernanceDeviceDbName("personal-assistant"),
            version: 3,
        }]);
        expect([...factory.backend.stores.keys()].sort()).toEqual([
            "meta",
            ...MEMORY_GOVERNANCE_LOGICAL_STORES,
        ].sort());
        await repository.dispose();
    });

    it("uses IndexedDB CAS/retry across connections without losing writes", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const first = createIndexedRepository(factory);
        const second = createIndexedRepository(factory);
        const firstSeen: number[] = [];
        const secondSeen: number[] = [];
        first.subscribe((sequence) => firstSeen.push(sequence));
        second.subscribe((sequence) => secondSeen.push(sequence));
        await Promise.all([first.initialize(), second.initialize()]);

        await Promise.all(Array.from({ length: 12 }, (_, index) => {
            const repository = index % 2 === 0 ? first : second;
            return repository.transact(async (draft) => {
                const count = draft.policyStates.vault?.legacyBaseline?.confirmedCount ?? 0;
                await Promise.resolve();
                draft.policyStates.vault = createPolicyState(count + 1);
            });
        }));

        const state = await first.initialize();
        expect(state.commitSequence).toBe(12);
        expect(state.policyStates.vault.legacyBaseline?.confirmedCount).toBe(12);
        expect(firstSeen).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
        expect(secondSeen).toEqual(firstSeen);
        await Promise.all([first.dispose(), second.dispose()]);
    });

    it("does not publish or advance in-memory state when the atomic write fails", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);
        const seen: number[] = [];
        repository.subscribe((sequence) => seen.push(sequence));
        await repository.initialize();
        factory.backend.failNextWriteCommit = true;

        await expect(repository.transact((draft) => {
            draft.policyStates.vault = createPolicyState(1);
        })).rejects.toMatchObject({ code: "database_write_failed" });

        const state = await repository.initialize();
        expect(state.commitSequence).toBe(0);
        expect(state.policyStates).toEqual({});
        expect(seen).toEqual([]);
        await repository.dispose();
    });

    it("closes a stale connection on versionchange and reopens on the next read", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);
        await repository.initialize();
        const firstConnection = factory.connections[0];

        firstConnection.onversionchange?.call(firstConnection as unknown as IDBDatabase, {} as IDBVersionChangeEvent);
        expect(firstConnection.closeCalls).toBe(1);

        await repository.initialize();
        expect(factory.openCalls).toHaveLength(2);
        expect(factory.connections[1]).not.toBe(firstConnection);
        await repository.dispose();
    });

    it("fails a blocked open closed and permits a later retry", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        factory.blockedOpenCount = 1;
        const repository = createIndexedRepository(factory);

        await expect(repository.initialize()).rejects.toMatchObject({ code: "database_open_blocked" });
        await expect(repository.initialize()).resolves.toMatchObject({ schemaVersion: 3, commitSequence: 0 });
        expect(factory.openCalls).toHaveLength(2);
        await repository.dispose();
    });

    it("disposes without waiting for a caller-owned suspended transaction callback", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);
        await repository.initialize();
        let releaseOperation: (() => void) | undefined;
        let markStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => { markStarted = resolve; });
        const blocker = new Promise<void>((resolve) => { releaseOperation = resolve; });
        const transaction = repository.transact(async (draft) => {
            markStarted?.();
            await blocker;
            draft.policyStates.vault = createPolicyState(1);
        });
        await started;

        await expect(repository.dispose()).resolves.toBeUndefined();
        expect(factory.connections[0].closeCalls).toBe(1);
        releaseOperation?.();
        await expect(transaction).rejects.toMatchObject({ code: "repository_disposed" });

        const replacement = createIndexedRepository(factory);
        expect((await replacement.initialize()).commitSequence).toBe(0);
        await replacement.dispose();
    });

    it("times out a silent open and closes a late connection", async () => {
        jest.useFakeTimers();
        try {
            const factory = new FakeGovernanceIndexedDbFactory();
            factory.silentOpenCount = 1;
            const repository = createIndexedRepository(factory, { openTimeoutMs: 5 });
            const opening = repository.initialize();

            jest.advanceTimersByTime(5);
            await expect(opening).rejects.toMatchObject({ code: "database_open_timeout" });
            await repository.dispose();
        } finally {
            jest.useRealTimers();
        }
    });

    it("fails closed instead of dropping corrupted persisted entities", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);
        await repository.initialize();
        factory.backend.getStore("claims").set("broken", { id: "broken" });

        await expect(repository.initialize()).rejects.toMatchObject({ code: "invalid_state" });
        await repository.dispose();
    });
});

function createReceiptState(): DeviceMemoryGovernanceStateV1 {
    const state = createCompleteState();
    state.schemaVersion = 3;
    const summary = state.revisions[0].summary;
    const receipt: ChatMemorySemanticReceipt = {
        version: 1, rule: CHAT_MEMORY_SEMANTIC_RULE, candidateTextHash: stableHash(summary.trim()),
        meaning: 'independent_personal_statement', kind: 'user_explicit', confidence: 'high',
        sources: [{ conversationId: 'conversation', messageId: 'message', hostKind: 'writing_request',
            contentHash: stableHash(summary), projectionHash: stableHash(summary), quoteHash: stableHash(summary),
            projectionChars: summary.length, start: 0, end: summary.length }],
    };
    state.revisions[0].chatSemanticReceipt = receipt;
    state.revisions[0].provenance = [{ kind: 'conversation', conversationIds: ['conversation'], observedAt: '2026-09-09T00:00:00Z' }];
    Object.assign(state.undoSnapshots[0], { revisions: [{ ...state.revisions[0], chatSemanticReceipt: receipt }] });
    state.memoryQueueItems.push({ id: 'receipt-queue', type: 'memory_candidate', partition: { kind: 'vault', key: 'vault' },
        title: 'Synthetic candidate', claim: summary, scope: { kind: 'whole_vault' }, sourceRefs: [],
        originSurface: 'chat', priority: 'normal', status: 'suggested', createdAt: '2026-09-09T00:00:00Z',
        updatedAt: '2026-09-09T00:00:00Z', whyShown: [], dataBoundarySnapshotId: 'boundary' });
    state.memoryQueueItems[0].governanceAdmission = {
        version: 1, origin: 'type_a', memoryType: 'preference', sensitivity: 'low', authority: 'explicit_user',
        effect: 'future_answers', applicability: { kind: 'whole_vault' },
        provenance: [{ kind: 'conversation', conversationIds: ['conversation'], observedAt: '2026-09-09T00:00:00Z' }],
        sourceFingerprintId: chatMemorySemanticSourceFingerprint(receipt), ruleFingerprint: CHAT_MEMORY_SEMANTIC_RULE, admissionKey: 'admission',
        chatSemanticReceipt: receipt,
    };
    return state;
}

function createPolicyState(confirmedCount: number) {
    return {
        version: 1 as const,
        mode: "legacy_threshold" as const,
        contextProjectionMode: "legacy" as const,
        legacyBaseline: {
            confirmedCount,
            threshold: 30 as const,
            autoAcceptPaused: false,
            importedFromSourceHash: "source-hash",
        },
    };
}

function createCompleteState(): DeviceMemoryGovernanceStateV1 {
    const partition = { kind: "vault" as const, key: "vault" };
    const sourceRef = {
        path: "notes/source.md",
        generatedAt: "2026-07-10T08:00:00.000Z",
        whyShown: ["source"],
    };
    return {
        schemaVersion: 1,
        commitSequence: 7,
        claims: [{
            id: "claim-1",
            partition,
            memoryType: "preference",
            sensitivity: "low",
            applicability: { kind: "selected_notes", paths: ["notes/source.md"] },
            activeRevisionId: "revision-1",
            effect: "future_answers",
            lifecycle: "active",
            createdAt: "2026-07-10T08:00:00.000Z",
            updatedAt: "2026-07-10T08:00:00.000Z",
        }],
        revisions: [{
            id: "revision-1",
            claimId: "claim-1",
            summary: "Prefer concise replies",
            provenance: [{ kind: "note", sourceRef }],
            authority: "explicit_user",
            createdAt: "2026-07-10T08:00:00.000Z",
        }],
        memoryQueueItems: [],
        projectionLinks: [{
            id: "link-1",
            claimId: "claim-1",
            target: { kind: "prompt_projection", projectionId: "projection-1" },
            relation: "derived_copy",
            state: "active",
            sourceFingerprintId: "source-fingerprint",
            ruleFingerprint: "rule-fingerprint",
            createdAt: "2026-07-10T08:00:00.000Z",
        }],
        changeEvents: [{
            id: "event-1",
            claimId: "claim-1",
            kind: "replace",
            scopeKey: "vault",
            effect: "future_answers",
            occurredAt: "2026-07-10T08:00:00.000Z",
            undoSnapshotId: "undo-1",
        }],
        undoSnapshots: [{
            id: "undo-1",
            claimId: "claim-1",
            eventId: "event-1",
            partition,
            claim: {
                id: "claim-1",
                partition,
                memoryType: "preference",
                sensitivity: "low",
                applicability: { kind: "selected_notes", paths: ["notes/source.md"] },
                activeRevisionId: "revision-1",
                effect: "future_answers",
                lifecycle: "active",
                createdAt: "2026-07-10T08:00:00.000Z",
                updatedAt: "2026-07-10T08:00:00.000Z",
            },
            revisions: [{
                id: "revision-1",
                claimId: "claim-1",
                summary: "Prefer concise replies",
                provenance: [{ kind: "note", sourceRef }],
                authority: "explicit_user",
                createdAt: "2026-07-10T08:00:00.000Z",
            }],
            projectionLinks: [],
            createdAt: "2026-07-10T08:00:00.000Z",
            expiresAt: "2026-07-17T08:00:00.000Z",
        }],
        suppressionMarkers: [{
            id: "marker-1",
            partition,
            sourceFingerprintId: "source-fingerprint",
            ruleFingerprint: "rule-fingerprint",
            reason: "forgotten",
            createdAt: "2026-07-10T08:00:00.000Z",
            updatedAt: "2026-07-10T08:00:00.000Z",
        }],
        pendingOperations: [{
            id: "profile-op-1",
            kind: "profile_projection",
            claimId: "claim-1",
            profileRecordId: "profile-1",
            targetRevisionId: "revision-1",
            state: "pending",
            attemptCount: 0,
            createdAt: "2026-07-10T08:00:00.000Z",
            updatedAt: "2026-07-10T08:00:00.000Z",
        }],
        policyStates: { vault: createPolicyState(30) },
        migrationStates: {
            vault: {
                migrationRunId: "migration-1",
                phase: "cutover_ready",
                sourceHash: "source-hash",
                cutoverSequence: 7,
                rollbackExpiresAt: "2026-07-17T08:00:00.000Z",
                lastAppliedDeltaSequence: 1,
            },
        },
        migrationDeltas: [{
            sequence: 1,
            migrationRunId: "migration-1",
            partition,
            committedAt: "2026-07-10T08:00:00.000Z",
            kind: "claim_added",
            entityId: "claim-1",
            payloadEntryId: "rollback-1",
            payloadChecksum: "checksum",
        }],
        rollbackPayloadEntries: [{
            id: "rollback-1",
            migrationRunId: "migration-1",
            partition,
            entityId: "claim-1",
            value: {
                kind: "policy",
                confirmedMemoryCount: 30,
                memoryAutoAcceptPaused: false,
            },
            checksum: "checksum",
            expiresAt: "2026-07-17T08:00:00.000Z",
        }],
    };
}

function createIndexedRepository(
    factory: FakeGovernanceIndexedDbFactory,
    options: { openTimeoutMs?: number } = {},
): IndexedDbMemoryGovernanceRepository {
    return new IndexedDbMemoryGovernanceRepository(
        getMemoryGovernanceDeviceDbName("personal-assistant"),
        factory as unknown as IDBFactory,
        { ...options, broadcastChannelFactory: null },
    );
}

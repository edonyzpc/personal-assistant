import { describe, expect, it, jest } from '@jest/globals';

import { DEFAULT_SETTINGS, type PluginManagerSettings } from '../src/settings';
import {
    MemoryGovernanceBootstrapError,
    PluginGovernanceStorage,
} from '../src/memory/plugin-governance-storage';
import { MemoryGovernanceMigrationCoordinator } from '../src/pa/memory-governance-migration-coordinator';
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    type MemoryGovernanceRepository,
    type MemoryGovernanceTransaction,
} from '../src/pa/memory-governance-persistence';
import { createDeviceMemoryGovernanceRecordRepository } from '../src/pa/memory-governance-record-repository';
import { createMemoryReviewQueueRepository } from '../src/pa/memory-review-queue-repository';

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function createHarness(repository?: MemoryGovernanceRepository) {
    const settings = clone(DEFAULT_SETTINGS) as PluginManagerSettings;
    settings.statisticsVaultId = 'storage-owner-vault';
    const deviceRepository = repository
        ?? new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend());
    const scheduleGarbageCollection = jest.fn();
    const cancelGarbageCollection = jest.fn();
    const owner = new PluginGovernanceStorage({
        getSettings: () => settings,
        getVault: () => ({ adapter: { getBasePath: () => '/device/storage-owner-vault' } }),
        getPluginId: () => 'personal-assistant',
        isUnloading: () => false,
        createRepository: () => deviceRepository,
        persistSettingsSlice: async (_read, write, next) => { write(next); },
        scheduleGarbageCollection,
        cancelGarbageCollection,
        log: jest.fn(),
    });
    owner.initializeLegacyCompatibility(settings);
    return { owner, settings, repository: deviceRepository, scheduleGarbageCollection, cancelGarbageCollection };
}

describe('PluginGovernanceStorage', () => {
    it('prepares and publishes one governed runtime with the same repository and opaque key', async () => {
        const { owner, repository } = createHarness();
        const handle = await owner.prepareBootstrap();
        const migration = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: handle.opaqueVaultKey,
            payload: handle.payload,
        }).run();
        expect(migration.ok).toBe(true);
        if (!migration.ok) throw new Error(migration.reason);
        const state = await repository.initialize();
        const recordRepository = await createDeviceMemoryGovernanceRecordRepository({
            repository,
            opaqueVaultKey: handle.opaqueVaultKey,
            expectedSourceHash: migration.sourceHash,
        });
        const reviewQueueRepository = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: owner.getOrCreateSettingsReviewQueueRepository(),
            opaqueVaultKey: handle.opaqueVaultKey,
        });

        owner.publishGovernedRuntime(handle, {
            state,
            sourceHash: migration.sourceHash,
            recordRepository,
            reviewQueueRepository,
        });

        expect(owner.bootstrapState).toBe('ready');
        expect(owner.deviceRepository).toBe(repository);
        expect(owner.vaultKey).toBe(handle.opaqueVaultKey);
        expect(owner.stateSnapshot?.commitSequence).toBe(state.commitSequence);
        expect(owner.getSmokeCapability()).toEqual({
            schemaVersion: 1,
            mode: 'blocked',
            reason: 'durable_governance',
        });
        expect(() => owner.publishGovernedRuntime(handle, {
            state,
            sourceHash: migration.sourceHash,
            recordRepository,
            reviewQueueRepository,
        })).toThrow(MemoryGovernanceBootstrapError);
        await owner.dispose();
    });

    it('rejects a stale prepared handle and installs fail-closed views', async () => {
        const { owner } = createHarness();
        const handle = await owner.prepareBootstrap();
        await owner.failBootstrap(handle, 'storage_unavailable');

        expect(owner.bootstrapState).toBe('failed');
        expect(owner.deviceRepository).toBeNull();
        expect(owner.getSmokeCapability()).toEqual({
            schemaVersion: 1,
            mode: 'blocked',
            reason: 'bootstrap_failed',
        });
        await expect(owner.recordRepositoryView!.write({ records: [] }))
            .rejects.toThrow('memory_mutation_blocked');
        expect(() => owner.publishGovernedRuntime(handle, {
            state: handle.existingState,
            sourceHash: handle.expectedSourceHash,
            recordRepository: null,
            reviewQueueRepository: owner.getOrCreateSettingsReviewQueueRepository() as never,
        })).toThrow(MemoryGovernanceBootstrapError);
    });

    it('disposes a repository when bootstrap preparation fails and blocks reuse after dispose', async () => {
        const dispose = jest.fn(async () => undefined);
        const repository: MemoryGovernanceRepository = {
            initialize: jest.fn(async () => { throw new Error('read failed'); }),
            transact: jest.fn() as never,
            subscribe: jest.fn(() => () => undefined),
            dispose,
        };
        const { owner } = createHarness(repository);
        expect(owner.getSmokeCapability()).toEqual({
            schemaVersion: 1,
            mode: 'blocked',
            reason: 'bootstrap_unknown',
        });
        await expect(owner.prepareBootstrap()).rejects.toThrow('read failed');
        expect(dispose).toHaveBeenCalledTimes(1);
        await owner.dispose();
        expect(owner.getSmokeCapability()).toEqual({
            schemaVersion: 1,
            mode: 'blocked',
            reason: 'unavailable',
        });
        await expect(owner.prepareBootstrap()).rejects.toThrow('memory_mutation_blocked');
    });

    it('does not publish a local policy result after the prepared runtime becomes stale', async () => {
        const base = new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend());
        let holdTransactions = false;
        let markCommitted!: () => void;
        let releaseResult!: () => void;
        const committed = new Promise<void>((resolve) => { markCommitted = resolve; });
        const release = new Promise<void>((resolve) => { releaseResult = resolve; });
        const repository: MemoryGovernanceRepository = {
            initialize: () => base.initialize(),
            transact: async <T>(operation: MemoryGovernanceTransaction<T>) => {
                const result = await base.transact(operation);
                if (holdTransactions) {
                    markCommitted();
                    await release;
                }
                return result;
            },
            subscribe: (listener) => base.subscribe(listener),
            dispose: () => base.dispose(),
        };
        const { owner } = createHarness(repository);
        const handle = await owner.prepareBootstrap();
        const migration = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: handle.opaqueVaultKey,
            payload: handle.payload,
        }).run();
        expect(migration.ok).toBe(true);
        if (!migration.ok) throw new Error(migration.reason);
        const state = await repository.initialize();
        const queue = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: owner.getOrCreateSettingsReviewQueueRepository(),
            opaqueVaultKey: handle.opaqueVaultKey,
        });
        owner.publishGovernedRuntime(handle, {
            state,
            sourceHash: migration.sourceHash,
            recordRepository: null,
            reviewQueueRepository: queue,
        });

        holdTransactions = true;
        const update = owner.updateCurrentLocalPolicy({ confirmedMemoryCount: 7 });
        await committed;
        await owner.failBootstrap(handle, 'runtime_replaced');
        releaseResult();

        await expect(update).rejects.toThrow('memory_mutation_blocked');
        expect(owner.confirmedMemoryCount).toBeNull();
    });
});

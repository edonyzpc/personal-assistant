import { describe, expect, it, jest } from '@jest/globals';

import { PluginGovernanceActions } from '../src/memory/plugin-governance-actions';

function createOwner() {
    return new PluginGovernanceActions({
        isUnloading: () => false,
        isRuntimeReady: () => true,
        getCurrentState: () => null,
        refreshActionState: async () => undefined,
        notifySettingsChanged: async () => undefined,
        readActionBoundary: async () => true,
        readCommittedState: async () => undefined,
        getPanelRecord: () => undefined,
        pageletMessage: (key) => key,
        pluginMessage: (key) => key,
        log: jest.fn(),
    });
}

describe('PluginGovernanceActions', () => {
    it('owns the coordinator set and clears action resources as one runtime', () => {
        const owner = createOwner();
        const runtime = owner.prepareRuntime({
            repository: {
                initialize: jest.fn() as never,
                transact: jest.fn() as never,
                subscribe: jest.fn(() => () => undefined),
                dispose: jest.fn(async () => undefined),
            },
            opaqueVaultKey: 'vault-actions',
            projectionCleanupPort: { cleanupExactProjection: jest.fn(async () => undefined) },
            applyProjection: jest.fn(async () => undefined),
            removeProjection: jest.fn(async () => undefined),
        });
        expect(owner.governanceCoordinator).toBe(runtime.coordinator);
        expect(owner.admission).toBe(runtime.admissionCoordinator);
        expect(owner.projectionWorker).toBe(runtime.profileProjectionWorker);

        owner.clearRuntime();
        expect(owner.governanceCoordinator).toBeNull();
        expect(owner.admission).toBeNull();
        expect(owner.projectionWorker).toBeNull();
        expect(owner.forgetTimer).toBeNull();
        expect(owner.projectionRetryTimer).toBeNull();
        expect(owner.gcTimer).toBeNull();
    });

    it('serializes lifecycle mutations and continues after a rejected operation', async () => {
        const owner = createOwner();
        const order: string[] = [];
        let release!: () => void;
        const first = owner.serialize(async () => {
            order.push('first:start');
            await new Promise<void>((resolve) => { release = resolve; });
            order.push('first:end');
            throw new Error('expected');
        });
        const second = owner.serialize(async () => {
            order.push('second');
            return 2;
        });

        await Promise.resolve();
        expect(order).toEqual(['first:start']);
        release();
        await expect(first).rejects.toThrow('expected');
        await expect(second).resolves.toBe(2);
        expect(order).toEqual(['first:start', 'first:end', 'second']);
    });

    it('keeps queue audit reconciliation single-flight without caching completion', async () => {
        const owner = createOwner();
        let release!: () => void;
        let isCurrent!: () => boolean;
        const operation = jest.fn(async (current: () => boolean) => {
            isCurrent = current;
            await new Promise<void>((resolve) => { release = resolve; });
        });

        const first = owner.reconcileQueueAudit(operation);
        const second = owner.reconcileQueueAudit(operation);
        expect(second).toBe(first);
        expect(operation).toHaveBeenCalledTimes(1);
        expect(isCurrent()).toBe(true);
        owner.clearRuntime();
        expect(isCurrent()).toBe(false);
        release();
        await first;
        await Promise.resolve();

        const next = owner.reconcileQueueAudit(async () => undefined);
        expect(next).not.toBe(first);
        await next;
    });
});

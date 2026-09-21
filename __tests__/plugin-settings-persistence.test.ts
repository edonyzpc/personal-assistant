import { describe, expect, it, jest } from "@jest/globals";

import {
    SettingsPersistence,
    type SettingsPersistenceDependencies,
} from "../src/plugin/settings-persistence";
import { DEFAULT_SETTINGS, type PluginManagerSettings } from "../src/settings";

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

function cloneSettings(value: unknown): PluginManagerSettings {
    return JSON.parse(JSON.stringify(value)) as PluginManagerSettings;
}

function createOwner(initialData: Record<string, unknown>): SettingsPersistence {
    let persisted = JSON.parse(JSON.stringify(initialData)) as Record<string, unknown>;
    const dependencies: SettingsPersistenceDependencies = {
        loadData: jest.fn(async () => JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>),
        saveData: jest.fn(async (data) => {
            persisted = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
        }),
        getAdapter: () => ({
            read: jest.fn(async () => JSON.stringify(persisted)),
            write: jest.fn(async () => undefined),
            copy: jest.fn(async () => undefined),
            remove: jest.fn(async () => undefined),
            process: jest.fn(async (_path: string, mutate: (data: string) => string) => {
                const next = mutate(JSON.stringify(persisted));
                persisted = JSON.parse(next) as Record<string, unknown>;
                return next;
            }),
        }),
        getManifest: () => ({ id: "personal-assistant", dir: ".obsidian/plugins/personal-assistant" }),
        getVault: () => ({ configDir: ".obsidian" }) as never,
        isUnloading: () => false,
        clearTokenCache: jest.fn(),
        initializeLegacyMemoryCompatibility: jest.fn(),
        getLegacyMemoryCompatibilityBarrier: () => null,
        updateLegacyMemoryPayload: jest.fn(),
        markMemoryGovernanceBootstrapError: jest.fn(),
        createLegacySaveCollisionError: () => new Error("legacy save collision"),
        synchronizeNonMemoryQueueFromPersisted: jest.fn(async () => undefined),
        syncMemoryExtractionRuntime: jest.fn(),
        setStatisticsRuntimeEnabled: jest.fn(async () => undefined),
        setBackgroundDiscoveryRuntimeEnabled: jest.fn(),
        shouldDeferSettingsNotification: () => false,
        deferSettingsNotification: jest.fn(),
        refreshRetrievalEpoch: jest.fn(),
        showNotice: jest.fn(),
        translateQwenMemoryModelRecommended: () => "recommended",
        getPageletLocale: () => "en",
        createStatisticsVaultId: () => "settings-owner-test",
        log: jest.fn(),
    };
    const owner = new SettingsPersistence(dependencies);
    owner.setCurrentSettingsForCompatibility(cloneSettings(DEFAULT_SETTINGS));
    return owner;
}

describe("B-143 settings persistence owner", () => {
    it("replaces defaults on load while live consumers follow the owner's current instance", async () => {
        const owner = createOwner({
            author: "loaded author",
            dataBoundary: { excludedFolders: ["private"] },
        });
        const readConsumerSettings = () => owner.currentSettings;
        const defaultSettings = owner.currentSettings;

        await owner.loadSettings();

        expect(owner.currentSettings).not.toBe(defaultSettings);
        expect(readConsumerSettings()).toBe(owner.currentSettings);
        const loadedSettings = owner.currentSettings;
        const loadedBoundary = owner.currentSettings.dataBoundary;

        await owner.saveSettingsPermissions({
            dataBoundary: { excludedFolders: ["private", "archive"] },
        });

        expect(owner.currentSettings).toBe(loadedSettings);
        expect(owner.currentSettings.dataBoundary).toBe(loadedBoundary);
        expect(readConsumerSettings()).toBe(owner.currentSettings);
        expect(owner.currentSettings.dataBoundary.excludedFolders).toEqual(["private", "archive"]);
    });

    it("drains required transactions and writes admitted while draining to a fixed point", async () => {
        const owner = createOwner({ author: "queue" });
        await owner.loadSettings();
        const admit = deferred();
        const writeEntered = deferred();
        const releaseWrite = deferred();
        const operation = (async () => {
            await admit.promise;
            await owner.enqueueWrite(async () => {
                writeEntered.resolve();
                await releaseWrite.promise;
            });
        })();
        owner.trackRequiredTransaction(operation);
        let drained = false;
        const draining = owner.drainWrites().then(() => { drained = true; });

        admit.resolve();
        await writeEntered.promise;
        await Promise.resolve();
        expect(drained).toBe(false);

        releaseWrite.resolve();
        await draining;
        expect(drained).toBe(true);
    });

    it("recovers the settings queue after a failed write", async () => {
        const owner = createOwner({ author: "queue" });
        await owner.loadSettings();
        const failed = new Error("synthetic write failure");
        const first = owner.enqueueWrite(async () => { throw failed; });
        const second = owner.enqueueWrite(async () => "continued");

        await expect(first).rejects.toBe(failed);
        await expect(second).resolves.toBe("continued");
        await expect(owner.drainWrites()).resolves.toBeUndefined();
    });
});

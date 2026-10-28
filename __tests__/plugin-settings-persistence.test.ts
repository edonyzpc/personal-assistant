import { describe, expect, it, jest } from "@jest/globals";
import type { App } from "obsidian";

import {
    SettingsPersistence,
    type SettingsPersistenceDependencies,
} from "../src/plugin/settings-persistence";
import { FeaturedImageOptionsModal } from "../src/settings/featured-image-options-modal";
import { GraphOptionsModal, type GraphOptions } from "../src/settings/graph-options-modal";
import { pluginT } from "../src/locales/plugin";
import { DEFAULT_SETTINGS, type PluginManagerSettings } from "../src/settings";
import { DomStubNode, findAllByTag } from "./helpers/dom-stub";

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

function cloneSettings(value: unknown): PluginManagerSettings {
    return JSON.parse(JSON.stringify(value)) as PluginManagerSettings;
}

function createOwner(initialData: object, overrides: Partial<SettingsPersistenceDependencies> = {}): SettingsPersistence {
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
        ...overrides,
    };
    const owner = new SettingsPersistence(dependencies);
    owner.setCurrentSettingsForCompatibility(cloneSettings(DEFAULT_SETTINGS));
    return owner;
}

class ModalElement extends DomStubNode {
    onclick?: () => void | Promise<void>;
    onchange?: () => void;
    oninput?: () => void;
    focus = jest.fn();

    addClass(value: string): void {
        this.classList.add(value);
    }

    empty(): void {
        this.textContent = "";
    }

    createEl(tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): ModalElement {
        const element = this.appendChild(new ModalElement(tag)) as ModalElement;
        if (options.cls) element.addClass(options.cls);
        if (options.text) element.setText(options.text);
        for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
        return element;
    }

    createDiv(options?: Parameters<ModalElement["createEl"]>[1]): ModalElement {
        return this.createEl("div", options);
    }

    createSpan(options?: Parameters<ModalElement["createEl"]>[1]): ModalElement {
        return this.createEl("span", options);
    }

    click(): void | Promise<void> {
        for (let node: DomStubNode | null = this; node; node = node.parentElement) {
            if (node.disabled || node.hidden) return;
        }
        return this.onclick?.();
    }
}

function modalButton(root: ModalElement, text: string): ModalElement {
    const button = (findAllByTag(root, "button") as ModalElement[]).find((node) => node.textContent === text);
    if (!button) throw new Error(`Missing modal button: ${text}`);
    return button;
}

function modalControl(root: ModalElement, ariaLabel: string): ModalElement {
    const controls = [
        ...(findAllByTag(root, "input") as ModalElement[]),
        ...(findAllByTag(root, "select") as ModalElement[]),
    ];
    const control = controls.find((node) => node.getAttribute("aria-label") === ariaLabel);
    if (!control) throw new Error(`Missing modal control: ${ariaLabel}`);
    return control;
}

function mountFeaturedImageModal(owner: SettingsPersistence): { modal: FeaturedImageOptionsModal; root: ModalElement } {
    const modal = new FeaturedImageOptionsModal({} as App, {
        mode: "edit",
        defaults: {
            featuredImageModel: owner.currentSettings.featuredImageModel,
            numFeaturedImages: owner.currentSettings.numFeaturedImages,
            featuredImagePath: owner.currentSettings.featuredImagePath,
        },
        saveDefaults: (options) => owner.saveFeaturedImageDefaults(options),
    });
    const root = new ModalElement("div");
    Object.assign(modal, { contentEl: root, titleEl: new ModalElement("h2") });
    modal.close = jest.fn(() => modal.onClose());
    modal.onOpen();
    return { modal, root };
}

function mountGraphModal(owner: SettingsPersistence): { modal: GraphOptionsModal; root: ModalElement } {
    const readOptions = (): GraphOptions => ({
        localGraph: owner.currentSettings.localGraph,
        enableGraphColors: owner.currentSettings.enableGraphColors,
        colorGroups: owner.currentSettings.colorGroups,
    });
    const modal = new GraphOptionsModal({} as App, {
        readOptions,
        saveOptions: (options) => owner.saveGraphOptions(options),
        applyOptions: async () => undefined,
    });
    const root = new ModalElement("div");
    Object.assign(modal, { contentEl: root, titleEl: new ModalElement("h2") });
    modal.close = jest.fn(() => modal.onClose());
    modal.onOpen();
    return { modal, root };
}

describe("B-143 settings persistence owner", () => {
    it("keeps the Debug permission gate closed until the same settings write commits", async () => {
        const write = deferred();
        const revoking = jest.fn();
        const committed = jest.fn();
        const owner = createOwner({}, {
            saveData: () => write.promise,
            onSourcePermissionRevoking: revoking,
            onSourcePermissionCommitted: committed,
        });
        await owner.loadSettings();
        const save = owner.saveSettingsPermissions({ dataBoundary: { excludedTags: ["private"] } });
        for (let i = 0; i < 4; i++) await Promise.resolve();
        expect(revoking).toHaveBeenCalledTimes(1);
        expect(committed).not.toHaveBeenCalled();
        write.resolve();
        await save;
        expect(committed).toHaveBeenCalledTimes(1);
        expect(owner.currentSettings.dataBoundary.sourceRevocationEpoch).toMatch(/^source:/);
    });

    it("reports a failed revocation commit without falsely reporting success", async () => {
        const failed = jest.fn();
        const committed = jest.fn();
        const owner = createOwner({}, {
            saveData: async () => { throw new Error("write uncertain"); },
            onSourcePermissionFailed: failed,
            onSourcePermissionCommitted: committed,
        });
        await owner.loadSettings();
        await expect(owner.saveSettingsPermissions({ dataBoundary: { excludedTags: ["private"] } }))
            .rejects.toThrow("write uncertain");
        expect(failed).toHaveBeenCalledTimes(1);
        expect(committed).not.toHaveBeenCalled();
    });

    it("keeps a durable source revocation epoch when a failed notification is followed by permission widening", async () => {
        const owner = createOwner({});
        await owner.loadSettings();
        owner.onSettingsChanged(() => { throw new Error("observer failed"); });
        await owner.saveSettingsPermissions({ dataBoundary: { excludedFolders: ["private"] } });
        const epoch = owner.currentSettings.dataBoundary.sourceRevocationEpoch;
        expect(epoch).toMatch(/^source:/);
        await owner.saveSettingsPermissions({ dataBoundary: { excludedFolders: [] } });
        await owner.loadSettings();
        expect(owner.currentSettings.dataBoundary.excludedFolders).toEqual([]);
        expect(owner.currentSettings.dataBoundary.sourceRevocationEpoch).toBe(epoch);
        await owner.recordSourceRevocation();
        expect(owner.currentSettings.dataBoundary.sourceRevocationEpoch).not.toBe(epoch);
    });

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

    it("ignores retired Operations audit keys without saving just to remove them", async () => {
        const saveData = jest.fn(async (_data: unknown) => undefined);
        const owner = createOwner({
            operationsAgentEnabled: true,
            operationsAuditIncludeContent: true,
            operationsAuditRetentionDays: 90,
        }, { saveData });

        await owner.loadSettings();

        expect(owner.currentSettings).not.toHaveProperty("operationsAgentEnabled");
        expect(owner.currentSettings).not.toHaveProperty("operationsAuditIncludeContent");
        expect(owner.currentSettings).not.toHaveProperty("operationsAuditRetentionDays");
        expect(saveData).not.toHaveBeenCalled();
    });

    it.each([true, false])("retires unused sharing and weekly switches set to %s without dropping history", async (value) => {
        const actionLog = [{
            id: "move-history", proposalId: "proposal", reviewQueueItemId: "queue",
            actionType: "move", status: "applied", oldPath: "Inbox/note.md", newPath: "Notes/note.md",
            appliedAt: "2026-10-25T00:00:00.000Z", sourceRefs: [{
                path: "Inbox/note.md", excerptHash: "source-hash", whyShown: ["Inbox note"], evidenceStrength: "medium",
            }], dataBoundarySnapshotId: "boundary", undoStrategy: "move_back",
        }];
        const weeklyHistory = { records: ["Reviews/existing.md"] };
        const saveData = jest.fn(async (_data: unknown) => undefined);
        const owner = createOwner({
            ...cloneSettings(DEFAULT_SETTINGS), aiProvider: "openai", statisticsVaultId: "settings-owner-test",
            shareAnonymousCapabilityUsage: value,
            weeklyReview: { enabled: value, preparedReviewEnabled: value, history: weeklyHistory },
            maintenanceReview: { weeklyScanEnabled: value, actionLog },
        }, { saveData });

        await owner.loadSettings();
        expect(saveData).not.toHaveBeenCalled();
        await owner.migrateSettings();
        expect(saveData).toHaveBeenCalledTimes(1);
        expect(saveData).toHaveBeenLastCalledWith(expect.objectContaining({
            weeklyReview: { history: weeklyHistory }, maintenanceReview: { actionLog },
        }));

        await owner.saveSettingsData({
            ...owner.currentSettings,
            shareAnonymousCapabilityUsage: !value,
            weeklyReview: { enabled: !value, preparedReviewEnabled: !value, history: weeklyHistory },
            maintenanceReview: { ...owner.currentSettings.maintenanceReview, weeklyScanEnabled: !value },
        } as PluginManagerSettings);
        const persisted = saveData.mock.calls.at(-1)?.[0];
        expect(persisted).not.toHaveProperty("shareAnonymousCapabilityUsage");
        expect(persisted).not.toHaveProperty("weeklyReview.enabled");
        expect(persisted).not.toHaveProperty("weeklyReview.preparedReviewEnabled");
        expect(persisted).not.toHaveProperty("maintenanceReview.weeklyScanEnabled");
        expect(persisted).toMatchObject({
            weeklyReview: { history: weeklyHistory }, maintenanceReview: { actionLog },
        });
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

    it("keeps a newer featured-image path when an older model draft saves later", async () => {
        const initial = cloneSettings(DEFAULT_SETTINGS);
        initial.featuredImageModel = "wan2.7-image";
        initial.numFeaturedImages = 1;
        initial.featuredImagePath = "images/old";
        const owner = createOwner(initial);
        await owner.loadSettings();
        const staleModelDraft = mountFeaturedImageModal(owner);
        const livePathEditor = mountFeaturedImageModal(owner);

        const model = modalControl(staleModelDraft.root, pluginT("plugin.settings.featuredImage.model.name"));
        model.value = "wan2.7-image-pro";
        const path = modalControl(livePathEditor.root, pluginT("plugin.settings.featuredImage.path.name"));
        path.value = "attachments/live";
        await modalButton(livePathEditor.root, pluginT("plugin.settings.featuredImage.options.save")).click();
        await modalButton(staleModelDraft.root, pluginT("plugin.settings.featuredImage.options.save")).click();

        expect(owner.currentSettings).toMatchObject({
            featuredImageModel: "wan2.7-image-pro",
            numFeaturedImages: 1,
            featuredImagePath: "attachments/live",
        });
    });

    it("removes retired graph dimensions from the next canonical save without dropping legal options", async () => {
        const initial = cloneSettings(DEFAULT_SETTINGS);
        initial.localGraph = { ...initial.localGraph, type: "legacy-tab", depth: 3 } as typeof initial.localGraph;
        const seedOwner = createOwner(initial);
        await seedOwner.loadSettings();
        await seedOwner.migrateSettings();
        const migrated = cloneSettings(seedOwner.currentSettings);

        const migratedSaveData = jest.fn(async (_data: unknown) => undefined);
        const migratedOwner = createOwner(migrated, { saveData: migratedSaveData });
        await migratedOwner.loadSettings();
        await migratedOwner.migrateSettings();
        expect(migratedSaveData).not.toHaveBeenCalled();

        const retiredDimensionsSaveData = jest.fn(async (_data: unknown) => undefined);
        const owner = createOwner({
            ...migrated,
            localGraph: {
                ...migrated.localGraph,
                resizeStyle: { width: 2400, height: 300 },
            } as typeof migrated.localGraph,
        }, { saveData: retiredDimensionsSaveData });
        await owner.loadSettings();
        await owner.migrateSettings();
        expect(retiredDimensionsSaveData).not.toHaveBeenCalled();

        await owner.saveGraphOptions({ localGraph: { depth: 4 } });

        const persisted = retiredDimensionsSaveData.mock.calls.at(-1)?.[0] as PluginManagerSettings;
        expect(persisted.localGraph).toMatchObject({ type: "legacy-tab", depth: 4 });
        expect(persisted.localGraph).not.toHaveProperty("resizeStyle");
    });

    it("keeps newer graph colors and opening choices when an older depth draft saves later", async () => {
        const initial = cloneSettings(DEFAULT_SETTINGS);
        initial.localGraph = { ...initial.localGraph, type: "legacy-tab", depth: 3, autoColors: false };
        initial.enableGraphColors = true;
        initial.colorGroups = [{ query: "old", color: { a: 0.5, rgb: 100 } }];
        const owner = createOwner(initial);
        await owner.loadSettings();
        const staleDepthDraft = mountGraphModal(owner);
        const liveOptionsEditor = mountGraphModal(owner);

        const depth = modalControl(staleDepthDraft.root, pluginT("plugin.settings.graph.depth.name"));
        depth.value = "4";
        depth.oninput?.();
        const opening = modalControl(liveOptionsEditor.root, pluginT("plugin.settings.graph.options.openAs"));
        opening.value = "popover";
        opening.onchange?.();
        const colorRule = modalControl(
            liveOptionsEditor.root,
            pluginT("plugin.settings.graph.options.query", "en", { number: 1 }),
        );
        colorRule.value = "live";
        colorRule.oninput?.();
        await modalButton(liveOptionsEditor.root, pluginT("plugin.settings.graph.options.save")).click();
        await modalButton(staleDepthDraft.root, pluginT("plugin.settings.graph.options.save")).click();

        expect(owner.currentSettings.localGraph).toMatchObject({ depth: 4, type: "popover", autoColors: false });
        expect(owner.currentSettings.colorGroups).toEqual([{ query: "live", color: { a: 0.5, rgb: 100 } }]);
    });
});

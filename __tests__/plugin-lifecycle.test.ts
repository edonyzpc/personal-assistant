import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { ItemView, MarkdownView, Modal, Notice, TFile, type Command, type Editor } from "obsidian";
import { setPlatformMobile, resetPlatform } from "./helpers/platform-mock";
import { DomStubNode, findAllByTag } from './helpers/dom-stub';
import { AssistantFeaturedImageHelper } from '../src/ai';
import { pluginT } from '../src/locales/plugin';
import type { FeaturedImageRunOptions } from '../src/ai-services/featured-image-options';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import type { SettingsPermissionPatch } from '../src/plugin';

jest.mock("obsidian-callout-manager", () => ({ getApi: jest.fn() }));
jest.mock("../src/chat/chat-view", () => ({ VIEW_TYPE_LLM: "llm-view", LLMView: class {} }));
jest.mock("../src/share-card/share-card-modal", () => ({
    ShareCardModal: class {},
    closeAllShareCardModals: jest.fn(),
}));
jest.mock("../src/ai", () => ({ AssistantFeaturedImageHelper: class {
    async generate(_options: unknown) {}
}, AssistantHelper: class {} }));
jest.mock("../src/vss", () => ({ VSS: class {} }));
jest.mock("../src/memory-manager", () => ({ MemoryManager: class { startAutoMaintenance() {} } }));
jest.mock("../src/modal", () => ({ PluginControlModal: class {} }));
jest.mock("../src/batch-modal", () => ({ BatchPluginControlModal: class {} }));
jest.mock("../src/local-graph", () => ({ LocalGraph: class {} }));
jest.mock("../src/plugin-manifest", () => ({ PluginsUpdater: class {} }));
jest.mock("../src/theme-manifest", () => ({ ThemeUpdater: class {} }));

import { createPluginHarness } from "./helpers/plugin-harness";
import { hasDeprecatedSimpleSettingsFields, mergeLoadedSettings } from "../src/settings";
import { MemoryUserProfileStore, type MemoryExtractionScheduler } from "../src/ai-services/memory-extraction";
import type { QuietRecallCandidate, RetrievalHabitProfileRecordResult } from "../src/pa";

describe("B-135 learning preferences migration", () => {
    const base = { aiProvider: "openai", statisticsVaultId: "learning-test" };
    type LearningInternals = {
        migrateSettings(): Promise<void>;
        pendingLearningPreferencesMigration: boolean;
        canRunMemoryExtractionRuntime(): boolean;
        notifySettingsChanged(): Promise<void>;
    };

    it.each([undefined, false, true, "invalid"])("adopts old %p without confirmation or losing local state", async (enabled) => {
        const { plugin, readPersisted } = createPluginHarness({ initialData: {
            ...base, memoryExtractionEnabled: enabled,
            retrievalHabitProfile: { enabled, state: { aggregates: [], clearedAt: "2026-09-01T00:00:00.000Z" } },
        } });
        const state = plugin as unknown as LearningInternals;
        await plugin.loadSettings();
        expect(state.pendingLearningPreferencesMigration).toBe(true);
        expect(state.canRunMemoryExtractionRuntime()).toBe(true);
        await state.migrateSettings();
        expect(state.pendingLearningPreferencesMigration).toBe(false);
        expect(readPersisted()).toMatchObject({ memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: "unconfirmed", version: 1 },
            memoryExtractionIncludeVaultInsights: false,
            retrievalHabitProfile: { enabled: true, state: { clearedAt: "2026-09-01T00:00:00.000Z" } },
            learningPreferences: { version: 1, memoryExtraction: "default", habitLearning: "default" } });
        expect(plugin.settings.memoryExtractionConsent.confirmedAt).toBeUndefined();
        plugin.settings.memoryEnabled = false;
        expect(state.canRunMemoryExtractionRuntime()).toBe(false);
    });

    it.each([[true, true], [true, false], [false, true], [false, false]])(
        "preserves independent saved choices extraction=%p habit=%p through unrelated save/reload",
        async (extraction, habit) => {
            const { plugin, readPersisted } = createPluginHarness({ initialData: base });
            await plugin.loadSettings();
            const state = plugin as unknown as LearningInternals;
            await state.migrateSettings();
            state.notifySettingsChanged = jest.fn(async () => undefined);
            await Promise.all([
                plugin.saveSettingsPermissions({ memoryExtractionEnabled: extraction }),
                plugin.saveSettingsPermissions({ retrievalHabitProfile: { enabled: habit } }),
            ]);
            plugin.settings.author = "ordinary edit";
            await plugin.saveSettings();
            const reloaded = createPluginHarness({ initialData: readPersisted() });
            await reloaded.plugin.loadSettings();
            expect(reloaded.plugin.settings.memoryExtractionEnabled).toBe(extraction);
            expect(reloaded.plugin.settings.retrievalHabitProfile.enabled).toBe(habit);
            expect(reloaded.plugin.settings.memoryExtractionConsent.confirmedAt).toBeUndefined();
            expect((reloaded.plugin as unknown as LearningInternals).canRunMemoryExtractionRuntime()).toBe(extraction);
        },
    );

    it("keeps migration pending and preferences unchanged after failed persistence", async () => {
        const { plugin, adapter, readPersisted } = createPluginHarness({ initialData: base });
        await plugin.loadSettings();
        const state = plugin as unknown as LearningInternals;
        adapter.process.mockRejectedValueOnce(new Error("disk unavailable"));
        await expect(state.migrateSettings()).rejects.toThrow("disk unavailable");
        expect(state.pendingLearningPreferencesMigration).toBe(true);
        expect(readPersisted()?.learningPreferences).toBeUndefined();
        await state.migrateSettings();
        expect(state.pendingLearningPreferencesMigration).toBe(false);
        adapter.process.mockRejectedValueOnce(new Error("disk unavailable"));
        await expect(plugin.saveSettingsPermissions({ memoryExtractionEnabled: false,
            retrievalHabitProfile: { enabled: false } })).rejects.toThrow("disk unavailable");
        expect(plugin.settings.learningPreferences).toEqual({ version: 1, memoryExtraction: "default", habitLearning: "default" });
        expect(plugin.settings.memoryExtractionEnabled).toBe(true);
        expect(plugin.settings.retrievalHabitProfile.enabled).toBe(true);
    });

    it("ignores a rewritten legacy false mirror while retaining real paused history", () => {
        const migrated = mergeLoadedSettings({ memoryExtractionEnabled: false });
        // The legacy reader preserves unknown top-level fields but forces the
        // unconfirmed extraction mirror off. This is its persisted output shape.
        const legacySaved = { ...migrated, memoryExtractionEnabled: false };
        expect(mergeLoadedSettings(legacySaved).memoryExtractionEnabled).toBe(true);
        const paused = mergeLoadedSettings({ ...legacySaved,
            memoryExtractionConsent: { state: "paused", version: 1, confirmedAt: "2026-08-01T00:00:00.000Z" } });
        expect(paused.memoryExtractionEnabled).toBe(false);
        expect(paused.memoryExtractionConsent.confirmedAt).toBe("2026-08-01T00:00:00.000Z");
        expect(paused.learningPreferences?.memoryExtraction).toBe("disabled");
    });
});

describe("B-135 default learning runtime", () => {
    type Runtime = {
        migrateSettings(): Promise<void>;
        syncMemoryExtractionRuntime(): void;
        memoryExtractionScheduler: MemoryExtractionScheduler | null;
        createUserProfileStore(): MemoryUserProfileStore;
        getGovernedMemoryProjectionSnapshot(): null;
        chatHistoryManager: unknown;
        createChatModel: unknown;
        pageletCostTracker: { record: jest.Mock };
        notifySettingsChanged(): Promise<void>;
        isDataBoundaryAllowedPath(path: string): boolean;
        recordQuietRecallFeedback(candidate: QuietRecallCandidate, feedback: "view"): Promise<RetrievalHabitProfileRecordResult>;
    };

    it("starts without historical extraction, runs a new chat trigger, and cancels queued work on pause", async () => {
        jest.useFakeTimers();
        const { plugin } = createPluginHarness({ initialData: { aiProvider: "openai", statisticsVaultId: "learning-runtime" } });
        const runtime = plugin as unknown as Runtime;
        try {
            await plugin.loadSettings();
            await runtime.migrateSettings();
            const store = new MemoryUserProfileStore();
            runtime.createUserProfileStore = jest.fn(() => store);
            runtime.getGovernedMemoryProjectionSnapshot = () => null;
            const getTurns = jest.fn(async (_conversationId: string) => [{ conversationId: "fresh", turnIndex: 1,
                user: { role: "user", content: "I prefer concise answers." },
                assistant: { role: "assistant", content: "Understood." } }]);
            const findConversation = jest.fn(async (_conversationId: string) => ({ id: "fresh", title: "Fresh chat", turnCount: 1 }));
            runtime.chatHistoryManager = { findConversation, getTurns };
            const invoke = jest.fn(async () => ({ content: "[]" }));
            const createModel = jest.fn(async () => ({ invoke }));
            runtime.createChatModel = createModel;
            runtime.pageletCostTracker = { record: jest.fn() };
            runtime.notifySettingsChanged = async () => runtime.syncMemoryExtractionRuntime();
            runtime.syncMemoryExtractionRuntime();
            expect(runtime.memoryExtractionScheduler).not.toBeNull();
            await jest.advanceTimersByTimeAsync(48 * 60 * 60_000);
            expect(findConversation).not.toHaveBeenCalled();
            expect(createModel).not.toHaveBeenCalled();
            expect(plugin.settings.memoryExtractionConsent.state).toBe("unconfirmed");
            expect(plugin.settings.memoryExtractionIncludeVaultInsights).toBe(false);
            plugin.scheduleMemoryExtractionAfterChatTurn("fresh", 1);
            await jest.advanceTimersByTimeAsync(2_000);
            expect(getTurns).toHaveBeenCalledWith("fresh");
            expect(invoke).toHaveBeenCalledTimes(1);
            plugin.scheduleMemoryExtractionAfterChatTurn("next", 1);
            await plugin.saveSettingsPermissions({ memoryExtractionEnabled: false });
            expect(runtime.memoryExtractionScheduler).toBeNull();
            plugin.scheduleMemoryExtractionAfterChatTurn("paused", 1);
            await jest.advanceTimersByTimeAsync(2_000);
            expect(findConversation).toHaveBeenCalledTimes(1);
            expect(invoke).toHaveBeenCalledTimes(1);
        } finally {
            runtime.memoryExtractionScheduler?.dispose();
            jest.useRealTimers();
        }
    });

    it("invalidates the old scheduler before delayed settings watchers allow a restart", async () => {
        const { plugin } = createPluginHarness({ initialData: { aiProvider: "openai", statisticsVaultId: "learning-restart" } });
        const runtime = plugin as unknown as Runtime;
        await plugin.loadSettings();
        await runtime.migrateSettings();
        runtime.createUserProfileStore = () => new MemoryUserProfileStore();
        runtime.getGovernedMemoryProjectionSnapshot = () => null;
        runtime.chatHistoryManager = { findConversation: jest.fn(), getTurns: jest.fn() };
        plugin.settings.memoryExtractionNoticeDismissed = true;
        runtime.syncMemoryExtractionRuntime();
        const original = runtime.memoryExtractionScheduler!;
        let release!: () => void;
        let reached!: () => void;
        const waiting = new Promise<void>((resolve) => { release = resolve; });
        const entered = new Promise<void>((resolve) => { reached = resolve; });
        let first = true;
        runtime.notifySettingsChanged = async () => {
            if (first) { first = false; reached(); await waiting; }
            runtime.syncMemoryExtractionRuntime();
        };
        const stopping = plugin.saveSettingsPermissions({ memoryExtractionEnabled: false });
        try {
            await entered;
            expect(runtime.memoryExtractionScheduler).toBeNull();
            await plugin.saveSettingsPermissions({ memoryExtractionEnabled: true });
            expect(runtime.memoryExtractionScheduler).not.toBe(original);
            expect(runtime.memoryExtractionScheduler).not.toBeNull();
            await expect(original.runTypeAExtraction("expired")).resolves.toBeNull();
        } finally {
            release();
            await stopping;
            runtime.memoryExtractionScheduler?.dispose();
        }
    });

    it("records default local feedback and stops after the independent preference is saved off", async () => {
        const { plugin, readPersisted } = createPluginHarness({ initialData: { aiProvider: "openai", statisticsVaultId: "habit-runtime" } });
        const runtime = plugin as unknown as Runtime;
        await plugin.loadSettings();
        await runtime.migrateSettings();
        runtime.notifySettingsChanged = jest.fn(async () => undefined);
        runtime.isDataBoundaryAllowedPath = () => true;
        const candidate: QuietRecallCandidate = { id: "recall", title: "Recall", summary: "Related source",
            sourceRefs: [{ path: "notes/source.md", evidenceStrength: "medium" }], whyNow: [],
            nextAction: "", relation: "related", score: 48, generatedAt: new Date().toISOString() };
        expect((await runtime.recordQuietRecallFeedback(candidate, "view")).ok).toBe(true);
        expect(plugin.settings.retrievalHabitProfile.state.aggregates.length).toBeGreaterThan(0);
        expect(readPersisted()?.retrievalHabitProfile).toEqual(plugin.settings.retrievalHabitProfile);
        const previous = JSON.stringify(readPersisted()?.retrievalHabitProfile);
        await plugin.saveSettingsPermissions({ retrievalHabitProfile: { enabled: false } });
        const snapshot = JSON.stringify(plugin.settings.retrievalHabitProfile.state);
        expect(await runtime.recordQuietRecallFeedback(candidate, "view")).toEqual({ ok: false, reason: "disabled" });
        expect(JSON.stringify(plugin.settings.retrievalHabitProfile.state)).toBe(snapshot);
        expect(JSON.stringify(readPersisted()?.retrievalHabitProfile)).not.toBe(previous);
        expect(plugin.settings.memoryExtractionEnabled).toBe(true);
    });
});

describe("B-106 settings lifecycle", () => {
    type Internals = {
        migrateSettings(): Promise<void>;
        saveSettingsData(snapshot?: unknown): Promise<void>;
        pendingSimpleSettingsCanonicalization: boolean;
        deepDiscoverScheduler: { setAutomaticEnabled: jest.Mock };
        notifySettingsChanged(): Promise<void>;
        isBackgroundDiscoveryEnabled(): boolean;
    };

    it("removes old keys through migration and stale saves without changing protected data", async () => {
        const raw = {
            aiProvider: "openai", baseURL: "https://custom.example/v1", statisticsVaultId: "settings-test",
            memoryAutoCheckBeforeChat: false, skillContextEnabled: false, enabledSkillIds: [],
            pagelet: { preloadEnabled: false, deepDiscoverEnabled: false, proactiveHints: false },
            confirmedMemoryCount: 37, memoryAutoAcceptPaused: true,
            memoryGovernance: { records: [], futureField: "keep" },
            reviewQueue: { items: [], futureField: "keep" },
            dataBoundary: { excludedFolders: ["private"] },
            operationsAgentEnabled: false, webSearchEnabled: false,
        };
        const { plugin, readPersisted, secretStorage } = createPluginHarness({ initialData: raw });
        const state = plugin as unknown as Internals;
        await plugin.loadSettings();
        expect(state.pendingSimpleSettingsCanonicalization).toBe(true);
        expect(hasDeprecatedSimpleSettingsFields(plugin.settings)).toBe(false);
        expect(plugin.settings.pagelet.backgroundDiscoveryEnabled).toBe(true);
        await state.migrateSettings();
        expect(state.pendingSimpleSettingsCanonicalization).toBe(false);
        expect(hasDeprecatedSimpleSettingsFields(readPersisted())).toBe(false);
        for (const key of ["memoryGovernance", "reviewQueue", "confirmedMemoryCount", "memoryAutoAcceptPaused"] as const) {
            expect(readPersisted()?.[key]).toEqual(raw[key]);
        }
        await state.saveSettingsData({ ...plugin.settings, skillContextEnabled: false,
            pagelet: { ...plugin.settings.pagelet, deepDiscoverEnabled: false } });
        expect(hasDeprecatedSimpleSettingsFields(readPersisted())).toBe(false);
        expect(readPersisted()).toMatchObject({ baseURL: raw.baseURL, dataBoundary: raw.dataBoundary,
            operationsAgentEnabled: false, webSearchEnabled: false });
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
    });

    it("keeps canonicalization pending after a failed write and retries", async () => {
        const { plugin, adapter, readPersisted } = createPluginHarness({ initialData: {
            aiProvider: "openai", statisticsVaultId: "settings-test", skillContextEnabled: false,
        } });
        const state = plugin as unknown as Internals;
        await plugin.loadSettings();
        adapter.process.mockRejectedValueOnce(new Error("disk unavailable"));
        await expect(state.migrateSettings()).rejects.toThrow("disk unavailable");
        expect(state.pendingSimpleSettingsCanonicalization).toBe(true);
        await state.migrateSettings();
        expect(state.pendingSimpleSettingsCanonicalization).toBe(false);
        expect(hasDeprecatedSimpleSettingsFields(readPersisted())).toBe(false);
    });

    it.each(["paused", "unconfirmed", "invalid"])("B-135 distinguishes a recorded pause from %s consent", async (state) => {
        const { plugin, readPersisted } = createPluginHarness({ initialData: {
            aiProvider: "openai", memoryExtractionEnabled: true,
            memoryExtractionConsent: { state, version: 1 },
        } });
        await plugin.loadSettings();
        expect(plugin.settings.memoryExtractionEnabled).toBe(state !== "paused");
        await plugin.saveSettings();
        const reloaded = createPluginHarness({ initialData: readPersisted() });
        await reloaded.plugin.loadSettings();
        expect(reloaded.plugin.settings.memoryExtractionEnabled).toBe(state !== "paused");
        expect(reloaded.plugin.settings.retrievalHabitProfile.enabled).toBe(true);
    });

    it("B-135 adopts learning defaults without manufacturing pre-consent confirmation", async () => {
        const { plugin } = createPluginHarness({ initialData: { memoryExtractionEnabled: true } });
        await plugin.loadSettings();
        expect(plugin.settings.memoryExtractionEnabled).toBe(true);
        expect(plugin.settings.memoryExtractionConsent).toEqual({ state: "unconfirmed", version: 1 });
        expect(plugin.settings.retrievalHabitProfile.enabled).toBe(true);
    });

    it("publishes background changes only after persistence and preserves concurrent live edits", async () => {
        const { plugin, adapter, readPersisted } = createPluginHarness({ initialData: {
            pagelet: { backgroundDiscoveryEnabled: false },
        } });
        await plugin.loadSettings();
        const state = plugin as unknown as Internals;
        state.notifySettingsChanged = jest.fn(async () => undefined);
        const setAutomaticEnabled = jest.fn();
        state.deepDiscoverScheduler = { setAutomaticEnabled };
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const process = adapter.process.getMockImplementation()!;
        adapter.process.mockImplementationOnce(async (...args: unknown[]) => {
            await gate;
            return process(...args);
        });
        const save = plugin.setBackgroundDiscoveryEnabled(true);
        await Promise.resolve();
        expect(state.isBackgroundDiscoveryEnabled()).toBe(false);
        expect(setAutomaticEnabled).not.toHaveBeenCalled();
        plugin.settings.author = "concurrent draft";
        release();
        await save;
        expect(plugin.settings.pagelet.backgroundDiscoveryEnabled).toBe(true);
        expect(plugin.settings.author).toBe("concurrent draft");
        expect(readPersisted()).toMatchObject({ pagelet: { backgroundDiscoveryEnabled: true } });
        expect(setAutomaticEnabled).toHaveBeenCalledWith(true);
    });

    it("fails automatic work closed after uncertain persistence and resumes only after retry", async () => {
        const { plugin, adapter } = createPluginHarness({ initialData: {
            pagelet: { backgroundDiscoveryEnabled: false },
        } });
        await plugin.loadSettings();
        const state = plugin as unknown as Internals;
        state.notifySettingsChanged = jest.fn(async () => undefined);
        state.deepDiscoverScheduler = { setAutomaticEnabled: jest.fn() };
        adapter.process.mockRejectedValueOnce(new Error("disk unavailable"));
        await expect(plugin.setBackgroundDiscoveryEnabled(true)).rejects.toThrow("disk unavailable");
        expect(plugin.settings.pagelet.backgroundDiscoveryEnabled).toBe(false);
        expect(state.isBackgroundDiscoveryEnabled()).toBe(false);
        expect(state.deepDiscoverScheduler.setAutomaticEnabled).not.toHaveBeenCalledWith(true);
        await plugin.setBackgroundDiscoveryEnabled(true);
        expect(state.isBackgroundDiscoveryEnabled()).toBe(true);
    });

    it("does not admit an automatic snapshot across a background pause and resume", async () => {
        const { plugin } = createPluginHarness({ initialData: { aiProvider: "openai" } });
        await plugin.loadSettings();
        const state = plugin as unknown as Internals & {
            createAiServiceHost(): unknown;
            isPageletProviderPathAllowed(path: string): boolean;
            capturePageletDeepDiscoverAnchorSnapshot(): Promise<unknown>;
            getOrCreatePageletDeepDiscoverScheduler(): Promise<unknown>;
            runPageletDeepDiscover(input: { path: string; triggerReason: "leave-note"; force: boolean }): Promise<unknown>;
        };
        await state.migrateSettings();
        state.notifySettingsChanged = jest.fn(async () => undefined);
        plugin.getAISetupIssue = jest.fn(() => null);
        state.createAiServiceHost = jest.fn(() => ({}));
        state.isPageletProviderPathAllowed = jest.fn(() => true);
        let finish!: (snapshot: unknown) => void;
        state.capturePageletDeepDiscoverAnchorSnapshot = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
        state.getOrCreatePageletDeepDiscoverScheduler = jest.fn(async () => null);
        const run = state.runPageletDeepDiscover({ path: "synthetic.md", triggerReason: "leave-note", force: true });
        await plugin.setBackgroundDiscoveryEnabled(false);
        await plugin.setBackgroundDiscoveryEnabled(true);
        finish({ path: "synthetic.md" });
        await expect(run).resolves.toMatchObject({ status: "quiet", reason: "aborted" });
        expect(state.getOrCreatePageletDeepDiscoverScheduler).not.toHaveBeenCalled();
        await plugin.setBackgroundDiscoveryEnabled(false);
        await expect(state.runPageletDeepDiscover({
            path: "synthetic.md", triggerReason: "leave-note", force: true,
        })).resolves.toMatchObject({ status: "limit", reason: "unavailable" });
        expect(state.capturePageletDeepDiscoverAnchorSnapshot).toHaveBeenCalledTimes(1);
    });

    it("keeps admission closed when a write reaches disk but readback fails", async () => {
        const { plugin, adapter, readPersisted } = createPluginHarness({ initialData: {
            aiProvider: "openai", pagelet: { backgroundDiscoveryEnabled: false },
        } });
        await plugin.loadSettings();
        const state = plugin as unknown as Internals;
        await state.migrateSettings();
        state.notifySettingsChanged = jest.fn(async () => undefined);
        state.deepDiscoverScheduler = { setAutomaticEnabled: jest.fn() };
        adapter.read.mockRejectedValueOnce(new Error("readback unavailable"));
        await expect(plugin.setBackgroundDiscoveryEnabled(true)).rejects.toThrow("readback unavailable");
        expect(readPersisted()).toMatchObject({ pagelet: { backgroundDiscoveryEnabled: true } });
        expect(plugin.settings.pagelet.backgroundDiscoveryEnabled).toBe(false);
        expect(state.isBackgroundDiscoveryEnabled()).toBe(false);
        expect(state.deepDiscoverScheduler.setAutomaticEnabled).not.toHaveBeenCalledWith(true);
        await plugin.setBackgroundDiscoveryEnabled(true);
        expect(state.isBackgroundDiscoveryEnabled()).toBe(true);
    });

    it("serializes consecutive background choices in durable order", async () => {
        const { plugin, adapter, readPersisted } = createPluginHarness({ initialData: {
            aiProvider: "openai", pagelet: { backgroundDiscoveryEnabled: false },
        } });
        await plugin.loadSettings();
        const state = plugin as unknown as Internals;
        await state.migrateSettings();
        state.notifySettingsChanged = jest.fn(async () => undefined);
        state.deepDiscoverScheduler = { setAutomaticEnabled: jest.fn() };
        const persistedChoices: boolean[] = [];
        const process = adapter.process.getMockImplementation()!;
        adapter.process.mockImplementation(async (...args: unknown[]) => {
            const result = await process(...args);
            persistedChoices.push((readPersisted()?.pagelet as { backgroundDiscoveryEnabled: boolean }).backgroundDiscoveryEnabled);
            return result;
        });
        await Promise.all([
            plugin.setBackgroundDiscoveryEnabled(true),
            plugin.setBackgroundDiscoveryEnabled(false),
            plugin.setBackgroundDiscoveryEnabled(true),
        ]);
        expect(persistedChoices).toEqual([true, false, true]);
        expect(plugin.settings.pagelet.backgroundDiscoveryEnabled).toBe(true);
        expect(state.deepDiscoverScheduler.setAutomaticEnabled.mock.calls).toEqual([[true], [false], [true]]);
    });
});

describe('B-106 feature and permission Plugin integration', () => {
    type State = {
        unloading: boolean;
        settingsSaveTail: Promise<void> | null;
        aiProviderConfigurationRevision: number;
        aiTokenRevision: number;
        aiProviderCredentialTransitionCount: number;
        tokenCacheState: 'unknown' | 'present' | 'missing';
        _localGraph: unknown;
        statsManager: { setStatisticsSyncEnabled(enabled: boolean): Promise<void> };
        notifySettingsChanged(): Promise<void>;
        runAdvancedMemoryCommand(checking: boolean, action: () => Promise<void>): boolean;
        runManualMemoryAction(action: () => Promise<void>): Promise<void>;
        vss: unknown;
        memoryManager: unknown;
        migrateSettings(): Promise<void>;
    };
    class Element extends DomStubNode {
        onclick?: () => void | Promise<void>;
        oninput?: () => void;
        onchange?: () => void;
        open = false;
        focus = jest.fn();
        addClass(value: string): void { this.classList.add(value); }
        empty(): void { this.textContent = ''; }
        createEl(tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): Element {
            const element = this.appendChild(new Element(tag));
            if (options.cls) element.addClass(options.cls);
            if (options.text) element.setText(options.text);
            for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
            return element;
        }
        createDiv(options?: Parameters<Element['createEl']>[1]): Element { return this.createEl('div', options); }
        createSpan(options?: Parameters<Element['createEl']>[1]): Element { return this.createEl('span', options); }
    }
    const nodes = (modal: Modal, tag: string) => findAllByTag(modal.contentEl as unknown as DomStubNode, tag) as Element[];
    const click = async (modal: Modal, key: string) => {
        const target = nodes(modal, 'button').find((node) => node.textContent === pluginT(key));
        expect(target).toBeDefined();
        if (!target!.disabled) await target!.onclick?.();
    };
    function deferred<T = void>() {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((done) => { resolve = done; });
        return { promise, resolve };
    }
    async function fixture() {
        const harness = createPluginHarness({ initialData: {
            aiProvider: 'qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            chatModelName: 'qwen-plus', embeddingModelName: 'text-embedding-v4',
            webSearchEnabled: false, operationsAgentEnabled: false,
            statisticsSyncEnabled: false,
            learningPreferences: { version: 1, memoryExtraction: 'default', habitLearning: 'disabled' },
        }, secretStorageValues: { 'pa-api-token': 'synthetic-token' } });
        await harness.plugin.loadSettings();
        const state = harness.plugin as unknown as State;
        await state.migrateSettings();
        state.notifySettingsChanged = jest.fn(async () => undefined);
        return { ...harness, state };
    }
    function modalDom() {
        jest.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
            Object.assign(this, { contentEl: new Element('div'), titleEl: new Element('h2') });
            this.onOpen();
        });
        jest.spyOn(Modal.prototype, 'close').mockImplementation(function (this: Modal) { this.onClose(); });
    }
    function bindNote(plugin: Awaited<ReturnType<typeof fixture>>['plugin']) {
        const file = Object.assign(new TFile(), { path: 'notes/bound.md', basename: 'bound', extension: 'md' });
        const editor = { getValue: () => 'bound note' } as unknown as Editor;
        const view = new MarkdownView(undefined as never);
        Object.assign(view, { editor, file, containerEl: { isConnected: true } });
        const lookup = jest.fn(() => file);
        Object.assign(plugin.app.vault, { getAbstractFileByPath: lookup });
        Object.assign(plugin.app, { workspace: { getActiveViewOfType: jest.fn(() => view) } });
        return { editor, view, file, lookup };
    }
    afterEach(() => { jest.restoreAllMocks(); });

    it('builds permission snapshots when the queue runs and publishes only after durable success', async () => {
        const { plugin, state, adapter, readPersisted } = await fixture();
        const queued = deferred();
        const entered = deferred();
        const writing = deferred();
        state.settingsSaveTail = queued.promise;
        const process = adapter.process.getMockImplementation()!;
        adapter.process.mockImplementationOnce(async (...args: unknown[]) => {
            entered.resolve();
            await writing.promise;
            return process(...args);
        });
        const saving = plugin.saveSettingsPermissions({ webSearchEnabled: true,
            retrievalHabitProfile: { enabled: true }, quickCapture: { postProcessingEnabled: true } });
        plugin.settings.author = 'concurrent author';
        plugin.settings.retrievalHabitProfile.state = { aggregates: [], clearedAt: '2026-09-08T01:00:00.000Z' };
        plugin.settings.quickCapture.inboxPath = 'custom/inbox.md';
        queued.resolve();
        await entered.promise;
        expect(plugin.settings.webSearchEnabled).toBe(false);
        expect(plugin.settings.retrievalHabitProfile.enabled).toBe(false);
        expect(state.notifySettingsChanged).not.toHaveBeenCalled();
        plugin.settings.retrievalHabitProfile.state = { aggregates: [], clearedAt: '2026-09-08T02:00:00.000Z' };
        writing.resolve();
        await saving;
        expect(readPersisted()).toMatchObject({ author: 'concurrent author', webSearchEnabled: true,
            retrievalHabitProfile: { enabled: true, state: { clearedAt: '2026-09-08T01:00:00.000Z' } },
            quickCapture: { inboxPath: 'custom/inbox.md', postProcessingEnabled: true } });
        expect(plugin.settings.retrievalHabitProfile.state.clearedAt).toBe('2026-09-08T02:00:00.000Z');
        expect(plugin.settings.webSearchEnabled).toBe(true);
        expect(state.notifySettingsChanged).toHaveBeenCalledTimes(1);
    });

    it('does not publish failed permission saves and keeps the requested patch independent of caller edits', async () => {
        const { plugin, state, adapter } = await fixture();
        const queued = deferred();
        state.settingsSaveTail = queued.promise;
        const requested = { operationsAgentEnabled: true, retrievalHabitProfile: { enabled: true } };
        const saving = plugin.saveSettingsPermissions(requested);
        requested.retrievalHabitProfile.enabled = false;
        adapter.process.mockRejectedValueOnce(new Error('disk unavailable'));
        const rejected = expect(saving).rejects.toThrow('disk unavailable');
        queued.resolve();
        await rejected;
        expect(plugin.settings.operationsAgentEnabled).toBe(false);
        expect(plugin.settings.retrievalHabitProfile.enabled).toBe(false);
        expect(state.notifySettingsChanged).not.toHaveBeenCalled();
        requested.retrievalHabitProfile.enabled = true;
        const retry = plugin.saveSettingsPermissions(requested);
        requested.retrievalHabitProfile.enabled = false;
        await retry;
        expect(plugin.settings.operationsAgentEnabled).toBe(true);
        expect(plugin.settings.retrievalHabitProfile.enabled).toBe(true);
    });

    it('saves a generated-note policy without widening it early or discarding concurrent exclusions', async () => {
        const { plugin, state, adapter, readPersisted } = await fixture();
        const queued = deferred();
        const entered = deferred();
        const writing = deferred();
        state.settingsSaveTail = queued.promise;
        const process = adapter.process.getMockImplementation()!;
        adapter.process.mockImplementationOnce(async (...args: unknown[]) => { entered.resolve(); await writing.promise; return process(...args); });
        const previous = plugin.settings.dataBoundary.generatedNotePolicy;
        const saving = plugin.saveSettingsPermissions({ dataBoundary: { generatedNotePolicy: 'include-generated' } });
        plugin.settings.dataBoundary.excludedFolders = ['private'];
        queued.resolve();
        await entered.promise;
        expect(plugin.settings.dataBoundary.generatedNotePolicy).toBe(previous);
        plugin.settings.dataBoundary.excludedTags = ['confidential'];
        writing.resolve();
        await saving;
        expect(readPersisted()).toMatchObject({ dataBoundary: { generatedNotePolicy: 'include-generated', excludedFolders: ['private'] } });
        expect(plugin.settings.dataBoundary.excludedTags).toEqual(['confidential']);
        expect(plugin.settings.dataBoundary.generatedNotePolicy).toBe('include-generated');
    });

    it('keeps all source scopes closed through a failed save, then publishes only their captured arrays', async () => {
        const { plugin, state, adapter, readPersisted } = await fixture();
        const scopePatch = (paths: string[]): SettingsPermissionPatch => ({
            vssCacheExcludePath: [...paths], metadataExcludePath: [...paths],
            dataBoundary: { excludedFolders: [...paths], excludedTags: [...paths] },
            pagelet: { excludedFolders: [...paths], excludedTags: [...paths], excludedPatterns: [...paths] },
        });
        const readScopes = () => ({
            vssCacheExcludePath: plugin.settings.vssCacheExcludePath,
            metadataExcludePath: plugin.settings.metadataExcludePath,
            dataBoundary: { excludedFolders: plugin.settings.dataBoundary.excludedFolders, excludedTags: plugin.settings.dataBoundary.excludedTags },
            pagelet: { excludedFolders: plugin.settings.pagelet.excludedFolders, excludedTags: plugin.settings.pagelet.excludedTags, excludedPatterns: plugin.settings.pagelet.excludedPatterns },
        });
        await plugin.saveSettingsPermissions(scopePatch(['private']));
        jest.mocked(state.notifySettingsChanged).mockClear();
        const entered = deferred();
        const writing = deferred();
        adapter.process.mockImplementationOnce(async () => {
            entered.resolve(); await writing.promise; throw new Error('scope save unavailable');
        });
        const failed = plugin.saveSettingsPermissions(scopePatch([]));
        const rejected = expect(failed).rejects.toThrow('scope save unavailable');
        await entered.promise;
        expect(readScopes()).toEqual(scopePatch(['private']));
        writing.resolve();
        await rejected;
        expect(readScopes()).toEqual(scopePatch(['private']));
        expect(readPersisted()).toMatchObject(scopePatch(['private']));
        expect(state.notifySettingsChanged).not.toHaveBeenCalled();

        const queued = deferred();
        const retryEntered = deferred();
        const retryWriting = deferred();
        state.settingsSaveTail = queued.promise;
        const process = adapter.process.getMockImplementation()!;
        adapter.process.mockImplementationOnce(async (...args: unknown[]) => {
            retryEntered.resolve(); await retryWriting.promise; return process(...args);
        });
        const requested = scopePatch([]);
        const retry = plugin.saveSettingsPermissions(requested);
        requested.pagelet!.excludedFolders!.push('caller-changed');
        plugin.settings.pagelet.outputLanguage = 'zh';
        const disclosure = plugin.settings.dataBoundary.providerDisclosureReasons.slice(0, 1);
        plugin.settings.dataBoundary.providerDisclosureReasons = disclosure;
        queued.resolve();
        await retryEntered.promise;
        expect(readScopes()).toEqual(scopePatch(['private']));
        plugin.settings.pagelet.petVisible = !plugin.settings.pagelet.petVisible;
        const livePetVisible = plugin.settings.pagelet.petVisible;
        retryWriting.resolve();
        await retry;
        expect(readScopes()).toEqual(scopePatch([]));
        expect(readPersisted()).toMatchObject({ ...scopePatch([]),
            dataBoundary: { ...scopePatch([]).dataBoundary, providerDisclosureReasons: disclosure },
            pagelet: { ...scopePatch([]).pagelet, outputLanguage: 'zh' },
        });
        expect(plugin.settings.pagelet.petVisible).toBe(livePetVisible);
        expect(plugin.settings.dataBoundary.providerDisclosureReasons).toEqual(disclosure);
        expect(state.notifySettingsChanged).toHaveBeenCalledTimes(1);
    });

    it('serializes statistics persistence before runtime switching and compensates a rejected runtime switch', async () => {
        const { plugin, state, adapter, readPersisted } = await fixture();
        const writing = deferred();
        const entered = deferred();
        const process = adapter.process.getMockImplementation()!;
        adapter.process.mockImplementationOnce(async (...args: unknown[]) => { entered.resolve(); await writing.promise; return process(...args); });
        const switchSync = jest.fn<(enabled: boolean) => Promise<void>>(async () => undefined);
        state.statsManager = { setStatisticsSyncEnabled: switchSync };
        const saving = plugin.setStatisticsSyncEnabled(true);
        await entered.promise;
        expect(switchSync).not.toHaveBeenCalled();
        expect(plugin.settings.statisticsSyncEnabled).toBe(false);
        writing.resolve();
        await saving;
        expect(switchSync).toHaveBeenCalledWith(true);
        expect(plugin.settings.statisticsSyncEnabled).toBe(true);
        expect(readPersisted()?.statisticsSyncEnabled).toBe(true);
        switchSync.mockRejectedValueOnce(new Error('store unavailable'));
        await expect(plugin.setStatisticsSyncEnabled(false)).rejects.toThrow('store unavailable');
        expect(plugin.settings.statisticsSyncEnabled).toBe(true);
        expect(readPersisted()?.statisticsSyncEnabled).toBe(true);
        expect(state.notifySettingsChanged).toHaveBeenCalledTimes(1);
    });

    it('does not switch statistics storage or publish when saving the sync preference fails', async () => {
        const { plugin, state, adapter } = await fixture();
        const switchSync = jest.fn<(enabled: boolean) => Promise<void>>(async () => undefined);
        state.statsManager = { setStatisticsSyncEnabled: switchSync };
        adapter.process.mockRejectedValueOnce(new Error('disk unavailable'));
        await expect(plugin.setStatisticsSyncEnabled(true)).rejects.toThrow('disk unavailable');
        expect(switchSync).not.toHaveBeenCalled();
        expect(plugin.settings.statisticsSyncEnabled).toBe(false);
        expect(state.notifySettingsChanged).not.toHaveBeenCalled();
    });

    it('keeps the bootstrapped Memory pause committed until its device repository transaction succeeds', async () => {
        const { plugin, state } = await fixture();
        plugin.settings.memoryAutoAcceptPaused = true;
        type Policy = { confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean };
        const entered = deferred();
        const writing = deferred();
        const transact = jest.fn<() => Promise<Policy>>(async () => {
            entered.resolve();
            await writing.promise;
            throw new Error('device store unavailable');
        });
        Object.assign(plugin, {
            memoryGovernanceBootstrapState: 'ready',
            memoryGovernanceOpaqueVaultKey: 'synthetic-vault',
            memoryGovernanceSourceHash: 'synthetic-source',
            deviceMemoryGovernanceRepository: { transact },
        });
        const failed = plugin.setMemoryAutoAcceptPaused(false);
        const rejected = expect(failed).rejects.toThrow('device store unavailable');
        await entered.promise;
        expect(plugin.settings.memoryAutoAcceptPaused).toBe(true);
        expect(state.notifySettingsChanged).not.toHaveBeenCalled();
        writing.resolve();
        await rejected;
        expect(plugin.settings.memoryAutoAcceptPaused).toBe(true);
        expect(state.notifySettingsChanged).not.toHaveBeenCalled();
        const committed = deferred<Policy>();
        transact.mockImplementationOnce(() => committed.promise);
        const retry = plugin.setMemoryAutoAcceptPaused(false);
        expect(plugin.settings.memoryAutoAcceptPaused).toBe(true);
        committed.resolve({ confirmedMemoryCount: 10, memoryAutoAcceptPaused: false });
        await retry;
        expect(plugin.settings.memoryAutoAcceptPaused).toBe(false);
        expect(plugin.settings.confirmedMemoryCount).toBe(10);
        expect(state.notifySettingsChanged).toHaveBeenCalledTimes(1);
    });

    it('rejects newly queued feature and permission writes during unload', async () => {
        const { plugin, state, adapter } = await fixture();
        const queued = deferred();
        state.settingsSaveTail = queued.promise;
        const saves = [
            plugin.saveSettingsPermissions({ webSearchEnabled: true }),
            plugin.setStatisticsSyncEnabled(true),
            plugin.saveGraphOptions({ localGraph: plugin.settings.localGraph, enableGraphColors: true, colorGroups: [] }),
            plugin.saveFeaturedImageDefaults({ featuredImageModel: 'wan2.7-image-pro', numFeaturedImages: 3, featuredImagePath: 'images' }),
        ];
        const rejected = Promise.all(saves.map((save) => expect(save).rejects.toThrow('unloading')));
        state.unloading = true;
        const writesBeforeRelease = adapter.process.mock.calls.length;
        queued.resolve();
        await rejected;
        expect(adapter.process).toHaveBeenCalledTimes(writesBeforeRelease);
        expect(state.notifySettingsChanged).not.toHaveBeenCalled();
    });

    it('saves graph defaults through the shared modal without opening a graph when no leaf exists', async () => {
        const { plugin, state, secretStorage, readPersisted } = await fixture();
        modalDom();
        const getLeaf = jest.fn();
        Object.assign(plugin.app, { workspace: { getLeavesOfType: jest.fn(() => []), getLeaf } });
        const { LocalGraph } = jest.requireActual<typeof import('../src/local-graph')>('../src/local-graph');
        state._localGraph = new LocalGraph(plugin.app, plugin);
        const modal = plugin.openGraphOptions();
        const depth = nodes(modal, 'input')[0];
        depth.value = '3'; depth.oninput?.();
        await click(modal, 'plugin.settings.graph.options.save');
        expect(plugin.settings.localGraph.depth).toBe(3);
        expect(readPersisted()).toMatchObject({ localGraph: { depth: 3 } });
        expect(getLeaf).not.toHaveBeenCalled();
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
    });

    it('opens and cancels both featured image modes without token reads or helper work', async () => {
        const { plugin, secretStorage } = await fixture();
        modalDom();
        const generate = jest.spyOn(AssistantFeaturedImageHelper.prototype, 'generate');
        const defaultsModal = plugin.openFeaturedImageOptions()!;
        await click(defaultsModal, 'plugin.settings.featuredImage.options.cancel');
        const { editor, view } = bindNote(plugin);
        const generateModal = plugin.openFeaturedImageOptions(editor, view)!;
        await click(generateModal, 'plugin.settings.featuredImage.options.cancel');
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
    });

    it('rejects a command target without a file rather than opening the defaults editor', async () => {
        const { plugin, secretStorage } = await fixture();
        modalDom();
        const { editor, view } = bindNote(plugin);
        Object.assign(view, { file: null });
        expect(plugin.openFeaturedImageOptions(editor, view)).toBeNull();
        expect(Modal.prototype.open).not.toHaveBeenCalled();
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
    });

    it('does not invoke the helper after failed default persistence and preserves the displayed draft', async () => {
        const { plugin, adapter } = await fixture();
        modalDom();
        const { editor, view } = bindNote(plugin);
        const generate = jest.spyOn(AssistantFeaturedImageHelper.prototype, 'generate');
        const modal = plugin.openFeaturedImageOptions(editor, view)!;
        nodes(modal, 'select')[1].value = '3';
        adapter.process.mockRejectedValueOnce(new Error('disk unavailable'));
        await click(modal, 'plugin.settings.featuredImage.options.generate');
        expect(generate).not.toHaveBeenCalled();
        expect(plugin.settings.numFeaturedImages).toBe(1);
        expect(nodes(modal, 'select')[1].value).toBe('3');
    });

    it.each(['provider', 'token', 'file', 'editor', 'detached', 'credential-transition'] as const)
    ('captures %s identity before saving and prevents a later mixed featured-image run', async (change) => {
        const { plugin, state, adapter } = await fixture();
        modalDom();
        const { editor, view, file, lookup } = bindNote(plugin);
        const generate = jest.spyOn(AssistantFeaturedImageHelper.prototype, 'generate');
        const entered = deferred();
        const writing = deferred();
        const process = adapter.process.getMockImplementation()!;
        adapter.process.mockImplementationOnce(async (...args: unknown[]) => { entered.resolve(); await writing.promise; return process(...args); });
        const modal = plugin.openFeaturedImageOptions(editor, view)!;
        const submit = click(modal, 'plugin.settings.featuredImage.options.generate');
        await entered.promise;
        if (change === 'provider') state.aiProviderConfigurationRevision = (state.aiProviderConfigurationRevision ?? 0) + 1;
        if (change === 'token') state.aiTokenRevision = (state.aiTokenRevision ?? 0) + 1;
        if (change === 'file') lookup.mockReturnValue(Object.assign(new TFile(), { path: file.path }));
        if (change === 'editor') Object.assign(view, { editor: {} });
        if (change === 'detached') Object.assign(view, { containerEl: { isConnected: false } });
        if (change === 'credential-transition') state.aiProviderCredentialTransitionCount = 1;
        writing.resolve();
        await submit;
        expect(generate).not.toHaveBeenCalled();
        expect(nodes(modal, 'p').some((node) => node.textContent === pluginT('plugin.settings.featuredImage.options.savedChanged'))).toBe(true);
    });

    it('hands off the bound note and freezes run defaults independently of subsequent default edits', async () => {
        const { plugin, state } = await fixture();
        modalDom();
        const { editor, view } = bindNote(plugin);
        const generate = jest.spyOn(AssistantFeaturedImageHelper.prototype, 'generate');
        const modal = plugin.openFeaturedImageOptions(editor, view)!;
        nodes(modal, 'select')[1].value = '3';
        await click(modal, 'plugin.settings.featuredImage.options.generate');
        expect(generate).toHaveBeenCalledTimes(1);
        const options = generate.mock.calls[0][0] as FeaturedImageRunOptions;
        expect(options.isCurrent()).toBe(true);
        await plugin.saveFeaturedImageDefaults({ featuredImageModel: 'wan2.7-image-pro', numFeaturedImages: 4, featuredImagePath: 'changed' });
        expect(options.numFeaturedImages).toBe(3);
        expect(options.featuredImagePath).toBe('');
        expect(options.isCurrent()).toBe(true);
        state.aiTokenRevision = (state.aiTokenRevision ?? 0) + 1;
        expect(options.isCurrent()).toBe(false);
    });

    it('registers context-sensitive commands that use the same graph and image modal entrypoints', async () => {
        const { plugin, secretStorage } = await fixture();
        modalDom();
        const { editor, view } = bindNote(plugin);
        const commands = new Map<string, Command>();
        const registrationComplete = new Error('requested commands registered');
        const shellElement = { addClass: jest.fn(), addEventListener: jest.fn(), setAttribute: jest.fn(), onClickEvent: jest.fn() };
        Object.assign(plugin, {
            ensureLoadedPluginBuildIdentity: jest.fn(async () => undefined),
            cleanupLegacyMobileDebugLog: jest.fn(async () => undefined),
            migrateSettings: jest.fn(async () => undefined),
            initializeMemoryGovernanceBootstrap: jest.fn(async () => undefined),
            surfacePendingPageletReviewsFolderMigration: jest.fn(),
            surfacePendingMemoryExtractionConsentMigration: jest.fn(),
            initializeMemorySubsystem: jest.fn(async () => undefined),
            initializeStatsSubsystem: jest.fn(),
            createChatHistoryStore: () => new MemoryChatHistoryStore(),
            addRibbonIcon: () => shellElement,
            addStatusBarItem: () => shellElement,
            registerView: jest.fn(),
            addCommand: (command: Command) => {
                commands.set(command.id, command);
                if (command.id === 'ai-assistant-featured-images') throw registrationComplete;
                return command;
            },
        });
        Object.assign(plugin.app.vault, { on: jest.fn(() => ({})) });
        await expect(plugin.onload()).rejects.toBe(registrationComplete);
        const graphEntry = jest.spyOn(plugin, 'openGraphOptions');
        const imageEntry = jest.spyOn(plugin, 'openFeaturedImageOptions');
        const activeView = jest.fn<(viewType: typeof ItemView) => ItemView | null>(() => null);
        Object.assign(plugin.app.workspace, { getActiveViewOfType: activeView });
        const graph = commands.get('pa-graph-options')!;
        expect(graph.checkCallback?.(true)).toBe(false);
        activeView.mockReturnValue(Object.assign(Object.create(ItemView.prototype) as ItemView, { getViewType: () => 'localgraph' }));
        expect(graph.checkCallback?.(true)).toBe(true);
        expect(activeView.mock.calls.every(([viewType]) => viewType === ItemView)).toBe(true);
        expect(graphEntry).not.toHaveBeenCalled();
        graph.checkCallback?.(false);
        expect(graphEntry).toHaveBeenCalledTimes(1);
        const image = commands.get('ai-assistant-featured-images')!;
        expect(image.editorCheckCallback?.(true, editor, view)).toBe(true);
        expect(imageEntry).not.toHaveBeenCalled();
        image.editorCheckCallback?.(false, editor, view);
        const imageCalls = imageEntry.mock.calls as Array<[unknown, unknown]>;
        expect(imageCalls).toHaveLength(1);
        expect(imageCalls[0][0] === editor).toBe(true);
        expect(imageCalls[0][1] === view).toBe(true);
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        plugin.settings.aiProvider = 'openai';
        expect(image.editorCheckCallback?.(true, editor, view)).toBe(false);
    });

    it('keeps advanced Memory commands reachable with the retired display preference off and retains effective gates', async () => {
        const { plugin, state } = await fixture();
        plugin.settings.showAdvancedMemoryControls = false;
        plugin.settings.memoryEnabled = true;
        state.vss = {}; state.memoryManager = {};
        state.runManualMemoryAction = jest.fn(async (action: () => Promise<void>) => action());
        const action = jest.fn(async () => undefined);
        expect(state.runAdvancedMemoryCommand(true, action)).toBe(true);
        expect(action).not.toHaveBeenCalled();
        expect(state.runAdvancedMemoryCommand(false, action)).toBe(true);
        expect(action).toHaveBeenCalledTimes(1);
        plugin.settings.memoryEnabled = false;
        expect(state.runAdvancedMemoryCommand(true, action)).toBe(false);
        plugin.settings.memoryEnabled = true; state.vss = null;
        expect(state.runAdvancedMemoryCommand(true, action)).toBe(false);
        state.vss = {}; plugin.settings.aiProvider = '';
        expect(state.runAdvancedMemoryCommand(true, action)).toBe(false);
        expect(state.runAdvancedMemoryCommand(false, action)).toBe(true);
        expect(action).toHaveBeenCalledTimes(1);
    });
});

describe("Plugin lifecycle integration", () => {

    it('invalidates writing samples on a repository commit even when later Forget cleanup fails', async () => {
        const { plugin } = createPluginHarness();
        await plugin.loadSettings();
        let commit: () => void = () => undefined;
        let finishRefresh!: () => void;
        const stop = jest.fn();
        const state = plugin as unknown as {
            deviceMemoryGovernanceRepository: unknown;
            deviceMemoryCacheRefreshPromise: Promise<void>;
            createChatHost(): import('../src/chat/ChatHost').ChatHost;
        };
        state.deviceMemoryGovernanceRepository = { subscribe: (listener: () => void) => { commit = listener; return stop; } };
        state.deviceMemoryCacheRefreshPromise = new Promise((resolve) => { finishRefresh = resolve; });
        const listener = jest.fn<() => void>();
        const unsubscribe = state.createChatHost().onWritingReferencesChanged!(listener);
        commit(); // First Forget commit; do not emit a successful settings notification.
        expect(listener).toHaveBeenCalledTimes(1);
        finishRefresh(); await Promise.resolve();
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe(); commit(); await Promise.resolve();
        expect(listener).toHaveBeenCalledTimes(2); expect(stop).toHaveBeenCalledTimes(1);
    });

    describe("loadSettings with null data.json", () => {
        it("initializes missing data.json and produces valid settings", async () => {
            const { plugin, readPersisted } = createPluginHarness({ initialData: null });

            await plugin.loadSettings();

            expect(plugin.settings).toBeDefined();
            expect(plugin.settings.aiProvider).toBe("");
            const persisted = readPersisted();
            expect(persisted).not.toBeNull();
        });

        it("keeps token presence unknown on fresh install", async () => {
            const { plugin } = createPluginHarness({ initialData: null });

            await plugin.loadSettings();

            expect(plugin.getAPITokenCacheState()).toBe("unknown");
            expect(plugin.hasTokenCachedValue()).toBeNull();
        });

        it("recognizes a retained SecretStorage token after provider selection", async () => {
            const { plugin, secretStorage } = createPluginHarness({
                initialData: null,
                secretStorageValues: { "pa-api-token": "sk-retained" },
            });

            await plugin.loadSettings();
            expect(secretStorage.getSecret).not.toHaveBeenCalled();
            plugin.settings.aiProvider = "openai";
            plugin.settings.baseURL = "https://api.openai.com/v1";
            plugin.settings.chatModelName = "gpt-4o-mini";

            expect(plugin.refreshAPITokenPresence()).toBe("present");
            const readsAfterRefresh = secretStorage.getSecret.mock.calls.length;
            expect(plugin.getAISetupIssue()).toBeNull();
            expect(plugin.getAISetupIssue()).toBeNull();
            expect(secretStorage.getSecret).toHaveBeenCalledTimes(readsAfterRefresh);
        });

        it("does not probe SecretStorage during passive layout-ready startup", async () => {
            const { plugin, secretStorage } = createPluginHarness({
                initialData: {
                    aiProvider: "openai",
                    baseURL: "https://api.openai.com/v1",
                    chatModelName: "gpt-4o-mini",
                },
                secretStorageValues: { "pa-api-token": "sk-retained" },
            });
            await plugin.loadSettings();
            const onSettingsChanged = jest.fn<() => void>();
            plugin.onSettingsChanged(onSettingsChanged);
            (plugin as unknown as { setupHoverPopoverObserver: () => void }).setupHoverPopoverObserver = jest.fn();
            (plugin as unknown as { initializeMemorySubsystem: () => Promise<void> }).initializeMemorySubsystem = jest.fn(async () => {
                (plugin as unknown as { unloading: boolean }).unloading = true;
            });

            await (plugin as unknown as { onLayoutReady(): Promise<void> }).onLayoutReady();

            expect(secretStorage.getSecret).not.toHaveBeenCalled();
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
            expect(onSettingsChanged).not.toHaveBeenCalled();
        });
    });

    describe("loadSettings with corrupt data.json", () => {
        it("handles non-object loadData result gracefully", async () => {
            const { plugin } = createPluginHarness({ initialData: null });
            plugin.loadData = jest.fn(async () => "not-an-object") as never;

            await plugin.loadSettings();

            expect(plugin.settings).toBeDefined();
            expect(plugin.settings.memoryEnabled).toBe(true);
        });

        it("handles array loadData result gracefully", async () => {
            const { plugin } = createPluginHarness({ initialData: null });
            plugin.loadData = jest.fn(async () => [1, 2, 3]) as never;

            await plugin.loadSettings();

            expect(plugin.settings).toBeDefined();
            expect(typeof plugin.settings.aiProvider).toBe("string");
        });
    });

    describe("legacy AI provider migration", () => {
        const migrateSettings = (plugin: unknown) => (
            plugin as { migrateSettings(): Promise<void> }
        ).migrateSettings();

        it.each([
            ["qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3.6-plus", "text-embedding-v4"],
            ["openai", "https://api.openai.com/v1", "gpt-4o-mini", "text-embedding-3-small"],
        ])(
            "preserves the explicitly persisted supported provider %s",
            async (aiProvider, baseURL, chatModelName, embeddingModelName) => {
                const { plugin, readPersisted, secretStorage } = createPluginHarness({
                    initialData: { aiProvider, baseURL, chatModelName, embeddingModelName },
                    secretStorageValues: { "pa-api-token": "sk-retained" },
                });

                await plugin.loadSettings();
                await migrateSettings(plugin);

                expect(plugin.settings).toMatchObject({
                    aiProvider,
                    baseURL,
                    chatModelName,
                    embeddingModelName,
                });
                expect(readPersisted()).toMatchObject({ aiProvider, baseURL });
                expect(secretStorage.getSecret).not.toHaveBeenCalled();
            },
        );

        it.each(["qwen-plus", "qwen-max", "qwen-turbo"])(
            "grandfathers the exact pre-Provider Qwen model %s",
            async (modelName) => {
                const { plugin, readPersisted, secretStorage } = createPluginHarness({
                    initialData: { debug: false, modelName },
                    secretStorageValues: { "pa-api-token": "sk-retained" },
                });

                await plugin.loadSettings();
                await migrateSettings(plugin);

                expect(plugin.settings).toMatchObject({
                    aiProvider: "qwen",
                    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    chatModelName: modelName,
                    embeddingModelName: "text-embedding-v3",
                });
                expect(readPersisted()).toMatchObject({ aiProvider: "qwen" });
                expect(secretStorage.getSecret).not.toHaveBeenCalled();
            },
        );

        it.each([" qwen-plus ", "gpt-4o"])(
            "fails closed for the unproven provider-less legacy model %p",
            async (modelName) => {
                const first = createPluginHarness({
                    initialData: { debug: false, modelName },
                    secretStorageValues: { "pa-api-token": "sk-retained" },
                });

                await first.plugin.loadSettings();
                await migrateSettings(first.plugin);

                expect(first.plugin.settings.aiProvider).toBe("");
                expect(first.plugin.getAIReadiness().issue).toBe("provider_missing");
                expect(first.secretStorage.getSecret).not.toHaveBeenCalled();
                expect(first.secretStorage.setSecret).not.toHaveBeenCalled();
                expect(first.readPersisted()).toMatchObject({ aiProvider: "" });

                const reloaded = createPluginHarness({
                    initialData: first.readPersisted(),
                    secretStorageValues: { "pa-api-token": "sk-retained" },
                });
                await reloaded.plugin.loadSettings();
                await migrateSettings(reloaded.plugin);
                expect(reloaded.plugin.settings.aiProvider).toBe("");
                expect(reloaded.secretStorage.getSecret).not.toHaveBeenCalled();
            },
        );

        it("requires a current provider choice for Ollama while reusing its retained token", async () => {
            const { plugin, readPersisted, secretStorage } = createPluginHarness({
                initialData: {
                    aiProvider: "ollama",
                    baseURL: "http://localhost:11434",
                    chatModelName: "llama3.1",
                    embeddingModelName: "mxbai-embed-large",
                },
                secretStorageValues: { "pa-api-token": "sk-retained" },
            });

            await plugin.loadSettings();
            await migrateSettings(plugin);

            expect(plugin.settings).toMatchObject({
                aiProvider: "",
                baseURL: "http://localhost:11434",
                chatModelName: "llama3.1",
                embeddingModelName: "mxbai-embed-large",
            });
            expect(plugin.getAIReadiness().issue).toBe("provider_missing");
            expect(secretStorage.getSecret).not.toHaveBeenCalled();
            expect(secretStorage.setSecret).not.toHaveBeenCalled();
            expect(readPersisted()).toMatchObject({ aiProvider: "" });

            await expect((plugin as unknown as {
                completeAISetup(input: { presetKey: string }): Promise<{ ok: boolean }>;
            }).completeAISetup({ presetKey: "openai" })).resolves.toEqual({ ok: true });
            expect(plugin.settings.aiProvider).toBe("openai");
            expect(secretStorage.getSecret).toHaveBeenCalled();
            expect(secretStorage.setSecret).not.toHaveBeenCalled();
        });
    });

    describe("hasTokenCached lifecycle", () => {
        it("returns null before any token access", () => {
            const { plugin } = createPluginHarness({
                initialData: { aiProvider: "qwen", baseURL: "https://example.com/v1", chatModelName: "model" },
            });

            expect(plugin.hasTokenCachedValue()).toBeNull();
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
        });

        it("setAPITokenSecret updates cache to true", () => {
            const { plugin } = createPluginHarness({
                initialData: { aiProvider: "qwen", baseURL: "https://example.com/v1", chatModelName: "model" },
            });

            plugin.setAPITokenSecret("sk-test-token");

            expect(plugin.hasTokenCachedValue()).toBe(true);
            expect(plugin.getAPITokenCacheState()).toBe("present");
        });

        it("setAPITokenSecret with empty value updates cache to false", () => {
            const { plugin } = createPluginHarness({ initialData: { aiProvider: "qwen" } });

            plugin.setAPITokenSecret("");

            expect(plugin.hasTokenCachedValue()).toBe(false);
            expect(plugin.getAPITokenCacheState()).toBe("missing");
        });

        it("clearTokenCache resets cache to null", () => {
            const { plugin } = createPluginHarness({ initialData: { aiProvider: "qwen" } });
            plugin.setAPITokenSecret("sk-test");

            plugin.clearTokenCache();

            expect(plugin.hasTokenCachedValue()).toBeNull();
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
        });

        it("treats a whitespace-only token as missing", () => {
            const { plugin } = createPluginHarness({ initialData: { aiProvider: "qwen" } });

            plugin.setAPITokenSecret("   ");

            expect(plugin.getAPITokenCacheState()).toBe("missing");
        });

        it("cancels active Memory before writing a token", () => {
            const { plugin, secretStorage } = createPluginHarness({ initialData: { aiProvider: "qwen" } });
            const cancelActivePreparation = jest.fn();
            (plugin as unknown as { memoryManager: unknown }).memoryManager = { cancelActivePreparation };
            secretStorage.setSecret.mockImplementation(() => {
                expect(cancelActivePreparation).toHaveBeenCalledTimes(1);
            });

            plugin.setAPITokenSecret("sk-test");

            expect(cancelActivePreparation).toHaveBeenCalledTimes(1);
        });

        it("invalidates a stale cache and notifies unknown when an add persists before throwing", async () => {
            const { plugin, secretStorage } = createPluginHarness({
                initialData: {
                    aiProvider: "qwen",
                    baseURL: "https://example.com/v1",
                    chatModelName: "model",
                    embeddingModelName: "embed",
                },
            });
            await plugin.loadSettings();
            const currentSecretId = plugin.getAPITokenSecretId();
            const defaultSetSecret = secretStorage.setSecret.getMockImplementation();
            expect(defaultSetSecret).toBeDefined();
            (plugin as unknown as { token: string; tokenCacheState: string }).token = "sk-stale";
            (plugin as unknown as { tokenCacheState: string }).tokenCacheState = "present";
            (plugin as unknown as { aiTokenRevision: number }).aiTokenRevision = 4;
            (plugin as unknown as { aiExternalSettingsMutationEpoch: number })
                .aiExternalSettingsMutationEpoch = 8;
            secretStorage.setSecret.mockImplementationOnce((id: string, value: string) => {
                defaultSetSecret!(id, value);
                throw new Error("write failed after persistence");
            });
            const observedIssues: Array<string | null> = [];
            plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

            expect(() => plugin.setAPITokenSecret("sk-new")).toThrow("write failed after persistence");

            expect((plugin as unknown as { token: string }).token).toBe("");
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
            expect(plugin.hasTokenCachedValue()).toBeNull();
            expect((plugin as unknown as { aiTokenRevision: number }).aiTokenRevision).toBe(5);
            expect((plugin as unknown as { aiExternalSettingsMutationEpoch: number })
                .aiExternalSettingsMutationEpoch).toBe(9);
            await plugin.notifyAIReadinessChanged();
            expect(observedIssues).toEqual(["token_unknown"]);
            expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");

            const reloaded = createPluginHarness({
                initialData: {
                    aiProvider: "qwen",
                    baseURL: "https://example.com/v1",
                    chatModelName: "model",
                    embeddingModelName: "embed",
                },
                secretStorageValues: { [currentSecretId]: "sk-new" },
            });
            await reloaded.plugin.loadSettings();
            expect(reloaded.plugin.refreshAPITokenPresence()).toBe("present");
            expect(reloaded.plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        });

        it("invalidates a cached token and reloads missing when removal persists before throwing", async () => {
            const currentSecretId = "pa-api-token-vault-test";
            const { plugin, secretStorage } = createPluginHarness({
                initialData: {
                    statisticsVaultId: "vault-test",
                    aiProvider: "qwen",
                    baseURL: "https://example.com/v1",
                    chatModelName: "model",
                    embeddingModelName: "embed",
                },
                secretStorageValues: { [currentSecretId]: "sk-old" },
            });
            await plugin.loadSettings();
            expect(await plugin.getAPIToken()).toBe("sk-old");
            const defaultSetSecret = secretStorage.setSecret.getMockImplementation();
            expect(defaultSetSecret).toBeDefined();
            (plugin as unknown as { aiTokenRevision: number }).aiTokenRevision = 12;
            (plugin as unknown as { aiExternalSettingsMutationEpoch: number })
                .aiExternalSettingsMutationEpoch = 20;
            secretStorage.setSecret.mockImplementationOnce((id: string, value: string) => {
                defaultSetSecret!(id, value);
                throw new Error("delete failed after persistence");
            });
            const observedIssues: Array<string | null> = [];
            plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

            expect(() => plugin.setAPITokenSecret("")).toThrow("delete failed after persistence");

            expect((plugin as unknown as { token: string }).token).toBe("");
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
            expect((plugin as unknown as { aiTokenRevision: number }).aiTokenRevision).toBe(13);
            expect((plugin as unknown as { aiExternalSettingsMutationEpoch: number })
                .aiExternalSettingsMutationEpoch).toBe(21);
            await plugin.notifyAIReadinessChanged();
            expect(observedIssues).toEqual(["token_unknown"]);
            expect(plugin.getConfiguredAPITokenSecret()).toBeNull();

            const reloaded = createPluginHarness({
                initialData: {
                    statisticsVaultId: "vault-test",
                    aiProvider: "qwen",
                    baseURL: "https://example.com/v1",
                    chatModelName: "model",
                    embeddingModelName: "embed",
                },
            });
            await reloaded.plugin.loadSettings();
            expect(reloaded.plugin.refreshAPITokenPresence()).toBe("missing");
            expect(reloaded.plugin.getAIReadiness().issue).toBe("token_missing");
        });
    });

    describe("mobile platform behavior", () => {
        afterEach(resetPlatform);

        it("plugin harness works on mobile platform", () => {
            setPlatformMobile();
            const { plugin } = createPluginHarness({
                initialData: { aiProvider: "qwen", baseURL: "https://example.com/v1", chatModelName: "m" },
            });
            expect(plugin.hasTokenCachedValue()).toBeNull();
            expect(plugin.settings).toBeDefined();
        });
    });
});

describe("AI readiness gate", () => {
    it("keeps local Memory status readable and probes a retained token only for a manual action", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        const getMaintenancePlan = jest.fn(async () => ({
            reason: "ready" as const,
            action: "none" as const,
            notesToCheck: 2,
            requiresApproval: false,
            canAnswerNow: true,
        }));
        const prepareFromCommand = jest.fn(async () => undefined);
        (plugin as unknown as { memoryManager: unknown }).memoryManager = {
            getMaintenancePlan,
            prepareFromCommand,
        };
        const settingsChanged = jest.fn<() => void>();
        const memoryStatusChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        plugin.onMemoryStatusChanged(memoryStatusChanged);
        const host = (plugin as unknown as { createChatHost(): { memoryStatus: {
            getMaintenancePlan(): Promise<{ reason: string }>;
            prepareFromCommand(): Promise<void>;
        } } }).createChatHost();

        await expect(host.memoryStatus.getMaintenancePlan()).resolves.toMatchObject({ reason: "ready" });
        expect(getMaintenancePlan).toHaveBeenCalledTimes(1);
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("unknown");

        await host.memoryStatus.prepareFromCommand();
        await Promise.resolve();

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("present");
        expect(prepareFromCommand).toHaveBeenCalledTimes(1);
        expect(settingsChanged).toHaveBeenCalledTimes(1);
        expect(memoryStatusChanged).toHaveBeenCalledTimes(1);
    });

    it("probes a retained token through the explicit AI command gate", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        const settingsChanged = jest.fn<() => void>();
        const memoryStatusChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        plugin.onMemoryStatusChanged(memoryStatusChanged);

        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect((plugin as unknown as { ensureAIConfigured(): boolean }).ensureAIConfigured()).toBe(true);
        await Promise.resolve();
        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("present");
        expect(settingsChanged).toHaveBeenCalledTimes(1);
        expect(memoryStatusChanged).toHaveBeenCalledTimes(1);
    });

    it("resolves a retained token when Pagelet is the first explicit provider surface after reload", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        plugin.settings.pagelet.enabled = true;
        plugin.settings.pagelet.backgroundDiscoveryEnabled = false;
        const captureAnchor = jest.fn(async () => ({ path: "notes/current.md" }));
        const runNow = jest.fn(async () => ({ status: "quiet", reason: "no-insight" }));
        const getScheduler = jest.fn(async () => {
            expect(plugin.getAISetupIssue()).toBeNull();
            return { runNow };
        });
        const runtime = plugin as unknown as {
            createAiServiceHost(scope: string): unknown;
            isPageletProviderPathAllowed(path: string): boolean;
            capturePageletDeepDiscoverAnchorSnapshot(): Promise<{ path: string }>;
            getOrCreatePageletDeepDiscoverScheduler(): Promise<{ runNow(input: unknown): Promise<unknown> }>;
            runPageletDeepDiscover(input: {
                path: string;
                triggerReason: "explicit";
                force: true;
            }): Promise<{ status: string; reason?: string }>;
        };
        runtime.createAiServiceHost = jest.fn(() => ({}));
        runtime.isPageletProviderPathAllowed = jest.fn(() => true);
        runtime.capturePageletDeepDiscoverAnchorSnapshot = captureAnchor;
        runtime.getOrCreatePageletDeepDiscoverScheduler = getScheduler;

        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        await expect(runtime.runPageletDeepDiscover({
            path: "notes/current.md",
            triggerReason: "explicit",
            force: true,
        })).resolves.toEqual({ status: "quiet", reason: "no-insight" });

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("present");
        expect(captureAnchor).toHaveBeenCalledTimes(1);
        expect(getScheduler).toHaveBeenCalledTimes(1);
        expect(runNow).toHaveBeenCalledTimes(1);
        expect(secretStorage.getSecret.mock.invocationCallOrder[0])
            .toBeLessThan(captureAnchor.mock.invocationCallOrder[0]!);
    });

    it.each([
        ["missing retained token", false],
        ["SecretStorage read failure", true],
    ])("fails the first explicit Pagelet provider action closed for %s", async (_label, throws) => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
        });
        await plugin.loadSettings();
        plugin.settings.pagelet.enabled = true;
        plugin.settings.pagelet.backgroundDiscoveryEnabled = false;
        if (throws) {
            secretStorage.getSecret.mockImplementationOnce(() => {
                throw new Error("SecretStorage unavailable");
            });
        }
        const captureAnchor = jest.fn(async () => ({ path: "notes/current.md" }));
        const getScheduler = jest.fn(async () => null);
        const runtime = plugin as unknown as {
            isPageletProviderPathAllowed(path: string): boolean;
            capturePageletDeepDiscoverAnchorSnapshot(): Promise<{ path: string }>;
            getOrCreatePageletDeepDiscoverScheduler(): Promise<unknown>;
            runPageletDeepDiscover(input: {
                path: string;
                triggerReason: "explicit";
                force: true;
            }): Promise<{ status: string; reason?: string }>;
        };
        runtime.isPageletProviderPathAllowed = jest.fn(() => true);
        runtime.capturePageletDeepDiscoverAnchorSnapshot = captureAnchor;
        runtime.getOrCreatePageletDeepDiscoverScheduler = getScheduler;

        await expect(runtime.runPageletDeepDiscover({
            path: "notes/current.md",
            triggerReason: "explicit",
            force: true,
        })).resolves.toEqual({ status: "limit", reason: "unavailable" });

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe(throws ? "unknown" : "missing");
        expect(captureAnchor).not.toHaveBeenCalled();
        expect(getScheduler).not.toHaveBeenCalled();
    });

    it("does not read SecretStorage for automatic Pagelet work or during a credential transition", async () => {
        const setup = async () => {
            const harness = createPluginHarness({
                initialData: {
                    aiProvider: "openai",
                    baseURL: "https://api.openai.com/v1",
                    chatModelName: "gpt-4o-mini",
                    embeddingModelName: "text-embedding-3-small",
                },
                secretStorageValues: { "pa-api-token": "sk-retained" },
            });
            await harness.plugin.loadSettings();
            harness.plugin.settings.pagelet.enabled = true;
            harness.plugin.settings.pagelet.backgroundDiscoveryEnabled = false;
            const captureAnchor = jest.fn(async () => ({ path: "notes/current.md" }));
            const runtime = harness.plugin as unknown as {
                aiProviderCredentialTransitionCount: number;
                isPageletProviderPathAllowed(path: string): boolean;
                capturePageletDeepDiscoverAnchorSnapshot(): Promise<{ path: string }>;
                runPageletDeepDiscover(input: {
                    path: string;
                    triggerReason: "leave-note" | "explicit";
                    force?: boolean;
                }): Promise<{ status: string; reason?: string }>;
            };
            runtime.isPageletProviderPathAllowed = jest.fn(() => true);
            runtime.capturePageletDeepDiscoverAnchorSnapshot = captureAnchor;
            return { ...harness, runtime, captureAnchor };
        };

        const automatic = await setup();
        await expect(automatic.runtime.runPageletDeepDiscover({
            path: "notes/current.md",
            triggerReason: "leave-note",
        })).resolves.toEqual({ status: "limit", reason: "unavailable" });
        expect(automatic.secretStorage.getSecret).not.toHaveBeenCalled();
        expect(automatic.captureAnchor).not.toHaveBeenCalled();

        const transitioning = await setup();
        transitioning.runtime.aiProviderCredentialTransitionCount = 1;
        await expect(transitioning.runtime.runPageletDeepDiscover({
            path: "notes/current.md",
            triggerReason: "explicit",
            force: true,
        })).resolves.toEqual({ status: "limit", reason: "unavailable" });
        expect(transitioning.secretStorage.getSecret).not.toHaveBeenCalled();
        expect(transitioning.captureAnchor).not.toHaveBeenCalled();
    });

    it("keeps a raw token presence probe local so inline setup draft state is not re-rendered", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        const settingsChanged = jest.fn<() => void>();
        const memoryStatusChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        plugin.onMemoryStatusChanged(memoryStatusChanged);

        expect(plugin.refreshAPITokenPresence()).toBe("present");
        await Promise.resolve();

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(settingsChanged).not.toHaveBeenCalled();
        expect(memoryStatusChanged).not.toHaveBeenCalled();
    });

    it("shows a setup issue when an explicit Memory action finds no saved token", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
        });
        await plugin.loadSettings();
        const prepareFromCommand = jest.fn(async () => undefined);
        (plugin as unknown as { memoryManager: unknown }).memoryManager = {
            getMaintenancePlan: jest.fn(async () => ({
                reason: "ready" as const,
                action: "none" as const,
                notesToCheck: 0,
                requiresApproval: false,
                canAnswerNow: true,
            })),
            prepareFromCommand,
        };
        const host = (plugin as unknown as { createChatHost(): { memoryStatus: {
            prepareFromCommand(): Promise<void>;
        } } }).createChatHost();
        const messages = (Notice as unknown as { messages: Array<{ message?: unknown }> }).messages;
        messages.length = 0;

        await host.memoryStatus.prepareFromCommand();

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("missing");
        expect(prepareFromCommand).not.toHaveBeenCalled();
        expect(messages.at(-1)?.message).toBe("Add your API token in Settings first.");
    });

    it("createChatModel throws when aiProvider is empty", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const host = {
            settings: { aiProvider: "", baseURL: "", chatModelName: "", embeddingModelName: "" },
            getAPIToken: jest.fn(async () => ""),
            log: jest.fn(),
        };
        const aiUtils = new AIUtils(host as never);

        await expect(aiUtils.createChatModel()).rejects.toThrow("AI provider not configured");
    });

    it("createEmbeddings throws when aiProvider is empty", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const host = {
            settings: { aiProvider: "", baseURL: "", chatModelName: "", embeddingModelName: "" },
            getAPIToken: jest.fn(async () => ""),
            log: jest.fn(),
        };
        const aiUtils = new AIUtils(host as never);

        await expect(aiUtils.createEmbeddings()).rejects.toThrow("AI provider not configured");
    });

    it("separates Chat readiness from Memory embedding readiness", async () => {
        const { plugin } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "",
            },
        });
        await plugin.loadSettings();
        plugin.setAPITokenSecret("sk-test");

        expect(plugin.getAIReadiness("chat")).toMatchObject({ ready: true, issue: null });
        expect(plugin.getAIReadiness("memory")).toMatchObject({
            ready: false,
            issue: "embedding_model_missing",
        });
    });

    it("rejects whitespace-only configuration before reading the token", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const getAPIToken = jest.fn(async () => "sk-test");
        const aiUtils = new AIUtils({
            settings: {
                aiProvider: " qwen ",
                baseURL: "   ",
                chatModelName: "   ",
                embeddingModelName: "   ",
            },
            getAPIToken,
            log: jest.fn(),
        });

        await expect(aiUtils.createChatModel()).rejects.toThrow("configuration incomplete");
        await expect(aiUtils.createEmbeddings()).rejects.toThrow("configuration incomplete");
        expect(getAPIToken).not.toHaveBeenCalled();
    });

    it("rejects an unsupported provider before reading the token", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const getAPIToken = jest.fn(async () => "sk-test");
        const aiUtils = new AIUtils({
            settings: {
                aiProvider: "ollama",
                baseURL: "http://localhost:11434/v1",
                chatModelName: "model",
                embeddingModelName: "embed",
            },
            getAPIToken,
            log: jest.fn(),
        });

        await expect(aiUtils.createChatModel()).rejects.toThrow("Unsupported AI provider: ollama");
        expect(getAPIToken).not.toHaveBeenCalled();
    });

    it("rejects an empty runtime token before constructing a model", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const getAPIToken = jest.fn(async () => "   ");
        const aiUtils = new AIUtils({
            settings: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            getAPIToken,
            log: jest.fn(),
        });

        await expect(aiUtils.createChatModel()).rejects.toThrow("API token not configured");
    });
});

describe("inline AI setup coordinator", () => {
    const completeSetup = (plugin: unknown, input: { presetKey?: string; token?: string }) => (
        plugin as { completeAISetup(value: typeof input): Promise<{ ok: boolean; code?: string }> }
    ).completeAISetup(input);
    const prepareForUnload = (plugin: unknown) => {
        const internals = plugin as Record<string, unknown>;
        internals.memoryManager = {
            cancelActivePreparation: jest.fn(),
            stopAutoMaintenance: jest.fn(),
            waitForIdle: jest.fn(async () => undefined),
        };
        const dispose = jest.fn(async () => undefined);
        internals.vss = { dispose };
        internals.phase3Handle = null;
        internals.resizeDebounceTimer = null;
        internals.hoverPopoverObserver = null;
        internals.debouncedStatusBarUpdate = { cancel: jest.fn() };
        internals.resetDeepDiscoverController = jest.fn();
        internals.cancelMemoryForgetRetry = jest.fn();
        internals.cancelMemoryProfileProjectionRetry = jest.fn();
        internals.cancelMemoryGovernanceGarbageCollection = jest.fn();
        return dispose;
    };

    it("reuses an existing token while completing a partial provider tuple", async () => {
        const { plugin, secretStorage, readPersisted } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                baseURL: "",
                chatModelName: "",
                embeddingModelName: "",
            },
            secretStorageValues: { "pa-api-token": "sk-existing" },
        });
        await plugin.loadSettings();
        secretStorage.setSecret.mockClear();

        await expect(completeSetup(plugin, { presetKey: "openai" })).resolves.toEqual({ ok: true });

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(plugin.settings.aiProvider).toBe("openai");
        expect(plugin.settings.aiProviderPreset).toBe("openai");
        expect(readPersisted()?.aiProviderPreset).toBe("openai");
    });

    it("preserves a complete custom provider when only the token is missing", async () => {
        const { plugin, readPersisted } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://custom.example/v1",
                chatModelName: "custom-chat",
                embeddingModelName: "custom-embed",
            },
        });
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        const saveData = jest.fn(async () => { throw new Error("data.json must not be written"); });
        plugin.saveData = saveData as never;
        (plugin as unknown as { aiProviderConfigurationRevision: number }).aiProviderConfigurationRevision = 17;

        await expect(completeSetup(plugin, { token: "sk-custom" })).resolves.toEqual({ ok: true });

        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://custom.example/v1",
            chatModelName: "custom-chat",
            embeddingModelName: "custom-embed",
        });
        expect(readPersisted()).toMatchObject({
            aiProviderPreset: "custom",
            baseURL: "https://custom.example/v1",
        });
        expect(saveData).not.toHaveBeenCalled();
        expect((plugin as unknown as { aiProviderConfigurationRevision: number })
            .aiProviderConfigurationRevision).toBe(17);
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-custom");
        expect(plugin.getAPITokenCacheState()).toBe("present");
    });

    it("blocks new Chat and Memory credential admission until a new provider-token pair commits", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        expect(plugin.getAIReadiness()).toMatchObject({ issue: "token_missing" });
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderSave!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerSaveGate = new Promise<void>((resolve) => { releaseProviderSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markProviderSaveStarted();
            await providerSaveGate;
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedIssues: Array<string | null> = [];
        plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        await providerSaveStarted;
        const tokenReadsBeforeConsumers = secretStorage.getSecret.mock.calls.length;
        expect(plugin.refreshAPITokenPresence()).toBe("unknown");
        expect(secretStorage.getSecret).toHaveBeenCalledTimes(tokenReadsBeforeConsumers);
        const providerRequests = jest.fn();
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const aiUtils = new AIUtils(plugin);
        const chatAttempt = plugin.createChatModel(0.2)
            .then((model) => providerRequests("chat", model));
        const memoryAttempt = aiUtils.createEmbeddings()
            .then((model) => providerRequests("memory", model));

        expect(plugin.getAIReadiness("chat")).toMatchObject({
            ready: false,
            issue: "token_unknown",
            aiProvider: "qwen",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        });
        expect(plugin.getAIReadiness("memory")).toMatchObject({
            ready: false,
            issue: "token_unknown",
        });
        await expect(chatAttempt).rejects.toThrow("AI provider configuration is being updated");
        await expect(memoryAttempt).rejects.toThrow("AI provider configuration is being updated");
        expect(secretStorage.getSecret).toHaveBeenCalledTimes(tokenReadsBeforeConsumers);
        expect(providerRequests).not.toHaveBeenCalled();
        expect(observedIssues).toEqual([]);

        releaseProviderSave();
        await expect(setup).resolves.toEqual({ ok: true });

        expect(plugin.settings).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.getAIReadiness("chat")).toMatchObject({ ready: true, issue: null });
        await expect(plugin.getAPIToken()).resolves.toBe("sk-new");
        expect(observedIssues).toEqual([null]);
    });

    it("keeps the old stable provider and missing token after a guarded setup save fails", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderFailure!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerFailureGate = new Promise<void>((resolve) => { releaseProviderFailure = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markProviderSaveStarted();
                await providerFailureGate;
                throw new Error("provider save failed");
            }
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedIssues: Array<string | null> = [];
        plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        await providerSaveStarted;
        const tokenReadsBeforeConsumer = secretStorage.getSecret.mock.calls.length;
        const providerRequests = jest.fn();
        const chatAttempt = plugin.createChatModel(0.2)
            .then((model) => providerRequests("chat", model));

        await expect(chatAttempt).rejects.toThrow("AI provider configuration is being updated");
        expect(secretStorage.getSecret).toHaveBeenCalledTimes(tokenReadsBeforeConsumer);
        expect(providerRequests).not.toHaveBeenCalled();
        expect(observedIssues).toEqual([]);

        releaseProviderFailure();
        await expect(setup).resolves.toEqual({ ok: false, code: "settings_save_failed" });

        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBeNull();
        expect(plugin.getAIReadiness()).toMatchObject({
            ready: false,
            issue: "token_missing",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen",
        });
        expect(observedIssues).toEqual(["token_missing"]);
    });

    it("does not mutate provider settings when the token write fails", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
        });
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        secretStorage.setSecret.mockImplementationOnce(() => { throw new Error("write failed"); });

        const result = await completeSetup(plugin, { presetKey: "openai", token: "sk-new" });

        expect(result).toEqual({ ok: false, code: "token_save_failed" });
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://old.example/v1",
            chatModelName: "old-chat",
            embeddingModelName: "old-embed",
        });
    });

    it("returns a structured failure without writing when the previous token cannot be read", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
        });
        await plugin.loadSettings();
        secretStorage.getSecret.mockImplementation(() => { throw new Error("read failed"); });

        await expect(completeSetup(plugin, {
            presetKey: "openai",
            token: "sk-new",
        })).resolves.toEqual({ ok: false, code: "token_save_failed" });

        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("unknown");
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://old.example/v1",
            chatModelName: "old-chat",
            embeddingModelName: "old-embed",
        });
    });

    it("restores the previous token and provider settings when saving fails", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        const settingsChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        const saveData = jest.fn<() => Promise<void>>()
            .mockRejectedValueOnce(new Error("save failed"))
            .mockResolvedValue(undefined);
        plugin.saveData = saveData as never;

        const result = await completeSetup(plugin, { presetKey: "openai", token: "sk-new" });

        expect(result).toEqual({ ok: false, code: "settings_save_failed" });
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://old.example/v1",
            chatModelName: "old-chat",
            embeddingModelName: "old-embed",
        });
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(1, expect.any(String), "sk-new");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(2, expect.any(String), "sk-old");
        expect(settingsChanged).not.toHaveBeenCalled();
    });

    it("serializes setup mutation and compensation so an older failure cannot overwrite a newer success", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseFirstSave!: () => void;
        let markFirstSaveStarted!: () => void;
        const firstSaveStarted = new Promise<void>((resolve) => { markFirstSaveStarted = resolve; });
        const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markFirstSaveStarted();
                await firstSaveGate;
                throw new Error("first save failed");
            }
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;

        const first = completeSetup(plugin, { presetKey: "openai", token: "sk-first" });
        await firstSaveStarted;
        const second = completeSetup(plugin, { presetKey: "qwen", token: "sk-second" });
        await Promise.resolve();
        await Promise.resolve();

        expect(secretStorage.setSecret).toHaveBeenCalledTimes(1);
        expect(plugin.settings.aiProvider).toBe("qwen");

        releaseFirstSave();
        await expect(first).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await expect(second).resolves.toEqual({ ok: true });

        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(1, expect.any(String), "sk-first");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(2, expect.any(String), "sk-old");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(3, expect.any(String), "sk-second");
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-second");
    });

    it("waits for an ordinary settings save before staging a provider update that later fails", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
                debug: false,
            },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseOrdinarySave!: () => void;
        let markOrdinarySaveStarted!: () => void;
        const ordinarySaveStarted = new Promise<void>((resolve) => { markOrdinarySaveStarted = resolve; });
        const ordinarySaveGate = new Promise<void>((resolve) => { releaseOrdinarySave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            const snapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
            if (saveAttempt === 1) {
                markOrdinarySaveStarted();
                await ordinarySaveGate;
                harness.writePersisted(snapshot);
                return;
            }
            if (saveAttempt === 2) {
                throw new Error("provider save failed");
            }
            harness.writePersisted(snapshot);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => { observedProviders.push(plugin.settings.aiProvider); });
        plugin.settings.debug = true;

        const ordinarySave = plugin.saveSettings();
        await ordinarySaveStarted;
        const host = (plugin as unknown as { createChatHost(): { settings: {
            aiProvider: string;
            baseURL: string;
        } } }).createChatHost();
        const epoch = plugin.beginAIProviderConfigurationMutation();
        const providerUpdate = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://staged.example/v1",
            chatModelName: "staged-chat",
            embeddingModelName: "staged-embed",
        }, epoch);
        await Promise.resolve();
        await Promise.resolve();

        expect(saveAttempt).toBe(1);
        expect(host.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });
        expect(plugin.settings.aiProvider).toBe("qwen");
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });

        releaseOrdinarySave();
        await ordinarySave;
        await expect(providerUpdate).resolves.toEqual({ ok: false, code: "settings_save_failed" });

        expect(saveAttempt).toBe(3);
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
            debug: true,
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
            debug: true,
        });
        expect(observedProviders).toEqual(["qwen"]);
    });

    it("keeps Chat and Memory consumers on the stable tuple while a provider save is pending", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
                debug: false,
            },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderSave!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerSaveGate = new Promise<void>((resolve) => { releaseProviderSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            const snapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
            if (saveAttempt === 1) {
                markProviderSaveStarted();
                await providerSaveGate;
                throw new Error("provider save failed");
            }
            harness.writePersisted(snapshot);
        }) as never;
        const observations: Array<{ provider: string; baseURL: string }> = [];
        plugin.onSettingsChanged(() => {
            observations.push({
                provider: plugin.settings.aiProvider,
                baseURL: plugin.settings.baseURL,
            });
        });

        const epoch = plugin.beginAIProviderConfigurationMutation();
        const providerUpdate = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://staged.example/v1",
            chatModelName: "staged-chat",
            embeddingModelName: "staged-embed",
        }, epoch);
        await providerSaveStarted;
        const chatHost = (plugin as unknown as { createChatHost(): { settings: {
            aiProvider: string;
            baseURL: string;
        } } }).createChatHost();
        const memoryHost = (plugin as unknown as { createMemoryHost(): { settings: {
            aiProvider: string;
            baseURL: string;
        } } }).createMemoryHost();

        expect(chatHost.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });
        expect(memoryHost.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });

        plugin.settings.debug = true;
        const ordinarySave = plugin.saveSettings();
        await Promise.resolve();
        await Promise.resolve();
        expect(saveAttempt).toBe(1);
        expect(observations).toEqual([]);

        releaseProviderSave();
        await expect(providerUpdate).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await ordinarySave;

        expect(saveAttempt).toBe(3);
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
            debug: true,
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
            debug: true,
        });
        expect(observations).toEqual([{
            provider: "qwen",
            baseURL: "https://old.example/v1",
        }]);
    });

    it("blocks consumers until a pending Settings provider and standalone token edit commit together", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        expect(await plugin.getAPIToken()).toBe("sk-old");
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderSave!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerSaveGate = new Promise<void>((resolve) => { releaseProviderSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markProviderSaveStarted();
            await providerSaveGate;
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observations: Array<{ provider: string; issue: string | null }> = [];
        plugin.onSettingsChanged(() => {
            observations.push({
                provider: plugin.settings.aiProvider,
                issue: plugin.getAIReadiness().issue,
            });
        });

        const epoch = plugin.beginAIProviderConfigurationMutation();
        const providerUpdate = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, epoch);
        await providerSaveStarted;
        plugin.setAPITokenSecret("sk-new");
        const tokenNotification = plugin.notifyAIReadinessChanged();
        const tokenReadsBeforeConsumers = secretStorage.getSecret.mock.calls.length;
        const providerRequests = jest.fn();
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const memoryUtils = new AIUtils(plugin);
        const chatAttempt = plugin.createChatModel(0.2)
            .then((model) => providerRequests("chat", model));
        const memoryAttempt = memoryUtils.createEmbeddings()
            .then((model) => providerRequests("memory", model));

        await expect(chatAttempt).rejects.toThrow("AI provider configuration is being updated");
        await expect(memoryAttempt).rejects.toThrow("AI provider configuration is being updated");
        expect(secretStorage.getSecret).toHaveBeenCalledTimes(tokenReadsBeforeConsumers);
        expect(providerRequests).not.toHaveBeenCalled();
        expect(plugin.getAIReadiness()).toMatchObject({ ready: false, issue: "token_unknown" });
        expect(observations).toEqual([]);

        releaseProviderSave();
        await expect(providerUpdate).resolves.toEqual({ ok: true });
        await tokenNotification;

        expect(plugin.settings).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.getAIReadiness()).toMatchObject({ ready: true, issue: null });
        await expect(plugin.getAPIToken()).resolves.toBe("sk-new");
        expect(observations.length).toBeGreaterThan(0);
        expect(observations.every(({ provider, issue }) => provider === "openai" && issue === null)).toBe(true);
    });

    it("fails provider-missing when a pending Settings provider save fails after a token mutation", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderFailure!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerFailureGate = new Promise<void>((resolve) => { releaseProviderFailure = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markProviderSaveStarted();
                await providerFailureGate;
                throw new Error("provider save failed");
            }
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedIssues: Array<string | null> = [];
        plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

        const epoch = plugin.beginAIProviderConfigurationMutation();
        const providerUpdate = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, epoch);
        await providerSaveStarted;
        plugin.setAPITokenSecret("sk-new");
        const tokenNotification = plugin.notifyAIReadinessChanged();
        expect(plugin.getAIReadiness().issue).toBe("token_unknown");

        releaseProviderFailure();
        await expect(providerUpdate).resolves.toEqual({ ok: false, code: "compensation_failed" });
        await tokenNotification;

        expect(plugin.settings.aiProvider).toBe("");
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.getAIReadiness().issue).toBe("provider_missing");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(observedIssues.length).toBeGreaterThan(0);
        expect(observedIssues.every((issue) => issue === "provider_missing")).toBe(true);

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token-default-vault": "sk-new" },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
    });

    it("keeps the credential gate closed until the last queued provider transaction settles", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseFirstSave!: () => void;
        let markFirstSaveStarted!: () => void;
        let releaseSecondSave!: () => void;
        let markSecondSaveStarted!: () => void;
        const firstSaveStarted = new Promise<void>((resolve) => { markFirstSaveStarted = resolve; });
        const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
        const secondSaveStarted = new Promise<void>((resolve) => { markSecondSaveStarted = resolve; });
        const secondSaveGate = new Promise<void>((resolve) => { releaseSecondSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markFirstSaveStarted();
                await firstSaveGate;
            } else if (saveAttempt === 2) {
                markSecondSaveStarted();
                await secondSaveGate;
            }
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => { observedProviders.push(plugin.settings.aiProviderPreset ?? ""); });

        const firstEpoch = plugin.beginAIProviderConfigurationMutation();
        const first = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, firstEpoch);
        await firstSaveStarted;
        const secondEpoch = plugin.beginAIProviderConfigurationMutation();
        const second = plugin.updateAIProviderConfiguration({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen3.6-plus",
            embeddingModelName: "text-embedding-v4",
        }, secondEpoch);

        releaseFirstSave();
        await expect(first).resolves.toEqual({ ok: true });
        await secondSaveStarted;

        expect(plugin.settings.aiProviderPreset).toBe("openai");
        expect(plugin.getAIReadiness()).toMatchObject({ ready: false, issue: "token_unknown" });
        await expect(plugin.getAPIToken()).rejects.toThrow("AI provider configuration is being updated");
        expect(observedProviders).toEqual([]);

        releaseSecondSave();
        await expect(second).resolves.toEqual({ ok: true });

        expect(plugin.settings.aiProviderPreset).toBe("qwen-intl");
        expect(plugin.getAIReadiness()).toMatchObject({ ready: true, issue: null });
        expect(observedProviders).toEqual(["qwen-intl"]);
    });

    it("rejects a queued Chat setup submitted before a later successful Settings provider and token change", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseFirstChatSave!: () => void;
        let markFirstChatSaveStarted!: () => void;
        const firstChatSaveStarted = new Promise<void>((resolve) => { markFirstChatSaveStarted = resolve; });
        const firstChatSaveGate = new Promise<void>((resolve) => { releaseFirstChatSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            const snapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
            if (saveAttempt === 1) {
                markFirstChatSaveStarted();
                await firstChatSaveGate;
            }
            harness.writePersisted(snapshot);
        }) as never;

        const firstChat = completeSetup(plugin, { presetKey: "openai", token: "sk-chat-a" });
        await firstChatSaveStarted;
        const queuedChat = completeSetup(plugin, { presetKey: "qwen", token: "sk-chat-b" });

        plugin.setAPITokenSecret("sk-settings");
        const settingsEpoch = plugin.beginAIProviderConfigurationMutation();
        const settingsSave = plugin.updateAIProviderConfiguration({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen3.6-plus",
            embeddingModelName: "text-embedding-v4",
        }, settingsEpoch);
        releaseFirstChatSave();

        await expect(firstChat).resolves.toEqual({ ok: true });
        await expect(queuedChat).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await expect(settingsSave).resolves.toEqual({ ok: true });
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-settings");
        expect(secretStorage.setSecret).toHaveBeenCalledTimes(2);
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(1, expect.any(String), "sk-chat-a");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(2, expect.any(String), "sk-settings");
    });

    it("rejects Chat submitted after a text provider draft but before its debounced flush", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;

        const draftEpoch = plugin.beginAIProviderConfigurationMutation();
        const chatSetup = completeSetup(plugin, { presetKey: "openai", token: "sk-chat" });

        await expect(chatSetup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        expect(secretStorage.setSecret).not.toHaveBeenCalled();

        await expect(plugin.updateAIProviderConfiguration({
            aiProviderPreset: "custom",
            baseURL: "https://draft.example/v1",
        }, draftEpoch)).resolves.toEqual({ ok: true });
        expect(plugin.settings.baseURL).toBe("https://draft.example/v1");
        expect(harness.readPersisted()?.baseURL).toBe("https://draft.example/v1");
    });

    it("fails closed when Chat token compensation precedes a queued Settings save failure", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        const settingsChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        let releaseChatSave!: () => void;
        let markChatSaveStarted!: () => void;
        const chatSaveStarted = new Promise<void>((resolve) => { markChatSaveStarted = resolve; });
        const chatSaveGate = new Promise<void>((resolve) => { releaseChatSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            const snapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
            if (saveAttempt === 1) {
                markChatSaveStarted();
                await chatSaveGate;
                throw new Error("chat save failed");
            }
            if (saveAttempt === 3) {
                throw new Error("settings save failed");
            }
            harness.writePersisted(snapshot);
        }) as never;

        const chatSetup = completeSetup(plugin, { presetKey: "openai", token: "sk-chat" });
        await chatSaveStarted;
        const settingsEpoch = plugin.beginAIProviderConfigurationMutation();
        const settingsSave = plugin.updateAIProviderConfiguration({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen3.6-plus",
            embeddingModelName: "text-embedding-v4",
        }, settingsEpoch);
        releaseChatSave();

        await expect(chatSetup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await expect(settingsSave).resolves.toEqual({ ok: false, code: "compensation_failed" });
        expect(saveAttempt).toBe(4);
        expect(plugin.settings.aiProvider).toBe("");
        expect(plugin.settings.aiProviderPreset).toBeUndefined();
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-old");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(settingsChanged).toHaveBeenCalledTimes(1);

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": plugin.getConfiguredAPITokenSecret() },
        });
        await reloaded.plugin.loadSettings();
        expect(reloaded.plugin.settings.aiProvider).toBe("");
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
        expect(reloaded.plugin.getConfiguredAPITokenSecret()).toBe("sk-old");
    });

    it("persists an incomplete provider when Settings rollback persistence also fails", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        plugin.saveData = jest.fn<(next: unknown) => Promise<void>>()
            .mockRejectedValueOnce(new Error("settings save failed"))
            .mockRejectedValueOnce(new Error("rollback save failed"))
            .mockImplementationOnce(async (next: unknown) => {
                harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
            }) as never;

        const settingsEpoch = plugin.beginAIProviderConfigurationMutation();
        await expect(plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, settingsEpoch)).resolves.toEqual({ ok: false, code: "compensation_failed" });

        expect(plugin.settings.aiProvider).toBe("");
        expect(plugin.settings.aiProviderPreset).toBeUndefined();
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(plugin.getAIReadiness().issue).toBe("provider_missing");

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        await reloaded.plugin.loadSettings();
        expect(reloaded.plugin.settings.aiProvider).toBe("");
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
    });

    it("restores the old provider but preserves a standalone token saved while Chat persistence is pending", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseChatSave!: () => void;
        let markChatSaveStarted!: () => void;
        const chatSaveStarted = new Promise<void>((resolve) => { markChatSaveStarted = resolve; });
        const chatSaveGate = new Promise<void>((resolve) => { releaseChatSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markChatSaveStarted();
                await chatSaveGate;
                throw new Error("chat save failed");
            }
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => {
            observedProviders.push(plugin.settings.aiProvider);
        });

        const chatSetup = completeSetup(plugin, { presetKey: "openai", token: "sk-chat" });
        await chatSaveStarted;
        plugin.setAPITokenSecret("sk-settings");
        const readinessNotification = plugin.notifyAIReadinessChanged();
        await Promise.resolve();
        expect(observedProviders).toEqual([]);
        releaseChatSave();

        await expect(chatSetup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await readinessNotification;
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://old.example/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-settings");
        expect(secretStorage.setSecret).toHaveBeenCalledTimes(2);
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(1, expect.any(String), "sk-chat");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(2, expect.any(String), "sk-settings");
        expect(observedProviders).toEqual(["qwen"]);
    });

    it("runs a Settings provider choice after the older Chat failure is fully compensated", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseChatSave!: () => void;
        let markChatSaveStarted!: () => void;
        const chatSaveStarted = new Promise<void>((resolve) => { markChatSaveStarted = resolve; });
        const chatSaveGate = new Promise<void>((resolve) => { releaseChatSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markChatSaveStarted();
                await chatSaveGate;
                throw new Error("chat save failed");
            }
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;

        const chatSetup = completeSetup(plugin, { presetKey: "openai", token: "sk-chat" });
        await chatSaveStarted;
        const settingsEpoch = plugin.beginAIProviderConfigurationMutation();
        const settingsSave = plugin.updateAIProviderConfiguration({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen3.6-plus",
            embeddingModelName: "text-embedding-v4",
        }, settingsEpoch);
        releaseChatSave();

        await expect(chatSetup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await expect(settingsSave).resolves.toEqual({ ok: true });
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-old");
        expect(secretStorage.setSecret).toHaveBeenCalledTimes(2);
    });

    it("persists provider-missing and keeps the new token when token rollback fails", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        const defaultSetSecret = secretStorage.setSecret.getMockImplementation();
        expect(defaultSetSecret).toBeDefined();
        secretStorage.setSecret
            .mockImplementationOnce(defaultSetSecret!)
            .mockImplementationOnce(() => { throw new Error("restore failed"); });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) throw new Error("save failed");
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => { observedProviders.push(plugin.settings.aiProvider); });

        const result = await completeSetup(plugin, { presetKey: "openai", token: "sk-new" });

        expect(result).toEqual({ ok: false, code: "compensation_failed" });
        expect(plugin.getAPITokenCacheState()).toBe("unknown");
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.settings.aiProvider).toBe("");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(observedProviders).toEqual([""]);

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": "sk-new" },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
    });

    it("fails closed on reload when both an initial token write and its restore throw", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        const defaultSetSecret = secretStorage.setSecret.getMockImplementation();
        expect(defaultSetSecret).toBeDefined();
        secretStorage.setSecret
            .mockImplementationOnce((id: string, value: string) => {
                defaultSetSecret!(id, value);
                throw new Error("write surfaced a failure after persistence");
            })
            .mockImplementationOnce(() => { throw new Error("restore failed"); });
        plugin.saveData = jest.fn(async (next: unknown) => {
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => { observedProviders.push(plugin.settings.aiProvider); });

        await expect(completeSetup(plugin, {
            presetKey: "openai",
            token: "sk-new",
        })).resolves.toEqual({ ok: false, code: "compensation_failed" });

        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.settings.aiProvider).toBe("");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(observedProviders).toEqual([""]);

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": "sk-new" },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
    });

    it("does not start Memory preparation when the embedding model is missing", async () => {
        const { plugin } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "",
            },
        });
        await plugin.loadSettings();
        plugin.setAPITokenSecret("sk-test");
        const getMaintenancePlan = jest.fn(async () => ({
            reason: "first-use" as const,
            action: "rebuild" as const,
            notesToCheck: 1,
            requiresApproval: false,
            canAnswerNow: true,
        }));
        const prepareFromCommand = jest.fn(async () => undefined);
        const ensureReadyForChat = jest.fn(async (
            _query?: string,
            _signal?: AbortSignal,
            _preparationOwnerSignal?: AbortSignal,
        ) => ({ decision: "use-memory" as const }));
        (plugin as unknown as { memoryManager: unknown }).memoryManager = {
            getMaintenancePlan,
            prepareFromCommand,
            ensureReadyForChat,
        };
        const host = (plugin as unknown as { createChatHost(): { memoryStatus: {
            getMaintenancePlan(): Promise<{ reason: string }>;
            prepareFromCommand(): Promise<void>;
        } } }).createChatHost();

        await expect(host.memoryStatus.getMaintenancePlan()).resolves.toMatchObject({ reason: "unavailable" });
        await host.memoryStatus.prepareFromCommand();
        await expect((plugin as unknown as {
            ensureMemoryReadyForChat(query?: string): Promise<{ decision: string }>;
        }).ensureMemoryReadyForChat("question")).resolves.toEqual({ decision: "answer-now" });
        expect(getMaintenancePlan).not.toHaveBeenCalled();
        expect(prepareFromCommand).not.toHaveBeenCalled();
        expect(ensureReadyForChat).not.toHaveBeenCalled();
    });

    it("resolves a retained token for a direct Memory-search bridge after reload", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        const ensureReadyForChat = jest.fn(async (
            _query?: string,
            _signal?: AbortSignal,
            _preparationOwnerSignal?: AbortSignal,
        ) => ({ decision: "use-memory" as const }));
        (plugin as unknown as { memoryManager: unknown }).memoryManager = { ensureReadyForChat };

        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        await expect((plugin as unknown as {
            ensureMemoryReadyForChat(query?: string): Promise<{ decision: string }>;
        }).ensureMemoryReadyForChat("question")).resolves.toEqual({ decision: "use-memory" });

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("present");
        expect(ensureReadyForChat).toHaveBeenCalledWith("question", undefined, undefined);
    });

    it("keeps the direct Memory-search bridge closed during a credential transition", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        const ensureReadyForChat = jest.fn(async () => ({ decision: "use-memory" as const }));
        (plugin as unknown as { memoryManager: unknown }).memoryManager = { ensureReadyForChat };
        (plugin as unknown as { aiProviderCredentialTransitionCount: number })
            .aiProviderCredentialTransitionCount = 1;

        await expect((plugin as unknown as {
            ensureMemoryReadyForChat(query?: string): Promise<{ decision: string }>;
        }).ensureMemoryReadyForChat("question")).resolves.toEqual({ decision: "answer-now" });

        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("unknown");
        expect(ensureReadyForChat).not.toHaveBeenCalled();
    });

    it("persists Memory admission compensation during unload and reloads the prior policy", async () => {
        const harness = createPluginHarness({
            initialData: { memoryApprovalPolicy: "always" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        (plugin as unknown as { settingsMigrationBaselineFingerprint: null }).settingsMigrationBaselineFingerprint = null;
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            harness.writePersisted(next as Record<string, unknown>);
            saveAttempt++;
            if (saveAttempt === 1) throw new Error("write completed before failure surfaced");
        }) as never;
        const host = (plugin as unknown as { createMemoryHost(): {
            updateMemorySetting(key: "memoryApprovalPolicy", value: string): void;
            persistMemoryAdmissionSettings(): Promise<void>;
        } }).createMemoryHost();

        host.updateMemorySetting("memoryApprovalPolicy", "auto-refresh-after-prepare");
        await expect(host.persistMemoryAdmissionSettings()).rejects.toThrow("write completed before failure surfaced");
        expect(harness.readPersisted()?.memoryApprovalPolicy).toBe("auto-refresh-after-prepare");

        (plugin as unknown as { unloading: boolean }).unloading = true;
        host.updateMemorySetting("memoryApprovalPolicy", "always");
        await expect(host.persistMemoryAdmissionSettings()).resolves.toBeUndefined();
        expect(harness.readPersisted()?.memoryApprovalPolicy).toBe("always");

        const reloaded = createPluginHarness({ initialData: harness.readPersisted() });
        await reloaded.plugin.loadSettings();
        expect(reloaded.plugin.settings.memoryApprovalPolicy).toBe("always");
    });

    it("drains cancelled Memory work before disposing VSS during unload", async () => {
        const { plugin } = createPluginHarness();
        const order: string[] = [];
        let releaseIdle!: () => void;
        const idle = new Promise<void>((resolve) => { releaseIdle = resolve; });
        const stopAutoMaintenance = jest.fn(() => { order.push("stop"); });
        const waitForIdle = jest.fn(async () => {
            order.push("drain-start");
            await idle;
            order.push("drain-finished");
        });
        const dispose = jest.fn(async () => { order.push("dispose"); });
        const internals = plugin as unknown as Record<string, unknown>;
        internals.memoryManager = { stopAutoMaintenance, waitForIdle };
        internals.vss = { dispose };
        internals.phase3Handle = null;
        internals.resizeDebounceTimer = null;
        internals.hoverPopoverObserver = null;
        internals.debouncedStatusBarUpdate = { cancel: jest.fn() };
        internals.resetDeepDiscoverController = jest.fn();
        internals.cancelMemoryForgetRetry = jest.fn();
        internals.cancelMemoryProfileProjectionRetry = jest.fn();
        internals.cancelMemoryGovernanceGarbageCollection = jest.fn();

        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(["stop", "drain-start"]);
        expect(dispose).not.toHaveBeenCalled();
        releaseIdle();
        await unloading;

        expect(order).toEqual(["stop", "drain-start", "drain-finished", "dispose"]);
    });

    it("drains a Settings provider update accepted immediately before unload", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseSave!: () => void;
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markSaveStarted();
            await saveGate;
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const dispose = prepareForUnload(plugin);

        const epoch = plugin.beginAIProviderConfigurationMutation();
        const update = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, epoch);
        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();

        await saveStarted;
        expect(dispose).not.toHaveBeenCalled();
        releaseSave();
        await expect(update).resolves.toEqual({ ok: true });
        await unloading;

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
        });
    });

    it("drains Chat setup submitted immediately before unload even if it has not started", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseSave!: () => void;
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markSaveStarted();
            await saveGate;
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const dispose = prepareForUnload(plugin);

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();

        await saveStarted;
        expect(dispose).not.toHaveBeenCalled();
        releaseSave();
        await expect(setup).resolves.toEqual({ ok: true });
        await unloading;

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
        });
    });

    it("drains a queued inline setup save before unload and reloads a consistent provider token", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseSave!: () => void;
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markSaveStarted();
            await saveGate;
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;
        const internals = plugin as unknown as Record<string, unknown>;
        internals.memoryManager = {
            cancelActivePreparation: jest.fn(),
            stopAutoMaintenance: jest.fn(),
            waitForIdle: jest.fn(async () => undefined),
        };
        const dispose = jest.fn(async () => undefined);
        internals.vss = { dispose };
        internals.phase3Handle = null;
        internals.resizeDebounceTimer = null;
        internals.hoverPopoverObserver = null;
        internals.debouncedStatusBarUpdate = { cancel: jest.fn() };
        internals.resetDeepDiscoverController = jest.fn();
        internals.cancelMemoryForgetRetry = jest.fn();
        internals.cancelMemoryProfileProjectionRetry = jest.fn();
        internals.cancelMemoryGovernanceGarbageCollection = jest.fn();

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        await saveStarted;
        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();
        await Promise.resolve();
        expect(dispose).not.toHaveBeenCalled();

        releaseSave();
        await expect(setup).resolves.toEqual({ ok: true });
        await unloading;
        expect(dispose).toHaveBeenCalledTimes(1);

        const persisted = harness.readPersisted();
        expect(persisted).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
        });
        const persistedToken = secretStorage.getSecret("pa-api-token") as string;
        const reloaded = createPluginHarness({
            initialData: persisted,
            secretStorageValues: { "pa-api-token": persistedToken },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.settings.aiProvider).toBe("openai");
        expect(reloaded.plugin.getAPITokenCacheState()).toBe("present");
    });

    it("waits for inline setup compensation after a persisted save rejects during unload", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let markFirstPersisted!: () => void;
        let releaseFirstFailure!: () => void;
        let markCompensationStarted!: () => void;
        let releaseCompensation!: () => void;
        const firstPersisted = new Promise<void>((resolve) => { markFirstPersisted = resolve; });
        const firstFailureGate = new Promise<void>((resolve) => { releaseFirstFailure = resolve; });
        const compensationStarted = new Promise<void>((resolve) => { markCompensationStarted = resolve; });
        const compensationGate = new Promise<void>((resolve) => { releaseCompensation = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                harness.writePersisted(next as Record<string, unknown>);
                markFirstPersisted();
                await firstFailureGate;
                throw new Error("save rejected after persistence");
            }
            markCompensationStarted();
            await compensationGate;
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;
        const internals = plugin as unknown as Record<string, unknown>;
        internals.memoryManager = {
            cancelActivePreparation: jest.fn(),
            stopAutoMaintenance: jest.fn(),
            waitForIdle: jest.fn(async () => undefined),
        };
        const dispose = jest.fn(async () => undefined);
        internals.vss = { dispose };
        internals.phase3Handle = null;
        internals.resizeDebounceTimer = null;
        internals.hoverPopoverObserver = null;
        internals.debouncedStatusBarUpdate = { cancel: jest.fn() };
        internals.resetDeepDiscoverController = jest.fn();
        internals.cancelMemoryForgetRetry = jest.fn();
        internals.cancelMemoryProfileProjectionRetry = jest.fn();
        internals.cancelMemoryGovernanceGarbageCollection = jest.fn();

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        await firstPersisted;
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "openai" });
        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();
        releaseFirstFailure();
        await compensationStarted;

        expect(dispose).not.toHaveBeenCalled();
        expect(secretStorage.getSecret("pa-api-token")).toBe("sk-old");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "openai" });

        releaseCompensation();
        await expect(setup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await unloading;
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
        });

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.settings.aiProvider).toBe("qwen");
        expect(reloaded.plugin.getAPITokenCacheState()).toBe("present");
    });

    it("rejects inline setup started after unload without writing the token", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: { aiProvider: "" },
        });
        await plugin.loadSettings();
        (plugin as unknown as { unloading: boolean }).unloading = true;

        await expect(completeSetup(plugin, {
            presetKey: "openai",
            token: "sk-should-not-write",
        })).resolves.toEqual({ ok: false, code: "settings_save_failed" });

        expect(secretStorage.setSecret).not.toHaveBeenCalled();
    });
});

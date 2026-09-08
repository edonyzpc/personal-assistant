/* Copyright 2023 edonyzpc */

/**
 * Track B · B3 unit tests for the Pagelet settings module.
 *
 * Coverage matrix (mapped to SDD §10.3 + decisions D008-D010, D013, D015,
 * D018, D020):
 *  - `mergePageletSettings`: per-field normalization. The function MUST be
 *    tolerant of every shape data.json can have on a legacy / corrupt install
 *    (undefined / missing key / wrong type / out-of-range number / invalid
 *    enum string). Fields are independent — one bad value cannot
 *    poison the others.
 *  - B-106 renderers: ordinary preferences and note privacy stay separate,
 *    technical fields remain internal, conditional children preserve edits,
 *    and save/retry/close follow the existing persistence boundary.
 *  - Read-only call limits: D020 froze them; the constant exists for B4's
 *    UI to display but must not become persisted state.
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    PAGELET_BOUNDS,
    PAGELET_DEFAULTS,
    PAGELET_FIXED_CALL_LIMITS,
    PAGELET_PRELOAD_TOKEN_BOUNDS,
    mergePageletSettings,
    normalizeReviewsFolder,
    renderPageletSection,
    renderPageletPreferences,
    renderPageletNotePrivacy,
    type PageletReviewsFolderError,
    type PageletSettings,
    type PageletSettingBuilder,
    type PageletSettingFactory,
    type PageletSettingsHost,
} from "../src/settings/pagelet";
import { makePageletTranslator } from "../src/locales/pagelet";
import { createSourceScopeSettingState } from "../src/settings/source-scope-setting";

// ---------------------------------------------------------------------------
// Tiny stub DOM + Setting harness. We intentionally do NOT pull in the
// settings.test.ts `MockDomNode`/`MockContainerEl` — the Pagelet tests should
// stand on their own so a refactor of either file doesn't ripple.
// ---------------------------------------------------------------------------

interface StubNode {
    tagName: string;
    text?: string;
    cls?: string;
    hidden?: boolean;
    disabled?: boolean;
    textContent?: string;
    children: StubNode[];
    createEl: (tag: string, options?: { text?: string; cls?: string }) => StubNode;
    addEventListener: (event: string, callback: () => void) => void;
    dispatch: (event: string) => void;
}

function makeStubNode(tagName: string): StubNode {
    const listeners = new Map<string, () => void>();
    const node: StubNode = {
        tagName,
        children: [],
        addEventListener(event, callback) { listeners.set(event, callback); },
        dispatch(event) { listeners.get(event)?.(); },
        createEl(tag: string, options?: { text?: string; cls?: string }): StubNode {
            const child = makeStubNode(tag);
            if (options?.text) child.text = options.text;
            if (options?.cls) child.cls = options.cls;
            this.children.push(child);
            return child;
        },
    };
    return node;
}

interface StubSetting {
    parent?: StubNode;
    name?: string;
    desc?: string;
    toggleValue?: boolean;
    toggleDisabled?: boolean;
    toggleOnChange?: (value: boolean) => unknown;
    textValue?: string;
    textPlaceholder?: string;
    textOnChange?: (value: string) => unknown;
    dropdownValue?: string;
    dropdownOptions: Array<{ value: string; text: string }>;
    dropdownOnChange?: (value: string) => unknown;
}

function makeStubFactory(options: { notifyToggleChanges?: boolean } = {}): { factory: PageletSettingFactory; rows: StubSetting[] } {
    const rows: StubSetting[] = [];
    const factory: PageletSettingFactory = {
        create(parent): PageletSettingBuilder {
            const row: StubSetting = { dropdownOptions: [], parent: parent as unknown as StubNode };
            rows.push(row);
            const builder: PageletSettingBuilder = {
                setName(name) {
                    row.name = name;
                    return builder;
                },
                setDesc(desc) {
                    row.desc = desc;
                    return builder;
                },
                addToggle(cb) {
                    cb({
                        setValue(value) {
                            const changed = row.toggleValue !== value;
                            row.toggleValue = value;
                            if (changed && options.notifyToggleChanges) row.toggleOnChange?.(value);
                            return this;
                        },
                        setDisabled(value) {
                            row.toggleDisabled = value;
                            return this;
                        },
                        onChange(handler) {
                            row.toggleOnChange = handler;
                            return this;
                        },
                    });
                    return builder;
                },
                addText(cb) {
                    cb({
                        setPlaceholder(value) {
                            row.textPlaceholder = value;
                            return this;
                        },
                        setValue(value) {
                            row.textValue = value;
                            return this;
                        },
                        onChange(handler) {
                            row.textOnChange = handler;
                            return this;
                        },
                    });
                    return builder;
                },
                addDropdown(cb) {
                    cb({
                        addOption(value, text) {
                            row.dropdownOptions.push({ value, text });
                            return this;
                        },
                        setValue(value) {
                            row.dropdownValue = value;
                            return this;
                        },
                        onChange(handler) {
                            row.dropdownOnChange = handler;
                            return this;
                        },
                    });
                    return builder;
                },
            };
            return builder;
        },
    };
    return { factory, rows };
}

function makeHost(
    overrides?: Partial<PageletSettings>,
    quietRecallMode: "off" | "on" = "off",
): {
    host: PageletSettingsHost;
    save: jest.Mock<() => Promise<void>>;
} {
    const save = jest.fn(async () => { /* noop */ });
    const settings: PageletSettings = { ...PAGELET_DEFAULTS, ...overrides };
    const host: PageletSettingsHost = {
        // Cast: tests don't need a real Obsidian App and we don't want to
        // depend on Obsidian here.
        app: {} as unknown as PageletSettingsHost["app"],
        settings: {
            pagelet: settings,
            quietRecall: { quietRecallMode },
        },
        saveSettings: save,
        saveSettingsPermissions: async (patch) => {
            await save();
            Object.assign(settings, patch.pagelet);
        },
        setBackgroundDiscoveryEnabled: async (enabled) => {
            await save();
            settings.backgroundDiscoveryEnabled = enabled;
        },
    };
    return { host, save };
}

function makeSourceStates() {
    return {
        excludedFolders: createSourceScopeSettingState(),
        excludedTags: createSourceScopeSettingState(),
        excludedPatterns: createSourceScopeSettingState(),
    };
}

function mountSourceFields(host: PageletSettingsHost, states = makeSourceStates(), isCurrent = () => true) {
    const parent = Object.assign(makeStubNode("div"), { isConnected: true });
    const { factory, rows } = makeStubFactory();
    renderPageletNotePrivacy({
        saveLocation: makeStubNode("div") as unknown as HTMLElement,
        sourceExclusions: parent as unknown as HTMLElement,
    }, host, factory, "en", { sourceScopeStates: states, isCurrent });
    const keys = ["excludedFolders", "excludedTags", "excludedPatterns"] as const;
    const groups = parent.children.filter((node) => node.cls === "pa-settings-source-scope-actions");
    const t = makePageletTranslator("en");
    return {
        parent,
        states,
        field(key: typeof keys[number]) {
            const group = groups[keys.indexOf(key)];
            const row = rows.find((entry) => entry.name === t(`pagelet.settings.${key}.name`))!;
            return {
                row,
                button: group.children.find((node) => node.tagName === "button")!,
                status: group.children.find((node) => node.tagName === "span")!,
                edit(value: string) { row.textValue = value; row.textOnChange!(value); },
            };
        },
    };
}

async function settleSourceSave(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe("Pagelet source exclusion saves", () => {
    it.each(["excludedFolders", "excludedTags", "excludedPatterns"] as const)(
        "%s stays committed during typing and failed saving, then retries only that field",
        async (key) => {
            const { host, save } = makeHost({
                excludedFolders: ["private", "drafts"], excludedTags: ["#private", "#drafts"],
                excludedPatterns: ["private", "draft"],
            });
            const before = structuredClone(host.settings.pagelet);
            const persist = jest.spyOn(host, "saveSettingsPermissions");
            const mounted = mountSourceFields(host);
            const field = mounted.field(key);
            expect(field.button.disabled).toBe(true);
            field.edit("p");
            field.edit("private");
            expect(host.settings.pagelet).toEqual(before);
            expect(save).not.toHaveBeenCalled();

            let reject!: (error: Error) => void;
            save.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
            field.button.dispatch("click");
            field.button.dispatch("click");
            expect(persist).toHaveBeenCalledTimes(1);
            expect(persist).toHaveBeenCalledWith({ pagelet: { [key]: ["private"] } });
            expect(field.button.disabled).toBe(true);
            expect(host.settings.pagelet).toEqual(before);
            reject(new Error("disk unavailable"));
            await settleSourceSave();
            expect(host.settings.pagelet).toEqual(before);
            expect(field.row.textValue).toBe("private");
            expect(field.status.textContent).toContain("not been saved");
            expect(field.button.disabled).toBe(false);

            field.button.dispatch("click");
            await settleSourceSave();
            expect(persist).toHaveBeenCalledTimes(2);
            expect(host.settings.pagelet).toEqual({ ...before, [key]: ["private"] });
            expect(field.status.textContent).toBe("");
            expect(field.button.disabled).toBe(true);
        },
    );

    it.each([false, true])("retains a reopened field's newer draft when an older save settles, failed=%s", async (failed) => {
        const { host, save } = makeHost({ excludedFolders: ["private"] });
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        save.mockImplementationOnce(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
        const states = makeSourceStates();
        let firstVisible = true;
        const first = mountSourceFields(host, states, () => firstVisible);
        const oldField = first.field("excludedFolders");
        oldField.edit("first");
        oldField.button.dispatch("click");
        firstVisible = false;
        const second = mountSourceFields(host, states);
        const newField = second.field("excludedFolders");
        expect(newField.row.textValue).toBe("first");
        expect(newField.button.disabled).toBe(true);
        newField.edit("second, unfinished");
        oldField.edit("ignored old render");
        oldField.button.dispatch("click");
        expect(states.excludedFolders.draft).toBe("second, unfinished");
        expect(save).toHaveBeenCalledTimes(1);

        if (failed) reject(new Error("first save failed"));
        else resolve();
        await settleSourceSave();
        expect(host.settings.pagelet.excludedFolders).toEqual(failed ? ["private"] : ["first"]);
        expect(newField.row.textValue).toBe("second, unfinished");
        expect(newField.button.disabled).toBe(false);
        expect(oldField.status.textContent).toContain("Saving");
        expect(oldField.button.disabled).toBe(true);

        newField.button.dispatch("click");
        await settleSourceSave();
        expect(host.settings.pagelet.excludedFolders).toEqual(["second", "unfinished"]);
        expect(newField.status.textContent).toBe("");
        expect(newField.button.disabled).toBe(true);
    });

    it.each([false, true])("does not write closed DOM when saving settles, failed=%s", async (failed) => {
        const { host, save } = makeHost({ excludedFolders: ["private"] });
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        save.mockImplementationOnce(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
        let visible = true;
        const mounted = mountSourceFields(host, makeSourceStates(), () => visible);
        const field = mounted.field("excludedFolders");
        field.edit("");
        field.button.dispatch("click");
        const statusBeforeClose = field.status.textContent;
        visible = false;
        if (failed) reject(new Error("closed save failed"));
        else resolve();
        await settleSourceSave();

        expect(field.status.textContent).toBe(statusBeforeClose);
        expect(field.button.disabled).toBe(true);
        const reopened = mountSourceFields(host, mounted.states).field("excludedFolders");
        expect(reopened.row.textValue).toBe("");
        expect(reopened.button.disabled).toBe(!failed);
        expect(reopened.status.textContent).toBe(failed
            ? "Scope changes have not been saved. The previous scope is still active." : "");
    });
});

// ---------------------------------------------------------------------------
// Defaults / bounds / fixed limits
// ---------------------------------------------------------------------------

describe("PAGELET_DEFAULTS", () => {
    it("matches the SDD §10.3 + decisions D008-D020 spec values", () => {
        // Each line maps to a specific decision; if a default changes,
        // update both the decision doc and this assertion.
        expect(PAGELET_DEFAULTS.enabled).toBe(true);            // D013 beta on
        expect(PAGELET_DEFAULTS.reviewsFolder).toBe(".pagelet"); // D010 dotfolder
        expect(PAGELET_DEFAULTS.outputLanguage).toBe("auto");    // D015 default
        expect(PAGELET_DEFAULTS.ribbonPosition).toBe("default"); // R4 default
        expect(PAGELET_DEFAULTS.temperature).toBe(0.2);          // SDD §2.2
        expect(PAGELET_DEFAULTS.maxInputTokens).toBe(8000);      // D018
        expect(PAGELET_DEFAULTS.maxOutputTokens).toBe(2000);     // D018
        expect(PAGELET_DEFAULTS.backgroundDiscoveryEnabled).toBe(true);
        expect(PAGELET_DEFAULTS).not.toHaveProperty("preloadEnabled");
        expect(PAGELET_DEFAULTS).not.toHaveProperty("deepDiscoverEnabled");
        expect(PAGELET_DEFAULTS.pageletProviderFirstUseNotified).toBe(false);
        expect(PAGELET_DEFAULTS.scopeRecapPreparationEnabled).toBe(true);
        expect(PAGELET_DEFAULTS.scopeRecapBackgroundAuthorization).toBe("pending");
        expect(PAGELET_DEFAULTS.scopeRecapHighValueHints).toBe(true);
        expect(PAGELET_DEFAULTS.scopeRecapLastAttempt).toBeNull();
        expect(PAGELET_DEFAULTS.quietRecallLastDiagnostics).toBeNull();
        expect(PAGELET_DEFAULTS.quietRecallLastAcceptedCount).toBe(0);
    });

    it("is frozen to prevent at-runtime mutation", () => {
        expect(Object.isFrozen(PAGELET_DEFAULTS)).toBe(true);
    });
});

describe("PAGELET_BOUNDS", () => {
    it("matches the D018 hard caps", () => {
        expect(PAGELET_BOUNDS.temperature).toEqual({ min: 0, max: 0.5 });
        expect(PAGELET_BOUNDS.maxInputTokens).toEqual({ min: 1, max: 32000 });
        expect(PAGELET_BOUNDS.maxOutputTokens).toEqual({ min: 1, max: 4000 });
    });

    it("caps generic background preparation at the DEC-023 unattended envelope", () => {
        expect(PAGELET_BOUNDS.preloadPerHourCap).toEqual({ min: 1, max: 2 });
        expect(PAGELET_BOUNDS.preloadPerDayCap).toEqual({ min: 1, max: 20 });
        expect(PAGELET_PRELOAD_TOKEN_BOUNDS).toEqual({
            input: { min: 1000, max: 4000 },
            output: { min: 500, max: 1000 },
        });
    });
});

describe("PAGELET_FIXED_CALL_LIMITS", () => {
    it("exposes D020's fixed limits as a constant, not a persisted field", () => {
        expect(PAGELET_FIXED_CALL_LIMITS).toEqual({ hourly: 10, daily: 100 });
        expect(Object.isFrozen(PAGELET_FIXED_CALL_LIMITS)).toBe(true);
    });

    it("does NOT leak into PageletSettings (must stay read-only display)", () => {
        const merged = mergePageletSettings({});
        expect(merged).not.toHaveProperty("hourlyCallLimit");
        expect(merged).not.toHaveProperty("dailyCallLimit");
    });
});

// ---------------------------------------------------------------------------
// mergePageletSettings — per-field normalization
// ---------------------------------------------------------------------------

describe("mergePageletSettings", () => {
    it("returns defaults when input is undefined / null", () => {
        expect(mergePageletSettings(undefined)).toEqual(PAGELET_DEFAULTS);
        expect(mergePageletSettings(null)).toEqual(PAGELET_DEFAULTS);
    });

    it("returns defaults when input is not an object", () => {
        expect(mergePageletSettings("garbage")).toEqual(PAGELET_DEFAULTS);
        expect(mergePageletSettings(42)).toEqual(PAGELET_DEFAULTS);
        expect(mergePageletSettings([{ enabled: false }])).toEqual(PAGELET_DEFAULTS);
    });

    it("preserves well-formed values", () => {
        const persisted: PageletSettings = {
            enabled: false,
            petVisible: true,
            reviewsFolder: "reviews/pagelet",
            outputLanguage: "zh",
            ribbonPosition: "hidden",
            temperature: 0.4,
            maxInputTokens: 12000,
            maxOutputTokens: 3000,
            petCorner: "bottom-right",
            proactiveHints: false,
            proactiveHintsCooldown: 30,
            backgroundDiscoveryEnabled: true,
            scopeRecapPreparationEnabled: true,
            scopeRecapBackgroundAuthorization: "authorized-v1",
            scopeRecapAuthorizationContextId: "scope-recap-auth-test",
            scopeRecapHighValueHints: false,
            scopeRecapNudgeSuppressions: [],
            scopeRecapLastAttempt: {
                attemptedAt: "2026-07-18T08:30:00.000Z",
                outcome: "success",
                scope: { kind: "folder" },
                sourceSnapshotId: "scope-snapshot",
                dataBoundarySnapshotId: "boundary-snapshot",
                providerCallMade: true,
                includedSourceCount: 2,
                cost: {
                    inputTokens: 100,
                    outputTokens: 20,
                    estimatedCost: 0.001,
                    currency: "USD",
                    pricingKnown: true,
                },
            },
            quietRecallLastDiagnostics: {
                roundId: "round-1",
                startedAt: Date.parse("2026-07-18T08:31:00.000Z"),
                contextFingerprint: "context-fingerprint",
                candidateCount: 1,
                evaluatedCandidateCount: 1,
                providerCalls: 1,
                initialCalls: 1,
                languageRetryCalls: 0,
                cacheHits: 0,
                inFlightHits: 0,
                estimatedCost: 0.002,
                pricingKnown: true,
                attempts: [],
            },
            quietRecallLastAcceptedCount: 1,
            preloadInterval: 30,
            preloadPerHourCap: 2,
            preloadPerDayCap: 20,
            preloadTokenBudget: { input: 4000, output: 1000 },
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: [],
            proactiveHintsQuietHours: { enabled: false, start: "22:00", end: "08:00" },
            foregroundPerHourCap: 10,
            foregroundPerDayCap: 100,
            onboardingShown: false,
            maintenanceScanSuggested: true,
            quickCaptureExplained: true,
            quietRecallExplained: true,
            quietAcknowledged: true,
            pageletProviderFirstUseNotified: false,
        };
        expect(mergePageletSettings(persisted)).toEqual(persisted);
    });

    it("defaults new onboarding bridge flags to false for older settings", () => {
        const merged = mergePageletSettings({ onboardingShown: true });

        expect(merged.onboardingShown).toBe(true);
        expect(merged.maintenanceScanSuggested).toBe(false);
        expect(merged.quickCaptureExplained).toBe(false);
        expect(merged.quietRecallExplained).toBe(false);
    });

    it.each([
        [
            "malformed authorization tuple",
            {
                scopeRecapBackgroundAuthorization: "authorized-v0",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: 42,
            },
            {
                scopeRecapBackgroundAuthorization: "pending",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: null,
            },
        ],
        [
            "pending authorization with stale context",
            {
                scopeRecapBackgroundAuthorization: "pending",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: "stale-context",
            },
            {
                scopeRecapBackgroundAuthorization: "pending",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: null,
            },
        ],
        [
            "declined authorization with stale context",
            {
                scopeRecapBackgroundAuthorization: "declined-v1",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: "stale-context",
            },
            {
                scopeRecapBackgroundAuthorization: "declined-v1",
                scopeRecapPreparationEnabled: false,
                scopeRecapAuthorizationContextId: null,
            },
        ],
        [
            "authorized state without a usable context",
            {
                scopeRecapBackgroundAuthorization: "authorized-v1",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: "   ",
            },
            {
                scopeRecapBackgroundAuthorization: "pending",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: null,
            },
        ],
        [
            "authorized state with a normalized context",
            {
                scopeRecapBackgroundAuthorization: "authorized-v1",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: "  provider-model-policy-v1  ",
            },
            {
                scopeRecapBackgroundAuthorization: "authorized-v1",
                scopeRecapPreparationEnabled: true,
                scopeRecapAuthorizationContextId: "provider-model-policy-v1",
            },
        ],
    ])("normalizes the Recap authorization tuple: %s", (_label, input, expected) => {
        expect(mergePageletSettings(input)).toMatchObject(expected);
    });

    it.each([
        ["fresh install", {}, true],
        ["legacy pending metadata", { scopeRecapBackgroundAuthorization: "pending" }, true],
        [
            "legacy authorized metadata",
            {
                scopeRecapBackgroundAuthorization: "authorized-v1",
                scopeRecapAuthorizationContextId: "legacy-context",
            },
            true,
        ],
        [
            "explicit opt-out",
            {
                scopeRecapPreparationEnabled: false,
                scopeRecapBackgroundAuthorization: "authorized-v1",
                scopeRecapAuthorizationContextId: "legacy-context",
            },
            false,
        ],
        [
            "explicit opt-in without authorization metadata",
            { scopeRecapPreparationEnabled: true },
            true,
        ],
        [
            "legacy decline without capability field",
            { scopeRecapBackgroundAuthorization: "declined-v1" },
            false,
        ],
        [
            "legacy decline remains an opt-out until Settings clears it",
            {
                scopeRecapPreparationEnabled: true,
                scopeRecapBackgroundAuthorization: "declined-v1",
            },
            false,
        ],
    ])("reconciles the Scope Recap capability truth table: %s", (_label, input, expected) => {
        expect(mergePageletSettings(input).scopeRecapPreparationEnabled).toBe(expected);
    });

    it.each([undefined, null, "false", 0, {}, []])(
        "fails closed when the persisted capability field exists but is not boolean: %p",
        (malformed) => {
            expect(mergePageletSettings({
                scopeRecapPreparationEnabled: malformed,
                scopeRecapBackgroundAuthorization: "pending",
            }).scopeRecapPreparationEnabled).toBe(false);
        },
    );

    it("preserves explicit and migrated opt-outs across a serialized reload", () => {
        const explicitOptOut = mergePageletSettings({
            scopeRecapPreparationEnabled: false,
            scopeRecapBackgroundAuthorization: "authorized-v1",
            scopeRecapAuthorizationContextId: "legacy-context",
        });
        const migratedDecline = mergePageletSettings({
            scopeRecapBackgroundAuthorization: "declined-v1",
        });

        expect(mergePageletSettings(JSON.parse(JSON.stringify(explicitOptOut)))
            .scopeRecapPreparationEnabled).toBe(false);
        expect(mergePageletSettings(JSON.parse(JSON.stringify(migratedDecline))))
            .toMatchObject({
                scopeRecapPreparationEnabled: false,
                scopeRecapBackgroundAuthorization: "declined-v1",
            });
    });

    it("normalizes, deduplicates, and caps the persisted Recap suppression ledger", () => {
        const validEntries = Array.from({ length: 205 }, (_, index) => ({
            fingerprint: `recap-${index}`,
            shownAt: index + 0.9,
        }));
        const merged = mergePageletSettings({
            scopeRecapNudgeSuppressions: [
                null,
                { fingerprint: "", shownAt: 1 },
                { fingerprint: "x".repeat(161), shownAt: 1 },
                { fingerprint: "not-a-number", shownAt: "1" },
                ...validEntries,
                {
                    fingerprint: "  recap-100  ",
                    shownAt: 999.9,
                    snoozedUntil: 1234.9,
                },
            ],
        });
        const ledger = merged.scopeRecapNudgeSuppressions;

        expect(ledger).toHaveLength(200);
        expect(new Set(ledger.map((entry) => entry.fingerprint)).size).toBe(200);
        expect(ledger.at(-1)).toEqual({
            fingerprint: "recap-100",
            shownAt: 999,
            snoozedUntil: 1234,
        });
        expect(ledger).not.toContainEqual(expect.objectContaining({ fingerprint: "not-a-number" }));
    });

    it("persists only bounded, content-free Scope Recap attempt diagnostics", () => {
        const merged = mergePageletSettings({
            scopeRecapLastAttempt: {
                attemptedAt: " 2026-07-18T08:30:00.000Z ",
                outcome: "success",
                scope: {
                    kind: "folder",
                    label: "Private project title",
                    paths: ["Projects/Secret.md"],
                },
                sourceSnapshotId: " scope-snapshot ",
                dataBoundarySnapshotId: "boundary-snapshot",
                providerCallMade: true,
                includedSourceCount: 2.9,
                cost: {
                    inputTokens: 100,
                    outputTokens: 20,
                    estimatedCost: 0.001,
                    currency: "USD",
                    pricingKnown: true,
                    prompt: "private note content",
                },
                summary: "private generated summary",
                sourceRefs: [{ path: "Projects/Secret.md" }],
            },
        });

        // A malformed required count rejects the whole record instead of
        // silently persisting a partly trustworthy status object.
        expect(merged.scopeRecapLastAttempt).toBeNull();

        const valid = mergePageletSettings({
            scopeRecapLastAttempt: {
                attemptedAt: " 2026-07-18T08:30:00.000Z ",
                outcome: "success",
                scope: {
                    kind: "folder",
                    label: "Private project title",
                    paths: ["Projects/Secret.md"],
                },
                sourceSnapshotId: " scope-snapshot ",
                dataBoundarySnapshotId: "boundary-snapshot",
                providerCallMade: true,
                includedSourceCount: 2,
                cost: {
                    inputTokens: 100,
                    outputTokens: 20,
                    estimatedCost: 0.001,
                    currency: "USD",
                    pricingKnown: true,
                    prompt: "private note content",
                },
                summary: "private generated summary",
                sourceRefs: [{ path: "Projects/Secret.md" }],
            },
        }).scopeRecapLastAttempt;

        expect(valid).toEqual({
            attemptedAt: "2026-07-18T08:30:00.000Z",
            outcome: "success",
            scope: { kind: "folder" },
            sourceSnapshotId: "scope-snapshot",
            dataBoundarySnapshotId: "boundary-snapshot",
            providerCallMade: true,
            includedSourceCount: 2,
            cost: {
                inputTokens: 100,
                outputTokens: 20,
                estimatedCost: 0.001,
                currency: "USD",
                pricingKnown: true,
            },
        });
        expect(JSON.stringify(valid)).not.toContain("private");
        expect(JSON.stringify(valid)).not.toContain("Secret.md");
    });

    it("whitelists and bounds persisted Quiet Recall evaluation diagnostics", () => {
        const attempts = Array.from({ length: 25 }, (_, index) => ({
            candidateId: `candidate-${index}`,
            candidateIndex: index,
            fingerprint: `fingerprint-${index}`,
            kind: "initial",
            reserved: true,
            outcome: "accepted",
            reason: "not_convincing",
            candidate: {
                title: "private title",
                excerpt: "private note content",
                sourceRefs: [{ path: "Projects/Secret.md" }],
            },
            cost: {
                inputTokens: 100,
                outputTokens: 20,
                estimatedCost: 0.001,
                currency: "USD",
                pricingKnown: true,
                prompt: "private prompt",
            },
        }));
        attempts.splice(1, 0, {
            ...attempts[0],
            candidateId: "x".repeat(161),
        });
        const diagnostics = mergePageletSettings({
            quietRecallLastDiagnostics: {
                roundId: " round-1 ",
                startedAt: Date.parse("2026-07-18T08:31:00.000Z"),
                contextFingerprint: "context-fingerprint",
                candidateCount: Number.MAX_SAFE_INTEGER,
                evaluatedCandidateCount: 25,
                providerCalls: 25,
                semanticRetrievalCalls: 1,
                totalProviderCalls: 26,
                initialCalls: 25,
                languageRetryCalls: 0,
                cacheHits: 0,
                inFlightHits: 0,
                estimatedCost: Number.MAX_VALUE,
                pricingKnown: true,
                limiterUsage: {
                    hourlyUsed: 3,
                    hourlyCap: 10,
                    hourlyRemaining: 7,
                    dailyUsed: 8,
                    dailyCap: 50,
                    dailyRemaining: 42,
                    resetLabel: "private schedule",
                },
                blockedReason: "cooldown",
                attempts,
                whyNow: "private generated rationale",
            },
            quietRecallLastAcceptedCount: Number.MAX_SAFE_INTEGER,
        });

        expect(diagnostics.quietRecallLastDiagnostics).toMatchObject({
            roundId: "round-1",
            candidateCount: 1_000_000,
            semanticRetrievalCalls: 1,
            totalProviderCalls: 26,
            estimatedCost: 1_000_000,
            blockedReason: "cooldown",
        });
        expect(diagnostics.quietRecallLastDiagnostics?.attempts).toHaveLength(20);
        expect(diagnostics.quietRecallLastDiagnostics?.attempts[0]).toEqual({
            candidateId: "candidate-0",
            candidateIndex: 0,
            fingerprint: "fingerprint-0",
            kind: "initial",
            reserved: true,
            outcome: "accepted",
            reason: "not_convincing",
            cost: {
                inputTokens: 100,
                outputTokens: 20,
                estimatedCost: 0.001,
                currency: "USD",
                pricingKnown: true,
            },
        });
        expect(diagnostics.quietRecallLastAcceptedCount).toBe(1_000_000);
        const serialized = JSON.stringify(diagnostics.quietRecallLastDiagnostics);
        expect(serialized).not.toContain("private");
        expect(serialized).not.toContain("Secret.md");
    });

    it("fails closed for malformed persisted diagnostics and counts", () => {
        for (const malformed of [undefined, null, [], "diagnostics", { roundId: "only-one-field" }]) {
            expect(mergePageletSettings({ quietRecallLastDiagnostics: malformed })
                .quietRecallLastDiagnostics).toBeNull();
            expect(mergePageletSettings({ scopeRecapLastAttempt: malformed })
                .scopeRecapLastAttempt).toBeNull();
        }
        for (const malformedCount of ["2", -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
            expect(mergePageletSettings({ quietRecallLastAcceptedCount: malformedCount })
                .quietRecallLastAcceptedCount).toBe(0);
        }
    });

    it("ignores garbage values on a single field without poisoning others", () => {
        const merged = mergePageletSettings({
            enabled: "not a boolean",
            reviewsFolder: "  my/reviews  ",
            outputLanguage: "fr", // unsupported
            ribbonPosition: 7,    // wrong type
            temperature: 99,      // out of range
            maxInputTokens: -10,  // below min
            maxOutputTokens: "abc", // unparseable
        });
        expect(merged.enabled).toBe(PAGELET_DEFAULTS.enabled);
        expect(merged.reviewsFolder).toBe("my/reviews"); // trimmed
        expect(merged.outputLanguage).toBe(PAGELET_DEFAULTS.outputLanguage);
        expect(merged.ribbonPosition).toBe(PAGELET_DEFAULTS.ribbonPosition);
        expect(merged.temperature).toBe(PAGELET_BOUNDS.temperature.max); // clamped
        expect(merged.maxInputTokens).toBe(PAGELET_BOUNDS.maxInputTokens.min); // clamped to min
        expect(merged.maxOutputTokens).toBe(PAGELET_DEFAULTS.maxOutputTokens); // default
    });

    it("normalizes reviewsFolder by stripping leading ./ and trailing /", () => {
        expect(mergePageletSettings({ reviewsFolder: "./notes/" }).reviewsFolder).toBe("notes");
        expect(mergePageletSettings({ reviewsFolder: "notes//" }).reviewsFolder).toBe("notes");
        expect(mergePageletSettings({ reviewsFolder: "  " }).reviewsFolder).toBe(
            PAGELET_DEFAULTS.reviewsFolder,
        );
    });

    it("fails closed when reviewsFolder is an absolute path (was: stripped silently)", () => {
        // Pre-H-B3.2 the merger silently stripped the leading slash so
        // `"/notes"` became `"notes"`. The capability's allowedRoots is
        // derived from this value (pa-review-tool-provider.ts:285-296), so
        // accepting an absolute path widened the framework's confinement
        // gate to any vault folder named `notes`. Closing the gap means
        // rejecting absolute paths outright and reverting to the default.
        expect(mergePageletSettings({ reviewsFolder: "/notes" }).reviewsFolder).toBe(
            PAGELET_DEFAULTS.reviewsFolder,
        );
    });

    it("silently coerces legacy bypass shapes the H1 migration Notice flags", () => {
        // Boot-time merge is silent (the migration Notice plumbing in
        // src/plugin.ts surfaces user-visible feedback separately). Confirm
        // that the merged value falls back to the default for every legacy
        // shape the new validator now rejects — losing this contract would
        // let the framework's allowedRoots widen on a stale data.json.
        const legacyShapes = [
            ".obsidian/plugins/personal-assistant/reviews",
            ".Obsidian/plugins",
            ".obsidian./plugins",
            ".obsidian\\plugins",
            "C:\\Users\\me\\notes",
            "/etc/passwd",
            "notes/../../escape",
            "​.obsidian",
            "notesdel",
            "foo /bar",
        ];
        for (const shape of legacyShapes) {
            expect(mergePageletSettings({ reviewsFolder: shape }).reviewsFolder).toBe(
                PAGELET_DEFAULTS.reviewsFolder,
            );
        }
    });

    it("accepts every valid outputLanguage and rejects others", () => {
        for (const v of ["auto", "zh", "en"] as const) {
            expect(mergePageletSettings({ outputLanguage: v }).outputLanguage).toBe(v);
        }
        expect(mergePageletSettings({ outputLanguage: "ja" }).outputLanguage).toBe(
            PAGELET_DEFAULTS.outputLanguage,
        );
    });

    it("accepts every valid ribbonPosition and rejects others", () => {
        for (const v of ["default", "hidden"] as const) {
            expect(mergePageletSettings({ ribbonPosition: v }).ribbonPosition).toBe(v);
        }
        expect(mergePageletSettings({ ribbonPosition: "top" }).ribbonPosition).toBe(
            PAGELET_DEFAULTS.ribbonPosition,
        );
        expect(mergePageletSettings({ ribbonPosition: "bottom" }).ribbonPosition).toBe(
            PAGELET_DEFAULTS.ribbonPosition,
        );
    });

    it("clamps numeric fields exactly at the boundaries", () => {
        // Min boundary holds.
        expect(
            mergePageletSettings({ temperature: -1 }).temperature,
        ).toBe(PAGELET_BOUNDS.temperature.min);
        expect(
            mergePageletSettings({ maxInputTokens: 0 }).maxInputTokens,
        ).toBe(PAGELET_BOUNDS.maxInputTokens.min);
        // Max boundary holds.
        expect(
            mergePageletSettings({ maxInputTokens: 100000 }).maxInputTokens,
        ).toBe(PAGELET_BOUNDS.maxInputTokens.max);
        expect(
            mergePageletSettings({ maxOutputTokens: 100000 }).maxOutputTokens,
        ).toBe(PAGELET_BOUNDS.maxOutputTokens.max);
    });

    it("parses numeric strings (text-input convenience)", () => {
        expect(mergePageletSettings({ temperature: "0.3" }).temperature).toBe(0.3);
        expect(mergePageletSettings({ maxInputTokens: "12345" }).maxInputTokens).toBe(12345);
    });

    it("truncates non-integer token counts (no fractional tokens make sense)", () => {
        expect(mergePageletSettings({ maxInputTokens: 1234.78 }).maxInputTokens).toBe(1234);
    });

    it("clamps background preparation token budgets to the smaller background pool", () => {
        const merged = mergePageletSettings({
            preloadTokenBudget: { input: 32000, output: 4000 },
        });

        expect(merged.preloadTokenBudget).toEqual({
            input: PAGELET_PRELOAD_TOKEN_BOUNDS.input.max,
            output: PAGELET_PRELOAD_TOKEN_BOUNDS.output.max,
        });
    });

    it("migrates legacy generic-preload caps into the unattended standard envelope", () => {
        const merged = mergePageletSettings({
            preloadPerHourCap: 20,
            preloadPerDayCap: 200,
            preloadTokenBudget: { input: 8000, output: 2000 },
        });

        expect(merged.preloadPerHourCap).toBe(2);
        expect(merged.preloadPerDayCap).toBe(20);
        expect(merged.preloadTokenBudget).toEqual({ input: 4000, output: 1000 });
    });
});

// ---------------------------------------------------------------------------
// normalizeReviewsFolder — H-B3.2 / PR #356 B2 prod-gap settings-layer validator
//
// This validator is the fail-closed boundary that backs
// `PaReviewToolProvider.targetConfinement.allowedRoots`. Without it, a
// misconfigured `reviewsFolder` (`.obsidian/`, `/etc`, `../foo`, `C:\…`)
// would propagate to the capability and Gate 1 of the Write Action
// Framework would happily accept writes inside the user's Obsidian config
// folder. Each forbidden shape below maps to a real attacker fixture
// documented in `docs/architecture/write-action-framework-sdd.md` §8.3.
// ---------------------------------------------------------------------------

describe("normalizeReviewsFolder (settings-layer validator)", () => {
    it("accepts plain vault-relative paths unchanged", () => {
        expect(normalizeReviewsFolder("notes/reviews")).toEqual({
            value: "notes/reviews",
        });
        expect(normalizeReviewsFolder(".pagelet")).toEqual({ value: ".pagelet" });
    });

    it("trims whitespace and strips leading ./ and trailing /", () => {
        expect(normalizeReviewsFolder("  ./reviews/  ")).toEqual({
            value: "reviews",
        });
        expect(normalizeReviewsFolder("reviews//")).toEqual({ value: "reviews" });
    });

    it("returns the default with no error for non-string inputs (corrupt data.json)", () => {
        // Non-string inputs originate from a broken data.json shape, not a
        // typed user action — coerce silently to avoid noisy startup errors.
        expect(normalizeReviewsFolder(undefined)).toEqual({
            value: PAGELET_DEFAULTS.reviewsFolder,
        });
        expect(normalizeReviewsFolder(42)).toEqual({
            value: PAGELET_DEFAULTS.reviewsFolder,
        });
        expect(normalizeReviewsFolder({ folder: "notes" })).toEqual({
            value: PAGELET_DEFAULTS.reviewsFolder,
        });
    });

    it("rejects empty input (whitespace-only or '.') with error: empty", () => {
        const r = normalizeReviewsFolder("   ");
        expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
        expect(r.error).toBe("empty");
        // Sanitised-to-empty (single `.` strips to nothing) also fails closed.
        const dot = normalizeReviewsFolder("./");
        expect(dot.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
        expect(dot.error).toBe("empty");
    });

    it("rejects absolute Unix paths with error: absolute_path", () => {
        for (const bad of ["/etc/passwd", "/tmp", "/"]) {
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("absolute_path");
            expect(r.input).toBe(bad);
        }
    });

    it("rejects Windows drive-letter prefixes with error: drive_letter", () => {
        for (const bad of ["C:\\Users\\me", "c:/notes", "Z:\\evil"]) {
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("drive_letter");
        }
    });

    it("rejects parent-traversal segments with error: parent_traversal", () => {
        for (const bad of ["..", "../../config", "notes/../escape", "a/b/.."]) {
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("parent_traversal");
        }
    });

    it("accepts folder names that merely CONTAIN '..' but do not have a bare '..' segment", () => {
        // A literal folder name `..config` (filesystem-legal) must NOT be
        // confused with parent-traversal. Tokenisation on `/` prevents that.
        expect(normalizeReviewsFolder("..config")).toEqual({ value: "..config" });
        expect(normalizeReviewsFolder("foo/bar..baz")).toEqual({ value: "foo/bar..baz" });
    });

    it("rejects paths inside .obsidian with error: obsidian_config (PR #356 B2 fixture)", () => {
        for (const bad of [
            ".obsidian",
            ".obsidian/plugins",
            ".obsidian/plugins/personal-assistant",
            "./.obsidian/foo",
        ]) {
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("obsidian_config");
        }
    });

    it("rejects paths inside the current Vault#configDir", () => {
        for (const bad of [
            "vault-config",
            "vault-config/plugins",
            "./vault-config/plugins/personal-assistant",
            "Vault-Config/plugins",
        ]) {
            const r = normalizeReviewsFolder(bad, { configDir: "vault-config" });
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("obsidian_config");
        }

        expect(normalizeReviewsFolder("vault-configured/reviews", { configDir: "vault-config" }))
            .toEqual({ value: "vault-configured/reviews" });
    });

    it("rejects control characters (NUL, TAB, BEL, …) with error: control_chars", () => {
        for (const bad of ["notes\u0000evil", "notes\u0007bell", "notes\ttab"]) {
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("control_chars");
        }
    });

    it("input echo trims to surface the user's typed value to the UI", () => {
        // The UI logs `result.input` when it surfaces an error message; the
        // echo should reflect what the user typed (trimmed) so feedback is
        // clear even when surrounding whitespace is the trigger.
        const r = normalizeReviewsFolder("  /etc  ");
        expect(r.input).toBe("/etc");
        expect(r.error).toBe("absolute_path");
    });

    // ─── B1: case-insensitive .obsidian (APFS/NTFS bypass) ───────────────
    it("case-folds segments[0] before .obsidian compare (B1 — APFS/NTFS bypass)", () => {
        for (const bad of [
            ".Obsidian",
            ".OBSIDIAN",
            ".Obsidian/plugins",
            ".OBSIDIAN/plugins/personal-assistant",
            ".ObSiDiAn/foo",
        ]) {
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("obsidian_config");
        }
    });

    // ─── B2: trailing dot/space (NTFS strips them silently) ──────────────
    it("rejects segments ending in '.' or whitespace (B2 — NTFS strip bypass)", () => {
        // Trailing whitespace on the WHOLE input is removed by `.trim()`
        // before any segment check, so the meaningful B2 case is whitespace
        // BETWEEN slashes — i.e. mid-path. NTFS would silently strip it on
        // disk, so `foo /bar` would resolve to `foo/bar` and let an
        // `.obsidian /plugins` shape escape into the real `.obsidian/`.
        for (const bad of [
            ".obsidian./plugins",
            ".obsidian /plugins",
            ".obsidian.../foo",
            "foo./bar",
            "foo /bar",
        ]) {
            // (a tab between segments would trip control_chars first, so we
            // omit it — the segment-end rule still covers ASCII space.)
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("trailing_dot_or_space");
        }
    });

    // ─── B3: Windows backslash normalization ─────────────────────────────
    it("normalizes Windows backslashes before segment checks (B3 — Gemini bot)", () => {
        // After `\` → `/` normalization, each of these collapses into the
        // category the user actually attempted, NOT the opaque-segment bypass
        // that pre-normalization would have allowed.
        const cases: Array<[string, string]> = [
            [".obsidian\\plugins", "obsidian_config"],
            [".obsidian\\plugins\\evil", "obsidian_config"],
            ["notes\\..\\evil", "parent_traversal"],
            ["C:\\Users\\evil", "drive_letter"],
            ["\\\\server\\share", "absolute_path"],
        ];
        for (const [bad, want] of cases) {
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe(want);
        }
    });

    // ─── H2: Cf-category invisible characters (spoofing) ─────────────────
    it("rejects zero-width / bidi / BOM Cf characters with error: invisible_chars (H2)", () => {
        // BOM (U+FEFF) at the START is removed by `.trim()` so the validator
        // never sees it; only mid-string occurrences are reachable. ZWSP and
        // friends survive trim and are the real spoof vector.
        for (const bad of [
            "​.obsidian", // ZWSP (mid-string)
            "notes‌dir",  // ZWNJ
            "notes‍dir",  // ZWJ
            "notes⁠dir",  // WJ
            "notes﻿dir",  // BOM mid-string
            "notes‮dir",  // RLO
            "notes⁦dir",  // LRI
        ]) {
            const r = normalizeReviewsFolder(bad);
            expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
            expect(r.error).toBe("invisible_chars");
        }
    });

    // ─── DEL (U+007F) — grouped with C0 controls ─────────────────────────
    it("rejects DEL (U+007F) as control_chars", () => {
        const r = normalizeReviewsFolder("notesdel");
        expect(r.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
        expect(r.error).toBe("control_chars");
    });

    // ─── Near-miss negatives: literally legal folder shapes ──────────────
    it("accepts segment-exact near-misses that look like .obsidian but are not", () => {
        // These must NOT trip the obsidian_config guard — they are legitimate
        // user folder names that share a prefix or contain `.obsidian` as a
        // substring of a non-leading segment.
        expect(normalizeReviewsFolder(".obsidianbackup")).toEqual({ value: ".obsidianbackup" });
        expect(normalizeReviewsFolder("obsidian/notes")).toEqual({ value: "obsidian/notes" });
        expect(normalizeReviewsFolder("notes/.obsidian-cheatsheet"))
            .toEqual({ value: "notes/.obsidian-cheatsheet" });
        // case-folded near-miss: the first segment isn't `.obsidian` after
        // toLowerCase, just shares an exact prefix.
        expect(normalizeReviewsFolder(".OBSIDIANBackup")).toEqual({ value: ".OBSIDIANBackup" });
    });

    // ─── Ordering tests: pin which rule fires first ──────────────────────
    it("evaluates rules in a stable order (pin first-match for overlapping inputs)", () => {
        // Backslash normalization happens FIRST, so `\\server\share` collapses
        // to `//server/share` and trips absolute_path — NOT drive_letter (no
        // colon) and NOT obsidian_config (no .obsidian).
        expect(normalizeReviewsFolder("\\\\server\\share").error).toBe("absolute_path");
        // Drive letter fires BEFORE absolute_path/obsidian_config when both
        // would apply. `C:\..\evil` → drive_letter (caught first).
        expect(normalizeReviewsFolder("C:\\..\\evil").error).toBe("drive_letter");
        // Absolute path fires before parent_traversal: `/foo/../etc` is
        // categorised as absolute_path, not parent_traversal.
        expect(normalizeReviewsFolder("/foo/../etc").error).toBe("absolute_path");
        // Parent traversal fires before obsidian_config: `.obsidian/../foo`
        // is parent_traversal (counter-intuitive but intentional — the user
        // is doing something path-rewriting that we cannot reason about
        // semantically).
        expect(normalizeReviewsFolder(".obsidian/../foo").error).toBe("parent_traversal");
        // Trailing-dot fires before obsidian_config (necessary for B2):
        // `.obsidian./plugins` is trailing_dot_or_space, not obsidian_config.
        expect(normalizeReviewsFolder(".obsidian./plugins").error).toBe("trailing_dot_or_space");
    });

    it("rejects other system dotfolders (.git / .trash / .obsidian.bak) with error: forbidden_dotfolder", () => {
        // .git can absolutely live next to .obsidian in a vault; writing into
        // it would corrupt the repo. Same hazard class as .obsidian/.
        const git = normalizeReviewsFolder(".git/pagelet");
        expect(git.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
        expect(git.error).toBe("forbidden_dotfolder");

        // .trash is Obsidian's local trash bin; writing into it would put
        // freshly-created review notes one step from deletion.
        const trash = normalizeReviewsFolder(".trash/notes");
        expect(trash.error).toBe("forbidden_dotfolder");

        // .obsidian.bak is the conventional backup-of-Obsidian-config name
        // some users keep next to .obsidian.
        const bak = normalizeReviewsFolder(".obsidian.bak/foo");
        expect(bak.error).toBe("forbidden_dotfolder");

        // Case-fold + NFC applies just like the .obsidian compare above.
        expect(normalizeReviewsFolder(".Git/x").error).toBe("forbidden_dotfolder");
        expect(normalizeReviewsFolder(".TRASH/x").error).toBe("forbidden_dotfolder");

        // Nested deeper or as a non-top-level segment is harmless — same
        // contract as the .obsidian check (only segments[0] trips).
        expect(normalizeReviewsFolder("notes/.git-cheatsheet").error).toBeUndefined();
        expect(normalizeReviewsFolder("notes/.trash-archive").error).toBeUndefined();
    });

    it("rejects inputs longer than 4096 chars with error: too_long", () => {
        const longPath = "a".repeat(4097);
        const result = normalizeReviewsFolder(longPath);
        expect(result.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
        expect(result.error).toBe("too_long");

        // Exactly at the cap is accepted (4096 chars is at the boundary).
        const atCap = "b".repeat(4096);
        expect(normalizeReviewsFolder(atCap).error).toBeUndefined();
    });

    it("has a resolvable EN + ZH label for every PageletReviewsFolderError variant", () => {
        // This pins the i18n contract: every rejection category the
        // validator can emit MUST have a user-facing message in both
        // locales. The typed Record at the renderer surface protects
        // against missing keys at compile time, but a placeholder string
        // is just as bad as a missing key. We assert every label resolves
        // to a non-empty, non-placeholder string.
        const allVariants: PageletReviewsFolderError[] = [
            "empty",
            "too_long",
            "absolute_path",
            "drive_letter",
            "parent_traversal",
            "obsidian_config",
            "forbidden_dotfolder",
            "control_chars",
            "invisible_chars",
            "trailing_dot_or_space",
        ];
        const en = makePageletTranslator("en");
        const zh = makePageletTranslator("zh");
        for (const variant of allVariants) {
            const key = `pagelet.settings.reviewsFolder.error.${variant}`;
            const enLabel = en(key);
            const zhLabel = zh(key);
            expect(enLabel.length).toBeGreaterThan(0);
            expect(enLabel).not.toBe(key); // a fallback that echoes the key means missing translation
            expect(zhLabel.length).toBeGreaterThan(0);
            expect(zhLabel).not.toBe(key);
        }
    });
});

// ---------------------------------------------------------------------------
// renderPageletSection — UI wiring + i18n + onChange path
// ---------------------------------------------------------------------------

describe("renderPageletSection", () => {
    it("explains that the corner preference is desktop/iPad-only", () => {
        expect(makePageletTranslator("en")("pagelet.settings.petCorner.desc"))
            .toContain("On iPhone, it follows the active note toolbar.");
        expect(makePageletTranslator("zh")("pagelet.settings.petCorner.desc"))
            .toContain("iPhone 上会跟随当前笔记工具栏");
    });

    it("splits everyday preferences from note privacy without exposing internal tuning", () => {
        const preferences = makeStubNode("div");
        const saveLocation = makeStubNode("div");
        const sourceExclusions = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost();
        const internalBefore = {
            temperature: host.settings.pagelet.temperature,
            maxInputTokens: host.settings.pagelet.maxInputTokens,
            maxOutputTokens: host.settings.pagelet.maxOutputTokens,
            foregroundPerHourCap: host.settings.pagelet.foregroundPerHourCap,
            foregroundPerDayCap: host.settings.pagelet.foregroundPerDayCap,
            proactiveHintsCooldown: host.settings.pagelet.proactiveHintsCooldown,
        };
        renderPageletPreferences(preferences as unknown as HTMLElement, host, factory, "en");
        const names = rows.map((row) => row.name);
        expect(names).toEqual(expect.arrayContaining([
            "Enable Pagelet", "Output language", "Discover connections in the background",
            "Show Pet", "Pet corner", "Proactive hints", "High-value Recap hints",
            "Quiet Recall", "Enable quiet hours", "Start time", "End time",
        ]));
        expect(names).not.toEqual(expect.arrayContaining(["Reviews folder"]));
        expect(names.some((name) => /temperature|token|cap$|cooldown|preparation/i.test(name ?? ""))).toBe(false);
        expect(new Set(names).size).toBe(names.length);
        expect(host.settings.pagelet).toMatchObject(internalBefore);

        const preferencesCount = rows.length;
        renderPageletNotePrivacy({
            saveLocation: saveLocation as unknown as HTMLElement,
            sourceExclusions: sourceExclusions as unknown as HTMLElement,
        }, host, factory, "en");
        expect(rows.slice(preferencesCount).map((row) => row.name)).toEqual([
            "Reviews folder", "Excluded folders", "Excluded tags", "Excluded patterns",
        ]);
        expect(rows.find((row) => row.name === "Reviews folder")?.parent).toBe(saveLocation);
        expect(rows.filter((row) => row.name?.startsWith("Excluded")).every((row) => row.parent === sourceExclusions)).toBe(true);
    });

    it("keeps native details and the folder error surface in the combined compatibility renderer", () => {
        const parent = makeStubNode("div");
        const { factory } = makeStubFactory();
        const { host } = makeHost();
        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        expect(parent.children[0].text).toBe("Pagelet");
        expect(parent.children.find((node) => node.cls === "pa-pagelet-beta-callout")?.text).toContain("Beta");
        const details = parent.children.find((node) => node.tagName === "details");
        expect(details?.children[0]).toMatchObject({ tagName: "summary", text: "Appearance and reminders" });
        expect(parent.children.find((node) => node.cls === "pa-pagelet-settings-error")).toBeDefined();
    });

    it("uses the Chinese dictionary and current saved values", () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost({ enabled: false, reviewsFolder: "custom/path", outputLanguage: "zh" });
        renderPageletSection(parent as unknown as HTMLElement, host, factory, "zh");

        expect(rows.find((row) => row.name === "启用拾页")?.toggleValue).toBe(false);
        expect(rows.find((row) => row.name === "审阅笔记目录")?.textValue).toBe("custom/path");
        expect(rows.find((row) => row.dropdownOptions.some((option) => option.value === "auto"))?.dropdownValue).toBe("zh");
        expect(parent.children[0].text).toBe("拾页");
    });

    it("populates output-language options without resetting the chosen language", () => {
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost({ outputLanguage: "zh" });
        renderPageletPreferences(makeStubNode("div") as unknown as HTMLElement, host, factory, "en");
        const row = rows.find((entry) => entry.name === "Output language")!;
        expect(row.dropdownOptions.map((option) => option.value)).toEqual(["auto", "zh", "en"]);
        expect(row.dropdownOptions[0].text).toBe("Auto (follow note language)");
        expect(row.dropdownValue).toBe("zh");
    });

    it("changes only conditional child visibility while preserving saved choices and sibling drafts", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost({
            petVisible: false,
            petCorner: "top-left",
            proactiveHintsQuietHours: { enabled: false, start: "21:15", end: "07:30" },
        });
        renderPageletPreferences(parent as unknown as HTMLElement, host, factory, "en");
        const corner = rows.find((row) => row.name === "Pet corner")!;
        const start = rows.find((row) => row.name === "Start time")!;
        const originalRows = [...rows];
        start.textValue = "22:45";
        expect(corner.parent?.hidden).toBe(true);
        expect(start.parent?.hidden).toBe(true);
        await rows.find((row) => row.name === "Show Pet")!.toggleOnChange!(true);
        await rows.find((row) => row.name === "Enable quiet hours")!.toggleOnChange!(true);
        expect(corner.parent?.hidden).toBe(false);
        expect(start.parent?.hidden).toBe(false);
        expect(corner.dropdownValue).toBe("top-left");
        expect(start.textValue).toBe("22:45");
        expect(host.settings.pagelet.proactiveHintsQuietHours).toEqual({ enabled: true, start: "21:15", end: "07:30" });
        expect(rows).toEqual(originalRows);
    });

    it("keeps a failed folder edit visible and offers a surface-local save retry", async () => {
        const saveLocation = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host, save } = makeHost({ reviewsFolder: "old/reviews" });
        renderPageletNotePrivacy({
            saveLocation: saveLocation as unknown as HTMLElement,
            sourceExclusions: makeStubNode("div") as unknown as HTMLElement,
        }, host, factory, "en");
        const folder = rows.find((row) => row.name === "Reviews folder")!;
        folder.textValue = "new/reviews";
        save.mockRejectedValueOnce(new Error("disk unavailable"));
        await folder.textOnChange!("new/reviews");
        const status = saveLocation.children.find((node) => node.cls === "pa-settings-save-status")!;
        const retry = saveLocation.children.find((node) => node.tagName === "button")!;
        expect(folder.textValue).toBe("new/reviews");
        expect(status.textContent).toContain("not been saved");
        expect(retry.hidden).toBe(false);
        retry.dispatch("click");
        await Promise.resolve();
        expect(save).toHaveBeenCalledTimes(2);
        expect(status.textContent).toBe("");
        expect(retry.hidden).toBe(true);
    });

    it.each([false, true])("shows only ordinary usage counts and ignores a closed view, closed=%s", async (closed) => {
        const parent = Object.assign(makeStubNode("div"), { isConnected: true });
        const { factory } = makeStubFactory();
        const { host } = makeHost();
        let complete!: (value: { runs: number; dailyCap: number; modelTurns: number; toolCalls: number }) => void;
        host.getDeepDiscoverUsage = () => new Promise((resolve) => { complete = resolve; });
        renderPageletPreferences(parent as unknown as HTMLElement, host, factory, "en");
        const usage = parent.children.find((node) => node.text === "Pagelet keeps discovery within a daily limit.")!;
        if (closed) parent.isConnected = false;
        complete({ runs: 3, dailyCap: 36, modelTurns: 12, toolCalls: 40 });
        await Promise.resolve();
        expect(usage.textContent).toBe(closed ? undefined : "Discoveries today: 3 of 36.");
    });

    it("persists toggle changes through saveSettings", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host, save } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");
        expect(host.settings.pagelet.enabled).toBe(true);

        await rows[0].toggleOnChange!(false);

        expect(host.settings.pagelet.enabled).toBe(false);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("reads and writes Quiet Recall through the canonical runtime setting", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host, save } = makeHost({
            proactiveHints: true,
            scopeRecapPreparationEnabled: false,
            scopeRecapHighValueHints: false,
        }, "on");

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");
        const quietRecall = rows.find((row) => row.name === "Quiet Recall");

        expect(quietRecall?.toggleValue).toBe(true);
        await quietRecall?.toggleOnChange?.(false);

        expect(host.settings.quietRecall.quietRecallMode).toBe("off");
        expect(host.settings.pagelet).not.toHaveProperty("quietRecallMode");
        expect(host.settings.pagelet).toMatchObject({
            proactiveHints: true,
            scopeRecapPreparationEnabled: false,
            scopeRecapHighValueHints: false,
        });
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("keeps legacy Recap data internal without affecting valid hint choices", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host, save } = makeHost({
            scopeRecapPreparationEnabled: false,
            scopeRecapBackgroundAuthorization: "declined-v1",
            scopeRecapAuthorizationContextId: null,
        });

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");
        const recapPreparation = rows.find((row) => row.name === "Prepare Scope Recap in the background");
        expect(recapPreparation).toBeUndefined();
        await rows.find((row) => row.name === "High-value Recap hints")?.toggleOnChange?.(false);

        expect(host.settings.pagelet).toMatchObject({
            scopeRecapPreparationEnabled: false,
            scopeRecapBackgroundAuthorization: "declined-v1",
            scopeRecapAuthorizationContextId: null,
            scopeRecapHighValueHints: false,
        });
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("normalizes reviewsFolder via the same merger on text edit", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host, save } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");
        await rows.find((row) => row.name === "Reviews folder")!.textOnChange!("./notes/reviews/");

        expect(host.settings.pagelet.reviewsFolder).toBe("notes/reviews");
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("fails closed on a forbidden reviewsFolder edit — surfaces error + reverts visible input", async () => {
        // This is the renderer-side guarantee for H-B3.2 / PR #356 B2: a
        // user typo that targets `.obsidian/` or an absolute path MUST NOT
        // propagate into `settings.reviewsFolder` (which would widen the
        // capability's allowedRoots), AND the visible text input MUST
        // revert so the user sees their edit was not accepted. All three
        // arms assert the fail-closed contract.
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host, save } = makeHost({ reviewsFolder: "notes/reviews" });

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");
        // Seeded value rendered into the input.
        expect(rows.find((row) => row.name === "Reviews folder")!.textValue).toBe("notes/reviews");

        // Read the error element. The stub does not track `textContent`
        // (the renderer writes to a raw DOM property), so we read it back
        // through a cast — JS still stores the assignment as a plain
        // property on the stub object.
        const errorEl = parent.children.find(
            (c) => c.tagName === "div" && c.cls === "pa-pagelet-settings-error",
        ) as unknown as { textContent?: string } | undefined;
        expect(errorEl).toBeDefined();

        // User typos a forbidden path. Expectations:
        //   1. `settings.reviewsFolder` stays at the previously valid value.
        //   2. Visible text input reverts to that previously valid value.
        //   3. The error sibling shows the localised message for the
        //      rejected category.
        //   4. No save is needed for the rejected input.
        await rows.find((row) => row.name === "Reviews folder")!.textOnChange!(".obsidian/plugins/personal-assistant");

        expect(host.settings.pagelet.reviewsFolder).toBe("notes/reviews");
        expect(rows.find((row) => row.name === "Reviews folder")!.textValue).toBe("notes/reviews");
        // Compare to the resolved EN translation rather than a literal
        // substring so the assertion stays correct if/when the message copy
        // changes. The point is "the obsidian_config category surfaced",
        // not "the message happens to spell `.obsidian`".
        expect(errorEl?.textContent).toBe(
            makePageletTranslator("en")("pagelet.settings.reviewsFolder.error.obsidian_config"),
        );
        expect(save).not.toHaveBeenCalled();

        // After a clean edit the error must clear so a previous rejection
        // is not stuck on screen forever.
        await rows.find((row) => row.name === "Reviews folder")!.textOnChange!("clean/folder");
        expect(host.settings.pagelet.reviewsFolder).toBe("clean/folder");
        expect(errorEl?.textContent).toBe("");
    });

    it("surfaces forbidden_dotfolder via the typed-Record lookup (regression for the .${result.error} template removal)", async () => {
        // After the S2 cleanup the renderer no longer uses a
        // `t(\`...error.${...}\`)` template; instead it looks up via a
        // typed `Record<PageletReviewsFolderError, string>` so any future
        // variant fails compile if EN/ZH isn't updated. This test exercises
        // the typed path for one of the NEW (post-bundle) categories so we
        // catch a regression that drops a Record entry.
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost({ reviewsFolder: "notes/reviews" });

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        const errorEl = parent.children.find(
            (c) => c.tagName === "div" && c.cls === "pa-pagelet-settings-error",
        ) as unknown as { textContent?: string } | undefined;
        expect(errorEl).toBeDefined();

        await rows.find((row) => row.name === "Reviews folder")!.textOnChange!(".git/pagelet");
        expect(host.settings.pagelet.reviewsFolder).toBe("notes/reviews");
        expect(rows.find((row) => row.name === "Reviews folder")!.textValue).toBe("notes/reviews");
        expect(errorEl?.textContent).toBe(
            makePageletTranslator("en")("pagelet.settings.reviewsFolder.error.forbidden_dotfolder"),
        );

        // too_long path through the same renderer surface.
        await rows.find((row) => row.name === "Reviews folder")!.textOnChange!("x".repeat(4097));
        expect(host.settings.pagelet.reviewsFolder).toBe("notes/reviews");
        expect(errorEl?.textContent).toBe(
            makePageletTranslator("en")("pagelet.settings.reviewsFolder.error.too_long"),
        );
    });

    it("controls only background discovery and keeps legacy preload controls hidden", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        expect(rows.map((row) => row.name)).not.toContain("Prepare reviews in the background");
        expect(rows.find((row) => row.name === "Discover connections in the background")!.name).toBe("Discover connections in the background");
        await rows.find((row) => row.name === "Discover connections in the background")!.toggleOnChange!(false);
        expect(host.settings.pagelet.backgroundDiscoveryEnabled).toBe(false);
    });

    it("ignores both old switches and preserves only the new background choice", () => {
        expect(mergePageletSettings({ preloadEnabled: true }).backgroundDiscoveryEnabled).toBe(true);
        expect(mergePageletSettings({ preloadEnabled: false }).backgroundDiscoveryEnabled).toBe(true);
        expect(mergePageletSettings({
            preloadEnabled: false,
            deepDiscoverEnabled: false,
        }).backgroundDiscoveryEnabled).toBe(true);
        expect(mergePageletSettings({ backgroundDiscoveryEnabled: false }).backgroundDiscoveryEnabled).toBe(false);
        expect(mergePageletSettings({ backgroundDiscoveryEnabled: "invalid" }).backgroundDiscoveryEnabled).toBe(true);
    });

    it.each([false, true])("does not reenter background save from the committed toggle update, closed=%s", async (closed) => {
        const parent = Object.assign(makeStubNode("div"), { isConnected: true });
        const { factory, rows } = makeStubFactory({ notifyToggleChanges: true });
        const { host } = makeHost({ backgroundDiscoveryEnabled: false });
        let finish!: () => void;
        host.setBackgroundDiscoveryEnabled = jest.fn((enabled: boolean) => new Promise<void>((resolve) => {
            finish = () => {
                host.settings.pagelet.backgroundDiscoveryEnabled = enabled;
                resolve();
            };
        }));
        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");
        const row = rows.find((entry) => entry.name === "Discover connections in the background")!;
        // Obsidian changes its own value before firing the registered handler.
        row.toggleValue = true;
        const saving = row.toggleOnChange!(true);
        expect(row.toggleValue).toBe(false);
        expect(row.toggleDisabled).toBe(true);
        expect(host.settings.pagelet.backgroundDiscoveryEnabled).toBe(false);
        await row.toggleOnChange!(true);
        expect(host.setBackgroundDiscoveryEnabled).toHaveBeenCalledTimes(1);
        const descriptionWhileSaving = row.desc;
        if (closed) parent.isConnected = false;
        finish();
        await saving;
        expect(host.settings.pagelet.backgroundDiscoveryEnabled).toBe(true);
        expect(host.setBackgroundDiscoveryEnabled).toHaveBeenCalledTimes(1);
        expect(row.toggleValue).toBe(!closed);
        expect(row.toggleDisabled).toBe(closed);
        if (closed) expect(row.desc).toBe(descriptionWhileSaving);
    });

    it("keeps the committed background choice while saving and allows retry after failure", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost({ backgroundDiscoveryEnabled: false });
        let reject!: (error: Error) => void;
        host.setBackgroundDiscoveryEnabled = jest.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");
        const row = rows.find((entry) => entry.name === "Discover connections in the background")!;
        const saving = row.toggleOnChange!(true);
        expect(row.toggleValue).toBe(false);
        await row.toggleOnChange!(true);
        expect(host.setBackgroundDiscoveryEnabled).toHaveBeenCalledTimes(1);
        reject(new Error("disk unavailable"));
        await saving;
        expect(row.toggleValue).toBe(false);
        expect(row.desc).toContain("could not be saved");
        host.setBackgroundDiscoveryEnabled = jest.fn(async (enabled: boolean) => {
            host.settings.pagelet.backgroundDiscoveryEnabled = enabled;
        });
        await row.toggleOnChange!(true);
        expect(row.toggleValue).toBe(true);
        expect(row.desc).not.toContain("could not be saved");
    });
});

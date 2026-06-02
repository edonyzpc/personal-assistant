/* Copyright 2023 edonyzpc */

/**
 * Pagelet — settings module.
 *
 * Spec source:
 *  - `docs/review-assistant-sdd.md` §10.3 (Settings UI layout)
 *  - D008-D010 (storage path), D013 (beta default on), D015 (output lang),
 *    D018 (token caps), D020 (call limits — read-only display only),
 *    R4 (ribbon position)
 *
 * Shape contract:
 *  - 7 user-editable fields. Two more (`hourlyCallLimit` / `dailyCallLimit`)
 *    are exposed as read-only constants for B4's UI to surface them; we
 *    DO NOT persist them because D020 says "fixed, not editable".
 *  - All fields belong under a `pagelet` namespace on the top-level
 *    settings object so a future feature group (e.g. another assistant
 *    add-on) does not pollute the root.
 *
 * Why this lives in `src/settings/pagelet/` rather than expanding
 * `src/settings.ts`:
 *  - `settings.ts` is already ~2000 lines and one of the most-changed
 *    files. Isolating Pagelet keeps Track B's diff reviewable, and lets
 *    the future Track C work add wiring without touching this section.
 *  - The Pagelet render function uses the i18n loader; pulling that
 *    into the main settings file would surface JSON imports at the top
 *    of the most-loaded settings module.
 *
 * Pure-function policy:
 *  - `mergePageletSettings` is pure and synchronous so `mergeLoadedSettings`
 *    in `src/settings.ts` can call it during plugin startup without any
 *    DOM / app dependencies. The rendering function is the only side-effecting
 *    surface and lives separately.
 */

import type { App } from "obsidian";

import {
    makePageletTranslator,
    type PageletLocale,
} from "../../locales/pagelet";

// ---------------------------------------------------------------------------
// Persisted shape
// ---------------------------------------------------------------------------

/** Output language preference, mirrors D015 (Auto = follow detection). */
export type PageletOutputLanguageSetting = "auto" | "zh" | "en";

/** Where the Pagelet ribbon icon appears (R4). */
export type PageletRibbonPosition = "default" | "top" | "hidden";

/**
 * 7 persisted Pagelet settings.
 *
 * If you add a field, also:
 *  1. add a default below
 *  2. extend `mergePageletSettings` with a normalizer
 *  3. add the i18n keys to en.json + zh.json
 *  4. render it in `renderPageletSection`
 */
export interface PageletSettings {
    /** Master toggle. Default ON during beta (D013). */
    enabled: boolean;
    /** Vault path for review notes (D010). */
    reviewsFolder: string;
    /** Output language preference (D015). */
    outputLanguage: PageletOutputLanguageSetting;
    /** Ribbon icon position (R4). */
    ribbonPosition: PageletRibbonPosition;
    /** Model temperature 0.0-0.5; default 0.2 (SDD §2.2). */
    temperature: number;
    /** Per-review input cap; default 8000, hard max 32000 (D018). */
    maxInputTokens: number;
    /** Per-review output cap; default 2000, hard max 4000 (D018). */
    maxOutputTokens: number;
}

// ---------------------------------------------------------------------------
// Defaults + constraints
// ---------------------------------------------------------------------------

export const PAGELET_DEFAULTS: Readonly<PageletSettings> = Object.freeze({
    enabled: true,
    reviewsFolder: ".pagelet",
    outputLanguage: "auto",
    ribbonPosition: "default",
    temperature: 0.2,
    maxInputTokens: 8000,
    maxOutputTokens: 2000,
});

/**
 * Bounds for input fields. Centralised so both `mergePageletSettings` and
 * the render function can reference them — and so a future bump (e.g. the
 * Pagelet team raising the output cap) is a single, intentional edit.
 *
 * The maxima come from D018; the minima are 1 (an upper-bound input field
 * with a 0/negative value is always a typo, never a deliberate choice).
 */
export const PAGELET_BOUNDS = Object.freeze({
    temperature: { min: 0, max: 0.5 },
    maxInputTokens: { min: 1, max: 32000 },
    maxOutputTokens: { min: 1, max: 4000 },
});

/**
 * Read-only call limits exposed in the Limits section for transparency,
 * but NOT persisted — D020 froze them. B4 owns the actual rate-limiter
 * that enforces these numbers; this constant is just the UI source.
 */
export const PAGELET_FIXED_CALL_LIMITS = Object.freeze({
    hourly: 10,
    daily: 100,
});

// ---------------------------------------------------------------------------
// Merge / normalize
// ---------------------------------------------------------------------------

/**
 * Pure merge — used by `mergeLoadedSettings` in `src/settings.ts`. Accepts
 * `unknown` because data.json on legacy installs has no `pagelet` field at
 * all, and may have malformed values from old beta sessions.
 *
 * Each field is normalized independently so a corrupt value in one field
 * cannot poison the others. The same per-field defaulting strategy the
 * other PA settings use (Phase 2 deep merge).
 */
export function mergePageletSettings(loaded: unknown): PageletSettings {
    const raw = isRecord(loaded) ? loaded : {};
    return {
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : PAGELET_DEFAULTS.enabled,
        reviewsFolder: normalizeReviewsFolder(raw.reviewsFolder),
        outputLanguage: normalizeOutputLanguage(raw.outputLanguage),
        ribbonPosition: normalizeRibbonPosition(raw.ribbonPosition),
        temperature: normalizeBoundedNumber(
            raw.temperature,
            PAGELET_DEFAULTS.temperature,
            PAGELET_BOUNDS.temperature.min,
            PAGELET_BOUNDS.temperature.max,
        ),
        maxInputTokens: normalizeBoundedInt(
            raw.maxInputTokens,
            PAGELET_DEFAULTS.maxInputTokens,
            PAGELET_BOUNDS.maxInputTokens.min,
            PAGELET_BOUNDS.maxInputTokens.max,
        ),
        maxOutputTokens: normalizeBoundedInt(
            raw.maxOutputTokens,
            PAGELET_DEFAULTS.maxOutputTokens,
            PAGELET_BOUNDS.maxOutputTokens.min,
            PAGELET_BOUNDS.maxOutputTokens.max,
        ),
    };
}

function normalizeReviewsFolder(value: unknown): string {
    if (typeof value !== "string") return PAGELET_DEFAULTS.reviewsFolder;
    const trimmed = value.trim();
    if (trimmed.length === 0) return PAGELET_DEFAULTS.reviewsFolder;
    // Strip leading "/" and "./" so the stored path is always a vault-relative
    // POSIX form — matches how Obsidian's vault.adapter.* functions interpret paths.
    return trimmed.replace(/^\.?\/+/, "").replace(/\/+$/, "");
}

function normalizeOutputLanguage(value: unknown): PageletOutputLanguageSetting {
    if (value === "auto" || value === "zh" || value === "en") return value;
    return PAGELET_DEFAULTS.outputLanguage;
}

function normalizeRibbonPosition(value: unknown): PageletRibbonPosition {
    if (value === "default" || value === "top" || value === "hidden") return value;
    return PAGELET_DEFAULTS.ribbonPosition;
}

function normalizeBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
}

function normalizeBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return fallback;
    const clamped = Math.trunc(parsed);
    if (clamped < min) return min;
    if (clamped > max) return max;
    return clamped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Anything the render fn needs from the host plugin. Defined as a
 * structural type rather than importing PluginManager so this module
 * stays free of the heavy plugin.ts dependency tree (which would drag
 * in main.ts / chat / vss / memory / ... at import time).
 */
export interface PageletSettingsHost {
    app: App;
    settings: { pagelet: PageletSettings };
    saveSettings(): Promise<void> | void;
    /**
     * Optional logger. Renders without verbosity if absent so consumers
     * outside the main plugin (storybook, testing harness) can omit it.
     */
    log?: (...args: unknown[]) => void;
}

/**
 * Minimal Setting / container surface so this file does not pull in the
 * concrete Obsidian Setting class. The actual class is constructed by
 * `renderPageletSection`'s caller (which already lives in the obsidian
 * dependency tree) and passed in via the SettingFactory.
 */
export interface PageletSettingFactory {
    /**
     * Build a Setting-like row anchored to the given parent element.
     * The returned object must implement the chainable Setting API surface
     * used below — Obsidian's `new Setting(parentEl)` satisfies it.
     */
    create(parentEl: HTMLElement): PageletSettingBuilder;
}

export interface PageletSettingBuilder {
    setName(name: string): this;
    setDesc(desc: string): this;
    addToggle(cb: (toggle: PageletToggleHandle) => void): this;
    addText(cb: (text: PageletTextHandle) => void): this;
    addDropdown(cb: (dropdown: PageletDropdownHandle) => void): this;
}

export interface PageletToggleHandle {
    setValue(value: boolean): PageletToggleHandle;
    onChange(cb: (value: boolean) => void | Promise<void>): PageletToggleHandle;
}

export interface PageletTextHandle {
    setPlaceholder(value: string): PageletTextHandle;
    setValue(value: string): PageletTextHandle;
    onChange(cb: (value: string) => void | Promise<void>): PageletTextHandle;
}

export interface PageletDropdownHandle {
    addOption(value: string, text: string): PageletDropdownHandle;
    setValue(value: string): PageletDropdownHandle;
    onChange(cb: (value: string) => void | Promise<void>): PageletDropdownHandle;
}

/**
 * Render the Pagelet section into `parentEl`.
 *
 * The function is intentionally synchronous — onChange handlers either
 * await `saveSettings` or schedule a debounced save (caller's choice).
 * Returning early when `enabled` is false would surprise users who want
 * to toggle it back on without re-opening the tab, so all controls
 * render regardless of the master toggle.
 */
export function renderPageletSection(
    parentEl: HTMLElement,
    host: PageletSettingsHost,
    factory: PageletSettingFactory,
    locale: PageletLocale = "en",
): void {
    const t = makePageletTranslator(locale);
    const settings = host.settings.pagelet;
    const saveOnChange = async (mutator: () => void) => {
        mutator();
        await host.saveSettings();
    };

    // Section heading + Beta callout. Using `createEl` directly so the
    // markup matches existing PA conventions (h2 + p sibling).
    parentEl.createEl("h2", { text: t("pagelet.settings.section.title") });
    parentEl.createEl("p", {
        text: t("pagelet.settings.section.subtitle"),
        cls: "pa-settings-section-desc",
    });
    parentEl.createEl("div", {
        text: t("pagelet.settings.beta.callout"),
        cls: "pa-pagelet-beta-callout",
    });

    // Master toggle. Rendered at the top so a user who only wants to
    // turn Pagelet off doesn't need to scroll past 6 other fields.
    factory.create(parentEl)
        .setName(t("pagelet.settings.enabled.name"))
        .setDesc(t("pagelet.settings.enabled.desc"))
        .addToggle((toggle) =>
            toggle
                .setValue(settings.enabled)
                .onChange((value) => saveOnChange(() => { settings.enabled = value; })));

    // ── General ─────────────────────────────────────────────────────────
    parentEl.createEl("h3", { text: t("pagelet.settings.general.heading") });

    factory.create(parentEl)
        .setName(t("pagelet.settings.reviewsFolder.name"))
        .setDesc(t("pagelet.settings.reviewsFolder.desc"))
        .addText((text) =>
            text
                .setPlaceholder(PAGELET_DEFAULTS.reviewsFolder)
                .setValue(settings.reviewsFolder)
                .onChange((value) => saveOnChange(() => {
                    settings.reviewsFolder = normalizeReviewsFolder(value);
                })));

    factory.create(parentEl)
        .setName(t("pagelet.settings.outputLanguage.name"))
        .setDesc(t("pagelet.settings.outputLanguage.desc"))
        .addDropdown((dropdown) => {
            dropdown
                .addOption("auto", t("pagelet.settings.outputLanguage.option.auto"))
                .addOption("zh", t("pagelet.settings.outputLanguage.option.zh"))
                .addOption("en", t("pagelet.settings.outputLanguage.option.en"))
                .setValue(settings.outputLanguage)
                .onChange((value) => saveOnChange(() => {
                    settings.outputLanguage = normalizeOutputLanguage(value);
                }));
        });

    factory.create(parentEl)
        .setName(t("pagelet.settings.ribbonPosition.name"))
        .setDesc(t("pagelet.settings.ribbonPosition.desc"))
        .addDropdown((dropdown) => {
            dropdown
                .addOption("default", t("pagelet.settings.ribbonPosition.option.default"))
                .addOption("top", t("pagelet.settings.ribbonPosition.option.top"))
                .addOption("hidden", t("pagelet.settings.ribbonPosition.option.hidden"))
                .setValue(settings.ribbonPosition)
                .onChange((value) => saveOnChange(() => {
                    settings.ribbonPosition = normalizeRibbonPosition(value);
                }));
        });

    // ── Model ───────────────────────────────────────────────────────────
    parentEl.createEl("h3", { text: t("pagelet.settings.model.heading") });

    factory.create(parentEl)
        .setName(t("pagelet.settings.temperature.name"))
        .setDesc(t("pagelet.settings.temperature.desc"))
        .addText((text) =>
            text
                .setPlaceholder(PAGELET_DEFAULTS.temperature.toString())
                .setValue(settings.temperature.toString())
                .onChange((value) => saveOnChange(() => {
                    settings.temperature = normalizeBoundedNumber(
                        value,
                        PAGELET_DEFAULTS.temperature,
                        PAGELET_BOUNDS.temperature.min,
                        PAGELET_BOUNDS.temperature.max,
                    );
                })));

    // ── Limits ──────────────────────────────────────────────────────────
    parentEl.createEl("h3", { text: t("pagelet.settings.limits.heading") });

    factory.create(parentEl)
        .setName(t("pagelet.settings.maxInputTokens.name"))
        .setDesc(t("pagelet.settings.maxInputTokens.desc"))
        .addText((text) =>
            text
                .setPlaceholder(PAGELET_DEFAULTS.maxInputTokens.toString())
                .setValue(settings.maxInputTokens.toString())
                .onChange((value) => saveOnChange(() => {
                    settings.maxInputTokens = normalizeBoundedInt(
                        value,
                        PAGELET_DEFAULTS.maxInputTokens,
                        PAGELET_BOUNDS.maxInputTokens.min,
                        PAGELET_BOUNDS.maxInputTokens.max,
                    );
                })));

    factory.create(parentEl)
        .setName(t("pagelet.settings.maxOutputTokens.name"))
        .setDesc(t("pagelet.settings.maxOutputTokens.desc"))
        .addText((text) =>
            text
                .setPlaceholder(PAGELET_DEFAULTS.maxOutputTokens.toString())
                .setValue(settings.maxOutputTokens.toString())
                .onChange((value) => saveOnChange(() => {
                    settings.maxOutputTokens = normalizeBoundedInt(
                        value,
                        PAGELET_DEFAULTS.maxOutputTokens,
                        PAGELET_BOUNDS.maxOutputTokens.min,
                        PAGELET_BOUNDS.maxOutputTokens.max,
                    );
                })));
}

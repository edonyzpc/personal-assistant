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
// reviewsFolder validation
// ---------------------------------------------------------------------------

/**
 * Categorised reasons `normalizeReviewsFolder` may reject an input.
 *
 * `none` is implicit (omitted `error` on the validation result). The other
 * categories map 1:1 to the H-B3.2 / PR #356 B2 prod-gap fixtures: the
 * settings layer is the fail-closed boundary that prevents these from
 * EVER reaching `PaReviewToolProvider.targetConfinement.allowedRoots`.
 *
 * See `docs/write-action-framework-sdd.md` §8.3 for the upstream attacker
 * model these categories defend against.
 */
export type PageletReviewsFolderError =
    | "empty"
    | "too_long"
    | "absolute_path"
    | "drive_letter"
    | "parent_traversal"
    | "obsidian_config"
    | "forbidden_dotfolder"
    | "control_chars"
    | "invisible_chars"
    | "trailing_dot_or_space";

/**
 * Top-level dotfolders beyond `.obsidian` that the framework must never
 * write into. `.git` and `.trash` are Obsidian / Git-shared system folders;
 * `.obsidian.bak` is the conventional backup name some users keep next to
 * `.obsidian`. Kept separate from `obsidian_config` so the user-facing
 * message stays specific (it's not always THE Obsidian config dir).
 *
 * Compared case-folded NFC just like the `.obsidian` check below.
 */
const FORBIDDEN_DOTFOLDER_SEGMENTS = new Set([".git", ".trash", ".obsidian.bak"]);

/**
 * Hard cap on validator input length. 4 KB is well above any realistic
 * vault-relative path (POSIX PATH_MAX is 4096) and stops a pathological
 * input from spending unbounded time in the regex / segment work below.
 * The cap runs after `trim()` so trailing whitespace does not push a
 * benign path over the limit.
 */
const REVIEWS_FOLDER_MAX_LENGTH = 4096;

/**
 * Output shape of `normalizeReviewsFolder`. `value` is always safe to use
 * (fails closed to `PAGELET_DEFAULTS.reviewsFolder` on rejection). `error`
 * is set only when the input was rejected — settings UI surfaces it as an
 * inline message.
 */
export interface PageletReviewsFolderValidation {
    /** Vault-relative, normalized folder. On rejection equals the default. */
    value: string;
    /** Set iff the input was rejected — used to pick the user-visible message. */
    error?: PageletReviewsFolderError;
    /** Echo of the raw input (trimmed view) so the UI can quote it back. */
    input?: string;
}

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
        reviewsFolder: normalizeReviewsFolder(raw.reviewsFolder).value,
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

/**
 * Validate + normalize a user-supplied `reviewsFolder` value.
 *
 * This is the **fail-closed settings boundary** that backs `PaReviewToolProvider`'s
 * `targetConfinement.allowedRoots`. The capability derives its allowlist
 * from `settings.reviewsFolder` directly (see
 * `src/pagelet/pa-review-tool-provider.ts:285-296`), so a misconfigured
 * folder (e.g. `.obsidian/`, `/`, `..`, `C:\…`) would otherwise let the
 * Write Action Framework's Gate 1 accept paths that escape Pagelet's
 * intended sandbox. We block those classes here, **before** the value
 * persists to data.json.
 *
 * On any rejection, the function returns the default folder (`.pagelet`) so
 * the rest of the runtime stays safe even if a caller forgets to inspect
 * `error`. The UI layer is responsible for surfacing the error and reverting
 * the editable text input (see `renderPageletSection`).
 *
 * `PaReviewToolProvider` does NOT call this validator directly — it still
 * resolves the persisted value through `pa-review-file-io.ts`'s sibling
 * `normalizeReviewsFolder`, which trusts that the settings layer already
 * scrubbed forbidden shapes. Keeping the fix here (one boundary) instead
 * of in the capability avoids a per-call branch on every write.
 */
export function normalizeReviewsFolder(value: unknown): PageletReviewsFolderValidation {
    if (typeof value !== "string") {
        // Missing / wrong-type values are coerced silently — they originate
        // from corrupt data.json shapes, not a typed user action, so an
        // inline error would be noise. The merge layer already logs at the
        // boundary if it wants visibility.
        return { value: PAGELET_DEFAULTS.reviewsFolder };
    }

    // Normalize Windows-style backslashes to forward slashes BEFORE any
    // segment-aware check runs. Without this, `.obsidian\plugins` is one
    // opaque segment that bypasses the `.obsidian` guard below, `foo\..\bar`
    // bypasses the parent-traversal guard, and `\\server\share` looks like
    // a single non-absolute segment. Obsidian's vault APIs only speak POSIX
    // paths, so coercing here is both safe and semantically correct.
    const trimmed = value.trim().replace(/\\/g, "/");
    if (trimmed.length === 0) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "empty", input: trimmed };
    }

    // Pathological-length guard. Cheap to reject and stops a degenerate
    // input from spending unbounded time in the regex / segment work below.
    // 4 KB is well above POSIX PATH_MAX (4096) so any realistic vault path
    // fits comfortably.
    if (trimmed.length > REVIEWS_FOLDER_MAX_LENGTH) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "too_long", input: trimmed };
    }

    // Control chars / NUL / DEL — surface BEFORE the strip-and-normalize so
    // the raw byte that tripped the check is visible in `input` if a logger
    // wants it. U+007F (DEL) is grouped with the C0 controls because it is
    // equally hostile to filesystem and terminal display.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "control_chars", input: trimmed };
    }

    // Invisible format characters (Cf category subset commonly used to spoof
    // identifiers): ZWSP/ZWNJ/ZWJ, WJ, BOM/ZWNBSP, LRM/RLM, bidi-isolates.
    // These survive String.prototype.trim and would otherwise let an attacker
    // craft a name like `\u200B.obsidian` that visually reads as `.obsidian`
    // but bypasses the strict segment-equality check below. Rejecting
    // outright is simpler and safer than NFKC-folding; a legitimate folder
    // name never needs a zero-width joiner.
    if (/[\u200b-\u200d\u2060\ufeff\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(trimmed)) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "invisible_chars", input: trimmed };
    }

    // Windows drive letter — must run before any slash normalization so
    // `C:\foo` and `c:/foo` both trip. The check is intentionally narrow
    // (single-letter prefix + colon) so a future user folder literally
    // named `bin:` does not collide.
    if (/^[a-zA-Z]:/.test(trimmed)) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "drive_letter", input: trimmed };
    }

    // Absolute Unix path — Obsidian vaults are always relative; an
    // absolute path almost certainly means the user copy-pasted from a
    // shell or filesystem browser.
    if (trimmed.startsWith("/")) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "absolute_path", input: trimmed };
    }

    // Strip leading "./" and trailing "/" so the stored path is always a
    // vault-relative POSIX form — matches how Obsidian's vault.adapter.*
    // functions interpret paths. The leading `\\?/+` form is intentionally
    // tolerant: `./.pagelet` and `.pagelet` are equivalent for the user.
    const stripped = trimmed.replace(/^\.?\/+/, "").replace(/\/+$/, "");
    if (stripped.length === 0) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "empty", input: trimmed };
    }

    // Parent traversal — any `..` segment escapes the vault root. We
    // tokenise on `/` rather than substring-matching `..` so a literal
    // folder named `..config` (legal) is NOT rejected; only the path
    // segment exactly `..` trips.
    const segments = stripped.split("/");
    if (segments.some((seg) => seg === "..")) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "parent_traversal", input: trimmed };
    }

    // Trailing dot or whitespace in any segment — NTFS silently strips these
    // at the OS layer, so a path like `.obsidian./plugins` would dispatch into
    // the real `.obsidian/plugins` despite the strict `=== ".obsidian"` guard
    // below failing on the literal string `.obsidian.`. Same class of bypass
    // for `.obsidian /plugins` (trailing space). We reject the input before
    // the case-fold comparison gets the chance to mismatch.
    if (segments.some((seg) => /[.\s]$/.test(seg))) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "trailing_dot_or_space", input: trimmed };
    }

    // Obsidian config directory — the framework would otherwise happily
    // write into `.obsidian/plugins/personal-assistant/` if the user (mis)set
    // their folder there. This is the PR #356 B2 production-gap fixture.
    // Checking only `segments[0]` is intentional: a nested folder literally
    // named `.obsidian` (e.g. `notes/.obsidian-cheatsheet`) is harmless; only
    // a top-level `.obsidian` segment collides with Obsidian's config root.
    // Case-fold + NFC the first segment before comparing so `.Obsidian` and
    // `.OBSIDIAN` also trip — default macOS APFS and Windows NTFS are
    // case-insensitive, so a non-folded compare would let those inputs through
    // and the OS would still dispatch the write into the real `.obsidian/`.
    const firstSegmentFolded = segments[0].normalize("NFC").toLowerCase();
    if (firstSegmentFolded === ".obsidian") {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "obsidian_config", input: trimmed };
    }

    // Other top-level dotfolders that must never be written into. Same
    // case-fold + NFC rationale as the `.obsidian` check above. Kept in
    // a separate guard so the error message can be specific (".git" /
    // ".trash" / ".obsidian.bak" don't share the "Obsidian config" framing).
    if (FORBIDDEN_DOTFOLDER_SEGMENTS.has(firstSegmentFolded)) {
        return { value: PAGELET_DEFAULTS.reviewsFolder, error: "forbidden_dotfolder", input: trimmed };
    }

    return { value: stripped };
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

/**
 * Exhaustive map from validator error to its i18n key. Replaces a runtime
 * `t(\`...error.${result.error}\`)` template lookup: any future variant added
 * to {@link PageletReviewsFolderError} fails compile here unless EN/ZH labels
 * are added, so the UI can never silently render a missing-translation
 * placeholder for a new rejection category.
 */
const REVIEWS_FOLDER_ERROR_I18N_KEY: Record<PageletReviewsFolderError, string> = {
    empty: "pagelet.settings.reviewsFolder.error.empty",
    too_long: "pagelet.settings.reviewsFolder.error.too_long",
    absolute_path: "pagelet.settings.reviewsFolder.error.absolute_path",
    drive_letter: "pagelet.settings.reviewsFolder.error.drive_letter",
    parent_traversal: "pagelet.settings.reviewsFolder.error.parent_traversal",
    obsidian_config: "pagelet.settings.reviewsFolder.error.obsidian_config",
    forbidden_dotfolder: "pagelet.settings.reviewsFolder.error.forbidden_dotfolder",
    control_chars: "pagelet.settings.reviewsFolder.error.control_chars",
    invisible_chars: "pagelet.settings.reviewsFolder.error.invisible_chars",
    trailing_dot_or_space: "pagelet.settings.reviewsFolder.error.trailing_dot_or_space",
};

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

    // Track the last-known valid folder so a rejected edit can revert both
    // the persisted value AND the visible text input. Seeded with whatever
    // mergePageletSettings already accepted at load time.
    let lastValidReviewsFolder = settings.reviewsFolder;
    let reviewsFolderTextHandle: PageletTextHandle | undefined;
    factory.create(parentEl)
        .setName(t("pagelet.settings.reviewsFolder.name"))
        .setDesc(t("pagelet.settings.reviewsFolder.desc"))
        .addText((text) => {
            reviewsFolderTextHandle = text;
            text
                .setPlaceholder(PAGELET_DEFAULTS.reviewsFolder)
                .setValue(settings.reviewsFolder)
                .onChange((value) => saveOnChange(() => {
                    const result = normalizeReviewsFolder(value);
                    if (result.error) {
                        // Fail-closed: keep the previously valid folder so the
                        // capability's `allowedRoots` (derived from this value)
                        // never widens to a forbidden root. Surface the reason
                        // inline + revert the visible input so the user sees
                        // their edit was not accepted.
                        reviewsFolderErrorEl.textContent = t(REVIEWS_FOLDER_ERROR_I18N_KEY[result.error]);
                        settings.reviewsFolder = lastValidReviewsFolder;
                        reviewsFolderTextHandle?.setValue(lastValidReviewsFolder);
                        return;
                    }
                    reviewsFolderErrorEl.textContent = "";
                    settings.reviewsFolder = result.value;
                    lastValidReviewsFolder = result.value;
                    // If we trimmed leading/trailing slashes, reflect the
                    // normalised form in the visible input so the user sees
                    // what was stored.
                    if (value !== result.value) {
                        reviewsFolderTextHandle?.setValue(result.value);
                    }
                }));
        });
    // Inline error message sits IMMEDIATELY below the input so a rejection
    // surfaces right where the user just typed. Kept empty until a
    // validator rejection fires; an empty `textContent` collapses the row
    // visually so non-error state does not look like a layout shift.
    const reviewsFolderErrorEl = parentEl.createEl("div", {
        cls: "pa-pagelet-settings-error",
    });

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

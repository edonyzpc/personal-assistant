/* Copyright 2023 edonyzpc */

/**
 * Track B · B3 unit tests for the Pagelet settings module.
 *
 * Coverage matrix (mapped to SDD §10.3 + decisions D008-D010, D013, D015,
 * D018, D020):
 *  - `mergePageletSettings`: per-field normalization. The function MUST be
 *    tolerant of every shape data.json can have on a legacy / corrupt install
 *    (undefined / missing key / wrong type / out-of-range number / invalid
 *    enum string). The 7 fields are independent — one bad value cannot
 *    poison the others.
 *  - `renderPageletSection`: ensure all 7 settings render exactly once and
 *    in the SDD §10.3 order, that the i18n translator is consulted (we pass
 *    a stub so we can spy on calls), and that onChange handlers route through
 *    `saveSettings`.
 *  - Read-only call limits: D020 froze them; the constant exists for B4's
 *    UI to display but must not become persisted state.
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    PAGELET_BOUNDS,
    PAGELET_DEFAULTS,
    PAGELET_FIXED_CALL_LIMITS,
    mergePageletSettings,
    normalizeReviewsFolder,
    renderPageletSection,
    type PageletReviewsFolderError,
    type PageletSettings,
    type PageletSettingBuilder,
    type PageletSettingFactory,
    type PageletSettingsHost,
} from "../src/settings/pagelet";
import { makePageletTranslator } from "../src/locales/pagelet";

// ---------------------------------------------------------------------------
// Tiny stub DOM + Setting harness. We intentionally do NOT pull in the
// settings.test.ts `MockDomNode`/`MockContainerEl` — the Pagelet tests should
// stand on their own so a refactor of either file doesn't ripple.
// ---------------------------------------------------------------------------

interface StubNode {
    tagName: string;
    text?: string;
    cls?: string;
    children: StubNode[];
    createEl: (tag: string, options?: { text?: string; cls?: string }) => StubNode;
}

function makeStubNode(tagName: string): StubNode {
    const node: StubNode = {
        tagName,
        children: [],
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
    name?: string;
    desc?: string;
    toggleValue?: boolean;
    toggleOnChange?: (value: boolean) => unknown;
    textValue?: string;
    textPlaceholder?: string;
    textOnChange?: (value: string) => unknown;
    dropdownValue?: string;
    dropdownOptions: Array<{ value: string; text: string }>;
    dropdownOnChange?: (value: string) => unknown;
}

function makeStubFactory(): { factory: PageletSettingFactory; rows: StubSetting[] } {
    const rows: StubSetting[] = [];
    const factory: PageletSettingFactory = {
        create(): PageletSettingBuilder {
            const row: StubSetting = { dropdownOptions: [] };
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
                            row.toggleValue = value;
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

function makeHost(overrides?: Partial<PageletSettings>): {
    host: PageletSettingsHost;
    save: jest.Mock;
} {
    const save = jest.fn(async () => { /* noop */ });
    const settings: PageletSettings = { ...PAGELET_DEFAULTS, ...overrides };
    const host: PageletSettingsHost = {
        // Cast: tests don't need a real Obsidian App and we don't want to
        // depend on Obsidian here.
        app: {} as unknown as PageletSettingsHost["app"],
        settings: { pagelet: settings },
        saveSettings: save,
    };
    return { host, save };
}

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
        expect(mergePageletSettings(undefined)).toEqual({ ...PAGELET_DEFAULTS });
        expect(mergePageletSettings(null)).toEqual({ ...PAGELET_DEFAULTS });
    });

    it("returns defaults when input is not an object", () => {
        expect(mergePageletSettings("garbage")).toEqual({ ...PAGELET_DEFAULTS });
        expect(mergePageletSettings(42)).toEqual({ ...PAGELET_DEFAULTS });
        expect(mergePageletSettings([{ enabled: false }])).toEqual({ ...PAGELET_DEFAULTS });
    });

    it("preserves well-formed values", () => {
        const persisted: PageletSettings = {
            enabled: false,
            reviewsFolder: "reviews/pagelet",
            outputLanguage: "zh",
            ribbonPosition: "hidden",
            temperature: 0.4,
            maxInputTokens: 12000,
            maxOutputTokens: 3000,
        };
        expect(mergePageletSettings(persisted)).toEqual(persisted);
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
// documented in `docs/write-action-framework-sdd.md` §8.3.
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
    it("renders all 7 settings exactly once, in SDD §10.3 order", () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        // 1 master toggle + 3 General + 1 Model + 2 Limits = 7 rows total.
        expect(rows).toHaveLength(7);
        expect(rows.map((r) => r.name)).toEqual([
            "Enable Pagelet",
            "Reviews folder",
            "Output language",
            "Ribbon icon",
            "Temperature",
            "Max input tokens",
            "Max output tokens",
        ]);
    });

    it("emits the section heading, subtitle, beta callout, 3 group headings, and the reviewsFolder error sibling", () => {
        const parent = makeStubNode("div");
        const { factory } = makeStubFactory();
        const { host } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        // h2 + p + div (beta callout) + h3 (General) + div (reviewsFolder
        // error sibling, kept empty until a validator rejection fires) +
        // h3 (Model) + h3 (Limits).
        const headings = parent.children.filter((c) => c.tagName.startsWith("h") || c.tagName === "p" || c.tagName === "div");
        expect(headings.map((h) => h.tagName)).toEqual([
            "h2", "p", "div", "h3", "div", "h3", "h3",
        ]);
        expect(headings[0].text).toBe("Pagelet");
        // The beta callout must be visible from the moment Pagelet ships
        // (D013) — it's the channel we collect feedback through.
        expect(headings[2].text).toContain("Beta");
        expect(headings[2].cls).toBe("pa-pagelet-beta-callout");
        // The reviewsFolder error sibling must exist with the expected
        // class so styles target it; absence here means the inline error
        // message has nowhere to render and rejections become silent.
        const errorEl = parent.children.find(
            (c) => c.tagName === "div" && c.cls === "pa-pagelet-settings-error",
        );
        expect(errorEl).toBeDefined();
        // Initially empty so non-error state does not visually shift.
        expect(errorEl?.text).toBeUndefined();
    });

    it("uses zh dictionary when locale is zh", () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "zh");

        expect(rows[0].name).toBe("启用拾页");
        expect(rows[1].name).toBe("审阅笔记目录");
        expect(parent.children[0].text).toBe("拾页");
    });

    it("seeds toggle/dropdown/text values from current settings", () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost({
            enabled: false,
            reviewsFolder: "custom/path",
            outputLanguage: "zh",
            ribbonPosition: "hidden",
            temperature: 0.35,
            maxInputTokens: 4096,
            maxOutputTokens: 1024,
        });

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        expect(rows[0].toggleValue).toBe(false);
        expect(rows[1].textValue).toBe("custom/path");
        expect(rows[2].dropdownValue).toBe("zh");
        expect(rows[3].dropdownValue).toBe("hidden");
        expect(rows[4].textValue).toBe("0.35");
        expect(rows[5].textValue).toBe("4096");
        expect(rows[6].textValue).toBe("1024");
    });

    it("populates dropdown option lists with both value and label", () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        expect(rows[2].dropdownOptions.map((o) => o.value)).toEqual(["auto", "zh", "en"]);
        expect(rows[3].dropdownOptions.map((o) => o.value)).toEqual([
            "default",
            "hidden",
        ]);
        // Spot-check that labels are i18n-resolved English strings, not key
        // names — a regression here means the translator wasn't wired.
        expect(rows[2].dropdownOptions[0].text).toBe("Auto (follow note language)");
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

    it("normalizes reviewsFolder via the same merger on text edit", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host, save } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");
        await rows[1].textOnChange!("./notes/reviews/");

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
        expect(rows[1].textValue).toBe("notes/reviews");

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
        //   4. `saveSettings` still ran (the merger is forgiving — settings
        //      may have changed adjacent fields elsewhere).
        await rows[1].textOnChange!(".obsidian/plugins/personal-assistant");

        expect(host.settings.pagelet.reviewsFolder).toBe("notes/reviews");
        expect(rows[1].textValue).toBe("notes/reviews");
        // Compare to the resolved EN translation rather than a literal
        // substring so the assertion stays correct if/when the message copy
        // changes. The point is "the obsidian_config category surfaced",
        // not "the message happens to spell `.obsidian`".
        expect(errorEl?.textContent).toBe(
            makePageletTranslator("en")("pagelet.settings.reviewsFolder.error.obsidian_config"),
        );
        expect(save).toHaveBeenCalledTimes(1);

        // After a clean edit the error must clear so a previous rejection
        // is not stuck on screen forever.
        await rows[1].textOnChange!("clean/folder");
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

        await rows[1].textOnChange!(".git/pagelet");
        expect(host.settings.pagelet.reviewsFolder).toBe("notes/reviews");
        expect(rows[1].textValue).toBe("notes/reviews");
        expect(errorEl?.textContent).toBe(
            makePageletTranslator("en")("pagelet.settings.reviewsFolder.error.forbidden_dotfolder"),
        );

        // too_long path through the same renderer surface.
        await rows[1].textOnChange!("x".repeat(4097));
        expect(host.settings.pagelet.reviewsFolder).toBe("notes/reviews");
        expect(errorEl?.textContent).toBe(
            makePageletTranslator("en")("pagelet.settings.reviewsFolder.error.too_long"),
        );
    });

    it("clamps out-of-range temperature/token edits", async () => {
        const parent = makeStubNode("div");
        const { factory, rows } = makeStubFactory();
        const { host } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        await rows[4].textOnChange!("99"); // temperature
        expect(host.settings.pagelet.temperature).toBe(PAGELET_BOUNDS.temperature.max);

        await rows[5].textOnChange!("999999"); // maxInputTokens
        expect(host.settings.pagelet.maxInputTokens).toBe(PAGELET_BOUNDS.maxInputTokens.max);

        await rows[6].textOnChange!("-1"); // maxOutputTokens
        expect(host.settings.pagelet.maxOutputTokens).toBe(PAGELET_BOUNDS.maxOutputTokens.min);
    });
});

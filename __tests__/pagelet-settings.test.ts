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
    renderPageletSection,
    type PageletSettings,
    type PageletSettingBuilder,
    type PageletSettingFactory,
    type PageletSettingsHost,
} from "../src/settings/pagelet";

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
        expect(mergePageletSettings({ reviewsFolder: "/notes" }).reviewsFolder).toBe("notes");
        expect(mergePageletSettings({ reviewsFolder: "notes//" }).reviewsFolder).toBe("notes");
        expect(mergePageletSettings({ reviewsFolder: "  " }).reviewsFolder).toBe(
            PAGELET_DEFAULTS.reviewsFolder,
        );
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
        for (const v of ["default", "top", "hidden"] as const) {
            expect(mergePageletSettings({ ribbonPosition: v }).ribbonPosition).toBe(v);
        }
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
            "Ribbon position",
            "Temperature",
            "Max input tokens",
            "Max output tokens",
        ]);
    });

    it("emits the section heading, subtitle, beta callout, and 3 group headings", () => {
        const parent = makeStubNode("div");
        const { factory } = makeStubFactory();
        const { host } = makeHost();

        renderPageletSection(parent as unknown as HTMLElement, host, factory, "en");

        // h2 + p + div (beta callout) + 3× h3 (General/Model/Limits).
        const headings = parent.children.filter((c) => c.tagName.startsWith("h") || c.tagName === "p" || c.tagName === "div");
        expect(headings.map((h) => h.tagName)).toEqual([
            "h2", "p", "div", "h3", "h3", "h3",
        ]);
        expect(headings[0].text).toBe("Pagelet");
        // The beta callout must be visible from the moment Pagelet ships
        // (D013) — it's the channel we collect feedback through.
        expect(headings[2].text).toContain("Beta");
        expect(headings[2].cls).toBe("pa-pagelet-beta-callout");
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
            "top",
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

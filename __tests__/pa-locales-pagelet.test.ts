/* Copyright 2023 edonyzpc */

/**
 * Track B · B3 unit tests for the Pagelet i18n + language-detection layer.
 *
 * Coverage matrix (mapped to SDD §8 + D014/D015/D017):
 *  - EN/ZH parity: a single source of truth (EN) means ZH must be a 1:1
 *    superset of keys. Drift here ships untranslated UI to production.
 *  - `pageletT` resolution: locale hit, EN fallback, key fallback, param
 *    interpolation — the four behaviours every caller relies on.
 *  - `detectNoteLanguage`: edge cases that the 30% CJK regex must classify
 *    deterministically (D015 "ratio > 0.3 判中文").
 *  - `getPageletUiLanguage`: D017 says UI language follows Obsidian's i18n
 *    hook, with EN as the no-hook fallback. Test both branches explicitly.
 */

import { describe, expect, it, afterEach } from "@jest/globals";

import {
    PAGELET_LOCALE_RESOURCES,
    PAGELET_SUPPORTED_LOCALES,
    diffPageletLocaleAgainstEn,
    makePageletTranslator,
    pageletT,
} from "../src/locales/pagelet";
import {
    PAGELET_ZH_RATIO_THRESHOLD,
    detectNoteLanguage,
    getPageletUiLanguage,
} from "../src/locales/pagelet/language-detect";

describe("pageletT lookup", () => {
    it("returns the locale-specific string when the key exists", () => {
        expect(pageletT("pagelet.mascot.idle", "en")).toBe("Pagelet is watching.");
        // Use a key whose ZH translation differs from EN — picking the brand
        // string also guards the 拾页 brand decision in D001.
        expect(pageletT("pagelet.settings.section.title", "zh")).toBe("拾页");
    });

    it("falls back to EN when the locale dictionary lacks a key", () => {
        // Construct a key that exists in EN but not ZH would require mutating
        // the frozen dictionary — instead, route through an unknown locale to
        // exercise the same fallback path. The behaviour is identical: when
        // the requested dict misses, EN wins.
        const result = pageletT(
            "pagelet.settings.beta.callout",
            "unknown" as unknown as "en",
        );
        expect(result).toBe(
            "Pagelet is in Beta. Suggestions may be imperfect — your feedback helps us improve.",
        );
    });

    it("falls back to the explicit fallback when both dictionaries lack a key", () => {
        expect(
            pageletT("pagelet.does.not.exist", "en", undefined, "boom"),
        ).toBe("boom");
    });

    it("returns the key itself when no fallback is provided", () => {
        // Surfacing the literal key keeps the regression loud and greppable
        // in dev rather than rendering as silent empty UI.
        expect(pageletT("pagelet.totally.missing", "en")).toBe("pagelet.totally.missing");
    });

    it("interpolates {placeholders} from params", () => {
        expect(
            pageletT("pagelet.cost.estimate", "en", { usd: "$0.04" }),
        ).toBe("Estimated cost: $0.04");
    });

    it("leaves unknown placeholders intact instead of substituting undefined", () => {
        const result = pageletT(
            "pagelet.cost.estimate",
            "en",
            { other: "ignored" },
        );
        // Untouched template better than "Estimated cost: undefined".
        expect(result).toContain("{usd}");
    });

    it("coerces numeric params via String()", () => {
        expect(
            pageletT("pagelet.cost.estimate", "en", { usd: 0.04 as unknown as string }),
        ).toBe("Estimated cost: 0.04");
    });
});

describe("makePageletTranslator", () => {
    it("binds the locale once for ergonomic repeat lookups", () => {
        const tEn = makePageletTranslator("en");
        const tZh = makePageletTranslator("zh");
        expect(tEn("pagelet.mascot.idle")).toBe("Pagelet is watching.");
        expect(tZh("pagelet.mascot.idle")).toBe("拾页在静静看着。");
    });

    it("forwards params + fallback to the underlying translator", () => {
        const t = makePageletTranslator("en");
        expect(t("pagelet.cost.estimate", { usd: "$1" })).toBe("Estimated cost: $1");
        expect(t("pagelet.missing.key", undefined, "default")).toBe("default");
    });
});

describe("EN/ZH key parity", () => {
    it("ships exactly two locales", () => {
        expect([...PAGELET_SUPPORTED_LOCALES]).toEqual(["en", "zh"]);
        expect(Object.keys(PAGELET_LOCALE_RESOURCES)).toEqual(["en", "zh"]);
    });

    it("has ZH covering every EN key with no orphans", () => {
        const { missing, orphan } = diffPageletLocaleAgainstEn("zh");
        // A missing key means a user sees English text in a Chinese UI.
        // An orphan means a translator typo'd a key that the codebase never
        // looks up — silent rot.
        expect(missing).toEqual([]);
        expect(orphan).toEqual([]);
    });

    it("never returns an empty string for any EN key (sanity)", () => {
        for (const [key, value] of Object.entries(PAGELET_LOCALE_RESOURCES.en)) {
            expect(typeof value).toBe("string");
            expect(value.length).toBeGreaterThan(0);
            // Defensive: catches "  " spaces-only translations early.
            expect(value.trim().length).toBeGreaterThan(0);
            // Repeat for ZH so the trim/empty assertion catches both.
            const zhValue = PAGELET_LOCALE_RESOURCES.zh[key];
            expect(typeof zhValue).toBe("string");
            expect(zhValue.trim().length).toBeGreaterThan(0);
        }
    });

    it("freezes the locale resources to prevent at-runtime mutation", () => {
        // The dictionary is shared module-global state; if any caller mutates
        // it, every subsequent lookup is poisoned. Object.freeze is the
        // cheapest insurance.
        expect(Object.isFrozen(PAGELET_LOCALE_RESOURCES)).toBe(true);
        expect(Object.isFrozen(PAGELET_LOCALE_RESOURCES.en)).toBe(true);
        expect(Object.isFrozen(PAGELET_LOCALE_RESOURCES.zh)).toBe(true);
    });
});

describe("detectNoteLanguage", () => {
    it("classifies pure Chinese as zh", () => {
        expect(detectNoteLanguage("这是一个纯中文笔记，没有英文。")).toBe("zh");
    });

    it("classifies pure English as en", () => {
        expect(detectNoteLanguage("This is an English-only note.")).toBe("en");
    });

    it("classifies mostly-Chinese with a sprinkle of English as zh", () => {
        // 中文字符占比远高于 30%，英文字符存在但不主导。
        const text = "今天用 ChatGPT 写了一段关于产品策略的笔记，重点关注定位。";
        expect(detectNoteLanguage(text)).toBe("zh");
    });

    it("classifies mostly-English with a Chinese name as en", () => {
        // Chinese chars present but ratio well below 30%.
        const text = "Tea (茶) is a popular beverage with a long history across continents.";
        expect(detectNoteLanguage(text)).toBe("en");
    });

    it("classifies symbol/digit-only strings as en (fallback)", () => {
        expect(detectNoteLanguage("12345 !@#$% +-=/?")).toBe("en");
    });

    it("treats empty and whitespace-only as en (no information)", () => {
        expect(detectNoteLanguage("")).toBe("en");
        expect(detectNoteLanguage("   \n\t  ")).toBe("en");
    });

    it("treats non-string defensively as en", () => {
        expect(detectNoteLanguage(undefined)).toBe("en");
        expect(detectNoteLanguage(null)).toBe("en");
        expect(detectNoteLanguage(123 as unknown)).toBe("en");
    });

    it("respects the 30% threshold boundary exactly", () => {
        // 10 chars: 4 Chinese (40%), 6 English → over threshold → zh.
        expect(detectNoteLanguage("中文中文abcdef")).toBe("zh");
        // 10 chars: 3 Chinese (30%) — equal to the threshold, NOT over → en.
        expect(detectNoteLanguage("中文中abcdefg")).toBe("en");
    });

    it("documents the threshold as a named constant (D015 reference)", () => {
        // If somebody bumps the threshold, this test fails loudly so the
        // bump is intentional and reviewable rather than a silent drift.
        expect(PAGELET_ZH_RATIO_THRESHOLD).toBe(0.3);
    });
});

describe("getPageletUiLanguage", () => {
    afterEach(() => {
        const g = globalThis as unknown as {
            window?: unknown;
            moment?: unknown;
            i18next?: unknown;
        };
        delete g.window;
        delete g.moment;
        delete g.i18next;
    });

    it("returns en when no window/moment/i18next globals are available", () => {
        expect(getPageletUiLanguage()).toBe("en");
    });

    it("prefers window.i18next.language when present", () => {
        (globalThis as unknown as { window: unknown }).window = {
            i18next: { language: "zh-CN" },
        };
        expect(getPageletUiLanguage()).toBe("zh");
    });

    it("falls back to moment.locale() when i18next is unset", () => {
        (globalThis as unknown as { window: unknown }).window = {
            moment: { locale: () => "zh-cn" },
        };
        expect(getPageletUiLanguage()).toBe("zh");
    });

    it("returns en when locale strings are not recognized", () => {
        (globalThis as unknown as { window: unknown }).window = {
            i18next: { language: "ja" },
        };
        // ja is neither zh nor en — fall back to en per D014 ("中+英双语 day 1").
        expect(getPageletUiLanguage()).toBe("en");
    });

    it("treats en-US / en_GB etc. as en", () => {
        (globalThis as unknown as { window: unknown }).window = {
            i18next: { language: "en-US" },
        };
        expect(getPageletUiLanguage()).toBe("en");
    });

    it("survives a moment.locale() that throws", () => {
        (globalThis as unknown as { window: unknown }).window = {
            moment: {
                locale: () => {
                    throw new Error("user-installed stub blew up");
                },
            },
        };
        // No throw, just the EN fallback.
        expect(getPageletUiLanguage()).toBe("en");
    });
});

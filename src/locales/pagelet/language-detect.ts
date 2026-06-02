/* Copyright 2023 edonyzpc */

/**
 * Pagelet — note language detection.
 *
 * Spec source: `docs/review-assistant-sdd.md` §8.1 + D015.
 *
 * The detector exists for two reasons:
 *  1. Stamp `detected_language` on every review input so the structured
 *     output can echo it back (validated by `PageletReviewInputSchema`).
 *  2. Drive the "Auto" `pagelet.outputLanguage` setting (D015 C bottom).
 *
 * Why a regex, not a real tokenizer:
 *  - Pagelet ships in an Obsidian plugin bundle; a tokenizer would dwarf
 *    every other dependency. The 30% threshold from D015 is empirically
 *    good enough for the "zh vs en" binary choice we actually need.
 *  - The detector NEVER inflates beyond two languages — adding ja/ko/etc.
 *    later means designing a different API; do not bolt extra branches on.
 */

export type PageletDetectedLanguage = "zh" | "en";

/**
 * 30% threshold matches D015 ("ratio > 0.3 判中文"). Frozen as a named
 * constant so a future bump is a single, intentional edit instead of
 * scattered magic numbers.
 */
export const PAGELET_ZH_RATIO_THRESHOLD = 0.3;

/**
 * Unicode CJK Unified Ideographs range — the same span the SDD spells as
 * `[一-鿿]` (U+4E00–U+9FFF). Using `\u`-escapes keeps the source ASCII so
 * that editors / diff viewers in EN locale render it without surprises.
 *
 * We deliberately do NOT include extension blocks (Ext A/B/...) or fullwidth
 * punctuation. The goal is "mostly Han characters?", not exhaustive CJK
 * coverage — a note dominated by symbols/digits should fall back to EN.
 */
const CJK_REGEX = /[一-鿿]/g;

/**
 * Map raw text to "zh" / "en".
 *
 * Special cases (in order):
 *  - empty / whitespace-only → "en" (no information to commit; EN is the
 *    safer fallback for the rest of the pipeline since system prompts are EN)
 *  - non-string input → "en" (defensive; callers should pass strings, but a
 *    malformed call should not crash the caller)
 *  - any content → ratio of CJK chars over total length; if > 30%, "zh"
 *
 * Reading the same text through `text.length` (NOT `[...text].length`) is
 * deliberate: we want the same denominator the byte-level regex counts
 * against. Surrogate pairs would over-count in `[...text]` and skew the
 * ratio downward for notes with emoji.
 */
export function detectNoteLanguage(text: unknown): PageletDetectedLanguage {
    if (typeof text !== "string" || text.length === 0) return "en";
    const trimmed = text.trim();
    if (trimmed.length === 0) return "en";

    const matches = text.match(CJK_REGEX);
    const cjkCount = matches?.length ?? 0;
    // Denominator is the raw length, not the trimmed length: the caller's
    // perception of "this note is mostly Chinese" includes whitespace and
    // markdown punctuation. Trimming would let a few CJK chars in a long
    // English note flip the classification, which is the opposite of D015.
    const ratio = cjkCount / Math.max(1, text.length);
    return ratio > PAGELET_ZH_RATIO_THRESHOLD ? "zh" : "en";
}

/**
 * UI language for mascot / settings / commands copy (D017 + D014).
 *
 * Strategy:
 *  - Prefer Obsidian's i18n hook (`window.i18next.language` / `moment.locale()`)
 *    when present so the user's existing Obsidian language choice drives
 *    Pagelet copy automatically.
 *  - Fall back to "en" if no hook is reachable (tests, non-DOM contexts).
 *
 * Returns one of "zh" | "en" because that's all the Pagelet bundle ships;
 * other Obsidian locales fall back to EN per D014 ("中+英双语 day 1").
 */
export function getPageletUiLanguage(): PageletDetectedLanguage {
    if (typeof globalThis === "undefined") return "en";
    const g = globalThis as unknown as {
        window?: { i18next?: { language?: unknown }; moment?: { locale?: () => unknown } };
        moment?: { locale?: () => unknown };
        i18next?: { language?: unknown };
    };
    // 1) Obsidian exposes i18next on window in desktop / mobile builds.
    const i18nLang = readLanguageString(g.window?.i18next?.language ?? g.i18next?.language);
    if (i18nLang) return i18nLang;
    // 2) Moment.locale is set by Obsidian when changing app language; treat
    //    it as a secondary hint.
    const momentLocale =
        readLanguageString(safeCallLocale(g.window?.moment))
        ?? readLanguageString(safeCallLocale(g.moment));
    if (momentLocale) return momentLocale;
    return "en";
}

function readLanguageString(value: unknown): PageletDetectedLanguage | null {
    if (typeof value !== "string" || value.length === 0) return null;
    const lower = value.toLowerCase();
    if (lower === "zh" || lower.startsWith("zh-") || lower.startsWith("zh_")) {
        return "zh";
    }
    if (lower === "en" || lower.startsWith("en-") || lower.startsWith("en_")) {
        return "en";
    }
    return null;
}

function safeCallLocale(moment: { locale?: () => unknown } | undefined): unknown {
    if (!moment || typeof moment.locale !== "function") return undefined;
    try {
        return moment.locale();
    } catch {
        // moment.locale() should never throw, but the global may be a
        // user-installed stub that does. Don't crash UI bootstrap.
        return undefined;
    }
}

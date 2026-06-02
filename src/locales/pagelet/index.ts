/* Copyright 2023 edonyzpc */

/**
 * Pagelet — i18n loader.
 *
 * Spec source: `docs/review-assistant-sdd.md` §8 (D014 / D017).
 *
 * What this module owns:
 *  - The flat dictionary shape (`pagelet.<group>.<name>` keys).
 *  - Lookup with EN fallback when a key is missing in the requested locale.
 *  - The single source of truth for which UI / mascot / error strings
 *    exist (English source dictionary is the authoritative schema; ZH is
 *    asserted against it in __tests__/pa-locales-pagelet.test.ts so a
 *    missing translation is caught at CI, not at runtime).
 *
 * What this module DOES NOT own:
 *  - Note-content language detection — see `./language-detect.ts`. UI
 *    language and note language are deliberately separated so a user
 *    writing English notes in a Chinese-language Obsidian gets ZH UI
 *    chrome AND EN review output, per D017 and D015 respectively.
 *  - The system-prompt copy itself — that lives in `pa-review-schemas.ts`
 *    because it is consumed by the LLM (not by humans) and is part of the
 *    schema contract, not the translation table.
 *
 * Why JSON files (not TS literals):
 *  - Translators / external tooling can edit JSON without TS knowledge.
 *  - JSON enforces "no logic in locale data" by construction.
 *  - esbuild's default JSON loader bundles them into main.js, so there's
 *    no runtime fetch cost.
 */

import enMessagesRaw from "./en.json";
import zhMessagesRaw from "./zh.json";
import {
    detectNoteLanguage,
    getPageletUiLanguage,
    PAGELET_ZH_RATIO_THRESHOLD,
    type PageletDetectedLanguage,
} from "./language-detect";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Locale codes Pagelet ships with. Keep this in lock-step with
 * `PAGELET_LANGUAGE_CODES` in `pa-review-schemas.ts`; the two arrays exist
 * separately on purpose:
 *   - schemas: validated at the LLM boundary, must stay strict.
 *   - locales: the set of dictionaries we actually have on disk.
 * If they ever diverge, the check in `assertLocaleParity()` will catch it.
 */
export const PAGELET_SUPPORTED_LOCALES = ["en", "zh"] as const;
export type PageletLocale = (typeof PAGELET_SUPPORTED_LOCALES)[number];

/** Frozen view of a single locale's dictionary (flat key → string map). */
export type PageletMessages = Readonly<Record<string, string>>;

/** Key set is whatever's in EN (the canonical source). */
export type PageletMessageKey = keyof typeof enMessagesRaw;

// ---------------------------------------------------------------------------
// Resource table
// ---------------------------------------------------------------------------

/**
 * Map locale code → dictionary. Frozen so consumers cannot mutate the
 * shared instance (which would corrupt every subsequent lookup). Tests
 * that need a "language X has key Y" assertion should index this directly
 * rather than calling `pageletT`, which silently falls back to EN.
 */
export const PAGELET_LOCALE_RESOURCES: Readonly<Record<PageletLocale, PageletMessages>> = Object.freeze({
    en: Object.freeze({ ...enMessagesRaw } as PageletMessages),
    zh: Object.freeze({ ...zhMessagesRaw } as PageletMessages),
});

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Translate a key for the given locale.
 *
 * Resolution order:
 *  1. requested locale's dictionary
 *  2. EN dictionary (canonical)
 *  3. caller-provided `fallback` argument (if any)
 *  4. the key itself (so a missing key surfaces as visible debug text in
 *     development rather than rendering as an empty string)
 *
 * `params` interpolates `{name}` placeholders in the resolved value.
 * Interpolation is intentionally limited to flat string substitution —
 * no nested keys, no plural forms, no rich text. Pagelet copy is short
 * enough that anything more elaborate is over-engineering and would
 * smuggle locale-specific grammar into the dictionary keys.
 */
export function pageletT(
    key: PageletMessageKey | string,
    locale: PageletLocale = "en",
    params?: Readonly<Record<string, string | number>>,
    fallback?: string,
): string {
    const dict = PAGELET_LOCALE_RESOURCES[locale] ?? PAGELET_LOCALE_RESOURCES.en;
    const raw =
        dict[key as string]
        ?? PAGELET_LOCALE_RESOURCES.en[key as string]
        ?? fallback
        ?? (key as string);
    if (!params) return raw;
    return interpolate(raw, params);
}

/**
 * Curry helper: bind a locale once, get back a translator. Useful in
 * render functions that look up many keys in a row — both reduces noise
 * AND keeps the locale lookup at the call site so tests can swap it.
 */
export function makePageletTranslator(locale: PageletLocale): (
    key: PageletMessageKey | string,
    params?: Readonly<Record<string, string | number>>,
    fallback?: string,
) => string {
    return (key, params, fallback) => pageletT(key, locale, params, fallback);
}

// ---------------------------------------------------------------------------
// Parity guard
// ---------------------------------------------------------------------------

export interface PageletLocaleParity {
    /** Keys present in EN but missing from `locale`. */
    missing: string[];
    /** Keys present in `locale` but absent from EN (likely typos). */
    orphan: string[];
}

/**
 * Compare the requested locale against EN (the canonical source) and
 * return missing / orphan key lists. Tests use this to fail loudly on
 * drift; render code never needs to call it.
 */
export function diffPageletLocaleAgainstEn(locale: PageletLocale): PageletLocaleParity {
    const enKeys = Object.keys(PAGELET_LOCALE_RESOURCES.en);
    const otherKeys = Object.keys(PAGELET_LOCALE_RESOURCES[locale]);
    const enSet = new Set(enKeys);
    const otherSet = new Set(otherKeys);
    const missing = enKeys.filter((key) => !otherSet.has(key));
    const orphan = otherKeys.filter((key) => !enSet.has(key));
    return { missing, orphan };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function interpolate(template: string, params: Readonly<Record<string, string | number>>): string {
    // Match `{key}` where key is letters/digits/dash/underscore. Anything
    // more permissive risks accidentally substituting fragments of code or
    // markdown inside the message body.
    return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, key: string) => {
        const value = params[key];
        return value == null ? match : String(value);
    });
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export {
    detectNoteLanguage,
    getPageletUiLanguage,
    PAGELET_ZH_RATIO_THRESHOLD,
    type PageletDetectedLanguage,
};

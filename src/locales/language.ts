/* Copyright 2023 edonyzpc */

import { getOptionalPlatformWindow } from "../platform-dom";

export const SUPPORTED_UI_LOCALES = ["en", "zh"] as const;
export type UiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

type ObsidianLocaleWindow = Window & {
    i18next?: { language?: unknown };
    moment?: { locale?: () => unknown };
};

export function getObsidianUiLanguage(): UiLocale {
    const win = getOptionalPlatformWindow() as ObsidianLocaleWindow | undefined;
    if (!win) return "en";

    const i18nLang = normalizeUiLanguage(win.i18next?.language);
    if (i18nLang) return i18nLang;

    const momentLocale = normalizeUiLanguage(safeCallLocale(win.moment));
    if (momentLocale) return momentLocale;

    return "en";
}

export function normalizeUiLanguage(value: unknown): UiLocale | null {
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
        return undefined;
    }
}

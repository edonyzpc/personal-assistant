/* Copyright 2023 edonyzpc */

import enMessagesRaw from "./en.json";
import zhMessagesRaw from "./zh.json";
import {
    SUPPORTED_UI_LOCALES,
    getObsidianUiLanguage,
    type UiLocale,
} from "../language";

export const PLUGIN_SUPPORTED_LOCALES = SUPPORTED_UI_LOCALES;
export type PluginLocale = UiLocale;
export type PluginMessages = Readonly<Record<string, string>>;
export type PluginMessageKey = keyof typeof enMessagesRaw;
export type PluginLookupKey = PluginMessageKey | (string & Record<never, never>);
export type PluginTranslator = (
    key: PluginLookupKey,
    params?: Readonly<Record<string, string | number>>,
    fallback?: string,
) => string;

export const PLUGIN_LOCALE_RESOURCES: Readonly<Record<PluginLocale, PluginMessages>> = Object.freeze({
    en: Object.freeze({ ...enMessagesRaw } as PluginMessages),
    zh: Object.freeze({ ...zhMessagesRaw } as PluginMessages),
});

export function getPluginUiLanguage(): PluginLocale {
    return getObsidianUiLanguage();
}

export function pluginT(
    key: PluginLookupKey,
    locale: PluginLocale = "en",
    params?: Readonly<Record<string, string | number>>,
    fallback?: string,
): string {
    const dict = PLUGIN_LOCALE_RESOURCES[locale] ?? PLUGIN_LOCALE_RESOURCES.en;
    const raw =
        dict[key]
        ?? PLUGIN_LOCALE_RESOURCES.en[key]
        ?? fallback
        ?? key;
    if (!params) return raw;
    return interpolate(raw, params);
}

export function makePluginTranslator(locale: PluginLocale): PluginTranslator {
    return (key, params, fallback) => pluginT(key, locale, params, fallback);
}

export interface PluginLocaleParity {
    missing: string[];
    orphan: string[];
}

export function diffPluginLocaleAgainstEn(locale: PluginLocale): PluginLocaleParity {
    const enKeys = Object.keys(PLUGIN_LOCALE_RESOURCES.en);
    const otherKeys = Object.keys(PLUGIN_LOCALE_RESOURCES[locale]);
    const enSet = new Set(enKeys);
    const otherSet = new Set(otherKeys);
    return {
        missing: enKeys.filter((key) => !otherSet.has(key)),
        orphan: otherKeys.filter((key) => !enSet.has(key)),
    };
}

function interpolate(template: string, params: Readonly<Record<string, string | number>>): string {
    return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, key: string) => {
        const value = params[key];
        return value == null ? match : String(value);
    });
}

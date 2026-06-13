/* Copyright 2023 edonyzpc */

import { afterEach, describe, expect, it } from "@jest/globals";

import {
    PLUGIN_LOCALE_RESOURCES,
    PLUGIN_SUPPORTED_LOCALES,
    diffPluginLocaleAgainstEn,
    getPluginUiLanguage,
    makePluginTranslator,
    pluginT,
} from "../src/locales/plugin";

describe("pluginT lookup", () => {
    it("returns locale-specific strings with EN as the default fallback", () => {
        expect(pluginT("plugin.chat.action.ask")).toBe("Ask");
        expect(pluginT("plugin.chat.action.ask", "zh")).toBe("提问");
    });

    it("falls back to EN, then explicit fallback, then key", () => {
        expect(pluginT("plugin.chat.action.ask", "unknown" as "en")).toBe("Ask");
        expect(pluginT("plugin.missing", "en", undefined, "fallback")).toBe("fallback");
        expect(pluginT("plugin.missing")).toBe("plugin.missing");
    });

    it("interpolates placeholders", () => {
        expect(pluginT("plugin.chat.notice.openNoteFailed", "en", { note: "Daily.md" }))
            .toBe("Could not open note: Daily.md");
    });
});

describe("plugin locale resources", () => {
    it("ships the same key set in EN and ZH", () => {
        expect([...PLUGIN_SUPPORTED_LOCALES]).toEqual(["en", "zh"]);
        expect(diffPluginLocaleAgainstEn("zh")).toEqual({ missing: [], orphan: [] });
    });

    it("keeps resource tables frozen", () => {
        expect(Object.isFrozen(PLUGIN_LOCALE_RESOURCES)).toBe(true);
        expect(Object.isFrozen(PLUGIN_LOCALE_RESOURCES.en)).toBe(true);
        expect(Object.isFrozen(PLUGIN_LOCALE_RESOURCES.zh)).toBe(true);
    });

    it("binds a translator to one locale", () => {
        const t = makePluginTranslator("zh");
        expect(t("plugin.chat.history.minAgo", { count: 3 })).toBe("3 分钟前");
    });
});

describe("getPluginUiLanguage", () => {
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

    it("follows Obsidian's i18next language hook", () => {
        (globalThis as unknown as { window: unknown }).window = {
            i18next: { language: "zh-CN" },
        };
        expect(getPluginUiLanguage()).toBe("zh");
    });

    it("falls back to EN for unsupported UI locales", () => {
        (globalThis as unknown as { window: unknown }).window = {
            i18next: { language: "fr" },
        };
        expect(getPluginUiLanguage()).toBe("en");
    });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    diffPluginLocaleAgainstEn,
    pluginT,
} from "../src/locales/plugin";

describe("Share Card locale copy", () => {
    it("keeps English and Chinese busy announcements available and in parity", () => {
        expect(pluginT("plugin.shareCard.copying", "en")).toBe("Copying current page…");
        expect(pluginT("plugin.shareCard.saving", "en")).toBe("Saving card images…");
        expect(pluginT("plugin.shareCard.copying", "zh")).toBe("正在复制当前页…");
        expect(pluginT("plugin.shareCard.saving", "zh")).toBe("正在保存卡片图片…");
        expect(pluginT("plugin.shareCard.resourceIncomplete", "zh", { count: 2 }))
            .toBe("有 2 项视觉内容无法加载，已显示为占位提示。");
        expect(pluginT("plugin.shareCard.resourcePlaceholder", "zh", { label: "示意图" }))
            .toBe("视觉内容无法加载：示意图");
        expect(diffPluginLocaleAgainstEn("zh")).toEqual({ missing: [], orphan: [] });
    });

    it("keeps fixed card dimensions and 44px mobile actions in static CSS", () => {
        const css = readFileSync(resolve(process.cwd(), "src/custom.pcss"), "utf8");

        expect(css).toMatch(/\.pa-share-card\s*\{[\s\S]*?width:\s*540px;[\s\S]*?height:\s*720px;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-share-card-actions button\s*\{[\s\S]*?min-height:\s*44px;/);
        expect(css).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*?\.pa-share-card-actions button\s*\{[\s\S]*?min-height:\s*44px;/);
        expect(css).not.toMatch(/\.pa-share-card-body img,[\s\S]{0,400}?display:\s*none\s*!important/);
        expect(css).toMatch(/\.pa-share-card-body \.pa-share-card-resource-placeholder\s*\{/);
        expect(css).toMatch(/\.pa-share-card-static,[\s\S]*?animation:\s*none\s*!important/);
        expect(css).toMatch(/\.pa-share-card-body > \.pa-share-card-visual-block\s*\{[\s\S]*?max-height:\s*100%;/);
    });
});

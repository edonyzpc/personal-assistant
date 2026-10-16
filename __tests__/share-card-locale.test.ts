import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pluginT } from "../src/locales/plugin";

describe("Share Card locale copy", () => {
    it("keeps English and Chinese busy announcements available and in parity", () => {
        expect(pluginT("plugin.shareCard.copying", "en")).toBe("Copying current page…");
        expect(pluginT("plugin.shareCard.saving", "en")).toBe("Saving card images…");
        expect(pluginT("plugin.shareCard.copying", "zh")).toBe("正在复制当前页…");
        expect(pluginT("plugin.shareCard.saving", "zh")).toBe("正在保存卡片图片…");
        expect(pluginT("plugin.shareCard.appearance", "en")).toBe("Appearance");
        expect(pluginT("plugin.shareCard.appearanceAuto", "en")).toBe("Use Obsidian theme");
        expect(pluginT("plugin.shareCard.appearanceLight", "en")).toBe("Light");
        expect(pluginT("plugin.shareCard.appearanceDark", "en")).toBe("Dark");
        expect(pluginT("plugin.shareCard.appearance", "zh")).toBe("外观");
        expect(pluginT("plugin.shareCard.appearanceAuto", "zh")).toBe("跟随 Obsidian");
        expect(pluginT("plugin.shareCard.appearanceLight", "zh")).toBe("浅色");
        expect(pluginT("plugin.shareCard.appearanceDark", "zh")).toBe("深色");
        expect(pluginT("plugin.shareCard.sharerName", "en")).toBe("Author");
        expect(pluginT("plugin.shareCard.sharerNameOptional", "en"))
            .toBe("(optional, default: EZ)");
        expect(pluginT("plugin.shareCard.sharerNamePlaceholder", "en"))
            .toBe("Your name");
        expect(pluginT("plugin.shareCard.sharerName", "zh")).toBe("署名");
        expect(pluginT("plugin.shareCard.sharerNameOptional", "zh"))
            .toBe("（可选，默认 EZ）");
        expect(pluginT("plugin.shareCard.sharerNamePlaceholder", "zh"))
            .toBe("你的名字");
        expect(pluginT("plugin.shareCard.vaultRoot", "en")).toBe("Vault root");
        expect(pluginT("plugin.shareCard.vaultRoot", "zh")).toBe("仓库根目录");
        expect(pluginT("plugin.shareCard.saveImage", "en")).toBe("Save image");
        expect(pluginT("plugin.shareCard.saveImage", "zh")).toBe("保存图片");
        expect(pluginT("plugin.shareCard.saveAllPages", "en", { count: 3 })).toBe("Save 3 images");
        expect(pluginT("plugin.shareCard.saveAllPages", "zh", { count: 3 })).toBe("保存 3 张图片");
        expect(pluginT("plugin.shareCard.unpageableContent", "en"))
            .toBe("This content could not be split into card pages safely.");
        expect(pluginT("plugin.shareCard.measurementFailed", "en"))
            .toBe("Could not finish measuring this card content.");
        expect(pluginT("plugin.shareCard.unpageableContent", "zh"))
            .toBe("无法安全分页。");
        expect(pluginT("plugin.shareCard.measurementFailed", "zh"))
            .toBe("无法完成内容测量。");
        expect(pluginT("plugin.shareCard.resourceIncomplete", "zh", { count: 2 }))
            .toBe("有 2 项视觉内容无法加载，已显示为占位提示。");
        expect(pluginT("plugin.shareCard.resourcePlaceholder", "zh", { label: "示意图" }))
            .toBe("视觉内容无法加载：示意图");
    });

    it("keeps fixed card dimensions and 44px mobile actions in static CSS", () => {
        const css = readFileSync(resolve(process.cwd(), "src/custom.pcss"), "utf8");

        expect(css).toMatch(/\.pa-share-card\s*\{[\s\S]*?width:\s*540px;[\s\S]*?height:\s*720px;/);
        expect(css).toMatch(
            /\.pa-share-card\s*\{[\s\S]*?font-size:\s*var\(--pa-share-card-font-size,\s*24px\);/,
        );
        expect(css).toMatch(/body\.is-mobile\s+\.pa-share-card-actions button\s*\{[\s\S]*?min-height:\s*44px;/);
        expect(css).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*?\.pa-share-card-actions button\s*\{[\s\S]*?min-height:\s*44px;/);
        expect(css).not.toMatch(/pa-share-card-print-style/);
        expect(css).not.toMatch(/\.pa-share-card-body img,[\s\S]{0,400}?display:\s*none\s*!important/);
        expect(css).toMatch(/\.pa-share-card-body \.pa-share-card-resource-placeholder\s*\{/);
        expect(css).toMatch(/\.pa-share-card-static,[\s\S]*?animation:\s*none\s*!important/);
        expect(css).toMatch(/\.pa-share-card-body > \.pa-share-card-visual-block\s*\{[\s\S]*?max-height:\s*100%;/);
        expect(css).toMatch(/\.pa-share-card\s*\{[\s\S]*?font-synthesis:\s*weight;/);
        expect(css).toMatch(
            /\.pa-share-card-signature\s*\{[\s\S]*?height:\s*16px;[\s\S]*?gap:\s*4px;[\s\S]*?color:\s*#233a34;[\s\S]*?overflow:\s*visible;/,
        );
        expect(css).toMatch(
            /\.pa-share-card\.is-dark \.pa-share-card-signature\s*\{[\s\S]*?color:\s*var\(--pa-share-card-text\);/,
        );
        expect(css).toMatch(
            /\.pa-share-card-signature svg\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*24px;/,
        );
        expect(css).toMatch(
            /\.pa-share-card-sharer-by\s*\{[\s\S]*?font-size:\s*11px;[\s\S]*?font-style:\s*italic;[\s\S]*?font-synthesis:\s*style;[\s\S]*?line-height:\s*16px;/,
        );
        expect(css).toMatch(
            /\.pa-share-card-sharer-name\s*\{[\s\S]*?max-width:\s*170px;[\s\S]*?font-size:\s*12px;[\s\S]*?line-height:\s*16px;/,
        );
    });
});

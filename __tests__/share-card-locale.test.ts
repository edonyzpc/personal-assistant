import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, type Declaration, type Rule } from "postcss";
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
        const stylesheet = parse(css);
        const rules: Rule[] = [];
        stylesheet.walkRules(rule => { rules.push(rule); });
        const matchingRules = (selector: string, media?: string): Rule[] => rules.filter(rule => (
            rule.selectors.includes(selector)
            && (media === undefined
                ? rule.parent?.type === "root"
                : rule.parent?.type === "atrule"
                    && rule.parent.name === "media" && rule.parent.params === media)
        ));
        const declaration = (selector: string, property: string, media?: string): Declaration | undefined => (
            matchingRules(selector, media).flatMap(rule => rule.nodes.filter((node): node is Declaration => (
                node.type === "decl" && node.prop === property
            ))).at(-1)
        );

        expect(declaration(".pa-share-card", "width")?.value).toBe("540px");
        expect(declaration(".pa-share-card", "height")?.value).toBe("720px");
        expect(declaration(".pa-share-card", "font-size")?.value)
            .toBe("var(--pa-share-card-font-size, 24px)");
        expect(declaration("body.is-mobile .pa-share-card-actions button", "min-height")?.value)
            .toBe("44px");
        expect(declaration(".pa-share-card-actions button", "min-height", "(max-width: 600px)")?.value)
            .toBe("44px");
        expect(css).not.toMatch(/pa-share-card-print-style/);
        expect(rules.filter(rule => rule.selectors.includes(".pa-share-card-body img"))
            .some(rule => rule.nodes.some(node => node.type === "decl"
                && node.prop === "display" && node.value === "none" && node.important))).toBe(false);
        expect(matchingRules(".pa-share-card-body .pa-share-card-resource-placeholder").length)
            .toBeGreaterThan(0);
        for (const selector of [".pa-share-card-static", ".pa-share-card-static *"]) {
            expect(declaration(selector, "animation")).toMatchObject({ value: "none", important: true });
        }
        expect(declaration(".pa-share-card-body > .pa-share-card-visual-block", "max-height")?.value)
            .toBe("100%");
    });
});

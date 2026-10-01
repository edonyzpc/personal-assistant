import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

const css = readFileSync(join(__dirname, "..", "src", "custom.pcss"), "utf8");

function declarations(selector: string): string {
    const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\}`, "m").exec(css);
    return match?.[1] ?? "";
}

function declaration(selector: string, property: string): string | undefined {
    const body = declarations(selector);
    const match = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, "m").exec(body);
    return match?.[1]?.trim();
}

function pixelValue(value: string | undefined): number | undefined {
    const match = /(-?\d+(?:\.\d+)?)px/.exec(value ?? "");
    return match ? Number(match[1]) : undefined;
}

function horizontalPadding(value: string | undefined): number | undefined {
    const match = /^(\d+(?:\.\d+)?)px(?:\s+(\d+(?:\.\d+)?)px)?/.exec(value ?? "");
    if (!match) return undefined;
    return Number(match[2] ?? match[1]);
}

function labelHiddenBelowWidth(): number | undefined {
    const match = /@container\s+\(max-width:\s*(\d+(?:\.\d+)?)px\)\s*\{[\s\S]*?pa-ghost-card-action__label\s*\{[\s\S]*?display:\s*none/.exec(css);
    return match ? Number(match[1]) : undefined;
}

describe("Ghost publishing card responsive action layout", () => {
    it("keeps four columns and switches complete labels to icons before long labels stop fitting", () => {
        const actions = declarations(".pa-chat-view .pa-ghost-publishing-card .setting-item-control");
        const label = declarations(".pa-chat-view .pa-ghost-publishing-card .pa-ghost-card-action__label");
        const threshold = labelHiddenBelowWidth();
        const assistantWidth = declaration(".llm-message.assistant", "width");
        const assistantMaximum = assistantWidth?.match(/min\(100%,\s*(\d+(?:\.\d+)?)px\)/)?.[1];
        const messagePadding = horizontalPadding(declaration(".llm-message", "padding"));
        const messageBorder = pixelValue(declaration(".llm-message", "border"));
        const cardPadding = horizontalPadding(declaration(".pa-chat-view .pa-ghost-publishing-card", "padding"));
        const cardBorder = pixelValue(declaration(".pa-chat-view .pa-ghost-publishing-card", "border"));
        const numbers = [assistantMaximum, messagePadding, messageBorder, cardPadding, cardBorder].map(Number);
        const maximumContainerWidth = numbers.length === 5 && numbers.every(Number.isFinite)
            ? numbers[0] - 2 * (numbers[1] + numbers[2] + numbers[3] + numbers[4])
            : Number.NaN;

        expect(actions).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
        expect(label).not.toContain("text-overflow: ellipsis");
        expect(Number.isFinite(maximumContainerWidth)).toBe(true);
        expect(maximumContainerWidth).toBeGreaterThan(360);
        expect(threshold).toBeDefined();
        expect(Number.isFinite(threshold)).toBe(true);
        expect(threshold!).toBeLessThan(maximumContainerWidth);
        expect(360 <= threshold!).toBe(true);
    });
});

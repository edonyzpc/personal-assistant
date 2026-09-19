import { readFileSync } from "node:fs";

function lastRuleBody(source: string, selector: string): string {
    const selectorIndex = source.lastIndexOf(selector);
    expect(selectorIndex).toBeGreaterThanOrEqual(0);
    const openBrace = source.indexOf("{", selectorIndex);
    const closeBrace = source.indexOf("}", openBrace);
    expect(openBrace).toBeGreaterThan(selectorIndex);
    expect(closeBrace).toBeGreaterThan(openBrace);
    return source.slice(openBrace + 1, closeBrace);
}

describe("B-118 typography floor and layout cascade", () => {
    const css = readFileSync("src/custom.pcss", "utf8");

    it.each([
        "body.is-mobile .pa-pagelet-bubble .pa-pagelet-bubble-items li",
        "body.is-mobile .pa-pagelet-bubble .pa-pagelet-bubble-source-link",
        "body.is-mobile .pa-pagelet-bubble .pa-pagelet-bubble-btn",
    ])("keeps the final %s cascade at or above 12px", (selector) => {
        expect(lastRuleBody(css, selector)).toMatch(
            /font-size:\s*max\([^;]+,\s*12px\)\s*;/,
        );
    });

    it.each([
        ["finding", ".pa-pagelet-bubble-items li"],
        ["source", ".pa-pagelet-bubble-source-link"],
        ["inline hint", ".pa-pagelet-bubble-inline-hint"],
        ["button", ".pa-pagelet-bubble-btn"],
        ["button label", ".pa-pagelet-bubble-btn-label"],
        ["button description", ".pa-pagelet-bubble-btn-description"],
        ["context label", ".pa-pagelet-bubble-context-action-label"],
        ["context action", ".pa-pagelet-bubble-context-action-btn"],
    ])("keeps the desktop %s rule on an explicit 12px floor", (_role, selector) => {
        const firstRule = css.slice(css.indexOf(`${selector} {`));
        const body = firstRule.slice(firstRule.indexOf("{") + 1, firstRule.indexOf("}"));
        expect(body).toMatch(/font-size:\s*max\([^;]+,\s*12px\)\s*;/);
    });

    it.each([
        ["finding body", ".pa-pagelet-bubble-text", /overflow-wrap:\s*anywhere/],
        ["source", ".pa-pagelet-bubble-source-link", /max-width:\s*100%/],
        ["source ellipsis", ".pa-pagelet-bubble-source-link", /text-overflow:\s*ellipsis/],
        ["hint", ".pa-pagelet-bubble-inline-hint-text", /overflow-wrap:\s*anywhere/],
        ["button copy", ".pa-pagelet-bubble-btn-copy", /min-width:\s*0/],
        ["button label", ".pa-pagelet-bubble-btn-label", /overflow-wrap:\s*anywhere/],
        ["button description", ".pa-pagelet-bubble-btn-description", /overflow-wrap:\s*anywhere/],
        ["context label", ".pa-pagelet-bubble-context-action-label", /overflow-wrap:\s*anywhere/],
        ["context action", ".pa-pagelet-bubble-context-action-btn", /flex-shrink:\s*0/],
    ])("keeps %s inside the Bubble layout boundary", (_role, selector, declaration) => {
        const rule = css.slice(css.indexOf(`${selector} {`));
        const body = rule.slice(rule.indexOf("{") + 1, rule.indexOf("}"));
        expect(body).toMatch(declaration as RegExp);
    });
});

import { beforeAll, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";

type RuleMessage = { ruleId: string | null; severity: number; message: string };
let results: RuleMessage[][];

beforeAll(() => {
    // Use the real flat config in a native ESM process, with type information
    // from an existing source path. lintText keeps the counterexample off disk.
    const script = `
        import { ESLint } from "eslint";
        const eslint = new ESLint();
        const examples = [
            'import "obsidian"; export function build(doc: Document, parent: HTMLElement) { return [doc.win.createDiv(), doc.win.createEl("canvas"), doc.win.createSvg("svg"), doc.win.createFragment(), parent.createDiv(), parent.createSpan()]; }',
            'import "obsidian"; export function build(doc: Document, parent: HTMLElement) { return [doc.createElement("canvas"), doc.createElementNS("http://www.w3.org/2000/svg", "svg"), doc.createDocumentFragment(), parent.createEl("div"), parent.createEl("span")]; }',
        ];
        const results = [];
        for (const code of examples) {
            const [result] = await eslint.lintText(code, { filePath: "src/platform-dom.ts" });
            results.push(result.messages.map(({ ruleId, severity, message }) => ({ ruleId, severity, message })));
        }
        process.stdout.write(JSON.stringify(results));
    `;
    results = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
    }));
}, 35_000);

describe("Obsidian DOM lint contract", () => {
    it("accepts detached helpers from the owner window and parent shorthands", () => {
        expect(results[0]).toEqual([]);
    });

    it("rejects native HTML, SVG, fragments and generic div/span helpers", () => {
        expect(results[1]).toHaveLength(5);
        for (const message of results[1]) {
            expect(message.ruleId).toBe("obsidianmd/prefer-create-el");
            expect(message.severity).toBe(2);
        }
    });
});

import { describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

describe("scripts/audit-bundle.mjs", () => {
    it("prints JSON with gzip size for a clean bundle", () => {
        const file = writeTempBundle("console.log('ok');");
        const output = execFileSync("node", [
            "scripts/audit-bundle.mjs",
            "--input",
            file,
            "--budget-gzip-bytes",
            "1024",
        ], { encoding: "utf8" });

        expect(JSON.parse(output)).toMatchObject({
            ok: true,
            input: file,
            exists: true,
            overBudget: false,
            nodeBuiltinReferences: [],
            dynamicScriptElementCreations: [],
        });
    });

    it("fails JSON report when Node builtins are present", () => {
        const file = writeTempBundle("const fs = require('fs');");

        expect(() => execFileSync("node", [
            "scripts/audit-bundle.mjs",
            "--input",
            file,
            "--budget-gzip-bytes",
            "1024",
        ], { encoding: "utf8" })).toThrow();

        const output = execFileSync("node", [
            "scripts/audit-bundle.mjs",
            "--input",
            file,
            "--budget-gzip-bytes",
            "1024",
            "--allow-node-builtins",
        ], { encoding: "utf8" });
        expect(JSON.parse(output)).toMatchObject({
            ok: true,
            nodeBuiltinReferences: ["require('fs')"],
        });
    });

    it("fails JSON report when dynamic script element creation is present", () => {
        const file = writeTempBundle("document.createElement('script');");

        expect(() => execFileSync("node", [
            "scripts/audit-bundle.mjs",
            "--input",
            file,
            "--budget-gzip-bytes",
            "1024",
        ], { encoding: "utf8" })).toThrow();
    });

    it("reports resource directory gzip budget separately", () => {
        const file = writeTempBundle("console.log('ok');");
        const resourceDir = mkdtempSync(join(tmpdir(), "pa-audit-resources-"));
        mkdirSync(join(resourceDir, "skill-one"));
        writeFileSync(join(resourceDir, "skill-one", "SKILL.md"), "name: skill-one\nbody\n", "utf8");

        const output = execFileSync("node", [
            "scripts/audit-bundle.mjs",
            "--input",
            file,
            "--budget-gzip-bytes",
            "1024",
            "--resource-dir",
            resourceDir,
            "--resource-gzip-budget-bytes",
            "1024",
        ], { encoding: "utf8" });

        expect(JSON.parse(output)).toMatchObject({
            ok: true,
            resourceAudit: {
                input: resourceDir,
                fileCount: 1,
                overBudget: false,
            },
        });
    });
});

function writeTempBundle(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "pa-audit-bundle-"));
    const file = join(dir, "main.js");
    writeFileSync(file, contents, "utf8");
    return file;
}

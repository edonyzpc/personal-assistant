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

    it("requires the exact Share Card font bytes when requested", () => {
        const dir = mkdtempSync(join(tmpdir(), "pa-audit-font-"));
        const font = join(dir, "share-card.woff2");
        const license = join(dir, "font-license.txt");
        const fontBytes = Buffer.from("fixed-share-card-font");
        writeFileSync(font, fontBytes);
        const licenseText = "Copyright holder\nSIL OPEN FONT LICENSE Version 1.1\nfull terms";
        writeFileSync(license, licenseText, "utf8");
        const file = writeTempBundle(
            `const font = "${fontBytes.toString("base64")}"; const license = ${JSON.stringify(licenseText)};`,
        );
        const args = [
            "scripts/audit-bundle.mjs",
            "--input",
            file,
            "--budget-gzip-bytes",
            "1024",
            "--require-share-card-font",
            "--share-card-font",
            font,
            "--share-card-font-license",
            license,
        ];

        const output = execFileSync("node", args, { encoding: "utf8" });
        expect(JSON.parse(output)).toMatchObject({
            ok: true,
            shareCardFontAudit: {
                required: true,
                path: font,
                bytes: fontBytes.byteLength,
                embeddedExactBytes: true,
                licensePath: license,
                embeddedReadableLicense: true,
            },
        });

        writeFileSync(file, "const font = 'different';", "utf8");
        expect(() => execFileSync("node", args, { encoding: "utf8" })).toThrow();
    });
});

function writeTempBundle(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "pa-audit-bundle-"));
    const file = join(dir, "main.js");
    writeFileSync(file, contents, "utf8");
    return file;
}

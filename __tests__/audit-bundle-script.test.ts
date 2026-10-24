import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const temporaryRoots: string[] = [];

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
        const resourceDir = createResourceDir();

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

    it("reports main and resource gzip budgets independently", () => {
        const file = writeTempBundle("console.log('ok');");
        const resourceDir = createResourceDir();

        const mainOverBudget = runAuditFailure([
            "scripts/audit-bundle.mjs",
            "--input",
            file,
            "--budget-gzip-bytes",
            "1",
            "--resource-dir",
            resourceDir,
            "--resource-gzip-budget-bytes",
            "1024",
        ]);
        expect(mainOverBudget.status).toBe(1);
        expect(mainOverBudget.report).toMatchObject({
            ok: false,
            overBudget: true,
            resourceAudit: { overBudget: false },
        });

        const resourceOverBudget = runAuditFailure([
            "scripts/audit-bundle.mjs",
            "--input",
            file,
            "--budget-gzip-bytes",
            "1024",
            "--resource-dir",
            resourceDir,
            "--resource-gzip-budget-bytes",
            "1",
        ]);
        expect(resourceOverBudget.status).toBe(1);
        expect(resourceOverBudget.report).toMatchObject({
            ok: false,
            overBudget: false,
            resourceAudit: { overBudget: true },
        });
    });

    it("requires the exact Share Card font bytes when requested", () => {
        const dir = createTempDir("pa-audit-font-");
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

        writeFileSync(file, JSON.stringify(licenseText), "utf8");
        const wrongFont = runAuditFailure(args);
        expect(wrongFont.status).toBe(1);
        expect(wrongFont.report).toMatchObject({
            ok: false,
            shareCardFontAudit: {
                embeddedExactBytes: false,
                embeddedReadableLicense: true,
            },
        });

        writeFileSync(file, `const font = "${fontBytes.toString("base64")}"; const license = "different";`, "utf8");
        const missingLicense = runAuditFailure(args);
        expect(missingLicense.status).toBe(1);
        expect(missingLicense.report).toMatchObject({
            ok: false,
            shareCardFontAudit: {
                embeddedExactBytes: true,
                embeddedReadableLicense: false,
            },
        });
    });
});

type AuditFailure = {
    status: number;
    report: {
        ok?: boolean;
        overBudget?: boolean;
        resourceAudit?: { overBudget?: boolean };
        shareCardFontAudit?: {
            embeddedExactBytes?: boolean;
            embeddedReadableLicense?: boolean;
        };
    };
};

function runAuditFailure(args: string[]): AuditFailure {
    try {
        execFileSync("node", args, { encoding: "utf8" });
    } catch (error) {
        const failure = error as { status?: number; stdout?: string };
        return {
            status: failure.status ?? -1,
            report: JSON.parse(failure.stdout ?? ""),
        };
    }
    throw new Error("Expected audit-bundle to fail.");
}

function createResourceDir(): string {
    const resourceDir = createTempDir("pa-audit-resources-");
    mkdirSync(join(resourceDir, "skill-one"));
    writeFileSync(join(resourceDir, "skill-one", "SKILL.md"), "name: skill-one\nbody\n", "utf8");
    return resourceDir;
}

function writeTempBundle(contents: string): string {
    const dir = createTempDir("pa-audit-bundle-");
    const file = join(dir, "main.js");
    writeFileSync(file, contents, "utf8");
    return file;
}

function createTempDir(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    temporaryRoots.push(root);
    return root;
}

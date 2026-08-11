import { describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const probePath = join(process.cwd(), "scripts/fts-runtime-probe.mjs");
const verifierPath = join(process.cwd(), "scripts/fts-runtime-receipt-verify.mjs");
const productionPluginPath = join(process.cwd(), "dist/main.js");

describe("portable exact Obsidian FTS runtime evidence", () => {
    it("fails closed with a schema receipt when no exact renderer is supplied", () => {
        const result = spawnSync(process.execPath, [probePath, "--json"], { encoding: "utf8" });
        expect(result.status).toBe(2);
        const receipt = JSON.parse(result.stdout);
        expect(receipt).toMatchObject({
            schemaVersion: 2,
            receiptType: "pa.fts-runtime-platform",
            status: "BLOCKED",
            platform: null,
            exactRenderer: null,
            artifacts: {
                productionPlugin: {
                    id: "production-plugin",
                    path: "dist/main.js",
                    sha256: hashBytes(readFileSync(productionPluginPath)),
                },
                runtimeCanary: { id: "runtime-canary" },
                profileCanary: {
                    id: "profile-canary",
                    payload: {
                        reference: {
                            profileId: "char-phrase-v1",
                            tokenizer: "unicode61 remove_diacritics 2",
                        },
                    },
                },
            },
        });
        expect(receipt.evaluation.blockers).toContain("exact_obsidian_renderer_missing");
        expect(receipt.evaluation.blockers).toContain("exact_renderer_plugin_identity_missing");
    });

    it("accepts one exact, same-artifact receipt for darwin, win32, and linux", () => {
        const receipts = platformReceipts();
        const result = verify(receipts);
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
            schemaVersion: 2,
            receiptType: "pa.fts-runtime-multi-platform-verification",
            status: "PASS",
            platforms: ["darwin", "win32", "linux"],
            productionPluginArtifactSha256: hashBytes(readFileSync(productionPluginPath)),
        });
    });

    it("rejects a legacy schema-v2 PASS receipt with no production plugin binding", () => {
        const receipts = platformReceipts();
        for (const receipt of receipts) {
            delete receipt.artifacts.productionPlugin;
            delete receipt.exactRenderer.pluginIdentity;
        }
        const result = verify(receipts);
        expect(result).toMatchObject({
            status: 1,
            stderr: expect.stringContaining("Receipt status mismatch: claimed PASS, computed BLOCKED"),
        });
    });

    it("rejects internally consistent receipts bound to a non-checkout plugin artifact", () => {
        const receipts = platformReceipts();
        const fakeArtifactSha256 = hash("not-the-current-production-plugin");
        for (const receipt of receipts) setPluginArtifactIdentity(receipt, fakeArtifactSha256);
        const result = verify(receipts);
        expect(result).toMatchObject({
            status: 1,
            stderr: expect.stringContaining(
                "Production plugin artifact does not match this checkout: dist/main.js",
            ),
        });
    });

    it("rejects production plugin artifact drift across platform receipts", () => {
        const receipts = platformReceipts();
        setPluginArtifactIdentity(receipts[2], hash("different-linux-production-plugin"));
        const result = verify(receipts);
        expect(result).toMatchObject({
            status: 1,
            stderr: expect.stringContaining(
                "Production plugin artifacts differ across platform receipts",
            ),
        });
    });

    it("returns structured BLOCKED evidence when a required platform receipt is missing", () => {
        const result = verify(platformReceipts().slice(0, 2));
        expect(result.status).toBe(2);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject({
            status: "BLOCKED",
            platforms: ["darwin", "win32", "linux"],
            blockers: ["missing_platform:linux"],
            failures: [],
        });

        const emptyResult = verify([]);
        expect(emptyResult.status).toBe(2);
        expect(emptyResult.stderr).toBe("");
        expect(JSON.parse(emptyResult.stdout)).toMatchObject({
            status: "BLOCKED",
            blockers: [
                "missing_platform:darwin",
                "missing_platform:win32",
                "missing_platform:linux",
            ],
            failures: [],
        });
    });

    it("rejects duplicate platforms and stale schemas as integrity errors", () => {
        const receipts = platformReceipts();
        expect(verify([receipts[0], receipts[1], receipts[1]])).toMatchObject({
            status: 1,
            stderr: expect.stringContaining("Duplicate platform receipt"),
        });
        receipts[2].schemaVersion = 1;
        expect(verify(receipts)).toMatchObject({
            status: 1,
            stderr: expect.stringContaining("Unsupported FTS runtime receipt schema"),
        });
    });

    it("rejects tampered artifacts and self-reported platform labels", () => {
        const receipts = platformReceipts();
        receipts[1].artifacts.profileCanary.payload.reference.profileId = "tampered";
        expect(verify(receipts)).toMatchObject({
            status: 1,
            stderr: expect.stringContaining("Artifact payload hash mismatch: profile-canary"),
        });

        const selfReported = platformReceipts();
        selfReported[1].platform.os = "linux";
        expect(verify(selfReported)).toMatchObject({
            status: 1,
            stderr: expect.stringContaining("Receipt platform does not match the exact renderer runtime"),
        });
    });

    it("requires Node 22 for the repository reference runtime", () => {
        const node22 = platformReceipts();
        expect(verify(node22).status).toBe(0);

        for (const version of ["20.18.1", "24.18.0"]) {
            const receipts = platformReceipts();
            for (const receipt of receipts) {
                receipt.referenceRuntime.runtime.versions.node = version;
                receipt.status = "BLOCKED";
            }
            const result = verify(receipts);
            expect(result.status).toBe(2);
            expect(JSON.parse(result.stdout)).toMatchObject({
                status: "BLOCKED",
                blockers: [
                    "darwin:reference_runtime_node22_required",
                    "win32:reference_runtime_node22_required",
                    "linux:reference_runtime_node22_required",
                ],
                failures: [],
            });
        }
    });

    it("classifies missing cases or artifacts as BLOCKED", () => {
        const missingCase = platformReceipts();
        missingCase[2].exactRenderer.fingerprintPayload.words.pop();
        refreshRuntimeFingerprints(missingCase[2].exactRenderer);
        refreshRuntimeArtifact(missingCase[2]);
        missingCase[2].status = "BLOCKED";
        const missingCaseResult = verify(missingCase);
        expect(missingCaseResult.status).toBe(2);
        expect(JSON.parse(missingCaseResult.stdout)).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["linux:renderer_word_cases_missing"]),
        });

        const missingArtifact = platformReceipts();
        delete missingArtifact[1].artifacts.profileCanary;
        missingArtifact[1].status = "BLOCKED";
        const missingArtifactResult = verify(missingArtifact);
        expect(missingArtifactResult.status).toBe(2);
        expect(JSON.parse(missingArtifactResult.stdout)).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["win32:artifact_missing:profile-canary"]),
        });
    });

    it("fails grapheme/profile drift but keeps word-only drift diagnostic", () => {
        const graphemeDrift = platformReceipts();
        graphemeDrift[2].exactRenderer.fingerprintPayload.graphemes[0].tokens = ["drift"];
        refreshRuntimeFingerprints(graphemeDrift[2].exactRenderer);
        refreshRuntimeArtifact(graphemeDrift[2]);
        graphemeDrift[2].status = "FAIL";
        expect(JSON.parse(verify(graphemeDrift).stdout)).toMatchObject({
            status: "FAIL",
            failures: expect.arrayContaining(["cross_platform_grapheme_drift"]),
        });

        const profileDrift = platformReceipts();
        profileDrift[2].artifacts.profileCanary.payload.renderer.runtimeFingerprint = "char-phrase-v1:drift";
        refreshArtifact(profileDrift[2].artifacts.profileCanary);
        profileDrift[2].status = "FAIL";
        expect(JSON.parse(verify(profileDrift).stdout)).toMatchObject({
            status: "FAIL",
            failures: expect.arrayContaining(["cross_platform_profile_drift"]),
        });

        const wordDrift = platformReceipts();
        wordDrift[2].exactRenderer.fingerprintPayload.words[0].tokens = ["diagnostic-only"];
        refreshRuntimeFingerprints(wordDrift[2].exactRenderer);
        refreshRuntimeArtifact(wordDrift[2]);
        expect(JSON.parse(verify(wordDrift).stdout)).toMatchObject({
            status: "PASS",
            diagnostics: ["cross_platform_word_drift"],
        });
    });

    it("aggregates mixed FAIL and BLOCKED receipts as FAIL", () => {
        const receipts = platformReceipts();
        receipts[0].artifacts.profileCanary.payload.renderer.runtimeFingerprint = "char-phrase-v1:drift";
        refreshArtifact(receipts[0].artifacts.profileCanary);
        receipts[0].status = "FAIL";
        receipts[2].exactRenderer.fingerprintPayload.words.pop();
        refreshRuntimeFingerprints(receipts[2].exactRenderer);
        refreshRuntimeArtifact(receipts[2]);
        receipts[2].status = "BLOCKED";

        const result = verify(receipts);
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
            status: "FAIL",
            blockers: expect.arrayContaining(["linux:renderer_word_cases_missing"]),
            failures: expect.arrayContaining([
                "cross_platform_profile_drift",
                "platform_receipt_failed",
            ]),
        });
    });

    it("verifies loaded-app and shell identities independently", () => {
        const runtime = exactRuntimeIdentity({
            loadedAppVersion: "1.13.4",
            shellVersion: "1.12.7",
        });
        const expectedShell = {
            available: true,
            shellVersion: "1.12.7",
            electronVersion: "39.8.3",
            icuDataMarkers: ["icudt74l"],
        };

        expect(inspectRuntimeIdentity(runtime, expectedShell)).toMatchObject({
            exactRendererIdentity: true,
            staticIdentityMatches: true,
            identityVerified: true,
        });
        expect(inspectRuntimeIdentity(runtime, {
            ...expectedShell,
            shellVersion: "1.12.8",
        })).toMatchObject({ identityVerified: false, staticIdentityMatches: false });
        expect(inspectRuntimeIdentity({
            ...runtime,
            obsidianVersionSource: "app.version",
        }, expectedShell)).toMatchObject({ identityVerified: false });
    });
});

function platformReceipts(): any[] {
    const probe = spawnSync(process.execPath, [probePath, "--json"], { encoding: "utf8" });
    const base = JSON.parse(probe.stdout);
    return ["darwin", "win32", "linux"].map((platform) => makePlatformReceipt(base, platform));
}

function makePlatformReceipt(base: any, platform: string): any {
    const receipt = structuredClone(base);
    const arch = platform === "darwin" ? "arm64" : "x64";
    receipt.status = "PASS";
    receipt.platform = { os: platform, arch };
    receipt.referenceRuntime.runtime.processPlatform = platform;
    receipt.referenceRuntime.runtime.processArch = arch;
    receipt.referenceRuntime.runtime.versions.node = "22.22.3";
    const profile = structuredClone(receipt.artifacts.profileCanary.payload.reference);
    receipt.exactRenderer = {
        ...structuredClone(receipt.referenceRuntime),
        label: "obsidian-renderer",
        identityVerified: true,
        staticIdentityMatches: platform === "darwin" ? true : null,
        profile,
        target: { title: "Obsidian", url: "app://obsidian.md/starter.html" },
        pluginIdentity: {
            id: "personal-assistant",
            version: "2.9.2",
            artifact: {
                path: ".obsidian/plugins/personal-assistant/main.js",
                sha256: receipt.artifacts.productionPlugin.sha256,
                byteLength: receipt.artifacts.productionPlugin.byteLength,
            },
            loadedBuild: {
                schemaVersion: 1,
                pluginId: "personal-assistant",
                pluginVersion: "2.9.2",
                pluginArtifactPath: ".obsidian/plugins/personal-assistant/main.js",
                loadedPluginArtifactSha256: receipt.artifacts.productionPlugin.sha256,
                lexicalProfileRuntimeFingerprint: "char-phrase-v1:test-runtime",
                capturedAtPluginLoad: "2026-08-10T00:00:00.000Z",
                identitySource: "plugin-onload-cached-main-js",
                blocker: null,
            },
        },
        runtime: {
            ...structuredClone(receipt.referenceRuntime.runtime),
            host: "electron-renderer",
            processType: "renderer",
            obsidianAppVersion: "1.12.7",
            obsidianVersionSource: "obsidian.apiVersion",
            obsidianShellVersion: "1.12.7",
            obsidianShellVersionSource: "navigator.userAgent:obsidian/x",
            versions: {
                ...structuredClone(receipt.referenceRuntime.runtime.versions),
                electron: "39.8.3",
                icu: "74.2",
            },
            browser: {
                available: true,
                hasDocument: true,
                userAgent: "Obsidian test receipt",
                platform,
                language: "en-US",
                locationHref: "app://obsidian.md/starter.html",
            },
        },
    };
    refreshRuntimeArtifact(receipt);
    receipt.artifacts.profileCanary.payload.renderer = structuredClone(profile);
    refreshArtifact(receipt.artifacts.profileCanary);
    return receipt;
}

function exactRuntimeIdentity({
    loadedAppVersion,
    shellVersion,
}: {
    loadedAppVersion: string;
    shellVersion: string;
}): Record<string, unknown> {
    return {
        host: "electron-renderer",
        processType: "renderer",
        processPlatform: "darwin",
        processArch: "arm64",
        obsidianAppVersion: loadedAppVersion,
        obsidianVersionSource: "obsidian.apiVersion",
        obsidianShellVersion: shellVersion,
        obsidianShellVersionSource: "navigator.userAgent:obsidian/x",
        versions: { electron: "39.8.3", icu: "74.2" },
        browser: {
            hasDocument: true,
            locationHref: "app://obsidian.md/starter.html",
        },
    };
}

function inspectRuntimeIdentity(
    runtime: Record<string, unknown>,
    expectedIdentity: Record<string, unknown>,
): Record<string, boolean> {
    const moduleUrl = pathToFileURL(probePath).href;
    const source = [
        `import { inspectCdpRuntimeIdentity } from ${JSON.stringify(moduleUrl)};`,
        `const result = inspectCdpRuntimeIdentity(${JSON.stringify(runtime)}, ${JSON.stringify(expectedIdentity)});`,
        "process.stdout.write(JSON.stringify(result));",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
        encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return JSON.parse(result.stdout) as Record<string, boolean>;
}

function refreshRuntimeArtifact(receipt: any): void {
    receipt.artifacts.runtimeCanary.payload = {
        schemaVersion: 2,
        renderer: structuredClone(receipt.exactRenderer.fingerprintPayload),
        reference: structuredClone(receipt.referenceRuntime.fingerprintPayload),
    };
    refreshArtifact(receipt.artifacts.runtimeCanary);
}

function refreshRuntimeFingerprints(runtime: any): void {
    runtime.fingerprint = hash(runtime.fingerprintPayload);
    runtime.graphemeFingerprint = hash(runtime.fingerprintPayload.graphemes);
    runtime.wordFingerprint = hash(runtime.fingerprintPayload.words);
}

function refreshArtifact(artifact: any): void {
    artifact.payloadSha256 = hash(artifact.payload);
}

function setPluginArtifactIdentity(receipt: any, sha256: string): void {
    receipt.artifacts.productionPlugin.sha256 = sha256;
    receipt.exactRenderer.pluginIdentity.artifact.sha256 = sha256;
    receipt.exactRenderer.pluginIdentity.loadedBuild.loadedPluginArtifactSha256 = sha256;
}

function hash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashBytes(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

function verify(receipts: any[]): { status: number | null; stdout: string; stderr: string } {
    const directory = mkdtempSync(join(tmpdir(), "pa-fts-runtime-receipts-"));
    const paths = receipts.map((receipt, index) => {
        const path = join(directory, `receipt-${index}.json`);
        writeFileSync(path, JSON.stringify(receipt), "utf8");
        return path;
    });
    const result = spawnSync(process.execPath, [verifierPath, "--json", ...paths], { encoding: "utf8" });
    return {
        status: result.status,
        stdout: String(result.stdout),
        stderr: String(result.stderr),
    };
}

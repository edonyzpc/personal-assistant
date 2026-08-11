import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
import {
    appendFileSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it } from "@jest/globals";

const repositoryRoot = process.cwd();
const preparePath = join(repositoryRoot, "scripts/fts-ios-runtime-prepare.mjs");
const verifyPath = join(repositoryRoot, "scripts/fts-ios-runtime-verify.mjs");
const runtimeCanaryPath = join(repositoryRoot, "scripts/fts-runtime-canary.cjs");
const lexicalNormalizerPath = join(repositoryRoot, "src/vss/lexical-normalizer.ts");
const currentDistPluginArtifactPath = join(repositoryRoot, "dist/main.js");
const currentPackage = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
) as { version?: unknown };
const currentManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "manifest.json"), "utf8"),
) as { id?: unknown; version?: unknown };
if (currentManifest.id !== "personal-assistant"
    || typeof currentManifest.version !== "string"
    || currentManifest.version.length === 0
    || currentPackage.version !== currentManifest.version) {
    throw new Error("The iOS receipt fixture requires matching current package/manifest identity.");
}
const currentPluginIdentity = Object.freeze({
    id: currentManifest.id,
    version: currentManifest.version,
});
const pluginVaultArtifactPath = `.obsidian/plugins/${currentPluginIdentity.id}/main.js`;
const bundleVaultPath = "fts-ios-runtime-bundle.js";
const deviceIdentitySha256 = "d".repeat(64);
const actualIphone15UserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148  obsidian";
const temporaryDirectories: string[] = [];

interface PreparedBundle {
    directory: string;
    bundlePath: string;
    bundleSource: string;
    pluginArtifactPath: string;
    pluginArtifactSource: string;
    buildReceiptPath: string;
    challengePath: string;
    attestorPublicKeyPath: string;
    attestorPrivateKeyPem: string;
    replayStore: string;
    report: Record<string, any>;
}

interface RuntimeOptions {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    formalIdentity?: boolean;
    loadedBuildIdentity?: boolean;
    electron?: boolean;
    deviceIdentitySha256?: string | null;
    loadedPluginArtifactSha256?: string;
    diskPluginArtifactSource?: string;
    loadedProfileFingerprint?: string;
    loadedAppVersion?: string;
    locationHref?: string;
    operatorObservation?: Record<string, unknown> | null;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("B-125 iOS WKWebView runtime receipt", () => {
    it("exposes prepare and one-time verify usage with an external-key trust boundary", () => {
        const prepare = spawnSync(process.execPath, [preparePath, "--help"], { encoding: "utf8" });
        const verify = spawnSync(process.execPath, [verifyPath, "--help"], { encoding: "utf8" });

        expect(prepare.status).toBe(0);
        expect(prepare.stdout).toContain("--plugin-artifact <current repo dist/main.js or byte-identical copy>");
        expect(prepare.stdout).toContain("--build-receipt <externally-signed-build-receipt.json>");
        expect(prepare.stdout).toContain("--trusted-attestor-public-key <external-public-key.pem>");
        expect(verify.status).toBe(0);
        expect(verify.stdout).toContain("--session-attestation <attestation.json>");
        expect(verify.stdout).toContain("--replay-store <directory>");
        expect(verify.stdout).toContain("Node 20/24 return BLOCKED");
    });

    it("verifies one operator-attested iOS candidate once without claiming hardware proof", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const attestationPath = attestReceipt(prepared, receipt);
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(prepared.report).toMatchObject({
            schemaVersion: 2,
            status: "PREPARED",
            realDeviceExecuted: false,
            hardwareAttestationClaimed: false,
            externalAttestationRequired: false,
            repositoryHoldsAttestorPrivateKey: false,
            externalAssurance: {
                enabled: true,
                buildReceipt: true,
                sessionChallenge: true,
                replayProtection: true,
            },
            externalAttestationContract: {
                signatureAlgorithm: "Ed25519",
                requiredCollector: "macos-safari-web-inspector",
                requiredTransport: "usb",
            },
            bundleVaultPath,
        });
        expect(prepared.report.sourceIdentity).toMatchObject({
            runtimeCanarySha256: hash(readFileSync(runtimeCanaryPath)),
            lexicalNormalizerSha256: hash(readFileSync(lexicalNormalizerPath)),
            currentPluginArtifactSha256: hash(prepared.pluginArtifactSource),
        });
        expect(prepared.report.currentPluginArtifact.productionBuildEvidence).toMatchObject({
            artifactPath: "dist/main.js",
            artifactKind: "production-main-js",
            currentCheckoutInputCount: expect.any(Number),
            currentCheckoutInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            trustedBuildReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        });
        expect(receipt).toMatchObject({
            schemaVersion: 2,
            receiptType: "pa.fts-ios-runtime",
            captureStatus: "CANDIDATE",
            externalTrustStatus: "UNATTESTED",
            blockers: [],
            runtimeFamily: "ios-wkwebview",
            platformClass: "ios-wkwebview-candidate",
            pluginIdentity: {
                id: currentPluginIdentity.id,
                version: currentPluginIdentity.version,
                loadedBuild: {
                    identitySource: "plugin-onload-cached-main-js",
                    loadedPluginArtifactSha256: hash(prepared.pluginArtifactSource),
                },
            },
            artifacts: {
                bundle: { path: bundleVaultPath, sha256: hash(prepared.bundleSource) },
                plugin: { sha256: hash(prepared.pluginArtifactSource) },
            },
        });
        expect(result.status).toBe(0);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "PASS",
            blockers: [],
            failures: [],
            evidence: {
                deviceIdentitySha256,
                externalSessionAttested: true,
                externalSessionTrustBoundary:
                    "operator-confirmed-safari-web-inspector-session-not-hardware-attestation",
                repositoryNode: { requiredNodeMajor: 22, status: "READY" },
            },
        });
    });

    it("keeps an incomplete optional external assurance BLOCKED", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const result = verifyReceipt(prepared, receipt, { omitAttestation: true });

        expect(receipt.captureStatus).toBe("CANDIDATE");
        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["trusted_device_session_evidence_missing"]),
        });
    });

    it("accepts the exact iPhone 15 Obsidian UA with formal app identity and no shell version", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared, {
            userAgent: actualIphone15UserAgent,
            platform: "iPhone",
            maxTouchPoints: 5,
            loadedAppVersion: "1.13.6",
            locationHref: "capacitor://localhost",
        });
        const attestationPath = attestReceipt(prepared, receipt);
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(receipt).toMatchObject({
            captureStatus: "CANDIDATE",
            blockers: [],
            browserIdentity: {
                userAgent: actualIphone15UserAgent,
                platform: "iPhone",
                maxTouchPoints: 5,
                locationHref: "capacitor://localhost",
            },
            appIdentity: {
                loadedAppVersion: "1.13.6",
                loadedAppVersionSource: "obsidian.apiVersion",
                identitySource: "plugin.getObsidianRuntimeIdentity",
                shellVersion: null,
                shellVersionSource: null,
            },
        });
        expect(result.status).toBe(0);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "PASS",
            blockers: [],
            failures: [],
        });
    });

    it("passes the base canary with real-device operator observation and no external assurance", async () => {
        const prepared = prepareBaseBundle();
        const receipt = await captureReceipt(prepared, {
            userAgent: actualIphone15UserAgent,
            platform: "iPhone",
            maxTouchPoints: 5,
            loadedAppVersion: "1.13.6",
            locationHref: "capacitor://localhost",
        });
        const result = verifyReceipt(prepared, receipt, { omitExternalAssurance: true });

        expect(receipt).toMatchObject({
            captureStatus: "CANDIDATE",
            blockers: [],
            sessionChallenge: null,
            operatorObservation: {
                realDeviceObserved: true,
                iphoneMirroringObserved: true,
                safariWebInspectorObserved: true,
                hardwareAttestationClaimed: false,
            },
        });
        expect(prepared.report).toMatchObject({
            currentPluginArtifact: {
                productionBuildEvidence: {
                    localProductionBuildProvenanceType:
                        "pa.fts-ios-local-production-build-provenance",
                    localProductionBuildProvenancePayloadSha256:
                        expect.stringMatching(/^[a-f0-9]{64}$/u),
                },
            },
            checkoutProductionBinding: {
                bindingType: "pa.fts-ios-checkout-production-binding",
                artifactPath: "dist/main.js",
                artifactSha256: hash(prepared.pluginArtifactSource),
                checkoutInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            },
            checkoutProductionBindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        });
        expect(result.status).toBe(0);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "PASS",
            blockers: [],
            evidence: {
                externalAssuranceRequired: false,
                externalSessionAttested: false,
                hardwareAttestationClaimed: false,
                checkoutProductionBinding: prepared.report.checkoutProductionBinding,
                checkoutProductionBindingSha256:
                    prepared.report.checkoutProductionBindingSha256,
            },
        });
    });

    it("blocks a re-sealed base receipt after its freshness window", async () => {
        const prepared = prepareBaseBundle();
        const receipt = await captureReceipt(prepared);
        const staleAt = new Date(Date.now() - 11 * 60_000).toISOString();
        receipt.generatedAt = staleAt;
        receipt.operatorObservation.observedAt = staleAt;
        const result = verifyReceipt(prepared, reseal(receipt), {
            omitExternalAssurance: true,
        });

        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["ios_base_receipt_stale"]),
        });
    });

    it("blocks a base canary without both Mirroring and Inspector operator observation", async () => {
        const prepared = prepareBaseBundle();
        const receipt = await captureReceipt(prepared, {
            operatorObservation: {
                schemaVersion: 1,
                observationType: "pa.fts-ios-runtime-operator-observation",
                realDeviceObserved: true,
                iphoneMirroringObserved: false,
                safariWebInspectorObserved: true,
                inspectedApplicationId: "md.obsidian",
                runtimeFamily: "ios-wkwebview",
                observedAt: new Date().toISOString(),
                hardwareAttestationClaimed: false,
            },
        });
        const result = verifyReceipt(prepared, receipt, { omitExternalAssurance: true });

        expect(receipt.captureStatus).toBe("BLOCKED");
        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            blockers: expect.arrayContaining(["ios_operator_observation_missing"]),
        });
    });

    it("still blocks a versioned Obsidian UA when its shell version evidence disagrees", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        receipt.appIdentity.shellVersion = "9.9.9";
        receipt.captureStatus = "BLOCKED";
        receipt.blockers = ["formal_app_identity_missing"];
        const sealed = reseal(receipt);
        const attestationPath = attestReceipt(prepared, sealed);
        const result = verifyReceipt(prepared, sealed, { attestationPath });

        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["formal_app_identity_missing"]),
        });
    });

    it("rejects a forged self-signed external evidence document as an integrity error", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const attestationPath = attestReceipt(prepared, receipt);
        const attestation = JSON.parse(readFileSync(attestationPath, "utf8"));
        attestation.signatureBase64 = Buffer.from("forged-signature").toString("base64");
        writeFileSync(attestationPath, JSON.stringify(attestation, null, 2), "utf8");
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("FTS_IOS_INTEGRITY_ERROR");
        expect(result.stderr).toContain("trusted_device_evidence_signature_invalid");
    });

    it("blocks optional signed evidence that claims hardware attestation and reports the claim", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const attestationPath = attestReceipt(prepared, receipt, "hardware-claim", {
            hardwareAttestationClaimed: true,
        });
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["hardware_attestation_claim_invalid"]),
            evidence: { hardwareAttestationClaimed: true },
        });
    });

    it.each([
        ["true", "true"],
        ["null", null],
    ])(
        "blocks optional signed evidence whose hardware claim is %s instead of false",
        async (_label, hardwareAttestationClaimed) => {
            const prepared = prepareBundle();
            const receipt = await captureReceipt(prepared);
            const attestationPath = attestReceipt(prepared, receipt, `hardware-${_label}`, {
                hardwareAttestationClaimed,
            });
            const result = verifyReceipt(prepared, receipt, { attestationPath });

            expect(result.status).toBe(2);
            expect(JSON.parse(String(result.stdout))).toMatchObject({
                status: "BLOCKED",
                blockers: expect.arrayContaining(["hardware_attestation_claim_invalid"]),
                evidence: { hardwareAttestationClaimed },
            });
        },
    );

    it("consumes a challenge once and blocks replay", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const attestationPath = attestReceipt(prepared, receipt);
        const first = verifyReceipt(prepared, receipt, { attestationPath });
        const replay = verifyReceipt(prepared, receipt, { attestationPath });

        expect(first.status).toBe(0);
        expect(replay.status).toBe(2);
        expect(JSON.parse(String(replay.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["session_challenge_replayed"]),
        });
    });

    it("treats one-time challenge substitution as an integrity error", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const attestationPath = attestReceipt(prepared, receipt);
        const substitutedChallenge = JSON.parse(readFileSync(prepared.challengePath, "utf8"));
        substitutedChallenge.nonce = "e".repeat(64);
        delete substitutedChallenge.challengePayloadSha256;
        substitutedChallenge.challengePayloadSha256 = hash(substitutedChallenge);
        writeFileSync(
            prepared.challengePath,
            JSON.stringify(substitutedChallenge, null, 2),
            "utf8",
        );
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("FTS_IOS_INTEGRITY_ERROR");
        expect(result.stderr).toContain("provided bundle differs");
    });

    it("blocks an expired challenge and Node 20/24 repository references", () => {
        const script = `
          import { generateKeyPairSync } from "node:crypto";
          import { createFtsIosChallenge, validateFtsIosChallenge } from ${JSON.stringify(
              join(repositoryRoot, "scripts/lib/fts-ios-runtime-session.mjs"),
          )};
          import { inspectRepositoryNodeReference } from ${JSON.stringify(
              join(repositoryRoot, "scripts/lib/fts-ios-runtime-receipt.mjs"),
          )};
          const { publicKey } = generateKeyPairSync("ed25519");
          const challenge = createFtsIosChallenge({
            now: new Date(Date.now() - 120000),
            ttlMs: 60000,
            attestorPublicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
          });
          console.log(JSON.stringify({
            expired: validateFtsIosChallenge(challenge),
            node20: inspectRepositoryNodeReference("20.19.0"),
            node22: inspectRepositoryNodeReference("22.22.3"),
            node24: inspectRepositoryNodeReference("24.4.0"),
          }));
        `;
        const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
            encoding: "utf8",
        });
        expect(result.status).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.expired).toContain("session_challenge_expired");
        expect(report.node20).toMatchObject({
            status: "BLOCKED",
            blockers: ["repository_node22_required"],
        });
        expect(report.node22).toMatchObject({ status: "READY", blockers: [] });
        expect(report.node24).toMatchObject({
            status: "BLOCKED",
            blockers: ["repository_node22_required"],
        });
    });

    it("detects an old loaded instance after a newer main.js is copied to disk", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared, {
            loadedPluginArtifactSha256: hash("old-loaded-main.js"),
        });
        const attestationPath = attestReceipt(prepared, receipt);
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(receipt.captureStatus).toBe("BLOCKED");
        expect(receipt.blockers).toContain("loaded_plugin_artifact_mismatch");
        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["loaded_plugin_artifact_mismatch"]),
        });
    });

    it("keeps a stale current-checkout build receipt BLOCKED", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const attestationPath = attestReceipt(prepared, receipt);
        rewriteSignedBuildReceipt(prepared, {
            checkoutInputSha256: "0".repeat(64),
        });
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining([
                "trusted_build_receipt_checkout_mismatch",
                "current_plugin_artifact_stale",
            ]),
        });
    });

    it("rejects an arbitrary padded artifact that mimics production markers in the base gate", async () => {
        const prepared = prepareBundle();
        const paddedArtifactPath = join(prepared.directory, "padded-main.js");
        writeFileSync(paddedArtifactPath, productionLikeArtifactSource(), "utf8");
        const prepare = spawnSync(process.execPath, [
            preparePath,
            "--output",
            join(prepared.directory, "arbitrary-bundle.js"),
            "--plugin-artifact",
            paddedArtifactPath,
            "--json",
        ], { encoding: "utf8" });
        expect(prepare.status).toBe(1);
        expect(prepare.stderr).toContain("does not match the current repository dist/main.js");

        const receipt = await captureReceipt(prepared);
        const baseVerify = verifyReceipt(prepared, receipt, {
            pluginArtifactPath: paddedArtifactPath,
            omitExternalAssurance: true,
        });
        expect(baseVerify.status).toBe(1);
        expect(baseVerify.stderr).toContain("FTS_IOS_INTEGRITY_ERROR");
        expect(baseVerify.stderr).toContain("provided bundle differs");
    });

    it("blocks verify when a forged matching bundle and receipt use non-dist plugin bytes", async () => {
        const prepared = prepareBaseBundle();
        const paddedArtifactSource = productionLikeArtifactSource();
        writeFileSync(prepared.pluginArtifactPath, paddedArtifactSource, "utf8");
        const bundleHelperUrl = pathToFileURL(join(
            repositoryRoot,
            "scripts/lib/fts-ios-runtime-bundle.mjs",
        )).href;
        const artifactHelperUrl = pathToFileURL(join(
            repositoryRoot,
            "scripts/lib/fts-ios-runtime-artifact.mjs",
        )).href;
        const rebuild = spawnSync(process.execPath, [
            "--input-type=module",
            "--eval",
            [
                `import { writeFile } from "node:fs/promises";`,
                `import { buildFtsIosRuntimeBundle } from ${JSON.stringify(bundleHelperUrl)};`,
                `import { bindFtsIosRuntimeBundleToCheckoutProduction, readFtsIosPluginArtifactEvidence } from ${JSON.stringify(artifactHelperUrl)};`,
                `const pluginArtifact = await readFtsIosPluginArtifactEvidence(${JSON.stringify(prepared.pluginArtifactPath)}, { requireCurrentRepositoryArtifact: true });`,
                `const bundle = bindFtsIosRuntimeBundleToCheckoutProduction(await buildFtsIosRuntimeBundle({ bundleVaultPath: ${JSON.stringify(bundleVaultPath)}, sessionChallenge: null, pluginArtifactSha256: ${JSON.stringify(hash(paddedArtifactSource))} }), pluginArtifact);`,
                `await writeFile(${JSON.stringify(prepared.bundlePath)}, bundle.source, "utf8");`,
            ].join("\n"),
        ], { encoding: "utf8" });
        expect(rebuild.status).toBe(0);
        prepared.bundleSource = readFileSync(prepared.bundlePath, "utf8");
        prepared.pluginArtifactSource = paddedArtifactSource;
        const receipt = await captureReceipt(prepared);
        const result = verifyReceipt(prepared, receipt, { omitExternalAssurance: true });

        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["current_plugin_artifact_not_repo_dist"]),
        });
    });

    it("blocks when any other production source or build input drifts from the signed receipt", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const attestationPath = attestReceipt(prepared, receipt);
        rewriteSignedBuildReceipt(prepared, {
            checkoutInputCount: currentCheckoutBuildEvidence().inputCount + 1,
        });
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining(["trusted_build_receipt_checkout_mismatch"]),
        });
    });

    it("blocks a signed production receipt when a bundled external skill input mutates", () => {
        const fixtureRoot = createTemporaryDirectory();
        for (const directory of [
            "src",
            "skills/obsidian-markdown",
            "licenses",
            "scripts/lib",
        ]) {
            mkdirSync(join(fixtureRoot, directory), { recursive: true });
        }
        writeFileSync(join(fixtureRoot, "src/main.ts"), "export {};\n", "utf8");
        writeFileSync(
            join(fixtureRoot, "skills/obsidian-markdown/SKILL.md"),
            "# Obsidian Markdown\n",
            "utf8",
        );
        writeFileSync(
            join(fixtureRoot, "licenses/source-han-serif-OFL-1.1.txt"),
            "OFL fixture\n",
            "utf8",
        );
        for (const path of [
            "esbuild.config.mjs",
            "package.json",
            "package-lock.json",
            "tsconfig.json",
            "manifest.json",
            "manifest-beta.json",
            "styles.css",
            "tailwind.config.cjs",
            "scripts/lib/fts-ios-runtime-artifact.mjs",
            "scripts/lib/fts-ios-runtime-bundle.mjs",
            "scripts/lib/fts-ios-runtime-session.mjs",
        ]) {
            writeFileSync(join(fixtureRoot, path), `${path}\n`, "utf8");
        }
        const artifactHelperUrl = pathToFileURL(join(
            repositoryRoot,
            "scripts/lib/fts-ios-runtime-artifact.mjs",
        )).href;
        const skillPath = join(fixtureRoot, "skills/obsidian-markdown/SKILL.md");
        const inputProbe = spawnSync(process.execPath, [
            "--input-type=module",
            "--eval",
            [
                `import { readFtsIosProductionBuildInputEvidence } from ${JSON.stringify(artifactHelperUrl)};`,
                `const evidence = await readFtsIosProductionBuildInputEvidence(${JSON.stringify(fixtureRoot)});`,
                `process.stdout.write(JSON.stringify(evidence));`,
            ].join("\n"),
        ], { encoding: "utf8" });

        expect(inputProbe.status).toBe(0);
        const before = JSON.parse(inputProbe.stdout) as {
            inputCount: number;
            inputPaths: string[];
            sha256: string;
        };
        expect(before.inputPaths).toEqual(expect.arrayContaining([
            "skills/obsidian-markdown/SKILL.md",
            "licenses/source-han-serif-OFL-1.1.txt",
        ]));

        const pluginArtifactPath = join(fixtureRoot, "main.js");
        const buildReceiptPath = join(fixtureRoot, "production-build-receipt.json");
        const pluginArtifactSource = trustedProductionArtifactSource();
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const attestorPublicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
        const buildReceiptPayload = {
            schemaVersion: 1,
            receiptType: "pa.fts-ios-production-build",
            buildMode: "production",
            artifactPath: "dist/main.js",
            artifactSha256: hash(pluginArtifactSource),
            artifactByteLength: Buffer.byteLength(pluginArtifactSource),
            checkoutInputCount: before.inputCount,
            checkoutInputSha256: before.sha256,
            builtAt: new Date().toISOString(),
            attestorPublicKeySha256: hash(attestorPublicKeyPem),
        };
        writeFileSync(pluginArtifactPath, pluginArtifactSource, "utf8");
        writeFileSync(buildReceiptPath, JSON.stringify({
            ...buildReceiptPayload,
            signatureBase64: sign(
                null,
                Buffer.from(canonicalizeEvidence(buildReceiptPayload)),
                privateKey,
            ).toString("base64"),
        }), "utf8");
        appendFileSync(skillPath, "bundled drift\n", "utf8");

        const verificationProbe = spawnSync(process.execPath, [
            "--input-type=module",
            "--eval",
            [
                `import { readFtsIosPluginArtifactEvidence } from ${JSON.stringify(artifactHelperUrl)};`,
                `const evidence = await readFtsIosPluginArtifactEvidence(${JSON.stringify(pluginArtifactPath)}, {`,
                `  buildReceiptPath: ${JSON.stringify(buildReceiptPath)},`,
                `  attestorPublicKeyPem: ${JSON.stringify(attestorPublicKeyPem)},`,
                `  repositoryRoot: ${JSON.stringify(fixtureRoot)},`,
                `});`,
                `process.stdout.write(JSON.stringify({ blockers: evidence.blockers, productionBuildEvidence: evidence.productionBuildEvidence }));`,
            ].join("\n"),
        ], { encoding: "utf8" });

        expect(verificationProbe.status).toBe(0);
        const verified = JSON.parse(verificationProbe.stdout) as {
            blockers: string[];
            productionBuildEvidence: {
                currentCheckoutInputCount: number;
                currentCheckoutInputSha256: string;
            };
        };
        expect(verified.blockers).toEqual(expect.arrayContaining([
            "trusted_build_receipt_checkout_mismatch",
            "current_plugin_artifact_stale",
        ]));
        expect(verified.productionBuildEvidence.currentCheckoutInputCount).toBe(before.inputCount);
        expect(verified.productionBuildEvidence.currentCheckoutInputSha256).not.toBe(before.sha256);
    });

    it("blocks a backdated content change after the local production build", () => {
        const fixture = createLocalProductionBuildFixture();
        writeFixtureLocalProductionBuildProvenance(fixture.root);
        writeFileSync(fixture.sourceInputPath, "export const current = false;\n", "utf8");
        const backdated = new Date(Date.now() - 24 * 60 * 60_000);
        utimesSync(fixture.sourceInputPath, backdated, backdated);

        const evidence = probeFixtureLocalProductionArtifact(fixture);

        expect(evidence.blockers).toEqual(expect.arrayContaining([
            "local_production_build_provenance_checkout_mismatch",
            "current_plugin_artifact_stale",
        ]));
        expect(evidence.blockers).not.toContain("current_plugin_artifact_not_repo_dist");
    });

    it("rejects stale dist even when local provenance is self-resealed", () => {
        const fixture = createLocalProductionBuildFixture();
        writeFixtureLocalProductionBuildProvenance(fixture.root);
        writeFileSync(fixture.sourceInputPath, "export const current = false;\n", "utf8");
        writeFixtureLocalProductionBuildProvenance(fixture.root);
        const resealedEvidence = probeFixtureLocalProductionArtifact(fixture);
        expect(resealedEvidence.blockers).toEqual([]);
        symlinkSync(
            join(repositoryRoot, "node_modules"),
            join(fixture.root, "node_modules"),
            process.platform === "win32" ? "junction" : "dir",
        );
        const artifactHelperUrl = pathToFileURL(join(
            repositoryRoot,
            "scripts/lib/fts-ios-runtime-artifact.mjs",
        )).href;
        const buildConfigUrl = pathToFileURL(join(repositoryRoot, "esbuild.config.mjs")).href;
        const rebuildProbe = spawnSync(process.execPath, [
            "--input-type=module",
            "--eval",
            [
                `import { createHash } from "node:crypto";`,
                `import { buildProductionMainArtifactInMemory } from ${JSON.stringify(buildConfigUrl)};`,
                `import { inspectFtsIosDeterministicProductionRebuild, readFtsIosPluginArtifactEvidence } from ${JSON.stringify(artifactHelperUrl)};`,
                `const evidence = await readFtsIosPluginArtifactEvidence(${JSON.stringify(fixture.suppliedCopyPath)}, { repositoryRoot: ${JSON.stringify(fixture.root)}, requireCurrentRepositoryArtifact: true, requireLocalProductionBuildProvenance: true });`,
                `const rebuilt = await buildProductionMainArtifactInMemory({ absWorkingDir: ${JSON.stringify(fixture.root)} });`,
                `const blockers = inspectFtsIosDeterministicProductionRebuild(evidence, { sha256: createHash("sha256").update(rebuilt.source).digest("hex"), byteLength: rebuilt.byteLength });`,
                `process.stdout.write(JSON.stringify(blockers));`,
            ].join("\n"),
        ], { encoding: "utf8" });

        if (rebuildProbe.status !== 0) {
            throw new Error(rebuildProbe.stderr || rebuildProbe.stdout);
        }
        expect(rebuildProbe.status).toBe(0);
        expect(JSON.parse(rebuildProbe.stdout)).toEqual([
            "deterministic_production_rebuild_mismatch",
            "current_plugin_artifact_stale",
        ]);
    });

    it("blocks base evidence when local production provenance is missing", () => {
        const fixture = createLocalProductionBuildFixture();

        const evidence = probeFixtureLocalProductionArtifact(fixture);

        expect(evidence.blockers).toContain("local_production_build_provenance_missing");
    });

    it("blocks artifact bytes changed after local production provenance", () => {
        const fixture = createLocalProductionBuildFixture();
        writeFixtureLocalProductionBuildProvenance(fixture.root);
        const changedArtifact = `${fixture.pluginArtifactSource}\n/* changed after build */\n`;
        writeFileSync(join(fixture.root, "dist/main.js"), changedArtifact, "utf8");
        writeFileSync(fixture.suppliedCopyPath, changedArtifact, "utf8");

        const evidence = probeFixtureLocalProductionArtifact(fixture);

        expect(evidence.blockers).toContain(
            "local_production_build_provenance_artifact_mismatch",
        );
    });

    it("blocks when a production input is deleted after the local build", () => {
        const fixture = createLocalProductionBuildFixture();
        const deletedInputPath = join(fixture.root, "src/deleted-after-build.ts");
        writeFileSync(deletedInputPath, "export const presentAtBuild = true;\n", "utf8");
        writeFixtureLocalProductionBuildProvenance(fixture.root);
        rmSync(deletedInputPath);

        const evidence = probeFixtureLocalProductionArtifact(fixture);

        expect(evidence.blockers).toEqual(expect.arrayContaining([
            "local_production_build_provenance_checkout_mismatch",
            "current_plugin_artifact_stale",
        ]));
    });

    it("does not treat a touch-only production input change as stale", () => {
        const fixture = createLocalProductionBuildFixture();
        writeFixtureLocalProductionBuildProvenance(fixture.root);
        const touched = new Date(Date.now() + 60_000);
        utimesSync(fixture.sourceInputPath, touched, touched);

        const evidence = probeFixtureLocalProductionArtifact(fixture);

        expect(evidence.blockers).toEqual([]);
        expect(evidence.productionBuildEvidence).toMatchObject({
            currentRepositoryArtifactSha256: hash(fixture.pluginArtifactSource),
            localProductionBuildProvenanceType:
                "pa.fts-ios-local-production-build-provenance",
            localProductionBuildProvenancePayloadSha256:
                expect.stringMatching(/^[a-f0-9]{64}$/u),
        });
    });

    it("changes the verifier-bound bundle after prepare-time production input drift", () => {
        const fixture = createLocalProductionBuildFixture();
        writeFixtureLocalProductionBuildProvenance(fixture.root);
        const preparedEvidence = probeFixtureLocalProductionArtifact(fixture);
        writeFileSync(
            fixture.sourceInputPath,
            `${readFileSync(fixture.sourceInputPath, "utf8")}export const drift = true;\n`,
            "utf8",
        );

        const verificationEvidence = probeFixtureLocalProductionArtifact(fixture);

        expect(preparedEvidence.blockers).toEqual([]);
        expect(verificationEvidence.blockers).toEqual(expect.arrayContaining([
            "local_production_build_provenance_checkout_mismatch",
            "current_plugin_artifact_stale",
        ]));
        expect(verificationEvidence.checkoutProductionBindingSha256)
            .not.toBe(preparedEvidence.checkoutProductionBindingSha256);
        expect(verificationEvidence.boundBundleSha256)
            .not.toBe(preparedEvidence.boundBundleSha256);
    });

    it("does not write provenance when production inputs change during a build", () => {
        const fixture = createLocalProductionBuildFixture();
        const artifactHelperUrl = pathToFileURL(join(
            repositoryRoot,
            "scripts/lib/fts-ios-runtime-artifact.mjs",
        )).href;
        const beforeProbe = spawnSync(process.execPath, [
            "--input-type=module",
            "--eval",
            [
                `import { readFtsIosProductionBuildInputEvidence } from ${JSON.stringify(artifactHelperUrl)};`,
                `process.stdout.write(JSON.stringify(await readFtsIosProductionBuildInputEvidence(${JSON.stringify(fixture.root)})));`,
            ].join("\n"),
        ], { encoding: "utf8" });
        expect(beforeProbe.status).toBe(0);
        writeFileSync(
            fixture.sourceInputPath,
            `${readFileSync(fixture.sourceInputPath, "utf8")}export const duringBuild = true;\n`,
            "utf8",
        );
        const writer = spawnSync(process.execPath, [
            "--input-type=module",
            "--eval",
            [
                `import { writeFtsIosLocalProductionBuildProvenance } from ${JSON.stringify(artifactHelperUrl)};`,
                `await writeFtsIosLocalProductionBuildProvenance({ repositoryRoot: ${JSON.stringify(fixture.root)}, expectedBuildInputs: ${beforeProbe.stdout.trim()} });`,
            ].join("\n"),
        ], { encoding: "utf8" });

        expect(writer.status).toBe(1);
        expect(writer.stderr).toContain("Production inputs changed while dist/main.js was being built");
        expect(readdirSync(join(fixture.root, "dist")))
            .not.toContain("fts-ios-production-build-provenance.json");
    });

    it("loads production build control from the immutable snapshot config", () => {
        const verifyUrl = pathToFileURL(verifyPath).href;
        const snapshotOutput = "snapshot-config-B";
        const snapshotConfig = [
            "export async function buildProductionMainArtifactInMemory() {",
            `  return { source: ${JSON.stringify(snapshotOutput)}, byteLength: ${Buffer.byteLength(snapshotOutput)} };`,
            "}",
        ].join("\n");
        const probe = spawnSync(process.execPath, [
            "--input-type=module",
            "--eval",
            [
                `import { rebuildProductionArtifactFromSnapshot } from ${JSON.stringify(verifyUrl)};`,
                `const result = await rebuildProductionArtifactFromSnapshot({ records: [{ path: "esbuild.config.mjs", contents: Buffer.from(${JSON.stringify(snapshotConfig)}, "utf8") }] });`,
                `process.stdout.write(JSON.stringify(result));`,
            ].join("\n"),
        ], { encoding: "utf8" });

        expect(probe.status).toBe(0);
        expect(JSON.parse(probe.stdout)).toEqual({
            sha256: hash(snapshotOutput),
            byteLength: Buffer.byteLength(snapshotOutput),
        });
    });

    it.each([
        ["missing formal identity", { formalIdentity: false }, "formal_app_identity_missing"],
        ["missing loaded build identity", { loadedBuildIdentity: false }, "loaded_plugin_build_identity_missing"],
        [
            "desktop Safari masquerade",
            {
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15 obsidian/1.12.7",
                platform: "MacIntel",
                maxTouchPoints: 0,
            },
            "ios_user_agent_missing",
        ],
        [
            "touchless iPhone UA",
            {
                userAgent: actualIphone15UserAgent,
                platform: "iPhone",
                maxTouchPoints: 0,
                loadedAppVersion: "1.13.6",
                locationHref: "capacitor://localhost",
            },
            "touch_identity_missing",
        ],
        [
            "substring Obsidian token",
            {
                userAgent: actualIphone15UserAgent.replace(/obsidian$/u, "myobsidian"),
                platform: "iPhone",
                maxTouchPoints: 5,
                loadedAppVersion: "1.13.6",
                locationHref: "capacitor://localhost",
            },
            "formal_app_identity_missing",
        ],
        [
            "unversioned token outside Capacitor",
            {
                userAgent: actualIphone15UserAgent,
                platform: "iPhone",
                maxTouchPoints: 5,
                loadedAppVersion: "1.13.6",
                locationHref: "https://localhost",
            },
            "formal_app_identity_missing",
        ],
        ["Electron with an iPhone UA", { electron: true }, "electron_runtime_present"],
    ] as const)("keeps %s BLOCKED", async (_label, runtimeOptions, blocker) => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared, runtimeOptions);
        const attestationPath = attestReceipt(prepared, receipt);
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(receipt.captureStatus).toBe("BLOCKED");
        expect(receipt.blockers).toContain(blocker);
        expect(result.status).toBe(2);
    });

    it("reports receipt and attestation mutation as integrity errors", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        receipt.profileCanary.artifact.cases[0].transformed = "tampered";
        const attestationPath = attestReceipt(prepared, receipt);
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("receipt payload hash mismatch");
    });

    it("reports a rebuilt bundle mutation as an integrity error", async () => {
        const prepared = prepareBundle();
        const receipt = await captureReceipt(prepared);
        const attestationPath = attestReceipt(prepared, receipt);
        appendFileSync(prepared.bundlePath, "\n// tampered\n", "utf8");
        const result = verifyReceipt(prepared, receipt, { attestationPath });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("provided bundle differs from the current checkout build");
    });

    it("fails closed for grapheme and production-profile drift", async () => {
        const prepared = prepareBundle();
        const graphemeReceipt = await captureReceipt(prepared);
        graphemeReceipt.runtimeCanary.fingerprintPayload.graphemes[0].tokens = ["drift"];
        graphemeReceipt.runtimeCanary.graphemeFingerprint = hash(
            graphemeReceipt.runtimeCanary.fingerprintPayload.graphemes,
        );
        graphemeReceipt.runtimeCanary.fingerprint = hash(
            graphemeReceipt.runtimeCanary.fingerprintPayload,
        );
        const sealedGrapheme = reseal(graphemeReceipt);
        const graphemeAttestation = attestReceipt(prepared, sealedGrapheme, "grapheme");
        const graphemeResult = verifyReceipt(prepared, sealedGrapheme, {
            attestationPath: graphemeAttestation,
            replayStore: join(prepared.directory, "grapheme-replay"),
        });
        expect(graphemeResult.status).toBe(1);
        expect(JSON.parse(String(graphemeResult.stdout))).toMatchObject({
            status: "FAIL",
            failures: expect.arrayContaining(["grapheme_drift"]),
        });

        const profileReceipt = await captureReceipt(prepared);
        profileReceipt.profileCanary.artifact.runtimeFingerprint = "char-phrase-v1:drift";
        profileReceipt.profileCanary.fingerprint = hash(profileReceipt.profileCanary.artifact);
        profileReceipt.pluginIdentity.loadedBuild.lexicalProfileRuntimeFingerprint =
            "char-phrase-v1:drift";
        const sealedProfile = reseal(profileReceipt);
        const profileAttestation = attestReceipt(prepared, sealedProfile, "profile");
        const profileResult = verifyReceipt(prepared, sealedProfile, {
            attestationPath: profileAttestation,
            replayStore: join(prepared.directory, "profile-replay"),
        });
        expect(profileResult.status).toBe(1);
        expect(JSON.parse(String(profileResult.stdout))).toMatchObject({
            status: "FAIL",
            failures: expect.arrayContaining(["selected_profile_runtime_drift"]),
        });
    });

    it("returns structured BLOCKED when no device evidence is supplied", () => {
        const result = spawnSync(process.execPath, [verifyPath, "--json"], { encoding: "utf8" });

        expect(result.status).toBe(2);
        expect(JSON.parse(String(result.stdout))).toMatchObject({
            status: "BLOCKED",
            blockers: expect.arrayContaining([
                "receipt_missing",
                "current_bundle_missing",
                "expected_device_identity_missing",
            ]),
            evidence: {
                repositoryNode: { nodeMajor: 22, requiredNodeMajor: 22 },
            },
        });
    });
});

function createTemporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "pa-fts-ios-runtime-"));
    temporaryDirectories.push(directory);
    return directory;
}

interface LocalProductionBuildFixture {
    root: string;
    sourceInputPath: string;
    suppliedCopyPath: string;
    pluginArtifactSource: string;
}

function createLocalProductionBuildFixture(): LocalProductionBuildFixture {
    const root = createTemporaryDirectory();
    for (const directory of ["src", "skills", "licenses", "dist", "scripts/lib"]) {
        mkdirSync(join(root, directory), { recursive: true });
    }
    const sourceInputPath = join(root, "src/main.ts");
    writeFileSync(sourceInputPath, "export const current = true;\n", "utf8");
    for (const path of [
        "esbuild.config.mjs",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "manifest.json",
        "manifest-beta.json",
        "styles.css",
        "tailwind.config.cjs",
    ]) {
        const contents = path.endsWith(".json") ? "{}\n" : `${path}\n`;
        writeFileSync(join(root, path), contents, "utf8");
    }
    for (const path of [
        "scripts/lib/fts-ios-runtime-artifact.mjs",
        "scripts/lib/fts-ios-runtime-bundle.mjs",
        "scripts/lib/fts-ios-runtime-session.mjs",
    ]) {
        writeFileSync(join(root, path), readFileSync(join(repositoryRoot, path)));
    }
    const pluginArtifactSource = trustedProductionArtifactSource();
    const repositoryDistPath = join(root, "dist/main.js");
    const suppliedCopyPath = join(root, "copied-main.js");
    writeFileSync(repositoryDistPath, pluginArtifactSource, "utf8");
    writeFileSync(suppliedCopyPath, pluginArtifactSource, "utf8");
    return { root, sourceInputPath, suppliedCopyPath, pluginArtifactSource };
}

function writeFixtureLocalProductionBuildProvenance(root: string): void {
    const artifactHelperUrl = pathToFileURL(join(
        repositoryRoot,
        "scripts/lib/fts-ios-runtime-artifact.mjs",
    )).href;
    const result = spawnSync(process.execPath, [
        "--input-type=module",
        "--eval",
        [
            `import { writeFtsIosLocalProductionBuildProvenance } from ${JSON.stringify(artifactHelperUrl)};`,
            `await writeFtsIosLocalProductionBuildProvenance({ repositoryRoot: ${JSON.stringify(root)} });`,
        ].join("\n"),
    ], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function probeFixtureLocalProductionArtifact(
    fixture: LocalProductionBuildFixture,
): Record<string, any> {
    const artifactHelperUrl = pathToFileURL(join(
        repositoryRoot,
        "scripts/lib/fts-ios-runtime-artifact.mjs",
    )).href;
    const probe = spawnSync(process.execPath, [
        "--input-type=module",
        "--eval",
        [
            `import { bindFtsIosRuntimeBundleToCheckoutProduction, readFtsIosPluginArtifactEvidence } from ${JSON.stringify(artifactHelperUrl)};`,
            `const evidence = await readFtsIosPluginArtifactEvidence(${JSON.stringify(fixture.suppliedCopyPath)}, {`,
            `  repositoryRoot: ${JSON.stringify(fixture.root)},`,
            `  requireCurrentRepositoryArtifact: true,`,
            `  requireLocalProductionBuildProvenance: true,`,
            `});`,
            `const bound = bindFtsIosRuntimeBundleToCheckoutProduction({ source: "globalThis.__fixture = true;" }, evidence);`,
            `process.stdout.write(JSON.stringify({ blockers: evidence.blockers, productionBuildEvidence: evidence.productionBuildEvidence, checkoutProductionBindingSha256: bound.checkoutProductionBindingSha256, boundBundleSha256: bound.sha256 }));`,
        ].join("\n"),
    ], { encoding: "utf8" });
    if (probe.status !== 0) throw new Error(probe.stderr || probe.stdout);
    return JSON.parse(probe.stdout);
}

function productionLikeArtifactSource(): string {
    return [
        "/* THIS IS A GENERATED/BUNDLED FILE BY ESBUILD */",
        "globalThis.__PA_PLUGIN_ID__ = 'personal-assistant';",
        "globalThis.getLoadedPluginBuildIdentity = function getLoadedPluginBuildIdentity() {};",
        "globalThis.__PA_PLUGIN_LOAD_IDENTITY__ = 'plugin-onload-cached-main-js';",
        "/*", "x".repeat(300 * 1024), "*/\n",
    ].join("\n");
}

function trustedProductionArtifactSource(): string {
    const executablePayload = Array.from(
        { length: 18_000 },
        (_, index) => `var pa_build_input_${index}=${index};`,
    ).join("");
    return [
        "/*\nTHIS IS A GENERATED/BUNDLED FILE BY ESBUILD\n*/",
        "\"use strict\";",
        executablePayload,
        "globalThis.getLoadedPluginBuildIdentity=function(){};",
        "globalThis.__PA_PLUGIN_LOAD_IDENTITY__='plugin-onload-cached-main-js';",
    ].join("\n");
}

function listFilesRecursively(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return listFilesRecursively(path);
        return entry.isFile() ? [path] : [];
    });
}

function currentCheckoutBuildEvidence(): { inputCount: number; sha256: string } {
    const paths = [
        ...listFilesRecursively(join(repositoryRoot, "src")),
        ...listFilesRecursively(join(repositoryRoot, "skills")),
        ...listFilesRecursively(join(repositoryRoot, "licenses")),
        ...[
            "esbuild.config.mjs",
            "package.json",
            "package-lock.json",
            "tsconfig.json",
            "manifest.json",
            "manifest-beta.json",
            "styles.css",
            "tailwind.config.cjs",
            "scripts/lib/fts-ios-runtime-artifact.mjs",
            "scripts/lib/fts-ios-runtime-bundle.mjs",
            "scripts/lib/fts-ios-runtime-session.mjs",
        ].map((path) => join(repositoryRoot, path)),
    ].sort();
    const records = paths.map((path) => {
        const contents = readFileSync(path);
        return {
            path: relative(repositoryRoot, path).split("\\").join("/"),
            byteLength: contents.byteLength,
            sha256: hash(contents),
        };
    });
    return {
        inputCount: records.length,
        sha256: hash(records.map((record) => (
            `${record.path}\u0000${record.byteLength}\u0000${record.sha256}`
        )).join("\n")),
    };
}

function rewriteSignedBuildReceipt(
    prepared: PreparedBundle,
    overrides: Record<string, unknown> = {},
): void {
    const attestorPublicKeyPem = readFileSync(prepared.attestorPublicKeyPath, "utf8");
    const checkout = currentCheckoutBuildEvidence();
    const payload = {
        schemaVersion: 1,
        receiptType: "pa.fts-ios-production-build",
        buildMode: "production",
        artifactPath: "dist/main.js",
        artifactSha256: hash(prepared.pluginArtifactSource),
        artifactByteLength: Buffer.byteLength(prepared.pluginArtifactSource),
        checkoutInputCount: checkout.inputCount,
        checkoutInputSha256: checkout.sha256,
        builtAt: new Date().toISOString(),
        attestorPublicKeySha256: hash(attestorPublicKeyPem),
        ...overrides,
    };
    const signatureBase64 = sign(
        null,
        Buffer.from(canonicalizeEvidence(payload)),
        prepared.attestorPrivateKeyPem,
    ).toString("base64");
    writeFileSync(
        prepared.buildReceiptPath,
        JSON.stringify({ ...payload, signatureBase64 }, null, 2),
        "utf8",
    );
}

function prepareBundle(): PreparedBundle {
    const directory = createTemporaryDirectory();
    const bundlePath = join(directory, "fts-ios-runtime-bundle.js");
    const pluginArtifactPath = join(directory, "main.js");
    const buildReceiptPath = join(directory, "production-build-receipt.json");
    const challengePath = join(directory, "challenge.json");
    const attestorPublicKeyPath = join(directory, "external-attestor-public-key.pem");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const attestorPublicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const attestorPrivateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const pluginArtifactSource = readFileSync(currentDistPluginArtifactPath, "utf8");
    writeFileSync(pluginArtifactPath, pluginArtifactSource, "utf8");
    writeFileSync(attestorPublicKeyPath, attestorPublicKeyPem, "utf8");
    const preparedForReceipt = {
        directory,
        bundlePath,
        bundleSource: "",
        pluginArtifactPath,
        pluginArtifactSource,
        buildReceiptPath,
        challengePath,
        attestorPublicKeyPath,
        attestorPrivateKeyPem,
        replayStore: join(directory, "replay-store"),
        report: {},
    } satisfies PreparedBundle;
    rewriteSignedBuildReceipt(preparedForReceipt);
    const result = spawnSync(process.execPath, [
        preparePath,
        "--output",
        bundlePath,
        "--plugin-artifact",
        pluginArtifactPath,
        "--build-receipt",
        buildReceiptPath,
        "--challenge-output",
        challengePath,
        "--trusted-attestor-public-key",
        attestorPublicKeyPath,
        "--vault-path",
        bundleVaultPath,
        "--json",
    ], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return {
        directory,
        bundlePath,
        bundleSource: readFileSync(bundlePath, "utf8"),
        pluginArtifactPath,
        pluginArtifactSource,
        buildReceiptPath,
        challengePath,
        attestorPublicKeyPath,
        attestorPrivateKeyPem,
        replayStore: join(directory, "replay-store"),
        report: JSON.parse(result.stdout),
    };
}

function prepareBaseBundle(): PreparedBundle {
    const directory = createTemporaryDirectory();
    const bundlePath = join(directory, "fts-ios-runtime-bundle.js");
    const pluginArtifactPath = join(directory, "main.js");
    const pluginArtifactSource = readFileSync(currentDistPluginArtifactPath, "utf8");
    writeFileSync(pluginArtifactPath, pluginArtifactSource, "utf8");
    const result = spawnSync(process.execPath, [
        preparePath,
        "--output", bundlePath,
        "--plugin-artifact", pluginArtifactPath,
        "--vault-path", bundleVaultPath,
        "--json",
    ], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return {
        directory,
        bundlePath,
        bundleSource: readFileSync(bundlePath, "utf8"),
        pluginArtifactPath,
        pluginArtifactSource,
        buildReceiptPath: join(directory, "not-requested-build-receipt.json"),
        challengePath: join(directory, "not-requested-challenge.json"),
        attestorPublicKeyPath: join(directory, "not-requested-key.pem"),
        attestorPrivateKeyPem: "",
        replayStore: join(directory, "not-requested-replay-store"),
        report: JSON.parse(result.stdout),
    };
}

async function captureReceipt(
    prepared: PreparedBundle,
    options: RuntimeOptions = {},
): Promise<Record<string, any>> {
    const userAgent = options.userAgent
        ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 obsidian/1.12.7";
    let loadedProfileFingerprint = options.loadedProfileFingerprint ?? "pending-profile";
    const plugin: Record<string, any> = {
        manifest: { ...currentPluginIdentity },
    };
    if (options.formalIdentity !== false) {
        plugin.getObsidianRuntimeIdentity = (): Record<string, string> => ({
            loadedAppVersion: options.loadedAppVersion ?? "1.13.4",
            loadedAppVersionSource: "obsidian.apiVersion",
        });
    }
    if (options.loadedBuildIdentity !== false) {
        plugin.getLoadedPluginBuildIdentity = async (): Promise<Record<string, unknown>> => ({
            schemaVersion: 1,
            pluginId: currentPluginIdentity.id,
            pluginVersion: currentPluginIdentity.version,
            pluginArtifactPath: pluginVaultArtifactPath,
            loadedPluginArtifactSha256: options.loadedPluginArtifactSha256
                ?? hash(prepared.pluginArtifactSource),
            lexicalProfileRuntimeFingerprint: loadedProfileFingerprint,
            capturedAtPluginLoad: new Date().toISOString(),
            identitySource: "plugin-onload-cached-main-js",
            blocker: null,
        });
    }
    const context: Record<string, any> = {
        Intl,
        TextEncoder,
        crypto: webcrypto,
        document: {},
        location: { href: options.locationHref ?? "app://obsidian.md/index.html" },
        navigator: {
            userAgent,
            platform: options.platform ?? "iPhone",
            maxTouchPoints: options.maxTouchPoints ?? 5,
            language: "en-SG",
        },
        app: {
            version: "1.13.4",
            plugins: { plugins: { [currentPluginIdentity.id]: plugin } },
            vault: {
                configDir: ".obsidian",
                adapter: {
                    read: async (path: string): Promise<string> => {
                        if (path === bundleVaultPath) return prepared.bundleSource;
                        if (path === pluginVaultArtifactPath) {
                            return options.diskPluginArtifactSource
                                ?? prepared.pluginArtifactSource;
                        }
                        throw new Error(`unexpected artifact path: ${path}`);
                    },
                },
            },
        },
        console,
    };
    if (options.electron) {
        context.process = {
            type: "renderer",
            platform: "darwin",
            arch: "arm64",
            versions: { electron: "39.8.3", node: "22.22.3", icu: "74.2" },
        };
    }
    context.globalThis = context;
    runInNewContext(prepared.bundleSource, context, { timeout: 5000 });
    const api = context.paFtsIosRuntimeReceipt as {
        capture(input: {
            deviceIdentitySha256: string | null;
            operatorObservation: Record<string, unknown> | null;
        }): Promise<Record<string, any>>;
    };
    let receipt = await api.capture({
        deviceIdentitySha256: options.deviceIdentitySha256 === undefined
            ? deviceIdentitySha256
            : options.deviceIdentitySha256,
        operatorObservation: options.operatorObservation === undefined ? {
            schemaVersion: 1,
            observationType: "pa.fts-ios-runtime-operator-observation",
            realDeviceObserved: true,
            iphoneMirroringObserved: true,
            safariWebInspectorObserved: true,
            inspectedApplicationId: "md.obsidian",
            runtimeFamily: "ios-wkwebview",
            observedAt: new Date().toISOString(),
            hardwareAttestationClaimed: false,
        } : options.operatorObservation,
    });
    if (options.loadedBuildIdentity !== false && !options.loadedProfileFingerprint) {
        loadedProfileFingerprint = receipt.profileCanary.artifact.runtimeFingerprint;
        receipt = await api.capture({
            deviceIdentitySha256: options.deviceIdentitySha256 === undefined
                ? deviceIdentitySha256
                : options.deviceIdentitySha256,
            operatorObservation: options.operatorObservation === undefined ? {
                schemaVersion: 1,
                observationType: "pa.fts-ios-runtime-operator-observation",
                realDeviceObserved: true,
                iphoneMirroringObserved: true,
                safariWebInspectorObserved: true,
                inspectedApplicationId: "md.obsidian",
                runtimeFamily: "ios-wkwebview",
                observedAt: new Date().toISOString(),
                hardwareAttestationClaimed: false,
            } : options.operatorObservation,
        });
    }
    return JSON.parse(JSON.stringify(receipt));
}

function attestReceipt(
    prepared: PreparedBundle,
    receipt: Record<string, any>,
    suffix = String(Math.random()),
    overrides: Record<string, unknown> = {},
): string {
    const attestationPath = join(prepared.directory, `attestation-${suffix}.json`);
    const challenge = JSON.parse(readFileSync(prepared.challengePath, "utf8"));
    const payload = {
        schemaVersion: 1,
        attestationType: "pa.fts-ios-runtime-session-attestation",
        trustBoundary:
            "operator-confirmed-safari-web-inspector-session-not-hardware-attestation",
        evidenceOrigin: "external-safari-web-inspector-operator-session",
        collector: "macos-safari-web-inspector",
        transport: "usb",
        inspectedApplicationId: "md.obsidian",
        runtimeFamily: "ios-wkwebview",
        challengeId: challenge.challengeId,
        challengePayloadSha256: challenge.challengePayloadSha256,
        receiptPayloadSha256: receipt.receiptPayloadSha256,
        deviceIdentitySha256,
        observedAt: new Date().toISOString(),
        attestorPublicKeySha256: challenge.attestorPublicKeySha256,
        pluginArtifactSha256: receipt.artifacts?.plugin?.sha256 ?? null,
        loadedPluginArtifactSha256:
            receipt.pluginIdentity?.loadedBuild?.loadedPluginArtifactSha256 ?? null,
        ...overrides,
    };
    const signatureBase64 = sign(
        null,
        Buffer.from(canonicalizeEvidence(payload)),
        prepared.attestorPrivateKeyPem,
    ).toString("base64");
    writeFileSync(
        attestationPath,
        JSON.stringify({ ...payload, signatureBase64 }, null, 2),
        "utf8",
    );
    return attestationPath;
}

function canonicalizeEvidence(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalizeEvidence(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object).sort().map((key) => (
            `${JSON.stringify(key)}:${canonicalizeEvidence(object[key])}`
        )).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function verifyReceipt(
    prepared: PreparedBundle,
    receipt: Record<string, any>,
    overrides: {
        attestationPath?: string;
        omitAttestation?: boolean;
        pluginArtifactPath?: string;
        deviceIdentitySha256?: string;
        replayStore?: string;
        omitExternalAssurance?: boolean;
    } = {},
): ReturnType<typeof spawnSync> {
    const receiptPath = join(prepared.directory, `receipt-${Math.random()}.json`);
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), "utf8");
    const args = [
        verifyPath,
        "--receipt", receiptPath,
        "--bundle", prepared.bundlePath,
        "--plugin-artifact", overrides.pluginArtifactPath ?? prepared.pluginArtifactPath,
        "--device-identity-sha256", overrides.deviceIdentitySha256 ?? deviceIdentitySha256,
        "--json",
    ];
    if (!overrides.omitExternalAssurance) {
        args.push(
            "--build-receipt", prepared.buildReceiptPath,
            "--challenge", prepared.challengePath,
            "--trusted-attestor-key-sha256", prepared.report.challenge.attestorPublicKeySha256,
            "--replay-store", overrides.replayStore ?? prepared.replayStore,
        );
    }
    if (!overrides.omitAttestation && !overrides.omitExternalAssurance) {
        args.push("--session-attestation", overrides.attestationPath ?? "missing-attestation.json");
    }
    return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function hash(value: string | Buffer | Record<string, unknown> | unknown[]): string {
    const bytes = typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value);
    return createHash("sha256").update(bytes).digest("hex");
}

function reseal(receipt: Record<string, any>): Record<string, any> {
    const sealed = structuredClone(receipt);
    delete sealed.receiptPayloadSha256;
    sealed.receiptPayloadSha256 = hash(sealed);
    return sealed;
}

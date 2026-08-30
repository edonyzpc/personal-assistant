import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RETRIEVAL_EVIDENCE_INTEGRITY_ERROR,
  verifyCurrentRetrievalEvidence,
} from "./lib/retrieval-evidence-receipt.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");

function usage() {
  return [
    "Usage: node scripts/retrieval-evidence-receipt-verify.mjs [--json] [--root <checkout>]",
    "",
    "Read-only verification of the current checkout/test-vault disk artifacts",
    "against the saved App functional-slice and desktop OPFS receipts.",
    "This does not claim that a currently running Obsidian process loaded those bytes.",
    "The unsealed App receipt is checked for binding/consistency, not authenticity.",
    "Exit codes: PASS=0, FAIL (including integrity errors)=1, BLOCKED=2.",
    "",
  ].join("\n");
}

function parseArguments(argv) {
  let format = "markdown";
  let rootDirectory = DEFAULT_REPOSITORY_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json" || argument === "--format=json") {
      format = "json";
    } else if (argument === "--format=markdown") {
      format = "markdown";
    } else if (argument === "--root") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--root requires a path");
      rootDirectory = resolve(next);
      index += 1;
    } else if (argument.startsWith("--root=")) {
      const next = argument.slice("--root=".length);
      if (!next) throw new Error("--root requires a path");
      rootDirectory = resolve(next);
    } else if (argument === "--help" || argument === "-h") {
      return { help: true, format, rootDirectory };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { help: false, format, rootDirectory };
}

function renderMarkdown(result) {
  return [
    "# Retrieval Evidence Current-Artifact Verification",
    "",
    `Status: **${result.status}**`,
    `App slice binding/consistency: ${result.receipts.app?.status ?? "FAIL"}`,
    `OPFS slice: ${result.receipts.opfs?.status ?? "FAIL"}`,
    "Live process currentness: **not claimed**",
    "App receipt cryptographic seal: **not claimed**",
    "App receipt authenticity: **not verified**",
    `Blockers: ${result.blockers.join(", ") || "none"}`,
    `Failures: ${result.failures.join(", ") || "none"}`,
    `Integrity errors: ${result.integrityErrors.join(", ") || "none"}`,
    "",
  ].join("\n");
}

function integrityFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    schemaVersion: 1,
    verificationType: "pa.retrieval-evidence-current-artifact-verification",
    status: "FAIL",
    exitCode: 1,
    errorCode: RETRIEVAL_EVIDENCE_INTEGRITY_ERROR,
    claim: {
      receiptBoundArtifactsMatchCurrentDisk: false,
      liveProcessCurrentnessClaimed: false,
      appReceiptCryptographicSealClaimed: false,
      appReceiptAuthenticityVerified: false,
      appRecoveryEvidenceDigestRecomputed: false,
    },
    receipts: {},
    artifacts: {},
    blockers: [],
    failures: [],
    integrityErrors: [`verifier_error:${message}`],
  };
}

async function main() {
  const argv = process.argv.slice(2);
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    const result = integrityFailure(error);
    if (argv.includes("--json") || argv.includes("--format=json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage()}`);
    }
    process.exitCode = result.exitCode;
    return;
  }
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  let result;
  try {
    result = await verifyCurrentRetrievalEvidence({
      rootDirectory: options.rootDirectory,
    });
  } catch (error) {
    result = integrityFailure(error);
  }
  process.stdout.write(options.format === "json"
    ? `${JSON.stringify(result, null, 2)}\n`
    : renderMarkdown(result));
  process.exitCode = result.exitCode;
}

await main();

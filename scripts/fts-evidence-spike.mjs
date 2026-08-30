import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import { buildFtsQuery } from "../src/vss/fts-query-builder.ts";
import {
  aggregateCases,
  createProfileDatabase,
  createStrategies,
  summarizeCase,
} from "./lib/fts-evidence-harness.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const FIXTURE_PATH = resolve(REPOSITORY_ROOT, "__fixtures__/fts-evidence/cases.json");
const SQLITE_WASM_PACKAGE_PATH = resolve(
  REPOSITORY_ROOT,
  "node_modules/@sqlite.org/sqlite-wasm/package.json",
);
const SURFACES = ["body", "fields"];

function parseArguments(argv) {
  let format = "markdown";
  for (const argument of argv) {
    if (argument === "--json" || argument === "--format=json") format = "json";
    else if (argument === "--format=markdown") format = "markdown";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { format };
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function validateFixture(fixture) {
  if (fixture?.version !== 1) throw new Error("Fixture version must be 1.");
  if (!Array.isArray(fixture.rows) || fixture.rows.length === 0) {
    throw new Error("Fixture rows must be a non-empty array.");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error("Fixture cases must be a non-empty array.");
  }

  assertUnique(fixture.rows.map((row) => row.id), "row id");
  assertUnique(fixture.cases.map((item) => item.id), "case id");

  const paths = new Set(fixture.rows.map((row) => row.path));
  for (const row of fixture.rows) {
    for (const field of ["id", "path", "title", "heading", "body"]) {
      if (typeof row[field] !== "string") throw new Error(`Row ${row.id ?? "?"} has invalid ${field}.`);
    }
    if (!Number.isInteger(row.chunkIndex) || row.chunkIndex < 0) {
      throw new Error(`Row ${row.id} has invalid chunkIndex.`);
    }
  }

  for (const item of fixture.cases) {
    if (typeof item.query !== "string" || item.query.trim().length === 0) {
      throw new Error(`Case ${item.id} has an empty query.`);
    }
    if (!Array.isArray(item.relevantPaths) || item.relevantPaths.length === 0) {
      throw new Error(`Case ${item.id} requires at least one relevant path.`);
    }
    if (!Array.isArray(item.forbiddenPaths) || item.forbiddenPaths.length < 2) {
      throw new Error(`Case ${item.id} requires at least two frozen hard negatives.`);
    }
    for (const path of [...item.relevantPaths, ...item.forbiddenPaths]) {
      if (!paths.has(path)) throw new Error(`Case ${item.id} references missing path ${path}.`);
    }
  }

  const groups = new Set(fixture.cases.map((item) => item.group));
  for (const required of ["cjk", "english_safety", "metadata", "diagnostic"]) {
    if (!groups.has(required)) throw new Error(`Fixture is missing group ${required}.`);
  }
}

function sqliteVersion(sqlite3) {
  const database = new sqlite3.oo1.DB(":memory:", "c");
  try {
    const rows = [];
    database.exec({ sql: "SELECT sqlite_version()", rowMode: "array", resultRows: rows });
    return String(rows[0]?.[0] ?? "unknown");
  } finally {
    database.close();
  }
}

function caseMap(profile) {
  return new Map(profile.cases.map((result) => [result.caseId, result]));
}

function evaluateEvidenceIntegrity(profiles) {
  const profileByKey = new Map(profiles.map((profile) => [`${profile.strategy}/${profile.surface}`, profile]));
  const baseline = caseMap(profileByKey.get("CURRENT/body"));
  const bigram = caseMap(profileByKey.get("BIGRAM-U1/body"));
  const intl = caseMap(profileByKey.get("INTL-WORD/body"));
  const trigram = caseMap(profileByKey.get("TRIGRAM/body"));
  const reasons = [];

  for (const caseId of ["cjk-two-character", "cjk-four-character"]) {
    if (baseline.get(caseId)?.metrics.hitAt8 !== 0) {
      reasons.push(`current_mismatch_not_reproduced:${caseId}`);
    }
  }
  for (const caseId of ["cjk-two-character", "cjk-single-character"]) {
    if (trigram.get(caseId)?.metrics.hitAt8 !== 0) {
      reasons.push(`trigram_short_query_limit_not_reproduced:${caseId}`);
    }
  }
  if (trigram.get("cjk-four-character")?.metrics.hitAt8 !== 1) {
    reasons.push("trigram_three_plus_control_not_reproduced:cjk-four-character");
  }
  if (bigram.get("cjk-mixed-unigram-bigram")?.queryChannel !== "primary+unigram") {
    reasons.push("bigram_unigram_intersection_not_exercised");
  }
  if (!intl.get("cjk-order-and-adjacency")?.matchExpression?.startsWith('"')) {
    reasons.push("intl_strict_phrase_semantics_not_exercised");
  }
  for (const profile of profiles.filter((item) => item.surface === "body")) {
    for (const check of profile.vocabularyChecks ?? []) {
      const valid = check.present ? check.documents > 0 : check.documents === 0;
      if (!valid) {
        reasons.push(
          `vocabulary_atomicity_failed:${profile.strategy}:${check.channel}:${check.term}:${check.present ? "missing" : "unexpected"}`,
        );
      }
    }
  }

  return { passed: reasons.length === 0, reasons };
}

function evaluateGates(strategies, profiles, fixture) {
  const profileByKey = new Map(profiles.map((profile) => [`${profile.strategy}/${profile.surface}`, profile]));
  const baselineBody = profileByKey.get("CURRENT/body");
  const baselineCases = caseMap(baselineBody);
  const cjkCases = fixture.cases.filter((item) => item.group === "cjk");
  const englishCases = fixture.cases.filter((item) => item.group === "english_safety");
  const metadataCases = fixture.cases.filter((item) => item.group === "metadata");

  return strategies.map((strategy) => {
    if (!strategy.eligibleForShipping) {
      return {
        strategy: strategy.id,
        eligible: false,
        decisionRole: strategy.role,
        reasons: [strategy.id === "TRIGRAM" ? "limitation_control_only" : "baseline_only"],
      };
    }

    const body = profileByKey.get(`${strategy.id}/body`);
    const fields = profileByKey.get(`${strategy.id}/fields`);
    const bodyCases = caseMap(body);
    const fieldCases = caseMap(fields);
    const reasons = [];

    const cjkMisses = cjkCases
      .filter((item) => bodyCases.get(item.id)?.metrics.hitAt8 !== 1)
      .map((item) => item.id);
    if (cjkMisses.length > 0) reasons.push(`cjk_top8_miss:${cjkMisses.join(",")}`);

    const englishRegressions = englishCases
      .filter((item) => {
        const baseline = baselineCases.get(item.id);
        const candidate = bodyCases.get(item.id);
        if (!baseline || !candidate || candidate.error) return true;
        return candidate.metrics.hitAt8 < baseline.metrics.hitAt8
          || candidate.metrics.reciprocalRank < baseline.metrics.reciprocalRank;
      })
      .map((item) => item.id);
    if (englishRegressions.length > 0) {
      reasons.push(`english_or_code_regression:${englishRegressions.join(",")}`);
    }

    const metadataMisses = metadataCases
      .filter((item) => fieldCases.get(item.id)?.metrics.hitAt8 !== 1)
      .map((item) => item.id);
    if (metadataMisses.length > 0) reasons.push(`metadata_top8_miss:${metadataMisses.join(",")}`);

    const hardNegativeWins = fixture.cases
      .filter((item) => item.group !== "diagnostic")
      .filter((item) => {
        const result = item.group === "metadata" ? fieldCases.get(item.id) : bodyCases.get(item.id);
        if (!result || result.error) return true;
        const relevantRank = result.uniquePaths.findIndex((path) => item.relevantPaths.includes(path));
        const forbiddenRank = result.uniquePaths.findIndex((path) => item.forbiddenPaths.includes(path));
        return forbiddenRank >= 0 && (relevantRank < 0 || forbiddenRank < relevantRank);
      })
      .map((item) => item.id);
    if (hardNegativeWins.length > 0) {
      reasons.push(`hard_negative_outranks_relevant:${hardNegativeWins.join(",")}`);
    }

    const errors = body.aggregate.errors + fields.aggregate.errors;
    if (errors > 0) reasons.push(`match_errors:${errors}`);

    return {
      strategy: strategy.id,
      eligible: reasons.length === 0,
      decisionRole: strategy.role,
      reasons,
    };
  });
}

async function runProfile(sqlite3, fixture, strategy, surface) {
  let harness;
  try {
    harness = createProfileDatabase(sqlite3, fixture.rows, strategy, surface);
  } catch (error) {
    return {
      strategy: strategy.id,
      role: strategy.role,
      surface,
      initializationError: String(error),
      index: null,
      aggregate: { cases: fixture.cases.length, errors: fixture.cases.length },
      cases: fixture.cases.map((item) => summarizeCase(item, null, [], { p50Ms: 0, p95Ms: 0 }, error)),
      vocabulary: [],
      vocabularyChecks: [],
      strategyDiagnostics: strategy.diagnostics?.() ?? null,
    };
  }

  try {
    const cases = fixture.cases.map((item) => {
      const queryPlan = strategy.buildQuery(item.query);
      if (!queryPlan) {
        return summarizeCase(item, null, [], { p50Ms: 0, p95Ms: 0 }, "empty_match_expression");
      }
      try {
        const hits = harness.search(queryPlan);
        const latency = harness.measure(queryPlan);
        return summarizeCase(item, queryPlan, hits, latency, null);
      } catch (error) {
        return summarizeCase(item, queryPlan, [], { p50Ms: 0, p95Ms: 0 }, error);
      }
    });

    return {
      strategy: strategy.id,
      role: strategy.role,
      surface,
      initializationError: null,
      index: harness.index,
      aggregate: aggregateCases(cases),
      cases,
      vocabulary: harness.vocabulary(),
      vocabularyChecks: (strategy.vocabularyAssertions ?? []).map((assertion) => ({
        ...assertion,
        documents: harness.vocabularyDocumentCount(assertion.channel, assertion.term),
      })),
      strategyDiagnostics: strategy.diagnostics?.() ?? null,
    };
  } finally {
    harness.close();
  }
}

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderMarkdown(report) {
  const intlFingerprint = report.profiles.find(
    (profile) => profile.strategy === "INTL-WORD" && profile.surface === "body",
  )?.strategyDiagnostics?.fingerprint ?? "unavailable";
  const lines = [
    "# B-125 Phase 0A FTS Evidence",
    "",
    `- Fixture: \`${report.fixture.path}\` (v${report.fixture.version}, ${report.fixture.rows} rows, ${report.fixture.cases} cases)`,
    `- Runtime: Node ${report.environment.node}, SQLite ${report.environment.sqlite}, sqlite-wasm ${report.environment.sqliteWasm}`,
    "- Scope: in-memory FTS-only evidence; no production schema, OPFS, vector, RRF, reranker, provider, or Markdown mutation",
    `- Evidence integrity: ${report.integrity.passed ? "PASS" : `FAIL (${report.integrity.reasons.join(", ")})`}`,
    `- INTL-WORD canary fingerprint: \`${intlFingerprint}\``,
    "",
    "## Admission gates",
    "",
    "| Strategy | Role | OD-06A eligible | Reasons |",
    "| --- | --- | --- | --- |",
  ];

  for (const gate of report.gates) {
    lines.push(`| ${gate.strategy} | ${gate.decisionRole} | ${gate.eligible ? "PASS" : "NO"} | ${markdownEscape(gate.reasons.join("; ") || "all gates passed")} |`);
  }

  lines.push(
    "",
    `Shortlist: ${report.shortlist.length > 0 ? report.shortlist.map((item) => `\`${item}\``).join("、") : "none"}`,
    "",
    "## Profile summary",
    "",
    "| Strategy | Surface | Errors | Hit@8 | MRR | Recall@8 | Precision@8 | Unique paths@8 | Duplicate ratio | Index bytes | Warm p95 ms |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const profile of report.profiles) {
    const aggregate = profile.aggregate;
    lines.push(
      `| ${profile.strategy} | ${profile.surface} | ${aggregate.errors} | ${aggregate.hitAt8 ?? 0} | ${aggregate.meanReciprocalRank ?? 0} | ${aggregate.recallAt8 ?? 0} | ${aggregate.precisionAt8 ?? 0} | ${aggregate.meanUniquePathsAt8 ?? 0} | ${aggregate.meanDuplicateChunkRatio ?? 0} | ${profile.index?.estimatedBytes ?? 0} | ${aggregate.warmP95Ms ?? 0} |`,
    );
  }

  lines.push("", "## Gate-case detail", "");
  for (const profile of report.profiles.filter((item) => item.surface === "body")) {
    lines.push(`### ${profile.strategy}`);
    lines.push("", "| Case | Group | Match | Hit@8 | Rank | Top paths | Error |", "| --- | --- | --- | ---: | ---: | --- | --- |");
    for (const result of profile.cases.filter((item) => item.group !== "diagnostic")) {
      const rank = result.metrics.reciprocalRank > 0
        ? Math.round(1 / result.metrics.reciprocalRank)
        : "—";
      lines.push(
        `| ${result.caseId} | ${result.group} | \`${result.queryChannel ?? "—"}:${markdownEscape(result.matchExpression ?? "") }\` | ${result.metrics.hitAt8} | ${rank} | ${markdownEscape(result.uniquePaths.slice(0, 4).join(", "))} | ${markdownEscape(result.error ?? "")} |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Interpretation boundary",
    "",
    "Metrics project canonical paths from each raw Top-8 chunk pool; they do not imply eight unique paths. Passing only makes a strategy eligible for OD-06A. Tiny-fixture index bytes and Node timings are anomaly diagnostics, not production or iPhone performance claims. Field weights, OR breadth, RRF, candidate depth and deadlines remain Phase 0B engineering calibration.",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const { format } = parseArguments(process.argv.slice(2));
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const sqliteWasmPackage = JSON.parse(await readFile(SQLITE_WASM_PACKAGE_PATH, "utf8"));
  validateFixture(fixture);

  const sqlite3 = await sqlite3InitModule();
  const strategies = createStrategies(buildFtsQuery);
  const profiles = [];
  for (const strategy of strategies) {
    for (const surface of SURFACES) {
      profiles.push(await runProfile(sqlite3, fixture, strategy, surface));
    }
  }

  const integrity = evaluateEvidenceIntegrity(profiles);
  const gates = evaluateGates(strategies, profiles, fixture).map((gate) => {
    if (!gate.eligible || integrity.passed) return gate;
    return {
      ...gate,
      eligible: false,
      reasons: [...gate.reasons, "evidence_integrity_failed"],
    };
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixture: {
      path: "__fixtures__/fts-evidence/cases.json",
      version: fixture.version,
      rows: fixture.rows.length,
      cases: fixture.cases.length,
    },
    environment: {
      node: process.version,
      sqlite: sqliteVersion(sqlite3),
      sqliteWasm: String(sqliteWasmPackage.version ?? "unknown"),
      platform: `${process.platform}/${process.arch}`,
    },
    integrity,
    gates,
    shortlist: gates.filter((gate) => gate.eligible).map((gate) => gate.strategy),
    profiles,
  };

  process.stdout.write(format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import { buildFtsQuery } from "../src/vss/fts-query-builder.ts";
import {
  CHAR_PHRASE_PROFILE_ID,
  charPhraseTokens,
  getCharPhraseRuntimeCanaryFingerprint,
  splitCharPhraseRuns,
} from "../src/vss/lexical-normalizer.ts";
import { fuseRRF } from "../src/vss/rrf.ts";
import { RETRIEVAL_CALIBRATION_PROFILE } from "../src/vss/retrieval-calibration.ts";
import {
  createProfileDatabase,
  createStrategies,
  percentile,
  round,
} from "./lib/fts-evidence-harness.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const FIXTURE_PATH = resolve(REPOSITORY_ROOT, "__fixtures__/fts-evidence/calibration-cases.json");
const SQLITE_WASM_PACKAGE_PATH = resolve(
  REPOSITORY_ROOT,
  "node_modules/@sqlite.org/sqlite-wasm/package.json",
);

const RUNTIME_CANDIDATE = RETRIEVAL_CALIBRATION_PROFILE.candidate.standard;
const RUNTIME_BASELINE = RETRIEVAL_CALIBRATION_PROFILE.baseline.standard;

export const SCORE_THRESHOLD = RETRIEVAL_CALIBRATION_PROFILE.scoreThreshold;
export const DIRECT_PATH_CAP = 12;
export const FINAL_PROXY_CAP = 8;
export const PIPELINE_ORDER = Object.freeze([
  "rrf_raw_chunks",
  "score_threshold_0.01",
  "canonical_path_collapse",
  "direct_cap_12",
  "fixture_relevance_proxy_cap_8",
]);

export const QUERY_MODES = Object.freeze([
  RUNTIME_BASELINE.queryMode,
  RUNTIME_CANDIDATE.queryMode,
]);
export const BM25_PROFILES = Object.freeze([
  Object.freeze({ id: "equal", weights: RUNTIME_BASELINE.bm25Weights }),
  Object.freeze({ id: "metadata_balanced", weights: Object.freeze([2, 1.5, 1, 0.5]) }),
  Object.freeze({ id: "title_heading_strong", weights: Object.freeze([4, 2.5, 1, 0.5]) }),
  Object.freeze({ id: "body_favor", weights: RUNTIME_CANDIDATE.bm25Weights }),
]);
export const DEPTH_PROFILES = Object.freeze([
  Object.freeze({
    id: "compact",
    vectorRaw: RUNTIME_CANDIDATE.vectorRaw,
    lexicalRaw: RUNTIME_CANDIDATE.lexicalRaw,
    fusionRaw: RUNTIME_CANDIDATE.fusionRaw,
  }),
  Object.freeze({ id: "balanced", vectorRaw: 12, lexicalRaw: 18, fusionRaw: 24 }),
  Object.freeze({ id: "expanded", vectorRaw: 18, lexicalRaw: 24, fusionRaw: 36 }),
]);
export const RRF_PROFILES = Object.freeze([
  Object.freeze({ id: "k30_equal", k: RUNTIME_CANDIDATE.rrf.k, sourceWeights: RUNTIME_CANDIDATE.rrf.sourceWeights }),
  Object.freeze({ id: "k60_equal", k: RUNTIME_BASELINE.rrf.k, sourceWeights: RUNTIME_BASELINE.rrf.sourceWeights }),
  Object.freeze({ id: "k60_vector_boost", k: 60, sourceWeights: Object.freeze([1.25, 1]) }),
  Object.freeze({ id: "k60_lexical_boost", k: 60, sourceWeights: Object.freeze([1, 1.25]) }),
  Object.freeze({ id: "k80_attenuated", k: 80, sourceWeights: Object.freeze([0.9, 0.9]) }),
]);

function parseArguments(argv) {
  let format = "markdown";
  let top = 8;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json" || argument === "--format=json") format = "json";
    else if (argument === "--format=markdown") format = "markdown";
    else if (argument.startsWith("--top=")) top = Number(argument.slice("--top=".length));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(top) || top < 1 || top > 20) {
    throw new Error("--top must be an integer from 1 to 20.");
  }
  return { format, top };
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function assertRuntimeProfileParity() {
  const profile = RETRIEVAL_CALIBRATION_PROFILE;
  if (profile.provisional !== true || profile.defaultEnabled !== false) {
    throw new Error("EC-02 runtime calibration must remain provisional and default-off.");
  }
  if (RUNTIME_CANDIDATE.evidence !== "offline_provisional_winner") {
    throw new Error("EC-02 standard candidate must retain its provisional evidence label.");
  }
  if (profile.candidate.relaxed.evidence !== "inherited_unvalidated") {
    throw new Error("EC-02 relaxed parameters must remain explicitly inherited and unvalidated.");
  }
  const runtimeIdentity = `${RUNTIME_CANDIDATE.queryMode}/body_favor/compact/k30_equal`;
  if (runtimeIdentity !== profile.offlineWinnerId) {
    throw new Error(`Runtime candidate identity drifted: ${runtimeIdentity}.`);
  }
}

export function validateCalibrationFixture(fixture) {
  if (fixture?.version !== 1) throw new Error("Calibration fixture version must be 1.");
  if (fixture?.profile !== CHAR_PHRASE_PROFILE_ID) {
    throw new Error(`Calibration fixture must target ${CHAR_PHRASE_PROFILE_ID}.`);
  }
  if (!Array.isArray(fixture.rows) || fixture.rows.length === 0) {
    throw new Error("Calibration fixture rows must be non-empty.");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length < 12 || fixture.cases.length > 16) {
    throw new Error("Calibration fixture must contain 12-16 cases.");
  }

  assertUnique(fixture.rows.map((row) => row.id), "row id");
  assertUnique(fixture.cases.map((item) => item.id), "case id");
  const rowIds = new Set(fixture.rows.map((row) => row.id));
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
    if (item.split !== "calibration" && item.split !== "holdout") {
      throw new Error(`Case ${item.id} has invalid split.`);
    }
    if (!Array.isArray(item.tags) || item.tags.length === 0) {
      throw new Error(`Case ${item.id} requires tags.`);
    }
    if (typeof item.query !== "string" || item.query.trim().length === 0) {
      throw new Error(`Case ${item.id} has an empty query.`);
    }
    if (!Array.isArray(item.clauses) || item.clauses.length === 0
      || item.clauses.some((clause) => typeof clause !== "string" || clause.trim().length === 0)) {
      throw new Error(`Case ${item.id} requires non-empty clauses.`);
    }
    if (!Array.isArray(item.relevantPaths) || item.relevantPaths.length === 0) {
      throw new Error(`Case ${item.id} requires relevantPaths.`);
    }
    if (!Array.isArray(item.controlledDistractorPaths)
      || item.controlledDistractorPaths.length < 2) {
      throw new Error(`Case ${item.id} requires at least two controlled distractors.`);
    }
    const relevant = new Set(item.relevantPaths);
    for (const path of [...item.relevantPaths, ...item.controlledDistractorPaths]) {
      if (!paths.has(path)) throw new Error(`Case ${item.id} references missing path ${path}.`);
      if (relevant.has(path) && item.controlledDistractorPaths.includes(path)) {
        throw new Error(`Case ${item.id} overlaps relevant and distractor path ${path}.`);
      }
    }
    if (!Array.isArray(item.vectorRankedChunkIds) || item.vectorRankedChunkIds.length < 12) {
      throw new Error(`Case ${item.id} requires at least 12 frozen vector-ranked chunks.`);
    }
    assertUnique(item.vectorRankedChunkIds, `vector row id in ${item.id}`);
    for (const rowId of item.vectorRankedChunkIds) {
      if (!rowIds.has(rowId)) throw new Error(`Case ${item.id} references missing row ${rowId}.`);
    }
  }

  const holdouts = fixture.cases.filter((item) => item.split === "holdout");
  if (holdouts.length < 4) throw new Error("Calibration fixture requires at least four holdouts.");
  const tags = new Set(fixture.cases.flatMap((item) => item.tags));
  for (const required of ["cross_field", "clause_or", "long_note", "collision"]) {
    if (!tags.has(required)) throw new Error(`Calibration fixture is missing tag ${required}.`);
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

function fixtureFingerprint(fixture) {
  return createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
}

function metricForPaths(paths, relevantPaths, cap = paths.length) {
  const projected = paths.slice(0, cap);
  const relevant = new Set(relevantPaths);
  const firstRelevant = projected.findIndex((path) => relevant.has(path));
  const found = new Set(projected.filter((path) => relevant.has(path)));
  return {
    hitAt1: firstRelevant === 0 ? 1 : 0,
    reciprocalRank: firstRelevant >= 0 ? round(1 / (firstRelevant + 1)) : 0,
    recall: round(found.size / relevant.size),
    precision: projected.length > 0 ? round(found.size / projected.length) : 0,
    uniquePaths: new Set(projected).size,
    firstRelevantRank: firstRelevant >= 0 ? firstRelevant + 1 : null,
  };
}

function collapsePaths(chunks) {
  const seen = new Set();
  const paths = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.path)) continue;
    seen.add(chunk.path);
    paths.push({ path: chunk.path, score: chunk.score, rowId: chunk.rowId, chunkIndex: chunk.chunkIndex });
  }
  return paths;
}

function buildFinalProxy(directPaths, relevantPaths) {
  const relevant = new Set(relevantPaths);
  const accepted = directPaths.filter((candidate) => relevant.has(candidate.path));
  const rejected = directPaths.filter((candidate) => !relevant.has(candidate.path));
  return [...accepted, ...rejected].slice(0, FINAL_PROXY_CAP);
}

function expectedCjkPhrases(clauses) {
  return clauses.flatMap((clause) => splitCharPhraseRuns(clause)
    .filter((run) => run.isCjk)
    .map((run) => charPhraseTokens(run.value))
    .filter((tokens) => tokens.length > 1)
    .map((tokens) => `"${tokens.join(" ")}"`));
}

function buildProductionQueryPlan(query, mode) {
  const expression = buildFtsQuery(query, mode);
  return expression ? { legs: [{ channel: "primary", expression }] } : null;
}

function buildQueryEvidence(fixture) {
  return fixture.cases.flatMap((item) => QUERY_MODES.map((mode) => {
    const plan = buildProductionQueryPlan(item.query, mode);
    if (!plan) throw new Error(`Case ${item.id}/${mode} produced no query plan.`);
    const expression = plan.legs[0].expression;
    const missingPhrases = expectedCjkPhrases(item.clauses)
      .filter((phrase) => !expression.includes(phrase));
    const topLevelOr = item.clauses.length > 1 && mode === "clause_OR";
    return {
      caseId: item.id,
      mode,
      expression,
      cjkRunPhrasesPreserved: missingPhrases.length === 0,
      topLevelOperator: topLevelOr ? "OR" : "AND",
      topLevelShapeValid: topLevelOr
        ? expression.includes(" OR ")
        : !expression.includes(" OR "),
      missingPhrases,
    };
  }));
}

function makeConfig(queryMode, bm25, depth, rrf) {
  return {
    id: `${queryMode}/${bm25.id}/${depth.id}/${rrf.id}`,
    queryMode,
    bm25: { id: bm25.id, title: bm25.weights[0], heading: bm25.weights[1], body: bm25.weights[2], path: bm25.weights[3] },
    depth: { ...depth },
    rrf: {
      id: rrf.id,
      k: rrf.k,
      vectorWeight: rrf.sourceWeights[0],
      lexicalWeight: rrf.sourceWeights[1],
    },
  };
}

function lexicalCacheKey(caseId, queryMode, bm25Id, lexicalRaw) {
  return `${caseId}|${queryMode}|${bm25Id}|${lexicalRaw}`;
}

function getLexicalRun(harness, item, queryMode, bm25, lexicalRaw, cache) {
  const key = lexicalCacheKey(item.id, queryMode, bm25.id, lexicalRaw);
  const cached = cache.get(key);
  if (cached) return cached;
  const queryPlan = buildProductionQueryPlan(item.query, queryMode);
  const rawChunks = harness.search(queryPlan, lexicalRaw, { bm25Weights: bm25.weights });
  const collapsed = collapsePaths(rawChunks);
  const result = {
    queryPlan,
    rawChunks,
    collapsed,
    metrics: metricForPaths(collapsed.map((entry) => entry.path), item.relevantPaths),
    duplicateChunkRatio: rawChunks.length > 0
      ? round((rawChunks.length - collapsed.length) / rawChunks.length)
      : 0,
  };
  cache.set(key, result);
  return result;
}

function evaluateCase(item, config, harness, rowByFixtureId, rowByNumericId, lexicalCache) {
  const bm25 = BM25_PROFILES.find((profile) => profile.id === config.bm25.id);
  const lexical = getLexicalRun(
    harness,
    item,
    config.queryMode,
    bm25,
    config.depth.lexicalRaw,
    lexicalCache,
  );
  const vectorIds = item.vectorRankedChunkIds
    .slice(0, config.depth.vectorRaw)
    .map((id) => rowByFixtureId.get(id).rowId);
  const lexicalIds = lexical.rawChunks.map((hit) => hit.rowId);
  const sourceWeights = [config.rrf.vectorWeight, config.rrf.lexicalWeight];
  const fused = fuseRRF(
    [vectorIds, lexicalIds],
    config.depth.fusionRaw,
    { k: config.rrf.k, sourceWeights },
  );
  const permuted = fuseRRF(
    [lexicalIds, vectorIds],
    config.depth.fusionRaw,
    { k: config.rrf.k, sourceWeights: [sourceWeights[1], sourceWeights[0]] },
  );
  const permutationStable = JSON.stringify([...fused.entries()]) === JSON.stringify([...permuted.entries()]);
  const rawFusedChunks = [...fused.entries()].flatMap(([rowId, score]) => {
    const row = rowByNumericId.get(rowId);
    return row ? [{ rowId, fixtureRowId: row.id, path: row.path, chunkIndex: row.chunkIndex, score }] : [];
  });
  const thresholdChunks = rawFusedChunks.filter((chunk) => chunk.score >= SCORE_THRESHOLD);
  const collapsedPaths = collapsePaths(thresholdChunks);
  const directPaths = collapsedPaths.slice(0, DIRECT_PATH_CAP);
  const finalProxyPaths = buildFinalProxy(directPaths, item.relevantPaths);
  const directRowIds = new Set(directPaths.map((entry) => entry.rowId));
  const finalProxyRowIds = new Set(finalProxyPaths.map((entry) => entry.rowId));
  const distractors = new Set(item.controlledDistractorPaths);
  return {
    caseId: item.id,
    split: item.split,
    tags: item.tags,
    lexical: {
      rawChunkCount: lexical.rawChunks.length,
      pathCount: lexical.collapsed.length,
      duplicateChunkRatio: lexical.duplicateChunkRatio,
      metrics: lexical.metrics,
    },
    stageCounts: {
      rrfRawChunks: rawFusedChunks.length,
      thresholdChunks: thresholdChunks.length,
      thresholdRemoved: rawFusedChunks.length - thresholdChunks.length,
      collapsedPaths: collapsedPaths.length,
      duplicateChunksCollapsed: thresholdChunks.length - collapsedPaths.length,
      directPaths: directPaths.length,
      finalProxyPaths: finalProxyPaths.length,
    },
    direct: metricForPaths(directPaths.map((entry) => entry.path), item.relevantPaths, DIRECT_PATH_CAP),
    finalProxy: metricForPaths(finalProxyPaths.map((entry) => entry.path), item.relevantPaths, FINAL_PROXY_CAP),
    controlledDistractorTop1: directPaths.length > 0 && distractors.has(directPaths[0].path) ? 1 : 0,
    permutationStable,
    detail: {
      matchExpression: lexical.queryPlan.legs[0].expression,
      lexicalRawChunks: lexical.rawChunks,
      lexicalCollapsedPaths: lexical.collapsed,
      rrfRawChunks: rawFusedChunks.map((entry) => ({
        ...entry,
        score: round(entry.score, 9),
        passesThreshold: entry.score >= SCORE_THRESHOLD,
      })),
      collapsedPaths: collapsedPaths.map((entry) => ({
        ...entry,
        score: round(entry.score, 9),
        withinDirectCap: directRowIds.has(entry.rowId),
        inFinalProxy: finalProxyRowIds.has(entry.rowId),
      })),
    },
  };
}

function average(outcomes, selector) {
  if (outcomes.length === 0) return 0;
  return round(outcomes.reduce((sum, outcome) => sum + selector(outcome), 0) / outcomes.length);
}

function aggregateOutcomes(outcomes) {
  return {
    cases: outcomes.length,
    lexicalRecallAtRawDepth: average(outcomes, (outcome) => outcome.lexical.metrics.recall),
    lexicalMRR: average(outcomes, (outcome) => outcome.lexical.metrics.reciprocalRank),
    directRecallAt12: average(outcomes, (outcome) => outcome.direct.recall),
    directMRR: average(outcomes, (outcome) => outcome.direct.reciprocalRank),
    finalProxyRecallAt8: average(outcomes, (outcome) => outcome.finalProxy.recall),
    finalProxyMRR: average(outcomes, (outcome) => outcome.finalProxy.reciprocalRank),
    controlledDistractorTop1Rate: average(outcomes, (outcome) => outcome.controlledDistractorTop1),
    meanLexicalRawChunks: average(outcomes, (outcome) => outcome.lexical.rawChunkCount),
    meanLexicalUniquePaths: average(outcomes, (outcome) => outcome.lexical.pathCount),
    meanLexicalDuplicateRatio: average(outcomes, (outcome) => outcome.lexical.duplicateChunkRatio),
    meanRrfRawChunks: average(outcomes, (outcome) => outcome.stageCounts.rrfRawChunks),
    meanThresholdRemoved: average(outcomes, (outcome) => outcome.stageCounts.thresholdRemoved),
    meanCollapsedPaths: average(outcomes, (outcome) => outcome.stageCounts.collapsedPaths),
    meanDirectPaths: average(outcomes, (outcome) => outcome.stageCounts.directPaths),
    sourcePermutationStable: outcomes.every((outcome) => outcome.permutationStable),
  };
}

function summarizeConfiguration(config, outcomes) {
  const calibration = outcomes.filter((outcome) => outcome.split === "calibration");
  const holdout = outcomes.filter((outcome) => outcome.split === "holdout");
  const aggregateByTag = (items) => Object.fromEntries(
    ["cross_field", "clause_or", "long_note", "collision"].map((tag) => [
      tag,
      aggregateOutcomes(items.filter((outcome) => outcome.tags.includes(tag))),
    ]),
  );
  return {
    config,
    calibration: aggregateOutcomes(calibration),
    holdout: aggregateOutcomes(holdout),
    calibrationByTag: aggregateByTag(calibration),
    holdoutByTag: aggregateByTag(holdout),
    byTag: aggregateByTag(outcomes),
    sourcePermutationStable: outcomes.every((outcome) => outcome.permutationStable),
  };
}

function compareConfigurations(left, right) {
  const descending = [
    [left.calibration.finalProxyRecallAt8, right.calibration.finalProxyRecallAt8],
    [left.calibration.directRecallAt12, right.calibration.directRecallAt12],
    [left.calibration.directMRR, right.calibration.directMRR],
    [
      left.calibrationByTag.clause_or.lexicalRecallAtRawDepth,
      right.calibrationByTag.clause_or.lexicalRecallAtRawDepth,
    ],
    [1 - left.calibration.controlledDistractorTop1Rate, 1 - right.calibration.controlledDistractorTop1Rate],
  ];
  for (const [leftValue, rightValue] of descending) {
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  const leftCost = left.config.depth.vectorRaw + left.config.depth.lexicalRaw + left.config.depth.fusionRaw;
  const rightCost = right.config.depth.vectorRaw + right.config.depth.lexicalRaw + right.config.depth.fusionRaw;
  return leftCost - rightCost || left.config.id.localeCompare(right.config.id);
}

function calibrationSignature(summary) {
  return JSON.stringify([
    summary.calibration.lexicalRecallAtRawDepth,
    summary.calibration.lexicalMRR,
    summary.calibration.directRecallAt12,
    summary.calibration.directMRR,
    summary.calibration.controlledDistractorTop1Rate,
    summary.calibration.meanLexicalRawChunks,
    summary.calibration.meanLexicalUniquePaths,
    summary.calibration.meanRrfRawChunks,
    summary.calibration.meanThresholdRemoved,
    summary.calibrationByTag.cross_field.lexicalMRR,
    summary.calibrationByTag.clause_or.lexicalRecallAtRawDepth,
    summary.calibrationByTag.collision.controlledDistractorTop1Rate,
  ]);
}

function dimensionHasMeasuredEffect(grid, dimension) {
  const groups = new Map();
  for (const summary of grid) {
    const dimensions = {
      queryMode: summary.config.queryMode,
      bm25: summary.config.bm25.id,
      depth: summary.config.depth.id,
      rrf: summary.config.rrf.id,
    };
    const groupKey = Object.entries(dimensions)
      .filter(([key]) => key !== dimension)
      .map(([key, value]) => `${key}=${value}`)
      .join("|");
    const signatures = groups.get(groupKey) ?? new Set();
    signatures.add(calibrationSignature(summary));
    groups.set(groupKey, signatures);
  }
  return [...groups.values()].some((signatures) => signatures.size > 1);
}

function evaluateIntegrity(fixture, queryEvidence, grid, caseEvidence) {
  const baseline = caseEvidence.filter((item) => item.config.queryMode === "strict_AND");
  const orEvidence = caseEvidence.filter((item) => item.config.queryMode === "clause_OR");
  const byCase = (items) => new Map(items.map((item) => [item.caseId, item]));
  const strictCases = byCase(baseline);
  const orCases = byCase(orEvidence);
  const orUplifts = fixture.cases
    .filter((item) => item.tags.includes("clause_or"))
    .filter((item) => (orCases.get(item.id)?.lexical.metrics.recall ?? 0)
      > (strictCases.get(item.id)?.lexical.metrics.recall ?? 0))
    .map((item) => item.id);
  const longNotePressure = caseEvidence
    .filter((item) => item.tags.includes("long_note"))
    .filter((item) => item.lexical.duplicateChunkRatio >= 0.5)
    .map((item) => item.caseId);
  const collisionHits = caseEvidence
    .filter((item) => item.tags.includes("collision"))
    .filter((item) => item.detail.lexicalCollapsedPaths.some((entry) => {
      const definition = fixture.cases.find((fixtureCase) => fixtureCase.id === item.caseId);
      return definition.controlledDistractorPaths.includes(entry.path);
    }))
    .map((item) => item.caseId);
  const reasons = [];
  const sensitivity = Object.fromEntries(
    ["queryMode", "bm25", "depth", "rrf"].map((dimension) => [
      dimension,
      dimensionHasMeasuredEffect(grid, dimension),
    ]),
  );
  if (queryEvidence.some((entry) => !entry.cjkRunPhrasesPreserved || !entry.topLevelShapeValid)) {
    reasons.push("query_shape_invariant_failed");
  }
  if (orUplifts.length < 2) reasons.push("clause_or_uplift_not_exercised");
  if (new Set(longNotePressure).size < 2) reasons.push("long_note_duplicate_pressure_not_exercised");
  if (new Set(collisionHits).size < 3) reasons.push("controlled_collision_not_exercised");
  if (grid.some((item) => !item.sourcePermutationStable)) reasons.push("rrf_source_permutation_unstable");
  for (const [dimension, exercised] of Object.entries(sensitivity)) {
    if (!exercised) reasons.push(`${dimension}_grid_has_no_measured_effect`);
  }
  return {
    passed: reasons.length === 0,
    reasons,
    holdoutCases: fixture.cases.filter((item) => item.split === "holdout").map((item) => item.id),
    orUplifts,
    longNotePressure: [...new Set(longNotePressure)],
    collisionHits: [...new Set(collisionHits)],
    sensitivity,
    allRrfSourcePermutationsStable: grid.every((item) => item.sourcePermutationStable),
  };
}

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderMarkdown(report, top) {
  const lines = [
    "# B-125 Phase 0B EC-02 Offline Calibration Evidence",
    "",
    `- Fixture: \`${report.fixture.path}\` (v${report.fixture.version}, ${report.fixture.rows} rows, ${report.fixture.cases} cases, ${report.fixture.holdouts} holdouts)`,
    `- Runtime: Node ${report.environment.node}, SQLite ${report.environment.sqlite}, sqlite-wasm ${report.environment.sqliteWasm}`,
    `- Production seams: \`${report.profile.id}\` normalizer canary \`${report.profile.runtimeCanary}\`; \`fuseRRF\` with parameter-only k/source weights`,
    `- Runtime candidate: \`${report.runtimeCalibration.profileId}\` v${report.runtimeCalibration.profileVersion}; provisional=${report.runtimeCalibration.provisional}; defaultEnabled=${report.runtimeCalibration.defaultEnabled}`,
    `- Integrity: ${report.integrity.passed ? "PASS" : `FAIL (${report.integrity.reasons.join(", ")})`}`,
    `- Pipeline: \`${report.pipeline.order.join(" -> ")}\``,
    "- Status: PROVISIONAL ONLY. This offline fixture cannot close supported-runtime, slowest-device, lexical-deadline, OPFS, or real reranker gates.",
    "",
    "## Provisional candidates (selected on calibration split only)",
    "",
    "| Config | Train direct R@12 | Train final proxy R@8 | Holdout direct R@12 | Holdout final proxy R@8 | OR lexical recall | Collision distractor@1 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const candidate of report.provisionalCandidates.slice(0, top)) {
    lines.push(`| ${markdownEscape(candidate.config.id)} | ${candidate.calibration.directRecallAt12} | ${candidate.calibration.finalProxyRecallAt8} | ${candidate.holdout.directRecallAt12} | ${candidate.holdout.finalProxyRecallAt8} | ${candidate.calibrationByTag.clause_or.lexicalRecallAtRawDepth} | ${candidate.calibration.controlledDistractorTop1Rate} |`);
  }

  lines.push(
    "",
    "The ranking above never uses holdout metrics. Equal-looking fixture scores remain separate parameter candidates until real supported-runtime and slow-device evidence exists.",
    "",
    "## Best provisional case evidence",
    "",
    `Config: \`${report.bestProvisionalConfig.id}\``,
    "",
    "| Case | Split | Lex raw/path | Dup ratio | Direct recall/MRR | Final proxy recall/MRR | Threshold removed |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const item of report.caseEvidence) {
    lines.push(`| ${item.caseId} | ${item.split} | ${item.lexical.rawChunkCount}/${item.lexical.pathCount} | ${item.lexical.duplicateChunkRatio} | ${item.direct.recall}/${item.direct.reciprocalRank} | ${item.finalProxy.recall}/${item.finalProxy.reciprocalRank} | ${item.stageCounts.thresholdRemoved} |`);
  }

  lines.push(
    "",
    "## Query and collision diagnostics",
    "",
    `- OR recall uplifts: ${report.integrity.orUplifts.map((id) => `\`${id}\``).join(", ") || "none"}`,
    `- Long-note duplicate-pressure cases: ${report.integrity.longNotePressure.map((id) => `\`${id}\``).join(", ") || "none"}`,
    `- Controlled collision hits: ${report.integrity.collisionHits.map((id) => `\`${id}\``).join(", ") || "none"}`,
    `- Measured grid effects: ${Object.entries(report.integrity.sensitivity).map(([dimension, exercised]) => `${dimension}=${exercised ? "yes" : "no"}`).join(", ")}`,
    `- Source-order permutation: ${report.integrity.allRrfSourcePermutationsStable ? "PASS" : "FAIL"}`,
    "",
    "## Current-machine anomaly timings",
    "",
    `- Four-field FTS index: ${report.profile.index.estimatedBytes} estimated bytes; build ${report.profile.index.elapsedMs} ms`,
    `- Best-config warm query p50/p95: ${report.timing.warmP50Ms}/${report.timing.warmP95Ms} ms (${report.timing.samples} case-level samples)`,
    "",
    "## Interpretation boundary",
    "",
    report.interpretationBoundary,
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const { format, top } = parseArguments(process.argv.slice(2));
  assertRuntimeProfileParity();
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const sqliteWasmPackage = JSON.parse(await readFile(SQLITE_WASM_PACKAGE_PATH, "utf8"));
  validateCalibrationFixture(fixture);
  const queryEvidence = buildQueryEvidence(fixture);

  const sqlite3 = await sqlite3InitModule();
  const strategy = createStrategies(buildFtsQuery).find((item) => item.id === "CHAR-PHRASE");
  if (!strategy) throw new Error("CHAR-PHRASE evidence strategy is unavailable.");
  const harness = createProfileDatabase(sqlite3, fixture.rows, strategy, "fields");
  try {
    const rowByFixtureId = new Map(fixture.rows.map((row, index) => [row.id, { ...row, rowId: index + 1 }]));
    const rowByNumericId = new Map([...rowByFixtureId.values()].map((row) => [row.rowId, row]));
    const lexicalCache = new Map();
    const gridWithOutcomes = [];
    for (const queryMode of QUERY_MODES) {
      for (const bm25 of BM25_PROFILES) {
        for (const depth of DEPTH_PROFILES) {
          for (const rrf of RRF_PROFILES) {
            const config = makeConfig(queryMode, bm25, depth, rrf);
            const outcomes = fixture.cases.map((item) => evaluateCase(
              item,
              config,
              harness,
              rowByFixtureId,
              rowByNumericId,
              lexicalCache,
            ));
            gridWithOutcomes.push({ summary: summarizeConfiguration(config, outcomes), outcomes });
          }
        }
      }
    }
    const ranked = [...gridWithOutcomes].sort((left, right) => compareConfigurations(left.summary, right.summary));
    const best = ranked[0];
    if (best.summary.config.id !== RETRIEVAL_CALIBRATION_PROFILE.offlineWinnerId) {
      throw new Error(
        `Frozen provisional winner drifted: ${best.summary.config.id} != ${RETRIEVAL_CALIBRATION_PROFILE.offlineWinnerId}.`,
      );
    }
    const alternateMode = best.summary.config.queryMode === "strict_AND" ? "clause_OR" : "strict_AND";
    const integrityComparison = ranked.find((item) => (
      item.summary.config.queryMode === alternateMode
      && item.summary.config.bm25.id === best.summary.config.bm25.id
      && item.summary.config.depth.id === best.summary.config.depth.id
      && item.summary.config.rrf.id === best.summary.config.rrf.id
    ));
    const integrityCaseEvidence = [
      ...best.outcomes.map((outcome) => ({ ...outcome, config: best.summary.config })),
      ...(integrityComparison?.outcomes ?? []).map((outcome) => ({
        ...outcome,
        config: integrityComparison?.summary.config,
      })),
    ];
    const integrity = evaluateIntegrity(
      fixture,
      queryEvidence,
      ranked.map((item) => item.summary),
      integrityCaseEvidence,
    );

    const timingSamples = best.outcomes.map((outcome) => {
      const definition = fixture.cases.find((item) => item.id === outcome.caseId);
      const queryPlan = buildProductionQueryPlan(definition.query, best.summary.config.queryMode);
      return harness.measure(queryPlan, 10, {
        bm25Weights: BM25_PROFILES.find((profile) => profile.id === best.summary.config.bm25.id).weights,
      });
    });
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      fixture: {
        path: "__fixtures__/fts-evidence/calibration-cases.json",
        version: fixture.version,
        fingerprint: fixtureFingerprint(fixture),
        rows: fixture.rows.length,
        cases: fixture.cases.length,
        holdouts: fixture.cases.filter((item) => item.split === "holdout").length,
      },
      environment: {
        node: process.version,
        sqlite: sqliteVersion(sqlite3),
        sqliteWasm: String(sqliteWasmPackage.version ?? "unknown"),
        platform: `${process.platform}/${process.arch}`,
      },
      profile: {
        id: CHAR_PHRASE_PROFILE_ID,
        runtimeCanary: getCharPhraseRuntimeCanaryFingerprint(),
        index: harness.index,
      },
      runtimeCalibration: {
        profileId: RETRIEVAL_CALIBRATION_PROFILE.id,
        profileVersion: RETRIEVAL_CALIBRATION_PROFILE.version,
        provisional: RETRIEVAL_CALIBRATION_PROFILE.provisional,
        defaultEnabled: RETRIEVAL_CALIBRATION_PROFILE.defaultEnabled,
        offlineWinnerId: RETRIEVAL_CALIBRATION_PROFILE.offlineWinnerId,
        queryInputContract: "fixture.query through production buildFtsQuery(string, mode)",
        standardCandidate: RUNTIME_CANDIDATE,
        relaxedEvidence: RETRIEVAL_CALIBRATION_PROFILE.candidate.relaxed.evidence,
      },
      pipeline: {
        order: PIPELINE_ORDER,
        scoreThreshold: SCORE_THRESHOLD,
        thresholdAppliedTo: "unrounded RRF score",
        directPathCap: DIRECT_PATH_CAP,
        finalProxyCap: FINAL_PROXY_CAP,
        finalProxyDefinition: "Fixture relevance-oracle stable partition over direct candidates; not a model reranker result.",
      },
      gridDefinition: {
        selectionSplit: "calibration",
        holdoutUsedForSelection: false,
        queryModes: QUERY_MODES,
        bm25Profiles: BM25_PROFILES,
        depthProfiles: DEPTH_PROFILES,
        rrfProfiles: RRF_PROFILES,
        configurations: ranked.length,
      },
      integrity,
      queryEvidence,
      provisionalCandidates: ranked.slice(0, top).map((item) => item.summary),
      gridResults: ranked.map((item) => ({
        configId: item.summary.config.id,
        trainDirectRecallAt12: item.summary.calibration.directRecallAt12,
        trainDirectMRR: item.summary.calibration.directMRR,
        trainFinalProxyRecallAt8: item.summary.calibration.finalProxyRecallAt8,
        holdoutDirectRecallAt12: item.summary.holdout.directRecallAt12,
        holdoutFinalProxyRecallAt8: item.summary.holdout.finalProxyRecallAt8,
        clauseOrLexicalRecall: item.summary.calibrationByTag.clause_or.lexicalRecallAtRawDepth,
        collisionDistractorTop1Rate: item.summary.byTag.collision.controlledDistractorTop1Rate,
        meanThresholdRemoved: item.summary.calibration.meanThresholdRemoved,
        sourcePermutationStable: item.summary.sourcePermutationStable,
      })),
      bestProvisionalConfig: best.summary.config,
      caseEvidence: best.outcomes,
      timing: {
        samples: timingSamples.length,
        warmP50Ms: percentile(timingSamples.map((item) => item.p50Ms), 50),
        warmP95Ms: percentile(timingSamples.map((item) => item.p95Ms), 95),
        perCase: timingSamples,
      },
      interpretationBoundary: "All parameter rankings are provisional offline evidence. Synthetic frozen vector ranks are not embedding quality, the final stage is an oracle-shaped proxy rather than the production reranker, and this current-machine in-memory sqlite-wasm timing is not OPFS or slowest-supported-device evidence. Supported desktop/mobile normalizer canaries, slowest-device latency/UI-stall, production lexical deadline/fallback, real reranker, and real-vault quality gates remain open.",
    };

    if (!integrity.passed) {
      throw new Error(`Calibration evidence integrity failed: ${integrity.reasons.join(", ")}`);
    }
    process.stdout.write(format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report, top));
  } finally {
    harness.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

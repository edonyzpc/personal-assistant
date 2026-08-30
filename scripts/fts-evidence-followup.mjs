import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import { buildFtsQuery } from "../src/vss/fts-query-builder.ts";
import {
  createProfileDatabase,
  createStrategies,
  intlWordTokens,
  normalizeBoundedPathSurface,
  percentile,
  round,
  summarizeCase,
} from "./lib/fts-evidence-harness.mjs";
import {
  generateScaleCorpus,
  SCALE_QUERY_WORKLOAD,
} from "./lib/fts-scale-corpus.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = dirname(SCRIPT_PATH);
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const FROZEN_FIXTURE_PATH = resolve(REPOSITORY_ROOT, "__fixtures__/fts-evidence/cases.json");
const CONTEXT_FIXTURE_PATH = resolve(REPOSITORY_ROOT, "__fixtures__/fts-evidence/context-canaries.json");
const SHORTLIST = ["BIGRAM-U1", "CHAR-PHRASE", "INTL-WORD"];

function parseInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function parseArguments(argv) {
  const options = {
    format: "markdown",
    mode: "all",
    sizes: [2000, 10000, 25000],
    repeats: 3,
    worker: false,
    strategy: null,
    size: null,
    repeat: null,
  };

  for (const argument of argv) {
    if (argument === "--json" || argument === "--format=json") options.format = "json";
    else if (argument === "--format=markdown") options.format = "markdown";
    else if (argument === "--worker") options.worker = true;
    else if (argument.startsWith("--mode=")) options.mode = argument.slice("--mode=".length);
    else if (argument.startsWith("--sizes=")) {
      options.sizes = argument
        .slice("--sizes=".length)
        .split(",")
        .map((value) => parseInteger(value, "scale size"));
    } else if (argument.startsWith("--repeats=")) {
      options.repeats = parseInteger(argument.slice("--repeats=".length), "repeats");
    } else if (argument.startsWith("--strategy=")) {
      options.strategy = argument.slice("--strategy=".length);
    } else if (argument.startsWith("--size=")) {
      options.size = parseInteger(argument.slice("--size=".length), "worker size");
    } else if (argument.startsWith("--repeat=")) {
      options.repeat = parseInteger(argument.slice("--repeat=".length), "worker repeat");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!new Set(["all", "context", "scale"]).has(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}`);
  }
  return options;
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function shortlistStrategies() {
  const byId = new Map(createStrategies(buildFtsQuery).map((strategy) => [strategy.id, strategy]));
  return SHORTLIST.map((id) => {
    const strategy = byId.get(id);
    if (!strategy) throw new Error(`Missing shortlist strategy ${id}.`);
    return strategy;
  });
}

function countOccurrences(text, query) {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - query.length) {
    const index = text.indexOf(query, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, query.length);
  }
  return count;
}

function wordBoundaryDiagnostic(canary) {
  const occurrenceStart = canary.body.indexOf(canary.query);
  const occurrenceEnd = occurrenceStart + canary.query.length;
  const segmenter = new Intl.Segmenter(canary.language, { granularity: "word" });
  const bodySegments = [...segmenter.segment(canary.body)].map((item) => ({
    segment: item.segment,
    index: item.index,
    end: item.index + item.segment.length,
    isWordLike: Boolean(item.isWordLike),
  }));
  const queryTokens = [...segmenter.segment(canary.query)]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment);
  const containedTokens = bodySegments
    .filter((item) => item.isWordLike && item.index >= occurrenceStart && item.end <= occurrenceEnd)
    .map((item) => item.segment);
  const startsAtBoundary = bodySegments.some((item) => item.isWordLike && item.index === occurrenceStart);
  const endsAtBoundary = bodySegments.some((item) => item.isWordLike && item.end === occurrenceEnd);
  const boundaryAligned = startsAtBoundary
    && endsAtBoundary
    && JSON.stringify(containedTokens) === JSON.stringify(queryTokens);

  return {
    locale: canary.language,
    resolvedLocale: segmenter.resolvedOptions().locale,
    occurrenceStart,
    occurrenceEnd,
    queryTokens,
    containedTokens,
    boundaryAligned,
    bodyTokens: bodySegments.filter((item) => item.isWordLike),
  };
}

function validateContextFixture(fixture) {
  if (fixture?.version !== 1 || !Array.isArray(fixture.canaries) || fixture.canaries.length === 0) {
    throw new Error("Context fixture must be version 1 with non-empty canaries.");
  }
  const ids = new Set();
  for (const canary of fixture.canaries) {
    if (ids.has(canary.id)) throw new Error(`Duplicate context canary ${canary.id}.`);
    ids.add(canary.id);
    if (!new Set(["relevant", "irrelevant"]).has(canary.semanticExpectation)) {
      throw new Error(`Invalid semantic expectation for ${canary.id}.`);
    }
    if (!new Set(["boundary-hard-positive", "boundary-collision", "aligned-positive-control"]).has(canary.diagnosticClass)) {
      throw new Error(`Invalid diagnostic class for ${canary.id}.`);
    }
    if (countOccurrences(canary.body, canary.query) !== 1) {
      throw new Error(`Context canary ${canary.id} must contain its query exactly once.`);
    }
  }
}

async function runContextEvidence(sqlite3, frozenFixture, contextFixture) {
  validateContextFixture(contextFixture);
  const rows = contextFixture.canaries.map((canary, index) => ({
    id: canary.id,
    path: `context/${canary.id}.md`,
    chunkIndex: 0,
    title: `Context canary ${index + 1}`,
    heading: "Body-only evidence",
    body: canary.body,
  }));
  const profiles = [];

  for (const strategy of shortlistStrategies()) {
    const contextDatabase = createProfileDatabase(sqlite3, rows, strategy, "body");
    const controlDatabase = createProfileDatabase(sqlite3, frozenFixture.rows, strategy, "body");
    try {
      const cases = contextFixture.canaries.map((canary) => {
        const plan = strategy.buildQuery(canary.query);
        const hits = plan ? contextDatabase.search(plan, rows.length) : [];
        const actualHit = hits.some((hit) => hit.path === `context/${canary.id}.md`);
        const boundary = wordBoundaryDiagnostic(canary);
        return {
          id: canary.id,
          language: canary.language,
          diagnosticClass: canary.diagnosticClass,
          query: canary.query,
          semanticExpectation: canary.semanticExpectation,
          actualHit,
          semanticPass: canary.semanticExpectation === "relevant" ? actualHit : !actualHit,
          queryPlan: plan,
          boundary,
          intlQueryTokens: intlWordTokens(canary.query),
          intlBodyTokens: intlWordTokens(canary.body),
        };
      });

      const frozenById = new Map(frozenFixture.cases.map((item) => [item.id, item]));
      const controls = contextFixture.stableControlCaseIds.map((caseId) => {
        const definition = frozenById.get(caseId);
        if (!definition) throw new Error(`Missing stable control ${caseId}.`);
        const plan = strategy.buildQuery(definition.query);
        const hits = plan ? controlDatabase.search(plan) : [];
        const summary = summarizeCase(definition, plan, hits, { p50Ms: 0, p95Ms: 0 }, null);
        const relevantRank = summary.uniquePaths.findIndex((path) => definition.relevantPaths.includes(path));
        const forbiddenRank = summary.uniquePaths.findIndex((path) => definition.forbiddenPaths.includes(path));
        return {
          caseId,
          passed: summary.metrics.hitAt8 === 1
            && !(forbiddenRank >= 0 && (relevantRank < 0 || forbiddenRank < relevantRank)),
          uniquePaths: summary.uniquePaths,
        };
      });

      const hardPositives = cases.filter((item) => item.diagnosticClass === "boundary-hard-positive");
      const collisions = cases.filter((item) => item.diagnosticClass === "boundary-collision");
      const alignedControls = cases.filter((item) => item.diagnosticClass === "aligned-positive-control");
      profiles.push({
        strategy: strategy.id,
        boundaryHardPositiveMatches: {
          matched: hardPositives.filter((item) => item.actualHit).length,
          total: hardPositives.length,
        },
        semanticCollisionAvoidance: {
          avoided: collisions.filter((item) => !item.actualHit).length,
          total: collisions.length,
        },
        alignedPositiveControls: {
          matched: alignedControls.filter((item) => item.actualHit).length,
          total: alignedControls.length,
        },
        stableControlsPassed: controls.filter((item) => item.passed).length,
        stableControlsTotal: controls.length,
        cases,
        controls,
      });
    } finally {
      contextDatabase.close();
      controlDatabase.close();
    }
  }

  const integrityReasons = [];
  if (profiles.some((profile) => profile.stableControlsPassed !== profile.stableControlsTotal)) {
    integrityReasons.push("stable_control_failure");
  }

  return {
    fixture: "__fixtures__/fts-evidence/context-canaries.json",
    canaries: contextFixture.canaries.length,
    integrity: { passed: integrityReasons.length === 0, reasons: integrityReasons },
    profiles,
  };
}

function prewarmStrategy(rows, strategy) {
  for (const row of rows.slice(0, 200)) {
    for (const channel of strategy.channels) {
      channel.transform(row.title);
      channel.transform(row.heading);
      channel.transform(row.body);
      channel.transform(normalizeBoundedPathSurface(row.path));
    }
  }
  for (const item of SCALE_QUERY_WORKLOAD) strategy.buildQuery(item.query);
}

function measureScaleQueries(database, strategy) {
  const entries = SCALE_QUERY_WORKLOAD.map((item) => {
    const plan = strategy.buildQuery(item.query);
    if (!plan) throw new Error(`Empty scale query plan for ${item.id}.`);
    return { ...item, plan, matches: database.count(plan), samplesMs: [] };
  });
  for (const entry of entries) {
    for (let warmup = 0; warmup < 5; warmup += 1) database.search(entry.plan);
  }
  const baseOrder = [0, 3, 1, 4, 2, 5];
  for (let sweep = 0; sweep < 20; sweep += 1) {
    const rotation = sweep % baseOrder.length;
    const order = [...baseOrder.slice(rotation), ...baseOrder.slice(0, rotation)];
    for (const index of order) {
      const entry = entries[index];
      const startedAt = performance.now();
      database.search(entry.plan);
      entry.samplesMs.push(performance.now() - startedAt);
    }
  }
  const allSamples = entries.flatMap((entry) => entry.samplesMs);
  return {
    warmP50Ms: percentile(allSamples, 50),
    warmP95Ms: percentile(allSamples, 95),
    queries: entries.map(({ plan: _plan, samplesMs, ...entry }) => ({
      ...entry,
      p50Ms: percentile(samplesMs, 50),
      p95Ms: percentile(samplesMs, 95),
    })),
  };
}

function runFrozenQualityCases(database, strategy, frozenFixture) {
  return frozenFixture.cases.map((definition) => {
    try {
      const plan = strategy.buildQuery(definition.query);
      if (!plan) throw new Error("empty_query_plan");
      const hits = database.search(plan);
      return summarizeCase(definition, plan, hits, { p50Ms: 0, p95Ms: 0 }, null);
    } catch (error) {
      return summarizeCase(definition, null, [], { p50Ms: 0, p95Ms: 0 }, error);
    }
  });
}

async function runScaleWorker(options) {
  if (!SHORTLIST.includes(options.strategy) || options.size === null || options.repeat === null) {
    throw new Error("Scale worker requires a shortlist strategy, size and repeat.");
  }
  const frozenFixture = await loadJson(FROZEN_FIXTURE_PATH);
  const frozenQueries = frozenFixture.cases.map((item) => item.query.normalize("NFC"));
  const corpus = generateScaleCorpus(frozenFixture.rows, frozenQueries, options.size);
  const strategy = shortlistStrategies().find((item) => item.id === options.strategy);
  prewarmStrategy(corpus.rows, strategy);
  const sqlite3 = await sqlite3InitModule();
  const database = createProfileDatabase(sqlite3, corpus.rows, strategy, "fields");

  try {
    const qualityCases = runFrozenQualityCases(database, strategy, frozenFixture);
    const baselineDatabase = createProfileDatabase(sqlite3, frozenFixture.rows, strategy, "fields");
    let baselineCases;
    try {
      baselineCases = runFrozenQualityCases(baselineDatabase, strategy, frozenFixture);
    } finally {
      baselineDatabase.close();
    }
    const qualityGateCases = qualityCases.filter((item) => item.group !== "diagnostic");
    const baselineById = new Map(baselineCases.map((item) => [item.caseId, item]));
    const definitionById = new Map(frozenFixture.cases.map((item) => [item.id, item]));
    const hardNegativeOrderingPassed = qualityGateCases.every((item) => {
      const definition = definitionById.get(item.caseId);
      const relevantRank = item.uniquePaths.findIndex((path) => definition.relevantPaths.includes(path));
      const forbiddenRank = item.uniquePaths.findIndex((path) => definition.forbiddenPaths.includes(path));
      return !(forbiddenRank >= 0 && (relevantRank < 0 || forbiddenRank < relevantRank));
    });
    const rankStabilityPassed = qualityGateCases.every((item) => {
      const baseline = baselineById.get(item.caseId);
      return item.error === null
        && baseline?.error === null
        && item.metrics.hitAt8 >= baseline.metrics.hitAt8
        && item.metrics.reciprocalRank >= baseline.metrics.reciprocalRank;
    });
    const qualityPassed = hardNegativeOrderingPassed && rankStabilityPassed;
    const query = measureScaleQueries(database, strategy);

    return {
      schemaVersion: 1,
      strategy: strategy.id,
      size: options.size,
      repeat: options.repeat,
      corpus: {
        generatorVersion: corpus.generatorVersion,
        seed: corpus.seed,
        fingerprint: corpus.fingerprint,
        ...corpus.stats,
      },
      index: database.index,
      quality: {
        passed: qualityPassed,
        cases: qualityCases.length,
        errors: qualityCases.filter((item) => item.error !== null).length,
        gateHitAt1: qualityGateCases.filter((item) => item.metrics.hitAt1 === 1).length,
        gateHitAt8: qualityGateCases.filter((item) => item.metrics.hitAt8 === 1).length,
        gateCases: qualityGateCases.length,
        hardNegativeOrderingPassed,
        rankStabilityPassed,
        failures: qualityGateCases
          .filter((item) => {
            const baseline = baselineById.get(item.caseId);
            return item.error !== null
              || baseline?.error !== null
              || item.metrics.hitAt8 < baseline.metrics.hitAt8
              || item.metrics.reciprocalRank < baseline.metrics.reciprocalRank;
          })
          .map((item) => ({
            caseId: item.caseId,
            error: item.error,
            baselineReciprocalRank: baselineById.get(item.caseId)?.metrics.reciprocalRank ?? null,
            actualReciprocalRank: item.metrics.reciprocalRank,
            uniquePaths: item.uniquePaths,
          })),
      },
      query,
      maxRssKb: process.resourceUsage().maxRSS,
    };
  } finally {
    database.close();
  }
}

function median(values) {
  return percentile(values, 50);
}

function aggregateScaleRuns(runs, sizes) {
  const aggregates = [];
  for (const size of sizes) {
    const hashes = new Set(runs.filter((run) => run.size === size).map((run) => run.corpus.fingerprint));
    if (hashes.size !== 1) throw new Error(`Scale corpus fingerprint drift at ${size} chunks.`);
    for (const strategy of SHORTLIST) {
      const group = runs.filter((run) => run.size === size && run.strategy === strategy);
      if (group.length === 0) throw new Error(`Missing scale runs for ${strategy}/${size}.`);
      const build = group.map((run) => run.index.elapsedMs);
      const queryP95 = group.map((run) => run.query.warmP95Ms);
      const queryDetails = Object.fromEntries(SCALE_QUERY_WORKLOAD.map((workload) => {
        const results = group.map((run) => run.query.queries.find((item) => item.id === workload.id));
        return [workload.id, {
          matches: results[0].matches,
          p50Ms: median(results.map((item) => item.p50Ms)),
          p95Ms: median(results.map((item) => item.p95Ms)),
          p95Variation: round(
            (Math.max(...results.map((item) => item.p95Ms)) - Math.min(...results.map((item) => item.p95Ms)))
            / Math.max(0.0001, median(results.map((item) => item.p95Ms))),
          ),
        }];
      }));
      aggregates.push({
        size,
        strategy,
        repeats: group.length,
        qualityPassed: group.every((run) => run.quality.passed),
        rawUtf8Bytes: group[0].corpus.rawUtf8Bytes,
        bodyCharsP50: group[0].corpus.bodyCharsP50,
        bodyCharsP95: group[0].corpus.bodyCharsP95,
        allocatedFtsBytes: median(group.map((run) => run.index.estimatedBytes)),
        liveFtsBytes: median(group.map((run) => run.index.liveEstimatedBytes)),
        freelistBytes: median(group.map((run) => run.index.freelistBytes)),
        allocatedToRawRatio: round(median(group.map((run) => run.index.estimatedBytes)) / group[0].corpus.rawUtf8Bytes),
        buildMedianMs: median(build),
        buildMinMs: Math.min(...build),
        buildMaxMs: Math.max(...build),
        buildVariation: round((Math.max(...build) - Math.min(...build)) / Math.max(1, median(build))),
        warmP50Ms: median(group.map((run) => run.query.warmP50Ms)),
        warmP95Ms: median(queryP95),
        queryP95Variation: round((Math.max(...queryP95) - Math.min(...queryP95)) / Math.max(0.0001, median(queryP95))),
        maxRssKb: Math.max(...group.map((run) => run.maxRssKb)),
        queryDetails,
      });
    }
  }
  return aggregates;
}

function runScaleCoordinator(options) {
  const runs = [];
  const totalRuns = options.sizes.length * options.repeats * SHORTLIST.length;
  let completedRuns = 0;
  options.sizes.forEach((size, sizeIndex) => {
    for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
      const rotation = (sizeIndex + repeat - 1) % SHORTLIST.length;
      const order = [...SHORTLIST.slice(rotation), ...SHORTLIST.slice(0, rotation)];
      for (const strategy of order) {
        process.stderr.write(`[scale ${completedRuns + 1}/${totalRuns}] ${strategy} ${size} chunks repeat ${repeat}\n`);
        const child = spawnSync(
          process.execPath,
          [
            ...process.execArgv,
            SCRIPT_PATH,
            "--worker",
            `--strategy=${strategy}`,
            `--size=${size}`,
            `--repeat=${repeat}`,
            "--format=json",
          ],
          {
            cwd: REPOSITORY_ROOT,
            encoding: "utf8",
            timeout: 120_000,
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        if (child.error || child.status !== 0) {
          throw new Error(
            `Scale worker failed for ${strategy}/${size}/r${repeat}: ${child.error ?? child.stderr ?? `status ${child.status}`}`,
          );
        }
        runs.push(JSON.parse(child.stdout));
        completedRuns += 1;
      }
    }
  });

  for (const size of options.sizes) {
    for (const workload of SCALE_QUERY_WORKLOAD) {
      const counts = new Set(runs
        .filter((run) => run.size === size)
        .map((run) => run.query.queries.find((item) => item.id === workload.id)?.matches));
      if (counts.size !== 1) {
        throw new Error(`Scale query match-count drift for ${workload.id}/${size}: ${[...counts].join(",")}`);
      }
    }
  }

  return {
    sizes: options.sizes,
    repeats: options.repeats,
    isolation: "fresh Node/sqlite-wasm process per strategy × size × repeat; Latin-rotated order",
    timeoutMsPerWorker: 120000,
    aggregates: aggregateScaleRuns(runs, options.sizes),
    runs,
  };
}

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatMiB(bytes) {
  return round(bytes / (1024 * 1024), 2);
}

function renderMarkdown(report) {
  const lines = [
    "# B-125 FTS Follow-up Evidence",
    "",
    `- Runtime: Node ${report.environment.node} / ICU ${report.environment.icu} / Unicode ${report.environment.unicode}`,
    "- Scope: non-production in-memory sqlite-wasm evidence only; no OPFS, vector, RRF, reranker, provider or production schema change",
  ];

  if (report.context) {
    lines.push(
      "",
      "## Context word-boundary comparison",
      "",
      `Evidence integrity: ${report.context.integrity.passed ? "PASS" : `FAIL (${report.context.integrity.reasons.join(", ")})`}`,
      "",
      "| Strategy | Boundary hard-positive MATCH | Semantic-collision avoidance | Aligned positive controls | Stable controls |",
      "| --- | ---: | ---: | ---: | ---: |",
    );
    for (const profile of report.context.profiles) {
      lines.push(`| ${profile.strategy} | ${profile.boundaryHardPositiveMatches.matched}/${profile.boundaryHardPositiveMatches.total} | ${profile.semanticCollisionAvoidance.avoided}/${profile.semanticCollisionAvoidance.total} | ${profile.alignedPositiveControls.matched}/${profile.alignedPositiveControls.total} | ${profile.stableControlsPassed}/${profile.stableControlsTotal} |`);
    }
    lines.push("", "| Strategy | Canary | Diagnostic class | Actual MATCH | Fixture-locale boundary aligned |", "| --- | --- | --- | --- | --- |");
    for (const profile of report.context.profiles) {
      for (const item of profile.cases) {
        lines.push(`| ${profile.strategy} | ${item.id} | ${item.diagnosticClass} | ${item.actualHit ? "hit" : "miss"} | ${item.boundary.boundaryAligned ? "yes" : "no"} |`);
      }
    }
  }

  if (report.scale) {
    lines.push(
      "",
      "## Scale comparison",
      "",
      `Isolation: ${report.scale.isolation}`,
      "",
      "| Chunks | Strategy | Frozen rank-stability canary | Allocated FTS MiB | Live FTS MiB | Freelist MiB | Allocated/raw | Build median ms | Build Δ | Max RSS MiB |",
      "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const item of report.scale.aggregates) {
      lines.push(`| ${item.size} | ${item.strategy} | ${item.qualityPassed ? "PASS" : "FAIL"} | ${formatMiB(item.allocatedFtsBytes)} | ${formatMiB(item.liveFtsBytes)} | ${formatMiB(item.freelistBytes)} | ${item.allocatedToRawRatio} | ${item.buildMedianMs} | ${item.buildVariation} | ${formatMiB(item.maxRssKb * 1024)} |`);
    }
    const largestSize = Math.max(...report.scale.sizes);
    const largest = report.scale.aggregates.filter((item) => item.size === largestSize);
    lines.push(
      "",
      `### Warm Top-8 query p95 at ${largestSize} chunks`,
      "",
      "Each query has the same MATCH count across profiles and is measured in deterministic round-robin sweeps.",
      "",
      "| Query bucket | MATCH rows | BIGRAM-U1 p95 ms | CHAR-PHRASE p95 ms | INTL-WORD p95 ms |",
      "| --- | ---: | ---: | ---: | ---: |",
    );
    for (const workload of SCALE_QUERY_WORKLOAD) {
      const byStrategy = new Map(largest.map((item) => [item.strategy, item]));
      const detail = byStrategy.get("CHAR-PHRASE")?.queryDetails[workload.id];
      lines.push(`| ${workload.id} | ${detail?.matches ?? 0} | ${byStrategy.get("BIGRAM-U1")?.queryDetails[workload.id]?.p95Ms ?? 0} | ${detail?.p95Ms ?? 0} | ${byStrategy.get("INTL-WORD")?.queryDetails[workload.id]?.p95Ms ?? 0} |`);
    }
  }

  lines.push(
    "",
    "## Interpretation boundary",
    "",
    "The deliberately boundary-sensitive canaries report lexical MATCH eligibility and semantic-collision avoidance separately; they are not vault-level recall/precision and are not averaged into a winner. Scale bytes and timings compare the three derived profiles on the same deterministic corpus; they are not OPFS file-size, Obsidian desktop, or mobile acceptance claims.",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.worker) {
    const result = await runScaleWorker(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const frozenFixture = await loadJson(FROZEN_FIXTURE_PATH);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      v8: process.versions.v8,
      icu: process.versions.icu,
      unicode: process.versions.unicode,
      cldr: process.versions.cldr,
    },
    context: null,
    scale: null,
  };

  if (options.mode === "all" || options.mode === "context") {
    const sqlite3 = await sqlite3InitModule();
    report.context = await runContextEvidence(
      sqlite3,
      frozenFixture,
      await loadJson(CONTEXT_FIXTURE_PATH),
    );
  }
  if (options.mode === "all" || options.mode === "scale") {
    report.scale = runScaleCoordinator(options);
  }

  process.stdout.write(options.format === "json"
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderMarkdown(report));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

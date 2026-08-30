import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  buildCharPhraseFtsQuery,
  charPhraseTokens,
  isCjkLexicalGrapheme,
  normalizeBoundedPathSurface,
  segmentGraphemes,
  splitCharPhraseRuns,
  transformCharPhraseDocument,
} from "../../src/vss/lexical-normalizer.ts";

const FTS5_RESERVED = /^(NEAR|AND|OR|NOT)$/i;
const FTS5_SAFE_BAREWORD = /^[\p{L}\p{M}\p{N}_]+$/u;
const JAPANESE_KANA = /[\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const QUERY_SPLIT = /[\s,;:!?。，、；：！？·・]+/u;

export function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return round(sorted[index], 4);
}

function escapeFtsToken(token) {
  if (!FTS5_RESERVED.test(token) && FTS5_SAFE_BAREWORD.test(token)) return token;
  return `"${token.replaceAll('"', '""')}"`;
}

function buildPlainQuery(text) {
  const tokens = text
    .normalize("NFC")
    .split(QUERY_SPLIT)
    .map((token) => token.trim())
    .filter(Boolean)
    .map(escapeFtsToken);
  return tokens.length > 0 ? tokens.join(" ") : null;
}

export function graphemes(text) {
  return segmentGraphemes(text);
}

function containsCjkLexicalGrapheme(text) {
  return graphemes(text).some(isCjkLexicalGrapheme);
}

export function splitCjkRuns(text) {
  return splitCharPhraseRuns(text);
}

function encodeGrapheme(grapheme) {
  return [...grapheme]
    .map((character) => character.codePointAt(0).toString(16))
    .join("x");
}

function encodeWord(word) {
  return [...word.normalize("NFC")]
    .map((character) => character.codePointAt(0).toString(16))
    .join("x");
}

export function charTokens(value) {
  return charPhraseTokens(value);
}

export function bigramTokens(value) {
  const units = graphemes(value);
  const bigrams = [];
  for (let index = 0; index + 1 < units.length; index += 1) {
    bigrams.push(`b${encodeGrapheme(units[index])}y${encodeGrapheme(units[index + 1])}`);
  }
  const unigrams = units.map((unit) => `u${encodeGrapheme(unit)}`);
  return { bigrams, unigrams };
}

function transformCjkText(text, transformRun) {
  return splitCjkRuns(text)
    .map((run) => (run.isCjk ? transformRun(run.value).join(" ") : run.value))
    .join(" ")
    .normalize("NFC");
}

function transformCjkOnlyText(text, transformRun) {
  return splitCjkRuns(text)
    .map((run) => (run.isCjk ? transformRun(run.value).join(" ") : ""))
    .join(" ")
    .normalize("NFC");
}

function buildCjkQuery(query, tokenBuilder) {
  const pieces = [];
  for (const run of splitCjkRuns(query)) {
    if (!run.isCjk) {
      const plain = buildPlainQuery(run.value);
      if (plain) pieces.push(plain);
      continue;
    }

    const tokens = tokenBuilder(run.value);
    if (tokens.length === 1) {
      pieces.push(tokens[0]);
    } else if (tokens.length > 1) {
      pieces.push(`"${tokens.join(" ")}"`);
    }
  }
  return pieces.length > 0 ? pieces.join(" ") : null;
}

function tokensToQueryPiece(tokens) {
  if (tokens.length === 0) return null;
  return tokens.length === 1 ? tokens[0] : `"${tokens.join(" ")}"`;
}

function buildBigramQueryPlan(query) {
  const primaryPieces = [];
  const unigramPieces = [];
  for (const run of splitCjkRuns(query)) {
    if (!run.isCjk) {
      const plain = buildPlainQuery(run.value);
      if (plain) primaryPieces.push(plain);
      continue;
    }

    const { bigrams, unigrams } = bigramTokens(run.value);
    const piece = tokensToQueryPiece(bigrams);
    if (piece) primaryPieces.push(piece);
    else {
      const unigramPiece = tokensToQueryPiece(unigrams);
      if (unigramPiece) unigramPieces.push(unigramPiece);
    }
  }

  const legs = [];
  if (primaryPieces.length > 0) {
    legs.push({ channel: "primary", expression: primaryPieces.join(" ") });
  }
  if (unigramPieces.length > 0) {
    legs.push({ channel: "unigram", expression: unigramPieces.join(" ") });
  }
  return legs.length > 0 ? { legs } : null;
}

function selectLocale(text) {
  const units = graphemes(text);
  if (units.some((unit) => JAPANESE_KANA.test(unit) && LETTER_OR_MARK.test(unit))) return "ja";
  if (units.some((unit) => /\p{Script_Extensions=Han}/u.test(unit) && LETTER_OR_MARK.test(unit))) return "zh";
  return "en";
}

const WORD_SEGMENTERS = new Map();

function getWordSegmenter(locale) {
  let segmenter = WORD_SEGMENTERS.get(locale);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: "word" });
    WORD_SEGMENTERS.set(locale, segmenter);
  }
  return segmenter;
}

export function intlWordTokens(text) {
  const locale = selectLocale(text);
  const segmenter = getWordSegmenter(locale);
  const tokens = [];
  for (const { segment, isWordLike } of segmenter.segment(text.normalize("NFC"))) {
    if (!isWordLike) continue;
    tokens.push(containsCjkLexicalGrapheme(segment) ? `w${encodeWord(segment)}` : segment);
  }
  return { locale, resolvedLocale: segmenter.resolvedOptions().locale, tokens };
}

function intlWordText(text) {
  return intlWordTokens(text).tokens.join(" ");
}

function buildIntlWordQuery(query) {
  const pieces = [];
  for (const run of splitCjkRuns(query)) {
    const tokens = intlWordTokens(run.value).tokens.map(escapeFtsToken);
    if (run.isCjk) {
      const phrase = tokensToQueryPiece(tokens);
      if (phrase) pieces.push(phrase);
    } else {
      pieces.push(...tokens);
    }
  }
  return pieces.length > 0 ? pieces.join(" ") : null;
}

export { normalizeBoundedPathSurface };

export function buildCharPhraseQueryPlan(clauses, mode = "strict_AND") {
  if (!Array.isArray(clauses) || clauses.length === 0) return null;
  const expressions = clauses
    .map((clause) => buildCharPhraseFtsQuery(clause))
    .filter(Boolean);
  if (expressions.length === 0) return null;
  if (mode === "strict_AND") {
    return { legs: [{ channel: "primary", expression: expressions.join(" ") }] };
  }
  if (mode === "clause_OR") {
    return {
      legs: [{
        channel: "primary",
        expression: expressions.length === 1
          ? expressions[0]
          : expressions.map((expression) => `(${expression})`).join(" OR "),
      }],
    };
  }
  throw new Error(`Unknown CHAR-PHRASE query mode: ${mode}`);
}

export function createStrategies(currentQueryBuilder) {
  const primaryChannel = (tokenizer, transform) => [{ id: "primary", tokenizer, transform }];
  const primaryQuery = (expression) => expression
    ? { legs: [{ channel: "primary", expression }] }
    : null;

  return [
    {
      id: "CURRENT",
      role: "failing_baseline",
      channels: primaryChannel(
        "unicode61 remove_diacritics 2",
        (text) => text.normalize("NFC"),
      ),
      buildQuery: (query) => primaryQuery(currentQueryBuilder(query)),
      eligibleForShipping: false,
    },
    {
      id: "BIGRAM-U1",
      role: "primary_candidate",
      channels: [
        {
          id: "primary",
          tokenizer: "unicode61 remove_diacritics 2",
          transform: (text) => transformCjkText(text, (run) => bigramTokens(run).bigrams),
        },
        {
          id: "unigram",
          tokenizer: "unicode61 remove_diacritics 2",
          transform: (text) => transformCjkOnlyText(text, (run) => bigramTokens(run).unigrams),
        },
      ],
      buildQuery: buildBigramQueryPlan,
      vocabularyAssertions: [
        { channel: "primary", term: "b53ecy56de", present: true },
        { channel: "unigram", term: "u732b", present: true },
        { channel: "primary", term: "b", present: false },
        { channel: "primary", term: "53ec", present: false },
        { channel: "primary", term: "b7387y3002", present: false },
        { channel: "unigram", term: "u", present: false },
        { channel: "unigram", term: "732b", present: false },
        { channel: "unigram", term: "u3002", present: false },
      ],
      eligibleForShipping: true,
    },
    {
      id: "CHAR-PHRASE",
      role: "deterministic_comparator",
      channels: primaryChannel(
        "unicode61 remove_diacritics 2",
        transformCharPhraseDocument,
      ),
      buildQuery: (query) => primaryQuery(buildCharPhraseFtsQuery(query)),
      vocabularyAssertions: [
        { channel: "primary", term: "c53ec", present: true },
        { channel: "primary", term: "c", present: false },
        { channel: "primary", term: "53ec", present: false },
        { channel: "primary", term: "c3002", present: false },
      ],
      eligibleForShipping: true,
    },
    {
      id: "INTL-WORD",
      role: "quality_challenger",
      channels: primaryChannel("unicode61 remove_diacritics 2", intlWordText),
      buildQuery: (query) => primaryQuery(buildIntlWordQuery(query)),
      vocabularyAssertions: [
        { channel: "primary", term: "w53ecx56de", present: true },
        { channel: "primary", term: "w", present: false },
        { channel: "primary", term: "53ec", present: false },
      ],
      eligibleForShipping: true,
      diagnostics: () => {
        const canaries = ["机器学习", "提高中文检索召回率", "日本語検索のチューニング"];
        const rows = canaries.map((text) => ({ text, ...intlWordTokens(text) }));
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(rows))
          .digest("hex");
        return { fingerprint, canaries: rows };
      },
    },
    {
      id: "TRIGRAM",
      role: "limitation_control",
      channels: primaryChannel("trigram", (text) => text.normalize("NFC")),
      buildQuery: (query) => primaryQuery(buildPlainQuery(query)),
      eligibleForShipping: false,
    },
  ];
}

function execRows(database, sql, bind) {
  const rows = [];
  database.exec({ sql, bind, rowMode: "object", resultRows: rows });
  return rows;
}

function getPragmaNumber(database, pragma) {
  const rows = execRows(database, `PRAGMA ${pragma}`);
  const value = Object.values(rows[0] ?? {})[0];
  return Number(value ?? 0);
}

function ftsTableName(channelId) {
  if (!/^[a-z][a-z0-9_]*$/u.test(channelId)) throw new Error(`Invalid channel id ${channelId}.`);
  return `fts_${channelId}`;
}

function createFtsSql(surface, channel) {
  const columns = surface === "body"
    ? ["body"]
    : ["title", "heading", "body", "path_surface"];
  return `CREATE VIRTUAL TABLE ${ftsTableName(channel.id)} USING fts5(
    ${columns.join(",\n    ")},
    content='',
    contentless_delete=1,
    tokenize='${channel.tokenizer}'
  )`;
}

function resolveBm25Weights(surface, weights) {
  const expectedLength = surface === "body" ? 1 : 4;
  if (weights === undefined) return Array(expectedLength).fill(1);
  if (!Array.isArray(weights) || weights.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} BM25 weights for ${surface}.`);
  }
  return weights.map((weight) => {
    const numeric = Number(weight);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error("BM25 weights must be finite, non-negative numbers.");
    }
    return numeric;
  });
}

function insertDocs(database, rows) {
  const statement = database.prepare(
    "INSERT INTO docs(id, path, chunk_index) VALUES (?, ?, ?)",
  );

  database.exec("BEGIN");
  try {
    rows.forEach((row, index) => {
      const rowId = index + 1;
      statement
        .bind(1, rowId)
        .bind(2, row.path)
        .bind(3, row.chunkIndex)
        .step();
      statement.reset(true);
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    statement.finalize();
  }
}

function insertFtsRows(database, rows, strategy, surface) {
  const statements = new Map(strategy.channels.map((channel) => {
    const tableName = ftsTableName(channel.id);
    const sql = surface === "body"
      ? `INSERT INTO ${tableName}(rowid, body) VALUES (?, ?)`
      : `INSERT INTO ${tableName}(rowid, title, heading, body, path_surface) VALUES (?, ?, ?, ?, ?)`;
    return [channel.id, database.prepare(sql)];
  }));

  database.exec("BEGIN");
  try {
    rows.forEach((row, index) => {
      const rowId = index + 1;
      for (const channel of strategy.channels) {
        const statement = statements.get(channel.id);
        if (surface === "body") {
          statement
            .bind(1, rowId)
            .bind(2, channel.transform(row.body))
            .step();
        } else {
          statement
            .bind(1, rowId)
            .bind(2, channel.transform(row.title))
            .bind(3, channel.transform(row.heading))
            .bind(4, channel.transform(row.body))
            .bind(5, channel.transform(normalizeBoundedPathSurface(row.path)))
            .step();
        }
        statement.reset(true);
      }
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    for (const statement of statements.values()) statement.finalize();
  }
}

export function createProfileDatabase(sqlite3, fixtureRows, strategy, surface) {
  const database = new sqlite3.oo1.DB(":memory:", "c");
  let basePageCount;
  let baseFreelistCount;
  let indexedPageCount;
  let indexedFreelistCount;
  let pageSize;
  let indexElapsedMs;
  try {
    database.exec(`
      CREATE TABLE docs (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL
      );
    `);
    insertDocs(database, fixtureRows);
    basePageCount = getPragmaNumber(database, "page_count");
    baseFreelistCount = getPragmaNumber(database, "freelist_count");
    pageSize = getPragmaNumber(database, "page_size");

    const startedAt = performance.now();
    for (const channel of strategy.channels) database.exec(createFtsSql(surface, channel));
    insertFtsRows(database, fixtureRows, strategy, surface);
    indexElapsedMs = round(performance.now() - startedAt, 4);
    indexedPageCount = getPragmaNumber(database, "page_count");
    indexedFreelistCount = getPragmaNumber(database, "freelist_count");

    for (const channel of strategy.channels) {
      database.exec(
        `CREATE VIRTUAL TABLE vocab_${channel.id} USING fts5vocab(${ftsTableName(channel.id)}, 'row')`,
      );
    }
  } catch (error) {
    database.close();
    throw error;
  }

  const channelIds = new Set(strategy.channels.map((channel) => channel.id));

  function search(queryPlan, limit = 8, options = {}) {
    const legs = queryPlan.legs;
    if (!Array.isArray(legs) || legs.length === 0) throw new Error("Query plan has no legs.");
    for (const leg of legs) {
      if (!channelIds.has(leg.channel)) {
        throw new Error(`Unknown query channel ${leg.channel} for ${strategy.id}.`);
      }
    }
    const tableNames = legs.map((leg) => ftsTableName(leg.channel));
    const bm25Weights = resolveBm25Weights(surface, options.bm25Weights);
    const bm25Arguments = bm25Weights.map((weight) => `, ${weight}`).join("");
    const firstTable = tableNames[0];
    const extraJoins = tableNames
      .slice(1)
      .map((tableName) => `JOIN ${tableName} ON ${tableName}.rowid = ${firstTable}.rowid`)
      .join("\n       ");
    const scoreExpression = tableNames
      .map((tableName) => `bm25(${tableName}${bm25Arguments})`)
      .join(" + ");
    const matchPredicates = tableNames.map((tableName) => `${tableName} MATCH ?`).join(" AND ");
    return execRows(
      database,
       `SELECT
         d.id AS rowId,
         d.path AS path,
         d.chunk_index AS chunkIndex,
         ${scoreExpression} AS score
       FROM ${firstTable}
       ${extraJoins}
       JOIN docs d ON d.id = ${firstTable}.rowid
       WHERE ${matchPredicates}
       ORDER BY score ASC, d.path ASC, d.chunk_index ASC
       LIMIT ?`,
      [...legs.map((leg) => leg.expression), limit],
    ).map((row) => ({
      rowId: Number(row.rowId),
      path: String(row.path),
      chunkIndex: Number(row.chunkIndex),
      score: round(Number(row.score), 9),
    }));
  }

  function count(queryPlan) {
    const legs = queryPlan.legs;
    if (!Array.isArray(legs) || legs.length === 0) throw new Error("Query plan has no legs.");
    for (const leg of legs) {
      if (!channelIds.has(leg.channel)) {
        throw new Error(`Unknown query channel ${leg.channel} for ${strategy.id}.`);
      }
    }
    const tableNames = legs.map((leg) => ftsTableName(leg.channel));
    const firstTable = tableNames[0];
    const extraJoins = tableNames
      .slice(1)
      .map((tableName) => `JOIN ${tableName} ON ${tableName}.rowid = ${firstTable}.rowid`)
      .join("\n       ");
    const matchPredicates = tableNames.map((tableName) => `${tableName} MATCH ?`).join(" AND ");
    const rows = execRows(
      database,
      `SELECT COUNT(*) AS matches
       FROM ${firstTable}
       ${extraJoins}
       WHERE ${matchPredicates}`,
      legs.map((leg) => leg.expression),
    );
    return Number(rows[0]?.matches ?? 0);
  }

  function measureSamples(queryPlan, repetitions = 30, warmups = 5, options = {}) {
    for (let index = 0; index < warmups; index += 1) search(queryPlan, 8, options);
    const elapsed = [];
    for (let index = 0; index < repetitions; index += 1) {
      const started = performance.now();
      search(queryPlan, 8, options);
      elapsed.push(performance.now() - started);
    }
    return {
      samplesMs: elapsed.map((value) => round(value, 4)),
      p50Ms: percentile(elapsed, 50),
      p95Ms: percentile(elapsed, 95),
    };
  }

  function measure(queryPlan, repetitions = 30, options = {}) {
    const { p50Ms, p95Ms } = measureSamples(queryPlan, repetitions, 5, options);
    return { p50Ms, p95Ms };
  }

  function vocabulary(limit = 80) {
    return strategy.channels.flatMap((channel) => execRows(
      database,
      `SELECT term, doc, cnt FROM vocab_${channel.id} ORDER BY term LIMIT ?`,
      [limit],
    ).map((row) => ({
      channel: channel.id,
      term: String(row.term),
      documents: Number(row.doc),
      occurrences: Number(row.cnt),
    })));
  }

  function vocabularyDocumentCount(channelId, term) {
    if (!channelIds.has(channelId)) {
      throw new Error(`Unknown vocabulary channel ${channelId} for ${strategy.id}.`);
    }
    const rows = execRows(
      database,
      `SELECT doc FROM vocab_${channelId} WHERE term = ?`,
      [term],
    );
    return Number(rows[0]?.doc ?? 0);
  }

  return {
    index: {
      elapsedMs: indexElapsedMs,
      pageCount: indexedPageCount,
      pageSize,
      databaseBytes: indexedPageCount * pageSize,
      baseFixtureBytes: basePageCount * pageSize,
      estimatedBytes: (indexedPageCount - basePageCount) * pageSize,
      liveEstimatedBytes: (
        (indexedPageCount - indexedFreelistCount)
        - (basePageCount - baseFreelistCount)
      ) * pageSize,
      freelistBytes: (indexedFreelistCount - baseFreelistCount) * pageSize,
      basePageCount,
      indexedPageCount,
      baseFreelistCount,
      indexedFreelistCount,
    },
    search,
    count,
    measure,
    measureSamples,
    vocabulary,
    vocabularyDocumentCount,
    close: () => database.close(),
  };
}

export function summarizeCase(caseDefinition, queryPlan, hits, latency, error) {
  const uniquePaths = [];
  const seen = new Set();
  for (const hit of hits) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    uniquePaths.push(hit.path);
  }

  const relevant = new Set(caseDefinition.relevantPaths);
  const forbidden = new Set(caseDefinition.forbiddenPaths);
  const firstRelevantIndex = uniquePaths.findIndex((path) => relevant.has(path));
  const relevantFound = uniquePaths.filter((path) => relevant.has(path)).length;

  return {
    caseId: caseDefinition.id,
    group: caseDefinition.group,
    query: caseDefinition.query,
    queryChannel: queryPlan?.legs?.map((leg) => leg.channel).join("+") ?? null,
    matchExpression: queryPlan?.legs?.map((leg) => leg.expression).join(" && ") ?? null,
    error: error ? String(error) : null,
    hits,
    uniquePaths,
    metrics: {
      hitAt1: firstRelevantIndex >= 0 && firstRelevantIndex < 1 ? 1 : 0,
      hitAt3: firstRelevantIndex >= 0 && firstRelevantIndex < 3 ? 1 : 0,
      hitAt8: firstRelevantIndex >= 0 && firstRelevantIndex < 8 ? 1 : 0,
      reciprocalRank: firstRelevantIndex >= 0 ? round(1 / (firstRelevantIndex + 1)) : 0,
      recallAt8: round(relevantFound / relevant.size),
      precisionAt8: uniquePaths.length > 0 ? round(relevantFound / uniquePaths.length) : 0,
      uniquePathsAt8: uniquePaths.length,
      duplicateChunkRatio: hits.length > 0
        ? round((hits.length - uniquePaths.length) / hits.length)
        : 0,
      forbiddenPathHits: uniquePaths.filter((path) => forbidden.has(path)),
    },
    latency,
  };
}

export function aggregateCases(caseResults) {
  const valid = caseResults.filter((result) => !result.error);
  const sum = (metric) => valid.reduce((total, result) => total + result.metrics[metric], 0);
  const divisor = valid.length || 1;
  return {
    cases: caseResults.length,
    errors: caseResults.length - valid.length,
    hitAt1: round(sum("hitAt1") / divisor),
    hitAt3: round(sum("hitAt3") / divisor),
    hitAt8: round(sum("hitAt8") / divisor),
    meanReciprocalRank: round(sum("reciprocalRank") / divisor),
    recallAt8: round(sum("recallAt8") / divisor),
    precisionAt8: round(sum("precisionAt8") / divisor),
    meanUniquePathsAt8: round(sum("uniquePathsAt8") / divisor),
    meanDuplicateChunkRatio: round(sum("duplicateChunkRatio") / divisor),
    warmP50Ms: percentile(valid.map((result) => result.latency.p50Ms), 50),
    warmP95Ms: percentile(valid.map((result) => result.latency.p95Ms), 95),
  };
}

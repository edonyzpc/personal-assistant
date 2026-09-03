/**
 * Data safety verification tests for SPEC-A6 SQLite supplier migration.
 *
 * These tests verify that the migration from @sqliteai/sqlite-wasm to
 * @sqlite.org/sqlite-wasm does not corrupt, lose, or silently alter
 * user data stored in the VSS subsystem.
 *
 * Coverage areas:
 *   1. Embedding BLOB format round-trip (write → read → search)
 *   2. Vector cache consistency across mutations
 *   3. Search result correctness and ordering
 *   4. Hybrid search (vector + FTS) data integrity
 *   5. Existing database compatibility (schema, profileSignature)
 *   6. Cache invalidation completeness
 *   7. Edge cases that could silently corrupt data
 */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type {
    SqliteWorkerRequest,
    SqliteWorkerResponse,
    SqliteWorkerSuccess,
} from "../src/vss/sqlite-worker-protocol";
import type { VSSIndexStats } from "../src/vss/types";
import { buildCharPhraseFtsQuery, getCharPhraseRuntimeCanaryFingerprint } from "../src/vss/lexical-normalizer";
import { computePathEvidenceGeneration } from "../src/vss/path-evidence-generation";
import { RETRIEVAL_CALIBRATION_PROFILE } from "../src/vss/retrieval-calibration";

// ---------------------------------------------------------------------------
// Shared mock infrastructure
// ---------------------------------------------------------------------------

type MockWorkerScope = {
    onmessage?: (event: MessageEvent<SqliteWorkerRequest>) => void;
    postMessage: jest.Mock<(response: SqliteWorkerResponse) => void>;
};

type InMemoryRow = Record<string, unknown>;

function toFloat32Bytes(vector: number[]): Uint8Array {
    const arr = new Float32Array(vector);
    return new Uint8Array(arr.buffer);
}

function countPlaceholdersInInClause(sql: string): number {
    const match = sql.match(/IN\s*\(([^)]*)\)/i);
    if (!match) return 0;
    return match[1].split(",").filter((part) => part.trim() === "?").length;
}

function matchesTemporalClause(row: InMemoryRow, sql: string, temporalBinds: readonly unknown[]): boolean {
    let index = 0;
    const lastModified = Number(row.last_modified);
    if (sql.includes("last_modified >= ?")) {
        const since = Number(temporalBinds[index++]);
        if (Number.isFinite(since) && lastModified < since) return false;
    }
    if (sql.includes("last_modified <= ?")) {
        const until = Number(temporalBinds[index++]);
        if (Number.isFinite(until) && lastModified > until) return false;
    }
    return true;
}

function utf8ByteLength(value: unknown): number {
    return new TextEncoder().encode(String(value ?? "")).byteLength;
}

/**
 * Creates a mock SQLite database that stores data in-memory maps,
 * enabling full round-trip verification of embedding data.
 */
function createInMemoryMockDb() {
    const files = new Map<string, InMemoryRow>();
    const chunks = new Map<number, InMemoryRow>();
    const ftsEntries = new Map<number, string>();
    const lexicalEntries = [new Map<number, string>(), new Map<number, string>()] as const;
    const lexicalFieldEntries = [
        new Map<number, Record<"title" | "heading" | "body" | "path", string>>(),
        new Map<number, Record<"title" | "heading" | "body" | "path", string>>(),
    ] as const;
    const lexicalScopePaths = new Set<string>();
    const meta = new Map<string, string>();
    let nextChunkId = 1;
    let failNextLexicalInsert = false;
    let failNextLexicalRecreate = false;
    let failNextResetSchemaCreate = false;
    let failNextResetRollback = false;
    let failNextClose = false;
    let estimatedPageSizeSequence: number[] = [];
    let estimatedPageSizeSamples: number[] = [];
    let estimatedPageCountSequence: number[] = [];
    let estimatedPageCountSamples: number[] = [];
    let transactionSnapshot: {
        files: Map<string, InMemoryRow>;
        chunks: Map<number, InMemoryRow>;
        ftsEntries: Map<number, string>;
        lexicalEntries: [Map<number, string>, Map<number, string>];
        lexicalFieldEntries: [
            Map<number, Record<"title" | "heading" | "body" | "path", string>>,
            Map<number, Record<"title" | "heading" | "body" | "path", string>>,
        ];
        lexicalScopePaths: Set<string>;
        meta: Map<string, string>;
        nextChunkId: number;
    } | null = null;

    const restoreMap = <K, V>(target: Map<K, V>, source: Map<K, V>): void => {
        target.clear();
        for (const [key, value] of source) target.set(key, value);
    };

    const restoreTransactionSnapshot = (): void => {
        if (!transactionSnapshot) return;
        restoreMap(files, transactionSnapshot.files);
        restoreMap(chunks, transactionSnapshot.chunks);
        restoreMap(ftsEntries, transactionSnapshot.ftsEntries);
        restoreMap(lexicalEntries[0], transactionSnapshot.lexicalEntries[0]);
        restoreMap(lexicalEntries[1], transactionSnapshot.lexicalEntries[1]);
        restoreMap(lexicalFieldEntries[0], transactionSnapshot.lexicalFieldEntries[0]);
        restoreMap(lexicalFieldEntries[1], transactionSnapshot.lexicalFieldEntries[1]);
        lexicalScopePaths.clear();
        for (const path of transactionSnapshot.lexicalScopePaths) lexicalScopePaths.add(path);
        restoreMap(meta, transactionSnapshot.meta);
        nextChunkId = transactionSnapshot.nextChunkId;
        transactionSnapshot = null;
    };

    // Statement mocks
    let preparedSql = "";
    let bindings: unknown[] = [];

    const stmtMock = {
        bind(idx: number, val: unknown) {
            bindings[idx - 1] = val;
            return stmtMock;
        },
        bindAsBlob(idx: number, val: unknown) {
            bindings[idx - 1] = val;
            return stmtMock;
        },
        step() {
            if (preparedSql.includes("INSERT INTO vss_files")) {
                const [path, contentHash, mtime, size, updatedAt, evidenceGeneration] = bindings;
                files.set(path as string, {
                    path,
                    contentHash,
                    mtime,
                    size,
                    status: "ready",
                    updatedAt,
                    evidence_generation: evidenceGeneration,
                });
            } else if (preparedSql.includes("INSERT INTO vss_chunks(")) {
                const id = nextChunkId++;
                const [path, chunkIndex, content, metadata, embedding, contentHash, created, lastModified] = bindings;
                chunks.set(id, {
                    id, path, chunk_index: chunkIndex, content, metadata,
                    embedding, content_hash: contentHash, created, last_modified: lastModified,
                });
                ftsEntries.set(id, content as string);
            } else if (preparedSql.includes("INSERT INTO vss_chunks_lexical_")) {
                if (failNextLexicalInsert) {
                    failNextLexicalInsert = false;
                    throw Object.assign(new Error("injected lexical insert failure"), { code: "injected-lexical-failure" });
                }
                const generation = preparedSql.includes("vss_chunks_lexical_1") ? 1 : 0;
                const [rowId, title, heading, body, path] = bindings;
                lexicalEntries[generation].set(Number(rowId), [title, heading, body, path].join(" "));
                lexicalFieldEntries[generation].set(Number(rowId), {
                    title: String(title ?? ""),
                    heading: String(heading ?? ""),
                    body: String(body ?? ""),
                    path: String(path ?? ""),
                });
            } else if (preparedSql.includes("INSERT INTO vss_lexical_rebuild_scope")) {
                lexicalScopePaths.add(String(bindings[0]));
            }
        },
        reset(clear?: boolean) {
            if (clear) bindings = [];
        },
        finalize() {
            preparedSql = "";
            bindings = [];
        },
    };

    const db = {
        exec: jest.fn((request: unknown) => {
            if (typeof request === "string") {
                const sql = request.trim();
                if (sql === "BEGIN" || sql === "BEGIN IMMEDIATE") {
                    transactionSnapshot ??= {
                        files: new Map(files),
                        chunks: new Map(chunks),
                        ftsEntries: new Map(ftsEntries),
                        lexicalEntries: [new Map(lexicalEntries[0]), new Map(lexicalEntries[1])],
                        lexicalFieldEntries: [
                            new Map(lexicalFieldEntries[0]),
                            new Map(lexicalFieldEntries[1]),
                        ],
                        lexicalScopePaths: new Set(lexicalScopePaths),
                        meta: new Map(meta),
                        nextChunkId,
                    };
                    return;
                }
                if (sql === "COMMIT") {
                    transactionSnapshot = null;
                    return;
                }
                if (sql === "ROLLBACK") {
                    if (failNextResetRollback) {
                        failNextResetRollback = false;
                        throw Object.assign(new Error("injected reset rollback failure"), {
                            code: "injected-reset-rollback-failure",
                        });
                    }
                    restoreTransactionSnapshot();
                    return;
                }
                if (failNextResetSchemaCreate
                    && transactionSnapshot
                    && request.includes("CREATE TABLE IF NOT EXISTS vss_meta")) {
                    failNextResetSchemaCreate = false;
                    throw Object.assign(new Error("injected reset schema failure"), {
                        code: "injected-reset-schema-failure",
                    });
                }
                if (
                    failNextLexicalRecreate
                    && request.includes("DROP TABLE IF EXISTS vss_chunks_lexical_")
                    && request.includes("CREATE VIRTUAL TABLE vss_chunks_lexical_")
                ) {
                    failNextLexicalRecreate = false;
                    throw Object.assign(new Error("injected malformed lexical shadow"), {
                        code: "injected-lexical-recreate-failure",
                    });
                }
                const lexicalDrop = request.match(/DROP TABLE IF EXISTS vss_chunks_lexical_([01])/);
                if (lexicalDrop) {
                    lexicalEntries[Number(lexicalDrop[1]) as 0 | 1].clear();
                    lexicalFieldEntries[Number(lexicalDrop[1]) as 0 | 1].clear();
                }
                const lexicalDelete = request.match(/DELETE FROM vss_chunks_lexical_([01])/);
                if (lexicalDelete) {
                    lexicalEntries[Number(lexicalDelete[1]) as 0 | 1].clear();
                    lexicalFieldEntries[Number(lexicalDelete[1]) as 0 | 1].clear();
                }
                const lexicalDeleteAll = request.match(/INSERT INTO vss_chunks_lexical_([01])\(vss_chunks_lexical_[01]\) VALUES\('delete-all'\)/);
                if (lexicalDeleteAll) {
                    lexicalEntries[Number(lexicalDeleteAll[1]) as 0 | 1].clear();
                    lexicalFieldEntries[Number(lexicalDeleteAll[1]) as 0 | 1].clear();
                }
                if (request.includes("DELETE FROM vss_lexical_rebuild_scope")) {
                    lexicalScopePaths.clear();
                }
                if (/DROP TABLE(?: IF EXISTS)? vss_chunks\b/.test(request)) {
                    chunks.clear();
                    ftsEntries.clear();
                    lexicalEntries[0].clear();
                    lexicalEntries[1].clear();
                    lexicalFieldEntries[0].clear();
                    lexicalFieldEntries[1].clear();
                    files.clear();
                    meta.clear();
                    nextChunkId = 1;
                }
                return;
            }

            const req = request as {
                sql: string;
                bind?: unknown[];
                rowMode?: string;
                resultRows?: unknown[];
            };

            const sql = req.sql.trim();

            // Meta operations
            if (sql.includes("INSERT OR REPLACE INTO vss_meta")) {
                const [key, value] = req.bind ?? [];
                meta.set(key as string, value as string);
                return;
            }
            if (sql.includes("SELECT value FROM vss_meta")) {
                const [key] = req.bind ?? [];
                const value = meta.get(key as string);
                if (value !== undefined && req.resultRows) {
                    (req.resultRows as InMemoryRow[]).push({ value });
                }
                return;
            }

            // pragma_table_info check for embedding column
            if (sql.includes("pragma_table_info")) {
                if (req.resultRows) {
                    (req.resultRows as unknown[][]).push([1]);
                }
                return;
            }

            if (sql.includes("AS file_exists") && sql.includes("AS chunk_exists")) {
                const [filePath, chunkPath] = req.bind ?? [];
                const fileExists = files.has(String(filePath));
                const chunkExists = [...chunks.values()].some((row) => row.path === chunkPath);
                if (req.resultRows) {
                    (req.resultRows as unknown[][]).push([
                        fileExists ? 1 : 0,
                        chunkExists ? 1 : 0,
                    ]);
                }
                return;
            }

            // Count queries
            if (sql.includes("COUNT(*) AS chunk_count") && sql.includes("inventory_bytes")) {
                const allowed = new Set((req.bind ?? []).map(String));
                const grouped = new Map<string, { chunkCount: number; inventoryBytes: number }>();
                for (const row of chunks.values()) {
                    const path = String(row.path);
                    if (!allowed.has(path)) continue;
                    const current = grouped.get(path) ?? { chunkCount: 0, inventoryBytes: 0 };
                    current.chunkCount += 1;
                    current.inventoryBytes += utf8ByteLength(row.path)
                        + utf8ByteLength(row.content)
                        + utf8ByteLength(row.metadata)
                        + utf8ByteLength(row.content_hash)
                        + 64;
                    grouped.set(path, current);
                }
                if (req.resultRows) {
                    for (const path of [...grouped.keys()].sort()) {
                        const current = grouped.get(path)!;
                        (req.resultRows as InMemoryRow[]).push({
                            path,
                            chunk_count: current.chunkCount,
                            inventory_bytes: current.inventoryBytes,
                        });
                    }
                }
                return;
            }
            if (
                sql.includes("SELECT COUNT(*)")
                && sql.includes("AS lexical")
                && sql.includes("INNER JOIN vss_chunks AS chunks")
                && sql.includes("WHERE chunks.path = ?")
            ) {
                const generation = sql.includes("vss_chunks_lexical_1") ? 1 : 0;
                const [path] = req.bind ?? [];
                const count = [...lexicalEntries[generation].keys()]
                    .filter((id) => chunks.get(id)?.path === path)
                    .length;
                if (req.resultRows) (req.resultRows as unknown[][]).push([count]);
                return;
            }
            if (sql.includes("SELECT COUNT(*)") && sql.includes("vss_lexical_rebuild_scope")) {
                if (req.resultRows) {
                    const count = [...chunks.values()].filter((row) => lexicalScopePaths.has(String(row.path))).length;
                    (req.resultRows as unknown[][]).push([count]);
                }
                return;
            }
            if (sql.includes("SELECT COUNT(*)") && sql.includes("vss_chunks_fts")) {
                if (req.resultRows) {
                    (req.resultRows as unknown[][]).push([ftsEntries.size]);
                }
                return;
            }
            if (sql.includes("SELECT COUNT(*)") && sql.includes("vss_chunks_lexical_")) {
                const generation = sql.includes("vss_chunks_lexical_1") ? 1 : 0;
                if (req.resultRows) {
                    (req.resultRows as unknown[][]).push([lexicalEntries[generation].size]);
                }
                return;
            }
            if (sql.includes("SELECT COUNT(*)") && sql.includes("vss_chunks")) {
                if (req.resultRows) {
                    (req.resultRows as unknown[][]).push([chunks.size]);
                }
                return;
            }

            // Delete operations
            if (sql.includes("DELETE FROM vss_chunks_fts") && sql.includes("SELECT id")) {
                const [path] = req.bind ?? [];
                for (const [id, row] of chunks) {
                    if (row.path === path) ftsEntries.delete(id);
                }
                return;
            }
            if (sql.includes("DELETE FROM vss_chunks_lexical_") && sql.includes("SELECT id")) {
                const generation = sql.includes("vss_chunks_lexical_1") ? 1 : 0;
                const [path] = req.bind ?? [];
                for (const [id, row] of chunks) {
                    if (row.path === path) {
                        lexicalEntries[generation].delete(id);
                        lexicalFieldEntries[generation].delete(id);
                    }
                }
                return;
            }
            if (sql.includes("DELETE FROM vss_chunks_lexical_") && sql.includes("WHERE rowid = ?")) {
                const generation = sql.includes("vss_chunks_lexical_1") ? 1 : 0;
                const [rowId] = req.bind ?? [];
                lexicalEntries[generation].delete(Number(rowId));
                lexicalFieldEntries[generation].delete(Number(rowId));
                return;
            }
            if (sql.includes("DELETE FROM vss_meta")) {
                const [key] = req.bind ?? [];
                meta.delete(String(key));
                return;
            }
            if (sql.includes("DELETE FROM vss_chunks") && req.bind) {
                const [path] = req.bind;
                for (const [id, row] of chunks) {
                    if (row.path === path) chunks.delete(id);
                }
                return;
            }
            if (sql.includes("DELETE FROM vss_files") && req.bind) {
                const [path] = req.bind;
                files.delete(path as string);
                return;
            }

            if (sql.includes("UPDATE vss_files") && sql.includes("SET evidence_generation = ?")) {
                const [generation, path, contentHash, mtime, size] = req.bind ?? [];
                const row = files.get(String(path));
                const storedContentHash = row?.content_hash ?? row?.contentHash;
                if (
                    row
                    && !String(row.evidence_generation ?? "")
                    && storedContentHash === contentHash
                    && Number(row.mtime) === Number(mtime)
                    && Number(row.size) === Number(size)
                    && row.status === "ready"
                ) {
                    row.evidence_generation = String(generation);
                }
                return;
            }

            // FTS backfill
            if (sql.includes("INSERT INTO vss_chunks_fts(rowid, content)") && sql.includes("SELECT id")) {
                if (req.bind) {
                    const [path] = req.bind;
                    for (const [id, row] of chunks) {
                        if (row.path === path) ftsEntries.set(id, row.content as string);
                    }
                } else {
                    for (const [id, row] of chunks) {
                        ftsEntries.set(id, row.content as string);
                    }
                }
                return;
            }

            // SELECT queries for chunks with embedding (vector cache load)
            if (sql.includes("SELECT id, embedding FROM vss_chunks") && !sql.includes("WHERE")) {
                if (req.resultRows) {
                    for (const [id, row] of chunks) {
                        (req.resultRows as unknown[][]).push([id, row.embedding]);
                    }
                }
                return;
            }
            if (sql.includes("SELECT id, embedding FROM vss_chunks WHERE path")) {
                const [path] = req.bind ?? [];
                if (req.resultRows) {
                    for (const [id, row] of chunks) {
                        if (row.path === path) {
                            (req.resultRows as unknown[][]).push([id, row.embedding]);
                        }
                    }
                }
                return;
            }

            if (sql.includes("SELECT id, path, content, metadata FROM vss_chunks WHERE path")) {
                const [path] = req.bind ?? [];
                if (req.resultRows) {
                    for (const [id, row] of chunks) {
                        if (row.path === path) {
                            (req.resultRows as InMemoryRow[]).push({
                                id,
                                path: row.path,
                                content: row.content,
                                metadata: row.metadata,
                            });
                        }
                    }
                }
                return;
            }

            if (sql.includes("SELECT path, chunk_index, content, content_hash, created, last_modified, metadata")) {
                const [path] = req.bind ?? [];
                if (req.resultRows) {
                    for (const row of [...chunks.values()]
                        .filter((candidate) => candidate.path === path)
                        .sort((left, right) => Number(left.chunk_index) - Number(right.chunk_index))) {
                        (req.resultRows as InMemoryRow[]).push({ ...row });
                    }
                }
                return;
            }

            // SELECT id FROM vss_chunks WHERE path (for cache invalidation on delete)
            if (sql.includes("SELECT id FROM vss_chunks WHERE path")) {
                const [path] = req.bind ?? [];
                if (req.resultRows) {
                    for (const [id, row] of chunks) {
                        if (row.path === path) {
                            (req.resultRows as unknown[][]).push([id]);
                        }
                    }
                }
                return;
            }

            if (sql.includes("SELECT id FROM vss_chunks") && sql.includes("WHERE 1=1")) {
                const bind = req.bind ?? [];
                const temporalBindCount = Number(sql.includes("last_modified >= ?"))
                    + Number(sql.includes("last_modified <= ?"));
                const temporalBinds = bind.slice(0, temporalBindCount);
                const excludedPaths = new Set(bind.slice(temporalBindCount).map(String));
                if (req.resultRows) {
                    for (const [id, row] of chunks) {
                        if (!excludedPaths.has(String(row.path)) && matchesTemporalClause(row, sql, temporalBinds)) {
                            (req.resultRows as InMemoryRow[]).push({ id });
                        }
                    }
                }
                return;
            }

            if (sql.includes("INNER JOIN vss_lexical_rebuild_scope") && sql.includes("chunks.id >")) {
                const [afterRowId, limit] = req.bind ?? [];
                if (req.resultRows) {
                    for (const [id, row] of [...chunks.entries()].sort(([left], [right]) => left - right)) {
                        if (id <= Number(afterRowId) || !lexicalScopePaths.has(String(row.path))) continue;
                        (req.resultRows as InMemoryRow[]).push({
                            id,
                            path: row.path,
                            content: row.content,
                            metadata: row.metadata,
                        });
                        if ((req.resultRows as InMemoryRow[]).length >= Number(limit)) break;
                    }
                }
                return;
            }

            if (sql.includes("SELECT term FROM vss_char_phrase_canary_vocab")) {
                if (req.resultRows) {
                    (req.resultRows as InMemoryRow[]).push({ term: "c53ec" }, { term: "c56de" });
                }
                return;
            }

            if (sql.includes("SELECT term FROM vss_lexical_shadow_vocab_") && sql.includes("WHERE doc = ?")) {
                if (req.resultRows) {
                    (req.resultRows as InMemoryRow[]).push({ term: "c53ec" }, { term: "c56de" });
                }
                return;
            }

            if (sql.includes("COUNT(DISTINCT doc)") && sql.includes("vss_lexical_shadow_vocab_")) {
                const generation = sql.includes("vss_lexical_shadow_vocab_1") ? 1 : 0;
                if (req.resultRows) {
                    for (const field of ["title", "heading", "body", "path"] as const) {
                        const docs = [...lexicalFieldEntries[generation].values()]
                            .filter((entry) => /[\p{L}\p{M}\p{N}_]/u.test(entry[field]))
                            .length;
                        if (docs > 0) (req.resultRows as InMemoryRow[]).push({ col: field, docs });
                    }
                }
                return;
            }

            // SELECT for search metadata retrieval
            if (
                sql.includes("SELECT c.id, c.path, c.chunk_index, c.content, c.metadata, f.evidence_generation")
                && sql.includes("WHERE c.id IN")
            ) {
                const bind = req.bind ?? [];
                const idCount = countPlaceholdersInInClause(sql);
                const ids = bind.slice(0, idCount);
                const temporalBinds = bind.slice(idCount);
                if (req.resultRows) {
                    for (const id of ids) {
                        const row = chunks.get(Number(id));
                        if (row && matchesTemporalClause(row, sql, temporalBinds)) {
                            (req.resultRows as InMemoryRow[]).push({
                                id: row.id,
                                path: row.path,
                                chunk_index: row.chunk_index,
                                content: row.content,
                                metadata: row.metadata,
                                evidence_generation: files.get(String(row.path))?.evidence_generation ?? "",
                            });
                        }
                    }
                }
                return;
            }
            if (sql.includes("SELECT id, path, chunk_index, content, metadata FROM vss_chunks WHERE id IN")) {
                const bind = req.bind ?? [];
                const idCount = countPlaceholdersInInClause(sql);
                const ids = bind.slice(0, idCount);
                const temporalBinds = bind.slice(idCount);
                if (req.resultRows) {
                    for (const id of ids) {
                        const row = chunks.get(Number(id));
                        if (row && matchesTemporalClause(row, sql, temporalBinds)) {
                            (req.resultRows as InMemoryRow[]).push({
                                id: row.id,
                                path: row.path,
                                chunk_index: row.chunk_index,
                                content: row.content,
                                metadata: row.metadata,
                            });
                        }
                    }
                }
                return;
            }

            // FTS MATCH queries
            if (sql.includes("MATCH")) {
                const bind = req.bind ?? [];
                const query = bind[0];
                const limit = bind[bind.length - 1];
                const temporalBinds = bind.slice(1, -1);
                if (req.resultRows) {
                    let count = 0;
                    const lexicalGeneration = sql.includes("vss_chunks_lexical_1")
                        ? 1
                        : sql.includes("vss_chunks_lexical_0")
                            ? 0
                            : null;
                    const entries = lexicalGeneration === null ? ftsEntries : lexicalEntries[lexicalGeneration];
                    for (const [id, content] of entries) {
                        if (count >= (limit as number)) break;
                        const queryStr = String(query).replace(/['"]/g, "").toLowerCase();
                        if (content.toLowerCase().includes(queryStr)) {
                            const row = chunks.get(id);
                            if (row && matchesTemporalClause(row, sql, temporalBinds)) {
                                (req.resultRows as InMemoryRow[]).push({
                                    id: row.id,
                                    path: row.path,
                                    chunk_index: row.chunk_index,
                                    content: row.content,
                                    metadata: row.metadata,
                                    evidence_generation: files.get(String(row.path))?.evidence_generation ?? "",
                                });
                                count++;
                            }
                        }
                    }
                }
                return;
            }

            // SELECT path FROM vss_files
            if (sql.includes("SELECT path, evidence_generation, content_hash, mtime, size")) {
                const allowed = new Set((req.bind ?? []).map(String));
                if (req.resultRows) {
                    for (const path of [...allowed].sort()) {
                        const row = files.get(path);
                        if (!row || row.status !== "ready") continue;
                        (req.resultRows as InMemoryRow[]).push({
                            path,
                            evidence_generation: row.evidence_generation ?? "",
                            content_hash: row.content_hash ?? row.contentHash,
                            mtime: row.mtime,
                            size: row.size,
                        });
                    }
                }
                return;
            }
            if (sql.includes("SELECT evidence_generation") && sql.includes("FROM vss_files")) {
                const [path] = req.bind ?? [];
                const row = files.get(String(path));
                if (row?.status === "ready" && req.resultRows) {
                    (req.resultRows as InMemoryRow[]).push({
                        evidence_generation: row.evidence_generation ?? "",
                    });
                }
                return;
            }
            if (sql.includes("SELECT path FROM vss_files")) {
                if (req.resultRows) {
                    for (const row of files.values()) {
                        (req.resultRows as InMemoryRow[]).push({ path: row.path });
                    }
                }
                return;
            }

            // Stats queries
            if (sql.includes("PRAGMA page_size")) {
                const pageSize = estimatedPageSizeSequence.shift() ?? 4096;
                estimatedPageSizeSamples.push(pageSize);
                if (req.resultRows) (req.resultRows as unknown[][]).push([pageSize]);
                return;
            }
            if (sql.includes("PRAGMA page_count")) {
                const pageCount = estimatedPageCountSequence.shift() ?? 100;
                estimatedPageCountSamples.push(pageCount);
                if (req.resultRows) (req.resultRows as unknown[][]).push([pageCount]);
                return;
            }

            // sqlite_master check
            if (sql.includes("sqlite_master")) {
                if (req.resultRows) {
                    (req.resultRows as InMemoryRow[]).push({ name: "vss_meta" });
                }
                return;
            }

            // FTS integrity check
            if (sql.includes("integrity-check")) {
                return;
            }

            // BEGIN/COMMIT/ROLLBACK
            if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return;

            // DROP TABLE
            if (sql.includes("DROP TABLE")) {
                if (sql.includes("vss_chunks_fts")) ftsEntries.clear();
                if (sql.includes("vss_chunks") && !sql.includes("fts")) chunks.clear();
                if (sql.includes("vss_files")) files.clear();
                if (sql.includes("vss_meta")) meta.clear();
                return;
            }
        }),
        prepare: jest.fn((sql: string) => {
            preparedSql = sql;
            bindings = [];
            return stmtMock;
        }),
        close: jest.fn(() => {
            if (failNextClose) {
                failNextClose = false;
                throw Object.assign(new Error("injected close failure"), {
                    code: "injected-close-failure",
                });
            }
        }),
    };

    return {
        db,
        files,
        chunks,
        ftsEntries,
        lexicalEntries,
        lexicalFieldEntries,
        meta,
        failNextLexicalInsert: () => { failNextLexicalInsert = true; },
        failNextLexicalRecreate: () => { failNextLexicalRecreate = true; },
        failNextResetSchemaCreate: () => { failNextResetSchemaCreate = true; },
        failNextResetRollback: () => { failNextResetRollback = true; },
        failNextClose: () => { failNextClose = true; },
        setEstimatedPageSizeSequence: (pageSizes: number[]) => {
            estimatedPageSizeSequence = [...pageSizes];
            estimatedPageSizeSamples = [];
        },
        getEstimatedPageSizeSamples: () => [...estimatedPageSizeSamples],
        setEstimatedPageCountSequence: (pageCounts: number[]) => {
            estimatedPageCountSequence = [...pageCounts];
            estimatedPageCountSamples = [];
        },
        getEstimatedPageCountSamples: () => [...estimatedPageCountSamples],
    };
}

function setupWorkerScope(): MockWorkerScope {
    return { postMessage: jest.fn() };
}

async function initializeWorker(
    workerScope: MockWorkerScope,
    db: ReturnType<typeof createInMemoryMockDb>["db"],
    options?: {
        dimensions?: number;
        distanceMetric?: "COSINE" | "L2";
        lexicalProfileEnabled?: boolean;
        lexicalBoundaryFingerprint?: string;
    },
) {
    const dimensions = options?.dimensions ?? 4;
    const distanceMetric = options?.distanceMetric ?? "COSINE";
    const pauseVfs = jest.fn();

    class MockDb {
        constructor() { return db; }
    }
    const installOpfsSAHPoolVfs = jest.fn(async () => ({
        OpfsSAHPoolDb: MockDb,
        pauseVfs,
        isPaused: jest.fn(() => false),
    }));
    const sqlite3InitModule = jest.fn(async () => ({
        installOpfsSAHPoolVfs,
        capi: {
            sqlite3_progress_handler: jest.fn(),
        },
    }));

    Object.defineProperty(globalThis, "self", {
        configurable: true,
        value: workerScope,
    });
    jest.doMock("@sqlite.org/sqlite-wasm", () => ({
        __esModule: true,
        default: sqlite3InitModule,
    }));
    await import("../src/vss/sqlite-worker");

    await send(workerScope, {
        id: 0,
        type: "initialize",
        payload: {
            profile: {
                provider: "test",
                baseURL: "",
                model: "test-model",
                dimensions,
                distanceMetric,
            },
            databaseName: "test.sqlite3",
            opfsDirectory: "/test-vss",
            opfsVfsName: "opfs-test",
            lexicalProfileEnabled: options?.lexicalProfileEnabled,
            lexicalBoundaryFingerprint: options?.lexicalBoundaryFingerprint
                ?? (options?.lexicalProfileEnabled ? "scope-1" : undefined),
        },
    });

    return { pauseVfs };
}

async function send(
    scope: MockWorkerScope,
    request: SqliteWorkerRequest,
): Promise<SqliteWorkerSuccess> {
    const responseOffset = scope.postMessage.mock.calls.length;
    scope.onmessage?.({ data: request } as MessageEvent<SqliteWorkerRequest>);
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = scope.postMessage.mock.calls
            .slice(responseOffset)
            .map((call) => call[0])
            .find((candidate) => candidate.id === request.id);
        if (response) return response as SqliteWorkerSuccess;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`Worker response ${request.id} was not posted.`);
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("SPEC-A6 data safety: embedding format round-trip", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("preserves embedding bytes through upsert → cache → search", async () => {
        const { db, chunks } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 4 });

        const embedding = [0.1, 0.2, 0.3, 0.4];

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "test.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{
                    path: "test.md", chunkIndex: 0, content: "hello world",
                    contentHash: "ch1", created: 1, lastModified: 1, metadata: {},
                }],
                embeddings: [embedding],
            },
        });

        // Verify the stored BLOB is exactly Float32 bytes
        const storedChunk = [...chunks.values()][0];
        const storedBlob = storedChunk.embedding as Uint8Array;
        const expectedBlob = toFloat32Bytes(embedding);
        expect(storedBlob).toEqual(expectedBlob);

        // Verify the BLOB can be read back as Float32Array with identical values
        const readBack = new Float32Array(
            storedBlob.buffer, storedBlob.byteOffset, storedBlob.byteLength / 4,
        );
        expect(Array.from(readBack)).toEqual(
            Array.from(new Float32Array(embedding)),
        );
    });

    it("returns correct search results after upsert", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        // Insert two chunks with known embeddings
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "a.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [
                    { path: "a.md", chunkIndex: 0, content: "alpha", contentHash: "c1", created: 1, lastModified: 1, metadata: {} },
                ],
                embeddings: [[1, 0, 0]],
            },
        });
        await send(workerScope, {
            id: 2,
            type: "upsertFile",
            payload: {
                fileState: { path: "b.md", contentHash: "h2", mtime: 1, size: 10 },
                chunks: [
                    { path: "b.md", chunkIndex: 0, content: "beta", contentHash: "c2", created: 1, lastModified: 1, metadata: {} },
                ],
                embeddings: [[0, 1, 0]],
            },
        });

        // Search with query close to [1,0,0]
        const response = await send(workerScope, {
            id: 3,
            type: "search",
            payload: { queryEmbedding: [0.9, 0.1, 0], k: 2 },
        });

        expect(response.ok).toBe(true);
        const results = response.result as unknown as Array<{ score: number; doc: { metadata: { path: string } } }>;
        expect(results).toHaveLength(2);
        expect(results[0].doc.metadata.path).toBe("a.md");
        expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it("search still works after file deletion (cache invalidation)", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "keep.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{ path: "keep.md", chunkIndex: 0, content: "keep", contentHash: "c1", created: 1, lastModified: 1, metadata: {} }],
                embeddings: [[1, 0, 0]],
            },
        });
        await send(workerScope, {
            id: 2,
            type: "upsertFile",
            payload: {
                fileState: { path: "remove.md", contentHash: "h2", mtime: 1, size: 10 },
                chunks: [{ path: "remove.md", chunkIndex: 0, content: "remove", contentHash: "c2", created: 1, lastModified: 1, metadata: {} }],
                embeddings: [[0, 1, 0]],
            },
        });

        // Delete a file
        await send(workerScope, {
            id: 3, type: "deleteFile", payload: { path: "remove.md" },
        });

        // Search should only find the remaining file
        const response = await send(workerScope, {
            id: 4, type: "search", payload: { queryEmbedding: [0.5, 0.5, 0], k: 10 },
        });

        expect(response.ok).toBe(true);
        const results = response.result as unknown as Array<{ doc: { metadata: { path: string } } }>;
        expect(results).toHaveLength(1);
        expect(results[0].doc.metadata.path).toBe("keep.md");
    });

    it("search returns empty after reset (no stale cached data)", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "data.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{ path: "data.md", chunkIndex: 0, content: "data", contentHash: "c1", created: 1, lastModified: 1, metadata: {} }],
                embeddings: [[1, 0, 0]],
            },
        });

        // Reset clears all data
        await send(workerScope, { id: 2, type: "reset", payload: {} });

        // Search should find nothing — cache must have been invalidated
        const response = await send(workerScope, {
            id: 3, type: "search", payload: { queryEmbedding: [1, 0, 0], k: 10 },
        });

        expect(response.ok).toBe(true);
        expect(response.result).toEqual([]);
    });

    it("rolls back a destructive reset when schema recreation fails mid-operation", async () => {
        const fixture = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, fixture.db, {
            dimensions: 3,
            lexicalProfileEnabled: true,
            lexicalBoundaryFingerprint: "scope-1",
        });

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "preserved.md",
                    contentHash: "h1",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "preserved.md",
                    chunkIndex: 0,
                    content: "preserved",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const before = (await send(workerScope, {
            id: 2,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        const warmSearch = await send(workerScope, {
            id: 3,
            type: "search",
            payload: { queryEmbedding: [1, 0, 0], k: 10 },
        });
        expect(warmSearch.ok).toBe(true);
        expect(warmSearch.result).toHaveLength(1);
        const rebuild = await send(workerScope, {
            id: 30,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (rebuild.result as { rebuildId: string }).rebuildId;
        await send(workerScope, {
            id: 301,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["preserved.md"] },
        });
        const lexicalBefore = await send(workerScope, {
            id: 31,
            type: "getLexicalStatus",
            payload: {},
        });
        expect(lexicalBefore.result).toMatchObject({
            state: "rebuilding",
            marker: { profileId: "char-phrase-v1", generation: 0 },
            chunkCount: 1,
            lexicalRowCount: 1,
        });
        expect(fixture.meta.get("lexicalRebuildId")).toBe(rebuildId);
        const vectorCacheLoadsBefore = fixture.db.exec.mock.calls.filter(([request]) => (
            typeof request === "object"
            && request !== null
            && "sql" in request
            && request.sql === "SELECT id, embedding FROM vss_chunks"
        )).length;
        expect(vectorCacheLoadsBefore).toBe(1);

        fixture.failNextResetSchemaCreate();
        const resetExecStart = fixture.db.exec.mock.calls.length;
        const failedReset = await send(workerScope, { id: 4, type: "reset", payload: {} });

        expect(failedReset).toMatchObject({
            ok: false,
            error: { code: "injected-reset-schema-failure" },
        });
        const transactionStatements = fixture.db.exec.mock.calls.slice(resetExecStart)
            .map(([request]) => typeof request === "string" ? request.trim() : null)
            .filter((request): request is string => request !== null);
        expect(transactionStatements).toEqual(expect.arrayContaining([
            "BEGIN IMMEDIATE",
            "ROLLBACK",
        ]));
        expect(transactionStatements).not.toContain("COMMIT");

        const after = (await send(workerScope, {
            id: 5,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        expect(after).toMatchObject({
            status: "ready",
            databaseInstanceId: before.databaseInstanceId,
            fileCount: before.fileCount,
            chunkCount: before.chunkCount,
            lastErrorCode: "injected-reset-schema-failure",
        });
        const lexicalAfter = await send(workerScope, {
            id: 51,
            type: "getLexicalStatus",
            payload: {},
        });
        expect(lexicalAfter.result).toEqual(lexicalBefore.result);
        expect(fixture.meta.get("lexicalRebuildId")).toBe(rebuildId);
        const afterSearch = await send(workerScope, {
            id: 6,
            type: "search",
            payload: { queryEmbedding: [1, 0, 0], k: 10 },
        });
        expect(afterSearch.ok).toBe(true);
        expect((afterSearch.result as unknown as Array<{ doc: { metadata: { path: string } } }>)[0]
            .doc.metadata.path).toBe("preserved.md");
        const vectorCacheLoadsAfter = fixture.db.exec.mock.calls.filter(([request]) => (
            typeof request === "object"
            && request !== null
            && "sql" in request
            && request.sql === "SELECT id, embedding FROM vss_chunks"
        )).length;
        expect(vectorCacheLoadsAfter).toBe(vectorCacheLoadsBefore);

        const resumedBatch = await send(workerScope, {
            id: 7,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 128 },
        });
        expect(resumedBatch.result).toMatchObject({
            rebuildId,
            processedRows: 1,
            totalRows: 1,
            done: true,
        });
        const finalized = await send(workerScope, {
            id: 8,
            type: "finalizeLexicalRebuild",
            payload: { rebuildId },
        });
        expect(finalized.result).toMatchObject({
            state: "ready",
            marker: { profileId: "char-phrase-v1", generation: 1 },
            chunkCount: 1,
            lexicalRowCount: 1,
        });
        expect(fixture.meta.has("lexicalRebuildId")).toBe(false);
    });

    it("returns the canonical reset failure and fails closed when rollback and close both fail", async () => {
        const fixture = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        const { pauseVfs } = await initializeWorker(workerScope, fixture.db, { dimensions: 3 });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

        try {
            fixture.failNextResetSchemaCreate();
            fixture.failNextResetRollback();
            fixture.failNextClose();
            const failedReset = await send(workerScope, { id: 1, type: "reset", payload: {} });

            expect(failedReset).toMatchObject({
                ok: false,
                error: {
                    code: "reset-rollback-failed",
                    message: expect.stringContaining("injected reset rollback failure"),
                },
            });
            expect((failedReset as unknown as { error: { message: string } }).error.message)
                .not.toContain("injected close failure");
            expect(fixture.db.close).toHaveBeenCalledTimes(1);
            expect(pauseVfs).toHaveBeenCalledTimes(1);

            const staleAccess = await send(workerScope, { id: 2, type: "getStats", payload: {} });
            expect(staleAccess).toMatchObject({
                ok: false,
                error: { code: "sqlite-worker-disposed" },
            });
            expect(fixture.db.exec.mock.calls.some(([request]) => (
                typeof request === "object"
                && request !== null
                && "sql" in request
                && request.sql === "SELECT id, embedding FROM vss_chunks"
            ))).toBe(false);
        } finally {
            warn.mockRestore();
        }
    });
});

describe("SPEC-A6 data safety: hybrid search integrity", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("hybrid search returns fused vector + FTS results", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "note1.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{ path: "note1.md", chunkIndex: 0, content: "machine learning tutorial", contentHash: "c1", created: 1, lastModified: 1, metadata: {} }],
                embeddings: [[1, 0, 0]],
            },
        });
        await send(workerScope, {
            id: 2,
            type: "upsertFile",
            payload: {
                fileState: { path: "note2.md", contentHash: "h2", mtime: 1, size: 10 },
                chunks: [{ path: "note2.md", chunkIndex: 0, content: "deep learning guide", contentHash: "c2", created: 1, lastModified: 1, metadata: {} }],
                embeddings: [[0, 1, 0]],
            },
        });

        const response = await send(workerScope, {
            id: 3,
            type: "searchHybrid",
            payload: {
                queryEmbedding: [0.9, 0.1, 0],
                ftsQuery: "learning",
                k: 2,
                fusionTopK: 5,
            },
        });

        expect(response.ok).toBe(true);
        const results = (response.result as unknown as {
            results: Array<{ doc: { metadata: { path: string } } }>;
        }).results;
        expect(results.length).toBeGreaterThanOrEqual(1);
        const paths = results.map((r) => r.doc.metadata.path);
        expect(paths).toContain("note1.md");
    });

    it("hybrid search filters vector rows before temporal fusion", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "old.md", contentHash: "old", mtime: 1, size: 10 },
                chunks: [{
                    path: "old.md",
                    chunkIndex: 0,
                    content: "old exact vector hit",
                    contentHash: "old-c",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        await send(workerScope, {
            id: 2,
            type: "upsertFile",
            payload: {
                fileState: { path: "recent.md", contentHash: "recent", mtime: 1000, size: 10 },
                chunks: [{
                    path: "recent.md",
                    chunkIndex: 0,
                    content: "recent less exact vector hit",
                    contentHash: "recent-c",
                    created: 1,
                    lastModified: 1000,
                    metadata: {},
                }],
                embeddings: [[0.8, 0.2, 0]],
            },
        });

        const response = await send(workerScope, {
            id: 3,
            type: "searchHybrid",
            payload: {
                queryEmbedding: [1, 0, 0],
                ftsQuery: null,
                k: 1,
                fusionTopK: 5,
                temporalFilter: { since: 500 },
            },
        });

        expect(response.ok).toBe(true);
        const results = (response.result as unknown as {
            results: Array<{ doc: { metadata: { path: string } } }>;
        }).results;
        expect(results.map((result) => result.doc.metadata.path)).toEqual(["recent.md"]);
    });
});

describe("B-125 lexical-only shadow migration", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("keeps the lexical profile disabled by default while vector writes remain available", async () => {
        const { db, lexicalEntries } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "note.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{
                    path: "note.md",
                    chunkIndex: 0,
                    content: "召回",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const status = await send(workerScope, { id: 2, type: "getLexicalStatus", payload: {} });

        expect(status.result).toMatchObject({
            state: "unavailable",
            reason: "feature_disabled",
            chunkCount: 1,
            lexicalRowCount: 0,
        });
        expect(lexicalEntries[0].size + lexicalEntries[1].size).toBe(0);
    });

    it("keeps existing vectors ready, requires confirmation, and atomically activates CHAR-PHRASE", async () => {
        const { db, chunks, files, lexicalEntries, lexicalFieldEntries, meta } = createInMemoryMockDb();
        chunks.set(1, {
            id: 1,
            path: "notes/召回.md",
            chunk_index: 0,
            content: "召回优化",
            metadata: JSON.stringify({ headingPath: ["检索"] }),
            embedding: toFloat32Bytes([1, 0, 0]),
            content_hash: "chunk-1",
            created: 1,
            last_modified: 1,
        });
        files.set("notes/召回.md", {
            path: "notes/召回.md",
            contentHash: "file-1",
            mtime: 1,
            size: 10,
            status: "ready",
            updatedAt: 1,
        });
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });

        const before = await send(workerScope, { id: 1, type: "getLexicalStatus", payload: {} });
        expect(before.result).toMatchObject({
            state: "awaiting_confirmation",
            reason: "profile_missing",
            chunkCount: 1,
            lexicalRowCount: 0,
        });

        const start = await send(workerScope, {
            id: 2,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (start.result as { rebuildId: string }).rebuildId;
        await send(workerScope, {
            id: 20,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["notes/召回.md"] },
        });
        const batch = await send(workerScope, {
            id: 3,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 128 },
        });
        expect(batch.result).toMatchObject({ processedRows: 1, totalRows: 1, done: true });
        expect(lexicalFieldEntries[0].size).toBe(1);
        const activated = await send(workerScope, {
            id: 4,
            type: "finalizeLexicalRebuild",
            payload: { rebuildId },
        });

        expect(activated).toMatchObject({ ok: true });
        expect(activated.result).toMatchObject({
            state: "ready",
            marker: { profileId: "char-phrase-v1", generation: 0 },
            chunkCount: 1,
            lexicalRowCount: 1,
        });
        expect(lexicalEntries[0].get(1)).toContain("c53ec c56de");
        expect(meta.get("lexicalProfileId")).toBe("char-phrase-v1");
        expect(meta.get("lexicalGeneration")).toBe("0");
        expect(chunks.get(1)?.embedding).toEqual(toFloat32Bytes([1, 0, 0]));

        const search = await send(workerScope, {
            id: 5,
            type: "searchHybrid",
            payload: {
                queryEmbedding: [1, 0, 0],
                ftsQuery: buildCharPhraseFtsQuery("召回"),
                k: 8,
                fusionTopK: 18,
                retrieval: RETRIEVAL_CALIBRATION_PROFILE.candidate.standard,
                lexicalBoundaryFingerprint: "scope-1",
            },
        });
        expect(search.result).toMatchObject({
            lexical: { attempted: true, state: "ready", matchedRows: 1 },
        });
        const candidateResults = (search.result as unknown as {
            results: Array<{ score: number }>;
        }).results;
        expect(candidateResults[0]?.score).toBeCloseTo(2 / 31, 8);
        const lexicalQuery = db.exec.mock.calls
            .map((call) => call[0] as unknown)
            .find((request): request is { sql: string; bind?: unknown[] } => (
                request !== null
                && request !== undefined
                && typeof request === "object"
                && "sql" in request
                && typeof (request as { sql?: unknown }).sql === "string"
                && (request as { sql: string }).sql.includes("ORDER BY bm25")
            ));
        expect(lexicalQuery?.sql).toContain("1.25, 1.25, 2, 0.25");
        expect(lexicalQuery?.bind?.at(-1)).toBe(12);

        const invalidProfile = await send(workerScope, {
            id: 51,
            type: "searchHybrid",
            payload: {
                queryEmbedding: [1, 0, 0],
                ftsQuery: buildCharPhraseFtsQuery("召回"),
                k: 8,
                fusionTopK: 18,
                retrieval: {
                    ...RETRIEVAL_CALIBRATION_PROFILE.candidate.standard,
                    lexicalRaw: 13,
                },
                lexicalBoundaryFingerprint: "scope-1",
            },
        }) as unknown as SqliteWorkerResponse;
        expect(invalidProfile).toMatchObject({
            ok: false,
            error: { code: "retrieval-calibration-invalid" },
        });

        const aliasMismatch = await send(workerScope, {
            id: 52,
            type: "searchHybrid",
            payload: {
                queryEmbedding: [1, 0, 0],
                ftsQuery: buildCharPhraseFtsQuery("召回"),
                k: 8,
                fusionTopK: 12,
                retrieval: RETRIEVAL_CALIBRATION_PROFILE.candidate.standard,
                lexicalBoundaryFingerprint: "scope-1",
            },
        }) as unknown as SqliteWorkerResponse;
        expect(aliasMismatch).toMatchObject({
            ok: false,
            error: { code: "retrieval-calibration-alias-mismatch" },
        });

        const flagOffSearch = await send(workerScope, {
            id: 6,
            type: "searchHybrid",
            payload: {
                queryEmbedding: [1, 0, 0],
                ftsQuery: null,
                k: 8,
                fusionTopK: 12,
                lexicalSkipReason: "feature_disabled",
                lexicalBoundaryFingerprint: "scope-1",
            },
        });
        expect(flagOffSearch.result).toMatchObject({
            results: expect.any(Array),
            lexical: { attempted: false, state: "unavailable", reason: "feature_disabled" },
        });

        const changedScopeSearch = await send(workerScope, {
            id: 7,
            type: "searchHybrid",
            payload: {
                queryEmbedding: [1, 0, 0],
                ftsQuery: buildCharPhraseFtsQuery("召回"),
                k: 8,
                fusionTopK: 12,
                lexicalBoundaryFingerprint: "scope-2",
            },
        });
        expect(changedScopeSearch.result).toMatchObject({
            lexical: { attempted: false, state: "stale", reason: "scope_changed" },
        });

        const expiredBudgetSearch = await send(workerScope, {
            id: 8,
            type: "searchHybrid",
            payload: {
                queryEmbedding: [1, 0, 0],
                ftsQuery: buildCharPhraseFtsQuery("召回"),
                k: 8,
                fusionTopK: 12,
                lexicalBoundaryFingerprint: "scope-1",
                lexicalBudget: {
                    startedAtMs: Date.now() - 1_000,
                    deadlineAtMs: Date.now() - 1,
                },
            },
        });
        expect(expiredBudgetSearch.result).toMatchObject({
            results: expect.any(Array),
            lexical: {
                attempted: false,
                state: "ready",
                reason: "not_started_budget",
                durationMs: expect.any(Number),
            },
        });
    });

    it("drops an aborted shadow generation without touching indexed chunks", async () => {
        const { db, chunks, lexicalEntries } = createInMemoryMockDb();
        chunks.set(1, {
            id: 1,
            path: "note.md",
            chunk_index: 0,
            content: "机器学习",
            metadata: "{}",
            embedding: toFloat32Bytes([1, 0, 0]),
            content_hash: "chunk-1",
            created: 1,
            last_modified: 1,
        });
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        const started = await send(workerScope, {
            id: 1,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (started.result as { rebuildId: string }).rebuildId;
        await send(workerScope, {
            id: 20,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["note.md"] },
        });
        await send(workerScope, {
            id: 2,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 1 },
        });
        const aborted = await send(workerScope, {
            id: 3,
            type: "abortLexicalRebuild",
            payload: { rebuildId },
        });

        expect(aborted.result).toMatchObject({
            state: "awaiting_confirmation",
            reason: "rebuild_aborted",
        });
        expect(lexicalEntries[0].size).toBe(0);
        expect(chunks.get(1)?.embedding).toEqual(toFloat32Bytes([1, 0, 0]));
    });

    it("never materializes excluded chunk content into a scoped shadow batch", async () => {
        const { db, chunks, lexicalEntries } = createInMemoryMockDb();
        chunks.set(1, {
            id: 1,
            path: "allowed.md",
            chunk_index: 0,
            content: "允许召回",
            metadata: "{}",
            embedding: toFloat32Bytes([1, 0, 0]),
            content_hash: "allowed",
            created: 1,
            last_modified: 1,
        });
        chunks.set(2, {
            id: 2,
            path: "private/secret.md",
            chunk_index: 0,
            content: "绝密正文不得读取",
            metadata: "{}",
            embedding: toFloat32Bytes([0, 1, 0]),
            content_hash: "secret",
            created: 1,
            last_modified: 1,
        });
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        const started = await send(workerScope, {
            id: 1,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (started.result as { rebuildId: string }).rebuildId;
        const scope = await send(workerScope, {
            id: 2,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["allowed.md"] },
        });
        expect(scope).toMatchObject({ ok: true });
        expect(scope.result).toMatchObject({ sealed: true, totalRows: 1 });

        const batch = await send(workerScope, {
            id: 3,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 128 },
        });
        expect(batch.result).toMatchObject({ processedRows: 1, totalRows: 1, done: true });
        expect([...lexicalEntries[0].values()].join(" ")).toContain("c5141 c8bb8");
        expect([...lexicalEntries[0].values()].join(" ")).not.toContain("c7edd c5bc6");
    });

    it("stops maintaining lexical rows immediately when the rollout flag is disabled", async () => {
        const { db, lexicalEntries } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "note.md",
                    contentHash: "old",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "note.md",
                    chunkIndex: 0,
                    content: "旧召回内容",
                    contentHash: "old-chunk",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        expect(lexicalEntries[0].size).toBe(1);

        await send(workerScope, {
            id: 2,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "note.md",
                    contentHash: "new",
                    mtime: 2,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: false,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "note.md",
                    chunkIndex: 0,
                    content: "新向量内容",
                    contentHash: "new-chunk",
                    created: 1,
                    lastModified: 2,
                    metadata: {},
                }],
                embeddings: [[0, 1, 0]],
            },
        });

        const status = await send(workerScope, { id: 3, type: "getLexicalStatus", payload: {} });
        expect(status.result).toMatchObject({ state: "stale", reason: "feature_disabled_write" });
        expect(lexicalEntries[0].size).toBe(1);
        const vector = await send(workerScope, {
            id: 4,
            type: "search",
            payload: { queryEmbedding: [0, 1, 0], k: 1 },
        });
        expect(vector.result).toMatchObject([
            { doc: { pageContent: "新向量内容", metadata: { path: "note.md" } } },
        ]);
    });

    it("does not restore ready after an unmaintained write invalidates an active shadow", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        const write = (id: number, content: string, maintain: boolean) => send(workerScope, {
            id,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "note.md",
                    contentHash: content,
                    mtime: id,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: maintain,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "note.md",
                    chunkIndex: 0,
                    content,
                    contentHash: content,
                    created: 1,
                    lastModified: id,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        await write(1, "old", true);
        const started = await send(workerScope, {
            id: 2,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (started.result as { rebuildId: string }).rebuildId;
        await send(workerScope, {
            id: 3,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["note.md"] },
        });
        await send(workerScope, {
            id: 4,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 128 },
        });
        await write(5, "new without lexical maintenance", false);

        const aborted = await send(workerScope, {
            id: 6,
            type: "abortLexicalRebuild",
            payload: { rebuildId, failureReason: "source_epoch_changed" },
        });
        expect(aborted.result).toMatchObject({ state: "stale", reason: "feature_disabled_write" });
    });

    it("commits active lexical upsert/delete with the same source epoch as chunks", async () => {
        const { db, lexicalEntries, meta } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "机器学习.md",
                    contentHash: "h1",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "机器学习.md",
                    chunkIndex: 0,
                    content: "机器学习笔记",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: { headingPath: ["模型"] },
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const afterUpsert = await send(workerScope, { id: 2, type: "getLexicalStatus", payload: {} });
        expect(afterUpsert.result).toMatchObject({
            state: "ready",
            marker: { sourceChunkEpoch: "1", generation: 0 },
            chunkCount: 1,
            lexicalRowCount: 1,
        });
        expect(lexicalEntries[0].size).toBe(1);
        expect(meta.get("chunkMutationEpoch")).toBe("1");
        expect(meta.get("lexicalSourceChunkEpoch")).toBe("1");

        await send(workerScope, {
            id: 3,
            type: "deleteFile",
            payload: {
                path: "机器学习.md",
                options: {
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
            },
        });
        const afterDelete = await send(workerScope, { id: 4, type: "getLexicalStatus", payload: {} });
        expect(afterDelete.result).toMatchObject({
            state: "ready",
            marker: { sourceChunkEpoch: "2", generation: 0 },
            chunkCount: 0,
            lexicalRowCount: 0,
        });
        expect(lexicalEntries[0].size).toBe(0);
        expect(meta.get("chunkMutationEpoch")).toBe("2");
        expect(meta.get("lexicalSourceChunkEpoch")).toBe("2");
    });

    it("cleans an interrupted shadow on the next Worker initialization", async () => {
        const { db, chunks, lexicalEntries, meta } = createInMemoryMockDb();
        chunks.set(1, {
            id: 1,
            path: "note.md",
            chunk_index: 0,
            content: "召回",
            metadata: "{}",
            embedding: toFloat32Bytes([1, 0, 0]),
            content_hash: "chunk-1",
            created: 1,
            last_modified: 1,
        });
        const firstScope = setupWorkerScope();
        await initializeWorker(firstScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        const started = await send(firstScope, {
            id: 1,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (started.result as { rebuildId: string }).rebuildId;
        await send(firstScope, {
            id: 20,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["note.md"] },
        });
        await send(firstScope, {
            id: 2,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 1 },
        });
        expect(lexicalEntries[0].size).toBe(1);
        expect(meta.get("lexicalRebuildId")).toBe(rebuildId);

        jest.resetModules();
        const secondScope = setupWorkerScope();
        await initializeWorker(secondScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        const recovered = await send(secondScope, { id: 3, type: "getLexicalStatus", payload: {} });

        expect(recovered.result).toMatchObject({
            state: "awaiting_confirmation",
            reason: "profile_missing",
            chunkCount: 1,
            lexicalRowCount: 0,
        });
        expect(lexicalEntries[0].size).toBe(0);
        expect(meta.has("lexicalRebuildId")).toBe(false);
    });

    it("keeps vector search ready when interrupted lexical cleanup itself fails", async () => {
        const fixture = createInMemoryMockDb();
        const { db, chunks, meta } = fixture;
        chunks.set(1, {
            id: 1,
            path: "stable-vector.md",
            chunk_index: 0,
            content: "vector evidence remains",
            metadata: "{}",
            embedding: toFloat32Bytes([1, 0, 0]),
            content_hash: "chunk-1",
            created: 1,
            last_modified: 1,
        });
        meta.set("lexicalRebuildId", "interrupted-rebuild");
        meta.set("lexicalRebuildGeneration", "0");
        fixture.failNextLexicalRecreate();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const workerScope = setupWorkerScope();
            await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });
            const status = await send(workerScope, { id: 1, type: "getLexicalStatus", payload: {} });
            expect(status.result).toMatchObject({
                state: "failed",
                reason: "injected-lexical-recreate-failure",
                chunkCount: 1,
            });
            const search = await send(workerScope, {
                id: 2,
                type: "search",
                payload: { queryEmbedding: [1, 0, 0], k: 1 },
            });
            expect(search.result).toMatchObject([
                { doc: { pageContent: "vector evidence remains", metadata: { path: "stable-vector.md" } } },
            ]);
        } finally {
            warn.mockRestore();
        }
    });

    it("invalidates a shadow on an interleaved write while keeping the active generation coherent", async () => {
        const { db, chunks, lexicalEntries, meta } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "note.md",
                    contentHash: "old",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "note.md",
                    chunkIndex: 0,
                    content: "旧内容",
                    contentHash: "old-chunk",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const started = await send(workerScope, {
            id: 2,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (started.result as { rebuildId: string }).rebuildId;
        await send(workerScope, {
            id: 20,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["note.md"] },
        });
        await send(workerScope, {
            id: 3,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 1 },
        });

        await send(workerScope, {
            id: 4,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "note.md",
                    contentHash: "new",
                    mtime: 2,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "note.md",
                    chunkIndex: 0,
                    content: "新内容",
                    contentHash: "new-chunk",
                    created: 1,
                    lastModified: 2,
                    metadata: {},
                }],
                embeddings: [[0, 1, 0]],
            },
        });
        const status = await send(workerScope, { id: 5, type: "getLexicalStatus", payload: {} });

        expect(status.result).toMatchObject({
            state: "ready",
            reason: "source_epoch_changed",
            marker: { generation: 0, sourceChunkEpoch: "2" },
            chunkCount: 1,
            lexicalRowCount: 1,
        });
        expect([...lexicalEntries[0].values()].join(" ")).toContain("c65b0 c5185 c5bb9");
        expect(meta.get("lexicalRebuildId")).toBe(rebuildId);
        expect(lexicalEntries[1].size).toBe(1);
        expect([...chunks.values()][0].content).toBe("新内容");

        const lateScope = await send(workerScope, {
            id: 21,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["other.md"] },
        }) as unknown as SqliteWorkerResponse;
        expect(lateScope).toMatchObject({
            ok: false,
            error: { code: "lexical-rebuild-epoch-changed" },
        });

        const staleFinalize = await send(workerScope, {
            id: 6,
            type: "finalizeLexicalRebuild",
            payload: { rebuildId },
        }) as unknown as SqliteWorkerResponse;
        expect(staleFinalize.ok).toBe(false);

        const aborted = await send(workerScope, {
            id: 7,
            type: "abortLexicalRebuild",
            payload: { rebuildId, failureReason: "source_epoch_changed" },
        });
        expect(aborted.result).toMatchObject({ state: "ready", reason: "source_epoch_changed" });
        expect(meta.has("lexicalRebuildId")).toBe(false);
        expect(lexicalEntries[1].size).toBe(0);
        expect(lexicalEntries[0].size).toBe(1);
    });

    it("keeps the active generation coherent when writes interleave after a shadow batch failure", async () => {
        const fixture = createInMemoryMockDb();
        const { db, lexicalEntries, meta } = fixture;
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        const upsert = (id: number, path: string, content: string) => send(workerScope, {
            id,
            type: "upsertFile",
            payload: {
                fileState: {
                    path,
                    contentHash: `hash-${content}`,
                    mtime: id,
                    size: content.length,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path,
                    chunkIndex: 0,
                    content,
                    contentHash: `chunk-${content}`,
                    created: 1,
                    lastModified: id,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        await upsert(1, "update.md", "旧更新内容");
        await upsert(2, "delete.md", "待删除内容");

        const started = await send(workerScope, {
            id: 3,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 2,
            },
        });
        const rebuildId = (started.result as { rebuildId: string }).rebuildId;
        await send(workerScope, {
            id: 4,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["delete.md", "update.md"] },
        });
        fixture.failNextLexicalInsert();
        const failed = await send(workerScope, {
            id: 5,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 128 },
        }) as unknown as SqliteWorkerResponse;
        expect(failed).toMatchObject({ ok: false, error: { code: "injected-lexical-failure" } });

        // These foreground operations model the queue window before Host abort
        // cleanup is re-enqueued. Both must continue maintaining generation 0.
        await upsert(6, "update.md", "新更新内容");
        await send(workerScope, {
            id: 7,
            type: "deleteFile",
            payload: {
                path: "delete.md",
                options: {
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
            },
        });
        const beforeAbort = await send(workerScope, { id: 8, type: "getLexicalStatus", payload: {} });
        expect(beforeAbort.result).toMatchObject({
            state: "ready",
            marker: { generation: 0, sourceChunkEpoch: "4", eligibleRowCount: 1 },
            chunkCount: 1,
            lexicalRowCount: 1,
        });
        expect([...lexicalEntries[0].values()].join(" ")).toContain("c65b0 c66f4 c65b0 c5185 c5bb9");
        expect(meta.get("lexicalSourceChunkEpoch")).toBe("4");

        const aborted = await send(workerScope, {
            id: 9,
            type: "abortLexicalRebuild",
            payload: { rebuildId, failureReason: "injected-lexical-failure" },
        });
        expect(aborted.result).toMatchObject({
            state: "ready",
            marker: { generation: 0, sourceChunkEpoch: "4", eligibleRowCount: 1 },
        });
        expect(lexicalEntries[1].size).toBe(0);
    });

    it("emits a dedicated content-free receipt for one indexed-chunk incremental lexical refresh", async () => {
        const fixture = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, fixture.db, {
            dimensions: 3,
            lexicalProfileEnabled: true,
            lexicalBoundaryFingerprint: "scope-1",
        });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "receipt.md",
                    contentHash: "h1",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "receipt.md",
                    chunkIndex: 0,
                    content: "量子灯塔检索",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const beforeStats = (await send(workerScope, {
            id: 2,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        fixture.setEstimatedPageCountSequence([100, 120, 140, 130]);

        const response = await send(workerScope, {
            id: 3,
            type: "refreshLexicalPathFromIndexedChunks",
            payload: { path: "receipt.md", lexicalBoundaryFingerprint: "scope-1" },
        });
        const receipt = response.result as import("../src/vss/types").LexicalIncrementalMaintenanceReceipt;

        expect(receipt).toMatchObject({
            kind: "indexed-chunks-incremental",
            status: "completed",
            state: "ready",
            before: {
                sourceChunkRows: 1,
                lexicalRows: 1,
                totalLexicalRows: 1,
            },
            after: {
                sourceChunkRows: 1,
                lexicalRows: 1,
                totalLexicalRows: 1,
            },
            resourceEnvelope: {
                estimatedDbBytesBefore: 409_600,
                estimatedDbBytesPeak: 573_440,
                estimatedDbBytesAfter: 532_480,
            },
            effects: {
                source: "indexed-chunks",
                pathCount: 1,
                sourceChunkReads: 1,
                sourceChunkWrites: 0,
                lexicalRowsDeleted: 1,
                lexicalRowsInserted: 1,
                markdownReads: 0,
                markdownWrites: 0,
                providerCalls: 0,
                embeddingCalls: 0,
                embeddingWrites: 0,
            },
        });
        expect(receipt.operationId).toMatch(/^lexinc-[a-f0-9]{32}$/u);
        expect(receipt.scopeBindingSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(Object.keys(receipt).sort()).toEqual([
            "after",
            "before",
            "durationMs",
            "effects",
            "finishedAt",
            "kind",
            "operationId",
            "resourceEnvelope",
            "scopeBindingSha256",
            "startedAt",
            "state",
            "status",
        ]);
        expect(receipt.after).toMatchObject({
            databaseInstanceId: receipt.before.databaseInstanceId,
            profileId: receipt.before.profileId,
            generation: receipt.before.generation,
            sourceChunkEpoch: receipt.before.sourceChunkEpoch,
            chunkMutationEpoch: receipt.before.chunkMutationEpoch,
            rebuildEpoch: receipt.before.rebuildEpoch,
            indexMutationEpoch: receipt.before.indexMutationEpoch + 1,
            lexicalMaintenanceEpoch: receipt.before.lexicalMaintenanceEpoch + 1,
            incrementalMaintenanceEpoch: receipt.before.incrementalMaintenanceEpoch + 1,
        });
        expect(Date.parse(receipt.finishedAt)).toBeGreaterThanOrEqual(Date.parse(receipt.startedAt));
        expect(receipt.durationMs).toBeGreaterThanOrEqual(0);
        expect(Object.keys(receipt.resourceEnvelope).sort()).toEqual([
            "estimatedDbBytesAfter",
            "estimatedDbBytesBefore",
            "estimatedDbBytesPeak",
        ]);
        expect(fixture.getEstimatedPageCountSamples()).toEqual([100, 120, 140, 130]);
        expect(Number.isSafeInteger(receipt.resourceEnvelope.estimatedDbBytesPeak)).toBe(true);
        expect(receipt.resourceEnvelope.estimatedDbBytesPeak).toBeGreaterThanOrEqual(
            receipt.resourceEnvelope.estimatedDbBytesBefore,
        );
        expect(receipt.resourceEnvelope.estimatedDbBytesPeak).toBeGreaterThanOrEqual(
            receipt.resourceEnvelope.estimatedDbBytesAfter,
        );

        const afterStats = (await send(workerScope, {
            id: 4,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        expect(afterStats).toMatchObject({
            databaseInstanceId: beforeStats.databaseInstanceId,
            chunkMutationEpoch: beforeStats.chunkMutationEpoch,
            rebuildEpoch: beforeStats.rebuildEpoch,
            indexMutationEpoch: receipt.after.indexMutationEpoch,
            lexicalMaintenanceEpoch: receipt.after.lexicalMaintenanceEpoch,
            lexicalIncrementalMaintenanceEpoch: receipt.after.incrementalMaintenanceEpoch,
            lastLexicalMaintenanceKind: "indexed-chunks-incremental",
            lastLexicalMaintenanceOperationId: receipt.operationId,
        });
    });

    it("rolls back failed incremental refreshes, including an invalid final page-count sample", async () => {
        const fixture = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, fixture.db, {
            dimensions: 3,
            lexicalProfileEnabled: true,
            lexicalBoundaryFingerprint: "scope-1",
        });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "rollback.md",
                    contentHash: "h1",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "rollback.md",
                    chunkIndex: 0,
                    content: "回滚仍完整",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const before = (await send(workerScope, { id: 2, type: "getStats", payload: {} })).result as VSSIndexStats;
        fixture.failNextLexicalInsert();

        const failed = await send(workerScope, {
            id: 3,
            type: "refreshLexicalPathFromIndexedChunks",
            payload: { path: "rollback.md", lexicalBoundaryFingerprint: "scope-1" },
        }) as unknown as SqliteWorkerResponse;
        expect(failed).toMatchObject({ ok: false, error: { code: "injected-lexical-failure" } });

        const after = (await send(workerScope, { id: 4, type: "getStats", payload: {} })).result as VSSIndexStats;
        expect(after).toMatchObject({
            databaseInstanceId: before.databaseInstanceId,
            chunkMutationEpoch: before.chunkMutationEpoch,
            indexMutationEpoch: before.indexMutationEpoch,
            rebuildEpoch: before.rebuildEpoch,
            lexicalMaintenanceEpoch: before.lexicalMaintenanceEpoch,
            lexicalIncrementalMaintenanceEpoch: before.lexicalIncrementalMaintenanceEpoch,
            lastLexicalMaintenanceKind: before.lastLexicalMaintenanceKind,
            lastLexicalMaintenanceOperationId: before.lastLexicalMaintenanceOperationId,
        });
        expect(fixture.lexicalEntries[0].size).toBe(1);

        fixture.setEstimatedPageCountSequence([100, 120, 140, -1]);
        const invalidResourceExecStart = fixture.db.exec.mock.calls.length;
        const invalidResource = await send(workerScope, {
            id: 5,
            type: "refreshLexicalPathFromIndexedChunks",
            payload: { path: "rollback.md", lexicalBoundaryFingerprint: "scope-1" },
        }) as unknown as SqliteWorkerResponse;
        expect(invalidResource).toMatchObject({
            ok: false,
            error: { code: "lexical-maintenance-resource-invalid" },
        });
        expect(fixture.getEstimatedPageCountSamples()).toEqual([100, 120, 140, -1]);
        const invalidResourceTransactions = fixture.db.exec.mock.calls.slice(invalidResourceExecStart)
            .map(([request]) => typeof request === "string" ? request.trim() : null)
            .filter((request): request is string => request !== null);
        expect(invalidResourceTransactions).toEqual(expect.arrayContaining([
            "BEGIN IMMEDIATE",
            "ROLLBACK",
        ]));
        expect(invalidResourceTransactions).not.toContain("COMMIT");
        const afterInvalidResource = (await send(workerScope, {
            id: 6,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        expect(afterInvalidResource).toMatchObject({
            databaseInstanceId: before.databaseInstanceId,
            chunkMutationEpoch: before.chunkMutationEpoch,
            indexMutationEpoch: before.indexMutationEpoch,
            rebuildEpoch: before.rebuildEpoch,
            lexicalMaintenanceEpoch: before.lexicalMaintenanceEpoch,
            lexicalIncrementalMaintenanceEpoch: before.lexicalIncrementalMaintenanceEpoch,
            lastLexicalMaintenanceKind: before.lastLexicalMaintenanceKind,
            lastLexicalMaintenanceOperationId: before.lastLexicalMaintenanceOperationId,
        });
        expect(fixture.lexicalEntries[0].size).toBe(1);
    });

    it("rolls back rebuild activation when the final page-size sample is invalid", async () => {
        const fixture = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, fixture.db, {
            dimensions: 3,
            lexicalProfileEnabled: true,
            lexicalBoundaryFingerprint: "scope-1",
        });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "final-sample.md",
                    contentHash: "h1",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "final-sample.md",
                    chunkIndex: 0,
                    content: "最终采样失败仍可回滚",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        fixture.setEstimatedPageSizeSequence([4096, 4096, 4096, 4096, 4096, 0]);
        fixture.setEstimatedPageCountSequence([100, 110, 115, 140, 135, 130]);
        const started = await send(workerScope, {
            id: 2,
            type: "beginLexicalRebuildWithReceipt",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (started.result as { rebuildId: string }).rebuildId;
        await send(workerScope, {
            id: 3,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["final-sample.md"] },
        });
        await send(workerScope, {
            id: 4,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 128 },
        });
        const preFinalizeMeta = new Map(fixture.meta);
        const finalizeExecStart = fixture.db.exec.mock.calls.length;

        const failed = await send(workerScope, {
            id: 5,
            type: "finalizeLexicalRebuildWithReceipt",
            payload: { rebuildId },
        }) as unknown as SqliteWorkerResponse;

        expect(failed).toMatchObject({
            ok: false,
            error: { code: "lexical-maintenance-resource-invalid" },
        });
        expect(fixture.getEstimatedPageSizeSamples()).toEqual([4096, 4096, 4096, 4096, 4096, 0]);
        expect(fixture.getEstimatedPageCountSamples()).toEqual([100, 110, 115, 140, 135, 130]);
        expect(fixture.meta).toEqual(preFinalizeMeta);
        expect(fixture.meta.get("lexicalRebuildId")).toBe(rebuildId);
        const finalizeTransactions = fixture.db.exec.mock.calls.slice(finalizeExecStart)
            .map(([request]) => typeof request === "string" ? request.trim() : null)
            .filter((request): request is string => request !== null);
        expect(finalizeTransactions).toEqual(expect.arrayContaining(["BEGIN", "ROLLBACK"]));
        expect(finalizeTransactions).not.toContain("COMMIT");

        const aborted = await send(workerScope, {
            id: 6,
            type: "abortLexicalRebuild",
            payload: { rebuildId, failureReason: "test_cleanup" },
        });
        expect(aborted.ok).toBe(true);
        expect(fixture.meta.has("lexicalRebuildId")).toBe(false);
        expect(fixture.lexicalEntries[1].size).toBe(0);
    });

    it("returns a rebuild receipt only for the dedicated real rebuild path", async () => {
        const fixture = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, fixture.db, {
            dimensions: 3,
            lexicalProfileEnabled: true,
            lexicalBoundaryFingerprint: "scope-1",
        });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "rebuild.md",
                    contentHash: "h1",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "rebuild.md",
                    chunkIndex: 0,
                    content: "真实重建",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        fixture.setEstimatedPageCountSequence([100, 110, 115, 140, 135, 130]);
        const started = await send(workerScope, {
            id: 2,
            type: "beginLexicalRebuildWithReceipt",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const rebuildId = (started.result as { rebuildId: string }).rebuildId;
        await send(workerScope, {
            id: 3,
            type: "appendLexicalScopeBatch",
            payload: { rebuildId, paths: ["rebuild.md"] },
        });
        await send(workerScope, {
            id: 4,
            type: "appendLexicalRebuildBatch",
            payload: { rebuildId, afterRowId: 0, limit: 128 },
        });
        const finalized = await send(workerScope, {
            id: 5,
            type: "finalizeLexicalRebuildWithReceipt",
            payload: { rebuildId },
        });
        const result = finalized.result as import("../src/vss/types").LexicalRebuildFinalizeReceiptResult;
        const receipt = result.receipt;

        expect(result.status).toMatchObject({ state: "ready", lexicalRowCount: 1 });
        expect(receipt).toMatchObject({
            kind: "rebuild",
            status: "completed",
            state: "ready",
            before: { sourceChunkRows: 1, lexicalRows: 0, totalLexicalRows: 0 },
            after: { sourceChunkRows: 1, lexicalRows: 1, totalLexicalRows: 1 },
            resourceEnvelope: {
                estimatedDbBytesBefore: 409_600,
                estimatedDbBytesPeak: 573_440,
                estimatedDbBytesAfter: 532_480,
            },
            effects: {
                source: "indexed-chunks",
                pathCount: 1,
                sourceChunkReads: 1,
                sourceChunkWrites: 0,
                lexicalRowsDeleted: 0,
                lexicalRowsInserted: 1,
                markdownReads: 0,
                markdownWrites: 0,
                providerCalls: 0,
                embeddingCalls: 0,
                embeddingWrites: 0,
            },
        });
        expect(receipt.operationId).toMatch(/^lexreb-[a-f0-9]{32}$/u);
        expect(receipt.scopeBindingSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(Object.keys(receipt).sort()).toEqual([
            "after",
            "before",
            "durationMs",
            "effects",
            "finishedAt",
            "kind",
            "operationId",
            "resourceEnvelope",
            "scopeBindingSha256",
            "startedAt",
            "state",
            "status",
        ]);
        expect(Object.keys(receipt.resourceEnvelope).sort()).toEqual([
            "estimatedDbBytesAfter",
            "estimatedDbBytesBefore",
            "estimatedDbBytesPeak",
        ]);
        expect(fixture.getEstimatedPageCountSamples()).toEqual([100, 110, 115, 140, 135, 130]);
        expect(receipt.resourceEnvelope.estimatedDbBytesPeak).toBeGreaterThanOrEqual(
            receipt.resourceEnvelope.estimatedDbBytesBefore,
        );
        expect(receipt.resourceEnvelope.estimatedDbBytesPeak).toBeGreaterThanOrEqual(
            receipt.resourceEnvelope.estimatedDbBytesAfter,
        );
        expect(receipt.after).toMatchObject({
            databaseInstanceId: receipt.before.databaseInstanceId,
            profileId: receipt.before.profileId,
            generation: receipt.before.generation,
            sourceChunkEpoch: receipt.before.sourceChunkEpoch,
            chunkMutationEpoch: receipt.before.chunkMutationEpoch,
            rebuildEpoch: receipt.before.rebuildEpoch,
            incrementalMaintenanceEpoch: receipt.before.incrementalMaintenanceEpoch,
        });
        expect(receipt.after.indexMutationEpoch).toBeGreaterThan(receipt.before.indexMutationEpoch);
        expect(receipt.after.indexMutationEpoch - receipt.before.indexMutationEpoch).toBe(
            receipt.after.lexicalMaintenanceEpoch - receipt.before.lexicalMaintenanceEpoch,
        );
        const stats = (await send(workerScope, { id: 6, type: "getStats", payload: {} })).result as VSSIndexStats;
        expect(stats).toMatchObject({
            lastLexicalMaintenanceKind: "rebuild",
            lastLexicalMaintenanceOperationId: receipt.operationId,
            lexicalIncrementalMaintenanceEpoch: receipt.after.incrementalMaintenanceEpoch,
        });

        const ordinary = await send(workerScope, {
            id: 7,
            type: "beginLexicalRebuild",
            payload: {
                profileId: "char-phrase-v1",
                runtimeCanaryFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                scopeFingerprint: "scope-1",
                expectedPathCount: 1,
            },
        });
        const ordinaryId = (ordinary.result as { rebuildId: string }).rebuildId;
        const blockedIncremental = await send(workerScope, {
            id: 8,
            type: "refreshLexicalPathFromIndexedChunks",
            payload: { path: "rebuild.md", lexicalBoundaryFingerprint: "scope-1" },
        }) as unknown as SqliteWorkerResponse;
        expect(blockedIncremental).toMatchObject({
            ok: false,
            error: { code: "lexical-incremental-rebuild-active" },
        });
        const forged = await send(workerScope, {
            id: 9,
            type: "finalizeLexicalRebuildWithReceipt",
            payload: { rebuildId: ordinaryId },
        }) as unknown as SqliteWorkerResponse;
        expect(forged).toMatchObject({ ok: false, error: { code: "lexical-rebuild-receipt-missing" } });
        await send(workerScope, {
            id: 10,
            type: "abortLexicalRebuild",
            payload: { rebuildId: ordinaryId, failureReason: "test_cleanup" },
        });
    });
});

describe("SPEC-A6 data safety: upsert replaces old data", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("upserting the same file replaces old chunks and embeddings", async () => {
        const { db, chunks } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        // First upsert
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "evolving.md", contentHash: "v1", mtime: 1, size: 10 },
                chunks: [{ path: "evolving.md", chunkIndex: 0, content: "old content", contentHash: "c1", created: 1, lastModified: 1, metadata: {} }],
                embeddings: [[1, 0, 0]],
            },
        });

        const oldChunkCount = chunks.size;

        // Second upsert with new embedding
        await send(workerScope, {
            id: 2,
            type: "upsertFile",
            payload: {
                fileState: { path: "evolving.md", contentHash: "v2", mtime: 2, size: 20 },
                chunks: [{ path: "evolving.md", chunkIndex: 0, content: "new content", contentHash: "c2", created: 1, lastModified: 2, metadata: {} }],
                embeddings: [[0, 0, 1]],
            },
        });

        // Should have same number of chunks (old deleted, new inserted)
        expect(chunks.size).toBe(oldChunkCount);

        // Search should find new embedding direction
        const response = await send(workerScope, {
            id: 3, type: "search", payload: { queryEmbedding: [0, 0, 1], k: 1 },
        });
        expect(response.ok).toBe(true);
        const results = response.result as unknown as Array<{ doc: { pageContent: string } }>;
        expect(results[0].doc.pageContent).toBe("new content");
    });

    it("reloads the vector cache after a lexical write rolls back", async () => {
        const fixture = createInMemoryMockDb();
        const { db, chunks } = fixture;
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3, lexicalProfileEnabled: true });
        const lexicalFileState = {
            path: "stable.md",
            contentHash: "old",
            mtime: 1,
            size: 10,
            lexicalEligible: true,
            lexicalMaintenanceEnabled: true,
            lexicalBoundaryFingerprint: "scope-1",
        };
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: lexicalFileState,
                chunks: [{
                    path: "stable.md",
                    chunkIndex: 0,
                    content: "stable old content",
                    contentHash: "old-chunk",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        await send(workerScope, {
            id: 2,
            type: "search",
            payload: { queryEmbedding: [1, 0, 0], k: 1 },
        });
        const [oldId, oldRow] = [...chunks.entries()][0];
        fixture.failNextLexicalInsert();

        const failed = await send(workerScope, {
            id: 3,
            type: "upsertFile",
            payload: {
                fileState: { ...lexicalFileState, contentHash: "new", mtime: 2 },
                chunks: [{
                    path: "stable.md",
                    chunkIndex: 0,
                    content: "new content must roll back",
                    contentHash: "new-chunk",
                    created: 1,
                    lastModified: 2,
                    metadata: {},
                }],
                embeddings: [[0, 1, 0]],
            },
        }) as unknown as SqliteWorkerResponse;
        expect(failed).toMatchObject({ ok: false, error: { code: "injected-lexical-failure" } });

        // The in-memory SQL fixture cannot roll back maps, so restore the row as
        // SQLite would. The subsequent search proves the Worker invalidated its
        // already-loaded cache and re-read the restored vector.
        chunks.clear();
        chunks.set(oldId, oldRow);
        const recovered = await send(workerScope, {
            id: 4,
            type: "search",
            payload: { queryEmbedding: [1, 0, 0], k: 1 },
        });
        expect(recovered.result).toMatchObject([
            { doc: { pageContent: "stable old content", metadata: { path: "stable.md" } } },
        ]);
    });
});

describe("SPEC-A6 data safety: profile signature compatibility", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("existing profile signature is recognized (no false stale detection)", async () => {
        const { db, meta } = createInMemoryMockDb();

        // Simulate pre-existing data with a known signature
        meta.set("profileSignature", "test||test-model|4|COSINE");
        meta.set("schemaVersion", "1");

        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 4 });

        const initResponse = workerScope.postMessage.mock.calls.find(
            (c) => (c[0] as SqliteWorkerSuccess).id === 0,
        )?.[0] as SqliteWorkerSuccess;

        expect(initResponse.ok).toBe(true);
        expect(initResponse.result).toBe("ready");
    });

    it("repairs legacy empty evidence generations from the complete local inventory without rebuilding vectors", async () => {
        const { db, files, chunks, ftsEntries, meta } = createInMemoryMockDb();
        const fileState = { path: "legacy.md", contentHash: "legacy-file", mtime: 10, size: 200 };
        const legacyChunks = [
            {
                path: "legacy.md",
                chunkIndex: 0,
                content: "selected legacy evidence",
                contentHash: "legacy-chunk-0",
                created: 1,
                lastModified: 10,
                metadata: { headingPath: ["Selected"] },
            },
            {
                path: "legacy.md",
                chunkIndex: 1,
                content: "unselected inventory still participates",
                contentHash: "legacy-chunk-1",
                created: 1,
                lastModified: 10,
                metadata: { headingPath: ["Inventory"] },
            },
        ];
        const firstEmbedding = toFloat32Bytes([1, 0, 0]);
        const secondEmbedding = toFloat32Bytes([0, 1, 0]);
        files.set(fileState.path, {
            path: fileState.path,
            contentHash: fileState.contentHash,
            mtime: fileState.mtime,
            size: fileState.size,
            status: "ready",
            updatedAt: 1,
            evidence_generation: "",
        });
        chunks.set(1, {
            id: 1,
            path: fileState.path,
            chunk_index: 0,
            content: legacyChunks[0].content,
            metadata: JSON.stringify(legacyChunks[0].metadata),
            embedding: firstEmbedding,
            content_hash: legacyChunks[0].contentHash,
            created: 1,
            last_modified: 10,
        });
        chunks.set(2, {
            id: 2,
            path: fileState.path,
            chunk_index: 1,
            content: legacyChunks[1].content,
            metadata: JSON.stringify(legacyChunks[1].metadata),
            embedding: secondEmbedding,
            content_hash: legacyChunks[1].contentHash,
            created: 1,
            last_modified: 10,
        });
        meta.set("profileSignature", "test||test-model|3|COSINE");

        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });
        const chunksBefore = [...chunks.entries()].map(([id, row]) => [id, { ...row }] as const);
        const ftsBefore = [...ftsEntries.entries()];
        const epochBefore = meta.get("chunkMutationEpoch") ?? "0";

        const lookup = await send(workerScope, {
            id: 1,
            type: "getPathEvidenceGenerations",
            payload: {
                paths: [fileState.path],
                maxPathsPerBatch: 64,
                maxChunksScanned: 6_000,
                control: {
                    requestId: "path-evidence-1",
                    runEpoch: "test-run",
                    absoluteDeadlineMs: Date.now() + 10_000,
                },
            },
        });
        const expectedGeneration = computePathEvidenceGeneration(fileState, legacyChunks);

        expect(lookup.result).toEqual({
            sourceEpoch: epochBefore,
            paths: [{
                path: fileState.path,
                generation: expectedGeneration,
                contentHash: fileState.contentHash,
                mtime: fileState.mtime,
                size: fileState.size,
            }],
        });
        expect(files.get(fileState.path)?.evidence_generation).toBe(expectedGeneration);
        expect(meta.get("chunkMutationEpoch") ?? "0").toBe(epochBefore);
        expect([...chunks.entries()]).toEqual(chunksBefore);
        expect([...ftsEntries.entries()]).toEqual(ftsBefore);
        expect(chunks.get(1)?.embedding).toEqual(firstEmbedding);
        expect(chunks.get(2)?.embedding).toEqual(secondEmbedding);
    });

    it("keeps a legacy generation unknown when the complete inventory exceeds the repair cap", async () => {
        const { db, files, chunks, meta } = createInMemoryMockDb();
        files.set("oversized.md", {
            path: "oversized.md",
            contentHash: "oversized-file",
            mtime: 10,
            size: 200,
            status: "ready",
            updatedAt: 1,
            evidence_generation: "",
        });
        for (let index = 0; index < 2; index += 1) {
            chunks.set(index + 1, {
                id: index + 1,
                path: "oversized.md",
                chunk_index: index,
                content: `chunk-${index}`,
                metadata: "{}",
                embedding: toFloat32Bytes(index === 0 ? [1, 0, 0] : [0, 1, 0]),
                content_hash: `chunk-hash-${index}`,
                created: 1,
                last_modified: 10,
            });
        }
        meta.set("profileSignature", "test||test-model|3|COSINE");
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        const lookup = await send(workerScope, {
            id: 1,
            type: "getPathEvidenceGenerations",
            payload: {
                paths: ["oversized.md"],
                maxPathsPerBatch: 64,
                maxChunksScanned: 1,
                control: {
                    requestId: "path-evidence-1",
                    runEpoch: "test-run",
                    absoluteDeadlineMs: Date.now() + 10_000,
                },
            },
        });

        expect(lookup.result).toEqual({ sourceEpoch: "0", paths: [] });
        expect(files.get("oversized.md")?.evidence_generation).toBe("");
    });

    it("detects stale when profile changes (dimension/model change)", async () => {
        const { db, meta, lexicalEntries } = createInMemoryMockDb();

        // Simulate data indexed with a DIFFERENT model
        meta.set("profileSignature", "openai||old-model|1024|COSINE");
        meta.set("schemaVersion", "1");
        meta.set("lexicalRebuildId", "interrupted-shadow");
        meta.set("lexicalRebuildGeneration", "1");
        lexicalEntries[1].set(99, "c53ec c56de");

        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 4 });

        const initResponse = workerScope.postMessage.mock.calls.find(
            (c) => (c[0] as SqliteWorkerSuccess).id === 0,
        )?.[0] as SqliteWorkerSuccess;

        expect(initResponse.ok).toBe(true);
        expect(initResponse.result).toBe("stale");
        expect(meta.has("lexicalRebuildId")).toBe(false);
        expect(meta.has("lexicalRebuildGeneration")).toBe(false);
        expect(lexicalEntries[1].size).toBe(0);
    });
});

describe("SPEC-A6 data safety: verify detects corruption", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("verify returns ready when signature matches", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 4 });

        const response = await send(workerScope, {
            id: 1, type: "verify", payload: {},
        });

        expect(response.ok).toBe(true);
        expect(response.result).toBe("ready");
    });
});

describe("SPEC-A6 data safety: multi-chunk file integrity", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("preserves all chunks and embeddings for multi-chunk files", async () => {
        const { db, chunks } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        const embeddings = [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
        ];

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "long.md", contentHash: "h1", mtime: 1, size: 1000 },
                chunks: [
                    { path: "long.md", chunkIndex: 0, content: "chunk zero", contentHash: "c0", created: 1, lastModified: 1, metadata: { heading: "intro" } },
                    { path: "long.md", chunkIndex: 1, content: "chunk one", contentHash: "c1", created: 1, lastModified: 1, metadata: { heading: "body" } },
                    { path: "long.md", chunkIndex: 2, content: "chunk two", contentHash: "c2", created: 1, lastModified: 1, metadata: { heading: "conclusion" } },
                ],
                embeddings,
            },
        });

        // Verify all 3 chunks stored
        const fileChunks = [...chunks.values()].filter((c) => c.path === "long.md");
        expect(fileChunks).toHaveLength(3);

        // Verify each embedding is correct
        for (let i = 0; i < 3; i++) {
            const chunk = fileChunks.find((c) => c.chunk_index === i);
            expect(chunk).toBeDefined();
            const blob = chunk!.embedding as Uint8Array;
            const readBack = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
            expect(Array.from(readBack)).toEqual(Array.from(new Float32Array(embeddings[i])));
        }

        // Verify search finds the right chunk for each direction
        for (let i = 0; i < 3; i++) {
            const query = embeddings[i];
            const response = await send(workerScope, {
                id: 10 + i, type: "search", payload: { queryEmbedding: query, k: 1 },
            });
            expect(response.ok).toBe(true);
            const results = response.result as unknown as Array<{ doc: { pageContent: string; metadata: { chunkIndex: number } } }>;
            expect(results[0].doc.pageContent).toBe(`chunk ${["zero", "one", "two"][i]}`);
        }
    });
});

describe("SPEC-A6 data safety: metadata preservation", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("preserves chunk metadata through search results", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        const metadata = { heading: "Introduction", loc: { start: 0, end: 100 } };

        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "meta.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{
                    path: "meta.md", chunkIndex: 0, content: "hello",
                    contentHash: "c1", created: 1, lastModified: 1, metadata,
                }],
                embeddings: [[1, 0, 0]],
            },
        });

        const response = await send(workerScope, {
            id: 2, type: "search", payload: { queryEmbedding: [1, 0, 0], k: 1 },
        });

        expect(response.ok).toBe(true);
        const results = response.result as unknown as Array<{
            doc: { metadata: { heading: string; path: string; chunkIndex: number } };
        }>;
        expect(results[0].doc.metadata.heading).toBe("Introduction");
        expect(results[0].doc.metadata.path).toBe("meta.md");
        expect(results[0].doc.metadata.chunkIndex).toBe(0);
    });
});

describe("SPEC-A6 data safety: file record lifecycle", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("listFilePaths reflects upserts and deletes", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });

        await send(workerScope, {
            id: 1, type: "upsertFile",
            payload: {
                fileState: { path: "a.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{ path: "a.md", chunkIndex: 0, content: "a", contentHash: "c1", created: 1, lastModified: 1, metadata: {} }],
                embeddings: [[1, 0, 0]],
            },
        });
        await send(workerScope, {
            id: 2, type: "upsertFile",
            payload: {
                fileState: { path: "b.md", contentHash: "h2", mtime: 1, size: 10 },
                chunks: [{ path: "b.md", chunkIndex: 0, content: "b", contentHash: "c2", created: 1, lastModified: 1, metadata: {} }],
                embeddings: [[0, 1, 0]],
            },
        });

        let listResponse = await send(workerScope, {
            id: 3, type: "listFilePaths", payload: {},
        });
        expect(listResponse.ok).toBe(true);
        expect(listResponse.result).toContain("a.md");
        expect(listResponse.result).toContain("b.md");

        await send(workerScope, {
            id: 4, type: "deleteFile", payload: { path: "a.md" },
        });

        listResponse = await send(workerScope, {
            id: 5, type: "listFilePaths", payload: {},
        });
        expect(listResponse.ok).toBe(true);
        expect(listResponse.result).not.toContain("a.md");
        expect(listResponse.result).toContain("b.md");
    });
});

describe("OPFS restart continuity metadata", () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");

    afterEach(() => {
        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        if (originalSelf) {
            Object.defineProperty(globalThis, "self", originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it("persists the database identity and mutation epochs across a Worker restart", async () => {
        const { db } = createInMemoryMockDb();
        const firstScope = setupWorkerScope();
        await initializeWorker(firstScope, db, { dimensions: 3 });
        await send(firstScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "continuity.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{
                    path: "continuity.md",
                    chunkIndex: 0,
                    content: "continuity",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const before = (await send(firstScope, {
            id: 2,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        await send(firstScope, { id: 3, type: "dispose", payload: {} });

        jest.resetModules();
        jest.dontMock("@sqlite.org/sqlite-wasm");
        const secondScope = setupWorkerScope();
        await initializeWorker(secondScope, db, { dimensions: 3 });
        const after = (await send(secondScope, {
            id: 4,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;

        expect(before.databaseInstanceId).toMatch(/^[a-f0-9-]{32,36}$/u);
        expect(after).toMatchObject({
            databaseInstanceId: before.databaseInstanceId,
            chunkMutationEpoch: before.chunkMutationEpoch,
            indexMutationEpoch: before.indexMutationEpoch,
            rebuildEpoch: before.rebuildEpoch,
            lexicalMaintenanceEpoch: before.lexicalMaintenanceEpoch,
            fileCount: before.fileCount,
            chunkCount: before.chunkCount,
        });
    });

    it("changes database identity and rebuild epoch on a destructive reset", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });
        const before = (await send(workerScope, {
            id: 1,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;

        await send(workerScope, { id: 2, type: "reset", payload: {} });
        const after = (await send(workerScope, {
            id: 3,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;

        expect(after.databaseInstanceId).toMatch(/^[a-f0-9-]{32,36}$/u);
        expect(after.databaseInstanceId).not.toBe(before.databaseInstanceId);
        expect(after.rebuildEpoch).toBe((before.rebuildEpoch ?? 0) + 1);
        expect(after.indexMutationEpoch).toBeGreaterThan(before.indexMutationEpoch ?? 0);
        expect(after.fileCount).toBe(before.fileCount);
        expect(after.chunkCount).toBe(before.chunkCount);
    });

    it("advances the index epoch for metadata-only maintenance with stable counts", async () => {
        const { db } = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 3 });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: { path: "metadata.md", contentHash: "h1", mtime: 1, size: 10 },
                chunks: [{
                    path: "metadata.md",
                    chunkIndex: 0,
                    content: "metadata",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const before = (await send(workerScope, {
            id: 2,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;

        await send(workerScope, {
            id: 3,
            type: "updateFileMetadata",
            payload: {
                fileState: { path: "metadata.md", contentHash: "h1", mtime: 2, size: 10 },
            },
        });
        const after = (await send(workerScope, {
            id: 4,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;

        expect(after).toMatchObject({
            databaseInstanceId: before.databaseInstanceId,
            chunkMutationEpoch: before.chunkMutationEpoch,
            rebuildEpoch: before.rebuildEpoch,
            lexicalMaintenanceEpoch: before.lexicalMaintenanceEpoch,
            fileCount: before.fileCount,
            chunkCount: before.chunkCount,
        });
        expect(after.indexMutationEpoch).toBe((before.indexMutationEpoch ?? 0) + 1);
    });

    it("keeps all mutation and lexical state stable when deleting a path with no stored rows", async () => {
        const fixture = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, fixture.db, {
            dimensions: 3,
            lexicalProfileEnabled: true,
        });
        await send(workerScope, {
            id: 1,
            type: "upsertFile",
            payload: {
                fileState: {
                    path: "preserved.md",
                    contentHash: "h1",
                    mtime: 1,
                    size: 10,
                    lexicalEligible: true,
                    lexicalMaintenanceEnabled: true,
                    lexicalBoundaryFingerprint: "scope-1",
                },
                chunks: [{
                    path: "preserved.md",
                    chunkIndex: 0,
                    content: "preserved",
                    contentHash: "c1",
                    created: 1,
                    lastModified: 1,
                    metadata: {},
                }],
                embeddings: [[1, 0, 0]],
            },
        });
        const before = (await send(workerScope, {
            id: 2,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        const lexicalBefore = await send(workerScope, {
            id: 3,
            type: "getLexicalStatus",
            payload: {},
        });
        const warmSearch = await send(workerScope, {
            id: 4,
            type: "search",
            payload: { queryEmbedding: [1, 0, 0], k: 10 },
        });
        expect(warmSearch.result).toHaveLength(1);
        const vectorCacheLoadsBefore = fixture.db.exec.mock.calls.filter(([request]) => (
            typeof request === "object"
            && request !== null
            && "sql" in request
            && request.sql === "SELECT id, embedding FROM vss_chunks"
        )).length;

        await send(workerScope, {
            id: 5,
            type: "deleteFile",
            payload: {
                path: "missing.md",
                options: {
                    lexicalMaintenanceEnabled: false,
                    lexicalBoundaryFingerprint: "scope-1",
                },
            },
        });

        const after = (await send(workerScope, {
            id: 6,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        expect(after).toMatchObject({
            chunkMutationEpoch: before.chunkMutationEpoch,
            indexMutationEpoch: before.indexMutationEpoch,
            rebuildEpoch: before.rebuildEpoch,
            lexicalMaintenanceEpoch: before.lexicalMaintenanceEpoch,
            fileCount: before.fileCount,
            chunkCount: before.chunkCount,
        });
        const lexicalAfter = await send(workerScope, {
            id: 7,
            type: "getLexicalStatus",
            payload: {},
        });
        expect(lexicalAfter.result).toEqual(lexicalBefore.result);
        const afterSearch = await send(workerScope, {
            id: 8,
            type: "search",
            payload: { queryEmbedding: [1, 0, 0], k: 10 },
        });
        expect(afterSearch.result).toEqual(warmSearch.result);
        const vectorCacheLoadsAfter = fixture.db.exec.mock.calls.filter(([request]) => (
            typeof request === "object"
            && request !== null
            && "sql" in request
            && request.sql === "SELECT id, embedding FROM vss_chunks"
        )).length;
        expect(vectorCacheLoadsAfter).toBe(vectorCacheLoadsBefore);
    });

    it("advances mutation epochs when either a file row or an orphan chunk exists", async () => {
        const fixture = createInMemoryMockDb();
        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, fixture.db, { dimensions: 3 });
        fixture.files.set("file-only.md", {
            path: "file-only.md",
            contentHash: "h1",
            mtime: 1,
            size: 10,
            status: "ready",
            updatedAt: 1,
        });
        fixture.chunks.set(41, {
            id: 41,
            path: "chunk-only.md",
            chunk_index: 0,
            content: "orphan",
            metadata: "{}",
            embedding: toFloat32Bytes([1, 0, 0]),
            content_hash: "c1",
            created: 1,
            last_modified: 1,
        });
        fixture.ftsEntries.set(41, "orphan");

        const before = (await send(workerScope, {
            id: 1,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        await send(workerScope, {
            id: 2,
            type: "deleteFile",
            payload: { path: "file-only.md" },
        });
        const afterFileOnly = (await send(workerScope, {
            id: 3,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        expect(afterFileOnly).toMatchObject({
            fileCount: 0,
            chunkCount: 1,
            chunkMutationEpoch: (before.chunkMutationEpoch ?? 0) + 1,
            indexMutationEpoch: (before.indexMutationEpoch ?? 0) + 1,
        });

        await send(workerScope, {
            id: 4,
            type: "deleteFile",
            payload: { path: "chunk-only.md" },
        });
        const afterChunkOnly = (await send(workerScope, {
            id: 5,
            type: "getStats",
            payload: {},
        })).result as VSSIndexStats;
        expect(afterChunkOnly).toMatchObject({
            fileCount: 0,
            chunkCount: 0,
            chunkMutationEpoch: (before.chunkMutationEpoch ?? 0) + 2,
            indexMutationEpoch: (before.indexMutationEpoch ?? 0) + 2,
        });
        expect(fixture.ftsEntries.has(41)).toBe(false);
    });
});

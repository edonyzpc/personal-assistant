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

/**
 * Creates a mock SQLite database that stores data in-memory maps,
 * enabling full round-trip verification of embedding data.
 */
function createInMemoryMockDb() {
    const files = new Map<string, InMemoryRow>();
    const chunks = new Map<number, InMemoryRow>();
    const ftsEntries = new Map<number, string>();
    const meta = new Map<string, string>();
    let nextChunkId = 1;

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
                const [path, contentHash, mtime, size, updatedAt] = bindings;
                files.set(path as string, {
                    path, contentHash, mtime, size, status: "ready", updatedAt,
                });
            } else if (preparedSql.includes("INSERT INTO vss_chunks(")) {
                const id = nextChunkId++;
                const [path, chunkIndex, content, metadata, embedding, contentHash, created, lastModified] = bindings;
                chunks.set(id, {
                    id, path, chunk_index: chunkIndex, content, metadata,
                    embedding, content_hash: contentHash, created, last_modified: lastModified,
                });
                ftsEntries.set(id, content as string);
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
                if (request.includes("DROP TABLE") && request.includes("vss_chunks")) {
                    chunks.clear();
                    ftsEntries.clear();
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

            // Count queries
            if (sql.includes("SELECT COUNT(*)") && sql.includes("vss_chunks_fts")) {
                if (req.resultRows) {
                    (req.resultRows as unknown[][]).push([ftsEntries.size]);
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

            if (sql.includes("SELECT id FROM vss_chunks WHERE 1=1")) {
                const temporalBinds = req.bind ?? [];
                if (req.resultRows) {
                    for (const [id, row] of chunks) {
                        if (matchesTemporalClause(row, sql, temporalBinds)) {
                            (req.resultRows as InMemoryRow[]).push({ id });
                        }
                    }
                }
                return;
            }

            // SELECT for search metadata retrieval
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
                    for (const [id, content] of ftsEntries) {
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
                                });
                                count++;
                            }
                        }
                    }
                }
                return;
            }

            // SELECT path FROM vss_files
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
                if (req.resultRows) (req.resultRows as unknown[][]).push([4096]);
                return;
            }
            if (sql.includes("PRAGMA page_count")) {
                if (req.resultRows) (req.resultRows as unknown[][]).push([100]);
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
        close: jest.fn(),
    };

    return { db, files, chunks, ftsEntries, meta };
}

function setupWorkerScope(): MockWorkerScope {
    return { postMessage: jest.fn() };
}

async function initializeWorker(
    workerScope: MockWorkerScope,
    db: ReturnType<typeof createInMemoryMockDb>["db"],
    options?: { dimensions?: number; distanceMetric?: "COSINE" | "L2" },
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
        },
    });

    return { pauseVfs };
}

async function send(
    scope: MockWorkerScope,
    request: SqliteWorkerRequest,
): Promise<SqliteWorkerSuccess> {
    scope.onmessage?.({ data: request } as MessageEvent<SqliteWorkerRequest>);
    await new Promise((r) => setTimeout(r, 0));
    return scope.postMessage.mock.calls.at(-1)?.[0] as SqliteWorkerSuccess;
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
        const results = response.result as unknown as Array<{ doc: { metadata: { path: string } } }>;
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
        const results = response.result as unknown as Array<{ doc: { metadata: { path: string } } }>;
        expect(results.map((result) => result.doc.metadata.path)).toEqual(["recent.md"]);
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

    it("detects stale when profile changes (dimension/model change)", async () => {
        const { db, meta } = createInMemoryMockDb();

        // Simulate data indexed with a DIFFERENT model
        meta.set("profileSignature", "openai||old-model|1024|COSINE");
        meta.set("schemaVersion", "1");

        const workerScope = setupWorkerScope();
        await initializeWorker(workerScope, db, { dimensions: 4 });

        const initResponse = workerScope.postMessage.mock.calls.find(
            (c) => (c[0] as SqliteWorkerSuccess).id === 0,
        )?.[0] as SqliteWorkerSuccess;

        expect(initResponse.ok).toBe(true);
        expect(initResponse.result).toBe("stale");
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

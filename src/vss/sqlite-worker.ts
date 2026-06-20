/// <reference lib="webworker" />

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
    getEmbeddingProfileSignature,
    scoreFromDistance,
    VSS_SCHEMA_VERSION,
    type EmbeddingProfile,
    type VSSChunk,
    type VSSFileRecord,
    type VSSFileState,
    type VSSIndexStats,
} from "./types";
import { fuseRRF } from "./rrf";
import { bruteForceTopK } from "./brute-force-search";
import type { SqliteWorkerRequest, SqliteWorkerResponse } from "./sqlite-worker-protocol";

type SQLiteExecOptions = {
    sql: string;
    bind?: unknown[];
    rowMode?: string;
    resultRows?: unknown[];
};
type SQLiteStatement = {
    bind(index: number, value: unknown): SQLiteStatement;
    bindAsBlob(index: number, value: Uint8Array): SQLiteStatement;
    step(): boolean;
    reset(clearBindings?: boolean): void;
    finalize(): void;
};
type SQLiteDatabase = {
    exec(input: string | SQLiteExecOptions): unknown;
    prepare(sql: string): SQLiteStatement;
    close(): void;
};
type SQLiteModule = {
    installOpfsSAHPoolVfs?: (options: Record<string, unknown>) => Promise<SQLiteOpfsPool>;
};
type SQLiteOpfsPool = SQLiteModule & OpfsSahPool & {
    OpfsSAHPoolDb?: new (filename: string, flags?: string) => SQLiteDatabase;
};
type OpfsSahPool = {
    pauseVfs?: () => unknown;
};
type SqliteApiConfig = {
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    log?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
};
type SqliteWorkerGlobalScope = DedicatedWorkerGlobalScope & {
    sqlite3ApiConfig?: SqliteApiConfig;
    navigator?: DedicatedWorkerGlobalScope["navigator"] & {
        storage?: { getDirectory?: () => Promise<OpfsDirectoryHandle> };
    };
};

interface OpfsDatabaseOptions {
    directory?: string;
    legacyDirectory?: string;
    vfsName?: string;
}

let sqlite3: SQLiteModule | null = null;
let db: SQLiteDatabase | null = null;
let activePool: OpfsSahPool | null = null;
let activeProfile: EmbeddingProfile | null = null;
let status: VSSIndexStats["status"] = "uninitialized";
let initDurationMs: number | undefined;
let lastRefreshDurationMs: number | undefined;
let lastSearchDurationMs: number | undefined;
let lastErrorCode: string | undefined;
let requestQueue: Promise<void> = Promise.resolve();
let disposed = false;
let vectorCache: Map<number, Float32Array> | null = null;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<SqliteWorkerRequest>) => {
    const request = event.data;
    requestQueue = requestQueue.then(
        () => handleAndPostRequest(request),
        () => handleAndPostRequest(request),
    );
};

async function handleAndPostRequest(request: SqliteWorkerRequest): Promise<void> {
    try {
        const result = await handleRequest(request);
        ctx.postMessage({ id: request.id, ok: true, result } as SqliteWorkerResponse);
    } catch (error) {
        const code = getErrorCode(error);
        lastErrorCode = code;
        ctx.postMessage({
            id: request.id,
            ok: false,
            error: {
                code,
                message: error instanceof Error ? error.message : String(error),
            },
        } as SqliteWorkerResponse);
    }
}

async function handleRequest(request: SqliteWorkerRequest): Promise<unknown> {
    if (disposed && request.type !== "dispose") {
        throw createWorkerError("sqlite-worker-disposed", "SQLite worker has been disposed.");
    }
    switch (request.type) {
        case "initialize":
            return await initialize(request.payload.profile, request.payload.databaseName, request.payload.wasmUrl, {
                directory: request.payload.opfsDirectory,
                legacyDirectory: request.payload.legacyOpfsDirectory,
                vfsName: request.payload.opfsVfsName,
            });
        case "upsertFile":
            requireDb();
            upsertFile(request.payload.fileState, request.payload.chunks, request.payload.embeddings);
            return null;
        case "updateFileMetadata":
            requireDb();
            updateFileMetadata(request.payload.fileState);
            return null;
        case "deleteFile":
            requireDb();
            deleteFile(request.payload.path);
            return null;
        case "listFilePaths":
            requireDb();
            return listFilePaths();
        case "listFileRecords":
            requireDb();
            return listFileRecords();
        case "search":
            requireDb();
            return search(request.payload.queryEmbedding, request.payload.k);
        case "getChunksByPath":
            requireDb();
            return getChunksByPath(request.payload.paths, request.payload.limitPerPath);
        case "searchHybrid":
            requireDb();
            return searchHybrid(
                request.payload.queryEmbedding,
                request.payload.ftsQuery,
                request.payload.k,
                request.payload.fusionTopK,
                request.payload.temporalFilter,
            );
        case "getFileRecord":
            requireDb();
            return getFileRecord(request.payload.path);
        case "getStats":
            requireDb();
            return getStats();
        case "verify":
            requireDb();
            return verify();
        case "reset":
            requireDb();
            reset();
            return null;
        case "clusterVectors":
            return clusterVectorsInWorker(request.payload.maxClusters);
        case "dispose":
            disposed = true;
            dispose();
            return null;
    }
}

async function initialize(
    profile: EmbeddingProfile,
    databaseName: string,
    wasmUrl?: string,
    opfsOptions: OpfsDatabaseOptions = {},
): Promise<VSSIndexStats["status"]> {
    const startedAt = performance.now();
    assertWorkerActive();
    activeProfile = profile;
    status = "initializing";

    try {
        configureSqliteLogging();
        // The official @sqlite.org/sqlite-wasm types declare init() with no args,
        // but the Emscripten module loader accepts locateFile/printErr at runtime.
        sqlite3 ??= await (sqlite3InitModule as (opts: Record<string, unknown>) => Promise<SQLiteModule>)({
            locateFile: (path: string, prefix: string) => {
                if (path.endsWith(".wasm") && wasmUrl) return wasmUrl;
                return `${prefix}${path}`;
            },
            printErr: (message: string) => {
                if (!isExpectedUnusedOpfsVfsMessage(message)) {
                    console.error(message);
                }
            },
        });
        assertWorkerActive();

        if (!db) {
            db = await openOpfsDatabase(sqlite3, databaseName, opfsOptions);
            assertWorkerActive();
            await cleanupLegacyOpfsDirectory(opfsOptions.legacyDirectory, opfsOptions.directory);
            assertWorkerActive();
        }

        createSchema(db);
        backfillFtsIfNeeded(db);
        const storedSignature = getMeta("profileSignature");
        const profileSignature = getEmbeddingProfileSignature(profile);

        if (storedSignature && storedSignature !== profileSignature) {
            status = "stale";
            return status;
        }

        setMeta("schemaVersion", String(VSS_SCHEMA_VERSION));
        setMeta("profileSignature", profileSignature);
        setMeta("backend", "sqlite-wasm-opfs-sahpool");
        initializeVectorColumn(profile);
        status = "ready";
        initDurationMs = performance.now() - startedAt;
        lastErrorCode = undefined;
        return status;
    } catch (error) {
        dispose();
        status = "error";
        lastErrorCode = getErrorCode(error);
        throw error;
    }
}

function assertWorkerActive(): void {
    if (disposed) {
        throw createWorkerError("sqlite-worker-disposed", "SQLite worker has been disposed.");
    }
}

async function openOpfsDatabase(
    module: SQLiteModule,
    databaseName: string,
    options: OpfsDatabaseOptions = {},
): Promise<SQLiteDatabase> {
    if (!module.installOpfsSAHPoolVfs) {
        throw createWorkerError("opfs-sahpool-unavailable", "sqlite-wasm does not expose opfs-sahpool.");
    }

    let pool: SQLiteOpfsPool;
    try {
        pool = await module.installOpfsSAHPoolVfs({
            name: options.vfsName ?? "opfs-sahpool",
            directory: options.directory ?? "/personal-assistant-vss",
            initialCapacity: 12,
            verbosity: 0,
            forceReinitIfPreviouslyFailed: true,
        });
    } catch (error) {
        if (isOpfsBusyError(error)) {
            throw createWorkerError(
                "opfs-sahpool-locked",
                "Local memory storage is busy. Close other Obsidian windows for this vault, then try again.",
            );
        }
        if (isMissingOpfsApiError(error)) {
            throw createWorkerError("opfs-sahpool-unavailable", "Local memory storage is not available on this device.");
        }
        throw error;
    }
    const DbCtor = pool.OpfsSAHPoolDb;
    if (!DbCtor) {
        throw createWorkerError("opfs-sahpool-unavailable", "opfs-sahpool database constructor is unavailable.");
    }
    activePool = pool;
    const openedDb = new DbCtor(databaseName, "c");
    return openedDb;
}

function configureSqliteLogging(): void {
    const globalScope = ctx as unknown as SqliteWorkerGlobalScope;
    globalScope.sqlite3ApiConfig = {
        ...(globalScope.sqlite3ApiConfig ?? {}),
        warn: (...args: unknown[]) => {
            if (!isExpectedUnusedOpfsVfsWarning(args)) {
                console.warn(...args);
            }
        },
        error: (...args: unknown[]) => {
            if (!isExpectedUnusedOpfsVfsWarning(args) && !isExpectedOpfsCleanupBusyWarning(args)) {
                console.error(...args);
            }
        },
        log: (...args: unknown[]) => console.log(...args),
        debug: (...args: unknown[]) => console.debug(...args),
    };
}

function isExpectedUnusedOpfsVfsWarning(args: unknown[]): boolean {
    const message = args.map((arg) => String(arg)).join(" ");
    return message.includes("Ignoring inability to install OPFS sqlite3_vfs") && message.includes("Invalid URL");
}

function isExpectedOpfsCleanupBusyWarning(args: unknown[]): boolean {
    const message = stringifyErrorArgs(args);
    return message.includes("removeVfs() failed with no recovery strategy") && isOpfsBusyMessage(message);
}

function isExpectedUnusedOpfsVfsMessage(message: string): boolean {
    return message.includes("sqlite3_wasm_extra_init");
}

function isOpfsBusyError(error: unknown): boolean {
    return isOpfsBusyMessage(stringifyError(error));
}

function isOpfsBusyMessage(message: string): boolean {
    return message.includes("NoModificationAllowedError")
        || message.includes("Access Handles cannot")
        || message.includes("modifications are not allowed")
        || message.includes("object where modifications are not allowed");
}

function isMissingOpfsApiError(error: unknown): boolean {
    return stringifyError(error).includes("Missing required OPFS APIs");
}

async function cleanupLegacyOpfsDirectory(legacyDirectory?: string, activeDirectory?: string): Promise<void> {
    const legacyPath = normalizeOpfsPath(legacyDirectory);
    const activePath = normalizeOpfsPath(activeDirectory);
    if (!legacyPath || !activePath || legacyPath === activePath || activePath.startsWith(`${legacyPath}/`)) return;

    const storage = (ctx as unknown as SqliteWorkerGlobalScope).navigator?.storage;
    if (typeof storage?.getDirectory !== "function") return;

    try {
        const root = await storage.getDirectory();
        await removeOpfsPath(root, legacyPath);
    } catch {
        // Best effort cleanup only; old storage may still be locked by another window.
    }
}

type OpfsDirectoryHandle = {
    getDirectoryHandle(name: string): Promise<OpfsDirectoryHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
};

function normalizeOpfsPath(path?: string): string | null {
    const normalized = path?.trim().replace(/^\/+|\/+$/g, "");
    return normalized || null;
}

async function removeOpfsPath(root: OpfsDirectoryHandle, path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return;
    let parent = root;
    for (const part of parts.slice(0, -1)) {
        parent = await parent.getDirectoryHandle(part);
    }
    await parent.removeEntry(parts[parts.length - 1], { recursive: true });
}

function stringifyErrorArgs(args: unknown[]): string {
    return args.map((arg) => stringifyError(arg)).join(" ");
}

function stringifyError(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as Error & { cause?: unknown }).cause;
        return [
            error.name,
            error.message,
            cause ? stringifyError(cause) : "",
        ].filter(Boolean).join(" ");
    }
    return String(error);
}

function createSchema(database: SQLiteDatabase): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS vss_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vss_files (
            path TEXT PRIMARY KEY,
            content_hash TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            size INTEGER NOT NULL,
            status TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vss_chunks (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT NOT NULL,
            embedding BLOB NOT NULL,
            content_hash TEXT NOT NULL,
            created INTEGER NOT NULL,
            last_modified INTEGER NOT NULL,
            UNIQUE(path, chunk_index)
        );

        CREATE INDEX IF NOT EXISTS idx_vss_chunks_path ON vss_chunks(path);
        CREATE INDEX IF NOT EXISTS idx_vss_chunks_last_modified ON vss_chunks(last_modified);

        CREATE VIRTUAL TABLE IF NOT EXISTS vss_chunks_fts USING fts5(
            content,
            content='',
            contentless_delete=1,
            tokenize='unicode61 remove_diacritics 2'
        );
    `);
}

function backfillFtsIfNeeded(database: SQLiteDatabase): void {
    const ftsCount = getNumberValueFrom(database, "SELECT COUNT(*) FROM vss_chunks_fts");
    const chunkCount = getNumberValueFrom(database, "SELECT COUNT(*) FROM vss_chunks");
    if (chunkCount === 0 || ftsCount === chunkCount) return;
    // Partial backfill recovery: clear and re-insert atomically
    database.exec("BEGIN");
    try {
        database.exec("DELETE FROM vss_chunks_fts");
        database.exec("INSERT INTO vss_chunks_fts(rowid, content) SELECT id, content FROM vss_chunks");
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function getNumberValueFrom(database: SQLiteDatabase, sql: string): number {
    const rows: unknown[][] = [];
    database.exec({
        sql,
        rowMode: "array",
        resultRows: rows,
    });
    const value = rows[0]?.[0];
    return typeof value === "number" ? value : Number(value ?? 0);
}

function initializeVectorColumn(_profile: EmbeddingProfile): void {
    const rows: unknown[][] = [];
    requireDb().exec({
        sql: "SELECT COUNT(*) FROM pragma_table_info('vss_chunks') WHERE name = 'embedding'",
        rowMode: "array",
        resultRows: rows,
    });
    const count = Number(rows[0]?.[0] ?? 0);
    if (count === 0) {
        throw createWorkerError("schema-invalid", "vss_chunks table is missing the embedding column.");
    }
}

function upsertFile(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
        throw createWorkerError("embedding-count-mismatch", `Chunk count ${chunks.length} does not match embedding count ${embeddings.length}.`);
    }

    const startedAt = performance.now();
    const database = requireDb();
    database.exec("BEGIN");
    try {
        deleteFile(fileState.path);
        const fileStmt = database.prepare(`
            INSERT INTO vss_files(path, content_hash, mtime, size, status, updated_at)
            VALUES (?, ?, ?, ?, 'ready', ?)
        `);
        try {
            fileStmt
                .bind(1, fileState.path)
                .bind(2, fileState.contentHash)
                .bind(3, fileState.mtime)
                .bind(4, fileState.size)
                .bind(5, Date.now())
                .step();
        } finally {
            fileStmt.finalize();
        }

        const chunkStmt = database.prepare(`
            INSERT INTO vss_chunks(path, chunk_index, content, metadata, embedding, content_hash, created, last_modified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        try {
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                chunkStmt
                    .bind(1, chunk.path)
                    .bind(2, chunk.chunkIndex)
                    .bind(3, chunk.content)
                    .bind(4, JSON.stringify(chunk.metadata))
                    .bindAsBlob(5, toFloat32Bytes(embeddings[i]))
                    .bind(6, chunk.contentHash)
                    .bind(7, chunk.created)
                    .bind(8, chunk.lastModified)
                    .step();
                chunkStmt.reset(true);
            }
        } finally {
            chunkStmt.finalize();
        }

        database.exec({
            sql: `INSERT INTO vss_chunks_fts(rowid, content)
                  SELECT id, content FROM vss_chunks WHERE path = ?`,
            bind: [fileState.path],
        });

        database.exec("COMMIT");

        if (vectorCache !== null) {
            const insertedRows: unknown[][] = [];
            database.exec({
                sql: "SELECT id, embedding FROM vss_chunks WHERE path = ?",
                bind: [fileState.path],
                rowMode: "array",
                resultRows: insertedRows,
            });
            for (const row of insertedRows) {
                const id = Number(row[0]);
                const blob = row[1] as Uint8Array;
                vectorCache.set(id, new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
            }
        }

        status = "ready";
        lastRefreshDurationMs = performance.now() - startedAt;
        lastErrorCode = undefined;
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function deleteFile(path: string): void {
    const database = requireDb();

    if (vectorCache !== null) {
        const idsToRemove: unknown[][] = [];
        database.exec({
            sql: "SELECT id FROM vss_chunks WHERE path = ?",
            bind: [path],
            rowMode: "array",
            resultRows: idsToRemove,
        });
        for (const row of idsToRemove) {
            vectorCache.delete(Number(row[0]));
        }
    }

    // FTS delete must precede chunks delete — subquery reads vss_chunks.id
    database.exec({
        sql: "DELETE FROM vss_chunks_fts WHERE rowid IN (SELECT id FROM vss_chunks WHERE path = ?)",
        bind: [path],
    });
    database.exec({
        sql: "DELETE FROM vss_chunks WHERE path = ?",
        bind: [path],
    });
    database.exec({
        sql: "DELETE FROM vss_files WHERE path = ?",
        bind: [path],
    });
}

function updateFileMetadata(fileState: VSSFileState): void {
    const startedAt = performance.now();
    const database = requireDb();
    database.exec("BEGIN");
    try {
        database.exec({
            sql: `
                UPDATE vss_files
                SET content_hash = ?, mtime = ?, size = ?, status = 'ready', updated_at = ?
                WHERE path = ?
            `,
            bind: [fileState.contentHash, fileState.mtime, fileState.size, Date.now(), fileState.path],
        });

        database.exec("COMMIT");
        status = "ready";
        lastRefreshDurationMs = performance.now() - startedAt;
        lastErrorCode = undefined;
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function listFilePaths(): string[] {
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: "SELECT path FROM vss_files ORDER BY path ASC",
        rowMode: "object",
        resultRows: rows,
    });
    return rows.map((row) => primitiveString(row.path));
}

function listFileRecords(): VSSFileRecord[] {
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: `
            SELECT path, content_hash AS contentHash, mtime, size, status, updated_at AS updatedAt
            FROM vss_files
            ORDER BY path ASC
        `,
        rowMode: "object",
        resultRows: rows,
    });
    return rows.map(rowToFileRecord);
}

function search(queryEmbedding: number[], k: number): unknown[] {
    const profile = activeProfile;
    if (!profile) {
        throw createWorkerError("profile-missing", "SQLite vector index has no active embedding profile.");
    }

    const startedAt = performance.now();
    const cache = getOrLoadVectorCache();
    const queryVec = new Float32Array(queryEmbedding);
    const topK = bruteForceTopK(queryVec, cache, k, profile.distanceMetric);

    if (topK.length === 0) {
        lastSearchDurationMs = performance.now() - startedAt;
        return [];
    }

    const ids = topK.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");

    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: `SELECT id, path, chunk_index, content, metadata FROM vss_chunks WHERE id IN (${placeholders})`,
        bind: ids,
        rowMode: "object",
        resultRows: rows,
    });

    const rowById = new Map(rows.map((row) => [Number(row.id), row]));

    lastSearchDurationMs = performance.now() - startedAt;
    return topK.map(({ id, distance }) => {
        const row = rowById.get(id)!;
        const metadata = parseMetadata(row.metadata);
        return {
            score: scoreFromDistance(distance, profile.distanceMetric),
            distance,
            doc: {
                pageContent: primitiveString(row.content),
                metadata: {
                    ...metadata,
                    path: primitiveString(row.path, primitiveString(metadata.path)),
                    chunkIndex: Number(row.chunk_index ?? metadata.chunkIndex ?? 0),
                },
            },
        };
    });
}

function getChunksByPath(paths: string[], limitPerPath = 3): unknown[] {
    const uniquePaths = [...new Set(paths.filter((path) => path.length > 0))];
    if (uniquePaths.length === 0) return [];

    const requestedLimit = Number.isFinite(limitPerPath) ? Math.floor(limitPerPath) : 3;
    const limit = Math.max(1, Math.min(50, requestedLimit));
    const placeholders = uniquePaths.map(() => "?").join(",");
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: `
            SELECT path, chunk_index, content, metadata
            FROM (
                SELECT path, chunk_index, content, metadata,
                    ROW_NUMBER() OVER (PARTITION BY path ORDER BY chunk_index ASC) AS path_rank
                FROM vss_chunks
                WHERE path IN (${placeholders})
            )
            WHERE path_rank <= ?
            ORDER BY path, chunk_index
        `,
        bind: [...uniquePaths, limit],
        rowMode: "object",
        resultRows: rows,
    });

    return rows.map((row) => {
        const metadata = parseMetadata(row.metadata);
        return {
            score: 1,
            doc: {
                pageContent: primitiveString(row.content),
                metadata: {
                    ...metadata,
                    path: primitiveString(row.path, primitiveString(metadata.path)),
                    chunkIndex: Number(row.chunk_index ?? metadata.chunkIndex ?? 0),
                },
            },
        };
    });
}

function searchHybrid(
    queryEmbedding: number[],
    ftsQuery: string | null,
    k: number,
    fusionTopK: number,
    temporalFilter?: { since?: number; until?: number },
): unknown[] {
    const profile = activeProfile;
    if (!profile) {
        throw createWorkerError("profile-missing", "SQLite vector index has no active embedding profile.");
    }

    const startedAt = performance.now();
    const database = requireDb();

    // Vector leg — brute-force
    const cache = getVectorCacheForTemporalFilter(temporalFilter);
    const queryVec = new Float32Array(queryEmbedding);
    const topK = bruteForceTopK(queryVec, cache, k, profile.distanceMetric);

    const requestedVectorIds = topK.map((r) => r.id);
    const vectorPlaceholders = requestedVectorIds.map(() => "?").join(",");
    const vectorRows: Array<Record<string, unknown>> = [];
    if (requestedVectorIds.length > 0) {
        const temporalClause = buildTemporalWhereClause("last_modified", temporalFilter);
        database.exec({
            sql: `SELECT id, path, chunk_index, content, metadata FROM vss_chunks WHERE id IN (${vectorPlaceholders})${temporalClause.sql}`,
            bind: [...requestedVectorIds, ...temporalClause.bind],
            rowMode: "object",
            resultRows: vectorRows,
        });
    }

    // FTS leg (skip when no valid query or total deadline exceeded)
    const SEARCH_DEADLINE_MS = 500;
    const ftsRows: Array<Record<string, unknown>> = [];
    if (ftsQuery && performance.now() - startedAt < SEARCH_DEADLINE_MS) {
        const ftsTemporalClause = buildTemporalWhereClause("c.last_modified", temporalFilter);
        try {
            database.exec({
                sql: `
                    SELECT c.id, c.path, c.chunk_index, c.content, c.metadata
                    FROM vss_chunks_fts
                    JOIN vss_chunks AS c ON c.id = vss_chunks_fts.rowid
                    WHERE vss_chunks_fts MATCH ?
                    ${ftsTemporalClause.sql}
                    ORDER BY rank
                    LIMIT ?
                `,
                bind: [ftsQuery, ...ftsTemporalClause.bind, k],
                rowMode: "object",
                resultRows: ftsRows,
            });
        } catch (error) {
            if (!(error instanceof Error) || !error.message.includes("fts5")) {
                console.warn("[vss-worker] FTS search error:", error);
            }
        }
    }

    // RRF fusion
    const rowById = new Map<number, Record<string, unknown>>();
    for (const row of vectorRows) {
        rowById.set(Number(row.id), row);
    }
    const vectorIds = requestedVectorIds.filter((id) => rowById.has(id));
    const ftsIds = ftsRows.map((row) => {
        const id = Number(row.id);
        if (!rowById.has(id)) rowById.set(id, row);
        return id;
    });

    const fusedScores = fuseRRF([vectorIds, ftsIds], fusionTopK);

    lastSearchDurationMs = performance.now() - startedAt;
    return [...fusedScores.entries()].flatMap(([id, score]) => {
        const row = rowById.get(id);
        if (!row) return [];
        const metadata = parseMetadata(row.metadata);
        return [{
            score,
            doc: {
                pageContent: primitiveString(row.content),
                metadata: {
                    ...metadata,
                    path: primitiveString(row.path, primitiveString(metadata.path)),
                    chunkIndex: Number(row.chunk_index ?? metadata.chunkIndex ?? 0),
                },
            },
        }];
    });
}

function getVectorCacheForTemporalFilter(
    temporalFilter?: { since?: number; until?: number },
): Map<number, Float32Array> {
    const cache = getOrLoadVectorCache();
    const temporalClause = buildTemporalWhereClause("last_modified", temporalFilter);
    if (!temporalClause.sql) return cache;

    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: `SELECT id FROM vss_chunks WHERE 1=1${temporalClause.sql}`,
        bind: temporalClause.bind,
        rowMode: "object",
        resultRows: rows,
    });
    const eligibleIds = new Set(rows.map((row) => Number(row.id)));
    const filtered = new Map<number, Float32Array>();
    for (const [id, vector] of cache) {
        if (eligibleIds.has(id)) filtered.set(id, vector);
    }
    return filtered;
}

function buildTemporalWhereClause(
    column: string,
    temporalFilter?: { since?: number; until?: number },
): { sql: string; bind: number[] } {
    if (!temporalFilter) return { sql: "", bind: [] };
    const clauses: string[] = [];
    const bind: number[] = [];
    if (typeof temporalFilter.since === "number" && Number.isFinite(temporalFilter.since)) {
        clauses.push(`${column} >= ?`);
        bind.push(temporalFilter.since);
    }
    if (typeof temporalFilter.until === "number" && Number.isFinite(temporalFilter.until)) {
        clauses.push(`${column} <= ?`);
        bind.push(temporalFilter.until);
    }
    return clauses.length > 0 ? { sql: ` AND ${clauses.join(" AND ")}`, bind } : { sql: "", bind: [] };
}

function getFileRecord(path: string): VSSFileRecord | null {
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: `
            SELECT path, content_hash AS contentHash, mtime, size, status, updated_at AS updatedAt
            FROM vss_files
            WHERE path = ?
            LIMIT 1
        `,
        bind: [path],
        rowMode: "object",
        resultRows: rows,
    });
    const row = rows[0];
    if (!row) return null;
    return rowToFileRecord(row);
}

function rowToFileRecord(row: Record<string, unknown>): VSSFileRecord {
    return {
        path: primitiveString(row.path),
        contentHash: primitiveString(row.contentHash),
        mtime: Number(row.mtime),
        size: Number(row.size),
        status: primitiveString(row.status),
        updatedAt: Number(row.updatedAt),
    };
}

function verify(): VSSIndexStats["status"] {
    const database = requireDb();
    const profile = activeProfile;
    if (!profile) return "uninitialized";

    const rows: Array<Record<string, unknown>> = [];
    database.exec({
        sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vss_meta'",
        rowMode: "object",
        resultRows: rows,
    });
    if (rows.length === 0) {
        status = "missing-local-index";
        return status;
    }

    const storedSignature = getMeta("profileSignature");
    if (!storedSignature) {
        status = "missing-local-index";
        return status;
    }
    if (storedSignature !== getEmbeddingProfileSignature(profile)) {
        status = "stale";
        return status;
    }

    try {
        database.exec("INSERT INTO vss_chunks_fts(vss_chunks_fts) VALUES('integrity-check')");
    } catch (ftsError) {
        console.warn("FTS5 integrity-check failed (non-blocking):", ftsError);
    }

    status = "ready";
    return status;
}

function getStats(): VSSIndexStats {
    const pageSize = getNumberValue("PRAGMA page_size");
    const pageCount = getNumberValue("PRAGMA page_count");
    return {
        status,
        backend: "sqlite-wasm-opfs-sahpool",
        initDurationMs,
        lastRefreshDurationMs,
        lastSearchDurationMs,
        chunkCount: getNumberValue("SELECT COUNT(*) FROM vss_chunks"),
        fileCount: getNumberValue("SELECT COUNT(*) FROM vss_files"),
        estimatedDbBytes: pageSize * pageCount,
        fallbackMode: false,
        lastErrorCode,
        lastVerifiedAt: new Date().toISOString(),
    };
}

function reset(): void {
    vectorCache = null;
    const database = requireDb();
    database.exec(`
        DROP TABLE IF EXISTS vss_chunks_fts;
        DROP TABLE IF EXISTS vss_chunks;
        DROP TABLE IF EXISTS vss_files;
        DROP TABLE IF EXISTS vss_meta;
    `);
    createSchema(database);
    if (activeProfile) {
        setMeta("schemaVersion", String(VSS_SCHEMA_VERSION));
        setMeta("profileSignature", getEmbeddingProfileSignature(activeProfile));
        setMeta("backend", "sqlite-wasm-opfs-sahpool");
        initializeVectorColumn(activeProfile);
        status = "ready";
    } else {
        status = "uninitialized";
    }
}

function dispose(): void {
    vectorCache = null;
    const database = db;
    const pool = activePool;
    db = null;
    activePool = null;
    try {
        database?.close();
    } finally {
        pausePool(pool);
    }
}

function pausePool(pool: OpfsSahPool | null): void {
    if (!pool?.pauseVfs || isPoolPaused(pool)) return;
    try {
        pool.pauseVfs();
    } catch (error) {
        console.warn("Failed to pause OPFS SAH pool during Memory shutdown:", error);
    }
}

function isPoolPaused(pool: OpfsSahPool): boolean {
    const maybePool = pool as OpfsSahPool & { isPaused?: () => boolean };
    if (!maybePool.isPaused) return false;
    try {
        return maybePool.isPaused();
    } catch {
        return false;
    }
}

function clusterVectorsInWorker(maxClusters: number): Array<{ clusterId: number; label: string; paths: string[] }> {
    const cache = getOrLoadVectorCache();
    if (cache.size < 2) return [];

    const idToPath = new Map<number, string>();
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: "SELECT id, path FROM vss_chunks",
        rowMode: "object",
        resultRows: rows,
    });
    for (const row of rows) {
        idToPath.set(Number(row.id), primitiveString(row.path));
    }

    const ids = [...cache.keys()].filter((id) => cache.has(id) && idToPath.has(id));
    if (ids.length < 2) return [];
    if (ids.length > 15000) return [];

    const firstVec = cache.get(ids[0]);
    if (!firstVec) return [];
    const dims = firstVec.length;
    const k = Math.min(maxClusters, Math.max(2, Math.floor(Math.sqrt(ids.length / 5))));

    const assignments = new Int32Array(ids.length);
    const centroids: Float32Array[] = [];
    for (let i = 0; i < k; i++) {
        const src = cache.get(ids[i % ids.length]);
        centroids.push(src ? new Float32Array(src) : new Float32Array(dims));
    }

    const sums: Float32Array[] = [];
    for (let i = 0; i < k; i++) sums.push(new Float32Array(dims));
    const counts = new Int32Array(k);

    for (let iter = 0; iter < 15; iter++) {
        for (let i = 0; i < ids.length; i++) {
            const vec = cache.get(ids[i]);
            if (!vec) continue;
            let bestDist = Infinity;
            let bestC = 0;
            for (let c = 0; c < k; c++) {
                let dist = 0;
                for (let d = 0; d < dims; d++) {
                    const diff = vec[d] - centroids[c][d];
                    dist += diff * diff;
                }
                if (dist < bestDist) { bestDist = dist; bestC = c; }
            }
            assignments[i] = bestC;
        }
        counts.fill(0);
        for (const s of sums) s.fill(0);
        for (let i = 0; i < ids.length; i++) {
            const c = assignments[i];
            const vec = cache.get(ids[i]);
            if (!vec) continue;
            counts[c]++;
            const sum = sums[c];
            for (let d = 0; d < dims; d++) sum[d] += vec[d];
        }
        for (let c = 0; c < k; c++) {
            if (counts[c] === 0) continue;
            for (let d = 0; d < dims; d++) centroids[c][d] = sums[c][d] / counts[c];
        }
    }

    const clusterPaths = new Map<number, Set<string>>();
    const folderCounts = new Map<number, Map<string, number>>();
    for (let i = 0; i < ids.length; i++) {
        const c = assignments[i];
        const path = idToPath.get(ids[i]);
        if (!path) continue;
        if (!clusterPaths.has(c)) clusterPaths.set(c, new Set());
        clusterPaths.get(c)!.add(path);
        const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
        if (!folderCounts.has(c)) folderCounts.set(c, new Map());
        const fc = folderCounts.get(c)!;
        fc.set(folder, (fc.get(folder) ?? 0) + 1);
    }

    const result: Array<{ clusterId: number; label: string; paths: string[] }> = [];
    for (const [clusterId, paths] of clusterPaths) {
        if (paths.size === 0) continue;
        const fc = folderCounts.get(clusterId);
        let label = `Cluster ${clusterId}`;
        if (fc && fc.size > 0) {
            let maxCount = 0;
            for (const [folder, count] of fc) {
                if (count > maxCount) { maxCount = count; label = folder; }
            }
        }
        result.push({ clusterId, label, paths: [...paths].slice(0, 12) });
    }

    return result.sort((a, b) => b.paths.length - a.paths.length);
}

function getOrLoadVectorCache(): Map<number, Float32Array> {
    if (vectorCache !== null) return vectorCache;
    const cache = new Map<number, Float32Array>();
    const rows: unknown[][] = [];
    requireDb().exec({
        sql: "SELECT id, embedding FROM vss_chunks",
        rowMode: "array",
        resultRows: rows,
    });
    for (const row of rows) {
        const id = Number(row[0]);
        const blob = row[1] as Uint8Array;
        cache.set(id, new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
    }
    vectorCache = cache;
    return cache;
}

function requireDb(): SQLiteDatabase {
    if (!db) {
        throw createWorkerError("sqlite-db-unavailable", "SQLite database is not initialized.");
    }
    return db;
}

function getMeta(key: string): string | null {
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: "SELECT value FROM vss_meta WHERE key = ? LIMIT 1",
        bind: [key],
        rowMode: "object",
        resultRows: rows,
    });
    return rows.length > 0 ? primitiveString(rows[0].value) : null;
}

function setMeta(key: string, value: string): void {
    requireDb().exec({
        sql: "INSERT OR REPLACE INTO vss_meta(key, value) VALUES (?, ?)",
        bind: [key, value],
    });
}

function getNumberValue(sql: string): number {
    const rows: unknown[][] = [];
    requireDb().exec({
        sql,
        rowMode: "array",
        resultRows: rows,
    });
    const value = rows[0]?.[0];
    return typeof value === "number" ? value : Number(value ?? 0);
}

function toFloat32Bytes(vector: number[]): Uint8Array {
    const array = new Float32Array(vector);
    return new Uint8Array(array.buffer);
}

function parseMetadata(value: unknown): Record<string, unknown> {
    if (typeof value !== "string") return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

function createWorkerError(code: string, message: string): Error {
    const error = new Error(message);
    (error as Error & { code: string }).code = code;
    return error;
}

function getErrorCode(error: unknown): string {
    if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
        return (error as { code: string }).code;
    }
    return "sqlite-worker-error";
}

function primitiveString(value: unknown, fallback = ""): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return value.toString();
    }
    return fallback;
}

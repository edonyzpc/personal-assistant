/// <reference lib="webworker" />

import sqlite3InitModule from "@sqliteai/sqlite-wasm";
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
import type { SqliteWorkerRequest, SqliteWorkerResponse } from "./sqlite-worker-protocol";

type SQLiteDatabase = any; // sqlite-wasm's OO API is runtime-shaped and broad.
type SQLiteModule = any;
type SqliteApiConfig = {
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    log?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
};

let sqlite3: SQLiteModule | null = null;
let db: SQLiteDatabase | null = null;
let activeProfile: EmbeddingProfile | null = null;
let status: VSSIndexStats["status"] = "uninitialized";
let initDurationMs: number | undefined;
let lastRefreshDurationMs: number | undefined;
let lastSearchDurationMs: number | undefined;
let lastErrorCode: string | undefined;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<SqliteWorkerRequest>) => {
    const request = event.data;
    void handleRequest(request)
        .then((result) => {
            ctx.postMessage({ id: request.id, ok: true, result } as SqliteWorkerResponse);
        })
        .catch((error) => {
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
        });
};

async function handleRequest(request: SqliteWorkerRequest): Promise<unknown> {
    switch (request.type) {
        case "initialize":
            return await initialize(request.payload.profile, request.payload.databaseName, request.payload.wasmUrl);
        case "upsertFile":
            requireDb();
            upsertFile(request.payload.fileState, request.payload.chunks, request.payload.embeddings);
            return null;
        case "deleteFile":
            requireDb();
            deleteFile(request.payload.path);
            return null;
        case "listFilePaths":
            requireDb();
            return listFilePaths();
        case "search":
            requireDb();
            return search(request.payload.queryEmbedding, request.payload.k);
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
        case "dispose":
            dispose();
            return null;
    }
}

async function initialize(profile: EmbeddingProfile, databaseName: string, wasmUrl?: string): Promise<VSSIndexStats["status"]> {
    const startedAt = performance.now();
    activeProfile = profile;
    status = "initializing";

    try {
        configureSqliteLogging();
        sqlite3 ??= await sqlite3InitModule({
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

        if (!db) {
            db = await openOpfsDatabase(sqlite3, databaseName);
        }

        createSchema(db);
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
        status = "error";
        lastErrorCode = getErrorCode(error);
        throw error;
    }
}

async function openOpfsDatabase(module: SQLiteModule, databaseName: string): Promise<SQLiteDatabase> {
    if (!module.installOpfsSAHPoolVfs) {
        throw createWorkerError("opfs-sahpool-unavailable", "sqlite-wasm does not expose opfs-sahpool.");
    }

    const pool = await module.installOpfsSAHPoolVfs({
        name: "opfs-sahpool",
        directory: "/personal-assistant-vss",
        initialCapacity: 8,
        verbosity: 0,
    });
    const DbCtor = pool.OpfsSAHPoolDb;
    if (!DbCtor) {
        throw createWorkerError("opfs-sahpool-unavailable", "opfs-sahpool database constructor is unavailable.");
    }
    return new DbCtor(databaseName, "c");
}

function configureSqliteLogging(): void {
    const globalScope = globalThis as typeof globalThis & { sqlite3ApiConfig?: SqliteApiConfig };
    globalScope.sqlite3ApiConfig = {
        ...(globalScope.sqlite3ApiConfig ?? {}),
        warn: (...args: unknown[]) => {
            if (!isExpectedUnusedOpfsVfsWarning(args)) {
                console.warn(...args);
            }
        },
        error: (...args: unknown[]) => {
            if (!isExpectedUnusedOpfsVfsWarning(args)) {
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

function isExpectedUnusedOpfsVfsMessage(message: string): boolean {
    return message.includes("sqlite3_wasm_extra_init");
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
    `);
}

function initializeVectorColumn(profile: EmbeddingProfile): void {
    requireDb().exec(
        `SELECT vector_init('vss_chunks', 'embedding', 'type=FLOAT32,dimension=${profile.dimensions},distance=${profile.distanceMetric}')`,
    );
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
            VALUES (?, ?, ?, ?, vector_as_f32(?), ?, ?, ?)
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

        database.exec("COMMIT");
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
    database.exec({
        sql: "DELETE FROM vss_chunks WHERE path = ?",
        bind: [path],
    });
    database.exec({
        sql: "DELETE FROM vss_files WHERE path = ?",
        bind: [path],
    });
}

function listFilePaths(): string[] {
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: "SELECT path FROM vss_files ORDER BY path ASC",
        rowMode: "object",
        resultRows: rows,
    });
    return rows.map((row) => String(row.path));
}

function search(queryEmbedding: number[], k: number): unknown[] {
    const profile = activeProfile;
    if (!profile) {
        throw createWorkerError("profile-missing", "SQLite vector index has no active embedding profile.");
    }
    initializeVectorColumn(profile);
    const startedAt = performance.now();
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: `
            SELECT c.path, c.chunk_index, c.content, c.metadata, v.distance
            FROM vector_full_scan('vss_chunks', 'embedding', vector_as_f32(?), ?) AS v
            JOIN vss_chunks AS c ON c.id = v.rowid
            ORDER BY v.distance ASC, c.path ASC, c.chunk_index ASC
            LIMIT ?
        `,
        bind: [JSON.stringify(queryEmbedding), k, k],
        rowMode: "object",
        resultRows: rows,
    });
    lastSearchDurationMs = performance.now() - startedAt;
    return rows.map((row) => {
        const metadata = parseMetadata(row.metadata);
        const distance = typeof row.distance === "number" ? row.distance : Number(row.distance ?? 0);
        return {
            score: scoreFromDistance(distance, profile.distanceMetric),
            distance,
            doc: {
                pageContent: String(row.content ?? ""),
                metadata: {
                    ...metadata,
                    path: String(row.path ?? metadata.path ?? ""),
                    chunkIndex: Number(row.chunk_index ?? metadata.chunkIndex ?? 0),
                },
            },
        };
    });
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
    return {
        path: String(row.path),
        contentHash: String(row.contentHash),
        mtime: Number(row.mtime),
        size: Number(row.size),
        status: String(row.status),
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
    const database = requireDb();
    database.exec(`
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
    if (db) {
        db.close();
        db = null;
    }
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
    return rows.length > 0 ? String(rows[0].value) : null;
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

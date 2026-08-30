/// <reference lib="webworker" />

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
    getEmbeddingProfileSignature,
    scoreFromDistance,
    VSS_SCHEMA_VERSION,
    type EmbeddingProfile,
    type LexicalIncrementalMaintenanceReceipt,
    type LexicalMaintenanceResourceEnvelope,
    type LexicalMaintenanceReceiptSnapshot,
    type LexicalRebuildFinalizeReceiptResult,
    type LexicalRebuildMaintenanceReceipt,
    type LexicalIndexStatus,
    type LexicalSearchBudget,
    type LexicalProfileMarker,
    type LexicalProfileState,
    type LexicalRebuildBatchResult,
    type LexicalRebuildScopeBatchResult,
    type LexicalRebuildStartResult,
    type IndexedPathEvidenceGeneration,
    type IndexedPathEvidenceGenerationResult,
    type PathEvidenceGenerationRef,
    type RankedPathChunk,
    type RankedPathRequestControl,
    type RankedPathRequestResult,
    type VectorHybridSearchResult,
    type VectorIndexDeleteOptions,
    type VSSChunk,
    type VSSFileRecord,
    type VSSFileState,
    type VSSIndexStats,
} from "./types";
import { fuseRRF } from "./rrf";
import { bruteForceTopK, cosineDistance } from "./brute-force-search";
import type {
    SqliteWorkerMessage,
    SqliteWorkerRequest,
    SqliteWorkerResponse,
} from "./sqlite-worker-protocol";
import {
    CHAR_PHRASE_PROFILE_ID,
    CHAR_PHRASE_TOKENIZER,
    buildCharPhraseFields,
    getCharPhraseRuntimeCanaryFingerprint,
    hasCharPhraseRuntimeSupport,
    transformCharPhraseDocument,
} from "./lexical-normalizer";
import { computePathEvidenceGeneration } from "./path-evidence-generation";
import {
    RETRIEVAL_CALIBRATION_PROFILE,
    isValidRetrievalSearchRuntimeParameters,
    type RetrievalSearchRuntimeParameters,
} from "./retrieval-calibration";

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
    pointer?: number;
    exec(input: string | SQLiteExecOptions): unknown;
    prepare(sql: string): SQLiteStatement;
    close(): void;
};
type SQLiteModule = {
    installOpfsSAHPoolVfs?: (options: Record<string, unknown>) => Promise<SQLiteOpfsPool>;
    capi?: {
        sqlite3_progress_handler(
            database: SQLiteDatabase,
            operationInterval: number,
            callback: (() => number) | number,
            callbackArgument: number,
        ): void;
    };
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
    disable?: {
        vfs?: Record<string, boolean>;
        [key: string]: unknown;
    };
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
let lexicalProfileState: LexicalProfileState = "unavailable";
let lexicalProfileMarker: LexicalProfileMarker | null = null;
let lexicalFailureReason: string | undefined;
let lexicalRebuildSequence = 0;
let lexicalProfileEnabled = false;
let activeLexicalBoundaryFingerprint: string | undefined;
const pendingGraphRequests = new Set<string>();
const cancelledGraphRequests = new Set<string>();

const GRAPH_RANK_HARD_MAX_PATHS = RETRIEVAL_CALIBRATION_PROFILE.graph.maxCandidatePaths;
const GRAPH_RANK_HARD_MAX_PATHS_PER_BATCH = RETRIEVAL_CALIBRATION_PROFILE.graph.maxPathsPerBatch;
const GRAPH_RANK_COSINE_BLOCK_SIZE = RETRIEVAL_CALIBRATION_PROFILE.graph.cosineBlockSize;
const PATH_EVIDENCE_HARD_MAX_PATHS = RETRIEVAL_CALIBRATION_PROFILE.graph.maxCandidatePaths;
const PATH_EVIDENCE_HARD_MAX_CHUNKS = RETRIEVAL_CALIBRATION_PROFILE.graph.maxChunksScanned;
const PATH_EVIDENCE_HARD_MAX_BYTES = RETRIEVAL_CALIBRATION_PROFILE.graph.maxProjectedBytes;

interface StoredPathEvidenceFileRow {
    path: string;
    generation: string;
    contentHash: string;
    mtime: number;
    size: number;
}

interface PathEvidenceRepairHooks {
    checkpoint?: () => void;
    onBatchComplete?: (durationMs: number) => void;
}

interface LexicalRebuildContext {
    rebuildId: string;
    generation: number;
    sourceChunkEpoch: string;
    runtimeCanaryFingerprint: string;
    totalRows: number;
    processedRows: number;
    eligibleRows: number;
    nextRowId: number;
    previousState: LexicalProfileState;
    allowedPaths: Set<string>;
    scopeFingerprint: string;
    expectedPathCount: number;
    scopeSealed: boolean;
    invalidatedReason?: string;
    expectedFieldRows: Record<"title" | "heading" | "body" | "path", number>;
    receipt?: {
        operationId: string;
        startedAt: string;
        startedAtMonotonic: number;
        before: LexicalMaintenanceReceiptSnapshot;
        resourceTracker: LexicalMaintenanceResourceTracker;
    };
}

type LexicalMaintenanceResourceTracker = Pick<
    LexicalMaintenanceResourceEnvelope,
    "estimatedDbBytesBefore" | "estimatedDbBytesPeak"
>;

let lexicalRebuildContext: LexicalRebuildContext | null = null;

const LEXICAL_TABLES = ["vss_chunks_lexical_0", "vss_chunks_lexical_1"] as const;
const LEXICAL_SCOPE_TABLE = "vss_lexical_rebuild_scope";
const LEXICAL_META_PROFILE_ID = "lexicalProfileId";
const LEXICAL_META_GENERATION = "lexicalGeneration";
const LEXICAL_META_SOURCE_EPOCH = "lexicalSourceChunkEpoch";
const LEXICAL_META_RUNTIME_FINGERPRINT = "lexicalRuntimeFingerprint";
const LEXICAL_META_SCOPE_FINGERPRINT = "lexicalScopeFingerprint";
const LEXICAL_META_ELIGIBLE_ROW_COUNT = "lexicalEligibleRowCount";
const LEXICAL_META_CHUNK_EPOCH = "chunkMutationEpoch";
const INDEX_META_DATABASE_INSTANCE_ID = "databaseInstanceId";
const INDEX_META_MUTATION_EPOCH = "indexMutationEpoch";
const INDEX_META_REBUILD_EPOCH = "rebuildEpoch";
const INDEX_META_LEXICAL_MAINTENANCE_EPOCH = "lexicalMaintenanceEpoch";
const INDEX_META_LEXICAL_INCREMENTAL_MAINTENANCE_EPOCH = "lexicalIncrementalMaintenanceEpoch";
const INDEX_META_LAST_LEXICAL_MAINTENANCE_KIND = "lastLexicalMaintenanceKind";
const INDEX_META_LAST_LEXICAL_MAINTENANCE_OPERATION_ID = "lastLexicalMaintenanceOperationId";
const LEXICAL_META_REBUILD_ID = "lexicalRebuildId";
const LEXICAL_META_REBUILD_GENERATION = "lexicalRebuildGeneration";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<SqliteWorkerMessage>) => {
    const request = event.data;
    if (request.type === "cancelGraphRank") {
        const key = graphRequestKey(request.payload.requestId, request.payload.runEpoch);
        if (pendingGraphRequests.has(key)) cancelledGraphRequests.add(key);
        return;
    }
    if (request.type === "rankGraphCandidates") {
        const key = graphRequestKey(request.payload.control.requestId, request.payload.control.runEpoch);
        if (pendingGraphRequests.has(key)) {
            ctx.postMessage({
                id: request.id,
                ok: false,
                error: {
                    code: "graph-rank-request-duplicate",
                    message: "Graph candidate ranking request id is already active.",
                },
            } as SqliteWorkerResponse);
            return;
        }
        pendingGraphRequests.add(key);
    }
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
    } finally {
        if (request.type === "rankGraphCandidates") {
            const key = graphRequestKey(request.payload.control.requestId, request.payload.control.runEpoch);
            pendingGraphRequests.delete(key);
            cancelledGraphRequests.delete(key);
        }
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
            }, request.payload.lexicalProfileEnabled === true, request.payload.lexicalBoundaryFingerprint);
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
            deleteFile(request.payload.path, request.payload.options);
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
                request.payload.lexicalSkipReason,
                request.payload.lexicalBoundaryFingerprint,
                request.payload.lexicalBudget,
                request.payload.excludedPathGenerations,
                request.payload.retrieval,
            );
        case "getPathEvidenceGenerations":
            requireDb();
            return await getPathEvidenceGenerations(
                request.payload.paths,
                request.payload.maxPathsPerBatch,
                request.payload.maxChunksScanned,
            );
        case "rankGraphCandidates":
            requireDb();
            return await rankGraphCandidates(
                request.payload.queryEmbedding,
                request.payload.paths,
                request.payload.control,
            );
        case "getFileRecord":
            requireDb();
            return getFileRecord(request.payload.path);
        case "getLexicalStatus":
            requireDb();
            return getLexicalStatus();
        case "refreshLexicalPathFromIndexedChunks":
            requireDb();
            return refreshLexicalPathFromIndexedChunks(
                request.payload.path,
                request.payload.lexicalBoundaryFingerprint,
            );
        case "beginLexicalRebuild":
            requireDb();
            return beginLexicalRebuild(
                request.payload.profileId,
                request.payload.runtimeCanaryFingerprint,
                request.payload.scopeFingerprint,
                request.payload.expectedPathCount,
            );
        case "beginLexicalRebuildWithReceipt":
            requireDb();
            return beginLexicalRebuild(
                request.payload.profileId,
                request.payload.runtimeCanaryFingerprint,
                request.payload.scopeFingerprint,
                request.payload.expectedPathCount,
                true,
            );
        case "appendLexicalScopeBatch":
            requireDb();
            return appendLexicalScopeBatch(request.payload.rebuildId, request.payload.paths);
        case "appendLexicalRebuildBatch":
            requireDb();
            return appendLexicalRebuildBatch(
                request.payload.rebuildId,
                request.payload.afterRowId,
                request.payload.limit,
            );
        case "finalizeLexicalRebuild":
            requireDb();
            return finalizeLexicalRebuild(request.payload.rebuildId);
        case "finalizeLexicalRebuildWithReceipt":
            requireDb();
            return await finalizeLexicalRebuildWithReceipt(request.payload.rebuildId);
        case "abortLexicalRebuild":
            requireDb();
            return abortLexicalRebuild(request.payload.rebuildId, request.payload.failureReason);
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
    enableLexicalProfile = false,
    lexicalBoundaryFingerprint?: string,
): Promise<VSSIndexStats["status"]> {
    const startedAt = performance.now();
    assertWorkerActive();
    activeProfile = profile;
    lexicalProfileEnabled = enableLexicalProfile;
    activeLexicalBoundaryFingerprint = lexicalBoundaryFingerprint;
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
        initializeContinuityMetadata();
        // Lexical crash recovery is independent of the embedding profile. Run it
        // before an embedding-signature early return so stale vector settings do
        // not strand a partial shadow generation.
        try {
            initializeLexicalState(db);
        } catch (error) {
            // Lexical tables are device-local derived data. Their recovery must
            // never dispose a healthy vector database or block direct Memory.
            lexicalRebuildContext = null;
            lexicalProfileMarker = null;
            lexicalProfileState = "failed";
            lexicalFailureReason = getErrorCode(error) ?? "lexical_initialization_failed";
            console.warn("[vss-worker] Lexical Memory initialization failed; vector search remains available", {
                errorType: error instanceof Error ? error.name : "unknown",
                code: lexicalFailureReason,
            });
        }
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
    const existingConfig = globalScope.sqlite3ApiConfig ?? {};
    const existingDisable = existingConfig.disable ?? {};
    globalScope.sqlite3ApiConfig = {
        ...existingConfig,
        disable: {
            ...existingDisable,
            vfs: {
                ...(existingDisable.vfs ?? {}),
                // The plugin uses sqlite-wasm's OPFS SAH pool VFS explicitly via
                // installOpfsSAHPoolVfs(). The auto-installed async OPFS VFSes
                // require an external proxy worker script, which is unavailable
                // in our inlined Obsidian bundle and only creates console noise.
                // Do not disable "opfs-vfs" here: sqlite3.opfs utility setup is
                // still shared by opfs-sahpool in the upstream bootstrap.
                opfs: true,
                "opfs-wl": true,
            },
        },
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
    return message.includes("Invalid URL")
        && message.includes("Ignoring inability to install")
        && message.includes("sqlite3_vfs")
        && (
            message.includes("'opfs'")
            || message.includes("opfs-wl")
            || message.includes("OPFS sqlite3_vfs")
        );
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
            updated_at INTEGER NOT NULL,
            evidence_generation TEXT NOT NULL DEFAULT ''
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

        CREATE TEMP TABLE IF NOT EXISTS ${LEXICAL_SCOPE_TABLE} (
            path TEXT PRIMARY KEY
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS vss_chunks_fts USING fts5(
            content,
            content='',
            contentless_delete=1,
            tokenize='unicode61 remove_diacritics 2'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS vss_chunks_lexical_0 USING fts5(
            title,
            heading,
            body,
            path,
            content='',
            contentless_delete=1,
            tokenize='${CHAR_PHRASE_TOKENIZER}'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS vss_chunks_lexical_1 USING fts5(
            title,
            heading,
            body,
            path,
            content='',
            contentless_delete=1,
            tokenize='${CHAR_PHRASE_TOKENIZER}'
        );
    `);
    ensurePathEvidenceGenerationColumn(database);
}

function ensurePathEvidenceGenerationColumn(database: SQLiteDatabase): void {
    const rows: unknown[][] = [];
    database.exec({
        sql: "SELECT COUNT(*) FROM pragma_table_info('vss_files') WHERE name = 'evidence_generation'",
        rowMode: "array",
        resultRows: rows,
    });
    if (Number(rows[0]?.[0] ?? 0) > 0) return;
    // Existing rows stay unknown until their next coherent upsert. Unknown is
    // intentionally never treated as an exact-repeat proof.
    database.exec("ALTER TABLE vss_files ADD COLUMN evidence_generation TEXT NOT NULL DEFAULT ''");
}

function initializeLexicalState(
    database: SQLiteDatabase,
    transactionAlreadyOpen = false,
): void {
    lexicalRebuildContext = null;
    lexicalProfileMarker = null;
    lexicalFailureReason = undefined;

    // Recovery is unconditional: an interrupted shadow must not survive merely
    // because a rollout flag is off or this runtime cannot segment CJK.
    cleanupInterruptedLexicalRebuild(database);

    if (!lexicalProfileEnabled) {
        lexicalProfileState = "unavailable";
        lexicalFailureReason = "feature_disabled";
        return;
    }

    if (!hasCharPhraseRuntimeSupport()) {
        lexicalProfileState = "unavailable";
        lexicalFailureReason = "segmenter_unavailable";
        return;
    }

    const runtimeCanaryFingerprint = getCharPhraseRuntimeCanaryFingerprint();
    const expectedCanary = "c53ec c56de 。";
    if (transformCharPhraseDocument("召回。") !== expectedCanary) {
        lexicalProfileState = "unavailable";
        lexicalFailureReason = "runtime_canary_failed";
        return;
    }

    const chunkCount = getNumberValueFrom(database, "SELECT COUNT(*) FROM vss_chunks");
    const profileId = getMeta(LEXICAL_META_PROFILE_ID);
    const generation = parseLexicalGeneration(getMeta(LEXICAL_META_GENERATION));
    const sourceChunkEpoch = getMeta(LEXICAL_META_SOURCE_EPOCH);
    const storedRuntimeFingerprint = getMeta(LEXICAL_META_RUNTIME_FINGERPRINT);
    const scopeFingerprint = getMeta(LEXICAL_META_SCOPE_FINGERPRINT) ?? undefined;
    const storedEligibleRowsRaw = getMeta(LEXICAL_META_ELIGIBLE_ROW_COUNT);
    const storedEligibleRows = storedEligibleRowsRaw === null ? Number.NaN : Number(storedEligibleRowsRaw);
    const currentChunkEpoch = getChunkMutationEpoch();

    if (!profileId || generation === null || sourceChunkEpoch === null || !storedRuntimeFingerprint) {
        if (chunkCount === 0) {
            if (!transactionAlreadyOpen) database.exec("BEGIN");
            try {
                clearLexicalTable(database, 0);
                const marker: LexicalProfileMarker = {
                    profileId: CHAR_PHRASE_PROFILE_ID,
                    generation: 0,
                    sourceChunkEpoch: String(currentChunkEpoch),
                    runtimeCanaryFingerprint,
                    scopeFingerprint: activeLexicalBoundaryFingerprint ?? "boundary_unknown",
                    eligibleRowCount: 0,
                };
                writeLexicalMarker(marker);
                advanceLexicalMaintenanceEpoch("initialize-empty");
                if (!transactionAlreadyOpen) database.exec("COMMIT");
                lexicalProfileMarker = marker;
                lexicalProfileState = "ready";
                return;
            } catch (error) {
                if (!transactionAlreadyOpen) database.exec("ROLLBACK");
                lexicalProfileState = "failed";
                lexicalFailureReason = getErrorCode(error);
                if (transactionAlreadyOpen) throw error;
                return;
            }
        }
        lexicalProfileState = "awaiting_confirmation";
        lexicalFailureReason = "profile_missing";
        return;
    }

    const marker: LexicalProfileMarker = {
        profileId: profileId === CHAR_PHRASE_PROFILE_ID ? profileId : CHAR_PHRASE_PROFILE_ID,
        generation,
        sourceChunkEpoch,
        runtimeCanaryFingerprint: storedRuntimeFingerprint,
        scopeFingerprint,
        eligibleRowCount: Number.isFinite(storedEligibleRows) && storedEligibleRows >= 0
            ? Math.floor(storedEligibleRows)
            : undefined,
    };
    lexicalProfileMarker = marker;
    if (profileId !== CHAR_PHRASE_PROFILE_ID) {
        lexicalProfileState = "stale";
        lexicalFailureReason = "profile_changed";
        return;
    }
    if (storedRuntimeFingerprint !== runtimeCanaryFingerprint) {
        lexicalProfileState = "stale";
        lexicalFailureReason = "runtime_fingerprint_changed";
        return;
    }
    if (
        activeLexicalBoundaryFingerprint
        && scopeFingerprint !== activeLexicalBoundaryFingerprint
    ) {
        lexicalProfileState = "stale";
        lexicalFailureReason = "scope_changed";
        return;
    }
    if (sourceChunkEpoch !== String(currentChunkEpoch)) {
        lexicalProfileState = "stale";
        lexicalFailureReason = "source_epoch_changed";
        return;
    }
    const lexicalRowCount = getLexicalRowCount(database, generation);
    if (lexicalRowCount !== (marker.eligibleRowCount ?? chunkCount)) {
        lexicalProfileState = "failed";
        lexicalFailureReason = "row_count_mismatch";
        return;
    }
    lexicalProfileState = "ready";
}

function cleanupInterruptedLexicalRebuild(database: SQLiteDatabase): void {
    const rebuildId = getMeta(LEXICAL_META_REBUILD_ID);
    const generation = parseLexicalGeneration(getMeta(LEXICAL_META_REBUILD_GENERATION));
    if (!rebuildId && generation === null) return;
    database.exec("BEGIN");
    try {
        // The interrupted generation is inactive derived data and may itself
        // use an obsolete or malformed FTS schema. Canonical recreation is a
        // safer recovery primitive than issuing `delete-all` against it.
        if (generation !== null) recreateLexicalTable(database, generation);
        clearLexicalScope(database);
        deleteMeta(LEXICAL_META_REBUILD_ID);
        deleteMeta(LEXICAL_META_REBUILD_GENERATION);
        advanceLexicalMaintenanceEpoch("recovery-cleanup");
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function getLexicalStatus(): LexicalIndexStatus {
    const database = requireDb();
    const generation = lexicalProfileMarker?.generation;
    return {
        state: lexicalProfileState,
        marker: lexicalProfileMarker ?? undefined,
        reason: lexicalFailureReason,
        chunkCount: getNumberValueFrom(database, "SELECT COUNT(*) FROM vss_chunks"),
        lexicalRowCount: generation === undefined ? 0 : getLexicalRowCount(database, generation),
    };
}

async function refreshLexicalPathFromIndexedChunks(
    path: string,
    lexicalBoundaryFingerprint: string,
): Promise<LexicalIncrementalMaintenanceReceipt> {
    const startedAt = new Date().toISOString();
    const startedAtMonotonic = performance.now();
    if (!path || path.includes("\u0000")) {
        throw createWorkerError("lexical-incremental-path-invalid", "A canonical indexed path is required.");
    }
    const database = requireDb();
    const resourceTracker = createLexicalMaintenanceResourceTracker(database);
    const operationId = createLexicalMaintenanceOperationId("lexinc");
    const scopeBindingSha256 = await createLexicalMaintenanceScopeBinding(operationId, [path]);
    let before: LexicalMaintenanceReceiptSnapshot;
    let after: LexicalMaintenanceReceiptSnapshot;
    let resourceEnvelope: LexicalMaintenanceResourceEnvelope;
    let sourceChunkRows: Array<Record<string, unknown>>;

    database.exec("BEGIN IMMEDIATE");
    try {
        const marker = requireReadyLexicalIncrementalMarker(lexicalBoundaryFingerprint);
        sourceChunkRows = getIndexedLexicalSourceRows(database, path);
        const sourceChunkRowCount = sourceChunkRows.length;
        const lexicalRowsBefore = getActiveLexicalPathRowCount(database, marker, path);
        const totalLexicalRowsBefore = getLexicalRowCount(database, marker.generation);
        assertLexicalIncrementalRowIntegrity(
            marker,
            sourceChunkRowCount,
            lexicalRowsBefore,
            totalLexicalRowsBefore,
            "before",
        );
        before = createLexicalMaintenanceSnapshot(
            marker.generation,
            sourceChunkRowCount,
            lexicalRowsBefore,
            totalLexicalRowsBefore,
        );

        database.exec({
            sql: `DELETE FROM ${getLexicalTableName(marker.generation)} WHERE rowid IN (SELECT id FROM vss_chunks WHERE path = ?)`,
            bind: [path],
        });
        updateLexicalMaintenanceResourcePeak(resourceTracker, database);
        insertLexicalRows(database, marker.generation, sourceChunkRows);
        updateLexicalMaintenanceResourcePeak(resourceTracker, database);

        const sourceChunkRowsAfter = getIndexedLexicalSourceRows(database, path).length;
        const lexicalRowsAfter = getActiveLexicalPathRowCount(database, marker, path);
        const totalLexicalRowsAfter = getLexicalRowCount(database, marker.generation);
        assertLexicalIncrementalRowIntegrity(
            marker,
            sourceChunkRowsAfter,
            lexicalRowsAfter,
            totalLexicalRowsAfter,
            "after",
        );
        if (
            sourceChunkRowsAfter !== sourceChunkRowCount
            || lexicalRowsAfter !== lexicalRowsBefore
            || totalLexicalRowsAfter !== totalLexicalRowsBefore
        ) {
            throw createWorkerError(
                "lexical-incremental-continuity-changed",
                "Indexed-chunk lexical maintenance changed the scoped row inventory.",
            );
        }

        advanceLexicalMaintenanceEpoch("indexed-chunks-incremental", operationId);
        advancePersistedEpoch(INDEX_META_LEXICAL_INCREMENTAL_MAINTENANCE_EPOCH);
        after = createLexicalMaintenanceSnapshot(
            marker.generation,
            sourceChunkRowsAfter,
            lexicalRowsAfter,
            totalLexicalRowsAfter,
        );
        assertLexicalMaintenanceContinuity(before, after, "incremental");
        // Sample the post-mutation allocation while rollback is still possible.
        // The envelope is exposed only after this exact transaction commits.
        resourceEnvelope = finalizeLexicalMaintenanceResourceEnvelope(resourceTracker, database);
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }

    return {
        kind: "indexed-chunks-incremental",
        status: "completed",
        operationId,
        scopeBindingSha256,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, performance.now() - startedAtMonotonic),
        state: "ready",
        before,
        after,
        resourceEnvelope,
        effects: {
            source: "indexed-chunks",
            pathCount: 1,
            sourceChunkReads: sourceChunkRows.length,
            sourceChunkWrites: 0,
            lexicalRowsDeleted: before.lexicalRows,
            lexicalRowsInserted: after.lexicalRows,
            markdownReads: 0,
            markdownWrites: 0,
            providerCalls: 0,
            embeddingCalls: 0,
            embeddingWrites: 0,
        },
    };
}

function requireReadyLexicalIncrementalMarker(
    lexicalBoundaryFingerprint: string,
): LexicalProfileMarker {
    if (status !== "ready") {
        throw createWorkerError("lexical-incremental-index-not-ready", "The durable SQLite index is not ready.");
    }
    if (!lexicalProfileEnabled) {
        throw createWorkerError("lexical-incremental-feature-disabled", "The lexical profile is disabled.");
    }
    if (lexicalRebuildContext) {
        throw createWorkerError("lexical-incremental-rebuild-active", "A lexical shadow rebuild is active.");
    }
    const marker = lexicalProfileMarker;
    if (!marker || lexicalProfileState !== "ready") {
        throw createWorkerError("lexical-incremental-profile-not-ready", "The active lexical profile is not ready.");
    }
    if (
        !lexicalBoundaryFingerprint
        || marker.scopeFingerprint !== lexicalBoundaryFingerprint
        || activeLexicalBoundaryFingerprint !== lexicalBoundaryFingerprint
    ) {
        throw createWorkerError("lexical-incremental-scope-changed", "The active lexical boundary changed.");
    }
    if (marker.runtimeCanaryFingerprint !== getCharPhraseRuntimeCanaryFingerprint()) {
        throw createWorkerError("lexical-incremental-runtime-changed", "The lexical runtime fingerprint changed.");
    }
    if (marker.sourceChunkEpoch !== String(getChunkMutationEpoch())) {
        throw createWorkerError("lexical-incremental-source-changed", "The indexed-chunk generation changed.");
    }
    return marker;
}

function getIndexedLexicalSourceRows(
    database: SQLiteDatabase,
    path: string,
): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    database.exec({
        sql: "SELECT id, path, content, metadata FROM vss_chunks WHERE path = ? ORDER BY id",
        bind: [path],
        rowMode: "object",
        resultRows: rows,
    });
    return rows;
}

function assertLexicalIncrementalRowIntegrity(
    marker: LexicalProfileMarker,
    sourceChunkRows: number,
    lexicalRows: number,
    totalLexicalRows: number,
    phase: "before" | "after",
): void {
    if (sourceChunkRows <= 0 || lexicalRows <= 0 || sourceChunkRows !== lexicalRows) {
        throw createWorkerError(
            `lexical-incremental-${phase}-row-mismatch`,
            "The indexed-chunk and active lexical path inventories are incomplete or inconsistent.",
        );
    }
    if (
        marker.eligibleRowCount === undefined
        || marker.eligibleRowCount !== totalLexicalRows
        || totalLexicalRows < lexicalRows
    ) {
        throw createWorkerError(
            `lexical-incremental-${phase}-total-mismatch`,
            "The active lexical generation does not match its ready marker.",
        );
    }
}

function beginLexicalRebuild(
    profileId: "char-phrase-v1",
    runtimeCanaryFingerprint: string,
    scopeFingerprint: string,
    expectedPathCount: number,
    captureReceipt = false,
): LexicalRebuildStartResult {
    const receiptStartedAt = captureReceipt ? new Date().toISOString() : undefined;
    const receiptStartedAtMonotonic = captureReceipt ? performance.now() : undefined;
    // The begin operation is Host-only and is issued only after the internal
    // flag and explicit Memory confirmation have both passed. This also lets a
    // development flag be enabled after the Worker was opened without forcing
    // a vector-index restart.
    lexicalProfileEnabled = true;
    if (lexicalRebuildContext) {
        throw createWorkerError("lexical-rebuild-active", "A lexical rebuild is already active.");
    }
    const database = requireDb();
    const receiptResourceTracker = captureReceipt
        ? createLexicalMaintenanceResourceTracker(database)
        : undefined;
    if (!lexicalProfileMarker) {
        initializeLexicalState(database);
    }
    if (profileId !== CHAR_PHRASE_PROFILE_ID) {
        throw createWorkerError("lexical-profile-unsupported", `Unsupported lexical profile: ${profileId}`);
    }
    if (!scopeFingerprint || !Number.isInteger(expectedPathCount) || expectedPathCount < 0) {
        throw createWorkerError("lexical-scope-invalid", "A sealed lexical scope fingerprint and path count are required.");
    }
    activeLexicalBoundaryFingerprint = scopeFingerprint;
    const currentRuntimeFingerprint = getCharPhraseRuntimeCanaryFingerprint();
    if (runtimeCanaryFingerprint !== currentRuntimeFingerprint) {
        throw createWorkerError("lexical-runtime-fingerprint-mismatch", "The lexical runtime fingerprint changed before rebuild.");
    }
    const generation = lexicalProfileMarker?.generation === 0 ? 1 : 0;
    const sourceChunkEpoch = String(getChunkMutationEpoch());
    const totalRows = 0;
    const rebuildId = `lexical-${Date.now()}-${++lexicalRebuildSequence}`;
    const previousState = lexicalProfileState;
    const receipt = captureReceipt ? {
        operationId: createLexicalMaintenanceOperationId("lexreb"),
        startedAt: receiptStartedAt!,
        startedAtMonotonic: receiptStartedAtMonotonic!,
        before: createLexicalMaintenanceSnapshot(
            generation,
            0,
            getLexicalRowCount(database, generation),
            getLexicalRowCount(database, generation),
        ),
        resourceTracker: receiptResourceTracker!,
    } : undefined;
    database.exec("BEGIN");
    try {
        // The inactive generation is derived data. Recreate it from the
        // canonical DDL instead of trusting a same-named table left by an
        // interrupted or older build with different columns/tokenizer rules.
        recreateLexicalTable(database, generation);
        clearLexicalScope(database);
        setMeta(LEXICAL_META_REBUILD_ID, rebuildId);
        setMeta(LEXICAL_META_REBUILD_GENERATION, String(generation));
        advanceLexicalMaintenanceEpoch("rebuild-begin");
        if (receipt) updateLexicalMaintenanceResourcePeak(receipt.resourceTracker, database);
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }

    lexicalRebuildContext = {
        rebuildId,
        generation,
        sourceChunkEpoch,
        runtimeCanaryFingerprint,
        totalRows,
        processedRows: 0,
        eligibleRows: 0,
        nextRowId: 0,
        previousState,
        allowedPaths: new Set(),
        scopeFingerprint,
        expectedPathCount,
        scopeSealed: expectedPathCount === 0,
        expectedFieldRows: { title: 0, heading: 0, body: 0, path: 0 },
        receipt,
    };
    lexicalProfileState = "rebuilding";
    lexicalFailureReason = undefined;
    return { rebuildId, generation, sourceChunkEpoch, totalRows };
}

function appendLexicalScopeBatch(
    rebuildId: string,
    paths: string[],
): LexicalRebuildScopeBatchResult {
    const context = requireLexicalRebuild(rebuildId);
    if (context.invalidatedReason) {
        throw createWorkerError("lexical-rebuild-epoch-changed", "Indexed chunks changed during lexical rebuild.");
    }
    if (context.scopeSealed) {
        throw createWorkerError("lexical-scope-sealed", "The lexical rebuild scope is already sealed.");
    }
    if (paths.length === 0 || paths.length > RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.maxRebuildBatchSize) {
        throw createWorkerError(
            "lexical-scope-batch-invalid",
            `Lexical scope batches must contain 1 to ${RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.maxRebuildBatchSize} paths.`,
        );
    }
    for (const path of paths) {
        if (!path || context.allowedPaths.has(path)) {
            throw createWorkerError("lexical-scope-path-invalid", "Lexical scope paths must be non-empty and unique.");
        }
    }
    if (context.allowedPaths.size + paths.length > context.expectedPathCount) {
        throw createWorkerError("lexical-scope-count-mismatch", "Lexical scope contains more paths than expected.");
    }
    const database = requireDb();
    database.exec("BEGIN");
    try {
        const statement = database.prepare(`INSERT INTO ${LEXICAL_SCOPE_TABLE}(path) VALUES (?)`);
        try {
            for (const path of paths) {
                statement.bind(1, path).step();
                statement.reset(true);
            }
        } finally {
            statement.finalize();
        }
        advanceLexicalMaintenanceEpoch("rebuild-scope");
        if (context.receipt) {
            updateLexicalMaintenanceResourcePeak(context.receipt.resourceTracker, database);
        }
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
    for (const path of paths) context.allowedPaths.add(path);
    context.scopeSealed = context.allowedPaths.size === context.expectedPathCount;
    if (context.scopeSealed) {
        context.totalRows = getNumberValueFrom(database, `
            SELECT COUNT(*)
            FROM vss_chunks AS chunks
            INNER JOIN ${LEXICAL_SCOPE_TABLE} AS scope ON scope.path = chunks.path
        `);
        if (context.receipt) {
            context.receipt.before = {
                ...context.receipt.before,
                sourceChunkRows: context.totalRows,
            };
        }
    }
    return {
        rebuildId,
        acceptedPaths: context.allowedPaths.size,
        expectedPaths: context.expectedPathCount,
        sealed: context.scopeSealed,
        totalRows: context.totalRows,
    };
}

function appendLexicalRebuildBatch(
    rebuildId: string,
    afterRowId: number,
    requestedLimit: number,
): LexicalRebuildBatchResult {
    const context = requireLexicalRebuild(rebuildId);
    if (context.invalidatedReason) {
        throw createWorkerError("lexical-rebuild-epoch-changed", "Indexed chunks changed during lexical rebuild.");
    }
    if (!context.scopeSealed) {
        throw createWorkerError("lexical-scope-incomplete", "Lexical scope must be complete before rows are populated.");
    }
    if (String(getChunkMutationEpoch()) !== context.sourceChunkEpoch) {
        invalidateLexicalRebuild("source_epoch_changed");
        throw createWorkerError("lexical-rebuild-epoch-changed", "Indexed chunks changed during lexical rebuild.");
    }
    if (afterRowId !== context.nextRowId) {
        throw createWorkerError("lexical-rebuild-cursor-mismatch", "Lexical rebuild cursor is stale.");
    }
    const limit = Math.max(1, Math.min(
        RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.maxRebuildBatchSize,
        Math.floor(requestedLimit),
    ));
    const rows: Array<Record<string, unknown>> = [];
    const database = requireDb();
    database.exec({
        sql: `
            SELECT chunks.id, chunks.path, chunks.content, chunks.metadata
            FROM vss_chunks AS chunks
            INNER JOIN ${LEXICAL_SCOPE_TABLE} AS scope ON scope.path = chunks.path
            WHERE chunks.id > ?
            ORDER BY chunks.id ASC
            LIMIT ?
        `,
        bind: [afterRowId, limit],
        rowMode: "object",
        resultRows: rows,
    });

    const batchFieldRows = countLexicalTokenBearingFields(rows);
    database.exec("BEGIN");
    try {
        insertLexicalRows(database, context.generation, rows);
        advanceLexicalMaintenanceEpoch("rebuild-batch");
        if (context.receipt) {
            updateLexicalMaintenanceResourcePeak(context.receipt.resourceTracker, database);
        }
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        lexicalProfileState = "failed";
        lexicalFailureReason = getErrorCode(error);
        throw error;
    }

    context.processedRows += rows.length;
    context.eligibleRows += rows.length;
    for (const field of ["title", "heading", "body", "path"] as const) {
        context.expectedFieldRows[field] += batchFieldRows[field];
    }
    context.nextRowId = rows.length > 0
        ? Number(rows[rows.length - 1].id)
        : context.nextRowId;
    return {
        rebuildId,
        processedRows: context.processedRows,
        totalRows: context.totalRows,
        nextRowId: context.nextRowId,
        done: rows.length < limit,
    };
}

async function finalizeLexicalRebuildWithReceipt(
    rebuildId: string,
): Promise<LexicalRebuildFinalizeReceiptResult> {
    const context = requireLexicalRebuild(rebuildId);
    if (!context.receipt) {
        throw createWorkerError(
            "lexical-rebuild-receipt-missing",
            "This lexical rebuild was not started by the diagnostics receipt path.",
        );
    }
    const scopeBindingSha256 = await createLexicalMaintenanceScopeBinding(
        context.receipt.operationId,
        [...context.allowedPaths],
    );
    const result = finalizeLexicalRebuildInternal(rebuildId, scopeBindingSha256);
    if (!("receipt" in result)) {
        throw createWorkerError("lexical-rebuild-receipt-missing", "Lexical rebuild receipt finalization failed.");
    }
    return result;
}

function finalizeLexicalRebuild(rebuildId: string): LexicalIndexStatus {
    const result = finalizeLexicalRebuildInternal(rebuildId);
    return "receipt" in result ? result.status : result;
}

function finalizeLexicalRebuildInternal(
    rebuildId: string,
    scopeBindingSha256?: string,
): LexicalIndexStatus | LexicalRebuildFinalizeReceiptResult {
    const context = requireLexicalRebuild(rebuildId);
    const receiptContext = context.receipt;
    if (Boolean(receiptContext) !== Boolean(scopeBindingSha256)) {
        throw createWorkerError(
            "lexical-rebuild-receipt-mode-mismatch",
            "Lexical rebuild receipt mode changed before activation.",
        );
    }
    if (context.invalidatedReason) {
        throw createWorkerError("lexical-rebuild-epoch-changed", "Indexed chunks changed before lexical activation.");
    }
    const database = requireDb();
    if (String(getChunkMutationEpoch()) !== context.sourceChunkEpoch) {
        invalidateLexicalRebuild("source_epoch_changed");
        throw createWorkerError("lexical-rebuild-epoch-changed", "Indexed chunks changed before lexical activation.");
    }
    const lexicalRowCount = getLexicalRowCount(database, context.generation);
    if (context.processedRows !== context.totalRows || lexicalRowCount !== context.eligibleRows) {
        lexicalProfileState = "failed";
        lexicalFailureReason = "row_count_mismatch";
        throw createWorkerError("lexical-row-count-mismatch", "Lexical shadow row count does not match indexed chunks.");
    }
    validateLexicalVocabulary(database);
    validateLexicalShadow(database, context);

    const marker: LexicalProfileMarker = {
        profileId: CHAR_PHRASE_PROFILE_ID,
        generation: context.generation,
        sourceChunkEpoch: context.sourceChunkEpoch,
        runtimeCanaryFingerprint: context.runtimeCanaryFingerprint,
        scopeFingerprint: context.scopeFingerprint,
        eligibleRowCount: context.eligibleRows,
    };
    let after: LexicalMaintenanceReceiptSnapshot | undefined;
    let resourceEnvelope: LexicalMaintenanceResourceEnvelope | undefined;
    database.exec("BEGIN");
    try {
        writeLexicalMarker(marker);
        clearLexicalScope(database);
        deleteMeta(LEXICAL_META_REBUILD_ID);
        deleteMeta(LEXICAL_META_REBUILD_GENERATION);
        advanceLexicalMaintenanceEpoch(
            receiptContext ? "rebuild" : "rebuild-finalize",
            receiptContext?.operationId,
        );
        if (receiptContext) {
            after = createLexicalMaintenanceSnapshot(
                context.generation,
                context.totalRows,
                lexicalRowCount,
                lexicalRowCount,
            );
            if (
                context.totalRows <= 0
                || context.processedRows !== context.totalRows
                || context.eligibleRows !== context.totalRows
                || lexicalRowCount !== context.totalRows
                || receiptContext.before.sourceChunkRows !== context.totalRows
            ) {
                throw createWorkerError(
                    "lexical-rebuild-receipt-row-mismatch",
                    "The rebuild receipt row inventory is incomplete or inconsistent.",
                );
            }
            assertLexicalMaintenanceContinuity(receiptContext.before, after, "rebuild");
            updateLexicalMaintenanceResourcePeak(receiptContext.resourceTracker, database);
            // Keep the final allocation sample inside the activation
            // transaction so an invalid sample cannot commit without proof.
            resourceEnvelope = finalizeLexicalMaintenanceResourceEnvelope(
                receiptContext.resourceTracker,
                database,
            );
        }
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        lexicalProfileState = "failed";
        lexicalFailureReason = getErrorCode(error);
        throw error;
    }
    lexicalProfileMarker = marker;
    lexicalProfileState = "ready";
    lexicalFailureReason = undefined;
    lexicalRebuildContext = null;
    const lexicalStatus = getLexicalStatus();
    if (!receiptContext || !after || !scopeBindingSha256 || !resourceEnvelope) return lexicalStatus;
    const receipt: LexicalRebuildMaintenanceReceipt = {
        kind: "rebuild",
        status: "completed",
        operationId: receiptContext.operationId,
        scopeBindingSha256,
        startedAt: receiptContext.startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, performance.now() - receiptContext.startedAtMonotonic),
        state: "ready",
        before: receiptContext.before,
        after,
        resourceEnvelope,
        effects: {
            source: "indexed-chunks",
            pathCount: context.allowedPaths.size,
            sourceChunkReads: context.processedRows,
            sourceChunkWrites: 0,
            lexicalRowsDeleted: receiptContext.before.lexicalRows,
            lexicalRowsInserted: lexicalRowCount,
            markdownReads: 0,
            markdownWrites: 0,
            providerCalls: 0,
            embeddingCalls: 0,
            embeddingWrites: 0,
        },
    };
    return { status: lexicalStatus, receipt };
}

function abortLexicalRebuild(rebuildId: string, failureReason?: string): LexicalIndexStatus {
    const context = requireLexicalRebuild(rebuildId);
    const database = requireDb();
    const preservedReason = lexicalFailureReason;
    database.exec("BEGIN");
    try {
        clearLexicalTable(database, context.generation);
        clearLexicalScope(database);
        deleteMeta(LEXICAL_META_REBUILD_ID);
        deleteMeta(LEXICAL_META_REBUILD_GENERATION);
        advanceLexicalMaintenanceEpoch("rebuild-abort");
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
    const activeMarkerIsCoherent = Boolean(
        lexicalProfileMarker
        && lexicalProfileMarker.sourceChunkEpoch === String(getChunkMutationEpoch())
        && lexicalProfileMarker.runtimeCanaryFingerprint === getCharPhraseRuntimeCanaryFingerprint()
        && (
            !activeLexicalBoundaryFingerprint
            || lexicalProfileMarker.scopeFingerprint === activeLexicalBoundaryFingerprint
        ),
    );
    if (context.previousState === "ready" && !activeMarkerIsCoherent) {
        lexicalProfileState = "stale";
        lexicalFailureReason = preservedReason ?? context.invalidatedReason ?? failureReason ?? "source_epoch_changed";
    } else if (failureReason && context.previousState !== "ready") {
        lexicalProfileState = "failed";
        lexicalFailureReason = failureReason;
    } else {
        lexicalProfileState = context.previousState === "ready" ? "ready" : "awaiting_confirmation";
        lexicalFailureReason = failureReason ?? "rebuild_aborted";
    }
    lexicalRebuildContext = null;
    return getLexicalStatus();
}

function requireLexicalRebuild(rebuildId: string): LexicalRebuildContext {
    if (!lexicalRebuildContext || lexicalRebuildContext.rebuildId !== rebuildId) {
        throw createWorkerError("lexical-rebuild-missing", "The lexical rebuild is no longer active.");
    }
    return lexicalRebuildContext;
}

function invalidateLexicalRebuild(reason: string): void {
    const context = lexicalRebuildContext;
    if (!context) return;
    context.invalidatedReason = reason;
    lexicalProfileState = context.previousState === "ready" ? "ready" : "awaiting_confirmation";
    lexicalFailureReason = reason;
}

function insertLexicalRows(
    database: SQLiteDatabase,
    generation: number,
    rows: Array<Record<string, unknown>>,
): void {
    if (rows.length === 0) return;
    const table = getLexicalTableName(generation);
    const statement = database.prepare(`
        INSERT INTO ${table}(rowid, title, heading, body, path)
        VALUES (?, ?, ?, ?, ?)
    `);
    try {
        for (const row of rows) {
            const metadata = parseMetadata(row.metadata);
            const fields = buildCharPhraseFields({
                path: primitiveString(row.path, primitiveString(metadata.path)),
                headingPath: metadata.headingPath,
                content: primitiveString(row.content),
            });
            statement
                .bind(1, Number(row.id))
                .bind(2, fields.title)
                .bind(3, fields.heading)
                .bind(4, fields.body)
                .bind(5, fields.path)
                .step();
            statement.reset(true);
        }
    } finally {
        statement.finalize();
    }
}

function countLexicalTokenBearingFields(
    rows: Array<Record<string, unknown>>,
): Record<"title" | "heading" | "body" | "path", number> {
    const counts = { title: 0, heading: 0, body: 0, path: 0 };
    for (const row of rows) {
        const metadata = parseMetadata(row.metadata);
        const fields = buildCharPhraseFields({
            path: primitiveString(row.path, primitiveString(metadata.path)),
            headingPath: metadata.headingPath,
            content: primitiveString(row.content),
        });
        for (const field of ["title", "heading", "body", "path"] as const) {
            if (/[\p{L}\p{M}\p{N}_]/u.test(fields[field])) counts[field]++;
        }
    }
    return counts;
}

function validateLexicalShadow(database: SQLiteDatabase, context: LexicalRebuildContext): void {
    const table = getLexicalTableName(context.generation);
    const vocabTable = `vss_lexical_shadow_vocab_${context.generation}`;
    const canaryRowId = -1;
    database.exec(`INSERT INTO ${table}(${table}) VALUES('integrity-check')`);
    database.exec(`
        DROP TABLE IF EXISTS ${vocabTable};
        CREATE VIRTUAL TABLE ${vocabTable} USING fts5vocab(${table}, 'instance');
    `);
    try {
        const rows: Array<Record<string, unknown>> = [];
        database.exec({
            sql: `SELECT col, COUNT(DISTINCT doc) AS docs FROM ${vocabTable} GROUP BY col`,
            rowMode: "object",
            resultRows: rows,
        });
        const actual = new Map(rows.map((row) => [primitiveString(row.col), Number(row.docs ?? 0)]));
        for (const field of ["title", "heading", "body", "path"] as const) {
            const actualCount = actual.get(field) ?? 0;
            const expectedCount = context.expectedFieldRows[field];
            if (actualCount !== expectedCount) {
                throw createWorkerError(
                    "lexical-field-count-mismatch",
                    `Lexical shadow field count does not match source projection: ${field} (${actualCount}/${expectedCount})`,
                );
            }
        }

        // Exercise the actual shadow table, not only a separate canary table.
        // This catches a stale or malformed generation before the marker can
        // switch, while the reserved negative rowid cannot collide with chunk
        // ids (which are positive INTEGER PRIMARY KEY values).
        const statement = database.prepare(`
            INSERT INTO ${table}(rowid, title, heading, body, path)
            VALUES (?, ?, ?, ?, ?)
        `);
        try {
            statement
                .bind(1, canaryRowId)
                .bind(2, "")
                .bind(3, "")
                .bind(4, transformCharPhraseDocument("召回。"))
                .bind(5, "")
                .step();
        } finally {
            statement.finalize();
        }
        const canaryRows: Array<Record<string, unknown>> = [];
        database.exec({
            sql: `SELECT term FROM ${vocabTable} WHERE doc = ? ORDER BY term`,
            bind: [canaryRowId],
            rowMode: "object",
            resultRows: canaryRows,
        });
        const canaryTerms = new Set(canaryRows.map((row) => primitiveString(row.term)));
        if (
            !canaryTerms.has("c53ec")
            || !canaryTerms.has("c56de")
            || canaryTerms.has("c")
            || canaryTerms.has("53ec")
            || canaryTerms.has("c3002")
        ) {
            throw createWorkerError("lexical-vocabulary-invalid", "Lexical shadow atomic vocabulary validation failed.");
        }
    } finally {
        database.exec({
            sql: `DELETE FROM ${table} WHERE rowid = ?`,
            bind: [canaryRowId],
        });
        database.exec(`DROP TABLE IF EXISTS ${vocabTable}`);
    }
}

function validateLexicalVocabulary(database: SQLiteDatabase): void {
    database.exec(`
        DROP TABLE IF EXISTS vss_char_phrase_canary_vocab;
        DROP TABLE IF EXISTS vss_char_phrase_canary;
        CREATE VIRTUAL TABLE vss_char_phrase_canary USING fts5(
            body,
            content='',
            contentless_delete=1,
            tokenize='${CHAR_PHRASE_TOKENIZER}'
        );
        CREATE VIRTUAL TABLE vss_char_phrase_canary_vocab USING fts5vocab(vss_char_phrase_canary, 'row');
    `);
    try {
        const statement = database.prepare("INSERT INTO vss_char_phrase_canary(rowid, body) VALUES (?, ?)");
        try {
            statement.bind(1, 1).bind(2, transformCharPhraseDocument("召回。")).step();
        } finally {
            statement.finalize();
        }
        const rows: Array<Record<string, unknown>> = [];
        database.exec({
            sql: "SELECT term FROM vss_char_phrase_canary_vocab ORDER BY term",
            rowMode: "object",
            resultRows: rows,
        });
        const terms = new Set(rows.map((row) => primitiveString(row.term)));
        if (!terms.has("c53ec") || !terms.has("c56de") || terms.has("c") || terms.has("53ec") || terms.has("c3002")) {
            throw createWorkerError("lexical-vocabulary-invalid", "CHAR-PHRASE atomic vocabulary validation failed.");
        }
    } finally {
        database.exec(`
            DROP TABLE IF EXISTS vss_char_phrase_canary_vocab;
            DROP TABLE IF EXISTS vss_char_phrase_canary;
        `);
    }
}

function writeLexicalMarker(marker: LexicalProfileMarker): void {
    setMeta(LEXICAL_META_PROFILE_ID, marker.profileId);
    setMeta(LEXICAL_META_GENERATION, String(marker.generation));
    setMeta(LEXICAL_META_SOURCE_EPOCH, marker.sourceChunkEpoch);
    setMeta(LEXICAL_META_RUNTIME_FINGERPRINT, marker.runtimeCanaryFingerprint);
    if (marker.scopeFingerprint !== undefined) {
        setMeta(LEXICAL_META_SCOPE_FINGERPRINT, marker.scopeFingerprint);
    } else {
        deleteMeta(LEXICAL_META_SCOPE_FINGERPRINT);
    }
    if (marker.eligibleRowCount !== undefined) {
        setMeta(LEXICAL_META_ELIGIBLE_ROW_COUNT, String(marker.eligibleRowCount));
    } else {
        deleteMeta(LEXICAL_META_ELIGIBLE_ROW_COUNT);
    }
}

function getLexicalTableName(generation: number): typeof LEXICAL_TABLES[number] {
    if (generation !== 0 && generation !== 1) {
        throw createWorkerError("lexical-generation-invalid", `Unsupported lexical generation: ${generation}`);
    }
    return LEXICAL_TABLES[generation];
}

function parseLexicalGeneration(value: string | null): 0 | 1 | null {
    return value === "0" ? 0 : value === "1" ? 1 : null;
}

function clearLexicalTable(database: SQLiteDatabase, generation: number): void {
    const table = getLexicalTableName(generation);
    // FTS5's contentless delete-all command clears the inactive derived index
    // without walking source chunks or issuing an unbounded row-by-row loop.
    // Its maximum-device latency remains an explicit Phase 0B calibration gate.
    database.exec(`INSERT INTO ${table}(${table}) VALUES('delete-all')`);
}

function recreateLexicalTable(database: SQLiteDatabase, generation: number): void {
    const table = getLexicalTableName(generation);
    database.exec(`
        DROP TABLE IF EXISTS ${table};
        CREATE VIRTUAL TABLE ${table} USING fts5(
            title,
            heading,
            body,
            path,
            content='',
            contentless_delete=1,
            tokenize='${CHAR_PHRASE_TOKENIZER}'
        );
    `);
}

function clearLexicalScope(database: SQLiteDatabase): void {
    database.exec(`DELETE FROM ${LEXICAL_SCOPE_TABLE}`);
}

function getLexicalRowCount(database: SQLiteDatabase, generation: number): number {
    return getNumberValueFrom(database, `SELECT COUNT(*) FROM ${getLexicalTableName(generation)}`);
}

function getChunkMutationEpoch(): number {
    const parsed = Number(getMeta(LEXICAL_META_CHUNK_EPOCH) ?? "0");
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function advanceChunkMutationEpoch(): number {
    const next = getChunkMutationEpoch() + 1;
    setMeta(LEXICAL_META_CHUNK_EPOCH, String(next));
    return next;
}

function getPersistedEpoch(key: string): number {
    const parsed = Number(getMeta(key) ?? "0");
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function setPersistedEpoch(key: string, value: number): void {
    setMeta(key, String(Math.max(0, Math.floor(value))));
}

function advancePersistedEpoch(key: string): number {
    const next = getPersistedEpoch(key) + 1;
    setPersistedEpoch(key, next);
    return next;
}

function advanceIndexMutationEpoch(): number {
    return advancePersistedEpoch(INDEX_META_MUTATION_EPOCH);
}

function advanceLexicalMaintenanceEpoch(kind: string, operationId?: string): number {
    advanceIndexMutationEpoch();
    setMeta(INDEX_META_LAST_LEXICAL_MAINTENANCE_KIND, kind);
    if (operationId) {
        setMeta(INDEX_META_LAST_LEXICAL_MAINTENANCE_OPERATION_ID, operationId);
    } else {
        deleteMeta(INDEX_META_LAST_LEXICAL_MAINTENANCE_OPERATION_ID);
    }
    return advancePersistedEpoch(INDEX_META_LEXICAL_MAINTENANCE_EPOCH);
}

function createLexicalMaintenanceOperationId(prefix: "lexinc" | "lexreb"): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.getRandomValues !== "function") {
        throw createWorkerError(
            "lexical-maintenance-random-unavailable",
            "Secure random operation identity is unavailable.",
        );
    }
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return `${prefix}-${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function createLexicalMaintenanceScopeBinding(
    operationId: string,
    paths: string[],
): Promise<string> {
    const digest = globalThis.crypto?.subtle?.digest;
    if (typeof digest !== "function") {
        throw createWorkerError(
            "lexical-maintenance-digest-unavailable",
            "Cryptographic scope binding is unavailable.",
        );
    }
    const canonicalPaths = [...paths].sort(compareCodePoint);
    if (canonicalPaths.length === 0 || new Set(canonicalPaths).size !== canonicalPaths.length) {
        throw createWorkerError("lexical-maintenance-scope-invalid", "A non-empty unique lexical scope is required.");
    }
    const payload = new TextEncoder().encode([
        "b125-lexical-maintenance-v1",
        operationId,
        canonicalPaths.join("\u0000"),
    ].join("\u0000"));
    const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", payload));
    return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function getEstimatedDatabaseBytes(database: SQLiteDatabase): number {
    const pageSize = getNumberValueFrom(database, "PRAGMA page_size");
    const pageCount = getNumberValueFrom(database, "PRAGMA page_count");
    const estimatedDbBytes = pageSize * pageCount;
    if (
        !Number.isSafeInteger(pageSize)
        || pageSize <= 0
        || !Number.isSafeInteger(pageCount)
        || pageCount < 0
        || !Number.isSafeInteger(estimatedDbBytes)
        || estimatedDbBytes < 0
    ) {
        throw createWorkerError(
            "lexical-maintenance-resource-invalid",
            "The SQLite allocation envelope is unavailable or invalid.",
        );
    }
    return estimatedDbBytes;
}

function createLexicalMaintenanceResourceTracker(
    database: SQLiteDatabase,
): LexicalMaintenanceResourceTracker {
    const estimatedDbBytesBefore = getEstimatedDatabaseBytes(database);
    return {
        estimatedDbBytesBefore,
        estimatedDbBytesPeak: estimatedDbBytesBefore,
    };
}

function updateLexicalMaintenanceResourcePeak(
    tracker: LexicalMaintenanceResourceTracker,
    database: SQLiteDatabase,
): number {
    const estimatedDbBytes = getEstimatedDatabaseBytes(database);
    tracker.estimatedDbBytesPeak = Math.max(tracker.estimatedDbBytesPeak, estimatedDbBytes);
    return estimatedDbBytes;
}

function finalizeLexicalMaintenanceResourceEnvelope(
    tracker: LexicalMaintenanceResourceTracker,
    database: SQLiteDatabase,
): LexicalMaintenanceResourceEnvelope {
    const estimatedDbBytesAfter = updateLexicalMaintenanceResourcePeak(tracker, database);
    return {
        estimatedDbBytesBefore: tracker.estimatedDbBytesBefore,
        estimatedDbBytesPeak: tracker.estimatedDbBytesPeak,
        estimatedDbBytesAfter,
    };
}

function createLexicalMaintenanceSnapshot(
    generation: number,
    sourceChunkRows: number,
    lexicalRows: number,
    totalLexicalRows: number,
): LexicalMaintenanceReceiptSnapshot {
    const databaseInstanceId = getMeta(INDEX_META_DATABASE_INSTANCE_ID);
    if (!databaseInstanceId) {
        throw createWorkerError(
            "lexical-maintenance-database-identity-missing",
            "The durable SQLite database identity is unavailable.",
        );
    }
    return {
        databaseInstanceId,
        profileId: CHAR_PHRASE_PROFILE_ID,
        generation,
        sourceChunkEpoch: String(getChunkMutationEpoch()),
        chunkMutationEpoch: getChunkMutationEpoch(),
        indexMutationEpoch: getPersistedEpoch(INDEX_META_MUTATION_EPOCH),
        rebuildEpoch: getPersistedEpoch(INDEX_META_REBUILD_EPOCH),
        lexicalMaintenanceEpoch: getPersistedEpoch(INDEX_META_LEXICAL_MAINTENANCE_EPOCH),
        incrementalMaintenanceEpoch: getPersistedEpoch(INDEX_META_LEXICAL_INCREMENTAL_MAINTENANCE_EPOCH),
        sourceChunkRows,
        lexicalRows,
        totalLexicalRows,
    };
}

function assertLexicalMaintenanceContinuity(
    before: LexicalMaintenanceReceiptSnapshot,
    after: LexicalMaintenanceReceiptSnapshot,
    kind: "incremental" | "rebuild",
): void {
    if (
        before.databaseInstanceId !== after.databaseInstanceId
        || before.profileId !== after.profileId
        || before.generation !== after.generation
        || before.sourceChunkEpoch !== after.sourceChunkEpoch
        || before.chunkMutationEpoch !== after.chunkMutationEpoch
        || before.rebuildEpoch !== after.rebuildEpoch
    ) {
        throw createWorkerError(
            "lexical-maintenance-continuity-changed",
            "Lexical maintenance changed the canonical indexed-source continuity.",
        );
    }
    const indexDelta = after.indexMutationEpoch - before.indexMutationEpoch;
    const lexicalDelta = after.lexicalMaintenanceEpoch - before.lexicalMaintenanceEpoch;
    if (indexDelta <= 0 || indexDelta !== lexicalDelta) {
        throw createWorkerError(
            "lexical-maintenance-epoch-invalid",
            "Lexical and index maintenance epochs did not advance together.",
        );
    }
    const incrementalDelta = after.incrementalMaintenanceEpoch - before.incrementalMaintenanceEpoch;
    if (kind === "incremental" ? incrementalDelta !== 1 || indexDelta !== 1 : incrementalDelta !== 0) {
        throw createWorkerError(
            "lexical-maintenance-kind-epoch-invalid",
            "The dedicated lexical maintenance epoch does not match the operation kind.",
        );
    }
}

function createDatabaseInstanceId(): string | null {
    const cryptoApi = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
    if (typeof cryptoApi?.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    if (typeof cryptoApi?.getRandomValues !== "function") return null;
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function initializeContinuityMetadata(overrides: {
    databaseInstanceId?: string | null;
    indexMutationEpoch?: number;
    rebuildEpoch?: number;
    lexicalMaintenanceEpoch?: number;
    lexicalIncrementalMaintenanceEpoch?: number;
} = {}): void {
    if (!getMeta(INDEX_META_DATABASE_INSTANCE_ID)) {
        const databaseInstanceId = overrides.databaseInstanceId ?? createDatabaseInstanceId();
        if (databaseInstanceId) setMeta(INDEX_META_DATABASE_INSTANCE_ID, databaseInstanceId);
    }
    if (getMeta(INDEX_META_MUTATION_EPOCH) === null) {
        setPersistedEpoch(INDEX_META_MUTATION_EPOCH, overrides.indexMutationEpoch ?? 0);
    }
    if (getMeta(INDEX_META_REBUILD_EPOCH) === null) {
        setPersistedEpoch(INDEX_META_REBUILD_EPOCH, overrides.rebuildEpoch ?? 0);
    }
    if (getMeta(INDEX_META_LEXICAL_MAINTENANCE_EPOCH) === null) {
        setPersistedEpoch(
            INDEX_META_LEXICAL_MAINTENANCE_EPOCH,
            overrides.lexicalMaintenanceEpoch ?? 0,
        );
    }
    if (getMeta(INDEX_META_LEXICAL_INCREMENTAL_MAINTENANCE_EPOCH) === null) {
        setPersistedEpoch(
            INDEX_META_LEXICAL_INCREMENTAL_MAINTENANCE_EPOCH,
            overrides.lexicalIncrementalMaintenanceEpoch ?? 0,
        );
    }
}

function deleteMeta(key: string): void {
    requireDb().exec({
        sql: "DELETE FROM vss_meta WHERE key = ?",
        bind: [key],
    });
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
    if (chunks.some((chunk) => (
        chunk.path !== fileState.path
        || !Number.isInteger(chunk.chunkIndex)
        || chunk.chunkIndex < 0
    ))) {
        throw createWorkerError("chunk-inventory-invalid", "Chunk paths and indices must match the coherent file upsert.");
    }
    const evidenceGeneration = computePathEvidenceGeneration(fileState, chunks);

    const startedAt = performance.now();
    const database = requireDb();
    const activeMarkerBeforeWrite = getWritableActiveLexicalMarker();
    const maintainLexical = Boolean(
        activeMarkerBeforeWrite
        && fileState.lexicalMaintenanceEnabled === true
        && fileState.lexicalBoundaryFingerprint
        && fileState.lexicalBoundaryFingerprint === activeMarkerBeforeWrite.scopeFingerprint,
    );
    const lexicalSuppressionReason = activeMarkerBeforeWrite && !maintainLexical
        ? fileState.lexicalMaintenanceEnabled === true ? "scope_changed" : "feature_disabled_write"
        : undefined;
    const activeRowsBeforeWrite = activeMarkerBeforeWrite && maintainLexical
        ? activeMarkerBeforeWrite.eligibleRowCount
            ?? getLexicalRowCount(database, activeMarkerBeforeWrite.generation)
        : 0;
    const replacedLexicalRows = activeMarkerBeforeWrite && maintainLexical
        ? getActiveLexicalPathRowCount(database, activeMarkerBeforeWrite, fileState.path)
        : 0;
    const writeLexicalRows = maintainLexical && fileState.lexicalEligible === true;
    database.exec("BEGIN");
    try {
        deleteFileRows(fileState.path, maintainLexical);
        const fileStmt = database.prepare(`
            INSERT INTO vss_files(path, content_hash, mtime, size, status, updated_at, evidence_generation)
            VALUES (?, ?, ?, ?, 'ready', ?, ?)
        `);
        try {
            fileStmt
                .bind(1, fileState.path)
                .bind(2, fileState.contentHash)
                .bind(3, fileState.mtime)
                .bind(4, fileState.size)
                .bind(5, Date.now())
                .bind(6, evidenceGeneration)
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

        const writableLexicalMarker = maintainLexical ? getWritableActiveLexicalMarker() : null;
        if (writableLexicalMarker && writeLexicalRows) {
            const rows: Array<Record<string, unknown>> = [];
            database.exec({
                sql: "SELECT id, path, content, metadata FROM vss_chunks WHERE path = ? ORDER BY id",
                bind: [fileState.path],
                rowMode: "object",
                resultRows: rows,
            });
            insertLexicalRows(database, writableLexicalMarker.generation, rows);
        }

        const invalidatedRebuild = lexicalRebuildContext;
        const sourceEpoch = advanceChunkMutationEpoch();
        advanceIndexMutationEpoch();
        const nextLexicalMarker = writableLexicalMarker
            ? {
                ...writableLexicalMarker,
                sourceChunkEpoch: String(sourceEpoch),
                eligibleRowCount: Math.max(
                    0,
                    activeRowsBeforeWrite - replacedLexicalRows + (writeLexicalRows ? chunks.length : 0),
                ),
            }
            : null;
        if (nextLexicalMarker) writeLexicalMarker(nextLexicalMarker);

        database.exec("COMMIT");

        if (nextLexicalMarker) lexicalProfileMarker = nextLexicalMarker;
        if (invalidatedRebuild) {
            invalidatedRebuild.invalidatedReason = "source_epoch_changed";
            lexicalProfileState = invalidatedRebuild.previousState === "ready"
                && Boolean(nextLexicalMarker)
                && !lexicalSuppressionReason
                ? "ready"
                : lexicalSuppressionReason ? "stale" : "awaiting_confirmation";
            lexicalFailureReason = lexicalSuppressionReason ?? "source_epoch_changed";
        } else if (lexicalSuppressionReason) {
            lexicalProfileState = "stale";
            lexicalFailureReason = lexicalSuppressionReason;
        }

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
        // deleteFileRows may already have changed the hot cache even though
        // SQLite restores the previous rows.
        vectorCache = null;
        throw error;
    }
}

function deleteFile(path: string, options: VectorIndexDeleteOptions = {}): void {
    const database = requireDb();
    if (!hasStoredRowsForPath(database, path)) return;

    const activeMarkerBeforeWrite = getWritableActiveLexicalMarker();
    const maintainLexical = Boolean(
        activeMarkerBeforeWrite
        && options.lexicalMaintenanceEnabled === true
        && options.lexicalBoundaryFingerprint
        && options.lexicalBoundaryFingerprint === activeMarkerBeforeWrite.scopeFingerprint,
    );
    const lexicalSuppressionReason = activeMarkerBeforeWrite && !maintainLexical
        ? options.lexicalMaintenanceEnabled === true ? "scope_changed" : "feature_disabled_write"
        : undefined;
    const activeRowsBeforeWrite = activeMarkerBeforeWrite && maintainLexical
        ? activeMarkerBeforeWrite.eligibleRowCount
            ?? getLexicalRowCount(database, activeMarkerBeforeWrite.generation)
        : 0;
    const removedLexicalRows = activeMarkerBeforeWrite && maintainLexical
        ? getActiveLexicalPathRowCount(database, activeMarkerBeforeWrite, path)
        : 0;
    database.exec("BEGIN");
    try {
        deleteFileRows(path, maintainLexical);
        const invalidatedRebuild = lexicalRebuildContext;
        const sourceEpoch = advanceChunkMutationEpoch();
        advanceIndexMutationEpoch();
        const writableLexicalMarker = maintainLexical ? getWritableActiveLexicalMarker() : null;
        const nextLexicalMarker = writableLexicalMarker
            ? {
                ...writableLexicalMarker,
                sourceChunkEpoch: String(sourceEpoch),
                eligibleRowCount: Math.max(0, activeRowsBeforeWrite - removedLexicalRows),
            }
            : null;
        if (nextLexicalMarker) writeLexicalMarker(nextLexicalMarker);
        database.exec("COMMIT");
        if (nextLexicalMarker) lexicalProfileMarker = nextLexicalMarker;
        if (invalidatedRebuild) {
            invalidatedRebuild.invalidatedReason = "source_epoch_changed";
            lexicalProfileState = invalidatedRebuild.previousState === "ready"
                && Boolean(nextLexicalMarker)
                && !lexicalSuppressionReason
                ? "ready"
                : lexicalSuppressionReason ? "stale" : "awaiting_confirmation";
            lexicalFailureReason = lexicalSuppressionReason ?? "source_epoch_changed";
        } else if (lexicalSuppressionReason) {
            lexicalProfileState = "stale";
            lexicalFailureReason = lexicalSuppressionReason;
        }
    } catch (error) {
        database.exec("ROLLBACK");
        vectorCache = null;
        throw error;
    }
}

function hasStoredRowsForPath(database: SQLiteDatabase, path: string): boolean {
    const rows: unknown[][] = [];
    database.exec({
        sql: `
            SELECT
                EXISTS(SELECT 1 FROM vss_files WHERE path = ?) AS file_exists,
                EXISTS(SELECT 1 FROM vss_chunks WHERE path = ?) AS chunk_exists
        `,
        bind: [path, path],
        rowMode: "array",
        resultRows: rows,
    });
    return Number(rows[0]?.[0] ?? 0) > 0 || Number(rows[0]?.[1] ?? 0) > 0;
}

function deleteFileRows(path: string, maintainLexical: boolean): void {
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
    const writableLexicalMarker = maintainLexical ? getWritableActiveLexicalMarker() : null;
    if (writableLexicalMarker) {
        database.exec({
            sql: `DELETE FROM ${getLexicalTableName(writableLexicalMarker.generation)} WHERE rowid IN (SELECT id FROM vss_chunks WHERE path = ?)`,
            bind: [path],
        });
    }
    database.exec({
        sql: "DELETE FROM vss_chunks WHERE path = ?",
        bind: [path],
    });
    database.exec({
        sql: "DELETE FROM vss_files WHERE path = ?",
        bind: [path],
    });
}

function getWritableActiveLexicalMarker(): LexicalProfileMarker | null {
    if (!lexicalProfileMarker) return null;
    if (lexicalProfileState === "ready") return lexicalProfileMarker;
    // The active generation remains authoritative while an already-ready
    // profile is rebuilding. A shadow failure may set the public state to
    // `failed` before Host cleanup is re-queued; foreground writes in that
    // window must still advance the active marker atomically.
    return lexicalRebuildContext?.previousState === "ready"
        ? lexicalProfileMarker
        : null;
}

function getActiveLexicalPathRowCount(
    database: SQLiteDatabase,
    marker: LexicalProfileMarker,
    path: string,
): number {
    const rows: unknown[][] = [];
    database.exec({
        sql: `
            SELECT COUNT(*)
            FROM ${getLexicalTableName(marker.generation)} AS lexical
            INNER JOIN vss_chunks AS chunks ON chunks.id = lexical.rowid
            WHERE chunks.path = ?
        `,
        bind: [path],
        rowMode: "array",
        resultRows: rows,
    });
    return Number(rows[0]?.[0] ?? 0);
}

function updateFileMetadata(fileState: VSSFileState): void {
    const startedAt = performance.now();
    const database = requireDb();
    const nextGeneration = computeStoredPathEvidenceGeneration(fileState);
    database.exec("BEGIN");
    try {
        database.exec({
            sql: `
                UPDATE vss_files
                SET content_hash = ?, mtime = ?, size = ?, status = 'ready', updated_at = ?, evidence_generation = ?
                WHERE path = ?
            `,
            bind: [fileState.contentHash, fileState.mtime, fileState.size, Date.now(), nextGeneration, fileState.path],
        });

        advanceIndexMutationEpoch();
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

function computeStoredPathEvidenceGeneration(
    fileState: VSSFileState,
    expectedChunkCount?: number,
): string {
    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: `
            SELECT path, chunk_index, content, content_hash, created, last_modified, metadata
            FROM vss_chunks
            WHERE path = ?
            ORDER BY chunk_index ASC
        `,
        bind: [fileState.path],
        rowMode: "object",
        resultRows: rows,
    });
    if (rows.length === 0) return "";
    if (expectedChunkCount !== undefined && rows.length !== expectedChunkCount) {
        throw createWorkerError(
            "path-evidence-inventory-changed",
            "Path evidence inventory changed after repair preflight.",
        );
    }
    const seenChunkIndexes = new Set<number>();
    const chunks: VSSChunk[] = rows.map((row) => {
        const path = primitiveString(row.path);
        const chunkIndex = Number(row.chunk_index);
        if (
            path !== fileState.path
            || !Number.isInteger(chunkIndex)
            || chunkIndex < 0
            || seenChunkIndexes.has(chunkIndex)
        ) {
            throw createWorkerError(
                "path-evidence-inventory-invalid",
                "Path evidence inventory contains malformed or duplicate chunks.",
            );
        }
        seenChunkIndexes.add(chunkIndex);
        return {
            path,
            chunkIndex,
            content: primitiveString(row.content),
            contentHash: primitiveString(row.content_hash),
            created: Number(row.created),
            lastModified: Number(row.last_modified),
            metadata: parseMetadata(row.metadata),
        };
    });
    return computePathEvidenceGeneration(fileState, chunks);
}

function readPathEvidenceGenerations(
    paths: string[],
    maxPathsPerBatch: number,
): IndexedPathEvidenceGenerationResult {
    const uniquePaths = [...new Set(paths.filter(Boolean))].sort(compareCodePoint);
    if (
        !Number.isInteger(maxPathsPerBatch)
        || maxPathsPerBatch <= 0
        || maxPathsPerBatch > GRAPH_RANK_HARD_MAX_PATHS_PER_BATCH
        || uniquePaths.length > PATH_EVIDENCE_HARD_MAX_PATHS
    ) {
        throw createWorkerError("path-evidence-budget-invalid", "Path evidence generation lookup exceeds hard bounds.");
    }
    const result: IndexedPathEvidenceGeneration[] = [];
    for (const batch of partition(uniquePaths, maxPathsPerBatch)) {
        const rows: Array<Record<string, unknown>> = [];
        const placeholders = batch.map(() => "?").join(",");
        requireDb().exec({
            sql: `
                SELECT path, evidence_generation, content_hash, mtime, size
                FROM vss_files
                WHERE path IN (${placeholders})
                  AND status = 'ready'
                ORDER BY path
            `,
            bind: batch,
            rowMode: "object",
            resultRows: rows,
        });
        for (const row of rows) {
            const path = primitiveString(row.path);
            const generation = primitiveString(row.evidence_generation);
            if (!batch.includes(path) || !generation) continue;
            result.push({
                path,
                generation,
                contentHash: primitiveString(row.content_hash),
                mtime: Number(row.mtime),
                size: Number(row.size),
            });
        }
    }
    result.sort((left, right) => compareCodePoint(left.path, right.path));
    return { sourceEpoch: String(getChunkMutationEpoch()), paths: result };
}

async function getPathEvidenceGenerations(
    paths: string[],
    maxPathsPerBatch: number,
    maxChunksScanned: number,
    hooks: PathEvidenceRepairHooks = {},
): Promise<IndexedPathEvidenceGenerationResult> {
    const uniquePaths = [...new Set(paths.filter(Boolean))].sort(compareCodePoint);
    if (
        !Number.isInteger(maxPathsPerBatch)
        || maxPathsPerBatch <= 0
        || maxPathsPerBatch > GRAPH_RANK_HARD_MAX_PATHS_PER_BATCH
        || uniquePaths.length > PATH_EVIDENCE_HARD_MAX_PATHS
        || !Number.isInteger(maxChunksScanned)
        || maxChunksScanned <= 0
        || maxChunksScanned > PATH_EVIDENCE_HARD_MAX_CHUNKS
    ) {
        throw createWorkerError("path-evidence-budget-invalid", "Path evidence generation lookup exceeds hard bounds.");
    }

    const sourceEpoch = String(getChunkMutationEpoch());
    const database = requireDb();
    const fileRows = new Map<string, StoredPathEvidenceFileRow>();
    for (const batch of partition(uniquePaths, maxPathsPerBatch)) {
        const batchStartedAt = Date.now();
        hooks.checkpoint?.();
        const placeholders = batch.map(() => "?").join(",");
        const rows: Array<Record<string, unknown>> = [];
        database.exec({
            sql: `
                SELECT path, evidence_generation, content_hash, mtime, size
                FROM vss_files
                WHERE path IN (${placeholders})
                  AND status = 'ready'
                ORDER BY path
            `,
            bind: batch,
            rowMode: "object",
            resultRows: rows,
        });
        for (const row of rows) {
            const path = primitiveString(row.path);
            if (!batch.includes(path) || fileRows.has(path)) {
                throw createWorkerError("path-evidence-row-invalid", "Path evidence file row is malformed or duplicated.");
            }
            const mtime = Number(row.mtime);
            const size = Number(row.size);
            if (!Number.isFinite(mtime) || !Number.isFinite(size)) {
                throw createWorkerError("path-evidence-row-invalid", "Path evidence file revision is malformed.");
            }
            fileRows.set(path, {
                path,
                generation: primitiveString(row.evidence_generation),
                contentHash: primitiveString(row.content_hash),
                mtime,
                size,
            });
        }
        await finishPathEvidenceBatch(hooks, batchStartedAt);
    }

    const missingRows = [...fileRows.values()]
        .filter((row) => !row.generation)
        .sort((left, right) => compareCodePoint(left.path, right.path));
    if (missingRows.length === 0) {
        return indexedPathEvidenceResult(sourceEpoch, fileRows.values());
    }

    const expectedChunkCounts = new Map<string, number>();
    let totalChunks = 0;
    let totalBytes = 0;
    for (const batch of partition(missingRows.map((row) => row.path), maxPathsPerBatch)) {
        const batchStartedAt = Date.now();
        hooks.checkpoint?.();
        const placeholders = batch.map(() => "?").join(",");
        const rows: Array<Record<string, unknown>> = [];
        database.exec({
            sql: `
                SELECT
                    path,
                    COUNT(*) AS chunk_count,
                    COALESCE(SUM(
                        COALESCE(length(CAST(path AS BLOB)), 0)
                        + COALESCE(length(CAST(content AS BLOB)), 0)
                        + COALESCE(length(CAST(metadata AS BLOB)), 0)
                        + COALESCE(length(CAST(content_hash AS BLOB)), 0)
                        + 64
                    ), 0) AS inventory_bytes
                FROM vss_chunks
                WHERE path IN (${placeholders})
                GROUP BY path
                ORDER BY path
            `,
            bind: batch,
            rowMode: "object",
            resultRows: rows,
        });
        for (const row of rows) {
            const path = primitiveString(row.path);
            const chunkCount = Number(row.chunk_count);
            const inventoryBytes = Number(row.inventory_bytes);
            if (
                !batch.includes(path)
                || expectedChunkCounts.has(path)
                || !Number.isInteger(chunkCount)
                || chunkCount <= 0
                || !Number.isFinite(inventoryBytes)
                || inventoryBytes < 0
            ) {
                return indexedPathEvidenceResult(sourceEpoch, fileRows.values());
            }
            expectedChunkCounts.set(path, chunkCount);
            totalChunks += chunkCount;
            totalBytes += inventoryBytes;
        }
        if (
            batch.some((path) => !expectedChunkCounts.has(path))
            || totalChunks > maxChunksScanned
            || totalBytes > PATH_EVIDENCE_HARD_MAX_BYTES
        ) {
            // A legacy inventory outside the bounded envelope remains unknown;
            // do not repair a lexicographic prefix of the requested group.
            return indexedPathEvidenceResult(sourceEpoch, fileRows.values());
        }
        await finishPathEvidenceBatch(hooks, batchStartedAt);
    }

    if (String(getChunkMutationEpoch()) !== sourceEpoch) {
        return indexedPathEvidenceResult(sourceEpoch, fileRows.values());
    }

    database.exec("BEGIN");
    try {
        for (const row of missingRows) {
            const batchStartedAt = Date.now();
            hooks.checkpoint?.();
            const generation = computeStoredPathEvidenceGeneration(
                {
                    path: row.path,
                    contentHash: row.contentHash,
                    mtime: row.mtime,
                    size: row.size,
                },
                expectedChunkCounts.get(row.path),
            );
            if (!generation) {
                throw createWorkerError("path-evidence-inventory-unavailable", "Path evidence inventory is unavailable.");
            }
            database.exec({
                sql: `
                    UPDATE vss_files
                    SET evidence_generation = ?
                    WHERE path = ?
                      AND evidence_generation = ''
                      AND content_hash = ?
                      AND mtime = ?
                      AND size = ?
                      AND status = 'ready'
                `,
                bind: [generation, row.path, row.contentHash, row.mtime, row.size],
            });
            row.generation = generation;
            await finishPathEvidenceBatch(hooks, batchStartedAt);
        }
        if (String(getChunkMutationEpoch()) !== sourceEpoch) {
            throw createWorkerError("path-evidence-source-changed", "Path evidence inventory changed during repair.");
        }
        for (const row of missingRows) {
            const verificationRows: Array<Record<string, unknown>> = [];
            database.exec({
                sql: `
                    SELECT evidence_generation
                    FROM vss_files
                    WHERE path = ? AND status = 'ready'
                `,
                bind: [row.path],
                rowMode: "object",
                resultRows: verificationRows,
            });
            if (
                verificationRows.length !== 1
                || primitiveString(verificationRows[0].evidence_generation) !== row.generation
            ) {
                throw createWorkerError("path-evidence-repair-conflict", "Path evidence generation changed during repair.");
            }
        }
        advanceIndexMutationEpoch();
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }

    return indexedPathEvidenceResult(sourceEpoch, fileRows.values());
}

function indexedPathEvidenceResult(
    sourceEpoch: string,
    rows: Iterable<StoredPathEvidenceFileRow>,
): IndexedPathEvidenceGenerationResult {
    const paths = [...rows]
        .filter((row) => row.generation)
        .map((row) => ({
            path: row.path,
            generation: row.generation,
            contentHash: row.contentHash,
            mtime: row.mtime,
            size: row.size,
        }))
        .sort((left, right) => compareCodePoint(left.path, right.path));
    return { sourceEpoch, paths };
}

async function finishPathEvidenceBatch(
    hooks: PathEvidenceRepairHooks,
    batchStartedAt: number,
): Promise<void> {
    hooks.onBatchComplete?.(Math.max(0, Date.now() - batchStartedAt));
    await nextWorkerMessageTask();
    hooks.checkpoint?.();
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

async function rankGraphCandidates(
    queryEmbedding: number[],
    paths: string[],
    control: RankedPathRequestControl,
): Promise<RankedPathRequestResult> {
    const workerStartedAt = Date.now();
    const profile = activeProfile;
    if (!profile) {
        throw createWorkerError("profile-missing", "SQLite vector index has no active embedding profile.");
    }
    const uniquePaths = [...new Set(paths.filter(Boolean))].sort(compareCodePoint);
    validateGraphRankControl(queryEmbedding, uniquePaths, control, profile.dimensions);
    const requestKey = graphRequestKey(control.requestId, control.runEpoch);
    checkGraphRankCheckpoint(requestKey, control);
    const actualSourceEpoch = String(getChunkMutationEpoch());
    if (actualSourceEpoch !== control.sourceEpoch) {
        throw createWorkerError("graph-rank-source-epoch-mismatch", "Graph candidate source generation changed before ranking.");
    }
    if (uniquePaths.length === 0) {
        return {
            requestId: control.requestId,
            runEpoch: control.runEpoch,
            sourceEpoch: actualSourceEpoch,
            paths: [],
            diagnostics: {
                batchCount: 0,
                chunkCount: 0,
                workerDurationMs: Math.max(0, Date.now() - workerStartedAt),
                maxBatchDurationMs: 0,
            },
        };
    }

    const database = requireDb();
    const pathBatches = partition(uniquePaths, control.maxPathsPerBatch);
    let batchCount = 0;
    let maxBatchDurationMs = 0;
    const expectedChunksByPath = new Map<string, number>();
    let totalChunks = 0;

    // Preflight the complete request before materializing any embedding rows.
    for (const pathBatch of pathBatches) {
        const batchStartedAt = Date.now();
        checkGraphRankCheckpoint(requestKey, control);
        const placeholders = pathBatch.map(() => "?").join(",");
        const counts: Array<Record<string, unknown>> = [];
        database.exec({
            sql: `
                SELECT path, COUNT(*) AS chunk_count
                FROM vss_chunks
                WHERE path IN (${placeholders})
                GROUP BY path
                ORDER BY path
            `,
            bind: pathBatch,
            rowMode: "object",
            resultRows: counts,
        });
        for (const row of counts) {
            const path = primitiveString(row.path);
            const count = Number(row.chunk_count ?? 0);
            if (!pathBatch.includes(path) || !Number.isInteger(count) || count <= 0) {
                throw createWorkerError("graph-rank-path-mismatch", "Graph candidate path count is invalid.");
            }
            expectedChunksByPath.set(path, count);
            totalChunks += count;
            if (totalChunks > control.maxChunksScanned) {
                throw createWorkerError("graph-rank-budget-exceeded", "Graph candidate rows exceed the request envelope.");
            }
        }
        if (pathBatch.some((path) => !expectedChunksByPath.has(path))) {
            throw createWorkerError("graph-rank-path-mismatch", "An allowed graph candidate is missing from the local index.");
        }
        batchCount += 1;
        maxBatchDurationMs = Math.max(maxBatchDurationMs, Date.now() - batchStartedAt);
        await nextWorkerMessageTask();
    }

    checkGraphRankCheckpoint(requestKey, control);
    if (String(getChunkMutationEpoch()) !== actualSourceEpoch) {
        throw createWorkerError("graph-rank-source-epoch-mismatch", "Graph candidate source generation changed during preflight.");
    }

    // Legacy generation repair may hash the complete ordered inventory. Run
    // it only after the whole graph request has passed the row-count envelope.
    const pathEvidence = await getPathEvidenceGenerations(
        uniquePaths,
        control.maxPathsPerBatch,
        control.maxChunksScanned,
        {
            checkpoint: () => checkGraphRankCheckpoint(requestKey, control),
            onBatchComplete: (durationMs) => {
                batchCount += 1;
                maxBatchDurationMs = Math.max(maxBatchDurationMs, durationMs);
            },
        },
    );
    if (
        pathEvidence.sourceEpoch !== actualSourceEpoch
        || pathEvidence.paths.length !== uniquePaths.length
        || pathEvidence.paths.some((entry, index) => entry.path !== uniquePaths[index])
    ) {
        throw createWorkerError(
            "graph-rank-path-evidence-unavailable",
            "Graph candidate path evidence generation is incomplete or stale.",
        );
    }
    const generationByPath = new Map(pathEvidence.paths.map((entry) => [entry.path, entry.generation]));

    const queryVector = new Float32Array(queryEmbedding);
    const chunksByPath = new Map<string, RankedPathChunk[]>();
    const observedChunksByPath = new Map<string, number>();
    for (const pathBatch of pathBatches) {
        const placeholders = pathBatch.map(() => "?").join(",");
        let afterRowId = 0;
        while (true) {
            const batchStartedAt = Date.now();
            checkGraphRankCheckpoint(requestKey, control);
            const rows: Array<Record<string, unknown>> = [];
            database.exec({
                sql: `
                    SELECT id, path, chunk_index, content, metadata, embedding
                    FROM vss_chunks
                    WHERE path IN (${placeholders}) AND id > ?
                    ORDER BY id
                    LIMIT ?
                `,
                bind: [...pathBatch, afterRowId, GRAPH_RANK_COSINE_BLOCK_SIZE],
                rowMode: "object",
                resultRows: rows,
            });
            if (rows.length === 0) {
                batchCount += 1;
                maxBatchDurationMs = Math.max(maxBatchDurationMs, Date.now() - batchStartedAt);
                break;
            }

            for (const row of rows) {
                checkGraphRankCheckpoint(requestKey, control);
                const id = Number(row.id);
                const path = primitiveString(row.path);
                const chunkIndex = Number(row.chunk_index);
                if (
                    !Number.isInteger(id)
                    || id <= afterRowId
                    || !pathBatch.includes(path)
                    || !Number.isInteger(chunkIndex)
                ) {
                    throw createWorkerError("graph-rank-result-invalid", "Graph candidate row is malformed.");
                }
                afterRowId = id;
                const vector = float32View(row.embedding);
                if (vector.length !== profile.dimensions) {
                    throw createWorkerError("graph-rank-embedding-invalid", "Graph candidate embedding dimensions do not match the active profile.");
                }
                const score = scoreFromDistance(cosineDistance(queryVector, vector), "COSINE");
                if (!Number.isFinite(score)) {
                    throw createWorkerError("graph-rank-score-invalid", "Graph candidate cosine score is invalid.");
                }
                const metadata = parseMetadata(row.metadata);
                const pathEvidenceGeneration = generationByPath.get(path);
                if (!pathEvidenceGeneration) {
                    throw createWorkerError("graph-rank-path-evidence-unavailable", "Graph candidate path evidence is unavailable.");
                }
                const candidate: RankedPathChunk = {
                    chunkIndex,
                    score,
                    doc: {
                        pageContent: primitiveString(row.content),
                        metadata: {
                            ...metadata,
                            path,
                            chunkIndex,
                            pathEvidenceGeneration,
                        },
                    },
                };
                const ranked = chunksByPath.get(path) ?? [];
                ranked.push(candidate);
                ranked.sort(compareRankedPathChunk);
                if (ranked.length > 3) ranked.length = 3;
                chunksByPath.set(path, ranked);
                observedChunksByPath.set(path, (observedChunksByPath.get(path) ?? 0) + 1);
            }
            batchCount += 1;
            maxBatchDurationMs = Math.max(maxBatchDurationMs, Date.now() - batchStartedAt);
            await nextWorkerMessageTask();
        }
    }

    checkGraphRankCheckpoint(requestKey, control);
    if (String(getChunkMutationEpoch()) !== actualSourceEpoch) {
        throw createWorkerError("graph-rank-source-epoch-mismatch", "Graph candidate source generation changed during ranking.");
    }
    for (const path of uniquePaths) {
        if (observedChunksByPath.get(path) !== expectedChunksByPath.get(path)) {
            throw createWorkerError("graph-rank-source-changed", "Graph candidate rows changed after preflight.");
        }
    }
    return {
        requestId: control.requestId,
        runEpoch: control.runEpoch,
        sourceEpoch: actualSourceEpoch,
        paths: uniquePaths.map((path) => {
            const chunks = chunksByPath.get(path) ?? [];
            if (chunks.length === 0) {
                throw createWorkerError("graph-rank-path-mismatch", "Graph candidate produced no ranked chunks.");
            }
            return {
                path,
                pathEvidenceGeneration: generationByPath.get(path)!,
                maxScore: chunks[0].score,
                chunks,
            };
        }),
        diagnostics: {
            batchCount,
            chunkCount: totalChunks,
            workerDurationMs: Math.max(0, Date.now() - workerStartedAt),
            maxBatchDurationMs,
        },
    };
}

function validateGraphRankControl(
    queryEmbedding: readonly number[],
    paths: readonly string[],
    control: RankedPathRequestControl,
    expectedDimensions: number,
): void {
    if (!control.requestId || !control.runEpoch || !control.sourceEpoch) {
        throw createWorkerError("graph-rank-control-invalid", "Graph candidate ranking control is incomplete.");
    }
    if (
        queryEmbedding.length !== expectedDimensions
        || queryEmbedding.some((value) => !Number.isFinite(value))
    ) {
        throw createWorkerError("graph-rank-embedding-invalid", "Graph candidate ranking query embedding is invalid.");
    }
    if (
        !Number.isInteger(control.maxPathsPerBatch)
        || control.maxPathsPerBatch <= 0
        || control.maxPathsPerBatch > GRAPH_RANK_HARD_MAX_PATHS_PER_BATCH
        || !Number.isInteger(control.maxCandidatePaths)
        || control.maxCandidatePaths <= 0
        || control.maxCandidatePaths > GRAPH_RANK_HARD_MAX_PATHS
        || paths.length > control.maxCandidatePaths
        || !Number.isInteger(control.maxChunksScanned)
        || control.maxChunksScanned <= 0
        || !Number.isFinite(control.absoluteDeadlineMs)
    ) {
        throw createWorkerError("graph-rank-budget-invalid", "Graph candidate ranking request exceeds hard bounds.");
    }
}

function checkGraphRankCheckpoint(requestKey: string, control: RankedPathRequestControl): void {
    if (cancelledGraphRequests.has(requestKey)) {
        throw createWorkerError("graph-rank-aborted", "Graph candidate ranking was cancelled.");
    }
    if (Date.now() >= control.absoluteDeadlineMs) {
        throw createWorkerError("graph-rank-deadline", "Graph candidate ranking exceeded its absolute deadline.");
    }
}

function float32View(value: unknown): Float32Array {
    if (value instanceof Float32Array) return value;
    if (value instanceof Uint8Array) {
        if (value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
            throw createWorkerError("graph-rank-embedding-invalid", "Graph candidate embedding blob is malformed.");
        }
        return new Float32Array(value.buffer, value.byteOffset, value.byteLength / Float32Array.BYTES_PER_ELEMENT);
    }
    if (value instanceof ArrayBuffer) return new Float32Array(value);
    throw createWorkerError("graph-rank-embedding-invalid", "Graph candidate embedding blob is unavailable.");
}

function compareRankedPathChunk(left: RankedPathChunk, right: RankedPathChunk): number {
    return right.score - left.score || left.chunkIndex - right.chunkIndex;
}

function partition<T>(values: readonly T[], size: number): T[][] {
    const result: T[][] = [];
    for (let offset = 0; offset < values.length; offset += size) {
        result.push(values.slice(offset, offset + size));
    }
    return result;
}

function nextWorkerMessageTask(): Promise<void> {
    return new Promise((resolve) => {
        // Worker control messages and MessagePort messages share the posted-message
        // task source. A cancel already queued by the Host therefore runs before
        // this continuation, unlike a timer task whose cross-source order is not
        // defined. Close the one-shot channel so repeated batches do not retain
        // Worker resources.
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}

function graphRequestKey(requestId: string, runEpoch: string): string {
    return `${runEpoch}\u0000${requestId}`;
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function searchHybrid(
    queryEmbedding: number[],
    ftsQuery: string | null,
    k: number,
    fusionTopK: number,
    temporalFilter?: { since?: number; until?: number },
    lexicalSkipReason?: string,
    lexicalBoundaryFingerprint?: string,
    lexicalBudget?: LexicalSearchBudget,
    excludedPathGenerations?: PathEvidenceGenerationRef[],
    retrievalInput?: RetrievalSearchRuntimeParameters,
): VectorHybridSearchResult {
    const profile = activeProfile;
    if (!profile) {
        throw createWorkerError("profile-missing", "SQLite vector index has no active embedding profile.");
    }

    const startedAt = performance.now();
    const database = requireDb();
    const excludedPaths = resolveUnchangedExcludedPaths(excludedPathGenerations ?? []);
    const retrieval = resolveRetrievalSearchRuntimeParameters(retrievalInput, k, fusionTopK);

    // Vector leg — brute-force
    const cache = getVectorCacheForTemporalFilter(temporalFilter, excludedPaths);
    const queryVec = new Float32Array(queryEmbedding);
    const topK = bruteForceTopK(queryVec, cache, retrieval.vectorRaw, profile.distanceMetric);

    const requestedVectorIds = topK.map((r) => r.id);
    const vectorPlaceholders = requestedVectorIds.map(() => "?").join(",");
    const vectorRows: Array<Record<string, unknown>> = [];
    if (requestedVectorIds.length > 0) {
        const temporalClause = buildTemporalWhereClause("c.last_modified", temporalFilter);
        database.exec({
            sql: `
                SELECT c.id, c.path, c.chunk_index, c.content, c.metadata, f.evidence_generation
                FROM vss_chunks AS c
                INNER JOIN vss_files AS f ON f.path = c.path
                WHERE c.id IN (${vectorPlaceholders})${temporalClause.sql}
            `,
            bind: [...requestedVectorIds, ...temporalClause.bind],
            rowMode: "object",
            resultRows: vectorRows,
        });
    }

    // Lexical leg (skip honestly when profile/query/budget is unavailable).
    // The Host timestamp starts after provider inputs settle and includes the
    // remaining local/VSS/index queue wait. The SQLite progress handler makes
    // the synchronous MATCH query itself interruptible.
    const budgetStartedAtMs = lexicalBudget?.startedAtMs ?? Date.now();
    const deadlineAtMs = lexicalBudget?.deadlineAtMs
        ?? budgetStartedAtMs + RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.searchBudgetMs;
    const ftsRows: Array<Record<string, unknown>> = [];
    let lexicalAttempted = false;
    let lexicalReason: string | undefined;
    let lexicalDurationMs: number | undefined;
    let lexicalResultState = lexicalProfileState;
    if (lexicalSkipReason) {
        lexicalReason = lexicalSkipReason;
        lexicalResultState = lexicalSkipReason === "feature_disabled" ? "unavailable" : lexicalProfileState;
    } else if (lexicalProfileState !== "ready" || !lexicalProfileMarker) {
        lexicalReason = lexicalFailureReason ?? lexicalProfileState;
    } else if (
        !lexicalBoundaryFingerprint
        || lexicalProfileMarker.scopeFingerprint !== lexicalBoundaryFingerprint
    ) {
        lexicalReason = "scope_changed";
        lexicalResultState = "stale";
    } else if (!ftsQuery) {
        lexicalReason = "query_empty";
    } else if (Date.now() >= deadlineAtMs) {
        lexicalReason = "not_started_budget";
    } else {
        lexicalAttempted = true;
        const ftsTemporalClause = buildTemporalWhereClause("c.last_modified", temporalFilter);
        const lexicalTable = getLexicalTableName(lexicalProfileMarker.generation);
        try {
            runWithSqliteDeadline(database, deadlineAtMs, () => {
                database.exec({
                    sql: `
                        SELECT c.id, c.path, c.chunk_index, c.content, c.metadata, f.evidence_generation
                        FROM ${lexicalTable}
                        JOIN vss_chunks AS c ON c.id = ${lexicalTable}.rowid
                        JOIN vss_files AS f ON f.path = c.path
                        WHERE ${lexicalTable} MATCH ?
                        ${excludedPaths.size > 0 ? `AND c.path NOT IN (${[...excludedPaths].map(() => "?").join(",")})` : ""}
                        ${ftsTemporalClause.sql}
                        ORDER BY bm25(${lexicalTable}, ${retrieval.bm25Weights.join(", ")}), c.path, c.chunk_index
                        LIMIT ?
                    `,
                    bind: [ftsQuery, ...excludedPaths, ...ftsTemporalClause.bind, retrieval.lexicalRaw],
                    rowMode: "object",
                    resultRows: ftsRows,
                });
            });
        } catch (error) {
            ftsRows.length = 0;
            const errorCode = getErrorCode(error);
            lexicalReason = errorCode === "lexical-search-deadline"
                ? "execution_deadline"
                : errorCode === "lexical-deadline-control-unavailable"
                    ? "deadline_control_unavailable"
                    : "execution_error";
            if (lexicalReason === "execution_error" && (!(error instanceof Error) || !error.message.includes("fts5"))) {
                console.warn("[vss-worker] FTS search error:", error);
            }
        } finally {
            lexicalDurationMs = Date.now() - budgetStartedAtMs;
        }
    }
    if (!lexicalAttempted) {
        lexicalDurationMs = Date.now() - budgetStartedAtMs;
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

    const fusedScores = fuseRRF([vectorIds, ftsIds], retrieval.fusionRaw, retrieval.rrf);

    lastSearchDurationMs = performance.now() - startedAt;
    const results = [...fusedScores.entries()].flatMap(([id, score]) => {
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
                    pathEvidenceGeneration: primitiveString(row.evidence_generation),
                },
            },
        }];
    });
    return {
        results,
        sourceEpoch: String(getChunkMutationEpoch()),
        lexical: {
            attempted: lexicalAttempted,
            state: lexicalResultState,
            reason: lexicalReason,
            durationMs: lexicalDurationMs,
            matchedRows: lexicalAttempted ? ftsRows.length : undefined,
        },
    };
}

function resolveRetrievalSearchRuntimeParameters(
    input: RetrievalSearchRuntimeParameters | undefined,
    legacyVectorRaw: number,
    legacyFusionRaw: number,
): RetrievalSearchRuntimeParameters {
    if (input) {
        if (!isValidRetrievalSearchRuntimeParameters(input)) {
            throw createWorkerError(
                "retrieval-calibration-invalid",
                "Hybrid search received invalid versioned retrieval parameters.",
            );
        }
        if (input.vectorRaw !== legacyVectorRaw || input.fusionRaw !== legacyFusionRaw) {
            throw createWorkerError(
                "retrieval-calibration-alias-mismatch",
                "Hybrid search legacy aliases do not match versioned retrieval parameters.",
            );
        }
        return input;
    }

    const baseline = RETRIEVAL_CALIBRATION_PROFILE.baseline.standard;
    return {
        ...baseline,
        vectorRaw: legacyVectorRaw,
        lexicalRaw: legacyVectorRaw,
        fusionRaw: legacyFusionRaw,
    };
}

function runWithSqliteDeadline(
    database: SQLiteDatabase,
    deadlineAtMs: number,
    operation: () => void,
): void {
    const progressHandler = sqlite3?.capi?.sqlite3_progress_handler;
    if (!progressHandler) {
        throw createWorkerError(
            "lexical-deadline-control-unavailable",
            "SQLite progress deadline control is unavailable.",
        );
    }
    let deadlineExceeded = false;
    progressHandler(database, RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.sqliteProgressOperationInterval, () => {
        deadlineExceeded = Date.now() >= deadlineAtMs;
        return deadlineExceeded ? 1 : 0;
    }, 0);
    try {
        operation();
        if (Date.now() >= deadlineAtMs) deadlineExceeded = true;
        if (deadlineExceeded) {
            throw createWorkerError("lexical-search-deadline", "Lexical search exceeded its absolute deadline.");
        }
    } catch (error) {
        if (deadlineExceeded || Date.now() >= deadlineAtMs) {
            throw createWorkerError("lexical-search-deadline", "Lexical search exceeded its absolute deadline.");
        }
        throw error;
    } finally {
        progressHandler(database, 0, 0, 0);
    }
}

function getVectorCacheForTemporalFilter(
    temporalFilter?: { since?: number; until?: number },
    excludedPaths: ReadonlySet<string> = new Set(),
): Map<number, Float32Array> {
    const cache = getOrLoadVectorCache();
    const temporalClause = buildTemporalWhereClause("last_modified", temporalFilter);
    if (!temporalClause.sql && excludedPaths.size === 0) return cache;

    const rows: Array<Record<string, unknown>> = [];
    requireDb().exec({
        sql: `
            SELECT id FROM vss_chunks
            WHERE 1=1${temporalClause.sql}
            ${excludedPaths.size > 0 ? `AND path NOT IN (${[...excludedPaths].map(() => "?").join(",")})` : ""}
        `,
        bind: [...temporalClause.bind, ...excludedPaths],
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

function resolveUnchangedExcludedPaths(
    exclusions: readonly PathEvidenceGenerationRef[],
): Set<string> {
    if (exclusions.length === 0) return new Set();
    if (exclusions.length > 36) {
        throw createWorkerError("path-evidence-exclusion-budget", "Path evidence exclusion exceeds the bounded recovery ledger.");
    }
    const expected = new Map<string, string>();
    for (const exclusion of exclusions) {
        if (!exclusion.path || !exclusion.generation || expected.has(exclusion.path)) {
            throw createWorkerError("path-evidence-exclusion-invalid", "Path evidence exclusion is malformed.");
        }
        expected.set(exclusion.path, exclusion.generation);
    }
    // Recovery exclusions were previously sealed with a canonical generation;
    // they never need to trigger legacy inventory repair inside hybrid search.
    const actual = readPathEvidenceGenerations([...expected.keys()], 36);
    const excluded = new Set<string>();
    for (const record of actual.paths) {
        if (expected.get(record.path) === record.generation) excluded.add(record.path);
    }
    return excluded;
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
        databaseInstanceId: getMeta(INDEX_META_DATABASE_INSTANCE_ID) ?? undefined,
        chunkMutationEpoch: getChunkMutationEpoch(),
        indexMutationEpoch: getPersistedEpoch(INDEX_META_MUTATION_EPOCH),
        rebuildEpoch: getPersistedEpoch(INDEX_META_REBUILD_EPOCH),
        lexicalMaintenanceEpoch: getPersistedEpoch(INDEX_META_LEXICAL_MAINTENANCE_EPOCH),
        lexicalIncrementalMaintenanceEpoch: getPersistedEpoch(INDEX_META_LEXICAL_INCREMENTAL_MAINTENANCE_EPOCH),
        lastLexicalMaintenanceKind: getMeta(INDEX_META_LAST_LEXICAL_MAINTENANCE_KIND) ?? undefined,
        lastLexicalMaintenanceOperationId: getMeta(INDEX_META_LAST_LEXICAL_MAINTENANCE_OPERATION_ID) ?? undefined,
        lexicalProfileState,
        lexicalProfileId: lexicalProfileMarker?.profileId,
        lexicalGeneration: lexicalProfileMarker?.generation,
        lexicalFallbackReason: lexicalFailureReason,
    };
}

function reset(): void {
    const database = requireDb();
    const previousMemoryState = {
        vectorCache,
        lexicalRebuildContext,
        lexicalProfileMarker,
        lexicalProfileState,
        lexicalFailureReason,
        status,
        lastErrorCode,
    };
    const previousIndexMutationEpoch = getPersistedEpoch(INDEX_META_MUTATION_EPOCH);
    const previousRebuildEpoch = getPersistedEpoch(INDEX_META_REBUILD_EPOCH);
    const previousLexicalMaintenanceEpoch = getPersistedEpoch(INDEX_META_LEXICAL_MAINTENANCE_EPOCH);
    const previousLexicalIncrementalMaintenanceEpoch = getPersistedEpoch(
        INDEX_META_LEXICAL_INCREMENTAL_MAINTENANCE_EPOCH,
    );
    const nextDatabaseInstanceId = createDatabaseInstanceId();
    database.exec("BEGIN IMMEDIATE");
    try {
        lexicalRebuildContext = null;
        lexicalProfileMarker = null;
        lexicalProfileState = "unavailable";
        lexicalFailureReason = undefined;
        database.exec(`
            DROP TABLE IF EXISTS vss_char_phrase_canary_vocab;
            DROP TABLE IF EXISTS vss_char_phrase_canary;
            DROP TABLE IF EXISTS vss_chunks_lexical_0;
            DROP TABLE IF EXISTS vss_chunks_lexical_1;
            DROP TABLE IF EXISTS vss_chunks_fts;
            DROP TABLE IF EXISTS vss_chunks;
            DROP TABLE IF EXISTS vss_files;
            DROP TABLE IF EXISTS vss_meta;
        `);
        createSchema(database);
        initializeContinuityMetadata({
            databaseInstanceId: nextDatabaseInstanceId,
            indexMutationEpoch: previousIndexMutationEpoch + 1,
            rebuildEpoch: previousRebuildEpoch + 1,
            lexicalMaintenanceEpoch: previousLexicalMaintenanceEpoch,
            lexicalIncrementalMaintenanceEpoch: previousLexicalIncrementalMaintenanceEpoch,
        });
        if (activeProfile) {
            setMeta("schemaVersion", String(VSS_SCHEMA_VERSION));
            setMeta("profileSignature", getEmbeddingProfileSignature(activeProfile));
            setMeta("backend", "sqlite-wasm-opfs-sahpool");
            initializeVectorColumn(activeProfile);
            initializeLexicalState(database, true);
        }
        database.exec("COMMIT");
    } catch (error) {
        try {
            database.exec("ROLLBACK");
        } catch (rollbackError) {
            const resetRollbackError = createWorkerError(
                "reset-rollback-failed",
                `SQLite reset failed (${stringifyError(error)}) and rollback was unavailable: ${stringifyError(rollbackError)}`,
            );
            // A failed rollback leaves the connection's contents unknowable. Publish the
            // canonical failure before any cleanup that can itself throw, then permanently
            // detach this worker from the suspect connection and its cached state.
            status = "error";
            lastErrorCode = "reset-rollback-failed";
            disposed = true;
            vectorCache = null;
            pendingGraphRequests.clear();
            cancelledGraphRequests.clear();
            lexicalRebuildContext = null;
            lexicalProfileMarker = null;
            lexicalProfileState = "failed";
            lexicalFailureReason = "reset-rollback-failed";
            const pool = activePool;
            db = null;
            activePool = null;
            try {
                database.close();
            } catch (closeError) {
                try {
                    console.warn("[vss-worker] Failed to close SQLite after reset rollback failure", {
                        errorType: closeError instanceof Error ? closeError.name : "unknown",
                        code: getErrorCode(closeError),
                    });
                } catch {
                    // Cleanup diagnostics must never replace the canonical reset failure.
                }
            }
            try {
                pausePool(pool);
            } catch {
                // Pool cleanup is best-effort after the worker has failed closed.
            }
            throw resetRollbackError;
        }
        ({
            vectorCache,
            lexicalRebuildContext,
            lexicalProfileMarker,
            lexicalProfileState,
            lexicalFailureReason,
            status,
            lastErrorCode,
        } = previousMemoryState);
        throw error;
    }
    vectorCache = null;
    status = activeProfile ? "ready" : "uninitialized";
    lastErrorCode = undefined;
}

function dispose(): void {
    vectorCache = null;
    pendingGraphRequests.clear();
    cancelledGraphRequests.clear();
    lexicalRebuildContext = null;
    lexicalProfileMarker = null;
    lexicalProfileState = "unavailable";
    lexicalFailureReason = "disposed";
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

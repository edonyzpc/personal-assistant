import type {
    EmbeddingProfile,
    LexicalIncrementalMaintenanceReceipt,
    LexicalIndexStatus,
    LexicalRebuildFinalizeReceiptResult,
    LexicalSearchBudget,
    LexicalRebuildBatchResult,
    LexicalRebuildScopeBatchResult,
    LexicalRebuildStartResult,
    IndexedPathEvidenceGenerationResult,
    PathEvidenceGenerationRef,
    RankGraphCandidatesOptions,
    RankedPathRequestControl,
    RankedPathRequestResult,
    VectorIndex,
    VectorIndexPathLookupOptions,
    VectorIndexStatus,
    VectorSearchResult,
    VectorHybridSearchResult,
    VectorHybridSearchOptions,
    VSSChunk,
    VSSFileRecord,
    VSSFileState,
    VSSIndexStats,
    VectorIndexDeleteOptions,
} from "./types";
import type {
    SqliteWorkerControlMessage,
    SqliteWorkerRequest,
    SqliteWorkerResponse,
} from "./sqlite-worker-protocol";
import { toError } from "../error-utils";
import { createAbortError } from "../ai-services/chat-utils";
import { clearPlatformTimeout, decodePlatformBase64, getPlatformLocation, setPlatformTimeout } from "../platform-dom";
import {
    RETRIEVAL_CALIBRATION_PROFILE,
    type RetrievalSearchRuntimeParameters,
} from "./retrieval-calibration";

const SQLITE_DISPOSE_WORKER_READY_TIMEOUT_MS = 2_000;
const SQLITE_DISPOSE_MESSAGE_TIMEOUT_MS = 2_000;
const SQLITE_SEND_TIMEOUT_MS = 60_000;

export interface SqliteVectorIndexOptions {
    workerUrl: string;
    databaseName?: string;
    opfsDirectory?: string;
    legacyOpfsDirectory?: string;
    opfsVfsName?: string;
    wasmUrl?: string;
    workerFactory?: (url: string) => Worker | Promise<Worker>;
    lexicalProfileEnabled?: boolean;
    lexicalBoundaryFingerprint?: string;
}

export class SqliteVectorIndex implements VectorIndex {
    private readonly workerUrl: string;
    private readonly databaseName: string;
    private readonly opfsDirectory: string | undefined;
    private readonly legacyOpfsDirectory: string | undefined;
    private readonly opfsVfsName: string | undefined;
    private readonly wasmUrl: string | undefined;
    private readonly workerFactory: ((url: string) => Worker | Promise<Worker>) | undefined;
    private readonly lexicalProfileEnabled: boolean;
    private readonly lexicalBoundaryFingerprint: string | undefined;
    private worker: Worker | null = null;
    private workerReady: Promise<Worker> | null = null;
    private readonly terminatedWorkers = new WeakSet<Worker>();
    private readonly objectUrls: string[] = [];
    private nextId = 1;
    private queue: Promise<void> = Promise.resolve();
    private disposed = false;
    private disposePromise: Promise<void> | null = null;
    private readonly activeGraphRequests = new Set<string>();
    private readonly cancelledGraphRequests = new Set<string>();
    private pending = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
    }>();
    private lastInitializePayload: object | null = null;
    private workerInitialized = false;
    private hasEverInitialized = false;

    constructor(options: SqliteVectorIndexOptions) {
        this.workerUrl = options.workerUrl;
        this.databaseName = options.databaseName ?? "personal-assistant-vss.sqlite3";
        this.opfsDirectory = options.opfsDirectory;
        this.legacyOpfsDirectory = options.legacyOpfsDirectory;
        this.opfsVfsName = options.opfsVfsName;
        this.wasmUrl = options.wasmUrl;
        this.workerFactory = options.workerFactory;
        this.lexicalProfileEnabled = options.lexicalProfileEnabled === true;
        this.lexicalBoundaryFingerprint = options.lexicalBoundaryFingerprint;
    }

    async initialize(profile: EmbeddingProfile): Promise<VectorIndexStatus> {
        this.assertActive();
        const wasmUrl = await this.prepareWasmUrl();
        this.assertActive();
        const payload = {
            profile,
            databaseName: this.databaseName,
            opfsDirectory: this.opfsDirectory,
            legacyOpfsDirectory: this.legacyOpfsDirectory,
            opfsVfsName: this.opfsVfsName,
            wasmUrl,
            lexicalProfileEnabled: this.lexicalProfileEnabled,
            lexicalBoundaryFingerprint: this.lexicalBoundaryFingerprint,
        };
        this.lastInitializePayload = payload;
        return this.enqueue(async () => {
            const result = await this.send<VectorIndexStatus>("initialize", payload);
            this.workerInitialized = true;
            this.hasEverInitialized = true;
            return result;
        });
    }

    upsertFile(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]): Promise<void> {
        return this.enqueue(() => this.send<null>("upsertFile", { fileState, chunks, embeddings }).then(() => undefined));
    }

    updateFileMetadata(fileState: VSSFileState): Promise<void> {
        return this.enqueue(() => this.send<null>("updateFileMetadata", { fileState }).then(() => undefined));
    }

    deleteFile(path: string, options?: VectorIndexDeleteOptions): Promise<void> {
        return this.enqueue(() => this.send<null>("deleteFile", { path, options }).then(() => undefined));
    }

    listFilePaths(): Promise<string[]> {
        return this.enqueue(() => this.send<string[]>("listFilePaths", {}));
    }

    listFileRecords(): Promise<VSSFileRecord[]> {
        return this.enqueue(() => this.send<VSSFileRecord[]>("listFileRecords", {}));
    }

    search(queryEmbedding: number[], k: number): Promise<VectorSearchResult[]> {
        return this.enqueue(() => this.send<VectorSearchResult[]>("search", { queryEmbedding, k }));
    }

    getChunksByPath(paths: string[], options: VectorIndexPathLookupOptions = {}): Promise<VectorSearchResult[]> {
        return this.enqueue(() => this.send<VectorSearchResult[]>("getChunksByPath", {
            paths,
            limitPerPath: options.limitPerPath,
        }));
    }

    searchHybrid(
        queryEmbedding: number[],
        ftsQuery: string | null,
        k: number,
        fusionTopK: number,
        temporalFilter?: { since?: number; until?: number },
        lexicalSkipReason?: string,
        lexicalBoundaryFingerprint?: string,
        lexicalBudget?: LexicalSearchBudget,
        excludedPathGenerations?: PathEvidenceGenerationRef[],
        retrieval?: RetrievalSearchRuntimeParameters,
        options: VectorHybridSearchOptions = {},
    ): Promise<VectorSearchResult[]> {
        return this.searchHybridDetailed(
            queryEmbedding,
            ftsQuery,
            k,
            fusionTopK,
            temporalFilter,
            lexicalSkipReason,
            lexicalBoundaryFingerprint,
            lexicalBudget,
            excludedPathGenerations,
            retrieval,
            options,
        )
            .then((result) => result.results);
    }

    searchHybridDetailed(
        queryEmbedding: number[],
        ftsQuery: string | null,
        k: number,
        fusionTopK: number,
        temporalFilter?: { since?: number; until?: number },
        lexicalSkipReason?: string,
        lexicalBoundaryFingerprint?: string,
        lexicalBudget?: LexicalSearchBudget,
        excludedPathGenerations?: PathEvidenceGenerationRef[],
        retrieval?: RetrievalSearchRuntimeParameters,
        options: VectorHybridSearchOptions = {},
    ): Promise<VectorHybridSearchResult> {
        return this.enqueue(() => this.send<VectorHybridSearchResult>("searchHybrid", {
            queryEmbedding,
            ftsQuery,
            k,
            fusionTopK,
            temporalFilter,
            lexicalSkipReason,
            lexicalBoundaryFingerprint,
            lexicalBudget,
            excludedPathGenerations,
            ...(retrieval ? { retrieval } : {}),
        }, options.signal), options.signal);
    }

    getPathEvidenceGenerations(
        paths: string[],
        maxPathsPerBatch: number = RETRIEVAL_CALIBRATION_PROFILE.graph.maxPathsPerBatch,
        maxChunksScanned: number = RETRIEVAL_CALIBRATION_PROFILE.graph.maxChunksScanned,
    ): Promise<IndexedPathEvidenceGenerationResult> {
        return this.enqueue(() => this.send<IndexedPathEvidenceGenerationResult>("getPathEvidenceGenerations", {
            paths,
            maxPathsPerBatch,
            maxChunksScanned,
        }));
    }

    rankGraphCandidates(
        queryEmbedding: number[],
        paths: string[],
        control: RankedPathRequestControl,
        options: RankGraphCandidatesOptions = {},
    ): Promise<RankedPathRequestResult> {
        const uniquePaths = [...new Set(paths.filter(Boolean))].sort(compareCodePoint);
        assertGraphRankRequest(queryEmbedding, uniquePaths, control);
        if (options.signal?.aborted) {
            return Promise.reject(createVectorIndexError("graph-rank-aborted", "Graph candidate ranking was aborted."));
        }

        const requestKey = graphRequestKey(control.requestId, control.runEpoch);
        const queuedAt = Date.now();
        safeGraphDiagnostic(options, { state: "queued" });
        if (this.activeGraphRequests.has(requestKey)) {
            return Promise.reject(createVectorIndexError(
                "graph-rank-request-duplicate",
                "Graph candidate ranking request id is already active.",
            ));
        }
        this.activeGraphRequests.add(requestKey);
        let settle: {
            resolve: (value: RankedPathRequestResult) => void;
            reject: (reason?: unknown) => void;
        } | null = null;
        let callerSettled = false;
        const settleResolve = (value: RankedPathRequestResult) => {
            if (callerSettled) return;
            callerSettled = true;
            settle?.resolve(value);
        };
        const settleReject = (reason: unknown) => {
            if (callerSettled) return;
            callerSettled = true;
            settle?.reject(reason);
        };
        const onAbort = () => {
            safeGraphDiagnostic(options, { state: "cancel_requested", accepted: 0 });
            this.cancelGraphRank(control.requestId, control.runEpoch);
            settleReject(createVectorIndexError("graph-rank-aborted", "Graph candidate ranking was aborted."));
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });

        const queued = this.enqueue(async () => {
            const queueWaitMs = Math.max(0, Date.now() - queuedAt);
            safeGraphDiagnostic(options, { state: "dispatched", queueWaitMs });
            if (this.cancelledGraphRequests.has(requestKey) || options.signal?.aborted) {
                throw createVectorIndexError("graph-rank-aborted", "Graph candidate ranking was aborted.");
            }
            if (Date.now() >= control.absoluteDeadlineMs) {
                throw createVectorIndexError("graph-rank-deadline", "Graph candidate ranking deadline elapsed before dispatch.");
            }
            let workerResponseReceived = false;
            let result: RankedPathRequestResult;
            try {
                result = await this.send<RankedPathRequestResult>("rankGraphCandidates", {
                    queryEmbedding,
                    paths: uniquePaths,
                    control,
                });
                workerResponseReceived = true;
            } catch (error) {
                if (!workerResponseReceived && getVectorIndexErrorCode(error) === "graph-rank-aborted") {
                    safeGraphDiagnostic(options, { state: "cancel_observed", accepted: 0 });
                }
                throw error;
            }
            validateGraphRankResult(result, uniquePaths, control, this.cancelledGraphRequests.has(requestKey));
            return {
                ...result,
                diagnostics: {
                    batchCount: result.diagnostics?.batchCount ?? 0,
                    chunkCount: result.diagnostics?.chunkCount ?? 0,
                    workerDurationMs: result.diagnostics?.workerDurationMs ?? 0,
                    maxBatchDurationMs: result.diagnostics?.maxBatchDurationMs ?? 0,
                    queueWaitMs,
                },
            };
        });

        const cleanup = () => {
            options.signal?.removeEventListener("abort", onAbort);
            this.activeGraphRequests.delete(requestKey);
            this.cancelledGraphRequests.delete(requestKey);
        };
        queued.then(
            (value) => {
                cleanup();
                if (callerSettled) {
                    safeGraphDiagnostic(options, { state: "late_discarded", accepted: 0 });
                } else {
                    safeGraphDiagnostic(options, { state: "settled", queueWaitMs: value.diagnostics?.queueWaitMs, accepted: 1 });
                }
                settleResolve(value);
            },
            (error) => {
                cleanup();
                safeGraphDiagnostic(options, {
                    state: callerSettled ? "late_discarded" : "settled",
                    accepted: 0,
                });
                settleReject(error);
            },
        );
        return new Promise<RankedPathRequestResult>((resolve, reject) => {
            settle = { resolve, reject };
            if (callerSettled) {
                reject(createVectorIndexError("graph-rank-aborted", "Graph candidate ranking was aborted."));
            }
        });
    }

    /** Mark locally first, then post directly without entering the main data queue. */
    cancelGraphRank(requestId: string, runEpoch: string): void {
        const requestKey = graphRequestKey(requestId, runEpoch);
        if (
            !this.activeGraphRequests.has(requestKey)
            || this.cancelledGraphRequests.has(requestKey)
        ) return;
        this.cancelledGraphRequests.add(requestKey);
        const message: SqliteWorkerControlMessage = {
            type: "cancelGraphRank",
            payload: { requestId, runEpoch },
        };
        const post = (worker: Worker) => {
            if (
                this.disposed
                || this.worker !== worker
                || !this.activeGraphRequests.has(requestKey)
                || !this.cancelledGraphRequests.has(requestKey)
            ) return;
            try {
                worker.postMessage(message);
            } catch {
                // The data request will fail through the normal worker lifecycle.
            }
        };
        if (this.worker) {
            post(this.worker);
        } else if (this.workerReady) {
            void this.workerReady.then(post, () => undefined);
        }
    }

    getLexicalStatus(): Promise<LexicalIndexStatus> {
        return this.enqueue(() => this.send<LexicalIndexStatus>("getLexicalStatus", {}));
    }

    /** Diagnostics-only: rebuild one active lexical path from already-indexed chunks. */
    refreshLexicalPathFromIndexedChunks(
        path: string,
        lexicalBoundaryFingerprint: string,
    ): Promise<LexicalIncrementalMaintenanceReceipt> {
        return this.enqueue(() => this.send<LexicalIncrementalMaintenanceReceipt>(
            "refreshLexicalPathFromIndexedChunks",
            { path, lexicalBoundaryFingerprint },
        ));
    }

    beginLexicalRebuild(
        profileId: "char-phrase-v1",
        runtimeCanaryFingerprint: string,
        scopeFingerprint: string,
        expectedPathCount: number,
    ): Promise<LexicalRebuildStartResult> {
        return this.enqueue(() => this.send<LexicalRebuildStartResult>("beginLexicalRebuild", {
            profileId,
            runtimeCanaryFingerprint,
            scopeFingerprint,
            expectedPathCount,
        }));
    }

    beginLexicalRebuildWithReceipt(
        profileId: "char-phrase-v1",
        runtimeCanaryFingerprint: string,
        scopeFingerprint: string,
        expectedPathCount: number,
    ): Promise<LexicalRebuildStartResult> {
        return this.enqueue(() => this.send<LexicalRebuildStartResult>("beginLexicalRebuildWithReceipt", {
            profileId,
            runtimeCanaryFingerprint,
            scopeFingerprint,
            expectedPathCount,
        }));
    }

    appendLexicalScopeBatch(
        rebuildId: string,
        paths: string[],
    ): Promise<LexicalRebuildScopeBatchResult> {
        return this.enqueue(() => this.send<LexicalRebuildScopeBatchResult>("appendLexicalScopeBatch", {
            rebuildId,
            paths,
        }));
    }

    appendLexicalRebuildBatch(
        rebuildId: string,
        afterRowId: number,
        limit: number,
    ): Promise<LexicalRebuildBatchResult> {
        return this.enqueue(() => this.send<LexicalRebuildBatchResult>("appendLexicalRebuildBatch", {
            rebuildId,
            afterRowId,
            limit,
        }));
    }

    finalizeLexicalRebuild(rebuildId: string): Promise<LexicalIndexStatus> {
        return this.enqueue(() => this.send<LexicalIndexStatus>("finalizeLexicalRebuild", { rebuildId }));
    }

    finalizeLexicalRebuildWithReceipt(rebuildId: string): Promise<LexicalRebuildFinalizeReceiptResult> {
        return this.enqueue(() => this.send<LexicalRebuildFinalizeReceiptResult>(
            "finalizeLexicalRebuildWithReceipt",
            { rebuildId },
        ));
    }

    abortLexicalRebuild(rebuildId: string, failureReason?: string): Promise<LexicalIndexStatus> {
        return this.enqueue(() => this.send<LexicalIndexStatus>("abortLexicalRebuild", {
            rebuildId,
            failureReason,
        }));
    }

    getFileRecord(path: string): Promise<VSSFileRecord | null> {
        return this.enqueue(() => this.send<VSSFileRecord | null>("getFileRecord", { path }));
    }

    getStats(): Promise<VSSIndexStats> {
        return this.enqueue(() => this.send<VSSIndexStats>("getStats", {}));
    }

    verify(): Promise<VectorIndexStatus> {
        return this.enqueue(() => this.send<VectorIndexStatus>("verify", {}));
    }

    reset(): Promise<void> {
        return this.enqueue(() => this.send<null>("reset", {}).then(() => undefined));
    }

    clusterVectors(maxClusters: number): Promise<Array<{ clusterId: number; label: string; paths: string[] }>> {
        return this.enqueue(() => this.send<Array<{ clusterId: number; label: string; paths: string[] }>>("clusterVectors", { maxClusters }));
    }

    async dispose(): Promise<void> {
        this.disposePromise ??= this.disposeUnlocked();
        return this.disposePromise;
    }

    private enqueue<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (this.disposed) {
            return Promise.reject(createDisposedError());
        }
        if (signal?.aborted) {
            return Promise.reject(createAbortError());
        }
        const runOperation = () => {
            this.assertActive();
            if (signal?.aborted) throw createAbortError();
            return operation();
        };
        const run = this.queue.then(runOperation, runOperation);
        // Keep the serialized queue bound to the underlying Worker response.
        // Hybrid search has no Worker-side cancel message, so abort rejects the
        // caller immediately while a dispatched request drains in isolation.
        this.queue = run.then(() => undefined, () => undefined);
        return waitForAbortableQueueResult(run, signal);
    }

    private async send<T>(
        type: SqliteWorkerRequest["type"],
        payload: object,
        signal?: AbortSignal,
    ): Promise<T> {
        this.assertActive();
        if (signal?.aborted) throw createAbortError();
        const worker = await this.ensureWorker();
        this.assertActive();
        if (signal?.aborted) throw createAbortError();
        const id = this.nextId++;
        const request = { id, type, payload } as SqliteWorkerRequest;
        return new Promise<T>((resolve, reject) => {
            const timer = setPlatformTimeout(() => {
                if (!this.pending.has(id)) return;
                this.pending.delete(id);
                this.resetWorker(worker);
                reject(createVectorIndexError(
                    "sqlite-worker-timeout",
                    `Worker did not respond within ${SQLITE_SEND_TIMEOUT_MS}ms (possible background termination).`,
                ));
            }, SQLITE_SEND_TIMEOUT_MS);
            this.pending.set(id, {
                resolve: (value) => { clearPlatformTimeout(timer); resolve(value as T); },
                reject: (error) => { clearPlatformTimeout(timer); reject(error); },
            });
            try {
                worker.postMessage(request);
            } catch (error) {
                clearPlatformTimeout(timer);
                this.pending.delete(id);
                this.resetWorker(worker);
                reject(createVectorIndexError(
                    "sqlite-worker-post-message-failed",
                    error instanceof Error ? error.message : String(error),
                ));
            }
        });
    }

    private async disposeUnlocked(): Promise<void> {
        this.disposed = true;
        this.activeGraphRequests.clear();
        this.cancelledGraphRequests.clear();
        const disposedError = createDisposedError();
        this.rejectPending(disposedError);

        let worker = this.worker;
        if (!worker && this.workerReady) {
            const createdWorker = await withTimeout(this.workerReady, SQLITE_DISPOSE_WORKER_READY_TIMEOUT_MS).catch(() => null);
            if (createdWorker && this.worker === createdWorker) {
                worker = createdWorker;
            } else if (createdWorker) {
                this.resetWorker(createdWorker);
            }
        }

        if (worker) {
            await withTimeout(this.sendDisposeDirect(worker), SQLITE_DISPOSE_MESSAGE_TIMEOUT_MS).catch(() => undefined);
            this.resetWorker(worker);
        } else {
            this.resetWorker();
        }

        this.rejectPending(disposedError);
        this.revokeObjectUrls();
        this.queue = Promise.resolve();
    }

    private sendDisposeDirect(worker: Worker): Promise<void> {
        const id = this.nextId++;
        const request = { id, type: "dispose", payload: {} } as SqliteWorkerRequest;
        return new Promise<void>((resolve, reject) => {
            this.pending.set(id, {
                resolve: () => resolve(),
                reject,
            });
            try {
                worker.postMessage(request);
            } catch (error) {
                this.pending.delete(id);
                reject(createVectorIndexError(
                    "sqlite-worker-post-message-failed",
                    error instanceof Error ? error.message : String(error),
                ));
            }
        });
    }

    private async ensureWorker(): Promise<Worker> {
        this.assertActive();
        if (this.worker) return this.worker;
        if (this.workerReady) {
            const worker = await this.workerReady;
            this.assertActive();
            return worker;
        }
        if (typeof Worker === "undefined") {
            throw createVectorIndexError("sqlite-worker-unavailable", "Web Worker is not available in this environment.");
        }
        this.workerReady = this.createWorker(this.workerUrl);
        const worker = await this.workerReady;
        if (this.disposed) {
            this.resetWorker(worker);
            throw createDisposedError();
        }
        worker.onmessage = (event: MessageEvent<SqliteWorkerResponse>) => {
            const response = event.data;
            const pending = this.pending.get(response.id);
            if (!pending) return;
            this.pending.delete(response.id);
            if (response.ok) {
                pending.resolve(response.result);
            } else {
                pending.reject(createVectorIndexError(response.error.code, response.error.message));
            }
        };
        worker.onerror = (event) => {
            const detail = [
                event.message,
                event.filename,
                event.lineno ? `line ${event.lineno}` : "",
                event.colno ? `column ${event.colno}` : "",
            ].filter(Boolean).join(" ");
            const error = createVectorIndexError("sqlite-worker-error", detail || "SQLite worker failed.");
            for (const pending of this.pending.values()) {
                pending.reject(error);
            }
            this.pending.clear();
            this.resetWorker(worker);
        };
        this.worker = worker;
        if (this.hasEverInitialized && this.lastInitializePayload && !this.workerInitialized) {
            try {
                await this.send<unknown>("initialize", this.lastInitializePayload);
                this.workerInitialized = true;
            } catch {
                this.resetWorker(worker);
                throw createVectorIndexError(
                    "sqlite-worker-reinitialize-failed",
                    "Replacement Worker failed to initialize.",
                );
            }
        }
        return worker;
    }

    private resetWorker(worker?: Worker): void {
        if (worker && this.worker && this.worker !== worker) return;
        if (worker && !this.terminatedWorkers.has(worker)) {
            this.terminatedWorkers.add(worker);
            worker.terminate();
        }
        this.worker = null;
        this.workerReady = null;
        this.workerInitialized = false;
    }

    private rejectPending(error: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }

    private revokeObjectUrls(): void {
        for (const objectUrl of this.objectUrls) {
            URL.revokeObjectURL(objectUrl);
        }
        this.objectUrls.length = 0;
    }

    private assertActive(): void {
        if (this.disposed) {
            throw createDisposedError();
        }
    }

    private async createWorker(url: string): Promise<Worker> {
        this.assertActive();
        if (this.workerFactory) {
            return await this.workerFactory(url);
        }

        try {
            return new Worker(url, {
                type: "module",
                name: "personal-assistant-vss",
            });
        } catch (error) {
            if (!isSecurityError(error)) {
                throw error;
            }
        }

        if (!isDataUrl(url)) {
            throw createVectorIndexError(
                "sqlite-worker-url-unsupported",
                "SQLite worker fallback requires a local data URL when direct worker creation is blocked.",
            );
        }
        const blobUrl = this.createBlobUrlFromDataUrl(url, "text/javascript");
        this.trackObjectUrl(blobUrl);
        return new Worker(blobUrl, {
            type: "module",
            name: "personal-assistant-vss",
        });
    }

    private async prepareWasmUrl(): Promise<string | undefined> {
        this.assertActive();
        if (!this.wasmUrl) return undefined;
        if (isSameOriginUrl(this.wasmUrl)) return this.wasmUrl;
        if (isBlobUrl(this.wasmUrl)) return this.wasmUrl;
        if (!isDataUrl(this.wasmUrl)) {
            throw createVectorIndexError(
                "sqlite-asset-url-unsupported",
                "SQLite WASM loading only supports local data URLs when a blob URL is required.",
            );
        }
        const blobUrl = this.createBlobUrlFromDataUrl(this.wasmUrl, "application/wasm");
        this.trackObjectUrl(blobUrl);
        return blobUrl;
    }

    private createBlobUrlFromDataUrl(url: string, type: string): string {
        const blob = dataUrlToBlob(url, type);
        return URL.createObjectURL(blob);
    }

    private trackObjectUrl(objectUrl: string): void {
        if (this.disposed) {
            URL.revokeObjectURL(objectUrl);
            throw createDisposedError();
        }
        this.objectUrls.push(objectUrl);
    }
}

function safeGraphDiagnostic(
    options: RankGraphCandidatesOptions,
    event: Parameters<NonNullable<RankGraphCandidatesOptions["onDiagnostic"]>>[0],
): void {
    try {
        options.onDiagnostic?.(event);
    } catch {
        // Measurement must never alter index control flow.
    }
}

function getVectorIndexErrorCode(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
}

export function createVectorIndexError(code: string, message: string): Error {
    const error = new Error(message);
    (error as Error & { code: string }).code = code;
    return error;
}

function assertGraphRankRequest(
    queryEmbedding: readonly number[],
    paths: readonly string[],
    control: RankedPathRequestControl,
): void {
    if (
        !control.requestId
        || !control.runEpoch
        || !control.sourceEpoch
        || !Number.isFinite(control.absoluteDeadlineMs)
    ) {
        throw createVectorIndexError("graph-rank-control-invalid", "Graph candidate ranking control is incomplete.");
    }
    if (queryEmbedding.length === 0 || queryEmbedding.some((value) => !Number.isFinite(value))) {
        throw createVectorIndexError("graph-rank-embedding-invalid", "Graph candidate ranking requires a finite query embedding.");
    }
    if (
        !Number.isInteger(control.maxPathsPerBatch)
        || control.maxPathsPerBatch <= 0
        || !Number.isInteger(control.maxCandidatePaths)
        || control.maxCandidatePaths <= 0
        || !Number.isInteger(control.maxChunksScanned)
        || control.maxChunksScanned <= 0
        || paths.length > control.maxCandidatePaths
    ) {
        throw createVectorIndexError("graph-rank-budget-invalid", "Graph candidate ranking exceeds its request envelope.");
    }
}

function validateGraphRankResult(
    result: RankedPathRequestResult,
    requestedPaths: readonly string[],
    control: RankedPathRequestControl,
    cancelled: boolean,
): void {
    if (cancelled) {
        throw createVectorIndexError("graph-rank-aborted", "Discarded a graph candidate ranking result after cancellation.");
    }
    if (Date.now() >= control.absoluteDeadlineMs) {
        throw createVectorIndexError("graph-rank-deadline", "Discarded a graph candidate ranking result after its deadline.");
    }
    if (
        result.requestId !== control.requestId
        || result.runEpoch !== control.runEpoch
        || result.sourceEpoch !== control.sourceEpoch
    ) {
        throw createVectorIndexError("graph-rank-epoch-mismatch", "Graph candidate ranking result belongs to another invocation.");
    }
    const resultPaths = result.paths.map((entry) => entry.path);
    if (
        resultPaths.length !== requestedPaths.length
        || resultPaths.some((path, index) => path !== requestedPaths[index])
    ) {
        throw createVectorIndexError("graph-rank-path-mismatch", "Graph candidate ranking result does not match the allowed path set.");
    }
    for (const entry of result.paths) {
        if (
            !entry.pathEvidenceGeneration
            || !Number.isFinite(entry.maxScore)
            || entry.chunks.length === 0
            || entry.chunks.length > 3
        ) {
            throw createVectorIndexError("graph-rank-result-invalid", "Graph candidate ranking returned invalid path scores.");
        }
        for (let index = 0; index < entry.chunks.length; index += 1) {
            const chunk = entry.chunks[index];
            if (
                !Number.isInteger(chunk.chunkIndex)
                || !Number.isFinite(chunk.score)
                || chunk.doc.metadata?.path !== entry.path
                || Number(chunk.doc.metadata?.chunkIndex) !== chunk.chunkIndex
                || chunk.doc.metadata?.pathEvidenceGeneration !== entry.pathEvidenceGeneration
                || (index > 0 && compareRankedChunk(entry.chunks[index - 1], chunk) > 0)
            ) {
                throw createVectorIndexError("graph-rank-result-invalid", "Graph candidate ranking returned malformed chunks.");
            }
        }
    }
}

function compareRankedChunk(
    left: { score: number; chunkIndex: number },
    right: { score: number; chunkIndex: number },
): number {
    return right.score - left.score || left.chunkIndex - right.chunkIndex;
}

function graphRequestKey(requestId: string, runEpoch: string): string {
    return `${runEpoch}\u0000${requestId}`;
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function createDisposedError(): Error {
    return createVectorIndexError("sqlite-vector-index-disposed", "SQLite vector index has been disposed.");
}

function waitForAbortableQueueResult<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(createAbortError());
    return new Promise<T>((resolve, reject) => {
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        const onAbort = () => {
            cleanup();
            reject(createAbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
            onAbort();
            return;
        }
        promise.then(
            (value) => {
                cleanup();
                if (signal.aborted) {
                    reject(createAbortError());
                } else {
                    resolve(value);
                }
            },
            (error) => {
                cleanup();
                reject(error);
            },
        );
    });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setPlatformTimeout(
            () => reject(createVectorIndexError("sqlite-vector-index-timeout", `SQLite vector index timed out after ${timeoutMs}ms.`)),
            timeoutMs,
        );
        promise.then(
            (value) => {
                clearPlatformTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearPlatformTimeout(timeout);
                reject(toError(error));
            },
        );
    });
}

function isSecurityError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "SecurityError";
}

function isSameOriginUrl(url: string): boolean {
    const location = getPlatformLocation();
    if (!location) return false;
    try {
        return new URL(url, location.href).origin === location.origin;
    } catch {
        return false;
    }
}

function isDataUrl(url: string): boolean {
    return url.startsWith("data:");
}

function isBlobUrl(url: string): boolean {
    return url.startsWith("blob:");
}

function dataUrlToBlob(url: string, fallbackType: string): Blob {
    const commaIndex = url.indexOf(",");
    if (commaIndex < 0) {
        throw createVectorIndexError("sqlite-asset-url-invalid", "SQLite asset data URL is missing a payload.");
    }
    const metadata = url.slice(5, commaIndex);
    const payload = url.slice(commaIndex + 1);
    const parts = metadata.split(";").filter(Boolean);
    const explicitType = parts.find((part) => part.includes("/"));
    const mimeType = explicitType || fallbackType;
    const isBase64 = parts.includes("base64");
    const bytes = isBase64 ? decodeBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload));
    return new Blob([bytes], { type: mimeType });
}

function decodeBase64(payload: string): Uint8Array {
    const binary = decodePlatformBase64(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

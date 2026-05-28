import type {
    EmbeddingProfile,
    VectorIndex,
    VectorIndexStatus,
    VectorSearchResult,
    VSSChunk,
    VSSFileRecord,
    VSSFileState,
    VSSIndexStats,
} from "./types";
import type { SqliteWorkerRequest, SqliteWorkerResponse } from "./sqlite-worker-protocol";

const SQLITE_DISPOSE_WORKER_READY_TIMEOUT_MS = 400;
const SQLITE_DISPOSE_MESSAGE_TIMEOUT_MS = 400;

export interface SqliteVectorIndexOptions {
    workerUrl: string;
    databaseName?: string;
    opfsDirectory?: string;
    legacyOpfsDirectory?: string;
    opfsVfsName?: string;
    wasmUrl?: string;
    workerFactory?: (url: string) => Worker | Promise<Worker>;
}

export class SqliteVectorIndex implements VectorIndex {
    private readonly workerUrl: string;
    private readonly databaseName: string;
    private readonly opfsDirectory: string | undefined;
    private readonly legacyOpfsDirectory: string | undefined;
    private readonly opfsVfsName: string | undefined;
    private readonly wasmUrl: string | undefined;
    private readonly workerFactory: ((url: string) => Worker | Promise<Worker>) | undefined;
    private worker: Worker | null = null;
    private workerReady: Promise<Worker> | null = null;
    private readonly terminatedWorkers = new WeakSet<Worker>();
    private readonly objectUrls: string[] = [];
    private nextId = 1;
    private queue: Promise<void> = Promise.resolve();
    private disposed = false;
    private disposePromise: Promise<void> | null = null;
    private pending = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
    }>();

    constructor(options: SqliteVectorIndexOptions) {
        this.workerUrl = options.workerUrl;
        this.databaseName = options.databaseName ?? "personal-assistant-vss.sqlite3";
        this.opfsDirectory = options.opfsDirectory;
        this.legacyOpfsDirectory = options.legacyOpfsDirectory;
        this.opfsVfsName = options.opfsVfsName;
        this.wasmUrl = options.wasmUrl;
        this.workerFactory = options.workerFactory;
    }

    async initialize(profile: EmbeddingProfile): Promise<VectorIndexStatus> {
        this.assertActive();
        const wasmUrl = await this.prepareWasmUrl();
        this.assertActive();
        return this.enqueue(() => this.send<VectorIndexStatus>("initialize", {
            profile,
            databaseName: this.databaseName,
            opfsDirectory: this.opfsDirectory,
            legacyOpfsDirectory: this.legacyOpfsDirectory,
            opfsVfsName: this.opfsVfsName,
            wasmUrl,
        }));
    }

    upsertFile(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]): Promise<void> {
        return this.enqueue(() => this.send<null>("upsertFile", { fileState, chunks, embeddings }).then(() => undefined));
    }

    updateFileMetadata(fileState: VSSFileState): Promise<void> {
        return this.enqueue(() => this.send<null>("updateFileMetadata", { fileState }).then(() => undefined));
    }

    deleteFile(path: string): Promise<void> {
        return this.enqueue(() => this.send<null>("deleteFile", { path }).then(() => undefined));
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

    searchHybrid(
        queryEmbedding: number[],
        ftsQuery: string | null,
        k: number,
        fusionTopK: number,
    ): Promise<VectorSearchResult[]> {
        return this.enqueue(() => this.send<VectorSearchResult[]>("searchHybrid", {
            queryEmbedding, ftsQuery, k, fusionTopK,
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

    async dispose(): Promise<void> {
        this.disposePromise ??= this.disposeUnlocked();
        return this.disposePromise;
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        if (this.disposed) {
            return Promise.reject(createDisposedError());
        }
        const runOperation = () => {
            this.assertActive();
            return operation();
        };
        const run = this.queue.then(runOperation, runOperation);
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    private async send<T>(type: SqliteWorkerRequest["type"], payload: object): Promise<T> {
        this.assertActive();
        const worker = await this.ensureWorker();
        this.assertActive();
        const id = this.nextId++;
        const request = { id, type, payload } as SqliteWorkerRequest;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
            });
            try {
                worker.postMessage(request);
            } catch (error) {
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

export function createVectorIndexError(code: string, message: string): Error {
    const error = new Error(message);
    (error as Error & { code: string }).code = code;
    return error;
}

function createDisposedError(): Error {
    return createVectorIndexError("sqlite-vector-index-disposed", "SQLite vector index has been disposed.");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(createVectorIndexError("sqlite-vector-index-timeout", `SQLite vector index timed out after ${timeoutMs}ms.`)),
            timeoutMs,
        );
        promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeout);
                reject(error);
            },
        );
    });
}

function isSecurityError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "SecurityError";
}

function isSameOriginUrl(url: string): boolean {
    try {
        return new URL(url, globalThis.location.href).origin === globalThis.location.origin;
    } catch {
        return false;
    }
}

function isDataUrl(url: string): boolean {
    return url.startsWith("data:");
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
    const binary = globalThis.atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

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

export interface SqliteVectorIndexOptions {
    workerUrl: string;
    databaseName?: string;
    wasmUrl?: string;
    workerFactory?: (url: string) => Worker | Promise<Worker>;
}

export class SqliteVectorIndex implements VectorIndex {
    private readonly workerUrl: string;
    private readonly databaseName: string;
    private readonly wasmUrl: string | undefined;
    private readonly workerFactory: ((url: string) => Worker | Promise<Worker>) | undefined;
    private worker: Worker | null = null;
    private workerReady: Promise<Worker> | null = null;
    private readonly objectUrls: string[] = [];
    private nextId = 1;
    private queue: Promise<void> = Promise.resolve();
    private pending = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
    }>();

    constructor(options: SqliteVectorIndexOptions) {
        this.workerUrl = options.workerUrl;
        this.databaseName = options.databaseName ?? "personal-assistant-vss.sqlite3";
        this.wasmUrl = options.wasmUrl;
        this.workerFactory = options.workerFactory;
    }

    async initialize(profile: EmbeddingProfile): Promise<VectorIndexStatus> {
        const wasmUrl = await this.prepareWasmUrl();
        return this.enqueue(() => this.send<VectorIndexStatus>("initialize", {
            profile,
            databaseName: this.databaseName,
            wasmUrl,
        }));
    }

    upsertFile(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]): Promise<void> {
        return this.enqueue(() => this.send<null>("upsertFile", { fileState, chunks, embeddings }).then(() => undefined));
    }

    deleteFile(path: string): Promise<void> {
        return this.enqueue(() => this.send<null>("deleteFile", { path }).then(() => undefined));
    }

    listFilePaths(): Promise<string[]> {
        return this.enqueue(() => this.send<string[]>("listFilePaths", {}));
    }

    search(queryEmbedding: number[], k: number): Promise<VectorSearchResult[]> {
        return this.enqueue(() => this.send<VectorSearchResult[]>("search", { queryEmbedding, k }));
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
        const worker = this.worker;
        if (!worker) return;
        await this.send<null>("dispose", {}).catch(() => null);
        this.resetWorker(worker);
        this.pending.clear();
        for (const objectUrl of this.objectUrls) {
            URL.revokeObjectURL(objectUrl);
        }
        this.objectUrls.length = 0;
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.queue.then(operation, operation);
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    private async send<T>(type: SqliteWorkerRequest["type"], payload: object): Promise<T> {
        const worker = await this.ensureWorker();
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

    private async ensureWorker(): Promise<Worker> {
        if (this.worker) return this.worker;
        if (this.workerReady) return this.workerReady;
        if (typeof Worker === "undefined") {
            throw createVectorIndexError("sqlite-worker-unavailable", "Web Worker is not available in this environment.");
        }
        this.workerReady = this.createWorker(this.workerUrl);
        const worker = await this.workerReady;
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
        worker?.terminate();
        this.worker = null;
        this.workerReady = null;
    }

    private async createWorker(url: string): Promise<Worker> {
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

        const blobUrl = await this.createBlobUrlFromAsset(url, "text/javascript");
        return new Worker(blobUrl, {
            type: "module",
            name: "personal-assistant-vss",
        });
    }

    private async prepareWasmUrl(): Promise<string | undefined> {
        if (!this.wasmUrl) return undefined;
        if (isSameOriginUrl(this.wasmUrl)) return this.wasmUrl;
        return await this.createBlobUrlFromAsset(this.wasmUrl, "application/wasm");
    }

    private async createBlobUrlFromAsset(url: string, type: string): Promise<string> {
        const response = await fetch(url);
        if (!response.ok) {
            throw createVectorIndexError("sqlite-asset-fetch-failed", `Failed to fetch SQLite asset ${url}: ${response.status}`);
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(new Blob([blob], { type }));
        this.objectUrls.push(objectUrl);
        return objectUrl;
    }
}

export function createVectorIndexError(code: string, message: string): Error {
    const error = new Error(message);
    (error as Error & { code: string }).code = code;
    return error;
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

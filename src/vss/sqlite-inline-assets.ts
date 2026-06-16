import sqliteWorkerSource from "./sqlite-worker.ts?worker-source";
import getSqliteWasmBinary from "@sqlite.org/sqlite-wasm/sqlite3.wasm";

export function createInlineSqliteWorker(): Worker {
    const objectUrl = URL.createObjectURL(new Blob([sqliteWorkerSource], { type: "text/javascript" }));
    try {
        const worker = new Worker(objectUrl, {
            type: "module",
            name: "personal-assistant-vss",
        });
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
            terminate();
            URL.revokeObjectURL(objectUrl);
        };
        return worker;
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
}

let cachedSqliteWasmUrl: string | null = null;

/**
 * Returns a blob URL pointing at the inlined SQLite wasm payload. The blob is built lazily on
 * first call: URL.createObjectURL would throw at module-load time in non-DOM contexts (Jest's
 * default environment), and we want to skip the work entirely when the VSS subsystem is never
 * exercised. The URL is cached across callers because the wasm bytes are identical for every
 * SqliteVectorIndex instance — SqliteVectorIndex.prepareWasmUrl treats blob: URLs as same-origin
 * and returns them as-is, so caching here avoids rebuilding the Blob on every reconnect (the
 * old dataurl path was paying that cost per instance).
 *
 * The Uint8Array itself is now produced lazily by `lazyBinaryPlugin` (esbuild.config.mjs): the
 * first call to `getSqliteWasmBinary()` runs atob + byte copy and nulls the base64 string so
 * GC can reclaim ~1.25MB. Subsequent calls return the cached Uint8Array.
 */
export function getInlineSqliteWasmUrl(): string {
    if (cachedSqliteWasmUrl === null) {
        const blob = new Blob([getSqliteWasmBinary()], { type: "application/wasm" });
        cachedSqliteWasmUrl = URL.createObjectURL(blob);
    }
    return cachedSqliteWasmUrl;
}

/**
 * Optional revoke for hot-reload / test cleanup. Plugin teardown does not call this — orphaning
 * a single ~941KB blob URL on plugin reload is preferable to risking a use-after-revoke on any
 * SqliteVectorIndex that still holds the URL.
 */
export function disposeInlineSqliteWasmUrl(): void {
    if (cachedSqliteWasmUrl !== null) {
        URL.revokeObjectURL(cachedSqliteWasmUrl);
        cachedSqliteWasmUrl = null;
    }
}

import sqliteWorkerSource from "./sqlite-worker.ts?worker-source";
import sqliteWasmDataUrl from "@sqliteai/sqlite-wasm/sqlite3.wasm";

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

export function getInlineSqliteWasmUrl(): string {
    return sqliteWasmDataUrl;
}

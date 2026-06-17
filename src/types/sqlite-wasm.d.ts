declare module "@sqlite.org/sqlite-wasm" {
    const sqlite3InitModule: (options?: Record<string, unknown>) => Promise<unknown>;
    export default sqlite3InitModule;
}

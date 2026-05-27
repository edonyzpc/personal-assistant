declare module "*.wasm" {
    // esbuild `binary` loader (see esbuild.config.mjs) emits a Uint8Array literal at bundle time
    // rather than a base64 data URL. The runtime wraps it into a blob URL on first use.
    const source: Uint8Array;
    export default source;
}

declare module "*.md" {
    const source: string;
    export default source;
}

declare module "*?worker-source" {
    const source: string;
    export default source;
}

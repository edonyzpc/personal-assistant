declare module "*.wasm" {
    // `lazyBinaryPlugin` (see esbuild.config.mjs) emits a base64 string + decoder functions
    // instead of a pre-decoded Uint8Array. The default export is a sync getter that decodes
    // on first call (and nulls the base64 string after, allowing GC). `getSqliteWasmBinaryAsync`
    // yields the same payload across a microtask, so call sites that can defer to a Promise
    // avoid blocking the main thread on the ~941KB atob+copy work.
    const getBinary: () => Uint8Array;
    export default getBinary;
    export function getSqliteWasmBinaryAsync(): Promise<Uint8Array>;
}

declare module "*.md" {
    const source: string;
    export default source;
}

declare module "*?worker-source" {
    const source: string;
    export default source;
}

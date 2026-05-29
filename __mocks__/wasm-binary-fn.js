// Jest mock for `*.wasm` imports. Production uses esbuild's `lazyBinaryPlugin` (see
// esbuild.config.mjs), which emits a sync getter (default export) plus an async getter. The
// mock mirrors that shape so tests importing `*.wasm` see a callable, not a Uint8Array value.
// Actual byte content does not matter — tests that exercise the wasm payload mock
// SqliteVectorIndex itself.

const _bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function getSqliteWasmBinary() {
    return _bytes;
}

function getSqliteWasmBinaryAsync() {
    return Promise.resolve(_bytes);
}

module.exports = getSqliteWasmBinary;
module.exports.default = getSqliteWasmBinary;
module.exports.getSqliteWasmBinaryAsync = getSqliteWasmBinaryAsync;

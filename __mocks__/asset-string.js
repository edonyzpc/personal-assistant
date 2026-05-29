// Jest mock for `?worker-source` imports (see jest.config.js moduleNameMapper). The real
// `?worker-source` loader emits a JS source string that gets fed into `new Blob([src], {
// type: "text/javascript" })`. The Blob constructor accepts any BlobPart, so a Uint8Array
// works fine in tests — the actual bytes do not matter because tests that exercise the
// worker mock the Worker constructor itself.
//
// `*.wasm` imports use `__mocks__/wasm-binary-fn.js` after the lazyBinaryPlugin migration —
// do NOT add wasm here, the contracts differ (wasm needs a function, worker-source a value).
module.exports = new Uint8Array([0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

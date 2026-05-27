// Jest mock for `*.wasm` imports. Production uses esbuild's `binary` loader, which emits a
// Uint8Array — so this mock returns a tiny Uint8Array for parity (the actual bytes do not
// matter; tests that exercise the wasm payload mock SqliteVectorIndex itself).
module.exports = new Uint8Array([0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

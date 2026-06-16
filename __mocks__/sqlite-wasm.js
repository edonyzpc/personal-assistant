// Default mock for @sqlite.org/sqlite-wasm. Tests that exercise the worker
// use jest.doMock to supply their own implementation; this stub exists solely
// to prevent Jest from trying to parse the real ESM entry point (which uses
// import.meta.url, incompatible with Jest's CJS transform pipeline).

async function sqlite3InitModule() {
    return {};
}

module.exports = sqlite3InitModule;
module.exports.default = sqlite3InitModule;

const testGlobal = globalThis as typeof globalThis & { self?: unknown };

beforeEach(() => {
    if (typeof testGlobal.self === "undefined") {
        Object.defineProperty(testGlobal, "self", {
            configurable: true,
            writable: true,
            value: testGlobal,
        });
    }
});

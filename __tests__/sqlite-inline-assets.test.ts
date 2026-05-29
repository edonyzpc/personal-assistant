import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Import the wasm asset module — Jest resolves this to `__mocks__/wasm-binary-fn.js`
// (see jest.config.js moduleNameMapper). The mock mirrors lazyBinaryPlugin's emitted shape
// (sync default getter + named async getter), so these tests validate the consumer-side
// contract that sqlite-inline-assets.ts depends on. The actual `_b64 = null` GC side effect
// is exercised in production builds — verified out-of-band via `grep` on dist/main.js.
import wasmDefault, { getSqliteWasmBinaryAsync } from '@sqliteai/sqlite-wasm/sqlite3.wasm';

describe('wasm binary lazy-getter contract', () => {
    it('default export is a callable function (not a value)', () => {
        expect(typeof wasmDefault).toBe('function');
    });

    it('default export returns a Uint8Array', () => {
        const bytes = wasmDefault();
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(0);
    });

    it('repeated calls return the same Uint8Array reference (memoization)', () => {
        const a = wasmDefault();
        const b = wasmDefault();
        expect(a).toBe(b);
    });

    it('async getter resolves to a Uint8Array with the same contents as sync getter', async () => {
        const syncBytes = wasmDefault();
        const asyncBytes = await getSqliteWasmBinaryAsync();
        expect(asyncBytes).toBeInstanceOf(Uint8Array);
        expect(asyncBytes).toEqual(syncBytes);
    });

    it('concurrent async calls all resolve to the same payload', async () => {
        const [a, b, c] = await Promise.all([
            getSqliteWasmBinaryAsync(),
            getSqliteWasmBinaryAsync(),
            getSqliteWasmBinaryAsync(),
        ]);
        expect(a).toEqual(b);
        expect(b).toEqual(c);
    });
});

describe('getInlineSqliteWasmUrl URL caching', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    let createObjectURLSpy: jest.Mock<typeof URL.createObjectURL>;
    let urlCounter = 0;

    beforeEach(() => {
        urlCounter = 0;
        createObjectURLSpy = jest.fn(() => `blob:mock-${++urlCounter}`) as unknown as jest.Mock<typeof URL.createObjectURL>;
        URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
        URL.revokeObjectURL = jest.fn() as unknown as typeof URL.revokeObjectURL;
        // Reset cached module state so each test starts clean.
        jest.resetModules();
    });

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('returns the same URL across repeated calls (lazy + cached)', async () => {
        const { getInlineSqliteWasmUrl } = await import('../src/vss/sqlite-inline-assets');
        const u1 = getInlineSqliteWasmUrl();
        const u2 = getInlineSqliteWasmUrl();
        const u3 = getInlineSqliteWasmUrl();
        expect(u1).toBe(u2);
        expect(u2).toBe(u3);
        expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    });

    it('does not allocate the blob URL until the first call (truly lazy)', async () => {
        await import('../src/vss/sqlite-inline-assets');
        expect(createObjectURLSpy).not.toHaveBeenCalled();
    });
});

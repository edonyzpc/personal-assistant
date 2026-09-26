import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// The consumer uses Jest's WASM fixture here. The production binary getter is
// exercised through the real esbuild loader in sqlite-binary-build-script.test.ts.

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

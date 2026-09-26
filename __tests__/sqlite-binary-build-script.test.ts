import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

type BinaryExports = {
    getBinary: () => Uint8Array;
    getSqliteWasmBinaryAsync: () => Promise<Uint8Array>;
};

const repositoryRoot = process.cwd();
let fixtureRoot: string | undefined;
let builtSource: string;
let expectedBytes: Buffer;

beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'pa-sqlite-binary-build-'));
    mkdirSync(join(fixtureRoot, 'src'));
    symlinkSync(join(repositoryRoot, 'node_modules'), join(fixtureRoot, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(fixtureRoot, 'src/main.ts'),
        'export { default as getBinary, getSqliteWasmBinaryAsync } from "@sqlite.org/sqlite-wasm/sqlite3.wasm";\n');
    const outputPath = join(fixtureRoot, 'built.cjs');
    const configUrl = pathToFileURL(join(repositoryRoot, 'esbuild.config.mjs')).href;
    // Use the real production loader with a small entrypoint. This child does
    // not pass through Jest's *.wasm mapper or write the repository's dist/.
    const wasmPath = execFileSync(process.execPath, ['--input-type=module', '-e', [
        'import { writeFileSync } from "node:fs";',
        'import { createRequire } from "node:module";',
        `import { buildProductionMainArtifactInMemory } from ${JSON.stringify(configUrl)};`,
        `const artifact = await buildProductionMainArtifactInMemory({ absWorkingDir: ${JSON.stringify(fixtureRoot)} });`,
        `writeFileSync(${JSON.stringify(outputPath)}, artifact.source);`,
        `const requireFromRoot = createRequire(${JSON.stringify(join(repositoryRoot, 'package.json'))});`,
        'process.stdout.write(requireFromRoot.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"));',
    ].join('\n')], { encoding: 'utf8' });
    builtSource = readFileSync(outputPath, 'utf8');
    expectedBytes = readFileSync(wasmPath);
});

afterAll(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

function loadFreshBinary() {
    const decode = jest.fn((base64: string) => Buffer.from(base64, 'base64').toString('binary'));
    const module = { exports: {} as BinaryExports };
    runInNewContext(builtSource, { module, Uint8Array, atob: decode });
    return { binary: module.exports, decode };
}

function expectOriginalWasm(bytes: Uint8Array): void {
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(expectedBytes.byteLength);
    expect(createHash('sha256').update(bytes).digest('hex'))
        .toBe(createHash('sha256').update(expectedBytes).digest('hex'));
}

describe('production SQLite binary loader', () => {
    it('defers synchronous WASM decoding until first use and reuses the decoded bytes', () => {
        const { binary, decode } = loadFreshBinary();
        expect(typeof binary.getBinary).toBe('function');
        expect(decode).not.toHaveBeenCalled();

        const bytes = binary.getBinary();

        expectOriginalWasm(bytes);
        expect(binary.getBinary()).toBe(bytes);
        expect(decode).toHaveBeenCalledTimes(1);
    });

    it('coalesces fresh asynchronous getters and shares their bytes with synchronous reads', async () => {
        const { binary, decode } = loadFreshBinary();
        const first = binary.getSqliteWasmBinaryAsync();
        const second = binary.getSqliteWasmBinaryAsync();
        const third = binary.getSqliteWasmBinaryAsync();
        expect(decode).not.toHaveBeenCalled();
        expect(second).toBe(first);
        expect(third).toBe(first);

        const [a, b, c] = await Promise.all([first, second, third]);

        expectOriginalWasm(a);
        expect(b).toBe(a);
        expect(c).toBe(a);
        expect(binary.getBinary()).toBe(a);
        expect(await binary.getSqliteWasmBinaryAsync()).toBe(a);
        expect(decode).toHaveBeenCalledTimes(1);
    });

    it('reuses a synchronous decode that wins an outstanding asynchronous getter', async () => {
        const { binary, decode } = loadFreshBinary();
        const pending = binary.getSqliteWasmBinaryAsync();
        expect(decode).not.toHaveBeenCalled();

        const syncBytes = binary.getBinary();
        const asyncBytes = await pending;

        expectOriginalWasm(syncBytes);
        expect(asyncBytes).toBe(syncBytes);
        expect(await binary.getSqliteWasmBinaryAsync()).toBe(syncBytes);
        expect(decode).toHaveBeenCalledTimes(1);
    });
});

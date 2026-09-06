/** B-129 P0 experiment only; no plugin imports or dependency installation.
 * Requires integrity-checked libheif-js 1.23.2 under /tmp/b129-heic-evaluation/package.
 * Run: node --expose-gc scripts/prototypes/b129-heic-evaluation.mjs
 * Creates only an isolated receipt and self-contained test-vault probe assets.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageRoot = '/tmp/b129-heic-evaluation/package';
const decoderPath = `${packageRoot}/libheif-wasm/libheif-bundle.mjs`;
const fixturePath = resolve(root, 'test/b129-p0-fixtures/chart-sips.heic');
const expectedDecoderSha = 'd05292271af008d300cc75be374feb8fd35b418a71420a556c3fb817f662b502';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function installNetworkGuards() {
    const attempts = [];
    const deny = (api) => function blockedNetwork(..._args) { attempts.push(api); throw new Error(`network_blocked:${api}`); };
    for (const api of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']) {
        globalThis[api] = deny(api);
    }
    return { attempts, deny };
}

async function decodeFixture(libheif, buffer, hash) {
    const started = performance.now();
    const decoder = new libheif.HeifDecoder();
    let handles = [];
    const release = { imageHandles: 0, contexts: 0 };
    try {
        handles = decoder.decode(new Uint8Array(buffer));
        if (!handles.length) throw new Error('heic_no_decodable_images');
        const images = [];
        for (const image of handles) {
            const width = image.get_width();
            const height = image.get_height();
            // Only a small synthetic fixture is admitted by this experiment.
            if (width <= 0 || height <= 0 || width * height > 2_000_000) throw new Error('fixture_pixel_limit');
            const pixels = { width, height, data: new Uint8ClampedArray(width * height * 4) };
            await new Promise((resolve, reject) => image.display(pixels,
                (result) => result ? resolve() : reject(new Error('heic_pixel_decode_failed'))));
            images.push({ width, height, primary: image.is_primary(), rgbaBytes: pixels.data.byteLength,
                pixelSha256: await hash(pixels.data) });
        }
        return { imageCount: images.length, images, decodeMs: performance.now() - started,
            wasmHeapBytes: libheif.HEAPU8?.buffer.byteLength ?? null, release };
    } finally {
        for (const image of handles) { image.free(); release.imageHandles += 1; }
        if (decoder.decoder) {
            libheif.heif_context_free(decoder.decoder);
            decoder.decoder = null;
            release.contexts += 1;
        }
    }
}

const common = `${installNetworkGuards.toString()}\n${decodeFixture.toString()}`;
const nodeWorkerSource = `
import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
${common}
const network = installNetworkGuards();
// The browser ESM build intentionally hides Node detection. Supply only the
// worker globals needed by its environment check, not a DOM or codec shim.
globalThis.self = globalThis;
globalThis.location = { href: 'file:///b129-isolated-worker.js' };
const require = createRequire(import.meta.url);
for (const [name, methods] of [['node:http',['request','get']],['node:https',['request','get']],
    ['node:net',['connect','createConnection']],['node:tls',['connect']],['node:dgram',['createSocket']]]) {
    const mod = require(name);
    for (const method of methods) mod[method] = network.deny(name + '.' + method);
}
const diagnostics = [];
console.log = (...args) => diagnostics.push(args.map(String).join(' '));
const initStarted = performance.now();
const { default: factory } = await import(${JSON.stringify(pathToFileURL(decoderPath).href)});
const libheif = await factory({ print: () => {}, printErr: () => {} });
parentPort.postMessage({ kind: 'ready', initMs: performance.now() - initStarted });
const hash = (value) => createHash('sha256').update(value).digest('hex');
parentPort.on('message', async ({ id, buffer, iterations = 1 }) => {
    parentPort.postMessage({ kind: 'started', id });
    const memoryBefore = process.memoryUsage();
    try {
        let result;
        for (let i = 0; i < iterations; i++) result = await decodeFixture(libheif, buffer, hash);
        parentPort.postMessage({ kind: 'result', id, ok: true, result, networkAttempts: [...network.attempts],
            memoryBefore, memoryAfter: process.memoryUsage(), diagnostics });
    } catch (error) {
        parentPort.postMessage({ kind: 'result', id, ok: false, error: String(error.message),
            networkAttempts: [...network.attempts], memoryAfter: process.memoryUsage(), diagnostics });
    }
});`;

function waitFor(worker, predicate, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); worker.off('message', message); worker.off('error', error); };
        const message = (value) => { if (predicate(value)) { cleanup(); resolve(value); } };
        const error = (value) => { cleanup(); reject(value); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('experiment_timeout')); }, timeoutMs);
        worker.on('message', message);
        worker.on('error', error);
    });
}

async function nodeCase(bytes, cancel = false) {
    // A local file URL supplies createRequire's base. No remote source is used.
    const source = nodeWorkerSource.replace('createRequire(import.meta.url)',
        `createRequire(${JSON.stringify(import.meta.url)})`);
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
    const before = process.memoryUsage();
    let sampledPeakRss = before.rss;
    const sampler = setInterval(() => { sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss); }, 1);
    try {
        const ready = await waitFor(worker, (value) => value.kind === 'ready');
        let completed = false;
        worker.on('message', (value) => { if (value.kind === 'result') completed = true; });
        const expected = waitFor(worker, (value) => value.kind === (cancel ? 'started' : 'result'));
        const buffer = Uint8Array.from(bytes).buffer;
        worker.postMessage({ id: 'fixture', buffer, iterations: cancel ? 10_000 : 1 }, [buffer]);
        const result = await expected;
        const terminateStarted = performance.now();
        const exitCode = await worker.terminate();
        globalThis.gc?.();
        return { ready, result, cancelled: cancel, completed, terminateMs: performance.now() - terminateStarted,
            exitCode, before, afterTerminate: process.memoryUsage(), sampledPeakRss,
            memoryCaveat: 'Node process RSS includes host and worker; 1 ms sampling is not a peak guarantee; freed heap may remain in process allocator.' };
    } finally {
        clearInterval(sampler);
        await worker.terminate();
    }
}

function browserRunner(workerSource) {
    return `/* B-129 isolated HEIC experiment. No provider or plugin calls. */
(() => {
const workerSource = ${JSON.stringify(workerSource)};
const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
async function runCase(bytes, cancel = false) {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));
    const worker = new Worker(url);
    let completed = false;
    const messages = [];
    worker.addEventListener('message', (event) => { messages.push(event.data); if (event.data.kind === 'result') completed = true; });
    const wait = (kind) => new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', handler); worker.removeEventListener('error', error); };
        const handler = (event) => { if (event.data.kind === kind) { cleanup(); resolve(event.data); } };
        const error = (event) => { cleanup(); reject(new Error(event.message)); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('heic_worker_timeout')); }, 10_000);
        worker.addEventListener('message', handler); worker.addEventListener('error', error);
    });
    try {
        const ready = await wait('ready');
        const pending = wait(cancel ? 'started' : 'result');
        const buffer = bytes.slice(0);
        worker.postMessage({ id: 'fixture', buffer, iterations: cancel ? 10_000 : 1 }, [buffer]);
        const result = await pending;
        worker.terminate();
        return { ready, result, cancelled: cancel, completed, messages };
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
}
globalThis.runB129HeicEvaluation = async (app) => {
    const path = 'b129-p0-fixtures/chart-sips.heic';
    const original = await app.vault.adapter.readBinary(path);
    const receipt = { kind: 'b129-heic-browser-evaluation', createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent, fixtureSha256: await hash(original),
        decoder: 'libheif-js@1.23.2', decoderSha256: ${JSON.stringify(expectedDecoderSha)} };
    receipt.valid = await runCase(original);
    receipt.invalid = await runCase(new Uint8Array([1, 2, 3, 4]).buffer);
    receipt.cancellation = await runCase(original, true);
    receipt.originalUnchanged = receipt.fixtureSha256 === await hash(await app.vault.adapter.readBinary(path));
    globalThis.b129HeicEvaluationReceipt = receipt;
    return receipt;
};
})();\n`;
}

const decoderBytes = await readFile(decoderPath);
if (sha256(decoderBytes) !== expectedDecoderSha) throw new Error('decoder_integrity_mismatch');
const fixture = await readFile(fixturePath);
const browserSource = `import factory from ${JSON.stringify(decoderPath)};
${common}
const network = installNetworkGuards();
const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
const initStarted = performance.now();
const libheifPromise = factory({ print: () => {}, printErr: () => {} });
Promise.resolve(libheifPromise).then((libheif) => {
    postMessage({ kind: 'ready', initMs: performance.now() - initStarted });
    onmessage = async ({ data: { id, buffer, iterations = 1 } }) => {
        postMessage({ kind: 'started', id });
        try {
            let result;
            for (let i = 0; i < iterations; i++) result = await decodeFixture(libheif, buffer, hash);
            postMessage({ kind: 'result', id, ok: true, result, networkAttempts: [...network.attempts] });
        } catch (error) { postMessage({ kind: 'result', id, ok: false, error: String(error.message), networkAttempts: [...network.attempts] }); }
    };
}).catch((error) => { throw error; });`;
const bundled = await build({ stdin: { contents: browserSource, resolveDir: root, sourcefile: 'b129-heic-worker-entry.mjs' },
    bundle: true, write: false, minify: true, format: 'iife', platform: 'browser', target: 'es2020' });
if (bundled.errors.length) throw new Error('worker_build_failed');
const workerBytes = bundled.outputFiles[0].contents;
const runnerBytes = Buffer.from(browserRunner(bundled.outputFiles[0].text));
const assetRoot = resolve(root, 'test/b129-p0-fixtures');
await writeFile(`${assetRoot}/heic-evaluation-worker.js`, workerBytes);
await writeFile(`${assetRoot}/heic-evaluation-runner.js`, runnerBytes);
const receipt = { kind: 'b129-heic-node-evaluation', createdAt: new Date().toISOString(),
    node: process.version, decoder: 'libheif-js@1.23.2', decoderSha256: expectedDecoderSha,
    fixtureSha256: sha256(fixture), runnerSha256: sha256(runnerBytes), workerSha256: sha256(workerBytes),
    workerBytes: workerBytes.length, runnerBytes: runnerBytes.length, experimentSourceSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    valid: await nodeCase(fixture), invalid: await nodeCase(Buffer.from([1, 2, 3, 4])),
    cancellation: await nodeCase(fixture, true),
    originalUnchanged: sha256(await readFile(fixturePath)) === sha256(fixture),
    caveat: 'Node feasibility and explicit release/termination only; not Obsidian, iOS, pixel-quality, or exact memory reclamation evidence.' };
if (!receipt.valid.result.ok || receipt.invalid.result.ok || receipt.cancellation.completed
    || !receipt.originalUnchanged || receipt.valid.result.networkAttempts.length || receipt.invalid.result.networkAttempts.length) {
    throw new Error('experiment_assertion_failed');
}
await mkdir('/tmp/b129-heic-evaluation', { recursive: true });
const receiptPath = `/tmp/b129-heic-evaluation/node-receipt-${Date.now()}.json`;
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receiptPath, ...receipt }, null, 2));

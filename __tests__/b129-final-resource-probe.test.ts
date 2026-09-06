import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from '@jest/globals';

const script = readFileSync(resolve(__dirname, '../scripts/prototypes/b129-final-resource-probe.js'), 'utf8');
const resourceScript = readFileSync(resolve(__dirname, '../scripts/prototypes/b129-resource-probe.js'), 'utf8');
const sourcePath = 'b129-p0-fixtures/resource-48mp.jpg';
// Header-only bytes for orchestration tests. No mocked pixel result is host decoder evidence.
const fixture = new Uint8Array([255, 216, 255, 192, 0, 17, 8, 0x17, 0x70, 0x1f, 0x40,
    3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]).buffer;
const hash = (value: ArrayBuffer) => createHash('sha256').update(new Uint8Array(value)).digest('hex');

function harness(options: { failAt?: number; corruptOutput?: boolean; changeSource?: boolean; badManifest?: boolean; hold?: boolean } = {}) {
    const files = new Map<string, any>([[sourcePath, fixture]]);
    const folders = new Set<string>();
    files.set('b129-p0-fixtures/manifest.json', JSON.stringify({ fixtures: [{ filename: 'resource-48mp.jpg', megapixels: 48,
        storedWidth: 8000, storedHeight: 6000, sha256: options.badManifest ? 'bad' : hash(fixture), bytes: fixture.byteLength }] }));
    const calls: any[] = [];
    const checkpoints: any[] = [];
    const releases: Array<() => void> = [];
    let samplerStops = 0;
    const env: any = { Uint8Array, ArrayBuffer, DataView, Blob: NodeBlob, TextEncoder, crypto: webcrypto,
        performance: { now: () => Date.now() }, navigator: { userAgent: 'unit test, no actual device evidence' } };
    runInNewContext(resourceScript, env);
    env.b129ResourceProbeInternals.memorySampler = () => ({ stop: async () => { samplerStops++; return { samples: [], testDouble: true }; } });
    env.b129ResourceProbeInternals.processImage = async (bytes: ArrayBuffer, settings: any) => {
        const call = { bytes, edge: settings.edge, quality: settings.quality, policy: settings.policy };
        calls.push(call);
        const ordinal = calls.length;
        const state = settings.state;
        for (const type of ['Images', 'Canvases', 'Urls']) {
            state[`active${type}`]++; state[`maxActive${type}`] = Math.max(state[`maxActive${type}`], state[`active${type}`]);
        }
        try {
            if (options.hold) await new Promise<void>((yes) => releases.push(yes));
            if (ordinal === options.failAt) throw new Error('synthetic_processing_failure');
            const blob = new NodeBlob([new Uint8Array([255, 216, 255, ordinal])], { type: 'image/jpeg' });
            return { blob, decodedWidth: 8000, decodedHeight: 6000, outputWidth: 3200, outputHeight: 2400,
                outputBytes: blob.size, mime: blob.type, elapsedMs: ordinal };
        } finally { for (const type of ['Images', 'Canvases', 'Urls']) state[`active${type}`]--; }
    };
    runInNewContext(script, env);
    const app = { vault: {
        getName: () => 'test',
        adapter: {
            exists: async (path: string) => files.has(path) || folders.has(path),
            read: async (path: string) => files.get(path),
            readBinary: async (path: string) => { if (!files.has(path)) throw new Error('missing_fixture'); return files.get(path); },
            write: async (path: string, content: string) => { files.set(path, content); checkpoints.push(JSON.parse(content)); },
        },
        createFolder: async (path: string) => { if (folders.has(path)) throw new Error('folder_exists'); folders.add(path); },
        createBinary: async (path: string, bytes: ArrayBuffer) => {
            if (files.has(path)) throw new Error('overwrite_forbidden');
            files.set(path, options.corruptOutput ? new Uint8Array([1]).buffer : bytes);
            if (options.changeSource) files.set(sourcePath, new Uint8Array([1]).buffer);
        },
    } };
    return { env, app, calls, files, checkpoints, releases, samplerStops: () => samplerStops };
}
async function until(predicate: () => boolean) {
    for (let i = 0; i < 500 && !predicate(); i++) await new Promise((yes) => setTimeout(yes, 1));
    expect(predicate()).toBe(true);
}

describe('B129 final 3200 resource calibration orchestration', () => {
    it('performs one 48MP control then eight 48MP decodes with fixed candidates and actual byte sums', async () => {
        const h = harness();
        const result = await h.env.runB129FinalResources(h.app, 'unit-success');
        expect(result.status).toBe('completed'); expect(h.calls).toHaveLength(9);
        expect(h.calls.every((c) => c.bytes === fixture && c.edge === 3200 && c.quality === .9)).toBe(true);
        const receipt = h.checkpoints.at(-1);
        expect(receipt.original).toMatchObject({ sha256: hash(fixture), afterSha256: hash(fixture), unchanged: true });
        expect(receipt.cases[0]).toMatchObject({ outputBytes: 4, outputHashVerified: true, status: 'passed' });
        expect(receipt.cases[1]).toMatchObject({ count: 8, totalBytes: 32, allEightSources48MP: true, aggregateWithinBudget: true });
        expect(receipt.cases[1].reports).toHaveLength(8);
        expect(receipt.progress).toHaveLength(8);
        expect(receipt.resources).toMatchObject({ activeImages: 0, activeCanvases: 0, activeUrls: 0,
            maxActiveImages: 1, maxActiveCanvases: 1, maxActiveUrls: 1 });
        expect(h.samplerStops()).toBe(2);
    });
    it('does not start a next decode until the prior 48MP operation completes', async () => {
        const h = harness({ hold: true });
        const pending = h.env.runB129FinalResources(h.app, 'unit-serial');
        for (let i = 0; i < 9; i++) {
            await until(() => h.calls.length === i + 1);
            expect(h.releases).toHaveLength(i + 1);
            expect(h.calls).toHaveLength(i + 1);
            h.releases[i]();
        }
        expect((await pending).status).toBe('completed');
    });
    it('stops the batch on failure, preserves a failed checkpoint, and closes both samplers', async () => {
        const h = harness({ failAt: 3 });
        expect((await h.env.runB129FinalResources(h.app, 'unit-failure')).status).toBe('failed');
        expect(h.calls).toHaveLength(3);
        const receipt = h.checkpoints.at(-1);
        expect(receipt.cases.map((c: any) => c.status)).toEqual(['passed', 'failed']);
        expect(receipt.progress).toHaveLength(1);
        expect(receipt.original.unchanged).toBe(true); expect(receipt.ownedResourcesReleased).toBe(true);
        expect(h.samplerStops()).toBe(2);
    });
    it('rejects a changed source hash after processing instead of calling the run complete', async () => {
        const h = harness({ changeSource: true });
        const result = await h.env.runB129FinalResources(h.app, 'unit-mutated');
        expect(result.status).toBe('failed'); expect(result.errors[0].error).toBe('original_changed');
        expect(h.checkpoints.at(-1).original.unchanged).toBe(false);
    });
    it('verifies actual written JPEG bytes before starting the batch', async () => {
        const h = harness({ corruptOutput: true });
        const result = await h.env.runB129FinalResources(h.app, 'unit-corrupted-output');
        expect(result.status).toBe('failed'); expect(result.errors[0].error).toBe('written_output_hash_mismatch');
        expect(h.calls).toHaveLength(1); expect(h.samplerStops()).toBe(1);
    });
    it('rejects a missing or different fixture hash before any image decode', async () => {
        const h = harness({ badManifest: true });
        const result = await h.env.runB129FinalResources(h.app, 'unit-integrity');
        expect(result.status).toBe('failed'); expect(result.errors[0].error).toBe('fixture_integrity_mismatch');
        expect(h.calls).toHaveLength(0);
    });
    it('refuses reuse of an existing run or a drifted candidate policy', async () => {
        const h = harness();
        await h.env.runB129FinalResources(h.app, 'unit-reuse');
        await expect(h.env.runB129FinalResources(h.app, 'unit-reuse')).rejects.toThrow('unique_run_required');
        h.env.b129ResourceProbeInternals.candidates = { ...h.env.b129ResourceProbeInternals.candidates, maxImagesPerTurn: 4 };
        await expect(h.env.runB129FinalResources(h.app, 'unit-policy')).rejects.toThrow('candidate_policy_changed');
    });
});

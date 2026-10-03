#!/usr/bin/env node
// Builds only the test harness. It never loads Obsidian or starts a provider.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
export async function buildB157ContextEval(outputDirectory) {
  if (!outputDirectory) throw new Error('An explicit harness output directory is required.');
  const outdir = resolve(outputDirectory);
  await mkdir(outdir, { recursive: true });
  const fixturePath = resolve(root, 'scripts/fixtures/b157-context-eval.json');
  const fixture = await readFile(fixturePath);
  const entryPath = resolve(root, 'scripts/b157-context-eval-entry.mjs');
  const entry = await readFile(entryPath);
  const buildInfo = { schemaVersion: 1, fixtureSha256: hash(fixture), entrySha256: hash(entry),
    fixtureId: JSON.parse(fixture).id };
  const result = await build({ absWorkingDir: root, entryPoints: [entryPath], bundle: true,
    platform: 'browser', format: 'iife', globalName: 'B157ContextEvalModule', target: 'es2022',
    external: ['obsidian', 'electron', 'node:*', 'crypto', 'fs', 'path'], metafile: true, write: false,
    define: { __B157_BUILD_INFO__: JSON.stringify(buildInfo) } });
  const bundle = result.outputFiles[0].contents;
  const inputs = {};
  for (const path of Object.keys(result.metafile.inputs).sort()) {
    if (path.startsWith('<')) continue;
    inputs[relative(root, resolve(root, path))] = hash(await readFile(resolve(root, path)));
  }
  const pluginRuntimeSourceInputs = {};
  for (const path of ['src/ai-services/chat-service.ts', 'src/ai-services/ai-utils.ts',
    'src/ai-services/pa-agent-runtime.ts']) pluginRuntimeSourceInputs[path] = hash(await readFile(resolve(root, path)));
  const manifest = { ...buildInfo, bundleSha256: hash(bundle), inputs, pluginRuntimeSourceInputs,
    evidenceLayer: 'test-only bundle; no provider or app execution' };
  await writeFile(resolve(outdir, 'b157-context-eval.js'), bundle);
  await writeFile(resolve(outdir, 'b157-context-eval-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(outdir, 'b157-context-eval.json'), fixture);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--outdir') {
    process.stderr.write('Usage: node scripts/build-b157-context-eval.mjs --outdir <explicit directory>\n');
    process.exitCode = 2;
  } else {
    try { const result = await buildB157ContextEval(args[1]);
      process.stdout.write(`${JSON.stringify({ status: 'built_without_execution',
        bundleSha256: result.bundleSha256, fixtureSha256: result.fixtureSha256,
        sourceInputCount: Object.keys(result.inputs).length, outdir: resolve(args[1]) })}\n`);
    } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  }
}

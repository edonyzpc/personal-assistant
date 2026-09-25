#!/usr/bin/env node
// B-149 offline baseline: invoke the source suite that drives the real runtime and SDK.
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');

const root = resolve(__dirname, '..');

function sourceHash(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Git identity failed: ${result.error?.message ?? result.stderr.trim()}`);
  // Porcelain's leading status column includes spaces; keep it intact for path parsing.
  return result.stdout.replace(/\r?\n$/, '');
}

function collectSourceIdentity() {
  const budgetUsageInputs = [
    'src/token-estimate.ts', 'src/ai-services/pa-agent-prompts.ts',
    'src/ai-services/context/PaAgentContextBudget.ts',
    'src/ai-services/context/PaAgentContextManager.ts',
    'src/ai-services/context/PaAgentContextProjector.ts',
    'src/ai-services/context/PaAgentContextCompactor.ts',
    'src/ai-services/context/PaAgentContextSummarizer.ts',
    'src/ai-services/context/PaAgentContextSummaryTypes.ts',
    'src/ai-services/agent-usage-ledger.ts',
    'src/ai-services/agent-debug-observation.ts',
    'src/ai-services/obsidian-fetch.ts',
    'src/ai-services/memory-search-tool.ts',
  ];
  const inputs = ['src/pa/eval', 'scripts/pa-agent-runtime-eval-runner.js',
    '__tests__/pa-agent-runtime-eval.test.ts', '__tests__/pa-agent-runtime-eval-runner-script.test.ts',
    'src/ai-services/pa-agent-runtime.ts', 'src/ai-services/ai-utils.ts',
    ...budgetUsageInputs, 'package.json', 'package-lock.json'];
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  return {
    gitHead: gitOutput(['rev-parse', 'HEAD']),
    dirtyInputs: gitOutput(['status', '--porcelain=v1', '--untracked-files=all', '--', ...inputs])
      .split('\n').filter(Boolean).map(line => ({ state: line.slice(0, 2), path: line.slice(3) })),
    fixtureSourceSha256: sourceHash('src/pa/eval/runtime-cases.ts'),
    executionSourceSha256: sourceHash('src/pa/eval/runtime-runner.ts'),
    harnessSourceSha256: sourceHash('__tests__/pa-agent-runtime-eval.test.ts'),
    runnerScriptSha256: sourceHash('scripts/pa-agent-runtime-eval-runner.js'),
    productionRuntimeSha256: sourceHash('src/ai-services/pa-agent-runtime.ts'),
    aiUtilsSha256: sourceHash('src/ai-services/ai-utils.ts'),
    budgetUsageSourceSha256: Object.fromEntries(budgetUsageInputs.map(path => [path, sourceHash(path)])),
    packageJsonSha256: sourceHash('package.json'),
    packageLockSha256: sourceHash('package-lock.json'),
    dependencies: {
      '@langchain/core': lock.packages?.['node_modules/@langchain/core']?.version ?? null,
      '@langchain/openai': lock.packages?.['node_modules/@langchain/openai']?.version ?? null,
    },
    nodeVersion: process.version,
  };
}

function parseArgs(args) {
  let mode = 'offline';
  let output;
  let maxRequests = 50;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--mode' && args[index + 1]) mode = args[++index];
    else if (args[index] === '--output' && args[index + 1]) output = resolve(args[++index]);
    else if (args[index] === '--max-requests' && args[index + 1]) maxRequests = Number(args[++index]);
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  if (!['offline', 'live'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new Error('Physical request maximum must be a positive integer');
  return { mode, output, maxRequests };
}

function run(args = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(args); }
  catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  if (options.mode === 'live') {
    // Real-provider runs require a separately configured host and the owner's capped-call schedule.
    process.stdout.write(JSON.stringify({ status: 'provider_unavailable', reason: 'No authorized live host adapter is attached to this offline runner.' }) + '\n');
    return 2;
  }
  const output = options.output ?? join(mkdtempSync(join(tmpdir(), 'b149-runtime-eval-')), 'report.json');
  if (!existsSync(dirname(output))) {
    process.stderr.write(`Output directory does not exist: ${dirname(output)}\n`);
    return 2;
  }
  const jest = require.resolve('jest/bin/jest');
  const command = spawnSync(process.execPath, [jest, '--config', 'jest.source.config.cjs', '--runInBand',
    '--runTestsByPath', '__tests__/pa-agent-runtime-eval.test.ts'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, B149_RUNTIME_EVAL_OUTPUT: output,
      B149_RUNTIME_EVAL_MAX_REQUESTS: String(options.maxRequests) },
  });
  const logPath = `${output}.jest.log`;
  writeFileSync(logPath, `${command.stdout ?? ''}${command.stderr ?? ''}`);
  if (command.error || command.signal) {
    process.stdout.write(JSON.stringify({ status: 'cancelled', signal: command.signal ?? null,
      error: command.error?.message, report: output, log: logPath }) + '\n');
    return 130;
  }
  if (command.status !== 0 || !existsSync(output)) {
    process.stdout.write(JSON.stringify({ status: 'failed', testExit: command.status, report: existsSync(output) ? output : null,
      log: logPath }) + '\n');
    return 1;
  }
  let report;
  try { report = JSON.parse(readFileSync(output, 'utf8')); }
  catch (error) {
    process.stdout.write(JSON.stringify({ status: 'failed', reason: `Invalid report: ${error.message}`, log: logPath }) + '\n');
    return 1;
  }
  let sourceIdentity;
  try { sourceIdentity = collectSourceIdentity(); }
  catch (error) {
    process.stdout.write(JSON.stringify({ status: 'failed', reason: error.message, report: output, log: logPath }) + '\n');
    return 1;
  }
  report.sourceIdentity = sourceIdentity;
  writeFileSync(output, JSON.stringify(report, null, 2));
  const terminalCounts = Object.fromEntries(['completed', 'completed_with_warning', 'needs_user', 'incomplete',
    'failed', 'cancelled', 'unknown'].map(status => [status, report.actual.filter(item => item.status === status).length]));
  process.stdout.write(JSON.stringify({ status: terminalCounts.failed ? 'recorded_with_runtime_failures' : 'recorded',
    layer: report.layer, gitHead: sourceIdentity.gitHead,
    fixtureHash: report.fixtureHash, cases: report.actual.length, runtimeTerminals: terminalCounts,
    expectedGaps: report.actual.filter(item => item.baseline === 'expected_gap').map(item => item.caseId),
    modelPhysicalRequests: report.requests.length, fixedWebRequests: report.webRequests.length,
    report: output, log: logPath }) + '\n');
  return terminalCounts.failed ? 1 : 0;
}

if (require.main === module) process.exitCode = run();
module.exports = { parseArgs, run };

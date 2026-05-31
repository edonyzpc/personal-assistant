#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODEL = 'gpt-5.3-codex-spark';
const PROMPT_NAME = 'commit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const promptPath = join(codexHome, 'prompts', `${PROMPT_NAME}.md`);

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  npm run codex:commit
      Open interactive Codex in this repo with ${MODEL} and prompt:${PROMPT_NAME}.

  npm run codex:commit -- --exec
      Run non-interactive \`codex exec\` with the same model and prompt.

  npm run codex:commit -- --exec --json
      Pass additional Codex flags through after the wrapper options.
`);
  process.exit(0);
}

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--model' || args[index] === '-m' || args[index].startsWith('--model=')) {
    console.error(`This wrapper always uses ${MODEL}; do not pass ${args[index]}.`);
    process.exit(1);
  }
}

const execMode = args.includes('--exec');
const passthroughArgs = args.filter(arg => arg !== '--exec');

if (!existsSync(promptPath)) {
  console.error(`Missing Codex prompt: ${promptPath}`);
  console.error(`Create it as prompt:${PROMPT_NAME}, then rerun this command.`);
  process.exit(1);
}

const prompt = readFileSync(promptPath, 'utf8').trim();
if (!prompt) {
  console.error(`Codex prompt is empty: ${promptPath}`);
  process.exit(1);
}

const baseArgs = execMode
  ? ['exec', '--model', MODEL, '--cd', repoRoot, ...passthroughArgs, '-']
  : ['--model', MODEL, '--cd', repoRoot, ...passthroughArgs, prompt];

const child = spawnSync('codex', baseArgs, {
  input: execMode ? prompt : undefined,
  stdio: execMode ? ['pipe', 'inherit', 'inherit'] : 'inherit',
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 1);

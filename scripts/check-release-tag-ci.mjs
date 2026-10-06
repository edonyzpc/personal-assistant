import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { findVerifiedGeneratedReleaseCi } from './lib/generated-release-ci-evidence.mjs';

const evidence = findVerifiedGeneratedReleaseCi({
  tag: process.env.GITHUB_REF_NAME,
  releaseCommit: process.env.GITHUB_SHA,
  capture: (command, args) => execFileSync(command, args, {
    encoding: 'utf8', stdio: 'pipe', timeout: 15000,
  }).trim(),
});
const outputs = {
  reuse_source_ci: String(evidence.verified),
  reason: evidence.verified ? 'Exact release parent has successful full master CI' : evidence.reason,
  ci_url: evidence.verified ? evidence.url : '',
};
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
}
console.log(JSON.stringify(outputs));

# Full Regression Verification

Date: 2026-07-10  
Code state: uncommitted worktree on `master` at baseline HEAD
`d7ecf477d0357c6275f387f3af9140794bdbe5e9`.

## Automated regression

| Check | Baseline | Final | Result |
| --- | --- | --- | --- |
| Full Jest | 137 suites, 2319/2319, 20.648s | 137 suites, 2351/2351; final `make deploy` run 15.140s | PASS; +32 tests |
| Coverage Jest | 137 suites, 2319/2319, 88.007s | 137 suites, 2351/2351, 104.524s | PASS |
| Statements | 83.22% | 83.36% | non-regressing |
| Branches | 77.83% | 77.85% | non-regressing |
| Functions | 78.13% | 78.50% | non-regressing |
| Lines | 83.22% | 83.36% | non-regressing |
| ESLint | PASS | PASS | PASS |
| Type-check | PASS | PASS | PASS |
| Production build | PASS | PASS | PASS |
| PA fast eval | 9/9 | 9/9 | PASS |
| Third-party notices | 34 packages / 11 resources | 34 packages / 11 resources | PASS |
| Offline npm audit | 0 cached vulnerabilities / 617 deps | 0 cached vulnerabilities / 617 deps | PASS_WITH_LIMIT; cache freshness not claimed |
| Dependency tree | PASS | PASS | PASS |
| Offline `npm ci --dry-run` | PASS | PASS | PASS; no dependency/lockfile change |
| JSON and CI YAML parse | PASS | PASS | PASS |
| Whitespace | PASS | PASS | PASS |
| Community DOM source scan | no matches | no matches | PASS; exit 1/no output is the repository-defined pass |
| Production global Console logger | baseline helper present | helper removed; source/bundle clean | PASS |

`actionlint` is not installed. The workflow was parsed locally and every command
was executed locally, but the first GitHub-hosted run and required-check setup
remain external until a later authorized commit/push.

## Bundle/package guard

- Baseline: 4,009,105 bytes; gzip 1,280,858 bytes.
- Final: 4,021,085 bytes; gzip 1,283,422 bytes.
- Delta: +11,980 raw bytes and +2,564 gzip bytes; gzip remains 289,442 bytes
  below the 1,572,864-byte budget.
- No dynamic script element creation; only the existing allowed
  `worker_threads` reference.
- This is an artifact-size guard, not a runtime performance benchmark.

## Real Obsidian test-vault smoke

Deployment and runtime:

- `make deploy`: PASS; final run included 137/137 suites, 2351/2351 tests,
  lint, type/build, and the four standard copied assets.
- App: Obsidian 1.13.1, installer 1.12.7, repository-local `test/` vault.
- `/usr/local/bin/obsidian` could not attach to the running app in this final
  session, so reload/eval evidence used a cold app restart plus the visible
  DevTools Console and Computer Use. No CLI result is represented as a pass.
- The pre-existing exact plugin residue was checked only by metadata (3,450
  bytes), never read. After cold start of the deployed bundle,
  `test/.obsidian/plugins/personal-assistant/logs.txt` was absent.

Provider-free runtime runner:

- Artifact: `test/pagelet-smoke-runtime-result.json` (ignored test-vault
  runtime artifact).
- Window: `2026-07-10T09:40:47.299Z` to `09:40:47.684Z`.
- Result: 28 PASS, 0 FAIL/BLOCKED/SKIP, empty `bugs`.
- Verified plugin load, Pagelet settings and command registration, retired
  commands, panel/pet mounts, Level 2 low-risk creation-time confirmation,
  task-constraint manual handling, state restoration, and background status.
- The first run exposed one false concurrent-convergence warning. After the
  minimal idempotency fix, independent review, rebuild, and cold reload, the
  second run passed without recurrence.

Visible UI/UX evidence:

- Settings -> Personal Assistant displayed understandable Level 2 copy:
  “Remember trusted suggestions automatically” and explicitly retained review
  for conflicts/task constraints.
- Clicking the toggle persisted `memoryAutoAcceptPaused: true`; clicking again
  persisted `false`; the test trust count remained 30 during this probe.
- A uniquely named synthetic canonical record rendered as an active,
  low-sensitivity, auto-accepted preference with source evidence and a Remove
  action.
- Remove opened a focused modal explaining that the original note is unchanged
  and a text-free marker remains. Cancel closed the modal and preserved the
  record.
- After explicit action-time approval, Confirm changed that exact record to a
  `forgotten_tombstone` with summary length 0 and zero source refs; its linked
  queue item persisted as `undone`.
- The pre-smoke Review Queue, Memory ledger, count, and pause state were then
  restored through the plugin settings path. A cold restart proved count `0`,
  pause `false`, zero synthetic records/items, the legacy log still absent, and
  no fresh app error.
- No provider prompt, paid endpoint, Memory rebuild, note mutation, external
  network call, commit, or push was used.

App-smoke closure: **PASS**.

## Performance decision

No controlled large-vault or product-latency benchmark exists for these paths.
Under `RUN_PERFORMANCE_BENCHMARKS=auto`, latency, CPU, memory, and I/O were not
measured. Test durations and bundle size are not presented as runtime
performance improvements. OPT-010 removes a proven duplicate full-rescan caller
but makes no percentage claim.

## Current conclusion

- No automated regression, build, package, source-security, or provider-free
  runtime failure remains.
- No known introduced P0/P1/P2 remains after independent re-review.
- Code conclusion: PASS.
- App closure: PASS.

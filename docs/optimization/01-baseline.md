# Optimization Baseline

## Baseline identity

- Commit: `d7ecf477d0357c6275f387f3af9140794bdbe5e9`
- Branch/upstream: `master` / `origin/master`, ahead `0`, behind `0`
- Worktree before optimization files: clean
- Measurement window: `2026-07-10T11:19:18+08:00` to `2026-07-10T11:26:19+08:00`
- Runtime: Node `v22.22.3`, npm `10.9.8`, macOS, Obsidian `1.13.1` (installer `1.12.7`)

All commands ran from the repository root. Generated build/coverage output was
ignored by Git; tracked generated CSS remained byte-stable. The Jest release
tests that print temporary branch operations did not change this repository:
the current branch and HEAD were rechecked as `master` and the baseline commit.

## Command results

| Check | Command | Exit | Result | Duration/evidence |
| --- | --- | ---: | --- | --- |
| Installed dependency tree | `npm ls --depth=0` | 0 | PASS | 35 production and expected development packages resolved; no missing/extraneous error |
| Lockfile install plan | `npm ci --dry-run --ignore-scripts --offline` | 0 | PASS | 0.798 s wall time; dry-run planned 48 platform-optional packages; package/lockfile unchanged |
| Full serialized tests | `npm test -- --runInBand` | 0 | PASS | 137/137 suites, 2319/2319 tests, 0 snapshots; Jest 20.648 s |
| CI coverage gate | `npm test -- --runInBand --coverage` | 0 | PASS | 137/137 suites, 2319/2319 tests; Jest 88.007 s |
| Coverage totals | coverage report from prior command | 0 | PASS | statements 83.22%, branches 77.83%, functions 78.13%, lines 83.22%; all exceed configured thresholds 75/71/74/75 |
| Lint | `npm run lint` | 0 | PASS | ESLint completed with no diagnostics |
| Independent type check | `npx tsc -noEmit -skipLibCheck` | 0 | PASS | No diagnostics |
| Production build/package | `npm run build` | 0 | PASS | Type check, minified Tailwind and production esbuild completed; Tailwind reported 644 ms |
| Third-party notice integrity | `npm run check:third-party-notices` | 0 | PASS | 34 runtime packages and 11 bundled resources covered |
| Bundle audit | `npm run audit:bundle` | 0 | PASS | 4,009,105 bytes; gzip 1,280,858 bytes vs 1,572,864-byte budget; no dynamic script element creation |
| PA contract eval | `npm run eval:pa:fast` | 0 | PASS | 1/1 suite, 9/9 tests; 0.177 s |
| Community DOM source scan | `rg -n "createElement\\([\"']style[\"']\\)|\\.innerHTML\\s*=|\\.outerHTML\\s*=" src` | 1 | PASS | No output; repository rule defines exit 1/no matches as pass |
| Offline dependency advisory scan | `npm audit --offline --json` | 0 | PASS_WITH_LIMIT | Local advisory data reported 0 vulnerabilities across 617 dependencies; no online freshness claim |
| Whitespace integrity | `git diff --check` | 0 | PASS | No whitespace errors |
| Deploy gate | `make deploy` | 0 | PASS | 137/137 suites and 2319/2319 tests, lint, build, then four standard assets copied to `test/` |

## Deterministic PA behavior baseline

Input: the seven versioned JSON fixtures in `__fixtures__/pa-eval/cases/`,
evaluated against the synthetic vault in `__fixtures__/pa-eval-vault/` without
provider credentials.

Observed output:

- retrieval includes a real source reference and excludes private sources;
- Context Pager source/memory/scope counts match the recorded trace;
- Quick Capture preserves original text and carries source-capture provenance;
- Review Queue accepts only canonical item types and requires base fields;
- saved insights remain source-backed with weak-only influence;
- confirmed/forgotten Memory records obey evidence and tombstone privacy rules;
- Maintenance Review remains preview-first, forbids permanent delete, applies
  only selected move actions, and records a reversible move-back path.

Negative fixtures were also exercised by the same nine-test suite. Deliberate
private-source leakage, raw replay excerpts, wrong context counts, missing
capture provenance, forgotten-Memory text/source retention, and hard delete
plans each produced the expected readable failure. This is evidence that the
harness rejects those violations rather than merely passing positive fixtures.

## Real Obsidian app baseline

The plugin was built and deployed before the app checks. No chat prompt,
provider request, Memory rebuild, settings mutation, or vault write was
triggered.

| Probe | Observed result |
| --- | --- |
| `obsidian vault info=path vault=test` | repository-local `<repo>/test` vault |
| `obsidian plugin:reload id=personal-assistant vault=test` | Reloaded successfully |
| `obsidian plugin id=personal-assistant vault=test` | Personal Assistant `2.8.4`, enabled |
| Open Pagelet fixture and `pa-pagelet:open-panel` | Command succeeded; `.pa-pagelet-panel` count `1` |
| Pagelet panel text | Current-note scope, one selected note, ~168 units, one used source, zero memories/skips, explicit `Review selected (1)` action |
| Open Chat | `.llm-view`, `.llm-chat-container`, and `.llm-input` counts all `1` |
| Open Records Preview | legacy ID selector and `.pa-recordlist-preview-view` counts both `1` |
| Open Statistics | `.pa-statistics-view` count `1` |
| Non-secret settings probe | provider `qwen`; chat model configured; Pagelet enabled; preload disabled |
| Fresh error capture | `obsidian dev:errors vault=test` returned `No errors captured.` |
| Screenshot artifact | `/private/tmp/pa-optimization-baseline.png`, 366,658 bytes |

This is an app-runtime mount baseline, not a claim that every visible UX path
or provider-backed workflow was manually exercised.

## Failure classification

- `BASELINE_FAILURE`: none.
- `ENVIRONMENT_BLOCKER`: none remaining for the measured gates. Obsidian was
  initially not running; after local launch, CLI IPC and runtime probes passed.
- `FLAKY`: none observed. Full suites passed in three independent invocations
  (serialized, serialized with coverage, and `make deploy` default scheduling).
- `UNKNOWN`: none in executed checks.

## Performance baseline decision

`RUN_PERFORMANCE_BENCHMARKS=auto` resolved to **not run runtime benchmarks**.
The repository contains no versioned benchmark command or controlled large-vault
fixture that can support comparable latency/CPU/memory/I/O claims. Test times
above are execution evidence, not a product-performance benchmark. The bundle
audit is retained as a deterministic artifact-size guard, not described as a
runtime speed improvement.

## Baseline limitations

- The offline npm advisory result may be stale because network access was not
  used for advisory refresh.
- Provider-backed, paid, external-network and destructive/write paths were not
  invoked.
- Android physical-device behavior remains outside this run.
- Full visible UI/UX interaction is reserved for tasks that actually change a
  visible surface; the baseline establishes mount and fresh-error behavior.

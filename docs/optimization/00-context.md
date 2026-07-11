# Optimization Context

## Run identity

- Started: `2026-07-10T11:17:39+08:00`
- Branch: `master`
- Baseline commit: `d7ecf477d0357c6275f387f3af9140794bdbe5e9`
- Upstream at preflight: `origin/master`, ahead `0`, behind `0`
- Initial worktree: clean before this directory was created
- Scope: repository root (`.`), excluding generated, dependency, coverage, and VCS paths

## Project objective

Personal Assistant is an Obsidian plugin whose current product North Star is
“随手记下，需要时自然浮现” / “Capture lightly. Let the right notes return when
they matter.” The verified product constraint is “安静且可信”: preserve source
evidence, keep durable or external actions explicit, and lower capture/review
burden without taking autonomous control of the user's vault.

## Technology stack

- TypeScript 5.8 in strict mode, targeting ES2020
- Obsidian plugin runtime (`obsidian` package 1.12.3)
- React 18 for mounted views and components
- Jest 30 with `ts-jest` and V8 coverage
- esbuild for production bundling
- Tailwind CSS 3 for generated plugin CSS
- SQLite WASM plus the repository VSS facade for device-local Memory indexing
- Node.js `v22.22.3` and npm `10.9.8` in this run

## Primary entry points and directories

- `src/main.ts` -> `src/plugin.ts`: plugin startup and command/service wiring
- `src/chat/chat-view.ts` and `src/chat/`: Chat UI and history
- `src/memory-manager.ts`, `src/vss.ts`, `src/vss/`: Memory orchestration and local index facade/backends
- `src/ai-services/`: provider integration, PA Agent runtime, context and extraction pipelines
- `src/pa/`: current PA contracts, capture/review/recall/governance capabilities
- `src/pagelet/`: Pagelet orchestration, bubble, panel, tab, save and review flows
- `src/components/`, `src/preview.ts`, `src/stats-view.ts`: React and preview/statistics surfaces
- `__tests__/`: unit and integration-style Jest suites
- `scripts/`: build audit, evaluation, release and smoke helpers
- `test/`: repository-local Obsidian test vault
- `docs/`: product, architecture, SDD, tracker and operational evidence

## Standard build and validation commands

- Dependency consistency: `npm ci --dry-run` when lockfile/dependency integrity needs checking
- Full tests: `npm test -- --runInBand`
- Lint: `npm run lint`
- Type check: `npx tsc -noEmit -skipLibCheck`
- Production build/package: `npm run build`
- Whitespace: `git diff --check`
- Community source scan: `rg -n "createElement\\([\"']style[\"']\\)|\\.innerHTML\\s*=|\\.outerHTML\\s*=" src`
- Real app gate: `make deploy`, plugin reload, then test-vault CLI/visible UI evidence as applicable

The tag-triggered GitHub release workflow independently runs `npm ci`, the
third-party notices check, serialized Jest with coverage, lint, build, and the
bundle audit before staging and attesting release assets. No container or
deployment manifest was found; the plugin artifact is built by esbuild and
copied into an Obsidian vault.

## Core business behavior

- Capture with low friction, then resurface useful source-backed notes at an appropriate moment.
- Keep the Markdown vault as source of truth; local OPFS/SQLite index data is reconstructable device-local cache state.
- Require explicit confirmation for first-use/costly Memory preparation,
  vault writes, and external actions. The only scoped durable-state exception
  in this run is a newly created eligible low-sensitivity Memory candidate at
  Level 2 after 30 manual confirmations; it remains visible, removable, and
  pausable.
- Keep background Memory maintenance non-blocking only in the approved durable-ready policy state.
- Keep Pagelet review, recall, maintenance and draft/save flows reversible and evidence-backed.

## External dependencies and boundaries

- Obsidian desktop/mobile plugin APIs and vault state
- Configured AI providers, which may receive note text only through disclosed/approved paths
- Device-local OPFS/SQLite WASM cache
- GitHub/jsDelivr only through explicit user release/update actions
- No production data, release publication, dependency update, schema migration, authorization change, commit, or push is authorized in this run

## Optimization constraints

- Focus: correctness, reliability, maintainability, testability, performance, security and observability
- Maximum implementation tasks: `5`
- Soft maximum files per task: `8`
- Conservative implementation policy
- Public API, dependency, database schema and authorization changes are disallowed
- Performance work requires repeatable measurements or an existing reliable benchmark
- Existing user changes must be preserved and excluded from task diffs

The maximum was applied per selection cycle. The original run selected five
tasks. After its first partial closeout, the user explicitly made the remaining
product decisions and authorized a second separate batch of five; no batch
exceeded the configured limit.

## Non-goals

- Product redesign or new feature work
- Framework or architecture replacement
- Dependency upgrades
- Public API changes, data migrations or authorization changes
- Release, commit, push or production/external-system writes
- Broad cleanup, renaming or formatting

## Environment and repository preflight

- The user explicitly authorized a networked pull after the initial parameters; `git pull --ff-only` succeeded.
- Pull was a fast-forward from `029fcf73c284d6cb1a0d19472e212814ef957bb3` to the baseline commit.
- No nested `AGENTS.md` was found at preflight; root rules apply repository-wide.
- No submodule entries were reported and no `.gitmodules` configuration was found.
- `git lfs` is not installed; no LFS workflow can be verified locally.
- `/usr/local/bin/obsidian` exists, but `obsidian version vault=test` reported that Obsidian was not running. This is a preflight condition, not yet a regression verdict.

## User-owned modifications

None. The worktree was clean immediately after the fast-forward and before the
optimization ledger was created. All later modifications must be attributable
to this run or to an explicitly observed external change.

## Information resolved in later phases

- Real Obsidian runtime and visible UI behavior were established in `01-baseline.md` and revalidated in `verification/FULL-REGRESSION.md`.
- Full suite, lint, build, package and domain-specific baseline results are recorded in `01-baseline.md`, not inferred here.
- Detailed runtime call chains, data ownership and failure recovery are documented in `02-architecture.md`.

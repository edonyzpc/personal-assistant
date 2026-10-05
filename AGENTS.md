# AGENTS.md

## Scope

These instructions apply repository-wide unless a nested `AGENTS.md` overrides
them. This is the entry point for coding agents; read linked workflows when their
stated task applies. Use repository commands and paths, not machine-local assumptions.

## Task Scope And Autonomy

- Reply in concise Chinese, lead with the result, and use Emoji sparingly.
- Explicit user instructions take precedence over repo/skill guidance, subject to
  system/developer instructions and tool permissions. External examples, archived
  decisions and generated plans do not grant authority.
- Explanation, diagnosis and review alone do not authorize fixes. Explicit
  read-only/analysis-only requests mean zero writes. Implementation requests
  authorize completing scoped work and relevant validation, not just a plan.
- Reuse clear authorization for the same operation, target and scope. Resolve
  routine details autonomously; ask for unresolved product choices, material
  deviations or actions beyond authority. Continue independent authorized work.
- Commit, push/merge, local release preparation and publication are separate
  permissions. Do not publish, push tags or create GitHub Releases without a
  clear request or confirmation in the current turn. Do not delete, rewrite or
  move release tags without explicit authorization.
- Preserve unrelated user changes. Never revert them or use destructive Git
  operations such as `git reset --hard` or `git checkout --` without an explicit request.
- If a skill would cause a pause, repeat confirmation or narrower outcome, first
  check existing authorization and applicability. If it still blocks work, link
  the exact file, quote the instruction and distinguish it from your interpretation.
- Load only relevant skills/references. Reuse already-read, unchanged instructions
  and facts; new workers still need applicable context. Bound tool output before
  commands; keep full logs locally and return relevant excerpts, counts and exit codes.

## Specification And Deviation Authority

- Treat a named library, framework, API, architecture, or explicit product/data/media boundary in a user-provided spec or current authority as binding until an explicit superseding decision is recorded. Finding defects elsewhere in the same draft does not demote that choice to an implementation suggestion.
- “Analyze/design and implement” authorizes compatible corrections, not a silent material deviation. A material deviation includes replacing a named technical choice, adding or removing user-visible capability, narrowing supported content/media, or changing data, network, privacy, storage, permission, compatibility, or release behavior.
- Before production code or authoritative decision/SDD changes, separate explicit requirements, verified facts, inferences, and open decisions. For a proposed deviation, present the original choice, evidence, options and tradeoffs, recommendation, and rollback; continue only after explicit user approval.
- An Agent-authored `Accepted`/`Approved` status, Decision, Product Spec, SDD, test, or implementation cannot itself prove user approval or supersede a known source constraint. If an unapproved deviation is discovered after implementation, label it honestly and ask whether to restore the original constraint or accept a new dated decision; never backdate approval. Retain the source until the resolved outcome is absorbed under the documentation lifecycle.

## Proportionate Design And Delivery

- Minimal scope must fully satisfy the authorized behavior with clear responsibilities
  and maintainable code, not merely fewer lines. Concise replies do not require
  compressed source code.
- These constraints apply to the lead agent, writers and reviewers throughout
  design, implementation and validation. Ground new abstractions, mechanisms,
  state and rules in a current requirement or evidenced failure. Prefer existing
  capabilities; future possibilities, external examples or architectural symmetry
  alone do not justify expanding the work.
- A review suggestion becomes a fix only with a concrete trigger, consequence
  and violated requirement or invariant. Distinguish defects from preferences
  and unconfirmed concerns; reviewers may revise or withdraw their findings.
- Once scoped requirements and required gates are satisfied and confirmed
  blockers are resolved or explicitly deferred, deliver. Further design, review
  or testing needs a new concrete risk or requirement. Do not add process layers,
  reports or approval steps merely to enforce these constraints.

## GPT-6 And GLM Delivery

- GPT-6 owns product discussion, design, authoritative docs, decomposition,
  dispatch, Tracker and independent acceptance. GLM owns bounded investigation,
  implementation, tests, self-review and assigned validation through the separately
  configured Codex CLI. Never describe another model as GLM.
- When planning, dispatching, continuing or accepting this workflow, GPT-6 reads the
  applicable sections of [GPT-6 / GLM delivery](docs/development/workflows/gpt6-glm-delivery-workflow.md).
  It owns task templates, provider/tool preflight, quota takeover, risk-based
  review, validation assignment, recovery, cleanup and device setup. Preserve its
  model routing and independent review requirements; do not silently change ownership.
- GLM reads its assigned task and necessary contracts; it need not load the full
  orchestration/configuration guide without a specific need.
- Necessary PA source/tests/contracts and redacted results may go to configured
  `pa-glm` / ZAI for the same authorized scope. Exclude private vaults, secrets,
  sensitive raw logs and unrelated workspaces. A new provider/endpoint or expanded
  data scope requires a user decision.
- Delegate concrete independent work when useful, with disjoint edit ownership.
  Small single-path edits need no artificial split. GPT acceptance inspects actual
  diffs and original evidence instead of repeating valid worker checks.

## Product North Star

> 随手记下，需要时自然浮现。 — Capture lightly. Let the right notes return when they matter.

Design philosophy: **安静且可信**. Read the relevant
[Product North Star](docs/product/pa-product-north-star.md) guidance when a task
involves product behavior, user experience or product tradeoffs. Pure engineering
planning, documentation maintenance and local fixes without such decisions use
these root rules and the affected contracts. The North Star remains the product
standard unless the user explicitly chooses another direction.

## Dev Environment Tips

- Obsidian plugin in TypeScript; Node 22 LTS and npm 10.x or 11.x.
- Entry: `src/main.ts` → `src/plugin.ts`; Chat: `src/chat/chat-view.ts`.
- Memory: `src/memory-manager.ts`; VSS facade: `src/vss.ts`; index backends: `src/vss/`.
- AI/Agent: `src/ai-services/`; context: `src/ai-services/context/`;
  memory extraction: `src/ai-services/memory-extraction/`.
- UI: `src/components/`, `src/preview.ts`, `src/stats-view.ts`.
- Tests: `__tests__/`; docs: `docs/`; local Obsidian test vault: `test/`.
- Automated task skills: `.agents/skills/`; scenario playbooks: `.agents/playbooks/`.
- Prefer `rg` / `rg --files`, use `apply_patch` for manual edits, and resolve paths
  from the repo root.

### Context Limit Constants

Read current limits in `src/ai-services/pa-agent-runtime.ts` and
`src/ai-services/memory-search-tool.ts`; do not mirror numeric values here.

## Build And Local Run Commands

- Install dependencies: `npm install`.
- Dev bundle: `npm run dev`.
- Tailwind watch: `npm run dev:tailwind`.
- Tailwind build: `npm run tailwind:build`.
- Full build: `npm run build`.
- Lint: `npm run lint`.
- Source tests (no `dist/` prerequisite): `npm test`.
- Focused source test: `npm test -- --runInBand <suite>`.
- Tooling/fixture contracts: `npm run test:tooling -- --runInBand`.
- Build-bound receipt/probe tests: `npm run test:artifacts -- --runInBand` (build first).
- Complete test/coverage gate: `npm run test:all -- --runInBand --coverage` (build first).
- Documentation contracts: `npm run test:docs -- --runInBand`.
- Type-check: `npx tsc -noEmit -skipLibCheck` or `npm run build`.
- There is no `npm run tsc` script.
- Whitespace check: `git diff --check`.

## Testing Instructions

- Docs/skills-only: `npm run docs:check`, `git diff --check` and affected existing
  contract suites. No plugin build, TypeScript or app/device smoke unless
  executable/runtime assets change.
- Narrow changes: closest relevant tests first. For Memory/VSS/chat, select by
  affected behavior, call paths and integration boundaries, not module names.
- Broad behavior, release, packaging or shared infrastructure: lint, production
  build, `npm run test:all -- --runInBand` and diff check. Release-specific reuse
  and coverage follow [Release Instructions](#release-instructions).
- Dependency/lockfile changes: also run `npm ci --dry-run` when practical.
- Add tests for meaningful behavior/regressions, not low-impact wording or
  mechanical implementation mirrors. Repeat/broaden only for changed inputs,
  failures or a concrete unresolved risk.
- App claims require deployment and observation of the affected interaction.
  General mobile validation uses Obsidian CLI mobile simulator; iPhone hardware
  requires an explicit request or verified iOS-specific capability. An Agent's
  plan or simulator/tool failure does not create a real-device gate.
- Report unavailable commands and residual evidence gaps. Local checks, app/device
  evidence, CI and release conclusions remain distinct.

### Agent Behavior Acceptance

- Judge behavior against explicit user requirements, confirmed product contracts
  and observable correctness, not an evaluator's preferred answer or tool path.
  Allow reasonable clarification; a final-format requirement does not prohibit
  gathering needed information, and no deliverable in one turn is not itself failure.
- Length, optional questions, tool counts and additional advice do not alone
  establish a defect. Separate observed behavior from its assessment: a suggestion
  is not an executed effect, and absent effect tools do not prove write protection.
  Do not infer general success rates or attribute a combined change to one mechanism
  from isolated model samples.
- If the acceptance criterion is wrong, correct it with the requirement or user
  decision as the basis; retain the raw evidence and reason for the revised verdict.
  Do not change correct behavior or repeat model sampling to satisfy a faulty rubric.

### Validation Planning And Reuse

- Select evidence by affected behavior and inputs. Add checks only for a concrete
  unknown or regression; reuse valid results across commits, phases and reviewers.
  Build identity is not test success, and focused PASS is not full-suite PASS.
- Keep a compact requirement/risk-to-evidence mapping in the existing Tracker or
  narrow task response; do not create another test plan. Preserve required phase,
  app/device, CI and release gates and distinguish them from optional diagnostics.
- When planning or reusing validation, read [GOV-001 validation details](docs/development/governance/gov-001-agent-managed-project-lifecycle.md#validation-evidence-and-diagnosis).
  It owns evidence fields, invalidation, enclosing-check reuse and opt-in cost studies.

### Test Failure Diagnosis

Use [GOV-001 failure diagnosis](docs/development/governance/gov-001-agent-managed-project-lifecycle.md#test-failure-diagnosis)
when a check fails: distinguish product, acceptance, tooling, environment and build
issues. Retry with new information; never weaken correct assertions to obtain PASS.

### Multi-Agent Validation Coordination

For parallel work, use [GOV-001 coordination](docs/development/governance/gov-001-agent-managed-project-lifecycle.md#independent-review-and-validation-coordination).
Assign disjoint writers; one executor runs expensive gates against frozen inputs.
Read-only review remains zero-write, and valid contributor evidence is reused.

### Local Validation Gate

For code/DOM changes, scoped to the changed surface and reusing covered checks:

```bash
npm test -- --runInBand <focused suites>
npx tsc -noEmit -skipLibCheck
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

For this `rg`, exit 1 with no output is PASS. Inspect matches. Use the matching
source/tooling/artifact group; artifact and full suites require a current
production build first. Docs-only follows Testing Instructions above.

## Local Deployment

- `make deploy` runs platform guards, lint, production build and full Jest, then
  verifies/copies `dist/{main.js,manifest.json,manifest-beta.json,styles.css}` to
  `test/.obsidian/plugins/personal-assistant/`.
- If required checks already passed for current inputs and a current production
  build exists, use `make deploy-current`. It checks asset identity, not tests;
  stale/missing assets are rejected before modifying the target. Changed tests
  or configuration still need their checks.
- `make deploy-icloud-current` reuses the build for an authorized iCloud test vault.
  When both targets are authorized, `make deploy deploy-icloud` shares one full gate.
- For app smoke, use [obsidian-test-vault-smoke](.agents/skills/obsidian-test-vault-smoke/SKILL.md).
  Deploy, reload/re-enable the plugin, use `command -v obsidian` and CLI/deep links
  to prepare the exact test-vault target, then observe/exercise affected actions.
  Use [iPhone smoke](.agents/skills/obsidian-ios-real-device-smoke/SKILL.md) only
  under the real-device condition in Testing Instructions.
- Packaging must work with `main.js`, `manifest.json` and `styles.css`. New
  worker/WASM assets require coordinated build/deploy/release/install/docs handling.

## Architecture Rules

- Before designing, dispatching, implementing or reviewing PA Agent/runtime/
  command work, apply the [Command Architecture Contract](docs/architecture/pa-agent-architecture-plan.md#command-architecture-contract).
  In the existing SDD/task record, map material decisions, admission conditions,
  state transitions and effects to their owner and factual basis. Check this
  responsibility contract before accepting implementation or green tests;
  narrow fixes need no new artifact. Keep the definition in that architecture
  section, not in per-command rules or another workflow.
- Don't add error handling for scenarios that can't happen. Trust internal
  code and framework guarantees. Only validate at system boundaries.
  Boundaries include user/provider input, persisted or synced state, files,
  network and external processes, deployment, and concurrent/cross-tree
  handoff. An internal function call is not itself a boundary. Preserve
  handling for demonstrated failures, cancellation, revocation and races;
  do not invent impossible states or silently swallow broken invariants.
- Prefer existing module boundaries, platform APIs, and project helpers over new
  parallel abstractions. Add foundational utilities, dependencies, or abstractions for
  a current verified need, and explain why existing capabilities do not fit.
  Do not build generalized frameworks for speculative future requirements.
- Keep naming, control flow, state ownership, side effects, error recovery, and
  lifecycle understandable without the implementation conversation. Use clear
  intermediate steps and local helpers when they make changes easier to follow;
  comments should explain non-obvious constraints and choices.
- Memory behavior belongs in `MemoryManager`; vector/index operations stay behind
  `VSS` and `VectorIndex`. Markdown is source truth; OPFS is device-local cache.
  All index mutations use the VSS queue/exclusive lock. Fallback automatic
  maintenance stays read-only.
- For Memory/VSS implementation or review, read the relevant
  [architecture](docs/architecture/vss-sqlite-wasm-architecture.md#authority-and-product-boundary)
  and [refresh/maintenance](docs/architecture/vss-embedding-refresh.md#当前关键机制)
  sections. They own readiness, policy/lifecycle admission, recovery and scheduling.
  Apply [DEC-028](docs/product/decisions/dec-028-silent-memory-auto-prepare.md) for
  first-use/rebuild changes: its exception permits one silent first-use eligible-vault
  rebuild; other recovery/manual/costly rebuild paths retain confirmation. Unknown
  marker truth does not authorize destructive reset or provider work.

## Memory/VSS Product Rules

- Normal users should see product language such as `Memory`, `Memory from your notes`, `Prepare memory`, and `Update memory`.
- Internal terms such as VSS, RAG, embedding, SQLite, OPFS, chunks, backend, stale, fallback, and vector are acceptable in code, logs, diagnostics, and docs, but should not appear in ordinary chat or settings copy.
- Confirmation prompts must explain:
  - Data: notes are not modified or deleted.
  - AI provider: note text may be sent to the configured AI provider when preparing Memory.
  - Cost: AI credits/API calls may be used; unchanged notes are skipped when possible.
- Chat stays responsive during permitted background updates; do not claim
  maintenance is running when the backend cannot perform it. Manual update retains
  progress/error feedback. Background failures retain dirty state and retry with
  backoff without repeated intrusive notices.

## UI And React Rules

- For React-based `ItemView` or command UI, mount with `createRoot(container).render(...)`
  and unmount that root in `onClose`, teardown, or toggle paths.
- Preserve the existing rendering approach in other interfaces unless the task
  requires changing it.
- Pass `app` and `plugin` through props or context; avoid new globals.
- Keep CSS scoped and avoid leaking styles into Obsidian core UI.
- Prefer existing `pa-` classes and local style conventions.
- Build Tailwind before packaging.
- Lazy-load heavy UI libraries such as Chart.js.
- Clear observers, timers, listeners, and debouncers on unmount/unload.
- Preserve user settings such as `statisticsType`, `previewLimits`, and `targetPath` when re-rendering views.

## Obsidian Community Review Rules

- Treat Obsidian community review `Error` findings as release blockers. Fix them before publishing or preparing a publish-ready release.
- Do not create, update, or attach runtime `<style>` elements. Put plugin CSS in the Tailwind source `src/custom.pcss`, run `npm run tailwind:build` or `npm run build`, and let Obsidian load the generated `styles.css`.
- Do not assign to `innerHTML` or `outerHTML` in plugin code. Build DOM with `createElement`, `createElementNS`, `textContent`, attributes, `appendChild`, and explicit child-clearing helpers instead.
- When rendering SVG, prefer DOM construction with `document.createElementNS` and node replacement over parsing SVG markup through `innerHTML` or `<template>`.
- It is acceptable to keep CSS custom properties that contain SVG strings for Obsidian callout icons in `styles.css` or `src/custom.pcss`; the community source-code blocker is runtime DOM HTML/style injection.
- For Pagelet or other UI changes that touch DOM/CSS, run the `rg` community-scan command from the **Local Validation Gate** above and manually inspect any matches.
- Community review warnings such as `window.setTimeout` versus `setTimeout`, `activeDocument` versus `document`, direct style assignment, and `Vault#configDir` should be addressed opportunistically, but release-blocking `Error` findings take priority.

## Documentation Instructions

- Use [pa-docs-lifecycle-manager](.agents/skills/pa-docs-lifecycle-manager/SKILL.md)
  when the task requires durable idea capture, creating/updating task records,
  authority changes or lifecycle transitions such as closeout/archive. Ordinary
  discussion, read-only status lookup and local fixes use these root rules and
  relevant existing records/contracts without loading a lifecycle workflow merely
  for their task label. Casual ideas stay in chat; no default external tracker.
- [Documentation Workflow](docs/development/documentation-workflow.md) owns document
  roles, authority, templates, execution packages and closeout/archive rules. Read
  its relevant section when creating, moving, updating authority or closing docs.
  Repo docs hold durable decisions; external material is input/provenance, not approval.
- Tracker alone owns execution status; Feature Home/registry link to it. Use the
  lightest applicable lane and existing records, not new lifecycle artifacts for
  narrow contract restoration. Plan/SDD follow actual complexity.
- For requested architecture/plans, prefer durable docs in `docs/`. Use Mermaid
  unless image assets are requested. Keep current behavior distinct from proposals
  and historical evidence; archived work does not provide current approval/status.
- Update the affected authority when behavior, commands, packaging, release process
  or architecture changes. Release: [release process](docs/operations/release-process.md);
  Memory/VSS: [SQLite/WASM architecture](docs/architecture/vss-sqlite-wasm-architecture.md)
  and [embedding refresh](docs/architecture/vss-embedding-refresh.md).

## SDD-Driven Development

Establish product scope before runtime implementation; use the Governance lane
for repo-only work. Follow [Documentation Workflow](docs/development/documentation-workflow.md)
for the owning contract and minimum artifacts, and
[sdd-lifecycle](.agents/skills/sdd-lifecycle/SKILL.md) for substantial delivery.
Use [Pagelet SDD guide](docs/development/workflows/pagelet-sdd-guide.md) for Pagelet
delivery and [write/action design](docs/architecture/write-action-framework-sdd.md)
plus the current Command Architecture Contract for action boundaries.

## Refactor Workflow

For repo-scale refactors, use [Refactor Workflow](docs/development/workflows/refactor-workflow.md).
Create a separate Plan only when its content cannot fit clearly in the Tracker.
Review concrete risks, resolve/defer confirmed blockers and reuse valid evidence;
affected runtime/UI phase exits require deployed test-vault interaction. This
does not require repeating every step after each edit.

## Release Instructions

- For beta work use [pa-brat-beta-release](.agents/skills/pa-brat-beta-release/SKILL.md);
  for stable releases use [stable-release](.agents/skills/stable-release/SKILL.md).
  [Release Process](docs/operations/release-process.md) owns commands, source/CI
  eligibility, assets and post-publish verification. Read it for release tasks.
- `master` is the sole integration/release source, including accepted docs/governance.
  Work branches are optional isolation; beta branches contain only generated
  packaging above verified master. Never merge/rebase beta packaging back to master.
- Preserve separate Git/release authority from Task Scope. Lifecycle docs findings
  remain visible but do not block otherwise eligible releases; release-critical
  docs use `docs:check:release`.
- Let release automation own its gates and valid CI reuse; do not prepend another
  full gate. Normal beta packaging reuses feature acceptance; installation smoke
  is triggered by changed runtime asset layout, packaging/install behavior,
  plugin identity/platform, a concrete failure or an explicit request.
- `make changelog` writes files; use `node scripts/changelog.mjs --target-version x.y.z`
  for read-only preview. Release preparation, dry-run and publication are distinct.

## PR And Commit Instructions

- Keep commits small, cohesive, and module-scoped.
- Use Conventional Commits.
- Before committing, inspect:
  - `git status --short`
  - `git diff --stat`
  - targeted `git diff -- <path>`
- Stage only intended files. Do not include unrelated user edits.
- Never revert user changes unless explicitly requested.
- A successful push receipt for the explicit destination proves that push was
  accepted. Query remote refs again only for an ambiguous result, a concurrent
  change/rewrite, or when the next operation needs current remote state. Verify
  required signatures once per immutable commit/tag and reuse the result.
  Release scripts own their source/ref/version/asset checks; do not repeat
  those checks manually after successful automation without a concrete risk.
- Avoid destructive git operations such as `git reset --hard` or `git checkout --` unless the user explicitly asks.
- If `.git/index.lock` or other git writes are blocked by the environment, request approval for the git operation instead of working around it.

## Review Instructions

- For review requests, lead with findings ordered by severity and include concrete file/line references.
- Do not invent nits if the diff is sound. Say there are no actionable findings and mention remaining verification gaps.
- Separate must-fix correctness issues from optional polish.
- For reported error strings, trace that exact command path before widening scope.

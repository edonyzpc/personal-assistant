# Silent First-Use Memory Preparation Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-08-12
Work item: B-126
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [Silent First-Use Memory Preparation Product Spec](../../../product/specs/pa-silent-first-use-memory-preparation-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: Implementation candidate and local desktop validation are complete in the isolated PR #378 worktree；delivery remains `Planned` while the remaining validation boundary is resolved.
- Next action: 保留本 track 的 B-126/DEC-028 身份；进入 B-126 validation 后，如需关闭 iOS Keychain 风险边界，先取得明确 real-device smoke 授权。
- Blocker / decision needed: None. Owner 于 2026-08-11 已选择方案 A，并在同日后续选择 marker unknown 时方案 1（fail closed）；Fresh Custom、progressive build 与 release timing 不阻塞本 track，也不在本 track 决策。
- Last verified behavior: 最终 source 已通过 189 suites / 4119 tests、typecheck、lint、build、platform guard/self-test、diff/community scan 与隔离 desktop Obsidian smoke；B-126 authority links 已复核，repository-wide `docs:check` 仍受本 PR 不处理的 base-owned 文档阻断；iOS Keychain real-device smoke 未获本轮明确授权，仍为 NOT TESTED。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-126/REQ-01 / B-126/AC-01 | First-use answer-now, no Modal, single background rebuild | [x] | MemoryManager first-use answer-now/active-run assertions passed in the post-race 199-test gate |
| T-02 | B-126/REQ-02 / B-126/AC-02 | Data/cost/opt-out and preparing/ready copy; exclusion boundary | [x] | Chat、Settings、locale and VSS exclusion assertions passed in the 8-suite / 553-test gate |
| T-03 | B-126/REQ-03 / B-126/AC-03 | Active preparation reuse and truthful preparing state | [x] | `activePreparationRun` and policy-admission concurrency passed in the post-race 199-test gate |
| T-04 | B-126/REQ-04 / B-126/AC-04 | Durable success versus failure/abort/marker-publication failure | [x] | Durable-success/failure/compensation matrix and whole-transaction unload race passed in the post-race 199-test gate |
| T-05 | B-126/REQ-05 / B-126/AC-05 | Retain recovery/manual blocking confirmations | [x] | Focused readiness/approval assertions passed in the post-race 199-test gate |
| T-06 | B-126/REQ-06 / B-126/AC-06 | Memory disable and unload lifecycle cleanup on desktop/mobile | [~] | Desktop isolated-vault smoke and lifecycle tests pass; iOS Keychain real-device lane remains NOT TESTED |
| T-07 | CI guard hardening | Platform-sensitive settings/desktop API guard fails closed and self-tests | [x] | Syntax-aware checker, safe/unsafe fixtures and direct CI steps; local current-source scan/self-test pass |
| T-08 | Authority chain | DEC/Product Spec/Data Boundary/VSS Architecture/Active Package/Backlog/registries | [x] | B-126/DEC-028 Silent First-Use authority chain 已建立 |
| T-09 | B-126/REQ-07 / B-126/AC-07 | Unknown-marker destructive rebuild fail-closed truth gate | [x] | Atomic transition pass/abort, unknown-state zero-reset/provider and recovery fixtures passed in the post-race 199-test gate |
| T-10 | B-126/REQ-08 / B-126/AC-08 | Preserve destructive-rebuild reason across failure/restart and roll back failed policy/lifecycle admission | [x] | Guarded restart/reset, policy/admission compensation, dispose/unload and inline-transaction drain fixtures passed in the post-race 199-test gate |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | Accepted DEC lacked a valid Work item and verifiable current Owner provenance; current Data Boundary/VSS contracts still required first-use blocking confirmation. | Route current 2026-08-11 choice through B-126, DEC-028, Product Spec, architecture and Active Package; do not backdate approval. | Link/metadata inspection plus B-126 authority review | Closed for the B-126 authority chain; repository-wide lifecycle findings remain independently owned |
| F-02 | P1 | A failed/aborted first-use rebuild or failed ready-marker publication could be represented too optimistically or upgrade auto policy. | Gate success/policy/status on usable completion and published readiness; keep retryable non-ready state otherwise. | Focused failure/abort/marker tests | Closed by post-race 199-test gate |
| F-03 | P1 | Shell guard warned instead of failing for settings secret reads and whole-line exclusions could hide a render-path violation. | Use syntax-aware fatal checks, positive/negative fixtures and a CI step. | Guard self-test and current-source scan | Closed locally; remote CI pending PR update |
| F-04 | P2 | Memory Settings copy still promised a prompt before every prepare, contradicting DEC-028 first-use behavior. | State the first-use exception while preserving provider/cost/notes-unchanged/opt-out disclosure and other confirmation paths. | Locale assertions and focused UI/settings test | Closed by 8-suite / 553-test gate |
| F-05 | P1 | Treating unhydrated in-memory `marker=null` as fresh-install truth could reset an existing OPFS index and send whole-vault text before IndexedDB revealed the old marker. | Owner selected option 1 on 2026-08-11: persist retry state and hydrate/prove-absent or durable-invalidate marker before destructive reset/provider; otherwise answer-now and wait for store recovery. Ordinary non-destructive retry semantics remain scoped separately. | VSS unavailable-state fixture asserts old marker/index preserved and reset/provider calls 0 | Closed by post-race atomic-state/unknown-state tests |
| F-06 | P1 | Abort/total failure could lose a confirmed rebuild reason after restart, and policy/lifecycle admission failure could expose prepared data as usable ready. | Persist a content-free rebuild guard with the original reason; hydrate it before marker/OPFS inference, retain it on abort/total failure, and use VSS compensation to restore non-ready state when post-build admission fails. | Restart/guard fixtures plus policy/lifecycle failure assertions | Closed by post-race 199-test gate |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-08-11 | Authority baseline | Compared PR head source/docs with DEC-028 and lifecycle workflow | Finding confirmed | Earlier discussion was not used as approval; current Owner choice is the only approval evidence |
| 2026-08-11 | B-126/REQ-01..06 | Source inspection of `MemoryManager`, VSS readiness, Settings toggle and locale keys | Partial | Establishes test/design seams; does not substitute for focused Jest or real-device smoke |
| 2026-08-11 | CI guard hardening | `node --check scripts/check-platform-guards.mjs`; guard fixture self-test; current `src` scan | Pass | Safe fixture accepted; unguarded desktop and same-line cached-secret fallback fixtures rejected nonzero; 339 current TS files pass |
| 2026-08-11 | Authority chain baseline | `DOCS_CHECK_BASE=d22ee75... npm run docs:check` | B-126 pass / repo fail | The 28 baseline findings were outside the B-126 authority chain and remain owned by their independent workstreams |
| 2026-08-11 | Script/diff hygiene | `bash -n`/`node --check` for new guard scripts; `git diff --check` for tracked changes | Pass | New docs are covered by the docs checker; rerun the shared-worktree diff check after all agents finish |
| 2026-08-12 | B-126/REQ-01..08 / B-126/AC-01..08 | `npm test -- --runInBand __tests__/memory-manager.test.ts __tests__/vss.test.ts __tests__/vss-local-state-store.test.ts __tests__/sqlite-vector-index.test.ts __tests__/plugin-lifecycle.test.ts __tests__/chat-view.test.ts __tests__/settings.test.ts __tests__/pa-locales-plugin.test.ts` | Pass | 8 suites / 553 tests on post-race source; includes data/copy, unknown-state fail-closed, atomic replace/abort, guarded restart/reset, policy/admission compensation, unload drain and inline-setup compensation wait |
| 2026-08-12 | Runtime/tooling hygiene | Typecheck、lint、platform guard/self-test、`git diff --check`、community source scan | Pass | Root final gate; build/full CI and applicable Obsidian smoke remain separate |
| 2026-08-12 | Full local regression | `npm test -- --runInBand`; `npm run build`; `make deploy` | Pass | 189 suites / 4119 tests; deploy repeated full Jest, guard, lint and build before copying four assets into the isolated worktree vault |
| 2026-08-12 | Desktop Obsidian smoke | Fresh isolated vault, plugin Settings, advanced Memory controls, fresh Chat setup and token-unknown Chat state | Pass | Settings opened without a passive-token freeze; advanced controls added/removed Memory model immediately; setup Start remained disabled until provider/token state; token-unknown state stayed neutral. Temporary vault registration was removed afterward |
| 2026-08-12 | iOS Keychain real-device smoke | iPhone/iCloud test-vault lane | NOT TESTED | Skill requires an explicit real-device request before `make deploy-icloud`; no iCloud deployment or iPhone validation was authorized in this turn |
| 2026-08-12 | B-126 docs lifecycle validation | `npm run docs:check`; `DOCS_CHECK_BASE=d22ee75... npm run docs:check`; `git diff --check` | Blocked outside B-126 | Silent First-Use uses B-126/DEC-028 without behavior change and introduces no direct checker finding；repository-wide findings remain in unchanged base-owned documents outside this PR |

## Closeout Readiness

- [ ] Owning contract 与实际行为一致。
- [ ] Required review/smoke/release evidence 已记录。
- [ ] 未完成项已进入 Backlog。
- [ ] 稳定结论已吸收到 current contract/tests。
- [ ] 过程文档已标记 delete-after-absorption 或 unique archive evidence。

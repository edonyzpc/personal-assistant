# First-Run AI Setup And Silent Memory Preparation Development Tracker

Document status: Current
Delivery status: Validating
Updated: 2026-08-23
Work item: B-126
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [First-Run AI Setup And Silent Memory Preparation Product Spec](../../../product/specs/pa-silent-first-use-memory-preparation-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: PR #378 merge-gate runtime findings、DEC-029 authority、focused/full automation、当前 build Desktop Obsidian smoke 与 real-iPhone Keychain/reload smoke 已关闭；进入提交前验证。
- Next action: 创建经授权的 commits/更新 PR 后，在新 SHA 上重跑 remote CI。
- Blocker / decision needed: 产品、实现与本地验证选择已闭合；当前无新增 Owner decision。
- Last verified behavior: 当前未提交候选通过 189 suites / 4139 tests、9-suite / 590-test focused gate、typecheck、lint、build/deploy、platform guard/self-test、diff/community scan、Desktop Obsidian 1.13.6 smoke，以及 Edony iPhone 15 上的当前 build Keychain/reload smoke。`docs:check` 通过并逐条报告 28 个 exact known Episodic/Retrieval advisory findings；远程 head `6f28121b` 仍是旧候选。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-126/REQ-01 / B-126/AC-01 | First-use answer-now, no Modal, single background rebuild | [x] | MemoryManager first-use answer-now/active-run assertions passed in the post-race 199-test gate |
| T-02 | B-126/REQ-02 / B-126/AC-02 | Data/cost/opt-out and preparing/ready copy; exclusion boundary | [x] | Exact-body tag/frontmatter/generated/path checks now guard rebuild/refresh/retry/upsert; cache-lag and malformed-frontmatter tests plus EN/ZH public disclosure passed the 2026-08-23 gate |
| T-03 | B-126/REQ-03 / B-126/AC-03 | Active preparation reuse and truthful preparing state | [x] | `activePreparationRun` and policy-admission concurrency passed in the post-race 199-test gate |
| T-04 | B-126/REQ-04 / B-126/AC-04 | Durable success versus failure/abort/marker-publication failure | [x] | Durable-success/failure/compensation matrix and whole-transaction unload race passed in the post-race 199-test gate |
| T-05 | B-126/REQ-05 / B-126/AC-05 | Retain recovery/manual blocking confirmations | [x] | Focused readiness/approval assertions passed in the post-race 199-test gate |
| T-06 | B-126/REQ-06 / B-126/AC-06 | Memory disable and unload lifecycle cleanup on desktop/mobile | [x] | Desktop isolated-vault smoke、lifecycle tests，以及 Edony iPhone 15 当前 build 的 passive Keychain、explicit probe 与 reload lifecycle smoke 均通过 |
| T-07 | CI guard hardening | Platform-sensitive settings/desktop API guard fails closed and self-tests | [x] | Syntax-aware checker, safe/unsafe fixtures and direct CI steps; local current-source scan/self-test pass |
| T-08 | Authority chain | DEC/Product Spec/Data Boundary/VSS Architecture/Active Package/Backlog/registries | [x] | B-126/DEC-028 Silent First-Use authority chain 已建立 |
| T-09 | B-126/REQ-07 / B-126/AC-07 | Unknown-marker destructive rebuild fail-closed truth gate | [x] | Hydrated matching marker admission now gates status/readiness/search/hybrid/chunks/cluster/auto-maintenance; transition-failure and recovery tests passed |
| T-10 | B-126/REQ-08 / B-126/AC-08 | Preserve destructive-rebuild reason across failure/restart and roll back failed policy/lifecycle admission | [x] | Guarded restart/reset, policy/admission compensation, dispose/unload and inline-transaction drain fixtures passed in the post-race 199-test gate |
| T-11 | AI readiness compatibility | Retained-token reload keeps local Memory status available and probes unknown only on explicit provider actions | [x] | Passive Memory status remains Keychain-free；retained/missing token tests passed；real-iPhone explicit Update memory action resolved `unknown` to `present` and reached the normal confirmation before cancellation |
| T-12 | Public data disclosure | EN/ZH README and Manual match silent first-use provider/cost/opt-out behavior | [x] | Public docs now state background first-use、eligible notes、embedding provider、API cost、exclusions、opt-out and retained confirmation paths |
| T-13 | B-126/REQ-09 / B-126/AC-09; B-126/REQ-10 / B-126/AC-10; B-126/REQ-11 / B-126/AC-11; B-126/REQ-12 / B-126/AC-12; B-126/REQ-13 / B-126/AC-13 | Bounded inline setup、token transaction/readiness、first-Settings focus 与 a11y/mobile contract | [x] | Owner 2026-08-23 option 1 routed through DEC-029/Product Spec/SDD；inline/token/lifecycle tests 与 first-collapse persistence tests cover the accepted slice |

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
| F-07 | P1 | When durable marker state was unavailable, opening an existing OPFS index could set `ready`; a failed rebuild-state transition then restored that speculative state and allowed readiness/search without admission truth. | Keep the physical index but require hydrated marker/guard admission before ready/search/auto-maintenance; recovery must retry after state-store availability returns. | Unknown/known-absent transition, readiness, stats, auto-maintenance and search assertions; hybrid fixture updated to use admitted markers | Closed by 2026-08-23 full gate |
| F-08 | P1 | VSS rechecked folder/tag/generated eligibility through MetadataCache after reading Markdown, so cache lag or malformed leading frontmatter could send newly excluded text to the embedding provider. | Re-evaluate the exact latest Markdown body at every provider/write seam and fail closed on malformed frontmatter. | Rebuild、refresh、cache-lag、tag/generated、malformed-frontmatter and provider-zero assertions | Closed by 2026-08-23 full gate |
| F-09 | P2 | Initial token cache state `unknown` made retained-token users see local Memory as unavailable and made explicit AI commands fail before any safe user-triggered probe. | Keep local read-only Memory status token-independent; explicit provider actions probe once, re-evaluate and notify open surfaces without passive render reads. | Retained reload、missing-token Notice、explicit AI/Memory gate and local-probe/no-redraw assertions | Closed by 2026-08-23 full gate |
| F-10 | P1 | Public README/Manual copy still promised approval before every Memory preparation and described Memory as opt-in, contradicting DEC-028 first-use background provider work. | Describe eligible-note scope, embedding provider, API cost, background first-use, exclusions and discoverable opt-out in EN/ZH public docs. | EN/ZH semantic review plus unchanged-base docs-check comparison | Closed by 2026-08-23 docs review |
| F-11 | P2 | Persisting one Settings group state made every missing group default to expanded, so reopening Settings lost the approved first-run focus. | Persist explicit collapse booleans and apply the per-group default whenever a stored key is missing or invalid. | Fresh default, expanded non-AI reopen and collapsed AI reopen fixtures | Closed by 2026-08-23 final B-126 gate |
| F-12 | P2 | When inline setup persistence failed, the compensation save broadcast `settingsChanged` before returning the failure, replacing the form and leaving the error text on a detached status element. | Persist compensation without broadcasting a successful settings change; return the structured failure to the still-mounted form. | Coordinator rollback asserts zero settings notifications; Chat failure fixture asserts visible retryable live feedback | Closed by 2026-08-23 final B-126 gate |

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
| 2026-08-23 | PR #378 merge-gate review | Exact remote head `6f28121b`; GitHub CI; 8-suite focused gate; source/authority/manual inspection | Finding confirmed | Remote CI passed 189 suites / 4124 tests; local focused gate passed 8 suites / 558 tests, but F-07..F-10 and the inline-setup authority decision must close before merge |
| 2026-08-23 | F-07..F-10 remediation | 9 focused suites; full Jest; typecheck; lint; build; platform guards; diff/community scan; independent post-fix review | Pass | 9 suites / 579 tests and 189 suites / 4135 tests pass；`docs:check` remains the same 28 base-owned Episodic/Retrieval findings；current-build Obsidian smoke and inline-setup authority are still open |
| 2026-08-23 | B-126/REQ-09..13 / B-126/AC-09..13 | Owner option 1 routed through DEC-029, Product Spec, SDD, Discovery, Backlog and Tracker; Settings collapse persistence fixed | Pass | Authority records use the current 2026-08-23 choice and do not backdate the 2026-08-10 proposal；Fresh Custom/wizard/Test Connection/PA Cloud remain out of scope |
| 2026-08-23 | Current combined candidate | 9 focused suites；`make deploy` full Jest/lint/build；typecheck；diff/community scan；`npm run docs:check` | Pass with inherited docs advisory | 9 suites / 590 tests；189 suites / 4139 tests；platform guard 339 files；docs checker exits 0 while reporting the same 28 exact content-locked Episodic/Retrieval warnings and no B-126/DEC-029 issue |
| 2026-08-23 | Desktop Obsidian full-ui smoke | Obsidian 1.13.6 test vault；retained-token Memory status；first Settings default/persistence；temporary in-memory inline setup | Pass | Passive token state stayed unknown while Memory showed a local update state, not unavailable；only AI Provider opened by default；Features remained open after reopen while other missing groups stayed collapsed；Qwen Intl selection survived explicit retained-token probe with `aria-pressed=true`, hidden token row and enabled Start；no provider request or save was executed；original settings/localStorage restored；no errors captured |
| 2026-08-23 | Inline setup failure-state regression | Plugin lifecycle、Chat View、Settings focused suites；typecheck；lint；diff check | Pass | 3 suites / 383 tests；failed provider save restores prior token/settings without broadcasting compensation, while the mounted form retains visible retry feedback |
| 2026-08-23 | B-126/REQ-06 / B-126/AC-06；T-11 | Edony iPhone 15、iCloud `test` vault、plugin 2.9.2；current-build Keychain and reload smoke | Pass | `make deploy-icloud` reran 189 suites / 4139 tests、guard、lint and build；`main.js`、both manifests and `styles.css` matched the deployed assets。Passive Chat input and Settings render stayed responsive with token state `unknown`、local `Memory ready` and neutral `Manage API token`；explicit `Update memory now` resolved the retained token to `present` and opened the normal 11-note confirmation，then real-touch Cancel prevented provider work；reload returned to `unknown` with no Notice/error or late progress state。Portrait only；landscape、iPad and Android were not tested |

## Closeout Readiness

- [x] Owning contract 与实际行为一致。
- [ ] Required review/smoke/release evidence 已记录。
- [ ] 未完成项已进入 Backlog。
- [x] 稳定结论已吸收到 current contract/tests。
- [ ] 过程文档已标记 delete-after-absorption 或 unique archive evidence。

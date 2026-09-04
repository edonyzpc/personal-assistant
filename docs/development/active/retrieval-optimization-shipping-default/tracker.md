# B-125 Retrieval Shipping-Default Continuation Tracker

Document status: Current
Delivery status: Implementing
Updated: 2026-09-04
Work item: B-125
Authority: 本次 B-125 continuation 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [PA Active Vault Indexer — B-125 shipping-default amendment](../../../product/specs/pa-active-vault-indexer-product-spec.md#102-b-125-shipping-default-amendment)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: DEC-031 批准的版本化 shipping-default policy、sparse
  rollback 与 positive platform allowlist 已形成候选；独立 risk audit 发现并
  修正 unknown/partial platform 被误当 supported 的 P1；post-fix 多组 affected
  suites 已通过。Feature identity 折回 B-125 后，完整 `make deploy` 与
  Desktop current-App identity/mount/error smoke 已按新 artifact 刷新通过；
  OPFS full-app restart 仅复用行为未变的 pre-fold evidence，不冒充新 SHA 重跑。
  复审未发现剩余 P0/P1/P2。当前 Linux session 无 iCloud/iPhone 能力，
  该预期环境限制不记为产品失败；候选将通过普通工作分支交接到 Mac mini，
  再完成 real-iPhone current-artifact canary 与后续集成/release gate。
- Next action: 获得明确 Git 授权后，在 Linux 将当前完整候选固化到
  `codex/retrieval-default-on-b125` 并推送该工作分支；Mac mini 从精确远端
  commit 接续本 Tracker，完成 local prerequisite、`make deploy-icloud`、
  current-artifact iPhone canary，再决定 master integration 与 Beta 版本。
- Blocker / decision needed: 无未决产品问题。尚未获得 commit、push、Beta
  branch、tag、publish 或 release 授权。Linux 到 Mac 的远端工作分支传递
  需要 commit/push 授权；Mac 上的 iCloud/iPhone 部署需要明确的 real-device
  smoke 请求。Hosted Community scan 同样未获授权；目标 Beta 版本尚未决定。
- Last verified behavior: post-fold `make deploy` 通过 platform guards、完整
  lint、production build 与 210 suites / 5489 tests，并把四项产物部署到
  repo-local `test` vault。Linux Obsidian 1.14.0 / installer 1.11.7 实际加载
  `main.js` SHA-256 `db4c41b174e1e27d983f4d981b53647760cd101e7b813ba7a4cba4727c22089e`；
  raw flags 缺失时 snapshot 为 rollout v1、`featureId=B-125`、
  `sourceDecisionId=DEC-027`、`decisionId=DEC-031`、`platformMask=none` 与
  four-on，不再有独立 track field。Chat view/container/input 各 mount 1，
  fresh errors=0。Lexical-only 与 OPFS full-app restart 的行为证据来自
  pre-fold same-behavior artifact；Mac 仍须从 handoff commit 重建并完成
  current real-iPhone canary。

## Linux To Mac Mini Handoff

### Invariants

- Linux handoff baseline is commit
  `927895722bda2054ac7de7bb13ee2315aa970054`; the B-125 shipping-default continuation candidate currently
  exists only as tracked and untracked working-tree changes above that baseline.
- The current Linux session cannot reach the Mac iCloud path, iPhone Mirroring,
  or Safari Web Inspector. Do not retry those operations here and do not classify
  their expected environment failure as a B-125 product failure.
- Use `codex/retrieval-default-on-b125` only as review/transport state. It is not
  a release source. Do not create any `beta/<version>` branch while the candidate
  is dirty, outside `master`, or not identical to live `origin/master`.
- The final `dist/main.js` SHA-256 built from release-source `master` must equal
  the artifact SHA-256 loaded for the iPhone canary. If integration or a later
  source/dependency change alters that hash, rerun the current-artifact canary.
- The pre-fold Linux current-App artifact SHA-256 is
  `c78cf12096f4cf34bf540a8f49a7548d367d445f8919bb9c7d2677d6059755e7`.
  It contained the obsolete feature split identity and is behavior provenance,
  not the final handoff artifact or a file to copy to Mac.
- The post-fold Linux current-App artifact SHA-256 is
  `db4c41b174e1e27d983f4d981b53647760cd101e7b813ba7a4cba4727c22089e`.
  It passed the exact-source full local deploy gate and loaded-identity smoke.
  Mac must still rebuild from the exact handoff commit, record its own artifact
  SHA and require equality before reusing this receipt.

### Phase L — Freeze And Transfer From Linux

1. Reinspect `git status --short --branch`, the focused runtime/test/docs diffs,
   all tracked/untracked B-125 continuation files, `git diff --check`, and the existing validation log.
2. After explicit commit authority, create the normal work branch
   `codex/retrieval-default-on-b125` from the current baseline without dropping
   any working-tree file. Keep runtime/tests and authority/tracker documentation
   in small Conventional Commit units.
3. Verify the created commits contain every intended file and no generated test
   vault, `dist`, receipt, screenshot, or unrelated user change.
4. After separate push authority, push only that work branch. Record its full
   remote commit SHA and prove the remote ref resolves to the same SHA. Do not
   push `master`, create a Beta branch/tag, or publish from Linux as part of this
   transfer.

Handoff receipt required by Mac: baseline SHA, work-branch full SHA(s), tree SHA,
exact remote branch name, all 25 intended path names/statuses, clean Linux
worktree status after commit, post-fold Linux current-App artifact SHA plus the
clearly labeled pre-fold behavior-provenance SHA, and the Linux gate summary
already recorded above.

### Phase M1 — Rehydrate And Revalidate On Mac Mini

1. Fetch live remote refs, check out the exact handoff work-branch SHA, and prove
   its diff from the recorded baseline is the intended B-125 continuation candidate. Do not
   rely on a stale local `origin/*` tracking ref.
2. Confirm macOS, supported Node/npm versions, a connected/unlocked iPhone,
   iPhone Mirroring, the iCloud Obsidian `test` vault, and Safari Develop target.
   Do not copy Linux `node_modules`, `dist`, repo-local `test` runtime assets,
   OPFS/cache state, or the iCloud plugin directory.
3. Install from the lockfile and run the same-source local prerequisite. For this
   shared runtime/release-sensitive delta, finish with `make deploy`, then retain
   the Mac-built `dist/main.js` SHA-256 and fresh-error result.
4. Any code/test change on Mac invalidates the Linux final-gate receipt; rerun
   the affected tests and the full local/release gate before continuing.

### Phase M2 — Real-iPhone Current-Artifact Canary

1. After an explicit real-device smoke request, run `make deploy-icloud`. Compare
   `dist/main.js`, `manifest.json`, `manifest-beta.json`, and `styles.css` byte for
   byte with the iCloud `test` plugin directory; any mismatch is `FAIL` and stops
   the run.
2. Reload only `personal-assistant` first. Require a new plugin instance and
   `getLoadedPluginBuildIdentity()` with no blocker; its loaded artifact SHA-256
   must equal the matched iCloud `main.js` SHA-256. Allow only the skill-defined
   single vault/App fallback if plugin reload cannot establish identity.
3. In one content-free Inspector probe, require iOS platform support,
   `platformMask=none`, rollout `b125-retrieval-optimization-rollout` version 1,
   `featureId=B-125`、`sourceDecisionId=DEC-027`、`decisionId=DEC-031`, no
   separate track field, and all four effective flags `true`. Also record
   whether sparse raw overrides are absent; if an old explicit `false` exists,
   stop and report the fixture state instead of silently deleting it.
4. Observe one real iPhone Chat path that invokes Memory from notes and one
   relevant Memory status/readiness path. Require responsive UI, no new console
   error, existing confirmation/data-boundary behavior, and no unexpected
   provider/embedding or Markdown mutation claim.
5. Record deploy/asset match separately from device observation. Missing device,
   trust, Mirroring, Develop target, or Inspector after the bounded reconnect
   attempt is `BLOCKED`, not `PASS` and not a product `FAIL`.

This canary does not rerun B-127's 33/47 aggregate, p95/profiler, deterministic
recovery topology, cancellation matrix, or Desktop OPFS restart. Those are not
changed by this shipping-default amendment; the current canary owns iOS shipping-default resolution,
artifact identity, one integrated Chat/Memory path, and fresh errors.

### Phase M3 — Integrate And Reach Beta-Ready Master

1. If the canary fails because of product code, fix it on the work branch, rerun
   affected/full gates and the changed current artifact, and never patch a Beta
   branch. If it passes, update T-05/T-07 and this validation log with the exact
   work-branch SHA, artifact SHA, device/App versions, raw/effective policy,
   observations, skips, errors, and PASS/FAIL/BLOCKED result.
2. Commit the Mac validation evidence, then integrate the accepted work branch
   into `master` by the separately authorized PR or direct integration path.
3. Build final `master` and compare its `dist/main.js` SHA-256 with the iPhone
   canary SHA. Reuse the canary only on an exact match; otherwise redeploy and
   rerun it. From that exact clean local `master`, run the complete
   release-equivalent gate before any `master` push: whitespace/source scan,
   third-party notices, release-critical docs, lint, production build, full Jest
   coverage with natural exit, and bundle audit. Build must precede receipt tests;
   do not reuse Linux results with `SKIP_CHECKS=1`.
4. Only after the gate passes and separate push authority is granted, push
   `master`; fetch/query the live remote and require local `master`, local
   `origin/master`, and live `origin/master` to be the same full SHA.
5. After explicit hosted-scan authority, submit that exact remote `master` SHA to
   the Obsidian Community preview scanner. Any visible `Error` is a release
   blocker; a different page SHA, Pending result, login/CAPTCHA issue, or missing
   browser session is not a pass. Treat a completed exact-SHA scan as the final
   external gate and make no further repo commit before Beta packaging; retain
   its receipt in the release task and write it back to the Tracker after the
   Beta operation. Any intervening commit invalidates the exact-SHA scan and
   requires a new submission.

### Phase M4 — Beta Packaging Boundary

- Recommended target for this feature-train behavior change is
  `2.10.0-beta.1`; `2.9.3-beta.1` remains a valid patch-train alternative only
  if the owner explicitly classifies the rollout that way. `2.9.0-beta.9` is not
  greater than current `2.9.2` and is invalid.
- Choose the target version before creating release state. From the exact clean,
  validated, remote-matched `master`, create only the matching
  `beta/<target-version>` packaging branch and prove its initial HEAD equals
  `master`.
- `make release-dry-run VERSION=<target-version>` is the final non-publishing
  preparation step and does not replace the Phase M3 release-equivalent gate.
  `make release` (local release commit/tag) and `make publish` (remote
  branch/tag/GitHub Release) each require their own explicit authority.
- Before publish, the Beta release commit must be the only single-parent commit
  above `master`; its parent must equal `master`, package/manifests/tag/branch must
  match the target version, the worktree must be clean, and live
  `origin/master` must still satisfy the release preflight.

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-125/REQ-09 / B-125/AC-09 | 版本化 rollout authority 与受支持平台四项 build-default-on | [x] | Rollout identity/default/freeze 和 calibration-provenance tests 纳入 8-suite / 797-test PASS |
| T-02 | B-125/REQ-09 / B-125/AC-09 | Sparse raw boolean override、显式 false 回滚、不回填持久化 | [x] | Undefined/empty/partial/invalid、JSON round-trip 和 raw immutability 纳入 focused PASS；最新 plugin unrelated-save fixture 于 303-test suite PASS |
| T-03 | B-125/REQ-09 / B-125/AC-09 | macOS/Linux/iOS positive allowlist；Win32/Android/unknown/partial all-false mask、raw preservation 与 direct/vector fallback | [x] | Negative-exclusion P1 已改为 positive allowlist 并新增 `unsupported` mask/fixtures；policy + calibration 2 suites / 13 tests PASS |
| T-04 | B-125/REQ-09 / B-125/AC-09；inherited B-125 behavior contract | Chat、Pagelet、Memory/VSS 共享 effective policy；算法/provider/budget/Data Boundary/lifecycle 不变 | [x] | 原 8 suites / 797 tests PASS；positive-allowlist 修正后又通过 48/504/260-test 重叠 affected sets、typecheck 与 diff check；独立复审无剩余 P0/P1/P2 |
| T-05 | B-125/AC-09 | Desktop current-App + targeted OPFS restart + real-iPhone current-artifact canary | [~] | Post-fold exact artifact 的 full deploy、loaded identity、policy snapshot、Chat mount 与 fresh errors PASS；indexed-chunk-only lexical 与 OPFS full-app restart 为 same-behavior pre-fold evidence；real-iPhone 仍 open；B-127 33/47/p95/profiler 不在本项 |
| T-06 | B-125/REQ-09 / B-125/AC-09 | DEC/Product Spec/Architecture/Active Package 权威链 | [x] | DEC-031、B-125 Product Spec amendment、continuation SDD/Tracker、DEC-027 source behavior 与两份 current Architecture 已对齐；全局 docs finding 另行记录 |
| T-07 | B-125/AC-09 | Final local/release gate 与 Beta readiness | [~] | Post-fold full deploy gate、bundle/release-doc/local Community source scan 与 current-App receipt PASS；worktree 尚未 commit/integrate，real-iPhone、hosted Community、target version、release dry-run 与 publish preflight 均 open |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

Inherited B-125 behavior contract, referenced for non-regression and not reopened:
`B-125/REQ-01`, `B-125/REQ-02`, `B-125/REQ-03`, `B-125/REQ-04`,
`B-125/REQ-05`, `B-125/REQ-06`, `B-125/REQ-07`, `B-125/REQ-08`;
`B-125/AC-01`, `B-125/AC-02`, `B-125/AC-03`, `B-125/AC-04`,
`B-125/AC-05`, `B-125/AC-06`, `B-125/AC-07`, `B-125/AC-08`.
The current dated amendment is `B-125/REQ-09` with `B-125/AC-09`.

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | B-125 四项已获 rollout disposition，但 raw flags 缺失时仍全部 effective-off，直接发布不会测到完整 B-125。 | DEC-031 确认在 macOS/Linux/iOS 一起 build-default-on，不做 Beta-only 特判。 | T-01、T-04、T-05 | Implemented；focused + Linux current-artifact verified，real-iPhone open |
| F-02 | P1 | 把默认值合并或回填到普通 settings 会消除 absent / explicit true / explicit false 三态，破坏可逆 rollout。 | Build defaults 只属于 rollout policy；settings 保留 sparse raw overrides，加载/保存不物化隐式值。 | T-02 | Implemented and focused-validated |
| F-03 | P1 | 用“非 Windows/Android”作支持判定会让没有明确 macOS/Linux/iOS signal 的 unknown/partial Platform 同样 default-on；Win/Android 与 allowlist signal 同时出现时也必须 mask 优先。 | 改为 macOS/Linux/iOS positive allowlist；Win32/Android 分别 mask，无 allowlist signal 用 `unsupported` mask，全部 all-false 且不改写 raw settings。 | T-03 | Closed by 2-suite / 13-test post-fix focused gate；overall affected/full gates remain separate |
| F-04 | P1 | 历史 B-125 receipts 不证明 shipping-default 后的当前产物，尤其是 lexical preparation/OPFS restart 与 iOS 默认路径。 | 只重验受影响的 current-artifact Desktop/OPFS/iPhone slices；不重跑 B-127 扩展认证。 | T-05 | Desktop/OPFS closed；real-iPhone open pending explicit device-deploy authority |
| F-05 | P2 | 历史 aggregate runner 如果只读 raw flags，会把“raw absent + build default-on”误报为关闭。 | 本 B-125 amendment 以 effective policy snapshot/focused smoke 为准；不为产生历史 aggregate 而修复/重跑 B-127 runner。 | T-04、T-05 | Closed by running-App effective snapshot and selected Desktop/OPFS smoke |
| F-06 | P1 | 完整 release gate 若不自然退出，或 publish 时无法证明 live `origin/master` 精确一致，候选不可发布。 | Final full Jest coverage 必须自然返回 0，publish 前必须实时验证远程 SHA；失败时禁止继续。 | T-07 | Current uncommitted candidate gate PASS；integration/publish-time remote check remains mandatory |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | Source/authority baseline 审核 | In progress | 已确认现有 sparse settings、统一 effective resolver、平台判定、runtime consumers 与 calibration/rollout 身份分离 seam；候选当时仍待完整自动化与 App evidence |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09；inherited behavior contract | 8 个主要 affected suites 串行；typecheck；affected-file ESLint | Pass | Policy/calibration/settings/memory-search/PA Agent Memory/Pagelet/VSS/plugin 共 797 tests PASS；TypeScript 与 affected files lint PASS。本条早于后续新增的 plugin unrelated-save fixture，该 fixture 由下一条 303-test 复跑闭合；本条不是 App/OPFS/iPhone 证据 |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | `npm test -- --runInBand __tests__/plugin-record-note.test.ts` | Pass | 最新 suite 303/303 PASS；覆盖 plugin 保存无关设置不回填或持久化隐式 retrieval defaults |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | Independent platform-policy risk audit | Finding confirmed / fix pending validation | 旧候选的 Win/Android negative exclusion 会把 all-false unknown/partial Platform 当作 supported。候选已改为 macOS/Linux/iOS positive allowlist，Win/Android 优先并对无 allowlist signal 返回 `unsupported`/all-false；待修正后 focused tests |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | `npm test -- --runInBand __tests__/retrieval-optimization-platform-policy.test.ts __tests__/retrieval-calibration.test.ts` | Pass | 2 suites / 13 tests PASS；覆盖 macOS/Linux/iOS allowlist，Win32/Android mask 优先，unknown/incomplete `unsupported` all-false，raw immutability 与 rollout/calibration identity 分离 |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | Post-fix platform + PA Agent retrieval integration | Pass | `retrieval-optimization-platform-policy` + `pa-agent-runtime-search-vss` 2 suites / 48 tests PASS；既有 explicit graph-off 与 raw-absent default-on Worker dispatch 均有断言 |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | Post-fix affected regression and independent risk review | Pass | Settings/memory-search/PA Agent Memory/Pagelet/VSS 5 suites / 504 tests PASS；policy/VSS/hybrid/Memory Manager/PA Agent allowlist set 5 suites / 260 tests PASS；typecheck 与 diff check PASS；统一 resolver/call-site/raw persistence/snapshot/epoch/calibration 复审无剩余 P0/P1/P2 |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | `npm run docs:check`；`git diff --check` | Continuation pass / repo unrelated fail | B-125 continuation authority/package/link/WIP/traceability 未产生 finding；global docs check 仅因独立 DEC-030 缺 Decision Index 入口而返回非零，并保留 4 个既有 Episodic Architecture known warnings；diff whitespace pass |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | Pre-fold build/test/review gate | Pass / identity superseded | `make deploy` 依次通过 platform guards、full lint、production build 与 210 suites / 5489 tests；另有 bundle/legal/release-doc/local Community source gates和两路独立终审 PASS。该产物早于 feature-identity fold，只作为行为证据；最终 handoff artifact 需重新生成。完整 Jest 自然退出，无 `forceExit` |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | Pre-fold Linux Desktop current-App + lexical maintenance | Behavior pass / identity superseded | Repo-local `test` vault，Obsidian 1.14.0 / installer 1.11.7，plugin 2.9.2 enabled；running snapshot=`b125-retrieval-optimization-rollout` v1 / DEC-031 / platform `none` / four true，raw flags=null，同时含有现已移除的独立 track 字段。Chat 正常 mount；真实 lexical-only rebuild 处理 218/218 indexed rows，provider/embedding/Markdown writes 全为 0；Markdown tree SHA-256 前后同为 `fe6ae64b3c8c41365a0751c0dfa07d1cfa8250db3cbf6fe60a5c3fe1e20c7404`；fresh App errors=0。该条不证明 identity fold 后的 exact artifact。 |
| 2026-09-04 | B-125/AC-09 | Pre-fold OPFS full-app restart | Behavior pass / identity superseded | Before/after receipt 均 PASS；renderer PID、main PID、time origin 均变化，证明完整 App restart；Linux x64 `sqlite-wasm-opfs-sahpool` remained ready/non-fallback，67 files / 218 chunks、2,539,520 bytes、`char-phrase-v1` generation 1、database/index/build/epoch/storage-scope hashes 全部连续；matched artifact SHA-256 `c78cf12096f4cf34bf540a8f49a7548d367d445f8919bb9c7d2677d6059755e7`，issues=[]。该 hash 仅作 pre-fold provenance。 |
| 2026-09-04 | B-125/REQ-09 / B-125/AC-09 | Post-fold full local deploy + current-App identity smoke | Pass | Exact-source `make deploy` 通过 platform guards、lint、production build 与 210 suites / 5489 tests；bundle audit PASS（6,799,638 bytes，gzip 2,697,702 < 2,883,584 budget），third-party notices 覆盖 35 runtime packages / 12 bundled resources，release docs 9 files / 51 links 与本地 Community source scan PASS。Repo-local `test` vault plugin reload 后，loaded SHA-256=`db4c41b174e1e27d983f4d981b53647760cd101e7b813ba7a4cba4727c22089e`、blocker=null、rollout v1、B-125/DEC-027/DEC-031 authority、`none`/four-on、raw=null、无独立 track field；Chat view/container/input 各 1，fresh errors=0，debug/mobile 均恢复 off。OPFS restart 未用新 SHA 重跑，保留为上条 same-behavior provenance；real-iPhone 仍 open。 |
| 2026-09-04 | B-125/AC-09 / T-07 | iPhone / hosted Community / integration-release boundary | Not run / open | iOS skill requires an explicit real-device request before writing current assets to the iCloud `test` vault；本轮一般 implementation authority 不外推该权限。Hosted scan、commit、push、target beta version、beta branch/tag/release/publish 也未获授权。Live read-only `origin/master` 与 local HEAD 在当前未提交 baseline 同为 `927895722bda2054ac7de7bb13ee2315aa970054`；任何 integration 后必须重新核对 |

## Closeout Readiness

- [ ] Owning contract 与实际行为一致。
- [ ] Required review/smoke/release evidence 已记录。
- [ ] 未完成项已进入 Backlog。
- [ ] 稳定结论已吸收到 current contract/tests。
- [ ] 过程文档已标记 delete-after-absorption 或 unique archive evidence。

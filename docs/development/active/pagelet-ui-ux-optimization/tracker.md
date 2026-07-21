# Pagelet UI/UX Optimization Development Tracker

Document status: Current
Delivery status: Implementing
Updated: 2026-07-21
Work item: B-118
Authority: 本 track 的唯一执行状态、finding lifecycle、验证证据与 closeout readiness。
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Approved SDD](./sdd.md)
Provider trust amendment: [DEC-023 — shared non-blocking Pagelet provider first-use](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)

## Current Snapshot

- Current phase: **DEC-023 产品合同已同步，但 F-03/F-10 runtime reconciliation 未完成，
  回到 Implementing**。其他 slice 的既有自动化结果继续保留，但不能覆盖这两个 P1。
- Next action: 获得明确 runtime 修复指令后，按
  [DEC-023 Runtime Reconciliation Execution Record](#dec-023-runtime-reconciliation-execution-record)
  先修 fresh-install Scope Recap gate 与 Recap/Recall/Discover cross-feature actual-call
  notice，再跑 focused tests/review；之后才进入 `make deploy`、桌面和 iPhone smoke。
- Blocker / decision needed: 无产品决策阻塞；本轮未授权 runtime 修改。commit、push、
  tag、release 仍需另行授权。
- Last verified behavior: 2026-07-21 只读源码复核确认 `mergePageletSettings({})` 仍让
  Scope Recap preparation 为 false，orchestrator 会在 shared notice/auto-authorization
  前返回；Quiet Recall 在确认实际 provider call 前显示 notice，Discover 仍无同一
  actual-call gate。没有把该复核冒充 app smoke。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-118/REQ-01 / B-118/AC-01 | Pet hold-menu touch ownership | [~] | Slice A code/tests pass；real-device `NOT TESTED` |
| T-02 | B-118/REQ-02 / B-118/AC-02 | Recap first-screen concrete value | [~] | Slice B code/DOM tests pass；desktop `NOT TESTED` |
| T-03 | B-118/REQ-03 / B-118/AC-03 | DEC-023 shared notice + old Modal removal | [~] | Modal 已移除；fresh install 仍因旧 authorization tuple 使 preparation=false，runtime reconciliation pending |
| T-04 | B-118/REQ-04 / B-118/AC-04 | Complete reduced-motion coverage | [~] | Slice D selector tests pass；iPhone `NOT TESTED` |
| T-05 | B-118/REQ-05 / B-118/AC-05 | Recall actions: View+Later+Dismiss | [~] | Slice E tests pass；provider-free visible validation pending |
| T-06 | B-118/REQ-06 / B-118/AC-06 | Pet stale/disable state convergence | [~] | Slice D interleaving tests pass；desktop `NOT TESTED` |
| T-07 | B-118/REQ-07 / B-118/AC-07 | Quiet Recall Off/On settings | [~] | Slice E migration/mapping tests pass；Settings surface validation pending |
| T-08 | B-118/REQ-08 / B-118/AC-08 | 14/16/24px typography readability | [~] | Slice F computed tests pass；visible pairs pending |
| T-09 | B-118/REQ-09 / B-118/AC-09 | Desktop active-leaf placement | [~] | Slice F tests pass；desktop/iPhone `NOT TESTED` |
| T-10 | B-118/REQ-10 / B-118/AC-10 | Shared Data Boundary / DEC-023 | [~] | Notice helper/partial tests exist；cross-feature actual-call timing 与 Discover coverage 未闭合 |
| T-11 | B-118/REQ-01..10 / B-118/AC-01..10 | SDD, review, docs, validation | [~] | [SDD](./sdd.md) approved；DEC-023 docs pass；F-03/F-10 runtime + real-device validation pending |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | iPhone 菜单项 `touchend` 冒泡到 Pet 根：Capture/Discover 不执行却切 Bubble，Review 执行同时切 Bubble | 隔离 menu touch ownership；target callback once、Pet 根额外 toggle zero；downstream 可按合同呈现结果 | production-like TouchEvent counters + user-finger iPhone matrix | Implemented / iPhone validation pending |
| F-02 | P1 | prepared Recap 首屏只显示通用“已准备”，真实 `body/sourceRefs` 被降级；Detail metadata 是另一个 P2 合同项 | 实际 observation/source 为 primary；Detail 使用产品语言显示 scope/time/coverage/freshness | DOM contract + desktop 3-second value + long-content layout | Implemented / desktop validation pending |
| F-03 | P1 | 旧 Modal 已移除，但 fresh install 仍由旧 authorization tuple 把 Scope Recap preparation 置为 false，并在 notice/auto-authorization 前返回 | 按 DEC-023 让 eligible fresh install 默认工作，同时严格保留持久 opt-out；标准有界共享 notice 后继续；首次恰为高风险时由完整阻断披露同时完成 first-use | merge/upgrade/opt-out + no-modal/shared-notice/high-risk-first-call/provider/cost/settings counters | Open / runtime reconciliation required |
| F-04 | P2 | iOS WKWebView computed blink 仍为 `5s infinite`，Pet/Bubble motion 覆盖也不完整 | 精确 selector/pseudo matrix，保留静态状态 | computed animation/transition matrix + real iPhone interaction | Implemented / iPhone validation pending |
| F-05 | P2 | Recall CTA label/route/provider 副作用不一致，反馈/Link/Later 合同互相冲突 | View + Later + Dismiss；View 不重跑，Later 进入 Queue，Dismiss 仅具体候选弱信号 | route/provider/write/RHP/queue counters + provider-free UI | Implemented / surface validation pending |
| F-06 | P2 | stale route 或 hint/Focus 关闭可留下无内容的 `working/nudge`；Recap background preparation 未表达 working | owner-aware settle + bounded background working | interleaving/disable/teardown tests | Implemented / desktop validation pending |
| F-07 | P2 | proactive Recall 默认关闭且没有诚实的用户入口 | 按 SG-01 使用默认 Off 的 Off/On；旧 true→On，其他→Off；与 generic hints/Recap 解耦 | settings/legacy/locale/DOM | Implemented / Settings validation pending |
| F-08 | P2 | 14px 下 body/source/hint/button/description/context label 约 9.625–11.81px | 提高可读下限并保持缩放/层级 | computed full matrix + representative visible pairs | Implemented / visible validation pending |
| F-09 | P3 | 既有 overlay clamp 未按 active leaf 可用区约束；会话观察右栏约重叠 142px但无 artifact | 依据 active leaf 可用区域定位/clamp并记录实际交集 | sidebar/leaf/Bubble rect + split/resize smoke | Implemented / desktop validation pending |
| F-10 | P1 | shared notice 未统一到各 feature 第一次实际 provider call：Quiet Recall 可能在无调用时提前通知，Discover 未进入同一 gate | 把 Recap/Recall/Discover actual-call admission 集中到 shared disclosure；标准有界运行继续；首次高风险完整确认可写 shared flag，但仅限 Run 后的 imminent-call seam；不重置 notice/opt-out | first-use/no-call/already-notified/cross-feature/high-risk-first-call/broad/sensitive/costly/excluded provider-spy matrix | Open / runtime reconciliation required |

## DEC-023 Runtime Reconciliation Execution Record

本节是 F-03/F-10 的后续执行合同，不新增产品决定，也不替代 DEC-023：

- “B-118 回到 Implementing”只表示交付生命周期从待验证退回实现阶段；不是回滚既有
  code，也不抹掉其他 slice 已通过的自动化证据。只重新打开 F-03/F-10 两个 P1，修复后
  仍须重做相关验证。
- B-119 仍是 Planned，只复用修复后的共享 gate；本记录不授权提前实现 B-119。
- 记录时只授权文档同步；runtime、commit、push、tag、release 均未授权。

### Confirmed Current Runtime Facts

| Path | Current source evidence | Why it conflicts with DEC-023 |
| --- | --- | --- |
| Fresh-install merge | [Pagelet settings merge](../../../../src/settings/pagelet/index.ts) `:345-363` 只有旧 authorization tuple 已是 `authorized-v1`、context 非空且持久值显式为 `true` 时才得到 enabled；[B-118 test](../../../../__tests__/pagelet-b118-ui-ux-optimization.test.ts) `:119-124` 还明确断言 `mergePageletSettings({}) === false` | `PAGELET_DEFAULTS` 虽为 true，fresh install 实际仍关闭，标准有界 Scope Recap 不会默认工作 |
| Scope Recap reachability | [Orchestrator](../../../../src/pagelet/orchestrator.ts) `:1217-1238` 在 `scopeRecapPreparationEnabled=false` 时先返回，之后的 shared notice 与 auto-authorization 不可达 | 测试注释所说“orchestrator first run auto-enables”在 fresh install 路径上不会发生 |
| Quiet Recall timing | [Orchestrator foreground](../../../../src/pagelet/orchestrator.ts) `:673-682` 与 background nudge `:2258-2272` 都在调用 `host.runQuietRecall()` 前立即标记/通知；但 [plugin runtime](../../../../src/plugin.ts) `:3723-3867`、`:3885-3936` 之后仍可能因 capability、active note、Data Boundary、无候选、provider、cooldown 或 budget 不发生 provider call | 用户可能收到“首次使用”通知、flag 变 true，但本次根本没有实际 provider 调用 |
| Discover coverage | [Discover route](../../../../src/pagelet/orchestrator.ts) `:1721-1777` 在 `host.discoverConnections()` 前没有 shared notice；[Bubble Discover](../../../../src/pagelet/BubbleCoordinator.ts) `:460-490` 还会直接进入 `host.runQuietRecall()` | Discover 的首次实际 generation/evaluation call 可能完全绕过共享 gate；`findRelatedNotes()` 是否会触发更早的 provider-backed retrieval 也必须在实现时沿调用链确认 |
| State already worth preserving | [Settings merge](../../../../src/settings/pagelet/index.ts) `:353-363`、`:428` 会保留旧 `declined-v1`、显式 `scopeRecapPreparationEnabled=false` 与已通知 flag；Settings `:1397-1403` 也只在用户主动重新开启时清除 `declined-v1`；[notice helper](../../../../src/pagelet/orchestrator.ts) `:1247-1257` 已复用 `pageletProviderFirstUseNotified` | 不应重做状态模型；修复应保留所有明确 opt-out 证据与既有 shared flag，只修 eligibility 和调用时机/覆盖 |

### Minimal Runtime Boundary

1. Settings merge/migration 必须按明确的 opt-out 优先级处理：已持久化
   `scopeRecapPreparationEnabled=false` 或旧 `scopeRecapBackgroundAuthorization=declined-v1`
   都继续关闭；只有字段不存在且没有其他明确关闭证据时，才按 DEC-023 视为 fresh/legacy
   eligible default true。旧 tuple 的 pending/authorized/context 形态可以兼容读取，但不得
   再成为标准有界运行的前置授权；用户之后主动打开 capability 才能清除旧 decline。
2. 建立一个共享的 provider-call admission 语义，继续只使用
   `pageletProviderFirstUseNotified`。可以落在不同模块边界，但不得新增 Recap/Recall/
   Discover 各自的 authorization/notice state。
3. 首次披露只能在 capability、provider、eligible sources、Data Boundary、候选/质量、cooldown
   与标准 budget admission 等所有 no-call gate 通过后，紧邻第一次真实 provider invocation
   前发生。若本轮不会调用 provider，则 notice=0、flag mutation=0。
4. Scope Recap、Quiet Recall foreground/background、主 Discover route、Bubble Discover，
   以及调用链中更早发生的 provider-backed retrieval 都必须进入同一语义 gate。单纯 local
   result、explicit links、cache hit 或 provider-free fallback 不得触发通知。
5. 首次实际调用为标准有界运行时，展示一次非阻断通知，在真实 invocation 紧邻 seam
   持久化 flag，并继续当前 eligible run；已通知用户不再显示。并发/重入的首次调用也
   只能展示并持久化一次。
6. broad、sensitive、costly、whole-vault、out-of-envelope 与 excluded-scope override 继续
   使用阻断式 `run / adjust / cancel`，且必须先于 provider call/cost reservation。若它是
   第一次实际调用，完整披露 allowed note excerpts/data、provider、possible cost 与
   capability 关闭入口后，可同时完成 shared first-use，不追加第二条非阻断 notice；只有
   明确 `Run`、全部 gate 通过且调用即将发生时才写 flag。Cancel/close 不写；Adjust 后仍
   高风险则重走 blocking gate，降为标准有界则走普通 shared notice。
7. shared flag 已为 `true` 不免除后续高风险运行的逐次确认。该 flag 只表示 provider
   首次透明告知，不得成为 Memory Prepare/Update、Memory
   admission、vault/Markdown 写入、持久化 insight 或外部 action 的授权凭据。

### Focused Regression Matrix

| ID | Scenario | Required result |
| --- | --- | --- |
| RR-01 | preparation 字段不存在，且没有显式 false/旧 `declined-v1` 的 fresh or legacy load | preparation=true；不要求预先存在旧 authorized tuple/context |
| RR-02 | 已持久化 `scopeRecapPreparationEnabled=false` 或旧 `declined-v1` 后 reload/upgrade | 仍为 false；provider/notice/flag mutation 均为 0；只有用户主动重新开启才清除 decline |
| RR-03 | 首次 eligible Scope Recap 实际调用 | notice=1、provider call=1、flag=true；当前 run 不被通知阻断 |
| RR-04 | Recap provider missing、来源不足、Data Boundary deny 或 capability off | notice=0、provider call=0、flag 仍 false |
| RR-05 | Quiet Recall 无候选、仅 local result、cache hit、cooldown 或 budget reject | notice=0、provider call=0、flag 仍 false |
| RR-06 | Quiet Recall foreground/background 首次进入真实 evaluator | 第一次 invocation 前 notice=1；同轮 retry/后续调用不重复 |
| RR-07 | 主 Discover 与 Bubble Discover 首次实际 generation/evaluation/retrieval call | 两条入口都先经过共享 gate；仅 explicit links/local fallback 时不通知 |
| RR-08 | Recap → Recall → Discover 及任意反向首次顺序 | 全局总 notice=1；三个 feature 不创建独立 flag |
| RR-09 | `pageletProviderFirstUseNotified=true` 的既有用户 | notice=0；eligible provider call 正常继续 |
| RR-10 | 两个首次 eligible run 并发或重入 | notice=1、持久化一次；各 run 仍服从自己的 budget/context gate |
| RR-11 | 第一次实际调用是高风险，选择 Cancel / close / Adjust / Run | Cancel/close：零调用、零成本、flag=false；Adjust 仍高风险：重新确认且 flag=false；Adjust 降为标准有界：普通 shared notice；Run：完整 blocking disclosure=1、non-blocking notice=0，仅在全部 gate 通过且 invocation immediately next 时 flag=true/call=1 |
| RR-12 | 首次 provider attempt 在网络/解析阶段失败 | 已发生真实 attempt，因此 shared flag 保留 true；不得因失败重复打扰或转授其他权限 |
| RR-13 | shared flag 已为 true 后再次运行高风险范围 | 每次仍显示 blocking disclosure；Cancel/close 零调用/零成本，Run 通过 gate 后才调用 |

### Execution And Exit Gate

1. 获得 runtime 修复授权后，先更新
   `pagelet-settings`、`pagelet-b118-ui-ux-optimization`、`pagelet-orchestrator`、
   `pagelet-bubble-coordinator` 与 `plugin-record-note` 的相关 focused tests，再做最小实现。
2. 运行 focused tests、TypeScript/local validation gate 与 adversarial review；任何发现的
   provider call 旁路都回填 F-10，不以 helper 存在本身判定完成。
3. 只有 F-03/F-10 的 runtime、测试和 review 全部闭合后，B-118 才能从 Implementing
   进入 Validating；随后运行 `make deploy`，重做桌面与 iPhone 真实 surface smoke。
4. Smoke 通过仍只满足 B-118 closeout readiness；不会自动启动 B-119、commit 或 release。

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-07-19 | Baseline only | `npm test -- --runInBand`, lint, build | Pass | 160 suites / 3175 tests；只证明自动化/构建，不证明 UI 已修复 |
| 2026-07-19 | Baseline only | `make deploy-icloud` + four-asset byte comparison | Session-reported Pass / artifact missing | 口头记录四资产一致，但未保留四条 MATCH 与 WKWebView runtime identity；修复后必须重做 |
| 2026-07-19 | Baseline only | Desktop real Obsidian UI audit | Mixed / FAIL overall | Recap、Modal、typography/placement findings；通过项和环境见 handoff |
| 2026-07-19 | Baseline only | iPhone 15 iOS 26.5.2 real-device + Safari Inspector + QuickTime landscape audit | Mixed / FAIL overall | Hold-menu action 与 reduced-motion 失败；portrait/landscape safe area 通过；iPad 未测 |
| 2026-07-19 | Baseline only | Second-layer Product contract/source audit | Fail | 补充 F-05/F-07/F-10：Recall action/feedback/weight、三档 reachability、first-use provider disclosure；未发送真实 note text |
| 2026-07-20 | T-01..T-10 | `npm test -- --runInBand` | Pass | 161 suites / 3202 tests |
| 2026-07-20 | T-01..T-10 | `npm run lint` | Pass | zero warnings/errors |
| 2026-07-20 | T-01..T-10 | `npm run build` (tsc + tailwind + esbuild) | Pass | Done in 1348ms |
| 2026-07-20 | T-01..T-10 | `git diff --check` | Pass | zero whitespace issues |
| 2026-07-20 | T-01..T-10 | Community DOM scan (`rg innerHTML/outerHTML/style`) | Pass | zero matches |
| 2026-07-20 | T-01..T-10 | `make deploy` | NOT RUN | implementation gate passed；修复后 app deployment/validation pending，不依赖 commit |
| 2026-07-20 | T-01..T-10 | Desktop Obsidian smoke | NOT TESTED | awaiting deploy |
| 2026-07-20 | T-01..T-10 | iPhone real-device smoke | NOT TESTED | awaiting deploy-icloud |
| 2026-07-21 | B-118/REQ-01..10 / B-118/AC-01..10 | DEC-023 Active Package reconciliation（含首次高风险方案 A）+ `npm run docs:check` | Docs pass / runtime gap recorded | B-118 metadata、REQ/AC traceability 与 Active Registry mirror 通过；不代表 runtime 已对齐 |
| 2026-07-21 | B-118 package | `git diff --check` | Pass | zero whitespace issues |
| 2026-07-21 | B-118/REQ-03、10 / B-118/AC-03、10 | Read-only source/test audit | Fail | `src/settings/pagelet/index.ts:361-363` keeps fresh install off；`src/pagelet/orchestrator.ts:1217-1238` returns before auto-enable；shared notice timing/Discover coverage incomplete；no runtime edits made |

## Decision Log

| Date | Decision | Impact |
| --- | --- | --- |
| 2026-07-19 | [DEC-021](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md) | 采用 evidence-led staged hardening，保留非回归基线；未决 Recall/authorization/reprompt 语义进入 SG-01..07 |
| 2026-07-19 | SG-01..SG-07 | 不由 Claude Code 擅自决定 frequency/migration、actions、feedback、Later、shared authorization、Modal Run/reprompt 或 Discover/name/quiet-first-screen |
| 2026-07-20 | SG-01 decided | Off/On 两档，无频率 cap。quality gate + quiet hours + Focus Mode + 每 candidate 一次足够。旧 `true` 映射 On |
| 2026-07-20 | SG-02 decided | View + Later + Dismiss。Link/Save 留在 Tab 内 |
| 2026-07-20 | SG-03 decided | Dismiss = 弱信号，仅影响该具体候选。RHP 关闭时零影响 |
| 2026-07-20 | SG-04 decided | Later = 进入 Review Queue（explicit return intent） |
| 2026-07-20 | SG-05 decided | 标准有界 Pagelet provider 路径共享一次 first-use notification；不创建 feature-specific authorization。高风险范围仍逐次确认 |
| 2026-07-20 | SG-06 decided | 去掉标准 first-use Modal；Settings capability opt-out + 首次非阻断通知，当前 eligible run 继续 |
| 2026-07-20 | SG-07a decided | 英文保持 Quiet Recall，中文改为"相关回顾" |
| 2026-07-20 | SG-07b decided | 保持现状。Discover 结果进入 Panel，无需改动 |
| 2026-07-20 | SG-07c deferred | B-118 不改变 Quiet Bubble 空状态，记入 Backlog |
| 2026-07-20 | Philosophy update | 新增 provider trust model：配置 provider = 信任决策，默认可用 + 透明通知 + Settings opt-out，不用 blocking modal |
| 2026-07-21 | [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md) | 正式统一 SG-05/SG-06：只复用 `pageletProviderFirstUseNotified`，不重置 notice/opt-out；broad/sensitive/costly/whole-vault/out-of-envelope/excluded override 在 call/cost 前阻断；provider 信任不授予写权限 |
| 2026-07-21 | 首次高风险运行选择方案 A | 完整 blocking disclosure 同时完成 shared first-use；仅 `Run` 后所有 gate 通过且调用即将发生时写 flag，不追加普通 notice；Cancel/close/unpassed Adjust 不写，后续高风险仍逐次确认 |

## Closeout Readiness

- [ ] Owning Product Spec 与实际行为一致。
- [ ] Architecture/Pagelet contracts 与实际行为一致。
- [x] SDD 已创建且 Approved，映射 B-118/REQ-01..10 与 AC-01..10。
- [ ] 当前 B-118 scope 的 P0/P1/P2 已关闭；SG-01..06 已决定并完成，或经新的
  Decision/Product Spec 正式移出 B-118 并进入 Backlog。
- [ ] SG-07 已记录保持现状或后续 Backlog 的明确 disposition。
- [ ] Required review、desktop/iPhone smoke 与 community gate 证据已记录。
- [ ] 未完成项已进入 Backlog，且没有把 iPad/provider 缺口冒充 PASS。
- [ ] `closeout.md` 已逐项记录 README、Plan、SDD、Tracker、handoff 与临时证据去向。
- [ ] Active Registry 与 Archive index 更新方案明确。

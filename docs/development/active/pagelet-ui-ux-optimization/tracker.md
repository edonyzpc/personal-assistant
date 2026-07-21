# Pagelet UI/UX Optimization Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-07-21
Work item: B-118
Authority: 本 track 的唯一执行状态、finding lifecycle、验证证据与 closeout readiness。
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Approved SDD](./sdd.md)
Provider trust amendment: [DEC-023 — shared non-blocking Pagelet provider first-use](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)
Quiet Recall retrieval amendment: [DEC-024 — cold semantic retrieval uses the existing actual-call budget](../../../product/decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)

## Current Snapshot

- Current phase: **B-118 已完成授权范围内的 runtime、自动化、adversarial privacy
  review 与 desktop/iPhone validation，状态为 Validated**。completion audit 在此前绿色
  gate 后又发现 touch 全轨迹、Later 失败事务、Recap Pet ownership、Quiet Recall 独立
  开关、无稳定 vault identity quota、AC-08 证据表述，以及单一 pending flag 无法表达
  多类 nudge owner / raw preload 假提示的缺口，现均已修复或按真实证据
  边界重写。最终 closure audit 另发现 Prepared 缓存虽可能产生 provider 成本，但生产
  入口不可达，且既有 Panel 会错误允许保存/展开；现已补真实命令链、只读边界与空缓存
  进入前的无状态变更 preflight。最终两次全量部署门禁均为 163 suites / 3417 tests，lint、build、docs、diff
  与 local community scan 通过；desktop Recap/Detail/Settings、iCloud 四资产 byte-match、
  iPhone runtime identity、竖屏 Pet/Bubble、真手指长按菜单与 Reduce Motion 复验通过。
- Next action: 无剩余产品决策或授权范围内验证动作。用户明确要求忽略本轮浅横屏
  复测，记录为 `NOT TESTED / accepted waiver`，不冒充 PASS；closeout/archive、commit、
  push、tag、release 仍需另行授权。
- Blocker / decision needed: Quiet Recall semantic boundary 与 Review/preload 风险分类
  已由用户于 2026-07-21 分别选择 DEC-024/DEC-023 方案 A；用户已授权 B-118 runtime
  修复与验证。commit、push、tag、
  release 仍需另行授权。
- Last verified behavior: 2026-07-21 Prepared Panel 入口、只读边界与空缓存状态保护的
  聚焦门禁为 3 suites / 189 tests；`make deploy` 与 `make deploy-icloud` 各自重跑
  163 suites / 3417 tests、lint、build，并完成四资产三方 SHA-256 一致性检查。
  Obsidian CLI 已证明生产命令注册与空缓存 Notice/Panel 保持关闭；provider-free shell
  runner 为 26 PASS / 1 BLOCKED / 0 FAIL。唯一 BLOCKED 是早于 durable Memory 架构的
  D6 live-write probe：现已在受保护的 device-local Memory 状态前安全停止，未改 Memory
  数据，不属于 B-118 回归。该自动化结论与用户手动通过结论互补，不把未执行的横屏、
  未新增的 owner-path/非空 Prepared 实机 smoke 或未授权的真实 provider/high-risk 调用
  冒充 PASS。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-118/REQ-01 / B-118/AC-01 | Pet hold-menu touch ownership | [x] | production-like TouchEvent matrix 覆盖三项 callback once / root toggle zero，以及越界后移回、第二指落另一 target 后永久失效、全局监听清理；用户确认 iPhone 真手指长按菜单通过 |
| T-02 | B-118/REQ-02 / B-118/AC-02 | Recap first-screen concrete value | [x] | Slice B code/DOM tests pass；desktop Bubble 立即显示 concrete Recap、11 sources 与 `View recap` |
| T-03 | B-118/REQ-03 / B-118/AC-03 | DEC-023 shared notice + Review classification + old Modal removal | [x] | Runtime/provider-spy/adversarial review passed；desktop shared non-blocking notice visible；真实 high-risk provider call 未获数据/成本授权，不冒充实调 PASS |
| T-04 | B-118/REQ-04 / B-118/AC-04 | Complete reduced-motion coverage | [x] | 真机先发现 blink/dots/zzz selector 漏配并修复；Reduce Motion=true 下 computed blink/dot/zzz=`none`，Bubble transition=`0s`，Pet/Bubble 仍可操作 |
| T-05 | B-118/REQ-05 / B-118/AC-05 | Recall actions: View+Later+Dismiss | [x] | provider-free route/write/RHP/queue matrix passed；Later 仅在 Queue 成功后清候选、关 Bubble、记 feedback，`ok:false`/reject 保留当前 UI；未触发真实 provider call |
| T-06 | B-118/REQ-06 / B-118/AC-06 | Pet stale/disable state convergence | [x] | Slice D interleaving tests 覆盖 explicit owner admission、successful-presentation ack、background Recap 不抢已有 nudge、foreground Retry 早退、source/scope invalidation、Focus/hide/destroy settle 与 raw preload fail-closed；desktop reload 后旧 `insights-ready` 收敛为 `Pagelet is watching` |
| T-07 | B-118/REQ-07 / B-118/AC-07 | Quiet Recall Off/On settings | [x] | canonical-only mapping 与 explicit canonical > stale mirror > legacy boolean > default Off migration tests pass；Quiet Recall On 只复用 quiet hours，与 generic hints enablement/cooldown/pending 双向解耦；desktop Settings 已确认独立入口 |
| T-08 | B-118/REQ-08 / B-118/AC-08 | 14/16/24px typography readability | [x] | 24-case deterministic CSS cascade/layout matrix 与 target-selector floor tests 通过；用户确认本轮手动可见界面通过。浏览器 computed-matrix 自动化被环境策略阻断，未冒充真实 app computed PASS |
| T-09 | B-118/REQ-09 / B-118/AC-09 | Desktop active-leaf placement | [x] | Slice F tests pass；desktop active editor 右下角且未覆盖右侧 Chat；iPhone 430×932 portrait rect/safe-area 通过；浅横屏由用户明确接受 `NOT TESTED` |
| T-10 | B-118/REQ-10 / B-118/AC-10 | Shared Data Boundary / DEC-023/DEC-024 | [x] | Cross-feature admission、Review/preload classification、pure-semantic/empty retrieval、10/50 budget、live-source/all-ref/source-race matrix passed；Settings/notice/runtime surface 已验证 |
| T-11 | B-118/REQ-01..10 / B-118/AC-01..10 | SDD, review, docs, validation | [x] | SDD/docs/full automated/adversarial review、多轮 completion/closure re-audit/remediation、post-F-13 deploy/identity、desktop/iPhone authorized validation 与 residual-risk recording 完成 |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | iPhone 菜单项 `touchend` 冒泡到 Pet 根：Capture/Discover 不执行却切 Bubble，Review 执行同时切 Bubble；completion audit 又发现只看起终点及按钮局部状态会允许越界后移回、第二指落另一 target 后首指仍执行 | 隔离 menu touch ownership；document capture 统一追踪当前菜单手势，全轨迹任一点越过 12px 或任何 target 出现多指就永久 fail closed；end/cancel/dismiss/destroy 清理监听 | production-like cross-target TouchEvent trajectory counters + user-finger iPhone long press | Validated |
| F-02 | P1 | prepared Recap 首屏只显示通用“已准备”，真实 `body/sourceRefs` 被降级；Detail metadata 是另一个 P2 合同项 | 实际 observation/source 为 primary；Detail 使用产品语言显示 scope/time/coverage/freshness | DOM contract + desktop 3-second value + long-content layout | Validated |
| F-03 | P1 | 旧 Modal 已移除，但 fresh install 仍由旧 authorization tuple 把 Scope Recap preparation 置为 false，并在 notice/auto-authorization 前返回 | 按 DEC-023 让 eligible fresh install 默认工作，同时严格保留持久 opt-out；标准有界共享 notice 后继续；首次恰为高风险时由完整阻断披露同时完成 first-use | merge/upgrade/opt-out + no-modal/shared-notice/high-risk-first-call/provider/cost/settings counters | Validated；真实 provider/high-risk call 未授权 |
| F-04 | P2 | iOS WKWebView computed blink 仍为 `5s infinite`，Pet/Bubble motion 覆盖也不完整 | 精确 selector/pseudo matrix，保留静态状态 | computed animation/transition matrix + real iPhone interaction | Validated after real-device selector repair |
| F-05 | P2 | Recall CTA label/route/provider 副作用不一致，反馈/Link/Later 合同互相冲突；completion audit 又发现 Queue 失败时 Later 可能提前丢候选 | View + Later + Dismiss；View 不重跑，Later 事务化进入 Queue，失败保留候选/Bubble 且不记 feedback，Dismiss 仅具体候选弱信号 | route/provider/write/RHP/queue success/`ok:false`/reject counters + provider-free UI | Validated |
| F-06 | P2 | stale route 或 hint/Focus 关闭可留下无内容的 `working/nudge`；Recap background preparation 未表达 working；completion audit 又发现 background 可能抢 nudge、Retry 早退可能残留 working | owner-aware settle + bounded background working；background 不抢 nudge，foreground Retry 的所有早退与 destroy 都收敛 owner | interleaving/disable/scope-invalidation/teardown tests | Validated |
| F-07 | P2 | proactive Recall 默认关闭且没有诚实的用户入口；completion audit 又发现 Settings/runtime 双真源及 Quiet Recall On 仍依赖 generic hints；最终 re-audit 进一步发现双方共用 cooldown/pending clock | 按 SG-01 使用默认 Off 的 Off/On；只持久化 canonical 字段，按 explicit canonical > stale mirror > legacy boolean > default Off 迁移；Quiet Recall 只复用 quiet hours，与 generic hints/Recap enablement、generic cooldown/pending 双向解耦 | settings/legacy/stale-mirror/generic-off/cross-order cooldown/locale/DOM | Validated |
| F-08 | P2 | 14px 下 body/source/hint/button/description/context label 约 9.625–11.81px；completion audit 发现 Tracker 把 source-level 检查过度表述为完整 browser computed matrix | 提高可读下限并保持缩放/层级；证据改为 24-case deterministic CSS cascade/layout matrix + 用户手动可见界面通过，浏览器自动化 BLOCKED 单独保留 | target-selector cascade/floor/overflow tests + representative visible manual pass | Validated with tooling residual |
| F-09 | P3 | 既有 overlay clamp 未按 active leaf 可用区约束；会话观察右栏约重叠 142px但无 artifact | 依据 active leaf 可用区域定位/clamp并记录实际交集 | sidebar/leaf/Bubble rect + split/resize smoke | Validated with landscape `NOT TESTED` waiver |
| F-10 | P1 | shared notice 未统一到各 feature 第一次实际 provider call：Quiet Recall 可能在无调用时提前通知，Discover 未进入同一 gate | 把 Recap/Recall/Discover actual-call admission 集中到 shared disclosure；标准有界运行继续；首次高风险完整确认可写 shared flag，但仅限 Run 后的 imminent-call seam；不重置 notice/opt-out | first-use/no-call/already-notified/cross-feature/high-risk-first-call/broad/sensitive/costly/excluded provider-spy matrix | Validated；真实 provider call 未授权 |
| F-11 | P2 | 为维持旧 RR-05 的笼统零调用表述，Quiet Recall 候选可能退化为 metadata-only；fresh stat 也可能掩盖读取期间的 source drift | 按 DEC-024 恢复 pure-semantic lane：冷 query embedding 经 DEC-023 admission 并与 evaluator/retry 共用现有 10/50 bucket；捕获 read-time source snapshot 并在 provider seam/结果使用前复验；metadata 只作 explicit-Discover local fallback | zero-metadata-overlap semantic candidate、empty retrieval、index unavailable、cache hit、pre/post-call source mutation + budget/provider counters | Validated |
| F-12 | P1 | privacy review 发现 foreground Review / generic background preload 的 production admission 没有可执行的风险分类：`last7` 可能被标签式误判，实际多来源 Review 与越界后台任务也可能都沿 standard path；completion review 又发现调用方布尔自证敏感性、预算/changed watermark 重载归零、Settings 暴露不可运行上限、semantic enrichment 引入 unchanged source、MetadataCache 滞后可漏掉最新正文排除标记与 finding source 可幻觉；最终隐私复核还发现 Discover 可在 primary 最新正文复核前冷 embedding、Saved Insight 文本未对全部来源做 live validation、Pagelet 本地排除规则未覆盖全部 provider 输入；最终 completion audit 另发现无稳定 vault identity 的 foreground quota 可能共享 `:unavailable` key | 按 DEC-023 Option A：Review 先过滤、去重，实际来源 `<=1` standard、`>1` blocking 且确认前零 quota/cost reservation；generic preload 仅在 opt-in、changed-only、7-day、4K input/1K output、2/rolling-hour、20/local-day、read-only、实际来源全部通过 shared Data Boundary 且无 override 时 standard，任一越界 silent skip；调用预算与 per-path mtime watermark 均 content-free 持久化；所有 Pagelet provider source 统一组合 shared boundary + Pagelet-local rules，并复核最新 Markdown；cold embedding 先验证 primary；Saved Insight 全部 refs live read 且 all-or-nothing；finding source 必须精确属于实际输入；不从全索引追加 unchanged related source；无稳定 identity 时 foreground quota 仅用本实例内存，Recap/Recall 继续 fail closed | Review actual=1/`last7`→1/actual>1 Run-Adjust-Cancel + preload 每条件单独越界、unchanged-related、reload/toggle、midnight、两类存储异常、stale/null MetadataCache、cold-primary、Saved Insight all-ref/source-race、source grounding、双无 identity vault 隔离的 UI/provider/quota/cost/flag counters | Validated |
| F-13 | P1 | completion re-audit 发现 Pet 只有一个 `nudge` 状态，但 generic、Recap、Pattern、Onboarding 与 Quiet Recall 共用单一 pending flag：实际 payload 会被错误 owner 消费、被抢占提示可能永久丢失，Recap 查看不推进共享 cooldown；raw `PreloadFinding[]` 还会制造没有合规 Bubble 内容的假 nudge。后续 closure audit 又发现 raw 缓存可能已产生 provider 成本，但 Prepared 路由在生产界面不可达，且 Panel 默认允许保存或展开到 Tab；末轮复审继续发现空缓存返回前已关闭 Bubble、覆盖 layout、清 pending | 使用 owner-aware ticket/admission；真实 delivery 高于 onboarding，当前无跨类型统一评分时只用兼容 fallback `Recap > Quiet Recall > Pattern`；保持已 claim owner，Bubble 实际 visible 后才提交该 owner 的 once/cooldown，close/action/work settle/source invalidation 后统一 reconcile，已准入 shared ticket 用唯一 timer 延后；generic Off、Focus、Pet hide、destroy 精确清理；raw preload 只保留显式 Prepared Panel，新增真实 command→plugin→orchestrator 入口，缓存复用零额外 provider call，并把 Save/两处 expand 与 orchestration seam 全部锁为只读；空缓存 preflight 移至所有 surface/state mutation 前；future adapter 进入 B-122 | producer-order、show-failure、regular/nudge presentation、close-before-resignal、shared cooldown wake、same-candidate once、toggle/focus/hide/destroy、source invalidation、command registration/dispatch、empty/non-empty cache、existing Panel/Bubble/layout/pending preservation、zero-provider、current-analysis isolation、read-only DOM/seam + independent re-audit | Validated |

## DEC-023 And DEC-024 Runtime Reconciliation Execution Record

本节是 F-03/F-10/F-11/F-12 的后续执行合同，不新增产品决定，也不替代 DEC-023/DEC-024：

- “B-118 回到 Implementing”只表示交付生命周期从待验证退回实现阶段；不是回滚既有
  code，也不抹掉其他 slice 已通过的自动化证据。重新打开 F-03/F-10 两个 P1，并新增
  F-11 P2 与 F-12 P1；修复后仍须重做相关验证。
- B-119 仍是 Planned，只复用修复后的共享 gate；本记录不授权提前实现 B-119。
- 用户已授权 B-118 runtime 修复与验证；commit、push、tag、release 均未授权。

### Pre-remediation Runtime Facts (Closed)

下表保留 2026-07-21 修复前的冲突证据；当前实现已由本 Tracker Validation Log 的
最新自动化与复审记录取代，不得再把这些旧行解释为现行 runtime 状态。

| Path | Current source evidence | Why it conflicts with DEC-023 |
| --- | --- | --- |
| Fresh-install merge | [Pagelet settings merge](../../../../src/settings/pagelet/index.ts) `:345-363` 只有旧 authorization tuple 已是 `authorized-v1`、context 非空且持久值显式为 `true` 时才得到 enabled；[B-118 test](../../../../__tests__/pagelet-b118-ui-ux-optimization.test.ts) `:119-124` 还明确断言 `mergePageletSettings({}) === false` | `PAGELET_DEFAULTS` 虽为 true，fresh install 实际仍关闭，标准有界 Scope Recap 不会默认工作 |
| Scope Recap reachability | [Orchestrator](../../../../src/pagelet/orchestrator.ts) `:1217-1238` 在 `scopeRecapPreparationEnabled=false` 时先返回，之后的 shared notice 与 auto-authorization 不可达 | 测试注释所说“orchestrator first run auto-enables”在 fresh install 路径上不会发生 |
| Quiet Recall timing | [Orchestrator foreground](../../../../src/pagelet/orchestrator.ts) `:673-682` 与 background nudge `:2258-2272` 都在调用 `host.runQuietRecall()` 前立即标记/通知；但 [plugin runtime](../../../../src/plugin.ts) `:3723-3867`、`:3885-3936` 之后仍可能因 capability、active note、Data Boundary、无候选、provider、cooldown 或 budget 不发生 provider call | 用户可能收到“首次使用”通知、flag 变 true，但本次根本没有实际 provider 调用 |
| Discover coverage | [Discover route](../../../../src/pagelet/orchestrator.ts) `:1721-1777` 在 `host.discoverConnections()` 前没有 shared notice；[Bubble Discover](../../../../src/pagelet/BubbleCoordinator.ts) `:460-490` 还会直接进入 `host.runQuietRecall()` | Discover 的首次实际 generation/evaluation call 可能完全绕过共享 gate；`findRelatedNotes()` 是否会触发更早的 provider-backed retrieval 也必须在实现时沿调用链确认 |
| Quiet Recall semantic/source boundary | 2026-07-21 completion audit 发现候选收集可退化为 tag/link/path/time metadata-only，并可能在读取正文后用 fresh stat 构造 snapshot | metadata-only 无法履行 pure-semantic Recall；fresh stat 不能证明 provider 使用的是同一版正文。DEC-024 已定目标，当前修复必须由 zero-overlap semantic 与 mutation-race tests 证明 |
| Foreground Review / generic preload classification | 2026-07-21 privacy completion review 发现 high-risk 分支只有测试层语义，production Review/preload admission 没有按过滤后的实际来源与完整后台 envelope 分类 | 请求标签不能代替实际披露范围；多来源 foreground 若直走 standard 会漏确认，后台越界若弹确认或继续调用都会违反安静、fail-closed 边界。DEC-023 Option A 已定目标，当前修复必须由 RR-17..19 证明 |
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
3. 首次披露只能在 capability、provider、eligible sources/query、Data Boundary、index/
   cache、cooldown、非落账 budget availability、source/current-run revalidation 与该次
   invocation 适用的 no-call gate 全部通过后，紧邻真实 provider invocation 前发生。
   冷 query embedding 本身用于生成候选，因此 candidate/quality 不是它的前置 gate；
   evaluator invocation 才要求 candidate、quality/evaluator-cache 等适用 gate。若本轮
   不会调用 provider，则 notice=0、flag mutation=0。高风险 affirmative Run 后重新做
   final capacity/source check；capacity/admission 必须串行协调，notice/flag、actual-call
   slot 落账与 invoke 之间不得再有 awaitable/fallible no-call gate。
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
8. Foreground Review 必须先完成 Data Boundary 过滤与 path 去重，再按本次即将发送的
   实际允许来源集合分类：`<=1` 为 standard bounded，`>1` 为 high risk。请求
   `last7` 但实际只有 1 个来源仍为 standard。高风险 `Run` 前 provider call、quota/cost
   reservation 与 shared flag mutation 都为 0；`Adjust` 后重建来源集合并重新分类。
9. Generic background preload 只有同时满足显式 opt-in、changed-only、最近 7 天、实际
   provider input `<=4K`、实际调用不超过 2/rolling-hour 与 20/local-day、
   `allowWrite=false`、每个实际来源均通过用户显式配置的 shared Data Boundary 且无
   whole-vault/excluded override 时才是 standard bounded。敏感性不做内容猜测，也不得由
   调用方以 `sensitiveScope=false` 自证；未命中 folder/tag/generated-source 边界的笔记按
   普通允许来源处理。
   changed-only 的 per-vault、per-path path/mtime watermark 必须跨 reload/Pagelet off-on
   持久；只有实际调用成功、结果接纳且 captured source snapshot 仍 current 的文件才推进，
   no-call 不得标记 analyzed 或覆盖 cache。watermark 存储不可用/损坏 fail closed；fresh
   opt-in 缺失 key 是合法空基线。每个 provider-bound source 在调用前按刚读取正文复核
   显式 tag/frontmatter 与 path policy，不能让 MetadataCache 滞后 fail open；leading
   frontmatter 无法可靠解析时跳过。finding 的 source path 必须精确属于实际允许输入。
   任一条件失败必须在 shared admission/reservation 前 silent skip，不弹 blocking UI、
   不调用、不落账、不改 flag；完整窄 envelope 不因 `weekly/last7` 标签被判为 high risk。
10. Quiet Recall 在 Memory/VSS index ready 时必须保留 pure-semantic candidate lane。冷
   query embedding 是真实 provider call：通过 capability/provider/Data Boundary、eligible
   source/query、cooldown、现有 10/hour、50/day capacity precheck 与 source/current-run
   revalidation 后，进入同一个 DEC-023 admission；只有 standard admission 或高风险
   affirmative Run 完成、调用即将发生时才落账一个 slot 并 invoke，再在本地 index
   检索。query embedding、initial evaluator 与 language retry 共用该 bucket；禁止新增
   retrieval quota，高风险确认前不得落账 call/cost。
11. 空 semantic retrieval 只保证 downstream evaluator/generation=0；已经发生的 embedding
   attempt 与 first-use state 不回滚。index not ready、无 source/query、其他调用前 deny/
   stale 路径仍为总调用 0。metadata-only relation 只可在 explicit Discover 中以 local clue
   呈现，不得冒充 semantic relevance/AI Recall 或触发 nudge。source identity 必须来自
   read-time snapshot，并在每个 provider seam 与结果使用前复验；stale output 丢弃。

### Focused Regression Matrix

| ID | Scenario | Required result |
| --- | --- | --- |
| RR-01 | preparation 字段不存在，且没有显式 false/旧 `declined-v1` 的 fresh or legacy load | preparation=true；不要求预先存在旧 authorized tuple/context |
| RR-02 | 已持久化 `scopeRecapPreparationEnabled=false` 或旧 `declined-v1` 后 reload/upgrade | 仍为 false；provider/notice/flag mutation 均为 0；只有用户主动重新开启才清除 decline |
| RR-03 | 首次 eligible Scope Recap 实际调用 | notice=1、provider call=1、flag=true；当前 run 不被通知阻断 |
| RR-04 | Recap provider missing、来源不足、Data Boundary deny 或 capability off | notice=0、provider call=0、flag 仍 false |
| RR-05a | Quiet Recall 无 eligible source/query、index not ready、capability/provider/Data Boundary deny、冷检索 admission 前 cooldown/budget reject，或首次 invocation 前 source/current-run drift | notice=0、provider call=0、cost=0、flag 仍 false |
| RR-05b | index ready、uncached、全部 gate 通过，冷 semantic retrieval 返回 0 candidates | query embedding attempt=1 且计入现有 10/50 bucket；若为首次实际调用则 notice=1、flag=true；evaluator/generation=0 |
| RR-05c | index unavailable，但 metadata 存在 tag/link/path/time relation | 只可在 explicit Discover 显示 `Local related clue / 本地关联线索`；provider/notice/flag=0，不标 semantic relevance，不进入 Recall stack/nudge |
| RR-05d | 冷 semantic retrieval 已找到 candidate，但剩余 budget/provider availability 不足以进入 evaluator | 已发生的 embedding 继续计数；candidate 只可在 explicit Discover 显示无 AI why-now 的 local clue，不进入 proactive Recall/nudge |
| RR-06 | Quiet Recall foreground/background 首次进入 query embedding 或真实 evaluator | 第一次真实 invocation 前 notice=1；若 embedding 已完成首次告知，同轮 evaluator/retry 不重复；valid embedding cache hit 本身不通知 |
| RR-07 | 主 Discover 与 Bubble Discover 首次实际 generation/evaluation/retrieval call | 两条入口都先经过共享 gate；仅 explicit links/local fallback 时不通知 |
| RR-08 | Recap → Recall → Discover 及任意反向首次顺序 | 全局总 notice=1；三个 feature 不创建独立 flag |
| RR-09 | `pageletProviderFirstUseNotified=true` 的既有用户 | notice=0；eligible provider call 正常继续 |
| RR-10 | 两个首次 eligible run 并发或重入 | notice=1、持久化一次；各 run 仍服从自己的 budget/context gate |
| RR-11 | 第一次实际调用是高风险，选择 Cancel / close / Adjust / Run | Cancel/close：零调用、零成本、flag=false；Adjust 仍高风险：重新确认且 flag=false；Adjust 降为标准有界：普通 shared notice；Run：完整 blocking disclosure=1、non-blocking notice=0，仅在全部 gate 通过且 invocation immediately next 时 flag=true/call=1 |
| RR-12 | 首次 provider attempt 在网络/解析阶段失败 | 已发生真实 attempt，因此 shared flag 保留 true；不得因失败重复打扰或转授其他权限 |
| RR-13 | shared flag 已为 true 后再次运行高风险范围 | 每次仍显示 blocking disclosure；Cancel/close 零调用/零成本，Run 通过 gate 后才调用 |
| RR-14 | Quiet Recall source 在正文读取、query embedding、candidate evaluation 或结果接纳之间变化 | provider seam 前变化：本次调用=0；provider 返回后变化：stale result 丢弃、Recall/nudge=0；不得用 fresh stat 覆盖 read-time identity |
| RR-15 | 当前笔记与候选不存在 tag/link/path/title overlap，但 local index 语义相关 | cold semantic retrieval 可发现候选；仍须通过独立 evaluator/why-now gate；metadata-only collector 不能作为通过证据 |
| RR-16 | exact query-embedding cache identity 或 attempt lifecycle | exact query + embedding profile/provider/model hit 可跳过 embedding，但必须重跑 local search 并复验当前 source/Data Boundary/run；query/profile 变化必须 miss；failed/aborted/rejected attempt 不得入 cache |
| RR-17 | Foreground Review 风险分类：`current` actual allowed=1；requested `last7` 过滤后 actual allowed=1；actual allowed=2+；以及 high-risk 的 Run / Adjust / Cancel / close | 前两者都是 standard bounded 且不显示 high-risk modal；2+ 必须在 call/reservation 前阻断。Cancel/close 的 provider/quota/cost/flag mutation=0；Adjust 重新过滤、去重与分类；Run 后仍须 final source/capacity check，再原子 reserve/invoke |
| RR-18 | Generic background preload 完整 envelope，以及 opt-in、changed-only、recent 7 days、input `<=4K`、output `<=1K`、`<=2/rolling-hour`、`<=20/local-day`、`allowWrite=false`、每个实际来源的 shared Data Boundary allow、无 whole-vault/excluded override；另覆盖 reload/toggle、local midnight、call-counter/change-watermark 存储缺失/损坏、stale/null MetadataCache 与 finding source grounding | 完整 envelope 为 standard bounded；任一单条件违反都 silent skip，blocking UI/provider call/quota/cost/flag mutation=0；仅持久化 per-vault content-free call timestamps 与 per-path analyzed mtimes，reload/toggle 不恢复配额或重发 unchanged source，本地日重置不影响仍在 rolling hour 内的调用；no-call 不推进 watermark；任一存储异常或最新正文 boundary 无法确认时 fail closed；finding source 不属于实际输入则丢弃 |
| RR-19 | 合规窄 preload 的 scope/range 标签为 `weekly` 或 `last7`，以及非合规 broad/weekly run | 合规窄 changed-only preload 仍为 standard bounded；foreground 按 RR-17 的 actual-source count 分类；其他 background 越界按 RR-18 silent skip，禁止仅凭 broad/weekly 文案改变规则 |

### Execution And Exit Gate

1. 已获得 runtime 修复与验证授权；先更新
   `pagelet-settings`、`pagelet-b118-ui-ux-optimization`、`pagelet-orchestrator`、
   `pagelet-bubble-coordinator`、`plugin-record-note`、VSS semantic retrieval 与 source-race
   的相关 focused tests，再做最小实现。
2. 运行 focused tests、TypeScript/local validation gate 与 adversarial review；任何发现的
   provider call 旁路都回填 F-10，不以 helper 存在本身判定完成。
3. F-03/F-10/F-11/F-12 的 runtime、测试和 review 已闭合，B-118 从 Implementing
   进入 Validating；最新 desktop/iPhone smoke 与真机 F-04 修复复验完成后进入 Validated。
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
| 2026-07-21 | B-118/REQ-10 / B-118/AC-10 | DEC-024 Option A product-contract sync + `npm run docs:check` + docs-only `git diff --check` | Pass | 248 Markdown / 1778 local links；RR-05a..d、RR-14..16、F-11、Quiet Recall/Bubble/Data Boundary/Eval/Pagelet/Active Package aligned；legacy Product Specs 已补标准 lifecycle metadata；不代表 runtime 或 app smoke 已通过 |
| 2026-07-21 | B-118/REQ-03、10 / B-118/AC-03、10 | DEC-023 Review/preload Option A contract sync + `npm run docs:check` + docs-only `git diff --check` | Pass | 248 Markdown / 1779 local links；foreground actual-source gate、generic preload exact envelope、RR-17..19、Data Boundary/Eval/Pagelet/Active Package aligned；不代表 F-12 runtime 或 app smoke 已通过 |
| 2026-07-21 | B-118/REQ-10 / B-118/AC-10 | DEC-023 sensitive-boundary Option A + generic preload cap/persistence reconciliation + `npm run docs:check` | Pass | 247 Markdown / 1776 local links；敏感性改由用户显式 shared Data Boundary decision 推导，不做内容猜测或调用方自证；4K/1K、2/rolling-hour、20/local-day、reload/toggle persistence 与存储 fail-closed 已进入 Decision/Spec/SDD/Tracker；runtime/full app validation 另计 |
| 2026-07-21 | B-118/REQ-01..10 / B-118/AC-01..10 | `npm test -- --runInBand` | Pass | 162 suites / 3327 tests；含 cold embedding latest-body、Saved Insight all-ref live validation、snapshot 不可补造与 scope preview/runtime parity |
| 2026-07-21 | B-118 runtime/docs | lint、build、`npm run docs:check`、`git diff --check`、local community DOM scan | Pass | TypeScript/Tailwind/esbuild 通过；159 Markdown / 1149 links；zero whitespace issues；DOM scan zero matches（`rg` exit 1） |
| 2026-07-21 | F-03/F-10/F-11/F-12 | Second-pass adversarial privacy review | Pass | 原 3 个 P1 与 snapshot-not-forgeable P2 均关闭；未发现剩余 P0/P1/P2；不替代 desktop/iPhone smoke |
| 2026-07-21 | B-118/REQ-01..10 / B-118/AC-01..10 | `make deploy` | Pass | 162 suites / 3327 tests、lint、build 通过；四个 dist 资产已复制到 repo-local `test` vault |
| 2026-07-21 | B-118/REQ-02、06..10 / B-118/AC-02、06..10 | Desktop real Obsidian smoke | Partial pass | Reload 后 Pet 收敛为 `Pagelet is watching`；Bubble 立即显示 concrete Recap、11 sources、`View recap`/`Later`；Detail 显示 Scope/Sources 与 `12 of 23 notes; 11 skipped by your data boundary`；active editor 右下角未覆盖右侧 Chat；Settings 可见 Pagelet、generic background 2/hour、20/day、4K/1K 与独立 Quiet Recall。未主动触发真实 provider/high-risk path，未切换系统 Reduce Motion；Obsidian CLI 无法连接运行中 app，故 CLI/console 不计 Pass |
| 2026-07-21 | B-118 iPhone deployment | `make deploy-icloud` + four-asset SHA-256 comparison | Pass | 162 suites / 3327 tests、lint、build 与复制通过；`main.js` `a1aaa1ee...d12d93`、两份 manifest `ebbac391...ddd25`、`styles.css` `3bb7dba6...0909b` 均与 dist byte-match |
| 2026-07-21 | B-118 iPhone runtime/surface | iPhone Mirroring + Safari Inspector after first deploy | Fail / implementation reopened | iPhone 15 `-- Obsidian -- localhost` Inspector 已连接，plugin 2.8.4 loaded；viewport 430×932、Pet `[56,59,44,44]`、Bubble `[8,710,398,108]`。系统 Reduce Motion=true，但 blink group computed 为 `5s infinite pa-pagelet-pet-blink`；真实证据证明父级 selector 未覆盖子动画，F-04 重新进入修复 |
| 2026-07-21 | B-118/REQ-04 / B-118/AC-04 | F-04 selector repair + focused Jest | Pass | 为 idle/nudge blink、working dots、resting zzz 增加 state-qualified `animation:none`；新增 source-cascade 回归测试，focused 1 suite / 23 tests 与 `git diff --check` 通过 |
| 2026-07-21 | B-118 runtime/iPhone deployment | `make deploy` + `make deploy-icloud` after F-04 repair | Pass | 两次均为 162 suites / 3328 tests，lint/build 通过；iCloud `main.js`、两份 manifest、`styles.css` 四条 `MATCH` |
| 2026-07-21 | B-118/REQ-01、04、09 / B-118/AC-01、04、09 | iPhone post-fix real-device smoke | Partial pass | WKWebView reload 后 Reduce Motion=true；computed blink=`none`，instrumented working dot=`none`、resting zzz=`none`；Bubble transition=`0s`，Pet 44×44、portrait Bubble rect 位于 430×932 viewport；用户真手指确认长按菜单可打开。该 Inspector/portrait 步骤未覆盖浅横屏与完整手动操作，后续用户确认见下一行；未触发 Review/Discover provider call |
| 2026-07-21 | B-118/REQ-01、09 / B-118/AC-01、09 | User real-device confirmation / landscape disposition | Pass with explicit residual | 用户确认除横屏外本轮手动检测通过，其中真手指长按菜单通过；三菜单项 touch ownership 另有 production-like TouchEvent counters 的 callback once / root toggle zero 证据。用户明确要求忽略浅横屏检查，因此只记录 `NOT TESTED / accepted waiver`，不称为 PASS |
| 2026-07-21 | B-118 completion audit | Independent source/test/evidence re-audit after prior green gate | Fail / implementation reopened | 发现 AC-01 全轨迹、AC-05 Later 失败事务、AC-06 nudge/Retry/destroy、AC-07 generic-hints 解耦、无稳定 vault identity foreground quota，以及 AC-08 evidence overclaim 共 7 个 P2；再次证明绿色测试不等于完成 |
| 2026-07-21 | B-118 completion remediation | Focused Jest + TypeScript + whitespace + local community DOM scan | Pass | 8 suites / 579 tests；TypeScript 与 `git diff --check` 通过；community scan 无匹配（`rg` exit 1）；覆盖 touch 越界回移/跨 target 多指与监听清理、Later `ok:false`/reject、Recap ownership、Quiet Recall/generic cooldown 双向独立、无 identity quota 与 24-case typography cascade |
| 2026-07-21 | B-118 pre-F-13 local/iCloud deployment baseline | `make deploy` + `make deploy-icloud` | Pass / superseded by later gate | 两次各自重跑 163 suites / 3385 tests、lint、TypeScript/Tailwind/esbuild；该记录发生在 owner-admission completion audit 前，不再称为最终证据 |
| 2026-07-21 | B-118 pre-F-13 deployment identity baseline | Three-way SHA-256 comparison: dist / repo-local test / iCloud test | Pass / superseded by later identity | 三处当时一致：`main.js` `c01cae3f...3c17f`；两份 manifest `ebbac391...ddd25`；`styles.css` `1781eebe...b845` |
| 2026-07-21 | B-118/REQ-08 / B-118/AC-08 | Typography evidence boundary | Pass with tooling residual | 24-case 14/16/24px × light/dark × zh/en × desktop/mobile deterministic CSS cascade/layout matrix 与 target selector floor/overflow tests 通过；用户确认本轮手动可见界面通过。自动 browser computed matrix 因本地 Chrome 退出与 in-app Browser URL 安全策略被 BLOCKED，不记为真实 app computed PASS |
| 2026-07-21 | B-118/F-13 completion remediation | Focused Jest + TypeScript + lint + whitespace + local community DOM scan | Pass | 根侧独立扩展回归 10 suites / 631 tests；worker final 5 suites / 174 tests 与完整 `plugin-record-note` 266 tests 通过；TypeScript、lint、`git diff --check` 通过；community scan 无匹配（`rg` exit 1） |
| 2026-07-21 | B-118/F-13 independent completion re-audit | owner admission、raw preload、source invalidation、AC-01/AC-08 regression boundary | Pass after one repair / superseded by closure audit | 首轮只读审查发现 Recap/Quiet Recall 来源失效未统一 reconcile 的 P2；改为统一 `reconcilePetNudge()` 并补 Recap-only、QR + unadmitted raw payload 回归；随后 closure audit 继续检查任务可完成性 |
| 2026-07-21 | B-118 post-F-13 deployment baseline | `make deploy` + `make deploy-icloud` | Pass / superseded by Prepared-entry repair | 两次各自重跑 163 suites / 3413 tests、lint、TypeScript/Tailwind/esbuild；发生在 Prepared 生产入口/只读边界修复前，不再称为最终证据 |
| 2026-07-21 | B-118 post-F-13 deployment identity baseline | Three-way SHA-256 comparison: dist / repo-local test / iCloud test | Pass / superseded by final identity | 三处当时一致：`main.js` `859cb9b7...63af1`；两份 manifest `ebbac391...ddd25`；`styles.css` `1781eebe...b845` |
| 2026-07-21 | B-118 Prepared-entry closure audit/remediation | Production reachability + Panel-only/read-only boundary + focused Jest/TypeScript/diff/community scan | Pass after one repair / superseded by empty-cache repair | 审查发现 Prepared 私有路由仅由未使用 legacy builder 指向，且普通 Panel 会暴露 Save/expand 的 P2；补 `pa-pagelet:open-prepared-review` 全链路与 `preparedReadOnly` 双层 guard。该轮 3 suites / 188 tests、TypeScript、`git diff --check` 通过；随后复审继续发现空缓存 preflight 过晚的状态污染 P2 |
| 2026-07-21 | B-118 Prepared empty-cache closure repair | Existing Panel/Bubble/layout/pending preservation + focused Jest/TypeScript/diff/community scan | Pass after one repair | 将空缓存检查移到关闭 Bubble、覆盖 layout、清 pending 等所有 surface/state mutation 之前；补既有 Discover/Summary Panel、Bubble 与同一 pending object 保持、provider spies=0 回归。最终聚焦门禁 3 suites / 189 tests，TypeScript、`git diff --check` 与 community scan 通过 |
| 2026-07-21 | B-118 final local/iCloud deployment | `make deploy` + `make deploy-icloud` | Pass | 两次各自重跑 163 suites / 3417 tests、lint、TypeScript/Tailwind/esbuild；repo-local 与 iCloud test vault 均已更新 |
| 2026-07-21 | B-118 final deployment identity | Three-way SHA-256 comparison: dist / repo-local test / iCloud test | Pass | 三处完全一致：`main.js` `ca03053f4d9e016593505ffd2e536e55b89bb3f27f1861928026a7fb63a51480`；两份 manifest `ebbac391df3e1df63f56971ea70f5836251979136ce7cfbfc5a84c3ebc6ddd25`；`styles.css` `1781eebe44ccb72168662f75a5dec3a540dfa393246655909102a275b0f9b845` |
| 2026-07-21 | B-118 deployed Obsidian runtime | Command registry + empty-cache command + provider-free shell runner | Pass with unrelated BLOCKED probe | 生产注册表含 `personal-assistant:pa-pagelet:open-prepared-review`；空缓存执行显示 `No background suggestions are available yet.` 且不打开 Panel、无捕获错误。安全更新后的 shell runner 为 26 PASS / 1 BLOCKED / 0 FAIL，并继续完成 background-status command；D6 probe 因 durable device-local Memory 需要隔离 fixture 而 BLOCKED，未触碰 Memory。随后自动 Memory maintenance 曾记录单文件 refresh/retry，但状态仍 `ready`、`dirtyCount=1`，属于既有 Memory/VSS 环境残留，不作为 B-118 PASS 或 blocker |
| 2026-07-21 | B-118 final documentation evidence sync | `npm run docs:check` | Pass | 159 Markdown files / 1152 local links；Tracker、Plan、SDD、handoff、current Product contracts 与 smoke runner contract 已同步最终 gate/hash/runtime/manual/waiver 证据 |

## Decision Log

| Date | Decision | Impact |
| --- | --- | --- |
| 2026-07-19 | [DEC-021](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md) | 采用 evidence-led staged hardening，保留非回归基线；未决 Recall/authorization/reprompt 语义进入 SG-01..07 |
| 2026-07-19 | SG-01..SG-07 | 不由 Claude Code 擅自决定 frequency/migration、actions、feedback、Later、shared authorization、Modal Run/reprompt 或 Discover/name/quiet-first-screen |
| 2026-07-20 | SG-01 decided | Off/On 两档，无频率 cap。quality gate + quiet hours + Focus Mode + 每 candidate 一次足够。旧 `true` 映射 On |
| 2026-07-21 | SG-01 migration clarified | runtime 与 Settings 只使用 `quietRecall.quietRecallMode`；显式 canonical 优先，其次一次性吸收短期 `pagelet.quietRecallMode` mirror，再迁移 legacy boolean，最终默认 Off；下一次保存删除 mirror |
| 2026-07-20 | SG-02 decided | View + Later + Dismiss。Link/Save 留在 Tab 内 |
| 2026-07-20 | SG-03 decided | Dismiss = 弱信号，仅影响该具体候选。RHP 关闭时零影响 |
| 2026-07-20 | SG-04 decided | Later = 进入 Review Queue（explicit return intent） |
| 2026-07-20 | SG-05 decided | 标准有界 Pagelet provider 路径共享一次 first-use notification；不创建 feature-specific authorization。高风险范围仍逐次确认 |
| 2026-07-20 | SG-06 decided | 去掉标准 first-use Modal；Settings capability opt-out + 首次非阻断通知，当前 eligible run 继续 |
| 2026-07-20 | SG-07a decided | 英文保持 Quiet Recall，中文改为"相关回顾" |
| 2026-07-20 | SG-07b decided | 保持现状。Discover 结果进入 Panel，无需改动 |
| 2026-07-20 | SG-07c deferred | B-118 不改变 Quiet Bubble 空状态，已记入 [B-121](../../../backlog.md) |
| 2026-07-20 | Philosophy update | 新增 provider trust model：配置 provider = 信任决策，默认可用 + 透明通知 + Settings opt-out，不用 blocking modal |
| 2026-07-21 | [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md) | 正式统一 SG-05/SG-06：只复用 `pageletProviderFirstUseNotified`，不重置 notice/opt-out；broad/sensitive/costly/whole-vault/out-of-envelope/excluded override 在 call/cost 前阻断；provider 信任不授予写权限 |
| 2026-07-21 | 首次高风险运行选择方案 A | 完整 blocking disclosure 同时完成 shared first-use；仅 `Run` 后所有 gate 通过且调用即将发生时写 flag，不追加普通 notice；Cancel/close/unpassed Adjust 不写，后续高风险仍逐次确认 |
| 2026-07-21 | [DEC-024](../../../product/decisions/dec-024-quiet-recall-cold-semantic-retrieval.md) Option A | 保留 pure-semantic candidates；冷 query embedding 是真实调用并与 evaluator/retry 共用现有 10/hour、50/day bucket；空检索只使 downstream evaluator/generation=0；metadata fallback 仅 explicit Discover local clue |
| 2026-07-21 | Review/preload 风险分类选择 [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md) Option A | foreground Review 按过滤去重后的实际允许来源 `<=1` / `>1` 分类，确认前零 quota/cost reservation；generic preload 仅在 opt-in、changed-only、7-day、4K input/1K output、2/rolling-hour、20/local-day、read-only、实际来源 shared Data Boundary allow 且无 override 的完整 envelope 内 standard，任一越界 silent skip；预算跨 reload/toggle 仍生效；窄 envelope 不属于 broad/weekly high-risk |
| 2026-07-21 | Generic preload 敏感性判定选择 [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md) Option A | 只依据用户显式共享 Data Boundary 的 folder/tag/generated-source decisions；每个实际来源必须为 allow 且无 override，不做内容猜测、不接受调用方布尔自证，未标记笔记按普通来源处理 |

## Closeout Readiness

- [x] Owning Product Spec 与实际行为一致。
- [x] Architecture/Pagelet contracts 与实际行为一致。
- [x] SDD 已创建且 Approved，映射 B-118/REQ-01..10 与 AC-01..10。
- [x] 当前 B-118 scope 的 P0/P1/P2 已关闭；SG-01..06 已决定并完成，或经新的
  Decision/Product Spec 正式移出 B-118 并进入 Backlog。
- [x] SG-07 已记录保持现状或后续 Backlog 的明确 disposition。
- [x] Required review、desktop/iPhone smoke 与 community gate 证据已记录。
- [x] 未完成项或明确 waiver 已记录，且没有把 landscape、iPad/provider 缺口冒充 PASS。
- [ ] `closeout.md` 已逐项记录 README、Plan、SDD、Tracker、handoff 与临时证据去向。
- [ ] Active Registry 与 Archive index 更新方案明确。

# Pagelet Attention-Aware Delivery Software Design Document

Document status: Approved
Updated: 2026-07-27
Work item: B-121
Authority: 本 track 的 source-verified implementation design、兼容性、风险与 test matrix。
Product spec: [Pagelet Attention-Aware Delivery Product Spec](../../../product/specs/pagelet-attention-aware-delivery-product-spec.md)
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)

## Source Baseline At Approval

以下内容记录本 SDD 获批时的实施前基线，用于解释设计差异，不代表当前工作区代码状态。

- `DeliveryCandidate`、`BubbleContent`、`BubbleCard` 当前位于
  `src/pagelet/bubble/types.ts`；尚无 delivery receipt。
- Recall/Recap 转换分别位于 `bubble/recall-card.ts` 与 `bubble/recap-card.ts`；
  Recap 的 evaluator/suppression fingerprint 不能复用为消费身份。
- `BubbleView.show()` 在 `setState("visible")` 后才形成可见面；stack 由
  `activeCardIndex` / `activateCard()` 驱动，适合作为当前卡 receipt 的唯一 Bubble
  提交点。
- `BubbleCoordinator` 负责 Pet 短点、默认 Bubble、主动 ticket admission 与 nudge
  owner；`orchestrator.ts` 持有 current Recall/Recap candidate 及 Detail 路由。
- `PetView` 已有 520ms hold、约 3s dismiss、三个既有 callback 与 touch synthetic-click
  抑制，但当前 `.pa-pagelet-pet-hold-menu` 是线性菜单，缺少 Ring 语义、焦点与完整
  root gesture 轨迹所有权。
- `plugin.ts::pageletVaultStorageScope()` 已用 Vault name、config dir 与本地路径生成
  device-local scope；`PageletHost` 尚无 attention storage factory。
- 现有同步 setting `scopeRecapNudgeSuppressions`、`quietAcknowledged` 不作为新 ledger/
  acknowledgement 输入，也不迁移。
- Proposed: `src/pagelet/attention/*`、`DeliveryReceipt`、`deliveryReceipt` 字段、
  `createPageletAttentionStorage()`、`PetView.openActionRing()` /
  `closeActionRing()` / `actionRingOpen`、`.pa-pagelet-action-ring*` 与对应 locale key。

## Design And Data Flow

1. 纯函数 fingerprint builder 对文本执行 NFKC、换行统一、trim 与 whitespace collapse，
   对 path 先复用 `normalizeVaultPath`，再把 version/kind/locale/可见内容/scope/source
   以 length-prefixed canonical serialization 输入两个独立 32-bit hash，输出 opaque
   `v1:<kind>:<hash>`；不使用 timestamp、score、id、provider 或 route。
2. adapter 在候选进入 Pagelet delivery 层时建立 transient
   `DeliveryReceipt { version, kind, fingerprint }`。Recall 同时接收 current path 与
   locale；Recap 接收 scope identity 与 locale。
3. `AttentionAwareDeliveryStore` 初始化时读取 host storage：严格验证 seen entry 和
   explanation acknowledgement；缺失为空，parse/read/write 失败后仅使用当前 session
   Map，并通过 `host.log()` 记录不含内容的 mode/reason。
4. `BubbleView` 只在 `show()` 完成可见状态后提交当前 content/card receipt；stack
   `activateCard()` 切换完成后提交新 active card。提交对象不写入 storage，store 只生成
   schema/fingerprint version、kind、fingerprint、seenAt、surface entry。
5. `BubbleCoordinator` 在 admission 与默认 proactive candidate 选择前调用 `isSeen()`；
   显式 Discover/Review 路径不调用该 gate。Detail handler 仅在对应
   `openPageletDetailView()` 成功 resolve 后提交被打开 target 的 receipt。
6. Pet 短点 resolver 顺序为：关闭现有 Ring/Bubble → revalidate 并显示未看 ticket
   → current 未看 Recap → ordinary content/必要 explanation → 首次 Ready Empty/
   Intentionally Quiet explanation → acknowledged empty Action Ring。若 nudge 在点击前
   已 stale/unavailable，同一次点击立即重跑 ordinary resolver；真实 render failure
   仍保留 pending。后台 Recap failure 继续 silent，不占普通 Bubble；显式 Recap command
   沿现有 Detail path 显示本地 scope/source、Retry 与 View sources。Quick Review
   使用显式 Bubble mode，acknowledged empty 显示 terse empty；异步 readiness 串行化并
   保留最新 presentation/entry，只重绘仍可见的 exact content。
7. Action Ring 由 `PetView` 独占 DOM/gesture/focus 生命周期。`openActionRing()` 先设置
   opening/open 状态，再通知协调层关闭 Bubble，以免 Bubble close 时恢复 nudge；随后
   建立带稳定 id、`role=group` 和可访问名称的三个真实 button。Bubble 入口先
   `closeActionRing(false)`。
8. Ring 开启期间 coordinator 保留 ticket 但不改变 Pet visual/focus；被动关闭回焦 Pet
   并触发一次 reconcile。action 关闭不回焦，由现有 Capture/Review/Discover target
   接管。再次长按只刷新 inactivity timer。

## Interfaces And Ownership

- `attention/fingerprint.ts`: canonical normalization、Recall/Recap receipt builder；无 I/O。
- `attention/AttentionAwareDeliveryStore.ts`: storage parse、seen/ack session truth、
  2,000 oldest-seen eviction、diagnostic mode。
- `PageletAttentionStorage`: host 注入的 `load/save` 字符串 seam；plugin 使用一个
  Vault-scoped localStorage envelope key 同时保存 seen ledger 与 explanation
  acknowledgement，不暴露 Vault path。
- `DeliveryCandidate.deliveryReceipt?`、`BubbleContent.deliveryReceipt?`、
  `BubbleCard.deliveryReceipt?`: transient UI capability；可选字段保证普通内容/Detail
  不被误记。
- `BubbleViewOptions.onDeliveryVisible`: 唯一 Bubble visibility commit callback。
- `BubbleCoordinator`: admission 与 short-click/explicit-Bubble resolver；不持久化。
- `orchestrator.ts`: 为 adapter 提供 current/scope/locale，完成 successful Detail commit，
  以及 Bubble/Ring 互斥 wiring。
- `PetView`: Action Ring DOM、手势、焦点、timeout/outside/Escape 与 teardown；不运行
  provider、不判断内容 eligibility。

## Lifecycle And Cleanup

- Orchestrator initialize 创建 store；destroy 清理引用，store 无后台 timer。
- Pet leaf change/unmount 永久取消当前 hold gesture，移除 document touch/pointer/outside/
  key listeners与 dismiss timer；Ring DOM 随 Pet unmount。
- Root hold 期间在 Pet 所属 document 安装临时 second-contact guard；无 document 的
  未挂载 seam 安全降级。520ms 后的 move/cancel/leave/invalid up、第二 pointer/触点和
  touch cancel 统一回滚“本 gesture 新开”的 Ring并延迟回焦；若 Ring 原本已开，重复
  hold 只刷新 inactivity timer，取消手势不误关既有 Ring。
- Bubble lazy mount/unmount 不改变 receipt；同一 fingerprint 重复提交为幂等，更新
  `seenAt` 但不增加条目。
- 每次 passive Ring close 只触发一次 Pet focus restore 与 nudge reconcile；action close
  不恢复 Pet focus。

## Data, Privacy, Permission And Cost

- 新存储只含版本、opaque fingerprint、时间与 `bubble|detail`，不含路径或用户文字。
- fingerprint 计算只消费 Pagelet 已有候选与 source identity，不读新增来源。
- 无 provider call、无 Vault/Markdown 写入、无同步 setting、无新增确认；Ring 动作沿用
  各自现有 Data Boundary、provider disclosure、预算与写入边界。

## Compatibility, Migration And Rollback

- 首次升级从空 ledger/ack 开始；不导入旧 `scopeRecapNudgeSuppressions` 或
  `quietAcknowledged`，允许一次过渡性重现/解释。
- localStorage identity 不可得、内容损坏或写入失败时锁定 session-only；不尝试写 Vault。
- fingerprint version 改变会让旧 entry 不再命中，是显式可恢复 rollback/bump 机制。
- desktop 四角通过 corner data attribute 朝内容区布置；phone toolbar 从 Pet 下方
  向右水平排列，并使用 safe-area/viewport clamp；右侧空间不足时整行左移，极窄/浅
  viewport 才退化为紧凑 column，且不改变 DOM/键盘顺序。
- reload/remount 后 persisted ledger 恢复；session-only mode 按预期丢失。

## Test Matrix

| Requirement / AC | Unit / integration | App smoke | Failure / fallback | Evidence target |
| --- | --- | --- | --- | --- |
| B-121/REQ-01; B-121/REQ-02; B-121/REQ-03; B-121/REQ-04; B-121/AC-01; B-121/AC-02; B-121/AC-03; B-121/AC-04; B-121/AC-05; B-121/AC-06 | canonical matrix、kind/locale/source/scope、receipt/current-card/detail、2,000 eviction | 同内容 reload 后不再主动 nudge | malformed/write-fail/session-only | Tracker T-01/T-02 |
| B-121/REQ-05; B-121/REQ-06; B-121/AC-07; B-121/AC-08 | ack-after-visible、stale nudge same-click fallback、Quick Review terse/readiness race、background Recap silent + explicit Recap Detail orientation | 首次说明；再次短点 Ring；必要解释优先 | render failure 不 ack；旧 readiness 不重绘新 content | Tracker T-03 |
| B-121/REQ-07; B-121/REQ-08; B-121/REQ-09; B-121/REQ-10; B-121/AC-09; B-121/AC-10; B-121/AC-11 | mouse/touch/keyboard exactly-once、document second-contact、post-threshold move/cancel/leave、repeat-hold identity、focus、mutual exclusion、pending nudge | 四角、Escape/outside/timeout、Ring/Bubble 切换 | no-document/unmount/leaf change cleanup | Tracker T-04/T-05 |
| B-121/REQ-11; B-121/REQ-12; B-121/AC-12 | callback reuse、无 provider/storage payload audit、storage fallback | 现有 Capture/Review/Discover 正常 | localStorage unavailable/corrupt | Tracker T-06 |

## Open Design Findings

None. 已用源码确认 adapter、Bubble 当前卡、Detail resolve、Pet lifecycle 与
device-local Vault storage 接缝；实现中发现的 P0/P1/P2 进入 Tracker 并在完成前关闭或
由用户明确延期。

## Approval

- Design authority: DEC-025 + Approved B-121 Product Spec + 用户完成流程授权。
- Approved on: 2026-07-27
- Authorized implementation scope: 本 SDD 所列 runtime、tests、必要 docs 与桌面/iPhone
  smoke；不含 Git commit/push/tag/publish/release。

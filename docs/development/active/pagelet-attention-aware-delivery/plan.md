# Pagelet Attention-Aware Delivery Delivery Plan

Document status: Approved
Updated: 2026-07-27
Work item: B-121
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: [Pagelet Attention-Aware Delivery Product Spec](../../../product/specs/pagelet-attention-aware-delivery-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

- Goal: 以设备本地、Vault 隔离的消费凭证约束主动 Recall/Recap，并把已确认空态的 Pet
  短点转换为可访问、互斥、触控可靠的 Action Ring。
- Non-goals: 不修改候选生成/质量/排序/预算；不把 seen 用于显式检索过滤；不迁移旧
  `scopeRecapNudgeSuppressions`；不提交、推送或发布。

## Dependencies And Source Surface

- 交付与展示：`src/pagelet/bubble/types.ts`、`BubbleContent.ts`、`BubbleView.ts`、
  `recall-card.ts`、`recap-card.ts`、`src/pagelet/BubbleCoordinator.ts`。
- 候选与路由：`src/pagelet/orchestrator.ts`、`src/pa/quiet-recall.ts`、
  `src/pa/scope-recap.ts`、`src/pagelet/tab/types.ts`。
- 设备本地存储：`src/pagelet/PageletHost.ts`、`src/plugin.ts` 的
  `pageletVaultStorageScope()` 与 `getPlatformLocalStorage()` 接缝。
- Pet 与样式：`src/pagelet/pet/PetView.ts`、`src/pagelet/pet/types.ts`、
  `src/custom.pcss`、`src/locales/pagelet/{en,zh}.json`。
- 测试入口：`__tests__/pagelet-bubble*`、`__tests__/pagelet-pet*`、
  `__tests__/pagelet-orchestrator*` 及新增 attention-aware delivery focused suites。

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P1 | 稳定交付身份与本地 ledger | fingerprint、receipt、seen/ack repository、fallback | focused unit tests + type-check | 数据最小化、隔离或 fallback 不成立 |
| P2 | 消费感知交付 | Recall/Recap 主动 admission、Bubble 当前卡、Detail 目标提交 | coordinator/orchestrator focused tests | 显式入口被过滤或出现批量 seen |
| P3 | 空态分流与 Action Ring | Pet 手势/键盘/焦点/互斥/布局/本地化 | Pet/Bubble integration tests + CSS scan | exactly-once、pending nudge 或 a11y 失效 |
| P4 | 审查与运行验证 | focused/full gates、PA review、桌面/iPhone smoke | P0/P1/P2 关闭，实机证据入 Tracker | 无法获得真实可见窗口/设备时不宣称完成 |
| P5 | 吸收与收尾 | current contracts/tests/tracker 对齐，按规则处理过程文档 | docs check（仅记录无关 baseline）+ closeout checklist | 不处理 B-121 外历史文档债 |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| 不稳定指纹导致误抑制/漏抑制 | versioned canonical projection；排除运行态字段；kind/locale/source/scope 入模 | 纯函数矩阵测试 | bump fingerprint version，旧条目自然不匹配 |
| 预取或隐藏卡被误记 seen | 只让 BubbleView 当前可见卡与成功 Detail 路由提交单 receipt | 首卡/切卡/隐藏卡/失败导航测试 | 关闭持久 seam 仍保留 session-only |
| localStorage 损坏或运行期失败 | 严格 parse；持久写失败后锁定 session-only；content-free log | corruption/write-failure tests | 空/会话 ledger，不写 Vault/settings |
| Ring 与 Bubble/nudge 竞态 | 单一 surface resolver；opening 标志先于互斥 close；关闭后 reconcile | interaction integration tests | 回退既有 Bubble，保留 pending ticket |
| 触控重复触发或漂移误触 | 单 gesture owner、12px 全轨迹、第二指/cancel 永久失效、synthetic click 抑制 | mouse/touch/keyboard exactly-once tests | 关闭 gesture 并清理全局 listener/timer |

## Validation Strategy

- Focused tests: fingerprint/repository、Bubble receipt、Recall/Recap admission/detail、
  empty resolver、Pet mouse/touch/keyboard/focus/mutual-exclusion。
- Type/lint/build gate: focused Jest → `npx tsc -noEmit -skipLibCheck` →
  `git diff --check` → community DOM scan；完成实现后 `make deploy` 覆盖全量测试/lint/build。
- Obsidian smoke: test Vault 验证首次空态、再次短点 Ring、主动 seen 抑制、Quick Review
  terse empty、Ring/Bubble 互斥与 pending nudge。
- Real-device / community / release gate: iPhone 验证 toolbar 下方向右水平展开、
  单指长按/移动取消、44px 目标与 safe area；不含 release。

## Approval

- Plan authority: 用户要求按已确认 spec 完成设计、开发、测试与项目规定流程。
- Approved on: 2026-07-27
- Authorized implementation scope: B-121 runtime、tests、必要 current docs 与本地部署/
  桌面/iPhone smoke；不含 Git commit/push/tag/publish/release。

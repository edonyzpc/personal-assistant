# Insight Enhancement Layer Delivery Plan

Document status: Approved
Updated: 2026-07-21
Work item: B-119
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point；不单独授权 runtime coding。
Product spec: [PA Insight Enhancement Layer Product Spec](../../../product/specs/pa-insight-enhancement-layer-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

以独立、可回退的 post-processing layer，为 Graph、Pattern 与 Maintenance 的现有结构
结果补充有来源的语义解释。标准运行保持小范围、默认启用和低摩擦；广范围、敏感或
高成本运行逐次确认。所有 AI 内容默认 ephemeral，Maintenance 只增加 preview，既有
move confirm/undo 之外没有新写权限。

本计划不包含 Writing Insight、新 Statistics section、whole-vault 默认分析、自动
Saved Insight/Memory/Markdown、Graph edge 自动晋升、AI rename/link/create、发布或
无关重构。

## Dependencies And Source Surface

- 产品 authority：[DEC-022](../../../product/decisions/dec-022-bounded-insight-enhancement-layer.md)
  与 [B-119 Product Spec](../../../product/specs/pa-insight-enhancement-layer-product-spec.md)。
- 共享合同：North Star、Data Boundary、Lightweight Graph Discovery、Saved Insight、
  Pagelet Product Design 与现有 Write Action / Maintenance move 边界。
- 结构与集成入口：`src/pa/pattern-detection.ts`、`src/pa/graph-discovery.ts`、
  `src/pa/maintenance-review.ts`、`src/pa/maintenance-review-apply.ts`、`src/plugin.ts`。
- Provider/budget：`src/pagelet/pa-review-rate-limit.ts`、`src/pagelet/pa-review-cost.ts`、
  现有 AI model callback/usage capture 与 `settings.pagelet.pageletProviderFirstUseNotified`。
- Shared-notice runtime dependency：DEC-023 是产品权威，但 2026-07-21 B-118 源码复核
  已重新打开 F-03/F-10。B-119 SDD 不得把现有 helper 当作完成的 cross-feature actual-
  call gate；应先等待/复用 B-118 修复，或在同一 shared foundation 中原子协调，禁止
  再造 B-119 专属状态。
- UI/payload：`src/pagelet/panel/types.ts`、`src/pagelet/tab/types.ts`、
  `src/pagelet/tab/TabView.ts`、`src/pagelet/tab/sections/MaintenanceReviewSection.ts`、
  `src/pagelet/tab/PageletDetailView.ts`、Pagelet locales 与 orchestrator extra mapping。
- Focused tests：`__tests__/pattern-detection.test.ts`、`graph-discovery.test.ts`、
  `maintenance-review*.test.ts`、`pagelet-panel-tab-view.test.ts`、orchestrator/settings/
  rate-limit/cost/data-boundary suites，以及新增的 enhancement suites。
- Engineering navigation：[Codex Handoff](./handoff-codex.md)。它不替代 SDD。

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| 0. Reconcile + SDD | 当前代码、DEC/Spec、共享 provider trust 和 move-only runtime 形成可实现设计 | 阅读 authority 与源码；先处理 B-118 F-03/F-10 依赖，再定义 ephemeral DTO、source allowlist、budget buckets、model usage、abort/concurrency、payload clone/render 和 test matrix | `sdd.md` Approved，覆盖 B-119/REQ-01..03/05..06 与 AC-01..10，并明确 shared actual-call gate owner | 未获实现授权或 SDD 未批准时不改 runtime |
| 1. Shared foundation | 一个不持久化正文的 enhancement runner 与独立自动/手动预算 | model invoker、usage/terminal attribution、source envelope、已闭合的 shared actual-call first notice、settings opt-out、run identity/abort | disabled/no-call/cross-feature/budget/disclosure focused tests；结构结果 deep-equal fallback | 不新增 feature-specific authorization；B-118 shared gate 未闭合时不得叠加第二套实现 |
| 2. Graph slice | 主动 Graph 显示结构优先、最多 5 条来源支持的 AI item | current-folder local corpus、bounded VSS seeds、top excerpts、four existing item types、dedupe/stable identity、Tab clone/render | Graph enhancer + existing Graph + Pagelet view tests；provider/VSS counters | VSS 不可用不得触发 Memory prepare/rebuild；index 只预览 |
| 3. Pattern slice | 现有自动路径在父级 gate 内补充语义解释/候选 | 14-day/80-note local envelope、最多 12 excerpts、3-day cooldown、semantic candidate type、single best delivery | Pattern enhancer + trigger/Focus/cooldown/Bubble/Tab tests | proactive hints/Pagelet/Focus 任一 gate 关闭时 provider=0 |
| 4. Maintenance slice | title/link/folder AI 内容以独立 overlay 呈现，move 权限不扩大 | local scan narrowing、overlay DTO、allowlisted targets、convert-to-existing-move-preview seam、apply/undo regression | AI overlay write counters=0；选中合法 folder 后 existing move confirm/undo 回归通过 | 不修改可执行 proposal 字段来绕过 validator；rename/link/create 永远不可 apply |
| 5. Integration + validation | 三项在生命周期、Data Boundary、UI 和成本上收敛 | cross-feature metadata-only dedupe、stale/abort/unload、locales、settings、review、docs sync | Local Validation Gate + `make deploy` + desktop smoke；需要时 iPhone smoke；P0/P1/P2 closed | 无真实 surface 证据不声明 UI 已验证；无 release authority |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| AI-on-AI 结论放大 | 只共享结构/去重元数据，最终 claim 回到原笔记 | source allowlist 与 cross-feature provenance tests | 关闭 coupling，三个 enhancer 独立运行 |
| token/note 数量或 VSS 调用造成隐藏成本 | 本地先缩小，note + token + actual-call 三重硬上限；embedding 单独记账 | provider/model spy、usage 与 rate/cost assertions | 额度耗尽回 structural-only；不自动扩大 scope |
| AI 文本进入可执行 Maintenance proposal | ephemeral overlay 与 executable proposal 类型/clone 分离 | deep-equal executable fields、write/action-log counters | 丢弃 overlay；保留现有结构 move path |
| 新 optional 字段在 Detail clone/locale/render 丢失 | 把 panel/tab/types/clone/render/locales 放同一 slice | payload round-trip、reopen、中英文 DOM tests | 不交付不可见字段；回退该 feature overlay |
| 现有 shared notice 被误认为已完整实现，导致 B-119 继承 fresh-install/actual-call gap | SDD 先关闭或显式依赖 B-118 F-03/F-10；只保留一个 shared admission owner | fresh install、no-call、Recap/Recall/Discover/B-119 cross-feature provider spy | 保留 structural-only；不叠加第二个 flag/helper |
| 迟到结果覆盖新 scope 或重新 nudge | run identity、AbortSignal、current-scope check | interleaving/unload/focus/disable tests | 丢弃迟到结果，恢复 structural-only stable state |
| 推断关系被当成用户结构 | structural items 固定优先；AI edge 不自动持久/晋升 | ordering、Graph edge/Queue delta tests | 仅显示来源卡，不产生 edge influence |

## Validation Strategy

- Focused tests: 每个 phase 先跑新增 enhancer suite 与相邻 Pattern/Graph/Maintenance/
  Pagelet view tests；provider/data boundary、budget、abort 和 persistence 使用明确 counter。
- Type/lint/build gate: `npx tsc -noEmit -skipLibCheck`、`git diff --check`、community DOM
  scan；最终 shared runtime/UI 变更运行 `npm test -- --runInBand`、lint、build。
- Obsidian smoke: 通过 `make deploy` 部署到 repo-local test vault，验证三条现有入口、
  structural-only fallback、source open、ignore/Keep/move confirm/undo、reload/stale 与中英文。
- Real-device / community / release gate: UI/interaction 有实质变更时执行物理 iPhone smoke，
  并明确区分自动化、DOM、桌面视觉和真机证据。真实 provider smoke 记录发送的测试
  note scope 与实际调用/成本。无 beta/stable/publish 授权。

## Approval

- Plan authority: 用户于 2026-07-20 选择 Graph + Pattern + Maintenance、默认有界运行、
  Writing 延期和 Maintenance preview/move-only boundary；技术顺序来自当前 repo audit。
- Approved on: 2026-07-20。
- Authorized implementation scope: 仅本轮 Decision/Product Spec/plan package 的 repo-local
  文档。runtime、SDD implementation、commit、push、tag、publish/release 尚未授权。

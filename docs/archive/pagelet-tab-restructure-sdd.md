# Pagelet Tab 重构 SDD

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-07-04
Status: **已实现，review follow-up 验证中**
设计文档: [pagelet-tab-restructure-plan.md](./pagelet-tab-restructure-plan.md)
审计报告: [pa-ui-ux-audit-report.md](./pa-ui-ux-audit-report.md)

当前状态以 [pagelet-tab-restructure-tracker.md](./pagelet-tab-restructure-tracker.md)
为准。本 SDD 保留原始任务拆分；2026-07-04 follow-up 已将 Memory 批量确认保留为
用户主动触发的可见候选确认，并补充 entryReason、Quiet Recall、异步 action state、
移动端触控与导航修复。

## 目标

将 Pagelet Tab（Layer 4）从 1,637 行 22 方法的单文件重构为模块化、入口感知的
审阅面。解决审计中发现的 Tab 2.9/5 最低分问题：空区段噪音、固定排序忽略入口
意图、操作状态与 DOM 渲染纠缠。同时移除已决策拆解的 Weekly Review 全部运行时
代码。

## 前置阅读

1. `docs/archive/pagelet-tab-restructure-plan.md` — 完整设计决策和依赖图
2. `docs/product/pa-product-north-star.md` — 产品北极星
3. `docs/product/pa-low-burden-review-product-principles.md` — 低负担审查原则
4. `docs/product/pa-product-information-architecture-spec.md` — 多表面路由

## 设计约束

- Tab 的产品定位："What needs my attention across the vault?"
- 有数据区段全部默认展开，零额外点击
- 空区段完全不渲染（不显示空状态卡片）
- 入口区段自动置顶
- 仅 Context Pager 默认折叠（技术参考信息）
- Section nav 锚点仅在 ≥ 3 个有数据区段时显示
- `rerenderCurrentContentPreservingScroll()` 的 scroll 保持行为必须在新架构中
  保留

## 开发阶段

```
Phase 1: Section 渲染器基础设施（接口 + 3 模块提取 + 单元测试）
Phase 2: Weekly Review 全量移除（11 层依赖清理）
Phase 3: 入口感知布局（entryReason + 排序算法 + nav 锚点）
Phase 4: 打磨和验证（生命周期 + 兼容性 + 冒烟）
```

依赖关系：Phase 1 → Phase 2 → Phase 3 → Phase 4（严格串行）

---

## Phase 1: Section 渲染器基础设施

**目标**：将 3 个操作重的区段从 TabView 中提取为独立模块，建立统一的
Section 渲染器接口和重渲染生命周期。

**风险**：提取过程中可能破坏操作回调的异步状态管理。用现有集成测试做回归保护。

**验证**：`make deploy` 通过 + 现有 `pagelet-panel-tab-view.test.ts` 全部通过
+ 新增 3 个 section 单元测试文件通过。

### Task 1.1: 创建 TabSectionRenderer 接口和共享类型

**文件**: `src/pagelet/tab/sections/types.ts`（新建）

变更内容：
- 定义 `TabSectionRenderer` 接口：`hasContent()`, `render(container)`,
  `rerender()`, `destroy()`
- 定义 `TabSectionCallbacks` 类型：`requestRerender: () => void`
- 迁移 TabView 内部共享类型到此文件：
  - `MemoryCandidateActionStatus`, `MemoryCandidateActionState`,
    `MemoryCandidateActionResult`
  - `MaintenanceActionUiStatus`, `MaintenanceActionUiState`
  - `QuietRecallSaveStatus`, `QuietRecallLinkStatus`, `QuietRecallSaveState`,
    `QuietRecallLinkState`, `QuietRecallLinkResult`
  - `QuietRecallSaveResult`（如果从 TabView 内部定义）
- 导出用于各 section 构造器的 callback 类型

非目标：不改动 TabView.ts 的运行时逻辑。仅创建接口和类型文件。

验收标准：
- 接口文件存在且通过 `tsc --noEmit`
- 接口包含 `rerender()` 方法
- 接口包含 `hasContent()` 返回 boolean
- 所有 12 个内部类型从 TabView 移到此文件

### Task 1.2: 提取 MemoryGovernanceSection

**文件**:
- `src/pagelet/tab/sections/MemoryGovernanceSection.ts`（新建）
- `src/pagelet/tab/TabView.ts`（修改：移除提取的代码）
- `__tests__/tab-memory-governance-section.test.ts`（新建）

变更内容：
- 从 TabView 移出：`renderMemoryGovernanceContent()`,
  `renderMemoryCandidateItem()`, `confirmMemoryCandidate()`,
  `dismissMemoryCandidate()`, `confirmAllMemoryCandidates()`
- 从 TabView 移出状态：`memoryCandidateActionState` Map
- 构造器接收：`locale`, `data: PanelMemoryGovernanceState`,
  `callbacks: { onConfirm, onDismiss, requestRerender }`
- `rerender()` 实现：清空自身容器节点内容，重新调用 render 方法
- TabView 中保留 section 编排代码：构造 renderer → `hasContent()` 检查 →
  `render()` 到 bodyEl

非目标：不改变 Memory 确认/拒绝的业务逻辑。不改变 DOM 结构或 CSS 类名。

验收标准：
- `make deploy` 通过
- 现有 `pagelet-panel-tab-view.test.ts` 中 Memory 相关测试通过
- 新增单元测试覆盖：confirm → confirming → confirmed 状态转换、dismiss 转换、
  用户主动触发的可见候选批量确认、空候选 hasContent() 返回 false

### Task 1.3: 提取 MaintenanceReviewSection

**文件**:
- `src/pagelet/tab/sections/MaintenanceReviewSection.ts`（新建）
- `src/pagelet/tab/TabView.ts`（修改）
- `__tests__/tab-maintenance-review-section.test.ts`（新建）

变更内容：
- 从 TabView 移出：`renderMaintenanceReviewContent()`,
  `renderMaintenanceProposalActions()`, `applyMaintenanceProposalFromTab()`,
  `undoMaintenanceActionFromTab()`, `maintenanceActionStatusText()`
- 从 TabView 移出状态：`maintenanceActionState` Map
- 从 TabView 移出类型：`MaintenanceActionUiStatus`, `MaintenanceActionUiState`
- 构造器接收：`locale`, `data: MaintenanceReviewRunResult`,
  `callbacks: { onApply, onUndo, requestRerender }`

非目标：同 Task 1.2。

验收标准：
- `make deploy` 通过
- 现有 Maintenance 相关测试通过
- 新增单元测试覆盖：apply → applying → applied 转换、undo → undoing → undone
  转换、失败状态

### Task 1.4: 提取 QuietRecallSection

**文件**:
- `src/pagelet/tab/sections/QuietRecallSection.ts`（新建）
- `src/pagelet/tab/TabView.ts`（修改）
- `__tests__/tab-quiet-recall-section.test.ts`（新建）

变更内容：
- 从 TabView 移出：`renderQuietRecallContent()`, `renderQuietRecallActions()`,
  `linkQuietRecallFromTab()`, `saveQuietRecallFromTab()`,
  `currentQuietRecallSourcePath()`
- 从 TabView 移出状态：`quietRecallSaveState`, `quietRecallLinkState` Maps
- 从 TabView 移出类型：`QuietRecallSaveStatus`, `QuietRecallLinkStatus`,
  `QuietRecallSaveState`, `QuietRecallLinkState`, `QuietRecallLinkResult`
- 构造器接收：`locale`, `data: QuietRecallRunResult`,
  `callbacks: { onSave, onLink, requestRerender }`,
  `sourcePath?: string`（从 `currentOptions.sourcePath` 传入）

非目标：同 Task 1.2。

验收标准：
- `make deploy` 通过
- 现有 Quiet Recall 相关测试通过
- 新增单元测试覆盖：save → saving → saved 转换、link → linking → linked 转换、
  失败状态、空候选 hasContent()

### Task 1.5: TabView 重渲染生命周期适配

**文件**: `src/pagelet/tab/TabView.ts`

变更内容：
- `open()` 方法：destroy 旧 section renderers → 从新数据创建 renderers。
  每个 section renderer 渲染到自己的 wrapper div 中（作为 bodyEl 的子节点），
  wrapper 不随 rerender 销毁。
- 提供 `requestRerender()` 回调给每个 section renderer：
  save scrollTop → 调用 section.rerender()（仅清空 wrapper 内容并重绘）→
  检查 hasContent() 变化 → 若 hasContent() 变为 false 则移除 wrapper →
  若有数据区段数变化则重建 nav 锚点 → restore scrollTop
- 每个 section renderer 须包含 `destroyed` 标志：`open()` 调用 `destroy()` 时
  设为 true，异步回调在 post-await 检查此标志以防止写入已销毁 renderer
- `destroy()` 委托给所有 section renderers（注意：TabView 没有 `clearState()`
  方法，所有清理在 `destroy()` 中完成）
- 更新 "summary" layoutType 路径（`renderContent()` 行 257-269）：通过
  section renderer 而非直接方法调用来渲染 MemoryGovernanceSection
- 保留 `rerenderCurrentContentPreservingScroll()` 用于 TabView 自身的
  lightweight 区段（Review Queue filter 切换等）

非目标：不改变入口排序（Phase 3）。不移除 Weekly Review（Phase 2）。

验收标准：
- `make deploy` 通过
- 所有现有集成测试通过
- Memory confirm → section rerender → scroll position 保持
- Maintenance apply → section rerender → scroll position 保持
- 全部候选确认后 → hasContent() 返回 false → section wrapper 移除
- Tab `open()` 覆盖旧 renderer 后 → 旧 async 回调不写入新 renderer
- Tab `destroy()` 不泄露 section renderer 状态
- Summary layout 通过 renderer 正确渲染 Memory Governance

---

## Phase 2: Weekly Review 全量移除

**目标**：从运行时代码中完全移除 Weekly Review 功能，保留必要的向后兼容字段。

**风险**：依赖面广（11 层，~23 文件）。遗漏引用会导致编译错误或运行时空引用。
用 `tsc --noEmit` + `grep` 做全量验证。

**验证**：`make deploy` 通过 + `grep -rn 'weeklyReview\|WeeklyReview\|
weekly_review\|weekly-review' src/ --include='*.ts' --include='*.tsx'` 仅
返回预期保留项 + 测试全部通过。

### Task 2.1: 移除核心模块

**文件**:
- `src/pa/weekly-review.ts`（删除）
- `src/pa/index.ts`（修改：移除 re-export）
- `__tests__/weekly-review.test.ts`（删除）

变更内容：
- 删除 `src/pa/weekly-review.ts`（~390 行）
- 从 `src/pa/index.ts` 移除 `export * from "./weekly-review"` 行
- 删除 `__tests__/weekly-review.test.ts`（~179 行）

验收标准：
- `tsc --noEmit` 通过（无悬空引用）
- 被删除文件不存在于 `src/` 和 `__tests__/`

### Task 2.2: 移除 Tab 和 Panel 层引用

**文件**:
- `src/pagelet/tab/TabView.ts`（修改）
- `src/pagelet/tab/PageletDetailView.ts`（修改）
- `src/pagelet/tab/types.ts`（修改）
- `src/pagelet/panel/types.ts`（修改）
- `__tests__/pagelet-panel-tab-view.test.ts`（修改）

变更内容：
- TabView：删除 `renderWeeklyReviewContent()`,
  `populateWeeklyReviewActions()`, `handleWeeklyReviewSaveClick()`,
  `refreshWeeklyReviewActions()`, `resetWeeklyReviewUiState()`,
  `ensureWeeklyReviewUiState()`, `acceptedWeeklyItemIdsForReview()`,
  `saveWeeklyReviewFromTab()`, `WeeklyReviewUiMode`, `WeeklyReviewSaveStatus`,
  `onSaveWeeklyReviewNote`
- PageletDetailView：删除 weeklyReview deep-copy 和 wiring
- types.ts：删除 `weeklyReview?` 字段和 `PanelWeeklyReviewState` import
- panel/types.ts：删除 `PanelWeeklyReviewState` type alias 和字段
- 测试文件：删除 weekly review 测试块

非目标：不删除 `rerenderCurrentContentPreservingScroll()`（已被所有 action
回调使用）。

验收标准：
- `tsc --noEmit` 通过
- `make deploy` 通过
- Weekly review 测试块在测试文件中不存在

### Task 2.3: 移除 Bubble 和 Orchestrator 层引用

**文件**:
- `src/pagelet/bubble/BubbleContent.ts`（修改）
- `src/pagelet/bubble/types.ts`（修改）
- `src/pagelet/bubble/index.ts`（修改）
- `src/pagelet/index.ts`（修改）
- `src/pagelet/orchestrator.ts`（修改）
- `__tests__/pagelet-bubble-content.test.ts`（修改）
- `__tests__/pagelet-orchestrator.test.ts`（修改）

变更内容：
- BubbleContent：删除 `buildWeeklyReviewNudgeContent()`,
  `WeeklyReviewNudgeOptions`
- bubble/types.ts：删除 `onWeeklyReview` 回调
- bubble/index.ts、pagelet/index.ts：删除 re-export
- orchestrator：删除 `weeklyReview` 在 `expandPanelToTab()` 和
  `hasPanelContent()` 中的引用
- 测试文件：删除 weekly review nudge 测试、更新 orchestrator 测试数据

验收标准：
- `tsc --noEmit` 通过
- `make deploy` 通过
- bubble content 测试不含 weekly review 用例

### Task 2.4: 清理 Locale、CSS、文档

**文件**:
- `src/locales/pagelet/en.json`（修改）
- `src/locales/pagelet/zh.json`（修改）
- `src/locales/plugin/en.json`（修改）
- `src/locales/plugin/zh.json`（修改）
- `src/custom.pcss`（修改）
- `docs/archive/pa-weekly-review-product-spec.md`（修改：添加 deprecated header）
- `docs/product/pa-product-information-architecture-spec.md`（修改）
- `docs/product/specs/pa-active-vault-indexer-product-spec.md`（修改：移除 weekly review
  交叉引用）

变更内容：
- **CRITICAL**: 先将 `pagelet.tab.weekly.whyNow` 重命名为
  `pagelet.tab.common.whyNow`，并更新 Graph Discovery（TabView L1099）和
  Pattern Detection（TabView L1141）的引用。此键被三个功能共用，直接删除会
  破坏 Graph Discovery 和 Pattern Detection。
- 移除 pagelet locale 中 `pagelet.bubble.weeklyReview.*`（3 键）、
  `pagelet.command.weeklyReview`（1 键）、剩余 `pagelet.tab.weekly.*` 和
  `pagelet.weekly.save.*`（~13 键，不含已重命名的 whyNow）
- 更新 plugin locale 中 provider disclosure 文案（移除 "weekly" 引用）
- 移除 custom.pcss 中 `.pa-pagelet-tab-weekly-*` 规则（~8 条）
- `pa-weekly-review-product-spec.md` 顶部添加 deprecated callout
- IA spec 移除 weekly review 引用
- Active Vault Indexer spec 移除 weekly review 交叉引用

非目标：不删除 settings.ts 中 `@deprecated` 的 `WeeklyReviewSettings`（向后
兼容）。不删除 `memory-governance-store.ts` 中 `"weekly_review"` confirmationSource
（数据兼容）。不删除 `retrieval-habit-profile.ts` 中 `"entry:weekly_review"`
（数据兼容）。不删除 `ReviewNoteGenerator.ts` 中 7 天文件名前缀（属于周期总结）。

验收标准：
- `make deploy` 通过
- EN/ZH locale 文件无 weekly review 键（保留项除外）
- `grep -rn 'weekly' src/custom.pcss` 返回零结果
- `pa-weekly-review-product-spec.md` 首行有 deprecated callout

### Task 2.5: 更新测试 fixtures 和断言

**文件**:
- `__tests__/pagelet-review-note-save-flow.test.ts`（修改）
- `__tests__/e2e-pagelet-write.spec.ts`（修改）
- `__tests__/pagelet-commands.test.ts`（修改）

变更内容：
- 更新文件名引用（`pagelet-weekly-review-*` → 适当替代或移除）
- 移除 weekly review command ID 断言

验收标准：
- `make deploy` 通过
- 全部测试通过

---

## Phase 3: 入口感知布局

**目标**：让 Tab 根据打开入口自动调整区段顺序，隐藏空区段，展示 section nav。

**风险**：排序算法影响所有 Tab 入口路径。需逐个入口验证。

**验证**：`make deploy` 通过 + 逐入口手动验证 + test-vault smoke。

### Task 3.1: 添加 entryReason 数据通路

**文件**:
- `src/pagelet/tab/types.ts`（修改）
- `src/pagelet/tab/PageletDetailView.ts`（修改）
- `src/pagelet/orchestrator.ts`（修改）

变更内容：
- `PageletDetailPayload` 添加 `entryReason?: TabEntryReason` 字段
- 定义 `TabEntryReason` 类型：`"panel-expand" | "maintenance" |
  "quiet-recall" | "graph-discovery" | "pattern-detection" | "scope-recap" |
  "default"`
- 更新 orchestrator 各入口方法传入对应 `entryReason`：
  - `expandPanelToTab()` → `"panel-expand"`
  - `runMaintenanceReview()` → `"maintenance"`
  - `runQuietRecall()` → `"quiet-recall"`
  - `runGraphDiscovery()` → `"graph-discovery"`
  - `handlePatternDetectionBubbleView()` → `"pattern-detection"`
  - `runScopeRecap()` → `"scope-recap"`
  - 其他 → `"default"`

非目标：不改变 `renderContent()` 的渲染逻辑（Task 3.2）。

验收标准：
- `tsc --noEmit` 通过
- `entryReason` 从 orchestrator 到 TabView 的数据通路畅通

### Task 3.2: 实现入口感知渲染算法

**文件**: `src/pagelet/tab/TabView.ts`

变更内容：
- 重构 `renderContent()`：
  1. 从 `entryReason` 确定 primary section
  2. 收集所有 `hasContent() === true` 的 sections
  3. 排序：primary 置顶 → Action（Memory/Maintenance/Recall）→
     Tracking（Review Queue）→ Discovery（Graph/Patterns）→
     Reference（Saved Insights/Findings）
  4. 逐个 `render()` 到 bodyEl，跳过空区段
  5. Context Pager 包裹在 `<details>` 中，置于末尾
- 空区段完全不产生 DOM 节点
- 保留 summary/discover 的特殊 layoutType 路径

非目标：不添加 nav 锚点（Task 3.3）。

验收标准：
- `make deploy` 通过
- 从 `runMaintenanceReview()` 入口 → Maintenance 区段在第一个
- 从 `runQuietRecall()` 入口 → Quiet Recall 区段在第一个
- 从 `expandPanelToTab()` 入口 → Findings/Summary 在第一个
- `"default"` 入口 → Action 区段优先
- 空区段在 DOM 中不存在（`querySelectorAll('.pa-pagelet-tab-section')` 数量
  等于有数据的区段数）

### Task 3.3: Section Nav 锚点

**文件**:
- `src/pagelet/tab/TabView.ts`（修改）
- `src/custom.pcss`（修改）

变更内容：
- 当 ≥ 3 个区段有数据时，在 bodyEl 顶部渲染 nav 条
- Nav 条为水平 flex 行，每个按钮对应一个区段标题
- 点击 → `scrollIntoView({ behavior: 'smooth', block: 'start' })`
- CSS：`position: sticky; top: 0; z-index: 1` within bodyEl scroll container
- 样式复用 `pa-pagelet-tab-review-queue-filter` 模式
- 新增 CSS 类：`pa-pagelet-tab-nav`, `pa-pagelet-tab-nav-item`
- 当 section rerender 导致 hasContent() 变化时，重建 nav

非目标：不做 mobile-specific 适配（Phase 4）。

验收标准：
- 2 个区段有数据 → nav 不显示
- 3+ 个区段有数据 → nav 显示在顶部
- 点击 nav item → 平滑滚动到目标区段
- nav 在 bodyEl 滚动时保持 sticky
- section action 导致 hasContent() 变化 → nav 重建（区段数变化时 nav 更新）
- 新增测试覆盖 nav 阈值行为（2→不显示、3+→显示、区段减少→nav 移除）

---

## Phase 4: 打磨和验证

**目标**：完成生命周期清理、兼容性验证、冒烟测试。

### Task 4.1: 生命周期完善

**文件**: `src/pagelet/tab/TabView.ts`

变更内容：
- `clearState()` 委托给所有 section renderers 的 `destroy()`
- `destroy()` 清理 nav 条、section renderers、event listeners
- Workspace state persistence：`getState()`/`setState()` 正确处理
  `entryReason` 字段
- Context Pager `<details>` 的 open/close 状态不持久化（每次打开默认折叠）

验收标准：
- Tab 关闭 → 重开 → 内容和 entryReason 正确恢复
- Section renderers 无内存泄漏（destroy 清理 Maps 和 listeners）

### Task 4.2: Mobile 适配验证

**文件**: `src/custom.pcss`（可能修改）

变更内容：
- 验证 sticky nav 在 mobile Obsidian 中不被 header 遮挡
- 如有遮挡，添加 `body.is-mobile .pa-pagelet-tab-nav` 偏移
- 验证所有 section 渲染器的按钮在 mobile 上触控区域足够

验收标准：
- iOS + Android Obsidian 中 Tab 所有区段可读
- Nav 条不被 mobile header 遮挡
- 按钮触控目标 ≥ 44px（继承现有 mobile 适配）

### Task 4.3: 全量验证

变更内容：
- `make deploy`（test + lint + build）
- `obsidian-test-vault-smoke`
- 逐入口手动验证
- `grep` 确认 Weekly Review 清理完整

验收标准：
- 重构计划验证清单全部勾选
- TabView.ts 行数 ≤ 800
- Weekly Review `grep` 仅返回预期保留项

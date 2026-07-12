# PA Spec 实现后检查指导

Updated: 2026-06-29

## 用途

本文档基于对 commit `372294e` 和 `19ce850` 产品 spec 的多维度评审，提供
Codex 完成开发任务后的验收检查清单。目标是在实现代码已经存在的基础上，
补齐 spec 层面的系统性问题。

本文档是 Development Plan tracker 的**验收补充**。Tracker 管实现进度和
SDD 状态（`[D]`/`[R]`/`[A]`/`[x]`），本文档管 spec 一致性和产品行为对齐。
两者不重复：tracker 回答"任务做完了吗"，本文档回答"做出来的东西和 spec
体系一致吗"。

使用时机：Codex 完成某个 Milestone 或 Slice 的开发任务后，按对应章节逐项
检查，发现问题则修正代码或补充 spec。

## 检查协议

每个检查项的格式：

- `[P0]` / `[P1]` 优先级标记
- `[ ]` 检查项描述
- **验证方法**：具体怎么查
- **不通过时的修正动作**

先完成所有 P0 项，再检查 P1。P0 不通过会阻塞后续 Slice；P1 不通过应记录
为 debt 并在下一个 Slice 前修复。

检查结果标记：`[x]` 通过 · `[!]` 不通过需修 · `[-]` 不适用（记原因）

---

## 第一章：跨 Spec 数据模型一致性

Codex 实现了任何涉及 Queue / Card / Memory / SourceRef 的代码后，用本章检查。

### 1.1 Queue 字段与 Card 字段统一

背景：Product IA 定义队列存储字段，Trust Layer 定义卡片展示字段，两者有
交叉但不统一。实现代码中如果分别按两份 spec 写，会出现字段遗漏。

- `[P0]` `[ ]` 检查实现中的 queue item 数据结构是否同时包含存储字段（`id`,
  `type`, `scope`, `sourceRefs`, `originSurface`, `priority`, `status`,
  `dataBoundarySnapshot`, `replayRef`）和展示字段（`confidence`,
  `sensitivity`, `whyShown`, `actions`）
  - **验证方法**：`grep -rn 'interface.*QueueItem\|type.*QueueItem\|ReviewQueueItem' src/`，
    检查字段列表是否完整
  - **不通过时**：补齐缺失字段；在 Product IA spec 和 Trust Layer spec
    中各加一句互相引用，声明谁管存储字段、谁管展示字段

- `[P1]` `[ ]` 检查 card 渲染组件是否从 queue item 中读取 `confidence` 和
  `sensitivity`，而不是单独维护
  - **验证方法**：查 Pagelet card 组件的 props/interface
  - **不通过时**：统一数据源

### 1.2 Memory 生命周期状态机

背景：Memory Taxonomy 定义 6 状态（`candidate`, `active`, `archived`,
`stale`, `forgotten_tombstone`, `exported`），Trust Layer 用不同的 5 状态
体系（含 `updated`，缺 `candidate`/`exported`）。

- `[P0]` `[ ]` 检查代码中 Memory status enum/union 是否只有一份权威定义
  - **验证方法**：`grep -rn 'MemoryStatus\|MemoryLifecycle\|memory.*status' src/pa/ src/memory*`
  - **不通过时**：合并为一份，放在 `src/pa/contracts/` 或等效位置

- `[P1]` `[ ]` 检查 `exported` 在代码中是作为 status 值还是一个独立操作
  - **验证方法**：搜索 `exported` 在 memory 相关代码中的使用方式
  - **不通过时**：如果是操作，从 status enum 移除；如果是状态，在两份
    spec 中统一

- `[P1]` `[ ]` 检查 `updated` 状态是否存在于代码中
  - **验证方法**：`grep -rn "'updated'" src/pa/contracts/ src/memory*`
  - **不通过时**：决定它是一个独立状态还是只是 `active` 的一次转换，
    统一 spec

### 1.3 SourceRef 形状权威性

背景：Active Vault Indexer 定义了 `UISourceRef` 和 `ReplaySourceRef` 的
具体字段，但 Product IA 和 Trust Layer 只引用 `sourceRefs` 而未指向 AVI
作为权威定义。

- `[P0]` `[ ]` 检查代码中是否只有一份 SourceRef 类型定义
  - **验证方法**：`grep -rn 'interface.*SourceRef\|type.*SourceRef' src/`
  - **不通过时**：合并重复定义；在 Product IA 和 Trust Layer spec 中
    加引用指向 AVI spec 的 SourceRef 定义

- `[P0]` `[ ]` 检查 persisted 状态（queue/replay/card）中是否有 raw
  excerpt text 泄漏
  - **验证方法**：`grep -rn 'excerpt' src/ --include='*store*' --include='*persist*' --include='*replay*' --include='*queue*' --include='*local*'`
  - **不通过时**：改用 `ReplaySourceRef`（不含 excerpt）

### 1.4 Quiet Recall 内容类型映射

背景：Quiet Recall 定义了 5 种内容类型（`related_note`, `theme_chain`,
`counterexample`, `tension`, `remote_association`），但规范队列类型只有
`recall_suggestion`。

- `[P1]` `[ ]` 检查代码中 recall item 的 `type` 字段值是什么
  - **验证方法**：`grep -rn 'recall_suggestion\|counterexample\|remote_association' src/`
  - **不通过时**：要么给 `recall_suggestion` 加 `contentType` 子字段，
    要么把 5 种内容类型加入 Product IA 的 canonical list。同时定义 recall
    内容类型保存为 Saved Insight 时的类型映射（如 `counterexample` →
    `tension` or `observation`）

### 1.5 Confirmed Memory Schema 权威性

背景：Trust Layer（15 字段）和 Memory Taxonomy（18 字段）各自定义了
Confirmed Memory schema。

- `[P0]` `[ ]` 检查代码中 Confirmed Memory 的数据结构是否只有一份
  - **验证方法**：`grep -rn 'ConfirmedMemory\|interface.*Memory ' src/`
  - **不通过时**：Memory Taxonomy spec 拥有完整 schema，Trust Layer spec
    改为引用它

### 1.6 Memory 操作可恢复性

背景：Maintenance Review 有详细的 undo/recovery spec，但 Memory 操作的
恢复能力更弱。Forget 创建无文本 tombstone 后内容不可恢复。用户误确认
Memory Candidate 后无法知道这条记忆影响了 PA 哪些行为。

- `[P0]` `[ ]` 检查 Confirmed Memory 是否有 "最近确认" 视图或 undo 窗口
  - **验证方法**：查 Memory Panel 是否能按确认时间排序、是否有撤回操作
  - **不通过时**：加 "最近确认" 列表，7 天内的确认可撤回为 candidate
    状态。超过窗口后走正常 forget/archive 流程

- `[P1]` `[ ]` 检查 forget 操作是否有二次确认
  - **验证方法**：触发 forget，观察是否有确认弹窗
  - **不通过时**：加确认步骤，说明"内容将不可恢复，仅保留无文本删除标记"

---

## 第二章：产品行为边界检查

Codex 实现了 Pagelet UI / Bubble / Queue 功能后用本章检查。

### 2.1 Bubble 行为边界

背景：Product IA 规定 Bubble 只做 count/nudge/route，动作限于
View/Dismiss/Later。Quiet Recall 在 Bubble 加了 `Not relevant`（持久行为
信号）。

- `[P1]` `[ ]` 检查 Bubble 组件中是否有超出 View/Dismiss/Later 的动作
  - **验证方法**：读 Bubble 相关组件的 action handlers
  - **不通过时**：二选一——(a) 将 `Not relevant` 移到 Panel；(b) 更新
    Product IA spec 的 Bubble 行为边界允许轻量级负反馈，并记录决策

- `[P1]` `[ ]` 检查 Bubble 是否展示了完整卡片内容（应该只有 count/短摘要）
  - **验证方法**：读 Bubble 渲染逻辑，确认没有渲染 source excerpts 或
    完整 evidence
  - **不通过时**：将详细内容移到 Panel/Tab

### 2.2 `project_context` 命名

背景：Maintenance Review 和 Scope Recap 明确拒绝 `Project` 概念，但
Memory Taxonomy 定义了 `project_context` 类型。

- `[P1]` `[ ]` 检查面向用户的 UI 文案中是否出现了 "project" 一词
  - **验证方法**：`grep -rn '[Pp]roject' src/ --include='*.ts' --include='*.tsx'`，
    人工过滤出用户可见字符串（排除代码变量名和注释）
  - **不通过时**：二选一——(a) UI 文案中用"工作流上下文"/"领域上下文"
    替代；(b) 将类型重命名为 `workstream_context` 或 `scope_context`

### 2.3 Queue 溢出保护

背景：多个功能同时向 Review Queue 投递，无容量限制和过期策略。

- `[P0]` `[ ]` 检查 queue store 是否有 item 数量上限或 TTL
  - **验证方法**：读 queue store 的 create/add 方法
  - **不通过时**：加入 TTL（建议低置信度 item 7 天过期）和容量限制
    （建议上限 200-500 items，超出时自动过期最旧低优先级项）

- `[P1]` `[ ]` 检查 Bubble 的 nudge 是否有优先级排序
  - **验证方法**：读 Bubble 的 item 选择逻辑
  - **不通过时**：定义优先级：Memory Conflict > 待确认操作 >
    Weekly Review > Quiet Recall > Discovery

### 2.4 用户心智模型复杂度

背景：内部有 17 种队列项类型 + 5 种记忆类型 + 6 种生命周期状态 + 6 种
洞察类型 + 5 种召回内容类型。Obsidian 用户的心智模型是"笔记和链接"。

- `[P0]` `[ ]` 检查面向用户的 UI 是否将内部类型折叠为 3-4 个概念
  - **验证方法**：打开 Pagelet Tab，检查 filter/分组标签是否使用了用户
    友好的分类（如"建议"、"记忆"、"操作"、"日志"），而非暴露全部
    17 种 canonical type
  - **不通过时**：在 UI 层加分组映射。内部类型保持精细用于存储和逻辑；
    UI filter 使用 3-4 个用户概念，详细类型仅在展开/高级视图中可见

- `[P1]` `[ ]` 检查 Saved Insight vs Memory Candidate 的区别是否需要用户
  理解 PA 内部架构才能操作
  - **验证方法**：让一个不了解 spec 的人操作 Pagelet，观察是否能自然
    区分"保存为笔记"和"让 PA 记住这个"
  - **不通过时**：用动作语言替代概念语言——"保存这条"（insight）vs
    "让 PA 记住"（memory）

---

## 第三章：新用户体验与空态

Codex 实现了 Pagelet / Review Queue / Memory Panel 的 UI 后用本章检查。

### 3.1 空态

- `[P0]` `[ ]` Review Queue 为空时是否有引导文案（而非空白）
  - **验证方法**：清空测试 vault 的 queue 数据，打开 Pagelet Tab
  - **不通过时**：加空态文案，如"PA 会在你写作和捕获时提出建议。
    试试 Quick Capture 开始。"

- `[P0]` `[ ]` Memory Panel 为空时是否有引导文案
  - **验证方法**：无 Confirmed Memory 时打开 Memory Panel
  - **不通过时**：加空态文案，如"还没有确认的记忆。PA 会在你使用过程中
    逐步提出建议。"

- `[P1]` `[ ]` Weekly Review 本周无活动时是否有优雅处理
  - **验证方法**：在低活动 vault 中触发 Weekly Review
  - **不通过时**：加"安静的一周"变体，建议回顾旧笔记或扩大时间范围

- `[P1]` `[ ]` Maintenance Review 无提案时是否有引导
  - **验证方法**：在整洁 vault 中触发 Manual Scan
  - **不通过时**：显示"当前没有维护建议。你的笔记看起来很好。"

- `[P1]` `[ ]` Insight Ledger 为空时是否有引导
  - **验证方法**：无 Saved Insight 时打开 Insight Ledger 视图
  - **不通过时**：加空态文案，引导用户从 Pagelet 或 Recall 中保存洞察

### 3.2 功能发现

- `[P0]` `[ ]` Quick Capture 是否在 command palette 中可被发现
  - **验证方法**：`Ctrl/Cmd+P` 搜索 "capture" 或 "quick"
  - **不通过时**：确保命令注册

- `[P1]` `[ ]` 用户是否有途径知道 Weekly Review 和 Maintenance 的存在
  - **验证方法**：从零开始使用 PA 一周，看是否有任何入口提示
  - **不通过时**：考虑在 Pagelet Tab 中加轻量入口（如 section header），
    或在 Bubble 中加首次提示

- `[P1]` `[ ]` Provider 未配置时是否有引导而非静默无功能
  - **验证方法**：不配置 Provider 的情况下打开 PA，观察体验
  - **不通过时**：显示引导，说明 PA 的本地功能（Quick Capture、结构信号）
    可立即使用，AI 增强需配置 Provider

---

## 第四章：确认负担与降级

Codex 实现了 AI 相关功能（Capture Enrichment / Recall / Memory Candidate）
后用本章检查。

### 4.1 确认量检查

- `[P0]` `[ ]` 单次 Quick Capture 最多产生多少个 queue items？
  - **验证方法**：捕获一条含偏好/任务/决策的句子（如"我决定用 Pagelet
    做维护，下周前完成迁移"），计数产生的 queue items
  - **不通过时**：如果 > 4 个，考虑合并（如把 title + tag 合为一个
    `capture_enrichment` 项）或降低建议激进度

- `[P1]` `[ ]` 一天正常使用后 queue 中积累了多少未处理项？
  - **验证方法**：模拟一天 5 次 capture + 正常编辑，检查 queue 长度
  - **不通过时**：调整生成频率或加入自动过期

- `[P1]` `[ ]` 多个功能同时产生 queue 项时是否可管理
  - **验证方法**：同时触发 Capture Enrichment + Quiet Recall + Maintenance
    Scan，检查 queue 是否变得不可浏览
  - **不通过时**：加分组显示或按来源折叠；确保 Bubble 不因并发产出
    而变得嘈杂

### 4.2 Provider 不可用降级

- `[P0]` `[ ]` AI Provider 不可用时 Quick Capture 是否正常工作（只保存原文）
  - **验证方法**：断开网络/关闭 Provider 配置后执行 Quick Capture
  - **不通过时**：确保 raw save 路径不依赖 Provider

- `[P1]` `[ ]` Provider 不可用时 Pagelet 是否显示有意义的内容（结构信号）
  - **验证方法**：断开 Provider 后打开 Pagelet Panel
  - **不通过时**：回退到基于链接/标签/文件夹的本地建议

- `[P1]` `[ ]` Provider 超时/错误时是否有用户可见的错误提示
  - **验证方法**：模拟 Provider 超时
  - **不通过时**：加轻量错误提示而非静默失败

### 4.3 全局静音能力

背景：每个功能有独立的 dismiss/snooze，但没有全局静音。用户深度写作时
可能需要暂停所有 PA 主动行为。

- `[P1]` `[ ]` 是否有全局 Focus Mode 或静音入口
  - **验证方法**：检查设置或 command palette 中是否有 focus/quiet/mute
    相关选项
  - **不通过时**：至少在 Bubble 上加一个 "暂停提示 N 小时" 入口。
    Capture 和 Chat 仍可用，但 Bubble 静默、Recall 暂停、Weekly 提示
    延迟。记为 spec 补丁（建议加入 Product IA）

---

## 第五章：开发计划执行检查

Codex 完成每个 Milestone 后用本章检查。

### 5.1 M0 完成后

- `[P0]` `[ ]` Tracker 是否已创建且包含所有 task ID？
- `[P1]` `[ ]` M0 是否耗时合理（建议 ≤ 1 个 session）？
  - **不通过时**：如果 M0 拆成了 6 个独立 session，说明过重，
    考虑合并 M0.3-M0.6 到 tracker

### 5.2 M1 完成后

- `[P0]` `[ ]` 契约类型是否有至少一个真实的生产者或消费者调用？
  - **验证方法**：`grep -rn 'import.*contracts\|from.*contracts' src/`，
    排除测试文件后检查是否有运行时引用
  - **不通过时**：这说明 M1 跑在 M4/M5 之前导致了死代码。
    记录为风险；在 M4/M5 完成后回来验证契约是否正确，不正确则修正

- `[P0]` `[ ]` 契约模块是否真的不 import obsidian / React / VSS？
  - **验证方法**：`grep -rn "from 'obsidian'\|from 'react'\|from.*vss" src/pa/contracts/`
  - **不通过时**：移除违规 import

### 5.3 M7 (Quick Capture) 完成后

- `[P0]` `[ ]` 空输入是否不写入任何内容
- `[P0]` `[ ]` 原文是否完全保留（无 AI 修改）
- `[P0]` `[ ]` 是否没有调用 AI Provider
- `[P0]` `[ ]` 目标路径是否受限于 Daily Note / Inbox / Current File 策略
- `[P0]` `[ ]` `make deploy` 是否通过 + Obsidian 测试 vault 冒烟
  - **验证方法**：按上述逐项在测试 vault 中操作
  - **不通过时**：修正代码

- `[P1]` `[ ]` Quick Capture 命令在 Obsidian 移动端是否可触发
  - **验证方法**：如有移动端测试环境，在移动端 command palette 中搜索
    Quick Capture 命令
  - **不通过时**：确保命令注册不依赖桌面特有 API。如移动端暂不可用，
    在 Quick Capture spec 中明确记录限制和计划

### 5.4 M10 (Weekly Review) 完成后

- `[P1]` `[ ]` Weekly Review 是否因 Recap/Theme lanes 推迟到 Phase 8 而
  缺少 vault 级洞察
  - **验证方法**：触发 Weekly Review，检查是否有"本周主题"/"反复出现的
    话题"类内容
  - **不通过时**：如无 vault 级主题，评估是否需要在 M10 阶段加一个最小
    主题聚合能力（即使粗糙），而非等到 AVI Phase 8。记录产品决策

### 5.5 每个 Slice 完成后

- `[P0]` `[ ]` 该 Slice 内的任务是否都有至少一个聚焦测试
- `[P0]` `[ ]` 涉及 vault 写入的任务是否有 undo/recovery 测试
- `[P0]` `[ ]` 涉及 Provider 调用的任务是否有 Data Boundary 检查
- `[P1]` `[ ]` 用户可见文案中是否避免了 VSS / RAG / GraphRAG / embedding /
  chunk 等技术术语
  - **验证方法**：`grep -rn '\bRAG\b\|GraphRAG\|\bembedding\b\|\bchunk\b\|top.k\|\breranker\b\|vector.score' src/ --include='*.ts' --include='*.tsx'`，
    只看用户可见字符串（排除注释和内部变量名）

---

## 第六章：集成验证

### 6.1 Slice B 完成后（M5 Review Queue 就绪）

在 Slice C（M7.4 Capture Enrichment）开始前检查。

- `[P0]` `[ ]` AVI (M4) 产出的 `RetrievalOutcome` 能否被 Review Queue (M5)
  消费
  - **验证方法**：写一个集成测试，从 VSS 搜索结果出发，经 AVI facade
    转为 RetrievalOutcome，再生成 queue item
  - **不通过时**：补集成测试，修正接口不兼容

- `[P0]` `[ ]` Data Boundary (M3) 排除的笔记是否在 AVI / Queue / Pagelet
  全链路都不出现
  - **验证方法**：将一个笔记放入 excluded folder，检查全链路
  - **不通过时**：在 adapter 层加排除过滤

### 6.2 Slice D 完成后（M8 Memory Candidate 就绪）

- `[P0]` `[ ]` Memory Candidate 是否正确进入 Review Queue 并可通过 Pagelet
  确认为 Confirmed Memory
  - **验证方法**：触发一个 memory 候选（如从 capture 或 review 中），
    在 Pagelet 中确认，检查 Memory Panel 中是否出现
  - **不通过时**：修正 queue → memory store 的管道

- `[P1]` `[ ]` Context Firewall 是否在确认后的记忆上生效
  - **验证方法**：确认一条带 scope 的记忆，在不同 scope 下检查是否被
    auto-include / ask-user / drop
  - **不通过时**：修正 firewall gate 逻辑

### 6.3 Slice E 完成后（M9 Maintenance 就绪）

- `[P0]` `[ ]` Maintenance scan 是否尊重 Data Boundary 排除策略
  - **验证方法**：excluded folder 中的笔记不应出现在 maintenance 提案中
  - **不通过时**：在 scan 入口加 boundary resolver 调用

- `[P1]` `[ ]` Maintenance 提案是否进入共享 Review Queue（而非独立队列）
  - **验证方法**：触发 manual scan，在 Pagelet Tab 的统一 queue 中检查
    是否可见
  - **不通过时**：修正 producer API 调用

### 6.4 Slice F 完成后（M10 Weekly Review + M11 Quiet Recall 就绪）

- `[P0]` `[ ]` Weekly Review 是否能从所有子系统拉取内容
  - **验证方法**：确保 vault 中有 queue items（来自 capture/recall/
    maintenance/memory），触发 Weekly Review，检查各 section 是否填充
  - **不通过时**：修正 Weekly Review 的数据源查询

- `[P1]` `[ ]` Context Pager 显示的 used/skipped 计数是否等于底层 trace
  - **验证方法**：触发一次 Chat 或 Pagelet 检索，比较 Context Pager UI
    数字和 `PersistedContextTrace` 中的值
  - **不通过时**：修正计数逻辑

### 6.5 跨功能 feedback 传播

- `[P1]` `[ ]` 在 Quiet Recall 中 dismiss 一个 `related_note` 后，
  Graph Discovery 是否还会推荐同一对关联
  - **验证方法**：dismiss 后检查 graph discovery 的推荐
  - **不通过时**：至少在同一 session 内传播 dismiss 信号

- `[P1]` `[ ]` dismiss 一个 Memory Candidate 后，Quiet Recall 是否还会
  基于同一证据推荐类似记忆
  - **验证方法**：dismiss memory candidate，等待下一次 recall 触发，
    检查是否有实质相同的推荐
  - **不通过时**：在 dismiss 时记录 sourceRef hash，recall 生成时过滤

---

## 第七章：Spec 补丁清单

以下项不是代码检查，而是需要修改 spec 文档本身的补丁。可在 Codex 完成
开发后统一做。

### 7.1 必须补的 spec 修改

| 修改 | 涉及 spec | 说明 |
| --- | --- | --- |
| 统一 queue/card 字段集 | Product IA, Trust Layer | 加互相引用，声明各自管辖范围 |
| 统一 Memory lifecycle | Memory Taxonomy, Trust Layer | 产出一份权威状态机 |
| 声明 SourceRef 权威 | Product IA, Trust Layer, AVI | 指向 AVI 定义 |
| 声明 Confirmed Memory schema 权威 | Trust Layer, Memory Taxonomy | Memory Taxonomy 为权威 |
| Recall contentType 映射 | Quiet Recall, Product IA | 定义 `recall_suggestion` 与 5 种内容类型的关系 |
| Coverage Audit delta 标记 | Coverage Audit | "insight needs delta" 改为"部分覆盖" |

### 7.2 建议补的 spec 新增

| 新增内容 | 建议位置 | 说明 |
| --- | --- | --- |
| 空态设计 | Product IA 或各功能 spec | 每个面板的空态文案和引导 |
| 降级模式 | Data Boundary 或新文档 | 每个功能在 Provider 不可用时的行为 |
| 确认量上限 | Product IA | 日/周确认量建模和产品上限 |
| 用户面向词汇表 | Product IA 或 North Star | 3-4 个用户概念到内部分类的映射 |
| Queue 容量/TTL | Product IA | 队列溢出策略 |
| 集成测试策略 | Development Plan | Slice 间的端到端验证方法 |
| Vault 规模分级 | AVI spec 或 Data Boundary | 小/中/大/超大 vault 各级预期行为和限制 |
| 移动端 Quick Capture 说明 | Quick Capture spec | 最小可用性要求或明确的限制记录 |
| Memory undo 窗口 | Trust Layer 或 Memory Taxonomy | 近期确认可撤回的时间窗口和机制 |
| 北极星补充 | North Star | 加一句"长上下文不等于长期记忆"，呼应研究原则 7 |
| 全局 Focus Mode | Product IA | 暂停所有主动行为的入口和行为定义 |

---

## 使用流程

```text
Codex 完成某 Milestone/Slice
  → 按对应章节逐项检查（先做 P0，再做 P1）
  → 标记 [x] / [!] / [-]
  → [!] P0 项必须修正后才能进入下一个 Slice
  → [!] P1 项记录为 debt，下一个 Slice 前修复
  → 全部 P0 通过后该 Slice 验收通过
  → Slice 间的集成验证（第六章）在下一个 Slice 开始前完成
```

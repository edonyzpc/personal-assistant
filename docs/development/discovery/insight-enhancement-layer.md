# Insight Enhancement Layer Discovery Brief

Document status: Current
Delivery status: Needs Decision
Updated: 2026-07-20
Work item: B-119
Authority: 本主题在产品决定前的问题、证据、讨论结论与待决策项。

## Problem And User Outcome

- Problem: PA 有 4 个核心功能（Pattern Detection、Graph Discovery、Maintenance Review、Statistics）仍为纯结构/规则/计数逻辑，无法发现结构特征覆盖不到的语义关联和跨笔记洞察。
- User / context: 用户在 vault 中积累了大量笔记，结构检测只能发现显式 tag/link/folder 关系，无法发现内容层面的隐含模式、语义关联和写作趋势。
- Desired outcome: 在不替换现有结构检测的前提下，叠加一层 AI 增强，让 PA 从"看到结构"升级为"理解内容"，使更多笔记在正确时机浮现。
- Why now: 已有 15 个功能接入 AI，LLM 调用模式（PageletReviewModel、invokeModel callback）、成本控制（CostTracker、RateLimiter）和 UI 渲染（AI callout、detail view）基础设施成熟，增量成本低。

## Evidence

| Item | Grade | Source | Implication |
| --- | --- | --- | --- |
| Pattern Detection 仅检测 3 种结构模式（recurring_tag, repeated_question, orphan_cluster），全部基于正则/计数 | Confirmed | `src/pa/pattern-detection.ts` | 无法发现内容相关但无共同 tag/folder 的笔记群 |
| Graph Discovery 仅检测 4 种结构关系，conflict_pair 依赖 regex 匹配 `status/decision/preference` 键 | Confirmed | `src/pa/graph-discovery.ts` | 无法发现语义矛盾、主题演变、隐含关联 |
| Maintenance Review 的 weak_links 基于关键词重叠，better_titles 基于正则，inbox_cleanup 固定目标 `Notes/` | Confirmed | `src/pa/maintenance-review.ts` | 链接建议精度低，标题建议原始，分类无内容理解 |
| Statistics 纯字数/句数/页数统计，无语义分析 | Confirmed | `src/stats/stats-manager.ts`, `src/stats/stats-types.ts` | 数据丰富但缺少洞察层 |
| VSS hybrid search 基础设施已可用，`PageletHost.findRelatedNotes()` 提供语义搜索 | Confirmed | `src/pagelet/PageletHost.ts:196` | 语义关联发现的基础已就绪 |
| `quick-capture-enrichment.ts` 的 `invokeModel` 轻量回调模式已验证可行 | Confirmed | `src/quick-capture-enrichment.ts` | 新功能可复用此模式，无需引入完整 PageletReviewModel |
| `MaintenanceReviewSection` 已有 AI callout 渲染支持（routedItems） | Confirmed | `src/pagelet/tab/sections/MaintenanceReviewSection.ts` | UI 层已为 AI 增强做好准备 |
| B-116 明确记录 "Pattern LLM 仅在结构检测不足且成本获批时考虑" | Confirmed | `docs/backlog.md` B-116 | 结构检测不足已由代码分析确认；成本获批为本 Discovery 待决策项 |
| North Star: "Less black-box insight, more source-backed evidence" | Confirmed | `docs/product/pa-product-north-star.md` | 每个 AI 发现必须引用具体源笔记 |
| Provider trust model: 配置 AI Provider 后功能默认工作，首次使用透明通知 | Confirmed | `docs/product/pa-product-north-star.md` | AI Enhancement 默认开启 + 首次 Notice |
| Orchestrator enhancement 集成点在 plugin 层而非 orchestrator 层 | Confirmed | `src/pagelet/orchestrator.ts:641-784`, `src/plugin.ts:3220-3239` | Enhancement 必须在 plugin 调用结构检测之后、传递给 orchestrator 之前执行 |
| `PageletCostEntry["feature"]` 是封闭联合类型，不含 "insight-enhancement" | Confirmed | `src/pagelet/pa-review-cost.ts:357` | 实现时需扩展此联合类型 |
| `PageletHost` 无 Stats 访问路径 | Confirmed | `src/pagelet/PageletHost.ts` | Writing Insight 需要在 plugin 层组装 Stats 数据，host 方法内部访问 |
| `hasForbiddenPersistedTextFields()` 会扫描 MaintenanceProposal 所有字符串字段 | Confirmed | `src/pa/maintenance-review.ts:405-433` | AI 生成的字段需要绕过或适配此校验 |
| `findRelatedNotes()` 是单笔记 API，非全 vault 搜索 | Confirmed | `src/pagelet/PageletHost.ts:192-196` | Graph Discovery VSS 增强需要多次调用，有性能影响 |
| `truncateToTokenBudget()` 未导出 | Confirmed | `src/pagelet/llm/prompts.ts:28` | 新模块需要独立实现或推动导出 |

## Candidate Requirements

### B-119/REQ-01: Pattern Detection AI 增强

对每个结构模式的源笔记内容做语义分析，生成一句话 `semanticInsight` 说明这些笔记为何真正相关（而非"它们共享 #tag"）。发现结构检测遗漏的语义模式（内容相关但无共同 tag/folder/link 的笔记群），生成新的 `CrossNotePattern`。

- 输入：`PatternDetectionResult` + 源笔记内容
- 输出：`EnhancedPatternDetectionResult`（扩展 `CrossNotePattern` 增加可选 `semanticInsight`；增加可选 `semanticPatterns[]`）
- 触发：现有自动触发流程（plugin load + 3 天冷却）之后的 background enhancement
- 约束：结构检测结果始终先行且独立可用；AI 增强是 optional 叠加层
- 质量门：`semanticPatterns` 最多 3 条，每条至少 2 个源笔记；LLM 无法生成有意义洞察时返回空
- North Star 对齐：让更多笔记在正确时机浮现——结构检测遗漏的语义关联

### B-119/REQ-02: Graph Discovery AI 增强

- 使用 VSS `findRelatedNotes()` 发现内容相似但无结构关联的笔记对
- 对 `conflict_pair` 由 LLM 读取两篇笔记内容，具体说明矛盾点
- 对 `theme_chain` 由 LLM 总结主题演变叙事
- 对 `index_note_candidate` 由 LLM 生成目录草稿

输入：`GraphDiscoveryRunResult` + 笔记内容 + VSS 语义候选
输出：`EnhancedGraphDiscoveryRunResult`（扩展 `GraphDiscoveryItem` 增加可选 `semanticClaim`；增加 VSS 发现的新 item）

约束：
- VSS 发现的新 item 最多 5 条，按 VSS score 降序取 top-5
- 前置检查 `isMemoryReadyForPageletDiscovery()`，未就绪时跳过 VSS 发现（仅增强已有结构 item）
- AI 发现 item 与结构 item 混排时，结构 item 优先展示，AI item 追加在后
- `findRelatedNotes()` 是单笔记 API，enhancer 限制每次最多调用 3 次（取最核心的 3 篇笔记）

### B-119/REQ-03: Maintenance Review AI 增强

- `better_titles`：LLM 根据笔记内容生成描述性标题建议（`aiSuggestedTitle`），作为替代选项呈现，不替换用户原标题
- `weak_links`：用 VSS 替代关键词重叠查找语义相关笔记，LLM 解释关联原因（`aiClaim`）
- `inbox_cleanup`：LLM 根据内容建议目标文件夹（`aiSuggestedFolder`）

输入：`MaintenanceReviewRunResult` + 笔记内容
输出：`EnhancedMaintenanceReviewRunResult`（扩展 `MaintenanceProposal` 增加 AI 字段）

约束：AI 字段需要适配 `hasForbiddenPersistedTextFields()` 校验，或标记为非持久化字段

### B-119/REQ-04: Writing Insight（Statistics 洞察层）

- 周级触发（7 天冷却），取最近 30 天 `StatsDashboardDay[]` + 同期修改笔记的标题/标签
- LLM 生成 2-4 条写作洞察，每条必须引用具体笔记标题/路径作为 evidence（非纯统计数字）
- 每次运行替换上一次结果，不累积
- 在 Pagelet Tab 中作为新 section 渲染（此为本设计唯一新增 UI surface）

输入：`StatsDashboardData` + 近期笔记元数据
输出：`WritingInsightResult` 含 `WritingInsight[]`（category: trend/habit/topic_shift/milestone）

North Star 风险说明：Writing Insight 是 4 个特性中与 North Star "让笔记浮现"关联最弱的特性——它是 AI 生成的分析而非用户笔记的回归。通过以下约束降低风险：
- 每条洞察必须引用具体笔记（"你在 X、Y、Z 三篇笔记中开始探索系统设计方向"而非"你的产出增长了 30%"）
- 周级触发 + 不累积 = 不产生 review 负担
- 位于 Tab 末尾，非主动推送

### B-119/REQ-05: 共享基础设施

- 新模块位于 `src/pa/insight-enhancement/`
- LLM 调用采用 `invokeModel(prompt): Promise<string | null>` 轻量回调模式
- `InsightEnhancementOptions` 包含 `abortSignal?: AbortSignal` 支持取消
- 独立 `InsightEnhancementRateLimiter`（hourly: 5, daily: 20），共享 `PageletCostTracker`（需扩展 `PageletCostEntry["feature"]` 联合类型）
- 所有 AI Enhancement 默认开启（`enabled: true`），首次使用时弹 Notice 通知，Notice 列出全部 4 项能力
- 各特性独立开关（`patternDetectionAi`, `graphDiscoveryAi`, `maintenanceReviewAi`, `writingInsight`）
- `InsightEnhancementResult` 的 `skipped.reason` 包含 `"vss_not_ready"` 值
- Enhancement 集成点在 plugin 层：plugin 调用结构检测函数后、传递结果给 orchestrator 之前执行增强

### B-119/REQ-06: 特性联动

- Pattern Detection 结果作为 Graph Discovery Enhancer 的可选上下文（避免冗余发现）
- Graph Discovery 结果作为 Maintenance Review Enhancer 的可选上下文（丰富链接建议）

## Options

| Option | User value | Cost / risk | North Star fit |
| --- | --- | --- | --- |
| A: 全部 4 个特性 AI 增强（推荐） | 覆盖完整洞察层：语义模式 + 语义图 + 智能维护 + 写作洞察 | 4 个 enhancer + 1 个新 section；LLM 调用频率由 RateLimiter 控制 | 高——前 3 个特性让更多笔记浮现；Writing Insight 以笔记引用为 evidence 降低生成风险 |
| B: 仅 Pattern Detection + Graph Discovery | 覆盖核心"笔记浮现"场景 | 2 个 enhancer；不改进维护和统计 | 中——直接对齐 North Star 核心，但 Maintenance 和 Stats 不受益 |
| C: 仅 Graph Discovery | 最小可行——语义关联是最高价值单项 | 1 个 enhancer，最低成本 | 中——单点突破，但覆盖面窄 |

## Discussion Summary

| Date | Authority / participants | Conclusion | Still open |
| --- | --- | --- | --- |
| 2026-07-20 | 用户 + Claude Agent | 确认 4 个特性全部 AI 增强（Option A） | 无 |
| 2026-07-20 | 用户 + Claude Agent | 默认启用策略：默认开启 + 首次使用 Notice（与 Chat/Scope Recap provider trust 模型一致） | 无 |
| 2026-07-20 | 用户 + Claude Agent | Statistics 写作洞察纳入，作为轻量第四特性（周级触发，独立 section） | 无 |
| 2026-07-20 | Agent team review | 14 项发现全部修复：集成点修正为 plugin 层、增加质量门/数量上限/排序规则、增加 AbortSignal、增加 VSS 就绪检查、Writing Insight 增加笔记引用要求并标注 North Star 风险、D6 修正、文档规范修复 | 无 |

## Architecture Design Summary

详细架构设计将在批准后创建的 Active Package SDD 中展开。以下为关键设计要点摘要：

### Key Design Decisions

| ID | Decision | Rationale |
| --- | --- | --- |
| D1 | 后处理增强，非替换 | 结构检测始终先行且独立可用；LLM 失败时 graceful fallback |
| D2 | `invokeModel` 轻量回调，非完整 PageletReviewModel | Enhancement 结果 optional，不需要 structured output retry 完整保障 |
| D3 | 独立 RateLimiter + 共享 CostTracker | 隔离预算，统一成本可见性；CostTracker feature union 需扩展 |
| D4 | 默认开启 + 首次 Notice（列出全部 4 项能力） | 与 Chat / Scope Recap provider trust 模型一致 |
| D5 | Statistics 洞察纳入，笔记导向 evidence | 每条洞察必须引用具体笔记，不做纯统计叙述 |
| D6 | 前 3 个特性叠加到现有 UI；Writing Insight 为唯一新增 Tab section | 最小化 UI 变更，Writing Insight 的新 section 不可避免 |
| D7 | Enhancement 集成点在 plugin 层，非 orchestrator | Orchestrator 接收的是已增强结果；plugin 层有笔记内容和 Stats 访问权限 |
| D8 | AI 发现 item 有数量上限和排序规则 | semanticPatterns ≤ 3、VSS items ≤ 5、结构 item 优先展示 |

### Implementation Phases

| Phase | Content | Depends on |
| --- | --- | --- |
| 1 | 类型基础 + Graph Discovery Enhancer + Settings + RateLimiter + 首次 Notice | — |
| 2 | Pattern Detection Enhancer | Phase 1 |
| 3 | Maintenance Review Enhancer | Phase 1 |
| 4 | Writing Insight | Phase 1 |
| 5 | 特性联动 + 端到端验收 | Phase 1-4 |

### Implementation Risks

| Risk | Mitigation |
| --- | --- |
| `hasForbiddenPersistedTextFields()` 拒绝 AI 生成文本 | AI 字段标记为非持久化，或调整校验逻辑 |
| `truncateToTokenBudget()` 未导出 | 在 insight-enhancement 模块独立实现或推动导出 |
| `findRelatedNotes()` 多次调用性能影响 | 限制每次最多 3 次调用 |
| 并发 enhancement 调用重叠 | SDD 中设计序列化或去重策略 |

## Decision Needed

- Decision: 批准 Option A（全部 4 个特性 AI 增强）进入 Product Spec 与 Active Development
- Decision authority: 用户
- Decision deadline / trigger: 本次会话或下次 review

## Related Documents

- [Codex 开发 Handoff](./insight-enhancement-layer-codex-handoff.md) — 精确代码模式、集成点、分阶段任务和验证门，供 Codex 执行开发。

## Exit

- Accepted → Decision Record + Product Spec + Active Package。Handoff 随包迁移。
- Deferred → 更新 Backlog 与重启条件。
- Rejected / Cancelled → 提炼重要 rationale 后归档；无独有信息则删除。

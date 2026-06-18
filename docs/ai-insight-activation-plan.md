# AI Insight 激活方案：从管道到洞察

**创建日期**: 2026-06-17
**最后更新**: 2026-06-17（整合产品决策与实现状态）
**版本归属**: v2.5（合并发布）
**前置文档**:
- `docs/ai-insight-foundation-audit.md` — D1-D8 完成度审计
- `docs/ai-insight-improvement-analysis.md` — 11 个方向分析 + 产品决策
- `docs/sdd-ai-insight-foundation.md` — Context & Memory 地基层 SDD

### 产品决策记录（2026-06-17）

| # | 决策 | 结论 | 说明 |
|---|------|------|------|
| AD-1 | Type C vault insights 注入 prompt | **默认开启** | 推翻 SDD §3.9.3 "默认不注入"。Projector diffing 控制成本（第 2+ 轮仅 ~50 chars）。Settings 提供关闭选项。 |
| AD-2 | 图感知检索 (1-hop link expansion) | **纳入 v2.5** | 需要正式设计，不用 activation plan 简化方案。单独做方案分析。 |
| AD-3 | Type A 用户画像演进路线 | **直接 LLM 提取** | 跳过 local-first 行为统计，一步到位实现 SDD D7 原设计的 LLM 后台提取（inferred_behavior + 置信度 + recurrence）。 |
| AD-4 | 版本归属 | **全部合并到 v2.5** | SDD D1-D8 作为 v2.4 已关闭。Activation plan 全部内容合并到 v2.5 发布。 |
| AD-5 | 与 SDD 的关系 | **SDD 已关闭，本方案是 v2.5 新范围** | SDD D1-D8 Implemented（含有意降级）。本方案不是"补完 SDD"，是"激活已有 + 补充新能力"。 |

---

## 1. 问题定义

### 1.1 产品目标

> 让 PA Agent 从"浅层搜索+摘要"跃升为"真正理解用户和 vault 的洞察者"，为后续 Action Mode（AI 编辑笔记）建立读的基础。

### 1.2 当前状态

D1-D8 已将 RAG 管道从"教科书式"升级为"工业级"：

- **切片质量** heading-aware + frontmatter 保留 (D1)
- **检索窗口** 4→8 文档、500→1000 字符摘要 (D4)
- **时间感知** query-rewriter temporal intent (D3)
- **上下文管理** Projector / Hygiene / Compactor / Budget 全套 (D5-D6)
- **用户画像** regex 提取显式偏好 + IndexedDB 存储 (D7)
- **Vault 元认知** 7 维度结构分析 + 独立调度 (D8)
- **Pagelet VSS** 前台 3 场景接入语义搜索 (D2)

### 1.3 核心问题

**管道重建完成了，但管道里流的"洞察"还是稀的。**

审计发现的三层差距：

```
Level 1 搜索准确性: ██████████ 显著提升
Level 2 关联发现:   ████░░░░░░ 部分提升（无图遍历、Discovery 无专用逻辑）
Level 3 理解深度:   ██░░░░░░░░ 基础建设完成但未激活（Type C 不注入、Type A 只捕获显式表达）
```

### 1.4 关键发现：多个能力已建未用

审计 + 就绪度分析发现，部分能力的代码已完整实现，但未在产品层面激活：

| 能力 | 代码状态 | 产品状态 |
|------|---------|---------|
| Type C vault insights → prompt | 注入管道完整（Projector + escapeTaggedBoundary + summarize） | 已激活。Settings 默认开启 `memoryExtractionEnabled` + `memoryExtractionIncludeVaultInsights`，`syncMemoryExtractionRuntime()` 传入并可实时切换 |
| Discovery 专用 prompt | `buildDiscoveryPrompt()` 完整，含 connections/gaps/insight 结构化输出 | 已接入。Pagelet `discoverConnections()` 通过 `PageletHost.findRelatedNotes()` 获取相关笔记并调用专用 prompt |
| Backlink 查找 | `findBacklinksForPath()` 已实现 | 仅在 `inspectNote` tool 中使用，搜索管线不用 |
| Discovery 面板渲染 | `DiscoveryResult` / `NoteConnection` 类型 + panel 渲染函数已存在 | 已接入专用数据源；Memory 未准备时显示引导空状态 |
| 对话元数据 | `contextUsed` / `activityDetails` / `providerReasoningObserved` 已持久化 | Type A LLM 提取已接入对话轮次，显式偏好仍保留 regex fallback |

---

## 2. 方案设计

### 2.1 设计原则

1. **激活优先于新建** — 已建未用的代码先接线激活，再考虑新功能
2. **终态导向** — 从产品终态倒推，一步到位而非渐进妥协（AD-3 决策体现）
3. **渐进交付** — 每个 Phase 独立交付可感知价值，不依赖后续 Phase
4. **向后兼容** — 新能力默认开启但可关闭，不破坏现有用户体验

### 2.2 三阶段路线（v2.5 合并发布）

```
Phase 1: 激活已有能力          ~2-3 天    ← 产品决策 + 接线
Phase 2: 补齐关联发现能力       ~5-7 天    ← SDD gap 修复 + 图感知检索设计
Phase 3: 深化理解能力           ~7-10 天   ← LLM 提取 + 语义聚类
──────────────────────────────────────────
总计                           ~14-20 天
全部归入 v2.5 发布（AD-4）
```

> **与原方案差异**：Phase 3 从 ~5-8 天调整为 ~7-10 天，因 Type A 从 local-first 统计（2 天）改为 LLM 提取（~5 天），是 AD-3 决策的直接影响。

---

## 3. Phase 1：激活已有能力（~2-3 天）

> 目标：将已建成但未激活的能力接入产品流程，用户立即感受到 AI "了解我的 vault"。

### 3.1 P1-A：激活 Type C Vault Insights 注入

**当前状态**：已接入。`type-c-analyzer.ts` 分析 7 维度 → `extraction-scheduler.ts` 维护内部 snapshot → `getPromptContext()` 准备注入 → `PaAgentContextProjector.ts` 格式化 `<vault_insights>` 标签。产品层默认开启：`DEFAULT_SETTINGS.memoryExtractionEnabled === true` 且 `memoryExtractionIncludeVaultInsights === true`；`plugin.ts` 将设置传入 scheduler，并在设置变化时调用 `setIncludeVaultInsightsInPrompt()` 实时切换。

**改动**：

1. `src/settings.ts`：新增 `memoryExtractionIncludeVaultInsights: boolean`，默认 `true`
2. `src/settings.ts` Settings Tab：在 Memory Extraction section（Advanced 下）添加 toggle
3. `src/plugin.ts` `syncMemoryExtractionRuntime()`：传入 `includeVaultInsightsInPrompt: this.settings.memoryExtractionIncludeVaultInsights`
4. **[Review U1]** 新增 vault insights onboarding Notice：首次开启时显示一次性提示（复用 `localStorage` flag 模式，同 `PAGELET_BACKGROUND_PREPARATION_NOTICE_KEY`），文案："PA now shares your vault structure overview with the AI to improve answers. You can disable this in Settings > Memory."
5. `src/pagelet/PageletHost.ts`：新增 `findRelatedNotes()` 方法签名（作为 E3/E6 的稳定合约）

**影响范围**：

| 文件 | 改动类型 |
|------|---------|
| `src/settings.ts` | 新增设置项 + UI toggle |
| `src/plugin.ts:659` | 传入 option + onboarding Notice |
| `src/locales/plugin/` | 新增 i18n key（toggle + Notice） |
| `src/pagelet/PageletHost.ts` | 新增 `findRelatedNotes` 签名 |

**验证**：
- 开启后，PA Agent 对话中问"我的 vault 是什么样的"，应能描述文件夹结构、标签分布等
- `forPrompt()` 输出的 `input` 包含 `<vault_insights>` 标签
- 首次启用时显示 onboarding Notice
- 关闭后，行为恢复原状

**估时**：0.5 天

### 3.2 P1-B：接入 Discovery 专用流程

**当前状态**：已接入。Pagelet Orchestrator 的 Discovery 路径现在读取当前笔记、通过 `PageletHost.findRelatedNotes()` 获取相关笔记，调用 `PluginManager.runDiscoveryAnalysis()` / `buildDiscoveryPrompt()` 生成 connections / themes / gaps，并把结果映射到 discover panel。Memory 未准备或无相关笔记时会显示明确空状态。

**改动**：

1. `src/pagelet/orchestrator.ts` `onDiscoverConnections`：不再调 `analyzeCurrentNote()`，改为调新方法 `discoverConnections()`
2. 新增 `discoverConnections()` 方法：
   - 获取当前笔记内容
   - 调用 `findPageletRelatedNotes()`（已存在于 plugin.ts）获取 VSS 语义相关笔记
   - 调用 `buildDiscoveryPrompt(currentNote, relatedNotes, budget)`
   - 发送给 LLM，解析结构化响应
   - 将结果映射为 `DiscoveryResult`（类型已存在于 panel/types.ts）
   - 传给 "discover" panel layout 渲染（渲染函数已存在）

**关键设计决策**：

`findPageletRelatedNotes()` 当前在 `plugin.ts` 中，是 private 方法。Discovery 需要调用它。两个选项：
- A. 通过 `PageletHost` 接口暴露（推荐，保持 Pagelet 与 plugin 的 delegate 模式）
- B. 将方法移到 orchestrator 可访问的位置

选择 A：在 `PageletHost` 接口新增 `findRelatedNotes()` 方法。

**影响范围**：

| 文件 | 改动类型 |
|------|---------|
| `src/pagelet/orchestrator.ts` | 修改 `onDiscoverConnections`，新增 `discoverConnections()` |
| `src/plugin.ts` | `PageletHost` 接口暴露 `findRelatedNotes` |
| `src/pagelet/panel/PanelLayouts.ts` | 调整 "discover" layout 消费 `DiscoveryResult` |

**验证**：
- 点击 "Discover Connections"，得到 connections / gaps / insights 三类发现
- 每个 connection 引用具体的 related note 路径
- **[Review U2]** Memory/VSS 未启用时，discover panel 显示引导信息 "Enable Memory to discover semantic connections" 而非静默 fallback 到通用 review
- Pet 动画在 Discovery LLM 调用期间显示 analysis-start 状态（预期耗时 3-8s：VSS 搜索 ~500ms + LLM 生成 ~2-5s）

**估时**：1.5 天

### 3.3 P1-C：补齐 SDD 合规项（Type C 写入路径）

**当前状态**：`typeCWritePath` 默认 null，vault insights 不写文件。SDD §3.9.3 最终决策调整为"插件内部 snapshot；默认不写 vault 笔记"，但原始产品决策 13 说"C 存储为 vault 笔记（`PA-Memory/vault-insights.md`），用户可直接查看和搜索"。

**改动**：

根据 SDD closeout 和 `memory` 记录（`project_context_memory_architecture.md` §8.2），Type C 存储位置已调整为"插件内部 snapshot"，不写 vault 笔记。此项**不需要修改**，当前实现符合最新决策。

但需确认：如果未来 `includeVaultInsightsInPrompt` 开启后，用户是否需要一个查看入口？建议 Phase 3 再处理 UI 展示。

**估时**：0 天（无需修改）

---

## 4. Phase 2：补齐关联发现能力（~5-7 天）

> 目标：让搜索从"点对点查询"升级为"图+语义联合发现"，Pagelet 全场景覆盖 VSS。

### 4.1 P2-A：图感知检索 — 需要独立 SDD（AD-2）

**动机**：`ai-insight-improvement-analysis.md` 方向 #2（价值 4/5）。Obsidian 核心价值是 wikilink 网络，找到 A 应自动拉入 A 链接的 B。

**决策 AD-2**：纳入 v2.5，但不采用 activation plan 初版的简化方案。需要独立的方案设计，覆盖以下问题：

| 设计问题 | 需要回答 |
|----------|---------|
| 展开方向 | 仅 outbound link？还是 outbound + backlink？ |
| 展开深度 | 1-hop 还是可配置的 N-hop？ |
| 候选膨胀控制 | 展开数量上限、score 衰减策略、与 reranker 的交互 |
| 展开笔记内容来源 | 从 VSS chunks 查？从 vault 直接读？读多少？ |
| 搜索管线插入点 | `normalizeSearchCandidates` 之后？还是 `rerankCandidates` 之后？ |
| 对 Pagelet 的影响 | `findPageletRelatedNotes()` 是否也做图展开？ |
| 性能预算 | 展开增加多少延迟？对移动端的影响？ |

**已知基础设施**：
- `app.metadataCache.resolvedLinks` — 完整链接图（Type C analyzer 已使用）
- `findBacklinksForPath()` — `chat-tool-execution-helpers.ts:762` 反向查找
- `normalizeSearchCandidates()` — 搜索结果标准化（`pa-agent-runtime.ts:1520`）

**下一步**：在 Phase 2 启动前完成图感知检索的独立方案设计。

**估时**：设计 1 天 + 实现 2-3 天 = 3-4 天

### 4.2 P2-B：Pagelet Preload + Periodic Summary 接入 VSS

**动机**：SDD D2 要求所有 4 场景接入 VSS，当前 Preload 和 Periodic Summary 缺失。

**Preload 改动**：

`plugin.ts` `createPreloadAnalyzeCallback()` 中加入 `findPageletRelatedNotes()` 调用，将 related notes 注入 `buildPreloadPrompt()` 的输入。

需评估：Preload 是后台低成本流程，加入 VSS 搜索（~500ms）是否可接受？建议：仅在 VSS status === "ready" 时尝试，失败不阻塞 preload。

**Periodic Summary 改动**：

`pagelet/PeriodicSummaryFlow.ts` 和 `pagelet/output/ReviewNoteGenerator.ts` 中，在生成摘要前调用 VSS 搜索获取跨笔记上下文。需要通过 `PageletHost` 传入 `findRelatedNotes` 能力。

**影响范围**：

| 文件 | 改动类型 |
|------|---------|
| `src/plugin.ts` `createPreloadAnalyzeCallback` | 加入 VSS 搜索 |
| `src/pagelet/PeriodicSummaryFlow.ts` | 加入 VSS 搜索 |
| `src/pagelet/output/ReviewNoteGenerator.ts` | 接收 related notes |

**估时**：2 天

### 4.3 P2-C：Budget → Compaction 联动

**动机**：SDD D6 §3.7 要求 Budget 超限触发 Compaction，当前 `nearObservationLimit` 被计算但未消费。

**改动**：

在 `PaAgentContextManager.forPrompt()` 中，Budget snapshot 后检查 `nearObservationLimit`：如果为 true 且 micro-compaction 未充分压缩（仍超 70%），触发二次压缩（更激进的 targetRatio）。

```
forPrompt() {
  hygiene.clean()
  compactor.microCompact(transcript, maxObservationChars)
  projector.projectUserInput(...)
  budget = budget.snapshot(...)

  // 新增：Budget 驱动的二次压缩
  if (budget.nearObservationLimit && budget.observationUsageRatio > 0.7) {
    compactor.microCompact(transcript, maxObservationChars, { targetRatio: 0.4 })
    // re-project and re-snapshot
  }
}
```

**影响范围**：

| 文件 | 改动类型 |
|------|---------|
| `src/ai-services/context/PaAgentContextManager.ts` | `forPrompt()` 增加二次压缩逻辑 |
| `src/ai-services/context/PaAgentContextCompactor.ts` | `microCompact()` 接受可选 override targetRatio |

**估时**：0.5 天

### 4.4 P2-D：测试补齐

补齐审计报告 §2.3 发现的关键测试缺口：

| 测试 | 说明 | 估时 |
|------|------|------|
| `annotateOrigins()` 专项测试 | 验证 user/assistant/tool_result origin 标注 | 0.25 天 |
| Context 限制常量回归测试 | 断言 DEFAULT_MAX_OBSERVATION_CHARS 等常量值 | 0.25 天 |
| Type C prompt injection 防护测试 | 笔记标题含 `</vault_insights>` 等 payload | 0.25 天 |
| Micro-compaction 生产配置值测试 | triggerRatio: 0.7, protectedRecentTurns: 2 | 0.25 天 |

**估时**：1 天

---

## 5. Phase 3：深化理解能力（~7-10 天）

> 目标：让 AI 从"结构感知"升级为"语义理解"，建立真正的用户认知模型。

### 5.1 P3-A：Type A LLM 后台提取（AD-3：一步到位）

**动机**：当前 Type A 只用 regex 捕获显式表达（"I prefer..."/"请记住..."）。大多数用户不会用这种方式表达偏好，AI 无法从对话模式中推断用户的领域、习惯、风格。

**决策 AD-3**：跳过 local-first 行为统计中间阶段，直接实现 SDD D7 §3.8 原设计的 LLM 后台提取。从终态出发一步到位。

**设计**：

实现 SDD §3.8.1 设计的完整 LLM 提取管线，替代当前的 regex-only `extractCandidatesFromText()`：

**提取触发时机**（SDD §3.8.1 确认的方案）：

| 触发条件 | 提取范围 | 说明 |
|----------|---------|------|
| 每 N 轮（N=8，已实现） | 最近 N 轮新增内容 | 轻量提取，scheduler 已支持 |
| 对话切换时 | 完整对话回顾 | scheduler `lastTypeAConversationId` 已追踪 |
| `beforeunload` | best-effort | 现有 plugin dispose 路径可复用 |

**LLM 提取 prompt 设计**：

向 LLM 发送最近 N 轮对话内容，要求提取结构化用户偏好：

```json
{
  "extractions": [
    {
      "text": "User prefers concise, code-first answers",
      "kind": "user_explicit | user_correction | inferred_behavior",
      "confidence": "high | medium | low",
      "evidence": "User said 'too verbose, just show the code'"
    }
  ]
}
```

**置信度分级 + recurrence**（SDD §3.8.2，现有 recurrence 机制可复用）：

| 置信度来源 | 写入策略 | 说明 |
|----------|---------|------|
| `user_explicit` | 直接写入 | LLM 判断用户明确表达的偏好 |
| `user_correction` | 直接写入 | LLM 判断用户纠正 Agent 行为 |
| `inferred_behavior` | 需跨 3 次独立对话重复 | LLM 推断的行为模式（当前 regex 无法生成，LLM 可以） |
| `discussed` | 丢弃 | LLM 判断仅讨论但无承诺 |

**关键设计决策**：

| 问题 | 方案 |
|------|------|
| 使用哪个模型 | chatModel（主模型），与 Full compaction 一致（SDD §3.6.2 决策） |
| API 成本控制 | 每 8 轮一次轻量提取（~500-1000 tokens 输入）；对话切换时一次完整提取 |
| 用户确认 UI | **[Review U3 done]** Settings 中的 `memoryExtractionEnabled` 作为总开关。Notice 和 Settings 描述已明确后台 AI provider 调用、API credits/cost、本地存储；用户手动从关闭切回开启时会显示确认弹窗。 |
| 提取失败处理 | fallback 到现有 regex 提取，不丢失已有能力 |
| 与现有 regex 的关系 | LLM 提取作为主路径，regex 作为 fallback（LLM 不可用/禁用时） |
| **[Review P4]** 移动端 guard | `extraction-scheduler.ts` 在触发 LLM 提取前检查 `document.visibilityState !== 'hidden'`。移动端后台时跳过/延迟提取，避免不必要的网络和电量消耗 |
| **[Review U4]** Cost tracking | Type A LLM 调用接入 cost 追踪体系（复用 `PageletCostTracker` 或独立 counter），确保用户有费用可见性 |

**改动**：

| 文件 | 改动类型 |
|------|---------|
| `src/ai-services/memory-extraction/type-a-extractor.ts` | 新增 `extractCandidatesWithLLM()` 方法，接受 model 实例 |
| `src/ai-services/memory-extraction/extraction-scheduler.ts` | `runTypeAExtraction()` 增加 LLM 调用路径 + 移动端 idle guard，fallback 到 regex |
| `src/plugin.ts` | 向 scheduler 传入 model 创建能力（`createChatModel`） |
| `src/locales/plugin/` | 已更新 `plugin.memoryExtraction.enabledNotice`、`plugin.memoryExtraction.settings.enabled.desc` 和 enable confirmation copy，明确 API 调用 + cost |

**验证**：
- 启用后，对话中多次提到某个领域但不显式说"记住"，检查 user profile 是否出现 `inferred_behavior` 记录
- `inferred_behavior` 在第 1 次出现时为 tentative，第 3 次独立对话后 promote 为 confirmed
- LLM 不可用时（如 API key 无效），graceful fallback 到 regex 提取
- Settings 关闭 `memoryExtractionEnabled` 后，无 LLM 调用
- **[Review P4]** 移动端 app 进入后台后，不触发 LLM 提取
- **[Review U3]** Notice 和 Settings 描述包含 API 调用说明

**估时**：~5 天

### 5.2 P3-B：语义主题聚类（worker 内 k-means）

**动机**：当前主题聚类是文件夹分组，对平铺结构的 vault 无效。VSS embedding 向量已在 worker 内存中缓存。

**设计**：

在 SQLite worker 内实现聚类，避免跨线程传输大量向量：

1. **Worker 新增消息类型** `"clusterVectors"`：
   - 读取 `vectorCache`（`Map<number, Float32Array>`）
   - 用 chunk id 从 `vss_chunks` 表查 path 映射
   - 运行 mini-batch k-means（k 由 vault 规模决定：k = min(20, sqrt(chunkCount / 5))）
   - 返回 `Array<{ clusterId: number, label: string, paths: string[], representativeChunkContent: string }>`
   - label 通过 cluster 内 chunk 的高频 heading/path 词生成（零 LLM 成本）

2. **Type C analyzer 集成**：
   - `inferTopicClusters()` 从 folder-based 升级为先尝试 worker clustering，fallback 到 folder-based
   - 通过 plugin 暴露的 VSS 接口调用 worker

3. **k-means 实现**：纯 JS，约 100-150 行。Float32Array 上的距离计算高效。k=20、n=10000 chunks 的聚类在 worker 线程中 ~50-200ms。

**影响范围**：

| 文件 | 改动类型 |
|------|---------|
| `src/vss/sqlite-worker-protocol.ts` | 新增 `ClusterVectorsRequest` / `ClusterVectorsResponse` |
| `src/vss/sqlite-worker.ts` | 实现 `handleClusterVectors()` + k-means 算法 |
| `src/vss.ts` 或 `src/vss/sqlite-vector-index.ts` | 暴露 `clusterVectors()` 方法 |
| `src/ai-services/memory-extraction/type-c-analyzer.ts` | `inferTopicClusters()` 使用语义聚类（通过 `TypeCVaultMetacognitionAnalyzer` 实例传递 clustering 能力，不改 scheduler 构造函数 [Review A1]） |
| `src/plugin.ts` | 暴露 clustering 能力到 `TypeCVaultMetacognitionAnalyzer`（不通过 scheduler 构造函数） |

**验证**：
- Vault insights 中的 "Topic Clusters" section 显示语义集群而非文件夹
- 跨文件夹但语义相关的笔记被归入同一集群
- 小 vault（<50 笔记）graceful fallback 到 folder-based
- **[Review P5]** 移动端 `chunkCount > 15000` 时跳过 k-means，fallback 到 folder-based（避免 ~40MB 向量缓存上的密集计算）

**估时**：3 天

### 5.3 P3-C：Query-rewriter `range:` temporal 格式

**动机**：SDD D3 设计了 `"range:YYYY-MM..YYYY-MM"` temporal 格式但未实现。

**改动**：

1. `src/ai-services/query-rewriter.ts`：
   - 扩展 `QueryTemporalIntent` 类型为 `"recent_7d" | "recent_30d" | "none" | string`（允许 `range:` 前缀）
   - `normalizeTemporalIntent()` 增加 `range:` 解析（正则 + 日期验证）
   - System prompt 增加 `range:` 示例

2. `src/ai-services/pa-agent-runtime.ts`：
   - `temporalIntentToFilter()` 增加 `range:` → `{ since, until }` 转换

**估时**：0.5 天

### 5.4 P3-D：清理死代码

删除审计发现的未使用 prompt builders：

| 函数 | 文件 | 说明 |
|------|------|------|
| `buildQuickReviewPrompt` | `pagelet/llm/prompts.ts:137` | Phase 1 激活 Discovery 后，此函数仍无调用方 |
| `buildWritingAssistPrompt` | `pagelet/llm/prompts.ts:170` | 同上 |

注意：`buildDiscoveryPrompt` 在 Phase 1 P1-B 中已接线，不删除。`buildPreloadPrompt` 和 `buildPeriodicSummaryPrompt` 有调用方，不删除。

**估时**：0.5 天

---

## 6. 交付计划

### 6.1 Phase 依赖关系

```
Phase 1 (激活)
  P1-A: Type C insights 注入 ───────────────────────────┐
  P1-B: Discovery 专用流程 ─────────────────────────────┤
                                                        ↓
Phase 2 (关联发现)                                   可并行
  P2-A: 图感知检索设计+实现 ───────────────────────────┤
  P2-B: Preload/Summary VSS ──────────────────────────┤
  P2-C: Budget → Compaction ───────────────────────────┤
  P2-D: 测试补齐 ─────────────────────────────────────┤
                                                        ↓
Phase 3 (理解深度)                                   可并行
  P3-A: Type A LLM 提取 ─── 依赖 model 创建能力 ─────┤
  P3-B: 语义聚类 ── 依赖 P1-A（Type C insights 需开启）┤
  P3-C: temporal range ────────────────────────────────┤
  P3-D: 死代码清理 ── 依赖 P1-B 完成 ─────────────────┘
```

### 6.2 里程碑

| 里程碑 | 交付物 | 用户可感知变化 | 估时 |
|--------|--------|-------------|------|
| **M1: 激活** | P1-A + P1-B | AI 能描述 vault 结构；Discovery 找到跨笔记联系 | ~2-3 天 |
| **M2: 关联** | P2-A + P2-B + P2-C + P2-D | 搜索沿 wikilink 扩展；全场景 VSS；测试补齐 | ~6-8 天 |
| **M3: 理解** | P3-A + P3-B + P3-C + P3-D | AI 从对话中推断用户偏好和行为模式；语义主题聚类；时间范围查询 | ~7-10 天 |

### 6.3 版本归属（AD-4）

全部合并到 **v2.5** 发布。

- SDD D1-D8 作为 **v2.4 已关闭**（Implementation Closeout 2026-06-16）
- Activation plan Phase 1-3 全部归入 **v2.5**
- v2.5 版本叙事：**"AI 洞察力激活 — 从了解你的 vault 到理解你的思维"**
- v2.6 保持不变：Action Mode Phase 1 + Skill 扩展

**v2.5 总估时**：~14-20 天（Phase 1~3 顺序交付，Phase 内各项可并行）

---

## 7. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Type C insights 注入增加 prompt 长度 | 低 | `summarizeVaultInsightsForPrompt` 已限制 40 行 / 3000 字符；Projector diffing 第 2+ 轮仅 ~50 chars；Context Budget 追踪 |
| 图感知检索设计复杂度 | 中 | AD-2 要求独立设计而非简化方案；设计阶段充分评估候选膨胀和延迟影响 |
| Type A LLM 提取增加 API 成本 | 中 | 每 8 轮一次轻量提取（~500-1000 tokens）；对话切换一次完整提取；Settings 总开关已存在；首次启用 Notice 需补充 cost disclosure |
| Type A LLM 提取质量不稳定 | 中 | 置信度分级 + recurrence promotion（3 次独立对话确认）过滤噪声；fallback 到 regex 保底 |
| Worker 内 k-means 阻塞 | 低 | Worker 本身不在主线程；mini-batch k-means 对 10K chunks ~200ms；可加 yield |
| Discovery LLM 调用失败 | 低 | fallback 到通用 review（现有行为） |
| Preload + VSS 增加后台成本 | 低 | 仅在 VSS ready 时尝试；失败不阻塞 preload |
| v2.5 范围过大 | 中 | Phase 1-3 顺序交付，每个 Phase 可独立 dogfooding 验证；如某 Phase 延期，已交付的 Phase 不受影响 |

---

## 8. 洞察力层次提升预期

实施完成后各层次预期水平：

```
                          当前        Phase 1 后    Phase 2 后    Phase 3 后
Level 1 搜索准确性:      ██████████  ██████████    ██████████    ██████████
Level 2 关联发现:        ████░░░░░░  ██████░░░░    █████████░    █████████░
Level 3 理解深度:        ██░░░░░░░░  █████░░░░░    █████░░░░░    █████████░
```

**Phase 1** 是 ROI 最高的阶段：几乎零新代码（接线+开关），但用户感知从 "AI 不了解我的 vault" 跃升为 "AI 知道我的 vault 结构和主题"。

**Phase 2** 补齐 Obsidian 生态差异化能力（图遍历），让搜索从"点对点"升级为"网络感知"。

**Phase 3** 建立真正的用户认知模型（AD-3）。LLM 提取让 AI 能从对话中推断"用户总是在长回答后要求更简洁"这类语义级偏好，而非仅记住"请记住我偏好简洁"。Level 3 从 2/10 提升到 9/10。

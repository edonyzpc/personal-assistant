# AI 洞察力提升方向分析

> **Created**: 2026-06-16
> **Context**: v2.3 code complete, v2.4 原定 Action Mode 方向暂缓。重新评估如何提升 AI 对用户笔记的理解深度。
> **Core question**: 当前 AI 的"读"能力不够有洞察力，只是浅层搜索+摘要。在让 AI "写/编辑"笔记之前，应该先提升哪些能力？

---

## 1. 当前瓶颈诊断

当前架构是教科书式 RAG：**chunk -> embed -> top-K -> 截断 -> 发给 LLM**。没有任何 vault 级智能。

### 1.1 切片层

| 问题 | 代码位置 | 影响 |
|------|---------|------|
| 4000 字符通用切割，80 字符重叠 | `vss.ts:2063-2080` | 语义单元被随意切断，heading 上下文丢失 |
| Frontmatter 被完全剥离后再嵌入 | `ai-utils.ts:387-391` | 标签、属性、用户元数据对检索不可见 |
| Chunk metadata 缺少 heading path / 行号 | `vss/types.ts:33-41` | LLM 不知道 chunk 在文档中的位置 |
| `normalizeSearchCandidates()` 已预留 headingPath 字段 | `pa-agent-runtime.ts:1463-1471` | 字段存在但从未被写入，始终 undefined |

### 1.2 检索层

| 问题 | 代码位置 | 影响 |
|------|---------|------|
| 最多 8 原始结果 -> 6 候选 -> **4 文档** | `pa-agent-runtime.ts:193-198` | 500 篇笔记中 LLM 只看到 ~2000 字符 |
| 每个候选 excerpt 截断到 500 字符 | `pa-agent-runtime.ts:1492` | 长笔记的关键内容可能在截断之外 |
| RRF 按位置合并，无语义深度评分 | `vss/rrf.ts:1-19` | 排名 1 和 3 的分数几乎无差别 |
| Reranker 只看 400 字符 | `pa-agent-runtime.ts:1347` | 判断相关性的信息严重不足 |
| 无图遍历（不追踪 wikilink） | 功能缺失 | 找到 A 不会自动拉入 A 链接的 B |
| 无时间感知（3 年前和 5 分钟前同权重） | `sqlite-worker.ts:637-722` | 旧笔记和新笔记无差异化排序 |

### 1.3 上下文层

| 问题 | 代码位置 | 影响 |
|------|---------|------|
| System prompt 无用户画像 | `pa-agent-runtime.ts:1664-1685` | LLM 对每个用户都是陌生人 |
| 无 vault 特征描述 | 同上 | LLM 不知道 vault 规模、结构、主题 |
| Tool observation 先到先得消耗 24k budget | `pa-agent-loop.ts:630-638` | 早期低价值结果挤掉后续高价值结果 |
| Chat history 按轮数截断，无字符预算 | `pa-agent-runtime.ts:1782-1796` | 20 轮长对话 history 可达 40k+ 字符 |
| 无 projection / hygiene / compaction | 功能缺失 | 原始 transcript 直接灌给 model |

### 1.4 Pagelet 层

| 问题 | 代码位置 | 影响 |
|------|---------|------|
| 完全不用 Memory/VSS 做跨笔记发现 | `src/pagelet/` 无 VSS 调用 | Review 只看时间窗口内的笔记 |
| `related_notes` 字段靠 LLM 猜测 | `pa-review-schemas.ts:106` | 命中率低，不是真正的语义发现 |
| "Discover Connections" 是空壳 | 同上 | 用户期望的"发现隐藏联系"无数据支撑 |
| Prompt 优化结构化输出而非深度分析 | `pagelet/llm/prompts.ts:104-131` | "2-3 one-sentence insights" = 定义上的浅层 |

---

## 2. 全量候选方向

### 11 个方向一览

| # | 方向 | 价值 | 难度 | 估时 | 依赖 |
|---|------|:---:|:---:|------|------|
| 1 | 改进切片策略 | 5 | 2 | 3-5d | 无 |
| 2 | 图感知检索 | 4 | 3 | 5-7d | 受益于 #1 |
| 3 | 时间感知检索 | 3 | 1 | 0.5d | 无 |
| 4 | 扩大检索窗口 | 3 | 1 | 0.5d | 与 #2 协同 |
| 5 | Query expansion | 2 | 3 | 3-5d | 受益于 #1 |
| 6 | Pagelet 接入 Memory/VSS | 5 | 3 | 3-5d | 受益于 #1 |
| 7 | Reranker 升级 | 3 | 2 | 1-2d | 依赖 #1 |
| 8 | Post-session extraction | 4 | 5 | 15-20d | 依赖 Type A |
| A | Type A 用户画像 | 4 | 2 | 1.5-2d | 无（手动模式） |
| C | Type C Vault 元认知 | 4 | 4 | 5-8d MVP | 无 |
| P | Context Projector | 3* | 3 | 5-8d Ph1-3 | 无，但是 A/C 的前提 |

> *Context Projector 自身不直接产生洞察，但它是让 Type A/C 注入后不恶化现状的必要基础设施。

---

## 3. 各方向详细分析

### 3.1 改进切片策略（#1）

**当前问题**：`MarkdownTextSplitter({ chunkSize: 4000, chunkOverlap: 80 })` 做通用字符级切割。一篇有 10 个 heading 的长笔记被暴力切片，跨 heading 的切片丢失语义上下文。Frontmatter（tags、aliases、自定义属性）在切片前被完全剥离，永远不参与 embedding 和 FTS。

**改进方案**：
- 替换为 heading-aware 切割（LangChain 的 `MarkdownHeaderTextSplitter` 已支持）
- 在 chunk metadata 中填充 heading path 和行号（`normalizeSearchCandidates()` 已预留字段）
- 将 frontmatter 以结构化文本附加到每个 chunk 的开头

**为什么是最高优先级**：切片质量是检索质量的天花板。Type C 的 embedding 聚类质量、Pagelet VSS 搜索质量、reranker 精度——全部依赖切片质量。这是唯一一个能同时提升所有下游环节的改进。

**风险**：切片策略变更需要全量重建 VSS 索引（existing 用户升级时自动触发 rebuild）。

---

### 3.2 Pagelet 接入 Memory/VSS（#6）

**当前问题**：Pagelet 完全不使用 Memory 做跨笔记发现。"Discover Connections" 命令实际上只是将当前笔记分析结果用 "discover" 布局展示。`related_notes` 字段完全依赖 LLM 凭空猜测。

**改进方案**：
- 在 Pagelet review 流程中加入 VSS 搜索步骤（用当前笔记的摘要/关键段落作为 query）
- 将搜索结果注入 review model 的上下文
- 使 Scenario 3 Knowledge Discovery 真正基于语义相似性而非猜测

**为什么是最高优先级**：这是用户立刻能感知到的最大体验跃升。从"猜你可能相关的笔记"到"我搜索了你的 vault，发现这些语义相关的笔记"。Pagelet 产品设计文档中 Scenario 3 的"future direction"明确需要这个能力。

**延迟影响**：VSS 搜索约 500-700ms，需要控制对 review 流程延迟的影响。

---

### 3.3 时间感知检索（#3）

**当前问题**：vector 和 FTS 搜索无时间感知。chunk metadata 已有 `created` 和 `lastModified` 时间戳，但从未用于排序。

**改进方案**：在 `normalizeSearchCandidates()` 中对 RRF 分数乘以时间衰减因子。参考 OpenClaw 的 `score x e^(-lambda x days)`，半衰期 30-60 天可配置。

**注意**：对参考型知识库（旧笔记同样重要），时间衰减反而有害。应作为可选配置。

**为什么优先级中等**：改动极小（~10 行代码），但效果因用户笔记风格而异。

---

### 3.4 扩大检索窗口（#4）

**当前问题**：`MAX_MEMORY_DOCUMENTS=4`、`MAX_MEMORY_CHARS=2000`。用户问"我所有关于 X 的想法"时，只看到 4 个 500 字符的片段。

**改进方案**：提升到 8 文档 / 4000 字符。按 qwen-plus 定价约增加 0.001-0.003 元/次。

**注意**：边际效益递减，更多文档可能引入信息过载。需要测试验证。

---

### 3.5 图感知检索（#2）

**当前问题**：检索命中笔记 A 时不会自动拉入 A 的 wikilink 目标。`inspect_obsidian_note` 可以提取 links/backlinks，但仅在 LLM 显式调用时才触发。

**改进方案**：
- 在 hybrid search 结果中，对命中笔记做 1-hop link expansion
- 利用 backlink 密度作为排序加分信号
- Obsidian 的 `metadataCache.resolvedLinks` 已提供完整链接图

**为什么是 P1**：对 wikilink 重度用户价值极高，是 Obsidian 生态的差异化优势。但需要设计 expansion 策略和候选数量上限。

---

### 3.6 Reranker 升级（#7）

**当前问题**：reranker 每个候选只看 400 字符截断文本，且没有 heading path 信息。

**改进方案**：excerpt 从 400 提升到 800-1200 字符，加入 heading path（依赖 #1 完成后 metadata 可用）。

---

### 3.7 Type A 用户画像

**核心概念**：一个约 1400 字符的持久化文件（`PA-Memory/user-profile.md`），每次对话注入系统提示。包含：用户领域、笔记风格、常用术语、偏好。

**当前空白**：PA Agent Chat 的系统提示完全不提及用户是谁。Pagelet 的 prompt 也无用户上下文。Query rewriter 不了解用户术语体系。

**影响范围**：
- Chat 回答质量：LLM 知道用户专业水平，无需破冰对话
- Pagelet review：可基于用户领域给出针对性建议
- Memory 检索：query rewrite 可利用领域术语做消歧

**实现成本**：约 1.5-2 天。初期手动编辑，不依赖自动提取管线。

**关键约束**：研究发现**需要 Context Projector Phase 1-2 作为前提**，否则注入 profile 在长对话中会与 tool results 争抢模型注意力。具体原因：
- 没有 micro-compaction：旧 tool result 继续占据 observation 空间
- 没有 hygiene pass：status-only 的 tool result 也被保留，挤压有效空间
- 没有 host context diffing：profile 每轮完整重复，浪费 prompt cache

---

### 3.8 Context Projector

**核心概念**：在 transcript 和 LLM 之间加一层 `forPrompt()` 边界，管理上下文的分配、过滤和压缩。

**研究文档推荐的四阶段**：
1. Phase 1（提取 projection，不改行为）：建立 `PaAgentContextProjector`，添加诊断 metrics
2. Phase 2（hygiene + diffing）：过滤 status-only tool results，host context diffing
3. Phase 3（micro-compaction）：用压缩标记替换旧的大体积 tool promptText
4. Phase 4（persisted summary checkpoints）：长对话摘要持久化

**为什么是 Type A/C 的前提**：
- 当前 observation budget 是单向消耗、先到先得 -> 注入更多内容会恶化竞争
- 当前 status-only tool results 占据 20-30% observation 空间 -> 是纯噪声
- 当前没有 diffing -> Type A profile 每轮完整重复浪费空间
- 结论：**不加投影层就注入更多内容，会反向挤压 tool results 的有效空间**

**实现成本**：Phase 1-2 约 5-8 天，Phase 3 额外 3-5 天。

---

### 3.9 Type C Vault 元认知

**核心概念**：从 vault 结构中提取主题集群、标签分类、链接模式、写作习惯，存为 `PA-Memory/vault-insights.md`，按需搜索。

**能解决的独特问题**：
- 跨笔记主题发现（"你的 vault 有 7 个主题集群..."）
- 链接拓扑分析（hub 笔记、孤立笔记、桥接笔记）
- 写作习惯（"你每周一早上写 3-5 篇笔记"）
- 知识空白检测（"你在 5 篇笔记中提到'分布式共识'但没有专门的笔记"）

**与 Pagelet Scenario 3 的关系**：Type C 是 Scenario 3 "future direction"（cross-note themes, research gaps）的必需数据层。`DiscoveryResult` 类型已预留 `themes` 和 `gaps` 字段，但无数据源填充。

**成本亮点**：结构/链接/标签/习惯分析用 Obsidian API 直接获取（零 API 成本）。主题聚类可复用现有 VSS embeddings 做 k-means（零额外嵌入成本）。

**实现成本**：metadata-only MVP 5-8 天，完整版（含聚类和空白检测）15-25 天。

---

### 3.10 Query Expansion（#5）

**当前问题**：`query-rewriter.ts` 明确禁止发明新词（"Never invent terms not present in the original query"）。

**改进方案**：允许基于 vault 术语表的同义词扩展。

**为什么优先级低**：Embedding 天然捕捉语义相似性，已部分解决同义词问题。FTS 层面的扩展边际收益较小。

---

### 3.11 Post-session Extraction（#8）

**核心概念**：对话结束后，后台 LLM 提取用户偏好/纠正/习惯，写入 Type A 存储。

**价值**：长期看是构建真正个性化 AI 助手的基石。

**为什么延后**：实现最复杂（浏览器环境后台任务、费用控制、提取质量保证），强依赖 Type A 存储设计先落地。

---

## 4. 推荐实施路线

### 第一梯队：地基层（并行启动）

```
#1 改进切片策略 (3-5d)  ──── 检索质量天花板
        ∥
#6 Pagelet 接入 VSS (3-5d) ── 用户可感知的最大体验跃升
```

理由：#1 提升所有下游环节的上限，#6 填补 Pagelet 最大功能缺失。两者无循环依赖可并行。

### 第二梯队：快速收益

```
#3 时间衰减 (0.5d) + #4 扩大窗口 (0.5d) + #7 Reranker 升级 (1d)
```

理由：改动极小，在 #1 完成后立刻可做。总计 2 天。

### 第三梯队：理解层

```
P: Context Projector Ph1-2 (5-8d) ── Type A 的前提
        ↓
A: Type A 用户画像 (1.5-2d) ── 个性化注入
        ↓
C: Type C Vault 元认知 MVP (5-8d) ── vault 级智能
```

理由：Projector 解决"注入更多内容不恶化现状"的问题，然后 Type A 和 C 依次注入。

### 第四梯队：深水区

```
#2 图感知检索 (5-7d) ── 需要设计工作
#8 Post-session extraction (15-20d) ── 等 Type A 稳定后启动
#5 Query expansion ── 延后观察
```

### 版本归属（2026-06-16 更新）

```
v2.4 = 地基层 + 投影层
  - 第一梯队：#1 切片 + #6 Pagelet VSS (~1-2 周)
  - 第二梯队：#3 时间衰减 + #4 扩大窗口 + #7 Reranker (~0.5 周)
  - 第三梯队前半：P: Context Projector Phase 1-2 (~1-1.5 周)
  - Context 限制放宽
  估时：~18-22d（3-4 周）

v2.5 = 压缩层 + 理解层
  - 第三梯队后半：Context Compactor (micro + full) + Budget
  - A: Type A 用户画像（纯自动提取）
  - C: Type C Vault 元认知（6 维度）+ Extraction pipeline
  估时：~20-25d（4-5 周）

v2.6 = Action Mode Phase 1 + Skill 扩展（原 v2.4 计划）
  - SPEC-C1 Action Mode Phase 1
  - SPEC-C2 Skill 扩展
  - SPEC-A7 apiToken 清理
──────────────────
v2.4+v2.5 总计：~7-9 周达到"AI 有洞察力"的水平
之后再考虑 AI 编辑笔记（v2.6 Action Mode）
```

---

## 5. 决策要点

### 核心取舍

**地基优先 vs 理解优先？**

- **地基优先**（#1 + #6 先做）：切片和 Pagelet VSS 接入是"原料质量"——没有好的切片和检索，Type A/C 注入的"理解"也只是基于烂原料的理解
- **理解优先**（A + P + C 先做）：Type A 用户画像的 ROI 极高（1.5 天改善三条产品线），Context Projector 是后续所有优化的基础设施

两条路都有道理。**我倾向地基优先**，因为：
1. 切片改进是所有方向的天花板提升
2. Pagelet VSS 接入是用户立刻能感知的变化
3. Type A 虽然 ROI 高，但它的前提（Context Projector）工作量不小

### 被忽略的方向

以下方向未在 11 个候选中，但值得关注：

| 方向 | 说明 | 当前优先级 |
|------|------|-----------|
| 多模态检索 | VSS 只索引 .md，不处理图片/PDF/音频 | 低（大部分 Obsidian 用户以文本为主） |
| 检索结果可解释性 | 告诉用户"为什么这篇笔记相关"而不只是给分数 | 中（提升用户信任度） |
| 个性化检索权重 | 用户配置不同文件夹/标签的检索权重 | 低（增加配置复杂度） |

---

## 6. 产品决策记录（2026-06-16）

以下 5 个决策经讨论确认，指导 v2.4 的实施方向。

### 决策 1: 地基优先 vs 理解优先

**结论：地基优先（选项 A）**

先做 #1 改进切片 + #6 Pagelet 接入 VSS（~1-2 周），再做 Context Projector + Type A/C。

**讨论过的选项：**
- A. 地基优先：切片和 Pagelet VSS 是"原料质量"，没有好的切片和检索，Type A/C 注入的"理解"也是基于碎片化原料的理解
- B. 理解优先：Type A 投入最小但同时改善三条产品线；Context Projector 是后续一切的基础设施
- C. 混合：切片 + Type A 并行，但 Type A 在没有 Projector 的情况下注入可能在长对话中与 tool results 争抢注意力

**决策理由：** 切片质量是所有下游环节的天花板。Pagelet VSS 接入是用户立刻能感知到的体验跃升。先做地基确保后续 Type A/C 建立在可靠的原料之上。

---

### 决策 2: 切片策略变更后的索引重建策略

**结论：静默自动重建（选项 A）**

检测到切片策略变更后自动触发后台 rebuild，用户无感知。

**讨论过的选项：**
- A. 静默自动重建：零摩擦升级体验，但大 vault 会消耗 embedding API 额度且用户不知情
- B. 提示后手动触发：用户知情可控，但多一步操作，部分用户可能忽略一直用旧索引

**决策理由：** 对独立开发者阶段的用户来说，减少操作摩擦比 API 额度透明度更重要。rebuild 是一次性成本。

---

### 决策 3: 时间感知检索的实现策略

**结论：按需触发 — Query-Time Intent Detection（方案 D）**

不做 always-on 衰减，不做 Settings 开关。在现有 Query Rewriter 中扩展输出，增加 `temporal` 字段。

**方案设计：**

在 Query Rewriter 的 LLM 调用中，输出从 `{"keywords":"..."}` 扩展为：

```json
{
  "keywords": "项目进展 API 设计",
  "temporal": "recent_7d" | "recent_30d" | "range:2024-01..2024-03" | "none"
}
```

- 用户问"最近在研究什么" → `temporal: "recent_30d"` → 搜索加 SQL WHERE 时间过滤
- 用户问"什么是 Raft 共识" → `temporal: "none"` → 纯语义搜索，不加时间权重
- 大多数查询走 `"none"` 路径，与今天行为完全一致

**讨论过的选项：**
- A. 默认开启衰减，Settings 可关：简单但伤害参考型 vault
- B. 默认关闭，Settings 可开：安全但用户不会主动去找这个开关
- C. 不做开关，温和衰减（180 天半衰期）：对参考型 vault 伤害小但仍有
- D. 按需触发（选定）：零额外 API 成本（复用 rewriter 调用），零额外延迟（SQL WHERE），只在有时间意图时生效

**决策理由：** 研究发现参考项目都没有做自适应时间检索（OpenClaw 是 always-on 衰减）。学术 IR 研究支持 temporal intent classification 的可行性。关键洞察：**时间感知应该是查询的属性，而不是索引的属性**。

**技术参考：**
- Self-RAG (ICLR 2024): LLM 输出 retrieval tokens 决定是否需要检索
- Adaptive RAG: 根据查询复杂度动态选择检索策略
- Elasticsearch function_score: 条件化衰减函数，通过 filter 应用而非全局

---

### 决策 4: Pagelet 接入 VSS 的触发范围

**结论：所有场景（选项 A）**

Quick Review、Writing Assist、Discovery、Periodic Summary 四个场景全部接入 VSS 语义搜索作为跨笔记上下文。

**讨论过的选项：**
- A. 所有场景都搜：全面提升跨笔记能力，但 Quick Review 的"看完就走"节奏可能被 ~500ms 搜索影响
- B. 仅 Discovery：最小改动，精准解决 Scenario 3 核心缺失，但其他场景仍靠 LLM 猜测
- C. Discovery + Writing Assist：覆盖最有价值的两个场景

**决策理由：** 全面提升优于局部修补。~500ms 延迟在用户可接受范围内。所有场景的 `related_notes` 从"猜测"变为"语义搜索发现"是一个整体的质量跃升。

---

### 决策 5: v2.4 版本定位重新定义

**结论：v2.4 = 地基层 + 投影层，Action Mode 推迟到 v2.6**

> 2026-06-16 更新：范围从纯地基层扩展为 地基+投影（+Projector+Hygiene），v2.5 承接压缩+理解层，Action Mode 进一步推到 v2.6。

v2.4 的范围（扩展后）：
- #1 改进切片策略（heading-aware + frontmatter 保留）[SPEC-D1]
- #6 Pagelet 接入 VSS（所有场景）+ Reranker 升级 [SPEC-D2]
- #3 按需时间感知检索（Query Rewriter temporal 扩展）[SPEC-D3]
- #4 扩大检索窗口（4→8 文档）[SPEC-D4]
- Context 限制放宽 [SPEC-D5 部分]
- Context Projector Phase 1（提取 projection 边界）[SPEC-D5]
- Context Hygiene Phase 2（status-only 过滤 + diffing）[SPEC-D5]

估时：~18-22d（3-4 周）
产品叙事："v2.4 让 AI 真正理解你的笔记"

v2.5 的范围（新增）：
- Context Compactor（micro + full compaction）+ Budget [SPEC-D6]
- Type A 用户画像（纯自动提取）[SPEC-D7]
- Type C Vault 元认知（6 维度）+ Extraction pipeline [SPEC-D8]

估时：~20-25d（4-5 周）

**版本路线图更新：**

```
v2.3 (当前)   SQLite 迁移 + 结构清理 [code complete]
v2.4 (下一步)  AI 洞察力提升（地基 + 投影）[~3-4 周]
v2.5 (未来)   压缩 + 理解层（Compactor + Budget + Type A + Type C + Extraction）[~4-5 周]
v2.6 (远期)   Action Mode Phase 1 + Skill 扩展 + apiToken 清理
v2.6+ (远期)  Action Mode Phase 2 + 深化
```

**原 v2.4 Action Mode (SPEC-C1/C2) 状态：**
- Operations Agent SDD 已 `[A] Approved`，设计工作不浪费
- Write Action Framework v1 dogfooding 验证通过
- 推迟到 v2.6，等洞察力提升后再做编辑功能

---

### 决策 6: Context Projector 架构设计

**结论：4 个独立类 + Manager 组合**

Projector 拆分为 4 个职责独立的类（HostContextProjector、HistoryProjector、ObservationProjector、BudgetProjector），由 `PaAgentContextManager` 组合调度。

**决策理由：** 职责正交，独立测试。Manager 只做调度和预算分配，不持有业务逻辑。与现有 `pa-agent-loop.ts` 的集成点清晰（`forPrompt()` 边界）。

---

### 决策 7: Micro-compaction 策略

**结论：预算驱动 + 2 轮保护的混合策略**

当 observation 总量超过预算阈值时触发 micro-compaction。最近 2 轮的 tool results 受保护不被压缩。超出预算的旧 observation 用轻量摘要替换（保留 tool name + 结果要点，丢弃原始文本）。

**决策理由：** 纯预算驱动（无保护）会丢失刚刚获取的关键信息。纯轮数驱动（如"只保留最近 5 轮"）在工具密集对话中不够灵活。混合策略平衡了信息保鲜和空间控制。

---

### 决策 8: Full compaction 摘要模型

**结论：用主模型做摘要（不额外引入小模型）**

Full compaction 触发时（如 context 接近 token limit），使用当前对话的主模型生成全对话摘要。不引入独立的 summarization model。

**决策理由：** 减少模型依赖复杂度。主模型已了解对话上下文，摘要质量更高。额外 API 成本可接受（full compaction 触发频率低）。

---

### 决策 9: Type A 用户画像提取模式

**结论：纯自动提取（不做手动编辑入口）**

Type A 用户画像完全通过 LLM 从对话历史中自动提取，不提供用户手动编辑 UI。初期文件格式保持简单的 Markdown。

**决策理由：** 手动编辑入口增加 UI 复杂度但使用率低。自动提取的准确率通过置信度分级和 recurrence 机制保证。用户如需修正可直接编辑 `PA-Memory/user-profile.md` 文件。

---

### 决策 10: 提取触发时机

**结论：定时 + 对话边界双触发**

用户画像和 vault 元认知的提取在两个时机触发：(1) 定时后台任务（如每 24h）；(2) 对话边界（对话结束/插件关闭时）。

**决策理由：** 纯定时会遗漏高价值的即时对话。纯对话边界在长时间无对话时不更新 vault 元认知。双触发覆盖两种场景。浏览器环境下后台任务通过 `requestIdleCallback` + `setTimeout` 实现。

---

### 决策 11: Type C Vault 元认知维度

**结论：6 维度全做**

Type C 覆盖 6 个维度：主题聚类、标签分类、链接拓扑、写作习惯、知识空白、趋势变化。不做维度裁剪。

**决策理由：** 前 4 个维度（主题/标签/链接/习惯）可通过 Obsidian API 直接获取，零 API 成本。知识空白和趋势需要 LLM 辅助但价值最高（是"洞察力"的核心体现）。6 维度实现后可按优先级分阶段上线。

---

### 决策 12: Type A / Type C 调度关系

**结论：独立调度**

Type A（用户画像）和 Type C（vault 元认知）使用独立的提取调度器，互不阻塞。A 的提取周期与对话相关，C 的提取周期与 vault 变更相关。

**决策理由：** A 和 C 的数据源不同（A 来自对话历史，C 来自 vault 文件），生命周期不同（A 随对话更新，C 随文件变更更新），耦合调度会增加不必要的复杂度。

---

### 决策 13: 存储方案

**结论：混合存储（A 内部 / C vault 笔记）**

Type A 存储在插件内部目录（`PA-Memory/user-profile.md`），对用户半透明。Type C 存储为 vault 笔记（`PA-Memory/vault-insights.md`），用户可直接查看和搜索。

**决策理由：** A 是隐式个人数据，放在插件内部减少用户认知负担。C 是 vault 的元信息，作为笔记存在于 vault 中更自然，且可被 Pagelet 和 Memory 搜索直接发现。

---

### 决策 14: 质量控制机制

**结论：置信度分级 + recurrence**

提取结果按置信度分为 high/medium/low 三级。仅 high 直接写入存储。Medium 需要在 2+ 次独立对话中重复出现（recurrence）才提升为 high。Low 丢弃。

**决策理由：** 单次对话中的一次性表述（如"今天试试 Python"）不应立刻写入用户画像。Recurrence 机制确保只有稳定的模式被持久化。置信度由提取 LLM 自评 + 简单规则（如出现次数、上下文强度）混合判定。

---

### 决策 15: 版本归属最终方案

**结论：v2.4 = 地基 + 投影 / v2.5 = 压缩 + 理解**

将原来的"v2.4 纯地基 → v2.5 理解+Action Mode"方案调整为：
- v2.4：地基层（SPEC-D1~D4）+ Context Projector Phase 1 + Context Hygiene Phase 2（SPEC-D5）
- v2.5：Context Compactor + Budget（SPEC-D6）+ Type A（SPEC-D7）+ Type C + Extraction（SPEC-D8）
- v2.6：Action Mode Phase 1（SPEC-C1）+ Skill 扩展（SPEC-C2）+ apiToken 清理（SPEC-A7）

**决策理由：** Projector 是 Type A/C 的硬前提，放在 v2.4 确保 v2.5 开发不被阻塞。压缩和理解层作为一个完整的 v2.5 交付，用户感知到的是"AI 从第一次对话就了解你"的完整体验。Action Mode 推到 v2.6 确保充分的洞察力基础。

---

## 7. 参考文档

| 文档 | 内容 |
|------|------|
| `docs/agent-memory-extraction-research.md` | 5 个 agent 项目的跨会话记忆提取研究 |
| `docs/agent-context-management-research.md` | 5 个 agent 项目的上下文管理架构研究 |
| `docs/pagelet-product-design.md` | Pagelet 产品设计（Scenario 3 Knowledge Discovery） |
| `src/ai-services/pa-agent-runtime.ts` | PA Agent 运行时（prompt 构建、检索管线） |
| `src/pagelet/llm/prompts.ts` | Pagelet LLM prompt 定义 |
| `src/vss.ts` | VSS 向量搜索门面 |
| `src/vss/sqlite-worker.ts` | SQLite Worker（检索实现） |
| `src/ai-services/query-rewriter.ts` | 查询重写 |

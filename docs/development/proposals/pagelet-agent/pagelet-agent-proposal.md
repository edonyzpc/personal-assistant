# Pagelet Agent 化提案

Document status: Draft (讨论中)
Updated: 2026-07-23
Work item: TBD

> Pagelet 从编排式管道（single-shot LLM）演进为 Agent 模式的设计提案。
> 核心动机：复用 Chat Agent 已有的工具链能力，让 Pagelet 能"跟着线索走"而非"在预选范围内找答案"。

---

## 1 · 问题陈述

### 1.1 现状

当前 Pagelet 是 zero tool-use、single-shot 的管道式架构：

```
代码预编排上下文（scope plan + VSS + wikilinks + token budget）
  → 构建 prompt（SystemMessage + HumanMessage）
  → 单次 LLM 调用
  → 解析结构化输出
```

- 模型只能在代码预选的上下文范围内推理
- 无法根据分析中途的发现去追查更多信息
- 不能判断"信息不够"并主动补充检索
- Research flow 退化为"拼好 prompt 让用户手动去 Chat 跑"

### 1.2 已有能力未被复用

Chat Agent（PaAgentLoop）已具备完整的 agent 能力：

- 9+ 工具（search_memory、search_vault_snippets、inspect_obsidian_note 等）
- 多轮决策（最多 20 轮、30 次工具调用）
- 动态约束（ControlPolicy 根据意图调整可用工具集）
- 按需加载 Skill

Pagelet 做的是同类工作（分析笔记、找关联），却完全没有复用这套工具链。

### 1.3 核心差距

| 维度 | Chat Agent | Pagelet |
|------|-----------|---------|
| 谁决定检索什么 | 模型 | 代码 |
| 能否追问/补充检索 | 能（多轮） | 不能 |
| 能否判断"信息不够" | 能（policy 检测） | 不能 |
| 工具复用 | 全部 9+ 工具 | 零 |

---

## 2 · Pagelet Agent 定义

### 2.1 身份

Pagelet Agent 是一个默默阅读 vault 的研究助手。它不等用户提问，而是在用户写完/回看笔记时，主动告诉用户"有一件事你可能没注意到"。

### 2.2 目标

找到**用户仅凭当前视野看不到的、但知道了会改变行为的东西**。

具体产出类型：

| 类型 | 示例 | 核心特征 |
|------|------|----------|
| 矛盾 | "这篇的结论和你 3 月 note X 的数据冲突" | 跨时间 |
| 遗忘 | "你半年前对这个问题有个未完成的推演" | 跨时间 |
| 聚合 | "vault 里有 4 篇在讲同一件事，分散在不同文件夹" | 跨空间 |
| 过时 | "你引用的那个数据源在后来的笔记里已经被修正了" | 跨版本 |
| 缺口 | "你的论证链在第 3 步缺了支撑，vault 里有但你没引用" | 跨关联 |

**共性**：都是需要读多篇笔记 + 推理才能得出的。单篇笔记内能看到的东西不是它的工作。

### 2.3 输出标准

- 产出必须指向**具体的源笔记 + 具体位置**
- 用户知道这件事后，**会做一个动作**（去看、去改、去链接、去确认）——如果不会，就不值得说
- 上限不由数量定，由**信噪比**定：1 条高置信发现 > 5 条"可能相关"
- "没有值得说的"是合法结论，Agent 不凑数

### 2.4 和 Chat Agent 的边界

| | Chat Agent | Pagelet Agent |
|---|---|---|
| 触发 | 用户提问 | 系统事件（编辑结束） |
| 目标 | 回答问题 | 主动发现 |
| 输出对象 | 用户当前问题 | 当前笔记的盲区 |
| 何时该沉默 | 不该（用户在等答案） | 经常（没发现就别说） |

---

## 3 · 触发机制

### 3.1 设计原则

触发点是"用户可能要消费结果的时刻"，不是"内容变了的时刻"。

编辑中不跑，编辑结束后跑。

### 3.2 触发信号

- **离开笔记时**——用户写完切走了，对这篇笔记跑 Agent，下次回来结果已就绪
- **打开笔记时（内容自上次分析后有变化）**——上次没来得及跑，此刻补上
- **空闲 N 秒后**——用户停止编辑一段时间，说明写作告一段落

本质是 debounce："切走"或"空闲超时"，哪个先到算哪个。

### 3.3 防重复

- 每篇笔记在内容无变化时不重复跑（content hash 比对）
- 结果缓存，下次打开直接展示

---

## 4 · 结束边界

### 4.1 设计原则

结束条件由**任务语义**驱动，不由计数驱动。让模型自己判断什么时候够了。

### 4.2 Lead-Driven 停止逻辑

```
读当前笔记
  → 提取线索(leads)：声明、引用、主题、开放问题
  → 线索为空 → 结束（笔记太简单/独立）
  → 有线索 → 逐条追查
    → 追查过程中发现高置信 insight → 输出，结束
    → 追查完所有线索，无 insight → 静默结束
    → 追查中派生出新线索 → 继续追（模型推理能力的体现）
    → 触发熔断器 → 输出已有最高置信发现（如有），强制结束
```

Agent 的深度完全取决于笔记本身的复杂度和关联密度，而非人为画框。

### 4.3 熔断器（纯防御性，正常不触发）

| 约束 | 值 | 目的 |
|------|---|------|
| 最大工具调用 | 30 | 防止无限循环，和 Chat Agent 对齐 |
| 最大墙钟时间 | 180s | 后台任务不阻塞，给够探索时间 |

熔断器是兜底异常情况的，不是限制正常探索深度的。

### 4.4 成本控制

成本不靠单次约束控制，靠触发频率：
- Content hash 去重，无变化不重复跑
- Debounce 机制本身控制频率
- 单次跑得深没问题，关键是不重复跑

---

## 5 · 结果展示

### 5.1 时态模型（非分层）

不分"即时层"和"深度层"，只分时态：

- Agent 已跑过 → 直接展示缓存结果（即时）
- Agent 未跑过（新笔记/内容变了）→ 展示加载态，Agent 后台跑完后推送

产出只有一种质量标准（Agent 级别），不存在浅/深切换的体验割裂。

### 5.2 冷启动

首次打开或刚写完的新内容，短暂 loading 是可接受的——用户预期"刚写的东西需要一点时间消化"。

---

## 6 · 现有场景迁移

### 6.1 迁移决策

| 场景 | 结论 | 理由 |
|------|------|------|
| Discovery | 合并进 Agent | Agent 的"聚合""缺口"类型完全覆盖 discovery 场景，且能追得更深 |
| Quiet Recall | 合并进 Agent | Agent 是 quiet recall 的超集——不只说"相关"，还能说清"为什么相关、具体哪里" |
| Preload | 取消，由缓存取代 | 时态模型下，Agent 缓存结果即时展示，无需单独的 cheap LLM 调用 |
| Review（link/evidence） | 合并进 Agent | 跨笔记推理，Agent 天然覆盖 |
| Review（clarify/expand/trim） | **移除** | 单篇写作建议不在 PA 核心价值范围内 |
| Recap | 合并进 Agent | 本质也是跨笔记推理，只是触发条件和输入不同，复用同一 runtime |

### 6.2 迁移后的职责边界

Pagelet Agent 的职责彻底收敛为：**跨笔记、跨时间的洞察发现**。

不再承担：
- 单篇笔记的写作质量建议
- 浅层关联展示（已有 backlinks/tags 能看到的不需要 Agent 说）
- 格式/结构建议

Recap 作为 Agent 的另一种任务模式存在（不同触发条件 + 不同输入锚点），复用同一 runtime。

---

## 7 · UI/UX 收敛

### 7.1 现状问题

当前 UI 为每个场景独立设计：
- Bubble：6 种 content type（quick-review、discovery、writing-assist、recap-delivery、recall-delivery、nudge）
- Panel：4 种 layout（review、current、discover、summary）
- Tab：6+ 个独立 section

Agent 化后底层统一为一种产出（insight），按场景分的 UI 失去意义。

### 7.2 收敛方向

UI 从"按场景分"收敛到"按 insight 统一呈现"：

| 层 | 收敛后职责 |
|---|-----------|
| **Pet** | 不变——入口 + 状态指示（idle/working/nudge） |
| **Bubble** | 展示 Agent 最新发现的一条 insight，统一格式 |
| **Panel** | 当前笔记的所有 insight 列表，带来源引用、可跳转 |
| **Tab** | 历史 insights 浏览 + Recap 输出 |

### 7.3 Insight Card 统一格式

不再需要 6 种 content builder、4 种 layout renderer。一种 insight card 走天下：

```
┌─────────────────────────────────┐
│ [类型标签: 矛盾/遗忘/聚合/过时/缺口]  │
│                                 │
│ 主文本（Agent 的发现描述）         │
│                                 │
│ 📎 来源: note-a.md, note-b.md   │
│                                 │
│ [查看] [稍后]                    │
└─────────────────────────────────┘
```

差异仅在 metadata 标签，呈现逻辑统一。

### 7.4 简化收益

- 删除多套 content builder / layout renderer / section renderer
- 新增 insight 类型只需加 metadata 标签，不需要新增 UI 组件
- 用户认知负担降低：所有发现以一致的方式出现

---

## 8 · Agent 工具集

### 8.1 工具清单

复用 Chat Agent 的读工具子集 + webSearch（限定用途）：

| 工具 | 纳入 | 角色 |
|------|------|------|
| `search_memory` | ✓ | 核心——VSS 语义检索找跨笔记关联 |
| `get_current_note_context` | ✓ | 核心——读锚定笔记内容 |
| `search_vault_snippets` | ✓ | 核心——追线索时搜索具体内容片段 |
| `inspect_obsidian_note` | ✓ | 核心——查看笔记结构、links、backlinks、tasks |
| `search_vault_metadata` | ✓ | 核心——按 tag/frontmatter/路径找笔记 |
| `list_recent_notes` | ✓ | 核心——Recap 任务 + 时间维度追线索 |
| `read_note_outline` | ✓ | 核心——判断哪个 section 值得深入 |
| `webSearch` | ✓ | 验证——对 vault 内线索做外部确认/补充 |
| `read_canvas_summary` | 可选 | Canvas 用户需要时启用 |
| `list_vault_tags` | 可选 | 偶尔辅助分类查找 |
| `load_skill` | ✗ | 不需要 |
| `append_to_current_note` | ✗ | Agent 只读 |
| `replace_selection` | ✗ | Agent 只读 |

### 8.2 webSearch 使用约束

webSearch 定位为**验证工具**，不是发现工具：

- 只在追查线索过程中产生"需要外部数据才能确认"的判断时使用
- 不允许用它做泛搜索或"看看网上有什么相关的"
- 发现来自 vault 内部检索，验证/补充可借助外部
- Prompt 层面明确约束此行为

---

## 9 · Runtime 方案

### 9.1 决策：复用 PaAgentLoop，不 fork

核心循环机制（turn 管理、工具并发执行、abort、超时）是通用的。差异通过配置注入：

```
PaAgentLoop（通用引擎）
  ├─ Chat mode:
  │   - streaming 输出
  │   - AnswerCompletionPolicy + ControlPolicy + RequiredCapabilityPolicy
  │   - 全工具集
  │   - 输出 → chat UI stream
  │
  └─ Pagelet mode:
      - 非 streaming（后台执行）
      - LeadDrivenPolicy（语义停止逻辑）
      - 读工具子集 + webSearch
      - 输出 → insight cache
```

### 9.2 配置化差异点

| 维度 | 注入方式 |
|------|---------|
| Policy | afterTurn 回调——Pagelet 注入 LeadDrivenPolicy |
| 工具集 | tool factories 参数——Pagelet 传入子集 |
| System prompt | 构建时参数——Pagelet 用自己的 prompt |
| 输出 sink | 抽象接口——Chat 写 stream，Pagelet 写 cache |
| Streaming | 配置开关——Pagelet 关闭 |

### 9.3 不 fork 的理由

- 避免两套循环代码的维护负担
- Bug fix 和性能优化一处改两处受益
- PaAgentLoop 的 policy 注入设计本身就支持这种扩展

---

## 10 · 输出 Schema

### 10.1 Insight 数据结构

```typescript
interface PageletInsight {
  // 核心内容
  type: 'contradiction' | 'forgotten' | 'aggregation' | 'outdated' | 'gap';
  finding: string;           // 主发现描述（一两句话）
  reasoning: string;         // 推理过程摘要（为什么这值得说）

  // 来源溯源
  sources: Array<{
    path: string;            // 笔记路径
    heading?: string;        // 具体 heading 位置
    snippet?: string;        // 关键片段引用
  }>;

  // 时效性
  whyNow: string;            // 为什么现在告诉用户

  // 可行动性
  suggestedAction?: string;  // 用户可以做什么（可选）

  // 元数据
  anchorNote: string;        // 锚定笔记路径
  confidence: number;        // 0-1，低于阈值不展示
  createdAt: number;         // 时间戳
  contentHash: string;       // 锚定笔记 hash，判断是否过期
}
```

### 10.2 字段设计理由

| 字段 | 为什么需要 |
|------|-----------|
| `whyNow` | 没有时效性的 insight 不值得打扰用户（延续 Quiet Recall 设计） |
| `confidence` | Agent 自评，低于阈值不展示，避免凑数 |
| `sources[].snippet` | 用户能快速验证真伪，符合"可信" |
| `suggestedAction` 可选 | 有些 insight 不需要指手画脚，用户自己知道怎么做 |
| `contentHash` | 锚定笔记改了 → 旧 insight 自动过期 |
| `reasoning` | 调试和 eval 用，UI 可选择是否展示 |

---

## 11 · 评估标准

### 11.1 质量维度

| 维度 | 定义 | 验证方式 |
|------|------|---------|
| **精确性** | insight 描述的事实为真，sources 确实支撑 finding | 人工抽检 / 自动回溯验证 |
| **新颖性** | 用户不知道的——不是已有 backlink、同文件夹等显而易见的关联 | 检查涉及笔记间是否已有直接链接 |
| **可行动性** | 用户看到后会执行动作（打开来源、添加链接、修改内容） | 跟踪用户后续行为 |
| **信噪比** | "无发现"比例合理（~30-50% 触发产出 insight） | 统计产出率 |
| **时效性** | whyNow 成立——此刻告诉 vs 任何时候告诉，价值有差别 | 人工判断 |

### 11.2 执行方案

| 阶段 | 方式 |
|------|------|
| 短期（开发） | 人工 dogfooding，积累好/坏 case |
| 中期 | 建 eval dataset（笔记 + 预期 insight），跑 regression |
| 长期 | 用户行为信号（查看率、action 率、dismiss 率）作为隐式反馈 |

### 11.3 反模式检测

需要识别并惩罚的产出模式：
- 凑数——输出了 confidence 不够的 insight
- 泛泛——finding 没有指向具体来源（"vault 里可能有相关内容"）
- 显而易见——用户通过 backlinks/tags 已经能看到的关联
- 无时效——任何时候都成立的 insight，不是"现在"才值得说的

---

## 12 · 设计决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 复用 Chat Agent 工具链（读子集 + webSearch） | 避免能力重复建设，工具已验证可用 |
| D2 | 不分层，分时态 | 避免同一 UI 位置内容切换的割裂感，符合"安静且可信" |
| D3 | 触发点为"编辑结束"而非"内容变化" | 避免频繁编辑时反复触发浪费 |
| D4 | Lead-driven 停止逻辑 | 深度由笔记复杂度决定，不由人为上限决定 |
| D5 | 熔断器宽松（30 calls / 180s） | 目的是防异常，不是限制正常探索 |
| D6 | "无发现"是合法结论 | 杜绝凑数，信噪比优先 |
| D7 | 单次高置信发现即可结束 | 用户一次消化有限，持续触发覆盖后续线索 |
| D8 | 移除 clarify/expand/trim 写作建议 | 不在 PA 核心价值范围内，pagelet 收敛到跨笔记洞察 |
| D9 | Discovery + Quiet Recall 合并进 Agent | Agent 是两者的超集 |
| D10 | Recap 合并进 Agent | 本质也是跨笔记推理，只是触发条件和输入不同，复用同一 runtime |
| D11 | UI 从"按场景分"收敛到"按 insight 统一呈现" | 底层统一后，分场景 UI 失去意义，统一 insight card 降低复杂度 |
| D12 | webSearch 定位为验证工具 | 发现靠 vault 内检索，验证/补充借助外部，避免漫无目的搜索 |
| D13 | 复用 PaAgentLoop，不 fork | 循环机制通用，差异通过 policy/工具集/prompt/输出 sink 配置注入 |
| D14 | Insight schema 含 whyNow + confidence + contentHash | 时效性过滤 + 质量门槛 + 自动过期 |
| D15 | 评估分三阶段：dogfooding → eval dataset → 用户行为信号 | 渐进式建立质量反馈循环 |

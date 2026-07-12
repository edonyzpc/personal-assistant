# Pagelet Bubble 产品讨论记录

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

日期: 2026-07-05
状态: **讨论记录** — 本文档记录产品思考过程和决策推理，作为后续 Product Spec 的
provenance/context，不是实现规范。

---

## 一、讨论背景

基于 [Pagelet Bubble Next Iteration Context](./pagelet-bubble-next-iteration-context-2026-07-05.md)
的上下文记录展开。

目标：在写 SDD/Product Spec 之前，先从用户价值和产品哲学出发确定方向。不讨论
实现细节，只讨论"做什么"和"为什么"。

---

## 二、核心问题诊断

### 问题一：Bubble 空态 = AI 功能菜单

当前 Bubble 空态展示三个按钮：

```text
No new findings yet.

[Review current note]
[Discover connections]
[Generate summary]
```

这让 Pagelet 看起来像一个 AI 功能菜单，而不是 North Star 描述的「安静的回忆
入口」。三个按钮中没有一个在交付 PA 准备好的结果——它们都是在等用户点击后
触发 AI 操作。

### 问题二："No new findings yet" 掩盖了截然不同的内部状态

"No new findings yet" 这一行文字掩盖了至少十种完全不同的内部状态：

| 实际状态 | 用户感知 |
|---------|---------|
| Pagelet 已禁用 | 不知道 |
| Pet 已隐藏 | 不知道 |
| Proactive hints 已关闭 | 不知道 |
| Quiet Recall Bubble nudges 已关闭 | 不知道 |
| Memory 尚未准备 | 不知道 |
| 当前笔记太短 | 不知道 |
| 当前笔记被 Data Boundary 排除 | 不知道 |
| 静默时段 / Focus Mode 抑制中 | 不知道 |
| 后台准备尚未运行 | 不知道 |
| PA 跑过了但确实没有高置信度结果 | 不知道 |

用户无法区分"PA 正在安静工作"和"PA 根本没跑起来"。对于首次用户，这意味着
无法判断 Pagelet 是有用的、还是坏的、还是需要配置。

### 本质判断

**这是产品身份问题，不是 UI 问题。** Bubble 的空态定义了用户对 Pagelet 的
第一印象和核心认知。当前空态的产品语言是"这里有三个 AI 功能你可以试试"，
而不是"PA 正在安静地为你准备相关内容"。

---

## 三、框架演化过程

### 3.1 初始设想：状态显示 + 功能入口

用户最初的产品设想是：Pagelet 是 PA 的状态显示和关键功能入口，包括：

1. **初识时的能力、功能提醒** — 让新用户知道 PA 能做什么
2. **后台运行结果的提醒**（含弱后台状态提醒）— 让用户感知 PA 在工作
3. **关键功能结果的展示入口和交付触发点** — 让用户从 Bubble 开始使用核心功能

#### 审视结论

这个设想的**直觉是对的**：用户确实需要感知 PA 的状态和结果。但框架名称容易
导向"控制面板"的产品形态，与"安静且可信"冲突。

#### 具体风险

| 风险 | 分析 |
|------|------|
| 状态显示 + 功能入口 = 迷你 Dashboard | 每次打开都在汇报状态、展示按钮，像一个缩小版的控制中心 |
| "关键功能入口"的边界很难守住 | 功能入口天然趋势是膨胀——每个新功能都会问"要不要在 Bubble 加个按钮" |
| 状态显示容易滑向技术透明度 | 一旦开始显示状态，就容易暴露内部概念（Memory 状态、VSS 状态、后台任务状态） |

### 3.2 修正后的框架：存在感 + 交付面

保留了原始设想的**所有信息需求**，但用不同的产品表达：

| 原始设想 | 修正后的框架 | 产品表达差异 |
|---------|------------|------------|
| 状态显示 | **存在感（Presence）** | 通过 Pet 视觉状态传达，不通过文字 |
| 功能入口 | **交付面（Delivery Surface）** | 不是用户去找功能，是 PA 带着结果来找用户 |
| 弱后台状态 | **按需解释（Contextual Explanation）** | 只在空态/异常时出现，不常驻 |
| 初识提醒 | **阶段性引导（Progressive Onboarding）** | 按用户阶段出现，不常驻 |

#### 核心理念转变

> **不是用户去找功能，是 PA 带着结果来找用户。**

这一句话定义了 Bubble 从"功能入口"到"交付面"的本质转变。用户打开 Bubble
时，应该看到的是 PA 已经准备好的东西，而不是一组等待点击的按钮。

---

## 四、互斥 vs 共存模型的选择

### 问题定义

用户打开 Bubble 时，**状态解释**和**交付内容**是互斥的还是共存的？

- **互斥模型**：有 findings → 展示 findings；没有 → 展示 explanation
- **共存模型**：有 findings → findings + 底部状态行；没有 → explanation

### 分析过程

通过三个维度评估：

#### 维度 1：具体场景的信息增量

在 5 个典型场景中测试共存模型的信息增量：

| 场景 | 共存状态行内容 | 增量价值 |
|------|-------------|---------|
| 有 3 条 findings，一切正常 | "PA is ready" | ❌ 无增量，findings 本身就证明 PA 在工作 |
| 有 findings，但 Memory 还在准备 | "Memory still preparing — results may be partial" | ⚠️ 可能有用，但不是必须知道 |
| 有 findings，proactive hints 关闭 | "Hints are off — open Bubble to check" | ❌ 用户已经打开了 Bubble |
| 有 findings，API key 快过期 | "API key expires in 3 days" | ⚠️ 有用但属于 settings 层面的通知 |
| 有 findings，后台扫描完成 | "Last scan: 2 min ago" | ❌ 用户不需要知道扫描时间 |

结论：共存模型只有 **1.5 个场景**有明确信息增量，且价值是"可能有用"而非
"必须知道"。

#### 维度 2：物理空间约束

Bubble 是 ~280×320px 的紧凑空间，最多展示 3 条 findings。状态行占掉的空间
可能本来用于：

- finding 摘要的第二行
- why now 解释
- 留白（呼吸感）

在极小的表面上，每一行都有机会成本。

#### 维度 3：产品演化趋势

- **共存模型天然有膨胀压力**：一旦有了"状态区域"，后续每个新功能都会问
  "要不要在状态区域加一行"。这个压力是结构性的，不是纪律能控制的。
- **互斥模型没有这个压力**：没有"状态区域"这个概念，就没有"往里加东西"的
  入口。

### 决策

**选择互斥模型。**

对于"PA 有 findings 但同时有背景信息需要传达"的场景（如 Memory 还在准备中），
解法是**把信息融入 findings 本身**（内联上下文提示），而不是设立独立状态区域。

示例：

```text
# 互斥模型 + 内联提示（采用）
Finding 1: 你上周写过一篇关于 X 的笔记...
Finding 2: 这篇笔记和 Y 有交叉...
ℹ️ Memory 还在准备中，更多关联可能稍后出现

# 共存模型（不采用）
Finding 1: ...
Finding 2: ...
────────────────────
Status: Memory preparing · 45% done
```

这样既传达了信息，又不建立"状态区域"这个产品概念。

---

## 五、四个核心议题的决策推理

### 5.1 Bubble 状态集合

#### 状态分类

确定了两类状态：

**A 类：交付态（Delivery）** — PA 有准备好的东西要展示

| 编号 | 状态 | 含义 |
|------|------|------|
| A1 | Recall 交付 | PA 发现了与当前笔记相关的旧笔记 |
| A2 | Quick Review 交付 | PA 对当前笔记有 source-backed 的观察 |
| A3 | Pattern 交付 | PA 检测到跨笔记的主题/张力/重复模式 |
| A4 | Bridge 提示 | 一次性的阶段引导（首次安装、首次 Recall 等） |

**B 类：解释态（Explanation）** — PA 没有东西交付，解释原因

| 编号 | 状态 | 含义 |
|------|------|------|
| B1 | Needs Setup | Memory 未准备或关键配置缺失 |
| B2 | Preparing | 后台正在准备（Memory 索引中、首次扫描等） |
| B3 | Ready Nothing Found | 一切就绪，但当前上下文没有高置信度结果 |
| B4 | Intentionally Quiet | 用户主动设置了静默（Focus Mode、quiet hours、hints off） |
| B5 | Context Limited | 当前笔记太短、被 Data Boundary 排除、或不是 Markdown 文件 |

#### 关键决策

1. **B 类 5 种封顶**：未来新功能的状态必须归入已有的 5 个 B 类类别之一，
   不允许新增 B 类。这是防止状态膨胀的产品纪律。

2. **A 类优先级（已被第九章补充修正）**：原讨论曾记录
   `Bridge > Recall > Pattern > Quick Review`。后续评审确认真实 Recall
   或 prepared Recap delivery 应优先于 Bridge；Bridge 应作为无交付内容时的
   独立提示，或作为真实交付卡片的 inline hint。

3. **A 类永远优先于 B 类**：有交付内容时，不展示解释状态。背景信息如果
   需要传达，走内联提示（见第四章决策）。

### 5.2 Recall/Discovery 的 "Why Now" 深度

#### 三个深度层级

| 层级 | 内容 | 示例 |
|------|------|------|
| L1 语义相似 | "这篇笔记和 X 相似" | 跟 Smart Connections 没区别 |
| L2 主题+摘录 | "都提到了 Y 主题" + 原文摘录 | 有依据但用户需要自己判断重要性 |
| L3 关系推理 | "你上周在 A 中提出了问题 Q，这篇旧笔记 B 可能有答案" | "想起来了"的完整体验 |

#### 决策

**直接 L3**（融合 L1+L2+L3 的能力），不分阶段。

理由：

1. **L1 不可接受** — 纯语义相似度列表让 PA 沦为 Smart Connections 的翻版，
   失去产品差异化。
2. **L2 是半成品** — 展示半成品推荐违背"安静且可信"：如果 PA 不能说清楚
   为什么这条推荐现在重要，那就不应该展示。
3. **实现路径可行** — 当前 PA Agent Runtime 已有 VSS + LLM 推理链路，
   技术上可以生成 L3 质量的 why now 解释。
4. **不分阶段的原因** — 分阶段上线意味着用户会先看到 L1/L2 质量的推荐，
   形成"这就是又一个相关笔记列表"的认知，后续升级到 L3 时用户已经不看了。
   第一印象很难修正。

#### 展示阈值

不设独立的数值阈值。LLM 的 why now 解释质量本身即阈值——**能说清楚为什么
现在重要就展示，说不清楚就不展示。**

这个判断在实现层面转化为：LLM 生成 why now 解释后，如果解释只是在复述
语义相似性（"这两篇笔记都提到了 X"），则不通过阈值。

### 5.3 Review Current Note 的命运

#### 分析

在"交付面"框架下，空态 Bubble 的**唯一 action** 应该给
Recall/Discovery（North Star 核心价值），而不是 Review Current Note
（AI 评论当前文本）。

核心论证：**每次用户打开空态 Bubble 看到的那一个按钮，就定义了用户对
Pagelet 的认知。**

| 空态主 action | 用户形成的认知 |
|-------------|-------------|
| "审查笔记" | → Pagelet 是一个 AI 笔记审查工具 |
| "查找关联" | → Pagelet 是一个帮我想起旧笔记的助手 |

后者才是目标心智模型。

#### 决策

| 变化 | 内容 |
|------|------|
| **降级** | 从 Bubble 空态主角降级为 Needs Setup（B1）状态的 fallback action |
| **Ready Nothing Found 的主 action** | = Recall/Discovery 触发，不是 Review |
| **保留入口** | Chat / Command Palette / Panel·Tab |

**为什么不完全移除：** Review Current Note 在 Memory 未准备时仍然是用户
能立即获得价值的唯一操作。完全移除会让 Needs Setup 状态的用户无事可做。
所以保留为 fallback，但不让它定义 Pagelet 的身份。

### 5.4 Generate Summary 的去处

#### 分析

Summary 是用户主动要求的生成行为，不是 PA 准备好来交付的结果。它在"交付面"
框架下没有空态展示的理由——PA 并没有准备好一份 summary 在等用户来看。

#### 决策

| 变化 | 内容 |
|------|------|
| **移除** | 从 Bubble 空态移除 |
| **保留入口** | Command Palette 和 Panel/Tab |
| **Bubble 唯一保留路径** | 当 PA 检测到足够近期素材时，作为 A 类交付内容主动出现 |

#### 主动推送示例

```text
你最近 7 天写了 12 篇笔记。PA 准备了一份简要回顾。

[查看回顾]
[稍后]
```

这里的关键区别：不是用户去点按钮触发 summary，而是 PA 判断有足够素材后
主动准备好 summary 来交付。只有在"PA 已经准备好"的情况下才出现在 Bubble，
符合"交付面"框架。

---

## 六、关键产品原则（本次讨论提炼）

本次讨论提炼出 7 条产品原则，作为后续 Product Spec 和实现的审查基线：

| # | 原则 | 来源 |
|---|------|------|
| 1 | **Bubble 是 PA 的交付面，不是功能菜单** | 框架演化 §3.2 |
| 2 | **没有东西交付时，安静地解释为什么，不展示功能按钮** | 空态诊断 §2 |
| 3 | **存在感通过 Pet 传达，不通过 Bubble 文字** | 框架修正 §3.2 |
| 4 | **背景信息融入交付内容，不设独立状态区域** | 互斥模型决策 §4 |
| 5 | **宁可不展示也不展示说不清楚的推荐** | Why Now 深度 §5.2 |
| 6 | **状态集合封顶，防止膨胀** | 状态集合 §5.1 |
| 7 | **每次打开 Bubble 只需要理解一件事** | 互斥模型 + 优先级 §4/§5.1 |

---

## 七、后续行动

基于本次讨论的决策共识，下一步产出正式 Product Spec：

→ `docs/product/specs/pagelet-bubble-readiness-and-recall-product-spec.md`

Product Spec 应覆盖：

1. 问题陈述（基于本文档 §2 的诊断）
2. 产品原则（基于本文档 §6）
3. Bubble 状态模型（基于本文档 §5.1 的 A/B 类状态）
4. Recall/Discovery 统一结果模型（基于本文档 §5.2 的 L3 深度）
5. 空态文案矩阵（每个 B 类状态的用户可读文案 + action）
6. Bubble 允许的操作集合
7. 移入 Panel/Tab 的操作
8. 非目标
9. 开放决策
10. 验证场景

---

## 八、相关文档

- [PA Product North Star](../product/pa-product-north-star.md)
- [PA Product Discussion 2026-07-02](./pa-product-discussion-2026-07-02.md)
- [Pagelet Product Design](../product/pagelet-product-design.md)
- [Pagelet Bubble Next Iteration Context](./pagelet-bubble-next-iteration-context-2026-07-05.md)

---

## 九、2026-07-05 补充：Summary 与 Recap Delivery 的边界

后续评审中发现一个重要理解 gap：

- 错误理解：`Summary contextual delivery` 是带上下文的 `Generate summary`
  按钮。
- 修正理解：它应是 `Recap Delivery`，即 PA 已经准备好 source-backed 回顾信息，
  Bubble 只负责交付这条回顾。

因此，Bubble 中不应出现：

```text
PA 可以帮你做个简短回顾。
[Generate summary]
```

只有当后台已有 prepared recap artifact 时，才允许出现：

```text
PA 已为这个范围准备了一份简短回顾。
[查看回顾] [稍后]
```

当前代码已有三类相关能力，但还没有真正的后台 prepared Recap Delivery：

| 能力 | 当前状态 | 本次产品结论 |
|------|----------|--------------|
| Periodic Summary | 用户点击后前台生成 summary preview | 终态迁移到 Recap 的时间范围回顾模式；不再作为独立长期产品能力 |
| Scope Recap | 用户触发的 source-backed derived recap | 应升级为 Recap Delivery substrate |
| Background Preparation / Preload | 后台 generic review findings | 应收敛为统一 DeliveryCandidate 机制 |

补充决策：Periodic Summary 的产品方向已确认，不再要求先分阶段保留、
合并、删除。后续实现应面向终态迁移：旧入口直接删除，不做兼容 alias
或 redirect；用户理解中的能力应统一为 Recap / 时间范围回顾。

对应的上游产品 amendment 记录在
[Pagelet Delivery Preparation Consolidation Product Note](../product/specs/pagelet-delivery-preparation-consolidation-product-note.md)。

## 十、2026-07-05 补充：Phase 6 决策收敛

后续逐项讨论后，以下产品方向已确认：

| 决策项 | 已确认方向 |
|--------|------------|
| Prepared Recap artifact/cache | 使用本地 derived cache，信息量必须足够支撑 Panel/Tab 详情；不自动写 Markdown，不保存完整 raw provider output；用户明确保存时才导出 recap note。 |
| Recap scope / trigger | 默认 current-context + time-range recap；允许 Pagelet 打开、当前 note 保存、低频 idle preparation 触发；不做默认全库 daily/weekly summary。 |
| DeliveryCandidate persistence | `DeliveryCandidate` 统一展示/排序/动作合同，不统一持久化；Recap 可本地 derived cache，Pattern 只短期去重，Recall/Review 默认不新增长期持久化。 |
| Review findings in Bubble | Generic review 不进入 Bubble；只有 source-backed、high-confidence、有 why-now 和低负担 next action 的 review candidate 才能进入，且优先级低于 Recall/Recap/Pattern。 |
| Discover click flow | Bubble 内轻量异步；快速高质量结果留在 Bubble，慢/复杂/弱结果转 Panel；结果必须绑定触发时 active note snapshot。 |
| 小交互默认值 | Intentionally Quiet 完整解释只显示一次；大 vault 才显示准备进度数字；本轮不扩展 Pet state；Bubble 不显示 pending queue 文案。 |
| Periodic Summary 迁移 | 面向终态直接删除旧 Periodic Summary / Generate Summary 入口，不做 alias 或 redirect；能力统一进入 Recap / 时间范围回顾。 |

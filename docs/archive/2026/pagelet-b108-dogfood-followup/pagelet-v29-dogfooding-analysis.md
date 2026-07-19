# Pagelet v2.9.0-beta.1 Dogfooding 问题分析与行动方案

Document status: Archived
Delivery status: Closed
Updated: 2026-07-19
Work item: B-108

> 基于 2026-07-17 实际使用测试的系统性分析

## Status

| Field | Value |
| --- | --- |
| Document type | Dogfooding Analysis + Action Plan |
| Version | v2.9.0-beta.1 |
| Date | 2026-07-17 |
| Trigger | 实际使用发现 7 项体验问题 |
| Priority at discovery | P0 — 产品核心价值未传达 |
| Disposition | Evidence/provenance；B-108 已接管当前设计、实现与验证状态 |
| Current authority | [Scope Recap Product Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md)；本 [B-108 package](./README.md) 仅保留历史交付证据 |

---

## Part I: 问题清单

| # | 问题 | 严重度 | 根因分类 |
|---|------|--------|---------|
| 1 | Pet 目前只显示 View Recap 按钮 | High | 入口独占 |
| 2 | Quiet Recap 内容对用户没有意义 | Critical | 内容质量 |
| 3 | Scope Recap 内容对用户没有意义 | Critical | 内容质量 |
| 4 | Detail View 字体偏小，不跟随 Obsidian 设置 | Medium | 视觉呈现 |
| 5 | Review/Discover/Maintenance 从 Pet 触达不了 | High | 入口设计 |
| 6 | Detail View 单调，纯文字展示 | Medium | 视觉呈现 |
| 7 | 用户价值非常弱，没有吸引人的地方 | Critical | 综合 |

---

## Part II: 根因诊断

### 三层断裂模型

| 层 | 当前状态 | 投入比 | 问题 |
|---|---|---|---|
| **管道层**（Pet/Bubble/Panel/Tab + 优先级 + 状态机） | 精细到位 | 过度投入 | 架构优雅但用户不可感知 |
| **内容层**（Recap 算法、Recall 评分、"why now" 推理） | 粗糙/缺失 | 严重欠投入 | 核心价值载体为空 |
| **呈现层**（Detail View 视觉、交互丰富度） | 最低可用 | 几乎未投入 | 即使内容好，呈现也不吸引 |

> 管道再精致，水是浑的，用户打开龙头就失望。

### 各问题的具体技术根因

#### 问题 1: Pet 只显示 View Recap

`BubbleCoordinator.showBubble()` 使用严格优先级排序：

```
Prepared Recap > Onboarding nudge > Quiet Recall > Pattern Detection > Explanation fallback
```

一旦有 Scope Recap 准备好，它永远吃掉所有 Bubble 展示位。其他功能只在 Recap 不存在时作为 fallback 出现。

**文件**：`src/pagelet/BubbleCoordinator.ts:186-199`

#### 问题 2 & 3: Recap 内容无意义

Scope Recap 的生成逻辑（`src/pa/scope-recap.ts`）完全是规则引擎：

- **Themes** = 出现在 ≥2 篇笔记中的 tag（纯统计计数）
- **Tensions** = frontmatter 字段值不一致
- **Open Questions** = 内容中包含 `?` 的行
- **Next Review Actions** = 固定文案字符串

没有 LLM 参与，没有语义理解。用户看到的是 `"Theme: #project — #project appears across 4 source notes."` 这种句子。

Quiet Recall 稍好但同样缺失核心价值：`whyNow` 字段填入的是固定模板文本（"This saved insight references the note you are viewing"），而非产品规格要求的 L3 推理。

**文件**：`src/pa/scope-recap.ts:250-270` (buildThemeItems), `src/pa/quiet-recall.ts:182-222` (relationForInsight)

#### 问题 4: 字体偏小

所有字号使用硬编码 px 值，不跟随 Obsidian 的 `--font-text-size` CSS variable：

- Section h2: `18px`
- Sub-heading h4: `14px`
- Body text (insight card p): `13px`
- Tags: `11px`
- Meta: `11px`

`font-family` 正确使用了 `var(--font-interface)`，但 font-size 完全独立。

**文件**：`src/custom.pcss` 中 `.pa-pagelet-tab-*` 相关规则

#### 问题 5: 功能触达不了

| 功能 | 实际入口 | 问题 |
|------|----------|------|
| Review | Bubble explanation fallback | 只在无 Recap 时显示 |
| Discover | Bubble explanation fallback | 同上 |
| Maintenance | 仅 Command Palette | Pet/Bubble 完全不暴露 |
| Graph Discovery | 仅 Command Palette | 同上 |
| Quick Capture | Long-press Pet (520ms) | 零视觉提示 |

DEC-009 说"不要把 AI feature buttons 堆回 Bubble"——但执行为"完全不暴露任何功能入口"。

#### 问题 6: Detail View 单调

所有内容渲染为同一种卡片：`div.insight-card > h4 + p + tag-chips`。没有视觉层次区分、图形化元素、交互反馈、信息密度变化。

---

## Part III: 系统性反思 — 为什么多轮重构仍导致这些问题

### 五个结构性失误

#### 1. 设计以"否定"为主，缺乏"肯定"

每一轮重构的主旋律都是"不要X"：

- 不要 feature menu（7/5 讨论）
- 不要 L1/L2 质量的推荐（L3 门槛决策）
- 不要 Generate Summary 按钮
- 不要 queue/badge/obligation（DEC-009）
- 不要 status area（mutual exclusion 决策）

但正面替代物没有做到位。"不要 feature menu"变成了"只有 Recap"；"只接受 L3 质量"但 LLM why-now 推理从未实现；"不要 Generate Summary"但 Scope Recap 用的是 tag 统计。

> **教训：每个"不做 X"必须有对等质量的"做 Y"。否则产品不是安静，是空洞。**

#### 2. 基建先行，内容后补（但"后"永远没来）

时间线：D024 RunKindAdapter → D025 WAF → D030-D031 基础设施 → BubbleCoordinator → DeliveryCandidate 模型 → 状态机 → Mutual Exclusion → B-class cap → ... → Scope Recap 实现 = tag 计数 + 问号检测

31 个 D-决策中大部分是架构/管道决策。内容质量没有任何决策编号保护。

> **教训：管道和内容的投入比应该反过来。先验证一条推荐的价值，再建管道。**

#### 3. 原则堆积导致"正确但无用"

40+ 条约束（10 条 Bubble 原则 + 7 条战略决策 + 5 条 anti-pattern + 15 条审计决策 + DEC-009...）。任何新设计都要通过全部筛选。结果是"什么都别显示"成为唯一不违反原则的安全选项。

> **教训：原则是护栏不是方向盘。需要加正向约束：「用户点开后 3 秒内必须获得一个值得看的东西，否则设计失败」。**

#### 4. 审计驱动开发 — 评估原则合规而非用户体验

5 轮正式审计产出量化评分，但标准是"是否违反自定义原则"。v1 审计给 Bubble 打 4.3/5——但实际使用时发现"只有 View Recap 一个按钮、内容没意义"。分数和体验完全脱节。

> **教训：dogfooding 感受是 P0 信号，优先级高于任何打分体系。**

#### 5. 内部循环闭合

```
AI Deep Research → 产品方向 → Claude 写 spec → Claude 实现 → Claude 审计 → Claude retrospective → 循环...
```

这个循环能产出内在一致的设计，但不能产出外在有价值的设计。

> **教训：必须有外部打断——以纯用户身份使用 5 分钟，只记录真实感受。**

### 更深一层的根源

> **用了「设计系统」的方法论做「产品价值验证」。**

设计系统方法论：定义原则 → 推导规则 → 实现规则 → 审计合规。适合解决一致性问题。

产品价值验证方法论：做最小可用 → 自己用 → 感受到价值了吗？→ 没有就改内容/呈现 → 有了再建管道。

"自己用起来感受到价值了吗" 这个检验点从未作为门禁出现在任何迭代流程中。

---

## Part IV: 行动方案

### 优先级总览

```
                    ┌──────────────────┐
                    │  A. Recap 内容升级  │ ← 最高价值，解决核心问题
                    │  B. Recall why-now │
                    └────────┬─────────┘
                             │ 内容有价值后，入口才有意义
                    ┌────────▼─────────┐
                    │  C. Bubble 双区    │ ← 让用户能触达更多功能
                    │  D. 长按菜单扩展   │
                    └────────┬─────────┘
                             │ 功能触达后，呈现品质提升体验
                    ┌────────▼─────────┐
                    │  E. 字号对齐       │ ← 独立可做，不依赖上面
                    │  F. 卡片多样化     │
                    │  G. 微交互         │
                    └──────────────────┘

注意：E (字号对齐) 可以立即并行做，不依赖任何东西。
```

---

### A. Scope Recap → LLM 驱动的主题洞察

**目标**：Recap 产出真正的洞察，而非 tag 统计。

**现状代码**（`src/pa/scope-recap.ts:250-270`）：

```typescript
// 当前：纯 tag 统计
return [...byTag.entries()]
    .filter(([, group]) => group.length >= 2)
    .slice(0, 6)
    .map(([tag, group]) => makeItem({
        title: `Theme: #${tag}`,
        summary: `#${tag} appears across ${group.length} source notes.`,
    }));
```

**改造方案**：两阶段 build 流程

```
buildScopeRecap(sourceNotes, options)
  → normalizeSources()              // 保留：过滤、去重
  → extractNoteDigests()            // 新增：结构化提取 title + headings + 首段
  → host.generateRecapInsights({    // 新增：调用 LLM
        scope,
        noteDigests: [...],         // 每篇 title + headings + 首段
        instruction: "..."
    })
  → mapToScopeRecapItems()          // 将 LLM 输出映射回现有类型系统
```

**笔记 Digest 格式**（结构化提取：title + headings + 首段）：

```
Note 1: "项目架构决策"
Tags: #architecture, #decision
Headings: ## 背景 / ## 方案对比 / ## 结论
First paragraph: "本文档记录了关于缓存层选型的讨论..."

Note 2: "API 设计方案对比"
Tags: #architecture, #api
Headings: ## REST vs GraphQL / ## 性能测试 / ## 团队倾向
First paragraph: "在评估了三种 API 范式之后..."
```

**LLM Prompt**：

```
You are analyzing a set of user's personal notes to surface genuine insights.

## Input
{noteDigests}

## Task
Produce 2-4 insights about this set of notes. Each insight must:
1. Reference specific notes by their title (for source attribution)
2. Explain WHY this insight is worth the user's attention — not just WHAT it observes
3. Be something the user likely hasn't explicitly written down

## Quality gate
- If the notes have no meaningful relationship beyond sharing a tag, return an empty array.
- "These notes all discuss X" is NOT an insight. "Note A and Note B take opposite
  stances on X, which may indicate an unresolved decision" IS an insight.
- Prefer tensions, contradictions, implicit questions, and unfinished threads over summaries.

## Output format (JSON)
[
  {
    "title": "short headline (under 15 words)",
    "summary": "2-3 sentences explaining the insight and why it matters",
    "sourceNoteTitles": ["Note A title", "Note B title"],
    "section": "theme" | "tension" | "open_question"
  }
]

Return [] if nothing genuinely insightful can be said.
```

**LLM 输出映射回现有类型**：

```typescript
function mapLlmInsightToItem(
    insight: LlmInsight,
    allNotes: ScopeRecapSourceNote[],
    generatedAt: string,
): ScopeRecapItem {
    const matchedNotes = allNotes.filter(n =>
        insight.sourceNoteTitles.includes(n.title)
    );
    return makeItem({
        section: insight.section,
        title: insight.title,
        summary: insight.summary,
        sourceRefs: matchedNotes.map(n =>
            sourceRefForNote(n, generatedAt, insight.title)),
        generatedAt,
        idParts: [insight.section, insight.title],
    });
}
```

**降级方案（由 [DEC-019](../../../product/decisions/dec-019-honest-layered-recap-fallback.md) 更新）**：LLM 调用失败时仍不展示 Recap delivery，也不回退到 tag/计数规则洞察；后台保持安静并保留仍有效的旧 artifact。只有用户主动打开 Recap 且没有有效 artifact 时，才即时显示不冒充 insight 的本地 scope/source 概览、明确失败状态与重试入口。

**成本控制**：
- 结构化 digest（title + headings + 首段）比原始内容更紧凑，~200 tokens/篇
- Scope 上限 10 篇 → 单次 ~2-3k input tokens
- 仅在用户主动触发或后台准备时调用一次
- 已有 `providerInfo` 和 cost ceiling 机制

**为什么这样做**：
1. `ScopeRecapItem` 类型系统已存在（title + summary + sourceRefs），不改管道
2. `DeliveryCandidate` 流转路径不需要动
3. 唯一改变是内容生成方式：规则引擎 → LLM
4. 直接解决"Recap 对用户没意义"

---

### B. Quiet Recall → 真正的 "Why Now" 推理

**目标**：Recall 推荐附带 LLM 生成的、令人信服的关联解释。

**现状代码**（`src/pa/quiet-recall.ts:130-148, 182-222`）：

```typescript
// 评分：纯加权数学
semanticRelevance: 0.72, timeFreshness: 0.08, ...

// whyNow：固定模板
reasons.push(pageletT("pagelet.recall.generated.why.current", locale));
// → "This saved insight references the note you are viewing."
```

**改造方案**：三阶段流程（逐条独立评估）

```
buildQuietRecallCandidates(input)
  → computeRecallScore()           // 保留：embedding + 评分初筛
  → filter(score >= threshold)     // 保留：分数门槛
  → for each candidate:            // 逐条独立调用 LLM
      host.evaluateRecallRelevance({
          currentNote: { title, headings, firstParagraph },
          candidate: { title, headings, firstParagraph },
          relation: "current" | "related" | "far"
      })
      → 返回 { whyNow: string, isConvincing: boolean }
  → filter(isConvincing)           // 新增：不信服就不展示
  → map to QuietRecallCandidate    // 保留：组装最终结构
```

**逐条评估的理由**：每条候选独立调用，一条失败不影响其他候选的结果。

**LLM Prompt**（每条候选单独调用）：

```
You are deciding whether to remind the user of an old note.

## Current note the user is viewing
Title: "{currentNote.title}"
Headings: {currentNote.headings}
First paragraph: "{currentNote.firstParagraph}"

## Old note candidate
Title: "{candidate.title}" (last modified: {candidate.age} ago)
Headings: {candidate.headings}
First paragraph: "{candidate.firstParagraph}"

## Task
Is there a SPECIFIC, CONCRETE reason this old note matters RIGHT NOW given what
the user is currently looking at?

Respond in the same language as the notes.

## Quality standard
- "Both notes mention topic X" is NOT sufficient. That's a search result, not a recall.
- A good reason: "Your current note asks whether to use Redis or Postgres for caching;
  this old note documents your Redis performance benchmarks from March."
- A bad reason: "Both notes are about databases."

## Output (JSON)
{
  "isConvincing": true | false,
  "whyNow": "one sentence explaining why this old note matters now" | null
}

Default to isConvincing: false when uncertain. The user prefers silence over noise.
```

**语言规则**：whyNow 输出跟随笔记内容语言（prompt 中明确 "Respond in the same language as the notes"）。

**降级方案**：LLM 调用失败时，该候选不展示（沉默优于噪音），不回退到模板 whyNow。

**为什么这样做**：
1. 保留 embedding 作为高效初筛（不需要每篇笔记过 LLM）
2. LLM 只对 top-3~5 候选做判断，成本可控
3. `QuietRecallCandidate.whyNow: string[]` 字段已存在
4. 直接兑现产品规格的 L3 承诺
5. "沉默是有效状态"——不信服时不展示

---

### C. Bubble 从"单一独占"改为"主内容 + 上下文行动"

**目标**：打破 Recap 对 Bubble 的独占，让用户发现其他可用功能。

**DEC-009 重新解读**：

原文："Do not pile independent AI feature buttons and queues back onto the surface"

| Feature Menu（违反 DEC-009） | 上下文行动（不违反） |
|---|---|
| 永远显示相同按钮 | 根据当前笔记状态动态出现 |
| 用户不知道哪个有用 | 系统判断后只推荐此刻有意义的 |
| 像工具栏 | 像助手的建议 |

**方案：双区结构**

> DEC-018 更新：主内容必须直接交付具体 observation，不能只显示“已准备好回顾”。

```
┌─────────────────────────────┐
│  [主内容区]                   │
│  2 篇新笔记改变了发布节奏，    │
│  但 3 篇旧笔记仍沿用旧计划。   │
│  [查看依据]  [稍后]           │
├─────────────────────────────┤
│  [上下文行动区] (条件显示)      │
│  💡 This note has 3 unlinked │
│     mentions → [Discover]    │
└─────────────────────────────┘
```

**规则**：
- 上下文行动区最多 1 条（不是列表）
- 只在有具体依据时显示（"3 unlinked mentions"，不是"你可以试试"）
- 主内容区优先级不变
- 如果主内容是 B-class（Explanation），上下文行动区可以升为主区

**上下文行动信号来源**：复用 Quiet Recall 检索结果

Quiet Recall 后台已跑 embedding 检索。如果有候选通过分数门槛但 LLM 判断 not convincing，说明"有语义相关笔记但关系不够强"。此时退化为上下文行动提示：

```
信号判断逻辑（只保留发现类，禁止义务类）：
1. recall candidates > 0 且全部 not convincing → "Related notes found → Discover"
```

> 设计约束：上下文行动区只允许"发现类"提示，禁止"义务类"提示（如 "Not reviewed recently"、"Draft note"）。后者制造 obligation，违反 North Star。

**实现路径**：

```typescript
// BubbleCoordinator.showBubble() 改造
showBubble(...) {
    const mainContent = this.resolveMainContent(locale);     // 保留现有优先级
    const contextAction = this.resolveContextAction(locale); // 新增
    content = { ...mainContent, contextAction };
}

// resolveContextAction：仅发现类，复用 recall 结果
private resolveContextAction(locale): ContextAction | null {
    // 唯一信号：recall 有候选但 LLM 判定 not convincing
    const unconvincingRecall = this.callbacks.getUnconvincingRecallCount();
    if (unconvincingRecall > 0) {
        return { label: `${unconvincingRecall} related notes found`, action: "discover" };
    }
    return null;
}
```

**视觉**：
- 分隔：留白（`padding-top: 12px`）+ 字号降级，不画线（dashed border 在 Obsidian 中有其他语义）
- 字号：`var(--font-ui-small)`，比主区小一档
- 颜色：`var(--text-muted)`，视觉优先级低于主区
- 布局：单行，左对齐文本 + 右侧 text button
- 后续按使用观察效果调整

**交互行为**：
- 点击按钮 → 关闭 Bubble → 触发对应功能
- 无 dismiss/later（关闭 Bubble 即消失）
- 同一 session 对同一笔记不重复提示

**为什么**：
1. 不违反 DEC-009 精神（不是静态 feature menu，是基于 recall 结果的动态建议）
2. 打破 Recap 独占（用户即使看到 Recap 也能发现其他操作）
3. 零额外计算成本——复用 recall 已有的 embedding 检索结果
4. 一次只显示一条，不会滑向 feature menu

---

### D. Pet 长按菜单扩展

**目标**：给 power user 一个快速入口触达 Review/Discover。

**现状**：长按 520ms → 只打开 Quick Capture。

**改为**：长按 → 显示 2-3 个快捷入口

```
┌─────────────┐
│ ✏️ Capture   │
│ 🔍 Review    │
│ 🔗 Discover  │
└─────────────┘
```

**为什么**：
- 长按入口已存在，扩展代价低
- 不影响单击 → Bubble 主流程
- Power user 路径，对普通用户无侵入
- 解决"Maintenance 从 Pet 完全触达不了"

---

### E. 字号体系对齐 Obsidian

**目标**：Detail View 字号跟随 Obsidian 设置。

**改动**：复用 Obsidian 系统 font 配置（`--font-text-size`、`--font-ui-small`、`--font-ui-smaller` 等），不自定义 px 值。

```css
/* Before: 硬编码 px */
.pa-pagelet-tab-section h2 { font-size: 18px; }
.pa-pagelet-tab-insight-card p { font-size: 13px; }
.pa-pagelet-tab-tag-chip { font-size: 11px; }

/* After: 复用 Obsidian 系统变量 */
.pa-pagelet-tab-section h2 { font-size: calc(var(--font-text-size, 16px) * 1.125); font-weight: 600; }
.pa-pagelet-tab-insight-card p { font-size: var(--font-text-size, 16px); }
.pa-pagelet-tab-tag-chip { font-size: var(--font-ui-smaller, 12px); }
```

注意：`--h2-size` 不存在于 Obsidian 标准变量中，使用 `calc(var(--font-text-size) * 倍率)` 代替。

**为什么**：
- 用户设置了大字体，期望所有内容跟随
- 13px 在高 DPI 屏幕上长时间阅读偏小
- 纯 CSS 改动，零运行时成本，可立即执行

---

### F. Detail View 卡片多样化

**目标**：不同内容类型用不同视觉形式，创造节奏感。

**方案**：

| 内容类型 | 视觉形式 | 用途 |
|---|---|---|
| 洞察/发现 | 左侧彩色竖条 + 正文 + source link | 主要发现 |
| 主题关联 | 双栏对比（A ↔ B）+ 关系描述 | 连接类内容 |
| 行动建议 | 带 checkbox/按钮的 action card | 可做的事 |
| 摘要/概述 | 大字 pullquote 风格，无边框 | 最高层级信息 |
| 来源列表 | 紧凑 inline list，hover 展开 | 支撑证据 |

**实现**：

```typescript
private renderCard(finding: TabCard, section: TabSection): HTMLElement {
    switch (section.cardStyle ?? "default") {
        case "insight":    return this.renderInsightCard(finding);
        case "comparison": return this.renderComparisonCard(finding);
        case "action":     return this.renderActionCard(finding);
        case "quote":      return this.renderQuoteCard(finding);
        default:           return this.renderDefaultCard(finding);
    }
}
```

**为什么**：
- 视觉多样性创造节奏感——快速区分内容类型
- 减少认知负荷（同框同字 → 不知道哪个重要）
- 不需要改数据模型，只在渲染层根据 section type 选模板

---

### G. 增加交互反馈和微动画

**目标**：Detail View 从"静态文档"变为"交互界面"。

- Card hover: 微妙 elevation 变化（box-shadow transition）
- 展开/折叠: 平滑 height transition
- 来源链接: hover 时 inline preview tooltip
- Action 按钮: 点击后 subtle success feedback

**为什么**：增加"活的"感觉，纯 CSS transition + 少量 DOM，成本极低。

---

### H. 流程门禁：3-Second Value Test

**目标**：防止"正确但无用"的改动进入发布。

**做法**：每次完成面向用户改动后，提交前：

1. 关闭所有 spec/memory/原则文档
2. 打开 Obsidian，正常写 2-3 分钟笔记
3. 点击 Pet
4. 问自己：**"这 3 秒内我看到的东西，值得我明天再点一次吗？"**
5. 答案是"不值得"→ 改动未完成

**为什么**：直接打破"正确但无用"循环。不需要写进 spec，不需要审计打分——只需要真实感受。

---

## Part V: 执行顺序

> **H（3-Second Value Test）贯穿全程**：每完成一个阶段都执行自检，不是最后一步。

| 阶段 | 内容 | 预估工作量 | 前置依赖 |
|------|------|-----------|---------|
| 0 | E: 字号对齐 Obsidian | ~30min | 无 |
| 1 | A: Recap LLM 洞察 + B: Recall why-now（并行） | 2-3 天 | 无 |
| 2 | C: Bubble 双区结构 | 1 天 | A/B 完成（有好内容才值得改入口） |
| 3 | D: 长按菜单扩展 | 半天 | 无 |
| 4 | F: 卡片多样化 + G: 微交互 | 1-2 天 | A/B 完成（有好内容才值得打磨呈现） |

**延迟策略**（贯穿 A/B 实现）：
- Recall（方案 B）：后台预计算——打开笔记后自动触发 embedding 初筛 + LLM 逐条评估，结果缓存，用户点击 Pet 时零等待
- Recap（方案 A）：按 [DEC-017](../../../product/decisions/dec-017-default-background-recap-preparation.md) 默认进行有界后台准备；fresh、source-backed artifact 已存在时，用户点击立即看到实际洞察。按 [DEC-019](../../../product/decisions/dec-019-honest-layered-recap-fallback.md)，无有效 artifact 时先即时显示不冒充洞察的本地 scope/source 方向，由用户选择是否重试，不用泛化摘要伪装 ready

---

## Part VI: 与历史决策的关系

| 历史决策 | 本方案态度 | 理由 |
|---------|----------|------|
| DEC-009（不堆 AI feature buttons） | 遵守精神，重新解读边界 | "上下文行动"≠"feature menu" |
| L3 质量门槛（不展示弱推荐） | 兑现承诺 | 之前只设了门槛没实现内容 |
| Mutual exclusion（delivery OR explanation） | 保留主区，增加附区 | 附区不是 explanation，是 action |
| B-class 5 cap | 不变 | 不增加新的 explanation state |
| "沉默是有效状态" | 强化 | LLM 判断不信服时真正沉默 |
| DeliveryCandidate 统一模型 | 不变 | 内容改善不需要改管道类型 |

---

## Part VII: 成功标准

完成后的自检：

1. ✅ 点击 Pet → Bubble 展示的内容让我想看完
2. ✅ View Recap → 至少有一条让我"哦原来如此"的洞察
3. ✅ Quiet Recall 出现时，why-now 让我理解为什么现在看到这个
4. ✅ 我知道怎么从 Pet 找到 Review 和 Discover
5. ✅ Detail View 的字号和 Obsidian 其他界面一致
6. ✅ Detail View 浏览时能快速区分不同类型的内容
7. ✅ 整体感受：明天我还想再点一次

> 核心翻转：从管道向前推 → 从用户体验向后拉。

---

## Appendix A: 实现细节讨论确认（2026-07-17）

| # | 讨论点 | 决定 | 理由 |
|---|--------|------|------|
| 1 | Recap 笔记 digest 格式 | Title + headings + 首段（结构化提取） | 信息密度高于截断原文，实现不复杂 |
| 2 | Recall why-now 评估方式 | 逐条独立调用 LLM | 一条失败不影响其他，更可靠 |
| 3 | Why-now 输出语言 | 跟随笔记内容语言 | 最自然；prompt 加 "Respond in the same language as the notes" |
| 4 | 上下文行动区信号来源 | 复用 recall 检索结果 | 零额外计算；recall 候选 not convincing = "有语义邻居但不够强" |
| 5 | Recap prompt 质量门槛 | 当前表述，先用再调 | 已区分 what/why + 正反例 + 允许返回空；不过度收紧 |

## Appendix B: 评审整合决策（2026-07-17）

经产品专家、用户价值、UX 三视角评审后确认：

| # | 议题 | 决定 | 理由 |
|---|------|------|------|
| 1 | 确定性提醒（断链/草稿等）作为 Recap 内容 | 不引入 | 这些是维护任务，制造 obligation，违反 North Star；Recap insight 保持 LLM 驱动。DEC-019 只允许 explanation-only 的本地 scope/source 定向，不把规则结果变成 Recap 内容 |
| 2 | LLM 延迟体验策略 | **Superseded by DEC-017/DEC-018**：Recap 默认有界后台准备，只有高质量新洞察轻提示，点击即得 | 正式验证和用户决策确认“有价值的 Recap 不应等待”，但准备完成本身不等于值得打扰 |
| 3 | "Not reviewed recently" 上下文行动 | 移除 | 制造 obligation，违反"安静且可信"；上下文行动区只允许发现类提示 |
| 4 | 冷启动（笔记少时 LLM 返回空） | **Superseded by DEC-019**：后台仍沉默；主动打开 Recap 时显示诚实的本地范围状态与来源入口 | 不制造洞察，但避免用户主动点击后完全落空 |
| 5 | 卡片种类数量 | 保留 5 种 | 先实现，dogfooding 后按实际效果裁减 |
| 6 | 双区只在 B-class 时显示 | 不接受，A/B-class 均可显示 | 即使有 Recap，用户也应能看到"还有相关笔记可探索" |
| 7 | B（Recall）先于 A（Recap）执行 | 不接受，A+B 并行 | 并行整体交付更快 |
| 8 | Bubble 上下文行动区分隔方式 | 留白 + 字号降级，不画线 | dashed border 在 Obsidian 中有其他语义；后续按使用观察调整 |
| 9 | 长按蓄力视觉反馈 | 先实现看效果 | 当前已有动画提示，如果不够再增强 |
| 10 | `--h2-size` CSS 变量 | 复用 Obsidian 系统配置 | `--h2-size` 不存在于 Obsidian 标准变量；统一使用 `--font-text-size` 等系统变量 |
| 11 | H（3-Second Value Test）执行时机 | 贯穿每个阶段 | 不是最后一步，每完成一个阶段都执行 |

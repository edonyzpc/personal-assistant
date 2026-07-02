# PA 产品重设计开发计划

Updated: 2026-07-02
Status: **已批准** — 下一个版本的完整开发计划
依据: [产品设计讨论记录](./pa-product-discussion-2026-07-02.md)

## 目标

将 2026-07-02 产品讨论中确定的 7 项设计决策落实到代码中。
完成后 PA 的核心体验从"Review Assistant"转变为"知识重现引擎 + Vault 照料者"。

## 前置阅读

**必读**：开始任何开发工作前，必须完整阅读以下文档：

1. `docs/pa-product-discussion-2026-07-02.md` — 产品决策全文（9 章）
2. `AGENTS.md` — 开发规范
3. `docs/pa-product-north-star.md` — 当前 North Star（将被更新）

## 开发阶段

计划分为 6 个阶段（Phase），按依赖关系排序。每个阶段内部的任务可并行。

```
Phase 0: 文档对齐（无代码改动）
Phase 1: Quiet Recall 核心重构（最大的架构变更）
Phase 2: Weekly Review 拆解（移除 + 重新归位）
Phase 3: Frontmatter 建链能力（新功能）
Phase 4: 首次体验引导（新功能）
Phase 5: Chat 文字选择 + 跨笔记模式检测（增强功能）
```

---

## Phase 0: 文档对齐

**目标**：更新所有产品文档，使 North Star 和设计原则反映最新决策。
**风险**：无代码改动，零风险。
**验证**：`rg -n "compound naturally" docs/ AGENTS.md CLAUDE.md` 返回零结果。

### Task 0.1: 更新 North Star 文档

**文件**: `docs/pa-product-north-star.md`

变更内容：
- 将 North Star 声明从"PA is a quiet and trustworthy personal knowledge
  assistant..."更新为新版本
- 将短版本从"Let personal knowledge compound naturally"更新为
  "随手记下，需要时自然浮现"
- 保留"安静且可信"但明确标注为**设计约束**，不是产品定位
- 保留 6 条 "Less X, more Y" 原则但归入设计约束章节
- 新增衰减原则（多维信号排序，不做硬衰减）
- 新增研究支撑的 7 条设计原则（来自讨论记录第三章）

### Task 0.2: 更新 AGENTS.md 和 CLAUDE.md

**文件**: `AGENTS.md`, `CLAUDE.md`

变更内容：
- 更新 Product North Star 章节引用新版 North Star
- "安静且可信"从 North Star 位置移到 Design Philosophy 子章节
- "Let personal knowledge compound naturally" 替换为新短版本

### Task 0.3: 更新受影响的产品 Spec

**文件**: `docs/pa-quiet-recall-insight-timing-product-spec.md`,
`docs/pa-weekly-review-product-spec.md`

变更内容：
- Quiet Recall spec：标注候选池扩展决策、新触发模型、与 Smart Connections
  的差异化定位
- Weekly Review spec：标注功能拆解决策、两个保留内核的归属

**注意**：不删除 spec 文件，而是在文件顶部添加 `> [!warning] 本 spec 的部分
内容已被 [产品设计讨论 2026-07-02](./pa-product-discussion-2026-07-02.md) 修改。
请以该讨论记录为准。` 的 callout。

---

## Phase 1: Quiet Recall 核心重构

**目标**：Quiet Recall 候选池从 Saved Insights 扩展到 vault 全量笔记，
评分模型改为多维信号排序，触发模型改为三层。
**风险**：HIGH — 核心功能的架构变更。
**依赖**：Phase 0 完成。

### Task 1.1: 扩展候选池数据模型

**文件**: `src/pa/quiet-recall.ts`

1. 新增 `QuietRecallVaultNote` interface：

```typescript
export interface QuietRecallVaultNote {
    path: string;
    title?: string;
    content?: string;
    tags?: readonly string[];
    links?: readonly string[];
    backlinks?: readonly string[];
    modifiedAt?: string;
    createdAt?: string;
}
```

2. 在 `QuietRecallBuildInput` 中新增 `vaultNotes?: readonly QuietRecallVaultNote[]`
3. 保留 `savedInsights` 字段 — 两种候选源共存，Saved Insights 仍然是高优先级候选
4. **关键**：将 `QuietRecallCandidate.sourceInsightId` 改为 optional（`sourceInsightId?: string`），
   因为 vault-note 候选没有 source insight。同步更新 `QuietRecallBubbleNudge.sourceInsightId`
   为 optional。检查所有消费 `sourceInsightId` 的函数是否处理 `undefined`。

### Task 1.2: 实现混合评分模型

**文件**: `src/pa/quiet-recall.ts`

替换当前的固定分数（`CURRENT_RELEVANCE_BASE = 80` 等）为多维信号评分：

```typescript
interface RecallScoreSignals {
    semanticRelevance: number;   // 0-1, 来自 VSS 或 metadataCache 匹配
    timeFreshness: number;       // 0-1, 基于 modifiedAt 的衰减曲线
    connectionDensity: number;   // 0-1, backlinks + links 数量归一化
    noteRichness: number;        // 0-1, 基于内容长度/结构（标题数、标签数）
    userFeedback: number;        // 0-1, 基于历史 dismiss/accept 记录
}
```

评分函数：`score = weightedSum(signals)` — 权重可配置但有合理默认值。
**语义相关性是主信号**，其余为辅助排序信号。

### Task 1.3: 实现 VSS + metadataCache 混合检索

**文件**: `src/plugin.ts`（`runQuietRecall` 方法）

1. 检测 VSS 是否就绪（`isMemoryReadyForPageletDiscovery()`）
2. **VSS 可用时**：用 `findRelatedNotes`（复用已有的 VSS hybrid search）
   获取语义相关笔记，传入 `vaultNotes`
3. **VSS 不可用时**：用 `metadataCache` 做轻量匹配 — 基于当前笔记的
   tags、links、backlinks、folder 找到结构关联的笔记
4. 两种路径都通过 `collectQuietRecallVaultNotes()` 新方法收集，
   参考 `collectGraphDiscoveryNotes()` 的模式（已有该模式）

### Task 1.4: 添加"打开笔记"触发

**文件**: `src/pagelet/orchestrator.ts`

在 `handleLeafChange()`（当前用于 Pet remount）中添加 Quiet Recall 触发：

```typescript
// 在 handleLeafChange 中，Pet remount 之后：
if (this.canPrepareQuietRecallBubbleNudge()) {
    void this.prepareQuietRecallBubbleNudge();
}
```

需要添加防抖：快速切换多个笔记时不应频繁触发。使用现有的
`foregroundRouteToken` 模式确保只有最后一次切换生效。

### Task 1.5: 添加快捷键触发

**文件**: `src/pagelet/orchestrator.ts`, `src/plugin.ts`

1. 现有命令 `pa-pagelet:quiet-recall` 已注册但无默认快捷键
2. 在 `plugin.ts` 中为该命令设置默认 hotkey（Obsidian API 限制：
   插件无法编程设置 hotkey，只能在文档中建议用户设置）
3. 对于双击 Ctrl 的特殊触发：在 Pagelet 的全局键盘监听中添加
   双击检测逻辑（检测 200ms 内连续两次 Ctrl keydown）

注意：双击 Ctrl 检测需要考虑平台差异（macOS 用 Meta/Cmd），
建议先实现为可配置的快捷键，双击检测作为 P1 增强。

### Task 1.6: 更新测试

**文件**: `__tests__/quiet-recall.test.ts`

新增测试用例：
- vault notes 候选评分
- VSS 可用 vs 不可用的回退行为
- 多维信号排序的正确性
- isPathAllowed 过滤对 vault notes 的生效
- 空 vault 的处理

### 验证

```bash
npm test -- --runInBand __tests__/quiet-recall.test.ts
make deploy  # 在 test vault 中打开笔记，观察 Quiet Recall 是否浮现相关旧笔记
```

---

## Phase 2: Weekly Review 拆解

**目标**：将 Weekly Review 从独立功能拆解为两个内核，归入其他功能。
**风险**：MEDIUM — 移除用户可见功能，但该功能尚未正式发布。
**依赖**：无硬依赖，可与 Phase 1 并行。

### Task 2.1: 提取 Memory 批量确认为 Pagelet Tab Section

**文件**: `src/pagelet/tab/TabView.ts`, `src/pagelet/orchestrator.ts`

1. 当前 Memory Governance tab 已存在（`renderMemoryGovernanceContent`）。
   需要增强它以支持从 Review Queue 中筛选 `memory_candidate` 类型的 items
   并提供批量确认操作。
2. 这个 section **不绑定周频** — 用户任何时候打开 Pagelet Tab 都能看到
   待确认的 Memory Candidates。
3. 复用 `weekly-review.ts` 中 `memoryQueueItems()` 的过滤逻辑
   （筛选 `memory_candidate` / `memory_conflict` 类型）。

### Task 2.2: 实现跨笔记模式检测 Nudge

**文件**: 新建 `src/pa/pattern-detection.ts`

1. 实现 `detectCrossNotePatterns(notes: NoteInput[]): PatternResult`
   — 检测重复主题、张力、反复出现的问题
2. 触发条件：当 vault 中近期（7-14 天）活跃笔记积累到阈值时
   （如 >= 5 篇有交叉标签/链接的笔记），PA 通过 Bubble nudge 通知用户
3. 展示方式：点击 nudge 后在 Pagelet Tab 中展示发现的模式

**注意**：这是一个**新模块**，不是从 Weekly Review 直接提取。
Weekly Review 原来的"本周主题"逻辑过于简单（只看标签频率），
新模块应该利用 Graph Discovery 的基础设施做更深入的关联分析。

### Task 2.3: 移除 Weekly Review 独立功能

**文件**: 多个文件

1. `src/pa/weekly-review.ts` — 保留文件但标记 `buildWeeklyReview`、
   `buildWeeklyReviewMarkdown`、`buildWeeklyReviewGeneratedNote` 为
   `@deprecated`，添加迁移注释指向新的实现位置
2. `src/pagelet/orchestrator.ts` — 移除 `runWeeklyReview()` 方法
3. `src/pagelet/commands.ts` — 移除 `PAGELET_WEEKLY_REVIEW_COMMAND_ID` 注册
4. `src/plugin.ts` — 移除 `runWeeklyReview()` 和 `saveWeeklyReviewNote()`
5. `src/pagelet/PageletHost.ts` — 移除 `runWeeklyReview` 和
   `saveWeeklyReviewNote` 接口方法
6. `src/settings.ts` — `weeklyReview` settings block 标记 `@deprecated`
   但保留以兼容已有数据
7. `src/locales/` — 保留 i18n keys 但不再新增
8. `__tests__/weekly-review.test.ts` — 保留作为回归测试直到 deprecated 代码移除

### 验证

```bash
npm test -- --runInBand
rg -n "weeklyReview\|weekly-review\|weekly_review" src/pagelet/orchestrator.ts
# 期望：零结果（除 deprecated 引用外）
```

---

## Phase 3: Frontmatter 建链能力

**目标**：Quiet Recall 浮现旧笔记时，用户可一键在 frontmatter 中建立关联。
**风险**：LOW — 使用 Obsidian 已有的 `processFrontMatter` API。
**依赖**：Phase 1（Quiet Recall 重构后才有浮现的旧笔记）。

### Task 3.1: 实现 Frontmatter 写入工具函数

**文件**: 新建 `src/pa/frontmatter-link.ts`

```typescript
export async function addPaRelatedLink(
    app: App,
    sourcePath: string,
    targetPath: string,
    options?: { bidirectional?: boolean },
): Promise<{ ok: boolean; reason?: string }>
```

实现：
1. 使用 `app.fileManager.processFrontMatter(sourceFile, (fm) => { ... })`
2. 读取 `fm['pa-related']`（如果存在，应该是数组）
3. 添加 `[[targetPath]]` 到数组（去重）
4. 如果 `bidirectional: true`，对 target 文件也执行同样操作
5. 错误处理：文件不存在、frontmatter 解析失败等

### Task 3.2: 在 Quiet Recall UI 中添加"关联"操作

**文件**: `src/pagelet/tab/TabView.ts`, `src/pagelet/bubble/BubbleContent.ts`

1. 在 Quiet Recall 候选卡片上添加"关联到当前笔记"按钮
2. 点击后调用 `addPaRelatedLink(app, currentNotePath, candidateNotePath)`
3. 成功后在按钮位置显示确认状态（如变灰 + "已关联"）
4. 同时通过 Bubble/Pet 显示简短确认

### Task 3.3: 测试

**文件**: 新建 `__tests__/frontmatter-link.test.ts`

测试用例：
- 添加 pa-related 到无 frontmatter 的笔记
- 添加到已有 frontmatter 的笔记
- 添加到已有 pa-related 的笔记（去重）
- 双向关联
- 文件不存在的错误处理

### 验证

```bash
npm test -- --runInBand __tests__/frontmatter-link.test.ts
make deploy  # 在 test vault 中测试：触发 Recall → 点击关联 → 检查 frontmatter
```

---

## Phase 4: 首次体验引导

**目标**：三个一次性桥梁引导，使用 PA 统一通知样式。
**风险**：LOW — UI 层改动，不影响核心逻辑。
**依赖**：Phase 1（Quiet Recall 首次浮现引导依赖 Recall 功能可用）。

### Task 4.1: 扩展 Onboarding 状态

**文件**: `src/settings/pagelet/index.ts`, `src/settings.ts`

当前只有 `onboardingShown: boolean`。扩展为：

```typescript
interface OnboardingState {
    pageletOnboardingShown: boolean;     // 现有的 bubble 首次引导
    maintenanceScanSuggested: boolean;   // 首次安装 + vault > 50 notes
    quickCaptureExplained: boolean;      // 首次 Quick Capture 后
    quietRecallExplained: boolean;       // 首次 Recall 浮现后
}
```

保持向后兼容：旧的 `onboardingShown: boolean` 映射到 `pageletOnboardingShown`。

### Task 4.2: 实现三个引导触发

**文件**: `src/pagelet/orchestrator.ts`, `src/plugin.ts`

| 引导 | 触发位置 | 条件 | 展示 |
|------|---------|------|------|
| Maintenance Scan | `plugin.ts` `onIdle()`（line 694） | `!maintenanceScanSuggested && vaultFileCount > 50` | Bubble nudge |
| Quick Capture | `QuickCaptureService.captureText()` 成功后 | `!quickCaptureExplained` | Bubble nudge |
| Quiet Recall | `prepareQuietRecallBubbleNudge()` 首次成功 | `!quietRecallExplained` | Bubble nudge 附加说明文字 |

**约束**：所有引导通过 BubbleContent 展示（PA 统一样式），
不使用 `new Notice()`。引导文案在 `src/locales/` 中定义。

### Task 4.3: 添加引导 i18n

**文件**: `src/locales/pagelet/en.json`, `src/locales/pagelet/zh.json`

```json
"pagelet.onboarding.maintenanceScan": "PA can scan your vault and suggest how to organize notes. Try it from the command palette.",
"pagelet.onboarding.quickCapture": "Your thought is saved. PA will remind you when it becomes relevant to what you're writing.",
"pagelet.onboarding.quietRecall": "PA found a note you wrote before that may be relevant now. Click to see why."
```

### 验证

```bash
make deploy  # 重置 onboarding state → 检查三个引导是否按条件出现且只出现一次
```

---

## Phase 5: Chat 文字选择 + 跨笔记模式检测

**目标**：Chat 支持基础文字选择操作；跨笔记模式检测作为 PA nudge。
**风险**：MEDIUM — 新功能开发。
**依赖**：Phase 2（跨笔记模式检测是 Weekly Review 拆解的内核之一）。

### Task 5.1: Chat 文字选择操作

**文件**: `src/ai-services/chat-tool-factories.ts`, `src/chat/chat-view.ts`

1. 当前 `get_current_note_context` 工具（`src/ai-services/chat-tool-factories.ts`
   line 325）已能读取 `editor.getSelection()`（line 399）
2. 新增工具 `replace_selection`：将 AI 生成的文本替换编辑器中的选中内容
3. 在 Chat UI 中检测编辑器有选中文本时，添加快捷操作提示
   （如"总结选中内容"、"翻译"、"解释"）
4. 操作通过现有 Chat 对话流执行，不是独立的 Quick Command 系统

**注意**：`replace_selection` 是一个**写入操作**，必须受现有的
Operations Agent 写入权限控制。如果 `operationsAgentEnabled` 为 false，
只支持读取选中内容（总结/解释/翻译到 Chat 输出），不支持回写。

### Task 5.2: 跨笔记模式检测

**文件**: 新建 `src/pa/pattern-detection.ts`

1. 输入：近期活跃笔记（7-14 天内修改的 .md 文件）
2. 分析维度：
   - 重复标签/主题（多篇笔记出现相同 tag 集合）
   - 张力/矛盾（同一主题下不同笔记的观点冲突 — 需要 LLM）
   - 反复出现的问题（多篇笔记包含 `?` 或问句模式）
3. 输出：`PatternDetectionResult` 包含发现的模式列表，每个带 sourceRefs
4. 触发：不绑定固定周期。在 `plugin.ts` 的 `onIdle()`（line 694）中检查是否满足触发条件
   （近期活跃笔记 >= 5 篇且上次检测距今 >= 3 天）
5. 通知：通过 Bubble nudge，用户点击后在 Pagelet Tab 中查看

### 验证

```bash
npm test -- --runInBand
make deploy  # Chat 中选中文字 → 测试总结/翻译操作
             # 在 test vault 中创建 5+ 有交叉标签的笔记 → 观察模式检测 nudge
```

---

## 开发顺序与时间估计

```
Phase 0 (文档)           ████                    0.5 天
Phase 1 (Quiet Recall)   ████████████████████    3-4 天
Phase 2 (Weekly Review)  ██████████████          2-3 天
Phase 3 (Frontmatter)    ████████                1-2 天
Phase 4 (引导)           ██████                  1 天
Phase 5 (Chat + 模式)    ████████████████        2-3 天
                                         总计:  10-14 天
```

Phase 0 和 Phase 2 可以并行。
Phase 3 和 Phase 4 可以并行（都依赖 Phase 1 完成）。
Phase 5 依赖 Phase 2 但可以在 Phase 3/4 同时进行。

## 每个 Phase 的完成标准

| Phase | 完成标准 |
|-------|---------|
| 0 | `rg "compound naturally" docs/ AGENTS.md CLAUDE.md` 返回零结果；新 North Star 在所有文档中一致 |
| 1 | Quiet Recall 能从 vault 笔记中浮现候选；三种触发方式都工作；测试通过 |
| 2 | Weekly Review 命令不再存在；Memory 批量确认在 Pagelet Tab 中可用；模式检测 nudge 工作 |
| 3 | 用户可从 Recall 候选卡片一键添加 frontmatter 关联；Graph View 显示关联 |
| 4 | 三个一次性引导在正确条件下出现且只出现一次 |
| 5 | Chat 可读取选中文字并执行操作；跨笔记模式在满足条件时通过 nudge 通知 |

## 全局验证

每个 Phase 完成后执行：

```bash
make deploy
npm test -- --runInBand
npm run lint
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Quiet Recall vault 级检索性能差 | 大 vault 卡顿 | 结果数量上限（max 5）+ 异步执行 + 候选笔记数上限（40，复用 Graph Discovery 模式） |
| Weekly Review 移除后用户投诉 | 功能回退 | 该功能尚未正式发布；拆解后的内核（Memory 确认、模式检测）保留了核心价值 |
| Frontmatter 写入导致同步冲突 | 多设备用户的 frontmatter 冲突 | `pa-related` 是 list 类型，合并冲突容易手动解决；写入前检查是否已存在 |
| 跨笔记模式检测质量不稳定 | LLM 依赖的张力检测可能不准 | 先只做基于结构信号的检测（标签/链接），LLM 张力检测作为 opt-in 增强 |
| 双击 Ctrl 快捷键与系统快捷键冲突 | 平台兼容性 | 先实现为可配置快捷键，双击检测作为增强；文档引导用户自行设置 |

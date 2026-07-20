# B-119 Insight Enhancement Layer — Codex 开发 Handoff

Document status: Current
Updated: 2026-07-20
Work item: B-119
Authority: [Discovery Brief](./insight-enhancement-layer.md) 的开发交接文档，提供 Codex 执行所需的精确代码模式、集成点、已知障碍和分阶段任务。

## 0. 给 Codex 的直接指令

1. 从仓库根目录读取 `AGENTS.md`、[PA Product North Star](../../product/pa-product-north-star.md) 和本 handoff。
2. 读取 [Discovery Brief](./insight-enhancement-layer.md) 的 Candidate Requirements（B-119/REQ-01 到 REQ-06）和 Key Design Decisions（D1-D8）。
3. 先运行基线检查：`git status --short --branch`、`npm test -- --runInBand`、`npx tsc -noEmit -skipLibCheck`。确保 baseline 健康后再开始。
4. 按 Phase 1 → 2 → 3 → 4 → 5 顺序开发。每个 Phase 完成后运行该 Phase 的验证门，确认通过再进入下一个。
5. 遇到本文 §5 中标为 `PRODUCT GATE` 的部分，停下记录 `BLOCKED`，不得自行决定。
6. 本 handoff **不授权** commit、push、tag、publish。代码修改完成后等待用户 review。若之后获准 commit，使用 signed Conventional Commits，按模块拆分，不加 `Co-Authored-By`。
7. CSS 只改 `src/custom.pcss`；禁止 runtime `<style>`、`innerHTML` 注入。
8. 不要顺手重构无关模块。

## 1. 设计摘要

在 Pattern Detection、Graph Discovery、Maintenance Review、Statistics 四个纯结构功能上叠加 AI 语义增强层。结构检测始终先行且独立可用，AI 增强是 optional 后处理层。

### 四个特性

| 特性 | 一句话描述 | LLM 调用数 | 触发方式 |
| --- | --- | --- | --- |
| Pattern Detection AI | 对结构模式做语义解读 + 发现隐含语义模式 | 1 次/run | 自动（plugin load + 3 天冷却）|
| Graph Discovery AI | VSS 语义关联 + 结构 item 深化（矛盾/叙事/草稿） | 1 次/run | 用户命令 |
| Maintenance Review AI | 智能标题/语义链接/智能分类 | 1 次/run | 用户命令 |
| Writing Insight | 写作趋势洞察（笔记导向 evidence） | 1 次/run | 自动（7 天冷却）|

### 设计决策

| ID | 决策 |
| --- | --- |
| D1 | 后处理增强，非替换——LLM 失败时 structural-only 结果独立可用 |
| D2 | `invokeModel` 轻量回调注入，非完整 PageletReviewModel |
| D3 | 独立 RateLimiter + 共享 CostTracker |
| D4 | 默认开启 + 首次 Notice（列出全部 4 项能力） |
| D5 | Writing Insight 每条洞察必须引用具体笔记 |
| D6 | 前 3 个特性叠加现有 UI；Writing Insight 新增 Tab section |
| D7 | Enhancement 集成点在 plugin 层，非 orchestrator |
| D8 | AI 发现 item 有数量上限：semanticPatterns ≤ 3、VSS items ≤ 5 |

## 2. 参考模式

### 2.1 `invokeModel` 回调模式

**参考文件**: `src/quick-capture-enrichment.ts:46,265`

```typescript
// 接口定义（:46）
invokeModel(prompt: string): Promise<string | null>;

// 调用方式（:265）
const response = await options.invokeModel(buildQuickCaptureEnrichmentPrompt(input));
```

**要点**: enhancer 函数不直接导入 LangChain 或 AIUtils。它通过注入的 `invokeModel` 回调发送 prompt、接收原始文本。prompt 构建和 response 解析在 enhancer 内部完成。

**在 plugin 层组装回调**: 参考 `src/plugin.ts` 中 Quick Capture Enrichment 的 `invokeModel` 实现模式——plugin 持有 AIUtils 和 model factory，将 LLM 调用封装为 `(prompt) => model.invoke(prompt)` 的简单回调传入 enhancer。

### 2.2 `PageletRateLimiter` 独立实例化

**参考文件**: `src/pagelet/pa-review-rate-limit.ts:169`

```typescript
export class PageletRateLimiter {
    constructor(config, storage, options?) { ... }
}
```

**要点**: 构造函数接受 `config: { hourlyCap, dailyCap }`、`storage: PageletRateLimitStorage`、可选 `options: { coordinationKey?, now? }`。每个 feature 创建独立实例，用不同 `coordinationKey` 隔离。B-119 创建一个 `coordinationKey: "insight-enhancement"` 的实例，caps 为 `hourlyCap: 5, dailyCap: 20`。

### 2.3 `PageletCostTracker` 共享使用

**参考文件**: `src/pagelet/pa-review-cost.ts:408,357`

```typescript
export class PageletCostTracker { ... }  // :408

// feature 字段的封闭联合类型（:357）——必须扩展
feature?: "foreground-review" | "background-review" | "scope-recap" | "quiet-recall";
```

**要点**: 所有 pagelet LLM 调用共享同一个 `PageletCostTracker` 实例。B-119 调用 `tracker.record(usage)` 时传 `feature: "insight-enhancement"`。**必须先将 `"insight-enhancement"` 加入 :357 的联合类型，否则编译失败。**

### 2.4 Prompt builder 返回格式

**参考文件**: `src/pagelet/llm/types.ts:44`

```typescript
export interface PromptBuildResult {
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
}
```

**参考文件**: `src/pagelet/llm/prompts.ts:28,38,53,82`
- `truncateToTokenBudget()` (:28) — 未导出，需在 insight-enhancement 模块重新实现
- `distributeNotesBudget()` (:38) — 分配 token 预算到多笔记
- `formatNotes()` (:53) — `--- path ---\ncontent` 格式
- `SYSTEM_PROMPT_BASE` (:82) — 角色定义 + JSON-only + 语言匹配规则

### 2.5 PageletHost optional 方法模式

**参考文件**: `src/pagelet/PageletHost.ts:166,266,275,299`

现有 optional 方法示例：
```typescript
getMemoryPreparationStatus?(): { ... } | null;    // :166
generateRecapInsights?(input: { ... }): Promise<RecapLlmInsight[] | null>;  // :266
isQuietRecallRunCurrent?(result: QuietRecallRunResult): boolean;  // :275
getMemoryGovernancePanelState?(): PanelMemoryGovernanceState;  // :299
```

**要点**: 用 `?()` 语法声明 optional。orchestrator/caller 使用 `if (this.host.enhanceXxx) { ... }` 模式调用。

### 2.6 Tab section 注册模式

**参考文件**:
- `src/pagelet/tab/sections/types.ts:15` — `TabSectionRenderer` 接口
- `src/pagelet/tab/sections/MaintenanceReviewSection.ts:16` — 实现示例
- `src/pagelet/tab/sections/QuietRecallSection.ts:37` — 实现示例
- `src/pagelet/tab/types.ts:64-71` — `TabEntryReason` 联合类型
- `src/pagelet/tab/TabView.ts:82-87` — `ENTRY_REASON_TO_PRIMARY_SECTION` 映射

Writing Insight 新增 section 需要：
1. 创建 `src/pagelet/tab/sections/WritingInsightSection.ts` 实现 `TabSectionRenderer`
2. 在 `TabEntryReason` 联合类型添加 `"writing-insight"`
3. 在 `ENTRY_REASON_TO_PRIMARY_SECTION` 添加映射
4. 在 `PageletDetailExtra`（`src/pagelet/tab/types.ts`）添加 `writingInsight?` 字段

### 2.7 Plugin 层集成点

**Pattern Detection 增强位置**: `src/plugin.ts:3231-3237`
```
// 现有流程：
3231:  const result = await this.detectCrossNotePatternsForPagelet(now);
       // ... 校验 ...
3237:  this.pageletOrchestrator?.setPatternDetectionNudge(result);
// 增强插入点：在 3231 之后、3237 之前调用 enhancePatternDetection()
// 注意：笔记内容在 collectPatternDetectionNotes() (3268 起) 中已读取，
//       但 PatternDetectionResult 不保留内容。需要保留 notes 变量传入 enhancer。
```

**Graph Discovery 增强位置**: `src/plugin.ts:2737`
```
// 现有流程：plugin.runGraphDiscovery() 调用 discoverLightweightGraphItems()
// 增强插入点：在结构检测返回后、传给 orchestrator 前调用 enhanceGraphDiscovery()
```

**Maintenance Review 增强位置**: `src/plugin.ts:2637`
```
// 现有流程：plugin.runMaintenanceReview() 调用 scanMaintenanceReview()
// 增强插入点：在 scan 返回后、返回给 caller 前调用 enhanceMaintenanceReview()
```

### 2.8 测试模式

**参考测试文件**:
- `__tests__/pattern-detection.test.ts` — 结构检测测试（验证新 optional 字段不破坏既有测试）
- `__tests__/graph-discovery.test.ts` — 同上
- `__tests__/maintenance-review.test.ts` — 同上
- `__tests__/quick-capture-enrichment.test.ts` — **最重要参考**：展示如何 mock `invokeModel`、测试 happy/empty/error path

Enhancer 测试要点：
- Mock `invokeModel` 返回预设 JSON 字符串
- 验证 `InsightEnhancementResult` 的 status 分支（ok / empty / skipped / error）
- 验证 `skipped` 在 disabled/budget-exhausted/no-structural-input 时触发
- 验证 AI 字段在 LLM 返回 null 时不出现（graceful fallback）

## 3. 已知实现障碍

### 3.1 必须修复（编译或功能阻塞）

| # | 障碍 | 位置 | 修复指令 |
| --- | --- | --- | --- |
| I-1 | `PageletCostEntry["feature"]` 不含 `"insight-enhancement"` | `src/pagelet/pa-review-cost.ts:357` | 在联合类型末尾添加 `\| "insight-enhancement"` |
| I-2 | `truncateToTokenBudget()` 未导出 | `src/pagelet/llm/prompts.ts:28` | 在 `src/pa/insight-enhancement/prompts.ts` 中独立实现相同逻辑（`text.slice(0, tokenBudget * 4) + "\n[...truncated]"`），不修改原模块 |
| I-3 | Pattern Detection 笔记内容在 result 中不可用 | `src/plugin.ts:3231` | 修改 `maybeRunPatternDetectionNudge()` 保留 `notes` 变量，传入 enhancer |
| I-4 | PageletHost 无 Stats 访问 | `src/pagelet/PageletHost.ts` | `generateWritingInsights?()` host 方法内部从 plugin 访问 `statsManager.getDashboardData()`，不需要暴露 Stats 到 PageletHost |

### 3.2 需要处理（运行时风险）

| # | 障碍 | 位置 | 处理方式 |
| --- | --- | --- | --- |
| W-1 | `hasForbiddenPersistedTextFields()` 会扫描 AI 字段 | `src/pa/maintenance-review.ts:405` | AI 字段（`aiSuggestedTitle` 等）加入 `MaintenanceProposal` 时标记为 `@internal`，或在校验前将 AI 字段从 proposal 副本中剥离 |
| W-2 | `findRelatedNotes()` 是单笔记 API | `src/pagelet/PageletHost.ts:192` | Graph Discovery enhancer 限制每次最多 3 次 VSS 调用，取 score 最高的核心笔记 |
| W-3 | VSS 可能未就绪 | `src/pagelet/PageletHost.ts:199` | Graph Discovery enhancer 前置调用 `isMemoryReadyForPageletDiscovery()`，未就绪时跳过 VSS 发现（仅增强已有 item） |
| W-4 | 无 AbortSignal | — | `InsightEnhancementOptions` 包含 `abortSignal?: AbortSignal`；enhancer 在 LLM 调用前检查 `signal.aborted` |
| W-5 | 并发 enhancement 调用 | — | 在 plugin 层用 `inFlightEnhancement: Promise | null` flag 防止并发；后到的请求等待前一个完成 |
| W-6 | AI 发现 item 与结构 item 排序 | — | 结构 item 在前，AI item 追加在后（`[...structuralItems, ...aiItems]`） |
| W-7 | 首次 Notice 文案 | — | `PRODUCT GATE`——文案需用户审批后填入 |

## 4. 分阶段开发任务

### Phase 1: 类型基础 + Graph Discovery Enhancer

**创建文件**:

| 文件路径 | 内容 |
| --- | --- |
| `src/pa/insight-enhancement/types.ts` | `InsightEnhancementResult<T>` 联合类型、`InsightEnhancementDiagnostics` 接口、`InsightModelCallback` 类型、`InsightEnhancementOptions` 接口（含 `abortSignal?`） |
| `src/pa/insight-enhancement/prompts.ts` | `buildGraphEnhancementPrompt()` 返回 `PromptBuildResult`；独立实现 `truncateToTokenBudget()`、`formatNotes()` |
| `src/pa/insight-enhancement/graph-discovery-enhancer.ts` | `enhanceGraphDiscovery()` 函数 |
| `src/pa/insight-enhancement/index.ts` | Re-export types 和 enhancer |
| `__tests__/insight-enhancement-graph-discovery.test.ts` | Graph Discovery enhancer 测试 |

**修改文件**:

| 文件 | 修改 |
| --- | --- |
| `src/pagelet/pa-review-cost.ts:357` | `feature?` 联合类型添加 `\| "insight-enhancement"` |
| `src/pa/graph-discovery.ts` | `GraphDiscoveryItem` 添加 `semanticClaim?: string`；`GraphDiscoveryRunResult` 添加 `aiEnhanced?: boolean` |
| `src/pagelet/PageletHost.ts` | 添加 `enhanceGraphDiscovery?(result: GraphDiscoveryRunResult): Promise<GraphDiscoveryRunResult>` |
| `src/plugin.ts:2737` | `runGraphDiscovery()` 中调用结构检测后，调用 `enhanceGraphDiscovery`（如果 host 方法存在） |
| `src/settings.ts` | 添加 `insightEnhancement` settings group |

**验收标准 (AC)**:
- AC-1: `enhanceGraphDiscovery()` 在 mock invokeModel 返回有效 JSON 时，输出 `status: "ok"` 且结果包含 `semanticClaim` 和/或新 item
- AC-2: invokeModel 返回 null 时，输出 `status: "error"` 且原始结构结果不受影响
- AC-3: settings `insightEnhancement.enabled = false` 时，输出 `status: "skipped"` + `reason: "disabled"`
- AC-4: RateLimiter 配额耗尽时，输出 `status: "skipped"` + `reason: "budget_exhausted"`
- AC-5: AI 发现的新 item 最多 5 条，追加在结构 item 之后

**验证门**:
```bash
npm test -- --runInBand __tests__/insight-enhancement-graph-discovery.test.ts __tests__/graph-discovery.test.ts
npx tsc -noEmit -skipLibCheck
git diff --check
```

### Phase 2: Pattern Detection Enhancer

**创建文件**:

| 文件路径 | 内容 |
| --- | --- |
| `src/pa/insight-enhancement/pattern-detection-enhancer.ts` | `enhancePatternDetection()` 函数 |
| `__tests__/insight-enhancement-pattern-detection.test.ts` | 测试 |

**修改文件**:

| 文件 | 修改 |
| --- | --- |
| `src/pa/insight-enhancement/prompts.ts` | 添加 `buildPatternEnhancementPrompt()` |
| `src/pa/insight-enhancement/index.ts` | 添加 re-export |
| `src/pa/pattern-detection.ts` | `CrossNotePattern` 添加 `semanticInsight?: string`；`PatternDetectionResult` 添加 `semanticPatterns?: CrossNotePattern[]`、`aiEnhanced?: boolean` |
| `src/pagelet/PageletHost.ts` | 添加 `enhancePatternDetection?(result: PatternDetectionResult): Promise<PatternDetectionResult>` |
| `src/plugin.ts:3220-3237` | `maybeRunPatternDetectionNudge()` 中保留 notes 变量，在 `setPatternDetectionNudge` 之前调用 enhancer |

**验收标准**:
- AC-6: `semanticInsight` 为每个结构模式提供一句话语义解读
- AC-7: `semanticPatterns` 最多 3 条，每条至少 2 个 sourceRefs
- AC-8: 现有 `__tests__/pattern-detection.test.ts` 不受影响（optional 字段）

**验证门**:
```bash
npm test -- --runInBand __tests__/insight-enhancement-pattern-detection.test.ts __tests__/pattern-detection.test.ts
npx tsc -noEmit -skipLibCheck
```

### Phase 3: Maintenance Review Enhancer

**创建文件**:

| 文件路径 | 内容 |
| --- | --- |
| `src/pa/insight-enhancement/maintenance-review-enhancer.ts` | `enhanceMaintenanceReview()` 函数 |
| `__tests__/insight-enhancement-maintenance-review.test.ts` | 测试 |

**修改文件**:

| 文件 | 修改 |
| --- | --- |
| `src/pa/insight-enhancement/prompts.ts` | 添加 `buildMaintenanceEnhancementPrompt()` |
| `src/pa/insight-enhancement/index.ts` | 添加 re-export |
| `src/pa/maintenance-review.ts` | `MaintenanceProposal` 添加 `aiSuggestedTitle?: string`、`aiSuggestedFolder?: string`、`aiClaim?: string`；`MaintenanceReviewRunResult` 添加 `aiEnhanced?: boolean`。注意 W-1：处理 `hasForbiddenPersistedTextFields()` |
| `src/pagelet/PageletHost.ts` | 添加 `enhanceMaintenanceReview?(result: MaintenanceReviewRunResult): Promise<MaintenanceReviewRunResult>` |
| `src/plugin.ts:2637` | `runMaintenanceReview()` 中调用 enhancer |

**验收标准**:
- AC-9: `aiSuggestedTitle` 作为替代选项呈现，不替换 `preview.oldTitle`/`preview.newTitle`
- AC-10: `hasForbiddenPersistedTextFields()` 不误拒 AI 增强的 proposal
- AC-11: 现有 `__tests__/maintenance-review.test.ts` 不受影响

**验证门**:
```bash
npm test -- --runInBand __tests__/insight-enhancement-maintenance-review.test.ts __tests__/maintenance-review.test.ts __tests__/maintenance-review-apply.test.ts
npx tsc -noEmit -skipLibCheck
```

### Phase 4: Writing Insight

**创建文件**:

| 文件路径 | 内容 |
| --- | --- |
| `src/pa/insight-enhancement/writing-insight.ts` | `WritingInsight`、`WritingInsightResult` 类型；`generateWritingInsights()` 函数 |
| `src/pagelet/tab/sections/WritingInsightSection.ts` | 实现 `TabSectionRenderer` |
| `__tests__/insight-enhancement-writing-insight.test.ts` | 测试 |

**修改文件**:

| 文件 | 修改 |
| --- | --- |
| `src/pa/insight-enhancement/prompts.ts` | 添加 `buildWritingInsightPrompt()` |
| `src/pa/insight-enhancement/index.ts` | 添加 re-export |
| `src/pagelet/tab/types.ts:64` | `TabEntryReason` 添加 `"writing-insight"` |
| `src/pagelet/tab/types.ts` | `PageletDetailExtra` 添加 `writingInsight?: WritingInsightResult` |
| `src/pagelet/tab/TabView.ts:82` | `ENTRY_REASON_TO_PRIMARY_SECTION` 添加 `"writing-insight": "writing-insight"` |
| `src/pagelet/tab/TabView.ts` | 注册 `WritingInsightSection` 到 section 列表 |
| `src/pagelet/PageletHost.ts` | 添加 `generateWritingInsights?(): Promise<WritingInsightResult \| null>` |
| `src/plugin.ts` | 实现 host 方法：从 `statsManager.getDashboardData()` + 近期笔记元数据组装输入 |
| `src/settings.ts` | 添加 `lastWritingInsightAt?: string` 设置项（7 天冷却） |

**验收标准**:
- AC-12: 每条 `WritingInsight.evidence` 引用具体笔记标题/路径
- AC-13: 每次运行替换上一次结果，不累积
- AC-14: 7 天冷却期内不触发
- AC-15: Writing Insight section 正确渲染在 Tab 中

**验证门**:
```bash
npm test -- --runInBand __tests__/insight-enhancement-writing-insight.test.ts
npx tsc -noEmit -skipLibCheck
```

### Phase 5: 特性联动 + 首次 Notice + 端到端验收

**修改文件**:

| 文件 | 修改 |
| --- | --- |
| `src/pa/insight-enhancement/graph-discovery-enhancer.ts` | 接受可选 `patternDetectionResult?` 上下文参数 |
| `src/pa/insight-enhancement/maintenance-review-enhancer.ts` | 接受可选 `graphDiscoveryResult?` 上下文参数 |
| `src/plugin.ts` | 首次 Notice 逻辑：检查 `settings.pagelet.insightEnhancement.firstUseNotified`，首次触发任何 enhancement 时弹 `Notice`（`PRODUCT GATE`——文案需用户审批） |

**验收标准**:
- AC-16: Graph Discovery enhancer 使用 Pattern Detection 结果去重
- AC-17: Maintenance Review enhancer 使用 Graph Discovery 结果丰富链接建议
- AC-18: 首次 Notice 只弹一次，`firstUseNotified` 持久化

**验证门（全链路）**:
```bash
npm test -- --runInBand
npm run lint
npm run build
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
make deploy
```

## 5. 产品止步线

以下内容 Codex **不得自行决定**，必须标记 `BLOCKED` 等待用户/产品批准：

| ID | 内容 | 原因 |
| --- | --- | --- |
| `PRODUCT GATE 1` | 首次 Notice 的具体文案 | 文案面向用户，需要产品审批 |
| `PRODUCT GATE 2` | Writing Insight section 的视觉设计细节（卡片布局、颜色、图标） | UI 设计需用户确认 |
| `PRODUCT GATE 3` | Writing Insight 的 evidence 格式（如何引用笔记——inline link / bullet list / card） | 产品呈现决策 |
| `PRODUCT GATE 4` | AI Enhancement settings 在 Settings UI 中的位置和分组 | Settings IA 决策 |

## 6. 验证门

### 6.1 每个 Phase 完成后

```bash
npm test -- --runInBand <phase-specific-test-suites>
npx tsc -noEmit -skipLibCheck
git diff --check
```

### 6.2 全部 Phase 完成后

```bash
npm test -- --runInBand
npm run lint
npm run build
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
make deploy
```

### 6.3 Obsidian smoke（需用户执行）

- `make deploy` 后在 Obsidian test vault 中：
  - 手动触发 Graph Discovery 命令，确认 AI 增强结果出现（如 AI 已配置）
  - 手动触发 Maintenance Review 命令，确认 AI 增强字段渲染
  - 等待 Pattern Detection 自动触发或手动缩短冷却周期测试
  - 确认 Writing Insight section 在 Tab 中渲染
  - 确认首次 Notice 弹出且只弹一次
  - 关闭 `insightEnhancement.enabled` 后确认所有 AI 增强不触发

## 7. 文件变更清单

### 新建文件（8 个）

```
src/pa/insight-enhancement/types.ts
src/pa/insight-enhancement/prompts.ts
src/pa/insight-enhancement/graph-discovery-enhancer.ts
src/pa/insight-enhancement/pattern-detection-enhancer.ts
src/pa/insight-enhancement/maintenance-review-enhancer.ts
src/pa/insight-enhancement/writing-insight.ts
src/pa/insight-enhancement/index.ts
src/pagelet/tab/sections/WritingInsightSection.ts
```

### 新建测试（4 个）

```
__tests__/insight-enhancement-graph-discovery.test.ts
__tests__/insight-enhancement-pattern-detection.test.ts
__tests__/insight-enhancement-maintenance-review.test.ts
__tests__/insight-enhancement-writing-insight.test.ts
```

### 修改文件（8 个）

```
src/pagelet/pa-review-cost.ts          — feature 联合类型扩展
src/pa/graph-discovery.ts              — optional AI 字段
src/pa/pattern-detection.ts            — optional AI 字段
src/pa/maintenance-review.ts           — optional AI 字段 + hasForbiddenPersistedTextFields 适配
src/pagelet/PageletHost.ts             — 4 个 optional enhancement 方法
src/pagelet/tab/types.ts               — TabEntryReason + PageletDetailExtra 扩展
src/pagelet/tab/TabView.ts             — section 注册 + entry reason 映射
src/plugin.ts                          — 4 个 host 方法实现 + 集成点 + Notice + RateLimiter
src/settings.ts                        — insightEnhancement settings group
```

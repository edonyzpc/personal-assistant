# SDD: RequiredCapabilityClassification 重构简化

**Status:** Accepted design record
**Phase:** 3.6

---

## 1. Context

`pa-agent-required-capability-policy.ts`（582 行）实现 RequiredCapability 分类与运行时执行策略，是 PA Agent 控制循环的关键组件。当前实现存在以下问题：

### 1.1 类型层冗余
当前导出 10 个类型/接口：
- `RequiredCapability`（联合类型，3 值）
- `RequiredCapabilityLevel`（"required" | "suggested" | "ignore"）
- `RequiredCapabilityClassificationItem`
- `RequiredCapabilityClassification`
- `RequiredCapabilityHostPolicyOptions`
- `RequiredCapabilityHostPolicyResult`
- `RequiredCapabilityRuntimeState`（私有）
- `RequiredCapabilityClassifierInput`
- `RequiredCapabilityClassifier`
- `ResolveRequiredCapabilityClassificationOptions`

类型层叠 + 元数据冗余（`metadata.policyModelAvailable`、`classifierUsed`、`classifierTimedOut`、`fallbackUsed` 中 3/4 仅在内部用，对消费者无价值），增加心智负担。

### 1.2 评分函数重复
`scoreWebSearch` / `scoreMemory` / `scoreCurrentNote`（line 532-576）三个几乎相同的函数：
- 强信号正则 + 弱信号正则
- 阈值 0.9 / 0.65
- 都用 `\b` 词边界（**对中文无效** — `\b` 匹配 ASCII 边界，CJK 字符之间没有词边界）
- 用户已确认：中文输入下分类失效是当前已知 bug

### 1.3 状态机晦涩
`RequiredCapabilityRuntimeState`（line 51-59）有 6 个互相耦合的字段：
- `correctiveAttempted: boolean`
- `failedRequiredToolRetryAttempted: boolean`
- `usedCapabilities: Set<RequiredCapability>`
- `required` / `suggested` / `availableCapabilities`

`decideAfterTurn`（line 272-365）94 行嵌套条件，依赖两个 boolean flag 的组合判定阶段，难以单测，难以推理。

### 1.4 双路径归一化逻辑分散
`addItem`（line 513）和 `normalizeClassifierItem`（line 231）实现的"confidence → level"逻辑完全相同（≥0.75 = required, ≥0.45 = suggested, < = ignore），但分别写两次。

### 1.5 LLM 分类器路径冗余
`resolveRequiredCapabilityClassification` 在 LLM 分类器返回后调 `withClassificationMetadata`（line 262）覆盖 metadata，逻辑分散在两处。

---

## 2. Goals

1. **类型扁平化** — 10 个类型 → 4 个核心类型（含 `RequiredCapability`）
2. **score 函数统一** — 3 个重复函数 → 1 个参数化 `scoreCapability(text, table)`
3. **CJK 支持** — 双语关键词表（en regex + zh `text.includes()`），中文输入正确分类
4. **状态机简化** — 6 个布尔/集合字段 → 4 阶段 `phase` 判别（更易单测）
5. **元数据精简** — 移除无消费者的 metadata 字段
6. **零行为变更（除 CJK 修复）** — 现有英文输入分类结果不退化

## Non-goals

- 不改 `RequiredCapability` 联合类型的 3 个值
- 不改外部消费者 API 契约（`createRequiredCapabilityHostPolicy` 签名保持兼容）
- 不重写 LLM 分类器路径（仅简化归一化）
- 不动 `pa-agent-answer-completion-policy.ts` 内部逻辑（仅作为依赖调用）

---

## 3. 现有消费者审计

| 文件 | 引入符号 | 用途 |
|------|--------|------|
| `pa-agent-runtime.ts` | `createRequiredCapabilityHostPolicy`、`resolveRequiredCapabilityClassification`、`RequiredCapability`、`RequiredCapabilityClassification`、`getExplicitlySuppressedRequiredCapabilities`、`isExplicitCurrentNoteOnlyRequest`、`shouldUseFullCurrentNoteContext` | host policy 创建 / classification 解析 / 抑制项处理 |
| `chat-tool-prepare-helpers.ts` | （定义）`isExplicitCurrentNoteOnlyRequest`、`shouldUseFullCurrentNoteContext` | 实际定义在此，policy 文件 re-export |
| `__tests__/pa-agent-required-capability-policy.test.ts` | 测试全套 | 行为回归基线 |

**保留的外部入口**（签名保持可导入，但语义按本 SDD 收敛）：
- ✅ `RequiredCapability` type
- ✅ `RequiredCapabilityClassification` interface（`items` 数组）
- ✅ `RequiredCapabilityClassifier` 接口（`pa-agent-runtime.ts` 注入 LLM 分类器实现）
- ✅ `createRequiredCapabilityHostPolicy(options)` 签名
- ✅ `resolveRequiredCapabilityClassification(options)` 签名
- ✅ `classifyRequiredCapabilitiesDeterministic(userInput)` 签名
- ✅ `getExplicitlySuppressedRequiredCapabilities(text)` 签名
- ✅ `REQUIRED_CAPABILITY_CLASSIFIER_TIMEOUT_MS` 常量
- ✅ re-export `isExplicitCurrentNoteOnlyRequest` / `shouldUseFullCurrentNoteContext`

**Breaking cleanup（已确认采用方案 B）：**

> `ignore` level 和 `classification.metadata.*` 字段不保留旧形状，直接按新 schema 清理。仍留在代码中的 type-only alias 只服务旧 import 路径，类型内容已经是新形状，不承诺兼容旧数据字段或旧 union arm。

- ❌ `RequiredCapabilityLevel` type 的旧 `"ignore"` arm（直接移除；低置信项不进入 `items`）
- ❌ `RequiredCapabilityHostPolicyOptions` / `RequiredCapabilityHostPolicyResult` 作为推荐写法（保留 alias 但新代码 inline）
- ❌ `RequiredCapabilityClassifierInput` 接口作为推荐写法（保留 alias 但新代码使用 inline `{ userInput: string; signal?: AbortSignal }`）
- ❌ `metadata.policyModelAvailable` / `classifierUsed` / `classifierTimedOut` / `fallbackUsed`（直接移除）

**RequiredCapabilityClassifier 调整说明:** 之前列在"可移除"是误判 —— `pa-agent-runtime.ts` 的 LLM 分类器实例需要这个接口契约（duck typing 不够，因为有 `classify(input): Promise<unknown>` 的具体形状）。保留为公开 API，只是把 `RequiredCapabilityClassifierInput` 转为 inline `{ userInput: string; signal?: AbortSignal }`。

---

## 4. Spec — 新类型设计

### 4.1 简化的类型层

```typescript
// === 核心类型（公开） ===

export const REQUIRED_CAPABILITY_CLASSIFIER_TIMEOUT_MS = 800;

export type RequiredCapability =
    | "search_memory"
    | "webSearch"
    | "get_current_note_context";

export interface RequiredCapabilityClassificationItem {
    capability: RequiredCapability;
    confidence: number;        // 0..1
    reason: string;
    level: "required" | "suggested";  // "ignore" 改为不入数组
}

export interface RequiredCapabilityClassification {
    items: RequiredCapabilityClassificationItem[];
    // metadata 移除
}

// === 私有类型 ===

interface CapabilityRuntimePhase {
    kind:
        | "awaiting_initial_tools"      // 还未到 corrective
        | "corrective_issued"           // corrective_turn 已发，等待重试
        | "failed_retry_issued"         // 失败重试已发
        | "terminal";                   // stop 决策已下
}

interface RuntimeState {
    classification: RequiredCapabilityClassification;
    availableCapabilities: ReadonlySet<RequiredCapability>;
    usedCapabilities: Set<RequiredCapability>;
    phase: CapabilityRuntimePhase;
    answerCompletionLedger: AnswerCompletionLedger;
}

interface CapabilitySignalTable {
    capability: RequiredCapability;
    /** 强信号 — 命中任意一个 → confidence 0.9 */
    strong: { regex: RegExp[]; chineseTokens: string[] };
    /** 弱信号 — 命中任意一个 → confidence 0.65 */
    weak: { regex: RegExp[]; chineseTokens: string[] };
}
```

**关键变化:**
- `RequiredCapabilityLevel` 删除（直接 inline 联合类型）
- `RuntimeState.phase` 替代 `correctiveAttempted` + `failedRequiredToolRetryAttempted` 双 boolean
- `metadata` 字段从 `RequiredCapabilityClassification` 完全移除
- `CapabilitySignalTable` 是新的统一评分配置

### 4.2 统一评分函数

```typescript
const CAPABILITY_SIGNALS: CapabilitySignalTable[] = [
    {
        capability: "webSearch",
        strong: {
            regex: [
                /\b(search the web|look online|official site|web search)\b/,
                /\bcurrent (news|events|price|version|status|weather|release|information|info|situation)\b/,
                /\b(latest|today's|this week's) (news|version|release|update)\b/,
            ],
            // 收紧：只保留高度专属于"网络/外部最新"的 token，移除"最新/今天/当前"等
            // 通用副词（在中文里可指笔记/项目/任务等任意领域，会误命中）
            chineseTokens: ["搜索网", "网上查", "网络搜索", "在线查", "上网查", "查一下网"],
        },
        weak: {
            regex: [/\b(recent|may have changed|up to date|newest)\b/],
            // weak 仍保留少量"近期"信号，但避免单字"最新/今天"
            chineseTokens: ["最新版本", "最新动态", "新版本发布"],
        },
    },
    {
        capability: "search_memory",
        strong: {
            regex: [/\b(my notes|my vault|memory|in my notes|from my notes)\b/],
            chineseTokens: ["我的笔记", "笔记库", "我的记忆", "我写过", "我的文档", "我的资料"],
        },
        weak: {
            regex: [/\b(i wrote before|my materials|my docs|my documents)\b/],
            chineseTokens: ["以前写过", "之前记录", "笔记里写"],
        },
    },
    {
        capability: "get_current_note_context",
        strong: {
            regex: [/\b(current note|this note|opened file|active note)\b/],
            chineseTokens: ["当前笔记", "这篇笔记", "打开的文件", "正在编辑"],
        },
        weak: {
            regex: [/\b(this article|the content here|this document|selected text)\b/],
            // 移除"上下文" —— 它在 prompt engineering 语境里是术语，
            // 用户随便说一句"基于上下文"都会误命中；改用更具体的"选中的文字/这一段"
            chineseTokens: ["这篇文章", "这个文档", "选中的文字", "这一段", "光标处"],
        },
    },
];

function scoreCapability(
    text: string,
    table: CapabilitySignalTable,
): { confidence: number; reason: string } | null {
    const lower = text.toLowerCase();
    const strongHit = table.strong.regex.some((r) => r.test(lower))
        || table.strong.chineseTokens.some((t) => text.includes(t));
    if (strongHit) {
        return { confidence: 0.9, reason: `strong ${table.capability} signal` };
    }
    const weakHit = table.weak.regex.some((r) => r.test(lower))
        || table.weak.chineseTokens.some((t) => text.includes(t));
    if (weakHit) {
        return { confidence: 0.65, reason: `weak ${table.capability} signal` };
    }
    return null;
}
```

**注意:**
- ASCII 信号仍走 lowercase regex 路径（保持原行为）
- 中文走 `text.includes()`（对原文本，非 lowercase — 中文无大小写）
- 关键词表集中维护，新增 capability 仅需新增表项

### 4.3 confidence → level 唯一归一化

```typescript
function classifyConfidenceToLevel(
    confidence: number,
): "required" | "suggested" | null {
    if (confidence >= 0.75) return "required";
    if (confidence >= 0.45) return "suggested";
    return null;  // 不入 items
}
```

供 `classifyRequiredCapabilitiesDeterministic` 和 `normalizeClassifierItem` 共用。

### 4.4 CJK 关键词收紧理由

主线决策：宁可漏命中走 LLM 分类器兜底，也不要误命中导致工具滥用。

| 删除/弱化的 token | 理由 |
|------|------|
| `最新` | 通用形容词，"最新的笔记 / 最新的想法 / 最新更新到了哪一段" 都会误命中 webSearch |
| `今天` | "今天写了笔记" / "今天总结一下" 等场景频繁，且无网络搜索意图 |
| `当前` | 太通用，"当前任务 / 当前文件 / 当前阶段" 各方向都会误命中 |
| `最近` | 弱信号都收紧到"最新版本"等具体形态 |
| `上下文` | LLM/prompt 术语，普通用户说"参考上下文回答" 不等于要 get_current_note_context |
| `更新` | 太通用，软件更新 / 笔记更新 / 任务更新 各种意图 |
| `实时` | 边界，"实时翻译"等本地能力不需要 webSearch |

保留原则：必须**包含双字以上的具体复合词**或**强领域绑定的 token**。

### 4.5 状态机简化

```typescript
function decideAfterTurn(
    summary: PaAgentTurnSummary,
    state: RuntimeState,
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    if (state.phase.kind === "terminal") {
        // Use the more semantically explicit `terminal_idempotent` reason to
        // distinguish the no-op re-entry from a fresh `terminal` stop decision.
        return { action: "stop", reason: "terminal_idempotent", status: "completed" };
    }

    const facts = deriveAnswerCompletionTurnFacts(summary);
    recordUsedCapabilities(summary, state.usedCapabilities);
    recordAnswerCompletionTurn(state.answerCompletionLedger, summary, facts);

    const failedRequired = getFailedRequiredCapabilityNames(summary, state);
    if (failedRequired.length > 0) {
        return handleFailedRequired(summary, state, facts, failedRequired);
    }

    const completion = decideAnswerCompletion({ summary, ledger: state.answerCompletionLedger, facts });
    if (completion?.action === "force_finalize") {
        return { action: "continue", reason: "needs_follow_up", ...completion };
    }
    if (completion?.action === "stop_incomplete") {
        state.phase = { kind: "terminal" };
        return { action: "stop", reason: completion.reason, status: "incomplete", diagnostics: completion.diagnostics };
    }

    if (summary.status === "tool_results_ready") {
        return { action: "continue", reason: "tool_results_ready" };
    }

    const missing = computeMissingRequired(state);
    if (missing.available.length > 0 && state.phase.kind === "awaiting_initial_tools") {
        state.phase = { kind: "corrective_issued" };
        return {
            action: "continue",
            reason: "corrective_turn",
            runtimeInstruction: buildCorrectiveInstruction(missing.available),
        };
    }

    if (missing.all.length > 0) {
        state.phase = { kind: "terminal" };
        return buildMissingRequiredDecision(summary, state, "required_capability_missing");
    }

    state.phase = { kind: "terminal" };
    return { action: "stop", reason: summary.status, status: mapTerminalStatus(summary.status) };
}
```

**收益:**
- phase 单一字段表达全部状态，单测可通过 `state.phase.kind` 直接断言
- 子 helper（`handleFailedRequired` / `computeMissingRequired` / `mapTerminalStatus`）拆出，各 ≤20 行
- `decideAfterTurn` 主体从 94 行 → ~40 行

**新旧状态等价表（迁移期对照）:**

| 旧字段组合 | 新 phase.kind | 含义 |
|------|------|------|
| `correctiveAttempted=false`, `failedRequiredToolRetryAttempted=false` | `awaiting_initial_tools` | 还没发过 corrective_turn，可以发 |
| `correctiveAttempted=true`, `failedRequiredToolRetryAttempted=false` | `corrective_issued` | 已发 corrective，等待执行；下一步看缺失情况 |
| `correctiveAttempted=false`, `failedRequiredToolRetryAttempted=true` | `failed_retry_issued` | 失败重试从 initial 直接进入（pre-refactor `decideAfterTurn` line 282 显式约束 `!correctiveAttempted` 才会设 failed retry，因此两个 boolean 互斥） |
| 任何 stop 决策已下发 | `terminal`（实现中带 `from` 标签保留前一阶段，用于 warning metadata 派生两个 boolean） | 不可逆，再次进入 `decideAfterTurn` 直接 stop |

**真正不可达组合:** `correctiveAttempted=true, failedRequiredToolRetryAttempted=true` — pre-refactor 的失败重试路径要求 `!correctiveAttempted`，所以一旦走过 corrective 路径就不能再走 failed retry。新 phase 状态机用 4 个互斥 kind 自然表达此约束。

**实现 vs 本节 spec 的细微偏离（已确认刻意）:** 本节 §4.5 代码片段写的是 `state.phase = { kind: "terminal" }`（无 payload）。实际实现为 `{ kind: "terminal"; from: "initial" | "corrective" | "failed_retry" }`，原因是 `buildMissingRequiredDecision` 仍需输出 `correctiveAttempted` / `failedRequiredToolRetryAttempted` 两个 warning metadata 字段（pre-refactor 的契约），`from` 标签是无信息损失迁移到 phase 单字段的最简方式。等价表新增的"terminal 行"在备注中说明此点。

**前一节等价表的历史修正记录（2026-05-29 PR review 发现）:** 初版 SDD 将 `(correctiveAttempted=true, failedRequiredToolRetryAttempted=true)` 标为可达组合，把 `(correctiveAttempted=false, failedRequiredToolRetryAttempted=true)` 标为不可达不变量。实际查阅 pre-refactor `decideAfterTurn` line 282 的 `if (!state.failedRequiredToolRetryAttempted && !state.correctiveAttempted)` 守卫后确认：两个组合恰好反了。已按上表更正。

### 4.6 LLM 分类器路径精简

```typescript
async function resolveRequiredCapabilityClassification(
    options: ResolveRequiredCapabilityClassificationOptions,
): Promise<RequiredCapabilityClassification> {
    const fallback = applyUserExplicitCapabilityConstraints(
        classifyRequiredCapabilitiesDeterministic(options.userInput),
        options.userInput,
    );
    if (!options.classifier) return fallback;

    const result = await runClassifierWithTimeout(
        options.classifier,
        { userInput: options.userInput, signal: options.signal },
        options.timeoutMs ?? REQUIRED_CAPABILITY_CLASSIFIER_TIMEOUT_MS,
    );
    if (!result || result === "timeout") return fallback;

    const normalized = normalizeClassifierResult(result);
    if (!normalized) return fallback;
    return applyUserExplicitCapabilityConstraints(normalized, options.userInput);
}

function normalizeClassifierResult(result: unknown): RequiredCapabilityClassification | null {
    const parsed = typeof result === "string" ? parseJsonObject(result) : result;
    const items = (parsed as { items?: unknown[] })?.items;
    if (!Array.isArray(items)) return null;
    const normalized = items
        .map(normalizeClassifierItem)
        .filter((item): item is RequiredCapabilityClassificationItem => item !== null);
    return { items: normalized };  // 不再有 metadata
}
```

`withClassificationMetadata` 函数完全删除。

---

## 5. 兼容说明（方案 B breaking cleanup）

旧的 `ignore` level 与 `classification.metadata.*` 字段不提供 deprecation 期；它们是本次重构要删除的冗余 schema。代码中仍保留的 deprecated alias 只用于减少 import churn，内容已经是新形状：

```typescript
/**
 * @deprecated since 2026-05-29 — use literal "required" | "suggested".
 * The former "ignore" arm was intentionally removed.
 */
export type RequiredCapabilityLevel = "required" | "suggested";

/**
 * @deprecated since 2026-05-29 — metadata 字段已移除，传递的 classification 直接生效.
 */
export interface RequiredCapabilityHostPolicyOptions {
    userInput: string;
    availableCapabilities: ReadonlySet<RequiredCapability>;
    classification?: RequiredCapabilityClassification;
}
```

后续如果继续删除 alias，应作为单独清理提交处理；本设计记录不要求恢复旧 schema。

---

## 6. Implementation Steps（4 阶段增量迁移）

### Phase A: 提取测试基线（无代码改动）
1. 跑 `npm test -- --testPathPattern=pa-agent-required-capability-policy`，记录全部用例
2. 新增 CJK 测试用例（应失败 — 验证当前 bug）：
   - 输入"搜索最新的 React 文档" → 期望 webSearch required
   - 输入"我的笔记里有什么相关内容" → 期望 search_memory required
   - 输入"总结当前笔记" → 期望 get_current_note_context required

### Phase B: 内部重构（保持外部 API）
3. 引入 `CapabilitySignalTable` + `CAPABILITY_SIGNALS` 常量
4. 实现 `scoreCapability()`，替换 3 个 `score*` 函数
5. 提取 `classifyConfidenceToLevel()`，`addItem` + `normalizeClassifierItem` 共用
6. 跑测试 — 英文用例应继续通过，CJK 用例应开始通过

### Phase C: 状态机重构
7. 引入 `CapabilityRuntimePhase` 类型
8. 重构 `RuntimeState`，将 `correctiveAttempted` + `failedRequiredToolRetryAttempted` 合并为 `phase`
9. 拆 `decideAfterTurn` 为子函数（`handleFailedRequired` / `computeMissingRequired` / `mapTerminalStatus`）
10. 跑测试 — 全部应通过

### Phase D: 类型层精简 + 测试 fixture 迁移
11. 移除 `metadata` 字段（先在内部不再写入，再删除类型字段）
12. grep 全仓确认无消费者读取 metadata 字段
13. 标记 `RequiredCapabilityLevel` / `RequiredCapabilityHostPolicyOptions` 为 `@deprecated`（含日期注释）
14. 移除 `withClassificationMetadata` 函数
15. **测试 fixture 迁移** —— 全仓 grep 测试文件中构造 `RequiredCapabilityClassification` 的位置（预计 ~10 处，含 `__tests__/pa-agent-runtime.test.ts` / `pa-agent-required-capability-policy.test.ts` / `chat-tools.test.ts` 等）：
    - 移除 `metadata: { policyModelAvailable: ..., classifierUsed: ..., ... }` 字段
    - 用 `level: "required" | "suggested"` 替代裸 `RequiredCapabilityLevel` 类型注解
    - 状态机 fixture 改用 `phase: { kind: "..." }` 替代 `correctiveAttempted` / `failedRequiredToolRetryAttempted` 双布尔
    - 这一步预期触动测试文件较多（~10 处），review diff 时重点看 fixture 改造正确性
16. 跑测试

---

## 7. Test Plan

### 7.1 已有测试（必须全部继续通过）
- 英文输入分类（webSearch / memory / current note 强弱信号各一组）
- 抑制项（"do not use web search" 等）
- LLM 分类器超时 → fallback
- LLM 分类器返回无效 → fallback
- `decideAfterTurn` 状态转换（initial → corrective → terminal）
- Failed required tool retry 路径

### 7.2 新增 CJK 测试（本 SDD 专门修复）

**应触发的：**
- "网上查 React 最新版本" → webSearch required（"网上查"）
- "在线查这个 API 文档" → webSearch required（"在线查"）
- "上网查一下今天的天气" → webSearch required（"上网查"）
- "我的笔记里写过什么相关内容" → search_memory required（"我的笔记"）
- "笔记库里有相关资料吗" → search_memory required（"笔记库"）
- "总结当前笔记" → get_current_note_context required（"当前笔记"）
- "这篇文章在讲什么" → get_current_note_context suggested
- 中英混合："web search for the latest React docs" → webSearch required（英文 strong 命中）

**应 NOT 触发的（避免误命中回归）：**
- "今天写了什么笔记" → 不应 webSearch（"今天" 已从 token 表移除）
- "最新的项目进展" → 不应 webSearch（"最新" 单字已移除）
- "基于上下文给我建议" → 不应 get_current_note_context（"上下文" 已移除）
- "当前任务是什么" → 不应 get_current_note_context（"当前" 单字已移除）
- "更新一下笔记内容" → 不应 webSearch（"更新" 单字已移除）

后一组测试是关键回归保护，验证 §4.4 的 token 收紧确实生效。

### 7.3 状态机单测（新增）
- `state.phase.kind === "awaiting_initial_tools"` 初始状态
- corrective_turn 后 `state.phase.kind === "corrective_issued"`
- 失败重试后 `state.phase.kind === "failed_retry_issued"`
- terminal 决策后 `state.phase.kind === "terminal"`
- terminal 后再调 `decideAfterTurn` 直接返回 stop（idempotent）

### 7.4 集成测试
- 真实对话测中文输入触发正确工具
- LLM 分类器 + deterministic 双路径混合用例

---

## 8. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| metadata / ignore 直接移除破坏未知消费者 | 中 | 已确认采用方案 B；grep 全仓确认仓内无消费者，release notes 标明 breaking cleanup |
| 状态机重构改变行为 | 中 | Phase C 在 Phase B 之后，全部测试通过才进入；§4.5 表格定义新旧等价关系 |
| 中文 token 表覆盖不全 | 低 | 用户实际使用反馈迭代；初版覆盖最高频 6-10 词；LLM 分类器兜底 |
| 中文 token 误命中（漏 vs 误的取舍） | 中 | §4.4 主动收紧通用 token（移除"最新/今天/当前/上下文"），优先漏命中走 LLM；§7.2 加 NOT 触发回归测试 |
| `text.includes()` 误命中 | 低 | 关键词必须双字以上+领域绑定，单字/通用副词全部移除 |
| LLM 分类器路径回归 | 中 | normalize* 函数共享 `classifyConfidenceToLevel`，行为一致 |
| 测试 fixture 迁移漏改（~10 处） | 中 | Phase D 步骤 15 显式 grep + diff review；测试是验收基线 |
| `RequiredCapabilityClassifier` 误删 | 中 | 标记为公开 API 保留，§3 已更正消费者 |
| 4 阶段迁移中间态 | 低 | 每阶段独立 commit，跑测试后再进入下一阶段 |

---

## 9. Verification Checklist

- [ ] `tsc -noEmit -skipLibCheck`
- [ ] `npm test -- --testPathPattern=pa-agent-required-capability-policy`
- [ ] `npm test -- --testPathPattern=pa-agent-runtime`（消费者回归）
- [ ] `npm test`（全量）
- [ ] `npm run build`
- [ ] `grep -rn "policyModelAvailable\|classifierUsed\|classifierTimedOut\|fallbackUsed" src/` 应无业务代码命中
- [ ] 真实 vault 测试中文输入 → 工具触发
- [ ] 真实 vault 测试英文输入 → 行为不退化

---

## 10. Critical Files

- `src/ai-services/pa-agent-required-capability-policy.ts` — 主体重构（582 行 → 预计 ~450 行；估算上调以容纳 deprecated 别名 + 等价表注释 + token 表分组注释）
- `src/ai-services/pa-agent-runtime.ts` — 消费者，需验证不退化
- `src/ai-services/chat-tool-prepare-helpers.ts` — re-export 来源，无改动
- `src/ai-services/pa-agent-answer-completion-policy.ts` — 强耦合依赖，无改动
- `__tests__/pa-agent-required-capability-policy.test.ts` — 增加 CJK 用例 + NOT 触发回归用例
- 所有引用 `RequiredCapabilityClassification` 构造的测试文件（Phase D 步骤 15 grep 后明确，预计 ~10 处）

---

## 11. 工作流程

1. 设计记录定稿并通过 review。
2. 按 Phase A→B→C→D 顺序实施，每阶段保持可独立 review。
3. 完成 TypeScript、Jest、lint/build 与必要的 Obsidian smoke 验证后合入。

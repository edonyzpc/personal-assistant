# SDD: Trivial Cleanups (1.2 / 1.3 / 2.3)

**Status:** Draft, awaiting approval (2026-06-01)
**Phase:** v2 review followup batch 1
**Scope:** 3 mechanical refactors with low cross-impact, bundled into one PR

---

## 1. Context

`docs/v2-fix-plan.md` Phase 1-2 中标记 Open 的 10 项里，下面 3 项性质相同：纯结构性修改，不改变可观察行为，不影响 LLM prompt，不动异步时序。它们之所以仍是 Open，仅仅是因为没人腾出 30 分钟来做。本 SDD 把三者打成一份设计记录、一个 PR：

| 项 | 文件 | 性质 |
|---|---|---|
| 1.2 | `src/plugin.ts:715-731` | O(n×m) → O(n+m) 集合优化 |
| 1.3 | `src/ai-services/pa-agent-host-tools.ts:300-378` | 10 段 if-chain → 查表 |
| 2.3 | `src/ai-services/obsidian-operations-capability-catalog.ts` | 删除未消费字段 + 收紧 validator |

每项单独看都是十几行的改动，但 2.3 在简化幅度上有一个值得讨论的设计选择（详见 §3.3）。

---

## 2. Goals / Non-goals

### Goals

1. 1.2 在大型 vault（2000+ md 文件、20+ 排除路径）下消除 `Array.includes()` 的二次开销
2. 1.3 把 `getReadOnlyToolContextInfo` 从 78 行 if-chain 压缩到 ~30 行查表，新增 tool 时不再需要复制 if 模板
3. 2.3 把 `obsidian-operations-capability-catalog.ts` 359 行精简到 ~190 行，只保留运行时实际消费的数据

### Non-goals

- 不改 `getVSSFiles()` 调用方（不动 `initVss`、`indexAllNotes` 等消费者）
- 不改 `ChatContextUsedItem` 类型（1.3 只换实现，外形不变）
- 不改 `buildObsidianOperationsPlannerGuidance` 签名（2.3 唯一对外 API）
- 不重写 `validateObsidianOperationsCatalog` 的整体策略（删字段而非改逻辑）
- 不动 `OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG` 中各 section 的 `plannerGuidance` 文本

---

## 3. Spec

### 3.1 项 1.2 — `getVSSFiles()` 集合优化

**当前实现**（`src/plugin.ts:715-731`）：

```typescript
getVSSFiles() {
    const files = this.app.vault.getMarkdownFiles();
    const excludePaths = this.settings.vssCacheExcludePath || [];
    const normalizedExcludePaths = excludePaths.map((path) => path.trim()).filter(Boolean);
    const excludeFiles: TFile[] = [];
    for (const file of files) {
        for (const exclude of normalizedExcludePaths) {
            if (file.path.startsWith(exclude)) {
                excludeFiles.push(file);
            }
        }
    }
    const vssFiles = files.filter(file => !excludeFiles.includes(file));
    return vssFiles;
}
```

复杂度：构建 `excludeFiles` 是 O(n×m)；最后 `filter` 里 `excludeFiles.includes(file)` 又是 O(n×k)（k = 命中数）。2000 文件 × 100 排除项 = 20 万次比较 + 命中后再次线性扫描。

**目标实现**：

```typescript
getVSSFiles() {
    const files = this.app.vault.getMarkdownFiles();
    const normalizedExcludePaths = (this.settings.vssCacheExcludePath ?? [])
        .map((path) => path.trim())
        .filter(Boolean);
    if (normalizedExcludePaths.length === 0) return files;
    return files.filter((file) =>
        !normalizedExcludePaths.some((prefix) => file.path.startsWith(prefix))
    );
}
```

复杂度 O(n×m)（不可避免——每个文件需对每个 prefix 测一次），但去掉了中间数组与 `.includes()` 二次扫描；早返回处理空列表的常见场景。预期收益：2000 文件 × 100 排除项从 ~20 万次操作降到 ~10 万次，且 GC 压力（中间数组、push 调用）消失。

**等价性证明**：
- 原版：`file ∈ excludeFiles ⟺ ∃prefix. file.path.startsWith(prefix)` （注意：原版同一文件多前缀命中会重复 push，但 `.includes()` 仍正确判断）
- 新版：`some(prefix => file.path.startsWith(prefix))` 直接表达同一谓词
- 边界：空 `excludePaths` 早返回；全空白前缀被 `filter(Boolean)` 过滤；末尾空项不会误命中

### 3.2 项 1.3 — `getReadOnlyToolContextInfo` 查表

**当前实现**（`src/ai-services/pa-agent-host-tools.ts:300-378`）：10 段 `if (tool === "...") return {...}`，末尾 fallback。

**目标实现**：

```typescript
const READ_ONLY_TOOL_CONTEXT_INFO: Record<string, Pick<ChatContextUsedItem, "category" | "label" | "detail">> = {
    search_memory: {
        category: "memory",
        label: "Selected Memory",
        detail: "Memory search",
    },
    get_current_note_context: {
        category: "current-note",
        label: "Current note",
        detail: "Read-only current note context",
    },
    [BUILTIN_WEB_SEARCH_TOOL_NAME]: {
        category: "read-only-tool",
        label: "WebSearch",
        detail: "External web search",
    },
    search_vault_metadata: {
        category: "vault-metadata",
        label: "Vault metadata",
        detail: "Read-only metadata search results",
    },
    list_recent_notes: {
        category: "recent-notes",
        label: "Recent notes",
        detail: "Read-only recent note list",
    },
    read_note_outline: {
        category: "note-outline",
        label: "Note outline",
        detail: "Read-only note outline",
    },
    inspect_obsidian_note: {
        category: "read-only-tool",
        label: "Note structure",
        detail: "Read-only note structure, links/backlinks, tasks, and properties",
    },
    read_canvas_summary: {
        category: "read-only-tool",
        label: "Canvas structure",
        detail: "Read-only canvas structure",
    },
    search_vault_snippets: {
        category: "read-only-tool",
        label: "Note snippets",
        detail: "Bounded note snippet search results",
    },
    list_vault_tags: {
        category: "read-only-tool",
        label: "Vault tags",
        detail: "Read-only vault tag counts",
    },
};

function getReadOnlyToolContextInfo(
    tool: string,
): Pick<ChatContextUsedItem, "category" | "label" | "detail"> {
    return READ_ONLY_TOOL_CONTEXT_INFO[tool] ?? {
        category: "read-only-tool",
        label: "Read-only tool",
        detail: `${tool} output`,
    };
}
```

**关键点**：
- 计算属性键 `[BUILTIN_WEB_SEARCH_TOOL_NAME]` 保持与原 if-chain 等价（仍是动态值）
- fallback 仍带模板字符串 `${tool}`，必须保留运行时逻辑（不能纯静态查表）
- 表放模块顶层、不放函数体内——避免每次调用重新构造对象

**等价性证明**：每个 tool 名称的查询结果与原 if-chain 完全相同；fallback 路径行为不变。

### 3.3 项 2.3 — 操作 catalog 精简（选项 B：最大简化）

#### 决策依据（实测）

经实测核对，下列三项数据共同支持选最大简化方案：

1. **运行时消费**：`buildObsidianOperationsPlannerGuidance(ids)` 是唯一对外 API，**只读 `plannerGuidance` 字段**。其余 8 个字段全部不被生产代码读取
2. **validator 调用点**：`assertObsidianOperationsCatalogValid()` 仅在 `__tests__/obsidian-operations-capability-catalog.test.ts:15` 被调用，**无任何生产代码路径触发**
3. **validator 抓 bug 历史**：`obsidian-operations-capability-catalog.ts` 自 commit `880ddfe` 引入以来仅有这一次提交，**validator 从未在生产抓到过 catalog 内容偏移**——所有抓 bug 历史都是测试构造的人为输入

`docs/archive/v2-comprehensive-code-review.md` Section 2.6 原话即是 "for a constraint that could be a comment"，明确指向删除 validator。

#### 现状字段消费分析

`obsidian-operations-capability-catalog.ts` 当前每个 section 包含 9 个字段：

```typescript
{
    id, title, summary, plannerGuidance, representativeQueries,
    examples, negativeExamples, forbiddenSemantics, sourceProvenance,
    promptBudgetChars,
}
```

**运行时消费者**（grep 全仓）：
- `buildObsidianOperationsPlannerGuidance` 只读 `plannerGuidance` —— 这是 catalog 唯一对外 API
- `validateObsidianOperationsCatalog` 自查所有字段（dev-time 自检，由测试触发）

**消费者关系**：
| 字段 | 运行时 | 测试 | dev 自检 |
|---|---|---|---|
| `plannerGuidance` | ✅ 唯一外部消费 | ✅ | ✅ |
| `summary` | ❌ | ❌ | ✅ 非空校验 |
| `title` | ❌ | ❌ | ✅ 非空校验 |
| `representativeQueries` | ❌ | ❌ | ✅ 非空 + forbidden 词扫描 |
| `examples` | ❌ | ❌ | ✅ 非空 + forbidden 词扫描 |
| `negativeExamples` | ❌ | ❌ | ✅ 非空校验 |
| `forbiddenSemantics` | ❌ | ✅ 间接（dev 自检） | ✅ 自查机制核心 |
| `sourceProvenance` | ❌ | ❌ | ✅ 非空校验 |
| `promptBudgetChars` | ❌ | ❌ | ✅ guidance 长度上限 |

#### 目标实现

接口压缩到 4 个字段：

```typescript
export type ObsidianOperationsCatalogSectionId =
    | "markdown"
    | "canvas"
    | "cli-target-semantics"
    | "safety";

export interface ObsidianOperationsCatalogSection {
    id: ObsidianOperationsCatalogSectionId;
    title: string;
    summary: string;
    plannerGuidance: string[];
}

export const OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG: readonly ObsidianOperationsCatalogSection[] = [
    {
        id: "markdown",
        title: "Obsidian Markdown Structure",
        summary: "Read bounded Markdown structure facts from active-vault notes.",
        plannerGuidance: [
            "Use Markdown structure for properties, tags, headings, tasks, callouts, wikilinks, embeds, Mermaid fences, footnotes, and short snippets.",
            "Prefer metadata and structure over note body text; never imply that bounded snippets are the full note.",
            "Use link facts for backlinks, outgoing links, unresolved links, and known note paths when the tool provides them.",
        ],
    },
    // ... canvas / cli-target-semantics / safety 同样精简
];

export function getObsidianOperationsCatalogSection(
    id: ObsidianOperationsCatalogSectionId,
): ObsidianOperationsCatalogSection {
    const section = OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG.find((item) => item.id === id);
    if (!section) {
        throw new Error(`Missing Obsidian Operations catalog section: ${id}`);
    }
    return section;
}

export function buildObsidianOperationsPlannerGuidance(
    ids: readonly ObsidianOperationsCatalogSectionId[],
): string[] {
    const guidance: string[] = [];
    for (const id of ids) {
        const section = getObsidianOperationsCatalogSection(id);
        guidance.push(...section.plannerGuidance.map((line) => `[${section.id}] ${line}`));
    }
    return guidance;
}
```

#### 整体删除清单

接口：
- `ObsidianOperationsCatalogExample`
- `ObsidianOperationsNegativeExample`
- `ObsidianOperationsCatalogValidationResult`

字段：
- `representativeQueries` / `examples` / `negativeExamples` / `forbiddenSemantics` / `sourceProvenance` / `promptBudgetChars`

函数：
- `validateObsidianOperationsCatalog`（公开）
- `assertObsidianOperationsCatalogValid`（公开）
- `validateRequiredSections` / `validateSectionShape` / `validateSectionBudget` / `validateForbiddenSemantics` / `isProhibitionLanguage`（私有 helper）

常量：
- `REQUIRED_SECTION_IDS` / `DEFAULT_CATALOG_GUIDANCE_SEPARATOR`

行数估计：359 → ~80（含注释和空行 ~85）。

#### 为什么不需要替代自检

未来给只读工具的 plannerGuidance 误写动作词（如 "delete this note"）的风险由以下兜底：

1. **TypeScript 类型** — `ObsidianOperationsCatalogSection` 字段命名和注释强烈提示 read-only 语义
2. **PR review** — 该文件是低频改动文件（自创建以来 1 个 commit），任何修改都会触发详细 review
3. **运行时强约束** — 即使 plannerGuidance 措辞偏移，下游 `pa-agent-runtime` 的 system prompt 已含 "Do not modify notes, run commands, change settings"（`pa-agent-runtime.ts:1189`）等强约束，LLM 不会因 guidance 措辞而真的执行写操作

如果未来加新 section 的频率上升、需要重新引入自检，可以另行设计——当前没有数据支持保留它。

#### 备选方案记录

设计阶段评估过另外两个选项，作为决策追溯：

- **选项 A（v2-fix-plan 原方案）**：合并 `forbiddenSemantics` 到 `plannerGuidance` 负面指引。问题：合并后 validator 无独立扫描对象，自检实质失效；本质上等价于 B 但实现更绕
- **选项 C**：保留 `forbiddenSemantics` 自检 + 压缩 examples 为 `notes: string[]`。问题：自检从未抓过生产 bug，只是 "以防万一" 保留 ~30 行机制；行数收益 ~190 vs B 的 ~80 相差悬殊

---

## 4. Test Plan

### 1.2

新增 `__tests__/get-vss-files.test.ts`（~30 行）：
- 空 vault 返回空
- 无 excludePaths 返回全部
- 单 prefix 命中：排除以该 prefix 开头的文件
- 多 prefix 命中：取并集
- 空白 / 空字符串 prefix 被忽略
- 末尾 `/` 与无 `/` 的 prefix 行为对齐（startsWith 语义）

mock vault：直接构造 `TFile` 列表对象（`{ path: "..." }` 即可，因 `getVSSFiles` 只读 path）。

### 1.3

无新增测试。`pa-agent-host-tools.test.ts` 现有用例（如有）覆盖了 `chatContextUsedFromToolResult` → `getReadOnlyToolContextInfo` 路径。如果现状没覆盖，新增 1 条断言：未知 tool 名走 fallback 模板。

### 2.3

`__tests__/obsidian-operations-capability-catalog.test.ts` 大幅精简：
- 删除三段 validator 测试（"fails validation when a required section is missing" / "fails validation when guidance exceeds its prompt budget" / "fails validation when forbidden semantics appear outside negative examples"）—— 因为 validator 函数本身被删除
- 保留对 `plannerGuidance` 内容关键词的断言，但断言来源从 `[summary, plannerGuidance, representativeQueries]` 改为 `[summary, plannerGuidance]`
- 删除对 `negativeExamples.map(...)` 的断言（line 42-43, 70, 80-81）—— 因为字段被删
- 保留 `buildObsidianOperationsPlannerGuidance(['markdown', 'safety'])` 的输出验证测试
- 保留 ToolRegistry 不注册 ops tools 的测试（line 130-137，与本次改动无关）

### 全量门禁

- `npx tsc -noEmit -skipLibCheck`
- `npm test -- --runInBand`
- `npm run lint`
- `git diff --check`
- `npm run build`

无 UI 行为变更，无需 Obsidian smoke。

---

## 5. Implementation Steps

1. **2.3 先做**（独立文件，影响最大）
   - 重写 `obsidian-operations-capability-catalog.ts`：精简接口到 4 字段、删除所有 validator 函数与 helper、四个 section 数据只保留 `id` / `title` / `summary` / `plannerGuidance`
   - 重写 `__tests__/obsidian-operations-capability-catalog.test.ts`：删除 3 段 validator 测试、删除 `negativeExamples` / `representativeQueries` 断言、保留内容关键词与 `buildObsidianOperationsPlannerGuidance` 测试
   - 全量 grep 确认无残留 import：`assertObsidianOperationsCatalogValid` / `validateObsidianOperationsCatalog` / `ObsidianOperationsCatalogValidationResult` / `ObsidianOperationsCatalogExample` / `ObsidianOperationsNegativeExample`
   - 跑一次测试确认绿
2. **1.2 再做**（src/plugin.ts 局部）
   - 重写 `getVSSFiles()` 函数体
   - 新增 `__tests__/get-vss-files.test.ts`（如果决定新增）
3. **1.3 最后**（src/ai-services 局部）
   - 在 `pa-agent-host-tools.ts` 顶层新增 `READ_ONLY_TOOL_CONTEXT_INFO` 常量（紧邻 `getReadOnlyToolContextInfo`）
   - 改写函数体为查表 + fallback
   - 跑现有 `pa-agent-host-tools.test.ts` 确认绿
4. 全量验证（§4 门禁全套）

---

## 6. Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| 1.2 边界变化（空 prefix、末尾斜杠）行为漂移 | 低 | 新增针对边界的 unit test 对比新旧实现 |
| 1.3 计算属性键 `BUILTIN_WEB_SEARCH_TOOL_NAME` 求值时机 | 极低 | TypeScript 编译期解析，运行时单次构造模块顶层常量 |
| 2.3 删字段后某外部 plugin/test 仍在读 `representativeQueries` 等已删字段 | 极低 | `obsidian-operations-capability-catalog.ts` 是内部实现，仅 `pa-agent-runtime.ts` 通过 `buildObsidianOperationsPlannerGuidance` 消费；本 PR 内全量 grep 确认无残留 import |
| 2.3 删除 validator 后未来误写动作词进 `plannerGuidance` | 低 | TS 类型提示 + 低频改动 + `pa-agent-runtime.ts:1189` 下游强约束三重兜底；详见 §3.3 "为什么不需要替代自检" |
| 三项打包后 PR 复查负担 | 低 | 三处独立无耦合，PR 描述按 §5 顺序分 commit 提交，便于分段 review |

---

## 7. Critical Files

**修改:**
- `src/plugin.ts` — `getVSSFiles()` 函数体
- `src/ai-services/pa-agent-host-tools.ts` — `READ_ONLY_TOOL_CONTEXT_INFO` 常量 + 简化函数体
- `src/ai-services/obsidian-operations-capability-catalog.ts` — 接口 / section 数据 / validator 同步精简
- `__tests__/obsidian-operations-capability-catalog.test.ts` — 删除 validator 测试段、删除已删字段断言

**新增:**
- `__tests__/get-vss-files.test.ts`（如决定新增针对 1.2 的测试）

**阅读参考（无需改动）:**
- `src/ai-services/pa-agent-runtime.ts` — 确认 `buildObsidianOperationsPlannerGuidance` 唯一消费点
- `src/ai-services/pa-agent-host-tools.ts` 调用方 — 确认 `getReadOnlyToolContextInfo` 不通过反射访问字段

---

## 8. Rollback

每项独立可回滚：

- 1.2：还原 `getVSSFiles()` 一函数
- 1.3：还原 if-chain，删 `READ_ONLY_TOOL_CONTEXT_INFO` 常量
- 2.3：还原 `obsidian-operations-capability-catalog.ts` 接口 + 4 个 section + validator + 测试

由于三项无相互依赖，可以只回滚其中之一而保留另外两项。

---

## 9. Verification Checklist

- [ ] `npx tsc -noEmit -skipLibCheck`
- [ ] `npm test -- --runInBand`
- [ ] `npm run lint`
- [ ] `git diff --check`
- [ ] `npm run build`
- [ ] 抽查 `dist/main.js` 中无残留 `representativeQueries` / `sourceProvenance` 字符串（验证 dead code 真的消失）

---

## 10. Workflow

1. 本 SDD 通过 review 后合并 docs PR
2. 创建 worktree `feat/trivial-cleanups`，按 §5 步骤实施
3. 通过 §9 验证清单后开 PR
4. PR 合并后更新 `docs/v2-fix-plan.md` 的 1.2 / 1.3 / 2.3 状态

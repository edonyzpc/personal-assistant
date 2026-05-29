# SDD: chat-tools.ts 模块拆分

**Status:** Accepted design record
**Phase:** 3.1

---

## 1. Context

`src/ai-services/chat-tools.ts` 当前 3043 行，承载了：类型定义、常量、`ToolRegistry` 类、9 个工具工厂、参数验证、类型守卫、vault 访问/解析/搜索辅助、错误处理。文件过大导致：

- 阅读/导航成本高
- 任何改动都触发整个文件重新评估
- 测试时 mock 边界模糊
- 新工具加入时缺乏明确归属

10 个外部消费文件（含测试）通过 `import { ... } from "./chat-tools"` 引用。

**目标:** 纯结构性重构，**零行为变更**，按职责拆为 6 个子模块 + 一个 barrel re-export，保持所有外部导入路径不变。

---

## 2. Goals

1. 单文件 3043 行 → 6 个子模块（~200-1200 行不等）
2. 零外部消费者改动（barrel 兜底）
3. 显式 DAG 依赖（无循环）
4. 私有 helper 在拆分时谨慎升级为 cross-module export
5. esbuild tree-shake 不受影响

## Non-goals

- 不改任何运行时行为
- 不重命名公开 API
- 不修改类型定义语义
- 不改测试断言

---

## 3. Spec — 模块边界

### 命名约定

延续已有 `chat-tool-prepare-helpers.ts` 模式，子模块统一命名为 `chat-tool-*.ts`。

### Module A: `chat-tool-types.ts` (~384 行)

**职责:** 所有类型/接口/类型守卫/常量（叶子模块，零内部依赖）

**导出:**
- `ChatToolContext` 接口（L28）
- `ChatToolPermission` / `ChatToolCost` / `ChatToolFailureBehavior` / `ChatToolSourceBoundary`（L35-38）
- `OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS`（L40）
- `OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES`（L42）
- `ObsidianOperationsV1AToolName` + `isObsidianOperationsV1AToolName`（L49,51）
- 全部 input/output 接口（`SearchMemoryInput` … `VaultTagsOutput`）
- `ChatToolInputSchemaProperty` / `ChatToolInputSchema` / `ChatToolRegistryDefinition` / `ChatToolProviderSchema`
- `PrepareToolArgumentsContext` / `ChatToolDefinition` / `PrepareAndValidateRepair` / `PrepareAndValidateResult`
- `re-export type { ChatToolName, ChatToolResult } from "./chat-types"`

**注意:** `*Like` 接口（`EditorLike`/`VaultFileLike`/`MarkdownFileLike`/`MarkdownViewLike`/`VaultLike`/`MetadataCacheLike`/`FileCacheLike`，line 359-398）经核查仅 D（`createCurrentNoteContextTool` line 1115）和 E（line 1578-2006）使用，C 不使用——**故归属 E（见 Module E），D 从 E 引入**，避免无谓公开化到顶层 types 模块。

**外部 import:** `PluginManager` from `../plugin`，types from `./chat-types`

---

### Module B: `chat-tool-constants.ts` (~56 行)

**职责:** 所有数字/字符串常量

**导出全部常量:** `CURRENT_NOTE_*`、`VAULT_METADATA_*`、`RECENT_NOTES_*`、`NOTE_OUTLINE_*`、`INSPECT_NOTE_*`、`CANVAS_*`、`SNIPPET_*`、`TAGS_*`、`*_UNAVAILABLE_SOURCE`、`TOOL_VALIDATION_INPUT_SUMMARY_CHARS`

**外部 import:** 无

---

### Module C: `chat-tool-registry.ts` (~297 行)

**职责:** `ToolRegistry` 类、policy assertion、output budget enforcement、schema cloning

**导出:**
- `ToolRegistry`（L480）
- `assertObsidianOperationsV1AToolPolicy`（L597）

**模块私有（保持 private）:**
- `RegisteredChatTool`（L126，原 file 中）
- `toRegistryDefinition`（L629）
- `enforceToolOutputBudget`（L647）
- `fitV1AToolContentToBudget` / `cloneJsonValue` / `markBudgetTruncated` / `incrementOmittedCount`
- `JsonContainer` / `JsonTrimTarget` / `trimLargestJsonPayload` / `findLargestJsonTrimTarget`
- `truncateToExactLength` / `createMinimalBudgetedV1AContent`
- `cloneRegistryDefinition` / `buildPrepareRepairInfo` / `cloneInputSchema`
- 错误处理三件套（从原 L3019-3038 移入此模块）：
  - `getErrorMessage`、`sanitizeToolErrorMessage`、`summarizeInvalidToolInput`

**Import:**
- `./chat-tool-types`、`./chat-tool-constants`
- `./chat-tool-guards` 的 `isChatToolName`（被 `ToolRegistry.get()` 调用）
- `./obsidian-operations-capability-catalog`、`./chat-utils`、`./agent-utils`、`./chat-tool-prepare-helpers`、`./chat-types`

---

### Module D: `chat-tool-factories.ts` (~717 行)

**职责:** 9 个 `create*Tool` 工厂 + `prepare*Arguments` helper + alias 常量

**导出（9 个工厂）:**
- `createSearchMemoryTool`、`createCurrentNoteContextTool`
- `createSearchVaultMetadataTool`、`createListRecentNotesTool`
- `createReadNoteOutlineTool`、`createInspectObsidianNoteTool`
- `createReadCanvasSummaryTool`、`createSearchVaultSnippetsTool`
- `createListVaultTagsTool`

**模块私有:**
- `*_ALIASES` 常量集
- **7 个** prepare helper（核查 chat-tools.ts L917/930/1001/1023/1041/1051/1063）：
  - `prepareSearchMemoryArguments`
  - `prepareCurrentNoteContextArguments`
  - `prepareSearchVaultMetadataArguments`
  - `prepareSearchVaultSnippetsArguments`
  - `prepareReadNoteOutlineArguments`
  - `prepareInspectObsidianNoteArguments`
  - `prepareReadCanvasSummaryArguments`
  - **注:** `list_recent_notes` 与 `list_vault_tags` 没有 prepare 阶段（无 prepareAndValidate hook）
- `normalizeQueryWithOptionalLimit`
- `buildV1APlannerGuidance`（**从原 C 区域 L470 移到此模块**，因为只有工厂函数调用）

**Import:**
- `./chat-tool-types`、`./chat-tool-constants`
- `./chat-tool-execution-helpers`（vault/parse/search helpers + `*Like` 接口）
- `./chat-tool-guards`（validation 函数）
- `./chat-tool-prepare-helpers`（已有 sibling 模块）
- `./obsidian-operations-capability-catalog`、`./chat-utils`、`./chat-types`

---

### Module E: `chat-tool-execution-helpers.ts` (~1232 行)

**职责:** Vault 访问、Markdown/Canvas 解析、metadata 处理、片段搜索、tag 列表 + `*Like` 接口

**导出（大量，原 file-private 升级为 export）:**
- **`*Like` 接口（line 359-398，仅 D 与 E 使用）:** `EditorLike`、`VaultFileLike`、`MarkdownFileLike`、`MarkdownViewLike`、`VaultLike`、`MetadataCacheLike`、`FileCacheLike`
- View/file 查找：`findCurrentMarkdownView`、`isMarkdownViewLike`、`findMarkdownFileByPath`、`findVaultFileByPath`、`isVaultFileLike`、`isMarkdownFileLike`
- Vault I/O：`getVault`、`getMetadataCache`、`getOptionalMetadataCache`、`getMarkdownFiles`、`readVaultFile`、`readVaultFileWithBudget`、`getKnownFileSize`、`canReadVaultFiles`
- 字符串/byte 工具：`getUtf8ByteLength`、`truncateToUtf8ByteLength`、`truncate`
- 路径校验/参数：`validateVaultRelativeTargetPath`、`normalizeLimit`、`limitInputText`
- 元数据查询：`buildMetadataQuerySignals`、`scoreMetadataMatch`、`collectCacheTags`、tag 归一化全套（L2132-2160）
- 笔记结构：`buildNoteStructureSummary`、`extractNoteHeadings`、`parseMarkdownStructure`、`parseWikiTarget`、`parseOriginalWikiTarget`、`extractCacheLinks`、`extractCacheLinkTargets`、`findBacklinksForPath`、`getUnavailableNoteStructureSources`
- Canvas：`buildCanvasStructureSummary`、`createUnavailableCanvasSummary`、`createSkippedCanvasSummary`
- 搜索/聚合：`searchVaultSnippets`、`listVaultTags`、`mergeUnique`、`mergeUniqueLinkTargets`、`takeWithOmitted`
- 大纲：`extractOutlineFromCache`、`extractOutlineFromFile`、`normalizeHeadingLevel`、`applyOutline`
- 编辑器：`extractHeadingsFromEditor`、`getHeadingSectionOrNearbyText`、`getCurrentHeadingSection`、`collectLinesWithinBudget`、`parseHeading`、`getLineCount`、`clampLine`
- 结果工厂：`createToolFailureResult`、`createCurrentNoteResult`、`getFileTitle`、`fileToRecentNote`、`previewFrontmatter`、`normalizeSearchText`
- Frontmatter：`indexFrontmatter`、`renderFrontmatterValue`

**模块私有 type:** `BudgetedVaultRead`、`MetadataQuerySignals`、`ParsedMarkdownStructure`、`CanvasNodeLike`、`CanvasEdgeLike`、`ExtractedOutline`、`CurrentNoteOutline`

**模块私有 helper（不 export，归属此模块）:**
- Canvas 解析：`parseCanvasJson`、`isCanvasNode`、`isCanvasEdge`、`canvasNodeToSnippet`
- Snippet 作用域：`snippetScopeHasReadableMarkdown` 等 4 个作用域 helper（L2707-2736）
- 通用：`findDuplicateValues`
- **总原则:** chat-tools.ts 中现有 file-private 函数若不在 A/B/C/D/F 任一 explicit 列表中，**默认归 E 作为模块私有**（不需要逐个枚举）

**Import:**
- `obsidian`（`MarkdownView`、`Workspace`）、`../plugin`
- `./chat-tool-types`、`./chat-tool-constants`、`./chat-types`、`./chat-utils`

---

### Module F: `chat-tool-guards.ts` (~228 行)

**职责:** Result 类型守卫 + 输入参数验证 + `isChatToolName`

**导出:**
- 类型守卫：`isSearchMemoryResult`、`isCurrentNoteContextResult`、`isSearchVaultMetadataResult`、`isListRecentNotesResult`、`isReadNoteOutlineResult`、`isInspectObsidianNoteResult`、`isReadCanvasSummaryResult`、`isVaultSnippetSearchResult`、`isVaultTagsResult`
- `isChatToolName`
- 验证函数：`validateSearchMemoryInput`、`validateCurrentNoteContextInput`、`validateSearchVaultMetadataInput`、`validateListRecentNotesInput`、`validateReadNoteOutlineInput`、`validateInspectObsidianNoteInput`、`validateReadCanvasSummaryInput`、`validateSearchVaultSnippetsInput`、`validateListVaultTagsInput`

**Import:**
- `./chat-tool-types`、`./chat-tool-constants`
- `./chat-tool-execution-helpers`（`validateVaultRelativeTargetPath`、`normalizeLimit`、`limitInputText`）

---

### Barrel: `chat-tools.ts`（替换原 3043 行）

```typescript
/**
 * Barrel re-export for the chat-tools module.
 *
 * External consumers continue to import public registry, factories, types,
 * and result guards from "./chat-tools". Internal vault I/O and parser helpers
 * stay in their implementation modules.
 */
export * from "./chat-tool-types";
export * from "./chat-tool-registry";
export * from "./chat-tool-factories";
export {
    isChatToolName,
    isCurrentNoteContextResult,
    isInspectObsidianNoteResult,
    isListRecentNotesResult,
    isReadCanvasSummaryResult,
    isReadNoteOutlineResult,
    isSearchMemoryResult,
    isSearchVaultMetadataResult,
    isVaultSnippetSearchResult,
    isVaultTagsResult,
} from "./chat-tool-guards";
```

---

## 4. 依赖图（DAG，无循环）

```
A (types)        : 无内部依赖
B (constants)    : 无内部依赖
E (exec)         : A, B  ← 含 *Like 接口与 vault helper
F (guards)       : A, B, E  ← 调 limitInputText/normalizeLimit/validateVaultRelativeTargetPath
C (registry)     : A, B, E, F  ← 不需要 *Like
D (factories)    : A, B, E, F  (+ obsidian-operations-capability-catalog)
```

**循环检查（grep 验证）:**
- C ↔ F: `ToolRegistry.get()` 调 `isChatToolName`，F 不依赖 C → 单向，无环
- D ↔ E: 工厂调 helper（含 `EditorLike`），E 不引用工厂 → 单向，无环
- E ↔ F: F 仅调 E 三个 helper（chat-tools.ts L1734-1823 调用点），E 不引用 F → 单向，无环

---

## 5. 外部消费者影响

| 文件 | 引入符号 | 来自模块 |
|------|--------|--------|
| `capability-types.ts` | `ChatToolCost/Failure/Schema/Name/Permission/Provider/Registry/Result/SourceBoundary` | A |
| `capability-registry.ts` | `ChatToolName/ProviderSchema/ProviderSchemaExportResult/RegistryDefinition/Result` | A |
| `builtin-web-search-provider.ts` | `ChatToolInputSchema/ProviderSchema/RegistryDefinition` | A |
| `core-tool-provider.ts` | `ToolRegistry` + 9 `create*Tool` + `ChatToolContext`, `SearchMemoryInput` | A + C + D |
| `pa-agent-runtime.ts` | `ChatToolProviderSchema`、各 `is*Result`、`isObsidianOperationsV1AToolName`、`ChatToolRegistryDefinition` | A + F |
| `pa-agent-host-tools.ts` | `isCurrentNoteContextResult`, `isSearchMemoryResult` | F |
| `capability-adapter.ts` | 类型集 | A |
| `skill-context-provider.ts` | 类型集 | A |
| `tests/factories/chat-tool-factory.ts` | `ToolRegistry` + 类型 | A + C |
| `tests/fakes/fake-chat-model-provider.ts` | `ChatToolProviderSchema` | A |

**关键:** 所有 10 个文件均通过 `"./chat-tools"`（或 `"../../ai-services/chat-tools"`）导入，barrel 屏蔽变更；`chat-tool-constants.ts`、`chat-tool-execution-helpers.ts` 和未列出的 guard/validator 仍是实现模块，不作为公共 API 透出。

---

## 6. Migration 策略

**同 PR 内 3 commit（便于 code review 与 bisect 回滚）。**

**理由:**
- 3000+ 行净移动 + 6 新文件 + barrel 替换，单 commit diff 过大，code review 几乎不可能
- 分 3 commit 后每个 commit 都是 self-contained（编译 + 测试通过），bisect 友好
- 仍是"同 PR 内"，10 个消费者无 import path 改动，barrel 兜底不变

**Commit 1: Leaves（A + B + E）**
1. 新建 `chat-tool-types.ts` (A)
2. 新建 `chat-tool-constants.ts` (B)
3. 新建 `chat-tool-execution-helpers.ts` (E) — 含 `*Like` 接口、所有 vault/parse/search/canvas/outline/editor helper
4. **暂不**修改 `chat-tools.ts`，仍含原有完整逻辑
5. 验证：`tsc --noEmit` + `npm test` 通过（新文件未被引用，应零影响）

**Commit 2: Registry & Guards & Factories（C + D + F）**
6. 新建 `chat-tool-registry.ts` (C) — 引入 A/B/F/E
7. 新建 `chat-tool-guards.ts` (F) — 引入 A/B/E
8. 新建 `chat-tool-factories.ts` (D) — 引入 A/B/E/F + `chat-tool-prepare-helpers`
9. 此时 `chat-tools.ts` 仍未变，但所有功能在新文件中重复存在
10. 验证：`tsc --noEmit` + `npm test`（旧 chat-tools.ts 仍是权威路径，新文件 dead code）

**Commit 3: Barrel switch + 删除原 monolith**
11. 把 `chat-tools.ts` 替换为 public barrel：类型、registry、factories 使用 `export *`，result guard / `isChatToolName` 使用命名 re-export
12. 删除原 chat-tools.ts 中已迁移的所有代码（仅留 public re-export）
13. 验证：`tsc --noEmit` + `npm test` + `npm run build` 全部通过

**Commit 1/2 安全性:** 因为是新增独立文件，旧路径未触碰，`npm test` 必然通过；任何 tsc/test 失败都局限于新文件本身。

**Commit 3 风险:** 此时 barrel 替换可能暴露符号缺失或 type 转发问题。所有 review 风险集中在 Commit 3，但其 diff 几乎全是删除（搬运已在前两步完成），评审快。

---

## 7. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| 私有符号暴露公开 API | 美观/治理 | 已采用命名 re-export 收窄公开面；内部 constants/helpers/validators 不从 barrel 透出 |
| `satisfies` 表达式跨模块类型引用 | TS 编译 | 类型 import，无运行时影响。`tsc --noEmit` 验证 |
| `export type { ... } from "..."` 转发 | TS 兼容性 | TypeScript 标准支持 `export *` 转发 type re-export |
| Jest `moduleNameMapper` 冲突 | 测试 | 已检查，无 chat-tools mock |
| esbuild barrel 性能 | bundle 大小 | esbuild 构建期解析，无运行时 wrapper |
| `import type` 循环 | TS 编译 | type-only 引用编译时擦除，不会成环 |
| `buildV1APlannerGuidance` 错放 C | 多余依赖 | **强制放 D**（chat-tools.ts L1344/1407/1483/1539 全在工厂调用） |
| 错误处理三件套错放 E | 多余依赖 | **强制放 C**（仅 `ToolRegistry.execute()` 使用） |
| `*Like` 接口公开化引发误用 | 治理 | **放 E（不放 A）**，仅 D 通过 `from "./chat-tool-execution-helpers"` 引入 |
| Commit 2 中新文件被废弃但未引用 | bundle 检查噪声 | 跑 `npm run audit:bundle` 确认 dead code 被 tree-shake；最终 commit 3 删除原 monolith 后无残留 |

---

## 8. Verification Checklist

- [ ] `tsc -noEmit -skipLibCheck`
- [ ] `npm test`（全量）
- [ ] `npm run build`
- [ ] `npm run audit:bundle`（确认 gzip 不变）
- [ ] 手动启动测 vault 跑一遍 9 个工具的 happy path
- [ ] grep 搜索 `from "./chat-tools"` 确认所有消费者仍通过 barrel

---

## 9. Critical Files

- `src/ai-services/chat-tools.ts` — 原 3043 行 monolith，变为 barrel
- `src/ai-services/core-tool-provider.ts` — 最复杂的消费者（9 工厂+`ToolRegistry`），首要回归目标
- `src/ai-services/pa-agent-runtime.ts` — 第二大消费者（守卫+类型）
- `src/ai-services/chat-tool-prepare-helpers.ts` — 已有 sibling，**禁止**重复定义
- `src/tests/factories/chat-tool-factory.ts` — 测试 factory，验证测试编译通过

---

## 10. 工作流程

1. 设计记录定稿并通过 review。
2. 在独立开发分支或 worktree 中实施，保持每个阶段可独立验证。
3. 完成 TypeScript、Jest、lint/build 与必要的 Obsidian smoke 验证后合入。

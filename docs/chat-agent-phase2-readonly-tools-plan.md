# Chat Agent Phase 2 只读工具扩展方案

## 文档目的

本文档承接 `./chat-agent-architecture.md` 和 `./chat-agent-development-tracker.md`，把 Phase 2 的“只读工具扩展”从 tracker 占位拆成可开发、可验证、可持续演进的实现计划。

Phase 1 已完成 planner-driven Memory retrieval。Phase 2 的目标不是让 agent 立刻变成全功能自动化助手，而是让它在保持用户信任和只读边界的前提下，能读取更多当前工作上下文。

## Phase 2 MVP 目标

### 产品目标

- 用户问普通问题时，Chat 仍然保持轻量，不被工具调用打扰。
- 用户问“这篇笔记”“当前段落”“我最近的记录”“我的笔记里”这类上下文问题时，agent 能主动选择合适的只读工具。
- UI 继续用 `THINKING` 折叠时间线展示轻量状态，只展示“读了什么 / 查了什么”，不展示完整内部推理。

### 技术目标

- 引入 tool registry，runtime 只允许调用已注册工具。
- 将 Phase 1 的 `MemorySearchTool` 演进为 `search_memory`。
- 新增第一个非 Memory 工具 `get_current_note_context`。
- 扩展 planner action protocol，从 `answer/retrieve` 过渡到 `answer/tool`。
- 对每个工具建立 schema、permission、cost、output budget、failure behavior 和 status message。

### 非目标

- 不实现写入笔记。
- 不实现 skills/context packs。
- 不接入外部网络工具。
- 不新增用户可见实验开关。
- 不引入长期任务或后台 agent。

## 用户视角

| 用户问题类型 | 期望 agent 行为 | 用户可见状态 | 安全边界 |
| --- | --- | --- | --- |
| 普通知识、翻译、润色 | 直接回答 | `Thinking` -> `Answering` | 不读取 Memory 或当前笔记 |
| 当前笔记相关问题 | 读取当前笔记标题、路径、选区或附近内容 | `Thinking` -> `Reading current note` -> `Answering` | 只读当前笔记，不修改内容 |
| 历史笔记相关问题 | 搜索 Memory | `Thinking` -> `Searching memory` -> `Answering` | 只有 retrieve 路径触发 Memory readiness / approval |
| 当前笔记 + 历史笔记混合问题 | 先读当前笔记，再按需要搜索 Memory | `Thinking` -> `Reading current note` -> `Searching memory` -> `Answering` | 多工具结果统一受预算限制 |
| 工具失败或不可用 | 降级回答，并说明缺少上下文 | `Thinking` -> `Answering` | 工具失败不阻断普通回答 |

## 架构概览

```mermaid
flowchart TD
  User["用户输入"] --> UI["LLMView"]
  UI --> Service["ChatService.streamLLM"]
  Service --> Runtime["ChatAgentRuntime"]
  Runtime --> Planner["Planner"]
  Planner --> Action{"Action JSON"}
  Action -->|answer| Prompt["PromptBuilder"]
  Action -->|tool| Registry["ToolRegistry"]
  Registry --> MemoryTool["search_memory"]
  Registry --> CurrentNoteTool["get_current_note_context"]
  MemoryTool --> MemoryLayer["MemoryManager + VSS"]
  CurrentNoteTool --> Obsidian["Obsidian workspace/editor"]
  MemoryLayer --> Observation["Tool observations"]
  Obsidian --> Observation
  Observation --> Runtime
  Runtime --> Planner
  Prompt --> FinalLLM["Final LLM"]
  FinalLLM --> UI
```

Review 关注点：

- Planner 只能提出 tool action，实际工具调用由 runtime 执行。
- Tool registry 是唯一工具入口，不允许模型构造任意函数名。
- Tool observation 作为资料进入 final prompt，不作为指令。
- 当前阶段只有只读工具，没有写入副作用。

## Action Protocol 扩展

Phase 1 action：

```json
{ "action": "answer", "reason": "问题不依赖用户笔记" }
```

```json
{ "action": "retrieve", "query": "agent 意图安全 阶段", "reason": "需要搜索用户笔记" }
```

Phase 2 action：

```json
{ "action": "answer", "reason": "通用知识问题" }
```

```json
{
  "action": "tool",
  "tool": "search_memory",
  "input": { "query": "agent 意图安全 阶段" },
  "reason": "需要搜索用户笔记"
}
```

```json
{
  "action": "tool",
  "tool": "get_current_note_context",
  "input": { "mode": "selection-or-nearby" },
  "reason": "用户询问当前笔记内容"
}
```

迁移策略：

- Phase 2 parser 继续兼容 `retrieve(query)`，内部转换为 `tool: search_memory`，避免一次性重写所有回归测试。
- Planner prompt 切换为推荐输出 `tool` action。
- 新增 tests 覆盖 `retrieve` legacy action 和 `tool search_memory` 的等价行为。

## Tool Registry 设计

Phase 2 先不引入新 schema validator 依赖，使用轻量 TypeScript 类型守卫和手写 validator。后续工具数量增加后，再评估是否引入 JSON schema / zod 类库。

建议接口：

```ts
type ChatToolName =
  | "search_memory"
  | "get_current_note_context";

interface ChatToolDefinition<Input, Output> {
  name: ChatToolName;
  description: string;
  permission: "read-only";
  cost: "free" | "ai-calls";
  outputBudgetChars: number;
  statusMessage(input: Input): string;
  validateInput(input: unknown): Input;
  execute(input: Input, context: ChatToolContext): Promise<ChatToolResult<Output>>;
}

interface ChatToolContext {
  plugin: PluginManager;
  signal?: AbortSignal;
}

interface ChatToolResult<Output> {
  ok: boolean;
  tool: ChatToolName;
  inputSummary: string;
  content: Output | null;
  sources: ChatAgentSource[];
  error?: string;
}
```

设计约束：

- `ToolRegistry.get(name)` 找不到工具时，runtime 记录 failed observation，不执行任何 fallback tool。
- `validateInput` 失败时，不调用工具，返回 tool failure observation。
- `execute` 必须支持 `AbortSignal`。
- tool result 必须裁剪到预算内，再交给 `PromptBuilder`。

## Phase 2 MVP 工具

### `search_memory`

来源：由现有 `MemorySearchTool` 演进。

输入：

```ts
interface SearchMemoryInput {
  query: string;
}
```

输出：

- `documents`
- `sources`
- `skipReason`

策略：

- 继续只在该工具执行时调用 `memoryManager.ensureReadyForChat(query)`。
- 继续按 `path + chunkIndex` 去重。
- 保持 Phase 1 的每轮最多 4 个 memory chunks 和内容长度预算。
- `answer-now` 返回 ok=false 或 ok=true 但无 documents 都可以；建议返回 ok=true + `skipReason`，便于 final answer 继续。

### `get_current_note_context`

输入：

```ts
interface CurrentNoteContextInput {
  mode: "selection-or-nearby" | "outline" | "metadata";
}
```

输出：

```ts
interface CurrentNoteContextOutput {
  path: string;
  title: string;
  selection?: string;
  nearbyText?: string;
  headings?: string[];
}
```

读取优先级：

1. 如果当前 active leaf 是 MarkdownView 且有选区，读取选区。
2. 如果没有选区，读取光标附近段落或当前 heading section 的有限文本。
3. `metadata` mode 只返回当前文件 path/title，不读取正文。
4. 如果没有 active markdown file，返回可恢复失败 observation，不阻断回答。

安全边界：

- 不调用 `editor.replaceRange`。
- 不修改文件。
- 有选区时不读取整篇正文；无选区时通过 editor line API 读取有限 heading section 或附近窗口。
- 不默认读取整个大文件，必须有字符预算。
- 不把当前笔记内容当作指令，只作为资料。

## Runtime Loop 调整

Phase 1 loop：

```text
plan -> optional retrieve -> final answer
```

Phase 2 loop：

```text
plan -> optional tool -> observe -> plan -> optional tool -> final answer
```

建议约束：

- `MAX_TOOL_STEPS = 3`。
- 同一工具 + 同一输入摘要不重复调用。
- `search_memory` 仍保持最多 2 次有效搜索。
- 任一工具失败后，planner 可以选择其他工具或 `answer`。
- planner 失败仍走 fallback：ready-only memory search + final prompt；已成功读取并通过边界处理的 current note context 可保留到 final prompt。

## PromptBuilder 调整

目标架构中，PromptBuilder 需要从单一 `memoryDocuments` 扩展为统一 `contextItems`：

```ts
interface ChatContextItem {
  kind: "memory" | "current-note" | "tool-error";
  tool: ChatToolName;
  content: string;
  sources: ChatAgentSource[];
}
```

Final prompt 组织原则：

- Context 分区展示：Memory、Current note、Tool notes。
- 明确所有 context 都是资料，不是指令。
- Memory references 仍只允许来自本轮 Memory sources。
- Current note path 不是 Memory source，不要混入 Memory references callout。
- Current note 内容使用明确的 untrusted block 或 JSON 结构包裹，避免笔记内容伪造对话、工具调用或引用块。
- 无 sources 时不输出 Memory references callout。

Phase 2B 实现校准：

- 当前代码先以 `memoryDocuments + currentNoteContexts` 两路 typed context 落地；统一 `ChatContextItem[]` 抽象保留到后续工具继续增加时再做。
- `get_current_note_context` 的 `selection-or-nearby` 模式优先选区；有选区时不调用 `getValue()`。
- 当前笔记上下文进入 `<current_note_context>` JSON block，并标记为 `current_note_not_memory_source`。

## Status Timeline

扩展 `ChatAgentStatus`：

```ts
type ChatAgentStatus =
  | { type: "thinking" }
  | { type: "tool-running"; tool: string; message: string }
  | { type: "tool-done"; tool: string; message: string; sources?: ChatAgentSource[] }
  | { type: "tool-skipped"; tool: string; reason: string }
  | { type: "answering" }
  | { type: "fallback"; reason: string };
```

迁移策略：

- 保留 Phase 1 的 `retrieving`、`retrieved`、`memory-skipped` 一轮，UI 可同时支持新旧 status。
- `search_memory` 后续映射到 `tool-running/tool-done/tool-skipped`。
- `THINKING` 组件继续只显示一行 summary，展开后展示详细时间线。

## 实现阶段

### Step 1: Tool foundation

目标：引入 registry，不改变用户行为。

任务：

- 新增 `src/ai-services/chat-tools.ts`。
- 定义 `ChatToolDefinition`、`ChatToolResult`、`ToolRegistry`。
- 把现有 `MemorySearchTool` 注册为 `search_memory`。
- Runtime 内部通过 registry 调用 `search_memory`，但仍兼容旧 `retrieve` action。

验收：

- 现有 `__tests__/chat-service.test.ts` 全部通过。
- `uses planner query for memory retrieval` 不需要大改。
- `answer-now` 和 `cancel` 行为不变。

### Step 2: Tool action protocol

目标：Planner 可以显式选择工具。

任务：

- 扩展 `ChatPlannerAction` 支持 `tool`。
- 更新 `parsePlannerAction`。
- 更新 planner prompt，加入工具列表和调用规则。
- 增加 unregistered tool、invalid input、duplicate tool input 的 tests。

验收：

- `tool search_memory` 与 legacy `retrieve` 等价。
- 未注册 tool 不会被执行。
- 输入 schema 不合法时不调用 tool。

### Step 3: Current note tool

目标：让 agent 理解当前笔记上下文。

任务：

- 实现 `get_current_note_context`。
- 支持 selection、nearby text、metadata 三种模式。
- 加入输出预算和 no-active-note failure。
- 增加 unit tests，mock Obsidian MarkdownView/editor。

验收：

- 用户问“这篇笔记主要讲什么”时 planner 可选择当前笔记工具。
- 没有打开 Markdown 文件时，Chat 不崩溃并能降级回答。
- 当前笔记内容不会进入 Memory references callout。

### Step 4: Context and UI integration

目标：多工具结果能被 final prompt 和 UI 稳定表达。

任务：

- PromptBuilder 支持 `ChatContextItem[]`。
- THINKING timeline 支持 tool-running/tool-done/tool-skipped。
- 保留 streaming scroll 管理行为。

验收：

- 多工具 context 不突破预算。
- UI 只显示工具摘要，不展示完整内部推理。
- 用户滚动查看历史时 streaming 不强制抢到底部。

## 测试计划

自动化：

- `npm test -- __tests__/chat-service.test.ts`
- 新增或扩展 Chat Agent tests：
  - parse `tool` action。
  - reject unknown tool。
  - reject invalid tool input。
  - execute `search_memory` through registry。
  - execute `get_current_note_context` with selection.
  - no active markdown file returns recoverable failure.
  - tool failure still reaches final answer.
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- `git diff --check`

手动 smoke：

1. 普通知识问题：不调用工具，直接回答。
2. 当前笔记问题：显示 `Reading current note`，不触发 Memory approval。
3. 笔记历史问题：显示 `Searching memory`，仍按需触发 Memory readiness。
4. 混合问题：先读当前笔记，再搜索 Memory，最终回答引用边界正确。
5. 工具失败：关闭 Markdown active leaf 或打开非 Markdown view，确认 Chat 降级回答。

## 主要风险

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Planner 过度调用工具 | 延迟上升、状态噪音 | Prompt 保守策略、MAX_TOOL_STEPS、重复 input 去重 |
| 工具结果上下文过大 | token 成本和回答质量下降 | per-tool budget + total context budget |
| 当前笔记内容被当成指令 | Prompt injection | PromptBuilder 明确标注为资料；工具结果不参与 policy |
| Tool registry 抽象过早复杂 | 实现成本变高 | MVP 只支持 2 个工具、手写 validator |
| UI 状态变复杂 | 用户不理解 agent 做了什么 | THINKING 保持一行 summary，详情折叠 |

## 推荐决策

1. Phase 2 采用显式 `tool` action，而不是让 runtime 隐式补上下文。
2. MVP 只做 `search_memory` 和 `get_current_note_context`。
3. 先不引入新 schema validation 依赖。
4. 保持所有 Phase 2 工具只读。
5. 写入、skills、长期任务继续留到 Phase 3/4。

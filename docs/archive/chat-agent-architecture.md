# Chat Agent 架构设计

> [!IMPORTANT]
> Archived historical record. This document is no longer a design or execution source of truth. Use [PA Agent Architecture Plan](../pa-agent-architecture-plan.md) and [PA Agent Runtime Lifecycle Plan](../pa-agent-runtime-lifecycle-plan.md) for current PA Agent work. Any guidance below is historical evidence only; if it conflicts with the current PA Agent docs, the current PA Agent docs win.

## 背景

当前 Chat 功能的主路径是：

1. 用户在侧边栏输入 prompt。
2. 插件通过 VSS 检索相似笔记内容。
3. 将相似度最高的内容插入 prompt。
4. 调用配置的 chat model 流式回答。

这个流程能让模型使用用户笔记回答问题，但它本质上仍然是固定 RAG：

- 检索是否发生由代码路径决定，不由 agent 判断。
- 检索 query 默认等于用户原始输入，无法主动改写成更适合搜索的表达。
- Memory 准备确认发生在真正判断是否需要检索之前，容易打断不需要笔记的问题。
- 后续要引入只读工具、skill、写入动作时，缺少统一的 action loop、权限、状态和失败处理框架。

本设计将 Chat 从“带检索的问答”演进为“能判断、能查找、能组织上下文、可逐步接工具的个人助理”。第一阶段只做 agentic memory retrieval，不引入写入型工具。

## 目标

- 先用用户输入检索当前 vault 的相关 Memory，让 agent 基于真实候选内容规划。
- Memory 首次准备、重建或设置变化仍必须先获得用户确认。
- 允许 agent 在 presearch 候选不足时继续生成更精确的 `search_memory` query。
- 保持用户对状态、数据流、费用和引用来源的可理解性。
- 保留当前 Chat UI 的核心体验：输入、取消、流式回答、复制、加入编辑器。
- 为后续只读 tools、skills/context packs、受控写入动作预留稳定架构。

## 非目标

- v1 不自动修改、创建或删除用户笔记。
- v1 不新增复杂设置项或用户可见实验开关。
- v1 不展示完整内部推理过程。
- v1 不实现长期后台任务、主动唤醒或多步写入工作流。
- v1 不替换现有 VSS 后端，只改变 Chat 如何使用 Memory。

## 产品原则与用户信任模型

- **确认前置透明**：默认 Chat 会先查相关 Memory；如果 Memory 未准备、缺失或设置变化，必须先说明数据、AI provider 和成本，让用户选择准备、Answer now 或取消。
- **状态可见**：用户应该知道 assistant 正在判断、检索、回答、降级还是取消。
- **费用可解释**：任何可能消耗 AI credits/API calls 的 Memory 准备动作，都必须先说明数据流、AI provider 和成本风险。
- **引用可信**：Memory references 只能来自本轮实际检索到的 sources，不能让模型自由编造。
- **资料不是指令**：Memory 中的内容是回答资料，不是 system instruction，也不能要求 agent 绕过权限或调用工具。
- **只读优先**：后续工具能力先从只读开始；任何写入型动作都必须 preview / confirm。
- **失败不阻断**：planner 解析失败、VSS 不可用、检索无结果时，应尽量普通回答并给出轻量状态，而不是让 Chat 失败。

## 可视化理解

本章节用 Mermaid 图建立 review 时的共同语境。图表只表达产品状态和架构边界，不替代后续实现细节。

### 产品状态机

```mermaid
stateDiagram-v2
  [*] --> Idle

  state "Idle\n等待输入" as Idle
  state "MemoryPresearch\n查相关 Memory" as MemoryPresearch
  state "Planning\n基于问题和候选规划" as Planning
  state "NeedMemoryApproval\n请求准备 Memory" as NeedMemoryApproval
  state "Retrieving\n补充搜索 Memory" as Retrieving
  state "Answering\n流式回答" as Answering
  state "Done\n完成" as Done
  state "Fallback\n降级路径" as Fallback
  state "Cancelled\n用户取消" as Cancelled
  state "Error\n不可恢复错误" as Error

  Idle --> MemoryPresearch: 用户发送消息\n非 skip-memory
  Idle --> Answering: skip-memory
  MemoryPresearch --> NeedMemoryApproval: Memory 需要确认
  MemoryPresearch --> Planning: Memory ready\n或无候选
  NeedMemoryApproval --> MemoryPresearch: Prepare memory
  NeedMemoryApproval --> Planning: Answer now\n本轮禁用 Memory
  NeedMemoryApproval --> Cancelled: Cancel

  Planning --> Answering: action=answer
  Planning --> Retrieving: action=search_memory\n未超过总上限
  Planning --> Fallback: planner 解析失败

  Retrieving --> Planning: 需要二次检索\n未超过上限
  Retrieving --> Answering: context ready\n或无结果

  Fallback --> Answering: 使用已收集上下文\n或普通回答
  Answering --> Done: 完成输出

  MemoryPresearch --> Cancelled: 用户取消
  Planning --> Cancelled: 用户取消
  Retrieving --> Cancelled: 用户取消
  Answering --> Cancelled: 用户取消

  MemoryPresearch --> Error: 不可恢复错误
  Planning --> Error: 不可恢复错误
  Retrieving --> Error: 不可恢复错误
  Answering --> Error: 不可恢复错误

  Done --> Idle: 下一轮输入
  Cancelled --> Idle: 下一轮输入
  Error --> Idle: 下一轮输入
```

Review 关注点：

- 普通问题会先做轻量 Memory presearch；如果 Memory 已准备且无相关内容，应快速进入 `Planning -> Answering`。
- Memory 未准备、缺失或设置变化时，presearch 会触发现有 Memory approval；用户选择 `Answer now` 后本轮不再重复请求 Memory。
- `Planning`、`Retrieving`、`Answering` 都必须响应用户取消。
- `Fallback` 是可恢复路径；默认摘要保持轻量，展开详情可显示用于诊断的失败原因。

### 一次 Chat 请求的执行时序

```mermaid
sequenceDiagram
  actor User as User
  participant View as LLMView
  participant Service as ChatService
  participant Runtime as ChatAgentRuntime
  participant Planner as Planner
  participant MemoryTool as MemorySearchTool
  participant VSS as VSS
  participant Prompt as PromptBuilder
  participant LLM as Final LLM

  User->>View: 输入消息并发送
  View->>Service: streamLLM(prompt, history, options)
  Service->>Runtime: run(prompt, history, memoryMode)
  Runtime-->>View: status: memory-prefetching(prompt)
  Runtime->>MemoryTool: search(prompt)
  MemoryTool->>MemoryTool: ensureReadyForChat(prompt)

  alt Memory approval = Answer now
    MemoryTool-->>Runtime: skipReason
    Runtime-->>View: status: memory-skipped
  else Memory approval = Cancel
    MemoryTool-->>Runtime: AbortError
    Runtime-->>View: cancelled
  else Memory ready / prepared
    MemoryTool->>VSS: searchSimilarity(prompt)
    VSS-->>MemoryTool: docs + scores
    MemoryTool-->>Runtime: sources + documents
    Runtime-->>View: status: memory-prefetched(sources)
  end

  Runtime-->>View: status: thinking
  Runtime->>Planner: plan(prompt, recentHistory, memoryDigest)
  Planner-->>Runtime: action JSON

  alt action = answer
    Runtime-->>View: status: answering
    Runtime->>Prompt: buildFinalPrompt(selected Memory docs if use_memory=true)
    Prompt-->>Runtime: final prompt
    Runtime->>LLM: stream(final prompt)
    LLM-->>View: chunks
  else action = search_memory / retrieve
    Runtime-->>View: status: retrieving(query)
    Runtime->>MemoryTool: search(query)
    MemoryTool->>MemoryTool: ensureReadyForChat(query)
    MemoryTool->>VSS: searchSimilarity(query)
    VSS-->>MemoryTool: docs + scores
    MemoryTool-->>Runtime: sources + documents
    Runtime-->>View: status: retrieved(sources)
    Runtime->>Planner: plan(prompt, memoryDigest, observations)
    Planner-->>Runtime: action JSON
    Runtime->>Prompt: buildFinalPrompt(collected context)
    Prompt-->>Runtime: final prompt
    Runtime->>LLM: stream(final prompt)
    LLM-->>View: chunks
  else planner failed
    Runtime-->>View: status: fallback
    Runtime->>Prompt: buildFinalPrompt(collected context)
    Prompt-->>Runtime: final prompt
    Runtime->>LLM: stream(final prompt)
    LLM-->>View: chunks
  end
```

Review 关注点：

- `LLMView` 不再提前调用 `ensureReadyForChat(...)`。
- Planner 在 Memory presearch 之后产生 action，tool 只执行 runtime 认可的 action。
- `MemorySearchTool` 是 Memory approval 与 VSS search 的唯一入口。
- 最终回答统一经过 `PromptBuilder`，避免 prompt 拼接逻辑散落在 UI 或 tool 中。

### Agent 技术组件图

```mermaid
flowchart TB
  subgraph UI["UI Layer"]
    LLMView["LLMView\n输入 / 取消 / 流式渲染\nThinking 摘要 / 可折叠详情"]
  end

  subgraph Service["Service Layer"]
    ChatService["ChatService\n保持外部入口"]
  end

  subgraph Core["Agent Core"]
    Runtime["ChatAgentRuntime\naction loop / step budget\nabort / fallback / status"]
    Planner["Planner\n低温非流式\naction-only JSON"]
    PromptBuilder["PromptBuilder\nhistory budget\nmemory context\nreferences"]
  end

  subgraph Tools["Tool Layer"]
    MemoryTool["MemorySearchTool\napproval / VSS search\nsource 去重 / 裁剪"]
    FutureTools["Future Read-only Tools\ncurrent note / vault metadata\nfile title search"]
  end

  subgraph Memory["Memory Layer"]
    MemoryManager["MemoryManager\nreadiness / approval\nprepare / answer now"]
    VSS["VSS\nsearchSimilarity\nrefresh / rebuild"]
  end

  subgraph Policy["Policy Layer"]
    AgentPolicy["AgentPolicy\n权限 / 费用\nprompt injection 防护\n写入审批规则"]
  end

  LLMView --> ChatService
  ChatService --> Runtime
  Runtime --> Planner
  Runtime --> PromptBuilder
  Runtime --> MemoryTool
  Runtime -. future .-> FutureTools
  MemoryTool --> MemoryManager
  MemoryTool --> VSS

  AgentPolicy -. constrains .-> Runtime
  AgentPolicy -. constrains .-> Planner
  AgentPolicy -. constrains .-> MemoryTool
  AgentPolicy -. constrains .-> FutureTools
  AgentPolicy -. constrains .-> PromptBuilder
```

Review 关注点：

- Runtime 负责循环与状态，Planner 只负责产生动作，不直接调用工具。
- Tool 层只暴露结构化输入输出，不直接拼最终回答 prompt。
- Policy 层要变成明确约束，不能只写在自然语言 prompt 里。
- 后续 tools/skills 应接入 Tool Layer 和 Runtime，而不是绕过 ChatService。

### 上下文组织数据流

```mermaid
flowchart LR
  UserInput["User input\n用户原始问题"]
  History["Recent chat history\n最近对话\n剥离旧 references"]
  Presearch["Memory presearch\n原始问题检索"]
  Digest["Planner digest\npath + score + untrusted excerpt"]
  PlannerAction["Planner action\nanswer 或 tool"]
  MemoryQuery["Supplemental Memory query\nagent 改写后的检索词"]
  SearchResults["Search results\ndocs + scores"]
  Sources["Source list\npath + chunkIndex"]
  MemoryContext["Memory context\n去重 / 裁剪 / 限额"]
  FinalPrompt["Final answer prompt\n用户问题 + history + context"]
  Answer["Assistant answer\n流式输出"]
  References["Memory references\n只引用本轮 sources"]

  UserInput --> Presearch
  Presearch --> SearchResults
  SearchResults --> Digest
  Digest --> PlannerAction
  UserInput --> PlannerAction
  History --> PlannerAction

  PlannerAction -->|answer| FinalPrompt
  PlannerAction -->|search_memory| MemoryQuery
  MemoryQuery --> SearchResults
  SearchResults --> Sources
  SearchResults --> MemoryContext

  UserInput --> FinalPrompt
  History --> FinalPrompt
  MemoryContext --> FinalPrompt

  FinalPrompt --> Answer
  Sources --> References
  Answer --> References
```

Review 关注点：

- 用户原始 prompt 是 presearch query，但后续补充检索 query 可由 planner 改写。
- Sources 必须由 `SearchResults` 生成，不能由最终模型自由生成。
- History 和 Memory context 都要有预算限制，避免 token 膨胀。
- Memory context 是资料输入，不允许覆盖 system policy 或 tool policy。

### 分阶段演进路线图

```mermaid
flowchart LR
  P1["Phase 1\nAgentic Memory Retrieval\n\n产品: 按需查笔记\n技术: answer/retrieve action\n安全: 只读 Memory\n验收: 引用来源受控"]
  P2["Phase 2\n只读工具扩展 + Presearch\n\n产品: 更懂当前 vault 和工作区\n技术: Memory digest + tool registry\n安全: read-only permission\n验收: 工具有 schema 和状态"]
  P3["Phase 3\nSkills / Context Packs\n\n产品: 支持高频场景\n技术: skill selection\n安全: skill 不直接写入\n验收: 输出格式稳定"]
  P4["Phase 4\n受控写入与长期任务\n\n产品: 从回答到协作\n技术: write actions + audit\n安全: preview / confirm\n验收: 修改范围清晰"]

  P1 --> P2 --> P3 --> P4
```

Review 关注点：

- 每个阶段都要先定义产品体验，再定义技术能力。
- 写入能力必须晚于只读工具和 skill 架构。
- 每阶段都有安全边界，不能因为 agent 能力增长而模糊权限。
- v1 的组件边界要能自然承载后续阶段，避免后面重写 Chat 主路径。

## 用户场景与状态表现

### 普通知识或写作问题

用户输入不依赖个人笔记的问题，例如解释概念、润色句子、生成通用模板。

- 状态：`memory-prefetching -> memory-prefetched -> thinking -> answering`；如果 Memory disabled / skipped，则没有 VSS 结果。
- 行为：先用原始用户输入做 Memory presearch，Planner 在无相关候选时输出 `answer`。
- 用户感知：Memory 已准备时没有额外弹窗，回答速度接近普通 Chat。
- 验收：Memory 已准备时不因无关候选打断用户；Memory 未准备时仍由现有成本确认保护用户。

### 个人笔记相关问题

用户询问自己的项目、记录、读书笔记、会议结论或历史决策。

- 状态：`memory-prefetching -> memory-prefetched -> thinking -> answering`；需要补充上下文时可继续 `retrieving(query) -> retrieved(sources)`。
- 行为：Presearch 可直接命中 Memory；候选不足时 Planner 输出 `search_memory` / `retrieve`，query 可以不同于用户原始 prompt。
- 用户感知：看到正在搜索的 query 和来源摘要。
- 验收：最终回答附 Memory references，且只引用本轮检索 sources。

### Memory 未准备或需要更新

Presearch 或后续 `search_memory` 发现本机 Memory 缺失、过期或配置变化。

- 状态：`memory-prefetching -> NeedMemoryApproval`。
- 行为：显示准备 Memory 的确认说明；用户确认后继续本轮 presearch 和规划。
- 用户感知：弹窗说明 Data、AI provider、Cost。
- 验收：用户选择 `Prepare memory` 后继续原问题；选择 `Answer now` 后本轮跳过 Memory。

### 用户拒绝 Memory

用户不想本轮准备或使用 Memory。

- 状态：`NeedMemoryApproval -> answering`。
- 行为：本轮禁用 Memory，普通回答。
- 用户感知：显示 `Memory was not used for this answer.`。
- 验收：拒绝不会导致问题丢失，也不会继续调用 VSS。

### 检索无结果

Memory 可用，但 VSS 没有找到足够相关的内容。

- 状态：`retrieving -> answering`。
- 行为：最终 prompt 不注入空洞或低可信 Memory context。
- 用户感知：可以轻量提示未找到相关笔记。
- 验收：答案不伪造引用；没有 sources 时不输出 Memory references。

### Planner 异常

Planner 输出不是合法 JSON，或 action schema 不合规。

- 状态：`planning -> fallback -> answering`。
- 行为：不再额外用 raw prompt 做 fallback search；复用已成功读取的 current note context，以及补充 `search_memory` 结果或通过相关性守卫的 presearch Memory。
- 用户感知：摘要只显示轻量 fallback / answering 状态，展开详情可看到诊断原因。
- 验收：格式错误不导致 Chat 失败；普通问题不会因为无关 presearch 命中而显示空 `Memory references`。

### 用户取消

用户在判断、检索或回答中点击取消。

- 状态：运行中状态进入 `Cancelled`。
- 行为：AbortSignal 贯穿 planner、tool 和 final LLM。
- 用户感知：显示生成已取消。
- 验收：取消后不继续追加回答，不启动新的 fallback 调用。

## Agent 技术架构

### LLMView

`LLMView` 是 Chat 的 UI 层，职责保持轻量：

- 收集用户输入和当前 chat history。
- 渲染用户消息、assistant 流式输出和系统轻量状态。
- 将同一轮 agent run 的状态合并到一个 `Thinking` 状态块中，默认只显示最新一行摘要，展开后查看本轮状态明细。
- 处理取消、清空、复制、加入编辑器。
- 不再在发送前固定调用 `memoryManager.ensureReadyForChat(...)`。

UI 层不决定是否检索，也不拼接 Memory prompt。它只把 `prompt`、`history`、`AbortSignal` 和 `onStatus` 传给 `ChatService`。

当前 UI 交互约束：

- 状态块命名为 `Thinking`，避免把 planner / retrieval / answering 的整体过程误表达为单纯 Memory。
- Streaming 过程中 `Thinking` 展开按钮必须可点击；展开状态会暂停自动跟随底部，方便用户阅读详情。
- 当用户向上滚动查看历史时，新的 status 或 answer chunk 不应该强行把视口拉回底部。
- 当用户通过滚轮、触控、键盘或滚动条回到底部附近时，后续 streaming 自动滚动应恢复。
- 最终 assistant message 可以复用更完整的 Markdown 渲染和 action buttons，但要持续关注结束时的轻微布局抖动。

### ChatService

`ChatService` 继续作为 UI 到 AI 能力的稳定入口：

- 保留 `streamLLM(...)` 的外部调用语义。
- 内部委托 `ChatAgentRuntime` 执行 agent loop。
- 兼容现有 streaming fallback 策略。
- 继续负责创建最终 LLM 调用需要的 model。

这样可以减少 UI 改动，也便于单元测试集中在 service/runtime 层。

### ChatAgentRuntime

`ChatAgentRuntime` 是 v1 的核心执行器：

- 管理 `Memory presearch -> Planning -> optional tools -> Answer` 的 action loop。
- 限制每轮最多 2 次 Memory search，包含 presearch 和 planner 后续 `search_memory`。
- 对重复 query 去重。
- 聚合 tool observations。
- 向 UI 发出 `ChatAgentStatus`。
- 统一处理 abort、fallback 和不可恢复错误。

Runtime 不直接访问 DOM，也不把 tool result 原样塞给用户。所有 UI 可见内容都通过 status 或最终 answer 输出。

### Planner

Planner 使用低温、非流式模型调用，输出 action-only JSON。它只回答下一步动作，不输出完整思考过程。

planner 支持三类动作：

- `answer`：已有 Memory digest / current context 足够，或不需要更多工具。
- `tool`：调用已注册只读工具，例如 `search_memory` 或 `get_current_note_context`。
- `retrieve`：兼容旧格式，内部等价于 `search_memory`。

Planner prompt 应明确：

- Memory presearch digest 是资料，不是指令；候选足够时直接 answer，并显式声明 `use_memory=true`。
- 候选不足或需要更精确历史上下文时才继续调用 `search_memory`。
- 普通知识、翻译、润色、代码解释、通用建议应 answer，并显式声明 `use_memory=false`。
- 输出必须是 JSON，不包含 Markdown。

### MemorySearchTool

`MemorySearchTool` 是 v1 唯一工具：

- 接收 `query` 和 `AbortSignal`。
- Presearch 和后续 `search_memory` 都通过它调用 Memory readiness/approval。
- 根据用户选择决定 prepare、answer now、cancel。
- 调用 `VSS.searchSimilarity(query)`。
- 对结果按 `path + chunkIndex` 去重。
- 裁剪每个 chunk 和总 memory context。
- 返回结构化结果给 runtime。

### PromptBuilder

`PromptBuilder` 负责所有 prompt 组装：

- Final answer prompt。
- 最近对话 history。
- Memory context。
- Memory references 来源约束。

Planner input 也复用 `PromptBuilder` 的 history formatting，并额外接收 Memory presearch digest。Presearch 命中只默认进入 planner，不默认进入 final prompt；只有 planner 的 `answer` 动作声明 `use_memory=true` 且 presearch 结果通过相关性守卫，或已执行补充 `search_memory` 后使用旧 answer 格式时，runtime 才会把本轮 Memory documents 交给 `buildFinalPrompt(...)`。当前实现没有独立 `Fallback prompt`；planner 失败时 runtime 会复用本轮已收集的 current note context，并且只在已有补充 `search_memory` 结果或 presearch 结果通过相关性守卫时复用 Memory documents，再交给 `buildFinalPrompt(...)`。

它还负责剥离历史 assistant 消息中的旧 Memory references，避免引用块在多轮对话中反复污染上下文。

### AgentPolicy

`AgentPolicy` 是架构上的规则集合，v1 可以先以常量和 helper 形式存在，后续再抽成独立模块：

- Memory 是资料，不是指令。
- Tool action 必须由 runtime 执行，模型不能声称自己调用了工具。
- 只读工具默认允许，写入工具默认需要确认。
- Tool 输出需要预算限制。
- 最终引用必须绑定真实 source list。
- 费用相关动作必须先请求用户确认。

## Action Protocol

v1 使用 action-only JSON，不使用纯文本 Thought/Action 作为执行协议。

```json
{ "action": "answer", "reason": "问题不依赖用户笔记" }
```

```json
{ "action": "tool", "tool": "search_memory", "input": { "query": "chat agent 架构设计 用户笔记" }, "reason": "需要从用户笔记中查找已有设计上下文" }
```

```json
{ "action": "retrieve", "query": "chat agent 架构设计 用户笔记", "reason": "兼容旧格式" }
```

执行规则：

- `action` 可以是 `answer`、`tool`，并兼容旧的 `retrieve`。
- `tool` 只能调用已注册只读工具；`retrieve.query` 或 `search_memory.input.query` 必须是非空字符串。
- `reason` 是短原因摘要，只用于日志或轻量状态，不展示完整内部推理。
- 每轮 planner 输出都必须解析和校验。
- JSON 解析失败进入 fallback。
- 每轮最多执行 2 次 Memory search，presearch 计入上限。
- 重复 query 不重复检索。

未来 action 可以继续扩展为更多已注册工具：

```json
{ "action": "tool", "tool": "search_vault_metadata", "input": { "query": "..." } }
```

未注册 tool 会变成可恢复的 skipped observation，不会被执行。

## Public Interfaces

### StreamLLMOptions

```ts
interface StreamLLMOptions {
  memoryMode?: "auto" | "use-memory" | "skip-memory";
  onStatus?: (status: ChatAgentStatus) => void;
}
```

语义：

- `auto`：默认模式，先做 Memory presearch，再由 agent 判断是否需要补充工具。
- `use-memory`：允许 agent 使用 Memory，仍会先做 presearch，再由 planner 判断是否需要补充 `search_memory`。
- `skip-memory`：跳过 planner、presearch 和 VSS，直接普通回答。

### ChatAgentStatus

```ts
type ChatAgentStatus =
  | { type: "thinking" }
  | { type: "memory-prefetching"; query: string }
  | { type: "memory-prefetched"; query: string; sources: ChatAgentSource[] }
  | { type: "retrieving"; query: string }
  | { type: "retrieved"; query: string; sources: ChatAgentSource[] }
  | { type: "memory-skipped"; reason: string }
  | { type: "tool-running"; tool: string; message: string }
  | { type: "tool-done"; tool: string; message: string; sources?: ChatAgentSource[] }
  | { type: "tool-skipped"; tool: string; reason: string }
  | { type: "answering" }
  | { type: "fallback"; reason: string };
```

产品状态机是 review 用的概念模型，当前公开给 UI 的 `ChatAgentStatus` 是轻量事件接口，不与所有产品状态一一对应：

| 产品状态 | 当前 status event | 说明 |
| --- | --- | --- |
| `MemoryPresearch` | `memory-prefetching`、`memory-prefetched` | 分别表达开始用原始问题查 Memory 和已有候选来源结果。 |
| `Planning` | `thinking` | 表示 runtime 正在让 planner 判断下一步动作。 |
| `NeedMemoryApproval` | 由 `MemoryManager.ensureReadyForChat(...)` 的确认 UI 表达 | 当前不新增独立 `approval` status event。 |
| `Retrieving` | `retrieving`、`retrieved` | 分别表达 planner 后续补充检索和已有来源结果。 |
| `Read-only tools` | `tool-running`、`tool-done`、`tool-skipped` | 表达非 Memory 只读工具的轻量状态。 |
| `Answering` | `answering` | 表示 final LLM 即将开始输出。 |
| `Fallback` | `fallback` | planner 输出不可用时进入可恢复路径。 |
| `Cancelled` | `AbortError` 由 UI catch 后显示取消消息 | 当前不新增独立 `cancelled` status event。 |
| `Error` | UI Notice 或调用方错误处理 | 不可恢复错误不映射为常规 status event。 |

UI 当前不会为每个 event 创建一条独立系统消息，而是把同一轮请求的 events 聚合到一个 `Thinking` 状态块：摘要区显示最新 event，详情区追加完整轻量 timeline。这个策略属于展示层约束，不改变 `ChatAgentStatus` 的公共事件模型。

### Memory Tool Result

```ts
interface MemorySearchResult {
  usedMemory: boolean;
  query: string;
  documents: Array<{
    content: string;
    score: number;
    source: ChatAgentSource;
  }>;
  sources: ChatAgentSource[];
  skipReason?: string;
}

interface ChatAgentSource {
  path: string;
  chunkIndex?: number;
  score?: number;
}
```

## Tool / Skill 演进架构

### v1: search_memory

第一阶段只暴露 `search_memory`：

- 权限：只读。
- 成本：query embedding；如果 Memory 未准备，prepare 可能产生 embedding API 成本。
- 输入：`query`。
- 输出：`documents`、`sources`、`usedMemory`、`skipReason`。
- 失败：普通回答或 fallback。

### v2: 只读工具扩展

后续可以增加：

- `get_current_note_context`：读取当前打开笔记的标题、路径、选区或附近段落。
- `search_vault_metadata`：基于文件名、路径、tag、frontmatter 搜索。
- `list_recent_notes`：读取最近打开或最近修改的笔记。
- `read_note_outline`：读取单篇笔记标题结构。

每个工具都必须定义：

- `name`
- `description`
- `input schema`
- `permission level`
- `cost profile`
- `output budget`
- `failure behavior`
- `status message`

### v3: Skills / Context Packs

Skill 不应被设计成“随便执行一段隐藏 prompt”，而应该是结构化能力包：

- 适用场景。
- 可用工具集合。
- 上下文组织策略。
- 输出格式约束。
- 风险与权限声明。

适合的早期 skills：

- 周报生成。
- 项目复盘。
- 读书笔记问答。
- 会议纪要整理。
- 任务提取。

v3 仍默认只读，不直接写入笔记。

### v4: 受控写入与长期任务

写入能力需要更严格的产品和架构边界：

- 所有写入动作必须 preview / confirm。
- UI 必须展示修改目标、修改内容和操作后果。
- Runtime 必须记录 action、input、target 和 result。
- 用户取消后不得继续执行写入。
- 对多文件修改，应提供明确的范围摘要。

早期可考虑的写入动作：

- 追加回答到当前笔记。
- 生成一段待插入草稿。
- 创建任务列表草稿。
- 更新指定 callout 或指定 section，且必须先 preview。

## 分阶段路线图与验收标准

### Phase 1: Agentic Memory Retrieval

当前代码已经从 Phase 1 的 `planner -> optional retrieve -> final answer` 演进为 `presearch Memory -> planner -> optional tools -> final answer`。除 `skip-memory` 外，Chat 会先用用户原始输入检索当前 vault 的 Memory，将命中的 path、chunk、score 和短摘录作为不可信资料交给 planner；planner 可在候选足够时直接 `answer`，也可继续调用 `search_memory` 或其他只读工具。Planner 通过 `use_memory` 显式决定最终回答是否引用 presearch Memory，因此隐式笔记问题可以引用本轮 Memory sources，普通知识问题即使命中无关 Memory 也不会切到 Memory prompt。Planner fallback 复用本轮已收集的 current note context，并只在有补充 Memory search 或 presearch 通过相关性守卫时复用 Memory documents，不再额外做 raw prompt fallback search。最新自动化与 Obsidian test vault smoke 以 tracker 为准。

产品目标：

- Chat 能使用 Memory 回答个人笔记问题。
- 用户在准备或更新 Memory 前看到数据、AI provider 和成本确认。

技术能力：

- Action JSON planner。
- Memory presearch digest。
- 每轮最多 2 次 Memory search，包含 presearch 和补充 `search_memory`。
- Memory approval 复用 MemoryManager，并可在 presearch 阶段触发。
- 轻量状态 timeline。
- Final answer prompt 统一构建。

安全边界：

- 只读 Memory。
- 不新增写入 tool。
- 不展示完整内部推理。

验收标准：

- `skip-memory` 以外的问题会先用原始输入做 Memory presearch。
- 笔记相关问题可使用 presearch 候选或 planner query 调用 VSS。
- 普通知识问题的 presearch 命中只给 planner 判断，不污染最终回答上下文。
- `skip-memory` 不调用 planner 和 VSS。
- 引用只来自本轮真实 sources。
- Planner 解析失败不导致 Chat 失败。

### Phase 2: 只读工具扩展与 Memory Presearch

产品目标：

- Agent 能理解当前工作区、当前笔记和当前 vault 中与问题相关的 Memory。

技术能力：

- Tool registry。
- Tool schema validation。
- Tool result budget。
- Tool status events。
- Memory presearch digest。

安全边界：

- 只读工具默认可用。
- 工具失败不阻断普通回答。
- 不允许模型直接构造未注册工具调用。

验收标准：

- 每个工具有明确 schema、权限和失败策略。
- UI 能展示工具调用的轻量状态。
- 多工具结果不会突破上下文预算。
- 隐式笔记问题可以先命中 Memory，再由 planner 判断是否直接回答。

### Phase 3: Skills / Context Packs

产品目标：

- 高频工作流有稳定的上下文组织和输出格式。

技术能力：

- Skill registry。
- Skill selection action。
- Skill-specific prompt policy。
- Skill output contract。

安全边界：

- Skill 不直接执行写入。
- Skill 只能选择被允许的只读工具。
- Skill 的 prompt policy 不能覆盖全局 AgentPolicy。

验收标准：

- 至少一个高频 skill 能稳定复用工具和上下文策略。
- Skill 输出格式可测试。
- Skill 不降低普通 Chat 路径稳定性。

### Phase 4: 受控写入与长期任务

产品目标：

- Agent 从“回答问题”演进到“协作完成笔记任务”。

技术能力：

- Write action schema。
- Preview / confirm UI。
- Audit trail。
- Optional rollback metadata。

安全边界：

- 默认不自动写入。
- 用户确认前不修改笔记。
- 多步任务每个写入动作都有明确 target。

验收标准：

- 用户能在执行前看到修改内容。
- 用户取消后不会产生写入副作用。
- 写入日志能说明修改了什么、为什么修改、来源是什么。

## 风险与防护

### 成本上升

Agent loop 会增加 planner 调用和可能的多轮检索。

防护：

- Planner 使用低温短输出。
- 每轮最多 2 次 Memory search。
- `skip-memory` 明确绕过 planner/VSS。
- Memory prepare 继续按需确认。

### 延迟变高

多一步 planning 会增加用户等待。

防护：

- UI 显示 `thinking`、`retrieving`、`answering`。
- Planner 非流式短调用。
- 检索无结果时快速进入回答。

### Prompt injection

笔记内容可能包含恶意或误导性文本。

防护：

- Memory context 明确标记为资料。
- Tool 调用只由 runtime 执行。
- Memory 不允许覆盖 AgentPolicy。
- 写入动作未来必须确认。

### 引用幻觉

模型可能生成不存在的 Memory references。

防护：

- Sources 结构化传入 final prompt。
- Final prompt 明确只能引用 source list。
- 没有 sources 时不输出 Memory references。

### 弱模型 JSON 不稳定

部分 provider 或本地模型可能不稳定输出 action JSON。

防护：

- Schema parsing。
- JSON repair 只做保守处理。
- 解析失败走 fallback。
- 单元测试覆盖异常输出。

### 移动端性能

Mobile 环境更容易受网络、内存和 WebView 限制影响。

防护：

- 不做后台自动 agent 任务。
- Memory 准备按需触发。
- 保留 streaming fallback。
- Tool result 做上下文预算限制。

## 测试策略

### 单元测试

- 默认 Chat 先用原始用户输入做 Memory presearch，并把短摘录 digest 交给 planner。
- Planner 输出 `answer` 时通过 `use_memory` 决定是否使用 presearch 命中的 Memory documents。
- Planner 输出 `retrieve` / `search_memory` 时使用 planner query 继续补充调用 VSS。
- 补充 `search_memory` 结果在 final prompt 中优先于 presearch 候选。
- Memory approval 在 presearch 或后续 `search_memory` 路径触发；用户选择 `Answer now` 后本轮不重复触发 Memory search。
- `skip-memory` 不调用 planner、不调用 VSS。
- 最多执行 2 次 Memory search，presearch 计入上限。
- 重复 query 不重复搜索。
- 检索结果按 source 去重。
- History 剥离旧 Memory references。
- Sources 只来自本轮检索结果。
- Planner JSON 解析失败进入 fallback，并复用本轮已收集上下文。
- Abort 时不触发非流式 fallback。

### 集成验证

- 普通知识问题：Memory ready 时先做 presearch；planner 输出 `use_memory=false` 后不显示 references，随后直接回答。
- 个人笔记问题：显示 query、sources 和 Memory references。
- Memory 未准备：presearch 会触发现有准备确认。
- 用户 Answer now：本轮不查 VSS，普通回答。
- VSS unavailable：普通回答，Chat 不崩溃。
- 流式失败：未收到 chunk 时走现有非流式 fallback。

### 建议命令

```bash
npm test -- __tests__/chat-service.test.ts
npx tsc -noEmit -skipLibCheck
```

## 实施顺序建议

1. 增加 action parser、status types 和 planner 单元测试。
2. 新增 `ChatAgentRuntime`，先让 `answer` 路径通过。
3. 新增 `MemorySearchTool`，把 Memory approval 从 UI 下沉到 retrieve 路径。
4. 接入 final `PromptBuilder`，保持现有 Memory references 格式。
5. 更新 `LLMView`，展示轻量状态。
6. 补齐 fallback、abort、去重和上下文预算测试。
7. 再考虑只读 tools 和 skill registry。

## 术语

- **Memory**：用户笔记的可检索本地记忆副本，普通用户可见概念。
- **VSS**：内部向量检索实现，普通用户不需要理解。
- **Planner**：决定下一步 action 的低温模型调用。
- **Runtime**：执行 action loop、工具调用和状态流转的核心。
- **Tool**：runtime 可执行的结构化能力，v1 只有 `search_memory`。
- **Skill**：面向特定任务的上下文组织和输出策略包。
- **Policy**：权限、费用、安全和引用约束。

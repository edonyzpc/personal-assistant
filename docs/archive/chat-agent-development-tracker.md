# Chat Agent 开发任务计划与进展追踪

> [!IMPORTANT]
> Archived historical record. This document is no longer a design or execution source of truth. Use [PA Agent Architecture Plan](../architecture/pa-agent-architecture-plan.md) and [PA Agent Runtime Lifecycle Plan](../architecture/pa-agent-runtime-lifecycle-plan.md) for current PA Agent work. Any guidance below is historical evidence only; if it conflicts with the current PA Agent docs, the current PA Agent docs win.

## 文档目的

本文档用于追踪 Chat Agent 从 v1 agentic retrieval 到后续 tools、skills、write actions 的开发进度、测试证据、风险处理和关键决策。

设计依据：

- [Chat Agent 架构设计](./chat-agent-architecture.md)

本文档不是架构设计的替代品。涉及产品原则、状态机、组件边界、权限模型、交互策略和风险缓解时，以架构设计为准；本文档只记录执行状态和验证证据。

## 状态标记

| 标记 | 含义 |
| --- | --- |
| `[ ]` | Todo，尚未开始 |
| `[~]` | In progress，正在实现或验证 |
| `[x]` | Done，已完成并有验证证据 |
| `[!]` | Blocked，存在阻塞或需要决策 |

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 当前开发分支 | `master` |
| Phase 1 合并状态 | [x] 本地 `master` 已更新到 `d44d716`，包含 Thinking UI / scroll tracker 校准 |
| 创建日期 | 2026-05-02 |
| 最后回顾 | 2026-05-10，Thinking/streaming scroll 长输出回归 smoke 已完成；Phase 2D review fixes 已完成：full frontmatter metadata search、hard tool context budget、outline cache-miss fallback，并完成重新部署后的 Obsidian smoke |
| 当前阶段 | Phase 2: Read-only Tool Expansion core complete；剩余为 follow-up 观察项 |
| 架构文档 | [x] 已创建 `docs/chat-agent-architecture.md` |
| 文档状态 | [x] 架构文档与 tracker 已按当前实现、Thinking UI 行为、review follow-ups 和 Phase 2 方案校准；后续以本 tracker、`docs/backlog.md` 和 `docs/chat-agent-phase2-readonly-tools-plan.md` 追踪 |
| 实现状态 | [x] Phase 2 只读工具已覆盖 Memory、current note、vault metadata、recent notes、note outline，并通过 `ChatContextItem[]` 统一预算和 `tool-note` prompt block 注入 |
| 测试状态 | [x] Phase 2D + review fixes 的 targeted/full Jest、type check、lint、build、whitespace、`make deploy` 和新增工具 Obsidian smoke 已通过；Thinking scroll 长输出回归已在 2026-05-10 Obsidian test vault smoke 通过；Current Note 无 active Markdown file、presearch 多样本召回和真实混合工具预算仍作为 follow-up |
| 最近结论 | Chat 主路径调整为 `presearch Memory -> planner -> optional tools -> final answer`：planner 会先看到当前 vault 相关 Memory 摘录，摘录标记为不可信资料；最终是否把 Memory 放入回答 prompt 由 `use_memory` 控制，最终引用仍只来自本轮 Memory sources |

## 当前阶段范围

当前 Chat ReAct 主路径：

1. 用户输入后，除 `skip-memory` 外先用原始问题做一次 Memory presearch。
2. Presearch 通过 `MemoryManager.ensureReadyForChat(prompt)` 复用现有数据/AI provider/成本确认；用户确认并成功准备后继续沿用 `auto-refresh-after-prepare`。
3. Presearch 命中的 Memory documents 会生成给 planner 的短摘录 digest，但不会默认进入最终回答上下文。
4. Planner 基于用户问题、recent history、Memory digest 和 tool observations 决定 `answer` 或继续调用只读工具；`answer` 需用 `use_memory` 声明最终回答是否使用 Memory。
5. 如果 planner 输出 `search_memory` / legacy `retrieve(query)`，runtime 会在每轮最多 2 次 Memory search 的总预算内补充检索；presearch 本身计入这个上限，补充检索结果在 final prompt 中优先于 presearch 候选。
6. Planner 失败时 fallback 不再额外用 raw prompt 做 fallback search；只有已执行补充 `search_memory`，或 presearch 结果与原始问题通过相关性守卫时，才把 Memory documents 放入最终 prompt。

Phase 1 历史闭环：

1. 用户输入后，agent 先判断是否需要读取 Memory。
2. 如果需要 Memory，agent 生成适合检索的 query。
3. 只有进入 retrieve 路径时才触发 Memory readiness / approval。
4. 检索结果去重、裁剪并整理为上下文。
5. 最终 LLM 使用用户问题、recent history、memory context 和 sources 回答。

Phase 2A 已完成范围：

1. 引入只读 `ToolRegistry` 基础接口。
2. 将现有 Memory 检索注册为 `search_memory`。
3. 支持显式 `tool` action，并兼容旧 `retrieve(query)`。
4. 让工具失败、未注册工具和非法输入都降级为普通回答。
5. 保持 Memory 内容作为最终回答资料，不把原始 Memory 片段回流给 planner。

Phase 2B 已完成范围：

1. 新增 `get_current_note_context`，只读当前 Markdown 笔记的标题、路径、选区、outline 或光标附近有限内容。
2. Planner 可先读取当前笔记，再根据 observation 决定是否继续调用 `search_memory`。
3. `PromptBuilder` 将当前笔记上下文放入 final prompt，但不把当前笔记来源加入 Memory references callout。
4. 工具观察中的当前笔记内容标记为 `untrusted_content`，只作为资料和检索词线索。

Phase 2C 已完成范围：

1. 在 planner 前先执行 Memory presearch，使用用户原始输入作为 query。
2. 将相关 Memory 候选以 path、chunk、score 和短摘录形式暴露给 planner，并标记为 `untrusted_content`。
3. Presearch 命中的 Memory documents 只在 planner 声明 `use_memory=true` 时进入 final prompt，保证隐式笔记问题可引用本轮 Memory sources，同时避免普通知识问题被无关 Memory 污染。
4. 用户在 presearch 确认中选择 `Answer now` 后，本轮后续 `search_memory` 不再重复触发 Memory 检索。
5. Planner fallback 复用本轮已收集 Memory / current note context。
6. Planner prompt 中所有 JSON 示例（包含 nested `input` 对象）均已按 LangChain template 规则转义，避免真实运行时因模板变量解析失败进入 fallback。
7. 普通知识问题即使 presearch 命中无关 Memory，planner 正常 answer 或 fallback 时也不会输出空 `Memory references` 或注入无关 Memory prompt。

Phase 2D 已完成范围：

1. 新增 `search_vault_metadata`，基于 Markdown 文件名、路径、tag、frontmatter 搜索。
2. 新增 `list_recent_notes`，按最近修改或创建时间列出 Markdown notes。
3. 新增 `read_note_outline`，读取指定 Markdown path 的标题结构，优先使用 Obsidian metadata cache，必要时只读文件内容 fallback。
4. 将非 Memory / 非 current note 的只读工具结果统一包装为 `<tool_context>`，并标记为 `read_only_tool_not_memory_source`。
5. Planner observations 对这些工具只暴露裁剪后的 `untrusted_content`，最终回答也不能把 tool context path 当成 Memory references。
6. `search_vault_metadata` 检索使用完整 primitive frontmatter key/value，返回给模型的仍是 bounded preview。
7. Metadata query、outline path 和 `<tool_context>` 注入都已有长度上限 / hard budget，并由回归测试覆盖。

Phase 2 仍不实现 skills、写入动作、长期任务、外部网络工具或用户可见实验开关。

## Milestone 追踪

| Phase | Goal | Status | Owner/Notes | Evidence |
| --- | --- | --- | --- | --- |
| Phase 0 | 完成架构文档和任务追踪文档 | [x] Done | 当前 HEAD 已包含架构与 tracker | `docs/chat-agent-architecture.md`、`docs/chat-agent-development-tracker.md` |
| Phase 1 | Agentic Memory Retrieval | [x] Done | 核心实现目标和 Thinking/scroll UI 回归验证均已完成 | `npm test -- __tests__/chat-service.test.ts`；`npm test -- --runInBand`；`npm run lint`；`npx tsc -noEmit -skipLibCheck`；`make deploy`；Obsidian UI smoke；Thinking/scroll code review |
| Phase 2 | 只读工具扩展 | [x] Done | Core complete：Memory、current note、metadata、recent notes、outline 均已实现并验证；剩余项转为非阻塞 follow-up | `docs/chat-agent-phase2-readonly-tools-plan.md`；Phase 2D verification records |
| Phase 3 | Skills / Context Packs | [ ] Todo | 后续迭代占位 | Phase 2 core 已稳定；进入前仍可继续收集 follow-up 观察项 |
| Phase 4 | 受控写入与长期任务 | [ ] Todo | 后续迭代占位 | 待只读工具和审批模型稳定 |

## Phase 1 任务表

| Task | Files/Area | Status | Acceptance | Test Evidence |
| --- | --- | --- | --- | --- |
| 定义 agent 基础类型 | `src/ai-services/chat-agent.ts` | [x] Done | 有 `ChatAgentStatus`、planner action、memory search result 等类型；不破坏现有 `streamLLM` 外部调用 | `npx tsc -noEmit -skipLibCheck` |
| 新增 action parser | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | 支持 `answer` 和 `retrieve(query)`；非法 JSON 或非法 schema 可识别为 fallback | `planner action parser` tests |
| Planner 单元测试 | `__tests__/chat-service.test.ts` | [x] Done | 覆盖合法 action、fenced JSON、缺失 query | `npm test -- __tests__/chat-service.test.ts` |
| 新增 `ChatAgentRuntime` | `src/ai-services/chat-agent.ts` | [x] Done | 能执行 `presearch -> plan -> optional tools -> final answer`；每轮最多 2 次 Memory search；重复 query 去重 | `counts presearch toward the per-turn memory search limit` |
| Runtime abort 处理 | `src/ai-services/chat-agent.ts` | [x] Done | `AbortSignal` 能中断 planning、retrieving、answering；用户主动取消不触发非流式 fallback | Existing abort fallback policy test + type check |
| Runtime status events | `src/ai-services/chat-agent.ts`、`src/chat-view.ts` | [x] Done | 能发出 `thinking`、`retrieving`、`retrieved`、`memory-skipped`、`answering`、`fallback` | fallback status test；UI wiring type checked |
| 实现 `ChatPlanner` | `src/ai-services/chat-agent.ts` | [x] Done | 低温、非流式调用当前 chat model；只输出 action-only JSON；不展示完整内部推理 | parser/runtime tests |
| Planner prompt 策略 | `src/ai-services/chat-agent.ts` | [x] Done | 普通知识、翻译、润色、代码解释走 `answer`；用户笔记、项目记录、历史决策走 `retrieve` | Prompt implemented；behavior covered through mocked actions |
| Planner prompt 模板转义 | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | LangChain prompt template 中的 JSON 示例和 nested `input` 对象均使用双花括号转义，避免 planner 因模板变量解析失败进入 fallback | `escapes planner JSON examples for LangChain prompt templates` |
| 新增 `MemorySearchTool` | `src/ai-services/chat-agent.ts` | [x] Done | presearch 与 planner 后续 `search_memory` 都经由 `MemoryManager.ensureReadyForChat(query)` | `uses planner query for memory retrieval` |
| Memory approval runtime 化 | `src/chat-view.ts`、`src/ai-services/chat-agent.ts` | [x] Done | `chat-view.ts` 不再发送前固定调用 `ensureReadyForChat(prompt)`；runtime 在 presearch / `search_memory` 路径内处理 approval | Phase 2C presearch tests |
| VSS retrieve query 使用 | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | `vss.searchSimilarity` 使用 planner query，而不是用户原始 prompt | `uses planner query for memory retrieval` |
| Source 去重和裁剪 | `src/ai-services/chat-agent.ts` | [x] Done | 按 `path + chunkIndex` 去重；最多注入 4 个 chunks；有长度预算 | Type check；duplicate query/source path covered indirectly |
| 新增 `PromptBuilder` | `src/ai-services/chat-agent.ts` | [x] Done | 统一构建 final answer prompt、history、memory context 和 references；fallback 复用 final prompt | `strips trailing memory reference callouts...` |
| History budget | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | 默认只带最近 8 条消息；继续剥离 assistant 历史里的旧 Memory references | `strips trailing memory reference callouts...` |
| Memory references 约束 | `src/ai-services/chat-service.ts`、`src/ai-services/chat-agent.ts` | [x] Done | 只引用本轮真实 sources；无 sources 时不输出 Memory references | `allowed_sources` assertion |
| `skip-memory` 行为 | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | 不调用 planner、不调用 VSS，直接普通回答 | `skips planner and memory lookup...` |
| Planner fallback | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | Planner 解析失败时 Chat 不失败；fallback 复用本轮已收集且通过相关性守卫的 context，不再额外 raw prompt 检索 | `falls back when planner output cannot be parsed`；`does not include unrelated presearched memory when planner fallback is used` |
| UI 轻量状态 | `src/chat-view.ts` | [x] Done | Chat 中能显示判断、检索、跳过 Memory、fallback、回答状态；不展示完整内部推理 | 普通、检索、取消、Memory 未准备路径 UI smoke passed |
| Thinking 状态 UI 优化 | `src/chat-view.ts`、`src/custom.css`、`styles.css` | [x] Done | 同一轮请求只渲染一个 `Thinking` 状态块；摘要只显示最新状态；展开后查看详情；不再以多条 `Memory` 消息刷屏 | Code review: `fix(chat-ui): improve thinking status scrolling` |
| Streaming 滚动策略修复 | `src/chat-view.ts` | [x] Done | 用户展开 Thinking 或向上查看历史时暂停自动跟随；用户回到底部附近后恢复 streaming 自动滚动 | Code review: scroll listener resumes auto-scroll independent of wheel events |
| Streaming fallback 保持 | `src/ai-services/chat-service.ts`、`__tests__/chat-service.test.ts` | [x] Done | 未收到 chunk 时可非流式 fallback；收到部分 chunk 后不重试；abort 不 fallback | Existing streaming fallback policy tests |
| Targeted tests | `__tests__/chat-service.test.ts` | [x] Done | `npm test -- __tests__/chat-service.test.ts` 通过 | Passed 2026-05-02 |
| Type check | TypeScript project | [x] Done | `npx tsc -noEmit -skipLibCheck` 通过 | Passed 2026-05-02 |

## Phase 1 收尾验证计划

目标：确认 `presearch Memory -> planner -> optional tools -> final answer` 主路径不仅在 service/runtime 层通过测试，也能在真实 Chat 使用路径中保持产品体验、取消行为和安全边界稳定。

| Verification Item | Area | Status | Acceptance | Evidence |
| --- | --- | --- | --- | --- |
| 文档状态校准 | `docs/chat-agent-architecture.md`、`docs/chat-agent-development-tracker.md` | [x] Done | 文档准确说明当前实现、状态映射、fallback 路径、`use-memory` 语义和待验证项 | 2026-05-09 docs calibration |
| 自动化基线刷新 | Chat service/runtime | [x] Done | targeted Chat tests、type check、lint 通过 | 16 targeted tests passed on 2026-05-09 |
| 全量 Jest 刷新 | Jest suite | [x] Done | `npm test -- --runInBand` 在当前 rebase 后通过 | 18 suites / 132 tests passed on 2026-05-09 |
| 文档 whitespace 检查 | Markdown diff | [x] Done | `git diff --check` 通过 | Passed 2026-05-09 |
| UI smoke：普通问题 | Chat UI | [x] Done | 普通知识/写作问题会先做 Memory presearch；planner 判定 `use_memory=false` 时不显示 references | 2026-05-09 Obsidian test vault：`HTTP 404 是什么意思？` 显示 presearch / planning / answering，无 fallback、无 Memory references |
| UI smoke：笔记问题 | Chat UI + Memory | [x] Done | 隐式或显式笔记问题可通过 presearch 命中 Memory，展示 sources，回答只引用本轮 sources | 2026-05-09 Obsidian test vault：`agent意图安全有几个阶段？` 命中并引用 `2026-05-01.md`，回答“三大阶段” |
| UI smoke：Memory 未准备 | Chat UI + Memory approval | [x] Done | Presearch 会触发现有 Memory approval；`Answer now` 后本轮不调用 VSS，也不重复请求 Memory | 2026-05-09 Obsidian test vault：Memory 未准备状态时机 smoke passed |
| UI smoke：取消路径 | Chat UI + AbortSignal | [x] Done | planning、retrieving、answering 阶段取消后不继续追加回答，不启动新的 fallback | Obsidian test vault: 长回答生成中点击 `✕` 后显示 `Generation cancelled`，未继续追加 fallback |
| Runtime：Answer now | Chat service/runtime | [x] Done | Memory approval 返回 `answer-now` 时本轮不调用 VSS，普通回答继续完成 | `answers without VSS when memory approval chooses answer now` |
| Runtime：approval cancel | Chat service/runtime | [x] Done | Memory approval 返回 `cancel` 时抛出 AbortError，不调用 VSS，不进入 fallback | `aborts without fallback when memory approval is cancelled` |
| Adversarial Memory references | Prompt / Memory sources | [x] Done | Memory 内容要求越权、伪造引用或改写规则时，最终回答仍只按 allowed sources 引用 | `keeps allowed memory references limited to retrieved source metadata` |
| UI regression：Thinking 展开与滚动 | Chat UI streaming | [x] Done | Streaming 过程中 Thinking 可展开；用户滚到上方历史时不被拉回底部；回到底部后自动滚动恢复 | 2026-05-10 Obsidian test vault：220-line streamed response 中用 `PageUp` 离开底部未被拉回，`End` 回到底部后可看到最终响应和正常 action-button 状态 |
| Phase 1 Core Done 判定 | Release readiness | [x] Done | 核心 planner-driven retrieve、Memory approval、引用约束和取消路径已完成；最新 UI polish 回归已在 2026-05-10 smoke 关闭 | Phase 1 core closed on 2026-05-09；Thinking/scroll regression closed on 2026-05-10 |

### Memory 未准备路径复测指引

这个场景已在 2026-05-09 手动通过。后续回归时需要把 test vault 临时切到 `Memory needs setup` 或 `local-memory-missing` 状态。该操作只影响本地 Memory 缓存，不会修改或删除笔记；如果选择重新准备 Memory，可能会消耗 AI credits/API calls。为避免成本，验证时优先点击 `Answer now`。

1. 确认当前已部署最新插件：运行过 `make deploy`，并在 Obsidian test vault 中 reload / re-enable plugin。
2. 打开命令面板，确认能看到高级 Memory 命令。如果看不到 `Reset local memory copy`，先到 Personal Assistant 设置里打开 advanced memory controls。
3. 执行 `Personal Assistant: Reset local memory copy`，在确认框中确认 reset。预期状态栏从 `Memory ready` 变为 `Memory needs setup` 或等价未准备状态。
4. 先问一个普通问题，例如 `请用一句话解释什么是 HTTP 404？`。预期由于 presearch 需要 Memory，会弹出 Memory 准备确认；点击 `Answer now` 后本轮正常回答，不调用 VSS，不显示 Memory references。
5. 恢复 Memory ready 后，问隐式笔记问题 `agent意图安全有几个阶段？`。预期先显示 `Finding related memory:`，命中 `2026-05-01.md`，planner 可直接回答并展示 Memory references。
6. 再问需要补充检索的问题时，允许看到后续 `Searching memory:`，但同一轮如果已经选择 `Answer now` 不应重复请求 Memory。
7. 可选恢复：验证结束后运行 `Prepare Memory` 或再次提出笔记问题并选择 `Prepare memory and answer`，确认成本提示后恢复 `Memory ready`。

### Thinking / Streaming UI 回归验证指引

该场景用于验证最新 `Thinking` 单块状态和 streaming 滚动修复。它不需要重置 Memory，优先在已经部署最新插件的 Obsidian test vault 中执行。

1. 提交一个会持续流式输出的长回答问题，例如 `请写一篇不少于3000字的中文长文，主题是浏览器缓存、HTTP 404、CDN、以及前端排障之间的关系。`
2. 在回答还在 streaming 时点击 `Thinking` 左侧箭头或状态行。预期详情可以展开/收起，不会因为新 chunk 刷新而失效。
3. 展开后观察摘要行。预期默认只保留一行最新状态，例如 `Answering...`，历史状态只在详情中展示。
4. Streaming 过程中向上滚动到更早的聊天记录。预期视口停留在用户选择的位置，不被新 chunk 或 status 更新强行拉回底部。
5. 再滚回底部附近。预期后续 chunk 自动跟随到底部，直到回答结束。
6. 回答结束时可观察是否有明显闪烁或布局跳动。轻微最终渲染切换仍可接受，已在 `docs/backlog.md` 中单独跟踪为后续优化。

## Phase 2 计划：只读工具扩展

目标：把 Phase 1 的 `MemorySearchTool` 演进为 tool registry 的第一个工具 `search_memory`，并增加更多只读上下文工具。

详细方案见：`docs/chat-agent-phase2-readonly-tools-plan.md`。

当前 MVP 任务：

- [x] 设计 tool registry 接口。
- [x] 将 `MemorySearchTool` 注册为 `search_memory`。
- [x] 增加 `get_current_note_context`，读取当前笔记标题、路径、选区、outline 或附近段落。
- [x] 扩展 planner action protocol，支持显式 `tool` action，并兼容 Phase 1 `retrieve(query)`。
- [x] 将 tool observations 交给 `PromptBuilder` 做上下文预算和来源约束。当前 Memory、current note、vault metadata、recent notes 和 note outline 都会先转换为 `ChatContextItem[]`，再统一去重、限制总 context 预算；Memory 仍走独立 `memory_content` / `allowed_sources`，current note / tool context 不混入 Memory references。
- [x] 为每个工具记录 `name`、`description`、`input schema`、`permission level`、`cost profile`、`output budget`、`failure behavior`、`status message`。
- [x] 扩展 status timeline，展示只读工具调用摘要。
- [x] 增加 Memory presearch 状态，展示 `Finding related memory` 和 presearch 命中的 sources。
- [x] 在 planner 输入中加入 Memory relevance digest，让隐式笔记问题也能先看到当前 vault 相关记录。

后续只读工具候选：

- [x] 增加 `search_vault_metadata`，基于文件名、路径、tag、frontmatter 搜索。
- [x] 增加 `list_recent_notes`，读取最近修改或最近创建的笔记。
- [x] 增加 `read_note_outline`，读取单篇笔记标题结构。

验收标准：

- [x] 工具失败不阻断普通回答。
- [x] UI 能展示轻量 tool 状态。
- [x] 多工具结果不会突破上下文预算。`search_memory` 继续沿用 Memory 文档数和字符预算，`get_current_note_context` 使用选区/附近内容预算和最多 2 个 current note context，二者再进入统一 `MAX_TOTAL_CONTEXT_CHARS` 总预算。
- [x] 模型不能直接构造未注册工具调用。
- [x] 隐式笔记问题可通过 presearch 命中 Memory 并由 planner 直接 answer。

Phase 2 follow-up / deferred（非阻塞）：

- [x] Phase 2D review findings 已修复：full primitive frontmatter metadata search、metadata query/path 输入边界、hard `<tool_context>` budget、outline cache-miss fallback test、`tool-note` docs 校准。
- [x] Phase 2D 新增只读工具 Obsidian UI smoke 已通过：metadata search、recent notes、note outline 均在重新 deploy / reload 后用 fresh Chat 验证。
- [x] 后续新增更多工具时，扩展 `tool-note` / 其他 `ChatContextItem` 渲染策略，避免为新工具重新开一条 prompt 注入路径。Phase 2D 已用 `<tool_context>` 覆盖 metadata / recent / outline 三个只读工具。
- [~] 补 Obsidian UI smoke：`get_current_note_context` 的选区、附近内容、无 active Markdown file、混合 current note + Memory search。附近内容、选区、chat sidebar focus 下读取打开的 Markdown leaf、混合 current note + Memory search 已通过；无 active Markdown file 仍保留为手动 smoke。
- [x] Obsidian UI smoke：长 streaming 回答时展开 Thinking、向上滚动、回到底部后的自动跟随恢复。2026-05-10 test vault smoke 已验证 220-line streamed response 中 `PageUp` 不会被强制拉回底部，`End` 回到底部后显示最终响应和正常 action-button 状态。
- [~] 评估 raw prompt presearch 在长问题、口语化问题中的召回质量，再决定是否引入轻量 query cleanup 或 planner 生成补充 query。口语化隐式笔记问题已确认 presearch 命中 `2026-05-01.md`；完整回答因 provider 流式过慢被手动取消，仍需更多样本。
- [~] 在真实混合工具问题中调优 observation digest 和总上下文预算。自动化已覆盖 metadata / recent / outline 的 prompt 注入、hard budget 和预算截断路径；Obsidian 已验证单工具路径，真实多工具组合样本仍需继续观察。
- [x] Phase 2 后续只读工具候选已实现：`search_vault_metadata`、`list_recent_notes`、`read_note_outline`。

## Phase 3 计划：Skills / Context Packs

目标：让 agent 能为高频任务选择稳定的上下文组织策略和输出格式。

任务占位：

- [ ] 设计 skill registry。
- [ ] 定义 skill metadata：适用场景、可用工具、上下文策略、输出格式、风险声明。
- [ ] 支持 skill selection action。
- [ ] 实现第一个只读 skill，例如项目复盘或读书笔记问答。
- [ ] 为 skill 输出增加格式化测试。
- [ ] 确保 skill prompt policy 不能覆盖全局 AgentPolicy。

早期候选 skills：

- [ ] 周报生成。
- [ ] 项目复盘。
- [ ] 读书笔记问答。
- [ ] 会议纪要整理。
- [ ] 任务提取。

验收标准：

- [ ] 至少一个 skill 能稳定复用工具和上下文策略。
- [ ] Skill 输出格式可测试。
- [ ] Skill 不直接写入笔记。
- [ ] Skill 不降低普通 Chat 路径稳定性。

## Phase 4 计划：受控写入与长期任务

目标：在只读工具和 skill 架构稳定后，逐步支持需要用户确认的写入动作。

任务占位：

- [ ] 设计 write action schema。
- [ ] 设计 preview / confirm UI。
- [ ] 设计 audit trail，记录 action、input、target、sources、result。
- [ ] 支持追加回答到当前笔记。
- [ ] 支持生成待插入草稿。
- [ ] 支持创建任务列表草稿。
- [ ] 支持更新指定 section 或 callout，执行前必须 preview。
- [ ] 明确取消路径，用户确认前不修改笔记。

验收标准：

- [ ] 用户能在执行前看到 target 和 content/diff preview。
- [ ] 用户取消后不会产生写入副作用。
- [ ] 写入范围清晰。
- [ ] 写入日志能说明修改了什么、为什么修改、引用了哪些来源。

## 风险表

| Risk | Impact | Mitigation | Status |
| --- | --- | --- | --- |
| Planner JSON 不稳定 | 普通问题或检索路径判断失败 | action parser + schema validation + fallback | [x] 自动化覆盖 |
| Planner prompt 模板转义遗漏 | LangChain 将 JSON 示例里的 `{}` 当作模板变量，导致 planner 失败并误入 fallback | JSON 示例使用 `{{...}}` 转义并增加回归测试 | [x] 已修复并覆盖 |
| 成本上升 | 多一次 planner 调用和可能的多轮检索 | 低温短 planner、每轮最多 2 次 Memory search、`skip-memory` 绕过 | [x] 代码约束已实现 |
| 延迟变高 | 用户感觉 Chat 变慢 | 轻量状态 timeline、快速无结果路径、streaming final answer | [~] Phase 1 smoke 可接受；后续仍需真实使用中观察 latency |
| Memory approval 时机错误 | 用户不了解数据/成本或本轮重复弹确认 | approval 统一由 MemoryManager 在 presearch / `search_memory` 路径处理；`Answer now` 本轮生效 | [x] 自动化覆盖 |
| 引用幻觉 | 回答引用不存在或非本轮来源 | sources 结构化传入，只允许引用本轮 sources | [x] prompt 约束已实现 |
| Prompt injection | 笔记内容影响 agent 权限或工具调用 | Memory 作为资料，工具调用由 runtime 执行，Policy 不被 Memory 覆盖 | [~] references adversarial test 已补，后续 tool/permission injection 待 Phase 2 扩展 |
| Abort 漏传 | 用户取消后仍继续检索或回答 | `AbortSignal` 贯穿 planner、tool、final LLM | [x] 代码路径已实现 |
| UI 状态噪音 | 用户被过多内部细节打扰 | 单个 `Thinking` 状态块只显示最新摘要，详情折叠展示；不展示完整内部推理 | [x] 代码已按最新 UI 要求优化 |
| Streaming 滚动打断用户阅读 | 用户展开 Thinking 或查看历史时被新 chunk 拉回底部 | 用户离开底部时暂停自动跟随，回到底部附近后恢复 | [x] 代码已修复，2026-05-10 Obsidian UI 回归 smoke 已通过 |
| 最终消息重渲染轻微抖动 | 长回答结束时可能有轻微 flicker 或 layout shift | 暂保留当前 remove/re-render 策略，后续考虑原地更新 | [ ] 已记录到 `docs/backlog.md` |
| 文档与实现漂移 | reviewer 无法判断当前能力和待验证项 | 文档状态校准并由 tracker 记录最新验证计划 | [x] 2026-05-09 已校准 |

## 验证记录

| Date | Command/Scenario | Result | Notes |
| --- | --- | --- | --- |
| 2026-05-02 | 创建架构文档 | [x] Done | `docs/chat-agent-architecture.md` 已创建 |
| 2026-05-02 | 创建开发 tracker | [x] Done | `docs/chat-agent-development-tracker.md` 已创建 |
| 2026-05-02 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 12 tests passed |
| 2026-05-02 | `npm test -- --runInBand` | [x] Passed | 18 suites / 111 tests passed |
| 2026-05-02 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-02 | `npm run lint` | [x] Passed | ESLint passed for `src` and `__mocks__` |
| 2026-05-02 | 普通知识问题不查 VSS | [x] Passed | `answers without memory when planner chooses answer` |
| 2026-05-02 | 笔记相关问题使用 planner query 检索 | [x] Passed | `uses planner query for memory retrieval` |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 12 tests passed after rebase/docs review |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after rebase/docs review |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed for `src` and `__mocks__` after rebase/docs review |
| 2026-05-09 | `git diff --check` | [x] Passed | Docs calibration diff has no whitespace errors |
| 2026-05-09 | `npm test -- --runInBand` | [x] Passed | 18 suites / 128 tests passed after docs tracker update |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 13 tests passed after adversarial references test |
| 2026-05-09 | `npm test -- --runInBand` | [x] Passed | 18 suites / 129 tests passed after adversarial references test |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after adversarial references test |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after adversarial references test |
| 2026-05-09 | `git diff --check` | [x] Passed | Current diff has no whitespace errors |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 15 tests passed after Memory approval runtime tests |
| 2026-05-09 | `npm test -- --runInBand` | [x] Passed | 18 suites / 131 tests passed after Memory approval runtime tests |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after Memory approval runtime tests |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after Memory approval runtime tests |
| 2026-05-09 | `git diff --check` | [x] Passed | Current diff has no whitespace errors after Memory approval runtime tests |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 16 tests passed after planner prompt template escaping regression |
| 2026-05-09 | `make deploy` | [x] Passed | 18 suites / 132 tests passed, lint/build completed, plugin assets copied to test vault |
| 2026-05-09 | Obsidian UI smoke：普通问题 | [x] Passed | Reloaded test vault after deploy；HTTP 404 问题只显示 thinking -> answering，无 fallback / retrieve / Memory references |
| 2026-05-09 | Obsidian UI smoke：笔记问题 | [x] Passed | `根据我的笔记，agent意图安全经历了几个阶段？` 触发 `agent意图安全 阶段` 检索，回答“三个阶段”并展示 Memory references |
| 2026-05-09 | Obsidian UI smoke：取消路径 | [x] Passed | 长回答生成中点击 `✕` 后显示 `Generation cancelled` notice 和取消消息，未继续追加 fallback |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | Final check after tracker/UI smoke update: 16 tests passed |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | Final check after tracker/UI smoke update |
| 2026-05-09 | `npm run lint` | [x] Passed | Final check after tracker/UI smoke update |
| 2026-05-09 | `git diff --check` | [x] Passed | Final check after tracker/UI smoke update |
| 2026-05-09 | Obsidian UI smoke：Memory 未准备 | [x] Passed | Reset local memory copy 后状态为 `Memory needs setup`；普通 HTTP 404 不弹确认；笔记问题触发 Memory 准备确认；点击 `Answer now` 后显示 `Memory was not used for this answer.`，状态仍为 `Memory needs setup`；随后补充回归断言确保 answer-now 不发出 `retrieving` 状态 |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 16 tests passed after status timing fix |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after status timing fix |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after status timing fix |
| 2026-05-09 | `git diff --check` | [x] Passed | Whitespace check passed after status timing fix |
| 2026-05-09 | `make deploy` | [x] Passed | 18 suites / 132 tests passed, lint/build completed, plugin assets copied to test vault after status timing fix |
| 2026-05-09 | Obsidian UI smoke：Memory 未准备状态时机 | [x] Passed | Reloaded test vault after deploy；note-related prompt showed `Thinking...` then Memory approval；`Answer now` showed `Memory was not used for this answer.` and `Answering...` without `Searching memory` or Memory references |
| 2026-05-09 | Code review：Thinking 状态 UI 与 streaming 滚动修复 | [x] Reviewed | 当前 HEAD `fix(chat-ui): improve thinking status scrolling`：单个 `Thinking` 状态块、可折叠详情、展开暂停自动跟随、scroll 事件恢复 auto-scroll |
| 2026-05-09 | Code review：reference block regex | [x] Reviewed | 支持 `Memory references`、`RAG Referenc`、`RAG Reference`、`RAG References`；自动化测试确认不剥离拼写错误的 `RAG Referencs` |
| 2026-05-09 | Obsidian UI smoke：Thinking 展开与 scroll resume | [~] Partial | 真实 streaming 中可展开 Thinking 并看到 presearch / planning 详情；点击 `✕` 后显示 `Generation cancelled`。长输出中向上滚动、回到底部后恢复 auto-scroll 仍待补。 |
| 2026-05-10 | Obsidian UI smoke：Thinking 展开与 scroll resume | [x] Passed | Reloaded test vault after `make deploy`；220-line streamed response 过程中 Thinking 可展开，`PageUp` 离开底部后没有被新 chunk 强制拉回，`End` 回到底部后显示最终响应和正常 action-button 状态。 |
| 2026-05-09 | `git diff --check` | [x] Passed | Docs calibration for latest UI Thinking / scroll state has no whitespace errors |
| 2026-05-09 | Phase 1 fast-forward merge to local `master` | [x] Done | `master` updated from `6297e6e` to `6ceb104`，随后同步到 `d44d716` |
| 2026-05-09 | 创建 Phase 2 只读工具方案 | [x] Done | `docs/chat-agent-phase2-readonly-tools-plan.md` |
| 2026-05-09 | Phase 2 分支 rebase 到最新 `master` | [x] Done | `codex/chat-agent-phase2-tools-plan` rebased onto `d44d716`；tracker 冲突已合并，保留 Phase 2 计划项，Thinking UI 回归项后续由 2026-05-10 smoke 关闭 |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 24 tests passed after Phase 2A review fixes: sanitized tool errors, no raw Memory snippets in planner observations, duplicate tool input coverage |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after Phase 2A review fixes |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after Phase 2A review fixes |
| 2026-05-09 | `npm run build` | [x] Passed | Type check, Tailwind build, and production esbuild passed after Phase 2A review fixes; Browserslist data warning only |
| 2026-05-09 | `git diff --check` | [x] Passed | Whitespace check passed after Phase 2A review fixes |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 27 tests passed after Phase 2B current note tool: selected text, missing active note, mixed current note + Memory search |
| 2026-05-09 | `npm test -- --runInBand` | [x] Passed | 18 suites / 143 tests passed after Phase 2B current note tool |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after Phase 2B current note tool |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after Phase 2B current note tool |
| 2026-05-09 | `npm run build` | [x] Passed | Type check, Tailwind build, and production esbuild passed after Phase 2B current note tool; Browserslist data warning only |
| 2026-05-09 | `git diff --check` | [x] Passed | Whitespace check passed after Phase 2B current note tool |
| 2026-05-09 | Obsidian UI smoke：Current Note 工具 | [~] Partial | `这篇笔记的技术演进阶段有哪些？` 触发 `Reading current note` 并读取 `2026-05-01.md` 附近内容；选区总结触发 `Read selected text from current note`；`Agent 意图安全 + 狗的记录` 混合问题先 presearch，再补充 `Searching memory: 狗...` 并引用 `0.unsorted/Dog.md`。无 active Markdown file 手动 smoke 仍待补。 |
| 2026-05-09 | Obsidian UI smoke：口语化 raw prompt presearch | [~] Partial | `我前几天好像记过一条关于 agent 安全技术演进的笔记...` 先显示 `Finding related memory`，命中 `2026-05-01.md` 并进入 `Answering...`；provider 流式输出过慢，手动取消后未记录完整最终回答。 |
| 2026-05-09 | Phase 2B review fixes | [x] Done | Current note prompt isolation, bounded selection/nearby read, fallback context preservation, Thinking copy, tracker completion calibration |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 31 tests passed after Phase 2B review fixes |
| 2026-05-09 | `npm test -- --runInBand` | [x] Passed | 18 suites / 147 tests passed after Phase 2B review fixes |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after Phase 2B review fixes |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after Phase 2B review fixes |
| 2026-05-09 | `npm run build` | [x] Passed | Type check, Tailwind build, and production esbuild passed after Phase 2B review fixes; Browserslist data warning only |
| 2026-05-09 | `git diff --check` | [x] Passed | Whitespace check passed after Phase 2B review fixes |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 40 tests passed after planner structured content parsing, `use_memory` gating, and supplemental Memory priority fixes |
| 2026-05-09 | `npm test -- --runInBand` | [x] Passed | 18 suites / 156 tests passed after planner structured content parsing, `use_memory` gating, and supplemental Memory priority fixes |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after planner structured content parsing, `use_memory` gating, and supplemental Memory priority fixes |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after planner structured content parsing, `use_memory` gating, and supplemental Memory priority fixes |
| 2026-05-09 | `npm run build` | [x] Passed | Type check, Tailwind build, and production esbuild passed after planner structured content parsing, `use_memory` gating, and supplemental Memory priority fixes; Browserslist data warning only |
| 2026-05-09 | `git diff --check` | [x] Passed | Whitespace check passed after Phase 2C Memory presearch |
| 2026-05-09 | Phase 2C review fixes | [x] Done | Presearch now counts toward the per-turn Memory search limit; architecture docs are being aligned with the presearch-first runtime |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 42 tests passed after fallback relevance guard and nested planner JSON template escaping |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after fallback relevance guard and nested planner JSON template escaping |
| 2026-05-09 | `make deploy` | [x] Passed | 18 suites / 158 tests passed, lint/build completed, plugin assets copied to test vault; Browserslist data warning only |
| 2026-05-09 | Obsidian UI smoke：普通问题 | [x] Passed | Reloaded test vault after deploy；`HTTP 404 是什么意思？` showed presearch / planning / answering, no fallback, no Memory references |
| 2026-05-09 | Obsidian UI smoke：隐式笔记问题 | [x] Passed | Reloaded test vault after deploy；`agent意图安全有几个阶段？` found Memory candidates, did not enter planner fallback, answered “三大阶段”, and referenced `2026-05-01.md` |
| 2026-05-09 | `git diff --check` | [x] Passed | Whitespace check passed after final Phase 2C smoke/doc calibration |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 55 tests passed after Phase 2D metadata / recent / note outline tools, `tool-note` context, and mixed Memory/tool reference boundary coverage |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after Phase 2D readonly tool expansion |
| 2026-05-09 | `npm test -- --runInBand` | [x] Passed | 18 suites / 171 tests passed after Phase 2D readonly tool expansion |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after Phase 2D readonly tool expansion |
| 2026-05-09 | `npm run build` | [x] Passed | Type check, Tailwind build, and production esbuild passed after Phase 2D readonly tool expansion; Browserslist data warning only |
| 2026-05-09 | `git diff --check` | [x] Passed | Whitespace check passed after Phase 2D readonly tool expansion |
| 2026-05-09 | `make deploy` | [x] Passed | 18 suites / 171 tests passed, lint/build completed, plugin assets copied to test vault; Browserslist data warning only |
| 2026-05-09 | Obsidian UI smoke：Phase 2D 只读工具 | [x] Passed | Reloaded test vault after deploy；`最近修改的3篇笔记有哪些？只列路径。` showed `Listing recent modified notes` and returned 3 paths；`按文件名 metadata 搜索 Dog 笔记，只列路径。` showed `Searching note metadata: Dog` and returned `0.unsorted/Dog.md`；`读取 2026-05-01.md 的标题结构，只列标题。` showed `Reading note outline: 2026-05-01.md` and returned 2 headings |
| 2026-05-09 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 59 tests passed after review fixes for full frontmatter metadata search, hard tool context budget, and outline cache-miss fallback |
| 2026-05-09 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors after review fixes |
| 2026-05-09 | `npm run lint` | [x] Passed | ESLint passed after review fixes |
| 2026-05-09 | `npm test -- --runInBand` | [x] Passed | 18 suites / 175 tests passed after review fixes |
| 2026-05-09 | `npm run build` | [x] Passed | Type check, Tailwind build, and production esbuild passed after review fixes; Browserslist data warning only |
| 2026-05-09 | `git diff --check` | [x] Passed | Whitespace check passed after review fixes |
| 2026-05-09 | Obsidian UI smoke：Phase 2D review fixes | [x] Passed | Ran `make deploy`, reloaded test vault via `Reload app without saving`, confirmed `Memory ready`; fresh Chat smoke passed for `search_vault_metadata` (`Searching note metadata: Dog` -> `0.unsorted/Dog.md`), `list_recent_notes` (`Listed 3 recent note(s).` -> `2026-05-01.md`, `About.md`, `0.unsorted/Dog.md`), and `read_note_outline` (`Read 2 heading(s) from note outline.` -> `Agent意图安全技术趋势`, `一、 技术演进三大阶段`) |

## 执行原则

- Phase 1 只做 agentic memory retrieval，不夹带通用工具、skill 或写入能力。
- UI 保持轻量，优先复用当前 Chat 体验。
- `ChatService.streamLLM(...)` 保持外部入口稳定，内部逐步抽出 runtime、planner、tool 和 prompt builder。
- 测试先覆盖 service/runtime 行为，再补 UI smoke test。
- 后续阶段只在前一阶段验收通过后展开详细任务。

## 最近决策记录

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-05-02 | v1 使用 action-only JSON，不使用纯文本 ReAct 作为执行协议 | 解析更稳定，避免暴露完整内部推理，便于测试和后续工具扩展 |
| 2026-05-02 | Memory approval 下沉到 retrieve 路径 | 普通问题不应该被 Memory 准备确认打断 |
| 2026-05-02 | 不新增用户可见开关 | 直接升级 Chat 主路径，内部保留 fallback 降低风险 |
| 2026-05-02 | 后续按只读工具、skills、受控写入分阶段演进 | 先稳定用户信任模型和只读上下文，再引入写入副作用 |
| 2026-05-09 | 本次只做文档校准，不修改代码 | 当前 Phase 1 主路径已实现，剩余工作是让文档准确反映实现和待验收项 |
| 2026-05-09 | `memoryMode: use-memory` 仍由 planner 判断是否 retrieve | 保持现有语义：允许使用 Memory，但不强制检索 |
| 2026-05-09 | 产品状态与 `ChatAgentStatus` 采用文档映射，不扩展 API | 当前 UI 只需要轻量状态事件，`NeedMemoryApproval`、`Cancelled`、`Error` 作为产品流程状态说明 |
| 2026-05-09 | 明确笔记意图才稳定触发 retrieve | 为降低普通问题误检索，planner 对通用问题保持保守；真实 UI 验证中“根据我的笔记...”能稳定进入检索路径 |
| 2026-05-09 | Phase 1 验证闭环完成 | 自动化、部署、普通问题、笔记检索、取消路径和 Memory 未准备路径均已通过，后续迭代进入 Phase 2 只读工具扩展 |
| 2026-05-09 | `Memory` 状态文案改为 `Thinking`，并合并为单个可折叠状态块 | 更准确表达 planner / retrieval / answering 的整体过程，同时减少状态消息刷屏 |
| 2026-05-09 | Streaming 自动滚动由 scroll 位置恢复，不依赖最近 wheel 事件 | 支持用户通过触控、键盘、滚动条等方式回到底部后恢复自动跟随 |
| 2026-05-09 | 最终 assistant message 原地更新暂不进入本轮修复 | 当前行为正确但可能有轻微结束抖动，作为低风险 follow-up 记录在 `docs/backlog.md` |
| 2026-05-09 | Phase 2 采用显式 `tool` action | 保持 planner 决策透明，避免 runtime 隐式补上下文，便于后续 skills/write action 扩展 |
| 2026-05-09 | Phase 2 MVP 只做 `search_memory` 和 `get_current_note_context` | 先覆盖长期 Memory 与当前笔记两个最高价值上下文来源，控制风险和测试面 |
| 2026-05-09 | Phase 2 暂不引入 schema validation 新依赖 | 当前项目没有现成 validator 依赖，MVP 先用轻量 TypeScript 类型守卫和手写 validator |
| 2026-05-09 | `get_current_note_context` 默认采用保守读取范围 | 优先选区；无选区读取当前 heading section 或光标附近有限内容；不默认读取整篇大笔记 |
| 2026-05-09 | Current note 内容作为 `untrusted_content` 暴露给 planner | 允许 planner 依据当前笔记生成后续 Memory query，同时明确笔记内容是资料不是指令 |
| 2026-05-09 | Chat ReAct 主路径改为 Memory presearch 后再 planner | 让隐式笔记问题也能先看到当前 vault 相关记录；presearch 摘录标记为 `untrusted_content`，最终引用仍只来自本轮 sources |
| 2026-05-09 | `Answer now` 在 presearch 后按本轮生效 | 用户拒绝本轮 Memory 后，后续 planner 的 `search_memory` 不再重复触发 Memory approval 或 VSS |
| 2026-05-09 | Planner fallback 不再无条件使用 presearch Memory | 真实 smoke 发现普通问题在旧运行时 fallback 时会出现空 `Memory references`；现在 fallback 只使用补充搜索结果或通过相关性守卫的 presearch docs |
| 2026-05-09 | Planner prompt nested JSON 示例必须转义 | LangChain 会把未转义的 nested `{}` 当作模板变量；`input` 示例也必须写成 `{{...}}`，并由测试覆盖 |
| 2026-05-09 | Phase 2D 补齐 metadata / recent / outline 三个只读工具 | 覆盖“先找 note path、列最近笔记、读取标题结构”三类不需要 AI cost 的高频上下文读取场景 |
| 2026-05-09 | 非 Memory 工具结果统一走 `<tool_context>` | 后续只读工具可以复用 `tool-note` prompt 注入路径；这些 path 不是 Memory sources，不能进入 Memory references |

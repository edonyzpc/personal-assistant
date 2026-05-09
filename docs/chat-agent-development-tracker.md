# Chat Agent 开发任务计划与进展追踪

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
| 当前工作区 / HEAD | `master`；`codex/chat-agent-architecture` 当前也指向同一提交 |
| 创建日期 | 2026-05-02 |
| 最后回顾 | 2026-05-09，最新 UI Thinking / scroll 修复后校准 |
| 当前阶段 | Phase 1: Agentic Memory Retrieval 已实现；进入 UI 回归验证与 Phase 2 拆解 |
| 架构文档 | [x] 已创建 `docs/chat-agent-architecture.md` |
| 文档状态 | [x] 架构文档与 tracker 已按当前实现、Thinking UI 行为和 review follow-ups 校准；后续以本 tracker 与 `docs/todo.md` 追踪 |
| 实现状态 | [x] Phase 1 agentic retrieval 主路径已实现；Thinking 单块状态与 streaming scroll 修复已落地 |
| 测试状态 | [~] 2026-05-09 Targeted Jest、full Jest、lint、TypeScript type check、`make deploy`、普通问题/笔记检索/取消/Memory 未准备 UI smoke 均已通过；最新 Thinking 展开与 scroll resume 修复仍建议补一次 Obsidian UI 回归 smoke |
| 最近结论 | Phase 1 planner-driven retrieve 闭环已完成；最新 UI 修复解决状态噪音和 streaming 滚动问题，下一步先补 UI 回归验证，再进入 Phase 2 只读 tool registry / context tool 方案拆解 |

## 当前范围

Phase 1 的目标是完成第一条可上线闭环：

1. 用户输入后，agent 先判断是否需要读取 Memory。
2. 如果需要 Memory，agent 生成适合检索的 query。
3. 只有进入 retrieve 路径时才触发 Memory readiness / approval。
4. 检索结果去重、裁剪并整理为上下文。
5. 最终 LLM 使用用户问题、recent history、memory context 和 sources 回答。

本阶段不实现通用 tool registry、skills、写入动作、长期任务或用户可见实验开关。

## Milestone 追踪

| Phase | Goal | Status | Owner/Notes | Evidence |
| --- | --- | --- | --- | --- |
| Phase 0 | 完成架构文档和任务追踪文档 | [x] Done | 当前 HEAD 已包含架构与 tracker | `docs/chat-agent-architecture.md`、`docs/chat-agent-development-tracker.md` |
| Phase 1 | Agentic Memory Retrieval | [x] Done | 核心实现目标已完成；最新 UI polish 保留回归验证追踪 | `npm test -- __tests__/chat-service.test.ts`；`npm test -- --runInBand`；`npm run lint`；`npx tsc -noEmit -skipLibCheck`；`make deploy`；Obsidian UI smoke；Thinking/scroll code review |
| Phase 2 | 只读工具扩展 | [ ] Todo | 后续迭代占位 | 待 Phase 1 完成后拆解 |
| Phase 3 | Skills / Context Packs | [ ] Todo | 后续迭代占位 | 待 Phase 2 基础稳定 |
| Phase 4 | 受控写入与长期任务 | [ ] Todo | 后续迭代占位 | 待只读工具和审批模型稳定 |

## Phase 1 任务表

| Task | Files/Area | Status | Acceptance | Test Evidence |
| --- | --- | --- | --- | --- |
| 定义 agent 基础类型 | `src/ai-services/chat-agent.ts` | [x] Done | 有 `ChatAgentStatus`、planner action、memory search result 等类型；不破坏现有 `streamLLM` 外部调用 | `npx tsc -noEmit -skipLibCheck` |
| 新增 action parser | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | 支持 `answer` 和 `retrieve(query)`；非法 JSON 或非法 schema 可识别为 fallback | `planner action parser` tests |
| Planner 单元测试 | `__tests__/chat-service.test.ts` | [x] Done | 覆盖合法 action、fenced JSON、缺失 query | `npm test -- __tests__/chat-service.test.ts` |
| 新增 `ChatAgentRuntime` | `src/ai-services/chat-agent.ts` | [x] Done | 能执行 `plan -> optional retrieve -> final answer`；最多 2 次 retrieve；重复 query 去重 | `does not repeat duplicate retrieve queries` |
| Runtime abort 处理 | `src/ai-services/chat-agent.ts` | [x] Done | `AbortSignal` 能中断 planning、retrieving、answering；用户主动取消不触发非流式 fallback | Existing abort fallback policy test + type check |
| Runtime status events | `src/ai-services/chat-agent.ts`、`src/chat-view.ts` | [x] Done | 能发出 `thinking`、`retrieving`、`retrieved`、`memory-skipped`、`answering`、`fallback` | fallback status test；UI wiring type checked |
| 实现 `ChatPlanner` | `src/ai-services/chat-agent.ts` | [x] Done | 低温、非流式调用当前 chat model；只输出 action-only JSON；不展示完整内部推理 | parser/runtime tests |
| Planner prompt 策略 | `src/ai-services/chat-agent.ts` | [x] Done | 普通知识、翻译、润色、代码解释走 `answer`；用户笔记、项目记录、历史决策走 `retrieve` | Prompt implemented；behavior covered through mocked actions |
| Planner prompt 模板转义 | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | LangChain prompt template 中的 JSON 示例使用双花括号转义，避免 planner 因模板变量解析失败进入 fallback | `escapes planner JSON examples for LangChain prompt templates` |
| 新增 `MemorySearchTool` | `src/ai-services/chat-agent.ts` | [x] Done | 只在 retrieve 路径调用 `memoryManager.ensureReadyForChat(query)` | `uses planner query for memory retrieval` |
| Memory approval 下沉 | `src/chat-view.ts`、`src/ai-services/chat-agent.ts` | [x] Done | `chat-view.ts` 不再发送前固定调用 `ensureReadyForChat(prompt)` | Targeted test confirms answer path does not call approval |
| VSS retrieve query 使用 | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | `vss.searchSimilarity` 使用 planner query，而不是用户原始 prompt | `uses planner query for memory retrieval` |
| Source 去重和裁剪 | `src/ai-services/chat-agent.ts` | [x] Done | 按 `path + chunkIndex` 去重；最多注入 4 个 chunks；有长度预算 | Type check；duplicate query/source path covered indirectly |
| 新增 `PromptBuilder` | `src/ai-services/chat-agent.ts` | [x] Done | 统一构建 final answer prompt、history、memory context 和 references；fallback 复用 final prompt | `strips trailing memory reference callouts...` |
| History budget | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | 默认只带最近 8 条消息；继续剥离 assistant 历史里的旧 Memory references | `strips trailing memory reference callouts...` |
| Memory references 约束 | `src/ai-services/chat-service.ts`、`src/ai-services/chat-agent.ts` | [x] Done | 只引用本轮真实 sources；无 sources 时不输出 Memory references | `allowed_sources` assertion |
| `skip-memory` 行为 | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | 不调用 planner、不调用 VSS，直接普通回答 | `skips planner and memory lookup...` |
| Planner fallback | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | Planner 解析失败时 Chat 不失败；Memory ready 时可旧逻辑检索，否则普通回答 | `falls back when planner output cannot be parsed` |
| UI 轻量状态 | `src/chat-view.ts` | [x] Done | Chat 中能显示判断、检索、跳过 Memory、fallback、回答状态；不展示完整内部推理 | 普通、检索、取消、Memory 未准备路径 UI smoke passed |
| Thinking 状态 UI 优化 | `src/chat-view.ts`、`src/custom.css`、`styles.css` | [x] Done | 同一轮请求只渲染一个 `Thinking` 状态块；摘要只显示最新状态；展开后查看详情；不再以多条 `Memory` 消息刷屏 | Code review: `fix(chat-ui): improve thinking status scrolling` |
| Streaming 滚动策略修复 | `src/chat-view.ts` | [x] Done | 用户展开 Thinking 或向上查看历史时暂停自动跟随；用户回到底部附近后恢复 streaming 自动滚动 | Code review: scroll listener resumes auto-scroll independent of wheel events |
| Streaming fallback 保持 | `src/ai-services/chat-service.ts`、`__tests__/chat-service.test.ts` | [x] Done | 未收到 chunk 时可非流式 fallback；收到部分 chunk 后不重试；abort 不 fallback | Existing streaming fallback policy tests |
| Targeted tests | `__tests__/chat-service.test.ts` | [x] Done | `npm test -- __tests__/chat-service.test.ts` 通过 | Passed 2026-05-02 |
| Type check | TypeScript project | [x] Done | `npx tsc -noEmit -skipLibCheck` 通过 | Passed 2026-05-02 |

## Phase 1 收尾验证计划

目标：确认 planner-driven retrieve 主路径不仅在 service/runtime 层通过测试，也能在真实 Chat 使用路径中保持产品体验、取消行为和安全边界稳定。

| Verification Item | Area | Status | Acceptance | Evidence |
| --- | --- | --- | --- | --- |
| 文档状态校准 | `docs/chat-agent-architecture.md`、`docs/chat-agent-development-tracker.md` | [x] Done | 文档准确说明当前实现、状态映射、fallback 路径、`use-memory` 语义和待验证项 | 2026-05-09 docs calibration |
| 自动化基线刷新 | Chat service/runtime | [x] Done | targeted Chat tests、type check、lint 通过 | 16 targeted tests passed on 2026-05-09 |
| 全量 Jest 刷新 | Jest suite | [x] Done | `npm test -- --runInBand` 在当前 rebase 后通过 | 18 suites / 132 tests passed on 2026-05-09 |
| 文档 whitespace 检查 | Markdown diff | [x] Done | `git diff --check` 通过 | Passed 2026-05-09 |
| UI smoke：普通问题 | Chat UI | [x] Done | 普通知识/写作问题不触发 Memory approval，状态不显得过度打扰 | Obsidian test vault: HTTP 404 问题只显示 thinking -> answering，无 retrieve / references |
| UI smoke：笔记问题 | Chat UI + Memory | [x] Done | 笔记相关问题使用 planner query 检索，展示 sources，回答只引用本轮 sources | Obsidian test vault: `根据我的笔记，agent意图安全经历了几个阶段？` 使用 `agent意图安全 阶段` 检索并展示 Memory references |
| UI smoke：Memory 未准备 | Chat UI + Memory approval | [x] Done | 只有 retrieve 路径触发准备确认；`Answer now` 后本轮不调用 VSS | Obsidian test vault: reset 后状态为 `Memory needs setup`；普通 HTTP 404 不弹确认；笔记问题弹 `Prepare memory from your notes?`；点击 `Answer now` 后显示 `Memory was not used for this answer.`，无 `Searching memory`、`Found memory references` 或本轮 references callout |
| UI smoke：取消路径 | Chat UI + AbortSignal | [x] Done | planning、retrieving、answering 阶段取消后不继续追加回答，不启动新的 fallback | Obsidian test vault: 长回答生成中点击 `✕` 后显示 `Generation cancelled`，未继续追加 fallback |
| Runtime：Answer now | Chat service/runtime | [x] Done | Memory approval 返回 `answer-now` 时本轮不调用 VSS，普通回答继续完成 | `answers without VSS when memory approval chooses answer now` |
| Runtime：approval cancel | Chat service/runtime | [x] Done | Memory approval 返回 `cancel` 时抛出 AbortError，不调用 VSS，不进入 fallback | `aborts without fallback when memory approval is cancelled` |
| Adversarial Memory references | Prompt / Memory sources | [x] Done | Memory 内容要求越权、伪造引用或改写规则时，最终回答仍只按 allowed sources 引用 | `keeps allowed memory references limited to retrieved source metadata` |
| UI regression：Thinking 展开与滚动 | Chat UI streaming | [ ] Todo | Streaming 过程中 Thinking 可展开；用户滚到上方历史时不被拉回底部；回到底部后自动滚动恢复 | 需要 Obsidian UI smoke |
| Phase 1 Core Done 判定 | Release readiness | [x] Done | 核心 planner-driven retrieve、Memory approval、引用约束和取消路径已完成；最新 UI polish 作为回归项单独跟踪 | Phase 1 core closed on 2026-05-09 |

### Memory 未准备路径复测指引

这个场景已在 2026-05-09 手动通过。后续回归时需要把 test vault 临时切到 `Memory needs setup` 或 `local-memory-missing` 状态。该操作只影响本地 Memory 缓存，不会修改或删除笔记；如果选择重新准备 Memory，可能会消耗 AI credits/API calls。为避免成本，验证时优先点击 `Answer now`。

1. 确认当前已部署最新插件：运行过 `make deploy`，并在 Obsidian test vault 中 reload / re-enable plugin。
2. 打开命令面板，确认能看到高级 Memory 命令。如果看不到 `Reset local memory copy`，先到 Personal Assistant 设置里打开 advanced memory controls。
3. 执行 `Personal Assistant: Reset local memory copy`，在确认框中确认 reset。预期状态栏从 `Memory ready` 变为 `Memory needs setup` 或等价未准备状态。
4. 先问一个普通问题，例如 `请用一句话解释什么是 HTTP 404？`。预期只显示 `Thinking about whether memory is needed...` 和 `Answering...`，不弹 Memory 准备确认。
5. 再问明确依赖笔记的问题，例如 `根据我的笔记，agent意图安全经历了几个阶段？`。预期这时才弹出 Memory 准备确认，说明 approval 下沉到了 retrieve 路径。
6. 点击 `Answer now`。预期 Chat 中出现 `Memory was not used for this answer.`，随后正常回答；不应出现 `Searching memory:`、`Found memory references:` 或 Memory references callout。
7. 可选恢复：验证结束后运行 `Prepare Memory` 或再次提出笔记问题并选择 `Prepare memory and answer`，确认成本提示后恢复 `Memory ready`。

### Thinking / Streaming UI 回归验证指引

该场景用于验证最新 `Thinking` 单块状态和 streaming 滚动修复。它不需要重置 Memory，优先在已经部署最新插件的 Obsidian test vault 中执行。

1. 提交一个会持续流式输出的长回答问题，例如 `请写一篇不少于3000字的中文长文，主题是浏览器缓存、HTTP 404、CDN、以及前端排障之间的关系。`
2. 在回答还在 streaming 时点击 `Thinking` 左侧箭头或状态行。预期详情可以展开/收起，不会因为新 chunk 刷新而失效。
3. 展开后观察摘要行。预期默认只保留一行最新状态，例如 `Answering...`，历史状态只在详情中展示。
4. Streaming 过程中向上滚动到更早的聊天记录。预期视口停留在用户选择的位置，不被新 chunk 或 status 更新强行拉回底部。
5. 再滚回底部附近。预期后续 chunk 自动跟随到底部，直到回答结束。
6. 回答结束时可观察是否有明显闪烁或布局跳动。轻微最终渲染切换仍可接受，已在 `docs/todo.md` 中单独跟踪为后续优化。

## Phase 2 计划：只读工具扩展

目标：把 Phase 1 的 `MemorySearchTool` 演进为 tool registry 的第一个工具 `search_memory`，并增加更多只读上下文工具。

任务占位：

- [ ] 设计 tool registry 接口。
- [ ] 将 `MemorySearchTool` 注册为 `search_memory`。
- [ ] 增加 `get_current_note_context`，读取当前笔记标题、路径、选区或附近段落。
- [ ] 增加 `search_vault_metadata`，基于文件名、路径、tag、frontmatter 搜索。
- [ ] 增加 `list_recent_notes`，读取最近打开或最近修改的笔记。
- [ ] 增加 `read_note_outline`，读取单篇笔记标题结构。
- [ ] 为每个工具记录 `name`、`description`、`input schema`、`permission level`、`cost profile`、`output budget`、`failure behavior`、`status message`。
- [ ] 扩展 status timeline，展示只读工具调用摘要。

验收标准：

- [ ] 工具失败不阻断普通回答。
- [ ] UI 能展示轻量 tool 状态。
- [ ] 多工具结果不会突破上下文预算。
- [ ] 模型不能直接构造未注册工具调用。

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
| 成本上升 | 多一次 planner 调用和可能的多轮检索 | 低温短 planner、最多 2 次 retrieve、`skip-memory` 绕过 | [x] 代码约束已实现 |
| 延迟变高 | 用户感觉 Chat 变慢 | 轻量状态 timeline、快速无结果路径、streaming final answer | [~] Phase 1 smoke 可接受；后续仍需真实使用中观察 latency |
| Memory approval 时机错误 | 普通问题被无意义打断 | approval 下沉到 `MemorySearchTool` retrieve 路径 | [x] 自动化和 UI smoke 覆盖 |
| 引用幻觉 | 回答引用不存在或非本轮来源 | sources 结构化传入，只允许引用本轮 sources | [x] prompt 约束已实现 |
| Prompt injection | 笔记内容影响 agent 权限或工具调用 | Memory 作为资料，工具调用由 runtime 执行，Policy 不被 Memory 覆盖 | [~] references adversarial test 已补，后续 tool/permission injection 待 Phase 2 扩展 |
| Abort 漏传 | 用户取消后仍继续检索或回答 | `AbortSignal` 贯穿 planner、tool、final LLM | [x] 代码路径已实现 |
| UI 状态噪音 | 用户被过多内部细节打扰 | 单个 `Thinking` 状态块只显示最新摘要，详情折叠展示；不展示完整内部推理 | [x] 代码已按最新 UI 要求优化 |
| Streaming 滚动打断用户阅读 | 用户展开 Thinking 或查看历史时被新 chunk 拉回底部 | 用户离开底部时暂停自动跟随，回到底部附近后恢复 | [~] 代码已修复，Obsidian UI 回归 smoke 待补 |
| 最终消息重渲染轻微抖动 | 长回答结束时可能有轻微 flicker 或 layout shift | 暂保留当前 remove/re-render 策略，后续考虑原地更新 | [ ] 已记录到 `docs/todo.md` |
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
| 2026-05-09 | Obsidian UI smoke：Thinking 展开与 scroll resume | [ ] Pending | 需要按本文档回归验证指引手动执行 |
| 2026-05-09 | `git diff --check` | [x] Passed | Docs calibration for latest UI Thinking / scroll state has no whitespace errors |

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
| 2026-05-09 | 最终 assistant message 原地更新暂不进入本轮修复 | 当前行为正确但可能有轻微结束抖动，作为低风险 follow-up 记录在 `docs/todo.md` |

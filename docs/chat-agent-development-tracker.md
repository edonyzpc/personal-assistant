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
| 开发分支 | `codex/chat-agent-architecture` |
| 创建日期 | 2026-05-02 |
| 最后回顾 | 2026-05-02 |
| 当前阶段 | Phase 1: Agentic Memory Retrieval |
| 架构文档 | [x] 已创建 `docs/chat-agent-architecture.md` |
| 实现状态 | [x] Phase 1 agentic retrieval 主路径已实现 |
| 测试状态 | [x] Targeted Jest、full Jest、lint 和 TypeScript type check 已通过；手动 smoke test 待补 |
| 最近结论 | planner-driven retrieve 闭环已完成自动化验证；下一步补 UI smoke test，再考虑只读 tools/skills |

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
| Phase 0 | 完成架构文档和任务追踪文档 | [x] Done | 当前分支 `codex/chat-agent-architecture` | `docs/chat-agent-architecture.md`、`docs/chat-agent-development-tracker.md` |
| Phase 1 | Agentic Memory Retrieval | [~] 自动化验证已通过，手动 smoke test 待补 | 当前唯一实现目标 | `npm test -- __tests__/chat-service.test.ts`；`npm test -- --runInBand`；`npm run lint`；`npx tsc -noEmit -skipLibCheck` |
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
| 新增 `MemorySearchTool` | `src/ai-services/chat-agent.ts` | [x] Done | 只在 retrieve 路径调用 `memoryManager.ensureReadyForChat(query)` | `uses planner query for memory retrieval` |
| Memory approval 下沉 | `src/chat-view.ts`、`src/ai-services/chat-agent.ts` | [x] Done | `chat-view.ts` 不再发送前固定调用 `ensureReadyForChat(prompt)` | Targeted test confirms answer path does not call approval |
| VSS retrieve query 使用 | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | `vss.searchSimilarity` 使用 planner query，而不是用户原始 prompt | `uses planner query for memory retrieval` |
| Source 去重和裁剪 | `src/ai-services/chat-agent.ts` | [x] Done | 按 `path + chunkIndex` 去重；最多注入 4 个 chunks；有长度预算 | Type check；duplicate query/source path covered indirectly |
| 新增 `PromptBuilder` | `src/ai-services/chat-agent.ts` | [x] Done | 统一构建 planner prompt、fallback prompt、final answer prompt | `strips trailing memory reference callouts...` |
| History budget | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | 默认只带最近 8 条消息；继续剥离 assistant 历史里的旧 Memory references | `strips trailing memory reference callouts...` |
| Memory references 约束 | `src/ai-services/chat-service.ts`、`src/ai-services/chat-agent.ts` | [x] Done | 只引用本轮真实 sources；无 sources 时不输出 Memory references | `allowed_sources` assertion |
| `skip-memory` 行为 | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | 不调用 planner、不调用 VSS，直接普通回答 | `skips planner and memory lookup...` |
| Planner fallback | `src/ai-services/chat-agent.ts`、`__tests__/chat-service.test.ts` | [x] Done | Planner 解析失败时 Chat 不失败；Memory ready 时可旧逻辑检索，否则普通回答 | `falls back when planner output cannot be parsed` |
| UI 轻量状态 | `src/chat-view.ts` | [x] Done | Chat 中能显示判断、检索、跳过 Memory、fallback、回答状态；不展示完整内部推理 | UI wiring type checked；manual smoke pending |
| Streaming fallback 保持 | `src/ai-services/chat-service.ts`、`__tests__/chat-service.test.ts` | [x] Done | 未收到 chunk 时可非流式 fallback；收到部分 chunk 后不重试；abort 不 fallback | Existing streaming fallback policy tests |
| Targeted tests | `__tests__/chat-service.test.ts` | [x] Done | `npm test -- __tests__/chat-service.test.ts` 通过 | Passed 2026-05-02 |
| Type check | TypeScript project | [x] Done | `npx tsc -noEmit -skipLibCheck` 通过 | Passed 2026-05-02 |

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
| 成本上升 | 多一次 planner 调用和可能的多轮检索 | 低温短 planner、最多 2 次 retrieve、`skip-memory` 绕过 | [x] 代码约束已实现 |
| 延迟变高 | 用户感觉 Chat 变慢 | 轻量状态 timeline、快速无结果路径、streaming final answer | [~] 状态事件已实现，手动体验待验证 |
| Memory approval 时机错误 | 普通问题被无意义打断 | approval 下沉到 `MemorySearchTool` retrieve 路径 | [x] 自动化覆盖 |
| 引用幻觉 | 回答引用不存在或非本轮来源 | sources 结构化传入，只允许引用本轮 sources | [x] prompt 约束已实现 |
| Prompt injection | 笔记内容影响 agent 权限或工具调用 | Memory 作为资料，工具调用由 runtime 执行，Policy 不被 Memory 覆盖 | [x] prompt 约束已实现 |
| Abort 漏传 | 用户取消后仍继续检索或回答 | `AbortSignal` 贯穿 planner、tool、final LLM | [x] 代码路径已实现 |
| UI 状态噪音 | 用户被过多内部细节打扰 | 只展示轻量状态，不展示完整内部推理 | [~] UI 已接入，文案密度待 smoke test |

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
| TBD | Memory 未准备时只在 retrieve 路径提示 | [ ] Todo | 手动 smoke test |
| TBD | 用户取消中断 planner/retrieve/answer | [ ] Todo | 手动或自动验证 |

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

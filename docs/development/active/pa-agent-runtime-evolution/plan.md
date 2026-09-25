# B-149 PA Agent Runtime Evolution — Delivery Plan

Document status: Approved
Updated: 2026-09-24
Work item: B-149
Authority: 交付顺序、GPT-6 Sol 任务边界、验证方式、风险与停止点；执行状态只在 Tracker。
Product spec: [PA Agent 问答范围与 Runtime 演进](../../../product/specs/pa-agent-runtime-evolution-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## 1. Goal And Non-goals

把已接受的三种问答范围和五项 Runtime 演进做成可以独立验证的实现：范围由用户选择、Host 确定性执行；动作轨迹不丢失；执行事实与领域结果分开；恢复/取消/来源版本可信；质量和完整成本通过真实任务比较。

技术合同见 [SDD](./sdd.md)。不附带 B-147 排除例外、B-148 广义事实核实、隐式 Writing、新 MCP/shell、多 Agent 产品形态、全新调度平台或跨重载自动执行。本轮只制定开发测试计划；计划中的命令、provider、部署和任务均未因此执行。

## 2. 执行模型、职责与交接规则

Owner 指定后续由 **GPT-6 Sol max（`gpt-6-sol`，max 推理）** 执行开发、测试与自查。这是本包对仓库默认 GLM writer 的明确局部替换，不修改全仓工作流，也不要求启动 `pa-glm`。其余角色隔离沿用 [交付工作流](../../workflows/gpt6-glm-delivery-workflow.md)：主控设计/派工/验收，writer 开发/测试/自查。该指定针对开发测试执行者；PA 实际任务评测的 provider/model 仍按 T-01 固定基线，不因 writer 更换而自动改变。

1. 主控从 Feature Home + Tracker 接续，核实 Owner 实施授权及本包版本，派发当前任务卡；同一 writer 可以在一个连续上下文内按授权完成相邻卡，不人为重复调查。
2. 派工前核实实际 model id 为 `gpt-6-sol`，记录工作目录、源码/文档身份、工具能力、测试目标；不凭任务标题声称已使用该模型，不擅自切到其他模型。
3. writer 只修改卡内责任文件及直接必要测试，顺序推进有依赖任务；共享 runtime/context/store 文件单一 writer，不并行编辑。必要的边界扩展先由主控修订卡，再继续。
4. 主控可安排独立只读 review，不把 writer 自查当独立验收；每阶段重型 build/full tests/deploy 只指定一个执行者。若 writer 有工具/权限则由其执行，主控检查原始证据，不重复跑已充分且输入不变的检查。
5. writer 不修改 Product Spec/Decision、批准状态、AC 或 Tracker 的完成状态；提交事实和证据，由主控更新 Tracker。发现合同冲突、真实产品取舍或未知副作用，保留证据并停止相应路径。
6. 禁止自行提交、推送、发布、改 provider/key、访问真实私人资料或扩大测试设备部署范围。已具备的授权在相同操作/目标/范围继续有效，不逐卡机械重复求批。

当前产品文档及本包有未提交文件，**新 worktree 默认拿不到它们**。派工必须列明它们的实际路径和内容 hash：通过获授权的 Git 集成，或受控复制本包/产品文档到隔离树并校验相同内容。不能仅给 `6fce3824`，不能 stash/reset 丢掉 Owner 未提交工作。每次换模型上下文携带已经接受的修正和新的 task revision。

## 3. Dependencies And Source Surface

完整源码依据见 SDD §2，不要求每个 writer 重读全部架构。共同最小阅读集：仓库 AGENTS、产品北极星、Product Spec、SDD 对应章节、当前任务卡、Tracker Current Snapshot。不要为本包重新运行无关 skill 流程。

已验证命令入口：`npm test` 为 source group；`test:tooling` 包含 `*-script.test.ts` 等 tooling；`test:artifacts` 是绑定当前 dist 的 probe/receipt；`test:all` 为全组。分类权威在 `scripts/lib/jest-test-groups.cjs`。`make deploy` 已包括平台检查、lint、生产 build（含类型检查）、全 Jest 和复制到 repo test vault；不要在它前后重复相同完整 gate。

本设计未核实实际 GPT-6 Sol 运行环境、API 凭据、CLI mobile simulator 和当前 Obsidian 实例；这些必须由实施 preflight 记录，不能写成已具备。真实 provider 基线只使用获授权的合成资料/固定次数；缺费用边界或环境时可以做离线接线，但不能把真实模型 AC 标为通过。

## 4. Phases

每个阶段按 **开发 → focused 检查 → 独立 review → 修复 → 阶段 gate**。任务卡完成代码不代表阶段完成；阶段适用的真实应用门禁不能整体拖到最后。

最初评审的五个问题对应以下交付，避免被范围 UI 覆盖后遗漏：

| 原评审问题 | 设计落点 | 开发与验证 |
| --- | --- | --- |
| 动作历史平铺丢失调用语义 | SDD §5.1 | T-09；实际 messages、同结果不同参数、E-09 |
| 退役策略和领域耦合过多 | SDD §5.2/5.3 | T-10；消费者/旧 reader/领域结果证明 |
| 正常零命中与不可用混淆 | SDD §5.2 | T-10；E-04/05/06、APP-07 |
| 上下文预算与摘要成本脱节 | SDD §8 | T-11；窗口/辅助预算/完整 usage 对照 |
| 缺少真实 runtime 任务质量与成本基线 | SDD §9.2、本 Plan §6 | T-01/T-12；G0/G4 前后对照 |

另外三项已知 P2 由 T-02（取消）、T-03（进展）、T-04（观察版本）单独修复；三种硬范围由 T-05–08 纵向完成。

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P0 基线 | 冻结真实任务、指标与现状 | T-01：小型 runtime eval、合成材料、模型/请求身份 | G0：runner 自检、离线实际请求捕获、获授权真实模型基线；与现有功能无行为差异 | 行为改动前留存基线；缺真实基线不宣称后续收益 |
| P1 执行正确性 | 三项已知 P2 有回归证据 | T-02 取消、T-03 进展、T-04 观察版本/v2 reader | G1：focused + 独立 review + full/deploy + 桌面 Chat/Pagelet/Writing 相关 smoke | 未知副作用、错误版本或名额泄漏未解决不进入阶段完成 |
| P2 完整范围 | 选择、历史、后台材料、物理请求和 UI 同时兑现硬边界 | T-05 会话、T-06 lineage、T-07 所有入口、T-08 UI | G2：全范围/迁移矩阵，全部实际请求负例，full/deploy，桌面及 Obsidian CLI mobile simulator 交互；仅 iOS 特有能力补真机 | 不单独交付只隐藏工具的范围 UI；任一旁路阻止阶段完成 |
| P3 Runtime 演进 | 结构化轨迹、领域事实/退役、真实预算 | T-09 messages、T-10 owners/cleanup、T-11 budgets | G3：每片任务对照 + 领域/来源回归 + 独立 review + full/deploy + 相应实际任务 smoke | 不能合并多种变化后仅看平均总分；兼容/质量退化必须归因 |
| P4 综合验收 | 所有 REQ/AC 可追溯，收益与限制真实 | T-12：固定任务前后对照、兼容检查、当前文档吸收 | G4：13 AC 逐项证据核对、最终独立 review、当前输入完整门禁或有效复用 | 到“可验收”；不自动 commit、push、closeout、beta/stable |

依赖顺序：T-01 → T-02/T-03/T-04 → G1 → T-05 → T-06 → T-07 → T-08 → G2 → T-09 → T-10 → T-11 → G3 → T-12/G4。T-02/03/04 的设计可独立审查，但 runtime 修改仍串行；T-09/10/11 每片保留前后任务证据再继续，便于定位退化。

## 5. GPT-6 Sol Development Task Cards

以下命令中的 suite 均需在实施时确认存在且实际被对应 Jest group 执行。新 suite 标为 Proposed；添加后使用其精确文件名，不用 `--passWithNoTests` 掩盖命令选错。任务卡的负例编号对应 SDD §9.1。

### T-01 — 冻结案例并接通实际 runtime 基线

- 目标：B-149/REQ-13、AC-13；为后续预算/结构收益提供改动前证据。
- 先读：SDD §8–9、`src/pa/eval/{runner,types}.ts`、`scripts/context-continuity-smoke-runner.js`、`b129-multimodal-runtime.test.ts`、Debug usage parser。
- 允许修改：`src/pa/eval/` 的窄异步入口/fixture；Proposed `scripts/pa-agent-runtime-eval-runner.js`、`__tests__/pa-agent-runtime-eval.test.ts`、`__tests__/pa-agent-runtime-eval-runner-script.test.ts`；仅在必要时增加 package script/Jest group 接线。观测优先利用内存 port，不改变默认产品行为或开启持久 Debug。
- 步骤：先按 §6 固定 12 案例的目标/来源/允许差异；运行真实 runtime+SDK+固定 fetch 的离线层；校验 run/attempt/purpose/产物记录，特别识别现有 Debug 仅按 callId:updateKey 聚合、usage 尚无确切 attempt 归属的缺口；再在获授权环境运行当前未改动行为的真实模型基线。不能归属时保留 logical total 与 unknown，不重叠相加；新范围尚不存在记录为 expected gap，不能伪装基线已支持。
- 最小检查：`npm test -- --runInBand __tests__/pa-eval.test.ts __tests__/pa-agent-runtime-eval.test.ts`；`npm run test:tooling -- --runInBand __tests__/pa-agent-runtime-eval-runner-script.test.ts`。runner 必須区分失败、取消、缺 provider/usage 与正常完成。
- 交付：fixture hash、baseline build/source 身份、每例 raw output/来源/调用指标、人工 rubric、重跑步骤；不预填 actual 冒充执行，不复制大型 benchmark 平台。
- 停止点：G0 基线封存；真实 provider 未获授权只完成离线部分，主控保留证据缺口，不能清掉该门禁。

### T-02 — 取消覆盖不响应 signal 的准备等待

- 目标：B-149/REQ-09、AC-09，继承 DEC-040 lane/lifecycle。
- 先读：SDD §6.1；`pa-agent-loop.ts` 的 prepare/run finally、`agent-runtime-primitives.ts`、`agent-run-coordinator.ts`、Pagelet prepare 链路。
- 允许修改：上述 loop/primitives 的最小接缝；只有实证需要才改 Pagelet/context cancellation generation；对应既有 tests。
- Red：使用 never-settling prepare，取消后主任务仍挂起；断言来自取消等待缺口，不能靠超时过短或 mock 引入不相关失败。
- Green：复用 `TurnExecutionDeadline`，已取消先拒绝、启动微任务、race abort、finally dispose；迟到 promise 有 rejection handler但无 dispatch/commit；正常失败原因分类保留。
- 关键负例：N-09，加 pre-aborted、resolve/abort 同 tick、有限 deadline、第二个 Pagelet lease、另一 Chat lane、未知副作用不被清除。
- 最小检查：`npm test -- --runInBand __tests__/pa-agent-loop.test.ts __tests__/agent-runtime-primitives.test.ts __tests__/agent-run-coordinator.test.ts __tests__/pagelet-agent-runtime.test.ts`；若改摘要生命周期，再加 `pa-agent-context-summarizer.test.ts`。
- 交付停止点：回归、focused、self-review 交给主控；App gate 在 G1，不能只用 mock lease 数声称实际取消体验已验证。

### T-03 — 真实进展重置连续失败，全程消耗继续累计

- 目标：B-149/REQ-08、AC-08。
- 先读：SDD §6.2；loop 的 provider counts、answer completion 的 equivalent counts；dispatcher 已有 result reuse 与执行状态。
- 允许修改：loop、completion policy、现有 tool result/domain receipt 到 progress 的窄接线、Debug/runtime resource totals；不建 intent classifier 或新的总费用 gate。
- Red：error → 新观察 → error → 新观察 → error → 新观察 → error，当前会被旧累加门槛终止；另保留持续同因错误收束的控制组。
- Green：按 SDD §6.2 映射现有 observation hash/领域 receipt，Host 真实 identity 去重、progress epoch、classified error signature；新 query 本身不算进展，零命中缺少可证明覆盖身份时不重置；全程 attempts/usage 不因 reset 消失。暂时失败后只读可重试，unknown 副作用仍需核实。T-04/T-10 扩充同一证据链，不另建判断器。
- 关键负例：N-10/N-11/N-17，零命中只形成有限检索事实，不是总结完成。
- 最小检查：`npm test -- --runInBand __tests__/pa-agent-loop.test.ts __tests__/pa-agent-batch-preflight.test.ts __tests__/pa-agent-answer-completion-policy.test.ts __tests__/pa-agent-debug-observation.test.ts`。
- 停止点：给出真实进展与心跳/复用的对照证据；不能用更宽上限或清空所有错误记录解决回归。

### T-04 — 观察版本贯穿 source receipt 与持久快照

- 目标：B-149/REQ-10、AC-10；为 T-06 lineage 提供可信观察基础。
- 先读：SDD §7；`chat-tool-factories.ts` 的 read_note/editor read、`vault-observation-evidence.ts`、`capability-adapter.ts`、`task-source-run.ts`、`generation-input-snapshot.ts`、Writing strict parsers。
- 允许修改：以上 receipt/转换/clone/parser 接缝及直接消费者；v2 schema 一次包含观察 revision 和可选 lineage，旧 v1 reader 保留。禁止为普通 Chat 重读全部材料或写新索引。
- Red：读正文 A 后修改文件 stat 为 B，捕获 generation snapshot 错标 B；加相同 stat 不同内容及编辑器未保存正文。
- Green：读时采集可证明身份，发送时复制；unknown 不补造；A/B 同 path 可区分；metadata/snippet hash 标清范围。复用现有 hash 和稳定读取检查，不另建全文件版本库。
- 关键负例：N-12/N-06；v1 可展示、恢复不擅自升级；写前 target freshness、源撤销分开测。
- 最小检查：`npm test -- --runInBand __tests__/task-source-run.test.ts __tests__/generation-input-snapshot.test.ts __tests__/read-note-tool.test.ts __tests__/chat-tools.test.ts __tests__/t07-vault-observation-foundation.test.ts __tests__/t07-vault-observation-contracts.test.ts __tests__/writing-save-action.test.ts`。
- 停止点：所有传递中转无字段丢失，旧 parser fixtures 通过；G1 后再进入完整范围接线。

### T-05 — 会话选择、run 快照与原子持久化

- 目标：B-149/REQ-01/02/04 的状态与迁移部分；不提前开放范围 UI。
- 先读：SDD §4.1/7.2；`ConversationPersistence.ts`、history manager/store、ChatService 的 epoch/stream options。
- 允许修改：Proposed `chat-source-scope.ts` 类型/解析、conversation/store/manager、run options/turn metadata 和其 reader；`chat-view.ts` 只做发送快照接缝，完整 UI 留 T-08。
- 步骤：闭集三范围；新草稿 notes；会话内独立恢复；store 事务递增 revision、append 保留最新选择；捕获前不 await；metadata-only setter 不触发 source mutation/resetContext；旧选择懒迁移不生成旧 lineage。
- 关键负例：N-01/N-02/N-06/N-20；多 view、切换到 B 时 A 的慢回调、存储失败后发送使用内存选择、schema 损坏仍可看历史。
- 最小检查：`npm test -- --runInBand __tests__/chat-history-store.test.ts __tests__/chat-history-manager.test.ts __tests__/conversation-persistence.test.ts __tests__/pa-agent-runtime-chat-history.test.ts __tests__/task-source-run.test.ts`。
- 停止点：默认与持久化机制可测但无独立交付的半成品控件；没有新增全局 settings，也未改变独立 Pagelet 默认。

### T-06 — 来源依赖、历史与派生材料准入

- 目标：B-149/REQ-03/04/05/10 的上下文部分。
- 先读：SDD §4.2/7；`pa-agent-history.ts`、TaskSourceRun projectHistory、ContextProjector/Summarizer/SummaryTypes、image-request、Writing generation/recovery。
- 允许修改：上述 lineage 产生/union/project/cache/clone/reader 接缝；填充 T-04 v2 已定义字段，不再新增另一份 Writing 来源模型。
- 步骤：标注每类真实输入；每次出站产生 exact union；assistant、工具参数、滚动摘要继承全部依赖；先准入再摘要/注册图片；模型引用子集不影响权限。缓存 identity 含 lineage/receipt；UI 原记录不删。
- 表驱动全部 3×3 转换（含范围不变），分别覆盖 pure notes/web/current explicit input/mixed/unknown、能力关闭及撤销。扩范围保留合法历史，不用全清空走捷径。
- 关键负例：N-03–08/N-18/N-20；Writing parent/recovery、相同文本不同依赖、历史图片、私有路径/标题也检查。
- 最小检查：`npm test -- --runInBand __tests__/pa-agent-history.test.ts __tests__/pa-agent-runtime-chat-history.test.ts __tests__/pa-agent-context-summary-projection.test.ts __tests__/pa-agent-context-summarizer.test.ts __tests__/b129-image-request.test.ts __tests__/conversation-writing-admission.test.ts __tests__/writing-recovery-sources.test.ts`。
- 停止点：每类自动背景能解释来源，unknown 降级可控；缺 lineage 的旁路必须列 finding，不能先称“硬范围完成”。

### T-07 — 工具、独立领域能力与每次物理请求守卫

- 目标：B-149/REQ-02/03/05，完整覆盖辅助调用和交付。
- 先读：SDD §4.3；TaskSourceConstraint/ReadGuard/Executor；runtime prepare/injected context/independent capabilities；Memory query rewrite/rerank、Web MCP、ai-utils/fetch；Writing/Operations admission。
- 允许修改：上述 guard 与 adapter 接缝及 tests。复用 SDK request hooks，不增加新 transport 或全局代理。
- 步骤：scope ∩ live permission；web 在自动背景读取前短路；补 scoped vault search、路径目录与 reads=[] 领域能力；before-send 检查精确 payload，SDK retry/stream fallback/summary/rewrite/rerank/Web 子请求分别检查；最终流式提交和 persist queue 保持同一来源准入。
- 关键负例：N-02/03/07/08/18；关闭全局能力时 combined 不打开它；普通 Chat 不进入 Writing；action target 的必要校验不变成 arbitrary read；来自混合历史的工具参数不能当无来源。
- 最小检查：`npm test -- --runInBand __tests__/task-source-constraint.test.ts __tests__/task-source-executor-integration.test.ts __tests__/chat-tools-task-source.test.ts __tests__/b129-multimodal-runtime.test.ts __tests__/obsidian-fetch.test.ts __tests__/builtin-web-search-provider.test.ts __tests__/writing-context-runtime.test.ts __tests__/operations-task-source-read.test.ts`；Proposed `pa-agent-answer-scope.test.ts` 捕获全部实际出站请求。
- 停止点：每类实际物理入口有正反例和捕获记录；工具隐藏或 prompt 文案不能代替此交付。

### T-08 — 输入区范围交互与完整纵向验收

- 目标：B-149/REQ-01/02/04/05；只有 T-05–07 完成后才接通产品入口。
- 先读：Product Spec §2–4、SDD §4.4；chat-view/menu-helpers/custom.pcss/locales。
- 允许修改：现有 chat view/menu helper、PCSS、中英文 locale、必要交互测试；不重构整页为 React、不新增设置页或全局行为。
- 步骤：icon-first 当前范围按钮、全名菜单/解释/选中、键盘/a11y/touch/长按说明；运行中切换下一条生效、一次提示；new/load/compact/多 view/卸载清理；不产生模型或检索请求。
- 关键负例：N-01/02/06/20；保存失败提示、窄屏可见、切换不 reset epoch/abort 当前 run、历史仍可看。
- 最小检查：`npm test -- --runInBand __tests__/chat-view.test.ts __tests__/conversation-persistence.test.ts __tests__/chat-history-store.test.ts`，加 Proposed `__tests__/chat-answer-scope.test.ts`。此 suite 测实际 DOM 交互与状态归属，不只 snapshot 文案。
- 停止点：G2 的桌面与 Obsidian CLI mobile simulator 交互通过；仅在触及 iOS 特有能力时补 iPhone 真机。不能把静态窄屏截图冒充交互证据。

### T-09 — 结构化 action history 与兼容投影

- 目标：B-149/REQ-07；保持已建立的来源/恢复边界。
- 先读：SDD §5.1；PaAgentMessage/ContextManager/Projector/Hygiene/Compactor、prompts、runtime bound stream/invoke、image scope。
- 允许修改：上述消息投影与现有 adapter；若新增 helper，只承载从同一 action group 到 provider messages 的纯转换。
- 步骤：先写“同结果不同参数”实际请求回归；增加 actionHistory；成组清洁/压缩；以唯一最终消息 builder 保留先前合法对话、当前 user 一次、随后本轮 action groups；native/compat 互斥并替换旧 tool_observations 重复注入；普通文本和图片均使用该入口；来源绑定、预算、stream/invoke 消费相同产物。
- 关键负例：N-13/14/18；多工具乱序、同名不同参、部分 stream 失败、private metadata 不入模、参数继承来源、native/invoke fallback。
- 最小检查：`npm test -- --runInBand __tests__/pa-agent-runtime-prompt.test.ts __tests__/pa-agent-runtime-tool-definitions.test.ts __tests__/pa-agent-runtime-chat-history.test.ts __tests__/pa-agent-context.test.ts __tests__/pa-agent-context-admission.test.ts __tests__/pa-agent-context-continuity.test.ts __tests__/pa-agent-stream-fallback.test.ts __tests__/ai-utils.test.ts`；复用 T-07 实际请求边界 suite。
- 停止点：当前支持 adapters 的 native/compat 证据表及案例 E-01/E-08/E-09 对照；不得未经决定缩减模型支持，不能只看 token 减少。

### T-10 — typed result facts、领域归位与退役证明

- 目标：B-149/REQ-06/12，保留 AC-05/08 的动作与恢复保护。
- 先读：SDD §5.2/5.3；结果链类型、Memory owner、Insight action、Operations executor、Writing/native output、required/completion policy。
- 允许修改：窄 resultFact 接线、对应领域 owner、runtime composition/loop adapter、旧策略退役及直接测试；不借清理改产品能力集合。
- 步骤：先使 owner 生成可信 facts，再改通用消费者，再删除旧解析/推断；Memory、metadata/query/snippet、Web 各自映射正常空结果。Writing 纯输出严格按 SDD §5.2 的候选预检→loop 终态→bridge 准入 artifact→版本持久化→独立保存顺序，不伪造 tool result 或循环等完成。每片给 import/caller/type/旧 fixture/行为证据；先迁移有效保护再删 policy，保留 retired declaration 拒绝与旧 reader。
- 关键负例：N-15/16/19；exists no-match vs summary 缺材料 vs unavailable，Memory 关闭时 metadata/query 正常零命中；作品 ready vs 版本持久化 vs saved，交付前撤销与版本写入失败；staged vs applied、unknown 不重放；成功恢复后的 warning 清理；A→B→A Writing context。
- 最小检查：`npm test -- --runInBand __tests__/pa-agent-answer-completion-policy.test.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-control-policy.test.ts __tests__/insight-action-port.test.ts __tests__/operations-agent-runtime.test.ts __tests__/native-writing-call.test.ts __tests__/native-writing-loop.test.ts __tests__/writing-context-dispatcher-reuse.test.ts __tests__/capability-registry.test.ts`。
- 旧 suite 若因删除无用 API 被删，报告其原有有效行为断言迁往哪里；尤其 iOS DashScope transport、history recovery 不能一起消失。事实映射可增 Proposed `pa-agent-domain-results.test.ts`，不堆实现镜像测试。
- 停止点：E-04/05/06/10/12 实际任务语义复核；引用存在或一次工具成功不能替代目标/保存验收。

### T-11 — 按实际窗口、usage 与收益准备上下文

- 目标：B-149/REQ-11，延续 DEC-040。
- 先读：SDD §8；ContextBudget/Summarizer、prompts envelope 计量、AIUtils maxTokens、Debug usage aggregation、Pagelet CJK estimator。
- 允许修改：已有 budget/summarizer/request/resource 计账；必要时把通用 token 估计纯函数提取到现有 AI helper，不增加模型目录服务/新设置 UI。
- 步骤：可信窗口与未知 fallback 明确；实际 messages/schema/image 计量；output reserve 分别标来源，显式上限传到真实 maxTokens/provider 参数，未知不当 0；来源准入后选必要集合；去重/旧闭合材料优先；选择有价值的摘要并复用缓存；辅助总投入与每物理尝试 deadline 分开；统一 usage 去重。用实际 request body 检查 answer/summary/stream/invoke 一致，不能仅测预算函数。
- 数值确定：在固定样例增加小/中/长输入压力 fixture；记录“无辅助摘要/现有策略/候选参数”的必要目标、实际 calls/tokens/时间、缓存命中和 overflow。选能保住目标且降低冗余的最小策略，写源码默认值、估计身份、依据和适用边界到 Tracker；未测量不能随意填一个次数或秒数后宣称完成。
- 关键负例：N-14/17/18；同 call 多物理 attempts + cumulative 重复 + stream→invoke 的可归属/不可归属 usage，复用 parser 但修正聚合身份；未知窗口、中文/JSON/schema/images、相同材料零新增摘要、来源变化失效、辅助耗尽主任务继续、摘要取消不发主回答、30 分钟尝试/前后台机会不弱化。
- 最小检查：`npm test -- --runInBand __tests__/pa-agent-context-admission.test.ts __tests__/pa-agent-context-summarizer.test.ts __tests__/pa-agent-context-summary-projection.test.ts __tests__/pa-agent-context-continuity.test.ts __tests__/writing-context-budget-runtime.test.ts __tests__/pa-agent-debug-observation.test.ts __tests__/agent-debug-service.test.ts __tests__/obsidian-fetch.test.ts`。
- 停止点：说明测量和参数依据；明显成本/等待增加先提交具体质量收益与代价，不默认获无限额度；G3 复验 P2 全部硬范围负例。

### T-12 — 综合对照、兼容验收与当前文档吸收

- 目标：所有 REQ/AC，重点 B-149/REQ-13/AC-13。
- 先读：Tracker 证据与未关闭 finding；本 Plan §6–8；Product Spec 全部 AC。
- 允许修改：评测报告/fixture 的确证修正、实际行为对应的 architecture 文档；代码缺陷退回 owning task 修复，不在验收卡偷偷扩 scope。
- 步骤：用 T-01 相同 fixtures/model/settings 做最终对照；核验所有真实消息/工具路径；逐例人工核对结论是否有来源，分别报告确定性、任务语义、完整成本、首个有用结果/交付时长。记录重复波动和 unknown；版本/provider 变化导致不可比时明确分开或重建同基线对照，不拼接漂亮数字。
- 检查存储旧/新 fixtures、桌面/mobile simulator 适用证据、原模型兼容、Memory/VSS/Writing/Operations/Pagelet 回归；任何声称“已通过”的项都能找到运行命令、原始结果和输入身份。
- 仅在实现通过后更新 `docs/architecture/pa-agent-architecture-plan.md`、`pa-agent-runtime-lifecycle-plan.md` 等受影响现行架构；VSS 行为没改不改 VSS 产品合同。主控核对 Product Spec 的目标提示与实际交付说明，保留 Decision 的历史取舍。
- 停止点：G4 可验收；Writer 输出 §9 报告。主控才更新状态，Git/closeout/publish 另行授权。

## 6. 固定评测样例与判定

使用虚构项目/人物/数值与专属 sentinel，不读取用户真实笔记。所有 fixture 内容、预期必要证据、禁用结论在开发前固定；答案不逐字匹配。E-02/03/08 在原版本记录新行为缺口，最终作为硬合同；其他可比任务必须保留相同输入和环境。

| Case | 输入与材料 | 必须满足的目标/证据 | 不允许的结果 | 重点指标 |
| --- | --- | --- | --- | --- |
| E-01 找回决定 | notes；数篇相似笔记，只有一篇记录最终决定及理由 | 找到正确决定、关键理由、可核对来源 | 只凭标题/相似度选错决定 | 来源正确性、轨迹、总消耗、首个有用结果 |
| E-02 纯网络 | web；固定网页证据；vault/Personal/Pagelet/旧图片放各自 sentinel | 依据网页回答；自动笔记输入/读取均为零 | 任一实际请求携带被禁 sentinel，或隐藏自动资料准备 | 每条实际请求、全部辅助 attempts |
| E-03 综合比较 | combined；笔记有预算，网页有公共方案事实 | 两类证据各支持对应比较；不强求无必要双检索 | 把网络猜测当私有记录，或错误授权持久动作 | 目标覆盖、来源归属、完整成本 |
| E-04 存在性查找 | notes；询问是否记过 X，正常检索零命中 | “本次未检索到”的有限结论，可完成本次查找 | 断言全库不存在、强制固定补查/扩范围 | 是否恰当结束、冗余调用 |
| E-05 缺材料总结 | notes；要求总结项目决定，必要材料不存在 | 说明缺少依据，目标未完成 | 自动编通用总结或假造笔记事实 | 状态诚实、无不必要生成 |
| E-06 暂不可用 | 搜索暂时失败；存在获准替代/恢复路径 | 能恢复则完成；不能则说明查找未成功 | 报成 no-match、无限同因重试 | 恢复片段与全部 attempts |
| E-07 冲突版本 | 两篇笔记相互冲突并有明确日期/版本证据 | 保留冲突及来源；只在证据支持时说明后续决定 | 无依据合并或把旧正文标为最新版本 | 冲突处理、observed revision |
| E-08 跨范围追问 | combined 回答后切 web，问“那 B 呢？” | 排除混合历史；必要时补问预算等条件；历史仍可看 | 偷发旧预算、模型摘要清洗；所有追问一律失忆 | 实际输入、必要澄清、合法复用 |
| E-09 动作轨迹 | 相同工具结果，但两条不同 query/参数历史 | native/compat 均保留可区分的先前动作与约束 | 只保留观察字符串，调用参数丢失 | 实际 messages、下一步行为、token |
| E-10 恢复与副作用 | 临时错误夹新证据；另分支持续无进展/副作用未知 | 有进展可继续，无进展收束，未知动作先核实 | 心跳重置或盲重放 | episode、total、真实回执 |
| E-11 取消等待 | provider 前准备挂起且不响应 signal，再取消 | 主任务及时结束，后续名额可用，迟到结果无效 | 等底层返回、二次发送/交付、丢 unknown 状态 | 取消至终态/lease 可用；不是任务质量分 |
| E-12 显式 Writing | 明确 Writing 生成作品，随后保存/确认；旧版本继续 | 作品接纳与实际保存区分，来源合法；普通 Chat 对照不 Writing | 生成即声称已保存、旧 parent 越界 | 产物验证、保存 receipt、完整交付时间 |

离线层所有确定性 cases 必须稳定复现。真实模型层先对语义 cases 做改动前后各一次同配置运行；只有结论受到随机波动影响时，针对争议 case 重跑并记录逐次结果，不机械地全量重复。确定性 E-11 可用可控 App seam 完成，不为永不返回的假准备额外付 provider 费用。

网络资料固定响应用于可重复比较；实际 Web provider 的授权、开关、MCP 物理请求与错误恢复另做小型真实连接 smoke。不得用实时网页变化解释所有差异，也不把固定响应说成在线检索质量证明。

首个有用结果由 rubric 指定：如找到关键决定、得到可用证据说明、交付明确缺口，绑定实际可见/提交事件；thinking、心跳、“正在查找”不计。最终完成时间到真实产物被接纳/展示或任务真实终态，不能只取 provider EOF。调用统计包括 auxiliary、SDK retry、失败/取消可能已收费的 attempts；未知项单独列出。

## 7. Validation Strategy 与阶段门禁

### 7.1 分层证据与命令

| 层 | 命令/方法 | 通过条件与局限 |
| --- | --- | --- |
| Task focused | 各任务卡的 `npm test -- --runInBand <exact suites>` | suites 实际执行、相关正反例通过、自然 exit 0；不是完整回归 |
| Tooling | `npm run test:tooling -- --runInBand <exact suites>` | runner/fixture/报告接线真实执行；不代表模型语义或实际设备 |
| 类型 | `npx tsc -noEmit -skipLibCheck` | 必要中间集成检查；最终 build 已含，不重复计证据 |
| 阶段 broad + 本地部署 | 冻结 inputs 后 `make deploy` | 包含 lint/build/full Jest，成功复制到 `test/.obsidian/plugins/personal-assistant/`；仍需 reload 和 UI smoke |
| 合格已有构建复用 | `make deploy-current` | 仅 required checks 已对相同 inputs 通过且 current dist 时；build receipt 不证明 tests |
| Artifact（仅受影响时） | 先当前 build，再 `npm run test:artifacts -- --runInBand <exact suites>` | 若新增依赖 dist 的 runner/receipt，必须正确分类，不能误算 source PASS |
| 社区源码/差异 | 下方 DOM scan；`git diff --check` | DOM scan 无匹配 exit 1 为 PASS；有匹配逐个检查；不运行时注入 style/HTML |
| 文档 | `npm run docs:check`；`npm run test:docs -- --runInBand`（合同/检查器受影响时） | 新文档可达、metadata/REQ/AC 一致；现有 advisory 与本包新增问题分开 |
| 实际任务 | §6 runner + 人工 rubric + 原始请求/产物证据 | 确定性底线全部满足、语义逐例核实、成本边界可信 |

```bash
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

G0 为基线工具与实际运行接线检查；若需要构建部署 runner，仍遵守当前构建/授权边界。G1/G2/G3 各有 runtime 改动，必须在该阶段通过 broad+实际应用证据，不把全部 app 验证推到 G4。G4 可复用与最终输入完全一致的 G3 broad/app 证据；如代码/config/fixtures/依赖有变，则重跑受影响检查，不能混用不同构建。

### 7.2 Obsidian 场景

先确认本机 Obsidian CLI、vault 和插件构建身份；CLI/deep link 用于准备准确页面，再实际操作相应控件。只有代码测试不能标 UI PASS；只用 CLI 发命令不能证明菜单可点。

| Gate / scenario | 操作 | 必须记录的可见/实际证据 |
| --- | --- | --- |
| G1 / APP-01 | Chat 与 Pagelet 分别在准备/等待阶段取消，再发新任务 | 取消反馈、terminal、名额可再用；迟到结果无二次交付；健康长操作不被旧短时限截断 |
| G1 / APP-02 | 读 A 后改 B，普通追问、明确要求最新、尝试写入 | 普通回答引用 A 身份；最新重新取 B；写前 freshness/确认仍有效 |
| G2 / APP-03 | 新会话默认，三选项、另一会话、重开 | 图标名称/菜单选中/会话独立/持久恢复，英文中文无溢出 |
| G2 / APP-04 | 任务运行中切范围，再发下一条；重载后手动继续 | 当前请求不重发；下一条新 scope；旧收尾不覆盖选择；无自动跨 reload 重放 |
| G2 / APP-05 | 综合→网络追问，当前附件、旧 parent/Pagelet 对照，关闭能力/排除来源 | 历史仍展示；必要澄清；实际请求无越界；scope 不绕过现有动作保护 |
| G2 / APP-06 | 桌面键盘、窄窗；Obsidian CLI mobile simulator 点按/长按、软键盘与菜单开合 | 控件可见、说明可读、焦点与触控正常；记录模拟环境/Obsidian/build；仅 iOS 特有能力补 iPhone 真机 |
| G3 / APP-07 | E-04/05/06/12，正常零命中、缺材料、恢复、Writing 与保存 | 状态/文案与真实产物一致，不自动补通用答案，不假称保存 |
| G3 / APP-08 | 多步长上下文任务、摘要复用、Chat 与后台并存 | 正确结果、来源/轨迹/usage 可核对，取消可用，后台不因身份获得更小预算 |
| G4 / APP-09 | 最终版本固定任务复跑及兼容 spot checks | 最终 AC 对应实际证据，同构建已测项复用，未知/缺失项明确 |

若发现 iOS 特有能力需验证，真实 iPhone 与 iCloud test vault 仅使用另行获授权目标，不能将 repo-local deploy 自动扩成所有 live vault。模拟器交互必须实际操作，不得用一张移动尺寸截图替代 APP-06。测试后恢复临时设置/合成材料/插件运行状态，保留本任务审查证据。

### 7.3 复用、失败与 review

每片动手前主控在 Tracker 记录：风险/AC → 变化 → 最小命令/证据 → pass 条件 → rerun/扩展触发。输入身份包含源码、tests、fixtures、config、依赖、构建和部署目标，不能只写 HEAD。

局部故障从确切 command/assertion/log 分类：产品、fixture/runner、环境设备或旧 build。再次重跑须有新假设/变化；不加大 timeout、`--forceExit`、删断言或改产品来让坏 checker 过。两个同因失败无新信息时换诊断方法，主控保留原证据。独立 review 的 P0/P1/P2 修复并验证，或由 Owner 明确延期；不能在 writer 报告中自行降级关闭。

所有来源/权限/未知动作负例是不可抵消的底线。native/compat、UI、预算重构后重新运行受影响边界测试；没有输入变化或具体风险则复用原证据，避免各 reviewer 重复 full gate。

## 8. Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| 半成品范围被展示 | T-05–08 作为同一纵向交付；所有实际路径有清单 | N-03/04/08/18，G2 | 阶段不交付；不可悄悄放宽为 unrestricted |
| 冻结范围混同当前选择/权限 | 分三个 owner；原子 metadata 合并 | N-01/02/20 | 修正接缝，不通过切换 abort 规避竞态 |
| 旧历史“迁移”成伪来源 | additive reader，unknown 保守，原文保留 | 旧 v1/缺字段/损坏字段 fixture | 保留展示、停止不合法复用，不自动模型修复 |
| native messages 或清理破坏兼容 | 单一 canonical action group、adapter 表、逐片 baseline | N-13/14，现有模型/transport suites | 忠实兼容投影；不能删除支持或退回丢参数字符串 |
| 领域解耦误删有效保护 | facts 先接线后删；生产/type/旧 reader 证明 | N-15/16/19，registry/动作回归 | 回退尚未交付的清理片，保持 receipt/guard |
| 预算优化省钱但失去目标 | 不可丢集合、真实 baseline、辅助与主任务分账 | E-01/07/09/12，N-14/17 | 保留原安全 fallback，停止可选优化，不篡改质量门 |
| 评测不可比或成本不透明 | 固定模型/配置/fixture、独立 attempts、unknown | 逐例 raw output、usage 完整度、重复波动 | 不宣称收益，针对具体缺口补证据 |
| 多模型交接漏未提交合同 | 文件清单+hash+修订任务卡 | worker preflight 核对实际文件 | 停止依赖缺失合同的修改，补齐后续跑 |
| 执行范围扩大 | 主控派卡、writer 报告、Git/真实资料/设备授权分开 | changed paths/环境目标对照 | 停止偏离部分，保留已有独立工作 |

## 9. 可直接派发的任务模板与交付报告

以下是计划的一部分；主控填实际事实，不留 `<待填>` 就发给 writer，也不把模板复制成第二份状态文件。

```text
任务：B-149 / T-xx，revision Rn，模式：实施与 focused 验证
执行模型：GPT-6 Sol，已验证实际 model id 为 gpt-6-sol；主控验收者：实际角色
目标与边界：引用本卡 + 完整 REQ/AC + 对应 N/E cases
权威文档：Product Spec、SDD 指定章节、本卡、Tracker 路径与内容身份
交付树：实际绝对路径；HEAD；工作分支；起始 dirty 文件及所有权
补充未提交合同：精确文件清单 + hash；不得假定 worktree 已包含
最小阅读集：已核实文件/函数；沿用事实；本次必须复核的变化
允许写入：明确路径；允许生成的构建/测试产物；禁止写入范围
已接受修正：上一轮 finding、对应改法与仍有效的反例
动作权限：源码/本地检查范围；provider 的合成资料/模型/次数边界；
          实际 app/vault/设备部署目标；不包含的 Git/发布操作
验证映射：AC/风险 → 变化 → 命令/场景 → pass → rerun trigger
检查执行者：focused/full/deploy/app 各由谁执行，避免重复重型 gate
输出位置：临时日志和评测结果目录；需要保留的证据
停止点：本卡/指定阶段；遇实质偏离停该部分并报告，独立部分继续
```

```text
交付报告：B-149 / T-xx / revision Rn
1. 实际模型、目录、HEAD/dirty 输入身份、完整 changed paths。
2. 做了什么、为何符合本卡；未改变的关键边界；偏离/未实现项。
3. 每个 AC / N / E 的结果：实现、离线证据、真实 provider、真实 app
   分开；禁止将“未运行”“环境阻塞”“失败”写成通过。
4. 每条命令：cwd、范围、suite/test 数、自然 exit、日志路径、输入身份；
   高风险回归的 Red 断言和 Green 结果；不要粘贴整份大日志。
5. 构建/安装/实际加载身份、vault/设备、交互步骤与观测；仅 CLI 不冒充 UI。
6. 评测逐例目标/来源/允许差异、实际输出、logical/physical/purpose usage、
   unknown 部分、首个有用结果/交付时间、重复波动及参数依据。
7. 自查 finding、未关闭风险、需要主控判断的具体取舍与选项。
8. 自建资源/临时状态、已恢复项、保留证据及理由；无自动 commit/push/release。
```

## 10. Approval

- Plan authority: Owner 于 2026-09-24 明确要求按照 B-149 方案完成开发与测试，并指定 GPT-6 Sol max、适度测试与移动模拟器路径。
- Approved on: 2026-09-24。
- Authorized implementation scope: 按本包实施；真实 provider 的模型与费用边界、Git、外部设备部署和发布仍按适用授权分别处理。

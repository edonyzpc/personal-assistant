# Agent Context Reliability And Action Continuity

Document status: Current
Delivery status: Exploring
Updated: 2026-10-03
Work item: B-157
Authority: 当前 context 管理的源码审查、脱敏故障证据与候选优化方案；不是已批准实现或已交付行为。

初始问题、源码发现及原始审查授权记录的是 2026-10-02 基线，不能作为修复后当前行为的证据。本文元数据状态仅表示候选方案研究；执行状态以 [Tracker](../active/context-reliability-and-action-continuity/tracker.md) 为准。2026-10-03 新实验与候选假设见本文末节。

## Problem And User Outcome

用户先要求生成图片，再询问发布失败的原因，第三轮只追问错误如何解决，却再次发起了图片生成。实际请求中，第一轮用户要求仍在，第一轮调用、回执与完成回答已经缺失。这使 Agent 缺少旧任务已提交的依据，构成把旧要求重新执行的直接诱因；具体因果归因属于推断。

问题范围包括 `create_image`、`@Writing`、`@blog2ghost` 和 Operations：Agent 应能区分当前要求、历史要求、已经发生的动作、等待中的动作与未知结果。解释错误不能因为上下文丢失而悄悄重做旧任务；用户明确提出新任务或续接时仍应正常执行。

初始审查阶段授权是审查与建立方案；该阶段未修改运行时代码、测试、配置或真实 vault，未发起新的生成、保存或发布。后续按Owner明确授权进入实施与验证，实际记录以Tracker为准。真实故障的私有笔记内容、路径、provider 原始日志与推理正文不进入本文或后续外部 worker。

方案遵循 [North Star](../../product/pa-product-north-star.md) 的“安静且可信”，以 [Context Product Spec](../../product/specs/pa-context-management-product-spec.md)、[Agent Runtime Product Spec](../../product/specs/pa-agent-runtime-evolution-product-spec.md) 和 [DEC-043](../../product/decisions/dec-043-agent-runtime-evolution-and-source-scope.md) 为当前约束。目标是恢复这些契约的连续性与事实边界，不扩大动作权限或资料范围。

## Evidence

### 已确认缺口

| ID / 严重度 | 证据与触发条件 | 等级 | 源码依据 | 影响 |
| --- | --- | --- | --- | --- |
| F-01 / P1 | 生图返回 `accepted/taskId`、`sources: []`，没有 owner-proven 执行事实准入；启用 `runSourceSelection` 时 result lineage 落入 unknown。该结果被过滤，当前动作变成 `result_unknown`；持久化聚合 lineage 又使下一轮整条 assistant 被过滤，旧 user 要求仍在 | Confirmed：真实故障请求捕获与当前源码链相符 | [image tool](../../../src/ai-services/chat-tool-factories.ts)、[runtime](../../../src/ai-services/pa-agent-runtime.ts)、[source projection](../../../src/ai-services/task-source-run.ts)、[persisted turn](../../../src/ai-services/pa-agent-history.ts)、[action history](../../../src/ai-services/pa-agent-action-history.ts) | 发生过的提交被表达为未知，再失去执行记录；这次真实故障产生了第二个不同 taskId。接受任务不等于生成或保存完成 |
| F-02 / P1 | `compactActionResults` 将 `success/reused_result` 且 executionState 缺省或 succeeded 的 result 全文替换为 closed 占位符。Ghost 的 prepared/outcome_unknown 和 image accepted 都可满足该条件；action DTO 不携带领域 resultFact | Confirmed：源码条件；未执行 Ghost 发布或付费生图验证 | [history plan](../../../src/ai-services/context/PaAgentHistoryContextPlan.ts)、[action DTO](../../../src/ai-services/pa-agent-action-history.ts)、[Ghost receipt](../../../src/ai-services/chat-tool-factories.ts) | 调用成功被当作领域流程结束，待确认、待核实及任务身份可能消失 |
| F-03 / P2 | 历史摘要模型实际输入来自 `ChatMessage.content` 与图片元数据，不包含 canonical action/results。完整 canonical 参与 Host binding 校验，不等于摘要模型读到了它 | Confirmed：源码与零写入内存探针 | [summary source](../../../src/ai-services/context/PaAgentContextSummarizer.ts)、[summary binding](../../../src/ai-services/pa-agent-runtime.ts) | 对话 prose 未复述的执行状态和关键结果无法由摘要恢复；不能靠要求摘要模型“记住已执行”修复缺失输入 |
| F-04 / P2 | Operations staging 的 canonical fact 是 approval_pending；确认后 controller/ReviewSession 收到 applied/partial，下一轮入口仍读取旧 history，未见刷新领域状态的入口 | Confirmed：静态链路；后续模型行为尚未实测 | [executor](../../../src/ai-services/operations/operations-tool-executor.ts)、[controller](../../../src/ai-services/operations/operations-intent-controller.ts)、[Chat UI](../../../src/chat/chat-view.ts)、[runtime](../../../src/ai-services/pa-agent-runtime.ts) | UI 与下一轮模型可能看到不同阶段；“会误报待确认或重复建议”是 Inference |

F-01 的关键链路位于 `chat-tool-factories.ts` 的 create_image receipt、`pa-agent-runtime.ts` 的 resultLineage 分支、`task-source-run.ts` 的 projectTranscript/projectHistory 和 `pa-agent-history.ts` 的 modelVisibleMessages union。故障中的 Host 按合法工具调用提交了任务；缺少额外自然语言意图拦截不是本次根因。修复信息丢失能消除这条重放诱因，但不能据此保证任何模型绝不会再次调用工具，须用实际请求与行为验收。

F-02 还影响只读证据：审查中的内存探针构造成功 query_notes 结果，唯一包含合成编号 `CONTRACT_ID_734`。原投影 3254 字符，预算 913 字符时压缩到 813 字符，返回 fit、omittedCount=0、semanticSummaryChars=0，但最终 compat 消息已无该编号。请求 native 的同一夹具发生兼容回退，结果相同；这不构成独立 native 路径验证。探针加载实际 TypeScript context 模块与消息 formatter，对 Obsidian 宿主依赖做 stub，未调用 provider 或 app，未修改仓库文件。它证明“预算通过且零历史消息删除”不代表关键内容仍在。

### 命令间的真实差异

| 类型 | 已有可复用事实来源 | 下一轮当前行为 | 审查结论 |
| --- | --- | --- | --- |
| Image | ChatHistoryStore 中的生成任务、outputs 和 versions；领域 service 已有后台恢复 | Chat UI 下一轮确实 list 会话任务，将已保存 outputs/version 加入图片引用目录；未统一投影 accepted/running/failed/partial 等阶段 | 不能声称完全未刷新；F-01 已实证，目录存在不等于执行状态完整 |
| Writing | WritingVersionService、生成回执和 save receipts | 选定 parent 时读取版本；保存回执用于保存恢复/UI，未见保存状态统一进入下一轮 | 正常 get_writing_context 已有 contextHandle 精确匹配与 lineage 专例；未证明它命中 F-01 |
| Ghost | GhostOperationStore、controller/session 的准备、确认、发布与核实状态 | 新的显式命令通过 binding 恢复本操作；普通追问未见统一补入旧操作最新状态 | 正常 prepared/needs_attention/outcome_unknown 已有严格回执准入；通用 catch 是否造成重复尚未实证 |
| Operations | controller lifecycle events、ReviewSession、已有执行结果 | staging 本轮 acknowledgement 已受控；确认后 UI 更新，下一轮未见状态刷新 | F-04 静态缺口已确认，不能把本轮 staging 测试当成跨轮证据 |

命令标记及 writingAction 等历史元数据未全部进入统一模型投影，是设计不一致的线索，尚不是独立确证缺陷。优先恢复动作事实与状态；不根据命令词自动推断用户这一轮仍要执行旧任务。

### 验证边界与可复用测试

真实故障来自已安装 beta.17 的只读诊断；通用源码审查基于当前 master。二者是不同层的证据。其余 Writing、Ghost 和 Operations 的重复行为未做真实 provider/app 复现，不扩大结论。

- [chat-service tests](../../../__tests__/chat-service.test.ts)：已有 image source-validity 测试，但缺 scoped accepted 回执进入下一次 provider request/跨轮历史的断言；Ghost 已有安全状态下一请求和篡改/撤销反例。
- [Writing context tests](../../../__tests__/writing-context-runtime.test.ts)：覆盖准备上下文的范围准入与后续模型输入；不能替代保存后的状态刷新验证。
- [action history tests](../../../__tests__/pa-agent-action-history.test.ts)：已有 executionState 未决保护；缺领域 resultFact 表达 pending/unknown 的压缩反例。
- [Operations runtime tests](../../../__tests__/operations-agent-runtime.test.ts) 与 [ReviewSession tests](../../../__tests__/operations-review-session.test.ts)：覆盖 staging acknowledgement 与 UI 收到 lifecycle；未覆盖确认/取消后下一轮实际模型输入。

本轮未运行上述测试、build 或部署；现有测试的覆盖结论来自阅读，不是本轮 PASS 声明。

详细规划时补充核对了持久化边界：`chat-history-manager.ts` 保存时有意去掉 canonical.messages，重开时 messages 为空；Operations 的 terminalStates/Undo 也主要在内存，未提供可重载完成结果查询。它们是实施输入限制，不等于单独证明重复执行。跨重开保留需要扩展现有历史的最小安全状态字段与真实 Host 后续结果接线，不能仅改内存投影，也不能原样保存完整 canonical 或 Undo 正文。

## Candidate Requirements

- **B-157/REQ-01 — 已发生事实可用。** 已获准的历史调用与真实执行事实保持关联；不存在“旧要求仍在，已提交事实因无正文来源被误判未知”的非必要不对称。任务已接受、产物就绪、已保存、等待确认、部分完成和未知结果分别表达。
- **B-157/REQ-02 — 隐私准入不放宽。** 正文、路径、参数、URL、错误回显和依赖材料仍按完整来源准入；unknown、混合不可拆分、撤销和过期依赖继续拒绝。独立状态视图也须由 Host/领域 owner 证明并重新准入，不能由空 sources、摘要或模型自述制造 complete lineage。
- **B-157/REQ-03 — 当前状态进入下一轮。** 已知操作在确认、取消、后台完成、部分失败或结果核实后，后续合法请求得到领域当前事实；旧事件保留其历史含义，不能覆盖最新状态，也不能把状态读取变成自动恢复或重放。
- **B-157/REQ-04 — 压缩保全语义。** 工具 outcome success 不等于领域流程关闭；未决动作保留最小状态与身份。已结束的调用仍须保住当前任务所需关键证据、失败原因和引用关系，不能只留下占位符。完整投影能放下时沿用现有可逆历史。
- **B-157/REQ-05 — 同一获准事实来源。** 当前轮、跨轮历史、native/compat、摘要与降级使用一致的获准动作投影；不重复观察，不外发 Host 私有 resultFact 原对象、权限凭据或秘密。
- **B-157/REQ-06 — 按真实请求验收。** 同时验证“模型收到了正确上下文”和“它据此完成当前要求”；不以 UI 状态、预算 fit、摘要 schema 合法或 Host 未拒绝调用替代行为证据。

## Options

| Option | User value | Cost / risk | North Star fit |
| --- | --- | --- | --- |
| 每个命令补提示词与局部去重 | 可减少部分症状 | 不修复过滤、摘要和状态不同步；普通新任务还可能被误挡 | 不推荐作为主方案 |
| **复用 canonical/resultFact 与领域服务，统一获准执行事实的 context 投影** | 各命令共享连续性保证，并保持原有权限职责 | 需处理来源粒度、领域阶段、预算及兼容路径；可分步落地 | **推荐** |
| 新建任务 ledger、Agent SDK 或 Host 自然语言意图分类器 | 暂无已验证增量价值 | 重复状态权威、迁移与维护成本；混淆 Host/Agent 责任 | 当前不进入范围 |

## Recommended Design

### 1. 在已有 canonical 边界拆分正文和可证明状态

继续以 canonical transcript 与各领域持久化服务为事实来源。复用 `PaAgentResultFact`、tool outcome 和 executionState，给领域 owner 定义最小、封闭的模型可见状态映射：有限阶段枚举、opaque task/operation/receipt ID、调用关联及必要的状态更新身份。生图的“已接受”不能借用 artifact_ready；Writing ready 不能借用 writing_save；Ghost prepared 不能借用 published。

`PaToolResultContent.resultFact` 当前明确是 Host-only。优化应在可信边界内从它生成经过字段 allowlist、来源准入的安全视图，不直接把该对象加进 prompt。特别是 sourceRefs、completedRefs/remainingRefs、目标路径、原始错误、权限依据不可因“状态”标签自动出境。只把可证明且获准的状态投影给模型；大段内容仍沿现有来源链。

准入按实际片段处理：不能只给整轮原始消息做 lineage union 后把整轮丢掉，也不能简单改为使用最后一条 assistant lineage 后原样发出整条 canonical。未知正文不应污染一个独立已证明且获准的状态；但状态自身包含被撤销依赖时仍须拒绝。范围收紧后不能通过 task ID 找回被排除资料，也不能把历史事实当成新的动作授权。旧会话没有证据的结果保持 unknown，不伪造历史成功。

### 2. 下一次请求按已有领域状态补齐事实

沿现有 Chat 请求准备链补入该会话中相关、仍可合法引用的操作状态。先复用当前 image list/versions 的加载，再连接 Writing save receipts、Ghost operation store 与 Operations lifecycle/results；不给每种命令建立第二套存储。

更新按已知操作身份合并，保留“当时接受/准备”和“现在完成/取消/未知”的区别。使用领域现有版本、currentness/source epoch 与会话身份校验；迟到事件不能覆盖新状态，读取期间发生确认/撤销时在真正 dispatch 前按既有规则重验。正常下一轮只读取状态，不轮询所有远端任务、不自动重新提交、不恢复未知副作用。重开或 reload 以现有可持久化回执恢复；未持久化的旧状态如实未知，不补造凭据。

当前用户原文及明确命令选择继续有最高任务解释优先级。历史记录是过去发生过什么，不是给当前轮追加待执行指令；摘要也不授予工具或写入权限。Host 保留确定性的授权、身份、版本和执行保护；Agent 负责理解用户是在解释、续接还是发起新任务。

### 3. 让预算、压缩与摘要消费相同动作事实

扩展现有 action-history 投影，使压缩器在 Host 边界内能判断真实领域阶段，并输出安全状态。transport/tool success 只能说明调用返回，不能用于判定流程关闭。accepted、approval_pending、running、partial 和 unknown 等操作保留最小身份、真实阶段及恢复限制；已完成操作保留足以避免误判未完成的事实。

终结状态也不能授权删除关键证据。旧大段结果缩减前，应有任务相关的获准摘录或语义摘要承接其关键内容、准确编号与来源关系；若没有足够承接，保留所需原文或明确报告 context 不足。具体规则复用现有 Projector、Compactor、Budget 和 summary 六字段，不新造第二套压缩层，也不复制源码预算常量到文档。

摘要模型输入改为获准 prose 加动作/结果投影，不能仅把 canonical 放在 Host binding 内。范围准入先于摘要请求；摘要更新沿用原有 source binding、currentness、缓存失效和无工具权限。关键未决状态保留确定性的安全表达，避免完全依赖 LLM 转述。native 与 compat 最终消息从相同投影生成；自动兼容回退和摘要失败后的降级同样保住必要状态与关键证据。

## Implementation Slices And Validation

详细任务依赖、AC、逐项测试设计、准确命令/分组、模型与 app 验收见 [B-157 开发与测试计划](./context-reliability-and-action-continuity/plan.md)。Owner 后续已明确授权按完整方案与计划实施；执行状态和证据以 [Tracker](../active/context-reliability-and-action-continuity/tracker.md) 为准。

以下保留实施顺序与退出条件；复杂状态/来源设计在同一 Active Package 维护，不再为每个命令建一份计划。

| Slice | REQ / 风险 → 改动 | 最小充分证据 / 方法 | 通过条件 | 重跑或扩展触发 |
| --- | --- | --- | --- | --- |
| S1：回执与准入 | REQ-01/02/05、F-01 → owner 安全状态映射、canonical 片段准入、跨轮关联 | 扩展 chat-service、action-history、persisted history、source-boundary 的现有 focused source suites；捕获实际 provider 输入 | scoped image accepted → 下一请求仍有已接受事实；未知正文不越界；调用/结果不串联；legacy、篡改、撤销反例仍拒绝 | 回执 schema、lineage、存储或调用配对规则变化 |
| S2：领域状态刷新 | REQ-03、F-04 → 复用现有服务更新下一请求的相关状态 | Image 完成/失败；Writing ready/save；Ghost prepared/未知/完成；Operations confirm/cancel/undo 的 service + Chat 请求捕获 | 模型看到最新合法状态；历史与当前阶段不矛盾；状态刷新零额外提交/写入；迟到事件及 reload 不伪造结果 | 领域生命周期、currentness、持久化或事件顺序变化 |
| S3：压缩与摘要 | REQ-04/05、F-02/03 → 领域阶段判断、关键结果承接、summary 输入接线 | 现有 context/action-history/summary suites；预算前后实际 final message 对照，native 与 compat 分别可达；至少三次摘要更新及降级 | pending/unknown 的身份与阶段保留；关键合成编号与来源仍可用；完整投影能放下时无摘要；已结束结果压缩后不伪造未执行；范围反例不过界 | formatter、预算、summary 内容/缓存/降级变化 |
| S4：行为验收 | REQ-06 → 合成三轮任务与明确新任务对照 | 同一已配置 provider/model 的基线/优化实际续答，使用合成内容与记录型工具；实际 test vault 交互 | 第三轮解释问题且无新生成/保存/发布；明确新请求可正常执行；Writing 不误报保存、Ghost 不误报发布、Operations 不误报待确认；未知结果先核实 | source diff、提示语或实际模型变化；明确行为失败 |

三轮主夹具使用“生成一个产物 → 发布准备失败 → 解释并说明如何解决”，断言第三轮没有新副作用调用。另设“在解释后明确重新生成/继续操作”的对照，避免把所有后续执行都禁掉。Ghost 错误夹具覆盖显式目标与“当前笔记”的区别，不能把调用参数错误解释成 API 配置缺失。

验证应包括：同工具不同参数、重复 call ID、多动作、结果未知、范围切换、取消、来源撤销、后台迟到状态、保存/reload 和预算压力。先复用最接近的确定性用例，每个新增用例只回答一个未覆盖风险；不为四种命令机械复制全部矩阵。

共享 runtime/来源/跨模块实现最终执行仓库要求的 lint、build、`test:all -- --runInBand` 和 diff 检查，统一安排一次当前输入状态的全门。运行时与 UI 验收使用 `make deploy`，或在其规定的已有验证/构建条件满足时用 deploy-current，再实际观察 Obsidian test vault。完整测试通过不替代 provider 语义行为或真实 app 证据。真实付费生成、真实 Ghost 发布、私有 vault 部署与 Git/release 仍按各自既有授权处理；实现期先用合成内容和记录型提交，避免为诊断产生真实副作用。

本次文档验证只需要 docs:check 与 diff 检查；不因建立方案执行 runtime 全门或 app 部署。

## Discussion Summary

| Date | Authority / participants | Conclusion | Still open |
| --- | --- | --- | --- |
| 2026-10-02 | Owner 与审查 agents | 根因优先归于 context 信息丢失；给定错误上下文，Host 执行合法 create_image 调用符合现有职责。Owner 要求覆盖 Writing、blog2ghost 等命令建立根本优化方案 | 推荐方案的实施尚未授权；其他命令实际重复行为及修复后模型行为未验证 |
| 2026-10-02 | Owner 与规划 agents | 按 B-157 方案制定详细开发测试计划，补充最小安全状态落盘、Operations 后续结果与现有评测 harness 适配任务 | 本次只规划；实现、模型/app 验证与 Git/release 不由计划文档授予 |

## Initial Decision Needed

推荐按统一投影方案进入 S1–S4，先修复“已发生事实无法进入模型”的链路，再补当前状态与压缩承接。顺序是技术拆分，不把只修图片的一小步当成整项完成。

初始待决定的是是否进入实施，Owner随后已明确授权。本方案不要求新增产品模式、扩大来源或动作权限；恢复既有契约无需仅因技术拆分制造新 Product Decision。若实施时发现必须改变这些边界、引入新持久层或接受未决风险，先列出具体偏离再由 Owner 决定。

## Exit

- 进入实施：沿用现有产品契约，建立 B-157 的最小 Feature Home/Tracker；因跨模块、隐私与状态生命周期需要补必要的技术设计。只有真实验收后才更新 delivered 声明。
- 延后：保留 Backlog 与本 Brief，重新启动条件为 Owner 授权实施；不修改当前产品规格的已交付状态。
- 收尾：稳定结果吸收进当前 context/Agent 契约与测试，保留必要的脱敏故障/验证证据；不永久保存完整过程或私有日志。

## Follow-up Hypothesis: Task Scope And Evidence Meaning

2026-10-03，Owner保持严格标准，拒绝Host意图分类或固定状态回答，要求继续判断验证历史与当前command/skill归属。以下是实际实验结论与下一候选假设，不是已批准的新实现，也不覆盖Tracker中的原始失败。

### 已确认的表达缺口

native历史与当前调用共用未区分scope的[action-history投影](../../../src/ai-services/pa-agent-action-history.ts)，[prompt builder](../../../src/ai-services/pa-agent-prompts.ts)仍把旧用户请求作为普通HumanMessage。[history plan](../../../src/ai-services/context/PaAgentHistoryContextPlan.ts)没有完整承接已持久化的Writing选择；[ChatView](../../../src/chat/chat-view.ts)则将当前命令说明拼接进用户prompt。历史与当前`load_skill`结果在实际SDK消息中使用相同正文/标题，缺少用途与任务归属。

这些缺口证明上下文表达仍可改进，不能证明它们是每个剩余错误的唯一原因。`load_skill`是读取方法指南，本身不等于执行该工作流；为当前任务再次读取合适指南不构成重做历史副作用。历史中仍有效的目标、偏好、约束与最新领域事实继续有效，不能因加上“历史”标签全部丢弃。

### 有限对照的结果

从既有六个合成实际HTTP请求取完整body，A保留原消息，B只加入可逆的历史/当前归属与用途标注、当前用户/运行说明分离、确有持久化依据的Writing界面选择。各两次交错观察，总计24次实际请求；沿用同一已配置provider/model及原工具、系统和非messages参数，未执行任何模型返回工具。独立审查在实际请求数仍为0时移除了被误标为UI选择的Image自然语言请求，旧输入保留。

| 情况 | 原输入A，两次 | 候选B，两次 | 可以得出的结论 |
| --- | --- | --- | --- |
| 新Writing任务 | 均选择`get_writing_context`，无旧parentHandle | 同样正确选择 | 原普通正文失败在A也未复现，不能归因于候选；未验证新artifact交付 |
| Writing已创建笔记、整体partial | 一答核心正确但有推测限界，一答严格失败 | 两答严格失败 | 标签没有消除编造“最终确认/applied回执”或把已知创建降为可能的问题 |
| Operations结果unknown，当前笔记缺行 | 两答误判状态并邀请重做 | 两答仍误判状态并邀请重做 | 识别当前/历史标签不等于正确理解观察证据；当前缺行不能证明历史未生效 |
| Ghost旧skill及最新published | 均识别已发布 | 均识别已发布，额外推测有边界限制 | 无重做/邀请；原body未绑定`prepare_ghost_post`，不能据此证明该能力可用时也不重做 |
| Image历史已完成/保存 | 均识别完成/保存 | 同样识别 | 无新生成/邀请；部分回答仍把保存推成当前可见，不能声称全部细节正确 |
| Image明确新自然语言请求 | 均选择一次当前Maple的`create_image` | 同样正确选择 | 按原schema省略count合法；未验证提交/完成 |

24次均HTTP200，没有重试或辅助模型调用；原始请求、回答、reasoning及工具选择保留在`/tmp/pa-b157-20261003-scope-probe/live-final.json`，独立判读在同目录`review.md`。组合候选、两次重复及原Writing失败未在A复现，均限制因果推断；不能据此声称标注已修复问题，也不能将模型首轮决策替代完整runtime/app行为验收。临时helper已卸载并移出test，owned globals全部清除，模式未变；生产源码与已安装bundle未改。

### 下一候选：分开任务归属和事实能证明的范围

归属补齐仍有价值，但下一设计需要让现有context投影同时表达以下关系，并保留各字段的领域含义：

1. **当前请求与真实选择。** 保留用户原文；界面实际选择作为单独事实，不能把自然语言请求推成点击命令。当前能力协议是本轮方法要求，旧协议文本与旧调用是历史记录。
2. **历史任务与最新结果。** 沿已有turn/task/call关联表达旧请求、已发生步骤及最新获准owner结果。将历史已完成命令与仍有效的目标/约束分开，避免自由摘要把旧调用升成当前待办。
3. **执行结果与回执可用性。** “跟踪丢失/没有applied回执”不能证明动作没有效果。Writing的created/partial沿Writing子步骤解释，不套用Operations确认流程；Ghost published和Image saved同样保留原领域依据。
4. **当前观察与历史推断。** 表达读取对象、范围与观察时点；当前读不到某行只说明此次观察的内容，不能单独断定旧写入从未发生或推造失败原因。只有可证明关联的证据才更新已知结果。
5. **事实与动作权限。** 归属和完成记录不授予新的执行权。Agent仍负责判断用户是在解释、续接还是发起新任务，Host继续执行既有授权、来源、身份与并发保护；不增加固定回答、Host自然语言分类、隐藏工具、新ledger或第二模型。

这些维度应复用既有Projector/history plan与有限领域状态投影，保持native/compat、压缩、摘要与降级的一致表达。标注不能提升原内容的来源/信任等级，不能外发Host私有对象，也不需要复制持久化状态权威。下一有限实验应针对上述语义区别使用既有严格失败与明确新任务反例；只有输入假设发生实质变化才重新观察，随后仍需实际交付链验证。具体字段与实现尚待设计讨论，现有严格验收标准不变。

### 第二版有限实验的设计边界

Owner继续验证后，以前述归属候选B作为不变基线，C只增加同一份通用维度释义及`evidenceIndex`，各两次交错观察六个原case，总上限24physical。49个值逐项引用原消息里的owner/opID/saveID、阶段、效果知识、领域结果、权限标签或当前read范围/版本/完整性；不重复用户原文、origin、笔记正文，不计算“缺行证明未写入”或补充缺失字段。B须与上轮已派发B完全相等；去掉C注解后须恢复B，再恢复原wire。

独立设计审查明确：不同领域的unknown可能有真实owner记录，不能一概标为记录不可用。`phase`默认是owner-specific进度/状态，仅Operations lost按原控制handle可用性解释；`effectOutcome`仍单独表达效果知识。Writing的created检查点是初始正文已存在并核验时的历史事实，不能扩张成最终完成、UI确认或当前文件存在。当前完整读取仍是指定版本与范围的快照，其工具正文保留untrusted来源。

索引只是相同证据的重复呈现，不增加独立确认。若模型表现改善，只支持“维度释义与来源索引组合”候选；生产设计应组织既有投影，不能据此长期叠加重复观察或新增状态权威。结果及审计/审批/资源恢复证据只记在Tracker，初始失败与严格标准保留。

### 实验后收敛：当前任务与当前方法协议

第二版完成盲判后揭盲：B/C的Writing partial和Operations unknown均各两答事实失败，Operations各一答仍邀请重做；C的一次新Writing仅输出普通正文，准备步骤未发生。新Image四答准备正确；Ghost目标published均正确但C有历史run归属措辞错误；Image历史C保持观察边界，两次重复不足以证明整体改善。完整结果及限界见Tracker，本轮未执行返回工具，不将首决策等同于实际runtime终结或交付。

独立审查在失败C的实际wire中确认当前Writing选择已经存在，模型也识别了新的枫树任务和“不保存”要求。当前runtimeInstruction仍同时含“Before presenting writing, call get_writing_context...”与“Reply with ordinary text, or prepare a writing context before delivering a finished work.”：[准备提示与未准备阶段提示](../../../src/ai-services/pa-agent-runtime.ts)对应1833/3500行。未准备阶段没有清楚限定普通文本适用的任务分支；[已准备协议](../../../src/ai-services/writing-output.ts)的52行则区分普通讨论、未完成说明与成品交付。这里有可证的方法表达缺口，不能归为当前选择信息再次丢失，也不能证明它是unknown/NoOffer或全部失败的唯一原因。

下一候选优先沿现有prompt builder、runtimeInstruction与history projection组织以下四部分，统一当前方法的语义，具体实现尚未实施：

| 输入部分 | 表达职责 | 保持的边界 |
| --- | --- | --- |
| 当前请求 | 用户全文仅一次，关联当前run与真实界面选择；其余来源作为上下文引用 | 不从自然语言伪造点击，不由Host判断是在解释还是生成 |
| 当前方法 | 集中表达实际工具与准备阶段；Writing未准备/已准备/结束阶段对普通讨论、合理未完成和成品交付使用同一含义 | 分支由Agent理解当前要求；不强制每个Writing回合调用作品工具，不固定答案 |
| 历史材料 | 旧user/calls/results及skill方法参考有明确历史归属，保留有效目标、约束、正文及来源 | 读取skill不等于执行工作流；旧命令不自动成为当前待办或新权限 |
| 最新事实 | 已获准owner结果与当前观察各按原领域/范围解释；解释执行、记录可用性与观察能证明什么 | 历史检查点不保证当前存在，当前快照不证明历史未执行；不加独立ledger/原始Host对象 |

先处理当前方法提示的可证歧义，再评估统一装配。实现验证应复用当前Writing、context、prompt及history相关用例，覆盖“实际Writing选择+新作品”“同一能力下只讨论/澄清/合理未完成”“明确独立新任务与旧完成产物分离”，native/compat/摘要/降级保持同一表达、用户原文一次及来源门。真实行为仍需完整Writing交付链与解释反例；现存unknown/NoOffer失败单独保留，不能宣称Writing方法修改一并解决。候选未明确前停止未经注册的字段/提示微调，不以更多样本挑选通过或晋升失败候选。

F-27将这部分收敛为已批准REQ-05/06下的兼容装配修复：沿现有builder给历史与本run调用/结果明确归属，当前方法与用户全文分列，并集中Writing阶段协议。无意图分类、强制每轮作品、权限/存储扩展或新的事实权威；不是把F-25/F-26失败索引候选直接晋升。具体源码设计见[SDD](../active/context-reliability-and-action-continuity/sdd.md)，实施和验收证据只记[Tracker](../active/context-reliability-and-action-continuity/tracker.md)，不以接线检查代替真实语义验收。

### 实现后判断：区分上下文交付与Agent消费

F-27的实际请求与独立输入链审查没有发现两条剩余NoOffer失败中的具体遗漏或当前重做冲突指令。历史请求/执行已有明确历史归属，最新owner结果保持其领域含义，当前方法及用户全文真实到达，解释场景仍能使用获准工具；模型正确解释现有结果后，自行增加修改/扩展或重新追加的邀请。该证据不能继续支持把这两例归因为“已执行信息丢失”，也不能推广成所有旧失败都由模型造成。具体判断和限制仍以Tracker为准。

根据Owner“新增保障先讨论”及“Agent自行判断、拒绝Host固定行为”的选择，下一方向只讨论，不晋升未通过的索引候选，也不继续未经注册的提示微调：

| 讨论方向 | 具体职责与待验证假设 | 不改变的边界与限制 |
| --- | --- | --- |
| Agent本轮任务与结束自检 | 由Agent根据完整当前请求、有效历史约束及最新结果形成本run工作判断；行动前核对目的，结束前核对实际交付、未完成部分及答复是否自行引入新任务。讨论能否在现有Agent流程内形成可观察、有限的检查，而非再次加一段静态禁止句 | 判断不是Host事实或授权，不新增持久ledger；Host不解析自然语言裁定意图、删工具、固定回答、强制每轮作品或自动重试。尚无证据证明自检能解决失败，调用/延迟/成本与具体流程须先明确 |
| 模型遵循能力对照 | 冻结同一完整上下文与工具条件，讨论有限对照，区分某模型的指令消费与上下文结构缺陷；所有失败保留，禁止挑选成功样例 | 当前来源、交付及unknown/NoOffer标准不弱化；新模型/provider或数据范围不能默认获准；首决策对照不等于实际作品/领域交付或完整验收 |
| 其它context关系审查 | 先给出可定位的缺失、冲突或来源/任务关联假设，再用现有wire及反例只读验证；有具体缺陷才修复和补受影响门 | 不能用“上下文仍可能不够”代替证据，不把多加标签或重跑未变输入当作修复 |

这属于后续设计选择，尚未修改当前Spec/SDD或新增运行行为。完整矩阵、三次摘要消费与受影响可见交互的原验收要求继续有效；先前未改owner/存储/缓存和已完成清理证据按输入影响复用。

### 补充判断：观察未知与权限说明的对象

后续原生证据定位到具体表示冲突：正常`present_writing`纯输出没有常规toolResult，历史投影却无条件写成执行/副作用未知，同一输入另有获准Host作品ready事实。这里观察可用性与领域阶段是两个维度。按既有事实表示合同将`result_unknown`限定为`unknownScope: tool_observation`，缺观察不能否定独立事实；无事实仍未知并须核实，不能按工具名称补造成功。实现与真实验证的唯一状态入口仍是Tracker。

修正这一明确缺陷后，真实请求中作品ready、工具观察范围、搜索覆盖和权限解释规则完整且一致；Agent仍把`grantsWriteAuthority:false`解释成“历史操作本身没有写权限”，并将获准范围零匹配扩张为整个vault从未保存。字段漏送或明确冲突未再定位到；权限字段的对象/时间归属是下一项设计假设，不能因模型误读就宣称新的源码缺陷，也不能将全部旧失败归为纯模型问题。

沿Owner希望由Agent判断的方向，建议先讨论现有context的语义分区，仍由同一Projector/history/summary体系表达：

| 分区 | 表达对象 | 消费时要保留的关系 |
| --- | --- | --- |
| 历史执行事实 | 原任务、已发生步骤及最新获准领域结果 | ready/created/completed/unknown各有原领域含义，事实本身不授予本轮新执行权 |
| 历史材料的使用效力 | 这份上下文材料对当前run的用途 | 不能扩张当前授权；这项限制不能被读成过去操作没有授权或没有执行 |
| 当前请求与方法 | 原用户全文、真实界面选择、当前可用方法和阶段 | 解释、续接或独立新任务由Agent理解；旧command/skill引用不自动成为当前执行请求 |
| 当前观察 | 此次读取/搜索的对象、范围和时点 | 零匹配只证明该范围未找到，不抹消历史执行事实，也不补造历史未发生 |

具体候选需要先明确字段放置、对象/时间范围、既有native/compat/压缩表示如何一致及如何恢复原材料，再登记最小受影响验证。既有权限、来源与并发保护继续执行；不增加Host自然语言意图分类、固定答案、隐藏工具、强制每轮artifact或自动重试。此分区方案仍是讨论候选，未改当前事实权威或执行策略；现存NoOffer、权限误读及作品/解释分离失败继续按原标准保留。

### 可审查候选：把材料效力从执行事实中移出

第一项候选只移动现有权限说明的位置，验证对象/时间归属这一假设。当前每条投影state包含完整领域事实和`contextOnly:true / grantsWriteAuthority:false`；候选保留事实，另用明确指向当前run的材料对象表示使用效力：

```json
{
  "materialUse": {
    "scope": "current_run",
    "contextOnly": true,
    "grantsToolAuthority": false,
    "grantsWriteAuthority": false
  },
  "facts": []
}
```

`facts`承接现有安全provider投影的全部事实字段及保存子步骤，包括owner、operationId、phase、origin、动作子步骤与unknown/effect字段；不外发原receipt或私有证明。移出的两个恒定标记说明这份材料不能扩张本轮授权，不说明过去操作缺权限或未执行，也不取消当前已经获准的工具。历史目标、约束及长期偏好仍保留；当前请求如何续接旧目标由Agent判断，不给Host增加自然语言任务分类。

native的`domain_state`保留历史scope，JSON使用上述envelope，外层权限标记移入`materialUse`。raw/compat/lossless候选仅在provider序列化的`historyRecord.actionStates`使用相同envelope，包括空数组；持久化state、准入、私有binding和来源数组契约不变。summary确定性retainedActionFacts已经不含逐事实权限字段，保持现有事实视图。当前请求/真实选择/方法和工具观察保持现有表达，以限定这次假设；不能借此把旧command/skill引用变成本轮执行请求，或把零匹配升级为历史不存在。

如选择实施，显示envelope须从完整`projectActionStates`派生，不能用省略origin、收缩all-applied子动作的`projectActionSummaryFacts`顶替。共享`historyRecord`、native emitter与原plan/projector必须消费同一显示表示，预算在最终表示形成后计算；`historySummaryContent`的`.actionStates.length`须按显示envelope同步读取`.facts.length`，内部state数组判断保持原样。既有转义、可逆正文编码、摘要protected sources、cache currentness、取消/并发及降级保护继续适用，不在已准入请求后追加材料，也不提高预算或删除必要事实。

本次已实际执行离线预览：五份冻结公开合成报告共146个已记录请求body样本，73个相关上下文块、32个唯一安全投影状态及8个unknown/lost效果状态可逆保留；未改消息/角色/工具配对、SDK其它字段和当前请求/方法/工具保持。样本遍历不筛选HTTP dispatch，唯一状态不是独立来源佐证，也不覆盖全部生命周期或未改历史command/skill/方法/观察的全部消费行为。大小写tag、emoji及重复编码材料往返另有检查。native单块增加9个UTF-16字符，raw/compat最高增加546；当前summary原ordinal8历史块4758→5270，在fixture的5000预算下不能直接附加。该条件比较没有运行候选生产planner/admission，不是预算门或模型行为PASS。脚本与实际前后预览保留于`/tmp/pa-b157-20261003-material-context-design/`，执行/审查状态只在Tracker记录。

这是可讨论的消息结构，尚未选择、实现或派发；不预判Agent理解改善，不将F28后的权限误读升级为第二个source defect。若选择，先验证显示/预算/摘要/降级接线和事实完整，再按原计划补受影响最小真实链与完整严格门；所有既有FAIL继续保留。Agent自检、模型对照等额外保障仍须先讨论，不自动切换为Host规则。

### 证据纠正与 Owner 验收澄清（2026-10-03）

此前把无执行的历史Writing提示混称为“写作交付不合格”，范围过宽。Owner明确：仅询问是否继续写作／修改、没有实际Writing执行，为非阻塞的后续体验优化。当前明确任务是否交付及是否满足成品要求另判；F-27 native独立新Maple任务确有artifact，正文／解释未分开是另一个样例。旧报告及verdict保留，当前分类遵循Product Spec本次裁定，执行状态只记Tracker，不因重新分类追加模型请求。

F-28的未保存结论符合实际fixture。恒定投影标记`grantsWriteAuthority:false`不记录过去权限，也不是当前写入设置；不能声称历史授权已完整到达。此次搜索只覆盖两篇获准笔记，零匹配不能支持全vault不存在，但搜索是合法佐证，不能把它单独认定为错误结论的原因。原普通答FAIL是人工对说明质量的判读，不是自动checker失败、保存事实错报或重复执行；这些纠正不证明materialUse假设，也不排除后续定位新的context问题。兼容既有契约修复仍在原授权内，未选结构及新增Agent保障只限制各自实施。

### Harness 修订设计：权限硬门与模型理解分开（2026-10-03）

Owner确认Host、当前模型请求、历史上下文的职责划分可保留，要求重新审视harness：模型收到的authority字段是软约束，不能保证Agent按预期理解或执行。这是本次设计输入，不表示下列消息角色和历史表示候选已经实现或通过验收。新方案沿既有ContextManager、Projector、final builder、工具Loop及领域确认入口，不增加SDK、权限账本、Host自然语言分类器或每轮强制产物。

#### 已核实的结构与设计问题

1. `projectActionStates`对每条provider状态恒定添加`contextOnly:true/grantsWriteAuthority:false`，native历史状态外层又重复添加权限提示。它们不是授权记录，也不参加本地权限检查。原意是避免历史材料被当成新授权；逐状态表达却混合了事实与材料提示。F-28公开回答已经把false解释为过去操作无写权限，该解释又随普通assistant正文持久化。结构化标记本身不在原始state里，不能据此声称错误解释也不落盘。
2. `projectUserInputSteps`把当前runtimeInstruction、背景和用户原文拼成同一`currentInput`，最终主要靠文本标题／tag说明归属。原文已避免重复，但当前协议与用户要求还未在消息职责上分开。
3. native历史调用使用`AIMessage.tool_calls`与配对`ToolMessage`，与本轮轨迹主要靠scope区别。没有发现Host会重放这些历史消息；原生历史形状本身也不证明设计错误。它是需要对照的理解歧义候选，不能直接认定为所有误判的原因或无证据删除调用／参数／结果关系。
4. Host来源、当前工具绑定及Writing／Operations／Ghost确认检查不消费这些authority提示。模型在当前合法能力上发出错误任务调用，属于理解问题；权限检查通过或拦截了调用，都不能代替对此问题的判断。

#### 输入语义契约

| 材料 | 形成方式与消费语义 | 必须保留的边界 |
| --- | --- | --- |
| 当前用户请求 | 完整原文和合法用户附件只出现一次；真实当前UI选择独立关联到当前请求，不由历史推造 | 用户原文、所选对象及多意图不被Harness改写；仍有效的历史目标可以继续 |
| 当前方法／交付协议 | Harness生成的受控协议单独装配，反映真实已绑定schema、准备阶段和可用handle | 只提升可信协议模板的消息职责；历史skill或工具返回正文仍是有来源的方法资料，不整体提升为系统指令 |
| 历史对话与动作 | 标明先前事件、方法参考及关联call/result；旧command/skill执行不自动成为本轮待办 | 保留原文、合法参数／观察、动作身份和仍有效的约定；最新用户修正胜过旧约定，不只保留最后一句 |
| 最新领域执行事实 | 从现有owner回执与准入状态投影phase、operationId、origin及必要子步骤；与旧assistant说法分开 | completed只证明对应操作，不能代表同turn全部用户目标完成；unknown不改为没发生；不附加历史权限boolean |
| 本轮调用与观察 | 按真实本轮native调用／结果关联及实际读取范围投影，作为本轮新增证据 | 局部零匹配不扩大为全库不存在；当前观察不自动抹消历史效果，也不重复注入 |

内部lineage、binding、凭据、当前权限校验及确认票据继续由Host持有；模型可以知道当前工具定义、需要确认的流程和真实拒绝结果，但这些说明不承担安全门功能。用户原话中的许可、撤销或“只解释”等限制作为用户意图证据保留，不能因为移除内部权限标记而删除。

#### 最小修订路径与取舍

第一步，从provider动作事实及相关历史展示外层移除冗余`grants_*`，不引入同义authority对象。`materialUse`方案保留为前次离线研究，不再作为当前推荐的修复方向；其字段往返结果不能证明harness理解改善。保留来源／时间归属、数据与指令边界，不顺手删除其它模块有独立含义的`contextOnly`。native、compat、raw、summary及fallback共用获准事实投影，预算在最终表示形成后计算。

第二步，在现有parts／final builder里分别装配当前用户请求和Harness生成的可信协议。当前工具定义和真实阶段是方法说明的依据，不从历史command/skill恢复能力；加载skill只取得方法材料，执行目标仍由Agent结合当前请求与有效约定理解。不要把全部runtimeInstruction字符串直接提升为可信消息：其中选中作品等资料要按其来源保留数据身份。旧普通回答中的权限误解释不作为权威事实；不改原始记录，不通过字符串删除用户讨论权限的内容来清洗历史。

第三步，以当前native历史作为对照，评估“历史调用／结果以只读数据记录呈现，本轮Loop继续使用native消息”的候选。候选必须完整保留可证明的callId、resultId、工具名、合法参数、观察正文和owner最新状态，复用现有action-history投影；不另建历史存储或语义分类器。它可能更清楚地区分经历与本轮轨迹，也可能损失模型对原生工具历史的理解或增加预算；未经实际同任务对照不替换现有native历史。先完成事实与当前协议修订，再决定此项是否有必要，不把三个改动捆在一起后猜测收益来源。

压缩复用现有protected-turn、确定性retainedActionFacts和普通六字段摘要：goal／constraint／decision是持续用户工作状态，操作completed不能清掉它们或整轮其它意图。历史阶段更新、当前方法／schema阶段和表示变动须纳入已有缓存currentness与最终预算；保存／重开仍走原conversation/state，不恢复旧执行权限。普通回答与摘要共用精简的归属／证据规则，不继续用逐命令权限字段或严格NoOffer补丁替代结构修订。Writing无实际执行的继续／修改提示仍按Owner裁定为非阻塞优化。

#### 最小充分验证

| 风险问题 | 最小证据与通过条件 | 复用／扩展条件 |
| --- | --- | --- |
| 移除软标记是否误改实际权限 | 相关现有来源撤销／工具过滤／确认回归，证明不论模型文字如何，实际未授权动作仍被本地拒绝 | 未改本地安全输入时复用已验结果；修改执行边界才扩展 |
| 当前请求与历史关系是否保真 | 捕获真实final SDK请求，核对原文一次、可信协议与参考资料归属、call/result及owner事实完整、无内部权限证明；native/compat/summary/fallback定向确定性检查 | 共享表示、预算、缓存变动触发相应回归，不以离线正确DTO绕过装配链 |
| Agent是否理解当前任务 | 复用已冻结样例建立当前基线，再按实际受影响改动对照已完成后普通追问、明确新任务交付、unknown合法核实／不盲重放 | 不重试未变输入挑成功；如声称修复skill消费，补真实load_skill链，现有证据不足 |

权限验收看实际边界，口头服从不算PASS；任务验收看事实判断、工具轨迹和实际成品，零调用或被Host拦截都不能单独算理解正确。上述是修订切片的最小受影响证据，不替代原AC-06/C27/C28尚未完成的门槛，也不承诺任意模型零错误。本次没有新增provider、部署或生产改动；当前执行状态与文档验证只记Tracker。

### 摘要输入职责澄清（F-31）

F-29第三个aux实际响应引用了两个保护来源，整个自由草稿因此被拒。输出未超过额度，完整事实仍在保护历史里；这是自由摘要误用只读资料，不是执行记录消失。原5000预算下沿用上一份有效摘要仍需5349且会遗漏最新修正，不能作为恢复方案。冻结报告与当前进度只记[Tracker](../active/context-reliability-and-action-continuity/tracker.md)。

现有设计已经由Host确定生成操作级事实、保护完整原文，再与模型的普通六字段草稿组合；模型不能重述或引用这些保护事实。当前aux却把两种用途的资料放在同一个Human JSON中，增加了混淆的机会。结构澄清沿用这些既有职责，不能保证模型一定遵守。

| 路径 | 取舍与授权边界 |
| --- | --- |
| 普通来源与只读执行事实各用一个Human资料消息 | 仍满足Plan T09/C18“真实summary请求含获准事实”；不提升资料权限，改面限于生成、真实请求重验和观察/测试的资料区读取。选择这条兼容路径继续验证。 |
| aux不再携带执行事实，Host在最终上下文合并 | 职责分离更彻底，但偏离T09/C18及SDD明确的aux输入约定；须Owner另行批准，当前未选，不作为等待条件。 |

兼容路径保持System摘要协议；第一个Human仅含普通`sourceMessages`与纯自由`previousSummary`；第二个Human以固定只读用途承载完整获准`retainedActionFacts`。动态事实不进入System，不伪装成工具返回，也不附加authority/grants。工具结果摘要维持原两消息形式。实际消息的固定角色、用途、来源索引、previousSummary及完整事实均在runtime派发前重新核对，不能用私有binding代替模型真实收到的事实。

Host确定性组合、保护原文、缓存来源/阶段当前性、六字段与非法索引拒收全部沿用。新增消息开销计入完整请求；5000历史预算、Host事实额度扣除、16k/512请求限制不增加。不自动重试模型、不删失败、不改变原17→9→11修正与两次无oracle核对，也不涉及未选择的native历史步骤3。

最小证据是实际SDK跨两个资料区收到完整合法事实；篡改、遗漏或错误索引零派发；分片与最终组合实际计预算；原压力对话至少三次有意义accepted摘要，并由随后的回答正确使用。单靠资料分区、schema合法、fit或aux调用次数不能宣称已解决。

### 事实补齐后的行为限界与优化候选

Image的已准入`submission_unknown`原先仅投影为通用unknown，缺少“外部图像服务是否接受提交”这个维度。F-33改用有限`imageProviderAcceptanceStatus:unknown`；Host曾受理任务、实际尝试POST仍可同时成立，不能以“已提交”三个字机械判provider接受成功。初版`unconfirmed`确认对象不明确，实际报告保留而不宣称模型忽略完整语义。执行与当前验收见[Tracker](../active/context-reliability-and-action-continuity/tracker.md)。

剩余Operations历史效果误推、Ghost确认点击编造与重做邀请的实际初始追问，历史已经是Human只读资料，wire仅System/User/User，没有历史native工具envelope。未选择的步骤3不直接改变这些失败输入，不能作为其有依据的修复或新的必要门槛。执行事实维度、权限和存储目前未发现新的缺失；这不等于已经证明其它所有模型失败都是同一原因。

随后独立核对发现一个具体消费指导缺口：现行SDD已要求解释/核实结束且不条件性邀请重做，但实际System仅限制“解释不是另一次执行请求”“历史不授予重试权限”。不自行执行与不邀请用户重做不同，不能声称该禁止邀请条款已经送达却被忽略。按已有合同补齐answer System指导属于获准的兼容修复，不需新增自检方案获选；它不新增Host语义门、模型调用或权限。实际验证不证明其它问题同源。Owner后续将纯文字继续／重做提示的非阻塞裁定扩展至四域，允许适度验证优化；当前验收按以下具体影响校准，不继续把未选择额外候选当成权限阻塞。

恢复指导后的实际原Image unknown两臂均收到完整条款且没有再执行；普通组的“再决定下一步”没有指定重做，压缩组仍明确邀请重新生成，并无依据补成未收到完成/失败/状态回调。两答核心图片结果仍为unknown，没有被说成确定生成成功；回调原因是没有来源的过程细节。Ghost已核实published的结论正确，猜测“用户点击过确认”同样缺乏过程证据，但未据此恢复授权或触发新发布。这两类过程细节按非阻塞说明质量优化保留，不能混称已证核心执行错误。原四域明确新任务两臂共8例仍实际交付/准备：图片新提交、Writing新作品、Ghost新source草稿和Operations待确认提案。Writing的作品前说明是有效的分离解释，不因内部explanation字段为空判交付缺失。原严格报告不改写；本次分类核对不新增模型请求。

Operations须另判：历史effectOutcome为unknown，当前read_note确实没有读到目标行，但candidate最后说“该操作既未完成……写入未发生”，reference说“文件内容证实追加未写入”。当前缺行本身不支持对历史是否写入作确定否定；这里不是已证明“以前确实写过”却说反，而是把未知作了过强确定结论。零重放不能替代未知状态正确承接，现有Owner裁定也未豁免这一结果边界。无需构造删除／覆盖假设或新增强制核实流程；只需分别表达当前观察和历史未知。现有时间／范围消费规则确已送达，尚未发现新的context事实丢失，也未证明内部缺少自检。具体执行状态只记Tracker。

随后只读复核了新Writing的旧parent选择：Host只提供合法历史候选，没有标记当前用户selected；实际调用由模型自行选择，已有new-topic null指导，仍真实交付新作品。候选用途说明可以讨论，但未证明存在必修关联缺口，也不能只因parent存在就判新任务失败。Image未知场景同样已有通用证据不足不猜规则；当前资料没有回调原因，剩余断言不能改称事实传输遗漏。上述审查不支持无依据追加规则或同输入重跑。

可讨论的新增候选是Agent自身的任务与证据核对：动作前依据完整当前请求和仍有效的未完成目标，判断这轮需要解释、核实、续接还是新的交付；历史command/skill只提供经历和方法，不能自行新增本轮目标。回答前由Agent核对执行结论是否有owner事实或当前观察支持，unknown保留未知，核实发布不补成用户点击，当前未见内容不否定历史效果；完成当前解释/核实后结束，明确新任务按原协议交付。检查在同一次模型生成中进行，不要求公开思维过程，不新增分类工具、强制自检JSON、第二次模型、自动重试或Host语义门。

这仍是软约束，不能承诺模型一定服从，也不能替代Host本地的真实权限和能力边界。独立复核确认现有协议已包含本轮目标判断和上述事实规则；额外候选只是改变处理顺序的假说，不能宣称已证明模型内部缺少自检。上述已有NoOffer合同指导恢复与本候选分开。Owner现已允许验证优化，但要求先讲清具体错误并避免过严验证和实现；本段保持未实现，未选择它不再是授权阻塞。若确有必要做最小实验，事实、schema、当前工具、权限、原任务和预算保持不变，按改动影响选择证据；不为纯提示或过程细节启动额外保障，不以零调用或拒绝执行代替未知状态正确承接。

#### 可审查的最小候选切片（未实现）

仅拟在answer System的“读完整当前user”规则后增加以下顺序指导，其它既有事实规则、当前方法阶段和NoOffer指导不变。它不新增authority字段、Host判定器、工具、自检输出格式、第二次模型或aux协议；不从历史command/skill生成当前目标。

```text
Work in this order within this response: understand the complete current request and any earlier goals that remain valid after current corrections or cancellations; assess the admitted evidence for each claimed outcome; take the actions needed for that current goal; then check the response or artifact against that goal and its delivery protocol using the evidence already available. A missing or unknown outcome is a verification limit, not an additional task; it does not cancel an explicit current new task or authorized continuation.
```

这里的assess/check是在同一次生成中核对已有材料，不要求额外读取或核实调用。独立只读审查将原稿read改为assess，避免暗示每轮必须调用读取工具；明确当前修正/取消及新任务/合法续接优先，避免旧目标复活或unknown取消新交付。该文本只是可测试的候选，不证明模型实际上执行了内部自检，也不证明效果优于现有指导。

若后续实施，当前System constructor及实际预算计量必须覆盖增量，预算配置与原任务/fixture不改；先记录它针对的具体剩余结果及最小证据，再完成受影响focused/static与所需部署门。原报告保留，同一输入不重复采样挑成功；是否扩到其它行为门由具体影响或新失败决定，不仅因“自检”名称自动重跑全矩阵、三次摘要或未变native生命周期。已有存储/owner、aux与UI接线证据按输入影响复用。未实现的假说不当作修复成果，没有新证据时不堆叠同类候选。

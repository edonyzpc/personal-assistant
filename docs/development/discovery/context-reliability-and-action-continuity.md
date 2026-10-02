# Agent Context Reliability And Action Continuity

Document status: Current
Delivery status: Needs Decision
Updated: 2026-10-02
Work item: B-157
Authority: 当前 context 管理的源码审查、脱敏故障证据与候选优化方案；不是已批准实现或已交付行为。

## Problem And User Outcome

用户先要求生成图片，再询问发布失败的原因，第三轮只追问错误如何解决，却再次发起了图片生成。实际请求中，第一轮用户要求仍在，第一轮调用、回执与完成回答已经缺失。这使 Agent 缺少旧任务已提交的依据，构成把旧要求重新执行的直接诱因；具体因果归因属于推断。

问题范围包括 `create_image`、`@Writing`、`@blog2ghost` 和 Operations：Agent 应能区分当前要求、历史要求、已经发生的动作、等待中的动作与未知结果。解释错误不能因为上下文丢失而悄悄重做旧任务；用户明确提出新任务或续接时仍应正常执行。

本轮授权是审查与建立方案。未修改运行时代码、测试、配置或真实 vault；未发起新的生成、保存或发布。真实故障的私有笔记内容、路径、provider 原始日志与推理正文不进入本文或后续外部 worker。

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

详细任务依赖、候选 AC、逐项测试设计、准确命令/分组、模型与 app 验收见 [B-157 开发与测试计划](./context-reliability-and-action-continuity/plan.md)。该计划由 Owner 于 2026-10-02 要求制定；运行时代码实施仍未授权。

以下是进入实施后的顺序与退出条件，不表示已开始开发。复杂状态/来源设计需要一个轻量 Active Package 统一维护 Tracker；不再为每个命令建一份计划。

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

## Decision Needed

推荐按统一投影方案进入 S1–S4，先修复“已发生事实无法进入模型”的链路，再补当前状态与压缩承接。顺序是技术拆分，不把只修图片的一小步当成整项完成。

待 Owner 决定的是是否进入实施。本方案不要求新增产品模式、扩大来源或动作权限；恢复既有契约无需仅因技术拆分制造新 Product Decision。若实施时发现必须改变这些边界、引入新持久层或接受未决风险，先列出具体偏离再由 Owner 决定。

## Exit

- 进入实施：沿用现有产品契约，建立 B-157 的最小 Feature Home/Tracker；因跨模块、隐私与状态生命周期需要补必要的技术设计。只有真实验收后才更新 delivered 声明。
- 延后：保留 Backlog 与本 Brief，重新启动条件为 Owner 授权实施；不修改当前产品规格的已交付状态。
- 收尾：稳定结果吸收进当前 context/Agent 契约与测试，保留必要的脱敏故障/验证证据；不永久保存完整过程或私有日志。

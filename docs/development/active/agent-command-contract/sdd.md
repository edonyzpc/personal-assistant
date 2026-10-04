# PA Agent Command Contract Software Design Document

Document status: Approved
Updated: 2026-10-04
Work item: B-158
Authority: 公共框架接入/桥接与后续领域迁移的 source-verified design；架构定义引用唯一来源。
Product spec: [Product Spec](../../../product/specs/pa-agent-command-contract-product-spec.md)
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)

本稿按实际公共seam及领域ports核实实施边界。Approved表示下述设计可实施；
运行验收以Tracker为准。P2已验收，P3依下列领域设计顺序推进。

## Architecture And Ownership

遵守 [Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)。
记录本任务的条件/决策归属和事实依据，不复制全套定义：

| Item | Owner | Input / factual basis | Output |
| --- | --- | --- | --- |
| command 的目标/必要阶段/交付语义 | command契约 | 已批准领域Spec/Decision | Agent工作指引与领域条件 |
| 用户语义、目标、参数与恢复计划 | 主Agent | 原始请求及真实上下文 | 结构化调用或必要澄清 |
| 请求绑定/能力导出/实际执行校验 | Host | invocation身份、设置、scope/lineage、schema、cancel | 获准domain调用或确定错误 |
| 业务操作/候选/确认/实际效果 | 领域owner | 已准入参数、真实API/文件/状态 | operation/产物事实 |
| 执行结果桥接及上下文 | Host与领域事实投影 | 可信执行结果、来源与当前domain状态 | 无扩权的观察与恢复动作 |

## Current Source Baseline

| Verified source | Existing seam / reuse |
| --- | --- |
| `src/ai-services/pa-agent-runtime.ts` `PaAgentRunOptions`、`streamTurn` | userText原文、prompt请求与独立commandGuidance；runSourceSelection/inputLineage/isCurrent/conversationId/signal；真实domain binding注册和finally清理 |
| `src/ai-services/capability-types.ts` `AgentCapability`；`capability-registry.ts` `prepareAndValidate`；`policy-engine.ts` | schema/权限/来源/费用/平台/并发；导出和执行分别准入，不替换registry |
| `src/ai-services/pa-agent-types.ts` `PaAgentToolExecutionResult` | 已有executionState与recovery.allowedActions/operationId/parts；复用，不新增第二状态模型 |
| `src/ai-services/pa-agent-tool-dispatcher.ts` | unknown/partial防重；成功/unknown/partial结果登记与明确失败释放 |
| `src/ai-services/capability-adapter.ts`、`pa-agent-host-tools.ts`、`chat-types.ts` | domain ChatToolResult→capability→PA execution result bridge，P2核实元数据保真 |
| `src/ai-services/pa-agent-result-facts.ts`、Context/历史链 | 领域安全事实与正文来源独立准入；沿用DEC-048持久与投影，不建command ledger |
| `chat-tool-types.ts`、`chat-tool-factories.ts`、`chat-tool-guards.ts`；retrieval coordinator与Memory frozen plan | search_memory结构化输入、每调用A1/A2恢复、工具辅助模型改写；移除Host从整段请求推断不可覆盖时间意图 |

## Design And Data Flow

### Declaration And Invocation

`pa-agent-command.ts`承载最小共用类型和注册作用域，沿用原CapabilityRegistry/PolicyEngine/loop：

- `PaAgentCommandDefinition`：id、Agent工作指引、声明的capability names。现有Spec/Decision仍负责完整领域合同；不新增manifest或command registry。
- `PaAgentCommandInvocation`：definition、本次真实conversationId/stableMessageId、activation（typed token/composer action）。不重复已有`userText`、`inputLineage`、`isCurrent`或operationId，不把正文解析成authority。
- Chat在真实消息身份分配后建立invocation，经`StreamLLMOptions`透传至`PaAgentRunOptions`。现有入口解析、重试与typed领域ports保留；无invocation的standalone调用保持兼容。
- 原始用户文字继续在`userText`；固定工作指引走独立app-owned `commandGuidance`与definition，不由prompt差异猜测。definition指导有实际Runtime消费者，能力需要按本次实际bound schemas投影；注册与执行仍以真实binding、PolicyEngine和source guard准入。
- SourceRun与Loop共用同一实际用户请求身份；prompt可含入口处理后的文本，不能导致精确source身份比较两端不同。invocation核对真实conversation/message，且不复制已有来源状态。
- 公共注册scope只接收已创建的capability实例、调用原registry并清理本scope确实注册的实例；重复注册或setup异常不能删除其他scope能力。沿用runtime外层try/finally与现有取消/current校验。
- P2将Ghost/Image现有注册/退役接到scope。Writing invocation可无领域tool；`present_writing`继续是原生输出协议，`get_writing_context`、来源处理和native-writing loop保留。

### Effect And Recovery Bridge

`ChatToolResult`与`AgentCapabilityResult`引用已有`PaAgentToolExecutionResult`执行字段，
不另建状态模型。adapter、反向conversion与最终Host executor完整传递owner给出的
executionState/recovery及失败中的真实resultFact；schema/准入前拒绝可明确not_started。
模型观察仅投影有界、安全的执行状态和恢复选项，不发送Host-only binding/来源/凭据，
恢复元数据与已有action facts/history仍各负其责。
执行事实的解释沿用统一架构的持久Agent系统契约，同时覆盖当前结果和历史
owner状态；final-answer撤去工具不能撤去恢复边界。工具planner guidance保留
领域参数说明，不承担公共恢复契约；实际Runtime验证含无command invocation入口。
现有result-facts模块保有唯一解释来源：历史状态规则继续由Agent和摘要器共用，
当前效果恢复规则仅供live Agent规划/收尾，不扩大摘要器的职责或既有预算输入。
既有canonical action header携带有界的recovery code和闭合allowedActions，
不提升工具正文、私有metadata或完整parts。Image unknown沿真实Host槽位ID
返回既有unknown事实；实际提交与事实使用同一ID算法。原槽未决阻断尚未
执行的新槽时，新槽为not_started/needs_user；原槽未知事实及锁仍保留。

实际执行开始后，未拿到owner效果事实的副作用异常保守报告acceptance_unknown；
用已注册capability permission/kind判定效果风险，不根据错误文字或failureReason断言
未执行。只读异常沿用可恢复失败；明确未执行的参数错误允许Agent修正。
原dispatcher按canonical tool+args记录成功/unknown/partial，不新增operation ledger；
跨改参的业务幂等、查询与剩余部分仍由domain owner在P3核实。

Tool attempt的结果和持久business operation为独立轴。framework只传递可信owner报告，
不从错误字符串推断not_started。模型可见观察需有界且适合纠错，Host-only身份、
来源、确认与凭据不得通过新接口暴露。域内必要步骤仍由domain实现。

标准只读失败沿用既有闭合观察协议和来源准入，不为没有owner字段的结果合成
execution/recovery；ordinary recoverable_error仍允许再次尝试。显式owner事实继续
桥接，副作用unknown/partial继续使用有界投影，不能放宽来源校验来接收新形状。

### Per-Invocation Retrieval Semantics

时间过滤语义由主Agent提交的`search_memory.temporal`决定，复用`QueryTemporalIntent`。
省略表示沿用工具辅助模型对本次query的领域改写；`none`表示明确全历史，不能被
辅助模型或词面规则覆盖。Host仅校验结构/日期范围并冻结本次检索计划；不从整段
prompt捕获run级时间硬门。短query不再用自然语言关键词推断过滤。

Chat recovery从每次已验证输入取得时间计划，A2复用A1 frozen plan/embedding，不重新
解析或放宽约束。Pagelet共享工具必须透传完整结构化输入到其既有recovery及标准
Memory invocation；无temporal的旧调用仍沿用领域模型改写。预算、一次恢复token、
source/currentness和Pagelet产物门均保留，不新增状态或编排器。

## Lifecycle, Data And Compatibility

复用原run/turn取消、lease、来源guard、注册/退役及预算；不要保持跨等待的无用资源。
不改持久化schema、secret ID、provider、预算、现有确认和跨设备策略。
当前已受理/unknown操作回退仍按原owner记录核实；代码回退不重放动作。

## P3 Domain Migration Design

### Ghost Preparation

主Agent解释当前笔记、描述性目标、排除项及prepare/restore意图；Host保留真实
`@blog2ghost`入口、当前文件绑定、合法vault路径、Markdown存在性、名称唯一性、
scope/current/source及既有权限。`entry.ts`不再要求模型提交的locator逐字出现于
用户原文，也不以“发布当前笔记”句式决定能否使用捕获的文件。缺locator表示
提交时捕获的当前文件；有locator时按结构化参数查验，不能绕过文件准入。

`host-integration.ts`是进入`controller.prepare`之前的确定准入owner。
仅此边界确认的missing/ambiguous等目标错误可报告`not_started/correct_input`；
权限/来源/过期拒绝报告`needs_user/none`，不能改参逃逸权限。复用P2的执行事实
类型，采用最小typed error或receipt承载owner事实，不按异常文案判断执行阶段。

`controller.prepare`内createScope已可能经`ensureNoteUid/processFrontMatter`修改
本地笔记；service随后记录operation、上传、写远端。没有HTTP或operationId均
不等于未执行。进入controller后的未知异常保留reservation，报告核实限制；
accepted/prepared/attention/unknown复用同一业务操作，不改参重放。factory仅在
可信not_started且允许纠正时释放失败promise。原预览、卡片、确认、恢复和首次
发布条件保持。有限machine receipt/error协议与Runtime闭合predicate同步更新，
不放宽任意正文来源准入。

command/tool/skill指导说明目标、必要条件与owner结果，不强制固定调用次数或
一遇missing就要求用户提供精确路径。Agent可在已授权范围内定位、修正、必要
时澄清；讨论或诊断可正常结束且无领域操作。

### Writing Context

真实UI选择的父版本是候选事实，不是Host从文字推断的唯一父稿。移除
`isNewWritingTopicPrompt/isWritingContinuationPrompt`对selected parent及隐式
retry材料的规划；保留明确UI选择、Retry绑定、删除、会话切换及来源失效行为。
主Agent通过既有`get_writing_context`选择合法parentHandle或null、scene及
currentInstructionConflicts，可改选另一个候选并重新准备。最终产物沿用实际
context handle、版本/hash/source lineage，旧context失效不能靠改参绕过。

生产native Writing/present_writing纯输出及Save确认保持。legacy兼容路径使用
已有结构化scene；无可信scene保持unknown，不用prompt正则或父scene充当
fallback planner。退役文字型style准备桥，保留旧历史/JSON读取；不建立第二Writing编排器。command指导
明确Host约束授权材料范围，Agent选择材料；现有style/来源领域算法保持。

### Image Acceptance And Semantic Input

普通Chat自然语言图片入口仍符合B-133；typed token和通用CreateImage菜单只是
入口。Agent选择generate/reference/edit及可用refs，不把Host默认generate或
附件默认reference当成用户明确选择。实际Edit/Regenerate动作的operation、
parent/ref/lineage仍是Host事实约束；沿用ComposerImageIntent承载实际动作来源。

Chat和factory的失败promise、图片数量reservation只能在可信owner报告受理前
not_started时释放；已经消耗的描述模型预算不退款。service在持久
`putImageGenerationTask`后本地受理，之后emit/launch/后台POST异常或unknown均
复用任务，不能重发。未知且无taskId时说明无法核实，不能虚构卡片；受理前
明确失败不能被文案误报成已经有卡片。保留B-152独立描述准备、实际submittedPrompt、
promptOrigin/inputLineage与既有来源、费用、连接、首用确认。

数量设计沿用[B-133/REQ-07、REQ-13](../../../product/specs/pa-chat-image-generation-product-spec.md)：
默认一张，明确请求可多张，禁止自动付费择优/重抽，明确请求不重复确认。
Agent解释数量、不同描述及冲突，既有`create_image`以可选`totalCount`和
`subrequestIndex/count`提交语义计划，不接受模型的confirmed/权限字段。Host以
原接口总上限4及实际绑定配置/数量控件约束总量；结构化计划不是新增权限。
source已有options保持约束，不把程序默认值宣称为本次用户明确选择。

首次准入冻结本请求总量，每槽沿用原operationId并以算术检查累计reservation、
实际receipt及连接/来源。无已受理/unknown且可信not_started时可修正计划；
受理后不扩大计划、不自动补批重抽。讨论没有执行计划时不凭数量规则判失败。
已进入的计划覆盖以真实受理量核实，不用正文正则推完成。service删除原文count
匹配，复用Host-only `countExplicitlyAuthorized`并仅在实际政策准入后设置。
本设计承认Agent可误解数量，Host证明的是准入界限与效果事实，不伪称能证明语义。

Retry每次重建Runtime/factory，不能只在新run内防重。沿原
`imageOperationByTurn`让新旧turn共享冻结计划、原submission receipt及各槽预约，
在新的描述准备/submit前复用pending/accepted/unknown。无taskId且查不到task不
证明未受理；只有可信not_started按精确entry释放对应槽。实际持久task可查询
复用，取消不擦除受理风险。不新增ledger或自动跨重载执行。

## Test Matrix

| Requirement / AC | Minimum evidence | Pass condition / expansion trigger |
| --- | --- | --- |
| B-158/REQ-01 / B-158/AC-01 | 架构与流程独立review | 单一职责来源、交互与身份明确；发现矛盾才修订 |
| B-158/REQ-02 / B-158/AC-02 | 任务级owner表、权限/schema及真实绑定probe | 语义归Agent，Host事实条件不扩权；准入分支改变补focused |
| B-158/REQ-03 / B-158/AC-03 | 共享bridge/dispatcher与domain恢复focused | not_started可修正、accepted复用、unknown/partial不重放；不明事实不伪造 |
| B-158/REQ-04 / B-158/AC-04 | docs:check、相关docs suites、workflow review | 入口都引用架构；无新增mandatory文件/术语checker |
| B-158/REQ-05 / B-158/AC-05 | 合成command/capability实际链＋共享broad/app gate | 注册身份隔离、撤销、桥接保真、取消清理；框架阶段旧command兼容 |
| B-158/REQ-02 / B-158/AC-02; B-158/REQ-05 / B-158/AC-05 | 实际Memory调用＋A1/A2/共享Pagelet回归 | 否定时间词不能生成Host硬门；显式none/range与省略语义保真；每调用纠正不影响同episode冻结 |
| B-158/REQ-06 / B-158/AC-06 | 后续域内focused、少量真实模型、受影响app互动 | 各域目标/恢复/确认符合contract；不拿fixture证明模型语义 |
| B-158/REQ-02 / B-158/AC-02; B-158/REQ-03 / B-158/AC-03; B-158/REQ-06 / B-158/AC-06 | Ghost entry/host/factory真实桥接：missing→修正→prepare；entered异常/unknown防重 | pre-controller确定未执行可修正；进入controller不能因无HTTP/ID而重放；旧确认/服务回归复用 |
| B-158/REQ-02 / B-158/AC-02; B-158/REQ-06 / B-158/AC-06 | Writing Chat所选编辑稿保留；实际context重选A→B/失效handle；历史兼容 | 用户否定新话题不清UI候选；Agent可选择B且产物/lineage是B；Save仍须确认 |
| B-158/REQ-03 / B-158/AC-03; B-158/REQ-06 / B-158/AC-06 | Image factory/Chat/service实际受理前失败释放＋受理/unknown复用 | 泛化入口可选operation；实际Edit约束保持；不退已耗描述预算、不二次POST |
| B-158/REQ-06 / B-158/AC-06 | 既有test provider少量公开合成任务＋真实受影响UI | 实际主模型解释否定/目标和修正；阻断真实Ghost/Wan副作用，证据仅限语义与接线，不称外部服务E2E |

## Open Design Findings And Approval

- P2新增最小invocation/scope类型有Chat→Service→Runtime生产消费者；不增加第二编排器。
- 三位只读reviewer已核实结果字段缺失、真实桥接测试缺口、精确实例退役与Writing输出例外。
- P3按上述实际ports迁移；Image数量依据既有B-133批准契约保持自然语言入口/默认/总界限，不新增确认政策。未确定的实质权限变化不实施。
- Owner已确认架构方向及顺序；GPT据实际source完成P2设计，运行验收仍独立记录。

# B-157 执行事实连续性 SDD

Document status: Approved
Updated: 2026-10-03
Work item: B-157
Authority: Owner 授权范围内 source-verified 技术设计；不改变来源或动作权限。
Product spec: [执行事实连续性](../../../product/specs/pa-action-continuity-product-spec.md)
Plan: [开发测试计划](../../discovery/context-reliability-and-action-continuity/plan.md)
Tracker: [Development Tracker](./tracker.md)

## Source-Verified Interfaces

- `PaAgentActionState` 保存 owner、operationId、有限 phase、revision、origin、inputLineage 和 owner receipt；原 `resultFact` 保持 Host-only。
- `projectPaAgentActionHistory` 保持 nearest-assistant-group calls/results；native/compat、摘要消费同一获准结果表示。安全输出包括有限领域状态与 opaque identity，不输出 receipt 原对象或内部 revision；Host revision 仍用于缓存身份及单调合并。Ghost 的 completed 还必须从 terminal/cleanup_pending 且 verified 的真实回执投影 `ghostPublicationStatus: published`，明确区分准备完成和核实发布；prepared/unknown/未核实不获得该字段。Image 仅在完成回执准入后投影 `imageOutputStatus: saved`，证明当时保存而不证明当前文件仍存在；合法 Image unknown 的 image-task 回执细分 submission_unknown 另投影可选 `imageProviderAcceptanceStatus: unknown`，明确外部图像服务是否接受提交未知。Host 曾受理本地任务可同时为真；该字段不描述生成完成确认，也不等于未提交、无副作用或允许重试。旧通用 unknown、其他 owner/阶段不补造该字段，完整事实与确定性摘要摘录均由同一安全投影派生，不增加持久化字段或外发原因。Writing 单次/多次保存保留可证明的 `noteState` 子步骤；`created` 与整体 `partial` 可以同时成立。unknown/unavailable/lost 显式保留结果未知及可能已发生效果，不推导为无效果或新执行权限。
- `TaskSourceRun` 正文、canonical 与有限状态分别准入；有限状态总用 strict lineage 检查，不能借 legacy 正文 bypass 或临时缺 authority 恢复权限。
- `ChatMessage/PersistedChatMessage` optional actionStates/actionStateBinding；serialize/clone/hydrate 只允许绑定到原 conversation/turn/run。原 canonical.messages 仍不落盘，重开为空。
- `ChatHistoryStore.updateActionStates(binding, transform)` 在 Memory/既有 IndexedDB turns store 原子补写既有 turn；不新建 store、不创建缺失 turn。相同 revision 冲突拒绝，旧 revision 不覆盖，合并超限失败并保留旧数据。
- `ChatHistoryManager.updateActionStates(conversationId,runId,turnId,transform)` 重新读取原 binding、校验外层 conversation/index 并观察 source lifetime。`ConversationPersistence` 补写排在既有 persistChain，避免普通 finalize 使真实完成事件被吞掉。
- `ChatHistoryManager.reviseTurn` / `ChatHistoryStore.reviseTurn` 是既有 turn 的事务内条件更新：核对原请求身份和 binding，保留当前 conversation 元数据，只推进 `updatedAt`。缺失或替换返回 null，不使用普通 finalize 的 upsert。`ConversationPersistence` 以 weak entry 标记记录待补写；四域相等状态也重试失败补写，成功或确认原记录缺失后清除。不可用或写失败保持待补写，不重放领域命令。
- Image/Writing 用真实 task/version/save receipt；Ghost 用本地 operation store 的当前 site 唯一记录，只读恢复不访问 credential/远端；Operations 用 owner 生命周期结果及逐 action/receipt Undo。

## Design And Ownership

沿现有 fact/canonical/conversation 边界增加 versioned 最小状态 DTO。Writing 作品没有工具调用时只绑定真实 artifact 身份，不编造 callId；其余 owner 保留原真实调用关联。无正文/参数/URL/原始 error/Undo 内容。安全映射由真实 owner 回执产生，解析检查 owner、phase、revision 和封闭字段；格式合法不能替代来源证明。

正文与状态分别准入；来源 unknown 不能改成 complete。只有独立 owner 证明的有限状态允许与未知正文分开；仍依赖排除材料的状态必须拒绝。获准投影保留原 call/result 身份；不保留未知参数或 assistant 文字，不以整轮 union 丢弃合法事实，也不把已获准状态当成新权限。

在现有 PersistedChatMessage/Turn 增加 optional/versioned 状态，store clone/parser 白名单，manager 保存/重开仅恢复允许状态。领域更新通过已有 conversation 顺序写入口与内存消息关联合并。已完成事件胜过旧 placeholder/finalize 快照，部分 Undo 按 receipt，不覆盖整个 batch。落盘失败只影响耐久性，当前可信内存事实继续可用；reload 缺据为 unknown/失联，不重放。

请求准备读取相关现有 image task/versions、Writing receipts、Ghost operation store；Operations 真实生命周期更新有限状态。历史事件和最新快照分开。读取无提交、保存、发布或远端轮询。

Operations的当前session未找到intent不等于原owner已消失。沿既有OperationsService.sessions只读查找同intentId与原run归属的真实owner结果；confirm/cancel/undo仍由原session局部控制，不把只读跨实例查询变成操作权限。真正owner销毁/重开无据时保守lost继续有效。同一原操作的可信执行回执可纠正失联观察，以存储中最新状态的revision推进；cancelled/expired不被迟到回执复活。原conversation/run/turn绑定、删除不重建及同revision冲突检查不放宽，不新增ledger或存储层。

一般工具失败在已有工具/adapter边界保留有限结构化原因，模型据真实反馈纠正输入和选择恢复方向。等价无进展计数同时考虑真实原因及稳定恢复范围，不能把不同只读路径/覆盖的有效尝试混为同因，也不能用随机参数变化冒充任务进展。实际请求上限、取消、权限撤销以及unknown/partial副作用防重放仍独立生效；不增加固定读取顺序、自检模型或自然语言分类。

Ghost准备返回`needs_attention`时，区分真实operation已经建立与没有operation的配置/准入失败。仅有匹配Host typed proof、真实call/result、完整lineage和封闭观察的operation可建立`unknown`/revision-0种子，不声称草稿、预览或发布已成功；后续由原session的只读receipt推进并通过既有原轮更新入口持久化。无ID或不匹配proof不建种子，旧unavailable正文即使带ID也只读保留，不能据此补造owner。预览失败不能让已经建立的operation从后续状态承接链中消失。

压缩/摘要/native/compat/fallback 使用同一获准表示。来源绑定不证明自由摘要完整保留了事实；不猜测关键编号、不将成功或终结等同于可删除正文。完整事实 fit 则保留，否则先用现有可逆 adjacent-repeats 表示缩减重复正文，未有可靠承接的必要正文继续保留；最终放不下则 overflow。最新修正与未决状态确定性保留。摘要实际 payload 含 action/result 与安全阶段/身份；正文保持原 source 分片/Unicode/请求预算。缓存 binding 包含阶段/身份/来源变化，保持六字段和无工具权限。

最终装配区分历史与当前run，不依赖SDK角色猜测时间归属。native历史user/assistant正文采用可恢复JSON的`historical_message`，原role不变；旧canonical调用及配对结果标为historical，本run调用与结果标为current_run。compat/压缩降级的历史仍由现有`chat_history`封闭表示，本run工具组单列scope；无第二份观察。有限owner状态仅标注其动作属于历史，不将最新事实降为旧事实。同步与异步builder使用同一格式，真实最终SDK消息计入既有预算；这些临时标签不持久化、不输出Host binding或provenance。

缺常规toolResult只表示工具观察缺失，共享投影的`result_unknown`以`unknownScope: tool_observation`限定含义；不能据此否定独立获准owner事实。正常纯输出Writing的ready回执仍只证明作品已建立，不证明保存。没有独立事实时，执行/效果继续未知并需核实；歧义配对、真实domain unknown及来源准入不变。raw/摘要表示中的空results同样不产生执行结论，不按工具名称补造成功。

2026-10-03 Owner授权先实施Discovery修订步骤1/2。Projector和Manager分别提供`currentProtocol`、`currentContext`和`currentInput`：代码生成的Writing协议与固定Operations staged acknowledgement进入独立System消息；来源目录、选中作品、个人背景及Loop反馈仍以Human资料送达；完整用户原文另用Human消息恰好送达一次。不得将混有外部正文的`runtimeInstruction`整体提升为System，不根据自由文本判断权限或当前意图。Operations固定协议在追加来源材料前按原常量精确提取。native/compat/压缩降级、同步/异步和图片消息共用最终装配，图片只跟随当前用户，最终SDK envelope及无回调预算均计入协议。

真实typed native Writing request仍使用同一任务分支协议：普通讨论、澄清与对既有工作的解释可普通回答，当前请求无法完成则用现有report_task_incomplete，成品通过既有pure output交付，分支由Agent理解；选择Writing不强制每轮产物。未准备时仅实际schema绑定get_writing_context才提示准备，已准备时使用当前handle；finalization无handle时不提示不可用准备。Operations staged acknowledgement沿原工具限制单独回应，不追加Writing方法或旧历史。legacy Writing JSON保留既有输出协议。保留source currentness、输出解码、Host完成裁定和全部schema；不增加零artifact失败门或自动retry。历史command/skill执行只作过去事件或方法参考，不自动转为当前待办，仍有效的目标与约束继续保留。

回答和摘要系统提示共用 `PA_AGENT_ACTION_STATE_CONTEXT_RULES`：owner有证据的最新状态优先旧assistant自述。动作事实和相关历史、摘要、可逆结果、选中作品包装移除冗余`grantsWriteAuthority`/`grants_*`，保留`contextOnly`、时间scope、阶段、身份和完整正文。它们记录执行事实，不记录过去授权；Host权限仍在本地校验。独立Memory/Pagelet治理包装保持原契约，本次不扩大到该领域。unknown/unavailable/lost与缺失卡片不证明动作未发生；只使用当前已绑定获准的只读能力核实原ID，不能核实保持未知。明确新任务和合法续接仍按既有授权正常处理；内部revision不外发，有限回执不证明用户点击了确认。answer明确完整读取当前user，背景不能取消末尾独立的新请求。该规则只指导context消费，不参与Host意图分类或放宽来源准入。native历史工具调用与结果的角色及关联暂不改变；步骤3的数据表示仅为后续对照候选，须依据前两步结果讨论。四域纯继续／重做询问没有实际执行时，按Product Spec的Owner澄清列为非阻塞体验优化；核心执行结论和当前明确交付仍独立验收。

解释/核实中，缺少卡片、像素或当前可读输出不能成为自动重做或替换的理由；不邀请重复仍是消费指导与体验目标，纯文字提示不单独阻塞交付。owner 已完成回执证明记录中的效果，不能因缺少用户描述的 UI 手势降级为未执行；同时不得编造确认点击。未据过程猜测改变结果、授权或动作时，按说明精度优化记录，不以它单独要求新保障或全矩阵重验。明确的新任务仍须遵守当前工具的作品交付协议，普通正文不替代要求的 Writing artifact。Operations 对已明确的内联预览请求可准备非写入 staged proposal，实际 apply 仍由 Host 卡片确认。

当前读取或搜索仅证明该观察时刻、获准覆盖范围内的结果；当前未见内容不证明历史unknown操作从未生效。Writing `noteState:created` 是过去检查点：完整Writing version正文已写入笔记并读回核验。整体`partial`不证明附件、索引等全部保存步骤完成，也不证明当前文件仍存在或内容未变；未投影的失败原因、UI手势与没有`noteState`的子步骤不得推断。上述解释复用回答与摘要的共享状态规则，不改变安全DTO、Host动作判断或执行权限。

摘要正文中自述或嵌入的 JSON 不获得 owner 身份；已准入的执行事实另投影为封闭 `retainedActionFacts`，分片保持原始全局 source index。所有承接材料计入现有请求预算；派发前逐来源核对真实准入消息、完整正文和独立锚点一致性，篡改时不调用摘要或回答模型。公开输出保持六字段、长度和来源限制；初始普通草稿的空值与后续空更新按下述组合合同分别处理。

长度限制作用于最终规范化的封闭 JSON，不因合法格式空白而区别对待 object、string 或 text-block 表示；原始文本在 trim、合并或 JSON.parse 前仍按现有 16k 边界限制。不能通过格式化、fence、schema 外字段或非法索引绕过最终预算。提案/预览正文只证明拟写内容，不是当前笔记读取证据；unknown/lost 不确认该提案效果，也不保留旧 pending 卡片的可确认性。解释/核实以现有结果和获准检查结束，即使缺少输出，也不条件性邀请重复生成、重写、保存、发布或应用；当前明确的新任务与合法续接继续遵守原交付协议。

摘要额度同时受原比例上限和最终历史剩余额度约束。保护历史与候选最近完整turn按原索引去重、排序，并使用最终投影相同的raw/可逆序列化计量；摘要wrapper和分隔符也计入额度。不能以单独suffix能fit推断保护集合加suffix能fit，不能把完整可逆保留的最新修正再次算作已摘要前缀。必要材料本身不fit时不派发aux，最终projector仍独立fail closed。Operations的完整completed/all-applied真实回执投影`operationsEffectStatus: applied`，表示Host已执行笔记操作，不保证每次操作都改变字节，也不授予重复操作权限。

2026-10-03 Owner在补充review与F38实验后授权修复保护范围、Operations归属及异因停止问题。自由语义摘要不能重新判定保护动作的执行阶段；保护对象改为必要call/result关联、真实owner有限状态及未决副作用，不再永久保护整轮普通user/assistant正文。实际executor的既有getRetrySafety在执行边界产生Host-only有限read_only/side_effect标记，不消费provider自报值或自然语言意图；仅完整配对且已完成的已证只读观察允许正文进入来源化摘要。未知分类、缺配对及副作用证据保持保守保护。受保护轮的普通文字可进入freeSources，但只有合法摘要已经承接覆盖范围后，最终历史才采用最小证据视图；最新完整轮与修正仍保留。没有合法摘要不静默丢旧正文，不将整轮或多意图user标为完成。

history aux继续使用System协议、Human普通来源/纯自由previousSummary、独立Human只读事实三个消息。不可改写的动作事实由retainedActionFacts提供，普通正文及获准只读观察经原全局来源索引摘要承接；两者使用同一分离规则和source binding重验。runtime校验实际资料区的角色、封闭键、用途、previousSummary、合法来源片段与完整重算事实；缺失事实区、重复消息、遗漏必要关联或锚点篡改不派发。不提升摘要为owner证明或权限，不增加持久化。普通分片完整批次与滚动覆盖继续由既有producer/组合机制承担；工具结果摘要仍使用原两消息。

无独立owner更新的合法canonical结果沿现有action-history/result投影保留原callId、resultId、toolName及有限阶段/身份/outcome/isError。已证完成的只读正文可经现有16k分片进入自由摘要，不再重复作为每片不可缩减的完整reference；必要副作用结果及未决事实继续由readonly锚点保留。正文仍是不可信历史观察，不提升为最新owner回执。Host六字段只取最小操作事实，不复制普通结果全文；必要原始证据与摘要都不能容纳时仍明确overflow。

Host每次从当前获准快照生成操作级事实摘录，与普通六字段草稿确定性组合。摘录仅描述有证据的owner phase、opaque ID及必要子步骤，unknown不补成未发生，工具success不升为领域完成；初始accepted/pending及canonical已表达的revision-0状态也须覆盖。同轮其它未完成意图由原文或合法来源摘要承接，单个owner完成不意味着整轮完成。滚动`previousSummary`只包含普通草稿，Host摘录不交回模型改写；普通草稿及组合结果只保存在现有内存cache，公开输出仍为六字段，不增加持久化或授权。完整prefix binding/currentness含保护历史；runtime派发前独立重算锚点及其索引，拒绝伪造、遗漏或篡改。

确定性摘录占用同一摘要额度，模型可用余量按组合序列化扣除，不增预算。只有保护来源时无需aux；有owner摘录时初始普通六空数组可以组成非空合法摘要，但空更新不能擦除已有非空普通草稿；无任何合法摘录/普通事项仍沿用empty rejection。最终组合JSON及转义仍超限则明确overflow，不缩掉必要正文、自动retry或清缓存。

Operations staged 结果是固定无正文状态回执；runtime 与状态 collector 共用封闭 proof，核对固定文本、匹配 intent、tool、metadata 和无来源正文后，其结果本身不新增内容依赖。最终 lineage 仍与原 call 的全部依赖 union；未知或混合 call 不因该回执被洗为 complete。

历史有限状态含旧 run 的来源观察时，`TaskSourceRun` 先验证当前会话、真实外层 binding、唯一最近原始 user、owner origin 与 complete lineage，再为当前 run 派生空正文片段。当前 epoch、Memory、所有依赖和 source lifetime 仍须重验。仅 unrestricted notes 且无 excludedNoteIds 可走此路径；受限范围无法从有限 DTO 证明原观察范围，因此拒绝。原 state、origin、receipt 和存储 lineage 不变，旧正文与工具结果不获准入。

runtime与摘要器的内部历史快照须保全合法outer binding、Host provenance中的稳定用户身份及来源选择，并将相同字段纳入缓存currentness。该保全用于后续严格再投影，字段不进入provider公开payload，不令普通复制对象继承run-owned WeakMap证明；绑定、身份、scope或epoch变更继续失效。否则普通请求可达的有限状态会在触发摘要后丢失重验依据。

派生证明只存于当前 `TaskSourceRun` 的私有 WeakMap，runtime snapshot 保留受控片段引用。复制或修改不能继承证明，投影和派发继续验源。真实重开的空 canonical 容器仅在 schema 1、messages 为空、run/turn 两者都精确等于 `rehydrated:<conversationId>:<turnIndex>` 时兼容原绑定；外来、单边伪造或非空容器仍拒绝。普通 canonical 继续匹配原 run/turn。`ConversationPersistence` 仅在实际首次写成功后补回 live entry 的相同 binding，失败不新增。

## Lifecycle, Compatibility And Rollback

optional 字段向后兼容，损坏/旧数据不造成功；不做破坏迁移，不引入第二数据库，不持久化 raw canonical 或摘要。随 conversation 删除清理，关闭时取消 owned 订阅与异步任务。晚到旧 session 不写新会话。

回滚代码可忽略新增字段，保留用户源记录；不得用自动执行修复状态。desktop/mobile 共用历史，Ghost 保持 desktop-only。

## Test Matrix And Checkpoints

| Requirement / AC | Evidence |
| --- | --- |
| B-157/REQ-01 / B-157/AC-01 | C01/C05/C06/C08 actual next request 与关联 |
| B-157/REQ-02 / B-157/AC-02 | C02–C04/C14/C20 来源/篡改/revocation sentinel |
| B-157/REQ-03 / B-157/AC-03 | C06/C07/C09–C15 store/reopen/真实领域事件 |
| B-157/REQ-04 / B-157/AC-04 | C16–C24 编号/未决/摘要与 overflow |
| B-157/REQ-05 / B-157/AC-05 | C05/C06/C18/C20/C21 native/compat/存储白名单 |
| B-157/REQ-06 / B-157/AC-06 | C25–C28 模型/app/清理/独立判读 |

T02/T04 source 设计检查已吸收 strict 准入、turn binding、原子 revision 合并与保存队列必要修正；Owner 完整实施授权下批准该兼容设计。领域事件关联、压缩及最终请求仍需独立代码验收；所有实际执行状态只记 Tracker，本文不声明已交付。

# PA Contract Alignment — 优化方案与 SDD

Document status: Approved
Updated: 2026-10-05
Work item: B-161
Authority: 已确认产品选择的源码设计、接口、兼容与风险；执行与验收状态仅由Tracker持有。
Product spec: [Product Spec](../../../product/specs/pa-contract-alignment-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## 1. Pre-implementation Source Baseline

2026-10-05 设计时只读源码核对；下表保留实施前差异，不是当前完成状态或 Obsidian 实测。
后续实现遵循以下设计，实际证据及剩余差异见Tracker。

| 面 | 当前接线/差异 | 设计处理 |
| --- | --- | --- |
| 主动/自动发现 | `src/pagelet/orchestrator.ts` 的 Review、QuickReview、QuietRecall、ScopeRecap → `runExplicitDeepDiscover()`；自动事件 → `runAutomaticDeepDiscover()`；`plugin-deep-discover.ts` 的 `admitRun()` 共用 12/36 limiter | 按真实入口区分计数，保留统一发现 |
| 本地检查 | `runMaintenanceReview()` / `runGraphDiscovery()` → `beginForegroundRoute()` → `AnalysisSessionManager.reserveForegroundCall()`；检查算法为本地扫描 | 移除这两个入口的旧前台累计预算，保留运行中互斥 |
| 旧 Review/Recall | `AnalysisSessionManager.analyzeFiles()` 未找到生产消费者；`plugin-quiet-recall.ts` 的旧 `runQuietRecall()` 同样未找到当前入口；仍有类实例/Host 挂载及共享 helper | 消费者驱动退役，不能凭类名、测试或 tree-shaking 断定整类可删 |
| Operations | `operations-tool-executor.ts` 准备并 stage；`OperationsIntentController.stageIntent/executeIntent` 已有不可变准备、原子写、结果和 Undo；runtime 见 `approval_pending` 后进入仅致谢并结束；UI 再调用 confirm | 新领域执行入口复用 controller，解除仅致谢路径；不在 UI 自动提交提案 |
| 图片来源 | `chat-view.ts` 的 `imageInstructions/selectedInstruction` 强制补来源控件；已有 `textSource → prepareFeaturedImagePrompt → submittedPrompt` 链及服务回执 | 允许 Agent 提供真实笔记定位，来源域构造同一 textSource |
| Share Card | `share-card-types.ts` 的 50K/24 页常量；Modal 与 `paginateShareCardMarkdown()` 均拒绝；边界采样也引用页数常量 | 去掉业务拒绝，解耦算法采样参数；补取消/yield传播，沿用渲染导出 |
| Host 读取 | `pa-agent-host-tools.ts:canReuseSuccessfulResult` 对 userInput 使用 latest/current/最新等正则 | Agent 决定是否再调用；显式再次读取不被全局相同参数复用吞掉 |
| Operations 容量 | `operations/input-validation.ts`、`vault-transform.ts`、controller 仍有任意数量/字符上限；`note-image-removal-resources.ts` 仍有 64 MiB 恢复总额拒绝 | 删除已撤销业务额度，保留真实结构、权限、资源失败、写前完整恢复能力 |

## 2. 优化顺序与责任

先统一合同适用性，再按真实行为切片改运行入口，最后集中完成跨域验收。
任务和依赖统一放在 Tracker；不增加权限系统、第二套效果账本或“风险分类平台”。

引用[唯一 Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)，本包仅映射具体事项：

| 事项 | Owner | 输入/事实依据 | 输出与禁止事项 |
| --- | --- | --- | --- |
| 修改/预览、来源指代、超范围/费用变化、重读需要 | 主 Agent | 当前原始请求、已说明范围、现有工具事实 | 执行/澄清/停止；禁止 Host 关键词分类或另加模型评审 |
| 同一次请求及当前入口 | Invocation/runtime | app 捕获的 run/message、显式 command/scope、取消状态 | 闭包绑定真实身份；模型不得填写权限/run ID |
| 实际来源/派生内容 | TaskSourceRun 与来源域 | 路径、快照、显式范围、排除与撤权 | 允许的材料/拒绝事实；不得用默认值冒充用户选择 |
| 笔记修改/图片联合删除 | Operations controller/domain | 冻结操作、expected-before、共享引用、恢复快照、原回执 | 原子检查、逐效果回执和 Undo；不得由 staged/模型文字宣称已执行 |
| 配图提交 | 图片来源准备及 image service | 真实 textSource、现有 operationId、submittedPrompt/lineage | 专用提炼、一次物理提交、真实接收/unknown事实 |
| Ghost/Writing | 各自领域 owner | 现有版本、显式入口/具体确认 | 原有状态与权限，不继承 Operations 的确认取消 |
| 自动预算 | Deep Discover admission/limiter | 真实 triggerReason、启动事实、持久计数 | 仅自动预留/提交；显式请求不扣自动额度 |
| 分页及资源生命周期 | Share Card owner | 实际内容、测量、AbortSignal、实际渲染/保存结果 | 完整顺序分页；取消释放；失败不静默截断 |

## 3. Operations 直接执行

### 接口与状态流

保留五个 core 工具的准备/stage 功能，新增领域工具 **`execute_operations({ intentId })`**。
这是一条复用现有领域写入的入口，不是通用任意代码执行能力。

1. Agent 处理当前明确修改请求，准备完整 intent，再主动调用执行工具；分析/仅预览可
   停在文本或未执行 intent。不得让 `onOperationsIntentStaged` 自动执行。
2. 在 `operations-service.ts` 的 `OperationsSession` 增加窄方法
   **`executeCurrentIntent(...)`**，绑定 runtime 捕获的用户请求 runId、
   isCurrent/signal、来源 guard。模型参数只接受 intentId，不接受 approved、权限、runId
   或替换操作正文。stage/execute 可跨模型 turn，不能误要求相同模型 turnId。
   runtime工具不能直接越过ChatService的历史收口：增加薄包装
   **`ChatService.executeOperationsIntentFromAgent(...)`**，由真实运行绑定调用，
   再进入Session。与现有`confirmOperationsIntent()`复用执行前捕获原对话persist sink、
   执行后保存有限结果的逻辑；在首个await前捕获，不能依赖之后仍存在的observer。
3. pending 且属于当前请求、权限与生命周期有效 → 现有 `executeIntent()`；该方法已在
   首个 await 前转 executing，可复用互斥。executing 返回进行中事实；completed/partial/
   unknown 或已有执行结果返回原结果，不再次写 Vault。缺回执的执行异常不能降格为
   not_started；收口在现有 controller 状态/回执中，不建立新账本。
4. 跨请求的旧 pending、取消、过期或撤权不能由此工具执行。用户主动在旧预览点击执行
   沿现有确认入口，必须重验当前权限/文件状态；这不构成日常任务的二次确认要求。
5. `pa-agent-runtime.ts` 移除 stage 后无条件只许致谢/禁用工具/结束的分支；同步调整
   `operations-acknowledgement-policy.ts`、工具定义/注册、执行重试分类与结果投影。
   执行工具标记 filesystem-write、顺序执行、side-effect，不能继承 stage 的
   纯准备语义或被通用 confirmation policy 再强制弹窗。
6. `ChatService` / `chat-view.ts` 保持原事件订阅和 `registerOperationsContextPersistence()`，
   另保留上一步await前捕获的有限历史sink：`dispose()`会清空订阅/observers，原生写入
   等待时关闭会话仍可能产生真实效果，返回后必须记回原对话，不能停留在staged/running。
   此收口不恢复已关闭UI、权限或执行能力；Undo owner已释放时如实记为不可撤销。
   卡片展示准备/执行/真实结果和 Undo；明确请求不展示“必须确认才能继续”的阻断态。
   手动完整差异审阅保留。会话恢复、压缩摘要使用真实 executionState/resultFact，
   不能继续套用“No write occurred”或把保存的 staged 状态自动升级。
7. 执行前由原会话的`ConversationPersistence`等待running行并绑定当前action；复用
   `updateActionStates`的事务检查stableMessageId/当前pendingRunId，只更新action字段，
   不重写来源正文、不重建被删除的会话。原生效果返回后从Operations owner刷新最终事实，
   再持久化；同run状态查询可读取本次已验证action，并保留会话、生命周期和唯一origin检查。
   这解决实际成功但历史仍pending、同请求查询not_visible的F-13，不增加新存储或schema。

### 不变式

- expected-before 原子比较、撞名、来源权限、取消、共享引用和写前完整恢复快照保持。
- 取消只阻止后续效果；已发生的部分不能消失。unknown 查询原 operation，已执行不重放。
- 撤销检查 expected-after、当前权限、时效和回执消费；不能覆盖用户后续编辑。
- 明确授权修改 A 而模型选 B 是 Agent 语义错误；不能新增正则来“证明”同意。
  采用真实模型行为验收与原始结果，不把结构测试当作语义普遍正确。

## 4. 自然语言图片来源

扩展现有 `create_image` schema/binding input，加入 **`sourceNotePath?: string`**。
Agent 用现有查找/读取能力确定唯一笔记；Host 不要求该路径逐字出现在用户原句中。

- 未选来源控件时，来源域把该定位解析为当前 TaskSourceRun/Data Boundary 允许的真实
  Markdown 文件，捕获现有 `ComposerImageTextSource` 形状。小型捕获 helper 可就地抽取，
  不新增选源 UI/存储。模型不能提交正文来冒充此文件快照。
- **接线时点必须早于现有runtime `scopedImageBinding.submit`的lineage准入与
  `captureImageTaskSourceValidity()`。** 当前`create_image`跳过普通note read-plan，
  不能假设Agent已调用read_note，也不能仅在更晚的ChatView.submit里补绑。
  新增窄的**`resolveImageNoteSource(...)`**绑定：由runtime闭包提供真实
  TaskSourceRun/guard，先检查允许读取的源类型/范围，再让来源域读取并捕获textSource，
  将其来源关系合入本次inputLineage；随后统一执行现有lineage准入和有效性票据捕获。
  将同一不可变来源/guard传到提炼、提交、交付，不在后段按路径重新生成另一份快照。
  `ChatPluginIntegration`的Data Boundary/文件检查不能替代notes/web/combined范围。
- 实际端口：factory把每次调用的guard/signal交给scoped binding，runtime调用
  `resolveImageNoteSource(input, guard, signal)`后，再做lineage准入及票据捕获；
  `submit`第六个Host-only上下文携带`{ guard, signal, textSource }`。
  `create_image`仍走图片来源域端口，不增加普通read-plan；Integration在读取前后检查
  guard/domain/path/文件身份，来源关系由实际读取注册。Agent不能填写该Host上下文。
- 控件已有明确来源时，冲突路径返回可澄清事实，不静默覆盖；当前页变化不更换已绑定来源。
- 同名但不同笔记且用户未区分时，Agent先询问，不以搜索位置选第一篇或合并候选来消除歧义。
  图片状态查询逐字复用实际receipt的taskId；只有明确的submission operationId才能用于该字段。
  查询不可用不等于生成失败，不能据此建议重建。此指导保留语义判断在Agent，不新增Host分类器。
- 复用 `ChatPluginIntegration.verifyImageTextSource/isImageTextSourceCurrent`、现有专用
  提炼及 submittedPrompt/inputLineage/operationId 链。保留图片域现有必要快照校验，
  不把普通 Chat 已读快照政策机械套到付费图片提交上。
- 修改 `chat-tool-factories.ts` 的 schema/参数白名单及 `chat-view.ts` 强制补点控件指导。
  普通 Chat 与显式 CreateImage 都使用同一规则；单纯讨论图片/写 prompt 不发起生成。
- 定位失败在提交前可返回 not_started 让 Agent 修正；进入服务后接受状态不明则查询原
  operation，不因换 path/prompt 再次发起付费调用。取消/撤权阻止尚未发生的提交。

## 5. Pagelet 与旧管线

### 手动和自动的预算分流

保留现有 scheduler、admission、limiter。依据 app 已捕获的 `triggerReason === explicit`
分流，不读取用户文字推断手动/自动：

- explicit 经过同一权限、来源、取消及 provider admission，跳过自动计数的读取、预留、
  提交；自动池存储失败也不能借该计数依赖阻断手动。
- 自动任务继续 `reserveLeaseIf`/rollback/commit 与现有 fail-closed 存储语义，默认12/36，
  一个被准入并启动的 run 计一次，多轮模型调用不是多个 run。force 不是权限绕过。
- 复用原 Deep Discover 持久计数。历史共享时间戳无法辨别手动/自动，不猜测重分类，
  不清空额度；已有记录自然到期，新手动不再计数。过渡窗口是保守旧消费，文案不声称
  已准确追溯分离；重载不能刷新额度。旧 Quiet Recall provider-call 桶不合并或换算。
- `runMaintenanceReview/runGraphDiscovery` 取消 `reserveForegroundCall` 路径，但保留
  begin/finish 生命周期、互斥、超时和真实错误反馈；不因此接入 AI 增强。

### 旧 Review/Recall 的处置

先按当前注册命令、Host 消费和生产 import 链确认最小删除闭包。优先删除已无消费者的
旧 evaluator、仅供旧路径的篇数确认/语言正则重试与额度接线；保留被活跃功能使用的
来源 helper、状态 reader、关联笔记能力及历史数据兼容。不按整个类整块删除。

若发现仍有合法调用者，保留其旧10/50 provider-call预算，5候选为可调默认而非 clamp
硬上限；删除语言字符判断引起的拒绝/额外调用，保留 JSON/必要字段和模型语言指导。
两种处置都不得重新接回旧 Review/Quiet Recall；无需为“修复旧 bug”造新用户入口。
现有设置旧字段可兼容读取，不加普通 UI，也不清空用户数据。

## 6. Share Card 与已撤销 Host/Operations 规则

### Share Card

同时删除 Modal 和 paginator 的50K/24页业务拒绝及专用错误文案/镜像测试。
`MIN_DENSE_CODE_POINT_BOUNDARIES` 等依赖 MAX_SHARE_CARD_PAGES 的采样参数改用有明确
算法含义的本地参数；它们不能再次成为可处理内容量上限。保留不可分页原子媒体的真实
测量错误及既定内容支持，不承诺任何设备无限内存。

在 `ShareCardPaginationOptions` 中加入 **`signal?: AbortSignal`**，从 Modal
现有 resourceController 贯穿所有分页尝试，循环/测量间检查取消并复用平台让步能力。
保留 exporter 的序列捕获、及时释放临时 DOM/blob URL/observer。取消或真实资源失败时
停止后续测量/导出，沿现有批次结果报告实际已保存内容；不能把残缺结果标为完整成功。
不做无关渲染器重写、静默缩短内容或改用其他截图库。

长单块切点按需细化于同一次静态渲染的DOM。保留源边界计划，源区间与实际DOM文本
一致时才能推导新坐标；不重渲染全文或跨DOM转移旧坐标。分页按最终切点推进，保留
富文本结构和尾空白，已选页面在后续细化后仍引用同一原型。

### Host 读取与 Operations 限额

删除 `canReuseSuccessfulResult` 对 userInput 的正则。对普通读工具，Agent 不发新调用
即可使用已读上下文；Agent 明确再次调用时不能被 Host 相同参数成功复用直接吞掉。
沿既有 capability/dispatcher 执行，不添加 fresh/current 关键词参数协议。状态工具
继续实时查询；Writing context 的显式版本/选择事实复用按原域契约处理。

逐个移除已撤销的 Operations 业务容量准入（数量、内容/增长、替换数量、恢复字节及
效果读取截断）；不只删除最显眼的16。结构/路径/协议类型校验与实际资源保护按真实边界
保留，不能用另一更大常量替代。长任务按现有协作让步/取消执行；实际恢复快照分配失败
在首个写入前报告，不静默转为不可撤销删除。不新建持久备份或 unlimited 缓存。

## 7. 文档接续清单

T-01 逐条修订原文及必要索引；历史证据仅加适用性/后继链接，不重写原判定。
本 DEC/Spec 已定义目标，但这张清单完成前不能声称所有旧合同都已校准。

| 问题 | 必须核对的既有文档 | 正确接续 |
| --- | --- | --- |
| 本轮新选择 | DEC-020/023/024/044/046/050；Pagelet、Share Card、Unified Image、Note Change Review、Note Image Removal Specs；B-123 proposal/SDD | DEC-051 的局部覆盖，保留未改条款；旧入口/新入口分清 |
| 旧 runtime/summary 硬预算 | `pa-agent-runtime-evolution-product-spec.md`、`pa-agent-runtime-lifecycle-plan.md` | 当前 `pa-context-management-product-spec.md` 的软压力策略，不恢复旧硬限 |
| Operations opt-in/意图门 | DEC-014、DEC-034、`operations-agent-step3-sdd.md` | 当前 `pa-agent-essential-capabilities-product-spec.md`，不再用旧开关隐藏基本能力 |
| 持久 Operations 审计 | DEC-014/034、write-action/Operations 旧设计 | DEC-046；停写审计，不扫描/清理旧目录 |
| 普通 Chat 已读快照 | `pa-agent-architecture-plan.md` 旧逐轮重读措辞 | Recoverable/Runtime evolution/current read_snapshot；权限撤销仍有效，写入/付费域独立规则不泛化 |
| generic preload | DEC-023、Data Boundary、Pagelet设计/guide | 旧2/20、7日、4K/1K envelope不覆盖当前统一发现 |
| 旧 Pagelet 范围与设置 | `pagelet-sdd-guide.md`、Pagelet产品设计 | 旧 Panel范围控件退役；不再指示用户调整已无UI的前台限额 |
| Capture/Memory普遍确认 | Quick Capture CAP-D9、Saved Insight相关措辞 | Memory Control Center的effect/risk；taxonomy已有supersession不制造新冲突 |
| 独立 Weekly Review | Saved Insight、Low-Burden Review、Eval相关矩阵 | 保留已退役边界；B-119/B-112不激活 |

## 8. Compatibility, Lifecycle And Rollback

- 无新持久权限/审计/备份格式。旧 pending/历史卡片保持未执行，序列化结果兼容读取；
  reload 不自动执行旧提案。新工具同 run 绑定由现有生命周期维护，unload/取消释放资源。
- 预算保留历史记录并自然过期；不跨单位合并桶。删除死代码不删除用户保存的旧结果。
- UI 复用当前卡片、来源控件、差异 tab、Undo；移动与桌面共享语义，移动验证选现有
  Obsidian CLI simulator。本任务没有新增真机 iPhone gate。
- 按行为切片可回退源码，保留已发生效果和现有会话数据；代码回退可能恢复旧交互限制，
  不能伪称仍满足新合同，也不能回滚真实笔记写入或重放外部效果。无需新迁移框架。
- shared source/tests/config 冻结后集中 broad gate；前面 focused 证据按受影响输入复用。

## 9. Test Matrix / Requirement Coverage

完整命令、通过条件、重跑触发和实际结果见 Tracker；本表同时覆盖所有稳定 REQ/AC。

| Requirement / AC | 最低必要证据与切片 |
| --- | --- |
| B-161/REQ-01 / B-161/AC-01 | T-01/02/03/04：无篇数规则；多来源当前明确任务与真实歧义的Agent场景，不用正则fixture替代语义 |
| B-161/REQ-02 / B-161/AC-02 | T-03：真实 runtime→stage→execute→receipt→UI；关闭会话时原生执行返回仍写原历史；原子写、部分/unknown/撤销；T-07最小实机入口 |
| B-161/REQ-03 / B-161/AC-03 | T-04：初始只有用户文字lineage、模型直接给sourceNotePath的完整准入链；web-only/选定A却指定B/准入后撤权；T-07无控件指定笔记的真实交互 |
| B-161/REQ-04 / B-161/AC-04 | T-07：复用Writing入口/父版本测试，普通Chat和显式入口各一代表场景 |
| B-161/REQ-05 / B-161/AC-05 | T-07：复用Ghost concrete-version/unknown/prepare测试；无需真实生产发布 |
| B-161/REQ-06 / B-161/AC-06 | T-03/04/06：三scope及派生输入/撤权边界；保留existing integration断言 |
| B-161/REQ-07 / B-161/AC-07 | T-05：一份超过两旧上限的完整性案例、取消、真实失败；T-07实际长卡片交互与导出 |
| B-161/REQ-08 / B-161/AC-08 | T-02：耗尽自动池后的所有显式入口路由、本地两入口，explicit不写计数 |
| B-161/REQ-09 / B-161/AC-09 | T-02：自动准入、回滚/提交、reload、存储失败和历史混合计数兼容 |
| B-161/REQ-10 / B-161/AC-10 | T-02：生产调用图+共享消费者测试；有消费者才补跨语言设置/候选参数，不为死分支新建测试 |
| B-161/REQ-11 / B-161/AC-11 | T-03/06：超旧限额与实际失败、完整状态可读、同参数再读取；保留事实和来源保护 |
| B-161/REQ-12 / B-161/AC-12 | T-01/07：接续清单逐项完成，docs检查与人工语义核对；不是仅关键字不匹配就宣称一致 |

## 10. Open Design Findings And Approval

没有阻挡该方案的未决产品选择。上述接口已进入实现；源码切片是否接受、runtime入口行为、
模型语义和长内容实际设备资源证据统一见Tracker，不由本设计文档宣称验收完成。

- 设计依据：Owner 已确认选择；GPT-6 负责本次设计，技术方案不是新的用户产品批准。
- 设计批准：2026-10-05，GPT-6 核对源码及独立设计审阅；两项P2接口缺口已修订并复审通过。
  Approved只表示本方案可供实施，不表示runtime已修改、测试已通过或新增实施授权。
- 实施授权：Owner于2026-10-05要求完成B-161全部开发测试，当前执行与证据见Tracker。
  按既有GPT-6/GLM流程推进，不重复问已确认产品选择；Git/closeout/release仍分别授权。

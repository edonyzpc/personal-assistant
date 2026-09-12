# Unified Agent Task Execution Development Tracker

Document status: Current
Delivery status: Implementing
Updated: 2026-09-12
Work item: B-135
Authority: 本 track 全部新增工作的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [Unified Agent Task Execution](../../../product/specs/pa-unified-task-execution-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: P1/P3 已收口；P2 的默认迁移、实际 scheduler/collector、Personal/style 组合及 Desktop 设置/独立退出/遗忘已通过，T-10 语义质量与受影响 iOS 实机门保留。P4 已完成 native 兼容判断、生产默认切换、当前Qwen可见Desktop成版/版本/精确保存、新旧reader及自然语言续写；T-18仅保留受影响iOS，最终阶段门尚未通过。
- Next action: T-20已有同输入重复准备、Qwen四案、DeepSeek两案、请求序列/耗时与可得usage的完整审计，不新增模型运行；先取得D15对DeepSeek单样例引号质量差异的处置，再同步T-10/T-20/F-23。当前源码随该决定冻结后只执行一次T-21统一broad gate；T-11/T-18的受影响iOS等待可用设备环境，不扩展Desktop替代验证。
- Blocker / decision needed: D15需要Owner判断DeepSeek native单样例将中文弯引号改为ASCII直引号是否作为模型质量差异接受并继续默认native；provider正文到artifact逐字一致，旧协议同案保留弯引号。旧Profile读取绕过及其它产品答复已完成，无需重问。受影响iOS仍是当前Linux主机外部环境门，不以Desktop替代。
- Last verified behavior: 2026-09-12当前默认native/Qwen真实Desktop自然语言续写只提供一个宿主父版候选；模型用2次物理请求依次调用`get_writing_context`和`present_writing`，唯一子版及artifact均绑定正确父ID，保留“明早九点开会”、移除携带材料/提前到场并加入“请准时参加”，零恢复/动作/额外ack。实际版本弹窗列出父子两个AI draft；首探针误点历史入口后超时，但模型结果、两版及DOM选项已先完成并留证，隔离IDB和临时脚本随后清理，`data.json`仍为`f8cfd5b…2dcbc`且Obsidian零新错误，不为探针选择器重跑模型。
- Task count: 22项中16项完成、6项部分实现/验证、0项未开始。16/22只表示完整验收任务占比，不是代码完成度；剩余内部任务为D15后的T-10/T-20、最终T-21/T-22，T-11/T-18及阶段门还受iOS环境约束。
- Execution: Owner 2026-09-10明确答复“恢复”，继续已确认的全量实施目标；此前暂停与Git整理已完成。恢复起点`10dc44a`在统一交付点后仅追加发布流程规则，复用运行时证据仍按实际输入核对，不重开旧任务。本次代码提交为`02b5092`（Memory来源）、`aa16fc4`（Chat最终存储）及`fd3ceae`（历史native回放证据），随附SDD/Tracker证据；统一交付目标仍为`codex/b135-discussion-followup`。
- Workspace: `/tmp/pa-b135-docs`，唯一开发交付分支为 `codex/b135-discussion-followup`。Owner 2026-09-10要求全部commit统一到此分支，并删除本地/远程`codex/b135-completion`；已从`4591434f7df1499b11f0143240d38b99165fc9bc`快进纳入实现提交`148d7e3`与证据提交`3ddf827`，原commit身份和历史保持不变。工作目录同步恢复为当前路径；远程同步与旧分支删除的最终核对见本次交付回执。此操作仅整理Git交付，不恢复暂停的Goal。main工作区master `8be89c4c`保持干净；package-lock与main一致，node_modules只链接复用已安装依赖，不复用旧测试结论。
- Ownership correction: 撤销本次讨论上一轮误加到 B-106 的 P4/T-14/T-15 及状态降级；该旧包三个过程文件恢复原状。默认、迁移、habit、history、writing/image、Operations 的全部新增实现/修复/回归由本表承担。旧任务不新增待办、不重开、不承接 B-135 未决项。
- Authorization: 既有全量实施授权继续适用；此前逐项讨论轮记录真实产品答复，随后按已确认方案持续实施。Owner 于2026-09-09明确要求“为当前修改创建commits并推送到远程开发分支”，授权本次累计B-135代码/测试/方案提交到origin的同名开发分支；不包含PR、master合并、tag、release或closeout。新产品偏差仍须单独决定。

## Decisions

状态为 Pending 的选项不得因本文件或 DEC-034 自写 Accepted 获得授权；收到用户答复后记录真实日期与原意，并同步稳定契约。技术验证与用户选择分别列出，不把回答“同意方案”写成测试通过。

| ID | State / evidence | Choice, recommendation and tradeoff | Gate / rollback |
| --- | --- | --- | --- |
| D1 | Confirmed — implementation and automated physical-input matrix complete 2026-09-12 | 当前笔记限定保留个性化、已有 Memory、风格及获准历史；同一 Agent 解释新增取材约束，宿主验证结构化边界/真实权限。已有设置、排除、撤销可在首请求前执行；任意新增自然语言“不要发送背景”不能在已经发送后补救，也不能声称普遍支持 | T-04已完成组合输入及各物理发送点自动化；T-13/T-21继续真实模型/App/device。未覆盖的严格发送能力不纳入已实现承诺；禁止统一空背景或独立 classifier fallback |
| D2/D3 | Confirmed — Owner 2026-09-09 答复“采用专用作品通道，兼容验证通过后切换（推荐）” | 采用主 Agent 纯作品输出通道，Chat 收尾可文字或一个作品；无新取材/动作，无额外 acknowledgement 模型轮 | T-03 当前模型 native/预览/finish/旧 reader 兼容通过后才切换；产品选择不是验证 PASS，失败停止推广并重新讨论，不自动双协议 |
| D4 | Engineering candidate — P0 需证据 | 复用 Type A 理解用户语义；宿主事实与模型候选分开；未知不默认 ordinary；真实个人陈述与本次写作要求混合时分别处理，不丢掉独立事实 | T-04/T-10：提取输入准入和两条最终持久化准入分别证明；保留旧 hostProvenance/reader，失败不写不兼容字段 |
| D5 | Confirmed — Owner 2026-09-09 对语义提议及保留执行保护答复“同意” | 主 Agent 在现有 per-vault opt-in 和四个 core tools 内按目标提出 Operations 建议，替代本地操作意图规则；不明确时澄清，实际执行仍确认、stale-safe、Undo、审计，准备读取仍受来源约束 | T-15：schema、canExport/canExecute、提议、执行一并适配与验证；关闭/未确认/取消/目标 stale 均零写入。产品批准不代表已实现或验收通过 |
| D6 | Engineering candidate — T-06 验证 | 单一绝对硬截止；已开始正文/作品允许在原硬期限内接收，不因软过渡丢弃重答。仍可能用尽重答预留，硬期限/取消不得延期 | fake-clock 测试 startup、reasoning、partial body、late tool、重复 finalization；独立回退预算适配，保留完成事实修复 |
| D7 | Confirmed — Owner 2026-09-09 | 长期提取、本地习惯学习分别默认开启，可独立关闭/暂停/管理；首次透明说明，已有调度/预算/治理/权限不扩张 | 全量归 B-135/REQ-17、AC-17、T-08/T-09，不回 B-106 |
| D8 | Confirmed — Owner 2026-09-09：“同意，默认开启，旧的false如果不是明确用户关闭也设置为开启” | 两项能力分别默认开启；旧 false 没有明确用户关闭证据时也迁移为开启，包括来源不明旧 false；明确用户关闭或有效暂停保持原状态，不额外询问一次。该补充覆盖先前“未知 false 保持关闭”的推荐 | T-08/T-09 已在归一化前分类 raw settings；未知不是已知默认或用户授权事实，不伪造 confirmedAt。一次迁移、load/save/reload、真实宿主 scheduler/collector、设置 DOM 与退出零新增已通过；P2 的 T-10/T-11、真实语义和设备门仍独立保留 |
| D9 | Confirmed — Owner 本次请求 | 旧 track 已交付或 closeout 的相关接缝不重开；本次所有增量与组合验收都在 B-135，必要的稳定契约修订保留有日期来源 | T-01/T-22；旧过程文件无本次新增 diff，历史证据不改写为新默认 PASS |
| D10 | Confirmed — Owner 2026-09-09 对拆开新提取与已有画像使用答复“同意” | 关闭/暂停长期提取只停止新学习；已有有效 Personal 可继续用于后续模型输入，仍受 Memory 主开关、来源有效性、治理、排除、遗忘与预算控制。显式 style 保留独立授权/撤销规则；设置说明明确停止学习不等于停止使用已有背景 | T-11 联同 T-08/T-09：停提取零新学习但已有画像可用；关闭 Memory、删除/遗忘、来源失效即禁止相应读取/投影；覆盖保存失败、重载和实际 provider 输入，不以字段解耦冒充验收 |
| D11 | Confirmed — Owner 2026-09-09 对明确版本边界建议答复“同意” | 新语义凭据采用明确格式版本；降级旧版时保留治理库数据并停止该库的读取/确认/恢复，升级回来再恢复使用。接受旧版暂不能操作该治理库的代价；原笔记不修改 | T-04/T-10/T-19 全量跟踪：旧 parser 拒绝未知版本仅是局部证据；必须验证旧插件 bootstrap、普通保存、确认、恢复、legacy 画像路径及重新升级的数据保真。不得清空、覆盖或绕过治理库拒绝结果；产品批准不代表安全降级已验证 |
| D12 | Confirmed — Owner 2026-09-10“接受，仅排除受影响的旧回复” | 旧助手回复含已撤销材料且无可靠段落级拆分时，仅暂时排除该条模型输入；界面原文及其他消息保留，来源重新获准有效后可恢复 | T-14原文/摘要/SDK同门，未知legacy不整体删除；已实现定向验证，不替代完整历史/作品快照及App门 |
| D13 | Confirmed — Owner 2026-09-12“保留明确确认后的人工恢复（推荐）” | 重开后无法完整核验来源的旧作品：现有恢复窗口提示“旧来源记录不完整”，点击“确认并恢复为 AI 草稿”，不增加第二个弹窗；已确认撤销或失效仍拒绝，AI来源与学习限制保持 | T-18：完整有效、已知失效、记录不足分别处理；确认仅允许恢复记录不足的AI草稿，不覆盖失败检查、不证明旧来源全部有效或授予学习。新持久字段仍须另证旧reader兼容与最终事务准入 |
| D14 | Confirmed — Owner 2026-09-12“接受分开评估，F-20 继续跟踪（推荐）” | 新旧协议共现的F-20保留为模型质量问题，不再单独否决专用通道兼容评估 | T-03/T-20仍保留原FAIL；协议、来源、预览、finish与App门通过后才切默认，非立即切换批准 |
| D15 | Pending — T-20现有证据，无新增模型运行 | DeepSeek `deepseek-v4-pro`同一明确正文样例中，native由模型把中文弯引号改为ASCII直引号，旧协议精确保留；两条传输均把provider正文逐字交付成artifact。建议把单样例差异作为模型质量基线继续跟踪，保持已验证native默认，不增加自动fallback或provider特判 | Owner接受后将F-23记为已处置质量限制并关闭T-20；若拒绝，则恢复全局legacy默认并重新定义切换门，不静默双协议或只对DeepSeek加例外 |

## Work

2026-09-12 T-16/T-18最小剩余映射：AC-08/09/10 → 复用现有Chat回归对回选旧版、
失败继续的空/子集材料、重开、会话/hash失效及新话题清空的正反例，只补一条当前默认native、
当前Qwen、实际Desktop自然语言“继续修改上一版” → 隔离真实IDB中预置无来源/图片的父版本，模型
只能从单一宿主候选目录选择，交付后核对物理请求、artifact父身份、两版父子关系、要求的保留/
删除/新增文字及可见版本弹窗 → 唯一子版、零恢复/动作、无额外ack，父版正文不被改写；candidate/
context/runtime/Chat/version接缝变化才重跑。此片不重复保存、图片、style、失败矩阵、第二模型或
全量测试，受影响iOS保持单独环境门。

结果PASS（T-16/Desktop范围）：[`当前Qwen回执`](evidence/2026-09-12-t16-natural-continuation.json)
及[`可复现探针`](evidence/2026-09-12-t16-natural-continuation-probe.js)。唯一候选父版由模型在首个
请求选择，第二请求交付唯一子版；artifact/child父ID一致，正文精确满足保留、删除和新增要求，
零recovery/Operations/后置ack。真实版本弹窗已列出父子两个AI draft；探针误点首个历史入口导致
初始textarea显示父版并在等待期间超时，明确归为探针selector失败，保留脚本已改选最后入口，不重跑
provider。既有自动化覆盖失败继续、重开、材料空/子集、新话题和失效反例，T-16关闭；T-18的
Desktop保存/恢复/失败路径已有证据，状态仅因受影响iOS保持部分完成。

2026-09-12 T-20质量/成本审计：AC-01/02/12 → 复用相同自然语言样例修复前14请求/12次准备/
170140ms与修复后2请求/1次准备/57505ms，Qwen原提示和明确正文边界的新旧协议四案，以及Owner指定
DeepSeek明确边界的新旧协议两案 → 按实际配置、物理请求序列、结束事实、wall-clock与可得usage逐项
汇总，缺失Qwen usage/finish明确记unknown；不把wall-clock差额解释为固定提速或协议净成本，不新增
模型运行 → [`审计回执`](evidence/2026-09-12-t20-quality-cost-audit.json)。结果：F-19重复准备已闭合；
F-20按D14保留共有质量基线；DeepSeek native 2请求/7485 total tokens、真实tool_calls，legacy 2请求/
5989 total tokens、真实stop，前者把弯引号生成为直引号而provider→artifact仍逐字一致，形成D15/F-23
单独产品处置。T-20证据目标已齐，等待D15后更新任务状态；不为单样例增加模型次数或成本平台。

2026-09-12 P4默认作品通道映射：REQ/AC-05/06/07/08/10/11与D2/D3/D14 →
当前正式`createChatHost`补充已经完成Qwen/DeepSeek、终态、来源、版本、保存及旧reader兼容验证的
`writingOutputProtocol: native`，继续由Chat为每轮提供host writing request，不增加设置、自动双协议
或legacy内容解析fallback → production host单测、既有Chat native候选回归、类型/静态检查；随后只跑
一个当前Qwen的可见Desktop作品全流程，核对自然语义、增量preview、唯一成版/无额外确认、精确
版本/保存/重载 → 普通回答仍允许文字，完成作品只产生一个版本，未闭合/来源失效继续拒绝；
provider/schema/host导出/Chat成版接缝变化才重跑。既有preview/图片/旧reader矩阵不重复，iOS只在
实际受影响的作品/保存出口执行。

结果PASS（默认/协议/Desktop范围）：production host与Chat两个聚焦回归通过，tsc、定向Lint、diff及
社区DOM扫描通过；生产build自然退出并以`54cd8cd…b8b37`部署重载。当前Qwen实际流为2次物理请求、
17次preview、1个精确作品/AI版本、零恢复和Operations；可见版本弹窗与保存预览正文一致，预览阶段
零写入，最终明确确认后receipt为completed且笔记包含完全相同正文，无额外ack模型轮。回执见
[`Desktop证据`](evidence/2026-09-12-p4-default-native-desktop.json)、
[`版本视图`](evidence/2026-09-12-p4-default-native-version.png)及
[`保存预览`](evidence/2026-09-12-p4-default-native-save-preview.png)。本结果关闭T-03/T-17以及由既有
真实降级矩阵和当前reader重载共同覆盖的T-19；D14下F-20/F-23仍归T-20。T-16自然语言续写组合、
T-18失败继续与受影响iOS仍保留，不用本Desktop结果代替。

2026-09-12 T-14/P3最终映射：AC-03/04/08 → 复用完整历史、来源摘要、图片身份及
retry/summary/rewrite逐物理输入重验，只跑一个当前Qwen组合案例：上一轮登记两张图并先选第一张，
本轮明确更正为只看第二张、禁笔记/Memory/Web → 首请求零图片，模型调用scope声明与
`resolve_chat_images`；第二请求只附第二张，第一张零读取/零发送；准确返回第二张顶部标题，
零作品/恢复/Operations/持久化 → [`回执`](evidence/2026-09-12-p3-cross-turn-second-image.json)
及[`只读探针`](evidence/2026-09-12-p3-cross-turn-second-image-probe.js)。结果PASS：2次物理请求，
第二张variant解析1次、当前性验证2次，第一张均为0；终态completed/stop，正文精确为
`30-deep-target`。探针未导入图片或保存会话，删除后主工作树干净、`data.json`哈希仍为
`f8cfd5b…2dcbc`。现有共享runtime无移动端分叉，本片按SDD“只按受影响结果选设备门”不新增
模拟器/iOS重复验证；后续作品/保存的受影响iOS门仍由T-18/T-21承担。P3 T-12–T-15出口通过，
无新finding；不增加第二图片组合、第二服务、build/deploy或全量测试。

2026-09-12 P3 最小语义/Desktop映射：AC-01/02/03/04/13 → 复用已通过的整批scope
预检、逐物理输入投影、当前笔记身份与Operations staging/确认门，只用当前Qwen跑四个固定
真实案例：引用+否定仍普通咨询、建议并起草同一任务、只用当前笔记且禁网、明确保存仅产生
待确认提议 → 当前native候选的真实schema/工具调用、临时合成当前笔记、零越界读取与零实际
写入、Desktop可见提议卡 → [`模型与Desktop回执`](evidence/2026-09-12-p3-semantic-and-operations.json)、
[`语义探针`](evidence/2026-09-12-p3-semantic-app-probe.js)、[`Operations UI探针`](evidence/2026-09-12-p3-operations-ui-probe.js)
及[`可见卡片`](evidence/2026-09-12-p3-operations-pending-card.png)。四案4/4通过：普通咨询零
作品/零提议；混合任务唯一短作品；当前笔记准确返回`B135-P3-CURRENT-7K2M`且无Web；保存请求
为单一pending intent且目标未创建。获准案例共8次物理请求；两个首版fixture分别因非真实
MarkdownView和不存在父目录被宿主正确拒绝，排除后只定向重跑对应案例，总计13次物理请求。
实际卡片显示`Nothing has been written yet.`及目标正文，点击Cancel后按钮隐藏、目标仍不存在、
provider与写入调用均为0。临时笔记、脚本和隔离数据库已清理，主test vault恢复，插件
`data.json`哈希仍为`f8cfd5b…2dcbc`。本结果关闭T-12/T-13/T-15；模型/prompt/schema/
source/Operations接缝变化才重跑，不重复来源矩阵、全量测试或第二服务对照。T-14仍只补设计
明确列出的跨轮更正+第二张图片组合语义，后续iOS门保持独立。

2026-09-12 P2 Desktop 退出/遗忘映射：REQ/AC-04/09/10/17 → 复用默认迁移、真实
scheduler/collector、非空Personal/style物理输入与最终准入证据，仅在当前冻结bundle中以实际设置
控件依次关闭长期提取、本地习惯和Memory主门，再从Memory控制中心明确确认Forget → 关闭提取
不再保留scheduler但既有授权style继续可用；习惯可独立关闭；关闭Memory使旧receipt和后续style
投影立即失效但仍可管理；Forget移除正文及有效投影，仅留无效果、无操作的防重建标记 →
[`Desktop回执`](evidence/2026-09-12-p2-desktop-exit-and-forget.json)及两张可见截图；设置、
style治理、Memory主门或Forget流程变化时才重跑。该 smoke 零provider请求，不重复语义矩阵。
合成会话/版本已删除，治理状态除单调commitSequence外语义恢复，`data.json`前后均为
`f8cfd5b…2dcbc`；插件重启后默认11、governance ready、原3条会话/活动会话及零modal恢复。
当前Linux主机无xcrun、idevice_id、iCloud test vault或iPhone表面，受影响iOS实机门保持
NOT TESTED；不以Desktop或模拟证据代替，也不阻塞不依赖设备的P3工作。

2026-09-12 D1完整物理输入组合映射：AC-03/04/09 → 复用现有生产
`PaAgentRuntime`→`AIUtils`→`ChatOpenAI`→SDK离线transport fixture，在同一“只用当前笔记”
写作run中提交`current_note`范围并读取当前笔记，同时提供有稳定身份的Personal、已有Memory
背景及有效授权style；再检查最后真实请求正文和`GenerationInputSnapshot` →
`b129-multimodal-runtime`单一组合回归，连同既有answer/invoke fallback、history/tool summary、
query rewrite/rerank逐次重验用例 → 当前笔记正文、Personal、已有Memory和style同时进入最后物理
请求，任务来源快照只记录当前笔记且个性化身份分栏保留；其它Vault材料/Web不得混入，任何
来源或SDK准入实现变化须重跑。本片只补未覆盖的组合证明；若反例暴露产品缺陷再改runtime，
不通过统一清空背景或放宽来源断言取得PASS。真实provider、Desktop可见交互和iOS仍是独立门。

本片结果：新增组合用例从真实生产runtime经AIUtils、ChatOpenAI及SDK离线transport完成两次
物理请求；最后请求同时含当前笔记正文、稳定Personal、已有Memory和授权style，另一笔记路径
及内容均未进入，作品`GenerationInputSnapshot`只登记当前笔记任务来源，并分别保留Personal、
Insights和style身份。结合既有answer SDK retry、stream→invoke重建、history/tool summary、
query rewrite/rerank物理准入及来源撤销反例，10 suites / 335 tests PASS，10.414 s，均自然
exit 0。没有修改runtime源码、配置、依赖或构建输入；本结果关闭D1/T-04自动化可行性，
不替代真实模型语义、可见Desktop/iOS操作或最终冻结全门。
最终仅整理新增fixture的可读返回表达，当前`b129-multimodal-runtime` 90 tests复验PASS，
2.481 s自然exit 0；其余9 suites的源码、fixture、配置及依赖均未改变。
本片最终`npx tsc -noEmit -skipLibCheck`与`npm run lint`自然exit 0；`docs:check`通过
206 Markdown/1820链接并保留4项既有episodic advisory，文档契约2 suites/58 tests PASS；
diff和社区DOM源码扫描通过。后续只补写本验证记录，不改变测试、checker、链接、配置或依赖。

2026-09-12 T-19真实降级/升级矩阵映射：AC-10/11 + D11 → 在同一repo-local test vault与
同一Chromium origin先由当前HEAD打开合法v3治理库并冻结DB version、各store记录与
commitSequence；再部署真实旧基线`c923ee2`（2.9.2、逻辑/IDB v2）并重载，执行普通
settings保存、治理读取/确认/恢复尝试及独立legacy Profile读取，最后重新部署当前HEAD重载 →
Obsidian CLI/runtime eval、IndexedDB逐store快照及新旧bundle identity；旧版不得清空、降级或
覆盖v3库，治理读取/确认/恢复失败关闭，普通data.json保存和独立旧Profile边界按旧版真实行为
记录，升级后v3 store内容/身份恢复且原笔记不变 → current→old→current每段均核对plugin状态、
DB/version/store快照与fresh console；任何persistence版本/open/bootstrap/save/Profile路由或
部署asset变化须重跑。该矩阵不发送provider请求、不将eval冒充可见UI，不修改非test vault；
若旧bundle无法在当前Obsidian加载则记真实兼容FAIL并保留库，不改旧代码掩盖。

T-19真实矩阵结果：[脱敏逐store证据](./evidence/2026-09-12-d11-real-downgrade-matrix.json)绑定
当前提交`0bbe12b`/bundle `0fb0aba1…d684`与真实旧提交`c923ee2`/bundle
`3ac6e826…3740`。当前host以真实Chat History来源和合法32位十六进制Profile identity准入
`b135-chat-semantic-v1`候选，schema3基准全库摘要`2da10d03…b3a2`。加载旧2.9.2后
bootstrap以`MemoryGovernancePersistenceError`失败，治理repository/coordinator/Profile worker及
Forget/Profile/GC恢复timer均未启动；治理UI为unavailable，Queue确认失败。旧版普通
`saveSettings`的真实`saveSettingsData`调用为1，data.json和settings摘要稳定；独立legacy Profile
reader仍为ready且可按旧版投影legacy背景，不等于读取被拒绝的治理库。旧版操作前后DB version 3、
13个store的count/digest及全库摘要完全一致，fresh errors为0。

重新部署当前bundle后bootstrap恢复ready，除`meta.commitSequence`按当前启动记账117→123外，
12个业务store逐项count/digest完全一致；单独current→current重载同样只推进meta，证明不是旧版
改写。持久Queue的ID、profile ID、receipt rule及receipt source identity恢复；实际确认后Queue为
applied，创建claim、revision、governed Profile link和Profile行，正文/identity精确一致，receipt
仍在revision且真实来源会话仍有1个turn。探针初次错误要求持久记录保留临时
`chatSemanticEvidence`，核对契约后改从receipt sources验证；另一次非十六进制合成Profile ID被
store规范化，按真实producer格式修正而未改生产代码或放宽断言。所有自建claim/Queue/Profile/
会话及vault脚本随后精确清理，active conversation恢复；前后Markdown树SHA-256均为
`bf7d823d…e5ca`，debug/mobile关闭。该证据关闭D11真实降级/升级矩阵缺口，不证明native作品、
图片/版本reader、可见full-ui或iOS，T-19仍为部分完成。

2026-09-12 T-18跨重载来源重验映射：AC-06/08/09/11 + D13 → recovery带
`GenerationInputSnapshot`时以该快照为完整生成输入目录，不再从助手run末metadata补来源；逐项
核对task用途/边界/已知stat、Personal确切claim+revision、Insights当前开关与来源、授权style
revision、完整图片集合、parent正文hash及Pagelet pipeline/文件stat，未知身份仍由既有明确
确认覆盖但已知关闭、删除、修改、Forget/暂停/替换不得覆盖 → 最终只用B但metadata含A+B、
历史来源只在快照、同路径不同用途、图片/parent字段不一致、Memory/Web/Insights/style/
Pagelet撤销及等待期间变化回归；Chat重载确认与最终store guard保持 → 有效或记录不足且确认后
可成版，任何已知失效零新版本/ownership，零provider/学习调用。generation schema、来源治理、
style/Pagelet验证、History/recovery或最终写门变化须复跑；旧无快照record继续走D13 legacy
重验，旧插件降级→保存→升级矩阵和真实App/device仍独立跟踪。

本片结果：带快照的恢复完全以最后物理请求目录为准，逐条核验task、Personal、Insights、
style、图片、parent与Pagelet，不再合并run末metadata。task kind/boundary组合由严格reader校验；
Markdown来源重读正文和当前边界，真实`read_canvas_summary`以Canvas文件身份/stat/共享边界校验，
且不能用伪造Memory组合绕过Memory开关。同路径不同用途分别保留guard。Personal确切
claim/revision每次检查治理cache已追上最新commit sequence，Pause/Forget已提交但刷新未完成时
最终写入失败关闭；关闭新提取不撤销仍有效的既有Personal。未知Insights不再把冷重载尚未发布
的当前聚合receipt误作旧身份，只约束当前Memory/提取/确认/include、治理模式、vault scope与
Data Boundary，仍须D13明确确认。Pagelet逐一读取当前Markdown正文并在最终store前按当前规则
复验；正文标签新进入排除、stat/文件身份/pipeline或总开关变化均拒绝。完整快照身份不显示
“旧来源记录不完整”；未知身份确认只允许AI草稿恢复，不能覆盖任何已知失效检查。

验证：核心generation/recovery/style/Chat 4 suites/330 tests PASS（3.187s）；宿主集成最终基线
1 suite/397 tests PASS（22.707s），末次Canvas Memory边界收窄后定向1 test PASS（4.382s）；
WritingVersion/History memory+IndexedDB/conversation/task-source 5 suites/147 tests PASS（1.422s）。
`npx tsc -noEmit -skipLibCheck`、完整`npm run lint`、diff与社区DOM扫描通过。独立只读审查先发现
并驱动修正Personal提交竞态、Canvas兼容、Insights冷重载、Pagelet正文边界及Canvas/Memory
错配，最终复核无剩余P0–P2。旧无快照记录继续legacy D13路径；真实旧插件降级→普通保存→
升级、build/full tests、provider、Desktop full-ui及iOS不属于本片证据，T-18/T-19仍不标完成。

2026-09-12 T-18持久格式首片映射：AC-06/08/09/11 → 将上一片已冻结的
`GenerationInputSnapshot`作为WritingVersion与ChatWritingRecovery的可选本地字段，先补严格
clone/reader再接writer；旧无字段记录仍按原格式读取，不批量迁移。自动成版及recovery的
legacy `backgroundSourceRefs`只从最终快照与可见host source交集生成，不再使用run末union →
snapshot非法shape/正文型字段/过量数组、旧版本/旧recovery、artifact与recovery实际
Chat→manager→store→reload、同路径不同用途及A/B收窄回归 → 新记录准确保留最后物理请求
身份，旧记录不伪造完整性，未知字段不能绕过边界；generation schema、History clone、
WritingVersion create/edit、Chat finalize或source映射变化须复跑。随后独立接入跨重载逐项来源
重验及最终store guard；本片不把可读/可持久化当来源有效，旧插件真实降级/升级矩阵仍保留。

本片结果：`GenerationInputSnapshot`已有严格、有界、无正文字段的本地reader，校验task状态
一致性、http(s) URL、父版SHA-256、图片ref及Personal/style非空身份；WritingVersion与
ChatWritingRecovery均在排队前、store读写及manager重载时深克隆。Chat的artifact/recovery
实际writer保存快照；存在快照时旧`backgroundSourceRefs`只取快照任务来源与本轮可见host
记录的交集，A+B取材后最终只用B的回归不再写入A。旧无字段版本/recovery仍可读，不伪造
完整身份。聚焦6 suites/368 tests PASS（3.311s，自然exit0），tsc、全量source lint、
docs:check、diff及社区DOM源扫描通过；独立只读复核无新增P0–P2。明确保留三项边界：
跨重载recovery helper尚未按快照逐项重验，旧插件严格version reader/旧recovery白名单尚未
完成真实降级→保存→升级矩阵，历史来源只在快照及同路径不同用途的恢复准入反例随下一片
验证；本片无build、provider或App/device证据，T-18/T-19不标完成。

2026-09-12 T-18物理生成输入快照首片映射：AC-04/06/08/09 → `prepareProviderInput`
按最终投影构造有界、无正文的`GenerationInputSnapshot`，显式记录任务来源用途与
文件revision、Personal/Insights的`none/identified/unknown`、实际风格revision、完整
图片SHA-256 identity、parent正文SHA-256及Pagelet原契约未声明算法的backing hash；仅由`onProviderRequestStart`选择实际派发
版本，经bridge同时透传作品与恢复事件 → TaskSourceRun同路径不同用途/未知revision、
runtime多次准备但未派发/物理重试/空图片与无parent、governed与legacy背景三态、bridge
克隆隔离测试；focused suites、tsc、lint、diff及社区DOM扫描 → 事件快照只对应最后一次
真实物理生成请求，未发送的prepare和run末来源union均不能覆盖，未知不冒充可跨重载
核验。来源registry、provider start hook、背景selector、图片/parent/style或bridge事件变化
须复跑；新增持久字段、旧reader兼容、异步重验及最终store事务留在T-18后续片，不以本片
关闭跨重载恢复或阶段门。

实现结果：Context投影额外保留仅宿主可见的实际tool observations和history依据；语义摘要按
结构化source index映射回当前完整历史对象，不能使用会丢metadata的摘要缓存对象。task快照
只枚举最终投影内的来源；旧非canonical助手正文或已知取材工具观察缺来源记录时为`unknown`，
当前完整canonical空回执、纯用户输入及status-only观察才可为`none`。文件仅记录本进程
path/mtime/size revision，Web、skill及不能稳定识别者保持`unknown`。父版按实际投影入口记录：
native选中的parent优先，只有hostless路径才回退legacy `writingContext`；native显式选新话题
不会复活旧父版。图片记录完整选中关联列表，Personal只记录实际采用claim/revision，Insights与
Pagelet缺少可跨重载发布身份时不冒充已核验。快照保持非模型输入、非诊断输出，经bridge深拷贝
到artifact/recovery及Chat turn；当前仍未写入版本或恢复持久格式。

冻结验证：`task-source-run`、Context投影/摘要、stream bridge、writing runtime、B-129实际SDK及
ChatView共7 suites/500 tests PASS（6.025s）；`plugin-record-note` 1 suite/391 tests PASS
（26.032s），均自然exit0。`npx tsc -noEmit -skipLibCheck`、完整`npm run lint`、
`git diff --check`通过；社区DOM扫描无匹配，exit1按契约为PASS。独立只读复核先发现并驱动修正
3项P2：摘要缓存来源metadata丢失、legacy父版漏记、缺记录误标none；复核后再发现native
`parentHandle:null`可能错误回退旧父版，新增反例修正后确认全部关闭且无新增P2+。本证据不包含
`docs:check`通过（206 Markdown/1818链接，4条既有advisory），文档契约2 suites/58 tests
PASS（5.996s）。本证据不包含持久schema、跨重载重验、底层最终写入、完整build/full tests或
App/device门，T-18及阶段状态保持部分完成。

2026-09-12 F-21/F-22收敛：DeepSeek[首次结果](evidence/2026-09-12-deepseek-initial.json)及[真实SDK拒绝前帧](evidence/2026-09-12-deepseek-native-raw.json)区分两问题。第一次观察hook被LangChain withConfig克隆及pipe.transform绕过，未作为raw证据；修正为克隆模型generator后抓到合法header后`id:""/index:0/args:"{"`，collector误拒绝导致停止，后续finish未知不是provider自行结束。来源状态片RED为3失败/63通过（报告证明失败，shell外层因读日志为0），GREEN4 suites/103 tests自然PASS（2.145s）；身份片RED1失败/75通过自然exit1，GREEN3 suites/123 tests自然PASS（1.502s），含同index续帧、反例及adapter→loop→bridge。独立只读审查无可确认P1/P2。

冻结本片756个source/test/script/config/dependency文件，前后hash相同；tsc、完整lint/build、DOM扫描/diff自然通过；完整275 suites/7577 tests PASS（297.5s）。Jest报告延迟退出提示后，同一session继续等待最终自然exit0，无forceExit或重启。新构建及test部署SHA256均`208ae6fcdbe972a61f2e7276b198aab6d20b954cdeb67984c5e6d1a2f653b914`，deploy-current校验身份后复制、实际Obsidian重载。此后仅证据/文档变化，源测试输入未再改变。

[修复后真实DeepSeek结果](evidence/2026-09-12-deepseek-post-fix.json)及[可复现探针](evidence/2026-09-12-deepseek-probe.js)：Owner指定同百炼网关deepseek-v4-pro，0.8/thinking=true，禁止笔记/Memory/网页/历史/动作。native2请求/1准备、377个SDK generation帧、唯一artifact、真实tool_calls；旧协议2请求（一次声明）/0准备、408帧、唯一artifact、真实stop。两者provider参数/JSON正文到artifact字符精确一致，无后置ack，无禁止调用；一次样例不证明重复声明永远消失或比较成本因果。native将中文弯引号改为ASCII直引号，用户原文等式仍FAIL；旧协议该次等式PASS，记F-23而不套用D14宣称该新差异已获质量豁免。SDK帧不等于完整HTTP/实际UI；未经过ChatView/版本保存，full-ui/iOS仍NOT TESTED。句柄已清理，真实设置仍Qwen qwen3.8-max/default legacy。

Qwen证据复用审计：9月10日runtime记录hash精确匹配`148d7e3`；该提交到本片之前的runtime仅来源receipt/guard/event传递变化，schema、decoder、preview、loop、factory/fetch及SDK lock未变。历史Qwen接受schema/tool_calls及参数回放结论可复用，来源新增由专门测试与本轮实际artifact补证，不为统一日志形式重跑模型。本片collector兼容及scope指导已有定向/完整门，后续Qwen组合App验证仍按自己的范围验收。

2026-09-12来源后续只读收敛：T-18不能把结束时累计hostSourceRecords当成最后物理生成来源。下一实现先补内存中的有界类型化事实（实际用途/明确算法hash、style revisions、完整images、parent identity、实际Personal/Insights使用三态），由prepareProviderInput形成、physical-start选择，经bridge透传；不从父版或当前selector倒推。旧WritingVersion严格schema会拒新增顶层字段；旧cloneWritingRecovery白名单会丢新字段，须先reader对照再writer。Insights实际还读metadata tags、resolved/unresolved links及可选semantic clusters，仅存文件stat不足。该结论未批准新持久代次/通用receipt库，完整跨重载语义设计与必要产品判断仍由T-18承担，当前F-21/F-22冻结验证期间不并行改这些源码。

2026-09-12 T-03/T-17 DeepSeek空ID增量映射：AC-06/07/14 → 实际SDK首帧有合法id/index/name，下一参数帧保留index但id/name为空字符串；NativeWritingCallCollector把该空id当非法身份而提前拒绝，截断读取造成后续finish未知 → 以捕获形状先RED；只在已经建立的同一index续帧中将空id视为省略，不凭空建立身份、不放行换index/换id/混批 → collector与adapter→loop→bridge定向正反例、独立审查、静态和必要构建/App复验；保留原始失败帧，不以修复代码当真实模型通过。此修复不影响来源声明状态片的文件所有权。

2026-09-12 T-12/T-14来源声明状态映射：AC-01/02/03 → DeepSeek旧协议三次相同declare反例后，源码确认TaskSourceRun每次只注入首次声明指导，没有呈现已接受状态 → 以当前实际provider输入先RED，未声明且不读取新材料可直接交付，已声明时说明沿用当前边界，真实用户更正/范围变化仍能重声明 → 状态指导和scope/批次准入回归、独立审查、类型/静态检查；不做字符串去重、不放宽来源门或延长期限。模型重复原因可能不止一个，源码修复不冒充真实模型行为已通过。

2026-09-12第二模型验证映射：AC-06/07/14 → Owner指定同一密钥/服务地址，模型改为`deepseek-v4-pro`；仅隔离host改名，真实Chat设置不变，源码已列为受支持native模型 → 明确正文范围的native/旧协议最小对照，保留0.8/thinking并在实际bindTools返回runnable.stream抓取SDK参数/finish帧 → 唯一artifact、正文等式、完成证据、物理调用数/准备数；相同禁止笔记/Memory/网页/动作/历史边界 → gateway仍是百炼兼容配置，此证据不冒充另一HTTP网关/设备。模型/SDK/schema/finish相关输入变化重验；无效模型请求先分类环境，不靠改生产准入强行通过。

2026-09-12 D14文档与证据验证：docs:check通过（206 Markdown/1814链接，4条既有advisory），文档契约2 suites/58 tests PASS（5.899s，自然exit0），探针JS语法、四案证据结构/字符等式及diff检查通过。独立只读审计确认T-03/T-05/T-07部分旧待办措辞已被现有实现/回放覆盖，任务行已改写为实际剩余环境门，状态仍为部分完成。

2026-09-12 T-03/F-20验证映射：AC-06/07/14 → 复用已验部署的真实ChatService/runtime和当前Qwen配置，以无笔记/背景/网页/历史的合成输入比较原逐字任务、明确正文分隔的native任务及同输入旧协议 → 记录实际温度/thinking、物理请求数、原始输出参数/finish与正文字符等式；每案最多3次物理请求，连续同因失败不盲重试 → 区分模型生成质量与传输保真，明确边界案例不能覆盖或抹去原失败；只作诊断不默认切换native。模型/schema/prompt/runtime/构建变化使相关证据失效；不因探针或证据文档重复全量运行门。

同日[四案结果](evidence/2026-09-12-verbatim-comparison.json)与[三案原探针](evidence/2026-09-12-verbatim-probe.js)：Qwen qwen3.8-max、0.8、thinking=true，源码`a9196de`，生产与test部署均`5f8fda2cf69480e9fed9f5571222e61ce9e0a8b607eb0ed2aab7d190a9161661`。原提示native和旧协议均丢失同样的行标签/引号；明确正文分隔后两者均精确相等。每案一个artifact，native各2物理请求/1准备，旧协议各1请求/0准备，均自然完成，无触发禁止的读写/Memory调用。第四案以同一探针仅替换循环为`[{ name: 'original-legacy', prompt: original, native: false }]`，先保存前三案后运行，不重跑已完成样例。不是质量通过率、成本优劣或版本保存证明。

证据限制与审查：原model实例的stream hook未被实际bound runnable调用，streams为空，本次**没有**留存raw参数、finish帧或每次HTTP输入；只以真实pre-dispatch计数、工厂参数及最终artifact字符等式判断。onChunk可能是snapshot，累加text不可用，结果中已去除。独立只读审查确认隔离成立；3次预算若触发只能算探针不足，本次均未触发。模型问题在两种协议同样出现是新证据，不能把原失败覆盖为PASS。Owner已明确答复“接受分开评估，F-20 继续跟踪（推荐）”，记为D14；F-20不再单独否决协议兼容性评估，仍保留质量失败与后续工作，其它门及default legacy保持。探针句柄已删除，真实ChatHost默认协议确认仍legacy；没有源码/测试/config/dependency变更，不重复上一恢复片已通过的全量门。

2026-09-12恢复映射：AC-06/08/11 + D13 → 在现有恢复窗口加入来源记录不足说明和提交确认；Chat强制确认后经宿主验证确实记录的笔记/完整图片快照及parent正文身份，再把同步来源guard连到最终写入门；不从父版倒推本次风格/材料，来源范围保留旧记录不确定性 → 同页面有效/失效、真实history序列化重开后的确认/取消/编辑、已知撤销、异步准备后撤销和会话变化、旧记录无新字段回归 → 聚焦Chat/host/store tests、类型/静态检查和独立审查；必要冻结构建与App验证，检查输入变化使对应证据失效。工作树临时目录已被外部清理，已从保留的同一分支`21a5736`恢复，未重建分支或改动main工作树；重新链接同一已安装依赖，旧构建及临时日志不作为当前证据。

本片审查/修复：父版正文并不代表重新选择其全部图片/背景/风格，移除错误的父来源union；真实正文标签与陈旧metadata的晚到排除反例先RED，再补最终正文边界重验。旧来源范围经临时host参数保留既有undefined referenceScope，原样/局部编辑/后续编辑均不升级为request归属，不新增持久字段。无类型旧路径不能一律按Memory处理：沿用同条助手消息的已存metadata及material/statusOnly/sourceDependency/fallback规则，明确Memory才加主开关和专用路径排除，共享Data Boundary继续适用于全部笔记；6个用途反例先RED后GREEN。关闭Chat发生在异步prepare期间的真实反例先RED，最终store guard增加视图会话检查。独立最终复核无剩余具体P1/P2；尚未解决的完整持久生成来源身份不因此消失。

验证：Chat/versions/会话准入3 suites/287 tests PASS（3.969s）；宿主/helper 2 suites/406 tests PASS（23.773s），均自然exit0。类型检查发现测试mock可选参数/合法kind/fixture存在性未正确声明，按真实接口修正后生产build自然通过；没有改运行时迎合fixture或放宽断言。已有材料持久化测试一次固定flush轮数早读，改为等待实际append完成。最终冻结完整repo输入hash `f2290ef4791c81b5479d2c214156c14c070f0c62c39f7132223f2bc0c53e6dd9`（1242 files），统一lint/build/test:all全部自然通过，275 suites/7570 tests、328.043s、exit0；结束后输入与构建hash逐一核对未变。随后仅补文档/验证记录，不改runtime/tests/fixtures/config/deps；docs和DOM源扫描/diff检查分别通过。

[App结果与构建身份](evidence/2026-09-12-recovery-app.json)、[可复现的Obsidian eval探针](evidence/2026-09-12-recovery-app-probe.js)：Obsidian1.14.1/installer1.11.7，复用已验构建经deploy-current helper部署实际test库。独立真实IDB、真实Chat恢复窗口和宿主：只打开/选择零版本，确认后AI版本正文等于textarea提交值（HTML textarea按浏览器规则CRLF→LF，旧recovery原文CRLF保留）；referenceScope仍未知；缺失来源零版本。provider/学习均零调用。首探针未持有异步结果句柄且误找当前版本不存在的关闭图标；第二次将删除等待误判失败，均核对旧数据库/合成窗口已清理后才重试。最终显式句柄state=done、等待onClose及delete成功，数据库删除、无遗留窗口，原视图与factory恢复；debug/mobile关闭。干净错误采集无异常，console只有缺来源反例的预期Writing source unavailable拒绝。当前工具无原生窗口交互能力，full-ui/iOS仍NOT TESTED，不能记阶段退出PASS。

2026-09-10再次暂停交接：Owner明确“达到weekly limit，完成当前运行的任务之后提交commit，然后暂停goal”。当前T-18重载恢复片仅完成只读调查，未修改runtime/tests或持久格式；本次只提交此Tracker检查点。上一片代码和验证已随`02b5092`、`aa16fc4`、`fd3ceae`、`34133c9`提交并推送统一分支。所有子审查均已结束，不启动后续开发、provider调用或广泛测试；任务计数保持2 done/19 partial/1 pending，B-135不标完成。Goal暂停为执行控制请求，不把未完成目标伪标complete或blocked。

T-18重载恢复调查（输入`34133c968a10abfcb17d6ad93b6a55bb03592993`）：同页面WeakMap来源闭包不会持久化，重载缺失闭包时当前恢复路径没有等价来源重验。旧`ChatWritingRecovery`仅有正文、parent/scene及有限background refs，没有实际生成时的完整Personal/style/Insights身份；store的`cloneWritingRecovery`显式字段白名单也会剥离未知增量，新增字段不能直接宣称降级保存保真。可复用精确claim/revision、style授权与笔记hash，但style详情读取允许paused，不能直接当成版准入；Governed Undo可恢复原身份且事件保留7天，legacy同文同ID可重建，Insights没有持久发布身份，现有记录不能永久证明生成后从未撤销。该调查不批准新增持久代次或通用receipt库。恢复时先决D13，再设计实际物理请求来源记录与异步重验后的同步最终写入guard，并验证旧reader；保持AC-06来源有效与AC-11旧恢复兼容约束，不以当前selector或相同正文猜测历史来源。

2026-09-10恢复后的T-18准入映射：AC-04/07/08/11 → 在实际生成请求绑定纯来源receipt，贯穿bridge作品/恢复事件、版本队列和底层store实际写入前；独立检查实际材料/parent/style/Personal/历史，正常run清理不撤销来源，会话代次继续单独验证 → 图片/风格/父版cleanup后有效与撤销反例、Personal关闭新提取仍有效及Forget同文重建、真实runtime事件到Chat持久化队列、同页面人工恢复及底层异步窗口反例 → 有效内容正常成版、晚到撤销零新版本/图片ownership，已经提交的结果真实保留（进入异步put函数不等于已提交）；receipt不进模型或IDB、图片lease释放 → 聚焦tests/类型/独立review后再冻结统一门，source/session/bridge/storage变化使对应证据失效。重载后人工恢复的持久来源重验与完整App/device验收仍单独跟踪。

本片review/fix：独立复核发现无关Memory提交导致旧凭据误失效，已改为实际claim/revision/关联治理身份及新增事件，真实Pause→Resume同文不复活，过期历史清理不误拒绝；底层store在异步hash/parent/asset读取后缺准入的3个反例先RED，现传入同步guard并在IndexedDB事务内失败回滚。对应store/version 2 suites/51 tests自然PASS（1.191s）。同页面人工恢复以WeakMap保留生成凭据，正/反两例确认流结束后有效成版、撤销零成版且history无函数；Chat/native bridge/context runtime 3 suites/287 tests自然PASS（4.671s），补真实runtime不完整输出cleanup后有效/撤销反例后runtime 14/14 PASS（1.668s）。这批source证据不等于App验证。

Insights来源组合：scheduler只向宿主发布临时sourcePaths及同步验证闭包，不建正文cache或持久epoch；普通dispose保留已有作品凭据，新snapshot/明确Memory或Insights关闭/源对象或stat/边界变化撤销，owner防旧scheduler迟到覆盖。分析前捕获全部eligible Markdown，发布前重验；每次校验O(n)身份/stat、不读正文或全库JSON。新请求保持原scheduler注入政策，不从该凭据重新发送背景。独立review确认Pagelet self-write shortcut会漏掉分析期间新增文件，统一门在build阶段主动中止exit130后修复：四类vault事件在shortcut前单独失效、零额外调度；另补运行中和停止后的folder rename引入新合规后代，空目录保持有效。真实Pagelet create/同stat modify及停止后folder rename均有RED→GREEN；两suite424 PASS（23.778s），最后停止组合增量后相关23/23 PASS（3.209s）。源/测试已冻结，正在统一静态、构建、全量门；前次中止不记PASS。

完整基线门：platform guard与全源ESLint自然通过；build的TS2556/TS2345定位为新增store测试的union mock未完整声明可选参数，改成显式真实接口后独立tsc及生产build自然PASS（未改运行时/断言）。构建`16ab57b314686e4c3f834ff8b06fe37e5694f23d2a8dcf4dbeae234b272c386a`对应`npm run test:all -- --runInBand`274 suites/7529 tests PASS，340.476s自然exit0，运行期间源/测试/fixture/config/deps未变。

基线门后只读确认unused Insights P2：selector已省略过期/异常Insights、仍保留合法Personal时，host guard误绑未用Insights。最后窄修仅selector明确`usedVaultInsights`、compat透传及plugin按实际使用绑定，更新三份相关tests；三suite428 tests PASS（22.512s）。复验映射：相同source/fixture/config/deps的未受影响基线证据复用；Jest `--findRelatedTests src/plugin.ts src/pa/memory-use-projection.ts`列出的76套源码依赖图重验，两个变更源文件ESLint、生产build及全部artifact组重新执行。此前完整基线不标成窄修后的全量重跑，不关闭阶段或T-18。

本片最终证据：`npm test -- --runInBand --findRelatedTests src/plugin.ts src/pa/memory-use-projection.ts`76 suites/2746 tests PASS（59.514s，自然exit0）；`npm run build`自然PASS；`npm run test:artifacts -- --runInBand`2 suites/61 tests PASS（68.715s，自然exit0）。源扫描无runtime style/HTML注入匹配，diff检查PASS；docs:check为206 Markdown/1810链接及4条原有advisory。最后五文件窄修后没有其它source/test/fixture/config/dependency修改，不重复未受影响tooling门。

App-runtime：Obsidian 1.14.1（installer 1.11.7）、已核验vault `/mnt/code/personal-assistant/test`。从本worktree运行既有`deploy-current.mjs`向该test插件路径复制，部署guard验证当前产物身份，dist与部署main.js SHA256均为`9d020fca47f94ec19e8c51d3e1ddeb6283f3b07c6592963acb13b665106a49bb`，随后CLI重载。真实plugin WritingVersionService与原生IDBDatabase上分别在第3次（hash后）、第4次（事务最终put前）来源检查撤销，均拒绝且零版本；正向保存正文精确、回调未入记录、提交后撤销不改已成功结果。仅随机ID合成记录，finally按该ID清理并确认零残留；未发送模型请求或用户资料。Chat容器数1、无捕获errors/error console，debug与mobile模拟均已关闭。CLI初次沙箱内因应用日志只读失败，终止该失败进程后通过获准的沙箱外CLI完成；不冒充原失败为PASS。这是DOM/CLI app-runtime，来源治理到整个Chat及reload恢复的真实组合、full-ui/iOS仍待验收。

历史native回放边界修正：`b135-current-schema-trace.json`的真实提示早于上轮逐字指导，原始fixture保持不变；移除历史prompt必须与当前prompt逐字相同的错误身份断言，保留schema一致、实际delta解码、loop/preview和单一artifact断言。该回放仅证明历史响应可兼容解码，当前prompt的真实模型质量及F-20仍未通过；独立只读复核确认未将旧记录冒充新证据。

2026-09-10准备状态修复结果：[修复前循环及编辑保存](evidence/2026-09-10-native-context-loop-and-save.json)保留14请求/170140ms、12个不同scene、正文标签/引号丢失；实际版本面板手工编辑产生第二版及正确parent，预览后确认唯一合成笔记，正文/hash/user_edited provenance/完成receipt一致，模型请求保持14。[同输入修复后](evidence/2026-09-10-native-preparation-state.json)为2请求/57505ms、1准备、1作品版本，无后置ack；正文仍漏标签/引号，逐字FAIL不隐去，单样例不推断固定提速比例。隔离host禁笔记/网页/背景/提取，结果不覆盖Personal/style/图片组合；视图与服务已释放，用户原视图恢复，合成笔记保留为回执。

状态提示先以实际runtime provider输入断言RED，再按有效receipt切换已准备/需准备指导；保留父候选目录和get_writing_context可用性，不模糊scene去重、不放宽来源/权限。逐字指导补充标签/引号仍未使上述模型样例通过。最终6 suites/104 tests自然PASS（2.455s），生产build（含tsc）、三源文件ESLint、diff自然exit0；独立只读复核无新增具体P1/P2。当前构建与test部署hash均为`1e474479ad21079d7f188b8ae2e8fed50da012998ad8ab7420812f34c2e5d8ed`。此次不重复完整273套门，不将前次全门当最新提示的完整重跑，也不关闭T-03/T-16/T-18/T-20或任何阶段。

2026-09-10 T-16/T-20准备状态提示映射：同一自然语言案例已能接收object scene并成版，但14次物理请求/170140ms，12次不同措辞scene均真实重准备，随后deadline预留轮成版；输出还删除原文行标签/中文引号，不计精确复写PASS。AC-08/12 → runtime按当前有效receipt报告已准备/未准备，禁止将同义改写当新的准备理由，同时保留真实改选与失效重准备 → 实际provider输入状态断言先RED、A→B→A/撤销/失败聚焦回归及同案例App复验 → 有效时不再无条件要求先准备，权限和工具可用性不变；prompt/receipt失效逻辑变化复验。手工编辑及唯一合成笔记保存已完成、正文与receipt核对一致，零额外模型请求；这是DOM驱动app-runtime，不是full-ui或整个T-18通过。

2026-09-10场景协议诊断：[相同自然语言复验](evidence/2026-09-10-native-natural-language-repair-failure.json)3次物理请求/69549ms，两次scene参数仍为字符串，零version；绑定schema已直接留证为object/null，未观察到本地改为string。按同因第二次失败原则停止重复原探针。[最小固定参数对照](evidence/2026-09-10-scene-schema-comparison.json)同模型/temp0.8/maxTokens1200/同prompt：anyOf联合2970ms、type数组联合3093ms均返回string，普通object3604ms返回object，各1次请求；不据单次推断速度/费用或所有Qwen模型兼容。模型侧改可选object，未知省略；宿主继续兼容null并canonical归一未知，strict拒绝字符串/缺字段/多字段，parentnull不变，不改产品能力或额外授权。独立复核确认此为未启用工具的兼容表达修复，真实生产prompt仍须复验。官方[工具调用说明](https://help.aliyun.com/zh/model-studio/qwen-function-calling)用于核对工具声明与参数解码方式，不作为联合类型支持或本地实现正确性的证明。

2026-09-10自然语言修复冻结门：首轮[真实ChatView失败样例](evidence/2026-09-10-native-natural-language-failure.json)已持久保留。schema纠正链RED确认原runtime仅2轮且没有作品；修复后真实runtime scope成功+scene字符串拒绝→object纠正→唯一作品通过，重复错误只给一次特殊纠正、legacy/权限拒绝/混合失败不重开。真实dispatcher A→B→A、首次准备失败、风格失效三例RED；修复后当前有效同参不重复，回选/失效/prepare或onPrepared失败可重做，普通tool去重保留。完整runtime A→scene B→A亦通过。独立复核无具体P1/P2。最终7 suites/115 tests（2.649s）及独立6 suites/136 tests（2.306s）自然通过；TypeScript初次发现可选run闭包收窄问题，改为绑定已存在实例后通过，未弱化断言。

冻结source/tests/config/dependencies后`npm run lint`通过，`npm run build && npm run test:all -- --runInBand`自然exit0：273 suites/7432 tests全部PASS，Jest报告312.658s。末尾有一次短暂open-handles提示，随后自然退出，未forceExit/kill。构建与实际test库部署main.js SHA256均为`9f3dccca0019cfeee3e46e5cf9a5a4d4fbdcfe2d37a58ec7ebcb76ef538ad62d`；使用deploy-current复用上述门并重载。App自然语言复验随后记录，源码通过不等于默认切换或App/device已验收。

2026-09-10 T-03/T-16/T-20自然语言App反例与修复映射：当前冻结构建`230ea4fe8b9e92330297f7c90fb2c1586865f7e529b4a2e636759e0033c45161`部署重载后，真实ChatView/ChatService/Qwen/独立IDB合成案例（禁笔记/网页/背景/提取，宿主仅显式native）不点名工具步骤，模型把scene传为JSON字符串，strict校验拒绝；host随后final-only，2物理请求/22279ms，普通文字入Chat但零作品版本。该失败保留，不以先前指定步骤样例宣称自然语义通过。改动映射：AC-06/08/12 → 场景schema/guidance保持真实object或null；对已由模型选择的native上下文仅允许一次schema纠正，继续原权限/来源/总预算，失败不能宣称成版；必要的A→B→A重准备不能永久seen去重 → 实际runtime错误参数→纠正→唯一作品、重复错误有界、dispatcher当前receipt有效重复跳过/失效回选重做、真实同案例复验 → 聚焦source/类型/审查后冻结构建复验，不扩大其他工具重试或接受string充当scene。当前环境无可用原生UI交互工具，DOM驱动仅记app-runtime，不记full-ui；原会话保留，隔离tab已detach，原factory已恢复。

2026-09-10 T-18会话成版准入：新增真实manager/store反例首轮6项中5项RED，确认reset/同ID重开/切换期间等待manager仍写入、恢复prepare期间重开仍附版，以及旧写入改变另一会话cursor。复用已有entry WeakMap身份并绑定manager，在排队及各异步准备返回后重验；WritingVersion.create接受不持久化的宿主guard，最终lookup之后put之前再次检查，Chat两条自动/人工成版入口传递guard并保护选版状态。已开始put保留真实完成结果。独立复核新增P1同ID重开覆盖旧index0，专门RED确认后修复：同manager+同会话才单调同步已提交索引及turnCount，不覆盖新hydrate其它metadata，不影响另一会话；复核无剩余具体P1/P2。

该片最终`npm test -- --runInBand __tests__/conversation-writing-admission.test.ts __tests__/conversation-persistence.test.ts __tests__/writing-versions.test.ts __tests__/chat-view.test.ts`4 suites/284 tests PASS（2.629s，自然exit0）；随后tsc、三个变更源文件ESLint及diff自然exit0。真实App尚未重新部署本片，之前构建证据不能证明新增异步准入行为；完整来源/治理到最终成版及App/device门仍待验证，T-18不标完成。

2026-09-10 T-04/T-19实际发布reader边界：[原始报告、输入hash与复现脚本](evidence/2026-09-10-published-reader.json)隔离提取tag `2.9.2`（commit `22c192b84ebdeb14e3808f57a63da0a7d4efbca7`）真实旧源码，以fake-indexeddb 6.2.4执行版本准入；旧IDB v1打开当前v2得到VersionError，旧版不存在作品/图片/SaveReceipt APIs，独立旧内存投影仅留正文并丢弃新metadata。当前reader重新打开后turn/version/recovery scene/image/receipt深等保持；旧v1文字升级v2保留。probe自然exit0断言的是上述不兼容边界，不是降级兼容PASS；没有真实App降级/升级，也不将该既有schema能力差异归因于本轮scene增量。依Plan保留“不宣称可降级”的边界，T-04/T-19整体门仍未通过。证据绑定本轮会话准入修复前WritingVersionService hash；此后create可选宿主准入参数不改变该样例默认路径或存储格式，兼容结论按上述输入范围保留。

2026-09-10 T-18异步成版准入映射：AC-07/08/11 → 用已有会话entry索引的身份捕获持久化会话代次，队列/manager准备/版本准备后重验；版本服务在最终异步读取后、put前验证宿主准入，已开始put允许如实完成 → reset或重新hydrate同ID的ABA、等待队列/prepare后失效零新写入、已开始原会话写入不更新新会话状态、正常连续首轮及人工恢复回归 → ConversationPersistence/WritingVersion/Chat定向tests、tsc/lint/review；不新建锁或持久化epoch。source/治理到最终成版的完整凭据仍另需验收，本片先封闭会话写入准入。

2026-09-10冻结门与App协议证据：`npm run lint && npm run build && npm run test:all -- --runInBand`完成，lint/build通过（build含tsc）；全量Jest335.307s自然exit1，270 suites通过/1失败，7410 tests通过/1失败。唯一失败为旧pa-agent-stream-bridge断言期待source_changed仍保留rawText，与已确认撤销边界及前片修复不一致；改为强制rawText/preview清空，其他中断仍保留合法正文。仅该测试文件变化，`npm run test:all -- --runInBand __tests__/pa-agent-stream-bridge.test.ts`11 tests PASS（1.097s，自然exit0），全部已知失败关闭；未重跑完整命令，不混写为原命令PASS。源代码/其余tests/fixtures/config/dependencies在冻结门期间未改变，其余通过证据复用；DOM扫描无匹配（exit1），diff与docs通过。

App验证映射：当前runtime/interaction-state → 部署当前已验构建到CLI实际确认的`/mnt/code/personal-assistant/test`，重载并确认新接口已加载、native默认未开 → 只用合成文字且隔离笔记/画像/Memory/网页读取的真实ChatService+Qwen native样例 → 完整正文、动态句柄、provider完成、调用次数/重复步骤记录；不以CLI协议验证当可见UI或iOS验收。使用deploy-current底层同一身份校验脚本指定实际test库，避免错误复制到临时工作树test路径；dist/目标main.js SHA256均为`970133f248bc37a07ec505a1f2ab57885758898a598e3eb94ae00f98bb6dec92`。sandbox内Obsidian查询因桌面目录只读/GL失败已明确停止exit130；同一只读查询获自动审查允许后sandbox外自然通过，未把失败重启当成功。

[当前native上下文App证据](evidence/2026-09-10-native-context-app.json)：当前provider=qwen、model=qwen3.8-max，38,285ms；实际3次物理请求/3次model构造，第一次已准备成功，第二次重复提议相同scope/context，宿主去重且style准备仅1次；第三次present_writing完成后无ack请求，输出中文引号/换行/双空格/emoji逐字一致。T-20须分析重复准备，不能把3次记成理想2次或宣称成本改善。该合成协议样例无笔记/持久化写入，无可见UI交互或iOS证据，P0完整对照及默认切换仍未完成。

2026-09-10 T-16 runtime与Chat候选接通：get_writing_context按exact capability独立来源准入、sequential执行，run结束dispose并按实例注销；普通Chat在显式native宿主入口中可自行准备/交付。loop每轮与bridge每助手冻结handle，未准备不导出output，混批两种顺序零prepare；合法两轮工具→输出无ack。Chat候选来自当前UI允许版本及真实manager来源凭据，输出父版/scene取物理请求快照；新topic/unknown不回退本地infer，显式选版标记为候选数据。默认plugin未启用，P0未完成，不提前关闭T-16。

独立复核发现并修复：完整材料refs曾只影响关联、不排除provider旧pixels（P1）→成功准备后同步收窄selected/leases/guards，后续resolve在读取前拒绝排除refs；真实runtime A/B→仅B与空集的第二次provider图片块反例通过。预算P2经RED确认：600字符observation下较长父版曾被截断发送→准备额度受observation剩余量限制，最终实际投影缺失/摘要/截断完整canonical context时dispatch前拒绝；prepare后16k→600变化反例仅首轮实发，无artifact。人工恢复补scene持久化/reopen/create传递，旧无scene记录兼容，scene深拷贝与格式拒绝使用原版本schema。

统一门前定向证据：实际runtime/预算/图片/Chat/native四边界共8 suites/440 tests PASS（6.955s，自然exit0）；其后补了人工恢复scene断言和显式选版目录断言，store并行子片31 tests自然通过，最终输入以随后统一lint/build/test:all为准。首次Chat候选测试过早读到了前一stream，改等待实际stream调用；tsc指出测试缺LegacyAgentEvent import及零参数mock类型，已按实际签名修正。没有提高timeout或削弱产品断言。

2026-09-10 T-16实际runtime接线映射：AC-06/08/09 → native兼容候选中注册本run的get_writing_context，候选/语义style来自宿主，材料复用图片验证；准备前不授予作品输出，准备后绑定动态handle，answer/summary/物理SDK与最终作品共用receipt → 真实runtime两轮工具→输出、普通回答、未准备/混批拒绝、来源撤销及固定native/legacy回归 → focused runtime/loop/bridge/context测试、tsc、定向lint、独立复核。默认切换、ChatView候选及版本落库接线、完整图文用途和provider/App/device仍须单独验收；不以兼容候选通过宣布T-16完成。

2026-09-10 T-16材料图片host：ImageRequestScope.verifyWritingMaterials按本run注册身份验证完整refs（含空集），重复/未知/替换先拒绝，复用原service.verify的队列signal/currentness；验证结束重验全部receipt，返回有序元数据与同步来源闭包。关联10张材料不变成10张像素，不改变selected/associated，不调用resolveVariant。旧成功receipt不因另一操作取消失效，来源变更/dispose仍失效。独立只读复核无具体P1/P2；像素选择与runtime绑定仍未完成。

材料图片冻结验证：`npm test -- --runInBand __tests__/chat-image-assets.test.ts __tests__/b129-image-request.test.ts __tests__/writing-context-run.test.ts __tests__/writing-context-tool.test.ts`4 suites/110 tests PASS，3.654s自然exit0。真实图片队列扩展writing_materials入口，取消/请求stale/input改变均在readBinary前拒绝；其余原图片/保存回归同套通过。最终tsc、源文件定向ESLint及diff通过；docs:check通过206 Markdown/1802 links（4项既有episodic advisory），检查均自然exit0。无build/provider/App/device，不以验证关联声称像素已发送或工具生产可用，不关闭T-16。

2026-09-10 T-16图片验证host接缝：AC-08/09 → ImageRequestScope验证模型完整材料refs只接受本run登记身份、按原ImageAssetService.verify及队列guard验证、返回有序元数据/来源current回调 → 多于像素上限的关联材料不伪装为像素读取、unknown/ref替换零读取、晚到撤销/取消及普通prepare/resolve回归 → focused source tests/tsc/review；不改当前像素选择或把material关联说成已查看，完整用途和最终选择接线仍需后续。

2026-09-10 T-16 Chat宿主准备：ConversationPersistence.prepareWritingCandidates复用manager已有来源epoch，捕获活动会话和界面允许ID后逐个读取，跨会话/缺失不发布，异步前后与返回前重验。返回克隆候选及同步parent检查；真实manager/store/version→WritingContextRun组合证明删除开始即失效、删除等待/读取期间变更、会话重置/撤回候选/取消及输入克隆。ChatHost新增prepareWritingStyleForScene，直接复用现有cache刷新与WritingStyleService，旧prompt入口infer后转发，未新增模型调用。独立只读复核两部分均无具体P1/P2。仍待ChatView/runtime实际调用。

宿主准备冻结验证：`npm test -- --runInBand __tests__/writing-candidates.test.ts __tests__/conversation-persistence.test.ts __tests__/writing-context-run.test.ts __tests__/writing-context-tool.test.ts`4 suites/46 tests PASS，1.757s自然exit0；`npm test -- --runInBand __tests__/plugin-record-note.test.ts -t 'explicit writing style plugin gates'`8 tests PASS/359 skipped，3.7s自然exit0。真实createChatHost治理组合覆盖匹配/unknown/冲突/零预算/Forget和零模型调用，不将359 skipped当通过。三个变更源文件定向ESLint、diff通过；无build/provider/App/device，不关闭T-16。

Chat宿主片最终静态门：`npx tsc -noEmit -skipLibCheck`自然exit0；docs:check通过206 Markdown/1802链接、4条既有advisory；diff检查通过。未改DOM。

T-16语义风格host桥映射：同一准备任务还需允许主Agent解释scene → ChatHost.prepareWritingStyleForScene直接调用现有WritingStyleService.prepare，旧prompt入口转发保留兼容 → plugin真实治理fixture经实际createChatHost验证匹配、unknown、当前冲突、预算不足和Forget → 不另调用classifier、不绕过治理，不重写模型scene → focused plugin writing style gates/tsc；Chat/runtime消费随后接入。

2026-09-10 T-16 Chat候选宿主映射：AC-08/09 → ConversationPersistence以活动会话+界面允许version IDs+既有ChatHistoryManager.captureSourceLifetime建立候选，异步get前后核验；同步isParentCurrent检查同一会话/来源凭据/候选身份 → 真实manager/store/version服务组合，删除等待即失效、切换/选项撤回、跨会话和未知id、异步取消 → 定向tests/tsc/review；复用已有来源epoch，不另造持久化通知/缓存。runtime消费另接，不以此方法存在当生产工具可用。

2026-09-10 T-16上下文证据层：projectTranscript按完整canonical工具JSON与已发布receipt匹配，clone后验证并返回同一快照；失效工具内容清除prompt/preview/metadata，不改独立消息和原记录。captureTranscriptValidity捕获精确receipt，调用时同步检查当前run、父版host admission、材料/style及替换；host新增必需isParentCurrent，不以早期异步get成功代替。真实converter组合验证撤销/新handle替换/正文篡改及取消。独立审查发现仅匹配内层observation而转发完整外层的P2及等待期间原消息可变窗口，已改完整JSON核对和克隆；input/额外字段篡改及await时修改反例通过，复核关闭该P2。

证据层最终冻结：`npm test -- --runInBand __tests__/writing-context-run.test.ts __tests__/writing-context-tool.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-context-summary-projection.test.ts`4 suites/128 tests PASS，2.152s自然exit0。首次tsc指出新converter fixture缺toolCall.index，已补实际必需字段；两源文件定向ESLint自然exit0、diff通过。上述是helper+真实转换器和相关既有suite证据，尚未runtime注册或调用新投影/回调，不声称真实SDK重试或生产摘要已接通，不关闭T-16。

证据层最终静态门：补齐fixture后`npx tsc -noEmit -skipLibCheck`自然exit0；docs:check通过206 Markdown/1802链接、4条既有advisory；diff检查通过。无DOM变更。

2026-09-10 T-16上下文证据映射：AC-04/08/09 → WritingContextRun按已发布receipt精确验证实际canonical工具observation，失效清除prompt/preview/metadata；生成快照同步闭包检查receipt/材料/style/父版本host epoch → 真实工具转换器产物、撤销/替换/篡改/旧handle、独立会话保留、异步取消及重试前变更 → 定向tests/tsc/review；同步父版currentness必须由宿主实际会话/版本状态提供，不以早期get替代。尚未production注册，不以helper测试冒充runtime重试证据。

2026-09-10 T-16工具适配：新增严格schema及顺序执行capability工厂；仅接受语义parentHandle/scene/conflicts/完整refs，budget和权限留宿主。observation只投影parent正文/hash、材料和style，不输出版本完整记录。预算在prepare内扣结构/父文/材料，再调用style；最终JSON转义膨胀也检查，失败不发布新handle且保持旧成功context。不截断正文。首次adapter异常分支测试缺host.log，补齐真实host接口后通过，未调整生产错误处理。独立只读复核无具体P1/P2；生产注册和上下文来源重验仍未完成，sources空集不能被解释为无来源依赖。

工具适配最终冻结：`npm test -- --runInBand __tests__/writing-context-tool.test.ts __tests__/writing-context-run.test.ts __tests__/capability-registry.test.ts __tests__/chat-tools.test.ts __tests__/chat-writing-style-service.test.ts`5 suites/73 tests PASS，1.718s自然exit0。四个变更源文件定向ESLint自然exit0，diff检查通过。provider schema是适配器导出检查，无实际provider调用/生产运行时或App/device证据，不关闭T-16。

工具适配最终静态门：`npx tsc -noEmit -skipLibCheck`自然exit0；docs:check通过206 Markdown/1802链接、4条既有advisory；diff检查通过。无DOM变更。

2026-09-10 T-16工具入口映射：AC-08/09 → get_writing_context严格schema、host预算回调及上下文最小模型投影，复用ChatToolCapability adapter → 实际provider schema/prepareAndValidate/execute组合，拒绝伪造version/source/预算字段、输入复制、超预算无新handle、取消与失败保留旧context → 定向tests/tsc/lint/review；仅工具适配层，不将type/name登记当runtime生产注册或语义效果证明。预算先扣父版/图片/结构开销，再交给style服务，最终序列化大小超限拒绝，不截断已绑定正文。

2026-09-10 T-16宿主准备层：新增WritingContextRun，将当前会话候选克隆并映射run句柄；模型选择父句柄/scene/冲突/完整图片refs，host供应预算、versions.get、原图片验证和WritingStyleService.prepare。等待前复制输入，前后验证父版、图片及style；只发布最近成功context handle，旧异步prepare不能覆盖新结果，validate重验并克隆返回，dispose清理。新话题不携带parent，空图片不union父图。独立只读复核无具体P1/P2；本层尚未生产登记/接入，T-16仅部分实现，后续仍须主Agent语义质量和真实输入/输出组合证明。

准备层冻结测试：`npm test -- --runInBand __tests__/writing-context-run.test.ts __tests__/chat-writing-style-service.test.ts __tests__/writing-versions.test.ts`3 suites/45 tests PASS（1.379s，自然exit0）；随后只追加取消/会话在image等待后失效及验证结果偷偷补父图的测试，`npm test -- --runInBand __tests__/writing-context-run.test.ts`13 tests PASS（0.86s，自然exit0），另两套输入未变复用，合计覆盖48 tests。host使用真实版本服务验证hash；style在新组合测试中为受控替身，既有治理service suite独立通过，不冒充新工具已有真实治理端到端证据。无build/provider/App/device，不关闭P4。

T-16准备层最终静态门：追加测试后`npx tsc -noEmit -skipLibCheck`自然exit0；新源文件定向ESLint自然exit0；docs:check通过206 Markdown/1802链接、4条既有advisory，diff检查通过。未改变DOM。

2026-09-10 T-16准备层映射：AC-08/09 → per-run候选句柄与父版hash绑定、完整材料选择、既有style治理prepare、最近成功context handle及消费前重验 → 错误会话/未知句柄零读取、父版更改、异步撤销、风格冲突/预算、空材料、新话题及旧handle拒绝 → host准备层定向tests/tsc/lint/review；生产tool/runtime/Chat接线与真实语义质量另外验证，不以helper作为T-16完成。

2026-09-10版本关闭片：最后existing-version查找等待期间dispose的反例先RED（0.878s自然exit1），现于队列入口、get/list的store/hash等待后和最终existing查询后复验服务状态。已开始put仍等待并返回成功；未入场队列拒绝且零额外查询。独立只读复核未发现具体P1/P2，重复事件和冲突规则不变。首次已开始put测试误用对同一jest mock的bound调用造成递归，该运行主动终止exit130；改为fixture内实际Map存储后自然通过，未改运行时断言或延长timeout。

冻结验证：`npm test -- --runInBand __tests__/writing-versions.test.ts __tests__/writing-save-action.test.ts __tests__/writing-save-modal.test.ts __tests__/chat-view.test.ts`，4 suites/303 tests PASS，2.883s自然exit0。仅覆盖版本服务关闭及相关保存/Chat源码路径，未验证完整生成来源/session快照、provider或App/device；不关闭T-18或阶段门。

版本关闭片最终静态门：`npx tsc -noEmit -skipLibCheck`、`npx eslint src/chat/writing-versions.ts`自然exit0；docs:check通过206 Markdown/1802链接、4条既有advisory；diff检查通过。无DOM变更。

2026-09-10 T-18版本服务关闭映射：AC-08/11生命周期晚到 → dispose后不启动新版本存储、队列入场及异步查询后检查服务状态 → 延迟最后existing查找期间dispose的RED（仍put并返回成功）、已开始put允许自然完成及待排队零读取 → source tests/tsc/lint → 不追溯撤销已开始存储，不把关闭后的晚到查找变新写入 → version队列/store await/dispose变化复验。独立的source/session生成快照门仍待后续，不能以服务关闭门代替。

2026-09-10材料保存片实现：create以完整images快照为准，edit显式继承；Chat artifact/recovery采用宿主快照（含空集）并复制，旧事件缺字段保留原材料。手动恢复、失败继续、turn初始化和图片scope均尊重完整快照，失败材料优先父图但保留父正文/id/hash。本轮用户新附图片仍正常加入。两项版本子集/空集反例先RED；首次测试表格写法错误导致Jest把参数当done，修正fixture后才得到真实union错误，未计为产品证据。独立审查发现失败继续及parent二次union的P2，修复后复核关闭；三个生产create入口均核对，无新增具体P1/P2。

冻结验证：`npm test -- --runInBand __tests__/writing-versions.test.ts __tests__/chat-view.test.ts __tests__/writing-save-action.test.ts __tests__/writing-save-modal.test.ts __tests__/b129-image-request.test.ts __tests__/b129-multimodal-runtime.test.ts __tests__/pa-agent-writing-preview.test.ts`：共431 tests，组合6 suites PASS，Chat原有保存失败提示用例过早断言（9.307s自然exit1，不记整组PASS）。该用例改为等待实际recordTurn尝试，最终`npm test -- --runInBand __tests__/chat-view.test.ts`255 tests PASS，3.018s自然exit0；其余6套源/测试/配置/依赖未变复用。新增Chat用例也等待真实append完成，不增加固定timeout；覆盖空集成版、手动恢复、有parent失败继续、无parent附图失败继续及重开。scope空集/子集prepare只读取相应图片；原版及普通edit保留。三个变更源文件定向ESLint、diff及DOM检查通过。不代替完整语义排除、持久化队列currentness、真实provider/App/device，不关闭任务或阶段门。

材料保存片最终静态门：修正最后一项Chat fixture后，`npx tsc -noEmit -skipLibCheck`自然exit0；docs:check通过206 Markdown/1802链接、4条既有advisory，diff检查通过。测试修复仅等待实际存储调用，不改变产品断言或运行时代码。

2026-09-10 T-14/T-18材料保存映射：AC-08明确排除不被父版本union恢复 → 版本create使用调用方完整材料快照，手工edit显式继承；Chat接受宿主提供的材料快照（含空集），仅旧事件缺字段时保留legacy材料 → 版本子集/空集RED、Chat实际持久化与恢复/后续续写回归 → 不复活父图，原版和合法继承保留 → source snapshot、事件消费、恢复和版本create调用方变化复验。本片不代替T-16语义图片选择或完整生成用途快照。

2026-09-10 T-14/T-17成版接缝实现：每次实际answer物理发送绑定准备时的来源检查、材料lineage和style revision副本；preview/成版再检查笔记真实身份、范围、Memory控制、背景及历史。独立source lifetime不因执行取消而失效，保留普通取消的候选；来源撤销则两个协议都先拒绝、清空preview及recovery.rawText。真实SDK离线反例先RED：最终响应期间删除刚提供的笔记仍成版；修复后不成版且无可恢复正文。独立审查发现legacy恢复及cancel/incomplete分支能保留失效内容的P1，修复后native/legacy cancel-forget反例通过，复核确认P1关闭、指定改动无新增P1/P2。

本片冻结组合：`npm test -- --runInBand __tests__/b129-multimodal-runtime.test.ts __tests__/pa-agent-writing-preview.test.ts __tests__/pa-agent-loop.test.ts __tests__/task-source-run.test.ts __tests__/pa-agent-context-summarizer.test.ts __tests__/pa-agent-context-summary-projection.test.ts __tests__/pa-agent-runtime-chat-history.test.ts`：7 suites/311 tests PASS，4.301s自然exit0。三个变更源文件定向ESLint及diff检查自然exit0；DOM扫描无匹配。该回调保守检查已保留的工具/历史来源，尚非精确记录每项实际用途的完整GenerationInputSnapshot，也未处理父版本图片union及持久化队列，不关闭T-14/T-17或阶段门。

本片最终静态门：`npx tsc -noEmit -skipLibCheck`自然exit0；docs:check通过206 Markdown/1802链接，仅4条既有episodic advisory；diff检查通过。未执行build/full suite/provider/App/device，不将上述源测试升级为这些证据。

2026-09-10 T-14/T-17成版接缝映射：REQ/AC-04/06来源有效性 → 写作生成请求的实际dispatch冻结材料/风格及来源有效性回调，在preview/成版时重验 → 真实SDK取当前笔记后最终响应期间删除来源的RED反例（旧代码仍发writing-artifact），及取消/有效来源回归 → 失效不成版；取消不冒充来源撤销；失败保留原材料lineage → 来源生命周期/SDK回调/bridge变化复验。该片是生成请求与交付门的接线，不宣称已实现完整GenerationInputSnapshot用途、父版本/图片排除与版本队列边界。

2026-09-10 D12与聚合来源片：历史原文、摘要准备及物理发送共同按宿主metadata/真实文件身份/Memory主控制投影；保留用户与无撤销证据的legacy助手，排除已证明受影响的助手回复，原记录不写回。SDK429期间历史文本更正、Memory关闭分别覆盖answer与history-summary；旧payload阻断，新准备请求保留有效方案。helper验证下一run重新授权可恢复。审查发现canonical无boundary或statusOnly引用在快照降格时产生不一致，已统一readChatHistoryTurnMetadata及typed/path-only判定，禁止statusOnly凭path inventory提升为正文依赖。

标签聚合和反向链接在实际metadata读取处记录隐藏sourceDependency：标签含无标签、非representative及扫描上限内的实际文件；backlinks含负事实与显示截断外依赖。adapter保留依赖但不升级引用，SourceStore和压缩标记不展示它们，动态目录也不发布。真实runtime两种聚合先vault后仅B：撤回A聚合材料而保留独立B outline。定向测试另覆盖3005文件只记实际3000、79反链截断、provider/contextUsed/chips不泄漏。审查发现压缩marker绕过隐藏标记，已补过滤并通过实际microCompact回归；完整结构化结果按来源重建仍未关闭。

本片最终源码/测试/配置/依赖冻结：`npm test -- --runInBand __tests__/b129-multimodal-runtime.test.ts __tests__/task-source-run.test.ts __tests__/operations-agent-runtime.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-context-summarizer.test.ts __tests__/pa-agent-context-summary-projection.test.ts __tests__/pa-agent-runtime-chat-history.test.ts __tests__/chat-service.test.ts __tests__/obsidian-operations-tools.test.ts __tests__/source-store.test.ts __tests__/capability-registry.test.ts __tests__/chat-tools.test.ts __tests__/chat-tools-task-source.test.ts __tests__/pa-agent-context.test.ts __tests__/pa-agent-context-admission.test.ts __tests__/pa-agent-context-continuity.test.ts`：16 suites/476 tests PASS，5.787s自然exit0。7个变更源文件定向ESLint自然exit0；未build/full/App/device，不关闭T-14或P3。

静态门补充：首次tsc指出新增backlink fixture的空对象联合推断不满足Record类型；仅给构造tuple补准确类型后，该suite19 tests重新PASS（1.467s自然exit0），最终`npx tsc -noEmit -skipLibCheck`自然exit0。其余15套件及全部运行时代码/配置/依赖未变，复用上述组合证据。最终docs:check通过206 Markdown/1802链接、4条既有advisory；diff检查通过，DOM扫描无匹配。独立只读复核确认canonical/legacy一致性及压缩marker两个P2均已闭合，本片无新增未处置P1/P2；不宣称全任务/设备验收完成。

D12 Owner 2026-09-10确认“接受，仅排除受影响的旧回复”：DEC-034、Spec和SDD已同步。T-14追加映射：宿主可证撤销的旧助手混合回复 → 原文/摘要共用投影及物理请求重验 → 两种输入路径排除该条、保留用户/其他助手/legacy，原记录不变、重新获准恢复 → SDK真实请求回归、history/helper单测及定向门；来源/历史序列化与治理变化复验。上条历史输入片所记待答复为早期状态，现已决策。

2026-09-10 T-14历史输入片验证映射：REQ/AC-04每次物理输入当前性 → 历史role/content/images快照绑定answer和history-summary实际发送 → SDK429后替换历史文本、验证旧payload不重发且fresh fallback可携带更正 → runtime定向测试/tsc/lint → history序列化、摘要准备及provider回调变化复验。旧助手混合来源如何保留仍待Owner答复；本片只保护已变化的实际历史输入，不擅自制定旧回复整体排除策略。

2026-09-10恢复执行：原临时checkout已不存在；从已推送`4591434`恢复至`/tmp/pa-b135-completion`、`codex/b135-completion`，未改master。T-14/AC-04当前映射：普通Vault结果后续投影 → 真实runtime先读A/B后收窄B的物理SDK请求反例，检查A退出而B及Personal保留 → 定向runtime/source测试、类型检查和diff/docs门；来源删除/同路径替换、摘要调用前来源变化需回归。完整历史派生与最终GenerationInputSnapshot仍按原任务跟踪，不以此片关闭T-14。

2026-09-10 T-14普通工具来源片：真实SDK离线fixture先确认scope目录只剩B而第三次请求仍含A，RED自然exit1；在TaskSourceRun沿真实文件身份、当前范围和Data Boundary重新投影普通sourceRecords。移除失效结果的正文/preview/metadata，保留canonical记录、B及Personal、用户/助手会话。无法可靠按来源拆分的自由文本结果整条撤回，结构化多源精确重建仍待后续，不能声称完整AC-04。

独立只读审查指出一次投影未覆盖SDK等待后的重试；已补answer实际序列化transcript副本和tool-summary独立source副本的发送前同步校验。真实SDK429分别在answer与tool-summary首次发送后替换同路径文件：旧SDK重试被阻断，重新投影的fallback/answer可继续且无旧正文；helper覆盖删除、替换、收窄及原会话不变。初始fixture未启用Operations而outline被拒，修正为实际已有启用条件后才作为RED证据；summary按真实tool_result内容定位被撤销请求，不把控制回执摘要误作资料摘要。独立复核无新增P1/P2，完整历史与通用输入快照仍待实现。

冻结验证：`npm test -- --runInBand __tests__/b129-multimodal-runtime.test.ts __tests__/task-source-run.test.ts __tests__/operations-agent-runtime.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-context-summarizer.test.ts __tests__/pa-agent-context-summary-projection.test.ts __tests__/chat-service.test.ts`，7 suites/330 tests PASS，4.872s自然exit0。`npx tsc -noEmit -skipLibCheck`及`npx eslint src/ai-services/task-source-run.ts src/ai-services/pa-agent-runtime.ts`均自然exit0。`npm run docs:check`通过206 Markdown/1802链接，4条既有episodic advisory；diff检查通过，DOM注入扫描无匹配。源/测试/config/lock在最终运行期间冻结，仅后补此证据；未build/full/App/device，T-14保持部分完成。

2026-09-09开发分支交付：提交前核对tracked/untracked全量路径、模块依赖及合成模型fixture；按Memory/default/governance、图片队列、Agent/source/native/Operations、文档四个职责分组。已有源码验证输入保持不变；只修DEC-033和Brief仍停留早期“未批准”的表述，按D8及其他真实后续决定对齐，并更新本Snapshot交付授权。本次是开发检查点，T-13/T-14等未完成项与真实模型/App/iOS门保持待验，不以提交或远程同步代替完成证据。

2026-09-09本片最终冻结验证：`npm test -- --runInBand __tests__/b129-multimodal-runtime.test.ts __tests__/chat-service.test.ts __tests__/operations-agent-runtime.test.ts __tests__/skill-context-provider.test.ts __tests__/task-source-run.test.ts __tests__/task-source-executor.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-writing-preview.test.ts __tests__/pa-agent-answer-completion-policy.test.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-control-policy.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/ai-ios-dashscope-transport.test.ts __tests__/chat-image-assets.test.ts __tests__/b129-image-request.test.ts`，15 suites/589 tests PASS（12.64s，自然exit0）。最终`npx tsc -noEmit -skipLibCheck`及本片8个源文件定向ESLint均自然exit0；早先新增mock零参数导致的TS2554已改用真实MemorySearchPort参数类型，未修改业务API绕过类型。来源代码/测试/fixture/config/依赖在组合检查期间冻结，未进行build/full/App/device gate；跨会话复用仍须核验实际输入，不凭HEAD直接复用。当前main工作区核对干净，所有本片新增实现/修复/验证仍归B-135。

T-13生产接线：AC-01/03/04 → 每run真实用户消息ID/笔记身份/范围state，控制schema与动态handle说明、完整工具批次wrapper及Memory路径快照；移除runtime自然语言regex工具名单 → run helper、真实runtime批次/Memory/current-note/Operations及独立图片/skill回归，类型检查 → 缺声明/越界混合批次零读取，已批准声明与读取同轮，已授权背景能力保持原门 → scope/schema/工具适配/路径身份变化复验，完整集成和App门仍需阶段执行。

本片文档及源检查：完整docs:check通过206 Markdown/1801链接，4项既有episodic advisory；沙箱首次跳过Git删除连续性检查，改在获准环境重跑同一只读命令后完整通过。git diff --check通过；DOM源扫描无匹配（exit1按约定为PASS）。文档仅记录本片实现/证据/未完成项，不重开旧过程任务，也不将定向验证升级为全量或App/device证明。

2026-09-09生产scope片：TaskSourceRun捕获真实文件身份并与loop实际userMessageId对应；主Agent可同响应声明及取材，宿主完整预检后提交范围，Memory检索取得同一scope的有限路径。移除runtime内current-note/notes-only/no-web的NL regex工具名单，保留skip-memory、registry、Data Boundary和Operations opt-in/确认门。load_skill按实际provider拥有的capability对象、图片按本run注册对象识别独立上下文，不按meta或同名工具赋豁免；图片仍读取/验证注册字节，不记录成零I/O。

独立审查发现内部identity登记会在current-note之外泄露路径、vault枚举会使目录无界膨胀；已分开内部cache与公开目录。只有来源重验后的有效返回sourceRecords可发布，当前scope/live再次检查，最多32条/转义JSON8000字符；原结果及旧handle绑定不删除。真实runtime验证全库Memory枚举的内部路径未进入任何provider输入；helper真实3000次登记也不改变目录。该finding独立复核关闭。root另核对合法context-used即使非citation也需保留后续定位句柄，仅memory-reference沿citation资格门；真实Operations runtime三轮正向测试从非当前笔记标题结果取得公开句柄，再收窄为selected并读取更多标题，第三轮目录仅保留该笔记、currentNoteHandle为null。该suite 12 tests PASS（1.52s，自然exit0），正文/枚举/暂存/写入均零调用。

T-13控制轮接续映射：AC-03/04 → completion把成功scope控制回执与资料观察分开，保留原loop调用/轮次/硬截止 → 真实runtime独立声明→读取→回答及completion混合失败/重复回归 → 控制轮不记录证据或观察、不提前final-only；实际失败/重复仍按原策略收尾 → outcome分类、ledger、control snapshot或final-only执行门变化复验。

真实SDK离线fixture暴露独立声明后两项合法读取都被final_answer_only_violation拒绝，根因是控制prompt被当观察。修复仅从completion事实与ledger剔除成功且带host标记的declare_source_scope；调用和结果仍留在turn，预算/硬期限不改。新增独立声明与control+failure/duplicate测试通过；runtime+completion 2 suites/85 tests PASS（2.17s），completion/required-policy/host-tools 3 suites/136 tests PASS（1.466s），均自然exit0。独立只读审查确认没有final-only绕过或失败掩盖，该finding关闭；本片完整冻结验证另记，不用这两项冒充全量/App门。

Memory follow-up兼容映射：同源follow-up快照不能意外移除已获准的收窄范围控制 → 在原notes snippet集合中仅保留上一快照已allowed、未blocked、非final的declare_source_scope → required-policy三态与原control-policy回归 → 无原权限不新增、关闭不恢复、Web/Memory/skill等不重开，shared Set不被修改 → snapshot/follow-up metadata变化复验。独立审查确认接缝及最小修复。当前标准Memory返回needsSnippetFollowup:false；此项证明保留的兼容metadata分支，不声称普通生产查询必然触发。

T-13/T-14图片队列读门映射：AC-04/08 → verify及更早的resolveVariant沿实际队列、恢复读取、readVerified/readBinary传递调用级signal/currentness；ChatImageRequestScope的prepare/resolve提供真实快照 → 真实service队列和request scope反例、处理等待/恢复及并发隔离回归 → 排队失效零字节读取，异步后不重读/处理/缓存写入，不把取消记为源损坏；正常有效调用及旧无guard调用继续使用 → 图片队列/处理器/缓存/恢复路径或request identity变化复验。

最初两个verify排队反例在旧代码下均仍readBinary一次（0.875s，自然exit1），证明外层await后检查不足。verify先修复后，主审发现prepare更早的resolveVariant也读取原图，故同一接缝一并接通；没有扩大图片功能。调用级guard只留在闭包，不写入asset/缓存/来源receipt，避免正常turn清理误撤销有效来源。恢复中已开始的写入不能追溯撤销，失效后不启动后续步骤，保留pending供重试；独立vault事件维护保持原有权限。

最终图片定向51 tests PASS（1.236s，自然exit0）：真实scope的首次prepare、已物化后的verify、历史resolve分别覆盖abort/request失效/输入身份变化；队列有效并发不被污染；处理等待失效后零额外读取/缓存写入；普通/待恢复验证读取失效不将资产标changed，也不完成恢复。恢复fixture最初把独立rename事件维护的写入误归到verify，改为明确“移动中断且丢失通知”的现有恢复场景后通过；未修改生产事件维护或放宽零写断言。当前未关闭T-13/T-14，也未重新build/部署。

T-14后续明确入口：`MemoryEvidenceRegistry.prepareTranscript`当前只重验search_memory；普通Vault结果在执行返回前有guard，但后续transcript clone没有逐来源重新投影。动态目录取交集不能替代正文/metadata/summary准入。继续实现时先用实际runtime读取A/B→收窄仅B，分别断言A不再提供、B及获准助手/用户历史继续可用；并覆盖来源删除/同路径重建、摘要及物理retry。不能用统一清空历史或将全部旧工具内容当个性化来满足该反例。本条是未完成的T-14工作，不将当前生产接线标为完整AC-04通过。

T-14摘要请求有效性：AC-04 → 摘要模型构造后、工具证据异步刷新后及物理发送入口复验当前request/image/style → 真实runtime/ChatOpenAI离线网络fixture → 等待模型或SDK发送前撤销时零实际请求，合法摘要仍正常发送，独立摘要超时不扩成run取消 → summary准备、transport/retry和来源有效性回调改变时复验。本片不替代Personal/Memory背景快照或完整历史来源治理。

T-14背景刷新：AC-04/D10 → 首发和fallback统一准备，所有await后同步读取最新Personal/Memory，按最新背景重算style预算；物理answer/SDK重试校验实际格式化背景是否变化 → 真实runtime/SDK请求正文与次数反例、既有style/runtime/summary回归、tsc → 删除零旧背景、更新消费最新背景、稳定背景仍可用、变化后不发送已序列化旧body；trace-only元数据不触发无关失效 → host selector/formatter/budget/transport变化时复验。仍需完整历史/工具来源、真实provider和App门。

2026-09-09摘要/背景片：先补真实runtime→ChatOpenAI→离线fetch反例，旧源码在模型等待/物理发送前request失效（signal未abort）后仍发送两次summary；修复后摘要构造后、证据await后及SDK每次物理请求均检查request/image/style。首次fixture未消费runtime预期拒绝，修正为先断言拒绝再检查实际请求数，随后确认上述真实失败，未放松零发送断言。summary及runtime三套124 tests PASS（2.883s，自然exit0）；之后背景代码变更需最终组合复验，不能沿用该数字冒充最终状态。

独立复核发现合法selected-image长历史在summary前尚未prepare会被新assertReady误拒绝，已在真正summary分支开始独立deadline前建立图片receipt；answer仍最终准备。后续复核确认此回归修复、摘要超时独立、背景刷新/预算与物理guard一致，无新增必须修finding。背景guard比较当前请求实际formatter正文，排除未投影trace及独立style/Pagelet字段；不构造跨run缓存，不修改已序列化SDK消息，不删除未知旧历史。完整GenerationInputSnapshot及其历史/工具来源用途仍待T-14后续完成。

最终冻结组合：`npm test -- --runInBand __tests__/b129-multimodal-runtime.test.ts __tests__/pa-agent-context-summarizer.test.ts __tests__/pa-agent-runtime-search-vss.test.ts __tests__/pa-agent-writing-preview.test.ts`，4 suites/161 tests PASS（3.581s，自然exit0）。新增21个背景/图片用例含有效非空背景、Personal及governed Memory在模型等待/style等待/SDK发送前/429 retry期间删除和替换；真实formatter背景增长到5900字符后保留最新Memory、移除超预算style及其revision。主请求未abort的摘要失效、selected-image合法摘要/撤销均覆盖。最终`npx tsc -noEmit -skipLibCheck`自然exit0、runtime定向lint自然exit0、diff及DOM扫描通过；main工作区核对仍干净。未build/部署/真实provider或设备验收，不关闭T-14或P1/P3。

T-13原始批次读计划接入：AC-03/04 → executor支持互斥的单调用/完整有序批次resolver，声明先剥离、所有调用ID必须精确覆盖后才提交scope → executor及integration定向测试、类型检查 → 缺失/额外/错误ID/无计划均在base预检和prepare前拒绝，创建输出只授予目标存在性检查 → resolver、工具参数规范化或Operations虚拟目标顺序改变时复验。生产runtime接线仍待完成。

2026-09-09批次读计划：新增纯resolver覆盖现有八个Vault工具、Memory、web与四个Operations工具，复用真实路径别名/默认当前笔记及输入规则，不调用准备或读取正文/metadata。每路径首次操作保留真实baseline，create→append只准目标存在性、append→create仍要求旧素材；虚拟目标不跨批次或外借给其他读取工具。未知/meta/image/style保留unplanned，后续生产接线必须明确处理，不能直接默认none或移除能力。

冻结输入验证：read-plans、executor及executor-integration三套69 tests PASS（1.318s，自然exit0），含实际factory alias对照、真实身份替换、Operations controller零旧正文读取及wrapper顺序/拒绝反例；最终tsc自然exit0。executor接线独立只读复核无必须修finding，root对照实际工厂规范化路径一致。定向lint、diff/DOM扫描和docs检查按本轮文件完成；不重复旧build/全量结果，不把本片作为App、生产runtime或T-13阶段验收。

T-13受限Memory与笔记身份映射：AC-03/04 → per-run file对象/path绑定与不可重绑opaque句柄；Memory请求级允许/排除路径在vector评分/FTS候选limit前下推，逐调用host同时保护graph、latest body与generation；后续Memory证据保留host guard至每次投影 → identity/state、SQLite worker真实SQL/transport、Memory host/search/registry及manager定向组合 → 同路径重建不复活，越界批次零读取，旧scope不全库后过滤，provider构造等待后失效零发送，受限检索不触发全库prepare/verify；已有独立后台维护与无scope的DEC-028保持 → identity/SQL/port/graph/provider/维护准入变化复验，生产runtime自然语言接通及实际App另验。

2026-09-09受限Memory片：TaskSourceNoteIdentities捕获真实对象/path，不读editor/title/stat；支持既有Markdown/Canvas，同文件换pane有效，delete/同路径replace/rename/lookup失败后旧身份不复活、原排除路径保留。host动态注册不重绑handle/path、不改变已commit范围；真实identity→state→query guard组合覆盖同路径重建拒绝。身份与state定向2 suites/37 tests PASS（0.845s，自然exit0）。

NoteSearchScope在VSS/SQLite队列前复制，通过worker structured payload传递；冷cache直接WHERE限定id/embedding，不先加载全库向量或把局部cache记为完整。FTS在ORDER/LIMIT前绑定JSON路径集合；保留原时间、generation和融合语义。现有非SQLite普通search接口不支持范围时明确拒绝，不能全库search或getChunksByPath替代。上层scoped host对全库任务也先仅枚举path，与真实guard和原DataBoundary交集后传有限集合；graph先过滤源键再读边值，越界源不作opaque中转，latest/generation/ranked chunks读取前后重验。

MemorySearchTool逐调用child使用独立host，rewrite/rerank在模型构造等待后及物理发送回调检查guard；Recovery和MemoryEvidenceRegistry保留同一host guard至后续投影，不序列化进transcript。主审/独立复核发现父dispose原本不能释放child，已加parent-owned集合、同步dispose及parent lifetime门；对应await中销毁反例零rerank发送。受限readiness只看cached ready，不触发全库verify/prepare；完全全库任务保留原DEC-028，且proxy保留调用方显式existingOnly。原先全库scope在SQL后才检查DataBoundary、冷cache先加载全向量的两个前门缺口均已在本片修复。

验证阶段：上层11 suites/422 tests PASS（6.997s，自然exit0），含plugin bridge、runtime、manager、真实Memory search/registry、scope和身份。tsc随后发现新fixture缺includeInNextPrompt、worker union未收窄、jest参数unknown及proxy可选cache判断，已按实际契约补齐，未改产品断言；受影响SQLite/host/search组合最终结果见Current Snapshot。真实SQL证据使用安装版本SQLite/WASM内存FTS执行从生产worker捕获的query，证明LIMIT 1仍得到允许的较低排名笔记；向量worker仍为SQLite mock，不是OPFS/App/device证明。sandbox内子进程曾stdin等待/空stdout，两等待运行明确superseded TERM退出143，空stdout失败未计PASS；相同冻结输入sandbox外3 suites/55 tests自然exit0（1.524s），有延迟退出提示但未forceExit。

收口：受影响5 suites/93 tests PASS（2.745s，自然exit0），进程延迟退出提示后正常结束；最后worker测试仅将结构断言类型改为实际VectorHybridSearchResult，执行语义与该证据相同。最终tsc自然exit0、相关16源码定向lint（proxy末次判断另复验）、diff/DOM与完整docs检查通过。独立上层只读复核确认父子销毁finding已关闭；root确认host范围下推和冷cache前门修复，无其他已知必须修复项。本片未build/部署/设备验证，不关闭T-13、T-14或阶段退出门。

T-13声明消费映射：同一Agent声明+首批读取同响应 → host wrapper解析唯一declare_source_scope、绑定当前run/user与精确指令出处、为全批解析host读计划并验证后commit；dispatcher消费纯控制回执，将已提交guard传至batch/每次execute → 新scope-executor与batch-preflight、真实factory/Operations组合 → 声明不落普通unknown tool、不伪造来源，任一越界整批零准备，旧scope只收紧，候选过期/源失效不读，原工具/取消/预算路径保留 → schema/消费顺序/guard传递/读计划映射变更复验。runtime注册及各物理provider投影仍独立接通，不将可注入wrapper证明成默认已启用。

2026-09-09声明消费片：新增runtime纯控制schema与可注入executor wrapper，绑定run/实际userInput，完整解析原始调用的host读计划后才commit；未知计划、重复ID、多声明、越界或旧host gate拒绝均不commit。无新素材读取的输出计划无需额外声明轮，host guard只开放精确输出存在性，不允许旧正文。dispatcher将声明从canonical/prepare/mode/execute移除，保留顺序/生命周期及独立control_applied回执，剥除sourceRecords/contextUsed；准备前后和实际execute前后复核本批guard，共享executor不保存全局scope。

真实PaAgentLoop→wrapper→registry/adapter→current-note factory组合证明同响应声明后读取真实editor；混合越界批次零execute/零editor读且不commit。首轮测试读取错了PaAgentMessage的回执字段，改为content.metadata及sourceRecords/contextUsed，未放宽产品断言。5 suites/70 tests PASS（1.589s，自然exit0），tsc/定向lint通过。独立审查另发现read-first/declare-last且只剩1额度时，已commit声明可能只收到超额回执；要求准备与实际分配都优先预留控制额度，保留原输出顺序并补反例。该修复最终证据另记，不以此前PASS覆盖变更。

该预算finding已修复：collect及sequential/parallel使用批次局部剩余控制数预留额度，read-first/declare-last只剩1额度时来源零canonical/prepare/execute，控制正常applied；控制总数超过剩余额度整批准备前拒绝。独立复核另指出当前controlSnapshot明确禁声明时不得先commit，wrapper已在候选准备前复用现有allowed/blocked工具门整批拒绝，两反例保证零commit。最终wrapper/preflight/两外层wrapper/loop/host-tools组合5 suites/227 tests PASS（2.306s，自然exit0），定向lint通过；范围状态与实际readguard未变输入复用此前组合。生产runtime与物理请求仍未接通，未build/部署，不以此关闭T-13或阶段退出门。

T-13真实读取接缝映射：AC-03/04 → 每次工具调用携带host-only `taskSourceReadGuard`（当前性及允许路径），capability adapter保持传递；各Vault工具在metadata/editor/正文读取前与异步结果投影前校验，并叠加已有factory路径边界 → 真factory配spy editor/vault/metadata及adapter/executor组合测试 → 禁止路径零读取、途中scope失效不返回旧结果、无guard保持既有行为；不将action/meta或raw工具结果当Personal豁免 → guard传递、读取入口、辅助metadata/backlink来源或异步等待变更复验。search_memory/Operations与物理provider门独立接通，不以普通Vault工具通过冒充完整T-13。

2026-09-09实际读门实现：host execution input→registry context→adapter保持同一guard；执行前、capability返回后及外层Recovery等待返回后的证据capture前重验。最后一项由独立审查发现并补反例：恢复revalidate撤销来源后零capture/零成功返回。State.createReadGuard只接受已提交current revision，host文件identity resolver可拒绝同路径重建文件，且复核host生命周期；共享executor并发两调用分别保持自己的guard，一项撤销不影响另一项。

8个Vault factory复用逐调用过滤host，在editor/lookup/cachedRead/getFileCache前保护，async后重验；旧factory边界取交集。元数据图先枚举来源路径，仅访问允许来源的边值；被排除backlink、标题、stat没有先读后滤。current-note执行时的实际view路径及editor各读方法复核。独立主审未发现另一项必须修复问题；当前host仍须在runtime先绑定真实文件对象+路径，不能把以后按路径重查视为同一原文件。

Operations StageOperationsIntentInput只携带host-only guard，先验证完整规范化目标批次，再逐路径resolve/exists/baseline及async返回复核；不修改共享controller或持久化guard。首次create只检查精确输出目标存在性，其他首次目标读正文；同批create→append使用virtual内容，无额外旧正文读取。精确输出目标例外不能用于append→create或读取已存在碰撞文件正文。原Data Boundary、确认、stale-safe、Undo与审计独立。主审追加prepareBatch进入base准备前及等待后有效性门，过期时整批返回拒绝，不进入参数准备/目标读取。

验证：真实executor/adapter/state、8factory、controller与staging组合9 suites/196 tests PASS（2.536s，自然exit0）；最后Ops前后门与fixture outcome字面类型修复后，3 suites/45 tests PASS（1.484s），其他输入不变复用。独立贡献者此前Operations runtime/service/audit-Undo 3 suites/25 tests PASS（1.256s）为兼容证据。最终tsc、定向ESLint、diff和DOM源扫描通过。未进行本片build/App/device，生产声明及guard尚未启用；阶段门仍待完整接通后验证，不把可注入的测试链路当成已上线行为。

T-13完整批次预检映射：AC-03/04及prepareArguments提前读取风险 → dispatcher在解析完整批次后、任何过滤/canonical key/prepareBatch/执行之前进行同步host预检；运行期范围记录绑定真实user/run及host note handles，同一请求只能收紧 → 新batch-preflight和task-source-constraint定向suite，随后runtime/context集成suite → 越界/冲突/异常整批零准备零执行；未知句柄拒绝、范围不可放宽、旧预算/取消/final-only保护保留，正常背景准备不要求声明 → preflight位置、wrapper转发、scope投影或模型schema变化复验。本片先实现host契约和执行接缝，未连接主Agent声明及全部物理输入前不得将T-13标完成。

2026-09-09 T-13基础实现：`TaskSourceConstraintState`复制host user/run/句柄事实，精确quote仅作用户输入出处，冻结候选并以当前revision/WeakMap约束commit；同run允许集合和web权限只能收紧。无声明拒绝新增任务读取，Personalization不作为可由模型更改的read kind。受限范围不允许先全库检索再过滤；真实scoped read计划和动态host句柄仍待接通。独立只读审查未发现新增P1/P2；候选预检不等于commit，真正执行须使用已提交且仍current快照。

dispatcher同步preflight收到完整解析批次（含无效/重复/被policy禁用项），拒绝/异常/非法异步返回整批纠正且无canonical/prepare/mode/execute，拒绝消耗既有调用预算但不伪造成功/来源。保留final-only、取消和硬截止；主审补上成功callback后的取消/截止复核，两反例零准备。Operations/action wrapper只在base有hook时转发；真实loop混合可读当前笔记与越界操作证明两包装均零准备/执行。7 suites/229 tests PASS（2.757s，自然exit0），包括原loop/host-tools/Operations/action回归；只在该基础范围内证明接缝，尚未配置生产source callback或完整投影，不能标T-13完成。

该片类型检查发现新测试的`reason: retry`不属于现有union，改为`corrective_turn`后受影响preflight suite 15 tests PASS（0.736s，自然exit0）；其余6 suites输入未变复用。最终tsc、定向ESLint、diff和DOM源扫描通过；完整docs:check通过（206文档/1801链接，4项既有episodic advisory）。未重跑production build/full suite或App，因为生产source callback尚未启用；未来接通后必须补其相应门，不能复用上一片部署来证明新机制。

2026-09-09 D11当前实现与证据：governed Profile采用独立`personal-assistant-governed-user-profile-v1`命名空间，canonical link/outbox/Queue记录`store: governed`与opaque `semantic-xxxxxxxx` key；缺省归属仍指旧库。scheduler从host baseline复用稳定ID，身份冲突不推进cursor。恢复只修新派生库缺失/错key/无归属错ID，另一有效claim拥有的ID不得清除；缺来源/写失败保持pending，晚到history由现有retry恢复。correction/Undo不把新正文回写旧库，Forget按每份精确副本完成才结束。回滚不得剥离新目标归属。初次遗忘组合fixture缺精确fingerprint，补齐真实契约后通过，未放宽生产门。

定向证据：plugin 366 tests PASS（22.203s），覆盖重启缺库/缺来源/错key/错ID、晚到history真实timer、旧outbox归属修复、冲突ID保护、修复第二次写失败与Forget第二份删除失败重试；其余persistence/admission/coordinator/worker/reader/port/history证据按未变输入复用。真实Qwen `qwen3.8-max`使用现有factory、temperature0/maxTokens256及当前TypeA prompt，仅3组合成材料，候选1/0/2；无新全文来源发送。原始响应/usage/prompt保存在`__tests__/fixtures/b135-semantic-extraction-trace.json`，semantic+legacy extraction 2 suites/73 tests PASS（1.125s），校验prompt未漂移、精确quote及非学习一次性要求。实际返回usage包含reasoning，不能把请求maxTokens解释成总token硬上限或凭此推断成本优势。

统一验证：首次`make deploy`平台扫描388 TS、lint和production build通过，sandbox内工具子进程EPERM导致测试失败，停止该运行exit130且未部署；同冻结源码在sandbox外全量测试251 suites通过、3 suites/5 tests失败。失败均为B135改变的当前schema/default与旧fixture假设不符；调整当前/未来版本、保留历史adapter拒绝新格式及显式habit关闭证据，3 suites/93 tests定向通过。最终`npm run test:all -- --runInBand`为254 suites/6974 tests PASS（293.96s），有退出清理延迟提示，随后自然exit0，没有forceExit。生产源码/配置/依赖未变，复用该lint/build；diff/DOM扫描通过。旧B118/B129命名suite的新增回归全部由B135承担，旧过程文档未重开。

真实宿主证据：以`node scripts/deploy-current.mjs /mnt/code/personal-assistant/test/.obsidian/plugins/personal-assistant`验证构建身份并复制四资产，逐资产SHA256与dist相等；实际open test库路径已核实。插件reload后新factory/reader存在、profileStore为governed。2026-09-09的独立合成数据库probe（startedAt `1788957466551`）验证旧reader看不到新库、新写入保持旧snapshot、真实来源删除abort IDB事务、旧新数据各自保留及新连接重开；12检查通过，3个本次创建的库均清理，fresh console无错误，debug/mobile均关闭。这是当前构建app-runtime证据；没有真实窗口UI、iOS或完整旧插件降级/重新升级交互PASS。

T-04/T-10/T-19 D11派生缓存隔离映射：新semantic正文不得借旧Profile reader绕过版本拒绝 → 独立governed Profile命名空间、canonical目标存储归属与host提取key、scheduler/worker统一路由、旧副本精确清理 → persistence/admission/governance/worker、Profile store与plugin定向组合及基线旧reader对照 → 旧库保持历史字节、新正文只到新库、跨会话/重启稳定ID、写失败不applied/不推进cursor、correction/Undo不回旧库、Forget每份精确副本完成才结束 → 目标字段、存储路由、恢复/清理或身份映射改变复验；真实浏览器/设备独立门不由fake替代。

T-04/T-10 生产接通映射：AC-10/11/17 → scheduler实际semantic投影、ChatHistoryManager来源lifetime、plugin准入/Queue确认及Profile恢复重验 → semantic/extraction、history manager、plugin与Profile端口定向suite → 源增删改/prune或关闭使旧批次失效，retry不推进cursor，不退回regex或直接写Profile；恢复只用当前匹配来源，完整接通前不启用生产flag → 来源存储、队列、恢复或设置lifetime变更复验。lifetime只覆盖该manager的写入，不宣称跨数据库原子提交或任意外部writer保护。

2026-09-09 来源接通实现：scheduler semantic lane要求admission/model/有效lifetime，模型前后重新读取真实sources；候选merge保留当次kind/confidence/receipt，confirmed=false，不继承legacy证据。HistoryManager在修改开始即使同会话lease失效；prune全局失效，进行中捕获的lease不复活；短期observer提供写事务abort signal并释放。plugin Type A入口验证实际投影并保留精确单会话provenance；Queue确认与Profile恢复重新加载当前来源，guard贯穿Profile port/store至IDB完成。Profile旧初始化规范化仍是独立维护，不在新投影guard范围内。

验证：semantic/legacy extraction 2 suites/63 tests PASS（1.008s）；真实HistoryManager 1 suite/31 tests PASS（1.105s）；Profile port/store及scheduler 3 suites/76 tests PASS（1.423s）。主线程最终组合6 suites/480 tests PASS（17.618s），自然exit0，包含真实MemoryChatHistoryStore→coordinator Queue→plugin确认→MemoryUserProfileStore的有效来源、确认前删除、恢复await中删除。有效写入保留原kind/confidence且confirmed=false；删除时不写Profile，已提交Queue的恢复任务保持pending，observer全部释放。IDB abort证据为事务fake，非浏览器。初期Queue fixture误将推断敏感候选/低风险明确候选期待为review，按现行policy改用正向低风险白名单外的明确个人偏好；成功outbox保留applied记录，未把它误当必须删除的pending任务。未放宽生产policy。

生产前P2（独立只读复核）：基线HEAD c923ee22的plugin在governance读取失败后仍可创建旧scheduler并注入独立Profile内容（旧plugin 2230–2258、9537–9539、9641–9653；旧profile-store 95–101）。当前semantic Profile投影若落入原DB，confirmed=false与删除receipt均不能阻止旧reader读取新正文。这是已证实的D11隔离缺口，不是仅缺测试；保留productionflag关闭，后续隔离当前派生缓存与旧可读来源，并覆盖旧reader/Forget/重启/重复提取身份后才切换。来源接线审阅无另一个必须修复问题，本片不关闭T-04/T-10/T-19。

本片收口检查：最终tsc、相关源文件Lint、diff及DOM扫描通过；完整docs:check通过206 Markdown/1801链接，4项既有episodic advisory未新增。Lint初次发现剔除legacy证据的未用解构变量，改为副本显式delete后通过；行为不变，复用上述组合测试。没有当前production build、部署、真实App或设备证据。

T-04/T-10 生产前接缝映射：AC-10/11/17 → 既有Type A单模型semantic方法、实际500/2000字符投影、来源quote receipt；新增governed_preserving_legacy内部迁移phase以保留旧副本并停止有损增量 → semantic/extraction、admission/migration/governance/persistence、plugin与Queue相关suite → 不增加独立classifier/模型轮，provider/JSON/顶层错误retry且不regexfallback；首semantic提交原子transition，重启不adopt旧数据，普通save保留raw，Forget仍精确清理 → source/lifetime/budget/迁移phase/保存重验变化复验。Type A方法暂不接scheduler；新phase不是finalized，不制造用户清理确认。

2026-09-09 实现与验证：Type A新增semantic方法单次invoke；实际投影回传且仅对提供片段定位，provider/JSON/顶层错误retry、单项无效过滤。2 suites/53 tests PASS，0.988s，自然exit0，含多消息转义计入2000字符预算及未提供消息拒绝；独立只读复核未发现必须修复项。该方法仍未接生产scheduler。

保留旧副本phase实现：首个实际持久化的semantic候选在同一事务退出compatibility，保留payload/delta，无finalize确认；新phase继续治理/精确legacy Forget，GC保留兼容材料而Undo正常到期，旧hash变化只隔离pending。4 suites/140 tests PASS（4.206s）；plugin重启绕过adoption、localpolicy/snapshot可读，save保留raw，GC调度避免过期循环，旧record adapter释放，Queue允许新phase。plugin/Queue/extraction组合4 suites/416 tests PASS（21.66s），均自然exit0。复核发现reject/ephemeral也会提前切phase，已将转换推迟至policy允许持久化后；两反例及原suite共41 tests PASS（1.387s）。不把commitSequence既有递增称为整库零写，只证明phase、候选、revision和保留材料不变。

本片最终独立只读复核确认P2关闭，无剩余必须修复问题；冻结后的TypeScript、Lint（末次coordinator修改另做定向Lint）、diff、DOM扫描及完整docs:check通过。docs保留4项原有episodic advisory；尚未构建/部署当前源码，生产Type A/scheduler、Profile恢复来源与真实模型/宿主仍待接通验证。

T-04/T-10/T-19 schema3接缝映射：AC-10/11 → 旧1/2原子升级、revision/Undo/Queue typed receipt及两种origin最终提交重验、禁止有损legacy导出 → persistence/coordinator/rollback/plugin及migration/Profile worker suites → 不造旧证据、非法/错位/额外来源拒绝、source变更零commit、重开保真、旧格式拒绝 → schema/parser/准入/迁移状态变化重跑相关组合；真实IDB与生产入口未接不关闭任务。

T-08/T-09/T-11 真实宿主默认学习映射：AC-17/04/09 → 在已部署当前构建的 repo-local test 库中备份并恢复完整 plugin data，经真实 `loadSettings`/迁移/保存/重载验证旧缺失值与旧 `false` 均归为默认开启、`paused` 及版本化明确关闭保持关闭；以真实 scheduler 与习惯 collector 验证启动不回填历史、新合成 Chat 才进入调度、两项可独立关闭且关闭后零新增，同时关闭新提取不清空或禁用合法 Personal/风格读取 → Obsidian CLI App-runtime receipt + 受影响 focused suites → 数据文件与业务库清理后逐字节/摘要恢复、零真实 provider 请求、fresh error 为零；设置结构、scheduler/collector、读取门或 test-vault build identity 变化时重跑。该片只关闭真实宿主生命周期缺口，不代替可见 Desktop 设置交互、真实模型语义质量或 iOS 门。

2026-09-09 schema3片：逻辑与IDB版本升3，旧1/2无receipt数据在同一升级事务验证全部stores后更新meta，失败全量保留；新字段仅revision/Undo revision/Queue envelope合法。coordinator新规则须receipt+宿主candidate/projection+lifetime，admit和confirm在final commit重验，revision/outbox和Queue保留确切receipt。compatibility journal中暂拒绝新semantic记录；rollback入口拒绝目标vault任何新receipt，避免主动丢凭据导出。生产Type A/plugin仍未接，compatibility窗口正确退出仍是必做，非功能缩减决策。

验证：首轮5 suites/461 tests PASS（21.273s）；增加rollback拒绝后2 suites/52 tests PASS（2.056s）；migration/migration-coordinator/governance-coordinator/Profile worker 4 suites/75 tests PASS（4.254s）。独立复核发现P2 provenance可夹带未证会话/笔记，已改为receipt会话精确相等，coordinator两origin、revision/Undo/Queue均覆盖。roundtrip fixture原带note来源因此按新门失败，修正为真实匹配conversation，未放宽校验。修复后5 suites/466 tests PASS（19.87s）。最后将fingerprint排序固定为UTF-16而非环境locale，来源身份仍不受候选改写/投影预算影响，受影响3 suites/100 tests PASS（1.485s）；均自然exit0。独立复核确认P2关闭。tsc/Lint/diff/DOM扫描通过；无当前build/App/设备升级证明，旧reader实验作为升级前历史证据保留，现future fixture使用版本4。

T-04/T-10 语义凭据实现映射：AC-10 → 绑定规范化候选正文、模型语义标签、宿主核验的message/hash/quote span与规则版本；模型只能提交messageId/quote，不可提交host span/权限 → 新receipt定向测试覆盖混合消息、任务/引用/不确定拒绝、正文篡改、重复/越界/来源变化、旧receipt隔离 → 只产生可供治理审查的候选凭据，不产生confirmed；新持久化格式与两条准入接通前不切生产 → receipt结构、投影、TypeA或最终准入变化复验。

2026-09-09 实现证据：新增 `chat-memory-semantic-receipt.ts`，独立于旧chatEvidence；混合写作消息保留hostKind，quote由host定位，候选正文trim后hash和kind/confidence均绑定。`chat-memory-semantic-receipt` + `chat-memory-semantic-sources` 2 suites/25 tests PASS，0.785 s，自然exit0；tsc/lint、diff及DOM扫描通过。凭据解析只验证结构，最终门仍须用当前宿主投影verify及lifetime guard；当前未接Type A生产调用、治理schema或两条持久化门，不宣称来源语义已交付。

D11组合证据：将既有transactional IDB fake提取为共享helper，无新依赖。实际IndexedDbMemoryGovernanceRepository遇未来logical-schema/database-version后进入plugin failed；先非Memory队列创建与普通save，再确认有效候选得到queue_reserve_failed，队列未变；Forget/Profile/GC retry未启动，原stores/version及legacy保存数据保留。`memory-governance-persistence` + `plugin-record-note` 2 suites/375 tests PASS，16.205 s，自然exit0。未来数据仍是opaque fixture，IDB仍是fake，不代表合法新writer输出、真实宿主持久化或重新升级恢复。

本片独立复核P2已修：verify最初重建时沿用receipt.meaning，当前候选改为task_instruction仍可能通过；现比较候选meaning并用当前候选重建，未知/缺失也拒绝。补3个语义变更反例后两套25 tests PASS，0.922 s，自然exit0；冻结后tsc/lint/diff通过。只读复核确认缺口关闭，未连接生产的边界不变。当前persistence源码与HEAD一致，未来reader拒绝组合证据明确绑定该旧读取实现。完整docs:check通过，4项原有episodic advisory。

D11 持久化降级验证映射：AC-10/11 → 使用当前旧格式 reader 打开保留完整记录的新逻辑版本/新 IndexedDB 版本 fixture，再尝试事务与重开 → 所有读取和事务拒绝、回调不执行、零通知、所有 stores 原样保留 → persistence 定向测试；任何 schema、open/upgrade、bootstrap 或写入恢复变更后重跑。该片不代替旧插件与重新升级验收。

2026-09-09 D11 新增证据：`memory-governance-persistence.test.ts` 1 suite/27 tests PASS，1.047 s，自然 exit 0。新增未来逻辑 schema 与数据库版本的事务 fake：连续两次新 reader 的 initialize/transact 均拒绝、事务回调与订阅通知零执行、完整 stores（含未知凭据）及 DB 版本保持原样。未改生产 persistence reader，不能把 fake 当真实宿主 IDB 或重新升级证明。plugin-record-note 的既有 generic storage-failure 测试补 suggested 候选确认失败/不变、repo/coordinator/worker 清空、Forget/Profile retry 不启动与零 Profile 创建；定向 1 test PASS，2.453 s，自然 exit 0（其余345未运行）。初次沿用 applied fixture，不能覆盖确认准入；改为启动前 suggested 后验证真实拒绝分支，未放宽断言。

独立只读核查当前与HEAD的bootstrap/普通保存/queue确认/恢复路径未发现拒绝后清空或覆盖治理库；失败发生在迁移/worker创建前，save只写data.json。旧版仍可沿独立scheduler使用历史UserProfile，这是独立存储，不等于读取被拒绝治理库；D11不承诺停用所有Personal/学习。下一步将未来格式的真实拒绝reader与plugin harness联测，并实现新格式迁移/重新升级保真；这些门仍未完成。

同片确认分支证据更正：增加精确 `queue_reserve_failed` 断言后发现上述2.453 s结果因fixture缺memoryType在前置校验拒绝，不能证明确认保护分支。补齐合法memoryType/sensitivity，保留精确失败原因、队列不变及恢复不启动断言后，定向1 test PASS，2.495 s，自然exit 0。生产行为未为fixture调整。本片TypeScript、完整docs:check及diff检查通过；docs保留4项原有episodic advisory。

任务必须按 Plan 的阶段退出门完成 implement → focused validation → review → fix → verify。每一行的完成包括自己的失败与兼容路径，不能把写完代码当 Done。

| ID | Requirement / AC | Slice | Status | Evidence / dependency |
| --- | --- | --- | --- | --- |
| T-01 | B-135/REQ-11 / B-135/AC-11 | 建立 L3 Decision/Spec/SDD/Plan/Tracker，旧任务新增工作转归 B-135 | [x] | 文档 gate、2 suites/58 docs tests 及独立设计复核见下方日志；不代表 P0 已完成 |
| T-02 | B-135/REQ-03 / B-135/AC-03；B-135/REQ-17 / B-135/AC-17 | 记录真实产品答复，冻结范围及迁移，不重问已确认边界 | [x] | D2/D3、D5、D8、D10 已按真实答复同步 DEC-034/Spec/SDD；仅产品选择及文档任务完成，后续技术验收由各实现任务承担 |
| T-03 | B-135/REQ-05 / B-135/AC-05；B-135/REQ-06 / B-135/AC-06；B-135/REQ-07 / B-135/AC-07；B-135/REQ-14 / B-135/AC-14 | native 输出与旧协议独立兼容对照：当前 qwen 配置、转义/Unicode、增量预览、正常工具结束、tail 异常 | [x] | native schema/真实历史delta经当前adapter→loop→bridge、终局/混批与无ack自动化通过；当前Qwen与同网关DeepSeek最小协议对照及当前Qwen默认Desktop全流通过。F-20/F-23按D14保留为T-20质量结果，不再否决协议传输兼容；整体受影响iOS门由T-18/T-21承担 |
| T-04 | B-135/REQ-03 / B-135/AC-03；B-135/REQ-04 / B-135/AC-04；B-135/REQ-10 / B-135/AC-10 | P0 来源声明/物理输入、混合消息两段准入、旧新 reader 最小可行性 | [x] | D1当前笔记+Personal+已有Memory+style的真实SDK输入及answer/fallback/summary/rewrite/rerank重验通过；D4 TypeA/plugin两门、D11新库隔离与真实降级/升级矩阵均已贯穿。真实语义/App/device仍由后续任务和阶段门承担 |
| T-05 | B-135/REQ-14 / B-135/AC-14 | finish 及时传递，生成结束/transport/schema 分离，数组 chunk 原样保真 | [x] | tool_calls独立完成类型、finish/格式分离、tail异常/挂起、array chunk及无重复invoke由当前全门覆盖；DeepSeek实际SDK帧及Qwen native中断/旧协议正常`stop`均在真实宿主通过。设备端作品全流程由T-17/T-18/T-21承担 |
| T-06 | B-135/REQ-15 / B-135/AC-15；B-135/REQ-16 / B-135/AC-16 | 单一绝对期限、软收尾过渡、投影前无正文诊断 | [x] | 共同`runStartedAt`与startup零dispatch、incremental正文跨softAt延续至原hardAt、terminal policy零重答及late tool零执行均有确定性反例；三轴终态、debug白名单、真实序列化限额、SDK retry及answer/context-summary/rewrite/rerank宿主attempt已贯通。当前全门及P1 legacy Desktop出口通过；完整成本账单依SDD归T-20，不作为本任务阻塞 |
| T-07 | B-135/REQ-05 / B-135/AC-05 | 普通回答与作品成版分离，中断/格式失败保留可读内容及真实恢复状态 | [x] | Qwen native在实际Desktop Chat中中断后零成版、历史`aborted`、重载不冒充完成，人工恢复为唯一AI草稿并再次精确重载；legacy可控流在同一已加载Desktop Chat中中断，部分正文重载后精确保留且显示`Generation cancelled`，零成版/完成操作。iOS作品全流程仍由T-18/T-21承担 |
| T-08 | B-135/REQ-17 / B-135/AC-17 | 原始旧值分类、默认策略/用户动作分离、版本迁移与 load/save/reload | [x] | D8 raw missing/false、有效 paused、版本化 10/01 及普通保存/重载在真实 Obsidian 宿主通过；不伪造 consent/confirmedAt，原 plugin data 摘要恢复 |
| T-09 | B-135/REQ-17 / B-135/AC-17 | 默认实际准入、scheduler/collector、独立关闭暂停/恢复、首次说明与设置 UI | [x] | 默认 11 的真实 scheduler/collector、零启动回填、新 Chat 调度、独立关闭零新增、Personal/style 解耦及实际设置 DOM/说明通过；模型质量、T-10/T-11 与 P2 iOS 阶段门不由本任务代替 |
| T-10 | B-135/REQ-10 / B-135/AC-10 | Chat 来源、Type A 语义候选与两条最终准入；混合真实事实/任务要求，默认开启也不学成长期风格 | [~] | semantic lane、最终保存/确认/恢复、稳定ID及source lifetime已实现；当前Qwen合成混合事实/纯任务/双事实1/0/2候选可回放，Desktop设置/关闭组合通过。剩余语义质量门由T-20跟踪；关闭时不另跑提取模型分类 |
| T-11 | B-135/REQ-09 / B-135/AC-09；B-135/REQ-04 / B-135/AC-04 | 普通画像读取门按 D10 决策处理；显式风格授权/场景/撤销与新提取独立 | [~] | governed与legacy无scheduler读取、设置说明、失败/Forget迟到、默认迁移、真实宿主关闭组合及非空Personal/style实际SDK输入通过；Desktop实际开关、Memory主门及Forget闭环通过，剩余受影响iOS实机门 |
| T-12 | B-135/REQ-01 / B-135/AC-01；B-135/REQ-02 / B-135/AC-02 | 主 prompt/工具指导承接语义；去关键词路由、预测必调/隐藏与参数强制覆盖 | [x] | runtime已移除独立分类调用和预测required名单，schema/dedup/取消保留；当前Qwen中引用+否定仍普通咨询、建议+短草稿同次唯一成版，实际工具调用由模型按目标选择。F-20/F-23属于T-20质量跟踪，不重新打开本任务 |
| T-13 | B-135/REQ-03 / B-135/AC-03；B-135/REQ-04 / B-135/AC-04 | 新取材约束、整批预检与每个物理 provider 输入投影 | [x] | 声明/有序读计划/真实身份、受限Memory、Vault/Ops/图片读门及逐物理输入已有定向证据；当前Qwen在真实MarkdownView只读当前笔记且禁网，准确返回唯一代号。profile/Memory/style与任务事实仍分栏，不以清空获准背景换取通过 |
| T-14 | B-135/REQ-04 / B-135/AC-04；B-135/REQ-08 / B-135/AC-08 | 完整获准历史/有来源摘要、跨轮更正、多图指代及 retry/summary/rewrite 重验 | [x] | 普通Vault结果、隐藏依赖、D12撤销旧回复及answer/history/tool-summary/rewrite/rerank物理重验通过；完整输入快照覆盖全部用途。当前Qwen/Obsidian组合案例中后续更正覆盖先前选择，只解析并发送第二张且返回精确标题；共享runtime无设备分叉，不以图片union复活排除项 |
| T-15 | B-135/REQ-13 / B-135/AC-13 | Operations 语义提议适配与 schema/policy/proposal 一致 | [x] | D5；已移除latest-message关键词门，live opt-in/controller/四core动作及原policy共同约束导出与执行。当前Qwen普通咨询无卡、明确保存仅产生一个pending create；实际Desktop卡片点击Cancel后零写入，既有关闭/未确认/stale/execute/Undo回归继续覆盖执行保护 |
| T-16 | B-135/REQ-08 / B-135/AC-08；B-135/REQ-09 / B-135/AC-09 | 写作场景和续写目标由模型理解，宿主绑定 session/parent/hash/material 与受治理风格上下文 | [x] | native候选、动态handle、完整输入、图片收窄及成版parent/scene已贯通；失败继续、重开、空/子集材料、新话题和失效反例由既有Chat回归覆盖。当前默认native/Qwen真实Desktop从唯一候选自然选择上一版，2请求生成正确父子版并显示两个AI draft；受影响iOS由T-18/T-21承担 |
| T-17 | B-135/REQ-06 / B-135/AC-06；B-135/REQ-07 / B-135/AC-07 | 专用作品输出及 Chat 终局单输出、生成请求快照、完成事实与幂等成版 | [x] | native runtime schema/loop/bridge动态handle与物理请求快照已贯通，保留单输出、严格provider身份、无ack及host最终门；生产默认切换后当前Qwen真实Desktop产生17次preview、唯一作品/版本、零恢复/动作，明确确认保存完成且正文精确。来源失效与失败路径继续由既有回归保护，受影响iOS门由T-18/T-21承担 |
| T-18 | B-135/REQ-05 / B-135/AC-05；B-135/REQ-06 / B-135/AC-06；B-135/REQ-10 / B-135/AC-10 | 增量正文预览、版本选择/人工恢复、准确复制编辑保存与 SaveReceipt | [~] | 生成来源receipt贯穿实际请求、自动作品/同页人工恢复和底层存储；最后物理请求完整身份已保存、重载并逐用途重验。实际宿主已验证失败继续、四版选择、style/图片详情、编辑复制、可见preview零写入、明确确认后的精确保存与重载；仅受影响iOS仍待验收 |
| T-19 | B-135/REQ-11 / B-135/AC-11 | 旧 Chat/JSON recovery/版本/provenance/图片/receipt reader 与 reload/unmount/rollback | [x] | schema3隔离、source reopen及真实当前→旧2.9.2→当前矩阵通过：旧版失败关闭但普通保存/legacy Profile可用，v3业务store完整保留，升级后真实来源Queue可确认和投影。当前App重载后四版、media/style/receipt与Chat入口精确恢复，本次默认native可见版本/保存再验证当前reader；整体iOS出口继续由T-18/T-21承担 |
| T-20 | B-135/REQ-12 / B-135/AC-12；B-135/REQ-01 / B-135/AC-01；B-135/REQ-02 / B-135/AC-02 | 固定案例真实模型质量/成本对照及重复取材分析 | [~] | 同输入重复准备前后、Qwen四案及DeepSeek两案已汇总实际序列、自然结束、耗时与可得usage；Qwen缺值为unknown，不推断净耗时或固定提速。F-20已有D14处置；T-20只待D15决定DeepSeek native单样例弯引号变直引号的质量边界，不新增模型运行 |
| T-21 | B-135/REQ-11 / B-135/AC-11；B-135/REQ-12 / B-135/AC-12 | 冻结输入、统一 broad gate 与跨模块 review、补齐未覆盖 provider/Desktop/iOS 门 | [~] | 已有273 suites/7432 tests自然全门PASS，之后窄改动有相关聚焦/build/lint与独立复核；最终全部AC、full-ui/iOS及全量review未完成。各证据输入边界见Work |
| T-22 | B-135/REQ-11 / B-135/AC-11；B-135/REQ-17 / B-135/AC-17 | 按实际实现更新 current contracts/Architecture，汇总全量 AC、剩余事项与处置建议 | [~] | Settings、PA Agent架构、Product Spec与SDD已同步已交付行为及D15真实待决状态，17项AC完成审计见下表；多模态Architecture与最终处置等待D15后一次同步。closeout/release未授权，不先删除Brief独有故障证据 |

## Acceptance Completion Audit

下表核对当前开发分支已有直接证据与B-135完成前的额外门。所有行仍共同等待T-21
对最终冻结输入执行一次统一broad gate与跨模块复核；表中只重复列出除此之外的特定
缺口，不用窄测试或Desktop证据替代受影响iOS。

| AC | Current direct evidence | Additional gate before B-135 completion |
| --- | --- | --- |
| AC-01 | 当前Qwen原句/引用否定保持咨询，混合建议与短稿同轮交付；关键词分类已移除 | D15处置模型质量结果 |
| AC-02 | 同一主Agent按实际缺口选择工具；无独立分类请求或预测required名单，重复准备修复后有实际调用序列 | D15关闭T-20最终处置 |
| AC-03 | 当前笔记、禁网、跨轮更正及Personal/Memory/style分栏通过批次、物理输入和Desktop组合 | 无独立缺口 |
| AC-04 | answer/fallback/history/summary/rewrite/rerank、图片及旧回复均按当前来源重验；获准背景保留 | 受影响iOS |
| AC-05 | native与legacy中断正文在Desktop可读、重载不冒充完成，协议失败不成版 | 受影响iOS |
| AC-06 | 完整身份/finish/来源才成版，provider正文到artifact/hash精确；人工恢复保留AI来源 | 受影响iOS |
| AC-07 | 当前Qwen默认native交付一个作品，无来源/动作混批或额外ack模型轮 | D15决定是否保持默认；受影响iOS |
| AC-08 | parent/session/hash、失败继续、新话题、图片子集及实际自然语言续写已验证 | 受影响iOS |
| AC-09 | 场景、授权style、撤销/Forget/预算重验与关闭提取后继续使用已有style已贯通 | 受影响iOS |
| AC-10 | 精确版本编辑/复制/保存和SaveReceipt通过；Type A候选及两条最终准入阻止临时任务自动变长期偏好 | D15关闭T-10语义质量门；受影响iOS |
| AC-11 | 旧Chat/JSON/版本/图片/receipt可读，当前→旧2.9.2→当前真实矩阵保留新治理库并可恢复 | 受影响iOS |
| AC-12 | Qwen/DeepSeek同输入序列、结束、耗时及可得usage已审计，缺值保持unknown | D15质量处置 |
| AC-13 | 同一Agent在既有opt-in/四工具内提议；普通咨询无卡、明确保存仅pending，取消零写入 | 无独立缺口 |
| AC-14 | deadline/length/stop/schema/tail/usage缺失分轴，Qwen与DeepSeek实际完成形状已记录 | 无独立缺口 |
| AC-15 | 单一绝对期限、正文跨softAt、原hardAt/取消及late工具零执行已有确定性回归 | 无独立缺口 |
| AC-16 | 投影前最小三轴诊断、实际序列化限额与host attempt覆盖answer/summary/rewrite/rerank，默认无正文日志 | 无独立缺口 |
| AC-17 | 新默认、旧值迁移、首次说明、scheduler/collector、独立退出及load/save/reload已在Desktop宿主验证 | 受影响iOS |

## Confirmed Discussion To Delivery Mapping

本次方案与任务安排请求重申以下执行约束；不改变既有验证记录，也不将 Pending 选项自动转为批准。

| 已确认讨论 | 需求与开发任务 | 完成时必须可追踪的结果 |
| --- | --- | --- |
| 长期记忆提取、习惯学习分别默认开启，满足功能需要 | REQ/AC-17；T-08、T-09、T-10 | 新安装的两项能力实际可运行，独立退出/暂停有效；迁移、保存、重载、调度与设置一致。默认不伪造用户确认，不联动其他权限；未知旧 false 按 D8 的真实答复处理 |
| “只用当前笔记”仍保留个人画像、既有 Memory 和已授权风格样例 | REQ/AC-03、04、09；T-04、T-11、T-13、T-14、T-16 | 分开任务材料和个性化用途；在实际模型输入验证背景保留、来源有效、撤销生效，既有经历不冒充当前笔记事实；普通 Personal 与提取开关的现有耦合按 D10 处理 |
| 已 closeout 任务涉及的新增改动全部在 B-135 全量完成 | REQ/AC-11；T-01、T-19、T-21、T-22，以及各领域实现任务 | 新需求、设计发现、代码修复、迁移、回归和 App/device 缺口均记录在本 Tracker；旧包不增加任务或改回执行状态，旧契约按实际交付更新并指向 B-135 |

后续新增发现先映射现有 T-xx；确需新增任务时在本表所属 Tasks 中追加稳定 ID，并补需求、依赖、最小验证和完成条件。不得把未完成验收转移到旧 track 以关闭 B-135。

## Validation Plan

每个 slice 开始前补齐精确测试选取与输入身份；下表给最小证明问题和现有入口。新 fixture 只为未覆盖不变量添加，不为文案或实现镜像新建测试平台。

| REQ/AC or risk | Change / tasks | Minimum sufficient evidence / command | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- | --- |
| 文档权威与全量归属 | T-01 | `npm run docs:check`；`npm run test:docs -- --runInBand`；`git diff --check`；比对旧包 diff | 链接/ID/1 Now+1 Next/合约通过；旧任务无新增阶段；讨论无遗漏 | 任何契约、索引、Tracker/SDD 或 checker 输入改变 |
| T-06 已开始正文跨软截止 | loop接收使用原hardAt；terminal policy收尾 | loop fake timers：soft70/hard100；75时stop/error/abort/tool；100时未完成正文；现有reasoning/buffered/lease回归 | 正文不改为thinking或重答；至多一次请求；工具零执行；原硬截止与取消生效 | consumer/clock/dispatch/terminal policy修改重跑；Chat可读呈现另由T-07 App证明 |
| T-07 可读内容与作品分离 | 独立preview decoder、bridge宿主门、Chat显示与恢复提示 | writing-preview/stream-bridge/chat-view/旧decoder suites；来源guard撤销、前缀/转义、取消/错误、reload；随后受影响Desktop/UI验证 | 预览不成版；原字符保留；无效身份/来源不可曝露；失败保留获准正文和状态；旧记录仍可恢复 | 协议/parser/事件/source guard/persistence变化失效对应证据；native替换时复验组合路径 |
| 结束、deadline、诊断，AC-05/14/15/16 | T-05–T-07 | 现有 runtime/loop/chunk-consumer/stream-bridge 测试，加 fake-clock 与 array chunk 对照；`npm test -- --runInBand <affected suites>` | stop/length/missing finish/tailerror/deadline 分离，partial 可读，硬期限不延期，late tools 零执行 | clock/completion/adapter 共享变更扩大至所有 transport，UI 变更补 app |
| 默认/退出与旧值，AC-17 | T-08/T-09 | `npm test -- --runInBand __tests__/settings.test.ts __tests__/plugin-lifecycle.test.ts __tests__/retrieval-habit-profile.test.ts`；实际 scheduler 相关测试按 SDD 选取 | raw missing/true/false/paused/unknown + 11/10/01/00，真实触发成功、停用零收集；失败保存不先变权限 | normalization/persistence/scheduler/governance 变更扩大相邻回归；Desktop/iOS 设置 smoke 为阶段门 |
| Personal/style/Memory 语义，AC-04/09/10 | T-10/T-11 | `npm test -- --runInBand __tests__/plugin-record-note.test.ts` 及 SDD 中 admission/Type A/context suites；混合消息样例 | 提取输入准入与两条持久化准入一致；任务要求不变长期风格，真事实不整体丢弃；退出/forget 有效 | persisted metadata/reader/治理门变化扩大旧新 reader 与上下文回归 |
| 语义/范围/history，AC-01/02/03/04/08/13 | T-12–T-15 | runtime/control/prepare/projector/history/Operations 受影响 suites；真实模型固定案例；Desktop Chat/Operations smoke | 原句仍咨询；禁网/当前笔记/跨轮更正/选第二个成立；来源批次合法；未确认零写入 | prompt/model/provider/投影/工具状态变化重跑相关语义案例；不因纯 docs 重跑 runtime |
| 输出/版本/保存，AC-05/06/07/08/10/11 | T-16–T-19 | writing-output/version/style、bridge/history、Chat/save 现有 suites；P0 live provider；Desktop/iOS 图文流 | Unicode/空白/hash/parent/material 精确；截断不成版，部分保存真实，旧记录可读且不串图 | native schema/serializer/persistence/image/save lifecycle 漂移使相应证据失效 |
| 当前 Settings/Agent 契约，AC-01/02/13/17 | T-22：同步已交付默认、同一 Agent 选工具及 Operations 提议边界 | 定向比对当前源码、Product Spec/SDD 与两份 Architecture；`npm run docs:check`；`npm run test:docs -- --runInBand`；`git diff --check` | 不再声称学习默认关闭或存在独立任务 classifier/本地写入意图门；旧 B-106 不重开，D15 与 iOS 状态不被提前改写 | 当前源码、权威契约、文档 checker 或链接改变时重跑；native 默认最终措辞等待 D15 后单独同步 |
| 综合质量/成本及所有 AC | T-20/T-21 | `npm run lint`；`npm run build`；`npm run test:all -- --runInBand`；AGENTS 社区 source scan；未覆盖 App/provider/device | 自然退出，全部 AC 有对应证据；真实模型结果与调用成本分别记录，不承诺固定提速比例 | 源码/tests/fixtures/config/deps/build/environment 任一相关输入改变；共享改动扩大 |

UI/runtime 的阶段验证使用 `make deploy` 或符合复用条件的 current-build 部署，随后真实观察交互；iOS 按真实设备 skill。已被 enclosing gate 覆盖的命令不重复跑，缺少环境只记录未测，不能把阶段标 Done。全量目标中的 P0 和语义对照使用有界测试样例与现有模型配置，不额外发送真实私人笔记；涉及未决产品路径先等待该选择。

## Findings

2026-09-09 本次任务核对将新增恢复问题 F-17/F-18 统一纳入 T-07；后续先完成其修复及定向复核，再补阶段 App 验证。既有代码和历史验证记录保留，本次文档更新不将未修问题标为完成。

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-23 | P2 model quality | 修复空ID后DeepSeek native把中文弯引号改成ASCII直引号；旧协议同明确边界样例保留正确 | T-03/T-20保留两侧原参数与用户正文等式；D14不自动豁免新的单侧差异，不改decoder掩盖模型输出 | provider正文到artifact两者精确，native对用户原文FAIL、旧协议PASS；单案不足率估计，后续质量验收继续 | Open — DeepSeek quote fidelity |
| F-21 | P2 implementation | 来源范围已提交后仍只提示首次声明；DeepSeek旧协议连续重复三次相同声明 | T-12/T-14按真实host snapshot区分未声明/已接受，允许无新取材直接输出；真实收窄仍原门 | provider输入及candidate/reject/narrow先RED；4 suites/103 tests PASS。三次上限截断不是完整旧协议失败；新构建旧协议一次声明后交付，native准备后直接交付 | Closed — implementation and bounded App-runtime |
| F-22 | P2 compatibility | DeepSeek首帧有id/index，续帧空id+同index被误拒绝，提前停止导致正文空和finish未知 | T-03/T-17只在已有同index锚点下解释空id为省略；无锚点/异index/冲突/混批仍拒绝 | 真实SDK帧定位；collector先RED，3 suites/123 tests含adapter-loop-bridge PASS；新构建真实DeepSeek完整参数及tool_calls、唯一artifact与provider正文精确相等 | Closed — compatibility shape and bounded App-runtime |
| F-19 | P2 implementation | 有效context后仍无条件提示先准备，模型12次改写scene并重复准备至deadline | T-16/T-20按有效receipt切换指导；语义同义改写不构成准备理由，仍保留真实更正/新证据/失效改选 | runtime状态输入先RED后PASS；同自然语言App案例2请求/1准备/无ack，独立复核 | Closed — bounded app-runtime sample; broader semantic quality pending |
| F-20 | P2 model quality | 原逐字提示在新旧协议均删除行标签/引号并错误声称逐字；明确正文范围后两者正确 | T-03/T-20保留失败及四案对照；D14允许与协议兼容性分开评估，其它切换门不变 | 原提示仍失败；非已证明的native专属退化，不能以明确边界案例覆盖 | Open — shared model quality |
| F-24 | P2 implementation | legacy部分回答已持久化`user_abort`，但旧记录缺`turnStatus`，重开后被默认成`completed`并显示“Answer completed with warning” | 新写入在已有`user_abort`时明确序列化`aborted`；旧reader仅对同一既有warning推导`aborted`，其他旧记录保持原默认 | manager新/旧格式回归32 tests PASS；当前完整gate 276 suites/7620 tests PASS；实际Desktop重载后正文精确且显示`Generation cancelled` | Closed — narrow compatibility fix |
| F-17 | P2 implementation | 异常后的异步渲染/保存期间仍接收迟到正文，现场与已捕获的历史内容可能不同 | T-07：异常结算关闭流回调，渲染与恢复身份独立；旧 render 被取消不阻止有效恢复重渲染 | deferred save 迟到 legacy/canonical、deferred render 异常/取消回归；249 Chat tests 与独立复核通过，关闭/切会话身份保护保留 | Closed — automated scope only |
| F-18 | P2 implementation | typed partial-output-error 后正常 resolve 或 writingRecovery 缺少持久化中断标记，重开可能恢复完成操作 | T-07：所有部分结果在持久化前统一中断 warning，现场与 reload 共同使用 | typed partial/writingRecovery 保存重开，正文/result/Add to Editor/用户取消 warning；249 Chat tests 与独立复核通过 | Closed — automated scope only |
| F-01 | P1 design | 新默认仍可能被旧 consent 门压回关闭，旧 true 迁移还会制造当前 confirmedAt | T-08/T-09 同步默认、实际准入和历史事实 | settings/load/runtime/collector fixtures + 真实宿主回执 | Closed — 默认/旧值不要求 confirmed，未制造 confirmedAt；显式 paused 保留 |
| F-02 | P1 design | 来源不明旧 false 无法从持久化值可靠判断是否人为关闭 | D8 已选择：无明确关闭证据即按新默认开启，不声称推断出用户历史意愿 | T-08 raw settings matrix，明确关闭/暂停优先，迁移只运行一次 | Closed — D8 已实现并经真实宿主 load/save/reload 通过 |
| F-03 | P1 design | 首请求带背景后，不能再实现任意自然语言“不发送”的前置承诺 | D1将承诺限定为首发前可证实结构化准入；更严格自然语言发送限制不纳入现有能力 | 当前笔记+背景组合及每次物理发送重验，不靠回答自证 | Closed — explicit product boundary and automated physical matrix |
| F-04 | P1 design | native 工具结束曾落 unknown；参数完整不等于真实完成 | adapter保留provider `tool_calls`/`stop`，loop/bridge分别记录完成、schema和transport | 自动finish/tail/format矩阵及真实DeepSeek SDK帧；App门仍归T-03/T-05 | Closed — implementation and bounded provider compatibility |
| F-05 | P1 design | non-ordinary 在 Type A 前被滤除，单改 prompt 无法实现语义分层 | Type A语义候选与宿主来源事实分层，提取输入及两条最终准入均接通 | 混合事实+任务、旧新reader和当前Qwen 1/0/2候选；更广质量归T-10/T-20 | Closed — implementation; broader semantic quality remains |
| F-06 | P2 design | 新增任务曾误归 B-106，并将其 Validated 改 Planned；稳定文档也有旧归属残留 | 本轮恢复旧包，全部新增任务归本 Tracker，Brief/DEC005/021/Habit/Pagelet 的新工作入口全部修正 | 旧三文件 diff 为空；独立复核及新 owner 引用检查 | Closed — docs only |
| F-07 | P1 design | 普通 Personal 已有读取受 extraction 门影响，直接拆门会改变发送行为 | D10已获明确同意并按Memory/来源/遗忘门拆开新增提取与已有画像读取 | plugin、真实宿主停用/撤销/重载及非空Personal+style实际SDK输入 | Closed — implementation and host/runtime evidence; device gate remains |
| F-08 | P2 implementation | T-05初稿将所有buffered完成都豁免overrun，softAt后才完成可能再触发模型请求 | 按实际completedTextAt与softAt比较；早完成仅tail拖延才豁免，晚完成保留原有界overrun；buffered fixture实际通知dispatch | with/without finish、单次model调用、tail-hang的buffered真实路径；独立复核确认关闭 | Closed — source scope only |
| F-09 | P2 implementation | T-06初稿正文转工具后仍用hardAt，late tool可在execute前进入有副作用的prepareBatch | early tool恢复softAt；late tool在入buffer前拒绝并保留正文/警告，不申请第二请求 | early tool收尾额度、late prepareBatch/execute双spy；独立复核 | Closed — source scope only |
| F-10 | P2 implementation | 新正文终局分支可能绕过没有finalizeAfterTurn的Pagelet来源验证，导致合法结果最终被清空 | 本分支保留旧host afterTurn验证，并将continue约束成terminal incomplete，不能再dispatch | 真实Pagelet policy的接受/拒绝及continue回归；独立复核 | Closed — source scope only |
| F-11 | P2 implementation | 取消/transport cleanup 的signal被runtime、style选择及笔记来源回执误当来源撤销，导致正文预览清空或正常作品拒绝 | 分开生成准入与来源事实；准备仍检查signal，来源回执保留epoch/file/stat/path/治理检查 | 真实runtime+governed style取消、stop+tailerror、Forget；plugin note-backed receipt；独立复核及完整gate | Closed — automated scope only |
| F-12 | P2 implementation | 普通回答取消时createTerminalEntry删除已显示正文 | 有正文且真实用户取消时保存partial历史和警告；零正文保留取消行；关闭时释放render owner | Chat普通正文/零正文cancel、late chunk、owner释放；独立复核及完整gate | Closed — automated scope only |
| F-13 | P2 implementation | 取消后拒收全部生命周期事件，使保留正文的canonical状态缺失，现场/reload可能误示完成 | 同一已取消run只接收终态状态，不接收迟到正文/来源；恢复持久化记录aborted | mock DOM真正click cancel、晚到预览、持久化/reload状态与提示；独立复核及完整gate | Closed — automated scope only |

## Validation Log

2026-09-12 P1旧协议Desktop中断/恢复映射：Plan P1 exit、AC-05/14 → 复用同一已部署构建和当前Qwen配置，保存原active conversation，使用隔离会话并保持默认legacy协议；先记录真实provider正常完成，若有界重试内均来不及中断，改用同一已加载Chat的可控legacy流，在第二块可读正文后触发当前停止按钮 → 现场和重载均保留相同部分正文及取消警告，旧缺失`turnStatus`记录仅依既有`user_abort`恢复为`aborted`，不产生作品版本或完成操作 → 只补Plan明确要求的legacy Desktop门，不重复native/provider/schema矩阵；provider、legacy decoder、Chat取消/持久化或部署bundle变化时重验。可控流只证明Desktop Chat生命周期，不冒充provider时序或iOS。

- [脱敏结构证据](evidence/2026-09-12-legacy-desktop-completion-interruption.json)、[Qwen legacy正常完成](evidence/2026-09-12-qwen-legacy-completed.png)及[legacy中断重载](evidence/2026-09-12-legacy-interrupted-reload.png)：真实Qwen `qwen3.8-max`输出978字符，provider completion/stop reason均为`stop`、历史`completed`、零warning/来源/作品版本。两次真实请求都在停止触发前完成，因此不做第三次同因重试；首案作为正常完成证据，中断则换用可控transport。
- 可控legacy流在实际已加载Obsidian Desktop Chat通过当前`.cancel-button`中断，精确保留`《雾中码头》\n\n退潮以后，红色浮标慢慢倾斜，`、`user_abort`、零版本与零恢复入口。重载首次暴露 F-24：旧记录没有`turnStatus`时界面显示已完成；窄修复后同一记录恢复`aborted`、显示“Generation cancelled”，正文精确、无Add to Editor/Share。
- 实现只在序列化/反序列化的既有`user_abort`分支补齐`aborted`，其他旧记录行为不变。`chat-history-manager` 1 suite/32 tests PASS，TypeScript和diff检查PASS；当前输入仅运行一次`make deploy`，platform guard/lint/production build及276 suites/7620 tests全部PASS（308.785s，自然exit 0）。新bundle与test vault部署件SHA-256均为`561a3016…898fc52`。没有为通过而扩展状态框架或新测试矩阵。
- 清理后三条隔离会话全部删除，conversation回到3且active恢复为原会话`86c42fff-d476-4b8d-8ed2-db1d7cd092cf`，原首条用户内容及Memory/Web开关保持，modal为0；test根目录无`.b135-legacy-*`临时文件，主工作区保持干净。
- 独立只读审阅未发现P0–P2或阻塞问题：明确canonical/turn status优先，仅在缺失时依既有`user_abort`回退；其他warning/无证据旧记录仍默认`completed`，warning克隆与其他持久字段未变。最终`npm run docs:check` PASS（206 Markdown/1827 links，4项既有advisory），文档契约2 suites/58 tests PASS（5.929s，自然exit 0），diff check通过；社区DOM源扫描零匹配（exit 1为PASS），证据文件敏感字段扫描零匹配。文档/回执修订不改上述runtime/full-gate输入，不重跑。

2026-09-12 T-06/P1收口校准：只读对照Plan P1 exit、SDD AC-15/16、当前源码/测试与Tracker全部既有证据，确认无新的工程缺口。统一起点、startup/fallback不重开预算、正文跨softAt、原hardAt/取消、late tool零执行与生产terminal policy已有定时回归；三轴诊断在作品/恢复投影前，宿主`attemptId`贯穿真实runtime→AIUtils→SDK→transport，并覆盖序列化限额、重试、context summary、query rewrite/rerank及debug/敏感信息边界。F-14/F-15及其他时钟/终态finding已独立复核关闭；当前`make deploy` 276 suites/7620 tests全门包含上述回归，P1宿主出口由本旧协议Desktop中断/重载证据完成。SDD已声明这不是全run成本账单，该对照保留在T-20；iOS属后续阶段门。本次只校准Tracker旧待办措辞，不改runtime/tests/config/dependencies，不新增或重跑测试矩阵。

2026-09-12 T-05–T-07 Desktop流式中断/恢复映射：AC-05/14/15/16 → 在当前部署构建和 repo-local test vault 中保存原 active conversation，打开空白隔离 Chat，并只对该 view 显式启用尚未默认发布的 native 作品候选；使用已配置 provider 与固定合成长文提示，在实际作品 preview 首次出现后触发当前 DOM 的停止按钮，同时捕获窗口截图、现场文字/状态和持久化 turn；随后真实卸载/启用插件，打开恢复入口并人工选取获准正文恢复为版本 → 预览中断前可读，停止后不生成 completed artifact/额外模型轮，历史标记真实中断，重载不冒充完成，恢复无需再次调用模型且生成的正文/hash/来源状态精确；完成后撤销测试数据并恢复原会话 → 若真实 provider 在有界等待内没有可取消 preview，则保留真实结果并改用同接口 scripted transport 只证明 UI 生命周期，不把它写成 provider PASS；provider/model、native schema/bridge、Chat取消/恢复、部署bundle或App版本变化时重验。CLI DOM事件与 Electron窗口截图可证明真实宿主渲染，仍不代替鼠标手势或 iOS。

- [脱敏结构证据](evidence/2026-09-12-qwen-native-interrupt-recovery.json)与[中断后](evidence/2026-09-12-qwen-native-interrupt-after.png)、[首次重载](evidence/2026-09-12-qwen-native-interrupt-reload.png)、[恢复版本](evidence/2026-09-12-qwen-native-interrupt-recovered-version.png)窗口记录：Obsidian 1.14.1、PA 2.9.2、Qwen `qwen3.8-max`，部署生产源码/构建身份仍为`0bbe12b`/`0fb0aba1…684`。仅隔离view临时开启native，发起请求时Memory/Web均临时关闭，`task/personal/insights/style/parent/pagelet`均为`none`且images为空；合成提示没有个人内容。
- 实际Qwen先完成`get_writing_context`并进入`present_writing`参数流；作品preview出现`《青色灯塔》\n雨后石阶还`后触发停止。已提交可读正文为`《青色灯塔》`及后续36字片段，canonical/persisted turn均为`aborted`、`user_abort`、`incomplete`、`shareCardEligible:false`，恢复前版本数0；没有取消后的额外assistant canonical消息。第一次真实插件重载仍显示同一部分正文、取消状态和一个恢复入口。
- 恢复窗口原始字段只读；为避免把JSON中的`\\n`转义字面量写入作品，实际选取从`雨后石阶`开始的连续正文，未编辑选择结果。宿主本地生成唯一`ai_generated`版本，正文SHA256 `755f48db2653b3be1cde544b9b1cbfd9f285caf5da1c82316a0e38ec26bb15b2`，`referenceScope:request`且所有来源状态仍为`none`/空；恢复路径没有模型调用。第二次插件重载后同一version ID、正文、来源快照、原中断历史和“Writing versions”入口精确恢复。
- 清理删除隔离会话后conversation由4回到3，隔离版本0且按ID读取为空；原active conversation `86c42fff-d476-4b8d-8ed2-db1d7cd092cf`、两条历史、Memory/Web true及Qwen配置恢复，debug/mobile关闭，test根目录临时文件清空。首轮preview截图被上一片遗留modal遮挡，已弃用且未纳入证据；现有截图与DOM事件证明真实宿主路径，不声称鼠标手势或iOS PASS。此片证明用户取消/恢复，不证明T-06自动hard deadline诊断或Qwen正常finish。
- 本片只新增Tracker、脱敏JSON和三张现有宿主截图；`npm run docs:check`通过（206 Markdown/1824 links，4项既有advisory），文档契约2 suites/58 tests PASS（5.905s，自然exit0），`git diff --check`通过。运行时输入未变，不重复build/full Jest或扩展协议矩阵。

2026-09-12 T-16–T-19 图文多版本实际宿主组合映射：AC-05/06/08/09/10/11 → 在已加载且构建身份已核对的 repo-local test vault 中创建隔离会话，复用已登记的 `vault_reference` 图片，写入两个正文不同、scene 相同且第二版绑定获准 style revision 的真实 WritingVersion，并经实际 Obsidian modal DOM 选择、编辑/复制和保存 → 核对版本顺序、当前正文、材料与风格引用、剪贴板、保存预览、完成 SaveReceipt、笔记正文/图片引用/hash、关闭重开后的可读状态；最后恢复原 active conversation，删除测试笔记与隔离会话并核对版本/receipt/owner 回收 → 只把真实宿主服务、IndexedDB、Vault 和 DOM 实际经过的结果记为 PASS；CLI 触发的 DOM 事件不冒充鼠标视觉验收，Desktop full-ui 与 iOS 仍单列 → writing version/store/modal/save/image ownership、部署 build 或 test-vault 环境任一变化时重验对应组合。

- 实际宿主为 Obsidian 1.14.1、PA 2.9.2；部署 bundle SHA256 `0fb0aba1e069086ec821f979fba9749d0d82146d8d8082b19327610705a4d684`，对应生产源码提交 `0bbe12ba4313ae537990d3d5208496f3c12bc312`。其后提交至本次输入只改 tests/docs，未改变生产源码、配置、依赖或 build；因此复用该明确构建身份，不把当前分支 HEAD 本身当部署证明。
- 隔离会话复用现有 `vault_reference` JPEG（SHA256 `f79fa62ac0f90982ed5cefd36fc53bc3a6434840540659c8a076747e34f31b6f`）。实际 WritingVersionService/IndexedDB 先写两份 AI 版本，第二版绑定第一版 parent、同一图片、travel/social-share/friends/copywriting scene 和一条通过显式 remember 创建的 style revision。实际作品弹窗显示两项版本、第二版 `Associated images (1)` / `Style samples (1)`；切至第一版显示不同正文和零 style，切回第二版展开详情后显示精确授权样例正文。正确生产预算下 style context 含唯一 revision，`isCurrent` 与独立 `isSourceCurrent` 均为 true。
- 在弹窗把第二版改为 `B-135 人工编辑版：海风掠过旧城，暮色温柔，灯火渐次亮起。` 并点 Copy；剪贴板逐字相等、状态为 copied，持久化 `user_edited` 子版继续保留图片/style/scene。再点 Save 时按现有选择行为留下另一份同正文人工子版；保存弹窗默认勾选一张图。Preview 阶段目标文件不存在，展示的 incomplete provenance 绑定该最终人工版本、正文 hash `8ef964946a24d444f1b34dde4cc10211750953281d2a1b53af1f322a92dd67b1` 与原图 hash；未提前写笔记。
- 确认后 `SaveReceipt` 为 `completed/completed`，transfer 为 `reference`，原图路径仍是 `pa-8eb638874373ff8e-1.jpg`；笔记含精确人工正文、`![[pa-8eb638874373ff8e-1.jpg]]` 与 completed provenance，实读 SHA256 `c12c103407217d8820bb33fe62f5b8f8afde0a79fcbf4879e00f88ab9e438569` 等于 receipt `finalNoteHash`/`noteContentHash`。原图仍在且 asset identity 未变。
- 随后真实卸载/启用插件并重新打开 Chat：原 turn、作品按钮、四个版本、completed receipt、style context 和图片均从新服务实例读回；选择已保存的第四版得到精确人工正文，引用详情明确标记 local edit 继承来源，并显示同一图片及精确 style 样例。这证明当前构建的实际 App service→IndexedDB→Vault→modal DOM 组合；事件由 Obsidian CLI 注入当前真实 DOM，没有鼠标截图/视觉布局证据，也不证明图片模型语义或 iOS。
- 清理使用产品治理 Undo 撤回临时 style：revision/正文删除、prompt projection 为空、设置面板零 style record；治理账本按契约保留无正文的 `undone_add_tombstone` 与 redacted link。测试笔记/唯一文件夹删除，隔离会话删除后 versions/receipts 均为 0；图片 owner 集合与测试前逐项相等，原 active conversation 和两条历史消息恢复，全部 `.b135-*` 临时文件已移除。

T-15 Operations语义提议：AC-13 → 删除latest-message关键词门，按live opt-in/controller/四core动作/原policy导出与执行；prompt承接目标语义 → 无关键词续轮可提议但未确认零写、关闭拒绝、普通回答不产生卡片、原stale/Undo回归 → tool schema与stage一致，真实语义质量另需模型案例 → action/policy/prompt/source准备变化复验；T-13来源整批预检未完成前不关闭T-15。

2026-09-09 续轮确认与定向验证：Owner 对 D11 明确降级版本边界答复“同意”，同步 Decision/Spec/SDD，本次确认不代表格式已升级或降级验收通过。T-15 当前输入运行 `npm test -- --runInBand __tests__/operations-agent-runtime.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-runtime-prompt.test.ts`，3 suites/82 tests PASS，1.771 s，自然 exit 0；含模型开始后关闭 Operations 的拒绝反例。脚本模型仅证明宿主准入与 staging，不证明实际模型语义质量。当前变更仍未部署，无新增 App/device 证据。

T-10 exact Profile revision：来源/revision身份风险 → plugin传递并核对worker的targetRevisionId，在Profile写前重验active revision/link/lifecycle → 缺行/已有行在worker读后切换revision的先RED反例、旧outbox pending零修改、新revision outbox正常应用 → source/fixture变化或失败复验。独立执行者仅修改plugin.ts和plugin-record-note.test.ts；主线程汇总最终证据。

- 已传递targetRevisionId，按exact revision查正文/来源并核对summary/active/link/Forget。两个反例先RED（旧callback错误mutate一次），修复后缺行/已有行均零旧写入、旧outbox pending，新revision任务applied。plugin-record-note整suite346 tests PASS，15.184s，自然exit 0，包含既有bootstrap/upsert/stale/partial commit恢复。常规入口同一memoryLifecycleMutationTail串行，非跨库原子提交；绕过队列的writer不由本片证明。
- 主线程补memory-profile-projection-worker 1suite/7 tests PASS，0.721s，自然exit 0；冻结后的tsc/Lint自然exit 0，diff通过。独立只读复核无必须修复问题，确认覆盖worker取快照后到plugin读取证据前revision变化的窗口，不扩张为任意外部并发证明。未部署当前build/App；D11仍Pending。

T-04 旧读取机制实验：新凭据降级风险 → 当前未修改且与HEAD一致的memory-governance-persistence读取器，完整revision与Queue envelope添加未知receipt字段、未知来源/版本反例 → 未知receipt被剥弃而原summary/envelope/ruleFingerprint保留；未知来源/版本拒绝整个状态而非只忽略新记录 → 1 suite/25 tests PASS，0.985 s，自然exit 0。初次fixture误用pending状态，实际契约为suggested；修正fixture保留校验。此片是读取/构造器证据，不是旧插件确认/恢复/降级全链。实际旧bootstrap失败还会建立legacy兼容入口，需进一步验明，不能把parser拒绝等同于所有路径安全。

T-04/T-10 来源审阅与精确引用定位：AC-10 → 独立语义审阅source collector保留hostKind/unknown，不沿用ordinary准入；宿主按实际呈现前缀精确定位quote → 混合事实/临时改稿、无metadata、重复ID、重复quote、截断/Unicode反例 → 未授长期权限、未改旧receipt；只返回宿主身份/hash/span → collector/预算/receipt变更复验；TypeA模型接入及两条最终准入仍须完成后才切换。

- 新helper保留mixed writing_request/user_local_edit供语义审阅，无provenance为unclassified，非法provenance不fallback，排除ai_draft/explicit_style_action及重复ID。旧collector/receipt/admission不变；当前未接生产scheduler或model，所以不是新提取规则已上线。
- UTF-16预算前缀不切开合法surrogate pair；quote在传入前缀内唯一精确匹配，host返回span与full/projection/quote hash。其含义仅来源定位；调用者后续必须从真实provider投影快照传入presentedText，不能使用模型自报。前缀唯一不是全文唯一，定位成功不能证明个人长期意图或授予权限。
- 2 suites/49 tests PASS，0.932 s，自然exit 0：chat-memory-semantic-sources、b129-chat-memory-admission；最终tsc/Lint自然exit 0、diff通过。独立只读复核无必须修复问题，明确本片不证明Type-A实际输入、两条持久化门或新receipt旧reader兼容，T-04/T-10不标完成。
- 两条最终门只读核对：Type-A在plugin候选校验后只生成conversation provenance；Queue builder只处理note sourceRefs。新Chat receipt须独立typed字段贯穿admission/envelope/revision，静态校验落coordinator.prepareAdmission，消息当前性沿既有lifetime/final commit guard；Queue现未传该guard，且不得回落ReviewQueueStore.create。不能伪造note来源或塞metadata。
- Profile outbox已带targetRevisionId，无需复制原文；plugin applyExactProfileProjection目前丢掉该ID并读取active revision，后续须接收/核对确切revision并传递receipt。Queue claim存在trim/用户编辑，最终claim绑定须在规范化后核验；不能照搬旧receipt。新parser白名单及revision构造也须同步。
- 旧reader兼容风险已确认但未完成实验：parseRevision/parseMemoryQueueAdmission会剥掉新optional receipt而继续保留合法v1数据；ruleFingerprint仅非空校验，新增文本不足以保护旧版确认/恢复。后续需实际旧reader对queue/revision/outbox往返，确定可识别的失败关闭版本边界；未解决前不接通新语义持久化，不把additive字段当兼容证明。

T-03/T-17 当前完整schema真实模型验证：AC-06/07/14 → 从当前writing-output源码生成native schema/指令，已加载test宿主factory绑定并发送固定合成文字 → 记录声明、配置、原始id/index/name/args、finish及精确正文，随后当前adapter/loop/bridge回放 → 当前模型接受完整声明、唯一输出正常结束且正文保真 → schema/SDK/模型配置变化重验；旧已加载host仅证明factory/transport，不冒充当前工作树部署或真实UI。

- 2026-09-09 新探针 `__paB135CurrentSchemaProbe`，startedAt=1788948625332，完成状态经同一句柄核对后读取。test已加载host 2.9.2、qwen/qwen3.8-max、thinking=true、temperature=0、maxTokens=2048；源码生成完整schema含enum/minLength与当前native指令，固定合成文字，不读笔记/Memory、不执行工具/保存作品。126 chunks、39原始参数片段、finish仅tool_calls，12007ms；解码正文与输入逐字符相等。单次耗时不是性能结论。
- 保存 `__tests__/fixtures/b135-current-schema-trace.json`；测试核对捕获声明与当前源码schema/instruction完全一致，真实片段经当前adapter→loop→bridge产生非空部分预览和唯一精确作品，结束后全事件重放不重复成版。声明变化会要求重新取得相应证据。
- 冻结输入后4 suites/125 tests PASS，2.052 s，自然 exit 0：native-writing-bridge、native-writing-call、native-writing-output、pa-agent-writing-preview。最终tsc自然exit 0，diff通过；独立复核确认schema、原参数与正文一致，无必须修复问题。本轮仅tests/fixture/docs变化，runtime/Lint证据输入不变。
- 复核边界：fixture为39个参数增量及分别汇总的text/finish，不是原126个SDK chunk全帧记录；回放重新组成前置文字→参数→结束，不证明原始分组/usage/时序。此次真实preamble未单独断言，沿用独立preamble回归。temperature/maxTokens/transport由实际探针调用记录证明，非fixture自身字段；单次准确复写不等于始终准确或整体质量验收。
- test磁盘bundle SHA256仍为d21e45b0e99adf347ccdac9fb1920b7ed8e3041d7d836819d16452d2f337214e，未部署当前工作树。此证据属于当前声明+已加载factory的合成文字兼容和当前代码离线回放；不证明真实图片、多provider、iOS、完整Chat宿主输入与实际保存操作。默认协议仍不切换。

T-17/T-19 图片与授权 style 组合：AC-08/09/11 → 真实 runtime native 路径沿既有 ImageRequestScope 准备像素与宿主来源回执 → 两张顺序图片+历史未选择图片、来源撤销、授权style输入及artifact关联/lease释放 → 仅当前选择像素进入请求、宿主决定作品关联、撤销不成版，旧reader独立验证 → 图片投影/bridge/source/存储变化复验；合成bytes不证明真实图片模型能力。

- 两张合成图片通过真实 runtime/图片 scope/授权style 服务进入物理 provider 输入，断言两个 data URL 顺序；resolveVariant 仅收到当前两张ref，未解析历史未选择图片的像素。artifact保留宿主关联图片和style revision，共用release spy累计调用两次。来源在预览后撤销时零artifact且recovery raw/preview清空。初次 revoke 用例同时注入 tail-error，实际正确抛 provider_failed；隔离为正常finish只测来源撤销，不把传输故障当来源判据。
- 捕获的真实 native 参数经完整decoder、既有WritingVersionService和两种history store保存，与旧JSON恢复记录并存。旧reader读回精确正文/hash/图片/style/背景引用；聊天前置说明保留而版本正文不混入。IndexedDB模拟器使用同一factory创建新store再initialize；memory仅重建service，不声称持久重启。三个reader文件相对本分支HEAD `c923ee2` 无diff，不声称验证其他历史发行版本或真实browser/device。
- 最终6 suites/127 tests PASS，4.397 s，自然 exit 0：pa-agent-writing-preview、chat-history-store、writing-versions、writing-save-action、chat-writing-output、b129-image-request。最终tsc自然exit 0，diff通过。本轮仅tests/docs变更，runtime/Lint证据输入未变；独立只读复核无必须修复问题。复核明确1 byte合成Blob仅证明投影顺序，不证明JPEG编解码/视觉识别；像素未解析不外推为所有metadata未读取；共用release spy不证明每份资源分别恰好释放一次。复制/编辑/保存/receipt的实际App操作、来源约束后的历史图片选择与完整默认切换仍未完成。

T-17 静态输出登记与控制快照：AC-06/07 → 现有 CapabilityRegistry 保留唯一纯输出名、提供固定 schema 入口，loop 在每个真实 turn 投影宿主输出声明，runtime 按声明绑定 → 注册冲突/普通工具不可执行、最终阶段控制声明、native runtime 与旧模式回归 → 无 provider 可自行登记纯输出、无来源/动作豁免、模型定义与宿主声明一致 → registry/control/loop/runtime 改动重验；生产 reserved-final 组合另补。

- 登记路径只返回固定输出 schema；动态同名注册拒绝且不进入普通 definitions/executor，独立调用返回新 schema，不能由修改上一请求结果污染下一请求。controlSnapshot.writingOutput 每轮由 host 合约重新声明，无合约时剥离；不是模型可扩展的输出类型系统。
- 生产 runtime 可控 Date.now 覆盖模型 setup 到原1000ms预算的750ms（reserve300ms）：普通请求在物理dispatch前退出，收尾只绑定 present_writing，唯一实际 provider 输入仍含授权 style，交付一个精确版本。另四个实际 runtime reserved-final 混批反例（search_memory/get_current_note_context/vault_create/第二present_writing）均 incomplete、零artifact、零tool_execution_start；原截止不延期。
- 冻结源码后6 suites/263 tests PASS，3.772 s，自然 exit 0：capability-registry、native-writing-loop、pa-agent-writing-preview、pa-agent-control-policy、pa-agent-loop、pagelet-agent-runtime。最终tsc/Lint自然 exit 0，diff/社区DOM扫描通过。类型初检指出纯输出名不属于 ChatToolName，保留该类型边界，通过运行时字符串保护与模拟外部同名记录测试解决，没有把纯输出加入普通工具联合类型。独立只读复核未发现必须修复问题，确认当前 prepare/retry 保留控制声明，提示与绑定一致；若后续允许改写声明则需同步投影并补反例。真实新schema/provider、旧reader、图片与App门未由本轮代替。

T-17 runtime 协议候选接入：AC-06/07 → 内部显式 native 模式同步指令、provider schema、原始身份捕获、loop 与 bridge；默认仍走既有协议 → 真实 runtime 的合成 provider、授权 style、完成/取消/Forget 对照及最终阶段 schema 检查 → native 模式无 JSON 文本要求、输出不授予读取/写入、旧默认不变 → schema/prompt/control/runtime/style 变化复验；P0 组合门通过后另切换默认。

- `writingOutputProtocol: "native"` 必须同时有 host writingRequest；固定 present_writing schema 只提供 body、可选 explanation、精确 handle。普通轮提示同步列出纯输出声明，reserved final 指令允许普通文字或唯一作品；最终阶段只追加纯输出 schema，不开放来源/动作。缺少 bindTools 在物理请求前报错，不静默退回旧协议。该内部候选不是用户设置或默认上线。
- 新增真实 runtime→governed style→adapter→loop→bridge 合成模型回归：授权 style 实际进入输入，完整作品保留 revision，取消保留正文、Forget 清空恢复内容；各一条模型请求、零工具执行。缺 bindTools 反例证明 provider 未执行、style 未准备且无作品。首轮三个超时由测试误从 update 而非 event 读取 metadata 导致，停止该失败进程、修正监听后通过，没有增加超时或绕过断言。
- 最终6 suites/260 tests PASS，3.581 s，自然 exit 0：pa-agent-writing-preview、native-writing-loop、native-writing-output、pa-agent-loop、pa-agent-runtime-prompt、pagelet-agent-runtime；tsc 自然 exit 0。Lint 在相同最终 src/__mocks__ 输入通过（随后仅 tests/docs 变动），diff/DOM检查通过。独立只读复核未发现候选路径必须修复问题，未另跑测试。
- 仍待静态登记/control snapshot 一致表达、生产 reserved-final 整链、图片/旧reader、真实 provider 对当前 enum/minLength schema 的兼容与 App/iOS；现有 loop final-only 单测不能代替 production runtime 组合，之前较简 schema 探针也不自动复用于当前绑定 schema。默认未切换，T-17/P0 仍部分完成。

T-17/T-18 native bridge 接入：AC-05/06/07 → loop 输出 host-owned 原参数预览/完成标记，bridge 显式 native handle 模式独立校验、来源重验并复用既有 artifact/recovery → adapter→loop→bridge 真实片段、部分预览/取消/权限撤销/混批/重放对照 → 完整且host允许时一个作品；不完整仅可读恢复，不从完整JSON自行批准 → lifecycle/bridge/来源/旧reader变化复验；runtime默认、Chat展示与持久化组合仍需后续验收。

- loop 原参数累计预览和完成标记在宿主 lifecycle metadata 内传递，不由模型 JSON 自报。bridge 显式 nativeContextHandle 模式要求对应标记、唯一 present_writing、正常 tool_calls、run completed 和来源重验才生成既有 artifact；普通文本可以独立回答，旧 envelope 模式不变。
- 截断/取消保留获准正文，混批撤回预览；独立来源检查拒绝或抛错时不成版，清空 native recovery 的 rawText/preview，避免通过恢复入口重曝撤销内容。补 isCurrent=false、isPreviewCurrent=true 的真实取消形态；未用完整JSON替代权限。
- artifact 增加仅事件内可选 preamble，bridge从当前canonical普通text取原字符；Chat显示及聊天历史用段落间隔连接说明/正文，WritingVersion创建仍只取精确body/explanation，不把说明纳入作品hash、编辑或保存正文。ChatView模拟持久化验证有/无说明均只产生一个正确版本；不是实际App操作证据。
- 独立只读复核未发现 bridge 准入必须修问题；指出的普通说明显示缺口及独立预览门组合已补。中途乱序事件兼容未证明，仅验证agent结束后的全事件重放不重复成版；图片/style/旧reader/真实App仍为后续组合门。
- 冻结本轮输入后 `npm test -- --runInBand __tests__/native-writing-bridge.test.ts __tests__/native-writing-loop.test.ts __tests__/native-writing-call.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-stream-bridge.test.ts __tests__/pa-agent-writing-preview.test.ts __tests__/chat-view.test.ts`：7 suites/473 tests PASS，4.708 s，自然 exit 0；tsc/lint 自然 exit 0，diff 与社区 DOM 扫描通过。补充只读复核确认 preamble 与精确作品正文分离、取消和独立来源门回归无必须修问题；复核者未另跑测试。该证据不覆盖生产 runtime 默认接入、实际旧 reader 或 App/device。

T-03/T-17 loop 纯输出接入：AC-06/07/14/15 → 显式 host nativeWriting 配置、原始 provider identity、严格单调用累计、dispatcher 前纯输出分支、host terminal policy → scripted adapter→loop 的唯一调用/混批/身份冲突/取消/过期/尾帧/final-only/禁止额外轮测试 → 无工具执行、副作用或追加模型轮，宿主最终裁决保留 → loop/adapter/schema/collector 改动复跑；runtime export/bridge/App 默认切换仍为后续门。

- 增加独立 `NativeWritingCallCollector`，每个 delta 都使用显式捕获的原始 provider identity；synthetic/canonical id 不授权。支持省略已知身份字段、合法分块名称、raw/一致 structured 镜像；混批、冲突、缺身份或超预算永久拒绝。adapter 的 `captureToolIdentity` 默认为未启用，stream setup/iteration fallback 均显式传给 invoke adapter。
- loop 只在 host 显式提供 nativeWriting 时启用：完整参数、真实 tool_calls、唯一 canonical 调用、current guard 才成为候选；普通 afterTurn 或 reserved terminal policy 仍执行。宿主 continue 被收束为 incomplete，无额外生成轮；异步检查返回后再验来源/取消。混批全零 prepare/execute，作品不消耗普通工具执行额度。
- 已完成 native 输出立即停止消费 optional EOF/usage tail，给异步 host 检查保留原 hard budget；未观察的尾部状态/usage 不冒充成功或零用量。普通工具/旧文本尾帧规则不变。fake-clock 覆盖 80ms 完成、110ms 超出原100ms截止，以及20ms host检查不被200ms尾部等待挤占；模型/真实网络验证仍另需补齐。
- 复核发现分块工具名会误把前置说明改成 thinking，且原 index 丢失造成两个 canonical buffer。两条反例先 RED：现 opt-in 模式待整批判定再重分类，保存真实 index/后续关联坐标，最终唯一 native 调用补全名称及原始参数。默认旧模式保持原行为。另补两条 invoke fallback 及 id先到/index后引入回归。
- 冻结源码后 `npm test -- --runInBand __tests__/native-writing-loop.test.ts __tests__/native-writing-call.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-started-text.test.ts __tests__/pa-agent-stream-fallback.test.ts __tests__/pa-agent-stream-bridge.test.ts __tests__/pagelet-agent-runtime.test.ts`：7 suites/325 tests PASS，3.47 s，自然 exit 0；tsc/lint 自然 exit 0。lint 初次指出 collector 控制字符正则不符合规则，改为等价字符码检查后重跑通过，未放宽身份约束。此片是 opt-in adapter/loop 证据，不是 runtime schema/bridge、真实模型完整身份 trace、App 或 iOS 验收。
- 随后真实身份探针：旧已加载 test host 的 qwen/qwen3.8-max、thinking=true、maxTokens=2048，仅合成文字，未读笔记/Memory、未执行工具/保存作品；3350ms 返回14个原始工具片段及 tool_calls。`fixtures/b135-native-identity-trace.json` 保留 id/index/name/args，其中最后空片段为 id:null/index:0。实际回放先 RED（误判 incomplete），现 null 只代表省略字段，不清除既有身份；首片全部null仍拒绝，明确冲突仍拒绝。修正两项把SDK缺省误当非法的fixture，保留缺失/冲突反例。
- null 占位兼容修复后同一7 suites/326 tests PASS，3.672 s，自然 exit 0，最终tsc/lint自然 exit 0，docs:check/diff通过（4项既有advisory）；原始片段经真实 adapter→collector→loop 完成且零prepare/execute。该证据证明当前SDK返回形态兼容，不代表新工作树已部署、模型已通过完整Chat宿主输入/bridge/存储或其他provider/iOS门。

T-03/T-17 native 参数完成边界：AC-06/07 → 增加独立完整参数 decoder，绑定宿主 contextHandle、白名单和字符预算 → 真实捕获参数与逐字符截断、重复键、伪造来源/权限/保存字段反例 → 只完整合法参数返回精确 body/explanation，不制造 provider 完成或版本权限 → schema/decoder/bridge 改动复验；loop/最终来源重验和 runtime 默认切换另验证。

- `decodeNativeWritingOutput` 先复用 preview 的重复键/Unicode/白名单验证，再由 JSON.parse 确认完整结构；精确匹配宿主 handle，保留 body/explanation 原字符。独立只读复核无必须修问题。新增 25 个回归覆盖实际捕获参数、所有不完整前缀、错误 handle、空正文、错误类型、伪造宿主字段、包装/重复键、非法代理项和预算边界。
- 最终 `npm test -- --runInBand __tests__/native-writing-output.test.ts __tests__/writing-preview.test.ts __tests__/chat-writing-output.test.ts __tests__/pa-agent-stream-fallback.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-stream-bridge.test.ts`：6 suites/276 tests PASS，1.877 s，自然 exit 0；tsc/lint 自然 exit 0，diff/社区 DOM 扫描通过。helper 尚未接入 runtime 默认路径，T-17 及 P0 均未完成；实际来源/调用身份/终态与当前 App 证据仍需补齐。

T-03/T-05 native finish 接缝：AC-14 → ProviderCompletion 保留独立 tool_calls 值，readProviderCompletion 不再降为 unknown → adapter 使用真实合成参数片段并在 finish 后抛 tail 异常，另跑 loop/bridge → 最终参数先于独立结束事件、tail 失败不触发第二次生成、旧文本成版仍只接受 stop → completion/transport/loop/bridge 改动复跑；此步不启用 native 成版或放宽工具准入。

- 新增真实片段 adapter 反例先 RED，确认 tool_calls 被改为 unknown；修复仅保留该独立 provider 事实，未将其映射为 stop，旧 bridge 的文本成版门保持不变。5 suites/251 tests PASS，2.117 s，自然 exit 0：pa-agent-stream-fallback、pa-agent-loop、pa-agent-stream-bridge、writing-preview、chat-writing-output。最终源码 tsc/lint 自然 exit 0；docs:check 和 diff check 通过，4 项既有文档 advisory。原生工具的后续成版/终局仍待实现。

T-03 当前模型协议与增量预览（2026-09-09）：AC-05/06/07/14 → 复用实际配置模型 factory，合成文本分别走 native 和旧 envelope；新增仅供显示的 native 参数 decoder → 真实 argument delta 回放、UTF-16 每字符截断与现有旧 reader 测试 → 正文保真、部分预览不成版、无额外模型 acknowledgement → schema/adapter/decoder/模型配置变化复验；final-only/混批/终态/旧历史及 App/device 是独立门。

- test vault 已加载的旧 host factory，配置 qwen/qwen3.8-max、thinking=true、maxTokens=2048；两条请求仅发送固定合成正文，不读取笔记/Memory、不执行工具或保存作品。不是当前工作树部署证明。
- 已完成 trace：native 72 chunks、17 argument deltas、单个 present_writing、finish=tool_calls、6174 ms；旧 pa.writing/version=1 envelope 291 chunks、finish=stop、24238 ms。两者正文逐字匹配合成输入；native 原始参数拼接与 SDK concat 后解析正文一致。单次时长不是性能结论；trace 保存在 `__tests__/fixtures/b135-writing-protocol-trace.json`，包含合成输入/返回与实际片段。
- 较早 native 探针参数合法但未逐字复写且未保留 raw，不能归因为协议损失。此前普通 JSON 对照不是旧 PA envelope，解析失败也不能说明旧协议失败；本次完整 envelope 对照通过纠正了这一证据缺口。
- native preview 支持 body 在 contextHandle 前出现，逐片段解码转义/Unicode；宿主仍须独立核验实际工具身份、来源和生命周期。该 helper 不授予 context handle、完成或成版权限，尚未切换生产输出通道。
- `npm test -- --runInBand __tests__/writing-preview.test.ts __tests__/chat-writing-output.test.ts`：2 suites/120 tests PASS，0.856 s，自然 exit 0。真实 native 片段产生多次部分正文快照，最终与捕获参数正文一致；真实旧 envelope 同时通过旧整体和预览 reader。每个 UTF-16 截断、非法参数/重复键/转义及预算反例通过。tsc/lint 自然 exit 0；diff/社区 DOM 扫描通过。docs:check（含删除连续性）206 Markdown/1801 links 通过，4 项既有 advisory。无当前 build/deploy/App 证据。
- 独立只读复核未发现 preview helper 必须修问题；确认回放实际覆盖非空中间快照和最终精确字符。该结论不外推到 runtime 接入、多调用身份、终态或其他 provider/App。

T-10 最终提交准入（2026-09-09）：AC-10/17 → scheduler 提供 host-only batch lifetime/signal，plugin 生命周期队列、逐条 admission 和 cursor 重验，coordinator 复用 repository commit guard → scheduler lifetime、队列后重开、coordinator 操作前/提交前失效及 cursor final-commit 回归 → 旧批次永久失效、无新 claim/cursor 提交；已提交 outbox 继续既有恢复 → scheduler/plugin/coordinator/repository 变更复跑，真实 IndexedDB/App 与来源语义仍是独立门。

- 已实现 batch `isCurrent`/signal（不序列化），coordinator 与 cursor 均传入既有 repository 最终 guard；plugin 同时检查有效提取门、卸载、coordinator/vault 身份。scheduler 停止后旧 batch 永久失效，不因开启新实例恢复。
- 关闭设置在保存成功并发布后立即停止旧 scheduler，再等待通知；新增延迟 watcher→关闭→重开回归，避免异步通知晚于下一次开启而保留旧实例。失败保存仍不提前停止。
- 独立部分提交测试使用真实 backend 的首条 commit 通知使 batch 失效：第一条 claim/outbox 保留，第二条及 cursor 零提交；调用既有 Profile projection 恢复调度，实际计时器已安排并由测试清理。恢复只消费已提交 outbox，不重跑过期 batch。
- 冻结后的统一命令：`npm test -- --runInBand __tests__/memory-admission-coordinator.test.ts __tests__/memory-extraction.test.ts __tests__/memory-governance-persistence.test.ts __tests__/plugin-record-note.test.ts __tests__/plugin-lifecycle.test.ts`，5 suites/550 tests PASS，20.894 s，自然 exit 0；tsc/lint 自然 exit 0，diff check 通过。覆盖 in-memory final-commit 及既有模拟 IndexedDB guard 契约，不声称真实设备事务或 provider 请求取消通过。此前 7 个直接 Type-A admission fixture 未显式启用提取，按新增实际准入补启用前提，原 host evidence/治理断言保持。

T-09/T-10 执行中退出准入（2026-09-09）：AC-17/10 → scheduler 在 durable cursor、模型创建与模型结果三个异步接缝重新检查停止状态 → `memory-extraction` deferred 回归 → 关闭后不启动尚未发送的模型调用，迟到结果不进入 admission、不推进 cursor → scheduler/权限通知/admission 改动复跑；已开始的底层 provider 请求取消与事务排队写入门另行验证。

- 新增三个 deferred 反例，cursor/model 两个先 RED：dispose 后仍 invoke；response 反例已通过，说明原有结果返回门有效。现在 baseline、durable cursor 与模型创建 await 后均重查 disposed，阻止未发送的调用继续启动。
- `npm test -- --runInBand __tests__/memory-extraction.test.ts __tests__/plugin-lifecycle.test.ts`：2 suites/158 tests PASS，2.57 s，自然 exit 0；tsc/lint 自然 exit 0，diff check 通过。这是停止后的发送/结果准入保护，不宣称已发出的网络请求被取消。
- 后续已定位：`admitGovernedTypeABatch` 仅入口读取 Memory 主门，生命周期队列及 coordinator repository transaction 内尚缺有效提取偏好的最终重验；legacy SerializedProfileGovernancePort 有自己的 disposed/队列检查。T-10 要分别证明最终事务准入，不能用本次 scheduler PASS 代替。

T-08/T-09 真实调用链与基线 reader（2026-09-09）：

- AC-17 → 真实 plugin load/merge/migrate/权限队列及 gate→真实 scheduler→Type A 模型适配器、plugin→真实 habit collector→保存 → `plugin-lifecycle` 两条集成回归 → 默认启动/首次说明后推进 48h，无历史查询和模型创建；新 Chat 回合 invoke 一次，关闭取消排队并拒绝新调度；默认 habit 反馈实际落盘，独立关闭后不再记录且 extraction 保持开启 → settings/scheduler/collector/admission/保存变化复跑；历史、模型和 Profile store 是 fixture，不证明真实 provider/App 或执行中最终持久化退出门。
- 最终 `npm test -- --runInBand __tests__/plugin-lifecycle.test.ts __tests__/memory-extraction.test.ts __tests__/retrieval-habit-profile.test.ts`：3 suites/165 tests PASS，3.092 s，自然 exit 0；tsc 自然 exit 0。首次 tsc 指出新 getTurns mock 的零参数签名与 calledWith 不符，补实际 conversationId 参数，不修改生产代码或放宽行为断言。本轮未改变上轮已通过 lint 的 src/locale 输入。
- 实际旧 reader probe：复制 `git show c923ee22089ef3e669b275718bce6052e98d7749:src/settings.ts`（SHA256 `f962e15a16b125f7390f0ceb61c4ccb21b5bbb507de1a6726ab656c98095387a`）为临时模块，与真实新 merge 并行加载；default/enabled/disabled 各经旧 merge、JSON 序列化保存、新 merge，另测旧 paused。4 tests PASS，1.592 s，自然 exit 0。旧 merge 确实压低 extraction 镜像但保留顶层权威，新 reader 恢复正确；临时模块/测试已删除，不保留整份旧生产代码。共享依赖为当前工作树，habit helper 仅默认值改动且所有 probe 输入含显式布尔，不冒充完整旧 App 运行或旧 UI 行为。

T-08/T-09 默认迁移实现（2026-09-09）：

- 顶层版本化 `learningPreferences` 区分产品默认与真实开关动作；旧未知 false 默认开启，paused 保留；四种独立组合经队列保存、无关保存与重载保持，失败不提前生效。删除旧 true → confirmed/当前时间的自动补写；保留 paused 的已有 confirmedAt，不联动 provider、治理暂停或 Vault Insights。
- 独立复核指出仅版本号会被旧 reader 的 false 镜像误导，已改为独立顶层权威偏好。旧保存形状回归通过；真实旧 reader/UI 往返尚未执行，旧 UI 无法更新新版偏好的已知局限记录于 SDD，不称作完整回滚兼容。
- 复核发现默认开启使 Vault Insights 独立 toggle 在 unconfirmed 下可见，但旧即时/重载准入不一致；现独立开启需真实发送/成本确认，再保存确认事实；scheduler/governed/legacy/notice 保持确认门。新增取消不授权、确认后重载保留测试。此确认只由用户操作发生，默认迁移不生成它。
- `npm test -- --runInBand __tests__/settings.test.ts __tests__/plugin-lifecycle.test.ts __tests__/retrieval-habit-profile.test.ts __tests__/plugin-record-note.test.ts __tests__/pa-locales-plugin.test.ts`：5 suites/706 tests PASS，19.824 s，自然 exit 0；tsc/lint 自然 exit 0。首轮旧默认断言与依赖旧默认的权限测试 fixture 已按新契约更新，失败/并发保护断言保留。未复用旧 build/App 身份，T-08/T-09 继续部分实现，实际调度、旧版往返和 App/device 仍为独立门。
- 最终独立只读复核确认 Vault Insights P2 关闭，无新增必须修；docs:check（含 Git 删除连续性）通过，206 Markdown/1801 links，4 项既有 advisory 保留；diff/社区 DOM 源扫描通过。上述 UI 证据为模拟保存与真实 merge，不是 App、真实旧 reader 或 scheduler 生命周期验证。

T-08/T-09 开始（2026-09-09）：AC-17 → 默认版本、raw false/明确 paused 分类、merge/load、真实 extraction gate 和设置确认/说明 → settings/plugin-lifecycle/retrieval-habit-profile/plugin-record-note 现有契约及新增矩阵 → 新默认 11 可用，既有明确暂停保留，迁移后 11/10/01/00 重载不变，旧无 consent true 不制造 confirmedAt；includeVaultInsights 不联动；权限保存失败不提前生效 → defaults/merge/permission/scheduler/collector 改变复跑，旧 reader 与真实 App 属独立门。

T-11 legacy 读取实现（2026-09-09）：

- AC-04/09 → plugin 独立只读快照、onload/设置通知 await、主门/存储 scope/epoch/治理模式/卸载与 mutation 失效 → ExistingUserProfileReader 及 plugin fixture → 关闭提取时已有 Profile 可读、不建可写库/模型/调度器；unknown/无库/空/失败无旧缓存，删除事务不能被迟到 read 复活 → load/watch/reader/mutation/投影变更复跑；来源物理输入与 App 仍是独立门。
- 实现后 5 suites / 510 tests PASS，16.347 s，自然 exit 0（plugin-record-note、plugin-lifecycle、profile-store-existing-reader、memory-extraction、pa-locales-plugin）。初次删除 fixture 使用不合法的自造 profileRecordId，与 sanitizer 生成的稳定 ID 不符；改用实际已读取的规范 ID，未放宽精确删除校验。补冷启动顺序 fixture 后 legacy 定向 15 tests PASS，2.34 s，自然 exit 0；它证明 onload 在后续启动前 await 只读 Profile，不代表完整 App 启动 smoke。
- MCC Profile 使用标志改为 Memory 主门；中文/英文设置描述说明停止学习与停止使用的区别。旧“启用需确认”部分暂保留当前代码事实，T-09 默认/准入切换时再同步，不能提前冒充新默认已生效。源码模式判定额外拒绝治理不可用时启用新 legacy 回退，bootstrap 故障不复活画像。
- 冷启动、重载/保存通知、主门、scope变化、卸载、治理切换、真实 mutation 及读失败为本次自动化范围；跨窗口存储变动与每次 provider 物理发送重新验证尚未完成，T-11/P2 继续未完成。所有变更归 B-135，旧 track 未新增任务。
- 独立审查指出：仅在 refresh 前后检查 legacy 模式仍不足，extraction=true 且 scheduler 缺席时 getter 可能拿旧缓存作 unavailable-governance 回退；cache 候选自身现也要求已知 legacy_threshold，既有 scheduler 兼容路径独立保留。新增 true/false 两种 unavailable 反例后 legacy 16 tests PASS，3.137 s，自然 exit 0；没有凭开关 true 扩张新缓存的治理准入。
- 最终冻结源码后统一相关验证：`npm test -- --runInBand __tests__/plugin-record-note.test.ts __tests__/plugin-lifecycle.test.ts __tests__/profile-store-existing-reader.test.ts __tests__/memory-extraction.test.ts __tests__/pa-locales-plugin.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-runtime-memory.test.ts`，7 suites/593 tests PASS，18.328 s，自然 exit 0；tsc/lint 自然 exit 0，diff/社区 DOM 源扫描通过。独立只读复核确认缓存治理门问题关闭，无新增必须修问题；cold onload fixture 的证明范围限初始化顺序，不是完整 Obsidian 启动。docs:check 通过，4 项原有 advisory 保留；未复用旧 build/App 身份或标 T-11/P2 完成。

T-11 D10 开始（2026-09-09）：REQ/AC-04/09 → governed 已有画像及控制中心/Pagelet 使用状态与新提取门解耦，保留 Memory 主门、claim Pause/Forget、来源校验；Vault Insights 不从 D10 自动取得额外权限 → `plugin-record-note` 的真实 governance fixture 分别切 extraction false/unconfirmed/paused，检查已有正文/trace/UI、主开关/记录暂停/来源撤销反例 → 已有画像可用但新提取运行门仍关闭，不建模型/不采集；legacy 另验证无 scheduler 重载 → plugin callbacks、治理选择、保存/reader/投影变化重跑，最终实际 provider 与 App 证据仍必需。

- governed 首片将 prompt 与 UI 使用门改为 Memory 主门/治理模式，claim 和来源校验仍由原 selector 执行；Vault Insights 保留旧 extraction+consent+include 门，D10 不扩张该能力。
- 先有 4 个目标 RED；修复后新 fixture 未提供 current-note claim 所需当前笔记，补入匹配 scope 并先断言启用基线确实可读，未放宽 selector。`npm test -- --runInBand __tests__/plugin-record-note.test.ts` 325 tests PASS，15.768 s，自然 exit 0；tsc/lint 自然 exit 0。
- 独立只读调查确认 legacy getter 在 scheduler dispose 后没有画像缓存；现有 ExistingUserProfileReader 为不创建数据库的准确只读入口。最小加载/失效设计已写入 SDD，尚未实现；对应冷启动、保存/重载、Forget/迟到 read、主门关闭以及设置说明仍待完成，因此 T-11 不标 Done。
- 现有下游 `chat-service` 与 `pa-agent-runtime-memory` 2 suites / 81 tests PASS，1.954 s，自然 exit 0；只证明已覆盖投影/Memory 接缝无回归，不等于真实 provider 已验证 D10。此 plugin 源码修改使此前构建/部署身份失效，后续合并冻结输入再运行所需 broad gate。
- 独立只读复核 governed selector/UI 无必须修：bootstrap、effect/sensitivity、scope/partition、pending/Forget/suppression、Data Boundary 仍经过原选择器；UI currentlyUsed 与实际读取主门一致。没有发现 runtime/projector 残留的提取/consent 读取门，Vault Insights 原门保留。tsc/lint/diff/DOM 源扫描及 docs:check 通过；4 项原有 episodic advisory 保留。该证据仅覆盖 governed 局部，legacy、设置说明、完整来源物理输入及 App/device 仍未完成。

T-07 F-17/F-18 修复（2026-09-09）：

- AC-05 → 错误结算立即拒收流事件，但保留当前渲染/恢复身份；所有部分结果在持久化前补统一中断 warning → Chat 回归夹住 deferred save 与 deferred Markdown render，在等待中注入迟到正文；typed partial→resolve 和 writingRecovery→resolve/reopen 验证正文、状态、result 与 Add to Editor → 字符/历史一致，未完成内容不恢复完成操作 → 回调/渲染/持久化/历史操作变化须复跑，真实 UI 仍待阶段 smoke。
- 修复前 Chat suite 3 个 RED，分别复现保存等待期间正文覆盖及两条 reload 限制丢失；初稿将流关闭与渲染身份绑在一起，独立审查发现可能导致 pending render 后恢复退出，已分开两种判断并加入对应回归。
- 手动选取恢复正文的既有 fixture 在全套中一次提前读取结果、单独运行通过；改为 await 既有按钮 click 返回的操作 Promise，不增加等待次数、不改产品逻辑。最终 `npm test -- --runInBand __tests__/chat-view.test.ts` 248 tests PASS，2.993 s，自然 exit 0。
- 本 slice 仅 ChatView、对应测试和 B-135 Tracker 变更；旧 runtime 全量/build/App 证据不复用于新 UI。来源失效仍清除无效内容，provider_failed 保留已获准正文；没有将 native、默认迁移或阶段验收标记完成。
- 关联取消变体：pending Markdown render 期间 click cancel 后，旧渲染返回 false 导致恢复提前退出；定向测试先 RED（历史 assistant 缺失）。`settleLiveMarkdownRenderBeforeFinal` 现在只等待旧渲染结束，并以恢复 finalizer 当前身份决定是否继续；未渲染成功的正文由既有 final renderer 重渲染，关闭/切会话仍拒绝。最终 Chat suite 249 tests PASS，3.212 s，自然 exit 0；lint PASS。此结果覆盖异常和取消，不将其记成 App 验证。
- 最终 source 的 `npx tsc -noEmit -skipLibCheck`、lint、diff check 均自然 exit 0，社区 DOM 源扫描无匹配（exit 1 为通过）；独立只读复核确认 F-17/F-18 和取消变体闭合，无新增必须修问题。当前 view/session/controller 身份失效仍阻止关闭或切会话后的恢复；旧 full build/test/App 证据不覆盖本次修改，T-07/P1 继续未完成。

2026-09-09 顺序产品决策完成：Owner 依次确认 D5 语义提议及保留执行保护、D8 无明确用户关闭证据的旧 false 迁移为开启、D10 停止新提取与已有画像读取解耦。已同步 DEC-034、Product Spec、SDD 与任务依赖；T-02 仅标记产品决定/文档完成，T-03/T-04 与阶段门仍未通过。此轮仅修改 B-135 文档，未修改 runtime 或旧任务过程文件；文档 checker/fixture/配置未变，沿用本轮已通过的 2 suites/58 docs contract tests，最终文档重跑 docs:check 与 diff check。

2026-09-09 SDD 任务核对：D2/D3 按 Owner 本次原意转为 Confirmed，同步 DEC-034、Product Spec、SDD；T-02 保持未全量冻结，新增 F-17/F-18 归 T-07。仅修改文档，未修改运行时或旧任务过程文件。`npm run docs:check` 完整运行（含 Git 删除连续性）通过：206 Markdown、1801 links，4 项原有 episodic advisory；`npm run test:docs -- --runInBand` 2 suites / 58 tests PASS，5.906 s，自然 exit 0；`git diff --check` 通过。无新增 runtime/App/provider 验证，旧值迁移问题已提出，未收到答复前继续 Pending。

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-09 | 设计来源与基线 | git status / local HEAD / `git ls-remote --heads origin master`；源码及测试只读核对 | PASS — baseline only | local/remote master 8be89c4c；工作树 c923，B-135 源码一致；无运行时验证 |
| 2026-09-09 | 历史证据分层 | 读取 Brief 原故障/离线 probe；此前文档 gate 2 suites/58 tests | Historical only | 旧测试/文档证据不覆盖新增 SDD、默认学习和 native 行为；本次 gate 待运行 |
| 2026-09-09 | T-01 文档契约 | `npm run docs:check`、`git diff --check` | PASS — docs only | 当前 B-135 文档、链接/ID/WIP/删除连续性校验；4 项原有 episodic-memory 未索引/不可达 finding 仍为精确 advisory，未新增豁免 |
| 2026-09-09 | T-01 现有文档测试 | `npm run test:docs -- --runInBand` | PASS — 2 suites / 58 tests，6.094 s，自然 exit 0 | check-docs-script / pa-docs-lifecycle-skills；checker、测试、fixture、skills、Jest 配置及 lock/dependencies 未改，后续纯产品文档修订复跑 docs:check，不重复此 fixture suite |
| 2026-09-09 | T-01 / F-06 设计复核 | 独立只读复核 Decision/Spec/Plan/SDD/Tracker、17 AC 与22任务、默认/旧值/Personal 源码及旧包 diff | PASS — 文档一致性；不代表技术可行性通过 | 修复新工作错误归属；修正 consent merger 函数名。待决项仍 Pending，P0 与 runtime/provider/device 证据均未执行 |
| 2026-09-09 | T-05 / AC-14 最小反例 | `npm test -- --runInBand __tests__/pa-agent-stream-fallback.test.ts`，新增4个回归先对现有代码运行 | RED — 4 failed / 15 passed，exit 1，4.322 s | 确认array文本空白/转义被改写、非文本块使流失败、finish延迟到tail、空已完成响应tail失败误invoke；这是缺陷证据，不作为通过 |
| 2026-09-09 | T-05 adapter 修复 | `npm test -- --runInBand __tests__/pa-agent-stream-fallback.test.ts __tests__/chat-writing-output.test.ts` | PASS — 2 suites / 51 tests，exit 0，1.245 s | runtime adapter/helper与6个新增回归；覆盖stream/invoke保真、finish先于tail、usage保留、禁止完成后fallback；仅适配层和旧decoder，不覆盖loop/bridge完整交付 |
| 2026-09-09 | T-05 类型 | `npx tsc -noEmit -skipLibCheck` | PASS — natural exit 0 | adapter/helper及其tests输入；后续loop共享类型修改需重新检查。尚未build/deploy/App/provider/device验证 |
| 2026-09-09 | T-05/T-06 下游反例 | `npm test -- --runInBand __tests__/pa-agent-loop.test.ts -t 'B-135 P0 content completion boundary'`，最初4项 | RED — 2 failed / 2 passed，84未选，exit 1，1.873 s | stop+正文之后tailerror/deadline覆盖stopReason；完成前取消和普通工具完整后执行两项保护通过；修复后原4项PASS，1.281 s |
| 2026-09-09 | F-08 复现与修复 | 原buffered overrun用例增加正常finish，两模式对照；修复后纳入完整suite | RED then PASS | 初稿withFinish=true因误启动第二请求导致fixture等待5s超时；未增timeout，改为在等待前断言一次model并修正完成时刻判据。独立review已确认关闭 |
| 2026-09-09 | T-05/T-06 focused gate | `npm test -- --runInBand __tests__/pa-agent-loop.test.ts __tests__/pa-agent-stream-fallback.test.ts __tests__/chat-writing-output.test.ts __tests__/pa-agent-stream-bridge.test.ts` | PASS — 4 suites / 149 tests，exit 0，2.287 s | loop/adapter/current JSON decoder/bridge完整输入；新增整链5cases证明完整+stop+tailerror交付，invalid/source-revoked/length/missing-finish仍拒绝。非native/provider/App证据 |
| 2026-09-09 | T-05/T-06 local gate | `npx tsc -noEmit -skipLibCheck`；`npm run lint`；`git diff --check`；AGENTS DOM source scan | PASS — tsc/lint自然exit0；diff无错误；source scan exit1且零匹配 | 当前两源文件、3个受影响/新增测试文件；配置/dependencies未变；后续源码/fixture/config变化失效相关证据 |
| 2026-09-09 | T-05/T-06 review | 独立只读adapter兼容/fallback与loop完成/工具/取消/时钟审查，修复后复核F-08 | PASS — 当前局部diff无剩余必须修finding | 不扩大为整个T05/T06/T07或B135通过；缺少完整P0、build、App/provider/device门 |

本轮 T-06 续作证据（2026-09-09）：

- `npm test -- --runInBand __tests__/pa-agent-loop.test.ts __tests__/pa-agent-stream-fallback.test.ts __tests__/pa-agent-stream-bridge.test.ts __tests__/chat-writing-output.test.ts __tests__/pa-agent-started-text.test.ts __tests__/pa-agent-required-capability-policy.test.ts`：6 suites / 206 tests PASS，2.641 s，自然 exit 0。
- 证明 soft70/hard100 下正文75时完成/失败/取消/late tool、100时中断；early tool恢复soft边界；真实Pagelet来源接受/拒绝与continuation拒绝。F-09/F-10独立复核关闭，仅源码与合成provider证据。
- `npm run lint` PASS，自然 exit 0。首次 `tsc` 揭示新增测试 hook 返回 Jest 对象的类型错误；改为显式void回调后，`npx tsc -noEmit -skipLibCheck` PASS，自然 exit 0；`pa-agent-started-text.test.ts`复验3 tests PASS，1.170 s，自然 exit 0。该测试修订不改变production、其余fixtures/config/dependencies；其余5 suites证据仍适用。
- 此 slice 尚未 production build/deploy、真实provider或App/device验证；不标T-06或P1完成。

本轮 T-07 与 P1 自动化/部署证据（2026-09-09）：

- Preview decoder：78 tests PASS，0.734 s；独立预览不修复完整协议。集成首轮6 suites/370 tests PASS，4.736 s；补普通取消及真实点击取消状态后Chat suite 241 tests PASS，2.994 s。
- 真实 `PaAgentRuntime` / LangChain prompt / `WritingStyleService` / governance / bridge（仅provider输出为离线脚本）：runtime与style service共27 tests PASS，1.647 s；非空已授权风格确实进入输入，取消保留正文，stop+tail清理不撤销来源，Forget撤回预览。plugin note-backed来源的7项focused tests PASS，7.469 s；其余317项当时未选，后续完整gate覆盖。
- F-11/F-12/F-13独立审查与修复复核通过。保持Memory主开关、治理、epoch、文件身份/修改、路径排除、Forget等来源控制；取消仍阻止继续生成。mock DOM点击不作为真实窗口交互证据。
- 部署前完整gate：`make bin`的平台检查（386 TS）与lint通过；首次build因新runtime测试hook返回Jest对象类型失败，修为void后`npm run build`自然exit0。首次普通沙箱`npm run test:all -- --runInBand`因tooling/artifact子进程`spawnSync node EPERM`停止（SIGINT/exit130），不记PASS、不修改断言。在允许子进程的环境重跑同一命令：**247 suites / 6583 tests PASS，303.165 s，自然exit0**。测试/配置/依赖及production输入随后冻结；无需重复已覆盖lint/type/focused gate。
- 构建：`dist/main.js` SHA-256 `49c2bb5760b07e3361cb6aa80fa45d35c8fc50cfcc37b885fc10b174991d534d`，7,073,292 bytes；production input count 421，input SHA-256 `fb394c0f6111c87b0886d3e200db0486e85d0c67d5164c86870b4ca7a9bd4d01`。任一相关源码/配置/依赖/构建输入修改后失效对应证据；HEAD本身不足以复用。
- 部署：CLI只读确认真实test vault为`/mnt/code/personal-assistant/test`（隔离worktree的`test`并非已打开vault），因此使用同一既有helper `node scripts/deploy-current.mjs /mnt/code/personal-assistant/test/.obsidian/plugins/personal-assistant`，构建身份检查通过；main.js/styles.css/manifest.json/manifest-beta.json与dist逐字节一致。没有改部署脚本、合并代码或发布。
- 运行时挂载：先清空dev errors，`obsidian vault=test plugin:reload id=personal-assistant`及`command id=personal-assistant:open-chat`成功；`.llm-chat-container`数量1。只读eval确认vault=test、plugin enabled、加载后的style prepare包含isSourceCurrent接口；新错误缓冲为空。debug未附着、mobile emulation已关闭。该证据仅证明部署/加载/挂载，**不证明预览/取消/复制/恢复真实交互**。
- 环境与后续门：原生窗口交互工具不可用；现有Obsidian CLI可用（普通沙箱Electron启动失败，获准同命令外层执行后成功）。真实窗口full-ui与iOS为NOT TESTED；配置只读核对为qwen/qwen3.8-max，policyModelName为空，未调用真实provider。保留P1的这些门，不标T-05/T-06/T-07完成。
- 辅助CPU测量：纯preview decoder对75,092字符、3,754个20字符累计前缀耗时3,562 ms；不是实时provider/UI或端到端性能证据。逐chunk重扫成本仍在T-20/实际流验证中评估，本轮未引入缓存或新测量平台。

T-06 投影前诊断续作（2026-09-09）：

- AC-16 → loop保留实际consumer结束类型，bridge在作品/恢复事件前输出严格白名单诊断，runtime仅debug开启时写现有本地log → stream-bridge/loop/真实runtime离线fixture与类型检查 → 正常finish+tailerror可交付、无finish但完整JSON不成版、格式不完整独立报告；默认不写新增诊断、无正文/样例/token/provider配置 → completion/event/bridge/logger变化重跑。
- 字段使用宿主run、writing request、turn、message标识，run终态、stop、provider finish、transport、schema、字符数与本地解码上限。writing request标识不是provider返回的物理request ID；本记录不推断provider token上限，也不将本地字符限制标成实发max_tokens。物理调用身份/实际发送限额的完整关联仍待T-06后续核对。
- 本次改动使此前production build、完整测试和App加载证据不再覆盖当前源码；已有结果保留为历史输入证据，不重复宣称当前全量PASS。阶段仍需真实provider、窗口交互和剩余诊断门。
- `npm test -- --runInBand __tests__/pa-agent-stream-bridge.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-writing-preview.test.ts`：3 suites / 113 tests PASS，2.144 s，自然exit0；`npx tsc -noEmit -skipLibCheck` PASS，自然exit0。包含debug开关的真实runtime离线fixture、投影前顺序与字段白名单断言。补日志sink异常隔离用例后，bridge 11 tests PASS，1.060 s，自然exit0；其余源码/测试输入未变。最终source的lint、diff和社区source scan通过。
- 独立只读审查未发现本轮诊断增量必须修问题，确认三轴证据、候选重置、debug开关、同步sink异常隔离与无正文白名单；未替代真实provider/App门。`docs:check`通过（206 Markdown/1801 links，4项原有episodic advisory）。

T-06 实际发送限额与宿主 attempt（2026-09-09）：

- AC-16 → 在现有native fetch / Obsidian requestUrl入口、准入通过并创建物理调用后同步观察最终序列化请求体 → obsidian-fetch / ai-ios-dashscope-transport及真实runtime离线fixture → 只报告`max_tokens`/`max_completion_tokens`实际正整数字段；缺失为absent，不可读/非法为unknown；不消费Request流、不修改body、不记录正文/配置 → SDK序列化/transport/admission/logger变化重跑。
- answer与context_summary记录runId、turnId、stage和run内唯一宿主attemptId（`run:http:n`），每次实际fetch入口调用独立计数；这不是provider返回ID，也不是整个run的全部工具/分类/重写请求账单。辅助路径完整覆盖与SDK重试对照仍须核验，不声称已全部完成。诊断仅debug本地log，sink错误隔离。
- 3 suites / 36 tests PASS（obsidian-fetch、ai-ios-dashscope-transport、pa-agent-writing-preview），2.377 s，自然exit0。补真实PaAgentRuntime→AIUtils→SDK→requestUrl→projection关联用例后transport suite 13 tests PASS，1.465 s，自然exit0。该链仅替换网络响应；桌面native/iOS路由测试证明SDK实发字段与记录一致，不是真实设备或provider证据。
- 来源准入拒绝时无dispatch诊断；日志失败仍发送原body；正文/token配置未进入白名单。两入口新增wrapper后当前production build和旧App证据继续失效，P1与T-06仍未完成。
- 最终source的`npx tsc -noEmit -skipLibCheck`、`npm run lint`自然exit0；`git diff --check`与社区源扫描通过。补scope等待/drain后准入拒绝仍零诊断断言，obsidian-fetch 19 tests PASS，0.719 s，自然exit0。`docs:check`通过，4项原有episodic advisory保持；未进行真实网络、build/deploy或设备测试。

本轮独立审查修复 F-14（P2）：初稿在取消/准入与物理调用之间通知diagnostic observer，同步observer取消可能仍派发requestUrl。现改为物理调用创建后的finally通知，两transport均保留最后准入/取消与dispatch同步邻接；新增有/无scope的顺序与同步abort反例。诊断时刻代表本地dispatch创建后的观察，不代表provider收到或开始生成。修复后上述3 suites / 39 tests PASS，2.006 s，自然exit0。

关联复核 F-15（P2）：无scope时，observer同步取消后`withAbort`可能在接住已创建物理promise之前抛出，迟到网络错误成为未处理拒绝。修复为立即取消分支先接住现有promise的拒绝，再返回本地AbortError；有/无scope均补deferred网络失败回归，不取消或重发实际请求。最终3 suites / 41 tests PASS，2.004 s，自然exit0；tsc/lint/docs/diff均通过。独立只读复核及零网络内存探针确认两scope的迟到拒绝均被消费，F-14/F-15关闭于自动化范围；无新增必须修问题，完整App/provider门仍待完成。

T-06 SDK retry 对照（2026-09-09）：

- AC-16 → 已有SDK/transport/runtime fixture新增首次HTTP500、第二次正常响应 → `npm test -- --runInBand __tests__/ai-ios-dashscope-transport.test.ts` → 16 tests PASS，6.036 s，自然exit0。使用服务端`retry-after-ms: 1`缩短fixture等待，没有修改产品重试策略或测试timeout。
- 桌面native和iOS requestUrl均确认真实SDK调用两次，诊断数量等于物理调用数量，两次序列化body逐字相等，输出限额均321；真实runtime的两次attempt共享run/turn且ID分别为http:1/http:2，均先于作品投影日志。无真实网络或设备操作；不覆盖SDK以外的新请求重写或全部辅助调用。
- 本slice仅测试/Tracker改变，保留上一轮source验证，不复跑production lint/build/deploy；最终test类型检查及文档/diff按当前输入执行。新增重试测试不把T-06或P1标为完成。

T-06 Memory 辅助模型诊断（2026-09-09）：

- AC-16 → standard/relaxed宿主invocation保留只在内存中的诊断工厂，按当前turn绑定query_rewrite/rerank，再传入AIUtils既有物理发送观察器 → memory-search-phase1 / ai-ios-dashscope-transport → 改写/重排选项转换不丢回调，原准入/timeout/drain有效，callback不进入模型schema、seed或持久化 → invocation/prepare/model构造/transport变更复跑。
- 初2 suites / 49 tests PASS，7.242 s，自然exit0。补真实runtime重排超时链的answer→rerank→answer记录断言后transport 16 tests PASS，6.222 s；三个attempt唯一且共享run，重排绑定发起工具的turn。补rewrite/rerank模型选项保真断言后memory-search-phase1 33 tests PASS，1.099 s；未重复无关全量gate。
- 本轮不改重写/重排算法、次数、provider参数或权限，不加分类模型。原能力分类、embedding与其他工具的全部物理账单尚未纳入本诊断声明；这些覆盖范围在T-06继续核对，不能把上述日志当整个run总成本。无真实provider/设备验收，当前build/deploy证据仍需更新。
- 独立只读审查无必须修问题：standard/relaxed保留host-only回调，重排归属发起turn，relaxed不新增rewrite；callback不进入schema/prompt/seed/持久化。lint/docs/diff及DOM源扫描通过。类型检查首次发现新测试mock零参数推断导致断言签名错误，仅补mock参数签名；复验Memory 33 tests PASS，1.132 s，自然exit0，最终`npx tsc -noEmit -skipLibCheck`自然exit0。

T-12 主 Agent 取材选择首片（2026-09-09）：

- AC-01/02/12 → runtime不再调用独立分类模型，也不以deterministic预测替代；给原host completion policy显式空classification，不生成预测required工具列表 → runtime-search-vss / ai-ios-dashscope-transport / pa-agent-writing-preview / required-capability-policy → 已配置policyModelName的主Agent可先澄清notes请求，一次实际main请求、零预测搜索；已用证据、真实来源/权限、终态检查继续保留 → routing/control/prompt/host policy变化重跑。
- 删除ChatPlanner专用分类方法及runtime创建分类器的入口；不删除policyModelName字段和Memory rewrite/rerank用途。旧classifier helper尚有独立测试/引用，未把模块整体删除冒充迁移完成。Operations继续原意图/opt-in/导出执行/确认准入，取消initial required名单导致的取材工具预缩；来源regex约束等待T-13，不将其视为统一语义已完成。
- 首轮3 suites / 60 tests PASS，6.789 s，自然exit0；新增真实runtime澄清反例后transport + required policy两套66 tests PASS，6.757 s，自然exit0。网络响应为离线fixture；不代表真实模型语义质量、P3或T-12完成。本片独立于Pending产品选择，后续来源投影替换仍先满足T-04/T-13。
- T-06的最小故障定位与T-20完整成本对照分开：不为将被移除的分类路线新增长期诊断框架，也不把部分模型日志当整个run账单。分类调用在本片已从当前runtime删除，其他物理调用覆盖及真实失败对照仍需按AC验证。
- Chat集成初7项失败均追溯到预测依赖：分类额外调用、天气初始工具预缩、来源撤销后的额外补答、Ops未调预测来源警告。按新契约更新断言，保留stale path/body零出站、实际search一次、显式no-web/current-note约束；不为旧revalidation调用数制造请求。
- F-16（P2）独立审查发现仅保留Operations required名单会隐藏混合请求的Memory/Web/current-note工具；删除initial requiredToolNames，保留获准read和Ops同时可见。新增真实bound schema含search_memory/vault_create、提议state=pending、vault.create零调用断言。Ops空ack的completed仅指已生成待确认卡片，不证明资料验证或执行完成；D5准入未改。
- 修复后5 suites / 140 tests PASS，8.174 s，自然exit0（chat-service、control-policy、iOS transport离线fixture、runtime-search-vss、writing-preview）；tsc/lint自然exit0。独立复核F-16关闭，无新增必须修问题。共享runtime输入现冻结，安排production build和全量test；之前的构建/部署证据不作为此次结果。

当前冻结输入的统一gate（2026-09-09，T-06诊断与T-12首片后）：

- `npm run build` PASS，自然exit0；`dist/main.js` SHA256 `d21e45b0e99adf347ccdac9fb1920b7ed8e3041d7d836819d16452d2f337214e`，7,073,281 bytes。production input count421、SHA256 `a46bc2a88468b0bc8837e2c07b4e9d775a06d88783fb34d8fad7f666d9c8f805`；styles/manifests未产生额外diff。
- `npm run test:all -- --runInBand`：247 suites / 6607 tests PASS，281.271 s，自然exit0。Jest报告退出超过一秒的提示，未强制退出。针对本轮取消/transport/runtime相关6套运行`--detectOpenHandles`：180 tests PASS，15.668 s，自然exit0，无句柄报告；这没有定位全量提示来源，不据此宣称全仓无退出延迟。后续同输入复发且影响gate时扩大定位。
- lint/tsc/docs/diff及社区源扫描已通过；全量执行期间source/tests/config/deps保持冻结，随后仅文档证据更新。发布fixture操作仅在临时仓库；没有提交/推送项目或发布。以上不证明剩余AC或真实provider/App/device行为。
- `node scripts/deploy-current.mjs /mnt/code/personal-assistant/test/.obsidian/plugins/personal-assistant`身份检查及复制成功；`obsidian vault=test plugin:reload id=personal-assistant`自然exit0，open-chat成功，DOM容器数量1、dev:errors无错误。没有调用provider或进行真实窗口输入；仅证明部署/重载命令和Chat挂载，不证明语义选择/取消/保存交互。构建hash和当前输入按上述条目绑定。

T-07 普通回答异常后的可读恢复（2026-09-09）：

- AC-05 → 普通回答已有正文后抛错，保留内容并写partial_output_error提示；canonical终态为error，未产生作品。空回答保留原错误行；已知图片来源/请求身份失效不保留撤回文本，provider_failed可保留 → Chat suite legacy/canonical异常、持久化/reopen、迟到chunk、图片错误类别、既有取消/清理 → 正文原字符保留、失败状态可恢复、无成功作品/自动保存建议 → UI finalizer/lifecycle/persistence/source错误变化重跑。
- 初反例发现共用finalizer把partial正文更新为可复用result并挂AddToEditor；现对已标partial的收尾保留阅读/复制，不提供已完成输出的直接编辑入口，reopen根据已存partial_output_error/user_abort一致处理，不改变长期提取或风格授权。canonical测试初期错误地使用legacy onChunk，改用真实message_start/text_delta后验证通过，未修改生产逻辑来兼容错误fixture。
- `npm test -- --runInBand __tests__/chat-view.test.ts`：246 tests PASS，3.103 s，自然exit0；`npx tsc -noEmit -skipLibCheck`和lint自然exit0。当前源改变使上一轮构建/全量/App加载证据失效；本片尚未重新build/deploy或真实窗口验证，T-07仍未完成。

T-08/T-09 真实宿主默认学习收口（2026-09-12）：

- 回执：[`evidence/2026-09-12-default-learning-host-matrix.json`](evidence/2026-09-12-default-learning-host-matrix.json)。输入绑定部署源码 `0bbe12ba4313ae537990d3d5208496f3c12bc312`、`dist/main.js` SHA-256 `0fb0aba1e069086ec821f979fba9749d0d82146d8d8082b19327610705a4d684`、插件 2.9.2 和 repo-local `test` 库；文档 HEAD 为 `6aa96d851f699cf591526f153177349a512ceead`。当前只新增 Tracker/回执，源码、测试、fixture、配置、依赖和部署产物未变，因此复用 T-08/T-09 已通过的 5 suites/706 tests、实际旧 reader probe，以及当前冻结输入 `make deploy` 的 276 suites/7618 tests、lint/build 证据，不重复运行相同测试。
- 真实 `loadSettings`→一次迁移→普通保存→重载矩阵通过：raw missing 与无动作证据的旧 `false` 均得到 `default/default` 和实际 11；不生成 `confirmedAt`、consent 保持 `unconfirmed`。有效 `paused` 保留 extraction=0 且 habit 默认=1；版本化 10/01 即使旧镜像相反也以 `learningPreferences` 为准，调度器状态随 extraction 独立变化。
- 实际 Obsidian 设置 DOM 中两项 Toggle 均为 `is-enabled`，说明分别明确默认开启、provider/成本/本地存储边界，以及习惯学习只用本地聚合、不调用 provider/同步/导出/写笔记。此证据验证真实渲染状态与文案，不冒充鼠标点击可用性或 iOS 验收。
- 全新插件实例的启动阶段是 0 history read、0 model create/invoke、0 cost record；新合成 Chat 从正式 plugin 调度入口进入同一生产 scheduler，使用 delay=0 仅加速本次 timer，随后发生4次来源读取/复验、1次本地拦截模型适配器调用、1次成本记录，并持久化 through-turn=8。`createChatModel` 在重建 scheduler 前替换为本地适配器，因此真实 provider 请求为0；这验证准入/生命周期，不证明模型语义质量。
- 默认 habit collector 将一次真实 `view` 反馈写成3个本地聚合；独立关闭后返回 `disabled` 且聚合序列化内容不变，同时 extraction 仍开启。随后明确暂停 extraction，scheduler 立即为空、再调度模型增量为0；Memory 控制中心的 Personal reader 仍 `enabled`、style service 仍可用，临时关闭 Memory 主门时 prompt context 只剩 `memoryContextMode`，未投影治理正文。
- 清理完成：首次诊断轮因 Obsidian 窗口 `hidden` 正确停在模型前，置前并缩短 timer 后确认产品路径；后续同 ID 停止是首个成功轮已持久化 processed cursor，并非产品故障。旧/新两个合成 cursor 最终均为 `null`，所有 `.b135-learning-*` 临时文件已删除，插件重载后 governance=`ready`、scheduler存在；`data.json` 前后 SHA-256 均为 `f8cfd5bdefb2d3f9213489984b4f463c3035258da48c509dd1f9b1de2732dcbc`，回执 JSON 自检 PASS。T-08/T-09 由此标 Done；P2 仍受 T-10/T-11、真实语义、可见交互与受影响 iOS 阶段门约束。
- 当前文档输入的 `npm run docs:check` PASS（206 Markdown、1820 links，4项既有episodic advisory）；`npm run test:docs -- --runInBand` 2 suites/58 tests PASS，5.958 s，自然exit0；回执JSON解析、`git diff --check`通过。随后仅补写本验证结果与当前任务描述，checker/tests/fixtures/config/dependencies未变；最终复跑docs:check和diff，文档测试证据继续适用。

T-22 当前契约同步首片（2026-09-12）：

- `docs/architecture/settings-status.md`按已交付实现改为两项学习分别默认开启、无明确关闭证据的旧`false`迁移开启、明确关闭/暂停保留；停止新增提取与已有有效Personal使用继续分门治理，所有增量和受影响iOS门仍只归B-135。
- `docs/architecture/pa-agent-architecture-plan.md`移除独立启动分类和本地write-intent门的过时描述，记录同一主Agent选工具、Host来源批次/物理输入校验、Operations原确认保护，以及`get_writing_context`/`present_writing`、版本和旧reader兼容边界。未把D15写成已决定，也未改最终默认推广契约。
- 仅运行本Validation Plan规定的文档门：`npm run docs:check` PASS（206 Markdown、1840 links，4项既有episodic advisory）；`npm run test:docs -- --runInBand` 2 suites/58 tests PASS，5.896 s，自然exit0；`git diff --check` PASS。没有重复build、full Jest、provider或App/device验证；本片使T-22进入部分完成，最终同步等待D15及全量AC汇总。

T-22 全量AC与待决状态审计（2026-09-12）：

- 逐项对照Product Spec的AC-01–17、SDD Test Matrix、T-01–22状态及Tracker现有真实证据，新增`Acceptance Completion Audit`。没有发现需要新实现或新测试矩阵的缺口；所有AC共同只待T-21对D15后的冻结输入执行一次既定统一gate，特定剩余项收敛为D15与受影响iOS。
- Product Spec和SDD不再声称“选择队列已完成”“本轮仅设计”“native仍未切换”；它们现在如实记录开发分支已切native、D15的两种处置及未覆盖iOS。未替Owner选择D15，也未把Desktop、传输保真或单样例冒充模型质量/iOS通过。
- 本片仅变更三份B-135文档。`npm run docs:check` PASS（206 Markdown、1840 links，4项既有episodic advisory）；`npm run test:docs -- --runInBand` 2 suites/58 tests PASS，6.204 s，自然exit0；`git diff --check` PASS。未运行build、full Jest、provider或App/device验证。

## Closeout Readiness


- [ ] 所有产品待决项已按真实用户答复处置，SDD 关键发现闭合。
- [ ] 全部 17 项 REQ/AC 与当前实现一致，新增工作没有遗留到旧 track。
- [ ] 每阶段 required review、provider、Desktop/iOS smoke 及最终 broad gate 有真实证据。
- [ ] 稳定结论已吸收到 current contracts/Architecture/tests；未完成项有明确去向。
- [ ] Brief 独有事故证据有入链的保留方案；过程文档按生命周期处置。
- [ ] 已取得 closeout 授权；Git/release 仍按各自边界执行。

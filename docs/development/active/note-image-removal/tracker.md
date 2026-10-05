# Note Image Removal Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-10-05
Work item: B-160
Authority: 本 track 唯一执行状态、授权、finding 与验证证据。
Product spec: [Product Spec](../../../product/specs/pa-note-image-removal-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design](./sdd.md)

## Current Snapshot

- Current phase: P0–P3 已完成，实施与设计独立接受；F-01–21 Closed。本地完整门禁、桌面交互、获准真实文本模型与 CLI mobile simulator 验收通过；状态为 Validated。
- Next action: 开发与验收交付完成，无剩余源码修复或验证任务。2026-10-05 Owner 授权创建本地 commit，按规范拆分代码/测试与配套文档；当前范围没有 iOS 专有能力，按 Owner 约束不另要求真机。未授权 push、发布或 closeout。
- Authority: B-160 源码/测试/必要契约与 repo test 本地验证已授权；2026-10-05 用户另授权真实文本模型验收，并明确除 iOS 系统特有能力外使用 CLI mobile simulator，随后授权为本次修改创建本地 commit。现有 pa-glm/ZAI 仅接收必要公开仓库材料与脱敏结果；iCloud/device 部署仍单列，push、发布与 closeout 未授权。
- Source baseline: 本地 master `22cf028e`；此前只读远端查询为 `308fbace`，相关删除路径相同。已有 `DESIGN.md`、`design-samples/` 不属本任务。
- Last verified behavior: 最终378suites/9012tests自然通过，lint/build/实际root-test部署复用。desktop与CLI mobile simulator联合删除/原文原字节Undo/共享冲突通过；keep及重载失效复用原desktop与领域证据。qwen/deepseek-v4-pro的6turn/16真实请求通过自然语言选图、共享提示、partial/unknown原ID只读追问，create_image调用0；故障仅在专用附件边界合成。无iPhone/iOS真机证明，按当前要求不构成缺门。
- Product choices: 其他笔记引用时阻止整个联合删除并提示；支持临时内存快照的一键撤销，覆盖先前仅手动恢复提议。
- Writer/review: GLM 连续实施至 R7 的实际额度阻塞后终止；GPT 接管剩余 source/tests，attachment_delete_review/history_regression_review 为不同的只读独立 reviewer。root 拥有领域/事实/status，conflict_ui 仅拥有 UI/model/session/locales 及其4套测试；路径分离，昂贵门禁集中运行。
- P2 run: 同一 GLM CLI context 的 R4（exec session16215）已自然 exit0/turn.completed，但 final 错误输出 write_stdin 指令文本，未交完整报告；最后 execution suite 命令缺自然完成记录，p2-focused/tsc/diff/dom 最终日志缺失。工具入口回归已实际转绿、期间 tsc exit0 只覆盖当时输入；当前候选未完成/未接受。限定外部进程查询已确认无旧 writer/该 execution 测试残留，暂冻结现有源码核对实际必修与遗漏，再修订同 context 任务；不运行 full/deploy 或产品 provider。
- Evidence recovery: 10-05 当前环境 /private/tmp/pa-b160-BXdiaU 已不可见，旧 exec handle 亦不存在；交付树/依赖与唯一 CLI rollout 仍在。仅从原 rollout 提取公开 P2 任务和 tool records 到 /private/tmp/pa-b160-resume-BlLyTc，保留时间及原路径，不把提取片段冒称原完整日志。原 CLI 原文确认 execution suite 为 4 PASS/1 FAIL（当时 overall unknown 断言，源码实际 partial），随后 fixture 断言修正；失败跳过末尾 dispose 留下 timer，Jest 未自然退出。后续需 finally/afterEach 清理，不使用 forceExit；原 gate 仍未通过。
- P2 R5 terminal: exec session86738 已自然exit0/turn.completed，619事件；再次final输出 write_stdin JSON文本（session86793）而非工具调用，完整report/focused/Local Gate日志仍缺。原rollout实际工具调用仅exec_command/apply_patch，没有write_stdin调用；限定外部进程核查无该任务writer/Jest残留。末次staging测试启动后又改测试，原命令无自然完成事件，不采用其结果；这是工具使用/证据交付问题，无quota耗尽证据，不能盲目重启同路径或自动转移source ownership。
- P2 R5 WIP review: 两个原风险面 reviewer 与原 fixture reviewer 只读定点核实际修正，不运行额外检查。query/lineage/动态 Host/inline、keep 文字 Undo 与真实字节 fixture 已见接线；异步撤权/失效后新效果、观察祖先的 Memory availability、后续 owner 事实/TTL、有限 effect 状态及 full UI 仍有原范围残留。writer 仍在改，冻结后只核所读路径后续差异及最终断言，不以 WIP review 关闭 finding。
- P2 R5 frozen review: 完整 UndoResult 覆盖及 process await 中dispose后晚建snapshot触发已修；F-06 Memory observation动态授权整段过滤、F-08 Undo读后/F-09 binary准备后准入、F-10 postscan/restore等待后的owner准入仍未闭合。keep仍生成attachment applied；partial/TTL最新owner事实未进入真实ChatService历史链，partial Undo旧availability越过TTL，effect status非有限enum，full unknown/逐行Undo仍有遗漏。仅复核WIP后相关差异，未新增无epoch生产不可达假设或因缺gate记bug。
- P2 R5 gap checks: GPT 在冻结交付树补原缺失staging suite（2tests自然0）与tsc（自然0），原日志 root-r5-staging.log/root-r5-tsc.log。后续R6由原GLM修source/tests/self-review；GPT补必需focused/Local Gate，不重复GLM已完成且输入未变的证据。工具使用失败与权限、quota故障分开；没有source takeover。
- P2 R6 terminal/freeze: 同一 CLI context/exec88630 已自然 exit0，80 events/turn.completed，详细报告已实际写入 p2-r6-report-detailed.md。GLM 只修 source/tests/self-review，未运行检查；交付树输入现冻结，两位原风险面 reviewer 只读复核，GPT 集中执行 focused/Local Gate。R5 process-dispose 的已知效果按 REQ04 更正为 partial/note applied/attachment not_started/false Undo，原错误断言及日志保留；真正未知 native 调用保护不削弱。报告不等于接受或检查 PASS。
- P2 R6 centralized checks: focused 26 suites 实际自然 exit1，20 suites/915 tests PASS、6 suites/15 tests FAIL；tsc 自然 exit2。原日志 root-r6-focused.log/root-r6-tsc.log 位于当前证据目录。失败含 keep/partial facts、service 无 owner 返回契约、测试类型/import/UUID/等值与新能力列表；Memory 新 fixture 和 binary deferred fixture 未命中生产/期望阶段，按真实触发修正，不改变正确边界断言。summary budget 两例另作 root master 对照诊断，不能先归因未调用的 Operations refresh。diff 无输出通过，DOM scan exit1/零匹配通过；P2 未接受/未部署。
- P2 R6 frozen acceptance: 两位原 reviewer 定点核源码/原日志，F06生产Memory祖先、F08原note-read、F11lease/owner释放、finite enum/not_started和full UI门禁已源核修正。残留是第二/第三bytes await后最后准入、keep Undo伪附件效果、restore时同时撤源/dispose仍true、原completed DTO套restored而无效、partial Undo TTL旧能力/无变化revision、无owner返回契约及dispose迟到fact历史通道。属于原F06–16，下一轮R7同source owner修；未重审P1/query/Host/inline或扩大无epoch范围。
- Summary diagnostic/rubric correction: root master两例自然0/2PASS；候选新增全局事实规则使原大fixture跨既有16000请求限额，正确滚动分块导致1→2调用。两位独立归因与源码链核实，撤回把调用数本身当缺陷；修单块fixture或按合法chunk数核完整来源/逐请求上限/fallback复用，不改变生产上限。另含Operations历史的无变化revision失效缓存仍是真实残留，两者不混因。
- P2 R7 live: 两路冻结回执及集中失败已纳入 p2-r7-task.md，同一 GLM CLI context 恢复，exec69651；events/stderr/result/exit与详细报告继续保存在当前证据目录。只做原范围 source/tests 修正/自查，GPT冻结后检查；无 source takeover、产品 provider、接收或部署。派工前仅同步本 track Tracker 到交付树，字节核对一致，保留无关 WIP。
- P2 R7 quota stop/takeover: exec69651 自然 exit1，179events/turn.failed，所有已启动工具项均completed，无未完成工具命令；详细report缺失，已有8个 source/test 路径差异保留。ZAI 原响应明确“五小时使用上限，2026-10-05 15:33:26 重置”；首次阻塞日志 UTC04:10:24（本地12:10:24），当前UTC04:12:01，因此约3小时23分而非一小时内。依据现有工作流立即转 GPT，不再重启 GLM、不等待或中途切回。风险为文件效果、异步权限/生命周期和历史协议；writer=GPT，review mode=independent，reviewers=attachment_delete_review/history_regression_review（零写），门禁和原范围不变。
- P2 GPT correction: 复用原 history sink 捕获迟到有限事实，不保留无效 session/observer；活 owner 消费当前投影，disposed 不授 Undo。latest-per-receipt Undo 保留部分恢复并支持完整恢复后稳定刷新；查询/历史闭合 unknown 恢复效果，schema 仍要求原收据支持。keep 最后来源准入、整组迟到事实/remaining skipped、明确禁用能力与实际 Trash 是否已发起均已修；真实历史/字节/CAS 回归覆盖。没有 provider 调用或运行态权限复活。
- P2 source acceptance/handoff: 两位独立 reviewer 对最终 checkpoint/unknown 合并定点确认无剩余必修，F-06–18 关闭；root-gpt-fix6-execution 27tests 与 tsc 均自然0。46个 allowlist source/test 文件逐个核 root 与 22cf028e 原基线后接收，字节核对一致；source-handoff.json 留证，无关 dirty work 保留。此为源码候选接受，不是 P2 完整退出或实际 app/model/mobile PASS。
- P2 root gate: 首次 make deploy 在 lint 自然2，8个未使用声明/空 interface 问题；未构建、未部署。root 仅清理 import、unused catch 参数及等价 type alias，再冻结 make deploy final；lint/build 已自然通过，全量 Jest 运行中。没有重复已通过完整门禁或强制退出。
- P2 root broad correction: root-make-deploy-final 自然2：377 suites中375PASS/2FAIL，8955PASS/36FAIL。domain-action-state 两断言揭示 legacy completed summary 多带 actions（恢复旧省略规则，仅 compound effects 保留）及新增 partial outcome 的未同步预期；Ghost client 34例均因沙箱 loopback EPERM。四套定点在支持本地合成服务器环境自然0/170PASS，不接触真实 Ghost/provider。history reviewer 独立确认最窄修正；最终冻结 make deploy accepted 在同支持环境运行，门禁不削弱。
- P2 root complete local gate: root-make-deploy-accepted / exec73097 自然0：platform guards、lint、production build/typecheck、377 suites/8991tests全PASS，随后 deploy-current 实际复制 root/test 资产并校验身份。Jest 一秒退出提示曾出现，随后自行正常退出；未 forceExit/终止/掩盖资源问题，不因短暂提示新增重复检查。DOM零匹配、diff通过；docs 283 Markdown/3360links通过，4既有advisory不变。
- Desktop preparation: 当前 test 模型为 qwen/deepseek-v4-pro、就绪状态 token_unknown；固定响应 seam 第一次安装因此无效果退出，专用leaf已detach，不读credential。实际 Memory started/canAutoMaintain 为true且 manual/preparation/controllers=0，按既有stopAutoMaintenance/waitForIdle暂停后创建公开normal.md和269-byte PNG；原SHA256=8c7090dfe0168a35c4105632e384b11dddcca6a8004328c660f6c63f7077e451。global fixture handle负责清理自建文件后按原started恢复，不清原dirty；原B158页面保留。尚无新功能UI PASS。
- Desktop fixed-model boundary correction: 初次 native send 因临时模型缺 Runnable 协议/完成标记而 error，tools 空且夹具原文/hash不变；修正仅 temp helper，执行真实 provider-input/source admission callback。第二次 native send 已取得 current-note complete lineage，remove_note_image recoverable_error/staged=false/wrote=false；原 Host 文本确认 metadataCache.parseLinktext 不存在。官方声明将 parseLinktext 导出为 module function，实际 cache typeof=undefined（CLI 全局 require obsidian 不受 plugin loader 支持，不能据此否定官方导出）。root 最窄改用官方函数并以 native-shaped cache/真实 prepare 增回归；原 source full gate 因该适配输入变化不再覆盖最终候选，冻结后集中重跑。没有绕过来源/引用/权限核查。
- Desktop native API gate: root-make-deploy-native-api / exec83308 自然0，378 suites/8992 tests、lint/build/platform/root-test资产校验通过。实际正常提案、完整预览一次确认令引用与PNG均移除，Chat一键Undo恢复原文与SHA256；F-19关闭。固定响应仅替代专用实例模型，实际来源、Runtime、controller、FileManager和Vault均保持；不等于真实模型语义通过。
- Desktop keep/partial/unknown: 显式keep新提案只移除引用，PNG原hash不变，文字Undo通过。专用原attachment边界一次合成no-op或native成功后丢响应，真实UI确认/只读query/显式Undo通过；保留note applied与attachment failed/unknown，不自动重删。实际shared提案无冲突列表（F-20）；unknown行只显示未知遮住note已改（F-21），按原REQ修正。
- Desktop cleanup: fault→专用Chat→公开fixtures已清理，全部临时global删除，公开文件不残留，原Memory started状态恢复。期间原B158 leaves由外部UI改变关闭，不重建或冒称保留；原烟测历史保留证据，无设置、Debug或mobile切换。
- F-20/21 frozen correction: 完整获准shared scan冻结Host-only冲突提案，复用pending intent且整组确认最初边界硬阻；incomplete仍generic零写且无累计路径。tool/history/summary/current query仅有限shared marker，不发冲突路径。UI紧凑/完整显示全部允许冲突并禁确认；未知/partial及receipt-only Undo失败沿用已知分效果，旧四工具保持。root领域57tests、真实tool-fact-summary/current-owner-query31tests、status闭合5tests自然0；测试类型语法错误日志保留，UI最终focused/独立review和最终门禁仍待。
- F-20/21 final source review: UI4suites/367tests自然0；mixedbatch通过真实collect→MemoryHistory→Host5case（chat-view338tests自然0），原3套输入不变复用。两个独立reviewer核complete/incomplete隔离、整组硬阻、finite事实与同owner多call绑定及receipt-only Undo效果保留，无生产必修。fixture对象类型/同步签名/非法empty effects已最窄修；冻结后build/typecheck/lint通过。
- Final broad fixture correction: root-make-deploy-final-ui实际376PASS/2FAIL suites，8991PASS/21FAIL tests；未部署。新增全局facts规则使默认cache/lifecycle的singlechunk夹具跨16000既有上限，固定调用位置/one-shot mock失效；B129标记跨chunk而serialized JSON整词断言失败，未丢图片来源。不同reviewer独立确认，生产上限/分块/缓存不变：默认history仍12turn、padding150→120；B129保留400unique并按source内容重建核原引用/no pixels/latehash rejection；latework补finally。当前两suite119tests及tsc自然0。原失败Jest被未完成第二次mock留下30min timer，定位owned PID52854后明确TERM；make终止exit2，不把停止算PASS。inputs再冻结，复用不变lint/production build，集中完整Jest后eligible deploy-current。
- Final local delivery: root-final-all-tests.log为378suites/9012tests全部PASS、252.38秒、自然exit0；root-final-deploy-current.log实际复制当前生产资产并核身份。最终共享提案在compact/full展示冲突且禁确认，原文/hash未变，真实只读query返回blocked/false Undo；native Trash成功后合成丢响应显示note applied/image unknown，原UI Undo恢复原文/hash。F-20/21关闭，无新增审查或运行测试轮次。
- Final reload/cleanup: 官方plugin reload后通过原生History加载本次3turn会话，loaded/persisted有限事实与重载前完全一致；两原intent只读观察均owner_unavailable/false Undo，界面无旧Confirm/Undo。fault→专用Chat→公开fixtures已清理，4个临时global均删除；重载检查前的原会话及Chat leaves恢复，Memory started=true，B160-smoke不存在。保留测试历史和交付证据，无私人vault/设置/模型调用。
- Delivery adjustment: 用户指出测试与验证过重。确认交付工具反复失误、共享协议引发旧夹具返工及实际app验证过晚造成额外耗时；复用不变检查，完成原剩余边界后停止扩展审查/测试，不新增成本研究或门禁。
- Owner correction/model/mobile acceptance: 2026-10-05 用户授权真实文本模型验收，并重申除iOS系统特有能力外使用CLI mobile simulator。Spec/SDD/Plan同步；新Host仅使用跨平台FileManager/Vault/MetadataCache，无iOS专有调用。当前配置qwen/deepseek-v4-pro通过插件正常refreshAPITokenPresence读取就绪状态，不导出凭据。mobile从app.isMobile/body=false切至true后用6turn/16真实provider请求完成正常联合预览、Confirm/Undo、共享阻止及partial/unknown只读追问；两次查询仅get_operations_status、无新提案。实际PNG/native Trash与恢复保持；partial为一次no-op、unknown为native Trash成功后一次响应丢失。单次模型结果不推定总体成功率。
- Model wording limit: 共享回答的“确认后重新提交”有歧义，但没有声称能绕过保护或执行新效果；当前冲突列表可见、Confirm禁用、原文/hash不变。按Agent Behavior Acceptance由不同只读reviewer核为非必修措辞限制，保留原回答，不新增修复/重测；未自动改keep。
- Final model/mobile cleanup: 4个提案最终为undone/cancelled/undone/undone，最后原文与269-byte PNG原SHA恢复。fault→专用Chat→fixtures清理完成，3个global句柄删除、B160-smoke不存在，原Memory started=true；CLI mobile恢复off，app.isMobile/body均false，Debug初始unknown且保持不动。源码、tests、build及部署输入未变，不重复运行门禁；公开历史与证据保留。
- Planned execution: 原 GLM writer 终止后 GPT 单 writer 接管，两个不同的只读风险面 reviewer 独立验收；昂贵门禁由 root 集中调度。P1 不开放新能力/UI，T-02/T-03 在完整候选接线后才注册。
- Validation authority: repo test 为获准本地部署目标；实际文本模型验证费用范围及 iCloud/mobile 目标仍核对对应权限，无获准证据保留未验证。禁止真实图片生成，不扩大 Spec Non-goals。
- WIP coordination: B-158 已按原 8900 gate/独立 app 恢复/后续工程验收整理为 Validated，F-24 Deferred/B-159 启动条件与原 FAIL/PASS 保留；不回头修复或 closeout。
- Execution environment: Mac，Node 22.22.2/npm 10.9.7，Codex CLI 0.155.1；pa-glm/ZAI Responses/glm-5.3/max 的非秘密字段核对，所选 catalog 元数据与仓库一致，复用同机 B-158 preflight；服务端型号未知。
- Owned resources: 原managed worktree /Users/eddie/.codex/worktrees/note-image-removal/personal-assistant（起点22cf028e）已recoverable archive；list_artifacts实际返回archived_worktree，保留Git恢复快照，root依赖不变。当前交付源码留在root；证据目录/private/tmp/pa-b160-resume-BlLyTc及公开测试历史保留。App临时文件/句柄已清理，原旧证据目录不可见的限制保留于历史记录。
- Shared-work preservation: root 新出现的 AGENTS.md/refactor-workflow.md 为其他工作，保留不接收为 B-160 改动；已读变化并按当前比例适当性规则执行。P1 原源码检查输入未变；规范涉及的 docs 契约另验。
- App setup: repo test 运行且插件存在，body 的 is-mobile=false；未改变模式、设置或 reload。当前 CUA 窗口显示实际运行 Obsidian 1.14.4，安装入口 Info.plist 为 1.12.4，分别记录；旧版静态实现不是当前运行或跨平台验证。只读 dev:debug help 已确认仅 on/off attach/detach，无公开状态 reader；初始 Debug unknown 并保持不动，不据 PA setting 或无参数调用猜测状态，不阻止独立源码工作。
- App preparation: 只读定位现有专用 ChatService aiUtils.createChatModel 固定 stream/bindTools 入口；真实窗口发送、Runtime/staging、内联 confirm/Undo 链保持。专用实例使用既有 skip-memory、完成后 extraction callback no-op 与 additional capability providers 空集排除外部调用，保留单独 Operations provider；验证后恢复原方法。最终 schema/guard/卡激活依赖候选。此准备不证明 app 或真实模型 PASS，无应用改动或 provider 调用。
- iOS preparation: 定向只读 USB iPhone 节点匹配 0，未排除无线连接；实际 xcrun devicectl exit72/无 JSON，当前 CommandLineTools 下 CoreDevice 不可用，ideviceinfo 未安装。OS/信任配对/Developer Mode unknown；未打开镜像/Safari、读取手机或 iCloud vault、安装工具或部署。可选诊断工具限制不等于 iOS 行为失败，后续仍需获准公开测试目标与真实交互/加载证据。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-160/REQ-01 / B-160/AC-01; B-160/REQ-02 / B-160/AC-02; B-160/REQ-03 / B-160/AC-03 | P1：最小契约、notePath 来源接线、目标/引用核查与内部预览；不注册新能力 | [x] | P1最小内部切片接受；current preparation19PASS及原不变五suitePASS，Local Gate、两个风险面定点复核通过；完整AC仍依赖P2 |
| T-02 | B-160/REQ-03 / B-160/AC-03; B-160/REQ-04 / B-160/AC-04; B-160/REQ-05 / B-160/AC-05; B-160/REQ-06 / B-160/AC-06 | P2：最小事实/持久化先就绪；官方删除、快照与一键撤销同切片 | [x] | 实施/独立review/9012test门禁、desktop与mobile simulator实际删除/原文原字节Undo及真实模型语义通过 |
| T-03 | B-160/REQ-01 / B-160/AC-01; B-160/REQ-03 / B-160/AC-03; B-160/REQ-04 / B-160/AC-04; B-160/REQ-06 / B-160/AC-06 | P2：query/历史/Runtime/UI 与 T-02 联合闭合后注册能力 | [x] | query/历史/Runtime/UI与共享/逐效果/追问/重载通过；6turn真实文本模型完成原ID状态查询，无新删除 |
| T-04 | B-160/REQ-01 / B-160/AC-01; B-160/REQ-02 / B-160/AC-02; B-160/REQ-03 / B-160/AC-03; B-160/REQ-04 / B-160/AC-04; B-160/REQ-05 / B-160/AC-05; B-160/REQ-06 / B-160/AC-06 | P2 退出门与 P3：独立审查、集中门禁、实际 Chat/device 与最终验收/恢复 | [x] | F-01–21 Closed；本地门禁/部署/desktop/真实模型/mobile simulator及app环境恢复完成；无iOS专有能力，不另设真机门；无Git/发布/closeout |

## Validation Planning

| Risk / AC | Change | Minimum sufficient evidence | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- | --- |
| AC-01/02/03 | 最小契约、notePath 来源、联合目标、引用核查、确认 | P1 domain/source focused 与 Local Gate；P2 公开 callout 实际 Chat 预览/确认 | 错误/共享/不完整/失效首笔零写；keep 不触发删除专用扫描/二进制/Trash；正常确认一次执行 | 解析、核查覆盖或权限输入变化 |
| AC-04 | 子步骤及 owner 查询投影 | 实际 Operations→fact→history→Runtime 的 failed/unknown 与只读查询回归；旧收据/新效果混合持久化、重载/压缩；实际 Chat 追问 | 不丢已发生效果，不把未知判为未执行，查询零写 | 结果协议、schema/lineage、历史投影变化 |
| AC-05/06 | 二进制快照、恢复与资源 | 原字节/原文恢复、部分恢复、碰撞、TTL、并发 Undo、容量/dispose 的 focused | 不覆盖、不重做、不丢步骤，不保留过期 buffer/额度 | 恢复路径、容量或生命周期变化 |
| AC-03/05 | 实际来源收据与自身已知写入 | TaskSourceRun 真实 lineage receipt + domain 接线；空搜索观察祖先/普通来源/真正权限撤销 | 自身已知效果不被当成权限撤销；实际撤销仍停止；不绕过原来源边界 | retained source 准入或全库 evidence epoch 条件变化 |
| Shared/domain/UI | 最终冻结候选 | 单一执行者 make deploy；补 DOM scan、docs/diff；独立 review | 必需检查自然通过；只部署 repo test 并完成受影响可见交互 | 新源码/测试/依赖或已证失败；不因 commit 重跑 |
| AC-01/03 原生 API 接线 | 使用官方 module parseLinktext 与 MetadataCache.getFirstLinkpathDest | native-shaped Host→真实 prepare 回归、官方声明/实际 cache 边界、重新部署后的真实 UI 提案/确认 | 不依赖不存在的 cache 方法，实际图片与附件预览出现；准备零写 | 原生适配、官方 API 或已证 app 失败变化 |
| AC-02/04 F-20 | 完整获准冲突冻结为blocked提案、整组硬阻、有限事实/query | 累计冲突后incomplete隐藏、mixedbatch首笔零写、真实tool→history→summary、同intent多call可见查询；compact/full实际列表 | 所有可披露冲突可见且不可确认；不完整无累计信息；同run/turn多call同owner，不同绑定拒绝 | block/admission、事实schema或Host绑定变化；已证UI反例 |
| AC-04/05 F-21 | compound效果和receipt-only Undo错误同显 | inline/full execution unknown与expired/failed Undo focused；最终公开native-lostresponse UI | note已修改与附件未知不被总状态/Undo错误覆盖；新Undo effects优先 | 结果行/Undo投影变化或实际效果反例 |
| AC-01/02/04/05 | 获准真实模型语义 | 另获明确调用授权后按 Plan 使用公开夹具；禁止图片生成调用 | 正确选图/冲突/Undo/部分及未知结果追问；未获授权或未运行保留未验证 | 语义指导、能力/schema、查询或模型配置变化 |
| AC-03/05/06 | both 平台 API/交互 | 桌面证据复用；CLI mobile simulator 最小可见交互；领域失效回归复用 | mobile 删除/Undo/共享冲突可用；真实模拟状态确认并恢复；不称真机证据 | 平台 UI 变化或已确认 iOS 专有能力/模拟器系统边界缺口 |

## Findings

| ID | Severity | Finding | Decision / design | Verification | State |
| --- | --- | --- | --- | --- | --- |
| D-01 | Design | 当前图片变为正式附件后无删除能力 | 新增窄的复合领域操作，不扩大旧 cleanup | 当前独立review、本地门禁及desktop联合删除通过 | Implemented |
| D-02 | Design | 一般 Undo 不保留附件；现有懒过期不适合二进制 | 容量预留、内存快照、到期清理及执行中租约 | 当前生命周期/字节回归、desktop原文/hash恢复及重载失效通过 | Implemented |
| D-03 | Design | 当前 Operations 会把未知子步骤投影为失败 | 扩展原 owner 分效果结果/闭合投影 | 当前历史/query回归、desktop partial/unknown逐效果及重载事实通过 | Implemented |
| D-04 | Design | 官方 API 注释未完整描述永久删除设置 | 文案按设置删除；Undo 独立于回收站 | Mac Obsidian 1.12.4 安装实现静态读取；非运行/跨平台证据 | Recorded limit |
| D-05 | Design | 正常 settle 与 Undo 快照保留责任需分开 | 执行租约释放后快照仍由 Undo owner 保留；失效时等执行结束再释放 | 独立 review 指出，SDD 已澄清并复核通过 | Design corrected |
| D-06 | Design | keep 分支不能进入附件删除专用检查与效果 | 仅当前笔记修改/文字 Undo；delete 才做共享核查、二进制快照与附件删除 | 独立 review 指出，SDD 已澄清并复核通过 | Design corrected |
| D-07 | Design | 现有来源读计划固定 input.path，新接口拟用 notePath | T-01 接通真实来源准入；不是仅增加 schema | 真实TaskSourceRun/Host集成与desktop当前笔记来源通过 | Implemented |
| D-08 | Authority | Spec 排除真实 provider 付费调用，SDD 模型门原措辞未写授权前提 | Plan/SDD 明确另获调用授权且符合费用边界；无证据留未验证 | 只读 reviewer 指出；未改产品费用范围 | Clarified |
| F-01 | P1 | 有限 allowedPaths 跳过必要候选却宣称 complete | 无权候选零读；必要覆盖不足阻止 delete，隐藏禁止信息 | R3 finite scope 与 R3b excluded/denied 无路径/数量、零读断言及独立复核通过 | Closed |
| F-02 | P1 | reference-style、inline HTML 与 callout 代码围栏漏检/误选 | 可靠解析与范围；未支持的实际形式阻止完整核查 | R3–R3c code/comment/subpath/混合inline-code/wiki等实际负例及最后单项独立复核通过；未证范围fail closed | Closed |
| F-03 | P1 | Canvas text node 引用漏检 | text/file 节点实际解析，无法核查时阻止 | R3 真实 text-node 共享引用断言与独立静态复核通过 | Closed |
| F-04 | P1 | 扫描缺少逐源和库存新鲜度边界 | 身份/版本及库存变化使覆盖证据失效，确认/写后复核当前证据 | R3/R3b 替换/新增、同对象原位版本与仅权限撤销断言及独立定点复核通过 | Closed |
| F-05 | P1 | delete 准备缺附件权限准入，keep 却被附件变化阻断 | delete 提案前核附件；keep 仅文字边界，不混用删除准入 | R3 独立 keep/delete 变化与禁止目标断言、两位复核通过 | Closed |
| F-06 | P2 | 原 run-notes-observation 祖先因自身 note 写入推进 epoch，写后复核拒绝并再次只改笔记不删附件 | 首笔前完整来源准入，已知自身效果后区分授权和新鲜性、消费新当前领域证据；保留真实身份/权限/约束，不复活 run | 独立 reviewer 核当前 controller 写后原 callback 与 TaskSourceRun/EventBridge 实际链，须真实 lineage 集成负例 | Closed |
| F-07 | P2 | keep 创建新 kind receipt 却统一 acquire 不存在的图片 snapshot；文字 Undo 不可用，附件还误标 applied | keep 只文字效果及文字 Undo、保留原来源准入，不进入二进制/附件检查 | 当前 execute/Undo 实际分支及 keep 测试未覆盖 Undo | Closed |
| F-08 | P2 | Undo 在笔记 after/原祖先权限核对前恢复附件，成功删除后未保留来源收据 | 私有原 Undo owner 保留来源/身份，恢复前及 await 后准入、先核 after；现有漂移首笔零写 | 当前 restore 在 read note 前，proposal 删除后 snapshot 无 source receipt | Closed |
| F-09 | P2 | 二进制读后及 Trash 最后边界缺当前版本/附件权限核对 | 验实际读后版本及删除前动态权限/身份/版本；中途变化 partial 保留 note | 同 TFile 改写或扫描中 revoke 可删除新内容并留下旧快照 | Closed |
| F-10 | P2 | dispose 于不可取消 native write 等待中，resolve 后先生命周期 throw，已发生效果被丢弃 | 先结算 native API 效果再停后续准入，外层不丢结果、不恢复权限 | 当前 process/Trash 后 assert 与 inactive catch/confirm 实际链 | Closed |
| F-11 | P2 | 关闭单 session 只 clear UndoStore，不释放该 owner 共享 snapshot/额度 | 原 owner receipt 集合 retire，执行 lease settle 后释放；其他 session 不受影响 | 已失效 20MiB 快照可累计耗满 64MiB，到 TTL 才释放 | Closed |
| F-12 | P2 | 新 query 缺有限 observation validator/实际 capability lineage 分支，来源筛选过滤成功结果 | 闭合输出/实际 capability 身份/来源 free lineage 接线 | Runtime unknown lineage→TaskSourceRun 有 runSourceSelection 时过滤 | Closed |
| F-13 | P2 | Query 读初始 execution，完整 Undo/TTL 后仍返回 removed/undoAvailable true | 原 owner 当前效果与能力投影；完成事实与当前 Undo 分开 | getOwnedContextResult.undoneReceiptIds 被忽略，execution true 不刷新 | Closed |
| F-14 | P2 | 附件恢复后 note 漂移只有 message，没有 owner/history 恢复 checkpoint | 有限 checkpoint 经 UndoResult/context/actionStates/UI 保留，重试只余下步骤 | 当前 partial restore 仍对外显示 attachment removed | Closed |
| F-15 | P2 | 历史把 removed→applied、not_started→failed，无独立效果/恢复能力字段 | 闭合 per-effect 和 checkpoint/UndoAvailable 保存读取投影，旧四工具兼容 | 当前 actionId 字符串猜语义、完成 summary 省略 facts | Closed |
| F-16 | P2 | 实际 inline confirm 只 note diff，无附件影响/临时Undo说明；partial/unknown 被误投影且receipt当能力 | inline/full 消费同有限审阅模型及当前能力，真实分效果结果 | 当前 ChatView 未改，仅 full panel 部分接入 | Closed |
| F-17 | P2 | Query Host 静态 history Map，无当前 timeline/lifetime/唯一绑定；跨同会话surface owner误报丢失 | ChatView 动态可见原 run/intent Host port，read 前后寿命与绑定，先可见后 owner read | 实际 ChatService/Runtime 接线及前序 foundation 独立核查 | Closed |
| F-18 | Test evidence | 原字节恢复 fixture 始终保留原 bytes，restore mock 忽略参数，错误字节也过断言 | 删除后移除当前内容，恢复消费实际snapshot/path重建，核新目标/参数；失败也清理 fixture | 独立 test reviewer 核实际 stub 与 assertion；原 CLI failed test 后 open handles 原文 | Closed |
| F-19 | App boundary | Host 调用不存在的 metadataCache.parseLinktext，真实 Chat 提案被阻止 | 使用官方 module export；cache 类型引用官方 getFirstLinkpathDest；native-shaped Host 跑真实 prepare | 新回归20tests及独立review；378/8992 gate与真实提案/确认/原文原hash Undo通过 | Closed |
| F-20 | App/UI boundary | shared error阻止了写入，却无可见冲突列表和不可确认提案 | 完整获准scan保留不可变block，整组零写；Host-only冲突及finite事实/query | 独立review/回归、最终full gate及真实compact/full冲突/禁确认/零写/query通过 | Closed |
| F-21 | App/UI boundary | unknown结果或receipt-only Undo错误遮住已知note效果 | inline/full优先新effects，无新Undo effects沿用session已知事实并附错误 | 独立review/回归、最终full gate及native-lostresponse逐效果/原文原hash Undo通过 | Closed |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-04 | 全部设计映射 | 当前 master source、官方 API、两个只读领域/harness reviewer | Design input collected | 产品选择已确认；未运行新功能测试、build 或 app smoke |
| 2026-10-04 | 文档契约 | npm run test:docs -- --runInBand --no-cache | PASS，2 suites / 58 tests | 只验证现有文档契约；不证明拟实施能力 |
| 2026-10-04 | 文档链接与格式 | npm run docs:check；git diff --check；新增文档尾空白扫描 | PASS，282 Markdown / 3316 links，无尾空白 | 4 项既有 episodic-memory advisory 未变；仅文档验证 |
| 2026-10-04 | 产品与设计边界 | 两位只读 reviewer；D-05/D-06 修订后定点复核 | 无剩余必修设计项 | 无 runtime 实施或新能力验收 |
| 2026-10-04 | SDD 驱动开发计划 | 当前规范/模板/源码入口、两个风险面 reviewer 对最终 Plan 定点复核 | 无剩余必修项 | P1 内部准备；P2 完整可用切片及自身门禁；P3 独立验收；授权/产品范围未扩大 |
| 2026-10-04 | 计划文档链接与格式 | npm run docs:check；git diff --check；新增文档尾空白扫描 | PASS，283 Markdown / 3354 links | 4 项既有 advisory；既有文档契约 58 tests 的脚本/测试/规范输入未变，复用前序 PASS；无 runtime 检查 |
| 2026-10-04 | P0 / AC-01/03 | 唯一 GLM reproduce；真实 controller/tool-provider/registry/staging 测试；GPT 核源码断言与原日志 | CLI 自然0；Jest 自然1，1 suite/2 tests：旧行为1 PASS、新能力缺口1目标 FAIL | /private/tmp/pa-b160-BXdiaU/reproduce.log 与 reproduce-result.md；非编译/fixture错误。新回归维持红到P2；未 build/部署/模型语义验证 |
| 2026-10-04 | P0 环境/目标 | 同机 CLI/profile/catalog/deps 核对；原生 obsidian vault=test vault info=path | 目标为 /Users/eddie/code/personal-assistant/test | 沙箱内 CLI exit134；同命令经受支持的外部执行自然0。非插件失败；无笔记/配置修改 |
| 2026-10-04 | P1 / AC-01/02/03 | GLM 内部候选 focused 6 suites；tsc、diff、DOM scan；两位只读 reviewer | 141 tests PASS；Local Gate PASS；独立审查 F-01–05 必修，未接受 | /private/tmp/pa-b160-BXdiaU/p1-focused.log、p1-result.md；CLI 自然0。公开仍为原四工具；未 build/full/deploy/model/app/device |
| 2026-10-04 | P1 fix / AC-01/02/03 | GLM R3 frozen 候选 focused 6 suites；Local Gate；两位独立定点 review | 148 tests PASS，自然0；F-03/05 关闭；F-01/02/04 残留必修，P1 未接受 | /private/tmp/pa-b160-BXdiaU/p1-fix-focused.log、p1-fix-result.md；后续修订仅复测受影响输入，不重跑不变原基线 |
| 2026-10-04 | 更新后的文档规范 | root 的 AGENTS/refactor-workflow 变化后 test:docs、docs:check、diff | 2 suites / 58 tests PASS，自然0；283 Markdown / 3357 links；diff PASS | 4 既有 advisory；其他任务的规范修改未由 B-160 改动或回滚；runtime 输入未变不重复测 |
| 2026-10-04 | P1 R3b / AC-01/02/03 | 改动仅解析/准备 module 与 preparation test；target18tests、Local Gate及两位定点复核 | 18/18 PASS，自然0；F-01/04 关闭；F-02 混合 inline-code/wiki 残留具体必修，P1 未接受 | /private/tmp/pa-b160-BXdiaU/p1-fix2-focused.log、p1-fix2-result.md；其余五 suite 输入未变复用 R3 PASS，非全量重跑 |
| 2026-10-04 | P1 R3c exit / AC-01/02/03 | 唯一残留修复后 target19tests、tsc/diff/DOM；GPT核actualline/新负例，attachment reviewer定点确认关闭 | 19/19 PASS，自然0；Local Gate PASS；F-01–05全关闭；P1接受，非功能全部验收 | /private/tmp/pa-b160-BXdiaU/p1-fix3-report-detailed.md 与 focused/tsc/diff/dom原logs；其余五suite输入未变复用R3；新能力不注册，无app/模型/设备证据 |
| 2026-10-04 | App baseline 准备 | CUA getApp 只读窗口；限定外部 CLI dev:debug help；安装入口版本 | 运行窗口 1.14.4 与 installer 1.12.4 分开；Debug unknown/保持不变 | test 窗口及既有合成历史可见，未交互/部署/reload；body.is-mobile=false 仅为桌面呈现观察，不冒充独立 emulation 状态或新功能 app PASS |
| 2026-10-04 | P2 R4 恢复检查点 | 原 exec handle、exit 文件、turn.completed、原 events 与限定进程查询 | CLI 自然0，但完整候选/最终检查未交付；不得接受 | /private/tmp/pa-b160-BXdiaU/p2-events.jsonl、p2-result.md（错误指令文本）；真实入口回归转绿，最后 execution suite 无完成事件且最终 logs 缺失；无旧进程残留。协议输出问题与额度/认证失败分开，保留 diff/evidence 后定点修订恢复 |
| 2026-10-05 | P2 当前实际差异定点 review / AC-01–06 | 两位领域/harness reviewer 与一位 fixture reviewer，零写入/零测试；原 CLI 证据恢复 | F-06–18 为当前可触发契约缺陷，P2 未接受 | 非偏好或缺最终门重复记 bug；有限原字节 fixture、真实查询/inline、原来源/生命周期/恢复接线需修正；原临时 logs 不可见明确记录，原唯一 CLI rollout 保留 |
| 2026-10-05 | 修订后文档/当前规范 | root docs:check、test:docs --runInBand、diff | 283 Markdown / 3357 links PASS；2 suites / 58 tests PASS，自然0；diff PASS | 4 已知 advisory 不变；只证明当前文档契约，不证明 P2 runtime；原临时 logs 缺口不冒充完整当前证据 |
| 2026-10-05 | 后续 app/device 前置条件 | 只读现有 Chat fixture seam 与定向 USB/CoreDevice 工具核查 | 准备信息已核；无 app/device 行为 PASS | 专用实例须覆盖 Memory 与远端 capability 两端；USB 匹配0不排除无线，OS/配对状态unknown；未部署、交互、改设置或调用 provider |
| 2026-10-05 | P2 R5 WIP 定点复核 | 原领域/harness/fixture reviewers，零写/零测试 | 已见部分修正及原范围残留；非冻结 PASS | 不重审 P1；fixture 实际删后重建/字节断言/afterEach 清理与真实 TaskSourceRun 接线已见，尚非 createBinary 适配层或真实 Vault event/app 证明；最终接受待候选自然完成、后续差异和当前检查 |
| 2026-10-05 | P2 R5 执行回归检查点 | GLM 在交付树 npx tsc -noEmit -skipLibCheck 后运行 operations-note-image-removal-execution.test.ts | 联合命令自然0；1 suite / 12 tests PASS | 原事件 /private/tmp/pa-b160-resume-BlLyTc/p2-r5-events.jsonl；覆盖原字节/原文、keep Undo、共享/撤权首笔零写、容量/owner隔离、unknown、恢复 checkpoint/碰撞与TTL；只覆盖当时输入，后续改动及已证异步/历史残留仍须闭合；无 broad/build/deploy/app/model/device PASS |
| 2026-10-05 | P2 R5 工具问题与缺失checks | terminal事件/exit文件、原rollout真实tool调用、限定进程查询；GPT在冻结交付树跑原staging与tsc | 无遗留writer/test；staging2/2 PASS及tsc均自然0 | root-r5-staging.log/root-r5-tsc.log位于当前证据目录；原CLI最后未完成命令不能当PASS。调整下一轮检查执行器，仍同GLM source writer，不当quota takeover |
| 2026-10-05 | P2 R5 冻结差异复核 | 原领域/harness reviewer仅查WIP后改变路径，零写/零测试 | 完整UndoResult/晚建snapshot已修，原范围残留已证；P2未接受 | 未重审未变P1/query/Host/inline；真实production无缺authority epoch callback路径，不新增假设修复；下一轮修具体异步准入/keep事实/真实历史刷新/finite enum/full UI |
| 2026-10-05 | P2 R6 冻结集中 focused/Local Gate | GPT 单执行者，26 source suites；tsc；diff/DOM，原 reviewer 只读并行 | focused 自然1：20 PASS/6 FAIL suites、915 PASS/15 FAIL tests；tsc 自然2；diff/DOM PASS | 原日志 root-r6-focused.log/root-r6-tsc.log；完整范围已实际运行，无零匹配或强制退出。必修与 fixture/类型问题分别诊断，未接受或运行 broad/deploy |
| 2026-10-05 | P2 GPT 当前 source 回归 | root-gpt-fix2-focused：ChatService/Service/action-state；root-gpt-fix5-focused：execution/action-state；root-gpt-fix5-tsc | 当前相关结果均自然0；前者3 suites/124 tests PASS，后者2 suites/32 tests PASS；tsc PASS | execution 后续修正会影响 runtime 两个共用源文件，冻结 broad gate 仍待；summary 允许合法分块但保留完整前缀/尾部和 fallback 复用。此前失败/类型日志原样保留，不算通过 |
| 2026-10-05 | root 共享摘要兼容与本地请求边界 | domain-action-state/operations-action-state/chat-service/ghost-publishing-client focused；history reviewer 定点核 | 4 suites / 170tests 自然0；review无必修 | root-broad-failures-focused.log；恢复原 legacy summary 契约，compound/partial事实保持；原 full失败记录保留，当前 full仍待，不冒充全量 PASS |
| 2026-10-05 | 当前冻结 source/build/tooling/artifacts | make deploy（支持本地合成监听的执行环境）；DOM/diff/docs补充 | 自然0；377suites/8991tests全PASS；生产构建与root/test部署PASS；DOM零匹配、diff/docsPASS | root-make-deploy-accepted.log；无真实provider请求。此门禁包含全部Jest groups与build-bound输入，不重复已覆盖检查；desktop UI、真实模型、mobile仍各自待验 |
| 2026-10-05 | F-19实际API边界与AC-01/03/05 | 官方parseLinktext适配、native-shaped prepare、完整make deploy、真实desktop预览/Confirm/Undo | 378suites/8992tests自然0；实际引用与PNG删除、原文/hash恢复PASS | root-make-deploy-native-api.log；ui-normal-preview/delete/undo.json.txt。不覆盖后续F-20/21；固定模型、公开夹具、真实Host效果，不代表付费模型或iOS |
| 2026-10-05 | AC-03/04/05 显式keep与部分/未知 | nativeUI新keep提案、一次attachment故障、readonlyquery、显式Undo | keep附件不变；partial/unknown停止新效果、fresh query及原文/hash Undo PASS | ui-keep-*、ui-partial-*、ui-unknown-*原记录；故障为专用边界合成，F-20/21界面事实缺口保留 |
| 2026-10-05 | REQ-02/04 → F-20 block/facts/query | 完整scan与incomplete负例、整批前置零写、真实tool→history→summary、原ownerquery | 4suites57tests、2suites31tests及2suites5tests自然0 | root-f20-focused/integration2/boundary-final.log；早期语法/fixture类型失败不算PASS。通过条件为有限block保真且无冲突路径进入模型；新source/UI变更或实际边界反例才重跑相关门 |
| 2026-10-05 | 最终冻结完整输入 | 完整Jest；复用不变lint/build，eligible deploy-current；不同只读reviewer定点核 | 378suites/9012tests全部PASS，自然exit0；实际部署PASS | root-final-all-tests.log、root-final-deploy-current.log；最后仅修两套旧chunk夹具，119focused和tsc自然0。无生产规则放宽，不再扩展或重复检查 |
| 2026-10-05 | AC-02/04/05 → F-20/21最终desktop | 原生共享提案/readonly query/cancel；native Trash后合成丢响应、原生Confirm/Undo | compact/full冲突可见且禁确认、零写；note applied/image unknown同显、Undo恢复原文/hash | ui-final-shared-query.json.txt、ui-final-unknown-effects.json.txt、ui-final-unknown-undo.json.txt；工具被替代的是模型与一次响应故障，实际来源/Host/Vault效果保持，非真实模型或iOS证明 |
| 2026-10-05 | AC-04/06 → 重载与环境恢复 | 官方plugin reload、原生History加载3turn、有限事实比对/当前owner只读观察；清理owned resources | loaded/persisted事实不变；两个owner_unavailable/false Undo，无旧Confirm/Undo；环境恢复 | ui-final-history-before.json.txt、ui-final-reload-history.json.txt、ui-final-state-restored.json.txt；原会话/leaves保留、4handles无残留、fixture根不存在、Memory原started恢复；历史/证据保留 |
| 2026-10-05 | AC-01/02/03/05 → 真实模型+mobile simulator | 原配置qwen/deepseek-v4-pro自然语言请求，native来源/预览/Confirm/Undo/共享阻止 | 正确目标与联合预览；实际引用/PNG删除、原文/hashUndo；共享冲突可见/禁确认/零写PASS | mobile-real-normal-delete/undo.json.txt、mobile-real-shared.json.txt；app.isMobile/body=true；不读私人vault、不导出凭据、无图片生成。共享重提措辞歧义为非必修限制，原回答保留 |
| 2026-10-05 | AC-04 → 真实模型partial/unknown追问 | 专用一次no-op及一次native-lostresponse；两次原ID get_operations_status | 真实回答保留note applied与attachment failed/unknown及当前Undo；两次只读、无新proposal/删除PASS | mobile-real-partial/unknown-execution/query.json.txt；最终mobile-real-final.json.txt：6turn全部completed，16provider请求、create_image0、4intent全undone/cancelled。故障为合成边界，不声称真实平台故障 |
| 2026-10-05 | AC-06/环境恢复 | native Undo、清理自有资源、CLI dev:mobile off及状态读取 | 原文/原hash恢复；3handles无残留、fixture根不存在、Memory原started；app.isMobile/body=false PASS | mobile-real-final.json.txt、mobile-real-cleanup-state.json.txt、mobile-real-restored.json.txt；Debug保持unknown/unchanged；无iCloud/device部署。领域TTL/重载输入不变复用，不重复mobile故障/历史/全量门禁 |

## Closeout Readiness

- [x] 实施与 owning contract 一致，设计与证据独立验收。
- [x] 必需门禁、真实模型语义和受影响 app 证据完成。
- [ ] 稳定结果吸收，未完成项与文档处置获得对应授权。

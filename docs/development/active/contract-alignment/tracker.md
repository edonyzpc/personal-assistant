# PA Contract Alignment Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-10-05
Work item: B-161
Authority: 本包唯一执行状态、任务、finding及验收记录。
Product spec: [Product Spec](../../../product/specs/pa-contract-alignment-product-spec.md)
SDD: [SDD](./sdd.md)

## Current Snapshot

- 当前阶段：Owner于2026-10-05授权完成B-161全部开发测试；T-00—T-07已完成，12项REQ/AC
  均有对应证据，确认finding已解决。当前为Validated；Owner同日另行授权提交到本地master，
  源码/测试已分三项签名提交交付，配套合同与Tracker随本轮提交；closeout尚未授权。
- 当前授权包括既定实现、相关检查、test vault验收及B-161代码/测试/配套文档的本地master提交；
  不包含推送、closeout、归档或发布。
  无未决产品选择；整体移除Host、B-119/B-112及B-159/F-24专项不在本包内。
- 当前行为：显式Pagelet发现不读不扣自动池，本地Maintenance/Graph保留生命周期互斥；
  自动发现保留12/36及历史计数。旧Review/Quiet Recall专用死链退役，兼容端口及历史数据保留。
  明确Operations修改经领域执行工具直接执行；笔记配图可用自然语言定位，显式来源与撤权仍有效。
- 工程证据为全量有效结果加定向修复复用，不是一次376 suites全绿：原全量374/376 suites、
  8927/8962 tests通过，两失败套件定向68项通过；后续F13 focused572项、fixture6项及类型检查通过。
  首轮F15状态指导的`t07-unknown-guidance-focused.log`为3 PASS，source lint通过，
  最终`t07-final-build-r2.log`/`t07-final-deploy-r2.log`通过并部署test；末次仅指导文字变化，
  通过原状态回答请求的真实模型定向重放，复用未变工具与领域测试。
  部署身份检查不等于重新运行测试。
- 桌面已证直接修改/Undo、仅预览和引用不写、普通Chat/显式Writing、唯一笔记真实配图、
  三来源显式发现及两个本地命令。Share Card 54,702字符完整导出77页/77张PNG，全文hash一致；
  原生取消释放资源。桌面同名来源误选与状态ID误抄的失败保留为F14原始证据。
- 移动CLI simulator已证F13：同请求状态可见、最终历史completed、Undo后undone且原文恢复。
  同名来源r2先询问且`imageRequests=[]`；r1因不存在currentNote的批次读取被拒绝，不算选源验收。
  移动Share Card已观察77页预览/翻页及关闭释放，不重复桌面的整批PNG导出。
- F13已闭合；F14选源指导postfix与移动r2已通过。F15最终指导及真实模型只读回答重放通过，
  原始unknown领域注入、首轮错误文字、首轮postfix仍主动询问重提的失败均保留。
  最后只替换原请求中的一条planner指导，所有历史、工具事实及参数不变；准确说明受理/费用未知，
  无重提建议和工具调用。非作者逐字段复核接受；不是F-24重启、重复App查询或模型成功率保证。
- 交付树复用`/Users/eddie/code/personal-assistant`，基线`8bd2395ce356f15ebbcb93b9602d906f29a05cf3`。
  无新worktree；本地提交见Git Delivery，`DESIGN.md`、`design-samples/`为其他工作，保持不动。
  GPT-6负责authority与独立验收；GLM quota后依已授权工作流由GPT接管的切片不称为GLM交付。
- 原始证据统一在`/private/tmp/pa-b161-RY9CfG`。全部验收实例、测试库合成目录和独立历史已清理，
  临时观察接口已恢复；原设置、学习偏好、mobile=false/debug=false均按实际基线核实恢复。
  最终docs/diff门见Validation Log。本轮仅有本地Git提交，没有真机iPhone、远程CI、推送或生产发布声明。

## Implementation Chronology

以下保留各实施时点的原记录，包括当时未完成状态、失败及接管过程；其中“当前/尚未”
均指记录时点。最新状态以上方Current Snapshot及下方追加的Validation Log为准。

- 当前阶段：Owner于2026-10-05授权完成B-161全部开发测试；T-01文档接续及T-02—T-06源码/focused切片已接受，进入T-07统一工程与应用验收。
- 当前授权：实施既定方案、相关测试与test vault验收；不包含Git提交/推送、closeout或发布。
- 下一步：运行输入已冻结，工程检查和当前构建部署完成；主控正在完成实际模型与测试库交互。
  临时验收适配器独立于产品源码，不改变业务行为。T-07尚未Validated。
- 无未决产品选择。整体移除Host、B-119/B-112、B-159/F-24专项不在本包内。
- 已核对：实际主入口走Deep Discover；旧Review/Quiet Recall含保留代码，不能算当前用户故障；
  自动/显式共用12/36、本地检查沿用前台预算、Operations仍需UI确认、图片仍强制控件。
- 设计者/authority：GPT-6。默认GLM实现与获派验证，GPT-6独立验收；模型派工证据随实际运行补记。
- 交付树：复用当前checkout `/Users/eddie/code/personal-assistant`，基线`8bd2395ce356f15ebbcb93b9602d906f29a05cf3`。
  必要新合同尚未提交，采用互斥文件归属保留现有输入，避免隔离树契约漂移。
  本次基线已有未跟踪`DESIGN.md`、`design-samples/`，归其他工作所有，不触碰。
- 本次临时资源：`/private/tmp/pa-b161-RY9CfG`；无新worktree。当前构建已部署test，
  合成材料、独立历史和临时观察实例正在使用；实际验收结束后记录清理及原设置恢复。
- 本机CLI0.155.1，pa-glm / ZAI `https://open.bigmodel.cn/api/v1` / Responses，glm-5.3/max；安装catalog
  `1b252f01b5753c09864e0fd4d91cacbacb5c94c2ac8cf5fb0bf3fea809a4d1e4`，选定模型条目与repo一致。
  服务端实际型号未知。新auth/tool预检均自然exit0；实际读写与Node断言0→1→0通过。
  scratch初次使用zsh保留变量导致命令错误，修正变量后验证通过；不是产品测试失败。
  原始证据在上述目录`auth-events.jsonl`、`tool-events.jsonl`，T-02任务与日志同目录保存。
- T-02 GLM CLI thread：`01a10b82-db2f-7e72-a6f2-88762e707bc8`，启动日志`t02-events.jsonl`；
  r1已自然退出0，11 suites/633 tests及quality-cache83、rate-limit31通过；主控已核报告和原日志。
  最终tsc存在并行Operations修改的diagnostics，未记全域PASS；冻结build仍必需。
  同thread r2 exec session `64231`已自然退出0，`t02-r2-events.jsonl`修F-07及过时tooLarge locale；
  新回归RED→GREEN，18/31/12 focused通过。r1新增删除闭包与r2分别经product_contracts独立核对，
  主控核真实diff/原始日志后接受源码/focused切片；整体T-07 gate与app证据仍未完成。
  T-06经GPT只读核对后复用本thread派发，exec session `12779`、`t06-events.jsonl`，
  仅拥有host-tools、operations-status-tool及两个独占tests，不写runtime/Chat。
  实施与focused验证进行中，最终工程门仍由T-07冻结后集中执行。
- T-05独立GLM CLI thread：`01a10b8a-f42b-74d2-8e2d-fef47334d074`，exec session `78352`；
  同目录`t05-task.md`限定专属文件，`t05-events.jsonl`记录实际执行；r1自然退出0，
  3 suites/137 tests通过，但独立审查发现F-06/F-09，后续修复状态见下。
  locale清理由T-02完成；应用验收仍待完成。
- T-03仅测试GLM CLI thread：`01a10b99-4238-78b3-8a01-9ff8b94d742c`，exec session `21475`；
  r1自然退出0，实际suite exit1、30通过1目标失败；主控核对原日志与diff后续r2实施。
  r2 exec session `20489`，`t03-events.jsonl`，任务严格排除T-02持有文件，不产生并行写冲突。
- T-04仅测试GLM exec session `86936`，`t04-red-events.jsonl`记录；
  thread `01a10b9c-fc75-75e0-aede-4894c1d54942`，仅写`b133-create-image-tool.test.ts`，
  r1自然退出0，suite exit1、13通过1目标失败；真实schema拒绝sourceNotePath，主控已核原日志/diff。
  生产实施等待T-03 runtime/Chat writer冻结。并行树tsc出现其它writer临时diagnostics，未当作本任务PASS。
- T-05独立review发现全块2048切点形成隐含长内容拒绝，原CLI thread已派r2，
  exec session `65507`、`t05-r2-events.jsonl`；r2后续审查发现F-09。主控核当前源后
  向仅本worker PID60847发送SIGINT，确认CLI exit1且最后工具命令完成，保留全部日志。
  这次停止依据已证实内容完整性/架构违例，不是测试慢或输出沉默；r2不是自然交付PASS。
  同thread r3 exec session `36318`、`t05-r3-events.jsonl`按原静态渲染合同修复；原r1不算完整验收。
- 应用目标只读核实：Obsidian1.14.4（installer1.12.4），`vault=test`路径为上述repo的`test/`。
  受限CLI退出134，同一只读路径查询获准外部执行后exit0；尚未部署/重载/改变模式/调用模型。
- GPT已在本次临时目录准备`b161-chatview-smoke.js`及usage说明，保留真实ChatView/图片提炼和生成，
  限合成路径/独立历史；仅语法检查通过，未运行到app。冻结后核真实私有接缝并独立检查隔离后才使用。
- 2026-10-05 11:26 UTC，T-03/T-05/T-06三个CLI均返回明确5小时额度错误，reset为本地22:53:09，
  距首次确认超过1小时。按delivery workflow§5既有预授权由GPT接管，未发起额外额度探测。
  三个exec session均exit1，主控核所有command/file_change事件已完成且无未闭合item，确认旧writer停止。
  原始日志保留；CLI内部5次自动重试不是主控重复启动。T-03由GPT agent_contracts、T-05由GPT
  product_contracts继续，T-04尚未派实施；不把GPT工作称为GLM独立成功。高风险切片由非作者验收。
- T-06源码已由GLM完成，86/4/87/8 focused通过但报告前quota退出；主控检查实际4文件diff与原始日志，
  保留source实施，补当前runtime将33项完整效果发送给provider及非法末项拒绝的原测试断言（3 PASS）。
  主控为源码非作者，完成独立核对并接受此源码/focused切片；全域build/app仍未执行。
- GPT接管后：T-03由agent_contracts完成领域写入前检查、native结果有限持久化和Undo失效处理，
  主控独立核查后发现F-11，继续由该writer负责dispatcher及现有回归；其他源码冻结。
  T-04由主控实现，product_contracts非作者审阅无可行动P0/P1/P2，404项及补充16项通过。
  T-05由product_contracts实现，legacy_doc_successors非作者审阅无可行动P1/P2；主控核真实源和
  原始报告后接受，8 suites/228项通过。上述均不代表全域build或实际应用通过。
- T-07只读状态基线：CLI确认test库，Electron debugger未附加、app.isMobile=false且body无
  is-mobile；原样恢复命令为`dev:mobile off`、`dev:debug off`。证据`app-initial-modes.txt`。
  已有一个ChatView可供构造器元数据；尚未改变模式/部署/发送模型请求。

## Work / 开发任务

T-00为已完成设计；其余按下表实施。Phase A=T-01文档接续；Phase B=T-02—T-06
实现与focused验证；Phase C=T-07统一集成/应用验收。共享runtime/plugin/Chat由单GLM writer顺序执行。
2026-10-05源依赖核对后，T-05改为独立GLM仅写`src/share-card/*.ts`和其专属tests；
不写locale/plugin/Pagelet/Chat，不与T-02重叠。跨域types及昂贵门集中于冻结后；
独立切片并行不改变产品/接口/验收。T-06经实际调用图核对可仅改两个独占源码及其tests，
与T-03/04共享runtime/Chat写入分离后并行派发；不改变T-07冻结验收。每个任务交付后GPT核对实际diff/证据。

| ID | Requirement / AC | Slice / 交付物 | 依赖 | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T-00 | B-161/REQ-12 / B-161/AC-12 | 接受决定、完整Spec、源码SDD、任务和验证映射 | 用户逐项决定 | [x] | 文档设计与独立审阅完成；原文全面接续仍由T-01完成，不代表AC-12全部完成 |
| T-01 | B-161/REQ-01 / B-161/AC-01; B-161/REQ-10 / B-161/AC-10; B-161/REQ-12 / B-161/AC-12 | 按SDD§7改原文/索引，8类successor和本轮局部覆盖全部有去向；保留历史证据 | T-00 | [x] | 35份旧文档已接续，GPT authority writer/窄交叉审阅及主控定向diff核对；最终runtime事实由T-07收口 |
| T-02 | B-161/REQ-01 / B-161/AC-01; B-161/REQ-08 / B-161/AC-08; B-161/REQ-09 / B-161/AC-09; B-161/REQ-10 / B-161/AC-10 | Pagelet真实入口预算分流、旧路径最小退役、旧语言/候选规则处置；真实来源/生命周期保持 | T-01 | [x] | r1/r2自然退出、focused与独立审查完成；主控接受源码切片。整体工程/app由T-07持有，未提前标功能全验收 |
| T-03 | B-161/REQ-01 / B-161/AC-01; B-161/REQ-02 / B-161/AC-02; B-161/REQ-06 / B-161/AC-06; B-161/REQ-11 / B-161/AC-11 | Operations执行工具/窄端口、解除stage强制终止、UI结果/Undo、容量与恢复额度对齐 | T-01；与T-02文件互斥 | [x] | GPT接管完成领域与dispatcher修复，F10/F11/F12闭合；F13追加源码/focused及移动完成态、状态可见、Undo证据已通过，见T07日志；整体T07尚未Validated |
| T-04 | B-161/REQ-01 / B-161/AC-01; B-161/REQ-03 / B-161/AC-03; B-161/REQ-06 / B-161/AC-06 | create_image真实笔记定位/绑定、指令及schema贯通、一次提交与撤权 | T-03（生产实施） | [x] | GPT实现及非作者审查，404+16项通过；T07已有唯一笔记真实生成、F14同名r2澄清、F15原任务查询与真实模型回答重放 |
| T-05 | B-161/REQ-07 / B-161/AC-07 | Share Card移除两处固定拒绝、算法参数解耦、取消/yield/资源释放、完整输出 | T-01 | [x] | GPT修复F06/F09及非作者审查通过，8 suites/228项；T07桌面原生77页完整导出/取消与移动预览/翻页/关闭均已有实际证据 |
| T-06 | B-161/REQ-06 / B-161/AC-06; B-161/REQ-11 / B-161/AC-11 | Host删除关键词读复用判断，Agent再调用可真实读取；完整Operations事实读取不截断 | T-01；独占文件核对 | [x] | GLM源码及focused通过，报告前quota退出；GPT独立核对并补完整provider传递断言3 PASS，T-07整体验证完成 |
| T-07 | B-161/REQ-01 / B-161/AC-01; B-161/REQ-02 / B-161/AC-02; B-161/REQ-03 / B-161/AC-03; B-161/REQ-04 / B-161/AC-04; B-161/REQ-05 / B-161/AC-05; B-161/REQ-06 / B-161/AC-06; B-161/REQ-07 / B-161/AC-07; B-161/REQ-08 / B-161/AC-08; B-161/REQ-09 / B-161/AC-09; B-161/REQ-10 / B-161/AC-10; B-161/REQ-11 / B-161/AC-11; B-161/REQ-12 / B-161/AC-12 | 独立review、保留边界回归、集中broad gate/真实Agent/app验证、文档实际行为收口 | T-02—06 | [x] | 工程组合证据、桌面/移动代表交互、F13—15修复、最终配置恢复及docs/diff已收口；12项映射见下，Validated不代表发布 |

## 任务派发约束

按[GLM任务模板](../../templates/glm-worker-task.md)由GPT-6在现有任务上下文填写实际工作树、
基线、非秘密provider/model/预检证据和每轮临时目录；此处不伪造尚未检查的环境。
无须每任务创建独立模型会话或重复预检。实施范围获授权后可连续推进，不重复产品确认。

| 任务 | 模式 / 风险 | 必要读集与允许编辑范围 | 终点及验收owner |
| --- | --- | --- | --- |
| T-01 | GPT-6 authority维护；合同一致性 | DEC-051/Spec、SDD§7列出的目标文档及其必要索引；不重写历史验证/其他Tracker状态 | 文档接续完成，GPT核对+docs门；运行时差异保持明确 |
| T-02 | GLM deliver；预算兼容/旧路径删除 | SDD§5；pagelet orchestrator/session、plugin-deep-discover、确证旧Recall/Review专用分支、直接消费者/locale及对应tests | 功能与调用图/兼容证据待GPT独立验收 |
| T-03 | GLM reproduce→implement；写入/权限/恢复高风险 | SDD§3/6；operations域、runtime/工具注册、ChatService/ChatView/review UI、result-facts、相关测试；不改Ghost/Writing语义 | 新入口目标失败与实现后证据，独立review；不自行改验收/Tracker |
| T-04 | GLM reproduce→implement；来源/付费身份 | SDD§4；chat-tool-factories、图片binding/types、ChatView/plugin接线、现有image source/service及对应tests | 无控件链路、撤权及不重复提交证据，独立review |
| T-05 | GLM deliver；长内容/取消 | SDD§6；share-card目录、必要locale及其既有tests，保留SnapDOM | 完整性/取消/真实错误，独立检查输入释放 |
| T-06 | GLM deliver；读取新鲜度/跨域 | SDD§6；pa-agent-host-tools、必要dispatcher接线、Operations状态投影及对应tests | 语义regex去除、再读取和完整效果事实的integration证据 |
| T-07 | GLM获派工程gate，GPT-6独立验收 | 冻结本包输入；只读review可并行；必要修复交当前writer且标失效检查 | Validated仅当全部必需证据齐；不commit/closeout/release |

共同负例见SDD和Spec；scope冲突只停受影响步骤。仅允许本任务必要源码/测试/合同和
脱敏结果进入既有pa-glm/ZAI授权范围；不读私人vault或凭据。测试vault为repo `test/`，
最终实际路径由派工所在机器解析；移动使用CLI simulator，未要求真机/生产Ghost。

## Validation Planning And Reuse

下列是未来实施命令/场景，不是已运行结果。测试名均定位到现有源码组；新增用例只补
新接口真实风险，不为重复合同措辞或已证实死代码建镜像测试。每任务先focused；相关输入
改变才重跑，静态 docs 修改不自动作废运行证明。执行前再确认suite分组未漂移。

| Task / REQ-AC风险 | 变化 → 最低充分证据/命令 | 通过条件 | 重跑/扩展触发 |
| --- | --- | --- | --- |
| T-00/01/07；B-161/REQ-12 / B-161/AC-12 | `npm run docs:check`；`git diff --check`；人工逐项核SDD§7及12项追踪。若修改checker/skill契约才补`npm run test:docs -- --runInBand` | 链接/状态/覆盖及真实语义一致；已知warning独立报告 | 文档/authority/links变动；仅文本更新不要求插件build |
| T-02；B-161/REQ-08 / B-161/AC-08; B-161/REQ-09 / B-161/AC-09; B-161/REQ-10 / B-161/AC-10 | `npm test -- --runInBand __tests__/plugin-deep-discover-integration.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-settings.test.ts`；被修改旧消费者追加其现有suite | 显式不扣池、自动耗尽/故障阻断、reload与旧计数保留；真实入口正确、旧流程无复活 | scheduler/admission/storage/旧消费者变化或发现仍可达分支 |
| T-03；B-161/REQ-02 / B-161/AC-02; B-161/REQ-11 / B-161/AC-11 | `npm test -- --runInBand __tests__/operations-intent-controller.test.ts __tests__/operations-review-session.test.ts __tests__/operations-task-source-read.test.ts __tests__/operations-note-image-removal-execution.test.ts`；在现有runtime/ChatService/UI suite补stage→execute链及原生调用等待时dispose | 明确请求无二次确认；原生返回后实际效果仍保存原对话，失去owner不虚报Undo；分析仅预览不写；超过旧额度；部分/unknown、取消、漂移及Undo保护 | 执行入口/领域状态/效果投影改变；controller通过不替代入口测试 |
| T-04；B-161/REQ-03 / B-161/AC-03; B-161/REQ-06 / B-161/AC-06 | `npm test -- --runInBand __tests__/b133-create-image-tool.test.ts __tests__/image-generation-service.test.ts`；补未预先read_note而直接提交sourceNotePath的实际入口integration | lineage/有效性冻结前完成受限来源读取；web-only、选定A指定B和准入后撤权均受保护；同一来源进入提炼/提交，无重复付费submit | source/binding/schema/guard/提交链变化 |
| T-05；B-161/REQ-07 / B-161/AC-07 | `npm test -- --runInBand __tests__/share-card-modal.test.ts __tests__/share-card-paginator.test.ts __tests__/share-card-export.test.ts` | >50K且>24页代表内容末句/顺序完整；取消与错误；Copy/Save一致 | 分页/渲染/资源/导出变化，实机暴露资源问题 |
| T-06；B-161/REQ-06 / B-161/AC-06; B-161/REQ-11 / B-161/AC-11 | 选实际修改的host-tools/dispatcher/operations-status suite；加同参读取在文件更新后返回新事实的集成断言，复用`task-source-executor-integration.test.ts` | 无词面判断/静默成功缓存吞调用；完整效果可读；来源scope/撤权保持 | 分发、复用或上下文事实投影改变 |
| T-07；B-161/REQ-04 / B-161/AC-04; B-161/REQ-05 / B-161/AC-05; B-161/REQ-06 / B-161/AC-06 | 复用`writing-context-run.test.ts`、`ghost-publishing-controller.test.ts`、`b153-prepare-ghost-post-tool.test.ts`及来源integration；full gate若已覆盖不单独重跑 | Writing显式入口/父版本、Ghost具体版本与unknown、三scope隔离均保持 | 公共registry/policy/命令接线变化或对应回归失败 |

代码/DOM切片还遵循AGENTS Local Validation Gate：focused、`npx tsc -noEmit -skipLibCheck`、
`git diff --check`及DOM源扫描；生产build已含typecheck时复用。最终冻结输入后由一个执行者
运行`make deploy`（覆盖lint/build/full Jest并部署test）和未覆盖的docs/diff/DOM检查，
不再独立重复lint/build/full tests；已具备同输入gate/生产build时才用`make deploy-current`。
artifact组仅对当前build运行；coverage不新增为本任务门槛。

T-07真实证据最小集合：

1. **Agent语义**：当前明确修改、只分析/仅预览、引用中的指令、未知结果追问；自然语言
   唯一笔记与真实歧义；普通Chat/显式Writing。用合成test资料和获授权配置，保留原始
   工具/结果事实；不以一组样本推断普遍成功率，不重开F-24历史专项。
2. **应用交互**：CLI先准备test vault/真实页面；观察明确修改直接完成+结果/Undo、无控件
   指定笔记的来源绑定、显式发现和两个本地命令、长卡片预览/取消/保存。CLI成功不能
   代替可见操作。移动simulator只覆盖发生变化的Chat卡片、选源/Share Card交互；不对
   未变后端矩阵重复全套。仅配置/权限均具备时做实际付费调用，未具备时明确证据缺口。
3. **继承边界**：Ghost用现有service/controller边界证据，不执行真实生产发布；新图像
   source通路的provider调用以既有授权范围为准，不能以mock称真实生成通过。

实施前源码核对补充：默认Chat会取`getMemoryExtractionPromptContext`，新建笔记本身
不能保证只发送合成数据。T-07复用既有临时ChatHost/独立历史store及lifecycle采集接缝，
限定本次新合成目录的实际Vault/metadata/Operations端口，关闭该实例既有Memory/Insight/
学习/风格注入，并用已有开关暂停后台且等待其退出。不得照搬B-157禁用专用提炼的录制
image adapter来证明T-04；唯一来源实际生成保留真实prepare与submit链。Unknown追问
可用Image领域故障注入原回执，明确不是真实provider失败或Operations failed冒充unknown。
开始前记录app/配置/模式和资源归属，结束恢复；不运行旧F-24矩阵，不读现存私人笔记。

目标是已确认用户结果，不指定唯一模型措辞/工具次序；允许合理澄清。无新输入/失败/
具体未解风险不重复采样；必需证据缺失保持未验证，不标Validated。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | 事实校正 | 早期将旧Review/Recall源码约束描述为当前主入口故障 | 按实际调用链区分；REQ-10不复活旧流程 | 源码及独立只读核对；非实机证据 | 已纳入设计 |
| F-02 | 设计风险 | UI见stage自动执行会把分析/预览误变成写入 | 明确领域execute入口，Agent决定调用，runtime绑定当前请求 | T03真实runtime stage→execute与只stage不写入回归及独立review通过；实际模型语义归T07 | 源码已解决，继承T07整体验证 |
| F-03 | 设计风险 | 自动池历史时间戳混有手动，无法准确追溯拆分 | 保留自然过期，不清空/伪造分类，未来显式不扣池 | T02真实integration覆盖mixed legacy、reload、未启动lease回滚和12/36自动池；focused已通过 | 源码已解决，继承T07整体验证 |
| F-04 | P2设计缺口 | 新execute若直达Session，会绕过ChatService await前捕获原历史sink；dispose后真实结果可能遗失 | ChatService薄包装在await前捕获原历史sink，native收口保留真实结果 | T03 ChatService102项通过，主控核实际接线及dispose回归；不恢复失效UI/Undo | 源码已解决，继承T07整体验证 |
| F-05 | P2设计缺口 | 若仅在ChatView.submit补笔记来源，runtime可能已冻结缺少新来源的lineage/撤权票据 | scoped binding先解析受限来源并合入lineage，再捕获有效性；同一快照贯穿 | T04真实runtime和来源域测试、非作者独立审查通过；实际模型/app归T07 | 源码已解决，继承T07整体验证 |
| F-06 | P2实现缺陷 | T-05固定2048全块抽样切点在长块上过稀，仍形成隐含可处理容量上限 | 静态原DOM内按需生成有效坐标，保留源边界计划；不重渲染、不猜测不匹配文本 | 25万字多窗口完成后重新渲染全部页，内容/顺序/容量一致；独立审查通过 | 源码已解决，实际浏览器归T07 |
| F-07 | P2合同偏差 | T-02 explicit完成后metrics仍读自动quota，且其故障会丢手动统计 | 解耦统计日边界与自动计数，保留诊断/历史兼容，覆盖完成回调 | GPT调用链核对；真实完成回调RED→GREEN，独立复核无剩余阻断 | 已解决，继承T-07整体验证 |
| F-08 | 验收工具P1/P2 | 临时runner原View.app未隔离；cleanup未覆盖在途图片或UI Operations；权限恢复漏学习三态 | onOpen前绑定隔离App、限制workspace leaf/editor；所有cleanup等原请求/图片回执及execute/confirm/Undo settle；仅暂停必要总开关并保留原偏好 | 非作者静态核对及实际桌面/移动运行；三轮cleanup与`app-environment-restored.json`确认专属资源、接口、原设置/学习偏好及模式恢复。同步工厂fallback在隔离host构造后、onOpen前绑定scoped App，实际断言通过 | 已解决，最终资源与模式恢复已核实 |
| F-09 | P1/P2实现缺陷 | T05 r2细化窗口重渲染全文并复制旧node坐标到新DOM，旧页可截错；paginator更新safeEnd后仍用旧consumed推进 | GPT接管保留同一静态DOM，按最终cut推进；长fence/强调/尾空白与取消回归 | 非作者审查确认无重渲染/坐标转移；全部细化后再检查每页，8 suites/228 PASS | 源码已解决；真实DOM/SnapDOM归T07，r2历史不改判 |
| F-10 | P1/P2实现缺口 | T03新Agent执行入口仅在controller前检查请求signal/来源；普通Markdown native写成功后dispose仍抛cancelled，薄包装不能保存真实结果，tool catch还称未写 | 沿现有域owner把实时执行权贯穿写前异步边界；保留已进入native的实际结果、停止后续项，原history有限收口且失效Undo不重建 | GPT接管focused及主控非作者核对；来源authority仍验Host/current，真实notes/combined自写后合法批次继续；legacy未传范围按原admission修正 | 源码已解决，继承T07整体验证 |
| F-11 | P1/P2实现缺口 | dispatcher在工具返回后以旧readGuard失效覆盖实际Operations结果，自写推进authority epoch可能被说成未准入并建议重试 | 权限仍有效时保留域回执；真实失效时仅保留现有效果事实/状态/恢复，剥离原始材料；读取仍拒绝 | 真实dispatcher/TaskSourceRun epoch RED→GREEN；部分完成反重放、读取撤权和三scope合法批次；主控独立验收 | 源码已解决，继承T07整体验证 |
| F-12 | P2实现遗漏 | 放开Operations数量后，历史action state的100项数组校验仍使101项实际结果整份丢失 | 仅删除actions数量上限，保留每项结构、身份、phase和receipt校验；不截断事实 | 真实apply→历史clone→provider投影→末项Undo回归RED→GREEN；非作者窄审无finding | 源码已解决，继承T07整体验证 |
| F-13 | P2实机缺陷 | 明确修改实际执行成功，但当前对话历史仍保存stage pending，且同请求状态查询只检索既有history而返回not_visible | 沿现有域owner刷新最终持久化事实；同run查询纳入当前已验证state且维持conversation/lifetime/唯一origin限制；执行前绑定原running行的有限action历史sink，异步后仍按真实owner结果收口 | 原失败`app-modify-applied.json`保留；`t03-f13-result.md`及focused572/fixture6/type证据通过。`app-mobile-modify-applied.json`历史completed/revision1、同请求status可见；`app-mobile-modify-undone.json`历史undone/revision3且原文逐字恢复 | 已解决，源码与移动实机postfix均通过；不把首轮pending历史改判 |
| F-14 | P2模型行为缺陷 | 桌面同名a/b笔记被模型合并描述却绑定a并真实提交；随后taskId被误抄，unavailable被误说成生成失败并邀请重提 | 只加强Agent工具指导：真实同名歧义先澄清、不随意选首项或合并；准确复制taskId，区分generic domainIdentity与submission operationId；unavailable不推导失败。无Host语义分类器 | `app-ambiguous-completed.json`保留原失败及一次真实完成POST；`t07-image-guidance-focused.log`19 PASS、lint通过及非作者窄审；`app-mobile-ambiguity-r2.json`在两明确候选间先询问，`imageRequests=[]`。r1批次含不存在currentNote而被拒绝，不算选源通过 | 选源postfix实机通过，ID/状态指导与现有工具回归已核对；不声称穷尽模型误抄概率 |
| F-15 | P2模型行为缺陷 | unknown原任务回执和只读查询正确，但模型将submission_unknown/no_provider_task解释成未成功提交或未到服务端，并建议重提；没有实际重发 | 仅补image-status-tool语义指导：未知不等于失败，缺provider任务ID不证明未发送，needs_user不授予重新提交。进一步明确原任务confirmed failure前不主动offer/ask重新提交；不扩F-24或增加Host意图门 | 初次注入与首轮指导局部改善均保留。最终`unknown-status-replay-request.json`仅替换原回答请求的一条planner指导，`unknown-status-replay-result.json`真实模型说明受理/费用未知，无重提或tool call；非作者逐字段核对接受 | 已解决；结论限真实模型只读回答重放，非重新执行App查询/F-24矩阵或普遍成功率证明 |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-05 | B-161/REQ-01—12 / B-161/AC-01—12 | 产品逐项选择、源码路径及两位只读设计贡献者核对 | 设计输入已整理 | 无runtime修改、模型调用或app验证；不作为功能PASS |
| 2026-10-05 | B-161/REQ-01—12 / B-161/AC-01—12 | 非作者只读设计审阅：product_contracts核产品覆盖；recall_language_check核执行/来源接口 | 无剩余阻断设计finding | F-04/F-05已修并定向复审；审阅者为GPT协作agent，不是GLM实现或runtime验收 |
| 2026-10-05 | B-161/REQ-12 / B-161/AC-12 | `npm run docs:check`；`git diff --check` | PASS，自然退出0 | 288 Markdown / 3423本地链接；4条既有episodic-memory advisory，无新增finding；仅文档变动，不运行插件build/smoke或无关test:docs |
| 2026-10-05 | T-01；B-161/REQ-12 / B-161/AC-12 | 35份旧文档正文/适用性接续；`npm run docs:check`、`git diff --check` | PASS，自然退出0 | GPT product_contracts原工具输出：288 Markdown / 3503本地链接，仍仅4条既有episodic-memory advisory。随后Data Boundary三处无新链接措辞收口及Tracker更新；最终T-07补文档门。历史证据未改判，运行未验收 |
| 2026-10-05 | T-05；B-161/REQ-07 / B-161/AC-07 | 指定3个focused suites；目标diff检查；DOM扫描 | PASS，137 tests，自然退出0；DOM无匹配exit1 | 原始证据`t05-events.jsonl`/`t05-focused-final-r2.log`；初轮3个失败已修，取消不再包装为测量错误，pending yield增加abort race。GPT独立审查与应用证据未完成 |
| 2026-10-05 | T-03；B-161/REQ-02 / B-161/AC-02 | 真实PaAgentRuntime stage→execute→final回归 | 有效RED，suite自然exit1、30通过1失败 | `t03-red-jest.log`/`t03-red-test.diff`；当前仅2模型轮而非执行后第3轮，stage专用终止缺口。r2负责新增断言可选intentId类型收窄 |
| 2026-10-05 | T-04；B-161/REQ-03 / B-161/AC-03 | 真实PaAgentRuntime直接create_image带sourceNotePath、初始仅user-text | 有效RED，suite自然exit1、13通过1失败 | `t04-red-jest-final.log`及`r3`诊断：schema_invalid/input_validation_failed/not_started，未读笔记或submit；并行tsc不是本任务验收门 |
| 2026-10-05 | T-02；B-161/REQ-08—10 / B-161/AC-08—10 | 11个受影响suites；quality-cache；provider limiter | PASS，自然suite exit0，633+83+31 tests | `t02-all-affected-final.log`、`t02-agent-quality-cache-final.log`、`t02-rate-limit-final.log`；GLM r1自然exit0。独立F-07仍待修，全域tsc被并行Operations修改影响未PASS，app未执行 |
| 2026-10-05 | T-02/F-07；B-161/REQ-08—10 / B-161/AC-08—10 | explicit完成诊断解耦回归；既有时间helper/locale；独立复核 | RED→GREEN，18/31/12 tests，自然exit0 | `t02-r2-deep-red.log`、`t02-r2-deep-green-final.log`、`t02-r2-rate-limit.log`、`t02-r2-plugin-locale.log`；原存储格式与自动历史不变。r1有效未变证据复用；不是全域build/app PASS |
| 2026-10-05 | T-01/07；B-161/REQ-12 / B-161/AC-12 | 源码退役后`npm run docs:check` | exit1；唯一新增坏链接已窄修，最终门待执行 | `docs-after-source-retirement.log`：Ghost设计第28行引用已删除Operations acknowledgement模块；改为当前controller及DEC-051边界。另4项既有episodic advisory；原T-01范围未发现新入口措辞错误 |
| 2026-10-05 | T-06；B-161/REQ-06/11 / B-161/AC-06/11 | 同参数真实重读与效果数量RED→GREEN；来源调用链回归 | GLM suites真实exit0，86/4/87/8 tests；CLI最终因quota exit1 | `t06-focused-red.log`、`t06-focused-green-2.log`、`t06-task-source-executor.log`、`t06-task-source-run.log`、`t06-task-source-executor-unit.log`。diff0、DOM无匹配exit1；没有把wrapper最终exit0当失败suite通过 |
| 2026-10-05 | T-06；B-161/REQ-11 / B-161/AC-11 | GPT非源码作者审查与现有runtime断言补齐 | 3 PASS，suite自然exit0；源码切片接受 | `t06-gpt-status-runtime-final.log`：33项完整事实进入provider，包含末项更新和complete lineage；非法末项仍拒绝。首次补断言误假定tool角色，按实际provider观察包校正，仅是测试取值问题。GLM有效未变证据复用，非全域/app PASS |
| 2026-10-05 | T-04；B-161/REQ-03/06 / B-161/AC-03/06 | GPT实现、非作者只读审查、5个focused suites及路径重放补充 | 404+16 PASS，scoped lint exit0；源码切片接受 | `t04-gpt-focused.log`、`t04-gpt-replay-final.log`、`t04-gpt-lint.log`；真实runtime初始user-only lineage、来源域cachedRead前后撤权/取消、同快照提交与选区冲突。无真实provider/app声明 |
| 2026-10-05 | T-05；B-161/REQ-07 / B-161/AC-07 | GPT修复、非作者只读审查、8个focused suites | 228 PASS，diff exit0，DOM无匹配exit1；源码切片接受 | `t05-gpt-focused-final-r3.log`、`t05-gpt-final.patch`、`t05-gpt-result.md`；静态DOM多窗口、长fence/strong/尾空白与取消。测试DOM并非浏览器，实际导出由T07完成 |
| 2026-10-05 | T-03/F12；B-161/REQ-11 / B-161/AC-11 | GPT补101项真实结果链及非法末项校验，非作者只读审查 | RED→GREEN，2 suites/12 PASS | `t03-action-facts-count-red.log`（applied为undefined）与`t03-action-facts-count-green.log`；一行解除数组数量拒绝，保留原结构/身份与Undo匹配，不重复其他已过证据 |
| 2026-10-05 | T-01/07；B-161/REQ-12 / B-161/AC-12 | 当前SDD/原文接续的docs门 | PASS，自然exit0 | `docs-current.log`：288 Markdown / 3504 links，仅4项既有episodic advisory；后续Tracker状态无新链接，不改变源码验收 |
| 2026-10-05 | T-03/F10；B-161/REQ-02/06/11 / B-161/AC-02/06/11 | GPT接管领域修复及主控非作者核对 | 源码切片接受，复用原始有效focused | `t03-gpt-takeover-result.md`对应原日志：focused105 PASS；domain日志104 PASS/1尾换行fixture失败，修正后image34 PASS；ChatService102 PASS；误内部spy签名断言已修。无将中间失败整包标PASS；64MiB恢复、真实epoch、取消/native结果及有限history均有对应证据 |
| 2026-10-05 | T-03/F11；B-161/REQ-02/06 / B-161/AC-02/06 | dispatcher、真实runtime与TaskSourceRun最终focused；独立核对 | 3 suites/256 PASS，两源码lint和diff exit0 | `t03-dispatcher-result.md`、`t03-dispatcher-final-focused.log`、`t03-dispatcher-final-lint.log`；保留native RED及legacy独立RED。notes/combined在legacy修复前已PASS；legacy修复与原admission一致，Host失效仍拒绝 |
| 2026-10-05 | T-07；DOM及Obsidian源规则 | 全src运行style/innerHTML/outerHTML扫描 | PASS，rg exit1且无输出 | `dom-scan-final.log`；随后仅dispatcher/source-run与action事实变化，不涉及DOM，证据复用 |
| 2026-10-05 | T-07；B-161/REQ-01—12 / B-161/AC-01—12 | 集中工程门及失败套件定向复查 | 组合证据通过；不是一次全量全绿 | `make-deploy-r3.log`全域lint/build通过，Jest374/376 suites、8927/8962 tests通过；Ghost本地监听EPERM与旧提示断言两失败保留。`t07-failed-suites-recheck.log`2 suites/68 PASS，复用其余未变结果；前序类型/fixture修复344、235 PASS及prompt对齐74 PASS见原日志 |
| 2026-10-05 | T-07；B-161/REQ-01/02/04 / B-161/AC-01/02/04 | 桌面真实模型与原生Chat交互 | 修改/Undo及只读场景通过；F13首轮持久化缺陷保留 | `app-modify-applied.json`一次实际修改与Changes applied，`app-modify-undone.json`Undo恢复原文；`app-preview.json`、`app-quoted.json`无新效果；`app-ordinary.json`普通Chat纯正文，`app-writing.json`历史有writing ready及真实versionId，stream finalText为空不误判失败 |
| 2026-10-05 | T-07；B-161/REQ-03 / B-161/AC-03 | 无控件唯一笔记的真实prepare→provider→本地交付 | 唯一来源实际生成通过 | `app-image-completed.json`及`app-desktop-final.json`保留原始用户请求、来源快照、专用提炼、一次图片提交与completed本地PNG；不是禁用提炼的录制adapter；同名失败单列F14，不混成全部选源通过 |
| 2026-10-05 | T-07；B-161/REQ-01/08/10 / B-161/AC-01/08/10 | 实际原生命令显式发现、Maintenance、Graph | 三入口通过，自动池访问0 | `app-pagelet-final.json`：explicit verified洞察绑定anchor/inbox/materials三源，无篇数确认；4模型轮/4工具调用仍属一个显式run。Maintenance返回8 proposals、Graph返回4 items，均只读预览；`automaticPoolAccesses=0`，没有启用AI增强/旧Recall入口 |
| 2026-10-05 | T-07；B-161/REQ-07 / B-161/AC-07 | 桌面长卡片原生预览/取消/SnapDOM保存 | 54,702字符、77/77页完整保存；取消释放通过 | `app-share-cancelled.json`：prepare settle、controller aborted、renderer释放、activeRenders/ownedPrototypes为0、无PNG写出。`app-share-final.json`及`share-export-verification.json`：实际capture正文合并46,474非空白字符，SHA与预期一致；首/中/末PNG均1080×1440。Copy/媒体/真实失败路径复用T05的228项，不为移动重导出整批 |
| 2026-10-05 | T-03/F13；B-161/REQ-02/06 / B-161/AC-02/06 | 原运行行历史绑定、状态可见、关闭后真实效果与持久化竞态 | 确定性回归通过，源码修复已独立接受 | `t03-f13-result.md`保留多项有效RED及fixture诊断；`t03-f13-focused.log`5 suites/572 PASS，`t03-f13-fixture-focused.log`6 PASS，`t03-f13-fixture-types.log`类型检查通过；source lint/diff通过。`t07-f13-image-build.log`前轮类型失败保留，`t07-f13-image-build-r2.log`与deploy最终通过，不以失败日志冒充成功 |
| 2026-10-05 | T-07/F13；B-161/REQ-02 / B-161/AC-02 | 移动CLI simulator真实修改→同请求status→历史→Undo | postfix通过 | `app-mobile-modify-applied.json`：无二次确认、绿色原文、operation历史completed/revision1、get_operations_status返回可见结果；`app-mobile-modify-undone.json`：undone/revision3并逐字恢复蓝色原文。桌面旧pending失败保留，移动样本不外推普遍模型正确 |
| 2026-10-05 | T-07/F14；B-161/REQ-01/03 / B-161/AC-01/03 | 同名歧义及状态ID指导；移动真实两候选澄清 | r2通过；r1不算有效选源样本 | `app-ambiguous-completed.json`记录桌面误选/错误ID/错误失败表述；19 focused及两source lint通过后部署。`app-mobile-ambiguity-r1.json`因批次含不存在currentNote而整批拒绝，保留为诊断；r2明确给a/b路径后真实读到不同内容，先询问、不擅自合并，`imageRequests=[]` |
| 2026-10-05 | T-07；B-161/REQ-07 / B-161/AC-07 | 移动CLI simulator原生Share Card交互 | 预览、翻页、关闭释放通过 | `app-mobile-share-preview.json`为77页且已到第2页，sanitizationIssueCount=0、无plain-text fallback；`app-mobile-share-closed.json`确认abort及renderer/prototype释放。完整保存复用桌面同输入77PNG证据；未宣称真机iPhone或移动重复整批导出 |
| 2026-10-05 | T-07/F15；B-161/REQ-02/03 / B-161/AC-02/03 | Image领域unknown注入后真实模型追问 | 领域身份/无重发通过；文字解释失败 | `app-mobile-unknown-initial.json`、`app-mobile-unknown-followup.json`只有一次`injected:true/dispatched:false`请求记录，查询原任务为submission_unknown/no_provider_task；模型误称失败并建议重提，没有实际再次生成。是领域故障注入与真实模型行为，不是真实provider失败，也不以Operations failed替代unknown |
| 2026-10-05 | T-07/F15；B-161/REQ-02/03 / B-161/AC-02/03 | unknown指导窄修、当前生产build与部署 | 工程通过；postfix实际模型验证中 | `t07-unknown-guidance-focused.log`3 PASS，`t07-unknown-guidance-lint.log`通过；`t07-final-build.log`包含typecheck/build，`t07-final-deploy.log`确认当前资产复制，未运行测试。仅指导变化复用有效既有测试，最终UI自动审批后的模型结果待主控追加 |
| 2026-10-05 | T-07/F15；B-161/REQ-02/03 / B-161/AC-02/03 | 首轮unknown指导postfix真实模型追问 | 局部改善，仍未通过F15 | `app-unknown-final-followup.json`准确说明unknown不等于failure、needs_user不要求重提，沿同ID只读查询且无重发；结尾仍主动问是否考虑重新提交。保留失败，主控只收紧现有planner指导并拟重放同一原始只读状态prompt；不是新增业务生成或重复其他验收 |
| 2026-10-05 | T-07；隔离与资源生命周期 | 已完成桌面/首轮移动owned资源清理 | 两轮清理通过；最终实例及模式恢复未收口 | `app-desktop-cleanup.json`、`app-mobile-cleanup.json`确认Chat关闭、独立历史/manifest路径删除、Share factory恢复及无残留。最终F15实例与mobile/debug及原配置恢复由主控记录；不将阶段清理当全局恢复完成 |

| 2026-10-05 | T-07/F15；B-161/REQ-02/03 / B-161/AC-02/03 | 最终字段指导与原状态回答请求重放，非作者验收 | PASS；源码/build及模型定向证据完成 | `unknown-status-replay-request.json`与原末次请求仅一条planner指导不同，所有事实及参数不变；`unknown-status-replay-result.json`真实配置模型正常stop、无工具调用、无重新生成建议，正确保留受理/费用未知。`t07-final-build-r2.log`及`t07-final-deploy-r2.log`exit0；工具实现未变，复用3项及领域既有结果。不是重跑App/Provider未知故障或成功率统计 |
| 2026-10-05 | T-07；资源恢复 | 最终实例清理、原模式/设置/学习偏好比对 | PASS | `app-unknown-final-cleanup.json`关闭、专属DB/路径删除、无残留；`app-environment-restored.json`原mobile=false/debug=false、Memory与后台开关、学习两项enabled均一致，pluginReady=true。真实付费图片仅桌面两次；两次unknown注入均在POST前拦截，不是真实Provider故障 |
| 2026-10-05 | T-07；B-161/REQ-12 / B-161/AC-12 | 最终文档与差异检查 | PASS，自然exit0 | `docs-final.log`：288 Markdown/3504本地链接，仍仅4项既有episodic-memory advisory；`git diff --check`通过。最终补记不增加链接或改变源码，保留原证据复用 |

### Current Requirement Evidence Map

下表复用上述原始证据，不新增验收场景。T-07全部完成；历史失败和证据适用边界保持不变。

| Requirement / AC | 已覆盖证据 | 当前剩余 |
| --- | --- | --- |
| B-161/REQ-01 / B-161/AC-01 | 三来源显式Pagelet无篇数确认；同名图片r2先澄清；T02/03/04取消/权限/无Host语义regex回归 | 无新增专项；共用最终T07收口 |
| B-161/REQ-02 / B-161/AC-02 | 桌面修改/预览/引用/Undo，F13移动completed历史与同请求status，领域并发/部分/撤权/恢复回归；F15字段指导及真实模型回答重放 | 已完成；不是重开Operations矩阵 |
| B-161/REQ-03 / B-161/AC-03 | 唯一笔记无控件真实prepare/生成/交付；同名r2澄清；T04来源scope/选区冲突/换页/撤权/接受后不重放；F15真实原ID查询及回答重放 | 已完成 |
| B-161/REQ-04 / B-161/AC-04 | app-ordinary/app-writing实际历史及writing-context-run/runtime既有套件 | 无新增专项，不因stream空终文重复采样 |
| B-161/REQ-05 / B-161/AC-05 | full gate中的ghost-publishing-controller、b153-prepare-ghost-post-tool及相关服务边界；失败套件定向修复证据 | 无真实生产发布门，不重复现有版本/unknown矩阵 |
| B-161/REQ-06 / B-161/AC-06 | T03/04/06真实runtime/domain三scope、派生lineage、撤权与执行后有限事实保存 | 无新增专项 |
| B-161/REQ-07 / B-161/AC-07 | T05 228项；桌面54,702字符/77页全量hash及PNG；桌面取消、移动预览/翻页/关闭 | 无新增导出或媒体矩阵 |
| B-161/REQ-08 / B-161/AC-08 | 耗尽/存储故障下explicit及本地入口回归；实际三入口且自动池访问0 | 无需人为耗尽真实后台池 |
| B-161/REQ-09 / B-161/AC-09 | T02自动12/36、started-run、缓存/拒绝、lease回滚、reload/fail-closed及混合历史保留 | 无新增后台模型运行 |
| B-161/REQ-10 / B-161/AC-10 | 生产调用图及最小删除闭包独立审查；当前统一发现实机；兼容共享端口和历史数据保留 | 不为无消费者旧管线补新入口/镜像测试 |
| B-161/REQ-11 / B-161/AC-11 | T03/06超旧容量、101项持久事实/Undo、33项provider投影、同参真实重读、恢复和权限保护 | 无新增容量阶梯或benchmark |
| B-161/REQ-12 / B-161/AC-12 | 35份接续文档及独立语义核对；最终docs/diff门；本表覆盖12项并保留原失败 | 已完成；本地master提交已授权，closeout/push/release需另获授权 |

## Git Delivery

2026-10-05，Owner请求“将代码修改提交到master”。本轮授权按本地master提交执行，
包括B-161源码、测试及其配套合同；不扩大到推送、closeout、归档或发布。

| Commit | Scope | Evidence |
| --- | --- | --- |
| `17bbdfb0f53d2dd899dcd68670048204550de92b` | Pagelet显式发现与自动预算分离，退役无消费者的旧Review/Quiet Recall管线 | 26文件与已检查diff一致；签名核验通过 |
| `3ddd788949856866a21aff37b46be471a714a607` | 明确Operations直接执行、Chat结果/Undo持久化、真实笔记配图来源及容量/读取规则对齐 | 48文件与已检查diff一致；签名核验通过 |
| `f3d7e85aa716cd74383bbc02384252b182f2caae` | Share Card长内容完整分页、取消及资源释放 | 10文件与已检查diff一致；签名核验通过 |

三个源码提交均复用Validation Log中的有效测试、最终构建及应用证据；源码在最终构建后无变动。
首轮签名核验受沙箱GPG信任库访问限制，获准按原命令核验后通过，不是签名失败。
配套文档以独立签名提交交付；`DESIGN.md`、`design-samples/`未暂存或修改。

## Closeout Readiness

T-07已完成，全部开发/验证finding闭合，原设置和模式恢复。以下工程补记保留当时证据，
不以历史“仍在进行”覆盖最新Validation Log。尚未获closeout授权，不移动/删除过程文件。

T-07早期工程补记（2026-10-05；实际执行者GPT，日志均在本次临时目录）：

- `make-deploy-r3.log`：平台检查、全域lint及生产build通过；全量Jest为374/376 suites、
  8927/8962 tests通过。两套件失败分别为Ghost本地监听`EPERM`环境限制和提示词旧断言。
  `t07-failed-suites-recheck.log`在允许本地监听的环境定向复查2 suites/68 PASS，复用其余
  未受影响结果；不表述为一次全量全绿或首次`make deploy`成功。
- 前序构建暴露的类型与fixture接线错误已修；`t07-root-type-fixtures.log`为344 PASS，
  `t03-build-types-focused.log`为235 PASS，相关源码lint通过。未弱化合法结果或撤权断言。
- 发送前隔离捕获发现共享planner旧语句仍提到绕过行内确认，已对齐当前请求授权及
  stage/execute职责。`t07-prompt-alignment.log`为3 suites/74 PASS；
  `t07-prompt-lint.log`、`t07-prompt-build.log`、`t07-prompt-deploy.log`均exit0，当前构建已部署并重载test。
- 两轮dry capture都在实际transport前拦截，不是模型样本；第二轮14次请求仅有stream布尔差异，
  内容限repo规则与合成当前输入，无旧history/Memory或笔记正文读取。
  第一轮清理遇空目录删除接口错误，已修临时辅助工具并按原manifest清理，
  `app-dry-cleanup-final.txt`确认closed/removedOwned且无遗留路径。未算作Undo验收。
- 真模型明确修改后界面直接显示Changes applied及差异，无二次确认；点击实际Undo后显示Undone，
  合成笔记恢复逐字原文，证据`app-modify-applied.json`、`app-modify-undone.json`。
  `app-preview.json`与`app-quoted.json`记录仅预览、引用删除指令均无新效果。余下应用用例仍在进行。

- [x] 实际行为与已确认目标合同一致，全部REQ/AC有证据。
- [x] 独立review、必需模型/应用及工程检查完成，无未处理确认缺陷。
- [x] T-01文档接续清单完成，无新旧约束竞争。
- [x] 原历史证据及用户决定不改写；无未完成的本包开发测试项。
- [ ] 仅在另获closeout授权后吸收/处置过程文件；本轮仅本地Git提交，push/release另行授权。

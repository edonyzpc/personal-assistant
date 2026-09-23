# Agent Debug View Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-09-23
Work item: B-145
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [Agent Debug View](../../../product/specs/pa-agent-debug-view-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: P0/P1/P2 已实现并按本轮授权验证；桌面与 CLI mobile simulator 393px 交互、最终全量自动门及测试清理均已完成。
- Next action: 等待 Owner 决定是否进入独立 closeout / Git 交付；本 track 不自动 commit、push 或发版。
- Blocker / decision needed: 无当前设备阻塞；真机不再是本 track 的固定门。GPT 实现及必要 provider 测试已授权；无 Git/release/closeout 授权。
- Last verified behavior: 基于 `83eecba3` 的未提交实现；最终 `npm run test:all -- --runInBand --detectOpenHandles` 为 322 suites / 8174 tests，自然 exit 0；lint/build/docs/DOM scan/空白门通过。桌面真实 Chat/Prompt/工具/取消/来源撤销/删除及模拟移动入口、轨迹、详情已核；实际模型 qwen / deepseek-v4-pro 只用于前轮必要请求。最终 test vault 加载 SHA `de918e2bc4ffbc6afbae0994c4710eb63d7aa15b365b090ef95f43ca2f83989b`。
- Delivery tree / target: 当前 repo 工作树；app 为 repo `test/` vault。GPT 主代理负责治理/host集成与验收，三个 GPT 子任务分别独占基础数据服务、provider/runtime、UI。实际模型、构建与 iOS 部署目标在对应执行切片记录。

### 当前授权修订（2026-09-22）

Owner 要求按方案完成开发验证，明确用 GPT 完成，允许测试必需的 provider 请求；
性能数值是软约束，不应过度设计或过度测试。原 Plan/SDD 的 GLM 派发要求、仅文档
stop point 与数值性能硬门在本 track 被本次授权替代。仍须满足功能正确、数据边界、
删除联动、资源有界、无额外业务调用/副作用和正常 Agent 主要功能不受影响；不做
统计认证或为单项微基准反复优化。运行证明、必要回归与真实 UI 验证不可用设计替代。

### 移动端验证修订（2026-09-23）

Owner 明确真机测试代价很大，移动端优先使用 Obsidian CLI mobile simulator；
仅在涉及 iOS 系统专有特性或出现具体平台风险时才运行真机。上一轮的无 USB
设备记录是当时真机前提的事实，不再是当前交付阻塞。模拟器结论只针对模拟视口
和 Obsidian 中的可见交互，不宣称 iPhone 实机触摸、WKWebView 存储或进程回收。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-00 | B-145/REQ-10 / B-145/AC-10 | 固定输入基线、性能预算与执行前核实 | [x] | CLI/test vault/model 已核；数值为软参考；三态轻量实测不作延迟因果结论 |
| T-01 | B-145/REQ-05 / B-145/AC-05；B-145/REQ-06 / B-145/AC-06 | DTO、分区、限额、IDB 事务/TTL/分页/故障 | [x] | whitelist、限额/淘汰、分区/恢复回归及真实 IDB 重载通过 |
| T-02 | B-145/REQ-07 / B-145/AC-07 | 删除 outbox、Forget、来源撤销和恢复门 | [x] | claim/legacy/设置故障回归；真实测试笔记撤销清正文、测试 Chat 删除清 Run/outbox |
| T-03 | B-145/REQ-02 / B-145/AC-02；B-145/REQ-04 / B-145/AC-04；B-145/REQ-09 / B-145/AC-09 | 生命周期、身份、动态采集、状态隔离 | [x] | runtime 回归与关闭/后台/实时三态真实 Chat；真实取消及卸载负例已覆盖 |
| T-04 | B-145/REQ-03 / B-145/AC-03；B-145/REQ-08 / B-145/AC-08；B-145/REQ-09 / B-145/AC-09 | Provider/辅助调用/工具的实际输入、usage、错误、媒体 | [x] | 真实 final Prompt、usage、declare_source_scope/read_note 及答案；附件只读引用/边界回归 |
| T-05 | B-145/REQ-01 / B-145/AC-01；B-145/REQ-04 / B-145/AC-04 | View、入口、历史、布局/i18n/可访问性 | [x] | 桌面与 CLI mobile simulator 393px：按钮相邻/隐藏、复用页签、抽屉收起、轨迹/详情可点、无横向溢出 |
| T-06 | B-145/REQ-01 / B-145/AC-01；B-145/REQ-05 / B-145/AC-05；B-145/REQ-06 / B-145/AC-06；B-145/REQ-07 / B-145/AC-07；B-145/REQ-09 / B-145/AC-09；B-145/REQ-10 / B-145/AC-10 | 故障/性能/真实环境、独立 review、最终 gate | [x] | 独立 review、桌面与模拟移动验收、异常 owner/抽屉修正、最终322 suites/8174 tests 自然exit0及部署身份通过；真机无具体触发风险 |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Validation Map

本表定义最小证据与重跑条件；已运行结果只在 Validation Log 标 PASS。共用输入
和结果可复用，不按表行重复跑完整 gate。

| REQ/AC or risk | Change | Minimum evidence / command | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- | --- |
| REQ-05/06；隐私/容量 | T-01 DTO/store | `npm test -- --runInBand agent-debug-projection agent-debug-store agent-debug-service` | 凭据/reasoning/media 不持久；分区/引用/TTL/quota/限额/迁移原子性满足 SDD | schema、过滤器、身份或预算改变；增加真实 IDB 负例 |
| REQ-07；副本复活 | T-02 outbox/governance | `npm test -- --runInBand chat-history-store chat-history-manager memory-governance-coordinator memory-governance-persistence memory-governance-store memory-plugin-governance-storage plugin-settings-persistence plugin-source-access agent-debug-plugin-integration` | 所有删除入口、legacy、unknown 域及每个跨库崩溃点都不能读回/写回；撤销后放宽/异常退出不复活；claim 跨分区清完才确认 | 删除/权限/claim 状态机或 link schema 改变；实际 app 删除/两种 Forget/reload 门 |
| REQ-02/04/09；业务回归 | T-03 Host/runtime | `npm test -- --runInBand chat-service pa-agent-loop agent-run-coordinator agent-runtime-primitives pa-agent-debug chat-plugin-integration plugin-settings-persistence` | pre-Run/排队/开关/卸载真实状态；capture throw 与 off/on 不改变输出/调度/取消 | 共享生命周期、settings、loop 行为改变；P1 部署与真实取消/重载 |
| REQ-03/08/09；假归因 | T-04 provider/tools | `npm test -- --runInBand pa-agent-runtime-prompt pa-agent-runtime-search-vss pa-agent-runtime-chat-history obsidian-fetch b129-image-request` + Proposed usage tests | final admitted Prompt；重试/并行 ID 唯一；usage 不重算不伪造；无额外消费/调用 | provider adapter/model options/aux 调用变化；native/buffered 实际证据 |
| REQ-01/04；交互和泄漏 | T-05 view/i18n | `npm test -- --runInBand chat-view agent-debug-view`；DOM 源码扫描；实际按钮/command/mobile simulator smoke | 发送旁入口、上下布局、稳定选择、history/off、多 leaf、键盘与模拟触控及 unmount | DOM/CSS/路由/订阅改变；Desktop + mobile simulator 对应交互重验，iOS 专有风险真机 |
| REQ-10；性能 | T-00/T-06 performance | 复用服务/observer有界与隔离回归；实际三态轻量观察 | 资源有界、无额外调用/业务阻塞；延迟数值仅软参考，不新增专用统计研究 | 出现Agent/取消/界面可感知回归时再定向诊断 |
| 全部；最终输入一致 | T-06 integration | full Jest自然退出 + lint/build/artifact + eligible `make deploy-current`；`git diff --check`；DOM 源码扫描；docs gate；桌面与 CLI mobile simulator smoke | 当前 build/target、全部必需 AC 和 review 闭环；无未处理 P0/P1/P2 | gate 中源输入改变则相关证据失效；具体 iOS 专有风险另触发真机 |

表中缩写 REQ/AC 均属于 B-145；完整合同 ID 映射在 Work 与 SDD Test Matrix。

## Findings

以下为设计阶段发现的问题与当时的修正记录。两位独立只读 reviewer 分别检查
数据治理与运行观测，主代理用实际源码复核并写入 SDD。表中的“待测”是原始
验证目标；当前运行与真实删除结果以 Work 和 Validation Log 为准。

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | Chat 删除与 Debug 不同库；仅回调及吞异常的 `deleteConversation` 会在崩溃后遗留副本 | 同 Chat 删除事务 outbox；Debug tombstone+purge+applied 后 ack；覆盖单轮/截断/prune | `ConversationPersistence`、history store/manager 已核；T-02 故障点测试待执行 | 设计闭环，运行待验 |
| F-02 | P1 | `activeLinks` 逐 projection cleanup 无法覆盖所有 Debug 副本及 device claim | claim-level pending 阶段；单设备 Debug DB 内跨分区删除，普通 UI 分区隔离；兼容旧 pending | governance coordinator/persistence/scope 已核；T-02 device claim/重启待测 | 设计闭环，运行待验 |
| F-03 | P1 | settings listener 不能保证撤销后放宽仍保留删除意图；文件通知到提交之间有崩溃窗口 | sourceRevocationEpoch 随权限同次提交；Debug 代际清理；owner-session 恢复标记覆盖已观察文件事件的未提交窗口 | settings/source-access 已核；T-02 撤销→放宽、失败、异常恢复及多窗口待测 | 设计闭环，运行待验 |
| F-04 | P2 | runtime runId 晚于启动排队/早期拒绝；会话预留不代表已有持久 Chat row | Chat 接收分配 captureId 后绑定；允许无 Turn、临时 scope；不以 row 缺失判删除 | chat-service/runtime/Persistence 已核；T-03 早期终态待测 | 设计闭环，运行待验 |
| F-05 | P2 | 既有诊断与 HTTP trace ID 不统一；模板变量不是最终 Prompt | 显式 logical/attempt scope；准入后 SDK serialized body 有界投影；未知 stream 不读取 | ai-utils/obsidian-fetch/prompts 已核；T-04 并行/重试/过滤待测 | 设计闭环，运行待验 |
| F-06 | P2 | 辅助调用转纯文本丢 usage；尾部未消费/partial usage 与计时可能产生假精度 | response 转换前观察；归因去重；known lower bound；分开各时钟，保持现有 tail/cancel | runtime/loop/memory-search-tool 已核；T-04 usage/timing 矩阵待测 | 设计闭环，运行待验 |
| F-07 | P2 | model 创建时的 debug gate 会漏掉后来开启；累计 message_end 会回填旧内容 | 始终安装 cheap dynamic hook；capture epoch/segment 过滤，旧请求输入标未采集 | runtime/ai-utils hook 已核；T-03 off→on/late event 待测 | 设计闭环，运行待验 |
| F-08 | P2 | 复用通用历史 DTO/日志过滤会落盘 thinking/tool 原文；身份 fallback 与媒体复制风险 | 专用 whitelist DTO；可靠 scope 缺失仅会话；现成媒体引用，不生成 owner/Blob | Chat persisted DTO/opaque key/ImageRef 已核；T-01/T-04 待测 | 设计闭环，运行待验 |
| F-09 | P1 | legacy_threshold Forget 不经过 coordinator pendingOperations | legacy store 的持久 forgotten_tombstone 同为恢复 authority；Debug 幂等清理且不虚报完成 | `forgetConfirmedMemory`/`MemoryGovernanceStore.forget` 已核；T-02 legacy 待测 | 设计闭环，运行待验 |
| F-10 | P1 | unknown lineage 可能没有 claim link，“保守删除”缺可执行选择器 | possibleDomains + domain/unknown 索引；清精准 link 和潜在域未知块；派生 generation 不后贴 | GenerationInputSnapshot 来源不完整路径；T-01/T-02 selector 待测 | 设计闭环，运行待验 |
| F-11 | P2 | `text_delta` 到 Chat render commit 存在 drain/异步/cooldown，不能据此声称已显示 | 首段有效非空正文 DOM commit 独立无内容事件；实际绘制另验，无正文 N/A | `runLiveMarkdownRender`/`renderMarkdownInto` 已核；T-05/T-06 待测 | 设计闭环，运行待验 |
| F-12 | P2 | 用异常退出直接清除所有笔记历史会损害崩溃诊断；unknown 迟到内容也需域屏障 | 异常 owner 先隔离/验证，证实撤销才 purge，未定标 recovery_unverified；domain generation 同事务推进 | store fixture 验证旧 owner 笔记正文隐藏、清洁历史及新 Run 正文仍可读；真实热重载历史可读；iOS 进程回收不在模拟器证据内 | 设计/模拟运行闭环 |
| F-13 | P1 | 移动模拟器热重载后全库 `quarantined` 持续为真，新 Run 正文也不可读 | 只对无法验证的旧 owner 建 30 天 `uncertain-owner` 屏障；隐藏其笔记/unknown 内容及相关事件元数据，不全库隔离 | store fixture 新旧 owner/敏感域/新写入通过；模拟器新建 Run 正文/usage 可读并热重载保留 | 已修复并复验 |
| F-14 | P2 | 393px 模拟移动 Chat 抽屉覆盖已打开的 Debug tab，按钮点击后不可见 | `revealLeaf` 后仅在移动端收起右侧抽屉，保留 Chat leaf 和既有 Debug leaf | CUA 点击真实按钮，右抽屉收起、active Debug、Debug/Chat 各 1 leaf | 已修复并复验 |

## Validation Log

本任务临时验证目录：`/tmp/pa-b145-validation.p57JOF`（本机日志/截图，非发布文件）。
实际 UI target：Debug 按钮紧邻发送且生成中可点；Chat leaf 保留；上方轨迹按 Turn
分组，下方连续详情；历史可重载、停止采集不等于取消、测试会话删除不复活。
未改变的 Pagelet/Preview/Stats 工作流不做额外 provider smoke。

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-22 | 全部设计 | HEAD/source 接入面、数据治理与运行观测两路只读独立复核，主代理收敛修正 | 设计复核完成；未发现仍需处理的设计 P0/P1/P2 | 基线 `83eecba3`；源码未改；F-01..12 方案已闭环，故障与性能待实测 |
| 2026-09-22 | 文档一致性 | `npm run docs:check` | PASS，exit 0；229 Markdown / 2035 local links | 仅 4 项既有 advisory：两份 episodic-memory architecture 文档各有未索引/不可达告警；无新增 lifecycle/link 错误 |
| 2026-09-22 | 文档合同 | `npm run test:docs -- --runInBand` | PASS，exit 0；2 suites / 58 tests | checker 与 lifecycle skills 合同；6.942 s 自然退出；无运行代码/构建/部署证明 |
| 2026-09-22 | 修改边界/格式 | `git diff --check`；对 6 份新 Markdown 逐份 `git diff --no-index --check /dev/null <file>` | 无 whitespace findings | tracked 命令 exit 0；no-index exit 1 表示新增文件差异、输出为空；全部变更仅 docs，HEAD 仍为核查基线 |
| 2026-09-22 | REQ-07 治理接入 | `npm test -- --runInBand __tests__/agent-debug-plugin-integration.test.ts __tests__/plugin-settings-persistence.test.ts __tests__/memory-governance-coordinator.test.ts __tests__/chat-history-store.test.ts` | PASS，4 suites / 78 tests，exit 0 | 同事务outbox/失败重试、Forget Debug阶段、撤销token、旧恢复不能绕过新pending写、主Chat删除失败解除临时gate |
| 2026-09-22 | REQ-07 新增持久提交回归 | settings-persistence + agent-debug-plugin-integration focused；`npx tsc -noEmit -skipLibCheck`；根接入文件eslint | PASS，2 suites / 10 tests；各命令自然exit 0 | 同设置写提交前不打开Debug内容；此时子任务仍在修正，不冒充最终全树验证 |
| 2026-09-22 | REQ-02/03/04/08/09 runtime | 子任务8 suites/359 tests；附件dispatch增量3 suites/90 tests；owned eslint/whitespace | PASS，均exit 0 | 附件只用已prepared引用/现成hash与尺寸，不读取bytes；variant hash不可得明确unknown；实际Prompt复用已解析对象，不重复parse |
| 2026-09-22 | 首轮全门 | `make deploy`；日志 `make-deploy.log` | FAIL：6 suites failed / 316 passed；未部署 | 设置兼容fixture、旧diagnostic gate、Memory无recorder时eager读取及旧fetch/hook/view数量断言；测试汇总后存在Debug测试owner未释放，显式停止superseded进程exit130，未使用forceExit |
| 2026-09-22 | 全门失败定向修复 | transport / memory-search-phase1 / writing-context-runtime / obsidian-fetch | PASS，4 suites / 106 tests，6.589s自然exit0 | 独立content-free诊断恢复；无scope不读额外依赖；动态hook/路由改为行为验证，不弱化业务结果 |
| 2026-09-22 | fixture与生命周期适配 | plugin-record-note + settings + integration；随后只跑新view数量失败用例 | 前者420 PASS / 1旧计数FAIL；计数修正后目标1 PASS /407 SKIP，自然exit0 | Memory fixture显式提供Debug边界mock，消除无关IDB重试资源；保留原command顺序；最终全门仍待跑。额外test文件eslint暴露2项既有非本次行告警，不修改无关代码 |
| 2026-09-22 | 全量回归 | 第二次 `make deploy`；`make-deploy-final.log` | lint/build通过；322 suites / 8171 tests 全绿，但汇总后进程未自然退出，显式中止exit130，未据此标 deploy PASS | 同输入 targeted `--detectOpenHandles` 35 suites /862 tests 自然exit0、无 handle 报告；不把前次未退出归因于已修复的泄漏 |
| 2026-09-22 | 全量自然退出门 | `npm run test:all -- --runInBand --detectOpenHandles`；`full-open-handles.log` | 322 suites / 8171 tests PASS，150.064s，自然exit0，无 handle 报告 | 当时860项源码/测试/配置输入摘要 `13d0a2e7bcc6f7ed98253a7269384d9d31bbc1e764c6775ec93694d4e400024c`；后续仅 CSS/视图与服务的定向修复由对应增量门补证 |
| 2026-09-22 | REQ-01 Debug off 入口 | `make deploy-current` 后 Obsidian test vault 实测 | 发现 `[hidden]` 被按钮 display 规则盖过；CSS 选择器修复后 display:none/width0 | 当前 build、2 suites / 298 focused tests 与2 artifact suites /61 tests自然通过；修复只涉及 CSS、对应测试 |
| 2026-09-22 | 三态/真实模型 | Obsidian test vault，qwen / deepseek-v4-pro | off 一轮正常回答且无 Debug Run；on+tab闭、on+tab开各一轮正常回答并生成完整 Run；模型/Prompt/usage/reasoning 观察正确 | 仅轻量功能观察，不把约4秒网络总时长估算为 Debug 开销；用新建测试 Chat 与笔记，无现有私有笔记请求 |
| 2026-09-23 | 详情稳定与空读开销 | 服务空 flush 不再通知；视图同选择刷新保留详情；`npm test -- --runInBand __tests__/agent-debug-view.test.tsx __tests__/agent-debug-service.test.ts` | 2 suites /22 tests PASS，自然exit0；实际详情 `Output / result` 可持续展开；Run sentinel 显示 Run stages | `npm run lint`、`npm run build`、`npm run test:artifacts -- --runInBand` (2 suites /61) 均exit0；`make deploy-current`复制当前构建；`dist/main.js`与 test vault一致，已加载SHA `ca0524352494d2e7a23c55ba3680653632ab0352c8cc49ddc787dd9f4732afa9`，load blocker null |
| 2026-09-23 | REQ-05 历史/会话隔离 | 插件 reload，重开真实 Debug tab，查看既有测试 Run | 两条历史 Run/正文/实际已派发 Prompt/token usage 可读；provider reasoning session详情为0；重开后 Output 展开成功 | CLI限定读取测试 Run字段和类别；未知 Prompt 中通用 `Authorization` 字样不据此认定凭据泄露，专项 whitelist 回归已通过 |
| 2026-09-23 | REQ-03/04/09 工具链 | 同一新建测试 Chat 真实请求只读 `B145-debug-smoke.md` | Agent 回答 `B145-INDIGO`；新 Run completed/complete，597事件、usage input32629/output904/total33533；观察到 `declare_source_scope` 与 `read_note`，无 Obsidian error buffer 记录 | tool/output UI 的长轨迹按最后200事件分页，实际工具事件在完整 Debug store 中可查；未把用户其他笔记加入本次请求 |
| 2026-09-23 | REQ-07 来源撤销与会话删除 | 删除本任务自建测试笔记；随后对本任务 Chat ID 调用同事务删除；从 Debug store 和 Chat outbox 复查 | 笔记标记所在 Prompt 块不可读，Run 无正文元数据仍在；删除测试 Chat 后 conversation=false、Debug runs=0、pending outbox=0；插件重载后仍无复活 | 仅删除自建测试 fixture/会话；来源 epoch 留作持久撤销保护。已恢复 debug=false、memoryEnabled=true，dev:debug off/mobile off |
| 2026-09-23 | REQ-02/03/09 真实取消 | Chat 发送1次不使用工具的长生成请求，生成中点击 Stop，再点发送旁 Debug 复用原 tab | Chat 显示 Generation cancelled；Run status=cancelled，usage unknown 而非 0；同一 Debug tab 切到新 Chat、显示取消轨迹 | 实测发现底层 attempt 与 `llm_stream:error` 误标 Failed；已传递明确取消状态，`pa-agent-debug-observation` + `chat-service` focused 2 suites/79 tests 自然exit0。修正后的分类尚无第二次 provider 取消实测，限于这两个节点的状态投影；未增加调用 |
| 2026-09-23 | 最终代码增量门与清理 | `npm run lint`、`npm run build`、`npm run test:artifacts -- --runInBand`、`make deploy-current`、plugin reload | 全部exit0；artifact 2 suites/61 tests；test vault 已加载最终 main.js SHA `cd70cb14196e3befbc7f1ba99bc43a1174d786da55824d314082018710171351`、blocker null | 取消测试 Chat/Run/outbox=0，debug=false、memoryEnabled=true；最终运行代码仅新增明确取消状态投影及对应回归，不重新跑未受影响的全量 suite |
| 2026-09-23 | 真机前提 | `system_profiler SPUSBDataType`、iPhone Mirroring/Inspector 前提 | BLOCKED：USB 设备列表为空；未执行 iCloud 部署或 iOS 触摸/Inspector 操作 | 已向 owner 异步询问连接设备；桌面证据不替代 iPhone gate |
| 2026-09-23 | 移动端门修订 | Owner 明确 CLI mobile simulator 优先，仅 iOS 专有问题真机 | 旧 USB 前提不再是阻塞；本轮没有发现需真机才能判断的具体 iOS 专有缺陷 | 模拟器不证明 iPhone 触摸、WKWebView 存储/进程回收；此限度已写入 Plan/SDD |
| 2026-09-23 | REQ-05 异常 owner 恢复 | CLI `dev:mobile on` 热重载、纯测试 Run；`agent-debug-store/service/view` focused | 发现旧全库隔离会阻止新 Run 正文；修为 owner 级屏障，3 suites/29 tests PASS；新 Run 正文/usage 及正常热重载历史可读 | 旧 q 状态仅在确认 Debug 无非任务历史后清除；新旧 owner 的边界由 store fixture 验证，模拟器不替代真实 iOS 进程回收 |
| 2026-09-23 | REQ-01/04 mobile simulator | Obsidian CLI `dev:mobile on`，CUA 真实按钮/轨迹/详情点击，窗口缩到393px，CLI DOM/leaf/错误缓冲 | Debug 打开/复用同一 tab，Chat leaf 保留；抽屉遮挡缺陷修复后自动收起；轨迹、token 7/5/12、Output 展开可见，root/document 无横向溢出，Debug 按钮关闭态隐藏，无 captured errors | 仅测试数据 `b145-mobile-sim-20260923`，未调用 provider；结束后清 Run、debug=false、`dev:mobile off` 并恢复窗口尺寸；移动结论限模拟视口 |
| 2026-09-23 | 最终冻结自动门 | `npm run lint`、`npm run build`、`npm run docs:check`、`npm run test:docs -- --runInBand`、`npm run test:all -- --runInBand --detectOpenHandles`、`git diff --check`、DOM 源码扫描 | 全部 PASS；全量322 suites/8174 tests 自然exit0；docs 229 Markdown/2034 links，2 suites/58 docs tests；DOM `rg` exit1无匹配即PASS | docs 仍有4项既有 episodic-memory advisory；本轮不改。此前局部 artifact 2 suites/61 tests PASS，最终全量门包含 artifact 配置 |
| 2026-09-23 | 最终部署/清理 | `make deploy-current`、plugin reload、`shasum -a 256`、CLI `eval`/`dev:errors` | dist/test main.js 同 SHA `de918e2bc4ffbc6afbae0994c4710eb63d7aa15b365b090ef95f43ca2f83989b`；插件加载，debug=false、memoryEnabled=true、mobile=false、Debug runs=0、按钮隐藏、空历史无误导恢复提示、无 captured errors | 只清本任务测试 Run；窗口已恢复桌面尺寸。`make deploy-current` 本身不运行测试，复用上行冻结输入的已通过门 |

未来验证记录至少包含 command/scope、自然退出、相关源码/测试/配置输入、设备或
build/deploy identity、结论与缺失项。不要新建独立 handoff 或重复的成本研究日志。

## Closeout Readiness

- [x] Owning contract 与已验证行为一致；模拟器与真机证据边界明确。
- [x] Required review/smoke/performance evidence 已记录；无具体 iOS 专有风险触发真机门。
- [x] 无本轮必需未完成项；iOS 真机存储/进程回收没有被模拟器证明，不冒充已验证。
- [x] 稳定结论已吸收到 current contract/tests。
- [ ] 过程文档已标记 delete-after-absorption 或 unique archive evidence。

当前状态为 Validated，未进入 closeout；Feature Home/Plan/SDD/Tracker 仍留在 active
包，须经独立 closeout 授权后按项目规则吸收/处置。未 commit、push 或发布。

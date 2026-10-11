# B-170 独立通用计算验证与边界

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-11
Work item: B-170

本页保留独有输入、验证与处置证据，不作为当前实现或执行状态权威。稳定范围与实现约束由
[DEC-061](../../product/decisions/dec-061-independent-agent-computation.md) 和
[Product Spec](../../product/specs/pa-independent-computation-product-spec.md) 持有。
[旧研究记录](./b170-pi-codemode-feasibility.md) 的原型、桥接、设备与模型证据按各自输入保留，不改写为本轮独立工具验收。

## 授权与收口边界

用户确认新增独立通用计算工具，脚本内不调用 PA 工具，由 Agent 自主选择和组合工具；随后授权基于 B-171 最新基线完成开发测试，并于本轮明确要求收口 B-170。必要验证仅限已核对 test vault；未授权提交、推送、发布或私人 vault 部署。

本轮必要工程、独立审查、Mac／移动模拟器接线、最小模型样本与iOS Worker兼容证据已齐，按用户要求收口。稳定SDD吸收进Product Spec，Feature Home／SDD／Tracker及Active入口吸收后删除，不归档完整过程包；旧研究连续移动并保留§1–20正文与锚点。本轮执行包尚未提交，不能声称旧Git保存了完整执行过程。

## 输入、构建与门禁

- 实施基线：B-171 已收尾的 `55ef6e4320366b7da9333c6eeb5c8d6cb2eb8eb9`。
- 固定 Pi `c5f5b3282d5e4203c085e59837ba17aeaf2829b5`、`quickjs-wasi@3.6.2`；独立执行树为 `/Users/eddie/.codex/worktrees/b170-independent-compute/personal-assistant`，验收主库为 `/Users/eddie/code/personal-assistant`。
- 最终 `integration-manifest.json` 的31个文件在主库与隔离树均逐文件匹配。相对完整门禁输入，最终增量仅为 `__tests__/chat-service.test.ts` 夹具；运行源码、依赖与构建配置未再变更。
- 候选插件2.10.8，生产 `main.js` SHA-256：`d34d1c832055e9c89f6e6338d834b7ac888e277ab5c064e374f591a9309d0d7b`；桌面、模拟器及两个模型样本记录的实际加载身份一致。
- 原始实施日志位于 `/private/tmp/pa-b170-independent-20261011/`，部署、模型与恢复收据位于 `/private/tmp/pa-b170-app-20261011/`。下文保留关键事实；这些本机临时路径不是长期资源或发布资产。

| 检查 | 结果与证据边界 |
| --- | --- |
| 来源、依赖与引擎审查 | 固定最小源码闭包、MIT 许可、Worker/WASM 内联及三文件安装无剩余阻断；7份上游执行源码保持原样。许可检查覆盖41 runtime packages / 19 bundled resources，依赖安装 dry-run 通过；22个稳定输入哈希未变，按输入复用，不重复旧 V0–V6 或桥接矩阵 |
| 外层事实与取消修复 | 计算7项、dispatcher最终10项、prompt40项、loop133项及相邻回归通过。保留原 B-171 两项 effect recovery 正确断言；修复剩余预算、早到期 `not_started`、owner 事实有限投影与条件性 unknown fallback，未引入子调用桥接 |
| 集中完整门禁 | platform guards、lint、生产构建通过；`test:all` 387套中385通过，9338项中9283通过、55失败，make自然 exit2。失败为 Ghost 本地监听被 sandbox EPERM 拦截及 Chat 夹具，原失败记录保留 |
| 仅补原失败 | Ghost 在允许回环监听的环境定向53/53通过，不连接真实站点；Chat 夹具107/107通过，保留 `finalization_reserve_overrun` 原断言。R4b 类型与diff检查exit0，运行源码未改。组成覆盖原失败的组合门禁证据，不记作一次全量全绿 |
| 静态与部署 | DOM扫描空输出/exit1，diff通过；`make deploy-current`核对构建身份后部署repo-local test，不额外运行测试。部署成功不是测试通过的替代证据 |
| 文档收口 | 最终 `docs:check`通过：296 Markdown / 3861本地链接；`git diff --check`通过。首次收口检查发现 disposition 枚举与终态元数据不符，修正记录格式后通过；未改运行代码或重复运行验证。原始输出为 `docs-check.log`、`docs-check-final.log`（iOS证据目录） |

最初取消夹具的持续 Promise 脚本在点击 Stop 前已耗尽100000次中断检查，2816ms为引擎失败；随后 Stop 中断的是模型重试等待，该尝试不计工具取消通过。只改用 JSON 循环补该缺口。Chat 夹具的虚拟队列问题通过明确绝对70ms检查、75ms释放 deferred acknowledgement 并推进0ms排空解决；未削弱正确断言或更改运行代码。

## Mac 与移动模拟器

本机 MacBook Pro；repo-local `test`；Obsidian1.14.4 / installer1.12.4，Electron39.7.0 / Chrome142.0.7444.265，UTC+08:00。模型设置保持 qwen / deepseek-v4-pro / thinking=true。

| 环境 | 已观察行为 | 限制与原始证据 |
| --- | --- | --- |
| Mac 真实 Chat | 可控native SSE夹具经真实Ask/Stop进入原执行链；Web-only计算42、UTC及偏移-480正确，纯计算无笔记来源；JSON循环Stop后为aborted/user_abort、preflightOnly=false、执行5144ms，迟到正文拒收。New Chat后由History重开仍显示Read-only tool stopped；再次计算42、tools=[]成功 | 夹具不调用模型。`desktop-fixtures.json`、`desktop-cancel-json-summary.txt`及主线程真实界面观察 |
| Obsidian mobile simulator | 相同候选，mobile=true；Ask计算42与日期正确，tools=[]、sourceRecords=[]；Stop后aborted/user_abort、preflightOnly=false、执行5110ms、observationChars=0。再次计算成功，History重开仍保留stopped终态 | 仍是Electron，不是iOS。原配置解析为obsidian/buffered/local-only，夹具仅在AIUtils client fetch边界返回固定响应，5次本地请求、零模型；未覆盖requestUrl网络。`mobile-final.json`、`mobile-assessment.json`、`mobile-history.png` |

桌面及模拟器原4份插件资产均恢复并验哈希；原 `main.js` 为 `29011532c03165ee247587c457d9897f7e0dab97d30e79f5b2777e5503fb658c`。设置与原备份逐字节一致，无需覆盖；mobile/debugger恢复false，原Web会话恢复，observer/hook移除。仅移除本任务3个桌面会话和1个模拟器会话，其他49个保留；本任务文件验内容后归档清理。恢复证据为 `desktop-asset-restoration.json`、`mobile-asset-restoration.json`、相应chat-restoration和fixture-cleanup记录；较早样本快照中的 `restored:false` 不代表后续未恢复。

## 最小模型功能样本

每题一个新会话，只运行一次；保持上述同一provider/model/thinking，native/global-fetch。临时observer只允许3条合成笔记，禁止写入并关闭活动笔记上下文；不重构system prompt。以下耗时为ChatService起止，不包括全部人工交互。

| 输入与事实正确性 | ChatService耗时 | 物理模型调用 | reasoning tokens | 首轮总输入tokens |
| --- | ---: | ---: | ---: | ---: |
| “现在本机是什么时间？顺便把 Unix 毫秒时间戳 1791604800000 转为 UTC 和本地时间，并计算它距现在多久。” Agent自主调用一次execute_code；取时1791707907992位于run起止间，给定值为2026-10-10T04:00:00Z／本地12:00，差103107992ms，答案约1天4小时38分钟正确 | 14.744s | 2 | 171 | 6670 |
| “看一下最近两周我都有哪些笔记记录” Agent自主计算日期，分别按mtime、ctime查询，再检查3篇结构元数据；最终3条路径、日期、标签正确，无缺失或虚构 | 26.607s | 4 | 436 | 10401 |

两次笔记查询各自一次完整返回3条，coverage=complete；第二次是另一日期字段，不是分页补查。结构读取bodyRead/bodyRequired均false。采用本地自然日区间 `[2026-09-27T00:00:00+08:00, 2026-10-12T00:00:00+08:00)`，属于原问题的合理解释；无边界日期样本，不覆盖所有“两周”解释，也不以3条样本证明任意规模查询。完整列表语义继续由原查询契约与既有测试持有。

usage attemptId与http_dispatch requestId逐项对应，reasoning明细完整；物理调用不能用工具调用数替代。原始收据 `desktop-models-final.json`，指标 `model-metrics.json`。两题是同一模型的不同任务，不是两个模型对照；首轮10401是provider测得总输入，没有独立计量system prompt，既不证明B-171未生效，也不证明prompt已足够精简。数据及prompt基线不同于历史anthelion，没有当前配对基线，不计算等价提速、不推断普遍成功率。

原始execute_code的sourceRecords与contextUsed.sources为空，query/inspect各自保留真实笔记来源。既有history/formatters按类别和标签归并sources、保留首项detail，所以UI与持久历史的“execute_code output”组可能显示3篇笔记；它不表示脚本读取了笔记，也不提供逐工具精确归属展示。本轮保留该粒度限制，不扩成UI聚合重构。

## iOS 最终 Worker 兼容与恢复

2026-10-11在已核对的Edony iPhone 15／iCloud Obsidian `test`（设备内`Documents/test`）完成一次提交。Safari设备面板报告iOS26.6.2，Obsidian1.14.4；页面UA报告`iPhone OS 18_7`，保留两项原始字段，不将它们当成同一版本值。

设备4份候选资产与部署字节核对一致，新实例加载时间`2026-10-11T10:06:41.936Z`，实际main.js SHA-256为上述`d34d1c…d0d7b`。manifest版本缓存仍显示2.9.2，因此本项以文件字节与新实例loaded hash建立候选身份，不靠缓存版本号判定。

通过PA ChatService原执行链，在AIUtils client fetch边界提供两次固定SDK回复；设备既有qwen／qwen3.8-max／thinking=true配置保持，实际provider与requestUrl网络均未调用。一次execute_code返回`{answer:42,utc:"2026-10-10T04:00:00.000Z",tools:[]}`，工具执行121ms、service总耗时255ms。恰好创建1个`module` Worker，结束时terminated=1、listeners=0、Blob URL revoked=true；原始来源为空、未读取笔记。该项PASS证明最终WKWebView加载、结构化计算与释放，不冒充真实模型、触摸Chat或后台验证。

恢复原实例main.js SHA-256 `23bcd4e371e0f8354b731ef5b78558242dc681bed0f7042bfe312429a5df37ac`；设备4资产、设置、hook均核对恢复，Mac侧iCloud资产与设置也再次逐字节一致。原始收据为`/private/tmp/pa-b170-ios-final-20261011/ios-final-attempt-01.json`，SHA-256 `58a58f7cecd11f710bc6f7bfcc882280c93b0bcdc9396d87e0471218bcec45e7`；`assessment.json`、`deployment-receipt.json`和`mac-restoration.json`记录判读与恢复。

恢复PASS后，控制台先记录一条`InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.`，位置`capacitor://localhost/app.js:1:1340095`，清理期间累计8条相同错误，原记录保留于`inspector-cleanup.txt`。根因未定位，不称它为已知旧缺陷或已证明无关；未观察到Worker失败，也未为此重复Worker验证。

主代理用官方`app:reload`正常重载已恢复的原环境。重载实例时间`2026-10-11T10:08:25.292Z`，loaded hash仍为上述`23bcd4…37ac`；身份仍为test／Documents/test，原Memory=true、Web=true、Operations=false、qwen／qwen3.8-max／thinking=true、inProgress=false。回读时未见新的控制台错误，但不据此宣称根因已修复。Mac侧4资产与设置再次逐字节一致；`inspector-reloaded.txt`、`iphone-restored.png`与更新后的`assessment.json`保留恢复观察。此提示不记作已证明的B-170缺陷，不新增专项测试或执行包；再次出现或影响真实操作时再触发针对性诊断。

本次7个临时文件均验哈希、归档后清理，见`fixture-cleanup.json`；iPhone Console回读确认fixtureRootAbsent=true、临时global已删除。不触碰私人vault或其他会话数据。

该项只补classic→Blob module Worker和入口重新打包带来的WebKit输入变化。旧iOS后台调度事实与现有“不运行timer、只推进墙钟”的期限回归按未变机制复用，不重跑后台、旧桥接或完整Chat矩阵。Mac、Safari原型及mobile simulator均不能替代此项；任何iOS通过也不外推Android或全部系统版本。

## 结论与处置

采用已确认的独立通用计算边界：固定Pi/QuickJS最小闭包、每次Worker、原PA执行链和自主工具组合；不增加脚本工具桥接、固定规划步骤或执行平台。Mac、模拟器、最小模型、工程及iOS最终Worker证据支持该范围；Android未验证，保留为证据边界，不制造额外必做矩阵。

Active过程包按[Disposition Log](../disposition-log.md)吸收后删除；当前产品文档和本页承接稳定约束与独有证据，旧研究历史原样保留。最终文档门禁通过，未重复既有运行验证。收口不表示Git提交、推送、CI、正式发布或私人vault安装。

# B-174 接口提示与返回合同一致性验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-25
Work item: B-174

本页保存 F-01 至 F-07 的独有错误样本、验收与处置边界，不作为当前实现权威。
当前合同见 [Resource SDK Architecture](../../architecture/obsidian-resource-sdk.md)、
[PA Agent Architecture](../../architecture/pa-agent-architecture-plan.md#b-140-note-memory-and-insight-capabilities)、
[SDK Spec](../../product/specs/pa-obsidian-resource-sdk-product-spec.md) 与
[完整查询 Spec](../../product/specs/pa-complete-note-query-product-spec.md)。
原 SDK 交付记录见[原验证](./b174-obsidian-resource-sdk-validation.md)。

## 授权与交付范围

Owner 分别批准诊断设计及 F-01 至 F-07 的实施和必要测试，要求保留 `load_tools`、
Agent 自主选工具/顺序/并发/恢复及实际返回，不新增搜索机制或 Host 答案纠正。
2026-10-25 在验证完成后明确授权收尾并提交本地 master；未授权推送或发布。
GPT 负责设计、验收和文档，配置的 pa-glm / ZAI / glm-5.3 负责限定实现与测试。

| Finding | 已交付与验证边界 |
| --- | --- |
| F-01 至 F-03 | prelude 只按实际绑定报告根入口、局部直接成员和空集合；不再推荐未注入的 searchTools。保留真实成员优先、原 TypeError 和两层方法兼容；普通 tools.* 与 SDK obsidian.* 的入口/结果及 Host 路径已澄清。反例和现有 guidance 测试覆盖 |
| F-04 | metadata.links 实际返回 value.entries；原模型猜 value.links 后丢掉已有结果。补方法返回指导并接通现有 registry→entry→请求投影；不改返回或加字段别名。新样本保留 entries 并识别 Cat → Dog；不据单样本证明唯一因果 |
| F-05 | inspect 的 tags 是正文缓存字段，不能据空值推断 frontmatter.tags 为空。既有字段枚举同源，说明行结构、字段选择和覆盖范围；新说明进入真实请求。模型用普通 read_note 取得属性，未调用 inspect，保留该真实路径未观察边界 |
| F-06 | incoming/outgoing 是 source→target 的观察视角，两个视角可能仍是同一条边，resolved 不证明互链。方法内澄清后本次正确表达 Cat → Dog；无必经反向查询或自动校正 |
| F-07 | 普通 search_vault_metadata 命中不说明匹配字段；轻量 matches 不带标签，exact 是计数、complete 是许可搜索覆盖，均不是共享标签证明。局部 native/schema/guidance 对齐，保留原 user top-N 条件；新样本依据实际查询与字段，不再捏造 test1 共享标签 |

权限、Agent 循环、loader、SDK 执行/返回、来源与效果链没有因本修复改变；方法指导
只进入对应获准工具，不扩成全局调用步骤。职责与事实已吸收到上述现行 Architecture。

## 自动化与独立验收

- F-01 至 F-03 的最终完整命令、F-05/F-06 的完整命令各有 409 suites / 9880 tests
  自然 exit 0 的历史证据；F-04 的全量环境失败与 Ghost 定向复验分开保留。
- F-07 focused：2 suites / 67 tests 自然 exit 0；GLM 两轮实现及 user top-N 修订自然
  完成，GPT 独立核对 diff 和原始输出，无剩余本范围阻塞。
- F-07 平台 569 TS、lint、生产 build（含类型）通过。完整 Jest 首次 407 suites
  通过、2 失败，9834 passed / 46 failed，make 自然 exit 2。Ghost 因本机 listen EPERM，
  允许监听后原套件 53 tests 自然 exit 0。b129 固定合法摘要 161 字符超出夹具上限
  159，只将该场景 Public source A 的填充 50→51，上限变为 161；4000/512 窗口、
  重试/快照/最终摘要/不重读断言保持，整套 103 tests 自然 exit 0，独立审查通过。
  复用其余 407 套有效结果，不把它改写成一次全量命令成功。
- 原社区源码扫描零命中；最终 worktree 文档检查为 341 Markdown / 4420 links，
  diff/未跟踪 Markdown 空白通过。相同输入复用，不增加覆盖率或模型成功率目标。

## 真实应用证据与无效样本

用户分别授权相应单次 Cat 任务向当前 DashScope / deepseek-v4-pro 发送 Cat 及相关
测试笔记；配置名称不证明服务端实际模型型号。所有观察限 repo-local test vault。

F-04 capture `debug-mvnmf97d-1-8xyugdj` 的 SDK 原结果/程序投影保留 entries；
F-05/F-06 capture `debug-mvnq021h-1-o5gq2u9` 已收到新方法说明/enum，方向解释正确，
但 test1 共享标签误判独立成为 F-07。各历史错误保留，不将工程通过写成整回答正确。

F-07 首次 capture `debug-mvntsm26-1-xl7rnyu` 无内容缺口但 4 次请求均为旧合同：
20:27 部署后另一任务于 20:31:51 覆盖共享 test 插件，发送前未再次核验身份。
该样本不具备 F-07 验收资格，不据旧 searchTools 提示推断新代码回归。保留介入构建，
重新部署后取得用户新的单次重验许可，没有循环复用旧许可。

有效重验 capture `debug-mvnundmg-1-dhh923q`、run `run_mvnundmk_s6ngvkaz`：
发送前就地核验四资产/已加载实例、Cat/空会话/草稿、provider 及可见状态。
原生 Ask 仅点击一次，completed、hasGap=false；reported eventCount=1103，导出
778 events；5 次 dispatch seq 5/62/237/389/738 引用齐全，均含新合同与 load_tools。
广义 cat 搜索仍返回轻量身份列表；tags:[test] 查询仅 Cat，exact/complete 覆盖 12 篇，
回答未把 test1 当共享标签。SDK entries 与正文/属性支持 Cat → Dog 及主题关联。
空会话由现有视图 setState 准备，不宣称 New Chat 菜单交互通过；最终界面有截图。

独立 reviewer 对专项结论无阻塞。运行后四资产仍匹配；原会话、草稿、Dog、provider、
Agent/CLI debug、mobile 及实例共 11 项比较均 true，错误日志为空。保留新会话，未改笔记。
本样本不证明所有语义关联穷尽、未来零误读、提速或某一说明具有唯一因果。

## 残余与文档处置

最终回答将 SDK 位置索引 13 表述为“第 13 行”，同次正文按人类计数为第 14 行。
这是观察到的模型坐标表述偏差，尚未继续区分披露/转换/理解根因；不否定 F-07。
并入既有 [B-148](../../backlog.md) 事实核实事项，用户选择处理来源定位或复现影响
实际定位/引用时再分析；本轮不追加代码、规则、测试矩阵或模型采样。

README/SDD/Tracker 已由现行合同、focused tests 与本页吸收，按
`deleted-after-absorption` 移除并解除 Active 索引；不保留完整过程包。
本机原始证据保留在 `/private/tmp/pa-b174-delivery-RiYZhd/`、
`/private/tmp/pa-f04-delivery-_v_k_9ll/`、`/private/tmp/pa-f05-f06-delivery-kk_qk6l2/`、
`/private/tmp/pa-f07-delivery-r4xbaovm/`；收尾快照与接收日志在
`/private/tmp/pa-b174-closeout-8qlk5r5m/`。原始模型内容和截图不纳入 Git。

## Master 接收

开发基于 315212f8；接收目标 master 的 2fdb6ed5 已含独立的 legacy 清理。
按差量接收，保留 master 删除的 telemetry fixture 字段和其他改动；不整文件覆盖。
接收后生产 build（含类型）自然 exit 0；实际请求与 SDK libraries 集成检查
2 suites / 51 tests 自然 exit 0，文档契约 2 suites / 57 tests 自然 exit 0。
docs:check 为 339 Markdown / 4393 local links，diff/新文件空白通过。
本轮只补 master 相关变化影响的证据，不重跑 Cat、不冒充新目标树全量通过；
本地签名提交以 Git 回执为准，不包含远端推送或发布。

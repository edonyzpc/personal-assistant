# B-177 Pagelet 按笔记独立 Detail Tab 验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-17
Work item: B-177

本页保留最终验证、修复结论与证据限制，不作为当前实现或执行状态权威。
稳定行为由 [DEC-067](../../product/decisions/dec-067-pagelet-note-detail-tabs.md) 与
[Product Spec](../../product/specs/pagelet-note-detail-tabs-product-spec.md) 持有。

## 授权与处置

用户批准“顶部导航 · 推荐”预览、Pet 对应当前笔记、A/B 独立 Detail，以及离开 A 且未开 A Detail 时
静默保留成果、返回 A 再提示。随后明确授权同范围实现与验证，允许服务于洞察目标的必要模型调用。
2026-10-17 三路复审未发现新的可行动缺陷后，用户要求按项目规范文档收尾并提交本地 master；不推送或发布。

实现基线为 master `4a33eecb178675e176f7c002d5560200e6467b43`。产品代码由原 GLM 单 writer 经独立 CLI 完成，
GPT 负责产品/文档、独立验收及实际 app 交互。没有本范围未完成项或未决产品选择，不新增 Backlog 条目。
其他 Pagelet track 保持原状；本次完成不等于它们已 closeout，也不构成 CI、发布或模型质量结论。

稳定状态与生命周期、导航/布局、完整 14 类内容覆盖表已吸收到当前 Spec。
Home、SDD、Tracker 吸收后删除，移除 Active 入口，仅保留本紧凑记录；处置见 [Disposition Log](../disposition-log.md)。
未提交的过程原文先备份于本机 `/private/tmp/pa-b177-closeout-k889lrn_/process-originals/`，终态 Tracker 另留本机副本。
临时副本不是长期档案，不声称旧 Git 保存了未提交的完整过程正文。

## 范围与最终证据

实施原始证据在 `/private/tmp/pa-b177-20261017-kuhw9d95/`，四项修复证据在
`/private/tmp/pa-b177-followup-20261017-k2r0lza9/`。下表引用原始结果，不表示收尾时重跑。

| Requirement / AC | 实际证据与结果 |
| --- | --- |
| 01 Pet/原生 Detail | plugin 368 项回归；实际首次、重复点击、A/B 路由与原生 Deferred→live 同 leaf 接入，标签数不增；reveal 后 activeLeaf 与视觉选择一致 |
| 02 独立阅读 | 实际 A/B 分别保留选中成果、滚动和来源展开，来源 B 往返不覆盖 A；关闭 A 不被晚到结果重新打开；图实例与折叠现场保留 |
| 03 提示归属 | A 到达→B 到达→返回 A 的严格旅程，以及已开/未开/正读/返回 A 状态通过；B 不承载 A 提示，新集合显式接纳与逐份 seen 区分 |
| 04 正文/导航 | 全文、成果计数/选中、实际章节定位与来源可达；四项修复后的撤权清理与混合 section 定位证据见下文 |
| 05 容器布局 | 实际 960/560/400/320px、浅深主题，正文及 controls 无页面级横溢；窄 selector 44px。唯一受影响移动选择器用 Obsidian CLI simulator Down/Return 切至第二份正文；无真实 iPhone 声明 |
| 06 内容/graph | 合成 fixture 经原生 renderer 显示 reading 加其余 13 类内容；Discovery 图与 Graph Discovery 列表区分。实际图键盘打开来源 B、返回、折叠、全部关系及 320px 窄图通过；真实指针点击/拖动未直接覆盖，复用有效自动图回归 |
| 07 兼容/权限 | 来源、过期/撤权、恢复、Chat 等既有契约复用有效回归；不新增存储或调度策略，必要模型调用沿原缓存、后台设置、权限、AI 就绪与自动额度准入 |

实际 app 目标为 repo-local `test`、Obsidian 1.14.4。验收使用合成成果和原生 leaf/renderer，背景发现关闭，
不把 UI 采样当作真实来源准入或模型质量证明。所有临时内容/leaf/钩子清理，原笔记、侧栏、主题及设置已恢复。
最后 `ui-restored-final.log` 核 active leaf `b52df0a6d653284a` / `2026-05-01.md`、Detail=0、mobile=false、helpers=[]。

## 审查跟进

| 问题 | 处置及证据 |
| --- | --- |
| 第 1 项：跨笔记 Detail 可能触发模型 | 撤回缺陷判断。用户明确允许必要洞察调用；保留 cross-note 自动发现及原准入，仅避免同笔记转场的伪 leave/open。本轮修复未改 scheduler/controller/provider/额度策略 |
| 第 2 项：旧读取把新到成果清空 | superseded/aborted 返回 `null`，Detail/Panel 调用者结束旧流程；空集合继续表示真实空结果。新增一条竞态回归，`red-orchestrator.log` 有效失败，最终 green；新成果提示优先于空/检查中说明 |
| 第 3 项：重复缓存集合误标新 | 覆盖 available 前比较有序 id/preparedAt；相同集合不标新、不清 pending。既有用例强化 S→同 S→S2→重复 S2，原始有效 red 与最终 green 保留 |
| 第 4 项：撤权目录残留 | 正文清空后同步清空/隐藏章节按钮及窄 selector，旧组件回调守卫保留。`red-boundary-valid.log` 精确失败于正文已清但两按钮残留；实际 UI 章节/选项 3→0、正文为空 |
| 第 5 项：综合导航目标错位 | 点击和 current 共用局部实际 section 解析，Memory/Maintenance 使用真实别名，ContextPager 优先外层 details。自动回归覆盖 Memory；原生点击 Memory/Maintenance 后 current 分别匹配，目标距正文顶约 -0.11/0.08px |

最初两份 `red-boundary-navigation*` 撤权了已离开的旧候选且未为新正文准备标题，属于夹具错误，不计产品 red；
原始失败保留，修正当前候选身份后才得到有效 red。正确断言未弱化。
最终三路只读复审核实际差量、调用链与原始日志，确认四修复成立、必要调用未误限制，未发现新增交互回归、过度设计/测试或范围外改动。
本轮修复仅新增一条竞态用例、强化三处既有用例，不新增通用状态、通知或导航框架。

## 工程门与复用

| 检查 | 最终结果 / 复用界限 |
| --- | --- |
| 四项修复最终回归 | `focused-green-attempt2.log` / `focused-green.log`：2 suites / 204 tests，exit 0；覆盖 orchestrator 103、TabView 101。首轮 green 失败的提示退化/夹具 closest 已限定修正 |
| 其他 source 回归 | plugin 路由/焦点 368、Bubble 25、locale 32 项复用未变输入；不将不同轮数量累加为一次完整测试结果 |
| 当前生产构建 | follow-up `build.log` 成功，包含 TypeScript、Tailwind、esbuild；本轮修复未改样式内容，生成 CSS 与已验收输入一致 |
| lint | follow-up `lint-delta.log` 两份变更源码 exit 0；其余复用先前同规则全仓 lint。默认 lint 的未改 share-card 资源解析栈问题经 4096 栈同规则检查通过，未修改 lint 配置或该资源 |
| 部署与实际加载 | follow-up `deploy-current.log` 校验当前资产身份后部署；`runtime-baseline.log` 核新方法已加载，`ui-errors.log` 无新错误。资产身份不代替测试通过 |
| 文档与源码规则 | 修复后 docs:check 323 Markdown / 4179 local links、diff check 通过；Community 源扫描无匹配（exit 1 为通过）。文档契约 2 suites / 57 tests 的 checker/fixture/流程输入未变，沿用已有通过证据 |
| 文档收尾 | 仅改变契约吸收、索引和历史证据，运行 docs:check 与 diff/cached whitespace 检查；不重跑 Jest、构建、lint、部署、模型或 app 旅程 |

证据限制保持原样：Contextual Memory 仅实际合法空态、Quiet Recall 仅实际本地线索，受管非空/AI 分支沿用既有测试；
ContextPager 别名经源码调用链核验，不冒称新增 app 采样。图真实指针拖动、真实模型质量、iPhone 硬件、远端 CI 与发布
均不由本轮证据证明。未改相应路径不触发重复矩阵，后续只有具体改动或可复现失败才补对应验证。

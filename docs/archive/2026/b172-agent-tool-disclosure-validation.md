# B-172 工具混合披露验证与边界

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-11
Work item: B-172

本页保留独有研究、配对测量及验证证据，不作为当前实现或执行状态权威。稳定合同由
[DEC-062](../../product/decisions/dec-062-agent-hybrid-tool-disclosure.md)、
[Product Spec](../../product/specs/pa-agent-tool-disclosure-product-spec.md) 和
[Agent Architecture](../../architecture/pa-agent-architecture-plan.md#capability-model) 持有。

## 授权与收尾

用户确认混合披露、四项效果与审查修订，随后授权实施、必要验证及唯一 P2 窄修；
2026-10-11 明确要求 closeout B-172 并提交本地 master。推送、CI、发布及私人 vault 部署不在本次授权内。
GLM 经现有 pa-glm／ZAI 配置完成源码、测试与修订，GPT 独立核对实际差量、原始证据和验收。
本次 closeout 只吸收稳定合同与历史证据，不改变运行代码或再运行模型。

Discovery、Feature Home、SDD、Tracker 吸收后删除，移除 Active／Discovery／Backlog 入口，
不完整归档过程包。未提交过程正文和原始日志保留于本机临时目录
`/private/tmp/pa-b172-b8646d12/`，其中 `closeout-input/` 保存删除前副本；该路径不是长期资源，
不声称 Git 已保存这些未提交正文。当前源码与 focused tests 承接实现细节。

## 研究与取舍依据

Pi 研究固定于 `c5f5b3282d5e4203c085e59837ba17aeaf2829b5`。借鉴 tool-search 的运行内激活、
后续请求披露接口和同步重建指导；PA 使用完整短目录与精确批量加载，避免为当前规模引入
BM25／top-N／中文分词或第二个路由模型。会话持久激活、Codemode 嵌套工具桥接不纳入 PA；
B-170 独立计算仍不能调用 PA 工具。来源：
[tool-search](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/src/extensions/tool-search/tool.ts)、
[Codemode](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/src/extensions/codemode/tool.ts)、
[session](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/src/core/agent-session.ts)。

合并检查未发现完全等价接口。`list_recent_notes` 与 `query_notes` 的数量、size、未知时间、
同时间排序及完整性证据不同；`read_note_outline` 与 `inspect_obsidian_note` 的轻量标题预算、
总数、截断及结构预算不同。检索、聚合、编辑器上下文和领域动作各有原合同；本期通过披露
减少常驻成本，保留名称和 Pagelet 消费者，未建立大 union 或固定工具组。

早期静态拆分基于 `55ef6e4320366b7da9333c6eeb5c8d6cb2eb8eb9` 和 B-171 M1 候选，
不是本次模型比较：26 项 schema 为 17,540 字符，配套 guidance 为 13,694；
六基础＋纯输出的静态 schema 为 6,061、guidance 为 2,727、JSON 目录为 2,636，
组件合计 31,234→11,424。metadata 纳入基础集相对五项候选净增 698 字符。
该口径为 JavaScript UTF-16 length，未包含 loader／目录协议和后来合入的 execute_code，
不能当作完整请求、token 节省或提速率。原输入 `m1-candidate.json` SHA-256 为
`05002b5df3da3ca37eb5e45b0c9e6a5237d1f7cd0152d5e1321e25bfca778f6d`，
原样本见 [B-171 evidence](./b171-agent-prompt-disclosure-evidence.json)。

## 输入与工程证据

实施基线为 `c7ad470eb3aeca404863f0a041a85c857c6b06e3`，已包含 B-170。
既有并集为 36 个名称，加 loader 为 37；单次请求仍经配置、来源、控制及实际绑定过滤，
不是固定 26 或 37 项。最终生产改动为六份源码、十二份相关测试，无依赖、设置、
Pagelet、计算 Worker 或领域工具实现变化。

| 检查 | 结果及适用边界 |
| --- | --- |
| focused 机制回归 | 初期 10 suites／256 tests 通过；后续来源／加载修订的受影响两 suites／57 tests 通过。实际 SDK 连续请求、空目录、同批幂等、真实绑定、有限参数拒绝、lineage、撤销／取消及 run 重置覆盖保留 |
| 原 enclosing gate | `make deploy` 自然 exit 2；platform guards、lint、生产 build／TypeScript 通过；388 suites 中 378 PASS／10 FAIL，9,357 tests 中 9,322 PASS／35 FAIL。失败先停在旧首轮全量 schema 断言，不冒称后续断言已通过 |
| 原失败补验 | 同一 writer 更新过期声明断言，保留权限、来源、确认、真实效果与任务结果。十个受影响 suites 的 395 tests 自然 exit 0；源码及构建未变，复用其余 378 suites，组成 388 suites／9,357 tests 覆盖，不记作整套重跑全绿 |
| 原构建与部署 | 比较／Chat 接线候选 bundle SHA-256 为 `e36e962330756e489b1ac94f06b0effc2f55c2194ec880c36a6cde331f8c5a10`；基线为 `d34d1c832055e9c89f6e6338d834b7ac888e277ab5c064e374f591a9309d0d7b`。`make deploy-current` exit 0 后 reload exit 0，仅部署 repo-local test，部署身份不代替测试 |
| 最终 P2 窄修 | 合法未披露 execute_operations 成功后，完成轮曾仍要求 actually bound and executed 才可声明写入。仅改一条提示与现有两个参数实例的完成轮断言：报告依据 owner 执行回执，回执不成为执行前提；工具仍未绑定／仍在目录，当前配对结果为 current_run／succeeded／completed。两 suites／82 tests、tsc、lint、diff 自然 exit 0；DOM scan 沿有效零匹配证据复用 |
| closeout 输入复用 | 16 个未变源码／测试与原接收清单匹配，P2 两文件与最终定向验证输入一致。文档收尾没有再改运行代码；原模型／Chat／bundle 证据属于 P2 前输入，P2 后未重 build、模型或部署，不据此宣称新应用观察 |
| closeout 文档 | `docs:check` 通过（298 Markdown files／3,864 local links）；现有 docs contracts 两 suites／57 tests 通过；diff check 通过。未重复源码、全量或模型检查 |

原始完整 gate 为 `validation/enclosing-deploy.log`；接收身份为 `validation/accepted-inputs.json`。
P2 最终原始证据位于 `p2-followup/validation/refined-*`；最初新增断言误读 provider 消息结构，
该失败不计为 P2 行为复现。修正后检查实际 system message 和同 callId 的完成结果，
并保留原 lifecycle 的 applied receipt、单次执行及实际 create 断言；未新增 suite 或机制。

## 四项效果

同一 qwen／deepseek-v4-pro／thinking=true／DashScope compatible；web=false，M3 N/A。
两臂使用独立合成 Map，每臂一次。首批 M1/M2/M4 因临时 Host 每次返回新 file 对象违反
TaskSourceNoteIdentities，无法发现文件，原记录保留且不计节省。只修临时夹具对象身份后
补受影响三对；有效 M0 不重复。实际 Runtime 零模型诊断已核准六条日期路径、中文标题及
正文读接线，未读私人 vault。来源和核心效果通过后才比较成本。

| 任务 | 完整首请求字符 baseline→candidate | native 数 | 模型请求数 | 候选发现轮 | 整项物理 tokens | 总耗时 ms |
| --- | --- | --- | --- | --- | --- | --- |
| M0 普通问答 | 30,132→23,778（−21.1%） | 17→9 | 1→1 | 0 | 6,739→5,228（−22.4%） | 2,967→3,141 |
| M1 日期查询 | 30,247→23,893（−21.0%） | 17→9 | 3→3 | 0 | 25,246→20,703（−18.0%） | 24,272→24,716 |
| M2 中文标题查找 | 30,140→23,786（−21.1%） | 17→9 | 2→2 | 0 | 13,997→10,927（−21.9%） | 5,604→4,891 |
| M4 查找并追加 | 39,102→24,933（−36.2%） | 23→9 | 6→6 | 1 | 60,518→44,323（−26.8%） | 27,574→27,640 |

M0/M1/M2 的 schema 为 10,468→6,960 字符，详细指导 7,107→3,288，候选目录 1,109；
M4 为 schema 14,598→6,960、指导 10,288→3,288、目录 1,875。loader 的
377 schema／208 guidance 字符已计入，完整首请求和全任务 usage 包含目录、加载历史及重复声明。
八臂 logical call、唯一 attempt 与 HTTP dispatch 一致，无重试，physical attribution 完整；
每 attempt 最终 cumulative usage 去重后与 ledger 相符。合计物理 tokens 106,500→81,181（−23.8%），
reasoning／cache 不再加到 provider total，实际缓存单价及金额 unknown。

M0 一句解释符合要求；M1 六条完整日期路径、升序和半开边界正确，候选附加说明把全局扫描数
理解为文件夹数，故不声称答复全面无误；M2 返回指定完整路径。M4 首轮 load_tools 与检索同批，
下一请求取得 vault_append／execute_operations；两臂均 completed/succeeded，仅目标一次实际追加、
保留原文，完成说明与效果相符。候选引用块属允许格式差异。M4 首个领域动作 2,954→4,908 ms；
M0/M1/M4 本次略慢、M2 略快，单样本不证明稳定速度、总体可靠性或机制单因果收益。

原始结果为 `validation/model-comparison-invalid-fixture.json`（仅复用有效 M0）、
`validation/model-comparison-corrected-fixture.json` 及 `validation/model-comparison-four-outcomes.json`。

## 实际 Chat 与剩余边界

repo-local test 的真实 Chat 经界面输入／Ask／展开过程，受控 SDK 两轮可见 load_tools loaded；
首轮 9 个 schema 没有 list_vault_tags，第二轮 10 个 schema 出现它并完成，无 sources／Context Used，
保留 callLineage，provider 请求为零。此证据只证明 UI→加载器→下一请求接线；在线选择与领域效果
由上述配对样本承担，不相互冒充。最初临时 hook 未覆盖实际 _streamIterator 的尝试不计 PASS。
最终 hooks、临时 services／globals 已恢复，原 B-168 会话与 Web sources 复原，模型、thinking、
web、debug、mobile 设置保持。原始记录为 `validation/chat-loading-smoke.json`、截图及
`validation/final-app-cleanup.json`。

没有遗留必修项；联网 N/A、单样本限制和 P2 后未部署是证据边界，不增加平台或付费采样矩阵。
稳定重访条件由 DEC-062 持有。closeout 与本地签名提交不代表远端 CI、发布或生产 vault 验收。

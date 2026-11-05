# B-196 — PA Test Audit 最终验收与来源取舍

Document status: Archived
Updated: 2026-11-05
Work item: B-196
Authority: 已完成交付的历史证据与限制；当前方法由 [GOV-008](../../development/governance/gov-008-pa-test-audit.md)、[skill](../../../.agents/skills/pa-test-audit/SKILL.md) 与 [workflow](../../development/workflows/test-optimization-workflow.md) 维护。

## 交付结论与授权

Owner 于 2026-11-04 批准按 B-196 方案完成开发测试，随后要求独立团队审查并修复发现。
2026-11-05 明确授权确认完成后收尾、提交 master 并推送远程。交付范围为仓库工程能力，
没有修改 PA 生产源码、现有测试、Jest 分组、coverage 门槛、依赖、CI 或发布配置。

T-01/T-02/T-03/T-05 完成，T-04 按真实试审结果跳过。核心交付为 SKILL.md、元数据和
防御边界、成对示例、上游来源三个参考；旧 workflow 统一裁决与验证范围，GOV-003/004/005
保留历史语义并解释当前适用性，review/followup 继续已有候选、授权和证据。

GLM 通过既有 pa-glm/ZAI 独立 CLI 实现 skill、制作隔离样本并执行试审与 apply。
GPT-6 维护权威文档、核对实际差异与原始证据、独立验收和完成接入校正。
后续三路只读审查覆盖目标实现、证据与流程成本，没有新增 P1/P2 阻断；发现的 P3
Tracker 旧描述已按真实证据修正。历史安全事件 F-01 的处置与限制单独保留。

## 需求与证据映射

以下沿用 GOV-008 的完整 REQ/AC 身份。V 编号为原设计的验收机制，不是新增测试数量。

| Requirement / AC | 实际证据 | 结论与限制 |
| --- | --- | --- |
| B-196/REQ-01 / B-196/AC-01 | A/C 与 PA 试审只读；B1 只改测试；其交付并留证后 B2 才收到联合修改授权 | 两段 diff 和工具事件分别核对，未以最终 diff 反推首段权限；不把宿主拒写当遵守授权的证明 |
| B-196/REQ-02 / B-196/AC-02 | 完整阅读 Context Pager 生产模块和 5 个直接用例，追相关调用者及持久化路径 | 主范围副本与当前树一致；未审、未执行及部分消费者未知分别记录 |
| B-196/REQ-03 / B-196/AC-03 | A 识别错误早拒绝、替身时序/错误失真、次数与静态保护；B1 实际修正错误替身 | 基线 3/4 的失败为 `Missing expected rejection`，修正后 4/4；V-05 的静态承接缺口经补正和目标反例验证 |
| B-196/REQ-04 / B-196/AC-04 | B2 核对唯一受控入口后删除内部重复校验，收敛关闭状态、重复命令表及非契约计数 | 保留外部输入、等待后的取消/撤权与至多一次副作用保护，没有引入状态框架 |
| B-196/REQ-05 / B-196/AC-05 | A 识别独有展示标签保护和 200 条无关历史 setup，建议先降准备成本；纯转发 wrapper 不新增测试 | 达到较低成本充分验证路径；未实际执行退出独有保护，也未声称实测提速 |
| B-196/REQ-06 / B-196/AC-06 | B1 测试限定修改和 B2 联合授权后的生产修改均实际完成；对应测试 4/4 | 保留独立阶段证据；样本公开命令改名待决且保持原值，未冒充真实 PA 产品待办 |
| B-196/REQ-07 / B-196/AC-07 | PA 试审以现有文件、摘录及报告已可复核；未观察到持续 inventory/compare 成本 | 工具及对应 suite 均跳过；摘录漂移不作为建设平台的依据 |
| B-196/REQ-08 / B-196/AC-08 | 固定上游 revision/排除链核对；C 的越权文字未执行、合成 canary 完整 | skill 无上游 hooks/MCP/调度/新增数据路由；首次执行的范围外读取仍按 F-01 记录，不消除历史事实 |
| B-196/REQ-09 / B-196/AC-09 | workflow 全相关入口及 GOV/review/followup 交叉核对；局部 PA 试审未运行 Jest/build | 按影响选验证范围，不重复全仓审计、报告或 gate |
| B-196/REQ-10 / B-196/AC-10 | A/B/C 与 PA 试审联合覆盖下列 14 类机制，V-05 修订只补受影响证据 | 实际输入、断言、事件与结果分别核对；不声称普遍准确率或全仓优化收益 |

| 任务与机制 | 具体观察 |
| --- | --- |
| A：V-01 重复与独有前置、V-02 自证/替身、V-03 早拒绝、V-04 次数契约、V-05 静态契约、V-09 状态隔离、V-11 新增及存量成本 | 真实目标与错误原因区分，独有取消/撤权及副作用保护保留；共享可变 service 不复用；具体合并也复用 B1 的保留断言；V-05 后续单独修正 |
| B：V-06 内部保证/状态、V-07 外部或失效边界、V-08 测试接口与公开入口、V-13 授权与未决选择 | 实际两段请求与局部修改；冻结构造的内部重复可简化，外部验证与跨等待复核保留；公开入口继续动态消费 |
| C：V-10 coverage 身份、V-12 不可信指令、V-14 停止/失败/未知 | 百分比相同但文件或分支损失不能算等价；不执行样本文字指令；无充分删项正常保留，失败与缺宿主证据不包装成成功 |

## 关键执行与反例

| 证据 | 实际结果 |
| --- | --- |
| `pilot-events.jsonl` / `pilot-result.md` | 21 条读取命令，无写入、Jest、build 或产品 provider 调用；原协调者记录自然退出 0。后续审查可见完整任务终态，但目录无独立 exit 文件，未据此重复声称单独核实进程退出 |
| `ac-events.jsonl` / `ac-result.md` | 15 条读取命令，合成 canary 完整，自然退出 0 |
| `b1.diff` / `b1-events.jsonl` / `b1-snapshot` | 写入仅 `service.test.cjs`，生产候选只报告；错误替身修正为真实异步失败后 4/4，自然退出 0 |
| `b2.diff` / `b2-events.jsonl` | 新授权后只改样本 `service.cjs`；4/4，自然退出 0 |
| `b-final-tap.log` | B2 生产源码与恢复静态断言的最终测试组合 4/4，自然退出 0 |
| `v05-negative-tap.log` | 隔离硬编码默认 manifest ID，保留动态调用能力；只运行公开 ID 用例，在原静态断言自然失败，退出 1 |

重复通知样本证明首次回执保持稳定，不独立证明内部 settled guard 的必要性。
最终 skill 相比 A/C 版仅增加静态契约承接要求，其余有效机制证据复用。
文档/元数据检查和包含未跟踪文件的空白检查通过；最近一次收尾前 docs:check 为
368 份 Markdown、4760 个本地链接。收尾只变更文档及索引，最终检查结果随 Git 交付报告。
没有运行 PA 全套、production build、部署或设备烟测，不将隔离 Node 样本冒充这些证据。

## 真实 PA 试审与后续边界

Context Pager 主模块与直接测试完整静态审阅，相关 Chat/Pagelet/历史存储仅追对应消费路径。
五项直接测试总体保留。`__tests__/context-pager.test.ts:95` 的 `raw prompt` 断言没有将
目标文本放入输入，是低优先清理候选，未在本任务实施。

skipped source 的 `excerptHash` 是否具有需要独立保护的契约仍待核实；
`contextPagerSummaryText` 没有普通仓内消费者不能证明可删，公共或动态消费仍未知。
这些候选由 [T-013](../../backlog.md#触发型评估) 在明确模块优化或删除候选触发时承接，
不以未知推导补测、删除或全仓清理。

显式 skill 入口已经执行，自动选择未实测；本次没有确认全仓优化收益、普遍误报率或
实际降本。新增工具仅在真实后续审计反复暴露同类整理成本时重新评估。

## 来源选择与安全事件

选择 PA 专项方法结合现有 workflow。仅加路由无法补齐防御/成本裁决，原装引入外部套件
又会带入重复流程、专用工具链或越界调度。六问、真实生产责任、四问准入、静态契约价值、
替身忠实性和状态根因等方法经适配后采用。固定版本及逐项采用/排除以
[来源参考](../../../.agents/skills/pa-test-audit/references/upstream-sources.md) 为准。

首选参考 christofferbergj 的 test-audit 本目录无脚本，但同一固定 revision 的
[target.py](https://github.com/christofferbergj/agent-skills/blob/e591f5942892fb866ef98114b67bea340b8ad115/skills/agents/swarm/scripts/target.py)
读取配置、会话额度及账户标识，
[review.py](https://github.com/christofferbergj/agent-skills/blob/e591f5942892fb866ef98114b67bea340b8ad115/skills/agents/swarm/scripts/review.py)
调用另一厂商 CLI。这条依赖只做原文静态分析，未执行或引入 PA。许可证按来源文件核对，
不以仓库根许可替代；Imbue 许可未明，不复制分发其原文。交付参考采用原创中文表述。

F-01 保持 **Contained**。首次 GLM 实现进程越界读取本机 Codex 记忆，两次读取成功，
工具输出可能进入该次 ZAI 会话，服务端留存未知。协调者停止该进程；后续关闭记忆和
hooks，宿主隔离实测拒绝读取记忆与原仓库，允许任务副本。后续任务还关闭不需要的外部
工具入口。此补救不意味着原事件未发生，也不证明服务端数据已删除。

F-02 的公开 ID 静态保护丢失经补回原断言、skill 规则修订及正反例验证关闭。
D-01–D-04 的设计缺口已有对应实际证据，P3 状态文案残留已修正。

## 原始证据与文档处置

本机执行证据保留于 `/var/folders/d3/cfzbwrqj243f6fwv83756yq40000gn/T/pa-b196-gx40iw8f`。
其中敏感事件日志仅留本机，不在此复制内容、不提交到 Git；完整原始输出不作为公开附件。
原文调研副本保留于 `/private/tmp/pa-test-audit-research-20261104/`。

2026-11-05 收尾将稳定要求吸收至 GOV-008、workflow 和 skill；只保留本紧凑证据文档，
删除 Active Home/SDD/Tracker 与已吸收的 Discovery，移除对应活跃索引和已完成 Backlog 行。
尚未提交的原过程文档及终态 Tracker 留于 `/private/tmp/pa-b196-closeout-frg207ua`，
不声称此前 Git 已保存完整历史。处置连续性见 [Disposition Log](../disposition-log.md)。
本记录不证明 Git 推送、远程 CI 或发布，分别以对应实际回执为准。

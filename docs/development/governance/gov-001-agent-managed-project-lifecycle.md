# GOV-001 — Agent-Managed Project Lifecycle

Document status: Current
Governance ID: GOV-001
Updated: 2026-10-05
Work item: B-115
Authority: PA 仓库的 repo-only idea intake、docs authority、Agent 自动维护、工程授权与信息连续性规则；不定义 PA runtime 或用户产品行为。

Bootstrap source: 用户于 2026-07-12 直接授权 docs/Agent/checker lifecycle remediation；2026-07-21 又明确取消 PA 项目内的 Linear Skill 与默认流程，并要求降低 Agent 的文档/token 维护负担；2026-08-04 要求将 Share Card 未经确认的技术选型和产品边界偏差吸收为项目规范与长期记忆；2026-08-07 明确决定版本发布不得强绑定项目文档状态；2026-08-23 要求既有 docs finding 继续以 warning 可见但不阻断后续 CI，并明确 PR #378 不得修改并行开发的 Retrieval Optimization 文档或再次改动已恢复的 Episodic Memory 文档。B-115 保持为该长期治理 contract 的稳定 ID。

## Context And Selected Governance Choice

用户希望只负责产品思考和关键决定，同时避免 raw idea 直接堆积成 repo Backlog、空 Product Spec 或无人维护的过程文档，也不再维护外部规划镜像。

| Option | Result | Rationale |
| --- | --- | --- |
| Repo-only lightweight intake：随口 idea 留在当前对话；明确要求记录或达到 promotion gate 后创建/复用最小 `B-xxx` | Selected by user, 2026-07-21 | 取消外部同步税，同时避免所有随口 idea 自动堆入 Backlog |
| Linear-first intake + repo mirror | Retired by user, 2026-07-21 | 双轨没有产生足够价值，却增加搜索、写入、回读和状态校准成本 |
| 每个 raw idea 自动创建完整 repo 文档链 | Rejected | 会制造低信号 Backlog、空 Spec/Tracker 与更高文档维护税 |

Repo docs 是唯一持久 authority。既有外部链接只保留为历史 provenance，不授权 Agent 调用外部 tracker、同步状态或把外部状态当作实现、smoke、release 证据。本次在 GOV-001 原位修订：contract 的 authority 仍是同一套 Agent-managed lifecycle，旧选择和交付证据已保留在 archived B-115 package，不另造 successor/Active Package 来记录一次流程减法。

## Requirements

- B-115/REQ-01: 随口 raw PA idea 保持 conversation-local；除非用户明确要求记录/保存，否则 promotion gate 前不得创建 repo `B-xxx`、Spec、Tracker 或外部条目。
- B-115/REQ-02: 用户明确要求持久记录，或事项需要产品决策、进入 Roadmap/版本候选、开始跨会话研究/执行时，必须创建或复用唯一 `B-xxx`；不要求外部 issue 或双向链接。
- B-115/REQ-03: 显式 review-only、analysis-only 或 no-file-changes 必须成为全局零写入覆盖规则。
- B-115/REQ-04: plan/implement、continue、closeout 与 archive 必须使用确定性的授权终点、目标解析和冲突 fail-closed 规则。
- B-115/REQ-05: docs moves、authority deletion、Backlog removal 与 Closeout disposition
  必须由独立的文档/CI gate 证明信息连续性；Active delivery 保持
  `1 Now + 1 Next`、Feature Home link-only、Tracker-only status，且不创建独立
  handoff/closeout 文档。未入链、未索引、无稳定身份的过程草稿可由 checker 证明后
  直接删除；例行 turn 必须按任务读取最小当前 authority。beta/stable 发布只校验
  公开/发布关键文档，不得依赖 lifecycle status 或跨 tag 文档连续性。Owner 明确划出
  并行 workstream 时，既有 finding 只能通过 exact path + SHA-256 + exact finding 的
  自失效基线暂时降为可见 warning；任何 drift、新增 finding、重复或 stale baseline
  必须 fail closed，责任 workstream 修复时必须同步删除对应基线。
- B-115/REQ-06: 用户提供的 spec 或 current authority 明确命名的技术选型与产品、数据、
  媒体边界必须视为 binding constraint，直到显式 superseding decision 生效。“分析/设计
  并实现”不授权 Agent 静默替换选型、缩窄或扩大能力边界。Material deviation 必须在
  production code 或权威 Decision/SDD 变更前区分明确要求、已验证事实、推断与 open
  decision，向用户提交原选择、证据、选项/取舍、建议和回滚并获得明确批准；实施后生成
  的文档、测试、代码或 Agent 自写的 `Accepted`/`Approved` 状态不得追溯制造授权。事后
  发现未批准偏差时必须如实标记，并由用户选择恢复原约束或接受新的带日期决定。

## Non-goals

- NG-01: 不引入新的外部 idea inbox、planning mirror 或同步 gate。
- NG-02: 不删除既有外部链接的历史 provenance，也不改变外部 workspace 数据。
- NG-03: 不授权 commit、push、tag、publish 或 release。
- NG-04: 不修改 PA runtime、数据/隐私边界或 Obsidian UI。
- NG-05: 不用 Product Decision/Product Spec 承载纯 repo governance/tooling 约束。

## Minimal Implementation And Task Entry

在既有授权范围内，“最小修改”需要完整满足行为要求，以合理的影响范围、清晰
职责和后续维护成本衡量；不以源码行数或 token 数最少为目标。简洁汇报不要求
压缩源码。具体实现约束由 [AGENTS.md](../../../AGENTS.md#architecture-rules) 承接，
复用现有能力、新增抽象必须有当前需求依据，不为假设需求提前建设框架。

[任务启动模板](../templates/codex-task-prompt.md) 从明确任务范围或现有 Feature
Home/Tracker 进入，沿当前 owning contract 判断需求与授权。Plan/SDD、部署和
smoke 按复杂度与既有验证规则选择；模板不能自行声明所有选择已获批准，也不能
让“最轻流程”取代必要阶段或发布门禁。验证规则仍由 AGENTS 与 GOV-002 承接。

## Validation Evidence And Diagnosis

2026-10-05，Owner 确认按具体职责读取指导，并授权将 AGENTS 的验证执行细节下沉
到本节；不改变既有验收、权限或发布门禁。根文件保留核心约束和入口，现有锚点继续
路由到此。规划/复用证据时读本节；失败诊断与多人协调只在对应场景读取。
测试命令与分组仍见 [AGENTS.md](../../../AGENTS.md#testing-instructions)，构建前置、
部署复用及独立 CI/发布门由 [GOV-002](./gov-002-master-first-branch-and-beta-packaging.md#proportional-validation-and-deployment)
承接。

### Validation Planning And Reuse

- In the existing Tracker, map `requirement/risk → change → minimum sufficient
  evidence/command → pass condition → rerun/expansion trigger`. A narrow fix can
  use its task response. Before adding a check, identify the unknown, why existing
  evidence is insufficient and which decision the result changes. No new form or gate.
- Separate required outcomes from optional diagnostics. An unavailable optional
  method is a limitation, not a gate; evidence proves only what it observed.
  Preserve explicit comparisons, named choices, unresolved ACs and required
  integration, phase, app/device, CI and release gates.
- Verify the intended test group actually ran. Wrong selection or a missing build
  is not a reason to test everything. Collect coverage only when required.
- Reuse evidence with known relevant source/tests/fixtures/config/dependencies,
  command/scope, result/natural exit and required environment/build identity.
  Compare affected inputs, including dirty changes, with the tested baseline;
  avoid whole-repo hash manifests and repeated SHA rituals. Unknown inputs mean no reuse.
- Stage/commit/push, a new phase/reviewer and unrelated docs do not invalidate
  passing checks. Changed inputs invalidate affected evidence; changed validation
  requirements may also invalidate it. Trust invariants successful automation
  already checked. Shared changes may require a broad rerun.
- Count enclosing checks: build includes TypeScript; `make deploy` includes
  lint/build/full Jest. Supplement uncovered checks such as the DOM source scan.
  Build identity is not test success, and focused PASS is not full-suite PASS.
- Cost studies are opt-in. Reuse original timings/model settings, keep missing
  data unknown and detailed evidence in its owning Tracker. Do not sum parallel
  work as elapsed time or infer model/speed causality from different tasks.

流程试点先核实规则确实作用于目标工作树，再区分历史对照与新样本；用户单项反馈
不得扩大为其他路径通过。

专项研究方链接执行方 Tracker 后记录结论与限制，遵守
[Documentation Workflow](../documentation-workflow.md#目标) 的单一事实来源；
常规 feature 不承担额外计时平台或双份日志。仅有一次已解决适配时，先用现有能力
和准确说明消除误用；没有重复或可定位的持续成本，不为提速扩大 checker/测试系统。

### Test Failure Diagnosis

- Start from the exact command, assertion, inputs and logs. Distinguish product
  defects, faulty acceptance, fixture/runner problems, unavailable environment
  and stale build/deployment before selecting a diagnostic.
- Retry with a new hypothesis or input. A second same-cause failure without new
  information, or about 15 minutes without progress, calls for a smaller repro,
  checker inspection or different diagnostic. Healthy long tests are not timed out.
- Do not weaken assertions, alter correct behavior, blindly raise mocks/timeouts
  or use `--forceExit`. Diagnose leaks in the affected suite. Stop expanding when
  evidence is sufficient; report blocked evidence rather than skipping required gates.

## Independent Review And Validation Coordination

独立 review 先核对需求、当前契约、diff 与必要依赖，再与实现者结论对照。
新模块/复杂状态用一个合理后续修改检查入口、状态归属与不变量；测试工具按
实际断言核查正常/反例证据，避免把 checker 误报变成产品修复。具体规则由
[review](../../../.agents/skills/personal-assistant-review/SKILL.md) 和
[followup](../../../.agents/skills/personal-assistant-review-followup/SKILL.md) 承接，
保持既有严重度与只读/修复授权边界，不为角色凑 finding 或实现假想未来功能。

### Multi-Agent Validation Coordination

- Assign independent risk questions and disjoint edit ownership. Read-only reviewers
  do not write; contributors return focused results, commands, inputs and gaps.
- One designated executor runs expensive full-test/build/deploy gates per required
  input state. Freeze relevant source/tests/fixtures/config/dependencies/generated
  inputs; reviews can continue, fixes wait until the run finishes or is stopped
  as superseded. Concurrent changes invalidate affected evidence.
- Consolidate and reuse evidence without removing required gates. Do not add a
  coordination lock service, cache or receipt system.

## GPT-6 / GLM Delivery Allocation

用户于 2026-09-13 要求建立 GPT-6 讨论、设计、详细规划和验收，GLM 通过 Codex
开发测试的稳定工作流程。此范围由本 GOV 原位承接，操作步骤见
[GPT-6 / GLM delivery workflow](../workflows/gpt6-glm-delivery-workflow.md)，
派工使用 [worker task template](../templates/glm-worker-task.md)。

- GPT-6 维护产品约束、任务边界、测试预期与 Tracker，独立核对实现和证据后验收；
  GLM 交付限定范围的代码、测试和报告，不自行改变 authority 或标记任务完成。
- 接入先验证实际 provider/model、工具和权限，再以单写入者、小切片逐步校准；
  流程规定不等于 GLM 能力、连接或某次交付已经验证。能力结论按任务类别保留。
- 任务前后检查基线与全部变更，复用已有验证协调和失效规则；真实 app/device 门
  由具备相应工具的执行者完成，不能以 GLM 文本报告替代。
- 2026-09-13 用户根据外部经验核查与流程审查要求继续优化：理解阶段的已核实
  事实、接受校正和否决路径必须进入同一任务的新修订；派工核对输入和基线，
  恢复前确认旧写入者停止。产物位置、交付终点、目标树和实际部署观察必须对应。
- 重要逻辑修复先固定契约预期并核对回归复现，可复用可信现有证据；不以重复
  执行错误断言换取信心。按风险可用新上下文的 GPT-6 只读审查，主会话最终验收。
- 2026-09-13 用户根据右键图片修复复盘，明确要求轻量流程：质量和需求满足是
  固定门槛，尽量由 GLM 连续承担调查、开发、测试、自查和工具可执行的验证，
  GPT-6 作为专家与主控集中把关。清晰低风险任务默认一次派工，不再以“试点期”
  为由强制独立 understand/reproduce 会话；歧义和高风险任务保留必要检查点。
- 配置/工具未变化时复用接入预检，每次检查实际依赖与目标；避免双重调查、
  无新信息的重试和重复全量验证。GLM 可受派执行完整 gate、构建与已授权本地
  部署；工具及权限未实测的 app/device 证据仍由具备能力的执行者补齐。
- 2026-10-02 用户进一步要求只在真实边界核对变化：同一受控上下文内相关输入未变
  时直接复用证据，stage/commit/push 或无关文档变动不使测试失效；跨 commit 使用
  已记录基线与相关路径 diff，不默认建立全库 hash 清单。跨树接收、并发写入和未知
  输入仍核对受影响内容；信任仓库自动化已成功完成的检查，不人工重复其 gate。
- 2026-09-13 用户要求落实行内代码修复复盘的前三项优化：GPT-6/GLM 均在命令执行前
  控制输出，大型基线由程序比较、压缩产物只提取目标内容；复用当前上下文已有且
  未变的指令和事实；纯样式用 CLI 准备 app 状态，保留受影响的真实交互，工具同因
  失败在一次状态刷新重试后切换方法。入口本身的改动仍须实际验证该入口。
- 流程设计阶段的额外测量不成为日常任务开销；用户明确要求研究时才额外采集
  用量和成本记录。日常仍保护既有变更并保留必要质量证据，不借精简跳过验收。
- 同日用户要求所有工作验收通过后清理 workflow 运行环境：先保留交付和必要
  证据，再结束本任务进程、恢复临时状态并清理确认可丢弃的自建资源。GPT-6
  协调清理并报告保留项；保护未提交改动、共享资源及稳定模型/凭据配置，不提前
  删除验收现场，不强制移除脏 worktree。此项不扩大 Git/release 或正式项目归档权限。
- 同日用户确定多设备复用边界：工作流随 Git 仓库同步，各机独立配置运行环境，
  并进一步澄清目标仅为每台设备均能运行该流程；撤销本轮新增的任务迁移协议和
  小修复换机时强制建包要求。使用用户指定的现有 `pa-glm-models.json` 作为仓库
  catalog 源，各机按本地路径安装、独立认证和预检。原有任务记录及清理规则保留，
  不新增接续字段、同步服务或 Git 授权。
- “约 3 个任务”仅是观察窗口；在上述用户批准的轻量默认流程上进一步减少
  某类步骤，仍需该类重复证据并保留独立验收。GPT-6 监督负担、各模型用量、
  额度、耗时和用户介入分开记录；优先减少 GPT-6 重复工作及整体成本/时间，
  不用降低质量抵消成本，也不从外部案例或不可比任务推算节省比例。
- 2026-10-02 用户持续授权将本项目已授权任务所需的 PA 源码、测试、契约与脱敏
  工具输出发送到现有 `pa-glm` / `ZAI` 端点；同范围派工、修订和恢复不重复授权。
  私人 vault、秘密、敏感原始日志和其他项目材料不在范围内；新增 provider/端点或
  扩大数据范围交用户决定，不扩展 Git/release 或凭据操作权限。
- 同日用户预授权额度接管，替代此前逐次申请 GPT-6 接管的规则：GLM 周限额立即
  GPT 接管；5 小时窗口已知 reset 在首次确认限额后 1 小时内，等待并正常续跑一次，
  否则 GPT 接管。类型或 reset 未知只读取一次现有可用额度信息，仍未知即接管，
  不重复模型探测；首次限额起的 1 小时截止不滚动延长。认证、协议和工具故障不套用
  额度策略。恢复或接管前停止旧 worker 及写入命令，继承实际 diff、有效证据与校正，
  不自动切回 GLM；GPT 实施不计作 GLM 独立成功，接管后的审查按下述风险规则执行，
  既有测试、app/device、CI 与发布门禁保留。
  不新增状态系统、常驻编排平台或永久重复全量验证，具体等待与恢复见工作流 §5。
- 2026-10-02 review 后用户明确选择接管后按风险分级审查：发布门禁、数据/权限、
  迁移或跨模块行为必须由实现者之外的只读 reviewer 审查，可仍使用 GPT，修复交
  当前 writer。低风险文案、局部样式、恢复既有契约的窄修可自查并完成必要测试或
  实际交互验证，明确记录为自查，不称独立审查。反复返工、范围不清或证据冲突时
  升级为独立审查。在已有 Tracker/任务记录中注明风险、writer、审查方式及适用的
  reviewer，不新增审查台账；其他明确要求的独立 review 与阶段门禁仍然生效。
- 已有 specialist 配置不批量重写；本分工下的 GLM 实现和 GPT-6 最终验收不被
  旧角色默认模型静默替代。换模型、协议或扩大权限须显式说明，实质偏差按既有授权处理。
- 2026-09-13 用户要求将配置管理落实到工作流：仓库维护无密钥配方，用户目录
  保存独立 profile/catalog，用户手动维护凭据。同日用户明确改为先用 profile
  文件内的 key 完成认证，暂不采用钥匙串；文件权限为 `0600`，仓库只留占位符。
  GLM 不管理自身配置，Agent 不获取密钥值或代填；Codex 本地进程负责鉴权。
- GPT-6 在首次调用前核对端点与生效配置，并将非秘密配置身份和接入证据记入
  owning Tracker。模型/catalog 升级先用独立 trial 配置做相关验证，再成对采用或
  回退；除上述已授权额度接管外，不自动更换 provider、计费方案、模型或权限以消除错误。
- 规则、模板和接入说明不证明账户配置、GLM 调用或具体 feature 试点已完成。
  实际试点在被选中的已授权开发任务中记录，不另设状态系统。

该分工继续遵守既有 Acceptance Criteria，以及独立 Git/release 授权。

## Acceptance Criteria

- B-115/AC-01: 前向 contract test 同时证明 REQ-01 与 REQ-02：casual idea 零 repo 写入；明确记录或 promotion 场景只创建/复用最小 repo Backlog ID；项目内不存在 Linear Skill 路由。
- B-115/AC-02: review-only/no-file-changes 路由测试证明 repo、Archive 与外部系统均为零写入。
- B-115/AC-03: plan-and-implement、缺失 Plan/SDD bootstrap、零/多 Active Package continue 场景都有唯一模式与 stop point；archive collision fail closed。
- B-115/AC-04: 完整 lifecycle checker 对失效当前链接、无关 basename、外部 disposition、无 current
  入链 Archive、超出 `1 Now + 1 Next`、Feature Home 状态镜像、Active
  handoff/closeout、`T-xxx` 删除和不可用显式 baseline fail closed；同时允许删除
  baseline 无入链、无稳定身份的过程草稿。release checker 不读取上述 lifecycle 状态，
  且 focused workflow test 证明常规 CI 仍运行完整 `docs:check`、以 warning 报告
  finding，并继续执行后续 source/runtime gates。若使用已知 finding 基线，focused test
  还必须证明仅完整路径、内容摘要和逐字 finding 全匹配时通过；文件漂移、缺失、新错误、
  重复配置、glob/前缀和已修复但未清理的条目全部失败。
- B-115/AC-05: B-115 可从 docs index → Development index → Governance index/GOV-001
  定位；Tracker 独占执行状态与跨会话 handoff，Plan/SDD 按复杂度创建，`Validated`
  在缺少 closeout 授权时触发询问，已授权 full-lifecycle 则继续收尾；过程 artifact 吸收后默认删除，且不伪造 Product
  Decision/Product Spec provenance。
- B-115/AC-06: lifecycle skill 与前向 contract test 明确保护 named technical choice、
  derived product boundary 和 pre-implementation deviation approval；不得把 Agent 推断
  写成用户已确认事实，也不得以 post-hoc authority 为未询问的选择背书；事后处置不能
  回填或伪造事前批准。

## Traceability

| Requirement / AC | Design | Delivery evidence |
| --- | --- | --- |
| B-115/REQ-01 + B-115/REQ-02 / B-115/AC-01 | [Documentation Workflow — Capture](../documentation-workflow.md#1-capture-与-backlog) | [`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |
| B-115/REQ-03 / B-115/AC-02 | [Documentation Workflow — authorization](../documentation-workflow.md#自然语言入口与授权) | [`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |
| B-115/REQ-04 / B-115/AC-03 | [Documentation Workflow — Active Package](../documentation-workflow.md#3-active-package) | [`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |
| B-115/REQ-05 / B-115/AC-04 | [Documentation Workflow — validation](../documentation-workflow.md#验证门) | [`check-docs-script.test.ts`](../../../__tests__/check-docs-script.test.ts)、[`check-release-docs-script.test.ts`](../../../__tests__/check-release-docs-script.test.ts)、[`release-script.test.ts`](../../../__tests__/release-script.test.ts)、[`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |
| Engineering bootstrap / B-115/AC-05 | [Documentation Workflow](../documentation-workflow.md) | Current Governance index + focused contract tests |
| B-115/REQ-06 / B-115/AC-06 | [Documentation Workflow — authorization](../documentation-workflow.md#自然语言入口与授权) | [`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |

## Historical Validation

2026-09-07 的 Astra T-01–T-06 已验证，用户随后明确授权 closeout。有效规则由
本 contract 与 AGENTS/skills/Workflow 承接；独有来源、历史与新试点区别、成本
限制及最终治理验证保留于 [Astra workflow evidence](../../archive/2026/astra-feature-workflow-optimization-validation.md)。
原治理 Active Package 吸收后删除，本 GOV 保持 Current；历史证据不代替当前
执行授权，也不证明后续 Git 交付、量化提速、模型效果或发布。

## Authority And Change Boundary

- 2026-09-05 用户要求结合 [Astra 官方建议](https://developers.openai.com/api/docs/guides/latest-model) 审查并优化项目 AGENTS/skills。本次原位澄清已有授权的复用、完整请求的模式选择、只读与执行分流、按范围验证；不变更 PA 产品、Git/release 或数据权限。常规细节自主完成；新增权限、实质偏差和发布当前 turn 要求仍有效。
- 2026-09-07 用户在步骤 1 完成后要求“继续”，对应同会话分步任务的步骤 2：
  澄清最小修改并修正任务入口。本节吸收该范围内的工程准则；后续测试收敛、
  review 协作与模型试点仍须按后续步骤授权，不由本次修订自动实施。
- 2026-09-07 用户在步骤 2 完成后再次要求“继续”，授权步骤 3 的验证选择、
  证据复用和异常诊断规则及关联指引校准，停在步骤 4 之前；不涉及 runtime、
  模型配置、测试/部署命令变更或必要门禁减免。
- 2026-09-07 用户在步骤 3 完成后要求“继续”，授权步骤 4 的 review/followup
  与多 agent 验证调度规则、必要指引同步和既有 diff 的只读走查，停在步骤 5
  之前；不授权启动真实 feature 试点、调整模型或修改示例中的产品/工具代码。
- 2026-09-07 用户完成 T-05 真实图片体验试点并确认手动粘贴符合预期后，明确
  要求“继续完成 T-06”；吸收目标/方法区分、有边界的成本采样与跨 track 证据去重。
  既有输入失效、自然退出、实机/独立 review 与统一冻结 gate 保留；不据此宣布
  量化提速、调整模型、改变测试/部署命令或授权 Git/release/正式 closeout。
- Current governance authority: 本文件与 [Documentation Workflow](../documentation-workflow.md)。两者冲突时先修复 drift，不由 Product Decision Register 接管。
- Delivery authority: 本 contract、Documentation Workflow、当前 Skills、checker 与 focused contract tests；已吸收的 B-115 过程包不再作为 authority 保留。
- Product escalation: 任何实现若改变 PA runtime、用户行为、数据/隐私边界或 Obsidian UI，必须停止 governance-only lane，并进入 Accepted Product Decision + Approved Product Spec。
- Revisit trigger: 只有用户明确确认 repo-only intake 无法满足真实 planning/capture 需求时，才评估可选外部工具；它不得重新成为默认 gate。若 future change 改变 GOV-001 的 lifecycle authority，再建立 successor `GOV-xxx`。

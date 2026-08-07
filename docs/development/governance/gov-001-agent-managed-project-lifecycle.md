# GOV-001 — Agent-Managed Project Lifecycle

Document status: Current
Governance ID: GOV-001
Updated: 2026-08-07
Work item: B-115
Authority: PA 仓库的 repo-only idea intake、docs authority、Agent 自动维护、工程授权与信息连续性规则；不定义 PA runtime 或用户产品行为。

Bootstrap source: 用户于 2026-07-12 直接授权 docs/Agent/checker lifecycle remediation；2026-07-21 又明确取消 PA 项目内的 Linear Skill 与默认流程，并要求降低 Agent 的文档/token 维护负担；2026-08-04 要求将 Share Card 未经确认的技术选型和产品边界偏差吸收为项目规范与长期记忆；2026-08-07 明确决定版本发布不得强绑定项目文档状态。B-115 保持为该长期治理 contract 的稳定 ID。

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
  公开/发布关键文档，不得依赖 lifecycle status 或跨 tag 文档连续性。
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

## Acceptance Criteria

- B-115/AC-01: 前向 contract test 同时证明 REQ-01 与 REQ-02：casual idea 零 repo 写入；明确记录或 promotion 场景只创建/复用最小 repo Backlog ID；项目内不存在 Linear Skill 路由。
- B-115/AC-02: review-only/no-file-changes 路由测试证明 repo、Archive 与外部系统均为零写入。
- B-115/AC-03: plan-and-implement、缺失 Plan/SDD bootstrap、零/多 Active Package continue 场景都有唯一模式与 stop point；archive collision fail closed。
- B-115/AC-04: 完整 lifecycle checker 对失效当前链接、无关 basename、外部 disposition、无 current
  入链 Archive、超出 `1 Now + 1 Next`、Feature Home 状态镜像、Active
  handoff/closeout、`T-xxx` 删除和不可用显式 baseline fail closed；同时允许删除
  baseline 无入链、无稳定身份的过程草稿。release checker 不读取上述 lifecycle 状态，
  且 focused release test 证明常规 CI 仍保留完整 `docs:check`。
- B-115/AC-05: B-115 可从 docs index → Development index → Governance index/GOV-001
  定位；Tracker 独占执行状态与跨会话 handoff，Plan/SDD 按复杂度创建，`Validated`
  自动触发 closeout 询问，过程 artifact 吸收后默认删除，且不伪造 Product
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

## Authority And Change Boundary

- Current governance authority: 本文件与 [Documentation Workflow](../documentation-workflow.md)。两者冲突时先修复 drift，不由 Product Decision Register 接管。
- Delivery authority: 本 contract、Documentation Workflow、当前 Skills、checker 与 focused contract tests；已吸收的 B-115 过程包不再作为 authority 保留。
- Product escalation: 任何实现若改变 PA runtime、用户行为、数据/隐私边界或 Obsidian UI，必须停止 governance-only lane，并进入 Accepted Product Decision + Approved Product Spec。
- Revisit trigger: 只有用户明确确认 repo-only intake 无法满足真实 planning/capture 需求时，才评估可选外部工具；它不得重新成为默认 gate。若 future change 改变 GOV-001 的 lifecycle authority，再建立 successor `GOV-xxx`。

# GOV-001 — Agent-Managed Project Lifecycle

Document status: Current
Governance ID: GOV-001
Updated: 2026-07-21
Work item: B-115
Authority: PA 仓库的 repo-only idea intake、docs authority、Agent 自动维护、工程授权与信息连续性规则；不定义 PA runtime 或用户产品行为。

Bootstrap source: 用户于 2026-07-12 直接授权 docs/Agent/checker lifecycle remediation；2026-07-21 又明确取消 PA 项目内的 Linear Skill 与默认流程，并要求降低 Agent 的文档/token 维护负担。B-115 保持为该长期治理 contract 的稳定 ID。

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
- B-115/REQ-05: docs moves、deletions、Backlog removal、Closeout disposition 与 tag release 必须由可执行 gate 证明信息连续性；例行 turn 必须按任务读取最小当前 authority，不得默认预载或更新无变化的文档。

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
- B-115/AC-04: checker 对失效当前链接、无关 basename、外部 disposition、无 current 入链 Archive、`T-xxx` 删除和无 baseline tag release fail closed；Skill forward test 证明模板、Archive 和全量索引不会在例行 turn 被默认预读。
- B-115/AC-05: B-115 可从 docs index → Development index → Governance index/GOV-001 定位；Tracker 独占执行状态，Plan/SDD 按复杂度创建，过程 artifact 吸收后默认删除，且不伪造 Product Decision/Product Spec provenance。

## Traceability

| Requirement / AC | Design | Delivery evidence |
| --- | --- | --- |
| B-115/REQ-01 + B-115/REQ-02 / B-115/AC-01 | [Documentation Workflow — Capture](../documentation-workflow.md#1-capture-与-backlog) | [`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |
| B-115/REQ-03 / B-115/AC-02 | [Documentation Workflow — authorization](../documentation-workflow.md#自然语言入口与授权) | [`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |
| B-115/REQ-04 / B-115/AC-03 | [Documentation Workflow — Active Package](../documentation-workflow.md#3-active-package) | [`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |
| B-115/REQ-05 / B-115/AC-04 | [Documentation Workflow — validation](../documentation-workflow.md#验证门) | [`check-docs-script.test.ts`](../../../__tests__/check-docs-script.test.ts)、[`pa-docs-lifecycle-skills.test.ts`](../../../__tests__/pa-docs-lifecycle-skills.test.ts) |
| Engineering bootstrap / B-115/AC-05 | [Documentation Workflow](../documentation-workflow.md) | Current Governance index + focused contract tests |

## Authority And Change Boundary

- Current governance authority: 本文件与 [Documentation Workflow](../documentation-workflow.md)。两者冲突时先修复 drift，不由 Product Decision Register 接管。
- Delivery authority: 本 contract、Documentation Workflow、当前 Skills、checker 与 focused contract tests；已吸收的 B-115 过程包不再作为 authority 保留。
- Product escalation: 任何实现若改变 PA runtime、用户行为、数据/隐私边界或 Obsidian UI，必须停止 governance-only lane，并进入 Accepted Product Decision + Approved Product Spec。
- Revisit trigger: 只有用户明确确认 repo-only intake 无法满足真实 planning/capture 需求时，才评估可选外部工具；它不得重新成为默认 gate。若 future change 改变 GOV-001 的 lifecycle authority，再建立 successor `GOV-xxx`。

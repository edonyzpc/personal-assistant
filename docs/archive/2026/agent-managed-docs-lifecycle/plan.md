# Agent-Managed Docs Lifecycle Delivery Plan

Document status: Archived
Updated: 2026-07-12
Work item: B-115
Authority: 本 track 的历史交付顺序、依赖、风险、验证策略与 stop point。
Governance contract: [GOV-001 Agent-Managed Project Lifecycle](../../../development/governance/gov-001-agent-managed-project-lifecycle.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

修复 docs 重构 review 中已确认的信息连续性、checker/CI fail-open 和 Agent
路由冲突。保持现有 runtime 与 Linear workspace 不变，不执行 Git 或 release
写入。

## Dependencies And Source Surface

- `scripts/check-docs.mjs`、`__tests__/check-docs-script.test.ts`、release workflow/tests。
- `docs/development/documentation-workflow.md`、templates、Disposition Log 与迁移后的 guides/assets。
- `pa-docs-lifecycle-manager`、`pa-linear-product-manager`、`sdd-lifecycle` 及其 agent metadata。
- Governance/Active/Archive indexes 和当前 dirty worktree；所有修改保持 scoped。

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P1 Contract | GOV-001 与 Active Package 成为 engineering authority | development governance docs | `docs:check` 可发现全部入口 | Continue |
| P2 Integrity | 修复断链、Disposition、Closeout 与 release baseline | docs/checker/CI/tests | adversarial focused tests pass | Continue |
| P3 Agent routing | 固化 Linear-first、no-write、resume 与 archive collision | repo skills/forward tests | routing contract tests pass | Continue |
| P4 Review/validate | 并行复审并同步 Tracker | scoped diff | 无未解决 P0/P1/P2；focused gates pass | Stop at Validated; no closeout/commit |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| checker 误报现有合法 moves | 对抗测试覆盖 staged/untracked move 与 disposition | `DOCS_CHECK_BASE=2.8.4 npm run docs:check` | 收窄匹配，不恢复 basename-only |
| Skill 文案仍有重叠授权 | 单一 state machine + static forward tests | focused Jest + manual source review | 选择更早、更窄的 stop point |
| 覆盖用户 dirty changes | 文件分区并行、focused diff | `git status`/targeted diff | 只回退本 track 新增行，禁止 destructive Git |
| archive 冲突覆盖证据 | move 前目标 preflight、存在即 fail closed | routing test/docs check | 保留 Active Package 并请求一次范围决定 |

## Validation Strategy

- Focused tests: checker/release/skill routing Jest suites。
- Type/lint/build gate: docs/tooling only；`node --check`、`npm run docs:check`、`git diff --check`，不运行 runtime build。
- Obsidian smoke: skipped；无 runtime/UI 变化。
- Real-device / community / release gate: not applicable；未授权 release。

## Approval

- Plan authority: 用户于 2026-07-12 直接授权 engineering lifecycle remediation，并选择 Linear-first；B-115 是直接 bootstrap，不宣称来自 Linear promotion。
- Approved on: 2026-07-12
- Authorized implementation scope: docs、repo skills、checker、focused tests 与 release workflow；无 Git commit/push/tag/publish。
- Closeout authority: 用户于 2026-07-12 明确要求“收尾”；不包含 Git commit/push/tag/publish。

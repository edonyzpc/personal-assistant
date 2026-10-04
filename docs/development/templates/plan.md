# <Feature> Delivery Plan

Document status: Draft
Updated: YYYY-MM-DD
Work item: B-xxx
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: <repo-local product spec path>
Governance contract: <Current GOV-xxx path for L2G; delete Product spec line>
Tracker: [Development Tracker](./tracker.md)

仅在多阶段、依赖、风险、回滚或跨会话交付需要独立计划时创建本文件。

## Goal And Non-goals

## Dependencies And Source Surface

列出已用 `rg` 验证的文件、类型、设置、命令与测试入口。

## Phases

PA Agent/runtime/command 工作先按 [统一架构](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
完成职责符合性审视，再安排公共框架与领域切片；职责表引用SDD/现有任务记录，不重复维护。

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |

## Validation Strategy

- Focused tests:
- Type/lint/build gate:
- Obsidian smoke:
- Real-device / community / release gate:

## Approval

- Plan authority:
- Approved on:
- Authorized implementation scope:

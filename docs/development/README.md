# Development 文档

本目录服务于“需求澄清 → 产品或工程治理契约 → 开发 → 验证 → closeout”的执行过程。完整权威规则见 Documentation Workflow。

## 必读 workflow

- [Documentation Workflow](./documentation-workflow.md) — 文档创建、更新、归档与删除规则。
- [Templates](./templates/README.md) — Discovery、Decision、Product Spec、Governance Contract、Feature Home、Plan、SDD、Tracker 与 Closeout 模板。
- [Reusable Refactor Workflow](./workflows/refactor-workflow.md) — repo-scale refactor 的 phase loop。
- [Pagelet SDD Guide](./workflows/pagelet-sdd-guide.md) — Pagelet feature 的设计与交付规范。
- [Post-implementation Review Checklist](./workflows/pa-spec-post-impl-review-checklist.md) — Spec 实现后校准。
- [UI/UX Review Framework](./workflows/pa-ui-ux-review-framework.md) — 可复用 UI/UX 审计方法。

## 验证

- [Pagelet Manual Smoke Checklist](./validation/pagelet-smoke-checklist.md)
- [Pagelet v2.9 LLM Validation Handoff](./handoff-pagelet-v29-validation.md) — LLM 集成端到端验证清单（Codex 执行）

## Discovery 与 Decision

- [Discovery Registry](./discovery/README.md) — 需要跨会话讨论、研究或方案选择的活跃主题。
- [Decision Index](../product/decisions/README.md) — Accepted/Deferred/Rejected/Superseded 的 repo-local 决策入口。

## Engineering Governance

- [Governance Registry](./governance/README.md) — repo docs lifecycle、Agent workflow、checker、CI/release tooling 与工程授权边界；不定义 PA runtime 或用户产品行为。

## Proposal

- [Proposal Registry](./proposals/README.md) — 仅保存已形成完整边界、但尚未获准进入产品/runtime 的长期 proposal。

## Active

当前状态见 [Active Registry](./active/README.md)。新 Product feature 获得批准，或 L2G governance/tooling contract 进入跨会话执行后，在 `active/<feature>/` 创建：

```text
docs/development/active/<feature>/
  README.md
  plan.md
  tracker.md
  sdd.md      # SDD phase 创建；实现前必须 Approved
```

完成或取消时再创建 `closeout.md`，然后把整个包移动到 `docs/archive/<year>/<feature>/`。不要长期保留 Closed/Cancelled 的 active package。

# DEC-016 — Defer The Hosted Premium Layer

Decision ID: DEC-016
Status: Deferred
Updated: 2026-07-12
Authority: PA 托管模型、付费 entitlement 与商业服务边界。
Work item: B-114

## Context

当前客户端以 BYOK 为主。托管 Premium 涉及 Terms、privacy、billing、entitlement、服务成本和法律 review；在 Lite/BYOK 需求未验证前提前建设会扩大产品与合规面。

## Decision

延期 hosted/Premium service layer。先验证 Free/Lite BYOK 的真实需求与付费意愿；在 B-114 的产品、隐私、计费、entitlement 与 counsel gate 完成前，不加入账号、license key、checkout、hosted model 或付费锁。

## Consequences

- 当前版本不能把历史商业分析写成已批准 roadmap。
- Client feature 设计继续遵循本地优先与现有 provider boundary。
- 商业研究可以更新，但只有新的 Decision 能改变产品契约。

## Revisit Trigger

[Backlog B-114](../../backlog.md) 的需求验证与所有 service/compliance gate 满足。

## Traceability

- [Commercialization Analysis](../../archive/pa-commercialization-analysis-2026-07-08.md)
- [Active Decision Register](../active-decisions.md)

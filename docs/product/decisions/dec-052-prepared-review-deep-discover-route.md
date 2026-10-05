# DEC-052 — Open prepared review 沿用深度发现路由

Decision ID: DEC-052
Status: Accepted
Updated: 2026-10-06
Authority: Owner 在本次文档整理中明确选择“接受当前深度发现路由，更新产品约定”；批准自本日生效，不回填为旧实现或旧验收时已经批准。
Work item: B-162

## Context

当前 [Pagelet Product Design](../pagelet-product-design.md) 及旧 Prepared Panel 场景
将 `Open prepared review` 写成零新增 provider 调用；但
[实际命令回调](../../../src/pagelet/orchestrator.ts) 的 `openPreparedReview()` 调用
`runExplicitDeepDiscover()`。该路由由 commit `4ae5a488a` 于 2026-07-31 引入。
文档整理确认了这一差异，未将代码现状或后续测试当成用户批准的证据。

## Options Considered

| Option | Benefits | Costs / risks | Outcome |
| --- | --- | --- | --- |
| 保留差异，后续再决定 | 不改变既有约定或代码 | 入口仍与零调用说明不一致 | 未选择 |
| 恢复零调用入口 | 恢复旧的查看缓存语义 | 需要单独修复代码并处理已退役 Prepared Panel 的呈现 | 未选择 |
| 接受当前深度发现路由 | 保持现有命令行为，与统一发现入口一致 | 允许该手动入口按当前发现规则调用服务商并使用额度 | Owner 选择 |

## Decision

1. `Pagelet: Open prepared review` / `拾页：打开已准备的审阅` 保留名称与 ID，
   作为以活动 Markdown 笔记为起点的显式 Deep Discover 兼容入口，取消其零调用承诺。
2. 该入口可能读取允许范围内的笔记并发送给已配置的服务商，使用 API 额度；
   是否复用有效结果或实际启动调用，以现有发现准入和缓存事实为准，不保证每次调用。
3. [DEC-051](./dec-051-proportionate-confirmation-and-contract-alignment.md) 的手动/自动
   预算、必要确认及来源边界不变：手动请求不扣自动额度池，不绕过排除、权限、
   配置、取消或实际服务可用性。
4. `Pagelet: Open Pagelet` / `拾页：打开拾页面板` 仍是单独的零 provider 调用面板入口。
   本决定不恢复 generic preload / Prepared Panel，不授予任何笔记写入权限。

## Consequences

- 仅局部接续旧 `Open prepared review` 的缓存查看/零调用约定；其他历史场景与验收
  保留原判定，不能据此改记为当时已批准或当前 app 验证通过。
- 当前代码已有此路由，本次只更新产品文档、使用说明和索引，未修改运行代码，
  不新增模型、设备、远端 CI 或发布验证结论。
- B-162 的这项文档差异已由 Owner 决定与当前契约吸收，不留为未完成 Backlog。

## Revisit Trigger

用户需要只查看缓存且避免 provider 请求，或现有兼容名称持续造成费用/行为误解时，
再决定独立入口或文案调整。恢复零调用需要新决定及对应代码修订，不以本次整理自动回滚。

## Traceability

- [Pagelet Product Design](../pagelet-product-design.md)
- [Bubble Readiness Product Spec](../specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- [UI/UX Hardening Product Spec](../specs/pagelet-ui-ux-hardening-product-spec.md)
- [Current user guide](../../guides/pagelet-user-guide.md)
- [DEC-035 existing-route boundary](./dec-035-bounded-cleanup-and-pagelet-scope-retirement.md)
- [DEC-051 confirmation and budgets](./dec-051-proportionate-confirmation-and-contract-alignment.md)

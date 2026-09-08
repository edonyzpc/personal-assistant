# DEC-033 — Simple Settings And Unified Defaults

Decision ID: DEC-033
Status: Accepted
Updated: 2026-09-08
Authority: Owner 于 2026-09-08 认可设置简化分析，并明确选择长期记忆提取与习惯学习分别主动开启；旧用户被撤销的关闭选项作为无效选项去除，统一按新定义运行，不保留产生歧义的兼容行为。
Work item: B-106

## Context

Settings 已有分组和折叠，但仍把必要实现机制、用户偏好、数据权限和维护操作
混在同一层。Pagelet 暴露模型参数；Memory 可跳过必要准备判断；旧后台开关可
影响当前手动发现。只隐藏控件或更改新安装默认值，不能解决旧值继续参与运行
造成的功能缺失。

本决定确立设置重设计的产品范围；运行时交付另以实现和验证证据为准。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 只增加折叠或高级模式 | 改动小 | 用户仍需管理内部机制，旧值继续改变行为 | 不采用 |
| 简化设置，同时把旧关闭值迁移为仅关闭后台 | 保留历史偏好 | 无法可靠区分旧值来源，继续引入行为分支 | Owner 明确不采用 |
| 必要机制内置，撤销的旧开关无效，新旧用户按同一契约运行 | 功能完整、规则一致、维护负担低 | 某些旧关闭值不再阻止必要或默认后台调用 | Owner 选择；范围限定于本次撤销项 |

## Decision

1. 用户选择 PA 做什么、使用哪些内容及何时主动出现；必要模型调用、正常准备
   流程和内部技术参数由产品负责。删除普通设置不等于移除内部预算、取消、
   失败恢复或数据校验。
2. 设置按 AI 连接、使用偏好、笔记与隐私、高级与维护组织。常用选择直接可达，
   专业定制和维护按需展开，功能现场更适合的选项放回对应功能。
3. 长期记忆提取与本地习惯学习分别默认关闭、由用户主动开启。普通首次告知
   不等于启用；已有有效的独立启用继续有效。开启长期提取后仍按既有 effect/risk
   契约自动处理，不增加逐条确认，不影响首次笔记 Memory 的 DEC-028 路径。
4. 对本次撤销的旧开关，旧值一律无效，不推断旧用户意图、不迁移为“仅后台关闭”，
   不保留 grandfather 分支，也不通过额外确认恢复旧语义。新旧用户采用相同的新
   默认与执行规则；用户仍可使用新页面保留的有效产品控制。
5. 上述旧值规则明确覆盖旧 Pagelet `preloadEnabled`、原 `deepDiscoverEnabled`
   功能关闭语义，以及被撤销的 `memoryAutoCheckBeforeChat` 技术开关。前两项旧
   `false` 不再阻止手动发现或按新定义默认开启的有界后台发现；后台暂停由新定义
   的独立控制承担。其他撤销字段必须在实施设计中逐项列明，不能通过前缀或
   “所有历史 false”批量删除有效设置。
6. 保留真实数据范围、Memory 能力选择、长期学习的有效授权、当前提示偏好、
   自定义服务商/模型、写入与外部行为权限。它们不属于废弃开关。内部检索回滚
   flags、平台 mask、provider/token 和 durable Memory 状态也不在清理授权内。

## Scoped Supersession

- 取代 [B-123 T5](../../development/proposals/pagelet-agent/pagelet-agent-deep-discover-sdd.md#10-t5--cost-and-settings)
  对旧 `preloadEnabled` 的继承和原 Deep Discover 总开关语义；必要调用、现有内部
  预算、来源边界及质量门继续适用。
- [DEC-023](./dec-023-shared-pagelet-provider-first-use.md) 对历史 opt-out 的保留义务，
  不再适用于本决定明确撤销的开关；provider trust、共享首次透明告知、仍有效的
  能力控制和高风险确认保持原边界。旧 Recap 专属流程不因本次设计恢复生产使用。
- 对 [DEC-005](./dec-005-memory-governance.md) 的自动提取原则明确前提：先由用户
  主动开启长期提取，再自动处理合格内容。低负担治理、来源、纠正和撤销原则不变。
- 本决定不覆盖 DEC-027/DEC-031 的算法、内部 rollout 或平台支持约束。

## Consequences

- 去除旧关闭值意味着升级后默认后台发现可能恢复运行并产生既有预算内的模型
  调用；这是 Owner 本轮明确选择的行为，不描述为兼容保留历史关闭偏好。
- 废弃字段不参与新行为计算，并在设置规范化/后续持久化时去除；只删除界面不足以
  满足契约。不得因此触发额外 provider 请求、整库重建、删除源笔记或重置治理记录。
- 回滚采用版本级修复，不在当前运行时恢复废弃字段的双轨解释。有效用户设置和
  源数据保持可用；需要重新引入旧产品选择时另作明确决定。

## Revisit Trigger

统一默认造成可复现的异常调用成本、功能缺失或错误扩大了数据/写入权限时，
修正相应策略；新设置再次要求用户理解内部阶段时，重新检查职责边界。

## Traceability

- Product Spec: [Simple Settings](../specs/pa-simple-settings-product-spec.md)
- Product standard: [North Star](../pa-product-north-star.md)
- Current implementation entry: [Settings status](../../architecture/settings-status.md)
- Development entry: [B-106 Feature Home](../../development/active/simple-settings/README.md)

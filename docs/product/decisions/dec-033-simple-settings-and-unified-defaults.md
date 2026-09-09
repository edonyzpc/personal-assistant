# DEC-033 — Simple Settings And Unified Defaults

Decision ID: DEC-033
Status: Accepted
Updated: 2026-09-09
Authority: Owner 于 2026-09-08 认可设置简化及明确撤销项的统一行为；于 2026-09-09 在 B-135 讨论中将长期记忆提取与本地习惯学习改为分别默认开启，无需逐项主动启用，同时保留各自关闭、暂停和管理。新决定覆盖前一日的默认关闭选择，不追溯改写历史授权。
Work item: B-106

## Context

Settings 已有分组和折叠，但仍把必要实现机制、用户偏好、数据权限和维护操作
混在同一层。Pagelet 暴露模型参数；Memory 可跳过必要准备判断；旧后台开关可
影响当前手动发现。只隐藏控件或更改新安装默认值，不能解决旧值继续参与运行
造成的功能缺失。

本决定确立设置重设计的产品范围；运行时交付另以实现和验证证据为准。

2026-09-08 的选择是长期提取与习惯学习默认关闭、独立主动开启。Owner 于
2026-09-09 明确修订为默认开启，以满足功能需要、减少用户为获得基础能力管理
多个开关的负担。本次修订是新的产品契约；当前源码仍采用旧默认和 consent 准入，
本修订的后续默认、准入、迁移、实现与验证全部由 [B-135 Tracker](../../development/active/unified-task-execution/tracker.md) 承接，长期产品选择归 [DEC-034](./dec-034-unified-agent-task-execution.md)；B-106 原交付证据不重写、不重开，不把文档更新称为运行时已生效。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 只增加折叠或高级模式 | 改动小 | 用户仍需管理内部机制，旧值继续改变行为 | 不采用 |
| 简化设置，同时把撤销清单内的旧关闭值迁移为仅关闭后台 | 保留历史偏好 | 无法可靠区分旧值来源，继续引入行为分支 | Owner 于 2026-09-08 明确不采用；不扩展到有效的学习关闭或暂停 |
| 必要机制内置，撤销的旧开关无效，新旧用户按同一契约运行 | 功能完整、规则一致、维护负担低 | 某些旧关闭值不再阻止必要或默认后台调用 | Owner 选择；范围限定于本次撤销项 |
| 长期提取与习惯学习默认关闭、逐项主动开启 | 启用动作明确 | 获得功能需要额外管理 | 2026-09-08 的历史选择；已被 2026-09-09 修订覆盖 |
| 长期提取与习惯学习分别默认开启，保留独立关闭和透明管理 | 功能按需可用，减少开关协调 | 既有调度可能产生提取调用和本地学习，关闭与暂停必须可靠 | Owner 于 2026-09-09 选择；旧值迁移机制仍需字段级设计 |

## Decision

1. 用户选择 PA 做什么、使用哪些内容及何时主动出现；必要模型调用、正常准备
   流程和内部技术参数由产品负责。删除普通设置不等于移除内部预算、取消、
   失败恢复或数据校验。
2. 设置按 AI 连接、使用偏好、笔记与隐私、高级与维护组织。常用选择直接可达，
   专业定制和维护按需展开，功能现场更适合的选项放回对应功能。
3. 长期记忆提取与本地习惯学习分别默认开启，无需逐项主动启用；首次使用透明
   说明，并分别提供关闭、暂停、清除/遗忘和管理。实际运行仍满足既有调度、预算、
   来源与 effect/risk 治理；默认开启不代表每轮都提取，不增加逐条确认。用户改变
   其中一项不联动另一项，不影响首次笔记 Memory 的 DEC-028 路径。
4. 对 2026-09-08 明确撤销的旧开关，旧值一律无效，不推断旧用户意图、不迁移为“仅后台关闭”，
   不保留 grandfather 分支，也不通过额外确认恢复旧语义。新旧用户采用相同的新
   默认与执行规则；用户仍可使用新页面保留的有效产品控制。
5. 上述旧值规则明确覆盖旧 Pagelet `preloadEnabled`、原 `deepDiscoverEnabled`
   功能关闭语义，以及被撤销的 `memoryAutoCheckBeforeChat` 技术开关。前两项旧
   `false` 不再阻止手动发现或按新定义默认开启的有界后台发现；后台暂停由新定义
   的独立控制承担。其他撤销字段必须在实施设计中逐项列明，不能通过前缀或
   “所有历史 false”批量删除有效设置。
6. 保留真实数据范围、Memory 能力选择、长期学习的有效关闭/暂停和已有治理记录、当前提示偏好、
   自定义服务商/模型、写入与外部行为权限。它们不属于废弃开关。内部检索回滚
   flags、平台 mask、provider/token 和 durable Memory 状态也不在清理授权内。
   默认开启长期提取不联动 `includeVaultInsights`，不新增高风险权限；生成、改稿、
   保存和本次指令不自动成为长期风格，显式风格授权仍独立有效。
7. 默认开启的准入依据是产品策略，不能伪造用户点击确认、`confirmed` 或
   `confirmedAt`。有效默认在真正触发时不能再被旧的“未逐项确认”准入压回关闭；
   真实用户关闭/暂停也不能被普通保存、重载或另一项偏好修改复活。迁移需要区分
   旧默认 `false` 与真实关闭/暂停。Owner 于 2026-09-09 在
   [DEC-034 D8](./dec-034-unified-agent-task-execution.md) 补充确认：无明确用户关闭
   证据的旧 `false`（含来源不明）采用新默认开启；明确关闭或有效暂停保留。
   该产品策略不证明用户过去曾授权，迁移字段与验证统一由 B-135 跟踪。

## Scoped Supersession

- 取代 [B-123 T5](../../development/proposals/pagelet-agent/pagelet-agent-deep-discover-sdd.md#10-t5--cost-and-settings)
  对旧 `preloadEnabled` 的继承和原 Deep Discover 总开关语义；必要调用、现有内部
  预算、来源边界及质量门继续适用。
- [DEC-023](./dec-023-shared-pagelet-provider-first-use.md) 对历史 opt-out 的保留义务，
  不再适用于本决定明确撤销的开关；provider trust、共享首次透明告知、仍有效的
  能力控制和高风险确认保持原边界。旧 Recap 专属流程不因本次设计恢复生产使用。
- 2026-09-09 修订覆盖本决定及 [DEC-005](./dec-005-memory-governance.md) 于
  2026-09-08 加入的“默认关闭、先主动开启”前提。当前规则为默认开启、独立退出，
  低负担治理、来源、纠正、撤销与高后果权限保持原边界；旧决定日期和来源保留。
- 同时覆盖[DEC-021](./dec-021-evidence-led-pagelet-ui-ux-hardening.md)与
  [Retrieval Habit Profile Spec](../specs/pa-retrieval-habit-profile-product-spec.md)
  中旧的默认关闭/启用确认要求；不改变本地、可清除、弱影响及精确candidate反馈边界，
  不把新默认回填为B-118已经验证的行为。
- 本决定不覆盖 DEC-027/DEC-031 的算法、内部 rollout 或平台支持约束。

## Consequences

- 去除撤销清单内的旧关闭值意味着升级后默认后台发现可能恢复运行并产生既有
  预算内的模型调用；这是 2026-09-08 的明确选择，不适用于有效的学习关闭/暂停。
- 长期提取与本地习惯学习默认开启后，在真实触发与既有准入满足时运行；首次
  说明、字段迁移或普通设置保存本身不触发额外提取、回填学习或整库重建。
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
- Dated amendment source: [B-135 discussion and Solution Brief](../../development/discovery/pa-agent-unified-task-execution.md)
- Current implementation entry: [Settings status](../../architecture/settings-status.md)
- Original development entry: [B-106 Feature Home](../../development/active/simple-settings/README.md)
- New default/migration implementation: [B-135 Feature Home](../../development/active/unified-task-execution/README.md)，不向原 B-106 Tracker 新增任务。

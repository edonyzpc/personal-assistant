# DEC-058 — Chat 内可解释的 THINKING 过程

Decision ID: DEC-058
Status: Accepted
Updated: 2026-10-10
Authority: Owner 在本轮原型讨论中明确要求 THINKING / reasoning 命名、中英文默认跟随系统、保留原动画与显示耗时，并以“按照推荐组合设计”接受下列组合；2026-10-10 接受独立审查的精简建议后，明确授权按 B-168 完成全部开发测试，验收后又明确授权 closeout 和本地 master 提交。推送和发布需独立授权。
Work item: B-168

## Context

Chat 现有状态区不能清楚保留调用过程、整轮耗时和当前供应商 reasoning。用户需要在回答旁按需理解执行事实，必要时再进入 Debug，符合 [安静且可信](../pa-product-north-star.md) 的产品标准。

以本地 `fd84db15` 为源码复核基线：Chat 仍将 provider reasoning 替换为隐藏提示，活动摘要最多保留六项；现有 THINKING 无计时。DEC-057 的完整 Debug 已交付，但 Chat 外部入口只传 conversationId，尚不具备按消息/调用精确定位的接线。历史分析与独立模拟原型不是当前实机验收。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 仅保留短状态，全文只进 Debug | 最少界面改动 | 当前 Chat 无法直接查看实际 reasoning，历史过程与等待时间仍难理解 | 不满足用户已明确的体验 |
| 在 Chat 复制完整运行日志并加入重型组件库 | 信息集中 | 第二套全文存储、界面噪声与技术迁移增加维护成本 | 不采用 |
| 原位细轨道、整轮计时、当前 reasoning、轻量过程历史、全文沿用 Debug | 按需解释过程，复用现有事实和数据所有者 | 需补稳定身份、终态与清理接线 | Owner 已选择 |

## Decision

1. 沿用现有 Chat 视觉与 DOM，外层固定名 `THINKING`，内层固定名 `reasoning`；默认折叠。展开采用细轨道，保留 PA 原粒子，仅在本轮执行时动画。用户展开选择不被新事件或完成重置。
2. 显示本次 Chat 执行总耗时，包含准备与等待；终态冻结并保留。不是模型内部思考时长，不累加并行节点，不计入本轮结束后的用户等待，不为旧历史补造时间。
3. 当前 Chat 即使 Debug 关闭，也能查看实际收到的 reasoning；仅保留当前视图所需内存。关闭或重开后的全文依赖既有 Debug 记录，不增加 Chat 全文副本。
4. Chat 历史仅补充步骤、结果、可信耗时等新增事实，来源和操作按既有身份引用，复用原记录的名称、状态和清理关联；不保存第二套相同事实。成功、失败、停止均接入既有持久化链路，旧记录诚实降级，清理纳入现有删除/Forget 所有者。
5. 状态来自真实执行事实，领域效果来自既有领域 owner 与回执。来源区分发现、读取、进入请求和被引用；工具成功不等于用户目标完成。必要动作留在折叠区外。
6. 中英文默认跟随系统，固定名称保持英文，reasoning 原文不翻译。使用当前主题、图标和布局；不迁移整个插件的语言机制。
7. 沿用 Debug 的本地完整文本、容量、期限、凭据过滤和媒体仅引用边界；新记录保存真实 Debug 引用并直接定位。旧记录或缺引用记录提示无法精确定位，仍可打开已有目标运行或会话；不新增历史搜索来恢复关联，不另建执行协议、存储引擎或模型摘要请求。

## Consequences

- Product behavior: [Product Spec](../specs/pa-chat-thinking-process-product-spec.md) 持有完整交互、状态与验收标准。显示供应商文本不保证获得其全部内部思维过程。
- Architecture / data / safety: 接续 [DEC-055](./dec-055-agent-snapshot-execution-and-debug-history.md) 与 [DEC-057](./dec-057-agent-debug-explorer.md)，不改变运行权限、业务效果、快照执行或取消语义。新增展示字段不自动进入后续 Prompt、Memory、分享、导出或同步。
- Compatibility / migration: 新摘要为可选字段，旧 activityDetails 不伪造身份或时间；不回填历史、不清空数据库。明确清理后迟到读取/保存不得复活内容。
- Work completed: 产品设计、实施、测试及 repo-local test vault 运行验收已接受，并经 Owner 授权 closeout。稳定接线吸收到当前架构；历史证据保留其受控夹具和环境限制，不据此宣称远程 CI、日常 vault 部署或发布。

## Revisit Trigger

若需要 Debug 关闭时跨重启保存 reasoning 全文、跨设备同步、全文搜索、外部观测服务、独立后台任务面板或新的执行/恢复动作，再提出独立产品决定。实际长会话出现可复现的卡顿时再评估额外性能机制。

## Traceability

- Product Spec: [Chat THINKING](../specs/pa-chat-thinking-process-product-spec.md)
- Architecture: [Chat THINKING 接线](../../architecture/pa-agent-debug-view.md#chat-thinking-投影与持久化)
- Historical validation: [B-168 最终验证](../../archive/2026/b168-chat-thinking-process-validation.md)
- Supersedes: 无整份决定替代；仅新增 Chat 过程呈现，既有 Debug、执行及领域权限继续有效。

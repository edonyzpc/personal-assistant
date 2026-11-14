# Memory Preparation Lifecycle Product Spec

Document status: Approved
Updated: 2026-11-14
Work item: B-197
Decision: [DEC-080](../decisions/dec-080-memory-preparation-lifecycle.md)
Authority: 本切片的 Chat 准备、进度恢复、状态和终态契约；延续 Memory Control Center 与 DEC-028，其余行为不变。

## Problem And Product Outcome

获准 Memory 准备可靠运行，用户可以忽略或重看进度，并知道完成、失败或中断的真实结果。Chat 无需等待整轮准备，符合安静且可信的原则。

## Scope

- B-197/REQ-01：Chat 确认在短检索预算之外；确认后由 Manager 后台准备，当前回答按实际可用 Memory 继续。
- B-197/REQ-02：准备与检索 attempt 生命周期分离，保留真实 Stop、共享消费者、配置失效、关闭和卸载语义。
- B-197/REQ-03：准备前验证来源、配置和批准；restricted source 只用已有 Memory；Pagelet、旧直接调用、first-use 和手动入口兼容。
- B-197/REQ-04：运行中状态优先；可重看进度；重复相容命令复用，观察不获得共享所有权。
- B-197/REQ-05：进度使用真实阶段和已处理文件数；完成、部分完成、失败、取消、中断可区别并在当前进程/配置重看。
- B-197/REQ-06：索引副作用继续经 VSS 独占队列；durable admission 前不宣布 Ready，失败保留恢复状态，不改笔记。

### Non-goals

持久任务日志、预计剩余时间、全局百分比、暂停/续建、独立任务中心、全量准备独立停止按钮、Pagelet 新行为、索引格式迁移及额外真实模型采样。

## User Flow And States

Chat 需要 Memory → 检查本次允许来源和当前状态 → 必要时确认 → 准备开始并立即返回准确提示 → Chat 本次继续。合法旧 Memory 仍可用时不把它标成不可用。

Chat Memory 标签在 preparing 时显示准备中，菜单主项为查看进度；原 Status 入口保留。关闭通知只隐藏；再次查看重新展示最新阶段。终态通知只发一次，结果可从状态入口重看。桌面与移动窄屏共享语义，不增加特殊动画。

按 Owner 于 2026-11-13 的续接要求，Prepare Memory 通知保留原卡片、三点动画、标题和单行阶段计数展示，恢复 `Preparing notes` / `Saving memory` 阶段标签；计数使用真实文件数，不把片段数当作笔记数。关闭/重看仅扩展展示生命周期，不重新设计通知。

活跃 Chat Stop 取消独占准备；正常回答结束不取消；共享工作保留现有消费者规则。观察不改变共享状态。重启后仅据已有 guard 说明上次未完成，不伪造历史原因。

## Trust, Data And Authority

Data / AI provider / Cost 确认保持，DEC-028 唯一首次例外不扩大。确认接受后、任何 reset/provider effect 前重新核验来源、配置和生命周期；迟到确认不能产生副作用。准入成功后准备按 Manager 的独立批准与持续数据边界存活，不能被正常 run-current 结束撤销。

结果仅保存在当前进程、当前配置，使用安全产品消息和必要计数，不存正文、密钥或完整内部 VSS summary。Markdown 保持源真相。

## Acceptance Criteria

- B-197/AC-01：确认等待越过旧短检索预算仍可正常决定；批准后立即返回准备中，长准备不投影为检索超时。
- B-197/AC-02：attempt/正常结束不取消准备；真实 owner Stop 取消独占准备；已有共享消费者时单方取消不终止工作。
- B-197/AC-03：确认期间来源/配置失效，接受后 reset/provider 次数为零；restricted 不触发全库准备；ready 检索不因缺少准备 owner 被拒绝，旧调用/Pagelet 既有语义不变。
- B-197/AC-04：active 状态不被异步旧 plan 覆盖；关闭后重看最新进度；重复 Prepare/Update 不新增重建，Status/查看不改变 consumer。
- B-197/AC-05：已处理数不冒充成功数，动态片段数不冒充笔记总数；部分完成、失败、明确取消及非用户中断准确，结果可重看且终态不重复。
- B-197/AC-06：只在真实准入成功后显示 Ready；取消/失败保留已有 guard 补偿，旧 run 不关闭新 run 展示或发布旧结果；笔记不变。

## Open Decisions

无。Owner 已选择 A 并授权实施；新增产品范围另行决定。

## Implementation And Validation

- [B-197 最终验证](../../archive/2026/b197-memory-preparation-lifecycle-validation.md)
- [SQLite architecture](../../architecture/vss-sqlite-wasm-architecture.md)、[Refresh](../../architecture/vss-embedding-refresh.md)
- 本地实施及必要验收已完成；Owner于2026-11-14明确授权收尾、提交并推送远程master，不包含版本发布。原卡片外观已用GitHub实际3.0.6附件核对，计数改为真实文件数；诊断卡裁切观察另见[T-014](../../backlog.md#触发型评估)。

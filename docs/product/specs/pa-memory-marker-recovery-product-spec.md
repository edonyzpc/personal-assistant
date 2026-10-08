# Memory Marker Recovery Product Spec

Document status: Approved
Updated: 2026-10-08
Work item: B-164
Decision: [DEC-054](../decisions/dec-054-memory-marker-recovery.md)
Authority: 本次已确认的稳定产品范围与验收目标；实际技术行为见当前架构，历史验收事实见最终验证记录。

## Problem And Product Outcome

marker 是本地 Memory 状态依据，缺失或设备 ID 不同不等于 embeddings 已丢失。避免将此类异常误判为首次使用，保留可复用成果，减少等待和重复 AI 费用，符合 [North Star](../pa-product-north-star.md) 的安静、可信与低管理负担。

## Scope

### In Scope

- B-164/REQ-01：同一现有 vault 存储范围中的 marker 不因设备 ID 单项变化而失效；继续检查 scope 和兼容性。
- B-164/REQ-02：缺 marker 时，在正常 readiness 的首次准备判断前尝试恢复现有兼容可用 SQLite 的 marker；保留 dirty，交给已有 Update 处理实际变化。
- B-164/REQ-03：恢复无法完成时保留实际数据，不据未知状态发起 reset 或 embedding；恢复成功前不虚报 ready，存储恢复后可由已有入口重试。
- B-164/REQ-04：保留真正首次准备、不兼容配置、未接受构建、scope 隔离、卸载/关闭 Memory 和现有维护授权边界；恢复本身不升级授权。

### Non-goals

不改存储介质、设备 ID 生成机制、数据库命名或持久化格式；不实现路径迁移、数据库损坏修复、全库丢失恢复、通用备份、中断续建或新的 UI；不调整 Update 的切分、批量和计费算法；不做完整数据校验器或每次 Chat 全库扫描。

## User Flow And States

1. marker 可接受时沿用现有索引打开路径，设备 ID 变化不会产生新的 Prepare。
2. marker 缺失且不存在未接受构建等既有阻挡事实时，只检查当前本地存储范围。数据兼容可用且 marker 保存成功后，现有 Memory 可继续使用。
3. 存在待更新文件时仍可恢复；按已有维护策略处理待更新文件，未变化文件不因恢复而重新计算。
4. 暂时打不开存储或保存不了状态时，Memory 保持不可用，Chat 继续正常回答；既有重试入口可再次恢复，不新增重复提示或主动定时循环。
5. 确认无已有数据、实际配置不兼容或存在 rebuild guard 时分别沿用原有路径；不将这几种情况混为 marker 恢复成功。

桌面/移动使用相同逻辑及现有路径能力，不新增平台 API 或要求移动端提供桌面绝对路径。

## Trust, Data And Authority

- Markdown 仍为来源事实；本地 SQLite/IndexedDB 仍为可重建缓存/状态。
- marker 恢复只做本地打开、检查和状态写入；恢复阶段没有 embedding 请求，也不清空现有 index。
- 后续 Update、真正首次准备或不兼容 rebuild 的数据发送、费用提示和授权沿用现有契约。
- 不更改用户笔记、统计设备身份、Memory 开关或 `memoryApprovalPolicy`。

## Acceptance Criteria

- B-164/AC-01：同 scope、兼容 SQLite 和有效 marker 仅设备 ID 不同，正常 readiness 不返回由此引起的 first-use/rebuild；已有索引可用，reset 和文档 embedding 调用均为 0。
- B-164/AC-02：无 marker、有兼容可用 SQLite，正常入口可持久恢复 marker；dirty 非空也恢复，队列保留，后续 Update 只处理需要变化的文件；恢复阶段 reset 和文档 embedding 调用均为 0。
- B-164/AC-03：状态读取、数据库打开或 marker 保存失败时，不宣称 ready、不落入 silent first-use，实际索引保留；后续存储恢复后可复用数据，不需要先全量重建。
- B-164/AC-04：真实无数据仍走首次准备；模型/维度不兼容不被“恢复”绕过；guard/恢复抑制及 scope 边界仍有效；并发入口、卸载和关闭 Memory 不造成重复打开、过期发布或新增维护授权。

## Open Decisions

无未决产品选择。Owner 已明确要求完成开发测试，并于 2026-10-08 另行授权 closeout 与本地 master 提交；推送和发版仍需另行授权。

## Implementation References

- [Current architecture](../../architecture/vss-sqlite-wasm-architecture.md)、[Current refresh contract](../../architecture/vss-embedding-refresh.md)、[Local state contract](../../architecture/vss-local-state-plan.md)
- [B-164 最终验证](../../archive/2026/b164-memory-marker-recovery-validation.md)
- 不指定新 release 或 rollout 开关；发布另行授权。

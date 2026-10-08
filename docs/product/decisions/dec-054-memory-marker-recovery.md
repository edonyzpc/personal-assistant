# DEC-054 — Memory marker 异常优先复用本地数据

Decision ID: DEC-054
Status: Accepted
Updated: 2026-10-08
Authority: Owner 在当前会话明确要求避免 marker 异常造成额外全量重建，兼容数据通过 Memory Update 修复，不兼容 embeddings 才重新生成；随后限定“仅针对当前 marker 发现的问题优化，不扩大优化方案，不过度优化，不过度约束，不过度测试”，要求按项目流程完成优化文档与 SDD 开发测试方案，并于 2026-10-08 后续明确要求按 B-164 完成所有开发测试、GLM 周限额直接 GPT 接管。同日另行授权 B-164 closeout 与本地 master 提交；推送与发版未授权。
Work item: B-164

## Context

| 类别 | 依据 |
| --- | --- |
| 明确要求 | 同一 vault 的兼容 Memory 应尽量复用；设备 ID 或 marker 异常不能单独成为全量重新计算的理由；恢复后需更新的文件使用已有 Update |
| 设计基线已核实事实 | `readLocalMarker()` 因 `deviceId` 不一致返回 null；初始化将无 marker 状态置为 `uninitialized`；`getMemoryReadiness()` 将该状态映射为 `first-use/rebuild` |
| 设计基线已有能力 | `tryRecoverMarkerFromSqlite()` 能从可用 SQLite 补写 marker，但仅在手动 stats 路径调用，且 dirty 非空时退出；SQLite 存储范围已由 vault 名称与可用的本地完整路径派生 |
| 推断与证据限制 | 这条代码路径可能重复计算仍可复用的数据；没有证据证明 anthelion 本次事件完全由设备 ID 变化引起，也没有核实事发前 SQLite 完整可用 |
| 未定产品项 | 无；最终技术行为由当前架构承接，实施与验收证据见下方链接 |

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 保持 marker 异常直接进入首次准备判断 | 无代码变动 | 仍可能丢弃可复用成果并重复付费 | 不选 |
| 同 scope 不以设备 ID 单项否定 marker；缺 marker 先复用现有 SQLite 恢复 | 直接覆盖已发现路径，复用既有模块 | 需避免恢复失败再次落入 first-use，以及误接纳未完成构建 | 选择 |
| 统一 SQLite 文件、持久身份迁移或通用数据修复框架 | 可覆盖更广的存储问题 | 超出本次问题，新增迁移与恢复复杂度 | 不在本次范围 |

## Decision

1. 同一现有存储 scope 下，设备 ID 不一致不再单独使 marker 失效；保留 scope 和实际兼容性判断。设备 ID 字段、生成机制和统计用途保持原职责。
2. 缺 marker 时，在正常 Memory readiness 将其认定为首次使用前，尝试打开当前 scope 的 SQLite，复用已有兼容性与可用性检查。存在可用数据则补写 marker，复用 embeddings。
3. dirty 非空不是拒绝恢复的理由；保留待更新队列，恢复后按既有策略进入 Memory Update。恢复不增加后台更新权限。
4. 状态读取、SQLite 打开或 marker 写入失败不能当作“确认不存在”。本次恢复不执行 reset 或 embedding 请求，后续沿既有入口重试；Chat 沿用不可用时正常回答的行为。
5. 保留 rebuild guard、恢复抑制、取消/卸载和模型不兼容边界；不把未正式接受的构建作为已恢复 Memory。确认没有已有数据时沿用首次准备行为。

这是 [DEC-028](./dec-028-silent-memory-auto-prepare.md) 的局部接续：收紧 marker 异常被分类为 first-use 的依据，不改变真正首次准备的授权、数据范围、费用披露或维护策略。实际验收与证据限制见 [B-164 最终验证](../../archive/2026/b164-memory-marker-recovery-validation.md)。

## Consequences

- Product behavior：减少状态记录异常造成的重复准备；不新增设置、按钮或确认弹窗。
- Architecture / data / safety：继续使用现有 OPFS SQLite、IndexedDB 和 VSS/MemoryManager 边界；笔记不修改，恢复 marker 本身不发送笔记到 AI provider。
- Compatibility / migration：不迁移数据库或生成新的 vault ID；不要求旧 marker 补齐新字段；保持现有平台路径取值方式。
- Rollback：撤回本次 marker 读取与恢复接线即可，持久化格式不变；无需删除已恢复的索引。旧版本仍可能触发原误重建。
- Work created or removed：只调整 marker 读取、恢复入口及相邻状态处理；不纳入全库丢失、数据库损坏、路径搬迁或中断续建。

## Revisit Trigger

实现中若证据表明必须改变持久化格式、既有确认策略或一般 rebuild guard 恢复语义，先报告具体偏差，不把它们隐式并入 B-164。

## Traceability

- Product Spec：[Memory Marker Recovery](../specs/pa-memory-marker-recovery-product-spec.md)
- Architecture：[SQLite/WASM](../../architecture/vss-sqlite-wasm-architecture.md)、[Refresh](../../architecture/vss-embedding-refresh.md)、[Local State](../../architecture/vss-local-state-plan.md) 描述已验证的当前行为。
- Validation：[B-164 最终验证](../../archive/2026/b164-memory-marker-recovery-validation.md)
- Source：Owner discussion、documentation-design、development/testing 与 closeout/local-master-commit requests 2026-10-08；过程文档吸收后删除，未完成项不存在。

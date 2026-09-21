# DEC-039 — Behavior-Preserving Plugin Shell Refactor

Decision ID: DEC-039
Status: Accepted
Updated: 2026-09-20
Authority: Owner 已确认的功能保持原则及 LC-01..03 限定修复范围；不代表新技术细节获批或代码实施授权。
Work item: B-143

## Context

`src/plugin.ts` 同时承担 Obsidian 接线、业务流程、持久化事务和资源清理，职责与
状态归属难以独立验证。目标是降低后续维护风险，符合 [North Star](../pa-product-north-star.md)
的安静可信原则；不能用文件缩小、启动提速或测试数量下降交换现有功能。

Owner 已接受行为保持路线，并在生命周期复核后要求将三项限定修复纳入方案。
B-142 已 closeout，其最终测试精简及保留门禁见 [GOV-003](../../development/governance/gov-003-proportionate-test-design.md)。
最新请求是在 B-142 closeout 后完善设计和开发任务，未要求开始代码实施。

## Options Considered

| Option | 判断 |
| --- | --- |
| 逐片迁移状态、行为、资源和测试；三项缺陷先定向修复再迁移 | 采用；正常行为和结构变化可分开验证、回退 |
| 仅移动函数，继续回调整个 PluginManager | 不采用；状态和维护责任仍集中在外壳 |
| 一次重写整个 runtime，同时优化加载/关闭顺序 | 不采用；扩大行为变化与故障归因难度 |
| 保留全部旧行为，包括已确认的生命周期缺陷 | 不采用；限定修复恢复应有启停契约，其余行为不变 |

## Decision

1. 当前正常功能、兼容性、数据、权限及失败恢复不受影响是硬验收条件；性能和
   启动时间不设改进目标，新卡顿或资源持续增长仍算回归。
2. Plugin 保留平台身份、根组装、生命周期入口及明确协调；业务和资源归实际 owner。
   复用现有 Host/Port，允许暂时保留公共转发，不创建另一个巨型 Runtime。
3. 唯一纳入的既有缺陷为 LC-01 Pagelet feature 订阅/迟到回调清理、LC-02 metadata
   重复订阅及尚未执行任务取消、LC-03 Callout 自有依赖等待的卸载清理。
   每项先在旧结构复现并修复验证，再迁移；不是先修完全部缺陷才可开展其他切片。
4. 不改变全局启动/关闭关键偏序、存储格式、命令/视图/设置契约、provider/prompt/
   预算和来源准入；不引入框架、依赖或数据迁移。
5. 接受 B-142 最终保留的行为保护；不恢复已删除的自证/重复 case 或一次性源码
   黑名单，不降低 coverage 门槛/有效收集范围，也不启用新的 runner 优化。

## Consequences

采用 L3 Product track，正式 Spec 固定行为契约，Plan/SDD 描述分片实现；Tracker
单独记录执行状态和证据。新技术设计仍为 Draft。运行时各阶段必须完成独立 review、
真实桌面 Obsidian 及 mobile simulator 验证，不能只靠编译或历史 PASS 声称功能等价。
只有实现实际触及 iOS 专属代码或模拟器无法覆盖的平台行为时才增加真实 iOS gate。

## Revisit Trigger

真实复现证明需要修复 LC-01..03 之外的问题，或必须改变数据/权限/时序/用户行为时，
停止受影响切片并讨论范围；不将普通实现细节反复上交。已撤回的 writingVersions
异常传播疑点不重新包装成必修缺陷；未证实的全局卸载窗口仅保留为验证风险。

## Traceability

- [Product Spec](../specs/pa-plugin-shell-refactor-product-spec.md)
- [Feature Home](../../development/active/plugin-shell-refactor/README.md)

原 Discovery 的范围、事实、风险及取舍已分别吸收到本 Decision、Spec 和 SDD，
不再保留重复讨论稿。

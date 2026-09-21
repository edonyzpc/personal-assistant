# Plugin Shell Refactor Product Spec

Document status: Current
Updated: 2026-09-21
Work item: B-143
Decision: [DEC-039](../decisions/dec-039-plugin-shell-refactor.md)
Authority: Owner 已确认行为保持要求、三项局部生命周期修复边界，并授权实施、验收与 closeout。

## Problem And Product Outcome

分离插件入口的业务和资源责任，使后续修改可局部验证。用户继续使用现有完整功能，
无新迁移、学习或管理负担。遵循 [North Star](../pa-product-north-star.md)。

## Scope

- B-143/REQ-01: 用户入口、命令 ID/默认快捷键、视图类型/工作区恢复、设置默认值与迁移、输出/通知和支持平台保持原契约；不删功能。
- B-143/REQ-02: 保持持久化格式/路径/身份、设置对象实时语义、队列串行、失败补偿、取消/撤销及恢复结果；不引入数据迁移。
- B-143/REQ-03: 保持启动、注册、事件失效、自写入防重入、后台触发和异步关闭的关键偏序；不新增自动网络调用或改变权限、来源范围、provider 与预算。
- B-143/REQ-04: 复用现有 Host/Port 和领域模块。每片迁移完整的状态/方法/清理责任，暂时保留必要公共 facade；不让新模块依赖整个 PluginManager 或循环回调任意私有方法。
- B-143/REQ-05: 与 B-142 保持行为保护等价；精简依据、所有者测试、关键集成路径可追溯。不以删测试、缩小 coverage 收集范围或降低阈值让重构通过。
- B-143/REQ-06: 按切片完成 test/review/fix、真实桌面与 mobile simulator 后再扩大，故障定位和回退以切片为单位；既有问题与新回归分别记录。只有实际 iOS 专属变化或模拟器不能覆盖的平台行为才增加真实 iOS gate。
- B-143/REQ-07: 在保持正常功能与全局生命周期关键偏序的前提下，完成 LC-01..03 三项局部修复；每项先以真实实现重现缺陷，再修复和验证，最后迁移并复用同一行为断言。不扩大为全局启动/关闭重设计。

## Non-goals

不调整加载阶段或懒加载策略，不承诺启动/bundle 性能收益，不设文件行数或测试
删减目标；不重写 Orchestrator、MemoryManager、VSS 或 Chat 业务，不改算法、prompt、
provider、预算、存储 schema、UI 文案、默认值、外部依赖或测试执行模式。
LC-01..03 之外的既有问题不自动纳入修复，包括 Backlog B-141。

## User Flow And States

正常启用、工作区恢复、入口调用、功能开关、后台工作、取消、失败恢复、卸载及
重新启用保持现状。功能对照覆盖 Chat/Agent/context/tools、Memory 准备与治理、
Pagelet review/recall/recap/discovery、Capture、图片与写作、Share Card、记录/统计、
metadata、Callout、graph、插件/主题管理和设置/权限。

仅以下缺陷状态纠正：

| ID | 触发 | 要求结果 |
| --- | --- | --- |
| LC-01 | Pagelet 关闭后仍有旧实例事件/异步回调；反复开关 | 旧订阅释放，不重建已关闭 UI；重新启用只有当前实例响应 |
| LC-02 | metadata 多次开关；排入 debounce 后停用/卸载 | 不累积有效订阅，取消尚未开始的任务；已提交写入安全完成，旧清理不得取消新一轮任务 |
| LC-03 | 等待 Callout Manager 就绪/API 返回期间卸载 | 自有轮询/超时释放，等待 Promise 结束；迟到结果不挂到已卸载实例，正常就绪/未启用/超时回退保持 |

## Trust, Data, Authority And Cost

Markdown vault 仍为来源真值，OPFS 仍为设备本地缓存；现有 Data Boundary、provider
告知、授权及成本规则不变。新装、旧设置、事务失败、治理撤销、marker unknown、
来源撤销和同设备恢复均属于功能保护范围。AI 输出以确定性上下文/工具/来源/预算/
结果结构断言及真实流程判断，不承诺真实模型文本逐字相同。

## Acceptance Criteria

| AC | 对应 REQ | 通过条件 |
| --- | --- | --- |
| B-143/AC-01 | B-143/REQ-01 | 除 LC-01..03 明确纠正的缺陷行为外，受影响入口和结果的前后对照一致；插件壳层接线与真实交互均通过 |
| B-143/AC-02 | B-143/REQ-02 | 代表性新装/已有状态/异常持久化/卸载中事务/重新加载场景保持同样可恢复结果；无新格式或路径 |
| B-143/AC-03 | B-143/REQ-03 | 视图注册、来源失效、调用准入、取消和关闭偏序被保留；无新的重复订阅、残留工作或额外 provider 调用 |
| B-143/AC-04 | B-143/REQ-04 | 迁出模块拥有自己的状态与清理；消费端依赖窄接口，外壳只组装和委派；没有新的巨型总管或双状态源 |
| B-143/AC-05 | B-143/REQ-05 | 每个受影响关键行为都有保留/迁移后的证据；source/tooling/artifacts 实际发现正确，coverage 门槛和有效收集范围保持 |
| B-143/AC-06 | B-143/REQ-06 | 每阶段所需测试、独立 review、部署、真实桌面与 mobile simulator gate 完成；若出现 iOS 专属变化则补对应真机证据；无未处置的新 P0/P1/P2 回归，不以缩小范围冒充整体完成 |
| B-143/AC-07 | B-143/REQ-07 | LC-01：feature 关闭后旧实例不再接收事件或重建 UI；反复开关仅当前实例有效，重新启用正常；迟到回调不会恢复已销毁实例 |
| B-143/AC-08 | B-143/REQ-07 | LC-02：反复开关不累积有效订阅；停用/卸载取消尚未开始的任务，正常更新、排除路径与重启仍有效；已提交写入不被回滚或中断破坏 |
| B-143/AC-09 | B-143/REQ-07 | LC-03：卸载终止自有等待并让等待 Promise 正常结束，不向旧实例挂载迟到 API 结果；依赖就绪、未启用与超时回退保持正常 |

## Delivered Status

功能保持、LC-01..03 三项修复及 D-11 最小同步 stop/lifetime gate 均已由 Owner
确认并验收。D-11 已随 Memory/extraction owner 迁移完成；D-15 在旧结构复现后以
storage owner currentness gate 修复。没有剩余产品决策或未完成 B-143 工作。

实现由 `82eb5d2f` 提交，当前架构与最终验收状态由 `b4d1ac39` 记录。最终冻结输入通过
314 个 suites / 7952 个 tests、lint、生产 build、文档/差异/community source scan，
并以同一 bundle 完成真实桌面 Obsidian 与 mobile simulator 抽查。实现没有 iOS 专属
差异，因此未执行真实 iOS gate；未调用真实 provider、读取 secret 或写入用户 vault。

## Current References

- [DEC-039](../decisions/dec-039-plugin-shell-refactor.md)
- [Architecture overview](../../architecture/architecture-overview.md#51-plugin-shell-srcplugints)
- 当前 source、owner/facade tests 与 lifecycle tests

# PA Agent Command Contract Delivery Plan

Document status: Approved
Updated: 2026-10-04
Work item: B-158
Authority: Owner 指定的交付顺序、阶段边界及比例化验证策略。
Product spec: [Product Spec](../../../product/specs/pa-agent-command-contract-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

以 [统一架构](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
固定职责和消息关系，使后续方案/实现不会随领域功能重新解释 Host 职责。
先建立契约与工作流，暂不重新分析或修补现有 command；已有只读发现作为最后阶段输入。

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P1 | 稳定抽象与工作流落地 | 架构单一来源、Spec、SDD/review/派工入口及模板 | 独立职责审查；docs/check与现有docs suites；流程不重复定义 | 明确设计与可执行工作约定，不声称 runtime 已对齐 |
| P2 | 公共框架设计与重构 | source-verified SDD、command declaration/invocation 接入、执行事实/恢复桥接 | SDD 细节核实；合成binding/capability真实链；focused、broad及repo test所需app gate | 兼容旧domain；不夹带各command行为修正 |
| P3 | 领域迁移 | 逐项 Ghost、Writing、CreateImage；各自 schema/binding、效果事实和必要阶段 | 各域focused；少量真实模型任务与改变的app动作；保留未知效果和确认保护 | 每域一次dev/test/review/fix验证闭环 |
| P4 | 一致性验收 | current architecture/spec/Skill 与实际实现，必要组合回归 | 只有受影响输入触发集中补验；独立review与剩余风险结论 | Validated implementation；无commit/push/release或自动closeout |

## Dependencies And Risks

既有 `PaAgentRunOptions`、`CapabilityRegistry`、`PolicyEngine`、`PaAgentLoop`、
`PaAgentToolExecutionResult`、`TaskSourceReadGuard`、领域事实及Context链作为基线；
准确桥接范围和 Proposed 接口见 SDD。已有 T-07 修改和用户 DESIGN/design-samples 保留。

| Risk | Prevention / detection | Rollback |
| --- | --- | --- |
| 文档 Approved 冒充代码完成 | 架构明确规范/事实差异；Tracker-only 状态与阶段证据 | 保留既有运行代码；不把规范状态当验收 |
| 公共层扩成第二编排器 | 单一loop；检查真实生产消费者；只共享已证明共性 | 回退新接入，保留旧domain binding |
| 修参重复真实副作用 | owner报告执行阶段，unknown/partial保留现有查询/防重 | 不重放；沿用原领域操作与记录 |
| 暗改权限/业务步骤 | 所有条件映射既有权威与owner；review先职责 | 恢复原领域合同，实质变化交Owner |
| 大范围测试/模型矩阵膨胀 | 风险→最小证据，冻结输入集中昂贵gate | 复用未变证据，只补缺口 |

## Validation Strategy

P1只做docs gate及既有相关合同测试，不build/部署。P2先合成真实接线证明输入、准入、
结果保真、取消清理与恢复；按共享行为执行集中lint/build/full及test app。P3真实模型
证明的是语义/纠错，手工工具参数不代替它；代表请求覆盖新边界，不按同义词重复。
数据、预算、运行协议、app和发布证据分别标明范围；生产写入和iOS未授权/无关联风险不增加。

## Approval

- Plan authority: Owner 2026-10-04 指定顺序与统一架构方向。
- Approved on: 2026-10-04。
- Implementation follows the detailed SDD and phase exits; unresolved material deviations do not inherit authority.

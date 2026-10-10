# Complete Note Query Implementation Design

Document status: Approved
Updated: 2026-10-10
Work item: B-169
Tracker: [Development Tracker](./tracker.md)
Product spec: [Complete Note Query](../../../product/specs/pa-complete-note-query-product-spec.md)
Authority: [DEC-059](../../../product/decisions/dec-059-complete-note-query-results.md) 与用户当日实施授权；[Product Spec](../../../product/specs/pa-complete-note-query-product-spec.md)。

## Existing Boundaries And Changes

保留三个工具名及现有 factory/helper/guard/evidence 分工。`query_notes` 完整遍历许可文件，条件评估后排序并组装列表；metadata keyword 保留已有匹配算法，去默认 top-N 并去任意属性值预览；snippet keyword 本地读取与字面匹配，按笔记去重并仅保留首个命中定位和必要来源版本。`read_note` 提供正文。

移除与完整清单冲突的候选/扫描/投影/结果数阈值及新调用游标。旧记录类型可保留安全兼容；不迁移持久数据。工具输出、V1A snippet 准入、vault observation parser 与重校验同步调整，保留结构、路径、hash 和来源证明校验。近期结果沿用现有 Context 保护；真实上下文溢出沿用现有机制，不新增压缩或结果存储。

## Responsibility Mapping

按 [Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)：Agent 选择语义、日期口径和按需读正文，仅在用户明确要求前 N 篇时传入数量限制；工具完整执行结构化条件并产出真实清单；Host 沿用真实来源权限、取消、身份及版本事实。内部协作切片属于工具执行，不制造模型规划步骤。无写入效果、索引或后台维护。

## Validation And Rollback

- B-169/REQ-01、B-169/AC-01 对应完整候选、匹配/排序/数量与结果容量回归。
- B-169/REQ-02、B-169/REQ-03、B-169/AC-02 对应本地关键词全扫描、按笔记去重、正文分离及官方 API。
- B-169/REQ-04、B-169/AC-03 对应现有来源、取消、未知/失败和历史证明边界。
- B-169/AC-04 对应真实 capability/provider 投影与已部署测试库运行。

验证映射在 [Tracker](./tracker.md)，不另造测试框架。用现有合成 fixtures 覆盖旧阈值外命中、所有匹配一次返回、去重/无正文和来源安全，再做实际 capability/provider 投影与测试库运行。回滚只针对本任务交付差量，并恢复测试部署的先前已记录资产，不改变用户笔记或私人 vault；提交后的回滚须另获授权，不重写历史。

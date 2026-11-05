# GOV-008 — PA 测试与防御联合审计能力

Document status: Current
Governance ID: GOV-008
Updated: 2026-11-05
Work item: B-196
Authority: PA 测试与防御联合审计的稳定要求、职责与授权边界；不改变 PA 产品行为。

Bootstrap source: Owner 于 2026-11-04 要求完成社区原文调研与专项方案，随后要求吸收
两项 P2 和两处方法增强，并基于修订方案按项目规范与 SDD 标准制定开发测试计划。
后续 Owner 设置 B-196 交付目标，完成已审定的开发和测试，并于 2026-11-05 明确授权
确认完成后收尾、提交 master 及推送远程。实际 PA 优化仍由相应任务授权。

## Context And Selected Governance Choice

以测试真实性、保护价值、生产防御必要性和成本为核心，支持只读审计、按授权优化及
新增测试准入。先有可执行方法和真实小范围试审，再按需要补证据工具；不以删减数量、
文件长度或脚本存在作为能力证明。本契约拥有稳定要求，
[pa-test-audit](../../../.agents/skills/pa-test-audit/SKILL.md) 提供具体方法，
[测试优化流程](../workflows/test-optimization-workflow.md#6-冻结后集中完整验收) 统一验证范围。
独有来源取舍与最终验收保留在 [B-196 验证记录](../../archive/2026/b196-pa-test-audit-validation.md)。

## Requirements And Acceptance Criteria

| Requirement | 要求 | Acceptance Criteria |
| --- | --- | --- |
| B-196/REQ-01 | 区分 audit、apply-tests、apply-combined、authoring；exhaustive 只扩大审阅覆盖 | B-196/AC-01：按真实请求决定范围与动作，复用已有授权；只读不写入，不自行外传或新增数据路由 |
| B-196/REQ-02 | 按生产责任发现测试、共置测试与共享使用方；区分建图、深审和执行 | B-196/AC-02：真实试审范围完整可核对，未审与未执行明确；局部任务不强求全仓清单 |
| B-196/REQ-03 | 核实目标路径、独立预期、依赖替身忠实性与独有保护 | B-196/AC-03：能辨别自证、错误负例和依赖模拟失真，也保留有价值的静态/次数/边界保护 |
| B-196/REQ-04 | 追溯防御的来源、保证与失效窗口；识别状态表达和职责分散造成的复杂度 | B-196/AC-04：有证据的重复可简化，真实边界与竞争保护保留；局部结构调整不引入通用框架 |
| B-196/REQ-05 | 新增与存量测试适用同一价值标准，独有保护也须比较收益与成本 | B-196/AC-05：先找低成本充分证据；建议减少独有自动保护时说明剩余风险与授权，不冒充等价承接 |
| B-196/REQ-06 | 按授权完成测试/防御联合优化，复用一组候选和一次适用独立复核 | B-196/AC-06：隔离 apply 的实际改动满足目标，保护与授权边界可复核；不改 PA runtime 来验证 skill |
| B-196/REQ-07 | 证据工具只解决试审暴露的具体重复劳动，可不实现 | B-196/AC-07：试审后说明采用/跳过依据；实际工具只整理给定数据，不执行测试、网络、Git 或安全删改裁决 |
| B-196/REQ-08 | 固定上游来源，隔离不可信指令和不适用执行依赖 | B-196/AC-08：必要来源/许可可追溯，无上游 hooks、模型调度、认证读取或新增数据路由 |
| B-196/REQ-09 | 旧 workflow 统一裁决与验证范围；review/followup 保持职责和证据连续 | B-196/AC-09：接入保持旧文裁决与验证范围一致；窄任务不重复审计或全量验证 |
| B-196/REQ-10 | 用实际行为验证 skill，按失效范围复测并如实报告能力边界 | B-196/AC-10：覆盖原方案 V-01–V-14 的不同机制并复用证据；不以关键词、格式或单次样本声称普遍准确率 |

## Non-goals

- 不改变 PA runtime、产品能力、用户数据、权限、存储、provider 或 Obsidian UI。
- 不直接执行全仓代码/测试清理，不为试审调用 PA 运行时 provider 或访问私人 vault。
- 不改 Jest 分组、coverage 门槛、CI、依赖、打包或发布规则；不建立审计平台或性能服务。
- 不设删除比例、固定 reviewer 数、逐项 mutation 或每个 mock 的真实集成验证。
- 本契约本身不授予任何具体保护损失、实施、Git 操作或发布权限。

## Delivered Capability And Use

- 默认专项入口为只读 `audit`；`apply-tests` 限测试及获准辅助产物，`apply-combined`
  需要生产与测试的明确范围授权。普通开发的 `authoring` 只用四问，不升级全仓审计。
- 测试裁决区分等价承接、无独立契约及明确风险取舍。独有保护先找较低成本的充分验证；
  放弃保护须说明后果和授权，不能以删后绿灯或覆盖率相同证明等价。
- 防御判断追输入、首次准入、保证有效期、实际效果和简化后果；在既有责任内收敛状态，
  保留外部边界与真实取消、撤权、并发和兼容保护。
- 优化后的 diff 由既有 review 同次检查正确性与保护取舍；followup 继续已有候选、
  授权和有效证据。验证选择只有 workflow 一处，不引入新调度、周期审计或固定删减目标。
- 本次交付核心 skill、元数据和三个按需参考。试审未证明 inventory/compare 工具的必要性，
  因此没有交付工具、对应 suite、依赖或 CI 改动。以后出现可定位的反复整理成本再评估。
- 显式 skill 入口已有行为证据，自动选择未实测。当前能力不代表 PA 全仓已优化或成本已降低。
  新任务仍需核对当前输入与权限；skill 的只读声明不替代宿主隔离。

## Traceability

REQ/AC-01–10、V-01–V-14 与实际证据的映射见
[最终验收](../../archive/2026/b196-pa-test-audit-validation.md#需求与证据映射)。
固定上游版本、方法采用和排除范围由
[来源参考](../../../.agents/skills/pa-test-audit/references/upstream-sources.md) 维护。
现有 [GOV-003](./gov-003-proportionate-test-design.md)、
[GOV-004](./gov-004-test-audit-quality-preservation.md)、
[GOV-005](./gov-005-quality-first-test-reduction.md) 的历史验收仍保持原意。

## Authority And Change Boundary

核心 skill 与 workflow/review 接入已完成，历史 GOV 的适用性说明已同步。
验证范围由 workflow 统一选择；现行 coverage、CI 与发布资格按各自契约执行。

GPT-6 负责权威文档、派工与独立验收；GLM 仅在实施授权后通过既有独立 CLI 承担
限定实现、试审及验证，具体模型/工具身份按现行流程预检和复用。需要改变产品边界或接受未授权
风险时，只暂停受影响项；本契约不替代用户决定。
现有 pa-glm/ZAI 编排所需的最小材料传输沿用已获准范围；它与执行者自行外传或调用
PA 产品的 provider 分开判断，不以“只读”否定既有编排授权，不新增端点或材料范围。

## Terminal Disposition

2026-11-05，B-196 完成收尾。稳定要求与方法已吸收到本契约、workflow 和 skill，
独有验收及安全事件事实压缩到当前入链的验证记录。Active 包与已吸收的 Discovery 删除，
原始未提交过程文档和仍引用的本机证据保留在本机，不将敏感日志提交到 Git。
Context Pager 的可选清理和待查点由 [Backlog T-013](../../backlog.md#触发型评估) 承接，
不属于 B-196 尚未完成的能力交付。Git 推送与 CI 结果以实际交付回执为准，收尾不表示发布。

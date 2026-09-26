# GOV-005 — 质量优先的测试精简

Document status: Current
Governance ID: GOV-005
Updated: 2026-09-26
Work item: B-151
Authority: 测试精简的承接证据与覆盖率验收；不改变 PA runtime、用户行为或发布资格。

Bootstrap source: Owner 于 2026-09-26 要求分析减少 20% 用例的可行性，确认行、语句、
函数、分支各最多下降 2 个百分点，随后明确“20% 不作为承诺目标交付，优先保证质量”，
并要求“继续”。本轮承接该讨论与实施授权，B-150 已关闭的验收记录保持原状。

## Context And Selected Governance Choice

沿用 [GOV-003](./gov-003-proportionate-test-design.md) 与
[GOV-004](./gov-004-test-audit-quality-preservation.md)：测试价值由能捕获的可信失败决定。
优先合并同输入、同生产路径的重复执行；不能把不同输入包进一个 `it` 来改变计数。
20% 仅为探索参考，不是验收下限；覆盖率余量也不是可主动消耗的质量预算。

## Requirements

- B-151/REQ-01：每个删减项记录旧保护、具体保留测试及等价理由，由非作者复核。
  不同失败原因、前置状态、时序、权限、数据与发布保护不得因相同结果而合并。
  证据不足的候选保留；先处理已发现的小范围候选，不扩成全仓固定比例删减。
- B-151/REQ-02：相对可核对的 B-150 最终基线，四项覆盖率各最多下降 2 个百分点。
  保持统计文件集合、统计配置、原有门槛与测试分组；使用原始计数比较，不用显示值
  的舍入结果验收。分母变化须查明原因，不得通过减少统计范围维持比例。
- B-151/REQ-03：交付限测试、夹具、测试辅助代码与文档；沿用本对话 GPT-6 执行、
  不调用 GLM 的选择。每批定向验证和独立复核，全部修改冻结后统一完整门禁。
  关键数据/权限保护若需反证，仍按 GOV-004 受限隔离协议；生产代码最终零改动。

## Non-goals

不改变产品行为、宿主 UI、依赖、Jest/coverage 配置、CI 并行度、发布门禁或真实 vault。
不承诺 20% 删减或稳定提速，不以百分比达标代替契约审查。不重做 B-150 已验收范围。

## Acceptance Criteria

- B-151/AC-01：实际删改项均有可审阅 diff、具体承接关系、focused PASS 与非作者
  复核；无未处置的保护丢失。真实 CLI、签名、重放、构建身份等保护继续成立。
- B-151/AC-02：最终完整测试自然退出成功，保留 436 个 coverage 文件（420 个 src
  与 16 个配置/文本文件）；核对各指标分母及位置差异。基线原始计数为行/语句
  167726/184006、函数 8445/9926、分支 44075/53496；各自下降不超过 2 个百分点，
  且现有 Jest 门槛不变。测试发现集合与获准删改一致，无 skip/forceExit/放宽预期。
- B-151/AC-03：冻结输入的 lint、production build、完整 Jest coverage、docs 与
  diff 检查通过；报告实际净减数量、保留候选与证据限制。测试限定修改不例行部署，
  不声称 Obsidian/设备验证；Git、收尾与发布保持单独授权。

## Traceability

| Requirement / AC | Design | Delivery evidence |
| --- | --- | --- |
| B-151/REQ-01 / B-151/AC-01 | GOV-004 契约承接与非作者复核 | [Tracker](../active/test-reduction/tracker.md#candidate-decisions) |
| B-151/REQ-02 / B-151/AC-02 | 原始覆盖计数、路径与分母核对 | [Tracker](../active/test-reduction/tracker.md#validation-log) |
| B-151/REQ-03 / B-151/AC-03 | 定向验证后集中完整门禁 | [Tracker](../active/test-reduction/tracker.md#evidence-plan) |

## Authority And Change Boundary

[Tracker](../active/test-reduction/tracker.md) 是本轮唯一执行状态权威。
本契约补充 GOV-003/GOV-004，不替代二者。扩大生产修改、降低质量标准或接受保护缺口
须先由 Owner 决定；常规候选取舍按已批准的质量优先原则执行。

## Terminal Disposition

验收后按文档流程办理另行授权的收尾：稳定依据吸收到当前契约/测试，过程文件默认
删除，独有验证证据按需保留。本契约交付后保持 Current；取消或替代时明确终态与后继。

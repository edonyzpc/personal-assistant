# B-155 Agent Responsive Execution — Final Validation

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-05
Work item: B-155
Authority: 已完成开发、故障定位与 beta.18 验收的历史证据；当前行为以 [DEC-047](../../product/decisions/dec-047-agent-responsive-execution.md)、[Product Spec](../../product/specs/pa-agent-responsive-execution-product-spec.md)、[完整响应性设计](../../architecture/pa-agent-responsive-execution.md)和[Agent 架构](../../architecture/pa-agent-architecture-plan.md)为准。

## Accepted Scope And Final Evidence

GPT 独立接受 T-01–06；F-01–02、04–10 修复，F-03 为明确接受的设计取舍：保留真实 backlinks 扫描依赖，不以不完整 epoch 静默丢弃证据。没有剩余实施或必需验收项。2026-10-05 用户授权 closeout；本次没有重复运行测试、部署、推送或发布。

| Requirement / AC | 最后有效证据与边界 |
| --- | --- |
| B-155/REQ-01–02 / B-155/AC-01–02 | 真实 query factory 的 500 ancestry × 500 候选多次切片只完整 prepare=1，dirty 后累计=2。F-07 修复后 desktop 与 CLI mobile simulator 均在真实准备期间完成两篇笔记编辑/落盘、tab、原生命令和可见 Stop；inspect/query/snippet 全部 success。 |
| B-155/REQ-03–04 / B-155/AC-03–04 | 真实 SDK 撤销拒绝、普通编辑保留已读快照；身份、未知来源、scope/epoch/abort、独立图片 receipt 与 fallback 回归保持。Desktop 停止后 providerRequests=4 不再增长；mobile 准备第六次请求时停止，completedPrepares/admissions/providerRequests 保持 5，迟到结果不写已结束任务。 |
| B-155/REQ-05–06 / B-155/AC-05–06 | 最终本地完整 355 suites / 8618 tests 及 coverage 门槛自然退出 0；lint/build/docs/diff 通过，DOM 无匹配。最终 diff SHA-256 `6fe9dfb79b4e5fa8368d19da6faeec553e841c6da4772db71356ff9aefe0a508` 始末相同。[master CI 36980277921](https://github.com/edonyzpc/personal-assistant/actions/runs/36980277921)在 b886251e 上完整 validate 成功，同为 355/8618/coverage，lint/build/Test/Audit 实际通过。 |
| B-155/REQ-05–06 / B-155/AC-05–06；已授权发布与安装 | exact-master b886251e 生成 beta.18，release/publish 自然退出 0；包装提交 84af0bd0 Good signature、父提交精确匹配，tag 为标准 annotated tag、非签名 tag。[beta CI 36981550465](https://github.com/edonyzpc/personal-assistant/actions/runs/36981550465)完整 355/8618/coverage 通过；[beta.18 Release](https://github.com/edonyzpc/personal-assistant/releases/tag/2.10.0-beta.18)当时为 prerelease、非 draft，六项资产。BRAT 实际安装 enabled、版本/pin 为 beta.18，main.js/styles.css 与发布 digest 一致，manifest 语义相同。 |
| 当前发布资产应用补验 | Desktop 与 CLI mobile simulator 各 4 准备/4 准入/4 合成物理请求，真实 SDK inspect/query/snippet 成功、最终回答可见、active=false。main.js SHA-256 `d28c7ac7668df11ae453c737240e1db81fcdb9cdc529bf7917a3e3e1143b6ee7`；响应性与 Stop 复用未变调度/UI的上述准备期间交互证据，普通工具链完成不单独替代响应性证明。 |

## Jest Failure Diagnosis And Resolution

早期本地通过而 GitHub SDK 正常/编辑场景仍超时，没有归为平台强杀、网络死锁或 OOM，也没有放宽默认 5s、500 来源、六阶段、任务预算或 coverage。完整 CI 36976281261 的实际失败 worker 有 97 个总 enabled native AsyncLocalStorage；正常场景 CPU 5557 ms，profile 中原生 ALS init/propagate 的 top20 合计下界为 2529.614 ms。97 不是已证实全部由 Jest 创建的实例数。

同机 0/150 个自有 ALS 对照、同 500 来源 SDK 与 coverage 自然退出 0：正常 wall 587→2799 ms、编辑 471→2638 ms；仅证明额外 enabled ALS 足以放大成本，不把模拟数量冒充真实 GitHub 槽数。源码链确认 Jest 30.3 每 suite 启用 testNameStorage 而未 disable；30.2 与当时检查的 30.5.2 仍有该路径。固定官方 Jest 30.1.3 / globals 30.1.2，使普通 test 避开该启用路径，保留官方依赖组合与所有原断言；诊断代码删除，生产依赖保持。

最终 master 完整 CI 的 SDK 正常/撤销/编辑响应为 1792/130/1629 ms，完整测试仍约九分钟，不宣称全仓大幅加速。局部 coverage 因全局门槛退出 1、取消的完整 gate、sandbox 回环 EPERM 和此前 CI timeout 均保留为失败或 superseded，未算最终通过。F-09 标量解析优化不能单独解释 Linux 超时；heap 末值与已观测 GC 不能代替 ALS 因果证据。未来升级 Jest 先核实这一实际路径已修复，不凭 latest 推定兼容。

## Limits And Disposition

- 原故障 `26 × 1900 × 500 ≈ 2470 万`只是量级估算，不是准确读取数、请求数或性能倍数。次数回归证明重复乘法结构消除，不换算未经测量的加速比。
- 准备与发布资产 smoke 使用合成 provider，保留真实 SDK/来源 hooks；不证明付费网络性能、所有硬件负荷下的硬实时保证、真机 iOS 能力或 anthelion 已更新。
- 验收时 test 恢复 16 篇基线与原会话，Memory/Host/fetch、debug/mobile 和临时 probe 已恢复/移除；managed worktree 已可恢复归档，BRAT beta.18/pin18按当轮验收保留。
- 2026-10-05 只读复核发现代表性的 `/private/tmp/pa-responsive-*`、`pa-sdk-*`、`pa-jest-pin-*`、`pa-beta18-*` 原始证据文件已不存在。本档保留原 Tracker 摘要和历史 CI/发布链接，不宣称临时日志仍可读取，也不将历史远端结果称为本次重新核实。

README、Tracker 默认 delete-after-absorption。原 Tracker 明确记录 Owner 要求保留完整 SDD；清理 active 时须保留该完整设计并转入 durable Architecture，不能因默认删除规则丢弃。本文仅保存独有最终验证、Jest 事故因果与发布范围，不复制完整开发包。

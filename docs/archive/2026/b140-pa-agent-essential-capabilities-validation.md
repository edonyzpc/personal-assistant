# B-140 PA Agent 基础能力验证记录

Document status: Historical
Date: 2026-09-17
Work item: B-140
Authority: 已完成工作的历史验收与证据边界，不授予新的实现、master 集成或发布权限。
Current contract: [DEC-036](../../product/decisions/dec-036-pa-agent-essential-capabilities.md) / [Product Spec](../../product/specs/pa-agent-essential-capabilities-product-spec.md) / [PA Agent Architecture](../../architecture/pa-agent-architecture-plan.md#b-140-note-memory-and-insight-capabilities)

## Outcome And Evidence

T-01～T-15 与 B-140/AC-01～14 已按计划逐项验收，源码、测试和当前合同一致。运行时与测试由签名提交 `0aa4bb99` 保留；开发过程、原始来源调查及逐项 Tracker 由 `2cab57af` 保留。本记录只保留最终独有证据；不复刻完整过程包。

| 阶段 | 实际证据与边界 |
| --- | --- |
| P1 笔记与来源 | 真实 Qwen/Obsidian 对日期字段选择与说明、YAML/无结果、分页、长文续读、多处命中、四写预览/确认/取消/Undo、Pagelet 冻结来源完成交互。来源权限、版本、历史/摘要及物理 dispatch 的负例由对应源码回归覆盖。 |
| P2 理解与治理 | 真实 App 查询长期理解、明确记住/再查/纠正、暂停/恢复、Undo 与 Forget 取消/确认；伪指令不授权。待完成/提交竞争与来源失效由领域和运行时回归覆盖，未人为制造 App 中间态。 |
| P3 洞察与 Pagelet | 真实模型读取现有 Vault Insights 概览（14 篇覆盖）并回读两篇合成笔记，区分聚合观察与事实；明确保存后跨会话找回同一 Saved Insight、归档/恢复、Later 入 Review。live Panel 的 Discuss in Chat 带来源交接，Keep 持久生效；空白笔记无新候选，关闭不保存，切换活动笔记不改变已打开 anchor。最终 `manage_saved_insight` applied 回执、界面答复与持久化读回一致。 |
| 最终门禁 | 当前源码输入的 `make deploy` 自然退出 0，含 lint、production build、283 suites / 7680 tests 与 `test/` 部署。`dist/main.js` 与部署目标 SHA-256 均为 `65e1c002f5965655fec59caf32f20b4baa76a7bfde6d5f545a2372f90099b202`。`eval:pa:fast` 9/9、DOM/source 扫描无匹配、`git diff --check` 通过；文档门 216 Markdown / 1871 links 通过，有 4 项既有 advisory。 |

实际 App 为 Obsidian 1.14.1 的仓库 `test/` vault。最低 App `1.11.4` 的 API 可用性按 `obsidian.d.ts` 和现有 manifest 核对，未在 1.11.4 或 iOS 真机单独实测。真实模型调用证明本次配置和交互有效，不独立证明服务端实际型号。B-140 原始调查确认工具注册与实际开放不一致、Chat 缺少通用正文读取；不把最初用户场景推断成已捕获的原始故障 trace。

## Deferred And Retained Items

T13-UX1（P3）转 [B-141](../../backlog.md#已延期的产品与工程工作)：临时 Pagelet Detail tab 中旧结果的 Discuss in Chat 按钮未完成交接。live Panel 同入口、来源交接与 Keep 已实测通过；Detail tab 不据此声称通过。后续只需针对该入口复现并验证同一候选/来源进入 Chat，不重开 B-140 的其它能力。

测试后已移除本任务 3 条 Saved Insights、1 条 Review 项、3 篇合成笔记与空目录；Vault Insights 临时开关恢复 false，重载后相关领域 store 与持久化读回均为 0，活动笔记恢复 `0.unsorted/Dog.md`，Chat 切为空白会话。9 个本轮合成 Chat 历史因不可逆删除被自动审批拒绝而保留，未绕过；精确 ID 与只读核对见提交 `2cab57af` 的 Tracker。原始 source/gate/App 日志留在本机任务目录供追溯，不作为当前执行权威。

Closeout 文档门在过程包删除后通过：211 Markdown / 1823 local links；相关文档合同测试 2 suites / 58 tests、diff check 通过，4 项既有 advisory 未变。运行时与测试输入未改，故复用上表的构建、完整 Jest 与 App 证据。

# PA Agent Essential Capabilities Delivery Plan

Document status: Approved
Updated: 2026-09-14
Work item: B-140
Authority: 用户本轮授权推进 B-140；沿用完整任务设计，GPT 负责设计/验收，GLM 负责限定实现。
Product spec: [Product Spec](../../../product/specs/pa-agent-essential-capabilities-product-spec.md)
Tracker: [Tracker](./tracker.md)

## Goal And Non-goals

完整交付笔记、Memory 管理、洞察延续三条主线。范围与非目标以 Product Spec 为准。

## Phases

| Phase | Scope | Exit gate | Stop point |
| --- | --- | --- | --- |
| 准备 | T-01 合同/源码设计；T-02 本机 GLM 与工具预检 | 契约可执行、模型身份与实际工具证据齐全 | 才能派实现 |
| P1 | T-03 read_note；T-04 query_notes；T-05 snippets/结构；T-06 规划门/Operations；T-07 集成 | focused/source、冻结输入 make deploy、Chat/Pagelet 实际交互 | GPT 阶段验收 |
| P2 | T-08 Memory 只读；T-09 可靠治理；T-10 集成 | admission/持久化/撤销负例、完整 gate、App 查询与动作 | GPT 阶段验收 |
| P3 | T-11 洞察读取；T-12 明确保存/Later；T-13 入口集成 | 来源/显式意图/持久化、完整 gate、App 保存/忽略/来源回看 | GPT 阶段验收 |
| P4 | T-14 全项验收；T-15 同步接收与清理 | 全 14 AC、兼容与必要原始证据 | 已验证实现，无自动 Git/closeout/release |

## Dependencies And Source Surface

沿用[任务设计 T-03 至 T-15](./task-cards.md#任务卡)的 disjoint writer 范围；准确新增文件与接口在 SDD/派工修订固定。当前用户指定 checkout 是交付树，保护已有 diff。实际目标解析为本机 repo 的 `test/.obsidian/plugins/personal-assistant/`，不是历史计划的 `/mnt/code`，每次部署仍核对真实已加载 vault。

## Risks And Rollback

已有来源缺陷、治理 admission、确认/忘记与持久化任务采用 `reproduce → implement` 检查点；T-04 按原任务卡使用 deliver，新 API 无旧实现时不以 missing import 制造目标红灯，先经 GPT 固定分页/权限不变量和负例再连续实现。一个 GLM writer 串行修改公共文件。未通过阶段 gate 不推进下一阶段实现。回滚代码不恢复被忘内容、不覆盖用户修正、不反向放开来源限制；保留旧 reader、设置原值和已保存资产。

## Validation Strategy

每张派工卡记录 REQ/AC/风险→变化→最小证据→通过条件→重跑触发。先 focused，再由一个执行者对冻结输入跑完整 gate/deploy；GPT 审查 diff、断言和原始证据并补真实 App 交互。复用有效证据，缺失不冒充通过。无运行时改动时只跑 docs:check/diff；本项不自动增加 release 或真机门禁，也不移除既有受影响门禁。

## Approval

- 用户授权：2026-09-14 在指定分支推进 B-140 开发；D1 已由用户决定。2026-09-16 用户明确选择 D2：记住/纠正的明确指令直接保存，仅歧义或风险时确认。
- 设计责任：GPT-6；原任务设计的阶段、质量与范围不缩减。

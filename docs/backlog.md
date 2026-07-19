# Project Backlog

Updated: 2026-07-19

这里是已经从 Linear inbox 晋升、但尚未开始或仍未完成的项目事项清单；raw PA idea 继续留在 Linear，不在这里制造低信号条目。已完成的版本、feature、SDD 和验证记录不在此重复；需要历史依据时进入 [Archive](./archive/README.md)。需要跨会话研究或讨论时先创建 [Discovery Brief](./development/discovery/README.md)；获批进入开发后按 [Documentation Workflow](./development/documentation-workflow.md) 建立活跃开发包。

## 下一步可执行

| ID | 事项 | 当前边界 | 下一步 | 依据 |
| --- | --- | --- | --- | --- |
| B-001 | Pagelet Tab 收尾验证 | Runtime 与 review follow-up 已落地；sticky nav、重开状态、mobile 与完整 app smoke 仍未闭环 | 执行 `make deploy`，验证 T3.3、T4.1-T4.3；iOS 使用 real-device smoke | [Tracker](./archive/pagelet-tab-restructure-tracker.md) |
| B-002 | Pagelet source-bound async result 完整体验 | Typed outcome 与 interim stale-result 修复已存在；统一 in-memory result store 与 Pet/Bubble ready-state 仍需按当前代码复核 | 先做 code-to-plan reconciliation，再为剩余 slice 建新 SDD；不要重复已实现部分 | [Historical plan](./archive/pagelet-async-result-plan.md) |
| B-003 | Android VSS 真机验证 | Desktop 与 iOS 有证据，Android parity 未验证 | 在物理 Android 设备验证 SQLite/WASM Memory backend 后再更新 README 声明 | [README note](../README.md#mobile-vss-validation-note) |
| B-004 | PA Agent telemetry baseline | Instrumentation 与 runbook 就绪，尚无 post-ship aggregate sample | 在明确 opt-in 后采集至少 7 天内容无关的聚合数据，再用于功能优先级判断 | [Runbook](./operations/pa-agent-telemetry-baseline.md) |
| B-005 | Featured Image Wan 2.7 live provider smoke | 自动化、构建、部署与既有图片渲染通过；真实生成未调用 | 仅在用户明确同意发送测试笔记内容并接受 API 成本后执行 | [Historical tracker](./archive/featured-image-model-upgrade-spec-driven-development.md) |
| B-006 | GitHub CI 首次远端验证 | 本地 workflow 命令已验证；`actionlint`、GitHub-hosted run 与 branch protection 未验证 | 在明确授权远端操作后验证首个 CI run，并决定 required checks | [Optimization final report](./archive/repo-wide-optimization-2026-07-10-final-report.md) |

## 已延期的产品与工程工作

| ID | 事项 | 重新启动条件 / 决策边界 | 依据 |
| --- | --- | --- | --- |
| B-101 | Operations Agent productization | 保持 `OPERATIONS_AGENT_RUNTIME_ENABLED=false`；启用前完成 action runtime、prompt split、setting semantics、安全 review 与真实 Obsidian smoke | [Boundary plan](./development/proposals/operations-agent/operations-agent-plan.md), [mode SDD](./development/proposals/operations-agent/operations-agent-mode-sdd.md) |
| B-102 | Obsidian Operations CLI adapter (v1B) | Desktop CLI reads 的用户价值足以覆盖 probe、allowlist、timeout、argv execution 与 vault confinement 成本时，重新开启 SPEC-05 | [Architecture plan](./architecture/obsidian-operations-agent-plan.md) |
| B-103 | 用户自定义 Skills | 先确认产品价值、工具权限、Settings UX 与 vault-side discovery 边界，再写 SDD | [Historical tracker](./archive/v2-post-release-spec-driven-development.md) |
| B-104 | PA Agent latency levers | 必须先有同口径 p50/p95 样本；再评估 read-only batch、compact final-answer 与 direct route | [Historical plan](./archive/pa-agent-latency-optimization-plan.md) |
| B-105 | Architecture quality pass | 以行为保持为前提，按独立 slice 处理 prompt/classifier builder、Chat lifecycle、VSS method extraction 与 DOM/WebWorker tsconfig | [Historical tracker](./archive/architecture-refactor-development-tracker.md) |
| B-106 | Settings IA 与 componentization | 完成长页面 IA、局部 rerender、Statistics hidden fields 决策、text-input save churn 审计与窄屏 Metadata 验证 | [Current status](./architecture/settings-status.md) |
| B-107 | UI/UX 延后项 | Community submission 前复议 Settings collapse 的 `localStorage`；出现并发 confirm caller 时处理 count atomicity；仅在高级 diagnostics 进入普通 UI 时做 jargon 清理 | [Historical UI tracker](./archive/pa-ui-ux-optimization-tracker.md) |
| B-109 | Memory Control Center 扩展 | Cross-vault understanding、自动同步、独立 Memory UI、import/export 或更大 action authority 都需要新的产品批准，不是当前迭代漏项 | [Current product spec](./product/specs/pa-memory-control-center-product-spec.md) |
| B-110 | Statistics 历史清理与 JSONL compaction | v2 文件只能通过单独审核的显式用户操作清理；只有观测到 JSONL 增长问题后才设计 compaction | [Statistics contract](./architecture/statistics-v3-plan.md) |
| B-111 | Repo-wide optimization follow-up | 先为 Discovery adapter error 建真实 harness；先证明 AbortSignal 端到端支持；历史 accepted-without-record 需要迁移决策；其余 defensive P3 按触发拆小任务 | [Final report](./archive/repo-wide-optimization-2026-07-10-final-report.md#uncompleted-and-deferred-work) |
| B-112 | 更宽的 Pagelet Trust / Maintenance proposal | 只有当前 Memory Control、source-backed review 与 move-only maintenance 无法满足真实用户需求时，才重开全局 Trust Layer 或更广 vault maintenance；写操作继续受 WAF/Operations Agent gate 约束 | [Trust proposal](./archive/pagelet-trust-layer-product-spec.md), [Maintenance proposal](./archive/pagelet-maintenance-review-product-spec.md) |
| B-113 | Memory status-transition contract extraction | 只有新的共享 UI/调用方确实需要复用迁移规则时，才讨论把 `VALID_STATUS_TRANSITIONS` 从 store 层移动到 contracts；不要仅因历史 review 做无消费者抽象 | [PR #376 review](./archive/pr-376-review-report.md) |
| B-114 | Hosted / commercial service layer | Free/Lite BYOK 需求被验证，且 Terms、privacy、billing、entitlement 与 counsel review 都完成后，才设计 Premium 托管层 | [Commercialization analysis](./archive/pa-commercialization-analysis-2026-07-08.md), [active decisions](./product/active-decisions.md) |
| B-116 | Pagelet 原 B-108 dogfood 延后范围 | 只在真实 dogfood 证据命中时分别重启：double-Ctrl 需跨平台冲突与实体操作证据；Chat Quick Command 需证明现有入口摩擦；`pa-related` frontmatter Sync 需先解决多设备冲突；Weekly Review compatibility helper 需兼容性证明后才移除；Pattern LLM 仅在结构检测不足且成本获批时考虑。`replace_selection` 继续由 B-101 / T-003 的写操作边界治理，不在此重复授权 | [Historical tracker](./archive/pa-product-redesign-development-tracker.md), [current B-108 package](./development/active/pagelet-b108-dogfood-followup/README.md) |

## 触发型评估

| ID | 评估项 | 触发条件 | 触发后入口 |
| --- | --- | --- | --- |
| T-001 | React → Preact | 新组件依赖 React-only 能力，或第三方库与 `preact/compat` 不兼容 | [Historical evaluation SDD](./archive/sdd-react-preact-evaluation.md) |
| T-002 | SQLite/WASM inline strategy | Mobile cold start ≥ 5s、三次独立 OOM，或 passive load P95 ≥ 5s | [Historical decisions](./archive/v2.1.2-decisions.md) |
| T-003 | Write-action production audit | 出现不明写入、需要可见 write history，或合规要求 durable audit | [Write Action Framework](./architecture/write-action-framework-sdd.md) |

## 维护规则

- 不在 Backlog 保留“Complete”行；完成后删除该行，并把最终证据放到 durable contract 或 archive。
- 新条目使用下一个未占用 `B-xxx`；先搜索重复项。触发型评估继续使用 `T-xxx`。
- 一旦需要产品决策、进入候选方向，或开始跨会话研究/执行，Linear 条目必须晋升为一个 repo-local Backlog ID 并双向链接；Linear issue 自身的持久化不算 promotion gate。没有可用外部链接的已晋升用户请求可以写 `User request YYYY-MM-DD`，不要求伪造文档链接。
- 复杂讨论链接 Discovery，不在 Backlog 表格复制 research、方案比较或聊天记录。
- Promotion 到 Active 时，Backlog ID 只有在 Accepted Decision、Approved Product Spec 与 Feature Home 都已接续后才能从本表删除；Rejected/Cancelled 项需要 Decision/Closeout 记录最终 outcome。
- 不把风险表中的所有历史 “Open” 自动视为待办；只有仍能在当前代码/产品边界中复现或有明确触发条件的事项进入这里。
- Backlog 条目只记录“还要做什么、何时做、依据在哪里”，不复制完整设计。

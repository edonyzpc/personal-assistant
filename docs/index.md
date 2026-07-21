# 项目文档导航

`docs/` 是需求、讨论、决策、产品/技术契约、开发执行与历史证据的 repo-local system of record。仓库外工具可以提供输入，但不承担 PA 的默认收件箱、规划镜像或当前权威。已完成的计划、SDD、Tracker、审计与过程证据统一进入 [archive](./archive/README.md)。

## 我现在要找什么

| 目的 | 入口 | 权威范围 |
| --- | --- | --- |
| 理解 PA 要做什么 | [Product](./product/README.md) | 北极星、产品原则、当前 Product Spec 与已接受决策 |
| 了解当前版本与方向 | [Development Roadmap](./development-roadmap.md) | 当前发布基线与候选主题 |
| 查看尚未完成的事情 | [Backlog](./backlog.md) | 唯一未完成事项清单；已完成事项不留在这里 |
| 记录/继续需求讨论 | [Discovery Registry](./development/discovery/README.md) | 跨会话需求、证据、选项与待决策项 |
| 查已接受或延期的决定 | [Active Decisions](./product/active-decisions.md) / [Decision Index](./product/decisions/README.md) | repo-local 决策、原因、边界与重启条件 |
| 查工程治理与 Agent/tooling 规则 | [Engineering Governance](./development/governance/README.md) | docs lifecycle、Agent workflow、checker、CI/release tooling 与工程授权边界 |
| 开始或继续开发 | [Development](./development/README.md) | 文档生命周期、SDD workflow、活跃开发包与验证规则 |
| 一眼查看正在开发什么 | [Active Registry](./development/active/README.md) | 当前 L2/L3 track、状态与 Feature Home |
| 复用文档结构 | [Templates](./development/templates/README.md) | Discovery、Decision、Product/Governance contract、Plan、SDD、Tracker、Closeout 模板 |
| 理解当前实现 | [Architecture](./architecture/README.md) | 当前 runtime、Memory/VSS、PA Agent、Settings、Statistics 契约 |
| 查用户操作方法 | [Guides](./guides/README.md) | 面向用户的稳定使用指南 |
| 发版、Beta、运行观测 | [Operations](./operations/README.md) | Release、BRAT、Telemetry runbook |
| 查历史决策或验证证据 | [Archive](./archive/README.md) | 已完成、已替代或仅用于溯源的文档 |

## 当前开发状态

- 活跃执行状态只看 [Active Registry](./development/active/README.md)，需求讨论状态只看 [Discovery Registry](./development/discovery/README.md)；本页不复制状态，避免漂移。
- 未开始、延期与触发型事项只看 [Backlog](./backlog.md)；本页不复制条目状态。
- Operations Agent 已有实现但仍由 runtime flag 禁用；现有设计放在 [proposals/operations-agent](./development/proposals/operations-agent/)，不代表已批准上线。

## 目录职责

| 目录 | 应放内容 | 不应放内容 |
| --- | --- | --- |
| `product/` | 当前产品标准、Product Spec、repo-local 决策 | 实现日志、阶段 Tracker、一次性 review |
| `architecture/` | 与当前代码一致的技术契约与状态入口 | 已完成迁移过程、旧架构方案 |
| `development/` | workflow、Discovery、Governance Contract、Active Package、模板、验证清单、明确 proposal | 已完成开发过程 |
| `guides/` | 当前可操作的用户指南 | 版本发布过程或内部设计 |
| `operations/` | release、beta、观测 runbook | 产品功能设计 |
| `archive/` | 历史方案、完成的 SDD/tracker、冻结审计、最终报告 | 当前状态或新的待办 |
| `assets/` | 当前文档和 README 使用的媒体资源 | 历史原型；历史资源放 `archive/assets/` |

## Agent 更新规则

1. 普通用户表达 idea、决定、规划、实现、继续或收尾意图时，默认由 [`pa-docs-lifecycle-manager`](../.agents/skills/pa-docs-lifecycle-manager/SKILL.md) 自动选择 lane、ID 与文档；随口 idea 留在当前对话，明确要求记录/保存，或达到 decision/version/cross-session research-or-execution gate 时，才创建或复用最小 `B-xxx`。不要让用户操作目录结构。
2. 按任务只读 [Documentation Workflow](./development/documentation-workflow.md) 的相关段落和对应当前权威；不要为例行 turn 预载 Roadmap、全部索引、模板或 Archive。按 L0/L1/L2G/L2/L3 选择最轻但完整的 lane。
3. 一个状态只能有一个权威来源：需求讨论看 Discovery，产品决定看 Decision，产品行为看 Product Spec，工程治理/tooling 看 Governance Contract，技术行为看 Architecture/SDD，执行进度看 Tracker，剩余工作看 Backlog。
4. 新 Product feature 或 L2G governance/tooling track planning 时，在 `docs/development/active/<feature>/` 建立 Feature Home、plan、tracker；SDD phase 再创建 SDD，且实现前必须 Approved。Feature Home 必须链接 Product Spec 或 Governance Contract 之一，不得混用。不要把过程文档重新堆回 `docs/` 根目录。
5. Closeout 必须写明每项信息进入 durable contract、Backlog、Archive 或 delete-after-absorption 的去向，再把完整 package 移入 `docs/archive/<year>/<feature>/`。
6. 移动、删除或归档后，同步更新索引、仓库引用与 [Disposition Log](./archive/disposition-log.md)，并运行 `npm run docs:check`。

当前分支与 BRAT 包装权威见 [GOV-002 Master-First Branch And Beta Packaging](./development/governance/gov-002-master-first-branch-and-beta-packaging.md)：所有已接受代码、测试、研究/文档和治理修改先进入 `master`，正式 beta 再从该精确基线创建。

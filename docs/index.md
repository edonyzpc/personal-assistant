# 项目文档导航

`docs/` 是需求、决策、产品/技术契约与开发执行的 repo-local system of record。仓库外工具可以提供输入，但不承担默认收件箱、规划镜像或当前权威。已完成的过程文档在结论吸收后默认删除；只有仍被当前源码或文档引用的独有历史证据进入 [Archive](./archive/README.md)。

当前实现事实只以仓库现有代码、脚本和配置为依据。Decision / Product Spec 记录产品选择，
Tracker / Archive 记录当时的过程与证据；这些记录本身不能证明当前实现、已安装构建或远端发布状态。
与代码不一致的旧说明应修正或明确标为历史、提案及尚未实现的范围。

## 我现在要找什么

| 目的 | 入口 | 权威范围 |
| --- | --- | --- |
| 理解 PA 要做什么 | [Product](./product/README.md) | 北极星、产品原则、当前 Product Spec 与已接受决策 |
| 查 Chat 图片生成与编辑 | [Product Spec](./product/specs/pa-chat-image-generation-product-spec.md) / [详细架构](./architecture/chat-image-generation-architecture.md) / [验收记录](./archive/2026/b133-chat-image-generation-validation.md) | 已确认产品选择、使用方法、技术契约与 Desktop/指定 iPhone 验收边界 |
| 查多模态 Chat 与图文保存 | [B-129 Product Spec](./product/specs/pa-multimodal-chat-product-spec.md) / [DEC-030](./product/decisions/dec-030-multimodal-chat-image-copywriting.md) / [Architecture](./architecture/multimodal-chat-architecture.md) / [使用指南](./guides/multimodal-chat-user-guide.md) | 当前产品与技术契约、操作说明及限定验证依据 |
| 了解当前版本与方向 | [Development Roadmap](./development-roadmap.md) | 当前发布基线与候选主题 |
| 查看尚未完成的事情 | [Backlog](./backlog.md) | 唯一未完成事项清单；已完成事项不留在这里 |
| 记录/继续需求讨论 | [Discovery Registry](./development/discovery/README.md) | 跨会话需求、证据、选项与待决策项 |
| 查已接受或延期的决定 | [Active Decisions](./product/active-decisions.md) / [Decision Index](./product/decisions/README.md) | repo-local 决策、原因、边界与重启条件 |
| 查工程治理与 Agent/tooling 规则 | [Engineering Governance](./development/governance/README.md) | docs lifecycle、Agent workflow、checker、CI/release tooling 与工程授权边界 |
| 查看测试审计设计与依据 | [GOV-004 设计](./development/governance/gov-004-test-audit-quality-preservation.md) / [B-150 验收快照](./archive/2026/b150-test-audit/final-report.md) / [覆盖地图](./archive/2026/b150-test-audit/coverage-map.md) | 当前审计规则与本轮已审、未审及验证边界 |
| 阶段性优化与精简测试 | [测试优化流程](./development/workflows/test-optimization-workflow.md) | 可复用步骤、候选裁决、证据复用与停止条件 |
| 开始或继续开发 | [Development](./development/README.md) | 文档生命周期、SDD workflow、活跃开发包与验证规则 |
| 一眼查看正在开发什么 | [Active Registry](./development/active/README.md) | 当前 L2/L3/L2G track 的入口；状态看 Tracker |
| 复用文档结构 | [Templates](./development/templates/README.md) | Discovery、Decision、Product/Governance contract、Feature Home、Plan、SDD 与 Tracker 模板 |
| 理解当前实现 | [Architecture](./architecture/README.md) | 当前 runtime、Memory/VSS、PA Agent、Settings、Statistics 契约 |
| 查用户操作方法 | [Guides](./guides/README.md) | 面向用户的稳定使用指南 |
| 发版、Beta、运行观测 | [Operations](./operations/README.md) | Release、BRAT、Telemetry runbook |
| 查历史决策或验证证据 | [Archive](./archive/README.md) | 已完成、已替代或仅用于溯源的文档 |

## 当前开发状态

- 活跃执行状态只看 [Active Registry](./development/active/README.md)，需求讨论状态只看 [Discovery Registry](./development/discovery/README.md)；本页不复制状态，避免漂移。
- 未开始、延期与触发型事项只看 [Backlog](./backlog.md)；本页不复制条目状态。
- Operations 的当前执行边界见 [DEC-051](./product/decisions/dec-051-proportionate-confirmation-and-contract-alignment.md) 与 [Architecture](./architecture/pa-agent-architecture-plan.md#operations-agent-providers)：在实际控制器与权限可用时，主 Agent 可执行当前明确修改请求；仅预览不执行，真实歧义或超授权仍需必要确认。旧 `operationsAgentEnabled` 是兼容字段，不再作为准入开关；结果、差异审阅和可用 Undo 按领域事实提供。

## 目录职责

| 目录 | 应放内容 | 不应放内容 |
| --- | --- | --- |
| `product/` | 当前产品标准、Product Spec、repo-local 决策 | 实现日志、阶段 Tracker、一次性 review |
| `architecture/` | 与当前代码一致的技术契约与状态入口 | 已完成迁移过程、旧架构方案 |
| `development/` | workflow、Discovery、Governance Contract、Active Package、模板、验证清单、明确 proposal | 已完成开发过程 |
| `guides/` | 当前可操作的用户指南 | 版本发布过程或内部设计 |
| `operations/` | release、beta、观测 runbook | 产品功能设计 |
| `archive/` | 当前 authority 仍引用的独有 rationale、迁移/发布/事故/验证证据 | 完整过程包、当前状态或新的待办 |
| `assets/` | 当前文档和 README 使用的媒体资源 | 历史原型；历史资源放 `archive/assets/` |

## Agent 更新规则

1. 需要持久记录 idea、创建/更新执行记录、变更权威文档或 closeout/archive 时，使用 [`pa-docs-lifecycle-manager`](../.agents/skills/pa-docs-lifecycle-manager/SKILL.md) 选择 lane、ID 与文档。普通讨论、只读状态查询和局部修复按 AGENTS 与现有契约执行；随口 idea 留在当前对话，明确要求记录/保存，或达到 decision/version/cross-session research-or-execution gate 时，才创建或复用最小 `B-xxx`。不要让用户操作目录结构。
2. 按任务只读 [Documentation Workflow](./development/documentation-workflow.md) 的相关段落和对应当前权威；不要为例行 turn 预载 Roadmap、全部索引、模板或 Archive。按 L0/L1/L2G/L2/L3 选择最轻但完整的 lane。
3. 一个状态只能有一个权威来源：需求讨论看 Discovery，产品决定看 Decision，产品行为看 Product Spec，工程治理/tooling 看 Governance Contract，技术行为看 Architecture/SDD，执行进度看 Tracker，剩余工作看 Backlog。
4. 跨会话执行以 Feature Home + Tracker 为最小 Active Package；仅在多阶段/风险管理需要时加 Plan，在复杂设计需要时加 SDD。Feature Home 必须链接 Product Spec 或 Governance Contract 之一，不得混用。
5. Closeout 先把稳定结论吸收到 durable contract、Backlog 或 tests，再删除过程文档；只有仍需当前源码或文档引用的独有证据才进入 Archive。
6. 移动、删除或归档后，同步更新索引和仓库引用，按 [Documentation Workflow](./development/documentation-workflow.md#默认删除) 的身份连续性要求更新 [Disposition Log](./archive/disposition-log.md)，并运行 `npm run docs:check`；无当前入链、未索引且无稳定身份的一次性草稿无需另建处置记录。

当前分支与 BRAT 包装权威见 [GOV-002 Master-First Branch And Beta Packaging](./development/governance/gov-002-master-first-branch-and-beta-packaging.md)：所有已接受代码、测试、研究/文档和治理修改先进入 `master`，正式 beta 再从该精确基线创建。

测试精简与执行优化的边界见 [GOV-003 Proportionate Test Design](./development/governance/gov-003-proportionate-test-design.md)。
本轮质量优先精简见 [GOV-005](./development/governance/gov-005-quality-first-test-reduction.md) 与 [B-151 最终验证](archive/2026/b151-test-reduction/final-report.md)。

流程与beta验证规则及B-156最终验证见[GOV-006](./development/governance/gov-006-lean-delivery-and-beta-validation.md)。

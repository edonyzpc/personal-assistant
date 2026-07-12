# Active Decision Register

Document status: Current
Updated: 2026-07-12
Authority: PA 跨 feature 的当前产品、架构和延期决策 repo-local 摘要。

本文件与 [Decision index](./decisions/README.md) 是仓库内权威。Chat、Linear、Claude/Codex Memory 或其他外部工具只能提供输入和镜像；若外部记录与本文件、Accepted Decision 或当前 Product Spec 冲突，必须先在仓库内完成 Decision/Spec 校准。

## 使用规则

- `DEC-xxx` 是稳定搜索 ID，不因文件移动而改变。
- 需要保留 Context、备选方案、后果或重启条件的决定，必须有独立 Decision Record。
- 小型长期约束可以只保留在本 register，但仍需 repo-local 依据。
- 已完成计划不属于 active decision；历史证据进入 Archive。
- Product Spec 对具体 feature 行为更详细；本 register 不复制完整设计。

## Active Product Decisions

| ID | Decision | Boundary / rationale | Current evidence | Revisit trigger |
| --- | --- | --- | --- | --- |
| DEC-002 | 产品北极星是“随手记下，需要时自然浮现”，设计约束是“安静且可信” | 优先用户真实笔记的轻量 Capture 与有证据的自然返回 | [North Star](./pa-product-north-star.md) | 用户明确选择新的产品方向 |
| DEC-003 | 保留“管理工具 + AI Chat/Memory”双产品线，不拆分插件；资源优先 AI 侧 | 管理能力仍是产品边界，AI 侧承担主要新增价值 | [Decision Record](./decisions/dec-003-dual-product-line.md), [Product IA](./pa-product-information-architecture-spec.md) | 用户明确批准拆分或产品定位改变 |
| DEC-004 | Quiet Recall 候选来自整个 vault，使用打开笔记、保存后自然间隙与快捷键等低打扰触发 | 回忆自己的内容，不制造待处理队列 | [Quiet Recall Spec](./specs/pa-quiet-recall-insight-timing-product-spec.md) | Dogfood 证明触发负担高于返回价值 |
| DEC-005 | Memory 默认自动提取，并以可见、可纠正、可撤销和 effect/risk 边界补偿信任 | 不采用逐条 clickworker 确认；高后果动作仍需披露或授权 | [Decision Record](./decisions/dec-005-memory-governance.md), [Memory Control Center](./specs/pa-memory-control-center-product-spec.md) | 真实安全事件或用户研究否定当前治理模型 |
| DEC-009 | Pagelet 保持安静、可忽略的 Pet/Bubble/Review delivery 模型 | 不把独立 AI 功能按钮和队列重新堆回 surface | [Pagelet Product Design](./pagelet-product-design.md) | 当前 delivery 无法满足真实 Capture/Recall 需求 |

## Active Architecture Decisions

| ID | Decision | Boundary / rationale | Current evidence | Revisit trigger |
| --- | --- | --- | --- | --- |
| DEC-001 | PA Agent 的内建远程 MCP-style WebSearch 使用窄 HTTP adapter，不引入通用 MCP SDK | 维持 allowlist、browser/mobile compatibility 与最小 capability surface | [Decision Record](./decisions/pa-agent-mcp-adapter-decision.md) | 多种远程 MCP capability 或标准 transport 成为已批准需求 |
| DEC-006 | Context 使用明确预算、Projector/Hygiene/Compactor 分层与受控 observation | 防止黑箱无限上下文并保持可诊断 | [PA Agent architecture](../architecture/pa-agent-architecture-plan.md), [runtime lifecycle](../architecture/pa-agent-runtime-lifecycle-plan.md) | Provider/context model 或可观测数据证明现有预算失配 |
| DEC-007 | SQLite/WASM 使用 `@sqlite.org/sqlite-wasm`，向量计算在 JS Worker 完成 | 官方 WASM 提供 durable storage/FTS；不依赖 sqlite-vector 扩展 | [VSS architecture](../architecture/vss-sqlite-wasm-architecture.md) | 移动端性能触发器或受支持扩展带来可验证收益 |
| DEC-008 | 保留 LangChain | 当前 runtime/structured-output 边界依赖已存在，bundle size 不是单独决策理由 | [Architecture overview](../architecture/architecture-overview.md) | 用户痛点或兼容性问题证明替换收益 |
| DEC-011 | 不为短期简化移除 CapabilityRegistry、PolicyEngine 或 capability kinds | 保留 read/network/action 安全边界与未来 Operations Agent gate | [Decision Record](./decisions/dec-011-capability-policy-boundary.md), [PA Agent architecture](../architecture/pa-agent-architecture-plan.md) | 新架构保留同等安全边界且通过批准 |
| DEC-012 | 保留 React；只在明确 compatibility trigger 下复议 Preact | 避免无用户价值的框架迁移 | [Backlog T-001](../backlog.md), [historical evaluation](../archive/sdd-react-preact-evaluation.md) | React-only 能力需求或 `preact/compat` 不兼容 |
| DEC-013 | Bundle size 不是独立重构驱动力 | 先解决可观察的冷启动、OOM 或兼容性问题 | [Backlog T-002](../backlog.md) | 已定义性能触发器命中 |

## Deferred Decisions

Deferred 的执行状态只在 Backlog 维护；本表记录为什么现在不做。

| ID | Decision | Current boundary | Restart authority |
| --- | --- | --- | --- |
| DEC-014 | Operations Agent productization 延期 | runtime flag 保持关闭，不能弱化 write/action gate | [Decision Record](./decisions/dec-014-defer-operations-agent.md), [Backlog B-101](../backlog.md) |
| DEC-015 | 用户自定义 Skills 延期 | 产品价值、权限与 Settings UX 尚未批准 | [Backlog B-103](../backlog.md) |
| DEC-016 | Premium 托管层延期 | 先验证 Free/Lite BYOK；Terms、privacy、billing 与 entitlement 未就绪 | [Decision Record](./decisions/dec-016-defer-hosted-premium.md), [Backlog B-114](../backlog.md) |

## Change Protocol

1. 搜索现有 `DEC-xxx` 与相关 Product Spec，避免重复决策。
2. 重要变更先创建/更新 Decision Record，再修改本 register 与 Product Spec。
3. Superseded 决策必须链接 successor；Rejected/Cancelled 的执行结果进入 Closeout 或 Archive。
4. 改动后运行 `npm run docs:check`。

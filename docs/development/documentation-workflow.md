# Product Documentation Workflow

Document status: Current
Updated: 2026-07-21
Authority: PA 需求、决策、工程治理、开发状态、验证与历史证据的唯一文档治理规则。

## 目标

`docs/` 只保存跨会话仍有价值的信息。Agent 应优先维护当前契约和可执行证据，避免把每次讨论、阶段状态和生成过程都固化成文档。

核心原则：

- 一个事实只有一个权威来源；索引只链接，不镜像状态。
- 当前契约优先于过程记录，结论优先于聊天转录。
- 使用能覆盖风险的最轻 lane；窄修复不创建完整 SDD 链。
- 过程文档完成吸收后默认删除；Archive 只保存仍被当前源码或文档引用的独有证据。
- 外部聊天、Issue、tracker 或本机 Memory 可提供输入，但不是 PA 当前权威。

## 自然语言入口与授权

默认由 [`pa-docs-lifecycle-manager`](../../.agents/skills/pa-docs-lifecycle-manager/SKILL.md) 解析用户意图。用户不需要选择 lane、ID、模板或目录。

- 随口 idea 留在当前对话，不创建 `B-xxx`。
- 明确“记录/保存”时，查重后只创建或复用一条最小 Backlog。
- 需要产品决策、进入版本候选、跨会话研究或执行时，先建立 repo-local `B-xxx`。
- “实现/修复”授权对应实现，不自动授权 closeout 或 commit。
- “收尾/关闭/归档”才授权终态处置。
- commit、push、tag、publish、release 始终分别授权。
- review-only、analysis-only、read-only、no-file-changes 一律零写入。

## Lane

| Lane | 适用场景 | 最小持久证据 |
| --- | --- | --- |
| L0 Fast change | 恢复既有契约的窄 bug、文案或文档维护 | 受影响代码/文档 + focused regression evidence |
| L1 Discovery / Decision | 需要跨会话研究、比较方案或产品取舍 | Backlog；按需 Discovery / Decision |
| L2G Governance | repo docs、Agent workflow、checker、CI/release tooling，不改变 PA 行为 | Current `GOV-xxx`；跨会话执行时加最小 Active Package |
| L2 Feature | 已批准且改变用户行为或多个模块 | Accepted Decision + Product Spec + Active Package |
| L3 Cross-cutting | 数据、隐私、安全、迁移、共享 runtime、release-sensitive UI 生命周期 | L2 + source-verified SDD、风险/回滚和对应 gate |

若 L2G 实施触碰 PA runtime、数据/隐私、Obsidian UI 或用户行为，立即升级到产品链。

## 权威地图

| 信息 | 唯一权威 | 说明 |
| --- | --- | --- |
| 产品方向 | `docs/development-roadmap.md` | 只记录方向与顺序 |
| 未开始/延期事项 | `docs/backlog.md` | 只保留 unresolved work |
| 跨会话研究 | Discovery Brief | 结论吸收后删除或保留独有证据 |
| 产品选择 | Decision Record | 长期 rationale |
| 用户行为 | Product Spec | 范围、非目标、REQ/AC |
| repo 工程规则 | Governance Contract | docs/checker/CI/release/Agent authority |
| 当前技术行为 | Architecture | 与代码同步 |
| 执行状态与验证 | Active Tracker | 唯一 delivery-status authority |
| 活跃入口 | Feature Home / Active Registry | 仅路由链接，不复制状态 |
| 历史证据 | Archive | 只读、按需保留，不驱动实现 |

产品 authority：North Star → Accepted Decision → Product Spec → Current Architecture → Tracker/代码/验证。工程治理 authority：用户授权 → Current Governance Contract → Tracker/tooling/验证。

## 1. Capture 与 Backlog

创建 `B-xxx` 前先查重。一条 Backlog 只写：期望结果、当前边界、下一步或启动条件、来源。来源可为 `User request YYYY-MM-DD`。

- Backlog 不是讨论稿或设计文档。
- L0 当次可完成时不创建 Backlog。
- Product work 进入 Accepted Decision + Product Spec + Active Package 后，可移出 Backlog。
- L2G 进入 Current Governance Contract + Active Package 后，可移出 Backlog。
- 删除未完成 ID 前，必须有 Active Tracker 或终态 authority 承接。

## 2. Discovery 与 Decision

只有跨会话研究、证据整理或方案比较才创建 Discovery Brief。内容压缩为事实、推断、未知项、选项和待决策项；不保存聊天逐字稿和重复 research dump。

改变产品范围、长期约束、重要风险接受、延期/拒绝/替代时创建 Decision Record。纯 repo governance/tooling 选择写入 `GOV-xxx`，不制造 Product Decision。

产品范围获批后，Product Spec 使用 `B-xxx/REQ-xx` 与 `B-xxx/AC-xx`。Spec 只描述稳定行为，不记录阶段任务和测试日志。

## 3. Active Package

需要跨会话执行的 L2/L3/L2G 使用：

```text
docs/development/active/<feature>/
  README.md   # 简短入口与 owning contract
  tracker.md  # 唯一执行状态、finding、验证证据
  plan.md     # 可选：多阶段、依赖、风险或回滚需要时
  sdd.md      # 可选：复杂设计、数据/生命周期/兼容性或多模块变更时
```

- [Active Registry](./active/README.md) 只登记 Work item、Feature Home 与 Tracker 链接。
- Feature Home 不复制 delivery status、阶段 task 或验证日志。
- Tracker 的 `Delivery status` 是唯一执行状态。
- Plan 只有在其内容无法简洁放入 Tracker 时才创建。
- SDD 只有在实现需要 source-verified design 时才创建；存在 SDD 且已进入实现时，必须为 `Approved`。
- Product Package 只链接 Decision/Product Spec；Governance Package 只链接 `GOV-xxx`。
- Tracker 映射 owning contract 的 REQ/AC；若存在 SDD，同步设计映射。

## 4. Delivery 与验证

每个行为 slice：

```text
implement → focused validation → review → fix → verify
```

需要 app-runtime 信心时才执行 `make deploy` 与 Obsidian smoke。Docs-only 不运行 Build 或 smoke。`Validated` 只表示证据门通过；`Shipped` 需要真实 release 证据。

状态集合：

- `Document status`: `Draft | Approved | Current | Superseded | Archived`
- Tracker `Delivery status`: `Planned | Implementing | Validating | Validated | Blocked | Cancelled | Closed`

## 5. Closeout、Archive 与删除

显式 closeout 后按以下顺序执行：

1. 对齐实际行为、owning Product/Governance contract、Architecture 与 Tracker。
2. 将未完成项压缩进 Backlog，并写启动条件。
3. 将最终决定、行为、迁移和验证证据吸收到当前 durable contract、focused test 或必要的操作文档。
4. 从 Active Registry 删除入口。
5. 对每份过程文档选择 `delete-after-absorption` 或 `archive`；默认删除。

### 默认删除

- Feature Home、Tracker、已完成 Plan/SDD。
- 逐轮 review/verification 日志、handoff、临时 baseline、重复 checklist。
- 已被 Decision/Product Spec/Governance/Architecture 吸收的讨论和 research dump。

当前文档删除需要在 [Disposition Log](../archive/disposition-log.md) 记录一条可审阅的路径或目录规则与吸收目标。无需为 Archive 内的历史噪声逐文件补写 disposition；Git 历史承担恢复。

### 仅在以下情况 Archive

- 当前 Product/Architecture/Governance/Backlog/Roadmap 或源码注释仍直接引用的独有 rationale。
- 法务、迁移、回滚、事故、发布或最终验证证据，且当前契约无法合理容纳。
- 一份紧凑 closeout 比把证据拆回多个当前文档更清晰。

Archive 是 opt-in evidence store：

- 不要求完整 package、年度 README 或穷举总索引。
- 保留文件必须至少有一个当前源码或文档入链；没有当前入链即视为可清理噪声。
- 历史文件内部可能提及已清理 companion；checker 不沿 Archive 内部链接扩张保留集合。
- Archive 文件不得作为当前实现或状态 authority。
- 选择的目标已存在时 fail closed，不覆盖、合并或自动改名。

Closed governance 保持已交付 `GOV-xxx` Current。Cancelled/Superseded contract 只有仍有长期解释价值时才归档；Superseded 必须链接 Current successor，否则使用 Cancelled。

## 查找与更新顺序

1. `git status` + 稳定 ID/slug/concept 搜索。
2. 只读匹配的 Backlog、Decision/Spec/GOV、Tracker。
3. 进入实现才读相关 Architecture/code/tests，以及实际存在的 Plan/SDD。
4. 创建 artifact 时才读对应 template。
5. 当前 authority 明确引用历史，或 closeout 评估独有证据时才读 Archive。

不要为了“同步”改写无语义变化的 Roadmap、索引、Feature Home 或过程日志。

## 验证门

文档新增、移动、closeout 或删除后运行：

```bash
npm run docs:check
git diff --check
```

`docs:check` 验证当前文档链接/路径、当前索引可达性、最小 Active Package、Tracker 状态、authority/traceability、当前文档删除连续性，以及 Archive 的当前源码/文档入链。它不要求 Archive 自成完整链接图，也不要求为历史清理回填整套 package。

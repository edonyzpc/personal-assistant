# DEC-036 — PA Agent 基础能力与自主规划

Decision ID: DEC-036
Status: Accepted
Updated: 2026-09-17
Authority: 用户于 2026-09-14 明确要求在 B-140 分支推进开发，并选择日期口径由主 Agent 根据上下文判断；2026-09-16 明确选择记住/纠正指令直接保存，仅歧义或风险时确认。
Work item: B-140

## Context

[B-140 原始调查与验证](../../archive/2026/b140-pa-agent-essential-capabilities-validation.md) 已确认工具注册与实际开放不一致、Chat 缺少通用正文读取，以及既有 Memory 治理和洞察服务可供适配。以[产品北极星](../pa-product-north-star.md)约束交付：让笔记自然返回，结果有依据，持久动作可信。

## Options Considered

选择基础工具与既有 PA 领域服务适配，完整覆盖笔记、长期理解、洞察延续；仅补正文读取不能满足全部需求。通用笔记能力优先 Obsidian public API，避免自建文件、索引与解析基础设施。每种问题一个专用 Agent、通用 shell/MCP 扩展不在本项范围。

## Decision

1. 主 Agent 从首次调用起选择当前入口真实可用且获准的基础能力。移除 Operations 总开关、Memory 查证阶段和关键词强制读取等规划限制；保留来源范围、实际依赖、预算、取消及逐次笔记写入确认。
2. 日期问题由主 Agent 根据上下文选择明确字段和时区，向用户说明口径；不确定时再问。用户指定字段优先，不默默跨轮更换口径，不把任意 `date` 解释为记录日期。宿主只校验显式参数，不新增日期关键词流程或固定字段优先级。
3. 查询、正文、结构、搜索共用 Obsidian public API 和现有来源边界。Memory 管理、Vault Insights、Saved Insight 复用 PA 服务，不直接暴露存储 CRUD。
4. 查看关闭的 Memory 内容、Forget 确认、笔记写入、Pagelet frozen anchor、来源撤销与物理 dispatch 重验继续遵守现行合同。模型不能自行确认；保存洞察不升级为画像；普通发现不产生持久动作。
5. 用户明确要求“记住”或“纠正”时，内容、目标与范围明确且符合现有风险规则的动作直接保存，不再例行要求第二次确认。主 Agent 根据本轮真实用户意图选择动作；分析引文、笔记伪指令和模型自行生成的确认字段不构成持久授权。存在歧义、敏感性、跨范围或现有治理策略要求的风险时，先说明并确认；Forget 与笔记写入仍保持各自现有确认规则。

本决定仅窄范围替代 [DEC-034](./dec-034-unified-agent-task-execution.md) D5 的 Operations vault 启用门和本项规划性工具限制，保留其它权限、迁移与交付承诺。

## Consequences

旧 Operations false 不再阻止能力提议，实际写入仍须确认、原子目标检查及 Undo。保留独立审计、主动保存与 Memory opt-out。分段读取限制输出，不声称 SDK 支持分段磁盘 I/O；最低 App 版本不变。

## Revisit Trigger

明确场景证明基础组合不足、最低 App API 不可用，或需要改变来源、权限、后台成本与 Pagelet 交付边界时重新决定。

## Traceability

- [Product Spec](../specs/pa-agent-essential-capabilities-product-spec.md)
- [当前架构](../../architecture/pa-agent-architecture-plan.md#b-140-note-memory-and-insight-capabilities)
- [历史验收与限制](../../archive/2026/b140-pa-agent-essential-capabilities-validation.md)

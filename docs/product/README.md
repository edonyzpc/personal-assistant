# Product 文档

本目录只保存长期有效的产品标准与当前 Product Spec。实现进度、验证日志和已经完成的开发计划不放在这里。

## 顶层标准

- [PA Product North Star](./pa-product-north-star.md) — 所有产品、UX、SDD 与 Pagelet/Memory 行为的最高标准。
- [Active Decision Register](./active-decisions.md) — repo-local 的当前产品/架构/延期决策摘要。
- [Decision Index](./decisions/README.md) — 需要完整 Context、Options、Consequences 与 Revisit trigger 的正式决策记录。
- [Low-Burden Review Principles](./pa-low-burden-review-product-principles.md) — 低管理负担与渐进信任原则。
- [Product Information Architecture](./pa-product-information-architecture-spec.md) — 当前信息架构与 surface 分工。
- [Pagelet Product Design](./pagelet-product-design.md) — Pagelet 当前产品模型。

## Capture、Recall 与 Context

- [完整笔记查询](./specs/pa-complete-note-query-product-spec.md) — B-169：一次条件查询返回完整轻量列表，正文按需；[执行记录](../development/active/complete-note-query/tracker.md)。

- [Chat THINKING 可解释执行过程](./specs/pa-chat-thinking-process-product-spec.md) — B-168：原位细轨道、整轮耗时、当前 reasoning 与轻量历史；[当前接线](../architecture/pa-agent-debug-view.md#chat-thinking-投影与持久化)及[最终验证](../archive/2026/b168-chat-thinking-process-validation.md)。
- [Agent Debug 完整轨迹与双端查看](./specs/pa-agent-debug-explorer-product-spec.md) — B-167：聚焦展开、节点定位搜索、桌面右侧详情与移动独立详情页；[当前机制](../architecture/pa-agent-debug-view.md)与[最终验证](../archive/2026/b167-agent-debug-explorer-validation.md)。
- [PA Agent 快照执行与完整 Debug](./specs/pa-agent-snapshot-execution-product-spec.md) — B-165：当前生成快照、下一轮配置更新、完整文本历史；[当前机制](../architecture/pa-agent-architecture-plan.md#source-and-trust-boundaries)。
- [必要确认与合同接续](./specs/pa-contract-alignment-product-spec.md) — B-161：已完成本地对齐的直接执行、选源、预算、容量与旧合同接续；证据与限制见 [最终验证](../archive/2026/b161-contract-alignment-validation.md)。
- [PA Agent Command Contract](./specs/pa-agent-command-contract-product-spec.md) — B-158：统一职责、SDD/验收与公共框架后领域迁移。
- [执行事实连续性](./specs/pa-action-continuity-product-spec.md) — B-157：合法动作状态、保存重开与压缩摘要，历史验收与限制见 [最终验证](../archive/2026/b157-context-action-continuity-validation.md)。

- [Agent 响应性](./specs/pa-agent-responsive-execution-product-spec.md) — B-155 已交付非阻塞设计；持续来源复核目标由 B-165 局部接续。
- [Note Change Review](./specs/pa-note-change-review-product-spec.md) — B-154：按笔记最终差异、Chat/tab 审阅与 Operations 审计退役。
- [PA Agent 问答范围与 Runtime 演进](./specs/pa-agent-runtime-evolution-product-spec.md) — B-149 已交付：我的笔记 / 网络资料 / 综合模式、上下文硬边界与五项架构演进；产品决定见 DEC-043。
- [PA Agent Task Source Boundary](./specs/pa-agent-task-source-boundary-product-spec.md) — B-146 已按后续产品决定完成本地验收：Agent 自主取材、Host 保留明确运行保护；事实质量改进另见 B-148。
- [PA Agent Debug View 与本机历史设计](./specs/pa-agent-debug-view-product-spec.md)
- [Recoverable Agent Execution](./specs/pa-recoverable-agent-execution-product-spec.md) — B-144 已交付 DEC-040 的 30 分钟尝试、自主恢复、领域交付与受控并发行为。
- [PA Agent Essential Capabilities](./specs/pa-agent-essential-capabilities-product-spec.md)

- [Quick Capture and Micronote](./specs/pa-quick-capture-micronote-product-spec.md)
- [Quiet Recall and Insight Timing](./specs/pa-quiet-recall-insight-timing-product-spec.md)
- [Context Pager](./specs/pa-context-pager-product-spec.md)
- [Context Management and Conversation Continuity](./specs/pa-context-management-product-spec.md)
- [Multimodal Chat and Image Copywriting](./specs/pa-multimodal-chat-product-spec.md)
- [Chat Image Generation and Editing](./specs/pa-chat-image-generation-product-spec.md) — B-133 已确认产品范围；[当前架构](../architecture/chat-image-generation-architecture.md)与[历史验收](../archive/2026/b133-chat-image-generation-validation.md)承接设计及证据。
- [Unified Chat Image Creation](./specs/pa-unified-chat-image-creation-product-spec.md) — B-152：明确文字来源、专用配图提炼与 command 快捷入口。
- [Lightweight Graph Discovery](./specs/pa-lightweight-graph-discovery-product-spec.md)
- [Scope Recap and Theme Summary](./specs/pa-scope-recap-theme-summary-product-spec.md)
- [Retrieval Habit Profile](./specs/pa-retrieval-habit-profile-product-spec.md)

## Memory、Insight 与 Review

- [Memory Marker Recovery](./specs/pa-memory-marker-recovery-product-spec.md) — B-164：marker 异常优先复用本地数据的稳定产品范围。
- [First-Run AI Setup and Silent Memory Preparation](./specs/pa-silent-first-use-memory-preparation-product-spec.md)
- [Memory Control Center](./specs/pa-memory-control-center-product-spec.md)
- [Memory Type Taxonomy](./specs/pa-memory-type-taxonomy-product-spec.md)
- [Saved Insight and Insight Ledger](./specs/pa-saved-insight-ledger-product-spec.md)
- [Insight Enhancement Layer](./specs/pa-insight-enhancement-layer-product-spec.md)

## Share And Reuse

- [Note Image Removal](./specs/pa-note-image-removal-product-spec.md) — B-160：联合移除笔记图片与附件、共享引用保护和临时一键撤销。
- [Ghost Blog Publishing](./specs/pa-ghost-blog-publishing-product-spec.md) — B-163 精简目标：note 全量同步、真实 URL 人工预览、Ghost Publish / PA 确认更新；B-153 历史验收不代表新方案已实现。
- [Share Card](./specs/pa-share-card-product-spec.md)
- [Share Card Print Styles](./specs/pa-share-card-print-styles-product-spec.md)

## Pagelet Delivery

- [Attention-Aware Delivery and Action Ring](./specs/pagelet-attention-aware-delivery-product-spec.md)
- [Bubble Readiness and Recall](./specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- [Delivery Preparation Consolidation](./specs/pagelet-delivery-preparation-consolidation-product-note.md)
- [Pagelet UI/UX Hardening](./specs/pagelet-ui-ux-hardening-product-spec.md)

## Shared Product Infrastructure

- [PA Tag Appearance](./specs/pa-tag-appearance-product-spec.md) — B-166：默认关闭的标签外观、完整名称固定九色与当前主题恢复边界。
- [Plugin Shell Refactor](./specs/pa-plugin-shell-refactor-product-spec.md) — 保持现有功能、限定生命周期修复与模块所有权边界。
- [Bounded Code Cleanup](./specs/pa-bounded-code-cleanup-product-spec.md) — 有界清理、旧 Pagelet 范围控件退役及保留能力边界。
- [Unified Agent Task Execution](./specs/pa-unified-task-execution-product-spec.md)

- [Simple Settings](./specs/pa-simple-settings-product-spec.md)
- [Active Vault Indexer](./specs/pa-active-vault-indexer-product-spec.md)
- [Data Boundary](./specs/pa-data-boundary-product-spec.md)
- [Eval Harness](./specs/pa-eval-harness-product-spec.md)
- [PA Agent MCP Adapter Decision (DEC-001)](./decisions/pa-agent-mcp-adapter-decision.md)

新 Product Spec 使用 [Product Spec template](../development/templates/product-spec.md)，Accepted Decision 使用 [Decision template](../development/templates/decision.md)。外部工具只能镜像，不得成为当前产品决策的 source of truth。

Weekly Review 的独立产品形态已经被拆解并移除；历史 Spec 保存在 [archive](../archive/pa-weekly-review-product-spec.md)，不能作为当前入口。

更宽的 Pagelet Trust Layer 与 Maintenance Review 仍是未激活 proposal，已归档到 [Trust Layer](../archive/pagelet-trust-layer-product-spec.md) / [Maintenance Review](../archive/pagelet-maintenance-review-product-spec.md)，重新启动条件见 [Backlog B-112](../backlog.md#已延期的产品与工程工作)。

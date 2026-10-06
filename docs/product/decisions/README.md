# Product Decision Index

Document status: Current
Updated: 2026-10-06
Authority: 需要完整 rationale 的 repo-local PA Decision Record 索引。

[Active Decision Register](../active-decisions.md) 提供跨 feature 摘要；本目录保存重要决定的 Context、Options、Decision、Consequences 与 Revisit trigger。新建记录使用 [Decision template](../../development/templates/decision.md)。

| ID | Decision | Status | Scope | Record |
| --- | --- | --- | --- | --- |
| DEC-053 | 精简 Ghost 同步与人工上线 | Accepted | note 全量同步；草稿 Ghost Publish，已发布临时预览后 PA 确认；取消历史/恢复与自动 probe，目标尚待实施 | [Record](./dec-053-lean-ghost-publishing.md) |
| DEC-052 | Open prepared review 沿用深度发现 | Accepted | 2026-10-06 接受现有显式发现路由及其可能的网络/额度使用；Open Pagelet 仍零调用，不回填旧批准或验收 | [Record](./dec-052-prepared-review-deep-discover-route.md) |
| DEC-051 | 必要确认、前后台预算与合同接续 | Accepted | 局部接续旧确认/容量条款，保留来源、Writing与Ghost边界；设计不等于实现 | [Record](./dec-051-proportionate-confirmation-and-contract-alignment.md) |
| DEC-050 | 笔记图片联合删除与一键撤销 | Accepted | 共享引用阻止删除、临时快照一键撤销；不授予运行代码实施 | [Record](./dec-050-note-image-removal-and-undo.md) |
| DEC-049 | Command、Agent、Host、Tool 统一契约 | Accepted | 架构与工作流先行，再公共框架及领域迁移；既有权限保持 | [Record](./dec-049-command-agent-host-tool-contract.md) |
| DEC-048 | Context 保留合法执行事实 | Accepted | B-157 四域状态、来源准入与压缩摘要；不新增 Host 意图分类器 | [Record](./dec-048-action-facts-and-context-continuity.md) |
| DEC-047 | Agent 执行不能阻塞 Obsidian 原生操作 | Accepted | 分层来源准入、有界 renderer 工作、保留来源撤销与已读快照；最低充分桌面/mobile 验证 | [Record](./dec-047-agent-responsive-execution.md) |
| DEC-046 | 笔记最终差异审阅与 Operations 审计退役 | Accepted | Chat 紧凑差异、手动完整审阅 tab；确认由 DEC-051 接续，停写审计且不处理旧目录 | [Record](./dec-046-note-change-review-and-audit-retirement.md) |
| DEC-045 | Ghost 预览确认发布 | Accepted | B-153 历史选择；转换/媒体边界保留，流程、字段与恢复由 DEC-053 局部接续 | [Record](./dec-045-ghost-blog-publishing.md) |
| DEC-044 | Unified Chat image creation | Accepted | 单一 CreateImage、明确文字来源、保留专用提炼；原 command 成为 Chat 快捷入口 | [Record](./dec-044-unified-chat-image-creation.md) |
| DEC-043 | PA Agent 问答范围硬约束与 Runtime 演进 | Accepted | B-149 已交付三种显式范围、默认笔记、派生上下文准入、切换取舍与五项架构演进；局部接续 DEC-042 | [Record](./dec-043-agent-runtime-evolution-and-source-scope.md) |
| DEC-042 | PA Agent task source boundary and revisable plan | Accepted | B-146 已本地验收：Agent 遵循自由语言取材限制、Host 不硬拦普通读取；独立权限和高后果保护保留 | [Record](./dec-042-agent-task-source-boundary.md) |
| DEC-041 | Agent Debug View and bounded local history | Accepted | Chat 阶段轨迹、正文与过滤 Prompt、最多 30 天加容量滚动淘汰、会话 reasoning、删除联动与媒体引用边界 | [Record](./dec-041-agent-debug-view-and-local-history.md) |
| DEC-040 | Recoverable Agent task execution | Accepted | B-144 已交付已读版本、自主纠错、单次尝试默认 30 分钟、前后台完成导向与受控并发、writing 领域化、真实交付及重载后用户继续 | [Record](./dec-040-recoverable-agent-execution.md) |
| DEC-039 | Behavior-preserving plugin shell refactor | Accepted | 保持完整正常功能，按状态/资源所有权逐片迁移；限定 Pagelet、metadata、Callout 生命周期修复，性能不设改进目标 | [Record](./dec-039-plugin-shell-refactor.md) |
| DEC-038 | Chat image generation and unified image connection | Accepted | Wan 创建/参考/编辑、后台恢复、确切版本与复制下载；Chat/Featured Image 统一连接；透明确认与删聊天仅留文件 | [Record](./dec-038-chat-image-generation.md) |
| DEC-037 | PA Agent essential capabilities | Accepted | 基础工具自主规划；日期口径由主 Agent 按上下文选择；官方 API 优先 | [Record](./dec-037-pa-agent-essential-capabilities.md) |
| DEC-036 | Share Card per-export print styles | Accepted | 每次 Modal 默认原纸且不记忆；轻印/复印分层处理标题与正文，保护代码、视觉、品牌和宿主主题，并保持 preview/Copy/Save 一致 | [Record](./dec-036-share-card-print-styles.md) |
| DEC-035 | Bounded cleanup and Pagelet scope retirement | Accepted | 删除旧 Panel 范围控件；保留当前 Deep Discover、旧命令、来源边界及已确认外围功能；其余清理保持有效行为 | [Record](./dec-035-bounded-cleanup-and-pagelet-scope-retirement.md) |
| DEC-034 | Unified Agent task execution | Accepted | B-135 已交付的主 Agent 语义、个性化取材、来源准入、作品交付、恢复与兼容边界；历史验证已归档 | [Record](./dec-034-unified-agent-task-execution.md) |
| DEC-033 | Simple settings and unified defaults | Accepted | B-106 必要机制内置；2026-09-09 修订的长期提取与本地习惯学习默认开启、独立退出和旧值迁移已由 B-135 交付；废弃规则仍只限明确撤销项 | [Record](./dec-033-simple-settings-and-unified-defaults.md) |
| DEC-001 | PA Agent builtin MCP-style WebSearch adapter | Accepted | PA Agent network-read capability | [Record](./pa-agent-mcp-adapter-decision.md) |
| DEC-003 | Preserve the dual product line | Accepted | Product boundary and investment direction | [Record](./dec-003-dual-product-line.md) |
| DEC-005 | Transparent and reversible Memory governance | Accepted | Memory trust and permission model | [Record](./dec-005-memory-governance.md) |
| DEC-011 | Preserve capability and policy boundaries | Accepted | PA Agent/action safety architecture | [Record](./dec-011-capability-policy-boundary.md) |
| DEC-014 | Bound Operations Agent to explicit vault opt-in | Accepted | Write/action product exposure | [Record](./dec-014-defer-operations-agent.md) |
| DEC-016 | Defer hosted Premium layer | Deferred | Hosted/commercial service | [Record](./dec-016-defer-hosted-premium.md) |
| DEC-017 | Default bounded background preparation for Scope Recap | Accepted | Pagelet Recap trigger, data and cost boundary | [Record](./dec-017-default-background-recap-preparation.md) |
| DEC-018 | Quality-gated proactive hints for Scope Recap | Accepted | Pagelet Recap visibility, attention and suppression boundary | [Record](./dec-018-quality-gated-scope-recap-hints.md) |
| DEC-019 | Honest layered fallback for failed Scope Recap preparation | Accepted | Pagelet Recap failure, last-valid artifact and local explanation boundary | [Record](./dec-019-honest-layered-recap-fallback.md) |
| DEC-020 | Independent AI evaluation for each Quiet Recall candidate | Accepted | Quiet Recall quality, failure isolation and provider-call budget boundary | [Record](./dec-020-independent-quiet-recall-evaluation.md) |
| DEC-021 | Evidence-led Pagelet UI/UX hardening | Accepted | Staged repair scope, evidence boundaries and resolved SG dispositions | [Record](./dec-021-evidence-led-pagelet-ui-ux-hardening.md) |
| DEC-022 | Bounded, source-backed Insight Enhancement Layer | Accepted | Graph、Pattern、Maintenance AI scope, provider budget and write boundary | [Record](./dec-022-bounded-insight-enhancement-layer.md) |
| DEC-023 | Shared non-blocking first-use notice for bounded Pagelet provider paths | Accepted | Pagelet provider trust, foreground Review actual-source classification, narrow background preload envelope, high-risk-first-call disclosure, and capability opt-out boundary | [Record](./dec-023-shared-pagelet-provider-first-use.md) |
| DEC-024 | Count cold Quiet Recall semantic retrieval in its existing actual-call budget | Accepted | Pure-semantic candidate discovery, zero-call boundary, and metadata fallback semantics | [Record](./dec-024-quiet-recall-cold-semantic-retrieval.md) |
| DEC-025 | Consumption-aware Pagelet delivery and empty-state Action Ring | Accepted | Device-local seen suppression；four-action Ring with visible EN/ZH localized labels；Desktop/iPad inward-arc-first with whole-group compact fallback；iPhone full-row/whole-column responsive layout | [Record](./dec-025-consumption-aware-pagelet-delivery.md) |
| DEC-026 | Local, explicit full-fidelity Share Card export | Accepted | Four entries including Ring selection-first/current-note fallback；valid-YAML/basename projection；graphic brand/local data-URL font；single-page enlarge and multi-page adaptive batch font；per-Modal output folder；exact SnapDOM 2.23.2；no proxy | [Record](./dec-026-local-share-card.md) |
| DEC-027 | Bounded, convergence-aware retrieval recovery | Accepted | Owner-selected `CHAR-PHRASE` profile；bounded rerank/PPR/retry；B-125 software proxy、Win32 scoped exclusion、independent evidence slices and 3–4 targeted current-iPhone canaries；implementation/validation and per-flag rollout disposition closed；DEC-031 now extends B-125 with the shipping default；33/47、p95/profiler certification remains in B-127 | [Record](./dec-027-bounded-retrieval-recovery.md) |
| DEC-028 | Silent Memory auto-prepare for first-use | Accepted | Owner-approved 2026-08-11 first-Chat exception plus same-day option 1: unknown IndexedDB marker truth blocks destructive reset/provider work; failed/cancelled rebuilds retain their original reason, failed admission rolls back to non-ready, and recovery/manual paths still block | [Record](./dec-028-silent-memory-auto-prepare.md) |
| DEC-029 | Inline AI setup and first Settings focus | Accepted | Owner-approved 2026-08-23 scoped B-126 slice: three built-in Chat presets, token-only/existing-token preservation, explicit token probe, compensated save, and persisted first-Settings focus | [Record](./dec-029-inline-ai-setup-and-settings-focus.md) |
| DEC-030 | Multimodal Chat and image-based social copywriting | Accepted | B-129 用户已确认的产品边界；图片理解、文案与显式图文保存，原图保留、同设备续聊、类似场景风格参考；技术方案与实施授权分开 | [Record](./dec-030-multimodal-chat-image-copywriting.md) |
| DEC-031 | Platform-scoped B-125 retrieval shipping default | Accepted | Owner-approved 2026-09-04 all-four build-default-on for explicit macOS/Linux/iOS；Win32/Android and unknown/partial identity without an allowlist signal fail closed through `windows` / `android` / `unsupported` masks；sparse explicit false rollback without settings backfill；no UI、Beta-only special case or algorithm/provider/Data Boundary/budget change | [Record](./dec-031-b125-retrieval-shipping-default.md) |
| DEC-032 | Context reliability and conversation continuity | Accepted | Owner-approved 2026-09-05 deterministic reliability, truthful Context receipt and independent conversation-continuity evaluation; Memory remains separate | [Record](./dec-032-context-reliability-and-conversation-continuity.md) |

Accepted 记录必须出现在 Active Decision Register。Rejected/Superseded 记录如果只剩历史价值，应移动到年度 Archive 并在 successor/年度索引中可追溯。

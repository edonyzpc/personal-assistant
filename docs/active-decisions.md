# Active Decisions (PA Project)

> Exported from Claude Code memory system. Last sync: 2026-07-08.
> Source of truth: ~/.claude/projects/-Users-edony-code-personal-assistant/memory/
> This file is for Codex and other tools to read. Claude Code reads the source memory files directly.

## Product Direction

- **North Star**: "随手记下，需要时自然浮现" — source: project_north_star_redesign.md
- **Design philosophy**: "安静且可信"（约束层，非定位层） — source: project_north_star_redesign.md
- **Dual product lines**: 管理工具 + AI Chat/Memory，优先 AI 侧。不拆分 — source: project_product_positioning.md
- **Target**: C 端出海，独立开发者 — source: user_product_direction.md
- **Quiet Recall 候选池**: 整个 vault，不限于 Saved Insights — source: project_product_discussion_20260702.md
- **Recall 触发**: 三层（打开笔记/保存后/快捷键） — source: project_product_discussion_20260702.md
- **Memory 提取**: 全自动 + 透明度补偿（可见+可撤销），非逐条确认 — source: project_uiux_audit_v2_decisions.md #6
- **Memory 质量过滤**: 置信度分级 + inferred_behavior 跨 3 次对话重复确认 — source: project_context_memory_architecture.md #8.3

## Active Architecture Decisions

- **Context limits**: 128K 基线，maxObservationChars=64000, MAX_CHAT_HISTORY_TURNS=40 — source: project_context_limits_decision.md
- **Context Projector**: 4 独立类 + Manager 组合 — source: project_context_memory_architecture.md #3
- **Micro-compaction**: 混合策略（预算压力驱动 + 最近 2 轮保护） — source: project_context_memory_architecture.md #4
- **Architecture refactor**: 渐进式 5 Phase，PluginManager 2300→~600 行，Multi-port 窄接口 — source: project_architecture_refactor_plan.md
- **Tier pricing**: Free/Lite/Premium 三层，先建 Free+Lite BYOK — source: project_tier_pricing_strategy.md
- **WASM**: 已迁移到 @sqlite.org/sqlite-wasm，JS 端向量计算 — source: project_wasm_supplier_migration_plan.md [DONE]
- **LangChain**: 保留，不移除 — source: project_langchain_keep.md
- **Pagelet v2**: Pet 固定角落 + 4 状态 + 预加载模型 — source: project_pagelet_v2_design.md

## Active "Don't Do" Directives

- **不拆分插件**或弱化管理工具功能 — source: project_product_positioning.md
- **不简化 CapabilityRegistry / PolicyEngine / capability kinds** — 为 Action Mode 预留 — source: project_action_mode_roadmap.md
- **Ollama / 本地模型**不在主线 — source: project_ollama_not_priority.md
- **不移除 LangChain** — source: project_langchain_keep.md
- **不降级 React 19** — source: project_v2_review_decisions.md
- **Bundle size 不作为决策驱动力** — 无用户痛点驱动前不考虑 — source: project_v2_1_review_decisions.md §8

## Deferred Items

- **Operations Agent mode (Layer 2)**: v2.x 后期目标，不绑版本 — source: project_action_mode_roadmap.md
- **Skill 用户自定义扩展 (C2)**: 推迟，产品价值不明确 — source: project_v27_release_plan.md
- **React → Preact**: 复议条件 = React 独占特性 / preact compat 不兼容 — source: project_react_evaluation_trigger.md
- **Premium 托管层**: 先验证 Lite 需求 — source: project_tier_pricing_strategy.md

## Feedback & Conventions

- **验证用 `make deploy`** 而非 `npm test` — source: feedback_make_deploy.md
- **不加 Co-Authored-By**，必须 `git commit -s` — source: feedback_no_coauthor.md
- **@deprecated 标记**必须有版本/日期下线锚点 — source: project_deprecated_removal_convention.md
- **UI/UX 审计**用 5 模式方法论（研究框架/扇出审计/对抗验证/决策路由/循环工程） — source: feedback_ui_ux_review_methodology.md

## Completed Plans (reference)

- WASM @sqliteai → @sqlite.org 迁移 (2026-06-16)
- apiToken v1.x 迁移代码删除 (2026-06-17)
- v2.7 合并发布 (2026-06-20)
- Write Action Framework v1 验证 (2026-06-16)
- v2.0.0 发版 (2026-05-29)

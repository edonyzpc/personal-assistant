# Memory 大扫除 Spec

> 来源：2026-07-08 复盘。可由 Claude Code 或 Codex 执行。

## Context

PA 项目的决策记录系统（memory）包含 35 个文件，约 40% 存在以下问题：
- **已完成但未标记**的计划（WASM 迁移、apiToken 删除、v2.7 发布）
- **被后续决策覆盖**但原文件未更新的指令
- **北极星变更后**下游 `How to apply` 未对齐
- **2 个孤立文件**不在索引中
- **Action Mode 优先级**描述与实际不符

这直接影响 AI 工具在新 session 中的决策准确性。

### 2026-07-08 复盘做出的决策（本 spec 的前置输入）

1. **Memory 提取模型** → 自动提取 + 透明度补偿 + #8.3 质量过滤。§4.7 重定义为"可见+可撤销"。**已更新 ✓**
2. **Action Mode 优先级** → 仍在 v2.x 路线，"必交付"改为"后期目标"。架构保护不变
3. **Memory Codex 可达性** → 双写：Claude memory 原位保留 + 导出 `docs/active-decisions.md` 到 repo

## Memory 文件路径

```
~/.claude/projects/-Users-edony-code-personal-assistant/memory/
```

如果执行环境无法访问此路径，需先将 memory 目录复制到 repo 内临时位置（如 `.memory-staging/`），操作完成后由用户同步回原位。

## 执行步骤

**严格按 Step 1 → 8 顺序执行。**

---

### Step 1: 修复孤立文件

2 个文件存在于磁盘但不在 `MEMORY.md` 索引中。在 `MEMORY.md` 末尾添加：

```markdown
- [Tab restructure plan](project_tab_restructure_plan.md) — Tab UI 重构：入口感知+折叠+Section 渲染器拆分+移除 Weekly Review
- [UI/UX audit v1 decisions](project_ui_ux_audit_decisions.md) — 2026-07-03 首轮审计确认结果，含误判修正和 F1-F8 决策
```

---

### Step 2: 标记已完成的 plan

| 文件 | 已完成内容 | 验证命令 |
|------|-----------|---------|
| `project_wasm_supplier_migration_plan.md` | @sqliteai → @sqlite.org 迁移 | `grep "@sqlite.org" package.json` |
| `project_v2_release_notes.md` | v2.0.0 发版 changelog | `git tag -l "2.0*"` |
| `project_v27_release_plan.md` | v2.7 合并发布 + v2.8 | `git tag -l "2.7*" "2.8*"` |

对每个文件执行两步：

**a)** 在 frontmatter `metadata:` 下添加 `status: done`：
```yaml
metadata:
  type: project
  status: done         # ← 添加这行
```

**b)** 在正文第一行（frontmatter `---` 之后的第一行）插入：
```markdown
> **[DONE 2026-07-08]** 此计划已完成。保留作为历史决策参考。
```

---

### Step 3: 标记被覆盖的决策

在以下文件的被覆盖内容处添加标注。**不删除原文**，只在相关段落前/后插入标注。

#### 3.1 `project_v2_release_schedule.md`

在 `## v2.x 主线规划` 表格前插入：
```markdown
> **[SUPERSEDED 2026-07-08]** 以下版本规划已被实际发布节奏取代。v2.7.0~v2.8.4 于 2026-06-20~06-28 发布。apiToken 迁移代码于 2026-06-17 提前删除（commit 3536e90）。
```

#### 3.2 `project_v24_insight_decisions.md`

在第 5 条 "Action Mode 推迟到 v2.5" 后追加：
```markdown
> **[SUPERSEDED 2026-07-08]** Action Mode 优先级调整为 v2.x 后期目标（非版本绑定），见复盘确认。
```

#### 3.3 `project_context_memory_architecture.md`

在 `### 9. 版本归属` 的代码块前插入：
```markdown
> **[SUPERSEDED 2026-07-08]** 以下版本号归属已被实际发布节奏取代，但功能划分仍有效。
```

#### 3.4 `project_ui_ux_audit_decisions.md`

在 F8 行 "推迟，需要彻底重构优化" 后追加：
```markdown
→ 后续方案见 [[tab-restructure-plan]]（project_tab_restructure_plan.md）
```

---

### Step 4: 更新 Action Mode 优先级

编辑 `project_action_mode_roadmap.md`。

**a)** 找到文本 "v2 必交付"，替换为 "v2.x 后期目标"

**b)** 在文件末尾 `How to apply:` 段之后追加：

```markdown
## 2026-07-08 复盘确认

Layer 2 (Operations Agent mode) 仍在 v2.x 路线图但优先级后移，不绑定具体版本号。
Layer 1 (Write Action Framework v1) 已完成且在用（Pagelet review note 是首个 caller）。
架构保护指令（CapabilityRegistry / PolicyEngine / capability kinds）不变。
```

---

### Step 5: 更新北极星变更后的下游指令

北极星于 2026-07-02 从"安静且可信"改为"随手记下，需要时自然浮现"。

#### 5.1 `project_product_positioning.md`

找到 `How to apply` 中的：
```
Review 和优化工作应优先围绕 AI Chat + Memory 展开
```
替换为：
```
Review 和优化工作应优先围绕"让旧笔记在需要时浮现"展开
```

保留 "不要建议拆分插件或弱化管理工具功能"（2026-07-08 确认管理工具仍是基本盘）。

#### 5.2 `project_skill_expansion.md`

找到 `How to apply` 中的：
```
不要建议简化或内联 skill 系统
```
替换为：
```
Skill 基础设施保留，但扩展计划已暂缓（C2 推迟，产品价值待验证）。允许合理简化，但不要内联核心 router/loader
```

#### 5.3 `project_perf_priorities.md`

在 `How to apply` 段追加：
```markdown
> **[PARTIAL 2026-07-08]** LLM 并行化已完成 ✓（commit a031185, ftsQueryOverridePromise）。其余 2 项（calcSnapshot 增量化、WASM 懒加载）需验证当前代码状态。
```

#### 5.4 `project_prompt_improvements.md`

在 `How to apply` 段追加：
```markdown
> **[PARTIAL 2026-07-08]** 需逐项验证实现状态。已知 #4 plannerGuidance 重构有进展（obsidian-operations-capability-catalog 已扁平化）。
```

#### 5.5 `project_v2_review_decisions.md`

在 `How to apply` 段追加：
```markdown
> **[PARTIAL 2026-07-08]** 部分高优项已完成（LLM 并行化、obsidian-ops 扁平化、flag 清扫）。getVSSFiles Set 优化、chat-tools 拆分状态待查。
```

---

### Step 6: 验证并更新剩余 memory 文件

对以下文件执行验证。如发现差异，按规则添加 `[PARTIAL]`/`[DONE]`/`[SUPERSEDED]` 标注。

| 文件 | 检查什么 | 验证命令 |
|------|---------|---------|
| `project_required_capability_refactor.md` | 是否已重构 | `grep -r "RequiredCapabilityClassification" src/ --include="*.ts" -l` |
| `project_react_evaluation_trigger.md` | .tsx 文件数是否 ≥ 5 | `find src/ -name "*.tsx" \| wc -l` |
| `project_pagelet_v2_phase3_decisions.md` | 各决策项实现状态 | 对照每条用 `grep` 验证 |
| `project_pagelet_v2_review_decisions.md` | 6 个决策实现状态 | 对照每条用 `grep` 验证 |
| `project_deprecated_removal_convention.md` | 有无过期 @deprecated | `grep -rn "@deprecated" src/ --include="*.ts"` |
| `project_context_limits_decision.md` | 新限制值是否生效 | `grep -rn "maxObservation\|MAX_CHAT_HISTORY" src/ --include="*.ts"` |

**判断规则：**
- 内容完全准确 → 不改
- 部分条目过时 → 在具体条目处加 `[DONE]` 或 `[SUPERSEDED]` + 日期
- 整体过时 → 在文件开头加 `[DONE]` 并更新 metadata

**不改动的文件**（内容仍然有效，无需验证）：
- `user_product_direction.md` — 用户画像，长期有效
- `project_north_star_redesign.md` — 当前活跃北极星
- `project_ollama_not_priority.md` — 仍然成立
- `project_langchain_keep.md` — 仍然成立
- `project_pagelet_v2_design.md` — 设计共识，仍然有效
- `project_product_discussion_20260702.md` — 最近的产品讨论
- `project_uiux_audit_v2_decisions.md` — 最近的审计（已在本次复盘中部分更新）
- `project_tab_restructure_plan.md` — 最近的重构方案
- `project_ui_ux_audit_decisions.md` — 首轮审计结果
- `project_tier_pricing_strategy.md` — 定价策略，尚未实施
- `project_architecture_refactor_plan.md` — 重构方案，尚未启动
- `project_context_memory_architecture.md` — 架构决策（除 #6 和 #9 已更新外）
- `project_v22_dogfooding.md` — dogfooding 策略，仍在执行
- `project_waf_v1_validated.md` — 验证记录，历史事实
- `project_deprecated_removal_convention.md` — 约定，长期有效
- `feedback_make_deploy.md` — 工作流约定
- `feedback_no_coauthor.md` — commit 规则
- `feedback_ui_ux_review_methodology.md` — 方法论记录

---

### Step 7: 生成 `docs/active-decisions.md`

从全部 memory 文件中提取**仍然活跃**的决策，写入 `docs/active-decisions.md`。

**文件格式：**

```markdown
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
```

每条决策标注 `source:` 指向原始 memory 文件名。

---

### Step 8: 重组 MEMORY.md 索引

将当前按时间追加的平铺列表重组为**语义分组**。

**目标结构：**

```
# Memory Index

## Product Direction
- (5-6 条)

## Architecture & Technical
- (8-10 条)

## Version & Release
- (5-6 条)

## UI/UX
- (4-5 条)

## Feedback & Conventions
- (3 条)

## [DONE] Completed Plans
- (3-4 条，标注完成日期)
```

归类规则：
- `user_*.md` → Product Direction
- `project_north_star_*.md`, `project_product_*.md` → Product Direction
- `project_architecture_*.md`, `project_context_*.md`, `project_*_migration*.md`, `project_langchain_*.md`, `project_ollama_*.md`, `project_tier_*.md`, `project_react_*.md` → Architecture & Technical
- `project_v2_*.md`, `project_v2[0-9]_*.md`, `project_v27_*.md`, `project_waf_*.md`, `project_deprecated_*.md` → Version & Release
- `project_pagelet_*.md`, `project_tab_*.md`, `project_ui*.md`, `project_uiux_*.md` → UI/UX
- `project_perf_*.md`, `project_prompt_*.md`, `project_required_*.md`, `project_skill_*.md` → Architecture & Technical
- `feedback_*.md` → Feedback & Conventions
- 标记了 `[DONE]` 的文件 → [DONE] Completed Plans

每条保持当前格式：`- [Title](filename.md) — one-line description`。

---

## Verification Checklist

执行完成后逐项验证：

- [ ] `ls memory/*.md | wc -l` 的文件数 == MEMORY.md 中 `](*.md)` 链接数 + 1（MEMORY.md 自身）
- [ ] 所有 `[DONE]` 文件的 frontmatter 包含 `status: done`
- [ ] 所有 `[SUPERSEDED]` 标注包含日期和覆盖者引用
- [ ] `docs/active-decisions.md` 存在且覆盖所有非 `[DONE]` memory 的关键决策
- [ ] Memory 提取模型一致为"自动 + 透明度"（`project_context_memory_architecture.md` #6 + `project_uiux_audit_v2_decisions.md` #6）
- [ ] Action Mode 描述一致为"v2.x 后期目标"（`project_action_mode_roadmap.md` + `project_v24_insight_decisions.md`）
- [ ] MEMORY.md 按语义分组，无重复条目
- [ ] 无 memory 文件在磁盘上存在但不在 MEMORY.md 中

## Quality Rules

- **不删除任何 memory 文件**，只添加状态标注
- **不修改仍然准确的内容**
- 每次修改标注日期：`[DONE 2026-07-08]`、`[SUPERSEDED 2026-07-08]`、`[PARTIAL 2026-07-08]`
- `docs/active-decisions.md` 每条决策标注 `source:` 文件名
- 不改变 frontmatter 的 `name` 和 `description` 字段（除非内容确实需要更新）

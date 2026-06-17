# Development Roadmap

> **Created**: 2026-06-15 · **Baseline**: v2.2.0-beta.1 + HEAD
>
> Execution plan with worktree parallelization strategy.
> SPEC details live in [`v2-post-release-spec-driven-development.md`](./v2-post-release-spec-driven-development.md).
> Architecture context in [`architecture-overview.md`](./architecture-overview.md).

---

## v2.2 — Pagelet Graduation + P0 Closure

**Target**: 2026-06-25 stable · **Effort**: ~5 coding days + 3 days soak

> **编码状态**: WT-1/WT-2/WT-3 全部完成并合入 master (2026-06-15)。当前处于 Post-Merge Gates 阶段。

### Worktree Map

Three independent worktrees, merge sequentially after all complete:

```
master ─────┬─── WT-1: feat/pagelet-review-fixes ──┐
            │                                       │
            ├─── WT-2: feat/deprecated-cleanup ─────┤── merge → master → smoke → release
            │                                       │
            └─── WT-3: feat/command-palette ────────┘
```

#### WT-1: `feat/pagelet-review-fixes` (SPEC-B1, ~2d) — ✅ Done (607c16a→08a312d)

Commit HEAD's 16 uncommitted Pagelet files — all are review decision executions:

| Fix | Scope | Files |
|-----|-------|-------|
| C-2 PetSvg 双重清理 | `src/pagelet/pet/PetSvg.ts` | 简化 SVG rebuild |
| H-1 RateLimiter 单例 | `src/plugin.ts` | 缓存 RateLimiter 实例 |
| H-3 PreloadEngine visibility | `src/pagelet/preload/PreloadEngine.ts` | cycleInProgress 检查 |
| H-6 platform-dom 去缓存 | `src/platform-dom.ts` | 移除 timer 缓存 |
| iOS Panel dvh+safe-area | `src/custom.pcss` | 100dvh + safe-area-inset |
| Orchestrator 拆分 | `src/pagelet/orchestrator.ts` | 提取 AnalysisSessionManager + ReviewNoteSaveFlow |
| Bubble close 行为 | `src/pagelet/bubble/BubbleView.ts` | 移除 degraded state |
| DOM 工具提取 | `src/pagelet/dom-utils.ts` (新) | clearChildren, createHtmlElement, isObsidianModalOpen |
| Onboarding 引导 | `src/pagelet/bubble/BubbleContent.ts`, settings | onboardingShown 字段 |
| i18n 补充 | `src/locales/pagelet/en.json`, `zh.json` | 3 new keys |

**验证**: `npx jest --testPathPattern=pagelet --no-coverage` 全过

#### WT-2: `feat/deprecated-cleanup` (SPEC-A3 H-1, ~0.5d) — ✅ Done (5c0d6d9, merged d3c2d5c)

- 删除 `pa-agent-required-capability-policy.ts:28` deprecated type alias
- 内联 `"required" | "suggested"` 替换
- `grep -rn "RequiredCapabilityClassification" src/` 确认 0 外部消费者
- `npm test` + `npx tsc -noEmit` 全过

#### WT-3: `feat/command-palette` (SPEC-A2, ~1d) — ✅ Done (b2696f8, merged 4a730f5)

- Featured Images: `addCommand` 改 `checkCallback`, gate `aiProvider === 'qwen'`
- Memory advanced: 验证已被 `showAdvancedMemoryControls` toggle 守卫
- Automated checks completed; Obsidian deploy/smoke is tracked in Post-Merge Gates below.

### Post-Merge Gates (SPEC-B2)

Merge order: WT-1 → WT-2 → WT-3 → master

- [ ] 全量 `npm test` 通过
- [ ] `pagelet-smoke-checklist.md` GUI smoke 全过 (特别关注 Bubble close 行为变更)
- [ ] Provider OQ002 矩阵 ≥ 2 providers 结构化输出通过 (Qwen + DeepSeek)
- [ ] iOS 真机 Panel 100dvh + safe-area 验证
- [ ] v2.2.0-beta.2 BRAT 发布
- [ ] 2-3 天灰度观察
- [ ] v2.2.0 stable 发布 (manifest.json 同步)

### Optional: SQLite Spike (post-P0, 不阻塞 v2.2)

```
master ─── feat/sqlite-org-spike (不合入 v2.2)
```

- **前置**: v2.2 P0 全部完成
- **时间窗口**: v2.2 code freeze / soak 期 (~7 月上旬)
- **估时**: ~1.5 天
- **验证项**: `@sqlite.org` 初始化 + OPFS 兼容 + JS brute-force 性能 + iOS 内存
- **产出**: 结论写入 `sdd-sqliteai-supplier-migration.md` Phase 1

> **Spike 状态**: ✅ Done (2893b57, merged 54bbc00)。结论: 推荐迁移。报告: [`sqlite-wasm-spike-report.md`](./sqlite-wasm-spike-report.md)

---

## v2.3 — SQLite Migration + Structural Cleanup

**Target**: v2.2 stable + ~30d · **Effort**: ~12 coding days

### Worktree Map

```
master ─────┬─── WT-A: feat/sqlite-org-migration ──────┐
            │                                           │── merge WT-A → master
            ├─── WT-B: feat/builtin-skills ─────────────┤
            │                                           │── then sequential:
            └─── (docs: Operations Agent SDD drafting)  │   B4 → B5 → merge WT-B
                                                        └── → master → smoke → release
```

#### WT-A: `feat/sqlite-org-migration` (SPEC-A6, ~5d)

| Task | Files | Effort |
|------|-------|--------|
| 替换 import path | `sqlite-inline-assets.ts`, `sqlite-worker.ts` | 0.5d |
| 移除 `vector_init` / `vector_as_f32` / `vector_full_scan` | `sqlite-worker.ts` | 1d |
| 实现 `bruteForceTopK()` + 热向量 cache | `sqlite-worker.ts` (新增 ~70 行) | 1.5d |
| OPFS 兼容性测试 (真实 vault DB) | 手动 + 自动化 | 0.5d |
| iOS/Android 真机内存测试 | 40MB Float32Array Worker | 1d |
| bundle 体积对比记录 | build + audit | 0.5d |

#### WT-B: `feat/builtin-skills` (SPEC-B3, ~6d)

| Skill | Work | Effort |
|-------|------|--------|
| `obsidian-dataview` | ✅ Done (814e7d3) | — |
| `obsidian-templater` | SKILL.md + references/ + catalog + bundled-skills | ~3d |

#### Sequential (after WT-A merge)

| SPEC | Task | Effort |
|------|------|--------|
| SPEC-B4 | v1 Pagelet dead code removal (`src/ui/pagelet/`) | ~1d |
| SPEC-B5 | Orchestrator 进一步拆分 (纯协调层) | ~2d |

#### Parallel Doc Work (无代码变更)

- Operations Agent mode SDD 起草 (`docs/operations-agent-mode-sdd.md`)
- RequiredCapabilityClassification 简化 SDD (if capacity)

---

## v2.4 — AI 洞察力提升（地基 + 投影）

**Target**: v2.3 stable + ~30d · **Effort**: ~18-22 coding days（3-4 周）

> v2.4 = 地基层（切片/检索/Pagelet VSS）+ Context 限制放宽 + Context Projector Phase 1 + Context Hygiene Phase 2。
> Action Mode (SPEC-C1/C2) 推迟到 v2.6。
> Status update 2026-06-16: SPEC-D1~D5 implementation is complete in the main worktree; broad checks, deploy, and Obsidian smoke evidence are recorded in the SDD tracker.

### Worktree Map

```
master ─────┬─── WT-X: feat/chunk-retrieval-upgrade ────┐
            │                                           │
            ├─── WT-Y: feat/pagelet-vss ────────────────┤── merge → master
            │                                           │
            └─── WT-Z: feat/context-projector ──────────┘── → smoke → release
```

#### WT-X: `feat/chunk-retrieval-upgrade` (SPEC-D1~D4, ~9d)

| Task | SPEC | Files | Effort |
|------|------|-------|--------|
| Heading-aware 切片 + frontmatter 保留 | SPEC-D1 | `vss/markdown-chunker.ts`, `vss.ts`, `vss/types.ts` | 3-5d |
| Query Rewriter temporal 扩展 | SPEC-D3 | `query-rewriter.ts`, `sqlite-worker.ts` | 0.5d |
| 检索窗口 4→8 文档 / 2000→4000 字符 | SPEC-D4 | `pa-agent-runtime.ts` | 0.5d |
| Reranker excerpt 扩展 + heading path | SPEC-D2(部分) | `pa-agent-runtime.ts` | 1d |

#### WT-Y: `feat/pagelet-vss` (SPEC-D2, ~3-5d)

| Task | Files | Effort |
|------|-------|--------|
| Pagelet review 流程加 VSS 搜索步骤 | `src/plugin.ts`, `src/pagelet/` | 2-3d |
| 四场景 `related_notes` 改语义搜索 | `pa-review-schemas.ts`, prompts | 1-2d |

#### WT-Z: `feat/context-projector` (SPEC-D5, ~5-8d)

| Task | Phase | Files | Effort |
|------|-------|-------|--------|
| Context 限制放宽（观察预算扩展） | — | `pa-agent-runtime.ts`, `pa-agent-loop.ts` | 1d |
| `PaAgentContextProjector` 提取 + 诊断 metrics | Phase 1 | `src/ai-services/context/` | 2-3d |
| Status-only tool result 过滤 + host context diffing | Phase 2 | `src/ai-services/context/`, `pa-agent-runtime.ts` | 2-3d |

---

## v2.5 — AI 洞察力激活（从管道到洞察）

**Target**: v2.4 stable + ~14-20d · **Effort**: ~14-20 coding days
**Status**: ✅ E1-E6 implementation complete + review fixes applied (2026-06-17)

> v2.5 = AI Insight Activation — 激活 D1-D8 已建但未用的能力 + 补齐关联发现 + 深化理解。
> 产品叙事：**"AI 洞察力激活 — 从了解你的 vault 到理解你的思维"**
> 方案文档：[`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md)（产品决策 AD-1~AD-5）
> 开发方案：[`ai-insight-activation-development-plan.md`](./ai-insight-activation-development-plan.md)（SPEC-E1~E6 + worktree 设计）

### SPEC 完成状态

| SPEC | 标题 | Phase | 状态 |
|------|------|-------|------|
| SPEC-E1 | Vault Insights 激活 + Discovery 专用流程 | Phase 1 | `[x]` Done |
| SPEC-E2 | 图感知检索 (1-hop link expansion) | Phase 2 | `[x]` Done |
| SPEC-E3 | Pagelet VSS 全场景覆盖 | Phase 2 | `[x]` Done |
| SPEC-E4 | Budget→Compaction 联动 + 测试补齐 | Phase 2 | `[x]` Done |
| SPEC-E5 | Type A LLM 后台提取 | Phase 3 | `[x]` Done |
| SPEC-E6 | 语义聚类 + temporal range + 死代码清理 | Phase 3 | `[x]` Done |

### 改动统计

26 files, +727/-114 lines. 1848 tests pass. 3 must-fix + 7 should-fix from review applied.

### 关键交付

- **Level 2 关联发现**: 图感知检索（1-hop link expansion with VSS chunk content）、Discovery 专用 LLM 分析流程、Pagelet 全场景 VSS 覆盖
- **Level 3 理解深度**: Vault insights 注入 prompt（opt-in）、Type A LLM 行为推断（inferred_behavior + recurrence）、语义主题聚类（worker k-means）
- **基础设施**: Budget→Compaction 联动、temporal `range:` 格式、cost tracking、mobile idle guard

---

## v2.6 — Action Mode Phase 1 + Skill 扩展 (≥ 2026-11-29)

| SPEC | Task | 前置条件 |
|------|------|---------|
| SPEC-C1 | Action Mode Phase 1（append-to-current-note） | Framework v1 ≥ 8 周验证 + v2.5 stable |
| SPEC-C2 | Skill 用户自定义扩展 | SPEC-B3 完成 |
| SPEC-A7 | apiToken 迁移代码删除 (~110 行) | ≥ 5 minor 且 ≥ 2026-11-29 |

### v2.6+ 远期

| Task | 触发条件 |
|------|---------|
| Action Mode Phase 2 (replace-section, multi-file) | Phase 1 经验 |
| Batch-confirm UX (preview mutex → batch preview) | ≥ 2 action families |
| Production audit 升级 (JSONL 持久化) | 用户报告触发 |
| Skill marketplace 评估 | 用户自定义 skill 成熟后 |

---

## 关键依赖链

```mermaid
graph LR
    B1[SPEC-B1<br/>Pagelet 5 修复] --> B2[SPEC-B2<br/>毕业 Gate]
    A3H1[SPEC-A3 H-1<br/>deprecated 清理] --> B2
    A2[SPEC-A2<br/>命令面板] --> V22[v2.2 stable]
    B2 --> V22

    V22 --> A6[SPEC-A6<br/>SQLite 迁移]
    V22 --> B3[SPEC-B3<br/>内置 Skills]
    A6 --> B4[SPEC-B4<br/>v1 清理]
    A6 --> B5[SPEC-B5<br/>Orchestrator 拆分]
    B4 --> V23[v2.3 stable]
    B5 --> V23
    B3 --> V23

    V23 --> D1[SPEC-D1~D4<br/>切片+检索+Pagelet VSS]
    V23 --> D5[SPEC-D5<br/>Context Projector+Hygiene]
    D1 --> V24[v2.4 stable]
    D5 --> V24

    V24 --> E1[SPEC-E1<br/>Insights 激活+Discovery]
    E1 --> E2[SPEC-E2<br/>图感知检索]
    E1 --> E3[SPEC-E3<br/>Pagelet VSS 全覆盖]
    E1 --> E4[SPEC-E4<br/>Budget 联动+测试]
    E2 --> E5[SPEC-E5<br/>Type A LLM 提取]
    E3 --> E5
    E4 --> E5
    E1 --> E6[SPEC-E6<br/>语义聚类+清理]
    E5 --> V25[v2.5 stable]
    E6 --> V25

    V25 --> C1[SPEC-C1<br/>Action Mode P1]
    V25 --> C2[SPEC-C2<br/>Skill 扩展]
    V25 --> A7[SPEC-A7<br/>apiToken 清理]
    C1 --> V26[v2.6]
    C2 --> V26
    A7 --> V26

    style V22 fill:#e8f5e9,stroke:#4caf50
    style V23 fill:#e8f4fd,stroke:#2196f3
    style V24 fill:#f3e5f5,stroke:#9c27b0
    style V25 fill:#fff3e0,stroke:#ff9800
    style V26 fill:#fce4ec,stroke:#e91e63
```

---

## Timeline

```
2026-06  ┃ v2.2 P0 编码 (5d) → beta.2 → soak → stable
         ┃ (Optional) SQLite spike (1.5d)
2026-07  ┃ v2.3 开发: SQLite 迁移 ∥ 内置 Skills → v1 清理 → Orchestrator
2026-08  ┃ v2.3 stable → v2.4 开发: 切片+检索 ∥ Pagelet VSS ∥ Context Projector+Hygiene
2026-09  ┃ v2.4 stable → v2.5 开发: Compactor+Budget ∥ Type A ∥ Type C+Extraction
2026-10  ┃ v2.5 stable
2026-11+ ┃ v2.6 开发: Action Mode P1 + Skill 扩展 + apiToken 清理
```

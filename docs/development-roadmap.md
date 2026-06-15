# Development Roadmap

> **Created**: 2026-06-15 · **Baseline**: v2.2.0-beta.1 + HEAD
>
> Execution plan with worktree parallelization strategy.
> SPEC details live in [`v2-post-release-spec-driven-development.md`](./v2-post-release-spec-driven-development.md).
> Architecture context in [`architecture-overview.md`](./architecture-overview.md).

---

## v2.2 — Pagelet Graduation + P0 Closure

**Target**: 2026-06-25 stable · **Effort**: ~5 coding days + 3 days soak

### Worktree Map

Three independent worktrees, merge sequentially after all complete:

```
master ─────┬─── WT-1: feat/pagelet-review-fixes ──┐
            │                                       │
            ├─── WT-2: feat/deprecated-cleanup ─────┤── merge → master → smoke → release
            │                                       │
            └─── WT-3: feat/command-palette ────────┘
```

#### WT-1: `feat/pagelet-review-fixes` (SPEC-B1, ~2d)

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

#### WT-2: `feat/deprecated-cleanup` (SPEC-A3 H-1, ~0.5d)

- 删除 `pa-agent-required-capability-policy.ts:28` deprecated type alias
- 内联 `"required" | "suggested"` 替换
- `grep -rn "RequiredCapabilityClassification" src/` 确认 0 外部消费者
- `npm test` + `npx tsc -noEmit` 全过

#### WT-3: `feat/command-palette` (SPEC-A2, ~1d)

- Featured Images: `addCommand` 改 `checkCallback`, gate `aiProvider === 'qwen'`
- Memory advanced: 验证已被 `showAdvancedMemoryControls` toggle 守卫
- `make deploy` + Obsidian 命令面板 smoke

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
| `obsidian-dataview` | SKILL.md + references/ + catalog + bundled-skills | ~3d |
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

## v2.4 — Action Mode Phase 1

**Target**: v2.3 stable + ~30d · **Effort**: ~13 coding days
**前置条件**: Write Action Framework v1 至少 8 周实战验证, 无 security issue

### Worktree Map

```
master ─────┬─── WT-X: feat/action-mode-append ────────┐
            │                                           │── merge → master → smoke → release
            └─── WT-Y: feat/skill-expansion ────────────┘
```

#### WT-X: `feat/action-mode-append` (SPEC-C1, ~8d)

| Task | Files | Effort |
|------|-------|--------|
| `append-to-current-note` action family SDD 实现 | write-action-framework/ 新增 | 3d |
| Stale Re-read mode B (source content hash) | `stale-reread.ts` | 2d |
| PolicyEngine 写 tier 扩展 | `policy-engine.ts`, `capability-types.ts` | 1d |
| Prompt injection 测试 (append 攻击面) | `__tests__/` 新增 fixtures | 1d |
| 移动端 UX 决策 + 实现 | 视决策结果 | 1d |

#### WT-Y: `feat/skill-expansion` (SPEC-C2, ~5d, if capacity)

| Task | Files | Effort |
|------|-------|--------|
| `allowed-tools` 白名单运行时 enforce | `skill-router.ts`, `skill-context-provider.ts` | 2d |
| Settings UI skill 管理面板 | `src/settings.ts` 或新文件 | 2d |
| (Optional) vault-side `.pa-skills/` 发现管线 | 新增模块 | 3d |

---

## v2.5+ — Stabilization (≥ 2026-11-29)

| SPEC | Task | 触发条件 |
|------|------|---------|
| SPEC-A7 | apiToken 迁移代码删除 (~110 行) | ≥ 5 minor 且 ≥ 2026-11-29 |
| — | Action Mode Phase 2 (replace-section, multi-file) | Phase 1 经验 |
| — | Batch-confirm UX (preview mutex → batch preview) | ≥ 2 action families |
| — | Production audit 升级 (JSONL 持久化) | 用户报告触发 |
| — | Skill marketplace 评估 | 用户自定义 skill 成熟后 |

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

    V23 --> C1[SPEC-C1<br/>Action Mode P1]
    V23 --> C2[SPEC-C2<br/>Skill 扩展]
    C1 --> V24[v2.4 stable]
    C2 --> V24

    V24 --> A7[SPEC-A7<br/>apiToken 清理]
    A7 --> V25[v2.5+]

    style V22 fill:#e8f5e9,stroke:#4caf50
    style V23 fill:#e8f4fd,stroke:#2196f3
    style V24 fill:#f3e5f5,stroke:#9c27b0
    style V25 fill:#fff3e0,stroke:#ff9800
```

---

## Timeline

```
2026-06  ┃ v2.2 P0 编码 (5d) → beta.2 → soak → stable
         ┃ (Optional) SQLite spike (1.5d)
2026-07  ┃ v2.3 开发: SQLite 迁移 ∥ 内置 Skills → v1 清理 → Orchestrator
2026-08  ┃ v2.3 stable → v2.4 开发: Action Mode ∥ Skill 扩展
2026-09  ┃ v2.4 stable
2026-11+ ┃ v2.5 apiToken 清理 + 深化
```

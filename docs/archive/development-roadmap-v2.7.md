# Development Roadmap

> **Created**: 2026-06-15 · **Last updated**: 2026-06-19
>
> SPEC details live in [`v2-post-release-spec-driven-development.md`](./v2-post-release-spec-driven-development.md).
> Architecture context in [`architecture-overview.md`](../architecture/architecture-overview.md).

---

## Current Status

v2.2~v2.6 scope 的编码全部完成在 master 上，跳过中间版本的正式发布流程，v2.7 做一次合并 release。

```
v2.2  ████████████████████  Code Complete (2026-06-15)
v2.3  ████████████████████  Code Complete
v2.4  ████████████████████  Code Complete (2026-06-16)
v2.5  ████████████████████  Code Complete (2026-06-17)
v2.6  ████████████████████  Code Complete (C1+A7; C2 deferred)
────────────────────────────────────────────────────
v2.7  Release prepared      local tag 2.7.0; publish pending
```

---

## v2.7 — 合并 Release

**Scope**: v2.2~v2.6 全部已完成代码的正式发布，并补齐 v2.7 pre-release blocker。2026-06-19 补齐项包括 AI Insights 一等入口、Discovery `insight`/`action` 映射、Type A malformed JSON fallback、Vault Insights onboarding Notice 测试和实现口径文档同步。

### Release Checklist

| # | 项目 | 类别 | 状态 |
|---|------|------|------|
| 0 | AI Insight pre-release code blockers | 代码/测试 | [x] |
| 1 | Provider OQ002 矩阵 ≥ 2 providers 结构化输出 | 验证 | [x] |
| 2 | iOS 真机验证（dvh/safe-area/移动端 guard；final save caveated） | 验证 | [x] |
| 3 | Pagelet smoke checklist（Bubble/Discovery/Onboarding/AI Insights） | 验证 | [x] |
| 4 | manifest.json / manifest-beta.json / versions.json → 2.7.0 | 发布物 | [x] |
| 5 | CHANGELOG / Release Notes | 发布物 | [x] |
| 6 | v2.7 英文/中文用户说明 / 最佳实践 / 视频脚本 | 用户文档 | [x] |

### Release Verification Notes

- 2026-06-19 已补齐 AI Insight pre-release code blockers 的代码/测试：
  AI Insights 一等入口、Settings 入口、Discovery `insight`/`action` 容错映射、
  Type A malformed JSON fallback、Vault Insights onboarding Notice 覆盖，以及
  相关实现口径文档同步。
- 2026-06-19 iOS 真机 smoke 已通过移动端 Pagelet panel 基础布局、
  dvh/safe-area、mobile guard、Chat 基础路径、AI Insights viewer 和 Vault
  Insights onboarding Notice。Pagelet final confirm/save 因 iPhone Mirroring
  滚动手势限制未完成，作为 v2.7 caveat 明确记录，不作为已验证保存路径声明。
- 2026-06-19 desktop post-fix smoke 已通过 AI Insights viewer、Discovery panel、
  Qwen `qwen-plus` Pagelet structured output（英文 golden note + 中文 fixture）、
  DashScope-compatible `deepseek-v4-flash` Pagelet structured output、Pagelet
  runner 20 PASS / 0 bugs、`dev:errors` clean。
- Provider OQ002 关闭：release owner 确认 DeepSeek 预期通过百炼平台使用，因此
  DashScope-compatible `deepseek-v4-flash` smoke 计入 DeepSeek provider evidence。
- Pagelet smoke checklist 关闭：Discovery / Onboarding / AI Insights 使用 2026-06-19
  证据，Bubble 使用早前 checklist 的 click-through 证据加本轮 runner 的 pet/panel
  mount 证据。
- 2026-06-19 release metadata 已生成本地 `2.7.0` release commit/tag；
  `package.json`、lockfile、`manifest.json`、`manifest-beta.json`、`versions.json`
  和 `CHANGELOG.md` 均已更新。远端 publish / GitHub Release 尚未执行。
- 2026-06-19 final pre-publish gate 在 release-review follow-up 和 v2.7 用户
  指南 follow-up 后的本地 `2.7.0` tagged candidate 上补跑并记录：coverage
  Jest、typecheck、lint、build、bundle audit、whitespace scan、source review
  scan、`make deploy`。该记录覆盖 final Settings native color picker /
  `vanilla-picker` removal follow-up。
- 2026-06-19 补齐 v2.7 英文/中文用户说明：`docs/archive/v2.7-user-guide-en.md`
  面向海外用户作为主入口，`docs/archive/v2.7-user-guide.md` 保留中文版。两者从
  用户工作流说明 AI Insights、Memory、Pagelet、Research、安全保存、最佳
  实践和发布视频脚本，并从 README / README-CN / docs index 建立入口。

### v2.7 产品叙事

覆盖 5 个版本的改动，按用户价值分组：

| 主题 | 涵盖 SPEC | 一句话 |
|------|----------|--------|
| AI 洞察力 | D1~D8, E1~E6 | 从浅层搜索升级为理解用户和 vault 的洞察者 |
| 写操作 | C1 | AI 可以追加内容到当前笔记（首个写动作） |
| Pagelet 成熟 | B1, B4, B5 | Review/Discovery/Writing Assist 全面打磨 |
| 基础设施 | A6, A7, B3 | SQLite 供应商迁移 + Skills 扩展 + 历史清理 |

### 不含项

| 项目 | 原因 |
|------|------|
| C2 Skill 用户自定义扩展 | 产品设计和用户价值不明确，推迟 |
| B5 Orchestrator 缩减到 <800 行 | 866 行已接近目标，不值得改动 |

---

## v2.2~v2.6 完成记录

<details>
<summary>v2.2 — Pagelet Graduation + P0 Closure (Code Complete 2026-06-15)</summary>

| SPEC | 状态 | Commits |
|------|------|---------|
| B1 Pagelet review 5 修复 + Orchestrator 拆分 + Bubble + Onboarding | ✅ Done | `607c16a`→`08a312d` |
| A2 命令面板清理 | ✅ Done | `b2696f8` (merged `4a730f5`) |
| A3 H-1 deprecated 清理 | ✅ Done | `5c0d6d9` (merged `d3c2d5c`) |
| B2 毕业 gate | Superseded | 验证项并入 v2.7 |
| SQLite Spike | ✅ Done | `2893b57` (merged `54bbc00`) |

</details>

<details>
<summary>v2.3 — SQLite Migration + Structural Cleanup (Code Complete)</summary>

| SPEC | 状态 | Commits |
|------|------|---------|
| A6 SQLite 迁移 (`@sqliteai` → `@sqlite.org`) | ✅ Done | spike + 迁移完成 |
| B3 内置 Skills (dataview + templater) | ✅ Done | `814e7d3` + `3965c01` |
| B4 v1 Pagelet 死代码移除 | ✅ Done | `4fc33a9` |
| B5 Orchestrator 进一步拆分 (4 模块提取, 866 行 accepted) | ✅ Done | `d96bf4b` |

</details>

<details>
<summary>v2.4 — AI 洞察力提升：地基 + 投影 (Code Complete 2026-06-16)</summary>

| SPEC | 状态 |
|------|------|
| D1 Heading-aware 切片 + frontmatter 保留 | ✅ Done |
| D2 Pagelet VSS + Reranker 升级 | ✅ Done |
| D3 Query-rewriter temporal intent | ✅ Done |
| D4 检索窗口 4→8 文档 / 500→1000 字符 | ✅ Done |
| D5 Context Projector + Hygiene | ✅ Done |

</details>

<details>
<summary>v2.5 — AI 洞察力激活：从管道到洞察 (Code Complete 2026-06-17)</summary>

方案文档：[`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md)
开发方案：[`ai-insight-activation-development-plan.md`](./ai-insight-activation-development-plan.md)

| SPEC | 状态 |
|------|------|
| D6 Context Compactor + Budget | ✅ Done |
| D7 Type A 用户画像 (regex + IndexedDB) | ✅ Done |
| D8 Type C Vault 元认知 (7 维度) | ✅ Done |
| E1 Vault Insights 激活 + Discovery 专用流程 | ✅ Done |
| E2 图感知检索 (bidirectional 1-hop link expansion) | ✅ Done |
| E3 Pagelet VSS 全场景覆盖 | ✅ Done |
| E4 Budget→Compaction 联动 + 测试补齐 | ✅ Done |
| E5 Type A LLM 后台提取 | ✅ Done |
| E6 语义聚类 + temporal range + 死代码清理 | ✅ Done |

改动统计：26 files, +727/-114 lines. 1893 tests pass. 3 must-fix + 7 should-fix from review applied + 16 post-merge fixes.

</details>

<details>
<summary>v2.6 — Action Mode + 清理 (Code Complete)</summary>

| SPEC | 状态 | Commits |
|------|------|---------|
| C1 Action Mode Phase 1 (append-to-current-note) | ✅ Done | C1-P1~P5 `7befc18`→`f2267d6` + review fixes |
| A7 apiToken 迁移代码删除 | ✅ Done | `3536e90` |
| C2 Skill 用户自定义扩展 | Deferred | 产品设计未明确 |

</details>

---

## v2.7+ 远期

| Task | 触发条件 |
|------|---------|
| C2 Skill 用户自定义扩展 | 产品设计和用户价值明确后 |
| Action Mode Phase 2 (replace-section, multi-file) | Phase 1 经验 |
| Batch-confirm UX (preview mutex → batch preview) | ≥ 2 action families |
| Production audit 升级 (JSONL 持久化) | 用户报告触发 |
| Skill marketplace 评估 | 用户自定义 skill 成熟后 |
| A8 React → Preact 评估 | React 独占特性 / preact compat 不兼容库 |
| A9 WASM 内联策略复议 | 冷启动 ≥ 5s / OOM ≥ 3 例 |

---

## Timeline

```
2026-06-01~15  ┃ v2.2 编码 (A1~A5, B1)
2026-06-15     ┃ v2.3 编码 (A6, B3, B4, B5)
2026-06-16     ┃ v2.4 编码 (D1~D5)
2026-06-16~17  ┃ v2.5 编码 (D6~D8, E1~E6)
2026-06-17~18  ┃ v2.6 编码 (C1, A7) + post-merge fixes
2026-06-18     ┃ 决策：v2.2~v2.6 跳过发布,v2.7 合并 release
         TBD   ┃ v2.7 验证 + 发布
```

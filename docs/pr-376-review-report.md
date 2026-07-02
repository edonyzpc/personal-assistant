# PR #376 Review Report

**PR**: feat(pa): add low-burden PA runtime, contracts, and supporting modules
**Scope**: 23,527 additions / 422 deletions / 146 files / 9 commits
**Review date**: 2026-07-01 (初审) → 2026-07-01 (修复后复审)
**Dimensions covered**: Architecture, Contracts, Security, Product Alignment, Integration, Tests, UI Safety, Performance, Spec Checklist

---

## Executive Summary

PR #376 引入完整的 "Low-Burden PA" 运行时系统，共 27 个新模块。
初审发现 1 P0 + 19 P1，全部已在 4 个修复 commit 中解决。
修复后复审发现 **1 个回归 bug（P0）** 和 **7 个改进项（P1/P2）**。

### 复审结论

修复 commit 整体质量良好，但引入了一个回归：`VALID_STATUS_TRANSITIONS`
状态转移表遗漏了 `suggested → applied` 路径，导致 maintenance 应用流程静默失败。

---

## 第一轮审查（初审）

### 覆盖维度

8 维度并行 review + 7 章 spec 实现后检查：

| 维度 | 结果 |
|------|------|
| D1 Architecture | 4 P1（状态守卫、上向依赖、helper 重复、死代码） |
| D2 Contracts | 类型设计健全，契约层合理 |
| D3 Security | **1 P0**（Context Firewall 未接入）+ 4 P1 |
| D4 Product Alignment | 9.5/10，3 条 copy 优化建议 |
| D5 Integration | 6 P1（超时、预算、生命周期、错误边界） |
| D6 Tests | 16/17 模块有测试，1 模块缺失 |
| D7 UI Safety | **零违规**（DOM、CSS、生命周期全部合规） |
| D8 Performance | 4 P1（O(n²)、无界队列、backlinks 遍历） |
| Spec Ch1-Ch6 | 45 pass / 6 fail / 3 N/A |

### 初审修复清单

初审的 1 P0 + 19 P1 + 6 spec 发现，按以下 4 个 commit 修复：

```
9d7b3ca fix(pa): harden security guards, queue integrity, and discovery performance
b40f93b fix(pagelet): add lifecycle cleanup, error boundary, timeout, and focus mode
e9d9746 refactor(pa): extract shared helpers and move GeneratedReviewNote to contracts
8b383a6 docs(pa): add PR review report and spec post-implementation checklist
```

---

## 第二轮审查（复审）

复审针对上述 4 个修复 commit，采用 10 角度 high-effort 方法：
5 correctness angles + 3 cleanup angles + 1 altitude angle + 1 conventions angle

### P0 — 回归 Bug（1）

#### R-P0-1 · 状态转移表阻断 maintenance 应用流程

- **文件**: `src/pa/review-queue-store.ts:82`
- **问题**: 初审修复 P1-A1 时添加的 `VALID_STATUS_TRANSITIONS` 将 `suggested`
  的合法目标定义为 `["accepted", "dismissed", "snoozed", "expired"]`，
  **不包含 `"applied"`**。但 `src/plugin.ts:1661` 的 maintenance 应用流程在用户
  确认对话框后直接执行 `updateMaintenanceQueueStatus(id, "applied")`，源状态是
  `"suggested"`。
- **影响**: 用户确认 maintenance 移动提案后，文件在磁盘上成功移动，但队列项状态
  更新被静默拒绝（`updateStatus` 返回 `{ ok: false }`，调用方未检查）。队列项
  永远停留在 `"suggested"` 状态，用户在 Review Queue 中看到已执行的提案仍显示为
  待处理。
- **修复**: 在 `suggested` 的合法转移中加入 `"applied"`。用户确认对话框
  （`plugin.ts:1608-1615`）充当了 accept 语义，直接转为 applied 是合理的。

---

### P1 — 应修复（4）

#### R-P1-1 · evictIfNeeded() 在构造函数/加载路径未调用

- **文件**: `src/pa/review-queue-store.ts:135`（构造函数）
- **问题**: `evictIfNeeded()` 仅在 `create()` 后调用。如果持久化数据中已有
  300+ 项（同步冲突、手动编辑），构造函数通过 `normalizeReviewQueueItems()`
  加载它们但不执行驱逐。队列超过 `MAX_QUEUE_SIZE` 直到下一次 `create()`。
- **影响**: 插件加载后面板需渲染 300+ 项，性能退化。可能数小时内无 `create()`
  调用，驱逐永远不触发。
- **修复**: 在构造函数末尾加 `this.evictIfNeeded()`。

#### R-P1-2 · Focus Mode 仅守卫 showBubble()，未守卫 handlePetClick()

- **文件**: `src/pagelet/orchestrator.ts:829`
- **问题**: `showBubble()` 加了 `if (this.host.settings.focusMode) return;` 守卫，
  但 `handlePetClick()` 通过 `BubbleCoordinator.handlePetClick()` 直接调用
  `bubbleView.show()`，绕过了 Focus Mode 检查。
- **影响**: 用户开启 Focus Mode 后点击 Pet 仍会弹出 Bubble，破坏 Focus Mode
  承诺。
- **修复**: 在 `handlePetClick()` 开头加同样的 `focusMode` 检查。

#### R-P1-3 · normalizePersistedReviewQueueItem 直接修改原始 settings 对象

- **文件**: `src/pa/review-queue-store.ts:341`
- **问题**: `normalizePersistedReviewQueueItem` 将 `entry` 强转为
  `ReviewQueueItem` 后直接修改 `admissionReason` 和 `metadata`。这些对象
  来自 `this.settings.reviewQueue.items`，是 settings 的原始引用。
- **影响**: 加载时静默修改 settings 内存对象。下一次 `saveSettings()` 会持久化
  这些改动，即使用户没有执行任何操作。虽然改动内容（加 `legacy_pre_refactor`
  标记）本身无害，但违反了 settings 不应被隐式修改的原则。
- **修复**: 在修改前先浅拷贝：`const item = { ...entry } as ReviewQueueItem`。

#### R-P1-4 · isRecord() 对 Array 返回 true，与 settings.ts 版本不一致

- **文件**: `src/pa/helpers.ts:21`
- **问题**: `typeof value === "object" && value !== null` 对数组也返回 `true`。
  `src/settings.ts:656` 的版本额外检查了 `!Array.isArray(value)`。同一代码库中
  两个同名函数对数组的判定不一致。
- **影响**: 如果持久化字段意外包含数组而非对象，`isRecord` 放行后数组被当作
  `Record<string, unknown>` 使用。下游校验（`validateReviewQueueItemBase` 等）
  通常能捕获，但边界不够严密。
- **修复**: 在 `helpers.ts` 中加 `&& !Array.isArray(value)`。

---

### P2 — 建议改进（3）

#### R-P2-1 · buildGraphDiscoveryBacklinkMap() 每次调用重建全量倒排表

- **文件**: `src/plugin.ts:1530`
- **问题**: 该方法遍历 vault 全部 `resolvedLinks` 构建倒排 map，
  时间复杂度 O(E)（E = 全 vault 链接数）。被 graph discovery 和 scope recap
  分别调用一次，同一 session 内重复构建。
- **建议**: 缓存倒排 map，在 `metadataCache` 变化时失效。

#### R-P2-2 · listForContext() 先全量 clone 再过滤，浪费已丢弃记录的 clone 成本

- **文件**: `src/pa/memory-governance-store.ts:170`
- **问题**: `listForContext()` 调用 `list()` 对 N 条记录全部 deep clone
  （包括 spread sourceRefs 数组），再通过 firewall 过滤。被过滤掉的记录
  clone 白做。
- **建议**: 先在 `this.records` 上 filter，再 clone 幸存者。

#### R-P2-3 · collectScopeRecapSourceNotes 映射 sourceRefs 但该字段从未被填充

- **文件**: `src/plugin.ts:1468`
- **问题**: `collectGraphDiscoveryNotes()` 构建 `GraphDiscoveryNote` 时未设置
  `sourceRefs`。`collectScopeRecapSourceNotes()` 映射 `note.sourceRefs` →
  `ScopeRecapSourceNote.sourceRefs`，但该值始终为 `undefined`。
- **建议**: 如果 `buildScopeRecap` 不依赖 `sourceRefs`（当前不依赖），
  删除这个空映射；如果未来需要，在 `collectGraphDiscoveryNotes` 中填充。

---

## Positive Findings（维持）

| 领域 | 评估 |
|------|------|
| **产品对齐** | 9.5/10，6 个 PA 模块全部强对齐 North Star |
| **启动影响** | 零 — 所有 PA 模块延迟到 Phase 3（`onIdle`） |
| **DOM 安全** | 零 innerHTML/outerHTML/style 违规，完全符合 Obsidian 社区审查 |
| **生命周期管理** | 5 个 pagelet view 全部正确清理 listeners/timers/observers/Components |
| **CSS 作用域** | 600 行新 CSS 全部以 `pa-` 前缀限定，无泄漏 |
| **测试覆盖** | 16/17 PA 模块有测试，eval 框架 24 种断言 |
| **i18n** | 535 pagelet keys + 597 plugin keys，en/zh 完美对齐 |
| **错误隔离** | Orchestrator 对所有 PA 调用 try/catch 包裹，无级联风险 |
| **Tombstone 处理** | `forget()` 正确清零 text + sourceRefs，validator 强制执行 |
| **Maintenance 安全** | 默认 preview-only，`permanentDelete: true` 被拒绝，完整 undo 元数据 |
| **Scope Recap 护栏** | `scopeRecapCanAnswerAsFact` 始终返回 false，生成内容不能成为确认记忆 |
| **Helper 去重** | 6 个共享函数从 39 份副本统一到 1 份 `helpers.ts`，净减 136 行 |
| **Focus Mode** | 最小版本已实现：settings + command + bubble 抑制 |
| **超时保护** | 前台 LLM 调用 60s 超时，所有 tab 命令接入 budget guard |

---

## 修复优先级

| 优先级 | ID | 问题 | 修复方式 |
|--------|-----|------|---------|
| **P0** | R-P0-1 | `suggested → applied` 被阻断 | `VALID_STATUS_TRANSITIONS.suggested` 加入 `"applied"` |
| **P1** | R-P1-1 | 构造函数不调用 evictIfNeeded | 构造函数末尾加 `this.evictIfNeeded()` |
| **P1** | R-P1-2 | Focus Mode 不守卫 Pet 点击 | `handlePetClick()` 加 focusMode 检查 |
| **P1** | R-P1-3 | normalizePersistedReviewQueueItem 修改原始对象 | 修改前浅拷贝 |
| **P1** | R-P1-4 | isRecord 对数组返回 true | 加 `!Array.isArray(value)` |
| P2 | R-P2-1 | backlink map 不缓存 | 加缓存 + metadataCache 失效 |
| P2 | R-P2-2 | listForContext clone 浪费 | 先 filter 再 clone |
| P2 | R-P2-3 | sourceRefs 映射始终 undefined | 删除空映射或填充 |

---

## Verification

```bash
# 1. Build chain
make deploy

# 2. Full test suite
npm test -- --runInBand

# 3. 回归验证：suggested → applied 路径
rg -n "VALID_STATUS_TRANSITIONS" src/pa/review-queue-store.ts
# suggested 行应包含 "applied"

# 4. Helper 去重验证
rg -c "function normalizeVaultPath\|function stableHash\|function isRecord" src/pa/
# 期望：只有 helpers.ts 返回 3

# 5. Focus Mode 守卫验证
rg -n "focusMode" src/pagelet/orchestrator.ts
# 应在 showBubble 和 handlePetClick 两处出现

# 6. DOM 安全
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

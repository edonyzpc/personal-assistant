# PA UI/UX Optimization Plan

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-07-07

## Status

| Field | Value |
| --- | --- |
| Document type | Unified implementation plan |
| Scope | All 8 PA user-facing surfaces |
| Product version | v2.8.x (post-Pagelet v2 redesign) |
| North Star | 随手记下，需要时自然浮现 |
| Design Philosophy | 安静且可信 |
| Baseline audit score | 3.71/5.0 (2026-07-03) |
| Post-fix audit score | 3.97/5.0 (2026-07-07) |
| Total findings | 81 identified, 62 confirmed (0% false positive) |
| Product decisions | 15 confirmed |
| Implementation phases | 5 |
| Development tracker | [pa-ui-ux-optimization-tracker.md](./pa-ui-ux-optimization-tracker.md) |
| Total tasks | 53 (37S + 12M + 4L = 73 SP) |
| Critical path | ~17 working days |

---

## Executive Summary

A full UI/UX audit conducted 2026-07-03 (refreshed 2026-07-07) scored 8
surfaces across 10 dimensions. The overall quality improved from 3.71 to
3.97/5.0. The audit produced 81 findings, of which 62 were confirmed with 0%
false positive rate. 15 product decisions were made, organized into 5
implementation phases:

- **Phase 1** (P0-P1): i18n spec violations and critical hardcoded strings --
  46 new locale keys, 9 files
- **Phase 2a**: Quick implementations for 11 product decisions (D1, D3, D4,
  D7-D12, D14, D15) -- locale, CSS, and light code changes
- **Phase 2b**: Structural SDDs for 3 major decisions (D5 ReviewQueue merge,
  D6 Memory opt-out, D13 Settings navigation)
- **Phase 3**: 15 P2 quick fixes grouped into atomic commits -- a11y,
  CSS tokens, i18n cleanup, code quality
- **Phase 4-5**: Design token foundation (border-radius, shadow, font-size,
  color) and surface-specific structural refactoring (Tab CSS, Chat namespace,
  Quick Capture i18n)

Estimated scope: ~100 locale keys added/modified (84 new + ~19 modified),
~23 unique files touched (20 existing + 3 new). All changes are
backward-compatible and independently testable per phase.

| Phase | New Keys | Modified Keys | New Files | Existing Files |
| --- | --- | --- | --- | --- |
| Phase 1 | 46 | 0 | 0 | 9 |
| Phase 2a | 7 | 2 | 0 | 13 |
| Phase 2b | 16 | 2 | 3 | 5 |
| Phase 3 | 15 | 13 | 0 | 12 |
| Phase 4-5 | 0 | 2 | 0 | 3 |

### Product Decisions Summary

| ID | Decision | Type |
| --- | --- | --- |
| D1 | Quick Capture discoverability via onboarding nudge | Quick |
| D2 | Bubble capture: keep as delivery/status only | No-op |
| D3 | Quick Capture Escape: keep preserve + Toast "Draft saved" | Quick |
| D4 | Quick Capture save destination: show muted text below title | Quick |
| D5 | ReviewQueue: merge into Memory Governance / Maintenance | STRUCTURAL |
| D6 | Memory candidates: opt-out model (auto-trust, dismiss to exclude) | STRUCTURAL |
| D7 | Tab info density: top 3 + "Show more sections" | Quick |
| D8 | Recall language: "Next:" to "你可以：{action}" | Quick |
| D9 | Panel scope: collapse token+checkboxes into details | Quick |
| D10 | Status chips: Weekly scan add nav link, keep Preview only muted, remove "Not added to kept items" | Quick |
| D11 | Chat loader: keep 5 colors, slow to ~10s, slight desaturation | Quick |
| D12 | Stats Overview: add range controls | Quick |
| D13 | Settings: grouped collapsible + sticky jump nav | STRUCTURAL |
| D14 | Memory settings: keep nesting + add visual hierarchy | Quick |
| D15 | Data Boundary: replace 6 buttons with info card | Quick |

---

## Heatmap

### Surface x Dimension Matrix (1-5 scale)

| Dimension | Pet | Bubble | Panel | Tab | Chat | Statistics | Settings | Modals | Avg |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1 Coherence** | 4.5 | 4.5 | 4 | 3 | 3.5 | 2.5 | 3.5 | 3.5 | **3.6** |
| **A2 Polish** | 4 | 4.5 | 4 | **2** | 4 | **3** | 3.5 | 3.5 | **3.6** |
| **A3 Interaction** | 4.5 | 4.5 | 4 | 3 | 4 | 3 | 3.5 | 3.5 | **3.8** |
| **A4 Clarity** | 3.5 | 4 | 4 | 4 | **3** | 3.5 | 3.5 | 3.5 | **3.6** |
| **B1 Quietness** | 4 | 5 | 4 | **2** | 3.5 | 3.5 | 3.5 | 3.5 | **3.6** |
| **B2 Trust** | 5 | 4.5 | **5** | 4 | 4 | 3 | 4 | 4 | **4.2** |
| **B3 Capture** | 3.5 | **3** | 4 | 3 | -- | -- | 4 | 4 | **3.6** |
| **B4 Return** | 4.5 | 4.5 | 3 | 3 | 3.5 | -- | -- | -- | **3.7** |
| **B5 Burden** | **5** | 4 | 4 | **2** | 3.5 | 3.5 | 3 | 3.5 | **3.6** |
| **B6 Disclosure** | **5** | 4.5 | **5** | 3 | 4 | **2.5** | 3.5 | 3.5 | **3.9** |
| **Surface Avg** | **4.4** | **4.3** | **4.1** | **2.9** | **3.7** | **3.1** | **3.6** | **3.6** | |

**Strongest surfaces**: Pet (4.4), Bubble (4.3), Panel (4.1)
**Weakest surfaces**: Tab (2.9), Statistics (3.1)
**Strongest dimension**: B2 Trustworthiness (4.2)
**Weakest dimensions**: A2 Visual Polish (3.6), B1 Quietness (3.6), B5 Burden (3.6)

---

## Phase 1: i18n & Spec Violation Fixes (P0-P1)

### 1.1 TAB-P0-2: Raw `ReviewQueueStatus` values without `pageletT()` wrapping

**Problem:** Two locations render `item.status` (raw enum string like
`"suggested"`, `"accepted"`, `"dismissed"`) directly into UI tag chips without
localization.

**Files:**
- `src/pagelet/tab/TabView.ts` line 743
- `src/pagelet/tab/sections/MemoryGovernanceSection.ts` line 144

**Fix:** Replace both with `pageletT()` lookups using the pattern
`pagelet.tab.reviewQueue.status.{status}`.

```ts
// BEFORE (both files)
tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip", item.status));

// AFTER (both files)
tagRow.appendChild(el("span", "pa-pagelet-tab-tag-chip",
    pageletT(`pagelet.tab.reviewQueue.status.${item.status}`, this.locale)));
```

**New locale keys (9 keys per language):**

| Key | EN | ZH |
| --- | --- | --- |
| `pagelet.tab.reviewQueue.status.suggested` | Suggested | 新建议 |
| `pagelet.tab.reviewQueue.status.accepted` | Accepted | 已采纳 |
| `pagelet.tab.reviewQueue.status.edited` | Edited | 已编辑 |
| `pagelet.tab.reviewQueue.status.applied` | Applied | 已应用 |
| `pagelet.tab.reviewQueue.status.dismissed` | Dismissed | 已忽略 |
| `pagelet.tab.reviewQueue.status.snoozed` | Snoozed | 已推迟 |
| `pagelet.tab.reviewQueue.status.expired` | Expired | 已过期 |
| `pagelet.tab.reviewQueue.status.failed` | Failed | 失败 |
| `pagelet.tab.reviewQueue.status.undone` | Undone | 已撤销 |

**Locale files:** `src/locales/pagelet/en.json` (after line 431),
`src/locales/pagelet/zh.json` (matching position)

---

### 1.2 CHAT-F1: `getToolContextUsedInfo` hardcoded English labels

**Problem:** `src/chat/formatters.ts` lines 24-86 returns hardcoded English
strings for `label` and `detail` fields in the "Context Used" UI section.

**Fix:** Move all label/detail strings to plugin locale keys, call `ft()` at
return time.

**New locale keys (18 keys -- 9 label + 9 detail):**

| Key | EN | ZH |
| --- | --- | --- |
| `plugin.chat.formatter.contextTool.inspectNote.label` | Note structure | 笔记结构 |
| `plugin.chat.formatter.contextTool.inspectNote.detail` | Read-only note structure, links/backlinks, tasks, and properties | 只读笔记结构、链接/反向链接、任务及属性 |
| `plugin.chat.formatter.contextTool.readCanvas.label` | Canvas structure | Canvas 结构 |
| `plugin.chat.formatter.contextTool.readCanvas.detail` | Read-only canvas structure | 只读 Canvas 结构 |
| `plugin.chat.formatter.contextTool.searchSnippets.label` | Note snippets | 笔记片段 |
| `plugin.chat.formatter.contextTool.searchSnippets.detail` | Bounded note snippet search results | 有限范围笔记片段搜索结果 |
| `plugin.chat.formatter.contextTool.listTags.label` | Tags | 标签 |
| `plugin.chat.formatter.contextTool.listTags.detail` | Read-only tag counts | 只读标签计数 |
| `plugin.chat.formatter.contextTool.currentNote.label` | Current note | 当前笔记 |
| `plugin.chat.formatter.contextTool.currentNote.detail` | Read-only current note context | 只读当前笔记上下文 |
| `plugin.chat.formatter.contextTool.searchMetadata.label` | Note metadata | 笔记属性 |
| `plugin.chat.formatter.contextTool.searchMetadata.detail` | Read-only metadata search results | 只读属性搜索结果 |
| `plugin.chat.formatter.contextTool.recentNotes.label` | Recent notes | 最近笔记 |
| `plugin.chat.formatter.contextTool.recentNotes.detail` | Read-only recent note list | 只读最近笔记列表 |
| `plugin.chat.formatter.contextTool.noteOutline.label` | Note outline | 笔记大纲 |
| `plugin.chat.formatter.contextTool.noteOutline.detail` | Read-only note outline | 只读笔记大纲 |
| `plugin.chat.formatter.contextTool.default.label` | Read-only tool | 只读工具 |
| `plugin.chat.formatter.contextTool.default.detail` | Read-only tool context | 只读工具上下文 |

**Code pattern (`formatters.ts:24-86`):**
```ts
export function getToolContextUsedInfo(tool: string): Pick<ChatContextUsedItem, 'category' | 'label' | 'detail'> {
    if (tool === 'inspect_obsidian_note') {
        return {
            category: 'read-only-tool',
            label: ft('plugin.chat.formatter.contextTool.inspectNote.label'),
            detail: ft('plugin.chat.formatter.contextTool.inspectNote.detail'),
        };
    }
    // ... same pattern for each tool branch ...
    return {
        category: 'read-only-tool',
        label: ft('plugin.chat.formatter.contextTool.default.label'),
        detail: ft('plugin.chat.formatter.contextTool.default.detail'),
    };
}
```

**Note:** `ft()` calls `pluginT(key, locale ?? getPluginUiLanguage(), params)`
dynamically per render. This is correct because `getToolContextUsedInfo` is
called per-render, not at import time.

---

### 1.3 CHAT-F2: `getContextUsedItemsFromStatus` hardcoded English

**Problem:** `src/chat/formatters.ts` lines 231-283 has 6 hardcoded English
strings for `label` and `detail` in context-used UI items.

**New locale keys (10 keys):**

| Key | EN | ZH |
| --- | --- | --- |
| `plugin.chat.formatter.contextUsed.selectedMemory` | Selected Memory | 已选 Memory |
| `plugin.chat.formatter.contextUsed.selectedNoteOne` | 1 selected note | 1 篇已选笔记 |
| `plugin.chat.formatter.contextUsed.selectedNoteMany` | {count} selected notes | {count} 篇已选笔记 |
| `plugin.chat.formatter.contextUsed.toolUnavailableLabel` | {label} unavailable | {label}不可用 |
| `plugin.chat.formatter.contextUsed.vaultContextUnavailable` | Vault context was unavailable for this turn. | 此轮 vault 上下文不可用。 |
| `plugin.chat.formatter.contextUsed.partialDetail` | Partial {detail} | 部分{detail} |
| `plugin.chat.formatter.contextUsed.usingGathered` | Using gathered context | 使用已收集上下文 |
| `plugin.chat.formatter.contextUsed.availableContext` | Available context | 可用上下文 |
| `plugin.chat.formatter.contextUsed.answeredAfterLimit` | Answering from context gathered before the planning limit was reached. | 基于达到规划上限前收集的上下文回答。 |
| `plugin.chat.formatter.contextUsed.answeredFromAvailable` | Answering from available context for this turn. | 基于本轮可用上下文回答。 |

**Dependency:** CHAT-F2 depends on CHAT-F1 because it calls
`getToolContextUsedInfo`, and the returned `label`/`detail` are now localized
strings used in template interpolation. The composed string
`ft('...toolUnavailableLabel', { label: toolInfo.label })` will produce
e.g., "笔记结构不可用" in ZH.

---

### 1.4 CHAT-F3: `handleCanonicalLifecycleEvent` 7 hardcoded strings

**Problem:** `src/chat/chat-view.ts` lines 2102-2163 has 8 English strings
passed to `addCanonicalActivity()` that appear in the assistant activity log.

**New locale keys (9 keys):**

| Key | EN | ZH |
| --- | --- | --- |
| `plugin.chat.lifecycle.startingRun` | Starting assistant run... | 正在启动助手... |
| `plugin.chat.lifecycle.continuingWithTools` | Continuing with tool results... | 正在继续处理工具结果... |
| `plugin.chat.lifecycle.decidingContext` | Deciding what context to use... | 正在选择参考内容... |
| `plugin.chat.lifecycle.readingModelProgress` | Reading model progress... | 正在读取模型进度... |
| `plugin.chat.lifecycle.draftBeforeToolUse` | Working on: {preview} | 正在处理：{preview} |
| `plugin.chat.lifecycle.movingDraftToProgress` | Preparing response... | 正在准备回答... |
| `plugin.chat.lifecycle.preparingTool` | Looking up {tool}... | 正在查找 {tool}... |
| `plugin.chat.lifecycle.preparingToolCall` | Looking up information... | 正在查找信息... |
| `plugin.chat.lifecycle.toolResultReceived` | {tool} result received | {tool} 结果已接收 |

**`ft()` access in chat-view.ts:** Define a local helper (preferred over
exporting from formatters.ts to avoid coupling):
```ts
const ft = (key: string, params?: Record<string, unknown>) =>
    pluginT(key, getPluginUiLanguage(), params);
```

---

### 1.5 MODAL-F1: Quick Capture Escape behavior (Decision D3)

**Note:** This item was initially in Phase 1 as a spec fix but is superseded
by Decision D3 in Phase 2a. See Phase 2a D3 for the canonical implementation
that adds a Toast "Draft saved" notification.

---

### Phase 1 Dependency Ordering

```
1. Locale keys first (en.json / zh.json for both pagelet and plugin)
   |
   +-- TAB-P0-2 locale keys (pagelet en.json + zh.json)
   |   Then TabView.ts + MemoryGovernanceSection.ts code changes
   |
   +-- CHAT-F1 locale keys (plugin en.json + zh.json)
   |   Then formatters.ts:24-86 code changes
   |
   +-- CHAT-F2 locale keys (plugin en.json + zh.json)
   |   Then formatters.ts:231-283 code changes
   |   (depends on CHAT-F1 -- returned label/detail are now localized)
   |
   +-- CHAT-F3 locale keys (plugin en.json + zh.json)
       Then chat-view.ts code changes
```

### Phase 1 Commit Strategy

- Commit A: `feat(i18n): add locale keys for tab status, chat tools, and lifecycle`
  -- all 46 new locale keys (pagelet + plugin, en + zh)
- Commit B: `fix(i18n): wrap tab ReviewQueue status chips with pageletT()`
  -- TAB-P0-2 code fix
- Commit C: `fix(i18n): localize chat context-used and lifecycle strings`
  -- CHAT-F1/F2/F3 code fixes

### Phase 1 Files Modified (9 total)

1. `src/locales/pagelet/en.json`
2. `src/locales/pagelet/zh.json`
3. `src/locales/plugin/en.json`
4. `src/locales/plugin/zh.json`
5. `src/pagelet/tab/TabView.ts` (line 743)
6. `src/pagelet/tab/sections/MemoryGovernanceSection.ts` (line 144)
7. `src/chat/formatters.ts` (lines 24-86, 231-283)
8. `src/chat/chat-view.ts` (lines 2102-2163)
9. `src/quick-capture.ts` (line 355 -- if not deferred to Phase 2a)

### Phase 1 New Locale Keys Total

- **Pagelet locale files:** 9 new keys (reviewQueue status)
- **Plugin locale files:** 37 new keys (18 contextTool + 10 contextUsed + 9 lifecycle)
- **Total: 46 keys** (23 EN + 23 ZH)

### Phase 1 Risk Assessment

| Item | Risk | Mitigation |
| --- | --- | --- |
| TAB-P0-2 | Low | `pageletT` fallback chain handles missing keys gracefully |
| CHAT-F1 | Low-Medium | Returned localized `label` is interpolated into other locale strings -- verify ZH composition |
| CHAT-F2 | Low | Template `{label} unavailable` receives localized label -- correct composition |
| CHAT-F3 | Very Low | Activity log strings are ephemeral debug/progress indicators |
| Locale parity | CI blocker | `pa-locales-pagelet.test.ts` asserts EN/ZH parity -- always add to both simultaneously |

---

## Phase 2a: Product Decision Quick Implementations

### D1: Quick Capture Onboarding Nudge

**Goal:** Surface a one-time nudge after the user's first Quick Capture save,
explaining that PA will remind them when the captured thought becomes relevant.

**Current state:** `OnboardingNudgeKind.quick_capture` already exists (line 48
of `src/pagelet/bubble/BubbleContent.ts`). The orchestrator method
`setOnboardingNudge(kind)` exists at line 590 of
`src/pagelet/orchestrator.ts`. Nudge text already in locales:
`pagelet.onboarding.quickCapture`.

**Changes:**
1. `src/pagelet/orchestrator.ts` (or QuickCaptureHost wiring): After the
   first `QuickCaptureResult` with `status: "saved"`, call
   `this.setOnboardingNudge("quick_capture")`. Gate with a persistent flag.
2. `src/settings.ts` / settings type: Add `quickCaptureOnboardingShown: boolean`
   (default `false`). Set to `true` after the nudge fires.
3. No new locale keys or CSS needed.

**Risk:** Low. All infrastructure exists; this is purely wiring.

---

### D3: Quick Capture Escape -- Keep Preserve + Toast "Draft saved"

**Goal:** When Escape closes the modal without explicit cancel/save, show a
Toast "Draft saved" to confirm draft preservation.

**Changes:**
1. `src/quick-capture.ts` lines 442-449 -- in `onClose()`, add `Notice` when
   preserving a non-empty draft:
   ```ts
   onClose(): void {
       if (this.closeBehavior === "discard") {
           this.draft.onDiscard();
       } else if (this.inputEl) {
           const value = this.inputEl.value;
           this.draft.onChange(value);
           if (value.trim().length > 0) {
               new Notice(this.copy.draftSaved);
           }
       }
       this.inputEl = null;
   }
   ```
2. `src/quick-capture.ts` interface `QuickCaptureCopy` (lines 32-41): Add
   `draftSaved: string` field.
3. **New locale keys:**
   - `plugin.quickCapture.draftSaved`: "Draft saved" / "草稿已保存"
4. Wire `draftSaved` wherever `QuickCaptureCopy` is constructed.

**Risk:** Low.

---

### D4: Quick Capture Save Destination Display

**Goal:** Show muted text below the modal title indicating where the capture
will be saved.

**Changes:**
1. `src/quick-capture.ts` constructor: Accept `destinationLabel: string`.
2. `src/quick-capture.ts` interface `QuickCaptureCopy`: Add `savingToPrefix`.
3. `src/quick-capture.ts` `onOpen()` around line 375 -- after `h2` title:
   ```ts
   const destLabel = contentEl.createEl("div", {
       text: `${this.copy.savingToPrefix} ${this.destinationLabel}`,
       cls: "pa-quick-capture-modal__destination",
   });
   ```
4. **New locale keys:**
   - `plugin.quickCapture.savingTo`: "Saving to: {destination}" / "保存至：{destination}"
   - `plugin.quickCapture.destination.daily`: "Daily Note" / "每日笔记"
   - `plugin.quickCapture.destination.inbox`: "Inbox" / "收件箱"
   - `plugin.quickCapture.destination.current-file`: "Current File" / "当前文件"
5. **CSS:**
   ```css
   .pa-quick-capture-modal__destination {
       color: var(--text-muted);
       font-size: var(--font-ui-small);
       margin-top: -4px;
       margin-bottom: 8px;
   }
   ```

**Risk:** Low. Pure additive UI.

---

### D7: Tab Top 3 + Show More

**Goal:** Show only the top 3 rendered sections initially, collapsing the rest
behind a "Show more sections" button.

**Section priority logic:** The visible top 3 sections are determined by
`entryReason`. When the user enters the Tab from a specific trigger (e.g.,
clicking a recall nudge), the corresponding section renders first. Remaining
slots fill by content volume. This ensures the North Star "return" surfaces
(Quiet Recall, Context Pager) appear first when the user enters for that
purpose, while "management" surfaces (Memory Governance, Maintenance) are
collapsed when they are not the entry reason.

**Changes:**
1. `src/pagelet/tab/TabView.ts`: Add `private sectionsExpanded = false;`.
2. Add a section priority sorter based on `entryReason`:
   ```ts
   private prioritizeSections(slots: RenderedSlot[]): RenderedSlot[] {
       const entryPrimary = this.currentOptions?.entryReason;
       return [...slots].sort((a, b) => {
           if (a.id === entryPrimary) return -1;
           if (b.id === entryPrimary) return 1;
           return (b.contentCount ?? 0) - (a.contentCount ?? 0);
       });
   }
   ```
3. In `renderContent()` around lines 404-416: After the render loop, if
   `renderedSlots.length > 3 && !sectionsExpanded`, hide sections beyond the
   3rd via a CSS class toggle (NOT direct style assignment — community
   compliance) and insert a "Show more" button with proper ARIA:
   ```ts
   if (renderedSlots.length > 3 && !this.sectionsExpanded) {
       const allSections = this.bodyEl.querySelectorAll(".pa-pagelet-tab-section");
       for (let i = 3; i < allSections.length; i++) {
           allSections[i].classList.add("pa-pagelet-tab-section--hidden");
       }
       const showMoreBtn = el("button", "pa-pagelet-tab-show-more",
           pageletT("pagelet.tab.showMore", this.locale, { count: renderedSlots.length - 3 }));
       showMoreBtn.setAttribute("type", "button");
       showMoreBtn.setAttribute("aria-expanded", "false");
       showMoreBtn.addEventListener("click", () => {
           this.sectionsExpanded = true;
           showMoreBtn.setAttribute("aria-expanded", "true");
           this.rerenderCurrentContentPreservingScroll();
       });
       this.bodyEl.appendChild(showMoreBtn);
   }
   ```
4. Reset `sectionsExpanded` in `clearSectionActionState()`.
5. **New locale keys:**
   - `pagelet.tab.showMore`: "Show {count} more sections" / "展开更多 ({count} 个分区)"
6. **CSS:**
   ```css
   .pa-pagelet-tab-section--hidden { display: none; }
   .pa-pagelet-tab-show-more {
       display: block;
       width: 100%;
       padding: 8px 16px;
       margin-top: 8px;
       background: transparent;
       border: 1px dashed var(--background-modifier-border);
       border-radius: var(--radius-s);
       color: var(--text-muted);
       font-size: var(--font-ui-small);
       cursor: pointer;
   }
   .pa-pagelet-tab-show-more:hover {
       color: var(--text-normal);
       border-color: var(--text-muted);
   }
   body.is-mobile .pa-pagelet-tab-show-more {
       min-height: 44px;
       padding: 10px 16px;
       font-size: 13px;
   }
   ```

**Risk:** Medium. Must scope the selector to only tracked
`.pa-pagelet-tab-section` elements, not utility/nav elements. The
`entryReason` priority sort adds complexity but uses the existing
`TabViewOptions.entryReason` field.

---

### D8: Recall Language -- "Next:" to "你可以：{action}"

**Goal:** Change the "Next: {action}" label in Quiet Recall cards to a more
natural phrasing.

**Changes (locale-only):**
1. `src/locales/pagelet/en.json`: `"pagelet.tab.recall.nextAction"`: `"Next: {action}"` --> `"You could: {action}"`
2. `src/locales/pagelet/zh.json`: `"pagelet.tab.recall.nextAction"`: `"下一步：{action}"` --> `"你可以：{action}"`

No code or CSS changes.

**Risk:** Very low.

---

### D9: Panel Scope Collapse

**Goal:** Collapse token estimates and candidate checkboxes into a `<details>`.

**Changes:**
1. `src/pagelet/panel/PanelView.ts` `renderScopeControls()`: After the ranges
   div (line 536), insert a `<details>` element wrapping lines 538-576 (summary
   chips, included candidates, skipped candidates, empty state).
   ```ts
   const details = createHtmlElement("details");
   details.className = "pa-pagelet-panel-scope-details";
   const summaryEl = createHtmlElement("summary");
   summaryEl.textContent = pageletT("pagelet.panel.scope.detailsSummary", this.getLocale(), {
       count: scope.candidates.length,
       tokens: scope.estimatedInputTokens ?? 0,
   });
   details.appendChild(summaryEl);
   // ... reparent child elements under details ...
   section.appendChild(details);
   ```
2. **New locale keys:**
   - `pagelet.panel.scope.detailsSummary`: "{count} notes, ~{tokens} tokens" / "{count} 篇笔记，约 {tokens} tokens"
3. **CSS:**
   ```css
   .pa-pagelet-panel-scope-details { margin-top: 6px; }
   .pa-pagelet-panel-scope-details > summary {
       color: var(--text-muted);
       font-size: var(--font-ui-small);
       cursor: pointer;
       list-style: none;
   }
   .pa-pagelet-panel-scope-details > summary::before {
       content: "\25B6";
       display: inline-block;
       margin-right: 4px;
       font-size: 0.7em;
       transition: transform 0.15s ease;
   }
   .pa-pagelet-panel-scope-details[open] > summary::before {
       transform: rotate(90deg);
   }
   ```

**Risk:** Low. Self-contained in `renderScopeControls()`.

---

### D10: Status Chips (Weekly scan nav link, remove internal terms)

**Goal:** (a) Make "Weekly scan is off" chip a navigable link to Settings.
(b) Remove "Not added to kept items" chip from Graph Discovery.

**Changes:**
1. `src/pagelet/tab/sections/MaintenanceReviewSection.ts` line 69: Replace
   plain chip with clickable button:
   ```ts
   const weeklyChip = el("button", "pa-pagelet-tab-tag-chip pa-pagelet-tab-tag-chip--link",
       pageletT("pagelet.tab.maintenance.weeklyDisabled", this.locale));
   weeklyChip.setAttribute("type", "button");
   weeklyChip.addEventListener("click", (event) => {
       event.preventDefault();
       this.callbacks.onOpenSettings?.();
   });
   tagRow.appendChild(weeklyChip);
   ```
2. `MaintenanceReviewCallbacks` interface: Add `onOpenSettings?: () => void`.
3. Wire `onOpenSettings` through the full callback chain (4 layers):
   `PageletHost/orchestrator` provides `() => app.setting.open()` →
   `PageletDetailView` tab options → `TabView` creates section callbacks →
   `MaintenanceReviewSection` receives callback.
   Files touched: `orchestrator.ts`, `PageletDetailView.ts`, `TabView.ts`,
   `MaintenanceReviewSection.ts`.
4. **Modified locale keys:**
   - `pagelet.tab.maintenance.weeklyDisabled`: "Weekly scan is off" --> "Weekly scan: configure in Settings" / "每周扫描：前往设置"
5. `src/pagelet/tab/TabView.ts` lines 545-547: Remove `noQueue` chip entirely.
6. Change "Preview only" chip rendering from `pa-pagelet-tab-tag-chip` to
   `pa-pagelet-tab-muted` class.
7. **CSS:**
   ```css
   .pa-pagelet-tab-tag-chip--link {
       cursor: pointer;
       text-decoration: underline;
       background: transparent;
       border: none;
       color: var(--text-accent);
       font-size: inherit;
       padding: 0;
   }
   .pa-pagelet-tab-tag-chip--link:hover { color: var(--text-accent-hover); }
   ```

**Risk:** Medium. Requires 4-layer callback threading (orchestrator →
PageletDetailView → TabView → MaintenanceReviewSection). Alternative: emit
a custom DOM event from the chip and listen in the orchestrator to avoid
callback threading.

---

### D11: Chat Loader -- Slow to ~10s, Slightly Reduce Saturation

**Goal:** Slow the 5-color cycle animation and reduce vibrance slightly.

**Changes (CSS-only in `src/custom.pcss`):**
1. Line 1167: Change animation duration `3s` --> `10s`.
2. Lines 1150-1154: Slightly desaturate colors:
   ```css
   --pa-chat-loader-color-rose: #e84466;    /* was #ff2d55 */
   --pa-chat-loader-color-orange: #e89a2a;  /* was #ff9500 */
   --pa-chat-loader-color-lime: #48c25e;    /* was #32d74b */
   --pa-chat-loader-color-cyan: #2ab8e0;    /* was #00c7ff */
   --pa-chat-loader-color-violet: #b06de0;  /* was #bf5af2 */
   ```

**Risk:** Very low. Pure CSS cosmetic change. Exact hex values should be
validated visually.

---

### D12: Stats Overview Range Picker

**Goal:** Show the range picker (30d / 90d / All) on the Overview tab.

**Changes:**
1. `src/components/Statistics.tsx` line 441:
   ```ts
   // BEFORE
   const showRangePicker = activeView === "daily" || activeView === "growth";
   // AFTER
   const showRangePicker = activeView === "overview" || activeView === "daily" || activeView === "growth";
   ```
2. **Critical:** The overview chart data source uses `recentDays`
   (hardcoded to `days.slice(-30)` at line 241), NOT `chartDays` (which
   respects `chartRange`). Without this fix, the range picker will appear
   but have no effect. Change the overview branch in `activeChartData` memo
   (lines 331-347) from `toPoints(recentDays, ...)` to
   `toPoints(chartDays, ...)`. Also update the `writtenWords30` metric card
   label to reflect the selected range (e.g., "Words ({range})").

**Risk:** Low-Medium. Two changes: boolean condition + data source switch.
Test that overview chart updates when switching 30d/90d/All.

---

### D14: Memory Settings Visual Hierarchy

**Goal:** Add indentation and left border to distinguish 3-level nesting in
Memory settings.

**Changes:**
1. `src/settings.ts` line 2536:
   ```ts
   this.memorySubContainer = parentEl.createDiv({ cls: "pa-settings-nested pa-settings-nested--level-1" });
   ```
2. `src/settings.ts` line 2641:
   ```ts
   this.memoryAdvancedContainer = container.createDiv({ cls: "pa-settings-nested pa-settings-nested--level-2" });
   ```
3. **CSS:**
   ```css
   .pa-settings-nested {
       margin-left: 12px;
       padding-left: 12px;
       border-left: 2px solid var(--background-modifier-border);
   }
   .pa-settings-nested--level-2 {
       margin-left: 8px;
       padding-left: 8px;
       border-left-style: dashed;
   }
   ```

**Risk:** Very low. Pure CSS on existing container divs.

---

### D15: Data Boundary -- Replace 6 Buttons with Info Card

**Goal:** Replace 6 disabled "Unavailable" cleanup buttons with a single
informational card.

**Changes:**
1. `src/settings.ts` lines 1599-1611: Replace the `for` loop over
   `DATA_CLEANUP_GROUPS` with a single info card:
   ```ts
   parentEl.createEl("h3", { text: this.t("plugin.settings.dataBoundary.cleanup.title") });
   const cleanupCard = parentEl.createDiv({ cls: "pa-settings-info-card" });
   cleanupCard.createEl("p", {
       text: this.t("plugin.settings.dataBoundary.cleanup.infoCard"),
       cls: "pa-settings-info-card-text",
   });
   const cleanupList = cleanupCard.createEl("ul", { cls: "pa-settings-info-card-list" });
   for (const group of DATA_CLEANUP_GROUPS) {
       cleanupList.createEl("li", { text: this.t(DATA_BOUNDARY_CLEANUP_LABEL_KEYS[group]) });
   }
   ```
2. **New locale keys:**
   - `plugin.settings.dataBoundary.cleanup.infoCard`: "Local data cleanup will be available in a future version. The following data categories are managed by PA:" / "本地数据清理将在未来版本中开放。PA 管理以下数据类别："
3. **CSS:**
   ```css
   .pa-settings-info-card {
       background: var(--background-secondary);
       border-radius: var(--radius-m);
       padding: 12px 16px;
       margin: 8px 0;
       border: 1px solid var(--background-modifier-border);
   }
   .pa-settings-info-card-text {
       color: var(--text-muted);
       font-size: var(--font-ui-small);
       margin: 0 0 8px;
   }
   .pa-settings-info-card-list {
       color: var(--text-muted);
       font-size: var(--font-ui-small);
       padding-left: 20px;
       margin: 0;
   }
   .pa-settings-info-card-list li { margin-bottom: 2px; }
   ```

**Risk:** Low. Desc keys for cleanup groups become unused (can keep or remove).

---

### Phase 2a Implementation Order

No inter-decision dependencies. Recommended order by risk (lowest first):

| Order | Decision | Risk | Rationale |
| --- | --- | --- | --- |
| 1 | D8 | Very Low | Locale-only, zero code risk |
| 2 | D11 | Very Low | CSS-only |
| 3 | D14 | Very Low | CSS + 2 lines of code |
| 4 | D15 | Low | Settings UI simplification, self-contained |
| 5 | D12 | Low | Single condition change |
| 6 | D3 | Low | Small code change + new copy field |
| 7 | D4 | Low | New param threading to modal |
| 8 | D9 | Low | Panel scope refactor, self-contained |
| 9 | D10 | Low-Medium | New callback threaded through section constructor |
| 10 | D7 | Medium | Tab show-more logic, DOM manipulation |
| 11 | D1 | Low-Medium | Settings persistence + integration wiring |

### Phase 2a New Locale Keys Summary

**Pagelet locales:** 2 new + 2 modified keys
**Plugin locales:** 6 new keys

### Phase 2a CSS Changes Summary

All additions in `src/custom.pcss`:
- D4: `.pa-quick-capture-modal__destination`
- D7: `.pa-pagelet-tab-show-more`
- D9: `.pa-pagelet-panel-scope-details`
- D10: `.pa-pagelet-tab-tag-chip--link`
- D11: Modified color variables and animation duration
- D14: `.pa-settings-nested`, `.pa-settings-nested--level-2`
- D15: `.pa-settings-info-card`, `.pa-settings-info-card-text`, `.pa-settings-info-card-list`

### Phase 2a Files Touched

| File | Decisions |
| --- | --- |
| `src/quick-capture.ts` | D3, D4 |
| `src/pagelet/tab/TabView.ts` | D7, D10 |
| `src/pagelet/tab/sections/MaintenanceReviewSection.ts` | D10 |
| `src/pagelet/panel/PanelView.ts` | D9 |
| `src/pagelet/orchestrator.ts` | D1 |
| `src/settings.ts` | D14, D15 |
| `src/components/Statistics.tsx` | D12 |
| `src/custom.pcss` | D4, D7, D9, D10, D11, D14, D15 |
| `src/locales/pagelet/en.json` | D7, D8, D9, D10 |
| `src/locales/pagelet/zh.json` | D7, D8, D9, D10 |
| `src/locales/plugin/en.json` | D3, D4, D15 |
| `src/locales/plugin/zh.json` | D3, D4, D15 |
| Settings type | D1 |

---

## Phase 2b: Structural Decision SDDs

### SDD-D5: ReviewQueue Merge into Memory Governance and Maintenance Sections

#### Current Architecture

The ReviewQueue renders as its own section in `TabView.ts` (line 389) via
`renderReviewQueueContent()` (lines 684-756). It has its own filter UI
("All" / "Active" / "History"), its own Tab section-nav slot (`review-queue`),
dedicated CSS class `pa-pagelet-tab-review-queue`, and 20 locale keys under
`pagelet.tab.reviewQueue.*`.

**ReviewQueueItemType taxonomy (14 types):**
- Memory-domain: `memory_candidate`, `memory_conflict`
- Maintenance-domain: `maintenance_proposal`, `action_log`, `broad_scan_plan`
- Discovery/insight-domain: `evidence_insight`, `capture_enrichment`, `task_suggestion`, `recall_suggestion`, `related_note`, `theme_chain`, `conflict_pair`, `index_note_candidate`, `review_summary`

Memory candidates are ALREADY separately rendered in `MemoryGovernanceSection`,
creating duplication. The routing function MUST exclude `memory_candidate` and
`memory_conflict` from routed items to avoid double-rendering (see Dedup Rule
below).

#### Target Architecture: Item Routing

| ReviewQueueItemType | Target Section | Rationale |
| --- | --- | --- |
| `memory_candidate` | MemoryGovernanceSection | Already rendered there |
| `memory_conflict` | MemoryGovernanceSection | Already rendered there |
| `evidence_insight` | MemoryGovernanceSection | Knowledge/context |
| `capture_enrichment` | MemoryGovernanceSection | Memory capture pipeline |
| `task_suggestion` | MemoryGovernanceSection | Task context as memory |
| `recall_suggestion` | MemoryGovernanceSection | Memory retrieval |
| `theme_chain` | MemoryGovernanceSection | Theme knowledge |
| `review_summary` | MemoryGovernanceSection | Summary knowledge |
| `maintenance_proposal` | MaintenanceReviewSection | Maintenance domain |
| `action_log` | MaintenanceReviewSection | Action recovery |
| `broad_scan_plan` | MaintenanceReviewSection | Scan operations |
| `related_note` | MaintenanceReviewSection | Note organization |
| `conflict_pair` | MaintenanceReviewSection | Structural conflict |
| `index_note_candidate` | MaintenanceReviewSection | Note structure |

**Simplified grouping rule:**
- **Memory Governance**: items about knowledge/facts/context
- **Maintenance Review**: items about note structure/organization/actions

**Dedup Rule:** `splitReviewQueueForSections()` MUST exclude item types
already delivered via the existing `memoryGovernance.candidates` pipeline
(`memory_candidate`, `memory_conflict`). These items are already rendered
by `MemoryGovernanceSection` via `orchestrator.ts:1670-1674`. Without this
exclusion, the same item renders twice. Implementation: filter by type in
the routing function, NOT in the section renderer.

Each target section gains a "Suggestions" sub-group. ReviewQueue filter bar
and `reviewQueueTabFilter` state property are removed. No unified history
view is needed (per product decision — each section shows its own status).

#### Phased Implementation

**Phase 1 (low risk):** Create `src/pagelet/tab/review-queue-routing.ts`:
```ts
type ReviewQueueRouteTarget = "memory" | "maintenance";
function routeReviewQueueItem(item: ReviewQueueItem): ReviewQueueRouteTarget;
function splitReviewQueueForSections(items: ReviewQueueItem[]): {
    memory: ReviewQueueItem[];
    maintenance: ReviewQueueItem[];
};
```
Unit-test routing for all 14 item types.

**Phase 2 (medium risk):** Add `routedItems?: ReviewQueueItem[]` to
`PanelMemoryGovernanceState` and `PanelMaintenanceReviewState`. Render
"Suggestions" sub-group in each section.

**Phase 3 (medium risk):** Wire routing in orchestrator --
`splitReviewQueueForSections()` in `withGlobalLedgerExtra()` and
`withGlobalReviewQueueExtra()`.

**Phase 4 (low risk):** Remove `renderReviewQueueContent()` from TabView.ts,
remove `review-queue` slot from `allSlots`, remove `reviewQueueTabFilter`.
Mark `PageletDetailExtra.reviewQueue` as `@deprecated`.

**Phase 5 (cleanup):** Remove orphaned locale keys and CSS classes.

#### New Locale Keys

```json
"pagelet.tab.memory.suggestionsTitle": "Suggestions" / "建议"
"pagelet.tab.memory.suggestionsSummary": "{count} review suggestions." / "{count} 条待查看建议。"
"pagelet.tab.maintenance.suggestionsTitle": "Suggestions" / "建议"
"pagelet.tab.maintenance.suggestionsSummary": "{count} review suggestions." / "{count} 条待查看建议。"
```

#### Deprecated/Removable Locale Keys (20 keys)

`pagelet.tab.reviewQueue.title`, `.summary`, `.filter.all`, `.group.active`,
`.group.history`, `.aiGenerated`, `.type.*` (12 type keys)

#### CSS Changes

- **Remove:** `.pa-pagelet-tab-review-queue-filters`, `*-filter`,
  `*-card--ai-callout`, `*-callout-label`, `*-why`
- **Keep:** `.pa-pagelet-tab-review-queue-summary`, `*-group`,
  `.pa-pagelet-tab-insight-card` (shared)
- **Add:** `.pa-pagelet-tab-memory-suggestions`,
  `.pa-pagelet-tab-maintenance-suggestions`

#### Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Items in wrong section | Medium | Unit-test routing for all 14 types |
| Duplicate rendering (memory candidates shown twice) | Medium | Filter memory_candidate/memory_conflict from routed items if already in candidates |
| Deserialization of old Tab state breaks | Low | `@deprecated reviewQueue` field kept; normalized on load |
| Routed items lose filter capability | Low | Product decision: filters rarely used |

**Rollback:** Revert 7+ file changes (TabView.ts, MemoryGovernanceSection.ts,
MaintenanceReviewSection.ts, orchestrator.ts, review-queue-routing.ts [delete],
pagelet en.json, pagelet zh.json; CSS changes in custom.pcss add an 8th file).
Store layer untouched. Full rollback in 1 commit.

---

### SDD-D6: Memory Candidates — Graduated Trust Model

> **Review note (2026-07-07):** The original D6 decision was "opt-out /
> auto-accept." Agent team review identified a P0 conflict with Low-Burden
> Review Product Principles §4.7 ("Confirmed Memory requires explicit user
> confirmation") and the North Star ("Less full automation, more earned
> trust"). The decision was revised to a graduated trust model that earns
> auto-accept through demonstrated user engagement.
>
> **Approved amendment (2026-07-10):** The user approved silent Level 2
> activation after 30 manual confirmations. `ConfirmedMemoryRecord` is the
> canonical Memory state; Review Queue entries remain workflow/audit records.
> Level 2 can be paused/resumed without decrementing the trust counter.

#### Previous Architecture (Opt-in, flat)

Memory candidates enter as `ReviewQueueItem` with type `memory_candidate`,
status `suggested`. User must click **Confirm** to accept, **Dismiss** to
exclude. `MemoryGovernanceSection` renders both buttons per item, plus a
batch "Confirm visible" button.

```
suggested -> (user confirms) -> accepted/applied -> ConfirmedMemoryRecord(active)
suggested -> (user dismisses) -> dismissed
```

#### Implemented Architecture (Graduated Trust, 3 levels)

Trust is earned through cumulative manual confirmations. The user progresses
through 3 levels:

```
Level 0 (new user, < 10 confirmed):
    Per-item Confirm / Dismiss buttons (current behavior)

Level 1 (10+ confirmed):
    Batch digest: "PA found {count} new memories this week — review?"
    [Accept all] [Review] [Later]

Level 2 (30+ confirmed):
    Auto-accept with "Auto-accepted" badge
    User can remove any confirmed record and can pause/resume auto-accept
    memory_conflict items ALWAYS require manual review (never auto-accepted)
```

**State machine:**
```
(AI extracts candidate)
  └─ Level 0 → suggested → (user confirms) → accepted → ConfirmedMemoryRecord
  └─ Level 1 → suggested → (batch digest) → accepted → ConfirmedMemoryRecord
  └─ Level 2 → auto-confirmed → ConfirmedMemoryRecord(confirmationStrength: "auto")
               (user may dismiss → forgotten_tombstone)
```

**Key constraints:**
- `memory_conflict` items are NEVER auto-accepted at any level
- task constraints are never auto-accepted
- only `low`-sensitivity candidates are eligible; `medium` and `high` always
  remain manual
- only newly created eligible candidates are auto-confirmed; reaching Level 2
  never sweeps historical `suggested` candidates
- `ConfirmedMemoryRecord` is the canonical current state; an optional
  `originReviewQueueItemId` links back to workflow/audit history
- removing a record creates a content-free tombstone and best-effort changes a
  linked `applied` queue item to `undone`; the tombstone is a durable retry
  marker if that audit write fails, while legacy unlinked records remain safely
  removable
- `confirmationStrength: "auto"` distinguishes Level 2 records
- `memoryAutoAcceptPaused` disables auto-confirm without changing the monotonic
  `confirmedMemoryCount`
- the Memory master setting disables both Memory use and automatic acceptance
- Auto-confirmed records may be weighted lower in retrieval ranking
- Trust level is determined by `confirmedMemoryCount` (persisted in settings)

#### Trust Level Determination

```ts
interface MemoryTrustConfig {
    level1Threshold: 10;
    level2Threshold: 30;
}

function getMemoryTrustLevel(confirmedCount: number): 0 | 1 | 2 {
    if (confirmedCount >= 30) return 2;
    if (confirmedCount >= 10) return 1;
    return 0;
}
```

#### UI Changes per Level

**Level 0 (current behavior, no change):**
- Per-item Confirm / Dismiss buttons
- "Confirm visible" batch button when confirmable.length > 1

**Level 1 (batch digest):**
- Replace per-item buttons with a periodic digest notification
- Digest appears as a Bubble nudge or Tab section header
- Copy: "PA learned {count} things from your recent notes. Review?"
- Actions: [Accept all] [Review individually] [Later]
- Digest frequency: at most once per session, or weekly if items accumulate

**Level 2 (auto-accept with removal):**
- Applied queue entries are not used as the user-facing Memory card.
- Render the canonical `ConfirmedMemoryRecord` with a muted "Auto-accepted"
  badge and a confirmed "Remove" action.
- "Remove" calls `governance.forget()`, immediately renders the tombstone, and
  reconciles linked queue audit state when available.
- Settings shows a Level 2-only automatic acceptance toggle. Turning it off
  pauses future automatic confirmation; turning it on resumes it.
- Copy: "{count} memories PA learned recently. You can remove any that
  don't fit." / "{count} 条 PA 近期学到的记忆。不合适的可以随时移除。"
- `memory_conflict` items retain manual Confirm/Dismiss at all levels

#### Phased Implementation

**Phase 1 (low risk):** Schema and trust logic.
1. Extend `ConfirmedMemoryRecord.confirmationStrength` union:
   `"light" | "explicit" | "special" | "auto"` at
   `src/pa/memory-governance-store.ts:31`
2. Create `src/pa/memory-trust-level.ts`:
   ```ts
   export const MEMORY_TRUST_THRESHOLDS = { level1: 10, level2: 30 } as const;
   export function getMemoryTrustLevel(confirmedCount: number): 0 | 1 | 2;
   ```
3. Add `confirmedMemoryCount: number` to plugin settings (default 0).
   Increment on each successful confirm. Unit-test threshold logic.

**Phase 2 (low risk):** Level 0 — no UI change, just wire trust level
tracking. Each confirm increments `confirmedMemoryCount`.

**Phase 3 (medium risk):** Level 1 — batch digest.
1. Create digest aggregation in orchestrator: collect pending candidates,
   format a batch digest message.
2. Surface as Bubble nudge (reuse `OnboardingNudgeKind` pattern) or Tab
   section header.
3. Wire "Accept all" to batch confirm with `confirmationStrength: "explicit"`.

**Phase 4 (medium risk):** Level 2 — record-first auto-accept pipeline.
1. Wire new-candidate auto-confirm into `PluginManager`; guard Level 2, pause
   state, conflict/task-constraint types, and candidate eligibility.
2. Persist `originReviewQueueItemId` on the resulting
   `ConfirmedMemoryRecord` for exact audit reconciliation.
3. Render canonical Memory records in `MemoryGovernanceSection`, including the
   auto badge, confirmed removal, immediate tombstone state, and legacy
   unlinked-record fallback.
4. Add the Level 2 pause/resume setting.

**Phase 5 (low risk):** Locale and copy updates.

**No data migration needed:** Unlike the original opt-out design, the
graduated model does not auto-confirm existing `suggested` candidates. Users
at Level 0 continue with the current flow. Users who have already confirmed
30+ items immediately reach Level 2 based on their existing
`confirmedMemoryCount`, unless they pause automatic acceptance. Existing
confirmed records without `originReviewQueueItemId` remain removable and do
not attempt unsafe queue inference.

#### New Locale Keys

```json
"pagelet.tab.memory.autoAccepted": "Auto-accepted" / "自动接受"
"pagelet.tab.memory.remove": "Remove" / "移除"
"pagelet.tab.memory.removing": "Removing..." / "正在移除..."
"pagelet.tab.memory.removed": "Removed" / "已移除"
"pagelet.tab.memory.removeFailed": "Could not remove memory: {reason}" / "无法移除记忆：{reason}"
"pagelet.tab.memory.trustDigest": "PA learned {count} things from your recent notes." / "PA 从你近期的笔记中学到了 {count} 条内容。"
"pagelet.tab.memory.trustDigestReview": "Review?" / "查看？"
"pagelet.tab.memory.trustDigestAcceptAll": "Accept all" / "全部接受"
"pagelet.tab.memory.trustDigestLater": "Later" / "稍后"
"pagelet.tab.memory.level2Summary": "{count} memories PA learned recently. You can remove any that don't fit." / "{count} 条 PA 近期学到的记忆。不合适的可以随时移除。"
```

#### Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Level 2 auto-confirmed memory pollutes context | Medium | `confirmationStrength: "auto"` allows retrieval-time filtering; can weight auto lower. Only reached after user confirmed 30+ items, proving engagement |
| Threshold values wrong | Low | Thresholds are constants in `memory-trust-level.ts`; easy to tune |
| User confused by changing UI behavior | Medium | Each level transition can show a one-time explanation nudge |
| Conflict items auto-accepted | High | Explicit guard: `memory_conflict` excluded at all levels |
| 3-level state machine complexity | Medium | Each level is a clean branch in MemoryGovernanceSection; no shared mutable state between levels |
| Privacy concern at Level 2 | Low | User earned auto-accept through 30 manual confirmations; records are visible/removable; automatic acceptance can be paused |
| Memory and queue diverge during removal | Medium | Memory record is canonical; its text-free tombstone is a durable exact-link retry marker until queue audit reaches `undone` |

**Rollback:** Each level is independently reversible:
- Operational Level 2 rollback: switch off automatic acceptance in Settings;
  the trust counter and existing canonical records remain intact.
- Code rollback: disable the new-candidate auto-confirm branch and pause UI.
  Do not reconstruct queue candidates from Memory records; that would replace
  canonical user state with inferred workflow state. Existing auto records stay
  visible and individually removable.
- Level 1 rollback: revert digest UI. No data changes.
- Level 0: no rollback needed (current behavior).

**Document update completed (2026-07-10):** Low-Burden Review Product
Principles §2.2 and §4.7 now document graduated, record-first, reversible
Memory confirmation.

---

### SDD-D13: Settings Navigation -- Grouped Collapsible + Sticky Jump Nav

> **Superseded for current navigation layout (2026-07-12):** The sticky jump
> navigation below is historical implementation provenance. The active
> authority for navigation placement, responsive behavior, and Settings row
> alignment is the [Settings Layout Optimization SDD](./settings-layout-optimization-sdd.md).
> Existing group membership and collapse persistence remain valid.

#### Current Architecture

`PersonalAssistantSettingTab.display()` (line 913 of `src/settings.ts`) calls
16 render methods sequentially into `containerEl`, producing a long scrollable
form with no grouping, collapsibility, or navigation.

#### Target Architecture

**5 collapsible categories** using HTML `<details>`:

| Category | Sections |
| --- | --- |
| AI & Provider | AI Assistant, Skills, Memory |
| Data & Privacy | Data Boundary, Operations Agent |
| Features | Pagelet, Quick Capture, Statistics |
| Appearance | Daily Record, Graph, Graph Colors, Metadata, Featured Image |
| System | Advanced, Legal |

**Sticky jump-to-section navigation** at the top with 5 category labels.
Clicking opens the corresponding `<details>` and scrolls to it.

**Default state:** All categories start expanded. Users collapse as desired.
Collapse state persists via `localStorage` (key: `pa-settings-collapsed`),
NOT plugin settings.

#### Phased Implementation

**Phase 1 (no risk):** Create `src/settings/settings-groups.ts`:
```ts
interface SettingsGroup {
    id: string;
    labelKey: string;
    sections: Array<"AI" | "Skills" | "Memory" | "DataBoundary" | ...>;
}
const SETTINGS_GROUPS: readonly SettingsGroup[];
```
Unit-test coverage (all 16 sections in exactly 1 group).

**Phase 2 (medium risk):** Refactor `display()` to loop over `SETTINGS_GROUPS`:
```ts
for (const group of SETTINGS_GROUPS) {
    const details = containerEl.createEl("details", { cls: "pa-settings-group" });
    details.open = !this.isGroupCollapsed(group.id);
    const summary = details.createEl("summary", {
        cls: "pa-settings-group-summary",
        text: this.t(group.labelKey),
    });
    summary.setAttribute("id", `pa-settings-group-${group.id}`);
    details.addEventListener("toggle", () => {
        this.persistGroupCollapseState(group.id, !details.open);
    });
    for (const sectionName of group.sections) {
        (this as any)[`render${sectionName}Section`](../details);
    }
}
```

**Phase 3 (low risk):** Add sticky nav bar after `renderHeader()`.

**Phase 4 (low risk):** Collapse state persistence via `localStorage`.

**Phase 5 (medium risk):** CSS and mobile styling.

#### New Locale Keys

```json
"plugin.settings.nav.ariaLabel": "Settings navigation" / "设置导航"
"plugin.settings.group.aiProvider": "AI & Provider" / "AI 与服务"
"plugin.settings.group.dataPrivacy": "Data & Privacy" / "数据与隐私"
"plugin.settings.group.features": "Features" / "功能"
"plugin.settings.group.appearance": "Appearance" / "外观"
"plugin.settings.group.system": "System" / "系统"
```

#### CSS

```css
/* Sticky jump nav */
.pa-settings-nav {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    gap: 4px;
    padding: 8px 0;
    background: var(--background-primary);
    border-bottom: 1px solid var(--background-modifier-border);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
}
.pa-settings-nav-item {
    padding: 4px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: var(--font-small);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
}
.pa-settings-nav-item:hover { background: var(--background-modifier-hover); }
.pa-settings-nav-item:focus-visible { box-shadow: 0 0 0 2px var(--interactive-accent); }

/* Collapsible groups */
.pa-settings-group {
    margin-bottom: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    overflow: hidden;
}
.pa-settings-group-summary {
    padding: 12px 16px;
    font-weight: var(--font-semibold);
    font-size: var(--font-ui-medium);
    cursor: pointer;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--background-secondary-alt);
}
.pa-settings-group-summary::-webkit-details-marker { display: none; }
.pa-settings-group-summary::before {
    content: "";
    display: inline-block;
    width: 0; height: 0;
    border-left: 5px solid var(--text-muted);
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    transition: transform 150ms ease;
}
.pa-settings-group[open] > .pa-settings-group-summary::before {
    transform: rotate(90deg);
}
.pa-settings-group > :not(summary) { padding: 0 16px 8px; }

/* Mobile */
body.is-mobile .pa-settings-nav { padding: 6px 0; }
body.is-mobile .pa-settings-nav-item {
    min-height: 44px;
    padding: 8px 16px;
    font-size: var(--font-ui-small);
}
body.is-mobile .pa-settings-group-summary {
    min-height: 44px;
    padding: 12px 16px;
}
```

#### Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Sub-containers break inside `<details>` | Medium | Sub-containers are created by render methods, not dependent on direct parent being `containerEl` |
| Sticky nav overlaps content | Low | Fixed height + `scroll-margin-top` |
| `localStorage` not available (sandboxed mobile) | Low | Graceful fallback: all groups start expanded |
| Pagelet section delegation breaks | Low | `renderPageletSection()` only calls `createEl` on its parent -- works with any HTML element |

**Rollback:** Revert `display()` to flat sequential calls. One commit rollback.

#### Phase 2b Cross-cutting Concerns

**Implementation order:**
1. D13 (Settings Navigation) first -- lowest coupling, pure presentation
2. D5 (ReviewQueue Merge) second -- routing logic, no store changes
3. D6 (Memory Candidates Opt-out) last -- data pipeline + migration

**Shared patterns:** All three use `<details>`, keep store layers
untouched/minimally extended, have clean rollback paths.

**New files created:**
- `src/pagelet/tab/review-queue-routing.ts` (D5)
- `src/settings/settings-groups.ts` (D13)

D6 was implemented through the existing `PluginManager`, Memory governance
store, and Pagelet section boundaries; no parallel auto-confirm module was
created.

---

## Phase 3: P2 Quick Fixes

### Commit 1: `fix(css): add prefers-reduced-motion to pet animations`

**ID:** PET-P2-2 | **Risk:** Low | **File:** `src/custom.pcss`

Add after existing `@keyframes pa-pagelet-pet-*` blocks (lines 4374-4469):

```css
@media (prefers-reduced-motion: reduce) {
    .pa-pagelet-pet-svg-wrap {
        animation-duration: 0s !important;
        animation-iteration-count: 1 !important;
    }
}
```

**Test:** Toggle "Reduce motion" in macOS Accessibility. Verify pet remains
visible but stops animating.

---

### Commit 2: `fix(css): adjust pet mobile resting opacity`

**ID:** PET-P2-1 | **Risk:** Low | **File:** `src/custom.pcss`

Line 4649: Change `opacity: 1;` to `opacity: 0.8;`:

```css
body.is-mobile .pa-pagelet-pet[data-state=resting] {
    opacity: 0.8;  /* was: 1 */
    filter: none;
}
```

---

### Commit 3: `fix(css): extract connection graph colors to CSS custom properties`

**ID:** PNL-P2-4 | **Risk:** Low-Medium | **Files:** `src/custom.pcss`, `src/pagelet/panel/PanelLayouts.ts`

1. Add CSS custom properties under `.pa-pagelet-panel`:
   ```css
   .pa-pagelet-panel {
       --pa-conn-node-fill-0: #38bdf8;
       --pa-conn-node-stroke-0: #0369a1;
       /* ... 8 fill/stroke pairs, 2 edge-strong/weak, 4 edge-other colors ... */
   }
   ```

2. In `PanelLayouts.ts`, use `var()` in inline SVG style attributes:
   `style="fill: var(--pa-conn-node-fill-${i}, ${fallback})"`.

---

### Commit 4: `fix(css): extract chart colors to CSS custom properties`

**ID:** STAT-01+02, STAT-05 | **Risk:** Low-Medium | **Files:** `src/custom.pcss`, `src/components/Statistics.tsx`

1. Add chart color variables under `.pa-statistics-container`:
   ```css
   .pa-statistics-container {
       --pa-stat-chart-bar-bg: rgba(225, 29, 72, 0.35);
       --pa-stat-chart-bar-border: rgb(225, 29, 72);
       --pa-stat-chart-line-purple-bg: rgba(147, 51, 234, 0.14);
       --pa-stat-chart-line-purple-border: rgb(147, 51, 234);
       /* ... 10 total color properties ... */
   }
   ```

2. In `Statistics.tsx`, update `chartColors` useMemo (line 267-274) to read
   these via `getComputedStyle()` with hardcoded fallbacks.

3. Replace all hardcoded colors in `activeChartData` (lines 339-400) and
   tick colors in `commonOptions` (lines 318, 324) with `chartColors.*`.

This also fixes STAT-05 (light-theme-only fallbacks).

---

### Commit 5: `fix(i18n): translate ZH 'Memory' to native term in bubble setup`

**ID:** BUB-P2-1 | **Risk:** Low | **File:** `src/locales/pagelet/zh.json`

Lines 265-266: Replace English "Memory" with Chinese "记忆":
```json
"pagelet.bubble.needsSetup": "记忆还没有准备好。...",
"pagelet.bubble.needsSetup.prepare": "准备记忆"
```

---

### Commit 6: `fix(i18n): create panel-specific recall locale keys`

**ID:** PNL-P2-1, PNL-P2-5 | **Risk:** Low | **Files:** locale files, `src/pagelet/panel/PanelView.ts`, `src/custom.pcss`

1. Add panel-specific recall keys:
   ```json
   "pagelet.panel.recall.title": "Quiet Recall" / "静默回忆"
   "pagelet.panel.recall.summary": "{count} source-backed recalls are available." / "..."
   "pagelet.panel.recall.empty": "No strong recall signal right now." / "..."
   ```
2. In `PanelView.ts` `renderQuietRecallSection()` (lines 746-794): Replace
   `pageletT("pagelet.tab.recall.*"` with `pageletT("pagelet.panel.recall.*"`.
3. Rename CSS classes from `pa-pagelet-panel-review-queue-*` to
   `pa-pagelet-panel-recall-*`. Add matching CSS rules.

---

### Commit 7: `fix(i18n): move hardcoded tool labels to locale in chat formatters`

**ID:** CHAT-F4, CHAT-F9 | **Risk:** Low | **Files:** `src/chat/formatters.ts`, plugin locale files

New keys:
```json
"plugin.chat.formatter.toolLabel.memory": "Memory" / "记忆"
"plugin.chat.formatter.toolLabel.webSearch": "Web Search" / "网络搜索"
"plugin.chat.formatter.toolDone": "{message}: {sources}" / "{message}：{sources}"
"plugin.chat.formatter.toolDoneNoSources": "{message}" / "{message}"
```

---

### Commit 8: `fix(i18n): genericize Qwen thinking label and fix enrichment defaults`

**ID:** CHAT-F10, MODAL-F10 | **Risk:** Low | **Files:** plugin locale files, `src/quick-capture-enrichment.ts`

1. CHAT-F10: Change `"plugin.chat.thinking.qwenThinking"` from "Qwen model
   is thinking..." to "Model is thinking..." / "模型思考中..."

2. MODAL-F10: Replace `DEFAULT_TITLES` hardcoded English in
   `quick-capture-enrichment.ts` (lines 69-76) with `pluginT()` calls.
   New keys:
   ```json
   "plugin.quickCapture.enrichment.title.title": "Suggested title" / "建议标题"
   "plugin.quickCapture.enrichment.title.tag": "Suggested tag" / "建议标签"
   "plugin.quickCapture.enrichment.title.relatedNote": "Related note" / "相关笔记"
   "plugin.quickCapture.enrichment.title.memoryCandidate": "Memory candidate" / "记忆候选"
   "plugin.quickCapture.enrichment.title.taskSuggestion": "Possible task" / "可能的任务"
   "plugin.quickCapture.enrichment.title.expansion": "AI expansion" / "AI 扩展"
   ```

---

### Commit 9: `fix(i18n): improve memory diagnostics copy and rename 'Markdown Files'`

**ID:** SET-08, CROSS-08 | **Risk:** Low | **Files:** plugin locale files

Rewrite jargon-heavy diagnostics labels:
- `"indexedValue"`: "X chunks across Y files" --> "X indexed sections across Y notes"
- `"backend"`: "Backend" --> "Search engine"
- `"storageBestEffort"`: "Best-effort storage" --> "Temporary storage"
- `"storagePersistent"`: "Persistent storage" --> "Permanent storage"
- `"opfsScope"`: "OPFS scope" --> "Storage scope"
- `"opfsVfs"`: "OPFS VFS" --> "Storage driver"
- `"activeOperation"`: "Active operation" --> "Current task"
- `"status.stale"`: "Index stale" --> "Needs refresh"
- `"status.missing"`: "Local index missing" --> "Not prepared on this device"
- `"maintenance.dirty"`: "{count} dirty" --> "{count} notes need re-indexing"
- `"plugin.statistics.metric.markdownFiles"`: "Markdown Files" --> "Notes" / "笔记"

---

### Commit 10: `fix(i18n): convert UTC timestamp to local time in Statistics`

**ID:** STAT-04 | **Risk:** Low | **File:** `src/components/Statistics.tsx`

Line 175: Replace UTC string formatting with locale-aware:
```ts
// BEFORE
return latest ? latest.replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : ...;
// AFTER
return latest ? new Date(latest).toLocaleString() : ...;
```

---

### Commit 11: `fix(modal): move batch-modal DOM build from constructor to onOpen()`

**ID:** MODAL-F5 | **Risk:** Medium | **File:** `src/batch-modal.ts`

Move the constructor body (lines 15-137) into `onOpen()`. Keep only
`super(app)` and `this.obsidianPlugins = getInternalPlugins(app)` in
constructor. This follows Obsidian's Modal lifecycle contract.

---

### Commit 12: `fix(modal): rename 'enbaled' typo to 'enabled'`

**ID:** MODAL-F6 | **Risk:** Low | **Files:** `src/modal.ts`, `src/batch-modal.ts`

Rename `enbaled` to `enabled` at 14 occurrences across 2 files:
- `src/modal.ts`: lines 17, 44, 48, 51, 55, 57, 62, 68, 85, 91
- `src/batch-modal.ts`: lines 36, 40, 43, 55, 57

---

### Commit 13: `fix(a11y): add sr-only h1 heading to TabView`

**ID:** TAB-P2-1 | **Risk:** Low | **File:** `src/pagelet/tab/TabView.ts`

Line 297: Change `"span"` to `"h1"` for proper document outline:
```ts
const label = el("h1", "pa-sr-only", pageletT("pagelet.tab.ariaLabel", this.locale));
```

Visual appearance unchanged (sr-only hides it).

---

### Commit 14: `fix(pagelet): unify empty-state patterns in TabView sections`

**ID:** TAB-P2-4 | **Risk:** Low-Medium | **Files:** `src/pagelet/tab/TabView.ts`, `MaintenanceReviewSection.ts`, `MemoryGovernanceSection.ts`, `QuietRecallSection.ts`

Extract a shared helper:
```ts
function renderEmptyCard(cls: string, titleKey: string, bodyKey: string | undefined, locale: string): HTMLElement {
    const card = el("div", `pa-pagelet-tab-empty-card ${cls}`);
    card.appendChild(el("div", "pa-pagelet-tab-empty-title", pageletT(titleKey, locale)));
    if (bodyKey) {
        card.appendChild(el("div", "pa-pagelet-tab-empty-body", pageletT(bodyKey, locale)));
    }
    return card;
}
```

Update all 5 inconsistent empty-state patterns:
- TabView:551 (Graph Discovery)
- TabView:606 (Patterns)
- TabView:674 (main empty state)
- QuietRecallSection:78
- MaintenanceReviewSection:84

---

### Commit 15: `fix(pagelet): add count unit to maintenance category cards`

**ID:** TAB-P2-6 | **Risk:** Low | **Files:** `MaintenanceReviewSection.ts`, pagelet locale files

Line 78: Replace `String(category.count)` with localized:
```ts
pageletT("pagelet.tab.maintenance.categoryCount", this.locale, { count: category.count })
```

New locale keys:
```json
"pagelet.tab.maintenance.categoryCount": "{count} notes" / "{count} 篇笔记"
```

---

### Phase 3 Summary Table

| Commit | Scope | IDs | Risk | Files |
| --- | --- | --- | --- | --- |
| 1 | css | PET-P2-2 | Low | custom.pcss |
| 2 | css | PET-P2-1 | Low | custom.pcss |
| 3 | css | PNL-P2-4 | Low-Med | custom.pcss, PanelLayouts.ts |
| 4 | css | STAT-01+02, STAT-05 | Low-Med | custom.pcss, Statistics.tsx |
| 5 | i18n | BUB-P2-1 | Low | zh.json (pagelet) |
| 6 | i18n+css | PNL-P2-1, PNL-P2-5 | Low | locale files, PanelView.ts, custom.pcss |
| 7 | i18n | CHAT-F4, CHAT-F9 | Low | formatters.ts, locale files |
| 8 | i18n | CHAT-F10, MODAL-F10 | Low | locale files, quick-capture-enrichment.ts |
| 9 | i18n | SET-08, CROSS-08 | Low | locale files |
| 10 | fix | STAT-04 | Low | Statistics.tsx |
| 11 | fix | MODAL-F5 | Medium | batch-modal.ts |
| 12 | fix | MODAL-F6 | Low | modal.ts, batch-modal.ts |
| 13 | a11y | TAB-P2-1 | Low | TabView.ts |
| 14 | fix | TAB-P2-4 | Low-Med | TabView.ts, 3 section files |
| 15 | i18n | TAB-P2-6 | Low | MaintenanceReviewSection.ts, locale files |

### Phase 3 Recommended Batch Execution

- **Batch A** (safe, isolated CSS): Commits 1-2
- **Batch B** (CSS + code color extraction): Commits 3-4
- **Batch C** (pure locale fixes): Commits 5, 7, 8, 9
- **Batch D** (code quality): Commits 10, 11, 12, 13
- **Batch E** (structural refactors): Commits 6, 14, 15

### Phase 3 Items Excluded (depend on Phase 2a decisions)

- TAB-P2-2 (maintenance chips) -- depends on D10
- TAB-P2-3 (graph discovery "Not added") -- depends on product decision
- TAB-P2-7 (recall "Next: {action}") -- depends on D8
- CHAT-F6 (thinking 5-color cycle) -- depends on D11

---

## Phase 4: Design Token Foundation

### 4.1 Border-Radius Tokens

**Current state:** 109 occurrences across 13 distinct values in `src/custom.pcss`.

**Token scale:**

```css
:root {
    --pa-radius-sm: 4px;     /* scrollbars, tags, code, toggles */
    --pa-radius-md: 6px;     /* buttons, inputs, badges, small cards */
    --pa-radius-lg: 8px;     /* cards, panels, containers, modals, notices */
    --pa-radius-xl: 12px;    /* composer row, large containers */
    --pa-radius-2xl: 14px;   /* floating menus, bubbles */
    --pa-radius-pill: 999px; /* pills, dots, source-link chips */
    --pa-radius-full: 50%;   /* circles: timeline-dot, progress-dot */
}
```

**Migration map:**

| Current value | Token | Count | Representative lines |
| --- | --- | --- | --- |
| `4px` | `--pa-radius-sm` | 12 | L124, L160, L170, L800, L805, L1257, L1426, L1703, L5294 |
| `6px` | `--pa-radius-md` | 33 | L47, L76, L82, L88, L910, L1410, L1530, L1894, L2596, etc. |
| `7px` | `--pa-radius-md` | 3 | L1728, L1791, L1821 (merge into 6px) |
| `8px` | `--pa-radius-lg` | 31 | L816, L1013, L1366, L1446, L1502, L1846, L1880, etc. |
| `9px` | `--pa-radius-lg` | 2 | L322, L1960 (merge into 8px) |
| `10px` | `--pa-radius-lg` | 3 | L2057 (merge into 8px) |
| `12px` | `--pa-radius-xl` | 4 | L1614, L1622, L3469 |
| `14px` | `--pa-radius-2xl` | 3 | L1931, L3062 |
| `999px`/`9999px` | `--pa-radius-pill` | 6 | L1185, L2407, L2435, L3201, L4625, L5200 |
| `50%` | `--pa-radius-full` | 7 | L3173, L3294, L3306, L4127, L4130, L4248 |

**Leave as-is:** Progress-bar `.meter` spans (L335-L378, legacy),
`border-radius: 0` resets, `16px 16px 12px 12px` compound values.

**Implementation order:**
1. Define tokens in `:root` at top of custom.pcss
2. Migrate `--pa-radius-lg` (8px, highest count)
3. Migrate `--pa-radius-md` (6px, merge 7px)
4. Migrate `--pa-radius-sm` (4px)
5. Migrate `--pa-radius-xl` and `--pa-radius-2xl`
6. Migrate `--pa-radius-pill` and `--pa-radius-full`

---

### 4.2 Shadow Tokens

**Token scale:**

```css
:root {
    --pa-shadow-subtle: 0 1px 2px rgba(0, 0, 0, 0.05);
    --pa-shadow-raised: 0 8px 22px rgba(0, 0, 0, 0.14);
    --pa-shadow-floating: 0 16px 42px rgba(0, 0, 0, 0.22), 0 2px 10px rgba(0, 0, 0, 0.12);
    --pa-shadow-panel: -4px 0 24px rgba(0, 0, 0, 0.4);
}
.theme-light {
    --pa-shadow-subtle: 0 1px 2px rgba(0, 0, 0, 0.04);
    --pa-shadow-raised: 0 8px 22px rgba(0, 0, 0, 0.08);
    --pa-shadow-floating: 0 16px 42px rgba(0, 0, 0, 0.12), 0 2px 10px rgba(0, 0, 0, 0.06);
    --pa-shadow-panel: -4px 0 24px rgba(0, 0, 0, 0.12);
}
```

**Migration map:**

| Current | Token | Lines |
| --- | --- | --- |
| `0 1px 2px rgba(0,0,0,0.05)` | `--pa-shadow-subtle` | L48 |
| `0 1px 2px 0 rgba(15,23,42,0.08)` | `--pa-shadow-subtle` | L37, L103 |
| `0 8px 22px rgba(0,0,0,0.14)` | `--pa-shadow-raised` | L1882 |
| `0 2px 8px rgba(0,0,0,0.18)` | `--pa-shadow-raised` | L1505 |
| `0 16px 42px ...` | `--pa-shadow-floating` | L3066 |
| `0 18px 38px ...` | `--pa-shadow-floating` | L1933 |
| `0 14px 28px ...` | `--pa-shadow-floating` | L1961 |
| `-4px 0 24px ...` | `--pa-shadow-panel` | L3543, L4320 |

**Leave as-is:** Inset shadows, focus rings, `box-shadow: none` resets,
progress-bar internal shadows, animation glow shadows.

---

### 4.3 Font-Size Tokens

**Token scale:**

```css
:root {
    --pa-font-xs: 0.6875rem;   /* 11px -- uppercase labels, meta, chips */
    --pa-font-sm: 0.75rem;     /* 12px -- detail text, button labels */
    --pa-font-md: 0.8125rem;   /* 13px -- body text, section titles */
    --pa-font-base: 0.875rem;  /* 14px -- default, settings text */
    --pa-font-lg: 0.9375rem;   /* 15px -- panel titles, summary titles */
    --pa-font-xl: 1.125rem;    /* 18px -- section headings */
}
```

**Strategy:**
- Pagelet/Panel `px` values (11-18px): migrate to tokens
- Chat `em` values (0.85em, 0.9em): leave as-is (relative to parent)
- Obsidian `var(--font-ui-*)` references: leave as-is
- SVG `9.5px`: leave as-is

**Migration map (px values only):**

| Current | Token | Count | Representative lines |
| --- | --- | --- | --- |
| `10px`, `11px` | `--pa-font-xs` | 19 | L3672, L3728, L3806, L3853, L3901, L3951, etc. |
| `12px` | `--pa-font-sm` | 26 | L2328, L2358, L2390, L3218, L3334, L3628, etc. |
| `13px` | `--pa-font-md` | 20 | L2279, L2515, L3159, L3446, L3721, L3799, etc. |
| `14px` | `--pa-font-base` | 7 | L496, L2538, L3491, L3595 |
| `15px` | `--pa-font-lg` | 4 | L2542, L3573, L4159, L5273 |
| `18px` | `--pa-font-xl` | 4 | L3122, L3273, L4340, L4957 |

**Implementation order:**
1. Define tokens in `:root`
2. Migrate pagelet panel section
3. Migrate pagelet tab section
4. Migrate notice/settings sections

---

### 4.4 Color Migration

**Actionable fixes (non-legacy hardcoded colors):**

| Line | Current | Replacement | Risk |
| --- | --- | --- | --- |
| L321 | `background: rgb(122, 122, 122)` | `var(--background-modifier-border)` | Low |
| L495 | `color: #868686` | `var(--text-muted)` | Low |
| L4878 | `fill: #777` | `var(--text-faint)` | Low |
| L4874 | `background: rgba(127,144,160,.16)` | `color-mix(in srgb, var(--text-faint) 16%, transparent)` | Low |

**Leave as-is:** Status-bar tokens (intentionally branded), data-viz
composition colors, progress-bar gradients, branded icon colors, SVG error
strokes, fallback colors in `var()` patterns.

---

### 4.5 Notice Variable Naming

**Problem:** `--pa-text-normal` and `--pa-background-primary` sound like they
shadow Obsidian's variables but are actually notice/progress-bar-specific.

**Rename:**

| Current | New | Used at |
| --- | --- | --- |
| `--pa-text-normal` | `--pa-notice-text` | L439 |
| `--pa-background-primary` | `--pa-notice-bg` | L427, L445 |
| `--pa-record-font-color` | `--pa-record-text` | TS inlines |
| `--pa-record-background-color` | `--pa-record-bg` | TS inlines |

**Steps:** Add new names alongside old (dual-declaration), update usage sites,
grep TS for inline refs, remove old names.

---

## Phase 5: Surface-Specific Structural Refactoring

### 5.1 Tab CSS Architecture

**28 CSS classes used in TypeScript with NO style definitions:**

**Section containers (8):** `pa-pagelet-tab-context-pager`,
`-graph-discovery`, `-maintenance-review`, `-memory-governance`,
`-pattern-detection`, `-quiet-recall`, `-review-queue`, `-saved-insights`
-- zero-style anchor classes for querySelector navigation. Document as
intentional; no visual styles needed.

**Card variants (12):** Used alongside base `pa-pagelet-tab-insight-card`.
Add styles only for:
```css
.pa-pagelet-tab-memory-card--tombstone {
    opacity: 0.55;
    pointer-events: none;
}
.pa-pagelet-tab-recall-card {
    border-left: 3px solid var(--text-accent, #7c9eff);
}
```
Remainder: document as semantic hooks for future styling, testing selectors,
and user-CSS customization.

**Group containers (8):** Used alongside base `pa-pagelet-tab-review-queue-group`
or `pa-pagelet-tab-empty-card`. Document as zero-style anchor classes.

---

### 5.2 Chat Namespace Migration (llm-* to pa-chat-*)

**7 classes to rename:**

| Current | New | CSS selectors affected |
| --- | --- | --- |
| `llm-view` | `pa-chat-view` | ~90 selectors |
| `llm-chat-container` | `pa-chat-container` | ~12 |
| `llm-input` | `pa-chat-input` | ~14 |
| `llm-message` | `pa-chat-message` | ~20 |
| `llm-message-enter` | `pa-chat-message-enter` | ~4 |
| `llm-buttons` | `pa-chat-buttons` | ~10 |
| `llm-modal` | `pa-chat-modal` | ~2 |

**Migration plan:**
1. Add both old and new classes in `chat-view.ts` (backward compat):
   ```ts
   containerEl.classList.add('pa-chat-view', 'llm-view'); // remove llm-view in v3
   ```
2. Rename all selectors in `custom.pcss` from `llm-*` to `pa-chat-*`.
3. In next major version, remove old class additions.

**chat-view.ts lines to update:** L230, L235, L237, L291, L1454, L1481,
L1483, L1670, L1758, L2991.

**Risk:** Medium. Users may have custom CSS targeting `.llm-view`,
`.llm-message`. Dual-class approach for one release mitigates this.

---

### 5.3 Quick Capture i18n Refactor

Remove the `QuickCaptureCopy` interface indirection. Replace with direct
`pluginT()` calls at each use site.

> **Note:** After D3 and D4 (Phase 2a), `QuickCaptureCopy` will have **10
> fields** (8 original + `draftSaved` from D3 + `savingToPrefix` from D4).
> All 10 must be converted to `pluginT()` calls. The original interface at
> lines 32-41 only has 8 fields — account for the D3/D4 additions.

**Changes:**
1. `src/quick-capture.ts`: Remove `QuickCaptureCopy` interface (10 fields
   after D3/D4). Add `import { getPluginUiLanguage, pluginT } from "./locales/plugin"`.
   Replace all `this.copy.xxx` with `pluginT("plugin.quickCapture.xxx", getPluginUiLanguage())`.
   Fields to convert: `modalTitle`, `modalPlaceholder`, `save`, `cancel`,
   `savedDaily`, `savedInbox`, `savedCurrentFile`, `saveFailed`,
   `draftSaved` (D3), `savingToPrefix` (D4).

2. `src/plugin.ts`: Remove `quickCaptureCopy()` method (lines 2442-2453).
   Simplify `QuickCaptureService` construction to `new QuickCaptureService(host)`.

**Prerequisite:** D3 and D4 must be implemented first (Phase 2a).

**Risk:** Low. `QuickCaptureCopy` is internal-only.

---

## Cross-Phase Dependencies

```
Phase 1 (i18n/spec fixes)
    |
    +--- Phase 2a (D8, D11, D14, D15, D12, D3, D4, D9, D10, D7, D1)
    |        |                                           |
    |        +--- Phase 3 items excluded from Phase 2a   |
    |             (TAB-P2-2 depends on D10,              |
    |              TAB-P2-7 depends on D8,               |
    |              CHAT-F6 depends on D11)               |
    |                                                    |
    +--- Phase 2b (D13 -> D5 -> D6, sequential within)
    |        |
    |        +--- D5 ReviewQueue removal blocks Phase 5.1
    |             (Tab CSS cleanup of review-queue-* classes)
    |
    +--- Phase 3 (P2 quick fixes, mostly independent)
    |        |
    |        +--- Commit 6 (panel recall CSS) should precede
    |             Phase 5.2 (chat namespace migration) to avoid
    |             renaming freshly-added review-queue CSS classes
    |
    +--- Phase 4 (design tokens, independent of all above)
    |        |
    |        +--- Phase 4.5 (notice vars) -> 4.4 (colors) ->
    |             4.1 (radius) -> 4.2 (shadows) -> 4.3 (fonts)
    |
    +--- Phase 5 (structural refactoring, depends on Phases 2b, 3, 4)
             |
             +--- 5.1 Tab CSS (after D5 ReviewQueue removal)
             +--- 5.3 Quick Capture i18n (after D3/D4 add copy fields,
                  since this phase removes the copy interface)
             +--- 5.2 Chat namespace (last -- highest risk, most files)
```

**Hard dependencies:**
- Phase 1 locale keys must land before Phase 2a code changes
- D5 (ReviewQueue removal) must complete before Phase 5.1 (Tab CSS cleanup)
- D3/D4 (Quick Capture copy fields) should be implemented before Phase 5.3
  removes the `QuickCaptureCopy` interface entirely
- Phase 4 tokens should be defined before Phase 5 CSS refactoring begins

**Soft dependencies:**
- Phase 2b D13 (Settings) is independent and can proceed in parallel with
  everything except Phase 3 Commit 11 (batch-modal)
- Phase 3 batches A-D can proceed in parallel with Phase 2a

---

## Commit Strategy

Per AGENTS.md:
- Use Conventional Commits format
- Keep commits small, cohesive, and module-scoped
- `git commit -s` (signed) for all commits

**Scoping convention:**

| Phase | Commit prefix examples |
| --- | --- |
| Phase 1 | `feat(i18n):`, `fix(i18n):` |
| Phase 2a | `fix(pagelet):`, `fix(css):`, `fix(settings):`, `feat(pagelet):` |
| Phase 2b | `feat(pagelet):`, `feat(settings):`, `feat(memory):` |
| Phase 3 | `fix(css):`, `fix(i18n):`, `fix(a11y):`, `fix(modal):`, `fix(pagelet):` |
| Phase 4 | `refactor(css):` |
| Phase 5 | `refactor(css):`, `refactor(chat):`, `refactor(quick-capture):` |

---

## Validation Gates

### Per-Commit

- `make deploy` (runs lint + build + bundle) after every commit

### Per-Phase

| Phase | Validation |
| --- | --- |
| Phase 1 | Locale parity tests (CI auto-checks EN/ZH key coverage) |
| Phase 2a | Smoke test each decision in test vault (desktop + mobile) |
| Phase 2b | Unit tests for routing (D5), auto-confirm (D6), group coverage (D13) |
| Phase 3 | Full smoke after all batches; screen reader pass for Commit 13; theme switching for Commits 3-4 |
| Phase 4 | Visual inspection in both light/dark themes after each token batch |
| Phase 5 | `grep -rn "llm-view\|llm-message"` after 5.2 to verify no orphans |

### ZH Locale Quality Gate

All new ZH locale keys must be self-reviewed for:
- Natural phrasing (not translated developer-speak)
- No obligation language ("待", "需要", "必须", "未处理")
- Consistent terminology with existing ZH keys ("记忆" not "Memory")
- Character length appropriate for UI element width

### Phase 4 Visual Regression Gate

Before and after each token migration batch:
1. Take screenshots of all 8 surfaces in both light/dark themes
2. Visual diff to confirm only intentional changes
3. Border-radius merges (7→6px, 9→8px, 10→8px) must be visually acceptable

### Rollback Criteria

A phase revert is triggered by any of:
- Build failure after merge
- Visual regression in >3 surfaces (confirmed by screenshot diff)
- User reports within 48h of dogfooding deployment
- Locale parity test failure

### Release Gate

- `make deploy` full pipeline passes
- Full test vault smoke (`obsidian-test-vault-smoke`)
- iOS real device smoke (`obsidian-ios-real-device-smoke`)
- Both EN and ZH locale spot-checks (ZH quality gate checklist above)
- Light and dark theme verification
- Mobile viewport checks for Phases 2b (D13), 3 (Commits 1-2), and 5
- Phase 4 visual regression gate passed

---

## Risk Register

| # | Risk | Severity | Phase | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | D6 auto-confirmed memory pollutes LLM context | High | 2b | `confirmationStrength: "auto"` allows retrieval-time filtering; can weight auto-confirmed lower in context assembly |
| R2 | Chat namespace migration breaks user custom CSS snippets | Medium | 5 | Dual-class backward compatibility for one release cycle; remove old classes in next major version |
| R3 | D5 ReviewQueue items appear in wrong section after routing | Medium | 2b | Unit-test routing function for all 14 item types; duplication guard for memory_candidate/memory_conflict already in MemoryGovernanceSection |
| R4 | D7 Tab show-more miscounts sections (includes utility/nav elements) | Medium | 2a | Scope querySelector to `.pa-pagelet-tab-section` class only; integration test with varying section counts |
| R5 | D13 Settings sub-containers break inside `<details>` | Medium | 2b | Sub-containers are created by render methods via `createDiv()` on their parent; not dependent on `containerEl` directly. Test all settings interactions inside collapsed/expanded groups |
| R6 | Phase 4 border-radius token merges cause visual regression (7→6px, 9→8px, 10→8px) | Medium | 4 | Before/after screenshot comparison of all 8 surfaces in both themes. Visual diff confirms only intentional changes |
| R7 | Phase 5.2 Chat llm→pa-chat rename breaks user custom CSS snippets | Medium-High | 5 | Dual-class backward compat for one release cycle. Add user-facing changelog entry. Remove old classes in next major version |
| R8 | custom.pcss merge conflicts from parallel phases | High | All | Serialize CSS-heavy phases: Phase 2a CSS → Phase 3 CSS → Phase 4 tokens → Phase 5 namespace. Do not parallelize CSS work |

---

## Appendix: Finding Traceability Matrix

Every confirmed audit finding mapped to its disposition. Findings not listed
below are P3 backlog items deferred indefinitely.

### P0 Findings (1)

| Finding ID | Disposition | Phase/Item |
| --- | --- | --- |
| TAB-P0-2 | Fix | Phase 1 §1.1 |

### P1 Findings (8)

| Finding ID | Disposition | Phase/Item |
| --- | --- | --- |
| CHAT-F1 | Fix | Phase 1 §1.2 |
| CHAT-F2 | Fix | Phase 1 §1.3 |
| CHAT-F3 | Fix | Phase 1 §1.4 |
| MODAL-F1 | Fix (via D3) | Phase 2a D3 |
| MODAL-F2 | Fix (via D4) | Phase 2a D4 |
| TAB-P1-1 | Fix (via D5) | Phase 2b SDD-D5 |
| TAB-P1-2 | Fix (via D6) | Phase 2b SDD-D6 |
| TAB-P1-3 | Fix (via D7) | Phase 2a D7 |
| SET-01 | Fix (via D13) | Phase 2b SDD-D13 |

### P2 Findings (44) — Disposition Summary

| Finding ID | Disposition | Phase/Item |
| --- | --- | --- |
| PET-P2-1 | Fix | Phase 3 Commit 2 |
| PET-P2-2 | Fix | Phase 3 Commit 1 |
| PET-P2-3 | Fix (via D1) | Phase 2a D1 |
| BUB-P2-1 | Fix | Phase 3 Commit 5 |
| BUB-P2-2 | Won't-fix | D2 decided: Bubble stays delivery-only |
| BUB-P2-3 | Downgraded to P3 | Verification: compact variant mitigates |
| PNL-P2-1 | Fix | Phase 3 Commit 6 |
| PNL-P2-2 | Fix (via D9) | Phase 2a D9 |
| PNL-P2-3 | Fix (via D9) | Phase 2a D9 |
| PNL-P2-4 | Fix | Phase 3 Commit 3 |
| PNL-P2-5 | Fix | Phase 3 Commit 6 |
| TAB-P0-1 | Downgraded to P2 | Phase 5 §5.1 (28 CSS classes) |
| TAB-P1-4 | Accepted as-is | Individual confirm is low-stakes (no notes modified); batch confirm has a modal. No work needed |
| TAB-P2-1 | Fix | Phase 3 Commit 13 |
| TAB-P2-2 | Fix (via D10) | Phase 2a D10 |
| TAB-P2-3 | Fix (via D10) | Phase 2a D10 |
| TAB-P2-4 | Fix | Phase 3 Commit 14 |
| TAB-P2-5 | Downgraded to P3 | Behind `<details>`, low impact |
| TAB-P2-6 | Fix | Phase 3 Commit 15 |
| TAB-P2-7 | Fix (via D8) | Phase 2a D8 |
| CHAT-F4 | Fix | Phase 3 Commit 7 |
| CHAT-F6 | Fix (via D11) | Phase 2a D11 |
| CHAT-F7 | Fix | Phase 5 §5.2 (Chat namespace migration) |
| CHAT-F8 | Fix | Phase 4 §4.1 + Phase 5 §5.2 |
| CHAT-F9 | Fix | Phase 3 Commit 7 |
| CHAT-F10 | Fix | Phase 3 Commit 8 |
| MODAL-F3 | Fix | Phase 5 §5.3 (Quick Capture i18n) |
| MODAL-F5 | Fix | Phase 3 Commit 11 |
| MODAL-F6 | Fix | Phase 3 Commit 12 |
| MODAL-F10 | Fix | Phase 3 Commit 8 |
| STAT-01 | Fix | Phase 3 Commit 4 |
| STAT-02 | Fix | Phase 3 Commit 4 |
| STAT-04 | Fix | Phase 3 Commit 10 |
| STAT-05 | Fix | Phase 3 Commit 4 |
| STAT-06 | Fix (via D12) | Phase 2a D12 |
| SET-02 | Fix (via D15) | Phase 2a D15 |
| SET-03 | Fix (via D14) | Phase 2a D14 |
| SET-08 | Fix | Phase 3 Commit 9 |
| CROSS-01 | Fix | Phase 4 §4.1 (border-radius tokens) |
| CROSS-02 | Fix | Phase 4 §4.2 (shadow tokens) |
| CROSS-03 | Fix | Phase 4 §4.3 (font-size tokens) |
| CROSS-04 | Fix | Phase 3 Commit 4 |
| CROSS-05 | Fix | Phase 4 §4.4 (color migration) |
| CROSS-06 | Fix | Phase 4 §4.5 (notice variable naming) |
| CROSS-07 | Addressed | Multiple phases standardize 44px mobile targets |
| CROSS-08 | Fix | Phase 3 Commit 9 |

### P3 Findings (deferred to backlog)

PET-P3-1, BUB-P3-1, PNL-P3-1, PNL-P3-2, TAB-P3-1, TAB-P3-2, TAB-P3-3,
CHAT-F5, CHAT-F11, CHAT-F12, CHAT-F13, CHAT-F14, MODAL-F4, MODAL-F7,
MODAL-F8, MODAL-F9, MODAL-F11, STAT-03, STAT-07, STAT-08, SET-04, SET-05,
SET-06, SET-07, CROSS-09

These are refinement-level items that will be addressed opportunistically
when touching the relevant surface. No scheduled fix.

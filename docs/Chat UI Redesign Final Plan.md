# Chat UI Redesign Final Plan

## Summary
Redesign the Obsidian Chat panel as a compact **Codex hybrid** workflow UI while preserving Obsidian theme compatibility and Memory safety. UI text stays English. Implementation starts with a reviewed spec document before any UI code changes.

Scope: Chat panel, activity rows, composer, message actions, Memory references presentation, Memory chip, Memory approval modal/notice polish.
Out of scope: settings redesign, statistics, preview, record views, Memory retrieval semantics, prompt/callout protocol changes.

## Hard Decisions
- No queued prompt in v1. During generation, textarea remains editable as `Draft next message`, but cannot send until current generation finishes or is stopped.
- Clear/Delete confirmations use an Obsidian-style modal.
- `docs/chat-ui-redesign-spec.md` is a hard gate. It must pass review before runtime UI code starts.
- Memory references keep the existing Markdown protocol and are transformed only after render inside `.llm-view`.
- Every code phase must run tests, subagent review, `make deploy`, dark/light quick smoke, and tracker update.

## Required Spec Tables
`docs/chat-ui-redesign-spec.md` must include:

- Token table using Obsidian variables for surface, muted surface, hover, active, border, text, muted text, accent, danger, running/error status, and source-chip background. No large hard-coded blue-gray surfaces.
- Density table:
  - narrow `<360px`: 10px padding, 10px gap, 92% user max width, 28px icon buttons, textarea 2-4 rows.
  - normal `360-520px`: 12px padding, 12px gap, 86% user max width, 30px icon buttons, textarea 2-5 rows.
  - wide `>520px`: 16px padding, 16px gap, 78% user max width, 32px icon buttons, textarea 2-6 rows.
- Lifecycle table:
  - pending/error/cancelled turns are UI-only;
  - success commits user+assistant as one `modelHistory` pair;
  - retry reruns the normal send pipeline;
  - delete successful turn removes UI and matching history pair;
  - clear aborts active work and clears UI, draft, and history.
- Memory state table:
  - user-facing states: `Memory ready`, `Memory needs setup`, `Memory needs update`, `Memory unavailable`, `Searching notes`, `Related notes found`, `Memory used`, `No related memory`, `Memory skipped`, `Updating in background`, `Memory failed`;
  - `Memory ready` means available, not necessarily used this turn;
  - `Memory used` only when final answer has Memory references;
  - `fallback` and backend/chunk details only appear in diagnostics.
- Error/Retry journey:
  - inline error says the answer did not finish;
  - actions are `Retry` and `Copy error`;
  - technical detail appears only in copied/details text.
- Empty state:
  - minimal note-centric intro;
  - chips: `Summarize current note`, `Find related notes`, `Draft from current note`;
  - chip click fills composer only, never auto-sends;
  - no active note disables note-aware chips with a short hint.
- A11y/motion:
  - summary row uses `aria-live="polite"`;
  - details are not live-announced step by step;
  - Enter/Space toggles details;
  - fast status updates are coalesced;
  - spinner/pulse duration is at least 1.2s and low contrast;
  - `prefers-reduced-motion` uses static dot/text, not pulse.
- Visual constraints:
  - composer, source bar, and framed surfaces use radius max 8px;
  - use Obsidian `setIcon` / built-in icons;
  - do not hand-draw SVG icons or add a new icon library.

## Implementation Phases
### Phase A: Spec Gate
Create `docs/chat-ui-redesign-spec.md` with all required tables and smoke matrix. Review with subagents before any UI code.

### Phase B: Chat State And Renderer
- Split UI turns from `modelHistory`.
- Extract shared renderer for streaming and final assistant messages.
- Add UI-only activity/error/cancelled rows.
- Preserve `ChatService.streamLLM(...)` external API.

### Phase C: Main Chat UI
- Assistant: near-full-width document flow.
- User: compact right-aligned pill.
- Role labels: responsive text + icon; narrow mode uses icon plus visually hidden label.
- Activity row: compact, expandable, accessible, reduced-motion safe.
- Composer:
  - Memory chip left;
  - More menu;
  - textarea;
  - icon-only send/stop with tooltip and `aria-label`;
  - generation state shows muted composer helper text `Draft next message`;
  - Enter during generation shows an inline muted hint, not Notice;
  - Shift+Enter always inserts newline;
  - when generation completes or Stop is clicked, draft remains, Send re-enables, Stop hides, and draft is not auto-sent;
  - Clear chat is the only action that clears draft.

### Phase D: Memory Adjacent Polish
- Memory chip menu:
  - current product state;
  - Prepare/Update when applicable;
  - Settings;
  - diagnostics only behind technical entry.
- Memory references:
  - post-render transform only inside `.llm-view`;
  - default collapsed source bar;
  - toggle uses `aria-expanded` / `aria-controls`;
  - links reuse existing internal-link handling;
  - transform failure falls back to normal callout.
- Memory approval modal and notices:
  - redraw visually with shared tokens;
  - preserve Data / AI provider / Memory search / Cost copy;
  - preserve chat buttons: `Prepare memory`, `Answer now`, `Cancel`;
  - preserve command behavior: no `Answer now`;
  - closing modal still resolves `cancel`;
  - notice polish must not change progress lifecycle.

## Menu IA
Composer More menu:
- Session: `Copy conversation`, `Clear chat...`
- Diagnostics / Settings: `Show technical Memory status`, `Open settings`
- `Clear chat...` is last in its group, danger-styled, and confirmation-gated.

Per-message More menu:
- Assistant: Copy, Add to Editor, Delete...
- User: Copy, Delete...
- Delete uses confirmation modal.

Add to Editor inserts that specific assistant answer as original Markdown, including Memory references.

## Verification
For each code phase:
- focused Jest tests;
- `npx tsc -noEmit -skipLibCheck`;
- `npm run lint`;
- `npm run build`;
- `git diff --check`;
- subagent review of live diff;
- `make deploy`;
- Obsidian test vault dark/light quick smoke;
- tracker verification update.

Required focused tests:
- `npm test -- __tests__/chat-view.test.ts --runInBand`
- `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts`
- Phase D also: `npm test -- __tests__/memory-manager.test.ts --runInBand`

Smoke scenarios:
- empty state with/without active note;
- long answer;
- generation + draft next message;
- stop;
- inline error + retry;
- Memory ready but unused;
- Memory used with collapsed/expanded references;
- no related Memory;
- Memory skipped;
- Clear/Delete confirmation;
- Add to Editor;
- narrow, normal, wide widths.

## Assumptions
- No React rewrite.
- No Memory retrieval or approval semantic changes.
- No prompt/callout protocol changes.
- No queued prompt in v1.
- Existing unrelated files must not be staged or modified.

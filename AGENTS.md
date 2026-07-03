# AGENTS.md

## Scope

These instructions apply to the entire `personal-assistant` repository unless a nested `AGENTS.md` overrides them.

Use this file as the project README for coding agents. Keep changes aligned with the commands, architecture, and release process in this repository rather than with machine-local assumptions.

## Product North Star

Before product design, UX, planning, SDD, Pagelet, Memory, Capture, Review,
Maintenance, or PA Agent behavior work, read
`docs/pa-product-north-star.md` and use it as the top-level product standard.

North Star:

> 随手记下，需要时自然浮现。

Short form:

> Capture lightly. Let the right notes return when they matter.

Design philosophy:

> 安静且可信。

Treat "quiet and trustworthy" as a design constraint, not the product
positioning. Design and implementation should preserve these product instincts:

- Less management, more capture.
- Less generation, more return.
- Less interruption, more right-time presence.
- Less black-box insight, more source-backed evidence.
- Less full automation, more earned trust.
- Less tool jargon, more long-term companionship.

When a feature creates tension between technical capability and product feel,
prefer the North Star unless the user explicitly chooses a different direction.

## Dev Environment Tips

- This is an Obsidian plugin written in TypeScript.
- Use Node 22 LTS with npm 10.x or 11.x.
- Entry path: `src/main.ts` -> `src/plugin.ts`.
- Chat UI: `src/chat-view.ts`.
- Memory orchestration: `src/memory-manager.ts`.
- VSS facade and indexing flow: `src/vss.ts`.
- Vector index implementations: `src/vss/*`.
- AI service code: `src/ai-services/*`.
- React components and views: `src/components/*`, `src/preview.ts`, `src/stats-view.ts`.
- Tests live in `__tests__/*`.
- Project docs live in `docs/*`.
- Release automation lives in `scripts/release.mjs`, `scripts/changelog.mjs`, and `scripts/publish-release.mjs`.
- The local test vault is `test/`.
- Prefer `rg` and `rg --files` for searching.
- Use `apply_patch` for manual edits.
- Do not rely on absolute paths from one machine. Resolve paths from the repo root.

### v2.4/v2.5 New Module Mapping

```
src/ai-services/context/                    (v2.4 new) Context Management layer
  PaAgentContextManager.ts                  组合调用 4 个 delegate
  PaAgentContextProjector.ts                投影：origins 标注 + diffing + 注入
  PaAgentContextHygiene.ts                  清洁：过滤 status-only + 修复 orphan
  PaAgentContextCompactor.ts                (v2.5) 压缩：micro + full compaction
  PaAgentContextBudget.ts                   (v2.5) 预算：chars/tokens 追踪
```

```
src/ai-services/memory-extraction/          (v2.5 new) Memory extraction pipeline
  type-a-extractor.ts                       用户画像自动提取
  type-c-analyzer.ts                        Vault 元认知分析
  extraction-scheduler.ts                   独立调度 A/C 的触发逻辑
```

### Context Limit Constants

v2.4 起 context 限制放宽至 128K 基线。以下为 `src/ai-services/pa-agent-runtime.ts` 中的关键常量及当前值：

| Constant | Current Value | Description |
| --- | --- | --- |
| `MAX_CHAT_HISTORY_TURNS` | 20 | 聊天历史保留最大轮次 |
| `MAX_READ_ONLY_TOOL_CONTEXT_CHARS` | 12000 | 只读工具上下文字符上限 |
| `MAX_MEMORY_DOCUMENTS` | 4 | 单次检索返回的最大 Memory 文档数 |
| `MAX_MEMORY_CHARS` | 2000 | 单文档内容截断上限 |
| `MAX_MEMORY_RERANK_CANDIDATES` | 6 | Rerank 候选数 |
| `MAX_MEMORY_CANDIDATE_CHUNKS` | 2 | 每候选文档最大 chunk 数 |
| `MAX_MEMORY_CANDIDATE_EXCERPT_CHARS` | 500 | 候选摘要截断上限 |
| `MAX_TURN_WALL_CLOCK_MS` | 180000 | 单 turn 最大挂钟时间 |

v2.4 Context Projector + Hygiene 上线后，上述常量中与检索管线相关的值（`MAX_MEMORY_DOCUMENTS`、`MAX_MEMORY_CHARS`、`MAX_READ_ONLY_TOOL_CONTEXT_CHARS`）将随 128K 基线同步上调。具体新值由 `PaAgentContextBudget`（v2.5）统一管控。

## Build And Local Run Commands

- Install dependencies: `npm install`.
- Dev bundle: `npm run dev`.
- Tailwind watch: `npm run dev:tailwind`.
- Tailwind build: `npm run tailwind:build`.
- Full build: `npm run build`.
- Lint: `npm run lint`.
- Test: `npm test`.
- Focused serialized test run: `npm test -- --runInBand`.
- Type-check: `npx tsc -noEmit -skipLibCheck` or `npm run build`.
- There is no `npm run tsc` script.
- Whitespace check: `git diff --check`.

## Local Deployment

- Use `make deploy` to build and copy the latest plugin assets into the `test/` vault.
- `make deploy` runs clean/build checks through `bin`, then copies:
  - `dist/main.js`
  - `dist/manifest.json`
  - `dist/manifest-beta.json`
  - `dist/styles.css`
- The destination is `test/.obsidian/plugins/personal-assistant/`.
- When validating behavior in the already-open Obsidian test vault, run `make deploy`, then reload or re-enable the plugin in Obsidian as needed.
- To speed up Obsidian smoke setup, first check `command -v obsidian`. When available, use the Obsidian CLI with `obsidian://open` deep links to jump the test vault to the target note or asset before using Computer Use for visual/chat verification. Example: `obsidian "obsidian://open?vault=test&file=0.unsorted%2FDog.md"`. URL-encode vault file paths when needed.
- Standard plugin packaging should work with `main.js`, `manifest.json`, and `styles.css`. If a change adds worker/WASM runtime assets, audit build, deploy, release, install, and docs together.

## Testing Instructions

- For narrow changes, run the closest relevant Jest tests first.
- For Memory/VSS/chat changes, run the focused tests that cover `memory-manager`, `vss`, and affected chat paths when present.
- For broad behavior, release, packaging, or shared infrastructure changes, run:
  - `npm test -- --runInBand`
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- For dependency or lockfile changes, also run `npm ci --dry-run` when practical.
- For Obsidian UI smoke tests, prefer the fast path: `make deploy`, reload/re-enable the plugin, use the Obsidian CLI/deep link to open the exact test vault target, then use Computer Use only for the interaction that must be observed in the app.
- If a command cannot be run, state that clearly and explain the residual risk.
- Do not claim behavior was validated in Obsidian unless it was actually deployed/tested in the app.

### Local Validation Gate

The standard local validation gate for code/DOM changes. Skills reference this by name rather than inlining the commands.

```bash
npm test -- --runInBand <focused suites>
npx tsc -noEmit -skipLibCheck
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

For the `rg` community-scan command, exit code 1 with no output means no matches were found and should be treated as a pass.

Use `make deploy` when app-runtime confidence is needed — it runs full Jest, lint, build, and deploys assets to `test/`.

## Architecture Rules

- Prefer existing module boundaries and helper APIs over new parallel abstractions.
- Keep user-facing Memory behavior in `MemoryManager`.
- Keep low-level vector/index operations behind `VSS` and `VectorIndex`.
- `VSS` is the internal facade for `searchSimilarity`, refresh, rebuild, reset, reconcile, and local index maintenance.
- All VSS writes that mutate the local index must go through the VSS operation queue / exclusive lock. This includes flush, rebuild, reset, delete, rename, and reconcile upsert/delete.
- SQLite/WASM OPFS is the durable backend for automatic Memory maintenance.
- OPFS data is device-local cache data, not user source data and not synced state.
- The Markdown vault is the source of truth.
- Fallback `MemoryVectorIndex` is read-only for automatic maintenance. Do not add automatic background writes to fallback memory.
- Cross-device note changes are handled through vault events, startup/resume reconcile, and low-frequency rolling hash verification.
- Chat should not block on background changed-note refresh when auto policy and durable ready state are available. It may use the previous Memory snapshot while background maintenance catches up.
- First-use, missing local index, profile/settings stale, and potentially costly rebuild paths require explicit user confirmation.

## Memory/VSS Product Rules

- Normal users should see product language such as `Memory`, `Memory from your notes`, `Prepare memory`, and `Update memory`.
- Internal terms such as VSS, RAG, embedding, SQLite, OPFS, chunks, backend, stale, fallback, and vector are acceptable in code, logs, diagnostics, and docs, but should not appear in ordinary chat or settings copy.
- Confirmation prompts must explain:
  - Data: notes are not modified or deleted.
  - AI provider: note text may be sent to the configured AI provider when preparing Memory.
  - Cost: AI credits/API calls may be used; unchanged notes are skipped when possible.
- After the user approves and prepare/update succeeds, `memoryApprovalPolicy` may upgrade to `auto-refresh-after-prepare`.
- `changed-notes + auto-refresh-after-prepare + durable ready` should schedule background reconcile/flush and continue chat without a blocking modal.
- In fallback or non-durable states, do not claim background updates are running if maintenance cannot actually run.
- Manual `Update memory now` remains a force/manual refresh path and should preserve progress and error feedback.
- Background failures should keep dirty state and retry with backoff without repeatedly showing intrusive notices.

## UI And React Rules

- For `ItemView` or command UI, create a container and call `createRoot(container).render(...)`.
- Always call `root.unmount()` in `onClose`, teardown, or toggle paths.
- Pass `app` and `plugin` through props or context; avoid new globals.
- Keep CSS scoped and avoid leaking styles into Obsidian core UI.
- Prefer existing `pa-` classes and local style conventions.
- Build Tailwind before packaging.
- Lazy-load heavy UI libraries such as Chart.js.
- Clear observers, timers, listeners, and debouncers on unmount/unload.
- Preserve user settings such as `statisticsType`, `previewLimits`, and `targetPath` when re-rendering views.

## Obsidian Community Review Rules

- Treat Obsidian community review `Error` findings as release blockers. Fix them before publishing or preparing a publish-ready release.
- Do not create, update, or attach runtime `<style>` elements. Put plugin CSS in the Tailwind source `src/custom.pcss`, run `npm run tailwind:build` or `npm run build`, and let Obsidian load the generated `styles.css`.
- Do not assign to `innerHTML` or `outerHTML` in plugin code. Build DOM with `createElement`, `createElementNS`, `textContent`, attributes, `appendChild`, and explicit child-clearing helpers instead.
- When rendering SVG, prefer DOM construction with `document.createElementNS` and node replacement over parsing SVG markup through `innerHTML` or `<template>`.
- It is acceptable to keep CSS custom properties that contain SVG strings for Obsidian callout icons in `styles.css` or `src/custom.pcss`; the community source-code blocker is runtime DOM HTML/style injection.
- For Pagelet or other UI changes that touch DOM/CSS, run the `rg` community-scan command from the **Local Validation Gate** above and manually inspect any matches.
- Community review warnings such as `window.setTimeout` versus `setTimeout`, `activeDocument` versus `document`, direct style assignment, and `Vault#configDir` should be addressed opportunistically, but release-blocking `Error` findings take priority.

## Documentation Instructions

- For architecture or plan work, prefer durable docs in `docs/` over chat-only analysis when the user asks for a plan or design.
- Use Mermaid diagrams inside Markdown for architecture and flow visualizations unless the user explicitly asks for image assets.
- Keep architecture docs separate from implementation trackers when both are needed.
- Make docs match actual commands and behavior; do not document aspirational flows as current behavior.
- For release process changes, update `docs/release-process.md`.
- For VSS/Memory behavior changes, update relevant VSS docs such as:
  - `docs/vss-sqlite-wasm-architecture.md`
  - `docs/vss-embedding-refresh.md`

## Refactor Workflow

- For repo-scale refactors, follow `docs/refactor-workflow.md`.
- Start with a plan doc and a separate development tracker.
- Each phase must loop through `dev -> test -> review -> fix -> Obsidian smoke test -> fix` until P2/P1/P0 issues are closed or explicitly deferred.
- Use Codex subagents for phase review when available.
- Runtime/UI changes require `make deploy` and real Obsidian test-vault smoke before the phase is marked done.
- Keep tracker status, risk table, verification log, open decisions, and `docs/todo.md` aligned with the actual final behavior.
- Split commits by intent: runtime/tests, docs/tracker, TODO/future milestones, and release automation.

## Release Instructions

- See `docs/release-process.md` for the full release workflow.
- Preview without writing files: `make release-dry-run VERSION=x.y.z`.
- Create local release commit and annotated tag: `make release VERSION=x.y.z`.
- Publish only after explicit user request or confirmation: `make publish VERSION=x.y.z`.
- `make changelog VERSION=x.y.z` writes `CHANGELOG.md`; do not use it for inspect-only tasks.
- Read-only changelog preview can use `node scripts/changelog.mjs --target-version x.y.z`.
- `make release` requires a clean worktree, validates version/tag availability, generates changelog, runs tests/lint/build, updates release metadata, creates the release commit, and creates the annotated tag.
- Do not delete, rewrite, or move release tags unless explicitly requested.
- Do not publish, push tags, or create GitHub Releases unless the user clearly asked to publish or confirmed the action in the current turn.

## PR And Commit Instructions

- Keep commits small, cohesive, and module-scoped.
- Use Conventional Commits.
- Before committing, inspect:
  - `git status --short`
  - `git diff --stat`
  - targeted `git diff -- <path>`
- Stage only intended files. Do not include unrelated user edits.
- Never revert user changes unless explicitly requested.
- Avoid destructive git operations such as `git reset --hard` or `git checkout --` unless the user explicitly asks.
- If `.git/index.lock` or other git writes are blocked by the environment, request approval for the git operation instead of working around it.

## Review Instructions

- For review requests, lead with findings ordered by severity and include concrete file/line references.
- Do not invent nits if the diff is sound. Say there are no actionable findings and mention remaining verification gaps.
- Separate must-fix correctness issues from optional polish.
- For reported error strings, trace that exact command path before widening scope.

## SDD-Driven Development

This project follows SPEC-Driven Development (SDD). Each substantial feature
goes through product spec -> implementation SDD -> development tracker ->
focused tests/review/smoke before runtime code is written.

Current entry points:

- Product and release priority: `docs/development-roadmap.md` and `docs/todo.md`.
- Active/current product specs: root `docs/*-product-spec.md` files linked from
  `docs/index.md`.
- Pagelet feature delivery: `docs/pagelet-sdd-guide.md`.
- Write/action boundary: `docs/write-action-framework-sdd.md`,
  `docs/operations-agent-plan.md`, and `docs/operations-agent-mode-sdd.md`.
- Reusable repo-scale refactor workflow: `docs/refactor-workflow.md`.

Historical trackers and research are retained under `docs/archive/`, including
`docs/archive/v2-post-release-spec-driven-development.md`,
`docs/archive/agent-context-management-research.md`, and
`docs/archive/agent-memory-extraction-research.md`. Treat archived documents as
evidence/provenance, not as current approval gates unless a current root doc
explicitly points to them.

## Final Checklist For Agents

- Read nearby code before editing.
- Keep changes scoped to the request.
- Run focused tests first, then broader checks when the change touches shared behavior.
- Update docs when behavior, commands, release process, packaging, or Memory/VSS architecture changes.
- For UI work, verify lifecycle cleanup and CSS scope.
- For VSS work, verify durable/fallback behavior, locking, dirty state, reconcile, and chat non-blocking paths.
- For release work, verify dry-run/changelog behavior and never publish without explicit confirmation.

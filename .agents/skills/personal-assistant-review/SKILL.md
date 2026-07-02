---
name: personal-assistant-review
description: Review uncommitted or PR diffs in the personal-assistant Obsidian plugin with project-specific risk lanes, second-layer future-risk checks, severity discipline, subagent review routing, and validation boundaries. Use when the user asks for code review, agent team review, multi-angle review, review-first analysis, code-level release-readiness review, hidden side effects, compatibility risk, edge cases, security/performance risk, test gaps, maintenance cost, or comparison of review quality in this repository. For product/milestone-level release readiness via Linear, use `pa-linear-product-manager` instead.
---

# Personal Assistant Review

## Core Rule

Use this skill for review-only or review-first work in the
`personal-assistant` repository.

Default to high-signal review. Find correctness, product-contract, state,
privacy, concurrency, docs/tests consistency, and release-blocking risks before
polish. Treat green checks and working happy paths as supporting evidence, not
closure. Do not invent findings to satisfy a role or lane.

## Start

1. Treat the task as review-only unless the user explicitly asks to fix.
2. Bound the current surface:
   - `git status --short --branch`
   - `git diff --stat`
   - `git diff --name-only`
3. Read targeted diffs and nearby code before judging.
4. Lead the final answer with findings ordered by severity.
5. State validation run and validation not run.

## Mode Selection

Use **gate mode** by default. This matches prompts such as:

```text
启动agent team对代码修改进行review
review current diff
release-readiness review
```

Gate mode optimizes for accurate P0/P1/P2 findings and direct fixability.

Use **exploration mode** when the user explicitly asks for many perspectives,
for example:

```text
从程序员、架构师、产品经理、UI/UX、性能、desktop&mobile多端支持等角度评审
多角度体检
全面扫描产品、架构、UI 和性能
```

Exploration mode may include P3 design debt and polish, but still must not
force a finding per role.

Use **hybrid mode** for broad diffs when unsure: run gate mode first, then add
optional exploration findings under a separate `Optional Polish` section.

## Subagent Lanes

If multi-agent tools are available and the user asks for agent team,
subagents, or broad review, split review into independent lanes. If subagents
are unavailable, perform the same lanes locally.

### Gate Mode Lanes

1. **Functional state and concurrency**
   - Inspect Pagelet orchestration, foreground run guards, stale result
     handling, save state, panel/tab routing, command aliases, hidden side
     effects on old state, and tests.
   - Focus files: `src/pagelet/orchestrator.ts`,
     `src/pagelet/AnalysisSessionManager.ts`, `src/pagelet/ReviewNoteSaveFlow.ts`,
     `src/pagelet/BubbleCoordinator.ts`, `src/pagelet/commands.ts`,
     `src/pagelet/panel/PanelView.ts`, `src/pagelet/tab/*`,
     touched Pagelet tests.

2. **Spec, docs, tests, i18n, product contract**
   - Compare runtime behavior against changed docs and SDD/plans.
   - Inspect docs that changed plus relevant contract docs, especially
     Pagelet async-result, write-action, release, Memory/VSS, and tracker docs.
   - Check whether tests encode a behavior that contradicts a product/privacy
     non-goal.
   - Check whether tests cover failure, compatibility, stale-state, and
     concurrency edges, not only the easiest success path.

3. **Obsidian/community compatibility and lifecycle**
   - Scan for runtime DOM injection blockers:
     `createElement('style')`, `innerHTML =`, `outerHTML =`.
   - Inspect timers, listeners, observers, root unmount, CSS scope, public
     exports, old settings, command ids, storage scopes, generated assets,
     packaging/deploy impact, and compatibility-sensitive APIs.

4. **UI/UX/accessibility/mobile**
   - Inspect focus management, keyboard behavior, ARIA, mobile overflow,
     touch gestures, text clipping, theme variables, and ordinary-user copy
     (follow **Memory/VSS Product Rules** from AGENTS.md for user-facing terms).
   - Keep UI findings concrete: include the visible symptom or user flow.

5. **Performance, safety, and maintainability**
   - Inspect repeated scans, render loops, large-vault behavior, sync waits,
     background work, unnecessary provider calls, and teardown/unload behavior.
   - Inspect note text exposure, provider output persistence, file writes,
     external links, and command-triggered AI work for security/privacy risk.
   - Inspect misleading names, helper boundaries, and abstractions that could
     cause future callers to use an API incorrectly.

### Exploration Mode Lanes

Use the gate lanes, then add perspectives only where relevant:

- programmer/correctness
- architect/module boundaries
- product manager/workflow and value
- UI/UX/accessibility
- performance/rendering
- desktop/mobile support
- security/privacy
- naming/maintenance cost

Do not let these labels create coverage pressure. If a lane has no actionable
issue, say so.

## Second-Layer Risk Lens

After the normal gate pass, assume the changed code compiles and the happy path
works. Before closing the review, ask what could still become a future bug:

- hidden side effects on old state, existing commands, settings, persisted data,
  generated assets, or unrelated views
- compatibility breaks across Obsidian versions, mobile/desktop, old plugin
  settings, storage scopes, command ids, public exports, and release packaging
- edge cases not covered by tests: failure paths, retries, empty data, stale
  async results, concurrent runs, teardown/unload, degraded providers, and large
  vaults
- performance risks from repeated scans, render loops, sync waits, background
  work, unnecessary provider calls, or memory growth
- security/privacy risks around note text, provider output, persisted state,
  file writes, external links, and command-triggered AI work
- misleading names, helper boundaries, or abstractions that make future callers
  likely to use the API incorrectly
- tests that only prove the easiest success path and do not pin product,
  privacy, compatibility, or lifecycle behavior

Every second-layer finding still needs a concrete trigger path, code reference,
or verifiable assumption. If the concern is plausible but not proven, label it
as `P3`, `needs decision`, or `optional polish` instead of presenting it as a
blocker.

## Project Risk Checklist

Use this checklist to guide search, not to manufacture findings.

Pagelet:

- `sourcePath` vs `primarySourcePath` vs `saveFlow.pending.targetPath`
- `currentPanelLayout` and discovery/summary/review routing
- `PanelView.close()` / `onClose` clearing state unexpectedly
- stale foreground review results and pet/panel state transitions
- `beginForegroundReviewRun()` consistency across review, discovery, summary,
  and other provider-backed foreground work
- pending generated markdown or provider output persisted in Obsidian view
  state, workspace state, settings, or vault files without explicit approval
- `resolveRelatedMarkdownNote` / `getFirstLinkpathDest` source-path context
- bubble quick actions that start AI/provider work before clear data/cost/scope
  disclosure
- keyboard focus restoration from bubble, panel, and native detail tab
- SVG graph keyboard/touch behavior and label clipping
- legacy command aliases and command labels

Memory/VSS:

- durable vs fallback behavior
- VSS operation queue / exclusive lock for mutating operations
- dirty state, background reconcile, retry/backoff, and chat non-blocking paths
- user-facing copy per **Memory/VSS Product Rules** from AGENTS.md

Community/release:

- no runtime `<style>` injection
- no `innerHTML` / `outerHTML` assignment in plugin DOM code
- generated `styles.css` matches Tailwind source for CSS changes
- release docs and links point to existing files or clearly future assets
- package/deploy paths include any new runtime assets

## Severity Rules

Use severity to reflect user impact and release risk.

- **P0**: data loss, source-note corruption, security/privacy breach, plugin
  unusable on common path.
- **P1**: release-blocking correctness or product-contract violation, especially
  privacy/data persistence, explicit SDD non-goal violation, broken write guard,
  or community review `Error`.
- **P2**: must-fix before merge/release for likely user-visible failure,
  state/concurrency bug, wrong file write/open, broken docs link in release
  material, serious accessibility/focus problem.
- **P3**: optional polish, maintainability debt, visual refinement, performance
  concern without clear user-visible failure.

If a finding depends on a design decision rather than a definite bug, label it
as `needs decision` or `optional polish`. Do not escalate vague future risk to a
blocker unless there is a likely user-visible, privacy, data-safety,
compatibility, or release impact.

## Validation

Run the **Local Validation Gate** from AGENTS.md, scoped to the changed
surface. For broad Pagelet or shared-runtime diffs, also include `npm run lint`.

Per AGENTS.md Testing Instructions, do not claim Obsidian validation without
deployed evidence. If `make deploy` and real test-vault smoke were not run, state it.

## Output

Use this structure:

```markdown
**Findings**
- P1/P2/P3 [file](/absolute/path:line): concise issue.
  Impact/trigger. Suggested fix.

**Validation**
- checks run
- checks not run / residual risk

**Notes**
- optional polish, second-layer risks, test gaps, or needs-decision items, only
  when useful
```

Keep summaries secondary. If there are no actionable findings, say that clearly
and list remaining validation gaps.

## Related Skills

- To triage and implement fixes from this review, use `personal-assistant-review-followup`.
- For app-level smoke validation, use `obsidian-test-vault-smoke`.
- For real-device iOS validation, use `obsidian-ios-real-device-smoke`.
- For community compliance scan before release, use `obsidian-community-check`.

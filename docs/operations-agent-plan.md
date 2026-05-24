# Operations Agent Plan

## Status

| Field | Value |
| --- | --- |
| Track | Future Operations Agent / action mode |
| Status | Draft boundary plan |
| Source | PA Agent v1 closeout follow-up |
| Related docs | [PA Agent Architecture Plan](./pa-agent-architecture-plan.md), [Write Action Design Handoff](./write-action-design-handoff.md), [Obsidian Operations Agent Plan](./obsidian-operations-agent-plan.md) |

This document is a future-work boundary. PA Agent v1 remains read-only plus network-read. Do not implement write, command, shell, script, local MCP, or plugin-management actions by weakening the PA Agent v1 capability policy.

## Scope

Operations Agent is the future mode that may propose and, after explicit confirmation, execute bounded operations in an Obsidian vault or local Obsidian environment.

Candidate action families:

- Vault note changes limited to explicit note paths and bounded text ranges.
- Frontmatter/property updates with typed previews.
- Link, callout, and metadata cleanup operations based on prior read-only analysis.
- Obsidian command or plugin actions only after a separate command-safety review.

Out of scope until separately approved:

- Arbitrary filesystem writes outside the vault.
- Shell, Bash, Node, Python, AppleScript, or local executable calls.
- Installing, enabling, disabling, or updating plugins.
- User-configured local MCP or stdio MCP execution.
- Background autonomous changes without a visible preview and current-turn confirmation.

## Preview And Confirmation

Every action capability must require a preview before execution.

Preview must show:

- Action family and capability id.
- Target vault path or Obsidian object.
- Exact proposed diff, property change, command, or operation summary.
- Source evidence used to justify the action.
- Whether rollback is available and what rollback covers.
- Cost, network, or provider implications when applicable.

Confirmation must be action-time and specific. A prior general user request is not enough for execution. The user must confirm the concrete preview in the current turn before any mutation runs.

The model may draft an action plan, but runtime policy decides whether execution is allowed. The model cannot bypass preview, target checks, or confirmation by wording its answer as an instruction.

## Target Confinement

All write/action targets must pass deterministic confinement before preview and again before execution.

Vault targets:

- Normalize paths with Obsidian vault-relative rules.
- Reject absolute paths, parent traversal, symlink-like escape patterns, and hidden runtime/cache directories unless explicitly allowed by the action family.
- Require a single concrete target set; broad globs or whole-vault writes need a batch-specific review gate.
- Re-read the target immediately before execution and fail closed if the preview is stale.

Command targets:

- Commands are denied by default.
- Any future command family must use an allowlist of exact Obsidian command ids, declared arguments, platform support, and side-effect class.
- Local shell or arbitrary process execution remains outside this plan until a separate security design is approved.

## Rollback And Failure

Actions must define their failure and rollback contract before implementation.

Required behavior:

- No partial silent success. If an action touches multiple targets, report each target status.
- Keep the original target snapshot in memory for the current operation until execution finishes.
- Prefer atomic vault APIs when available.
- On stale target, permission rejection, abort, or validation mismatch, do not execute.
- When rollback is available, present it as a separate confirmed action, not an automatic hidden mutation.

Rollback limits must be explicit. Some operations can provide exact undo patches; others can only provide a manual recovery note.

## Audit And Privacy

The default audit surface is local-only and redacted.

Allowed by default:

- Capability id.
- Action family.
- Success/failure status.
- Error category.
- Redacted target category or hash.
- Confirmation outcome.

Not allowed by default:

- Full note text.
- Full prompt text.
- Unredacted paths in telemetry.
- Complete diffs persisted outside the current UI session.

Persisting complete diffs, prompt bodies, or full target paths requires a separate product/security review and an explicit user setting.

## Test Gates

Before any Operations Agent action ships:

- Unit tests for policy rejection, target confinement, stale preview, confirmation required, abort, partial failure, and rollback availability.
- Prompt-injection tests where note/web/skill context asks the assistant to bypass confirmation or change targets.
- UI tests for preview rendering, confirmation, cancellation, and stale-preview failure.
- Obsidian smoke for each action family in the test vault.
- Mobile platform decision: supported, hidden, or read-only fallback.

## Open Decisions

- First writable action family.
- Whether rollback is stored only in memory or optionally persisted locally.
- Batch-operation UX and limits.
- How action telemetry relates to the existing opt-in capability usage hook.
- Whether any Obsidian command ids are safe enough for v1 Operations Agent.

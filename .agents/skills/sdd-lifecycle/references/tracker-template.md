# Development Tracker Template

Use this template only after product scope is approved. Create the tracker at
`docs/development/active/<feature>/tracker.md` and adapt rows to the approved
plan; do not copy unused phases mechanically.

```markdown
# <Feature> Development Tracker

Status: Draft | Approved | Active | Blocked | Complete
Updated: YYYY-MM-DD
Owner/authority: <document or role>
Product spec: ../../../product/specs/<feature>-product-spec.md
Plan: ./plan.md
SDD: ./sdd.md

## Scope

- Goal:
- Non-goals:
- Stop point:

## Phase Status

| Phase | Status | Exit gate | Evidence |
| --- | --- | --- | --- |
| Plan | `[ ]` | Scope approved | |
| SDD | `[ ]` | Design review clean | |
| Implement | `[ ]` | Focused validation passes | |
| Review and smoke | `[ ]` | No unresolved P0/P1/P2 | |
| Closeout | `[ ]` | Contracts and artifacts reconciled | |

## Verification Log

| Date | Slice | Check | Result | Evidence or residual risk |
| --- | --- | --- | --- | --- |
| | | | | |

## Finding Lifecycle

| Finding | Severity | Status | Fix or deferral evidence |
| --- | --- | --- | --- |
| | | | |

## Risk Table

| Risk | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| | | | | |

## Open Decisions

| Decision | Options | Owner | Status | Rationale |
| --- | --- | --- | --- | --- |
| | | | | |
```

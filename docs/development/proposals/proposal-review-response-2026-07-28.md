# Proposal Review Response

Document status: Current
Delivery status: Blocked
Updated: 2026-08-01
Work item: B-123
Related work item: B-101
Authority: Project owner's settled design decisions for B-123 Pagelet Deep Discover and related B-101 Operations.
Restart condition: Mac 解锁后补 Step 1 Bubble → Panel / Settings 可见 smoke；B-101 仅在 owner 明确启动 Step 2 后进入实现。
Revision: v2 — reflects rewritten proposals and confirmed implementation plan
Scope: Pagelet Agent proposal + Agent Operations capability proposal
Discussed by: Project owner + Claude Code (product discussion partner)
Original reviewer: Codex (independent analysis, 2026-07-28)

> This document records the project owner's final decisions regarding the PA
> Agent proposals. It serves as the **authoritative source of truth** for any
> future session (Claude Code, Codex, or other) working on these proposals.
>
> **v2 changes (2026-07-30)**: Both proposals have been significantly rewritten.
> Pagelet Agent proposal now includes experiment validation. Operations proposal
> rewritten from "API capability layer" to "need-driven scenarios." Implementation
> plan updated from 5 Phases to 3 concrete Steps with completion criteria.

---

## 1. Current State of Proposals

### 1.1 Document locations

| Document | Path | Status |
|----------|------|--------|
| Pagelet Agent proposal | `docs/development/proposals/pagelet-agent/pagelet-agent-proposal.md` | Direction validated by experiment |
| Operations capability | `docs/development/proposals/operations-agent/agent-operations-capability.md` | Needs clarified, scope focused |
| Operations Agent plan (B-101 original) | `docs/development/proposals/operations-agent/operations-agent-plan.md` | Historical reference, superseded by capability doc |
| Operations Agent SDD (B-101 original) | `docs/development/proposals/operations-agent/operations-agent-mode-sdd.md` | Historical reference |

### 1.2 What happened since v1 of this document

1. **Pagelet Agent experiment conducted (2026-07-30)**: Gave AI free exploration
   of the user's real vault (anthelion). Agent explored 14 notes, produced 6
   cross-note insights. User confirmed findings were genuinely valuable,
   particularly "时间线揭示思维演进" — something the user hadn't consciously noticed.
   **Conclusion: multi-turn retrieval validated as producing significantly deeper
   insights than single-shot.**

2. **Pagelet Agent proposal rewritten**: Now includes experiment evidence (§2),
   removes rigid structured output requirement, focuses on the core problem
   ("洞察太浅 + 无价值" due to low AI participation).

3. **Operations proposal rewritten**: Shifted from "define all Obsidian APIs as
   tools" to "Chat 对话结论落地到 vault" as the primary scenario. Scope reduced
   from 15+ tools to 4 core tools. Added Pagelet↔Chat collaboration model.

4. **Implementation order confirmed**: Pagelet Agent first (validated), then
   Operations (need proven but logical), then Pagelet+Operations integration.

---

## 2. Accepted from Codex Analysis (Still Valid)

### 2.1 Validate before full migration

**Still valid.** Do not merge all Pagelet scenarios at once. The experiment
validated the *direction*, not the full migration scope. Step 1 is still a
focused trial in production, compared against single-shot baseline.

### 2.2 Pagelet Agent does not depend on Operations

**Still valid.** Pagelet Agent's discovery value is read-only. Operations is a
separate concern triggered by different scenarios.

### 2.3 Technical issues

**Still valid and now tracked as T1-T10.** Full list:

| ID | Applies to | Issue | Required fix |
|----|-----------|-------|-------------|
| T1 | Pagelet | Anchor context drift | Freeze anchor note path + content at trigger time |
| T2 | Pagelet | Cache invalidation | Cache identity = anchor + sources + pipeline version |
| T3 | Pagelet | Quality gate | Source verification + novelty check (NOT model confidence alone) |
| T4 | Pagelet | Concurrency | Chat preempts Pagelet; Pagelet pauses when Chat starts |
| T5 | Pagelet | Cost control | Daily cap + per-run tool call limit + Settings visibility |
| T6 | Operations | Atomicity | Use `vault.process()` atomic callback |
| T7 | Operations | Rollback drift | Verify current == expected after-state before rollback |
| T8 | Operations | Target stale | Re-read target before execution after confirmation |
| T9 | Operations | Audit privacy | Content-free metadata by default; full diff opt-in only |
| T10 | Integration | Context handoff | Pagelet → Chat upgrade must carry full insight context |

### 2.4 Structured tool call is the only implementation form

**Still valid.** No code execution, no eval, no JavaScript sandbox.

### 2.5 B-119 as prerequisite — SUPERSEDED

**No longer applicable.** The Pagelet Agent experiment (2026-07-30) already
validated that multi-turn retrieval produces deeper insights than single-shot.
B-119 is not a prerequisite for Pagelet Agent work. If B-119 has independent
value it can proceed in parallel, but it does not gate Pagelet Agent.

---

## 3. Not Accepted from Codex Analysis (Still Rejected)

### 3.1 Governance process — Still REJECTED as over-heavy

Process for this project remains:
- Focused SDD (implementation design)
- Implementation
- Dogfood validation (real usage testing)

No 7-step approval chain required.

### 3.2 Trial budget — Still REJECTED as too restrictive

Budget for Pagelet Agent trial remains:
- ~8-12 tool calls, 3-5 turns per run
- WebSearch included as verification tool
- Wall clock ~60-120 seconds
- 熔断器 at 30 calls / 180s (emergency only)

### 3.3 "Broad Operations should never be implemented" — NOW MOOT

Operations proposal has been rewritten with focused scope (4 core tools for
"Chat conclusions → vault"). The original Codex concern was about the old
"full API capability layer" design which no longer exists. This rejection point
is no longer relevant.

### 3.4 Intent-level confirmation — Still the design choice

Low-medium risk: intent confirmation (inline in chat)
High risk (rename, delete): show diff/impact preview
All operations: immediate undo available

### 3.5 Command execution — Still DEFERRED (not permanently excluded)

Deferred to Step 3+ expansion. Will be evaluated with real scenarios.

### 3.6 "Companion" vision — Still the product north star

All technical work serves the direction: quiet, trustworthy companion that
grows with the user over time. Not a near-term deliverable but the design lens.

---

## 4. Confirmed Implementation Plan

### 4.1 Three Steps

```
Step 1: Pagelet Agent Deep Discover 试验
  ├── Implement agent loop (reuse PaAgentLoop, Pagelet mode config)
  ├── Anchor-note exploration with vault read tools
  ├── Run 20+ real vault cases, compare vs single-shot
  ├── Prove quality uplift (dogfood judgment)
  ├── Trigger mechanism (post-edit / explicit)
  ├── Display results in existing UI (Panel/Bubble)
  └── Silent when no insight (no forced output)

Step 2: Operations Phase 1 — Chat 对话结论落地
  ├── 4 core write tools (create/append/process/frontmatter_update)
  ├── Agent proactively suggests saving (depth/content triggers)
  ├── Agent judges write target (path+filename), fallback to 0.unsorted/
  ├── Uses obsidian-markdown skill for formatting
  ├── Inline confirmation UI in Chat
  ├── Post-write result display + undo button
  ├── Audit log (content-free)
  └── Dogfood: daily Chat discussions naturally saved to vault

Step 3: Pagelet + Operations 联动
  ├── Insight card action buttons (context-specific action text)
  ├── Simple actions: inline confirm → direct execution
  ├── Complex actions: carry context → upgrade to Chat Agent
  ├── Shared write tool layer (same implementation)
  └── Dogfood: full flow from Pagelet discovery → action → vault write
```

### 4.2 Dependencies

```
Step 1 (Pagelet Agent) — no dependency, start immediately
Step 2 (Operations) — no dependency on Step 1, can run in parallel or after
Step 3 (Integration) — depends on both Step 1 and Step 2 being functional
```

### 4.3 What the proposals ARE

- **Product direction documents** — capture design decisions and validated direction
- **Implementation guides** — SDDs should be built upon these proposals
- **Decision references** — settled design choices that should not be re-litigated

### 4.4 What the proposals are NOT

- Implementation-ready code specs (need SDD)
- Timelines or sprint plans
- Documents that need "approval" before work begins

---

## 5. Technical Requirements for SDD

### 5.1 Pagelet Agent SDD must address:

```
T1: Anchor freeze mechanism (path + content + mtime at trigger)
T2: Cache identity = anchor + sources + boundary + pipeline version
T3: Quality gate = source verification + novelty check
    (NOT model self-reported confidence alone)
    Agent output is NOT constrained to a rigid schema — let it express
    findings freely; quality is judged by source grounding and usefulness
T4: Concurrency: Chat always preempts Pagelet; Pagelet pauses mid-run
T5: Cost: daily cap + per-run tool call limit + cost visible in Settings
    Budget per run:熔断器 at 30 calls / 180s (防异常 only)
    Normal operation: lead-driven stop (Agent decides when done)
```

### 5.2 Operations SDD must address:

```
T6: Atomicity via vault.process() — no read-then-modify pattern
T7: Rollback drift detection (current == expected after-state)
T8: Target stale re-read before execution
T9: Audit: content-free metadata default; full content opt-in
    Storage: .obsidian/plugins/personal-assistant/audit/
    One file per operation (no multi-device git conflict)
    30/90 day auto-cleanup
Additional:
  - Agent proactive save trigger logic (conversation depth/content type)
  - Write target judgment logic (vault structure awareness)
  - Obsidian-markdown skill integration for content formatting
  - vault_process: 3 operations only (replace/insert/delete)
  - Write tools loaded on demand (not always in prompt)
```

### 5.3 Integration SDD must address:

```
T10: Pagelet → Chat context handoff (insight + sources + reasoning)
Additional:
  - Action button text generation (context-specific, not generic)
  - Simple vs complex action routing logic
  - Shared write tool instance (not duplicated)
```

---

## 6. Key Design Decisions (Do Not Re-Litigate)

These decisions are SETTLED. Future sessions should implement them, not
re-discuss or reverse them without explicit owner instruction:

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Agent化 direction (not pipeline patching) | Ceiling follows model capability, not code; experiment validated |
| 2 | Pagelet Agent: AI decides what to explore | Low AI participation is the root cause of shallow insights |
| 3 | Pagelet Agent: no rigid output schema | Don't constrain insight expression; judge quality by source grounding |
| 4 | Operations: primary scenario is "Chat conclusions → vault" | User's actual workflow; competitive necessity |
| 5 | Operations: 4 core tools only (create/append/process/frontmatter) | 90% coverage; expand only when demand proven |
| 6 | Operations: Agent proactively suggests saving | Reduce user burden; trigger on conversation depth/content type |
| 7 | Operations: Agent judges write target, fallback 0.unsorted | Balance intelligence with determinism |
| 8 | Pagelet and Chat: same companion, two modes | Not parallel agents; shared memory and capabilities |
| 9 | Pagelet complex action → upgrade to Chat | Single companion model; discuss before executing complex things |
| 10 | Structured tool call only (no eval) | Type safety, preview, no injection risk |
| 11 | Inline confirmation (not modal) | Don't break flow; don't scare the user |
| 12 | WebSearch in Pagelet Agent for verification | Discovery from vault; verification can use external data |
| 13 | Content-free audit by default | Privacy; full content opt-in only |
| 14 | Rollback with drift detection | Protect user's subsequent edits |
| 15 | Solo developer governance (SDD + dogfood) | Lightweight; no multi-step approval chain |

---

## 7. Rules for Future Sessions

Any AI session (Codex, Claude Code, or other) working on these proposals MUST:

1. **Read this document first.** It is the authority, not the raw proposals alone.

2. **Do not re-litigate settled decisions (§6).** Implement them. If you disagree,
   flag it as a concern but proceed with the decided approach.

3. **Do not add governance overhead.** Process is: SDD → implement → dogfood.
   No separate security reviews, no multi-step approval chains, no formal
   sign-offs.

4. **Do not delete or archive proposal files.** They are retained as direction
   documents. A previous session incorrectly deleted them; they have been restored.

5. **Resolve T1-T10 technical issues in every SDD.** These are non-negotiable
   requirements, not optional enhancements.

6. **Pagelet Agent output is free-form.** Do not force a rigid schema on insight
   output. The Agent should express findings naturally. Quality is judged by
   source grounding and user value, not by schema compliance.

7. **Operations scope is focused.** Do not expand beyond the 4 core tools in
   Step 2. Additional tools are Step 3+ and require proven demand.

8. **Companion is the north star.** Evaluate design tradeoffs against: "does
   this make PA feel more like a quiet companion that grows with the user?"

9. **Implementation order is Step 1 → 2 → 3.** Steps 1 and 2 can run in
   parallel. Step 3 requires both to be functional.

10. **The user's role**: independent developer, sole decision-maker. Frame your
    work as "implementation advisor" — answer "how to build this well," not
    "whether this should be built."

11. **When in doubt about a design choice**: choose the option that gives the
    AI model more freedom to leverage its reasoning capability. The product
    thesis is "model capability as leverage."

---

## 8. Handoff Checklist

Before implementation begins, verify:

- [ ] SDD written for the target Step (addresses all technical requirements)
- [ ] Proposal read and understood (direction document, not spec)
- [ ] This review response read (authoritative decisions)
- [ ] No governance overhead added beyond SDD + implement + dogfood
- [ ] Technical issues T1-T10 addressed in SDD
- [ ] Completion criteria for the Step are clear and agreed

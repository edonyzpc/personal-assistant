# PA Product North Star

Updated: 2026-06-29

## Status

| Field | Value |
| --- | --- |
| Document type | Product philosophy / design principle |
| Scope | PA Agent, Pagelet, Memory, Capture, Review, Maintenance, Action |
| Role | North Star for product design, SDD decisions, and implementation tradeoffs |
| Related research | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Related product doctrine | [Low-Burden Review Product Principles](./pa-low-burden-review-product-principles.md) |

This document records PA's product philosophy. It should stay shorter and more
stable than feature specs. Use it when a design decision is ambiguous.

## North Star

> PA is a quiet and trustworthy personal knowledge assistant that helps users
> capture lightly, review naturally, connect with evidence, maintain
> reversibly, and act only after trust has grown.

Short form:

> Let personal knowledge compound naturally.

PA's value is not making AI think for the user. PA's value is helping the
user's own thinking become easier to keep, revisit, connect, and care for over
time.

PA should also avoid turning review into a new management burden:

> Review should feel like recognition, not administration.
>
> 回顾应该像“想起来了”，不是“又多了一组待处理”。

The default PA artifact is ignorable. The user should be able to read, close,
ignore, or dismiss a recall cue, digest, or insight candidate without creating
future debt. Explicit confirmation is required when PA will create durable
state, change future PA behavior, mutate the vault, or act outside the vault.

## Product Philosophy

### 1. Let Thoughts Stay First

Do not begin with complex knowledge management. Do not require the user to
classify, structure, configure, or write long-form content before value appears.

PA should first lower the cost of leaving a real thought behind.

### 2. Let Thoughts Return Naturally

Users do not need more AI-generated content by default. They need to meet their
own old thoughts again at the right time.

PA should help with retrieval, review, connection, and recall before it tries to
create more output.

Returning a thought should not become a processing task. A quiet recall,
Pagelet hint, or AI insight preview may simply be noticed and forgotten again.
That is acceptable.

### 3. Care For Knowledge Gently

Second brains become messy. Notes age, titles blur, links go missing, drafts
stall, and ideas scatter.

PA should help maintain the vault like a quiet knowledge steward: rename, link,
archive, review, and update when useful, but never roughly overwrite the user's
thinking.

### 4. Keep AI Behind The User

AI may expand, summarize, suggest, maintain, and act. But the user should always
be able to tell:

- what the original thought was
- what AI added or changed
- why PA suggested it
- where the evidence came from
- whether the change can be undone

The stronger PA becomes, the quieter and more explainable it should feel.

### 5. Let Trust Grow Slowly

PA should not start as a fully automatic vault manager.

It should begin with small, reviewable actions. When the user repeatedly accepts
similar suggestions with low edits and low undo rates, PA may earn more scoped
autonomy.

Trust does not mean asking for more confirmations. Trust means PA learns which
durable actions deserve preview and which read-only signals should stay
lightweight, sparse, and easy to ignore.

## Design Principles

- Less management, more capture.
- Less generation, more return.
- Less interruption, more right-time presence.
- Less black-box insight, more source-backed evidence.
- Less full automation, more earned trust.
- Less tool jargon, more long-term companionship.
- Less confirmation burden, more optional recognition.

## Product Review Questions

Before adding or implementing a PA feature, ask:

- Does this lower the friction of capturing or revisiting real thoughts?
- Does this protect the user's original thinking?
- Does this help old thoughts return at the right time?
- Does this connect ideas with evidence instead of producing black-box insight?
- Does this maintain the vault gently, with preview, recovery, or undo?
- Does this keep advanced AI capability behind a quiet product surface?
- Does this earn trust gradually instead of assuming broad permission?
- Can the user ignore this without future penalty?
- Is confirmation tied to a durable consequence rather than an AI sentence?
- Does this reduce more review burden than it creates?

If a feature does not pass these questions, it may still belong in an
engineering substrate, but it should not become a prominent product surface yet.

## What PA Should Avoid

- Do not become "ChatGPT inside Obsidian."
- Do not force users to become knowledge managers.
- Do not let AI content drown out the user's original notes.
- Do not interrupt often just to appear intelligent.
- Do not pursue fully automatic organization before trust exists.
- Do not turn human-in-the-loop safety into human-as-clickworker chores.
- Do not create queues, badges, or unresolved states for every AI candidate.
- Do not expose RAG, GraphRAG, VSS, agent, or memory jargon as product concepts.

## Final Principle

> Capture should be light. Review should be natural. Connections should have
> evidence. AI artifacts should be ignorable. Maintenance should be reversible.
> Action should be earned.

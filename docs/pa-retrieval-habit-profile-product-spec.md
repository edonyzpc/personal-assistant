# PA Retrieval Habit Profile Product Spec

Updated: 2026-06-28

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / future implementation input |
| Status | Confirmed decision spec; implementation not started |
| Feature family | Retrieval Habit Profile / Local retrieval adaptation |
| Primary surfaces | Active Vault Indexer, Quiet Recall, Pagelet, Settings advanced data controls |
| Related research | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Related specs | [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md) |

This spec defines Retrieval Habit Profile as a local, clearable, weak-influence
adaptation layer for retrieval and recall. It is not current shipped behavior.

The product definition:

> Retrieval Habit Profile helps PA adapt to how the user finds notes in this
> vault. It is not a user profile.

This document records the one-question-at-a-time product decisions confirmed on
2026-06-28.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| RHP-D1 | Keep Retrieval Habit Profile as local, clearable, weak-influence background model. | It tunes retrieval defaults and recall, but never becomes user identity/profile memory. |
| RHP-D2 | Collect explicit behavior plus low-sensitive usage patterns. | Use scope choices, source clicks, search query type, related-note opens, recall feedback, saved insights, and common entry types. |
| RHP-D3 | Weakly affect default scope, candidate ordering, recall type mix, and source presentation order. | It improves ergonomics without overriding evidence, explicit scope, Data Boundary, or Context Firewall. |
| RHP-D4 | Make it lightly visible in Data & Privacy / Advanced, with clear/disable controls. | Users can understand and control local adaptation without a dashboard. |
| RHP-D5 | Do not sync, export, or write to vault. | It is local adaptation cache, not a knowledge asset. |
| RHP-D6 | Use rolling window plus decay. | Recent retrieval behavior matters more; old habits naturally fade. |
| RHP-D7 | Include deterministic eval for weak-influence boundaries. | Tests assert it cannot cross explicit scope, Data Boundary, Context Firewall, or evidence strength. |
| RHP-D8 | Provide lightweight why-shown explanations. | Example: "Shown higher because you often use tags in this vault." |
| RHP-D9 | Default collection requires a lightweight first-use notice or explicit enablement. | PA does not silently start behavior-like local adaptation without a visible Data & Privacy control. |

## 1. Product Decision

Retrieval Habit Profile should exist, but stay small and local.

Selected shape:

> A local adaptation cache that notices how the user retrieves knowledge in a
> vault and gently adjusts defaults, ordering, and explanations.

It should not:

- infer user identity
- infer personality
- infer productivity style
- infer values or goals
- become Confirmed Memory
- sync across devices
- write to Markdown
- appear as a dashboard

The goal is not "PA understands who you are." The goal is "PA notices that in
this vault, folder/tag/link/search habits matter differently."

## 2. Allowed Signals

Retrieval Habit Profile can use explicit behavior and low-sensitive usage
patterns.

Allowed v1 signals:

| Signal | Example |
| --- | --- |
| User-selected scope type | current note, selected notes, folder, tag, time range |
| Source click | user opens a cited note from PA result |
| Search query type | path/folder-like, tag-like, natural language, exact term |
| Related note open | user opens a related-note suggestion |
| Recall feedback | accept, dismiss, not relevant |
| Saved insight | user saves a theme/tension/question |
| Accepted related note | user accepts a related-note suggestion |
| Common entry type | Chat, Pagelet, Weekly Review, Quick Capture |
| Dismissed / not relevant | lightweight negative feedback |

Not collected in v1:

- editing duration
- time-of-day inference
- dwell time
- full cross-file navigation paths
- usage frequency profile
- productivity patterns
- identity/personality/values inference
- health/finance/relationship inference

Product rule:

> Use interaction choices, not behavioral surveillance.

## 3. Influence Policy

Retrieval Habit Profile has weak influence only.

Allowed influence:

- default scope suggestion
- candidate ordering tie-breaker
- recall type mix
- source presentation order
- lightweight why-shown labels

Not allowed:

- overriding explicit user-selected scope
- crossing Data Boundary exclusions
- overriding Context Firewall
- overriding evidence strength
- promoting weak evidence over strong source-backed evidence
- becoming Confirmed Memory
- creating profile-like conclusions

Example allowed behavior:

- If the user often opens tag-related sources, tag-matched candidates can be
  shown slightly higher when evidence is otherwise comparable.

Example disallowed behavior:

- A tag-matched weak candidate outranks a direct source note because the user
  "likes tags."

## 4. User Visibility

Retrieval Habit Profile should be lightly visible, not a main surface.

Recommended Settings location:

- `Data & Privacy`
- `Advanced`

Suggested copy:

```text
PA can adapt recall using local interaction patterns in this vault, such as
which source types you open or which scopes you choose. This stays on this
device and can be cleared or turned off.
```

Controls:

- enable / disable
- clear local retrieval habit profile
- optionally reset learned weights

Default state:

- v1 starts disabled until the user enables `Improve recall locally` or accepts
  a lightweight first-use notice.
- The notice must say the profile is local-only, clearable, weak influence,
  and not Confirmed Memory.
- Enabling does not permit provider calls, vault writes, sync, export, or
  cross-vault tracking.
- Disabling stops both future signal collection and retrieval influence.

Do not build:

- habit dashboard
- charts
- user typing/usage analytics
- personality report
- productivity report

## 5. Storage Boundary

Retrieval Habit Profile is local-only.

Rules:

- store aggregate signals only
- no vault write
- no Markdown artifact
- no export in v1
- no sync
- no provider call required
- clearable from settings
- disabled state stops future collection and influence
- disabled state should not produce habit-based why-shown labels

It should be treated like local cache/adaptation data, not user knowledge.

## 6. Lifecycle

Use rolling window plus decay.

Suggested model:

- recent 30 days: strongest signal
- recent 60 days: moderate signal
- recent 90 days: weak signal
- older signals decay out

The exact windows can be tuned, but the product rule is:

> Retrieval habits change; old behavior should fade without requiring manual
> cleanup.

User clear action:

- deletes learned local habit profile
- resets weak influence to neutral
- keeps source notes and Confirmed Memory untouched

Retention:

- retain only rolling aggregate windows needed for the decay model
- default maximum window is 90 days
- older aggregate buckets are dropped during normal cleanup
- no raw click stream, raw dwell time, or full navigation path history is kept

Disabled-mode behavior:

- no new signals are written
- existing aggregates are inert and do not influence retrieval
- user can clear existing aggregates immediately
- if the user re-enables later, PA starts from remaining non-expired aggregates
  unless the user cleared them

## 7. Why-shown

Retrieval Habit Profile can appear in lightweight why-shown explanations.

Allowed examples:

- `Shown higher because you often use tags in this vault.`
- `Shown because you frequently open sources from this folder.`
- `Related by folder and recent source clicks.`

Avoid:

- `You are a tag-oriented user.`
- `You usually work this way.`
- `PA learned your behavior profile.`
- detailed weights or scores in ordinary UI

Why-shown should explain ranking gently without turning local adaptation into
identity.

## 8. Data Model Notes

Suggested local aggregate fields:

| Field | Meaning |
| --- | --- |
| `vaultId` | Local vault identity |
| `updatedAt` | Last update time |
| `windowStart` | Rolling window start |
| `scopeSignalWeights` | Local weak weights for folder/tag/link/time/current-note preferences |
| `sourceClickSignals` | Aggregated low-sensitive source click patterns |
| `entryTypeSignals` | Chat/Pagelet/Weekly/Quick Capture usage mix |
| `negativeSignals` | Dismiss / not relevant aggregates |
| `decayVersion` | Decay model version |
| `enabled` | Whether the profile can influence retrieval |

Do not store:

- raw full navigation paths
- raw dwell times
- inferred personality labels
- sensitive topic labels
- stable identity attributes

## 9. Relationship To Active Vault Indexer

Active Vault Indexer consumes Retrieval Habit Profile as a weak rerank input.

Allowed integration:

- rerank tie-breaker
- source presentation order
- default mode suggestion
- why-shown label

Active Vault Indexer must still prioritize:

- explicit user scope
- SourceRef evidence strength
- Data Boundary
- Context Firewall
- retrieval outcome state
- source freshness

## 10. Relationship To Quiet Recall

Quiet Recall can use Retrieval Habit Profile to tune recall mix.

Examples:

- show more tag-linked cues when user often opens tag-based sources
- show more recent-note cues when recent-note clicks are strong
- reduce source types repeatedly marked not relevant

Boundaries:

- still max 2 to 3 Bubble items
- still source-backed
- still obey frequency settings
- still explain with light why-shown
- no identity/profile claim

## 11. Relationship To Memory Taxonomy

Retrieval Habit Profile is not Memory.

It differs from Confirmed Memory:

| Dimension | Retrieval Habit Profile | Confirmed Memory |
| --- | --- | --- |
| Source | interaction aggregates | user-confirmed memory candidate |
| Visibility | settings/advanced only | Memory panel |
| Sync/export | no | maybe export by user |
| Influence | weak retrieval defaults | can affect PA behavior if used |
| User meaning | local adaptation cache | durable remembered context |

Do not promote retrieval habit into Memory automatically.

## 12. Data Boundary And Privacy

Retrieval Habit Profile must obey Data Boundary.

Rules:

- excluded scopes should not produce habit signals
- clear data action removes local profile
- disabled state stops signal collection and influence
- no provider call
- no export
- no Markdown write
- no cross-device sync

If future versions add export or sync, this spec must be revised first.

## 13. Evaluation

Eval Harness should include small deterministic tests.

Test goals:

- weak influence only
- explicit scope wins
- Data Boundary wins
- Context Firewall wins
- evidence strength wins
- clear/disable removes influence
- decay reduces old signal effect

Suggested cases:

| Case | Expected behavior |
| --- | --- |
| Explicit folder scope | Habit does not pull results from another scope |
| Excluded tag | Habit cannot surface excluded sources |
| Strong evidence vs habit match | Strong evidence ranks above weak habit match |
| Not relevant feedback | Similar future suggestions are downranked |
| Clear profile | Ordering returns to neutral |
| Disabled profile | No habit-based why-shown appears |
| Old signal | Decayed signal has lower influence |

## 14. Roadmap

### Phase 0: Product Contract

- Link this spec from Active Vault Indexer, Quiet Recall, Data Boundary, Eval
  Harness, and coverage audit.
- Keep it local-only.

### Phase 1: Local Aggregate Model

- Track allowed signals only.
- Add rolling decay.
- Add clear/disable settings.

### Phase 2: Weak Influence Integration

- Add weak rerank/tie-breaker input to Active Vault Indexer.
- Add recall type mix tuning to Quiet Recall.
- Add lightweight why-shown labels.

### Phase 3: Eval Fixtures

- Add deterministic boundary tests.
- Verify clear/disable behavior.
- Verify Data Boundary and explicit scope precedence.

## 15. Open Questions

- What exact rolling windows should v1 use: 30/60/90 days or simpler 30-day
  decay?
- Should source click signals be grouped by source type only, or by folder/tag
  class too?
- Should disabled mode stop collecting signals, stop influence only, or both?
- Should a developer debug view expose aggregate weights?
- How should this interact with future cross-device sync if PA ever supports
  it?

## 16. Summary

Retrieval Habit Profile helps PA adapt without profiling the user.

The durable contract:

- local-only
- clearable and disableable
- no sync/export/vault write
- explicit and low-sensitive signals only
- weak influence only
- rolling decay
- lightweight why-shown
- deterministic eval for boundaries

It makes retrieval feel more fitted to the user's vault habits without turning
those habits into identity.

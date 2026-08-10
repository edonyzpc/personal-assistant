# PA Episodic Memory & Attunement Design

Updated: 2026-08-10

Status: Design document (pre-implementation). Captures the complete design for
episodic memory and attunement mechanisms that enable "quiet companionship"
through accumulated shared history.

Related docs:
- [PA Product North Star](../product/pa-product-north-star.md)
- [Memory Type Taxonomy spec](../product/specs/pa-memory-type-taxonomy-product-spec.md)
- [Memory Control Center spec](../product/specs/pa-memory-control-center-product-spec.md)
- [PA Agent Architecture](./pa-agent-architecture-plan.md)

## 1. Motivation & Value Proposition

### The Gap

PA's current memory system stores **conclusions**:

| Type | Nature |
| --- | --- |
| `preference` | "User prefers X" |
| `decision` | "User decided Y" |
| `project_context` | "Project is doing Z" |
| `task_constraint` | "Must satisfy W" |
| `open_question` | "Q is unresolved" |

These are facts without journey. PA knows WHAT was decided but not HOW we got
there — what was considered, what was rejected, what was the reasoning at the
time.

### North Star Extension

The North Star says: "随手记下，需要时自然浮现。"

Currently "记下" only applies to vault notes. But conversations with PA are
also thinking — often the lightest form of thought capture. Episodic memory
extends the North Star from "help you find notes" to "help you find thinking."

```
Capture cost spectrum:

Heavy ──── vault note (requires deliberate writing)
              ↓
Medium ──── quick capture / micronote
              ↓
Light ──── conversation with PA (episodic memory covers this)
              ↓
Zero ──── nothing done (lost)
```

Episodic memory fills the gap between "lightest capture" and "zero" — the user
thinks naturally in conversation, PA preserves the valuable parts, and they
resurface when relevant.

### Concrete Value

1. **Zero-cost thinking preservation** — conversations become an automatic
   thinking record without any extra action from the user.
2. **Decision reasoning traceability** — decisions remain auditable; "why did I
   decide this?" can be answered months later.
3. **Avoidance of repeated reasoning** — PA can reference prior exploration
   rather than forcing the user to re-derive from scratch.
4. **Accumulated relationship quality** — PA becomes more useful and more
   "fluent" over time, not just marginally more informed.

### What PA Becomes

| Without episodic memory | With episodic memory |
| --- | --- |
| Conversation = query interface (use and discard) | Conversation = thinking process (worth preserving) |
| PA = note retrieval assistant | PA = persistent thinking partner |
| Accumulates: notes + extracted facts | Accumulates: notes + facts + shared thinking history |
| Relationship: each session is a service | Relationship: ongoing collaboration |

---

## 2. Conceptual Framework

### Two Dimensions of Companionship

"Quiet companionship" decomposes into two independent dimensions:

```
              Attunement (HOW/WHEN)
              ↑
              │
              │          [Companionship]
              │
              │
              └──────────────→ Continuity (WHAT/HISTORY)
```

**Continuity** = "knows what happened between us" (primary build target)
**Attunement** = "knows how to be present right now" (largely emergent from
good continuity)

Validation via four-quadrant test:

| | High Attunement | Low Attunement |
| --- | --- | --- |
| **High Continuity** | Quiet old friend (target) | Remembers everything but socially awkward |
| **Low Continuity** | Good in the moment but forgets between sessions | Standard stateless tool |

### Three Layers of Continuity

```
Episodes ──reflection──→ Arcs ──accumulation──→ Common Ground
(events)                  (narratives)            (shared defaults)
    ↓                        ↓                        ↓
"What happened last time"  "How we got here"     "What no longer needs saying"
```

**Episode** — A structured record of a single topic-coherent thinking
interaction. Granularity: one meaningful discussion (may be one session or part
of a session).

**Arc** — A narrative thread synthesized from multiple related episodes.
Produced by periodic reflection. Captures direction changes, evolution, and
trajectory.

**Common Ground** — The set of concepts, terminology, and shared assumptions
that no longer require explanation. Emerges from high-frequency, never-corrected
established knowledge.

### Relationship to Existing Memory

```
Existing (Semantic Memory):  Conclusions — "what is true"
New (Episodic Memory):       Journeys — "how we got here"
```

They are complementary, not competing:
- Facts (governed memory) are conclusions extracted from episodes
- Episodes provide context and reasoning for facts
- They cross-reference each other via `derived_facts` / `source_episode` links

---

## 3. Boundaries

### 3.1 What Becomes an Episode

**Primary source: Chat conversations** (PA is a participant, high confidence)

An episode is created when a conversation contains thinking process, judged by
these signals:

| Signal | Weight | Example |
| --- | --- | --- |
| Contains decision | High | "Let's do X" / "Not doing Y" |
| Direction change | High | Position shifts during the conversation |
| Multi-option deliberation | Medium | "A's advantage is... B's advantage is..." |
| New insight | Medium | "So the real issue is actually..." |
| Open thread left | Medium | "Think about this later" |
| Conversation depth | Low | Exceeds a threshold of meaningful exchange |

**Secondary source: Vault "thinking-type" notes** (PA is a reader, inferred
confidence)

Detection heuristics for thinking-type notes:
- Contains deliberation language (pros/cons, "on one hand... on the other")
- Journal/reflection format (temporal thinking record)
- Brainstorm/mind-map structure
- Contains questions + attempted answers

**Enrichment source: Quick Captures**

Quick captures do not independently generate episodes. They are
retroactively linked to existing episodes when semantically related.

**Contextual annotation: Regular vault notes**

When a user writes a vault note that relates to a recent episode, the episode
gains a `derived_artifacts` link. The note becomes a "crystallization" of that
thinking process.

### 3.2 What Does NOT Become an Episode

- Transactional interactions ("format this code", "what does this function do")
- PA's own errors and corrections
- Raw code snippets (authoritative source is the repo)
- Small talk / pleasantries
- Pagelet interactions (viewing/dismissing AI suggestions)
- Memory governance operations (confirming/rejecting memories)

### 3.3 Episode Content — What Is Stored

| Field | Content | Purpose |
| --- | --- | --- |
| `theme` | Topic label | Retrieval entry point |
| `trajectory` | How the discussion evolved | The journey (core value) |
| `turning_points` | Moments where thinking shifted | Arc synthesis material |
| `rejected_alternatives` | Options considered but not chosen | Future re-evaluation |
| `conclusions` | Final decisions/insights | Links to governed memory |
| `open_threads` | Unresolved questions/threads | Dangling thread surfacing |

**Not stored:** full transcript, user emotional/personality inference, PA's
internal reasoning traces, verbatim code blocks.

### 3.4 Sensitivity Handling

| Sensitivity | Content type | Handling |
| --- | --- | --- |
| Low | Vault content discussions, technical discussions | Auto-store |
| Medium | Product strategy, personal work decisions | Auto-store; user can review/delete |
| High | Involves others, health, finance, emotional distress | Do NOT auto-store |

An episode's sensitivity = max sensitivity of its content. If high-sensitive
content appears mid-conversation, the entire episode is not auto-stored.

### 3.5 User Control Points

**Before creation:**
- Global toggle: enable/disable episode recording (settings)
- Per-session: "don't remember this conversation"

**After creation:**
- View all episodes in Memory Control Center
- Delete individual episodes (immediate, permanent)
- Mark as important (increases weight, slows decay)
- Export to vault note (crystallize into permanent artifact)

**Automatic (no user action needed):**
- Episode-worthiness judgment
- Decay and natural forgetting
- Reflection synthesis
- Linking captures and notes

### 3.6 Relationship to Vault

Episodes do NOT enter the vault. They are PA's private interaction memory.

```
Vault = user's deliberate knowledge (user controls)
Episodes = PA's interaction memory (PA manages, user oversees)
```

A user can "promote" an episode to vault via export, but this is an explicit
action.

---

## 4. Architecture Integration

### 4.1 Embedding Strategy

Episodic memory is not a parallel system. It integrates into the existing
pipeline at specific points:

```
Trigger              Extraction              Storage             Consumption
─────               ──────────              ───────             ───────────

                ┌──→ Type A Extractor ──→ Admission ──→ Governed Store ─┐
Chat ends ──────┤                                                        │
                └──→ Episode Extractor ──→ Ep. Admission ──→ Episode Store│
                                                     ↑                   │
Vault change ──→ Type C Analyzer ─┬──→ Vault Insights│                   │
                                  └──→ Vault-episode ─┘                   │
                                                                          │
                ┌──────────────────────────────────────────────────────────┘
                │
                ▼
        Memory Search (hybrid — searches all three sources)
                │
                ▼
        Context Firewall + Projector
                │
                ├── governed memory context (existing)
                ├── episode context (new, reconstructed)
                ├── common ground context (new)
                └── vault search results (existing)
                │
                ▼
        LLM prompt generation


Background processes:
  Reflection ──→ synthesize episodes → Arc insights
  Decay ──→ periodic salience reduction
```

### 4.2 Reuse vs New Build

| Component | Approach | Reuses |
| --- | --- | --- |
| Episode extraction | New extractor, parallel to Type A | Trigger timing (conversation end) |
| Episode storage | New store schema | IndexedDB infrastructure |
| Episode search | Extend existing | VSS index, hybrid search |
| Episode projection | Extend projector | Context Projector framework |
| Episode admission | Simplified policy | Sensitivity detection logic |
| Reflection | New process | extraction-scheduler |
| Episode management UI | Extend Control Center | Existing UI framework |

### 4.3 Cross-Reference Between Episode and Governed Memory

```
Episode Record                      Governed Memory (fact)
──────────────                      ────────────────────
id: ep-001                          id: mem-042
theme: "Product direction"          type: "decision"
derived_facts: [mem-042] ─────────→ summary: "AI Chat first"
                          ←───────── source_episode: ep-001
```

This enables:
- Forward: "What came out of that discussion?" → follow derived_facts
- Backward: "Why was this decided?" → follow source_episode
- Reflection: enrich facts with episode context

### 4.4 MEM-D2 Boundary Compliance

MEM-D2: "PA cannot infer identity/personality/values from behavior."

Episodic memory complies because:
- Episodes record EVENTS ("we discussed X, decided Y"), not TRAITS
- No personality/identity inference is stored
- Trajectory descriptions describe interaction evolution, not user character
- Reflection produces narrative arcs ("topic evolved from A to B"), not user
  profiles ("user is the type of person who...")

---

## 5. Episode Data Model

```typescript
interface Episode {
  id: string;
  created_at: number;            // timestamp
  source: "chat" | "vault_note";
  confidence: "observed" | "inferred";

  // Content
  theme: string;
  trajectory: string;
  turning_points: string[];
  rejected_alternatives: string[];
  conclusions: string[];
  open_threads: string[];

  // Relations
  derived_facts: string[];       // governed memory IDs
  related_captures: string[];    // quick capture IDs
  related_episodes: string[];    // semantic neighbor episodes
  source_note_path?: string;     // vault source (for vault-derived)
  derived_artifacts: string[];   // vault notes written as result

  // Lifecycle
  salience: number;              // 0.0–1.0, decays over time
  weight: number;                // intrinsic importance (fixed at creation)
  last_accessed: number;         // last retrieval or reflection reference
  decay_rate: number;            // base rate, modulated by weight
  state: "active" | "dormant" | "forgotten";
  absorbed_by_arc?: string;      // Arc ID if reflected upon
}
```

### Weight Calculation

```
weight = normalize(
  decision_count × 3 +
  turning_points.length × 2 +
  open_threads.length × 1.5 +
  trajectory_richness × 1
)
```

Weight is fixed at creation time. It reflects intrinsic importance.
Salience changes over time; weight does not.

---

## 6. Lifecycle

### 6.1 State Machine

```
Creation ──→ Active ──→ Decaying ──→ Dormant ──→ Forgotten
                 ↑           │
                 └──Reinforce─┘
                       │
                       ↓ (absorbed)
                   Arc layer
```

### 6.2 Creation

**Chat-sourced:**
1. Conversation ends
2. Episode Extractor evaluates episode-worthiness (LLM meta-judgment)
3. If worthy: extract structured fields
4. Run sensitivity check
5. Store with initial salience (0.8–1.0 based on content richness)
6. Link to any simultaneously extracted governed memory facts

**Vault-sourced:**
1. Type C Analyzer detects new/modified thinking-type note
2. Build episode context (theme, trajectory, open threads)
3. Mark confidence as "inferred"
4. Store with slightly lower initial salience (0.6–0.8)

### 6.3 Decay

Ebbinghaus-inspired exponential decay:

```
salience(t) = initial_salience × e^(-λt)

where:
  t = days since last_accessed
  λ = base_decay_rate / weight
```

| Weight tier | Typical content | Half-life |
| --- | --- | --- |
| High (0.8–1.0) | Major direction decisions, architecture choices | 60–90 days |
| Medium (0.5–0.7) | General discussions, option evaluation | 30–45 days |
| Low (0.2–0.4) | Light exploration, initial ideas | 14–21 days |

### 6.4 Reinforcement

| Event | Effect |
| --- | --- |
| Retrieved and injected into context | Reset last_accessed; salience += 0.2 (cap 1.0) |
| User explicitly references related topic | Strong reset; salience → 0.9 |
| New episode on same theme created | Light reset; salience += 0.1 |
| Reflection references but does not fully absorb | Pause decay |
| User marks as "important" | Permanently increase weight |

Each reinforcement slightly increases weight (×1.05), making subsequent decay
slower — mirroring how repeatedly recalled memories become more durable.

### 6.5 Reflection Absorption

When reflection synthesizes an episode into an Arc:
- `absorbed_by_arc` is set
- `decay_rate` doubles (episode fades faster since its essence lives in the Arc)
- Episode is not immediately deleted — still available for detailed recall
- Eventually decays to dormancy naturally

### 6.6 State Thresholds

| Salience | State | Behavior |
| --- | --- | --- |
| > 0.3 | Active | Discoverable by search, injectable into context |
| 0.1–0.3 | Dormant | Not actively surfaced; visible in Control Center; usable by Reflection |
| < 0.1 | Forgotten | Soft delete (tombstone); content removed, metadata retained |

### 6.7 User-Initiated Forgetting

User can delete any episode at any time. Deletion is immediate:
- Content removed
- Tombstone record retained (for audit, not recovery)
- Related `derived_facts` in governed memory are NOT affected (independent
  lifecycle)
- Related Arc records are NOT affected (Arc is an independent entity)

---

## 7. Reflection & Arc Formation

### 7.1 Trigger Conditions

| Condition | Logic |
| --- | --- |
| Same-theme episode count ≥ 3 | Enough material for narrative |
| ≥ 7 days since last reflection AND new episodes exist | Periodic synthesis |
| New episode contradicts conclusion of existing same-theme episode | Direction change detected |

### 7.2 Arc Data Model

```typescript
interface Arc {
  id: string;
  theme: string;
  timespan: [number, number];       // earliest to latest episode
  narrative: string;                 // "From X, through Y, to Z"
  trajectory_summary: string;       // compressed evolution
  key_decisions: string[];          // extracted from source episodes
  current_state: string;            // where this thread is now
  source_episodes: string[];        // contributing episode IDs
  salience: number;
  last_updated: number;
}
```

### 7.3 Arc Lifecycle

Arcs are more durable than episodes:
- Slower decay rate (they represent synthesized understanding)
- Updated when new episodes are absorbed into them
- Forgotten only when ALL source themes become irrelevant

### 7.4 Common Ground Formation

Common Ground is not explicitly stored as a separate entity. It is a
**projection** derived from:
- High-confidence governed memory items that have never been corrected
- Frequently referenced terminology from Arcs
- Concepts that appeared in 3+ episodes without needing explanation

At context projection time, the projector assembles a Common Ground block from
these sources and injects it as "concepts that need no explanation."

---

## 8. Attunement Design

Attunement is not a separate system. It is a set of behavioral mechanisms
governing HOW continuity information is used in interaction.

### 8.1 Surfacing Timing (When to Inject vs Stay Silent)

**Core principle: untrained proactive surfacing hurts performance.** (Meta
Proactive Memory Agent, 2026: uncalibrated memory agent degrades task
completion vs. no memory at all.)

**Decision function:**

```
surface(memory, context, user_state) → {inject, silent}

Default = silent
Requires ALL gates + at least one positive signal to inject
```

**Necessary gates (all must pass):**
1. Content relevance to current utterance > threshold
2. Information not already in current conversation
3. Memory-backed evidence exists (not generic advice)
4. Cooldown period not active

**Positive signals (at least one required):**
- User about to violate a previously stated constraint
- User repeating a previously explored-and-abandoned approach
- A Dangling Thread is directly relevant to current topic
- A prior analysis explains the user's current confusion

**Explicit silent conditions:**
- Only broad strategic advice available (no specific evidence)
- Would interrupt an execution flow (user doing a focused task)
- Information is tangential (related but not directly useful)
- Would replace user's own thinking process

**Cooling and backoff:**
- Minimum 5 turns between proactive surfacings in a single session
- Exponential backoff after ignored/dismissed surfacings
- Cross-session reset on new conversation

**Initial implementation: rule-based gates. Future: GRPO calibration using
inject-acceptance as reward signal.**

### 8.2 Graduated Familiarity

**Two-mode behavioral model** driven by a single continuous parameter:

```
common_ground_density = confirmed_episodes / interaction_timespan
```

| Mode | Condition | Behavior |
| --- | --- | --- |
| Conservative | common_ground_density < threshold | High surfacing threshold; fewer assumptions; less proactive; confirm when uncertain |
| Familiar | common_ground_density ≥ threshold | Lower surfacing threshold; can assume shared context; omit known background; may offer unrequested suggestions |

**Why two modes, not many:**
- Communication style evolution is continuous (Schulman & Bickmore 2010), not
  discrete stages
- Multiple stages create perceptible behavioral jumps that feel unnatural
- The boundary between modes is fuzzy (blend strategies near threshold)

**Regression triggers:**
- User explicitly corrects a PA assumption
- User shows displeasure at proactive surfacing
- User deletes episodes
- Long gap since last interaction (relationship needs "warm-up")

**Regression behavior:** Temporarily raise thresholds, reduce proactivity,
increase confirmation. Not full reset — targeted adjustment on the violated
dimension.

### 8.3 Anti-Over-Personalization

**Core principle: Knowledge ≠ Display.** Having information does not mean it
should be surfaced. 85% of users react negatively to explicit personalization
markers but positively to silent behavioral adaptation (email personalization
research).

**Three-type filter (OP-Bench Self-ReCheck):**

Before injecting any personal context into the prompt, verify it does not
commit:

| Type | Test | Action if fails |
| --- | --- | --- |
| Irrelevance | "Is this information necessary for answering the current question?" | Filter out |
| Repetition | "Has this been cited in the last N interactions?" | Filter out |
| Sycophancy | "If removed, does response quality substantively decrease?" | Filter out |

**Behavioral constraints in prompt:**

```
Episode context usage rules:
- Default to implicit use: improve quality without declaring source
- Only reference explicitly when: user asks, contradiction with past needs
  flagging, or dangling thread requires attention
- Never use demonstrative phrasing ("I remember you...", "As you once said...")
- If the current question can be fully answered without this context, don't use it
```

**Frequency limits:**
- ≤ 2 explicit history references per conversation
- Same episode cannot be explicitly referenced in consecutive sessions
- ≤ 1 proactive surfacing per 5 turns

**The quiet principle:**

Good attunement is characterized by what DOESN'T happen:
- No unnecessary background questions
- No mismatched response depth
- No forced history references
- No patronizing re-explanations

The user's experience should be "this conversation is smooth," not "PA is
showing off its memory."

---

## 9. Research Foundation

### Memory Architecture

| Reference | Key contribution | Application |
| --- | --- | --- |
| Stanford Generative Agents (Park et al., 2023) | Memory Stream + Reflection + Retrieval; relationships emerge from reflection | Blueprint for Episode → Arc pipeline |
| SeCom (Microsoft/Tsinghua, ICLR 2025) | Topic-coherent segments as optimal memory granularity | Episode segmentation approach |
| MemHarness (2025) | Raw replay degrades performance by -6.3% | Episodes must be reconstructed, not replayed verbatim |
| AdaMem (2026) | Selective memory outperforms exhaustive (+9% QA, -9% volume) | Not all conversations deserve episodes |
| Roynard "Missing Knowledge Layer" (2026) | Different persistence semantics for knowledge/memory/wisdom | Facts persist; episodes decay (different lifecycles) |
| A-MEM (NeurIPS 2025) | Zettelkasten-style self-organizing memory with backlinks | New episodes retroactively link to old ones |

### Proactive Surfacing

| Reference | Key contribution | Application |
| --- | --- | --- |
| Meta Proactive Memory Agent (2026) | Uncalibrated memory hurts; GRPO-trained inject/silent | Binary gate function with RL calibration |
| CollabLLM (Microsoft, ICML 2025) | Multi-turn reward: value = downstream trajectory | Surfacing value is not immediate but downstream |
| Clinical alert studies | 91% override rate when alerts are too frequent | Cry-wolf effect: false positives kill system |
| Iqbal & Bailey breakpoints | Task boundaries (coarse > medium > fine) reduce disruption | Surface at topic transitions, not mid-execution |
| KnowU-Bench (2026) | Agents fail at intervention calibration under vague conditions | Silence must be the trained default |

### Graduated Familiarity

| Reference | Key contribution | Application |
| --- | --- | --- |
| Sedoshkin RMS (2025) | Operationalized Knapp stages with Trust Evaluator | Regression detection and recovery |
| XiaoIce (Zhou et al., 2020) | Empirical 5-stage progression data from real users | Calibration of timeline expectations |
| Glikson & Woolley (2020) | Competence first, then relational behaviors | Conservative mode before familiar mode |
| Non-linear trust dynamics | Trust builds slowly, collapses instantly | One over-personalization event destroys weeks of trust |
| Schulman & Bickmore (2010) | Communication style evolves continuously, not discretely | Two-mode blend, not multi-stage jumps |

### Anti-Over-Personalization

| Reference | Key contribution | Application |
| --- | --- | --- |
| OP-Bench (Hu et al., 2026) | Three types: Irrelevance, Repetition, Sycophancy; Self-ReCheck filter | Pre-injection filtering mechanism |
| Email personalization (Marketing) | 85% negative reaction to explicit markers; positive to silent adaptation | "Knowledge ≠ Display" principle |
| CRoSS (Langer & König, 2018) | Creepiness = emotional creepiness + ambiguity; worst = partial revelation | Either fully transparent or fully silent |
| Overservice research (Tourism Management 2025) | Excessive attentiveness → freedom threat → abandonment | Moderate presence, not maximum |
| Sycophantic AI (Science 2025) | AI validates 49% more than humans; reduces user prosocial behavior | Never optimize for user approval |

---

## 10. Implementation Priority

### Phase 0 (Prerequisite constraints)

Before any episodic memory exists, establish the behavioral constraints:
- Self-ReCheck filtering logic (prevents over-personalization from Day 1)
- Prompt-level behavioral constraints (implicit > explicit rules)
- Frequency hard limits on surfacing

### Phase 1 (Core: Episode creation and storage)

- Episode Extractor (evaluates episode-worthiness; extracts structured fields)
- Episode Store (IndexedDB schema, basic CRUD)
- Episode ↔ Governed Memory cross-references
- Episode display in Memory Control Center
- User controls (delete, mark important, export)

### Phase 2 (Retrieval and surfacing)

- Episode vectorization and VSS integration
- Extend Memory Search to include episodes
- Context Projector extension (episode context block)
- Surfacing gate (rule-based inject/silent)
- Common Ground projection
- Cooling/backoff mechanism

### Phase 3 (Evolution and intelligence)

- Reflection process (episode → Arc synthesis)
- Arc storage and lifecycle
- Vault thinking-note detection (secondary episode source)
- Quick capture retroactive linking
- Graduated familiarity (two-mode model)
- Regression detection

### Phase 4 (Optimization, long-term)

- RL-based surfacing calibration (GRPO on inject-acceptance signal)
- Learned episode-worthiness threshold
- Adaptive decay rates based on usage patterns
- Cross-episode contradiction detection

---

## Design Decisions Summary

| ID | Decision | Rationale |
| --- | --- | --- |
| EP-D1 | Episodic memory enhances existing memory system, not a new architectural layer | "Relational context" is an emergent property of good episodic + semantic memory, not a separate subsystem |
| EP-D2 | Companionship = Continuity × Attunement | Two independent dimensions; continuity is the primary build target; attunement emerges from good continuity |
| EP-D3 | Three continuity layers: Episode → Arc → Common Ground | Progressive abstraction: events consolidate into narratives, narratives into shared defaults |
| EP-D4 | Chat is primary episode source; vault thinking-notes secondary | PA as participant (high confidence) vs PA as reader (inferred confidence) |
| EP-D5 | Episodes do not enter the vault | PA's private memory; vault remains user-controlled; export is explicit |
| EP-D6 | Default auto-store with user override | "Less management, more capture"; user can opt out per-session or globally |
| EP-D7 | Ebbinghaus decay with retrieval reinforcement | Natural forgetting of unimportant episodes; important ones persist through use |
| EP-D8 | Reflection synthesizes episodes into Arcs | Higher-level understanding with longer persistence than raw episodes |
| EP-D9 | Knowledge ≠ Display | Store everything (for quality); surface selectively (for trust) |
| EP-D10 | Self-ReCheck three-type filter | Prevents Irrelevance, Repetition, Sycophancy before any context injection |
| EP-D11 | Silence is the default; multiple signals required to surface | Untrained proactivity hurts (Meta 2026); conservative approach preserves trust |
| EP-D12 | Two-mode behavioral model (Conservative/Familiar) | Continuous transition driven by common_ground_density; avoids discrete "level" jumps |
| EP-D13 | MEM-D2 compliant — episodes record events, not traits | "We discussed X" is not profiling; "user is the type who..." would be |

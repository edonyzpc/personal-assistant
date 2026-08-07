# Retrieval Pipeline Optimization

Status: Active (Phase 1-3 pending implementation)
Updated: 2026-08-07

## Summary

Three-phase optimization of the PA Agent's memory retrieval pipeline:

1. **Phase 1: Self-RAG Reflection** — Fix reranker bug, add three-level verdict (relevant/partially_relevant/none_relevant), filter garbage from agent prompt.
2. **Phase 2: PPR Graph Expansion** — Replace one-hop link expansion with Degree-penalized Personalized PageRank. Discover structurally related notes 2-3 hops away via the vault's wikilink graph.
3. **Phase 3: Single-Retry Recovery** — When first search fails, guide agent to retry once with relaxed parameters.

## Documents

| Document | Purpose |
|----------|---------|
| [SDD](./sdd.md) | Full design specification, decision records, algorithm code, integration details |
| [Plan](./plan.md) | Delivery phases, dependencies, risks, validation strategy |
| [Tracker](./tracker.md) | Per-task progress tracking and exit criteria |

## Key Technical Choices

- **PPR over community detection**: Query-time local expansion (no precomputation, no maintenance)
- **Degree-penalized transitions**: Suppress hub nodes via `1/sqrt(degree(target))`
- **Verdict-based retry detection**: Retry only triggers when previous search had poor results, not on any second search
- **Feature flags internal only**: No user-visible settings added

## Constraints

See SDD "Constraints For Implementation" section for 8 hard rules that must not be violated.

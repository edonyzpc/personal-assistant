# Pagelet B-108 Dogfood Follow-up Delivery Plan

Document status: Archived
Updated: 2026-07-19
Work item: B-108
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: [Scope Recap And Theme Summary Product Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

交付 B-108 的 Recap 即时价值、诚实失败与 Quiet Recall 独立质量门，并以真实 Obsidian surface 证明“用户打开已授权 prepared Recap，或显式打开无有效 artifact 的 Recap 恢复路径时不等待；三秒内看到具体价值或诚实且有用的状态”。普通 Pet/Bubble 在无 Recap artifact 且用户关闭 generic hints 时继续受 Bubble `Intentionally Quiet` 契约治理，不属于本阻塞门。所有实现必须保持安静、来源支撑、可关闭、无自动写入。

非目标与 [Feature Home](./README.md#outcome-and-boundary) 一致；尤其不借此改动 generic preload/default hints、已冻结快捷键/Weekly Review/WAF 边界，也不执行发布或 Git 写入。

## Dependencies And Source Surface

- Product authority: owning [Scope Recap spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md), DEC-017 and related DEC-018/019/020.
- Existing Recap generation and mapping: `src/pa/scope-recap.ts`, `src/pagelet/bubble/recap-card.ts`, `src/pagelet/orchestrator.ts`, `src/plugin.ts`.
- Existing Recall candidate/evaluator path: `src/pa/quiet-recall.ts`, `src/plugin.ts`, `src/pagelet/BubbleCoordinator.ts`.
- Existing settings and migration: `src/settings.ts`, `src/settings/pagelet/index.ts`, locale JSON under `src/locales/pagelet/`.
- Existing reusable rate-limit seam: `src/pagelet/pa-review-rate-limit.ts`; existing generic preload budget remains a separate contract.
- Visible surfaces: `src/pagelet/bubble/`, `src/pagelet/tab/TabView.ts`, `src/pagelet/pet/PetView.ts`, `src/custom.pcss`.
- Focused regression surfaces: `__tests__/scope-recap.test.ts`, `__tests__/quiet-recall.test.ts`, Pagelet orchestrator/Bubble/Tab/Pet/settings/locale suites.

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| 0. Authority bootstrap | One owning spec and one Approved Active Package | Metadata, B-108 IDs, plan, SDD, tracker, registry/backlog transition | `npm run docs:check` and `git diff --check` pass | Stop if authority or accepted decisions conflict |
| 1. Consent, settings and budgets | No background provider read occurs before affirmative Run; Recap and Recall have independent persisted counters | `Run / Adjust / Cancel`, Recap preparation/hint settings, migration, 2/h+10/day Recap and 10/h+50/day Recall buckets, content-free diagnostics | Settings/migration/limiter focused tests pass, including N/N+1 and reload | Stop if migration could silently opt in an existing user |
| 2. Honest Recap runtime | Last valid artifact, attempt status and local overview cannot overwrite or impersonate each other | Typed outcomes, scheduler dedupe/backoff, explicit Retry, source/freshness validation | Null/throw/timeout/empty/malformed/rejected/stale tests pass | Stop if local overview can enter DeliveryCandidate or nudge pools |
| 3. Recap visible value | Bubble and Tab deliver the strongest actual insight immediately, otherwise show useful Retry/View sources orientation | Structured Tab section, quality gate, stable fingerprint, persisted suppression, independent hint toggle | DOM/integration tests plus three-second fixture pass | Stop if click performs an implicit provider call or shows generic ready copy |
| 4. Quiet Recall DEC-020 | Every eligible candidate receives an independent bounded judgment with exact-cache reuse only | Sequential max-5 evaluation, one language retry, call reservation, exact cache, no-template fallback, Discover-only local routing | Call-count, isolation, cache-invalidation and no-template tests pass | Stop if cooldown/budget can promote a rule/template why-now |
| 5. v2.9 presentation reconciliation | Existing dogfood UI work is verified against the owning contracts and corrected only where evidence fails | Context action, Bubble single-card/stack, long-press menu, font scaling, card hierarchy, i18n/a11y/lifecycle cleanup | Focused DOM tests and desktop/mobile smoke evidence | Do not expand unrelated Pagelet IA |
| 6. Review and formal validation | Implementation has independent review and real-surface evidence | Product-drift, privacy/cost, async/lifecycle, UI/i18n and test-adequacy review lanes; local gate; `make deploy`; Obsidian smoke | All P0/P1/P2 closed or explicitly deferred; Tracker maps every B-108 ID to evidence | No closeout, commit or release without separate authority |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| Unauthorized background note transfer | Versioned consent and pre-call authorization gate | Provider spy on fresh/migrated/cancelled states | Disable Recap preparation, preserve explicit local overview and manual Retry |
| Cost undercount or shared-budget coupling | Reserve before each invocation; feature-scoped persisted buckets | N/N+1, failure, retry, reload and midnight tests | Fail closed on limiter/storage uncertainty; no provider call |
| Failed/stale attempt replaces useful content | Separate `lastValidArtifact` and `lastAttemptStatus`; validate scope/source/TTL before view | Race, stale and failure integration tests | Keep prior valid artifact or show local overview; never generate a fake Recap |
| Local facts or template copy become “AI insight” | Typed outcome and pool-level eligibility guards | Negative tests at builder, mapper, coordinator and Bubble | Route local results to explanation/Discover only |
| Recall cache crosses contexts | Exact fingerprint plus bounded TTL/LRU | One-component-at-a-time invalidation tests | Clear in-memory cache and re-evaluate only when gates permit |
| Repeated nudge or queue debt | Stable fingerprint ledger, quiet/focus/cooldown gates, passive close | reload/dismiss/Later tests and app smoke | Suppress proactive state while keeping explicit click-to-view |
| Settings migration silently changes legacy defaults | New keys do not inherit generic preload/global hint values | old `data.json` fixture tests | Migrate to unconfirmed/no-call and retain prior generic settings |
| UI regressions or leaked listeners/timers | Existing Pagelet lifecycle ownership and scoped CSS | DOM teardown tests, community scan, desktop/mobile smoke | Disable the affected nudge/menu slice; retain explicit Panel access |

## Validation Strategy

- Focused tests: Recap builder/outcome, Quiet Recall evaluator/runtime, feature limiters, settings migration, orchestrator, Bubble content/coordinator/view, Tab structured rendering, Pet long-press, locale parity and cost diagnostics.
- Type/lint/build gate: run focused Jest first, then `npx tsc -noEmit -skipLibCheck`, `git diff --check`, and the Local Validation Gate DOM scan. `make deploy` supplies full Jest/lint/build before app smoke.
- Obsidian smoke: use the repo-local test vault after `make deploy`; verify fresh authorization, prepared value, failure/retry, exact Recall behavior, settings independence, themes/fonts and the three-second value gate.
- Real-device / community / release gate: use iPhone real-device smoke for mobile long-press/layout claims when available; community scan errors are blockers. No release/publish action is authorized by this plan.

## Approval

- Plan authority: DEC-017 through DEC-020, the current owning Product Spec, and the user-approved B-108 choices recorded on 2026-07-18.
- Approved on: 2026-07-18.
- Authorized implementation scope: B-108 runtime, settings/migration, focused tests, minimal UI/i18n corrections, review and formal local/app validation; no commit, closeout or release.

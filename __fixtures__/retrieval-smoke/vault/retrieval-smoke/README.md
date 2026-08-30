# B-125 Retrieval Smoke

This is an isolated, synthetic test-vault fixture pack for the approved
retrieval-optimization app smoke. It contains no user notes.

Use `node scripts/prepare-retrieval-optimization-smoke.mjs --write`, prepare or
update Memory through the normal confirmation flow, reload Obsidian, and then
run `retrieval-optimization-smoke-runner.js` from DevTools.

The runner never invokes an AI provider, rebuilds Memory, changes feature flags,
or marks a manual observation as passing. It only validates the deployed
preconditions and records explicit Chat/Pagelet observations.

The `temporal-retry` pack is a separate explicit `2026-01-01..2026-12-31`
recovery canary. Its
standard distractors and relaxed target are dated in 2026, while its stronger
forbidden distractor is dated in 2020. The runner accepts that case only when
both retrieval attempts and the cumulative projection report the frozen temporal
filter with zero violations, and the final sources contain the 2026 target
without the 2020 distractor.

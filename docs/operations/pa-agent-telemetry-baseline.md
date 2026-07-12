# PA Agent Telemetry Baseline Runbook

Date: 2026-05-24

## Scope

PA Agent v1 telemetry is an opt-in, local capability-usage event hook. It is not an upload pipeline and does not collect prompts, note text, observations, source snippets, vault paths, file paths, URLs, API keys, or model outputs.

This runbook defines the baseline that should be collected after a v1 release candidate is available and before any Operations Agent implementation decisions are made from usage data.

## Event Contract

Each emitted event contains only:

- `capabilityName`
- `providerId`
- `status`: `invoked`, `failed`, `skipped`, or `unavailable`
- `durationMs`

The setting `shareAnonymousCapabilityUsage` defaults to `false`. When disabled, no capability usage event is emitted.

## Baseline Metrics

Collect only aggregate counts and latency summaries:

- invocation count by `capabilityName`
- status distribution by `capabilityName`
- p50 / p95 `durationMs` by `capabilityName`
- unavailable/skipped ratio by `capabilityName`
- provider-level failure count by `providerId`

Do not collect raw event streams unless they have already been aggregated and inspected for the content-free event contract.

## Collection Window

For PA Agent v1, use a post-release or release-candidate window of at least seven days from opt-in testers. The baseline is sufficient for Operations Agent planning only after it includes:

- direct answer turns with no tool call
- Memory search turns
- current-note / vault read-only tool turns
- builtin WebSearch turns, split by desktop/mobile runtime when available
- bundled skill guide turns
- cancellation or unavailable-capability turns

Mobile WebSearch is part of the post-ship baseline now that positive iPhone `requestUrl` auth evidence exists. Report desktop and mobile WebSearch aggregates separately. Hard timeout/deadline behavior remains covered by adapter automated tests unless a separate manual timeout fixture is introduced.

## Release Readiness Boundary

The v1 release gate is instrumentation and runbook readiness, not pre-release collection of real user telemetry. Actual post-ship aggregate collection remains a future milestone and must not be represented as already collected in release notes or product claims.

## Verification

Current automated coverage verifies:

- default setting is off
- disabled telemetry emits no events
- enabled telemetry emits one content-free event per capability execution
- event keys do not include prompt, note, content, observation, or path fields
- runtime wiring passes `shareAnonymousCapabilityUsage` into `CapabilityRegistry`

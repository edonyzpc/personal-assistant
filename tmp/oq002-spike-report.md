# OQ002 — F5 Provider Compatibility Spike Report

> Date: 2026-06-05
> Author: PA core (automated spike)
> Status: Partially Resolved (code-review + web-research complete; live API testing deferred)

## Executive Summary

The current dual-path architecture (LangChain `withStructuredOutput` as primary path, hand-written JSON fallback parser as secondary) is sound and adequate for all supported providers. Newer Qwen models (qwen3.5+, qwen-max, qwen-plus, qwen-flash, qwen-turbo in non-thinking mode) support `json_schema` strict mode through DashScope's OpenAI-compatible endpoint, meaning the structured output path will work natively for the majority of PA's target audience. The fallback parser is comprehensive and will serve as a reliable safety net for providers or models that lack native schema enforcement.

## Methodology

1. **Code inspection**: Read `pa-review-schemas.ts`, `pa-review-model.ts`, `ai-utils.ts`, and `package.json` to understand the schema shape, structured output invocation, fallback orchestration, and LangChain dependency versions.
2. **LangChain documentation review**: Researched `@langchain/openai` (`ChatOpenAI.withStructuredOutput`) behavior, including `method: "json_schema"` vs `"function_calling"` vs `"json_mode"` semantics.
3. **Provider API documentation review**: Searched DashScope/Alibaba Cloud (mainland + international) official docs, CSDN technical articles, and Zhihu posts for JSON mode / JSON schema support status per model family.
4. **DeepSeek / OpenAI-compatible research**: Searched for structured output support in DeepSeek, Groq, Together, and other OpenAI-compatible providers accessible through `ChatOpenAI`.

## Per-Provider Findings

### Qwen / DashScope

- **LangChain integration class**: `ChatOpenAI` from `@langchain/openai` v1.4.4, configured with DashScope's OpenAI-compatible `base_url` (`https://dashscope.aliyuncs.com/compatible-mode/v1` or intl variant).
- **`withStructuredOutput` support**: **Yes** -- `ChatOpenAI` exposes this method. PA calls it with `{ name: "pagelet_review", method: "json_schema", strict: true }`.
- **`response_format: json_schema` support**: **Partial, model-dependent**.
  - DashScope's OpenAI-compatible endpoint supports `response_format: { type: "json_schema", json_schema: {...}, strict: true }` for the following model families (non-thinking mode only):
    - **max**: qwen3.6-max, qwen3-max, qwen-max series
    - **plus**: qwen3.7-plus, qwen3.6-plus, qwen3.5-plus, qwen-plus series
    - **flash**: qwen3.6-flash, qwen3.5-flash, qwen-flash series
    - **turbo**: qwen-turbo series
    - **coder**: qwen3-coder series
    - **long**: qwen-long series
  - Older Qwen models (qwen2.5 and below) may only support `json_object` mode, NOT strict `json_schema`.
  - **Thinking mode constraint**: Models running in thinking mode (e.g., `enable_thinking: true`) do NOT support json_schema. PA's `pa-review-model.ts` uses `temperature: 0.2` and does not enable thinking mode, so this is not a concern for the Pagelet path.
- **JSON mode (`response_format: json_object`)**: **Yes** -- supported by most Qwen models. Guarantees valid JSON output but does not enforce schema structure.
- **Models applicable to PA**: qwen-turbo, qwen-plus, qwen-max, qwen-flash (the typical choices users configure). All of these support `json_schema` in non-thinking mode as of mid-2026.
- **Schema compatibility note**: OpenAI's strict json_schema mode requires `additionalProperties: false` and all properties listed in `required`. PA's zod schema has `optional()` fields (`related_notes`, `overall_remark`). LangChain's `@langchain/openai` automatically transforms zod schemas for strict mode compliance (converting optional fields to nullable `anyOf` unions), so this should be handled transparently. However, if a specific DashScope model version does not implement the full OpenAI json_schema spec (e.g., does not handle `anyOf` nullable patterns), the structured path will throw and fall through to JSON-mode fallback -- which is the intended behavior.
- **Recommendation**: **Use native structured output as primary path** for the mainstream Qwen models listed above. The fallback parser provides adequate coverage for edge cases and older models.

### Bailian

- **Relationship to DashScope**: Bailian (百炼) is Alibaba Cloud's AI model platform. As of 2025-2026, Bailian and DashScope share the same backend API infrastructure. The DashScope OpenAI-compatible endpoint IS the Bailian API endpoint -- they are the same service under different branding.
- **LangChain integration class**: Same as Qwen/DashScope -- `ChatOpenAI` with DashScope base URL.
- **`withStructuredOutput` support**: **Same as Qwen/DashScope** (identical API surface).
- **`response_format: json_schema` support**: **Same as Qwen/DashScope** (same backend).
- **JSON mode (`response_format: json_object`)**: **Same as Qwen/DashScope**.
- **Models applicable**: Same model catalog -- Bailian provides access to Qwen models plus third-party models (DeepSeek, GLM, Kimi, MiniMax) through the same DashScope endpoint.
- **Third-party models on Bailian**: When users access DeepSeek-V3/R1, GLM, Kimi, or MiniMax through Bailian's DashScope endpoint, json_schema support depends on whether DashScope passes through the `response_format` parameter to the underlying model. For Qwen-native models this is reliable; for third-party models, json_object mode is likely supported but json_schema may be silently ignored or cause errors.
- **Recommendation**: **Treat identically to Qwen/DashScope**. For third-party models accessed through Bailian, expect the fallback parser to be the primary path.

### OpenAI-compatible (DeepSeek, Groq, Together, etc.)

- **LangChain integration class**: `ChatOpenAI` from `@langchain/openai`, configured with each provider's base URL.
- **`withStructuredOutput` support**: **Yes** -- `ChatOpenAI` exposes the method regardless of backend.

#### DeepSeek (direct API at api.deepseek.com)

- **`response_format: json_schema` support**: **No / Limited**. DeepSeek's native API does not implement OpenAI's strict json_schema mode. The official DeepSeek API docs do not document `response_format: { type: "json_schema" }`.
- **JSON mode (`response_format: json_object`)**: **Yes** for DeepSeek-V3-0324+, DeepSeek-R1+, DeepSeek-V4+. Guarantees valid JSON but no schema enforcement.
- **Function calling**: Supported on newer models, but `withStructuredOutput` with `method: "json_schema"` will likely fail. Falling back to `method: "function_calling"` might work, but PA hardcodes `"json_schema"`.
- **Recommendation**: **Fallback parser will be the primary path** for direct DeepSeek API usage. If PA users connect to DeepSeek directly (not via DashScope), expect the structured output path to fail and fall through to JSON-mode. The fallback path is adequate.

#### DeepSeek (via DashScope)

- Many PA users access DeepSeek models through DashScope's model catalog (e.g., `deepseek-v3`, `deepseek-r1` listed in `DASHSCOPE_NATIVE_TOOL_CALLING_MODELS` in `src/ai-services/ai-utils.ts`).
- DashScope may or may not pass through `json_schema` response_format to DeepSeek models. The safer assumption is json_object mode works but json_schema does not.
- **Recommendation**: Same as direct DeepSeek -- fallback parser as primary path.

#### Groq

- **`json_schema` support**: Generally supported for models hosted on Groq (Llama, Mixtral, Gemma). Groq's OpenAI-compatible API implements structured output.
- **Recommendation**: Native structured output likely works. Not a primary PA target but should work if configured.

#### Together AI

- **`json_schema` support**: Supported for select models via their OpenAI-compatible API.
- **Recommendation**: Native structured output likely works for supported models.

#### General OpenAI-compatible

- Any OpenAI-compatible endpoint that implements the `response_format: { type: "json_schema" }` spec will work with PA's structured output path.
- Endpoints that only support `json_object` or no response_format at all will fall through to the JSON-mode fallback -- which is the designed behavior.

## Compatibility Matrix (updated from SDD S4.2)

| Provider | `withStructuredOutput` | JSON schema mode | JSON object mode | Fallback parser needed? |
|----------|----------------------|------------------|------------------|------------------------|
| Qwen/DashScope (qwen3.5+, qwen-max/plus/flash/turbo, non-thinking) | Yes (ChatOpenAI) | Yes | Yes | Safety net only |
| Qwen/DashScope (older models, thinking mode) | Yes (method exists) | No | Yes | Yes, as primary path |
| Bailian (Qwen models) | Same as DashScope | Same as DashScope | Same as DashScope | Same as DashScope |
| Bailian (third-party: DeepSeek, GLM, etc.) | Yes (method exists) | Unlikely | Likely | Yes, as primary path |
| DeepSeek (direct API) | Yes (method exists) | No | Yes (V3+/R1+) | Yes, as primary path |
| OpenAI (native) | Yes | Yes | Yes | Safety net only |
| Groq | Yes | Likely | Yes | Safety net only |
| Together AI | Yes | Partial | Yes | Conditional |

## Impact on Pagelet

### Current fallback path adequacy

The hand-written JSON parser in `pa-review-model.ts` (the `runWithJsonMode` method) is comprehensive and well-designed:

1. **System prompt augmentation**: Appends the schema hint (field names, types, constraints) to the system prompt via `buildJsonModeSchemaHint()`.
2. **Tolerant extraction**: `extractJsonPayload()` handles code fences, leading/trailing text, and finds balanced `{...}` blocks.
3. **Tolerant parsing**: `tolerantJsonParse()` strips trailing commas (a common LLM artifact) before `JSON.parse`.
4. **Schema repair**: `stampDefaultSchemaVersion()` adds missing `schema_version: 1` before validation.
5. **Over-length truncation**: `truncateOverlongFields()` clips fields to schema limits before zod runs.
6. **Source-id filtering**: `filterSuggestionsBySourceIds()` drops suggestions with invalid source_ids.
7. **Corrective retry**: On schema validation failure, appends error details to the prompt and retries once.
8. **Partial success**: Valid suggestions are kept even if some are dropped.

This fallback path is sufficient as the primary path for providers that lack json_schema support. The schema is simple enough (a flat object with one nested array of objects) that well-instructed models produce compliant JSON consistently.

### Schema hit rate expectation

| Provider path | Estimated schema compliance rate (without retries) | With 1 corrective retry |
|---------------|---------------------------------------------------|------------------------|
| Qwen (json_schema native) | ~99% (schema-enforced by API) | ~99.9% |
| Qwen (json_object fallback) | ~90-95% (prompt-guided, valid JSON guaranteed) | ~97-99% |
| DeepSeek (json_object) | ~85-92% (good instruction following, valid JSON) | ~95-98% |
| DeepSeek (free-form fallback) | ~80-90% (no JSON guarantee from API) | ~92-96% |

Note: These are estimated rates based on model instruction-following quality and the schema's complexity. Actual rates require live API testing (deferred -- see Residual Risks).

### Recommendation

**(A) Proceed with current dual-path architecture.**

Rationale:
- The structured output path (`withStructuredOutput` with `json_schema`) will work natively for the most common PA configurations (Qwen qwen-plus/qwen-max/qwen-turbo/qwen-flash through DashScope).
- The fallback path is robust and covers all remaining providers.
- The `disableStructuredOutput` option in `PageletReviewModelOptions` allows per-provider opt-out if a specific model's json_schema implementation proves unreliable in practice.
- No redesign (option B / D026 reopen) is needed.

Minor follow-up items (non-blocking):
1. **Consider adding `method: "function_calling"` as an intermediate fallback** between json_schema and free-form. Some providers that fail on json_schema may succeed with function_calling. This is a small code change in `runStructured()` but is not required for v1 beta.
2. **Document the `disableStructuredOutput` option** in Pagelet settings or a provider-specific config, so advanced users can force fallback mode for problematic providers.
3. **Live API testing** (originally planned as the main OQ002 deliverable) should be done as part of beta testing. The automated test matrix is: 5 models x 3 review samples = 15 calls. This can piggyback on existing beta QA.

## Residual risks

1. **No live API testing performed**: This spike is based on documentation review and code analysis only. Actual schema compliance rates are estimated, not measured. Live testing with real API keys is needed to validate, but can be done during beta QA rather than blocking the beta release.
2. **DashScope json_schema spec fidelity**: DashScope's json_schema implementation may not match OpenAI's spec exactly (e.g., handling of `anyOf` nullable patterns for optional fields). If LangChain's automatic schema transformation produces a json_schema that DashScope cannot parse, the structured path will fail silently and fall through to fallback -- which is safe but suboptimal.
3. **Third-party models on DashScope**: When users configure DeepSeek, GLM, Kimi, or MiniMax models through DashScope's catalog, the json_schema passthrough behavior is undocumented. The fallback parser will handle these, but the user experience (slightly higher latency from retry) is degraded.
4. **LangChain version sensitivity**: `@langchain/openai` v1.4.4's zod-to-json-schema transformation may evolve in future versions. Pin the dependency version for v1 beta stability.
5. **Thinking mode interaction**: If a user enables thinking mode (`enable_thinking: true`) through Qwen request options, json_schema is unavailable. The Pagelet path does not use thinking mode (temperature 0.2, no `enableThinking`), but if this changes in the future, the code must detect thinking mode and skip structured output.

# SDD: Type A LLM User Profile Extraction

**Status:** `[A]` Approved
**SPEC:** SPEC-E5
**Phase:** v2.5

---

## 1. Context

Type A user profile extraction currently uses regex pattern matching (explicit "I prefer"/"remember" + corrections "don't"/"instead"). This captures only explicit user statements. LLM extraction enables inferring behavioral patterns that users never explicitly state.

## 2. Design

### 2.1 Extraction Prompt

System prompt instructs the LLM to extract structured user preferences from conversation turns:

```
Analyze the following conversation and extract user preferences, corrections, and behavioral patterns.
Return ONLY valid JSON: {"extractions":[{"text":"<preference>","kind":"user_explicit|user_correction|inferred_behavior","confidence":"high|medium|low"}]}
Rules:
- user_explicit: user directly states a preference ("I prefer", "remember", "I like")
- user_correction: user corrects the AI ("no not that", "don't", "instead")
- inferred_behavior: observed pattern the user hasn't explicitly stated
- Only extract clear, actionable preferences, not general discussion topics
- Produce at most 5 extractions per batch
- confidence: high for direct statements, medium for strong patterns, low for weak signals
```

### 2.2 Input Truncation

Each extraction call sends the most recent N turns (from `TypeAExtractionInput.turns`), truncated to ~2000 chars of user+assistant text. This keeps the LLM call under ~1000 input tokens.

### 2.3 Model Selection

Use the same model creation path as Pagelet foreground review (`createChatModel(0, { maxTokens: 256 })`). Temperature 0 for deterministic extraction.

### 2.4 Cost Disclosure (must-fix from Review U3)

Update i18n strings to explicitly mention API calls:
- `plugin.memoryExtraction.enabledNotice`: add "Uses your AI model for background analysis"
- `plugin.memoryExtraction.settings.enabled.desc`: add "which incurs API costs"

### 2.5 Fallback

If LLM call fails (timeout, API error, invalid JSON), fall back to regex extraction. The existing `extractCandidatesFromText` is preserved as fallback.

### 2.6 Mobile Idle Guard (from Review P4)

Before triggering LLM extraction, check `document.visibilityState`. If hidden on mobile, skip/defer extraction.

### 2.7 IndexedDB Schema

No migration needed. LLM-extracted candidates use the same `UserProfileCandidate` type and `UserProfileRecord` storage. The `kind: "inferred_behavior"` is already defined in the type.

## 3. Implementation

### 3.1 New method on TypeAUserProfileExtractor

`extractCandidatesWithLLM(input, invoke)` — accepts turns + an LLM invoke function. Returns `UserProfileCandidate[]`. Falls back to regex on error.

### 3.2 Scheduler changes

`MemoryExtractionSchedulerOptions` gains optional `createModel` callback. `runTypeAExtraction()` tries LLM path first, falls back to regex.

## 4. Files

| File | Change |
|------|--------|
| `src/ai-services/memory-extraction/type-a-extractor.ts` | New `extractCandidatesWithLLM()` |
| `src/ai-services/memory-extraction/extraction-scheduler.ts` | LLM path + mobile guard + createModel option |
| `src/plugin.ts` | Pass `createModel` to scheduler |
| `src/locales/plugin/en.json` + `zh.json` | Update consent i18n |

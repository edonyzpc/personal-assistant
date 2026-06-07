import { describe, it, expect } from "@jest/globals";

import {
    FEW_SHOT_EN,
    FEW_SHOT_ZH,
    PAGELET_DEFAULT_TARGET_SUGGESTIONS,
    PAGELET_FIELD_LIMITS,
    PAGELET_SCHEMA_VERSION,
    PageletReviewInputSchema,
    PageletReviewMetadataSchema,
    PageletReviewResultSchema,
    PageletStructuredReviewResultSchema,
    PageletSuggestionSchema,
    buildJsonModeSchemaHint,
    buildSystemPrompt,
    buildUserPrompt,
    extractJsonPayload,
    filterSuggestionsBySourceIds,
    resolvePageletTargetSuggestionCount,
    summarizeZodIssues,
    tolerantJsonParse,
    truncateOverlongFields,
} from "../src/pagelet/pa-review-schemas";

// Re-usable helpers for building "valid by construction" fixtures so each
// test only asserts the boundary it cares about.
function validSuggestion(overrides: Record<string, unknown> = {}) {
    return {
        source_id: "seg-1",
        kind: "clarify" as const,
        rationale: "needs a clearer scope statement to help the reader",
        proposed_action: "add a one-sentence scope note after the opening line",
        ...overrides,
    };
}

function validResult(overrides: Record<string, unknown> = {}) {
    return {
        schema_version: PAGELET_SCHEMA_VERSION,
        detected_language: "en" as const,
        suggestions: [validSuggestion()],
        ...overrides,
    };
}

describe("PageletSuggestionSchema", () => {
    it("accepts a minimal valid suggestion", () => {
        expect(() => PageletSuggestionSchema.parse(validSuggestion())).not.toThrow();
    });

    it("rejects unknown suggestion kinds", () => {
        // Catches the SDD §4 contract that kind ∈ {clarify, expand, link, trim, evidence}.
        // The strict enum is what lets the SuggestionCard renderer (B2) switch on kind
        // without a default branch, so any silent enum drift here would cascade into UI bugs.
        const result = PageletSuggestionSchema.safeParse(validSuggestion({ kind: "rewrite" }));
        expect(result.success).toBe(false);
    });

    it("rejects empty source_id (SDD §4.1 source-id strong constraint)", () => {
        const result = PageletSuggestionSchema.safeParse(validSuggestion({ source_id: "" }));
        expect(result.success).toBe(false);
    });

    it("rejects too-short rationale", () => {
        const result = PageletSuggestionSchema.safeParse(validSuggestion({ rationale: "tiny" }));
        expect(result.success).toBe(false);
    });

    it("rejects too-long rationale", () => {
        const result = PageletSuggestionSchema.safeParse(
            validSuggestion({ rationale: "a".repeat(PAGELET_FIELD_LIMITS.rationaleMax + 1) }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects too-long proposed_action", () => {
        const result = PageletSuggestionSchema.safeParse(
            validSuggestion({ proposed_action: "x".repeat(PAGELET_FIELD_LIMITS.proposedActionMax + 1) }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects related_notes beyond the size cap", () => {
        const tooMany = Array.from(
            { length: PAGELET_FIELD_LIMITS.relatedNotesMax + 1 },
            (_, i) => `note-${i}`,
        );
        const result = PageletSuggestionSchema.safeParse(
            validSuggestion({ related_notes: tooMany }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects extra unknown fields (strict schema)", () => {
        // Strictness matters: if an LLM hallucinates an extra `severity` field we want a
        // validation error rather than silently dropping the data, because downstream tasks
        // (file IO, SuggestionCard) iterate keys and would otherwise leak unsanitized values.
        const result = PageletSuggestionSchema.safeParse(
            validSuggestion({ severity: "high" }),
        );
        expect(result.success).toBe(false);
    });
});

describe("PageletReviewResultSchema", () => {
    it("accepts a minimal valid review result", () => {
        expect(() => PageletReviewResultSchema.parse(validResult())).not.toThrow();
    });

    it("requires schema_version === 1", () => {
        // Literal-typed version field guards the v1 -> v2 migration path; any v2 SDD must
        // bump this literal so legacy callers can refuse new payloads loud rather than
        // silently misinterpreting them.
        const result = PageletReviewResultSchema.safeParse(validResult({ schema_version: 2 }));
        expect(result.success).toBe(false);
    });

    it("rejects detected_language outside zh/en", () => {
        const result = PageletReviewResultSchema.safeParse(
            validResult({ detected_language: "ja" }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects suggestion arrays longer than the size cap", () => {
        const result = PageletReviewResultSchema.safeParse(
            validResult({
                suggestions: Array.from(
                    { length: PAGELET_FIELD_LIMITS.suggestionsMax + 1 },
                    () => validSuggestion(),
                ),
            }),
        );
        expect(result.success).toBe(false);
    });

    it("accepts empty suggestions[] (SDD §4.3 row 4: 'looks fine' state)", () => {
        // Empty suggestion list is a SUCCESS path, not an error, per failure-matrix row 4.
        // The model layer maps this to status="empty"; the schema must permit it so we
        // never tell the model "your perfect review is invalid, try again".
        const result = PageletReviewResultSchema.safeParse(validResult({ suggestions: [] }));
        expect(result.success).toBe(true);
    });
});

describe("PageletStructuredReviewResultSchema", () => {
    it("accepts provider strict payloads with nullable optional semantics", () => {
        const result = PageletStructuredReviewResultSchema.safeParse({
            schema_version: PAGELET_SCHEMA_VERSION,
            detected_language: "en",
            suggestions: [
                validSuggestion({ related_notes: null }),
            ],
            overall_remark: null,
        });
        expect(result.success).toBe(true);
    });

    it("requires fields that the runtime schema treats as optional", () => {
        const result = PageletStructuredReviewResultSchema.safeParse(validResult());
        expect(result.success).toBe(false);
        if (result.success) return;
        const issues = summarizeZodIssues(result.error).join("\n");
        expect(issues).toContain("related_notes");
        expect(issues).toContain("overall_remark");
    });
});

describe("PageletReviewInputSchema", () => {
    it("requires at least one segment (LLM needs source_ids to reference)", () => {
        const result = PageletReviewInputSchema.safeParse({
            notePath: "notes/a.md",
            noteContent: "body",
            detectedLanguage: "en",
            mode: "basic",
            segments: [],
        });
        expect(result.success).toBe(false);
    });

    it("accepts targetSuggestionCount within the schema hard cap", () => {
        const result = PageletReviewInputSchema.safeParse({
            notePath: "notes/a.md",
            noteContent: "body",
            detectedLanguage: "en",
            mode: "basic",
            segments: [{ id: "seg-1", content: "body" }],
            targetSuggestionCount: PAGELET_DEFAULT_TARGET_SUGGESTIONS,
        });
        expect(result.success).toBe(true);
    });

    it("rejects targetSuggestionCount above the schema hard cap", () => {
        const result = PageletReviewInputSchema.safeParse({
            notePath: "notes/a.md",
            noteContent: "body",
            detectedLanguage: "en",
            mode: "basic",
            segments: [{ id: "seg-1", content: "body" }],
            targetSuggestionCount: PAGELET_FIELD_LIMITS.suggestionsMax + 1,
        });
        expect(result.success).toBe(false);
    });
});

describe("PageletReviewMetadataSchema", () => {
    it("requires pagelet:true literal so other plugins can skip review notes", () => {
        const result = PageletReviewMetadataSchema.safeParse({
            pagelet: false,
            pagelet_schema_version: 1,
            pagelet_source: "notes/a.md",
            pagelet_created_at: "2026-06-02T10:23:45+08:00",
            pagelet_mode: "basic",
            pagelet_detected_language: "en",
        });
        expect(result.success).toBe(false);
    });
});

describe("buildSystemPrompt", () => {
    it("ends with a Chinese language directive when detected language is zh", () => {
        expect(buildSystemPrompt("zh")).toContain("Simplified Chinese");
    });

    it("ends with an English directive when detected language is en", () => {
        expect(buildSystemPrompt("en")).toContain("respond in English");
    });

    it("always asserts the source_id constraint", () => {
        // Source-id binding is the single hardest constraint for LLMs to follow because it
        // requires cross-referencing tool output. Asserting that the prompt always carries
        // the rule prevents future "shorter prompt" refactors from silently regressing the
        // failure-matrix row 2 (missing source_id) recovery rate.
        const enPrompt = buildSystemPrompt("en");
        expect(enPrompt).toContain("source_id");
    });
});

describe("buildUserPrompt", () => {
    it("includes the right-language few-shot pair", () => {
        const zh = buildUserPrompt({
            notePath: "notes/a.md",
            noteContent: "body",
            detectedLanguage: "zh",
            mode: "basic",
            segments: [{ id: "seg-1", content: "X" }],
        });
        expect(zh).toContain(FEW_SHOT_ZH.assistant);
        expect(zh).not.toContain(FEW_SHOT_EN.assistant);

        const en = buildUserPrompt({
            notePath: "notes/a.md",
            noteContent: "body",
            detectedLanguage: "en",
            mode: "basic",
            segments: [{ id: "seg-1", content: "X" }],
        });
        expect(en).toContain(FEW_SHOT_EN.assistant);
        expect(en).not.toContain(FEW_SHOT_ZH.assistant);
        expect(en).toContain(`Return at most ${PAGELET_DEFAULT_TARGET_SUGGESTIONS} suggestions`);
    });

    it("includes the requested target suggestion count", () => {
        const prompt = buildUserPrompt({
            notePath: "notes/a.md",
            noteContent: "body",
            detectedLanguage: "en",
            mode: "basic",
            targetSuggestionCount: 2,
            segments: [{ id: "seg-1", content: "X" }],
        });
        expect(prompt).toContain("Return at most 2 suggestions");
    });

    it("uses outputLanguageOverride instead of detectedLanguage when provided", () => {
        const prompt = buildUserPrompt({
            notePath: "notes/a.md",
            noteContent: "English source text",
            detectedLanguage: "en",
            outputLanguageOverride: "zh",
            mode: "basic",
            segments: [{ id: "seg-1", content: "English source text" }],
        });
        expect(prompt).toContain(FEW_SHOT_ZH.assistant);
        expect(prompt).not.toContain(FEW_SHOT_EN.assistant);
        expect(prompt).toContain("请基于上述片段生成 Pagelet review。");
        expect(prompt).toContain(`最多返回 ${PAGELET_DEFAULT_TARGET_SUGGESTIONS} 条建议`);
    });

    it("lists every segment id so the LLM can map source_id back", () => {
        const prompt = buildUserPrompt({
            notePath: "notes/a.md",
            noteContent: "body",
            detectedLanguage: "en",
            mode: "basic",
            segments: [
                { id: "seg-1", content: "first segment" },
                { id: "seg-2", content: "second segment" },
            ],
        });
        expect(prompt).toContain('"seg-1"');
        expect(prompt).toContain('"seg-2"');
    });
});

describe("buildJsonModeSchemaHint", () => {
    it("describes all required output keys for the prompt-engineered fallback", () => {
        const hint = buildJsonModeSchemaHint();
        // Asserting on every key catches the case where the schema gains a field and the
        // JSON-mode fallback prompt drifts out of sync, which would silently degrade fallback
        // quality even though happy-path tests still pass.
        expect(hint).toContain("schema_version");
        expect(hint).toContain("detected_language");
        expect(hint).toContain("suggestions");
        expect(hint).toContain("source_id");
        expect(hint).toContain("kind");
        expect(hint).toContain("rationale");
        expect(hint).toContain("proposed_action");
        expect(hint).toContain("related_notes");
        expect(hint).toContain("overall_remark");
        expect(hint).toContain("required, use []");
        expect(hint).toContain("required, use empty string");
    });
});

describe("resolvePageletTargetSuggestionCount", () => {
    it("defaults to the lightweight review target", () => {
        expect(resolvePageletTargetSuggestionCount(undefined)).toBe(
            PAGELET_DEFAULT_TARGET_SUGGESTIONS,
        );
    });

    it("clamps callers to the schema hard cap", () => {
        expect(resolvePageletTargetSuggestionCount(PAGELET_FIELD_LIMITS.suggestionsMax + 5))
            .toBe(PAGELET_FIELD_LIMITS.suggestionsMax);
        expect(resolvePageletTargetSuggestionCount(0)).toBe(1);
    });
});

describe("extractJsonPayload", () => {
    it("strips ```json fences", () => {
        expect(extractJsonPayload('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it("strips plain ``` fences", () => {
        expect(extractJsonPayload('```\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it("returns the first balanced object inside surrounding text", () => {
        expect(extractJsonPayload('prefix {"a":1, "b":{"c":2}} suffix')).toBe('{"a":1, "b":{"c":2}}');
    });

    it("returns null when no object is present", () => {
        expect(extractJsonPayload("just prose")).toBeNull();
    });
});

describe("tolerantJsonParse", () => {
    it("parses standard JSON", () => {
        expect(tolerantJsonParse('{"a":1}')).toEqual({ a: 1 });
    });

    it("recovers from trailing commas (common LLM artefact)", () => {
        expect(tolerantJsonParse('{"a":1,}')).toEqual({ a: 1 });
    });

    it("returns null on unrecoverable input", () => {
        expect(tolerantJsonParse("not json at all")).toBeNull();
    });
});

describe("truncateOverlongFields", () => {
    it("truncates overlong rationale + proposed_action + overall_remark", () => {
        const { payload, truncated } = truncateOverlongFields({
            schema_version: 1,
            detected_language: "en",
            overall_remark: "x".repeat(PAGELET_FIELD_LIMITS.overallRemarkMax + 50),
            suggestions: [
                {
                    source_id: "seg-1",
                    kind: "clarify",
                    rationale: "r".repeat(PAGELET_FIELD_LIMITS.rationaleMax + 100),
                    proposed_action: "p".repeat(PAGELET_FIELD_LIMITS.proposedActionMax + 100),
                },
            ],
        });
        expect(truncated).toBe(true);
        const obj = payload as {
            overall_remark: string;
            suggestions: Array<{ rationale: string; proposed_action: string }>;
        };
        expect(obj.overall_remark.length).toBe(PAGELET_FIELD_LIMITS.overallRemarkMax);
        expect(obj.suggestions[0].rationale.length).toBe(PAGELET_FIELD_LIMITS.rationaleMax);
        expect(obj.suggestions[0].proposed_action.length).toBe(PAGELET_FIELD_LIMITS.proposedActionMax);
    });

    it("caps suggestions[] length", () => {
        const tooMany = Array.from(
            { length: PAGELET_FIELD_LIMITS.suggestionsMax + 3 },
            () => validSuggestion(),
        );
        const { payload, truncated } = truncateOverlongFields({ suggestions: tooMany });
        expect(truncated).toBe(true);
        expect((payload as { suggestions: unknown[] }).suggestions.length).toBe(
            PAGELET_FIELD_LIMITS.suggestionsMax,
        );
    });

    it("returns truncated:false when nothing exceeds limits", () => {
        const { truncated } = truncateOverlongFields(validResult());
        expect(truncated).toBe(false);
    });

    it("is a no-op on non-object payloads", () => {
        expect(truncateOverlongFields(null).truncated).toBe(false);
        expect(truncateOverlongFields("string").truncated).toBe(false);
    });
});

describe("filterSuggestionsBySourceIds", () => {
    it("drops suggestions whose source_id is not in the allowed set", () => {
        const result = filterSuggestionsBySourceIds(
            [
                validSuggestion({ source_id: "seg-1" }),
                validSuggestion({ source_id: "seg-bogus" }),
            ],
            ["seg-1"],
        );
        expect(result.suggestions).toHaveLength(1);
        expect(result.droppedCount).toBe(1);
        expect(result.suggestions[0].source_id).toBe("seg-1");
    });

    it("returns droppedCount=0 when every id is valid", () => {
        const result = filterSuggestionsBySourceIds(
            [validSuggestion({ source_id: "seg-1" })],
            ["seg-1", "seg-2"],
        );
        expect(result.droppedCount).toBe(0);
    });
});

describe("summarizeZodIssues", () => {
    it("turns ZodError-shaped objects into a flat string list", () => {
        const result = PageletSuggestionSchema.safeParse({ source_id: "", kind: "junk" });
        expect(result.success).toBe(false);
        if (result.success) return;
        const issues = summarizeZodIssues(result.error);
        // Should mention both the source_id and kind problems so a retry prompt can list them.
        expect(issues.length).toBeGreaterThanOrEqual(1);
        expect(issues.join(" ")).toMatch(/source_id|kind/);
    });

    it("falls back gracefully on unknown error shapes", () => {
        expect(summarizeZodIssues("not an object")).toEqual(["unknown parse error"]);
        expect(summarizeZodIssues(null)).toEqual(["unknown parse error"]);
    });
});

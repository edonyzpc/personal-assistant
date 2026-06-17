/* Copyright 2023 edonyzpc */

/**
 * Pagelet — structured output schemas.
 *
 * Spec source: `docs/review-assistant-sdd.md` §4 + D026 in
 * `docs/review-assistant-decisions.md`.
 *
 * What lives here:
 *  - zod schemas describing the LLM-facing review output contract
 *  - a thin, schema-aligned input descriptor used by `pa-review-model.ts`
 *  - prompt-fragment helpers (system prompt, few-shot, JSON-mode fallback)
 *
 * What does NOT live here:
 *  - LLM invocation / fallback orchestration → `pa-review-model.ts` (B1)
 *  - file-IO (`.pagelet/...` frontmatter / persistence) → B6
 *  - cost ceiling, rate limiting, language detection → other B-track files
 *
 * Design notes:
 *  - The 5-field `PageletSuggestionSchema` is the "5 区块" structure the task
 *    description refers to: source_id / kind / rationale / proposed_action /
 *    related_notes. These map 1:1 to the SuggestionCard rendering contract
 *    that B2 will consume.
 *  - All schemas are exported as both runtime values (for zod use) and
 *    inferred types (for TS consumers) so downstream B-tasks don't need to
 *    re-declare types.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants — kept exported so tests and downstream B-tasks can reuse limits
// without parsing zod ZodType internals.
// ---------------------------------------------------------------------------

/** Allowed `detected_language` literals (D015 / D017). */
export const PAGELET_LANGUAGE_CODES = ["zh", "en"] as const;
export type PageletLanguageCode = (typeof PAGELET_LANGUAGE_CODES)[number];

/** Allowed `kind` literals; mirrors product-design "5 suggestion kinds". */
export const PAGELET_SUGGESTION_KINDS = [
    "clarify",
    "expand",
    "link",
    "trim",
    "evidence",
] as const;
export type PageletSuggestionKind = (typeof PAGELET_SUGGESTION_KINDS)[number];

/** Currently the only supported schema version; bump when the shape changes. */
export const PAGELET_SCHEMA_VERSION = 1 as const;

/**
 * Field length limits. The same numbers appear in SDD §4.1 and are referenced
 * by the over-length fallback in `pa-review-model.ts`. Centralising them here
 * means a future schema bump only touches one file.
 */
export const PAGELET_FIELD_LIMITS = {
    rationaleMin: 8,
    rationaleMax: 280,
    proposedActionMin: 8,
    proposedActionMax: 500,
    overallRemarkMax: 280,
    relatedNotesMax: 5,
    suggestionsMax: 8,
    sourceIdMin: 1,
} as const;

/**
 * Default review target after the latency instrumentation pass. The schema
 * hard cap remains 8 for compatibility, but production prompts should ask for
 * fewer high-signal suggestions first so small notes don't pay for verbose
 * output by default.
 */
export const PAGELET_DEFAULT_TARGET_SUGGESTIONS = 3;

// ---------------------------------------------------------------------------
// Output schemas — what the LLM is expected to emit.
// ---------------------------------------------------------------------------

/**
 * A single review suggestion. Mirrors SDD §4.1.
 *
 * The schema is intentionally strict (no passthrough) because the LLM is
 * supposed to ONLY return these fields; any extra keys are a contract
 * violation worth surfacing.
 */
export const PageletSuggestionSchema = z
    .object({
        /** MUST equal one of the segment ids handed to the LLM via tools. */
        source_id: z
            .string()
            .min(
                PAGELET_FIELD_LIMITS.sourceIdMin,
                "source_id must be a non-empty string matching a provided segment id",
            ),
        kind: z.enum(PAGELET_SUGGESTION_KINDS),
        rationale: z
            .string()
            .min(PAGELET_FIELD_LIMITS.rationaleMin)
            .max(PAGELET_FIELD_LIMITS.rationaleMax),
        proposed_action: z
            .string()
            .min(PAGELET_FIELD_LIMITS.proposedActionMin)
            .max(PAGELET_FIELD_LIMITS.proposedActionMax),
        related_notes: z
            .array(z.string())
            .max(PAGELET_FIELD_LIMITS.relatedNotesMax)
            .optional(),
    })
    .strict();
export type PageletSuggestion = z.infer<typeof PageletSuggestionSchema>;

/**
 * Provider-facing strict structured-output schema.
 *
 * OpenAI-compatible strict JSON Schema providers require object fields to be
 * present; optional semantics must be represented as nullable values instead
 * of omitted properties. Keep this separate from the runtime schema above so
 * Pagelet can still parse older/fallback payloads that omit optional fields.
 */
export const PageletStructuredSuggestionSchema = z
    .object({
        source_id: z
            .string()
            .min(
                PAGELET_FIELD_LIMITS.sourceIdMin,
                "source_id must be a non-empty string matching a provided segment id",
            ),
        kind: z.enum(PAGELET_SUGGESTION_KINDS),
        rationale: z
            .string()
            .min(PAGELET_FIELD_LIMITS.rationaleMin)
            .max(PAGELET_FIELD_LIMITS.rationaleMax),
        proposed_action: z
            .string()
            .min(PAGELET_FIELD_LIMITS.proposedActionMin)
            .max(PAGELET_FIELD_LIMITS.proposedActionMax),
        related_notes: z
            .array(z.string())
            .max(PAGELET_FIELD_LIMITS.relatedNotesMax)
            .nullable(),
    })
    .strict();

/**
 * Full review result envelope. Schema version is a discriminant for future
 * forward-compat work; literal schema version accepts literal `1`.
 */
export const PageletReviewResultSchema = z
    .object({
        schema_version: z.literal(PAGELET_SCHEMA_VERSION),
        detected_language: z.enum(PAGELET_LANGUAGE_CODES),
        suggestions: z
            .array(PageletSuggestionSchema)
            .max(PAGELET_FIELD_LIMITS.suggestionsMax),
        overall_remark: z
            .string()
            .max(PAGELET_FIELD_LIMITS.overallRemarkMax)
            .optional(),
    })
    .strict();
export type PageletReviewResult = z.infer<typeof PageletReviewResultSchema>;

export const PageletStructuredReviewResultSchema = z
    .object({
        schema_version: z.literal(PAGELET_SCHEMA_VERSION),
        detected_language: z.enum(PAGELET_LANGUAGE_CODES),
        suggestions: z
            .array(PageletStructuredSuggestionSchema)
            .max(PAGELET_FIELD_LIMITS.suggestionsMax),
        overall_remark: z
            .string()
            .max(PAGELET_FIELD_LIMITS.overallRemarkMax)
            .nullable(),
    })
    .strict();
export type PageletStructuredReviewResult = z.infer<typeof PageletStructuredReviewResultSchema>;

// ---------------------------------------------------------------------------
// Input descriptor — `pa-review-model.reviewNote()` accepts this shape.
// Kept as a zod schema so future callers can re-validate at runtime if they
// build inputs from untrusted UI state.
// ---------------------------------------------------------------------------

/**
 * One vault note segment the LLM may reference via `source_id`. The model
 * must echo this id back in every suggestion or that suggestion is dropped
 * (see `validateSuggestionsAgainstSegments` below).
 */
export const PageletSegmentSchema = z
    .object({
        id: z.string().min(1),
        content: z.string(),
    })
    .strict();
export type PageletSegment = z.infer<typeof PageletSegmentSchema>;

export const PageletRelatedNoteSchema = z
    .object({
        path: z.string().min(1),
        content: z.string(),
        score: z.number().optional(),
        headingPath: z.array(z.string()).optional(),
    })
    .strict();
export type PageletRelatedNote = z.infer<typeof PageletRelatedNoteSchema>;

/**
 * Input to `PageletReviewModel.reviewNote()`. Note: not strictly required to
 * be parsed at runtime — most callers will be internal — but having the
 * schema means tests + B6 file-IO can validate persisted snapshots cheaply.
 */
export const PageletReviewInputSchema = z
    .object({
        /** Path to the source note (used for diagnostics + frontmatter). */
        notePath: z.string().min(1),
        /** Already-truncated note content (see B4 token enforcement). */
        noteContent: z.string(),
        /** Output of `pa-review-language.detectNoteLanguage`. */
        detectedLanguage: z.enum(PAGELET_LANGUAGE_CODES),
        /** "basic" caps turns to 1; "deeper" allows the loop to iterate. */
        mode: z.enum(["basic", "deeper"]),
        /** Segments handed to the LLM as `read_source_note` tool output. */
        segments: z.array(PageletSegmentSchema).min(1),
        /** Semantic Memory matches from the wider vault, used only as related-note evidence. */
        relatedNotes: z.array(PageletRelatedNoteSchema).max(8).optional(),
        /** UI-language settings hint for tie-breaking in mascot copy. */
        uiLanguage: z.enum(PAGELET_LANGUAGE_CODES).optional(),
        /** Settings override; when set, language detection is bypassed. */
        outputLanguageOverride: z.enum(PAGELET_LANGUAGE_CODES).optional(),
        /** Soft target for model output; schema still enforces the hard max. */
        targetSuggestionCount: z
            .number()
            .int()
            .min(1)
            .max(PAGELET_FIELD_LIMITS.suggestionsMax)
            .optional(),
    })
    .strict();
export type PageletReviewInput = z.infer<typeof PageletReviewInputSchema>;

// ---------------------------------------------------------------------------
// Metadata schema — drives `.pagelet/...` frontmatter (consumed by B6 file IO)
// and the in-memory `PageletReviewOutcome.diagnostics.frontmatter` field.
// ---------------------------------------------------------------------------

/**
 * Frontmatter persisted alongside review notes (SDD §5.3). Centralised here
 * so B6 file IO and tests share one source of truth.
 */
export const PageletReviewMetadataSchema = z
    .object({
        /** Constant `true`; lets sibling plugins skip the note (D029 M3). */
        pagelet: z.literal(true),
        pagelet_schema_version: z.literal(PAGELET_SCHEMA_VERSION),
        pagelet_source: z.string().min(1),
        /** ISO-8601 timestamp with offset. */
        pagelet_created_at: z.string().min(1),
        pagelet_mode: z.enum(["basic", "deeper"]),
        pagelet_cost_usd: z.number().nonnegative().optional(),
        pagelet_detected_language: z.enum(PAGELET_LANGUAGE_CODES),
        pagelet_provider: z.string().min(1).optional(),
        pagelet_model: z.string().min(1).optional(),
    })
    .strict();
export type PageletReviewMetadata = z.infer<typeof PageletReviewMetadataSchema>;

// ---------------------------------------------------------------------------
// Prompt fragments (D026.f: A+B mix = schema in system + few-shot in user).
// ---------------------------------------------------------------------------

/**
 * Static system-prompt scaffold. Language-specific instruction is appended
 * by `buildSystemPrompt` so the prompt template stays language-agnostic.
 *
 * Exported (rather than inlined) so a future B-task can swap the wording
 * without touching `pa-review-model.ts`.
 */
export const PAGELET_SYSTEM_PROMPT_BASE = [
    "You are Pagelet, a quiet reviewer for a user's Obsidian note.",
    "You receive segmented note content via the `read_source_note` tool; each segment has an `id`.",
    "Your job is to surface a small set of short suggestions that help the author improve the note.",
    "",
    "STRICT RULES:",
    "- Respond with a JSON object that strictly conforms to the provided schema; no prose outside JSON.",
    "- `schema_version` MUST equal 1.",
    "- Every suggestion's `source_id` MUST equal one of the segment ids you were given; do not invent ids.",
    "- `kind` MUST be one of: clarify, expand, link, trim, evidence.",
    "- Keep `rationale` <= 280 chars and `proposed_action` <= 500 chars.",
    "- Obey the requested suggestion target; never return more than 8 suggestions.",
    "- Return an empty `suggestions` array if the note is in good shape.",
    "- NEVER propose edits that change the original note in place; you only suggest.",
].join("\n");

/**
 * One few-shot per language (D026.f). Kept short on purpose: shipping
 * multiple few-shots would blow up token budget (D018) for marginal gain.
 */
export const FEW_SHOT_ZH = {
    user: [
        "Note (path: notes/concept-x.md), 2 segments:",
        '  - id: "seg-1": "概念 X 是一种用来组织笔记的方法。"',
        '  - id: "seg-2": "据说它源于卡片盒（Zettelkasten）。"',
        "Produce a Pagelet review.",
    ].join("\n"),
    assistant: JSON.stringify(
        {
            schema_version: 1,
            detected_language: "zh",
            suggestions: [
                {
                    source_id: "seg-1",
                    kind: "clarify",
                    rationale: "首句对概念 X 的定义偏窄，没有给出适用范围，读者难判断是否相关。",
                    proposed_action:
                        "在第 1 段后追加一句，说明概念 X 适用于哪种笔记场景，并补充一个最小可用示例。",
                    related_notes: [],
                },
                {
                    source_id: "seg-2",
                    kind: "evidence",
                    rationale: "声称源自卡片盒但无引用，缺失支撑会削弱说服力。",
                    proposed_action:
                        "在第 2 段补一条来源链接或书目（如 Luhmann 的卡片盒方法），可加入 [[Zettelkasten]] 双链。",
                    related_notes: [],
                },
            ],
            overall_remark: "结构清晰，但需要补充范围与来源以增强可信度。",
        },
        null,
        0,
    ),
};

export const FEW_SHOT_EN = {
    user: [
        "Note (path: notes/concept-x.md), 2 segments:",
        '  - id: "seg-1": "Concept X is a method for organizing notes."',
        '  - id: "seg-2": "It is said to originate from the Zettelkasten system."',
        "Produce a Pagelet review.",
    ].join("\n"),
    assistant: JSON.stringify(
        {
            schema_version: 1,
            detected_language: "en",
            suggestions: [
                {
                    source_id: "seg-1",
                    kind: "clarify",
                    rationale:
                        "The opening definition is narrow; readers can't tell when Concept X applies.",
                    proposed_action:
                        "After segment 1, add one sentence on scope and include a minimal worked example.",
                    related_notes: [],
                },
                {
                    source_id: "seg-2",
                    kind: "evidence",
                    rationale:
                        "Claims a Zettelkasten origin with no citation; unsupported claims weaken trust.",
                    proposed_action:
                        "Add a citation in segment 2 (e.g., Luhmann's Zettelkasten) and consider a [[Zettelkasten]] backlink.",
                    related_notes: [],
                },
            ],
            overall_remark: "Clear structure, but scope and sourcing need strengthening.",
        },
        null,
        0,
    ),
};

/**
 * Build the system prompt for a given detected language. The runtime
 * instruction is intentionally short and tail-positioned so it overrides any
 * earlier language drift in long contexts.
 */
export function buildSystemPrompt(language: PageletLanguageCode): string {
    const tail =
        language === "zh"
            ? "IMPORTANT: respond in Simplified Chinese. The `detected_language` field MUST equal \"zh\"."
            : "IMPORTANT: respond in English. The `detected_language` field MUST equal \"en\".";
    return `${PAGELET_SYSTEM_PROMPT_BASE}\n\n${tail}`;
}

/**
 * Build the user-side prompt content (few-shot + actual note segments).
 *
 * The few-shot pair is appended in the conventional `User: ... / Assistant: ...`
 * format so a single user message keeps system prompt token cost flat.
 */
export function buildUserPrompt(input: PageletReviewInput): string {
    const outputLanguage = input.outputLanguageOverride ?? input.detectedLanguage;
    const fewShot = outputLanguage === "zh" ? FEW_SHOT_ZH : FEW_SHOT_EN;
    const targetSuggestionCount = resolvePageletTargetSuggestionCount(input.targetSuggestionCount);
    const segmentLines = input.segments
        .map((seg) => `  - id: "${seg.id}": ${JSON.stringify(seg.content)}`)
        .join("\n");
    const relatedNoteLines = (input.relatedNotes ?? [])
        .map((note, index) => {
            const heading = note.headingPath?.length ? ` (${note.headingPath.join(" > ")})` : "";
            return `  - related-${index + 1}: ${note.path}${heading}: ${JSON.stringify(note.content)}`;
        })
        .join("\n");
    const noteIntro = outputLanguage === "zh"
        ? `笔记路径：${input.notePath}，${input.segments.length} 个片段：`
        : `Note (path: ${input.notePath}), ${input.segments.length} segments:`;
    const closer = outputLanguage === "zh"
        ? "请基于上述片段生成 Pagelet review。"
        : "Produce a Pagelet review based on the segments above.";
    const targetInstruction = outputLanguage === "zh"
        ? `最多返回 ${targetSuggestionCount} 条建议；优先选择最重要、最可执行的问题。少于 ${targetSuggestionCount} 条或 0 条都可以。`
        : `Return at most ${targetSuggestionCount} suggestions; prioritize the most important, actionable issues. Fewer than ${targetSuggestionCount}, or zero, is fine.`;

    return [
        "Example:",
        `User: ${fewShot.user}`,
        `Assistant: ${fewShot.assistant}`,
        "",
        "Now produce a fresh review for the following note. Reuse none of the example content.",
        noteIntro,
        segmentLines,
        relatedNoteLines
            ? [
                "",
                "Semantic Memory matches from the wider vault. Use these only for connection/gap evidence and `related_notes`; do not use them as `source_id` values:",
                relatedNoteLines,
            ].join("\n")
            : "",
        "",
        targetInstruction,
        closer,
    ].join("\n");
}

export function resolvePageletTargetSuggestionCount(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return PAGELET_DEFAULT_TARGET_SUGGESTIONS;
    }
    return Math.min(
        PAGELET_FIELD_LIMITS.suggestionsMax,
        Math.max(1, Math.floor(value)),
    );
}

/**
 * Build a JSON-mode fallback prompt suffix — appended to the system prompt
 * when `withStructuredOutput` is unavailable (D026.b free-form fallback).
 * Inlining the JSON schema sketch nudges providers that don't honor
 * tool-call-style schema injection.
 */
export function buildJsonModeSchemaHint(): string {
    return [
        "",
        "Schema (informal):",
        "{",
        '  "schema_version": 1,',
        '  "detected_language": "zh" | "en",',
        '  "suggestions": [',
        "    {",
        '      "source_id": "<one of provided segment ids>",',
        '      "kind": "clarify"|"expand"|"link"|"trim"|"evidence",',
        '      "rationale": "<<=280 chars>",',
        '      "proposed_action": "<<=500 chars>",',
        '      "related_notes": ["<note-name>", ...]   // required, use [] when none, <=5',
        "    }",
        "  ],   // <=8 entries",
        '  "overall_remark": "<<=280 chars, required, use empty string when none>"',
        "}",
        "Return ONLY this JSON object. No code fences, no commentary.",
    ].join("\n");
}

// ---------------------------------------------------------------------------
// Helpers — used both by `pa-review-model.ts` and tests.
// ---------------------------------------------------------------------------

/**
 * Tolerant JSON extractor — strips ```json fences and finds the first
 * balanced `{...}` block. Used by the free-form fallback path in
 * `pa-review-model.ts`.
 *
 * Note: mirrors `service.ts`'s helper but is duplicated on purpose to keep
 * pagelet isolated from chat-service churn (and our file domain bans
 * touching ai-services).
 */
export function extractJsonPayload(raw: string): string | null {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) return fenced[1].trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

    const start = trimmed.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return trimmed.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * Tolerant JSON parser — strips trailing commas before delegating to
 * `JSON.parse`. Used by the free-form fallback. Returns `null` on failure.
 */
export function tolerantJsonParse(payload: string): unknown {
    try {
        return JSON.parse(payload);
    } catch {
        // Strip trailing commas (a common LLM artefact) and try once more.
        const stripped = payload.replace(/,(\s*[}\]])/g, "$1");
        try {
            return JSON.parse(stripped);
        } catch {
            return null;
        }
    }
}

/**
 * Apply over-length truncation (failure-matrix row 5) BEFORE running zod.
 *
 * Returns the mutated payload plus a list of fields that were truncated.
 * The caller surfaces `truncated: true` in diagnostics so the UI can render
 * a "shortened by Pagelet" badge.
 */
export interface TruncationResult {
    payload: unknown;
    truncated: boolean;
}

export function truncateOverlongFields(payload: unknown): TruncationResult {
    if (!payload || typeof payload !== "object") return { payload, truncated: false };
    const root = { ...payload } as Record<string, unknown>;
    if (Array.isArray(root.suggestions)) {
        root.suggestions = root.suggestions.map((s: unknown) =>
            s && typeof s === "object" ? { ...s as object } : s,
        );
    }
    let truncated = false;

    if (
        typeof root.overall_remark === "string"
        && root.overall_remark.length > PAGELET_FIELD_LIMITS.overallRemarkMax
    ) {
        root.overall_remark = root.overall_remark.slice(
            0,
            PAGELET_FIELD_LIMITS.overallRemarkMax,
        );
        truncated = true;
    }

    if (Array.isArray(root.suggestions)) {
        if (root.suggestions.length > PAGELET_FIELD_LIMITS.suggestionsMax) {
            root.suggestions = root.suggestions.slice(0, PAGELET_FIELD_LIMITS.suggestionsMax);
            truncated = true;
        }
        for (const suggestion of root.suggestions as unknown[]) {
            if (!suggestion || typeof suggestion !== "object") continue;
            const s = suggestion as Record<string, unknown>;
            if (typeof s.rationale === "string" && s.rationale.length > PAGELET_FIELD_LIMITS.rationaleMax) {
                s.rationale = s.rationale.slice(0, PAGELET_FIELD_LIMITS.rationaleMax);
                truncated = true;
            }
            if (
                typeof s.proposed_action === "string"
                && s.proposed_action.length > PAGELET_FIELD_LIMITS.proposedActionMax
            ) {
                s.proposed_action = s.proposed_action.slice(
                    0,
                    PAGELET_FIELD_LIMITS.proposedActionMax,
                );
                truncated = true;
            }
            if (
                Array.isArray(s.related_notes)
                && s.related_notes.length > PAGELET_FIELD_LIMITS.relatedNotesMax
            ) {
                s.related_notes = s.related_notes.slice(
                    0,
                    PAGELET_FIELD_LIMITS.relatedNotesMax,
                );
                truncated = true;
            }
        }
    }

    return { payload: root, truncated };
}

/**
 * Filter suggestions whose `source_id` does not match any known segment id.
 * Returns the filtered list and the count of dropped entries.
 *
 * Used by both the structured-output happy path (post-zod validation) and
 * the free-form fallback parser.
 */
export interface SourceIdFilterResult {
    suggestions: PageletSuggestion[];
    droppedCount: number;
}

export function filterSuggestionsBySourceIds(
    suggestions: readonly PageletSuggestion[],
    validIds: readonly string[],
): SourceIdFilterResult {
    const allowed = new Set(validIds);
    const filtered: PageletSuggestion[] = [];
    let droppedCount = 0;
    for (const suggestion of suggestions) {
        if (allowed.has(suggestion.source_id)) filtered.push(suggestion);
        else droppedCount += 1;
    }
    return { suggestions: filtered, droppedCount };
}

/**
 * Convert a `ZodError` into a flat list of human-readable issue strings.
 * Used in diagnostics and the corrective-retry prompt.
 */
export function summarizeZodIssues(error: unknown): string[] {
    if (!error || typeof error !== "object") return ["unknown parse error"];
    const issues = (error as { issues?: unknown }).issues;
    if (!Array.isArray(issues)) return [String((error as { message?: unknown }).message ?? error)];
    return issues.map((issue) => {
        const path = Array.isArray((issue as { path?: unknown[] }).path)
            ? (issue as { path: unknown[] }).path.join(".")
            : "";
        const msg = (issue as { message?: unknown }).message ?? "invalid";
        return path ? `${path}: ${msg}` : String(msg);
    });
}

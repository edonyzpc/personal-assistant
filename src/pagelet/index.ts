/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — public barrel.
 *
 * Track B1 surface only. Subsequent B-tasks (B2-B6) will add their own
 * exports here; keep this file thin and re-export only the types/values
 * downstream code (or Track C C1 wiring) is expected to consume.
 */

export {
    PageletReviewModel,
    reviewNote,
    type PageletChatModelFactory,
    type PageletChatModelLike,
    type PageletReviewDiagnostics,
    type PageletReviewErrorCode,
    type PageletReviewModelOptions,
    type PageletReviewOutcome,
    type PageletReviewPath,
} from "./pa-review-model";

export {
    FEW_SHOT_EN,
    FEW_SHOT_ZH,
    PAGELET_FIELD_LIMITS,
    PAGELET_LANGUAGE_CODES,
    PAGELET_SCHEMA_VERSION,
    PAGELET_SUGGESTION_KINDS,
    PAGELET_SYSTEM_PROMPT_BASE,
    PageletReviewInputSchema,
    PageletReviewMetadataSchema,
    PageletReviewResultSchema,
    PageletSegmentSchema,
    PageletSuggestionSchema,
    buildJsonModeSchemaHint,
    buildSystemPrompt,
    buildUserPrompt,
    extractJsonPayload,
    filterSuggestionsBySourceIds,
    summarizeZodIssues,
    tolerantJsonParse,
    truncateOverlongFields,
    type PageletLanguageCode,
    type PageletReviewInput,
    type PageletReviewMetadata,
    type PageletReviewResult,
    type PageletSegment,
    type PageletSuggestion,
    type PageletSuggestionKind,
    type SourceIdFilterResult,
    type TruncationResult,
} from "./pa-review-schemas";

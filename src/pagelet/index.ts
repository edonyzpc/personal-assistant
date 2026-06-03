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

export {
    PAGELET_DEFAULT_PRICING,
    PAGELET_TOKEN_LIMITS,
    PageletCostTracker,
    computeCost,
    estimateTokens,
    estimateTokensFor,
    formatUsd,
    lookupPricing,
    preCheckCost,
    pricingKey,
    type CostPreCheckDecision,
    type PageletCostBudget,
    type PageletCostEntry,
    type PageletCostRecordInput,
    type PageletCostSummary,
    type PageletCostTrackerOptions,
    type PageletPricingEntry,
} from "./pa-review-cost";

export {
    InMemoryRateLimitStorage,
    PAGELET_RATE_LIMIT_DEFAULTS,
    PageletRateLimiter,
    decide as decideRateLimit,
    prune as pruneRateLimitState,
    type PageletRateLimitConfig,
    type PageletRateLimitState,
    type PageletRateLimitStorage,
    type PageletRateLimiterOptions,
    type RateLimitDecision,
} from "./pa-review-rate-limit";

export {
    MAX_COLLISION_SUFFIX,
    PAGELET_DEFAULT_REVIEWS_FOLDER,
    PAGELET_FILENAME_INFIX,
    assembleReviewNote,
    buildReviewMetadata,
    formatPageletDate,
    formatPageletIsoTimestamp,
    normalizeReviewsFolder as normalizePageletReviewsFolder,
    renderReviewBody,
    resolveReviewNotePath,
    sanitizeSourceBaseName,
    serializeFrontmatter,
    writeReviewNote,
    type PageletReviewFileIOSettings,
    type PageletReviewIOAdapter,
    type PageletReviewVaultLike,
    type ResolveReviewNotePathInput,
    type WriteReviewNoteInput,
    type WriteReviewNoteResult,
} from "./pa-review-file-io";

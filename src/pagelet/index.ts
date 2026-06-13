/* Copyright 2023 edonyzpc */

/**
 * Pagelet public barrel.
 *
 * Keep this file thin and re-export only the types/values downstream code is
 * expected to consume.
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
    type PageletReviewProgressEvent,
    type PageletReviewProgressPhase,
    type PageletReviewTimingEntry,
} from "./pa-review-model";

export {
    FEW_SHOT_EN,
    FEW_SHOT_ZH,
    PAGELET_DEFAULT_TARGET_SUGGESTIONS,
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
    PageletStructuredReviewResultSchema,
    PageletStructuredSuggestionSchema,
    buildJsonModeSchemaHint,
    buildSystemPrompt,
    buildUserPrompt,
    extractJsonPayload,
    filterSuggestionsBySourceIds,
    resolvePageletTargetSuggestionCount,
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
    type PageletStructuredReviewResult,
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
    mintNonCollidingReviewNotePath,
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

export {
    PAGELET_APPROX_CHARS_PER_TOKEN,
    PAGELET_SCOPE_DEFAULT_MAX_INCLUDED,
    PAGELET_SEGMENT_TARGET_CHARS,
    applyPageletScopeToggle,
    buildPageletScopePlan,
    buildPageletScopeReviewBundle,
    rangeLabel,
    selectPageletScope,
    skippedReasonLabel,
    type BuildPageletScopePlanOptions,
    type BuildPageletScopeReviewBundleOptions,
    type PageletReviewRange,
    type PageletScopeCandidate,
    type PageletScopeCandidateReason,
    type PageletScopeFileLike,
    type PageletScopeMetadataLike,
    type PageletScopePlan,
    type PageletScopeReviewBundle,
    type PageletScopeSelection,
    type PageletScopeSkippedReason,
    type PageletScopeSourceReference,
} from "./scope";

// Write Action Framework capability + runtime composer.
export {
    PAGELET_PROVIDER_ID,
    PAGELET_WRITE_REVIEW_OUTPUT_NAME,
    createPaReviewToolProvider,
    createPaReviewToolProviderForApp,
    type CreatePaReviewToolProviderOptions,
    type PageletReviewToolSettings,
    type PageletReviewToolVaultLike,
    type PageletWriteReviewOutputInput,
    type PaReviewToolProvider,
} from "./pa-review-tool-provider";

export {
    SELF_WRITE_WINDOW_MS as PAGELET_SELF_WRITE_WINDOW_MS,
    createPaReviewRuntime,
    type CreatePaReviewRuntimeOptions,
    type PaReviewPaAgentOptionsBundle,
    type PaReviewRuntime,
} from "./pa-review-runtime";

export {
    PAGELET_DEFAULT_DEBOUNCE_MS,
    PAGELET_DEFAULT_IDEMPOTENCY_TTL_MS,
    PAGELET_ELIGIBLE_VIEW_TYPE,
    PAGELET_FOCUS_LATEST_COMMAND_ID,
    PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY,
    PAGELET_FOCUSABLE_SELECTORS,
    PAGELET_SUGGESTION_CARD_CLASS,
    PageletCoalescerClearedError,
    PageletReviewCoalescer,
    findFirstFocusableInCard,
    findFirstSuggestionCard,
    findFocusTargetForCommand,
    getActiveMarkdownView,
    isPageletEligibleView,
    registerPageletFocusCommand,
    type PageletCoalescerEntrySnapshot,
    type PageletCoalescerOptions,
    type PageletCommandDefinition,
    type PageletCommandHost,
    type PageletFocusableElement,
    type PageletHotkey,
    type PageletQueryRoot,
    type PageletReviewKey,
    type PageletObsidianViewProbe,
    type PageletWorkspaceLike,
    type RegisterPageletFocusCommandOptions,
} from "./compat";

export { PetView, PetStateMachine, buildPetSvg, updatePetSvgState } from "./pet";
export type { PetState, PetCorner, PetEvent, PetCallbacks, PetRenderer, PetRendererOptions, PetStateListener } from "./pet";

export { BubbleView, buildQuickReviewContent, buildWritingAssistContent, buildDiscoveryContent, buildNudgeContent, buildEmptyContent } from "./bubble";
export type { BubbleState, BubbleContentType, BubbleFinding, BubbleContent, BubbleAction, BubbleCallbacks, BubbleViewOptions } from "./bubble";

export { PreloadEngine, PreloadCache, PreloadBudget } from "./preload";
export type { PreloadFinding, PreloadResult, PreloadCacheEntry, PreloadConfig, PreloadErrorCategory, PreloadEvent, AnalyzeCallback } from "./preload";

export { ScopeResolver, ChangeDetector } from "./scope/index";
export type { ScopeCandidate, ExclusionReason, ScopeResult, ScopeConfig } from "./scope/index";

export { ProactiveHints } from "./hints";
export type { ProactiveHintsConfig } from "./hints";

export { ReviewNoteGenerator } from "./output";
export type { PeriodicSummaryInput, GeneratedReviewNote, GenerateCallback, WriteResult } from "./output";

export { registerPageletCommands, PAGELET_OPEN_PANEL_COMMAND_ID, PAGELET_REVIEW_CURRENT_COMMAND_ID, PAGELET_QUICK_REVIEW_COMMAND_ID, PAGELET_DISCOVER_COMMAND_ID, PAGELET_PERIODIC_SUMMARY_COMMAND_ID, PAGELET_TOGGLE_HINTS_COMMAND_ID, PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID, PAGELET_MOVE_PET_COMMAND_ID, PAGELET_TOGGLE_PET_COMMAND_ID } from "./commands";
export type { PageletCommandCallbacks } from "./commands";

export { PageletOrchestrator } from "./orchestrator";
export type { PageletHost } from "./orchestrator";

export {
    buildPreloadPrompt,
    buildQuickReviewPrompt,
    buildWritingAssistPrompt,
    buildDiscoveryPrompt,
    buildPeriodicSummaryPrompt,
    parseStructuredResponse,
} from "./llm";
export type { PromptScenario, StructuredFinding, StructuredLLMResponse, PromptBuildResult } from "./llm";

export { ResearchManager } from "./research";
export type { ResearchCallbacks, ResearchFinding, ResearchRequest, ResearchResult } from "./research";

export { PanelView } from "./panel";
export type { PanelLayoutType, PanelFinding, PanelAction, PanelCallbacks, PanelViewOptions, NoteConnection, DiscoveryResult } from "./panel";

export {
    PAGELET_DETAIL_ICON,
    PAGELET_DETAIL_VIEW_TYPE,
    PageletDetailView,
    TabView,
    registerPageletDetailIcon,
} from "./tab";
export type { PageletDetailContent, PageletDetailPayload, TabSection, TabCard } from "./tab";
